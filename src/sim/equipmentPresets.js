// src/sim/equipmentPresets.js
// Ready-made equipment SETS — two per player class, each a matching helm,
// chest, gloves, pants, shoes and weapon — and the code that turns one into
// ordinary authored items (src/sim/authoredItems.js).
//
// "Ordinary" is the load-bearing word. A preset is not a special kind of item
// with its own rendering path or its own catalog; expanding one produces plain
// rows for items/items.json, indistinguishable from something hand-built in the
// Equipment Builder. That's what makes a preset piece immediately droppable
// from a monster loot table, sellable by a merchant, craftable by a recipe and
// editable in the World Editor's Items mode — all of which read that one
// catalog and none of which know this file exists.
//
// WHY THE SETS ARE GENERATED FROM A STYLE + A PALETTE rather than authored one
// shape at a time. Thirty-six items of hand-placed primitives is ~2000 lines
// nobody will ever re-read, and every one of them would repeat the same
// hard-won offsets — the arm anchor sits 0.34 out so a pauldron has to clear
// 0.115 of shoulder sphere, the torso is only 0.38 deep so a cuirass at 0.44
// reads as armor rather than as a second torso. Those numbers live once, in
// the three STYLES below, and a set is a style plus three colours.
//
// COORDINATES ARE THE BODY'S, NOT THE ITEM'S. Every shape here is positioned in
// its body slot's local space, exactly like the slot's own shapes in
// src/generators/characterPresets.js — which is where the offsets above come
// from and the file to read before changing any number in this one.
import { GLOW_PRESETS, mirrorGearShapes, defaultCoverageFor } from './gearVisuals.js';

/** shape: id, kind, position [x,y,z], scale [x,y,z], color, optional rotation [x,y,z] (deg). Same compact form characterPresets.js uses. */
function sh(id, kind, p, s, color, r) {
  const o = { id, kind, position: { x: p[0], y: p[1], z: p[2] }, scale: { x: s[0], y: s[1], z: s[2] }, color };
  if (r) o.rotation = { x: r[0], y: r[1], z: r[2] };
  return o;
}

/** A part on the right limb plus its mirror on the left — the pair authored once. */
function limbPair(rightRole, leftRole, shapes) {
  return [{ role: rightRole, shapes }, { role: leftRole, shapes: mirrorGearShapes(shapes) }];
}

/**
 * @typedef {Object} GearStyle
 * @property {string} armorType one of authoredItems.js's ARMOR_TYPES
 * @property {(p: {main:number, dark:number, accent:number}) => object} head
 * @property {(p: object) => object} chest
 * @property {(p: object) => object} gloves
 * @property {(p: object) => object} pants
 * @property {(p: object) => object} shoes
 *
 * Each slot function returns `{parts, hideBodyShapes?}` — the body of a
 * GearAppearance minus the glow, which the SET supplies.
 */

/** @type {Record<string, GearStyle>} */
export const GEAR_STYLES = {
  // Full articulated plate. Every piece is a shell a few centimetres proud of
  // the limb it covers, so the body's own silhouette still reads underneath.
  plate: {
    armorType: 'plate',
    head: (p) => ({
      enclosed: true,
      parts: [{ role: 'head', shapes: [
        sh('helmTop', 'box', [0, 0.2, 0], [0.56, 0.24, 0.52], p.main),
        sh('helmBack', 'box', [0, 0, -0.21], [0.54, 0.4, 0.14], p.main),
        sh('cheekL', 'box', [-0.25, -0.02, 0], [0.14, 0.34, 0.54], p.main),
        sh('cheekR', 'box', [0.25, -0.02, 0], [0.14, 0.34, 0.54], p.main),
        sh('nasal', 'box', [0, 0.02, 0.22], [0.06, 0.3, 0.12], p.dark),
        sh('crest', 'wedge', [0, 0.4, 0], [0.09, 0.2, 0.56], p.accent),
      ] }],
    }),
    chest: (p) => ({ parts: [
      { role: 'torso', shapes: [
        sh('cuirass', 'box', [0, 0.02, 0], [0.58, 0.7, 0.44], p.main),
        sh('placket', 'box', [0, 0.02, 0.21], [0.2, 0.56, 0.06], p.dark),
        sh('gorget', 'box', [0, 0.32, 0], [0.44, 0.12, 0.4], p.accent),
      ] },
      // Pauldrons ride the shoulder JOINT, not the chest, so they swing with
      // the arm. 0.34 across clears the 0.23 shoulder sphere underneath.
      ...limbPair('armR', 'armL', [
        sh('pauldron', 'sphere', [0.02, 0.06, 0], [0.34, 0.3, 0.34], p.main),
        sh('pauldronRim', 'cylinder', [0.02, -0.06, 0], [0.33, 0.05, 0.33], p.accent),
      ]),
    ] }),
    gloves: (p) => ({ parts: limbPair('armR', 'armL', [
      sh('bracer', 'cylinder', [0, -0.44, 0], [0.21, 0.18, 0.21], p.main),
      sh('gauntlet', 'box', [0, -0.56, 0.01], [0.19, 0.18, 0.2], p.dark),
      sh('knuckle', 'box', [0, -0.58, 0.09], [0.17, 0.07, 0.06], p.accent),
    ]) }),
    pants: (p) => ({ parts: [
      { role: 'torso', shapes: [sh('tasset', 'box', [0, -0.4, 0.02], [0.54, 0.24, 0.4], p.dark)] },
      ...limbPair('legR', 'legL', [
        // Replaces the body's own `hip`, which this slot hides. Slightly larger
        // than the 0.2 it stands in for, so it still reaches up INTO the torso
        // solid — that overlap is the only thing holding the leg on.
        sh('hipPlate', 'sphere', [0, 0, 0], [0.23, 0.23, 0.23], p.dark),
        sh('cuisse', 'capsule', [0, -0.24, 0], [0.2, 0.46, 0.2], p.main),
        sh('poleyn', 'sphere', [0, -0.42, 0.03], [0.2, 0.15, 0.2], p.accent),
      ]),
    ] }),
    shoes: (p) => ({ parts: limbPair('legR', 'legL', [
      sh('ankle', 'cylinder', [0, -0.4, 0], [0.22, 0.13, 0.22], p.dark),
      sh('sabaton', 'box', [0, -0.5, 0.04], [0.22, 0.18, 0.32], p.main),
      sh('toe', 'wedge', [0, -0.52, 0.19], [0.2, 0.1, 0.08], p.accent, [90, 0, 0]),
    ]) }),
  },

  // Studded leather: straps, buckles and a brimmed cap. Slimmer than plate
  // everywhere.
  leather: {
    armorType: 'leather',
    // Enclosed, like every other head piece here, even though a ranger's cap
    // is not a helmet and leaving a ponytail showing would look better. Hair
    // and headgear are authored to within a centimetre of the same skull —
    // a 0.54-wide hair cap under a 0.56-wide leather one — so anything worn
    // over hair z-fights with it on some body, and there are eight bodies with
    // different skulls to satisfy. An author can still build an open piece:
    // untick the hair rows in the Equipment Builder's Hidden Body Parts list
    // and size the geometry clear of the styles they care about.
    head: (p) => ({ enclosed: true, parts: [{ role: 'head', shapes: [
      sh('cap', 'box', [0, 0.24, 0], [0.62, 0.17, 0.58], p.main),
      sh('capBrim', 'wedge', [0, 0.18, 0.25], [0.5, 0.1, 0.18], p.dark, [90, 0, 0]),
      sh('band', 'box', [0, 0.14, 0], [0.64, 0.06, 0.6], p.accent),
      sh('feather', 'cone', [0.16, 0.37, -0.06], [0.07, 0.26, 0.07], p.accent, [-30, 0, 22]),
    ] }] }),
    chest: (p) => ({ parts: [
      { role: 'torso', shapes: [
        sh('jerkin', 'box', [0, 0.02, 0], [0.56, 0.7, 0.42], p.main),
        sh('strapL', 'box', [-0.13, 0.04, 0.21], [0.09, 0.62, 0.05], p.dark, [0, 0, -10]),
        sh('strapR', 'box', [0.13, 0.04, 0.21], [0.09, 0.62, 0.05], p.dark, [0, 0, 10]),
        sh('buckle', 'box', [0, -0.24, 0.23], [0.11, 0.11, 0.05], p.accent),
      ] },
      ...limbPair('armR', 'armL', [sh('spaulder', 'sphere', [0.02, 0.04, 0], [0.3, 0.22, 0.3], p.dark)]),
    ] }),
    gloves: (p) => ({ parts: limbPair('armR', 'armL', [
      sh('bracer', 'cylinder', [0, -0.43, 0], [0.19, 0.22, 0.19], p.main),
      sh('strap', 'box', [0, -0.43, 0.1], [0.16, 0.2, 0.03], p.accent),
      sh('glove', 'box', [0, -0.56, 0.01], [0.17, 0.16, 0.18], p.dark),
    ]) }),
    pants: (p) => ({ parts: [
      { role: 'torso', shapes: [sh('belt', 'box', [0, -0.25, 0], [0.58, 0.14, 0.44], p.accent)] },
      ...limbPair('legR', 'legL', [
        sh('hipWrap', 'sphere', [0, 0, 0], [0.22, 0.22, 0.22], p.dark),
        sh('legging', 'capsule', [0, -0.24, 0], [0.19, 0.46, 0.19], p.main),
        sh('kneePad', 'box', [0, -0.4, 0.07], [0.16, 0.12, 0.06], p.dark),
      ]),
    ] }),
    shoes: (p) => ({ parts: limbPair('legR', 'legL', [
      sh('bootTop', 'cylinder', [0, -0.38, 0], [0.21, 0.2, 0.21], p.dark),
      sh('boot', 'box', [0, -0.5, 0.04], [0.21, 0.17, 0.31], p.main),
      sh('bootStrap', 'box', [0, -0.44, 0.05], [0.22, 0.04, 0.3], p.accent),
    ]) }),
  },

  // Robes. The chest piece's skirt is a cone flaring over the thighs — the
  // same trick torso-robe uses in characterPresets.js, and the reason a cloth
  // set's pants read as leggings under a robe rather than as trousers.
  cloth: {
    armorType: 'cloth',
    head: (p) => ({
      enclosed: true,
      parts: [{ role: 'head', shapes: [
        sh('hoodTop', 'box', [0, 0.15, -0.02], [0.58, 0.26, 0.6], p.main),
        sh('hoodBack', 'box', [0, -0.02, -0.22], [0.6, 0.34, 0.16], p.main),
        sh('hoodL', 'box', [-0.26, -0.02, -0.01], [0.18, 0.34, 0.58], p.main),
        sh('hoodR', 'box', [0.26, -0.02, -0.01], [0.18, 0.34, 0.58], p.main),
        sh('hoodBrow', 'wedge', [0, 0.2, 0.18], [0.5, 0.18, 0.22], p.accent, [90, 0, 0]),
      ] }],
    }),
    chest: (p) => ({ parts: [
      { role: 'torso', shapes: [
        sh('robe', 'box', [0, 0.02, 0], [0.55, 0.7, 0.41], p.main),
        // Cone, unrotated: the unit cone is already base-down/apex-up, which
        // is skirt-shaped. Flipping it stands it on its point.
        sh('skirt', 'cone', [0, -0.5, 0], [0.88, 0.64, 0.68], p.dark),
        sh('trim', 'box', [0, 0.3, 0.04], [0.46, 0.14, 0.4], p.accent),
        sh('sash', 'box', [0, 0.06, 0.21], [0.13, 0.6, 0.05], p.accent, [0, 0, 12]),
      ] },
      ...limbPair('armR', 'armL', [sh('sleeve', 'sphere', [0.01, 0.03, 0], [0.29, 0.25, 0.29], p.main)]),
    ] }),
    gloves: (p) => ({ parts: limbPair('armR', 'armL', [
      sh('cuff', 'cone', [0, -0.44, 0], [0.32, 0.24, 0.32], p.dark),
      sh('wrap', 'box', [0, -0.56, 0.01], [0.16, 0.15, 0.17], p.main),
      sh('band', 'box', [0, -0.5, 0.01], [0.17, 0.04, 0.18], p.accent),
    ]) }),
    pants: (p) => ({ parts: [
      { role: 'torso', shapes: [sh('cord', 'box', [0, -0.235, 0], [0.56, 0.1, 0.42], p.accent)] },
      ...limbPair('legR', 'legL', [
        sh('hipWrap', 'sphere', [0, 0, 0], [0.22, 0.22, 0.22], p.dark),
        sh('trouser', 'capsule', [0, -0.24, 0], [0.19, 0.46, 0.19], p.main),
      ]),
    ] }),
    shoes: (p) => ({ parts: limbPair('legR', 'legL', [
      sh('slipper', 'box', [0, -0.5, 0.04], [0.2, 0.16, 0.3], p.main),
      sh('strap', 'box', [0, -0.43, 0.02], [0.2, 0.05, 0.25], p.accent),
    ]) }),
  },
};

const glowByName = (id) => GLOW_PRESETS.find((g) => g.id === id)?.glow ?? null;

/**
 * The armor value a single piece of each style is worth, and the chest
 * multiplier. Flat and small on purpose: combat has no mitigation formula yet
 * (see the deferral in ItemBuilder_EquipmentSystem_...Plan.md), so these are
 * readable starting numbers to balance from, not tuned ones.
 */
const STYLE_ARMOR = { plate: 8, leather: 5, cloth: 3 };
const SLOT_ARMOR_WEIGHT = { head: 1, chest: 2, gloves: 0.75, pants: 1.25, shoes: 0.75 };

/**
 * @typedef {Object} EquipmentPresetSet
 * @property {string} id
 * @property {string} name
 * @property {string} classId the class this set is cut for
 * @property {'starter'|'elite'} tier starter sets are granted at character creation; elite sets are builder templates only
 * @property {keyof GEAR_STYLES} style
 * @property {{main:number, dark:number, accent:number}} palette
 * @property {string} primaryStat the class's headline stat, added to every piece
 * @property {{mainHand?:string, offHand?:string}} weapons weapon-type ids from src/sim/weaponTypes.js
 * @property {string|null} glow a GLOW_PRESETS id, or null
 * @property {'common'|'uncommon'|'rare'|'epic'|'legendary'} rarity
 */

/** @type {EquipmentPresetSet[]} */
export const EQUIPMENT_PRESET_SETS = [
  // --- Warrior: heavy plate, greatsword ---
  {
    id: 'warrior-ironclad', name: 'Warrior — Ironclad', classId: 'warrior', tier: 'starter',
    style: 'plate', palette: { main: 0x7c828c, dark: 0x4a4f58, accent: 0xb0402a },
    primaryStat: 'STR', weapons: { mainHand: 'greatsword' }, glow: null, rarity: 'common',
  },
  {
    id: 'warrior-emberforged', name: 'Warrior — Emberforged', classId: 'warrior', tier: 'elite',
    style: 'plate', palette: { main: 0x5a3028, dark: 0x2e1a16, accent: 0xff7a2a },
    primaryStat: 'STR', weapons: { mainHand: 'greatsword' }, glow: 'flame', rarity: 'epic',
  },

  // --- Guardian: plate, sword and shield ---
  {
    id: 'guardian-bulwark', name: 'Guardian — Bulwark', classId: 'guardian', tier: 'starter',
    style: 'plate', palette: { main: 0x9aa0aa, dark: 0x5a606a, accent: 0xd9a92a },
    primaryStat: 'VIT', weapons: { mainHand: 'sword', offHand: 'shield' }, glow: null, rarity: 'common',
  },
  {
    id: 'guardian-dawnward', name: 'Guardian — Dawnward', classId: 'guardian', tier: 'elite',
    style: 'plate', palette: { main: 0xe8e2d0, dark: 0xb9a877, accent: 0xffd479 },
    primaryStat: 'VIT', weapons: { mainHand: 'sword', offHand: 'shield' }, glow: 'holy', rarity: 'epic',
  },

  // --- Mage: robes, staff ---
  {
    id: 'mage-apprentice', name: 'Mage — Apprentice', classId: 'mage', tier: 'starter',
    style: 'cloth', palette: { main: 0x3f6bc5, dark: 0x24406e, accent: 0xd9a92a },
    primaryStat: 'INT', weapons: { mainHand: 'staff' }, glow: null, rarity: 'common',
  },
  {
    id: 'mage-archon', name: 'Mage — Archon', classId: 'mage', tier: 'elite',
    style: 'cloth', palette: { main: 0x2a3f8a, dark: 0x141d4a, accent: 0x6fd8ff },
    primaryStat: 'INT', weapons: { mainHand: 'staff' }, glow: 'frost', rarity: 'epic',
  },

  // --- Warlock: dark robes, staff ---
  {
    id: 'warlock-initiate', name: 'Warlock — Initiate', classId: 'warlock', tier: 'starter',
    style: 'cloth', palette: { main: 0x3c2258, dark: 0x14141a, accent: 0x6a3f9a },
    primaryStat: 'INT', weapons: { mainHand: 'staff' }, glow: null, rarity: 'common',
  },
  {
    id: 'warlock-voidbound', name: 'Warlock — Voidbound', classId: 'warlock', tier: 'elite',
    style: 'cloth', palette: { main: 0x241638, dark: 0x0d0d14, accent: 0x9a5ce8 },
    primaryStat: 'INT', weapons: { mainHand: 'staff' }, glow: 'shadow', rarity: 'epic',
  },

  // --- Priest: vestments, staff ---
  {
    id: 'priest-acolyte', name: 'Priest — Acolyte', classId: 'priest', tier: 'starter',
    style: 'cloth', palette: { main: 0xe8e4d8, dark: 0xb9b4a4, accent: 0x6fa8e8 },
    primaryStat: 'WIS', weapons: { mainHand: 'staff' }, glow: null, rarity: 'common',
  },
  {
    id: 'priest-lightsworn', name: 'Priest — Lightsworn', classId: 'priest', tier: 'elite',
    style: 'cloth', palette: { main: 0xf2f2ee, dark: 0xd9c68a, accent: 0xffd479 },
    primaryStat: 'WIS', weapons: { mainHand: 'staff' }, glow: 'holy', rarity: 'epic',
  },

  // --- Archer: leather, bow ---
  {
    id: 'archer-scout', name: 'Archer — Scout', classId: 'archer', tier: 'starter',
    style: 'leather', palette: { main: 0x6a4a2a, dark: 0x3f2c1a, accent: 0x3f7a3a },
    primaryStat: 'DEX', weapons: { mainHand: 'bow' }, glow: null, rarity: 'common',
  },
  {
    id: 'archer-wildstalker', name: 'Archer — Wildstalker', classId: 'archer', tier: 'elite',
    style: 'leather', palette: { main: 0x24491f, dark: 0x14240f, accent: 0x7ce86a },
    primaryStat: 'DEX', weapons: { mainHand: 'bow' }, glow: 'venom', rarity: 'epic',
  },
];

const SLOT_LABELS = { head: 'Helm', chest: 'Chestpiece', gloves: 'Gauntlets', pants: 'Legguards', shoes: 'Boots' };
const CLOTH_SLOT_LABELS = { head: 'Hood', chest: 'Robe', gloves: 'Gloves', pants: 'Leggings', shoes: 'Shoes' };
const LEATHER_SLOT_LABELS = { head: 'Cap', chest: 'Jerkin', gloves: 'Bracers', pants: 'Leggings', shoes: 'Boots' };
const WEAPON_LABELS = {
  sword: 'Sword', greatsword: 'Greatsword', staff: 'Staff', bow: 'Bow',
  shield: 'Shield', dagger: 'Dagger', axe: 'Axe', mace: 'Mace', wand: 'Wand', spear: 'Spear', crossbow: 'Crossbow',
};

function labelsFor(style) {
  if (style === 'cloth') return CLOTH_SLOT_LABELS;
  if (style === 'leather') return LEATHER_SLOT_LABELS;
  return SLOT_LABELS;
}

/** A set's display name minus the class prefix — "Ironclad" out of "Warrior — Ironclad". */
function setLabel(set) {
  const dash = set.name.indexOf('—');
  return dash === -1 ? set.name : set.name.slice(dash + 1).trim();
}

/**
 * Expand one preset set into the authored items it stands for: five armor
 * pieces plus one item per weapon hand.
 *
 * Deterministic — same set in, same items out, same ids — because the server
 * seeds starter sets on every boot and re-running that must be a no-op rather
 * than accumulating a second copy under fresh ids.
 *
 * @param {EquipmentPresetSet} set
 * @returns {import('./authoredItems.js').AuthoredItem[]}
 */
export function expandPresetSet(set) {
  const style = GEAR_STYLES[set.style];
  if (!style) throw new Error(`Unknown gear style "${set.style}" on preset set "${set.id}"`);
  const glow = set.glow ? glowByName(set.glow) : null;
  const labels = labelsFor(set.style);
  const label = setLabel(set);
  const starterFor = set.tier === 'starter' ? [set.classId] : undefined;
  const items = [];

  for (const slot of ['head', 'chest', 'gloves', 'pants', 'shoes']) {
    const { enclosed, ...built } = style[slot](set.palette);
    const armor = Math.round(STYLE_ARMOR[set.style] * SLOT_ARMOR_WEIGHT[slot]);
    items.push({
      id: `eq_${set.id}_${slot}`,
      name: `${label} ${labels[slot]}`,
      type: 'armor',
      slot,
      armorType: style.armorType,
      rarity: set.rarity,
      description: `Part of the ${set.name.replace(' — ', ' ')} set.`,
      tintColor: set.palette.main,
      sellPrice: set.tier === 'elite' ? 120 : 18,
      statModifiers: [
        { stat: 'armor', value: armor },
        { stat: set.primaryStat, value: set.tier === 'elite' ? 4 : 1 },
      ],
      // Coverage, not decoration: a worn piece REPLACES the class body's own
      // clothing for that slot. Without it the two sets of geometry sit
      // millimetres apart and z-fight — see BODY_COVERAGE_BY_SLOT for the full
      // story. Note there is no `glow` here: an enchantment is a weapon effect
      // (see below), and parseAuthoredItems rejects one on armor outright.
      appearance: {
        ...built,
        hideBodyShapes: defaultCoverageFor(slot, { enclosed }),
        referenceBodyId: set.classId,
      },
      ...(starterFor ? { starterForClasses: starterFor } : {}),
    });
  }

  for (const [hand, weaponTypeId] of Object.entries(set.weapons)) {
    if (!weaponTypeId) continue;
    const isShield = weaponTypeId === 'shield';
    items.push({
      id: `eq_${set.id}_${hand.toLowerCase()}`,
      name: `${label} ${WEAPON_LABELS[weaponTypeId] || weaponTypeId}`,
      type: 'weapon',
      slot: hand,
      weaponTypeId,
      rarity: set.rarity,
      description: `Part of the ${set.name.replace(' — ', ' ')} set.`,
      tintColor: set.palette.accent,
      sellPrice: set.tier === 'elite' ? 200 : 30,
      statModifiers: isShield
        ? [{ stat: 'armor', value: set.tier === 'elite' ? 18 : 10 }]
        : [
          { stat: 'weaponMinDamage', value: set.tier === 'elite' ? 12 : 4 },
          { stat: 'weaponMaxDamage', value: set.tier === 'elite' ? 20 : 7 },
          { stat: set.primaryStat, value: set.tier === 'elite' ? 5 : 2 },
        ],
      // A weapon's mesh is procedural (src/generators/weapon.js), so its
      // appearance carries no parts — only the enchantment, which
      // src/sim/gearVisuals.js's weaponRenderLoadout hands to the weapon builder.
      // This is the ONLY place a set's glow lands: an elite set is a plain
      // armor set plus an enchanted weapon, which is also how the game this
      // borrows from does it.
      ...(glow ? { appearance: { parts: [], glow } } : {}),
      ...(starterFor ? { starterForClasses: starterFor } : {}),
    });
  }

  return items;
}

/**
 * Every item of every STARTER set — what a new character is granted and
 * wearing the moment they spawn (see the starter-kit grant in server/index.js).
 * Elite sets are deliberately excluded: they're templates the Equipment Builder
 * offers as a starting point for authoring, not free epics.
 */
export function starterEquipmentItems() {
  return EQUIPMENT_PRESET_SETS.filter((s) => s.tier === 'starter').flatMap(expandPresetSet);
}

/** Every item of every set, starter and elite alike — what the Equipment Builder's "load preset" list expands from. */
export function allPresetEquipmentItems() {
  return EQUIPMENT_PRESET_SETS.flatMap(expandPresetSet);
}

/**
 * The item ids a given class should start with, resolved against the LIVE
 * catalog rather than against this file.
 *
 * That indirection is the point: `starterForClasses` is a plain field on an
 * authored item, so a designer can retire a preset piece from the starter kit,
 * or promote something they built themselves into it, entirely from the
 * Equipment Builder — without this module (or the server) knowing.
 *
 * @param {import('./authoredItems.js').AuthoredItem[]} items the catalog
 * @param {string} classId
 */
export function starterItemsForClass(items, classId) {
  return (items || []).filter((i) => i.starterForClasses?.includes(classId));
}
