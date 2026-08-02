// src/sim/teleporters.js
// Teleporters are the one generalized placeable primitive linking any two
// points, same-map or cross-map — see the "Multi-Map Support" plan. A
// teleporter's target is another teleporter's id, resolved through a global
// registry built server-side from every loaded map's own list (see
// server/index.js) — this module only validates one map's own list, it
// doesn't resolve or dedupe links across maps.

export const TELEPORTER_MODES = ['instant', 'confirm'];

/**
 * @typedef {Object} TeleporterDef
 * @property {string} id globally unique across every loaded map
 * @property {{x:number,y:number,z:number}} position
 * @property {string} [linkedTeleporterId] another teleporter's id; an
 *   unlinked teleporter is inert (placed but goes nowhere yet)
 * @property {'instant'|'confirm'} mode
 * @property {boolean} visible
 */

/**
 * @param {any} teleporters
 * @returns {void} throws on malformed data.
 */
export function validateTeleporters(teleporters) {
  if (!Array.isArray(teleporters)) {
    throw new Error('World teleporters must be an array');
  }
  const ids = new Set();
  for (const t of teleporters) {
    for (const key of ['id', 'position', 'mode', 'visible']) {
      if (!(key in t)) throw new Error(`Teleporter missing required field: "${key}" (id: ${t.id || '?'})`);
    }
    if (ids.has(t.id)) {
      throw new Error(`Duplicate teleporter id within this map: "${t.id}"`);
    }
    ids.add(t.id);
    if (typeof t.position.x !== 'number' || typeof t.position.z !== 'number') {
      throw new Error(`Teleporter "${t.id}" has a non-numeric position`);
    }
    if (!TELEPORTER_MODES.includes(t.mode)) {
      throw new Error(`Teleporter "${t.id}" has unknown mode "${t.mode}"`);
    }
    if (typeof t.visible !== 'boolean') {
      throw new Error(`Teleporter "${t.id}" visible must be a boolean`);
    }
  }
}
