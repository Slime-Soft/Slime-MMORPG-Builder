// src/sim/weaponTypes.js
// The weapon-type catalog: what a creature can hold, and HOW it holds it.
//
// Pure data, no Three (see scripts/check-architecture.mjs). A weapon's mesh is
// built in src/generators/weapon.js; everything about where it sits in the hand
// and what the arms do while carrying it lives here, so the editor preview, the
// live game, and any future bot all resolve a grip identically.
//
// Two distinct transforms, and the difference matters:
//   - `grip`   — where the WEAPON sits relative to the hand that holds it.
//                Applied to the weapon group once, at attach time.
//   - `hold`   — what the ARMS do to carry it. Applied to the rig's arm pivots
//                as a BASE pose that the walk cycle swings around (see
//                applyGaitPose in src/generators/rig.js). An archer's bow arm
//                stays extended while he walks; it does not snap back to rest.
//
// `swingScale` damps a limb's gait amplitude. A two-handed greatsword shouldn't
// let the arms swing like they're empty — 0 pins the arm to its base pose.

/** Off-hand weapons occupy the left hand; 'main' the right; 'either' can go in both (dual-wield, later). */
export const WEAPON_SLOTS = ['main', 'off', 'either'];

const deg = (x = 0, y = 0, z = 0) => ({ x, y, z });
const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });

// THE SIGN OF A PITCH — the single easiest thing to get backwards here, and the
// cause of staves that lean back through their owner's torso and greatswords
// couched forward like lances. Three's rotation.x maps (0,1,0) -> (0,cos t,sin t):
//   - On an ARM (its limb runs down -Y): a NEGATIVE x raises the hand FORWARD.
//     Hence every `hold.x` below is negative.
//   - On a WEAPON: a negative x tilts its +Y end (a staff's orb, a spear's
//     point) BACKWARD, and tilts a blade's -Y tip FORWARD.
// So a shaft weapon AND a blade both want a POSITIVE net pitch: the shaft's head
// forward and clear of the shoulder, the blade's tip back and clear of the floor.
// `net pitch = hold.x + grip.rotationDeg.x`, printed by check-prefabs.mjs.
// The exception is a RANGED weapon, whose net must be ~0 (see the block below).

/**
 * @typedef {Object} ArmHold
 * @property {number} [x] pitch in degrees at the shoulder (negative = raised forward)
 * @property {number} [y] yaw in degrees
 * @property {number} [z] roll in degrees. The sign MIRRORS between arms: a negative z
 *   tucks the RIGHT arm inward, a positive z tucks the LEFT arm inward. Rolling an
 *   arm inward drives the limb into the chest, so keep these at or near zero.
 * @property {number} [swingScale] 0-1 multiplier on this arm's walk-cycle amplitude (default 1)
 */

/**
 * @typedef {Object} WeaponTypeDef
 * @property {string} id
 * @property {string} name
 * @property {1|2} hands
 * @property {'main'|'off'|'either'} slot
 * @property {'blade'|'blunt'|'polearm'|'ranged'|'focus'|'shield'} family  drives the generated mesh + shared audio/behavior later
 * @property {{position:{x,y,z}, rotationDeg:{x,y,z}}} grip  weapon-relative-to-hand
 * @property {{armR?: ArmHold, armL?: ArmHold}} hold  base arm pose while carrying
 */

/** @type {WeaponTypeDef[]} */
export const WEAPON_TYPES = [
  // --- One-handed blades ---
  // A NOTE ON PITCH AND THE FLOOR. These chibi arms are short: the hand rests
  // near y=0.6 in root space. A blade hanging straight down from there would
  // put its tip through the ground. Every melee weapon therefore carries a
  // deliberate backward LEAN (its net pitch) sized to its own length.
  //
  // `grip.position` is a nudge, never a mount: the mesh's origin is already the
  // grip point (src/generators/weapon.js). The axes are not symmetric.
  //   y — must stay ~0. Sliding a weapon UP its shaft to clear the floor lifts
  //       it out of the fist. That is how this once ended up with characters
  //       carrying swords 16cm above their hands. Lean it instead.
  //   z — a small FORWARD nudge is required. The arm and the weapon share an
  //       axis, so a staff gripped at z=0 hides inside the forearm along its
  //       whole length. A real fist holds a shaft in front of the arm.
  // scripts/check-prefabs.mjs enforces both.
  {
    id: 'sword', name: 'Sword', hands: 1, slot: 'main', family: 'blade',
    grip: { position: vec(0, 0, 0.1), rotationDeg: deg(36, 0, 0) },
    hold: { armR: { x: -10, z: 0, swingScale: 0.55 } },
  },
  {
    id: 'dagger', name: 'Dagger', hands: 1, slot: 'either', family: 'blade',
    grip: { position: vec(0, 0, 0.08), rotationDeg: deg(16, 0, 0) },
    hold: { armR: { x: -4, z: 0, swingScale: 0.8 } },
  },
  {
    id: 'axe', name: 'Axe', hands: 1, slot: 'main', family: 'blunt',
    grip: { position: vec(0, 0, 0.1), rotationDeg: deg(36, 0, 0) },
    hold: { armR: { x: -10, z: 0, swingScale: 0.5 } },
  },
  {
    id: 'mace', name: 'Mace', hands: 1, slot: 'main', family: 'blunt',
    grip: { position: vec(0, 0, 0.1), rotationDeg: deg(34, 0, 0) },
    hold: { armR: { x: -10, z: 0, swingScale: 0.5 } },
  },
  {
    id: 'wand', name: 'Wand', hands: 1, slot: 'main', family: 'focus',
    grip: { position: vec(0, 0, 0.08), rotationDeg: deg(58, 0, 0) },
    hold: { armR: { x: -18, z: 0, swingScale: 0.6 } },
  },

  // --- Off-hand ---
  {
    id: 'shield', name: 'Shield', hands: 1, slot: 'off', family: 'shield',
    // Strapped to the forearm, face outward from the body's left side. The one
    // sanctioned grip OFFSET: a shield is worn on the arm, not gripped in the
    // fist, so it sits slightly inboard and above the hand.
    grip: { position: vec(-0.05, 0.04, 0.04), rotationDeg: deg(0, 0, 0) },
    hold: { armL: { x: -34, z: -10, swingScale: 0.2 } },
  },

  // --- Two-handed melee ---
  {
    id: 'greatsword', name: 'Greatsword', hands: 2, slot: 'main', family: 'blade',
    // A 1.16-long blade cannot hang from a 0.6-high fist. Rested back over the
    // shoulder: the arm stays near its side and the LEAN carries the blade up
    // and behind, rather than the arms being flung out in front of the chest.
    grip: { position: vec(0, 0, 0.12), rotationDeg: deg(74, 0, 0) },
    hold: {
      armR: { x: -12, z: 0, swingScale: 0.3 },
      armL: { x: -16, z: -4, swingScale: 0.4 },
    },
  },
  {
    id: 'hammer', name: 'Hammer', hands: 2, slot: 'main', family: 'blunt',
    grip: { position: vec(0, 0, 0.12), rotationDeg: deg(70, 0, 0) },
    hold: {
      armR: { x: -12, z: 0, swingScale: 0.3 },
      armL: { x: -16, z: -4, swingScale: 0.4 },
    },
  },
  {
    id: 'spear', name: 'Spear', hands: 2, slot: 'main', family: 'polearm',
    // Carried upright at the side, butt near the ground — hence the small tilt.
    grip: { position: vec(0, 0, 0.12), rotationDeg: deg(18, 0, 0) },
    hold: {
      armR: { x: -10, z: 0, swingScale: 0.35 },
      armL: { x: -14, z: -4, swingScale: 0.45 },
    },
  },
  {
    id: 'staff', name: 'Staff', hands: 2, slot: 'main', family: 'focus',
    grip: { position: vec(0, 0, 0.12), rotationDeg: deg(20, 0, 0) },
    hold: {
      armR: { x: -12, z: 0, swingScale: 0.35 },
      armL: { x: -14, z: -4, swingScale: 0.45 },
    },
  },

  // --- Ranged ---
  // Both ranged weapons need their grip to CANCEL the arm's hold pitch. These
  // rigs have no wrist, so a weapon inherits the shoulder's rotation whole: an
  // arm rotated to carry or aim drags the bow that many degrees out of vertical
  // with it, and the bow ends up lying flat, pointing at the sky. The grip
  // therefore counter-rotates by exactly the holding arm's `x`, leaving the
  // weapon upright and its +Z (the arrow's flight) level. Change one, change
  // the other — scripts/check-prefabs.mjs fails a ranged weapon whose net pitch
  // strays past 5 degrees.
  {
    id: 'bow', name: 'Bow', hands: 2, slot: 'main', family: 'ranged',
    // The bow is HELD IN THE LEFT hand (the draw hand is the right) — the one
    // weapon whose mesh does not belong in the main hand. See handForWeapon.
    // CARRIED AT THE SIDE, not drawn. A drawn-bow pose needs the draw hand at
    // the string near the cheek, and these rigs have no elbow — the forearm
    // can't fold, so the arm can only swing from the shoulder and the result
    // reads as someone pointing a hoop at the horizon. The arm hangs down; the
    // grip's counter-rotation keeps the bow vertical. Drawing belongs to an
    // attack animation, not the resting pose.
    grip: { position: vec(0, 0, 0.06), rotationDeg: deg(10, 0, 0) },
    hold: {
      armL: { x: -10, z: -4, swingScale: 0.4 }, // bow arm rests at the side
      armR: { x: -4, z: 0, swingScale: 0.9 }, // draw hand swings nearly free
    },
  },
  {
    id: 'crossbow', name: 'Crossbow', hands: 2, slot: 'main', family: 'ranged',
    // A crossbow IS shouldered and levelled at rest, so unlike the bow it keeps
    // an aimed pose. Its grip still cancels the arm pitch (net 0) so the bolt
    // flies level rather than skyward.
    grip: { position: vec(0, -0.01, 0.05), rotationDeg: deg(50, 0, 0) },
    hold: {
      armR: { x: -50, z: 0, swingScale: 0.1 },
      armL: { x: -56, z: -4, swingScale: 0.1 },
    },
  },
];

const BY_ID = Object.fromEntries(WEAPON_TYPES.map((w) => [w.id, w]));

// The SHIPPED defaults, captured before applyWeaponTuning can patch anything
// (module init runs first). "Does this weapon differ from the defaults?" must
// be answered against THESE — diffing against the live defs after a reload
// compares saved tuning against itself, concludes "unchanged", drops the
// weapon from the next save, and silently wipes the file. That bug shipped.
const PRISTINE = new Map(
  WEAPON_TYPES.map((w) => [w.id, JSON.parse(JSON.stringify({ grip: w.grip, hold: w.hold }))])
);

/** The untuned grip/hold a weapon shipped with. @param {string} id */
export function pristineWeaponDefault(id) {
  return PRISTINE.get(id) || null;
}

/**
 * Overlay saved grip/hold tuning onto the built-in definitions.
 *
 * The values above are the shipped defaults; `weapon-tuning/weapon-tuning.json`
 * (authored in the Character & NPC Builder, served at /api/weapon-tuning) is the
 * live override. The game, the editor and the builder all call this on load, so
 * a grip tuned in the builder is the grip the player sees — previously the
 * sliders only emitted a snippet to paste by hand, which is not a way to work.
 *
 * @param {Record<string, {grip?: object, hold?: object}>} overrides
 */
export function applyWeaponTuning(overrides = {}) {
  for (const [id, patch] of Object.entries(overrides)) {
    const def = BY_ID[id];
    if (!def || !patch) continue;
    if (patch.grip) {
      if (patch.grip.position) def.grip.position = { ...def.grip.position, ...patch.grip.position };
      if (patch.grip.rotationDeg) def.grip.rotationDeg = { ...def.grip.rotationDeg, ...patch.grip.rotationDeg };
    }
    if (patch.hold) {
      for (const arm of ['armR', 'armL']) {
        // Only patch an arm the weapon actually poses: adding armL to a
        // one-handed sword would silently pin the empty arm.
        if (patch.hold[arm] && def.hold[arm]) def.hold[arm] = { ...def.hold[arm], ...patch.hold[arm] };
      }
    }
  }
}

/** Structural validation for a tuning payload, before it's written to disk. */
export function validateWeaponTuning(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Weapon tuning must be an object keyed by weapon id');
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  for (const [id, patch] of Object.entries(data)) {
    if (!BY_ID[id]) throw new Error(`Unknown weapon type "${id}"`);
    if (!patch || typeof patch !== 'object') throw new Error(`Tuning for "${id}" must be an object`);
    for (const key of ['position', 'rotationDeg']) {
      const v = patch.grip?.[key];
      if (v && !['x', 'y', 'z'].every((a) => v[a] === undefined || num(v[a]))) {
        throw new Error(`Tuning for "${id}" grip.${key} must be numeric`);
      }
    }
    for (const arm of ['armR', 'armL']) {
      const h = patch.hold?.[arm];
      if (!h) continue;
      for (const a of ['x', 'y', 'z', 'swingScale']) {
        if (h[a] !== undefined && !num(h[a])) throw new Error(`Tuning for "${id}" hold.${arm}.${a} must be numeric`);
      }
    }
  }
  return data;
}

export const WEAPON_TYPE_IDS = WEAPON_TYPES.map((w) => w.id);

/**
 * Turns each `category: 'weapon'` entry from the shared /api/models catalog
 * (src/sim/models.js) into a real WeaponTypeDef, merged into WEAPON_TYPES/
 * BY_ID exactly like the hardcoded entries above — every consumer
 * (getWeaponTypeDef, handForWeapon, resolveHoldPose, validateLoadout,
 * applyWeaponTuning, the Character Builder's equip selects and grip/hold
 * tuner) reads through those, so a custom weapon model needs no special-
 * casing anywhere else. `family: 'custom'` is the one flag
 * src/generators/weapon.js's generateWeapon() checks to build from an
 * imported model (src/generators/modelLoader.js) instead of a BUILDERS
 * factory.
 *
 * The grip/hold start at a neutral zero-offset default — an uploaded mesh's
 * origin is an arbitrary artist pivot, not a known grip point, so there's no
 * sensible default to guess; the Character Builder's existing tuner sliders
 * are exactly how it gets seated correctly.
 *
 * Idempotent: safe to call again after a fresh catalog fetch — updates each
 * synthesized entry in place rather than duplicating it in WEAPON_TYPES.
 * @param {Array<{id:string, name:string, category?:string, weapon?:{hands:1|2, slot:string}}>} catalog
 */
export function registerCustomWeaponModels(catalog) {
  for (const entry of catalog) {
    if (entry.category !== 'weapon' || !entry.weapon) continue;
    const existing = BY_ID[entry.id];
    const def = existing?.family === 'custom' ? existing : {
      id: entry.id,
      family: 'custom',
      modelId: entry.id,
      grip: { position: vec(0, 0, 0), rotationDeg: deg(0, 0, 0) },
      hold: {},
    };
    def.name = entry.name;
    def.hands = entry.weapon.hands;
    def.slot = entry.weapon.slot;
    if (!existing) {
      WEAPON_TYPES.push(def);
      BY_ID[def.id] = def;
      PRISTINE.set(def.id, JSON.parse(JSON.stringify({ grip: def.grip, hold: def.hold })));
    }
  }
}

/** @param {string} id @returns {WeaponTypeDef|null} */
export function getWeaponTypeDef(id) {
  return BY_ID[id] || null;
}

/**
 * Which hand actually holds a weapon's mesh. Every weapon goes in the hand its
 * `slot` names, EXCEPT the bow: a right-handed archer holds the bow in the left
 * hand and draws with the right. Getting this wrong is the classic bug where
 * the archer appears to shoot backwards.
 * @param {WeaponTypeDef} def
 * @returns {'handL'|'handR'}
 */
export function handForWeapon(def) {
  if (def.id === 'bow') return 'handL';
  return def.slot === 'off' ? 'handL' : 'handR';
}

/**
 * Merge the arm holds of a main-hand and an off-hand weapon into one pose.
 * A two-handed weapon already describes both arms, so nothing may be equipped
 * alongside it — `validateLoadout` is what enforces that; this just merges.
 * @param {string|null} mainHandId
 * @param {string|null} offHandId
 * @returns {{armR?: ArmHold, armL?: ArmHold}}
 */
export function resolveHoldPose(mainHandId, offHandId) {
  const pose = {};
  for (const id of [mainHandId, offHandId]) {
    const def = id && getWeaponTypeDef(id);
    if (!def) continue;
    for (const [arm, hold] of Object.entries(def.hold)) {
      pose[arm] = { ...(pose[arm] || {}), ...hold };
    }
  }
  return pose;
}

/**
 * Is this main/off pairing legal? Returns null when fine, else a reason.
 * @param {string|null} mainHandId
 * @param {string|null} offHandId
 */
export function validateLoadout(mainHandId, offHandId) {
  const main = mainHandId ? getWeaponTypeDef(mainHandId) : null;
  const off = offHandId ? getWeaponTypeDef(offHandId) : null;
  if (mainHandId && !main) return `Unknown weapon type "${mainHandId}"`;
  if (offHandId && !off) return `Unknown weapon type "${offHandId}"`;
  if (main && main.slot === 'off') return `"${main.id}" is an off-hand weapon`;
  if (off && off.slot === 'main') return `"${off.id}" cannot be held in the off hand`;
  if (main && main.hands === 2 && off) return `"${main.id}" is two-handed — the off hand must be empty`;
  if (off && off.hands === 2) return `"${off.id}" is two-handed and cannot be an off-hand`;
  return null;
}

/** The default loadout each player class carries. Mirrors the old generateWeaponSet switch. */
export const CLASS_LOADOUTS = {
  guardian: { mainHand: 'sword', offHand: 'shield' },
  warrior: { mainHand: 'greatsword', offHand: null },
  mage: { mainHand: 'staff', offHand: null },
  priest: { mainHand: 'staff', offHand: null },
  archer: { mainHand: 'bow', offHand: null },
};
