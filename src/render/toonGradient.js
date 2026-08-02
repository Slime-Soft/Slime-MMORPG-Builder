// src/render/toonGradient.js
// A small stepped gradient for MeshToonMaterial — without one it defaults to
// a hard 2-tone lit/shadow split, which reads as flat and graphic-novel-ish.
// A few visible bands gives a softer cel-shaded look closer to the stylized
// reference art this is aiming toward, without needing a custom shader.
// Shared (not owned by scene.js) so anything cel-shaded — the toonified world,
// the grass field — uses the same bands.
import * as THREE from 'three';

let toonGradientMap = null;
export function getToonGradientMap() {
  if (!toonGradientMap) {
    const bands = new Uint8Array([70, 130, 190, 255]);
    toonGradientMap = new THREE.DataTexture(bands, bands.length, 1, THREE.RedFormat);
    toonGradientMap.needsUpdate = true;
    toonGradientMap.magFilter = THREE.NearestFilter;
    toonGradientMap.minFilter = THREE.NearestFilter;
  }
  return toonGradientMap;
}
