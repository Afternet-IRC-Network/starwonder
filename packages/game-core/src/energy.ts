// Energy = a regenerating token pool (the turn economy). We never run a timer to refill
// it; instead we store {value, updatedAt} and compute the current value lazily on read.

export interface EnergyConfig {
  cap: number;
  /** seconds between regenerated ticks */
  perTickSeconds: number;
  /** energy gained per tick */
  amountPerTick: number;
}

// 1 energy / 6 min, cap 100 ⇒ a full pool regenerates in ~10h.
export const DEFAULT_ENERGY: EnergyConfig = {
  cap: 100,
  perTickSeconds: 360,
  amountPerTick: 1,
};

export interface EnergyState {
  value: number;
  /** epoch milliseconds of the last settled regen point */
  updatedAt: number;
}

// Current energy given elapsed wall-clock time. Advances updatedAt only by whole
// consumed ticks so fractional progress toward the next tick isn't discarded.
export function currentEnergy(
  s: EnergyState,
  cfg: EnergyConfig = DEFAULT_ENERGY,
  now: number = Date.now(),
): EnergyState {
  if (s.value >= cfg.cap) return { value: cfg.cap, updatedAt: now };
  const elapsed = Math.max(0, now - s.updatedAt);
  const tickMs = cfg.perTickSeconds * 1000;
  const ticks = Math.floor(elapsed / tickMs);
  if (ticks <= 0) return s;
  const value = Math.min(cfg.cap, s.value + ticks * cfg.amountPerTick);
  // once full, snap updatedAt to now; otherwise advance by the whole ticks we banked
  return { value, updatedAt: value >= cfg.cap ? now : s.updatedAt + ticks * tickMs };
}

// Returns the post-spend state, or null if there isn't enough energy.
export function spendEnergy(
  s: EnergyState,
  cost: number,
  cfg: EnergyConfig = DEFAULT_ENERGY,
  now: number = Date.now(),
): EnergyState | null {
  const cur = currentEnergy(s, cfg, now);
  if (cur.value < cost) return null;
  return { value: cur.value - cost, updatedAt: cur.updatedAt };
}
