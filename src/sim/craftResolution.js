// src/sim/craftResolution.js
// The actual craft-execution logic: profession-level gate, reagent
// check/deduct, success/crit rolls, fail-action branching, output + XP
// grant. Pure and server-callable only for its randomness (rng is threaded
// in, never reached for internally) — same "sim computes, caller owns the
// live rng" contract as src/sim/lootTables.js's rollLootTable.
//
// Deliberately replaces src/sim/crafting.js's old canCraft/craft entirely —
// that module was a 5-recipe placeholder with no profession/station/level/
// success/crit/EXP concept at all.

import { chance, rangeInt } from './rng.js';
import { canAffordReagents } from './recipes.js';
import { grantProfessionXp } from './professionLeveling.js';
import { isWithinRange } from './tower.js';

const CRAFT_STATION_RANGE = 5; // same idiom/scale as NPC_TALK_RANGE/EVENT_MERCHANT_RANGE in server/index.js

/**
 * Whether `player` can currently use `recipe` at whatever crafting station
 * they last opened (player.activeCraftingStation, snapshotted by the
 * openCraftingStation event effect — see server/index.js's applyEventEffect).
 * Pure and testable in isolation from the socket handler, mirroring how
 * event-merchant validation works.
 * @param {{activeCraftingStation?: {stationTypeId:string, openedAt:{x,y,z}}, position:{x,y,z}}} player
 * @param {import('./recipes.js').RecipeDef} recipe
 * @param {Record<string, import('./craftingStations.js').CraftingStationTypeDef>} stationTypeDefs
 * @returns {{ok:true} | {ok:false, reason:'no-station-open'|'wrong-station'|'too-far'}}
 */
export function canUseStationForRecipe(player, recipe, stationTypeDefs) {
  const station = player.activeCraftingStation;
  if (!station) return { ok: false, reason: 'no-station-open' };
  if (station.stationTypeId !== recipe.requiredStationTypeId) return { ok: false, reason: 'wrong-station' };
  if (!stationTypeDefs[station.stationTypeId]) return { ok: false, reason: 'wrong-station' };
  if (!isWithinRange(player.position, station.openedAt, CRAFT_STATION_RANGE)) return { ok: false, reason: 'too-far' };
  return { ok: true };
}

/**
 * Resolves one craft attempt. Deducts reagents up front (spec's "Deduct
 * Required Reagents" step 1) regardless of outcome, then branches on
 * failAction for what a failed roll refunds.
 * @param {{inventory:Object<string,number>, professions:Object<string,{level,xp}>}} player
 * @param {import('./recipes.js').RecipeDef} recipe
 * @param {() => number} rng
 * @returns {{ok:true, inventory, professions, crit:boolean, outputItemId:string, yieldQty:number, xpGained:number, levelsGained:number}
 *         | {ok:false, reason:'level-too-low'|'insufficient-reagents'|'craft-failed', inventory?}}
 */
export function resolveCraft(player, recipe, rng) {
  if (typeof rng !== 'function') throw new Error('resolveCraft requires an rng (see src/sim/rng.js)');

  const profState = player.professions[recipe.profession];
  if (!profState || profState.level < recipe.requiredSkillLevel) {
    return { ok: false, reason: 'level-too-low' };
  }
  if (!canAffordReagents(player.inventory, recipe)) {
    return { ok: false, reason: 'insufficient-reagents' };
  }

  const inventory = { ...player.inventory };
  for (const r of recipe.reagents) inventory[r.itemId] -= r.quantity;

  const succeeded = chance(rng, recipe.output.successChancePercent / 100);
  if (!succeeded) {
    if (recipe.failAction === 'DESTROY_PERCENTAGE') {
      const keepFraction = 1 - recipe.failDestroyPercent / 100;
      for (const r of recipe.reagents) {
        inventory[r.itemId] = (inventory[r.itemId] || 0) + Math.floor(r.quantity * keepFraction);
      }
    } else if (recipe.failAction === 'KEEP_MATERIALS_LOSS_ENERGY') {
      // No separate "energy" resource pool exists in this project today —
      // the faithful reading is "materials are safe, crafting time was
      // still spent," so every reagent is refunded in full.
      for (const r of recipe.reagents) inventory[r.itemId] = (inventory[r.itemId] || 0) + r.quantity;
    }
    // DESTROY_ALL_MATERIALS: reagents already deducted above, nothing further to do.
    return { ok: false, reason: 'craft-failed', inventory };
  }

  const crit = chance(rng, recipe.output.critChancePercent / 100);
  let outputItemId = recipe.output.itemId;
  let yieldQty = rangeInt(rng, recipe.output.yieldMin, recipe.output.yieldMax);
  if (crit) {
    if (recipe.output.critOutputItemId) {
      outputItemId = recipe.output.critOutputItemId;
    } else {
      yieldQty *= 2;
    }
  }
  inventory[outputItemId] = (inventory[outputItemId] || 0) + yieldQty;

  const { state: newProfState, levelsGained } = grantProfessionXp(profState, recipe.expReward);
  const professions = { ...player.professions, [recipe.profession]: newProfState };

  return {
    ok: true, inventory, professions, crit, outputItemId, yieldQty, xpGained: recipe.expReward, levelsGained,
  };
}
