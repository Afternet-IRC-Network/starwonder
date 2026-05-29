import type BetterSqlite3 from 'better-sqlite3';

// Minimal idempotent schema bootstrap. Keeps the MVP free of a migration CLI in the
// Docker image; swap to drizzle-kit migrations when the schema starts to churn.
export function ensureSchema(sqlite: BetterSqlite3.Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS universes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seed TEXT NOT NULL,
      settings TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handle TEXT NOT NULL UNIQUE,
      auth_provider TEXT NOT NULL DEFAULT 'local',
      external_id TEXT,
      password_hash TEXT,
      credits INTEGER NOT NULL DEFAULT 0,
      energy INTEGER NOT NULL DEFAULT 100,
      energy_updated_at INTEGER NOT NULL,
      current_sector INTEGER NOT NULL DEFAULT 0,
      ship TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sector_state (
      universe_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (universe_id, sector_id)
    );

    CREATE TABLE IF NOT EXISTS stations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      universe_id INTEGER NOT NULL,
      sector_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      owner_player_id INTEGER,
      data TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stations_sector ON stations (universe_id, sector_id);
  `);
}
