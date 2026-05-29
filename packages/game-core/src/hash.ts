// Deterministic hashing — ported verbatim from the map-admin.html mockup so the admin
// preview and the live engine generate pixel-identical galaxies for a given seed.
//
// FNV-1a + MurmurHash3 fmix32 finalizer. The avalanche step is essential: bare FNV-1a
// has weak avalanche on sequential keys ("…|lane|261-262", "…|262-263", …), so adjacent
// indices would get correlated hashes and threshold selections would clump.
export function fnv(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

// Small fast PRNG seeded from a 32-bit int (derive the seed via fnv()).
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform value in [0, 1) keyed by an arbitrary string. Matches the mockup's
// (fnv(key) % 100000) / 100000 quantisation exactly.
export function unit(key: string): number {
  return (fnv(key) % 100000) / 100000;
}
