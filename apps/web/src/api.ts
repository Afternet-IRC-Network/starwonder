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
  wormholeExits: WormholeExit[];
  // Procedural content (present when inhabited)
  planet?: PlanetData;
  station?: StationData;
  market?: MarketEntry[];
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

export interface TradeResult {
  trader: { credits: number; ship: ShipData };
  market: MarketEntry[];
}

async function json<T>(res: Response): Promise<T> {
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
    return res.ok ? ((await res.json()) as MeResponse) : null;
  },
  register: (b: { gate: string; username: string; password: string }) =>
    post('/api/auth/register', b).then(json<MeResponse>),
  login: (b: { username: string; password: string }) =>
    post('/api/auth/login', b).then(json<MeResponse>),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),

  createTrader: (name: string) => post('/api/traders', { name }).then(json<MeResponse>),
  selectTrader: (id: number) => post(`/api/traders/${id}/select`, {}).then(json<MeResponse>),

  universe: () => fetch('/api/universe').then(json<UniverseInfo>),
  sector: (id: number) => fetch(`/api/sector/${id}`).then(json<SectorView>),
  map: () => fetch('/api/map').then(json<MapResponse>),
  move: (body: { to: number } | { wormhole: number }) => post('/api/move', body).then(json<MoveResult>),
  trade: (body: { action: 'buy' | 'sell'; commodity: string; qty: number }) =>
    post('/api/trade', body).then(json<TradeResult>),

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
