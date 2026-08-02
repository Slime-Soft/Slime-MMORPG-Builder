// src/sim/tower.js
// Floor data schema + validation, and small pure helpers shared by the
// server (authoritative) and client (rendering/prediction). No monster AI
// or combat here yet — that's Phase 5 Part 2.
import { validateLootTable } from './lootTables.js';

/**
 * @typedef {Object} MonsterSpawnDef
 * @property {string} id
 * @property {string} type            'slime' | 'goblin' | 'boss-golem', or a
 *   Monster Builder catalog type's id (src/sim/monsterTypeDefs.js) — the
 *   validator below never enforces this against a fixed list, it just
 *   checks the required fields exist, so any string round-trips fine.
 * @property {{x:number,y:number,z:number}} position
 * @property {number} maxHealth
 * @property {number} damage
 * @property {number} speed
 * @property {number} aggroRange
 * @property {number} attackRange
 * @property {number} attackCooldownMs
 * @property {boolean} [isBoss]
 * @property {boolean} [friendly] never aggros/attacks and can't be targeted by player
 *   abilities (src/sim/monster.js + resolveAbilityEffect in server/index.js)
 * @property {number} [scale]         per-monster appearance override, applied post-generation (src/render/scene.js)
 * @property {number} [color]         per-monster tint override, hex int
 * @property {number} [xpReward]      undefined = auto (src/sim/leveling.js formula)
 * @property {string} [group]         kill-quest target tag
 * @property {number} [respawnMs]     overworld only; undefined = DEFAULT_MONSTER_RESPAWN_MS
 * @property {import('./lootTables.js').LootTableEntry[]} [lootTable] what THIS placed spawn drops on
 *   death (src/sim/lootTables.js) — authored per placement in Monsters mode, not on the catalog
 *   type, so two spawns of the same type can carry different loot (e.g. a tougher scatter-placed
 *   pack vs. a rare hand-placed one). Absent/empty means no drops.
 */

/**
 * @typedef {Object} IFloor
 * @property {number} floorNumber
 * @property {boolean} isBossFloor
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @property {{x:number,y:number,z:number}} spawnPoint
 * @property {{x:number,y:number,z:number}} exitPoint
 * @property {MonsterSpawnDef[]} monsterSpawns
 */

/**
 * Shared validation for a MonsterSpawnDef[] array — used by both tower floor
 * JSON (per-floor monsterSpawns) and world.json (overworld monsters), since
 * monsters are no longer tower-only.
 * @param {any} spawns
 * @param {string} contextLabel used in error messages, e.g. "Floor" or "World"
 */
export function validateMonsterSpawns(spawns, contextLabel) {
  if (!Array.isArray(spawns)) {
    throw new Error(`${contextLabel} monster spawns must be an array`);
  }
  for (const m of spawns) {
    for (const key of ['id', 'type', 'position', 'maxHealth', 'damage', 'speed', 'aggroRange', 'attackRange', 'attackCooldownMs']) {
      if (!(key in m)) throw new Error(`Monster spawn missing required field: "${key}" (id: ${m.id || '?'})`);
    }
    if (m.lootTable !== undefined) validateLootTable(m.lootTable, `Monster spawn "${m.id}"`);
  }
}

/** @param {any} data @returns {IFloor} */
export function parseFloor(data) {
  if (!data || typeof data !== 'object') throw new Error('Floor data must be an object');
  const required = ['floorNumber', 'isBossFloor', 'bounds', 'spawnPoint', 'exitPoint', 'monsterSpawns'];
  for (const key of required) {
    if (!(key in data)) throw new Error(`Floor data missing required field: "${key}"`);
  }
  if (typeof data.floorNumber !== 'number' || data.floorNumber < 1) {
    throw new Error('Floor floorNumber must be a positive number');
  }
  validateMonsterSpawns(data.monsterSpawns, 'Floor');
  return data;
}

/** Flat 2D (X/Z) distance — the tower's floors don't need vertical distance. */
export function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function isWithinRange(a, b, range) {
  return distanceXZ(a, b) <= range;
}

/** A floor is cleared once every monster spawned on it is dead. Part 2 will call this once monsters can die. */
export function isFloorCleared(liveMonsters) {
  return liveMonsters.every((m) => m.health <= 0);
}
