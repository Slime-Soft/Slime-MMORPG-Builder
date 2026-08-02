// src/sim/classes.js
// Class metadata (resource type/regen, health curve) + the pure logic that
// governs using an ability (cooldowns, resource cost, resource regen). No
// DOM/rendering dependencies — runs identically on the client (for instant
// feedback) and the server (which has the final say on whether an ability
// actually goes off).
//
// The abilities themselves are NOT hardcoded here anymore — they're authored
// content (see src/sim/skillDefs.js's SkillDef), loaded from skills/skill-
// defs.json and handed in via setSkillCatalog() once, by whoever does the
// actual file/network I/O (server/index.js reads the file; main.js/editor
// fetch it) — src/sim files may not touch node:fs or the network themselves
// (see scripts/check-architecture.mjs). Each class's `abilities` array below
// starts empty and is populated the moment the catalog arrives.
//
// `legacyKind`/`legacyPower` on each SkillDef are a temporary migration
// bridge: server/index.js's resolveAbilityEffect() still reads the old flat
// kind/power shape and hasn't been rewritten to use SkillDef's real
// `effects[]` yet (that's a later phase) — this keeps every ability's
// CURRENT behavior byte-for-byte unchanged until that rewrite lands.

/**
 * @typedef {Object} AbilityDef
 * @property {string} id
 * @property {number} key           hotbar slot, 1-8
 * @property {number} requiredLevel player level this unlocks at (1 = always usable)
 * @property {string} name
 * @property {number} cooldownMs
 * @property {number} cost          resource cost
 * @property {number} windupMs      animation: telegraph before the effect lands
 * @property {number} effectMs      animation: the effect itself
 * @property {number} recoveryMs    animation: recovery before the next action
 * @property {'melee'|'ranged'|'heal'|'buff'} kind
 * @property {string} description
 */

// `baseStats` (src/sim/statDefs.js's PRIMARY_STAT_IDS) are each class's
// level-1 primary attributes — the Global Stat Engine's per-class starting
// point (spec Section 4.3's "Character Class Editor"). Purely additive on
// top of the pre-existing baseHealth/healthPerLevel curve below: a fresh
// level-1 character's maxHealth is baseHealth + VIT*10 (see
// leveling.js's computeCharacterDerivedStats), so these numbers only ever
// push a class's effective health/power up from what it already was, never
// down. Archetypes: Guardian/Warrior lean STR+VIT, Mage/Priest lean INT+WIS,
// Archer leans AGI+DEX.
export const CLASSES = {
  guardian: {
    name: 'Guardian', resourceType: 'stamina', maxResource: 100, regenPerSecond: 8,
    baseHealth: 140, healthPerLevel: 14, abilities: [],
    baseStats: { STR: 14, AGI: 8, DEX: 8, INT: 4, WIS: 6, VIT: 20 },
  },
  warrior: {
    name: 'Warrior', resourceType: 'rage', maxResource: 100, regenPerSecond: 5,
    baseHealth: 115, healthPerLevel: 11, abilities: [],
    baseStats: { STR: 18, AGI: 10, DEX: 10, INT: 3, WIS: 4, VIT: 16 },
  },
  mage: {
    name: 'Mage', resourceType: 'mana', maxResource: 100, regenPerSecond: 6,
    baseHealth: 75, healthPerLevel: 6, abilities: [],
    baseStats: { STR: 3, AGI: 6, DEX: 6, INT: 20, WIS: 12, VIT: 8 },
  },
  archer: {
    name: 'Archer', resourceType: 'focus', maxResource: 100, regenPerSecond: 7,
    baseHealth: 90, healthPerLevel: 8, abilities: [],
    baseStats: { STR: 8, AGI: 18, DEX: 16, INT: 6, WIS: 6, VIT: 10 },
  },
  priest: {
    name: 'Priest', resourceType: 'mana', maxResource: 100, regenPerSecond: 6,
    baseHealth: 85, healthPerLevel: 7, abilities: [],
    baseStats: { STR: 4, AGI: 6, DEX: 6, INT: 12, WIS: 20, VIT: 10 },
  },
};

export const CLASS_IDS = Object.keys(CLASSES);

/**
 * Populates every class's `abilities[]` from a loaded SkillDef catalog
 * (src/sim/skillDefs.js's parseSkillDefs output) — call once, right after
 * fetching/reading it. Skills with no matching classId/key (custom/unassigned
 * skills, once the Skill Builder can author those) are simply not bound to a
 * hotbar slot; nothing else reads them yet.
 * @param {import('./skillDefs.js').SkillDef[]} skills
 */
export function setSkillCatalog(skills) {
  for (const classId of CLASS_IDS) CLASSES[classId].abilities = [];
  for (const skill of skills) {
    if (!skill.classId || !CLASSES[skill.classId]) continue;
    CLASSES[skill.classId].abilities.push({
      id: skill.id,
      key: skill.key,
      requiredLevel: skill.requiredLevel || 1,
      name: skill.name,
      cooldownMs: skill.cooldownMs,
      cost: skill.resourceCost,
      windupMs: skill.animation.windupMs,
      effectMs: skill.animation.effectMs,
      recoveryMs: skill.animation.recoveryMs,
      kind: skill.legacyKind,
      power: skill.legacyPower,
      description: skill.description,
      // Real VFX/attack-clip data, passed through untouched for the render
      // layer (src/render/scene.js's triggerAbilityAnimation) — everything
      // above this line is the legacy flat shape resolveAbilityEffect still
      // reads server-side; this is client-rendering-only.
      vfx: skill.vfx,
      attackClipId: skill.animation.attackClipId,
      timeline: skill.animation.timeline,
      targeting: skill.targeting,
      icon: skill.icon,
      soundUrl: skill.soundUrl,
      // Client-display-only (Skill Book rank suffix, see effectiveRankForLevel
      // in skillDefs.js) — the server applies the actual scaled numbers
      // itself via effectiveEffectsForLevel, not from this passthrough.
      levelUpgrades: skill.levelUpgrades,
    });
  }
  for (const classId of CLASS_IDS) CLASSES[classId].abilities.sort((a, b) => a.key - b.key);
}

export function getClassDef(classId) {
  const def = CLASSES[classId];
  if (!def) throw new Error(`Unknown class: "${classId}"`);
  return def;
}

export function getAbilityDef(classId, abilityId) {
  const def = getClassDef(classId);
  const ability = def.abilities.find((a) => a.id === abilityId);
  if (!ability) throw new Error(`Unknown ability "${abilityId}" for class "${classId}"`);
  return ability;
}

export function getAbilityByKey(classId, key) {
  const def = getClassDef(classId);
  const ability = def.abilities.find((a) => a.key === key);
  if (!ability) throw new Error(`Class "${classId}" has no ability bound to key ${key}`);
  return ability;
}

/**
 * @typedef {Object} AbilityState
 * @property {string} classId
 * @property {number} resource                       current resource amount
 * @property {Object<string,number>} cooldownEndsAt   abilityId -> ms timestamp when usable again
 */

/** @param {string} classId @returns {AbilityState} */
export function initAbilityState(classId) {
  const def = getClassDef(classId);
  return { classId, resource: def.maxResource, cooldownEndsAt: {} };
}

/** Advance resource regen. Pure — returns a new state, doesn't mutate. */
export function tickResourceRegen(state, dtSeconds) {
  const def = getClassDef(state.classId);
  const resource = Math.min(def.maxResource, state.resource + def.regenPerSecond * dtSeconds);
  return { ...state, resource };
}

/**
 * Attempt to use an ability. Pure function — same inputs always produce the
 * same result, so client prediction and server authority never disagree
 * about whether a given attempt *should* succeed.
 * @param {AbilityState} state
 * @param {string} abilityId
 * @param {number} now ms timestamp
 * @returns {{ok:true, state:AbilityState, ability:AbilityDef} | {ok:false, reason:'cooldown'|'resource'|'unknown-ability', state:AbilityState}}
 */
export function tryUseAbility(state, abilityId, now) {
  let ability;
  try {
    ability = getAbilityDef(state.classId, abilityId);
  } catch {
    return { ok: false, reason: 'unknown-ability', state };
  }

  const readyAt = state.cooldownEndsAt[abilityId] || 0;
  if (now < readyAt) {
    return { ok: false, reason: 'cooldown', state };
  }
  if (state.resource < ability.cost) {
    return { ok: false, reason: 'resource', state };
  }

  const nextState = {
    ...state,
    resource: state.resource - ability.cost,
    cooldownEndsAt: { ...state.cooldownEndsAt, [abilityId]: now + ability.cooldownMs },
  };
  return { ok: true, state: nextState, ability };
}
