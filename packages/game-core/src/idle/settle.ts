// settleIdle — the one pure entry point of the idle sim. Mirrors currentEnergy: no loop
// runs while you're away; elapsed time IS the clock, replayed (bounded) on the next
// interaction. Beats are SEQUENTIAL — beat 7 sees the credits beat 3 took — so a session
// is a fold over an in-memory snapshot; the server persists only the summed result in one
// transaction. Deterministic & replayable: the rng key includes the session start, so
// re-docking never replays the same script.

import { unit } from '../hash';
import { foldModifiers, type Condition, type Modifiers } from '../conditions';
import type {
  DockContext,
  DockStats,
  EventFact,
  Goal,
  SectorFlavor,
  StatDelta,
  StationVibe,
  TraitTag,
} from './types';
import { CONDITION_DEFS, DOCK_EVENTS, ORBIT_EVENTS } from './modules';

export interface IdleConfig {
  /** docked minutes per idle beat */
  beatMinutes: number;
  /** max beats settled in one catch-up (anti-FOMO backlog bound) */
  beatCap: number;
  /** base weight of the "nothing happened" no-op, scaled down by station tension */
  quietWeight: number;
  /** per-session net credit-swing rail */
  creditCap: number;
  /** per-session net standing-swing rail */
  standingCap: number;
}

// quietWeight is tuned so a tense station runs ~25-30% eventful beats (≈4 events
// overnight at 30-min beats) and a sleepy core station roughly half that.
export const DEFAULT_IDLE: IdleConfig = {
  beatMinutes: 30,
  beatCap: 16,
  quietWeight: 30,
  creditCap: 600,
  standingCap: 8,
};

export interface IdleSessionState {
  startedAt: number;
  settledAt: number;
  beatsResolved: number;
  goal: Goal | null;
  capsUsed: { credits: number; standing: number };
}

export interface ResolvedBeat {
  beat: number;
  /** NOMINAL time: startedAt + beat·interval — never settlement wall-clock */
  at: number;
  fact: EventFact;
}

export interface MarketNudge {
  commodity: string;
  factor: number;
  expiresAt: number;
}

export interface SettleResult {
  beatsRun: number;
  newSettledAt: number;
  newBeatsResolved: number;
  /** non-quiet beats, in order — these become `events` rows */
  beats: ResolvedBeat[];
  /** final snapshots, ready to persist */
  stats: DockStats;
  conditions: Condition[];
  nudges: MarketNudge[];
  capsUsed: { credits: number; standing: number };
}

export interface SettleInput {
  seed: string;
  traderId: number;
  sectorId: number;
  vibe: StationVibe;
  tags: TraitTag[];
  session: IdleSessionState;
  stats: DockStats;
  conditions: Condition[];
  /** which stationary pool the beats roll against (default 'dock'). 'orbit' = at anchor
      in your own ship above the world — conditions still tick (rest is rest), but the
      events are ship-scoped, not dockside. */
  context?: 'dock' | 'orbit';
  /** local flavor of this sector (world class, danger tier, rimT, station type) —
      lets modules gate like the world generators do */
  flavor?: SectorFlavor;
  /** names of OTHER traders parked here right now (presence-aware beats) */
  roster?: string[];
  cfg?: IdleConfig;
  now?: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Fold the active conditions' passive modifiers into one clamped struct. */
export function activeModifiers(conditions: Condition[]): Modifiers {
  return foldModifiers(
    conditions.map((c) => CONDITION_DEFS[c.id]?.modifiers(c) ?? {}),
  );
}

// Apply one delta to the in-memory snapshot, respecting the session rails. Mutates
// stats/conditions/nudges in place; truncated deltas still keep their fact (the story
// can sting a little harder than the wallet). Shared with the transit settle.
export function applyDelta(
  d: StatDelta,
  at: number,
  stats: DockStats,
  conditions: Condition[],
  nudges: MarketNudge[],
  capsUsed: { credits: number; standing: number },
  cfg: IdleConfig,
): void {
  switch (d.kind) {
    case 'credits': {
      const room = cfg.creditCap - capsUsed.credits;
      let dd = clamp(d.d, -room, room);
      if (dd < 0) dd = -Math.min(-dd, stats.credits); // never below zero
      stats.credits += dd;
      capsUsed.credits += Math.abs(dd);
      break;
    }
    case 'standing': {
      const room = cfg.standingCap - capsUsed.standing;
      const dd = clamp(d.d, -room, room);
      stats.standing = clamp(stats.standing + dd, -10, 10);
      capsUsed.standing += Math.abs(dd);
      break;
    }
    case 'heat':
      stats.heat = clamp(stats.heat + d.d, 0, 10);
      break;
    case 'cargo': {
      if (d.d > 0) {
        const used = Object.values(stats.cargo).reduce((a, b) => a + b, 0);
        const dd = Math.min(d.d, Math.max(0, stats.holdSize - used));
        if (dd > 0) stats.cargo[d.commodity] = (stats.cargo[d.commodity] ?? 0) + dd;
      } else {
        const have = stats.cargo[d.commodity] ?? 0;
        const left = Math.max(0, have + d.d);
        if (left > 0) stats.cargo[d.commodity] = left;
        else delete stats.cargo[d.commodity];
      }
      break;
    }
    case 'marketNudge': {
      const factor = clamp(d.factor, 0.5, 2);
      const expiresAt = at + d.hours * 3_600_000;
      const i = nudges.findIndex((n) => n.commodity === d.commodity);
      if (i >= 0) nudges[i] = { commodity: d.commodity, factor, expiresAt };
      else nudges.push({ commodity: d.commodity, factor, expiresAt });
      break;
    }
    case 'flag':
      if (d.clear) delete stats.flags[d.flag];
      else stats.flags[d.flag] = at;
      break;
    case 'condition':
      if (d.clear) {
        const i = conditions.findIndex((c) => c.id === d.clear);
        if (i >= 0) conditions.splice(i, 1);
      }
      if (d.add && !conditions.some((c) => c.id === d.add!.id)) {
        conditions.push({ id: d.add.id, since: at, data: d.add.data });
      }
      break;
  }
}

export function settleIdle(input: SettleInput): SettleResult {
  const cfg = input.cfg ?? DEFAULT_IDLE;
  const now = input.now ?? Date.now();
  const context = input.context ?? 'dock';
  const pool = context === 'orbit' ? ORBIT_EVENTS : DOCK_EVENTS;
  const beatMs = cfg.beatMinutes * 60_000;

  const elapsed = Math.max(0, now - input.session.settledAt);
  const beatsRun = Math.min(Math.floor(elapsed / beatMs), cfg.beatCap);

  // Work on copies — settleIdle is pure; the caller persists the result.
  const stats: DockStats = {
    ...input.stats,
    cargo: { ...input.stats.cargo },
    flags: { ...input.stats.flags },
  };
  const conditions: Condition[] = input.conditions.map((c) => ({ ...c }));
  const capsUsed = { ...input.session.capsUsed };
  const nudges: MarketNudge[] = [];
  const beats: ResolvedBeat[] = [];

  for (let i = 0; i < beatsRun; i++) {
    const beat = input.session.beatsResolved + i;
    const at = input.session.settledAt + (i + 1) * beatMs;
    const rng = (salt: string): number =>
      unit(
        `${input.seed}|idle|${input.traderId}|${input.sectorId}|${input.session.startedAt}|${beat}|${salt}`,
      );
    const ctx: DockContext = {
      ...input.flavor,
      rng,
      station: input.vibe,
      tags: input.tags,
      goal: input.session.goal,
      stats,
      conditions,
      context,
      at,
      roster: input.roster,
    };

    // 1. Conditions live their lives first (recovery rolls, worsening…).
    for (const cond of [...conditions]) {
      const def = CONDITION_DEFS[cond.id];
      if (!def || def.permanent) continue;
      const out = def.tick(cond, {
        ...ctx,
        rng: (salt) => rng(`${cond.id}|${salt}`),
      });
      if (out) {
        for (const d of out.deltas) applyDelta(d, at, stats, conditions, nudges, capsUsed, cfg);
        beats.push({ beat, at, fact: out.fact });
      }
    }

    // 2. Then one weighted event rolls — quiet stretches are the (heavily weighted) norm.
    const eligible = pool.filter((e) => {
      try {
        return e.eligible(ctx);
      } catch {
        return false;
      }
    });
    const weights = eligible.map((e) => Math.max(0, e.weight(ctx)));
    const quiet = Math.max(0.5, cfg.quietWeight * (1.4 - input.vibe.tension * 0.8));
    const total = quiet + weights.reduce((a, b) => a + b, 0);
    let x = rng('pick') * total - quiet;
    if (x < 0) continue; // a quiet stretch — the story breathes
    let picked = eligible[eligible.length - 1];
    for (let j = 0; j < eligible.length; j++) {
      if ((x -= weights[j]) < 0) {
        picked = eligible[j];
        break;
      }
    }
    const out = picked.resolve(ctx);
    for (const d of out.deltas) applyDelta(d, at, stats, conditions, nudges, capsUsed, cfg);
    beats.push({ beat, at, fact: out.fact });
  }

  return {
    beatsRun,
    newSettledAt: input.session.settledAt + beatsRun * beatMs,
    newBeatsResolved: input.session.beatsResolved + beatsRun,
    beats,
    stats,
    conditions,
    nudges,
    capsUsed,
  };
}
