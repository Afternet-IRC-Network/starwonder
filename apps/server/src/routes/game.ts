import type { FastifyInstance } from 'fastify';
import { existingSectors, sectorView, N } from '@starwonder/game-core';
import { getActiveUniverse } from '../galaxy';

export async function gameRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/universe', async () => {
    const u = getActiveUniverse();
    return {
      id: u.id,
      seed: u.seed,
      settings: u.settings,
      reachable: u.galaxy.reachable,
      size: N,
    };
  });

  // Every sector that exists (Sol's reachable set) — for the map screens.
  app.get('/api/map', async () => {
    const u = getActiveUniverse();
    return { sectors: existingSectors(u.galaxy) };
  });

  app.get('/api/sector/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id < 0 || id >= N) {
      return reply.code(400).send({ error: 'bad sector id' });
    }
    const u = getActiveUniverse();
    return sectorView(u.galaxy, id);
  });
}
