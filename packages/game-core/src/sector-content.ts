/**
 * Procedural sector content — planet and station properties derived purely from
 * (seed, sectorId). These are the algorithmic baselines; the server overlays any
 * sector_state DB overrides on top before sending to the client.
 */
import { unit } from './hash';
import { planetName, stationName } from './names';

// ── Planet ────────────────────────────────────────────────────────────────────

/** Visual palette for the pixel renderer (one per "look", not one per class). */
export type PlanetPalette = 'ocean' | 'lava' | 'ice' | 'arid' | 'rock' | 'gas';
export type Atmosphere    = 'none' | 'thin' | 'breathable' | 'thick' | 'toxic' | 'corrosive';

/** How a class's surface gravity is produced. */
type GravityModel = 'rocky' | 'terran' | readonly [number, number];
/** How a class's moon count is produced. */
type MoonsModel = 'rocky' | 'many';

interface ClassSpec {
  label: string;
  blurb: string;
  /** relative rarity — higher = more common (weights need not sum to anything) */
  weight: number;
  palette: PlanetPalette;
  /** size range in Earth radii */
  size: readonly [number, number];
  gravity: GravityModel;
  /** weighted atmosphere mix */
  atm: ReadonlyArray<readonly [Atmosphere, number]>;
  moons: MoonsModel;
  /** day-length range in hours */
  day: readonly [number, number];
}

/**
 * SINGLE SOURCE OF TRUTH for world classes. Add or remove a class by editing this
 * table alone — the `WorldClass` type, the rarity roll, the display info, and the
 * stat derivation all flow from it. `weight` sets rarity; the rest is the profile.
 *
 * World type is **spatially uniform**: a class is as likely at Sol's doorstep as on the
 * rim — only danger and habitation track distance. Current tuning is "lush & green"
 * (habitable worlds common, terran ≈ 1-in-7). See
 * docs/0-Projects/starwonder-mvp/world-generation.md.
 */
const CLASS_SPEC = {
  terran:      { label: 'Terran World', blurb: 'temperate · life-bearing',  weight: 14, palette: 'ocean', size: [0.8, 1.3],  gravity: 'terran',   atm: [['breathable', 70], ['thin', 15], ['thick', 15]],                 moons: 'rocky', day: [18, 34] },
  ocean:       { label: 'Ocean World',  blurb: 'world-spanning seas',       weight: 22, palette: 'ocean', size: [0.7, 1.8],  gravity: 'rocky',    atm: [['breathable', 45], ['thick', 30], ['toxic', 15], ['thin', 10]],  moons: 'rocky', day: [12, 48] },
  desert:      { label: 'Desert World', blurb: 'arid · sparse biosphere',   weight: 14, palette: 'arid',  size: [0.5, 1.4],  gravity: 'rocky',    atm: [['none', 25], ['thin', 35], ['toxic', 25], ['breathable', 15]],   moons: 'rocky', day: [12, 60] },
  ice:         { label: 'Ice World',    blurb: 'frozen wastes',             weight: 14, palette: 'ice',   size: [0.4, 1.6],  gravity: 'rocky',    atm: [['none', 30], ['thin', 35], ['breathable', 20], ['thick', 15]],   moons: 'rocky', day: [10, 72] },
  lava:        { label: 'Lava World',   blurb: 'molten · hostile surface',  weight: 12, palette: 'lava',  size: [0.5, 1.6],  gravity: 'rocky',    atm: [['toxic', 30], ['corrosive', 30], ['thin', 20], ['none', 20]],    moons: 'rocky', day: [8, 60] },
  barren:      { label: 'Barren World', blurb: 'airless rock',              weight: 12, palette: 'rock',  size: [0.3, 1.0],  gravity: 'rocky',    atm: [['none', 60], ['thin', 40]],                                      moons: 'rocky', day: [12, 72] },
  'gas-giant': { label: 'Gas Giant',    blurb: 'no solid surface',          weight: 12, palette: 'gas',   size: [3.5, 12.0], gravity: [1.3, 3.7], atm: [['thick', 100]],                                                  moons: 'many',  day: [8, 18] },
} as const satisfies Record<string, ClassSpec>;

export type WorldClass = keyof typeof CLASS_SPEC;

const CLASS_ORDER = Object.keys(CLASS_SPEC) as WorldClass[];

/** Display metadata for each world class (shared by game + admin UIs). */
export const WORLD_CLASS_INFO = Object.fromEntries(
  CLASS_ORDER.map((c) => [c, { label: CLASS_SPEC[c].label, blurb: CLASS_SPEC[c].blurb }]),
) as Record<WorldClass, { label: string; blurb: string }>;

/** [class, weight] table for the rarity roll (stable order ⇒ deterministic). */
const CLASS_ROLL: ReadonlyArray<readonly [WorldClass, number]> =
  CLASS_ORDER.map((c) => [c, CLASS_SPEC[c].weight] as const);

export interface PlanetData {
  /** proper name of the world — the system's identity (Earth at Sol) */
  name: string;
  /** headline classification — drives the rest of the stats */
  worldClass: WorldClass;
  palette: PlanetPalette;
  /** Earth radii, 1 dp */
  size: number;
  /** Surface gravity in g, 1 dp */
  gravity: number;
  atmosphere: Atmosphere;
  /** Local day length in hours */
  dayHours: number;
  moons: number;
  /** Initial longitude offset for the pixel renderer (0..2π) */
  spin: number;
}

/** Weighted pick from a [value, weight] table using a 0..1 roll. */
function weighted<T>(roll: number, table: ReadonlyArray<readonly [T, number]>): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = roll * total;
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[table.length - 1][0];
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function generatePlanet(
  seed: string,
  sectorId: number,
  rimT: number,
): PlanetData {
  // Sol is always Earth
  if (sectorId === 0) {
    return {
      name: 'Earth',
      worldClass: 'terran',
      palette: 'ocean',
      size: 1.0,
      gravity: 1.0,
      atmosphere: 'breathable',
      dayHours: 24,
      moons: 1,
      spin: 0.6,
    };
  }

  const k = `${seed}|planet|${sectorId}`;
  const r = (s: string) => unit(k + s);

  // 1. Roll the class — spatially uniform, no distance bias.
  const worldClass = weighted(r('|class'), CLASS_ROLL);
  const spec = CLASS_SPEC[worldClass];

  // 2. Size within the class's range.
  const [loSize, hiSize] = spec.size;
  const size = round1(loSize + r('|size') * (hiSize - loSize));

  // 3. Gravity per the class's model: terran ≈ 1 g, rocky derives from size, gas
  //    giants pin to a cloud-top range (radius doesn't scale gravity like rock).
  let gravity: number;
  if (spec.gravity === 'terran')     gravity = round1(size * (0.85 + r('|grav') * 0.25));
  else if (spec.gravity === 'rocky') gravity = round1(size * (0.6 + r('|grav') * 0.8));
  else gravity = round1(spec.gravity[0] + r('|grav') * (spec.gravity[1] - spec.gravity[0]));

  // 4. Atmosphere from the class mix.
  const atmosphere = weighted(r('|atm'), spec.atm);

  // 5. Day length within the class's range.
  const [loDay, hiDay] = spec.day;
  const dayHours = loDay + Math.round(r('|day') * (hiDay - loDay));

  // 6. Moons: gas giants keep big retinues; rocky worlds scale loosely with size.
  const moonRoll = r('|moons');
  let moons: number;
  if (spec.moons === 'many') moons = 1 + Math.floor(moonRoll * 4); // 1..4
  else if (size > 1.6)       moons = moonRoll < 0.22 ? 3 : moonRoll < 0.55 ? 2 : 1;
  else if (size > 0.9)       moons = moonRoll < 0.32 ? 0 : moonRoll < 0.68 ? 1 : 2;
  else                       moons = moonRoll < 0.58 ? 0 : 1;

  // Visual spin (radians). rimT feeds only the (distance-banded) name, never the type.
  const spin = r('|spin') * Math.PI * 2;

  return {
    name: planetName(seed, sectorId, rimT),
    worldClass,
    palette: spec.palette,
    size,
    gravity,
    atmosphere,
    dayHours,
    moons,
    spin,
  };
}

// ── Station ───────────────────────────────────────────────────────────────────

export type StationType = 'trade' | 'haven' | 'outpost';

export interface StationData {
  /** station name, tied to its host world ("Ceres Terminal") */
  name: string;
  stationType: StationType;
  /** Ellipse perspective tilt (0.3..0.75) */
  tilt: number;
  spokes: number;
  spokeW: number;
  hub: number;
  /** Rim ring width */
  rimWidth: number;
  /** CSS hue for the station colour */
  hue: number;
  sat: number;
}

export function generateStation(
  seed: string,
  sectorId: number,
  rimT: number,
): StationData {
  // Sol: home haven matching the mockup's default
  if (sectorId === 0) {
    return {
      name: 'Terra Station',
      stationType: 'haven',
      tilt: 0.58,
      spokes: 4,
      spokeW: 0.060,
      hub: 0.20,
      rimWidth: 0.16,
      hue: 208,
      sat: 0.15,
    };
  }

  const k = `${seed}|station|${sectorId}`;

  const tilt     = 0.32 + unit(k + '|tilt')   * 0.43; // 0.32..0.75
  const spokes   = 3 + Math.floor(unit(k + '|spokes') * 4); // 3..6
  const spokeW   = 0.040 + unit(k + '|spokew') * 0.055; // 0.040..0.095
  const hub      = 0.12  + unit(k + '|hub')    * 0.18;  // 0.12..0.30
  const rimWidth = 0.10  + unit(k + '|rim')    * 0.14;  // 0.10..0.24

  // Rim stations run warmer (copper/orange), core stations run cooler (teal/blue)
  const hueBase = rimT > 0.55
    ? 18  + unit(k + '|hue') * 44  // warm: 18..62
    : 178 + unit(k + '|hue') * 84; // cool: 178..262
  const hue = Math.round(hueBase);
  const sat = 0.10 + unit(k + '|sat') * 0.18; // 0.10..0.28

  const typeRoll = unit(k + '|type');
  const stationType: StationType =
    typeRoll < 0.60 ? 'trade' :
    typeRoll < 0.82 ? 'haven' : 'outpost';

  const name = stationName(seed, sectorId, rimT, stationType);

  return { name, stationType, tilt, spokes, spokeW, hub, rimWidth, hue, sat };
}

// ── Market ──────────────────────────────────────────────────────────────────
//
// Prices are a PURE function of (seed, sector, commodity): a core↔rim tech-complexity
// gradient × small deterministic seed noise × a stockFactor that is pinned to 1 for now.
// When dynamic stock lands it becomes a scarcity multiplier and the only new state is a
// sparse per-station override — the formula and call sites don't change. Full design:
// docs/0-Projects/3_trading.md.

export interface CommoditySpec {
  id: string;
  name: string;
  /** 0 = raw material … 1 = high-tech */
  complexity: number;
  basePrice: number;
}

/**
 * SINGLE SOURCE OF TRUTH for tradeable goods, ordered by complexity. Add a row (e.g. a
 * luxury tier higher on the axis, or a rare specialty good) and pricing follows — no
 * restructuring. Illustrative starter numbers; all tuning.
 */
export const COMMODITY_SPEC = [
  { id: 'minerals',    name: 'Minerals',            complexity: 0.10, basePrice: 10 },
  { id: 'metals',      name: 'Metals',              complexity: 0.20, basePrice: 16 },
  { id: 'food',        name: 'Food',                complexity: 0.30, basePrice: 12 },
  { id: 'livestock',   name: 'Livestock',           complexity: 0.40, basePrice: 26 },
  { id: 'textiles',    name: 'Clothing & textiles', complexity: 0.50, basePrice: 32 },
  { id: 'equipment',   name: 'Equipment',           complexity: 0.65, basePrice: 60 },
  { id: 'medical',     name: 'Medical supplies',    complexity: 0.80, basePrice: 85 },
  { id: 'electronics', name: 'Electronics',         complexity: 0.95, basePrice: 120 },
] as const satisfies readonly CommoditySpec[];

export type CommodityId = (typeof COMMODITY_SPEC)[number]['id'];

export interface MarketEntry {
  id: CommodityId;
  name: string;
  complexity: number;
  /** price the station charges the trader to buy */
  buy: number;
  /** price the station pays the trader to sell */
  sell: number;
}

export interface MarketOpts {
  /** core↔rim price tilt (config `gradient_strength`) */
  gradientStrength: number;
  /** buy/sell margin fraction (config `trade_spread`) */
  spread: number;
}

// The station's price field. Returns a commodity LIST (not a hardcoded 8) so a station's
// traded set can later carry seed-derived or override-injected specialty goods.
export function generateMarket(
  seed: string,
  sectorId: number,
  rimT: number,
  opts: MarketOpts,
): MarketEntry[] {
  const k = opts.gradientStrength;
  const spread = opts.spread;
  return COMMODITY_SPEC.map((c) => {
    const gradient = 1 + k * (2 * c.complexity - 1) * (2 * rimT - 1);
    const noise = 0.9 + unit(`${seed}|market|${sectorId}|${c.id}`) * 0.2; // ±10%
    const stockFactor = 1; // hook: dynamic stock lands here later
    const unitPrice = c.basePrice * gradient * noise * stockFactor;
    const buy = Math.max(1, Math.round(unitPrice * (1 + spread / 2)));
    const sell = Math.max(1, Math.round(unitPrice * (1 - spread / 2)));
    return { id: c.id, name: c.name, complexity: c.complexity, buy, sell };
  });
}
