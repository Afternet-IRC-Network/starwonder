import type { FastifyInstance } from 'fastify';
import { eq, and } from 'drizzle-orm';
import {
  existingSectors, sectorView, N,
  generatePlanet, generateStation,
} from '@starwonder/game-core';
import { db, schema } from '../db';
import { getActiveUniverse } from '../galaxy';

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/universe', async (_req, reply) => {
    const u = getActiveUniverse();
    if (!u) return reply.code(503).send({ error: 'no universe — admin must run Big Bang first' });
    return { id: u.id, seed: u.seed, settings: u.settings, reachable: u.galaxy.reachable, size: N };
  });

  app.get('/api/map', async (_req, reply) => {
    const u = getActiveUniverse();
    if (!u) return reply.code(503).send({ error: 'no universe' });
    return { sectors: existingSectors(u.galaxy) };
  });

  app.get('/api/sector/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 0 || id >= N) {
      return reply.code(400).send({ error: 'bad sector id' });
    }
    const u = getActiveUniverse();
    if (!u) return reply.code(503).send({ error: 'no universe' });

    // Algorithm baseline — sector geometry + connectivity
    const base = sectorView(u.galaxy, id);

    // Algorithm baseline — sector content (planet + station) for inhabited sectors
    const planet  = base.inhabited ? generatePlanet(u.settings.seed, id, base.rimT)  : undefined;
    const station = base.inhabited ? generateStation(u.settings.seed, id, base.rimT) : undefined;

    // Load any DB overrides for this sector
    const override = db
      .select()
      .from(schema.sectorState)
      .where(and(eq(schema.sectorState.universeId, u.id), eq(schema.sectorState.sectorId, id)))
      .get();

    if (!override) {
      return { ...base, planet, station };
    }

    // Deep-merge: planet/station fields are merged individually so a DB override
    // only needs to specify the fields that diverge from the baseline.
    const { planet: pOvr, station: sOvr, ...topOvr } = override.data as Record<string, unknown>;
    return {
      ...base,
      planet:  planet  ? { ...planet,  ...(pOvr as object ?? {}) } : undefined,
      station: station ? { ...station, ...(sOvr as object ?? {}) } : undefined,
      ...topOvr,
    };
  });
}
