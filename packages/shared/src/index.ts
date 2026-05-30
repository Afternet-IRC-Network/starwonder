import { z } from 'zod';

// Registration is gated by a shared password (MVP). No email/PII collected.
export const registerInput = z.object({
  gate: z.string(),
  handle: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscore only'),
  password: z.string().min(6).max(200),
});
export type RegisterInput = z.infer<typeof registerInput>;

export const loginInput = z.object({
  handle: z.string().min(1),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginInput>;

// Shape returned by /api/auth/me and after login/register.
export interface MeResponse {
  id: number;
  handle: string;
  credits: number;
  energy: number;
  energyCap: number;
  currentSector: number;
  isAdmin: boolean;
  universeExists: boolean;
}

export const bigBangInput = z.object({
  seed: z.string().min(1).max(64),
  inhabitedProb: z.number().min(0).max(1),
  laneP: z.number().min(0).max(1),
  coreBias: z.number().min(0).max(1),
  wormholeCount: z.number().int().min(0).max(100),
});
export type BigBangInput = z.infer<typeof bigBangInput>;
