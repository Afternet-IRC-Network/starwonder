# StarWonder — Roadmap

Build order for getting something friends can actually play. Detail lives in the
[gameplay](gameplay-overview.md) and [technical](technical-infrastructure.md) docs.

## Phase 0 — Skeleton (prove the stack)
- [ ] Vue 3 + Vite + Tailwind app on Netlify; "hello galaxy" page.
- [ ] Supabase project; auth with invite codes (magic link).
- [ ] First Netlify Function reading/writing Supabase.
- [ ] Map generation script → 1000 stars + lanes + wormholes in the DB.
- [ ] Flat 2D map renders from DB data on a phone.

## Phase 1 — Playable core loop (the MVP)
- [ ] Energy model (server-side regen from timestamps).
- [ ] Move / wormhole-jump / scan actions (authoritative Functions).
- [ ] **Dock** as the single station verb; trade stations + dynamic pricing + buy/sell.
      (Planets are flavor/scenery only — no landing.)
- [ ] **Missions v1:** courier, procurement, bounty. Faction reputation (2 factions) →
      unlocks.
- [ ] One ship/module-upgrade path at a Haven; escape-pod + soft-loss (cargo drop,
      repair cost) on defeat.
- [ ] NPC traders & pirates moving on the tick.
- [ ] Basic PvE combat resolution.
- [ ] `events` table + client feed (polling is fine here).
- [ ] **IRC bot v1** (Nefarious2 connect→act→quit, or always-on on the VM): announce events
      + `!status` / `!leaderboard`.
- [ ] Invite ~3 friends, playtest pacing & balance.

## Phase 2 — Fast-follow
- [ ] Async PvP: fighters / mines as deployables.
- [ ] Outposts: capture / garrison existing stations.
- [ ] Escort & survey missions; ship insurance.
- [ ] Corps (alliances) sharing stations & territory.
- [ ] Realtime push to clients (vs. polling).
- [ ] IRC daily "Galactic News" digest; more `!` commands.
- [ ] Leaderboards.

## Phase 3 — Spicy / long-term
- [ ] From-scratch outpost building & upgrade tiers (the orbital "citadel").
- [ ] Faction story chains.
- [ ] Drone/automation layer (hire a drone for chores).
- [ ] Region victory conditions; drifting / collapsing wormholes.
- [ ] Seasonal galaxies (wipe & regenerate from a new seed).

## First three decisions to make (unblock everything else)
1. **Energy tuning** — smooth hourly vs. 4-hour feel (gameplay doc §3).
2. **Serverless vs. one always-on box** (technical doc §3 vs §10).
3. **IRC network + channel** for the bot.
