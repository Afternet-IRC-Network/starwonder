import { eq } from 'drizzle-orm';
import { generateGalaxy, type Galaxy, type GalaxySettings } from '@starwonder/game-core';
import { db, schema } from './db';

export interface World {
  seed: string;
  settings: GalaxySettings;
  galaxy: Galaxy;
}

let cache: World | null = null;

// Returns null if no world exists — the admin must run Big Bang first. The computed
// galaxy is cached in-process and keyed off the single `world` row.
export function getWorld(): World | null {
  if (cache) return cache;

  const row = db.select().from(schema.world).where(eq(schema.world.id, 1)).get();
  if (!row) return null;

  const settings = row.settings as GalaxySettings;
  cache = { seed: row.seed, settings, galaxy: generateGalaxy(settings) };
  return cache;
}

export function invalidateWorldCache(): void {
  cache = null;
}
