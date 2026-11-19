/**
 * mulberry32: a tiny 32-bit generator. It uses only 32-bit integer arithmetic, so the C# and C++
 * ports of the level generator can reproduce the same sequence.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mix a seed, a level number and an attempt number into one 32-bit seed. */
export function mixSeed(seed: number, index: number, attempt: number): number {
  return (Math.imul(seed | 0, 73856093) ^ Math.imul(index | 0, 19349663) ^ Math.imul(attempt | 0, 83492791)) >>> 0;
}

export const range = (rng: Rng, lo: number, hi: number) => lo + (hi - lo) * rng();

/** Roughly normal with unit variance: the sum of four uniforms, rescaled. Cheap and portable. */
export function gaussian(rng: Rng): number {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508075688772;
}
