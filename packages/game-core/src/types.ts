export interface GalaxySettings {
  seed: string;
  /** probability a sector is inhabited (a settled star system) vs empty deep space */
  inhabitedProb: number;
  /** base lane open probability */
  laneP: number;
  /** distance-from-Sol tilt on lane probability (denser core, frayed rim; mean ≈ laneP) */
  coreBias: number;
  /**
   * how much habitation thins toward the rim, 0..1. 0 = uniform everywhere;
   * 1 = the outermost sectors have ~0 chance of being settled. A gentle default keeps
   * the core a touch busier without depopulating the frontier. (Type is unaffected.)
   */
  habitationFalloff: number;
  /** number of long-range wormhole edges to attempt */
  wormholeCount: number;
}

export const DEFAULT_SETTINGS: Omit<GalaxySettings, 'seed'> = {
  inhabitedProb: 0.47,
  laneP: 0.44,
  coreBias: 0.89,
  habitationFalloff: 0.35,
  wormholeCount: 50,
};

export function withDefaults(seed: string, partial: Partial<GalaxySettings> = {}): GalaxySettings {
  return { seed, ...DEFAULT_SETTINGS, ...partial };
}
