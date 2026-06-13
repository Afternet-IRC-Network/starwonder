// bar-brawl — tense ports throw punches. Charming traders defuse it; reckless ones wade
// in (and occasionally win the pot); everyone else picks up bruised ribs — a short-lived
// 'injured' condition — and a bar tab.

import type { IdleModule, PluginOutcome } from '../types';
import { roll, vIndex, vline, vpick } from './util';

export const barBrawl: IdleModule = {
  id: 'bar-brawl',
  events: [
    {
      id: 'bar-brawl',
      eligible: (c) => c.station.tension > 0.5,
      weight: (c) => (0.4 + c.station.tension * 0.8) * (c.tags.includes('reckless') ? 2 : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.tags.includes('charming') && c.rng('duck') < 0.5) {
          return {
            deltas: [{ kind: 'standing', d: 1 }],
            fact: {
              plugin: 'bar-brawl',
              outcome: 'defused',
              summary: vpick(v, [
                'talked a bar brawl down before the first bottle flew',
                'turned a squaring-off into a round of drinks on the house',
                'got two dock crews laughing at each other instead of swinging',
              ]),
              numbers: { standing: +1, v },
            },
          };
        }
        if (c.tags.includes('reckless') && c.tags.includes('lucky') && c.rng('win') < 0.5) {
          const pot = roll(c, 'pot', 40, 120);
          return {
            deltas: [
              { kind: 'credits', d: pot },
              { kind: 'standing', d: -1 },
            ],
            fact: {
              plugin: 'bar-brawl',
              outcome: 'won',
              summary: vpick(v, [
                'came out on top of a bar brawl and collected the pot riding on it',
                'ended a bar fight standing up, holding the side bets',
                'won a cantina brawl and the book that was running on it',
              ]),
              numbers: { credits: pot, standing: -1, v },
            },
          };
        }
        const tab = Math.min(roll(c, 'tab', 30, 80), c.stats.credits);
        return {
          deltas: [
            { kind: 'credits', d: -tab },
            { kind: 'standing', d: -1 },
            { kind: 'condition', add: { id: 'injured' } },
          ],
          fact: {
            plugin: 'bar-brawl',
            outcome: 'bruised',
            summary: vpick(v, [
              'came out of a bar brawl with bruised ribs and the bar tab',
              'caught a chair edge-on in a cantina brawl and got handed the bill',
              'was on the losing side of a dockside punch-up, ribs and wallet both',
            ]),
            numbers: { credits: -tab, standing: -1, v },
          },
        };
      },
    },
  ],
  conditions: [
    {
      id: 'injured',
      label: 'Bruised ribs',
      blurb: 'Everything aches. Jumps cost +1 until you heal up — rest at a dock.',
      modifiers: () => ({ moveEnergyCostDelta: 1 }),
      tick: (cond, c) =>
        c.rng('heal') < 0.3
          ? {
              deltas: [{ kind: 'condition', clear: 'injured' }],
              fact: {
                plugin: 'bar-brawl',
                outcome: 'healed',
                summary: vpick(vIndex(c), [
                  'walked off the last of the bruises',
                  'breathed deep for the first time in days — ribs mended',
                  'stopped wincing on the ladder; the ribs have knit',
                ]),
                numbers: { v: vIndex(c) },
                newsworthy: false,
              },
            }
          : null,
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'defused':
        return vline(f, [
          'You talk a brawl down before it starts (standing +1).',
          'Two crews ready to swing; you buy the joke that stops it (standing +1).',
          'No bottles fly tonight — your doing (standing +1).',
        ]);
      case 'won':
        return vline(f, [
          `You win a bar brawl and the pot: +${f.numbers?.credits}cr (standing -1).`,
          `Last one standing — the side bets pay +${f.numbers?.credits}cr (standing -1).`,
          `The cantina book pays out to you: +${f.numbers?.credits}cr (standing -1).`,
        ]);
      case 'healed':
        return vline(f, [
          'Your ribs finally stop aching.',
          'Deep breath, no wince — healed up.',
          'The bruises fade to a story.',
        ]);
      default:
        return vline(f, [
          `A bar brawl leaves you with bruised ribs and the tab: ${f.numbers?.credits}cr (jumps +1 until healed).`,
          `Chair, ribs, bill: ${f.numbers?.credits}cr and a limp (jumps +1 until healed).`,
          `Losing side of a punch-up — ${f.numbers?.credits}cr tab, bruised ribs (jumps +1 until healed).`,
        ]);
    }
  },
};
