import { eq } from 'drizzle-orm';
import { db, schema } from './db';

// ── Config registry ─────────────────────────────────────────────────────────
//
// Every valid operational knob is pre-declared here with its metadata. Access is gated
// through this lookup: a key with no DB row resolves to its default; setting a key upserts
// a row. New knobs are added by editing this table alone (the single source of truth) —
// see docs/0-Projects/0_universeconfig.md.

interface ConfigSpec {
  type: 'int' | 'float';
  default: number;
  description: string;
}

export const CONFIG_SPEC = {
  trader_cap:             { type: 'int',   default: 5,    description: 'Maximum traders per user' },
  move_energy_cost:       { type: 'int',   default: 1,    description: 'Energy spent per lane jump' },
  wormhole_cost_per_dist: { type: 'float', default: 1.0,  description: 'Wormhole energy per unit span (short-jump rate)' },
  wormhole_cost_cap:      { type: 'int',   default: 20,   description: 'Wormhole energy soft cap (long-jump ceiling)' },
  gradient_strength:      { type: 'float', default: 0.5,  description: 'Core↔rim price tilt (k)' },
  trade_spread:           { type: 'float', default: 0.10, description: 'Buy/sell margin fraction' },
  trade_energy_per_unit:  { type: 'float', default: 2,    description: 'Energy per ton moved by a trade order (energy is the work clock)' },
  default_hold_size:      { type: 'int',   default: 20,   description: 'Starting cargo hold size (tons)' },
  // Idle narrative (docs/0-Projects/starwonder-mvp/idle-narrative.md §9)
  idle_beat_minutes:      { type: 'int',   default: 30,   description: 'Docked minutes per idle beat' },
  idle_beat_cap:          { type: 'int',   default: 16,   description: 'Max idle beats settled per catch-up (anti-FOMO)' },
  idle_quiet_weight:      { type: 'float', default: 30,   description: 'Weight of the "nothing happened" idle beat' },
  idle_credit_cap:        { type: 'int',   default: 600,  description: 'Per-dock-session net credit swing rail' },
  idle_standing_cap:      { type: 'int',   default: 8,    description: 'Per-dock-session net standing swing rail' },
  idle_narrate:           { type: 'int',   default: 1,    description: 'AI narration master switch (0 = templated only)' },
  arrival_announce_minutes: { type: 'int', default: 3,    description: 'Stay length before the IRC "made port" line (debounces hop-around chatter)' },
  heat_decay_per_hour:    { type: 'float', default: 0.5,  description: 'Lazy decay of law heat per hour' },
  standing_decay_per_day: { type: 'float', default: 0.25, description: 'Drift of station standing toward neutral per day' },
} as const satisfies Record<string, ConfigSpec>;

export type ConfigKey = keyof typeof CONFIG_SPEC;

export function isConfigKey(k: string): k is ConfigKey {
  return Object.prototype.hasOwnProperty.call(CONFIG_SPEC, k);
}

function coerce(spec: ConfigSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.default;
  return spec.type === 'int' ? Math.trunc(value) : value;
}

// Typed read: DB override if present, else the registry default. Coerced per-key so call
// sites get a real number and bad rows fail safe to the default.
export function getConfig(key: ConfigKey): number {
  const spec = CONFIG_SPEC[key];
  const row = db.select().from(schema.config).where(eq(schema.config.key, key)).get();
  if (!row) return spec.default;
  const n = Number(row.value);
  return coerce(spec, n);
}

export function setConfig(key: ConfigKey, value: number): void {
  const v = coerce(CONFIG_SPEC[key], value);
  db.insert(schema.config)
    .values({ key, value: String(v) })
    .onConflictDoUpdate({ target: schema.config.key, set: { value: String(v) } })
    .run();
}

export interface ConfigEntry {
  key: ConfigKey;
  value: number;
  default: number;
  type: 'int' | 'float';
  description: string;
}

// The whole knob set with current + default values — for the admin settings panel.
export function allConfig(): ConfigEntry[] {
  return (Object.keys(CONFIG_SPEC) as ConfigKey[]).map((key) => ({
    key,
    value: getConfig(key),
    default: CONFIG_SPEC[key].default,
    type: CONFIG_SPEC[key].type,
    description: CONFIG_SPEC[key].description,
  }));
}
