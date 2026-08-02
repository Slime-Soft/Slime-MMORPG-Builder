// src/generators/monsterRig.js
// The monster-flavored surface of the shared creature rig builder
// (src/generators/creatureRig.js), which now also builds NPC and player-
// character bodies from the same slot/anchor/shape data. Kept so existing
// callers (generators/monster.js, the editor's Monster Builder) don't move.
//
// New code should import buildCreatureRig from creatureRig.js directly.
export { resolveGaitTable, buildCreatureRig, attachWeapons, handAnchorFor } from './creatureRig.js';

import { buildCreatureRig } from './creatureRig.js';

/**
 * @param {import('../sim/creatureTypeDefs.js').CreatureTypeDef} monsterType
 * @returns {{ group: import('three').Group, rig: Record<string, import('three').Group> }}
 */
export function buildMonsterRig(monsterType) {
  const { group, rig } = buildCreatureRig(monsterType);
  return { group, rig };
}
