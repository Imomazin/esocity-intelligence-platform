/**
 * Deterministic pseudo-random number generation for demo data.
 *
 * Demo datasets must be reproducible: the same seed always yields the same market paths,
 * fixtures and results, on every server, in every test run. We use the well-known
 * mulberry32 generator (32-bit state, good statistical quality for simulation purposes) and
 * a cyrb53-style string hash for seeding. Not suitable for cryptography.
 */

/** 32-bit string hash (cyrb53 folded to 32 bits). */
export function hashString(input: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Standard normal draw (Box–Muller). */
  normal(): number;
  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Pick a uniformly random element. */
  pick<T>(items: readonly T[]): T;
  /** Bernoulli trial. */
  chance(probability: number): boolean;
  /** Poisson draw (Knuth's algorithm — fine for the small lambdas used in football). */
  poisson(lambda: number): number;
}

export function createRng(seed: number | string): Rng {
  let state = typeof seed === "string" ? hashString(seed) : seed >>> 0;
  let spareNormal: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spareNormal !== null) {
      const value = spareNormal;
      spareNormal = null;
      return value;
    }
    let u = 0;
    let v = 0;
    while (u <= Number.EPSILON) u = next();
    v = next();
    const radius = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * v;
    spareNormal = radius * Math.sin(theta);
    return radius * Math.cos(theta);
  };

  return {
    next,
    normal,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    range: (min, max) => min + next() * (max - min),
    pick: (items) => {
      if (items.length === 0) throw new Error("Cannot pick from an empty list");
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    chance: (probability) => next() < probability,
    poisson: (lambda) => {
      const limit = Math.exp(-lambda);
      let k = 0;
      let product = next();
      while (product > limit) {
        k += 1;
        product *= next();
      }
      return k;
    },
  };
}
