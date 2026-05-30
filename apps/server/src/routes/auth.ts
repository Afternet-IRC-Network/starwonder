import type { FastifyInstance, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { hash, verify } from '@node-rs/argon2';
import { registerInput, loginInput, type MeResponse } from '@starwonder/shared';
import { currentEnergy, DEFAULT_ENERGY } from '@starwonder/game-core';
import { db, schema } from '../db';
import { env } from '../env';
import { getActiveUniverse } from '../galaxy';

const COOKIE = 'sw_session';

function setSession(app: FastifyInstance, reply: FastifyReply, playerId: number): void {
  const token = app.jwt.sign({ pid: playerId });
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.COOKIE_SECURE,
    maxAge: 60 * 60 * 24 * 30,
  });
}

// Load the player, settle lazy energy regen back to the DB, and return the public shape.
function meFor(playerId: number): MeResponse | null {
  const p = db.select().from(schema.players).where(eq(schema.players.id, playerId)).get();
  if (!p) return null;
  const e = currentEnergy({ value: p.energy, updatedAt: p.energyUpdatedAt });
  if (e.value !== p.energy || e.updatedAt !== p.energyUpdatedAt) {
    db.update(schema.players)
      .set({ energy: e.value, energyUpdatedAt: e.updatedAt })
      .where(eq(schema.players.id, playerId))
      .run();
  }
  return {
    id: p.id,
    handle: p.handle,
    credits: p.credits,
    energy: e.value,
    energyCap: DEFAULT_ENERGY.cap,
    currentSector: p.currentSector,
    isAdmin: p.id === 1,
    universeExists: getActiveUniverse() !== null,
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (req, reply) => {
    const body = registerInput.parse(req.body);
    if (body.gate !== env.GATE_PASSWORD) {
      return reply.code(403).send({ error: 'incorrect gate password' });
    }
    const existing = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.handle, body.handle))
      .get();
    if (existing) return reply.code(409).send({ error: 'handle already taken' });

    const passwordHash = await hash(body.password);
    const now = Date.now();
    const p = db
      .insert(schema.players)
      .values({
        handle: body.handle,
        authProvider: 'local',
        passwordHash,
        credits: 1000,
        energy: DEFAULT_ENERGY.cap,
        energyUpdatedAt: now,
        currentSector: 0,
        createdAt: now,
      })
      .returning()
      .get();

    setSession(app, reply, p.id);
    return meFor(p.id);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = loginInput.parse(req.body);
    const p = db
      .select()
      .from(schema.players)
      .where(eq(schema.players.handle, body.handle))
      .get();
    if (!p || !p.passwordHash) return reply.code(401).send({ error: 'bad credentials' });
    const ok = await verify(p.passwordHash, body.password);
    if (!ok) return reply.code(401).send({ error: 'bad credentials' });
    setSession(app, reply, p.id);
    return meFor(p.id);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'not authenticated' });
    }
    const pid = (req.user as { pid: number }).pid;
    const me = meFor(pid);
    if (!me) return reply.code(401).send({ error: 'player not found' });
    return me;
  });
}
