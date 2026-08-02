// src/sim/craftingStations.js
// The crafting station TYPE catalog — a small, fixed set shipped in code
// (not authored via JSON, unlike items/recipes/quests), since there are only
// ever a handful of these and they rarely change. A station INSTANCE is not
// a separate data structure at all: it's just an ordinary placed prop (see
// src/sim/propTypes.js's 'crafting-stations' category) with an Event object
// attached to it (src/sim/events.js) whose sheet's only command is
// `openCraftingStation: {stationTypeId}` — the existing prop-attach editor
// workflow (already fully wired for NPCs/props) is the entire authoring
// story, no bespoke placement UI needed.

/**
 * @typedef {Object} CraftingStationTypeDef
 * @property {string} id
 * @property {string} name
 * @property {string[]} professions one or more of src/sim/recipes.js's PROFESSIONS
 * @property {string} visualPropType matches an id in src/sim/propTypes.js's 'crafting-stations' category — keeps "what it looks like" separate from "what it does"
 */

export const CRAFTING_STATION_TYPES = {
  STATION_ANVIL_TIER_1: {
    id: 'STATION_ANVIL_TIER_1', name: 'Anvil & Forge', professions: ['BLACKSMITHING'], visualPropType: 'station-anvil',
  },
  STATION_WORKBENCH_TIER_1: {
    id: 'STATION_WORKBENCH_TIER_1', name: 'Workbench', professions: ['WOODWORKING'], visualPropType: 'station-workbench',
  },
  STATION_LOOM_TIER_1: {
    id: 'STATION_LOOM_TIER_1', name: 'Loom', professions: ['TAILORING'], visualPropType: 'station-loom',
  },
  // Leatherworking's own station. Tailoring and leatherworking used to share
  // STATION_LOOM_TIER_1 ("Loom & Tanning Rack"); they are separate professions.
  STATION_TANNING_RACK_TIER_1: {
    id: 'STATION_TANNING_RACK_TIER_1', name: 'Tanning Rack', professions: ['LEATHERWORKING'], visualPropType: 'workstation-tanning-rack',
  },
  STATION_JEWELERS_BENCH_TIER_1: {
    id: 'STATION_JEWELERS_BENCH_TIER_1', name: "Jeweler's Bench", professions: ['JEWELCRAFTING'], visualPropType: 'station-jewelers-bench',
  },
  STATION_ALCHEMY_LAB_TIER_1: {
    id: 'STATION_ALCHEMY_LAB_TIER_1', name: 'Alchemy Lab', professions: ['ALCHEMY'], visualPropType: 'workstation-alchemy',
  },
};

export const CRAFTING_STATION_TYPE_IDS = Object.keys(CRAFTING_STATION_TYPES);

export function getCraftingStationTypeDef(stationTypeId) {
  const def = CRAFTING_STATION_TYPES[stationTypeId];
  if (!def) throw new Error(`Unknown crafting station type: "${stationTypeId}"`);
  return def;
}
