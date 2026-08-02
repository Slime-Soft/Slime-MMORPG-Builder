// src/generators/creatureRig.js
// Turns a CreatureTypeDef's slots (src/sim/creatureTypeDefs.js) into a poseable
// mesh + rig — for monsters, NPCs and player characters alike.
//
// Mirrors generateCharacter's pivot convention (src/generators/character.js):
// every slot is a THREE.Group positioned AT the joint, with its shapes hanging
// off it, so rotating the pivot swings the whole limb from the shoulder/hip
// rather than through its own middle.
//
// On top of that this module owns the two things a body needs to hold a weapon:
//   1. HAND ATTACH POINTS — a `handL`/`handR` Group at the far end of each arm
//      pivot. Parenting a weapon there makes it swing with the arm for free.
//   2. HOLD POSES — the arms' resting rotation while carrying that weapon,
//      stamped onto the pivots via setBasePose so the walk cycle swings around
//      it instead of snapping the limb back to rest (see rig.js).
import * as THREE from 'three';
import { buildShapeMesh } from './custom.js';
import { GAIT_TABLES, gaitTableFromAnimation, setBasePose } from './rig.js';
import { generateWeapon } from './weapon.js';
import { handForWeapon, resolveHoldPose, getWeaponTypeDef } from '../sim/weaponTypes.js';

/**
 * The walk cycle a creature type should use: its own authored table if it has
 * one, otherwise the generic gait for its stance. Exported so the editor's
 * preview and the live game resolve it identically.
 */
export function resolveGaitTable(creatureType) {
  const authored = creatureType.animation?.walk;
  if (authored && authored.length) {
    const table = gaitTableFromAnimation(authored);
    if (table.length) return table;
  }
  return GAIT_TABLES[creatureType.stance === 'quadruped' ? 'quadruped' : 'biped'];
}

/**
 * Where the fist sits inside an arm slot's local space.
 *
 * Derived, not authored: it's the CENTRE of whichever of the arm's shapes
 * reaches lowest — that shape is the hand, and its centre is the fist. So a
 * weapon's origin (its grip point) lands inside the closed hand no matter how
 * the author sized the arm; lengthen the forearm and the sword follows.
 *
 * Using the lowest shape's BOTTOM instead would hang the weapon off the
 * underside of the fist. That is invisible on an arm hanging straight down (the
 * sword just sits 7cm low) and glaring the moment the arm is raised, where
 * "below the hand" points forward and the bow appears to float off the fingers.
 *
 * A slot may override the whole thing with `handAnchor` when the shape soup
 * lies (a limb ending in an upturned claw, say).
 *
 * @param {import('../sim/creatureTypeDefs.js').SlotDef} slot
 * @returns {{x:number, y:number, z:number}}
 */
export function handAnchorFor(slot) {
  if (slot.handAnchor) return slot.handAnchor;
  let lowestBottom = Infinity;
  let fist = { x: 0, y: 0, z: 0 };
  for (const shape of slot.shapes) {
    const pos = shape.position ?? { x: 0, y: 0, z: 0 };
    const bottom = (pos.y ?? 0) - (shape.scale?.y ?? 0) / 2;
    if (bottom < lowestBottom) {
      lowestBottom = bottom;
      fist = { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 };
    }
  }
  return lowestBottom === Infinity ? { x: 0, y: 0, z: 0 } : fist;
}

/**
 * @param {import('../sim/creatureTypeDefs.js').CreatureTypeDef} creatureType
 * @param {{ weapon?: {mainHand?: string|null, offHand?: string|null} }} [options]
 *   `weapon` overrides creatureType.equipment — the Model Editor's weapon
 *   preview uses it without mutating the type being authored.
 * @returns {{ group: THREE.Group, rig: Record<string, THREE.Group>, hands: Record<string, THREE.Group> }}
 */
export function buildCreatureRig(creatureType, options = {}) {
  const group = new THREE.Group();
  const rig = {};
  const hands = {};

  for (const slot of creatureType.slots) {
    const pivot = new THREE.Group();
    pivot.position.set(slot.anchor.x, slot.anchor.y, slot.anchor.z);
    // Tagged regardless of animatable-rig membership so editor UI (and
    // anything else) can always find "the pivot for role X" uniformly,
    // torso included, without a separate lookup path.
    pivot.userData.slotRole = slot.role;
    // The rest position a keyframe clip's position offsets add onto (see
    // rig.js's applyKeyframeClip) — stashed separately from pivot.position
    // because a playing clip overwrites pivot.position every frame, so
    // pivot.position itself can't be read back as "the anchor" once
    // animation has run.
    pivot.userData.baseAnchor = { x: slot.anchor.x, y: slot.anchor.y, z: slot.anchor.z };
    for (const shapeDef of slot.shapes) pivot.add(buildShapeMesh(shapeDef));
    group.add(pivot);
    // Torso stays part of the group but isn't a swingable pivot — every
    // other slot role is a candidate rig entry (only actually animated if
    // a gait/attack-pose table references its role).
    if (slot.role !== 'torso') rig[slot.role] = pivot;

    if (slot.role === 'armL' || slot.role === 'armR') {
      const anchor = handAnchorFor(slot);
      const hand = new THREE.Group();
      hand.position.set(anchor.x, anchor.y, anchor.z);
      hand.userData.handRole = slot.role === 'armL' ? 'handL' : 'handR';
      pivot.add(hand);
      hands[hand.userData.handRole] = hand;
    }
  }

  const loadout = options.weapon ?? creatureType.equipment ?? {};
  attachWeapons(rig, hands, loadout.mainHand ?? null, loadout.offHand ?? null);

  applyCreatureShadowFlags(group);

  group.userData.rig = rig;
  group.userData.hands = hands;
  group.userData.gaitTable = resolveGaitTable(creatureType);
  // Hand-authored keyframe clips, resolved once here so every consumer
  // (live game, editor preview) reads them off userData the same way it
  // already reads gaitTable, rather than re-deriving from creatureType.
  group.userData.walkClip = creatureType.animation?.walkClip || null;
  group.userData.idleClip = creatureType.animation?.idleClip || null;
  group.userData.attackClip = creatureType.animation?.attackClip || null;
  return { group, rig, hands };
}

/**
 * Creatures cast shadows onto the world but never receive one — which, with a
 * single shadow map, also means they can't shadow THEMSELVES.
 *
 * Self-shadowing is what this buys off. A creature's parts (hat brim over
 * face, arm over torso) legitimately shadow each other, but the sun's shadow
 * map covers the whole visible world: at the default Shadow Range its texel is
 * ~0.15 m, roughly a chibi limb's thickness. A shadow that small isn't a
 * shape, it's noise — and because a walking creature slides continuously
 * across a texel grid that static scenery is snapped to (see atmosphere.js's
 * snapShadowFocusToTexelGrid), that noise re-rolls every single frame. Measured
 * on a walking player: its own pixels swung 0.79 luminance per frame against a
 * 0.15 floor, and sat at 40% of its lit brightness (14.7 vs 37.2) the whole
 * time. Disabling either casting or receiving removed it identically, which is
 * the signature of a pure self-shadow loop rather than anything in the world
 * shading it.
 *
 * Raising the resolution can't reach it either: the flicker only cleared once
 * the texel got to ~0.04 m, which needs a Shadow Range of ~40 — shadows would
 * stop 40 m out. Cascaded shadow maps are the real answer and are out of scope
 * here (graphicsSettings.js already lists them as not supported).
 *
 * The tradeoff, stated plainly: a creature standing under a tree no longer
 * darkens. Flip this to true to get that back along with the flicker.
 */
const CREATURES_RECEIVE_SHADOWS = false;

function applyCreatureShadowFlags(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = CREATURES_RECEIVE_SHADOWS;
  });
}

/**
 * Hang a loadout's weapons off the hands and pose the arms to carry them.
 * Safe to call on a rig with no arms (a quadruped, a slime): the weapons simply
 * have nowhere to go and the poses find no pivots.
 *
 * Removes whatever the hands were holding first, so this doubles as the
 * equip/unequip path when gear changes at runtime.
 *
 * @param {Record<string, THREE.Group>} rig
 * @param {Record<string, THREE.Group>} hands
 * @param {string|null} mainHandId
 * @param {string|null} offHandId
 * @param {{tint?: number}} [options] recolors a staff orb / wand gem (a priest's
 *   staff glows gold where a mage's glows violet)
 */
export function attachWeapons(rig, hands, mainHandId, offHandId, options = {}) {
  for (const hand of Object.values(hands)) hand.clear();

  for (const id of [mainHandId, offHandId]) {
    const def = id && getWeaponTypeDef(id);
    if (!def) continue;
    const hand = hands[handForWeapon(def)];
    if (!hand) continue; // this body has no such arm
    const mesh = generateWeapon(id, options);
    if (mesh) hand.add(mesh);
  }

  // Reset both arms to a neutral rest, then stamp whatever the loadout wants.
  // Without the reset, unequipping would leave the old hold pose behind.
  for (const role of ['armL', 'armR']) {
    if (rig[role]) setBasePose(rig[role], { x: 0, y: 0, z: 0, swingScale: 1 });
  }
  const pose = resolveHoldPose(mainHandId, offHandId);
  for (const [role, hold] of Object.entries(pose)) {
    if (rig[role]) setBasePose(rig[role], hold);
  }
}
