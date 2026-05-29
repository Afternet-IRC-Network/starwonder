// Order-5 Hilbert galaxy laid out as a centred-Sol pinwheel. See
// docs/2-Resources/fractal-galaxy-map.md for the full rationale.

export const SIDE = 32;
export const N = SIDE * SIDE; // 1024 sectors

// Hilbert d -> (x, y) for a curve of side n (n a power of two).
function d2xy(n: number, d: number): [number, number] {
  let rx: number, ry: number, t = d, x = 0, y = 0;
  for (let s = 1; s < n; s *= 2) {
    rx = 1 & (t / 2);
    ry = 1 & (t ^ rx);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      const tmp = x;
      x = y;
      y = tmp;
    }
    x += s * rx;
    y += s * ry;
    t = Math.floor(t / 4);
  }
  return [x, y];
}

export interface Layout {
  /** sector id -> grid coords */
  xy: { x: number; y: number }[];
  /** grid index (y * SIDE + x) -> sector id */
  d: Int32Array;
}

// PINWHEEL: four order-4 Hilbert curves, one per quadrant, all anchored at the centre
// so Sol (#0) lands dead-centre and each quadrant stays a self-similar Hilbert region.
export function buildPinwheel(): Layout {
  const H = SIDE / 2;
  const place: Array<(lx: number, ly: number) => [number, number]> = [
    (lx, ly) => [H + lx, H + ly],
    (lx, ly) => [H - 1 - lx, H + ly],
    (lx, ly) => [H - 1 - lx, H - 1 - ly],
    (lx, ly) => [H + lx, H - 1 - ly],
  ];
  const xy = new Array<{ x: number; y: number }>(N);
  const d = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const q = i >> 8;
    const local = i & 255;
    const [lx, ly] = d2xy(H, local);
    const [x, y] = place[q](lx, ly);
    xy[i] = { x, y };
    d[y * SIDE + x] = i;
  }
  return { xy, d };
}

let cached: Layout | null = null;
// The layout is seed-independent, so it's computed once and reused.
export function layout(): Layout {
  return (cached ??= buildPinwheel());
}
