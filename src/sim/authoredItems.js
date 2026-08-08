// src/sim/authoredItems.js
// Editor-authored gear/weapon/quest items — separate from the hardcoded
// materials/consumables in src/sim/items.js, which gathering nodes and
// crafting recipes reference directly by id and shouldn't be disturbed.
// This is authoring-only for now: an item schema, icons, and the World
// Editor UI to create them. Nothing in the live game grants, equips, or
// applies stat effects from these yet — there's no loot system (roadmap
// item #16), no equip slots, and no armor/damage-bonus formula defined in
// combat (src/sim/leveling.js's power multiplier is the only stat scaling
// that currently exists). `statModifiers` is captured on the schema so it
// doesn't need a breaking change later, but it's inert data today.
//
// Revised 2026-07-24 (Item Builder / Equipment / Loot / Merchant plan):
// added armor sub-type, real equip slots, a weapon-catalog reference (so
// equip rules can read hands/slot straight from src/sim/weaponTypes.js
// instead of re-describing them here), consumable usage config, a
// craftable-from-materials recipe (prep work for a future crafting UI —
// nothing consumes this yet, same "authored, not wired" status as
// statModifiers), and a quest-item sell/trade lock.

// Revised 2026-08-07 (Equipment Builder): weapon/armor items gained an
// optional `appearance` (src/sim/gearVisuals.js) — the primitive shapes the
// piece hangs off the wearer's body plus an optional glow. That's what turned
// `tintColor`/`armorType` from "authored, inert" into gear you can actually see
// on a character. It's a field on the SAME item, not a parallel catalog, so a
// piece built in the Equipment Builder is the same row the World Editor's Items
// mode edits, monster loot tables drop, merchants sell and recipes craft.
import { PRIMARY_STAT_IDS } from './statDefs.js';
import { WEAPON_TYPES } from './weaponTypes.js';
import { parseGearAppearance } from './gearVisuals.js';

export const ITEM_TYPES = ['weapon', 'armor', 'consumable', 'quest', 'misc'];
export const ITEM_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

/** Armor sub-type — informational until gear actually renders on a character; drives future icon/tint defaults. */
export const ARMOR_TYPES = ['cloth', 'leather', 'plate'];

/** Where an item can be equipped. Ring/earring are single slot ids — a player has two of each; which physical slot (1 or 2) it lands in is UI-side auto-targeting, not part of the item. */
export const EQUIP_SLOTS = [
  'head', 'neck', 'chest', 'gloves', 'pants', 'shoes',
  'ring', 'earring', 'mainHand', 'offHand',
];

/** Every id a weapon item can reference — src/sim/weaponTypes.js is the single source of truth for hands/slot/family, so equip-rule code (two-handed lockout, shield validation) reads it from there instead of duplicating it here. */
export const WEAPON_TYPE_IDS = WEAPON_TYPES.map((w) => w.id);

/** Stat ids a gear item's statModifiers can target: the six GSE primaries plus a small set of gear-only secondary stats. */
export const ITEM_STAT_IDS = [
  ...PRIMARY_STAT_IDS,
  'armor', 'weaponMinDamage', 'weaponMaxDamage', 'attackSpeed', 'critChance', 'hpRegen', 'mpRegen',
];

export const CONSUMABLE_USAGE_MODES = ['single', 'charges', 'unlimited'];

/** What a consumable's effectTrigger does on use. restoreHealth/restoreMana are instant (just `amount`); buff applies a timed stat modifier (`stat`+`amount`+`durationSeconds`, same shape as src/sim/items.js's hardcoded statBuff). */
export const ITEM_EFFECT_KINDS = ['restoreHealth', 'restoreMana', 'buff'];

/**
 * @typedef {Object} ItemStatModifier
 * @property {string} stat one of ITEM_STAT_IDS
 * @property {number} value
 * @property {boolean} [isPercentage]
 */

/**
 * @typedef {Object} ItemEffectTrigger
 * @property {'restoreHealth'|'restoreMana'|'buff'} kind
 * @property {number} amount
 * @property {string} [stat] buff only — one of skillDefs.js's BUFF_STATS, not re-imported here to avoid a sim->sim coupling neither file otherwise needs
 * @property {number} [durationSeconds] buff only
 */

/**
 * @typedef {Object} ItemUsageConfig
 * @property {string} mode one of CONSUMABLE_USAGE_MODES
 * @property {number} [chargesMax] required when mode === 'charges'
 * @property {number} [cooldownSeconds]
 * @property {ItemEffectTrigger} [effectTrigger]
 */

/**
 * @typedef {Object} ItemCraftRecipe
 * @property {{itemId:string, qty:number}[]} materials
 */

/**
 * @typedef {Object} AuthoredItem
 * @property {string} id
 * @property {string} name
 * @property {'weapon'|'armor'|'consumable'|'quest'|'misc'} type
 * @property {string} [slot] one of EQUIP_SLOTS for weapon/armor; free-text informational for other types
 * @property {'cloth'|'leather'|'plate'} [armorType] armor only
 * @property {string} [weaponTypeId] weapon only — one of WEAPON_TYPE_IDS
 * @property {number} [tintColor] optional hex color (e.g. 0x8a5a3a) — a starting point for whenever equip visuals render, not applied anywhere yet
 * @property {'common'|'uncommon'|'rare'|'epic'|'legendary'} rarity
 * @property {string} [description]
 * @property {string} [iconUrl] path under /assets/icons/, set via the icon upload endpoint
 * @property {number} sellPrice
 * @property {ItemStatModifier[]} [statModifiers]
 * @property {ItemUsageConfig} [usageConfig] consumable only
 * @property {boolean} [questLocked] prevents sell/trade/drop once inventory enforces it
 * @property {ItemCraftRecipe} [craftable]
 * @property {import('./gearVisuals.js').GearAppearance} [appearance] weapon/armor only — how the piece looks ON a wearer (Equipment Builder)
 * @property {string[]} [starterForClasses] class ids this piece is granted to (and auto-equipped on) at character creation
 */

/** @param {any} data @returns {AuthoredItem[]} */
export function parseAuthoredItems(data) {
  if (!Array.isArray(data)) throw new Error('Authored items data must be an array');
  const seenIds = new Set();
  for (const item of data) {
    if (!item || typeof item !== 'object') throw new Error('Each authored item must be an object');
    for (const key of ['id', 'name', 'type', 'rarity']) {
      if (!item[key]) throw new Error(`Authored item missing required field: "${key}" (id: ${item.id || '?'})`);
    }
    const label = `Authored item "${item.id}"`;
    if (!ITEM_TYPES.includes(item.type)) throw new Error(`${label} has unknown type "${item.type}"`);
    if (!ITEM_RARITIES.includes(item.rarity)) throw new Error(`${label} has unknown rarity "${item.rarity}"`);
    if (seenIds.has(item.id)) throw new Error(`Duplicate authored item id: "${item.id}"`);
    seenIds.add(item.id);

    if (item.slot !== undefined && item.slot !== '' && item.type !== 'quest' && item.type !== 'misc' && item.type !== 'consumable') {
      if (!EQUIP_SLOTS.includes(item.slot)) throw new Error(`${label} has unknown slot "${item.slot}"`);
    }
    if (item.armorType !== undefined && !ARMOR_TYPES.includes(item.armorType)) {
      throw new Error(`${label} has unknown armorType "${item.armorType}"`);
    }
    if (item.weaponTypeId !== undefined && !WEAPON_TYPE_IDS.includes(item.weaponTypeId)) {
      throw new Error(`${label} has unknown weaponTypeId "${item.weaponTypeId}"`);
    }
    if (item.statModifiers !== undefined) {
      if (!Array.isArray(item.statModifiers)) throw new Error(`${label} statModifiers must be an array`);
      for (const mod of item.statModifiers) {
        if (!mod || typeof mod !== 'object') throw new Error(`${label} has an invalid statModifiers entry`);
        if (!ITEM_STAT_IDS.includes(mod.stat)) throw new Error(`${label} has a statModifiers entry with unknown stat "${mod.stat}"`);
        if (typeof mod.value !== 'number' || !Number.isFinite(mod.value)) throw new Error(`${label} has a statModifiers entry with a non-numeric value`);
      }
    }
    if (item.usageConfig !== undefined) {
      const cfg = item.usageConfig;
      if (!cfg || typeof cfg !== 'object') throw new Error(`${label} usageConfig must be an object`);
      if (!CONSUMABLE_USAGE_MODES.includes(cfg.mode)) throw new Error(`${label} usageConfig has unknown mode "${cfg.mode}"`);
      if (cfg.mode === 'charges' && !(Number.isInteger(cfg.chargesMax) && cfg.chargesMax > 0)) {
        throw new Error(`${label} usageConfig.mode "charges" requires a positive integer chargesMax`);
      }
      if (cfg.effectTrigger !== undefined) {
        const et = cfg.effectTrigger;
        if (!et || typeof et !== 'object') throw new Error(`${label} usageConfig.effectTrigger must be an object`);
        // Pre-2026-07-24 authored items have no `kind` — `buff` was the only
        // trigger shape that existed, so a bare {stat,amount,durationSeconds}
        // means buff. Inferred here rather than requiring a data migration.
        const kind = et.kind ?? (typeof et.stat === 'string' ? 'buff' : undefined);
        if (!ITEM_EFFECT_KINDS.includes(kind)) throw new Error(`${label} usageConfig.effectTrigger has unknown kind "${et.kind}"`);
        if (typeof et.amount !== 'number' || !Number.isFinite(et.amount)) {
          throw new Error(`${label} usageConfig.effectTrigger amount must be a number`);
        }
        if (kind === 'buff') {
          if (typeof et.stat !== 'string' || !et.stat) throw new Error(`${label} usageConfig.effectTrigger kind "buff" requires a stat`);
          if (typeof et.durationSeconds !== 'number' || et.durationSeconds <= 0) {
            throw new Error(`${label} usageConfig.effectTrigger kind "buff" requires a positive durationSeconds`);
          }
        }
      }
    }
    if (item.appearance !== undefined && item.appearance !== null) {
      if (item.type !== 'weapon' && item.type !== 'armor') {
        throw new Error(`${label} has an appearance but type "${item.type}" is not worn — only weapon/armor render on a body`);
      }
      parseGearAppearance(item.appearance, label);
      // An enchantment glow is a particle effect on a HELD weapon (or shield,
      // which is an off-hand weapon here) — see the GLOW_MODES doc comment in
      // gearVisuals.js for why armor deliberately doesn't get one. Rejected
      // rather than ignored: a glow silently doing nothing is the kind of thing
      // someone spends twenty minutes tuning before noticing.
      if (item.appearance.glow && item.appearance.glow.mode !== 'none' && item.type !== 'weapon') {
        throw new Error(`${label} has an enchantment glow, which only weapons and shields can carry`);
      }
    }
    if (item.starterForClasses !== undefined) {
      if (!Array.isArray(item.starterForClasses) || item.starterForClasses.some((c) => typeof c !== 'string' || !c)) {
        throw new Error(`${label} starterForClasses must be an array of class ids`);
      }
      if (item.type !== 'weapon' && item.type !== 'armor') {
        throw new Error(`${label} has starterForClasses but type "${item.type}" cannot be equipped`);
      }
    }
    if (item.craftable !== undefined) {
      const recipe = item.craftable;
      if (!recipe || typeof recipe !== 'object' || !Array.isArray(recipe.materials)) {
        throw new Error(`${label} craftable must be an object with a materials array`);
      }
      for (const mat of recipe.materials) {
        if (!mat || typeof mat.itemId !== 'string' || !mat.itemId) throw new Error(`${label} has a craftable material missing itemId`);
        if (!Number.isInteger(mat.qty) || mat.qty <= 0) throw new Error(`${label} has a craftable material with a non-positive qty`);
      }
    }
  }
  return data;
}
