// src/sim/equipment.js
// The equip-slot system: which authored item (src/sim/authoredItems.js) sits
// in which concrete slot on a player, the rules for what can go where, and
// how an equipped loadout turns into a stat bonus. Server-authoritative like
// everything else that touches persistent state — server/index.js's
// equip-item/unequip-item handlers are the only things that ever call
// equipItem/unequipItem for real; the client only mirrors the result.

/** Concrete slots a player actually has. Two of each ring/earring — which
 * physical one (1 or 2) an item lands in is UI-side auto-targeting logic
 * (findAutoTargetSlot below), not something the item itself specifies. */
export const EQUIP_SLOT_IDS = [
  'head', 'neck', 'chest', 'gloves', 'pants', 'shoes',
  'ring1', 'ring2', 'earring1', 'earring2', 'mainHand', 'offHand',
];

/** A concrete slot's underlying item-slot category (src/sim/authoredItems.js's EQUIP_SLOTS) — ring1/ring2 both accept a 'ring' item, earring1/earring2 both accept 'earring'. */
export function baseSlotFor(concreteSlot) {
  if (concreteSlot === 'ring1' || concreteSlot === 'ring2') return 'ring';
  if (concreteSlot === 'earring1' || concreteSlot === 'earring2') return 'earring';
  return concreteSlot;
}

export function initEquipmentState() {
  const out = {};
  for (const slot of EQUIP_SLOT_IDS) out[slot] = null;
  return out;
}

/** Ring/earring auto-targeting (spec: "Slot 1 if empty; if occupied, targets Slot 2 before replacing Slot 1"). Non-ring/earring items have exactly one concrete slot, returned as-is. */
export function findAutoTargetSlot(equipment, baseSlot) {
  if (baseSlot === 'ring') return !equipment.ring1 ? 'ring1' : !equipment.ring2 ? 'ring2' : 'ring1';
  if (baseSlot === 'earring') return !equipment.earring1 ? 'earring1' : !equipment.earring2 ? 'earring2' : 'earring1';
  return baseSlot;
}

/**
 * Can `itemDef` go into `targetSlot` right now? Pure — never mutates
 * `equipment`. `itemDefById`/`weaponTypeById` are the catalogs needed to
 * resolve what's already sitting in the OTHER hand (for the two-handed
 * lockout / shield rule), since that check needs more than just the item
 * being equipped.
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function canEquip(itemDef, targetSlot, equipment, itemDefById, weaponTypeById) {
  if (!itemDef) return { ok: false, reason: 'unknown-item' };
  if (itemDef.type !== 'weapon' && itemDef.type !== 'armor') return { ok: false, reason: 'not-equippable' };
  if (!EQUIP_SLOT_IDS.includes(targetSlot)) return { ok: false, reason: 'unknown-slot' };

  if (itemDef.slot !== baseSlotFor(targetSlot)) return { ok: false, reason: 'wrong-slot' };

  if (itemDef.type === 'weapon') {
    const weaponType = weaponTypeById[itemDef.weaponTypeId];
    if (!weaponType) return { ok: false, reason: 'unknown-weapon-type' };

    if (targetSlot === 'mainHand') {
      if (weaponType.slot === 'off' && weaponType.family === 'shield') return { ok: false, reason: 'shield-must-be-offhand' };
      if (weaponType.hands === 2) {
        // Nothing else to check — equipItem clears offHand for us.
      }
    }
    if (targetSlot === 'offHand') {
      if (weaponType.hands === 2) return { ok: false, reason: 'two-handed-cannot-offhand' };
      if (weaponType.slot === 'main') return { ok: false, reason: 'main-only-weapon' };
      const mainDef = equipment.mainHand ? itemDefById[equipment.mainHand] : null;
      const mainWeaponType = mainDef?.type === 'weapon' ? weaponTypeById[mainDef.weaponTypeId] : null;
      if (mainWeaponType?.hands === 2) return { ok: false, reason: 'main-hand-is-two-handed' };
    }
  }
  return { ok: true };
}

/**
 * Equip `itemId` (already confirmed to exist in inventory by the caller)
 * into `targetSlot`. Returns the new equipment state plus any item id(s)
 * bumped back to inventory (the slot's previous occupant, and — for a 2H
 * main-hand weapon — whatever was in the off hand, since a two-handed
 * weapon can't coexist with anything there).
 * @param {object} equipment current EquipmentState
 * @param {string} itemId
 * @param {import('./authoredItems.js').AuthoredItem} itemDef
 * @param {string} targetSlot one of EQUIP_SLOT_IDS
 * @param {Object<string, import('./authoredItems.js').AuthoredItem>} itemDefById
 * @param {Object<string, import('./weaponTypes.js').WeaponTypeDef>} weaponTypeById
 * @returns {{ok:true, equipment:object, returnedToInventory:string[]}|{ok:false, reason:string}}
 */
export function equipItem(equipment, itemId, itemDef, targetSlot, itemDefById, weaponTypeById) {
  const check = canEquip(itemDef, targetSlot, equipment, itemDefById, weaponTypeById);
  if (!check.ok) return check;

  const next = { ...equipment };
  const returnedToInventory = [];
  if (next[targetSlot]) returnedToInventory.push(next[targetSlot]);

  if (targetSlot === 'mainHand') {
    const weaponType = weaponTypeById[itemDef.weaponTypeId];
    if (weaponType.hands === 2 && next.offHand) {
      returnedToInventory.push(next.offHand);
      next.offHand = null;
    }
  }

  next[targetSlot] = itemId;
  return { ok: true, equipment: next, returnedToInventory };
}

/** Clears `slot`. Returns the removed item id (or null if the slot was already empty). */
export function unequipItem(equipment, slot) {
  const removed = equipment[slot] || null;
  return { equipment: { ...equipment, [slot]: null }, removed };
}

/**
 * Sums every equipped item's statModifiers into one flat bonus object.
 * v1 simplification, stated explicitly: `isPercentage` is captured on the
 * item schema but not yet interpreted differently from a flat value here —
 * true percentage-of-base scaling is future work once this is used enough
 * to matter. Missing keys default to 0 so callers can just add this
 * straight onto whatever they're already computing.
 * @param {object} equipment
 * @param {Object<string, import('./authoredItems.js').AuthoredItem>} itemDefById
 */
export function computeGearStatBonus(equipment, itemDefById) {
  const bonus = {
    STR: 0, AGI: 0, DEX: 0, INT: 0, WIS: 0, VIT: 0,
    armor: 0, weaponMinDamage: 0, weaponMaxDamage: 0, attackSpeed: 0, critChance: 0, hpRegen: 0, mpRegen: 0,
  };
  for (const itemId of Object.values(equipment)) {
    if (!itemId) continue;
    const def = itemDefById[itemId];
    if (!def?.statModifiers) continue;
    for (const mod of def.statModifiers) {
      if (!(mod.stat in bonus)) continue;
      bonus[mod.stat] += mod.value;
    }
  }
  return bonus;
}

/** The mainHand/offHand weapon-type-id pair a rig actually renders — for src/generators/playerCharacter.js's `equipmentOverride`, or null/null if nothing equipped there / not a weapon. */
export function equipmentToWeaponLoadout(equipment, itemDefById) {
  const resolve = (itemId) => {
    const def = itemId ? itemDefById[itemId] : null;
    return def?.type === 'weapon' ? def.weaponTypeId : null;
  };
  return { mainHand: resolve(equipment.mainHand), offHand: resolve(equipment.offHand) };
}
