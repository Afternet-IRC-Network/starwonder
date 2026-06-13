// Tiny shared helpers for module authors. Keep this thin — a module that needs more
// than a dice helper probably wants a new substrate lever (a reviewed core change).

import { COMMODITY_SPEC } from '../../sector-content';
import type { DockContext, EventFact } from '../types';

/** A uniformly random tradeable commodity id. */
export function randomCommodity(ctx: DockContext, salt: string): string {
  return COMMODITY_SPEC[Math.floor(ctx.rng(salt) * COMMODITY_SPEC.length)].id;
}

/** Display name for a commodity id ("electronics" → "Electronics"). */
export function commodityName(id: string): string {
  return COMMODITY_SPEC.find((c) => c.id === id)?.name ?? id;
}

/** An int in [lo, hi] from one roll. */
export function roll(ctx: DockContext, salt: string, lo: number, hi: number): number {
  return lo + Math.floor(ctx.rng(salt) * (hi - lo + 1));
}

// ── Line variants ──────────────────────────────────────────────────────────────
// Every outcome's prose gets several seeded phrasings, but line() must stay a pure
// function of the fact: roll ONE variant index at resolve time, store it in
// fact.numbers.v, and let both summary and line pick by modulo. Lists of different
// lengths share the one index fine.

/** Roll the beat's variant index (store it in fact.numbers.v). */
export function vIndex(ctx: DockContext, salt = 'variant'): number {
  return Math.floor(ctx.rng(salt) * 9973);
}

/** Pick a phrasing by a variant index rolled at resolve time. */
export function vpick<T>(v: number, arr: readonly T[]): T {
  return arr[Math.abs(Math.trunc(v)) % arr.length];
}

/** Pick a line() phrasing by the fact's stored variant index. */
export function vline(fact: EventFact, lines: readonly string[]): string {
  return vpick(Number(fact.numbers?.v ?? 0), lines);
}

/** Age of a station flag in ms at this beat (null = unset or no beat clock). */
export function flagAge(ctx: DockContext, flag: string): number | null {
  const set = ctx.stats.flags[flag];
  if (set === undefined || ctx.at === undefined) return null;
  return Math.max(0, ctx.at - set);
}
