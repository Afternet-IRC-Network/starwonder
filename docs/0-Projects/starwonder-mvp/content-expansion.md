# StarWonder — Idle Content Expansion

> The idle-narrative engine ([idle-narrative.md](idle-narrative.md)) is built and humming;
> what it's short on is **content**. This is the plan for getting a ton more of it without
> bending the architecture: four multipliers, ordered by cost. The pacing math that motivates
> it: at a typical port the eligible event pool sums to ~8–9 weight against a quiet weight of
> ~25–40 (`idle_quiet_weight` = 30), so a docked trader sees **about one event every 2 hours**
> — and with ~31 outcomes total, repeats read word-for-word identical fast.

> **Status: BUILT — all four multipliers (June 12 2026).** The registry contract held
> throughout: modules stay pure, one file per dynamic, content interacts only through
> `DockContext`. What landed:
>
> 1. **Line variants** — every outcome's `summary` AND `line()` now has 3–5 seeded
>    phrasings. One variant index is rolled at resolve time (`vIndex`, `modules/util.ts`)
>    and stored in `fact.numbers.v`, so `line()` stays a pure function of the fact
>    (`vline`/`vpick` pick by modulo).
> 2. **Context gates** — `DockContext` grew `worldClass` / `dangerTier` / `rimT` /
>    `stationType` (the `SectorFlavor` mixin), `roster` (names of other traders parked
>    here), and `at` (the nominal beat clock, for flag age). Plumbed in
>    `apps/server/src/idle.ts` (`sectorFlavorOf` + `rosterAt`) and per-leg in
>    `settleTransit` (the `sectorFlavor` callback). First users: **cargo-watch** (livestock
>    escapes, medical pleas, luxury prowlers — the cargo gate), **fellow-traders**
>    (beats that name real traders in the sector — the presence gate), and pirate-shadow's
>    danger-tier odds.
> 3. **The vignette pool** — `modules/vignettes.ts` + `src/data/vignettes.json`:
>    ~195 curated rows (≈585 phrasings) across dock/orbit/transit, gated by vibe corners,
>    world class, station type, danger tier, rim band, goal, tag, cargo, flags, and
>    conditions. One resolver; rows are texture-with-teeth (small bounded effects) or pure
>    texture. `POOL_SCALE` in vignettes.ts is the single pacing knob. The row schema below
>    is the authoring contract; the pool is validated row-by-row in `test/idle.test.ts`.
> 4. **Chains** — the contact returns (cantina-contact: tip-off / courier / introduction,
>    favor spent = flag cleared), the harbour-master asks back (harbour-favor: a one-shot
>    errand shaped by lawful/shady tags), pirate **toll-receipt** (a fading condition: the
>    next cutter waves you through or shakes you down harder), ship's-cat beats (gifts,
>    ambassador standing), the **lay-low** payoff module (heat bleed + "the port forgets
>    you"), and the **hustle ladder** (cards → backroom game → big table, `card-rep` /
>    `big-table` flag-gated). `StatDelta` flag deltas gained `clear`; `flagAge()` reads the
>    beat clock.

---

## 0. Inventory (baseline, June 2026)

15 modules · ~17 events · ~31 outcomes · 4 conditions (`measles`, `measles-immune`,
`injured`, `ship-cat`) · 2 flags (`contact`, `vip`).

| Module | Pool | Gate | Outcomes |
|---|---|---|---|
| price-rumour | dock | always (bargain-hunt ×6) | 1 |
| chance-find | dock | always (lucky ↑ cautious ↓) | 2 |
| pickpocket | dock | tense/lawless (charming foils) | 2 |
| cantina-contact | dock | always (network ×3) | 1 |
| dockside-sweep | dock | law<0.5 ∧ tension>0.4 ∧ ¬lay-low | 5 |
| customs-audit | dock | law>0.6, heat draws it | 2 |
| harbour-favor | dock | network ∧ standing≥2, once/station | 1 |
| measles | dock | rare, scruffy ports | 2 + condition |
| bar-brawl | dock | tension>0.5 | 4 + condition |
| stray-cat | dock | rare, once ever | 1 + condition |
| card-game | dock | hustle ∨ prosperity<0.4 | 2 |
| anchor-watch | orbit | always | 2 |
| debris-find | transit | always | 2 |
| pirate-shadow | transit | credits>0 | 3 |
| void-chatter | transit | always | 1 (5 canned lines) |

Known gaps: **lay-low** has no payoff event (only avoidance); **hustle** has only cards;
orbit has a single module; flags are set but never paid off.

## 0b. Census after phases 1–4 (June 12 2026)

21 modules · 33 hand-written events + **195 vignette rows** · ~60 hand-written outcomes
(each with 3–5 phrasings on both voices) · 5 conditions (+`toll-receipt`) · 5 flags
(`contact`, `vip`, `vip-errand`, `card-rep`, `big-table`). All the §0 gaps are closed:
lay-low pays off (its own module), hustle has a three-rung ladder, orbit has three
modules plus 28 vignette rows, and every flag is read somewhere. Pacing: the vignette
pool adds ~4–6 eligible weight at a typical port (tunable in one place: `POOL_SCALE`),
so the event cadence roughly doubles while quiet still dominates — the "quiet stretches
dominate" test pins this.

---

## 1. Line variants — make the existing 31 outcomes read like 120

**What:** every `line()` (the #log template) and `summary` (the IRC line) gets 3–5 seeded
phrasings per outcome instead of one. Pick with the beat's `rng(salt)` so replays are
deterministic.

**How:** add a tiny `variant(ctx | fact, salt, lines[])` helper in `modules/util.ts`; the
fact must carry whatever seeds the pick (e.g. store a `v` index in `fact.numbers` at resolve
time so `line()` stays a pure function of the fact). No type changes; module-by-module sweep.

**Effort:** a writing day. **Win:** the #3 repeat of any event stops being copy-paste; the
IRC channel stops sounding like a bot.

Voice rule applies ([CLAUDE.md]): terse ship's-log register, third-person summaries with no
leading pronoun, second-person mechanical-truth log lines.

## 2. Context gates — make the same content feel local

**What:** `DockContext` grows four read-only fields the generators already know:
`worldClass`, `dangerTier`, `rimT`, `stationType`. Pure plumbing in `apps/server/src/idle.ts`
(dock/orbit settles) and `settleTransit` (use the course's current leg).

**Why:** modules can then gate like the world does — ice-world orbit beats, frontier-outpost
desperation, core-haven bureaucracy, danger-tier pirate odds — so the galaxy's existing
texture (class, danger, rim) shows up in the *stories*, not just the map.

Two gates worth building events around immediately:
- **Cargo-aware** (`stats.cargo` is already in context, unused): hauling livestock attracts
  livestock trouble; medical supplies attract the desperate; luxuries attract thieves.
- **Presence-aware** (needs a `roster: string[]` field): beats that name *real* traders
  parked in the same sector — "shared a watch with <name>". Multiplayer flavor nobody else
  has. (Knowledge policy: roster names are only known where you ARE, which is exactly where
  beats happen — no leak.)

**Effort:** ~half a day of plumbing + tests, then it pays into every future module.

## 3. The vignette pool — content as data (the volume play)

**What:** promote `void-chatter`'s pattern (array of texture, one resolver) to a first-class
**data-driven module**: one generic `vignettes.ts` module whose content lives in a JSON pool
(`data/vignettes.json`), same as the name pools. Target 200–500 rows.

Row schema (kept deliberately small):

```jsonc
{
  "id": "busker-band",
  "context": "dock",            // dock | orbit | transit
  "gate": {                      // all optional; absent = no constraint
    "lawMax": 0.5, "tensionMin": 0.4, "prosperityMax": 0.35,
    "tag": "shady", "goal": "hustle", "worldClass": "ice", "stationType": "outpost"
  },
  "weight": 1,
  "effect": { "credits": [-60, 90] },   // tiny ranges; or standing/heat/nudge/none
  "newsworthy": false,
  "lines": ["…", "…", "…"]            // 1–5 phrasings, seeded pick (multiplier 1 built in)
}
```

One resolver validates the gate, rolls the effect range, picks a line. Big effects, branches,
and conditions stay hand-written modules — the pool is for **texture with teeth** (small
deltas) and pure texture.

**Authoring pipeline:** a `build-vignettes` script in the spirit of `build-names` — prompt an
LLM offline with the schema + voice rules + vibe-corner matrix (3 law × 3 tension × 3
prosperity × 3 contexts), generate a few hundred candidates per corner, then **curate by
hand** into the pool. Runtime stays pure and deterministic; the LLM never runs in the game.

**Effort:** ~a day for module + script, then authoring is editing JSON forever after.
**Win:** this is where "a ton" comes from — and every row eats into the quiet weight, so
pacing livens without touching `idle_quiet_weight`.

## 4. Chains — pay off the memory the system already keeps

**What:** flags give stations memory; nothing reads them yet. A handful of two-beat arcs:

- `contact` (set by cantina-contact) → **the contact returns**: a tip-off (rich nudge), a
  small courier favor (credits), or an introduction (+standing at a *neighbouring* station).
- `vip` (set by harbour-favor) → **the harbour-master asks back**: a quiet errand with a
  choice-shaped outcome (lawful vs shady resolution by tags).
- Pirate toll paid (set a `toll-paid` flag in pirate-shadow) → **the same cutter waves you
  through** next time on this lane (or shakes you down harder — seeded).
- `ship-cat` → rare cat-scoped beats (it drags something aboard; it's missing at undock and
  delays you a beat; dockhands recognize the cat before they recognize you: +standing).
- New goal-gap fillers double as chain anchors: **lay-low** payoff (heat bleed event + "the
  port forgets you"), a **hustle** ladder (cards → backroom game → the big table, flag-gated).

**Mechanism:** nothing new — `eligible()` reads `stats.flags`, outcomes set/clear flags.
Maybe one helper for flag age (`flags[k]` is already an epoch ms).

**Effort:** each chain is a normal module (~1–2h each). **Win:** perceived depth — the world
remembers you.

---

## Order & the narrator caveat

Build order: **1 → 2 → 3 → 4** (variants and gates fatten what exists; the pool is the
volume; chains are the depth). Run the inventory table above as a census after each phase.

Spend authoring budget on **outcomes, gates, and effects** — things the future AI narrator
(`narrator.ts`, the one unbuilt layer) cannot invent — rather than on prose, which it will
eventually skin for free. Multiplier 1 is the exception: it's cheap and the templated lines
are the permanent fallback (and the IRC bot's only voice).
