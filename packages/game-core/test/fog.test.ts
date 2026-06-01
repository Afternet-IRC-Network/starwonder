import { describe, it, expect } from 'vitest';
import { generateGalaxy, fogView, fullMapView, withDefaults } from '../src/index';

const g = generateGalaxy(withDefaults('aurora'));

const whKey = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const isWormhole = (a: number, b: number) => g.wormholes.some((w) => whKey(w.a, w.b) === whKey(a, b));

describe('fogView — per-trader map knowledge', () => {
  it('shows only the sectors the trader has visited — no frontier pre-reveal', () => {
    // Visiting just Sol → only Sol appears; its unexplored neighbours do NOT light up.
    const solo = fogView(g, new Set([0]), new Set());
    expect(solo.sectors.map((s) => s.id)).toEqual([0]);
    expect(solo.sectors.every((s) => s.fog === 'visited')).toBe(true);

    // Visiting Sol + a lane neighbour → both appear, and the lane between them is drawn.
    const nbr = g.adj[0].find((n) => g.dist[n] >= 0 && !isWormhole(0, n))!;
    const two = fogView(g, new Set([0, nbr]), new Set());
    expect(new Set(two.sectors.map((s) => s.id))).toEqual(new Set([0, nbr]));
    expect(
      two.edges.some((e) => e.kind === 'lane' && whKey(e.a, e.b) === whKey(0, nbr)),
    ).toBe(true);
  });

  it('every returned node is a full "visited" node (content revealed)', () => {
    const view = fogView(g, new Set([0]), new Set());
    for (const s of view.sectors) {
      expect(s.fog).toBe('visited');
      expect(typeof s.inhabited).toBe('boolean');
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
