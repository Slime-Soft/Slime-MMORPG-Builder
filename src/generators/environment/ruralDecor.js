// src/generators/environment/ruralDecor.js
// Domestic and rural life props that don't belong in the town or countryside
// files: a butter churn, a spit roast over a fire, a rain barrel with
// overflow, a chopping block with axe, a stacked grain sack pile, and
// a cider press.
//
// These are the smaller, humbler objects of farm life — the kind of thing
// you'd find in a backyard, a farmyard, or a peasant kitchen. All built
// through meshKit. Front is +Z, nothing self-rotates, no metalness.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';

const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30, 0x654626];
const WOOD_LIGHT = [0xb89468, 0xc0a070, 0xb08a60];
const IRON = 0x6a6a74;
const STONE = [0x9a9a90, 0xa6a69c, 0x8e8e84];
const CLOTH = [0xc4b896, 0xb8a888, 0xd0c4a0];
const STRAW = [0xd8bd77, 0xcfb069, 0xe0c684];
const FIRE = 0xff8a2b;

const M = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  woodLight: matte(pick(rng, WOOD_LIGHT)),
  iron: metal(IRON),
  stone: matte(pick(rng, STONE)),
  cloth: matte(pick(rng, CLOTH)),
  straw: matte(pick(rng, STRAW)),
  ...extra,
});

// =============================================================================
// Butter churn
// =============================================================================

/**
 * A tall wooden butter churn with a plunger/dasher, sitting on a slight
 * base. The dasher handle sticks out the top.
 */
export function generateButterChurn(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const bodyH = range(rng, 0.65, 0.85);
  const bodyR = range(rng, 0.14, 0.18);

  // Base — slightly wider than the body.
  k.cyl('woodDark', bodyR + 0.06, bodyR + 0.10, 0.08, 10, 0, 0.04, 0);

  // Body — a barrel shape: three stacked cylinders (bulged middle).
  k.cyl('woodDark', bodyR * 0.88, bodyR * 0.95, bodyH * 0.3, 10, 0, 0.08 + bodyH * 0.15, 0);
  k.cyl('wood', bodyR * 0.95, bodyR * 0.95, bodyH * 0.4, 10, 0, 0.08 + bodyH * 0.5, 0);
  k.cyl('woodDark', bodyR * 0.88, bodyR * 0.95, bodyH * 0.3, 10, 0, 0.08 + bodyH * 0.85, 0);

  // Iron hoops.
  for (const hy of [0.15, 0.5, 0.85]) {
    k.cyl('iron', bodyR + 0.01, bodyR + 0.01, 0.025, 10, 0, 0.08 + bodyH * hy, 0);
  }

  // Lid — a disc with a hole for the dasher.
  k.cyl('woodLight', bodyR * 0.80, bodyR * 0.80, 0.04, 10, 0, 0.08 + bodyH + 0.02, 0);

  // Dasher plunger — a thin rod going through the lid.
  const dasherH = range(rng, 0.3, 0.5);
  k.cyl('woodLight', 0.02, 0.02, dasherH, 5, 0, 0.08 + bodyH + 0.04 + dasherH / 2, 0);

  // Dasher cross-piece at the bottom (inside the churn, visible from the top).
  k.box('woodDark', 0.18, 0.03, 0.03, 0, 0.08 + bodyH - 0.05, 0);
  k.box('woodDark', 0.03, 0.03, 0.18, 0, 0.08 + bodyH - 0.05, 0);

  // Handle grip at the top — a slightly wider cylinder.
  k.cyl('woodDark', 0.035, 0.035, 0.08, 5, 0, 0.08 + bodyH + 0.04 + dasherH - 0.02, 0);

  return k.finish(M(rng));
}

// =============================================================================
// Spit roast
// =============================================================================

/**
 * A cooking spit over a small campfire: two Y-shaped forked posts holding
 * a horizontal iron rod, with a fire pit below. A simple but evocative
 * outdoor cooking setup.
 */
export function generateSpitRoast(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = range(rng, 0.8, 1.1); // distance between fork posts
  const postH = range(rng, 0.7, 0.9);
  const spitY = postH - range(rng, 0.15, 0.25); // spit height

  // Fire pit — a ring of stones.
  const pitR = W * 0.35;
  const stoneCount = rangeInt(rng, 7, 10);
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2;
    k.box('stone', 0.14, 0.10, 0.10,
      Math.cos(a) * pitR, 0.05, Math.sin(a) * pitR, [0, -a, 0]);
  }

  // Ash / charcoal bed inside the pit.
  k.cyl('stone', pitR * 0.7, pitR * 0.7, 0.03, 8, 0, 0.015, 0);

  // Embers — small glowing pieces.
  const emberCount = rangeInt(rng, 3, 6);
  for (let i = 0; i < emberCount; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0, pitR * 0.5);
    k.box('ember', range(rng, 0.04, 0.08), 0.02, range(rng, 0.04, 0.08),
      Math.cos(a) * d, 0.04, Math.sin(a) * d);
  }

  // Fork posts — each is a Y-shape: a main post plus two prongs.
  for (const sx of [-1, 1]) {
    const px = sx * W / 2;
    // Main post.
    k.cyl('woodDark', 0.05, 0.06, postH, 6, px, postH / 2, 0);
    // Two prongs forming the Y — splayed slightly.
    const prongH = range(rng, 0.15, 0.25);
    k.cyl('woodDark', 0.03, 0.04, prongH, 5,
      px - 0.04, postH + prongH / 2, 0, [0, 0, 0.15]);
    k.cyl('woodDark', 0.03, 0.04, prongH, 5,
      px + 0.04, postH + prongH / 2, 0, [0, 0, -0.15]);
  }

  // Spit rod — horizontal iron bar.
  k.cyl('iron', 0.015, 0.015, W + 0.2, 5, 0, spitY, 0, [Math.PI / 2, 0, 0]);

  // Something on the spit — either a joint of meat (box) or nothing visible.
  if (chance(rng, 0.7)) {
    const meatW = range(rng, 0.20, 0.35);
    const meatH = range(rng, 0.12, 0.20);
    k.box('wood', meatW, meatH, meatH * 0.8, 0, spitY, 0);
    // Trussing string — thin box wrapped around.
    for (let i = 0; i < 3; i++) {
      const tx = range(rng, -meatW * 0.3, meatW * 0.3);
      k.box('woodDark', 0.015, meatH + 0.02, 0.015,
        tx, spitY, 0);
    }
  }

  // Handle crank on one end.
  k.cyl('woodDark', 0.025, 0.025, 0.12, 4, W / 2 + 0.14, spitY, 0);

  return k.finish(M(rng, {
    ember: glow(FIRE, range(rng, 0.3, 0.5)),
  }));
}

// =============================================================================
// Rain barrel
// =============================================================================

/**
 * A wooden rain barrel under a small eave/spout, with an overflow notch.
 * Simpler than townProps' barrel — this one has a spigot and a lid chain.
 */
export function generateRainBarrel(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const h = range(rng, 0.8, 1.0);
  const r = range(rng, 0.30, 0.38);

  // Barrel body — three stave sections with slight bulge.
  k.cyl('woodDark', r * 0.88, r * 0.96, h * 0.3, 12, 0, h * 0.15, 0);
  k.cyl('wood', r * 0.96, r * 0.96, h * 0.4, 12, 0, h * 0.5, 0);
  k.cyl('woodDark', r * 0.88, r * 0.96, h * 0.3, 12, 0, h * 0.85, 0);

  // Iron hoops.
  for (const hy of [0.15, 0.5, 0.85]) {
    k.cyl('iron', r + 0.01, r + 0.01, 0.03, 12, 0, h * hy, 0);
  }

  // Lid — slightly off-centre, tilted.
  const lidTilt = range(rng, -0.05, 0.05);
  k.cyl('woodLight', r * 0.85, r * 0.85, 0.04, 12,
    range(rng, -0.03, 0.03), h + 0.02, range(rng, -0.03, 0.03),
    [lidTilt, range(rng, 0, 1), 0]);

  // Spigot — a small iron pipe near the bottom.
  k.cyl('iron', 0.02, 0.02, 0.12, 5, r + 0.06, h * 0.25, 0, [Math.PI / 2, 0, 0]);
  // Spigot handle — a tiny lever.
  k.box('iron', 0.06, 0.015, 0.025, r + 0.14, h * 0.25, 0);

  // Overflow notch — a small gap in the rim near the top.
  // Represented by a dark box recessed into the barrel top.
  k.box('woodDark', 0.12, 0.05, 0.08, r * 0.5, h - 0.02, 0);

  // Stone base / stand — keeps the barrel off damp ground.
  k.box('stone', r * 2 + 0.1, 0.06, r * 2 + 0.1, 0, 0.03, 0);

  return k.finish(M(rng));
}

// =============================================================================
// Chopping block with axe
// =============================================================================

/**
 * A thick tree stump chopping block with an axe embedded in it.
 * Woodchips scattered around the base sell the "recently used" look.
 */
export function generateChoppingBlock(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // The stump — a short wide cylinder.
  const stumpR = range(rng, 0.28, 0.38);
  const stumpH = range(rng, 0.35, 0.50);
  k.cyl('woodDark', stumpR, stumpR + 0.04, stumpH, 10, 0, stumpH / 2, 0);

  // Growth rings on top — concentric torus lines.
  for (let i = 1; i <= 3; i++) {
    k.torus('wood', stumpR * (i / 4), 0.008, 0, stumpH + 0.005, 0, [Math.PI / 2, 0, 0]);
  }

  // Split marks / chop marks on the top surface — thin dark lines.
  const chopCount = rangeInt(rng, 2, 5);
  for (let i = 0; i < chopCount; i++) {
    const a = range(rng, -0.3, 0.3);
    const len = range(rng, 0.08, stumpR * 1.2);
    k.box('woodDark', 0.015, 0.008, len,
      range(rng, -0.05, 0.05), stumpH + 0.005, 0, [0, a, 0]);
  }

  // The axe — leaning against the stump or stuck in it.
  if (chance(rng, 0.6)) {
    // Axe stuck in the top at an angle.
    const axeTilt = range(rng, 0.15, 0.35);
    // Handle.
    k.box('woodLight', 0.04, 0.65, 0.04,
      range(rng, -0.05, 0.05), stumpH + 0.20, 0.05,
      [0, range(rng, -0.3, 0.3), axeTilt]);
    // Axe head — iron.
    k.box('iron', 0.14, 0.12, 0.03,
      range(rng, -0.08, 0.08), stumpH + 0.52, 0.05,
      [0, range(rng, -0.3, 0.3), axeTilt]);
  } else {
    // Axe leaning against the side.
    const lean = 0.2;
    k.box('woodLight', 0.04, 0.70, 0.04,
      stumpR + 0.15, 0.35, 0, [lean, 0, -0.1]);
    k.box('iron', 0.14, 0.13, 0.03,
      stumpR + 0.15, 0.72, 0, [lean, 0, -0.1]);
  }

  // Woodchips scattered around.
  const chipCount = rangeInt(rng, 5, 10);
  for (let i = 0; i < chipCount; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, stumpR + 0.1, stumpR + 0.5);
    const s = range(rng, 0.04, 0.08);
    k.box('wood', s, 0.015, s * 0.6,
      Math.cos(a) * d, 0.008, Math.sin(a) * d,
      [range(rng, -0.3, 0.3), range(rng, 0, Math.PI), range(rng, -0.2, 0.2)]);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Grain sack stack
// =============================================================================

/**
 * A pile of 3-5 cloth grain sacks, some upright, some tilted, one or
 * two spilling their contents. A common farmyard/backyard prop.
 */
export function generateGrainSackStack(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const sackCount = rangeInt(rng, 3, 5);

  // Base layer — 2-3 sacks side by side.
  const baseCount = Math.min(sackCount, rangeInt(rng, 2, 3));
  const sackW = range(rng, 0.30, 0.40);
  const sackH = range(rng, 0.45, 0.60);
  const sackD = sackW * range(rng, 0.7, 0.9);

  // Place sacks in a rough cluster.
  const positions = [];
  for (let i = 0; i < sackCount; i++) {
    if (i < baseCount) {
      // Ground-level sacks.
      const x = (i - (baseCount - 1) / 2) * sackW * 0.85;
      const z = range(rng, -sackD * 0.2, sackD * 0.2);
      const tilt = range(rng, -0.08, 0.08);
      positions.push({ x, y: sackH / 2, z, tilt });
    } else {
      // Upper sacks — stacked on lower ones.
      const x = range(rng, -sackW * 0.3, sackW * 0.3);
      const z = range(rng, -sackD * 0.3, sackD * 0.3);
      const tilt = range(rng, -0.15, 0.15);
      const baseSack = positions[i - baseCount];
      positions.push({
        x: (baseSack ? baseSack.x : 0) + x,
        y: sackH + sackH * 0.4 + range(rng, 0, sackH * 0.3),
        z: (baseSack ? baseSack.z : 0) + z,
        tilt,
      });
    }
  }

  // Build each sack — a rounded box shape.
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const sw = sackW * range(rng, 0.9, 1.1);
    const sh = sackH * range(rng, 0.85, 1.0);
    const sd = sackD * range(rng, 0.9, 1.1);
    // Main body.
    k.box('cloth', sw, sh, sd, p.x, p.y, p.z, [p.tilt, range(rng, 0, 0.5), 0]);
    // Tied top — a slightly narrower section.
    k.box('clothDark', sw * 0.5, sh * 0.15, sd * 0.5,
      p.x, p.y + sh / 2 - sh * 0.07, p.z, [p.tilt, range(rng, 0, 0.5), 0]);
    // Tie string — thin dark band.
    k.box('woodDark', sw * 0.55, 0.03, sd * 0.55,
      p.x, p.y + sh / 2 - sh * 0.15, p.z, [p.tilt, range(rng, 0, 0.5), 0]);
  }

  // One or two spilling sacks — tipped over with grain pouring out.
  if (chance(rng, 0.5)) {
    const spX = range(rng, sackW * 0.5, sackW * 1.2);
    const spZ = range(rng, -sackD * 0.5, sackD * 0.5);
    k.box('cloth', sackW * 0.9, sackH * 0.4, sackD * 0.9,
      spX, sackH * 0.2, spZ, [Math.PI / 2 + range(rng, -0.2, 0.2), 0, range(rng, -0.3, 0.3)]);
    // Spilled grain — small pile of light-coloured boxes.
    for (let i = 0; i < rangeInt(rng, 4, 8); i++) {
      const gx = spX + range(rng, -0.1, 0.2);
      const gz = spZ + range(rng, -0.15, 0.15);
      k.box('straw', range(rng, 0.03, 0.07), 0.015, range(rng, 0.03, 0.07), gx, 0.01, gz);
    }
  }

  return k.finish({
    ...M(rng),
    clothDark: matte(pick(rng, [0xa09878, 0x968e70, 0xaaa282])),
  });
}

// =============================================================================
// Cider press
// =============================================================================

/**
 * A wooden cider press / fruit press: a sturdy frame with a screw mechanism
// and a catch basin below. A classic rural workshop prop.
 */
export function generateCiderPress(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const FRAME_W = 0.7;
  const FRAME_H = range(rng, 1.2, 1.5);
  const FRAME_D = 0.6;

  // Base slab — heavy timber.
  k.box('woodDark', FRAME_W + 0.2, 0.10, FRAME_D + 0.15, 0, 0.05, 0);

  // Two upright frame posts.
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.10, FRAME_H, 0.10,
      sx * (FRAME_W / 2), 0.10 + FRAME_H / 2, 0);
  }

  // Top crossbeam.
  k.box('wood', FRAME_W + 0.1, 0.10, 0.10, 0, 0.10 + FRAME_H + 0.05, 0);

  // Catch basin — a shallow lathed vessel below the press area.
  const lathe = (key, profile) => k.raw(key, new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), 8
  ), 0, 0, 0);

  lathe('wood', [
    [0.22, 0], [0.24, 0.02], [0.24, 0.10], [0.20, 0.12],
    [0.20, 0.02], [0.14, 0],
  ]);

  // Press platform — a flat board where the fruit sits.
  k.box('woodLight', 0.45, 0.04, 0.40, 0, 0.20, 0);

  // Press plate — a flat disc that presses down onto the fruit.
  k.box('woodDark', 0.40, 0.04, 0.36, 0, 0.25, 0);

  // Screw mechanism — a central threaded rod.
  k.cyl('iron', 0.03, 0.03, FRAME_H * 0.6, 6, 0, 0.10 + FRAME_H - FRAME_H * 0.25, 0);

  // Screw handle at the top — a horizontal bar.
  k.cyl('iron', 0.02, 0.02, 0.35, 4, 0, 0.10 + FRAME_H - 0.05, 0, [Math.PI / 2, 0, 0]);

  // Juice drip — a small glowing pool in the basin (liquid).
  k.cyl('juice', 0.15, 0.15, 0.02, 8, 0, 0.11, 0);

  // Cross-braces between the uprights for rigidity.
  for (const sy of [0.3, 0.7]) {
    k.box('wood', FRAME_W - 0.10, 0.06, 0.05, 0, 0.10 + FRAME_H * sy, FRAME_D / 2 - 0.03);
  }

  return k.finish(M(rng, {
    juice: glow(0xc8a020, 0.25), // golden cider
  }));
}
