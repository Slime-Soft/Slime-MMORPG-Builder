// src/generators/environment/countryside.js
// Everything outside the walls: farmsteads, crop fields, a windmill, a hunter's
// cabin, a fishing pier, and a mining camp.
//
// All built through meshKit, so each is a handful of draw calls no matter how
// many pieces it is made of. Conventions match the rest of the library: front is
// +Z, nothing self-rotates (the author aims it), palettes run light, and no
// material sets `metalness` (there is no environment map, so metal renders black).
//
// The pier has no collider, and the river it stands in is a `puddle`-kind water
// body — the one kind src/sim/collision.js deliberately does NOT block. Dennis
// will place invisible walls where players should be stopped, so nothing out
// here fences anyone in on its own.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';

const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30, 0x654626];
const LOG = [0xa87c4e, 0x9c7044, 0xb2865a];
const PLASTER = [0xf0e6d2, 0xe8dcc4, 0xf2ead6];
const ROOF_RED = [0xc05f3c, 0xb45538, 0xa94e34];
const THATCH = [0xcbab6a, 0xd6b877, 0xc0a05e];
const STONE = [0xb4aca0, 0xc0b8ab, 0xa9a196];
const IRON = 0x6a6a74;
const CROP_GREEN = [0x6da350, 0x5f9345, 0x79ad5c];

const M = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  log: matte(pick(rng, LOG)),
  plaster: matte(pick(rng, PLASTER)),
  roof: matte(pick(rng, ROOF_RED)),
  thatch: matte(pick(rng, THATCH)),
  stone: matte(pick(rng, STONE)),
  stoneDark: matte(0x8f877c),
  iron: metal(IRON),
  leaf: matte(pick(rng, CROP_GREEN)),
  soil: matte(0x5f4630),
  ...extra,
});

// =============================================================================
// Windmill
// =============================================================================
export function generateWindmill(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 13;
  // Tapered stone tower.
  k.cyl('stone', 3.0, 4.2, H, 12, 0, H / 2, 0);
  k.cyl('stoneDark', 4.5, 4.7, 0.6, 12, 0, 0.3, 0);
  for (const yy of [4.2, 8.4]) {
    k.cyl('stoneDark', 3.9 - (yy / H) * 0.9, 4.1 - (yy / H) * 0.9, 0.35, 12, 0, yy, 0);
  }
  // Gallery balcony.
  k.cyl('woodDark', 4.6, 4.6, 0.22, 12, 0, 6.5, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box('woodDark', 0.12, 0.9, 0.12, Math.cos(a) * 4.4, 7.05, Math.sin(a) * 4.4, [0, -a, 0]);
  }
  k.cyl('woodDark', 4.6, 4.6, 0.12, 12, 0, 7.5, 0);
  // Cap.
  k.cyl('roof', 1.2, 3.3, 1.6, 12, 0, H + 0.8, 0);
  k.sphere('roof', 1.3, 0, H + 1.7, 0, [1, 0.8, 1]);
  // Windshaft and four sails.
  k.cyl('woodDark', 0.28, 0.28, 2.4, 8, 0, H + 0.4, 3.4, [Math.PI / 2, 0, 0]);
  for (let s = 0; s < 4; s++) {
    const a = (s / 4) * Math.PI * 2 + 0.35;
    const ca = Math.cos(a), sa = Math.sin(a);
    // Whip (main spar).
    k.box('woodDark', 0.34, 12.5, 0.28, ca * 0, H + 0.4 + sa * 0, 4.3, [0, 0, a]);
    // Lattice bars along the sail.
    for (let j = 1; j <= 7; j++) {
      const d = j * 0.8 + 0.9;
      k.box('wood', 1.9, 0.16, 0.2, -sa * d, H + 0.4 + ca * d, 4.45, [0, 0, a]);
    }
    // Canvas panel on the trailing half.
    k.box('canvas', 1.5, 8.0, 0.1, -sa * 4.6 + ca * 0.85, H + 0.4 + ca * 4.6 + sa * 0.85, 4.55, [0, 0, a]);
  }
  // Door and a couple of windows.
  k.box('woodDark', 1.5, 2.4, 0.25, 0, 1.2, 4.05);
  k.box('stoneDark', 1.9, 2.8, 0.2, 0, 1.4, 3.95);
  for (const [wy, wa] of [[4.6, 0.9], [9.6, -0.7]]) {
    k.box('window', 0.9, 1.1, 0.2, Math.cos(wa) * 3.7, wy, Math.sin(wa) * 3.7, [0, -wa + Math.PI / 2, 0]);
  }
  return k.finish(M(rng, { canvas: matte(0xf2ead6), window: matte(0x37474f) }));
}

// =============================================================================
// Hunter's cabin — stacked-log construction
// =============================================================================
export function generateHunterCabin(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 8.0, D = 6.4, WALL = 4.2;
  const logR = 0.32;
  // Stacked log walls: each course is a row of cylinders, ends crossing at the
  // corners the way real log construction notches together.
  // EVERY course lays all four walls. The first version alternated - front/back
  // on even courses, sides on odd - which left each wall with a full log-
  // diameter gap between its logs. That is the hole-riddled cabin.
  // The two directions are offset vertically by half a diameter so the corners
  // interlock the way a real saddle notch does, while each wall stays a solid
  // stack of touching logs.
  const courses = Math.round(WALL / (logR * 2));
  for (let c = 0; c < courses; c++) {
    const yA = logR + c * logR * 2;
    const yB = yA + logR;
    for (const sz of [-1, 1]) {
      k.cyl('log', logR, logR, W + 0.8, 8, 0, yA, sz * D / 2, [0, 0, Math.PI / 2]);
    }
    for (const sx of [-1, 1]) {
      k.cyl('log', logR, logR, D + 0.8, 8, sx * W / 2, yB, 0, [Math.PI / 2, 0, 0]);
    }
  }
  // Gable ends (short logs stepping in).
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 5; j++) {
      const yy = WALL + logR + j * logR * 2;
      const len = (D + 0.8) * (1 - j / 5.5);
      k.cyl('log', logR, logR, len, 8, sx * W / 2, yy, 0, [Math.PI / 2, 0, 0]);
    }
  }
  // Roof: two shingled slopes with deep eaves and a ridge pole.
  const roofH = 3.0;
  const slope = Math.hypot(D / 2 + 0.9, roofH);
  const ang = Math.atan2(D / 2 + 0.9, roofH);
  for (const sz of [-1, 1]) {
    k.box('roof', W + 2.0, 0.24, slope, 0, WALL + roofH / 2 + 0.1, sz * (D / 2 + 0.9) / 2,
      [sz * (Math.PI / 2 - ang), 0, 0]);
  }
  k.cyl('woodDark', 0.24, 0.24, W + 2.4, 8, 0, WALL + roofH + 0.15, 0, [0, 0, Math.PI / 2]);
  // Stone chimney.
  k.box('stone', 1.3, WALL + roofH + 1.6, 1.3, W / 2 - 1.2, (WALL + roofH + 1.6) / 2, -D / 2 - 0.5);
  k.box('stoneDark', 1.6, 0.4, 1.6, W / 2 - 1.2, WALL + roofH + 1.7, -D / 2 - 0.5);
  // Porch: two posts and a small awning over the door.
  for (const sx of [-1, 1]) {
    k.cyl('woodDark', 0.16, 0.2, 2.6, 6, sx * 1.6, 1.3, D / 2 + 1.7);
  }
  k.box('roof', 4.4, 0.18, 2.2, 0, 2.85, D / 2 + 1.3, [0.35, 0, 0]);
  k.box('woodDark', 1.5, 2.3, 0.2, 0, 1.15, D / 2 + 0.15);
  k.box('log', 1.9, 0.25, 0.3, 0, 2.4, D / 2 + 0.2);
  // Window with shutters.
  k.box('window', 1.0, 0.9, 0.2, -2.4, 2.6, D / 2 + 0.1);
  for (const sx of [-1, 1]) k.box('woodDark', 0.5, 0.95, 0.1, -2.4 + sx * 0.78, 2.6, D / 2 + 0.2);
  // Antlers over the door and a woodpile against the wall.
  k.box('bone', 0.1, 0.5, 0.1, 0, 3.0, D / 2 + 0.22);
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      k.box('bone', 0.5, 0.08, 0.08, sx * (0.28 + j * 0.16), 3.05 + j * 0.16, D / 2 + 0.22, [0, 0, sx * -0.5]);
    }
  }
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3 - j; i++) {
      k.cyl('woodDark', 0.15, 0.15, 1.4, 7,
        -W / 2 - 0.7, 0.16 + j * 0.3, -1.2 + i * 0.33 + j * 0.16, [0, 0, Math.PI / 2]);
    }
  }
  return k.finish(M(rng, { window: matte(0x37474f), bone: matte(0xe4dcc4) }));
}

// =============================================================================
// Barn + granary
// =============================================================================
export function generateBarn(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 15, D = 10, WALL = 5.5;
  k.box('stoneDark', W + 0.6, 0.5, D + 0.6, 0, 0.25, 0);
  k.box('barnRed', W, WALL, D, 0, 0.5 + WALL / 2, 0);
  // Board-and-batten strips.
  for (let i = 0; i <= 14; i++) {
    const x = -W / 2 + (W * i) / 14;
    for (const sz of [-1, 1]) {
      k.box('trim', 0.22, WALL - 0.3, 0.12, x, 0.5 + WALL / 2, sz * (D / 2 + 0.04));
    }
  }
  // Gambrel roof: two pitches per side.
  const eave = 0.7;
  const y0 = 0.5 + WALL;
  const lowRun = D / 2 + eave - 2.2, lowRise = 2.4;
  const upRun = 2.2, upRise = 1.9;
  for (const sz of [-1, 1]) {
    const l1 = Math.hypot(lowRun, lowRise);
    k.box('roof', W + 1.4, 0.22, l1, 0, y0 + lowRise / 2, sz * (2.2 + lowRun / 2),
      [sz * -Math.atan2(lowRise, lowRun), 0, 0]);
    const l2 = Math.hypot(upRun, upRise);
    k.box('roof', W + 1.4, 0.22, l2, 0, y0 + lowRise + upRise / 2, sz * (upRun / 2),
      [sz * -Math.atan2(upRise, upRun), 0, 0]);
  }
  k.box('trim', W + 1.6, 0.26, 0.34, 0, y0 + lowRise + upRise + 0.08, 0);
  // Gable ends.
  for (const sx of [-1, 1]) {
    k.box('barnRed', 0.3, lowRise, (2.2 + lowRun) * 2, sx * W / 2, y0 + lowRise / 2, 0);
    k.box('barnRed', 0.3, upRise, upRun * 2, sx * W / 2, y0 + lowRise + upRise / 2, 0);
  }
  // Big sliding doors with an X brace, and a hayloft opening above.
  k.box('trim', 6.4, 4.6, 0.24, 0, 2.55, D / 2 + 0.12);
  for (const sx of [-1, 1]) {
    k.box('doorRed', 3.0, 4.3, 0.16, sx * 1.55, 2.5, D / 2 + 0.24);
    k.box('trim', 3.3, 0.2, 0.1, sx * 1.55, 2.5, D / 2 + 0.34, [0, 0, sx * 0.95]);
    k.box('trim', 3.3, 0.2, 0.1, sx * 1.55, 2.5, D / 2 + 0.34, [0, 0, sx * -0.95]);
  }
  k.box('woodDark', 2.4, 2.0, 0.2, 0, y0 + 1.1, D / 2 + 0.18);
  k.box('trim', 2.8, 0.24, 0.5, 0, y0 + 2.3, D / 2 + 0.5);
  return k.finish(M(rng, {
    barnRed: matte(pick(rng, [0xa8452f, 0x9c3f2c, 0xb44e35])),
    doorRed: matte(0x8c3a26), trim: matte(0xefe6d2),
  }));
}

export function generateGranary(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  // Staddle stones keep the grain store off the ground (and the rats out).
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.cyl('stone', 0.4, 0.55, 0.9, 8, sx * 1.3, 0.45, sz * 1.3);
    k.cyl('stone', 0.75, 0.4, 0.3, 8, sx * 1.3, 1.05, sz * 1.3);
  }
  k.box('woodDark', 3.6, 0.3, 3.6, 0, 1.35, 0);
  k.box('wood', 3.3, 3.4, 3.3, 0, 3.2, 0);
  for (let i = 0; i <= 6; i++) {
    const t = -1.65 + (3.3 * i) / 6;
    k.box('woodDark', 0.14, 3.4, 0.1, t, 3.2, 1.68);
    k.box('woodDark', 0.1, 3.4, 0.14, 1.68, 3.2, t);
  }
  k.cyl('thatch', 0.2, 2.9, 1.9, 8, 0, 5.85, 0);
  k.box('woodDark', 1.1, 1.6, 0.16, 0, 2.6, 1.72);
  // Little access ladder.
  for (let j = 0; j < 4; j++) k.box('woodDark', 0.9, 0.09, 0.09, 0, 0.4 + j * 0.42, 2.35);
  for (const sx of [-1, 1]) k.box('woodDark', 0.1, 2.2, 0.1, sx * 0.42, 1.1, 2.35, [0.28, 0, 0]);
  return k.finish(M(rng));
}

// =============================================================================
// Crop fields — planted rows on ploughed earth
// =============================================================================
function cropField(seed, build) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 7.0, D = 7.0;
  k.box('soil', W, 0.14, D, 0, 0.07, 0);
  // Furrow ridges, so bare earth still reads as worked ground.
  const rows = 8;
  for (let i = 0; i < rows; i++) {
    const z = -D / 2 + (D * (i + 0.5)) / rows;
    k.box('soilDark', W - 0.3, 0.16, D / rows * 0.55, 0, 0.16, z);
  }
  build(k, rng, W, D, rows);
  return k.finish(M(rng, {
    soilDark: matte(0x4a3626),
    wheat: matte(pick(rng, [0xd9bd77, 0xcfae64, 0xe0c684])),
    cabbage: matte(pick(rng, [0x7fae5c, 0x8fbc68])),
    pumpkin: matte(0xd97b2f),
    vine: matte(0x4f8a3f),
  }));
}

export function generateCropWheat(seed) {
  return cropField(seed, (k, rng, W, D, rows) => {
    for (let i = 0; i < rows; i++) {
      const z = -D / 2 + (D * (i + 0.5)) / rows;
      for (let j = 0; j < 13; j++) {
        const x = -W / 2 + 0.4 + (W - 0.8) * (j / 12);
        const h = range(rng, 0.85, 1.15);
        k.box('wheat', 0.16, h, 0.16, x, 0.2 + h / 2, z + range(rng, -0.1, 0.1),
          [range(rng, -0.06, 0.06), range(rng, 0, 1), range(rng, -0.06, 0.06)]);
        k.box('wheat', 0.26, 0.3, 0.26, x, 0.2 + h, z, [0, range(rng, 0, 1), 0]);
      }
    }
  });
}

export function generateCropCabbage(seed) {
  return cropField(seed, (k, rng, W, D, rows) => {
    for (let i = 0; i < rows; i += 2) {
      const z = -D / 2 + (D * (i + 0.5)) / rows;
      for (let j = 0; j < 8; j++) {
        const x = -W / 2 + 0.5 + (W - 1.0) * (j / 7);
        const r = range(rng, 0.26, 0.36);
        k.ico('cabbage', r, x, 0.22 + r * 0.6, z, [1, 0.75, 1]);
        for (let l = 0; l < 4; l++) {
          const a = (l / 4) * Math.PI * 2;
          k.ico('leaf', r * 0.7, x + Math.cos(a) * r * 0.8, 0.24, z + Math.sin(a) * r * 0.8, [1, 0.3, 1]);
        }
      }
    }
  });
}

export function generateCropPumpkin(seed) {
  return cropField(seed, (k, rng, W, D, rows) => {
    for (let i = 0; i < rows; i += 2) {
      const z = -D / 2 + (D * (i + 0.5)) / rows;
      for (let j = 0; j < 6; j++) {
        const x = -W / 2 + 0.6 + (W - 1.2) * (j / 5);
        const r = range(rng, 0.3, 0.45);
        k.sphere('pumpkin', r, x, 0.2 + r * 0.8, z, [1, 0.8, 1]);
        k.cyl('vine', 0.06, 0.08, 0.22, 5, x, 0.2 + r * 1.5, z);
        for (let l = 0; l < 3; l++) {
          const a = range(rng, 0, Math.PI * 2);
          k.ico('vine', range(rng, 0.2, 0.32), x + Math.cos(a) * 0.7, 0.24, z + Math.sin(a) * 0.7, [1, 0.22, 1]);
        }
      }
    }
  });
}

// =============================================================================
// Farmyard bits
// =============================================================================
export function generateScarecrow(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('woodDark', 0.09, 0.12, 2.5, 6, 0, 1.25, 0);
  k.box('woodDark', 1.7, 0.1, 0.1, 0, 1.95, 0);
  k.box('shirt', 0.62, 0.85, 0.42, 0, 1.72, 0);
  for (const sx of [-1, 1]) {
    k.cyl('shirt', 0.14, 0.11, 0.75, 6, sx * 0.6, 1.93, 0, [0, 0, Math.PI / 2]);
    k.cyl('straw', 0.09, 0.05, 0.24, 5, sx * 1.02, 1.93, 0, [0, 0, Math.PI / 2]);
  }
  k.sphere('sack', 0.28, 0, 2.36, 0);
  k.cyl('hat', 0.06, 0.3, 0.3, 8, 0, 2.66, 0);
  k.cyl('hat', 0.66, 0.66, 0.07, 8, 0, 2.52, 0);
  k.box('patch', 0.09, 0.09, 0.05, -0.11, 2.4, 0.26);
  k.box('patch', 0.09, 0.09, 0.05, 0.11, 2.4, 0.26);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.cyl('straw', 0.04, 0.02, 0.3, 4, Math.cos(a) * 0.2, 1.3, Math.sin(a) * 0.2, [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]);
  }
  return k.finish(M(rng, {
    shirt: matte(pick(rng, [0x8c5340, 0x4f7f78, 0x6a5a8c])),
    sack: matte(0xdcc9a0), hat: matte(0xcbab6a), straw: matte(0xd8bd77), patch: matte(0x3a2e26),
  }));
}

export function generateChickenCoop(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('woodDark', 2.6, 0.3, 2.0, 0, 0.15, 0);
  k.box('wood', 2.4, 1.5, 1.8, 0, 1.05, 0);
  for (let i = 0; i <= 5; i++) {
    k.box('woodDark', 0.1, 1.5, 0.08, -1.2 + (2.4 * i) / 5, 1.05, 0.91);
  }
  for (const sz of [-1, 1]) {
    k.box('roof', 2.9, 0.16, 1.35, 0, 2.05, sz * 0.5, [sz * 0.62, 0, 0]);
  }
  k.box('woodDark', 3.0, 0.14, 0.16, 0, 2.28, 0);
  // Pop-hole with a ramp.
  k.box('hole', 0.5, 0.55, 0.12, 0.7, 0.6, 0.92);
  k.box('woodDark', 0.55, 0.08, 1.5, 0.7, 0.35, 1.6, [0.42, 0, 0]);
  for (let i = 0; i < 4; i++) k.box('woodDark', 0.55, 0.06, 0.07, 0.7, 0.5 - i * 0.1, 1.15 + i * 0.32, [0.42, 0, 0]);
  // A nest box bumped out the side.
  k.box('wood', 0.7, 0.8, 1.4, -1.5, 0.95, 0);
  k.box('roof', 0.9, 0.12, 1.6, -1.55, 1.4, 0, [0, 0, -0.35]);
  return k.finish(M(rng, { hole: matte(0x2a2118) }));
}

export function generatePlough(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('woodDark', 0.16, 0.16, 2.6, 0, 0.62, 0, [0.12, 0, 0]);
  for (const sx of [-1, 1]) {
    k.cyl('woodDark', 0.07, 0.07, 1.5, 6, sx * 0.3, 0.95, -1.1, [-0.5, 0, 0]);
    k.cyl('woodDark', 0.06, 0.06, 0.3, 5, sx * 0.3, 1.55, -1.55, [0, 0, Math.PI / 2]);
  }
  k.cyl('iron', 0.55, 0.55, 0.12, 12, 0, 0.55, 1.15, [0, 0, Math.PI / 2]);
  k.cyl('woodDark', 0.09, 0.09, 0.5, 6, 0, 0.55, 1.15, [0, 0, Math.PI / 2]);
  // Share and mouldboard.
  k.box('iron', 0.42, 0.1, 0.85, 0, 0.16, 0.1, [0.3, 0, 0]);
  k.cone('iron', 0.3, 0.7, 4, 0, 0.2, 0.6, [Math.PI / 2, 0, 0]);
  k.box('iron', 0.06, 0.6, 0.7, 0.22, 0.4, 0.05, [0, 0, -0.4]);
  return k.finish(M(rng));
}

export function generateBeehive(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('woodDark', 1.0, 0.16, 1.0, 0, 0.08, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.box('woodDark', 0.1, 0.3, 0.1, sx * 0.36, 0.3, sz * 0.36);
  }
  // Skep: stacked straw coils.
  for (let j = 0; j < 5; j++) {
    const r = 0.52 - j * 0.075;
    k.cyl('straw', r - 0.03, r, 0.2, 10, 0, 0.5 + j * 0.2, 0);
  }
  k.sphere('straw', 0.3, 0, 1.52, 0, [1, 0.7, 1]);
  k.cyl('woodDark', 0.62, 0.62, 0.06, 10, 0, 1.62, 0);
  k.box('hole', 0.18, 0.1, 0.08, 0, 0.55, 0.5);
  return k.finish(M(rng, { straw: matte(pick(rng, [0xd8bd77, 0xcfb069])), hole: matte(0x2a2118) }));
}

export function generateWaterTrough(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('stone', 2.4, 0.7, 0.9, 0, 0.35, 0);
  k.box('water', 2.1, 0.1, 0.62, 0, 0.66, 0);
  for (const sx of [-1, 1]) k.box('stoneDark', 0.22, 0.85, 1.05, sx * 1.19, 0.42, 0);
  return k.finish(M(rng, {
    water: new THREE.MeshStandardMaterial({ color: 0x6fb8d8, roughness: 0.15, transparent: true, opacity: 0.85 }),
  }));
}

// =============================================================================
// Pier / fishing
// =============================================================================
/**
 * Deck height of the pier, in metres.
 *
 * TRADE-OFF, worth knowing before changing it: terrain here is flat and props
 * are not walkable surfaces, so the player always moves at y=0. A raised deck
 * therefore looks right but the character walks THROUGH it rather than on it.
 * This is set for the raised, piling-supported look of the reference; drop it
 * to ~0.35 if you would rather the player appear to stand on the boards.
 */
export const PIER_DECK_Y = 1.15;

/** Shared piling: a driven pole with a rope whipping near its head. */
function piling(k, x, z, top, r = 0.2) {
  k.cyl('woodDark', r, r * 1.15, top + 1.4, 8, x, (top + 1.4) / 2 - 1.4, z);
  k.cyl('wood', r * 1.12, r * 1.12, 0.2, 8, x, top + 0.06, z);
  for (let i = 0; i < 3; i++) {
    k.torus('rope', r * 1.25, 0.045, x, top - 0.34 - i * 0.11, z, [Math.PI / 2, 0, 0]);
  }
}

/** One 4m section of raised boardwalk. */
export function generatePierSection(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 4.0, W = 3.0, DY = PIER_DECK_Y;
  // Planks, laid across with visible gaps.
  for (let i = 0; i < 7; i++) {
    k.box('wood', W, 0.14, L / 7 - 0.07, 0, DY, -L / 2 + (L * (i + 0.5)) / 7);
  }
  // Bearers under the deck.
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.2, 0.2, L, sx * (W / 2 - 0.14), DY - 0.17, 0);
  }
  k.box('woodDark', W, 0.16, 0.2, 0, DY - 0.17, 0);
  // Four pilings, plus a cross-brace between each pair.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) piling(k, sx * (W / 2 - 0.16), sz * (L / 2 - 0.35), DY - 0.28);
    k.box('woodDark', 0.13, 0.13, L - 0.2, sx * (W / 2 - 0.16), DY - 0.85, 0);
  }
  k.box('woodDark', W - 0.3, 0.12, 0.12, 0, DY - 0.62, -L / 2 + 0.35);
  return k.finish(M(rng, { rope: matte(0xd6c7a4) }));
}

/**
 * Pier steps: the ramp up from the shore to a deck at PIER_DECK_Y.
 *
 * Built as real stair treads rather than a smooth slope because that's what
 * reads as climbable, but the WALKABLE surface it declares in propTypes.js is
 * a plain ramp across the same span — a stepped collision surface would make
 * the player judder up it one tread at a time for no visual gain.
 *
 * Faces local +Z going UP, matching the ramp's own low-to-high axis, so
 * rotating the prop rotates both together.
 */
export function generatePierStairs(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.6, D = 2.6, DY = PIER_DECK_Y;
  const STEPS = 5;
  const rise = DY / STEPS;
  const run = D / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const y = rise * (i + 1);
    const z = -D / 2 + run * (i + 0.5);
    k.box('wood', W, 0.13, run + 0.04, 0, y, z);          // tread
    k.box('woodDark', W - 0.1, rise, 0.1, 0, y - rise / 2, z - run / 2); // riser
  }
  // Stringers down both sides, sloped to follow the treads.
  const slope = Math.atan2(DY, D);
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.16, 0.34, Math.hypot(D, DY), sx * (W / 2 + 0.02), DY / 2 - 0.14, 0, [-slope, 0, 0]);
  }
  // A handrail on each side: two short posts and a sloped rail between them.
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.12, 0.95, 0.12, sx * (W / 2 - 0.02), 0.42, -D / 2 + 0.15);
    k.box('woodDark', 0.12, 0.95, 0.12, sx * (W / 2 - 0.02), DY + 0.42, D / 2 - 0.15);
    k.box('wood', 0.1, 0.11, Math.hypot(D - 0.3, DY), sx * (W / 2 - 0.02), DY / 2 + 0.86, 0, [-slope, 0, 0]);
  }
  // Two pilings under the top end, where it meets the deck.
  for (const sx of [-1, 1]) piling(k, sx * (W / 2 - 0.16), D / 2 - 0.3, DY - 0.3, 0.17);
  return k.finish(M(rng, { rope: matte(0xd6c7a4) }));
}

/** The pier head: a wider platform with rails, mooring post, lamp and cargo. */
export function generatePierHead(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 4.8, L = 4.8, DY = PIER_DECK_Y;
  for (let i = 0; i < 8; i++) {
    k.box('wood', W, 0.14, L / 8 - 0.07, 0, DY, -L / 2 + (L * (i + 0.5)) / 8);
  }
  for (const sx of [-1, 1]) k.box('woodDark', 0.22, 0.2, L, sx * (W / 2 - 0.16), DY - 0.17, 0);
  k.box('woodDark', W, 0.16, 0.22, 0, DY - 0.17, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) piling(k, sx * (W / 2 - 0.18), sz * (L / 2 - 0.4), DY - 0.28, 0.23);
    k.box('woodDark', 0.14, 0.14, L - 0.3, sx * (W / 2 - 0.18), DY - 0.9, 0);
  }
  // Rails down both sides.
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 3; j++) {
      k.box('woodDark', 0.14, 1.0, 0.14, sx * (W / 2 - 0.16), DY + 0.55, -L / 2 + 0.5 + j * 1.9);
    }
    k.box('wood', 0.11, 0.13, L - 0.6, sx * (W / 2 - 0.16), DY + 1.02, 0);
  }
  // Mooring post with a rope coil, and a lamp on an iron post.
  k.cyl('woodDark', 0.24, 0.28, 1.4, 8, W / 2 - 0.7, DY + 0.7, L / 2 - 0.7);
  k.torus('rope', 0.32, 0.06, W / 2 - 0.7, DY + 0.95, L / 2 - 0.7, [0.4, 0, 0.2]);
  k.cyl('iron', 0.07, 0.09, 2.5, 8, -W / 2 + 0.7, DY + 1.25, L / 2 - 0.7);
  k.box('iron', 0.42, 0.07, 0.42, -W / 2 + 0.7, DY + 2.52, L / 2 - 0.7);
  k.cyl('lamp', 0.17, 0.21, 0.42, 4, -W / 2 + 0.7, DY + 2.26, L / 2 - 0.7, [0, Math.PI / 4, 0]);
  // Cargo on the boards, as in the reference sheet.
  k.cyl('woodDark', 0.36, 0.33, 0.72, 10, -1.0, DY + 0.43, -0.9);
  for (const hy of [0.16, 0.56]) k.cyl('rope', 0.375, 0.375, 0.06, 10, -1.0, DY + 0.1 + hy, -0.9);
  k.box('crate', 0.7, 0.62, 0.7, 1.1, DY + 0.38, -1.1, [0, 0.4, 0]);
  k.box('crate', 0.56, 0.5, 0.56, 1.25, DY + 0.94, -0.85, [0, -0.25, 0]);
  for (let j = 0; j < 3; j++) {
    k.torus('rope', 0.3 - j * 0.06, 0.05, 0.4, DY + 0.1 + j * 0.05, 1.3, [Math.PI / 2, 0, 0]);
  }
  return k.finish(M(rng, {
    rope: matte(0xd6c7a4), crate: matte(0xb08a5e),
    lamp: new THREE.MeshStandardMaterial({
      color: 0xffe9b0, emissive: 0xffcf70, emissiveIntensity: 0.9,
      transparent: true, opacity: 0.75, roughness: 0.25,
    }),
  }));
}

export function generateRowboat(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 4.0;
  // Hull from tapering slabs — a stand-in for a real curved hull, but it reads.
  for (let i = 0; i < 7; i++) {
    const t = i / 6;
    const w = 1.4 * Math.sin(Math.PI * (0.15 + 0.7 * t)) + 0.25;
    k.box('hull', w, 0.62, L / 7, 0, 0.4, -L / 2 + (L * (i + 0.5)) / 7);
  }
  k.box('hullDark', 0.9, 0.14, L - 0.4, 0, 0.68, 0);
  for (const sz of [-1, 1]) k.box('hull', 0.45, 0.7, 0.5, 0, 0.42, sz * (L / 2 - 0.1), [sz * 0.5, 0, 0]);
  for (const bz of [-0.9, 0.6]) k.box('wood', 1.3, 0.1, 0.28, 0, 0.6, bz);
  for (const sx of [-1, 1]) {
    k.cyl('wood', 0.07, 0.05, 2.5, 6, sx * 0.5, 0.75, -0.3, [0, sx * 0.25, Math.PI / 2.2]);
    k.box('wood', 0.5, 0.05, 0.22, sx * 1.55, 0.5, -0.9, [0, sx * 0.25, 0]);
  }
  return k.finish(M(rng, {
    hull: matte(pick(rng, [0x8f6540, 0x7a5636, 0x9c7048])), hullDark: matte(0x5f4530),
  }));
}

export function generateFishRack(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.0;
  for (const sx of [-1, 1]) {
    k.cyl('woodDark', 0.09, 0.12, 2.2, 6, sx * W / 2, 1.1, 0);
    k.box('woodDark', 0.09, 1.4, 0.09, sx * W / 2, 0.7, 0.5, [0.5, 0, 0]);
    k.box('woodDark', 0.09, 1.4, 0.09, sx * W / 2, 0.7, -0.5, [-0.5, 0, 0]);
  }
  for (const yy of [2.1, 1.5]) k.cyl('woodDark', 0.06, 0.06, W + 0.4, 6, 0, yy, 0, [0, 0, Math.PI / 2]);
  const n = rangeInt(rng, 5, 8);
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + 0.3 + (W - 0.6) * (i / Math.max(1, n - 1));
    const yy = chance(rng, 0.5) ? 2.1 : 1.5;
    k.cyl('rope', 0.02, 0.02, 0.3, 4, x, yy - 0.15, 0);
    k.ico('fish', 0.2, x, yy - 0.45, 0, [0.45, 1.0, 0.28]);
    k.cone('fish', 0.14, 0.24, 4, x, yy - 0.72, 0, [Math.PI, 0, 0]);
  }
  return k.finish(M(rng, { rope: matte(0xc9b48c), fish: matte(0x9fb4bd) }));
}

// =============================================================================
// Mining camp
// =============================================================================
export function generateMineEntrance(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  // Rock mound the adit is driven into.
  for (let i = 0; i < 7; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0, 3.4);
    k.ico('rock', range(rng, 2.2, 3.6), Math.cos(a) * d, range(rng, 0.6, 2.4), -2.6 + Math.sin(a) * d * 0.5,
      [1, range(rng, 0.7, 1.1), 1]);
  }
  // The dark opening, framed by heavy timbers.
  k.box('void', 3.6, 3.6, 2.6, 0, 1.8, -0.6);
  for (const sx of [-1, 1]) k.box('timber', 0.5, 4.2, 0.6, sx * 2.05, 2.1, 0.9);
  k.box('timber', 4.9, 0.55, 0.6, 0, 4.05, 0.9);
  k.box('timber', 5.4, 0.35, 0.4, 0, 4.5, 0.75);
  for (const sx of [-1, 1]) k.box('timber', 0.32, 1.3, 0.4, sx * 1.65, 3.5, 0.85, [0, 0, sx * 0.75]);
  // Rails running out of the adit.
  for (const sx of [-1, 1]) k.box('iron', 0.09, 0.1, 7.0, sx * 0.45, 0.16, 2.8);
  for (let i = 0; i < 8; i++) k.box('woodDark', 1.5, 0.12, 0.24, 0, 0.09, -0.2 + i * 0.9);
  // Spoil heap and a lantern on a hook.
  for (let i = 0; i < 6; i++) {
    const a = range(rng, 0, Math.PI * 2);
    k.ico('rubble', range(rng, 0.3, 0.6), 3.2 + Math.cos(a) * 1.1, range(rng, 0.15, 0.45), 1.5 + Math.sin(a) * 1.1);
  }
  k.cyl('lamp', 0.16, 0.16, 0.34, 6, -1.9, 3.3, 1.2);
  return k.finish(M(rng, {
    rock: matte(pick(rng, [0x8f877c, 0x9a9188, 0x847c72])),
    rubble: matte(0x7a736a), void: matte(0x1c1814), timber: matte(0x6f4e30),
    lamp: glow(0xffcf70, 1.0),
  }));
}

export function generateOreCart(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 1.9, W = 1.2;
  k.box('iron', W, 0.12, L, 0, 0.5, 0);
  for (const sz of [-1, 1]) k.box('cart', W, 0.85, 0.14, 0, 0.95, sz * L / 2, [sz * -0.12, 0, 0]);
  for (const sx of [-1, 1]) k.box('cart', 0.14, 0.85, L, sx * W / 2, 0.95, 0, [0, 0, sx * 0.12]);
  for (const sx of [-1, 1]) for (const sz of [-0.55, 0.55]) {
    k.cyl('iron', 0.28, 0.28, 0.1, 10, sx * (W / 2 + 0.05), 0.28, sz, [0, 0, Math.PI / 2]);
  }
  k.cyl('iron', 0.05, 0.05, W + 0.3, 6, 0, 0.28, -0.55, [0, 0, Math.PI / 2]);
  k.cyl('iron', 0.05, 0.05, W + 0.3, 6, 0, 0.28, 0.55, [0, 0, Math.PI / 2]);
  // Heaped ore.
  for (let i = 0; i < 7; i++) {
    const a = range(rng, 0, Math.PI * 2);
    k.ico('ore', range(rng, 0.16, 0.26), Math.cos(a) * range(rng, 0, 0.35), range(rng, 1.25, 1.45), Math.sin(a) * range(rng, 0, 0.6));
  }
  return k.finish(M(rng, {
    cart: matte(0x6f4e30), ore: matte(pick(rng, [0xb5651d, 0xc7c7d0, 0xe8c34a])),
  }));
}

/** A timber winding tower over a shaft — the mining camp's landmark. */
export function generateMineHeadframe(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 8.5, S = 2.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.box('timber', 0.3, H, 0.3, sx * S, H / 2, sz * S, [sx * sz * 0.0, 0, 0]);
    k.box('timber', 0.26, H * 0.9, 0.26, sx * S * 0.55, H * 0.45, sz * S, [0, 0, sx * 0.34]);
  }
  for (const yy of [2.2, 5.0, 7.6]) {
    for (const sz of [-1, 1]) k.box('timber', S * 2 + 0.3, 0.24, 0.24, 0, yy, sz * S);
    for (const sx of [-1, 1]) k.box('timber', 0.24, 0.24, S * 2 + 0.3, sx * S, yy, 0);
  }
  k.box('timber', S * 2 + 0.9, 0.35, S * 2 + 0.9, 0, H + 0.2, 0);
  // Sheave wheel on top.
  k.torus('iron', 1.1, 0.14, 0, H + 1.4, 0, [0, Math.PI / 2, 0]);
  k.cyl('iron', 0.18, 0.18, 0.5, 8, 0, H + 1.4, 0, [0, 0, Math.PI / 2]);
  for (let i = 0; i < 6; i++) {
    k.box('iron', 0.1, 2.1, 0.1, 0, H + 1.4, 0, [0, Math.PI / 2, (i / 6) * Math.PI]);
  }
  // Cable down to the shaft, and the shaft collar itself.
  k.cyl('iron', 0.05, 0.05, H + 1.0, 6, 1.05, (H + 1.4) / 2, 0);
  k.box('timber', S * 2.4, 0.4, S * 2.4, 0, 0.2, 0);
  k.box('void', S * 1.5, 0.2, S * 1.5, 0, 0.42, 0);
  for (const sx of [-1, 1]) k.box('timber', 0.26, 0.9, S * 2.4, sx * S * 1.1, 0.6, 0);
  return k.finish(M(rng, { timber: matte(0x6f4e30), void: matte(0x141110) }));
}
