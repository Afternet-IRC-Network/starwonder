import { describe, it, expect } from 'vitest';
import { generateMarket, COMMODITY_SPEC } from '../src/sector-content';

const SEED = 'aurora';
const OPTS = { gradientStrength: 0.5, spread: 0.1 };

describe('generateMarket — pure pricing', () => {
  it('is deterministic for a given (seed, sector, opts)', () => {
    expect(generateMarket(SEED, 42, 0.5, OPTS)).toEqual(generateMarket(SEED, 42, 0.5, OPTS));
  });

  it('returns one entry per commodity, buy >= sell, all positive', () => {
    const m = generateMarket(SEED, 7, 0.3, OPTS);
    expect(m).toHaveLength(COMMODITY_SPEC.length);
    for (const e of m) {
      expect(e.buy).toBeGreaterThanOrEqual(e.sell);
      expect(e.sell).toBeGreaterThanOrEqual(1);
    }
  });

  it('tilts high-tech goods cheaper in the core than on the rim, raw goods the reverse', () => {
    const electronics = (rimT: number) =>
      generateMarket('fixed', 5, rimT, { gradientStrength: 0.5, spread: 0 }).find((e) => e.id === 'electronics')!.buy;
    const minerals = (rimT: number) =>
      generateMarket('fixed', 5, rimT, { gradientStrength: 0.5, spread: 0 }).find((e) => e.id === 'minerals')!.buy;
    // electronics (complexity ~0.95): core (rimT 0) cheaper than rim (rimT 1)
    expect(electronics(0)).toBeLessThan(electronics(1));
    // minerals (complexity ~0.10): core dearer than rim
    expect(minerals(0)).toBeGreaterThan(minerals(1));
  });
});
