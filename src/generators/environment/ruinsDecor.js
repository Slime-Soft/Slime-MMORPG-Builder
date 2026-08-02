// src/generators/environment/ruinsDecor.js
// Ancient ruins and weathered stonework: broken pillars, a crumbled arch,
// an ancient altar, an overgrown statue, and a mossy tomb.
//
// These share a palette of weathered greys and greens, with moss/ivy
// accents to sell the "abandoned for centuries" look. All built through
// meshKit for low draw calls. Front is +Z, nothing self-rotates.
//
// Key technique: "broken" geometry is just the intact shape built to its
// full height, then a second rough-edged cap placed partway up. The cap
// reads as a fracture because it sits at a non-round height with slight
// random offsets. No boolean subtraction is needed — a flat-topped cylinder
// with a chamfered cap at 60% height reads as a broken column from every
// viewing angle.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';

const STONE = [0x8a8a82, 0x92928a, 0x82827a];
const STONE_DARK = [0x6a6a64, 0x727268, 0x5e5e58];
const STONE_LIGHT = [0xa8a89e, 0xb0b0a6, 0xa0a096];
const MOSS = [0x4a6a3a, 0x3d5e30, 0x5a7a48];
const IVY = [0x3a6832, 0x2d5826, 0x48783e];
const DIRT = [0x6a5a42, 0x726248, 0x625238];
const STONE_BLUE = [0x6a6e7a, 0x5e626e, 0x747888];

const M = (rng, extra = {}) => ({
  stone: matte(pick(rng, STONE)),
  stoneDark: matte(pick(rng, STONE_DARK)),
  stoneLight: matte(pick(rng, STONE_LIGHT)),
  stoneBlue: matte(pick(rng, STONE_BLUE)),
  moss: matte(pick(rng, MOSS)),
  ivy: matte(pick(rng, IVY)),
  dirt: matte(pick(rng, DIRT)),
  ...extra,
});

const SEG = 8;

// =============================================================================
// Shared helpers
// =============================================================================

/** A broken-off column top: an irregular, slightly tilted cap. */
function fractureCap(k, key, r, y, rng) {
  // Offset the cap centre slightly so the break isn't perfectly flat.
  const ox = range(rng, -0.04, 0.04);
  const oz = range(rng, -0.04, 0.04);
  k.cyl(key, r * 1.05, r * 0.95, 0.08, SEG,
    ox, y, oz, [range(rng, -0.06, 0.06), range(rng, 0, 1), range(rng, -0.06, 0.06)]);
}

/** Mossy patches draped on horizontal surfaces. */
function mossPatches(k, rng, count, r, y) {
  for (let i = 0; i < count; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0, r * 0.7);
    const s = range(rng, 0.06, 0.14);
    k.box('moss', s, 0.03, s * range(rng, 0.8, 1.4),
      Math.cos(a) * d, y + 0.02, Math.sin(a) * d, [0, range(rng, 0, Math.PI), 0]);
  }
}

/** Ivy strands climbing a vertical surface — thin boxes at random angles. */
function ivyStrands(k, rng, count, cx, baseY, height, radius) {
  for (let i = 0; i < count; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const startY = range(rng, baseY, baseY + height * 0.4);
    const len = range(rng, 0.3, height * 0.6);
    const lean = range(rng, 0.1, 0.4);
    k.box('ivy', 0.04, len, 0.025,
      cx + Math.cos(a) * (radius + 0.02),
      startY + len / 2,
      Math.sin(a) * (radius + 0.02),
      [Math.cos(a) * lean, a, -Math.sin(a) * lean]);
  }
}

// =============================================================================
// Broken pillar
// =============================================================================

/** A single broken column with a fractured top and moss growth. */
export function generateBrokenPillar(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const r = range(rng, 0.25, 0.38);
  const baseH = range(rng, 0.15, 0.22);
  const shaftH = range(rng, 1.8, 3.0);
  const breakH = shaftH * range(rng, 0.45, 0.7); // where the break happens

  // Base plinth.
  k.cyl('stoneDark', r + 0.12, r + 0.18, baseH, SEG, 0, baseH / 2, 0);

  // Lower shaft — from plinth to the break point.
  k.cyl('stone', r * 0.95, r, breakH, SEG, 0, baseH + breakH / 2, 0);

  // Fluting grooves (4 shallow channels) to give it a classical look.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    k.box('stoneDark', 0.06, breakH * 0.9, 0.04,
      Math.sin(a) * (r - 0.02), baseH + breakH / 2, Math.cos(a) * (r - 0.02), [0, -a, 0]);
  }

  // Fracture cap.
  fractureCap(k, 'stoneLight', r, baseH + breakH, rng);

  // Fallen rubble — 2-4 chunks at the base.
  const chunkCount = rangeInt(rng, 2, 4);
  for (let i = 0; i < chunkCount; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, r + 0.2, r + 0.8);
    const s = range(rng, 0.12, 0.25);
    k.box('stoneDark', s, s * range(rng, 0.5, 0.9), s,
      Math.cos(a) * d, s * 0.3, Math.sin(a) * d,
      [range(rng, -0.3, 0.3), 0, range(rng, -0.3, 0.3)]);
  }

  // Moss on the fracture cap and base.
  mossPatches(k, rng, rangeInt(rng, 3, 6), r + 0.1, baseH + breakH);
  mossPatches(k, rng, rangeInt(rng, 2, 4), r + 0.2, baseH);

  // Ivy on the shaft.
  if (chance(rng, 0.6)) {
    ivyStrands(k, rng, rangeInt(rng, 3, 6), 0, baseH, breakH, r);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Crumbled arch
// =============================================================================

/**
 * A ruined stone archway: one pillar mostly intact, the other broken short,
 * the arch head partially collapsed. A classic ruins silhouette.
 */
export function generateCrumbledArch(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = range(rng, 2.4, 3.2); // span between pillar centres
  const pH = range(rng, 2.0, 3.0); // full pillar height
  const pR = range(rng, 0.22, 0.30);
  const archH = range(rng, 0.8, 1.2);

  // --- Left pillar (intact) ---
  k.cyl('stoneDark', pR + 0.10, pR + 0.16, 0.18, SEG, -W / 2, 0.09, 0);
  k.cyl('stone', pR * 0.95, pR, pH, SEG, -W / 2, 0.18 + pH / 2, 0);
  // Capital.
  k.cyl('stoneDark', pR + 0.06, pR + 0.02, 0.12, SEG, -W / 2, 0.18 + pH + 0.06, 0);

  // --- Right pillar (broken at 40-65%) ---
  const rightBreak = pH * range(rng, 0.4, 0.65);
  k.cyl('stoneDark', pR + 0.10, pR + 0.16, 0.18, SEG, W / 2, 0.09, 0);
  k.cyl('stone', pR * 0.95, pR, rightBreak, SEG, W / 2, 0.18 + rightBreak / 2, 0);
  fractureCap(k, 'stoneLight', pR, 0.18 + rightBreak, rng);

  // --- Arch head — only the LEFT half survives, the right has fallen ---
  // A half-cylinder arch from the left pillar top, spanning ~60% of the gap.
  const archSpan = W * 0.6;
  const archCx = -W / 2 + archSpan / 2;
  k.cyl('stoneDark', pR * 0.8, pR * 0.8, 0.18, SEG,
    archCx, 0.18 + pH + 0.12 + archH / 2, 0,
    [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2); // top half

  // Broken end of the arch — a rough cap where it snapped.
  k.box('stoneLight', 0.18, archH * 0.7, pR * 0.8,
    -W / 2 + archSpan, 0.18 + pH + 0.12 + archH * 0.35, 0,
    [0, 0, range(rng, -0.15, 0.15)]);

  // --- Fallen arch rubble on the ground ---
  const rubCount = rangeInt(rng, 4, 7);
  for (let i = 0; i < rubCount; i++) {
    const rx = range(rng, W / 2 - 0.5, W / 2 + 1.0);
    const rz = range(rng, -0.6, 0.6);
    const s = range(rng, 0.15, 0.35);
    k.box('stoneDark', s, s * range(rng, 0.4, 0.8), s * range(rng, 0.6, 1.0),
      rx, s * 0.2, rz,
      [range(rng, -0.4, 0.4), range(rng, 0, Math.PI), range(rng, -0.3, 0.3)]);
  }

  // Moss and ivy.
  mossPatches(k, rng, 5, pR + 0.15, 0.18);
  mossPatches(k, rng, 3, pR, 0.18 + rightBreak);
  ivyStrands(k, rng, rangeInt(rng, 3, 5), -W / 2, 0.18, pH, pR);
  if (chance(rng, 0.5)) {
    ivyStrands(k, rng, rangeInt(rng, 2, 4), W / 2, 0.18, rightBreak, pR);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Ancient altar
// =============================================================================

/**
 * A weathered stone altar with worn steps and a shallow basin on top.
 * Suggests ritual use — the basin could hold blood, water, or offerings.
 */
export function generateAncientAltar(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = range(rng, 1.4, 1.8);
  const D = range(rng, 0.9, 1.2);

  // Three stepped tiers rising from ground.
  k.box('stoneDark', W + 0.5, 0.12, D + 0.5, 0, 0.06, 0);
  k.box('stone', W + 0.25, 0.14, D + 0.25, 0, 0.19, 0);
  k.box('stoneLight', W, 0.16, D, 0, 0.34, 0);

  // Basin on top — lathed open vessel.
  const lathe = (key, profile) => k.raw(key, new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)), SEG
  ), 0, 0.42, 0);

  lathe('stoneBlue', [
    [D * 0.38, 0], [D * 0.40, 0.08], [D * 0.38, 0.10],
    [D * 0.32, 0.08], [D * 0.32, 0.02], [D * 0.10, 0],
  ]);

  // Carved groove around the top surface — a thin recessed line.
  const grooveR = 0.15;
  k.torus('stoneDark', W * 0.4, 0.02, 0, 0.44, 0, [Math.PI / 2, 0, 0]);

  // Corner pillars on the altar — short worn nubs.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = range(rng, 0.15, 0.30);
      k.cyl('stoneDark', 0.06, 0.08, h, 6,
        sx * (W / 2 - 0.12), 0.42 + h / 2, sz * (D / 2 - 0.12));
    }
  }

  // Scattered offerings — small stone-like shapes around the base.
  if (chance(rng, 0.7)) {
    const offerCount = rangeInt(rng, 2, 5);
    for (let i = 0; i < offerCount; i++) {
      const a = range(rng, 0, Math.PI * 2);
      const d = range(rng, 0.5, 1.0);
      const s = range(rng, 0.04, 0.08);
      k.box('stoneBlue', s, s, s, Math.cos(a) * d, s / 2 + 0.12, Math.sin(a) * d,
        [range(rng, -0.3, 0.3), 0, range(rng, -0.3, 0.3)]);
    }
  }

  // Moss on the steps and basin rim.
  mossPatches(k, rng, rangeInt(rng, 4, 8), W / 2 + 0.3, 0.12);
  mossPatches(k, rng, rangeInt(rng, 2, 4), W / 2, 0.34);

  return k.finish(M(rng));
}

// =============================================================================
// Overgrown statue
// =============================================================================

/**
 * A weathered stone statue on a plinth, mostly overgrown with moss and ivy.
 * The statue shape is a simplified humanoid figure (head, torso, base) —
 * detail is sold by the vegetation, not by anatomy.
 */
export function generateOvergrownStatue(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // Plinth.
  k.cyl('stoneDark', 0.52, 0.58, 0.14, SEG, 0, 0.07, 0);
  k.cyl('stone', 0.42, 0.48, 0.10, SEG, 0, 0.19, 0);

  // The figure — heavily simplified. A pedestal block, a torso box,
  // and a sphere head. The weathering and vegetation do the rest.
  const torsoH = range(rng, 0.9, 1.3);
  const torsoW = range(rng, 0.3, 0.42);

  // Pedestal block on the plinth.
  k.box('stoneLight', 0.35, 0.15, 0.35, 0, 0.32, 0);

  // Torso — slightly tapered (wider at shoulders).
  k.box('stone', torsoW, torsoH, torsoW * 0.7,
    0, 0.40 + torsoH / 2, 0, [0, range(rng, 0, 0.5), 0]);

  // Head — a rough sphere, maybe slightly tilted.
  const headR = range(rng, 0.11, 0.15);
  k.sphere('stone', headR,
    0, 0.40 + torsoH + headR + 0.02, range(rng, -0.02, 0.02),
    [1, range(rng, 0.9, 1.1), 1]);

  // One arm — or the remains of one (broken off short).
  const armLen = range(rng, 0.2, 0.5);
  const armSide = range(rng, 0, 1) > 0.5 ? 1 : -1;
  k.box('stone', 0.08, armLen, 0.08,
    armSide * (torsoW / 2 + 0.04), 0.40 + torsoH * 0.75, 0,
    [range(rng, -0.1, 0.3), 0, range(rng, -0.2, 0.2)]);

  // Heavy moss coverage on every horizontal surface.
  mossPatches(k, rng, 6, 0.55, 0.19);
  mossPatches(k, rng, 4, 0.3, 0.32);
  // Moss on the head and shoulders.
  k.box('moss', torsoW * 0.8, 0.03, torsoW * 0.6,
    0, 0.40 + torsoH + 0.01, 0);
  k.box('moss', headR * 2, 0.025, headR * 2,
    0, 0.40 + torsoH + headR * 2 + 0.01, range(rng, -0.02, 0.02));

  // Ivy climbing the torso and plinth.
  ivyStrands(k, rng, rangeInt(rng, 4, 8), 0, 0.19, torsoH + 0.5, torsoW / 2);
  ivyStrands(k, rng, rangeInt(rng, 2, 4), 0, 0, 0.19, 0.55);

  // Ground vegetation around the base.
  for (let i = 0; i < rangeInt(rng, 4, 8); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0.55, 1.0);
    k.sphere('ivy', range(rng, 0.06, 0.14), Math.cos(a) * d, 0.04, Math.sin(a) * d);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Mossy tomb
// =============================================================================

/**
  * A low stone sarcophagus-style tomb, heavily moss-covered, with a
  * weathered lid slightly askew. Reads as an ancient burial site.
  */
export function generateMossyTomb(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const L = range(rng, 1.8, 2.4); // length (along Z)
  const W = range(rng, 0.8, 1.0); // width
  const H = range(rng, 0.6, 0.8); // wall height

  // Base slab — slightly wider than the coffin.
  k.box('stoneDark', W + 0.3, 0.12, L + 0.3, 0, 0.06, 0);

  // Coffin walls — a hollow box (4 walls, no top or bottom).
  const t = 0.10; // wall thickness
  // Long sides.
  k.box('stone', t, H, L, -(W / 2 - t / 2), 0.12 + H / 2, 0);
  k.box('stone', t, H, L, (W / 2 - t / 2), 0.12 + H / 2, 0);
  // Short ends.
  k.box('stone', W, H, t, 0, 0.12 + H / 2, -(L / 2 - t / 2));
  k.box('stone', W, H, t, 0, 0.12 + H / 2, (L / 2 - t / 2));

  // Floor visible inside.
  k.box('stoneDark', W - t * 2, 0.04, L - t * 2, 0, 0.14, 0);

  // Lid — a slightly rounded box, displaced and tilted.
  const lidTilt = range(rng, -0.08, 0.08);
  const lidShift = range(rng, -0.05, 0.15);
  k.box('stoneLight', W + 0.06, 0.10, L + 0.06,
    lidShift, 0.12 + H + 0.05, 0,
    [lidTilt, range(rng, 0, 0.3), range(rng, -0.05, 0.05)]);

  // A simple cross or symbol carved into one end — a flat recessed cross.
  k.box('stoneDark', 0.04, 0.30, 0.04, 0, 0.12 + H / 2, L / 2 - t / 2 + 0.01);
  k.box('stoneDark', 0.18, 0.04, 0.04, 0, 0.12 + H / 2 + 0.06, L / 2 - t / 2 + 0.01);

  // Heavy moss on the lid and base.
  mossPatches(k, rng, 8, W / 2 + 0.2, 0.12 + H + 0.1);
  mossPatches(k, rng, 6, W / 2 + 0.2, 0.12);
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const mz = range(rng, -L / 2, L / 2);
    const side = range(rng, 0, 1) > 0.5 ? 1 : -1;
    k.box('moss', range(rng, 0.15, 0.30), 0.04, range(rng, 0.20, 0.40),
      side * (W / 2 - 0.01), 0.12 + range(rng, 0.1, H - 0.1), mz);
  }

  // Ivy spilling off the sides.
  ivyStrands(k, rng, rangeInt(rng, 4, 7), 0, 0.12, H, W / 2);

  // Ground cover around the tomb.
  for (let i = 0; i < rangeInt(rng, 5, 10); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, W / 2 + 0.3, W / 2 + 0.9);
    const s = range(rng, 0.05, 0.12);
    k.sphere('moss', s, Math.cos(a) * d, 0.02, Math.sin(a) * d);
  }

  return k.finish(M(rng));
}
