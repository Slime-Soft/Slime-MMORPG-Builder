// src/sim/gathering.js
// Gathering node type definitions (cooldown, what they yield) and the pure
// yield-rolling function. Runs identically wherever it's called — in
// practice only server-side, since yield rolls must be authoritative, but
// kept dependency-free like the rest of sim/ on principle.

/**
 * @typedef {Object} NodeTypeDef
 * @property {number} respawnMs        how long after gathering before the node is usable again
 * @property {Array<{itemId:string, quantity:number, chance:number}>} yieldTable
 */

export const NODE_TYPES = {
  wood: {
    respawnMs: 9000,
    yieldTable: [
      { itemId: 'wood', quantity: 1, chance: 0.65 },
      { itemId: 'wood', quantity: 2, chance: 0.35 },
    ],
  },
  herb: {
    respawnMs: 7000,
    yieldTable: [
      { itemId: 'herb', quantity: 1, chance: 0.7 },
      { itemId: 'herb', quantity: 2, chance: 0.3 },
    ],
  },
  ore: {
    respawnMs: 14000,
    yieldTable: [
      { itemId: 'ore', quantity: 1, chance: 0.75 },
      { itemId: 'ore', quantity: 2, chance: 0.25 },
    ],
  },
  fish: {
    respawnMs: 11000,
    yieldTable: [
      { itemId: 'fish', quantity: 1, chance: 0.6 },
      { itemId: 'fish', quantity: 2, chance: 0.3 },
      { itemId: 'fish', quantity: 0, chance: 0.1 }, // fishing can just... not work
    ],
  },
  flower: {
    respawnMs: 8000,
    yieldTable: [
      { itemId: 'flower', quantity: 1, chance: 0.7 },
      { itemId: 'flower', quantity: 2, chance: 0.3 },
    ],
  },
};

export function getNodeTypeDef(nodeType) {
  const def = NODE_TYPES[nodeType];
  if (!def) throw new Error(`Unknown gathering node type: "${nodeType}"`);
  return def;
}

/**
 * Roll a yield for a node type using the given RNG (a 0..1 float generator;
 * see src/sim/rng.js — sim code never reaches for Math.random itself, the
 * caller owns the generator). Table entries' chances should sum to ~1; this
 * walks them in order and falls back to the last entry if rounding leaves a
 * gap, so it never returns nothing by accident.
 * @param {string} nodeType
 * @param {() => number} rng
 * @returns {{itemId: string, quantity: number}}
 */
export function rollYield(nodeType, rng) {
  if (typeof rng !== 'function') throw new Error('rollYield requires an rng (see src/sim/rng.js)');
  const def = getNodeTypeDef(nodeType);
  const roll = rng();
  let cumulative = 0;
  for (const entry of def.yieldTable) {
    cumulative += entry.chance;
    if (roll < cumulative) return { itemId: entry.itemId, quantity: entry.quantity };
  }
  const last = def.yieldTable[def.yieldTable.length - 1];
  return { itemId: last.itemId, quantity: last.quantity };
}

/**
 * @typedef {Object} GatheringNodeDef
 * @property {string} id
 * @property {string} zoneId
 * @property {string} nodeType   one of NODE_TYPES' keys
 * @property {{x:number,y:number,z:number}} position
 * @property {string} [group]    kill-quest-style tag: which quest's gather objective this specific node counts toward (mirrors MonsterSpawnDef's `group` in src/sim/tower.js)
 */

/** Validate a gathering node definition (from world.json). */
export function parseGatheringNode(data) {
  const required = ['id', 'zoneId', 'nodeType', 'position'];
  for (const key of required) {
    if (!(key in data)) throw new Error(`Gathering node missing required field: "${key}"`);
  }
  getNodeTypeDef(data.nodeType); // throws if unknown
  if (data.group !== undefined && typeof data.group !== 'string') {
    throw new Error(`Gathering node "${data.id}" group must be a string`);
  }
  return data;
}
