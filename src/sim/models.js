// src/sim/models.js
// Catalog of imported models (FBX or glTF/GLB) — id/name/url plus the two
// numbers collision needs (footprintRadius, height) and the one number the
// loader needs (importScale). Pure schema; the actual model bytes live
// under public/assets/models/, served statically, and are never touched
// here. Format is inferred client-side from the url's extension (see
// src/generators/modelLoader.js) rather than stored as its own field.
//
// footprintRadius/height start null and are filled in by the World Editor
// right after upload: it loads the model client-side, measures its real
// THREE.Box3 (see src/generators/modelLoader.js's measureModel), and saves
// the measurement back — same "never a hand-tuned guess" rule every other
// collider in this project follows (src/sim/collision.js), just measured
// once at authoring time instead of every placement, since the geometry is
// opaque binary the server can't parse itself.
//
// `category` distinguishes a placeable world prop from a hand-held weapon
// model (Character & NPC Builder) sharing this same catalog/upload endpoint
// — see src/sim/weaponTypes.js's registerCustomWeaponModels, which turns a
// `category: 'weapon'` entry into a real WeaponTypeDef at runtime so the
// rest of the weapon system (grip/hold tuning, equip selects) never has to
// know it wasn't hardcoded. A non-weapon model's `category` is one of
// PROP_CATEGORIES (src/sim/propTypes.js) — which Place/Scatter palette tab
// it appears under. Missing/undefined is allowed (legacy uploads from
// before categories existed) and treated as 'misc' at render time.
import { WEAPON_SLOTS } from './weaponTypes.js';
import { PROP_CATEGORIES } from './propTypes.js';

const PROP_CATEGORY_IDS = new Set(PROP_CATEGORIES.map((c) => c.id));

/** @param {any} data @returns {any} throws on malformed data. */
export function parseModelCatalog(data) {
  if (!Array.isArray(data)) {
    throw new Error('Model catalog must be an array');
  }
  const ids = new Set();
  for (const entry of data) {
    for (const key of ['id', 'name', 'url']) {
      if (!(key in entry)) {
        throw new Error(`Model missing required field: "${key}"`);
      }
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate model id: "${entry.id}"`);
    }
    ids.add(entry.id);
    for (const key of ['importScale', 'footprintRadius', 'height']) {
      if (entry[key] !== undefined && entry[key] !== null && typeof entry[key] !== 'number') {
        throw new Error(`Model "${entry.id}" field "${key}" must be a number or null`);
      }
    }
    if (entry.category !== undefined && entry.category !== 'weapon' && !PROP_CATEGORY_IDS.has(entry.category)) {
      throw new Error(`Model "${entry.id}" category must be "weapon" or one of: ${[...PROP_CATEGORY_IDS].join(', ')}`);
    }
    if (entry.category === 'weapon') {
      const w = entry.weapon;
      if (!w || typeof w !== 'object') throw new Error(`Model "${entry.id}" is category "weapon" but missing "weapon" metadata`);
      if (w.hands !== 1 && w.hands !== 2) throw new Error(`Model "${entry.id}" weapon.hands must be 1 or 2`);
      if (!WEAPON_SLOTS.includes(w.slot)) throw new Error(`Model "${entry.id}" weapon.slot must be one of ${WEAPON_SLOTS.join(', ')}`);
    }
  }
  return data;
}
