// src/render/vfx/anchors.js
// Resolves a skill's vfx.castAnchor/impactAnchor ('hand'|'chest'|'ground'|
// 'target') into something createVfxSystem's spawn() accepts: either a live
// THREE.Object3D (hand/chest — parented onto the caster's rig, so the effect
// follows them) or a plain world position (ground/target — a fixed point at
// the moment of cast/impact, not re-parented to anything moving).
import * as THREE from 'three';

/**
 * @param {THREE.Group} characterGroup the mesh returned by
 *   buildPlayerCharacter/generateMonster (has userData.hands/rig, and its
 *   direct children carry userData.slotRole).
 * @param {'handL'|'handR'} [handRole]
 */
export function getHandAnchor(characterGroup, handRole = 'handR') {
  return characterGroup.userData.hands?.[handRole] || characterGroup;
}

/** The torso pivot — never in userData.rig (see creatureRig.js), so it's
 * found by walking the group's direct children instead. */
export function getChestAnchor(characterGroup) {
  const torso = characterGroup.children.find((c) => c.userData.slotRole === 'torso');
  return torso || characterGroup;
}

/** A fixed world-space point on the ground under `position`. */
export function getGroundAnchor(position) {
  return { x: position.x, y: position.y, z: position.z };
}

/** A fixed world-space point at whatever the skill hit. */
export function getTargetAnchor(position) {
  return { x: position.x, y: position.y + 1, z: position.z };
}

/**
 * A local-space nudge on top of a resolved anchor — e.g. moving a 'hand'
 * anchor out to a staff's tip. For a live Object3D (hand/chest), wraps it in
 * a cached child Group at the offset so it still inherits the parent's
 * transform every frame (the marker moves with the arm as it animates); for
 * a plain world position (ground/target), the offset is just added in.
 * @param {THREE.Object3D|{x:number,y:number,z:number}} base
 * @param {{x:number,y:number,z:number}} offset
 */
export function applyAnchorOffset(base, offset) {
  if (!offset) return base;
  if (base instanceof THREE.Object3D) {
    const key = `__offsetAnchor_${offset.x}_${offset.y}_${offset.z}`;
    if (!base.userData[key]) {
      const group = new THREE.Group();
      group.position.set(offset.x, offset.y, offset.z);
      base.add(group);
      base.userData[key] = group;
    }
    return base.userData[key];
  }
  return { x: base.x + offset.x, y: base.y + offset.y, z: base.z + offset.z };
}

/**
 * @param {'hand'|'chest'|'ground'|'target'} anchorKind
 * @param {{ casterMesh?: THREE.Group, casterPosition?: {x,y,z}, targetPosition?: {x,y,z}, handRole?: 'handL'|'handR' }} ctx
 * @param {{x:number,y:number,z:number}} [offset] see applyAnchorOffset
 * @returns {THREE.Object3D|{x:number,y:number,z:number}}
 */
export function resolveAnchor(anchorKind, ctx, offset) {
  let base;
  switch (anchorKind) {
    case 'hand':
      base = ctx.casterMesh ? getHandAnchor(ctx.casterMesh, ctx.handRole) : getGroundAnchor(ctx.casterPosition);
      break;
    case 'chest':
      base = ctx.casterMesh ? getChestAnchor(ctx.casterMesh) : getGroundAnchor(ctx.casterPosition);
      break;
    case 'target':
      base = getTargetAnchor(ctx.targetPosition || ctx.casterPosition);
      break;
    case 'ground':
    default:
      base = getGroundAnchor(ctx.targetPosition || ctx.casterPosition);
      break;
  }
  return offset ? applyAnchorOffset(base, offset) : base;
}
