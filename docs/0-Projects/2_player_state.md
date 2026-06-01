# Item 2 — Movement & player state

> **Status:** planned. Companion to [todo.md](todo.md) #2. Depends on **#1** (active trader in
> the session) and **#0** (config knobs). This is the first real player **intent** — its handler
> is the template every later action (trade, combat) copies, so getting the shape right matters
> more than the feature itself.

## Scope

- **In:** single-hop moves — click a warp → jump to one *adjacent* sector. Spend energy per jump.
  Record visited sectors and traversed wormholes. Hide un-taken wormhole destinations. The minimal
  "warps" UI in the `#star` tab. And the authoritative **intent-handler + response template**.
- **Out:** multi-hop route plotting / autopilot → **#5**. The fog-of-war *player map* and locking
  down galaxy knowledge → **#4**. Danger having consequences, interdiction → **#7 / #10**
  (here danger is display-only).

## The intent template (the real deliverable)

`POST /api/move` establishes the pipeline all future intents reuse:

1. **Authenticate** (`jwtVerify`).
2. **Load** the active trader from the session (post-#1).
3. **Validate** the intent against the computed galaxy + trader state.
4. **Apply** in a single synchronous `better-sqlite3` transaction.
5. **Return** the new authoritative state, so the client re-renders with no second fetch.

Today, `jumpTo(id)` in `App.vue` only *fetches* a sector view (`api.sector(id)`) — a free browse
that doesn't move anyone or cost energy. #2 replaces it with a move that mutates position
server-side and settles energy.

## Movement rules

- A legal move targets a sector in `g.adj[current]` that **exists** (reachable from Sol). `adj`
  already merges open lanes + wormholes, so the adjacency check is a single lookup.
- **Instantaneous, energy-gated** — no travel timers (consistent with the no-timer energy model).
  Energy is the turn economy; a jump is the unit.
- Cost is deducted via `spendEnergy`; the move is rejected if the trader can't afford it.
- Movement can't be blocked or interdicted yet.
- A new trader starts at Sol (sector 0), `visited = {0}`.
- **Lane destinations are visible** (you can see the IDs of adjacent sectors), **wormhole
  destinations are not** — see below. That asymmetry is the design.

## Wormholes are different

1. **Hidden destination until traversed.** A trader's sector view reveals a wormhole's far end
   only if that trader has taken it before. An unexplored wormhole shows that a wormhole *exists
   here* plus an opaque handle — never the destination ID. The **first traversal is a blind jump**;
   on arrival the destination is recorded and is thereafter visible from **both** ends.
2. **Its own energy knob.** `wormhole_energy_cost`, separate from the lane cost — set to 1 for now,
   but deliberately split so wormholes can feel different later.

This is why the move intent can't always be `{ to: sectorId }`: for an unexplored wormhole the
client *doesn't have* the destination ID. So the per-trader sector view exposes exits as:

- **lanes** — `{ kind: 'lane', to }` (destination always visible)
- **known wormholes** — `{ kind: 'wormhole', known: true, to }`
- **unexplored wormholes** — `{ kind: 'wormhole', known: false, ref }` — an **opaque** handle
  (the wormhole's index in the galaxy's `wormholes[]`, which carries no destination in its text)

…and the move intent is `POST /api/move { to }` for a lane / known wormhole, or
`{ wormhole: ref }` for an unexplored one. The server resolves `ref` → destination authoritatively.

## Schema (on the post-#1 `traders` model)

Two sparse join tables, same pattern as `sector_state`:

**`trader_visited`** — the seed of fog-of-war (#3):

| column | type | notes |
|---|---|---|
| `traderId` | int FK → traders | PK part |
| `sectorId` | int | PK part |

**`trader_wormholes`** — which wormholes a trader has taken (reveals the destination):

| column | type | notes |
|---|---|---|
| `traderId` | int FK → traders | PK part |
| `aSector` | int | PK part; canonical `a < b` |
| `bSector` | int | PK part |

Not derivable from `trader_visited`: you can visit both endpoints via lanes and still not *know*
the wormhole links them. Knowledge is specifically "I took this wormhole."

## Config knobs (registered in #0's registry)

| key | type | default | notes |
|---|---|---|---|
| `move_energy_cost` | int | `1` | energy per lane jump |
| `wormhole_energy_cost` | int | `1` | energy per wormhole jump (may diverge later) |

Both live-tunable; both go in the item-0 config registry rather than being hardcoded.

## Server changes

- **`POST /api/move`** — the intent. Body `{ to }` or `{ wormhole: ref }`. Pipeline above. On
  success, in one transaction: set `currentSector`, settle-and-spend energy, upsert
  `trader_visited(to)`, and (if a wormhole) upsert `trader_wormholes`. Returns
  `{ trader: { currentSector, energy, energyCap, credits }, sector: <trader-aware view> }`.
  Errors: not-a-neighbour (400), insufficient energy (402/409), no active trader (409).
- **`/api/sector/:id` becomes trader-aware** — for a player with an active trader it hides
  unexplored wormhole destinations (filtered by `trader_wormholes`); admins and the anonymous/no-trader
  case keep full visibility (today's behaviour). *(Restricting players to only their **known**
  sectors is #4, not here.)*
- `SectorView` (the `api.ts` type) gains the `exits` shape above; `wormholes` stops being a bare
  destination-ID list for players.

## Client / UI — the `#star` tab (`App.vue`)

- `jumpTo` → `move()`: `POST /api/move`, then update `me` (`energy` / `credits` / `currentSector`)
  and `sector` straight from the response — no extra round-trip.
- Existing **"Warp lanes"** strip: lane buttons unchanged (show `#dest`). Wormhole buttons show the
  destination only when **known**; otherwise render `◌ Wormhole · unknown`. Replace the hardcoded
  `1 ⚡` / `3 ⚡` labels with the config-driven costs.
- Grey out / disable a warp button when `energy < its cost`.
- The header energy bar reflects the post-move value returned by the intent.

## The seed-exposure caveat (important)

`/api/universe` returns `seed` + `settings`, so any client can run `generateGalaxy(settings)` and
know the **entire** galaxy — including every wormhole's endpoints — which defeats hidden
destinations (and, later, fog-of-war). For #2 we implement the hiding **correctly server-side**
(the per-trader API never emits an un-taken destination), and accept that a determined player could
still recompute it until we lock the seed down. That lockdown — make the seed server-secret,
restrict `/api/universe`'s `settings` to admins (the AdminExplorer keeps full visibility; players
get a non-spoiling subset) — is **bundled with #4**, where hidden info becomes load-bearing and the
player map is reworked anyway. Until then it's honor-system, which is fine for a friends game (same
reasoning as the trader cap).

## Migration / out of scope

- New tables via `CREATE TABLE IF NOT EXISTS`; no data migration (pre-launch nuke).
- `traders` table + `ownerPlayerId → ownerTraderId` → **#1**. Route plotting / autopilot → **#5**.
  Fog-of-war map + seed lockdown → **#4**.

## Open questions

- Fold the **seed lockdown** into #2 now, or leave it in #4 as written? Lean: **#4** — it's
  coupled to reworking the player map, and shipping it early would break the current `#map` tab
  before its replacement exists.
- Confirm both costs stay at **1** for the first cut (decided: yes, tunable later).
