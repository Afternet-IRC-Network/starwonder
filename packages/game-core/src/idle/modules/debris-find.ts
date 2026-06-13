// debris-find — the long haul's chance-find: a debris field drifts across the course and
// yields a little salvage. Lucky traders spot more of it; cargo respects the hold.

import type { IdleModule, PluginOutcome } from '../types';
import { commodityName, randomCommodity, roll, vIndex, vline, vpick } from './util';

export const debrisFind: IdleModule = {
  id: 'debris-find',
  events: [
    {
      id: 'debris-find',
      context: 'transit',
      eligible: () => true,
      weight: (c) => 1.2 + (c.tags.includes('lucky') ? 1 : 0),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.rng('what') < 0.5) {
          const credits = roll(c, 'credits', 20, 120);
          return {
            deltas: [{ kind: 'credits', d: credits }],
            fact: {
              plugin: 'debris-find',
              outcome: 'scrap',
              summary: vpick(v, [
                'fished sellable scrap out of a drifting debris field',
                'netted a hull plate worth more than the detour it cost',
                'pulled a salvage-tag bounty off a charted wreck on the way past',
                'spent an hour with the grapple in a debris band and came out ahead',
              ]),
              numbers: { credits, v },
            },
          };
        }
        const commodity = randomCommodity(c, 'commodity');
        const qty = roll(c, 'qty', 1, 3);
        const goods = commodityName(commodity).toLowerCase();
        return {
          deltas: [{ kind: 'cargo', commodity, d: qty }],
          fact: {
            plugin: 'debris-find',
            outcome: 'salvage',
            summary: vpick(v, [
              `salvaged a sealed pallet of ${goods} from a wreck field`,
              `hauled a drifting container of ${goods} into the hold, seals intact`,
              `cut a cargo pod of ${goods} free of a dead hauler's frame`,
            ]),
            numbers: { commodity, qty, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    if (f.outcome === 'scrap') {
      return vline(f, [
        `Debris field on the course — scrap netted ${f.numbers?.credits}cr.`,
        `An hour with the grapple pays ${f.numbers?.credits}cr in scrap.`,
        `Salvage tag cashed mid-course: +${f.numbers?.credits}cr.`,
        `One good hull plate out of the drift: +${f.numbers?.credits}cr.`,
      ]);
    }
    const goods = commodityName(String(f.numbers?.commodity)).toLowerCase();
    return vline(f, [
      `Debris field on the course — salvaged ${f.numbers?.qty}t of ${goods}.`,
      `A drifting container gives up ${f.numbers?.qty}t of ${goods}, seals intact.`,
      `Cut free from a dead hauler: ${f.numbers?.qty}t of ${goods}.`,
    ]);
  },
};
