// card-game — back-room stakes for hustlers (and anyone stuck at a struggling port).
// Luck helps. The house edge is real: slightly worse than even odds unless you're lucky.
// Winning earns a table reputation (the 'card-rep' flag), which opens the LADDER for
// dedicated hustlers: the backroom game, then the big table — flag-gated, higher stakes.

import type { IdleModule, PluginOutcome } from '../types';
import { roll, vIndex, vline, vpick } from './util';

export const cardGame: IdleModule = {
  id: 'card-game',
  events: [
    {
      id: 'card-game',
      eligible: (c) => (c.goal?.kind === 'hustle' || c.station.prosperity < 0.4) && c.stats.credits >= 40,
      weight: (c) => (c.goal?.kind === 'hustle' ? 3 : 0.8),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const winP = 0.45 + (c.tags.includes('lucky') ? 0.15 : 0);
        if (c.rng('hand') < winP) {
          const won = roll(c, 'won', 40, 150);
          return {
            deltas: [
              { kind: 'credits', d: won },
              { kind: 'flag', flag: 'card-rep' },
            ],
            fact: {
              plugin: 'card-game',
              outcome: 'won',
              summary: vpick(v, [
                'walked away from a back-room card game ahead',
                'read three bluffs in a row and cashed out of the card game smiling',
                'left the card table with someone else’s week of wages',
              ]),
              numbers: { credits: won, v },
            },
          };
        }
        const lost = Math.min(roll(c, 'lost', 40, 150), c.stats.credits);
        return {
          deltas: [{ kind: 'credits', d: -lost }],
          fact: {
            plugin: 'card-game',
            outcome: 'lost',
            summary: vpick(v, [
              'dropped a stack of credits at a back-room card game',
              'chased a bad hand too far at the card table',
              'paid the house its edge, with interest',
            ]),
            numbers: { credits: -lost, v },
          },
        };
      },
    },
    {
      // Rung two: your table reputation gets you into the real game in the back of the back room.
      id: 'backroom-game',
      eligible: (c) => c.goal?.kind === 'hustle' && !!c.stats.flags['card-rep'] && c.stats.credits >= 150,
      weight: () => 2,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const winP = 0.42 + (c.tags.includes('lucky') ? 0.15 : 0);
        if (c.rng('hand') < winP) {
          const won = roll(c, 'won', 120, 320);
          return {
            deltas: [
              { kind: 'credits', d: won },
              { kind: 'flag', flag: 'big-table' },
            ],
            fact: {
              plugin: 'card-game',
              outcome: 'backroom-won',
              summary: vpick(v, [
                'took the backroom game for a serious pot — and got a nod toward the big table',
                'cleaned out the backroom regulars and earned an invitation upstairs',
                'beat the room the regulars thought was theirs; word goes to the big table',
              ]),
              numbers: { credits: won, v },
            },
          };
        }
        const lost = Math.min(roll(c, 'lost', 100, 280), c.stats.credits);
        return {
          deltas: [{ kind: 'credits', d: -lost }],
          fact: {
            plugin: 'card-game',
            outcome: 'backroom-lost',
            summary: vpick(v, [
              'got schooled by the backroom regulars and paid the tuition',
              'found out why the backroom game has regulars',
              'left the backroom lighter and wiser',
            ]),
            numbers: { credits: -lost, v },
          },
        };
      },
    },
    {
      // Rung three: the big table. The stakes are real; lose and your seat goes to someone luckier.
      id: 'big-table',
      eligible: (c) => !!c.stats.flags['big-table'] && c.stats.credits >= 400,
      weight: (c) => (c.goal?.kind === 'hustle' ? 1.5 : 0.6),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const winP = 0.4 + (c.tags.includes('lucky') ? 0.15 : 0);
        if (c.rng('hand') < winP) {
          const won = roll(c, 'won', 300, 600);
          return {
            deltas: [{ kind: 'credits', d: won }],
            fact: {
              plugin: 'card-game',
              outcome: 'big-table-won',
              summary: vpick(v, [
                'took the big table for everything on the felt',
                'won the hand the whole port will be talking about tomorrow',
                'walked away from the big table with the night’s bankroll',
              ]),
              numbers: { credits: won, v },
            },
          };
        }
        const lost = Math.min(roll(c, 'lost', 250, 500), c.stats.credits);
        return {
          deltas: [
            { kind: 'credits', d: -lost },
            { kind: 'flag', flag: 'big-table', clear: true },
          ],
          fact: {
            plugin: 'card-game',
            outcome: 'big-table-lost',
            summary: vpick(v, [
              'lost big at the big table — and the seat that came with it',
              'donated a bankroll to the big table and was shown the stairs',
              'went all-in at the big table on the wrong night',
            ]),
            numbers: { credits: -lost, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'won':
        return vline(f, [
          `Back-room cards go your way: +${f.numbers?.credits}cr. The table remembers you.`,
          `Three bluffs read, pot collected: +${f.numbers?.credits}cr (table rep noted).`,
          `You leave the card game up +${f.numbers?.credits}cr — the regulars take note.`,
        ]);
      case 'lost':
        return vline(f, [
          `The house wins this time: ${f.numbers?.credits}cr.`,
          `A bad hand chased too far: ${f.numbers?.credits}cr.`,
          `The house edge, paid in full: ${f.numbers?.credits}cr.`,
        ]);
      case 'backroom-won':
        return vline(f, [
          `The backroom game pays out +${f.numbers?.credits}cr — and a nod toward the big table.`,
          `You beat the regulars: +${f.numbers?.credits}cr (big-table invitation earned).`,
          `Backroom cleaned out: +${f.numbers?.credits}cr. Word travels upstairs.`,
        ]);
      case 'backroom-lost':
        return vline(f, [
          `The backroom regulars take their tuition: ${f.numbers?.credits}cr.`,
          `Schooled in the backroom: ${f.numbers?.credits}cr.`,
          `Lighter and wiser: ${f.numbers?.credits}cr to the regulars.`,
        ]);
      case 'big-table-won':
        return vline(f, [
          `THE BIG TABLE: +${f.numbers?.credits}cr. The whole port heard.`,
          `You take the big table for +${f.numbers?.credits}cr.`,
          `The night's bankroll leaves with you: +${f.numbers?.credits}cr.`,
        ]);
      case 'big-table-lost':
        return vline(f, [
          `The big table takes ${f.numbers?.credits}cr and your seat with it.`,
          `All-in, wrong night: ${f.numbers?.credits}cr gone, invitation revoked.`,
          `The big table shows you the stairs: ${f.numbers?.credits}cr.`,
        ]);
      default:
        return f.summary;
    }
  },
};
