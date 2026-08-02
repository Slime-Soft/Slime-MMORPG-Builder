// src/generators/environment/townProps.js
// Street furniture: market stalls, lanterns, barrels, crates, planters, a well,
// signboards and banner poles.
//
// Rebuilt on meshKit (2026-07-25). These were the map's biggest draw-call
// source by a wide margin — a street lantern was 14 separate meshes and a
// market stall 57, so 52 lanterns and 12 stalls alone cost ~1,400 draw calls.
// Merging per material takes each of them to 2-5, which is what makes it
// affordable to scatter hundreds of props around the city for mobile.
//
// Conventions: front is +Z, nothing self-rotates (the author aims it with
// prop.rotation), palettes run light, and no material sets `metalness` — there
// is no environment map in src/render, so a metallic surface renders black.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick } from '../seededRandom.js';
import { makeKit, matte, metal, stripedCloth } from './meshKit.js';

const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30];
const IRON = 0x6a6a74;
const STONE = [0x9a9aa0, 0xa6a6ac, 0x8e8e94];
const AWNING_PAIRS = [
  [0xc44a3f, 0xdfd5c0],
  [0x4f8a58, 0xdfd5c0],
  [0x3f6f9c, 0xdfd5c0],
  [0xc98b33, 0xe3dcc6],
];

const base = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  stone: matte(pick(rng, STONE)),
  iron: metal(IRON),
  ...extra,
});

/** Bulged staves with iron hoops. Shared by the barrel props and the stalls. */
function barrelAt(k, x, z, s = 1) {
  const h = 0.9 * s;
  const r = 0.34 * s;
  k.cyl('woodDark', r * 0.88, r * 0.97, h * 0.34, 12, x, h * 0.17, z);
  k.cyl('woodDark', r * 0.97, r * 0.97, h * 0.34, 12, x, h * 0.5, z);
  k.cyl('woodDark', r * 0.88, r * 0.97, h * 0.34, 12, x, h * 0.83, z);
  for (const hy of [0.2, 0.5, 0.8]) k.cyl('iron', r, r, 0.05 * s, 12, x, h * hy, z);
  k.cyl('lid', r * 0.86, r * 0.86, 0.05 * s, 12, x, h, z);
}

/** A plank crate with corner battens. */
function crateAt(k, x, z, s = 1, yaw = 0) {
  const w = 0.62 * s;
  k.box('wood', w, w * 0.82, w, x, w * 0.41, z, [0, yaw, 0]);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const ox = sx * w * 0.47, oz = sz * w * 0.47;
      k.box('woodDark', 0.07 * s, w * 0.86, 0.07 * s,
        x + ox * Math.cos(yaw) - oz * Math.sin(yaw), w * 0.41,
        z + ox * Math.sin(yaw) + oz * Math.cos(yaw), [0, yaw, 0]);
    }
  }
  k.box('woodDark', w * 1.02, 0.06 * s, w * 1.02, x, w * 0.78, z, [0, yaw, 0]);
}

// =============================================================================
// Market stall
// =============================================================================
export function generateMarketStall(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.9, D = 1.5;

  // --- Roof geometry, solved once so the frame can actually reach it ---
  // The old awning was TWO SLABS THAT CROSSED PAST EACH OTHER in an X at z=0,
  // each one's upper end protruding above the other, with the ridge beam
  // floating 5cm clear above the crossing and the posts stopping 27cm short of
  // the underside. That is what read as "holes in the roof": from ground level
  // the roof was a stack of separate floating strips with sky between them and
  // between the post tops and the cloth. The slopes now MEET at a ridge, the
  // beam is seated ON it, and the posts run up INTO the cloth.
  const TILT = 0.42;                       // radians, each slope
  const SLOPE = Math.tan(TILT);
  const RIDGE_Y = 2.86;                    // cloth centreline at the ridge
  const EAVE_Z = 1.05;                     // horizontal reach of each slope
  const OVER = 0.06;                       // how far each slope crosses the ridge
  const CLOTH_T = 0.06;
  /** Underside of the cloth directly above `z` — what the frame has to meet. */
  const underRoof = (z) => RIDGE_Y - Math.abs(z) * SLOPE - (CLOTH_T / 2) / Math.cos(TILT);

  const postZ = D / 2 - 0.08;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const h = underRoof(postZ) + 0.03; // 3cm into the cloth, so no gap and no flush face
      k.box('woodDark', 0.11, h, 0.11, sx * (W / 2 - 0.08), h / 2, sz * postZ);
    }
  }
  k.box('wood', W, 0.09, D, 0, 1.02, 0);
  k.box('woodDark', W * 0.96, 0.06, D * 0.9, 0, 0.45, 0);
  k.box('woodDark', W, 0.30, 0.07, 0, 0.85, D / 2 - 0.02);

  const [c1, c2] = pick(rng, AWNING_PAIRS);
  const stripes = 9;
  const AWN_W = W * 1.16;
  // Each slope is a single continuous sheet with the accent stripes as proud
  // ribs — see stripedCloth() in meshKit.js for why a row of side-by-side slabs
  // shows daylight between the stripes at grazing angles.
  const slopeLen = (EAVE_Z + OVER) / Math.cos(TILT);
  const slopeMidZ = (EAVE_Z - OVER) / 2;
  for (const zSide of [-1, 1]) {
    stripedCloth(k, {
      w: AWN_W, thru: slopeLen, t: CLOTH_T,
      x: 0, y: RIDGE_Y - slopeMidZ * SLOPE, z: zSide * slopeMidZ, tilt: zSide * TILT, stripes,
    });
  }
  // Ridge beam, seated over the join — deep enough to bury both slopes' tips.
  k.box('woodDark', AWN_W + 0.06, 0.13, 0.17, 0, RIDGE_Y + 0.05, 0);
  // Front valance, hung at the eave and overlapping the cloth's underside. It
  // used to hang 20cm inboard with a 2cm slot open to the sky above it.
  stripedCloth(k, {
    w: AWN_W, thru: 0.22, t: 0.05,
    x: 0, y: underRoof(EAVE_Z - 0.05) - 0.06, z: EAVE_Z - 0.05, stripes, vertical: true,
  });

  const goods = [0xd8534a, 0xe0a63c, 0x6da350, 0xc27ab8, 0xe4c95a];
  const goodsMat = pick(rng, goods);
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const gx = range(rng, -W * 0.4, W * 0.4);
    const gz = range(rng, -D * 0.22, D * 0.2);
    const r = range(rng, 0.08, 0.13);
    for (let j = 0; j < 3; j++) {
      k.ico('goods', r, gx + range(rng, -0.1, 0.1), 1.07 + r, gz + range(rng, -0.1, 0.1));
    }
  }
  crateAt(k, range(rng, -0.9, -0.4), -D * 0.1, 0.75, range(rng, 0, 1));
  barrelAt(k, W * 0.36, -D * 0.05, 0.8);

  return k.finish(base(rng, {
    stripeA: matte(c1), stripeB: matte(c2), goods: matte(goodsMat), lid: matte(0xb08a5e),
  }));
}

// =============================================================================
// Street lantern
// =============================================================================
export function generateStreetLantern(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('stone', 0.20, 0.26, 0.22, 8, 0, 0.11, 0);
  k.cyl('iron', 0.055, 0.10, 3.1, 8, 0, 1.65, 0);
  for (let i = 0; i < 3; i++) k.cyl('iron', 0.085, 0.085, 0.05, 8, 0, 0.45 + i * 0.16, 0);
  k.box('iron', 0.34, 0.05, 0.34, 0, 3.22, 0);
  k.cyl('lampGlass', 0.14, 0.19, 0.42, 4, 0, 3.46, 0, [0, Math.PI / 4, 0]);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.box('iron', 0.035, 0.44, 0.035, Math.cos(a) * 0.165, 3.46, Math.sin(a) * 0.165, [0, -a, 0]);
  }
  k.cyl('iron', 0.02, 0.24, 0.22, 4, 0, 3.78, 0, [0, Math.PI / 4, 0]);
  k.cyl('iron', 0.03, 0.03, 0.12, 6, 0, 3.94, 0);
  k.torus('iron', 0.11, 0.022, 0, 2.98, 0, null, Math.PI);
  return k.finish(base(rng, {
    iron: metal(0x50505a),
    lampGlass: new THREE.MeshStandardMaterial({
      color: 0xffe9b0, emissive: 0xffcf70, emissiveIntensity: 0.85,
      transparent: true, opacity: 0.72, roughness: 0.25,
    }),
  }));
}

// =============================================================================
// Barrels / crates / planter
// =============================================================================
export function generateBarrel(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  barrelAt(k, 0, 0, 1);
  return k.finish(base(rng, { lid: matte(0xb08a5e) }));
}

export function generateBarrelStack(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  barrelAt(k, -0.36, 0.05, 1);
  barrelAt(k, 0.36, -0.06, 1);
  // One on its side across the top.
  const h = 0.9 * 0.92, r = 0.34 * 0.92;
  k.cyl('woodDark', r * 0.95, r * 0.95, h, 10, 0, 0.9 + r, 0, [Math.PI / 2, 0.2, 0]);
  for (const o of [-h * 0.32, 0, h * 0.32]) {
    k.cyl('iron', r * 1.02, r * 1.02, 0.05, 10,
      Math.sin(0.2) * -o, 0.9 + r, Math.cos(0.2) * o, [Math.PI / 2, 0.2, 0]);
  }
  return k.finish(base(rng, { lid: matte(0xb08a5e) }));
}

export function generateCrate(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  crateAt(k, 0, 0, 1, 0);
  return k.finish(base(rng));
}

export function generateCrateStack(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  crateAt(k, -0.2, 0.1, 1, range(rng, -0.2, 0.2));
  crateAt(k, 0.42, -0.15, 0.8, range(rng, -0.3, 0.3));
  const w = 0.62 * 0.85;
  k.box('wood', w, w * 0.82, w, -0.16, 0.51 + w * 0.41, 0.06, [0, range(rng, -0.3, 0.3), 0]);
  k.box('woodDark', w * 1.02, 0.06, w * 1.02, -0.16, 0.51 + w * 0.78, 0.06);
  return k.finish(base(rng));
}

export function generateFlowerPlanter(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.15;
  k.box('woodDark', W, 0.36, 0.44, 0, 0.18, 0);
  k.box('wood', W * 1.06, 0.07, 0.5, 0, 0.38, 0);
  k.box('soil', W * 0.9, 0.05, 0.34, 0, 0.40, 0);
  const petal = pick(rng, [0xd8534a, 0xe8a0c0, 0xe4c95a, 0xc27ab8, 0xdcdccd]);
  for (let i = 0; i < 10; i++) {
    const px = range(rng, -W * 0.44, W * 0.44);
    const pz = range(rng, -0.16, 0.16);
    const ph = range(rng, 0.10, 0.26);
    k.cyl('leaf', 0.015, 0.02, ph, 4, px, 0.42 + ph / 2, pz);
    k.ico('bloom', range(rng, 0.055, 0.085), px, 0.42 + ph, pz);
  }
  for (let i = 0; i < 4; i++) {
    k.ico('leaf', range(rng, 0.07, 0.11),
      range(rng, -W * 0.42, W * 0.42), range(rng, 0.10, 0.26), 0.24, [1, 1.5, 0.7]);
  }
  return k.finish(base(rng, { soil: matte(0x4a3a2a), leaf: matte(0x4f7f3a), bloom: matte(petal) }));
}

// =============================================================================
// Town well
// =============================================================================
export function generateTownWell(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('stone', 1.05, 1.12, 0.85, 14, 0, 0.425, 0);
  k.cyl('stone', 1.16, 1.10, 0.14, 14, 0, 0.90, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box('stone', 0.34, 0.24, 0.14, Math.cos(a) * 1.06, 0.30 + (i % 2) * 0.26, Math.sin(a) * 1.06, [0, -a, 0]);
  }
  k.cyl('shaft', 0.94, 0.94, 0.05, 14, 0, 0.86, 0);
  for (const sx of [-1, 1]) k.box('woodDark', 0.14, 2.0, 0.14, sx * 0.95, 1.85, 0);
  k.box('woodDark', 2.3, 0.12, 0.12, 0, 2.85, 0);
  for (const sz of [-1, 1]) k.box('roof', 2.5, 0.1, 1.15, 0, 2.62, sz * 0.42, [sz * 0.62, 0, 0]);
  k.box('roofDark', 2.6, 0.12, 0.14, 0, 2.92, 0);
  k.cyl('woodDark', 0.1, 0.1, 1.7, 8, 0, 2.15, 0, [0, 0, Math.PI / 2]);
  k.box('woodDark', 0.05, 0.28, 0.05, 1.02, 2.02, 0);
  k.box('woodDark', 0.05, 0.05, 0.22, 1.02, 1.90, 0.10);
  k.cyl('rope', 0.014, 0.014, 0.95, 4, 0.25, 1.66, 0);
  k.cyl('woodDark', 0.19, 0.16, 0.28, 10, 0.25, 1.06, 0);
  k.cyl('iron', 0.195, 0.195, 0.04, 10, 0.25, 1.16, 0);
  return k.finish(base(rng, {
    shaft: matte(0x24242c), roof: matte(0xa8543f), roofDark: matte(0x8c4433), rope: matte(0xc9b48c),
  }));
}

// =============================================================================
// Signs and banners
// =============================================================================
export function generateShopSign(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.cyl('iron', 0.05, 0.07, 2.6, 8, 0, 1.3, 0);
  k.box('iron', 0.9, 0.05, 0.05, 0.42, 2.52, 0);
  k.box('iron', 0.05, 0.42, 0.05, 0.10, 2.30, 0, [0, 0, -0.7]);
  k.box('board', 0.96, 0.62, 0.07, 0.78, 2.10, 0);
  k.box('woodDark', 1.04, 0.07, 0.09, 0.78, 2.44, 0);
  k.box('woodDark', 1.04, 0.07, 0.09, 0.78, 1.76, 0);
  for (const sx of [-0.30, 0.30]) k.cyl('iron', 0.014, 0.014, 0.16, 4, 0.78 + sx, 2.49, 0);
  k.cyl('emblem', 0.18, 0.18, 0.02, 12, 0.78, 2.10, 0.05, [Math.PI / 2, 0, 0]);
  return k.finish(base(rng, {
    iron: metal(0x50505a),
    board: matte(pick(rng, [0x8c4433, 0x3f6f9c, 0x4f7f3a, 0x7a5636])),
    emblem: matte(0xe8dcc0),
  }));
}

export function generateBannerPole(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const cloth = pick(rng, [0xc44a3f, 0x3f6f9c, 0x4f7f3a, 0x8c4433, 0x6a4f9c]);
  k.cyl('stone', 0.26, 0.34, 0.3, 8, 0, 0.15, 0);
  k.cyl('woodDark', 0.07, 0.10, 5.2, 8, 0, 2.7, 0);
  k.cyl('finial', 0.08, 0.02, 0.3, 8, 0, 5.42, 0);
  k.box('woodDark', 0.9, 0.07, 0.07, 0.42, 5.05, 0);
  const rows = 7;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    k.box('cloth', 0.78 - t * 0.06, 0.29, 0.03, 0.42, 4.9 - i * 0.29, Math.sin(t * 2.4) * 0.05);
  }
  for (const sx of [-0.2, 0.2]) k.box('cloth', 0.3, 0.34, 0.03, 0.42 + sx, 2.72, 0.06);
  k.box('emblem', 0.34, 0.34, 0.035, 0.42, 4.3, 0.03);
  return k.finish(base(rng, {
    cloth: matte(cloth), emblem: matte(0xe8dcc0), finial: metal(0xd4ac52),
  }));
}
