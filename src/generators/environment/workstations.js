// src/generators/environment/workstations.js
// A second, much more detailed set of crafting workstations, rebuilt from a
// reference sheet (2026-07-25). These live in the 'misc' palette category and
// sit ALONGSIDE the six simpler `station-*` props in craftingStations.js —
// added, not replacing, the same call Dennis made for the crystal clusters.
//
// Two deliberate differences from craftingStations.js:
//  1. No random `g.rotation.y`. Every one of these has a clear FRONT (the side
//     you stand at to work), which is +Z here. Props carry an authored
//     `rotation`/`rotationDeg` in world.json (see render/scene.js), so the
//     author aims them — a random spin would just put the loom's back or the
//     cabinet's open drawers toward the player.
//  2. Detail comes from composed primitives, curves and Shapes rather than
//     boxes alone, because the reference's identity is in the small stuff:
//     the anvil's horn, the loom's warp threads, the hide's scalloped edge,
//     the alchemy still's copper coil.
//
// Same seeded-RNG contract as the rest of the library: seed 42 always builds
// the same workstation. Randomness is kept to palette picks and small jitter
// so every seed keeps the footprint its collider in propTypes.js declares.
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';

// Palettes run LIGHT on purpose. The first pass used true wood/iron browns and
// near-blacks and rendered as dark silhouettes in the overworld's bright
// midday light — the reference sheet's tones are much higher-key than the raw
// material colours suggest. These are the corrected values.
const WOOD_DARK = [0x7a5636, 0x86603c, 0x6f4e30];
const WOOD_MID = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_WARM = [0xc2925c, 0xcc9c64, 0xb58754];
const STONE = [0x9a9aa0, 0x8e8e94, 0xa6a6ac];
const IRON = 0x55555e;
const IRON_LIGHT = 0x7a7a84;
const BRASS = 0xd4ac52;
const COPPER = 0xd08a45;
const THREAD = 0xe4d8bc;
const HIDE = 0xb5895c;

/** Matte, flat-shaded — the look every other prop in the library uses. */
function mat(color, extra) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...extra });
}
/**
 * Smooth-shaded, for turned/forged parts where facets read as damage.
 *
 * `metalness` STAYS 0. This project has no environment map (nothing sets
 * `scene.environment` or an `envMap` anywhere in src/render), and a metallic
 * MeshStandardMaterial has no diffuse term — it renders whatever it reflects,
 * which off an empty environment is black. The first version of this file set
 * metalness 0.35 (0.7 on the copper) and every iron part came out a dark
 * silhouette. Metal reads as metal here through colour and low roughness.
 */
function smooth(color, extra) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0, ...extra });
}
/** Glassware. Kept cheap: transparent standard material, no refraction. */
function glass(color) {
  return new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0,
  });
}

/**
 * World scale. Everything below is authored in real-world metres (a bench top
 * at 0.85m), which turned out to read as doll furniture next to the player —
 * these are landmarks you walk up to, not props you step over. 2x is Dennis's
 * call from the first in-game screenshots.
 *
 * It has to live on an INNER wrapper, not on the group we return: the renderer
 * applies an authored `prop.scale` with `mesh.scale.setScalar()` on the root
 * (render/scene.js:665), which would overwrite a scale set there and silently
 * snap everything back to 1x the moment an author scaled one.
 */
const SCALE = 2;

const finish = (g) => {
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.scale.setScalar(SCALE);
  const root = new THREE.Group();
  root.add(g);
  return root;
};

// --- Tiny placement helpers. These exist purely so the builders below read as
// a parts list instead of six lines of boilerplate per screw and spool. ---

function box(g, m, w, h, d, x, y, z, rot) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  g.add(mesh);
  return mesh;
}

function cyl(g, m, rTop, rBot, h, seg, x, y, z, rot) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  g.add(mesh);
  return mesh;
}

/** A cylinder laid along X — every beam, bar, spit and screw in this file. */
function barX(g, m, r, len, x, y, z) {
  return cyl(g, m, r, r, len, 10, x, y, z, [0, 0, Math.PI / 2]);
}

/** A cylinder laid along Z — warp threads, log-store firewood. */
function barZ(g, m, r, len, x, y, z) {
  return cyl(g, m, r, r, len, 8, x, y, z, [Math.PI / 2, 0, 0]);
}

function ring(g, m, radius, tube, x, y, z, rot, arc) {
  const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 6, 16, arc), m);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  g.add(mesh);
  return mesh;
}

/** A spool of thread: a turned core between two flanges. Used by both looms. */
function spool(g, color, x, y, z, s = 1) {
  const woodM = mat(0xd2bc98);
  cyl(g, mat(color, { roughness: 0.95 }), 0.05 * s, 0.05 * s, 0.075 * s, 10, x, y + 0.05 * s, z);
  cyl(g, woodM, 0.056 * s, 0.056 * s, 0.012 * s, 10, x, y + 0.006 * s, z);
  cyl(g, woodM, 0.056 * s, 0.056 * s, 0.012 * s, 10, x, y + 0.094 * s, z);
  cyl(g, woodM, 0.016 * s, 0.016 * s, 0.11 * s, 6, x, y + 0.05 * s, z);
}

/** Open shears lying flat — the reference puts a pair beside both looms. */
function scissors(g, x, y, z, yaw = 0) {
  const steel = smooth(0xd2d5da);
  const grip = mat(0xb04c56);
  const blade = (a) => {
    box(g, steel, 0.17, 0.008, 0.018, x + Math.cos(yaw + a) * 0.085, y + 0.006, z + Math.sin(yaw + a) * 0.085, [0, -(yaw + a), 0]);
  };
  blade(0.16);
  blade(-0.16);
  ring(g, grip, 0.028, 0.008, x - 0.15, y + 0.006, z + 0.045, [Math.PI / 2, 0, 0]);
  ring(g, grip, 0.028, 0.008, x - 0.15, y + 0.006, z - 0.045, [Math.PI / 2, 0, 0]);
}

/**
 * A stretched hide with a scalloped, hand-cut edge. Built as a Shape so the
 * silhouette is real geometry — a plain plane reads as a rug, and the wavy
 * outline is the single feature that makes the tanning rack legible.
 */
function hideGeometry(w, h, bulge = 0.05) {
  const s = new THREE.Shape();
  const hw = w / 2;
  const hh = h / 2;
  const n = 4;
  s.moveTo(-hw, -hh);
  for (let i = 0; i < n; i++) {
    const x0 = -hw + (w * i) / n;
    const x1 = -hw + (w * (i + 1)) / n;
    s.quadraticCurveTo((x0 + x1) / 2, -hh - bulge, x1, -hh);
  }
  for (let i = 0; i < n; i++) {
    const y0 = -hh + (h * i) / n;
    const y1 = -hh + (h * (i + 1)) / n;
    s.quadraticCurveTo(hw + bulge, (y0 + y1) / 2, hw, y1);
  }
  for (let i = 0; i < n; i++) {
    const x0 = hw - (w * i) / n;
    const x1 = hw - (w * (i + 1)) / n;
    s.quadraticCurveTo((x0 + x1) / 2, hh + bulge, x1, hh);
  }
  for (let i = 0; i < n; i++) {
    const y0 = hh - (h * i) / n;
    const y1 = hh - (h * (i + 1)) / n;
    s.quadraticCurveTo(-hw - bulge, (y0 + y1) / 2, -hw, y1);
  }
  return new THREE.ShapeGeometry(s, 6);
}

// =============================================================================
// 1. Blacksmith's Forge — anvil, stone coal forge, iron stock
// =============================================================================
export function generateWorkstationForge(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const iron = smooth(IRON);
  const ironFace = smooth(0x9aa0a8, { roughness: 0.35 });
  const stoneM = mat(pick(rng, STONE));

  // --- Anvil, at +X. Classic London pattern: splayed base, waisted stem,
  // wide face, tapered horn one end, square heel the other. ---
  const ax = 0.42;
  box(g, iron, 0.52, 0.14, 0.40, ax, 0.07, 0);
  box(g, iron, 0.26, 0.26, 0.24, ax, 0.27, 0);
  box(g, iron, 0.66, 0.17, 0.32, ax, 0.485, 0);
  box(g, ironFace, 0.66, 0.03, 0.32, ax, 0.585, 0);
  // Horn points -X, so it reads against the forge behind it.
  cyl(g, iron, 0.0, 0.13, 0.44, 8, ax - 0.55, 0.50, 0, [0, 0, Math.PI / 2]);
  box(g, iron, 0.12, 0.17, 0.30, ax + 0.39, 0.485, 0);
  // A hammer left on the face.
  barX(g, mat(pick(rng, WOOD_WARM)), 0.018, 0.26, ax - 0.02, 0.625, 0.06);
  box(g, iron, 0.09, 0.07, 0.07, ax + 0.15, 0.63, 0.06);

  // --- Stone forge, at -X: a drum of laid stone with a coal bed. ---
  const fx = -0.62;
  cyl(g, stoneM, 0.44, 0.50, 0.48, 12, fx, 0.24, -0.06);
  cyl(g, mat(pick(rng, STONE)), 0.48, 0.46, 0.09, 12, fx, 0.50, -0.06);
  // Individual laid stones around the drum, so it isn't a smooth barrel.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.2;
    box(g, mat(pick(rng, STONE)), 0.17, 0.11, 0.10,
      fx + Math.cos(a) * 0.46, 0.34, -0.06 + Math.sin(a) * 0.46, [0, -a, 0]);
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 - 0.3;
    box(g, mat(pick(rng, STONE)), 0.19, 0.12, 0.10,
      fx + Math.cos(a) * 0.49, 0.13, -0.06 + Math.sin(a) * 0.49, [0, -a, 0]);
  }
  // Coal bed: a dark disc heaped with lumps, a few of them still live.
  cyl(g, mat(0x3a3a42), 0.42, 0.42, 0.04, 12, fx, 0.535, -0.06);
  const coalM = mat(0x46464f);
  const emberM = mat(0xc2481f, { emissive: 0xc2481f, emissiveIntensity: 0.5 });
  for (let i = 0; i < 13; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0, 0.33);
    const lump = new THREE.Mesh(
      new THREE.DodecahedronGeometry(range(rng, 0.045, 0.085), 0),
      i % 5 === 0 ? emberM : coalM
    );
    lump.position.set(fx + Math.cos(a) * d, range(rng, 0.55, 0.60), -0.06 + Math.sin(a) * d);
    lump.rotation.set(range(rng, 0, 3), range(rng, 0, 3), range(rng, 0, 3));
    g.add(lump);
  }

  // --- Iron stock lying out front, waiting to be worked. ---
  const stockM = smooth(0x767d88);
  for (let i = 0; i < 4; i++) {
    box(g, stockM, 0.62, 0.025, 0.05,
      0.16 + range(rng, -0.05, 0.05), 0.0125, 0.46 + i * 0.055,
      [0, range(rng, -0.12, 0.12), 0]);
  }

  return finish(g);
}

// =============================================================================
// 2. Carpenter's Bench — laminated top, twin face vises, planing stop
// =============================================================================
export function generateWorkstationCarpenter(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_MID));
  const woodDark = mat(pick(rng, WOOD_DARK));
  const iron = smooth(IRON);

  // Laminated top: four boards with visible seams, not one slab.
  for (let i = 0; i < 4; i++) {
    box(g, i % 2 ? wood : mat(pick(rng, WOOD_MID)), 1.50, 0.10, 0.155, 0, 0.80, -0.245 + i * 0.163);
  }
  // Planing stop standing proud of the surface at the left end.
  box(g, woodDark, 0.20, 0.16, 0.13, -0.55, 0.93, -0.12);

  for (const [x, z] of [[-0.58, -0.22], [0.58, -0.22], [-0.58, 0.22], [0.58, 0.22]]) {
    box(g, woodDark, 0.13, 0.75, 0.13, x, 0.375, z);
  }
  // Double stretcher down the length, plus end rails — the reference's frame.
  box(g, woodDark, 1.04, 0.08, 0.06, 0, 0.24, 0);
  box(g, woodDark, 1.04, 0.08, 0.06, 0, 0.38, 0);
  box(g, woodDark, 0.07, 0.08, 0.40, -0.58, 0.31, 0);
  box(g, woodDark, 0.07, 0.08, 0.40, 0.58, 0.31, 0);

  // Two face vises: jaw, screw, and the hanging iron handwheel.
  for (const vx of [-0.52, 0.52]) {
    box(g, wood, 0.24, 0.30, 0.05, vx, 0.62, 0.355);
    cyl(g, iron, 0.028, 0.028, 0.20, 8, vx, 0.70, 0.44, [Math.PI / 2, 0, 0]);
    ring(g, iron, 0.075, 0.018, vx, 0.60, 0.50);
    box(g, iron, 0.06, 0.06, 0.10, vx, 0.70, 0.38);
  }

  return finish(g);
}

// =============================================================================
// 3. Tapestry Loom — upright, warp-weighted, half-finished band on the beam
// =============================================================================
export function generateWorkstationTapestryLoom(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_MID));
  const woodDark = mat(pick(rng, WOOD_DARK));

  for (const sx of [-1, 1]) {
    box(g, wood, 0.10, 1.50, 0.13, sx * 0.56, 0.75, 0);
    box(g, woodDark, 0.16, 0.10, 0.72, sx * 0.56, 0.05, 0);
    box(g, woodDark, 0.06, 0.46, 0.06, sx * 0.47, 0.26, 0, [0, 0, sx * 0.42]);
  }

  // Beams. The top one carries the finished cloth already wound onto it.
  barX(g, woodDark, 0.065, 1.34, 0, 1.42, 0);
  cyl(g, woodDark, 0.09, 0.09, 0.06, 8, -0.65, 1.42, 0, [0, 0, Math.PI / 2]);
  cyl(g, woodDark, 0.09, 0.09, 0.06, 8, 0.65, 1.42, 0, [0, 0, Math.PI / 2]);
  barX(g, mat(0xe0d2b4), 0.115, 1.02, 0, 1.42, 0);
  barX(g, woodDark, 0.055, 1.30, 0, 1.20, 0);
  barX(g, woodDark, 0.07, 1.30, 0, 0.42, 0);
  barX(g, mat(0xe0d2b4), 0.11, 0.94, 0, 0.42, 0);

  // Warp: the identity of the object. Individual threads, not a plane.
  const threadM = mat(THREAD, { roughness: 1 });
  const threadGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.56, 3);
  for (let i = 0; i < 26; i++) {
    const t = new THREE.Mesh(threadGeo, threadM);
    t.position.set(-0.46 + (i / 25) * 0.92, 0.90, 0);
    g.add(t);
  }
  barX(g, woodDark, 0.032, 1.20, 0, 0.98, 0.04);

  // The woven band, mid-work, with its pattern picked out.
  box(g, mat(0xb24d3f), 0.96, 0.20, 0.045, 0, 0.55, 0);
  for (let i = 0; i < 5; i++) {
    box(g, mat(0xeaddc0), 0.07, 0.055, 0.05, -0.34 + i * 0.17, 0.55, 0.005);
  }

  box(g, woodDark, 0.05, 0.42, 0.05, 0.62, 0.86, 0.06, [0, 0, 0.26]);

  spool(g, 0xd6c8a6, -0.16, 0, 0.42);
  spool(g, 0xc25a5f, 0.14, 0, 0.46);
  scissors(g, -0.44, 0, 0.44, 0.5);

  return finish(g);
}

// =============================================================================
// 4. Weaver's Floor Loom — four-post frame, castle, cloth beam, treadles
// =============================================================================
export function generateWorkstationFloorLoom(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_MID));
  const woodDark = mat(pick(rng, WOOD_DARK));

  for (const [x, z] of [[-0.60, -0.40], [0.60, -0.40], [-0.60, 0.40], [0.60, 0.40]]) {
    box(g, wood, 0.09, 1.00, 0.09, x, 0.50, z);
    box(g, woodDark, 0.15, 0.06, 0.15, x, 0.03, z);
  }
  box(g, woodDark, 0.08, 0.08, 0.88, -0.60, 1.00, 0);
  box(g, woodDark, 0.08, 0.08, 0.88, 0.60, 1.00, 0);

  // "Castle": the raised frame that carries the heddle shafts.
  box(g, wood, 0.07, 0.36, 0.07, -0.52, 1.18, -0.05);
  box(g, wood, 0.07, 0.36, 0.07, 0.52, 1.18, -0.05);
  box(g, woodDark, 1.14, 0.07, 0.08, 0, 1.36, -0.05);
  box(g, woodDark, 1.02, 0.035, 0.03, 0, 1.16, -0.05);
  box(g, woodDark, 1.02, 0.035, 0.03, 0, 1.08, -0.05);

  const threadM = mat(THREAD, { roughness: 1 });
  const heddleGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.16, 3);
  for (let i = 0; i < 22; i++) {
    const h = new THREE.Mesh(heddleGeo, threadM);
    h.position.set(-0.42 + (i / 21) * 0.84, 1.04, -0.05);
    g.add(h);
  }

  // The warp sheet running front-to-back under the shafts.
  const warpGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.84, 3);
  for (let i = 0; i < 20; i++) {
    const w = new THREE.Mesh(warpGeo, threadM);
    w.position.set(-0.42 + (i / 19) * 0.84, 0.95, -0.02);
    w.rotation.x = Math.PI / 2;
    g.add(w);
  }

  barX(g, woodDark, 0.06, 1.10, 0, 0.98, -0.42);
  barX(g, woodDark, 0.06, 1.10, 0, 0.94, 0.36);
  barX(g, woodDark, 0.075, 1.14, 0, 0.74, 0.44);
  // Woven cloth wound onto the front beam, patterned like the reference.
  barX(g, mat(0xb24d3f), 0.125, 0.94, 0, 0.74, 0.44);
  for (let i = 0; i < 3; i++) {
    barX(g, mat(0xeaddc0), 0.128, 0.06, -0.28 + i * 0.28, 0.74, 0.44);
  }
  // Ratchet crank on the right end of the cloth beam.
  barX(g, smooth(IRON_LIGHT), 0.022, 0.18, 0.68, 0.74, 0.44);
  box(g, smooth(IRON_LIGHT), 0.03, 0.03, 0.12, 0.75, 0.74, 0.50);

  box(g, woodDark, 1.06, 0.04, 0.62, 0, 0.28, 0);
  spool(g, 0xd6c8a6, -0.32, 0.30, 0.06);
  spool(g, 0xc25a5f, -0.10, 0.30, 0.12);
  spool(g, 0x8fa077, 0.14, 0.30, 0.04);
  scissors(g, 0.38, 0.30, 0.10, 0.3);

  box(g, woodDark, 0.30, 0.03, 0.44, -0.18, 0.14, 0.06, [-0.12, 0, 0]);
  box(g, woodDark, 0.30, 0.03, 0.44, 0.18, 0.14, 0.06, [-0.12, 0, 0]);

  return finish(g);
}

// =============================================================================
// 5. Tanning Rack — laced hide in a trestle frame, crank, scraping knives
// =============================================================================
export function generateWorkstationTanningRack(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_MID));
  const woodDark = mat(pick(rng, WOOD_DARK));
  const cord = mat(0xd0c2a2, { roughness: 1 });

  for (const sx of [-1, 1]) {
    box(g, wood, 0.10, 1.42, 0.11, sx * 0.60, 0.71, 0);
    box(g, woodDark, 0.15, 0.10, 0.80, sx * 0.60, 0.05, 0);
    box(g, woodDark, 0.07, 0.52, 0.07, sx * 0.50, 0.28, 0, [0, 0, sx * 0.46]);
  }
  box(g, woodDark, 1.44, 0.11, 0.12, 0, 1.42, 0);
  cyl(g, woodDark, 0.085, 0.085, 0.07, 8, -0.75, 1.42, 0, [0, 0, Math.PI / 2]);
  cyl(g, woodDark, 0.085, 0.085, 0.07, 8, 0.75, 1.42, 0, [0, 0, Math.PI / 2]);

  for (const hx of [-0.28, 0, 0.28]) {
    ring(g, smooth(IRON_LIGHT), 0.035, 0.011, hx, 1.32, 0);
  }

  // The stretched hide. DoubleSide because you can walk behind the rack.
  const hideM = new THREE.MeshStandardMaterial({
    color: HIDE, roughness: 0.85, side: THREE.DoubleSide, flatShading: false,
  });
  const hide = new THREE.Mesh(hideGeometry(0.94, 0.96, 0.055), hideM);
  hide.position.set(0, 0.84, 0);
  g.add(hide);

  // Lacing: the hide is tied to the frame, not floating inside it.
  for (let i = 0; i < 4; i++) {
    const x = -0.35 + i * 0.235;
    cyl(g, cord, 0.006, 0.006, 0.24, 4, x, 1.24, 0, [0, 0, x * 0.35]);
  }
  for (let i = 0; i < 3; i++) {
    const y = 0.60 + i * 0.24;
    barX(g, cord, 0.006, 0.20, -0.57, y, 0);
    barX(g, cord, 0.006, 0.20, 0.57, y, 0);
  }
  for (let i = 0; i < 2; i++) {
    cyl(g, cord, 0.006, 0.006, 0.22, 4, -0.18 + i * 0.36, 0.30, 0);
  }

  barX(g, smooth(IRON_LIGHT), 0.025, 0.18, 0.70, 0.95, 0);
  box(g, smooth(IRON_LIGHT), 0.03, 0.17, 0.03, 0.78, 0.88, 0);

  // A second hide on the ground with the scraping tools on it.
  const flat = new THREE.Mesh(hideGeometry(0.56, 0.46, 0.04), hideM);
  flat.rotation.x = -Math.PI / 2;
  flat.position.set(0.02, 0.012, 0.50);
  g.add(flat);
  for (let i = 0; i < 2; i++) {
    const kx = -0.12 + i * 0.26;
    box(g, smooth(0xd2d5da), 0.17, 0.012, 0.038, kx, 0.03, 0.50, [0, range(rng, -0.3, 0.3), 0]);
    box(g, mat(pick(rng, WOOD_DARK)), 0.075, 0.022, 0.03, kx + 0.12, 0.032, 0.50);
  }

  return finish(g);
}

// =============================================================================
// 6. Jeweler's Desk — back gallery of tools, cutting mat, loupe, cut stones
// =============================================================================
export function generateWorkstationJeweler(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_WARM));
  const woodDark = mat(pick(rng, WOOD_MID));
  const steel = smooth(0xd2d5da);

  box(g, wood, 1.12, 0.06, 0.58, 0, 0.76, 0);
  // Tapered square legs, flaring to the floor like the reference's.
  for (const [x, z] of [[-0.48, -0.22], [0.48, -0.22], [-0.48, 0.22], [0.48, 0.22]]) {
    cyl(g, woodDark, 0.032, 0.055, 0.76, 4, x, 0.38, z, [0, Math.PI / 4, 0]);
  }
  box(g, woodDark, 1.00, 0.09, 0.04, 0, 0.70, 0.27);
  box(g, wood, 0.40, 0.13, 0.03, 0, 0.685, 0.295);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), smooth(BRASS));
  knob.position.set(0, 0.685, 0.325);
  g.add(knob);
  // Painted enamel roundels inlaid in the apron.
  cyl(g, mat(0x4a83c4), 0.038, 0.038, 0.012, 10, 0.20, 0.685, 0.30, [Math.PI / 2, 0, 0]);
  cyl(g, mat(0xd8d2c4), 0.038, 0.038, 0.012, 10, 0.31, 0.685, 0.30, [Math.PI / 2, 0, 0]);

  // Raised back gallery holding the tools upright.
  box(g, wood, 1.12, 0.03, 0.20, 0, 0.885, -0.19);
  box(g, woodDark, 0.05, 0.10, 0.20, -0.53, 0.83, -0.19);
  box(g, woodDark, 0.05, 0.10, 0.20, 0.53, 0.83, -0.19);
  box(g, woodDark, 1.12, 0.15, 0.03, 0, 0.965, -0.28);

  cyl(g, woodDark, 0.075, 0.062, 0.13, 8, -0.34, 0.965, -0.19);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    cyl(g, steel, 0.008, 0.008, 0.24, 4,
      -0.34 + Math.cos(a) * 0.026, 1.06, -0.19 + Math.sin(a) * 0.026,
      [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18]);
  }
  box(g, woodDark, 0.30, 0.09, 0.17, 0.34, 0.945, -0.19);
  for (let i = 0; i < 3; i++) {
    ring(g, smooth(BRASS), 0.022, 0.006, 0.24 + i * 0.10, 0.99, -0.19, [Math.PI / 2, 0, 0]);
  }

  // Bench-top: mat, loupe, loose stones, a graver and a scribe.
  box(g, mat(0x93a09a), 0.44, 0.012, 0.30, 0, 0.796, 0.02);
  ring(g, smooth(IRON_LIGHT), 0.065, 0.012, -0.02, 0.812, 0.02, [Math.PI / 2, 0, 0]);
  cyl(g, glass(0xd6e4ea), 0.062, 0.062, 0.006, 14, -0.02, 0.812, 0.02, [Math.PI / 2, 0, 0]);
  box(g, smooth(IRON_LIGHT), 0.11, 0.012, 0.02, 0.11, 0.810, 0.02);

  const gemColors = [0xd94f70, 0x4fd9a0, 0x4f8fd9, 0xd9c94f];
  for (let i = 0; i < 4; i++) {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(range(rng, 0.022, 0.03), 0),
      smooth(gemColors[i], { roughness: 0.15 })
    );
    gem.position.set(-0.17 + i * 0.055, 0.822, -0.07 + (i % 2) * 0.05);
    g.add(gem);
  }
  box(g, steel, 0.18, 0.01, 0.014, 0.24, 0.795, 0.14, [0, 0.35, 0]);
  cyl(g, steel, 0.007, 0.007, 0.16, 4, -0.30, 0.798, 0.16, [0, 0, Math.PI / 2]);

  return finish(g);
}

// =============================================================================
// 7. Alchemy Cabinet — drawers of reagents, copper still, mortar and pestle
// =============================================================================
export function generateWorkstationAlchemy(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = mat(pick(rng, WOOD_DARK));
  const woodMid = mat(pick(rng, WOOD_MID));
  const iron = smooth(IRON);
  const stoneM = mat(pick(rng, STONE));
  const brass = smooth(BRASS);

  // --- Lower cabinet on an iron frame. ---
  for (const [x, z] of [[-0.44, -0.26], [0.44, -0.26], [-0.44, 0.26], [0.44, 0.26]]) {
    box(g, iron, 0.09, 0.10, 0.09, x, 0.05, z);
    box(g, iron, 0.06, 0.62, 0.06, x + Math.sign(x) * 0.03, 0.41, z + Math.sign(z) * 0.03);
  }
  box(g, wood, 0.94, 0.60, 0.56, 0, 0.40, 0);
  for (const sx of [-1, 1]) {
    box(g, iron, 0.03, 0.62, 0.05, sx * 0.475, 0.41, 0, [0.72, 0, 0]);
    box(g, iron, 0.03, 0.62, 0.05, sx * 0.475, 0.41, 0, [-0.72, 0, 0]);
  }

  // Four drawers; two pulled open showing the reagents inside.
  const drawerCells = [[-0.23, 0.55], [0.23, 0.55], [-0.23, 0.28], [0.23, 0.28]];
  const open = [2, 1];
  const powders = [0xb24d3f, 0x6da350];
  drawerCells.forEach(([dx, dy], i) => {
    const openIdx = open.indexOf(i);
    if (openIdx >= 0) {
      box(g, woodMid, 0.42, 0.20, 0.26, dx, dy, 0.40);
      box(g, mat(powders[openIdx]), 0.36, 0.05, 0.21, dx, dy + 0.085, 0.40);
      box(g, brass, 0.16, 0.025, 0.02, dx, dy - 0.02, 0.535);
    } else {
      box(g, woodMid, 0.42, 0.24, 0.03, dx, dy, 0.29);
      box(g, brass, 0.16, 0.025, 0.02, dx, dy - 0.02, 0.315);
    }
  });

  // --- Stone worktop. ---
  box(g, stoneM, 1.08, 0.03, 0.70, 0, 0.715, 0);
  box(g, stoneM, 1.04, 0.07, 0.66, 0, 0.735, 0);

  // --- Upper shelf unit. ---
  box(g, wood, 0.90, 0.70, 0.03, 0, 1.14, -0.17);
  box(g, wood, 0.04, 0.70, 0.32, -0.43, 1.14, -0.02);
  box(g, wood, 0.04, 0.70, 0.32, 0.43, 1.14, -0.02);
  box(g, wood, 0.90, 0.03, 0.34, 0, 0.80, -0.02);
  box(g, woodMid, 0.94, 0.04, 0.36, 0, 1.50, -0.02);
  box(g, wood, 0.035, 0.70, 0.32, -0.02, 1.14, -0.02);
  box(g, woodMid, 0.40, 0.03, 0.30, -0.23, 1.20, -0.02);

  // Apothecary jars on the left shelf.
  const jarFills = [0x6da350, 0xc25a5f, 0x5d92bf];
  for (let i = 0; i < 3; i++) {
    const jx = -0.36 + i * 0.13;
    cyl(g, glass(0xd6e4ea), 0.048, 0.048, 0.13, 10, jx, 1.285, -0.02);
    cyl(g, mat(jarFills[i]), 0.042, 0.042, 0.06, 10, jx, 1.255, -0.02);
    cyl(g, mat(0xc4a577), 0.035, 0.042, 0.025, 8, jx, 1.362, -0.02);
  }

  // Small reagent drawers on the right.
  for (let i = 0; i < 2; i++) {
    box(g, woodMid, 0.30, 0.11, 0.035, 0.26, 0.88 + i * 0.13, 0.145);
    box(g, brass, 0.12, 0.02, 0.02, 0.26, 0.865 + i * 0.13, 0.168);
  }

  // The still's copper condensing coil — a real helix, the piece that makes
  // this read as alchemy rather than as a bookshelf.
  const coilPts = [];
  const turns = 4;
  for (let i = 0; i <= 56; i++) {
    const t = i / 56;
    const a = t * Math.PI * 2 * turns;
    coilPts.push(new THREE.Vector3(0.26 + Math.cos(a) * 0.072, 1.10 + t * 0.30, -0.02 + Math.sin(a) * 0.072));
  }
  const coil = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 60, 0.014, 5, false),
    smooth(COPPER, { roughness: 0.35 })
  );
  g.add(coil);
  cyl(g, smooth(COPPER), 0.014, 0.014, 0.14, 6, 0.20, 1.44, -0.02, [0, 0, 0.9]);

  // --- Iron strapping and the arched crest over the top. ---
  box(g, iron, 0.035, 0.76, 0.05, -0.465, 1.16, 0.02);
  box(g, iron, 0.035, 0.76, 0.05, 0.465, 1.16, 0.02);
  const arch = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.028, 5, 20, Math.PI), iron);
  arch.position.set(0, 1.52, -0.02);
  arch.scale.y = 0.30;
  g.add(arch);

  // --- Glassware on the top shelf. ---
  const retort = new THREE.Mesh(new THREE.SphereGeometry(0.082, 10, 8), glass(0xd6e4ea));
  retort.position.set(-0.28, 1.63, -0.02);
  g.add(retort);
  const retortFill = new THREE.Mesh(new THREE.SphereGeometry(0.066, 10, 8), mat(0x4fd98a));
  retortFill.position.set(-0.28, 1.615, -0.02);
  g.add(retortFill);
  cyl(g, glass(0xd6e4ea), 0.02, 0.028, 0.22, 8, -0.41, 1.70, -0.02, [0, 0, 0.95]);

  cyl(g, glass(0xd6e4ea), 0.052, 0.068, 0.13, 10, -0.02, 1.615, -0.02);
  cyl(g, mat(0xc2481f), 0.046, 0.060, 0.06, 10, -0.02, 1.585, -0.02);
  cyl(g, mat(0xc4a577), 0.035, 0.042, 0.03, 8, -0.02, 1.695, -0.02);
  cyl(g, glass(0xc8d8ea), 0.026, 0.072, 0.17, 10, 0.25, 1.635, -0.02);
  cyl(g, glass(0xc8d8ea), 0.022, 0.022, 0.07, 8, 0.25, 1.745, -0.02);

  // --- Working glassware on the stone top. ---
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    cyl(g, iron, 0.008, 0.008, 0.09, 4, -0.30 + Math.cos(a) * 0.07, 0.815, Math.sin(a) * 0.07);
  }
  ring(g, iron, 0.085, 0.011, -0.30, 0.862, 0, [Math.PI / 2, 0, 0]);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.112, 12, 9), glass(0xd6e4ea));
  bulb.position.set(-0.30, 0.945, 0);
  g.add(bulb);
  const bulbFill = new THREE.Mesh(new THREE.SphereGeometry(0.092, 12, 9), mat(0x4fd98a));
  bulbFill.position.set(-0.30, 0.928, 0);
  g.add(bulbFill);
  cyl(g, glass(0xd6e4ea), 0.028, 0.042, 0.11, 8, -0.30, 1.09, 0);

  cyl(g, glass(0xd6e4ea), 0.028, 0.10, 0.22, 10, -0.01, 0.885, 0.06);
  cyl(g, mat(0xd94f9c), 0.03, 0.082, 0.12, 10, -0.01, 0.835, 0.06);
  cyl(g, glass(0xd6e4ea), 0.024, 0.024, 0.09, 8, -0.01, 1.03, 0.06);

  cyl(g, stoneM, 0.105, 0.072, 0.11, 12, 0.30, 0.825, 0.06);
  cyl(g, mat(0x74747c), 0.085, 0.085, 0.012, 12, 0.30, 0.882, 0.06);
  cyl(g, stoneM, 0.02, 0.032, 0.16, 8, 0.37, 0.90, 0.06, [0, 0, 0.75]);

  return finish(g);
}

// =============================================================================
// 8. Cooking Hearth — iron stove, grill, firebox, spit roast, hanging cauldron
// =============================================================================
export function generateWorkstationHearth(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const stoneM = mat(pick(rng, STONE));
  const iron = smooth(IRON);
  const ironLight = smooth(IRON_LIGHT);

  box(g, stoneM, 1.36, 0.10, 0.76, 0, 0.05, 0);
  box(g, mat(0x7d7d88), 1.26, 0.52, 0.68, 0, 0.36, 0);
  box(g, stoneM, 1.34, 0.08, 0.74, 0, 0.66, 0);

  // Grill: a recess with bars over it, on the left half of the top.
  box(g, mat(0x3a3a42), 0.50, 0.02, 0.50, -0.34, 0.697, 0);
  for (let i = 0; i < 7; i++) {
    box(g, ironLight, 0.50, 0.022, 0.03, -0.34, 0.715, -0.21 + i * 0.07);
  }
  box(g, iron, 0.56, 0.04, 0.03, -0.34, 0.72, -0.255);
  box(g, iron, 0.56, 0.04, 0.03, -0.34, 0.72, 0.255);
  box(g, iron, 0.03, 0.04, 0.54, -0.615, 0.72, 0);
  box(g, iron, 0.03, 0.04, 0.54, -0.065, 0.72, 0);

  // Flat plate on the right, with a pot and a knife left on it.
  box(g, ironLight, 0.52, 0.025, 0.60, 0.36, 0.713, 0);
  cyl(g, iron, 0.085, 0.072, 0.13, 10, 0.46, 0.79, -0.10);
  cyl(g, iron, 0.088, 0.088, 0.02, 10, 0.46, 0.865, -0.10);
  const potKnob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 5), iron);
  potKnob.position.set(0.46, 0.885, -0.10);
  g.add(potKnob);
  box(g, smooth(0xd2d5da), 0.19, 0.01, 0.035, 0.28, 0.731, 0.16, [0, 0.18, 0]);
  box(g, mat(pick(rng, WOOD_DARK)), 0.08, 0.022, 0.028, 0.41, 0.733, 0.18, [0, 0.18, 0]);

  // Firebox doors, vented, with the fire showing through.
  for (const dx of [-0.30, 0.30]) {
    box(g, iron, 0.36, 0.28, 0.035, dx, 0.44, 0.345);
    box(g, mat(0xc2481f, { emissive: 0xc2481f, emissiveIntensity: 0.55 }), 0.28, 0.20, 0.02, dx, 0.44, 0.33);
    for (let i = 0; i < 4; i++) {
      box(g, iron, 0.30, 0.032, 0.022, dx, 0.36 + i * 0.055, 0.362);
    }
    ring(g, ironLight, 0.03, 0.009, dx + 0.14, 0.44, 0.375);
  }

  // Log store below, cut into the base.
  for (const sx of [-1, 1]) {
    box(g, mat(0x3a3a42), 0.38, 0.16, 0.04, sx * 0.30, 0.18, 0.335);
    for (let i = 0; i < 3; i++) {
      const lx = sx * 0.30 - 0.11 + i * 0.11;
      barZ(g, mat(pick(rng, WOOD_WARM)), 0.052, 0.26, lx, 0.155 + (i % 2) * 0.055, 0.30);
      cyl(g, mat(0xdcc3a2), 0.052, 0.052, 0.012, 8, lx, 0.155 + (i % 2) * 0.055, 0.43, [Math.PI / 2, 0, 0]);
    }
  }

  // Spit frame over the top.
  for (const sx of [-1, 1]) {
    box(g, iron, 0.055, 0.86, 0.055, sx * 0.60, 1.13, 0);
    box(g, iron, 0.05, 0.10, 0.05, sx * 0.60, 1.58, 0);
  }
  barX(g, ironLight, 0.02, 1.34, 0, 1.50, 0);
  cyl(g, mat(0xb07a45), 0.125, 0.125, 0.34, 10, 0.26, 1.50, 0, [0, 0, Math.PI / 2]);
  const roastEnd = new THREE.SphereGeometry(0.118, 10, 8);
  for (const ex of [0.10, 0.42]) {
    const cap = new THREE.Mesh(roastEnd, mat(0xb07a45));
    cap.position.set(ex, 1.50, 0);
    g.add(cap);
  }
  barX(g, ironLight, 0.018, 0.14, 0.68, 1.50, 0);
  box(g, ironLight, 0.028, 0.028, 0.11, 0.72, 1.50, 0.055);

  // Cauldron hanging off the left of the spit.
  cyl(g, ironLight, 0.012, 0.012, 0.22, 5, -0.32, 1.38, 0);
  ring(g, ironLight, 0.032, 0.009, -0.32, 1.475, 0);
  const pot = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 9), iron);
  pot.position.set(-0.32, 1.10, 0);
  pot.scale.y = 0.78;
  g.add(pot);
  ring(g, iron, 0.155, 0.022, -0.32, 1.215, 0, [Math.PI / 2, 0, 0]);
  ring(g, ironLight, 0.17, 0.012, -0.32, 1.215, 0, null, Math.PI);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    cyl(g, iron, 0.018, 0.014, 0.06, 5, -0.32 + Math.cos(a) * 0.08, 0.97, Math.sin(a) * 0.08);
  }

  return finish(g);
}
