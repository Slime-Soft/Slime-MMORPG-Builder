// src/sim/buildingTypeDefs.js
// Building Builder Catalog — each entry is a building assembled from PLACED
// PART INSTANCES (referencing src/sim/buildingPartDefs.js entries by id, not
// copying them — editing a part updates every building using it, the same
// "tune once, live everywhere" property src/sim/weaponTypes.js gives a
// weapon grip), plus optional one-off inline shapes for details not worth
// saving as a reusable part.
//
// Parts are referenced by id and resolved at render time
// (src/generators/buildingRig.js), NOT validated for existence here — a
// part can be deleted after a building references it, and the renderer
// skips the missing piece with a console warning rather than the whole
// building failing to load. That's a deliberate choice: cross-catalog
// existence checks here would mean a part-library edit could suddenly make
// an unrelated save of building-types.json fail validation.
import { SHAPE_KINDS } from './shapeKinds.js';

/**
 * @typedef {Object} PlacedPart
 * @property {string} id
 * @property {string} partId references a BuildingPartDef.id
 * @property {{x:number,y:number,z:number}} position local to the building's own origin
 * @property {{x:number,y:number,z:number}} [rotation] degrees, full XYZ
 * @property {{x:number,y:number,z:number}} scale
 * @property {number} [colorOverride] hex int, overrides every shape's own color in this instance
 */

/**
 * @typedef {Object} BuildingTypeDef
 * @property {string} id
 * @property {string} name
 * @property {{width:number, depth:number}} footprint the collision/placement footprint — independent of the assembled parts' actual bounds, same as a hand-authored building's footprint today
 * @property {PlacedPart[]} pieces
 * @property {import('./buildingPartDefs.js').ShapeDef[]} [inlineShapes] raw one-off shapes, same local space as pieces
 */

/** @param {any} data @returns {BuildingTypeDef[]} */
export function parseBuildingTypeDefs(data) {
  if (!Array.isArray(data)) throw new Error('Building type data must be an array');
  const seenIds = new Set();
  for (const b of data) {
    if (!b || typeof b !== 'object') throw new Error('Each building type must be an object');
    for (const key of ['id', 'name', 'footprint', 'pieces']) {
      if (b[key] === undefined || b[key] === null) {
        throw new Error(`Building type missing required field: "${key}" (id: ${b.id || '?'})`);
      }
    }
    if (typeof b.footprint.width !== 'number' || typeof b.footprint.depth !== 'number') {
      throw new Error(`Building type "${b.id}" footprint must have numeric width/depth`);
    }
    if (!Array.isArray(b.pieces)) throw new Error(`Building type "${b.id}" pieces must be an array`);
    for (const piece of b.pieces) {
      if (!piece || typeof piece !== 'object') throw new Error(`Building type "${b.id}" has a non-object piece entry`);
      for (const key of ['id', 'partId', 'position', 'scale']) {
        if (piece[key] === undefined || piece[key] === null) {
          throw new Error(`Building type "${b.id}" piece missing "${key}" (id: ${piece.id || '?'})`);
        }
      }
    }
    if (b.inlineShapes !== undefined) {
      if (!Array.isArray(b.inlineShapes)) throw new Error(`Building type "${b.id}" inlineShapes must be an array`);
      for (const shape of b.inlineShapes) {
        if (!shape || typeof shape !== 'object') throw new Error(`Building type "${b.id}" has a non-object inline shape entry`);
        if (!shape.id) throw new Error(`Building type "${b.id}" has an inline shape missing "id"`);
        if (!SHAPE_KINDS.includes(shape.kind)) {
          throw new Error(`Building type "${b.id}" inline shape "${shape.id}" has unknown kind "${shape.kind}"`);
        }
      }
    }
    if (seenIds.has(b.id)) throw new Error(`Duplicate building type id: "${b.id}"`);
    seenIds.add(b.id);
  }
  return data;
}
