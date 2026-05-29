import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../env';
import * as schema from './schema';
import { ensureSchema } from './migrate';

mkdirSync(dirname(env.DATABASE_FILE), { recursive: true });

const sqlite = new Database(env.DATABASE_FILE);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Idempotent CREATE TABLE IF NOT EXISTS (drizzle-kit migrations can take over later).
ensureSchema(sqlite);

export const db = drizzle(sqlite, { schema });
export { sqlite, schema };
