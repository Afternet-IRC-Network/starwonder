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
apps/bot             IRC town crier (raw-socket client, no deps) — polls /api/bot/tick, announces events in #starwonder
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

### Idle narrative — downtime is simulated, lazily (docked, at anchor, AND in transit)

While a trader idles, time keeps moving. Downtime is a **trader-level session** with a
`kind`: **dock** (`settleIdle` replays elapsed 30-min beats at the station), **orbit**
(same beat engine, the ship-scoped `ORBIT_EVENTS` pool — riding at anchor above the world;
conditions tick in dock AND orbit, "rest is rest", never in transit), or **transit**
(`settleTransit` flies a plotted course **greedily, paced by energy alone**: each hop fires
the moment its cost is affordable, so a banked pool sprints several hops instantly and the
regen clock paces the rest — a lane hop every ~6 min when broke, a pricey wormhole
proportionally longer. There is no separate hop cadence; **energy IS the travel clock**, and
every journey — including a single lane tap on the sector screen — is a course). **Docking
is an intent**: arriving anywhere (course or jump) only parks you at anchor; `POST /api/dock`
opens the docked stay and it lasts until `POST /api/undock` or setting out. Station beats,
order fills, and the IRC "made port" debounce belong to docked stays only. All settles are pure
(`game-core/src/idle/`) — the Energy trick applied to events and movement. One registry,
**`IDLE_MODULES`**, is the single source of truth for dynamics: a module is ONE FILE bundling
its beat events (an event's `context` field picks its pool: dock or transit), any ongoing
**conditions** it attaches (measles!), and templated log lines. Conditions warp other systems
by transforming their *inputs* (the clamped `Modifiers` struct → energy regen / move cost /
prices) — core functions never know conditions exist. The **goal lives on the trader**, not
the session, so it rides across docks and courses. Server glue: `apps/server/src/idle.ts`
(`settleTrader` — the **settle-first invariant**: every handler touching a trader settles
before acting; a transit arrival chains straight into the dock settle at the destination).
The AI narrator (`narrator.ts`) is a skin over the facts; until `ANTHROPIC_API_KEY` is set it
shows the would-be prompt and uses templated lines. The IRC bot polls `/api/bot/tick` (bearer
`BOT_TOKEN`), which settles everyone — courses included — and returns third-person blurbs;
the bot is the world's optional heartbeat, never a dependency. Client-side the story is
**tab-agnostic**: `App.vue` polls `/api/idle` + `/api/log` every 60s (paused while the tab is
hidden, immediate on restore/login), pops the **WhileAway sheet** over any tab when unseen
events arrive, and the **Captain's Log** tab (`CaptainsLog.vue`) is the narrative's home.
Full design: [idle-narrative.md](docs/0-Projects/starwonder-mvp/idle-narrative.md).

### Authoritative server pattern

The client sends **intents** only (move, trade, etc.). Every handler: authenticates → loads the active trader + state (computed baseline + override rows) → validates the intent → applies the change in a `better-sqlite3` synchronous transaction → returns new state. No game outcomes are computed client-side. The intents so far: `POST /api/move` (lane / known-wormhole / blind-jump), `POST /api/course` (plot a course), and `POST`/`DELETE /api/order` (place / scrub a trade order); the next ones (dock services, combat, …) copy the same shape. See the running task list in [`docs/0-Projects/todo.md`](docs/0-Projects/todo.md).

### Trading is an order, worked by the settle (energy is the work clock)

There is no live buy/sell. A trade is an **order intent** — `{ side, commodity, qty,
limit? }`, one per trader, station-scoped on `traders.trade_order` — and the idle sim
works it exactly the way a course is flown: **`settleOrder`** (`game-core/src/idle/order.ts`,
pure) fills it greedily in seeded 1–4 ton chunks, each chunk firing the moment its energy
(`trade_energy_per_unit` × tons) is affordable. A banked pool bursts the order on the spot
(a rested order *feels* live); broke, the regen clock paces the fills. Each chunk haggles
its own price: the trader's **effective** market price (nudges + condition factors — the
rumour loop closes) × a seeded ±12% swing tilted by standing / `charming` / `shady`-at-seedy-ports.
An optional `limit` turns bad rolls into quiet no-deal beats (retry every idle beat).
Orders close short when the hold fills / credits dry up / stock runs out; **completion is
the one newsworthy fact** (the IRC line). Fills are exchanges, not windfalls — they bypass
the idle session's `creditCap` rail. Orders require being **docked**; leaving the dock
(undock, course, or blind jump) scrubs the order — what filled, you keep. Full design:
[trading.md](docs/0-Projects/trading.md).

### The knowledge policy — when the pilot knows what

Three tiers, and **every surface answers from the same tier** (chips, map, banners, log,
narrator — no surface may know more or less than another):

- **Tier 0 — unknown space**: no lane from anywhere you've been. Invisible everywhere.
- **Tier 1 — frontier** (charted-adjacent): a lane runs there from charted space. You know
  it *exists*, *where it lies* (the map's "?"), and its **address** (`#1002`) — never its
  name or nature. Lane chips, the course banner ("Under way to Sector #1002"), and the
  frontier map panel all show the bare address; the name is the arrival reward.
- **Tier 2 — charted** (visited): named and detailed everywhere, permanently.

**Wormholes are the deliberate exception**: at a visited sector you see one exists and its
energy cost (span — yes, that hints at distance; intended flavor), but the far end is fully
hidden — not even an id — until you blind-jump it. Once taken, the far end is Tier 2 and the
chip shows the destination's name like any lane.

**The IRC channel speaks in names, never sector numbers** — gossip knows places, not
coordinates. Inhabited event sites are named (hearing a name ≠ charting it; your own UI
still shows Tier 1 until you visit); empty space is just "the deep black".

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
| `BOT_TOKEN` | `dev-bot-token-…` | Bearer token for `/api/bot/*` (set the same value on the bot) |
| `ANTHROPIC_API_KEY` | *(unset)* | Idle narrator (unused until set — prompt-preview mode) |

## Database

Schema is bootstrapped idempotently via `CREATE TABLE IF NOT EXISTS` on server start (`apps/server/src/db/migrate.ts`). No migration CLI is needed for now — switch to drizzle-kit when the schema starts to churn. SQLite is configured with WAL mode and foreign keys on.

Tables: `world` (singleton, `CHECK (id = 1)`), `config` (key/value knobs — see `apps/server/src/config.ts` registry), `users`, `traders` (now incl. `heat`/`heat_updated_at`, `conditions`, `persona`, `goal`, `trade_order`), `sector_state` (sparse overrides), `stations`, `trader_visited`, `trader_wormholes`, and the idle-narrative set: `dock_sessions` (the live downtime session, 1 row per trader — `kind` 'dock' or 'transit', `route` JSON for a course in flight), `events` (append-only feed — idle/transit beats + course bookends now, moves/trades later), `trader_station` (sparse local reputation), `market_nudge` (time-boxed personal prices). JSON columns (`settings`, `data`, `ship`, `conditions`, `persona`, `goal`, `fact`, …) are opaque blobs — never queried inside — so the schema is Postgres-compatible if the driver is swapped.

## Key files

- `packages/game-core/src/galaxy.ts` — `generateGalaxy`, `sectorView`, `existingSectors`; `fogView` / `fullMapView` (→ `MapView`, the shared map-render shape) + `wormholeExitsAt`
- `packages/game-core/src/hilbert.ts` — pinwheel layout (`SIDE=32`, `N=1024`, Sol at grid centre)
- `packages/game-core/src/energy.ts` — `currentEnergy`, `spendEnergy`
- `packages/game-core/src/danger.ts` — `dangerCurve`, `dangerTier`
- `packages/game-core/src/sector-content.ts` — `generatePlanet`/`generateStation` + `generateMarket` (pure pricing over the `COMMODITY_SPEC` table — gradient × seed noise × a `stockFactor` pinned to 1, the hook for dynamic stock later). **Class-first, distance-neutral**: rolls a `WorldClass` (terran/ocean/desert/ice/lava/barren/gas-giant) from the flat weighted **`CLASS_SPEC`** table — the *single source of truth*: add/remove a class there and the `WorldClass` type, rarity roll, `WORLD_CLASS_INFO` (display label+blurb, shared by game + admin UIs), and stat derivation all follow. Then derives size/gravity/atmosphere/palette/moons from it. World **type ignores distance** — only danger + habitation track `rimT` (names *do* fame-band by distance). Also sets `.name`. Full design: [world-generation.md](docs/0-Projects/starwonder-mvp/world-generation.md).
- `packages/game-core/src/names.ts` — `planetName`/`stationName` (station grammar + `pickFamed`); pools in `data/{world-names,place-names,surnames,first-names,descriptives}.json`
- `packages/game-core/src/idle/` — the idle sim: `settle.ts` (`settleIdle` + `activeModifiers` + `applyDelta`), `transit.ts` (`settleTransit` — energy-paced hop-per-beat courses), `order.ts` (`settleOrder` — energy-paced trade-order fills, the transit trick applied to commerce), `vibe.ts` (`stationVibe`), `types.ts` (incl. `SectorFlavor` — the context gates: `worldClass`/`dangerTier`/`rimT`/`stationType` + `roster`/`at` on `DockContext`), and `modules/` (**one file per dynamic**; `modules/index.ts` = the `IDLE_MODULES` registry + `DOCK_EVENTS`/`ORBIT_EVENTS`/`TRANSIT_EVENTS` pools + `factLine`/`conditionInfo`; `modules/trade.ts` owns the order log lines, `modules/anchor-watch.ts` the starter orbit pool; `modules/util.ts` has the `vIndex`/`vline` line-variant helpers — every outcome carries 3–5 seeded phrasings via `fact.numbers.v`; `modules/vignettes.ts` + `src/data/vignettes.json` = the ~195-row data-driven vignette pool, one resolver, `POOL_SCALE` the pacing knob — see [content-expansion.md](docs/0-Projects/starwonder-mvp/content-expansion.md))
- `packages/game-core/src/conditions.ts` — `Condition` + the clamped `Modifiers` struct (`foldModifiers`, `applyEnergyMods`, `moveCostWith`) — the module-author API contract
- `apps/server/src/idle.ts` — `settleTrader` (dispatch on session kind: transit hops → arrival chains into the dock settle, then any open trade order is worked; load session+stats → pure settle → persist in one tx), heat decay, standing decay, `nudgesAt`, `baselineMarket`/`effectiveMarket` (the trader's personal prices), `orderOf`/`cancelOrder`/`orderViewOf`, `goalOf`, `logEvent`
- `apps/server/src/nav.ts` — `planCourse` (authoritative hop-by-hop course validation + pricing), `whKey`/`allWormholeKeys`/`whCostOpts` (shared with the move intent)
- `apps/server/src/narrator.ts` — `buildNarrativePrompt` (place/setting-generic — works for docks and transit) + templated fallback; the TODO(llm) seam for the future Claude call
- `apps/server/src/routes/idle.ts` — `GET /api/idle` (mode dock/orbit/transit/adrift + story + prompt preview), `POST /api/goal` (trader-level, works anywhere), `POST /api/dock` / `POST /api/undock` (the docked stay is explicit and persistent), `POST`/`DELETE /api/course` (plot / drop out), `GET /api/log?since=` (the poll cursor)
- `apps/server/src/routes/bot.ts` — `POST /api/bot/tick` (bearer `BOT_TOKEN`): settle every trader (docks + courses), return new events as IRC blurbs
- `apps/bot/src/` — the IRC daemon (`irc.ts` minimal client + `index.ts` poll loop; cursor persisted to a JSON file)
- `apps/web/src/components/game/CaptainsLog.vue` — the Log tab: current session card (story, goal, prompt preview) + the full event history in chapters by place
- `apps/web/src/components/game/WhileAway.vue` — the "while you were away" sheet App.vue pops over any tab when the 60s poll (or a fresh login / restored tab) finds unseen events
- `apps/web/src/components/game/GoalEditor.vue` — the trader-level downtime-goal selector (shared by CaptainsLog + WhileAway)
- `apps/web/src/components/game/DockPanel.vue` + `DockScene.vue` — **the canonical docked screen** (OrbitPanel's counterpart): the procedural pixel dock-bay scene (bay window with the host world outside, station-hued girders, landing pad with the trader's own ship, crates/gantry/crew, blinking approach lights — a pure function of (sector, station)) + the "Berthed" card (station icon, standing/heat, Undock). The vibe overlays the scene; the narrative deliberately lives in the log, not here
- `apps/server/src/galaxy.ts` — in-process world cache (`getWorld`, `invalidateWorldCache`)
- `apps/server/src/config.ts` — the `CONFIG_SPEC` registry + typed `getConfig`/`setConfig`/`allConfig` (missing key ⇒ default; upsert to override)
- `apps/server/src/session.ts` — session claims (`{ uid, activeTraderId }`), cookie sign/clear, `loadActiveTrader`, `visitedSet`/`takenWormholes`, and `buildMe` (the reshaped `me`)
- `apps/server/src/routes/game.ts` — public `/api/universe` (`{ exists, costs }` only), trader-aware `/api/sector/:id` (the named `traders` "also here" roster rides ONLY for the viewer's current sector — remote charted sectors get presence counts on the map, never names; admin `?admin=1` sees all), fogged `/api/map` (with `presence`: sectorId→count of other traders in charted space), and the `/api/move` + `POST`/`DELETE /api/order` intents
- `apps/server/src/routes/admin.ts` — `/api/admin/big-bang` / `clear` (write/wipe `world`, preserve `config`), `/api/admin/universe` (full seed+settings), `/api/admin/users` (accounts + nested traders), `/api/admin/presence` (sectorId→trader count for the map), `/api/admin/config` GET/PUT; all gated via `requireAdmin` (`users.isAdmin`)
- `apps/server/src/routes/auth.ts` — register / login / logout / me + trader create/select (gate password + argon2id + JWT cookie)
- `apps/web/src/api.ts` — typed fetch wrappers for all server endpoints
- `apps/web/src/App.vue` — hash router + auth gating + game shell (sector/map/ship/log tabs; **while docked, the sector tab IS the dock tab** — label flips to "dock" and `DockPanel` + `DockActivity` + `DockMarket` replace the orbit view until you undock or set out); HUD reads `me.activeTrader`; owns the 60s downtime poll (visibility-aware), the WhileAway sheet, the transit banner, and the single travel mechanic: every journey is a course (`setCourse`) — the map's "Set course" and the sector tab's lane/known-wormhole taps (1-hop courses) alike; only blind wormhole jumps still go through `/api/move`
- `apps/web/src/components/game/PilotScreen.vue` — create/select a trader (shown when a world exists but no trader is active)
- `apps/web/src/components/game/DockActivity.vue` + `DockMarket.vue` — dock time as ACTIVITIES, not forms: `DockActivity` is the hub — things-to-do chips first ("Buy & Sell" opens the market sheet owned by App.vue, wrapping `DockMarket`: listings → per-commodity ticket; the rest one-tap set the trader goal, labels shared with `GoalEditor` via `goals.ts`; ONE color rule — a lit chip is active now), then the working errand card (progress/ETA/Scrub) and/or the status card (the goal as a doing + the latest few log lines + "more ››" into the Log). Future dock activities ("Go pickpocketing", …) land as more chips. All microcopy stays in the terse ship's-log voice — never conversational
- `apps/web/src/components/admin/ConfigPanel.vue` — admin Settings tab: view/edit the live `config` knobs
- `apps/web/src/controllers/AdminExplorer.vue` — admin Galaxy Explorer (map + table browser)
- `apps/web/src/components/game/OrbitViewport.vue` — the canvas viewport: planet (size scales with diameter, log-mapped — see `MIN_SCALE`), station wheel, and overlays (name top-left, world-type toast top-right, stats line bottom)
- `apps/web/src/components/game/OrbitPanel.vue` — **the canonical sector screen**: `OrbitViewport` + the "In orbit" station card (`StationIcon.vue`, the wheel glyph shared with `DockPanel`) + an "Also here" roster of other traders parked in the sector (each with a `ShipIcon`). Used verbatim by both the game `#sector` tab (`App.vue`) and the admin inspector (`SectorDetail.vue`) — see the shared-presentation rule below
- `apps/web/src/components/game/ship.ts` + `ShipIcon.vue` — procedural voxel-ship sprite (ported from mockup-d's `makeSprite`); a trader's hull + hue are a pure function of its name. Used by the "Also here" roster. (The blue "players here" map marker is drawn directly in `StarChart`/`GalaxyMap` from the `presence` map.)
- `apps/web/src/components/game/SectorDetail.vue` — admin wrapper: `OrbitPanel` + a sector/danger header + a debug footer (grid, jumps, lanes)
- `apps/web/src/components/admin-big-bang/GalaxyMap.vue` — the **shared** canvas map; renders a `MapView`, deriving a full one from a `galaxy` prop (admin) or taking a fogged `view` (player); clickable + `selected`/`current` rings

## Frontend & routing

`App.vue` is a tiny **hash router** gated by auth state. Pages: `login`/`register`,
`admin`, and game tabs `sector`/`map`/`ship`/`log` (the sector slot renders — and is
labelled — **dock** while the trader is docked). `#admin` resolves to **two**
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
- `todo.md` — the live, checked-off task list (what's done, what's next); `trading.md` — the trade design (the commodity price field + energy-paced trade orders).
- `starwonder-mvp/content-expansion.md` — the plan for scaling idle content (line variants → context gates → the data-driven vignette pool → flag-payoff chains).
- `starwonder-mvp/mockups/*.html` — UI references (`d-modern-voxel.html` = `#sector`, `map-admin.html` = map).
