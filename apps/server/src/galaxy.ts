import { eq } from 'drizzle-orm';
import {
  generateGalaxy,
  withDefaults,
  type Galaxy,
  type GalaxySettings,
} from '@starwonder/game-core';
import { db, schema } from './db';
import { env } from './env';

export interface ActiveUniverse {
  id: number;
  seed: string;
  settings: GalaxySettings;
  galaxy: Galaxy;
}

let cache: ActiveUniverse | null = null;

// The active universe and its computed galaxy, memoised in-process. (The galaxy is a
// pure function of the seed+settings, so this is just a perf cache.)
export function getActiveUniverse(): ActiveUniverse {
  if (cache) return cache;

  let row = db
    .select()
    .from(schema.universes)
    .where(eq(schema.universes.status, 'active'))
    .get();

  if (!row) {
    const settings = withDefaults(env.DEFAULT_SEED);
    row = db
      .insert(schema.universes)
      .values({ seed: settings.seed, settings, status: 'active', createdAt: Date.now() })
      .returning()
      .get();
  }

  const settings = row.settings as GalaxySettings;
  cache = { id: row.id, seed: row.seed, settings, galaxy: generateGalaxy(settings) };
  return cache;
}
