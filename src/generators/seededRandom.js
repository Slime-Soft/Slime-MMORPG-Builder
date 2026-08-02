// src/generators/seededRandom.js
// The generators' seeded-random surface. The implementation lives in
// src/sim/rng.js — sim needs the identical draw sequence to derive collision
// footprints (src/sim/propMetrics.js) without importing a Three-dependent
// generator, and two copies of a PRNG is one copy too many.
export { createRng, range, rangeInt, pick, chance } from '../sim/rng.js';
