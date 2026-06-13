// vignettes — content as data: void-chatter's pattern promoted to a first-class module.
// The content lives in src/data/vignettes.json (authored offline, curated by hand, same
// doctrine as the name pools); ONE resolver validates a row's gate, rolls its effect
// range, and picks a seeded line variant. The pool is for TEXTURE WITH TEETH — tiny
// deltas and pure flavor; big effects, branches, and conditions stay hand-written
// modules. Every row eats into the quiet weight, so pacing livens for free.

import type {
  DockContext,
  EventFact,
  IdleEvent,
  IdleModule,
  PluginOutcome,
  SessionKind,
  StatDelta,
  TraitTag,
} from '../types';
import { commodityName, randomCommodity, vIndex, vpick } from './util';
import VIGNETTES_DATA from '../../data/vignettes.json';

// ── Row schema (deliberately small) ───────────────────────────────────────────

export interface VignetteGate {
  lawMin?: number;
  lawMax?: number;
  tensionMin?: number;
  tensionMax?: number;
  prosperityMin?: number;
  prosperityMax?: number;
  /** persona tag required / forbidden */
  tag?: string;
  notTag?: string;
  goal?: string;
  worldClass?: string;
  stationType?: string;
  dangerTier?: string;
  rimMin?: number;
  rimMax?: number;
  /** commodity id that must be aboard */
  cargo?: string;
  flag?: string;
  notFlag?: string;
  condition?: string;
  creditsMin?: number;
}

export interface VignetteEffect {
  /** strictly-positive or strictly-negative integer ranges (never straddle 0) */
  credits?: [number, number];
  standing?: [number, number];
  heat?: [number, number];
  /** a personal price nudge: percent OFF (positive = cheaper) for a few hours */
  nudge?: { commodity?: string; discount: [number, number]; hours: [number, number] };
  /** cargo in (random commodity unless named); negative qty requires gate.cargo */
  cargo?: { commodity?: string; qty: [number, number] };
}

export interface VignetteRow {
  id: string;
  /** where it can roll (default 'dock') */
  context?: SessionKind;
  gate?: VignetteGate;
  weight?: number;
  effect?: VignetteEffect;
  newsworthy?: boolean;
  /** third-person past tense, lowercase, no leading pronoun (the IRC voice) */
  summary: string;
  /** 1–5 second-person log phrasings — seeded pick (multiplier 1 built in) */
  lines: string[];
}

export const VIGNETTES = VIGNETTES_DATA as VignetteRow[];

// One pacing knob for the whole pool: row weights stay meaningful relative to each
// other, and this scale sets how hard the pool as a whole leans on the quiet weight.
// Tuned so a typical port gains ~4-6 eligible weight — livelier, still mostly quiet.
const POOL_SCALE = 0.6;

const rowWeight = (r: VignetteRow): number => (r.weight ?? 1) * POOL_SCALE;

const ROW_BY_ID: Record<string, VignetteRow> = Object.fromEntries(VIGNETTES.map((r) => [r.id, r]));

// ── The gate — every constraint optional; absent context never satisfies one ──

export function vignetteEligible(row: VignetteRow, c: DockContext): boolean {
  const g = row.gate;
  if (!g) return true;
  const s = c.station;
  if (g.lawMin !== undefined && s.lawfulness < g.lawMin) return false;
  if (g.lawMax !== undefined && s.lawfulness > g.lawMax) return false;
  if (g.tensionMin !== undefined && s.tension < g.tensionMin) return false;
  if (g.tensionMax !== undefined && s.tension > g.tensionMax) return false;
  if (g.prosperityMin !== undefined && s.prosperity < g.prosperityMin) return false;
  if (g.prosperityMax !== undefined && s.prosperity > g.prosperityMax) return false;
  if (g.tag !== undefined && !c.tags.includes(g.tag as TraitTag)) return false;
  if (g.notTag !== undefined && c.tags.includes(g.notTag as TraitTag)) return false;
  if (g.goal !== undefined && c.goal?.kind !== g.goal) return false;
  if (g.worldClass !== undefined && c.worldClass !== g.worldClass) return false;
  if (g.stationType !== undefined && c.stationType !== g.stationType) return false;
  if (g.dangerTier !== undefined && c.dangerTier !== g.dangerTier) return false;
  if (g.rimMin !== undefined && (c.rimT === undefined || c.rimT < g.rimMin)) return false;
  if (g.rimMax !== undefined && (c.rimT === undefined || c.rimT > g.rimMax)) return false;
  if (g.cargo !== undefined && (c.stats.cargo[g.cargo] ?? 0) <= 0) return false;
  if (g.flag !== undefined && !c.stats.flags[g.flag]) return false;
  if (g.notFlag !== undefined && !!c.stats.flags[g.notFlag]) return false;
  if (g.condition !== undefined && !c.conditions.some((x) => x.id === g.condition)) return false;
  if (g.creditsMin !== undefined && c.stats.credits < g.creditsMin) return false;
  return true;
}

// ── Effect roll + token substitution ──────────────────────────────────────────

const intIn = (c: DockContext, salt: string, [lo, hi]: [number, number]): number =>
  lo + Math.floor(c.rng(salt) * (hi - lo + 1));

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

/** Fill a row's {tokens} from the rolled numbers — shared by summary and log lines. */
function subTokens(text: string, n: Record<string, number | string>): string {
  return text
    .replaceAll('{credits}', n.credits !== undefined ? `${signed(Number(n.credits))}cr` : '')
    .replaceAll('{standing}', n.standing !== undefined ? signed(Number(n.standing)) : '')
    .replaceAll('{heat}', n.heat !== undefined ? signed(Number(n.heat)) : '')
    .replaceAll('{commodity}', n.commodity !== undefined ? commodityName(String(n.commodity)).toLowerCase() : '')
    .replaceAll('{qty}', n.qty !== undefined ? String(n.qty) : '')
    .replaceAll('{discount}', n.discount !== undefined ? String(n.discount) : '')
    .replaceAll('{hours}', n.hours !== undefined ? String(n.hours) : '');
}

function resolveRow(row: VignetteRow, c: DockContext): PluginOutcome {
  const v = vIndex(c);
  const deltas: StatDelta[] = [];
  const numbers: Record<string, number | string> = { v };
  const e = row.effect;
  if (e?.credits) {
    const d = intIn(c, 'fx-credits', e.credits);
    deltas.push({ kind: 'credits', d });
    numbers.credits = d;
  }
  if (e?.standing) {
    const d = intIn(c, 'fx-standing', e.standing);
    deltas.push({ kind: 'standing', d });
    numbers.standing = d;
  }
  if (e?.heat) {
    const d = intIn(c, 'fx-heat', e.heat);
    deltas.push({ kind: 'heat', d });
    numbers.heat = d;
  }
  if (e?.nudge) {
    const commodity = e.nudge.commodity ?? randomCommodity(c, 'fx-nudge');
    const discount = intIn(c, 'fx-discount', e.nudge.discount);
    const hours = intIn(c, 'fx-hours', e.nudge.hours);
    deltas.push({ kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours });
    numbers.commodity = commodity;
    numbers.discount = `${discount}%`;
    numbers.hours = hours;
  }
  if (e?.cargo) {
    const commodity = e.cargo.commodity ?? randomCommodity(c, 'fx-cargo');
    const qty = intIn(c, 'fx-qty', e.cargo.qty);
    deltas.push({ kind: 'cargo', commodity, d: qty });
    numbers.commodity = commodity;
    numbers.qty = qty;
  }
  return {
    deltas,
    fact: {
      plugin: 'vignettes',
      outcome: row.id,
      summary: subTokens(row.summary, numbers),
      numbers,
      newsworthy: row.newsworthy ?? false,
    },
  };
}

// ── One event per context; each row's weight eats into the quiet weight ──────

function makeEvent(context: SessionKind): IdleEvent {
  const pool = VIGNETTES.filter((r) => (r.context ?? 'dock') === context);
  return {
    id: `vignette-${context}`,
    context,
    eligible: (c) => pool.some((r) => vignetteEligible(r, c)),
    weight: (c) => pool.reduce((sum, r) => sum + (vignetteEligible(r, c) ? rowWeight(r) : 0), 0),
    resolve: (c) => {
      const elig = pool.filter((r) => vignetteEligible(r, c));
      const total = elig.reduce((a, r) => a + rowWeight(r), 0);
      let x = c.rng('row') * total;
      let row = elig[elig.length - 1];
      for (const r of elig) {
        if ((x -= rowWeight(r)) < 0) {
          row = r;
          break;
        }
      }
      return resolveRow(row, c);
    },
  };
}

export const vignettes: IdleModule = {
  id: 'vignettes',
  events: [makeEvent('dock'), makeEvent('orbit'), makeEvent('transit')],
  line: (f: EventFact) => {
    const row = ROW_BY_ID[f.outcome];
    if (!row) return f.summary;
    return subTokens(vpick(Number(f.numbers?.v ?? 0), row.lines), f.numbers ?? {});
  },
};
