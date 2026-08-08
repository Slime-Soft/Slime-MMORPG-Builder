// src/sim/gearVisuals.js
// The visual half of an equipment item: the primitive shapes it hangs off a
// wearer's body, which body shapes it hides while worn, and an optional glow.
//
// WHY THIS IS A SEPARATE MODULE FROM authoredItems.js. An item's *stats* and an
// item's *look* are authored by different people at different times and
// validated against completely different vocabularies — one is the GSE stat
// list, the other is the shape/slot vocabulary every rigged body in this
// project already shares (src/sim/shapeKinds.js, src/sim/creatureTypeDefs.js's
// SLOT_ROLES). Keeping the look in its own module means the Equipment Builder
// imports exactly this and the World Editor's Items mode imports exactly
// authoredItems.js, instead of both pulling the whole union.
//
// HOW IT RENDERS. `mergeGearAppearances` is pure data-in/data-out: it takes a
// CreatureTypeDef (a body) plus the appearances of everything worn, and returns
// a NEW body whose slots carry the gear's shapes alongside their own. Nothing
// here knows about Three — the merged body then goes through the exact same
// buildCreatureRig path an unequipped body does, so gear animates with the
// walk cycle for free and there is no second rendering path to keep in sync.
//
// COORDINATE SPACE. A gear part's shapes are authored in the SAME local space
// as the body slot's own shapes: relative to that slot's anchor (the joint).
// A chest piece's shapes are positioned around the torso pivot exactly the way
// the torso's own box is. That's what lets a glove swing with the arm.
import { SHAPE_KINDS } from './shapeKinds.js';

/**
 * Body slots gear may attach to. A deliberate subset of
 * creatureTypeDefs.js's SLOT_ROLES — the humanoid roles a player body actually
 * has. Tails and the extra quadruped leg pairs are monster anatomy; there is
 * no player body with them to author against.
 */
export const GEAR_ATTACH_ROLES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

/**
 * The visual armor slots — the five the equipment panel renders on the body.
 * mainHand/offHand are visual too, but a weapon's mesh comes from the
 * procedural weapon catalog (src/sim/weaponTypes.js) rather than from authored
 * shapes, so it isn't in this list; a weapon item's `appearance` carries only
 * a glow (see parseGearAppearance's note on empty `parts`).
 */
export const GEAR_VISUAL_SLOTS = ['head', 'chest', 'gloves', 'pants', 'shoes'];

/**
 * Which body roles a given equip slot is EXPECTED to touch. Purely an
 * authoring convenience — the Equipment Builder opens these roles first and
 * greys the rest — never enforced, because real armor doesn't respect it: a
 * chest piece with pauldrons legitimately reaches onto both arms, and a pair
 * of pants with a belt legitimately reaches onto the torso.
 */
export const SUGGESTED_ROLES_FOR_SLOT = {
  head: ['head'],
  chest: ['torso', 'armL', 'armR'],
  gloves: ['armL', 'armR'],
  pants: ['legL', 'legR', 'torso'],
  shoes: ['legL', 'legR'],
  mainHand: [],
  offHand: [],
  neck: ['torso'],
  ring: [],
  earring: ['head'],
};

/**
 * The body shapes each equip slot REPLACES.
 *
 * THE BUG THIS EXISTS TO FIX, because it is not obvious and it looked like a
 * renderer problem: gear used to be drawn ON TOP OF the class body's own
 * clothing. A Warrior's torso already carries a `chest` box, a `belt` and
 * three `scale` plates; laying a cuirass over them put two opaque faces
 * 5–10 mm apart, and the depth buffer cannot choose between two faces that
 * close. In game that is a hard flicker that crawls as the camera moves —
 * reported as "there is a lot of flickering going on", and no amount of
 * material or blending work fixes it, because the geometry itself is the
 * problem. Armor has to REPLACE the outfit underneath it, not cover it.
 *
 * Listed by id, generously, as the union across every body in the catalog
 * (the six classes' clothed presets plus the anime `adventurer-*` bodies).
 * Hiding an id a given body doesn't have is a silent no-op, so one list serves
 * every body without the piece having to know which one it's worn on.
 *
 * SKIN AND FACE ARE NEVER LISTED. `head`, `eyeL`/`eyeR`, `earL`/`earR` and
 * `neck` stay visible under everything — a helm frames a face, it doesn't
 * delete it — and the wearer's chosen skin tone goes on showing through.
 */
export const BODY_COVERAGE_BY_SLOT = {
  // Hats only. Hair is listed separately (HAIR_SHAPE_IDS) because an open
  // ranger's cap should leave a ponytail showing while a closed helm shouldn't.
  head: [
    'helmTop', 'helmBack', 'helmL', 'helmR', 'nasal', 'crest',
    'brim', 'cone', 'tip', 'fold', 'cap', 'capBrim', 'feather',
    'hoodTop', 'hoodBack', 'hoodL', 'hoodR', 'hoodBrow',
  ],
  // The whole worn upper body, plus the shoulder ball — a pauldron/spaulder/
  // sleeve is what welds the arm to the torso once the body's own `shoulder`
  // is gone, so a chest piece MUST provide one (every style below does).
  chest: [
    'chest', 'collar', 'placket', 'gorget', 'scaleA', 'scaleB', 'scaleC',
    'strapL', 'strapR', 'buckle', 'sash', 'gem', 'stole', 'amulet', 'trim', 'skirt',
    'shoulder', 'pauldron',
  ],
  // The forearm and fist. `upper` (the sleeve) belongs to the chest piece and
  // stays — gloves are not a full arm replacement.
  gloves: ['hand', 'bracer', 'cuff', 'vambrace'],
  // Legs and the waist that sits on top of them. `hip` goes too, so every
  // pants style has to carry its own hip ball for the same weld reason.
  pants: ['belt', 'tasset', 'hip', 'thigh', 'shin'],
  shoes: ['boot', 'bootTop', 'bootCuff', 'bootSole', 'greave'],
  // Nothing worn on these covers authored body geometry.
  neck: [], ring: [], earring: [], mainHand: [], offHand: [],
};

/**
 * Every hair shape id across playerCharacter.js's HAIR_STYLES (including the
 * anime ones), plus the beard and moustache — a closed helm covers a chin as
 * surely as it covers a fringe, and the bearded body's `stache` sits in exactly
 * the same 1cm of space a nasal bar does. A fully enclosing helm adds all of
 * these to its coverage; an open cap doesn't. Kept here rather than imported
 * from the generator so this module stays free of any src/generators dependency
 * (see check-architecture).
 */
export const HAIR_SHAPE_IDS = [
  'hairTop', 'hairBack', 'hairSideL', 'hairSideR',
  'hairBun', 'hairTail1', 'hairTail2', 'hairSpike1', 'hairSpike2', 'hairSpike3',
  'hairCap', 'hairBangs', 'hairTuftL', 'hairTuftR',
  'hairFringe', 'hairSwoop', 'hairTwinL', 'hairTwinR',
  'beard', 'stache',
];

/** The default coverage for a slot: what a piece worn there should hide. `enclosed` adds hair, for a closed helm or a deep hood. */
export function defaultCoverageFor(slot, { enclosed = false } = {}) {
  const base = BODY_COVERAGE_BY_SLOT[slot] || [];
  return slot === 'head' && enclosed ? [...base, ...HAIR_SHAPE_IDS] : [...base];
}

/**
 * An enchantment glow is a PARTICLE effect on a held weapon, and only on a
 * held weapon.
 *
 * Both halves of that were a correction. The first version put a glow on any
 * piece, and drew it as an inflated back-face copy of the gear's own shapes —
 * which is exactly what it looked like: a hard silhouette of the armor,
 * jittering. Real weapon enchants (the thing this is modelled on) are a drift
 * of glowing particles hugging the blade, and they appear on weapons and
 * shields only — armor is armor, its material does the talking.
 *
 * TWO INDEPENDENT KNOBS, which is the whole point of the split:
 *
 *   `style` — WHAT the particles are and how they move. This is the effect's
 *     identity: a flame rises and dies fast, snow falls and drifts sideways,
 *     lightning barely exists between crackles. Each style also picks the
 *     sprite the particles are drawn with (a wisp, a six-armed flake, a
 *     spark), because a snowflake made of soft round blobs is not a snowflake.
 *
 *   `mode` — the brightness ENVELOPE over the whole cloud: even, breathing, or
 *     unstable. Orthogonal to style, so a steady flame and a pulsing flame are
 *     both available without needing two styles for it.
 *
 * They were one field before adding these, which is why every enchantment
 * moved identically no matter what colour it was.
 */
export const GLOW_MODES = ['none', 'steady', 'pulse', 'flicker'];

/**
 * The particle archetypes. Motion, sprite and blending live in
 * src/generators/weaponEnchant.js's STYLE_TUNING — this list is the vocabulary
 * the schema validates and the builder offers.
 *
 *   motes     — soft round lights drifting up the blade. The generic enchant.
 *   flame     — teardrop wisps rising fast, shrinking, wandering sideways.
 *   frost     — six-armed flakes FALLING and swaying, slow and long-lived.
 *   lightning — sparse crackling sparks that jump position and strobe.
 *   embers    — small hot specks, rising and dying like a fire's spark trail.
 *   sparkle   — four-point twinkle stars, near-stationary, winking in and out.
 *   smoke     — wide soft puffs that GROW as they fade. The one normal-blended
 *               style: additive black is invisible, and shadow magic that
 *               brightens what is behind it reads as fog, not as shadow.
 */
export const GLOW_STYLES = ['motes', 'flame', 'frost', 'lightning', 'embers', 'sparkle', 'smoke'];

/** Sensible enchantments the Equipment Builder offers as one-click starting points. */
export const GLOW_PRESETS = [
  { id: 'none', name: 'None', glow: null },
  { id: 'flame', name: 'Flametongue', glow: { style: 'flame', mode: 'flicker', color: 0xffd08a, secondaryColor: 0xc42a06, intensity: 1.0, density: 40, size: 0.11, speed: 1.5 } },
  { id: 'frost', name: 'Frostbrand', glow: { style: 'frost', mode: 'steady', color: 0xdff4ff, secondaryColor: 0x3a8fd9, intensity: 0.6, density: 34, size: 0.085, speed: 0.7 } },
  { id: 'lightning', name: 'Thunderstruck', glow: { style: 'lightning', mode: 'flicker', color: 0xeaf4ff, secondaryColor: 0x4a7aff, intensity: 0.9, density: 22, size: 0.1, speed: 2.2 } },
  { id: 'embers', name: 'Emberforged', glow: { style: 'embers', mode: 'flicker', color: 0xffb45a, secondaryColor: 0x8a1a02, intensity: 0.95, density: 34, size: 0.055, speed: 1.4 } },
  { id: 'holy', name: 'Holy Gold', glow: { style: 'sparkle', mode: 'pulse', color: 0xffe9b0, secondaryColor: 0xd98a1a, intensity: 0.75, density: 24, size: 0.1, speed: 0.9 } },
  { id: 'arcane', name: 'Arcane Violet', glow: { style: 'motes', mode: 'pulse', color: 0xc79aff, secondaryColor: 0x6a2ad9, intensity: 0.8, density: 30, size: 0.075, speed: 1.0 } },
  { id: 'venom', name: 'Venom Green', glow: { style: 'motes', mode: 'pulse', color: 0xc4ff8a, secondaryColor: 0x2a9a1a, intensity: 0.75, density: 28, size: 0.07, speed: 1.2 } },
  { id: 'shadow', name: 'Shadowveil', glow: { style: 'smoke', mode: 'steady', color: 0x6a4a9a, secondaryColor: 0x140a24, intensity: 0.5, density: 22, size: 0.16, speed: 0.6 } },
  { id: 'void', name: 'Void', glow: { style: 'motes', mode: 'pulse', color: 0xb07aff, secondaryColor: 0x1a0a3a, intensity: 0.9, density: 32, size: 0.085, speed: 0.5 } },
  { id: 'lifesteal', name: 'Lifesteal Red', glow: { style: 'embers', mode: 'pulse', color: 0xff8a8a, secondaryColor: 0x8a0a0a, intensity: 0.85, density: 28, size: 0.07, speed: 0.9 } },
  { id: 'spirit', name: 'Spirit Wisp', glow: { style: 'sparkle', mode: 'pulse', color: 0xbdf5e8, secondaryColor: 0x2a8a8a, intensity: 0.7, density: 20, size: 0.11, speed: 0.7 } },
];

/**
 * @typedef {Object} GearGlow
 * @property {'none'|'steady'|'pulse'|'flicker'} mode brightness envelope over the whole cloud
 * @property {'motes'|'flame'|'frost'|'lightning'|'embers'|'sparkle'|'smoke'} [style] what the particles are and how they move (default 'motes')
 * @property {number} color hex int — the colour a particle is born at (the bright core)
 * @property {number} [secondaryColor] hex int — the colour it fades to as it dies. Defaults to `color`, which reads flatter; a second colour is what gives the effect depth.
 * @property {number} [intensity] emissive added to the weapon's own metal, 0..2 (default 0.7). This is the lit blade under the particles, not the particles themselves.
 * @property {number} [density] how many particles live around the weapon at once (default 28)
 * @property {number} [size] a particle's world-space radius in metres (default 0.075)
 * @property {number} [speed] drift/animation rate multiplier (default 1)
 * @property {{x?:number,y?:number,z?:number}} [offset] moves the emission volume in the WEAPON's local space, in metres (+Y runs up the weapon toward a staff's orb — see src/generators/weapon.js)
 * @property {{x?:number,y?:number,z?:number}} [extent] the emission volume's width/height/length in metres. An axis left out or set to 0 is measured from the weapon instead, so you can widen a cloud without restating its length.
 */

/**
 * @typedef {Object} GearPart
 * @property {string} role one of GEAR_ATTACH_ROLES
 * @property {import('./creatureTypeDefs.js').ShapeDef[]} shapes authored in the slot's own local space
 */

/**
 * @typedef {Object} GearAppearance
 * @property {GearPart[]} parts
 * @property {string[]} [hideBodyShapes] ids of the WEARER's own shapes to hide while this is worn — a full helm hiding `hairTop`/`hairBack`, boots hiding a bare `shin`
 * @property {GearGlow} [glow] weapon/shield only — the enchantment particle effect
 * @property {{position?:object, rotationDeg?:object, scale?:number}} [gripOffset] weapon/shield only — a per-item nudge on top of the weapon TYPE's shared grip (src/sim/weaponTypes.js)
 * @property {string} [referenceBodyId] the character-types row this was authored against, so the builder reopens on the same body. Cosmetic bookkeeping; nothing at runtime reads it.
 */

const isFiniteNum = (v) => typeof v === 'number' && Number.isFinite(v);

function validateVec3(v, label, field) {
  if (v === undefined) return;
  if (!v || typeof v !== 'object') throw new Error(`${label} ${field} must be an object`);
  for (const axis of ['x', 'y', 'z']) {
    if (v[axis] !== undefined && !isFiniteNum(v[axis])) throw new Error(`${label} ${field}.${axis} must be a number`);
  }
}

/**
 * Validates one gear shape. Deliberately a SUPERSET of creatureTypeDefs.js's
 * ShapeDef rather than a reuse of its validator: gear shapes additionally carry
 * material fields (emissive/metalness/roughness) that a plain body shape has no
 * use for, and the two validators are not otherwise coupled.
 */
function validateGearShape(shape, label) {
  if (!shape || typeof shape !== 'object') throw new Error(`${label} has a non-object shape`);
  if (!shape.id || typeof shape.id !== 'string') throw new Error(`${label} has a shape with no id`);
  if (!SHAPE_KINDS.includes(shape.kind)) throw new Error(`${label} shape "${shape.id}" has unknown kind "${shape.kind}"`);
  validateVec3(shape.position, label, `shape "${shape.id}" position`);
  validateVec3(shape.scale, label, `shape "${shape.id}" scale`);
  if (shape.rotation !== undefined && !isFiniteNum(shape.rotation)) validateVec3(shape.rotation, label, `shape "${shape.id}" rotation`);
  for (const field of ['color', 'emissive']) {
    if (shape[field] !== undefined && !Number.isInteger(shape[field])) throw new Error(`${label} shape "${shape.id}" ${field} must be a hex integer`);
  }
  for (const field of ['opacity', 'emissiveIntensity', 'metalness', 'roughness']) {
    if (shape[field] !== undefined && !isFiniteNum(shape[field])) throw new Error(`${label} shape "${shape.id}" ${field} must be a number`);
  }
}

function validateGlow(glow, label) {
  if (!glow || typeof glow !== 'object') throw new Error(`${label} glow must be an object`);
  if (!GLOW_MODES.includes(glow.mode)) throw new Error(`${label} glow has unknown mode "${glow.mode}"`);
  // Optional, defaulting to 'motes' — every glow authored before styles existed
  // has no `style` and must keep rendering exactly as it did.
  if (glow.style !== undefined && !GLOW_STYLES.includes(glow.style)) {
    throw new Error(`${label} glow has unknown style "${glow.style}"`);
  }
  for (const field of ['color', 'secondaryColor']) {
    if (glow[field] !== undefined && !Number.isInteger(glow[field])) throw new Error(`${label} glow ${field} must be a hex integer`);
  }
  for (const field of ['intensity', 'density', 'size', 'speed']) {
    if (glow[field] !== undefined && !isFiniteNum(glow[field])) throw new Error(`${label} glow ${field} must be a number`);
  }
  validateVec3(glow.offset, label, 'glow.offset');
  validateVec3(glow.extent, label, 'glow.extent');
  for (const axis of ['x', 'y', 'z']) {
    // Negative is not "the other direction", it is an inside-out box — the
    // emission maths would put min above max and spawn nothing at all.
    if (glow.extent?.[axis] !== undefined && glow.extent[axis] < 0) {
      throw new Error(`${label} glow.extent.${axis} cannot be negative (use 0 to measure it from the weapon)`);
    }
  }
  if (glow.density !== undefined && (glow.density < 0 || glow.density > 200)) {
    // A ceiling rather than a clamp: 200 motes on one weapon is already far
    // past where it reads as an enchantment, and a fat-fingered 20000 in the
    // builder would allocate that buffer on every character wearing it.
    throw new Error(`${label} glow density must be between 0 and 200`);
  }
}

/**
 * Validates a GearAppearance in place and returns it.
 *
 * An appearance with NO parts is legal and meaningful: that's a weapon (whose
 * mesh comes from the procedural weapon catalog) carrying nothing but a glow,
 * and it's also the natural intermediate state of a piece someone has started
 * authoring. A malformed one throws, so /api/items rejects it rather than the
 * client crashing on the shape soup later.
 *
 * @param {any} appearance
 * @param {string} label prefix for error messages, e.g. `Authored item "x"`
 * @returns {GearAppearance}
 */
export function parseGearAppearance(appearance, label) {
  if (!appearance || typeof appearance !== 'object') throw new Error(`${label} appearance must be an object`);
  const parts = appearance.parts ?? [];
  if (!Array.isArray(parts)) throw new Error(`${label} appearance.parts must be an array`);
  const seenRoles = new Set();
  for (const part of parts) {
    if (!part || typeof part !== 'object') throw new Error(`${label} has a non-object appearance part`);
    if (!GEAR_ATTACH_ROLES.includes(part.role)) throw new Error(`${label} appearance part has unknown role "${part.role}"`);
    if (seenRoles.has(part.role)) throw new Error(`${label} appearance has two parts for role "${part.role}"`);
    seenRoles.add(part.role);
    if (!Array.isArray(part.shapes)) throw new Error(`${label} appearance part "${part.role}" shapes must be an array`);
    for (const shape of part.shapes) validateGearShape(shape, `${label} appearance part "${part.role}"`);
  }
  if (appearance.hideBodyShapes !== undefined) {
    if (!Array.isArray(appearance.hideBodyShapes) || appearance.hideBodyShapes.some((s) => typeof s !== 'string')) {
      throw new Error(`${label} appearance.hideBodyShapes must be an array of shape ids`);
    }
  }
  if (appearance.glow !== undefined && appearance.glow !== null) validateGlow(appearance.glow, label);
  if (appearance.gripOffset !== undefined && appearance.gripOffset !== null) {
    const g = appearance.gripOffset;
    if (typeof g !== 'object') throw new Error(`${label} appearance.gripOffset must be an object`);
    validateVec3(g.position, label, 'gripOffset.position');
    validateVec3(g.rotationDeg, label, 'gripOffset.rotationDeg');
    if (g.scale !== undefined && (!isFiniteNum(g.scale) || g.scale <= 0)) {
      throw new Error(`${label} appearance.gripOffset.scale must be a positive number`);
    }
  }
  return appearance;
}

/** The L/R counterpart of an attach role, or null for a role that has none (head/torso). */
export function mirrorRoleOf(role) {
  if (role.endsWith('L')) return `${role.slice(0, -1)}R`;
  if (role.endsWith('R')) return `${role.slice(0, -1)}L`;
  return null;
}

/**
 * Mirror a part's shapes across the body's X axis, for authoring the second
 * glove/boot/pauldron from the first.
 *
 * Mirroring happens at AUTHOR time (the builder writes both parts into the
 * saved data), not at render time, so a piece that genuinely wants asymmetry —
 * one spiked pauldron, a single vambrace — is still just data, with no
 * "mirrored except…" flag for the renderer to interpret.
 *
 * x position flips; y and z roll on. Of the rotations only x survives
 * unchanged: y and z both describe a handedness (a swept horn, a canted plate)
 * and must invert or the mirrored piece leans the wrong way.
 */
export function mirrorGearShapes(shapes) {
  return (shapes || []).map((s) => {
    const out = structuredClone(s);
    if (out.position) out.position = { ...out.position, x: -(out.position.x ?? 0) };
    if (out.rotation && typeof out.rotation === 'object') {
      out.rotation = { x: out.rotation.x ?? 0, y: -(out.rotation.y ?? 0), z: -(out.rotation.z ?? 0) };
    } else if (isFiniteNum(out.rotation)) {
      out.rotation = -out.rotation; // the legacy single-number form is Y-only
    }
    return out;
  });
}

/**
 * The id a gear shape gets once merged onto a body.
 *
 * Namespaced for two reasons that both bite otherwise. First, two items worn
 * at once (a helm and a hood) can each hold a shape called `plate`, and the
 * merged slot would then have two shapes with one id — which the Model Editor's
 * selection, and hideBodyShapes itself, resolve by id. Second,
 * playerCharacter.js's tintRoleOf assigns skin/hair/eye colour BY SHAPE ID
 * PREFIX: a gauntlet whose shape happened to be called `hand` would be
 * repainted in the wearer's skin tone. Nothing here starts with `hair`/`head`/
 * `hand`/`eye`, so gear keeps the colour it was authored with.
 */
export function gearShapeId(itemId, shapeId) {
  return `gear:${itemId}:${shapeId}`;
}

/** Is this a merged gear shape (as opposed to one of the body's own)? */
export function isGearShapeId(id) {
  return typeof id === 'string' && id.startsWith('gear:');
}

/**
 * Fold a set of worn items' appearances into a body, returning a NEW
 * CreatureTypeDef. The input is never mutated — the catalog row it came from is
 * shared with the builder and the live game.
 *
 * Order matters and is the caller's: `worn` is applied front to back, so a
 * later item's shapes render alongside (not instead of) an earlier one's, and
 * every item's hideBodyShapes applies to the body regardless of position.
 *
 * A part whose role the body doesn't have is silently dropped rather than
 * throwing — a pauldron authored on `armL` worn by something armless is a
 * cosmetic mismatch, not a broken save, and this same function runs on the
 * server's validation path where a throw would take the request down.
 *
 * @param {import('./creatureTypeDefs.js').CreatureTypeDef} creatureType
 * @param {Array<{itemId:string, appearance:GearAppearance}>} worn
 */
export function mergeGearAppearances(creatureType, worn) {
  if (!worn || !worn.length) return creatureType;

  const hidden = new Set();
  for (const { appearance } of worn) {
    for (const id of appearance?.hideBodyShapes || []) hidden.add(id);
  }

  const shapesByRole = new Map();
  for (const { itemId, appearance } of worn) {
    for (const part of appearance?.parts || []) {
      if (!shapesByRole.has(part.role)) shapesByRole.set(part.role, []);
      const bucket = shapesByRole.get(part.role);
      for (const shape of part.shapes) {
        bucket.push({ ...structuredClone(shape), id: gearShapeId(itemId, shape.id) });
      }
    }
  }
  if (!hidden.size && !shapesByRole.size) return creatureType;

  const out = structuredClone(creatureType);
  for (const slot of out.slots) {
    if (hidden.size) slot.shapes = slot.shapes.filter((s) => !hidden.has(s.id));
    const added = shapesByRole.get(slot.role);
    if (added) slot.shapes.push(...structuredClone(added));
  }
  return out;
}

/**
 * How each HELD WEAPON should render, given what's equipped: its enchantment
 * and its per-item grip nudge.
 *
 * A weapon has no authored shapes for either to ride on (its mesh comes from
 * the procedural catalog), so both travel separately down to generateWeapon.
 * Returns `{mainHand, offHand}` keyed the same way equipment.js's
 * equipmentToWeaponLoadout is, so the two are read together.
 *
 * @param {{mainHand:string|null, offHand:string|null}} equipment concrete weapon slot -> itemId
 * @param {Object<string, {appearance?:GearAppearance}>} itemDefById
 * @returns {{mainHand:{glow:GearGlow|null, gripOffset:object|null}, offHand:{glow:GearGlow|null, gripOffset:object|null}}}
 */
export function weaponRenderLoadout(equipment, itemDefById) {
  const forHand = (itemId) => {
    const appearance = itemId ? itemDefById?.[itemId]?.appearance : null;
    const glow = appearance?.glow;
    return {
      glow: glow && glow.mode !== 'none' ? glow : null,
      gripOffset: appearance?.gripOffset || null,
    };
  };
  return { mainHand: forHand(equipment?.mainHand), offHand: forHand(equipment?.offHand) };
}

/**
 * Everything worn that has a visual, in a shape mergeGearAppearances takes.
 * Weapons are excluded on purpose: their mesh comes from the weapon catalog and
 * their glow travels via weaponRenderLoadout, so including them here would merge
 * an empty parts list and, worse, apply a weapon's hideBodyShapes to the body.
 *
 * @param {Object<string, string|null>} equipment concrete slot -> itemId (src/sim/equipment.js's EquipmentState)
 * @param {Object<string, {type?:string, appearance?:GearAppearance}>} itemDefById
 */
export function wornGearVisuals(equipment, itemDefById) {
  const out = [];
  for (const [slot, itemId] of Object.entries(equipment || {})) {
    if (!itemId || slot === 'mainHand' || slot === 'offHand') continue;
    const def = itemDefById?.[itemId];
    if (!def?.appearance?.parts?.length && !def?.appearance?.hideBodyShapes?.length) continue;
    out.push({ itemId, appearance: def.appearance });
  }
  return out;
}
