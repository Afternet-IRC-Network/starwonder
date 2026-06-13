// pirate-shadow — a cutter falls in behind you on a quiet stretch of the course. Cautious
// traders mostly go unseen; charming/shady ones talk their way clear; everyone else pays
// a toll to keep the lane open. Friction, never a hull loss (soft-loss spirit, §8).
// Paying a toll leaves a RECEIPT — a fading condition the pirate band remembers: the next
// cutter usually waves you through… or smells money and shakes you down harder (seeded).
// Pirate odds also track the danger tier when the course knows it: calm core lanes are
// nearly clean, rim lanes crawl with cutters.

import type { IdleModule, PluginOutcome } from '../types';
import { hasCondition } from '../types';
import { roll, vIndex, vline, vpick } from './util';

const TIER_ODDS = { peaceful: 0.35, medium: 1, dangerous: 1.7, 'very-dangerous': 2.4 } as const;

export const pirateShadow: IdleModule = {
  id: 'pirate-shadow',
  events: [
    {
      id: 'pirate-shadow',
      context: 'transit',
      eligible: (c) => c.stats.credits > 0 || c.tags.includes('cautious'),
      weight: (c) =>
        (1.5 + (c.tags.includes('reckless') ? 0.7 : 0)) *
        (c.dangerTier ? TIER_ODDS[c.dangerTier] : 1),
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (hasCondition(c, 'toll-receipt')) {
          if (c.rng('recognized') < 0.6) {
            return {
              deltas: [],
              fact: {
                plugin: 'pirate-shadow',
                outcome: 'waved-through',
                summary: vpick(v, [
                  'was waved through by a pirate cutter that knew the toll was already paid',
                  'flashed last toll’s receipt-code at a cutter and got a lazy wing-waggle back',
                  'got passed down the lane by pirates who recognized a paying customer',
                ]),
                numbers: { v },
              },
            };
          }
          const toll = roll(c, 'greedy-toll', 60, 240);
          return {
            deltas: [
              { kind: 'credits', d: -toll },
              { kind: 'condition', clear: 'toll-receipt' },
              { kind: 'condition', add: { id: 'toll-receipt' } },
            ],
            fact: {
              plugin: 'pirate-shadow',
              outcome: 'shaken-down',
              summary: vpick(v, [
                'got marked as a soft touch and shaken down harder by the next cutter',
                'paid a steeper toll to a cutter that knew exactly how much was aboard',
                'learned that paying once means paying again, with interest',
              ]),
              numbers: { toll, v },
            },
          };
        }
        if (c.tags.includes('cautious') && c.rng('evade') < 0.6) {
          return {
            deltas: [],
            fact: {
              plugin: 'pirate-shadow',
              outcome: 'evaded',
              summary: vpick(v, [
                'ran dark past a prowling pirate cutter, unseen',
                'killed the running lights and drifted past a pirate picket',
                'slipped a cutter’s sensor cone by riding a freighter’s shadow',
              ]),
              numbers: { v },
            },
          };
        }
        if ((c.tags.includes('charming') || c.tags.includes('shady')) && c.rng('talk') < 0.5) {
          return {
            deltas: [],
            fact: {
              plugin: 'pirate-shadow',
              outcome: 'talked',
              summary: vpick(v, [
                'traded gossip with a pirate cutter and was waved through',
                'talked lane news with a bored pirate crew until they lost interest',
                'swapped a rumour for free passage when a cutter pulled alongside',
              ]),
              numbers: { v },
            },
          };
        }
        const toll = roll(c, 'toll', 40, 160);
        return {
          deltas: [
            { kind: 'credits', d: -toll },
            { kind: 'condition', add: { id: 'toll-receipt' } },
          ],
          fact: {
            plugin: 'pirate-shadow',
            outcome: 'toll',
            summary: vpick(v, [
              'paid off a pirate cutter to keep the lane open',
              'bought passage from a cutter sitting square across the lane',
              'settled a pirate toll the practical way and flew on',
            ]),
            numbers: { toll, v },
          },
        };
      },
    },
  ],
  conditions: [
    {
      id: 'toll-receipt',
      label: 'Toll receipt',
      blurb: 'You paid a cutter’s toll, and word travels on the pirate band. The next shakedown usually goes easier — unless they smell money. Fades with time.',
      modifiers: () => ({}),
      tick: (cond, c) =>
        c.rng('fade') < 0.08
          ? {
              deltas: [{ kind: 'condition', clear: 'toll-receipt' }],
              fact: {
                plugin: 'pirate-shadow',
                outcome: 'receipt-faded',
                summary: 'fell off the pirate grapevine — the toll receipt means nothing now',
                newsworthy: false,
              },
            }
          : null,
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'evaded':
        return vline(f, [
          'A pirate cutter swept the lane — you ran dark and slipped past.',
          'Lights out, drives cold: the picket never saw you.',
          'You ride a freighter’s shadow past a cutter’s sensor cone.',
        ]);
      case 'talked':
        return vline(f, [
          'A pirate cutter pulled alongside — a little gossip and they waved you through.',
          'The cutter wanted news more than credits. You had news.',
          'One good rumour buys the lane.',
        ]);
      case 'waved-through':
        return vline(f, [
          'A cutter scans you, reads the receipt, and waves you through.',
          'The pirate band remembers your last toll — free passage this time.',
          'A lazy wing-waggle from the cutter: paying customers ride free. For now.',
        ]);
      case 'shaken-down':
        return vline(f, [
          `Marked as a payer — this cutter wants more: ${f.numbers?.toll}cr.`,
          `The grapevine sold you out: a steeper toll, ${f.numbers?.toll}cr.`,
          `Pay once, pay again: ${f.numbers?.toll}cr with interest.`,
        ]);
      case 'receipt-faded':
        return 'The pirate band has forgotten your last toll.';
      default:
        return vline(f, [
          `A pirate cutter shook you down — ${f.numbers?.toll}cr to keep the lane open.`,
          `Toll paid under a cutter's guns: ${f.numbers?.toll}cr. The band will remember.`,
          `${f.numbers?.toll}cr buys the lane open and a receipt on the pirate grapevine.`,
        ]);
    }
  },
};
