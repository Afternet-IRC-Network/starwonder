export interface GalaxySettings {
  seed: string;
  /** probability a sector is inhabited (a settled star system) vs empty deep space */
  inhabitedProb: number;
  /** base lane open probability */
  laneP: number;
  /** distance-from-Sol tilt on lane probability (denser core, frayed rim; mean ≈ laneP) */
  coreBias: number;
  /** number of long-range wormhole edges to attempt */
  wormholeCount: number;
}

export const DEFAULT_SETTINGS: Omit<GalaxySettings, 'seed'> = {
  inhabitedProb: 0.47,
  laneP: 0.44,
  coreBias: 0.89,
  wormholeCount: 50,
};

export function withDefaults(seed: string, partial: Partial<GalaxySettings> = {}): GalaxySettings {
  return { seed, ...DEFAULT_SETTINGS, ...partial };
}
