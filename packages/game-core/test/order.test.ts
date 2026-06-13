import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ENERGY,
  factLine,
  settleOrder,
  type OrderSettleInput,
  type TradeOrder,
} from '../src';

const T0 = 1_700_000_000_000;

function mkOrder(overrides: Partial<TradeOrder> = {}): TradeOrder {
  return {
    sectorId: 42,
    side: 'buy',
    commodity: 'metals',
    qty: 12,
    filled: 0,
    spent: 0,
    placedAt: T0,
    settledAt: T0,
    attempts: 0,
    ...overrides,
  };
}

function mkInput(overrides: Partial<OrderSettleInput> = {}): OrderSettleInput {
  return {
    seed: 'aurora',
    traderId: 7,
    order: mkOrder(),
    price: { buy: 20, sell: 16 },
    vibe: { lawfulness: 0.6, prosperity: 0.5, tension: 0.3 },
    tags: [],
    standing: 0,
    stats: { credits: 5000, cargo: {}, holdSize: 20 },
    energy: { value: 100, updatedAt: T0 },
    energyCfg: DEFAULT_ENERGY,
    energyPerUnit: 2,
    retryMinutes: 30,
    now: T0,
    ...overrides,
  };
}

describe('settleOrder', () => {
  it('is deterministic: identical inputs produce identical results', () => {
    const a = settleOrder(mkInput());
    const b = settleOrder(mkInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a banked pool bursts the whole order on the spot', () => {
    const r = settleOrder(mkInput()); // 12t × 2 energy = 24 ≤ 100 banked
    expect(r.done).toBe(true);
    expect(r.outcome).toBe('filled');
    expect(r.order.filled).toBe(12);
    expect(r.cargo.metals).toBe(12);
    // conservation: credits paid = spent, energy paid = tons × rate
    expect(r.credits).toBe(5000 - r.order.spent);
    expect(r.energy.value).toBe(100 - 24);
    // chunk prices haggle around the market price (±12% + edge)
    const avg = r.order.spent / r.order.filled;
    expect(avg).toBeGreaterThan(20 * 0.85);
    expect(avg).toBeLessThan(20 * 1.15);
  });

  it('completion emits the one newsworthy fact; fills are quiet', () => {
    const r = settleOrder(mkInput());
    const fills = r.beats.filter((b) => b.fact.outcome === 'fill');
    const closing = r.beats.filter((b) => b.fact.newsworthy === true);
    expect(fills.length).toBeGreaterThan(2); // 12t in 1-4t chunks
    expect(fills.every((b) => b.fact.newsworthy === false)).toBe(true);
    expect(closing).toHaveLength(1);
    expect(closing[0].fact.outcome).toBe('filled');
    // every fact renders through the trade module
    for (const b of r.beats) expect(factLine(b.fact)).not.toBe(b.fact.summary);
  });

  it('broke ships are paced by the regen clock (energy IS the work clock)', () => {
    const r = settleOrder(mkInput({ energy: { value: 0, updatedAt: T0 } }));
    expect(r.done).toBe(false);
    expect(r.beats).toHaveLength(0); // nothing affordable yet at now = T0
    expect(r.nextFillAt).not.toBeNull();
    expect(r.nextFillAt!).toBeGreaterThan(T0);
    expect(r.etaAt!).toBeGreaterThanOrEqual(r.nextFillAt!);

    // give it the projected time and the whole order lands
    const later = settleOrder(mkInput({ energy: { value: 0, updatedAt: T0 }, now: r.etaAt! }));
    expect(later.done).toBe(true);
    expect(later.outcome).toBe('filled');
  });

  it('resumes mid-order without replaying fills (same stream, later horizon)', () => {
    const broke = mkInput({ energy: { value: 0, updatedAt: T0 } });
    const oneHourAll = settleOrder({ ...broke, now: T0 + 3_600_000 });
    expect(oneHourAll.done).toBe(false);
    expect(oneHourAll.order.filled).toBeGreaterThan(0);

    // settle half-way, then continue from the persisted state — identical totals
    const half = settleOrder({ ...broke, now: T0 + 1_800_000 });
    const rest = settleOrder({
      ...broke,
      order: half.order,
      stats: { credits: half.credits, cargo: half.cargo, holdSize: 20 },
      energy: half.energy,
      now: T0 + 3_600_000,
    });
    expect(rest.order.filled).toBe(oneHourAll.order.filled);
    expect(rest.order.spent).toBe(oneHourAll.order.spent);
    expect(rest.credits).toBe(oneHourAll.credits);
  });

  it('an unreachable buy limit fills nothing and never projects an ETA', () => {
    const r = settleOrder(mkInput({ order: mkOrder({ limit: 5 }) })); // market is ~20
    expect(r.done).toBe(false);
    expect(r.order.filled).toBe(0);
    expect(r.etaAt).toBeNull();
    expect(r.beats.every((b) => b.fact.outcome === 'no-deal')).toBe(true);
    expect(r.credits).toBe(5000);
    expect(r.energy.value).toBe(100); // no deal, no legwork
  });

  it('limit misses retry on the beat cadence, not instantly', () => {
    const r = settleOrder(
      mkInput({ order: mkOrder({ limit: 5 }), now: T0 + 2 * 3_600_000 }), // 2h docked
    );
    expect(r.beats.length).toBe(5); // one attempt per 30-min retry: 0, 30, 60, 90, 120
    expect(r.order.settledAt).toBe(T0 + 2 * 3_600_000 + 30 * 60_000); // cursor holds the next try
  });

  it('a sell order moves cargo out and earns credits', () => {
    const r = settleOrder(
      mkInput({
        order: mkOrder({ side: 'sell', qty: 8 }),
        stats: { credits: 0, cargo: { metals: 8 }, holdSize: 20 },
      }),
    );
    expect(r.done).toBe(true);
    expect(r.outcome).toBe('filled');
    expect(r.cargo.metals).toBeUndefined();
    expect(r.credits).toBe(r.order.spent);
  });

  it('closes a buy short when the hold fills', () => {
    const r = settleOrder(
      mkInput({
        order: mkOrder({ qty: 12 }),
        stats: { credits: 5000, cargo: { food: 15 }, holdSize: 20 }, // only 5t of room
      }),
    );
    expect(r.done).toBe(true);
    expect(r.outcome).toBe('hold-full');
    expect(r.order.filled).toBe(5);
    expect(r.cargo.metals).toBe(5);
    const closing = r.beats[r.beats.length - 1].fact;
    expect(closing.outcome).toBe('closed');
    expect(closing.newsworthy).toBe(false);
  });

  it('closes a buy short when the credits run dry', () => {
    const r = settleOrder(mkInput({ stats: { credits: 50, cargo: {}, holdSize: 20 } }));
    expect(r.done).toBe(true);
    expect(r.outcome).toBe('broke');
    expect(r.order.filled).toBeGreaterThan(0); // ~2t at ~20cr
    expect(r.credits).toBeGreaterThanOrEqual(0);
  });

  it('standing and charm tilt buy prices down', () => {
    const run = (overrides: Partial<OrderSettleInput>) => {
      const r = settleOrder(mkInput({ order: mkOrder({ qty: 100 }), stats: { credits: 100000, cargo: {}, holdSize: 100 }, ...overrides }));
      return r.order.spent / r.order.filled;
    };
    const plain = run({});
    const liked = run({ standing: 10, tags: ['charming'] });
    expect(liked).toBeLessThan(plain);
  });
});
