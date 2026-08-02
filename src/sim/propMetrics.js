// src/sim/propMetrics.js
// The parametric decisions behind a procedural prop — pure, Three-free, and
// therefore runnable on a server that never builds a mesh.
//
// WHY THIS EXISTS: collision footprints must come from the SAME numbers the
// renderer builds geometry from, or you end up colliding with air and walking
// through trunks. A tree's trunk radius is a seeded draw inside
// src/generators/environment/tree.js, which imports Three — so sim can't ask
// it. Rather than hardcode an approximate radius here and let the two drift,
// the sampling moved DOWN into sim: `sampleTree` draws every parameter, the
// generator does nothing but turn that descriptor into meshes, and
// `treeColliderRadius` reads the trunk radius straight off it. One record
// drives both. (Same idea as the reference project's colliders reading the
// same prop table the renderer does.)
//
// The draw ORDER here is load-bearing: it is the seeded sequence that decides
// what every already-placed prop in world.json looks like. Reordering a draw
// silently reshapes the whole forest. Add new draws at the END of a sampler.
//
// Rock is asymmetric on purpose: its only sim-relevant parameter (baseRadius)
// is its FIRST draw, and its later draws are per-vertex jitter over a Three
// icosahedron whose vertex count sim has no business knowing. So `sampleRock`
// draws just that one value and the generator continues on the same rng.
import { range, rangeInt, pick, chance } from './rng.js';

// Palettes are plain data (hex ints), not rendering, and they live here
// because picking from them consumes rng draws in the middle of the sequence.
export const TRUNK_COLORS = [0x5a3d2b, 0x6b4a34, 0x4a3320];
export const LEAF_COLORS = [0x2f6b2f, 0x3f7a3f, 0x2a5c2a, 0x4a7a2f];

// Round-canopy trees (type: 'round') are rendered by the "fluffy" blob-canopy
// generator (src/generators/environment/fluffyTree.js) as of 2026-07-17,
// which builds a real trunk at world scale — so round trees now use the
// shared trunkRadius draw below (0.22-0.42) directly, same as conifers, and
// there's no special override. (These EZ_TREE_* constants are retained only
// so the now-unused ezTree.js still imports cleanly; nothing in the live
// path reads them.)
export const EZ_TREE_SCALE = 0.12;
export const EZ_TREE_TRUNK_RADIUS = 1 * EZ_TREE_SCALE;

/**
 * @typedef {Object} TreeDescriptor
 * @property {'conifer'|'round'} type
 * @property {number} trunkHeight
 * @property {number} trunkRadius     the collision footprint (canopies don't block)
 * @property {number} trunkColor
 * @property {number} leafColor
 * @property {Array<{h:number, radius:number}>} [tiers]    conifer canopy, bottom-up
 * @property {number} [baseY]                              round canopy
 * @property {Array<{r:number,x:number,y:number,z:number,tint:number}>} [clumps]
 * @property {Array<{x:number,y:number,z:number}>} [lobes] round canopy — one branch target per lobe
 * @property {number|null} rotationY  extra yaw, or null when the seed didn't roll one
 * @property {number} scale           the tree's own scale; a prop's explicit `scale` overrides it
 */

/**
 * Draw every parameter of a tree from `rng`, in the order the generator has
 * always drawn them. Takes an rng (not a seed) so the generator and the
 * collision builder share one definition of the sequence.
 * @param {() => number} rng
 * @param {{ type?: 'conifer'|'round'|'random' }} [options]
 * @returns {TreeDescriptor}
 */
export function sampleTree(rng, options = {}) {
  const type = options.type === 'random' || !options.type
    ? pick(rng, ['conifer', 'round'])
    : options.type;

  const trunkHeight = range(rng, 1.6, 3.2);
  const trunkRadius = range(rng, 0.22, 0.42);
  const trunkColor = pick(rng, TRUNK_COLORS);
  const leafColor = pick(rng, LEAF_COLORS);

  const d = { type, trunkHeight, trunkRadius, trunkColor, leafColor };

  if (type === 'conifer') {
    const tierCount = rangeInt(rng, 2, 3);
    let radius = range(rng, 1.3, 1.8);
    d.tiers = [];
    for (let i = 0; i < tierCount; i++) {
      d.tiers.push({ h: range(rng, 1.4, 2.2), radius });
      radius *= 0.72;
    }
  }
  // Round canopy draws nothing extra here — fluffyTree.js reads trunkHeight/
  // trunkRadius/leafColor off `d` and continues drawing its own canopy jitter
  // from the same rng afterwards (client-only; doesn't affect collision).

  d.rotationY = chance(rng, 0.3) ? range(rng, 0, Math.PI * 2) : null;
  d.scale = range(rng, 0.85, 1.25);
  return d;
}

/**
 * A rock's base radius — its first and only sim-relevant draw. The generator
 * keeps drawing (vertex jitter, color, rotation) from the same rng afterwards.
 * @param {() => number} rng
 * @param {{ radius?: number }} [options]
 */
export function sampleRock(rng, options = {}) {
  return { baseRadius: options.radius ?? range(rng, 0.6, 1.6) };
}
