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
  default_hold_size:      { type: 'int',   default: 20,   description: 'Starting cargo hold size (tons)' },
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
