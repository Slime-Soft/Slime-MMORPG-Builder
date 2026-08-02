// src/generators/environment/townDecor.js
// The props that give a city district its identity: benches and a fountain for
// the park, training dummies and weapon racks for the training quarter, arcane
// obelisks and braziers for the mage quarter, woodpiles and handcarts for the
// crafting and market quarters.
//
// All built through meshKit, so each of these is 2-5 draw calls no matter how
// many little pieces it is made of (see meshKit.js for why that matters).
//
// Conventions: front is +Z, nothing self-rotates (the author aims it), palettes
// run light, and no material uses `metalness` — there is no environment map, so
// a metallic surface renders black.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow, stripedCloth } from './meshKit.js';

const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30, 0x654626];
const STONE = [0xb4aca0, 0xc0b8ab, 0xa9a196];
const IRON = 0x6a6a74;
const STRAW = [0xd8bd77, 0xcfb069, 0xe0c684];

const M = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  stone: matte(pick(rng, STONE)),
  stoneDark: matte(0x8f877c),
  iron: metal(IRON),
  straw: matte(pick(rng, STRAW)),
  cloth: matte(0xc44a3f),
  foliage: matte(0x4f8a3f),
  ...extra,
});

// =============================================================================
// Park / street
// =============================================================================

/** A slatted bench on iron legs. */
export function generateBench(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.9;
  for (let i = 0; i < 4; i++) {
    k.box('wood', W, 0.06, 0.13, 0, 0.45, -0.21 + i * 0.145);
  }
  for (let i = 0; i < 3; i++) {
    k.box('wood', W, 0.05, 0.12, 0, 0.66 + i * 0.15, -0.28, [0.22, 0, 0]);
  }
  for (const sx of [-1, 1]) {
    k.box('iron', 0.07, 0.45, 0.07, sx * (W / 2 - 0.14), 0.225, 0.18);
    k.box('iron', 0.07, 0.45, 0.07, sx * (W / 2 - 0.14), 0.225, -0.22);
    k.box('iron', 0.07, 0.06, 0.5, sx * (W / 2 - 0.14), 0.04, -0.02);
    k.box('iron', 0.06, 0.55, 0.06, sx * (W / 2 - 0.14), 0.72, -0.28, [0.22, 0, 0]);
  }
  return k.finish(M(rng));
}

/**
 * A tiered stone fountain — the park's centrepiece.
 *
 * Rules earned the hard way here, each one a defect that shipped:
 *  - A BASIN HAS TO BE HOLLOW, and `k.cyl` cannot make it. Both earlier versions
 *    capped the basin with a full-radius cylinder as the "coping", i.e. a LID:
 *    the water, the floor and the whole interior were sealed underneath it and
 *    the fountain read as a flat plate with some stonework growing out of it.
 *    The basin and its coping ring are LatheGeometry profiles of revolution now
 *    — the only primitive here that can produce an open vessel.
 *  - EVERY water surface is INSET well below the rim that holds it. The first
 *    version's bowls were r0.95 with r0.86 of water on top, so the stone was a
 *    9cm ring nobody could see and each bowl read as a solid cyan disc.
 *  - FALLING WATER MUST TAPER HARD, and never be a box. Straight 0.08m columns
 *    read as structural posts; so do untapered cylinders. A 3:1 taper over the
 *    fall, and few wide streams rather than many thin ones, is what reads as
 *    water. (Real falling water does narrow as it accelerates.)
 */
export function generateFountain(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const SEG = 8;   // octagonal, like the rest of the town stonework

  /** A profile of revolution. Points run OUTER-BOTTOM -> up -> over the top ->
   *  down the inside -> inwards along the floor: with that ordering three.js
   *  lathes every normal facing the right way (out on the outside, up on top,
   *  in on the inside, up off the floor). Reverse it and half the vessel turns
   *  invisible, because these materials are single-sided. */
  const lathe = (key, profile) => k.raw(key, new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), SEG
  ), 0, 0, 0);

  // --- Two shallow steps of apron, so the basin rises out of the plaza ---
  k.cyl('stone', 2.70, 2.82, 0.16, SEG, 0, 0.08, 0);
  k.cyl('stoneDark', 2.52, 2.62, 0.16, SEG, 0, 0.24, 0);

  // --- Basin proper: an open vessel, floor at 0.44, rim at 0.94 ---
  lathe('stone', [
    [2.42, 0.32], [2.46, 0.86], [2.40, 0.94],   // outer wall, up to the rim
    [2.30, 0.90], [2.30, 0.52], [2.22, 0.44],   // over the rim and down the inside
    [0.74, 0.44],                               // basin floor, in to the pedestal
  ]);
  // Coping: a closed rectangular section, so it overhangs the wall both ways.
  lathe('stoneDark', [
    [2.54, 0.88], [2.54, 1.00], [2.26, 1.00], [2.26, 0.88], [2.54, 0.88],
  ]);
  k.cyl('water', 2.29, 2.29, 0.05, SEG, 0, 0.72, 0); // 28cm below the coping's top
  // A pilaster on each corner of the octagon, running up under the coping.
  for (let i = 0; i < SEG; i++) {
    const a = ((i + 0.5) / SEG) * Math.PI * 2;
    k.box('stoneDark', 0.36, 0.58, 0.26, Math.cos(a) * 2.44, 0.61, Math.sin(a) * 2.44, [0, -a, 0]);
  }

  // --- Central pedestal ---
  k.cyl('stoneDark', 0.70, 0.82, 0.24, SEG, 0, 0.54, 0); // sunk 2cm into the basin floor
  k.cyl('stone', 0.56, 0.66, 0.14, SEG, 0, 0.73, 0);
  k.cyl('stone', 0.30, 0.42, 0.62, SEG, 0, 1.11, 0);
  k.torus('stoneDark', 0.36, 0.07, 0, 1.10, 0, [Math.PI / 2, 0, 0]);

  // --- Lower bowl. A lathed PAN, not a drum: a solid cylinder would bury its
  // own water exactly the way the basin's old lid did. ---
  k.cyl('stoneDark', 0.98, 0.34, 0.17, SEG, 0, 1.465, 0);   // flared underside
  lathe('stone', [
    [0.98, 1.55], [1.10, 1.72], [1.10, 1.83],   // outside, up to the rim
    [0.98, 1.79], [0.96, 1.72], [0.30, 1.68],   // over the rim, down inside, across the pan
  ]);
  k.cyl('water', 0.94, 0.94, 0.05, SEG, 0, 1.755, 0);

  // --- Upper bowl, same construction ---
  k.cyl('stone', 0.18, 0.26, 0.44, SEG, 0, 2.05, 0);
  k.cyl('stoneDark', 0.58, 0.20, 0.14, SEG, 0, 2.33, 0);
  lathe('stone', [
    [0.58, 2.40], [0.66, 2.50], [0.66, 2.59],
    [0.58, 2.56], [0.56, 2.51], [0.18, 2.48],
  ]);
  k.cyl('water', 0.54, 0.54, 0.04, SEG, 0, 2.53, 0);
  k.sphere('water', 0.13, 0, 2.66, 0);

  /** One falling stream, plus the disc of splash where it lands. Wide where it
   *  leaves the rim and a third of that at the bottom: an untapered cylinder is
   *  a rod, not water. */
  const fall = (radius, count, phase, topY, bottomY, rTop) => {
    for (let i = 0; i < count; i++) {
      const a = ((i + phase) / count) * Math.PI * 2;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      k.cyl('water', rTop, rTop * 0.45, topY - bottomY, 6, x, (topY + bottomY) / 2, z);
      k.cyl('water', rTop * 1.6, rTop * 1.05, 0.035, SEG, x, bottomY + 0.017, z);
    }
  };
  // Upper bowl -> lower bowl (leaves the flared underside at 2.40, lands at r0.52
  // inside the lower pan's water), lower bowl -> basin.
  fall(0.52, 4, 0.5, 2.40, 1.77, 0.15);
  fall(1.02, 5, 0, 1.62, 0.735, 0.17);

  return k.finish(M(rng, {
    water: new THREE.MeshStandardMaterial({
      color: 0x7fc6de, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.85,
    }),
  }));
}

/** A planter with a small ornamental tree. */
export function generatePottedTree(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('stone', 0.52, 0.6, 0.5, 8, 0, 0.25, 0);
  k.cyl('stoneDark', 0.58, 0.56, 0.1, 8, 0, 0.5, 0);
  k.cyl('soil', 0.46, 0.46, 0.05, 8, 0, 0.52, 0);
  k.cyl('woodDark', 0.09, 0.13, 1.5, 6, 0, 1.25, 0);
  const blobs = rangeInt(rng, 4, 6);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2;
    const d = range(rng, 0.25, 0.5);
    k.ico('foliage', range(rng, 0.45, 0.62),
      Math.cos(a) * d, range(rng, 1.9, 2.35), Math.sin(a) * d, [1, 0.82, 1]);
  }
  k.ico('foliage', 0.55, 0, 2.5, 0, [1, 0.8, 1]);
  return k.finish(M(rng, { soil: matte(0x4a3a2a) }));
}

/** A low fence section, 3m wide — park edges and paddocks. */
export function generateFenceSection(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.0;
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.14, 1.15, 0.14, sx * W / 2, 0.575, 0);
    k.cone('woodDark', 0.12, 0.16, 4, sx * W / 2, 1.2, 0);
  }
  for (const y of [0.42, 0.82]) {
    k.box('wood', W, 0.11, 0.07, 0, y, 0);
  }
  return k.finish(M(rng));
}

/** A wayfinding signpost with directional arms. */
export function generateSignpost(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('stone', 0.22, 0.28, 0.2, 8, 0, 0.1, 0);
  k.cyl('woodDark', 0.09, 0.11, 2.8, 8, 0, 1.4, 0);
  const arms = rangeInt(rng, 2, 4);
  for (let i = 0; i < arms; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const y = 2.4 - i * 0.38;
    const dir = chance(rng, 0.5) ? 1 : -1;
    k.box('wood', 0.9, 0.24, 0.06, Math.cos(a) * dir * 0.5, y, Math.sin(a) * dir * 0.5, [0, -a, 0]);
    k.cone('wood', 0.16, 0.24, 3, Math.cos(a) * dir * 0.98, y, Math.sin(a) * dir * 0.98,
      [0, -a, dir * Math.PI / 2]);
  }
  k.cone('woodDark', 0.13, 0.2, 6, 0, 2.9, 0);
  return k.finish(M(rng));
}

// =============================================================================
// Training quarter
// =============================================================================

/** A straw training dummy on a post, with a strapped burlap torso. */
export function generateTrainingDummy(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('stone', 0.34, 0.42, 0.16, 8, 0, 0.08, 0);
  k.cyl('woodDark', 0.1, 0.13, 1.1, 6, 0, 0.55, 0);
  // Torso.
  k.cyl('straw', 0.3, 0.26, 0.85, 8, 0, 1.5, 0);
  k.box('cloth', 0.63, 0.1, 0.63, 0, 1.68, 0);
  k.box('cloth', 0.63, 0.1, 0.63, 0, 1.34, 0);
  // Arms.
  k.box('woodDark', 1.5, 0.11, 0.11, 0, 1.75, 0);
  for (const sx of [-1, 1]) {
    k.cyl('straw', 0.11, 0.09, 0.34, 6, sx * 0.7, 1.62, 0);
  }
  // Head.
  k.sphere('straw', 0.22, 0, 2.08, 0, [1, 1.05, 1]);
  k.box('cloth', 0.46, 0.09, 0.46, 0, 2.12, 0);
  // A scored target on the chest.
  k.cyl('target', 0.16, 0.16, 0.04, 10, 0, 1.55, 0.27, [Math.PI / 2, 0, 0]);
  k.cyl('cloth', 0.08, 0.08, 0.05, 10, 0, 1.55, 0.29, [Math.PI / 2, 0, 0]);
  return k.finish(M(rng, { target: matte(0xe8dcc0) }));
}

/** An A-frame rack of spears and practice swords. */
export function generateWeaponRack(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.9;
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.12, 1.4, 0.12, sx * W / 2, 0.7, -0.22, [0.16, 0, 0]);
    k.box('woodDark', 0.12, 1.4, 0.12, sx * W / 2, 0.7, 0.22, [-0.16, 0, 0]);
    k.box('woodDark', 0.1, 0.1, 0.6, sx * W / 2, 0.06, 0);
  }
  k.box('wood', W + 0.2, 0.12, 0.12, 0, 1.32, 0);
  k.box('wood', W + 0.1, 0.1, 0.1, 0, 0.42, 0);
  // Weapons leaning in the rack.
  const n = rangeInt(rng, 4, 6);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.22 + (W - 0.44) * (i / Math.max(1, n - 1));
    const tilt = range(rng, -0.05, 0.05);
    if (chance(rng, 0.5)) {
      k.cyl('woodDark', 0.035, 0.035, 2.0, 6, x, 1.0, 0, [0, 0, tilt]);
      k.cone('iron', 0.075, 0.3, 4, x, 2.1, 0, [0, 0, tilt]);
    } else {
      k.box('iron', 0.09, 1.15, 0.03, x, 1.15, 0, [0, 0, tilt]);
      k.box('woodDark', 0.06, 0.3, 0.06, x, 0.52, 0, [0, 0, tilt]);
      k.box('iron', 0.28, 0.06, 0.06, x, 0.68, 0, [0, 0, tilt]);
    }
  }
  return k.finish(M(rng));
}

/** A round straw archery target on a tripod. */
export function generateArcheryTarget(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.box('woodDark', 0.09, 1.4, 0.09, Math.cos(a) * 0.42, 0.7, Math.sin(a) * 0.42,
      [Math.sin(a) * 0.28, 0, -Math.cos(a) * 0.28]);
  }
  const rings = [[0.72, 'straw'], [0.54, 'target'], [0.36, 'straw'], [0.18, 'cloth']];
  for (const [r, key] of rings) {
    k.cyl(key, r, r, 0.16 + (0.72 - r) * 0.04, 14, 0, 1.5, 0, [Math.PI / 2, 0, 0]);
  }
  k.cyl('straw', 0.76, 0.76, 0.13, 14, 0, 1.5, -0.02, [Math.PI / 2, 0, 0]);
  return k.finish(M(rng, { target: matte(0xe8dcc0) }));
}

/** A stack of hay bales. */
export function generateHayBales(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const bale = (x, y, z, yaw) => {
    k.cyl('straw', 0.42, 0.42, 0.92, 10, x, y, z, [0, yaw, Math.PI / 2]);
    for (const o of [-0.22, 0.22]) {
      k.cyl('rope', 0.44, 0.44, 0.05, 10, x + Math.cos(yaw) * o, y, z - Math.sin(yaw) * o,
        [0, yaw, Math.PI / 2]);
    }
  };
  bale(-0.5, 0.42, 0, range(rng, -0.2, 0.2));
  bale(0.5, 0.42, range(rng, -0.15, 0.15), range(rng, -0.2, 0.2));
  if (chance(rng, 0.7)) bale(0, 1.24, 0, range(rng, -0.3, 0.3));
  return k.finish(M(rng, { rope: matte(0xa8905a) }));
}

// =============================================================================
// Mage quarter
// =============================================================================

/** A rune-carved obelisk with a slowly-lit crystal floating above it. */
export function generateArcaneObelisk(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const hue = pick(rng, [0x7a5ad8, 0x4f8fd9, 0x9a5ad8, 0x3ad8c8]);
  k.cyl('stoneDark', 1.0, 1.15, 0.3, 8, 0, 0.15, 0);
  k.cyl('stone', 0.82, 0.95, 0.26, 8, 0, 0.43, 0);
  k.box('stone', 0.9, 3.4, 0.9, 0, 2.26, 0);
  k.box('stoneDark', 1.02, 0.22, 1.02, 0, 3.9, 0);
  k.cone('stone', 0.62, 0.8, 4, 0, 4.36, 0, [0, Math.PI / 4, 0]);
  // Carved rune bands, glowing.
  for (const y of [1.2, 2.2, 3.2]) {
    for (const [dx, dz, rot] of [[0.46, 0, [0, 0, 0]], [-0.46, 0, [0, 0, 0]], [0, 0.46, [0, Math.PI / 2, 0]], [0, -0.46, [0, Math.PI / 2, 0]]]) {
      k.box('rune', 0.02, 0.14, 0.62, dx, y, dz, rot);
      k.box('rune', 0.02, 0.42, 0.12, dx, y + 0.3, dz, rot);
    }
  }
  // Floating crystal.
  k.raw('crystal', new THREE.OctahedronGeometry(0.42, 0), 0, 5.5, 0);
  k.raw('crystal', new THREE.OctahedronGeometry(0.16, 0), 0.4, 5.15, 0.25);
  k.raw('crystal', new THREE.OctahedronGeometry(0.13, 0), -0.35, 5.85, -0.2);
  return k.finish(M(rng, { rune: glow(hue, 1.1), crystal: glow(hue, 0.9) }));
}

/** A standing brazier with an arcane flame. */
export function generateArcaneBrazier(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const hue = pick(rng, [0x6fd8ff, 0xa96fff, 0x7affc0]);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.box('iron', 0.09, 1.35, 0.09, Math.cos(a) * 0.3, 0.67, Math.sin(a) * 0.3,
      [Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22]);
  }
  k.cyl('iron', 0.52, 0.3, 0.34, 10, 0, 1.42, 0);
  k.torus('iron', 0.52, 0.05, 0, 1.57, 0, [Math.PI / 2, 0, 0]);
  k.cyl('flame', 0.42, 0.42, 0.06, 10, 0, 1.56, 0);
  k.cone('flame', 0.3, 0.75, 6, 0, 1.9, 0);
  k.cone('flame', 0.16, 0.45, 6, 0.12, 2.15, -0.08);
  return k.finish(M(rng, { flame: glow(hue, 1.3) }));
}

/** A shelf of stacked spellbooks and scroll cases, for mage-quarter frontage. */
export function generateScrollRack(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('woodDark', 1.5, 0.08, 0.5, 0, 1.28, 0);
  k.box('woodDark', 1.5, 0.08, 0.5, 0, 0.74, 0);
  k.box('woodDark', 1.5, 0.08, 0.5, 0, 0.2, 0);
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.09, 1.4, 0.5, sx * 0.75, 0.7, 0);
  }
  k.box('woodDark', 1.6, 0.12, 0.56, 0, 1.42, 0);
  const cols = [0x8c3a30, 0x3f6f9c, 0x4f7f3a, 0x6a4f9c, 0xc98b33];
  for (const shelfY of [0.32, 0.86]) {
    let x = -0.66;
    while (x < 0.6) {
      const w = range(rng, 0.07, 0.13);
      const h = range(rng, 0.28, 0.42);
      k.box('book', w, h, 0.34, x + w / 2, shelfY + h / 2, 0, [0, 0, range(rng, -0.06, 0.06)]);
      x += w + 0.02;
    }
  }
  // A few rolled scrolls laid flat on the top shelf.
  for (let i = 0; i < 3; i++) {
    k.cyl('scroll', 0.06, 0.06, 0.44, 8, -0.4 + i * 0.36, 1.36, range(rng, -0.1, 0.1), [0, 0, Math.PI / 2]);
  }
  const mats = M(rng, { scroll: matte(0xe8dcc0) });
  mats.book = matte(pick(rng, cols));
  return k.finish(mats);
}

// =============================================================================
// Crafting / market quarters
// =============================================================================

/** A stacked woodpile. */
export function generateWoodpile(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const rows = rangeInt(rng, 3, 4);
  for (let r = 0; r < rows; r++) {
    const n = rows - r + 1;
    for (let i = 0; i < n; i++) {
      const x = -(n - 1) * 0.19 + i * 0.38;
      k.cyl('woodDark', 0.18, 0.18, 1.6, 8, x, 0.19 + r * 0.35, 0, [0, 0, Math.PI / 2]);
      k.cyl('logEnd', 0.18, 0.18, 0.04, 8, x, 0.19 + r * 0.35, 0.8, [Math.PI / 2, 0, 0]);
    }
  }
  return k.finish(M(rng, { logEnd: matte(0xc9ab84) }));
}

/** A two-wheeled handcart, tipped forward onto its handles. */
export function generateHandcart(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const tilt = 0.24;
  k.box('wood', 1.5, 0.1, 0.95, 0, 0.72, 0, [tilt, 0, 0]);
  for (const sx of [-1, 1]) {
    k.box('wood', 0.08, 0.34, 0.95, sx * 0.71, 0.88, 0, [tilt, 0, 0]);
  }
  k.box('wood', 1.5, 0.34, 0.08, 0, 0.98, -0.46, [tilt, 0, 0]);
  // Wheels.
  for (const sx of [-1, 1]) {
    k.cyl('woodDark', 0.46, 0.46, 0.11, 12, sx * 0.82, 0.46, -0.1, [0, 0, Math.PI / 2]);
    k.cyl('iron', 0.48, 0.48, 0.05, 12, sx * 0.82, 0.46, -0.1, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      k.box('woodDark', 0.06, 0.86, 0.06, sx * 0.82, 0.46, -0.1, [0, 0, a + Math.PI / 2]);
    }
  }
  k.cyl('iron', 0.07, 0.07, 1.75, 8, 0, 0.46, -0.1, [0, 0, Math.PI / 2]);
  // Handles down to the ground.
  for (const sx of [-1, 1]) {
    k.box('wood', 0.09, 0.09, 1.5, sx * 0.6, 0.42, 0.85, [0.5, 0, 0]);
  }
  // A little cargo.
  for (let i = 0; i < rangeInt(rng, 2, 4); i++) {
    k.box('crate', 0.4, 0.34, 0.4, range(rng, -0.45, 0.45), 0.98 + i * 0.05, range(rng, -0.25, 0.25),
      [tilt, range(rng, 0, 1), 0]);
  }
  return k.finish(M(rng, { crate: matte(pick(rng, WOOD)) }));
}

/** A freestanding striped street canopy — market-quarter frontage. */
export function generateStreetCanopy(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.4;
  const D = 2.0;
  // The roof SLOPES ACROSS THE CANOPY'S WIDTH (high at -x, low at +x). It used
  // to fall front-to-back, i.e. across the short axis — the wrong axis, which is
  // what made the roof's angle read as wrong in game.
  const TILT = 0.24;
  const SLOPE = Math.tan(TILT);
  const CLOTH_T = 0.10;
  const MID_Y = 2.72;                  // cloth centreline over the canopy's centre
  const EAVE_X = (W + 0.3) / 2;        // the cloth reaches this far left and right
  /** Underside of the cloth directly above `x` — what the frame has to meet. */
  const underRoof = (x) => MID_Y - x * SLOPE - (CLOTH_T / 2) / Math.cos(TILT);

  const postX = W / 2 - 0.1;
  for (const sx of [-1, 1]) {
    const h = underRoof(sx * postX) + 0.04; // runs 4cm into the cloth, so no gap
    for (const sz of [-1, 1]) {
      k.box('woodDark', 0.11, h, 0.11, sx * postX, h / 2, sz * (D / 2 - 0.1));
    }
    // Head rail down each side, tucked up under the cloth rather than beside it.
    k.box('woodDark', 0.1, 0.1, D, sx * postX, underRoof(sx * postX) - 0.03, 0);
  }
  const [c1, c2] = pick(rng, [[0xc44a3f, 0xdfd5c0], [0x4f8a58, 0xdfd5c0], [0x3f6f9c, 0xdfd5c0]]);
  const stripes = 8;
  // See stripedCloth() for why the stripes are ribs on one continuous sheet
  // rather than a row of slabs.
  // Built inline rather than through stripedCloth(): the stripes have to keep
  // running the long way down the sheet (along x, the slope direction) while the
  // slope itself is across x, and stripedCloth only lays its ribs across `w`.
  // Same shape as it makes though — one continuous sheet, stripes as proud ribs.
  const clothLen = (W + 0.3) / Math.cos(TILT);   // along the slope
  const clothDepth = D + 0.3;                    // along the eave
  const rot = [0, 0, -TILT];
  k.box('stripeB', clothLen, CLOTH_T, clothDepth, 0, MID_Y, 0, rot);
  const sw = clothDepth / stripes;
  const c = Math.cos(TILT), s = Math.sin(-TILT);
  for (let i = 0; i < stripes; i += 2) {
    const dz = -clothDepth / 2 + sw * (i + 0.5);
    for (const side of [-1, 1]) {
      const d = side * CLOTH_T * 0.62;  // perpendicular to the sheet, so rotated
      k.box('stripeA', clothLen - 0.08, CLOTH_T * 0.7, sw * 0.9, -d * s, MID_Y + d * c, dz, rot);
    }
  }
  // Valance hung along the low eave (the +x side), its top buried in the cloth so
  // no slot opens between the two.
  const vX = EAVE_X - 0.05;
  const vY = underRoof(vX) - 0.07;
  const vLen = D + 0.3;
  k.box('stripeB', 0.05, 0.24, vLen, vX, vY, 0);
  const vw = vLen / 6;
  for (let i = 0; i < 6; i += 2) {
    for (const s of [-1, 1]) {
      k.box('stripeA', 0.035, 0.16, vw * 0.9, vX + s * 0.031, vY, -vLen / 2 + vw * (i + 0.5));
    }
  }
  return k.finish(M(rng, { stripeA: matte(c1), stripeB: matte(c2) }));
}

/** The guild's quest board — posts, a shingled hood, and pinned notices. */
export function generateNoticeBoard(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.2;
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.14, 2.3, 0.14, sx * (W / 2 - 0.05), 1.15, 0);
  }
  k.box('wood', W, 1.35, 0.1, 0, 1.55, 0);
  k.box('woodDark', W + 0.16, 0.12, 0.18, 0, 2.28, 0);
  // Little roof.
  for (const sz of [-1, 1]) {
    k.box('roof', W + 0.5, 0.09, 0.42, 0, 2.44, sz * 0.16, [sz * 0.6, 0, 0]);
  }
  // Pinned notices at slight angles.
  for (let i = 0; i < rangeInt(rng, 4, 7); i++) {
    k.box('paper', range(rng, 0.3, 0.44), range(rng, 0.34, 0.46), 0.02,
      range(rng, -0.7, 0.7), range(rng, 1.15, 1.95), 0.07, [0, 0, range(rng, -0.14, 0.14)]);
  }
  return k.finish(M(rng, { paper: matte(0xdfd5c0), roof: matte(0xb45538) }));
}
