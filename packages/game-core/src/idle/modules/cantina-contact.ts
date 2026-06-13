// cantina-contact — networking pays off in standing and a 'contact' flag that the
// second half of this module reads back: a few hours later the contact RETURNS with a
// tip-off, a courier favor, or an introduction — the favor is spent (flag cleared) and
// the room can be worked again. Much likelier when you're deliberately networking.

import type { IdleModule, PluginOutcome } from '../types';
import { commodityName, flagAge, randomCommodity, roll, vIndex, vline, vpick } from './util';

const RETURN_AFTER_MS = 2 * 3_600_000; // the contact needs a couple of hours to deliver

export const cantinaContact: IdleModule = {
  id: 'cantina-contact',
  events: [
    {
      id: 'cantina-contact',
      eligible: (c) => !c.stats.flags['contact'],
      weight: (c) =>
        0.8 * (c.goal?.kind === 'network' ? 3 : 1) * (c.tags.includes('charming') ? 1.5 : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        return {
          deltas: [
            { kind: 'standing', d: 2 },
            { kind: 'flag', flag: 'contact' },
          ],
          fact: {
            plugin: 'cantina-contact',
            outcome: 'contact',
            summary: vpick(v, [
              'made a friend of a well-connected local over a long round of drinks',
              'traded stories with a dock agent who knows everyone worth knowing',
              'got on the good side of a fixer holding court in the cantina corner',
              'swapped favors-to-be with a wharfinger over the last pot of coffee',
            ]),
            numbers: { standing: +2, v },
          },
        };
      },
    },
    {
      // The chain payoff: the contact comes back with something. One favor per flag —
      // the delivery clears it, and the cantina event above can then set it again.
      id: 'contact-returns',
      eligible: (c) => (flagAge(c, 'contact') ?? -1) >= RETURN_AFTER_MS,
      weight: (c) => 1.2 * (c.goal?.kind === 'network' ? 2 : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const which = c.rng('which');
        if (which < 0.4) {
          const commodity = randomCommodity(c, 'tip');
          const discount = roll(c, 'discount', 15, 25);
          const hours = roll(c, 'hours', 12, 24);
          return {
            deltas: [
              { kind: 'flag', flag: 'contact', clear: true },
              { kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours },
            ],
            fact: {
              plugin: 'cantina-contact',
              outcome: 'tip-off',
              summary: vpick(v, [
                `got a tip-off from a cantina contact about underpriced ${commodityName(commodity).toLowerCase()}`,
                `heard first — before the boards did — that ${commodityName(commodity).toLowerCase()} is going cheap`,
                `cashed in a cantina friendship for the quiet word on ${commodityName(commodity).toLowerCase()}`,
              ]),
              numbers: { commodity, discount: `${discount}%`, expiresInHours: hours, v },
            },
          };
        }
        if (which < 0.7) {
          const fee = roll(c, 'fee', 80, 200);
          return {
            deltas: [
              { kind: 'flag', flag: 'contact', clear: true },
              { kind: 'credits', d: fee },
            ],
            fact: {
              plugin: 'cantina-contact',
              outcome: 'courier',
              summary: vpick(v, [
                'ran a small, quiet package across the docks for a cantina contact',
                'did a contact a courier favor, no questions, cash on delivery',
                'carried a sealed satchel three berths over for an old cantina friend',
              ]),
              numbers: { credits: fee, v },
            },
          };
        }
        return {
          deltas: [
            { kind: 'flag', flag: 'contact', clear: true },
            { kind: 'standing', d: 2 },
          ],
          fact: {
            plugin: 'cantina-contact',
            outcome: 'introduction',
            summary: vpick(v, [
              'got walked around the dock offices and introduced as "one of the good ones"',
              'was vouched for, by name, in front of the people who matter here',
              'collected an introduction to the harbour clerks from a cantina friend',
            ]),
            numbers: { standing: +2, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'contact':
        return vline(f, [
          'You make a useful friend in the cantina (standing +2 — contact noted).',
          'A long round of drinks buys a long memory (standing +2 — contact noted).',
          'The right corner table, the right stories (standing +2 — contact noted).',
          'A fixer files your name under "useful" (standing +2 — contact noted).',
        ]);
      case 'tip-off':
        return vline(f, [
          `Your contact delivers: ${commodityName(String(f.numbers?.commodity)).toLowerCase()} −${f.numbers?.discount} for you here, ~${f.numbers?.expiresInHours}h.`,
          `A quiet word from a friend — ${commodityName(String(f.numbers?.commodity)).toLowerCase()} at −${f.numbers?.discount}, ~${f.numbers?.expiresInHours}h. Favor spent.`,
          `The cantina pays out: ${commodityName(String(f.numbers?.commodity)).toLowerCase()} marked down −${f.numbers?.discount} for ~${f.numbers?.expiresInHours}h.`,
        ]);
      case 'courier':
        return vline(f, [
          `A contact's courier job, done quietly: +${f.numbers?.credits}cr. Favor spent.`,
          `Sealed satchel, three berths, no questions: +${f.numbers?.credits}cr.`,
          `Your cantina friend pays cash on delivery: +${f.numbers?.credits}cr.`,
        ]);
      case 'introduction':
        return vline(f, [
          'Your contact walks you around the offices — doors open easier now (standing +2).',
          'Vouched for by name in the right rooms (standing +2). Favor spent.',
          'An introduction where it counts (standing +2).',
        ]);
      default:
        return f.summary;
    }
  },
};
