// src/generators/environment/craftingStations.js
// Visuals for the six crafting-station prop types (src/sim/propTypes.js's
// 'crafting-stations' category, src/sim/craftingStations.js's catalog).
// Same primitive-composition idiom as stump/log/runestone in flora.js —
// boxes/cylinders/cones, no new asset pipeline. What a station DOES (which
// professions/recipes it serves) comes entirely from an Event object
// attached to the placed instance, not from anything in this file.
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';

function standardMat(color, flat = true) {
  return new THREE.MeshStandardMaterial({ color, flatShading: flat, roughness: 0.9 });
}

const WOOD = [0x5a3d2b, 0x4a3320, 0x6b4a30];
const STONE = [0x6a6a6a, 0x757575, 0x5f5f5f];
const METAL = 0x2b2b2e;
const CLOTH = [0x8a5a3a, 0x6d4c2a];

const finish = (g) => {
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
};

/** Anvil (dark forged-metal block, tapered horn) on a stone block, beside a low stone forge/brazier. */
export function generateStationAnvil(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const metalMat = standardMat(METAL);

  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.35), standardMat(pick(rng, STONE)));
  base.position.y = 0.275;
  g.add(base);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.4), metalMat);
  body.position.y = 0.55 + 0.09;
  g.add(body);

  const horn = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 8), metalMat);
  horn.rotation.z = Math.PI / 2;
  horn.position.set(0.55, 0.55 + 0.11, 0);
  g.add(horn);

  // A low forge brazier beside it.
  const forge = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.4, 8), standardMat(pick(rng, STONE)));
  forge.position.set(-0.9, 0.2, 0);
  g.add(forge);
  const coals = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 8), standardMat(0xaa4422));
  coals.position.set(-0.9, 0.41, 0);
  g.add(coals);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** A plain wooden workbench with a tool rack. */
export function generateStationWorkbench(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = standardMat(pick(rng, WOOD));

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.6), wood);
  top.position.y = 0.75;
  g.add(top);
  for (const [x, z] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.75, 0.08), wood);
    leg.position.set(x, 0.375, z);
    g.add(leg);
  }
  const rack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.35, 0.06), wood);
  rack.position.set(0, 1.1, -0.28);
  g.add(rack);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** A loom frame beside a tanning rack (stretched hide). */
export function generateStationLoom(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = standardMat(pick(rng, WOOD));

  const frameW = 0.9;
  const frameH = 0.9;
  for (const [x, y] of [[-frameW / 2, frameH / 2], [frameW / 2, frameH / 2]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, frameH, 0.06), wood);
    post.position.set(x, y, 0);
    g.add(post);
  }
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(frameW, 0.06, 0.06), wood);
  topBar.position.set(0, frameH, 0);
  g.add(topBar);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(frameW * 0.85, frameH * 0.85), standardMat(pick(rng, CLOTH), false));
  cloth.position.set(0, frameH / 2, 0.01);
  g.add(cloth);

  // Tanning rack: a slanted hide stretched on a frame.
  const rackFrame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.03, 0.9), wood);
  rackFrame.position.set(-0.9, 0.45, 0);
  rackFrame.rotation.x = -0.5;
  g.add(rackFrame);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** A small jeweler's bench: a desk with a magnifier lamp and a tray of gems. */
export function generateStationJewelersBench(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const wood = standardMat(pick(rng, WOOD));

  const top = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.5), wood);
  top.position.y = 0.7;
  g.add(top);
  for (const [x, z] of [[-0.32, -0.18], [0.32, -0.18], [-0.32, 0.18], [0.32, 0.18]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), wood);
    leg.position.set(x, 0.35, z);
    g.add(leg);
  }
  const tray = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.2), standardMat(0x3a3a3a));
  tray.position.set(0.1, 0.745, 0);
  g.add(tray);
  const gemColors = [0xd94f70, 0x4fd9a0, 0x4f8fd9, 0xd9c94f];
  for (let i = 0; i < 4; i++) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.03), standardMat(gemColors[i], false));
    gem.position.set(0.02 + (i % 2) * 0.08, 0.78, -0.03 + Math.floor(i / 2) * 0.06);
    g.add(gem);
  }
  const lampArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), standardMat(0x2b2b2e));
  lampArm.position.set(-0.3, 0.9, -0.15);
  g.add(lampArm);
  const lampHead = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12), standardMat(0xdddddd));
  lampHead.position.set(-0.3, 1.1, -0.15);
  lampHead.rotation.x = Math.PI / 2;
  g.add(lampHead);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** An alchemy lab: a stone table with bubbling flasks and a still. */
export function generateStationAlchemyLab(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();

  const top = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.08, 0.55), standardMat(pick(rng, STONE)));
  top.position.y = 0.7;
  g.add(top);
  for (const [x, z] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.2], [0.42, 0.2]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), standardMat(pick(rng, STONE)));
    leg.position.set(x, 0.35, z);
    g.add(leg);
  }
  const flaskColors = [0x4fd98a, 0xd94f9c, 0x4fa0d9, 0xd9b04f];
  for (let i = 0; i < 3; i++) {
    const flask = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), standardMat(flaskColors[i], false));
    flask.position.set(-0.3 + i * 0.3, 0.79, 0.1);
    g.add(flask);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.12, 6), standardMat(0xcfe0e0, false));
    neck.position.set(-0.3 + i * 0.3, 0.9, 0.1);
    g.add(neck);
  }
  const still = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.25, 8), standardMat(0x8a8a8a));
  still.position.set(0.35, 0.86, -0.12);
  g.add(still);
  const stillTop = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.15, 8), standardMat(0x8a8a8a));
  stillTop.position.set(0.35, 1.06, -0.12);
  g.add(stillTop);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}

/** A campfire ring with a cooking pot on a spit, beside a small oven mound. */
export function generateStationCampfire(seed) {
  const rng = createRng(seed);
  const g = new THREE.Group();
  const stoneMat = standardMat(pick(rng, STONE));

  const ringCount = 8;
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2;
    const stone = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 0.08, 0.12), 6, 5), stoneMat);
    stone.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
    g.add(stone);
  }
  const logMat = standardMat(pick(rng, WOOD));
  for (const rot of [0.3, -0.3, 1.2]) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), logMat);
    log.rotation.z = Math.PI / 2;
    log.rotation.y = rot;
    log.position.y = 0.08;
    g.add(log);
  }
  const embers = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.03, 8), standardMat(0xaa4422, false));
  embers.position.y = 0.11;
  g.add(embers);

  const spitPost = (x) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), logMat);
    post.position.set(x, 0.35, 0);
    g.add(post);
  };
  spitPost(-0.35);
  spitPost(0.35);
  const spitBar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.75, 6), standardMat(0x2b2b2e));
  spitBar.rotation.z = Math.PI / 2;
  spitBar.position.y = 0.68;
  g.add(spitBar);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.2, 8), standardMat(0x2b2b2e));
  pot.position.y = 0.55;
  g.add(pot);

  g.rotation.y = range(rng, 0, Math.PI * 2);
  return finish(g);
}
