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
}
