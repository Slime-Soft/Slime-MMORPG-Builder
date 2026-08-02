// src/sim/lootTables.js
// A monster type's drop table (WORLD_BUILDER_ROADMAP.md item #16) — what it
// drops and at what chance. Deliberately NOT the same shape as
// src/sim/gathering.js's yieldTable: a gathering node's entries are mutually
// exclusive (their chances sum to ~1, exactly one always fires), while a
// monster's loot entries are each rolled INDEPENDENTLY (a kill can drop
// nothing, one item, or several at once), matching the drop-table spec this
// was built from.

import { chance, rangeInt } from './rng.js';

/**
 * @typedef {Object} LootTableEntry
 * @property {string} itemId references either src/sim/items.js's hardcoded
 *   materials or an authored item id (items/items.json) — not cross-validated
 *   against either catalog, same "authored, not enforced" status other
 *   cross-catalog references (quest rewards, craftable materials) already have
 * @property {number} dropChance 0..100 (percent)
 * @property {number} minQty
 * @property {number} maxQty
 * @property {string} [requiresQuestId] quest-gated drop: this entry is only
 *   ROLLED AT ALL while the killing player has that quest in the given phase
 *   (see `requiresQuestPhase`). The classic "the ogres only carry the Sealed
 *   Letter once you've been asked to find it" — without this, a quest item
 *   either litters every inventory forever or has to be handed out by a
 *   script instead of dropping. Not cross-validated against quests.json, same
 *   "authored, not enforced" status `itemId` already has above; an id that
 *   matches no quest simply never passes its gate.
 * @property {'active'|'ready'|'done'} [requiresQuestPhase] default 'active'.
 *   'active' = accepted and not yet handed in (the usual case), 'ready' = the
 *   objective is met but not turned in, 'done' = already completed (for a
 *   post-quest farmable drop).
 */

/** Phases `requiresQuestPhase` accepts — the subset of questPhaseFor's values that a player can actually be standing in while killing something ('offer'/'locked' mean they never took the quest, which is exactly the case a gate exists to exclude). */
export const LOOT_QUEST_PHASES = ['active', 'ready', 'done'];

/** @param {any} data @param {string} label @returns {LootTableEntry[]} */
export function validateLootTable(data, label) {
  if (!Array.isArray(data)) throw new Error(`${label} lootTable must be an array`);
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') throw new Error(`${label} has a non-object lootTable entry`);
    if (typeof entry.itemId !== 'string' || !entry.itemId) throw new Error(`${label} has a lootTable entry missing itemId`);
    if (typeof entry.dropChance !== 'number' || entry.dropChance < 0 || entry.dropChance > 100) {
      throw new Error(`${label} lootTable entry "${entry.itemId}" dropChance must be 0..100`);
    }
    if (!Number.isInteger(entry.minQty) || entry.minQty < 1) {
      throw new Error(`${label} lootTable entry "${entry.itemId}" minQty must be a positive integer`);
    }
    if (!Number.isInteger(entry.maxQty) || entry.maxQty < entry.minQty) {
      throw new Error(`${label} lootTable entry "${entry.itemId}" maxQty must be an integer >= minQty`);
    }
    if (entry.requiresQuestId !== undefined && entry.requiresQuestId !== null && typeof entry.requiresQuestId !== 'string') {
      throw new Error(`${label} lootTable entry "${entry.itemId}" requiresQuestId must be a string`);
    }
    if (entry.requiresQuestPhase !== undefined && !LOOT_QUEST_PHASES.includes(entry.requiresQuestPhase)) {
      throw new Error(`${label} lootTable entry "${entry.itemId}" requiresQuestPhase must be one of ${LOOT_QUEST_PHASES.join('/')}`);
    }
  }
  return data;
}

/**
 * Whether a quest-gated entry may be rolled for this player right now. An
 * ungated entry always passes. A gated one with no `questPhase` lookup
 * available (a bot, or any caller that didn't wire quests up) is skipped
 * rather than dropped freely — a quest item leaking to something that can't
 * hold a quest is the worse failure.
 * @param {LootTableEntry} entry
 * @param {((questId:string) => string)} [questPhase] returns 'offer'|'active'|'ready'|'done'|'locked'
 */
export function lootEntryUnlocked(entry, questPhase) {
  if (!entry.requiresQuestId) return true;
  if (typeof questPhase !== 'function') return false;
  return questPhase(entry.requiresQuestId) === (entry.requiresQuestPhase || 'active');
}

/**
 * Roll every entry in a monster's loot table independently against its own
 * dropChance (0..100). Returns only the entries that hit, each with a
 * rolled quantity in [minQty, maxQty]. Can return an empty array (no drops)
 * or several entries (multiple independent drops on one kill).
 * @param {LootTableEntry[]} lootTable
 * @param {() => number} rng see src/sim/rng.js — caller owns the generator
 * @param {{questPhase?: (questId:string) => string}} [ctx] injected by the
 *   caller (server/index.js) so this module stays decoupled from quests.js's
 *   player-shape specifics — same split events.js's own questPhase hook uses.
 *   Entries carrying `requiresQuestId` are filtered out BEFORE their chance is
 *   rolled, so gating one never perturbs the rng stream of the others.
 * @returns {{itemId:string, qty:number}[]}
 */
export function rollLootTable(lootTable, rng, ctx = {}) {
  if (typeof rng !== 'function') throw new Error('rollLootTable requires an rng (see src/sim/rng.js)');
  if (!Array.isArray(lootTable) || !lootTable.length) return [];
  const drops = [];
  for (const entry of lootTable) {
    if (!lootEntryUnlocked(entry, ctx.questPhase)) continue;
    if (!chance(rng, entry.dropChance / 100)) continue;
    const qty = rangeInt(rng, entry.minQty, entry.maxQty);
    if (qty > 0) drops.push({ itemId: entry.itemId, qty });
  }
  return drops;
}
