// cargo-watch — the hold writes the story. What you're hauling attracts its own brand of
// dockside trouble: livestock gets loose, medical supplies draw the desperate, luxuries
// draw thieves. The first modules to use the cargo gate (stats.cargo was always in
// context, unused until now).

import type { IdleModule, PluginOutcome } from '../types';
import { roll, vIndex, vline, vpick } from './util';

const LUXURIES = ['textiles', 'electronics', 'equipment'] as const;
const luxuryAboard = (cargo: Record<string, number>): string | null =>
  LUXURIES.find((id) => (cargo[id] ?? 0) > 0) ?? null;

export const cargoWatch: IdleModule = {
  id: 'cargo-watch',
  events: [
    {
      // Hauling livestock: something always gets loose on the dock.
      id: 'livestock-loose',
      eligible: (c) => (c.stats.cargo['livestock'] ?? 0) > 0,
      weight: () => 0.9,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.rng('wrangle') < (c.tags.includes('lucky') ? 0.75 : 0.55)) {
          return {
            deltas: [{ kind: 'standing', d: 1 }],
            fact: {
              plugin: 'cargo-watch',
              outcome: 'livestock-wrangled',
              summary: vpick(v, [
                'chased an escaped animal down the promenade to scattered applause',
                'cornered a runaway from the livestock hold before it reached the cantina',
                'recaptured an escapee with a cargo net and a crowd of advisors',
              ]),
              numbers: { standing: +1, v },
            },
          };
        }
        return {
          deltas: [{ kind: 'cargo', commodity: 'livestock', d: -1 }],
          fact: {
            plugin: 'cargo-watch',
            outcome: 'livestock-lost',
            summary: vpick(v, [
              'lost one head of livestock to an open hatch and a fast pair of hooves',
              'watched a crate of livestock resolve itself down to slightly fewer livestock',
              'gave up the chase somewhere past the third maintenance shaft — one animal short',
            ]),
            numbers: { livestock: -1, v },
          },
        };
      },
    },
    {
      // Hauling medicine: at struggling ports, the desperate come asking.
      id: 'medical-plea',
      eligible: (c) => (c.stats.cargo['medical'] ?? 0) > 0 && c.station.prosperity < 0.5,
      weight: (c) => 0.5 + (0.5 - c.station.prosperity),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.tags.includes('shady') && c.rng('mark-up') < 0.5) {
          const credits = roll(c, 'price', 80, 180);
          return {
            deltas: [
              { kind: 'cargo', commodity: 'medical', d: -1 },
              { kind: 'credits', d: credits },
              { kind: 'heat', d: 1 },
            ],
            fact: {
              plugin: 'cargo-watch',
              outcome: 'medical-sold-dear',
              summary: vpick(v, [
                'sold a case of medical supplies at a desperate markup, off the books',
                'named a price for medicine that the buyer had no choice but to pay',
                'let a ton of medical supplies go quietly, for the wrong reasons, at the right price',
              ]),
              numbers: { credits, medical: -1, heat: +1, v },
            },
          };
        }
        if (c.rng('give') < (c.tags.includes('lawful') || c.tags.includes('charming') ? 0.6 : 0.35)) {
          return {
            deltas: [
              { kind: 'cargo', commodity: 'medical', d: -1 },
              { kind: 'standing', d: 2 },
            ],
            fact: {
              plugin: 'cargo-watch',
              outcome: 'medical-given',
              summary: vpick(v, [
                'handed a clinic a case of medical supplies and refused the IOU',
                'donated a ton of medicine to the dockside infirmary, no questions',
                'let the medicine go at cost to a nurse who had stopped expecting kindness',
              ]),
              numbers: { medical: -1, standing: +2, v },
            },
          };
        }
        return {
          deltas: [],
          fact: {
            plugin: 'cargo-watch',
            outcome: 'medical-refused',
            summary: vpick(v, [
              'turned down a dockside plea for the medicine in the hold',
              'kept the medical cargo sealed despite a hard-luck story at the ramp',
              'said no to a buyer with empty pockets and a full waiting room',
            ]),
            numbers: { v },
            newsworthy: false,
          },
        };
      },
    },
    {
      // Hauling luxuries: thieves work the manifests too.
      id: 'luxury-prowler',
      eligible: (c) => luxuryAboard(c.stats.cargo) !== null && c.station.lawfulness < 0.6,
      weight: (c) => 0.5 + c.station.tension * 0.6,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        const commodity = luxuryAboard(c.stats.cargo)!;
        if (c.tags.includes('cautious') || c.rng('catch') < 0.5) {
          return {
            deltas: [{ kind: 'heat', d: 0 }],
            fact: {
              plugin: 'cargo-watch',
              outcome: 'prowler-foiled',
              summary: vpick(v, [
                'scared a hold-prowler off the cargo ramp before anything walked away',
                'found a cut seal and an empty-handed thief still inside the hold',
                'left the hold lights on a timer and came back to abandoned burglar tools',
              ]),
              numbers: { commodity, v },
              newsworthy: false,
            },
          };
        }
        return {
          deltas: [{ kind: 'cargo', commodity, d: -1 }],
          fact: {
            plugin: 'cargo-watch',
            outcome: 'cargo-pilfered',
            summary: vpick(v, [
              'lost a ton of high-value cargo to a dockside prowler with a seal cutter',
              'found the hold one crate lighter and the dock cameras conveniently dark',
              'paid the price for stacking valuables nearest the ramp',
            ]),
            numbers: { commodity, qty: -1, v },
          },
        };
      },
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'livestock-wrangled':
        return vline(f, [
          'An escapee from the livestock hold — run down to dockside applause (standing +1).',
          'Runaway cornered short of the cantina; the crowd approves (standing +1).',
          'Cargo net, one; livestock, nil (standing +1).',
        ]);
      case 'livestock-lost':
        return vline(f, [
          'One head of livestock makes a break for it and wins (-1t livestock).',
          'The hold count comes up one short. The maintenance shafts keep their secrets (-1t livestock).',
          'Fast hooves, open hatch: -1t livestock.',
        ]);
      case 'medical-sold-dear':
        return vline(f, [
          `Medicine moves quietly at a desperate markup: +${f.numbers?.credits}cr (-1t medical, heat +1).`,
          `Your price, their emergency: +${f.numbers?.credits}cr (-1t medical, heat +1).`,
          `Off the books, on the conscience: +${f.numbers?.credits}cr for 1t of medical (heat +1).`,
        ]);
      case 'medical-given':
        return vline(f, [
          'A clinic gets a case of your medical supplies; the port remembers (-1t medical, standing +2).',
          'Medicine donated to the dockside infirmary (-1t medical, standing +2).',
          'At cost, to the right hands (-1t medical, standing +2).',
        ]);
      case 'medical-refused':
        return vline(f, [
          'A plea at the ramp for the medicine aboard. The hold stays sealed.',
          'Hard-luck story, sealed cargo. Business is business.',
          'You say no. The waiting room stays full.',
        ]);
      case 'prowler-foiled':
        return vline(f, [
          'A hold-prowler bolts off the ramp empty-handed.',
          'Cut seal, spooked thief, nothing missing.',
          'Burglar tools abandoned by the cargo door — the timer trick works again.',
        ]);
      case 'cargo-pilfered':
        return vline(f, [
          'A seal cutter and dark cameras: -1t of high-value cargo.',
          'The hold is one crate lighter; nobody saw anything.',
          'Valuables by the ramp, gone by morning: -1t.',
        ]);
      default:
        return f.summary;
    }
  },
};
