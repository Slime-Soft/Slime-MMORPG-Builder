// src/sim/interiors.js
// A store interior: a small enterable instance with a shopkeeper NPC and
// furniture, entered from a specific overworld building. This is a
// hardcoded, single-purpose version of what WORLD_BUILDER_ROADMAP.md calls
// out as future work — a generalized, editor-authored instance/portal
// system. Keeping this isolated in its own module (rather than baked
// directly into server/index.js) is deliberate: it's the natural seam to
// generalize later without having to untangle it from server logic.

/**
 * @typedef {Object} InteriorFurniture
 * @property {'counter'|'shelf'} type
 * @property {{x:number,y:number,z:number}} position
 * @property {number} rotationDeg
 */

/**
 * @typedef {Object} StoreInterior
 * @property {string} id
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @property {{x:number,y:number,z:number}} spawnPoint    where a player appears on entry
 * @property {{name:string, position:{x:number,y:number,z:number}, facingDeg:number}} npc
 * @property {InteriorFurniture[]} furniture
 */

/** @type {StoreInterior} */
export const STORE_INTERIOR = {
  id: 'general-store-interior',
  bounds: { minX: -8, maxX: 8, minZ: -8, maxZ: 8 },
  spawnPoint: { x: 0, y: 0, z: 6 }, // just inside the door
  npc: {
    name: 'Shopkeeper',
    position: { x: 0, y: 0, z: -5 }, // behind the counter
    facingDeg: 180, // facing the door
  },
  furniture: [
    { type: 'counter', position: { x: 0, y: 0, z: -4 }, rotationDeg: 0 },
    { type: 'shelf', position: { x: -6.5, y: 0, z: -6 }, rotationDeg: 90 },
    { type: 'shelf', position: { x: 6.5, y: 0, z: -6 }, rotationDeg: -90 },
  ],
};

export function parseStoreInterior(data) {
  const required = ['id', 'bounds', 'spawnPoint', 'npc', 'furniture'];
  for (const key of required) {
    if (!(key in data)) throw new Error(`Store interior missing required field: "${key}"`);
  }
  if (!Array.isArray(data.furniture)) throw new Error('Store interior furniture must be an array');
  return data;
}
