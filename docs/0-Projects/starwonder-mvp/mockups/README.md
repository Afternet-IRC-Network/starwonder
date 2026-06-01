# Star View — art-direction mockups

Takes on the **home screen** (the "Star view"), all showing the same content so we're
comparing *style*, not layout. Self-contained HTML — just open in a browser:

```
a-phosphor-terminal.html   exploration: pure ASCII terminal
b-modern-ascii.html        exploration: modern chrome + coloured ASCII
c-pixel-voxel.html         exploration: pixel/voxel art
d-modern-voxel.html        ← ✅ CANONICAL STAR-VIEW REFERENCE
station-lab.html           station-icon shape exploration (V1–V6)
station-lab-2.html         station-icon knob sweep — zoomed crop + hub
station-lab-3.html         station-icon knob sweep — full wheel (chosen W3)
map-admin.html             admin/debug universe builder — pinwheel galaxy, hash lanes,
                           star/lane/wormhole knobs, Sol-reachability + seed finder
map-player-1-navgrid.html  player map option ① — ASCII nav-grid (box-drawing lanes) in the box
map-player-2-warpweb.html  player map option ② — topological warp-web (centred on you)
map-player-3-starfield.html player map option ③ ← ✅ CHOSEN — voxel starfield + sector panel
```

Live (GitHub Pages), e.g. the canonical one:
`https://afternet-irc-network.github.io/starwonder/docs/0-Projects/starwonder-mvp/mockups/d-modern-voxel.html`
(append a `?v=N` cache-buster when re-viewing after an update.)

> **Decision:** go with **D** — the modern app chrome of **B** + the procedural
> pixel/voxel art of **C** for planets, ships, and stations. A/B/C are kept below as the
> exploration that led there. **`d-modern-voxel.html` is the source of truth for the
> Star-view look.**

(Resize the window narrow, or open dev-tools device mode, to see the phone framing.)

All three render the central **planet procedurally from the sector address**
(`"R7·S3·#412"`) via a seeded hash → so every star in the galaxy gets a unique, stable
look for free. Change the seed string and the planet changes deterministically.

## A — Phosphor Terminal
Pure monochrome CRT: green phosphor, scanlines, box-drawing chars, ASCII planet.
- **Vibe:** unapologetically retro BBS / "you are in a terminal."
- **Pros:** cheapest to build (it's just text + CSS), ultra-light, scales to any screen,
  leans hardest into the retro-BBS heritage, trivially themeable (amber/green/ice).
- **Cons:** can read as *austere*; color-coding is limited; ASCII planet is charming but
  low-fidelity.

## B — Modern ASCII (hybrid)  ← my pick to anchor on
Real app chrome (cards, soft glow, muted palette) wrapping a **coloured ASCII** planet.
- **Vibe:** "ASCII soul, modern app body." Terminal art as a deliberate aesthetic, not a
  limitation.
- **Pros:** phone-native feel + tap targets; color carries information (buy/sell/hostile);
  keeps the ASCII centerpiece; ages well.
- **Cons:** more CSS to maintain than A; risks looking like "generic dark app" if we're not
  disciplined about keeping the ASCII/mono identity strong.

## C — Pixel / Voxel
Canvas-rendered **pixel-art** planet (low-res sphere + palette ramp + dithering), chunky
2px-border UI, drop-shadows, neon palette.
- **Vibe:** retro *game* rather than retro *terminal* — think 16-bit space trader.
- **Pros:** most overtly "a game," most colorful, the procedural planet engine is more
  expandable (clouds, rings, city lights, voxel rotation later).
- **Cons:** furthest from the ASCII brief; pixel art is easy to do badly; more art direction
  needed to stay coherent across 1000 procedurally-generated bodies.

## D — Modern chrome + Voxel art  ← ✅ chosen (current direction)
B's app chrome with **canvas-rendered pixel/voxel** art instead of ASCII. Everything is
generated from the seed → 1000 unique-but-stable bodies & a sprite per ship for free.

**Locked-in Star-view composition (as built in `d-modern-voxel.html`):**
- **Layout:** header (system name + `R·S·#` address + Energy bar) · orbit *viewport* ·
  "In orbit" / "Also here" cards · horizontally-scrolling warp lanes · action buttons
  (Dock / Scan / Move) · bottom nav (Star / Map / Dock / Ship / Log).
- **Planet:** low-res sphere, seeded terrain bands, palette-by-type (ocean/lava/ice/arid),
  2×2 Bayer dithering, fixed-light shading. **Rendered static** (no spin) — the rotation
  was too busy.
- **Station / Docks:** a procedural **2001-style wheel** — tilted elliptical ring + hub +
  struts, depth-shaded, steely/metallic; the *universal dock icon*. Tuned to variant **W3**
  (`tilt 0.58 · 4 struts · rim 0.16 · spoke 0.06 · hub 0.20`). It **slowly rotates** — the
  one bit of motion in the viewport. Shown both as the 30px orbit-list icon and as a small
  (~30px) station floating over the planet.
- **Ships:** mirror-symmetric procedural pixel sprites, seeded per entity, hue by role
  (red = pirate/hostile, green = friendly trader). The "Also here" ships are shown **parked
  statically in front of the planet** (as if mid-orbit) — not animated.
- **Colour = meaning:** buy = green, sell = gold, hostile = red, wormhole = gold.
- All sprite/planet/station rendering uses one seeded PRNG (FNV-1a hash → mulberry32) so
  art is deterministic per sector/entity.

## Still to decide / do next
1. **The player-facing Map screen** — ✅ **done.** Three options were explored
   (`map-player-1-navgrid` / `-2-warpweb` / `-3-starfield`); we chose **③ Voxel Starfield**:
   true sector positions over a parallax field, each charted world drawn as its own
   pixel-planet (colour = class, **no danger overlay** — that's server geometry), lanes +
   taken wormholes as trails, drag-to-pan / scroll-to-zoom, centred on you. Tapping a world
   opens a light sector panel below (the shared `OrbitPanel`, minus "Also here"). Built in
   the app as `apps/web/src/components/game/StarChart.vue`, fed the fogged `MapView` (the
   server now bakes visited worlds' palette/spin/name into the fog view). Distinct from the
   *admin* map (`map-admin.html` / `GalaxyMap.vue`), which stays a technical scatter for
   debugging generation.
2. **Planet-type palettes** — current set ocean/lava/ice/arid; expand and tie to the star's
   seed so each sector's world is deterministic.
3. **Voxel fidelity** — flat-shaded pixel look is the baseline; revisit true isometric
   voxels later for hero objects (your own ship) if wanted.
4. **Ship occlusion** — orbit ships currently sit *over* the planet; real "behind the
   planet" pass is deferred (the static placement sidesteps it for now).

> ⚠️ **Original art only.** All glyphs/layouts here are ours; we deliberately avoid copying
> any existing game's screens, names, or art. The procedural engine helps — our planets are
> generated by *our* algorithm, not traced from anything.
