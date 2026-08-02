// scripts/check-prefabs.mjs
// Guardrail runner over every built-in creature body: asserts each prefab is a
// single connected piece (no limb/eye/hat floating off the body) and still
// satisfies the shared creature schema. Covers monster prefabs
// (src/generators/monsterPresets.js) AND humanoid character/NPC prefabs
// (src/generators/characterPresets.js).
//
// Run this after ANY change to either preset file — detached parts are
// invisible while editing one body-part tab and only show up once the creature
// is assembled, so eyeballing renders is not a reliable check.
//
// It also checks the weapon system, because a weapon that fails to build or a
// grip that points at a hand the body doesn't have is the same class of silent
// authoring bug: the character just appears empty-handed.
//
//   node scripts/check-prefabs.mjs
//
// Exits non-zero if anything is detached or invalid, so it can gate CI later.
import { BODY_PRESETS } from '../src/generators/monsterPresets.js';
import { CHARACTER_PRESETS } from '../src/generators/characterPresets.js';
import { findDetachedParts } from '../src/generators/monsterConnectivity.js';
import { parseCreatureTypeDefs } from '../src/sim/creatureTypeDefs.js';
import { WEAPON_TYPES, WEAPON_TYPE_IDS, handForWeapon, validateLoadout } from '../src/sim/weaponTypes.js';
import { generateWeapon } from '../src/generators/weapon.js';
import { buildCreatureRig } from '../src/generators/creatureRig.js';
import { applyIdlePose } from '../src/generators/rig.js';
import * as THREE from 'three';

/** How far a held weapon may dip below the ground plane at rest, in world units. */
const FLOOR_TOLERANCE = 0.03;

const STUB_STATS = { maxHealth: 30, damage: 5, speed: 1.6, aggroRange: 8, attackRange: 1.6, attackCooldownMs: 1400 };

let detachedTotal = 0;
let invalidTotal = 0;

/** @param {object} type a full creature type, ready to validate + assemble */
function checkBody(type, label) {
  let schema = 'ok';
  try {
    parseCreatureTypeDefs([type]);
  } catch (err) {
    schema = `INVALID (${err.message})`;
    invalidTotal++;
  }

  const detached = findDetachedParts(type);
  detachedTotal += detached.length;

  const connectivity = detached.length
    ? `DETACHED: ${detached.map((d) => `${d.role}/${d.shapeId}`).join(', ')}`
    : 'connected';

  console.log(`  ${label.padEnd(18)} ${schema === 'ok' ? '' : schema + ' '}${connectivity}`);
}

console.log('Monster prefabs');
for (const preset of BODY_PRESETS) {
  checkBody({ ...preset, kind: 'monster', configuredLevel: 2, abilitySlots: [], baseStats: STUB_STATS }, preset.name);
}

console.log('\nCharacter / NPC prefabs');
for (const preset of CHARACTER_PRESETS) {
  checkBody(preset, `${preset.name} (${preset.kind})`);
}

// --- Weapons ---------------------------------------------------------------
// Every declared weapon type must actually build a mesh, and every prefab's
// loadout must be legal and land in a hand its body actually has.
console.log('\nWeapons  (net pitch = arm hold + grip; a ranged weapon must land near 0deg or it aims at the sky)');
let weaponProblems = 0;
for (const def of WEAPON_TYPES) {
  const mesh = generateWeapon(def.id);
  if (!mesh) {
    console.log(`  ${def.id.padEnd(12)} NO MESH — declared in weaponTypes.js but no builder in weapon.js`);
    weaponProblems++;
    continue;
  }
  const hand = handForWeapon(def);

  // A weapon's mesh origin IS its grip point, so grip.position is a small nudge,
  // never a mount. The axis that matters is Y: sliding a weapon UP the shaft
  // lifts it out of the fist, which is what "they aren't holding it in their
  // hand" looks like. A forward (+Z) nudge is the opposite — it's required, so
  // the shaft stands in front of the forearm instead of hiding inside it.
  // A shield is exempt from both: it straps to the forearm, above the hand.
  const { x, y, z } = def.grip.position;
  const offset = Math.hypot(x, y, z);
  const isShield = def.family === 'shield';
  if (!isShield && Math.abs(y) > 0.05) {
    console.log(`  ${def.id.padEnd(12)} FLOATS OUT OF THE FIST: grip y=${y} — lean it or shorten the mesh, don't slide it up the shaft`);
    weaponProblems++;
    continue;
  }
  if (offset > (isShield ? 0.16 : 0.22)) {
    console.log(`  ${def.id.padEnd(12)} GRIP TOO FAR FROM THE FIST: offset ${offset.toFixed(3)}`);
    weaponProblems++;
    continue;
  }

  // These rigs have no wrist, so a weapon inherits its arm's pitch whole. For
  // bow/crossbow the grip must cancel it; for melee a lean is intentional.
  const armHold = def.hold[hand === 'handL' ? 'armL' : 'armR'] || {};
  const net = (armHold.x || 0) + def.grip.rotationDeg.x;
  const aimed = def.family === 'ranged';
  if (aimed && Math.abs(net) > 5) {
    console.log(`  ${def.id.padEnd(12)} AIMS OFF-LEVEL: net pitch ${net}deg — grip must cancel the arm's hold.x`);
    weaponProblems++;
    continue;
  }
  console.log(`  ${def.id.padEnd(12)} ${def.hands}H ${def.slot.padEnd(6)} -> ${hand.padEnd(5)} net pitch ${String(net).padStart(4)}deg  grip offset ${offset.toFixed(3)}`);
}

// --- Arms outside the body --------------------------------------------------
// The connectivity check above is satisfied by an arm buried in the chest (it
// is, after all, very connected). This is the separate question: does the
// visible limb actually CLEAR the torso? Three things push it back inside — too
// small a slot anchor, a fat arm, or an inward `z` roll in a weapon's hold pose.
// All three shipped at least once, and screenshots kept failing to settle it.
// Measured on the idle pose, in world space, per arm.
console.log('\nArms clear of the torso');
let armProblems = 0;
for (const preset of CHARACTER_PRESETS) {
  const { group, rig } = buildCreatureRig(preset);
  applyIdlePose(rig);
  group.updateMatrixWorld(true);
  const torso = group.children.find((c) => c.userData.slotRole === 'torso');
  const chest = torso?.children.find((c) => c.userData.shapeId === 'chest');
  if (!chest) continue;
  const chestEdge = new THREE.Box3().setFromObject(chest).max.x;

  for (const [role, sign] of [['armR', 1], ['armL', -1]]) {
    const upper = rig[role]?.children.find((c) => c.userData.shapeId === 'upper');
    if (!upper) continue;
    const b = new THREE.Box3().setFromObject(upper);
    const inner = sign > 0 ? b.min.x : -b.max.x; // the limb's face nearest the chest
    if (inner < chestEdge - 0.005) {
      console.log(`  ${preset.id.padEnd(18)} ${role} INSIDE THE TORSO by ${(chestEdge - inner).toFixed(3)} — widen the slot anchor, or flatten the hold's z roll`);
      armProblems++;
    }
  }
}
if (!armProblems) console.log('  all arms clear');

console.log('\nPrefab loadouts');
for (const preset of CHARACTER_PRESETS) {
  const { mainHand = null, offHand = null } = preset.equipment || {};
  const problem = validateLoadout(mainHand, offHand);
  if (problem) {
    console.log(`  ${preset.id.padEnd(18)} INVALID: ${problem}`);
    weaponProblems++;
    continue;
  }
  // Assemble the real rig and count what actually ended up in a hand — a grip
  // that resolves to a hand this body lacks would silently drop the weapon.
  const { group, rig, hands } = buildCreatureRig(preset);
  const held = Object.entries(hands)
    .flatMap(([role, h]) => h.children.map((c) => `${role}:${c.userData.weaponTypeId}`));
  const expected = [mainHand, offHand].filter(Boolean).length;
  if (held.length !== expected) {
    console.log(`  ${preset.id.padEnd(18)} DROPPED a weapon: expected ${expected}, held ${held.length} [${held.join(', ')}]`);
    weaponProblems++;
    continue;
  }

  // Does the weapon clear the floor at rest? These arms are short; a blade
  // hanging straight down drives its tip through the ground, which reads as a
  // bug instantly on screen and not at all in the data.
  applyIdlePose(rig);
  group.updateMatrixWorld(true);
  let lowest = Infinity;
  for (const hand of Object.values(hands)) {
    for (const weapon of hand.children) {
      lowest = Math.min(lowest, new THREE.Box3().setFromObject(weapon).min.y);
    }
  }
  const clearance = lowest === Infinity ? null : lowest;
  if (clearance !== null && clearance < -FLOOR_TOLERANCE) {
    console.log(`  ${preset.id.padEnd(18)} CLIPS THE FLOOR: weapon reaches y=${clearance.toFixed(3)} — lean it back or lift the grip`);
    weaponProblems++;
    continue;
  }
  const clearNote = clearance === null ? '' : ` (clears floor by ${clearance.toFixed(3)})`;
  console.log(`  ${preset.id.padEnd(18)} ${held.length ? held.join(', ') : '(empty-handed)'}${clearNote}`);
}

const total = BODY_PRESETS.length + CHARACTER_PRESETS.length;
console.log(
  `\n${total} prefabs (${BODY_PRESETS.length} monster, ${CHARACTER_PRESETS.length} humanoid) — ` +
  `${detachedTotal} detached shape(s), ${invalidTotal} invalid, ${weaponProblems} weapon problem(s), ${armProblems} arm(s) inside the torso. ` +
  `${WEAPON_TYPE_IDS.length} weapon types.`
);

if (detachedTotal || invalidTotal || weaponProblems || armProblems) {
  console.error('\nFAIL: fix the above before shipping. A detached shape overlaps nothing else in the body —\nmove it so it genuinely interpenetrates a neighbouring shape (details like eyes must sit\nINSIDE the head surface, not float in front of it; limbs must reach back into the torso).');
  process.exit(1);
}
console.log('PASS');
