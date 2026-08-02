// src/sim/buildingPartDefs.js
// Building Builder Part Library — each entry is a small, named, reusable
// shape-list (a wall style, a roof style, a window, a door, a trim piece)
// in its own local space, keyed by category so the Building Builder's
// palette can group them. Same authoring-catalog shape as
// src/sim/objectDefs.js (id/name + a payload, validated as a whole array on
// save) — deliberately not merged into objectDefs.js itself, since parts are
// a separate reusable-by-reference concept from a placeable object (see
// src/sim/buildingTypeDefs.js, which references parts by id).
import { SHAPE_KINDS } from './shapeKinds.js';

export const PART_CATEGORIES = ['wall', 'roof', 'window', 'door', 'trim', 'other'];

/**
 * @typedef {Object} ShapeDef
 * @property {string} id
 * @property {string} kind one of SHAPE_KINDS
 * @property {{x:number,y:number,z:number}} position local to the part's own origin
 * @property {{x:number,y:number,z:number}} [rotation] degrees, full XYZ
 * @property {number} [rotationDeg] legacy Y-only fallback, honored when `rotation` is absent
 * @property {{x:number,y:number,z:number}} scale
 * @property {number} [color] hex int
 */

/**
 * @typedef {Object} BuildingPartDef
 * @property {string} id
 * @property {string} name
 * @property {'wall'|'roof'|'window'|'door'|'trim'|'other'} category
 * @property {ShapeDef[]} shapes
 */

/** @param {any} data @returns {BuildingPartDef[]} */
export function parseBuildingPartDefs(data) {
  if (!Array.isArray(data)) throw new Error('Building part data must be an array');
  const seenIds = new Set();
  for (const part of data) {
    if (!part || typeof part !== 'object') throw new Error('Each building part must be an object');
    for (const key of ['id', 'name', 'category', 'shapes']) {
      if (part[key] === undefined || part[key] === null) {
        throw new Error(`Building part missing required field: "${key}" (id: ${part.id || '?'})`);
      }
    }
    if (!PART_CATEGORIES.includes(part.category)) {
      throw new Error(`Building part "${part.id}" has unknown category "${part.category}"`);
    }
    if (!Array.isArray(part.shapes) || part.shapes.length === 0) {
      throw new Error(`Building part "${part.id}" must have at least one shape`);
    }
    for (const shape of part.shapes) {
      if (!shape || typeof shape !== 'object') throw new Error(`Building part "${part.id}" has a non-object shape entry`);
      if (!shape.id) throw new Error(`Building part "${part.id}" has a shape missing "id"`);
      if (!SHAPE_KINDS.includes(shape.kind)) {
        throw new Error(`Building part "${part.id}" shape "${shape.id}" has unknown kind "${shape.kind}"`);
      }
      if (!shape.position || typeof shape.position !== 'object') {
        throw new Error(`Building part "${part.id}" shape "${shape.id}" missing position`);
      }
      if (!shape.scale || typeof shape.scale !== 'object') {
        throw new Error(`Building part "${part.id}" shape "${shape.id}" missing scale`);
      }
    }
    if (seenIds.has(part.id)) throw new Error(`Duplicate building part id: "${part.id}"`);
    seenIds.add(part.id);
  }
  return data;
}
