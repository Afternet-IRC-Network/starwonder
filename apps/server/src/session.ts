import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { currentEnergy, DEFAULT_ENERGY } from '@starwonder/game-core';
import type { MeResponse, ShipData } from '@starwonder/shared';
import { db, schema } from './db';
import { env } from './env';
import { getConfig } from './config';
import { getWorld } from './galaxy';

const COOKIE = 'sw_session';

// What we sign into the session cookie: the account + which trader is currently active.
export interface SessionClaims {
  uid: number;
  activeTraderId: number | null;
}

export function signSession(app: FastifyInstance, reply: FastifyReply, claims: SessionClaims): void {
  const token = app.jwt.sign(claims);
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.COOKIE_SECURE,
    maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' });
}

// Verify the cookie and return the claims, or null if unauthenticated.
export async function getSession(req: FastifyRequest): Promise<SessionClaims | null> {
  try {
    await req.jwtVerify();
  } catch {
    return null;
  }
  return req.user as SessionClaims;
}

export type TraderRow = typeof schema.traders.$inferSelect;
export type UserRow = typeof schema.users.$inferSelect;

export function loadUser(uid: number): UserRow | undefined {
  return db.select().from(schema.users).where(eq(schema.users.id, uid)).get();
}

// The active trader, verified to belong to the session's user. null if none selected or
// it doesn't belong to the caller.
export function loadActiveTrader(s: SessionClaims | null): TraderRow | null {
  if (!s || s.activeTraderId == null) return null;
  const t = db.select().from(schema.traders).where(eq(schema.traders.id, s.activeTraderId)).get();
  if (!t || t.userId !== s.uid) return null;
  return t;
}

export function visitedSet(traderId: number): Set<number> {
  const rows = db
    .select()
    .from(schema.traderVisited)
    .where(eq(schema.traderVisited.traderId, traderId))
    .all();
  return new Set(rows.map((r) => r.sectorId));
}

export function takenWormholes(traderId: number): Set<string> {
  const rows = db
    .select()
    .from(schema.traderWormholes)
    .where(eq(schema.traderWormholes.traderId, traderId))
    .all();
  return new Set(rows.map((r) => `${r.aSector}-${r.bSector}`));
}

// A fresh trader's ship — hold size from the live config knob, empty cargo.
export function defaultShip(): ShipData {
  return { holdSize: getConfig('default_hold_size'), cargo: {} };
}

export function shipOf(t: TraderRow): ShipData {
  return (t.ship as ShipData | null) ?? defaultShip();
}

// Build the /api/me payload. Settles the ACTIVE trader's lazy energy back to the DB; the
// picker list shows each trader's current energy without persisting it.
export function buildMe(uid: number, activeTraderId: number | null): MeResponse | null {
  const user = loadUser(uid);
  if (!user) return null;

  const rows = db.select().from(schema.traders).where(eq(schema.traders.userId, uid)).all();

  let activeTrader: MeResponse['activeTrader'] = null;
  const active = activeTraderId != null ? rows.find((r) => r.id === activeTraderId) : undefined;
  if (active) {
    const e = currentEnergy({ value: active.energy, updatedAt: active.energyUpdatedAt });
    if (e.value !== active.energy || e.updatedAt !== active.energyUpdatedAt) {
      db.update(schema.traders)
        .set({ energy: e.value, energyUpdatedAt: e.updatedAt })
        .where(eq(schema.traders.id, active.id))
        .run();
    }
    activeTrader = {
      id: active.id,
      name: active.name,
      credits: active.credits,
      energy: e.value,
      energyCap: DEFAULT_ENERGY.cap,
      currentSector: active.currentSector,
      ship: shipOf(active),
    };
  }

  return {
    user: { id: user.id, username: user.username, isAdmin: user.isAdmin },
    traders: rows.map((t) => ({
      id: t.id,
      name: t.name,
      currentSector: t.currentSector,
      credits: t.credits,
    })),
    activeTrader,
    universeExists: getWorld() !== null,
  };
}
