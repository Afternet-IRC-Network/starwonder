import { describe, expect, it } from 'vitest';
import {
  activeModifiers,
  COMMODITY_SPEC,
  CONDITION_DEFS,
  DEFAULT_ENERGY,
  DEFAULT_IDLE,
  factLine,
  foldModifiers,
  IDLE_EVENTS,
  IDLE_MODULES,
  ORBIT_EVENTS,
  settleIdle,
  settleTransit,
  stationVibe,
  TRANSIT_EVENTS,
  unit,
  VIGNETTES,
  vignetteEligible,
  type Condition,
  type DockContext,
  type DockStats,
  type SettleInput,
  type TraitTag,
  type TransitSettleInput,
} from '../src';

const T0 = 1_700_000_000_000;

function baseInput(overrides: Partial<SettleInput> = {}): SettleInput {
  return {
    seed: 'aurora',
    traderId: 7,
    sectorId: 42,
    vibe: { lawfulness: 0.3, prosperity: 0.4, tension: 0.7 },
    tags: ['lawful', 'charming'],
    session: {
      startedAt: T0,
      settledAt: T0,
      beatsResolved: 0,
      goal: { kind: 'bargain-hunt', target: 'electronics' },
      capsUsed: { credits: 0, standing: 0 },
    },
    stats: { credits: 1000, standing: 0, heat: 0, cargo: {}, holdSize: 20, flags: {} },
    conditions: [],
    now: T0 + 16 * 30 * 60_000, // exactly the beat cap
    ...overrides,
  };
}

describe('settleIdle', () => {
  it('is deterministic: identical inputs produce identical results', () => {
    const a = settleIdle(baseInput());
    const b = settleIdle(baseInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different session starts produce different scripts (no replay on re-dock)', () => {
    const cfg = { ...DEFAULT_IDLE, beatCap: 500 };
    const mk = (startedAt: number) =>
      settleIdle(
        baseInput({
          cfg,
          session: { ...baseInput().session, startedAt, settledAt: startedAt },
          now: startedAt + 500 * 30 * 60_000,
        }),
      );
    const a = mk(T0);
    const b = mk(T0 + 12_345);
    expect(JSON.stringify(a.beats.map((x) => x.fact))).not.toBe(
      JSON.stringify(b.beats.map((x) => x.fact)),
    );
  });

  it('advances settledAt by whole beats, never to "now"', () => {
    const r = settleIdle(baseInput({ now: T0 + 3 * 30 * 60_000 + 17_000 }));
    expect(r.beatsRun).toBe(3);
    expect(r.newSettledAt).toBe(T0 + 3 * 30 * 60_000);
  });

  it('caps the backlog (anti-FOMO)', () => {
    const r = settleIdle(baseInput({ now: T0 + 400 * 30 * 60_000 })); // weeks away
    expect(r.beatsRun).toBe(DEFAULT_IDLE.beatCap);
  });

  it('stamps facts with nominal beat time, not wall clock', () => {
    const r = settleIdle(baseInput({ cfg: { ...DEFAULT_IDLE, quietWeight: 0 } }));
    for (const b of r.beats) {
      expect(b.at).toBe(T0 + (b.beat + 1) * 30 * 60_000);
    }
  });

  it('respects the session rails over a long, eventful run', () => {
    const cfg = { ...DEFAULT_IDLE, beatCap: 2000, quietWeight: 0 };
    const r = settleIdle(
      baseInput({
        cfg,
        tags: ['reckless'],
        session: { ...baseInput().session, goal: { kind: 'hustle' } },
        now: T0 + 2000 * 30 * 60_000,
      }),
    );
    expect(r.capsUsed.credits).toBeLessThanOrEqual(cfg.creditCap);
    expect(r.capsUsed.standing).toBeLessThanOrEqual(cfg.standingCap);
    expect(r.stats.credits).toBeGreaterThanOrEqual(0);
    expect(r.stats.standing).toBeGreaterThanOrEqual(-10);
    expect(r.stats.standing).toBeLessThanOrEqual(10);
    expect(r.stats.heat).toBeGreaterThanOrEqual(0);
    expect(r.stats.heat).toBeLessThanOrEqual(10);
    const held = Object.values(r.stats.cargo).reduce((a, b) => a + b, 0);
    expect(held).toBeLessThanOrEqual(r.stats.holdSize);
  });

  it('quiet stretches dominate at default weight', () => {
    const r = settleIdle(baseInput({ cfg: { ...DEFAULT_IDLE, beatCap: 200 }, now: T0 + 200 * 30 * 60_000 }));
    expect(r.beats.length).toBeLessThan(100); // most of 200 beats resolve to nothing
    expect(r.beats.length).toBeGreaterThan(0); // …but not all
  });
});

describe('settleIdle at anchor (orbit context)', () => {
  const orbit = (overrides: Partial<SettleInput> = {}): SettleInput =>
    baseInput({
      context: 'orbit',
      cfg: { ...DEFAULT_IDLE, beatCap: 200 },
      now: T0 + 200 * 30 * 60_000,
      ...overrides,
    });

  it('the orbit pool is real and orbit-only', () => {
    expect(ORBIT_EVENTS.length).toBeGreaterThan(0);
    expect(ORBIT_EVENTS.every((e) => e.context === 'orbit')).toBe(true);
  });

  it('rolls only ship-scoped orbit events — never the dockside pool', () => {
    const r = settleIdle(orbit());
    expect(r.beats.length).toBeGreaterThan(0);
    // a fact's plugin is its MODULE id; derive the orbit-capable modules from the registry
    const orbitPlugins = new Set(
      IDLE_MODULES.filter((m) => m.events?.some((e) => e.context === 'orbit')).map((m) => m.id),
    );
    for (const b of r.beats) {
      // every beat came from the orbit pool (no condition is active in this input)
      expect(orbitPlugins.has(b.fact.plugin)).toBe(true);
      expect(['bar-brawl', 'pickpocket', 'dockside-sweep', 'card-game']).not.toContain(b.fact.plugin);
    }
  });

  it('rest is rest: conditions tick (and heal) at anchor too', () => {
    const r = settleIdle(orbit({ conditions: [{ id: 'measles', since: T0 }] }));
    expect(r.conditions.some((c) => c.id === 'measles')).toBe(false);
    expect(r.conditions.some((c) => c.id === 'measles-immune')).toBe(true);
    expect(r.beats.some((b) => b.fact.plugin === 'measles' && b.fact.outcome === 'recovered')).toBe(true);
  });
});

// ── Transit: the Energy trick applied to movement (energy-paced, greedy) ──────

const TICK_MS = DEFAULT_ENERGY.perTickSeconds * 1000; // 6 min per regenerated energy

function transitInput(overrides: Partial<TransitSettleInput> = {}): TransitSettleInput {
  const path = overrides.route?.path ?? [0, 1, 2, 3, 4];
  return {
    seed: 'aurora',
    traderId: 7,
    route: {
      path,
      costs: path.slice(1).map(() => 1),
      wormhole: path.slice(1).map(() => false),
      leg: 0,
    },
    session: { startedAt: T0, settledAt: T0, beatsResolved: 0, capsUsed: { credits: 0, standing: 0 } },
    goal: null,
    tags: [],
    stats: { credits: 500, standing: 0, heat: 0, cargo: {}, holdSize: 20, flags: {} },
    conditions: [],
    energy: { value: 50, updatedAt: T0 },
    energyCfg: DEFAULT_ENERGY,
    cfg: DEFAULT_IDLE,
    now: T0,
    ...overrides,
  };
}

describe('settleTransit', () => {
  it('is deterministic', () => {
    const a = settleTransit(transitInput());
    const b = settleTransit(transitInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a banked pool flies the whole course instantly (the burst)', () => {
    const r = settleTransit(transitInput()); // 50 energy, 4 hops × 1⚡, zero elapsed time
    expect(r.leg).toBe(4);
    expect(r.beatsRun).toBe(4);
    expect(r.arrivedAt).toBe(T0);
    expect(r.energy.value).toBe(46);
    const last = r.beats[r.beats.length - 1];
    expect(last.fact.plugin).toBe('course');
    expect(last.fact.outcome).toBe('arrived');
    expect(last.sectorId).toBe(4);
  });

  it('sprints as far as the tank allows, then the regen clock paces the rest', () => {
    const path = [0, 1, 2, 3, 4, 5];
    const r = settleTransit(
      transitInput({
        route: { path, costs: [1, 1, 1, 1, 1], wormhole: path.slice(1).map(() => false), leg: 0 },
        energy: { value: 3, updatedAt: T0 },
      }),
    );
    expect(r.leg).toBe(3); // three hops on the banked pool, instantly
    expect(r.arrivedAt).toBeNull();
    expect(r.energy.value).toBe(0);
    expect(r.nextHopAt).toBe(T0 + TICK_MS); // hop 4 fires when the next point regens
    expect(r.etaAt).toBe(T0 + 2 * TICK_MS); // …and hop 5 a tick after that
  });

  it('an expensive hop just waits longer — span-priced time for free', () => {
    const r = settleTransit(
      transitInput({
        route: { path: [0, 1, 2], costs: [5, 5], wormhole: [false, false], leg: 0 },
        energy: { value: 0, updatedAt: T0 },
        now: T0 + 5 * TICK_MS, // exactly the first fare regenerated
      }),
    );
    expect(r.leg).toBe(1);
    expect(r.hops).toEqual([{ to: 1, wormhole: false }]);
    expect(r.arrivedAt).toBeNull();
    expect(r.nextHopAt).toBe(T0 + 10 * TICK_MS);
  });

  it('settling early flies nothing and is idempotent', () => {
    const input = transitInput({
      route: { path: [0, 1], costs: [5], wormhole: [false], leg: 0 },
      energy: { value: 0, updatedAt: T0 },
      now: T0 + TICK_MS,
    });
    const r = settleTransit(input);
    expect(r.beatsRun).toBe(0);
    expect(r.leg).toBe(0);
    expect(r.nextHopAt).toBe(T0 + 5 * TICK_MS);
  });

  it('rolls only transit-context events, stamped at hop time', () => {
    const path = Array.from({ length: 60 }, (_, i) => i);
    const r = settleTransit(
      transitInput({
        route: { path, costs: path.slice(1).map(() => 1), wormhole: path.slice(1).map(() => false), leg: 0 },
        energy: { value: 10, updatedAt: T0 },
        cfg: { ...DEFAULT_IDLE, quietWeight: 0 },
        now: T0 + 30 * TICK_MS, // 10 banked + 30 regenerated ⇒ 40 hops in
      }),
    );
    expect(r.leg).toBe(40);
    const transitPlugins = new Set(
      IDLE_MODULES.filter((m) => m.events?.some((e) => e.context === 'transit')).map((m) => m.id),
    );
    for (const b of r.beats) {
      expect(transitPlugins.has(b.fact.plugin) || b.fact.plugin === 'course').toBe(true);
      expect(b.at).toBeLessThanOrEqual(T0 + 30 * TICK_MS);
      expect(b.at).toBeGreaterThanOrEqual(T0);
    }
    expect(r.beats.length).toBeGreaterThan(0);
  });
});

// ── Registry fuzz: keeps every module author honest ──────────────────────────

function fuzzCtx(n: number): DockContext {
  const r = (s: string) => unit(`fuzz|${n}|${s}`);
  const tagPool: TraitTag[] = ['lawful', 'shady', 'charming', 'gruff', 'cautious', 'reckless', 'lucky'];
  const tags = tagPool.filter((_, i) => r(`tag${i}`) < 0.3);
  const flags: Record<string, number> = {};
  for (const f of ['vip', 'vip-errand', 'contact', 'card-rep', 'big-table']) {
    if (r(`flag-${f}`) < 0.2) flags[f] = T0;
  }
  const cargoPool = ['food', 'livestock', 'medical', 'electronics', 'minerals', 'equipment', 'textiles'];
  const stats: DockStats = {
    credits: Math.floor(r('credits') * 5000),
    standing: Math.floor(r('standing') * 21) - 10,
    heat: Math.floor(r('heat') * 11),
    cargo:
      r('cargo') < 0.5
        ? { [cargoPool[Math.floor(r('cc') * cargoPool.length)]]: 1 + Math.floor(r('cq') * 5) }
        : {},
    holdSize: 20,
    flags,
  };
  const kinds = ['idle', 'bargain-hunt', 'network', 'lay-low', 'hustle'] as const;
  const conditionIds = Object.keys(CONDITION_DEFS);
  const conditions: Condition[] =
    r('cond') < 0.3 ? [{ id: conditionIds[Math.floor(r('ci') * conditionIds.length)], since: T0 }] : [];
  const classes = ['terran', 'ocean', 'desert', 'ice', 'lava', 'barren', 'gas-giant'] as const;
  const tiers = ['peaceful', 'medium', 'dangerous', 'very-dangerous'] as const;
  const types = ['trade', 'haven', 'outpost'] as const;
  return {
    rng: (s) => unit(`fuzz|${n}|roll|${s}`),
    station: { lawfulness: r('law'), prosperity: r('pro'), tension: r('ten') },
    tags,
    goal: r('goal') < 0.2 ? null : { kind: kinds[Math.floor(r('gk') * kinds.length)], target: 'food' },
    stats,
    conditions,
    // the context gates — present most of the time, absent sometimes (transit/legacy)
    ...(r('flavor') < 0.8
      ? {
          worldClass: classes[Math.floor(r('wc') * classes.length)],
          dangerTier: tiers[Math.floor(r('dt') * tiers.length)],
          rimT: r('rim'),
          stationType: types[Math.floor(r('st') * types.length)],
        }
      : {}),
    at: T0 + Math.floor(r('at') * 30 * 86_400_000),
    roster: r('roster') < 0.4 ? ['Vesper Quill', 'Old Marrow'] : [],
  };
}

describe('module registry fuzz', () => {
  it('every event emits bounded deltas and a well-formed fact', () => {
    for (let n = 0; n < 2000; n++) {
      const ctx = fuzzCtx(n);
      for (const e of IDLE_EVENTS) {
        if (!e.eligible(ctx)) continue;
        expect(e.weight(ctx)).toBeGreaterThanOrEqual(0);
        const out = e.resolve(ctx);
        expect(out.fact.plugin).toBeTruthy();
        expect(out.fact.summary).toMatch(/^[a-z]/); // third person, no leading capital
        expect(factLine(out.fact)).toBeTruthy();
        for (const d of out.deltas) {
          if (d.kind === 'credits') expect(Math.abs(d.d)).toBeLessThanOrEqual(1000);
          if (d.kind === 'standing') expect(Math.abs(d.d)).toBeLessThanOrEqual(5);
          if (d.kind === 'heat') expect(Math.abs(d.d)).toBeLessThanOrEqual(5);
          if (d.kind === 'marketNudge') {
            expect(d.factor).toBeGreaterThan(0.3);
            expect(d.factor).toBeLessThan(3);
            expect(d.hours).toBeGreaterThan(0);
            expect(d.hours).toBeLessThanOrEqual(48);
          }
        }
      }
    }
  });

  it('every non-permanent condition recovers in reasonable time', () => {
    for (const [id, def] of Object.entries(CONDITION_DEFS)) {
      if (def.permanent) continue;
      for (let stream = 0; stream < 50; stream++) {
        let cleared = false;
        for (let t = 0; t < 200 && !cleared; t++) {
          const ctx = { ...fuzzCtx(stream), rng: (s: string) => unit(`term|${id}|${stream}|${t}|${s}`) };
          const out = def.tick({ id, since: T0 }, ctx);
          if (out?.deltas.some((d) => d.kind === 'condition' && d.clear === id)) cleared = true;
        }
        expect(cleared, `${id} never cleared (stream ${stream})`).toBe(true);
      }
    }
  });

  it('module ids and condition ids are unique', () => {
    const mids = IDLE_MODULES.map((m) => m.id);
    expect(new Set(mids).size).toBe(mids.length);
    const eids = IDLE_EVENTS.map((e) => e.id);
    expect(new Set(eids).size).toBe(eids.length);
  });
});

// ── Line variants: one seeded index, stored on the fact ───────────────────────

describe('line variants', () => {
  it('factLine is a pure function of the fact (same fact, same line)', () => {
    const fact = { plugin: 'pickpocket', outcome: 'picked', summary: 'got picked', numbers: { credits: -50, v: 3 } };
    expect(factLine(fact)).toBe(factLine({ ...fact }));
  });

  it('different variant indices phrase the same outcome differently', () => {
    const mk = (v: number) =>
      factLine({ plugin: 'pickpocket', outcome: 'picked', summary: 'got picked', numbers: { credits: -50, v } });
    const texts = new Set([mk(0), mk(1), mk(2), mk(3)]);
    expect(texts.size).toBeGreaterThan(1);
  });
});

// ── The vignette pool: data validated row by row ──────────────────────────────

describe('vignette pool', () => {
  const COMMODITIES = new Set<string>(COMMODITY_SPEC.map((c) => c.id));
  const CLASSES = new Set(['terran', 'ocean', 'desert', 'ice', 'lava', 'barren', 'gas-giant']);
  const TIERS = new Set(['peaceful', 'medium', 'dangerous', 'very-dangerous']);
  const TYPES = new Set(['trade', 'haven', 'outpost']);
  const GOALS = new Set(['idle', 'bargain-hunt', 'network', 'lay-low', 'hustle']);
  const TAGS = new Set(['lawful', 'shady', 'charming', 'gruff', 'cautious', 'reckless', 'lucky']);

  it('is a real pool', () => {
    expect(VIGNETTES.length).toBeGreaterThanOrEqual(150);
    expect(new Set(VIGNETTES.map((r) => r.id)).size).toBe(VIGNETTES.length);
    // all three contexts are covered, including the transit pool helpers above
    expect(TRANSIT_EVENTS.some((e) => e.id === 'vignette-transit')).toBe(true);
    expect(ORBIT_EVENTS.some((e) => e.id === 'vignette-orbit')).toBe(true);
  });

  it('every row is well-formed: voice, gates, effects in bounds', () => {
    for (const r of VIGNETTES) {
      const where = `row ${r.id}`;
      expect(['dock', 'orbit', 'transit']).toContain(r.context ?? 'dock');
      expect(r.summary, where).toMatch(/^[a-z]/); // third person, no leading capital
      expect(r.lines.length, where).toBeGreaterThanOrEqual(1);
      expect(r.lines.length, where).toBeLessThanOrEqual(5);
      if (r.weight !== undefined) expect(r.weight, where).toBeGreaterThan(0);

      const g = r.gate;
      if (g) {
        if (g.worldClass) expect(CLASSES.has(g.worldClass), where).toBe(true);
        if (g.dangerTier) expect(TIERS.has(g.dangerTier), where).toBe(true);
        if (g.stationType) expect(TYPES.has(g.stationType), where).toBe(true);
        if (g.goal) expect(GOALS.has(g.goal), where).toBe(true);
        if (g.tag) expect(TAGS.has(g.tag), where).toBe(true);
        if (g.cargo) expect(COMMODITIES.has(g.cargo), where).toBe(true);
      }

      const e = r.effect;
      const range = (x: [number, number], lim: number) => {
        expect(x[0], where).toBeLessThanOrEqual(x[1]);
        expect(Math.max(Math.abs(x[0]), Math.abs(x[1])), where).toBeLessThanOrEqual(lim);
        // never straddle zero — the {token} should always read honestly
        expect(x[0] > 0 === x[1] > 0, where).toBe(true);
      };
      if (e?.credits) range(e.credits, 1000);
      if (e?.standing) range(e.standing, 5);
      if (e?.heat) range(e.heat, 5);
      if (e?.nudge) {
        expect(e.nudge.discount[0], where).toBeGreaterThan(0);
        expect(e.nudge.discount[1], where).toBeLessThanOrEqual(40);
        expect(e.nudge.hours[1], where).toBeLessThanOrEqual(48);
        if (e.nudge.commodity) expect(COMMODITIES.has(e.nudge.commodity), where).toBe(true);
        expect(r.context ?? 'dock', `${where}: nudges are station-scoped`).not.toBe('transit');
      }
      if (e?.standing) expect(r.context ?? 'dock', `${where}: standing is station-scoped`).not.toBe('transit');
      if (e?.cargo) {
        if (e.cargo.commodity) expect(COMMODITIES.has(e.cargo.commodity), where).toBe(true);
        if (e.cargo.qty[0] < 0) {
          // taking cargo away only makes sense for cargo the gate guarantees
          expect(g?.cargo, where).toBeTruthy();
          expect(e.cargo.commodity, where).toBe(g?.cargo);
        }
      }

      // every {token} in the prose must be backed by an effect that fills it
      const tokens = new Set([...`${r.summary} ${r.lines.join(' ')}`.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
      for (const t of tokens) {
        const ok =
          (t === 'credits' && !!e?.credits) ||
          (t === 'standing' && !!e?.standing) ||
          (t === 'heat' && !!e?.heat) ||
          (t === 'commodity' && (!!e?.nudge || !!e?.cargo)) ||
          (t === 'qty' && !!e?.cargo) ||
          ((t === 'discount' || t === 'hours') && !!e?.nudge);
        expect(ok, `${where}: token {${t}} has no backing effect`).toBe(true);
      }
    }
  });

  it('gates bite: a class-gated row needs the class, a roster row needs company', () => {
    const ctx = fuzzCtx(1);
    const iceRow = VIGNETTES.find((r) => r.gate?.worldClass === 'ice')!;
    expect(vignetteEligible(iceRow, { ...ctx, worldClass: 'ice' })).toBe(true);
    expect(vignetteEligible(iceRow, { ...ctx, worldClass: 'desert' })).toBe(false);
    expect(vignetteEligible(iceRow, { ...ctx, worldClass: undefined })).toBe(false);

    const company = IDLE_EVENTS.find((e) => e.id === 'dockside-company')!;
    expect(company.eligible({ ...ctx, roster: ['Vesper Quill'] })).toBe(true);
    expect(company.eligible({ ...ctx, roster: [] })).toBe(false);
    expect(company.eligible({ ...ctx, roster: undefined })).toBe(false);
  });

  it('resolved vignettes render clean (no leftover {tokens})', () => {
    for (let n = 0; n < 300; n++) {
      const ctx = fuzzCtx(n);
      for (const ev of IDLE_EVENTS.filter((e) => e.id.startsWith('vignette-'))) {
        if (!ev.eligible(ctx)) continue;
        const out = ev.resolve(ctx);
        expect(out.fact.summary).not.toMatch(/[{}]/);
        expect(factLine(out.fact)).not.toMatch(/[{}]/);
        expect(factLine(out.fact)).toBeTruthy();
      }
    }
  });
});

// ── Chains: the world remembers you ───────────────────────────────────────────

describe('flag chains', () => {
  const ev = (id: string) => IDLE_EVENTS.find((e) => e.id === id)!;
  const base = (over: Partial<DockContext> = {}): DockContext => ({
    ...fuzzCtx(7),
    tags: [],
    goal: null,
    conditions: [],
    stats: { credits: 1000, standing: 3, heat: 4, cargo: {}, holdSize: 20, flags: {} },
    at: T0 + 12 * 3_600_000,
    ...over,
  });

  it('the contact returns hours later and the favor is spent', () => {
    const ctx = base({ stats: { ...base().stats, flags: { contact: T0 } } });
    expect(ev('contact-returns').eligible(ctx)).toBe(true);
    // too fresh — the contact needs time to deliver
    expect(ev('contact-returns').eligible(base({ stats: { ...base().stats, flags: { contact: T0 } }, at: T0 + 60_000 }))).toBe(false);
    const out = ev('contact-returns').resolve(ctx);
    expect(out.deltas).toContainEqual({ kind: 'flag', flag: 'contact', clear: true });
    expect(factLine(out.fact)).toBeTruthy();
  });

  it('the harbour-master asks back exactly once per station', () => {
    const flags = { vip: T0 };
    expect(ev('harbour-errand').eligible(base({ stats: { ...base().stats, flags } }))).toBe(true);
    expect(ev('harbour-errand').eligible(base({ stats: { ...base().stats, flags: { ...flags, 'vip-errand': T0 } } }))).toBe(false);
    const out = ev('harbour-errand').resolve(base({ stats: { ...base().stats, flags }, tags: ['shady'] }));
    expect(out.fact.outcome).toBe('errand-shady');
    expect(out.deltas).toContainEqual({ kind: 'flag', flag: 'vip-errand' });
  });

  it('a pirate toll leaves a receipt; the receipt changes the next encounter', () => {
    const first = ev('pirate-shadow').resolve(base());
    expect(first.fact.outcome).toBe('toll');
    expect(first.deltas).toContainEqual({ kind: 'condition', add: { id: 'toll-receipt' } });
    const next = ev('pirate-shadow').resolve(base({ conditions: [{ id: 'toll-receipt', since: T0 }] }));
    expect(['waved-through', 'shaken-down']).toContain(next.fact.outcome);
  });

  it('the hustle ladder is flag-gated rung by rung', () => {
    const hustle = { kind: 'hustle' } as const;
    expect(ev('backroom-game').eligible(base({ goal: hustle }))).toBe(false); // no rep yet
    expect(ev('backroom-game').eligible(base({ goal: hustle, stats: { ...base().stats, flags: { 'card-rep': T0 } } }))).toBe(true);
    expect(ev('big-table').eligible(base())).toBe(false);
    expect(ev('big-table').eligible(base({ stats: { ...base().stats, flags: { 'big-table': T0 } } }))).toBe(true);
  });

  it('lay-low bleeds heat and pays off when the file goes cold', () => {
    const goal = { kind: 'lay-low' } as const;
    const hot = ev('lay-low').resolve(base({ goal }));
    expect(hot.fact.outcome).toBe('cooled');
    expect(hot.deltas).toContainEqual({ kind: 'heat', d: -2 });
    const cold = ev('lay-low').resolve(base({ goal, stats: { ...base().stats, heat: 1 } }));
    expect(cold.fact.outcome).toBe('forgotten');
    expect(ev('lay-low').eligible(base({ goal, stats: { ...base().stats, heat: 0 } }))).toBe(false);
  });

  it('the ship\'s cat earns its keep once aboard', () => {
    const withCat = base({ conditions: [{ id: 'ship-cat', since: T0 }] });
    expect(ev('cat-gift').eligible(withCat)).toBe(true);
    expect(ev('cat-ambassador').eligible(withCat)).toBe(true);
    expect(ev('cat-gift').eligible(base())).toBe(false);
  });
});

// ── Modifiers: the bounded write surface ──────────────────────────────────────

describe('modifiers', () => {
  it('folds and clamps stacked conditions', () => {
    const m = foldModifiers([
      { energyRegenFactor: 0.5 },
      { energyRegenFactor: 0.5 },
      { energyRegenFactor: 0.5 },
      { moveEnergyCostDelta: 4 },
      { moveEnergyCostDelta: 4 },
      { priceFactor: { food: 0.1 } },
    ]);
    expect(m.energyRegenFactor).toBe(0.25); // floor — never bricked
    expect(m.moveEnergyCostDelta).toBe(5); // ceiling
    expect(m.priceFactor.food).toBe(0.5); // floor
  });

  it('activeModifiers reads the registry (measles halves regen, +1 move)', () => {
    const m = activeModifiers([{ id: 'measles', since: T0 }]);
    expect(m.energyRegenFactor).toBe(0.5);
    expect(m.moveEnergyCostDelta).toBe(1);
    // unknown ids are ignored gracefully
    const u = activeModifiers([{ id: 'no-such-condition', since: T0 }]);
    expect(u.energyRegenFactor).toBe(1);
  });
});

// ── Vibe ──────────────────────────────────────────────────────────────────────

describe('stationVibe', () => {
  it('is deterministic and bounded', () => {
    const a = stationVibe('aurora', 42, 0.5);
    const b = stationVibe('aurora', 42, 0.5);
    expect(a).toEqual(b);
    for (const v of [a.lawfulness, a.prosperity, a.tension]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('havens are suppressed (lawful + calm) and Sol is the tutorial harbour', () => {
    const h = stationVibe('aurora', 42, 0.9, 'haven');
    expect(h.lawfulness).toBeGreaterThanOrEqual(0.65);
    expect(h.tension).toBeLessThanOrEqual(0.35);
    const sol = stationVibe('aurora', 0, 0);
    expect(sol.lawfulness).toBeGreaterThan(0.9);
    expect(sol.tension).toBeLessThan(0.1);
  });
});
