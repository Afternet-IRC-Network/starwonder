/**
 * Procedural voxel-ship sprite — ported from d-modern-voxel.html `makeSprite`. A trader's
 * ship look is a pure function of its name: the hull mask is seeded from the name and the
 * hue is hashed from it too, so every player gets a distinct, stable little ship (same idea
 * as the planet/station renderers — appearance is computed, never stored).
 */
import { hashStr, mulberry32 } from './planet';

/** Stable hue (0..359) for a trader's ship, derived from its name. */
export function shipHue(seed: string): number {
  return hashStr(seed + '|hue') % 360;
}

/** Paint a mirror-symmetric voxel ship onto `canvas` (drawn at native pixel resolution). */
export function drawShip(canvas: HTMLCanvasElement, seed: string, hue: number): void {
  const rng = mulberry32(hashStr(seed + '|ship'));
  const N = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const half = Math.ceil(N / 2);
  ctx.clearRect(0, 0, N, N);
  const cols = [
    `hsl(${hue} 45% 32%)`,
    `hsl(${hue} 50% 48%)`,
    `hsl(${hue} 60% 66%)`,
    `hsl(${(hue + 30) % 360} 70% 70%)`,
  ];
  // Symmetric hull, tapered toward the nose/tail; brighter toward the centre column (faux
  // bevel), with a sprinkle of accent lights.
  for (let y = 2; y < N - 2; y++) {
    const edge = 1 + Math.floor(Math.abs(y - N / 2) / 2);
    for (let x = edge; x < half; x++) {
      if (rng() <= 0.32 + (x / half) * 0.25) continue;
      let ci = x < half - 2 ? 1 : 0;
      if (x === 0 || x === 1) ci = 2;
      if (rng() < 0.1) ci = 3;
      ctx.fillStyle = cols[ci];
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(N - 1 - x, y, 1, 1); // mirror
    }
  }
}
