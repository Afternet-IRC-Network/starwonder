import { describe, it, expect } from 'vitest';
import {
  generateGalaxy,
  sectorView,
  generatePlanet,
  generateStation,
  planetName,
  stationName,
  withDefaults,
} from '../src/index';

const settings = withDefaults('aurora');

describe('procedural naming', () => {
  it('is deterministic for a given (seed, sector)', () => {
    expect(planetName('aurora', 512, 0.5)).toBe(planetName('aurora', 512, 0.5));
    expect(stationName('aurora', 512, 0.5, 'trade')).toBe(
      stationName('aurora', 512, 0.5, 'trade'),
    );
  });

  it('changes with the seed', () => {
    expect(planetName('aurora', 512, 0.5)).not.toBe(planetName('borealis', 512, 0.5));
  });

  it('special-cases Sol as Earth / Terra Station', () => {
    expect(generatePlanet('aurora', 0, 0).name).toBe('Earth');
    expect(generateStation('aurora', 0, 0).name).toBe('Terra Station');
  });

  it('grades fame by distance from Sol (famous worlds near the core)', () => {
    // Core band is the famous head of the catalog; rim reaches the obscure tail.
    const core = planetName('aurora', 7, 0.1);
    const rim = planetName('aurora', 7, 0.95);
    expect(core).not.toBe(rim);
  });

  it('gives stations their own identity (mostly not the host world)', () => {
    // Stations draw from the place/surname/first-name/descriptive grammar; only ~10%
    // reuse the host world. Across many sectors, the bound-to-world share stays small.
    const g = generateGalaxy(settings);
    let reused = 0;
    let total = 0;
    for (let id = 1; id < 1024; id++) {
      const v = sectorView(g, id);
      if (!v.exists || !v.inhabited) continue;
      total++;
      const world = planetName(settings.seed, id, v.rimT);
      if (stationName(settings.seed, id, v.rimT, 'trade').startsWith(world)) reused++;
    }
    expect(total).toBeGreaterThan(50);
    expect(reused / total).toBeLessThan(0.25); // ~10% reuse + incidental matches
  });

  it('gives every inhabited sector a non-empty world + station name, near-zero collisions', () => {
    const g = generateGalaxy(settings);
    const counts = new Map<string, number>();
    let inhabited = 0;
    for (let id = 0; id < g.dist.length; id++) {
      const v = sectorView(g, id);
      if (!v.exists || !v.inhabited) continue;
      inhabited++;
      const p = generatePlanet(settings.seed, id, v.rimT);
      const s = generateStation(settings.seed, id, v.rimT);
      expect(p.name.length).toBeGreaterThan(0);
      expect(s.name.length).toBeGreaterThan(0);
      counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    }
    const dupes = [...counts.values()].reduce((n, c) => n + (c - 1), 0);
    expect(dupes / inhabited).toBeLessThan(0.02);
  });
});
