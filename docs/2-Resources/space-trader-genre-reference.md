# Classic BBS space-trader genre — mechanics worth borrowing

Notes on the late-'80s/'90s BBS space-trading genre, filtered for what fits a slow, web,
mobile, social game. (We're borrowing *genre conventions*, not any one product's names,
art, or content — all our terminology and assets are our own.)

## The core that made the genre addictive

- **Sectors connected by warps.** A finite, explorable universe you slowly map. Our
  fractal map + wormholes is the modern version of this.
- **Port trading (the money loop).** Each port buys some commodities and sells others.
  Ports are classed by what they Buy/Sell across **Fuel Ore, Organics, Equipment**
  (the buy/sell combinations across three goods give a handful of port classes).
  You haul goods between complementary ports for profit; **"port pair" trade routes** are
  the bread and butter.
- **Haggling / dynamic prices.** Prices move with stock; buy low/sell high, and the same
  port pays less each cycle as you drain it (forces you to roam).
- **Turns as the scarce resource.** Everything (moving, trading, fighting) costs turns,
  and you get a fixed allotment per day. This is *exactly* the pacing knob we want — see
  the Energy model in the gameplay doc.
- **Ship upgrades.** Holds, fighters, shields, warp drive. A clear power-progression
  treadmill.
- **Fighters & mines as territory.** Drop fighters in a sector to toll/attack passers-by;
  this is emergent, asynchronous PvP that works great when players aren't online together.
- **Roaming NPCs.** Computer-controlled traders/pirates that give the universe life and
  danger even when few humans are online — critical for a small friends-only player base.
- **Safe mega-hubs.** A safe station to buy ships and gear (our **Havens**).
- **Planets / bases.** Production and the late-game power base; capturable. (We trim this:
  see below.)
- **Player alliances** sharing assets and territory.

## What to deliberately *not* copy

- **Brutal new-player ganking.** The genre could be merciless. With a friends list this is
  social suicide; lean on safe zones, ship-loss insurance, and "escape pod" mechanics.
- **Twitch/real-time pressure.** We *want* asynchronous, check-in-between-meetings play.
- **Opaque math & manual route memorization.** The web UI can show trade route hints,
  expected profit, and a real map. Keep the discovery; drop the spreadsheet homework.
- **Permadeath of your whole account.** Setback, not deletion.
- **Landing on planets.** We collapse ports/bases/planets into a single concept — the
  orbital **station** you *dock* at. Planets are scenery/flavor only.

## The one-line takeaway

> The genre's genius was a **finite universe + scarce turns + a buy-low/sell-high loop +
> NPCs that keep it dangerous**, all playable a little at a time. Keep that skeleton;
> modernize the skin, the map, and the on-ramp — with our own names and art throughout.
