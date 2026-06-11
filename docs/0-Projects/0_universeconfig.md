# Item 0 — Universe config (`world` + `config` split)

> **Status:** done. Companion to [todo.md](todo.md) #0. Done before
> [#1 split user from trader](1_usertrader.md): the `config` table is where the admin-tunable
> trader cap lives, and the `universeId` cleanup was far easier before the `traders` table arrived.
> The registry now also holds the movement (#2) and trading (#3) knobs.

## Why

We've decided there is **exactly one galaxy** — no multi-universe, no seasonal wipes (for now).
That makes the current `universes` table the wrong shape:

- It's plural (`id` autoincrement, `status` = `'active'`) — it models a multiplicity we don't have.
- We have nowhere clean to put **admin-tunable, server-side settings**. The first one we need is
  the per-user **trader cap** (from #1), and there will be more later (e.g. energy pacing).

## The core distinction: frozen world vs. live knobs

There are two kinds of "universe config" hiding in here, with **different lifecycles**, and the
whole design follows from keeping them apart:

1. **World definition** — `seed` + the Big Bang generation params (`inhabitedProb`, `laneP`,
   `coreBias`, `habitationFalloff`, `wormholeCount`). **Immutable after creation.** The galaxy is
   a *pure function* of these, computed once and cached in-process; every `sector_state` /
   `stations` override row is keyed to that exact galaxy. Editing one of these live would silently
   desync the cached galaxy from the stored overrides. Changing the world = **wipe & regenerate**,
   which is exactly what Clear → re-Big-Bang already is.

2. **Operational knobs** — `trader_cap` now, energy tuning later. **Freely editable anytime**, no
   regeneration. This is the stuff that wants a live admin settings screen.

Modelling each according to its lifecycle is the elegant fit, and it's why this is two tables
rather than one undifferentiated key/value bag (which would hand the admin a footgun: edit
`coreBias`, brick the universe).

## Schema changes

**Drop** `universes`.

**New `world`** — the frozen world definition, a singleton row:

| column | type | notes |
|---|---|---|
| `id` | int PK, `CHECK (id = 1)` | enforces exactly one row |
| `seed` | text | |
| `settings` | json | the `bigBangInput` shape (zod-validated on write) |
| `createdAt` | int | |

Written once by Big Bang (`INSERT OR REPLACE` at `id = 1`), read by galaxy generation, deleted by
Clear. Treated as immutable while it exists. (Drops the meaningless `status` column.)

**New `config`** — live operational knobs, key/value:

| column | type | notes |
|---|---|---|
| `key` | text PK | |
| `value` | text | coerced per-key by a typed accessor (see below) |

Values are stored as text but **not used stringly** — a small typed config accessor coerces +
validates per known key (e.g. `trader_cap → z.coerce.number().int().min(0)`), so call sites get
real types and bad values fail loudly. Seeded with `trader_cap` on first boot.

**Drop `universeId`:**
- `sector_state`: primary key `(universeId, sectorId)` → `(sectorId)`; drop the column.
- `stations`: drop the `universeId` column.

(The `stations.ownerPlayerId` → `ownerTraderId` rename is **#1's** job, not this item's.)

## Server changes

- `apps/server/src/galaxy.ts` — `getActiveUniverse()` reads the `world` row (rename to
  `getWorld()` to drop the "active/plural" connotation); the in-process cache keys off that single
  row. "Universe exists" = a `world` row is present.
- `apps/server/src/routes/admin.ts` — `big-bang` writes `world` (not `universes`); `clear` deletes
  `world` + the override rows (see open question on `config`).
- `apps/server/src/routes/game.ts` — `/api/universe` returns `world.settings`; sector reads drop
  the `universeId` filter.
- **New admin endpoints** — `GET /api/admin/config` + `PUT /api/admin/config` to view/edit the
  knobs. Admin-gated.
- `MeResponse.universeExists` derives from `world` presence (unchanged behaviour, new source).

## Admin UI

A small **"Server settings"** panel in the admin area to view/edit `config` (just `trader_cap`
for now). The Big Bang generation params stay in the **Big Bang wizard** (the frozen world
definition) and are deliberately **not** exposed in the live settings panel — that separation is
the whole point of the two tables.

## Config keys — the registry (single source of truth)

All valid keys are pre-declared in a `CONFIG_SPEC` array (`apps/server/src/config.ts`) with their
metadata (type, default, description). Access is gated through a typed lookup: a key with no DB row
resolves to its default, `setConfig` upserts a row to override, and values are coerced per-key so
call sites get a real number. Adding a knob = editing that one table.

| key | type | default | notes |
|---|---|---|---|
| `trader_cap` | int | `5` | max traders per user — enforced in #1 |
| `move_energy_cost` | int | `1` | energy per lane jump (#2) |
| `wormhole_cost_per_dist` | float | `1.0` | wormhole energy per unit crow-flies span — the un-compressed short-jump rate (#2) |
| `wormhole_cost_cap` | int | `20` | wormhole energy soft cap — the ceiling a long jump asymptotes toward (#2) |
| `gradient_strength` | float | `0.5` | core↔rim price tilt `k` (#3) |
| `trade_spread` | float | `0.10` | buy/sell margin (#3) |
| `default_hold_size` | int | `20` | starting cargo hold size, tons (#3) |

A wormhole's cost is `cap · tanh(perDist · d / cap)` over its span `d` — ~linear for a short
jump (so it isn't unduly discounted), softening to `cap` for a long one (so it never balloons),
and always ≤ walking the distance. (Future: energy-pacing knobs, per the roadmap's open tuning
question.) Edited live from the admin **Settings** tab (`ConfigPanel.vue`); the public
`/api/universe` exposes only the flat lane cost — the per-span wormhole cost rides each exit/edge
instead, never the whole knob set.

## Migration

Nuke the dev DB. Bootstrap (`db/migrate.ts`, `CREATE TABLE IF NOT EXISTS`) creates `world` and
`config`, and seeds the default config keys on first boot.

## Out of scope (lands in other items)

- The `traders` table, `trader_cap` **enforcement**, and `ownerPlayerId → ownerTraderId` → **#1**.

## Resolved

- **Does Clear wipe `config`?** No — Clear (and Big Bang) reset the *galaxy* (`world` + overrides +
  per-trader knowledge) but deliberately preserve `config`; operational knobs are an operator
  preference that persists across regenerations.
- Default `trader_cap` = **5**.
