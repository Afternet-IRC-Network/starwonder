// Server glue for the idle sim: load the trader's downtime session + sparse stat rows,
// run the pure settle (dock OR transit), persist the result in ONE transaction. The
// settle-first invariant lives here — every handler that reads or mutates a trader calls
// settleTrader before doing anything else (docs/…/idle-narrative.md §6). A transit
// session that lands mid-settle chains straight into a dock settle at the destination,
// so one call always brings the trader fully up to "now".

import { and, eq, gt, lt } from 'drizzle-orm';
import {
  activeModifiers,
  applyEnergyMods,
  dangerTier,
  DEFAULT_ENERGY,
  generateMarket,
  generatePlanet,
  generateStation,
  settleIdle,
  settleOrder,
  settleTransit,
  stationVibe,
  type Condition,
  type DockStats,
  type Goal,
  type IdleConfig,
  type MarketEntry,
  type OrderSettleInput,
  type Persona,
  type SectorFlavor,
  type SettleResult,
  type TradeOrder,
  type TransitRoute,
} from '@starwonder/game-core';
import { db, schema } from './db';
import { getConfig } from './config';
import type { World } from './galaxy';
import { shipOf, type TraderRow } from './session';

export type DockSessionRow = typeof schema.dockSessions.$inferSelect;

// ── Context gates: the local flavor + presence the beat modules can read ──────

/** What the world generators already know about a sector — lets modules gate like
    the galaxy does (ice-world orbit beats, danger-tier pirate odds, …). */
export function sectorFlavorOf(world: World, sectorId: number): SectorFlavor {
  const g = world.galaxy;
  const rimT = g.maxD > 0 ? g.sdist[sectorId] / g.maxD : 0;
  const flavor: SectorFlavor = { rimT, dangerTier: dangerTier(rimT) };
  if (g.inhabited[sectorId] === 1) {
    flavor.worldClass = generatePlanet(world.settings.seed, sectorId, rimT).worldClass;
    flavor.stationType = generateStation(world.settings.seed, sectorId, rimT).stationType;
  }
  return flavor;
}

/** Names of the OTHER traders parked in a sector — presence-aware beats. The knowledge
    policy holds: beats happen where the trader IS, the one place rosters are known. */
function rosterAt(sectorId: number, exclude: number): string[] {
  return db
    .select({ id: schema.traders.id, name: schema.traders.name })
    .from(schema.traders)
    .where(eq(schema.traders.currentSector, sectorId))
    .all()
    .filter((t) => t.id !== exclude)
    .map((t) => t.name);
}

export function personaOf(t: TraderRow): Persona {
  const p = t.persona as Persona | null;
  return p ?? { blurb: '', tags: [] };
}

export function conditionsOf(t: TraderRow): Condition[] {
  return (t.conditions as Condition[] | null) ?? [];
}

/** The trader-level downtime goal — it rides across docks and courses unchanged. */
export function goalOf(t: TraderRow): Goal | null {
  return (t.goal as Goal | null) ?? null;
}

/** The trader's open trade order (station-scoped; at most one). */
export function orderOf(t: TraderRow): TradeOrder | null {
  return (t.tradeOrder as TradeOrder | null) ?? null;
}

function idleCfg(): IdleConfig {
  return {
    beatMinutes: getConfig('idle_beat_minutes'),
    beatCap: getConfig('idle_beat_cap'),
    quietWeight: getConfig('idle_quiet_weight'),
    creditCap: getConfig('idle_credit_cap'),
    standingCap: getConfig('idle_standing_cap'),
  };
}

// Lazy heat decay — same trick as energy: the elapsed time is the clock.
export function currentHeat(t: TraderRow, now: number): number {
  const since = t.heatUpdatedAt || t.createdAt;
  const hours = Math.max(0, now - since) / 3_600_000;
  return Math.max(0, t.heat - hours * getConfig('heat_decay_per_hour'));
}

// Standing drifts slowly toward neutral so relationships matter but don't ossify.
function decayedStanding(standing: number, updatedAt: number, now: number): number {
  const days = Math.max(0, now - updatedAt) / 86_400_000;
  const drift = days * getConfig('standing_decay_per_day');
  if (standing > 0) return Math.max(0, standing - drift);
  return Math.min(0, standing + drift);
}

export function stationStateOf(
  traderId: number,
  sectorId: number,
  now: number,
): { standing: number; flags: Record<string, number> } {
  const row = db
    .select()
    .from(schema.traderStation)
    .where(and(eq(schema.traderStation.traderId, traderId), eq(schema.traderStation.sectorId, sectorId)))
    .get();
  if (!row) return { standing: 0, flags: {} };
  return {
    standing: decayedStanding(row.standing, row.updatedAt, now),
    flags: (row.flags as Record<string, number> | null) ?? {},
  };
}

/** Live (unexpired) personal price nudges for this trader at this sector. */
export function nudgesAt(
  traderId: number,
  sectorId: number,
  now: number,
): Map<string, { factor: number; expiresAt: number }> {
  const rows = db
    .select()
    .from(schema.marketNudge)
    .where(
      and(
        eq(schema.marketNudge.traderId, traderId),
        eq(schema.marketNudge.sectorId, sectorId),
        gt(schema.marketNudge.expiresAt, now),
      ),
    )
    .all();
  return new Map(rows.map((r) => [r.commodity, { factor: r.factor, expiresAt: r.expiresAt }]));
}

// ── Markets (the trader's personal prices) ─────────────────────────────────────

/** A market entry as one trader sees it — `nudge` present when something skews the price. */
export type PricedMarketEntry = MarketEntry & {
  nudge?: { pct: number; expiresAt: number | null };
};

/** The station's computed baseline price list (pure; config knobs applied). */
export function baselineMarket(world: World, sectorId: number): MarketEntry[] {
  const g = world.galaxy;
  const rimT = g.maxD > 0 ? g.sdist[sectorId] / g.maxD : 0;
  return generateMarket(world.settings.seed, sectorId, rimT, {
    gradientStrength: getConfig('gradient_strength'),
    spread: getConfig('trade_spread'),
  });
}

// A trader's personal view of a market: time-boxed rumour/deal nudges × any condition
// price modifiers, folded into the same slot dynamic stock will use. Entries that differ
// from baseline carry a `nudge` tag so the UI can show "your price" with reason + expiry.
export function effectiveMarket(
  market: MarketEntry[],
  trader: TraderRow,
  sectorId: number,
  now: number,
): PricedMarketEntry[] {
  const nudges = nudgesAt(trader.id, sectorId, now);
  const mods = activeModifiers(conditionsOf(trader));
  return market.map((e) => {
    const n = nudges.get(e.id);
    const factor = (n?.factor ?? 1) * (mods.priceFactor[e.id] ?? 1);
    if (factor === 1) return e;
    return {
      ...e,
      buy: Math.max(1, Math.round(e.buy * factor)),
      sell: Math.max(1, Math.round(e.sell * factor)),
      nudge: { pct: Math.round((factor - 1) * 100), expiresAt: n?.expiresAt ?? null },
    };
  });
}

export interface DockState {
  /** the live session (dock or transit; created lazily when docked); null in the void */
  session: DockSessionRow | null;
  /** what the dock settle resolved this call (null when nothing elapsed / not docked) */
  settled: SettleResult | null;
  /** the trader row re-read after settlement (credits/position/conditions may have changed) */
  trader: TraderRow;
}

/** Delete the trader's downtime session (manual move / course cancel). State persists. */
export function closeSession(traderId: number): DockSessionRow | null {
  const row = db.select().from(schema.dockSessions).where(eq(schema.dockSessions.traderId, traderId)).get();
  if (!row) return null;
  db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, traderId)).run();
  return row;
}

/** Append a server-authored event row (course bookends etc.) — nominal time = now. */
export function logEvent(
  traderId: number,
  sectorId: number,
  fact: { plugin: string; outcome: string; summary: string; numbers?: Record<string, number | string>; newsworthy?: boolean },
  at = Date.now(),
): void {
  db.insert(schema.events)
    .values({ traderId, sectorId, beat: null, at, plugin: fact.plugin, fact })
    .run();
}

// ── Transit ────────────────────────────────────────────────────────────────────

// Fly the elapsed beats of a plotted course: position, energy, fog, wormhole knowledge,
// and event rows all land in one transaction. On arrival the session flips to a dock
// session anchored at the NOMINAL arrival time, so the stay's first beats aren't lost.
function settleTransitSession(
  world: World,
  trader: TraderRow,
  session: DockSessionRow,
  now: number,
): { trader: TraderRow; session: DockSessionRow | null; arrived: boolean } {
  const route = session.route as TransitRoute | null;
  if (!route || route.leg >= route.path.length - 1) {
    // degenerate row — treat as already arrived where we stand
    db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).run();
    return { trader, session: null, arrived: true };
  }

  const conditions = conditionsOf(trader);
  const energyCfg = applyEnergyMods(DEFAULT_ENERGY, activeModifiers(conditions));
  const ship = shipOf(trader);

  const result = settleTransit({
    seed: world.settings.seed,
    traderId: trader.id,
    route,
    session: {
      startedAt: session.startedAt,
      settledAt: session.settledAt,
      beatsResolved: session.beatsResolved,
      capsUsed: (session.capsUsed as { credits: number; standing: number } | null) ?? {
        credits: 0,
        standing: 0,
      },
    },
    goal: goalOf(trader),
    tags: personaOf(trader).tags,
    stats: {
      credits: trader.credits,
      standing: 0, // station-scoped — meaningless between worlds
      heat: currentHeat(trader, now),
      cargo: { ...ship.cargo },
      holdSize: ship.holdSize,
      flags: {},
    },
    conditions,
    energy: { value: trader.energy, updatedAt: trader.energyUpdatedAt },
    energyCfg,
    sectorFlavor: (sid) => sectorFlavorOf(world, sid),
    cfg: idleCfg(),
    now,
  });

  if (result.beatsRun === 0) return { trader, session, arrived: false };

  const dest = route.path[result.leg];
  const arrived = result.arrivedAt !== null;

  db.transaction((tx) => {
    tx.update(schema.traders)
      .set({
        credits: result.stats.credits,
        heat: result.stats.heat,
        heatUpdatedAt: now,
        conditions: result.conditions,
        ship: { holdSize: result.stats.holdSize, cargo: result.stats.cargo },
        currentSector: dest,
        energy: result.energy.value,
        energyUpdatedAt: result.energy.updatedAt,
      })
      .where(eq(schema.traders.id, trader.id))
      .run();

    // Fog grows hop by hop; wormhole far-ends become known the moment they're flown.
    let from = route.path[route.leg];
    for (const h of result.hops) {
      tx.insert(schema.traderVisited)
        .values({ traderId: trader.id, sectorId: h.to })
        .onConflictDoNothing()
        .run();
      if (h.wormhole) {
        tx.insert(schema.traderWormholes)
          .values({ traderId: trader.id, aSector: Math.min(from, h.to), bSector: Math.max(from, h.to) })
          .onConflictDoNothing()
          .run();
      }
      from = h.to;
    }

    for (const b of result.beats) {
      tx.insert(schema.events)
        .values({ traderId: trader.id, sectorId: b.sectorId, beat: b.beat, at: b.at, plugin: b.fact.plugin, fact: b.fact })
        .run();
    }
    // (transit modules never emit marketNudge — a personal price is station-scoped)

    if (arrived) {
      tx.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).run();
      if (world.galaxy.inhabited[dest] === 1) {
        // Arrival parks you AT ANCHOR, in your own ship — docking is a deliberate act
        // (the dock intent), so the autopilot never walks you onto the station.
        tx.insert(schema.dockSessions)
          .values({
            traderId: trader.id,
            kind: 'orbit',
            sectorId: dest,
            route: null,
            startedAt: result.arrivedAt!,
            settledAt: result.arrivedAt!,
            beatsResolved: 0,
            capsUsed: { credits: 0, standing: 0 },
            narrative: '',
            narratedThrough: 0,
            announced: 1, // only a docked stay earns the "made port" line
          })
          .run();
      }
    } else {
      tx.update(schema.dockSessions)
        .set({
          settledAt: result.newSettledAt,
          beatsResolved: result.newBeatsResolved,
          route: { ...route, leg: result.leg },
        })
        .where(eq(schema.dockSessions.traderId, trader.id))
        .run();
    }
  });

  const fresh = db.select().from(schema.traders).where(eq(schema.traders.id, trader.id)).get()!;
  const freshSession =
    db.select().from(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).get() ?? null;
  return { trader: fresh, session: freshSession, arrived };
}

// ── THE settle path ────────────────────────────────────────────────────────────

// The beats-and-position half of the settle (dock OR transit). settleTrader below wraps
// it and then works any open trade order — fills are energy-paced, not beat-paced, so
// they run on every settle, beats or none.
function settleTraderCore(world: World, trader: TraderRow, now = Date.now()): DockState {
  let session = db
    .select()
    .from(schema.dockSessions)
    .where(eq(schema.dockSessions.traderId, trader.id))
    .get() as DockSessionRow | undefined;

  // A course in flight settles first; landing chains into the dock settle below.
  if (session && session.kind === 'transit') {
    const t = settleTransitSession(world, trader, session, now);
    if (!t.arrived) return { session: t.session, settled: null, trader: t.trader };
    trader = t.trader;
    session = t.session ?? undefined;
    if (!session) return { session: null, settled: null, trader }; // course ended in the void
  }

  const sectorId = trader.currentSector;
  if (world.galaxy.inhabited[sectorId] !== 1) {
    // adrift in an empty sector — no station, no downtime; drop any stale dock session
    db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).run();
    return { session: null, settled: null, trader };
  }

  // Open (or reopen at a new world) lazily — AT ANCHOR. Docking is an intent (the dock
  // session is only ever created by POST /api/dock); turning up in an inhabited sector
  // just parks the ship in orbit. The goal lives on the trader, so nothing carries.
  if (!session || session.sectorId !== sectorId) {
    if (session) db.delete(schema.dockSessions).where(eq(schema.dockSessions.traderId, trader.id)).run();
    session = db
      .insert(schema.dockSessions)
      .values({
        traderId: trader.id,
        kind: 'orbit',
        sectorId,
        route: null,
        startedAt: now,
        settledAt: now,
        beatsResolved: 0,
        capsUsed: { credits: 0, standing: 0 },
        narrative: '',
        narratedThrough: 0,
        announced: 1, // only a docked stay earns the "made port" line
      })
      .returning()
      .get();
    return { session, settled: null, trader };
  }

  // The "made port" debounce (IRC): single jumps are silent, but a docked stay that
  // survives the threshold announces once — undock sooner and the channel hears nothing.
  const announceMs = getConfig('arrival_announce_minutes') * 60_000;
  if (session.kind === 'dock' && !session.announced && now - session.startedAt >= announceMs) {
    db.update(schema.dockSessions)
      .set({ announced: 1 })
      .where(eq(schema.dockSessions.traderId, trader.id))
      .run();
    logEvent(
      trader.id,
      sectorId,
      { plugin: 'course', outcome: 'made-port', summary: 'made port' },
      session.startedAt + announceMs, // nominal: when the stay "took", not when we noticed
    );
    session = { ...session, announced: 1 };
  }

  const seed = world.settings.seed;
  const g = world.galaxy;
  const rimT = g.maxD > 0 ? g.sdist[sectorId] / g.maxD : 0;
  const stationType = generateStation(seed, sectorId, rimT).stationType;
  const vibe = stationVibe(seed, sectorId, rimT, stationType);

  const ship = shipOf(trader);
  const { standing, flags } = stationStateOf(trader.id, sectorId, now);
  const stats: DockStats = {
    credits: trader.credits,
    standing,
    heat: currentHeat(trader, now),
    cargo: { ...ship.cargo },
    holdSize: ship.holdSize,
    flags,
  };

  const result = settleIdle({
    seed,
    traderId: trader.id,
    sectorId,
    vibe,
    tags: personaOf(trader).tags,
    session: {
      startedAt: session.startedAt,
      settledAt: session.settledAt,
      beatsResolved: session.beatsResolved,
      goal: goalOf(trader),
      capsUsed: (session.capsUsed as { credits: number; standing: number } | null) ?? {
        credits: 0,
        standing: 0,
      },
    },
    stats,
    conditions: conditionsOf(trader),
    // Orbit beats roll the ship-scoped pool; conditions tick either way (rest is rest).
    context: session.kind === 'orbit' ? 'orbit' : 'dock',
    flavor: sectorFlavorOf(world, sectorId),
    roster: rosterAt(sectorId, trader.id),
    cfg: idleCfg(),
    now,
  });

  if (result.beatsRun === 0) return { session, settled: null, trader };

  db.transaction((tx) => {
    tx.update(schema.traders)
      .set({
        credits: result.stats.credits,
        heat: result.stats.heat,
        heatUpdatedAt: now,
        conditions: result.conditions,
        ship: { holdSize: result.stats.holdSize, cargo: result.stats.cargo },
      })
      .where(eq(schema.traders.id, trader.id))
      .run();

    // Sparse local reputation: write only once it diverges (or a row already exists).
    const hasState = result.stats.standing !== 0 || Object.keys(result.stats.flags).length > 0;
    const existing = tx
      .select()
      .from(schema.traderStation)
      .where(and(eq(schema.traderStation.traderId, trader.id), eq(schema.traderStation.sectorId, sectorId)))
      .get();
    if (hasState || existing) {
      tx.insert(schema.traderStation)
        .values({
          traderId: trader.id,
          sectorId,
          standing: result.stats.standing,
          flags: result.stats.flags,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [schema.traderStation.traderId, schema.traderStation.sectorId],
          set: { standing: result.stats.standing, flags: result.stats.flags, updatedAt: now },
        })
        .run();
    }

    for (const n of result.nudges) {
      tx.insert(schema.marketNudge)
        .values({ traderId: trader.id, sectorId, commodity: n.commodity, factor: n.factor, expiresAt: n.expiresAt })
        .onConflictDoUpdate({
          target: [schema.marketNudge.traderId, schema.marketNudge.sectorId, schema.marketNudge.commodity],
          set: { factor: n.factor, expiresAt: n.expiresAt },
        })
        .run();
    }
    // prune anything long expired for this trader (cheap housekeeping)
    tx.delete(schema.marketNudge)
      .where(and(eq(schema.marketNudge.traderId, trader.id), lt(schema.marketNudge.expiresAt, now)))
      .run();

    for (const b of result.beats) {
      tx.insert(schema.events)
        .values({
          traderId: trader.id,
          sectorId,
          beat: b.beat,
          at: b.at,
          plugin: b.fact.plugin,
          fact: b.fact,
        })
        .run();
    }

    tx.update(schema.dockSessions)
      .set({
        settledAt: result.newSettledAt,
        beatsResolved: result.newBeatsResolved,
        capsUsed: result.capsUsed,
      })
      .where(eq(schema.dockSessions.traderId, trader.id))
      .run();
  });

  const fresh = db.select().from(schema.traders).where(eq(schema.traders.id, trader.id)).get()!;
  const freshSession = db
    .select()
    .from(schema.dockSessions)
    .where(eq(schema.dockSessions.traderId, trader.id))
    .get()!;
  return { session: freshSession, settled: result, trader: fresh };
}

// ── Trade orders (docs/0-Projects/trading.md — energy is the work clock) ──────

/** The live order as the UI shows it; nextFillAt/etaAt are regen projections. */
export interface OrderView {
  sectorId: number;
  side: 'buy' | 'sell';
  commodity: string;
  qty: number;
  filled: number;
  /** running average price per ton (0 until the first fill) */
  avg: number;
  limit: number | null;
  placedAt: number;
  nextFillAt: number | null;
  etaAt: number | null;
}

// Assemble the pure settle's input from the live rows; null when the order can't work
// here (no station / commodity not traded — both mean the order should be scrubbed).
function orderSettleInput(
  world: World,
  trader: TraderRow,
  order: TradeOrder,
  now: number,
): OrderSettleInput | null {
  const g = world.galaxy;
  if (g.inhabited[order.sectorId] !== 1) return null;
  const entry = effectiveMarket(baselineMarket(world, order.sectorId), trader, order.sectorId, now)
    .find((m) => m.id === order.commodity);
  if (!entry) return null;

  const rimT = g.maxD > 0 ? g.sdist[order.sectorId] / g.maxD : 0;
  const stationType = generateStation(world.settings.seed, order.sectorId, rimT).stationType;
  const conditions = conditionsOf(trader);
  const ship = shipOf(trader);
  return {
    seed: world.settings.seed,
    traderId: trader.id,
    order,
    price: { buy: entry.buy, sell: entry.sell },
    vibe: stationVibe(world.settings.seed, order.sectorId, rimT, stationType),
    tags: personaOf(trader).tags,
    standing: stationStateOf(trader.id, order.sectorId, now).standing,
    stats: { credits: trader.credits, cargo: { ...ship.cargo }, holdSize: ship.holdSize },
    energy: { value: trader.energy, updatedAt: trader.energyUpdatedAt },
    energyCfg: applyEnergyMods(DEFAULT_ENERGY, activeModifiers(conditions)),
    energyPerUnit: getConfig('trade_energy_per_unit'),
    retryMinutes: getConfig('idle_beat_minutes'),
    now,
  };
}

/** Scrub the open order (intent, or leaving the dock). Logs the cancel; returns it. */
export function cancelOrder(trader: TraderRow, now: number, summary?: string): TradeOrder | null {
  const order = orderOf(trader);
  if (!order) return null;
  db.update(schema.traders).set({ tradeOrder: null }).where(eq(schema.traders.id, trader.id)).run();
  logEvent(
    trader.id,
    order.sectorId,
    {
      plugin: 'trade',
      outcome: 'canceled',
      summary: summary ?? `scrubbed the ${order.side} order at ${order.filled} of ${order.qty}t`,
      numbers: { commodity: order.commodity, side: order.side, filled: order.filled, qty: order.qty },
      newsworthy: false,
    },
    now,
  );
  return order;
}

// Work the open order as far as elapsed time + the energy pool allow; persist fills,
// energy, and event rows in one transaction. Assumes the beat settle already ran.
function settleOrderFor(world: World, trader: TraderRow, now: number): TraderRow {
  const order = orderOf(trader);
  if (!order) return trader;

  // The ship is somewhere else, or the market can't serve it — the order is dead weight.
  if (order.sectorId !== trader.currentSector) {
    cancelOrder(trader, now, `left the dock with the ${order.side} order at ${order.filled} of ${order.qty}t`);
    return db.select().from(schema.traders).where(eq(schema.traders.id, trader.id)).get()!;
  }
  const input = orderSettleInput(world, trader, order, now);
  if (!input) {
    cancelOrder(trader, now);
    return db.select().from(schema.traders).where(eq(schema.traders.id, trader.id)).get()!;
  }

  const result = settleOrder(input);
  const moved =
    result.done ||
    result.beats.length > 0 ||
    result.order.attempts !== order.attempts ||
    result.order.settledAt !== order.settledAt;
  if (!moved) return trader;

  const ship = shipOf(trader);
  db.transaction((tx) => {
    tx.update(schema.traders)
      .set({
        credits: result.credits,
        ship: { holdSize: ship.holdSize, cargo: result.cargo },
        energy: result.energy.value,
        energyUpdatedAt: result.energy.updatedAt,
        tradeOrder: result.done ? null : result.order,
      })
      .where(eq(schema.traders.id, trader.id))
      .run();
    for (const b of result.beats) {
      tx.insert(schema.events)
        .values({
          traderId: trader.id,
          sectorId: order.sectorId,
          beat: b.beat,
          at: b.at,
          plugin: b.fact.plugin,
          fact: b.fact,
        })
        .run();
    }
  });
  return db.select().from(schema.traders).where(eq(schema.traders.id, trader.id)).get()!;
}

/** The open order + its regen projections, for the dock UI. Call settled. */
export function orderViewOf(world: World, trader: TraderRow, now: number): OrderView | null {
  const order = orderOf(trader);
  if (!order) return null;
  const input = orderSettleInput(world, trader, order, now);
  // Projection only — nothing should be left to elapse on a freshly settled trader.
  const proj = input ? settleOrder(input) : null;
  return {
    sectorId: order.sectorId,
    side: order.side,
    commodity: order.commodity,
    qty: order.qty,
    filled: order.filled,
    avg: order.filled > 0 ? Math.round(order.spent / order.filled) : 0,
    limit: order.limit ?? null,
    placedAt: order.placedAt,
    nextFillAt: proj?.nextFillAt ?? null,
    etaAt: proj?.etaAt ?? null,
  };
}

// Idempotent and cheap when nothing has elapsed; the player handlers, /me, and the IRC
// bot's tick all run through here, so every invariant holds once. Beats first (they can
// move prices and conditions), then the order works the dock with what's left of "now".
export function settleTrader(world: World, trader: TraderRow, now = Date.now()): DockState {
  const st = settleTraderCore(world, trader, now);
  // Orders only work while DOCKED — at anchor or under way they're dead weight, and every
  // departure intent scrubs them, so this cancel is just a defensive sweep for strays.
  if (st.session?.kind !== 'dock') {
    if (orderOf(st.trader)) {
      cancelOrder(st.trader, now);
      const fresh = db.select().from(schema.traders).where(eq(schema.traders.id, st.trader.id)).get()!;
      return { ...st, trader: fresh };
    }
    return st;
  }
  const fresh = settleOrderFor(world, st.trader, now);
  return fresh === st.trader ? st : { ...st, trader: fresh };
}
