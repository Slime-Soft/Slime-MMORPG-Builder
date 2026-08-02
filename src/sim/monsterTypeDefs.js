// src/sim/monsterTypeDefs.js
// The Monster Builder's view of the shared creature schema.
//
// Monsters, NPCs and player characters are one thing now
// (src/sim/creatureTypeDefs.js) — a stance, body-part slots of primitive
// shapes, and a walk cycle — differing only in the metadata hanging off them.
// This module stays as the monster-flavored surface: it fixes `kind: 'monster'`
// and keeps the old export names, so `monster-types.json`, the server, the
// editor, and scripts/check-prefabs.mjs are unchanged. No data migration.
//
// New code should import from creatureTypeDefs.js directly.
import { parseCreatureTypeDefs, CREATURE_STANCES } from './creatureTypeDefs.js';

export {
  SLOT_ROLES,
  ABILITY_KINDS,
  ANIM_AXES,
  ABILITY_LEVEL_LADDER,
} from './creatureTypeDefs.js';

/** @deprecated use CREATURE_STANCES */
export const MONSTER_STANCES = CREATURE_STANCES;

/**
 * Validate the monster catalog. A `kind`-less entry is a monster, which is
 * every row written before creature types existed.
 * @param {any} data
 * @returns {import('./creatureTypeDefs.js').CreatureTypeDef[]}
 */
export function parseMonsterTypeDefs(data) {
  return parseCreatureTypeDefs(data, 'monster');
}
