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

export const createTraderInput = z.object({
  name: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-zA-Z0-9_ '-]+$/, "letters, numbers, spaces, apostrophes and hyphens only"),
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
  currentSector: number;
  ship: ShipData;
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

export const tradeInput = z.object({
  action: z.enum(['buy', 'sell']),
  commodity: z.string().min(1),
  qty: z.number().int().min(1).max(100000),
});
export type TradeInput = z.infer<typeof tradeInput>;

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
