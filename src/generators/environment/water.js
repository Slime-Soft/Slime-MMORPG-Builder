// src/generators/environment/water.js
import * as THREE from 'three';
import { createRng, range } from '../seededRandom.js';

/** A simple animated-capable water plane (shader-free Phase 2 placeholder). */
export function generateWaterPlane(options = {}) {
  const width = options.width ?? 40;
  const depth = options.depth ?? 40;
  const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2f7bb0,
    transparent: true,
    opacity: 0.85,
    roughness: 0.15,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.userData.isWater = true; // render layer can bob/scroll this per-frame later
  return mesh;
}

/**
 * A terrain patch with gentle height variation, built from a subdivided
 * plane whose vertices are displaced by seeded noise. Full heightmap-driven
 * terrain (with painting tools) belongs to the Phase 3 World Editor — this
 * gives the render layer something real to place other assets on in the
 * meantime.
 */
export function generateTerrainPatch(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? 40;
  const depth = options.depth ?? 40;
  const segments = options.segments ?? 12;
  const maxHeight = options.maxHeight ?? 0.6;

  const geo = new THREE.PlaneGeometry(width, depth, segments, segments);
  const posAttr = geo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const n =
      Math.sin(x * 0.3 + seed * 0.01) * 0.5 +
      Math.cos(y * 0.25 + seed * 0.02) * 0.5 +
      range(rng, -0.15, 0.15);
    posAttr.setZ(i, n * maxHeight);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: options.color ?? 0x5a8a4a });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}
