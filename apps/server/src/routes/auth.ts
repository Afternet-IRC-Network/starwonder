import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { DEFAULT_ENERGY } from '@starwonder/game-core';
import { registerInput, loginInput, createTraderInput } from '@starwonder/shared';
import { db, schema } from '../db';
import { env } from '../env';
import { getConfig } from '../config';
import { getWorld } from '../galaxy';
import {
  buildMe,
  defaultShip,
  signSession,
  clearSession,
  getSession,
} from '../session';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerInput.parse(req.body);
    if (body.gate !== env.GATE_PASSWORD) {
      return reply.code(403).send({ error: 'incorrect gate password' });
    }
    const existing = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, body.username))
      .get();
    if (existing) return reply.code(409).send({ error: 'username already taken' });

    // The first account created is the admin.
    const count = db.select({ n: sql<number>`count(*)` }).from(schema.users).get();
    const isAdmin = (count?.n ?? 0) === 0;

    const passwordHash = await hash(body.password);
    const now = Date.now();
    const u = db
      .insert(schema.users)
      .values({ username: body.username, authProvider: 'local', passwordHash, isAdmin, createdAt: now })
      .returning()
      .get();

    // No trader yet — the client routes to the pilot screen to create the first one.
    signSession(app, reply, { uid: u.id, activeTraderId: null });
    return buildMe(u.id, null);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginInput.parse(req.body);
    const u = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, body.username))
      .get();
    if (!u || !u.passwordHash) return reply.code(401).send({ error: 'bad credentials' });
    const ok = await verify(u.passwordHash, body.password);
    if (!ok) return reply.code(401).send({ error: 'bad credentials' });

    // Auto-select when there's exactly one trader; otherwise the client shows the picker.
    const traders = db.select().from(schema.traders).where(eq(schema.traders.userId, u.id)).all();
    const activeTraderId = traders.length === 1 ? traders[0].id : null;

    signSession(app, reply, { uid: u.id, activeTraderId });
    return buildMe(u.id, activeTraderId);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const s = await getSession(req);
    if (!s) return reply.code(401).send({ error: 'not authenticated' });
    const me = buildMe(s.uid, s.activeTraderId);
    if (!me) return reply.code(401).send({ error: 'user not found' });
    return me;
  });

  // ── Traders ────────────────────────────────────────────────────────────────

  app.post('/api/traders', async (req, reply) => {
    const s = await getSession(req);
    if (!s) return reply.code(401).send({ error: 'not authenticated' });
    if (!getWorld()) return reply.code(409).send({ error: 'no universe yet' });

    const body = createTraderInput.parse(req.body);

    const owned = db.select().from(schema.traders).where(eq(schema.traders.userId, s.uid)).all();
    if (owned.length >= getConfig('trader_cap')) {
      return reply.code(409).send({ error: `trader cap reached (${getConfig('trader_cap')})` });
    }

    const taken = db.select().from(schema.traders).where(eq(schema.traders.name, body.name)).get();
    if (taken) return reply.code(409).send({ error: 'name already taken' });

    const now = Date.now();
    const t = db.transaction((tx) => {
      const created = tx
        .insert(schema.traders)
        .values({
          userId: s.uid,
          name: body.name,
          credits: 1000,
          energy: DEFAULT_ENERGY.cap,
          energyUpdatedAt: now,
          currentSector: 0,
          ship: defaultShip(),
          createdAt: now,
        })
        .returning()
        .get();
      tx.insert(schema.traderVisited).values({ traderId: created.id, sectorId: 0 }).run();
      return created;
    });

    // Auto-select the new trader.
    signSession(app, reply, { uid: s.uid, activeTraderId: t.id });
    return buildMe(s.uid, t.id);
  });

  app.post('/api/traders/:id/select', async (req, reply) => {
    const s = await getSession(req);
    if (!s) return reply.code(401).send({ error: 'not authenticated' });
    const id = Number((req.params as { id: string }).id);
    const t = db.select().from(schema.traders).where(eq(schema.traders.id, id)).get();
    if (!t || t.userId !== s.uid) return reply.code(404).send({ error: 'trader not found' });

    signSession(app, reply, { uid: s.uid, activeTraderId: id });
    return buildMe(s.uid, id);
  });
}
