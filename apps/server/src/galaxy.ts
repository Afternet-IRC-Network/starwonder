import { eq } from 'drizzle-orm';
import {
  generateGalaxy,
  withDefaults,
  type Galaxy,
  type GalaxySettings,
} from '@starwonder/game-core';
import { db, schema } from './db';

export interface ActiveUniverse {
  id: number;
  seed: string;
  settings: GalaxySettings;
  galaxy: Galaxy;
}

let cache: ActiveUniverse | null = null;

// Returns null if no active universe exists — the admin must run Big Bang first.
export function getActiveUniverse(): ActiveUniverse | null {
  if (cache) return cache;

  const row = db
    .select()
    .from(schema.universes)
    .where(eq(schema.universes.status, 'active'))
    .get();

  if (!row) return null;

  const settings = row.settings as GalaxySettings;
  cache = { id: row.id, seed: row.seed, settings, galaxy: generateGalaxy(settings) };
  return cache;
}

export function invalidateUniverseCache(): void {
  cache = null;
}
