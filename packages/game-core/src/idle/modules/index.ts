// THE registry — single source of truth for idle dynamics (the CLASS_SPEC pattern).
// Add a dynamic by adding a file and listing it here; eligibility, odds, ongoing
// conditions, recovery, and log lines all travel with the module.

import type { EventFact, IdleCondition, IdleEvent, IdleModule } from '../types';
import { priceRumour } from './price-rumour';
import { chanceFind } from './chance-find';
import { pickpocket } from './pickpocket';
import { cantinaContact } from './cantina-contact';
import { docksideSweep } from './dockside-sweep';
import { customsAudit } from './customs-audit';
import { harbourFavor } from './harbour-favor';
import { measles } from './measles';
import { barBrawl } from './bar-brawl';
import { strayCat } from './stray-cat';
import { cardGame } from './card-game';
import { course } from './course';
import { trade } from './trade';
import { anchorWatch } from './anchor-watch';
import { debrisFind } from './debris-find';
import { pirateShadow } from './pirate-shadow';
import { voidChatter } from './void-chatter';
import { layLow } from './lay-low';
import { cargoWatch } from './cargo-watch';
import { fellowTraders } from './fellow-traders';
import { vignettes } from './vignettes';

export const IDLE_MODULES: IdleModule[] = [
  priceRumour,
  chanceFind,
  pickpocket,
  cantinaContact,
  docksideSweep,
  customsAudit,
  harbourFavor,
  measles,
  barBrawl,
  strayCat,
  cardGame,
  layLow,
  cargoWatch,
  fellowTraders,
  // bookend-only modules (no dice of their own — the settles/intents author the facts)
  course,
  trade,
  // orbit (at anchor in your own ship — restful, but the stories are ship-scoped)
  anchorWatch,
  // transit (an event's `context` decides where it can roll; default is 'dock')
  debrisFind,
  pirateShadow,
  voidChatter,
  // the data-driven pool (src/data/vignettes.json) — one resolver, three context events
  vignettes,
];

// The data-driven pool's surface (rows + gate check) — for tests, tooling, the admin UI.
export { VIGNETTES, vignetteEligible } from './vignettes';
export type { VignetteRow, VignetteGate, VignetteEffect } from './vignettes';

/** All beat events across the registry, in stable order. */
export const IDLE_EVENTS: IdleEvent[] = IDLE_MODULES.flatMap((m) => m.events ?? []);

/** The dock-beat pool (the default context). */
export const DOCK_EVENTS: IdleEvent[] = IDLE_EVENTS.filter((e) => (e.context ?? 'dock') === 'dock');

/** The at-anchor pool — rolled while riding in orbit, undocked, above an inhabited world. */
export const ORBIT_EVENTS: IdleEvent[] = IDLE_EVENTS.filter((e) => e.context === 'orbit');

/** The in-transit pool — rolled by settleTransit between worlds. */
export const TRANSIT_EVENTS: IdleEvent[] = IDLE_EVENTS.filter((e) => e.context === 'transit');

/** Condition definitions by id, across the registry. */
export const CONDITION_DEFS: Record<string, IdleCondition> = Object.fromEntries(
  IDLE_MODULES.flatMap((m) => m.conditions ?? []).map((c) => [c.id, c]),
);

const MODULE_BY_ID: Record<string, IdleModule> = Object.fromEntries(
  IDLE_MODULES.map((m) => [m.id, m]),
);

/** The templated #log line for a fact — falls back to the raw summary. */
export function factLine(fact: EventFact): string {
  const mod = MODULE_BY_ID[fact.plugin];
  return mod ? mod.line(fact) : fact.summary;
}

/** Display metadata for a condition id (HUD chips); unknown/hidden ids return null. */
export function conditionInfo(id: string): { label: string; blurb: string } | null {
  const def = CONDITION_DEFS[id];
  if (!def || !def.label) return null;
  return { label: def.label, blurb: def.blurb };
}
