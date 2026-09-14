/**
 * A seeded stream, so a course is a course rather than a surprise: the same
 * seed lays down the same slabs, the same gaps and the same agents every time.
 * mulberry32 — small, fast, and good enough for level furniture.
 */
export function createRng(seed = 1) {
  let a = (seed >>> 0) || 0x9e3779b9;

  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function intBelow(rng, n) {
  return Math.min(n - 1, Math.floor(rng() * n));
}

export function pick(rng, list) {
  return list[intBelow(rng, list.length)];
}
