import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  sectorView,
  generatePlanet,
  generateStation,
  fogView,
  wormholeExitsAt,
  wormholeCost,
  spendEnergy,
  activeModifiers,
  applyEnergyMods,
  moveCostWith,
  DEFAULT_ENERGY,
  N,
  type TradeOrder,
} from '@starwonder/game-core';
import { moveInput, orderInput } from '@starwonder/shared';
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
  type TraderRow,
} from '../session';
import {
  baselineMarket,
  cancelOrder,
  conditionsOf,
  effectiveMarket,
  logEvent,
  orderOf,
  orderViewOf,
  settleTrader,
} from '../idle';
import { allWormholeKeys, whCostOpts, whKey } from '../nav';

// The other traders parked in a sector right now — the "also here" roster. `exclude` drops
// the viewing trader (who's already represented by the orbit viewport); null shows everyone
// (the omniscient admin/anon case). Ship look is derived client-side from the name.
function tradersAt(sectorId: number, exclude: number | null): { id: number; name: string }[] {
  return db
    .select({ id: schema.traders.id, name: schema.traders.name })
    .from(schema.traders)
    .where(eq(schema.traders.currentSector, sectorId))
    .all()
    .filter((t) => t.id !== exclude)
    .map((t) => ({ id: t.id, name: t.name }));
}

// sectorId → count of traders present, for the map's "players here" marker. `visited` limits
// it to charted space (no fog leak); `exclude` drops the viewer. Pass null for both to tally
// every trader across the whole galaxy (admin view).
function presenceCounts(visited: Set<number> | null, exclude: number | null): Record<number, number> {
  const rows = db
    .select({ id: schema.traders.id, sector: schema.traders.currentSector })
    .from(schema.traders)
    .all();
  const out: Record<number, number> = {};
  for (const r of rows) {
    if (r.id === exclude) continue;
    if (visited && !visited.has(r.sector)) continue;
    out[r.sector] = (out[r.sector] ?? 0) + 1;
  }
  return out;
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
  selfTraderId: number | null = null,
  priceFor: TraderRow | null = null, // personalize market prices (nudges + conditions)
  withRoster = true, // the named "also here" roster — only where the viewer is present
): Record<string, unknown> {
  const g = world.galaxy;
  const seed = world.settings.seed;
  const base = sectorView(g, id);

  const planet = base.inhabited ? generatePlanet(seed, id, base.rimT) : undefined;
  const station = base.inhabited ? generateStation(seed, id, base.rimT) : undefined;
  let market = base.inhabited ? baselineMarket(world, id) : undefined;
  if (market && priceFor) market = effectiveMarket(market, priceFor, id, Date.now());

  // A TAKEN wormhole's far end is charted space (traversing it visited it) — Tier 2 of
  // the knowledge policy: visited places are named everywhere, so the chip gets the
  // world's identity. Untaken ones stay a pure mystery (no id, no name — blind jump).
  const wormholeExits = wormholeExitsAt(g, id, taken, whCostOpts()).map((x) => {
    if (x.to == null || g.inhabited[x.to] !== 1) return x;
    const p = generatePlanet(seed, x.to, g.sdist[x.to] / g.maxD);
    return { ...x, planet: { name: p.name, palette: p.palette, spin: p.spin } };
  });

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
  const traders = withRoster ? tradersAt(id, selfTraderId) : undefined; // who else is parked here

  const override = db.select().from(schema.sectorState).where(eq(schema.sectorState.sectorId, id)).get();
  if (!override) {
    return { ...rest, wormholeExits, lanes, planet, station, market, traders };
  }

  const { planet: pOvr, station: sOvr, ...topOvr } = override.data as Record<string, unknown>;
  return {
    ...rest,
    wormholeExits,
    lanes,
    planet: planet ? { ...planet, ...((pOvr as object) ?? {}) } : undefined,
    station: station ? { ...station, ...((sOvr as object) ?? {}) } : undefined,
    market,
    traders,
    ...topOvr,
  };
}

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  // Public: just whether a world exists + the (non-secret) movement costs for the UI.
  app.get('/api/universe', async () => {
    const w = getWorld();
    // Lane cost is flat; wormhole cost is per-span, so it rides each exit/edge instead.
    return { exists: w !== null, costs: { move: getConfig('move_energy_cost') } };
  });

  // The fogged player map — only what the active trader has seen.
  app.get('/api/map', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const trader = loadActiveTrader(await getSession(req));
    if (!trader) return reply.code(409).send({ error: 'no active trader' });
    const visited = visitedSet(trader.id);
    const view = fogView(w.galaxy, visited, takenWormholes(trader.id), whCostOpts());
    // Where other traders are, limited to charted space so the fog isn't leaked.
    return { ...view, presence: presenceCounts(visited, trader.id) };
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
    // Omniscient view ONLY when there's no trader in play, or an admin explicitly asks
    // for it (?admin=1 — the Explorer). An admin PLAYING a trader gets the trader's
    // perspective like anyone else: the view must agree with what /api/move will accept,
    // or known-looking wormholes/lanes render that the intent then rejects.
    const wantAdmin = (req.query as { admin?: string }).admin === '1';
    const full = !trader || (isAdmin && wantAdmin);

    let known: Set<number> | null = null;
    if (!full && trader) {
      known = visitedSet(trader.id);
      if (!known.has(id)) {
        return reply.code(403).send({ error: 'not explored' });
      }
    }

    // Settle-first: reading your sector advances your downtime/course (idle-narrative §6).
    const fresh = trader ? settleTrader(w, trader).trader : null;

    const taken = full ? allWormholeKeys(w.galaxy) : takenWormholes(trader!.id);
    // Prices are personalized only for the trader's own current sector. Same rule for the
    // named "also here" roster: you see WHO is in a sector only by being there (the map's
    // presence pips stay counts) — omniscient admin/anon viewers see every roster.
    const here = fresh != null && fresh.currentSector === id;
    const priceFor = here ? fresh : null;
    return buildSector(w, id, taken, known, full ? null : trader!.id, priceFor, full || here);
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

    // Settle the session before leaving it (settle-first invariant). Taking the helm
    // mid-course drops the autopilot: the remaining route is scrubbed where the ship is.
    const state = settleTrader(w, trader);
    const settled = state.trader;
    if (state.session?.kind === 'transit') {
      db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).run();
      logEvent(trader.id, settled.currentSector, {
        plugin: 'course',
        outcome: 'canceled',
        summary: 'dropped out of warp and took the helm',
        newsworthy: false,
      });
    }

    const body = moveInput.parse(req.body);
    const g = w.galaxy;
    const current = settled.currentSector;
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

    // Conditions warp the inputs, never the functions: sick/injured jumps cost more,
    // and the regen clock runs at the trader's effective rate.
    const mods = activeModifiers(conditionsOf(settled));
    const baseCost = viaWormhole
      ? wormholeCost(g, current, dest, whCostOpts())
      : getConfig('move_energy_cost');
    const cost = moveCostWith(baseCost, mods);
    const energyCfg = applyEnergyMods(DEFAULT_ENERGY, mods);
    const spent = spendEnergy(
      { value: settled.energy, updatedAt: settled.energyUpdatedAt },
      cost,
      energyCfg,
    );
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

    // Leaving the dock scrubs any half-worked order (what filled, you keep).
    cancelOrder(settled, Date.now());

    // Arriving at an inhabited sector opens a fresh dock session (the goal lives on the trader).
    const arrived = settleTrader(
      w,
      { ...settled, currentSector: dest, tradeOrder: null },
    ).trader;

    return {
      discovered,
      trader: {
        currentSector: dest,
        energy: spent.value,
        energyCap: energyCfg.cap,
        energyUpdatedAt: spent.updatedAt,
        credits: arrived.credits,
        ship: shipOf(arrived),
      },
      sector: buildSector(w, dest, taken, visitedSet(trader.id), trader.id, arrived),
    };
  });

  // The updated trader + order + personal market, returned by both order intents.
  function orderResult(w: World, t: TraderRow, sectorId: number): Record<string, unknown> {
    const now = Date.now();
    const energyCfg = applyEnergyMods(DEFAULT_ENERGY, activeModifiers(conditionsOf(t)));
    return {
      trader: {
        credits: t.credits,
        ship: shipOf(t),
        energy: t.energy,
        energyCap: energyCfg.cap,
        energyUpdatedAt: t.energyUpdatedAt,
      },
      order: orderViewOf(w, t, now),
      market: effectiveMarket(baselineMarket(w, sectorId), t, sectorId, now),
    };
  }

  // Place a trade order at the current dock. Trading is not instantaneous: the order is
  // worked by the settle, chunk by haggled chunk, paced by energy alone — a banked pool
  // bursts most of it right here in the handler; broke, the regen clock fills it while
  // you wander off (docs/0-Projects/trading.md).
  app.post('/api/order', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const s = await getSession(req);
    const trader = loadActiveTrader(s);
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    // Settle-first: downtime may have changed credits/cargo, and rumours change prices.
    const state = settleTrader(w, trader);
    const settled = state.trader;
    // Orders are worked dockside — at anchor or under way there's no broker to lean on.
    if (state.session?.kind !== 'dock') {
      return reply.code(409).send({ error: 'dock at the station to trade' });
    }

    const body = orderInput.parse(req.body);
    const id = settled.currentSector;
    if (orderOf(settled)) return reply.code(409).send({ error: 'an order is already working' });

    const entry = baselineMarket(w, id).find((m) => m.id === body.commodity);
    if (!entry) return reply.code(400).send({ error: 'unknown commodity' });

    const ship = shipOf(settled);
    if (body.side === 'sell') {
      if ((ship.cargo[body.commodity] ?? 0) < body.qty) {
        return reply.code(400).send({ error: "you don't hold that much" });
      }
    } else {
      const used = Object.values(ship.cargo).reduce((a, b) => a + b, 0);
      if (used + body.qty > ship.holdSize) {
        return reply.code(409).send({ error: 'not enough cargo space' });
      }
    }

    const now = Date.now();
    const order: TradeOrder = {
      sectorId: id,
      side: body.side,
      commodity: body.commodity,
      qty: body.qty,
      filled: 0,
      spent: 0,
      ...(body.limit !== undefined ? { limit: body.limit } : {}),
      placedAt: now,
      settledAt: now,
      attempts: 0,
    };
    db.update(schema.traders).set({ tradeOrder: order }).where(eq(schema.traders.id, trader.id)).run();
    logEvent(
      trader.id,
      id,
      {
        plugin: 'trade',
        outcome: 'placed',
        summary: `put in a ${body.side} order for ${body.qty}t of ${entry.name.toLowerCase()}`,
        numbers: {
          commodity: body.commodity,
          side: body.side,
          qty: body.qty,
          ...(body.limit !== undefined ? { limit: body.limit } : {}),
        },
        newsworthy: false, // the completion is the news — don't double-post fast orders
      },
      now,
    );

    // Work the banked burst immediately — a rested order can fill on the spot.
    const fresh = settleTrader(w, { ...settled, tradeOrder: order }).trader;
    return orderResult(w, fresh, id);
  });

  // Scrub the working order where it stands. Whatever filled, you keep.
  app.delete('/api/order', async (req, reply) => {
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    const s = await getSession(req);
    const trader = loadActiveTrader(s);
    if (!trader) return reply.code(409).send({ error: 'no active trader' });

    const settled = settleTrader(w, trader).trader;
    const order = cancelOrder(settled, Date.now());
    if (!order) return reply.code(409).send({ error: 'no order working' });

    const fresh = { ...settled, tradeOrder: null };
    return orderResult(w, fresh, settled.currentSector);
  });
}
