import { layout, SIDE, N, type Layout } from './hilbert';
import { unit, fnv, mulberry32 } from './hash';
import { dangerCurve, dangerTier, type DangerTier } from './danger';
import { addr } from './addressing';
import { generatePlanet, type PlanetPalette } from './sector-content';
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
  // habitationFalloff defaults to 0 (uniform) for universes created before the field existed
  const { seed, inhabitedProb, laneP, coreBias, habitationFalloff = 0, wormholeCount } = settings;
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

  // habitation overlay (hash key kept as '|star|' for parity with the admin mockup).
  // Settlement thins gently toward the rim: prob = inhabitedProb·(1 − falloff·t), where
  // t is normalised distance from Sol. World *type* is unaffected by distance.
  const inhabited = new Uint8Array(N);
  for (let d = 0; d < N; d++) {
    const t = sdist[d] / maxD; // 0 at Sol, 1 at the far rim
    const pe = inhabitedProb * (1 - habitationFalloff * t);
    inhabited[d] = unit(`${seed}|star|${d}`) < pe ? 1 : 0;
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

// ── Per-trader map knowledge (fog of war) ───────────────────────────────────
//
// The map renderer (GalaxyMap.vue) draws from this normalized shape, fed either the full
// galaxy (admin Explorer, omniscient) or a fogged subset (the player map). The fog is a
// per-node brightness channel; the data simply never includes unknown sectors, so a
// player client cannot see past it. Full design: docs/0-Projects/4_fog_of_war.md.

export type FogState = 'visited' | 'frontier';

export interface MapNode {
  id: number;
  x: number;
  y: number;
  fog: FogState;
  /** dangerCurve value 0..1 — pure geometry, safe to show on the frontier too */
  danger: number;
  /** present (and meaningful) only when fog === 'visited' */
  inhabited?: boolean;
  /** a visited sector that touches a wormhole this trader hasn't taken */
  unexploredWormhole?: boolean;
  /**
   * Just enough to draw the world on the map — present for visited *inhabited* sectors
   * only. The planet's look is otherwise unknowable client-side (seed lockdown), so the
   * server bakes it into the fog view. Seed the sprite with `addr(id)` to match the star
   * view exactly. The authoritative detail still comes from `/api/sector/:id` on select.
   */
  planet?: MapPlanet;
}

export interface MapPlanet {
  name: string;
  palette: PlanetPalette;
  /** initial longitude offset for the pixel renderer (matches the star-view planet) */
  spin: number;
}

// The map-facing slice of a sector's planet — undefined for empty (uninhabited) sectors.
function mapPlanet(g: Galaxy, id: number): MapPlanet | undefined {
  if (g.inhabited[id] !== 1) return undefined;
  const p = generatePlanet(g.settings.seed, id, g.sdist[id] / g.maxD);
  return { name: p.name, palette: p.palette, spin: p.spin };
}

export interface MapEdge {
  a: number;
  b: number;
  kind: 'lane' | 'wormhole';
}

export interface MapView {
  size: number;
  sectors: MapNode[];
  edges: MapEdge[];
}

const whKey = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;

function wormholeKeySet(g: Galaxy): Set<string> {
  return new Set(g.wormholes.map((w) => whKey(w.a, w.b)));
}

// Lanes among the given sectors (optionally limited to a known set) + wormholes whose
// key is in `whShown`. Deduped, canonical a<b.
function buildEdges(
  g: Galaxy,
  laneFrom: Iterable<number>,
  whEdges: Set<string>,
  whShown: Set<string>,
  knownLimit?: Set<number>,
): MapEdge[] {
  const out: MapEdge[] = [];
  const seen = new Set<string>();
  for (const v of laneFrom) {
    if (g.dist[v] < 0) continue;
    for (const n of g.adj[v]) {
      if (g.dist[n] < 0) continue;
      const key = whKey(v, n);
      if (whEdges.has(key)) continue; // wormholes handled separately
      if (knownLimit && !knownLimit.has(n)) continue;
      if (seen.has('L' + key)) continue;
      seen.add('L' + key);
      out.push({ a: Math.min(v, n), b: Math.max(v, n), kind: 'lane' });
    }
  }
  for (const w of g.wormholes) {
    if (g.dist[w.a] < 0 || g.dist[w.b] < 0) continue;
    const key = whKey(w.a, w.b);
    if (!whShown.has(key)) continue;
    if (seen.has('W' + key)) continue;
    seen.add('W' + key);
    out.push({ a: Math.min(w.a, w.b), b: Math.max(w.a, w.b), kind: 'wormhole' });
  }
  return out;
}

// Omniscient map (admin Explorer): every existing sector + every open lane and wormhole.
export function fullMapView(g: Galaxy): MapView {
  const whEdges = wormholeKeySet(g);
  const sectors: MapNode[] = [];
  const ids: number[] = [];
  for (let d = 0; d < N; d++) {
    if (g.dist[d] < 0) continue;
    ids.push(d);
    sectors.push({
      id: d,
      x: g.layout.xy[d].x,
      y: g.layout.xy[d].y,
      fog: 'visited',
      danger: dangerCurve(g.sdist[d] / g.maxD),
      inhabited: g.inhabited[d] === 1,
      planet: mapPlanet(g, d),
    });
  }
  return { size: N, sectors, edges: buildEdges(g, ids, whEdges, whEdges) };
}

// Fogged map for one trader: ONLY the sectors it has actually visited, plus the lanes
// between them and the wormholes it has taken. There is no "frontier" pre-reveal — you find
// out a sector exists, and what's there, only by travelling to it. (Your immediate exits are
// still listed on the star screen by id, so you can always step into the unknown; you just
// won't see it on the chart until you arrive — which is when the "new system" toast fires.)
export function fogView(g: Galaxy, visited: Set<number>, taken: Set<string>): MapView {
  const whEdges = wormholeKeySet(g);
  const sectors: MapNode[] = [];
  for (const v of visited) {
    if (g.dist[v] < 0) continue;
    const unexplored = g.adj[v].some(
      (n) => g.dist[n] >= 0 && whEdges.has(whKey(v, n)) && !taken.has(whKey(v, n)),
    );
    sectors.push({
      id: v,
      x: g.layout.xy[v].x,
      y: g.layout.xy[v].y,
      fog: 'visited',
      danger: dangerCurve(g.sdist[v] / g.maxD),
      inhabited: g.inhabited[v] === 1,
      unexploredWormhole: unexplored,
      planet: mapPlanet(g, v),
    });
  }
  // Edges only among visited sectors (+ taken wormholes) — never a stub to unexplored space.
  return { size: N, sectors, edges: buildEdges(g, visited, whEdges, taken, new Set(visited)) };
}

// Trader-aware exits at a sector: lanes (always visible) are just `neighbors`; this lists
// the wormholes touching `id`, each with a stable `ref` (index into g.wormholes) and the
// far end if the trader knows it. `to: null` ⇒ unexplored (blind jump via { wormhole: ref }).
export interface WormholeExit {
  ref: number;
  to: number | null;
}

export function wormholeExitsAt(g: Galaxy, id: number, taken: Set<string>): WormholeExit[] {
  const out: WormholeExit[] = [];
  for (let i = 0; i < g.wormholes.length; i++) {
    const w = g.wormholes[i];
    if (w.a !== id && w.b !== id) continue;
    const far = w.a === id ? w.b : w.a;
    if (g.dist[far] < 0) continue;
    const known = taken.has(whKey(w.a, w.b));
    out.push({ ref: i, to: known ? far : null });
  }
  return out;
}
