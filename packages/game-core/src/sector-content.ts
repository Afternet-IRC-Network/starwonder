/**
 * Procedural sector content — planet and station properties derived purely from
 * (seed, sectorId). These are the algorithmic baselines; the server overlays any
 * sector_state DB overrides on top before sending to the client.
 */
import { unit } from './hash';

// ── Planet ────────────────────────────────────────────────────────────────────

export type PlanetPalette = 'ocean' | 'lava' | 'ice' | 'arid';
export type Atmosphere   = 'none' | 'thin' | 'breathable' | 'thick' | 'toxic' | 'corrosive';

export interface PlanetData {
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

export function generatePlanet(
  seed: string,
  sectorId: number,
  rimT: number,
): PlanetData {
  // Sol is always Earth
  if (sectorId === 0) {
    return {
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

  // Palette biased by position: core → ice/ocean; rim → lava/arid
  const palRoll = unit(k + '|pal');
  let palette: PlanetPalette;
  if (rimT < 0.33) {
    palette = palRoll < 0.45 ? 'ocean' : palRoll < 0.78 ? 'ice' : palRoll < 0.92 ? 'arid' : 'lava';
  } else if (rimT < 0.66) {
    palette = palRoll < 0.28 ? 'ocean' : palRoll < 0.52 ? 'arid' : palRoll < 0.74 ? 'lava' : 'ice';
  } else {
    palette = palRoll < 0.12 ? 'ocean' : palRoll < 0.40 ? 'arid' : palRoll < 0.76 ? 'lava' : 'ice';
  }

  // Size: 0.4..2.2 Earth radii
  const rawSize = 0.4 + unit(k + '|size') * 1.8;
  const size = Math.round(rawSize * 10) / 10;

  // Gravity correlated with size but with variation (density differs)
  const gravFactor = 0.55 + unit(k + '|grav') * 0.90;
  const gravity = Math.round(size * gravFactor * 10) / 10;

  // Atmosphere biased by planet type
  const atmRoll = unit(k + '|atm');
  let atmosphere: Atmosphere;
  if (palette === 'ocean') {
    atmosphere = atmRoll < 0.07 ? 'thin' : atmRoll < 0.62 ? 'breathable' : atmRoll < 0.88 ? 'thick' : 'toxic';
  } else if (palette === 'lava') {
    atmosphere = atmRoll < 0.20 ? 'thin' : atmRoll < 0.52 ? 'toxic' : atmRoll < 0.84 ? 'corrosive' : 'thick';
  } else if (palette === 'ice') {
    atmosphere = atmRoll < 0.28 ? 'none' : atmRoll < 0.62 ? 'thin' : atmRoll < 0.88 ? 'breathable' : 'thick';
  } else {
    // arid
    atmosphere = atmRoll < 0.20 ? 'none' : atmRoll < 0.52 ? 'thin' : atmRoll < 0.82 ? 'breathable' : 'toxic';
  }

  // Day length: 6..72 hours
  const dayHours = 6 + Math.round(unit(k + '|day') * 66);

  // Moons: larger worlds have more
  const moonRoll = unit(k + '|moons');
  let moons: number;
  if (size > 1.6)      moons = moonRoll < 0.22 ? 3 : moonRoll < 0.55 ? 2 : 1;
  else if (size > 0.9) moons = moonRoll < 0.32 ? 0 : moonRoll < 0.68 ? 1 : 2;
  else                 moons = moonRoll < 0.58 ? 0 : 1;

  // Visual spin (radians)
  const spin = unit(k + '|spin') * Math.PI * 2;

  return { palette, size, gravity, atmosphere, dayHours, moons, spin };
}

// ── Station ───────────────────────────────────────────────────────────────────

export type StationType = 'trade' | 'haven' | 'outpost';

export interface StationData {
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

  return { stationType, tilt, spokes, spokeW, hub, rimWidth, hue, sat };
}
