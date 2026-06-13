// harbour-favor — the networking payoff: once you're known here and working the room,
// the harbour-master's office starts doing you favors. One-shot per station (VIP flag) —
// and later the harbour-master ASKS BACK: a quiet errand whose shape depends on who you
// are (lawful escort work vs. a shadier look-the-other-way), also one-shot per station.

import type { IdleModule, PluginOutcome } from '../types';
import { commodityName, flagAge, randomCommodity, roll, vIndex, vline, vpick } from './util';

const ASK_BACK_AFTER_MS = 6 * 3_600_000; // the office waits a watch or two before asking

export const harbourFavor: IdleModule = {
  id: 'harbour-favor',
  events: [
    {
      id: 'harbour-favor',
      eligible: (c) => c.goal?.kind === 'network' && c.stats.standing >= 2 && !c.stats.flags['vip'],
      weight: () => 1.2,
      resolve: (c): PluginOutcome => {
        const commodity = randomCommodity(c, 'perk');
        const discount = roll(c, 'discount', 5, 10);
        const v = vIndex(c);
        return {
          deltas: [
            { kind: 'flag', flag: 'vip' },
            { kind: 'standing', d: 2 },
            { kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours: 24 },
          ],
          fact: {
            plugin: 'harbour-favor',
            outcome: 'vip',
            summary: vpick(v, [
              "earned a quiet favor from the harbour-master's office",
              'got moved to the short list at the harbour-master’s office',
              'was waved past the queue with a nod from the harbour-master',
            ]),
            numbers: { standing: +2, commodity, discount: `${discount}%`, v },
          },
        };
      },
    },
    {
      // The ask-back: a one-shot errand per station, resolved by who you are. Lawful
      // traders escort a sealed pouch (clean money, the law approves); shady ones get
      // offered the other kind of errand; everyone else just lends a practical hand.
      id: 'harbour-errand',
      eligible: (c) => (flagAge(c, 'vip') ?? -1) >= ASK_BACK_AFTER_MS && !c.stats.flags['vip-errand'],
      weight: () => 1,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.tags.includes('shady')) {
          const fee = roll(c, 'fee', 120, 260);
          return {
            deltas: [
              { kind: 'flag', flag: 'vip-errand' },
              { kind: 'credits', d: fee },
              { kind: 'heat', d: 1 },
            ],
            fact: {
              plugin: 'harbour-favor',
              outcome: 'errand-shady',
              summary: vpick(v, [
                'misplaced one page of a manifest as a personal favor to the harbour-master',
                'made sure a certain inspection slot stayed conveniently unfilled',
                'walked a crate through the wrong gate for the harbour-master, no stamps asked',
              ]),
              numbers: { credits: fee, heat: +1, v },
            },
          };
        }
        if (c.tags.includes('lawful')) {
          const fee = roll(c, 'fee', 80, 160);
          return {
            deltas: [
              { kind: 'flag', flag: 'vip-errand' },
              { kind: 'credits', d: fee },
              { kind: 'heat', d: -1 },
              { kind: 'standing', d: 1 },
            ],
            fact: {
              plugin: 'harbour-favor',
              outcome: 'errand-lawful',
              summary: vpick(v, [
                'escorted a sealed customs pouch across the docks for the harbour-master',
                'stood witness on a sealed-cargo transfer at the harbour-master’s request',
                'carried the quarter’s bonded ledgers to the customs house, under seal',
              ]),
              numbers: { credits: fee, heat: -1, standing: +1, v },
            },
          };
        }
        const fee = roll(c, 'fee', 60, 140);
        return {
          deltas: [
            { kind: 'flag', flag: 'vip-errand' },
            { kind: 'credits', d: fee },
            { kind: 'standing', d: 1 },
          ],
          fact: {
            plugin: 'harbour-favor',
            outcome: 'errand-done',
            summary: vpick(v, [
              'ran a practical errand for the harbour-master’s office, paid in cash and goodwill',
              'spent a watch moving berth assignments around as a favor to the office',
              'helped the harbour-master untangle a double-booked landing pad',
            ]),
            numbers: { credits: fee, standing: +1, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'vip':
        return vline(f, [
          `The harbour-master's office owes you one — VIP here now (standing +2, ${commodityName(String(f.numbers?.commodity)).toLowerCase()} −${f.numbers?.discount} for a day).`,
          `Short list, fast lane: VIP at this port (standing +2, ${commodityName(String(f.numbers?.commodity)).toLowerCase()} −${f.numbers?.discount} for a day).`,
          `A nod from the harbour-master and the queue parts (standing +2, ${commodityName(String(f.numbers?.commodity)).toLowerCase()} −${f.numbers?.discount} for a day).`,
        ]);
      case 'errand-shady':
        return vline(f, [
          `The harbour-master asks back — a page goes missing, ${f.numbers?.credits}cr appears (heat +1).`,
          `One unfilled inspection slot, one fat envelope: +${f.numbers?.credits}cr (heat +1).`,
          `A crate, a wrong gate, no stamps: +${f.numbers?.credits}cr (heat +1).`,
        ]);
      case 'errand-lawful':
        return vline(f, [
          `The harbour-master asks back — sealed pouch escorted, by the book: +${f.numbers?.credits}cr (heat -1, standing +1).`,
          `Bonded ledgers delivered under seal: +${f.numbers?.credits}cr, and the law approves (heat -1).`,
          `Witness on a sealed transfer: +${f.numbers?.credits}cr (heat -1, standing +1).`,
        ]);
      case 'errand-done':
        return vline(f, [
          `The harbour-master asks back — an honest watch's work: +${f.numbers?.credits}cr (standing +1).`,
          `Berth assignments untangled, favor returned: +${f.numbers?.credits}cr (standing +1).`,
          `A practical errand for the office: +${f.numbers?.credits}cr (standing +1).`,
        ]);
      default:
        return f.summary;
    }
  },
};
