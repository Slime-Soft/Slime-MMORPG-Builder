// src/generators/playerCharacter.js
// A player character = a class body from the Character & NPC Builder catalog,
// plus the appearance the player chose (hair style, hair dye, skin tone, eye
// colour). One function builds it, and it's the same function the character
// creator previews and the game renders, so what you pick is what you get.
//
// Appearance is applied by TINT ROLE rather than by editing the presets: a shape
// is skin, hair, or eye based on its id (see tintRoleOf). That keeps the body
// presets editable in the builder without every colour choice having to be
// re-authored there, and means a Warlock's dark robe stays a dark robe while his
// hands and face follow the player's skin tone.
import { buildCreatureRig } from './creatureRig.js';
import { CHARACTER_PRESETS } from './characterPresets.js';
import { ANIME_HAIR_SHAPES, ANIME_HAIR_STYLES } from './animeCharacter.js';

export const HAIR_STYLES = ['short', 'long', 'ponytail', 'spiky', 'bun', 'bald', ...ANIME_HAIR_STYLES];

// Gender is a body-proportion toggle, not a re-authored body — same spirit as
// the old generateCharacter's gender-sized chibi body, but applied as a single
// scale on the whole assembled rig instead of moving individual slot anchors.
// A non-uniform scale on the OUTER group can't disconnect anything: every
// child's position/geometry is multiplied by the same factor, so two shapes
// that touched before scaling still touch after — unlike per-anchor tweaks,
// which is exactly what caused the floating-limb bugs documented elsewhere in
// this codebase (see PROJECT_STATUS.md's connectivity-guard history).
export const GENDERS = ['masc', 'fem'];
export const GENDER_LABELS = { masc: 'Masculine', fem: 'Feminine' };
const GENDER_BODY_SCALE = {
  masc: { x: 1.04, y: 1.03, z: 1.04 },
  fem: { x: 0.95, y: 0.98, z: 0.93 },
};

export const HAIR_COLORS = [
  0x2a1d14, 0x4a3020, 0x6b4a2a, 0xa9713f, 0xd9b24a, 0xe8e2d0,
  0x9a9a9a, 0xb0402a, 0x3f6bc5, 0x4a9a5a, 0x8a3fc5, 0xd94f9f,
];
export const SKIN_TONES = [0xf2d3b0, 0xe8b98a, 0xd9a066, 0xc9945f, 0xa9713f, 0x7a4a28, 0x5a3420];
export const EYE_COLORS = [0x2a2a35, 0x3a6b3a, 0x3a5ab0, 0x8a5a2a, 0x5a3ab0, 0x2a8a8a, 0xb03a3a];

/** shape helper, matching characterPresets' compact form. */
function sh(id, kind, p, s, color, r) {
  const o = { id, kind, position: { x: p[0], y: p[1], z: p[2] }, scale: { x: s[0], y: s[1], z: s[2] }, color };
  if (r) o.rotation = { x: r[0], y: r[1], z: r[2] };
  return o;
}

// Hair sits around the head box, which spans +/-0.25 in x and y and +/-0.23 in
// z (see characterPresets' headBox). Every shape here is tagged `hair` by its id
// prefix, so the dye recolours all of it.
const HAIR_SHAPES = {
  bald: [],
  short: [
    sh('hairTop', 'box', [0, 0.19, 0], [0.54, 0.18, 0.5], 0),
    sh('hairBack', 'box', [0, 0.0, -0.19], [0.52, 0.36, 0.14], 0),
  ],
  long: [
    sh('hairTop', 'box', [0, 0.19, 0], [0.54, 0.18, 0.5], 0),
    sh('hairBack', 'box', [0, -0.1, -0.19], [0.52, 0.6, 0.14], 0),
    sh('hairSideL', 'box', [-0.25, -0.08, -0.02], [0.08, 0.42, 0.4], 0),
    sh('hairSideR', 'box', [0.25, -0.08, -0.02], [0.08, 0.42, 0.4], 0),
  ],
  ponytail: [
    sh('hairTop', 'box', [0, 0.19, 0], [0.54, 0.18, 0.5], 0),
    sh('hairBack', 'box', [0, 0.0, -0.19], [0.52, 0.36, 0.14], 0),
    sh('hairTail1', 'capsule', [0, -0.02, -0.32], [0.16, 0.34, 0.16], 0, [24, 0, 0]),
    sh('hairTail2', 'capsule', [0, -0.28, -0.42], [0.12, 0.28, 0.12], 0, [14, 0, 0]),
  ],
  spiky: [
    sh('hairTop', 'box', [0, 0.16, 0], [0.52, 0.14, 0.48], 0),
    sh('hairBack', 'box', [0, 0.0, -0.19], [0.5, 0.32, 0.12], 0),
    sh('hairSpike1', 'cone', [-0.14, 0.32, 0.06], [0.14, 0.26, 0.14], 0, [-16, 0, 18]),
    sh('hairSpike2', 'cone', [0.02, 0.34, -0.02], [0.14, 0.3, 0.14], 0, [-8, 0, 0]),
    sh('hairSpike3', 'cone', [0.16, 0.32, 0.04], [0.14, 0.26, 0.14], 0, [-16, 0, -18]),
  ],
  bun: [
    sh('hairTop', 'box', [0, 0.19, 0], [0.54, 0.18, 0.5], 0),
    sh('hairBack', 'box', [0, 0.0, -0.19], [0.52, 0.36, 0.14], 0),
    sh('hairBun', 'sphere', [0, 0.26, -0.22], [0.24, 0.24, 0.24], 0),
  ],
  // The anime styles are authored against the SMALLER anime head (0.44 x 0.46 x
  // 0.42) rather than the 0.5 head the six original classes use. They're
  // offered on every body regardless — on an older class they sit very
  // slightly tight, which is a cosmetic mismatch, not a broken body.
  ...ANIME_HAIR_SHAPES,
};

/**
 * Which appearance colour a shape takes, by id. Anything unlisted keeps the
 * colour the body preset gave it — that's the outfit, and it belongs to the
 * class, not to the player.
 */
export function tintRoleOf(shapeId) {
  if (shapeId.startsWith('hair') || shapeId === 'beard' || shapeId === 'stache') return 'hair';
  if (shapeId === 'eyeL' || shapeId === 'eyeR') return 'eye';
  // neck/ears are new with the anime body; thigh/shin are bare skin on it too.
  // Unknown ids on the older classes simply never match, so this stays additive.
  if (['head', 'hand', 'neck', 'earL', 'earR', 'thigh', 'shin'].includes(shapeId)) return 'skin';
  return null;
}

/** Head shapes that are hair, and therefore replaced by the chosen style. */
const isHairShape = (id) => id.startsWith('hair');

/**
 * @typedef {Object} Appearance
 * @property {'short'|'long'|'ponytail'|'spiky'|'bun'|'bald'} [hairStyle]
 * @property {number} [hairColor] hex
 * @property {number} [skinTone] hex
 * @property {number} [eyeColor] hex
 * @property {'masc'|'fem'} [gender]
 */

/**
 * Apply an appearance to a creature type, returning a NEW type. The input is
 * never mutated — the catalog entry is shared with the builder and the game.
 * @param {import('../sim/creatureTypeDefs.js').CreatureTypeDef} creatureType
 * @param {Appearance} appearance
 */
export function applyAppearance(creatureType, appearance = {}) {
  const {
    hairStyle = 'short',
    hairColor = HAIR_COLORS[1],
    skinTone = SKIN_TONES[1],
    eyeColor = EYE_COLORS[0],
  } = appearance;

  const tints = { hair: hairColor, skin: skinTone, eye: eyeColor };
  const out = structuredClone(creatureType);

  // Equipped-gear weapon override (src/sim/equipment.js's
  // equipmentToWeaponLoadout) — the class catalog's own `equipment` is a
  // fixed default loadout; a player's actually-equipped weapon takes
  // priority when present.
  //
  // `equipmentToWeaponLoadout` always returns BOTH keys, with an empty hand as
  // `null`, so the old plain object spread here silently wiped the class's
  // default loadout for every player carrying no weapon — which is exactly why
  // classes stopped wielding a starting weapon. An ENTIRELY empty override
  // means "this player has no real gear", so the class default stands.
  //
  // Once real gear IS held the override replaces the whole loadout rather than
  // merging per-hand, so equipping a two-hander doesn't leave a Guardian's
  // default shield floating in the off hand it can no longer use.
  if (appearance.equipmentOverride) {
    const { mainHand = null, offHand = null } = appearance.equipmentOverride;
    if (mainHand || offHand) out.equipment = { mainHand, offHand };
  }

  for (const slot of out.slots) {
    if (slot.role === 'head') {
      // Swap the preset's hair for the chosen style. Hats and helms are NOT
      // hair, so they survive: a Mage keeps his hat and still picks a haircut.
      slot.shapes = slot.shapes.filter((s) => !isHairShape(s.id));
      const hair = structuredClone(HAIR_SHAPES[hairStyle] || HAIR_SHAPES.short);
      slot.shapes.push(...hair);
    }
    for (const shape of slot.shapes) {
      const role = tintRoleOf(shape.id);
      if (role) shape.color = tints[role];
      // A shape carrying a `face` gets the player's choices written into it —
      // this is what makes eye colour and eye shape live parameters instead of
      // pre-authored variants. Anything the player didn't choose keeps whatever
      // the body preset (or the Character Builder's hand-tuning) set, so
      // authored faces aren't flattened by defaults.
      if (shape.face) {
        shape.face = {
          ...shape.face,
          skinTone,
          eyeColor,
          hairColor,
          // Face style follows the chosen gender unless explicitly overridden.
          // Without this every character got the feminine face (heavy lashes,
          // outer flick, blush) regardless of body.
          faceStyle: appearance.faceStyle || (appearance.gender === 'masc' ? 'masc' : 'fem'),
          ...(appearance.eyeStyle ? { eyeStyle: appearance.eyeStyle } : {}),
          ...(appearance.browStyle ? { browStyle: appearance.browStyle } : {}),
          ...(appearance.mouthStyle ? { mouthStyle: appearance.mouthStyle } : {}),
          ...(appearance.blush !== undefined ? { blush: appearance.blush } : {}),
          ...(appearance.eyeScale !== undefined ? { eyeScale: appearance.eyeScale } : {}),
          ...(appearance.eyeSpacing !== undefined ? { eyeSpacing: appearance.eyeSpacing } : {}),
          ...(appearance.eyeHeight !== undefined ? { eyeHeight: appearance.eyeHeight } : {}),
        };
      }
    }
  }
  return out;
}

/**
 * The body for a given catalog id — a player class OR an NPC prefab, since
 * both are rows in the same character-types catalog (see
 * src/sim/creatureTypeDefs.js). Falls back to the built-in presets when the
 * server catalog hasn't loaded (or has no row for that id), so the character
 * creator can never render an empty screen. Matches by id only (not
 * kind: 'character') so NPC-kind rows resolve here too — this is the one
 * function both the character creator and NPC rendering call.
 * @param {Array<object>} catalog rows from /api/character-types
 * @param {string} classId
 */
export function classBody(catalog, classId, gender, bodyId) {
  // An explicit body wins over the class's own. This is the first step of
  // CHARACTER_REDESIGN_CONCEPT.md's split: which BODY you wear stops being the
  // same decision as which CLASS you play. Class still governs abilities and
  // stats; it just no longer dictates the mesh. Falls through to the class body
  // if the id doesn't resolve, so a stale saved character can't render nothing.
  if (bodyId) {
    const chosen = resolveBody(catalog, bodyId, gender);
    // The weapon loadout does NOT follow the body — see
    // withClassDefaultWeapons. This lives here rather than in
    // buildPlayerCharacter so that every caller gets it: the equipment-panel
    // preview and the Character Builder both go through classBody +
    // applyAppearance directly, and a fix applied one level up would leave
    // those two rendering a bare-handed character while the world showed an
    // armed one.
    if (chosen) return withClassDefaultWeapons(catalog, classId, gender, chosen);
  }
  return resolveBody(catalog, classId, gender) || CHARACTER_PRESETS[0];
}

function resolveBody(catalog, id, gender) {
  // The anime body ships as TWO rows (adventurer-f / adventurer-m) because
  // masculine and feminine differ in actual shapes — a bust, a waist, hips —
  // not in a scale factor. Asking for the family id `adventurer` resolves to
  // the right one; asking for a concrete id still works, so the Character
  // Builder can open either row directly for hand-tuning.
  if (id === 'adventurer') id = gender === 'masc' ? 'adventurer-m' : 'adventurer-f';
  return (catalog || []).find((c) => c.id === id) || CHARACTER_PRESETS.find((c) => c.id === id) || null;
}

/**
 * A player's starting weapon belongs to their CLASS, not to the body mesh they
 * happen to be wearing. The 2026-07-27 redesign split those two apart
 * (`bodyId` can now be any row), and the new `adventurer-*` bodies ship with
 * `equipment: {mainHand: null, offHand: null}` — so a Warrior who picked the
 * anime body silently walked around bare-handed. Falls back to the class row's
 * own loadout whenever the rendered body carries none of its own.
 *
 * Returns `body` untouched when there's nothing to fill in, so NPC rows (whose
 * "class" id IS their body id) and the six original classes are unaffected.
 */
function withClassDefaultWeapons(catalog, classId, gender, body) {
  if (body?.equipment?.mainHand || body?.equipment?.offHand) return body;
  const classRow = resolveBody(catalog, classId, gender);
  if (!classRow || classRow === body) return body;
  const classEquipment = classRow.equipment;
  if (!classEquipment?.mainHand && !classEquipment?.offHand) return body;
  // Shallow copy only — applyAppearance structuredClones its input anyway, so
  // the catalog row this came from is never mutated.
  return { ...body, equipment: { ...classEquipment } };
}

/**
 * Bodies that already encode gender as separate rows must not ALSO be scaled by
 * it — that would apply the difference twice.
 */
const GENDERED_BODY_IDS = new Set(['adventurer', 'adventurer-f', 'adventurer-m']);

/** Every body a player may choose in character creation, newest style first. */
export function selectableBodies(catalog) {
  const rows = [
    ...(catalog || []).filter((c) => c.kind === 'character'),
    ...CHARACTER_PRESETS.filter((c) => c.kind === 'character'),
  ];
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, name: r.name || r.id });
  }
  return out;
}

/**
 * Build a posed, weapon-holding player mesh.
 * @param {Array<object>} catalog rows from /api/character-types
 * @param {string} classId
 * @param {Appearance} appearance
 * @returns {import('three').Group}
 */
export function buildPlayerCharacter(catalog, classId, appearance) {
  const resolved = classBody(catalog, classId, appearance?.gender, appearance?.bodyId);
  const body = applyAppearance(resolved, appearance);
  const { group } = buildCreatureRig(body);
  // Keyed off the body that actually rendered, not the requested classId — a
  // Warrior wearing the adventurer body must skip the scale too.
  if (!GENDERED_BODY_IDS.has(resolved.id)) {
    const genderScale = GENDER_BODY_SCALE[appearance?.gender] || GENDER_BODY_SCALE.masc;
    group.scale.set(genderScale.x, genderScale.y, genderScale.z);
  }
  group.userData.characterParams = { classId, ...appearance };
  return group;
}
