// lay-low — the missing goal payoff. Keeping your head down already dodges the sweep
// (dockside-sweep gates on it); this module makes the quiet WORK: heat bleeds off faster
// while you deliberately stay invisible, and when the file finally goes cold the port
// forgets you were ever interesting. Fires docked or at anchor — hiding works anywhere.

import type { IdleEvent, IdleModule, PluginOutcome } from '../types';
import { vIndex, vline, vpick } from './util';

const layLowEvent = (id: string, context: 'dock' | 'orbit'): IdleEvent => ({
  id,
  context,
  eligible: (c) => c.goal?.kind === 'lay-low' && c.stats.heat > 0,
  weight: (c) => 1.5 + c.stats.heat * 0.3,
  resolve: (c): PluginOutcome => {
    const v = vIndex(c);
    if (c.stats.heat <= 2) {
      // the file goes cold — the payoff beat
      return {
        deltas: [{ kind: 'heat', d: -c.stats.heat }],
        fact: {
          plugin: 'lay-low',
          outcome: 'forgotten',
          summary: vpick(v, [
            'let the last of the heat bleed off — the port has forgotten the name',
            'watched a patrol walk past without a flicker of recognition',
            'heard their own description read out on the security band, and it fit nobody anymore',
          ]),
          numbers: { heat: -c.stats.heat, v },
        },
      };
    }
    return {
      deltas: [{ kind: 'heat', d: -2 }],
      fact: {
        plugin: 'lay-low',
        outcome: 'cooled',
        summary: vpick(v, [
          'kept to the bunk and the back tables while the heat bled off',
          'spent the watch as a face nobody could later describe',
          'stayed off every manifest and let the file gather dust',
          'paid cash, sat in corners, and let the port lose interest',
        ]),
        numbers: { heat: -2, v },
      },
    };
  },
});

export const layLow: IdleModule = {
  id: 'lay-low',
  events: [layLowEvent('lay-low', 'dock'), layLowEvent('lay-low-orbit', 'orbit')],
  line: (f) =>
    f.outcome === 'forgotten'
      ? vline(f, [
          'The file goes cold. As far as this port is concerned, you never happened (heat 0).',
          'A patrol looks straight through you. The port forgets (heat 0).',
          'Your description no longer fits anyone here (heat 0).',
        ])
      : vline(f, [
          'Head down, heat down (heat -2).',
          'Back tables and bunk time — the law cools on you (heat -2).',
          'No manifests, no questions, less heat (heat -2).',
          'Cash, corners, quiet (heat -2).',
        ]),
};
