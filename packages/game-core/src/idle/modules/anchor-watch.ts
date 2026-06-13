// anchor-watch — life at anchor: ship-scoped beats while you ride in orbit, undocked,
// above an inhabited world. Orbit is restful (conditions tick here like at dock) but the
// stories are different: you're in your own hull listening to the traffic, not in the
// bars. The station's vibe still colours the channel chatter below.

import type { IdleModule } from '../types';
import { commodityName, randomCommodity, roll, vIndex, vline, vpick } from './util';

export const anchorWatch: IdleModule = {
  id: 'anchor-watch',
  events: [
    {
      // Passing crews swap news on the open channel — flavour, and a thread for the narrator.
      id: 'orbit-hail',
      context: 'orbit',
      eligible: () => true,
      weight: (c) => 1.2 + (c.tags.includes('charming') ? 0.5 : 0),
      resolve: (c) => {
        const what = [
          'an inbound freighter crew',
          'a tug pilot on the long watch',
          'a survey boat sweeping the belt',
          'a fuel lighter making its last run of the shift',
          'a mail packet holding for a docking slot',
          'a retired liner captain who never stopped monitoring the band',
        ];
        const who = what[Math.floor(c.rng('who') * what.length)];
        const v = vIndex(c);
        return {
          deltas: [],
          fact: {
            plugin: 'anchor-watch',
            outcome: 'hail',
            summary: vpick(v, [
              `swapped channel chatter with ${who} from orbit`,
              `passed a slow watch trading news with ${who}`,
              `kept the open channel warm with ${who}`,
            ]),
            numbers: { who, v },
            newsworthy: false,
          },
        };
      },
    },
    {
      // Traffic-control eavesdropping: a weaker cousin of the dockside price rumour —
      // you hear what's moving below. Bargain-hunters tune the scanner to their target.
      id: 'traffic-chatter',
      context: 'orbit',
      eligible: () => true,
      weight: (c) => (c.goal?.kind === 'bargain-hunt' ? 3 : 0.8),
      resolve: (c) => {
        const commodity =
          c.goal?.kind === 'bargain-hunt' && c.goal.target
            ? c.goal.target
            : randomCommodity(c, 'commodity');
        const discount = roll(c, 'discount', 3, 10); // shallower than a dockside tip
        const hours = roll(c, 'hours', 4, 10);
        const v = vIndex(c);
        const goods = commodityName(commodity).toLowerCase();
        return {
          deltas: [{ kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours }],
          fact: {
            plugin: 'anchor-watch',
            outcome: 'chatter',
            summary: vpick(v, [
              `read the traffic below — ${goods} is moving cheap dockside`,
              `pieced the docking manifests together: ${goods} is stacking up below`,
              `heard two haulers grumble about ${goods} margins on the approach band`,
            ]),
            numbers: { commodity, discount: `${discount}%`, expiresInHours: hours, v },
            newsworthy: false,
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'hail':
        return vline(f, [
          `Open channel: traded news and small talk with ${f.numbers?.who}.`,
          `A slow watch, made shorter by ${f.numbers?.who} on the band.`,
          `You keep the channel warm with ${f.numbers?.who}.`,
        ]);
      case 'chatter': {
        const goods = commodityName(String(f.numbers?.commodity)).toLowerCase();
        const tail = `your buy price −${f.numbers?.discount} for ~${f.numbers?.expiresInHours}h`;
        return vline(f, [
          `Traffic chatter: ${goods} moving cheap below — ${tail}.`,
          `The manifests don't lie: ${goods} is stacking up dockside — ${tail}.`,
          `Two haulers grumble; you profit: ${goods} soft below — ${tail}.`,
        ]);
      }
      default:
        return f.summary;
    }
  },
};
