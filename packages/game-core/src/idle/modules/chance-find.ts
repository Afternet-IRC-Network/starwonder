// chance-find — small windfalls: loose credits, or an unclaimed crate if there's room.
// Cautious traders poke around less; lucky ones find more.

import type { IdleModule, PluginOutcome } from '../types';
import { commodityName, randomCommodity, roll, vIndex, vline, vpick } from './util';

export const chanceFind: IdleModule = {
  id: 'chance-find',
  events: [
    {
      id: 'chance-find',
      eligible: () => true,
      weight: (c) => (c.tags.includes('cautious') ? 0.6 : 1) * (c.tags.includes('lucky') ? 1.6 : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const used = Object.values(c.stats.cargo).reduce((a, b) => a + b, 0);
        const crate = c.rng('what') < 0.3 && used < c.stats.holdSize;
        if (crate) {
          const commodity = randomCommodity(c, 'crate');
          const goods = commodityName(commodity).toLowerCase();
          return {
            deltas: [{ kind: 'cargo', commodity, d: 1 }],
            fact: {
              plugin: 'chance-find',
              outcome: 'cargo',
              summary: vpick(v, [
                `salvaged an unclaimed crate of ${goods} from a derelict berth`,
                `walked off with a write-off crate of ${goods} the manifest forgot`,
                `claimed an abandoned-cargo lot of ${goods} at the dockmaster's auction`,
                `pried a stray crate of ${goods} out of a condemned locker`,
              ]),
              numbers: { commodity, qty: 1, v },
            },
          };
        }
        const credits = roll(c, 'credits', 20, 90) * (c.tags.includes('lucky') ? 1.5 : 1);
        const d = Math.round(credits);
        return {
          deltas: [{ kind: 'credits', d }],
          fact: {
            plugin: 'chance-find',
            outcome: 'credits',
            summary: vpick(v, [
              'pocketed a finder’s fee for flagging a mislabeled container',
              'got slipped a few credits for returning a dropped cargo seal',
              'collected on a small wager about an inbound freighter’s tail number',
              'earned a quiet tip for steering a lost courier to the right berth',
            ]),
            numbers: { credits: d, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    if (f.outcome === 'cargo') {
      const goods = commodityName(String(f.numbers?.commodity)).toLowerCase();
      return vline(f, [
        `Found an unclaimed crate of ${goods} (+1 hold).`,
        `A forgotten crate of ${goods} is yours by salvage right (+1 hold).`,
        `Dockmaster's auction: one stray lot of ${goods}, no other bidders (+1 hold).`,
        `A condemned locker gives up a crate of ${goods} (+1 hold).`,
      ]);
    }
    return vline(f, [
      `A finder's fee lands in your account: +${f.numbers?.credits}cr.`,
      `Loose money on the docks today — +${f.numbers?.credits}cr yours.`,
      `Small favor, small payout: +${f.numbers?.credits}cr.`,
      `Somebody settles up faster than expected: +${f.numbers?.credits}cr.`,
    ]);
  },
};
