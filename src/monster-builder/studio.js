// src/monster-builder/studio.js
// The Monster Builder's own workspace scene — a neutral MODELLING STUDIO, not
// the game world.
//
// WHY THIS EXISTS. The workspace used to call render/scene.js's createScene(),
// which is the live game's outdoor atmosphere: a 1500-unit sky dome, a drifting
// cloud layer, exponential fog, a sun-glow sprite and a sun-rays cone. At world
// scale those read as sky; inside a 4-unit modelling viewport with a 100-unit
// far plane they read as a big unexplained white hotspot parked in the middle of
// the floor, washing out whatever you were trying to look at, plus a warm fog
// tint that lied about every colour you picked from the swatch row.
//
// A modelling viewport wants the opposite of atmosphere: neutral grey backdrop,
// a stable three-point light rig so a shape's form reads from any camera angle,
// and a contact shadow so parts sit on the floor instead of hovering. None of
// that should track the game's time of day or weather preset — you are judging
// the MODEL here, not the scene it will eventually stand in.
import * as THREE from 'three';

/** Backdrop grey. Mid-dark so both light and dark monster colours keep contrast against it. */
const BACKDROP = 0x1a1a20;
const FLOOR_RADIUS = 3.2;

/**
 * Three-point rig: warm key from front-camera-left, cool fill opposite it to
 * keep shadowed sides readable rather than black, and a back rim that separates
 * the silhouette from the backdrop. Shared with the preset-thumbnail renderer so
 * a thumbnail is lit exactly like the preview it applies to.
 * @param {THREE.Scene} scene
 * @param {{shadows?: boolean}} [opts]
 * @returns {THREE.DirectionalLight} the key light (the only shadow caster)
 */
export function addStudioLights(scene, { shadows = false } = {}) {
  const hemi = new THREE.HemisphereLight(0xd8e2f0, 0x4a4238, 0.75);
  hemi.name = 'studio-hemi';
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2dd, 1.5);
  key.name = 'studio-key';
  key.position.set(2.6, 4.2, 3.4);
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight(0xbcd0ee, 0.55);
  fill.name = 'studio-fill';
  fill.position.set(-3.6, 1.6, 2.2);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffffff, 0.7);
  rim.name = 'studio-rim';
  rim.position.set(-1.2, 2.4, -4);
  scene.add(rim);

  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const cam = key.shadow.camera;
    cam.near = 0.5;
    cam.far = 14;
    cam.left = -2.6; cam.right = 2.6;
    cam.top = 2.6; cam.bottom = -2.6;
    cam.updateProjectionMatrix();
    key.shadow.normalBias = 0.02;
  }
  return key;
}

/**
 * The full workspace scene: backdrop, light rig, a shadow-catching floor disc
 * and a muted grid for scale. No fog, no sky, no sun sprite — nothing that
 * renders as a light source floating in the middle of the model.
 * @param {{shadows?: boolean}} [opts]
 * @returns {THREE.Scene}
 */
export function createStudioScene({ shadows = true } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKDROP);
  addStudioLights(scene, { shadows });

  // Grid first, floor disc second: the disc is a ShadowMaterial (it only
  // darkens where the shadow map says so), so the grid stays visible THROUGH
  // it and the shadow reads as a shadow on the grid rather than a grey plate.
  const grid = new THREE.GridHelper(6, 24, 0x6a7a8a, 0x2e3238);
  grid.name = 'studio-grid';
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  if (shadows) {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(FLOOR_RADIUS, 48),
      new THREE.ShadowMaterial({ opacity: 0.34 })
    );
    floor.name = 'studio-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001; // above the grid lines so the shadow lands on top of them
    floor.receiveShadow = true;
    scene.add(floor);
  }
  return scene;
}

/** Let every mesh under `object` cast into the studio's contact shadow. */
export function enableStudioShadows(object) {
  object.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
}
