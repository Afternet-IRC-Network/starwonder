# The Fractal Galaxy Map (xkcd #195)

Reference notes for how StarWonder lays out its ~1000 stars.

## What xkcd #195 actually is

Randall Munroe's ["Map of the Internet"](https://xkcd.com/195/) lays out IPv4 address
space along a **Hilbert curve** — a space-filling fractal. The key property: addresses
that are *numerically close* end up *physically close* on the 2D map, and the curve
recursively nests, so contiguous blocks form clean, non-overlapping territories
(the colored "countries" on the map).

We borrow two things:

1. **Hilbert-curve placement** → a 2D galaxy where neighbors are genuinely adjacent and
   regions form tidy nested squares (great for "sector" identity and faction territory).
2. **Recursive nesting** → free hierarchy. The same curve gives us galaxy → region →
   sector → star without any extra data structure.

## Sizing for ~1000 stars

A Hilbert curve of **order *n*** fills a `2^n × 2^n` grid with `4^n` cells.

| Order | Grid    | Cells |
|-------|---------|-------|
| 4     | 16×16   | 256   |
| **5** | **32×32** | **1024** |
| 6     | 64×64   | 4096  |

**Order 5 (1024 cells) is the sweet spot.** Every one of the 1024 cells is a **travellable
sector**; whether a sector also hosts a **star** is a per-sector probability roll (the
"star likelihood" knob, ~0.5 in current tuning). Empty sectors are deep-space waypoints you
still fly through — stars are an *overlay*, not the travel graph. (Earlier drafts placed
stars in ~1000 cells and only connected star-to-star; superseded — see *Travel graph* below.)

Nesting then falls out for free:

- **Galaxy** = the whole 32×32 grid.
- **Region** = each order-3 block → a 4×4 arrangement of **16 regions**, 64 sectors each.
- **(Order-4 blocks)** → 256 quads of ~4 cells each — a structural sub-grouping the curve
  gives for free, but **not** surfaced in addressing (the address is Region + cell id; see
  *Addressing* below). The cell itself is the **Sector** you travel to.

Numbers are tunable; this is just a clean default.

## Layout: centred-Sol pinwheel (locked)

A single Hilbert curve anchors index 0 in a **corner** — intrinsic to the construction. We
want **Sol at the centre** (players start there), so we use a **pinwheel**: four order-4
Hilbert curves, one per 16×16 quadrant, each oriented so its `#0` corner meets the others at
the map centre. Result: **Sol = Sector #0 sits dead-centre**, the galaxy fans out in four
self-similar arms, and we keep everything we actually rely on — local spatial adjacency,
deterministic generation, and tidy nested **8×8 square regions**. The only thing traded away
is a single unbroken curve spanning all 1024 cells, which we use for nothing (connectivity
comes from the lane graph below). Verified: bijective (no gaps/collisions), all 16 regions
stay clean 8×8 squares.

### Addressing

`Region <1–16> · Sector #<0–1023>`. **Region** = `(d >> 6) + 1` (the 16 nested 8×8 squares;
`region >> 2` is the quadrant/arm). **Sector** = the cell id `d` itself (0–1023) — the unit
you travel between and the thing the DB can override. (The old intermediate 256-"sector"
level folded into the region; "sector" now means the individual cell.)

## Travel graph: cardinal lanes, statelessly blocked (locked)

Every sector connects to its **cardinal grid neighbours** (N/E/S/W). Because the pinwheel
keeps neighbours spatially adjacent, "north/east/south/west" is just `(x±1, y)` / `(x, y±1)` —
even when those cells are far apart in `#` index. Most travel is short local hops; crossing
the galaxy the natural way takes many of them — exactly what wormholes solve.

But not every neighbour link is open. Rather than store a lane table, we decide each lane
**deterministically from a hash**:

- For a potential lane between sectors `a` and `b`, form the **canonical key** `min-max` of
  their **physical cell ids**, fold in the universe seed, hash it, and open the lane iff
  `hash / MAX < p` (the *lane open probability* knob, ~0.55 in current tuning).
- **Canonical ordering ⇒ bidirectional for free**, and the graph is **stateless** — server,
  client, tick and bot all derive identical lanes from `(seed, p)` with **no stored edges**.
  Key on the *physical* cell id (not any display number) so re-labelling never re-rolls a map.
- Lowering `p` fragments the galaxy into pockets and wormhole-gated enclaves; raising it
  toward 1.0 makes one dense blob. (Bond-percolation threshold ≈ 0.5 on this lattice.)

Result: a richly-connected but **geographically honest** map, tunable from "frontier
archipelago" to "solid continent" with a single knob.

### Core bias (distance-weighted lanes)

A single `p` makes the whole map equally connected. We tilt it by **as-the-crow-flies
distance from Sol** so the **core is denser and the rim frays**: for a lane whose midpoint
sits at normalised distance `t` (0 at Sol, 1 at the farthest rim), the effective open prob is

```
p_eff = clamp(p · (1 + bias · (0.5 − t)),  0, 1)
```

Because it's **centred at `t = 0.5`**, the galaxy-wide *mean* open prob stays ≈ `p` — the
`bias` knob only *redistributes* connectivity (inner half a touch denser, outer half rougher)
rather than globally raising or lowering it. `bias = 0` is the old uniform behaviour. `p_eff`
depends only on the two cells' fixed positions, so lanes stay deterministic, bidirectional and
stateless. Current tuning leans hard on it (**bias 0.89**) for a solid heart and a dissolving
frontier.

### Danger (derived from the same gradient)

The same Sol-distance field defines a **danger level**, on a curve so the inner third stays
safe and risk climbs steeply toward the rim: `danger = t^1.7`, bucketed into **Peaceful**
(inner ⅓) → **Medium** (middle ⅓) → **Dangerous** (next ⅙) → **Very dangerous** (outer ⅙).
This is the hook for spawn tables, loot, NPC aggression and economy later — the frontier is
where it's lucrative and lethal. Rendered as a green-core → red-rim heat overlay in the admin
map.

## Wormhole overlay

A pure local graph is a slog to traverse (could be 30+ hops corner to corner). We sprinkle
a sparse set of **wormholes** — long-range edges — to make the galaxy navigable:

- **Count:** ~3–5% of star count (≈ 30–50 wormholes for 1000 stars).
- **Bias toward distance:** prefer endpoints that are far apart on the grid (e.g. weight by
  Euclidean distance, or require endpoints in different regions). This makes them feel like
  genuine shortcuts, not redundant local links.
- **Directionality:** default **bidirectional** (recommended) for simplicity; one-way
  wormholes are a fun later twist (you can get somewhere fast but not back).
- **Stability (later idea):** some wormholes drift/collapse on a long timer, reshuffling
  trade routes and keeping the meta fresh. Out of scope for MVP.

The wormhole graph is what makes regions strategically valuable: control the wormhole
mouths and you control fast travel.

## The universe = Sol's reachable set (void elsewhere)

Players start at Sol, so we make that literal: **the universe is exactly the set of sectors
reachable from Sol** (BFS over open lanes + wormholes). Anything the BFS can't reach simply
**does not exist** — no star, no lanes, no wormhole, blank on the map. There are no orphan
islands to wonder about; the frontier just dissolves into void where the lattice gives out.
With core bias high and `p` modest, the rim naturally trails off into nothing — that's the
intended look.

This subsumes the old "≥ 90% reachable or reject the seed" rule: unreachable cells aren't a
failure to screen out, they're void by definition. The only remaining acceptance concern is
**size** — a pathological seed could strand Sol in a tiny pocket — so generation still checks
the reachable set is **large enough to be a galaxy** (and the admin seed-finder/readout
surfaces it). A smaller-but-whole universe is fine; a 4-sector one isn't.

## Determinism & persistence

The entire galaxy — sector coords, regions, star overlay, lanes, wormholes, initial
station/planet/NPC seeds — is a pure function of **`(seed, generation settings)`**. So we
**don't materialise the map**: we store only the seed + settings and compute sector state on
demand. The mutable game then layers **sparse override records** on top (a station built,
prices drifted, a planet captured). See the
[persistence model](../0-Projects/starwonder-mvp/technical-infrastructure.md#8-data-model-first-cut)
and [generation pipeline](../0-Projects/starwonder-mvp/technical-infrastructure.md#11-universe-generation--persistence)
in the technical doc. New seasons = a new seed.

**Interactive reference:** the admin/debug map mockup
[`map-admin.html`](../0-Projects/starwonder-mvp/mockups/map-admin.html) implements all of the
above live — pinwheel layout, hash lanes, the star / `p` / **core-bias** / wormhole knobs, the
danger heat overlay, the void-everything-unreachable rendering, the reachable-size readout and
a seed finder. Current tuned defaults: **star likelihood 0.47, lane open prob. 0.44, core bias
0.89, ~50 wormholes.**

## Why this is also great UX on a phone

A space-filling curve means the *whole galaxy* is a single square image with no overlap and
no tangled crossing lines. You can render the entire 32×32 grid as a tappable minimap, and
zoom to a region or local neighborhood — all flat 2D, no camera gymnastics. Ideal for the
"ultra phone friendly" goal.
