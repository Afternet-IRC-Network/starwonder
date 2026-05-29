# StarWonder — Gameplay Overview

> A slow, ambient, web-based space trading & conquest game for you and your friends.
> TradeWars 2002's soul, an xkcd-#195 fractal galaxy as its body, and a turn economy
> designed to be checked between day-job AI prompts.

---

## 1. Vision & design pillars

1. **Ambient, not demanding.** You check in for a few minutes, make a few decisions, and
   close the tab. The world advances on a tick whether or not you're watching. No twitch,
   no "log in at raid time."
2. **One trader, hands-on.** You play a *single trader* and you personally do the things —
   fly, dock, haul, fight, take missions. **Not** an autopilot/spreadsheet sim where you
   set routes and walk away. (A "buy a drone to do chores for you" feature is a possible
   *later* layer, never the default.)
3. **Phone-first and visually plain.** Flat 2D map, big tap targets, text-forward UI. Should
   look fine on a cracked phone screen on the bus.
4. **A real, finite, knowable universe.** ~1000 stars you slowly map and come to know.
   Geography matters; the wormhole map is power.
5. **Dangerous even when empty.** NPCs and missions keep the galaxy alive for a 5–20 person
   player base.
6. **Social by design.** Invite-only, friends know each other, and **IRC is the town
   square** where the game narrates itself.

**Anti-pillars:** no pay-to-win, no FOMO timers that punish absence, no account-wiping
permadeath, no required real-time coordination, no fire-and-forget autopilot.

---

## 2. The galaxy

The map is the star of the show. Full generation details live in
[Fractal Galaxy Map](../../2-Resources/fractal-galaxy-map.md); the gameplay-facing summary:

- **~1000 stars** placed on an order-5 Hilbert curve (32×32 grid). Neighbors are truly
  adjacent; regions are tidy nested squares.
- **Hierarchy:** Galaxy → ~16 **Regions** (~64 stars) → ~256 **Sectors** (~4 stars) →
  **Star**. Addresses read like `R7·S3·#412`.
- **Lanes:** stars connect to local neighbors only — most travel is short hops.
- **Wormholes:** ~30–50 long-range shortcuts overlaid on top. They're how you cross the
  galaxy quickly, so their mouths are strategically precious.

### What's at a star — it's all about the stations

You **never land on planets**. Everything you interact with is a **station in orbit**.
Planets (and the star itself) are *scenery and flavor* — a station orbiting an ocean world
deals in Organics; one by a metal-rich rock pumps Fuel Ore — but you dock at the station,
not the surface.

A star has a **type** and may host one or more stations:

- **Trade stations** — the economy: buy/sell commodities (see §5). Most common.
- **StarDocks** — safe hubs: buy/repair/upgrade ships, store goods, take missions. At least
  one **home StarDock** is a guaranteed safe zone.
- **Shipyards / specialist stations** — sell modules, ships, blueprints; faction-gated.
- **Outposts** — player- or corp-built stations (see §10) — the ownable power base.
- Many stars are just **empty waypoints** (lanes/wormholes + maybe an NPC passing through),
  with planets as pure backdrop.

> **Design note:** collapsing "ports + planets + bases" into one concept — *the orbital
> station* — kills a whole interaction mode (land/take-off) and keeps the UI to a single
> verb: **dock**. Simpler to build, simpler on a phone.

---

## 3. Time & the turn economy ⏳ **(key decision: the Energy model)**

We use a **regenerating token pool ("Energy")** rather than fixed 1/day or 1/4h turns —
most forgiving of schedules/timezones, and it naturally produces the "check in between
prompts" rhythm. (It can be tuned to *feel* like 4-hour turns if we want the simple
version first.)

- **Energy** pool, e.g. **max 24**, regenerating **+1 per hour** (full from empty in a day).
- Banks **up to the cap** while you're away — miss a day, log in with a full tank, no
  penalty. The cap stops "vacation player returns with 5000 turns."
- Actions cost Energy:
  | Action | Cost (tunable) |
  |--------|----------------|
  | Move one lane | 1 |
  | Jump a wormhole | 3 |
  | Trade / dock action | 1 |
  | Scan / probe a star | 1 |
  | Attack | 2–4 |
  | Deploy fighters/mines | 2 |
- **Upgrades raise the cap or the regen rate** — a clean, non-pay progression axis.

> **MVP suggestion:** build the general Energy model but tune it to feel like "~6 meaningful
> actions per 4 hours" so it's intuitive.

### The background tick

Separate from player Energy, the world advances on a **server tick**: NPCs move, stations
restock, prices drift, missions refresh. Recommended cadence: a **light tick every ~15 min**
and a **heavy tick hourly/daily**. Players experience this as "stuff happened while I was
gone," and the IRC bot narrates it.

---

## 4. Core loop

```
   check in  ──►  see what changed (IRC/feed)  ──►  spend Energy
       ▲             (route raided? new mission?         (trade / move /
       │              friend took a station?)             fight / mission)
       └──────────────  close tab, energy regens  ◄────────────┘
```

Early game: explore, find a profitable **port pair**, run trade + courier missions, build
reputation, buy a bigger ship. Mid game: take on bounty/escort missions, claim an outpost,
drop fighters on a chokepoint, join/form a corp. Late game: control stations & wormhole
mouths, run faction-rep chains, contest other corps.

---

## 5. Economy & trade (the money loop)

Lifted from TradeWars and modernized (see [reference](../../2-Resources/tradewars-2002-reference.md)):

- Three commodities: **Fuel Ore, Organics, Equipment**.
- **Trade stations** each Buy some and Sell others (the 8 buy/sell combos = station
  classes). What a station trades is flavored by the planet/star it orbits.
- Profit comes from **port pairs**: a station selling cheap Organics near one buying
  Organics dear → haul between them.
- **Dynamic pricing:** prices move with stock. Drain a station and its price worsens, so
  routes wear out and you roam — this keeps the galaxy in motion.
- **Modern affordances:** show current prices, expected margin, and *discovered* route
  hints. Keep the discovery thrill; cut the spreadsheet grind.

Money (**Credits**) buys ships, upgrades, modules, fighters, and outpost construction.

---

## 6. Missions, factions & unlocks **(the sense of direction)**

Pure sandbox ("get rich") isn't enough of a goal, so **missions** give moment-to-moment
purpose and **factions/reputation** give the long-term ladder of *unlocks*.

### Missions (offered at stations, refreshed on the tick)

- **Courier / delivery** — haul cargo from station A to B by a deadline. (Leans on the trade
  loop; the bread-and-butter early mission.)
- **Procurement** — "bring me 50 Organics." Sends you trading with a target.
- **Bounty** — hunt a specific NPC pirate somewhere in a region.
- **Escort** — protect an NPC convoy along a lane route (async-friendly: resolves over
  ticks/hops).
- **Survey / exploration** — chart an un-scanned sector or locate an undiscovered wormhole.
  Rewards mapping the fractal galaxy.
- **(Later) story / faction chains** — multi-step arcs that build toward big unlocks.

Missions pay **Credits + faction reputation**, sometimes **module/blueprint unlocks**.

### Factions & reputation = the unlock tree

- A few NPC **factions** run different parts of the galaxy (e.g. a Traders' Guild, a mining
  combine, a frontier patrol).
- Doing their missions (and trading at their stations) raises **reputation**, which
  **unlocks**: better ships & modules, access to gated shipyards, higher-tier missions,
  discounts, and safe passage through their space.
- This is the "unlock things" backbone you wanted — progression you *earn*, never buy.

---

## 7. Ships & travel

- Start in a small **scout/trader** with limited cargo holds and weak weapons.
- Ship stats: **cargo holds, shields, fighters carried, hull, warp ability** (can it use
  wormholes / how cheaply). (Fuel as a *second* resource is optional — Energy is probably
  enough for MVP.)
- Buy/upgrade ships and **modules** at StarDocks/shipyards, gated partly by faction rep.
- Losing a fight damages/destroys your ship, but you **escape-pod** back to a StarDock — a
  setback, not deletion (see §8).

---

## 8. Combat — possible, but losing doesn't wipe you

PvP is **definitely in**, but a loss is a **setback, not destruction** (explicit design
goal). Built to work when players are rarely online together:

- **PvE:** NPC pirates/traders roam. Fight them for loot/bounties or avoid them — the
  baseline danger and a source of early income/risk.
- **Async PvP via deployables:** drop **fighters** or **mines** in a star to toll, block, or
  damage anyone passing through. You attack a *position*, not a person who must be online —
  the TradeWars insight that makes async combat work.
- **Direct PvP:** if two players share a star, they can engage; otherwise combat is mediated
  through deployed assets and defenses.
- **Soft-loss rules (the safety net):**
  - You **escape-pod** to the nearest StarDock with your life and a basic ship — never a
    deleted account.
  - You may **drop / lose cargo and fighters** (the spoils of the winner) and take **repair
    or replacement costs** — that's the sting.
  - **Ship insurance** (buy at StarDocks) softens replacement cost further.
  - **Safe zones:** StarDocks and a small core region are no-combat refuges for newbies and
    returning players.
- Resolution is **deterministic-with-variance** on the server (shields vs fighters vs hull),
  narrated to the player and to IRC. No client-side combat.

---

## 9. NPCs

These keep a tiny player base feeling like a living galaxy:

- **NPC traders** run their own port-pair routes (intercept their cargo).
- **NPC pirates** roam, especially in fringe regions, and may camp wormhole mouths —
  prime bounty-mission targets.
- **Faction NPCs** crew stations, give missions, and patrol their territory.
- All NPC movement/spawning happens on the **server tick**, so the world visibly changes
  between check-ins — and the IRC bot narrates it.

---

## 10. Stations, outposts & territory

With planets demoted to flavor, **the ownable power base is the station/outpost**:

- Players (and **Corps**) can **build or capture outposts** at stars — your foothold, your
  cargo cache, your defended chokepoint.
- Outposts can host **defenses** and (late game) be **upgraded** into fortified hubs (the
  old "citadel" idea, now an orbital station tier).
- Outposts and key trade stations are **capturable** — the main long-term PvP objective.
- Controlling **stations + wormhole mouths** in a region is the macro-game.

> **Open call (see §15):** how player-buildable are outposts at MVP vs. later? Could start
> as "capture/garrison existing NPC stations" and add from-scratch building afterward.

---

## 11. Corporations (alliances)

- Players form **Corps** to share territory, stations, assets, and intel.
- Corp-held **regions** and **wormhole mouths** are the macro-game.
- Keep it light for MVP (shared membership + shared station access); deepen later.

---

## 12. Progression

Non-monetary, all earned:

1. **Faction reputation** → unlocks ships, modules, gated stations, better missions.
2. **Energy cap / regen** upgrades (more actions per day).
3. **Ship tiers & modules** (cargo, combat, warp efficiency).
4. **Territory** (outposts, upgraded stations, regions).
5. **Reputation / bounties** (social + IRC bragging rights).

---

## 13. Onboarding & social

- **Invite-only.** New players need an invite (likely tied to an AfterNET account). Keeps it
  a friends' galaxy.
- Gentle tutorial: spawn near a safe StarDock with a known nearby port pair and a starter
  courier mission, so the first session is "do one delivery, make a profit, buy an upgrade."
- **IRC is the shared narrative layer** (see §14).

---

## 14. IRC integration (a first-class feature)

The IRC bot makes the asynchronous game feel social and alive. It should:

- **Announce notable events:** big trades, ship kills, mission completions, outpost
  captures, wormhole discoveries, new player joins, NPC pirate rampages, region control
  changes.
- **Answer queries** via commands: `!status <player>`, `!leaderboard`, `!map <region>`,
  `!bounties`, `!whereis <player>` (privacy-gated, slightly fuzzed for flavor/intel).
- **Daily "Galactic News" digest:** "Overnight: 3 stations raided, pirates massing in R12,
  @alice captured the outpost at R7·S3·#412."
- Tunable verbosity so the channel doesn't get spammy. Technical design in the
  [infrastructure doc](technical-infrastructure.md#irc-bot).

---

## 15. MVP scope vs. later

**MVP (first thing friends can play):**

- Generated 1000-star map with wormholes; flat 2D map UI.
- Invite-only auth.
- Energy model; move/wormhole/trade/scan actions; **dock** as the single station verb.
- Trade stations + dynamic pricing + one ship/module upgrade path.
- **Missions v1:** courier, procurement, bounty. Faction reputation with a couple of
  factions driving unlocks.
- NPC traders & pirates on the tick.
- PvE combat + escape-pod + basic soft-loss (cargo drop, repair cost).
- IRC bot: event announcements + a couple of `!` commands.

**Fast-follow:**

- Async PvP (fighters/mines); outposts (capture/garrison first); Corps; escort & survey
  missions; insurance; leaderboards; daily IRC digest.

**Later / spicy:**

- From-scratch outpost building & upgrade tiers; faction story chains; drone/automation
  layer (hire a drone for chores); drifting/collapsing wormholes; region victory conditions;
  seasonal galaxies (wipe & regenerate from a new seed).

---

## 16. Open questions

1. **Energy tuning** — smooth hourly vs. 4-hour feel for MVP? (Lean: Energy, tuned to ~4h.)
2. **Outposts at MVP?** Capture/garrison existing stations first, or hold for fast-follow?
   (Lean: fast-follow; MVP ends at trade + missions + PvE.)
3. **PvP teeth among friends** — full async PvP at launch, or safe-zone-heavy for the first
   week so nobody rage-quits getting ganked by a buddy?
4. **How many factions** and how distinct? (Affects how rich the unlock tree feels.)
5. **Is fuel a second resource**, or is Energy the only travel cost? (Lean: Energy only.)
6. **Invite economy:** only you hand out invites, or do players get a few?
7. **Season wipes:** forever-galaxy or periodic wipes? (Affects how harsh combat/territory
   can be.)
8. **Player count target** — sizes NPC density, mission supply, and map feel (~8 vs ~50).
