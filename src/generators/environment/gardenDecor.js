// src/generators/environment/gardenDecor.js
// Garden and park decorative pieces: a sundial, birdbath, garden trellis,
// topiary bush, and a small stone gazebo.
//
// Built through meshKit like every other environment prop — each piece is
// 2-5 draw calls. Front is +Z, nothing self-rotates, palettes run light,
// no material uses metalness (no environment map in src/render).
//
// Bloom discipline: the birdbath's water gets a subtle blue-green emissive
// at low intensity (0.3) to catch light without tripping the bloom pass.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';

const STONE = [0xb4aca0, 0xc0b8ab, 0xa9a196];
const STONE_DARK = [0x8f877c, 0x847c72, 0x9a928a];
const STONE_LIGHT = [0xd0c8bc, 0xcac2b6, 0xd6cec2];
const IRON = 0x6a6a74;
const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30];
const FOLIAGE = [0x4f8a3f, 0x3d7a32, 0x5c9a4e];
const WATER = 0x3a7a8a;

const M = (rng, extra = {}) => ({
  stone: matte(pick(rng, STONE)),
  stoneDark: matte(pick(rng, STONE_DARK)),
  stoneLight: matte(pick(rng, STONE_LIGHT)),
  iron: metal(IRON),
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  foliage: matte(pick(rng, FOLIAGE)),
  water: glow(WATER, 0.3),
  ...extra,
});

const SEG = 8;

// =============================================================================
// Sundial
// =============================================================================

/** A stone pedestal sundial with an angled gnomon. */
export function generateSundial(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // Octagonal base — two stepped tiers rising out of the ground.
  k.cyl('stoneDark', 0.62, 0.68, 0.10, SEG, 0, 0.05, 0);
  k.cyl('stone', 0.48, 0.56, 0.14, SEG, 0, 0.17, 0);

  // Column.
  const colH = range(rng, 0.7, 0.9);
  k.cyl('stoneLight', 0.12, 0.15, colH, SEG, 0, 0.24 + colH / 2, 0);

  // Dial face — a slightly raised disc on top.
  k.cyl('stone', 0.32, 0.32, 0.04, SEG, 0, 0.24 + colH + 0.02, 0);

  // Gnomon — a thin triangular wedge tilted at ~45 degrees (latitude-ish).
  // Built as a thin box rotated around X. The shadow edge is what reads as
  // the time-telling edge, so it needs to be thin but visible.
  const gnomonH = 0.28;
  k.box('stoneDark', 0.03, gnomonH, 0.22,
    0, 0.24 + colH + 0.04 + gnomonH / 2, 0.02,
    [-0.78, 0, 0]); // ~45 degree tilt

  // Hour marks — small bumps around the dial rim.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = 0.27;
    k.box('stoneDark', 0.03, 0.025, 0.015,
      Math.sin(a) * r, 0.24 + colH + 0.045, Math.cos(a) * r, [0, -a, 0]);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Birdbath
// =============================================================================

/**
 * A classic stone birdbath: pedestal basin on a column.
 *
 * The basin is a lathed open vessel (same technique as townDecor's fountain):
 * LatheGeometry profiles, outer-bottom -> up -> over the rim -> down the
 * inside -> across the floor. Reverse the ordering and half the normals
 * face inward on single-sided materials.
 */
export function generateBirdbath(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const lathe = (key, profile) => k.raw(key, new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), SEG
  ), 0, 0, 0);

  // Heavy base.
  k.cyl('stoneDark', 0.42, 0.50, 0.12, SEG, 0, 0.06, 0);

  // Column — slightly tapered.
  k.cyl('stoneLight', 0.09, 0.13, 0.75, SEG, 0, 0.49, 0);

  // Basin: an open vessel. Floor at ~1.12, rim at ~1.34.
  lathe('stone', [
    [0.44, 1.06], [0.48, 1.28], [0.46, 1.34],   // outer wall up to rim
    [0.40, 1.31], [0.40, 1.16], [0.34, 1.12],   // over rim, down inside
    [0.06, 1.12],                                // floor to centre
  ]);

  // Rim accent — a thin torus sitting on top of the basin lip.
  k.torus('stoneDark', 0.47, 0.025, 0, 1.34, 0, [Math.PI / 2, 0, 0]);

  // Water surface — inset well below the rim so the stone reads as a bowl,
  // not as a flat disc (see townDecor fountain comments).
  k.cyl('water', 0.38, 0.38, 0.03, SEG, 0, 1.22, 0);

  return k.finish(M(rng));
}

// =============================================================================
// Garden trellis
// =============================================================================

/** A wooden lattice trellis with climbing vine foliage. */
export function generateGardenTrellis(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = 1.2, H = 1.8;
  const POST = 0.07;

  // Four corner posts.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('woodDark', POST, H, POST,
        sx * (W / 2 - POST / 2), H / 2, sz * 0.06);
    }
  }

  // Horizontal rails — 5 rows.
  for (let i = 0; i < 5; i++) {
    const y = 0.15 + i * (H - 0.3) / 4;
    k.box('wood', W - POST * 2, 0.04, 0.035, 0, y, 0);
  }

  // Vertical slats — alternating offset for woven look.
  const SLAT_N = 9;
  for (let i = 0; i < SLAT_N; i++) {
    const x = -W / 2 + POST + 0.04 + i * ((W - POST * 2 - 0.08) / (SLAT_N - 1));
    k.box('wood', 0.035, H - 0.15, 0.03, x, H / 2, (i % 2 === 0) ? 0.035 : -0.035);
  }

  // Climbing foliage patches — random leafy blobs scattered over the lattice.
  // Keep each blob small relative to the trellis so the wood structure reads through.
  const leafCount = rangeInt(rng, 10, 16);
  for (let i = 0; i < leafCount; i++) {
    const lx = range(rng, -W / 2 + 0.1, W / 2 - 0.1);
    const ly = range(rng, 0.2, H - 0.1);
    const lz = range(rng, -0.04, 0.08);
    const lr = range(rng, 0.06, 0.12);
    k.sphere('foliage', lr, lx, ly, lz);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Topiary bush
// =============================================================================

/**
 * A sculpted bush clipped into a geometric shape on a low pot.
 * The shape varies by seed: sphere, cone, or cube.
 */
export function generateTopiary(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // Terracotta pot — lathed open vessel, same technique as birdbath basin.
  const lathe = (key, profile) => k.raw(key, new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), 12
  ), 0, 0, 0);

  lathe('wood', [
    [0.26, 0], [0.30, 0.02], [0.30, 0.38], [0.24, 0.42],
    [0.22, 0.40], [0.22, 0.08], [0.18, 0.04], [0.18, 0.04],
  ]);

  // Soil visible at the top of the pot.
  k.cyl('stoneDark', 0.21, 0.21, 0.03, 12, 0, 0.39, 0);

  // Stem/trunk poking out of the soil.
  k.cyl('woodDark', 0.03, 0.04, 0.20, 6, 0, 0.50, 0);

  // The clipped foliage shape — varies by seed for visual variety.
  const shape = rangeInt(rng, 1, 3);
  const baseY = 0.60;
  if (shape === 1) {
    // Sphere topiary.
    const r = range(rng, 0.35, 0.45);
    k.sphere('foliage', r, 0, baseY + r, 0);
  } else if (shape === 2) {
    // Cone topiary (like a Christmas tree shape).
    const h = range(rng, 0.7, 1.0);
    const r = range(rng, 0.3, 0.4);
    k.cone('foliage', r, h, SEG, 0, baseY + h / 2, 0);
  } else {
    // Cube topiary — a box with slightly rounded appearance via overlapping icos.
    const s = range(rng, 0.5, 0.65);
    k.box('foliage', s, s, s, 0, baseY + s / 2, 0);
    // Soften the corners with small spheres at each corner.
    const cr = s * 0.22;
    const off = s / 2 - cr * 0.5;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          k.sphere('foliage', cr, sx * off, baseY + s / 2 + sy * off, sz * off);
        }
      }
    }
  }

  return k.finish(M(rng));
}

// =============================================================================
// Stone gazebo
// =============================================================================

/**
 * A small open-sided stone gazebo: octagonal floor, six pillars, a domed roof.
 * Scaled down to prop size (~3m across) so it fits in a garden.
 */
export function generateStoneGazebo(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const R = 1.5; // radius to pillar centres
  const PILLAR_H = 2.4;
  const ROOF_H = 1.0;

  // Octagonal floor slab.
  k.cyl('stoneDark', R + 0.2, R + 0.3, 0.10, SEG, 0, 0.05, 0);

  // Step ring around the outside.
  k.cyl('stone', R + 0.45, R + 0.55, 0.08, SEG, 0, 0.04, 0);

  // Six pillars (not eight — leave two sides open as the "entrance").
  // Pillars at indices 1-6, skipping 0 and 7 (front-facing gap at +Z).
  for (let i = 1; i <= 6; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const px = Math.sin(a) * R;
    const pz = Math.cos(a) * R;
    // Shaft.
    k.cyl('stoneLight', 0.09, 0.11, PILLAR_H, 8, px, 0.10 + PILLAR_H / 2, pz);
    // Base.
    k.cyl('stoneDark', 0.16, 0.18, 0.12, 8, px, 0.16, pz);
    // Capital.
    k.cyl('stoneDark', 0.15, 0.12, 0.10, 8, px, 0.10 + PILLAR_H + 0.05, pz);
  }

  // Entablature ring — a torus connecting the pillar tops.
  k.torus('stoneDark', R, 0.08, 0, 0.10 + PILLAR_H + 0.10, 0, [Math.PI / 2, 0, 0]);

  // Domed roof — a half-sphere. Built from a sphere scaled flat on Y.
  // Using ico for a faceted dome look that reads well at low poly.
  k.ico('stone', 1.0, 0, 0.10 + PILLAR_H + 0.10 + ROOF_H * 0.4, 0, [R * 1.15, ROOF_H * 0.8, R * 1.15]);

  // Finial on top.
  k.cyl('stoneLight', 0.03, 0.05, 0.25, 6, 0, 0.10 + PILLAR_H + 0.10 + ROOF_H * 0.8 + 0.12, 0);
  k.sphere('stoneLight', 0.06, 0, 0.10 + PILLAR_H + 0.10 + ROOF_H * 0.8 + 0.28, 0);

  // Bench seats inside — two arc segments facing each other.
  // Built as short box segments following the pillar ring.
  for (const side of [-1, 1]) {
    for (let i = 2; i <= 5; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const px = Math.sin(a) * (R - 0.35);
      const pz = Math.cos(a) * (R - 0.35) * side * 0.5;
      k.box('wood', 0.45, 0.05, 0.30,
        px, 0.42, Math.cos(a) * (R - 0.35), [0, -a, 0]);
    }
  }

  return k.finish(M(rng));
}
