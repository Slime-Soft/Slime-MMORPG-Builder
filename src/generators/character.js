// src/generators/character.js
// Chibi-style character: oversized head, small/simplified body. Fully
// parametric so character creation (Phase 4) can drive it live, and so
// cosmetic skins can later swap only the outfit layer without touching
// the underlying body.
import * as THREE from 'three';
import { createRng, range, pick } from './seededRandom.js';
import { GAIT_TABLES } from './rig.js';
import { attachWeapons } from './creatureRig.js';
import { CLASS_LOADOUTS } from '../sim/weaponTypes.js';

export const SKIN_TONES = [0xffe0bd, 0xf0c090, 0xd9a066, 0xa9713f, 0x7a4a28, 0x5a3420];
export const HAIR_COLORS = [0x1a1a1a, 0x3a2418, 0x6b4a2a, 0xc9a227, 0xd94f4f, 0x4a6bd9, 0xe0e0e0];
export const EYE_COLORS = [0x2a2a2a, 0x3a6b3a, 0x3a5ab0, 0x8a5a2a, 0x7a3ab0];
export const HAIR_STYLES = ['short', 'ponytail', 'bob', 'spiky', 'bald'];
export const FACE_SHAPES = ['round'];

/**
 * @typedef {Object} CharacterParams
 * @property {'masc'|'fem'} [gender]
 * @property {'round'} [faceShape]
 * @property {'short'|'ponytail'|'bob'|'spiky'|'bald'} [hairStyle]
 * @property {number} [hairColor] hex
 * @property {number} [eyeColor] hex
 * @property {number} [skinTone] hex
 * @property {number} [outfitColor] hex — primary outfit layer color
 * @property {string} [classId] which weapon (if any) to attach to the main hand — see generators/weapon.js
 * @property {number} [seed] falls back to a random value if omitted (character
 *   creation should always pass an explicit seed once the player confirms,
 *   so re-loading the same character looks identical)
 */

/**
 * @param {CharacterParams} params
 * @returns {THREE.Group}
 */
export function generateCharacter(params = {}) {
  const seed = params.seed ?? Math.floor(Math.random() * 1e9);
  const rng = createRng(seed);

  const gender = params.gender ?? pick(rng, ['masc', 'fem']);
  const faceShape = 'round'; // only shape left — see FACE_SHAPES above
  const hairStyle = params.hairStyle ?? pick(rng, HAIR_STYLES);
  const hairColor = params.hairColor ?? pick(rng, HAIR_COLORS);
  const eyeColor = params.eyeColor ?? pick(rng, EYE_COLORS);
  const skinTone = params.skinTone ?? pick(rng, SKIN_TONES);
  const outfitColor = params.outfitColor ?? pick(rng, [0x3f88c5, 0xc5533f, 0x5ac53f, 0x8a3fc5, 0xc5a83f]);

  const group = new THREE.Group();
  group.userData.characterParams = { gender, faceShape, hairStyle, hairColor, eyeColor, skinTone, outfitColor, seed, classId: params.classId };

  const skinMat = new THREE.MeshStandardMaterial({ color: skinTone });
  const outfitMat = new THREE.MeshStandardMaterial({ color: outfitColor });
  const hairMat = new THREE.MeshStandardMaterial({ color: hairColor });

  // --- Chibi proportions: head is large relative to body ---
  const headRadius = 0.5;
  const bodyHeight = gender === 'masc' ? 0.85 : 0.78;
  const bodyWidth = gender === 'masc' ? 0.62 : 0.54;
  const legHeight = 0.42;

  // Legs — each is a pivot Group anchored at the hip (y = legHeight, the
  // top of the leg), with the visual mesh hanging *below* that pivot. This
  // (rather than a rigid mesh centered on itself) is what makes a walk
  // cycle possible: rotating the pivot swings the whole leg from the hip
  // instead of through its own middle.
  const legGeo = new THREE.CylinderGeometry(0.13, 0.11, legHeight, 8);
  function buildLegPivot(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, legHeight, 0);
    const mesh = new THREE.Mesh(legGeo, outfitMat);
    mesh.position.y = -legHeight / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const legL = buildLegPivot(-1);
  const legR = buildLegPivot(1);
  group.add(legL, legR);

  // Body (capsule reads friendlier for chibi style than a hard box)
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(bodyWidth / 2, bodyHeight * 0.5, 4, 8),
    outfitMat
  );
  body.position.y = legHeight + bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  // A small chest is the single biggest cue that reads as feminine at this
  // level of abstraction, given the model has no other silhouette detail.
  if (gender === 'fem') {
    const chestMat = outfitMat;
    const chestY = legHeight + bodyHeight * 0.68;
    const chestZ = bodyWidth * 0.42;
    for (const side of [-1, 1]) {
      const chest = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 10), chestMat);
      chest.position.set(side * 0.1, chestY, chestZ);
      chest.scale.set(1, 0.85, 0.7);
      group.add(chest);
    }
  }

  // Arms — same pivot-at-the-joint approach as the legs, anchored at the
  // shoulder. Each carries a `hand` Group at its far end; a weapon parents to
  // that hand, so it swings naturally with the arm for free once a walk/attack
  // animation drives pivot.rotation.x. Same convention the data-driven bodies
  // use (see creatureRig.js's handAnchorFor).
  const armLen = bodyHeight * 0.75;
  const shoulderY = legHeight + bodyHeight * 0.85;
  const armGeo = new THREE.CapsuleGeometry(0.09, armLen * 0.7, 4, 6);
  const hands = {};
  function buildArmPivot(side, handRole) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (bodyWidth / 2 + 0.08), shoulderY, 0);
    const mesh = new THREE.Mesh(armGeo, skinMat);
    mesh.position.y = -armLen * 0.4;
    mesh.castShadow = true;
    pivot.add(mesh);
    const hand = new THREE.Group();
    hand.position.y = -armLen * 0.75;
    hand.userData.handRole = handRole;
    pivot.add(hand);
    hands[handRole] = hand;
    return pivot;
  }
  const armL = buildArmPivot(-1, 'handL');
  const armR = buildArmPivot(1, 'handR');
  group.add(armL, armR);

  // Head
  const headY = legHeight + bodyHeight + headRadius * 0.85;
  const headGeo = faceShapeGeometry(faceShape, headRadius);
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = headY;
  head.castShadow = true;
  group.add(head);

  // Eyes
  const eyeMat = new THREE.MeshStandardMaterial({ color: eyeColor });
  const eyeGeo = new THREE.SphereGeometry(0.06, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.17, headY - 0.02, headRadius * 0.85);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.17;
  group.add(eyeL, eyeR);

  // Hair
  const hair = buildHair(hairStyle, hairMat, headRadius, rng);
  if (hair) {
    hair.position.y = headY;
    group.add(hair);
  }

  // Exposed for the walk-cycle animator (see render/scene.js) to rotate.
  // gaitTable is explicit here for clarity even though updateWalkCycle
  // already defaults to GAIT_TABLES.biped when it's absent — this rig's
  // part names (legL/legR/armL/armR) are exactly what that table expects.
  group.userData.rig = { legL, legR, armL, armR };
  group.userData.hands = hands;
  group.userData.gaitTable = GAIT_TABLES.biped;

  // Weapons last: attachWeapons needs the rig to stamp each arm's hold pose
  // (a bow arm rests extended, a greatsword's arms rest tucked), which the walk
  // cycle then swings around. The loadout itself lives in sim/weaponTypes.js so
  // the game, the editor and any bot resolve a class's weapons identically.
  if (params.classId) {
    const loadout = CLASS_LOADOUTS[params.classId] || {};
    const tint = params.classId === 'priest' ? 0xf0c030 : params.classId === 'mage' ? 0x8a3fc5 : undefined;
    attachWeapons(group.userData.rig, hands, loadout.mainHand ?? null, loadout.offHand ?? null, { tint });
  }

  return group;
}

function faceShapeGeometry(shape, radius) {
  return new THREE.SphereGeometry(radius, 16, 16); // only 'round' remains — see FACE_SHAPES
}

function buildHair(style, mat, headRadius, rng) {
  if (style === 'bald') return null;
  const group = new THREE.Group();
  // Cap radius is generous so it reads as attached to non-spherical face
  // shapes, but the coverage angle (hairlineTheta) must stay well above the
  // eyes — eyes sit almost exactly at head-center height, so anything much
  // past the equator here covers the whole face, not just the scalp.
  const capRadius = headRadius * 1.16;
  const hairlineTheta = Math.PI * 0.42;

  function capMesh(thetaLength = hairlineTheta) {
    return new THREE.Mesh(new THREE.SphereGeometry(capRadius, 14, 10, 0, Math.PI * 2, 0, thetaLength), mat);
  }

  if (style === 'short') {
    group.add(capMesh());
  } else if (style === 'bob') {
    group.add(capMesh(Math.PI * 0.46));
    const sideGeo = new THREE.BoxGeometry(0.09, headRadius * 1.15, 0.24);
    const sideL = new THREE.Mesh(sideGeo, mat);
    sideL.position.set(-headRadius * 0.95, -headRadius * 0.35, 0);
    const sideR = sideL.clone();
    sideR.position.x = headRadius * 0.95;
    group.add(sideL, sideR);
  } else if (style === 'ponytail') {
    group.add(capMesh());
    // A short chain of shrinking spheres drooping down and back from the
    // crown, reading as a bound tail rather than one stiff cone.
    const pos = new THREE.Vector3(0, headRadius * 0.35, -headRadius * 0.85);
    const dir = new THREE.Vector3(0, -0.35, -0.85).normalize();
    let r = 0.16;
    for (let i = 0; i < 5; i++) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mat);
      pos.addScaledVector(dir, r * 1.3);
      ball.position.copy(pos);
      group.add(ball);
      dir.y -= 0.16;
      dir.normalize();
      r = Math.max(0.05, r - 0.024);
    }
  } else if (style === 'spiky') {
    group.add(capMesh(Math.PI * 0.32)); // short base layer so scalp isn't bare between spikes
    const spikeCount = 8;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < spikeCount; i++) {
      // Spread spikes over the upper hemisphere, not just a horizontal ring,
      // and orient each one radially outward from the head center so it
      // reads as pointing "away from the scalp" instead of at a fixed tilt.
      const theta = range(rng, 0.05, 0.42) * Math.PI; // angle from the crown
      const phi = (i / spikeCount) * Math.PI * 2 + range(rng, -0.2, 0.2);
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi)
      );
      const spikeLen = range(rng, 0.28, 0.5);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.075, spikeLen, 6), mat);
      spike.position.copy(dir).multiplyScalar(headRadius * 0.98).addScaledVector(dir, spikeLen * 0.42);
      spike.quaternion.setFromUnitVectors(up, dir);
      group.add(spike);
    }
  }

  return group;
}
