import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

// The frozen world definition — a SINGLETON (id is always 1). The galaxy baseline is
// COMPUTED from (seed, settings) by game-core, never stored row-by-row. Immutable while
// it exists; changing the world = Clear + re-Big-Bang.
export const world = sqliteTable('world', {
  id: integer('id').primaryKey(), // CHECK (id = 1) enforced in the DDL
  seed: text('seed').notNull(),
  settings: text('settings', { mode: 'json' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

// Live, admin-tunable operational knobs. Sparse: a missing key means "use the registry
// default" (apps/server/src/config.ts) — you only upsert a row to override.
export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// An account — auth identity only. Gameplay lives on traders (1 user : N traders).
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  // auth seam: 'local' now; OAuth/SAML providers slot in beside it later.
  authProvider: text('auth_provider').notNull().default('local'),
  externalId: text('external_id'),
  passwordHash: text('password_hash'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
});

// A playable character. One user runs several; all live in the single world.
export const traders = sqliteTable('traders', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull(),
  name: text('name').notNull().unique(),
  credits: integer('credits').notNull().default(0),
  energy: integer('energy').notNull().default(100),
  energyUpdatedAt: integer('energy_updated_at').notNull(),
  currentSector: integer('current_sector').notNull().default(0),
  ship: text('ship', { mode: 'json' }),
  createdAt: integer('created_at').notNull(),
});

// Sparse OVERRIDES: only sectors that have diverged from their computed baseline.
export const sectorState = sqliteTable('sector_state', {
  sectorId: integer('sector_id').primaryKey(),
  data: text('data', { mode: 'json' }).notNull(),
});

// Player/corp-built or seeded stations.
export const stations = sqliteTable('stations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sectorId: integer('sector_id').notNull(),
  type: text('type').notNull(),
  ownerTraderId: integer('owner_trader_id'),
  data: text('data', { mode: 'json' }),
});

// Fog-of-war seed: which sectors a trader has visited.
export const traderVisited = sqliteTable(
  'trader_visited',
  {
    traderId: integer('trader_id').notNull(),
    sectorId: integer('sector_id').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.traderId, t.sectorId] }) }),
);

// Which wormholes a trader has traversed (reveals the far end). Canonical a < b.
export const traderWormholes = sqliteTable(
  'trader_wormholes',
  {
    traderId: integer('trader_id').notNull(),
    aSector: integer('a_sector').notNull(),
    bSector: integer('b_sector').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.traderId, t.aSector, t.bSector] }) }),
);
