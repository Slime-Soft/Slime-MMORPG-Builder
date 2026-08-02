// src/sim/rng.js
// The sim's only source of randomness, and the one PRNG in the project.
// `Math.random` is banned inside src/sim (enforced by
// scripts/check-architecture.mjs): a sim function that reaches for it can't be
// replayed, can't be unit-tested with a fixed outcome, and — once bot NPCs
// exist — can't be driven reproducibly.
//
// Two distinct users, one implementation:
//   - Gameplay rolls (gathering yields, NPC wander). The caller creates a
//     generator and threads it into the sim function, exactly as it already
//     threads `dt` and `now`.
//   - Asset generation (`src/generators/*`, which re-exports this file as
//     seededRandom.js). A prop placed by the World Editor with seed=1001 must
//     look identical every load, on client and server alike — and, since
//     src/sim/propMetrics.js derives collision footprints from the same draws,
//     must produce the same numbers on a server that never builds a mesh.

/**
 * mulberry32 — small, fast, well-distributed. Returns a function producing
 * floats in [0, 1), the same contract as Math.random.
 * @param {number} seed
 * @returns {() => number}
 */
export function createRng(seed) {
  let a = seed >>> 0 || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random float in [min, max) using the given rng function. */
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function rangeInt(rng, min, max) {
  return Math.floor(range(rng, min, max + 1));
}

/** Pick a random element from an array. */
export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

/** Random boolean with given probability of true (default 0.5). */
export function chance(rng, probability = 0.5) {
  return rng() < probability;
}
