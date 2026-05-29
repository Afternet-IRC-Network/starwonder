import type { MeResponse } from '@starwonder/shared';

export interface SectorView {
  id: number;
  exists: boolean;
  addr: string;
  region: number;
  x: number;
  y: number;
  inhabited: boolean;
  rimT: number;
  danger: number;
  dangerTier: 'peaceful' | 'medium' | 'dangerous' | 'very-dangerous';
  jumpsFromSol: number;
  neighbors: number[];
  wormholes: number[];
}

export interface UniverseInfo {
  id: number;
  seed: string;
  reachable: number;
  size: number;
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

export const api = {
  async me(): Promise<MeResponse | null> {
    const res = await fetch('/api/auth/me');
    return res.ok ? ((await res.json()) as MeResponse) : null;
  },
  register: (b: { gate: string; handle: string; password: string }) =>
    post('/api/auth/register', b).then(json<MeResponse>),
  login: (b: { handle: string; password: string }) =>
    post('/api/auth/login', b).then(json<MeResponse>),
  logout: () => fetch('/api/auth/logout', { method: 'POST' }),
  universe: () => fetch('/api/universe').then(json<UniverseInfo>),
  sector: (id: number) => fetch(`/api/sector/${id}`).then(json<SectorView>),
  map: () => fetch('/api/map').then(json<{ sectors: SectorView[] }>),
};
