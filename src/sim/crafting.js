// src/sim/crafting.js
// Recipes and the pure logic for checking/applying a craft. Server is the
// only place this should actually mutate an inventory — the client can use
// canCraft() to gray out unaffordable recipes, but never crafts locally.

/**
 * @typedef {Object} RecipeDef
 * @property {string} id
 * @property {string} name
 * @property {Object<string,number>} inputs   itemId -> quantity consumed
 * @property {{itemId:string, quantity:number}} output
 */

export const RECIPES = {
  planks: { id: 'planks', name: 'Planks', inputs: { wood: 2 }, output: { itemId: 'planks', quantity: 1 } },
  ingot: { id: 'ingot', name: 'Ingot', inputs: { ore: 2 }, output: { itemId: 'ingot', quantity: 1 } },
  cooked_fish: { id: 'cooked_fish', name: 'Cooked Fish', inputs: { fish: 1 }, output: { itemId: 'cooked_fish', quantity: 1 } },
  bouquet: { id: 'bouquet', name: 'Bouquet', inputs: { flower: 3 }, output: { itemId: 'bouquet', quantity: 1 } },
  herbal_potion: { id: 'herbal_potion', name: 'Herbal Potion', inputs: { herb: 2 }, output: { itemId: 'herbal_potion', quantity: 1 } },
};

export const RECIPE_IDS = Object.keys(RECIPES);

export function getRecipeDef(recipeId) {
  const def = RECIPES[recipeId];
  if (!def) throw new Error(`Unknown recipe: "${recipeId}"`);
  return def;
}

/** @param {Object<string,number>} inventory @param {string} recipeId @returns {boolean} */
export function canCraft(inventory, recipeId) {
  const recipe = getRecipeDef(recipeId);
  return Object.entries(recipe.inputs).every(([itemId, qty]) => (inventory[itemId] || 0) >= qty);
}

/**
 * Attempt to craft. Pure — returns a new inventory object, never mutates
 * the one passed in, and never crafts partway if inputs are insufficient.
 * @param {Object<string,number>} inventory
 * @param {string} recipeId
 * @returns {{ok:true, inventory:Object<string,number>} | {ok:false, reason:'insufficient-materials'|'unknown-recipe'}}
 */
export function craft(inventory, recipeId) {
  let recipe;
  try {
    recipe = getRecipeDef(recipeId);
  } catch {
    return { ok: false, reason: 'unknown-recipe' };
  }
  if (!canCraft(inventory, recipeId)) {
    return { ok: false, reason: 'insufficient-materials' };
  }

  const next = { ...inventory };
  for (const [itemId, qty] of Object.entries(recipe.inputs)) {
    next[itemId] -= qty;
  }
  next[recipe.output.itemId] = (next[recipe.output.itemId] || 0) + recipe.output.quantity;
  return { ok: true, inventory: next };
}
