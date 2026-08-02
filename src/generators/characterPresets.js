// src/generators/characterPresets.js
// Built-in humanoid content for the shared creature schema: the part presets a
// Character/NPC Builder offers per body-part tab, and complete starter bodies
// for the five player classes plus a few townsfolk.
//
// Same role as src/generators/monsterPresets.js, same descriptor shapes
// (src/sim/creatureTypeDefs.js's ShapeDef) rendered by the same buildShapeMesh.
// Split into its own module because the humanoid vocabulary is clothing —
// hoods, robes, pauldrons, boots — and mixing it into the creature-part list
// would bury both.
//
// THE SKELETON IS FIXED AND SHARED (see HUMANOID_ANCHORS). Every part preset is
// authored around its own slot's origin, so any head fits any torso. Two rules
// keep bodies connected — `npm run check:prefabs` fails if you break them:
//   1. A limb slot's anchor sits INSIDE the torso solid, and the limb's first
//      shape is a joint sphere at its own origin (0,0,0).
//   2. Head details (eyes, beards, hats) must interpenetrate the head, not
//      float in front of it.
// Never eyeball coordinates: a non-uniform `scale` makes them lie.

import { ANIME_CHARACTER_PRESETS } from './animeCharacter.js';

/** shape: id, kind, position [x,y,z], scale [x,y,z], color, optional rotation [x,y,z] (deg). */
function sh(id, kind, p, s, color, r) {
  const o = { id, kind, position: { x: p[0], y: p[1], z: p[2] }, scale: { x: s[0], y: s[1], z: s[2] }, color };
  if (r) o.rotation = { x: r[0], y: r[1], z: r[2] };
  return o;
}

// --- Palette (hex ints) ---
export const C = {
  skin: 0xe8b98a, skinDk: 0xc9945f, skinPale: 0xf2d3b0,
  hairBrown: 0x4a3020, hairBlack: 0x1a1a1e, hairBlonde: 0xd9b24a, hairGray: 0x9a9a9a, hairGreen: 0x3a5a3a,
  steel: 0x9aa0aa, steelDk: 0x5a606a, iron: 0x6e747e,
  leather: 0x6a4a2a, leatherDk: 0x3f2c1a, leatherLt: 0x8a6a44,
  cloth: 0xe8e4d8, clothDk: 0x3a3a4a,
  blue: 0x3f6bc5, blueLt: 0x6fa8e8, blueDk: 0x24406e,
  purple: 0x6a3f9a, purpleDk: 0x3c2258,
  green: 0x3f7a3a, greenDk: 0x24491f,
  red: 0xb0402a, gold: 0xd9a92a, white: 0xf2f2ee, black: 0x14141a,
  eye: 0x2a2a35,
};

/**
 * The shared humanoid skeleton. Slot anchors are in creature-root space; the
 * root is at the feet, so a body stands on y=0 and tops out near y=1.75 —
 * matching the existing chibi player scale from generators/character.js.
 *
 * THE ARM MUST CLEAR THE TORSO, NOT MERELY TOUCH IT. Three sizes matter, and
 * only the third one gets the arm out of the body:
 *   torso half-width   0.26
 *   arm radius         0.08   (the upper-arm capsule)
 *   arm anchor         0.34 = 0.26 + 0.08
 * An anchor at 0.26 puts the pivot on the chest's surface, which sounds right
 * and still leaves HALF THE LIMB inside the chest (it spans 0.18..0.34). The
 * anchor must be offset by the arm's own radius so the limb's inner face lands
 * on the chest's outer face. Connectivity still holds because the shoulder
 * SPHERE (radius ~0.115) spans 0.225..0.455 and interpenetrates the torso:
 * overlapping solids, not a buried pivot.
 *
 * The hand attach point is DERIVED from each arm's lowest shape (see
 * creatureRig.js handAnchorFor), not listed here.
 */
export const HUMANOID_ANCHORS = {
  torso: [0, 0.95, 0],
  head: [0, 1.5, 0],
  armL: [-0.34, 1.15, 0],
  armR: [0.34, 1.15, 0],
  legL: [-0.13, 0.6, 0],
  legR: [0.13, 0.6, 0],
};

/**
 * Arm presets are authored for the RIGHT side (+x points away from the body).
 * The left arm is this mirror of them, so one preset serves both shoulders and
 * a pauldron can never end up inside the chest on one side only.
 */
export function mirrorShapes(shapes) {
  return shapes.map((s) => ({
    ...s,
    position: { ...s.position, x: -s.position.x },
    ...(s.rotation ? { rotation: { ...s.rotation, y: -s.rotation.y, z: -s.rotation.z } } : {}),
  }));
}

/** slot: role + the shared anchor for that role + shapes (left limbs mirrored). */
function slot(role, shapes) {
  const a = HUMANOID_ANCHORS[role];
  const s = role === 'armL' || role === 'legL' ? mirrorShapes(shapes) : shapes;
  return { role, anchor: { x: a[0], y: a[1], z: a[2] }, shapes: s };
}

// ============================ HEAD PARTS ============================
// A boxy head reads better than a sphere at this poly count — it's what gives
// the reference screenshots their faceted, low-poly look. Head box spans
// ±0.25 x/y and ±0.23 z, so eyes at z=0.22 (half-depth 0.02) straddle the face.

const eyes = (color = C.eye) => [
  sh('eyeL', 'box', [-0.11, 0.02, 0.22], [0.07, 0.06, 0.04], color),
  sh('eyeR', 'box', [0.11, 0.02, 0.22], [0.07, 0.06, 0.04], color),
];

const headBox = (skin = C.skin) => sh('head', 'box', [0, 0, 0], [0.5, 0.5, 0.46], skin);

/** Hair that caps the skull and falls down the back — never over the eyes. */
const hairCap = (color) => [
  sh('hairTop', 'box', [0, 0.19, 0], [0.54, 0.18, 0.5], color),
  sh('hairBack', 'box', [0, 0.0, -0.19], [0.52, 0.36, 0.14], color),
];

export const HEAD_PRESETS = [
  {
    id: 'head-plain', label: 'Plain', shapes: [headBox(), ...eyes()],
  },
  {
    id: 'head-short-hair', label: 'Short Hair',
    shapes: [headBox(), ...hairCap(C.hairBrown), ...eyes()],
  },
  {
    id: 'head-long-hair', label: 'Long Hair',
    shapes: [
      headBox(), ...hairCap(C.hairBlonde), ...eyes(),
      sh('hairSideL', 'box', [-0.25, -0.08, -0.02], [0.08, 0.42, 0.4], C.hairBlonde),
      sh('hairSideR', 'box', [0.25, -0.08, -0.02], [0.08, 0.42, 0.4], C.hairBlonde),
    ],
  },
  {
    id: 'head-bearded', label: 'Bearded',
    shapes: [
      headBox(), ...hairCap(C.hairBrown), ...eyes(),
      sh('beard', 'box', [0, -0.21, 0.12], [0.42, 0.26, 0.28], C.hairBrown),
      sh('stache', 'box', [0, -0.09, 0.21], [0.24, 0.06, 0.08], C.hairBrown),
    ],
  },
  {
    id: 'head-hooded', label: 'Hooded',
    shapes: [
      headBox(C.skinDk), ...eyes(),
      // The hood is a shell around the skull, open at the face (+Z).
      sh('hoodTop', 'box', [0, 0.16, -0.02], [0.58, 0.26, 0.56], C.purpleDk),
      sh('hoodBack', 'box', [0, -0.06, -0.22], [0.56, 0.42, 0.16], C.purpleDk),
      sh('hoodL', 'box', [-0.27, -0.04, 0.02], [0.08, 0.4, 0.5], C.purpleDk),
      sh('hoodR', 'box', [0.27, -0.04, 0.02], [0.08, 0.4, 0.5], C.purpleDk),
      sh('hoodBrow', 'wedge', [0, 0.2, 0.18], [0.5, 0.18, 0.22], C.purple, [90, 0, 0]),
    ],
  },
  {
    id: 'head-wizard-hat', label: 'Wizard Hat',
    shapes: [
      headBox(), ...hairCap(C.hairGray), ...eyes(),
      sh('brim', 'cylinder', [0, 0.26, 0], [0.86, 0.06, 0.86], C.blueDk),
      sh('cone', 'cone', [0, 0.56, -0.04], [0.44, 0.58, 0.44], C.blue, [-8, 0, 0]),
      sh('tip', 'sphere', [0, 0.82, -0.14], [0.1, 0.1, 0.1], C.gold),
    ],
  },
  {
    id: 'head-witch-hat', label: 'Witch Hat',
    shapes: [
      headBox(C.skinPale), ...hairCap(C.hairBlack), ...eyes(0x4ad06a),
      sh('brim', 'cylinder', [0, 0.26, 0], [0.92, 0.05, 0.92], C.black),
      sh('cone', 'cone', [0, 0.54, -0.06], [0.4, 0.56, 0.4], C.purpleDk, [-14, 0, 0]),
      sh('fold', 'cone', [0, 0.78, -0.24], [0.2, 0.28, 0.2], C.purpleDk, [-52, 0, 0]),
    ],
  },
  {
    id: 'head-helm', label: 'Helm',
    shapes: [
      headBox(C.skinDk), ...eyes(),
      sh('helmTop', 'box', [0, 0.2, 0], [0.56, 0.24, 0.52], C.steel),
      sh('helmBack', 'box', [0, 0.0, -0.21], [0.54, 0.4, 0.14], C.steel),
      sh('helmL', 'box', [-0.26, -0.02, 0.0], [0.08, 0.4, 0.46], C.steel),
      sh('helmR', 'box', [0.26, -0.02, 0.0], [0.08, 0.4, 0.46], C.steel),
      sh('nasal', 'box', [0, 0.02, 0.22], [0.06, 0.3, 0.06], C.steelDk),
      sh('crest', 'wedge', [0, 0.34, 0], [0.08, 0.14, 0.5], C.red),
    ],
  },
  {
    id: 'head-feathered-cap', label: 'Feathered Cap',
    shapes: [
      headBox(), ...hairCap(C.hairBrown), ...eyes(),
      sh('cap', 'box', [0, 0.24, 0], [0.56, 0.16, 0.52], C.greenDk),
      sh('capBrim', 'wedge', [0, 0.18, 0.24], [0.5, 0.1, 0.18], C.green, [90, 0, 0]),
      sh('feather', 'cone', [0.15, 0.36, -0.06], [0.07, 0.24, 0.07], C.white, [-30, 0, 22]),
    ],
  },
];

// ============================ TORSO PARTS ============================
// Torso box spans ±0.26 x, ±0.35 y, ±0.19 z around its anchor. Narrow on
// purpose: the arms hang just outside it at x≈±0.29, and a wider chest would
// swallow them (see HUMANOID_ANCHORS).

const torsoCore = (color) => sh('chest', 'box', [0, 0, 0], [0.52, 0.7, 0.38], color);
const belt = (color = C.leatherDk) => sh('belt', 'box', [0, -0.24, 0], [0.56, 0.1, 0.42], color);

export const TORSO_PRESETS = [
  {
    id: 'torso-tunic', label: 'Tunic',
    shapes: [torsoCore(C.leatherLt), belt(), sh('collar', 'box', [0, 0.3, 0.02], [0.4, 0.12, 0.36], C.leather)],
  },
  {
    id: 'torso-robe', label: 'Robe',
    shapes: [
      torsoCore(C.blue), belt(C.gold),
      // Skirt of the robe flares out below the belt and over the legs. Its top
      // sits inside the chest box, so it's connected.
      //
      // NO ROTATION. The unit cone (src/generators/custom.js) is already base-down
      // / apex-up, which is skirt-shaped. A 180-degree flip stands it on its point
      // and the mage ends up wearing an ice-cream cone.
      sh('skirt', 'cone', [0, -0.5, 0], [0.86, 0.62, 0.66], C.blueDk),
      sh('trim', 'box', [0, 0.3, 0.03], [0.44, 0.14, 0.38], C.gold),
    ],
  },
  {
    id: 'torso-dark-robe', label: 'Dark Robe',
    shapes: [
      torsoCore(C.purpleDk), belt(C.purple),
      sh('skirt', 'cone', [0, -0.5, 0], [0.84, 0.62, 0.64], C.black),
      sh('sash', 'box', [0, 0.06, 0.19], [0.14, 0.6, 0.06], C.purple, [0, 0, 14]),
      sh('gem', 'sphere', [0, 0.18, 0.2], [0.1, 0.1, 0.06], C.green),
    ],
  },
  {
    id: 'torso-plate', label: 'Plate',
    shapes: [
      torsoCore(C.steel),
      sh('placket', 'box', [0, 0.02, 0.18], [0.2, 0.56, 0.06], C.steelDk),
      belt(C.iron),
      sh('tasset', 'box', [0, -0.4, 0.02], [0.5, 0.24, 0.34], C.steelDk),
      sh('gorget', 'box', [0, 0.31, 0.0], [0.42, 0.12, 0.36], C.iron),
    ],
  },
  {
    id: 'torso-leather', label: 'Leather',
    shapes: [
      torsoCore(C.leather), belt(),
      sh('strapL', 'box', [-0.13, 0.04, 0.19], [0.09, 0.62, 0.05], C.leatherDk, [0, 0, -10]),
      sh('strapR', 'box', [0.13, 0.04, 0.19], [0.09, 0.62, 0.05], C.leatherDk, [0, 0, 10]),
      sh('buckle', 'box', [0, -0.24, 0.21], [0.1, 0.1, 0.05], C.gold),
    ],
  },
  {
    id: 'torso-vestment', label: 'Vestment',
    shapes: [
      torsoCore(C.cloth), belt(C.blueLt),
      sh('skirt', 'cone', [0, -0.48, 0], [0.8, 0.58, 0.62], C.cloth),
      sh('stole', 'box', [0, 0.06, 0.19], [0.16, 0.62, 0.05], C.blueLt),
      sh('amulet', 'sphere', [0, 0.14, 0.21], [0.11, 0.13, 0.06], C.gold),
    ],
  },
  {
    id: 'torso-scaled', label: 'Scale Mail',
    shapes: [
      torsoCore(C.iron), belt(),
      sh('scaleA', 'box', [0, 0.14, 0.18], [0.46, 0.16, 0.05], C.steelDk),
      sh('scaleB', 'box', [0, -0.04, 0.18], [0.46, 0.16, 0.05], C.steelDk),
      sh('scaleC', 'box', [0, -0.22, 0.18], [0.46, 0.16, 0.05], C.steelDk),
    ],
  },
];

// ============================ ARM PARTS ============================
// Local to the shoulder JOINT, which sits on the torso's surface (see
// HUMANOID_ANCHORS). The limb therefore hangs straight down from its own
// origin — x stays 0 — and swings clear of the chest. Shape 1 is the joint
// sphere centred on the anchor: it reaches back INTO the torso, which is what
// welds the arm on. The lowest shape (the hand) defines the weapon attach
// point.
//
// Authored for the right side; slot() mirrors them onto the left, so an
// asymmetric detail (a pauldron strap) can never end up inside the chest on
// one side only.

const armCore = (sleeve, skin) => [
  sh('shoulder', 'sphere', [0, 0, 0], [0.23, 0.23, 0.23], sleeve),
  sh('upper', 'capsule', [0, -0.24, 0], [0.16, 0.44, 0.16], sleeve),
  sh('hand', 'box', [0, -0.55, 0.01], [0.15, 0.15, 0.16], skin),
];

export const ARM_PRESETS = [
  { id: 'arm-bare', label: 'Bare', shapes: armCore(C.skin, C.skin) },
  { id: 'arm-sleeved', label: 'Sleeved', shapes: armCore(C.blue, C.skin) },
  {
    id: 'arm-robed', label: 'Robed',
    shapes: [
      sh('shoulder', 'sphere', [0, 0, 0], [0.25, 0.25, 0.25], C.blue),
      sh('upper', 'capsule', [0, -0.2, 0], [0.18, 0.4, 0.18], C.blue),
      sh('cuff', 'cone', [0, -0.44, 0], [0.3, 0.24, 0.3], C.blueDk),
      sh('hand', 'box', [0, -0.58, 0.01], [0.14, 0.14, 0.15], C.skin),
    ],
  },
  {
    id: 'arm-gauntlet', label: 'Gauntlet',
    shapes: [
      sh('shoulder', 'sphere', [0, 0, 0], [0.25, 0.25, 0.25], C.steel),
      sh('upper', 'capsule', [0, -0.24, 0], [0.16, 0.44, 0.16], C.steelDk),
      sh('bracer', 'cylinder', [0, -0.44, 0], [0.19, 0.16, 0.19], C.steel),
      sh('hand', 'box', [0, -0.56, 0.01], [0.16, 0.16, 0.17], C.iron),
    ],
  },
  {
    id: 'arm-pauldroned', label: 'Pauldroned',
    shapes: [
      sh('pauldron', 'sphere', [0.02, 0.05, 0], [0.32, 0.28, 0.32], C.steel),
      sh('shoulder', 'sphere', [0, 0, 0], [0.23, 0.23, 0.23], C.steelDk),
      sh('upper', 'capsule', [0, -0.24, 0], [0.16, 0.44, 0.16], C.steelDk),
      sh('bracer', 'cylinder', [0, -0.44, 0], [0.19, 0.16, 0.19], C.steel),
      sh('hand', 'box', [0, -0.56, 0.01], [0.16, 0.16, 0.17], C.iron),
    ],
  },
  {
    id: 'arm-vambraced', label: 'Vambraced',
    shapes: [
      sh('shoulder', 'sphere', [0, 0, 0], [0.23, 0.23, 0.23], C.greenDk),
      sh('upper', 'capsule', [0, -0.24, 0], [0.15, 0.44, 0.15], C.skin),
      sh('vambrace', 'cylinder', [0, -0.42, 0], [0.17, 0.2, 0.17], C.leather),
      sh('hand', 'box', [0, -0.56, 0.01], [0.14, 0.15, 0.16], C.leatherDk),
    ],
  },
];

// ============================ LEG PARTS ============================
// Local to the hip. Shape 1 is the hip joint sphere on the anchor (inside the
// torso solid). Feet land near y=0 in root space.

const legCore = (trouser, boot) => [
  sh('hip', 'sphere', [0, 0, 0], [0.2, 0.2, 0.2], trouser),
  sh('thigh', 'capsule', [0, -0.24, 0], [0.17, 0.44, 0.17], trouser),
  sh('boot', 'box', [0, -0.5, 0.03], [0.19, 0.16, 0.28], boot),
];

export const LEG_PRESETS = [
  { id: 'leg-bare', label: 'Bare', shapes: legCore(C.skin, C.leatherDk) },
  { id: 'leg-trousers', label: 'Trousers', shapes: legCore(C.leatherDk, C.leather) },
  { id: 'leg-robed', label: 'Robed', shapes: legCore(C.blueDk, C.leatherDk) },
  {
    id: 'leg-greaves', label: 'Greaves',
    shapes: [
      sh('hip', 'sphere', [0, 0, 0], [0.2, 0.2, 0.2], C.steelDk),
      sh('thigh', 'capsule', [0, -0.22, 0], [0.18, 0.4, 0.18], C.steelDk),
      sh('greave', 'cylinder', [0, -0.42, 0], [0.2, 0.2, 0.2], C.steel),
      sh('boot', 'box', [0, -0.54, 0.04], [0.2, 0.14, 0.3], C.iron),
    ],
  },
  {
    id: 'leg-boots', label: 'Tall Boots',
    shapes: [
      sh('hip', 'sphere', [0, 0, 0], [0.2, 0.2, 0.2], C.greenDk),
      sh('thigh', 'capsule', [0, -0.22, 0], [0.17, 0.4, 0.17], C.greenDk),
      sh('bootTop', 'cylinder', [0, -0.42, 0], [0.19, 0.22, 0.19], C.leather),
      sh('boot', 'box', [0, -0.54, 0.04], [0.19, 0.14, 0.3], C.leatherDk),
    ],
  },
];

/** Which preset list a slot role draws from — arms/legs share one list per limb type. */
export const HUMANOID_PART_PRESETS = {
  head: HEAD_PRESETS,
  torso: TORSO_PRESETS,
  arm: ARM_PRESETS,
  leg: LEG_PRESETS,
};

// ============================ BODY PRESETS ============================
// Complete starter humanoids. `kind`, `equipment` and `allowedWeaponTypes` are
// what separate a player class from a townsfolk; the body itself is the same
// six slots either way.

/** Recolor a preset's shapes wholesale, by shape id prefix. Keeps the presets above generic. */
function tint(shapes, mapping) {
  return shapes.map((s) => (mapping[s.id] !== undefined ? { ...s, color: mapping[s.id] } : s));
}

function body(head, torso, armL, armR, legL, legR) {
  return [
    slot('torso', torso),
    slot('head', head),
    slot('armL', armL),
    slot('armR', armR),
    slot('legL', legL),
    slot('legR', legR),
  ];
}

const byId = (list, id) => list.find((p) => p.id === id).shapes;

/** @type {import('../sim/creatureTypeDefs.js').CreatureTypeDef[]} */
export const CHARACTER_PRESETS = [
  // The anime-proportioned playable body (CHARACTER_REDESIGN_CONCEPT.md step 1).
  // Additive: the six original class bodies below are untouched.
  ...ANIME_CHARACTER_PRESETS,
  {
    id: 'warrior', name: 'Warrior', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-bearded'),
      byId(TORSO_PRESETS, 'torso-scaled'),
      byId(ARM_PRESETS, 'arm-pauldroned'),
      byId(ARM_PRESETS, 'arm-pauldroned'),
      byId(LEG_PRESETS, 'leg-greaves'),
      byId(LEG_PRESETS, 'leg-greaves')
    ),
    equipment: { mainHand: 'greatsword', offHand: null },
    allowedWeaponTypes: ['greatsword', 'sword', 'axe', 'hammer', 'mace', 'spear'],
  },
  {
    id: 'guardian', name: 'Guardian', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-helm'),
      byId(TORSO_PRESETS, 'torso-plate'),
      byId(ARM_PRESETS, 'arm-pauldroned'),
      byId(ARM_PRESETS, 'arm-pauldroned'),
      byId(LEG_PRESETS, 'leg-greaves'),
      byId(LEG_PRESETS, 'leg-greaves')
    ),
    equipment: { mainHand: 'sword', offHand: 'shield' },
    allowedWeaponTypes: ['sword', 'mace', 'axe', 'shield'],
  },
  {
    id: 'mage', name: 'Mage', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-wizard-hat'),
      byId(TORSO_PRESETS, 'torso-robe'),
      byId(ARM_PRESETS, 'arm-robed'),
      byId(ARM_PRESETS, 'arm-robed'),
      byId(LEG_PRESETS, 'leg-robed'),
      byId(LEG_PRESETS, 'leg-robed')
    ),
    equipment: { mainHand: 'staff', offHand: null },
    allowedWeaponTypes: ['staff', 'wand', 'dagger'],
  },
  {
    id: 'warlock', name: 'Warlock', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-witch-hat'),
      byId(TORSO_PRESETS, 'torso-dark-robe'),
      tint(byId(ARM_PRESETS, 'arm-robed'), { shoulder: C.purpleDk, upper: C.purpleDk, cuff: C.black }),
      tint(byId(ARM_PRESETS, 'arm-robed'), { shoulder: C.purpleDk, upper: C.purpleDk, cuff: C.black }),
      tint(byId(LEG_PRESETS, 'leg-robed'), { hip: C.purpleDk, thigh: C.purpleDk }),
      tint(byId(LEG_PRESETS, 'leg-robed'), { hip: C.purpleDk, thigh: C.purpleDk })
    ),
    equipment: { mainHand: 'staff', offHand: null },
    allowedWeaponTypes: ['staff', 'wand', 'dagger'],
  },
  {
    id: 'priest', name: 'Priest', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-long-hair'),
      byId(TORSO_PRESETS, 'torso-vestment'),
      tint(byId(ARM_PRESETS, 'arm-sleeved'), { shoulder: C.cloth, upper: C.cloth }),
      tint(byId(ARM_PRESETS, 'arm-sleeved'), { shoulder: C.cloth, upper: C.cloth }),
      tint(byId(LEG_PRESETS, 'leg-boots'), { hip: C.cloth, thigh: C.cloth, bootTop: C.blueLt, boot: C.blueDk }),
      tint(byId(LEG_PRESETS, 'leg-boots'), { hip: C.cloth, thigh: C.cloth, bootTop: C.blueLt, boot: C.blueDk })
    ),
    equipment: { mainHand: 'staff', offHand: null },
    allowedWeaponTypes: ['staff', 'mace', 'wand'],
  },
  {
    id: 'archer', name: 'Archer', kind: 'character', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-feathered-cap'),
      byId(TORSO_PRESETS, 'torso-leather'),
      byId(ARM_PRESETS, 'arm-vambraced'),
      byId(ARM_PRESETS, 'arm-vambraced'),
      byId(LEG_PRESETS, 'leg-boots'),
      byId(LEG_PRESETS, 'leg-boots')
    ),
    equipment: { mainHand: 'bow', offHand: null },
    allowedWeaponTypes: ['bow', 'crossbow', 'dagger', 'spear'],
  },

  // --- Townsfolk (kind: 'npc') ---
  {
    id: 'villager', name: 'Villager', kind: 'npc', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-short-hair'),
      byId(TORSO_PRESETS, 'torso-tunic'),
      byId(ARM_PRESETS, 'arm-bare'),
      byId(ARM_PRESETS, 'arm-bare'),
      byId(LEG_PRESETS, 'leg-trousers'),
      byId(LEG_PRESETS, 'leg-trousers')
    ),
    equipment: { mainHand: null, offHand: null },
  },
  {
    id: 'town-guard', name: 'Town Guard', kind: 'npc', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-helm'),
      byId(TORSO_PRESETS, 'torso-scaled'),
      byId(ARM_PRESETS, 'arm-gauntlet'),
      byId(ARM_PRESETS, 'arm-gauntlet'),
      byId(LEG_PRESETS, 'leg-greaves'),
      byId(LEG_PRESETS, 'leg-greaves')
    ),
    equipment: { mainHand: 'spear', offHand: null },
    allowedWeaponTypes: ['spear', 'sword', 'shield'],
  },
  {
    id: 'merchant', name: 'Merchant', kind: 'npc', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-bearded'),
      byId(TORSO_PRESETS, 'torso-tunic'),
      byId(ARM_PRESETS, 'arm-sleeved'),
      byId(ARM_PRESETS, 'arm-sleeved'),
      byId(LEG_PRESETS, 'leg-trousers'),
      byId(LEG_PRESETS, 'leg-trousers')
    ),
    equipment: { mainHand: null, offHand: null },
  },
  {
    id: 'hooded-stranger', name: 'Hooded Stranger', kind: 'npc', stance: 'humanoid',
    slots: body(
      byId(HEAD_PRESETS, 'head-hooded'),
      byId(TORSO_PRESETS, 'torso-dark-robe'),
      tint(byId(ARM_PRESETS, 'arm-robed'), { shoulder: C.purpleDk, upper: C.purpleDk, cuff: C.black }),
      tint(byId(ARM_PRESETS, 'arm-robed'), { shoulder: C.purpleDk, upper: C.purpleDk, cuff: C.black }),
      tint(byId(LEG_PRESETS, 'leg-robed'), { hip: C.purpleDk, thigh: C.purpleDk }),
      tint(byId(LEG_PRESETS, 'leg-robed'), { hip: C.purpleDk, thigh: C.purpleDk })
    ),
    equipment: { mainHand: 'dagger', offHand: null },
    allowedWeaponTypes: ['dagger', 'staff', 'wand'],
  },
];
