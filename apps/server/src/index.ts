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
import { getActiveUniverse } from './galaxy';

const app = Fastify({ logger: true });

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

// In production the server also serves the built Vue app. In dev, Vite serves the
// frontend and proxies /api here, so this block is simply skipped.
const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
if (existsSync(webDist)) {
  await app.register(fstatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith('/api')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });
}

// Ensure an active universe exists (and warm the galaxy cache) before accepting traffic.
const u = getActiveUniverse();
app.log.info(`universe #${u.id} "${u.seed}" — ${u.galaxy.reachable}/1024 sectors reachable`);

await app.listen({ port: env.PORT, host: '0.0.0.0' });
