# StarWonder — Procedural Naming

How planets and stations get their names. Companion to the
[Technical Infrastructure](technical-infrastructure.md) (§11 universe generation).

> **Status:** implemented and unit-tested in `packages/game-core`. Names flow through
> `/api/sector/:id` and render in the game star view and the admin Galaxy Explorer.

---

## Model: name the world, not the star

A sector is just an **address** (`addr(id)`, e.g. "Sector #0") — we never
name stars and you never visit a sun. The **planet is the system's identity**; the
**station has its own** ("Foshay Docks Station", "Toledo Garden Station") and only
*sometimes* (~10%) borrows its host world's name ("Ceres Terminal Station"). So only two
things carry names: `PlanetData.name` and `StationData.name`.

- **Sol (#0)** is special-cased: planet → **Earth**, station → **Terra Station**.
- Names are **pure functions of `(seed, sectorId, rimT)`** — same doctrine as
  `generatePlanet` / `generateStation`. Nothing is stored; everything recomputes.

## Data source: 25k real, public-domain world names

`packages/game-core/src/data/world-names.json` holds **25,315 names** — every numbered
**minor planet that has an adopted name**, pulled from the **JPL Small-Body Database**
(public domain). These are overwhelmingly mythological/classical one-word names
(Ceres, Pallas, Psyche, Vesta, Astraea…) that read perfectly as worlds.

Kept in **catalog-number order** (≈ discovery order ≈ fame): the famous low-numbered
worlds lead, obscure ones trail (the deep tail includes compound person-name asteroids
like "Nikolaimedtner" — real, just less elegant; tighten the build filter if that ever
matters).

> We do **not** use real *star* names — there are only ~450 of them, and "Vega" is a star,
> not a place you land. Minor-planet names are both far more numerous and a better fit.

## Tiers: fame graded by distance from Sol

`planetName` indexes a window of the pool by `rimT`, so well-known worlds cluster near
Sol and obscure ones sit on the frontier — reinforcing the danger gradient:

| Zone | `rimT` | Pool window | Feel |
|---|---|---|---|
| Core | `< 0.33` | `[0, 3000)` | famous (Ceres, Vesta, Psyche) |
| Mid | `< 0.66` | `[3000, 10000)` | charted, lesser-known |
| Rim | `≥ 0.66` | `[10000, end)` | obscure frontier names |

Windows are far larger than any galaxy's sector count, so **collisions are negligible**
(~287 unique of 288 inhabited on the default seed).

**Easter eggs**: a small pop-culture homage list lives in `names.ts` (Tatooine, Arrakis,
Vulcan, …). ~2.5% of worlds and ~4% of stations roll one. Trim or grow the array freely.

## Stations: their own identity

Stations no longer just inherit `"<world> <suffix>"`. `stationName(seed, sectorId, rimT,
type)` rolls a **weighted grammar** over four name pools plus a station-type mid-word,
then appends a **universal `" Station"` tail** so every name is well-formed (even a bare
descriptive — "Fayad Lagoon Station"). One deterministic roll
(`seed|station-name|sectorId|pat`) picks the core pattern:

| Weight | Core pattern | Pools | Example (with tail) |
|---:|---|---|---|
| 10% | `planet + mid` | *(reuse host world)* | Ceres Terminal **Station** |
| 24% | `surname + mid` | surnames¹ + mid-word | Foshay Docks **Station** |
| 16% | `place + mid` | places + mid-word | Toledo Anchorage **Station** |
| 12% | `descriptive + mid` | descriptives + mid-word | Garden Exchange **Station** |
| 15% | `place + descriptive` | places + descriptives | Toledo Garden **Station** |
| 13% | `surname + descriptive` | surnames¹ + descriptives | Holloway Grove **Station** |
| 10% | `firstname's + descriptive` | first names¹ + descriptives | Mabel's Landing **Station** |

¹ **fame-banded by `rimT`** (`pickFamed`) — common names near Sol, obscure on the rim —
the same banding as worlds. Places & descriptives are picked **flat** (no fame signal:
the cities source has no popularity order, and descriptives are a small curated set).

On top of the core:

- **Mid-word** comes from `STATION_SUFFIX[type]` (trade → Exchange/Terminal/Market/Docks/
  Bazaar; haven → Haven/Anchorage/Refuge/Port/Sanctuary; outpost → Outpost/Watch/Relay/
  Beacon/Drift), so a station's type still flavours its name *when one is drawn* (rows 1–4,
  ~62%). Note `"Station"` is intentionally **not** in any list — the universal tail owns it.
- **`" Station"` tail** — appended to every name, so the standalone compounds (rows 5–7)
  read right ("Wanggou Greenwood Station") instead of dangling on a bare word.
- **`New ` prefix** — 5%, global, applied before the tail ("New Campina Grande Refuge Station").
- **Easter egg** — ~4%, pre-roll, short-circuits to "`<Egg> Station`".
- **Sol** is special-cased upstream in `generateStation` (→ **Terra Station**), so it never
  reaches the grammar.

Possessives render `James'` (not `James's`) for names ending in *s*. The invented-name
space is huge (89k surnames × 197 descriptives ≈ 17M just for one pattern), so collisions
across a 1024-sector galaxy are negligible.

### Station name pools

Four JSON arrays in `src/data/`, regenerated by `scripts/build-name-pools.mjs`:

| Pool | File | Count | Order | Source |
|---|---|---:|---|---|
| Places | `place-names.json` | ~28.7k | curated-ancient first, then cities | `datasets/world-cities` (GeoNames-derived) + ~80 hand-picked ancient cities |
| Surnames | `surnames.json` | ~88.8k | **frequency-ranked** | US Census 1990 |
| First names | `first-names.json` | ~5.2k | **frequency-ranked** (M/F interleaved) | US Census 1990 |
| Descriptives | `descriptives.json` | ~197 | thematic | hand-curated in the build script |

## How names reach the client

`generatePlanet` / `generateStation` set `.name` on their returned objects, so the name
rides the **existing** `/api/sector/:id` response spread and the DB-override deep-merge —
no route changes. The web imports `PlanetData`/`StationData` from `game-core`, so the
types carry `name` automatically.

## Regenerating the pool

```bash
pnpm --filter @starwonder/game-core build-names
```

`scripts/build-names.mjs` fetches the JPL SBDB query once into `scripts/.cache/`
(gitignored — the raw download is large), filters to clean single-word names
(`/^[A-Z][a-z]{2,15}$/`), dedupes, preserves catalog order, and writes
`src/data/world-names.json`. The download is cached so reruns are offline.

The four **station** pools regenerate separately:

```bash
pnpm --filter @starwonder/game-core build-name-pools
```

`scripts/build-name-pools.mjs` downloads cities + Census name files once into
`scripts/.cache/`, strips diacritics → ASCII, title-cases, dedupes, filters to clean
≤2-word names, preserves rank order for the Census pools, and writes the four
`src/data/*.json` arrays. Reruns are offline.

## Key files

- `packages/game-core/src/names.ts` — `planetName`, `stationName` (the grammar), `pickFamed`, tiers, easter eggs
- `packages/game-core/src/data/world-names.json` — the 25,315-name world pool (committed)
- `packages/game-core/src/data/{place-names,surnames,first-names,descriptives}.json` — the four station pools (committed)
- `packages/game-core/src/sector-content.ts` — `generatePlanet`/`generateStation` set `.name`
- `packages/game-core/scripts/build-names.mjs` — regenerates the world pool from JPL SBDB
- `packages/game-core/scripts/build-name-pools.mjs` — regenerates the four station pools
- `packages/game-core/test/names.test.ts` — determinism, fame tiering, collision rate, station independence
