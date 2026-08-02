// src/generators/environment/rock.js
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';
import { sampleRock } from '../../sim/propMetrics.js';
import { jitterSharedVertices } from './jitter.js';

const ROCK_COLORS = [0x8a8a8a, 0x999088, 0x7a7a72, 0x8f7d6b];

/**
 * Procedurally generate a rock/boulder by jittering an icosahedron's
 * vertices. Same seed -> same rock shape every time.
 *
 * `baseRadius` is drawn by sampleRock (src/sim/propMetrics.js) so the server
 * can derive this rock's collision radius without loading Three; the jitter,
 * color and rotation draws below continue on the same rng and stay here.
 */
export function generateRock(seed, options = {}) {
  const rng = createRng(seed);
  const { baseRadius } = sampleRock(rng, options);
  const detail = 1;
  const geo = new THREE.IcosahedronGeometry(baseRadius, detail);

  // Jitter per unique CORNER, not per vertex: the geometry is non-indexed, so a
  // corner appears once per touching triangle and moving those copies apart
  // opens holes in the rock (see jitter.js).
  jitterSharedVertices(geo, rng, (r) => {
    const j = range(r, 0.82, 1.18);
    return { x: j, y: j * range(r, 0.7, 1.0), z: j };
  });

  const mat = new THREE.MeshStandardMaterial({
    color: pick(rng, ROCK_COLORS),
    flatShading: true,
    roughness: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.set(range(rng, 0, Math.PI), range(rng, 0, Math.PI * 2), range(rng, 0, Math.PI));
  mesh.position.y = baseRadius * 0.35;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A cluster of an ore vein embedded in/around a rock — used by the mountains zone. */
export function generateOreDeposit(seed, options = {}) {
  const rng = createRng(seed);
  const oreColors = {
    iron: 0xb5651d,
    copper: 0xd98a4a,
    silver: 0xc7c7d0,
    gold: 0xe8c34a,
  };
  const oreType = options.oreType || pick(rng, Object.keys(oreColors));

  const group = new THREE.Group();
  const host = generateRock(seed, { radius: range(rng, 0.9, 1.4) });
  group.add(host);

  const nodeCount = Math.floor(range(rng, 3, 6));
  const oreMat = new THREE.MeshStandardMaterial({
    color: oreColors[oreType],
    emissive: oreColors[oreType],
    emissiveIntensity: 0.15,
    roughness: 0.4,
    metalness: 0.6,
  });
  for (let i = 0; i < nodeCount; i++) {
    const node = new THREE.Mesh(
      new THREE.DodecahedronGeometry(range(rng, 0.12, 0.26)),
      oreMat
    );
    const angle = range(rng, 0, Math.PI * 2);
    const dist = range(rng, 0.5, 1.1);
    node.position.set(
      Math.cos(angle) * dist,
      range(rng, 0.2, 0.9),
      Math.sin(angle) * dist
    );
    node.castShadow = true;
    group.add(node);
  }

  group.userData.oreType = oreType;
  return group;
}
