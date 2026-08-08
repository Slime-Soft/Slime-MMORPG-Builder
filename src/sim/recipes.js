// src/sim/recipes.js
// The recipe catalog — authored via a World Editor "Recipe Builder" panel
// (recipes/recipes.json, GET/POST /api/recipes, same load/validate/save/.bak
// pattern as items/quests/character-types), replacing src/sim/crafting.js's
// old 5-hardcoded-recipe placeholder entirely. Reagents/output reference
// either src/sim/items.js's hardcoded materials or an authored item id —
// same "authored, not cross-validated against either catalog" status
// src/sim/lootTables.js already documents for the identical situation.

/**
 * The seven crafting professions. TAILORING (cloth) and LEATHERWORKING (hide)
 * are deliberately SEPARATE professions with separate stations — an earlier
 * version folded both into a single "Loom & Tanning Rack" TAILORING entry,
 * which made leatherwork recipes unauthorable.
 *
 * COOKING was missing until 2026-08-07 even though its station prop
 * ('station-campfire', "Campfire & Oven") and its cooking-house building had
 * shipped long before — which meant a food recipe could not be authored and
 * "Cooking" never appeared in the Recipe Builder's profession dropdown or the
 * Events-mode station picker. Adding it here and adding
 * STATION_CAMPFIRE_TIER_1 in craftingStations.js is the whole change: every
 * consumer of this list is data-driven off it.
 */
export const PROFESSIONS = ['BLACKSMITHING', 'WOODWORKING', 'TAILORING', 'LEATHERWORKING', 'JEWELCRAFTING', 'ALCHEMY', 'COOKING'];

export const FAIL_ACTIONS = ['DESTROY_ALL_MATERIALS', 'DESTROY_PERCENTAGE', 'KEEP_MATERIALS_LOSS_ENERGY'];

/**
 * @typedef {Object} RecipeReagent
 * @property {string} itemId
 * @property {number} quantity
 */

/**
 * @typedef {Object} RecipeOutput
 * @property {string} itemId
 * @property {number} yieldMin
 * @property {number} yieldMax
 * @property {number} successChancePercent 0..100
 * @property {number} critChancePercent 0..100
 * @property {string} [critOutputItemId] if set and a crit lands, this replaces the normal output entirely rather than doubling yield
 */

/**
 * @typedef {Object} RecipeDef
 * @property {string} id
 * @property {string} name
 * @property {string} profession one of PROFESSIONS
 * @property {string} [category] freeform grouping label for the recipe-browser UI (e.g. "Weapons", "Heavy Armor")
 * @property {number} requiredSkillLevel
 * @property {string} requiredStationTypeId one of src/sim/craftingStations.js's CRAFTING_STATION_TYPES ids
 * @property {number} craftingTimeSeconds
 * @property {number} expReward profession XP granted on a successful craft
 * @property {RecipeReagent[]} reagents
 * @property {RecipeOutput} output
 * @property {'DESTROY_ALL_MATERIALS'|'DESTROY_PERCENTAGE'|'KEEP_MATERIALS_LOSS_ENERGY'} failAction
 * @property {number} [failDestroyPercent] required when failAction === 'DESTROY_PERCENTAGE', 0..100 (percent of each reagent destroyed on failure; the rest is refunded)
 */

/** @param {any} data @returns {RecipeDef[]} */
export function parseRecipeDefs(data) {
  if (!Array.isArray(data)) throw new Error('Recipes data must be an array');
  const seenIds = new Set();
  for (const recipe of data) {
    if (!recipe || typeof recipe !== 'object') throw new Error('Each recipe must be an object');
    const label = `Recipe "${recipe.id || '?'}"`;
    for (const key of ['id', 'name', 'profession', 'requiredStationTypeId', 'reagents', 'output', 'failAction']) {
      if (recipe[key] === undefined) throw new Error(`${label} missing required field: "${key}"`);
    }
    if (seenIds.has(recipe.id)) throw new Error(`Duplicate recipe id: "${recipe.id}"`);
    seenIds.add(recipe.id);

    if (!PROFESSIONS.includes(recipe.profession)) throw new Error(`${label} has unknown profession "${recipe.profession}"`);
    if (typeof recipe.requiredStationTypeId !== 'string' || !recipe.requiredStationTypeId) {
      throw new Error(`${label} requiredStationTypeId must be a non-empty string`);
    }
    if (!Number.isFinite(recipe.requiredSkillLevel) || recipe.requiredSkillLevel < 1) {
      throw new Error(`${label} requiredSkillLevel must be a positive number`);
    }
    if (!Number.isFinite(recipe.craftingTimeSeconds) || recipe.craftingTimeSeconds < 0) {
      throw new Error(`${label} craftingTimeSeconds must be a non-negative number`);
    }
    if (!Number.isFinite(recipe.expReward) || recipe.expReward < 0) {
      throw new Error(`${label} expReward must be a non-negative number`);
    }
    if (!Array.isArray(recipe.reagents) || !recipe.reagents.length) {
      throw new Error(`${label} reagents must be a non-empty array`);
    }
    for (const r of recipe.reagents) {
      if (!r || typeof r.itemId !== 'string' || !r.itemId) throw new Error(`${label} has a reagent missing itemId`);
      if (!Number.isInteger(r.quantity) || r.quantity <= 0) throw new Error(`${label} has a reagent with a non-positive quantity`);
    }
    const out = recipe.output;
    if (!out || typeof out !== 'object') throw new Error(`${label} output must be an object`);
    if (typeof out.itemId !== 'string' || !out.itemId) throw new Error(`${label} output missing itemId`);
    if (!Number.isInteger(out.yieldMin) || out.yieldMin < 1) throw new Error(`${label} output.yieldMin must be a positive integer`);
    if (!Number.isInteger(out.yieldMax) || out.yieldMax < out.yieldMin) throw new Error(`${label} output.yieldMax must be an integer >= yieldMin`);
    if (!Number.isFinite(out.successChancePercent) || out.successChancePercent < 0 || out.successChancePercent > 100) {
      throw new Error(`${label} output.successChancePercent must be 0..100`);
    }
    if (!Number.isFinite(out.critChancePercent) || out.critChancePercent < 0 || out.critChancePercent > 100) {
      throw new Error(`${label} output.critChancePercent must be 0..100`);
    }
    if (out.critOutputItemId !== undefined && (typeof out.critOutputItemId !== 'string' || !out.critOutputItemId)) {
      throw new Error(`${label} output.critOutputItemId must be a non-empty string if set`);
    }

    if (!FAIL_ACTIONS.includes(recipe.failAction)) throw new Error(`${label} has unknown failAction "${recipe.failAction}"`);
    if (recipe.failAction === 'DESTROY_PERCENTAGE') {
      if (!Number.isFinite(recipe.failDestroyPercent) || recipe.failDestroyPercent < 0 || recipe.failDestroyPercent > 100) {
        throw new Error(`${label} failAction "DESTROY_PERCENTAGE" requires failDestroyPercent 0..100`);
      }
    }
    if (recipe.category !== undefined && typeof recipe.category !== 'string') {
      throw new Error(`${label} category must be a string`);
    }
  }
  return data;
}

/** @param {RecipeDef[]} recipes @param {string} recipeId */
export function findRecipeDef(recipes, recipeId) {
  const def = recipes.find((r) => r.id === recipeId);
  if (!def) throw new Error(`Unknown recipe: "${recipeId}"`);
  return def;
}

/** Pure affordability check — mirrors the old crafting.js's canCraft. */
export function canAffordReagents(inventory, recipe) {
  return recipe.reagents.every((r) => (inventory[r.itemId] || 0) >= r.quantity);
}
