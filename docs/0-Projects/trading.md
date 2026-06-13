# Trading

## What's built (phase 1 — the price field)

Broad commodity categories, not item-by-item iteration — thing / expensive version of thing:

metals / precious metals · minerals / rare minerals · food / luxury food · clothing /
designer apparel · livestock / advanced breeds · equipment / high-tech equipment ·
medical / high-tech medical · electronics / high-tech electronics

These live in **`COMMODITY_SPEC`** (`game-core/src/sector-content.ts`), ranked on a single
**technological complexity** axis. Prices are a pure function of `(seed, sector, commodity)`:
a core↔rim complexity gradient (high-tech cheap near Sol, raw materials cheap on the rim)
× small seed noise × a `stockFactor` pinned to 1 (the hook where dynamic per-station stock
accounting lands later). Ships have a `holdSize` in tons (`default_hold_size`, upgradeable
later).

## Phase 2 — trade orders (energy is the work clock)

**Design of record.** Trading is not instantaneous. Like travel, it is an *intent* that the
idle sim carries out while you wander off — and like travel, **energy alone paces it**.

> The unifying principle: a course is the transit settle applied to *movement*; an order is
> the same trick applied to *commerce*. One regenerating pool paces everything the captain
> does. No second resource, no timers, no cron.

### The order

One open order per trader (MVP), stored as a JSON blob on `traders.trade_order` — the same
pattern as `goal`:

```
{ sectorId, side: buy|sell, commodity, qty, filled, spent, limit?, placedAt, settledAt, attempts }
```

- `sectorId` — orders are **station-scoped** and require being **docked** (the dock
  session is the broker). Leaving — undocking, a plotted course, a blind jump — scrubs
  the order; whatever filled, you keep.
- `limit` — optional per-unit price rail: a ceiling when buying, a floor when selling.
- `spent` — credits moved so far; `spent / filled` is the running average price.
- `settledAt` / `attempts` — the fill clock cursor + the deterministic rng index.

### The fill loop (`game-core/src/idle/order.ts` — `settleOrder`, pure)

Greedy, exactly like `settleTransit`: each **haggle attempt** fires at the earliest moment
its chunk's energy is affordable; the loop replays elapsed wall-time deterministically
(rng keyed by `placedAt` + attempt index, never the clock).

Per attempt:

1. **Chunk** — a seeded 1–4 tons, clamped to what remains / fits the hold / you can pay
   for / you still hold.
2. **Haggle** — chunk price = the trader's *effective* market price (nudges + condition
   `priceFactor`, the same numbers the dock UI shows) × a seeded ±12% swing, biased in
   your favour by station standing, a `charming` tag, and `shady` at low-lawfulness ports.
3. **Limit check** — a roll outside your limit is a **no-deal**: no energy spent, a quiet
   log line, next attempt comes after one idle beat (`idle_beat_minutes`).
4. **Fill** — spend `max(1, units × trade_energy_per_unit)` energy (config knob, default 2),
   move the cargo and credits, log the fill fact.

A banked pool sprints the whole order on the spot — placing an order rested *feels* like a
live trade, the same way a charged 1-hop course feels like an instant jump. Broke, a fill
lands every ~12 min at defaults and a full hold takes a working day. The order **closes
short** (with its own log line) when the hold fills, the credits run dry, or the goods to
sell are gone.

### Narrative & knowledge

Every fact rides the existing event feed: fills and no-deals are quiet (`newsworthy:
false`); **completion is the news** — the IRC channel hears "closed out a buy order: 20t
of electronics at ~117 cr" once, names-not-numbers as always. The `trade` idle module
(`modules/trade.ts`) owns all log lines; the narrator sees the facts like any others.
Because fills price through the effective market, the rumour loop closes: hear a dockside
tip, place the order, fill cheap.

### Server glue

- **Settle-first**: `settleTrader` runs order fills after the dock-beat settle, every time
  anything touches the trader (`apps/server/src/idle.ts`). Same one-transaction persist.
- **Intents**: `POST /api/order` (place; bursts immediately) and `DELETE /api/order`
  (scrub) replace the old live `POST /api/trade`. Both return the updated trader + order +
  market. `/api/idle` (dock mode) carries the live order view with `nextFillAt` / `etaAt`
  regen projections, mirroring the course view.
- **Rails**: order fills are *exchanges*, not windfalls — they bypass the idle session's
  `creditCap` (which exists to bound event swings, not commerce).

### Later (unchanged plans)

Dynamic per-station stock accounting (stations pay more for what they lack) lands in the
`stockFactor` slot; market depth can then also bound order fills. Bigger ships / hold
upgrades ride `ShipData.holdSize`.
