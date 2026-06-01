import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { generateGalaxy, withDefaults, N, DEFAULT_ENERGY } from '@starwonder/game-core';
import { bigBangInput, configPutInput } from '@starwonder/shared';
import { db, schema } from '../db';
import { getWorld, invalidateWorldCache } from '../galaxy';
import { getSession, loadUser, defaultShip } from '../session';
import { allConfig, setConfig, isConfigKey } from '../config';

// Resolve the caller's user iff they're an admin, else send 401/403 and return null.
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<number | null> {
  const s = await getSession(req);
  if (!s) {
    reply.code(401).send({ error: 'not authenticated' });
    return null;
  }
  const user = loadUser(s.uid);
  if (!user?.isAdmin) {
    reply.code(403).send({ error: 'admin only' });
    return null;
  }
  return s.uid;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // Full seed + settings — admin only (the Explorer computes the galaxy client-side).
  app.get('/api/admin/universe', async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const w = getWorld();
    if (!w) return reply.code(503).send({ error: 'no universe' });
    return { seed: w.seed, settings: w.settings, reachable: w.galaxy.reachable, size: N };
  });

  app.get('/api/admin/config', async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    return { config: allConfig() };
  });

  app.put('/api/admin/config', async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;
    const body = configPutInput.parse(req.body);
    if (!isConfigKey(body.key)) return reply.code(400).send({ error: 'unknown config key' });
    setConfig(body.key, body.value);
    return { config: allConfig() };
  });

  app.post('/api/admin/big-bang', async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;

    const body = bigBangInput.parse(req.body);
    const settings = withDefaults(body.seed, {
      inhabitedProb: body.inhabitedProb,
      laneP: body.laneP,
      coreBias: body.coreBias,
      habitationFalloff: body.habitationFalloff,
      wormholeCount: body.wormholeCount,
    });

    // Sanity check: galaxy must be big enough to be playable
    const g = generateGalaxy(settings);
    if (g.reachable < N * 0.3) {
      return reply.code(422).send({
        error: `galaxy too small: only ${g.reachable}/${N} sectors reachable from Sol — try a different seed or increase lane probability`,
      });
    }

    // A Big Bang is a full reset applied atomically. The old world (definition + sparse
    // overrides + stations + per-trader knowledge) is wiped and a new one created. User
    // ACCOUNTS and trader identities are kept, but every trader's progress resets to a
    // fresh start at Sol. Config knobs are deliberately preserved.
    const now = Date.now();
    const ship = defaultShip();
    db.transaction((tx) => {
      tx.delete(schema.world).run();
      tx.delete(schema.sectorState).run();
      tx.delete(schema.stations).run();
      tx.delete(schema.traderVisited).run();
      tx.delete(schema.traderWormholes).run();

      tx.insert(schema.world)
        .values({ id: 1, seed: settings.seed, settings, createdAt: now })
        .run();

      // establish Sol / Earth as the home system
      tx.insert(schema.sectorState)
        .values({
          sectorId: 0,
          data: { name: 'Sol', systemName: 'Sol', type: 'home', special: true, inhabited: true },
        })
        .run();

      // reset every trader to a fresh start and re-seed their visited set with Sol
      tx.update(schema.traders)
        .set({
          credits: 1000,
          energy: DEFAULT_ENERGY.cap,
          energyUpdatedAt: now,
          currentSector: 0,
          ship,
        })
        .run();
      for (const t of tx.select().from(schema.traders).all()) {
        tx.insert(schema.traderVisited).values({ traderId: t.id, sectorId: 0 }).run();
      }
    });

    invalidateWorldCache();
    const w = getWorld()!;
    app.log.info(`Big Bang: "${w.seed}" — ${w.galaxy.reachable}/${N} sectors reachable`);

    return { seed: w.seed, settings: w.settings, reachable: w.galaxy.reachable, size: N };
  });

  // Delete the world without creating a new one — leaves the game in a "no universe"
  // state, ready for a fresh Big Bang. Wipes overrides / stations / knowledge and resets
  // traders. Config knobs are preserved.
  app.post('/api/admin/clear', async (req, reply) => {
    if ((await requireAdmin(req, reply)) === null) return;

    const now = Date.now();
    const ship = defaultShip();
    db.transaction((tx) => {
      tx.delete(schema.world).run();
      tx.delete(schema.sectorState).run();
      tx.delete(schema.stations).run();
      tx.delete(schema.traderVisited).run();
      tx.delete(schema.traderWormholes).run();
      tx.update(schema.traders)
        .set({ credits: 1000, energy: DEFAULT_ENERGY.cap, energyUpdatedAt: now, currentSector: 0, ship })
        .run();
    });

    invalidateWorldCache();
    app.log.info('Universe cleared by admin — no active universe');
    return { ok: true };
  });
}
