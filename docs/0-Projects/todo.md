# todo

Build order, grouped into phases. Each phase mostly depends on the one before it. **Anytime**
items have no dependencies; **Done** drops to the bottom. Long-term / someday-maybe ideas live
in [roadmap.md](starwonder-mvp/roadmap.md); bigger features have (or need) their own design doc,
linked inline.

## Phase 1 — Foundations (the authoritative loop, on a clean data model)

- [x] **0. Universe config** — collapse the `universes` table now that there's exactly one galaxy: a frozen `world` row (seed + Big Bang settings) plus a `config` key/value table for live, admin-tunable knobs (first one: the per-user trader cap). Also drops `universeId` from `sector_state` / `stations`. Groundwork for #1. → [0_universeconfig.md](0_universeconfig.md)
- [x] **1. Split user from trader** — separate the account (login / password) from the in-game *trader*, and let one user run several traders. Doing this first means movement and everything after it write straight to the final `traders` model — no migration later. → [1_usertrader.md](1_usertrader.md)
- [x] **2. Movement & player state** — clicking a warp path moves your trader to that sector and spends energy. The first real player *intent*, so it proves the authoritative server loop end-to-end. Movement records which sectors a trader has visited — the seed of fog-of-war — and which wormholes it's taken (wormhole destinations stay hidden until you've been through them). → [2_player_state.md](2_player_state.md)

## Phase 2 — Economy & exploration (the core gameplay loop)

- [x] **3. Trading & docking** — dock the station in your current sector to open its marketplace: buy / sell ~8 commodities against a per-station price field (core↔rim tech gradient + seed noise; dynamic stock hooked for later). Cargo-limited. → [3_trading.md](3_trading.md)
- [x] **4. Fog-of-war map** — the player map (`StarChart.vue`, a voxel starfield) shows only sectors you've actually **visited** (no frontier pre-reveal — that was tried and dropped as confusing; you find sectors by flying to them via the star-screen lane list). Tap a charted world to inspect it + plot/travel a route. Bundles the **seed lockdown** (the public API stops shipping `seed`/`settings`, so clients can't recompute the galaxy and defeat the fog). → [4_fog_of_war.md](4_fog_of_war.md)
- [ ] **5. Route plotting & map intel** — plot a course across multiple jumps, and treat map knowledge as a tradable good: see / remember remote-station prices (**market research**), buy lucrative trade-route tips from **route dealers**, buy sector / route info from stations, and sell your own discovery data. *Open question: can you plot a route to somewhere you've only heard of but never visited?*
- [ ] **6. Missions** — short directed jobs that give the galaxy purpose beyond freelance trading: **courier** (deliver cargo), **procurement** (source and return goods), **bounty** (hunt a target). Later: escort, survey. Higher-tier missions can gate behind reputation (see #8).
- [ ] **7. Ship & module upgrades** — a progression sink for trade profits: cargo / engine / energy modules bought at a shipyard ("Haven"). Combat modules (weapons, shields) land alongside combat in Phase 3.

> Items 4–5 (and the map-sharing in #11) are really one system — *what each trader knows about the galaxy* — so build them on a shared per-trader knowledge model rather than separate features.

## Phase 3 — A living, dangerous galaxy (everything here must resolve asynchronously)

- [ ] **8. Reputation & alignment** — *open design question:* sector-local reputation so word doesn't travel far (your original idea), vs. faction reputation (a few factions whose standing gates missions / unlocks, from the old roadmap), vs. layering both — possibly over a good / evil axis. Whatever the model, it shapes how NPCs and other players treat you and which missions you can take.
- [ ] **9. Combat** — weapons, shields, and a fight-or-flee mechanic that works for players who are never online at the same time. On defeat: escape-pod + soft-loss (drop cargo, pay repair) rather than a hard wipe. *Open question: can you accurately scout how strong an opponent is before engaging?*
- [ ] **10. NPCs** — give the galaxy inhabitants:
  - **Federation police / military** — denser near Sol; protect you when a player or NPC attacks.
  - **NPC traders** — algorithmic traders you (or other NPCs) can target for piracy.
  - **Pirates** — hunt traders.
  - **Aliens** — rare wanderers with unknown motives (needs a brainstorm on fun mechanics).

## Phase 4 — Territory & social

- [ ] **11. Social & partnerships** — let players form partnerships / corps that share maps and economic data (builds directly on the knowledge model from Phase 2).
- [ ] **12. Station ownership & capture** — claim, garrison, and capture stations (the `stations` table already carries an `ownerPlayerId`). Owning a station is the first taste of territory; from-scratch outpost building stays long-term (see roadmap).
- [ ] **13. Autonomous agents** — buy agents to run trade routes for you, or garrison fighters in a sector to ambush future players.

## Phase 5 — Meta & community

- [ ] **14. Event feed / activity log** — an `events` table feeding the `#log` tab (polling is fine): your moves, trades, combat, and things that happened to you while away. Also the source the IRC bot announces from.
- [ ] **15. Leaderboards** — credits, reputation, territory — something to compete over.
- [ ] **16. IRC bot v1** — on AfterNET: announce notable events and answer `!status` / `!leaderboard`. Can run serverless (connect → announce → quit) or always-on; game-core is already designed to be shared with it.

## Anytime

- [ ] Dev aliases for common commands (start, stop, restart, lint, …).

## Done

- [x] **Admin panel** — #admin Galaxy Explorer (`AdminExplorer.vue`): a map tab (click a sector → star-view panel) plus a scrollable / sortable / searchable table, so we can eyeball whether the procedural generation looks right. Planets & stations now have procedural names (see [naming-system.md](starwonder-mvp/naming-system.md)).
