// The IRC bot's surface — one endpoint, bearer-token gated. The bot is a thin stateless
// HTTP client (apps/bot): it never opens the DB and never runs game logic. Each tick it
// asks us to settle all open dock sessions (the bot doubles as the world's heartbeat —
// idle-narrative.md §5), then reads new event rows rendered as third-person blurbs:
//   "<trader> <fact.summary> — <station>."
// Switch the bot off and the game degrades back to pure lazy settle-on-check-in.

import type { FastifyInstance } from 'fastify';
import { asc, gt, sql } from 'drizzle-orm';
import { generateStation, type EventFact } from '@starwonder/game-core';
import { z } from 'zod';
import { db, schema } from '../db';
import { env } from '../env';
import { getWorld } from '../galaxy';
import { settleTrader } from '../idle';

const tickInput = z.object({ after: z.number().int().nonnegative().optional() }).default({});

export async function botRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/bot/tick', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${env.BOT_TOKEN}`) {
      return reply.code(401).send({ error: 'bad bot token' });
    }
    const body = tickInput.parse(req.body ?? {});
    const w = getWorld();
    if (!w) return { cursor: body.after ?? 0, events: [] };

    // Heartbeat: settle every trader through the normal path (idempotent, cheap) —
    // docked stays advance their beats, plotted courses fly their hops.
    const now = Date.now();
    const traders = db.select().from(schema.traders).all();
    for (const t of traders) settleTrader(w, t, now);

    // First call (no cursor): hand back "now" so a fresh bot doesn't replay history.
    if (body.after === undefined) {
      const max = db.select({ m: sql<number>`coalesce(max(id), 0)` }).from(schema.events).get();
      return { cursor: max?.m ?? 0, events: [] };
    }

    const rows = db
      .select()
      .from(schema.events)
      .where(gt(schema.events.id, body.after))
      .orderBy(asc(schema.events.id))
      .limit(200)
      .all();
    const names = new Map(traders.map((t) => [t.id, t.name]));
    const g = w.galaxy;
    const seed = w.settings.seed;

    const events = rows.flatMap((r) => {
      const fact = r.fact as EventFact;
      if (fact.newsworthy === false) return []; // outcomes are public; noise is not
      const rimT = g.maxD > 0 ? g.sdist[r.sectorId] / g.maxD : 0;
      // The channel speaks in NAMES, never sector numbers — gossip knows places, not
      // coordinates. Empty space is just the deep black.
      const place =
        g.inhabited[r.sectorId] === 1
          ? generateStation(seed, r.sectorId, rimT).name
          : 'the deep black';
      const name = names.get(r.traderId) ?? 'A drifter';
      return [{ id: r.id, at: r.at, blurb: `${name} ${fact.summary} — ${place}.` }];
    });

    return { cursor: rows.length ? rows[rows.length - 1].id : body.after, events };
  });
}
