// Conditions — ongoing trader states ("measles", "injured", "ship-cat") with a lifetime.
// A condition never patches core systems; it WARPS THEIR INPUTS via a bounded, typed
// Modifiers struct that call sites fold in (currentEnergy cfg, move cost, market prices).
// Definitions (label / modifiers / tick) live in idle/modules — this file is just the
// substrate: the type, the fold, and the clamps. The struct is the module-author API
// contract; new levers are added HERE, in a reviewed core change, never ad hoc.

import type { EnergyConfig } from './energy';

export interface Condition {
  id: string;
  /** epoch ms when it was acquired (nominal beat time) */
  since: number;
  data?: Record<string, number>;
}

export interface Modifiers {
  /** × on energy regen rate (default 1). Clamped 0.25..1.5 — sickness slows you, never bricks you. */
  energyRegenFactor: number;
  /** + on the energy cap (default 0). Clamped -50..+50. */
  energyCapDelta: number;
  /** + on every move's energy cost (default 0). Clamped 0..+5 per fold; final cost floors at 1. */
  moveEnergyCostDelta: number;
  /** × on a commodity's prices at any station (default 1 each). Clamped 0.5..2. */
  priceFactor: Record<string, number>;
}

export const NEUTRAL_MODIFIERS: Modifiers = {
  energyRegenFactor: 1,
  energyCapDelta: 0,
  moveEnergyCostDelta: 0,
  priceFactor: {},
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Fold partial modifier sets (one per active condition) into one clamped struct. */
export function foldModifiers(parts: Partial<Modifiers>[]): Modifiers {
  let regen = 1;
  let cap = 0;
  let move = 0;
  const price: Record<string, number> = {};
  for (const p of parts) {
    if (p.energyRegenFactor !== undefined) regen *= p.energyRegenFactor;
    if (p.energyCapDelta) cap += p.energyCapDelta;
    if (p.moveEnergyCostDelta) move += p.moveEnergyCostDelta;
    if (p.priceFactor) {
      for (const [c, f] of Object.entries(p.priceFactor)) price[c] = (price[c] ?? 1) * f;
    }
  }
  for (const c of Object.keys(price)) price[c] = clamp(price[c], 0.5, 2);
  return {
    energyRegenFactor: clamp(regen, 0.25, 1.5),
    energyCapDelta: clamp(cap, -50, 50),
    moveEnergyCostDelta: clamp(move, 0, 5),
    priceFactor: price,
  };
}

/** The energy config as this trader experiences it — regen factor stretches the tick interval. */
export function applyEnergyMods(base: EnergyConfig, mods: Modifiers): EnergyConfig {
  return {
    cap: Math.max(10, base.cap + mods.energyCapDelta),
    perTickSeconds: Math.round(base.perTickSeconds / mods.energyRegenFactor),
    amountPerTick: base.amountPerTick,
  };
}

/** A move's energy cost as this trader experiences it. */
export function moveCostWith(base: number, mods: Modifiers): number {
  return Math.max(1, base + mods.moveEnergyCostDelta);
}
