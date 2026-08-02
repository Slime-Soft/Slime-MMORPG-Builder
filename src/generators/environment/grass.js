// src/generators/environment/grass.js
import * as THREE from 'three';
import { createRng, range, rangeInt, pick } from '../seededRandom.js';

const GRASS_COLORS = [0x4a8a3a, 0x5a9a4a, 0x3f7a30];

/** A patch of grass blades scattered around a center point. */
export function generateGrassPatch(seed, options = {}) {
  const rng = createRng(seed);
  const radius = options.radius ?? range(rng, 0.8, 1.6);
  const bladeCount = options.bladeCount ?? rangeInt(rng, 14, 26);

  const bladeGeo = new THREE.ConeGeometry(0.04, 1, 3);
  const mat = new THREE.MeshStandardMaterial({ color: pick(rng, GRASS_COLORS) });
  const mesh = new THREE.InstancedMesh(bladeGeo, mat, bladeCount);
  mesh.castShadow = true;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < bladeCount; i++) {
    const angle = range(rng, 0, Math.PI * 2);
    const dist = range(rng, 0, radius);
    const h = range(rng, 0.3, 0.7);
    dummy.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist);
    dummy.rotation.set(range(rng, -0.15, 0.15), range(rng, 0, Math.PI * 2), range(rng, -0.15, 0.15));
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

const PETAL_COLORS = [0xe05a7a, 0xf0d030, 0xe0e0f0, 0x7a5ae0, 0xe08a30];

/** A single flower — stem plus a small ring of petals. */
export function generateFlower(seed) {
  const rng = createRng(seed);
  const group = new THREE.Group();

  const stemHeight = range(rng, 0.25, 0.5);
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.02, stemHeight, 5),
    new THREE.MeshStandardMaterial({ color: 0x3f7a30 })
  );
  stem.position.y = stemHeight / 2;
  group.add(stem);

  const petalColor = pick(rng, PETAL_COLORS);
  const petalMat = new THREE.MeshStandardMaterial({ color: petalColor });
  const petalCount = rangeInt(rng, 4, 6);
  const petalRadius = range(rng, 0.06, 0.11);
  for (let i = 0; i < petalCount; i++) {
    const angle = (i / petalCount) * Math.PI * 2;
    const petal = new THREE.Mesh(new THREE.SphereGeometry(petalRadius, 6, 6), petalMat);
    petal.position.set(Math.cos(angle) * petalRadius, stemHeight, Math.sin(angle) * petalRadius);
    petal.scale.set(1, 0.5, 1);
    group.add(petal);
  }

  const center = new THREE.Mesh(
    new THREE.SphereGeometry(petalRadius * 0.6, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0xf0c030 })
  );
  center.position.y = stemHeight;
  group.add(center);

  return group;
}

/**
 * A patch of individual flowers scattered around a center point — the World
 * Editor's preview for the dense "Meadow Flowers" preset (the live game
 * renders that preset as instanced stems/heads instead, see
 * src/render/flowerCover.js; this just needs to look like a patch here).
 */
export function generateFlowerPatch(seed, options = {}) {
  const rng = createRng(seed);
  const radius = options.radius ?? 1.0;
  const count = options.count ?? 12;

  const group = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const angle = range(rng, 0, Math.PI * 2);
    const dist = Math.sqrt(range(rng, 0, 1)) * radius;
    const flower = generateFlower(rangeInt(rng, 1, 1e9));
    flower.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    group.add(flower);
  }
  return group;
}
