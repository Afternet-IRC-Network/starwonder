#!/usr/bin/env node
/**
 * Regenerates src/data/world-names.json — the pool of real, public-domain world
 * names the engine draws on for planets and stations. (We don't name stars or
 * sectors; a sector is its address.)
 *
 * Source: the JPL Small-Body Database — every numbered minor planet that has been
 * given an adopted name (~30k). These are overwhelmingly mythological/classical
 * one-word names (Ceres, Pallas, Psyche, Vesta…) that read perfectly as worlds.
 * Kept in catalog-number order, so the famous low-numbered worlds lead and the
 * runtime can grade fame by distance from Sol.
 *
 * Run:  node scripts/build-names.mjs   (or: pnpm --filter @starwonder/game-core build-names)
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, '.cache');
const OUT = join(HERE, '..', 'src', 'data', 'world-names.json');

// name|DF = "name field is defined" — i.e. only minor planets that have a name.
const SOURCE =
  'https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=name&sb-cdata=%7B%22AND%22%3A%5B%22name%7CDF%22%5D%7D';

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Fetch the source into the cache once; reuse thereafter so the build is offline. */
async function ensureCached() {
  await mkdir(CACHE, { recursive: true });
  const path = join(CACHE, 'asteroids.json');
  if (await exists(path)) return path;
  process.stdout.write('downloading asteroids.json …\n');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`${SOURCE} → HTTP ${res.status}`);
  await writeFile(path, Buffer.from(await res.arrayBuffer()));
  return path;
}

async function main() {
  const path = await ensureCached();
  const j = JSON.parse(await readFile(path, 'utf8'));

  const seen = new Set();
  const names = [];
  for (const [name] of j.data) {
    const s = (name || '').trim();
    // Keep clean single-word names; drop "van Gogh", hyphenated, designations.
    if (!/^[A-Z][a-z]{2,15}$/.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    names.push(s); // preserve catalog-number order (≈ fame)
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(names, null, 0) + '\n');
  process.stdout.write(`wrote ${names.length} world names → src/data/world-names.json\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
