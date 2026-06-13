import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

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
  // Idle-narrative substrate (docs/0-Projects/starwonder-mvp/idle-narrative.md):
  // heat = global law attention, lazily decayed like energy; conditions travel with
  // the trader; persona = { blurb (AI-only), tags (mechanics-only) }.
  heat: real('heat').notNull().default(0),
  heatUpdatedAt: integer('heat_updated_at').notNull().default(0),
  conditions: text('conditions', { mode: 'json' }),
  persona: text('persona', { mode: 'json' }),
  // The downtime goal is TRADER-level: it rides across docks and courses unchanged.
  goal: text('goal', { mode: 'json' }),
  // The open trade order (idle/order.ts TradeOrder) — station-scoped; leaving scrubs it.
  tradeOrder: text('trade_order', { mode: 'json' }),
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

// ── Idle narrative (docs/0-Projects/starwonder-mvp/idle-narrative.md §6) ─────

// The trader's live downtime session — at most one per trader. kind 'dock' = parked at a
// station (sector_id is the dock; deleted on undock); kind 'transit' = flying a plotted
// course (route holds {path, costs, wormhole, leg}; sector_id is the origin). caps_used
// keeps the per-session swing rails across check-ins; narrated_through is the events.id
// high-water mark for the (future) AI narrator. The goal lives on traders, not here.
export const dockSessions = sqliteTable('dock_sessions', {
  traderId: integer('trader_id').primaryKey(),
  kind: text('kind').notNull().default('dock'),
  sectorId: integer('sector_id').notNull(),
  route: text('route', { mode: 'json' }),
  startedAt: integer('started_at').notNull(),
  settledAt: integer('settled_at').notNull(),
  beatsResolved: integer('beats_resolved').notNull().default(0),
  capsUsed: text('caps_used', { mode: 'json' }),
  narrative: text('narrative'),
  narratedThrough: integer('narrated_through').notNull().default(0),
  // Has this stay's "made port" line gone out? The IRC debounce: a dock session that
  // survives a few minutes announces once; hop away sooner and the channel hears nothing.
  announced: integer('announced').notNull().default(0),
});

// Append-only event feed — THE shared log (idle beats now; moves/trades/IRC later).
// `at` is the beat's NOMINAL time (started_at + beat·interval), never settlement time.
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  traderId: integer('trader_id').notNull(),
  sectorId: integer('sector_id').notNull(),
  beat: integer('beat'),
  at: integer('at').notNull(),
  plugin: text('plugin').notNull(),
  fact: text('fact', { mode: 'json' }).notNull(),
});

// Sparse local reputation: a row exists only once standing/flags diverge from neutral.
export const traderStation = sqliteTable(
  'trader_station',
  {
    traderId: integer('trader_id').notNull(),
    sectorId: integer('sector_id').notNull(),
    standing: real('standing').notNull().default(0),
    flags: text('flags', { mode: 'json' }),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.traderId, t.sectorId] }) }),
);

// Sparse, time-boxed personal price modifiers (rumours, deals, knock-ons); consumed by
// the market via the stockFactor slot. Expired rows are pruned on settle.
export const marketNudge = sqliteTable(
  'market_nudge',
  {
    traderId: integer('trader_id').notNull(),
    sectorId: integer('sector_id').notNull(),
    commodity: text('commodity').notNull(),
    factor: real('factor').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.traderId, t.sectorId, t.commodity] }) }),
);
