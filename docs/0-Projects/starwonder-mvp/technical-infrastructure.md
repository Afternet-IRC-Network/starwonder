# StarWonder — Technical Infrastructure

How StarWonder is built, hosted, and kept (mostly) free. Companion to the
[Gameplay Overview](gameplay-overview.md).

---

## 1. Guiding constraints

- **Free or near-free** to host (your stated goal).
- **Ambient turn pacing** → almost no live server load; great fit for serverless.
- **Phone-first, visually simple** → light static frontend.
- **Invite-only** → simple auth, small user table (likely keyed on AfterNET accounts; §10).
- **Authoritative server** → all game state and rules live server-side; the client is a
  thin renderer (anti-cheat 101 for a game with PvP and economy).
- **IRC bot** → can be serverless on Nefarious2 (§7), *or* just ride an existing VM (§10) —
  no longer a forcing constraint.
- **Existing VMs available** → an always-on process is cheap for us, so "must be serverless"
  is a preference, not a requirement (§10).

---

## 2. The one hard truth up front: Netlify ≠ a backend for everything

Netlify is excellent for **(a)** hosting the static Vue app and **(b)** request/response
serverless functions. But two of our needs don't fit pure Netlify:

1. **A real database.** Netlify has no managed relational DB. (Netlify Blobs exists but is
   KV, not what you want for a relational game economy.)
2. **(Conditionally) a persistent connection for IRC.** A *vanilla* IRC bot must hold a
   long-lived socket to receive messages, which serverless can't do. **But our target
   network removes this** — see the box below — so this is not actually a hard constraint
   for us.

So the only unavoidable extra is a managed **Postgres (Supabase)**. If we run on a
Nefarious2 network, the whole thing can be **fully serverless** (Netlify + Supabase, no
always-on box at all). Details and cost in §9.

> ### ⚡ Nefarious2 changes the IRC calculus
> AfterNET runs **Nefarious2** (evilnet), which has a **built-in ZNC-like bouncer** for
> logged-in accounts, **IRCv3 history** (`CHATHISTORY`/playback), and **WebSocket**
> support. Together these mean the server holds our bot's channel presence and missed
> messages *between* connections — so a stateless function can **connect → pull history →
> act → quit** instead of staying online 24/7. This lets the IRC bot live in serverless
> functions too. See §7.

---

## 3. Recommended stack

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Vue 3 + Vite + Tailwind** (your pick — good pick) | Light, phone-friendly, great DX. |
| State | **Pinia** | Official, tiny, fits the thin-client model. |
| PWA | **vite-plugin-pwa** | "Add to home screen," feels app-like on phones. |
| Hosting (FE) | **Netlify** static hosting | Free, your stated preference, instant deploys. |
| API | **Netlify Functions** (or Supabase Edge Functions) | Serverless request/response for game actions. |
| DB + Auth + Realtime | **Supabase** (Postgres) | Free tier; gives us Postgres **and** auth **and** realtime subscriptions **and** row-level security in one box. |
| Scheduled tick | **Netlify Scheduled Functions** (cron) | Built-in cron for the world tick — no extra infra. |
| IRC bot | **Node.js + irc-framework, in a Netlify Function** (on a Nefarious2 net) | Connect→act→quit per the box in §2; no always-on box needed. Fall back to an always-on host only on a generic IRCd. |

> **Why Supabase is the quiet MVP of this stack:** it collapses four needs (DB, auth,
> realtime push to clients, and access control) into one free service, and its Postgres is
> reachable from Netlify Functions, the scheduled tick, *and* the IRC bot — one source of
> truth for everyone.

### Alternatives considered

- **Frontend framework:** Vue is great. (SvelteKit would be even lighter and has built-in
  server routes, but you already know/prefer Vue — stick with it.)
- **All-Netlify (Blobs as DB):** possible but you'd hand-roll relational logic over KV;
  not worth it. Use Postgres.
- **Fly.io for *everything* (incl. a tiny always-on game server):** simpler mental model
  (one always-on Node app does API + tick + IRC), but you lose Netlify's free static
  hosting/CDN polish and you're babysitting a server. Reasonable **plan B** if juggling
  three providers annoys you — see §10.

---

## 4. Architecture

```
                          ┌─────────────────────────┐
       phone / browser    │   Vue 3 + Tailwind PWA   │
       (thin client) ───► │   (static, on Netlify)   │
                          └───────────┬──────────────┘
                                      │ HTTPS (game actions)
                                      ▼
                          ┌─────────────────────────┐
                          │   Netlify Functions      │  ← validate + apply
                          │   (authoritative API)    │    rules, spend Energy
                          └───────────┬──────────────┘
                                      │ SQL
                                      ▼
        ┌──────────────────────────────────────────────────────┐
        │                    Supabase Postgres                   │  ◄── single
        │   players · stars · lanes · wormholes · ports ·        │     source of
        │   ships · planets · npcs · events · invites            │     truth
        └───────┬───────────────────────┬───────────────┬───────┘
                │ realtime               │ SQL           │ SQL + LISTEN
                ▼ (push)                 ▼               ▼
        ┌──────────────┐     ┌────────────────────┐   ┌────────────────────┐
        │  the client  │     │ Netlify Scheduled  │   │ IRC bot = Netlify  │
        │ (live updates)│    │ Function = "tick"  │   │ Function: connect→ │ ─► IRC
        └──────────────┘     │ NPCs/prices/spawns │   │ act→quit (§7)      │   channel
                             └────────────────────┘   └────────────────────┘
                                                       (Nefarious2 bouncer holds
                                                        presence between runs)
```

**Data flow in one line:** client asks → Function validates against the authoritative DB →
DB changes → Supabase realtime pushes the change back to clients, and the IRC bot (watching
the `events` table) narrates it to the channel.

---

## 5. Authoritative game logic

**Rule of the project: the client never decides game outcomes.** It renders state and sends
*intents* ("move to star X", "buy 50 organics"). A Netlify Function:

1. Authenticates the player (Supabase JWT).
2. Loads relevant state.
3. **Validates** the intent (adjacent star? enough Energy? port has stock?).
4. Applies the change in a **transaction** (debit Energy, move ship, adjust prices).
5. Writes an `events` row for anything noteworthy (feeds realtime + IRC).

Energy regen is computed **server-side from timestamps**, never trusted from the client:
store `energy` + `energy_updated_at`; on each action, `regen = min(cap, energy + hours_elapsed * rate)`. This means no cron is needed just for Energy — it's lazily computed on read/write. (The tick is only for *world* changes.)

### Sketch: a move action

```
POST /api/move  { toStarId }
  → auth player
  → regen energy from timestamps
  → assert lane(from, toStarId) exists  AND  energy >= cost(lane)
  → tx: energy -= cost; ship.star = toStarId; energy_updated_at = now
  → resolve arrival (minefield? NPC? toll?) and write events
  → return new state  (Supabase realtime also pushes it)
```

---

## 6. The world tick (cron)

A **Netlify Scheduled Function** runs the background simulation the players don't drive:

- **Light tick (~every 15 min):** move NPC ships one hop along their routes; drift port
  prices toward equilibrium; resolve any NPC encounters.
- **Heavy tick (hourly / daily):** accrue planet production; restock ports; spawn/despawn
  NPCs to target density; decay deployed fighters/mines slightly; emit the daily IRC digest.

Each tick is one transaction batch and writes `events` rows so the world's changes show up
in clients and on IRC. Keep ticks **idempotent and cheap** — with ~1000 stars and a handful
of NPCs this is trivial compute, well inside free limits.

> Netlify scheduled functions have a max runtime; if the tick ever grows heavy, split it
> (e.g. process NPCs in shards per region) or move the tick into the always-on Fly.io
> process (which also hosts the bot) — see §10.

---

## 7. IRC bot

**The old assumption (corrected):** a vanilla IRC bot needs a *persistent* socket to
receive messages, forcing an always-on process. On a **Nefarious2** network this is no
longer true — the built-in bouncer + IRCv3 history mean we can run the bot from
**stateless Netlify Functions** (see the box in §2). Two recommended shapes:

- **Outbound (announce) — purely event-driven, no always-on:**
  a Function triggered by new `events` (via a Supabase database webhook / trigger, or
  piggy-backed on the tick) **connects, authenticates (SASL), sends the message(s),
  and quits.** Verbosity filter + rate limiter prevent spam; batch the daily digest into a
  single connect.
- **Inbound (commands) — poll the bouncer, no always-on:**
  a scheduled Function (aligned with the tick, e.g. every 1–5 min) **connects, pulls
  channel history since the last run via `CHATHISTORY`, processes any `!commands`, replies,
  and quits.** Latency = poll interval, which is fine for a slow game. The bouncer preserves
  presence and the unread history between runs.

**Shared design (either shape):**

- **Lib:** **Node.js** + **`irc-framework`** (works fine for connect→act→quit; supports
  SASL and IRCv3). WebSocket transport is available if a raw TCP socket is awkward from the
  function runtime.
- **Auth/identity:** map IRC nicks/accounts to players via an opt-in `!link <code>` flow
  (code generated in the web UI). Privacy-gate anything sensitive.
- **Commands** (`!status`, `!leaderboard`, `!map`, `!bounties`, `!whereis`) are
  **read-only** for MVP — no game actions from IRC — to keep the security surface small.
- Holds only a scoped Supabase key; never trusts IRC input beyond read queries.
- **Be a good netizen:** don't reconnect-storm. A sane poll cadence and SASL-authed account
  keep this gentle on the network (especially relevant since it's *your* network).

**Generic-IRCd fallback:** on a network *without* a bouncer/history, revert to a small
always-on Node process (Fly.io free tier / a $0–5 VPS / a Pi) that stays connected. The bot
code is nearly identical; only the connection lifecycle differs.

---

## 8. Data model (first cut)

Postgres tables (Supabase). Names indicative; tune as you build.

```
invites        (code PK, created_by, used_by, used_at, expires_at)
players        (id PK, auth_uid, handle, credits, energy, energy_updated_at,
                energy_cap, energy_rate, ship_id, corp_id, created_at, last_seen)
ships          (id PK, owner_player_id, class, star_id, hull, shields,
                fighters, cargo_holds, cargo_jsonb, warp_level)
stars          (id PK, hilbert_index, grid_x, grid_y, region, sector,
                type, name)
lanes          (a_star_id, b_star_id)              -- local edges, undirected
wormholes      (id PK, a_star_id, b_star_id, oneway bool, stable bool)
ports          (id PK, star_id, class, fuel_buy/sell, org_buy/sell, equ_buy/sell,
                stock_jsonb, price_jsonb)
planets        (id PK, star_id, class, owner_player_id, owner_corp_id,
                production_jsonb, defenses_jsonb, citadel_level)
deployables    (id PK, star_id, owner_player_id, kind {fighter|mine}, qty)
npcs           (id PK, kind {trader|pirate}, ship_jsonb, star_id, route_jsonb, ai_state)
corps          (id PK, name, founder_player_id)
events         (id PK, ts, kind, actor, target, star_id, payload_jsonb,
                irc_announced bool, severity)     -- THE backbone of realtime + IRC
```

- **`events` is central:** every interesting state change writes one. Clients subscribe for
  live feed; the IRC bot subscribes to announce; it's also your audit log / debugging trail.
- **Row-Level Security (RLS):** Supabase RLS so the client can only read what a player
  should see (their ships, public star/port info, events involving them). Functions use a
  service role for authoritative writes.
- Index `stars(hilbert_index)`, `lanes(a_star_id)`, `ships(star_id)`, `events(ts)`.

---

## 9. Hosting & cost (the "free" plan)

| Service | Role | Free tier reality |
|---------|------|-------------------|
| **Netlify** | Static FE + Functions + scheduled tick | Free tier covers a small game easily (bandwidth + function invocations are tiny at this scale). |
| **Supabase** | Postgres + auth + realtime | Free project; note free Supabase projects **pause after ~1 week of inactivity** — fine if anyone plays weekly, and the tick/bot hitting the DB keeps it warm. |
| **IRC bot** | announce + commands | **$0** — runs inside Netlify Functions on a Nefarious2 net (§7); no separate host. (Fly.io only as a generic-IRCd fallback.) |
| **Domain** | optional | the only likely real cost (~$10–15/yr), or use the free `*.netlify.app` subdomain. |

**Net:** plausibly **$0/yr** (or ~$12 with a custom domain), and with the IRC bot serverless
the architecture is **two providers, not three**. The main watch-item is Supabase's
inactivity pause (the tick keeps the DB warm) — fine for a friends' game, cheap to upgrade
if it grows.

---

## 10. The "ride along on an existing VM" option (now arguably the primary)

We have our own VMs with spare capacity (AfterNET infra), so an always-on process is *not*
a burden — which flips the calculus. The simplest honest shape:

> **One small Node app on an existing VM** doing the API **+** the world tick **+** the IRC
> bot, with the Vue app still static on Netlify (or served by the same app). Postgres can be
> Supabase **or just run locally on the same VM.**

- **Pros:** one deploy, one log stream; the bot holds a **real persistent IRC connection**
  (no bouncer/`CHATHISTORY` poll dance — though that still works fine if you prefer it);
  the tick is a plain `setInterval`/cron; persistent in-memory caches; **no serverless cold
  starts**; and with local Postgres there's **no Supabase inactivity-pause** concern and
  **one fewer provider.**
- **Cons:** you own uptime & backups for that box; lose Supabase's free auth + realtime +
  RLS (but see auth below — AfterNET accounts may replace auth anyway, and the slow pacing
  makes polling a fine substitute for realtime).
- **Cost:** effectively $0 since it rides existing hardware.

**Revised recommendation:** given the VMs, **lead with this**. The serverless design (§3)
remains valid and is the right call if you ever want zero-maintenance / scale-to-zero, and
the game logic is identical either way (keep it in `packages/game-core` so the host is a
swappable detail).

### Auth via AfterNET accounts (worth considering)

Since players are IRC friends, **logging into the game with an AfterNET account (SASL /
account name)** is a natural fit and neatly solves identity + the invite-only requirement
(an invite = "I added you to the allowed-accounts list"). It also makes the IRC↔player
mapping automatic — no `!link` step. This could replace Supabase auth entirely.

### Idea: the game presence(s) in-channel

You floated spinning up a **per-user "you" presence** that joins the game channel and does
that player's announces. My honest take:

- For **routine** announces, a **single game bot** is simpler and less noisy than puppeting
  N user connections (which also scales as a connection-per-online-player).
- The flavorful middle ground: single bot for the channel feed, but it can address/`NOTICE`
  *you* personally for your own events ("⚔ your fighters at R7·S3 were attacked").
- Per-user presence is genuinely cool for an **embedded-chat / "the game is the channel"**
  feature (esp. with Nefarious2 WebSockets), but that's a Phase-3 indulgence, not MVP.

---

## 11. Map generation pipeline

A one-off (re-runnable) **seeded** script, run offline, that writes the galaxy into Postgres:

1. Seed a PRNG (store the seed with the galaxy).
2. Generate the **order-5 Hilbert curve** → 1024 `(x,y)` cells in curve order.
3. Pick ~1000 cells → `stars` (with region/sector from the nested blocks).
4. Add **lanes**: curve-adjacent + grid-adjacent star pairs.
5. Add **wormholes**: ~30–50 long-distance edges (distance-weighted, cross-region).
6. Assign **star types**, then place **ports / planets / starbases** by type with a
   guaranteed safe **home Haven**.
7. Seed initial **NPCs** and port stock/prices.
8. **Verify**: graph is fully connected; corner-to-corner hop count is reasonable *with*
   wormholes; safe zone exists.

Persist everything; the live game **reads** the map, never regenerates it. Keep the script
in the repo so you can spin up fresh "seasons" from new seeds. Full rationale:
[Fractal Galaxy Map](../../2-Resources/fractal-galaxy-map.md).

---

## 12. Realtime updates to the client

- Use **Supabase Realtime** to subscribe the client to (a) `events` relevant to the player
  and (b) changes to their ship / current star. So when the tick or another player changes
  the world, the open tab updates without polling.
- Fallback: simple polling on a timer if realtime is overkill for MVP. Given the slow
  pacing, even 30–60s polling is fine and dead simple — **start with polling, add realtime
  when it's worth it.**

---

## 13. Anti-cheat & integrity

- All outcomes server-side; client sends intents only (§5).
- Energy/regen computed from server timestamps; never accept client-reported energy.
- **Rate-limit** action endpoints (Energy cost is the main natural limiter, but also cap
  requests/sec to stop scripted hammering).
- RLS so a player can't read others' private state (cargo, exact location) beyond what the
  game intends to reveal.
- IRC commands are **read-only** and privacy-gated.
- Validate every economic transaction inside a DB transaction to prevent races
  (double-spend of credits/energy/cargo).

---

## 14. Dev & deploy workflow

- **Monorepo** (suggested): `apps/web` (Vue), `apps/bot` (IRC), `functions/` (Netlify),
  `packages/game-core` (shared rules/types used by functions, tick, and tests),
  `scripts/generate-map`.
- **Shared game-core package** so the rules live in *one* place and can be unit-tested in
  isolation (combat math, pricing, energy regen). This is the highest-leverage testing
  target.
- Netlify auto-deploys the web app + functions on push. The Fly.io bot deploys via
  `fly deploy`. Supabase migrations checked into the repo.
- **Local dev:** Supabase local (Docker) or a free dev project; Netlify Dev for functions;
  run the bot against a test IRC channel.

---

## 15. Open questions / risks

1. **Serverless vs. one-box (§3 vs §10)** — which posture do you want to start from?
2. **Supabase free-tier pause** — acceptable for a weekly-play friends game? (A tiny
   keep-alive ping or the regular tick mitigates it.)
3. **Netlify scheduled-function limits** — fine at this scale, but confirm the tick stays
   within runtime caps as features grow (else move tick to the bot box).
4. **Realtime now or polling first?** (Lean: polling for MVP.)
5. **IRC network** — AfterNET / Nefarious2 (assumed)? Confirm the bot's account, SASL
   creds, and channel. Which connection shape: event-driven announce + polled commands
   (§7), and what poll cadence?
6. **Auth model** — three candidates: (a) **AfterNET account / SASL** (best fit for an
   IRC-friends crowd, auto IRC↔player mapping, invite = allowed-account); (b) Supabase
   email magic-link; (c) OAuth. Leaning (a). This also decides whether Supabase is needed
   at all (see §10).
7. **Single game bot vs. per-user in-channel presence** (§10) — MVP is a single bot;
   per-user presence parked for a Phase-3 embedded-chat feature.
8. **Backups** — wherever Postgres lives (Supabase free or self-hosted on the VM), set up
   periodic dumps of the DB (especially `events`/galaxy + player state).
