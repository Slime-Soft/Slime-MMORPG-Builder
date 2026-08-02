// src/sim/towerDungeon.js
// The Tower Dungeon: a multi-floor run authored entirely as an Event Object
// (src/sim/events.js's `openTowerDungeon` command). Every floor is just a
// MAP — authored in the World Editor like any other — plus a clear
// condition, so a tower is "some maps in an ordered list" instead of its
// own parallel content pipeline.
//
// This supersedes the old hardcoded tower (tower/floors/*.json +
// src/sim/tower.js's IFloor schema, the `enter-tower`/`advance-floor`
// sockets, the `type:'tower'` zone). That code is still in the tree but is
// inert — no loaded map has a tower zone anymore, so TOWER_ZONE is null and
// its entrance can never be reached. Nothing new should be built on it.
//
// Two clear conditions per floor, both optional and ANDed:
//   requiredKills      kill at least N monsters on the floor
//   requiredMonsterId  a specific monster spawn id (the floor's boss) must die
// Neither one authored (requiredKills 0, no requiredMonsterId) means the
// floor is cleared the moment it's entered — deliberate, so an author can
// build a pure "walk through it" transition floor without a special case.
//
// This module is pure schema + predicates, same contract as every other
// src/sim file: the server owns the live run state and applies the results
// (see server/index.js's tower-* socket handlers), and nothing here touches
// a socket or the DOM. Progress is per-player, keyed by the EVENT OBJECT's
// id — one tower event is one tower, so two different tower events never
// share unlock state.

const isObj = (v) => v && typeof v === 'object';

/**
 * @typedef {Object} TowerFloorDef
 * @property {string} name shown in the player's floor list ("Red Desert")
 * @property {string} mapId a map manifest id (world/maps/index.json) — the
 *   floor's actual content. Always entered as an INSTANCE (party-scoped,
 *   see server/index.js's enterDungeonMap) regardless of the map's own
 *   mapType, since two parties running the same tower must not share
 *   monster state.
 * @property {number} [requiredKills] default 0 = no kill requirement
 * @property {string} [requiredMonsterId] a monster spawn id on that map — a
 *   dangling/misspelled id is a silent dead end (the floor simply never
 *   clears), same convention as every other cross-reference in src/sim
 */

/**
 * @typedef {Object} TowerDungeonDef the `openTowerDungeon` command's own payload
 * @property {string} [title] panel heading, default "Tower"
 * @property {TowerFloorDef[]} floors ordered, non-empty
 */

/** Throws on malformed data. Called by events.js's validateCommand. */
export function validateTowerDungeon(cfg, label) {
  if (!isObj(cfg)) throw new Error(`${label} must be an object`);
  if (cfg.title !== undefined && typeof cfg.title !== 'string') throw new Error(`${label} title must be a string`);
  if (!Array.isArray(cfg.floors) || !cfg.floors.length) throw new Error(`${label} floors must be a non-empty array`);
  cfg.floors.forEach((f, i) => {
    const fLabel = `${label} floors[${i}]`;
    if (!isObj(f)) throw new Error(`${fLabel} must be an object`);
    if (typeof f.name !== 'string' || !f.name.trim()) throw new Error(`${fLabel} missing name`);
    if (typeof f.mapId !== 'string' || !f.mapId) throw new Error(`${fLabel} missing mapId`);
    if (f.requiredKills !== undefined && (!Number.isInteger(f.requiredKills) || f.requiredKills < 0)) {
      throw new Error(`${fLabel} requiredKills must be a non-negative integer`);
    }
    if (f.requiredMonsterId !== undefined && f.requiredMonsterId !== null && typeof f.requiredMonsterId !== 'string') {
      throw new Error(`${fLabel} requiredMonsterId must be a string`);
    }
  });
}

/** Fresh per-player tower progress — towerId (the event object's id) -> {clearedFloors}. Parallels initQuestState()/initEventRuntimeState()'s shape. */
export function initTowerProgress() {
  return {};
}

/** How many floors of `towerId` this player has cleared (0 if they've never run it). */
export function clearedFloorCount(progress, towerId) {
  return progress?.[towerId]?.clearedFloors || 0;
}

/**
 * Floor 1 is always open; every later floor needs the one before it
 * cleared — the "starting at Floor 2, players can only enter the new floors
 * if they cleared the previous one" rule, evaluated identically on the
 * server (authoritative gate) and the client (which button is disabled).
 */
export function isFloorUnlocked(progress, towerId, floorIndex) {
  return floorIndex === 0 || clearedFloorCount(progress, towerId) >= floorIndex;
}

/** Records a floor as cleared. Monotonic: replaying an earlier floor never rolls unlock progress back. */
export function markFloorCleared(progress, towerId, floorIndex) {
  const entry = progress[towerId] || (progress[towerId] = { clearedFloors: 0 });
  entry.clearedFloors = Math.max(entry.clearedFloors, floorIndex + 1);
  return progress;
}

/**
 * Has this run met its floor's clear condition? `run` is the server's live
 * per-player floor state: {kills, killedMonsterIds:string[]}.
 */
export function isFloorRequirementMet(floorDef, run) {
  if ((run?.kills || 0) < (floorDef.requiredKills || 0)) return false;
  if (floorDef.requiredMonsterId) {
    return (run?.killedMonsterIds || []).includes(floorDef.requiredMonsterId);
  }
  return true;
}
