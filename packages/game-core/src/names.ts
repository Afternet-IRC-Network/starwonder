/**
 * Procedural naming — pure functions of (seed, sectorId), same doctrine as
 * generatePlanet/generateStation. We don't name stars or sectors (a sector is its
 * address; you never visit a sun) — the *planet* is a system's identity, and its
 * station is named after it.
 *
 * Names come from src/data/world-names.json: ~25k real, public-domain named minor
 * planets (JPL Small-Body DB), in catalog-number order so the famous, low-numbered
 * worlds (Ceres, Vesta, Psyche…) lead. We tier by rimT so well-known names cluster
 * near Sol and obscure ones sit on the frontier — reinforcing the danger gradient.
 * Regenerate with scripts/build-names.mjs.
 */
import { fnv } from './hash';
import WORLD_NAMES from './data/world-names.json';
import PLACE_NAMES from './data/place-names.json';
import SURNAMES from './data/surnames.json';
import FIRST_NAMES from './data/first-names.json';
import DESCRIPTIVES from './data/descriptives.json';

/** Deterministic pick from a slice [lo, hi) of a pool, keyed by string. */
function pickRange(pool: readonly string[], lo: number, hi: number, key: string): string {
  const span = Math.max(1, Math.min(hi, pool.length) - lo);
  return pool[lo + (fnv(key) % span)];
}

/** Deterministic flat pick across a whole pool (for pools with no fame ordering). */
function pick(pool: readonly string[], key: string): string {
  return pool[fnv(key) % pool.length];
}

/**
 * Fame-banded pick from a frequency-ranked pool: famous (low-index) names cluster
 * near Sol, obscure ones on the rim. Bands are fractions of the pool, so it works
 * for pools of any size (world ≈25k, surnames ≈89k, first names ≈5k).
 */
function pickFamed(pool: readonly string[], rimT: number, key: string): string {
  const n = pool.length;
  if (rimT < 0.33) return pickRange(pool, 0, Math.ceil(n * 0.12), key);
  if (rimT < 0.66) return pickRange(pool, Math.ceil(n * 0.12), Math.ceil(n * 0.4), key);
  return pickRange(pool, Math.ceil(n * 0.4), n, key);
}

/** [0,1) roll keyed by string (mirrors `unit`'s hashing). */
function roll(key: string): number {
  return (fnv(key) % 100000) / 100000;
}

// Pop-culture homages — sprinkled rarely as flavour on worlds & stations.
const EASTER_EGGS = [
  'Tatooine', 'Arrakis', 'Vulcan', 'Caprica', 'Kobol', 'Trantor', 'Terminus',
  'Magrathea', 'Mongo', 'Cybertron', 'Krypton', 'Gallifrey', 'Ryloth',
  'Coruscant', 'Dagobah', 'Hoth', 'Endor', 'Mustafar', 'Kashyyyk', 'Naboo',
  'Romulus', 'Risa', 'Bajor', 'Cardassia', 'Qonos', 'Pandora', 'Reach',
  'Sera', 'Tython', 'Thessia', 'Palaven', 'Tuchanka', 'Rannoch', 'Ix',
  'Caladan', 'Helghan', 'Sanghelios', 'Klendathu', 'Cantonica', 'Jakku',
  'Scarif', 'Yavin', 'Bespin', 'Geonosis', 'Felucia', 'Mandalore', 'Corellia',
  'Dantooine', 'Solaris', 'Helios', 'Eos', 'Aurelia', 'New Vegas',
] as const;

// rimT → window into the name pool. Bands are far larger than any galaxy's sector
// count, so collisions are negligible while fame still grades by distance from Sol.
function fameBand(rimT: number): [number, number] {
  const n = WORLD_NAMES.length;
  if (rimT < 0.33) return [0, Math.min(3000, n)];
  if (rimT < 0.66) return [Math.min(3000, n), Math.min(10000, n)];
  return [Math.min(10000, n), n];
}

/**
 * Proper name of a sector's world — the system's identity. Earth is special-cased
 * at Sol (#0). Pure function of (seed, sectorId, rimT).
 */
export function planetName(seed: string, sectorId: number, rimT: number): string {
  if (sectorId === 0) return 'Earth';
  const k = `${seed}|world|${sectorId}`;
  // Rare pop-culture homage (~2.5%).
  if (roll(k + '|egg') < 0.025) {
    return EASTER_EGGS[fnv(k + '|egg2') % EASTER_EGGS.length];
  }
  const [lo, hi] = fameBand(rimT);
  return pickRange(WORLD_NAMES, lo, hi, k);
}

// Station-type-flavoured mid-words (Foshay → Foshay Docks). Every name then gets a
// universal " Station" tail, so "Station" itself is intentionally *not* in any list.
const STATION_SUFFIX: Record<string, readonly string[]> = {
  trade: ['Exchange', 'Terminal', 'Market', 'Docks', 'Bazaar'],
  haven: ['Haven', 'Anchorage', 'Refuge', 'Port', 'Sanctuary'],
  outpost: ['Outpost', 'Watch', 'Relay', 'Beacon', 'Drift'],
};

/** English possessive: "Foshay" → "Foshay's", "James" → "James'". */
function possessive(name: string): string {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/**
 * Name of a sector's station. Stations have their own identity now, drawn from a
 * weighted grammar over four pools (places, surnames, first names, descriptives) plus
 * a station-type mid-word — only ~10% reuse the host world ("Ceres Terminal Station").
 * Every name gets a universal " Station" tail so even a bare descriptive reads right
 * ("Fayad Lagoon Station"). Surnames/first names fame-band by distance; places/
 * descriptives are flat. A rare "New " prefix (5%) and a standalone easter egg (~4%)
 * ride on top. Pure function of (seed, sectorId, rimT, type).
 */
export function stationName(
  seed: string,
  sectorId: number,
  rimT: number,
  stationType: string,
): string {
  const k = `${seed}|station-name|${sectorId}`;
  if (roll(k + '|egg') < 0.04) {
    return `${EASTER_EGGS[fnv(k + '|egg2') % EASTER_EGGS.length]} Station`;
  }

  const suffixes = STATION_SUFFIX[stationType] ?? STATION_SUFFIX.outpost;
  const suffix = () => suffixes[fnv(k + '|sfx') % suffixes.length];
  const surname = () => pickFamed(SURNAMES, rimT, k + '|sur');
  const first = () => pickFamed(FIRST_NAMES, rimT, k + '|first');
  const place = () => pick(PLACE_NAMES, k + '|place');
  const descr = () => pick(DESCRIPTIVES, k + '|descr');
  const world = () => planetName(seed, sectorId, rimT);

  // Weighted core grammar (cumulative thresholds; weights sum to 1).
  const r = roll(k + '|pat');
  let core: string;
  if (r < 0.10) core = `${world()} ${suffix()}`;          // 10% reuse host world
  else if (r < 0.34) core = `${surname()} ${suffix()}`;   // 24% Foshay Docks
  else if (r < 0.50) core = `${place()} ${suffix()}`;     // 16% Toledo Anchorage
  else if (r < 0.62) core = `${descr()} ${suffix()}`;     // 12% Garden Exchange
  else if (r < 0.77) core = `${place()} ${descr()}`;      // 15% Toledo Garden
  else if (r < 0.90) core = `${surname()} ${descr()}`;    // 13% Holloway Grove
  else core = `${possessive(first())} ${descr()}`;        // 10% Mabel's Landing

  // Rare "New " prefix, then the universal " Station" tail.
  if (roll(k + '|new') < 0.05) core = `New ${core}`;
  return `${core} Station`;
}
