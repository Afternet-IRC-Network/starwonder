# Item 4 — Fog-of-war map (+ seed lockdown)

> **Status:** built, then revised. Companion to [todo.md](todo.md) #4. Builds directly on **#2**'s
> `trader_visited` / `trader_wormholes` tables (the knowledge it consumes) and **#1** (per-trader
> session). **Resolves the seed-exposure caveat deferred from #2 and #3** — fog is theatre until
> the seed is server-secret, so the two ship together. The per-trader *knowledge model* started
> here is the same one **#5** (route/map intel) and **#11** (map sharing) extend.
>
> **⚠️ Revision (post-build): the frontier tier was dropped.** The original design lit up
> visited sectors' lane-neighbours as dim "something's here" dots. In play that read as
> confusing — a sector appeared "found" (a dot on the chart) *before* you travelled to it, which
> fought with the "new system charted" arrival toast (especially when the dots popped at the far
> end of a lane/wormhole you'd just taken). So `fogView` now returns **visited sectors only**
> (plus the lanes between them and taken wormholes); there is no frontier pre-reveal. You still
> see your immediate exits on the **star screen** (lane chips list the destination *ids* as `?`),
> so you can always step into the unknown — you just learn what's there by arriving. The map
> renderer is now `apps/web/src/components/game/StarChart.vue` (the voxel starfield), not the admin
> `GalaxyMap`. Sections below that describe the "frontier" tier are kept for history but no longer
> reflect the shipped behaviour.

## Scope

- **In:** a real player **`#map` tab** (a stub today) that shows only what the active trader has
  seen — visited sectors in full, their immediate frontier as dim "something's here" dots, the rest
  dark. Server-authored. And the **seed lockdown** that makes that hiding real: the public API stops
  handing clients `seed` + `settings`, so a client can no longer recompute the galaxy.
- **Out (hooked, not built):** *partial intel* — sectors you've heard about but never visited
  (bought map data, scouted routes) → **#5**, likely its own screen rather than a fog tier here; the
  fog enum just leaves room. Multi-hop route plotting on the map → **#5**. Sharing your map with a
  partner → **#11**. Danger having teeth → **#9 / #10**.

## Why this is two inseparable halves

1. **The player map doesn't exist.** `#map` is `coming soon`; the only map in the app is the admin
   Explorer's `GalaxyMap`, which draws the **whole** galaxy because the admin is omniscient.
2. **The galaxy is currently public.** `/api/universe` returns `seed` + `settings`, and the admin
   Explorer proves the consequence: `generateGalaxy(settings)` client-side reconstructs **every**
   sector, lane, and wormhole endpoint. Build a fog map on top of that and a savvy client just
   recomputes what we hid — the fog is decoration.

So #4 is: **build the fogged map *and* make the galaxy genuinely server-secret.** One job.

## What the lockdown forces (the architectural fork)

After lockdown the client *cannot* compute the galaxy: without the seed it can't derive adjacency,
which sectors are inhabited, wormhole endpoints, or reachability. (Geometry and danger it still can
— `layout()` and `dangerCurve` are seedless, and `N` is a client constant — but those aren't the
secret. The secret is **connectivity + what's inhabited**.)

Therefore **the player map must be server-authored.** The server already caches the galaxy; it
intersects it with the trader's `trader_visited` set and ships only the known sectors. The client
renders what it's given and literally can't see past the fog, because the data never arrives.

The **admin** Explorer stays client-compute (omniscient, already works) — it just sources `settings`
from an **admin-gated** endpoint instead of the public one. Clean split:

| endpoint | audience | returns |
|---|---|---|
| `GET /api/universe` | public | `{ exists }` (+ `size` is informational, not secret — `N` already ships in the client) |
| `GET /api/admin/universe` | admin | `{ seed, settings, reachable, size }` — the Explorer's source |
| `GET /api/map` | active trader | the **fogged** map (repurposed; it's dead code today) |

## The fog model

Three states, all derived from #2's tables — **no new tables**:

| state | source | reveals |
|---|---|---|
| **visited** | a `trader_visited` row | everything — position, danger, inhabited, station, name (brightest) |
| **frontier** | lane-neighbours of visited sectors, minus visited | "a sector exists here" + position + danger tier only. **Not** inhabited / station — exploring keeps its payoff (dim) |
| **unknown** | everything else | dark / not drawn |

- The frontier is **free knowledge**: #2 already exposes lane-neighbour IDs from the sector view, so
  drawing them as dim dots just makes the map useful for planning the next jump. Position + danger
  leak nothing (pure geometry); **inhabited/station stays hidden until you arrive** (decided).
- **Wormhole neighbours are *not* frontier** — you only know a wormhole *exists* at a visited sector,
  not where it goes. A visited sector with an un-taken wormhole gets a small "unexplored wormhole
  here" marker (no arc). A **taken** wormhole (`trader_wormholes`) draws its arc; its far end is
  visited anyway.
- **Frontier is derived, never stored** — recomputed from `trader_visited` each request, so it's
  stable and persistent with zero extra state.
- **Persistent memory**, no decay — seen once, remembered forever (it's just a table row).
- **Per-trader** — switching pilots (#1) swaps the whole map.

## game-core: a pure `fogView`

The fog *logic* is pure (galaxy + sets → render list); the DB read stays in the server. Same
pure-core / server-glues-DB split as everywhere else, and it's unit-testable in Vitest:

```ts
fogView(g: Galaxy, visited: Set<number>, takenWormholes: Set<string>): MapView
```

returning the normalized render input below. `takenWormholes` keys match #2's canonical
`a-b` (`a < b`) form.

## The shared renderer (admin-mirrors-player)

To honour the rule that admin tools reuse the player components, **one canvas renders both maps** —
fed full data for the admin, fogged data for the player. Refactor `GalaxyMap.vue` to draw from a
normalized **`MapView`** instead of a raw `Galaxy`:

```ts
interface MapView {
  size: number;                  // grid side context (N)
  sectors: MapNode[];
  edges: { a: number; b: number; kind: 'lane' | 'wormhole' }[];
}
interface MapNode {
  id: number; x: number; y: number;
  fog: 'visited' | 'frontier';   // (room for an 'intel' value later — see #5)
  dangerTier: DangerTier;        // geometry, always safe to show
  inhabited?: boolean;           // present only when fog === 'visited'
  isSol?: boolean; isCurrent?: boolean; unexploredWormhole?: boolean;
}
```

- **Player** → feeds the server's fogged `MapView`; no `galaxy`, so the admin-only debug overlays
  (closed/blocked lanes, which need the *full* adjacency) simply don't render.
- **Admin** → builds a full `MapView` from its client-side galaxy (every node `fog: 'visited'`,
  every edge) and *also* passes the raw `galaxy` to keep the blocked-lane / gradient debug toggles.

So `GalaxyMap`'s props become roughly `{ view: MapView; galaxy?: Galaxy; showBlocked?; showWormholes?;
showGradient?; selected? }`. Same dots, lanes, arcs, Sol marker, selection ring, danger tint — the
fog is just a per-node brightness channel. Sharing the renderer also means the map's rendering is
debuggable from the admin side (decided).

## Server changes

- **`GET /api/universe`** — strip to `{ exists }` (drop `id` / `seed` / `settings` / `reachable`;
  `size` optional, not secret). `MeResponse.universeExists` already covers the "does a world exist"
  question, so this may even fold into `me` — see open questions.
- **`GET /api/admin/universe`** (new, admin-gated) — `{ seed, settings, reachable, size }`. The
  Explorer switches its `api.universe()` call here.
- **`GET /api/map`** (repurposed, trader-aware) — requires an active trader; loads `trader_visited` +
  `trader_wormholes` for that trader, calls `fogView(galaxy, visited, taken)`, returns the `MapView`.
  No active trader / anonymous → 409 (or empty). Admin browsing the player map is out of scope — the
  admin uses the Explorer.
- `/api/sector/:id` is already made trader-aware in **#2**; #4 doesn't touch it.

## Client / UI

- **`#map` tab** (`App.vue`, today a stub) → fetch `GET /api/map`, render `<GalaxyMap :view="…" />`.
  Tapping a **visited** sector opens its detail (reuse the existing `select`/`api.sector` path, same
  as the Explorer); tapping a **frontier** dot does nothing useful yet (its content is hidden) — at
  most show "unexplored." A "you are here" ring marks `isCurrent`; Sol is always visited (you start
  there). The map is naturally sparse early and fills in as you fly.
- **`api.ts`** — split `UniverseInfo` into a public `{ exists; size? }` and an admin
  `AdminUniverseInfo { seed; settings; reachable; size }`; add `api.adminUniverse()` and reshape
  `api.map()` to return `MapView`. `AdminExplorer.vue` swaps `api.universe()` → `api.adminUniverse()`
  (its only seed/settings consumer; the player never computes planets/galaxy client-side).

## Config knobs

None. The fog model has nothing to tune — it's a pure consequence of where you've been.

## Migration / out of scope

- **No new tables** — #4 consumes #2's `trader_visited` / `trader_wormholes` + the cached galaxy.
- The universe-endpoint split is a breaking API change but **pre-launch** — no data migration.
- New pure `fogView` in game-core + the `GalaxyMap` `MapView` refactor are pure additions/refactors.
- Partial intel (heard-of-but-unvisited) → **#5**, probably its own screen; the `fog` enum leaves a
  slot. Route plotting → **#5**. Map sharing → **#11**.

## Open questions

- **Fold the public universe state into `me`?** `MeResponse` already carries `universeExists`; a bare
  `GET /api/universe → { exists }` may be redundant. Lean: keep `/api/universe` for the
  pre-auth/boot path but let it be the thin `{ exists }` — decide during implementation.
- **Danger tint on the frontier** — show it (geometry, free, aids planning) or keep frontier dots a
  flat dim colour so danger reads as "visited-only" info? Lean: **show it** (consistent — danger is
  never secret).
- Confirm tapping a frontier dot has no action beyond "unexplored" until #5 gives it one.
