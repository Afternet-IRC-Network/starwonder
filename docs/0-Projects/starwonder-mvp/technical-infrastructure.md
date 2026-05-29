# StarWonder — Technical Infrastructure

How StarWonder is built, hosted, and kept cheap. Companion to the
[Gameplay Overview](gameplay-overview.md).

> **Status:** the MVP stack below is **scaffolded and running** — a pnpm monorepo
> (`packages/game-core`, `packages/shared`, `apps/server`, `apps/web`) with the deterministic
> engine ported, gate-password auth, SQLite via Drizzle, and the Vue app served by the backend.
> See §14 for the repo layout and §3 for the stack.

---

## 1. Guiding constraints

- **Cheap to run** → rides an existing AfterNET VM; effectively $0.
- **Ambient turn pacing** → almost no live server load; a single small process is plenty.
- **Phone-first, visually simple** → light Vue frontend, served by the same backend.
- **Authoritative server** → all game state and rules live server-side; the client is a thin
  renderer (anti-cheat 101 for a game with PvP and economy).
- **One language end-to-end** → TypeScript everywhere, so the deterministic galaxy engine is
  shared verbatim between server, tests, client, and (later) the IRC bot.
- **Portable persistence** → SQLite now, swappable to Postgres later without a rewrite.
- **IRC bot** → can ride the same process on Nefarious2 (§7); not a forcing constraint.

---

## 2. The shape we chose: one small app, not a fleet of providers

Because the galaxy is a **pure function of `(seed, settings)`** (§8, §11), StarWonder is barely
a database app — it's a deterministic generator with a thin layer of overrides on top. That
makes the honest MVP size **a single Node/TypeScript process** that does the API, serves the
frontend, and (later) holds the IRC connection, with a **SQLite file** for the small mutable
state. It runs in **one Docker container on an existing VM**.

Why this over the earlier serverless (Netlify + Supabase) sketch:

- **We have VMs.** An always-on process is free for us, which removes the only real reason to
  go serverless. One deploy, one log stream, no cold starts, no provider juggling.
- **The data is tiny and computed.** A new galaxy is ~one row; the DB grows only where players
  change things. SQLite handles this trivially and the whole engine runs in-process.
- **Portability is built in.** Persistence goes through **Drizzle ORM**, and we keep the schema
  to **indexed scalar columns + opaque JSON payloads** (we never query *inside* JSON, which is
  where SQLite and Postgres diverge). Switching to Postgres later — including Supabase, which is
  just Postgres — is a config/driver change, not a rewrite.

The serverless design isn't wrong; it's just more moving parts than this game needs to start.

---

## 3. The stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Vue 3 + Vite + Tailwind** | Light, phone-friendly, great DX. Palette/components seeded from the `d-modern-voxel` mockup. |
| Frontend state | **Pinia** (when needed) | Official, tiny; not required for the MVP shell yet. |
| Backend | **Node 20+ · Fastify 5 (TypeScript)** | Fast, first-class TS, schema validation, trivial static serving. |
| API style | **REST + zod** | Plain HTTP endpoints validated with zod; easy to hit from the IRC bot or curl. |
| DB access | **Drizzle ORM** | Type-safe schema-in-TS; one driver swap goes SQLite → Postgres. |
| Database | **SQLite** (`better-sqlite3`) now; **Postgres** later | Single file on a volume; sync + fast; perfect for a single-process game loop. |
| Auth | **Gate password → handle + password** (argon2id), **session cookie** (`@fastify/jwt`) | MVP: one shared password lets anyone create an account. Seam for OAuth/SAML later (§ auth). |
| Frontend hosting | **served by the backend** (`@fastify/static` + SPA fallback) | One origin, one deploy. Vite dev server proxies `/api` in development. |
| World tick | **in-process scheduler** (`setInterval` / a tiny cron) | No external scheduler; the process is always on. |
| IRC bot | **Node + `irc-framework`**, same process (or a sidecar) | Persistent connection on Nefarious2; read-only commands for MVP (§7). |
| Packaging | **Docker** (multi-stage) on an AfterNET VM | One image builds the frontend and runs the server; SQLite on a named volume. |
| Runtime | **`tsx`** | Runs the TS server directly (dev and prod) — no separate build step for the backend. |
| Tests | **Vitest** | Pins the deterministic engine (`game-core`) — the highest-leverage test target. |

### Alternatives considered

- **Serverless (Netlify + Supabase):** valid and scale-to-zero, but more providers than this
  game needs given we already have always-on hardware. Kept as a future option (the game logic
  is host-agnostic — it lives in `packages/game-core`).
- **tRPC instead of REST:** great end-to-end types, but REST keeps the bot/curl surface simple;
  zod still gives us validated, typed payloads.
- **Prisma / Kysely instead of Drizzle:** Prisma is heavier in Docker (engine binary); Kysely is
  leaner but you hand-roll migrations. Drizzle balances type-safety, migrations, and the
  SQLite↔Postgres swap.

---

## 4. Architecture

```
                          ┌─────────────────────────┐
       phone / browser    │   Vue 3 + Tailwind SPA   │
       (thin client) ───► │  (built, served by the   │
                          │   same Node process)     │
                          └───────────┬──────────────┘
                                      │ HTTPS  /api/*  (REST + zod)
                                      ▼
                          ┌─────────────────────────────────────┐
                          │   Fastify (TypeScript) — one process │
                          │   · authoritative API (validate +    │
                          │     apply rules, spend Energy)       │
                          │   · serves the built SPA             │
                          │   · in-process world tick            │
                          │   · (later) IRC connection           │
                          │   · imports @starwonder/game-core    │  ← computes the
                          └───────────┬─────────────────┬────────┘     galaxy baseline
                                      │ Drizzle (SQL)    │                from seed+settings
                                      ▼                  ▼
                          ┌────────────────────┐   ┌──────────────┐
                          │  SQLite file        │   │  IRC channel │
                          │  (overrides only:   │   │  (Nefarious2)│
                          │  universes, players,│   └──────────────┘
                          │  sector_state, …)   │
                          │  on a Docker volume │
                          └────────────────────┘
```

**Data flow in one line:** client sends an intent → Fastify validates it against the
authoritative state (galaxy baseline *computed*, overrides *read* from SQLite) → applies the
change in a transaction → returns new state (and writes an `events` row the IRC bot can narrate).

---

## 5. Authoritative game logic

**Rule of the project: the client never decides game outcomes.** It renders state and sends
*intents* ("move to sector X", "buy 50 organics"). An API handler:

1. **Authenticates** the player (session cookie / JWT).
2. **Loads** relevant state (compute the sector baseline from `game-core`; read any overrides).
3. **Validates** the intent (cardinal neighbour & lane open? enough Energy? port has stock?).
4. **Applies** the change in a **transaction** (debit Energy, move ship, adjust prices).
5. **Writes** an `events` row for anything noteworthy (feeds the client feed + IRC).

Energy regen is computed **server-side from timestamps**, never trusted from the client: we
store `energy` + `energy_updated_at` and regenerate lazily on read/write. This lives in
`game-core` (`currentEnergy` / `spendEnergy`) so no cron is needed just for Energy — the world
tick is only for *world* changes.

### Sketch: a move action (next to build)

```
POST /api/move  { toSectorId }
  → auth player (session cookie)
  → regen energy from timestamps
  → assert toSector exists AND is a neighbour of the player's sector
        (lane or wormhole — both come from game-core's computed adjacency)
        AND  energy >= cost
  → tx: energy -= cost; player.current_sector = toSector; energy_updated_at = now
  → resolve arrival (danger tier → encounter? toll?) and write events
  → return new state
```

---

## 6. The world tick

An **in-process scheduler** (a `setInterval`, or a small cron lib) runs the background
simulation players don't drive — no external scheduler, since the process is always on:

- **Light tick (~every 15 min):** move NPC ships one hop along their routes; drift port prices
  toward equilibrium; resolve any NPC encounters.
- **Heavy tick (hourly / daily):** accrue planet production; restock ports; spawn/despawn NPCs
  to target density; decay deployed fighters/mines; emit the daily IRC digest.

Each tick is one transaction batch and writes `events` rows so the world's changes show up in
clients and on IRC. Keep ticks **idempotent and cheap** — with ~1000 sectors and a handful of
NPCs this is trivial compute. (For MVP the tick can be omitted entirely; lazy Energy regen and
on-read computation cover the basics until there's a living economy to tick.)

---

## 7. IRC bot

On a **Nefarious2** network (AfterNET) the bot can simply **ride the same Node process** with a
persistent SASL-authenticated connection — no bouncer/poll dance needed, since the process is
always on. (It can also be split into a sidecar process sharing the same SQLite file / `game-core`.)

- **Lib:** **Node.js + `irc-framework`** (SASL + IRCv3; WebSocket transport available).
- **Outbound (announce):** subscribe to new `events` and narrate them to the channel, with a
  verbosity filter + rate limiter; batch the daily digest.
- **Inbound (commands):** `!status`, `!leaderboard`, `!map`, `!bounties`, `!whereis` — all
  **read-only** for MVP (no game actions from IRC) to keep the security surface small.
- **Identity:** map IRC accounts to players. Once game login moves to AfterNET accounts
  (§ auth), this mapping is automatic; until then, an opt-in `!link <code>` flow.
- **Be a good netizen:** SASL-authed account, sane cadence, no reconnect storms (it's *our*
  network).

> **Nefarious2 bonus:** its built-in bouncer + IRCv3 `CHATHISTORY` also make a *stateless*
> connect→pull-history→act→quit bot viable, if we ever want the bot to not be always-on. Not
> needed while it rides the main process.

---

## 8. Data model (first cut)

Tables live in **SQLite now (via Drizzle)** and are written to stay **Postgres-compatible**:
indexed scalar columns for anything we filter on, plus **opaque JSON columns** (`*_json`) for
flexible blobs we never query *inside*. Names indicative; tune as you build.

### Galaxy = seed + settings + sparse overrides (key decision)

The galaxy is **not materialised** row-by-row. A universe is a **seed plus generation
settings**; every sector's *baseline* (coords, region, habitation overlay, lane open/blocked,
wormhole endpoints, initial station/planet class, initial NPC seeds) is a **pure function of
`(seed, settings, sector_id)`** computed in `game-core` on demand (§11). The DB stores only:

1. the **universe config**, and
2. **sparse override records** for the few sectors/entities that have *diverged* from their
   algorithmic baseline (a station built, prices drifted, a planet captured, a mine dropped).

So a brand-new galaxy is ~one row, and the DB grows only where players actually change things —
no 1024-row star table, no edge tables, nothing to keep in sync with the generator.

**Scaffolded today** (in `apps/server/src/db/schema.ts`):

```
universes      (id PK, seed, settings_json, status, created_at)
                 -- settings_json = the admin's slider values (§11):
                 --   { inhabitedProb, laneP, coreBias, wormholeCount, planetProbs, npcDensity, ... }
players        (id PK, handle UNIQUE, auth_provider, external_id, password_hash,
                credits, energy, energy_updated_at, current_sector, ship_json, created_at)
sector_state   (universe_id, sector_id, data_json, PK(universe_id, sector_id))  -- override layer
stations       (id PK, universe_id, sector_id, type, owner_player_id, data_json)
```

**Planned as features land** (same seed+overrides philosophy):

```
ships          (id PK, owner_player_id, class, sector_id, hull, shields, fighters,
                cargo_holds, cargo_json, warp_level)   -- may start folded into players.ship_json
ports          (universe_id, sector_id, stock_json, price_json, updated_at)   -- lazy on first trade
planets        (universe_id, sector_id, owner_player_id, owner_corp_id,
                production_json, defenses_json, citadel_level)   -- lazy on first claim
deployables    (id PK, universe_id, sector_id, owner_player_id, kind {fighter|mine}, qty)
npcs           (id PK, universe_id, kind {trader|pirate}, ship_json, sector_id,
                route_json, ai_state)        -- materialised: NPCs move every tick
corps          (id PK, name, founder_player_id)
events         (id PK, ts, kind, actor, target, sector_id, payload_json,
                irc_announced, severity)     -- backbone of the live feed + IRC
```

- **Derived, never stored:** sector coords/region, habitation, **lanes** (hash of `seed·min-max`,
  core-bias-tilted), **wormholes** (seeded), danger, initial station/planet/NPC layout. A "read
  sector" = compute baseline from `(seed, settings)`, then apply its override rows if any exist.
- **`events` is central:** every interesting state change writes one. Clients poll/subscribe for
  the live feed; the IRC bot announces from it; it's also the audit log / debugging trail.
- **Authorization is app-level:** handlers decide what a player may read/write (their ship,
  public sector/port info, events involving them) — no DB row-level security to lean on, so the
  authoritative-handler discipline in §5/§13 does the work.
- **Auth columns:** `auth_provider` (`'local'` now) + nullable `external_id` are the seam for
  OAuth/SAML accounts to slot in beside local ones later — no migration churn.
- **Indexes:** `sector_state(universe_id, sector_id)` (PK), `stations(universe_id, sector_id)`,
  later `ships(sector_id)`, `npcs(sector_id)`, `events(ts)`. (No star/lane tables — they don't
  exist.)

### Migrations

MVP bootstraps the schema with idempotent `CREATE TABLE IF NOT EXISTS` on boot
(`apps/server/src/db/migrate.ts`) to keep the Docker image free of a migration CLI. Hand off to
**drizzle-kit** migrations once the schema starts to churn.

---

## 9. Hosting & cost

| Piece | Role | Reality |
|-------|------|---------|
| **AfterNET VM** | runs the Docker container (API + SPA + tick + bot) | Existing hardware; effectively **$0**. |
| **SQLite file** | all mutable state | On a Docker **named volume** so it survives restarts/redeploys. |
| **Domain / TLS** | optional | A subdomain on existing infra; TLS via the VM's reverse proxy (e.g. nginx/Caddy) in front of the container. |

**Net:** effectively **$0/yr** on hardware we already run. Deploy is `docker compose up --build`
(or build the image in CI and `docker run` it).

- **Reverse proxy:** terminate TLS at the VM's proxy and forward to the container's port; set a
  long-lived `SESSION_SECRET`.
- **Backups:** periodic copy of the SQLite file (it's one file) — e.g. a nightly
  `sqlite3 .backup` / file snapshot to off-box storage. Especially player state + `events`.
- **Scaling later:** if it ever outgrows one box or one file, swap Drizzle's driver to Postgres
  (self-hosted on the VM, or Supabase) — the schema and game logic don't change.

---

## 10. Deferred / future options

These were in the original serverless plan and remain valid if priorities change — none are
needed for the MVP:

- **Serverless (Netlify + Supabase):** scale-to-zero, zero-maintenance hosting. Because all game
  logic is in `packages/game-core`, the host is a swappable detail.
- **Auth via AfterNET accounts (planned upgrade):** since players are IRC friends, logging in with
  an **AfterNET account (SASL / account name)** — or OAuth/SAML to our auth server — neatly solves
  identity and makes the IRC↔player mapping automatic. The MVP **gate password** is the
  placeholder until then; `auth_provider`/`external_id` are already in the schema for it.
- **In-channel per-user presence:** spinning up a per-player "you" presence in the game channel
  is a fun *"the game is the channel"* feature (esp. with Nefarious2 WebSockets), but a single
  game bot is simpler for routine announces. Park per-user presence for a later phase.

---

## 11. Universe generation & persistence

**The galaxy is computed, not stored** (§8). Generation lives in `game-core` as pure functions
of `(seed, settings, sector_id)` — and is now implemented and unit-tested (it matches the
`map-admin.html` mockup bit-for-bit, sharing the same hash keys):

1. **Pinwheel layout** → four order-4 Hilbert curves meeting at the centre, so **Sol = Sector
   #0** is dead-centre; gives each sector its `(x,y)`, region (1–16), and arm.
2. **Habitation overlay** — a per-sector probability roll (`inhabitedProb`) marks each sector
   **inhabited** (a settled star system) or **uninhabited** (empty deep space); uninhabited
   sectors stay travellable waypoints.
3. **Lanes** — for each cardinal-neighbour pair, open iff `hash(seed·min-max) / MAX < p_eff`,
   where `p_eff = clamp(laneP · (1 + coreBias·(0.5 − t)), 0, 1)` tilts the open prob by the
   lane's normalised distance-from-Sol `t` (centred at `t=0.5`, so the mean stays ≈ `laneP`):
   **denser core, frayed rim** (stateless, bidirectional — no stored edges).
4. **Wormholes** — ~`wormholeCount` seeded long-range, distance-biased edges.
5. **Void / reachable set** — BFS from Sol over open lanes + wormholes; **sectors Sol can't
   reach simply don't exist** (inhabited or not, no lanes or wormhole — blank). The universe *is*
   Sol's reachable set; the frontier dissolves into void rather than leaving orphan islands.
6. **Danger** — derived from the same Sol-distance field on a curve (`danger = t^1.7`), bucketed
   Peaceful → Medium → Dangerous → Very dangerous (inner ⅓ / middle ⅓ / next ⅙ / outer ⅙).
   Drives later spawn/loot/economy risk; the frontier is lucrative *and* lethal.
7. **Stations / planets / NPC spawns** — placed by sector/star type from the seed (probabilities
   are admin settings), with a guaranteed safe **home Haven at/near Sol**.
8. **Acceptance check** — unreachable cells are *void by definition* (not a seed to reject), so
   the only screen is **size**: ensure Sol's reachable set is large enough to be a galaxy (a
   pathological seed could strand Sol in a tiny pocket). The admin readout/seed-finder surfaces
   it. A smaller-but-whole universe is fine.

### The admin "universe builder"

Admins create a universe through a screen like the [`map-admin.html`](mockups/map-admin.html)
mockup — a live map plus **tabbed settings** (galaxy/lanes today; planet probabilities, NPC
density, economy, factions as features land). The admin tunes sliders, watches the connectivity
/ reachable-size / danger readouts, picks a seed whose reachable universe is a healthy size
(there's a seed-finder), and **saves `{seed, settings}` as the active `universes` row.** That
single row *is* the generated galaxy — no batch write.

### Live state = baseline + overrides

Reading a sector = **compute its baseline** from `(seed, settings)`, then **apply any override
rows** (`sector_state` / `stations` / later `ports` / `planets`) on top. The first time something
changes a sector, a handler writes its override row; untouched sectors never get one. New
**seasons** = a new `universes` row with a fresh seed (its overrides retire with it). All of this
stays in `game-core` so the server, the tick, the bot, and the admin mockup agree bit-for-bit.
Full map/travel rationale: [Fractal Galaxy Map](../../2-Resources/fractal-galaxy-map.md).

---

## 12. Live updates to the client

- **MVP: polling.** Given the slow pacing, the open tab can refresh on a 30–60s timer (or after
  each action). Dead simple, no extra infra.
- **Later: server push.** A `GET /api/stream` **SSE** endpoint (or a WebSocket) fed by the
  `events` table upgrades the feed to live when it's worth it. Easy to add to the always-on
  process; no third-party realtime service required.

---

## 13. Anti-cheat & integrity

- All outcomes server-side; client sends intents only (§5).
- Energy/regen computed from server timestamps; never accept client-reported energy.
- **Rate-limit** action endpoints (Energy cost is the main natural limiter, but also cap
  requests/sec to stop scripted hammering — `@fastify/rate-limit`).
- App-level authorization so a player can't read others' private state (cargo, exact location)
  beyond what the game intends to reveal.
- IRC commands are **read-only** and privacy-gated.
- Validate every economic transaction inside a DB transaction to prevent races (double-spend of
  credits/energy/cargo). `better-sqlite3` transactions are synchronous and atomic.
- Argon2id password hashing; signed, httpOnly session cookies; the gate password keeps casual
  signups out until real account auth lands.

---

## 14. Dev & deploy workflow

**Monorepo** (pnpm workspaces):

```
packages/game-core   deterministic galaxy + rules (pure TS, Vitest) — shared by everything
packages/shared      zod DTOs + shared types (register/login/me, …)
apps/server          Fastify + Drizzle/SQLite + argon2 auth + game-core read APIs;
                     serves the built web app in production
apps/web             Vue 3 + Vite + Tailwind (palette from d-modern-voxel)
Dockerfile           multi-stage: build the frontend, run the server (tsx)
docker-compose.yml   container + named volume + env
```

- **Shared `game-core`** keeps the rules in *one* place, unit-tested in isolation (galaxy
  determinism, energy regen, later combat/pricing). Highest-leverage test target.
- **Local dev:** `pnpm install` then `pnpm dev` → Vite serves the web app on `:5173` and proxies
  `/api` to the Fastify server on `:8080`. SQLite file is created under `./data` on first run.
- **Prod / Docker:** `docker compose up --build` → one container on `:8080` serving API + SPA,
  with SQLite on a named volume. Put it behind the VM's TLS reverse proxy.
- **Config (env):** `PORT`, `DATABASE_FILE`, `GATE_PASSWORD`, `SESSION_SECRET`, `DEFAULT_SEED`
  (see `.env.example`). The server validates these with zod at boot.
- **Migrations:** idempotent bootstrap now; drizzle-kit when the schema churns (§8).

### Auth (MVP detail)

Registration is gated by a **shared password** (`GATE_PASSWORD`, e.g. `afternet`): anyone with it
can create a `handle` + `password` (argon2id) — **no email or other PII collected**. Login issues
a signed, httpOnly **session cookie** (`@fastify/jwt`). The eventual move to **OAuth/SAML against
our auth server** (or AfterNET accounts) drops in via `auth_provider` / `external_id` without a
schema change, and lets us turn the gate off.

---

## 15. Open questions / risks

1. **Sol habitation** — the generator currently doesn't force Sol (#0) to be inhabited, so for
   some seeds the home sector is "uninhabited." Likely want to **force `inhabited[0]=1`** (and a
   home Haven) — decide and update `game-core` + the mockup together.
2. **Auth upgrade path** — when do we move off the gate password to AfterNET accounts / OAuth /
   SAML? (Schema seam is already in place.)
3. **World tick** — needed for MVP, or defer until there's a living economy? (Lazy Energy regen
   covers the basics without it.)
4. **Live updates** — polling for MVP; when is SSE/WebSocket worth adding?
5. **IRC bot shape** — ride the main process (persistent connection) vs. a sidecar; confirm the
   bot's AfterNET account, SASL creds, and channel; command set + cadence.
6. **Backups** — schedule the SQLite snapshot to off-box storage; test a restore.
7. **Postgres cutover** — define the trigger (load, multi-instance, or wanting Supabase's
   extras) and verify the Drizzle driver swap end-to-end before we need it.
