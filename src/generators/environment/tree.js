// src/generators/environment/tree.js
import * as THREE from 'three';
import { createRng } from '../seededRandom.js';
import { sampleTree } from '../../sim/propMetrics.js';
import { generateFluffyTree } from './fluffyTree.js';

/**
 * Procedurally generate a tree. Two silhouettes: "conifer" (cone canopy,
 * hand-rolled below) or "round" (a "fluffy" blob-canopy tree — see
 * fluffyTree.js, the technique that actually matches the anime-tree
 * reference), chosen and shaped from the seed.
 *
 * Every parameter is drawn by `sampleTree` (src/sim/propMetrics.js); this
 * function only turns the resulting descriptor into meshes. That split is what
 * lets the server compute this tree's collision radius — its trunk radius —
 * without loading Three. Don't reintroduce an rng draw here.
 *
 * @param {number} seed
 * @param {{ type?: 'conifer' | 'round' | 'random', leafDensity?: number }} [options]
 *   `leafDensity` only affects 'round' trees — see fluffyTree.js.
 */
export function generateTree(seed, options = {}) {
  const rng = createRng(seed);
  const d = sampleTree(rng, options);

  if (d.type !== 'conifer') {
    // The fluffy generator builds its own trunk + blob crown — the
    // trunk/flare/cone code below is conifer-only.
    return generateFluffyTree(seed, options.leafDensity);
  }

  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: d.trunkColor });

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(d.trunkRadius * 0.7, d.trunkRadius, d.trunkHeight, 6),
    trunkMat
  );
  trunk.position.y = d.trunkHeight / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // Root flare: a short, wider frustum blended into the trunk's base so it
  // doesn't just plant into the ground as a uniform pole. Fixed proportions
  // of the trunk's own radius/height — no new rng draw needed, it's not a
  // sim-relevant (collision) parameter.
  const flareHeight = d.trunkHeight * 0.15;
  const flare = new THREE.Mesh(
    new THREE.CylinderGeometry(d.trunkRadius, d.trunkRadius * 1.5, flareHeight, 6),
    trunkMat
  );
  flare.position.y = flareHeight / 2;
  flare.castShadow = true;
  group.add(flare);

  // flatShading — flat facets pick up the same cel-shaded, faceted look the
  // rest of the stylized art (rocks) has.
  const leafMat = new THREE.MeshStandardMaterial({ color: d.leafColor, flatShading: true });
  let y = d.trunkHeight * 0.5;
  for (const tier of d.tiers) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(tier.radius, tier.h, 8), leafMat);
    cone.position.y = y + tier.h / 2;
    // An 8-segment cone is ~16 triangles, opaque, no alpha test — casting
    // from it costs essentially nothing in the shadow pass and is what makes
    // the tree read as standing in its own shade rather than as a bare pole.
    cone.castShadow = true;
    group.add(cone);
    y += tier.h * 0.6;
  }

  if (d.rotationY !== null) group.rotation.y = d.rotationY;
  group.scale.setScalar(d.scale);

  return group;
}
