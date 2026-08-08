// src/sim/professionLeveling.js
// Profession XP/leveling curve — same shape as src/sim/leveling.js's
// character-level curve (xpForLevel/initLevelState/grantXp), but a
// deliberately separate instance: professions go to level 300 (spec's
// section 6.2 example shows a level-182-of-300 Alchemy state) while
// characters cap at 50 (leveling.js's MAX_LEVEL), and a player tracks ALL
// of these independently (one per PROFESSIONS entry in recipes.js), so
// reusing leveling.js's single {level,xp} curve/state directly would be
// wrong on both counts.

export const MAX_PROFESSION_LEVEL = 300;

/** XP required to go from `level` to `level + 1`. Flatter exponent than the character curve (1.35 vs 1.6) — 300 levels needs a much gentler climb than 50 to stay reachable through ordinary crafting play. */
export function xpForProfessionLevel(level) {
  return Math.round(20 * Math.pow(level, 1.35));
}

/** @returns {{level:number, xp:number}} */
export function initProfessionState() {
  return { level: 1, xp: 0 };
}

/**
 * Apply an XP gain, rolling over as many level-ups as the amount covers.
 * Identical shape/semantics to leveling.js's grantXp, just against this
 * module's own curve/cap.
 * @param {{level:number, xp:number}} state
 * @param {number} amount
 * @returns {{ state: {level:number, xp:number}, levelsGained: number }}
 */
export function grantProfessionXp(state, amount) {
  let { level, xp } = state;
  let levelsGained = 0;
  xp += amount;
  while (level < MAX_PROFESSION_LEVEL) {
    const needed = xpForProfessionLevel(level);
    if (xp < needed) break;
    xp -= needed;
    level += 1;
    levelsGained += 1;
  }
  if (level >= MAX_PROFESSION_LEVEL) xp = 0;
  return { state: { level, xp }, levelsGained };
}

/** A fresh {PROFESSION_ID: {level,xp}} map for a new player — every profession starts at level 1, so the UI can show every bar from minute one instead of lazily creating them on first use. */
export function initAllProfessions(professionIds) {
  return Object.fromEntries(professionIds.map((id) => [id, initProfessionState()]));
}
