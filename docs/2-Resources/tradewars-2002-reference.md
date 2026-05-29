# TradeWars 2002 — mechanics worth stealing

Notes on the 1990s BBS classic, filtered for what fits a slow, web, mobile, social game.

## The core that made it addictive

- **Sectors connected by warps.** A finite, explorable universe you slowly map. Our
  fractal map + wormholes is the modern version of this.
- **Port trading (the money loop).** Each port buys some commodities and sells others.
  Ports are classed by what they Buy/Sell across **Fuel Ore, Organics, Equipment**
  (the classic "BBS/SSB/..." port class codes are just the 8 buy/sell combinations).
  You haul goods between complementary ports for profit; **"port pair" trade routes** are
  the bread and butter.
- **Haggling.** Prices move with stock; buy low/sell high, and the same port pays less
  each cycle as you drain it (forces you to roam).
- **Turns as the scarce resource.** Everything (moving, trading, fighting) costs turns,
  and you get a fixed allotment per day. This is *exactly* the pacing knob we want — see
  the energy/turn model in the gameplay doc.
- **Ship upgrades.** Holds, fighters, shields, warp drive. A clear power-progression
  treadmill.
- **Fighters & mines as territory.** Drop fighters in a sector to toll/attack passers-by;
  this is emergent, asynchronous PvP that works great when players aren't online together.
- **Ferrengi (NPCs).** Roaming NPC traders/pirates that give the universe life and danger
  even when few humans are online — critical for a small friends-only player base.
- **StarDock / Class-0 ports.** Safe hub(s) to buy ships and gear.
- **Planets.** Citadels, production, the late-game power base; capturable.
- **Corporations.** Player alliances sharing assets and territory.

## What to deliberately *not* copy

- **Brutal new-player ganking.** TW2002 could be merciless. With a friends list this is
  social suicide; lean on safe zones, ship-loss insurance, or "escape pod" mechanics.
- **Twitch/real-time pressure.** We *want* asynchronous, check-in-between-meetings play.
- **Opaque math & manual route memorization.** The web UI can show trade route hints,
  expected profit, and a real map. Keep the discovery; drop the spreadsheet homework.
- **Permadeath of your whole account.** Setback, not deletion.

## The one-line takeaway

> TradeWars' genius was a **finite universe + scarce turns + a buy-low/sell-high loop +
> NPCs that keep it dangerous**, all playable a little at a time. Keep that skeleton;
> modernize the skin, the map, and the on-ramp.
