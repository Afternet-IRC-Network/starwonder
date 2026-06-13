import type { MeResponse, ShipData } from '@starwonder/shared';
import type {
  PlanetData,
  StationData,
  GalaxySettings,
  MapView,
  MapPlanet,
  MarketEntry,
  WormholeExit,
} from '@starwonder/game-core';

export type { PlanetData, StationData, MapView, MapPlanet, MarketEntry, ShipData, MeResponse };

/** A market entry as THIS trader sees it — `nudge` present when a rumour/condition skews the price. */
export type MarketEntryView = MarketEntry & {
  nudge?: { pct: number; expiresAt: number | null };
};

/** A wormhole exit as the trader knows it — `planet` rides along once the far end is
    charted (taking a wormhole visits it), mirroring the lane chips. */
export type WormholeExitView = WormholeExit & { planet?: MapPlanet };

/** A lane destination as the trader knows it — for the warp-lane chips on the sector screen. */
export interface LaneView {
  id: number;
  /** has the trader been to this neighbour before? */
  visited: boolean;
  /** the world there — present only for visited *inhabited* neighbours */
  planet?: MapPlanet;
}

export interface SectorView {
  id: number;
  exists: boolean;
  addr: string;
  x: number;
  y: number;
  inhabited: boolean;
  rimT: number;
  danger: number;
  dangerTier: 'peaceful' | 'medium' | 'dangerous' | 'very-dangerous';
  jumpsFromSol: number;
  /** lane destinations — always visible */
  neighbors: number[];
  /** lane destinations enriched with what the trader knows (name/look if visited) */
  lanes?: LaneView[];
  /** wormholes here; `to` is null until this trader has taken it (blind jump via `ref`) */
  wormholeExits: WormholeExitView[];
  // Procedural content (present when inhabited)
  planet?: PlanetData;
  station?: StationData;
  market?: MarketEntryView[];
  /** other traders parked in this sector right now — the "also here" roster */
  traders?: TraderHere[];
  // DB overlay fields
  name?: string;
  systemName?: string;
  type?: string;
  special?: boolean;
}

/** A trader present in a sector — name seeds its ship-icon look client-side. */
export interface TraderHere {
  id: number;
  name: string;
}

/** sectorId → count of traders present there (the map's "players here" marker). */
export type PresenceMap = Record<number, number>;

/** The player map: the fogged view plus where other traders are in charted space. */
export type MapResponse = MapView & { presence: PresenceMap };

export interface UniverseInfo {
  exists: boolean;
  /** lane cost only — wormhole cost is per-span and rides each WormholeExit / MapEdge */
  costs: { move: number };
}

export interface AdminUniverseInfo {
  seed: string;
  settings: GalaxySettings;
  reachable: number;
  size: number;
}

export interface AdminTrader {
  id: number;
  name: string;
  credits: number;
  energy: number;
  energyCap: number;
  currentSector: number;
  holdUsed: number;
  holdSize: number;
  createdAt: number;
}

export interface AdminUser {
  id: number;
  username: string;
  isAdmin: boolean;
  createdAt: number;
  traders: AdminTrader[];
}

export interface ConfigEntry {
  key: string;
  value: number;
  default: number;
  type: string;
  description: string;
}

export interface MoveResult {
  /** true when this move was the trader's first-ever arrival at `sector` */
  discovered: boolean;
  trader: { currentSector: number; energy: number; energyCap: number; energyUpdatedAt: number; credits: number; ship: ShipData };
  sector: SectorView;
}

/** The live trade order as the dock UI shows it; nextFillAt/etaAt are regen projections. */
export interface OrderView {
  sectorId: number;
  side: 'buy' | 'sell';
  commodity: string;
  qty: number;
  filled: number;
  /** running average price per ton (0 until the first fill) */
  avg: number;
  limit: number | null;
  placedAt: number;
  nextFillAt: number | null;
  etaAt: number | null;
}

/** Returned by both order intents: the (possibly burst-filled) trader + order + prices. */
export interface OrderResult {
  trader: { credits: number; ship: ShipData; energy: number; energyCap: number; energyUpdatedAt: number };
  order: OrderView | null;
  market: MarketEntryView[];
}

// ── Idle narrative (downtime — docked, in transit, or adrift) ─────────────────

export interface IdleEventView {
  id: number;
  at: number;
  sectorId: number;
  line: string;
  summary: string;
  plugin: string;
}

export interface IdleConditionView {
  id: string;
  since: number;
  label: string;
  blurb: string;
}

export interface GoalView {
  kind: string;
  target?: string;
  blurb?: string;
}

/** A plotted course in flight, as the downtime view reports it. Energy is the flight
    clock: nextHopAt/etaAt are regen projections, not a fixed cadence. */
export interface CourseView {
  path: number[];
  leg: number;
  destination: { id: number; name: string };
  hopsRemaining: number;
  nextHopAt: number | null;
  etaAt: number | null;
}

export type IdleMode = 'dock' | 'orbit' | 'transit' | 'adrift';

export interface IdleView {
  mode: IdleMode;
  goalKinds: string[];
  goal: GoalView | null;
  heat: number;
  conditions: IdleConditionView[];
  currentSector: number;
  narrative: string;
  /** the exact prompt that WOULD be sent to the narrator model (no API key yet) */
  narratePrompt: string | null;
  /** this session's events, newest first */
  events: IdleEventView[];
  // dock / orbit (stationary downtime — docked at the station, or at anchor above it)
  sectorId?: number;
  stationName?: string;
  planetName?: string;
  vibe?: string;
  sessionStartedAt?: number;
  beatMinutes?: number;
  standing?: number;
  /** the working trade order (dock mode; null/absent when none) */
  order?: OrderView | null;
  // transit
  course?: CourseView;
}

export interface LogEventView {
  id: number;
  at: number;
  sectorId: number;
  station: string;
  line: string;
}

// ── Version freshness ─────────────────────────────────────────────────────────
// Every API response carries x-starwonder-version (the server's build/boot stamp). The
// first value seen becomes this page's baseline; if any later response differs, the
// server was redeployed under us — notify the app so it can reload off the stale bundle.
let pageVersion: string | null = null;
let onStale: (() => void) | null = null;

/** Register the single "a newer build is live" callback (App.vue). */
export function onVersionChange(cb: () => void): void {
  onStale = cb;
}

function checkVersion(res: Response): void {
  const v = res.headers.get('x-starwonder-version');
  if (!v) return;
  if (pageVersion === null) pageVersion = v;
  else if (v !== pageVersion) onStale?.();
}

async function json<T>(res: Response): Promise<T> {
  checkVersion(res);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? 'request failed');
  }
  return res.json() as Promise<T>;
}

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const put = (url: string, body: unknown) =>
  fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const api = {
  async me(): Promise<MeResponse | null> {
    const res = await fetch('/api/auth/me');
    checkVersion(res);
    return res.ok ? ((await res.json()) as MeResponse) : null;
  },
  register: (b: { gate: string; username: string; password: string }) =>
    post('/api/auth/register', b).then(json<MeResponse>),
  login: (b: { username: string; password: string }) =>
    post('/api/auth/login', b).then(json<MeResponse>),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),

  createTrader: (name: string, tags: string[] = [], blurb = '') =>
    post('/api/traders', { name, tags, blurb }).then(json<MeResponse>),
  selectTrader: (id: number) => post(`/api/traders/${id}/select`, {}).then(json<MeResponse>),

  // Idle narrative (downtime, wherever it's happening)
  idle: () => fetch('/api/idle').then(json<IdleView>),
  setGoal: (b: { kind: string; target?: string; blurb?: string }) =>
    post('/api/goal', b).then(json<IdleView>),
  log: (since?: number) =>
    fetch(since !== undefined ? `/api/log?since=${since}` : '/api/log').then(
      json<{ events: LogEventView[] }>,
    ),
  setCourse: (path: number[]) => post('/api/course', { path }).then(json<IdleView>),
  cancelCourse: () => fetch('/api/course', { method: 'DELETE' }).then(json<IdleView>),
  dock: () => post('/api/dock', {}).then(json<IdleView>),
  undock: () => post('/api/undock', {}).then(json<IdleView>),

  universe: () => fetch('/api/universe').then(json<UniverseInfo>),
  sector: (id: number) => fetch(`/api/sector/${id}`).then(json<SectorView>),
  /** the omniscient sector view for the Explorer — server-gated to admins */
  adminSector: (id: number) => fetch(`/api/sector/${id}?admin=1`).then(json<SectorView>),
  map: () => fetch('/api/map').then(json<MapResponse>),
  move: (body: { to: number } | { wormhole: number }) => post('/api/move', body).then(json<MoveResult>),
  placeOrder: (body: { side: 'buy' | 'sell'; commodity: string; qty: number; limit?: number }) =>
    post('/api/order', body).then(json<OrderResult>),
  cancelOrder: () => fetch('/api/order', { method: 'DELETE' }).then(json<OrderResult>),

  // Admin
  adminUniverse: () => fetch('/api/admin/universe').then(json<AdminUniverseInfo>),
  bigBang: (b: {
    seed: string;
    inhabitedProb: number;
    laneP: number;
    coreBias: number;
    habitationFalloff: number;
    wormholeCount: number;
  }) => post('/api/admin/big-bang', b).then(json<AdminUniverseInfo>),
  clearUniverse: () => post('/api/admin/clear', {}).then(json<{ ok: boolean }>),
  adminUsers: () => fetch('/api/admin/users').then(json<{ users: AdminUser[] }>),
  adminPresence: () => fetch('/api/admin/presence').then(json<{ presence: PresenceMap }>),
  adminConfig: () => fetch('/api/admin/config').then(json<{ config: ConfigEntry[] }>),
  setConfig: (key: string, value: number) =>
    put('/api/admin/config', { key, value }).then(json<{ config: ConfigEntry[] }>),
};
