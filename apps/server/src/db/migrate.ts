import type BetterSqlite3 from 'better-sqlite3';

// Minimal idempotent schema bootstrap. Keeps the MVP free of a migration CLI in the
// Docker image; swap to drizzle-kit migrations when the schema starts to churn.
//
// Config is intentionally NOT seeded: a missing key falls back to its registry default
// (apps/server/src/config.ts), and a row is only written when an admin overrides it.
export function ensureSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS world (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      seed TEXT NOT NULL,
      settings TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      external_id TEXT,
      password_hash TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS traders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL UNIQUE,
      credits INTEGER NOT NULL DEFAULT 0,
      energy INTEGER NOT NULL DEFAULT 100,
      energy_updated_at INTEGER NOT NULL,
      current_sector INTEGER NOT NULL DEFAULT 0,
      ship TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_traders_user ON traders (user_id);

    CREATE TABLE IF NOT EXISTS sector_state (
      sector_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sector_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      owner_trader_id INTEGER,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stations_sector ON stations (sector_id);

    CREATE TABLE IF NOT EXISTS trader_visited (
      trader_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      PRIMARY KEY (trader_id, sector_id)
    );

    CREATE TABLE IF NOT EXISTS trader_wormholes (
      trader_id INTEGER NOT NULL,
      a_sector INTEGER NOT NULL,
      b_sector INTEGER NOT NULL,
      PRIMARY KEY (trader_id, a_sector, b_sector)
    );

    CREATE TABLE IF NOT EXISTS dock_sessions (
      trader_id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'dock',
      sector_id INTEGER NOT NULL,
      route TEXT,
      started_at INTEGER NOT NULL,
      settled_at INTEGER NOT NULL,
      beats_resolved INTEGER NOT NULL DEFAULT 0,
      caps_used TEXT,
      narrative TEXT,
      narrated_through INTEGER NOT NULL DEFAULT 0,
      announced INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trader_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      beat INTEGER,
      at INTEGER NOT NULL,
      plugin TEXT NOT NULL,
      fact TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_trader ON events (trader_id, id);
    CREATE INDEX IF NOT EXISTS idx_events_id ON events (id);

    CREATE TABLE IF NOT EXISTS trader_station (
      trader_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      standing REAL NOT NULL DEFAULT 0,
      flags TEXT,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (trader_id, sector_id)
    );

    CREATE TABLE IF NOT EXISTS market_nudge (
      trader_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      commodity TEXT NOT NULL,
      factor REAL NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY (trader_id, sector_id, commodity)
    );
  `);

  // Guarded ALTERs so pre-existing DBs upgrade in place.
  const colsOf = (table: string): Set<string> =>
    new Set(
      (sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
    );

  // Idle-narrative columns on traders.
  const traderCols = colsOf('traders');
  const add = (name: string, ddl: string): void => {
    if (!traderCols.has(name)) sqlite.exec(`ALTER TABLE traders ADD COLUMN ${ddl}`);
  };
  add('heat', 'heat REAL NOT NULL DEFAULT 0');
  add('heat_updated_at', 'heat_updated_at INTEGER NOT NULL DEFAULT 0');
  add('conditions', 'conditions TEXT');
  add('persona', 'persona TEXT');
  add('trade_order', 'trade_order TEXT');

  // The goal moved from dock_sessions to traders (trader-level: it rides across docks and
  // courses); sessions grew a kind ('dock' | 'transit') and a route for the transit case.
  const sessionCols = colsOf('dock_sessions');
  if (!sessionCols.has('kind')) sqlite.exec(`ALTER TABLE dock_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'dock'`);
  if (!sessionCols.has('route')) sqlite.exec(`ALTER TABLE dock_sessions ADD COLUMN route TEXT`);
  // DEFAULT 1 here (vs 0 in the fresh DDL): pre-existing stays must not retro-announce.
  if (!sessionCols.has('announced')) sqlite.exec(`ALTER TABLE dock_sessions ADD COLUMN announced INTEGER NOT NULL DEFAULT 1`);
  if (!traderCols.has('goal')) {
    sqlite.exec(`ALTER TABLE traders ADD COLUMN goal TEXT`);
    if (sessionCols.has('goal')) {
      // One-time carry: lift any live dock-session goal onto its trader.
      sqlite.exec(
        `UPDATE traders SET goal = (SELECT goal FROM dock_sessions WHERE dock_sessions.trader_id = traders.id)
         WHERE goal IS NULL AND id IN (SELECT trader_id FROM dock_sessions WHERE goal IS NOT NULL)`,
      );
    }
  }
}
