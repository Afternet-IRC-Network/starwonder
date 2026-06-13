# StarWonder — Idle Narrative (docked downtime)

> While you're **docked**, time keeps moving. Small things happen to you — and to the
> goals you set running in the background — and the game narrates them in a short, evolving
> story coloured by *who you are*, *what this station is like*, and *what you told it to do*.
> Think idleRPG, but the dice rolls feed an AI that writes you a paragraph instead of a log line.

> **Status:** BUILT (MVP, June 2026) — the module registry (15 modules incl. the measles
> condition and 3 transit dynamics), conditions + `Modifiers`, settle-on-read, trader-level
> goals, personas, the time-boxed `market_nudge` → personal prices, and the IRC bot
> (`apps/bot` → `#starwonder` on AfterNET) are all live. **Downtime is no longer
> station-only** (June 2026): sessions are trader-level with a `kind` — `dock` or
> `transit` — and a plotted course is a transit session flown one hop per beat out of the
> regenerating energy pool (§7b). The UI is tab-agnostic: a 60s visibility-aware poll pops
> the **WhileAway sheet** over any tab when unseen events land, and the **Captain's Log**
> tab is the narrative's home; the dock modal keeps only station-local state. The AI
> narrator is the one unbuilt layer: until an `ANTHROPIC_API_KEY` is set, the log shows the
> exact prompt that WOULD be sent (see `apps/server/src/narrator.ts`). Companion to
> [Gameplay Overview](gameplay-overview.md) §3/§6/§8, [Technical Infrastructure](technical-infrastructure.md)
> §5/§6, and [trading](../trading.md). Realises the **local-station-reputation** branch of
> todo #8 and gives todo #6 (missions) a lightweight, self-directed sibling.

---

## 1. The idea in one breath

The game is already pseudo-turn-based: a regenerating **Energy** pool means you can only *do*
so much per day, so you check in, spend a few actions, and close the tab. That leaves a lot of
**downtime** — the hours your trader sits at a dock. Today that downtime is dead air. This
feature fills it: while you idle at a station, a cheap behind-the-scenes simulation rolls dice
every so often, nudges a handful of **base stats** (your standing here, your heat with the
law, your credits, your prices), and an AI stitches the mechanical "what happened" into a
**living narrative** that updates each time you look. You can set or change a **goal** at any
time ("find me a good deal on luxury foods"), and that steers what the simulation reaches for.

The payoff is character and consequence with almost no player input: you come back to find your
goody-two-shoes trader got swept up in a dockside sting at a seedy port, paid a fine, lost a
little standing with the locals — but the harbour-master now trusts you, and luxury food just
got pricier here. None of it cost you Energy; it's what happened *to* you while you were away.

---

## 2. The elegant fit (why this belongs in StarWonder)

This feature is only worth building if it reuses the shapes the codebase already loves. It does
— four times over:

| The project already does… | …so idle narrative does the same |
|---|---|
| **Energy is a timestamp, not a timer** (`currentEnergy` regens lazily on read) | The idle sim **settles on read** off the same dock timestamp. No per-player cron, no live loop. |
| **The galaxy is a pure function of `(seed, …)`** | Each idle **beat resolves deterministically** from `(seed, trader, station, session, beatIndex)`. Pure, lives in `game-core`, unit-testable. |
| **Names are a thin layer over a deterministic sector** | The **AI narrative is a thin layer over a deterministic event log.** Mechanics decide; prose describes. The game runs fine with the AI switched off (you just read the raw log). |
| **One registry table is the single source of truth** (`CLASS_SPEC`, `COMMODITY_SPEC`, `CONFIG_SPEC`) | The **module set is one registry** (`IDLE_MODULES`). A dynamic is one file — its events, its ongoing conditions, and its log lines together; add a file to extend the game. This *is* the "expandable plugin system" the idea asked for. |

> **Guiding-principle check.** The smallest model that captures the feel: a dock session is a
> timestamp + a goal; a "tick" is elapsed time ÷ a config interval; an event is one entry from
> a weighted registry; the story is an AI skin over the events. No background workers, no event
> queue, no per-station state machine. If the design starts growing services, we've missed the fit.

---

## 3. The four layers

```
                     ┌──────────────────────────────────────────────────────────┐
   you set a GOAL ──►│  game-core: deterministic idle sim  (pure, no I/O, no AI) │
   (free text +      │                                                          │
    a structured     │   beat = elapsed_docked_time ÷ idle_beat_minutes         │
    "kind")          │   for each unsettled beat:                               │
                     │     • gather ELIGIBLE plugins (station vibe ∩ your tags   │
                     │       ∩ current goal ∩ current stats)                    │
                     │     • weighted-pick one (or "a quiet stretch" = nothing) │
                     │     • plugin.resolve() → StatDeltas + a structured Fact   │
                     └───────────────┬──────────────────────────────────────────┘
                                     │ deltas + facts
                                     ▼
   ┌─────────────────────────────────────────────────┐     ┌───────────────────────────┐
   │  server: settle in one transaction               │     │  AI narrator (Haiku, lazy)│
   │   • clamp & apply deltas to the sparse override   │ ──► │   batch un-narrated facts │
   │     tables (rep, heat, credits, market nudges)    │     │   + persona + station vibe│
   │   • write event rows (feeds #log + IRC)           │     │   + goal  →  one paragraph│
   │   • advance dock_settled_at                        │ ◄── │   (cached; templated      │
   └─────────────────────────────────────────────────┘     │    fallback if AI is down)│
                                                            └───────────────────────────┘
```

### 3a. The substrate — the *base stats* plugins read and write

A deliberately small, typed set. These are the only things the downtime can touch (so balance
and anti-cheat stay tractable). Everything is a **sparse override** — a neutral baseline that
only gets a DB row once it diverges, exactly like `sector_state`.

| Stat | Scope | Meaning | Baseline |
|---|---|---|---|
| **standing** | (trader × station) | how the locals feel about you here | `0` (neutral) |
| **heat** | trader (global, decays) | how much the authorities are watching | `0` |
| **credits** | trader | fines, finds, bribes, tips, payouts | (your wallet) |
| **market nudge** | (trader × station × commodity) | personal price modifier on top of `generateMarket` | `1.0` |
| **cargo** | trader | goods found / lost / confiscated | (your hold) |
| **flags** | (trader × station) | one-shot facts the world remembers ("barred", "VIP") | none |
| **conditions** | trader | ongoing states with a lifetime ("measles", "injured", "immune") that passively warp other systems via **modifiers** (§4c) while active | none |

> **Note on prices.** `generateMarket` already multiplies by a `stockFactor` pinned to `1`
> (`sector-content.ts`). A personal **`relationshipFactor`** slots in the exact same spot — a
> sparse per-(trader, station, commodity) override — so "your standing here changes your
> prices" needs *no* new pricing math, just one more multiplier on the existing formula. See
> [trading](../trading.md).

> **Note on reputation.** This is the **local** half of todo #8's open question, made concrete:
> standing is per-station so word doesn't travel far, while **heat** is the one thing that
> *does* leak (and decays over time). Faction reputation, if we add it, layers on top later.

### 3b. The character — *structured tags for the dice, prose for the story*

Your trader carries a **persona**: a free-text blurb plus a few structured **trait tags**.
The split is the whole trick — the **mechanics only read the tags** (so they stay deterministic
and tunable), and the **AI only reads the blurb** (so flavour stays rich and free-form).

```ts
interface Persona {
  blurb: string;        // "a goody-two-shoes rule-follower, ex-customs officer" — AI only
  tags: TraitTag[];     // ['lawful', 'cautious', 'charming']                    — mechanics only
}
```

Tags shift plugin **eligibility and odds**: `lawful` makes the "shady deal" plugin rarer but the
"sweep catches you clean" branch kinder; `charming` tilts social rolls; `cautious` softens losses.
A handful of tags is plenty for MVP; they can be chosen at trader creation and/or earned.

### 3c. The station — *vibe derived from the seed, like world class*

A station already has a procedural identity (name, type, hue). We derive its **disposition** the
same pure way world class is rolled — no authoring, just a hash:

```ts
interface StationVibe {
  lawfulness: number;   // 0 = seedy underbelly … 1 = spit-and-polish, customs everywhere
  prosperity: number;   // 0 = struggling … 1 = booming
  tension: number;      // 0 = sleepy … 1 = something's about to kick off
}
// pure: hash("<seed>|vibe|<sectorId>") → the three axes. Havens skew lawful+calm (safe-zone pillar).
```

Vibe gates the event pool (a `lawful` trader at a `seedy` station is exactly where the fun
friction lives) and feeds the AI as flavour ("the station is a seedy underbelly").

### 3d. The goal — *a lightweight, self-directed mission*

At any time you can set a goal. Like persona, it's split:

```ts
interface Goal {
  blurb: string;                 // "find a good deal on luxury foods"   — AI only
  kind: 'bargain-hunt' | 'network' | 'lay-low' | 'hustle' | 'idle' | …;  // mechanics
  target?: CommodityId;          // optional focus, e.g. 'food'
}
```

The `kind` biases which plugins are eligible and what they reach for (`bargain-hunt` + `food`
→ price-discovery and deal events on that commodity; `lay-low` → suppresses heat-raising
events). Changing the goal only affects **future** beats — already-settled beats are committed.
This is todo #6 (missions) in miniature: a goal is a mission you write yourself, resolved by the
downtime sim instead of by travel.

---

## 4. The module registry — the expandable core

One array — **`IDLE_MODULES`** — is the single source of truth, in the `CLASS_SPEC` tradition.
A **module is a whole dynamic in one file**: the beat **events** that bring it into the world,
any ongoing **conditions** it can attach (§4b), and the templated **line** for every fact it
can emit — eligibility, odds, effects, recovery, and log lines all travel together, so a person
authors a new dynamic by adding one file. Modules are pure: they never touch the DB, only
**emit deltas and a fact**; the server applies them. And they never import each other — they
interact only through the shared, visible state in `DockContext` (one module's condition is
another module's eligibility test: a `quarantine-sweep` event can fire only on the infectious).

```
packages/game-core/src/
  conditions.ts        // Condition + Modifiers + activeModifiers() — trader-level, not idle-only (§4c)
  idle/
    types.ts           // DockContext, StatDelta, EventFact, IdleModule, IdleSession
    vibe.ts            // stationVibe(seed, sectorId) — pure hash, like world class
    settle.ts          // settleIdle(...) — the one pure entry point the server calls
    modules/           // ONE FILE PER DYNAMIC + index.ts exporting IDLE_MODULES
```

```ts
interface DockContext {
  rng: (salt: string) => number;   // unit(`${seed}|idle|${trader}|${sector}|${sessionStart}|${beat}|${salt}`)
  station: StationVibe;
  tags: TraitTag[];
  goal: Goal | null;
  stats: DockStats;                // standing / heat / credits / cargo — the beat-to-beat snapshot
  conditions: Condition[];         // active ongoing states — visible to ALL modules
}

interface PluginOutcome {
  deltas: StatDelta[];   // typed union: {kind:'standing',d}|{kind:'heat',d}|{kind:'credits',d}|
                         //   {kind:'marketNudge',commodity,factor}|{kind:'cargo',…}|{kind:'flag',…}|
                         //   {kind:'condition', add|clear}
  fact: EventFact;       // structured "what happened" the AI narrates (+ the #log line)
}

interface IdleEvent {
  id: string;
  eligible(ctx: DockContext): boolean;   // station vibe ∩ tags ∩ goal ∩ stats ∩ conditions
  weight(ctx: DockContext): number;      // relative odds among the eligible
  resolve(ctx: DockContext): PluginOutcome;
}

interface IdleCondition {
  id: string;
  label: string;                         // HUD chip text ("Station measles"); '' = hidden marker
  blurb: string;                         // tooltip: what it does + how it ends
  modifiers(c: Condition): Partial<Modifiers>;                 // passive warping while active (§4c)
  tick(c: Condition, ctx: DockContext): PluginOutcome | null;  // its own per-beat life; null = quiet
  permanent?: boolean;                   // inert history markers skip tick ("measles-immune")
}

interface IdleModule {
  id: string;
  events?: IdleEvent[];
  conditions?: IdleCondition[];
  line(fact: EventFact): string;         // templated fallback AND the always-shown #log line
}

export const IDLE_MODULES: IdleModule[] = [ /* one entry per dynamic — add a file to extend */ ];
```

The resolver per beat — conditions tick first, then one event rolls:

```
for cond of active conditions:  apply cond.tick(ctx)     // recovery rolls, worsening, side effects
eligible = events.filter(e => e.eligible(ctx))
pick     = weightedChoice(eligible, ctx.rng('pick'))     // includes the quiet-stretch no-op
apply(pick.resolve(ctx))                                 // mutates the in-memory snapshot (§7)
```

> **Quiet stretches are the norm.** Most beats should resolve to *nothing happened* (a heavy
> weight on the no-op, scaled by `tension`). Downtime that constantly throws events at you is
> exhausting and un-ambient — the opposite of the design pillars. The story should breathe.

### 4a. A worked one-shot event — `dockside-sweep` (the friend's example)

```ts
{
  id: 'dockside-sweep',
  // a sting only makes sense at a less-lawful, tense port; rarer if you're keeping your head down
  eligible: (c) => c.station.lawfulness < 0.5 && c.station.tension > 0.4 && c.goal?.kind !== 'lay-low',
  weight:   (c) => 2 + c.station.tension * 3,
  resolve:  (c) => {
    const caughtUp = c.rng('caught') < 0.5;          // were you swept up with the ruffians?
    const lawful   = c.tags.includes('lawful');
    if (caughtUp && lawful) {
      // you're clean, but the bust is messy: a fine, locals see you hauled off, the law warms to you
      return {
        deltas: [
          { kind: 'credits',  d: -200 },
          { kind: 'standing', d: -3 },               // the dockside crowd doesn't love a snitch-magnet
          { kind: 'heat',     d: -2 },               // …but you read clean; the law files you as cooperative
          { kind: 'marketNudge', commodity: 'food', factor: 1.15 },   // luxury food tightens after the bust
        ],
        fact: {
          plugin: 'dockside-sweep', outcome: 'cleared-but-fined',
          who: ['ruffians', 'station security'],
          summary: 'caught in a sting targeting a robbery crew; cleared after a fine',
          numbers: { fine: 200, standing: -3, heat: -2, foodPrice: '+15%' },
        },
      };
    }
    … // other branches: shady trader avoids the sweep, charming talks their way out, etc.
  },
}
```

The **`fact`** is the contract with the narrator: enough structured truth to write a paragraph,
and nothing the AI has to invent. The **deltas** are the contract with the world: bounded,
typed, clamped on apply.

### 4b. Conditions — dynamics with a lifetime

A one-shot event is done the moment its deltas land. A **condition** is an ongoing state —
measles, an injury, a stowaway — that persists on the trader and does two things while active:
passively **warps other systems** through modifiers (§4c), and lives its own per-beat life
through `tick` (recovery rolls, worsening, side effects). Conditions are **trader-scoped** —
they travel with you — stored as a sparse JSON list on the `traders` row (opaque, like `ship`).

```ts
type Condition = { id: string; since: number; data?: Record<string, number> };
```

A worked condition module — measles, a complete dynamic in one file:

```ts
// idle/modules/measles.ts
const measles: IdleModule = {
  id: 'measles',

  // how the dynamic ENTERS the world: a rare catch, worse at scruffy ports
  events: [{
    id: 'measles-catch',
    eligible: (c) => !has(c, 'measles') && !has(c, 'measles-immune'),
    weight:   (c) => 0.05 * (1 - c.station.prosperity),
    resolve:  (c) => ({
      deltas: [{ kind: 'condition', add: { id: 'measles' } }],
      fact:   { plugin: 'measles', outcome: 'contracted', summary: 'came down with station measles' },
    }),
  }],

  // the ongoing state it can attach
  conditions: [{
    id: 'measles',
    label: 'Station measles',
    blurb: 'Run down and spotty. Energy regenerates at half rate; jumps cost +1. Rest at a dock to recover.',
    modifiers: () => ({ energyRegenFactor: 0.5, moveEnergyCostDelta: +1 }),
    tick: (cond, c) =>
      c.rng('recover') < 0.15
        ? { deltas: [{ kind: 'condition', clear: 'measles' },
                     { kind: 'condition', add: { id: 'measles-immune' } }],
            fact: { plugin: 'measles', outcome: 'recovered', summary: 'finally shook the measles' } }
        : null,
  }, {
    id: 'measles-immune',                 // inert history marker — hidden, no chip, no effects
    label: '', blurb: '',
    permanent: true,
    modifiers: () => ({}),
    tick: () => null,
  }],

  line: (f) => MEASLES_LINES[f.outcome],  // "Came down with station measles." / "Finally shook it."
};
```

Two rules keep conditions tame:

- **Ticks run only during dock settlement; modifiers apply everywhere.** You recover at port
  (rest is thematically right), but flying sick is slower and pricier — and that choice (limp
  home now vs. wait it out) is the gameplay. If in-transit downtime ever lands (§11), ticks
  ride along for free.
- **Inert markers are free history.** `measles-immune` is a permanent, modifier-less condition:
  one-shot memory ("had it once, can't again") with zero new machinery. A cure could later be
  an ordinary commodity at high-`prosperity` stations — tying the dynamic back into trading.

### 4c. Modifiers — warp the inputs, never the functions

How a condition "affects energy, money, speed" without touching core code: every core system
already takes its parameters as **data** — `currentEnergy(state, cfg)` takes an `EnergyConfig`,
move cost comes from `CONFIG_SPEC`, prices flow through `stockFactor`. So conditions transform
the *inputs* at the call site; the core functions never learn that conditions exist.

```ts
// conditions.ts (game-core root — trader-level, consulted by idle, /api/move, /api/trade, energy reads)
interface Modifiers {
  energyRegenFactor: number;     // ×, default 1    — measles: 0.5
  energyCapDelta: number;        // +, default 0
  moveEnergyCostDelta: number;   // +, default 0    — measles / injured: +1
  priceFactor: Partial<Record<CommodityId, number>>;  // ×, default 1 — rides the stockFactor slot
}
export function activeModifiers(conditions: Condition[]): Modifiers   // fold + CLAMP
```

This struct is the **module-author API contract** — enumerated, typed, and clamped in the fold
(regen has a floor, move cost a ceiling) so stacked conditions can never zero a player out.
"What can a module do to the game?" has a one-screen answer, which is what keeps
community-authored dynamics tractable for balance and anti-cheat. A new lever (say,
`holdSizeDelta` for a cargo-parasite dynamic) is added to this struct in a **reviewed core
change**, never ad hoc inside a module — same governance as adding a `StatDelta` kind.

---

## 5. The narrative layer — AI as a skin, never an authority

This is the load-bearing invariant, and it's the same rule the whole project runs on (§5 of the
tech doc: *the client never decides game outcomes*). Here: **the AI never decides game
outcomes either.** The plugins already decided everything mechanical (you were fined 200, lost 3
standing); the AI's only job is to turn the accumulated facts into prose.

- **Consequence vs. colour.** The AI may invent *colour* — the dockworker's name, the smell of
  the cantina, the ruffians' bad tattoos. It may **not** invent *consequence* — no credits, no
  arrests, no price changes that aren't in the facts. The prompt states this hard; the facts are
  the only ground truth, and the #log shows the mechanical numbers alongside the prose so any
  drift is visible.
- **Batched and lazy.** We do **not** call the AI per beat. On a check-in we settle the
  mechanics (cheap, deterministic), collect the facts since `narrative_through_beat`, and make
  **one** call to fold them into the running story. Cache it; advance the pointer. A player who
  never opens the dock tab never costs us a token.
- **Cheap model, hard cap.** Use **Haiku** (`claude-haiku-4-5`), a tight token budget, and a
  short max length — this is ambient flavour, not an essay. Prompt-cache the static preamble
  (rules + persona + station vibe) so only the new facts vary turn to turn. Build it with the
  **`claude-api` skill** (it bakes in prompt caching).
- **Graceful degradation.** If the AI is unavailable or disabled, fall back to **templated**
  one-liners straight from the facts ("Caught in a dockside sting — fined 200cr; the law files
  you as cooperative."). The game is fully playable without a single API call; narrative is an
  enhancement, not a dependency.
- **It feeds IRC too.** The same facts the narrator reads are `events` rows, so the IRC bot
  (todo #16) can announce the juicy ones — the narrative layer and the town-square layer share
  one source.

### Story-consistency mechanics

The prose stays coherent because its inputs are managed, not because the model is trusted:

- **Facts are canon; the high-water mark tells each once.** `dock_sessions.narrated_through`
  is an `events.id` pointer. Narration = (facts above the mark + the previous prose) → one
  call → append, advance the mark. A fact is narrated exactly once, so the story can't
  contradict itself about *what happened* — only about wallpaper.
- **One-way ratchet on failure.** If the AI call fails, show the templated `line()`s and
  **advance the mark anyway**. Never re-narrate facts the player has already seen as log lines —
  retconning shown events into prose is a consistency hazard, not a feature. The prose has a
  gap; the log never does.
- **Bounded prose with self-compaction.** `narrative` keeps only the last ~3 paragraphs; on
  overflow the same narration call also emits a one-sentence "story so far" that replaces the
  dropped tail. Feeding the model its own prior prose is what keeps invented colour (the
  dockworker's name, the cantina) coherent within a session.
- **Nominal time.** Facts are stamped `started_at + beat·interval`, never settlement
  wall-clock, so twelve beats settled in one burst still read as a night's worth of separate
  happenings (see §6/§7).

Cross-session memory — a `motifs` field on `trader_station.flags_json` (named NPCs, running
threads the narrator may reuse when you re-dock, extracted by asking for `{prose, motifs}`) —
is deliberately **deferred**: it's AI-writes-state, a new trust category. Everything above
needs none of it.

### The IRC view (todo #16) — third-person blurbs, bot as heartbeat

The channel never sees raw `line()` logs (second-person) or AI prose (tokens, drift). It gets
**idlerpg-style third-person blurbs**, composed generically — no per-module work — because
`fact.summary` is already third-person past tense:

```
<trader> <fact.summary> — <station>.   →  "Cass Okafor came down with station measles — Foshay Docks Station."
```

(An optional `news(fact)` override per module can punch this up later.)

**Timing.** Lazy settlement means events don't exist until someone settles — announce-on-check-in
would make the channel silent all day, then dump four stale-timestamped events when a player
opens their tab (and leak check-in times, the least interesting fact in the game). Instead the
**bot doubles as the world's heartbeat**: each poll (≈ one beat interval) it settles all open
dock sessions through the same settle path — cheap, deterministic, idempotent, zero AI calls —
then announces `events` rows with `id > last_seen`. Nominal time ≈ real time; the channel
murmurs all day. This does **not** violate "no cron": the game never depends on the bot —
switch it off and everything degrades back to pure-lazy settlement. Eagerness is layered on a
lazy core, never required by it. (Narration is untouched: `narrated_through` still covers
everything since the *player's* last check-in, so the bot can't spoil anyone's story.)

**Publicity.** Outcomes are public (fines, brawls, measles — light public shaming is half of
idlerpg's charm); **goals are private**. The `newsworthy` flag keeps movement from flooding
the channel: course *departures* and single-hop arrivals are silent, only multi-jump route
arrivals announce ("came out of the black after 7 jumps"), and hop-around play is debounced
through the dock session — a stay that survives `arrival_announce_minutes` (default 3)
announces one "made port" line via the session's `announced` flag; leave sooner and the
channel hears nothing.

### Prompt shape (sketch)

```
[cached] You narrate a space-trading game. Continue a SHORT, evolving log of downtime at a station.
         Rules: describe ONLY what the facts state. Invent incidental colour, never consequences
         (no money/arrests/prices not in the facts). 2–4 sentences. Second person.
[cached] Trader: {persona.blurb}.   Station: {name} — {vibe → "a seedy, tense port"}.   Goal: {goal.blurb}.
[varies] Story so far: {previous narrative}
[varies] What just happened (facts): {facts since last narration}
```

---

## 6. Persistence — one session row + the sparse stat tables

Per the project's sparse-override philosophy. A trader is docked at exactly one station at a
time, so the live session is a single row; the log is one append-only table shared with the
rest of the game:

```
dock_sessions  (trader_id PK, kind 'dock'|'transit', sector_id, route TEXT,
                started_at, settled_at, beats_resolved,
                caps_used TEXT, narrative TEXT, narrated_through INTEGER)
                  -- THE trader's live downtime session (at most one). kind 'dock': parked at
                  -- sector_id; deleted on undock. kind 'transit': flying a plotted course —
                  -- route = {path, costs, wormhole, leg}; sector_id is the origin (§7b).
                  -- caps_used: per-session credit/standing swing already consumed, so the §8
                  -- rails survive multiple check-ins. narrated_through: events.id mark (§5).
                  -- The GOAL is NOT here: it moved to traders.goal (trader-level, §3d).

events         (id PK, trader_id, sector_id, beat NULLABLE, at, plugin, fact TEXT)
                  -- append-only. `at` is the beat's NOMINAL time (started_at + beat·interval),
                  -- never settlement wall-clock. fact is opaque JSON. Shared on purpose:
                  -- moves/trades can log here too (beat NULL) — this is THE event feed for
                  -- #log, todo #14, and the IRC bot (#16), not an idle-only side table.

trader_station (trader_id, sector_id, standing, flags_json, PK(trader_id, sector_id))
                  -- sparse: a row exists only once standing/flags diverge from neutral.
                  -- THIS is local reputation (todo #8) — the station remembers you between visits.

market_nudge   (trader_id, sector_id, commodity, factor, expires_at,
                PK(trader_id, sector_id, commodity))
                  -- sparse personal price modifiers; consumed by generateMarket's
                  -- relationshipFactor. expires_at: rumours and deals are time-boxed, so
                  -- acting on one is a decision, not a permanent buff.
```

`heat` and `credits` live on the existing `traders` row (heat as a new scalar +
`heat_updated_at` for lazy decay, mirroring `energy`/`energy_updated_at`); **`conditions`** is
a JSON list column on `traders` too (§4b) — trader-scoped because conditions travel with you.
**`goal`** is also a `traders` JSON column: the goal is *who you are right now*, not where you
happen to be parked, so it rides unchanged across docks and courses (this deleted the old
carried-goal special case). JSON columns stay opaque (never queried inside) →
Postgres-compatible, same as every other table.

**Lifecycle — settle before every mutation.** The one invariant that makes goal history
unnecessary: every handler that reads or mutates a docked trader **settles first** — the dock
read, `/api/trade` (nudges change prices), `/api/move`, `POST /api/goal`. Setting a goal
settles all elapsed beats under the *old* goal, then writes the new one, so "the current goal"
is always correct for every unsettled beat — no `goal_at(i)` lookup, no change log. Dock →
open a session (carrying over the standing goal). Check-in → settle, apply, then *lazily*
re-narrate (narration is never inside the settle transaction; mechanics never wait on the AI).
Undock → settle, append one final narrative event row (the `#log` keeps the finished story),
delete the session; **standing, heat, conditions, and nudges persist** (the world remembers).
Re-dock later → fresh session, same standing.

---

## 7. Settlement maths (mirrors Energy)

```
beats_elapsed = floor( (now − settled_at) / idle_beat_minutes )
beats_to_run  = min(beats_elapsed, idle_beat_cap)      // anti-FOMO: bounded backlog, like the Energy cap
snapshot      = load stats (standing, heat, credits, cargo, conditions)
for i in beats_resolved .. beats_resolved + beats_to_run:
    rng  = (salt) => unit(`${seed}|idle|${trader}|${sector}|${started_at}|${i}|${salt}`)
    ctx  = { rng, vibe, tags, goal, snapshot }
    tick each active condition           // §4b — recovery rolls etc.; may emit deltas + facts
    roll one weighted eligible event     // incl. the quiet no-op
    clamp deltas against caps_used; apply to snapshot; stamp fact at = started_at + i·interval
settled_at    = settled_at + beats_to_run * idle_beat_minutes   // not "now" — keep the cadence honest
```

Beats are **sequential**: beat 7 sees the credits beat 3 took, so a session is a fold over the
in-memory snapshot, and the server persists only the summed result in one transaction. The rng
key includes `started_at`, so re-docking at the same station never replays the same script —
and it makes any session **replayable** from its row plus the goal: an admin "replay this
session" debug view is nearly free.

Same trick as `currentEnergy`: no loop runs while you're gone; the elapsed time *is* the clock,
and we replay it on the next interaction. The **cap** means a month away doesn't dump 500 events
on you — you settle a bounded, digestible backlog (consistent with "miss a day, no penalty").

## 7b. Transit — every journey is a course, paced by energy alone (BUILT)

The §11 "in-transit downtime" idea, realised as the Energy trick applied to *movement* —
and the resolution of the "two pacing systems" question: **energy IS the travel clock**.
There is no hop cadence and no separate "travel now"; a course flies **greedily**, and the
single mechanic does the right thing automatically:

```
settleTransit (pure, game-core/src/idle/transit.ts), per remaining hop:
  1. earliest nominal time the hop's cost is affordable (readyAt — pure regen arithmetic;
     moveCostWith folds condition modifiers, so flying sick is pricier ⇒ slower)
     • already affordable → fires IMMEDIATELY: a banked pool sprints hop after hop with
       no wait at all (this is the old "travel now", absorbed)
     • not yet → if the ready-time is still in the future, stop; the regen clock paces it
       (a 1⚡ lane hop every ~6 min at defaults; a 15⚡ wormhole ~90 min — span-priced
       TIME, for free)
  2. each landed hop grows fog (+ wormhole knowledge) and may roll ONE transit event
     (quiet-heavy weighted pick over the registry events tagged context:'transit')
  3. arrival emits the 'course/arrived' fact and flips the session to a DOCK session
     anchored at the NOMINAL arrival time — the server chains straight into the dock settle
```

`transitSchedule` (same arithmetic, no side effects) projects `nextHopAt`/`etaAt` for the
UI, so a course quote is exact: "flies now" with a charged tank, "~N min charging en route"
without. The client has **one travel verb**: the map's "Set course" and a sector-screen
lane/known-wormhole tap (a 1-hop course) both call `POST /api/course` — instant when
charged, "waiting to jump" when broke, never an error. Only a *blind* wormhole jump still
uses `/api/move` (the autopilot won't fly into the unknown). `DELETE /api/course` or taking
the helm manually drops out of warp where the ship is. Goals apply in transit too — the
structured `kind` biases the transit pool exactly like the dock pool.

### The UI surfaces (BUILT with transit)

The story is **trader-level, so it's tab-agnostic**. Three surfaces, one source:

- **Captain's Log** (`#log`, `CaptainsLog.vue`) — the narrative's home: the current session
  card (docked / under way / adrift, story-so-far, the goal editor, the narrator prompt
  preview) over the full event history in chapters by place.
- **WhileAway sheet** (`WhileAway.vue`) — `App.vue` polls `/api/idle` + `/api/log?since=`
  every 60s (skipped while the tab is hidden; fired immediately on visibilitychange/login)
  and pops the sheet over *whatever tab is open* when events newer than the last-seen id
  (localStorage) arrive — fresh login, restored tab, or a browser left open all behave the
  same. Dismissing marks seen; the Log-tab badge is the quiet sibling.
- **Dock modal** (`DockLife.vue`) — deliberately demoted to *station-local* state only
  (vibe, standing, heat, conditions). The story never lived at the station; now the UI
  agrees.

---

## 8. Balance & safety rails (the project cares about fairness)

- **Quiet by default** — most beats are no-ops; events are seasoning, not a firehose.
- **Bounded outcomes** — per-session caps on net credit swing and standing change (tracked in
  `dock_sessions.caps_used` so they survive multiple check-ins); a single beat can sting but
  never bankrupt or hard-wipe (same spirit as combat's soft-loss, §8).
- **Bounded modifiers** — `activeModifiers` clamps the fold (regen floor, move-cost ceiling),
  and the registry fuzz test stacks random condition sets to assert the clamps hold — plus
  that every non-`permanent` condition's `tick` terminates with reasonable probability (no
  accidental forever-debuffs). Run every module against thousands of fuzzed contexts asserting
  delta bounds: that's "keeps every event author honest," made executable.
- **Safe zones stay safe** — Havens and the core skew lawful/calm, so harmful events are rare
  there; a returning newbie isn't punished for idling (gameplay pillar: no FOMO/absence
  punishment). Enforced via `StationVibe` + a Haven suppressor.
- **Heat decays** — lazily toward 0, so a bad night fades; standing decays *slowly* toward
  neutral so relationships matter but don't ossify (echoes trading's "routes wear out, you roam").
- **No Energy cost** — downtime is the *opposite* of spending Energy; idling never drains it (in
  fact Energy regenerates over the same window). The two are independent lazy computations off
  the same dock clock.

---

## 9. Config knobs (add to `CONFIG_SPEC`)

Live-tunable from the admin Settings panel, same as the trading knobs:

| Key | Type | Default (placeholder) | Purpose |
|---|---|---|---|
| `idle_beat_minutes` | int | `30` | Docked minutes per idle beat |
| `idle_beat_cap` | int | `16` | Max beats settled in one catch-up (anti-FOMO) |
| `idle_quiet_weight` | float | `6.0` | Base weight of the "nothing happened" no-op |
| `idle_narrate` | int (bool) | `1` | Master switch for AI narration (0 ⇒ templated only) |
| `heat_decay_per_hour` | float | `0.5` | Lazy heat decay |
| `standing_decay_per_day` | float | `0.25` | Slow drift of station standing toward neutral |

---

## 10. How it maps onto the existing roadmap

This isn't a brand-new pillar so much as the connective tissue between several planned ones:

- **todo #8 (Reputation & alignment)** — `trader_station.standing` *is* the local-reputation
  branch, made concrete. Resolves part of that open question.
- **todo #6 (Missions)** — a **goal** is a self-authored mini-mission resolved by downtime
  instead of travel; shares the structured-intent shape.
- **todo #14 (Event feed) / #16 (IRC bot)** — idle facts are `events` rows; they populate `#log`
  and give the bot something to narrate.
- **The world tick (tech §6)** — pointedly *not* needed: idle settlement is **per-trader and
  lazy**, like Energy. No global cron. (A real tick is still optional later for NPCs/prices.)
- **trading (§5 / trading.md)** — `market_nudge` rides `generateMarket`'s existing `stockFactor`
  slot; downtime becomes a soft input to the economy.

---

## 11. Phasing

**MVP-minimal (prove the loop):**

1. `StationVibe` (pure, from seed) + a 3–5 tag persona at trader creation.
2. `dock_sessions` + `events` + settle-on-read (the settle-first invariant, §6) + the
   Energy-style maths — plus the test harness: golden tests (fixed inputs → exact fact
   sequence) and the registry fuzz test (§8).
3. The one-shot half of the starter roster (below); `standing` + `credits` deltas only;
   `#log` lines from `line()` templates (**no AI yet**).
4. A goal selector (kind + optional commodity + blurb) on the dock screen.

**Add the body:**

5. `conditions` + `Modifiers` (§4b/§4c), with measles as the proving module; condition chips
   in the HUD (label + blurb tooltip).
6. `market_nudge` (time-boxed) → personal prices, surfaced in `DockMarket` ("your price",
   reason, expiry); `heat` + lazy decay.

**Add the skin:**

7. AI narration (Haiku, batched, cached, templated fallback) behind `idle_narrate`.

**Later / spicy:**

8. Earned/changing trait tags; flags ("barred from the Pit", "VIP at the Exchange").
9. ~~Idle events in *other* contexts (in transit)~~ — **BUILT** (§7b): transit sessions +
   `context: 'transit'` events. Garrisoning etc. would follow the same shape.
10. Goals that can *complete* and pay out (the bridge to full missions, todo #6).
11. Cross-trader / social downtime (two of your traders, or two players, at the same station);
    contagion (conditions that spread via shared sectors).

### Starter module roster (the presumed first set)

| Module | Kind | Sketch |
|---|---|---|
| `quiet-stretch` | no-op | the heavily-weighted "nothing happened"; weight scaled down by `tension` |
| `price-rumour` | one-shot | goal-biased; grants a **time-boxed** `market_nudge` ("electronics −12% off Pier 9, today only") |
| `chance-find` | one-shot | small credits or cargo find; `cautious` finds less but never trouble |
| `pickpocket` | one-shot | small credit loss; `cautious` halves the odds, `charming` may talk it back |
| `cantina-contact` | one-shot | standing+, may set a `contact` flag for later goals |
| `dockside-sweep` | one-shot | the sting (§4a): fine / standing / heat swings + a market knock-on |
| `customs-audit` | one-shot | lawful stations, heat-driven; clean = heat down, contraband = fine |
| `harbour-favor` | one-shot | `network` goal; VIP flag → small standing + price perk at this station |
| `measles` | condition | §4b: regen ×0.5, jumps +1, recover at dock, immune after |
| `bar-brawl` | one-shot → condition | `charming` ducks it; otherwise a standing swing + short `injured` (jumps +1) |

---

## 12. Open decisions (sign-off checklist)

- [ ] **Beat cadence & cap** — `idle_beat_minutes` / `idle_beat_cap` starting values (placeholder 30 / 16).
- [ ] **Trait tags** — the starter set, and chosen-at-creation vs. earned vs. both.
- [ ] **Standing model** — does it decay toward neutral, and how fast? Pure-local, or does a sliver leak to neighbours?
- [ ] **Heat** — global scalar (simplest) vs. regional; decay rate.
- [ ] **Goal `kind` set** — the initial enum (`bargain-hunt` / `network` / `lay-low` / `hustle` / `idle` / …).
- [ ] **Narrator model & budget** — confirm Haiku, token cap, max length, cache layout, refresh cadence (per check-in vs. throttled).
- [ ] **Consequence/colour line** — exactly what latitude the AI gets; how we surface mechanical numbers next to the prose so drift is visible.
- [ ] **`Modifiers` field list** — the initial enum (`energyRegenFactor` / `energyCapDelta` / `moveEnergyCostDelta` / `priceFactor`, …) and its clamp values; this is the module-author API contract — `CLASS_SPEC`-grade care (§4c).
- [x] **Where the session lives** — its own `dock_sessions` table (§6).
- [x] **Condition ticks while undocked** — no for MVP: ticks run only at dock (you recover at port), but modifiers apply everywhere (§4b).
- [ ] **Scope** — docked-only for MVP (recommended), or in-transit downtime from day one?
```
