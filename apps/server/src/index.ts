import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import fstatic from '@fastify/static';
import { ZodError } from 'zod';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { gameRoutes } from './routes/game';
import { adminRoutes } from './routes/admin';
import { idleRoutes } from './routes/idle';
import { botRoutes } from './routes/bot';
import { getWorld } from './galaxy';

const app = Fastify({ logger: true });

// Build/boot stamp, sent on every API response. The client compares it across its normal
// polling: a changed value means a redeploy (or restart) happened under the open tab, and
// the UI offers/forces a reload — nobody plays on a stale bundle. The boot time is enough:
// the web bundle is baked into the same image, so a new build always means a new boot.
const SERVER_VERSION = process.env.BUILD_ID ?? String(Date.now());
app.addHook('onSend', async (_req, reply) => {
  reply.header('x-starwonder-version', SERVER_VERSION);
});

await app.register(cookie);
await app.register(jwt, {
  secret: env.SESSION_SECRET,
  cookie: { cookieName: 'sw_session', signed: false },
});

app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
  if (err instanceof ZodError) {
    return reply.code(400).send({ error: 'validation', issues: err.issues });
  }
  req.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'internal error' });
});

app.get('/api/health', async () => ({ ok: true }));
await app.register(authRoutes);
await app.register(gameRoutes);
await app.register(adminRoutes);
await app.register(idleRoutes);
await app.register(botRoutes);

// In production the server also serves the built Vue app. In dev, Vite serves the
// frontend and proxies /api here, so this block is simply skipped.
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webDist)) {
  await app.register(fstatic, {
    root: webDist,
    cacheControl: false, // we set it ourselves below — the plugin default would override
    // index.html must always revalidate or a reload can fetch the OLD shell from the
    // browser cache and defeat the version poke; the hashed Vite assets cache forever.
    setHeaders: (res, path) => {
      res.setHeader(
        'cache-control',
        path.endsWith('.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      );
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

const w = getWorld();
if (w) {
  app.log.info(`universe "${w.seed}" — ${w.galaxy.reachable}/${1024} sectors reachable`);
} else {
  app.log.info('no active universe — admin must run Big Bang to create one');
}

await app.listen({ port: env.PORT, host: '0.0.0.0' });
