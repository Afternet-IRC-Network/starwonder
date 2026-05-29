export type DangerTier = 'peaceful' | 'medium' | 'dangerous' | 'very-dangerous';

// Danger rises with distance from Sol but on a curve: the inner ~third stays calm,
// then it climbs steeply toward the rim. t = normalised crow-flies distance from Sol
// (0 = core, 1 = rim).
export function dangerCurve(t: number): number {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.pow(t, 1.7);
}

// Bucketed tiers: Peaceful (inner 1/3) -> Medium (middle 1/3) -> Dangerous (next 1/6)
// -> Very dangerous (outer 1/6).
export function dangerTier(t: number): DangerTier {
  if (t < 1 / 3) return 'peaceful';
  if (t < 2 / 3) return 'medium';
  if (t < 5 / 6) return 'dangerous';
  return 'very-dangerous';
}
