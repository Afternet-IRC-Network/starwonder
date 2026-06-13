// pickpocket — the classic dockside tax. Cautious traders are harder marks; charming
// ones sometimes catch the hand and come out ahead on goodwill.

import type { IdleModule, PluginOutcome } from '../types';
import { roll, vIndex, vline, vpick } from './util';

export const pickpocket: IdleModule = {
  id: 'pickpocket',
  events: [
    {
      id: 'pickpocket',
      eligible: (c) => c.stats.credits > 0,
      weight: (c) =>
        (0.6 + c.station.tension) *
        (1 - c.station.lawfulness * 0.5) *
        (c.tags.includes('cautious') ? 0.5 : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.tags.includes('charming') && c.rng('foil') < 0.4) {
          return {
            deltas: [{ kind: 'standing', d: 1 }],
            fact: {
              plugin: 'pickpocket',
              outcome: 'foiled',
              summary: vpick(v, [
                'caught a cutpurse red-handed in the cantina crush, to dockside applause',
                'snatched a thieving hand mid-lift and held it up for the crowd',
                'turned a pickpocket around by the collar in front of half the promenade',
                'spotted the lift coming and made a show of returning the favour',
              ]),
              numbers: { standing: +1, v },
            },
          };
        }
        const loss = Math.min(roll(c, 'loss', 30, 120), c.stats.credits);
        return {
          deltas: [{ kind: 'credits', d: -loss }],
          fact: {
            plugin: 'pickpocket',
            outcome: 'picked',
            summary: vpick(v, [
              'got picked clean by a quick pair of hands in the promenade crowd',
              'lost a credit chit to a bump-and-lift outside the cantina',
              'paid the dockside tax to a pickpocket who was never there',
              'came up light after a crowded ride on the transit ring',
            ]),
            numbers: { credits: -loss, v },
          },
        };
      },
    },
  ],
  line: (f) =>
    f.outcome === 'foiled'
      ? vline(f, [
          'You catch a pickpocket mid-lift — the dock crowd approves (standing +1).',
          'A thieving hand finds your wrist waiting for it (standing +1).',
          'You march a cutpurse to the rail by the collar; the promenade cheers (standing +1).',
          'The lift was smooth; you were smoother (standing +1).',
        ])
      : vline(f, [
          `A pickpocket got you: ${f.numbers?.credits}cr.`,
          `Quick hands in the crowd — ${f.numbers?.credits}cr gone before you felt it.`,
          `Your credit chit is lighter by ${f.numbers?.credits}cr after the promenade crush.`,
          `The dockside tax collects itself: ${f.numbers?.credits}cr.`,
        ]),
};
