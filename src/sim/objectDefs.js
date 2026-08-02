// src/sim/objectDefs.js
// Object Builder catalog (World Editor roadmap section E, MVP slice) — each
// entry is a reusable object built from primitive shapes (src/generators/
// custom.js), placeable in the world as a `type: 'custom'` prop. Same
// authoring-catalog shape as src/sim/authoredItems.js: id/name + a payload,
// validated as a whole array on save.
import { SHAPE_KINDS } from './shapeKinds.js';

/**
 * @typedef {Object} ShapeDef
 * @property {string} id
 * @property {'box'|'cylinder'|'sphere'|'cone'} kind
 * @property {{x:number,y:number,z:number}} position local to the object's own origin
 * @property {number} [rotationDeg] Y-axis only
 * @property {{x:number,y:number,z:number}} scale
 * @property {number} [color] hex int
 * @property {number} [opacity] 0..1, default 1 (fully opaque)
 */

/**
 * @typedef {Object} ObjectDef
 * @property {string} id
 * @property {string} name
 * @property {ShapeDef[]} shapes
 */

/** @param {any} data @returns {ObjectDef[]} */
export function parseObjectDefs(data) {
  if (!Array.isArray(data)) throw new Error('Object definitions data must be an array');
  const seenIds = new Set();
  for (const obj of data) {
    if (!obj || typeof obj !== 'object') throw new Error('Each object definition must be an object');
    for (const key of ['id', 'name', 'shapes']) {
      if (obj[key] === undefined || obj[key] === null) throw new Error(`Object definition missing required field: "${key}" (id: ${obj.id || '?'})`);
    }
    if (!Array.isArray(obj.shapes)) throw new Error(`Object definition "${obj.id}" shapes must be an array`);
    for (const shape of obj.shapes) {
      if (!shape || typeof shape !== 'object') throw new Error(`Object definition "${obj.id}" has a non-object shape entry`);
      if (!shape.id) throw new Error(`Object definition "${obj.id}" has a shape missing "id"`);
      if (!SHAPE_KINDS.includes(shape.kind)) throw new Error(`Object definition "${obj.id}" shape "${shape.id}" has unknown kind "${shape.kind}"`);
      if (!shape.position || typeof shape.position !== 'object') throw new Error(`Object definition "${obj.id}" shape "${shape.id}" missing position`);
      if (!shape.scale || typeof shape.scale !== 'object') throw new Error(`Object definition "${obj.id}" shape "${shape.id}" missing scale`);
      if (shape.opacity !== undefined && (typeof shape.opacity !== 'number' || shape.opacity < 0 || shape.opacity > 1)) {
        throw new Error(`Object definition "${obj.id}" shape "${shape.id}" opacity must be a number between 0 and 1`);
      }
    }
    if (seenIds.has(obj.id)) throw new Error(`Duplicate object definition id: "${obj.id}"`);
    seenIds.add(obj.id);
  }
  return data;
}
