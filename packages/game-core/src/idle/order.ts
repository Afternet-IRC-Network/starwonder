// settleOrder — the Energy trick applied to commerce. A trade order is the commercial
// twin of a plotted course: a quantity broken into seeded 1-4 ton chunks, filled GREEDILY
// — each haggle attempt fires at the earliest nominal moment its chunk's energy cost is
// affordable. A banked pool sprints the whole order on the spot (placing an order rested
// feels like a live trade); broke, the regen clock paces the fills. Energy IS the work
// clock; there is no separate fill cadence.
//
// Pure and replayable like settleTransit: the rng is keyed by the order's placedAt + the
// attempt index, never wall clock. Fills are EXCHANGES, not windfalls — they move credits
// and cargo directly and are deliberately outside the idle session's creditCap rail.

import { unit } from '../hash';
import { currentEnergy, spendEnergy, type EnergyConfig, type EnergyState } from '../energy';
import { commodityName } from './modules/util';
import type { ResolvedBeat } from './settle';
import type { EventFact, StationVibe, TraitTag } from './types';

/** Lowercased display name for summaries ("medical supplies", not "medical"). */
const goods = (id: string): string => commodityName(id).toLowerCase();

/** One open order per trader; station-scoped (leaving the dock scrubs it). */
export interface TradeOrder {
  sectorId: number;
  side: 'buy' | 'sell';
  commodity: string;
  qty: number;
  /** units done so far */
  filled: number;
  /** credits moved so far (paid when buying, earned when selling) — avg = spent/filled */
  spent: number;
  /** optional per-unit price rail: ceiling when buying, floor when selling */
  limit?: number;
  placedAt: number;
  /** the fill clock cursor: no attempt fires before this time */
  settledAt: number;
  /** haggle attempts resolved so far (the deterministic rng index; counts no-deals) */
  attempts: number;
}

/** Why an order stopped working. 'filled' is the payoff; the rest close it short. */
export type OrderOutcome = 'filled' | 'hold-full' | 'broke' | 'sold-out';

export interface OrderSettleInput {
  seed: string;
  traderId: number;
  order: TradeOrder;
  /** the trader's EFFECTIVE per-unit prices here (nudges + condition factors folded in) */
  price: { buy: number; sell: number };
  vibe: StationVibe;
  tags: TraitTag[];
  /** standing at this station (-10..10) — a known face haggles better */
  standing: number;
  stats: { credits: number; cargo: Record<string, number>; holdSize: number };
  energy: EnergyState;
  energyCfg: EnergyConfig;
  /** energy per ton moved (config trade_energy_per_unit) */
  energyPerUnit: number;
  /** minutes until the next attempt after a no-deal (reuses idle_beat_minutes) */
  retryMinutes: number;
  now?: number;
}

export interface OrderSettleResult {
  /** the updated order (persist when !done; drop the row's blob when done) */
  order: TradeOrder;
  done: boolean;
  outcome: OrderOutcome | null;
  /** fills, no-deals, and the closing fact — these become `events` rows */
  beats: ResolvedBeat[];
  credits: number;
  cargo: Record<string, number>;
  energy: EnergyState;
  /** when the next FILL lands assuming pure regen (null once done) */
  nextFillAt: number | null;
  /** projected completion (null once done, or when the limit looks unreachable) */
  etaAt: number | null;
}

/** Haggle swing: each chunk prices at market × (1 ± this). */
const HAGGLE_SWING = 0.12;
/** Projection lookahead guard — past this many attempts the limit is "unreachable". */
const PROJECT_CAP = 300;

/** Earliest nominal time ≥ `from` at which `cost` energy is available. */
function readyAt(e: EnergyState, cost: number, cfg: EnergyConfig, from: number): number {
  const cur = currentEnergy(e, cfg, Math.max(from, e.updatedAt));
  if (cur.value >= cost) return Math.max(from, e.updatedAt);
  const ticks = Math.ceil((cost - cur.value) / cfg.amountPerTick);
  return cur.updatedAt + ticks * cfg.perTickSeconds * 1000;
}

interface LoopState {
  order: TradeOrder;
  credits: number;
  cargo: Record<string, number>;
  energy: EnergyState;
  done: boolean;
  outcome: OrderOutcome | null;
}

// One haggle attempt: compute when it fires and what happens. Mutates `s` only when the
// attempt lands at or before `horizon`; returns the beat (if any) or 'future' when the
// attempt is still ahead of the horizon.
function attempt(
  input: OrderSettleInput,
  s: LoopState,
  horizon: number,
): { at: number; fact: EventFact | null } | 'future' {
  const o = s.order;
  const i = o.attempts;
  const rng = (salt: string): number =>
    unit(`${input.seed}|trade|${input.traderId}|${o.placedAt}|${i}|${salt}`);

  const remaining = o.qty - o.filled;
  if (remaining <= 0) {
    // defensive: a fully-filled order should already be closed
    s.done = true;
    s.outcome = 'filled';
    return { at: Math.min(o.settledAt, horizon), fact: null };
  }
  let units = 1 + Math.floor(rng('units') * 4); // 1..4 tons per chunk
  units = Math.min(units, remaining);

  // A known face, a silver tongue, or the right kind of friends tilt the table.
  const edge =
    (Math.max(-10, Math.min(10, input.standing)) / 10) * 0.04 +
    (input.tags.includes('charming') ? 0.03 : 0) +
    (input.tags.includes('shady') && input.vibe.lawfulness < 0.4 ? 0.02 : 0);
  const swing = HAGGLE_SWING * (2 * rng('haggle') - 1);
  const base = o.side === 'buy' ? input.price.buy : input.price.sell;
  const sign = o.side === 'buy' ? -1 : 1; // your edge lowers buys, raises sells
  const price = Math.max(1, Math.round(base * (1 + swing + sign * edge)));

  // Hard stops close the order short — checked before energy so a stuck order
  // never waits on a fill that can't happen.
  if (o.side === 'buy') {
    const used = Object.values(s.cargo).reduce((a, b) => a + b, 0);
    const room = input.stats.holdSize - used;
    if (room <= 0) {
      s.done = true;
      s.outcome = 'hold-full';
      return { at: Math.min(o.settledAt, horizon), fact: null };
    }
    if (Math.floor(s.credits / price) <= 0) {
      s.done = true;
      s.outcome = 'broke';
      return { at: Math.min(o.settledAt, horizon), fact: null };
    }
    units = Math.min(units, room, Math.floor(s.credits / price));
  } else {
    const have = s.cargo[o.commodity] ?? 0;
    if (have <= 0) {
      s.done = true;
      s.outcome = 'sold-out';
      return { at: Math.min(o.settledAt, horizon), fact: null };
    }
    units = Math.min(units, have);
  }

  const cost = Math.min(Math.max(1, Math.round(units * input.energyPerUnit)), input.energyCfg.cap);
  const tFire = readyAt(s.energy, cost, input.energyCfg, o.settledAt);
  if (tFire > horizon) return 'future';

  // Outside the limit ⇒ no deal: no energy spent, try again after a beat.
  const missesLimit =
    o.limit !== undefined && (o.side === 'buy' ? price > o.limit : price < o.limit);
  if (missesLimit) {
    o.attempts = i + 1;
    o.settledAt = tFire + input.retryMinutes * 60_000;
    return {
      at: tFire,
      fact: {
        plugin: 'trade',
        outcome: 'no-deal',
        summary: `held out on ${goods(o.commodity)} — the offers were outside the limit`,
        numbers: { commodity: o.commodity, side: o.side, price, limit: o.limit! },
        newsworthy: false,
      },
    };
  }

  // The fill: cargo and credits move together, energy pays for the legwork.
  s.energy = spendEnergy(s.energy, cost, input.energyCfg, tFire)!;
  const total = units * price;
  if (o.side === 'buy') {
    s.credits -= total;
    s.cargo[o.commodity] = (s.cargo[o.commodity] ?? 0) + units;
  } else {
    s.credits += total;
    const left = (s.cargo[o.commodity] ?? 0) - units;
    if (left > 0) s.cargo[o.commodity] = left;
    else delete s.cargo[o.commodity];
  }
  o.filled += units;
  o.spent += total;
  o.attempts = i + 1;
  o.settledAt = tFire;
  if (o.filled >= o.qty) {
    s.done = true;
    s.outcome = 'filled';
  }
  return {
    at: tFire,
    fact: {
      plugin: 'trade',
      outcome: 'fill',
      summary:
        o.side === 'buy'
          ? `took on ${units}t of ${goods(o.commodity)} at ${price} cr`
          : `moved ${units}t of ${goods(o.commodity)} at ${price} cr`,
      numbers: { commodity: o.commodity, side: o.side, units, price, filled: o.filled, qty: o.qty },
      newsworthy: false,
    },
  };
}

/** The closing fact for a finished order — completion is the newsworthy moment. */
function closingFact(o: TradeOrder, outcome: OrderOutcome): EventFact {
  const avg = o.filled > 0 ? Math.round(o.spent / o.filled) : 0;
  const numbers = {
    commodity: o.commodity,
    side: o.side,
    qty: o.qty,
    filled: o.filled,
    avg,
    reason: outcome,
  };
  if (outcome === 'filled') {
    return {
      plugin: 'trade',
      outcome: 'filled',
      summary: `closed out a ${o.side} order: ${o.qty}t of ${goods(o.commodity)} at ~${avg} cr`,
      numbers,
      newsworthy: true,
    };
  }
  const why =
    outcome === 'hold-full'
      ? 'the hold is full'
      : outcome === 'broke'
        ? 'the credits ran dry'
        : 'nothing left to sell';
  return {
    plugin: 'trade',
    outcome: 'closed',
    summary: `closed a ${o.side} order for ${goods(o.commodity)} short at ${o.filled} of ${o.qty}t — ${why}`,
    numbers,
    newsworthy: false,
  };
}

export function settleOrder(input: OrderSettleInput): OrderSettleResult {
  const now = input.now ?? Date.now();

  // Work on copies — pure, like settleIdle/settleTransit.
  const s: LoopState = {
    order: { ...input.order },
    credits: input.stats.credits,
    cargo: { ...input.stats.cargo },
    energy: { ...input.energy },
    done: false,
    outcome: null,
  };
  const beats: ResolvedBeat[] = [];

  while (!s.done) {
    const out = attempt(input, s, now);
    if (out === 'future') break; // the next chunk's energy is still charging
    if (out.fact) beats.push({ beat: s.order.attempts - 1, at: out.at, fact: out.fact });
    if (s.done) beats.push({ beat: s.order.attempts, at: out.at, fact: closingFact(s.order, s.outcome!) });
  }

  // Project the rest on pure regen — the order card's "next fill" + ETA. The future is
  // deterministic from here (same rng stream), so we just keep running the loop on a
  // throwaway copy with no horizon, bounded by PROJECT_CAP attempts.
  let nextFillAt: number | null = null;
  let etaAt: number | null = null;
  if (!s.done) {
    const p: LoopState = {
      order: { ...s.order },
      credits: s.credits,
      cargo: { ...s.cargo },
      energy: { ...s.energy },
      done: false,
      outcome: null,
    };
    const guard = p.order.attempts + PROJECT_CAP;
    let last = now;
    while (!p.done && p.order.attempts < guard) {
      const out = attempt(input, p, Number.MAX_SAFE_INTEGER);
      if (out === 'future') break; // unreachable, but keeps the loop honest
      last = out.at;
      if (out.fact?.outcome === 'fill' && nextFillAt === null && out.at > now) nextFillAt = out.at;
    }
    if (p.done) etaAt = last;
  }

  return {
    order: s.order,
    done: s.done,
    outcome: s.outcome,
    beats,
    credits: s.credits,
    cargo: s.cargo,
    energy: s.energy,
    nextFillAt,
    etaAt,
  };
}
