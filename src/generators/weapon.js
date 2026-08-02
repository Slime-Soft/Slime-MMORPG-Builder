// src/generators/weapon.js
// Procedural meshes for every weapon type in src/sim/weaponTypes.js.
//
// LOCAL-SPACE CONVENTION, and every generator below obeys it:
//   - The weapon's ORIGIN (0,0,0) is the grip point — the exact spot the fist
//     closes around. Attaching a weapon to a hand is then just `hand.add(w)`.
//     For a sword that is the hilt; for a staff or spear it is the upper third
//     of the shaft, where a hand actually goes, NOT the shaft's midpoint; for a
//     bow it is the RISER (the middle of the stave), not the middle of the
//     string.
//   - +Y runs up the weapon (toward a staff's orb, a spear's point).
//   - -Y runs down it (toward a sword's tip, a hammer's butt).
//   - +Z is the weapon's "forward"/business face (an axe's edge, a bow's arrow).
//
// COROLLARY: `grip.position` in weaponTypes.js must stay ~zero. It is a nudge
// for wrist clearance, never a mount. If a weapon's tip clips the floor, LEAN
// it (grip.rotationDeg) or shorten the mesh — do NOT slide it up the y axis,
// which lifts the weapon clean out of the hand it is supposed to be held in.
// scripts/check-prefabs.mjs fails a grip offset over 0.05.
//
// These are deliberately primitive-built (no texture/material system yet) —
// enough to read at a glance at chibi scale, and to swing naturally once
// parented to the hand attach point (see src/generators/creatureRig.js).
import * as THREE from 'three';
import { getWeaponTypeDef } from '../sim/weaponTypes.js';
import { buildModelPlaceholder } from './modelLoader.js';

function metalMat(color = 0xc9c9d0) {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.6, roughness: 0.35 });
}
function woodMat(color = 0x6b4a2a) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
}
function glowMat(color) {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 });
}

/**
 * Every weapon casts a shadow and receives none — matching the body it's
 * held by, which creatureRig.js deliberately opts out of shadow reception
 * (see CREATURES_RECEIVE_SHADOWS there for why).
 */
function finish(group) {
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

// How far a shafted weapon (staff, spear) may extend BELOW the grip. The fist
// rests near y=0.6 in root space, so a butt reaching much past this drags on the
// ground at rest. Shafts are sized to the arm, not the other way round.
const SHAFT_BELOW_GRIP = 0.48;

/** A wrapped hilt: the short segment sitting inside the fist, centred on the origin. */
function hilt(length = 0.12, radius = 0.022, color = 0x3a2a1a) {
  const h = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 6), woodMat(color));
  h.position.y = length * 0.15;
  return h;
}

function generateSword() {
  const g = new THREE.Group();
  // Blade length is sized to the chibi arm: the fist rests near y=0.6, so a
  // reach much past 0.6 needs an unnatural lean to clear the ground.
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.015), metalMat());
  blade.position.y = -0.28;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.1, 4), metalMat());
  tip.position.y = -0.54;
  tip.rotation.x = Math.PI;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), metalMat(0x8a8a90));
  guard.position.y = -0.04;
  g.add(blade, tip, guard, hilt());
  return finish(g);
}

function generateGreatsword() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.92, 0.022), metalMat(0xd2d2da));
  blade.position.y = -0.55;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.052, 0.16, 4), metalMat(0xd2d2da));
  tip.position.y = -1.08;
  tip.rotation.x = Math.PI;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.045), metalMat(0x7a7a86));
  guard.position.y = -0.07;
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), metalMat(0x7a7a86));
  pommel.position.y = 0.22;
  g.add(blade, tip, guard, pommel, hilt(0.28, 0.026));
  return finish(g);
}

function generateDagger() {
  const g = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.012), metalMat(0xdadae2));
  blade.position.y = -0.16;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 4), metalMat(0xdadae2));
  tip.position.y = -0.3;
  tip.rotation.x = Math.PI;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.025), metalMat(0x8a8a90));
  guard.position.y = -0.04;
  g.add(blade, tip, guard, hilt(0.09, 0.018));
  return finish(g);
}

function generateAxe() {
  const g = new THREE.Group();
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.5, 6), woodMat());
  haft.position.y = -0.18;
  // Blade sits near the haft's far end, edge facing +Z.
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.02), metalMat(0xb0b0b8));
  head.position.set(0, -0.38, 0.09);
  const edge = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.12, 3), metalMat(0xc9c9d0));
  edge.position.set(0, -0.38, 0.16);
  edge.rotation.set(Math.PI / 2, 0, 0);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.07, 6), metalMat(0x8a8a90));
  collar.position.y = -0.38;
  g.add(haft, collar, head, edge, hilt(0.14, 0.026));
  return finish(g);
}

function generateMace() {
  const g = new THREE.Group();
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.46, 6), woodMat(0x4a3a2a));
  haft.position.y = -0.16;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 8), metalMat(0x9a9aa4));
  head.position.y = -0.42;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.07, 4), metalMat(0xb8b8c0));
    spike.position.set(Math.cos(a) * 0.09, -0.42, Math.sin(a) * 0.09);
    spike.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
    );
    g.add(spike);
  }
  g.add(haft, head, hilt(0.12, 0.024));
  return finish(g);
}

function generateHammer() {
  const g = new THREE.Group();
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.8, 6), woodMat());
  haft.position.y = -0.3;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.17), metalMat(0x8f8f99));
  head.position.y = -0.72;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 6), metalMat(0x6a6a74));
  band.position.y = -0.6;
  g.add(haft, band, head, hilt(0.26, 0.03));
  return finish(g);
}

function generateSpear() {
  const g = new THREE.Group();
  // Origin = where the hand grips. The butt stops at SHAFT_BELOW_GRIP so it
  // clears the ground; the rest of the shaft runs up past the shoulder to the
  // head. Centring the shaft on the origin instead would have the fist
  // clutching the middle of a pole, its butt dragging below the knee.
  const LEN = 1.0;
  const g0 = LEN / 2 - SHAFT_BELOW_GRIP; // shaft centre, relative to the grip
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, LEN, 6), woodMat(0x7a5a34));
  shaft.position.y = g0;
  const top = g0 + LEN / 2;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.22, 4), metalMat(0xd0d0d8));
  head.position.y = top + 0.09;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.06, 6), metalMat(0x8a8a90));
  collar.position.y = top - 0.03;
  g.add(shaft, collar, head);
  return finish(g);
}

function generateStaff(orbColor = 0x8a3fc5) {
  const g = new THREE.Group();
  // Origin = the hand's grip; butt stops short of the ground (see generateSpear).
  const LEN = 0.94;
  const g0 = LEN / 2 - SHAFT_BELOW_GRIP;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.028, LEN, 6), woodMat());
  shaft.position.y = g0;
  const top = g0 + LEN / 2;
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 10), glowMat(orbColor));
  orb.position.y = top + 0.08;
  // Three prongs cradling the orb — reads as a focus rather than a broom.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const prong = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.16, 4), woodMat(0x5a3a1a));
    prong.position.set(Math.cos(a) * 0.055, top + 0.03, Math.sin(a) * 0.055);
    prong.rotation.set(Math.cos(a) * -0.35, 0, Math.sin(a) * 0.35);
    g.add(prong);
  }
  g.add(shaft, orb);
  return finish(g);
}

function generateWand(gemColor = 0x4a9fd9) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.3, 6), woodMat(0x3a2a1a));
  shaft.position.y = 0.1;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.045), glowMat(gemColor));
  gem.position.y = 0.28;
  g.add(shaft, gem);
  return finish(g);
}

function generateBow() {
  const g = new THREE.Group();
  // The bow stands upright in the hand, its belly bulging toward +Z (where the
  // arrow flies) and its string behind, toward the archer.
  //
  // A TorusGeometry lies in XY and its arc always STARTS at angle 0 (+X), so a
  // bare `arc` parameter gives a lopsided sweep. Baking a -arc/2 rotation into
  // the geometry re-centres the sweep on +X first; rotating the mesh -90deg
  // about Y then carries +X onto +Z. Get either step backwards and the archer
  // shoots sideways — the classic version of this bug.
  const R = 0.34;
  const ARC = Math.PI * 1.15;
  const limbGeo = new THREE.TorusGeometry(R, 0.018, 6, 16, ARC);
  limbGeo.rotateZ(-ARC / 2);
  const limbs = new THREE.Mesh(limbGeo, woodMat(0x5a3a1a));
  limbs.rotation.y = -Math.PI / 2;

  // THE ORIGIN IS THE RISER, NOT THE TORUS CENTRE. The stave bulges to +Z, so
  // its midpoint — the part a hand actually closes around — sits at z=+R. Leave
  // the torus centred on the origin and the fist grips thin air at the middle
  // of the CHORD, which is to say it grips the bowstring.
  limbs.position.z = -R;

  // The string spans tip to tip. Both tips sit at y = ±R*sin(ARC/2) and
  // z = R*cos(ARC/2) relative to the torus centre — derived, not guessed, so it
  // still lands on the tips if the arc ever changes.
  const halfSpan = R * Math.sin(ARC / 2);
  const stringZ = -R + R * Math.cos(ARC / 2);
  const string = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, halfSpan * 2, 4),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d0 })
  );
  string.position.z = stringZ;

  // The riser wraps the origin, so the fist visibly closes on solid wood.
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 0.07), woodMat(0x3a2a1a));
  g.add(limbs, string, grip);
  return finish(g);
}

function generateCrossbow() {
  const g = new THREE.Group();
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.42), woodMat(0x5a3a1a));
  stock.position.z = 0.1;
  const lath = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.025, 0.03), metalMat(0x7a7a84));
  lath.position.set(0, 0.02, 0.26);
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.48, 4), new THREE.MeshStandardMaterial({ color: 0xe8e0d0 }));
  string.rotation.z = Math.PI / 2;
  string.position.set(0, 0.02, 0.16);
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), woodMat(0x8a6a4a));
  bolt.rotation.x = Math.PI / 2;
  bolt.position.set(0, 0.05, 0.2);
  g.add(stock, lath, string, bolt, hilt(0.1, 0.02));
  return finish(g);
}

function generateShield() {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 12), metalMat(0x5a6a8a));
  face.rotation.z = Math.PI / 2;
  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), metalMat(0x9a9aa4));
  boss.position.x = -0.03;
  boss.scale.x = 0.6;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 16), metalMat(0x8a8a90));
  rim.rotation.y = Math.PI / 2;
  g.add(face, boss, rim);
  return finish(g);
}

/** id -> mesh factory. Keys must exactly cover src/sim/weaponTypes.js's WEAPON_TYPE_IDS. */
const BUILDERS = {
  sword: generateSword,
  greatsword: generateGreatsword,
  dagger: generateDagger,
  axe: generateAxe,
  mace: generateMace,
  hammer: generateHammer,
  spear: generateSpear,
  staff: generateStaff,
  wand: generateWand,
  bow: generateBow,
  crossbow: generateCrossbow,
  shield: generateShield,
};

/**
 * Build one weapon's mesh, already positioned by its grip transform so the
 * caller can parent it straight onto a hand attach point.
 * @param {string} weaponTypeId
 * @param {{tint?: number}} [options] tint recolors a staff orb / wand gem
 * @returns {THREE.Group|null} null for an unknown id
 */
export function generateWeapon(weaponTypeId, options = {}) {
  const def = getWeaponTypeDef(weaponTypeId);
  if (!def) return null;

  let mesh;
  if (def.family === 'custom') {
    // An uploaded FBX/GLB (src/sim/weaponTypes.js's registerCustomWeaponModels)
    // instead of a procedural BUILDERS factory — buildModelPlaceholder returns
    // a wireframe box immediately if the model hasn't finished loading yet,
    // same as every other consumer of it (src/generators/modelLoader.js).
    mesh = buildModelPlaceholder(def.modelId);
  } else {
    const build = BUILDERS[weaponTypeId];
    if (!build) return null;
    mesh = options.tint !== undefined && (weaponTypeId === 'staff' || weaponTypeId === 'wand')
      ? build(options.tint)
      : build();
  }

  const { position, rotationDeg } = def.grip;
  mesh.position.set(position.x, position.y, position.z);
  mesh.rotation.set(
    (rotationDeg.x * Math.PI) / 180,
    (rotationDeg.y * Math.PI) / 180,
    (rotationDeg.z * Math.PI) / 180
  );
  mesh.userData.weaponTypeId = weaponTypeId;
  return mesh;
}
