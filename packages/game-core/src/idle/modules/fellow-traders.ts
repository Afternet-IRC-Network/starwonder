// fellow-traders — presence-aware beats that name REAL traders parked in the same
// sector (ctx.roster, plumbed by the server). Multiplayer flavor nobody else has: the
// knowledge policy holds because roster names are only known where you ARE, which is
// exactly where beats happen. Small or no deltas — the name is the content.

import type { IdleModule, PluginOutcome } from '../types';
import { commodityName, randomCommodity, roll, vIndex, vline, vpick } from './util';

const pickName = (c: { rng: (s: string) => number; roster?: string[] }): string => {
  const r = c.roster!;
  return r[Math.floor(c.rng('who') * r.length)];
};

export const fellowTraders: IdleModule = {
  id: 'fellow-traders',
  events: [
    {
      // Docked together: a round, a story, a name to remember.
      id: 'dockside-company',
      eligible: (c) => (c.roster?.length ?? 0) > 0,
      weight: (c) => 0.8 + (c.tags.includes('charming') ? 0.4 : 0),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const who = pickName(c);
        return {
          deltas: [],
          fact: {
            plugin: 'fellow-traders',
            outcome: 'company',
            summary: vpick(v, [
              `split a table in the cantina with ${who}, swapping lane stories`,
              `compared scars and cargo manifests with ${who} over a slow drink`,
              `closed out the bar with ${who}, arguing about the best route coreward`,
              `traded harbour gossip with ${who} across two adjacent berths`,
            ]),
            numbers: { who, v },
            newsworthy: false,
          },
        };
      },
    },
    {
      // Working traders talk prices — a small, honest intel nudge with a name on it.
      id: 'trader-intel',
      eligible: (c) => (c.roster?.length ?? 0) > 0,
      weight: (c) => (c.goal?.kind === 'bargain-hunt' ? 1.5 : 0.6),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const who = pickName(c);
        const commodity =
          c.goal?.kind === 'bargain-hunt' && c.goal.target
            ? c.goal.target
            : randomCommodity(c, 'commodity');
        const discount = roll(c, 'discount', 4, 12);
        const hours = roll(c, 'hours', 4, 12);
        return {
          deltas: [{ kind: 'marketNudge', commodity, factor: 1 - discount / 100, hours }],
          fact: {
            plugin: 'fellow-traders',
            outcome: 'intel',
            summary: vpick(v, [
              `got the honest word on ${commodityName(commodity).toLowerCase()} prices from ${who}`,
              `compared ledgers with ${who} and found the soft spot in ${commodityName(commodity).toLowerCase()}`,
              `was tipped off by ${who} about a quiet deal on ${commodityName(commodity).toLowerCase()}`,
            ]),
            numbers: { who, commodity, discount: `${discount}%`, expiresInHours: hours, v },
            newsworthy: false,
          },
        };
      },
    },
    {
      // At anchor together: ships riding the same sky keep loose company.
      id: 'shared-watch',
      context: 'orbit',
      eligible: (c) => (c.roster?.length ?? 0) > 0,
      weight: () => 1,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const who = pickName(c);
        return {
          deltas: [],
          fact: {
            plugin: 'fellow-traders',
            outcome: 'shared-watch',
            summary: vpick(v, [
              `shared a quiet anchor watch with ${who}, hulls a few klicks apart`,
              `kept station alongside ${who} through the night cycle, channel open`,
              `watched the same sunrise over the same world as ${who}`,
            ]),
            numbers: { who, v },
            newsworthy: false,
          },
        };
      },
    },
  ],
  line: (f) => {
    const who = String(f.numbers?.who ?? 'another trader');
    switch (f.outcome) {
      case 'company':
        return vline(f, [
          `Cantina company: ${who}, two chairs, a stack of lane stories.`,
          `You and ${who} close out the bar arguing routes.`,
          `Adjacent berths, shared gossip — ${who} is parked here too.`,
          `Scars and manifests compared with ${who}.`,
        ]);
      case 'intel': {
        const goods = commodityName(String(f.numbers?.commodity)).toLowerCase();
        return vline(f, [
          `${who} gives you the honest word: ${goods} −${f.numbers?.discount} for you here, ~${f.numbers?.expiresInHours}h.`,
          `Ledgers compared with ${who} — ${goods} is soft (−${f.numbers?.discount}, ~${f.numbers?.expiresInHours}h).`,
          `A tip with a name on it: ${who} says ${goods} is going cheap (−${f.numbers?.discount}, ~${f.numbers?.expiresInHours}h).`,
        ]);
      }
      case 'shared-watch':
        return vline(f, [
          `Anchor watch shared with ${who}, hulls a few klicks apart.`,
          `Night cycle alongside ${who}, channel open, nothing that needed saying.`,
          `Same sky, same sunrise: ${who} rides at anchor here too.`,
        ]);
      default:
        return f.summary;
    }
  },
};
