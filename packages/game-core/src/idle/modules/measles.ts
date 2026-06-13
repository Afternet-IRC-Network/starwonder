// measles — the canonical CONDITION module: a rare dockside infection that halves energy
// regen and makes jumps cost +1 while it lasts. You recover by resting — docked or at
// anchor in your own bunk (ticks run during dock AND orbit settlement, never in transit);
// afterwards an inert immunity marker prevents a re-catch forever. Scruffier ports are
// worse for your health.

import type { IdleModule, PluginOutcome } from '../types';
import { hasCondition } from '../types';
import { vIndex, vline, vpick } from './util';

export const measles: IdleModule = {
  id: 'measles',
  events: [
    {
      id: 'measles-catch',
      eligible: (c) => !hasCondition(c, 'measles') && !hasCondition(c, 'measles-immune'),
      weight: (c) => 0.12 * (1.2 - c.station.prosperity),
      resolve: (c) => {
        const v = vIndex(c);
        return {
          deltas: [{ kind: 'condition', add: { id: 'measles' } }],
          fact: {
            plugin: 'measles',
            outcome: 'contracted',
            summary: vpick(v, [
              'came down with a nasty case of station measles',
              'caught station measles off a sneezing deckhand in the lift queue',
              'woke up spotty, feverish, and unmistakably measled',
            ]),
            numbers: { regen: '×0.5', jumpCost: '+1', v },
          },
        };
      },
    },
  ],
  conditions: [
    {
      id: 'measles',
      label: 'Station measles',
      blurb: 'Run down and spotty. Energy regenerates at half rate; every jump costs +1. Rest — docked or at anchor — to recover.',
      modifiers: () => ({ energyRegenFactor: 0.5, moveEnergyCostDelta: 1 }),
      tick: (cond, c) =>
        c.rng('recover') < 0.15
          ? {
              deltas: [
                { kind: 'condition', clear: 'measles' },
                { kind: 'condition', add: { id: 'measles-immune' } },
              ],
              fact: {
                plugin: 'measles',
                outcome: 'recovered',
                summary: vpick(vIndex(c), [
                  'finally shook off the station measles',
                  'woke up clear-eyed and spot-free at last',
                  'sweated out the last of the station measles overnight',
                ]),
                numbers: { v: vIndex(c) },
              },
            }
          : null,
    },
    {
      id: 'measles-immune',
      label: '',
      blurb: '',
      permanent: true,
      modifiers: () => ({}),
      tick: () => null,
    },
  ],
  line: (f) =>
    f.outcome === 'contracted'
      ? vline(f, [
          'You’ve come down with station measles (energy regen ×0.5, jumps +1 — rest up to recover).',
          'Spots, fever, the works: station measles (regen ×0.5, jumps +1 until you rest it off).',
          'The lift queue gave you station measles (regen ×0.5, jumps +1 — rest to recover).',
        ])
      : vline(f, [
          'You’ve shaken the measles. Immune now.',
          'Clear-eyed and spot-free — measles done, immune for good.',
          'The fever breaks for the last time. Immune now.',
        ]),
};
