import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_FILE: z.string().default('./data/starwonder.sqlite'),
  GATE_PASSWORD: z.string().default('afternet'),
  SESSION_SECRET: z.string().min(8).default('dev-only-change-me-please'),
  DEFAULT_SEED: z.string().default('aurora'),
  // Set to "true" only when serving over HTTPS (TLS termination at the reverse proxy).
  // Leaving it false lets the cookie work over plain HTTP on the local network.
  COOKIE_SECURE: z.string().transform((v) => v === 'true').default('false'),
  // Shared secret for the IRC bot's /api/bot/* endpoints (Authorization: Bearer <token>).
  BOT_TOKEN: z.string().min(8).default('dev-bot-token-change-me'),
  // When set, the idle narrator calls the Claude API; absent, it falls back to templated
  // lines and exposes the would-be prompt for inspection.
  ANTHROPIC_API_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
