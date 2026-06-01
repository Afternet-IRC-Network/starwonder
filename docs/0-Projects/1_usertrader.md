# Item 1 — Split user from trader

> **Status:** done. Companion to [todo.md](todo.md) #1. Built on **#0** (the `config` table
> holds the trader cap). Everything after it (movement #2, trading #3, fog #4) writes straight
> to the final `traders` model, so there was no migration debt to pay later.

## Why

The old `players` table fused two different things: an **account** (login / password) and an
in-game **character**. Splitting them lets one account run several traders in the single galaxy,
and gives every later feature (movement, cargo, fog) a stable per-trader home. Doing it first —
while the table was still nearly empty — was the cheap moment.

## The model

- **`users`** — the account. `username` (unique), `passwordHash`, `authProvider` / `externalId`
  (OAuth seam), `isAdmin`, `createdAt`. The **first account created becomes the admin**
  (`isAdmin = true` when the user count is 0) — that replaces the old `player.id === 1` check.
- **`traders`** — a playable character. `userId` FK, `name` (globally unique), `credits`,
  `energy` + `energyUpdatedAt` (the lazy-regen pair, now per-trader), `currentSector`, `ship`
  (the cargo blob from #3), `createdAt`. **No `universeId`** — there's one world (#0).
- **1 user : N traders**, all in the same galaxy. No alt-abuse guardrails beyond the cap — it's a
  friends game, so that's a social problem, not a systems one.

## Session & identity

The JWT cookie carries `{ uid, activeTraderId }` (was `{ pid }`). `activeTraderId` can be null
(fresh account, or admin with no trader). Selecting a trader **re-signs the cookie** — the session
is the source of truth for "who am I playing," so it's stateless and a second device can play a
different pilot. `meFor` became **`buildMe`** returning the reshaped `me`:

```ts
{ user: { id, username, isAdmin },
  traders: TraderSummary[],          // for the picker
  activeTrader: ActiveTrader | null, // full state for the HUD (energy settled here)
  universeExists }
```

## Endpoints

- `POST /api/auth/register` — creates a `user`; first one is admin; no trader yet → client lands
  on the pilot screen.
- `POST /api/auth/login` — auto-selects the trader when there's exactly **one**, else leaves
  `activeTraderId` null so the client shows the picker.
- `POST /api/traders` — create a trader (gated by `trader_cap` from #0's config; name unique;
  requires a world to exist). Spawns at Sol with 1000 cr, full energy, a default ship, and a
  `trader_visited` row for sector 0. **Auto-selects** the new trader.
- `POST /api/traders/:id/select` — switch active pilot (ownership-checked, re-signs the cookie).

## Client

A single **pilot screen** (`PilotScreen.vue`) shown whenever a universe exists but no trader is
active: lists the user's traders (tap to select) and a "new pilot" form. After register you land
here to create your first; after login with one trader you skip straight into the game. The game
HUD reads everything from `me.activeTrader`; admin gating reads `me.user.isAdmin`.

## Knock-on renames

- `stations.ownerPlayerId` → `ownerTraderId`.
- `getActiveUniverse()` → `getWorld()` (from #0); admin gating now `users.isAdmin`, resolved via
  a `requireAdmin` helper instead of a magic id.

## Out of scope

- Per-trader knowledge tables (`trader_visited` / `trader_wormholes`) are defined and seeded here
  but consumed by **#2 / #4**.
- Renaming / deleting traders, account settings, OAuth — later.
