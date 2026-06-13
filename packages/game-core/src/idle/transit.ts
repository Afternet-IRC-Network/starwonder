// settleTransit — the Energy trick applied to movement. A plotted course is a transit
// session flown GREEDILY: each hop fires at the earliest nominal moment its energy cost
// is affordable. With a banked pool that's "right now" — the ship sprints as far as the
// tank allows the instant the course is set — and once the pool runs dry the regen clock
// paces the rest (a lane hop every ~6 min at defaults; a pricey wormhole proportionally
// longer). Energy IS the speed limit; there is no separate hop cadence.
//
// Like settleIdle this is pure and replayable: the rng is keyed by hop index, not wall
// clock, and the server persists the result (position, energy, fog, events) in one
// transaction. Condition TICKS stay stationary-only (you rest docked or at anchor, never
// under way — that choice is the gameplay); condition MODIFIERS bite every hop via the
// move cost and the regen rate.

import { unit } from '../hash';
import { currentEnergy, spendEnergy, type EnergyConfig, type EnergyState } from '../energy';
import { moveCostWith, type Condition, type Modifiers } from '../conditions';
import type { DockContext, DockStats, Goal, SectorFlavor, StationVibe, TraitTag } from './types';
import {
  activeModifiers,
  applyDelta,
  DEFAULT_IDLE,
  type IdleConfig,
  type MarketNudge,
  type ResolvedBeat,
} from './settle';
import { TRANSIT_EVENTS } from './modules';

/** A plotted course. The trader sits at path[leg]; hop i runs path[i] → path[i+1]. */
export interface TransitRoute {
  path: number[];
  /** base energy cost of each hop (modifiers fold in per-hop, so mid-flight conditions bite) */
  costs: number[];
  /** whether each hop runs through a wormhole (recorded into trader_wormholes on land) */
  wormhole: boolean[];
  leg: number;
}

/** No station out here — transit events roll against a featureless mid-vibe. */
export const OPEN_SPACE: StationVibe = { lawfulness: 0.5, prosperity: 0.5, tension: 0.5 };

export interface TransitSettleInput {
  seed: string;
  traderId: number;
  route: TransitRoute;
  session: {
    startedAt: number;
    settledAt: number;
    /** hops flown so far (kept for bookkeeping/debug; the rng keys off the hop index) */
    beatsResolved: number;
    capsUsed: { credits: number; standing: number };
  };
  goal: Goal | null;
  tags: TraitTag[];
  /** standing/flags are station-scoped and ignored in transit — pass 0 / {} */
  stats: DockStats;
  conditions: Condition[];
  energy: EnergyState;
  energyCfg: EnergyConfig;
  /** local flavor lookup for the course's sectors (pure; the server closes over the
      galaxy) — events read the flavor of the leg they roll at */
  sectorFlavor?: (sectorId: number) => SectorFlavor;
  cfg?: IdleConfig;
  now?: number;
}

export interface TransitBeat extends ResolvedBeat {
  /** where on the course this happened (events carry their sector, unlike dock beats) */
  sectorId: number;
}

export interface TransitSettleResult {
  beatsRun: number;
  newSettledAt: number;
  newBeatsResolved: number;
  beats: TransitBeat[];
  /** hops landed this settle, in order — the server turns these into fog + position */
  hops: { to: number; wormhole: boolean }[];
  leg: number;
  /** nominal ms of the final hop when the course completed this settle; null = still flying */
  arrivedAt: number | null;
  /** when the NEXT hop's energy comes due (null once arrived) — drives "next jump" in the UI */
  nextHopAt: number | null;
  /** projected arrival assuming pure regen from here (null once arrived) */
  etaAt: number | null;
  energy: EnergyState;
  stats: DockStats;
  conditions: Condition[];
  nudges: MarketNudge[];
  capsUsed: { credits: number; standing: number };
}

// A hop can never cost more than the tank holds, or a course could strand forever (a
// condition shrinking the cap mid-flight, an over-span wormhole). The drive strains.
const hopCost = (base: number, mods: Modifiers, cfg: EnergyConfig): number =>
  Math.min(moveCostWith(base, mods), cfg.cap);

/** Earliest nominal time ≥ `from` at which `cost` energy is available. */
function readyAt(e: EnergyState, cost: number, cfg: EnergyConfig, from: number): number {
  const cur = currentEnergy(e, cfg, Math.max(from, e.updatedAt));
  if (cur.value >= cost) return Math.max(from, e.updatedAt);
  const ticks = Math.ceil((cost - cur.value) / cfg.amountPerTick);
  return cur.updatedAt + ticks * cfg.perTickSeconds * 1000;
}

/**
 * Pure flight projection for a course in progress: when the next hop's energy comes due
 * and the regen-paced arrival estimate. The view's companion to settleTransit — callable
 * any time without elapsing anything.
 */
export function transitSchedule(
  route: TransitRoute,
  energy: EnergyState,
  energyCfg: EnergyConfig,
  conditions: Condition[],
  now = Date.now(),
): { nextHopAt: number | null; etaAt: number | null } {
  if (route.leg >= route.path.length - 1) return { nextHopAt: null, etaAt: null };
  const mods = activeModifiers(conditions);
  let e = { ...energy };
  let t = now;
  let nextHopAt: number | null = null;
  for (let i = route.leg; i < route.path.length - 1; i++) {
    const cost = hopCost(route.costs[i], mods, energyCfg);
    t = readyAt(e, cost, energyCfg, t);
    e = spendEnergy(e, cost, energyCfg, t)!;
    if (nextHopAt === null) nextHopAt = t;
  }
  return { nextHopAt, etaAt: t };
}

export function settleTransit(input: TransitSettleInput): TransitSettleResult {
  const cfg = input.cfg ?? DEFAULT_IDLE;
  const now = input.now ?? Date.now();
  const path = input.route.path;

  // Work on copies — pure, like settleIdle.
  const stats: DockStats = {
    ...input.stats,
    cargo: { ...input.stats.cargo },
    flags: { ...input.stats.flags },
  };
  const conditions: Condition[] = input.conditions.map((c) => ({ ...c }));
  const capsUsed = { ...input.session.capsUsed };
  const nudges: MarketNudge[] = [];
  const beats: TransitBeat[] = [];
  const hops: { to: number; wormhole: boolean }[] = [];
  let energy = { ...input.energy };
  let leg = input.route.leg;
  let arrivedAt: number | null = null;
  // Facts stay monotonic even when a banked pool fires several hops "at once".
  let tCursor = Math.min(input.session.settledAt, now);

  while (leg < path.length - 1) {
    const cost = hopCost(input.route.costs[leg], activeModifiers(conditions), input.energyCfg);
    const tHop = readyAt(energy, cost, input.energyCfg, tCursor);
    if (tHop > now) break; // the drive is still charging — the regen clock paces the rest

    const hopIndex = leg; // rng keys off the hop's position on the course — replayable
    const spent = spendEnergy(energy, cost, input.energyCfg, tHop)!;
    energy = spent;
    hops.push({ to: path[leg + 1], wormhole: input.route.wormhole[leg] });
    leg++;
    tCursor = tHop;

    if (leg >= path.length - 1) {
      const jumps = path.length - 1;
      beats.push({
        beat: hopIndex,
        at: tHop,
        sectorId: path[leg],
        fact: {
          plugin: 'course',
          outcome: 'arrived',
          summary: `came out of the black after ${jumps} jump${jumps === 1 ? '' : 's'}`,
          numbers: { jumps },
          // Single hops are just getting around — the channel hears about REAL routes;
          // a settled stay is announced separately by the dock-session debounce.
          newsworthy: jumps >= 2,
        },
      });
      arrivedAt = tHop;
      break;
    }

    // One weighted transit event may roll per hop — quiet space is the norm.
    const rng = (salt: string): number =>
      unit(`${input.seed}|transit|${input.traderId}|${input.session.startedAt}|${hopIndex}|${salt}`);
    const ctx: DockContext = {
      ...input.sectorFlavor?.(path[leg]),
      rng,
      station: OPEN_SPACE,
      tags: input.tags,
      goal: input.goal,
      stats,
      conditions,
      context: 'transit',
      at: tHop,
    };
    const eligible = TRANSIT_EVENTS.filter((ev) => {
      try {
        return ev.eligible(ctx);
      } catch {
        return false;
      }
    });
    const weights = eligible.map((ev) => Math.max(0, ev.weight(ctx)));
    const quiet = Math.max(0.5, cfg.quietWeight);
    const total = quiet + weights.reduce((a, b) => a + b, 0);
    let x = rng('pick') * total - quiet;
    if (x < 0) continue; // open space, nothing but stars
    let picked = eligible[eligible.length - 1];
    for (let j = 0; j < eligible.length; j++) {
      if ((x -= weights[j]) < 0) {
        picked = eligible[j];
        break;
      }
    }
    const out = picked.resolve(ctx);
    for (const d of out.deltas) applyDelta(d, tHop, stats, conditions, nudges, capsUsed, cfg);
    beats.push({ beat: hopIndex, at: tHop, sectorId: path[leg], fact: out.fact });
  }

  // Project the rest of the flight on pure regen — the UI's "next jump" + ETA.
  const sched =
    arrivedAt === null
      ? transitSchedule({ ...input.route, leg }, energy, input.energyCfg, conditions, now)
      : { nextHopAt: null, etaAt: null };

  return {
    beatsRun: hops.length,
    newSettledAt: now,
    newBeatsResolved: input.session.beatsResolved + hops.length,
    beats,
    hops,
    leg,
    arrivedAt,
    nextHopAt: sched.nextHopAt,
    etaAt: sched.etaAt,
    energy,
    stats,
    conditions,
    nudges,
    capsUsed,
  };
}
