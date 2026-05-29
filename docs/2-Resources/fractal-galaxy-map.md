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

**Order 5 (1024 cells) is the sweet spot** for ~1000 stars: place a star in ~1000 of the
1024 cells (skip a few at random to avoid a perfectly full grid feeling artificial).

Nesting then falls out for free:

- **Galaxy** = the whole 32×32 grid.
- **Region** = each order-3 block → a 4×4 arrangement of **16 regions**, ~64 stars each.
- **Sector** = each order-4 block → **256 sectors** of ~4 stars each (handy for naming /
  addressing, e.g. `R7·S3·#412`).

Numbers are tunable; this is just a clean default.

## Base star-lane graph

Stars are connected by **lanes** derived from the curve, *not* by long-range links:

- **Curve adjacency:** each star links to its predecessor/successor along the Hilbert
  index (guarantees the whole galaxy is one connected path — no orphans).
- **Spatial adjacency:** also link stars whose grid cells are orthogonally adjacent
  (Manhattan distance 1). This thickens the graph from a bare line into a web while
  keeping it *local* — most travel is short hops between neighbors.

Result: a richly-connected but **geographically honest** map. Crossing the galaxy the
"natural" way takes many hops — which is exactly the problem wormholes solve.

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

## Determinism

Generate the whole map from a **single seed** so it's reproducible (regenerate identical
galaxies, diff map versions, debug pathfinding). Persist the generated graph to the DB;
don't regenerate live. See the map-generation pipeline in the
[technical doc](../0-Projects/starwonder-mvp/technical-infrastructure.md#map-generation-pipeline).

## Why this is also great UX on a phone

A space-filling curve means the *whole galaxy* is a single square image with no overlap and
no tangled crossing lines. You can render the entire 32×32 grid as a tappable minimap, and
zoom to a region or local neighborhood — all flat 2D, no camera gymnastics. Ideal for the
"ultra phone friendly" goal.
