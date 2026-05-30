# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install dependencies
pnpm install

# Local development (Vite on :5173 proxying /api → Fastify on :8080)
pnpm dev

# Run all tests (game-core Vitest suite)
pnpm test

# Run tests in a specific package
pnpm --filter @starwonder/game-core run test

# Watch mode for game-core tests
pnpm --filter @starwonder/game-core run test:watch

# Type-check all packages
pnpm typecheck

# Production build (frontend → apps/web/dist, then served by the backend)
pnpm build

# Docker (production — API + SPA on :8080, SQLite on a named volume)
docker compose up --build
```

## Monorepo layout

```
packages/game-core   Pure deterministic galaxy engine + rules (TS, Vitest) — shared by server, tests, and eventually the IRC bot
packages/shared      Zod DTOs + shared types (register/login/me) — imported by both server and web
apps/server          Fastify 5 + Drizzle/SQLite + argon2 auth; serves the built SPA in production
apps/web             Vue 3 + Vite + Tailwind; proxies /api to the server in dev
```

The backend is run with `tsx` directly (no separate compile step). The frontend is built by Vite and dropped into `apps/web/dist`, which `@fastify/static` then serves with an SPA fallback.

## Core architecture decisions

### The galaxy is computed, not stored

`packages/game-core` exposes `generateGalaxy(settings)` — a **pure function** of `(seed, settings)`. The entire 1024-sector galaxy (a 32×32 Hilbert-curve pinwheel, Sol = sector #0 at centre) is computed in one pass and cached in-process. The DB stores only a single `universes` row (seed + settings). **There are no star rows, no lane rows, no edge tables.**

The playable universe is defined as **Sol's reachable set**: a BFS from sector #0 over open lanes + wormholes. Sectors unreachable from Sol are void (they do not exist). Danger is a function of crow-flies distance from Sol (`t^1.7`), bucketed into four tiers by distance thirds/sixths.

### Sparse-override persistence

Reading a sector = compute its baseline from `game-core`, then apply any `sector_state` override rows on top. Untouched sectors never get a DB row. New `sector_state` / `stations` / later `ports` / `planets` rows are only written when something changes from the baseline.

### Energy is computed lazily

Energy is stored as `{value, energy_updated_at}`. `currentEnergy()` in `game-core` computes the current value from elapsed time when needed — no timer, no cron. The server settles the regen back to the DB on read/write. Clients never report energy values.

### Authoritative server pattern

The client sends **intents** only (move, trade, etc.). Every handler: authenticates → loads state (computed baseline + override rows) → validates the intent → applies the change in a `better-sqlite3` synchronous transaction → returns new state. No game outcomes are computed client-side.

## Environment variables

Copy `.env.example` to `.env`. Validated at boot by zod in `apps/server/src/env.ts`:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Server listen port |
| `DATABASE_FILE` | `./data/starwonder.sqlite` | SQLite file path |
| `GATE_PASSWORD` | `afternet` | Shared registration gate (MVP auth) |
| `SESSION_SECRET` | `dev-only-…` | Signs session cookies (use a long random string in prod) |
| `DEFAULT_SEED` | `aurora` | Universe seed created on first boot |

## Database

Schema is bootstrapped idempotently via `CREATE TABLE IF NOT EXISTS` on server start (`apps/server/src/db/migrate.ts`). No migration CLI is needed for now — switch to drizzle-kit when the schema starts to churn. SQLite is configured with WAL mode and foreign keys on.

Tables: `universes`, `players`, `sector_state` (sparse overrides), `stations`. JSON columns (`settings`, `data`, `ship`) are opaque blobs — never queried inside — so the schema is Postgres-compatible if the driver is swapped.

## Key files

- `packages/game-core/src/galaxy.ts` — `generateGalaxy`, `sectorView`, `existingSectors`
- `packages/game-core/src/hilbert.ts` — pinwheel layout (`SIDE=32`, `N=1024`, Sol at grid centre)
- `packages/game-core/src/energy.ts` — `currentEnergy`, `spendEnergy`
- `packages/game-core/src/danger.ts` — `dangerCurve`, `dangerTier`
- `apps/server/src/galaxy.ts` — in-process universe cache (`getActiveUniverse`)
- `apps/server/src/routes/game.ts` — `/api/universe`, `/api/map`, `/api/sector/:id`
- `apps/server/src/routes/auth.ts` — register / login / logout / me (gate password + argon2id + JWT cookie)
- `apps/web/src/api.ts` — typed fetch wrappers for all server endpoints
