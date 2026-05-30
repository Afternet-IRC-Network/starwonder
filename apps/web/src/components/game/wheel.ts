/** Procedural wheel station renderer — ported verbatim from d-modern-voxel.html */

export interface WheelOpts {
  tilt: number;
  rings: [number, number][];
  spokes?: number;
  spokeOuter?: number;
  spokeInner?: number;
  spokeRot?: number;
  spokeW?: number;
  hub?: number;
  hue?: number;
  sat?: number;
  lightAng?: number;
  scale?: number;
  ox?: number;
  oy?: number;
  rot?: number;
}

function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  h /= 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function drawWheel(canvas: HTMLCanvasElement, o: WheelOpts): void {
  const N   = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(N, N);
  const cx  = (N - 1) / 2 + (o.ox ?? 0) * N;
  const cy  = (N - 1) / 2 + (o.oy ?? 0) * N;
  const Rx  = N * 0.46 * (o.scale ?? 1), Ry = Rx * o.tilt;
  const hue = o.hue ?? 208, sat = o.sat ?? 0.15, lightAng = o.lightAng ?? -2.2;
  const rot = o.rot ?? 0;

  function set(x: number, y: number, l: number) {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (y * N + x) * 4;
    const [r, g, b] = hsl2rgb(hue, sat, clamp(l, 0.08, 0.92));
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = x - cx, dy = y - cy;
      const ex = dx / Rx, ey = dy / Ry;
      const e  = Math.hypot(ex, ey);
      const ang = Math.atan2(dy, dx);
      let drawn = false, l = 0;

      for (const [os, w] of o.rings) {
        if (e <= os && e >= os - w) {
          const depth = dy > 0 ? 1 : 0.58;
          l = Math.max(l, 0.30 + 0.58 * (0.5 + 0.5 * Math.cos(ang - lightAng)) * depth);
          drawn = true;
        }
      }

      if (o.spokes) {
        const oi = o.spokeOuter ?? 0.99;
        if (e < oi && e > (o.spokeInner ?? 0)) {
          for (let s = 0; s < o.spokes; s++) {
            const sa   = s * Math.PI * 2 / o.spokes + (o.spokeRot ?? 0.4) + rot;
            const proj = ex * Math.cos(sa) + ey * Math.sin(sa);
            const perp = -ex * Math.sin(sa) + ey * Math.cos(sa);
            if (proj > 0 && Math.abs(perp) < (o.spokeW ?? 0.06)) {
              l = Math.max(l, 0.42); drawn = true; break;
            }
          }
        }
      }

      if (o.hub && Math.hypot(ex, ey) <= o.hub) {
        l = 0.52 + 0.36 * ((cx - dx) / N); drawn = true;
      }

      if (drawn) set(x, y, l);
    }
  }

  ctx.putImageData(img, 0, 0);
}
