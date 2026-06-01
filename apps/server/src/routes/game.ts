import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  sectorView,
  generatePlanet,
  generateStation,
  generateMarket,
  fogView,
  wormholeExitsAt,
  spendEnergy,
  DEFAULT_ENERGY,
  N,
} from '@starwonder/game-core';
import { moveInput, tradeInput, type ShipData } from '@starwonder/shared';
import { db, schema } from '../db';
import { getConfig } from '../config';
import { getWorld, type World } from '../galaxy';
import {
  getSession,
  loadUser,
  loadActiveTrader,
  visitedSet,
  takenWormholes,
  shipOf,
} from '../session';

const whKey = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;

function allWormholeKeys(g: World['galaxy']): Set<string> {
  return new Set(g.wormholes.map((w) => whKey(w.a, w.b)));
}

// The authoritative sector payload: computed baseline + content + trader-aware exits, with
// any sector_state override merged on top. `taken` is the set of wormhole keys the viewer
// knows the far end of (all of them, for an admin / omniscient viewer).
// `known` is the set of sectors the viewer has visited (null ⇒ omniscient admin/anon). It
// only affects the per-lane nav chips — what the trader knows about each adjacent sector.
function buildSector(
  world: World,
  id: number,
  taken: Set<string>,
  known: Set<number> | null = null,
): Record<string, unknown> {
  const g = world.galaxy;
  const seed = world.settings.seed;
  const base = sectorView(g, id);

  const planet = base.inhabited ? generatePlanet(seed, id, base.rimT) : undefined;
  const station = base.inhabited ? generateStation(seed, id, base.rimT) : undefined;
  const market = base.inhabited
    ? generateMarket(seed, id, base.rimT, {
        gradientStrength: getConfig('gradient_strength'),
        spread: getConfig('trade_spread'),
      })
    : undefined;

  const wormholeExits = wormholeExitsAt(g, id, taken);

  // Per-lane nav chips: visited neighbours reveal their world (name + look); unvisited ones
  // are just "?" + id. No fog leak — the id is already in `neighbors`, and a planet's
  // name/look only rides along for a sector the trader has actually seen.
  const lanes = base.neighbors.map((nid) => {
    const visited = known === null || known.has(nid);
    if (visited && g.inhabited[nid] === 1) {
      const p = generatePlanet(seed, nid, g.sdist[nid] / g.maxD);
      return { id: nid, visited, planet: { name: p.name, palette: p.palette, spin: p.spin } };
    }
    return { id: nid, visited };
  });

  const { wormholes: _drop, ...rest } = base; // players never get the raw destination list

  const override = db.select().from(schema.sectorState).where(eq(schema.sectorState.sectorId, id)).get();
  if (!override) {
    return { ...rest, wormholeExits, lanes, planet, station, market };
  }

  const { planet: pOvr, station: sOvr, ...topOvr } = override.data as Record<string, unknown>;
  return {
    ...rest,
    wormholeExits,
    lanes,
    planet: planet ? { ...planet, ...((pOvr as object) ?? {}) } : undefined,
    station: station ? { ...station, ...((sOvr as object) ?? {}) } : undefined,
    market,
    ...topOvr,
  };
}

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  // Public: just whether a world exists + the (non-secret) movement costs for the UI.
  app.get('/api/universe', async () => {
    const w = getWorld();
    return {
      exists: w !== null,
      costs: { move: getConfig('move_energy_cost'), wormhole: getConfig('wormhole_energy_cost') },
    };
  });

  // The fogged player map — only what the active trader has seen.
  app.get('/api/map', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });
    return fogView(w.galaxy, visitedSet(trader.id), takenWormholes(trader.id));
  });

  // Trader-aware sector detail. Admins and the anonymous/no-trader case see everything;
  // a player with an active trader only sees sectors they've visited.
  app.get('/api/sector/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 0 || id >= N) {
      return reply.code(400).send({ error: 'bad sector id' });
    }
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    if (!w.galaxy.dist || w.galaxy.dist[id] < 0) {
      return reply.code(404).send({ error: 'sector does not exist' });
    }

    const s = await getSession(req);
    const isAdmin = s ? !!loadUser(s.uid)?.isAdmin : false;
    const trader = loadActiveTrader(s);
    const full = isAdmin || !trader;

    let known: Set<number> | null = null;
    if (!full && trader) {
      known = visitedSet(trader.id);
      if (!known.has(id)) {
        return reply.code(403).send({ error: 'not explored' });
      }
    }

    const taken = full ? allWormholeKeys(w.galaxy) : takenWormholes(trader!.id);
    return buildSector(w, id, taken, known);
  });

  // ── Intents ────────────────────────────────────────────────────────────────

  // Move to an adjacent sector. { to } for a lane / known wormhole; { wormhole: ref } for
  // a blind jump through an unexplored wormhole.
  app.post('/api/move', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const s = await getSession(req);
    const trader = loadActiveTrader(s);
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const body = moveInput.parse(req.body);
    const g = w.galaxy;
    const current = trader.currentSector;
    const whEdges = allWormholeKeys(g);
    const taken = takenWormholes(trader.id);

    let dest: number;
    let viaWormhole: boolean;

    if ('to' in body) {
      dest = body.to;
      if (g.dist[dest] < 0) return reply.code(400).send({ error: 'sector does not exist' });
      const key = whKey(current, dest);
      const isLane = g.adj[current].includes(dest) && !whEdges.has(key);
      const isKnownWormhole = whEdges.has(key) && taken.has(key);
      if (isLane) viaWormhole = false;
      else if (isKnownWormhole) viaWormhole = true;
      else return reply.code(400).send({ error: 'not an adjacent sector' });
    } else {
      const wm = g.wormholes[body.wormhole];
      if (!wm || (wm.a !== current && wm.b !== current)) {
        return reply.code(400).send({ error: 'not a wormhole here' });
      }
      dest = wm.a === current ? wm.b : wm.a;
      if (g.dist[dest] < 0) return reply.code(400).send({ error: 'sector does not exist' });
      viaWormhole = true;
    }

    const cost = viaWormhole ? getConfig('wormhole_energy_cost') : getConfig('move_energy_cost');
    const spent = spendEnergy({ value: trader.energy, updatedAt: trader.energyUpdatedAt }, cost);
    if (!spent) return reply.code(402).send({ error: 'not enough energy' });

    // First time the trader has ever set foot in `dest`? (drives the "new sector" toast)
    const discovered = !visitedSet(trader.id).has(dest);

    db.transaction((tx) => {
      tx.update(schema.traders)
        .set({ currentSector: dest, energy: spent.value, energyUpdatedAt: spent.updatedAt })
        .where(eq(schema.traders.id, trader.id))
        .run();
      tx.insert(schema.traderVisited)
        .values({ traderId: trader.id, sectorId: dest })
        .onConflictDoNothing()
        .run();
      if (viaWormhole) {
        const a = Math.min(current, dest);
        const b = Math.max(current, dest);
        tx.insert(schema.traderWormholes)
          .values({ traderId: trader.id, aSector: a, bSector: b })
          .onConflictDoNothing()
          .run();
        taken.add(whKey(a, b));
      }
    });

    return {
      discovered,
      trader: {
        currentSector: dest,
        energy: spent.value,
        energyCap: DEFAULT_ENERGY.cap,
        credits: trader.credits,
        ship: shipOf(trader),
      },
      sector: buildSector(w, dest, taken, visitedSet(trader.id)),
    };
  });

  // Buy / sell at the current sector's station.
  app.post('/api/trade', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const s = await getSession(req);
    const trader = loadActiveTrader(s);
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const body = tradeInput.parse(req.body);
    const g = w.galaxy;
    const id = trader.currentSector;
    const base = sectorView(g, id);
    if (!base.inhabited) return reply.code(409).send({ error: 'no station here' });

    const market = generateMarket(w.settings.seed, id, base.rimT, {
      gradientStrength: getConfig('gradient_strength'),
      spread: getConfig('trade_spread'),
    });
    const entry = market.find((m) => m.id === body.commodity);
    if (!entry) return reply.code(400).send({ error: 'unknown commodity' });

    const ship = shipOf(trader);
    const cargo: Record<string, number> = { ...ship.cargo };
    let credits = trader.credits;

    if (body.action === 'buy') {
      const cost = entry.buy * body.qty;
      if (credits < cost) return reply.code(402).send({ error: 'not enough credits' });
      const used = Object.values(cargo).reduce((a, b) => a + b, 0);
      if (used + body.qty > ship.holdSize) return reply.code(409).send({ error: 'not enough cargo space' });
      cargo[body.commodity] = (cargo[body.commodity] ?? 0) + body.qty;
      credits -= cost;
    } else {
      const have = cargo[body.commodity] ?? 0;
      if (have < body.qty) return reply.code(400).send({ error: "you don't have that" });
      const left = have - body.qty;
      if (left > 0) cargo[body.commodity] = left;
      else delete cargo[body.commodity];
      credits += entry.sell * body.qty;
    }

    const newShip: ShipData = { holdSize: ship.holdSize, cargo };
    db.update(schema.traders)
      .set({ credits, ship: newShip })
      .where(eq(schema.traders.id, trader.id))
      .run();

    return { trader: { credits, ship: newShip }, market };
  });
}
