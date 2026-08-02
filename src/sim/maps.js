// src/sim/maps.js
// Map-level metadata shared by the server (multi-map loading) and World
// Editor (Maps mode) — see the "Multi-Map Support" plan. A map's actual
// CONTENT (bounds/props/zones/teleporters/etc.) is still validated by
// parseWorld (src/sim/world.js); this module is only about the manifest
// that says which file is which map, of what category.

export const MAP_TYPES = ['overworld', 'building', 'dungeon'];

/**
 * @typedef {Object} MapManifestEntry
 * @property {string} id
 * @property {string} name
 * @property {'overworld'|'building'|'dungeon'} mapType
 * @property {string} path filename under world/maps/
 * @property {boolean} [isDefault] overworld-only; exactly one entry across
 *   the whole manifest must have this set — that's where a new character
 *   spawns.
 */

/**
 * @param {any} entries
 * @returns {void} throws on malformed data.
 */
export function validateMapManifest(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Map manifest must be an array');
  }
  const ids = new Set();
  let defaultCount = 0;
  for (const m of entries) {
    for (const key of ['id', 'name', 'mapType', 'path']) {
      if (!(key in m)) throw new Error(`Map manifest entry missing required field: "${key}" (id: ${m.id || '?'})`);
    }
    if (ids.has(m.id)) {
      throw new Error(`Duplicate map id: "${m.id}"`);
    }
    ids.add(m.id);
    if (!MAP_TYPES.includes(m.mapType)) {
      throw new Error(`Map "${m.id}" has unknown mapType "${m.mapType}"`);
    }
    if (m.isDefault) defaultCount++;
  }
  if (defaultCount !== 1) {
    throw new Error(`Map manifest must have exactly one isDefault overworld map (found ${defaultCount})`);
  }
}
