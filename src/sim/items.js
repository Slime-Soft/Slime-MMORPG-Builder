// src/sim/items.js
// Raw gathering materials only, for Phase 6. Full gear/weapons/quest items
// with icons is future work — see WORLD_BUILDER_ROADMAP.md. Keeping these
// separate on purpose: materials are a fixed, small, hardcoded set that
// gathering nodes produce, not player/editor-authored content.
//
// `statBuff`/`statPointTome`/`respecScroll` (spec Section 4.1) are the stat-
// system's item hooks — server/index.js's use-item handler is what actually
// applies them. There's no equippable-gear system yet (no item slots), so
// these are consumables only: a temporary elixir (statBuff, applied as the
// same generic 'buff' status effect a skill buff uses — see BUFF_STATS in
// skillDefs.js), a permanent stat-point tome, or a full respec scroll.

export const ITEMS = {
  // Raw materials — gathered, sellable, and craftable into the items below.
  wood: { name: 'Wood', color: 0x8a5a3a, sellPrice: 1 },
  herb: { name: 'Herb', color: 0x4a8a3a, sellPrice: 1 },
  ore: { name: 'Ore', color: 0x8a7a6a, sellPrice: 2 },
  fish: { name: 'Fish', color: 0x4a8ab0, sellPrice: 1 },
  flower: { name: 'Flower', color: 0xd14f9a, sellPrice: 1 },

  // Crafted items — see src/sim/crafting.js for the recipes that produce these.
  planks: { name: 'Planks', color: 0xb98a5a, sellPrice: 4 },
  ingot: { name: 'Ingot', color: 0xc9c9d0, sellPrice: 6 },
  cooked_fish: { name: 'Cooked Fish', color: 0xd9a24f, sellPrice: 3, healAmount: 15 },
  bouquet: { name: 'Bouquet', color: 0xe06fa0, sellPrice: 8 },
  herbal_potion: { name: 'Herbal Potion', color: 0x5ad15a, sellPrice: 5, healAmount: 30 },

  // Stat-system consumables.
  elixir_of_arcane_mind: {
    name: 'Elixir of Arcane Mind', color: 0x8a4fd1, sellPrice: 12,
    statBuff: { stat: 'INT', amount: 15, durationSeconds: 1800 },
  },
  tome_of_eternal_strength: {
    name: 'Tome of Eternal Strength', color: 0xd1b04f, sellPrice: 40,
    statPointTome: true,
  },
  scroll_of_oblivion: {
    name: 'Scroll of Oblivion', color: 0xc9c9ff, sellPrice: 25,
    respecScroll: true,
  },
};

export const ITEM_IDS = Object.keys(ITEMS);

export function getItemDef(itemId) {
  const def = ITEMS[itemId];
  if (!def) throw new Error(`Unknown item: "${itemId}"`);
  return def;
}
