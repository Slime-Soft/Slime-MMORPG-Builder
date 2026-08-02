// src/generators/environment/plugins/rose-bush.js
// A garden rose bush: a rounded green foliage mass (same clumped-icosahedron
// technique as the built-in bush) with a scatter of layered rose blooms on
// top. Style matches the project's existing flora (flat-shaded, seeded
// per-instance variation) — see this folder's README.md for the file format.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick } from '../../seededRandom.js';

export const meta = {
  id: 'rose-bush',
  label: 'Rose Bush',
  category: 'plants',
};

function standardMat(color) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9 });
}

const LEAF_GREENS = [0x2f6b2f, 0x3f7a3f, 0x2a5c2a];
// A few real rose colors, one per bush (all blooms on one bush match — a
// rose bush is a single cultivar, not a mixed bouquet).
const ROSE_COLORS = [0xc4234a, 0xd94a6a, 0xe88aa8, 0xf2d43a, 0xf5f2e8];

/** @param {number} seed @returns {THREE.Object3D} standing on y=0 */
export function build(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();

  // Foliage: several overlapping rounded blobs, same technique as the
  // built-in bush, so it reads as one leafy mass rather than separate balls.
  const leafMat = standardMat(pick(rng, LEAF_GREENS));
  const blobCount = rangeInt(rng, 4, 7);
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    const r = range(rng, 0.22, 0.38);
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    blob.position.set(range(rng, -0.28, 0.28), r * 0.85 + range(rng, -0.04, 0.12), range(rng, -0.28, 0.28));
    blob.castShadow = true;
    g.add(blob);
    blobs.push({ pos: blob.position, r });
  }

  // A few woody stems poking up from the base into the foliage, visible
  // between the leaf clumps — grounds the bush so it doesn't look like it's
  // floating balls of leaves.
  const stemMat = standardMat(0x4a3a2a);
  for (let i = 0; i < rangeInt(rng, 3, 5); i++) {
    const h = range(rng, 0.35, 0.55);
    const x = range(rng, -0.18, 0.18);
    const z = range(rng, -0.18, 0.18);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.025, h, 5), stemMat);
    stem.position.set(x, h / 2, z);
    stem.rotation.set(range(rng, -0.15, 0.15), 0, range(rng, -0.15, 0.15));
    stem.castShadow = true;
    g.add(stem);
  }

  // Blooms: layered rings of small boxes (petals) around a center sphere,
  // scattered across the foliage surface so they sit ON the leaf mass rather
  // than floating above or buried inside it.
  const bloomColor = pick(rng, ROSE_COLORS);
  const petalMat = standardMat(bloomColor);
  const centerMat = standardMat(0xf2c93a);
  const bloomCount = rangeInt(rng, 5, 9);
  for (let i = 0; i < bloomCount; i++) {
    const host = pick(rng, blobs);
    const a = range(rng, 0, Math.PI * 2);
    const elevation = range(rng, 0.3, 0.95); // how far up the blob's surface
    const bx = host.pos.x + Math.cos(a) * host.r * elevation;
    const bz = host.pos.z + Math.sin(a) * host.r * elevation;
    const by = host.pos.y + host.r * range(rng, 0.15, 0.6);

    const bloom = new THREE.Group();
    bloom.position.set(bx, by, bz);
    bloom.rotation.y = range(rng, 0, Math.PI * 2);

    // Two staggered petal rings — outer larger/flatter, inner smaller/upright
    // — reads as a rose's layered bloom without needing real curved geometry.
    for (const [count, size, tilt] of [[6, 0.05, 0.35], [5, 0.032, 0.9]]) {
      for (let p = 0; p < count; p++) {
        const pa = (p / count) * Math.PI * 2;
        const petal = new THREE.Mesh(new THREE.BoxGeometry(size, 0.01, size * 0.55), petalMat);
        petal.position.set(Math.cos(pa) * size * 0.5, size * 0.15, Math.sin(pa) * size * 0.5);
        petal.rotation.y = -pa;
        petal.rotation.x = tilt;
        petal.castShadow = true;
        bloom.add(petal);
      }
    }
    const center = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), centerMat);
    center.position.y = 0.03;
    bloom.add(center);

    g.add(bloom);
  }

  return g;
}
