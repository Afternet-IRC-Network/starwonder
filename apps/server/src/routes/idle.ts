// The downtime surface: the idle view (session + narrative + log + prompt preview), the
// goal intent, the course intents (plot / cancel), and the trader's event log. All
// settle-first. The view has a `mode`: 'dock' (parked at a station), 'transit' (flying a
// plotted course), or 'adrift' (empty sector, no course).

import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gt, gte } from 'drizzle-orm';
import {
  addr,
  GOAL_KINDS,
  activeModifiers,
  applyEnergyMods,
  conditionInfo,
  DEFAULT_ENERGY,
  factLine,
  generatePlanet,
  generateStation,
  stationVibe,
  transitSchedule,
  vibeBlurb,
  type EventFact,
  type Goal,
  type TransitRoute,
} from '@starwonder/game-core';
import { courseInput, goalInput } from '@starwonder/shared';
import { db, schema } from '../db';
import { getConfig } from '../config';
import { getWorld, type World } from '../galaxy';
import { getSession, loadActiveTrader, takenWormholes, visitedSet, type TraderRow } from '../session';
import {
  cancelOrder,
  conditionsOf,
  currentHeat,
  goalOf,
  logEvent,
  orderViewOf,
  personaOf,
  settleTrader,
  stationStateOf,
} from '../idle';
import { planCourse } from '../nav';
import { buildNarrativePrompt, templatedNarrative } from '../narrator';

// The world-name a course points at — AS THIS TRADER KNOWS IT. The planet is the system's
// identity, but you learn a world's name by going there: an uncharted destination is just
// an address ("Sector #658") until the fog lifts. Never name what the viewer hasn't seen.
function placeName(w: World, sectorId: number, visited: Set<number>): string {
  const g = w.galaxy;
  if (!visited.has(sectorId)) return addr(sectorId);
  const rimT = g.maxD > 0 ? g.sdist[sectorId] / g.maxD : 0;
  return g.inhabited[sectorId] === 1 ? generatePlanet(w.settings.seed, sectorId, rimT).name : addr(sectorId);
}

// This session's events, oldest → newest (nominal time scoped by session start). Transit
// events span sectors, so the filter is by trader + time, not by place.
function sessionEvents(traderId: number, startedAt: number) {
  return db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.traderId, traderId), gte(schema.events.at, startedAt)))
    .orderBy(schema.events.id)
    .all();
}

function eventViews(rows: ReturnType<typeof sessionEvents>) {
  return rows
    .slice(-40)
    .reverse()
    .map((r) => ({
      id: r.id,
      at: r.at,
      sectorId: r.sectorId,
      line: factLine(r.fact as EventFact),
      summary: (r.fact as EventFact).summary,
      plugin: r.plugin,
    }));
}

// The whole downtime payload: settle, then assemble session + story + log + the prompt
// that WOULD go to the narrator model (shown verbatim until an API key exists).
function buildIdleView(w: World, trader: TraderRow, now: number): Record<string, unknown> {
  const settled = settleTrader(w, trader, now);
  const t = settled.trader;
  const session = settled.session;

  const goal = goalOf(t);
  const conditions = conditionsOf(t)
    .map((c) => ({ ...c, info: conditionInfo(c.id) }))
    .filter((c) => c.info !== null)
    .map((c) => ({ id: c.id, since: c.since, label: c.info!.label, blurb: c.info!.blurb }));

  const common = {
    goalKinds: GOAL_KINDS,
    goal,
    heat: Math.round(currentHeat(t, now) * 10) / 10,
    conditions,
    modifiers: activeModifiers(conditionsOf(t)),
    currentSector: t.currentSector,
  };

  if (!session) {
    return { ...common, mode: 'adrift', narrative: '', narratePrompt: null, events: [] };
  }

  const seed = w.settings.seed;
  const g = w.galaxy;
  const rows = sessionEvents(t.id, session.startedAt);
  const facts = rows.map((r) => r.fact as EventFact);
  const narrative = templatedNarrative('', facts);

  if (session.kind === 'transit') {
    const route = session.route as TransitRoute;
    const destId = route.path[route.path.length - 1];
    const destination = { id: destId, name: placeName(w, destId, visitedSet(t.id)) };
    const hopsRemaining = route.path.length - 1 - route.leg;
    // Energy IS the flight clock: project when the next hop's fare comes due + arrival.
    const conditionList = conditionsOf(t);
    const energyCfg = applyEnergyMods(DEFAULT_ENERGY, activeModifiers(conditionList));
    const sched = transitSchedule(
      route,
      { value: t.energy, updatedAt: t.energyUpdatedAt },
      energyCfg,
      conditionList,
      now,
    );
    const prompt = buildNarrativePrompt({
      persona: personaOf(t),
      place: `the run out to ${destination.name}`,
      setting: 'the long quiet of open space between worlds',
      goal,
      previousNarrative: '',
      facts: facts.slice(-12),
    });
    return {
      ...common,
      mode: 'transit',
      sessionStartedAt: session.startedAt,
      course: {
        path: route.path,
        leg: route.leg,
        destination,
        hopsRemaining,
        nextHopAt: sched.nextHopAt,
        etaAt: sched.etaAt,
      },
      narrative,
      narratePrompt: getConfig('idle_narrate') ? prompt : null,
      events: eventViews(rows),
    };
  }

  // Stationary downtime — docked at the station, or riding at anchor in orbit. Same
  // world, different chapter: the docked story is the bars and the dockside; the orbit
  // story is your own hull with the traffic turning below.
  const sectorId = session.sectorId;
  const rimT = g.maxD > 0 ? g.sdist[sectorId] / g.maxD : 0;
  const station = generateStation(seed, sectorId, rimT);
  const planet = generatePlanet(seed, sectorId, rimT);
  const vibe = stationVibe(seed, sectorId, rimT, station.stationType);
  const vibeKey = `${seed}|vibe|${sectorId}`;
  const docked = session.kind === 'dock';
  const prompt = buildNarrativePrompt({
    persona: personaOf(t),
    place: docked ? station.name : `the anchorage over ${planet.name}`,
    setting: docked
      ? vibeBlurb(vibe, vibeKey)
      : `your own ship riding at anchor, ${station.name} turning below`,
    goal,
    previousNarrative: '',
    facts: facts.slice(-12),
  });

  return {
    ...common,
    mode: docked ? 'dock' : 'orbit',
    sectorId,
    stationName: station.name,
    planetName: planet.name,
    vibe: vibeBlurb(vibe, vibeKey),
    sessionStartedAt: session.startedAt,
    beatMinutes: getConfig('idle_beat_minutes'),
    standing: Math.round(stationStateOf(t.id, sectorId, now).standing * 10) / 10,
    order: docked ? orderViewOf(w, t, now) : null,
    narrative,
    narratePrompt: getConfig('idle_narrate') ? prompt : null,
    events: eventViews(rows),
  };
}

export async function idleRoutes(app: FastifyInstance): Promise<void> {
  // The downtime panel (what's been happening while you idle, wherever you are).
  app.get('/api/idle', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });
    return buildIdleView(w, trader, Date.now());
  });

  // Set / change the downtime goal — trader-level, valid docked, in transit, or adrift.
  // Settles elapsed beats under the OLD goal first, so "the current goal" is always
  // correct for every unsettled beat (no goal history).
  app.post('/api/goal', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const body = goalInput.parse(req.body);
    const now = Date.now();
    const settled = settleTrader(w, trader, now);

    const goal: Goal = { kind: body.kind };
    if (body.target) goal.target = body.target;
    if (body.blurb) goal.blurb = body.blurb;
    db.update(schema.traders).set({ goal }).where(eq(schema.traders.id, trader.id)).run();

    return buildIdleView(w, { ...settled.trader, goal }, now);
  });

  // Dock at the current sector's station. Arriving anywhere only parks you AT ANCHOR —
  // docking is a deliberate act, and you stay docked until you undock (or set out). The
  // docked stay is where station beats roll, orders fill, and "made port" can announce.
  app.post('/api/dock', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const now = Date.now();
    const settled = settleTrader(w, trader, now);
    const t = settled.trader;
    if (settled.session?.kind === 'transit') {
      return reply.code(409).send({ error: 'under way — drop out of warp first' });
    }
    if (w.galaxy.inhabited[t.currentSector] !== 1) {
      return reply.code(409).send({ error: 'no station here' });
    }
    if (settled.session?.kind === 'dock') return buildIdleView(w, t, now); // already docked

    db.transaction((tx) => {
      tx.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, t.id)).run();
      tx.insert(schema.dockSessions)
        .values({
          traderId: t.id,
          kind: 'dock',
          sectorId: t.currentSector,
          route: null,
          startedAt: now,
          settledAt: now,
          beatsResolved: 0,
          capsUsed: { credits: 0, standing: 0 },
          narrative: '',
          narratedThrough: 0,
          announced: 0, // a stay that survives the debounce earns its "made port" line
        })
        .run();
    });
    const g = w.galaxy;
    const rimT = g.maxD > 0 ? g.sdist[t.currentSector] / g.maxD : 0;
    const station = generateStation(w.settings.seed, t.currentSector, rimT).name;
    logEvent(t.id, t.currentSector, {
      plugin: 'course',
      outcome: 'docked',
      summary: `docked at ${station}`,
      numbers: { station },
      newsworthy: false,
    }, now);

    return buildIdleView(w, t, now);
  });

  // Cast off: end the docked stay and take up anchor in orbit. Scrubs any working order
  // (leaving is leaving — what filled, you keep).
  app.post('/api/undock', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const now = Date.now();
    const settled = settleTrader(w, trader, now);
    const t = settled.trader;
    if (settled.session?.kind !== 'dock') {
      return reply.code(409).send({ error: 'not docked' });
    }
    cancelOrder(t, now);

    db.transaction((tx) => {
      tx.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, t.id)).run();
      tx.insert(schema.dockSessions)
        .values({
          traderId: t.id,
          kind: 'orbit',
          sectorId: t.currentSector,
          route: null,
          startedAt: now,
          settledAt: now,
          beatsResolved: 0,
          capsUsed: { credits: 0, standing: 0 },
          narrative: '',
          narratedThrough: 0,
          announced: 1,
        })
        .run();
    });
    logEvent(t.id, t.currentSector, {
      plugin: 'course',
      outcome: 'undocked',
      summary: 'cast off and took up anchor in orbit',
      newsworthy: false,
    }, now);

    return buildIdleView(w, { ...t, tradeOrder: null }, now);
  });

  // Plot a course: the journey becomes a transit session, flown one hop per beat by the
  // settle — energy is paid per hop out of the regenerating pool, so a course longer than
  // the current tank is still plottable (regen pays for it while you're away).
  app.post('/api/course', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const body = courseInput.parse(req.body);
    const now = Date.now();
    const settled = settleTrader(w, trader, now); // settle-first: fly out from where you ARE
    const t = settled.trader;

    if (body.path[0] !== t.currentSector) {
      return reply.code(409).send({ error: 'course must start at your current sector' });
    }
    const plan = planCourse(w, takenWormholes(t.id), body.path);
    if ('error' in plan) return reply.code(400).send({ error: plan.error });

    // Setting out scrubs any half-worked dock order (what filled, you keep).
    cancelOrder(t, now);

    const route: TransitRoute = { path: body.path, costs: plan.costs, wormhole: plan.wormhole, leg: 0 };
    db.transaction((tx) => {
      tx.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, t.id)).run();
      tx.insert(schema.dockSessions)
        .values({
          traderId: t.id,
          kind: 'transit',
          sectorId: t.currentSector,
          route,
          startedAt: now,
          settledAt: now,
          beatsResolved: 0,
          capsUsed: { credits: 0, standing: 0 },
          narrative: '',
          narratedThrough: 0,
        })
        .run();
    });
    const dest = placeName(w, body.path[body.path.length - 1], visitedSet(t.id));
    const jumps = body.path.length - 1;
    logEvent(t.id, t.currentSector, {
      plugin: 'course',
      outcome: 'departed',
      summary: `set course for ${dest}`,
      numbers: { jumps, dest },
      // The arrival is the news (and a burst-flown course arrives the same second —
      // announcing both would double-post every route).
      newsworthy: false,
    }, now);

    return buildIdleView(w, t, now);
  });

  // Drop out of warp: cancel the course where the ship currently is. The next settle
  // (chained here) reopens a dock session if the sector is inhabited.
  app.delete('/api/course', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const now = Date.now();
    const settled = settleTrader(w, trader, now);
    const t = settled.trader;
    if (!settled.session || settled.session.kind !== 'transit') {
      return reply.code(409).send({ error: 'no course plotted' });
    }
    db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, t.id)).run();
    logEvent(t.id, t.currentSector, {
      plugin: 'course',
      outcome: 'canceled',
      summary: 'dropped out of warp and scrubbed the course',
      newsworthy: false,
    }, now);

    return buildIdleView(w, t, now);
  });

  // The trader's full event log (the #log tab) — newest first, across all stations.
  // `?since=<id>` returns only events newer than that id (the client's poll cursor).
  app.get('/api/log', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    settleTrader(w, trader); // the log should be current as of "now"

    const sinceRaw = (req.query as { since?: string }).since;
    const since = sinceRaw !== undefined ? Number(sinceRaw) : null;

    const g = w.galaxy;
    const seed = w.settings.seed;
    const where =
      since !== null && Number.isFinite(since)
        ? and(eq(schema.events.traderId, trader.id), gt(schema.events.id, since))
        : eq(schema.events.traderId, trader.id);
    const rows = db
      .select()
      .from(schema.events)
      .where(where)
      .orderBy(desc(schema.events.id))
      .limit(100)
      .all();
    return {
      events: rows.map((r) => {
        const rimT = g.maxD > 0 ? g.sdist[r.sectorId] / g.maxD : 0;
        return {
          id: r.id,
          at: r.at,
          sectorId: r.sectorId,
          station:
            g.inhabited[r.sectorId] === 1
              ? generateStation(seed, r.sectorId, rimT).name
              : `Deep space · ${addr(r.sectorId)}`,
          line: factLine(r.fact as EventFact),
        };
      }),
    };
  });
}
