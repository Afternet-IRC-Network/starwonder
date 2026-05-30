import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { generateGalaxy, withDefaults, N } from '@starwonder/game-core';
import { bigBangInput } from '@starwonder/shared';
import { db, schema } from '../db';
import { getActiveUniverse, invalidateUniverseCache } from '../galaxy';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/admin/big-bang', async (req, reply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: 'not authenticated' });
    }
    const pid = (req.user as { pid: number }).pid;
    if (pid !== 1) return reply.code(403).send({ error: 'admin only' });

    const body = bigBangInput.parse(req.body);
    const settings = withDefaults(body.seed, {
      inhabitedProb: body.inhabitedProb,
      laneP: body.laneP,
      coreBias: body.coreBias,
      wormholeCount: body.wormholeCount,
    });

    // Sanity check: galaxy must be big enough to be playable
    const g = generateGalaxy(settings);
    if (g.reachable < N * 0.3) {
      return reply.code(422).send({
        error: `galaxy too small: only ${g.reachable}/${N} sectors reachable from Sol — try a different seed or increase lane probability`,
      });
    }

    // Retire any existing active universe
    db.update(schema.universes)
      .set({ status: 'retired' })
      .where(eq(schema.universes.status, 'active'))
      .run();

    // Create the new universe
    const row = db
      .insert(schema.universes)
      .values({ seed: settings.seed, settings, status: 'active', createdAt: Date.now() })
      .returning()
      .get();

    // Establish Sol / Earth as the home system
    db.insert(schema.sectorState)
      .values({
        universeId: row.id,
        sectorId: 0,
        data: {
          name: 'Sol',
          systemName: 'Sol',
          type: 'home',
          special: true,
          inhabited: true,
        },
      })
      .run();

    invalidateUniverseCache();
    const u = getActiveUniverse()!;
    app.log.info(`Big Bang: universe #${u.id} "${u.seed}" — ${u.galaxy.reachable}/${N} sectors reachable`);

    return {
      id: u.id,
      seed: u.seed,
      settings: u.settings,
      reachable: u.galaxy.reachable,
      size: N,
    };
  });
}
