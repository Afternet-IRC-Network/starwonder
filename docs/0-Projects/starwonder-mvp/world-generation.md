# StarWonder — World Generation

How a sector decides **what it is**: whether it's a star system, how dangerous it is,
and — the part this doc is really about — **what kind of world** sits there.

> **Status:** IMPLEMENTED. World type is rolled from a flat weighted table in
> `sector-content.ts` (no distance bias); habitation has a gentle distance falloff
> exposed as a Big Bang admin slider (`habitationFalloff`, default `0.35`). Companion to
> [Technical Infrastructure](technical-infrastructure.md) and
> [Procedural Naming](naming-system.md).

---

## First principle: everything is a pure function of the seed

The initial state of the universe is algorythmic, and then a database based
record can optionally override a sector if its been modified from there.

A sector's type, stats, danger, and habitation are all recomputed on demand from
`(seed, sectorId)` (plus the sector's grid position). Change the seed → a completely
different galaxy. Same seed → byte-for-byte the same galaxy, forever, on every machine.
This is the Minecraft model: the seed *is* the world. But once the world has been edited (maybe an admin changed something, or a game machanic does) the db 'wins'. this lets us
build up the db only as we go, and the algo based provides the default.

So "designing world gen" = designing the **functions**, not authoring any data.

### Note on "inhabited" (a thing to decide)

Today `inhabited` is a **flat** roll: `unit("<seed>|star|<id>") < inhabitedProb`
(default `0.47`), identical everywhere. The core only *feels* denser because
`coreBias` thins lanes on the rim, so more rim sectors are unreachable from Sol and
drop out as void. Among *reachable* sectors the habitation rate is uniform.

**Decided:** habitation gets a *light* distance falloff — settlement thins toward the
frontier, but only a little. The strength (and curve shape) becomes a **Big Bang admin
slider** so we can tune it by eye, exactly like `coreBias`/`laneP` today. Default to a
gentle weight. *(Orthogonal to world type — type stays perfectly uniform regardless.)*

## The pieces, and where they live

All in `packages/game-core`, all pure:

1. **`galaxy.ts`** — the skeleton: 1024-sector pinwheel, which sectors are inhabited,
   which lanes/wormholes are open, distance-from-Sol, reachability (void = unreachable).
   *(Already built. Type does not belong here.)*
2. **`danger.ts`** — `dangerCurve`/`dangerTier` from distance. *(Already built, correct.)*
3. **`sector-content.ts`** — given an inhabited sector, **what world is there** and its
   stats. *(This is what we're redesigning.)*
4. **`names.ts`** — the world's name. *(Already built.)* This is **already** "names in a
   data file + seeded assignment in code": the pool is `data/world-names.json`, and the
   assignment (which name → which sector) is the pure functions `planetName`/`stationName`,
   which `sector-content.ts` calls. *Recommendation:* keep assignment in its own `names.ts`
   module rather than inlining it into `sector-content.ts` — it keeps the 25k-name concern
   out of the world-class rules. (Open box below if you'd rather fold it in.)
   - **Name fame-banding stays:** famous worlds (Ceres, Vesta) still cluster near Sol via
     `rimT` (see [naming-system.md](naming-system.md)). This is the *one* intentional
     distance dependency, and it's about **names, not type** — `generatePlanet` keeps its
     `rimT` arg solely to pass through to `planetName`. World **type** never reads it.

---

## World type assignment — the design

Only **inhabited** sectors get a world. The job: map an inhabited sector to one of a
small set of **world classes**, deterministically from the seed, with controllable
rarity, and **no distance bias**.

### The class set

Real-planet-flavoured (see the science writeup we did): seven classes.

| Class | Feel |
|---|---|
| `terran` | temperate, life-bearing (the rare Earth-like) |
| `ocean` | world-spanning seas |
| `desert` | arid / rocky, sparse biosphere |
| `ice` | frozen |
| `lava` | molten, hostile |
| `barren` | airless rock (Mercury/Luna-like) |
| `gas-giant` | no solid surface — you dock at the orbital station, planet is backdrop |

*Decided: keep all seven.* **Requirement:** adding or removing a class later must be a
**single-place edit** — each class is one entry that carries its weight + size/gravity/
atmosphere/moons profile + render palette together, and both the weighted roll and the
stat derivation iterate that one list. No class name hard-coded in more than one spot.

### How the class is chosen — independent per-sector roll  ✓ decided

**Decided: independent rolls, no spatial clustering.** Each inhabited sector rolls on its
own: hash `("<seed>|class|<id>")` → a 0..1 value → pick a class from a single weighted
table. Neighbours are uncorrelated — we take the scattered look in exchange for
dead-simple, exactly-tunable rarities (**rarity = weight**, full stop). Coherent-noise
(Minecraft-biome) clustering was on the table and **dropped** — not worth the machinery now.

```
weights = { terran: 14, ocean: 22, desert: 14, ice: 14, lava: 12, barren: 12, gas-giant: 12 }
```

*(Decided — "lush & green" tone: habitable worlds common, `terran` ≈ 1-in-7. Weights are
relative; they don't need to sum to 100.)*

### Rarity weights — your call, not mine

Whatever model we pick, the **relative commonness of each class is a design decision you
own.** The numbers in Model A above are a *placeholder I have not committed to*. Open
questions:
- How rare should `terran` (the habitable jackpot) be? 1-in-25? 1-in-100?
- Are `gas-giant`s common scenery or a treat?
- Should the seven be roughly even, or is there a deliberate "mostly dead rock, occasional
  gem" tone?

We'll set these together once the model is chosen.

## Stat derivation (once the class is known)

Class drives the rest, so the numbers stay physically coherent. Each class defines:
- a **size** range (R⊕) — e.g. gas giants 3.5–12, barren 0.3–1.0,
- **gravity** — derived from size for rocky worlds; pinned to a cloud-top range for gas giants,
- an **atmosphere** distribution — e.g. gas giants always thick; barren mostly none/thin,
- **moons** — gas giants keep big retinues; rocky worlds scale loosely with size,
- a **render palette** for the pixel viewport.

All still pure functions of `(seed, id)` — distance never enters. *(The per-class number
ranges are tuning we can refine, but they're not contentious like the distance bug was.)*

## Sol is special-cased

Sector #0 is always **Earth** — `terran`, 1 R⊕, 1 g, breathable, 1 moon — regardless of
any roll, and its station is **Terra Station**. The only hard-coded world.

---

## Open decisions (sign-off checklist)

- [x] **Type selection model** — independent per-sector roll (Model A). Clustering dropped.
- [x] **Habitation** — light distance falloff, exposed as an admin slider (default gentle).
- [x] **Class set** — keep all seven; built so a class is add/remove in **one place**.
- [x] **Rarity weights** — "lush & green" (`terran` ≈ 1-in-7); see weights table above.
- [x] **Name-assignment location** — stays in `names.ts`.

Once the open boxes are ticked, the code change is confined to **`sector-content.ts`** (drop
the rimT zoning → one flat weighted table) plus a small **habitation-weight** addition in
**`galaxy.ts`** and a new Big Bang settings slider. `danger.ts` and `names.ts` are untouched.
