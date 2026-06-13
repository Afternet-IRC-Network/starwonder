// customs-audit — the lawful-station mirror of the sweep. Heat draws audits; a clean
// audit cools you off, a hot one costs you. This is the main heat sink besides decay.

import type { IdleModule, PluginOutcome } from '../types';
import { vIndex, vline, vpick } from './util';

export const customsAudit: IdleModule = {
  id: 'customs-audit',
  events: [
    {
      id: 'customs-audit',
      eligible: (c) => c.station.lawfulness > 0.6,
      weight: (c) => 0.4 + c.stats.heat * 0.2,
      resolve: (c): PluginOutcome => {
        const v = vIndex(c);
        if (c.stats.heat > 2) {
          const fine = Math.min(50 + Math.round(c.stats.heat) * 30, c.stats.credits);
          return {
            deltas: [
              { kind: 'credits', d: -fine },
              { kind: 'heat', d: -2 },
            ],
            fact: {
              plugin: 'customs-audit',
              outcome: 'fined',
              summary: vpick(v, [
                'got pulled into a customs audit and paid through the nose',
                'spent half a shift in a customs box and left with a thinner account',
                'was flagged for a full-manifest audit and fined on the technicalities',
              ]),
              numbers: { credits: -fine, heat: -2, v },
            },
          };
        }
        const lawful = c.tags.includes('lawful');
        return {
          deltas: [{ kind: 'heat', d: -1 }, ...(lawful ? [{ kind: 'standing', d: 1 } as const] : [])],
          fact: {
            plugin: 'customs-audit',
            outcome: 'clean',
            summary: vpick(v, [
              'breezed through a spot customs audit with a spotless manifest',
              'handed over a manifest so tidy the customs officer looked disappointed',
              'cleared a random customs check before the coffee went cold',
            ]),
            numbers: { heat: -1, ...(lawful ? { standing: +1 } : {}), v },
            newsworthy: false,
          },
        };
      },
    },
  ],
  line: (f) =>
    f.outcome === 'fined'
      ? vline(f, [
          `Customs audit — they find enough paperwork to fine you ${f.numbers?.credits}cr (heat -2).`,
          `A full-manifest audit: ${f.numbers?.credits}cr in technicalities, but your file cools (heat -2).`,
          `Half a shift in the customs box and ${f.numbers?.credits}cr in fines (heat -2).`,
        ])
      : vline(f, [
          'A spot customs audit finds nothing; your file gets a little thinner (heat -1).',
          'Clean manifest, bored officer, stamped through (heat -1).',
          'Random check, nothing to find — the law loses a little interest in you (heat -1).',
        ]),
};
