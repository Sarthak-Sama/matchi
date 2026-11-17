import type { CreateRng, Rng } from './types.js';

/** Seeded generator (mulberry32) with Box-Muller normals. Same seed, same stream. */
export const createRng: CreateRng = (seed: number): Rng => {
  let state = seed >>> 0;
  let spare: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const normal = (): number => {
    if (spare !== null) {
      const z = spare;
      spare = null;
      return z;
    }
    const u = 1 - next(); // (0, 1], keeps log finite
    const v = next();
    const r = Math.sqrt(-2 * Math.log(u));
    spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  };

  return {
    next,
    normal,
    lognormal: (mu, sigma) => Math.exp(mu + sigma * normal()),
    int: (n) => Math.floor(next() * n),
  };
};
