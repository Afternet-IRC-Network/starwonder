import { z } from 'zod';

// ── Auth ──────────────────────────────────────────────────────────────────────

// Registration is gated by a shared password (MVP). No email/PII collected.
export const registerInput = z.object({
  gate: z.string(),
  username: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscore only'),
  password: z.string().min(6).max(200),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

// ── Traders ─────────────────────────────────────────────────────────────────

export const TRAIT_TAGS = [
  'lawful',
  'shady',
  'charming',
  'gruff',
  'cautious',
  'reckless',
  'lucky',
] as const;

export const createTraderInput = z.object({
  name: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-zA-Z0-9_ '-]+$/, "letters, numbers, spaces, apostrophes and hyphens only"),
  // Persona: tags steer the idle-sim dice; the blurb is for the AI narrator only.
  tags: z.array(z.enum(TRAIT_TAGS)).max(3).default([]),
  blurb: z.string().max(200).default(''),
});
export type CreateTraderInput = z.infer<typeof createTraderInput>;

/** The ship's cargo state — minimal for now; module/upgrade slots come with #7. */
export interface ShipData {
  holdSize: number;
  cargo: Record<string, number>;
}

/** Compact entry for the pilot picker. */
export interface TraderSummary {
  id: number;
  name: string;
  currentSector: number;
  credits: number;
}

/** An active condition as the HUD shows it (hidden markers are filtered server-side). */
export interface ConditionView {
  id: string;
  label: string;
  blurb: string;
  since: number;
}

/** The full state of the trader currently being played (drives the game HUD). */
export interface ActiveTrader {
  id: number;
  name: string;
  credits: number;
  /** energy settled to `energyUpdatedAt`; the client ticks it forward locally via currentEnergy() */
  energy: number;
  energyCap: number;
  /** epoch ms of the last settle — lets the client compute live energy without a poll */
  energyUpdatedAt: number;
  /** seconds per regenerated energy tick AS THIS TRADER EXPERIENCES IT (conditions stretch it) */
  energyTickSeconds: number;
  currentSector: number;
  ship: ShipData;
  heat: number;
  conditions: ConditionView[];
}

// Shape returned by /api/auth/me and after login/register/trader select.
export interface MeResponse {
  user: { id: number; username: string; isAdmin: boolean };
  traders: TraderSummary[];
  activeTrader: ActiveTrader | null;
  universeExists: boolean;
}

// ── Intents ───────────────────────────────────────────────────────────────────

// Movement: { to } for a lane / known wormhole, or { wormhole: ref } for a blind jump
// through an unexplored wormhole (the client doesn't have the destination id).
export const moveInput = z.union([
  z.object({ to: z.number().int().min(0) }),
  z.object({ wormhole: z.number().int().min(0) }),
]);
export type MoveInput = z.infer<typeof moveInput>;

// Set / change the trader's downtime goal (trader-level — it rides across docks and courses).
export const goalInput = z.object({
  kind: z.enum(['idle', 'bargain-hunt', 'network', 'lay-low', 'hustle']),
  target: z.string().min(1).max(32).optional(),
  blurb: z.string().max(200).optional(),
});
export type GoalInput = z.infer<typeof goalInput>;

// Plot a course: the full hop list, validated server-side hop by hop (lanes between known
// sectors + taken wormholes — the same edges the client's chart shows). The transit settle
// then flies it one hop per beat.
export const courseInput = z.object({
  path: z.array(z.number().int().min(0)).min(2).max(65),
});
export type CourseInput = z.infer<typeof courseInput>;

// Place a trade order at the current dock (replaces the old live buy/sell): the idle sim
// works it chunk by haggled chunk, paced by energy alone — see docs/0-Projects/trading.md.
export const orderInput = z.object({
  side: z.enum(['buy', 'sell']),
  commodity: z.string().min(1),
  qty: z.number().int().min(1).max(1000),
  /** optional per-unit price rail: ceiling when buying, floor when selling */
  limit: z.number().int().min(1).max(1_000_000).optional(),
});
export type OrderInput = z.infer<typeof orderInput>;

// ── Admin ───────────────────────────────────────────────────────────────────

export const bigBangInput = z.object({
  seed: z.string().min(1).max(64),
  inhabitedProb: z.number().min(0).max(1),
  laneP: z.number().min(0).max(1),
  coreBias: z.number().min(0).max(1),
  habitationFalloff: z.number().min(0).max(1),
  wormholeCount: z.number().int().min(0).max(100),
});
export type BigBangInput = z.infer<typeof bigBangInput>;

export const configPutInput = z.object({
  key: z.string().min(1),
  value: z.number(),
});
export type ConfigPutInput = z.infer<typeof configPutInput>;
