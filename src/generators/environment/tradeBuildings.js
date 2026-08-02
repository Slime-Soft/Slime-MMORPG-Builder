// src/generators/environment/tradeBuildings.js
// The town's trade shops and its church, built from Dennis's reference sheets
// (the "CRAFTING & SERVICES" row of the catalog sheet, the five shop fronts on
// sheet 3, and the churchyard on sheet 4).
//
// WHY THESE AREN'T MORE `townhouse.js` PRESETS: a preset there is a call to
// buildTownhouse with different numbers, and numbers alone cannot tell a baker
// from a jeweller — every preset comes out as the same half-timbered box in a
// different colour. What actually identifies these buildings in the reference
// is the STUFF ON THEM: a forge chimney the width of the facade, a copper still
// coiling over the roof, bolts of cloth stacked in the street, a log pile and a
// saw horse. So each shop here is
//
//     buildTownhouse(...)  +  a bespoke dressing group
//
// which keeps the shell pixel-identical to the houses already lining the
// street (same framing, windows, dormers, eaves) while making the trade
// readable from across the square. The church is the exception and is built
// outright, because its silhouette — nave, tower, spire — shares nothing with
// a townhouse.
//
// Conventions, same as the rest of the library: front is +Z, nothing
// self-rotates, and no material sets `metalness` (there is no environment map
// in src/render, so a metallic surface renders black — see meshKit.js).
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';
import { makeKit, matte, metal, stripedCloth } from './meshKit.js';
import { buildTownhouse, gableGeo, addWindowOn } from './townhouse.js';

const TIMBER = 0x4a3527;
const STONE = [0xc2b9aa, 0xb9b0a2, 0xcabfae];
const STONE_DARK = 0xa1978a;
const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = 0x6f4e30;
const IRON = 0x55555f;
const COPPER = 0xb87844;
const COPPER_LIGHT = 0xd89a63;

/** Every material key the dressing kits below use. */
const D = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(WOOD_DARK),
  timber: matte(TIMBER),
  stone: matte(pick(rng, STONE)),
  stoneLight: matte(0xc8bfaf),
  stoneDark: matte(STONE_DARK),
  iron: metal(IRON),
  copper: metal(COPPER),
  copperLight: metal(COPPER_LIGHT),
  cloth: matte(0xc44a3f),
  glass: new THREE.MeshStandardMaterial({ color: 0x3a5a6e, roughness: 0.25, metalness: 0 }),
  ...extra,
});

const EMBER = new THREE.MeshStandardMaterial({
  color: 0xff8c3a, emissive: 0xff5f14, emissiveIntensity: 1.3, roughness: 0.6, metalness: 0,
});

/**
 * Shell + dressing, merged into one Object3D.
 *
 * The two are separate meshKit passes rather than one, because the shell's kit
 * lives inside townhouse.js and has its own material set. Two groups is 5 + 3
 * draw calls for a whole shop, which is the same order as a plain house.
 */
function shopWith(seed, shellOpts, dressFn, extraMats = {}) {
  const rng = createRng(seed);
  const shell = buildTownhouse(seed, shellOpts);
  const k = makeKit();
  dressFn(k, rng, shellOpts);
  shell.add(k.finish(D(rng, extraMats)));
  return shell;
}

/** A barrel, matching townProps.js's so the two read as the same object. */
function barrel(k, x, y, z, s = 1) {
  const h = 0.9 * s, r = 0.34 * s;
  k.cyl('woodDark', r * 0.88, r * 0.97, h * 0.34, 10, x, y + h * 0.17, z);
  k.cyl('woodDark', r * 0.97, r * 0.97, h * 0.34, 10, x, y + h * 0.5, z);
  k.cyl('woodDark', r * 0.88, r * 0.97, h * 0.34, 10, x, y + h * 0.83, z);
  for (const hy of [0.2, 0.5, 0.8]) k.cyl('iron', r, r, 0.05 * s, 10, x, y + h * hy, z);
}

/**
 * A bracket sign hanging off an arm — every shop in the reference has one.
 *
 * `z` is passed as the WALL FACE plus 0.52, not plus 0.34: the townhouse shell
 * already puts a flower-box face at wall+0.34 (its D_BOX), and a sign landing on
 * the same plane flickers against it. The arm, board and battens are each at a
 * different depth here for the same reason.
 */
function hangingSign(k, x, y, z, emblemKey) {
  k.box('iron', 1.05, 0.08, 0.08, x + 0.5, y + 0.62, z - 0.03);
  k.box('iron', 0.08, 0.44, 0.08, x + 0.14, y + 0.42, z - 0.03, [0, 0, -0.7]);
  for (const sx of [-0.26, 0.26]) k.cyl('iron', 0.02, 0.02, 0.2, 4, x + 0.72 + sx, y + 0.5, z - 0.03);
  k.box('signBoard', 0.92, 0.62, 0.10, x + 0.72, y, z + 0.05);
  // Battens start 2 cm INSIDE the board's back face rather than flush with it.
  for (const dy of [0.31, -0.31]) k.box('woodDark', 1.0, 0.08, 0.14, x + 0.72, y + dy, z + 0.09);
  k.cyl(emblemKey, 0.17, 0.17, 0.03, 10, x + 0.72, y, z + 0.12, [Math.PI / 2, 0, 0]);
}

/** A lean-to roof on posts, projecting from a wall face at +Z. */
function leanTo(k, { x, w, zWall, reach, backY, frontY }) {
  const tilt = Math.atan2(backY - frontY, reach);
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.15, frontY, 0.15, x + sx * (w / 2 - 0.09), frontY / 2, zWall + reach - 0.09);
  }
  k.box('woodDark', w, 0.14, 0.14, x, frontY + 0.03, zWall + reach - 0.09);
  const len = Math.hypot(reach + 0.35, backY - frontY);
  k.box('roofPanel', w + 0.4, 0.13, len, x, (backY + frontY) / 2 + 0.12, zWall + reach / 2,
    [tilt, 0, 0]);
  // Rafters under it, so the underside isn't a bare slab.
  const n = Math.max(2, Math.round(w / 1.1));
  for (let i = 0; i < n; i++) {
    const rx = x - w / 2 + (w * (i + 0.5)) / n;
    k.box('woodDark', 0.09, 0.10, len - 0.2, rx, (backY + frontY) / 2 + 0.02, zWall + reach / 2, [tilt, 0, 0]);
  }
}

// =============================================================================
// Blacksmith
// =============================================================================

/**
 * The blacksmith. Built from the transcription in
 * references/blacksmith-massing.md — read that first.
 *
 * TWO CLOSED WINGS IN AN L, PLUS A FREE-STANDING FORGE.
 *
 * Two earlier attempts got this wrong in the same way: they invented an
 * open-fronted "forge hall" and a large masonry chimney stack attached to it,
 * neither of which is anywhere in the reference. The result was a building
 * whose oven appeared to be buried inside the house next door. What the
 * reference actually has:
 *
 *   A  left wing   — closed half-timbered house, stone below, ridge along X
 *   B  right wing  — closed, BIGGER and STEEPER, turned 90° so the ridges
 *                    cross and the two form an L; carries a SMALL ridge chimney
 *   C  forge       — free-standing on the ground, clear of both wings: stone
 *                    base, arched mouth with fire, tapering hood, short stack
 *
 * The gap between C and the buildings is load-bearing. You must be able to see
 * ground between them, or it reads as an oven built into a wall again.
 *
 * Front is +Z.
 */
export function generateBlacksmith(seed) {
  const rng = createRng(seed);

  // --- A: left wing --------------------------------------------------------
  const AW = 5.6, AD = 5.0;
  const AX = -3.1, AZ = 0.9;
  const wingA = buildTownhouse(seed, {
    width: AW, depth: AD, storeys: 2, storeyH: 2.5, jetty: 0.24,
    stoneBase: true, roofPitch: 1.15, eave: 0.5,
    roof: 0x5d6b7c, plaster: 0xe0d7c3, plasterUpper: 0xe3dcc7, shutter: 0x4d5f6b,
    stone: 0x9aa0a2, skipFaces: ['+x'],
    dormers: 0, chimney: false, doorHood: true,
  });
  wingA.position.set(AX, 0, AZ);

  // --- B: right wing, turned 90° so the two ridges cross -------------------
  const BW = 6.2, BD = 5.6;
  const BX = 2.6, BZ = -1.4;
  const wingB = buildTownhouse(seed + 7919, {
    width: BW, depth: BD, storeys: 2, storeyH: 2.75, jetty: 0.26,
    stoneBase: true, roofPitch: 1.45, eave: 0.55,          // steeper than A
    roof: 0x55636f, plaster: 0xdfd6c1, plasterUpper: 0xe2dac7, shutter: 0x4d5f6b,
    stone: 0x949a9c, skipFaces: ['-z'],
    dormers: 0, chimney: false, doorHood: false,
  });
  wingB.position.set(BX, 0, BZ);
  wingB.rotation.y = Math.PI / 2;

  const k = makeKit();

  // A SMALL chimney on B's ridge — window-sized, per identity feature #3.
  //
  // Its height has to be derived from B's ACTUAL ridge, not guessed: B jetties,
  // so the roof is built from halfD + jetty*0.8, and B is rotated 90° so its
  // ridge runs along world Z at x = BX. A first pass put it 0.9 m off the ridge
  // at a guessed height and it ended up 98% inside the roof.
  const bHalfDTop = BD / 2 + 0.26 * 0.8;
  const bRidgeY = 2.75 * 2 + bHalfDTop * 1.45;
  k.box('stoneDark', 0.58, 2.6, 0.58, BX, bRidgeY - 0.4, BZ + 1.4);
  k.box('stoneLight', 0.76, 0.18, 0.76, BX, bRidgeY + 0.99, BZ + 1.4);

  // --- C: the free-standing forge -----------------------------------------
  // Set BEYOND wing B's right-hand edge, not merely in front of it. B is
  // rotated, so its footprint reaches x ≈ 5.4; at x = 5.0 the forge was tucked
  // against its front wall and read as built into it — the exact complaint the
  // previous two attempts drew. At 7.2 there is 1.8 m of open ground between
  // them and you can see grass all the way round the forge, which is identity
  // feature #4 and the whole reason it is a free-standing structure.
  const FX = 7.2, FZ = 1.9;
  const FW = 1.95, FD = 1.4;
  k.box('stoneDark', FW + 0.4, 0.18, FD + 0.4, FX, 0.09, FZ);        // footing
  k.box('stone', FW, 0.95, FD, FX, 0.65, FZ);                        // base block
  k.box('stoneLight', FW + 0.16, 0.12, FD + 0.16, FX, 1.18, FZ);     // capping course
  // Arched mouth, facing +Z, with the fire AT the mouth so it is actually seen.
  const MZ = FZ + FD / 2;
  k.box('sooty', 1.25, 0.62, 0.4, FX, 0.55, MZ - 0.1);
  k.cyl('sooty', 0.62, 0.62, 0.4, 12, FX, 0.86, MZ - 0.1, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
  k.torus('stoneLight', 0.72, 0.13, FX, 0.86, MZ + 0.06, null, Math.PI);
  for (const sx of [-1, 1]) k.box('stoneLight', 0.15, 0.64, 0.16, FX + sx * 0.68, 0.55, MZ + 0.06);
  k.box('coal', 1.05, 0.16, 0.3, FX, 0.36, MZ + 0.02);
  for (let i = 0; i < 8; i++) {
    k.ico('ember', range(rng, 0.1, 0.17),
      FX + range(rng, -0.42, 0.42), range(rng, 0.42, 0.56), MZ + 0.05 + range(rng, -0.07, 0.07), [1, 0.75, 1]);
  }
  // The TAPERING HOOD — identity feature #5, and the single silhouette that
  // makes this read as a forge rather than as a fireplace.
  k.cyl('stone', 0.42, FW * 0.72, 1.25, 4, FX, 1.86, FZ, [0, Math.PI / 4, 0]);
  k.box('stone', 0.52, 0.75, 0.52, FX, 2.86, FZ);
  k.box('stoneLight', 0.68, 0.14, 0.68, FX, 3.3, FZ);

  // --- on the ground, all free-standing (identity feature #7) --------------
  // Anvil, prominent, in front of the forge and slightly left of it.
  const ax = FX - 2.3, az = FZ + 0.5;
  k.cyl('woodDark', 0.36, 0.42, 0.55, 10, ax, 0.275, az);
  k.box('iron', 0.46, 0.15, 1.1, ax, 0.645, az);
  k.box('iron', 0.29, 0.14, 0.75, ax, 0.79, az);
  k.box('iron', 0.38, 0.14, 1.02, ax, 0.93, az);
  k.cone('iron', 0.15, 0.55, 6, ax, 0.93, az + 0.78, [Math.PI / 2, 0, 0]);
  // Three-legged stool.
  const sx0 = ax - 1.3, sz0 = az + 0.3;
  k.cyl('wood', 0.23, 0.25, 0.08, 8, sx0, 0.46, sz0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    k.box('woodDark', 0.06, 0.46, 0.06, sx0 + Math.cos(a) * 0.15, 0.23, sz0 + Math.sin(a) * 0.15,
      [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12]);
  }
  // Workbench at the far left.
  const wx = AX - 2.5, wz = AZ + 4.1;
  k.box('wood', 1.5, 0.1, 0.72, wx, 0.86, wz);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.box('woodDark', 0.1, 0.86, 0.1, wx + dx * 0.62, 0.43, wz + dz * 0.28);
  }
  // One per leg plane — a single stretcher on the centreline touches neither.
  for (const dz of [-1, 1]) k.box('woodDark', 1.3, 0.08, 0.1, wx, 0.3, wz + dz * 0.28);
  // Barrels, and a wide tub heaped with coal to the right of the forge.
  barrel(k, AX - 3.4, 0, AZ + 2.5, 1.0);
  barrel(k, FX - 1.1, 0, FZ + 1.7, 0.95);
  const tx = FX + 1.9, tz = FZ - 0.3;
  k.cyl('woodDark', 0.62, 0.56, 0.9, 12, tx, 0.45, tz);
  for (const hy of [0.18, 0.72]) k.cyl('iron', 0.635, 0.635, 0.06, 12, tx, hy, tz);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const r = i === 0 ? 0 : range(rng, 0.1, 0.42);
    k.ico('coal', range(rng, 0.13, 0.2), tx + Math.cos(a) * r, 0.94 + range(rng, -0.04, 0.1), tz + Math.sin(a) * r);
  }
  // Cut logs lying on the ground right of the forge.
  for (let i = 0; i < 4; i++) {
    k.cyl('bark', 0.14, 0.14, 1.5, 8, FX + 1.0 + (i % 2) * 0.34, 0.14 + Math.floor(i / 2) * 0.26, FZ + 2.0 + (i % 2) * 0.1,
      [0, range(rng, -0.14, 0.14), Math.PI / 2]);
  }

  const forge = k.finish({
    stone: matte(0xbcb3a4),
    stoneLight: matte(0xc8bfaf),
    stoneDark: matte(0x9d9486),
    sooty: matte(0x241f1b),
    coal: matte(0x25221f),
    ember: EMBER,
    iron: metal(0x4e4e58),
    wood: matte(pick(rng, WOOD)),
    woodDark: matte(WOOD_DARK),
    bark: matte(0x8a6c4c),
  });

  const root = new THREE.Group();
  root.add(wingA, wingB, forge);
  return root;
}

// =============================================================================
// Bakery
// =============================================================================

/**
 * The bakery. Built from references/bakery-massing.md — note that its only
 * source is a thumbnail icon, so this deliberately stays in the town's
 * established half-timbered style rather than inventing detail.
 *
 * `buildTownhouse` IS the right shell here (unlike the blacksmith): the icon
 * shows a plain half-timbered block. What identifies it is the terracotta roof
 * — the only warm roof in the row — plus a projecting brick oven on the left
 * gable end and a bread counter under an awning.
 *
 * Front is +Z.
 */
export function generateBakery(seed) {
  const W = 9.0, Dp = 6.6;
  const STOREY = 2.75, STOREYS = 2, JETTY = 0.24;

  return shopWith(seed, {
    width: W, depth: Dp, storeys: STOREYS, storeyH: STOREY, jetty: JETTY,
    stoneBase: true, roofPitch: 1.2, eave: 0.6,
    roof: 0xc06a42, plaster: 0xe2dac6, plasterUpper: 0xe4dcc9, shutter: 0xc98b33,
    stone: 0x9aa0a2, dormers: 1, chimney: false, doorHood: true,
  }, (k, rng) => {
    const halfW = W / 2;
    // Measured from the JETTIED front face — the upper storey overhangs, and a
    // counter built on the ground-floor face gets swallowed by the floor above.
    const fz = Dp / 2 + JETTY * 0.8 * (STOREYS - 1) + 0.06;

    // --- brick oven, projecting off the LEFT gable end, on the ground -------
    const OX = -halfW - 1.15, OZ = 0.4;
    k.box('brickDark', 2.9, 0.28, 2.9, OX, 0.14, OZ);
    k.box('brick', 2.5, 1.9, 2.5, OX, 1.23, OZ);
    k.box('brickDark', 2.72, 0.22, 2.72, OX, 2.29, OZ);
    // Domed top.
    k.sphere('brick', 1.3, OX, 2.3, OZ, [0.96, 0.62, 0.96]);
    // Arched mouth facing +Z, with fire at the mouth so it is actually seen.
    const MZ = OZ + 1.25;
    k.box('sooty', 1.15, 0.62, 0.32, OX, 0.72, MZ);
    k.cyl('sooty', 0.57, 0.57, 0.32, 10, OX, 1.03, MZ, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
    k.torus('brickDark', 0.68, 0.14, OX, 1.03, MZ + 0.13, null, Math.PI);
    for (const s of [-1, 1]) k.box('brickDark', 0.17, 0.66, 0.2, OX + s * 0.63, 0.72, MZ + 0.13);
    k.box('coal', 0.9, 0.14, 0.24, OX, 0.5, MZ + 0.1);
    for (let i = 0; i < 6; i++) {
      k.ico('ember', range(rng, 0.08, 0.14), OX + range(rng, -0.34, 0.34), range(rng, 0.56, 0.66), MZ + 0.12, [1, 0.75, 1]);
    }
    // Brick chimney up the oven's back, clearing the roof.
    k.box('brick', 1.0, 6.0, 1.0, OX, 3.0, OZ - 0.85);
    for (let i = 0; i < 3; i++) k.box('brickDark', 1.14, 0.16, 1.14, OX, 3.2 + i * 1.3, OZ - 0.85);
    k.box('brickDark', 1.22, 0.24, 1.22, OX, 5.9, OZ - 0.85);

    // --- counter under a striped awning, RIGHT of the door -----------------
    const CX = 3.3, CW = 3.4;   // clear of the shell's door approach at x = 0
    // stripedCloth writes into the 'stripeA'/'stripeB' keys, which have to be in
    // the material set below — a per-call random pick can't reach it.
    stripedCloth(k, {
      w: CW + 0.5, thru: 1.55, t: 0.06, x: CX, y: 2.78, z: fz + 0.66, tilt: 0.42, stripes: 9,
    });
    stripedCloth(k, {
      w: CW + 0.5, thru: 0.26, t: 0.05, x: CX, y: 2.3, z: fz + 1.34, stripes: 9, vertical: true,
    });
    for (const s of [-1, 1]) k.box('woodDark', 0.12, 2.5, 0.12, CX + s * (CW / 2 + 0.1), 1.25, fz + 1.28);
    k.box('wood', CW, 0.12, 0.9, CX, 1.02, fz + 0.5);
    k.box('woodDark', CW - 0.2, 0.85, 0.1, CX, 0.58, fz + 0.9);
    for (const s of [-1, 1]) k.box('woodDark', 0.14, 1.0, 0.14, CX + s * (CW / 2 - 0.25), 0.5, fz + 0.5);
    // Loaves and buns in trays on the counter.
    for (let t = 0; t < 3; t++) {
      const tx = CX - 1.15 + t * 1.15;
      k.box('woodDark', 1.0, 0.09, 0.62, tx, 1.13, fz + 0.5);
      for (let i = 0; i < 4; i++) {
        k.sphere(t === 1 ? 'crustDark' : 'crust', range(rng, 0.12, 0.18),
          tx + range(rng, -0.36, 0.36), 1.26, fz + 0.5 + range(rng, -0.18, 0.18), [1.5, 0.78, 0.95]);
      }
    }

    // --- flour sacks and barrels on the ground, clear of the door ----------
    // The shell's door is at x = 0, so its approach is deliberately empty.
    for (const [sx, sz, s] of [[CX + 2.3, 0.7, 1.0], [CX + 2.75, 1.5, 0.85]]) {
      k.sphere('sack', 0.3 * s, sx, 0.29 * s, fz + sz, [1, 1.25, 0.85]);
      k.cyl('rope', 0.075 * s, 0.1 * s, 0.1 * s, 6, sx, 0.72 * s, fz + sz);
      k.cone('sack', 0.12 * s, 0.2 * s, 5, sx, 0.82 * s, fz + sz);
    }
    barrel(k, -halfW - 0.3, 0, fz + 1.5, 1.0);
    barrel(k, CX + 3.3, 0, fz + 0.2, 0.92);
  }, {
    brick: matte(0xa8624a), brickDark: matte(0x8c4f3c),
    sooty: matte(0x241f1b), coal: matte(0x25221f), ember: EMBER,
    stripeA: matte(0xc44a3f), stripeB: matte(0xe3dcc6),
    crust: matte(0xd8a860), crustDark: matte(0xa8763c),
    sack: matte(0xd9c9a8), rope: matte(0x8a7247),
  });
}

// =============================================================================
// Tailor
// =============================================================================

/**
 * The tailor. Built from the transcription in references/tailor-massing.md.
 *
 * ONE long half-timbered building — unlike the blacksmith, `buildTownhouse` IS
 * the right shell here, because the reference's tailor genuinely is a single
 * long half-timbered block. What identifies it is on and around that block:
 * a PATCHWORK roof of individually coloured shingle panels, a large projecting
 * bracket sign with scissors, an open shopfront, and a pyramid of coloured
 * cloth bolts stacked on the ground.
 *
 * Front is +Z; the gable ends face ±X and the sign projects off -X.
 */
export function generateTailor(seed) {
  const W = 11.0, Dp = 6.4;
  const STOREY = 2.75, STOREYS = 2, JETTY = 0.26, PITCH = 1.25, EAVE = 0.6;

  return shopWith(seed, {
    width: W, depth: Dp, storeys: STOREYS, storeyH: STOREY, jetty: JETTY,
    stoneBase: true, roofPitch: PITCH, eave: EAVE,
    roof: 0x5a6b78, plaster: 0xe0d6c2, plasterUpper: 0xe3dcc7, shutter: 0x6a4f8c,
    stone: 0x9aa0a2, dormers: 2, chimney: true, doorHood: false,
  }, (k, rng) => {
    const halfW = W / 2;
    // The shell's TOP-storey half-depth, which is what the roof is built from:
    // buildTownhouse jetties each storey above the ground out by jetty * 0.8.
    const halfD = Dp / 2 + JETTY * 0.8 * (STOREYS - 1);
    const wallTop = STOREY * STOREYS;
    const roofH = halfD * PITCH;
    const slopeD = halfD + EAVE;
    const tilt = Math.atan2(slopeD, roofH);          // matches the shell's slabs
    const BOLTS = ['bolt1', 'bolt2', 'bolt3', 'bolt4', 'bolt5', 'bolt6'];
    // NO patchwork roof panels. The reference's roof is a patchwork of coloured
    // shingles, but at this poly count and cel-shading it came out as confetti
    // in both a muted and a saturated palette — Dennis's call was to drop it.

    // --- identity feature #4: a LARGE bracket sign off the -X gable ---
    const gx = -halfW - 0.1;
    k.box('iron', 1.5, 0.11, 0.11, gx - 0.75, 5.4, 0.2);
    k.box('iron', 0.11, 0.85, 0.11, gx - 0.28, 4.98, 0.2, [0, 0, 0.62]);
    for (const dx of [-0.5, 0.5]) k.cyl('iron', 0.03, 0.03, 0.36, 5, gx - 1.25 + dx, 5.2, 0.2);
    k.box('signBoard', 1.75, 1.35, 0.13, gx - 1.25, 4.35, 0.2);
    for (const dy of [0.62, -0.62]) k.box('woodDark', 1.9, 0.14, 0.17, gx - 1.25, 4.35 + dy, 0.2);
    // Scissors: two crossed blades and two bows.
    for (const s of [-1, 1]) {
      k.box('emblem', 0.09, 0.85, 0.06, gx - 1.25, 4.5, 0.29, [0, 0, s * 0.28]);
      k.torus('emblem', 0.17, 0.05, gx - 1.25 + s * 0.24, 3.98, 0.29, null, Math.PI * 2);
    }
    k.cyl('iron', 0.06, 0.06, 0.1, 6, gx - 1.25, 4.42, 0.31, [Math.PI / 2, 0, 0]);

    // --- identity feature #5: open shopfront under the jetty ---
    // Measured from the JETTIED front face, not the ground-floor one. The
    // upper storey overhangs by jetty * 0.8 per storey, so a shopfront built on
    // Dp/2 sits 21 cm behind the floor above it and gets visibly swallowed —
    // the counter and its cloth looked embedded in the wall.
    const fz = Dp / 2 + JETTY * 0.8 * (STOREYS - 1) + 0.06;
    // Centred at x = -3.0, not -1.6: the shell's front door is at x = 0 and a
    // 4.6 m shopfront centred at -1.6 ran straight across it.
    const SFX = -3.0, SFW = 3.4;
    k.box('shopDark', SFW, 2.15, 0.3, SFX, 1.15, fz - 0.02);
    for (const dx of [-1, 1]) k.box('timber', 0.24, 2.3, 0.42, SFX + dx * SFW / 2, 1.15, fz + 0.06);
    k.box('timber', SFW + 0.5, 0.26, 0.42, SFX, 2.36, fz + 0.06);
    k.box('wood', SFW - 0.1, 0.14, 0.75, SFX, 1.0, fz + 0.26);        // counter
    for (const dx of [-1.5, 0, 1.5]) k.box('woodDark', 0.16, 1.0, 0.6, SFX + dx, 0.5, fz + 0.26);
    // Folded cloth on the counter, and bolts on a shelf behind it.
    for (let i = 0; i < 7; i++) {
      const cx = SFX - 1.4 + i * 0.47;
      const n = 2 + (i % 3);
      for (let j = 0; j < n; j++) {
        k.box(BOLTS[(i + j) % BOLTS.length], 0.42, 0.1, 0.42, cx, 1.12 + j * 0.11, fz + 0.26);
      }
    }
    k.box('woodDark', SFW - 0.2, 0.09, 0.26, SFX, 1.75, fz - 0.02);
    for (let i = 0; i < 6; i++) {
      k.cyl(BOLTS[i % BOLTS.length], 0.13, 0.13, 0.5, 8, SFX - 1.35 + i * 0.54, 1.93, fz - 0.02, [0, 0, Math.PI / 2]);
    }

    // --- identity feature #6: pyramid of cloth bolts, right of the building ---
    const bx = halfW + 1.35, bz = fz - 0.6;
    let ci = 0;
    for (let row = 0; row < 4; row++) {
      const n = 4 - row;
      for (let i = 0; i < n; i++) {
        k.cyl(BOLTS[ci++ % BOLTS.length], 0.17, 0.17, 1.15, 10,
          bx, 0.18 + row * 0.32, bz - (n - 1) * 0.18 + i * 0.36,
          [0, range(rng, -0.06, 0.06), Math.PI / 2]);
      }
    }
    // A few stood on end beside the stack.
    for (let i = 0; i < 3; i++) {
      k.cyl(BOLTS[(ci + i) % BOLTS.length], 0.15, 0.15, 1.3, 10,
        bx + 0.75 + i * 0.34, 0.65, bz + 1.0, [range(rng, -0.05, 0.05), 0, range(rng, -0.07, 0.07)]);
    }

    // --- identity feature #7: spinning wheel, tables, barrel, left of it ----
    const sx0 = -halfW - 1.6, sz0 = fz + 0.4;
    k.cyl('woodDark', 0.6, 0.6, 0.06, 16, sx0, 0.78, sz0, [0, 0, Math.PI / 2]);
    k.cyl('wood', 0.53, 0.53, 0.04, 16, sx0 + 0.04, 0.78, sz0, [0, 0, Math.PI / 2]);
    for (let i = 0; i < 8; i++) {
      k.box('woodDark', 0.05, 1.1, 0.05, sx0, 0.78, sz0, [(i / 8) * Math.PI, 0, 0]);
    }
    k.box('woodDark', 0.12, 0.82, 0.12, sx0, 0.41, sz0 - 0.06, [0.1, 0, 0]);
    k.box('wood', 1.0, 0.1, 0.55, sx0 + 0.15, 0.16, sz0 + 0.1);
    for (const dx of [-0.4, 0.4]) for (const dz of [-1, 1]) {
      k.box('woodDark', 0.09, 0.16, 0.09, sx0 + 0.15 + dx, 0.08, sz0 + 0.1 + dz * 0.2);
    }
    // Distaff, standing ON the base board — a drive band floating out at
    // x + 0.6 touched neither the wheel nor the frame.
    k.cyl('wood', 0.04, 0.05, 0.9, 6, sx0 + 0.55, 0.62, sz0 + 0.15);
    k.ico('bolt5', 0.11, sx0 + 0.55, 1.07, sz0 + 0.15, [1, 1.4, 1]);
    // Two low tables of folded fabric.
    for (const [tx, tz] of [[-halfW - 0.4, fz + 1.9], [-halfW + 1.5, fz + 1.5]]) {
      k.box('wood', 1.7, 0.1, 0.85, tx, 0.78, tz);
      for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
        k.box('woodDark', 0.1, 0.78, 0.1, tx + dx * 0.72, 0.39, tz + dz * 0.32);
      }
      for (let i = 0; i < 4; i++) {
        const n = 2 + (i % 2);
        for (let j = 0; j < n; j++) {
          k.box(BOLTS[(i + j + 1) % BOLTS.length], 0.55, 0.1, 0.55,
            tx - 0.6 + i * 0.4, 0.88 + j * 0.11, tz);
        }
      }
    }
    // Front-centre table with red cloth spread on it.
    k.box('wood', 1.6, 0.1, 0.9, 3.4, 0.8, fz + 2.2);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      k.box('woodDark', 0.1, 0.8, 0.1, 3.4 + dx * 0.66, 0.4, fz + 2.2 + dz * 0.34);
    }
    k.box('bolt1', 1.45, 0.05, 0.78, 3.4, 0.88, fz + 2.2);
    for (const s of [-1, 1]) k.box('iron', 0.05, 0.3, 0.05, 3.85, 0.99, fz + 2.2, [0, 0, s * 0.5]);
    barrel(k, halfW - 0.9, 0, fz + 1.6, 1.0);
  }, {
    bolt1: matte(0xc4433f), bolt2: matte(0x3f6f9c), bolt3: matte(0x4f8a58),
    bolt4: matte(0xd08a3a), bolt5: matte(0x8a5fa8), bolt6: matte(0x3f8f8a),
    shopDark: matte(0x2a2620),
    signBoard: matte(0x6b4a30), emblem: matte(0xd6dade),
  });
}

// =============================================================================
// Alchemist
// =============================================================================

/**
 * The alchemist. Built from the transcription in
 * references/alchemist-massing.md.
 *
 * Stone, built outright (not a townhouse shell), with a CROSS-GABLE on the
 * front left, and a tall glass-and-copper STILL standing against the front wall
 * and rising past the eaves — that still is the whole identity of the building.
 *
 * The still's column is built as one continuous stack of overlapping segments.
 * An earlier attempt built its condenser as a helix of short tubes placed by
 * hand and they came out as a line of unconnected sticks floating over the roof.
 *
 * Front is +Z.
 */
export function generateAlchemist(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = 9.0, Dp = 6.6, WALL = 5.2;
  const halfW = W / 2, halfD = Dp / 2;
  const roofH = (halfD + 0.55) * 0.95;
  const slopeD = halfD + 0.55;
  const angle = Math.atan2(slopeD, roofH);
  const slopeLen = Math.hypot(slopeD, roofH);

  // --- stone shell -------------------------------------------------------
  k.box('stoneDark', W + 0.5, 0.36, Dp + 0.5, 0, 0.18, 0);
  k.box('stone', W, WALL - 0.36, Dp, 0, 0.36 + (WALL - 0.36) / 2, 0);
  for (const y of [1.5, 3.0, 4.5]) k.box('stoneLight', W + 0.12, 0.1, Dp + 0.12, 0, y, 0);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const long = i % 2 === 0;
      k.box('stoneLight', long ? 0.78 : 0.44, 0.42, long ? 0.44 : 0.78,
        sx * (halfW - (long ? 0.39 : 0.22)), 0.62 + i * 0.68, halfD - (long ? 0.22 : 0.39));
    }
  }
  // Main roof, ridge along X.
  for (const sz of [-1, 1]) {
    k.box('roof', W + 1.0, 0.24, slopeLen, 0, WALL + roofH / 2, sz * slopeD / 2,
      [sz * (Math.PI / 2 - angle), 0, 0]);
  }
  k.box('roofDark', W + 1.2, 0.28, 0.4, 0, WALL + roofH + 0.02, 0);
  const roofYAt = (z) => roofH * (1 - Math.abs(z) / slopeD) - 0.05;
  for (const sx of [-1, 1]) {
    k.raw('stone', gableGeo(halfD, roofYAt(halfD), roofYAt(0), 0.32), sx * halfW, WALL, 0, [0, Math.PI / 2, 0]);
  }

  // --- cross-gable projecting forward on the LEFT (identity feature #1) ----
  const CW = 3.6, CPROJ = 1.9;
  const CX = -2.1, CZ = halfD + CPROJ / 2;
  const cRoofH = (CW / 2 + 0.5) * 0.95;
  const cSlopeW = CW / 2 + 0.5;
  const cAngle = Math.atan2(cSlopeW, cRoofH);
  const cSlopeLen = Math.hypot(cSlopeW, cRoofH);
  k.box('stone', CW, WALL, CPROJ + 0.4, CX, WALL / 2, CZ - 0.2);
  k.box('stoneDark', CW + 0.4, 0.36, CPROJ + 0.7, CX, 0.18, CZ - 0.2);
  for (const y of [1.5, 3.0, 4.5]) k.box('stoneLight', CW + 0.12, 0.1, CPROJ + 0.5, CX, y, CZ - 0.2);
  for (const sx of [-1, 1]) {
    k.box('roof', cSlopeLen, 0.22, CPROJ + 0.9, CX + sx * cSlopeW / 2, WALL + cRoofH / 2, CZ,
      [0, 0, -sx * (Math.PI / 2 - cAngle)]);
  }
  k.box('roofDark', 0.36, 0.26, CPROJ + 1.1, CX, WALL + cRoofH + 0.02, CZ);
  const cRoofYAt = (u) => cRoofH * (1 - Math.abs(u) / cSlopeW) - 0.05;
  k.raw('stone', gableGeo(CW / 2, cRoofYAt(CW / 2), cRoofYAt(0), 0.3), CX, WALL, halfD + CPROJ);
  addWindowOn(k, 'z', CX, 2.5, halfD + CPROJ, 1, 1.0, 1.2, true, true);
  addWindowOn(k, 'z', CX, WALL + 0.75, halfD + CPROJ, 1, 0.85, 0.9, false, false);

  // --- brick chimney on the right of the main roof -------------------------
  k.box('brick', 0.9, WALL + roofH + 1.6, 0.9, 2.8, (WALL + roofH + 1.6) / 2, -0.6);
  for (let i = 0; i < 4; i++) k.box('brickDark', 1.02, 0.14, 1.02, 2.8, 2.0 + i * 1.5, -0.6);
  k.box('brickDark', 1.12, 0.24, 1.12, 2.8, WALL + roofH + 1.5, -0.6);

  // --- door, right of the cross-gable --------------------------------------
  const DX = 1.4;
  k.box('doorway', 1.5, 2.35, 0.24, DX, 1.17, halfD);
  k.box('wood', 1.3, 2.2, 0.14, DX, 1.1, halfD + 0.14);
  for (const dy of [0.5, 1.7]) k.box('iron', 1.34, 0.12, 0.06, DX, dy, halfD + 0.23);
  k.box('stoneLight', 1.9, 0.24, 0.3, DX, 2.46, halfD + 0.06);
  k.box('stone', 2.1, 0.16, 0.72, DX, 0.08, halfD + 0.4);
  addWindowOn(k, 'z', DX, WALL - 1.3, halfD, 1, 1.0, 1.2, true, false);
  for (const wz of [-1.6, 1.6]) {
    for (const sx of [-1, 1]) addWindowOn(k, 'x', wz, 2.6, sx * halfW, sx, 1.0, 1.2, true, false);
  }
  for (const wx of [-2.4, 0, 2.4]) addWindowOn(k, 'z', wx, 2.6, -halfD, -1, 1.0, 1.2, true, false);

  // --- THE STILL, against the front wall to the right of the door ---------
  const SX = 3.55, SZ = halfD + 1.05;
  // No furnace box: Dennis's call was to drop the brick oven and stand the
  // still itself on the ground. Everything below is therefore lowered by
  // STILL_DROP so the copper vessel's base sits on a low stone footing.
  const STILL_DROP = 1.72;
  const dy = (v) => v - STILL_DROP;
  k.cyl('stoneDark', 1.05, 1.15, 0.2, 12, SX, 0.1, SZ);
  // Copper vessel, then the glass-and-copper column — ONE continuous stack,
  // each segment overlapping the one below.
  k.cyl('copper', 0.62, 0.92, 1.15, 12, SX, dy(2.4), SZ);
  k.cyl('copperLight', 0.98, 0.98, 0.14, 12, SX, dy(1.9), SZ);
  k.cone('copper', 0.62, 0.55, 12, SX, dy(3.2), SZ);
  let y = dy(3.3);
  for (let i = 0; i < 4; i++) {
    k.cyl('copperLight', 0.3, 0.3, 0.22, 10, SX, y, SZ);          // band
    k.sphere('glass', 0.42 - i * 0.03, SX, y + 0.46, SZ, [1, 1.25, 1]);  // bulb
    y += 0.92;
  }
  k.cyl('copperLight', 0.28, 0.28, 0.24, 10, SX, y, SZ);
  k.cyl('copper', 0.3, 0.38, 0.5, 10, SX, y + 0.35, SZ);
  k.cone('copperLight', 0.4, 0.55, 10, SX, y + 0.86, SZ);
  k.cyl('copper', 0.06, 0.06, 0.3, 6, SX, y + 1.25, SZ);
  // Return pipe, back into the wall — a chain of overlapping segments.
  {
    const from = new THREE.Vector3(SX, y - 0.1, SZ - 0.32);
    const to = new THREE.Vector3(SX - 0.1, WALL - 0.6, halfD - 0.1);
    const seg = to.clone().sub(from);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = from.clone().addScaledVector(seg, i / n);
      const b = from.clone().addScaledVector(seg, (i + 1) / n);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
      const e = new THREE.Euler().setFromQuaternion(q);
      k.cyl('copper', 0.1, 0.1, (seg.length() / n) * 1.3, 6, mid.x, mid.y, mid.z, [e.x, e.y, e.z]);
    }
  }

  // --- bottle shelf left of the door, bench right of it -------------------
  const BOT = ['potion1', 'potion2', 'potion3', 'potion4'];
  // Against the cross-gable's own front face, not the main wall: at x = -0.4
  // its right upright stood in the doorway, and anywhere further left on the
  // main wall is inside the cross-gable's footprint.
  const shx = CX, shz = halfD + CPROJ + 0.35;
  for (const dz of [-1, 1]) k.box('woodDark', 0.12, 2.0, 0.12, shx + dz * 0.85, 1.0, shz);
  for (let s = 0; s < 3; s++) {
    k.box('woodDark', 1.9, 0.09, 0.52, shx, 0.55 + s * 0.62, shz);
    for (let i = 0; i < 6; i++) {
      const px = shx - 0.72 + i * 0.29;
      const h = range(rng, 0.2, 0.34);
      k.cyl(pick(rng, BOT), 0.07, 0.11, h, 7, px, 0.6 + s * 0.62 + h / 2, shz);
      k.cyl('cork', 0.032, 0.032, 0.07, 5, px, 0.6 + s * 0.62 + h + 0.03, shz);
    }
  }
  k.box('woodDark', 2.1, 0.1, 0.6, shx, 2.06, shz);
  // Bench on the far right.
  const bx = halfW + 0.5, bz = halfD + 0.4;
  k.box('wood', 1.6, 0.1, 0.7, bx, 0.8, bz);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.box('woodDark', 0.1, 0.8, 0.1, bx + dx * 0.66, 0.4, bz + dz * 0.26);
  }
  for (let i = 0; i < 5; i++) {
    const px = bx - 0.6 + i * 0.3;
    const h = range(rng, 0.22, 0.36);
    k.cyl(pick(rng, BOT), 0.08, 0.12, h, 7, px, 0.85 + h / 2, bz);
    k.cyl('cork', 0.035, 0.035, 0.07, 5, px, 0.85 + h + 0.03, bz);
  }
  // Larger flasks on the ground beside it.
  for (let i = 0; i < 3; i++) {
    k.sphere(BOT[i % BOT.length], 0.22, bx + 0.9 + i * 0.42, 0.2, bz + 0.6, [1, 0.9, 1]);
    k.cyl('glass', 0.07, 0.07, 0.26, 6, bx + 0.9 + i * 0.42, 0.46, bz + 0.6);
  }
  // Potted plants and barrels.
  for (const [px, pz] of [[-halfW - 0.6, halfD + 0.3], [bx - 1.4, bz + 1.2]]) {
    k.cyl('pot', 0.28, 0.22, 0.36, 8, px, 0.18, pz);
    // Foliage climbs from the pot's rim (top at 0.36) rather than starting at
    // 0.4 — a random height above the rim left the whole clump in mid-air.
    for (let i = 0; i < 6; i++) {
      k.ico('leaf', range(rng, 0.16, 0.22), px + range(rng, -0.15, 0.15),
        0.30 + i * 0.07, pz + range(rng, -0.15, 0.15), [1.2, 0.8, 1.2]);
    }
  }
  barrel(k, -halfW - 0.9, 0, halfD + 1.5, 1.0);
  barrel(k, -halfW - 0.4, 0, halfD + 2.3, 0.9);

  return k.finish({
    stone: matte(0xb4ada0),
    stoneLight: matte(0xc1b9aa),
    stoneDark: matte(0x968e82),
    roof: matte(0x5a6774),
    roofDark: matte(0x47535f),
    brick: matte(0xa2685a),
    brickDark: matte(0x87534a),
    copper: metal(COPPER),
    copperLight: metal(COPPER_LIGHT),
    glass: new THREE.MeshStandardMaterial({
      color: 0xbfe4d2, roughness: 0.18, metalness: 0, transparent: true, opacity: 0.72,
    }),
    sooty: matte(0x241f1b),
    coal: matte(0x25221f),
    ember: EMBER,
    potion1: matte(0x5fc4a8), potion2: matte(0x8f6fd0), potion3: matte(0xd06f8f), potion4: matte(0xc9c45a),
    cork: matte(0xb08a5e),
    pot: matte(0xa8624a),
    leaf: matte(0x4f7f3a),
    wood: matte(pick(rng, WOOD)),
    woodDark: matte(WOOD_DARK),
    iron: metal(0x54545e),
    doorway: matte(0x241f1b),
    shutter: matte(0x4f7f5a),
    timber: matte(TIMBER),
    foliage: matte(0x5f8f45),
  });
}

// =============================================================================
// Jeweller
// =============================================================================

/**
 * The jeweller. Built from the transcription in
 * references/jeweler-massing.md.
 *
 * The one building on the sheet with a LOW HIPPED roof instead of a steep
 * gable, and the only one with iron cresting along its ridge — between them
 * that is what tells it apart from its neighbours at a glance. Ashlar stone,
 * two storeys, symmetric, with arched upper windows, a projecting glazed bay
 * and a gem case at the front.
 *
 * Front is +Z.
 */
export function generateJeweler(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = 8.6, Dp = 7.0, WALL = 6.0;
  const halfW = W / 2, halfD = Dp / 2;
  const EAVE = 0.65, ROOF_H = 2.1;

  // --- ashlar shell ------------------------------------------------------
  k.box('stoneDark', W + 0.6, 0.4, Dp + 0.6, 0, 0.2, 0);
  k.box('stone', W, WALL - 0.4, Dp, 0, 0.4 + (WALL - 0.4) / 2, 0);
  // String course between the storeys, and a cornice under the eaves.
  k.box('stoneLight', W + 0.18, 0.22, Dp + 0.18, 0, 3.05, 0);
  k.box('stoneLight', W + 0.34, 0.28, Dp + 0.34, 0, WALL - 0.14, 0);
  k.box('stoneDark', W + 0.5, 0.18, Dp + 0.5, 0, WALL + 0.09, 0);
  // Corner quoins.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const long = i % 2 === 0;
        k.box('stoneLight', long ? 0.8 : 0.46, 0.44, long ? 0.46 : 0.8,
          sx * (halfW - (long ? 0.4 : 0.23)), 0.66 + i * 0.66, sz * (halfD - (long ? 0.23 : 0.4)));
      }
    }
  }

  // --- low HIPPED roof (identity feature #1) ------------------------------
  // A rectangular pyramid: ConeGeometry with 4 radial segments, scaled to the
  // building's own footprint and turned 45° so its faces align with the walls.
  // Four tilted slabs would leave open corners at this pitch.
  //
  // ROTATE FIRST, THEN SCALE. A 4-segment cone puts its base vertices ON the
  // axes, so it has to be turned 45° for its edges to run parallel to the
  // walls — and doing that AFTER a non-uniform scale rotates the already-
  // stretched square instead, which came out as a giant flat diamond slab
  // lying over the whole building. After the turn the square's half-extent is
  // r/√2, hence the √2 factors.
  {
    const g = new THREE.ConeGeometry(1, 1, 4);
    g.rotateY(Math.PI / 4);
    g.scale((halfW + EAVE) * Math.SQRT2, ROOF_H, (halfD + EAVE) * Math.SQRT2);
    k.raw('roof', g, 0, WALL + 0.18 + ROOF_H / 2, 0);
  }
  // NO cresting and NO corner finials. A hipped roof built as a pyramid comes
  // to a POINT, so a horizontal spike run hovers over the apex; and the corner
  // blocks sat outboard of the cornice but inboard of the eave, so they hung in
  // the air under the roof overhang with nothing beneath them. The corners are
  // articulated by the quoins instead.

  // --- arched upper windows with pilasters (identity feature #4) ----------
  const upperY = 4.35;
  for (const wx of [-2.5, 0, 2.5]) {
    k.box('glass', 1.05, 1.5, 0.12, wx, upperY, halfD + 0.02);
    k.cyl('glass', 0.52, 0.52, 0.12, 10, wx, upperY + 0.75, halfD + 0.02, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
    k.torus('stoneLight', 0.62, 0.13, wx, upperY + 0.75, halfD + 0.1, null, Math.PI);
    for (const sx of [-1, 1]) k.box('stoneLight', 0.16, 1.55, 0.2, wx + sx * 0.6, upperY, halfD + 0.1);
    k.box('stoneLight', 1.4, 0.16, 0.2, wx, upperY - 0.82, halfD + 0.1);
    // Tracery: a mullion and a transom.
    k.box('stoneDark', 0.08, 2.1, 0.16, wx, upperY + 0.2, halfD + 0.14);
    k.box('stoneDark', 1.0, 0.08, 0.16, wx, upperY + 0.1, halfD + 0.14);
  }
  for (const px of [-3.75, -1.25, 1.25, 3.75]) {
    k.box('stoneLight', 0.34, 2.7, 0.22, px, upperY + 0.05, halfD + 0.11);
    k.box('stoneDark', 0.46, 0.16, 0.3, px, upperY + 1.45, halfD + 0.13);
    k.box('stoneDark', 0.46, 0.16, 0.3, px, upperY - 1.35, halfD + 0.13);
  }
  // Plainer windows on the other three faces.
  for (const wx of [-2.5, 0, 2.5]) addWindowOn(k, 'z', wx, upperY, -halfD, -1, 1.0, 1.4, false, false);
  for (const sx of [-1, 1]) {
    for (const wz of [-1.8, 1.8]) addWindowOn(k, 'x', wz, upperY, sx * halfW, sx, 1.0, 1.4, false, false);
  }

  // --- ground-floor windows ------------------------------------------------
  const lowY = 1.75;
  addWindowOn(k, 'z', 3.1, lowY, halfD, 1, 1.05, 1.35, false, false);
  for (const wx of [-2.5, 0, 2.5]) addWindowOn(k, 'z', wx, lowY, -halfD, -1, 1.05, 1.35, false, false);
  for (const sx of [-1, 1]) {
    for (const wz of [-1.8, 1.8]) addWindowOn(k, 'x', wz, lowY, sx * halfW, sx, 1.05, 1.35, false, false);
  }

  // --- ground floor: bay window (left), door (centre), case (right) -------
  // Projecting glazed bay.
  const BX = -2.6, BPROJ = 0.9;
  k.box('stone', 2.6, 2.55, BPROJ, BX, 1.28, halfD + BPROJ / 2);
  k.box('glass', 2.1, 1.5, 0.14, BX, 1.6, halfD + BPROJ);
  for (const m of [-0.66, 0, 0.66]) k.box('stoneDark', 0.1, 1.6, 0.2, BX + m, 1.6, halfD + BPROJ + 0.04);
  k.box('stoneLight', 2.9, 0.24, BPROJ + 0.3, BX, 2.68, halfD + BPROJ / 2);
  k.box('stoneDark', 2.7, 0.16, BPROJ + 0.2, BX, 2.86, halfD + BPROJ / 2);
  // Jewellery on a velvet pad inside the bay.
  k.box('velvet', 1.8, 0.12, 0.4, BX, 1.1, halfD + BPROJ - 0.2);
  for (let i = 0; i < 6; i++) {
    k.ico(pick(rng, ['gem1', 'gem2', 'gem3']), range(rng, 0.07, 0.11),
      BX - 0.7 + i * 0.28, 1.24, halfD + BPROJ - 0.2 + range(rng, -0.08, 0.08));
  }

  // Door, centred, with a moulded surround.
  k.box('doorway', 1.7, 2.35, 0.24, 0.4, 1.17, halfD);
  for (const s of [-1, 1]) k.box('wood', 0.76, 2.2, 0.14, 0.4 + s * 0.4, 1.1, halfD + 0.14);
  k.cyl('gold', 0.08, 0.08, 0.1, 8, 0.4 + 0.12, 1.15, halfD + 0.24, [Math.PI / 2, 0, 0]);
  for (const sx of [-1, 1]) k.box('stoneLight', 0.3, 2.7, 0.28, 0.4 + sx * 1.0, 1.35, halfD + 0.12);
  k.box('stoneLight', 2.5, 0.26, 0.32, 0.4, 2.78, halfD + 0.12);
  k.raw('stoneLight', gableGeo(1.15, 0.2, 0.62, 0.3), 0.4, 2.9, halfD + 0.1);
  k.box('stone', 2.4, 0.16, 0.8, 0.4, 0.08, halfD + 0.46);

  // Gem case, free-standing to the right of the door and clear of its approach.
  const CX2 = 3.2, CZ2 = halfD + 1.1;
  k.box('woodDark', 1.7, 0.85, 0.85, CX2, 0.43, CZ2);
  k.box('stoneDark', 1.85, 0.1, 1.0, CX2, 0.9, CZ2);
  k.box('glass', 1.6, 0.42, 0.78, CX2, 1.16, CZ2);
  k.box('gold', 1.75, 0.08, 0.92, CX2, 1.4, CZ2);
  for (let i = 0; i < 5; i++) {
    k.ico(pick(rng, ['gem1', 'gem2', 'gem3']), range(rng, 0.08, 0.12),
      CX2 - 0.6 + i * 0.3, 1.05, CZ2 + range(rng, -0.16, 0.16));
  }
  // Workbench behind it.
  const WBX = CX2, WBZ = halfD + 2.5;   // directly in front of the gem case
  k.box('wood', 1.5, 0.1, 0.7, WBX, 0.85, WBZ);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.box('woodDark', 0.1, 0.85, 0.1, WBX + dx * 0.62, 0.42, WBZ + dz * 0.26);
  }
  for (let i = 0; i < 4; i++) {
    k.box('iron', 0.06, 0.05, 0.26, WBX - 0.5 + i * 0.28, 0.93, WBZ, [0, range(rng, -0.3, 0.3), 0]);
  }
  k.cyl('gold', 0.14, 0.14, 0.09, 10, WBX + 0.55, 0.94, WBZ - 0.15);

  return k.finish({
    stone: matte(0xbfb8aa),
    stoneLight: matte(0xcdc6b6),
    stoneDark: matte(0xa9a294),
    roof: matte(0x51627a),
    gold: matte(0xd4ac52),
    iron: metal(0x4c4c56),
    glass: new THREE.MeshStandardMaterial({ color: 0x3d5f74, roughness: 0.2, metalness: 0 }),
    velvet: matte(0x7a2f45),
    gem1: matte(0x5fc4d8), gem2: matte(0xd05f8f), gem3: matte(0x8fd05f),
    doorway: matte(0x241f1b),
    wood: matte(0x6b4630),
    woodDark: matte(0x53381f),
    shutter: matte(0x3f5f7c),
    timber: matte(TIMBER),
    foliage: matte(0x5f8f45),
  });
}

// =============================================================================
// Carpenter
// =============================================================================

/**
 * The carpenter / lumber workshop. Built from the transcription in
 * references/carpenter-massing.md.
 *
 * NOT a `buildTownhouse` shell. The reference's workshop is STONE-walled and a
 * single tall storey — no half-timbering, no jetty, no dormers — so it is
 * built outright. What identifies it is the bare open timber SCAFFOLD standing
 * clear of its left end, and the lean-to shed of stacked timber down its right.
 *
 * Front is +Z.
 */
export function generateCarpenter(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = 8.0, Dp = 6.4, WALL = 4.2;
  const halfW = W / 2, halfD = Dp / 2;
  const roofH = halfD * 1.0;
  const slopeD = halfD + 0.55;
  const angle = Math.atan2(slopeD, roofH);
  const slopeLen = Math.hypot(slopeD, roofH);

  // --- stone shell -------------------------------------------------------
  k.box('stoneDark', W + 0.5, 0.36, Dp + 0.5, 0, 0.18, 0);
  k.box('stone', W, WALL - 0.36, Dp, 0, 0.36 + (WALL - 0.36) / 2, 0);
  for (const y of [1.35, 2.55, 3.7]) {
    k.box('stoneLight', W + 0.12, 0.1, Dp + 0.12, 0, y, 0);
  }
  // Quoins on the front corners.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const long = i % 2 === 0;
      k.box('stoneLight', long ? 0.78 : 0.44, 0.42, long ? 0.44 : 0.78,
        sx * (halfW - (long ? 0.39 : 0.22)), 0.6 + i * 0.66, halfD - (long ? 0.22 : 0.39));
    }
  }
  // Roof, ridge along X.
  for (const sz of [-1, 1]) {
    k.box('roof', W + 1.0, 0.24, slopeLen, 0, WALL + roofH / 2, sz * slopeD / 2,
      [sz * (Math.PI / 2 - angle), 0, 0]);
  }
  k.box('roofDark', W + 1.2, 0.28, 0.4, 0, WALL + roofH + 0.02, 0);
  const roofYAt = (z) => roofH * (1 - Math.abs(z) / slopeD) - 0.05;
  for (const sx of [-1, 1]) {
    k.raw('stone', gableGeo(halfD, roofYAt(halfD), roofYAt(0), 0.32), sx * halfW, WALL, 0, [0, Math.PI / 2, 0]);
  }
  // Chimney through the roof — height taken from the real ridge.
  k.box('stoneDark', 0.85, WALL + roofH + 1.5, 0.85, -1.5, (WALL + roofH + 1.5) / 2, -0.5);
  k.box('stoneLight', 1.05, 0.2, 1.05, -1.5, WALL + roofH + 1.4, -0.5);

  // Door and window in the front wall.
  k.box('doorway', 1.4, 2.25, 0.24, 0.9, 1.12, halfD);
  k.box('wood', 1.24, 2.1, 0.14, 0.9, 1.05, halfD + 0.14);
  for (const dy of [0.45, 1.6]) k.box('iron', 1.28, 0.12, 0.06, 0.9, dy, halfD + 0.23);
  k.box('stoneLight', 1.75, 0.24, 0.3, 0.9, 2.36, halfD + 0.06);
  for (const wx of [-2.6, -0.9, 2.9]) addWindowOn(k, 'z', wx, 2.35, halfD, 1, 1.0, 1.15, true, false);
  for (const wx of [-2.2, 0, 2.2]) addWindowOn(k, 'z', wx, 2.35, -halfD, -1, 1.0, 1.15, true, false);
  for (const sx of [-1, 1]) {
    for (const wz of [-1.5, 1.5]) addWindowOn(k, 'x', wz, 2.35, sx * halfW, sx, 1.0, 1.15, true, false);
  }
  k.box('stone', 2.0, 0.16, 0.75, 0.9, 0.08, halfD + 0.42);   // step

  // --- the bare scaffold, standing clear of the LEFT end ------------------
  const SX = -halfW - 1.25, SD = 2.4, SH = 5.5;   // abutting the gable end
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      k.box('timber', 0.2, SH, 0.2, SX + dx * 1.05, SH / 2, dz * SD / 2);
    }
  }
  for (const y of [1.5, 3.2, SH - 0.15]) {
    for (const dz of [-1, 1]) k.box('timber', 2.3, 0.16, 0.16, SX, y, dz * SD / 2);
    for (const dx of [-1, 1]) k.box('timber', 0.16, 0.16, SD, SX + dx * 1.05, y, 0);
  }
  for (const dz of [-1, 1]) {
    k.box('timber', 2.6, 0.14, 0.14, SX, 2.35, dz * SD / 2, [0, 0, 0.72]);
    k.box('timber', 2.6, 0.14, 0.14, SX, 4.05, dz * SD / 2, [0, 0, -0.72]);
  }

  // --- lean-to shed down the RIGHT side ------------------------------------
  const EX = halfW + 1.9, ED = Dp - 0.4;
  const backY = 3.5, frontY = 2.7;
  // NEGATIVE: a +Z rotation lifts local +X, and the shed runs out along +X,
  // so +tilt made the roof rise away from the wall instead of falling.
  const tilt = -Math.atan2(backY - frontY, EX + 1.1 - halfW);
  for (const dz of [-1, 1]) {
    k.box('timber', 0.18, frontY, 0.18, EX + 1.1, frontY / 2, dz * (ED / 2 - 0.1));
  }
  k.box('timber', 0.18, 0.16, ED, EX + 1.1, frontY + 0.05, 0);
  const shedLen = Math.hypot(EX + 1.1 - halfW + 0.3, backY - frontY);
  k.box('boards', shedLen, 0.13, ED + 0.4, (halfW - 0.3 + EX + 1.1) / 2, (backY + frontY) / 2 + 0.12, 0,
    [0, 0, tilt]);
  for (let i = 0; i < 5; i++) {
    k.box('timber', shedLen - 0.2, 0.1, 0.1, (halfW - 0.3 + EX + 1.1) / 2, (backY + frontY) / 2 + 0.02,
      -ED / 2 + 0.3 + i * ((ED - 0.6) / 4), [0, 0, tilt]);
  }

  // --- stacked timber and barrels under and around the shed ---------------
  for (let row = 0; row < 4; row++) {
    const n = 4 - row;
    for (let i = 0; i < n; i++) {
      k.cyl('bark', 0.16, 0.16, 1.9, 9, EX + 0.5, 0.17 + row * 0.3, -ED / 2 + 0.5 + i * 0.36 + row * 0.18,
        [0, range(rng, -0.05, 0.05), Math.PI / 2]);
    }
  }
  for (let i = 0; i < 7; i++) {
    k.box('sawn', 1.9, 0.08, 0.9, EX - 0.9, 0.05 + i * 0.09, ED / 2 - 0.9, [0, range(rng, -0.04, 0.04), 0]);
  }
  barrel(k, halfW + 0.7, 0, halfD + 1.1, 1.0);
  barrel(k, halfW + 1.5, 0, halfD + 1.7, 0.92);
  barrel(k, EX + 1.5, 0, -ED / 2 + 0.6, 0.98);
  // A low bench with tools, under the shed.
  k.box('wood', 1.5, 0.1, 0.7, EX + 0.3, 0.82, ED / 2 - 0.2);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.box('timber', 0.1, 0.82, 0.1, EX + 0.3 + dx * 0.62, 0.41, ED / 2 - 0.2 + dz * 0.25);
  }
  k.box('iron', 0.5, 0.06, 0.1, EX + 0.1, 0.91, ED / 2 - 0.2, [0, 0.3, 0]);
  k.box('wood', 0.14, 0.06, 0.3, EX + 0.55, 0.91, ED / 2 - 0.3);

  // --- loose logs and shavings in front, clear of the doorway --------------
  // The door is at x = 0.9 on the +Z wall, so its approach (x 0.9 ± 0.95,
  // z from halfD out to halfD + 1.5) is deliberately left empty.
  for (let i = 0; i < 3; i++) {
    k.cyl('bark', 0.17, 0.17, 1.7, 9, -2.4 + i * 0.2, 0.17 + i * 0.29, halfD + 1.5 + i * 0.12,
      [0, range(rng, -0.12, 0.12), Math.PI / 2]);
  }
  for (let i = 0; i < 10; i++) {
    k.ico('sawn', range(rng, 0.06, 0.11),
      range(rng, -3.4, -1.0), 0.05, halfD + range(rng, 0.5, 2.4), [1.7, 0.35, 1]);
  }
  k.cyl('woodDark', 0.4, 0.44, 0.62, 10, -3.6, 0.31, halfD + 0.7);   // chopping block
  k.box('iron', 0.1, 0.42, 0.22, -3.6, 0.72, halfD + 0.7, [0.25, 0, 0]);
  k.box('wood', 0.07, 0.6, 0.07, -3.6, 0.42, halfD + 0.86, [0.25, 0, 0]);

  return k.finish({
    stone: matte(0xb2a99a),
    stoneLight: matte(0xbfb6a6),
    stoneDark: matte(0x968d80),
    roof: matte(0x5a6774),
    roofDark: matte(0x47535f),
    timber: matte(0x6b4e33),
    boards: matte(0x9a7247),
    bark: matte(0x77593c),
    sawn: matte(0xd9c191),
    wood: matte(pick(rng, WOOD)),
    woodDark: matte(WOOD_DARK),
    iron: metal(0x54545e),
    doorway: matte(0x241f1b),
    glass: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.25, metalness: 0 }),
    shutter: matte(0x5c6b52),
    foliage: matte(0x5f8f45),
  });
}

// =============================================================================
// Church
// =============================================================================

/**
 * The church. Built from the transcription in references/church-massing.md.
 *
 * Nave with half-timbered gable ends, a projecting cross-gable porch, and a
 * bell tower at one end whose upper stage is half-timbered with two arched
 * belfry openings, capped by a spire and a cross. The churchyard is
 * deliberately NOT baked in — see the spec.
 *
 * Front is +Z; the tower stands at the +X end.
 */
export function generateChurch(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const NW = 12.0, ND = 7.0, NWALL = 5.5;
  const halfW = NW / 2, halfD = ND / 2;
  const nRoofH = (halfD + 0.6) * 1.35;
  const nSlopeD = halfD + 0.6;
  const nAngle = Math.atan2(nSlopeD, nRoofH);
  const nSlopeLen = Math.hypot(nSlopeD, nRoofH);
  const nRidge = NWALL + nRoofH;

  // --- nave --------------------------------------------------------------
  k.box('stoneDark', NW + 0.6, 0.42, ND + 0.6, 0, 0.21, 0);
  k.box('stone', NW, NWALL - 0.42, ND, 0, 0.42 + (NWALL - 0.42) / 2, 0);
  k.box('stoneLight', NW + 0.2, 0.2, ND + 0.2, 0, 3.1, 0);
  for (const sz of [-1, 1]) {
    // Offset -0.6 so the overhang is all on the FAR end: at ±(NW/2 + 0.6) the
    // roof ran a metre into the bell tower.
    k.box('roof', NW + 1.2, 0.26, nSlopeLen, -0.6, NWALL + nRoofH / 2, sz * nSlopeD / 2,
      [sz * (Math.PI / 2 - nAngle), 0, 0]);
  }
  k.box('roofDark', NW + 1.4, 0.3, 0.42, -0.7, nRidge + 0.03, 0);
  // Half-timbered gable ends (identity feature #1).
  const nRoofYAt = (z) => nRoofH * (1 - Math.abs(z) / nSlopeD) - 0.05;
  for (const sx of [-1, 1]) {
    k.raw('plaster', gableGeo(halfD, nRoofYAt(halfD), nRoofYAt(0), 0.34), sx * halfW, NWALL, 0, [0, Math.PI / 2, 0]);
    k.box('timber', 0.2, 0.24, ND, sx * (halfW + 0.19), NWALL + 0.1, 0);
    k.box('timber', 0.2, nRoofH * 0.9, 0.22, sx * (halfW + 0.19), NWALL + nRoofH * 0.45, 0);
    for (const sz of [-1, 1]) {
      k.box('timber', 0.2, 0.2, nSlopeLen * 0.55, sx * (halfW + 0.19), NWALL + nRoofH * 0.42, sz * halfD * 0.5,
        [sz * (Math.PI / 2 - nAngle), 0, 0]);
    }
  }
  // Buttresses down both flanks (identity feature #7).
  // Set BETWEEN the lancets, and stopped short of the eaves. The first version
  // ran to NWALL + 0.7 with a spire on top, which put the cap inside the roof's
  // overhang, and its x positions landed on the windows.
  const BUTT_H = 4.5, BUTT_D = 1.15;
  for (const [sz, xs] of [[1, [-4.2, 2.75]], [-1, [-3.1, 0, 3.1]]]) {
    for (const bx of xs) {
      const bz = sz * (halfD + BUTT_D / 2 - 0.15);
      k.box('stone', 1.0, BUTT_H, BUTT_D, bx, BUTT_H / 2, bz);
      k.box('stoneDark', 1.2, 0.22, BUTT_D + 0.2, bx, BUTT_H + 0.11, bz);
      // A weathered set-off rather than a spire, sloping back to the wall.
      k.box('stone', 1.0, 0.5, BUTT_D * 0.8, bx, BUTT_H + 0.45, bz - sz * 0.16, [sz * 0.55, 0, 0]);
    }
  }

  /** A pointed lancet with coloured glass and a stone surround. */
  const GLASSES = ['glassA', 'glassB', 'glassC', 'glassD'];
  function lancet(axis, u, wallC, dir, y, w, h, gi) {
    const g = GLASSES[gi % GLASSES.length];
    const put = (key, lw, lh, lt, lu, ly, ld) => {
      if (axis === 'x') k.box(key, lt, lh, lw, wallC + dir * ld, ly, lu);
      else k.box(key, lw, lh, lt, lu, ly, wallC + dir * ld);
    };
    put(g, w, h, 0.16, u, y, 0.02);
    // Half-round head, in the SAME colour as its light — two colours in one
    // opening reads as a mistake and puts two materials in the same plane.
    if (axis === 'x') {
      k.cyl(g, w / 2, w / 2, 0.16, 10, wallC + dir * 0.02, y + h / 2, u,
        [0, 0, Math.PI / 2], Math.PI, dir > 0 ? 0 : Math.PI);
    } else {
      k.cyl(g, w / 2, w / 2, 0.16, 10, u, y + h / 2, wallC + dir * 0.02,
        [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
    }
    put('stoneLight', w + 0.34, 0.18, 0.24, u, y - h / 2 - 0.09, 0.08);
    for (const s of [-1, 1]) put('stoneLight', 0.2, h + 0.3, 0.24, u + s * (w / 2 + 0.1), y + 0.1, 0.08);
    put('stoneDark', 0.09, h, 0.2, u, y, 0.12);
  }

  // Lancets along the nave, front and back.
  let gi = 0;
  for (const wx of [-5.0, -3.4, 1.6, 3.9]) lancet('z', wx, halfD, 1, 3.3, 0.95, 2.4, gi++);
  for (const wx of [-4.6, -1.6, 1.6, 4.6]) lancet('z', wx, -halfD, -1, 3.3, 0.95, 2.4, gi++);
  lancet('x', 0, -halfW, -1, 3.3, 1.05, 2.6, gi++);

  // --- porch: cross-gable projecting forward -------------------------------
  const PX = -1.5, PW = 4.4, PPROJ = 2.9;
  const pRoofH = (PW / 2 + 0.5) * 1.3;
  const pSlopeW = PW / 2 + 0.5;
  const pAngle = Math.atan2(pSlopeW, pRoofH);
  const pSlopeLen = Math.hypot(pSlopeW, pRoofH);
  const PWALL = 4.6;
  const PZ = halfD + PPROJ;
  k.box('stoneDark', PW + 0.5, 0.42, PPROJ + 0.5, PX, 0.21, halfD + PPROJ / 2);
  k.box('stone', PW, PWALL - 0.42, PPROJ + 0.4, PX, 0.42 + (PWALL - 0.42) / 2, halfD + PPROJ / 2 - 0.2);
  for (const sx of [-1, 1]) {
    k.box('roof', pSlopeLen, 0.24, PPROJ + 0.9, PX + sx * pSlopeW / 2, PWALL + pRoofH / 2, halfD + PPROJ / 2,
      [0, 0, -sx * (Math.PI / 2 - pAngle)]);
  }
  k.box('roofDark', 0.38, 0.26, PPROJ + 1.1, PX, PWALL + pRoofH + 0.02, halfD + PPROJ / 2);
  const pRoofYAt = (u) => pRoofH * (1 - Math.abs(u) / pSlopeW) - 0.05;
  k.raw('plaster', gableGeo(PW / 2, pRoofYAt(PW / 2), pRoofYAt(0), 0.32), PX, PWALL, PZ);
  k.box('timber', PW, 0.22, 0.2, PX, PWALL + 0.1, PZ + 0.17);
  k.box('timber', 0.2, pRoofH * 0.85, 0.2, PX, PWALL + pRoofH * 0.42, PZ + 0.17);
  // Rose window in the porch gable (identity feature #6).
  k.cyl('glassA', 0.72, 0.72, 0.18, 14, PX, PWALL + 1.15, PZ + 0.2, [Math.PI / 2, 0, 0]);
  k.cyl('stoneLight', 0.92, 0.92, 0.12, 14, PX, PWALL + 1.15, PZ + 0.13, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) {
    k.box('stoneDark', 0.1, 1.5, 0.16, PX, PWALL + 1.15, PZ + 0.26, [0, 0, (i / 4) * Math.PI]);
  }
  // Tall stained-glass window over the doorway.
  lancet('z', PX, PZ, 1, 3.4, 1.15, 1.5, 1);

  // --- arched doorway in the porch ----------------------------------------
  function archedDoor(x, z, dir, w, h) {
    const t = 0.42;
    k.box('doorway', w, h, t, x, h / 2, z + dir * 0.02);
    k.cyl('doorway', w / 2, w / 2, t, 12, x, h, z + dir * 0.02, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
    k.torus('stoneLight', w / 2 + 0.2, 0.2, x, h, z + dir * 0.2, null, Math.PI);
    for (const s of [-1, 1]) k.box('stoneLight', 0.26, h, 0.32, x + s * (w / 2 + 0.16), h / 2, z + dir * 0.2);
    k.box('wood', w - 0.16, h - 0.06, 0.14, x, h / 2 - 0.03, z + dir * 0.12);
    for (const dy of [0.55, h - 0.55]) k.box('iron', w - 0.2, 0.12, 0.06, x, dy, z + dir * 0.21);
    k.cyl('iron', 0.09, 0.09, 0.1, 8, x + 0.28, h * 0.48, z + dir * 0.24, [Math.PI / 2, 0, 0]);
    k.box('stone', w + 1.0, 0.16, 0.8, x, 0.08, z + dir * 0.5);
  }
  archedDoor(PX, PZ, 1, 1.9, 2.4);

  // --- bell tower at the +X end -------------------------------------------
  // TX puts the tower's inner face 0.4 m inside the nave's +X wall (at 6.0) —
  // enough to read as attached, not enough to bury it. At 6.6 the tower
  // overlapped the nave by 1.7 m and looked like it was standing INSIDE it.
  // TX leaves 0.3 m of overlap with the nave's end wall; TZ aligns the tower's
  // FRONT face with the nave's. Centred on z it sat inside the nave's depth
  // envelope and read as rising out of the middle of the building.
  const TW = 4.6, tHalf = TW / 2;
  const TX = 6.0 + TW / 2 - 0.3, TZ = halfD - tHalf;
  const TSTONE = 10.5;            // stone stage
  const TBELF = 3.4;              // half-timbered belfry stage
  k.box('stoneDark', TW + 0.7, 0.5, TW + 0.7, TX, 0.25, TZ);
  k.box('stone', TW, TSTONE - 0.5, TW, TX, 0.5 + (TSTONE - 0.5) / 2, TZ);
  for (const y of [3.2, 6.4, 9.4]) k.box('stoneLight', TW + 0.2, 0.18, TW + 0.2, TX, y, TZ);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('stoneDark', 0.52, TSTONE - 0.6, 0.52, TX + sx * (tHalf - 0.11), 0.6 + (TSTONE - 0.6) / 2, TZ + sz * (tHalf - 0.11));
    }
  }
  lancet('z', TX, TZ + tHalf, 1, 6.2, 0.9, 2.0, 2);
  lancet('x', TZ, TX + tHalf, 1, 6.2, 0.9, 2.0, 3);
  archedDoor(TX, TZ + tHalf, 1, 1.7, 2.3);

  // Half-timbered belfry stage with two arched openings per face.
  const BY = TSTONE;
  k.box('stoneDark', TW + 0.34, 0.26, TW + 0.34, TX, BY + 0.13, TZ);
  k.box('plaster', TW + 0.1, TBELF, TW + 0.1, TX, BY + 0.26 + TBELF / 2, TZ);
  const bTop = BY + 0.26 + TBELF;
  for (const [rot, dx, dz] of [[0, 0, 1], [0, 0, -1], [Math.PI / 2, 1, 0], [Math.PI / 2, -1, 0]]) {
    const fx = TX + dx * (TW / 2 + 0.06), fz = TZ + dz * (TW / 2 + 0.06);
    for (const s of [-1, 1]) {
      const ox = s * 0.95;
      const px = rot ? fx : TX + ox, pz = rot ? TZ + ox : fz;
      k.box('louvre', 0.85, 1.5, 0.16, px, BY + 1.4, pz, [0, rot, 0]);
      k.cyl('louvre', 0.42, 0.42, 0.16, 10, px, BY + 2.15, pz, [Math.PI / 2, rot, 0], Math.PI, Math.PI / 2);
      k.torus('timber', 0.52, 0.12, px, BY + 2.15, pz, [0, rot, 0], Math.PI);
      for (const t of [-1, 1]) {
        k.box('timber', 0.16, 1.6, 0.2, rot ? px : px + t * 0.5, BY + 1.4, rot ? pz + t * 0.5 : pz, [0, rot, 0]);
      }
      // The bell.
      k.cyl('bell', 0.16, 0.3, 0.5, 8, px, BY + 1.75, pz);
      k.sphere('bell', 0.1, px, BY + 2.05, pz);
    }
    // Framing on the belfry face.
    k.box('timber', TW + 0.22, 0.24, 0.2, rot ? fx : TX, BY + 0.42, rot ? TZ : fz, [0, rot, 0]);
    k.box('timber', TW + 0.22, 0.24, 0.2, rot ? fx : TX, bTop - 0.14, rot ? TZ : fz, [0, rot, 0]);
    k.box('timber', 0.2, TBELF, 0.2, rot ? fx : TX, BY + 0.26 + TBELF / 2, rot ? TZ : fz, [0, rot, 0]);
  }
  // Cornice, then the spire and its cross.
  k.box('stoneDark', TW + 0.85, 0.34, TW + 0.85, TX, bTop + 0.17, TZ);
  k.box('stone', TW + 0.55, 0.22, TW + 0.55, TX, bTop + 0.45, TZ);
  const SPIRE = 7.6, spireBase = bTop + 0.56;
  {
    const g = new THREE.ConeGeometry(1, 1, 4);
    g.rotateY(Math.PI / 4);
    g.scale((tHalf + 0.34) * Math.SQRT2, SPIRE, (tHalf + 0.34) * Math.SQRT2);
    k.raw('roofDark', g, TX, spireBase + SPIRE / 2, TZ);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('stoneDark', 0.36, 0.55, 0.36, TX + sx * (tHalf + 0.12), spireBase + 0.2, TZ + sz * (tHalf + 0.12));
      k.cone('roofDark', 0.28, 1.4, 4, TX + sx * (tHalf + 0.12), spireBase + 1.15, TZ + sz * (tHalf + 0.12), [0, Math.PI / 4, 0]);
    }
  }
  const crossY = spireBase + SPIRE;
  k.cyl('gold', 0.1, 0.14, 0.5, 6, TX, crossY + 0.2, TZ);
  k.box('gold', 0.16, 1.25, 0.16, TX, crossY + 1.05, TZ);
  k.box('gold', 0.8, 0.16, 0.16, TX, crossY + 1.3, TZ);

  // --- stone path to the porch --------------------------------------------
  for (let i = 0; i < 5; i++) {
    k.box('stoneLight', 1.9 - i * 0.06, 0.09, 0.95, PX + range(rng, -0.06, 0.06), 0.045, PZ + 1.1 + i * 1.0);
  }

  const built = k.finish({
    stone: matte(0xb6ae9f),
    stoneLight: matte(0xc3bbab),
    stoneDark: matte(0x968e81),
    plaster: matte(0xdfd5c0),
    timber: matte(0x4a3527),
    roof: matte(0x55636f),
    roofDark: matte(0x44505c),
    doorway: matte(0x241c16),
    wood: matte(0x5a3a28),
    iron: metal(0x4c4c56),
    gold: matte(0xd4ac52),
    louvre: matte(0x2e2620),
    bell: metal(0x9a7a3c),
    // Four glass colours, so the lancets read as stained rather than tinted.
    glassA: matte(0x4a6fa8), glassB: matte(0xa84a52), glassC: matte(0x4a8a5f), glassD: matte(0xc9a63f),
    shutter: matte(0x4d5f6b),
    foliage: matte(0x5f8f45),
  });

  // Centre the finished prop on its own footprint. The tower sits at one end
  // and the path runs out the front, so the geometry's true centre is metres
  // from the origin — left alone, rotating the church in the editor swings it
  // through a wide arc and its collider ends up out in the yard. The offset has
  // to live on a WRAPPER: the renderer overwrites the returned object's
  // position with the prop's world position.
  const b = new THREE.Box3().setFromObject(built);
  const c = b.getCenter(new THREE.Vector3());
  built.position.x = -c.x;
  built.position.z = -c.z;
  const root = new THREE.Group();
  root.add(built);
  return root;
}

// =============================================================================
// Cooking house
// =============================================================================

/**
 * The cooking house. Built from references/cooking-massing.md.
 *
 * Shares a warm roof with the bakery, so it is deliberately differentiated
 * where the two will be seen together — from the FRONT. The bakery's mass is a
 * domed brick oven on its gable end; this one's is a flat stone chimney BREAST
 * on its front face with an arched, lit hearth at its foot, plus a projecting
 * gabled porch and a second stack on the ridge.
 *
 * Front is +Z.
 */
export function generateCookingHouse(seed) {
  const W = 8.6, Dp = 6.4;
  const STOREY = 2.7, STOREYS = 2, JETTY = 0.22;

  return shopWith(seed, {
    width: W, depth: Dp, storeys: STOREYS, storeyH: STOREY, jetty: JETTY,
    stoneBase: true, roofPitch: 1.4, eave: 0.6,
    roof: 0xb85a3c, plaster: 0xdfd5c0, plasterUpper: 0xe2dac6, shutter: 0x4f6b7a,
    stone: 0x9aa0a2, dormers: 1, chimney: false, doorHood: false,
  }, (k, rng) => {
    const halfW = W / 2;
    const fz = Dp / 2 + JETTY * 0.8 * (STOREYS - 1) + 0.06;
    const ridgeY = STOREY * STOREYS + (Dp / 2 + JETTY * 0.8 + 0.6) * 1.4;

    // --- stone chimney breast on the FRONT, with the hearth at its foot ----
    const BX = 2.9, BW = 2.5, BPROJ = 1.1;
    const bz = fz + BPROJ / 2 - 0.1;
    k.box('stoneDark', BW + 0.4, 0.3, BPROJ + 0.4, BX, 0.15, bz);
    k.box('stone', BW, 6.4, BPROJ, BX, 3.2, bz);
    for (let i = 0; i < 4; i++) k.box('stoneLight', BW + 0.14, 0.14, BPROJ + 0.14, BX, 1.4 + i * 1.5, bz);
    // It narrows above the eaves into the stack proper.
    k.box('stoneDark', BW + 0.24, 0.24, BPROJ + 0.24, BX, 6.5, bz);
    k.box('stone', 1.35, 2.3, 1.0, BX, 7.7, bz);
    k.box('stoneDark', 1.5, 0.24, 1.15, BX, 8.95, bz);
    // Arched hearth, fire at the mouth so it is actually visible.
    const HZ = bz + BPROJ / 2;
    k.box('sooty', 1.55, 0.95, 0.34, BX, 0.65, HZ);
    k.cyl('sooty', 0.77, 0.77, 0.34, 12, BX, 1.12, HZ, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
    k.torus('stoneLight', 0.9, 0.16, BX, 1.12, HZ + 0.14, null, Math.PI);
    for (const s of [-1, 1]) k.box('stoneLight', 0.18, 1.0, 0.22, BX + s * 0.85, 0.65, HZ + 0.14);
    k.box('coal', 1.2, 0.16, 0.28, BX, 0.36, HZ + 0.1);
    for (let i = 0; i < 8; i++) {
      k.ico('ember', range(rng, 0.09, 0.16), BX + range(rng, -0.5, 0.5), range(rng, 0.44, 0.58), HZ + 0.12, [1, 0.75, 1]);
    }
    // A pot hanging over the fire on an iron crane.
    k.box('iron', 0.07, 0.07, 0.9, BX - 0.7, 1.45, HZ - 0.2);
    k.cyl('iron', 0.28, 0.34, 0.42, 10, BX - 0.1, 1.12, HZ - 0.2);
    k.cyl('iron', 0.36, 0.36, 0.06, 10, BX - 0.1, 1.35, HZ - 0.2);

    // --- second stack on the ridge -----------------------------------------
    k.box('stone', 0.9, 2.4, 0.9, -2.7, ridgeY - 0.5, 0);
    k.box('stoneDark', 1.06, 0.2, 1.06, -2.7, ridgeY + 0.8, 0);

    // --- projecting gabled porch over the shell's own door (at x = 0) -------
    // Opening sized CLEAR of the door's approach bay (the leaf's half-width plus
    // 0.25 padding, and 2.2 m tall), so the porch frames the door instead of
    // walling it. The header is also 3 cm shallower than the jambs so the two
    // don't weld into one island whose bounding box covers the opening.
    const PW = 3.0, PPROJ = 1.35, PH = 3.4, P_IN = 1.15, P_HEAD = 2.35;
    const pcz = fz + PPROJ / 2 - 0.08;
    for (const s2 of [-1, 1]) {
      k.box('stone', PW / 2 - P_IN, PH, PPROJ, s2 * (PW / 2 + P_IN) / 2, PH / 2, pcz);
    }
    k.box('stone', PW, PH - P_HEAD, PPROJ - 0.03, 0, P_HEAD + (PH - P_HEAD) / 2, pcz);
    k.box('stoneDark', PW + 0.3, 0.26, PPROJ + 0.3, 0, PH + 0.13, pcz);
    const pSlope = Math.hypot(PW / 2 + 0.35, 1.5);
    const pAng = Math.atan2(PW / 2 + 0.35, 1.5);
    for (const sx of [-1, 1]) {
      k.box('roofP', pSlope, 0.2, PPROJ + 0.7, sx * (PW / 2 + 0.35) / 2, PH + 0.26 + 0.75, pcz,
        [0, 0, -sx * (Math.PI / 2 - pAng)]);
    }
    k.raw('plasterP', gableGeo(PW / 2, 1.5 * (1 - (PW / 2) / (PW / 2 + 0.35)), 1.45, 0.28),
      0, PH + 0.26, fz + PPROJ - 0.08);
    // Arch head and jamb mouldings round the opening.
    const pz = fz + PPROJ - 0.08;
    k.torus('stoneLight', P_IN + 0.12, 0.15, 0, P_HEAD, pz + 0.13, null, Math.PI);
    for (const s2 of [-1, 1]) k.box('stoneLight', 0.2, P_HEAD, 0.2, s2 * (P_IN + 0.1), P_HEAD / 2, pz + 0.13);
    k.box('lampGlass', 0.3, 0.22, 0.1, 0, P_HEAD + 0.45, pz + 0.1);

    // --- awning and table on the right --------------------------------------
    const AX = halfW + 1.9;
    for (const dz of [-1, 1]) k.box('woodDark', 0.13, 2.3, 0.13, AX + 0.9, 1.15, fz - 1.2 + dz * 0.9);
    k.box('woodDark', 0.13, 0.13, 2.1, AX + 0.9, 2.32, fz - 1.2);
    const aLen = Math.hypot(AX + 0.9 - halfW + 0.2, 0.8);
    k.box('awning', aLen, 0.12, 2.4, (halfW - 0.2 + AX + 0.9) / 2, 2.75, fz - 1.2, [0, 0, -Math.atan2(0.8, aLen)]);
    k.box('wood', 1.9, 0.1, 0.85, AX + 0.2, 0.86, fz - 1.2);
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      k.box('woodDark', 0.11, 0.86, 0.11, AX + 0.2 + dx * 0.8, 0.43, fz - 1.2 + dz * 0.3);
    }
    // Pots and food on the table.
    for (let i = 0; i < 3; i++) {
      k.cyl('iron', 0.16, 0.2, 0.24, 9, AX - 0.45 + i * 0.62, 1.03, fz - 1.2 + range(rng, -0.16, 0.16));
    }
    for (let i = 0; i < 4; i++) {
      k.ico(i % 2 ? 'veg1' : 'veg2', range(rng, 0.09, 0.13),
        AX + range(rng, -0.7, 0.7), 0.99, fz - 1.35 + range(rng, -0.1, 0.1));
    }

    // --- baskets, crates and a barrel on the ground, clear of the door ------
    for (const [cx, cz, s] of [[-halfW - 0.9, 0.6, 1.0], [-halfW - 1.3, 1.6, 0.85]]) {
      k.cyl('basket', 0.34 * s, 0.29 * s, 0.5 * s, 10, cx, 0.25 * s, fz + cz);
      k.cyl('basketDark', 0.37 * s, 0.37 * s, 0.07 * s, 10, cx, 0.5 * s, fz + cz);
      for (let i = 0; i < 3; i++) {
        k.ico(i % 2 ? 'veg1' : 'veg2', range(rng, 0.1, 0.14), cx + range(rng, -0.16, 0.16), 0.56 * s, fz + cz + range(rng, -0.16, 0.16));
      }
    }
    k.box('wood', 0.7, 0.55, 0.6, -halfW - 0.4, 0.27, fz + 2.4);
    k.box('woodDark', 0.76, 0.07, 0.66, -halfW - 0.4, 0.58, fz + 2.4);
    barrel(k, AX + 1.3, 0, fz + 0.3, 1.0);
  }, {
    roofP: matte(0x9c4b32), plasterP: matte(0xdfd5c0),
    awning: matte(0x36495c),
    sooty: matte(0x241f1b), coal: matte(0x25221f), ember: EMBER,
    basket: matte(0xbf9a63), basketDark: matte(0xa07f4e),
    veg1: matte(0xc2452f), veg2: matte(0x6f9c46),
    lampGlass: new THREE.MeshStandardMaterial({
      color: 0xffe9b0, emissive: 0xffcf70, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0,
    }),
  });
}

// =============================================================================
// Tannery
// =============================================================================

/**
 * The tannery. Built from references/tannery-massing.md.
 *
 * A single OPEN-FRONTED shed — its own deep roof on posts is the shelter — hung
 * with stretched hides, and the darkest building in the set. Differentiated
 * from the carpenter on purpose: that one is a closed stone workshop with a
 * separate lean-to and a bare scaffold beside it.
 *
 * Front is +Z.
 */
export function generateTannery(seed) {
  const rng = createRng(seed);
  const k = makeKit();

  const W = 9.0, Dp = 6.5, WALL = 3.6;
  const halfW = W / 2, halfD = Dp / 2;
  const roofH = (halfD + 1.3) * 0.72;          // low and wide
  const slopeD = halfD + 1.3;                   // deep front overhang
  const angle = Math.atan2(slopeD, roofH);
  const slopeLen = Math.hypot(slopeD, roofH);

  // --- stone base and the three closed walls ------------------------------
  k.box('stoneDark', W + 0.5, 0.32, Dp + 0.5, 0, 0.16, 0);
  k.box('stone', W, 1.15, Dp, 0, 0.32 + 0.575, 0);
  // Back and sides above the base, in dark boarding.
  k.box('boards', W, WALL - 1.47, 0.42, 0, 1.47 + (WALL - 1.47) / 2, -halfD + 0.21);
  for (const sx of [-1, 1]) {
    k.box('boards', 0.42, WALL - 1.47, Dp - 0.42, sx * (halfW - 0.21), 1.47 + (WALL - 1.47) / 2, 0.21);
  }
  // Vertical battens on the boarding, so it reads as planks.
  for (let i = 0; i < 9; i++) {
    k.box('timber', 0.14, WALL - 1.55, 0.5, -halfW + 0.6 + i * ((W - 1.2) / 8), 1.5 + (WALL - 1.55) / 2, -halfD + 0.24);
  }
  // Sill and head plates.
  k.box('timber', W + 0.1, 0.22, 0.5, 0, 1.5, -halfD + 0.24);
  k.box('timber', W + 0.1, 0.24, 0.5, 0, WALL - 0.1, -halfD + 0.24);
  for (const sx of [-1, 1]) k.box('timber', 0.5, 0.24, Dp, sx * (halfW - 0.24), WALL - 0.1, 0.1);

  // --- posts carrying the open front --------------------------------------
  for (const px of [-halfW + 0.45, -1.2, 1.2, halfW - 0.45]) {
    k.box('timber', 0.32, WALL, 0.32, px, WALL / 2, halfD - 0.3);
    k.box('timber', 0.44, 0.24, 0.44, px, WALL - 0.12, halfD - 0.3);
    // Angle braces up to the head beam.
    for (const s of [-1, 1]) {
      k.box('timber', 0.9, 0.16, 0.16, px + s * 0.32, WALL - 0.45, halfD - 0.3, [0, 0, s * 0.72]);
    }
  }
  k.box('timber', W + 0.3, 0.3, 0.42, 0, WALL - 0.02, halfD - 0.3);

  // --- low wide roof with exposed rafters ---------------------------------
  for (const sz of [-1, 1]) {
    k.box('roof', W + 1.1, 0.22, slopeLen, 0, WALL + roofH / 2, sz * slopeD / 2,
      [sz * (Math.PI / 2 - angle), 0, 0]);
  }
  k.box('ridge', W + 1.4, 0.34, 0.46, 0, WALL + roofH + 0.04, 0);
  const roofYAt = (z) => roofH * (1 - Math.abs(z) / slopeD) - 0.05;
  for (const sx of [-1, 1]) {
    k.raw('boards', gableGeo(halfD, roofYAt(halfD), roofYAt(0), 0.3), sx * halfW, WALL, 0, [0, Math.PI / 2, 0]);
  }
  // Rafter tails poking out under the front slope.
  for (let i = 0; i < 8; i++) {
    const rx = -halfW + 0.7 + i * ((W - 1.4) / 7);
    k.box('timber', 0.14, 0.16, slopeLen * 0.9, rx, WALL + roofH / 2 - 0.12, slopeD / 2,
      [Math.PI / 2 - angle, 0, 0]);
  }

  // NO CHIMNEY. A tannery cures hides in cold liquor pits; the stone stack was
  // invented, and it dominated the silhouette.

  /** A hide stretched in a frame: four rails and a taut skin inside them. */
  function hide(x, y, z, w, h, rot) {
    const t = 0.1;
    k.box('timber', w + 0.24, t, t, x, y + h / 2, z, rot);
    k.box('timber', w + 0.24, t, t, x, y - h / 2, z, rot);
    for (const s of [-1, 1]) k.box('timber', t, h, t, x + s * (w / 2 + 0.07), y, z, rot);
    k.box('hide', w, h, 0.05, x, y, z, rot);
    // Lacing: short pegs round the frame.
    for (let i = 0; i < 4; i++) {
      const u = -w / 2 + (i + 0.5) * (w / 4);
      k.box('rope', 0.05, 0.16, 0.05, x + u, y + h / 2 - 0.06, z, rot);
      k.box('rope', 0.05, 0.16, 0.05, x + u, y - h / 2 + 0.06, z, rot);
    }
  }

  // Hides on FREE-STANDING frames out in front, in the light.
  //
  // They used to hang under the front eaves, deep in the shed's shadow, where
  // three dark rectangles in a row read as holes knocked through the wall
  // rather than as stretched skins — and the building became unidentifiable.
  // Out front they are the brightest thing in it, which is what the reference
  // has, and the open bay behind them stays legibly empty.
  for (const [fx, fw, fh] of [[-3.4, 1.7, 2.0], [-0.1, 1.5, 1.8], [3.2, 1.7, 2.05]]) {
    const fz = halfD + 1.35;
    const top = fh + 0.85;
    for (const s of [-1, 1]) k.box('timber', 0.16, top + 0.2, 0.16, fx + s * (fw / 2 + 0.22), (top + 0.2) / 2, fz);
    k.box('timber', fw + 0.72, 0.16, 0.16, fx, top + 0.1, fz);
    k.box('timber', fw + 0.72, 0.16, 0.16, fx, 0.3, fz);
    // Back-leaning legs, like an easel: each runs from partway up an upright
    // down to the GROUND behind the frame. They were horizontal sticks jutting
    // out sideways at 45°, touching nothing at either end.
    const legTop = top * 0.55, legBack = 0.9;
    const legLen = Math.hypot(legTop, legBack);
    const legAng = Math.atan2(legBack, legTop);
    for (const s of [-1, 1]) {
      k.box('timber', 0.14, legLen, 0.14,
        fx + s * (fw / 2 + 0.22), legTop / 2, fz - legBack / 2, [legAng, 0, 0]);
    }
    hide(fx, 0.3 + fh / 2 + 0.25, fz, fw, fh, null);
  }

  // --- vats, barrels and a work table -------------------------------------
  // Open vat in front, with dark liquor in it.
  const vx = halfW + 1.7, vz = halfD + 0.7;
  k.cyl('woodDark', 0.78, 0.7, 1.0, 12, vx, 0.5, vz);
  for (const hy of [0.2, 0.8]) k.cyl('iron', 0.81, 0.81, 0.07, 12, vx, hy, vz);
  k.cyl('liquor', 0.7, 0.7, 0.06, 12, vx, 0.92, vz);
  barrel(k, halfW + 1.5, 0, halfD - 1.1, 1.0);
  barrel(k, halfW + 2.5, 0, halfD - 0.2, 0.9);
  barrel(k, -halfW + 0.9, 0, -halfD + 1.4, 0.95);
  // Work table inside, against the back wall.
  k.box('wood', 2.4, 0.12, 0.8, -1.6, 0.95, -halfD + 1.1);
  for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
    k.box('timber', 0.12, 0.95, 0.12, -1.6 + dx * 1.05, 0.47, -halfD + 1.1 + dz * 0.3);
  }
  for (let i = 0; i < 3; i++) {
    k.box('iron', 0.34, 0.05, 0.1, -2.3 + i * 0.7, 1.03, -halfD + 1.05, [0, range(rng, -0.4, 0.4), 0]);
  }
  k.box('hide', 1.5, 0.06, 0.7, -1.5, 1.05, -halfD + 1.15, [0, 0.12, 0]);

  return k.finish({
    stone: matte(0x9e968a),
    stoneLight: matte(0xb0a89b),
    stoneDark: matte(0x827a70),
    boards: matte(0x4e3b2a),
    timber: matte(0x3f2f21),
    roof: matte(0x3a3129),
    ridge: matte(0x2e271f),
    hide: matte(0xd2b184),
    rope: matte(0x8a7247),
    wood: matte(0x7a5636),
    woodDark: matte(0x5c422a),
    liquor: matte(0x2a1f16),
    iron: metal(0x4c4c56),
    sooty: matte(0x241f1b),
    coal: matte(0x25221f),
    ember: EMBER,
  });
}
