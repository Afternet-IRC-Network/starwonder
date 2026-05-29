import { describe, it, expect } from 'vitest';
import {
  generateGalaxy,
  sectorView,
  existingSectors,
  withDefaults,
  N,
  currentEnergy,
  spendEnergy,
  DEFAULT_ENERGY,
} from '../src/index';

const settings = withDefaults('aurora');

describe('galaxy generation', () => {
  it('is deterministic for a given seed', () => {
    const a = generateGalaxy(settings);
    const b = generateGalaxy(settings);
    expect(a.reachable).toBe(b.reachable);
    expect(Array.from(a.inhabited)).toEqual(Array.from(b.inhabited));
    expect(a.wormholes).toEqual(b.wormholes);
  });

  it('places Sol at the centre as sector #0 with distance 0', () => {
    const g = generateGalaxy(settings);
    expect(g.dist[0]).toBe(0);
    expect(g.layout.xy[0]).toEqual({ x: 16, y: 16 });
  });

  it('changing the seed changes the galaxy', () => {
    const a = generateGalaxy(withDefaults('aurora'));
    const b = generateGalaxy(withDefaults('borealis'));
    expect(Array.from(a.inhabited)).not.toEqual(Array.from(b.inhabited));
  });

  it('reachable set is a healthy fraction of the grid at default tuning', () => {
    const g = generateGalaxy(settings);
    expect(g.reachable).toBeGreaterThan(N * 0.3);
    expect(g.reachable).toBeLessThanOrEqual(N);
  });

  it('void sectors have dist -1, do not exist, and are excluded as neighbours', () => {
    const g = generateGalaxy(settings);
    const voidId = g.dist.findIndex((d) => d < 0);
    if (voidId >= 0) {
      const v = sectorView(g, voidId);
      expect(v.exists).toBe(false);
      expect(v.jumpsFromSol).toBe(-1);
    }
    // no existing sector should list a void neighbour
    for (const s of existingSectors(g)) {
      for (const nb of sectorView(g, s.id).neighbors) {
        expect(g.dist[nb]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('existingSectors length equals reachable count', () => {
    const g = generateGalaxy(settings);
    expect(existingSectors(g).length).toBe(g.reachable);
  });
});

describe('energy', () => {
  it('regenerates by whole ticks and caps', () => {
    const cfg = DEFAULT_ENERGY;
    const start = { value: 10, updatedAt: 0 };
    // 3.5 ticks elapsed -> +3 energy, updatedAt advanced by 3 whole ticks
    const after = currentEnergy(start, cfg, 3.5 * cfg.perTickSeconds * 1000);
    expect(after.value).toBe(13);
    expect(after.updatedAt).toBe(3 * cfg.perTickSeconds * 1000);

    const full = currentEnergy({ value: 99, updatedAt: 0 }, cfg, 9999 * cfg.perTickSeconds * 1000);
    expect(full.value).toBe(cfg.cap);
  });

  it('spend fails when short and succeeds otherwise', () => {
    const cfg = DEFAULT_ENERGY;
    expect(spendEnergy({ value: 2, updatedAt: Date.now() }, 5, cfg)).toBeNull();
    const ok = spendEnergy({ value: 10, updatedAt: Date.now() }, 4, cfg);
    expect(ok?.value).toBe(6);
  });
});
