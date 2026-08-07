// src/sim/creatureTypeDefs.js
// The one schema behind every posed, rigged body in the game: monsters, NPCs,
// and player characters. Generalized out of the Monster Builder's
// MonsterTypeDef (which is now this, with `kind: 'monster'`).
//
// WHY ONE SCHEMA: a monster, a townsfolk NPC, and a Warrior are the same thing
// wearing different metadata — a stance, a set of body-part slots holding
// primitive shapes, an anchor per slot, and a walk cycle. They diverge only in
// what hangs off that body: a monster has abilities and combat stats, an NPC has
// dialog, a character has a weapon loadout and a class. Modelling them as three
// parallel systems (as this project did until now) means three validators,
// three rig builders, three Model Editors, three part-preset libraries.
//
// A `kind` discriminator gates the per-kind fields. Everything else is shared.
//
// BACK COMPAT: `kind` defaults to 'monster' and every monster-only field stays
// exactly where it was, so the existing monster-types.json parses unchanged and
// src/sim/monsterTypeDefs.js still re-exports the same names. No data migration.
import { SHAPE_KINDS } from './shapeKinds.js';
import { getWeaponTypeDef, validateLoadout } from './weaponTypes.js';
import { validateLootTable } from './lootTables.js';
import { TARGETING_SHAPES, EFFECT_TYPES, DAMAGE_TYPES } from './skillDefs.js';

export const CREATURE_KINDS = ['monster', 'npc', 'character'];
export const CREATURE_STANCES = ['humanoid', 'quadruped'];
export const SLOT_ROLES = [
  'head', 'torso', 'tail',
  'armL', 'armR', 'legL', 'legR',
  // Four leg-PAIR roles (front/mid-front/mid-back/back), each L/R — up to 8
  // independently animated legs. A 4-legged creature (wolf) uses just
  // legFrontL/R + legBackL/R, same as before. A 6-legged insect (ladybug)
  // uses three of the four pairs; an 8-legged one (spider) uses all four.
  // GAIT_TABLES.quadruped in rig.js already has entries for all eight —
  // applyGaitPose skips any part missing from a given rig, so a creature
  // that doesn't use a pair just doesn't animate it, no authoring required.
  'legFrontL', 'legFrontR', 'legMidFrontL', 'legMidFrontR',
  'legMidBackL', 'legMidBackR', 'legBackL', 'legBackR',
];
export const ABILITY_KINDS = ['melee', 'ranged'];
export const ANIM_AXES = ['x', 'y', 'z'];
// The Abilities tab's fixed level ladder — an authoring-UI convention
// borrowed from the reference screenshots, not derived from any player
// leveling constant (a monster "level" here is a balance dial per TYPE,
// not a runtime stat — see configuredLevel below).
export const ABILITY_LEVEL_LADDER = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

/** Which arm slot a hand attach point hangs off. Used by the rig builder. */
export const ARM_ROLES = ['armL', 'armR'];

/**
 * @typedef {Object} ShapeDef
 * @property {string} id
 * @property {'box'|'cylinder'|'sphere'|'cone'|'capsule'|'pyramid'|'wedge'} kind
 * @property {{x:number,y:number,z:number}} position local to the slot's own anchor
 * @property {{x:number,y:number,z:number}|number} [rotation] degrees; a number = Y-axis only
 * @property {{x:number,y:number,z:number}} scale
 * @property {number} [color] hex int
 * @property {number} [opacity] 0..1, default 1 (fully opaque)
 */

/**
 * @typedef {Object} SlotDef
 * @property {string} role one of SLOT_ROLES
 * @property {{x:number,y:number,z:number}} anchor pivot origin, relative to the creature root
 * @property {ShapeDef[]} shapes
 */

/**
 * @typedef {Object} AnimEntry
 * @property {string} part a slot role (any non-torso slot becomes an animatable pivot)
 * @property {'x'|'y'|'z'} axis
 * @property {number} amplitudeDeg peak swing in degrees
 * @property {number} phaseDeg offset within the cycle, degrees (180 = opposite the leading limb)
 */

/**
 * @typedef {Object} PoseKeyframe
 * @property {number} t 0..1, position within the clip (first/last keyframe of a track should be 0/1)
 * @property {{x:number,y:number,z:number}} [position] offset ADDED to the part's rest anchor
 * @property {{x:number,y:number,z:number}} [rotation] degrees, ADDED to the part's base rotation
 * @property {{x:number,y:number,z:number}} [scale] multiplier per axis, default 1
 */

/**
 * @typedef {Object} PoseTimelineEvent
 * @property {'pose'} type
 * @property {number} atMs
 * @property {string} part a slot role — the smallest animatable unit is a whole slot's pivot
 * @property {{x:number,y:number,z:number}} rotationDeg
 */

/**
 * @typedef {Object} KeyframeClip
 * @property {number} durationMs
 * @property {boolean} [loop] default true (walk/idle loop; attack typically plays once)
 * @property {PoseTimelineEvent[]} timeline
 */

/**
 * @typedef {Object} AbilitySlotDef
 * @property {string} id
 * @property {string} name
 * @property {number} unlockLevel must be one of ABILITY_LEVEL_LADDER
 * @property {number} cooldownMs
 * @property {number} windupMs
 * @property {number} effectMs
 * @property {number} recoveryMs
 * @property {'melee'|'ranged'} kind
 * @property {number} power
 * @property {string} [description]
 */

/**
 * @typedef {Object} CreatureTypeDef
 * @property {string} id
 * @property {string} name
 * @property {'monster'|'npc'|'character'} [kind='monster']
 * @property {'humanoid'|'quadruped'} stance
 * @property {SlotDef[]} slots
 * @property {{walk?: AnimEntry[], walkClip?: KeyframeClip, idleClip?: KeyframeClip, attackClip?: KeyframeClip}} [animation]
 *   `walk` is the procedural sine gait; absent = the generic stance gait. The
 *   `*Clip` fields are hand-authored pose-rotation timelines (Monster
 *   Builder's Timeline (advanced) editor, same pose-event shape the Skill
 *   Builder authors) that take priority over the procedural walk/rest pose,
 *   and over the burst-only attack VFX, when present — see
 *   src/generators/rig.js's applyKeyframeClip. All three are independently optional.
 * @property {string} [previewWeapon] weapon type id shown in the Model Editor preview only
 *
 * monster-only:
 * @property {number} [configuredLevel] authoring dial gating which abilitySlots are active
 * @property {AbilitySlotDef[]} [abilitySlots]
 * @property {Object} [baseStats] maxHealth/damage/speed/aggroRange/attackRange/attackCooldownMs
 * @property {import('./lootTables.js').LootTableEntry[]} [lootTable] drops shared by EVERY spawn of this
 *   type, authored once in the Monster Builder. Combined with a placement's own MonsterSpawnDef.lootTable
 *   (which stays the way to give one particular pack rarer drops) — both roll, neither replaces the other.
 *
 * npc-only:
 * @property {string[]} [dialog] 2-4 short lines
 *
 * character/npc:
 * @property {{mainHand: string|null, offHand: string|null}} [equipment] what it actually holds
 * @property {string[]} [allowedWeaponTypes] which weapon types this type may wield (the
 *   checkbox grid in the reference screenshots). Absent = all of them.
 */

const isObj = (v) => v && typeof v === 'object';

/** Validate the body — the part every kind shares. Throws on the first problem. */
function validateBody(c, label) {
  if (!CREATURE_STANCES.includes(c.stance)) {
    throw new Error(`${label} has unknown stance "${c.stance}"`);
  }
  if (!Array.isArray(c.slots)) throw new Error(`${label} slots must be an array`);
  for (const slot of c.slots) {
    if (!isObj(slot)) throw new Error(`${label} has a non-object slot entry`);
    if (!SLOT_ROLES.includes(slot.role)) throw new Error(`${label} has a slot with unknown role "${slot.role}"`);
    if (!isObj(slot.anchor)) throw new Error(`${label} slot "${slot.role}" missing anchor`);
    if (!Array.isArray(slot.shapes)) throw new Error(`${label} slot "${slot.role}" shapes must be an array`);
    for (const shape of slot.shapes) {
      if (!isObj(shape)) throw new Error(`${label} slot "${slot.role}" has a non-object shape entry`);
      if (!shape.id) throw new Error(`${label} slot "${slot.role}" has a shape missing "id"`);
      if (!SHAPE_KINDS.includes(shape.kind)) throw new Error(`${label} slot "${slot.role}" shape "${shape.id}" has unknown kind "${shape.kind}"`);
      if (!isObj(shape.position)) throw new Error(`${label} slot "${slot.role}" shape "${shape.id}" missing position`);
      if (!isObj(shape.scale)) throw new Error(`${label} slot "${slot.role}" shape "${shape.id}" missing scale`);
      if (shape.opacity !== undefined && (typeof shape.opacity !== 'number' || shape.opacity < 0 || shape.opacity > 1)) {
        throw new Error(`${label} slot "${slot.role}" shape "${shape.id}" opacity must be a number between 0 and 1`);
      }
    }
  }

  if (c.animation !== undefined && c.animation !== null) {
    if (!isObj(c.animation)) throw new Error(`${label} animation must be an object`);
    const walk = c.animation.walk;
    if (walk !== undefined) {
      if (!Array.isArray(walk)) throw new Error(`${label} animation.walk must be an array`);
      for (const e of walk) {
        if (!isObj(e)) throw new Error(`${label} has a non-object animation entry`);
        if (!e.part) throw new Error(`${label} animation entry missing "part"`);
        if (!ANIM_AXES.includes(e.axis)) throw new Error(`${label} animation entry "${e.part}" has invalid axis "${e.axis}"`);
        if (typeof e.amplitudeDeg !== 'number' || typeof e.phaseDeg !== 'number') {
          throw new Error(`${label} animation entry "${e.part}" needs numeric amplitudeDeg/phaseDeg`);
        }
      }
    }
    for (const clipKey of ['walkClip', 'idleClip', 'attackClip']) {
      const clip = c.animation[clipKey];
      if (clip === undefined) continue;
      validateKeyframeClip(clip, `${label} animation.${clipKey}`);
    }
  }
}

function validateVec3(v, label) {
  if (!isObj(v)) throw new Error(`${label} must be an object with x/y/z`);
  for (const axis of ANIM_AXES) {
    if (typeof v[axis] !== 'number') throw new Error(`${label}.${axis} must be a number`);
  }
}

function validateKeyframeClip(clip, label) {
  if (!isObj(clip)) throw new Error(`${label} must be an object`);
  if (typeof clip.durationMs !== 'number' || clip.durationMs <= 0) {
    throw new Error(`${label} needs a positive numeric durationMs`);
  }
  if (clip.loop !== undefined && typeof clip.loop !== 'boolean') {
    throw new Error(`${label} loop must be a boolean`);
  }
  if (!Array.isArray(clip.timeline)) throw new Error(`${label} timeline must be an array`);
  for (const event of clip.timeline) {
    if (!isObj(event)) throw new Error(`${label} has a non-object timeline event`);
    if (event.type !== 'pose') throw new Error(`${label} timeline event must have type "pose"`);
    if (!event.part) throw new Error(`${label} timeline event missing "part"`);
    if (typeof event.atMs !== 'number' || event.atMs < 0) {
      throw new Error(`${label} timeline event "${event.part}" needs a numeric atMs >= 0`);
    }
    validateVec3(event.rotationDeg, `${label} timeline event "${event.part}" rotationDeg`);
  }
}

/** Validate the weapon loadout + the allowed-types allowlist. */
function validateEquipment(c, label) {
  if (c.allowedWeaponTypes !== undefined) {
    if (!Array.isArray(c.allowedWeaponTypes)) throw new Error(`${label} allowedWeaponTypes must be an array`);
    for (const id of c.allowedWeaponTypes) {
      // getWeaponTypeDef (not the static WEAPON_TYPE_IDS snapshot) so a
      // custom uploaded weapon model — registered into the live WEAPON_TYPES/
      // BY_ID at runtime via registerCustomWeaponModels, never in that
      // module-init-time snapshot — validates correctly here too.
      if (!getWeaponTypeDef(id)) throw new Error(`${label} allows unknown weapon type "${id}"`);
    }
  }
  if (c.equipment === undefined || c.equipment === null) return;
  if (!isObj(c.equipment)) throw new Error(`${label} equipment must be an object`);
  const { mainHand = null, offHand = null } = c.equipment;
  const problem = validateLoadout(mainHand, offHand);
  if (problem) throw new Error(`${label} equipment invalid: ${problem}`);
  // An allowlist that doesn't cover what the creature is actually holding is
  // an authoring mistake, not a runtime fallback: fail loudly.
  if (c.allowedWeaponTypes) {
    for (const id of [mainHand, offHand]) {
      if (id && !c.allowedWeaponTypes.includes(id)) {
        throw new Error(`${label} equips "${id}" but does not allow that weapon type`);
      }
    }
  }
}

/**
 * The optional richer half of a monster ability, authored by the Monster
 * Builder's Abilities tab: who it hits and how (`targeting`), what it applies
 * (`effects`), what plays (`vfx`, `timeline`). Deliberately the same vocabulary
 * as a class skill — see src/sim/skillDefs.js — so the two can never drift into
 * two dialects of the same idea. All of it is optional: an ability that only
 * has {id, name, kind, power, cooldownMs} is exactly what shipped before and
 * still validates.
 */
function validateAbilityExtras(ab, label) {
  if (ab.targeting !== undefined) {
    if (!isObj(ab.targeting)) throw new Error(`${label} targeting must be an object`);
    if (ab.targeting.shape !== undefined && !TARGETING_SHAPES.includes(ab.targeting.shape)) {
      throw new Error(`${label} targeting has unknown shape "${ab.targeting.shape}"`);
    }
    if (ab.targeting.range !== undefined && typeof ab.targeting.range !== 'number') {
      throw new Error(`${label} targeting.range must be a number`);
    }
  }
  if (ab.effects !== undefined) {
    if (!Array.isArray(ab.effects)) throw new Error(`${label} effects must be an array`);
    for (const e of ab.effects) {
      if (!isObj(e)) throw new Error(`${label} has a non-object effect entry`);
      if (!EFFECT_TYPES.includes(e.type)) throw new Error(`${label} has an effect with unknown type "${e.type}"`);
      if (e.damageType !== undefined && !DAMAGE_TYPES.includes(e.damageType)) {
        throw new Error(`${label} effect "${e.type}" has unknown damageType "${e.damageType}"`);
      }
    }
  }
  if (ab.vfx !== undefined && !isObj(ab.vfx)) throw new Error(`${label} vfx must be an object`);
  if (ab.timeline !== undefined) {
    if (!Array.isArray(ab.timeline)) throw new Error(`${label} timeline must be an array`);
    for (const event of ab.timeline) {
      if (!isObj(event)) throw new Error(`${label} has a non-object timeline event`);
      if (typeof event.atMs !== 'number' || event.atMs < 0) throw new Error(`${label} timeline event needs a numeric atMs >= 0`);
      // Only `pose` carries a rotation; cast/travel/impact events carry a vfxId
      // and are validated by the VFX layer, not here.
      if (event.type === 'pose') {
        if (!event.part) throw new Error(`${label} pose event missing "part"`);
        validateVec3(event.rotationDeg, `${label} pose event "${event.part}" rotationDeg`);
      }
    }
  }
  for (const key of ['power', 'cooldownMs', 'windupMs', 'effectMs', 'recoveryMs']) {
    if (ab[key] !== undefined && typeof ab[key] !== 'number') throw new Error(`${label} ${key} must be a number`);
  }
}

function validateMonsterFields(c, label) {
  for (const key of ['configuredLevel', 'abilitySlots', 'baseStats']) {
    if (c[key] === undefined || c[key] === null) throw new Error(`${label} missing required field: "${key}"`);
  }
  if (!Array.isArray(c.abilitySlots)) throw new Error(`${label} abilitySlots must be an array`);
  for (const ab of c.abilitySlots) {
    if (!isObj(ab)) throw new Error(`${label} has a non-object ability entry`);
    if (!ab.id) throw new Error(`${label} has an ability missing "id"`);
    if (typeof ab.unlockLevel !== 'number' || !ABILITY_LEVEL_LADDER.includes(ab.unlockLevel)) {
      throw new Error(`${label} ability "${ab.id}" has invalid unlockLevel`);
    }
    if (!ABILITY_KINDS.includes(ab.kind)) throw new Error(`${label} ability "${ab.id}" has unknown kind "${ab.kind}"`);
    validateAbilityExtras(ab, `${label} ability "${ab.id}"`);
  }
  if (!isObj(c.baseStats)) throw new Error(`${label} baseStats must be an object`);
  // Type-level loot: every spawn of this type drops from it. Per-placement
  // loot (MonsterSpawnDef.lootTable, authored in the editor's Monsters mode)
  // is ADDED to this rather than replacing it — see creditKill in
  // server/index.js. Optional, so no migration for catalogs written before it.
  if (c.lootTable !== undefined) validateLootTable(c.lootTable, label);
}

function validateNpcFields(c, label) {
  if (c.dialog !== undefined && !Array.isArray(c.dialog)) {
    throw new Error(`${label} dialog must be an array of strings`);
  }
}

/**
 * Validate an array of creature types. `expectKind` restricts what's allowed in
 * a given catalog file (monster-types.json holds monsters, and so on); omit it
 * to accept any kind.
 * @param {any} data
 * @param {'monster'|'npc'|'character'} [expectKind]
 * @returns {CreatureTypeDef[]}
 */
export function parseCreatureTypeDefs(data, expectKind) {
  if (!Array.isArray(data)) throw new Error('Creature type definitions data must be an array');
  const seenIds = new Set();
  for (const c of data) {
    if (!isObj(c)) throw new Error('Each creature type must be an object');
    for (const key of ['id', 'name', 'stance', 'slots']) {
      if (c[key] === undefined || c[key] === null) {
        throw new Error(`Creature type missing required field: "${key}" (id: ${c.id || '?'})`);
      }
    }
    const kind = c.kind ?? 'monster';
    if (!CREATURE_KINDS.includes(kind)) throw new Error(`Creature type "${c.id}" has unknown kind "${kind}"`);
    if (expectKind && kind !== expectKind) {
      throw new Error(`Creature type "${c.id}" is kind "${kind}" but this catalog holds "${expectKind}"`);
    }

    const label = `${kind[0].toUpperCase()}${kind.slice(1)} type "${c.id}"`;
    validateBody(c, label);
    validateEquipment(c, label);
    if (kind === 'monster') validateMonsterFields(c, label);
    if (kind === 'npc') validateNpcFields(c, label);
    if (c.previewWeapon && !getWeaponTypeDef(c.previewWeapon)) {
      throw new Error(`${label} previewWeapon "${c.previewWeapon}" is not a known weapon type`);
    }

    if (seenIds.has(c.id)) throw new Error(`Duplicate creature type id: "${c.id}"`);
    seenIds.add(c.id);
  }
  return data;
}
