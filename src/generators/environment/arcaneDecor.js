// src/generators/environment/arcaneDecor.js
// Magical and arcane decorative pieces: a summoning circle, floating runes,
// a crystal ball stand, a potion shelf, and a spell book podium.
//
// Bloom discipline (copied from caveDecor.js):
//   - Emissive colour is never white and never near-white.
//   - emissiveIntensity stays at or under 0.9.
//   - The biggest surfaces get the LOWEST intensity — a large glowing face
//     blooms far harder than a spark.
//   - The glowing part is always small relative to the prop and always
//     framed by dark material.
//
// Front is +Z, nothing self-rotates, all through meshKit.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';

const STONE_DARK = [0x3a3a42, 0x42424a, 0x32323a];
const STONE_BLUE = [0x4a4a5a, 0x3e3e50, 0x52526a];
const IRON_DARK = 0x2a2d36;
const IRON_LIGHT = 0x3c414d;
const WOOD_DARK = [0x5a3a22, 0x4e3020, 0x64442c];
const PURPLE = 0x9b4dff;
const TEAL = 0x49b8ff;
const GREEN_ARCANE = 0x7de04a;
const ORANGE_ARCANE = 0xffa030;

const M = (rng, extra = {}) => ({
  stone: matte(pick(rng, STONE_DARK)),
  stoneBlue: matte(pick(rng, STONE_BLUE)),
  iron: metal(IRON_DARK),
  ironLight: metal(IRON_LIGHT),
  wood: matte(pick(rng, WOOD_DARK)),
  // Three call sites already asked for `woodDark` (shelf backs, phial racks,
  // desk trim) and got nothing — an unresolved key throws in meshKit.finish,
  // so `potion-shelf` crashed the whole prop check rather than shipping white.
  woodDark: matte(0x3a2416),
  ...extra,
});

const SEG = 8;

// =============================================================================
// Summoning circle
// =============================================================================

/**
 * A ground-level summoning circle: concentric stone rings with glowing rune
 * channels between them. The glow is low-intensity and saturated so it reads
 * as a magical inscription, not as a bloom bug.
 *
 * The geometry is all flat on the ground — a flat disc with torus rings and
 * thin box "rune" marks floating just above the surface.
 */
export function generateSummoningCircle(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // Pick a rune colour — one of the arcane trio.
  const RUNE_COLORS = [
    { glow: PURPLE, name: 'rune' },
    { glow: TEAL, name: 'rune' },
    { glow: GREEN_ARCANE, name: 'rune' },
  ];
  const runeColor = pick(rng, RUNE_COLORS).glow;

  // Base disc — dark stone, slightly raised.
  const R = range(rng, 1.8, 2.4);
  k.cyl('stone', R + 0.1, R + 0.1, 0.06, SEG * 2, 0, 0.03, 0);
  k.cyl('stoneBlue', R - 0.1, R - 0.1, 0.07, SEG * 2, 0, 0.065, 0);

  // Outer stone ring.
  k.torus('stone', R - 0.15, 0.12, 0, 0.10, 0, [Math.PI / 2, 0, 0]);

  // Middle glowing rune ring.
  k.torus('rune', R * 0.72, 0.025, 0, 0.11, 0, [Math.PI / 2, 0, 0]);

  // Inner stone ring.
  k.torus('stone', R * 0.52, 0.08, 0, 0.10, 0, [Math.PI / 2, 0, 0]);

  // Innermost glowing ring — the binding circle.
  k.torus('rune', R * 0.32, 0.02, 0, 0.11, 0, [Math.PI / 2, 0, 0]);

  // Rune marks — thin boxes radiating from centre, like clock hands.
  const runeCount = rangeInt(rng, 8, 12);
  for (let i = 0; i < runeCount; i++) {
    const a = (i / runeCount) * Math.PI * 2 + range(rng, -0.05, 0.05);
    const innerR = R * 0.35;
    const outerR = R * 0.68;
    const len = outerR - innerR;
    const midR = (innerR + outerR) / 2;
    k.box('rune', len, 0.015, 0.04,
      Math.sin(a) * midR, 0.12, Math.cos(a) * midR, [0, -a, 0]);
  }

  // Small glyph symbols at the cardinal points between the rings.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const gr = R * 0.62;
    // Each glyph is a small diamond shape (rotated box).
    k.box('rune', 0.12, 0.015, 0.06,
      Math.sin(a) * gr, 0.12, Math.cos(a) * gr, [0, -a + Math.PI / 4, 0]);
    // A dot on each side.
    for (const da of [-0.25, 0.25]) {
      k.box('rune', 0.03, 0.015, 0.03,
        Math.sin(a + da) * gr, 0.12, Math.cos(a + da) * gr);
    }
  }

  // Centre focal point — a small pedestal with a glowing crystal.
  k.cyl('stone', 0.10, 0.14, 0.12, 6, 0, 0.18, 0);
  // Crystal shard on top — faceted, small, saturated glow.
  k.cyl('rune', 0.01, 0.06, 0.20, 5, 0, 0.34, 0,
    [0.1, 0, 0.15]);
  k.cyl('rune', 0.01, 0.05, 0.16, 5, 0.04, 0.32, -0.03,
    [-0.15, 0.8, 0.1]);

  // Corner stone markers at 45-degree offsets around the perimeter.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box('stoneBlue', 0.18, 0.14, 0.18,
      Math.sin(a) * (R + 0.05), 0.10, Math.cos(a) * (R + 0.05), [0, -a, 0]);
  }

  const runeIntensity = range(rng, 0.45, 0.7);
  return k.finish(M(rng, {
    rune: glow(runeColor, runeIntensity),
  }));
}

// =============================================================================
// Floating runes
// =============================================================================

/**
 * A cluster of stone rune tablets hovering at varying heights, as if
 * suspended by magic. The tablets are flat slabs with glowing inscriptions.
 * A thin stone base anchors the composition.
 */
export function generateFloatingRunes(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const ARCANE_SETS = [
    { primary: PURPLE, secondary: 0xc492ff },
    { primary: TEAL, secondary: 0x7fd8ff },
    { primary: GREEN_ARCANE, secondary: 0x9dfb63 },
  ];
  const arcane = pick(rng, ARCANE_SETS);

  // Stone base — a low cylindrical dais.
  k.cyl('stone', 0.55, 0.65, 0.12, SEG, 0, 0.06, 0);
  k.cyl('stoneBlue', 0.40, 0.50, 0.08, SEG, 0, 0.16, 0);

  // Floating tablets — 4-6 flat stone slabs at various heights and angles.
  const count = rangeInt(rng, 4, 6);
  for (let i = 0; i < count; i++) {
    const y = range(rng, 0.5, 1.8);
    const yaw = range(rng, 0, Math.PI * 2);
    const tilt = range(rng, -0.15, 0.15);
    const w = range(rng, 0.25, 0.40);
    const h = range(rng, 0.35, 0.55);
    const r = range(rng, 0.3, 0.6);
    const a = range(rng, 0, Math.PI * 2);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;

    // Stone tablet.
    k.box('stoneBlue', w, h, 0.05, x, y, z, [tilt, yaw, 0]);

    // Glowing inscription lines on the face.
    const lineCount = rangeInt(rng, 2, 4);
    for (let j = 0; j < lineCount; j++) {
      const ly = y - h / 2 + h * (j + 1) / (lineCount + 1);
      // The line sits slightly in front of the tablet face.
      const lineKey = j % 2 === 0 ? 'runePrimary' : 'runeSecondary';
      k.box(lineKey, w * 0.7, 0.02, 0.01,
        x, ly, z + 0.03, [tilt, yaw, 0]);
    }
  }

  // Central vertical rune — taller, facing +Z.
  k.box('stone', 0.30, 0.70, 0.06, 0, 1.05, 0);
  // Glowing symbol on its face.
  k.box('runePrimary', 0.15, 0.15, 0.01, 0, 1.15, 0.04);
  k.box('runePrimary', 0.02, 0.20, 0.01, 0, 1.05, 0.04);
  k.box('runePrimary', 0.02, 0.20, 0.01, 0, 1.05, 0.04, [0, 0, Math.PI / 2]);

  return k.finish(M(rng, {
    runePrimary: glow(arcane.primary, range(rng, 0.5, 0.7)),
    runeSecondary: glow(arcane.secondary, range(rng, 0.3, 0.5)),
  }));
}

// =============================================================================
// Crystal ball stand
// =============================================================================

/**
 * A crystal ball on an ornate iron stand. The ball itself is a glowing
 * sphere, the stand is thin dark iron. A classic mage prop.
 *
 * Bloom rule: the ball is the ONLY large glowing surface, so its intensity
 * is kept low (0.35-0.5) and its colour is saturated — never white.
 */
export function generateCrystalBallStand(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  // Pick a crystal colour.
  const CRYSTAL_COLORS = [
    { ball: PURPLE, glow: 0xc492ff },
    { ball: TEAL, glow: 0x7fd8ff },
    { ball: GREEN_ARCANE, glow: 0x9dfb63 },
    { ball: 0xff6060, glow: 0xff8888 }, // crimson seer
  ];
  const crystal = pick(rng, CRYSTAL_COLORS);

  // Three-legged iron base.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const footR = 0.30;
    k.box('iron', 0.04, 0.35, 0.04,
      Math.sin(a) * footR, 0.175, Math.cos(a) * footR,
      [range(rng, -0.15, -0.05), 0, 0]); // splay outward slightly
  }

  // Ring connecting the legs.
  k.torus('iron', 0.15, 0.02, 0, 0.18, 0, [Math.PI / 2, 0, 0]);

  // Central stem.
  k.cyl('iron', 0.025, 0.03, 0.45, 6, 0, 0.40, 0);

  // Cup / cradle holding the ball — three small prongs.
  const cupY = 0.62;
  const cupR = 0.15;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.cyl('iron', 0.015, 0.02, 0.12, 4,
      Math.sin(a) * cupR, cupY + 0.06, Math.cos(a) * cupR,
      [range(rng, 0.2, 0.4), a, 0]);
  }

  // The crystal ball itself — a sphere with a subtle glow.
  // Intensity kept LOW because the ball is a large surface.
  const ballR = range(rng, 0.12, 0.16);
  const ballY = cupY + ballR + 0.02;
  k.sphere('crystal', ballR, 0, ballY, 0);

  // Small highlight dot on top to catch the eye.
  k.sphere('crystalHighlight', ballR * 0.15, 0, ballY + ballR * 0.75, 0);

  return k.finish(M(rng, {
    crystal: glow(crystal.ball, range(rng, 0.35, 0.5)),
    crystalHighlight: glow(crystal.glow, 0.7),
  }));
}

// =============================================================================
// Potion shelf
// =============================================================================

/**
 * A wall-mounted shelf holding several coloured potion bottles.
 * Each bottle is a cylinder with a small neck, in a randomised colour.
 * The shelf itself is dark wood with iron brackets.
 *
 * The potion liquids use low-intensity glow so they catch light without
 * overwhelming the scene — same principle as cave crystals.
 */
export function generatePotionShelf(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const SHELF_W = range(rng, 1.2, 1.8);
  const SHELF_D = 0.22;
  // 0, not the 1.2 it was built at: this is a `mounted: 'wall'` prop, so its
  // origin IS the fixing point on the wall and the author sets the height.
  // Baked-in 1.2 made it fail the ground check with nothing to fix it to.
  const SHELF_Y = 0;

  // Shelf board.
  k.box('wood', SHELF_W, 0.05, SHELF_D, 0, SHELF_Y, 0);
  // Back board — a thin panel behind the shelf.
  k.box('woodDark', SHELF_W + 0.04, 0.40, 0.03, 0, SHELF_Y + 0.22, -(SHELF_D / 2 - 0.02));

  // Iron brackets — two, supporting the shelf from below.
  for (const sx of [-1, 1]) {
    const bx = sx * (SHELF_W / 2 - 0.12);
    // Vertical bracket arm.
    k.box('iron', 0.03, 0.25, 0.03, bx, SHELF_Y - 0.15, 0);
    // Horizontal support under the shelf.
    k.box('iron', 0.15, 0.03, SHELF_D * 0.7, bx, SHELF_Y - 0.04, 0.02);
    // Diagonal brace.
    k.box('iron', 0.025, 0.20, 0.025,
      bx - sx * 0.05, SHELF_Y - 0.12, 0.02, [0, 0, sx * 0.7]);
  }

  // Potion bottles — 4-7 of them on the shelf.
  const POTION_COLORS = [
    { liquid: 0xff3030, name: 'potionRed' },     // health
    { liquid: 0x3060ff, name: 'potionBlue' },     // mana
    { liquid: 0x30ff50, name: 'potionGreen' },    // poison/antidote
    { liquid: 0xff8020, name: 'potionOrange' },   // strength
    { liquid: 0xc040ff, name: 'potionPurple' },   // arcane
    { liquid: 0xffe030, name: 'potionYellow' },   // speed
  ];

  const bottleCount = rangeInt(rng, 4, 7);
  const spacing = (SHELF_W - 0.2) / bottleCount;

  for (let i = 0; i < bottleCount; i++) {
    const potion = pick(rng, POTION_COLORS);
    const bx = -SHELF_W / 2 + 0.1 + spacing * (i + 0.5);
    const bodyH = range(rng, 0.12, 0.22);
    const bodyR = range(rng, 0.035, 0.055);
    const neckH = range(rng, 0.05, 0.10);
    const neckR = bodyR * 0.4;

    // Glass body — a cylinder. Uses the potion's liquid colour as a
    // subtle glow at low intensity.
    k.cyl(potion.name, bodyR, bodyR * 0.9, bodyH, 8,
      bx, SHELF_Y + 0.025 + bodyH / 2, 0);

    // Glass neck.
    k.cyl(potion.name, neckR, bodyR * 0.5, neckH, 6,
      bx, SHELF_Y + 0.025 + bodyH + neckH / 2, 0);

    // Cork stopper.
    k.cyl('wood', neckR * 0.6, neckR * 0.8, 0.03, 5,
      bx, SHELF_Y + 0.025 + bodyH + neckH + 0.015, 0);

    // Small label tag on the bottle — a tiny square.
    if (chance(rng, 0.5)) {
      k.box('woodDark', 0.04, 0.05, 0.005,
        bx + bodyR + 0.005, SHELF_Y + 0.025 + bodyH * 0.5, 0);
    }
  }

  // Build the material set with per-potion glow colours.
  // Intensity kept low (0.25-0.4) — these are small but the shelf has many.
  const mats = M(rng);
  for (const p of POTION_COLORS) {
    if (mats[p.name]) continue; // already added by a previous bottle
    mats[p.name] = glow(p.liquid, range(rng, 0.25, 0.4));
  }
  return k.finish(mats);
}

// =============================================================================
// Spell book podium
// =============================================================================

/**
 * An ornate reading stand holding an open spell book. The book's pages
 * glow faintly with arcane energy. A classic wizard's study prop.
 */
export function generateSpellPodium(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const ARCANE_PAIRS = [
    { page: PURPLE, edge: 0xc492ff },
    { page: TEAL, edge: 0x7fd8ff },
    { page: GREEN_ARCANE, edge: 0x9dfb63 },
  ];
  const arcane = pick(rng, ARCANE_PAIRS);

  // Tripod base — three iron legs.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const footR = 0.30;
    k.cyl('iron', 0.02, 0.025, 0.85, 5,
      Math.sin(a) * footR, 0.425, Math.cos(a) * footR,
      [range(rng, 0.08, 0.18), a, 0]);
  }

  // Ring connecting legs at mid-height.
  k.torus('iron', 0.18, 0.015, 0, 0.35, 0, [Math.PI / 2, 0, 0]);

  // Central stem.
  k.cyl('iron', 0.025, 0.025, 1.1, 6, 0, 0.55, 0);

  // The desk/top surface — a flat angled board.
  const deskY = 1.10;
  k.box('wood', 0.55, 0.04, 0.40, 0, deskY, 0.04, [0.25, 0, 0]);

  // Desk edge lip — keeps the book from sliding off.
  k.box('woodDark', 0.55, 0.06, 0.03, 0, deskY - 0.01, 0.24, [0.25, 0, 0]);

  // The open book — two page panels splayed slightly.
  const bookY = deskY + 0.04;
  const openAngle = 0.18; // how much each page tilts open

  // Left page.
  k.box('page', 0.24, 0.30, 0.02, -0.12, bookY + 0.02, 0.08, [0.1, 0, -openAngle]);
  // Right page.
  k.box('page', 0.24, 0.30, 0.02, 0.12, bookY + 0.02, 0.08, [0.1, 0, openAngle]);

  // Spine.
  k.box('bookSpine', 0.04, 0.32, 0.04, 0, bookY + 0.02, 0.08, [0.1, 0, 0]);

  // Glowing rune symbols on the pages — small lines.
  for (const sx of [-1, 1]) {
    const px = sx * 0.12;
    const lineCount = rangeInt(rng, 2, 4);
    for (let j = 0; j < lineCount; j++) {
      const ly = bookY + range(rng, 0.02, 0.22);
      k.box('rune', 0.12, 0.012, 0.005,
        px + range(rng, -0.06, 0.06), ly, 0.10,
        [0.1, 0, sx * openAngle]);
    }
  }

  // Small candle on the desk.
  if (chance(rng, 0.6)) {
    const cx = range(rng, -0.15, 0.15);
    const cz = 0.08 + range(rng, 0.02, 0.10);
    k.cyl('iron', 0.02, 0.025, 0.06, 5, cx, deskY + 0.05, cz);
    k.cyl('candle', 0.012, 0.015, 0.10, 6, cx, deskY + 0.13, cz);
    // Tiny flame — emissive at low intensity.
    k.cyl('flame', 0.005, 0.012, 0.04, 5, cx, deskY + 0.20, cz);
  }

  return k.finish(M(rng, {
    page: glow(arcane.page, range(rng, 0.2, 0.35)),
    bookSpine: matte(0x3a2a1a),
    rune: glow(arcane.edge, range(rng, 0.4, 0.6)),
    candle: matte(0xe8dcc8),
    flame: glow(0xff8a2b, 0.7),
  }));
}
