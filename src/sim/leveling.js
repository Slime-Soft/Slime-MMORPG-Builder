// src/sim/leveling.js
// Pure XP/leveling curve + per-class stat growth. No DOM/rendering/server
// dependencies — the same math runs client-side (for instant XP-bar/level-up
// feedback) and server-side (which has the final say on stat values).
import { getClassDef } from './classes.js';
import { totalStats, computeDerivedStats, zeroStats } from './statDefs.js';

export const MAX_LEVEL = 50;

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level) {
  return Math.round(50 * Math.pow(level, 1.6));
}

/** @returns {{level:number, xp:number}} */
export function initLevelState() {
  return { level: 1, xp: 0 };
}

/**
 * Apply an XP gain, rolling over as many level-ups as the amount covers.
 * Pure — returns a new state plus how many levels were gained, so the
 * caller (server) can decide what a level-up triggers (heal, broadcast, etc).
 * @param {{level:number, xp:number}} state
 * @param {number} amount
 * @returns {{ state: {level:number, xp:number}, levelsGained: number }}
 */
export function grantXp(state, amount) {
  let { level, xp } = state;
  let levelsGained = 0;
  xp += amount;
  while (level < MAX_LEVEL) {
    const needed = xpForLevel(level);
    if (xp < needed) break;
    xp -= needed;
    level += 1;
    levelsGained += 1;
  }
  if (level >= MAX_LEVEL) xp = 0;
  return { state: { level, xp }, levelsGained };
}

/** Max HP for a class at a given level from the pre-GSE curve alone — base + per-level growth, both per-class (see CLASSES in classes.js). Kept as-is for callers that don't have stat-allocation state handy; computeCharacterDerivedStats below is the real, stat-aware number. */
export function maxHealthForLevel(classId, level) {
  const def = getClassDef(classId);
  return Math.round(def.baseHealth + def.healthPerLevel * (level - 1));
}

/** Outgoing ability power multiplier from level — same curve for every class, applied on top of each ability's base `power`. */
export function powerMultiplierForLevel(level) {
  return 1 + (level - 1) * 0.06;
}

/**
 * The one function that combines a class's pre-GSE health/power curve with
 * the Global Stat Engine (src/sim/statDefs.js) — every player-facing combat
 * number (maxHealth, resource pool, physPower/spellPower for damage, crit/
 * dodge chance, passive regen) comes from here, so the Character Sheet
 * preview and the server's authoritative apply can never disagree.
 *
 * `allocatedStats`/`buffStats` default to a zero map so a character with no
 * points spent yet (or not loaded through the stat system at all) still
 * gets a correct answer — just the class's raw baseStats plugged into the
 * GSE, on top of the untouched pre-GSE health curve.
 *
 * `gearStats` (src/sim/equipment.js's computeGearStatBonus — the six GSE
 * primaries plus armor/weaponMinDamage/weaponMaxDamage/attackSpeed/
 * critChance/hpRegen/mpRegen) folds in on top: the PRIMARY portion feeds
 * `totalStats` exactly like an allocated point or a buff would (so a STR
 * ring genuinely raises physPower through the same formula everything else
 * uses), while the SECONDARY portion (armor, crit, regen) is added flat
 * onto the derived output below, since those aren't primary-stat-derived
 * numbers to begin with. `weaponMinDamage`/`weaponMaxDamage`/`attackSpeed`
 * are carried through for authoring completeness but have no consumer yet
 * — this project has no "weapon damage roll" mechanic (abilities use their
 * own authored `power`), so those three stay inert until one exists.
 * @param {string} classId
 * @param {number} level
 * @param {object} [allocatedStats] PRIMARY_STAT_IDS -> points spent
 * @param {object} [buffStats] PRIMARY_STAT_IDS -> temporary buff total (see getBuffAmount per stat)
 * @param {object} [gearStats] src/sim/equipment.js's computeGearStatBonus output
 */
export function computeCharacterDerivedStats(classId, level, allocatedStats = zeroStats(), buffStats = zeroStats(), gearStats = null) {
  const def = getClassDef(classId);
  const gear = gearStats || {};
  const raw = totalStats(def.baseStats, allocatedStats, buffStats, gear);
  const derived = computeDerivedStats(raw);
  return {
    raw,
    ...derived,
    physDefense: derived.physDefense + (gear.armor || 0),
    critChance: Math.min(0.6, derived.critChance + (gear.critChance || 0)),
    hpRegen: derived.hpRegen + (gear.hpRegen || 0),
    mpRegen: derived.mpRegen + (gear.mpRegen || 0),
    weaponMinDamage: gear.weaponMinDamage || 0,
    weaponMaxDamage: gear.weaponMaxDamage || 0,
    attackSpeedBonus: gear.attackSpeed || 0,
    maxHealth: Math.round(maxHealthForLevel(classId, level) + derived.maxHealthBonus),
    maxResourceBonus: Math.round(derived.maxManaBonus),
  };
}

/**
 * XP a monster is worth. Uses an authored `xpReward` when a monster spawn
 * carries one (World Editor Monsters mode); otherwise falls back to a
 * formula scaled off maxHealth, for monster data that predates that field.
 */
export function xpRewardForMonster(monster) {
  if (typeof monster.xpReward === 'number') return monster.xpReward;
  const base = Math.round(monster.maxHealth * 0.6);
  return monster.isBoss ? base * 3 : base;
}
