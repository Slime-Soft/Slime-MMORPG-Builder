// src/generators/environment/plugins/clover.js
// A working example — see README.md in this folder for the format this file
// follows. Delete this once you've dropped in your own plugins, or leave it;
// it's a perfectly fine clover.
import * as THREE from 'three';
import { createRng } from '../../seededRandom.js';

export const meta = {
  id: 'flower-clover',
  label: 'Clover',
  category: 'plants',
};

/** @param {number} seed @returns {THREE.Object3D} standing on y=0 */
export function build(seed) {
  const rng = createRng(seed);
  const group = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fae4a });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5), stemMat);
  stem.castShadow = true;
  stem.position.y = 0.09;
  group.add(stem);

  // Three overlapping leaflets, jittered slightly per-seed so a scattered
  // patch of these doesn't look like the same clover copy-pasted.
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), leafMat);
    const angle = (i / 3) * Math.PI * 2 + rng() * 0.4;
    leaf.position.set(Math.cos(angle) * 0.05, 0.19, Math.sin(angle) * 0.05);
    leaf.scale.set(1, 0.5, 1.2);
    leaf.castShadow = true;
    group.add(leaf);
  }

  return group;
}
