// src/generators/environment/flora.js
// The expanded plant library: extra tree silhouettes plus the small ground
// plants (ferns, reeds, mushrooms, flower clusters) that make a forest floor
// read as alive rather than as bare terrain with tree trunks on it.
//
// Every builder here takes a seed and returns a THREE.Group standing on y=0,
// so the placement code can drop it straight onto the terrain. Same seeded-RNG
// contract as tree.js/rock.js: seed 1001 always produces the same plant.
//
// Trunk radius for the tree variants comes from sampleTree (src/sim/propMetrics.js)
// so the server can derive their collision radius without loading Three — the
// same "what you see is what you collide with" rule the original tree follows.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { sampleTree } from '../../sim/propMetrics.js';
import { jitterSharedVertices } from './jitter.js';
import { makeKit } from './meshKit.js';
import { generateGrassPatch } from './grass.js';
import { generateRock } from './rock.js';

const LEAF_GREENS = [0x2f6b2f, 0x3f7a3f, 0x2a5c2a, 0x4a7a2f, 0x53883b];
const AUTUMN = [0xc4732a, 0xb8582a, 0xd9a12a];

function standardMat(color, flat = true) {
  return new THREE.MeshStandardMaterial({ color, flatShading: flat, roughness: 0.9 });
}

const finish = (g) => {
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
};

// --- Trees -------------------------------------------------------------------

/** Bare, forked, slightly sinister — the stumps-and-snags look of screenshot 3. */
export function generateDeadTree(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();

  const h = d.trunkHeight * 1.5;
  const mat = standardMat(pick(rng, [0x4a3c30, 0x3a2f26, 0x554537]));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(d.trunkRadius * 0.5, d.trunkRadius, h, 5), mat);
  trunk.position.y = h / 2;
  g.add(trunk);

  // Branches: cones angled outward and up from the upper trunk.
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const len = range(rng, 0.7, 1.5);
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.07, len, 4), mat);
    const yaw = range(rng, 0, Math.PI * 2);
    const tilt = range(rng, 0.5, 1.1);
    const y = range(rng, h * 0.5, h * 0.95);
    branch.position.set(0, y, 0);
    branch.rotation.set(0, yaw, tilt);
    branch.translateY(len / 2);
    g.add(branch);
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** Drooping canopy: strands hanging from a wide crown. */
export function generateWillow(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'round' });
  const g = new THREE.Group();

  const h = d.trunkHeight * 1.2;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(d.trunkRadius * 0.8, d.trunkRadius * 1.3, h, 6),
    standardMat(0x5a4632)
  );
  trunk.position.y = h / 2;
  g.add(trunk);

  const leafMat = standardMat(pick(rng, [0x6f9a4a, 0x7fae55]));
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), leafMat);
  crown.position.y = h + 0.4;
  crown.scale.y = 0.6;
  g.add(crown);

  // Hanging strands: thin tapered cones dropping from the crown's rim.
  for (let i = 0; i < rangeInt(rng, 8, 14); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const rad = range(rng, 0.8, 1.5);
    const len = range(rng, 0.8, 1.9);
    const strand = new THREE.Mesh(new THREE.ConeGeometry(0.09, len, 4), leafMat);
    strand.position.set(Math.cos(a) * rad, h + 0.35 - len / 2, Math.sin(a) * rad);
    strand.rotation.x = Math.PI; // taper downward
    g.add(strand);
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** A low leafy mound. Blocks movement (see propTypes) but you can see over it. */
export function generateBush(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const mat = standardMat(chance(rng, 0.15) ? pick(rng, AUTUMN) : pick(rng, LEAF_GREENS));
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const r = range(rng, 0.28, 0.5);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    blob.position.set(range(rng, -0.3, 0.3), r * 0.8 + range(rng, -0.05, 0.15), range(rng, -0.3, 0.3));
    g.add(blob);
  }
  return finish(g);
}

// --- Biome trees ---------------------------------------------------------
// Same seed/sampleTree contract as the trees above, but every one of these
// builds a fully custom canopy and ignores sampleTree's tiers/clumps (except
// generatePineSnow, which reuses the conifer tiers directly). They all force
// `{ type: 'conifer' }` so propTypes.js's treeSilhouette() can report the
// exact same type back to the collision builder — see that file's comment.

/** Leaning segmented trunk, a starburst of drooping fronds. */
export function generatePalm(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();
  const h = d.trunkHeight * 1.3;
  const r = d.trunkRadius * 0.6;
  const trunkMat = standardMat(pick(rng, [0x9a7a4a, 0x8a6a3f, 0xa88555]));
  const segments = rangeInt(rng, 5, 7);
  let y = 0;
  for (let i = 0; i < segments; i++) {
    const segH = h / segments;
    const segR = r * (1 - i * 0.06);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(segR * 0.92, segR, segH, 6), trunkMat);
    seg.position.y = y + segH / 2;
    g.add(seg);
    y += segH;
  }
  g.rotation.z = range(rng, -0.12, 0.12); // natural lean
  const frondMat = standardMat(pick(rng, [0x4a8a3a, 0x5a9a4a, 0x3f7a35]));
  const frondCount = rangeInt(rng, 6, 9);
  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + range(rng, -0.15, 0.15);
    const len = range(rng, 1.0, 1.6);
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.1, len, 3), frondMat);
    frond.position.set(0, y, 0);
    frond.rotation.set(Math.cos(a) * 1.15, -a, Math.sin(a) * -1.15);
    frond.translateY(len / 2);
    g.add(frond);
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** Thick fluted trunk, zero to three bent arms — the classic desert landmark cactus. */
export function generateCactusSaguaro(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();
  const h = d.trunkHeight * 1.1;
  const r = d.trunkRadius * 1.3;
  const mat = standardMat(pick(rng, [0x3f7a3f, 0x4a8a4a, 0x357035]));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, h, 8), mat);
  trunk.position.y = h / 2;
  g.add(trunk);
  const armCount = rangeInt(rng, 0, 3);
  for (let i = 0; i < armCount; i++) {
    const armY = range(rng, h * 0.4, h * 0.75);
    const side = chance(rng, 0.5) ? 1 : -1;
    const outLen = range(rng, 0.5, 1.0);
    const upLen = range(rng, 0.5, 0.9);
    const elbow = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.6, outLen, 6), mat);
    elbow.position.set(side * (r + outLen * 0.4), armY, 0);
    elbow.rotation.z = (side * Math.PI) / 2.4;
    g.add(elbow);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r * 0.55, upLen, 6), mat);
    up.position.set(side * (r + outLen * 0.75), armY + upLen * 0.45, 0);
    g.add(up);
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** Narrow buttressed trunk, a tapered crown, hanging moss strands — a swamp/bayou tree. */
export function generateCypress(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();
  const h = d.trunkHeight * 1.6;
  const trunkMat = standardMat(pick(rng, [0x5a4a3a, 0x4a3d30]));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(d.trunkRadius * 0.55, d.trunkRadius * 1.4, h, 7), trunkMat);
  trunk.position.y = h / 2;
  g.add(trunk);
  // Buttressed base flare — the mangrove/cypress-knee root look.
  const flare = new THREE.Mesh(new THREE.ConeGeometry(d.trunkRadius * 2.0, h * 0.12, 7), trunkMat);
  flare.position.y = h * 0.06;
  g.add(flare);
  const leafMat = standardMat(pick(rng, [0x4a5c3a, 0x556b40]));
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.9, h * 0.5, 7), leafMat);
  crown.position.y = h + h * 0.2;
  g.add(crown);
  const mossMat = standardMat(0x6a7a5a);
  for (let i = 0; i < rangeInt(rng, 5, 9); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const rad = range(rng, 0.4, 0.85);
    const len = range(rng, 0.5, 1.2);
    const strand = new THREE.Mesh(new THREE.ConeGeometry(0.03, len, 3), mossMat);
    strand.position.set(Math.cos(a) * rad, h * 0.75 - len / 2, Math.sin(a) * rad);
    strand.rotation.x = Math.PI; // taper downward
    g.add(strand);
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** A real conifer canopy (reuses sampleTree's tiers) with a flattened snow cap on each tier. */
export function generatePineSnow(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();
  const trunkMat = standardMat(pick(rng, [0x4a3a2a, 0x3a2f22]));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(d.trunkRadius * 0.7, d.trunkRadius, d.trunkHeight, 6), trunkMat);
  trunk.position.y = d.trunkHeight / 2;
  g.add(trunk);
  const leafMat = standardMat(pick(rng, [0x2f5c4a, 0x365e4f, 0x2a5445]));
  const snowMat = standardMat(0xe8f0f5);
  let y = d.trunkHeight * 0.5;
  for (const tier of d.tiers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.radius, tier.h, 8), leafMat);
    cone.position.y = y + tier.h / 2;
    g.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(tier.radius * 0.45, tier.h * 0.22, 8), snowMat);
    cap.position.y = y + tier.h - tier.h * 0.06;
    g.add(cap);
    y += tier.h * 0.6;
  }
  g.scale.setScalar(d.scale);
  return finish(g);
}

/** Squat, wind-leaning conifer — a hardy tree for thin mountain soil. */
export function generateAlpineConifer(seed) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'conifer' });
  const g = new THREE.Group();
  const h = d.trunkHeight * 0.75;
  const trunkMat = standardMat(pick(rng, [0x5a4632, 0x4a3a28]));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(d.trunkRadius * 0.8, d.trunkRadius * 1.1, h, 6), trunkMat);
  trunk.position.y = h / 2;
  g.add(trunk);
  const leafMat = standardMat(pick(rng, [0x3a5c3a, 0x2f4f30]));
  let y = h * 0.35;
  const tierCount = rangeInt(rng, 2, 3);
  let radius = range(rng, 0.9, 1.3);
  for (let i = 0; i < tierCount; i++) {
    const th = range(rng, 0.7, 1.1);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, th, 7), leafMat);
    cone.position.y = y + th / 2;
    g.add(cone);
    y += th * 0.55;
    radius *= 0.72;
  }
  g.rotation.z = range(rng, -0.12, 0.12); // wind lean
  g.scale.setScalar(d.scale);
  return finish(g);
}

// --- Small plants ------------------------------------------------------------

/** Arching fronds from a central point. */
export function generateFern(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const mat = standardMat(pick(rng, [0x357a35, 0x2f6b2f, 0x468a3f]));
  const fronds = rangeInt(rng, 5, 8);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + range(rng, -0.2, 0.2);
    const len = range(rng, 0.4, 0.75);
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.07, len, 3), mat);
    frond.position.set(Math.cos(a) * len * 0.28, len * 0.4, Math.sin(a) * len * 0.28);
    frond.rotation.set(Math.cos(a) * 0.75, -a, Math.sin(a) * -0.75);
    g.add(frond);
  }
  return finish(g);
}

/** Tall thin stalks with seed heads — waterside filler. */
export function generateReeds(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const stalkMat = standardMat(pick(rng, [0x6f8a3a, 0x5f7a32]));
  const headMat = standardMat(0x6a4a2a);
  for (let i = 0; i < rangeInt(rng, 5, 9); i++) {
    const h = range(rng, 0.7, 1.4);
    const x = range(rng, -0.22, 0.22);
    const z = range(rng, -0.22, 0.22);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, h, 3), stalkMat);
    stalk.position.set(x, h / 2, z);
    stalk.rotation.z = range(rng, -0.12, 0.12);
    g.add(stalk);
    if (chance(rng, 0.6)) {
      const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.14, 3, 5), headMat);
      head.position.set(x, h + 0.06, z);
      g.add(head);
    }
  }
  return finish(g);
}

/** One toadstool: stalk + cap, optional spots. */
export function generateMushroom(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const capColor = pick(rng, [0xc0403a, 0xd9752a, 0x8a5a9a, 0xd8d0b8]);
  const h = range(rng, 0.12, 0.3);
  const capR = range(rng, 0.1, 0.2);

  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(capR * 0.28, capR * 0.36, h, 5), standardMat(0xe8e0cc));
  stalk.position.y = h / 2;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(capR, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), standardMat(capColor));
  cap.position.y = h;
  cap.scale.y = range(rng, 0.6, 1.0);
  g.add(stalk, cap);

  for (let i = 0; i < rangeInt(rng, 0, 4); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const d = range(rng, 0, capR * 0.6);
    const spot = new THREE.Mesh(new THREE.SphereGeometry(capR * 0.11, 5, 4), standardMat(0xf2efe6));
    spot.position.set(Math.cos(a) * d, h + capR * 0.42 * cap.scale.y, Math.sin(a) * d);
    g.add(spot);
  }
  return finish(g);
}

/** A few mushrooms of mixed size around one point. */
export function generateMushroomCluster(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const m = generateMushroom(seed + i * 977);
    m.position.set(range(rng, -0.3, 0.3), 0, range(rng, -0.3, 0.3));
    m.scale.setScalar(range(rng, 0.7, 1.3));
    g.add(m);
  }
  return g;
}

/** Low white daisies over a patch — the ground cover in the blossom screenshot. */
export function generateDaisies(seed) {
  return flowerPatch(seed, { petal: 0xf5f2e8, center: 0xe8c53a, height: [0.1, 0.2], count: [5, 10] });
}

/** Nodding blue bell-flowers on taller stems. */
export function generateBluebells(seed) {
  const rng = createRng(seed);
  const k = makeKit(); // one mesh per material — same reasoning as flowerPatch below
  const bellColor = pick(rng, [0x5a6ad0, 0x6a5ad0, 0x4a7ad8]);
  for (let i = 0; i < rangeInt(rng, 3, 7); i++) {
    const h = range(rng, 0.2, 0.4);
    const x = range(rng, -0.18, 0.18);
    const z = range(rng, -0.18, 0.18);
    k.cyl('stem', 0.008, 0.012, h, 3, x, h / 2, z);
    k.cone('bell', 0.05, 0.09, 5, x, h, z, [Math.PI, 0, 0]); // bell opens downward
  }
  return k.finish({ stem: standardMat(0x3f7a3a), bell: standardMat(bellColor) });
}

/** A hardy desert bloom — hot magenta/orange over a short stem. */
export function generateDesertFlower(seed) {
  return flowerPatch(seed, { petal: 0xd9527a, center: 0xf2c93a, height: [0.12, 0.22], count: [3, 6] });
}

/** A pale marsh/bog flower. */
export function generateSwampFlower(seed) {
  return flowerPatch(seed, { petal: 0xd8d8e0, center: 0x9a6ac9, height: [0.14, 0.26], count: [3, 6] });
}

/** A small white cold-climate flower. */
export function generateSnowdrop(seed) {
  return flowerPatch(seed, { petal: 0xf5f8fa, center: 0x9ad8e0, height: [0.08, 0.16], count: [4, 8] });
}

/** A hardy, low alpine bloom. */
export function generateAlpineFlower(seed) {
  return flowerPatch(seed, { petal: 0xc9a8e0, center: 0xf2e6a8, height: [0.07, 0.14], count: [3, 5] });
}

/**
 * Shared builder behind the flower-patch variants.
 *
 * Built through makeKit (one merged mesh per material) rather than as loose
 * child meshes, which is what it used to be. A patch is up to 10 flowers of
 * 7 parts each, so the obvious way cost up to 56 DRAW CALLS for ~800
 * triangles of knee-high decoration — measured, `flower-daisy` alone was
 * 4,480 of asteria's ~14,900 prop draw calls, more than the entire rest of
 * the map's scenery put together. Merged it's 3 calls, identical geometry.
 *
 * The rng call order is deliberately unchanged, so every already-placed
 * patch in world.json keeps the exact layout it had before.
 */
function flowerPatch(seed, { petal, center, height, count }) {
  const rng = createRng(seed);
  const k = makeKit();
  const n = rangeInt(rng, count[0], count[1]);
  for (let i = 0; i < n; i++) {
    const h = range(rng, height[0], height[1]);
    const x = range(rng, -0.28, 0.28);
    const z = range(rng, -0.28, 0.28);
    k.cyl('stem', 0.008, 0.01, h, 3, x, h / 2, z);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      k.box('petal', 0.055, 0.012, 0.028, x + Math.cos(a) * 0.035, h, z + Math.sin(a) * 0.035, [0, -a, 0]);
    }
    // raw() rather than kit.sphere(): the kit's sphere is a 10x7 segment ball
    // (140 tris), this one is 5x4 (40). At up to 10 per patch and hundreds of
    // patches per map that difference is real, and nobody can see it on a
    // 2cm flower eye.
    k.raw('center', new THREE.SphereGeometry(0.022, 5, 4), x, h + 0.005, z);
  }
  return k.finish({
    stem: standardMat(0x3f7a3a),
    petal: standardMat(petal),
    center: standardMat(center),
  });
}

// --- Decor -------------------------------------------------------------------

/** A cut stump with visible rings. */
export function generateStump(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const r = range(rng, 0.28, 0.45);
  const h = range(rng, 0.25, 0.5);
  const bark = standardMat(pick(rng, [0x4a3320, 0x5a3d2b]));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, h, 7), bark);
  body.position.y = h / 2;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r * 0.86, 0.03, 7), standardMat(0xa07d52));
  top.position.y = h + 0.01;
  g.add(body, top);
  // A couple of roots flaring at the base.
  for (let i = 0; i < rangeInt(rng, 2, 4); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 4), bark);
    root.position.set(Math.cos(a) * r * 0.8, 0.06, Math.sin(a) * r * 0.8);
    root.rotation.set(Math.PI / 2.2, 0, -a);
    g.add(root);
  }
  return finish(g);
}

/** A fallen log lying on its side. */
export function generateLog(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const r = range(rng, 0.2, 0.32);
  const len = range(rng, 1.2, 2.4);
  const bark = standardMat(pick(rng, [0x4a3320, 0x5a4230]));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, len, 7), bark);
  body.rotation.z = Math.PI / 2;
  body.position.y = r;
  g.add(body);
  const endCap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.03, 7), standardMat(0xa07d52));
  endCap.rotation.z = Math.PI / 2;
  endCap.position.set(len / 2, r, 0);
  g.add(endCap);
  if (chance(rng, 0.5)) {
    const moss = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 6, 4), standardMat(0x4a7a3a));
    moss.position.set(range(rng, -len / 3, len / 3), r * 1.5, 0);
    moss.scale.y = 0.4;
    g.add(moss);
  }
  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** A stick on the ground. Pure decoration. */
export function generateBranch(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const mat = standardMat(0x4a3a2a);
  const len = range(rng, 0.4, 0.9);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, len, 4), mat);
  stick.rotation.z = Math.PI / 2;
  stick.position.y = 0.03;
  g.add(stick);
  if (chance(rng, 0.6)) {
    const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, len * 0.45, 4), mat);
    twig.rotation.set(0, range(rng, 0, Math.PI), Math.PI / 2.6);
    twig.position.set(range(rng, -0.15, 0.15), 0.05, 0.05);
    g.add(twig);
  }
  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

// --- Runestone (reference-image ask, 2026-07-25) ------------------------------
// A tall moss/ivy-covered standing stone with a carved glowing rune on its
// front face, ringed by grass and a couple of loose rocks at its foot.
const RUNESTONE_COLORS = [0x6b6a60, 0x74736a, 0x605f56];
const RUNE_INK = '#d9bd82';

/** Canvas-drawn rune glyph: concentric rings, radial ticks, and the arcing
 * squiggle above them, matching the reference carving. Alpha channel only
 * where ink is drawn, so the plaque mesh shows bare stone everywhere else. */
function buildRuneTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2;
  const cy = size / 2;
  ctx.strokeStyle = RUNE_INK;
  ctx.lineCap = 'round';
  [0.16, 0.24, 0.34].forEach((f, i) => {
    ctx.lineWidth = i === 1 ? 5 : 3;
    ctx.beginPath();
    ctx.arc(cx, cy, size * f, 0, Math.PI * 2);
    ctx.stroke();
  });
  const tickCount = 8;
  for (let i = 0; i < tickCount; i++) {
    const a = (i / tickCount) * Math.PI * 2;
    const r0 = size * 0.24;
    const r1 = size * 0.29;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.22, cy - size * 0.34);
  ctx.quadraticCurveTo(cx - size * 0.05, cy - size * 0.46, cx + size * 0.12, cy - size * 0.32);
  ctx.quadraticCurveTo(cx + size * 0.22, cy - size * 0.24, cx + size * 0.16, cy - size * 0.14);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A single leaf clump — a squashed, jittered icosahedron — used by both the
 * climbing ivy and the moss patches stuck to the stone's surface. */
function leafClump(rng, radius, mat) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  jitterSharedVertices(geo, rng, (r) => {
    const j = range(r, 0.75, 1.2);
    return { x: j, y: j * range(r, 0.55, 0.8), z: j };
  });
  return new THREE.Mesh(geo, mat);
}

/** Tall standing stone, moss- and ivy-covered, with a carved glowing rune. */
export function generateRunestone(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();

  const baseR = range(rng, 0.5, 0.58);
  const topR = baseR * range(rng, 0.32, 0.42);
  const height = range(rng, 1.5, 1.75);
  const stoneMat = new THREE.MeshStandardMaterial({
    color: pick(rng, RUNESTONE_COLORS),
    flatShading: true,
    roughness: 1,
  });

  // Tapered, jittered monolith — a frustum roughed up so it reads as hewn
  // rock rather than a smooth cone. Indexed geometry, so shared corners (incl.
  // the cylinder's UV seam) must be jittered via position, not per-vertex-index,
  // or the seam visibly cracks open (see jitter.js).
  const bodyGeo = new THREE.CylinderGeometry(topR, baseR, height, 8, 3);
  jitterSharedVertices(bodyGeo, rng, (r) => {
    const j = range(r, 0.9, 1.12);
    return { x: j, y: range(r, 0.97, 1.03), z: j };
  });
  const body = new THREE.Mesh(bodyGeo, stoneMat);
  body.position.y = height / 2;
  body.rotation.y = range(rng, 0, Math.PI * 2);
  g.add(body);

  // Rounded cap so the peak reads blunt, not a sharp cone point.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(topR * 1.05, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2.2), stoneMat);
  cap.position.y = height;
  g.add(cap);

  // Carved rune plaque, flush against the front face, tinted to glow faintly.
  const runeMat = new THREE.MeshStandardMaterial({
    map: buildRuneTexture(),
    transparent: true,
    color: RUNE_INK,
    emissive: 0x6a5628,
    emissiveIntensity: 0.35,
    roughness: 0.6,
    depthWrite: false,
  });
  const runeSize = Math.min(baseR, topR + (baseR - topR) * 0.4) * 1.5;
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(runeSize, runeSize), runeMat);
  rune.position.set(0, height * 0.42, baseR * 0.94);
  g.add(rune);

  // Moss patches stuck to the stone's surface.
  const mossMat = new THREE.MeshStandardMaterial({ color: pick(rng, [0x4a7a3a, 0x3f6a34]), flatShading: true, roughness: 0.95 });
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const h = range(rng, 0.05, height * 0.7);
    const t = h / height;
    const r = topR + (baseR - topR) * (1 - t);
    const patch = leafClump(rng, range(rng, 0.1, 0.2), mossMat);
    patch.position.set(Math.cos(a) * r * 0.95, h, Math.sin(a) * r * 0.95);
    g.add(patch);
  }

  // Climbing ivy up one side: a tube along a wandering curve, plus leaf
  // clumps beaded along it.
  const ivyMat = new THREE.MeshStandardMaterial({ color: 0x3a5a2a, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({ color: pick(rng, [0x3f7a3f, 0x4a8a45, 0x2f6b2f]), flatShading: true, roughness: 0.9 });
  const vineSide = range(rng, 0, Math.PI * 2);
  const points = [];
  const vineTopFrac = range(rng, 0.75, 0.95);
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * vineTopFrac;
    const h = t * height;
    const r = (topR + (baseR - topR) * (1 - t)) * 1.02;
    const wobble = vineSide + Math.sin(t * 5 + seed) * 0.4;
    points.push(new THREE.Vector3(Math.cos(wobble) * r, h, Math.sin(wobble) * r));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const vine = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.025, 5, false), ivyMat);
  g.add(vine);
  for (let i = 0; i < rangeInt(rng, 6, 10); i++) {
    const t = range(rng, 0.1, 1);
    const p = curve.getPointAt(Math.min(t, 1));
    const leaf = leafClump(rng, range(rng, 0.06, 0.12), leafMat);
    leaf.position.copy(p).add(new THREE.Vector3(range(rng, -0.06, 0.06), range(rng, -0.03, 0.05), range(rng, -0.06, 0.06)));
    g.add(leaf);
  }

  // Grass and loose rocks around the foot. Kept tight to the stone's own
  // footprint (not the wide sprawl a freestanding patch would use) — this is
  // a fixed-radius collider prop, so the decoration can't reach further out
  // than the collider actually covers.
  const grassA = generateGrassPatch(seed + 401, { bladeCount: rangeInt(rng, 16, 24), radius: baseR * 0.85 });
  g.add(grassA);
  for (let i = 0; i < rangeInt(rng, 2, 4); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const dist = baseR * range(rng, 0.65, 0.85);
    const rock = generateRock(seed + 900 + i * 37);
    rock.scale.setScalar(range(rng, 0.18, 0.3));
    rock.position.set(Math.cos(a) * dist, rock.position.y, Math.sin(a) * dist);
    // generateRock's own y-offset only half-compensates for its geometry
    // (rocks are deliberately half-buried, propTypes' `buried` — fine for a
    // standalone rock prop, but this whole group isn't marked buried, so a
    // tiny accent pebble here needs to actually rest ON y=0, not sink into it).
    rock.updateMatrixWorld(true);
    const rockBox = new THREE.Box3().setFromObject(rock);
    rock.position.y -= rockBox.min.y;
    g.add(rock);
  }

  return finish(g);
}
