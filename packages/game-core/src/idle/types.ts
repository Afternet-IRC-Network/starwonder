// The idle-narrative type surface — see docs/0-Projects/starwonder-mvp/idle-narrative.md.
// A MODULE is a whole dynamic in one file: the beat EVENTS that bring it into the world,
// any ongoing CONDITIONS it can attach, and the templated LINE for every fact it emits.
// Modules are pure (no I/O) and never import each other — they interact only through the
// shared visible state in DockContext.

import type { Condition, Modifiers } from '../conditions';
import type { StationType, WorldClass } from '../sector-content';
import type { DangerTier } from '../danger';

// ── Persona ───────────────────────────────────────────────────────────────────
// The split is the whole trick: mechanics read only the TAGS (deterministic, tunable);
// the AI narrator reads only the BLURB (rich, free-form).

export const TRAIT_TAGS = [
  'lawful',
  'shady',
  'charming',
  'gruff',
  'cautious',
  'reckless',
  'lucky',
] as const;
export type TraitTag = (typeof TRAIT_TAGS)[number];

export interface Persona {
  /** free text, AI-only — "ex-customs officer, soft spot for strays" */
  blurb: string;
  /** mechanics-only — shifts event eligibility and odds */
  tags: TraitTag[];
}

// ── Goal — a lightweight, self-directed mission ───────────────────────────────

export const GOAL_KINDS = ['idle', 'bargain-hunt', 'network', 'lay-low', 'hustle'] as const;
export type GoalKind = (typeof GOAL_KINDS)[number];

export interface Goal {
  kind: GoalKind;
  /** optional commodity focus, e.g. 'electronics' for a bargain hunt */
  target?: string;
  /** free text, AI-only */
  blurb?: string;
}

// ── Station vibe — derived from the seed, like world class ───────────────────

export interface StationVibe {
  /** 0 = seedy underbelly … 1 = spit-and-polish, customs everywhere */
  lawfulness: number;
  /** 0 = struggling … 1 = booming */
  prosperity: number;
  /** 0 = sleepy … 1 = something's about to kick off */
  tension: number;
}

// ── The substrate snapshot a beat reads and writes ───────────────────────────

export interface DockStats {
  credits: number;
  /** standing at THIS station (-10..10, 0 = neutral) */
  standing: number;
  /** global law attention (0..10, decays) */
  heat: number;
  cargo: Record<string, number>;
  holdSize: number;
  /** one-shot facts this station remembers about you ("vip": <epoch ms set>) */
  flags: Record<string, number>;
}

// ── Deltas + facts: the only things a module can emit ────────────────────────

export type StatDelta =
  | { kind: 'credits'; d: number }
  | { kind: 'standing'; d: number }
  | { kind: 'heat'; d: number }
  | { kind: 'cargo'; commodity: string; d: number }
  | { kind: 'marketNudge'; commodity: string; factor: number; hours: number }
  | { kind: 'flag'; flag: string; clear?: boolean }
  | { kind: 'condition'; add?: { id: string; data?: Record<string, number> }; clear?: string };

export interface EventFact {
  plugin: string;
  outcome: string;
  /**
   * Third-person past tense with no leading capital or pronoun, so the IRC composer can
   * render `<trader> <summary> — <station>.` ("came down with station measles").
   */
  summary: string;
  /** the mechanical numbers, surfaced next to the prose so narrator drift is visible */
  numbers?: Record<string, number | string>;
  /** false ⇒ the IRC bot stays quiet about it (default true) */
  newsworthy?: boolean;
}

export interface PluginOutcome {
  deltas: StatDelta[];
  fact: EventFact;
}

// ── The per-beat context every module reads ───────────────────────────────────

/** Where the downtime is happening — docked at a station, riding at anchor in orbit
    (in your ship, above an inhabited world), or under way on a course. */
export type SessionKind = 'dock' | 'orbit' | 'transit';

/** Read-only local flavor — what the world generators already know about WHERE a beat
    happens. All optional: absent fields simply never satisfy a gate (open space has no
    world class; tests may pass none at all). */
export interface SectorFlavor {
  worldClass?: WorldClass;
  dangerTier?: DangerTier;
  /** normalised crow-flies distance from Sol (0 = core, 1 = rim) */
  rimT?: number;
  stationType?: StationType;
}

export interface DockContext extends SectorFlavor {
  /** deterministic 0..1 — unit(`${seed}|idle|${trader}|${sector}|${sessionStart}|${beat}|${salt}`) */
  rng: (salt: string) => number;
  /** neutral (0.5 on every axis) while in transit — there's no station out here */
  station: StationVibe;
  tags: TraitTag[];
  goal: Goal | null;
  /** the live snapshot — already reflects earlier beats this settlement */
  stats: DockStats;
  conditions: Condition[];
  /** which kind of session this beat belongs to (default 'dock') */
  context?: SessionKind;
  /** nominal beat time, epoch ms (the flag-age clock; absent in some test harnesses) */
  at?: number;
  /** names of OTHER traders parked in this sector right now (dock/orbit only) */
  roster?: string[];
}

export const hasCondition = (ctx: DockContext, id: string): boolean =>
  ctx.conditions.some((c) => c.id === id);

// ── The module registry entry ─────────────────────────────────────────────────

export interface IdleEvent {
  id: string;
  /** where this event can fire (default 'dock'); transit events roll between worlds */
  context?: SessionKind;
  /** station vibe ∩ tags ∩ goal ∩ stats ∩ conditions */
  eligible(ctx: DockContext): boolean;
  /** relative odds among the eligible (the quiet no-op weight is config) */
  weight(ctx: DockContext): number;
  resolve(ctx: DockContext): PluginOutcome;
}

export interface IdleCondition {
  id: string;
  /** HUD chip text; '' = hidden inert marker */
  label: string;
  /** tooltip: what it does + how it ends */
  blurb: string;
  /** passive warping of other systems while active — applied EVERYWHERE, not just docked */
  modifiers(c: Condition): Partial<Modifiers>;
  /** its own per-beat life (recovery, worsening); runs during dock AND orbit settlement
      (rest is rest, at a bar or in your own bunk) — never in transit */
  tick(c: Condition, ctx: DockContext): PluginOutcome | null;
  /** inert history markers ("measles-immune") skip tick and never expire */
  permanent?: boolean;
}

export interface IdleModule {
  id: string;
  events?: IdleEvent[];
  conditions?: IdleCondition[];
  /** the templated #log line for a fact — second person, mechanical truth */
  line(fact: EventFact): string;
}
