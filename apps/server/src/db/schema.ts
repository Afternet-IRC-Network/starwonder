import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// A universe is just a seed + generation settings. The galaxy baseline is COMPUTED
// from these by game-core, never stored row-by-row.
export const universes = sqliteTable('universes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seed: text('seed').notNull(),
  settings: text('settings', { mode: 'json' }).notNull(),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at').notNull(),
});

export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  handle: text('handle').notNull().unique(),
  // auth seam: 'local' now; OAuth/SAML providers slot in beside it later.
  authProvider: text('auth_provider').notNull().default('local'),
  externalId: text('external_id'),
  passwordHash: text('password_hash'),
  credits: integer('credits').notNull().default(0),
  energy: integer('energy').notNull().default(100),
  energyUpdatedAt: integer('energy_updated_at').notNull(),
  currentSector: integer('current_sector').notNull().default(0),
  ship: text('ship', { mode: 'json' }),
  createdAt: integer('created_at').notNull(),
});

// Sparse OVERRIDES: only sectors that have diverged from their computed baseline.
export const sectorState = sqliteTable(
  'sector_state',
  {
    universeId: integer('universe_id').notNull(),
    sectorId: integer('sector_id').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.universeId, t.sectorId] }) }),
);

// Player/corp-built or seeded stations.
export const stations = sqliteTable('stations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  universeId: integer('universe_id').notNull(),
  sectorId: integer('sector_id').notNull(),
  type: text('type').notNull(),
  ownerPlayerId: integer('owner_player_id'),
  data: text('data', { mode: 'json' }),
});
