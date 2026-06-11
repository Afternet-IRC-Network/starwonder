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

# Regenerate the planet-name pool (data/world-names.json) from the JPL Small-Body DB
pnpm --filter @starwonder/game-core run build-names

# Regenerate the station-grammar pools (place-names/surnames/first-names/descriptives.json)
pnpm --filter @starwonder/game-core run build-name-pools

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

> **Guiding principle — favour the elegant simple fit.** Simplicity is a *driving design
> goal of this game*, not just a code-quality nicety. For every mechanic and player path,
> look for the smallest, cleanest model that captures the feel — not the most powerful or
> general one. The decisions below are all instances of this: the galaxy is a pure function
> instead of a star/lane schema, persistence is sparse overrides instead of full state, energy
> is a timestamp instead of a timer. When adding a feature, reach for the same kind of fit
> before introducing new tables, services, config knobs, or abstractions. Prefer deleting
> complexity over accommodating it; if a design needs a lot of moving parts, that's a signal
> to step back and find the simpler shape.

### The galaxy is computed, not stored

`packages/game-core` exposes `generateGalaxy(settings)` — a **pure function** of `(seed, settings)`. The entire 1024-sector galaxy (a 32×32 Hilbert-curve pinwheel, Sol = sector #0 at centre) is computed in one pass and cached in-process. The DB stores only a single `world` row (seed + settings) plus a `config` key/value table for live admin knobs. **There are no star rows, no lane rows, no edge tables.**

The playable universe is defined as **Sol's reachable set**: a BFS from sector #0 over open lanes + wormholes. Sectors unreachable from Sol are void (they do not exist). Danger is a function of crow-flies distance from Sol (`t^1.7`), bucketed into four tiers by distance thirds/sixths.

### Names are computed too (planets & stations)

A sector is just an address; we never name stars. The **planet is the system's identity**:
`planetName` indexes `data/world-names.json` — **25,315 real named minor planets from the
JPL Small-Body DB** (public domain), in catalog-number order so famous worlds (Ceres,
Vesta) land near Sol and obscure ones on the rim (fame banded by `rimT`). The **station
has its own identity** via `stationName`, a **weighted grammar** over four pools
(`place-names` / `surnames` / `first-names` / `descriptives`.json) + a station-type
mid-word + a universal `" Station"` tail — "Foshay Docks Station", "Toledo Garden
Station", "Mabel's Landing Station"; only ~10% reuse the host world ("Ceres Terminal
Station"). Surnames/first-names fame-band by `rimT`; places/descriptives are flat. A 5%
"New " prefix and ~4% easter egg ride on top. Both are pure
functions of `(seed, sectorId, rimT)`; Sol → Earth / Terra Station (special-cased in
`generateStation`). `generatePlanet`/`generateStation` set `.name`, so names ride the
existing `/api/sector/:id` response — no route changes. Full detail + how to regenerate
the pools: [Procedural Naming](docs/0-Projects/starwonder-mvp/naming-system.md).

### Sparse-override persistence

Reading a sector = compute its baseline from `game-core`, then apply any `sector_state` override rows on top. Untouched sectors never get a DB row. New `sector_state` / `stations` / later `ports` / `planets` rows are only written when something changes from the baseline.

### Energy is computed lazily

Energy is stored as `{value, energy_updated_at}`. `currentEnergy()` in `game-core` computes the current value from elapsed time when needed — no timer, no cron. The server settles the regen back to the DB on read/write. Clients never report energy values.

### Authoritative server pattern

The client sends **intents** only (move, trade, etc.). Every handler: authenticates → loads the active trader + state (computed baseline + override rows) → validates the intent → applies the change in a `better-sqlite3` synchronous transaction → returns new state. No game outcomes are computed client-side. `POST /api/move` (lane / known-wormhole / blind-jump) and `POST /api/trade` (buy/sell) are the two intents built so far; the next ones (dock services, combat, …) copy the same shape. See the running task list in [`docs/0-Projects/todo.md`](docs/0-Projects/todo.md).

### Account vs. trader, and per-trader fog

An **account** (`users`: login + `isAdmin`) is separate from the **trader** it plays (`traders`: credits / energy / `currentSector` / `ship`); one user runs several traders in the one galaxy. The session cookie carries `{ uid, activeTraderId }`; the first account created is the admin. Each trader's map knowledge is two sparse tables — `trader_visited` (fog-of-war seed) and `trader_wormholes` (which wormholes it's taken; the far end stays hidden until traversed). **Seed lockdown:** the public `/api/universe` returns only `{ exists, costs }` — never `seed`/`settings` — so a client can't recompute the galaxy and defeat the fog; the admin Explorer gets the full settings from `/api/admin/universe`. The player map (`/api/map`) is server-authored via `fogView`; the admin map is the same `GalaxyMap.vue` renderer fed the omniscient `fullMapView`.

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

Tables: `world` (singleton, `CHECK (id = 1)`), `config` (key/value knobs — see `apps/server/src/config.ts` registry), `users`, `traders`, `sector_state` (sparse overrides), `stations`, `trader_visited`, `trader_wormholes`. JSON columns (`settings`, `data`, `ship`) are opaque blobs — never queried inside — so the schema is Postgres-compatible if the driver is swapped.

## Key files

- `packages/game-core/src/galaxy.ts` — `generateGalaxy`, `sectorView`, `existingSectors`; `fogView` / `fullMapView` (→ `MapView`, the shared map-render shape) + `wormholeExitsAt`
- `packages/game-core/src/hilbert.ts` — pinwheel layout (`SIDE=32`, `N=1024`, Sol at grid centre)
- `packages/game-core/src/energy.ts` — `currentEnergy`, `spendEnergy`
- `packages/game-core/src/danger.ts` — `dangerCurve`, `dangerTier`
- `packages/game-core/src/sector-content.ts` — `generatePlanet`/`generateStation` + `generateMarket` (pure pricing over the `COMMODITY_SPEC` table — gradient × seed noise × a `stockFactor` pinned to 1, the hook for dynamic stock later). **Class-first, distance-neutral**: rolls a `WorldClass` (terran/ocean/desert/ice/lava/barren/gas-giant) from the flat weighted **`CLASS_SPEC`** table — the *single source of truth*: add/remove a class there and the `WorldClass` type, rarity roll, `WORLD_CLASS_INFO` (display label+blurb, shared by game + admin UIs), and stat derivation all follow. Then derives size/gravity/atmosphere/palette/moons from it. World **type ignores distance** — only danger + habitation track `rimT` (names *do* fame-band by distance). Also sets `.name`. Full design: [world-generation.md](docs/0-Projects/starwonder-mvp/world-generation.md).
- `packages/game-core/src/names.ts` — `planetName`/`stationName` (station grammar + `pickFamed`); pools in `data/{world-names,place-names,surnames,first-names,descriptives}.json`
- `apps/server/src/galaxy.ts` — in-process world cache (`getWorld`, `invalidateWorldCache`)
- `apps/server/src/config.ts` — the `CONFIG_SPEC` registry + typed `getConfig`/`setConfig`/`allConfig` (missing key ⇒ default; upsert to override)
- `apps/server/src/session.ts` — session claims (`{ uid, activeTraderId }`), cookie sign/clear, `loadActiveTrader`, `visitedSet`/`takenWormholes`, and `buildMe` (the reshaped `me`)
- `apps/server/src/routes/game.ts` — public `/api/universe` (`{ exists, costs }` only), trader-aware `/api/sector/:id` (incl. the `traders` "also here" roster), fogged `/api/map` (with `presence`: sectorId→count of other traders in charted space), and the `/api/move` + `/api/trade` intents
- `apps/server/src/routes/admin.ts` — `/api/admin/big-bang` / `clear` (write/wipe `world`, preserve `config`), `/api/admin/universe` (full seed+settings), `/api/admin/users` (accounts + nested traders), `/api/admin/presence` (sectorId→trader count for the map), `/api/admin/config` GET/PUT; all gated via `requireAdmin` (`users.isAdmin`)
- `apps/server/src/routes/auth.ts` — register / login / logout / me + trader create/select (gate password + argon2id + JWT cookie)
- `apps/web/src/api.ts` — typed fetch wrappers for all server endpoints
- `apps/web/src/App.vue` — hash router + auth gating + game shell (star/map/dock/ship/log tabs); HUD reads `me.activeTrader`
- `apps/web/src/components/game/PilotScreen.vue` — create/select a trader (shown when a world exists but no trader is active)
- `apps/web/src/components/game/DockMarket.vue` — the `#dock` marketplace (buy/sell against `sector.market`)
- `apps/web/src/components/admin/ConfigPanel.vue` — admin Settings tab: view/edit the live `config` knobs
- `apps/web/src/controllers/AdminExplorer.vue` — admin Galaxy Explorer (map + table browser)
- `apps/web/src/components/game/OrbitViewport.vue` — the canvas viewport: planet (size scales with diameter, log-mapped — see `MIN_SCALE`), station wheel, and overlays (name top-left, world-type toast top-right, stats line bottom)
- `apps/web/src/components/game/OrbitPanel.vue` — **the canonical sector screen**: `OrbitViewport` + the "In orbit" station card + an "Also here" roster of other traders parked in the sector (each with a `ShipIcon`). Used verbatim by both the game `#sector` tab (`App.vue`) and the admin inspector (`SectorDetail.vue`) — see the shared-presentation rule below
- `apps/web/src/components/game/ship.ts` + `ShipIcon.vue` — procedural voxel-ship sprite (ported from mockup-d's `makeSprite`); a trader's hull + hue are a pure function of its name. Used by the "Also here" roster. (The blue "players here" map marker is drawn directly in `StarChart`/`GalaxyMap` from the `presence` map.)
- `apps/web/src/components/game/SectorDetail.vue` — admin wrapper: `OrbitPanel` + a sector/danger header + a debug footer (grid, jumps, lanes)
- `apps/web/src/components/admin-big-bang/GalaxyMap.vue` — the **shared** canvas map; renders a `MapView`, deriving a full one from a `galaxy` prop (admin) or taking a fogged `view` (player); clickable + `selected`/`current` rings

## Frontend & routing

`App.vue` is a tiny **hash router** gated by auth state. Pages: `login`/`register`,
`admin`, and game tabs `sector`/`map`/`dock`/`ship`/`log`. `#admin` resolves to **two**
different admin screens depending on state: the **Big Bang** universe-setup wizard when no
universe exists, or the **Galaxy Explorer** (browse the live universe by map / table / settings)
once one does. The Explorer computes the galaxy **client-side** from `/api/admin/universe`'s
`settings` (no per-sector fetches) and only hits `/api/sector/:id` for the selected sector's
authoritative detail. When a world exists but the user has no active trader, the **Pilot screen**
(create/select a trader) sits between auth and the game. Admin is the first account
(`users.isAdmin`, surfaced as `me.user.isAdmin`).

**Shared-presentation rule:** the admin tools exist to debug what players actually see, so
admin screens must **reuse the exact same components** as the player UI, never a parallel
layout. The whole "what's in this sector" view lives in **`OrbitPanel`** (→ `OrbitViewport`);
both `#sector` and `SectorDetail` render it unchanged. When changing how a sector looks, edit
the shared component once — do **not** fork a separate admin version. UI mockups live in
`docs/0-Projects/starwonder-mvp/mockups/` (`d-modern-voxel.html` is the `#sector` reference;
`map-admin.html` the map). New player-facing UI should match the relevant mockup.

## Dev loop & gotchas

- **The app runs as a Docker container** (`docker compose up --build -d`, `docker compose down`).
  An instance on `:8080` is usually the container, not a stray `tsx`.
- **Editing `packages/game-core` or `apps/web` requires a rebuild.** `tsx watch` (dev server)
  only watches `apps/server/src` — *not* workspace packages — and the prod container bakes the
  web bundle in. After changing the engine or the frontend, `docker compose up --build -d`
  (or run `pnpm dev` for Vite HMR on `:5173`). Symptom of forgetting: stale API/bundle, e.g.
  `/api/sector` missing the `name` fields.
- **Workspace-package resolution is wired in two places** — keep both or typecheck/build break:
  `tsconfig.base.json` `paths` (for `tsc`/`vue-tsc`) and `apps/web/vite.config.ts`
  `resolve.alias` (for the Rollup prod build) both map `@starwonder/game-core` and
  `@starwonder/shared` to their `src/index.ts`. (pnpm symlinks alone resolve inconsistently.)

## Docs

Design specs live under `docs/0-Projects/` (a PARA vault). Start here:

- `starwonder-mvp/roadmap.md` — build order / phases.
- `starwonder-mvp/gameplay-overview.md` + `technical-infrastructure.md` — the game design and the system design.
- `starwonder-mvp/world-generation.md` — world-class model (`CLASS_SPEC`); `naming-system.md` — planet/station naming.
- `todo.md` — the live, checked-off task list (what's done, what's next); `trading.md` — the in-progress trade-system design.
- `starwonder-mvp/mockups/*.html` — UI references (`d-modern-voxel.html` = `#sector`, `map-admin.html` = map).
