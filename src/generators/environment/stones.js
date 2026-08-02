// src/generators/environment/stones.js
// The expanded rock library. `generateRock` (rock.js) stays the small jittered
// boulder; these are the variants an author needs to make a mountainside or a
// crystal cave read as one place rather than a field of identical pebbles.
//
// Seeded base radius comes from sampleRock (src/sim/propMetrics.js) wherever
// collision depends on it, so the server can size a collider without Three.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { sampleRock } from '../../sim/propMetrics.js';
import { generateRock } from './rock.js';
import { jitterSharedVertices } from './jitter.js';

const ROCK_COLORS = [0x8a8a8a, 0x999088, 0x7a7a72, 0x8f7d6b];

function stoneMat(color) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 });
}

const finish = (g) => {
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
};

/** A big rounded mass — the thing you walk around, not over. */
export function generateBoulder(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const r = baseRadius * 1.9; // collision uses baseRadius * prop.scale; see propTypes
  const geo = new THREE.DodecahedronGeometry(r, 0);
  // Per-corner, not per-vertex — otherwise the boulder tears open (see jitter.js).
  jitterSharedVertices(geo, rng, (rr) => {
    const j = range(rr, 0.82, 1.16);
    return { x: j, y: j * range(rr, 0.7, 0.95), z: j };
  });
  const mesh = new THREE.Mesh(geo, stoneMat(pick(rng, ROCK_COLORS)));
  mesh.position.y = r * 0.55;
  mesh.rotation.set(range(rng, 0, 0.4), range(rng, 0, Math.PI * 2), range(rng, 0, 0.4));
  const g = new THREE.Group();
  g.add(mesh);
  return finish(g);
}

/** Angular shards jutting upward — the slate/spire look. */
export function generateSharpRock(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const g = new THREE.Group();
  const mat = stoneMat(pick(rng, [0x6f6a72, 0x7a7480, 0x5f5a66]));
  for (let i = 0; i < rangeInt(rng, 2, 4); i++) {
    const h = baseRadius * range(rng, 1.6, 3.0);
    const w = baseRadius * range(rng, 0.35, 0.7);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(w, h, rangeInt(rng, 4, 6)), mat);
    shard.position.set(range(rng, -0.35, 0.35), h / 2 - 0.05, range(rng, -0.35, 0.35));
    shard.rotation.set(range(rng, -0.18, 0.18), range(rng, 0, Math.PI), range(rng, -0.18, 0.18));
    g.add(shard);
  }
  return finish(g);
}

/** Several small rocks scattered tightly — reads as rubble. */
export function generateRockCluster(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const r = generateRock(seed + i * 613);
    r.position.set(range(rng, -0.7, 0.7), 0, range(rng, -0.7, 0.7));
    r.scale.setScalar(range(rng, 0.35, 0.8));
    g.add(r);
  }
  return g;
}

/** Flat stones on the ground. Never blocks. */
export function generatePebbles(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const mat = stoneMat(pick(rng, ROCK_COLORS));
  for (let i = 0; i < rangeInt(rng, 4, 9); i++) {
    const r = range(rng, 0.05, 0.14);
    const p = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat);
    p.position.set(range(rng, -0.4, 0.4), r * 0.35, range(rng, -0.4, 0.4));
    p.scale.y = 0.45;
    p.rotation.y = range(rng, 0, Math.PI * 2);
    g.add(p);
  }
  return finish(g);
}

const SANDSTONE_COLORS = [0xc97a3a, 0xd98a4a, 0xb56a30, 0xe0a05a];
const MOSSY_COLORS = [0x6a6a5f, 0x5f5f54, 0x74746a];
const SNOWY_ROCK_COLORS = [0x7a7a80, 0x6f6f78, 0x85858c];
const MOUNTAIN_ROCK_COLORS = [0x8f8f92, 0x7a7a80, 0x9a9a9e, 0x6f6f75];

/** A flatter, more eroded jittered mass in warm reds/oranges — desert sandstone. */
export function generateSandstoneRock(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const geo = new THREE.IcosahedronGeometry(baseRadius, 1);
  jitterSharedVertices(geo, rng, (r) => {
    const j = range(r, 0.8, 1.2);
    return { x: j, y: j * range(r, 0.6, 0.85), z: j };
  });
  const mesh = new THREE.Mesh(geo, stoneMat(pick(rng, SANDSTONE_COLORS)));
  mesh.rotation.set(range(rng, 0, Math.PI), range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI));
  mesh.position.y = baseRadius * 0.35;
  const g = new THREE.Group();
  g.add(mesh);
  return finish(g);
}

/** A jittered rock with a few moss patches stuck to its surface — swamp/bog rock. */
export function generateMossyRock(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const geo = new THREE.IcosahedronGeometry(baseRadius, 1);
  jitterSharedVertices(geo, rng, (r) => {
    const j = range(r, 0.85, 1.15);
    return { x: j, y: j * range(r, 0.65, 0.9), z: j };
  });
  const mesh = new THREE.Mesh(geo, stoneMat(pick(rng, MOSSY_COLORS)));
  mesh.rotation.set(range(rng, 0, Math.PI), range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI));
  mesh.position.y = baseRadius * 0.35;
  const g = new THREE.Group();
  g.add(mesh);
  const mossMat = stoneMat(pick(rng, [0x4a7a3a, 0x5a8a45]));
  for (let i = 0; i < rangeInt(rng, 3, 6); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const patch = new THREE.Mesh(new THREE.IcosahedronGeometry(baseRadius * range(rng, 0.18, 0.32), 0), mossMat);
    patch.position.set(Math.cos(a) * baseRadius * 0.7, baseRadius * range(rng, 0.4, 0.9), Math.sin(a) * baseRadius * 0.7);
    g.add(patch);
  }
  return finish(g);
}

/** A jittered rock with a snow cap resting on top. */
export function generateSnowyRock(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const geo = new THREE.IcosahedronGeometry(baseRadius, 1);
  jitterSharedVertices(geo, rng, (r) => {
    const j = range(r, 0.82, 1.18);
    return { x: j, y: j * range(r, 0.7, 1.0), z: j };
  });
  const mesh = new THREE.Mesh(geo, stoneMat(pick(rng, SNOWY_ROCK_COLORS)));
  mesh.rotation.set(range(rng, 0, Math.PI), range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI));
  mesh.position.y = baseRadius * 0.35;
  const g = new THREE.Group();
  g.add(mesh);
  const snowCap = new THREE.Mesh(
    new THREE.SphereGeometry(baseRadius * 0.75, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2.4),
    stoneMat(0xeef4f8)
  );
  snowCap.position.y = baseRadius * 0.55;
  g.add(snowCap);
  return finish(g);
}

/** A bigger, colder-toned jittered mass — mountain scree/boulder. */
export function generateMountainRock(seed) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng);
  const r = baseRadius * 1.4; // collision uses baseRadius * prop.scale; see propTypes
  const geo = new THREE.DodecahedronGeometry(r, 0);
  jitterSharedVertices(geo, rng, (rr) => {
    const j = range(rr, 0.78, 1.22);
    return { x: j, y: j * range(rr, 0.75, 1.05), z: j };
  });
  const mesh = new THREE.Mesh(geo, stoneMat(pick(rng, MOUNTAIN_ROCK_COLORS)));
  mesh.position.y = r * 0.5;
  mesh.rotation.set(range(rng, 0, 0.4), range(rng, 0, Math.PI * 2), range(rng, 0, 0.4));
  const g = new THREE.Group();
  g.add(mesh);
  return finish(g);
}

/** Glowing crystal spires — the green shards in the Atreiya screenshot. */
export function generateCrystal(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const hue = pick(rng, [0x3ad86a, 0x3ad8c8, 0x6a5ad8, 0xd83a9a]);
  const mat = new THREE.MeshStandardMaterial({
    color: hue,
    emissive: hue,
    // Emissive is what makes these pop against fog and pick up the bloom pass.
    emissiveIntensity: 0.45,
    flatShading: true,
    roughness: 0.3,
    metalness: 0.1,
  });
  for (let i = 0; i < rangeInt(rng, 2, 5); i++) {
    const h = range(rng, 0.5, 1.7);
    const w = range(rng, 0.09, 0.22);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5), mat);
    shard.position.set(range(rng, -0.28, 0.28), h / 2, range(rng, -0.28, 0.28));
    shard.rotation.set(range(rng, -0.22, 0.22), range(rng, 0, Math.PI), range(rng, -0.22, 0.22));
    g.add(shard);
  }
  if (chance(rng, 0.7)) {
    const base = new THREE.Mesh(new THREE.DodecahedronGeometry(range(rng, 0.2, 0.35), 0), stoneMat(0x5f5a66));
    base.position.y = 0.08;
    base.scale.y = 0.5;
    g.add(base);
  }
  return finish(g);
}

// --- Crystal clusters (reference-image upgrade) -----------------------------
// A more faceted, gem-like silhouette than generateCrystal above: one tall
// dominant spike, several shorter shards fanned around it, all rising from a
// small jittered rock outcrop, plus a scatter of tiny chip shards at the
// base. Left generateCrystal itself untouched — Dennis's explicit call
// during the grass work was to add a new preset alongside an existing one
// rather than upgrade it in place (see PROJECT_STATUS.md's grass section).
function crystalCluster(seed, hues) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const hue = pick(rng, hues);
  const mat = new THREE.MeshStandardMaterial({
    color: hue,
    emissive: hue,
    emissiveIntensity: 0.4,
    flatShading: true,
    roughness: 0.2,
    metalness: 0.1,
  });

  // Small jittered rock outcrop the shards emerge from. Buried in propTypes
  // (like every other rock-family prop) so its jittered low point doesn't
  // need to land within the tight un-buried ground tolerance.
  const baseR = range(rng, 0.22, 0.3);
  const baseGeo = new THREE.IcosahedronGeometry(baseR, 1);
  jitterSharedVertices(baseGeo, rng, (r) => {
    const j = range(r, 0.8, 1.15);
    return { x: j, y: j * range(r, 0.4, 0.55), z: j };
  });
  const base = new THREE.Mesh(baseGeo, stoneMat(0x2a2a34));
  base.position.y = baseR * 0.3;
  g.add(base);

  // One dominant tall spike plus several shorter shards fanned around it —
  // the reference images' silhouette. 6-sided cones read as faceted crystal
  // points rather than smooth cones.
  const shardCount = rangeInt(rng, 4, 6);
  for (let i = 0; i < shardCount; i++) {
    const isMain = i === 0;
    const h = isMain ? range(rng, 1.0, 1.5) : range(rng, 0.45, 0.9);
    const w = isMain ? range(rng, 0.12, 0.17) : range(rng, 0.08, 0.13);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), mat);
    const a = (i / shardCount) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const dist = isMain ? range(rng, 0, 0.04) : range(rng, 0.09, 0.2);
    shard.position.set(Math.cos(a) * dist, h / 2 + baseR * 0.15, Math.sin(a) * dist);
    shard.rotation.set(
      range(rng, -0.15, 0.15) + Math.sin(a) * 0.18,
      range(rng, 0, Math.PI * 2),
      range(rng, -0.15, 0.15) - Math.cos(a) * 0.18
    );
    g.add(shard);
  }

  // Tiny crystal chips scattered around the base for detail.
  for (let i = 0; i < rangeInt(rng, 4, 8); i++) {
    const a = range(rng, 0, Math.PI * 2);
    const dist = range(rng, baseR * 0.7, baseR * 1.25);
    const h = range(rng, 0.06, 0.13);
    const chip = new THREE.Mesh(new THREE.ConeGeometry(h * 0.35, h, 5), mat);
    chip.position.set(Math.cos(a) * dist, h / 2, Math.sin(a) * dist);
    chip.rotation.set(range(rng, -0.3, 0.3), range(rng, 0, Math.PI * 2), range(rng, 0.2, 0.6));
    g.add(chip);
  }

  return finish(g);
}

/** Pink/magenta crystal cluster. */
export function generateCrystalRose(seed) {
  return crystalCluster(seed, [0xd8397f, 0xe85a9a, 0xc22a6a]);
}

/** Green crystal cluster. */
export function generateCrystalEmerald(seed) {
  return crystalCluster(seed, [0x2ad88a, 0x3ac8a0, 0x1fb87a]);
}

/** Icy blue/white crystal cluster. */
export function generateCrystalFrost(seed) {
  return crystalCluster(seed, [0x9adcf0, 0xc5eefc, 0x7ec8e8]);
}

/** Purple/violet crystal cluster. */
export function generateCrystalAmethyst(seed) {
  return crystalCluster(seed, [0x9a5ad8, 0xb07ae8, 0x8248c2]);
}
