// stray-cat — proof that conditions can be GOOD. A dockside stray adopts your ship;
// morale (and energy regen) ticks up for as long as it deigns to stay. Permanent-ish:
// it never leaves on its own. Rare, and once you have a cat, you have a cat — and the
// cat has BEATS: it drags things aboard, goes missing, and gets recognized before you do.

import type { IdleModule, PluginOutcome } from '../types';
import { hasCondition } from '../types';
import { roll, vIndex, vline, vpick } from './util';

export const strayCat: IdleModule = {
  id: 'stray-cat',
  events: [
    {
      id: 'stray-cat',
      eligible: (c) => !hasCondition(c, 'ship-cat'),
      weight: () => 0.15,
      resolve: (c) => {
        const v = vIndex(c);
        return {
          deltas: [{ kind: 'condition', add: { id: 'ship-cat' } }],
          fact: {
            plugin: 'stray-cat',
            outcome: 'adopted',
            summary: vpick(v, [
              'was adopted by a dockside stray cat that now lives aboard',
              'lost the argument with a stray cat about who owns the ship',
              'found a stowaway cat asleep on the flight couch and gave up evicting it',
            ]),
            numbers: { regen: '×1.1', v },
          },
        };
      },
    },
    {
      // The cat drags something aboard. Usually worthless; occasionally not.
      id: 'cat-gift',
      eligible: (c) => hasCondition(c, 'ship-cat'),
      weight: () => 0.5,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.rng('worth') < 0.3) {
          const credits = roll(c, 'credits', 15, 60);
          return {
            deltas: [{ kind: 'credits', d: credits }],
            fact: {
              plugin: 'stray-cat',
              outcome: 'cat-prize',
              summary: vpick(v, [
                'discovered the ship’s cat had dragged aboard something actually worth selling',
                'sold a salvage trinket the cat hauled in from who-knows-where',
                'fenced the cat’s latest kill: a fistful of intact relay crystals',
              ]),
              numbers: { credits, v },
            },
          };
        }
        return {
          deltas: [],
          fact: {
            plugin: 'stray-cat',
            outcome: 'cat-haul',
            summary: vpick(v, [
              'found the ship’s cat guarding a dead maintenance drone like a trophy',
              'stepped over a row of bottle caps the cat had arranged by the airlock',
              'was presented with half a sandwich of unknown provenance by the cat',
              'watched the cat smuggle an entire glove aboard with great ceremony',
            ]),
            numbers: { v },
            newsworthy: false,
          },
        };
      },
    },
    {
      // Dockhands know the cat before they know you — the cat is the diplomat.
      id: 'cat-ambassador',
      eligible: (c) => hasCondition(c, 'ship-cat'),
      weight: () => 0.4,
      resolve: (c) => {
        const v = vIndex(c);
        return {
          deltas: [{ kind: 'standing', d: 1 }],
          fact: {
            plugin: 'stray-cat',
            outcome: 'cat-ambassador',
            summary: vpick(v, [
              'watched the dock crew greet the ship’s cat by name before saying hello',
              'got better service the moment the cat sauntered down the ramp',
              'learned the dockhands have been feeding the cat all week — and like the ship for it',
            ]),
            numbers: { standing: +1, v },
          },
        };
      },
    },
  ],
  conditions: [
    {
      id: 'ship-cat',
      label: "Ship's cat",
      blurb: 'A stray adopted your ship. Morale is up — energy regenerates 10% faster.',
      permanent: true,
      modifiers: () => ({ energyRegenFactor: 1.1 }),
      tick: () => null,
    },
  ],
  line: (f) => {
    switch (f.outcome) {
      case 'adopted':
        return vline(f, [
          'A dockside stray has moved into your ship. You have a cat now (energy regen ×1.1).',
          'The cat stays. It was never really a negotiation (energy regen ×1.1).',
          'Stowaway found: one cat, asleep, immovable. Crew of two now (energy regen ×1.1).',
        ]);
      case 'cat-prize':
        return vline(f, [
          `The cat drags in something sellable for once: +${f.numbers?.credits}cr.`,
          `Cat tribute, fenced dockside: +${f.numbers?.credits}cr.`,
          `Whatever the cat killed, it was worth +${f.numbers?.credits}cr.`,
        ]);
      case 'cat-haul':
        return vline(f, [
          'The cat has brought something aboard. You decide not to ask.',
          'New trophy by the airlock, courtesy of the cat.',
          'The cat presents its haul with great ceremony. It is garbage.',
          'One glove, smuggled aboard with pride. The cat is pleased.',
        ]);
      case 'cat-ambassador':
        return vline(f, [
          'The dock crew knows your cat by name; you ride its reputation (standing +1).',
          'Service improves the moment the cat appears (standing +1).',
          'The dockhands have adopted your cat right back (standing +1).',
        ]);
      default:
        return f.summary;
    }
  },
};
