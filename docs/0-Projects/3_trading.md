# Item 3 — Trading & docking

> **Status:** planned. Companion to [todo.md](todo.md) #3. Builds on **#2** (active trader at a
> sector + the intent template) and **#0** (config knobs). Supersedes the original brainstorm in
> [trading.md](trading.md). Market research, route dealers, and remote-price visibility were moved
> to **#5**; ship-hold upgrades to **#7**.

## Scope

- **In:** dock the station in your **current** sector → a marketplace; buy / sell ~8 commodities
  against a per-station price field; cargo-limited; via a `POST /api/trade` intent that reuses #2's
  pipeline. Pricing is a **pure function** (gradient + seed noise) with **no mutable stock yet** —
  but the price model is shaped so dynamic stock drops in cleanly later.
- **Out (hooked, not built):** dynamic stock accounting / prices that move as you trade and
  mean-revert over time → the next layer (below). Market research, route dealers, remote-station
  prices → **#5**. Bigger holds / better ships → **#7**. Per-station **rare specialty goods** →
  data hook left in place, content later.

## The economy maps onto the architecture

Your `trading.md` design splits exactly along the existing grain:

- **Tech-complexity gradient** (core cheap for high-tech, rim cheap for raw) + the **seed noise
  field** are **pure functions of `(seed, sector, commodity)`** — "computed, never stored," the same
  family as `generatePlanet` / `generateStation`. Every station's baseline prices fall out of `rimT`
  + seed; no rows.
- **Station stock** (the "pay more for what they lack, sell cheap what they're glutted on"
  accounting) is the *only* mutable piece, and when it lands it's a **sparse override that
  mean-reverts over time** — the same lazy `{value, updatedAt}` trick `energy` already uses. Not in
  this first cut; see the hook below.

## Commodities — single source of truth

A `COMMODITY_SPEC` table in `game-core`, in the `CLASS_SPEC` idiom: one table drives everything.

```
{ id, name, complexity /* 0 raw … 1 high-tech */, basePrice }
```

Starter set of **8** (the basic tier of your categories), ordered by complexity — illustrative
numbers, all tuning:

| id | name | complexity | basePrice |
|---|---|---|---|
| `minerals` | Minerals | 0.10 | 10 |
| `metals` | Metals | 0.20 | 16 |
| `food` | Food | 0.30 | 12 |
| `livestock` | Livestock | 0.40 | 26 |
| `textiles` | Clothing & textiles | 0.50 | 32 |
| `equipment` | Equipment | 0.65 | 60 |
| `medical` | Medical supplies | 0.80 | 85 |
| `electronics` | Electronics | 0.95 | 120 |

The "luxury / expensive version of a thing" pairs are just **more rows** higher on the complexity
axis (e.g. `luxury_food`, `hitech_electronics`) — added later, no restructuring.

## Pricing — pure function of `(seed, sector, commodity)`

A `generateMarket(seed, sectorId, rimT)` in `sector-content.ts` returns per-commodity
`{ buy, sell }`:

```
unit  = basePrice
      × gradient(complexity, rimT)      // 1 + k·(2·complexity − 1)·(2·rimT − 1)
      × noise(seed, sector, commodity)  // small deterministic ±~10%
      × stockFactor                     // == 1 for now (the hook)
buy   = unit · (1 + spread/2)           // what the station charges you
sell  = unit · (1 − spread/2)           // what it pays you
```

- **Gradient** is the whole core↔rim loop in one line: high-complexity goods are cheap in the core
  and dear on the rim; raw goods the reverse. `k` is a single strength knob.
- **`stockFactor` is written into the formula now, pinned to `1`.** When stock lands, it becomes a
  scarcity multiplier (low stock → higher price, high stock → lower), and the *only* new state is
  per-station stock deltas with `updatedAt` mean-reversion. The formula and call sites don't change.

## Specialty-goods hook

All stations trade the standard 8, but the market generator returns a **commodity list**, not a
hardcoded 8 — so a station's traded set can later be the standard list **±** seed-derived or
override-injected extras (rare specialty items, or a station that doesn't stock everything). For
this cut every station trades exactly the 8; the shape just leaves the door open.

## Ship cargo

The trader's `ship` blob (currently empty) gets a minimal shape:

```
ship = { holdSize: number, cargo: Record<commodityId, qty> }
```

`holdSize` defaults from config (~20 tons). **Buy** needs credits ≥ cost *and* free hold space;
**sell** needs the goods in `cargo`. Growing `holdSize` / buying a bigger ship is **#7**.

## The trade intent (reuses #2's pipeline)

`POST /api/trade { action: 'buy' | 'sell', commodity, qty }` → authenticate → load active trader →
**validate**: trader is in a sector that has a station; the station trades `commodity`; for *buy*,
`credits ≥ cost` and hold has room; for *sell*, `cargo[commodity] ≥ qty` → **one
`better-sqlite3` transaction**: adjust `credits` and `cargo` (and, later, station stock) →
**return** `{ trader: { credits, ship }, market: <the station's current prices> }`. Errors:
not docked / no station (409), can't afford (402), hold full (409), don't have the goods (400).

## Docking & UI

- The **"In orbit"** station card in `OrbitPanel` becomes the dock entry point → opens the `#dock`
  tab (today a stub) for the **current** sector's station.
- The `#dock` marketplace: station name + type header, the trader's credits + hold usage, and a row
  per commodity (name, buy price, sell price, qty held) with buy/sell quantity controls.
- Prices are shown **only for the docked station** — remembering or scouting remote prices is
  **market research (#5)**.
- Trading is only possible at the current sector's station (server-validated).

## Config knobs (registered in #0)

| key | type | default | notes |
|---|---|---|---|
| `gradient_strength` | float | `0.5` | `k` — core↔rim price tilt |
| `trade_spread` | float | `0.10` | buy/sell margin |
| `default_hold_size` | int | `20` | starting cargo tons |

## Seed-exposure note

Like wormholes, pure pricing is client-computable from the public seed — so until the seed lockdown
(**#4**), a savvy client could compute every station's prices. That's also *why* market research
(#5) only becomes a real product once either the seed is locked **or** dynamic stock (the next
layer) makes current prices genuinely unpredictable. Honor-system is fine until then (friends game).

## Migration / out of scope

- `COMMODITY_SPEC` + `generateMarket` are pure additions to `game-core`; the only schema touch is
  the `ship` blob shape (no migration — pre-launch).
- Dynamic stock + mean-reversion → next layer. Market research / route dealers / remote prices →
  **#5**. Hold upgrades → **#7**. Seed lockdown → **#4**.

## Open questions

- Does **selling** to a station have any floor/sanity cap before stock exists (so you can't dump
  infinite cargo for infinite credits at a fixed price)? Without stock, the spread + cargo limit are
  the only brakes — likely fine for a first cut, but worth watching in balancing.
- Confirm the starter 8 and rough `basePrice` ordering, or tweak before implementing.
