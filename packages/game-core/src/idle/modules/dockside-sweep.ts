// dockside-sweep — the founding example: station security raids the docks chasing a
// robbery crew, and you may get swept up in it. Only fires at less-lawful, tense ports;
// keeping your head down (lay-low) avoids it entirely. Branches by who you are.

import type { IdleModule, PluginOutcome } from '../types';
import { vIndex, vline, vpick } from './util';

export const docksideSweep: IdleModule = {
  id: 'dockside-sweep',
  events: [
    {
      id: 'dockside-sweep',
      eligible: (c) =>
        c.station.lawfulness < 0.5 && c.station.tension > 0.4 && c.goal?.kind !== 'lay-low',
      weight: (c) => 0.6 + c.station.tension,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.rng('caught') >= 0.5) {
          // the raid rolled past your berth
          return {
            deltas: [{ kind: 'heat', d: 0 }],
            fact: {
              plugin: 'dockside-sweep',
              outcome: 'missed',
              summary: vpick(v, [
                'watched station security sweep the docks from a safe barstool',
                'kept a glass full while the security sweep went berth to berth',
                'let a dockside raid roll past without looking up from dinner',
                'stayed on the right side of the cordon while security turned the docks over',
              ]),
              numbers: { v },
              newsworthy: false,
            },
          };
        }
        if (c.tags.includes('shady')) {
          return {
            deltas: [
              { kind: 'heat', d: 2 },
              { kind: 'standing', d: 1 },
            ],
            fact: {
              plugin: 'dockside-sweep',
              outcome: 'slipped-away',
              summary: vpick(v, [
                'slipped out the back as station security swept the docks',
                'was over a fence and gone before the sweep reached the row',
                'vanished into the service corridors a step ahead of station security',
              ]),
              numbers: { heat: +2, standing: +1, v },
            },
          };
        }
        if (c.tags.includes('lawful')) {
          // clean but caught in the mess: fined, locals sour, the law warms to you,
          // and luxury food tightens after the bust
          return {
            deltas: [
              { kind: 'credits', d: -200 },
              { kind: 'standing', d: -3 },
              { kind: 'heat', d: -2 },
              { kind: 'marketNudge', commodity: 'food', factor: 1.15, hours: 8 },
            ],
            fact: {
              plugin: 'dockside-sweep',
              outcome: 'cleared-but-fined',
              summary: vpick(v, [
                'got swept up in a dockside sting and was cleared after paying a fine',
                'spent an afternoon in a security queue proving a clean manifest, minus a fine',
                'was processed, fined, and released with an apology that cost 200 credits',
              ]),
              numbers: { credits: -200, standing: -3, heat: -2, foodPrice: '+15%', v },
            },
          };
        }
        if (c.tags.includes('charming')) {
          return {
            deltas: [
              { kind: 'credits', d: -50 },
              { kind: 'standing', d: 1 },
            ],
            fact: {
              plugin: 'dockside-sweep',
              outcome: 'talked-clear',
              summary: vpick(v, [
                'talked their way out of a dockside sting for the price of a round',
                'laughed off a security sweep and bought the squad a round on the way out',
                'walked out of a dockside cordon mid-anecdote, tab in hand',
              ]),
              numbers: { credits: -50, standing: +1, v },
            },
          };
        }
        return {
          deltas: [
            { kind: 'credits', d: -150 },
            { kind: 'heat', d: 1 },
          ],
          fact: {
            plugin: 'dockside-sweep',
            outcome: 'fined',
            summary: vpick(v, [
              'got caught in a dockside security sweep and paid a spot fine',
              'was in the wrong corridor when the sweep came through, and paid for it',
              'ate a spot fine for loitering on the wrong side of a security cordon',
            ]),
            numbers: { credits: -150, heat: +1, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'missed':
        return vline(f, [
          'Station security sweeps the docks; you watch from a safe barstool.',
          'A raid rolls down the berth row — your berth is not on the list.',
          'Security turns the docks over. You keep your seat and your drink.',
          'The cordon goes up two rows over; you stay put until it comes down.',
        ]);
      case 'slipped-away':
        return vline(f, [
          'You slip out the back of a security sweep (heat +2, the dock crowd approves).',
          'Over the fence ahead of the sweep — the law noticed (heat +2, standing +1).',
          'Service corridors swallow you before the cordon closes (heat +2, standing +1).',
        ]);
      case 'cleared-but-fined':
        return vline(f, [
          'Caught in a dockside sting — cleared after a 200cr fine; the law files you as cooperative.',
          'Clean manifest, dirty afternoon: 200cr in fines and the locals saw you cooperate (heat -2).',
          'Processed and released — 200cr lighter, file thinner, dock crowd colder.',
        ]);
      case 'talked-clear':
        return vline(f, [
          'You talk your way out of a sweep for the price of a round (-50cr, standing +1).',
          'A good story and a bought round get you through the cordon (-50cr, standing +1).',
          'The sweep squad leaves laughing; the tab is yours (-50cr, standing +1).',
        ]);
      default:
        return vline(f, [
          `A dockside sweep nets you a spot fine: ${f.numbers?.credits}cr.`,
          `Wrong corridor, wrong hour: ${f.numbers?.credits}cr spot fine (heat +1).`,
          `Security finds nothing but fines you anyway: ${f.numbers?.credits}cr.`,
        ]);
    }
  },
};
