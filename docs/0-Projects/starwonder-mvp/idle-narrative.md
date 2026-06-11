# StarWonder — Idle Narrative (docked downtime)

> While you're **docked**, time keeps moving. Small things happen to you — and to the
> goals you set running in the background — and the game narrates them in a short, evolving
> story coloured by *who you are*, *what this station is like*, and *what you told it to do*.
> Think idleRPG, but the dice rolls feed an AI that writes you a paragraph instead of a log line.

> **Status:** PROPOSED — design draft, nothing built yet. Companion to
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
| **One registry table is the single source of truth** (`CLASS_SPEC`, `COMMODITY_SPEC`, `CONFIG_SPEC`) | The **plugin set is one registry** (`IDLE_PLUGINS`). Add an event by adding an entry; eligibility, odds, and effects all flow from it. This *is* the "expandable plugin system" the idea asked for. |

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

## 4. The plugin registry — the expandable core

One array is the single source of truth. A plugin is a tiny pure module: *can I fire? how
likely? what happens?* It never touches the DB — it only **emits deltas and a fact**; the server
applies them. This keeps every event author honest and the substrate the only write surface.

```ts
interface DockContext {
  rng: (salt: string) => number;   // deterministic 0..1, seeded by (seed, trader, station, beat)
  station: StationVibe;
  tags: TraitTag[];
  goal: Goal | null;
  stats: DockStats;                // current standing / heat / credits / cargo snapshot
}

interface PluginOutcome {
  deltas: StatDelta[];   // typed union: {kind:'standing',d}|{kind:'heat',d}|{kind:'credits',d}|
                         //              {kind:'marketNudge',commodity,factor}|{kind:'cargo',…}|{kind:'flag',…}
  fact: EventFact;       // structured "what happened" the AI narrates (+ the #log line)
}

interface IdlePlugin {
  id: string;
  eligible(ctx: DockContext): boolean;   // station vibe ∩ tags ∩ goal ∩ stats
  weight(ctx: DockContext): number;      // relative odds among the eligible
  resolve(ctx: DockContext): PluginOutcome;
}

export const IDLE_PLUGINS: IdlePlugin[] = [ /* one entry per event — add to extend */ ];
```

The resolver per beat is dead simple:

```
eligible   = IDLE_PLUGINS.filter(p => p.eligible(ctx))
pick       = weightedChoice(eligible, ctx.rng('pick'))   // includes a "quiet stretch" no-op
outcome    = pick.resolve(ctx)
apply(outcome.deltas);  record(outcome.fact)
```

> **Quiet stretches are the norm.** Most beats should resolve to *nothing happened* (a heavy
> weight on the no-op, scaled by `tension`). Downtime that constantly throws events at you is
> exhausting and un-ambient — the opposite of the design pillars. The story should breathe.

### A worked plugin — `dockside-sweep` (the friend's example)

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
time, so the live session is a single row (or folded into `traders.ship`-style JSON):

```
dock_session   (trader_id PK, sector_id, started_at, settled_at, beats_resolved,
                goal_json, narrative_text, narrative_through_beat)
                  -- the live downtime at the trader's current dock; reset on undock

trader_station (trader_id, sector_id, standing, flags_json, PK(trader_id, sector_id))
                  -- sparse: a row exists only once standing/flags diverge from neutral.
                  -- THIS is local reputation (todo #8) — the station remembers you between visits.

market_nudge   (trader_id, sector_id, commodity, factor, PK(trader_id, sector_id, commodity))
                  -- sparse personal price modifiers; consumed by generateMarket's relationshipFactor
```

`heat` and `credits` live on the existing `traders` row (heat as a new scalar +
`heat_updated_at` for lazy decay, mirroring `energy`/`energy_updated_at`). JSON columns stay
opaque (never queried inside) → Postgres-compatible, same as every other table.

**Lifecycle.** Dock → open a `dock_session` (timestamp + carried-over goal). Read/check-in →
settle elapsed beats, apply deltas, re-narrate, advance `settled_at`. Set goal → write
`goal_json`, stamp the change so future beats use it. Undock/leave → archive the narrative to
the `#log`, close the session; **standing, heat, credits, and nudges persist** (the world
remembers). Re-dock here later → fresh session, same standing.

---

## 7. Settlement maths (mirrors Energy)

```
beats_elapsed = floor( (now − settled_at) / idle_beat_minutes )
beats_to_run  = min(beats_elapsed, idle_beat_cap)      // anti-FOMO: bounded backlog, like the Energy cap
for i in beats_resolved .. beats_resolved + beats_to_run:
    ctx  = buildContext(seed, trader, station, session, beat=i, goal_at(i), stats)
    …resolve & apply…
settled_at    = settled_at + beats_to_run * idle_beat_minutes   // not "now" — keep the cadence honest
```

Same trick as `currentEnergy`: no loop runs while you're gone; the elapsed time *is* the clock,
and we replay it on the next interaction. The **cap** means a month away doesn't dump 500 events
on you — you settle a bounded, digestible backlog (consistent with "miss a day, no penalty").

---

## 8. Balance & safety rails (the project cares about fairness)

- **Quiet by default** — most beats are no-ops; events are seasoning, not a firehose.
- **Bounded outcomes** — per-session caps on net credit swing and standing change; a single
  beat can sting but never bankrupt or hard-wipe (same spirit as combat's soft-loss, §8).
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
2. `dock_session` + settle-on-read + the Energy-style maths.
3. 4–6 starter plugins (a sweep, a tip-off, a price rumour, a chance find, a quiet stretch).
4. `standing` + `credits` deltas only; `#log` lines from `fact` templates (**no AI yet**).
5. A goal selector (kind + optional commodity + blurb) on the dock screen.

**Add the skin:**

6. AI narration (Haiku, batched, cached, templated fallback) behind `idle_narrate`.
7. `market_nudge` → personal prices; `heat` + decay.

**Later / spicy:**

8. Earned/changing trait tags; flags ("barred from the Pit", "VIP at the Exchange").
9. Idle events in *other* contexts (in transit, garrisoning) — the plugin registry already
   supports it; just a different eligible pool.
10. Goals that can *complete* and pay out (the bridge to full missions, todo #6).
11. Cross-trader / social downtime (two of your traders, or two players, at the same station).

---

## 12. Open decisions (sign-off checklist)

- [ ] **Beat cadence & cap** — `idle_beat_minutes` / `idle_beat_cap` starting values (placeholder 30 / 16).
- [ ] **Trait tags** — the starter set, and chosen-at-creation vs. earned vs. both.
- [ ] **Standing model** — does it decay toward neutral, and how fast? Pure-local, or does a sliver leak to neighbours?
- [ ] **Heat** — global scalar (simplest) vs. regional; decay rate.
- [ ] **Goal `kind` set** — the initial enum (`bargain-hunt` / `network` / `lay-low` / `hustle` / `idle` / …).
- [ ] **Narrator model & budget** — confirm Haiku, token cap, max length, cache layout, refresh cadence (per check-in vs. throttled).
- [ ] **Consequence/colour line** — exactly what latitude the AI gets; how we surface mechanical numbers next to the prose so drift is visible.
- [ ] **Where the session lives** — its own `dock_session` table vs. folded into the `traders` row as JSON.
- [ ] **Scope** — docked-only for MVP (recommended), or in-transit downtime from day one?
```
