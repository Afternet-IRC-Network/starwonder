import { layout, SIDE, N, type Layout } from './hilbert';
import { unit, fnv, mulberry32 } from './hash';
import { dangerCurve, dangerTier, type DangerTier } from './danger';
import { addr, regionOf } from './addressing';
import type { GalaxySettings } from './types';

export interface Wormhole {
  a: number;
  b: number;
}

export interface Galaxy {
  settings: GalaxySettings;
  layout: Layout;
  /** 1 if the sector is an inhabited star system, 0 if empty deep space */
  inhabited: Uint8Array;
  /** open-lane + wormhole adjacency (each existing sector's reachable neighbours) */
  adj: number[][];
  wormholes: Wormhole[];
  /** raw crow-flies distance from Sol, per sector */
  sdist: Float64Array;
  /** the largest crow-flies distance (for normalising to 0..1) */
  maxD: number;
  /** BFS jump-distance from Sol; -1 means the sector is void (does not exist) */
  dist: Int32Array;
  /** count of sectors that exist (== Sol's reachable set) */
  reachable: number;
}

// Pure function of (seed, settings). The whole galaxy is tiny (1024 cells), so we
// materialise it in one pass and cache at the call site — no DB rows for the baseline.
export function generateGalaxy(settings: GalaxySettings): Galaxy {
  const { seed, inhabitedProb, laneP, coreBias, wormholeCount } = settings;
  const lay = layout();
  const xy = lay.xy;
  const D = lay.d;

  // crow-flies distance from Sol (sector #0), and the max for normalisation
  const sol = xy[0];
  const sdist = new Float64Array(N);
  let maxD = 1e-9;
  for (let d = 0; d < N; d++) {
    const dd = Math.hypot(xy[d].x - sol.x, xy[d].y - sol.y);
    sdist[d] = dd;
    if (dd > maxD) maxD = dd;
  }

  // habitation overlay (hash key kept as '|star|' for parity with the admin mockup)
  const inhabited = new Uint8Array(N);
  for (let d = 0; d < N; d++) {
    inhabited[d] = unit(`${seed}|star|${d}`) < inhabitedProb ? 1 : 0;
  }
  inhabited[0] = 1; // Sol is always a star

  // Core bias: tilt the open prob by the lane's mean distance from Sol — denser core,
  // rougher rim — centred at t=0.5 so the galaxy-wide mean stays ≈ laneP.
  const laneOpen = (a: number, b: number): boolean => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const t = (sdist[a] + sdist[b]) / 2 / maxD;
    let pe = laneP * (1 + coreBias * (0.5 - t));
    if (pe < 0) pe = 0;
    else if (pe > 1) pe = 1;
    return unit(`${seed}|lane|${lo}-${hi}`) < pe;
  };

  // open cardinal lanes (enumerate +x and +y so each undirected pair is considered once)
  const adj: number[][] = Array.from({ length: N }, () => []);
  for (let d = 0; d < N; d++) {
    const { x, y } = xy[d];
    const right = x + 1 < SIDE ? D[y * SIDE + (x + 1)] : -1;
    const down = y + 1 < SIDE ? D[(y + 1) * SIDE + x] : -1;
    for (const nd of [right, down]) {
      if (nd < 0) continue;
      if (laneOpen(d, nd)) {
        adj[d].push(nd);
        adj[nd].push(d);
      }
    }
  }

  // wormholes: deterministic long-range edges, biased to distance (count for travel
  // AND reachability)
  const wprng = mulberry32(fnv(`${seed}|wormholes`));
  const seen = new Set<string>();
  const wormholes: Wormhole[] = [];
  const minDist = SIDE * 0.45;
  let guard = 0;
  while (wormholes.length < wormholeCount && guard++ < wormholeCount * 60) {
    const a = (wprng() * N) | 0;
    const b = (wprng() * N) | 0;
    if (a === b) continue;
    if (Math.hypot(xy[a].x - xy[b].x, xy[a].y - xy[b].y) < minDist) continue;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wormholes.push({ a, b });
    adj[a].push(b);
    adj[b].push(a);
  }

  // The universe = Sol's reachable set. BFS from #0; dist < 0 ⇒ void (does not exist).
  const dist = new Int32Array(N).fill(-1);
  dist[0] = 0;
  const q: number[] = [0];
  let head = 0;
  let reachable = 1;
  while (head < q.length) {
    const u = q[head++];
    for (const v of adj[u]) {
      if (dist[v] < 0) {
        dist[v] = dist[u] + 1;
        reachable++;
        q.push(v);
      }
    }
  }

  return { settings, layout: lay, inhabited, adj, wormholes, sdist, maxD, dist, reachable };
}

export interface SectorView {
  id: number;
  /** false ⇒ void: unreachable from Sol, does not exist */
  exists: boolean;
  addr: string;
  region: number;
  x: number;
  y: number;
  inhabited: boolean;
  /** normalised distance from Sol, 0 (core) .. 1 (rim) */
  rimT: number;
  danger: number;
  dangerTier: DangerTier;
  /** jumps from Sol over lanes + wormholes; -1 if void */
  jumpsFromSol: number;
  /** existing neighbours reachable in one jump (lanes + wormholes) */
  neighbors: number[];
  wormholes: number[];
}

export function sectorView(g: Galaxy, id: number): SectorView {
  const rimT = g.sdist[id] / g.maxD;
  const wormholes = g.wormholes
    .filter((w) => w.a === id || w.b === id)
    .map((w) => (w.a === id ? w.b : w.a))
    .filter((n) => g.dist[n] >= 0);
  return {
    id,
    exists: g.dist[id] >= 0,
    addr: addr(id),
    region: regionOf(id),
    x: g.layout.xy[id].x,
    y: g.layout.xy[id].y,
    inhabited: g.inhabited[id] === 1,
    rimT,
    danger: dangerCurve(rimT),
    dangerTier: dangerTier(rimT),
    jumpsFromSol: g.dist[id],
    neighbors: g.adj[id].filter((n) => g.dist[n] >= 0),
    wormholes,
  };
}

export interface MapSector {
  id: number;
  x: number;
  y: number;
  inhabited: boolean;
  dangerTier: DangerTier;
  jumpsFromSol: number;
}

// Compact list of every sector that exists — for the map screens.
export function existingSectors(g: Galaxy): MapSector[] {
  const out: MapSector[] = [];
  for (let d = 0; d < N; d++) {
    if (g.dist[d] < 0) continue;
    out.push({
      id: d,
      x: g.layout.xy[d].x,
      y: g.layout.xy[d].y,
      inhabited: g.inhabited[d] === 1,
      dangerTier: dangerTier(g.sdist[d] / g.maxD),
      jumpsFromSol: g.dist[d],
    });
  }
  return out;
}
