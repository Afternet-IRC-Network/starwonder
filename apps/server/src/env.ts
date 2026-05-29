import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  DATABASE_FILE: z.string().default('./data/starwonder.sqlite'),
  GATE_PASSWORD: z.string().default('afternet'),
  SESSION_SECRET: z.string().min(8).default('dev-only-change-me-please'),
  DEFAULT_SEED: z.string().default('aurora'),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
