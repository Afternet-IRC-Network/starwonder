import { describe, it, expect } from 'vitest';
import {
  generatePlanet,
  WORLD_CLASS_INFO,
  type WorldClass,
} from '../src/sector-content';

const SEED = 'aurora';

describe('generatePlanet — class-first generation', () => {
  it('is deterministic for a given (seed, id, rimT)', () => {
    const a = generatePlanet(SEED, 42, 0.5);
    const b = generatePlanet(SEED, 42, 0.5);
    expect(a).toEqual(b);
  });

  it('special-cases Sol → Earth (terran)', () => {
    const earth = generatePlanet(SEED, 0, 0);
    expect(earth.name).toBe('Earth');
    expect(earth.worldClass).toBe('terran');
    expect(earth.atmosphere).toBe('breathable');
  });

  it('always assigns a known world class with display info', () => {
    for (let id = 1; id < 400; id++) {
      const p = generatePlanet(SEED, id, (id % 100) / 100);
      expect(WORLD_CLASS_INFO[p.worldClass]).toBeDefined();
    }
  });

  it('keeps stats physically coherent per class', () => {
    for (let id = 1; id < 600; id++) {
      const p = generatePlanet(SEED, id, (id % 100) / 100);
      if (p.worldClass === 'gas-giant') {
        // gas giants have no surface to breathe on — always thick, always huge
        expect(p.atmosphere).toBe('thick');
        expect(p.size).toBeGreaterThanOrEqual(3.5);
        expect(p.moons).toBeGreaterThanOrEqual(1);
      } else {
        expect(p.size).toBeLessThan(3.5);
      }
      expect(p.gravity).toBeGreaterThan(0);
    }
  });

  it('assigns world type with no distance bias — rimT never changes the class', () => {
    // Type is spatially uniform: the same sector gets the same class at the core or the
    // rim. (rimT only feeds the name, which is allowed to fame-band by distance.)
    for (let id = 1; id < 500; id++) {
      const core = generatePlanet(SEED, id, 0.05);
      const rim = generatePlanet(SEED, id, 0.95);
      expect(core.worldClass).toBe(rim.worldClass);
    }
  });

  it('honours the rarity weights — terran is rare, ocean is common', () => {
    const count = new Map<WorldClass, number>();
    for (let id = 1; id < 4000; id++) {
      const c = generatePlanet(SEED, id, 0.5).worldClass;
      count.set(c, (count.get(c) ?? 0) + 1);
    }
    const terran = count.get('terran') ?? 0;
    const ocean = count.get('ocean') ?? 0;
    // "lush & green": ocean (weight 22) clearly outnumbers terran (weight 14, ~1-in-7)
    expect(ocean).toBeGreaterThan(terran);
    expect(terran / 4000).toBeGreaterThan(0.08); // ~14/100
    expect(terran / 4000).toBeLessThan(0.20);
  });
});
