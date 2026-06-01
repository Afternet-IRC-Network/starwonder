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
  `);
}
