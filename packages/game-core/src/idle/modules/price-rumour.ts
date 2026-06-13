// price-rumour — the bread-and-butter goal payoff: a time-boxed personal discount on a
// commodity at this station. Bargain-hunters hear about their target far more often.

import type { IdleModule } from '../types';
import { commodityName, randomCommodity, roll, vIndex, vline, vpick } from './util';

export const priceRumour: IdleModule = {
  id: 'price-rumour',
  events: [
    {
      id: 'price-rumour',
      eligible: () => true,
      weight: (c) => (c.goal?.kind === 'bargain-hunt' ? 6 : 1.5),
      resolve: (c) => {
        const commodity =
          c.goal?.kind === 'bargain-hunt' && c.goal.target
            ? c.goal.target
            : randomCommodity(c, 'commodity');
        const discount = roll(c, 'discount', 5, 18); // percent off
        const hours = roll(c, 'hours', 6, 14);
        const v = vIndex(c);
        const goods = commodityName(commodity).toLowerCase();
        return {
          deltas: [{ kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours }],
          fact: {
            plugin: 'price-rumour',
            outcome: 'tip',
            summary: vpick(v, [
              `picked up a dockside tip that ${goods} is moving cheap`,
              `heard from a freight clerk that ${goods} is going for a song`,
              `caught wind of a quiet markdown on ${goods}`,
              `got steered onto a soft price for ${goods} by a talkative loader`,
            ]),
            numbers: { commodity, discount: `${discount}%`, expiresInHours: hours, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    const goods = commodityName(String(f.numbers?.commodity)).toLowerCase();
    const tail = `your buy price −${f.numbers?.discount} here for ~${f.numbers?.expiresInHours}h`;
    return vline(f, [
      `Dockside tip: ${goods} going cheap — ${tail}.`,
      `A freight clerk talks too much: ${goods} is soft right now — ${tail}.`,
      `Word at the loading ramp is ${goods} got marked down quietly — ${tail}.`,
      `Overheard between cargo crews: ${goods} is a buyer's market — ${tail}.`,
    ]);
  },
};
