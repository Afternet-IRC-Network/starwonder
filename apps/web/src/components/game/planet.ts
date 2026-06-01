/**
 * Shared procedural pixel/voxel-planet renderer — ported from d-modern-voxel.html.
 *
 * Used by both the star viewport (one big planet) and the star chart map (many tiny
 * cached sprites). Seed a planet with `addr(id)` ("Sector #N") and its server-provided
 * `palette`/`spin` so the same world looks identical wherever it's drawn.
 */

export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Palette ramps keyed by PlanetPalette (game-core `PlanetPalette`): low → high elevation.
export const PALETTES: Record<string, number[][]> = {
  ocean: [[16,34,86],[24,64,140],[36,120,168],[58,158,150],[120,180,110],[210,216,190]],
  lava:  [[40,12,12],[96,22,18],[170,52,24],[224,110,36],[250,196,90],[255,238,170]],
  ice:   [[24,40,70],[44,78,120],[96,150,190],[150,200,224],[210,232,244],[245,250,255]],
  arid:  [[48,30,18],[96,60,30],[150,100,52],[196,150,86],[222,190,130],[244,228,186]],
  rock:  [[26,26,30],[52,52,58],[84,84,92],[120,120,128],[158,158,164],[198,198,202]],
  gas:   [[60,38,22],[122,80,40],[178,128,72],[214,176,120],[200,140,96],[238,222,190]],
};

/**
 * Build a planet renderer for a canvas: returns `frame(spin)` which paints the sphere at
 * the given longitude offset. Terrain bands are seeded from `seedStr`; lighting is fixed
 * in view space.
 */
export function makePlanet(
  canvas: HTMLCanvasElement,
  seedStr: string,
  palette: string,
): (spin: number) => void {
  const rng = mulberry32(hashStr(seedStr + '|planet'));
  const N   = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const R   = N / 2 - 1, cx = N / 2, cy = N / 2;
  const pal = PALETTES[palette] ?? PALETTES.ocean;
  const bands: { fx: number; fy: number; ph: number; a: number }[] = [];
  for (let i = 0; i < 4; i++)
    bands.push({ fx: 1 + rng() * 4, fy: 1 + rng() * 4, ph: rng() * 6.283, a: 0.5 + rng() });
  const bayer = [[0, 2], [3, 1]];
  const lx = -0.55, ly = -0.5, lz = 0.66;

  return function frame(spin: number) {
    const img = ctx.createImageData(N, N);
    for (let py = 0; py < N; py++) {
      for (let px = 0; px < N; px++) {
        const x = (px - cx) / R, y = (py - cy) / R;
        const r2 = x * x + y * y;
        const idx = (py * N + px) * 4;
        if (r2 > 1) { img.data[idx + 3] = 0; continue; }
        const z   = Math.sqrt(1 - r2);
        const lat = Math.asin(Math.max(-1, Math.min(1, y)));
        const lon = Math.atan2(x, z) + spin;
        let t = 0, amp = 0;
        for (const b of bands) { t += b.a * Math.sin(b.fx * lon + b.fy * lat + b.ph); amp += b.a; }
        t = (t / amp + 1) / 2;
        const L = Math.max(0.06, x * lx + y * ly + z * lz);
        const f = t * (pal.length - 1) * 0.72 + L * (pal.length - 1) * 0.55
                + (bayer[py & 1][px & 1] / 4 - 0.5);
        const pi = Math.max(0, Math.min(pal.length - 1, Math.round(f)));
        const [r, g, bl] = pal[pi];
        const lit = 0.4 + L * 0.8;
        img.data[idx]     = Math.min(255, r  * lit);
        img.data[idx + 1] = Math.min(255, g  * lit);
        img.data[idx + 2] = Math.min(255, bl * lit);
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };
}

// Cached small static sprites for the map — keyed by (seed, palette, size, spin) so each
// world is rendered once and reused across redraws/pans.
const spriteCache = new Map<string, HTMLCanvasElement>();

export function planetSprite(
  seedStr: string,
  palette: string,
  size: number,
  spin: number,
): HTMLCanvasElement {
  const key = `${seedStr}|${palette}|${size}|${spin.toFixed(3)}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  makePlanet(cv, seedStr, palette)(spin);
  spriteCache.set(key, cv);
  return cv;
}
