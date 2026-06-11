import { describe, it, expect } from 'vitest';
import {
  generateGalaxy,
  fogView,
  fullMapView,
  wormholeCost,
  DEFAULT_WORMHOLE_COST,
  withDefaults,
} from '../src/index';

const g = generateGalaxy(withDefaults('aurora'));

const whKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const isWormhole = (a: number, b: number) => g.wormholes.some((w) => whKey(w.a, w.b) === whKey(a, b));

describe('fogView — per-trader map knowledge', () => {
  it('reveals lane-neighbours as a "?" frontier, but keeps wormhole far-ends hidden', () => {
    const solo = fogView(g, new Set([0]), new Set());
    expect(solo.sectors.find((s) => s.id === 0)!.fog).toBe('visited');

    // Sol's open *lane* neighbours appear as frontier "?" nodes — existence only, no content.
    const laneNbrs = g.adj[0].filter((n) => g.dist[n] >= 0 && !isWormhole(0, n));
    for (const n of laneNbrs) {
      const node = solo.sectors.find((s) => s.id === n);
      expect(node?.fog).toBe('frontier');
      expect(node?.planet).toBeUndefined();
      expect(node?.inhabited).toBeUndefined();
    }

    // A wormhole touching Sol does NOT pre-reveal its far end — it stays a blind jump.
    const whNbrs = g.adj[0].filter((n) => g.dist[n] >= 0 && isWormhole(0, n));
    for (const n of whNbrs) expect(solo.sectors.some((s) => s.id === n)).toBe(false);

    // Visiting a lane neighbour promotes it to a full visited node + draws the lane between.
    const nbr = laneNbrs[0];
    const two = fogView(g, new Set([0, nbr]), new Set());
    expect(two.sectors.find((s) => s.id === nbr)?.fog).toBe('visited');
    expect(
      two.edges.some((e) => e.kind === 'lane' && whKey(e.a, e.b) === whKey(0, nbr)),
    ).toBe(true);
  });

  it('returns visited nodes with content and frontier nodes as bare "?"', () => {
    const view = fogView(g, new Set([0]), new Set());
    for (const s of view.sectors) {
      if (s.fog === 'visited') {
        expect(typeof s.inhabited).toBe('boolean');
      } else {
        expect(s.fog).toBe('frontier');
        expect(s.inhabited).toBeUndefined();
        expect(s.planet).toBeUndefined();
      }
    }
  });

  it('only draws wormhole edges the trader has taken', () => {
    const w = g.wormholes[0];
    const noWh = fogView(g, new Set([w.a, w.b]), new Set());
    expect(noWh.edges.some((e) => e.kind === 'wormhole')).toBe(false);

    const key = `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`;
    const withWh = fogView(g, new Set([w.a, w.b]), new Set([key]));
    expect(withWh.edges.some((e) => e.kind === 'wormhole')).toBe(true);
  });

  it('fullMapView exposes every existing sector', () => {
    const full = fullMapView(g);
    expect(full.sectors).toHaveLength(g.reachable);
    expect(full.sectors.every((s) => s.fog === 'visited')).toBe(true);
  });

  it('prices wormholes by span: longer costs more, soft-capped, ≤ walking it', () => {
    const span = (w: { a: number; b: number }) =>
      Math.hypot(g.layout.xy[w.a].x - g.layout.xy[w.b].x, g.layout.xy[w.a].y - g.layout.xy[w.b].y);
    const sorted = [...g.wormholes].sort((p, q) => span(p) - span(q));
    const shortest = sorted[0];
    const longest = sorted[sorted.length - 1];

    const cShort = wormholeCost(g, shortest.a, shortest.b);
    const cLong = wormholeCost(g, longest.a, longest.b);

    expect(cShort).toBeGreaterThanOrEqual(1);
    expect(cLong).toBeGreaterThanOrEqual(cShort);            // monotone in span
    expect(cLong).toBeLessThanOrEqual(DEFAULT_WORMHOLE_COST.cap);  // soft cap holds
    // A wormhole is a bargain: never dearer than walking its crow-flies span.
    expect(cLong).toBeLessThanOrEqual(Math.ceil(span(longest)));

    // The cost rides each drawn wormhole edge so the route planner can weigh it.
    const w = g.wormholes[0];
    const key = `${Math.min(w.a, w.b)}-${Math.max(w.a, w.b)}`;
    const view = fogView(g, new Set([w.a, w.b]), new Set([key]));
    const edge = view.edges.find((e) => e.kind === 'wormhole');
    expect(edge?.cost).toBe(wormholeCost(g, w.a, w.b));
  });

  it('carries planet visuals on visited inhabited nodes only', () => {
    const view = fogView(g, new Set([0]), new Set());
    const sol = view.sectors.find((s) => s.id === 0)!;
    // Sol is inhabited (Earth) → the map gets enough to draw the world.
    expect(sol.planet).toBeDefined();
    expect(sol.planet!.name).toBe('Earth');
    expect(sol.planet!.palette).toBe('ocean');
    expect(typeof sol.planet!.spin).toBe('number');
    // Visited but uninhabited sectors are waypoints — no planet to draw.
    for (const s of view.sectors) if (!s.inhabited) expect(s.planet).toBeUndefined();
  });
});
