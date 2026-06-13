// Navigation plumbing shared by the move intent and the course intent: wormhole-edge
// keys, the live wormhole-cost curve, and hop-by-hop course validation. The server stays
// authoritative — the client proposes a path, this checks every hop against what the
// trader actually knows (open lanes + taken wormholes) and prices it.

import { wormholeCost, type WormholeCostOpts } from '@starwonder/game-core';
import { getConfig } from './config';
import type { World } from './galaxy';

export const whKey = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;

export function allWormholeKeys(g: World['galaxy']): Set<string> {
  return new Set(g.wormholes.map((w) => whKey(w.a, w.b)));
}

/** Live wormhole-cost curve from the config knobs (span → energy, soft-capped). */
export function whCostOpts(): WormholeCostOpts {
  return { perDist: getConfig('wormhole_cost_per_dist'), cap: getConfig('wormhole_cost_cap') };
}

export interface PlannedCourse {
  /** base energy cost of hop i (path[i] → path[i+1]) — condition modifiers fold in per beat */
  costs: number[];
  wormhole: boolean[];
}

/**
 * Validate a proposed course for a trader: every consecutive pair must be an open lane or
 * a wormhole this trader has already taken (no blind jumps on autopilot — the far end has
 * to be known to plot through it). Returns the per-hop pricing, or an error string.
 */
export function planCourse(
  world: World,
  taken: Set<string>,
  path: number[],
): PlannedCourse | { error: string } {
  const g = world.galaxy;
  const whEdges = allWormholeKeys(g);
  const costs: number[] = [];
  const wormhole: boolean[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (b < 0 || b >= g.dist.length || g.dist[b] < 0) return { error: 'course leaves known space' };
    const key = whKey(a, b);
    const isLane = g.adj[a]?.includes(b) && !whEdges.has(key);
    const isKnownWormhole = whEdges.has(key) && taken.has(key);
    if (isLane) {
      costs.push(getConfig('move_energy_cost'));
      wormhole.push(false);
    } else if (isKnownWormhole) {
      costs.push(wormholeCost(g, a, b, whCostOpts()));
      wormhole.push(true);
    } else {
      return { error: 'course includes an uncharted hop' };
    }
  }
  return { costs, wormhole };
}
