// server/index.js
// Authoritative server. Owns player position. Client never dictates outcomes —
// it only sends input intent; this process runs the same sim code to resolve it.
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { readFileSync, writeFileSync, copyFileSync, existsSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import multer from 'multer';

import { stepMovement, sanitizeInput } from '../src/sim/movement.js';
import { groundHeightFnFor } from '../src/sim/platforms.js';
import { parseWorld, sampleTerrainHeight } from '../src/sim/world.js';
import { validateMapManifest, MAP_TYPES } from '../src/sim/maps.js';
import { defaultGraphicsSettings } from '../src/sim/graphicsSettings.js';
import { parseCustomGroundTextures } from '../src/sim/customGroundTextures.js';
import { parseCustomPathTextures } from '../src/sim/customPathTextures.js';
import { parseAudioCatalog, AUDIO_KINDS } from '../src/sim/audioCatalog.js';
import { parseModelCatalog } from '../src/sim/models.js';
import { PROP_CATEGORIES } from '../src/sim/propTypes.js';
import { parseVfxDefs } from '../src/sim/vfxDefs.js';
import { initAbilityState, tickResourceRegen, tryUseAbility, setSkillCatalog, CLASSES } from '../src/sim/classes.js';
import { parseSkillDefs, computeImpactDelayMs, effectiveEffectsForLevel } from '../src/sim/skillDefs.js';
import { applyStatusEffect, tickStatusEffects, isCCd, getMoveSpeedMultiplier, getBuffAmount, absorbDamage } from '../src/sim/statusEffects.js';
import { resolveEnemyTargets } from '../src/sim/skillResolution.js';
import { initLevelState, grantXp, maxHealthForLevel, powerMultiplierForLevel, xpRewardForMonster, xpForLevel, computeCharacterDerivedStats } from '../src/sim/leveling.js';
import { PRIMARY_STAT_IDS, initStatAllocation, applyStatAllocation, respecStatAllocation, zeroStats } from '../src/sim/statDefs.js';
import { parseFloor, distanceXZ, isWithinRange, isFloorCleared } from '../src/sim/tower.js';
import { stepMonsterAI } from '../src/sim/monster.js';
import { initNpcState, stepNpcWander } from '../src/sim/npc.js';
import { rollYield, getNodeTypeDef } from '../src/sim/gathering.js';
import { CRAFTING_STATION_TYPES } from '../src/sim/craftingStations.js';
import { parseRecipeDefs, findRecipeDef, PROFESSIONS } from '../src/sim/recipes.js';
import { resolveCraft, canUseStationForRecipe } from '../src/sim/craftResolution.js';
import { initAllProfessions } from '../src/sim/professionLeveling.js';
import { rollLootTable } from '../src/sim/lootTables.js';
import {
  EQUIP_SLOT_IDS, initEquipmentState, findAutoTargetSlot, baseSlotFor,
  canEquip, equipItem, unequipItem, computeGearStatBonus, equipmentToWeaponLoadout,
} from '../src/sim/equipment.js';
import { getItemDef } from '../src/sim/items.js';
import { parseAuthoredItems } from '../src/sim/authoredItems.js';
import { parseObjectDefs } from '../src/sim/objectDefs.js';
import { parseMonsterTypeDefs } from '../src/sim/monsterTypeDefs.js';
import { parseQuests, initQuestState, canAccept, acceptQuest, applyKill, applyTalk, isReadyToTurnIn, isActive, isCompleted, turnInQuest, turnInNpcId, applyQuestSwitch } from '../src/sim/quests.js';
import { createParty, addMember, removeMember, canAddMember, isInParty, MAX_PARTY_SIZE } from '../src/sim/party.js';
import { STORE_INTERIOR } from '../src/sim/interiors.js';
import { createRng } from '../src/sim/rng.js';
import { buildCollisionIndex } from '../src/sim/collision.js';
import { parseCreatureTypeDefs } from '../src/sim/creatureTypeDefs.js';
import { validateWeaponTuning, applyWeaponTuning, registerCustomWeaponModels, getWeaponTypeDef } from '../src/sim/weaponTypes.js';
import { isPointInZone } from '../src/sim/zones.js';
import { initEventRuntimeState, initEventObjectWorldState, startEventScript, stepEventScript, resumeEventChoice, switchKey, isPointInEventRange, DEFAULT_EVENT_INTERACT_RANGE } from '../src/sim/events.js';
import { initTowerProgress, clearedFloorCount, isFloorUnlocked, markFloorCleared, isFloorRequirementMet } from '../src/sim/towerDungeon.js';
import { CHARACTER_PRESETS } from '../src/generators/characterPresets.js';
import { parseBuildingPartDefs } from '../src/sim/buildingPartDefs.js';
import { parseBuildingTypeDefs } from '../src/sim/buildingTypeDefs.js';
import { BUILDING_PART_PRESETS } from '../src/generators/buildingPartPresets.js';

// The server owns the sim's randomness (src/sim never calls Math.random —
// see scripts/check-architecture.mjs). One generator drives NPC wander and
// gathering yields; seeded from the clock here, but a fixed seed makes a
// whole session replayable, which is what a future bot harness will want.
const rng = createRng(Date.now() & 0xffffffff);

const STORE_ENTRY_RANGE = 5; // overworld distance from the store building that still counts as "at the door"

const GATHER_RANGE = 3;
const VENDOR_SELL_RANGE = 6;
const EVENT_MERCHANT_RANGE = 6; // how far a player can drift from where an openMerchantStore effect fired and still buy/sell — mirrors VENDOR_SELL_RANGE's role for the hardcoded general store
const NPC_TALK_RANGE = 5; // server-side proximity gate for quest accept/turn-in (a bit > the client's talk prompt range as slack)
const PARTY_INVITE_RANGE = 8; // how close two overworld players must be to invite
const TELEPORTER_USE_RANGE = 3; // how close a player must be to a teleporter to trigger it
const SHARED_CREDIT_RANGE = 40; // party members within this of a kill (same location) share XP + quest credit
const PARTY_INVITE_TTL_MS = 30000;
const VENDOR_BUILDING_ID = 'general-store';

const RESPAWN_DELAY_MS = 3000;
const DEFAULT_MONSTER_RESPAWN_MS = 30000; // overworld monsters only — see the respawn note on initMonsterState
const RESPEC_GOLD_COST = 50; // flat cost for 'respec-stats' — src/sim/items.js's scroll_of_oblivion is the item-based alternative, free of gold cost
const DAMAGE_STAT_COEFF = 0.4; // how much a point of GSE physPower/spellPower/healPower actually adds to a hit — tuned low so allocating stats meaningfully helps without swamping every skill's own hand-authored `amount`
const CRIT_DAMAGE_MULTIPLIER = 1.5; // DEX's Crit_Chance roll multiplies damage by this on a hit

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAPS_DIR = path.join(ROOT, 'world/maps');
const MAPS_MANIFEST_PATH = path.join(MAPS_DIR, 'index.json');

// --- Load Monster Builder catalog (World Editor roadmap section E) ---
// Loaded before world/floors below since initMonsterState (next) needs it
// to resolve a catalog-typed spawn's active moveset at init time.
const MONSTER_TYPES_PATH = path.join(ROOT, 'monster-types/monster-types.json');
// Zero-edit monster path: drop a single-monster .json file (same shape as one
// array element of monster-types.json) into monster-types/plugins/ and it
// merges into the catalog below — no editing monster-types.json, no server
// restart, just refresh. Reuses parseMonsterTypeDefs for validation, so a
// malformed plugin fails loudly (logged + skipped) rather than corrupting the
// catalog. A plugin id that collides with an existing one (base catalog or
// another plugin) is skipped with a warning — monsters carry balance-relevant
// stats, so unlike flora props this does NOT silently let the last one win.
const MONSTER_PLUGINS_DIR = path.join(ROOT, 'monster-types/plugins');
function buildMonsterCatalog() {
  const base = parseMonsterTypeDefs(JSON.parse(readFileSync(MONSTER_TYPES_PATH, 'utf-8')));
  const seenIds = new Set(base.map((m) => m.id));
  const merged = [...base];
  let files = [];
  try {
    files = readdirSync(MONSTER_PLUGINS_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    // Folder missing entirely is fine — just means no monster plugins yet.
  }
  for (const file of files) {
    try {
      const def = JSON.parse(readFileSync(path.join(MONSTER_PLUGINS_DIR, file), 'utf-8'));
      parseMonsterTypeDefs([def]); // validates shape; throws with a useful message on bad data
      if (seenIds.has(def.id)) {
        console.warn(`[monster plugins] skipping ${file}: id "${def.id}" already exists in the catalog`);
        continue;
      }
      seenIds.add(def.id);
      merged.push(def);
    } catch (err) {
      console.warn(`[monster plugins] skipping ${file}: ${err.message}`);
    }
  }
  return merged;
}
let monsterTypeDefs = buildMonsterCatalog();

/** A catalog monster type's active moveset — abilitySlots unlocked at or below its own configuredLevel (see src/sim/monsterTypeDefs.js). undefined for non-catalog types (slime/goblin/boss-golem, or any hand-authored spawn), which is exactly what stepMonsterAI's legacy-ability fallback expects. */
function resolveMonsterAbilities(type) {
  const mt = monsterTypeDefs.find((m) => m.id === type);
  if (!mt) return undefined;
  return mt.abilitySlots.filter((a) => a.unlockLevel <= mt.configuredLevel);
}

/**
 * Turn static MonsterSpawnDef[] (JSON) into live per-monster runtime state
 * (health/position/aggro). Shared by tower floors and the overworld —
 * monsters aren't tower-exclusive. `spawnPosition` is the immutable home
 * point respawn returns a monster to (`position` itself gets mutated by AI
 * chase movement, so it can't double as "where to respawn"); `deadAt` is
 * respawn bookkeeping, only ever set for overworld monsters (see the tick
 * loop) — tower floor monsters stay dead once killed, since a floor
 * clearing permanently is the intended dungeon-progression mechanic.
 */
function initMonsterState(spawns) {
  return (spawns || []).map((m) => ({
    ...m,
    health: m.maxHealth,
    position: { ...m.position },
    spawnPosition: { ...m.position },
    aggroTargetId: null,
    deadAt: null,
    abilities: resolveMonsterAbilities(m.type),
  }));
}

// --- Load every map (server is the source of truth for all of them) ---
// One manifest (world/maps/index.json) lists every map file, of any of the
// three categories (overworld/building/dungeon — see src/sim/maps.js).
// Only the default overworld map is actually wired into live gameplay
// today (see the `world` alias below) — building/dungeon maps just load
// and validate for now; teleport/instance plumbing lands in a later phase.
/** @type {Map<string, {meta: object, world: object}>} every loaded map, keyed by manifest id */
const maps = new Map();
let defaultOverworldMapId = null;
{
  const manifest = JSON.parse(readFileSync(MAPS_MANIFEST_PATH, 'utf-8'));
  validateMapManifest(manifest);
  for (const meta of manifest) {
    const mapWorld = parseWorld(JSON.parse(readFileSync(path.join(MAPS_DIR, meta.path), 'utf-8')));
    if (!mapWorld.graphicsSettings) mapWorld.graphicsSettings = defaultGraphicsSettings(); // maps saved before this field existed
    maps.set(meta.id, { meta, world: mapWorld });
    if (meta.isDefault) defaultOverworldMapId = meta.id;
  }
}
console.log(`Loaded ${maps.size} map(s) — default overworld: "${defaultOverworldMapId}"`);

// `world` stays an alias for the default overworld map's document — every
// existing overworld code path below (collision, monsters, npcs, zones,
// buildings, gathering, etc.) is UNCHANGED by multi-map support; it just now
// originates from the manifest-loaded map instead of one hardcoded file.
// Saving/creating any OTHER map goes through the new /api/maps* routes
// below and only ever touches the `maps` Map, never this variable — except
// when the map being saved/created IS the default one, in which case both
// need to stay in sync (see saveMap/POST /api/maps below).
let world = maps.get(defaultOverworldMapId).world;

/**
 * The x/y/z of a map's authored spawn point, WITHOUT its `facingDeg`.
 * `{ ...someWorld.spawnPoint }` used to be the idiom for this, but now that a
 * spawn point also carries a facing that would smuggle an extra field into
 * `player.position` — and from there into every position payload on the wire
 * and into the movement code's position math.
 */
function spawnPositionOf(w) {
  return { x: w.spawnPoint.x, y: w.spawnPoint.y || 0, z: w.spawnPoint.z };
}

/**
 * A map's authored spawn facing in RADIANS, atan2(x, z) convention (0 = looking
 * down +Z) — the same convention `player.facingAngle` and the client's
 * `mesh.rotation.y` already use, so it drops straight into both. Absent on a
 * map authored before spawn facing existed = 0, the old behavior.
 */
function spawnFacingOf(w) {
  return ((w.spawnPoint.facingDeg || 0) * Math.PI) / 180;
}
// Overworld monsters: a single shared list (the overworld isn't instanced
// the way tower floors are), live state initialized the same way.
let overworldMonsters = initMonsterState(world.monsters);
// Town NPCs: also a single shared overworld list, with idle-wander state.
let overworldNpcs = (world.npcs || []).map(initNpcState);
// Event Objects (see src/sim/events.js) — v1 scope is overworld-only, same
// as quests/NPCs today. World-shared per-object state (visible/completed)
// lives in a process-lifetime Map, keyed by event id, mirroring how a
// teleporter/gathering-node's cooldown is already global rather than
// per-player.
let overworldEvents = world.events || [];
const eventObjectState = new Map(overworldEvents.map((ev) => [ev.id, initEventObjectWorldState()]));
/** @type {Map<string, ReturnType<typeof startEventScript>>} one in-flight event script per player, keyed by socket.id */
const activeEventRuns = new Map();
/** @type {Map<string, Set<string>>} socket.id -> set of zone ids the player was inside as of the last tick, for edge-triggering enterArea events */
const playerZoneMembership = new Map();

// --- Teleporters: one global registry across every loaded map ---
// A teleporter's `linkedTeleporterId` is just another teleporter's id — no
// map id attached — so cross-map linking needs a single flat lookup built
// from every map's own `teleporters[]`. Rebuilt whenever a map is
// saved/created/deleted (see saveMap/POST+DELETE /api/maps below), so it
// never drifts from what's actually on disk/in memory.
/** @type {Map<string, {teleporter: object, mapId: string}>} */
let teleporterRegistry = new Map();
function rebuildTeleporterRegistry() {
  teleporterRegistry = new Map();
  for (const [mapId, entry] of maps) {
    for (const t of entry.world.teleporters || []) {
      teleporterRegistry.set(t.id, { teleporter: t, mapId });
    }
  }
}
rebuildTeleporterRegistry();

// Lazily-built, per-map collision index (mirrors the overworld's own
// `collision`/`rebuildCollision()` below) — only maps someone has actually
// teleported into pay for this; the default overworld keeps using its own
// `collision` variable untouched.
const mapCollisionCache = new Map();
function getMapCollision(mapId) {
  const entry = maps.get(mapId);
  if (!entry) return null;
  if (!mapCollisionCache.has(mapId)) {
    // Same two catalogs rebuildCollision() feeds the overworld index, and the same
    // two the client passes in its own buildCollisionIndex — without them a map's
    // custom objects and imported models get NO collider server-side while the
    // client happily blocks on them, so the two disagree about what's solid and
    // the player fights their own prediction along every such prop.
    mapCollisionCache.set(mapId, buildCollisionIndex(
      entry.world,
      Object.fromEntries(allObjectDefs().map((o) => [o.id, o])),
      Object.fromEntries(allModels().map((m) => [m.id, m]))
    ));
  }
  return mapCollisionCache.get(mapId);
}

// --- Dungeon instances (party-scoped, unlike every other map type) ---
// A building/overworld map is one shared room everyone in it sees together
// (movePlayerToMap, above). A dungeon map is different: every solo player
// or party that walks into its entrance gets their OWN live copy — separate
// monster state, separate room, invisible to everyone else. `parties` is
// declared further down this file (module-level `const`, so by the time any
// of this actually runs — always from a socket handler, i.e. after full
// module load — it's already populated.
/** @type {Map<string, {mapId: string, partyMemberIds: Set<string>, monsters: object[], createdAt: number, closeTimer: NodeJS.Timeout|null}>} */
const dungeonInstances = new Map();
let nextDungeonInstanceSeq = 1;

/**
 * Finds (or creates) the dungeon instance this player belongs to for
 * `mapId`. Membership is frozen at CREATION time to this player's party at
 * that moment — a stranger walking into the same entrance always gets
 * their own separate instance; a party member who joins/leaves the party
 * AFTER creation doesn't retroactively gain/lose access to an
 * already-running instance (same as any real MMO's dungeon lock).
 */
function getOrCreateDungeonInstance(mapId, playerId, player) {
  for (const [instanceId, inst] of dungeonInstances) {
    if (inst.mapId === mapId && inst.partyMemberIds.has(playerId)) return instanceId;
  }
  const memberIds = player.partyId ? new Set(parties.get(player.partyId)?.memberIds || [playerId]) : new Set([playerId]);
  const instanceId = `${mapId}::${nextDungeonInstanceSeq++}`;
  const mapEntry = maps.get(mapId);
  const inst = {
    mapId,
    partyMemberIds: memberIds,
    monsters: initMonsterState(mapEntry.world.monsters),
    createdAt: Date.now(),
    closeTimer: null,
  };
  dungeonInstances.set(instanceId, inst);
  const minutes = mapEntry.world.autoCloseMinutes ?? 30;
  inst.closeTimer = setTimeout(() => forceCloseDungeonInstance(instanceId), minutes * 60 * 1000);
  return instanceId;
}

/** Closes an instance if literally no one is in it anymore — the "closes when the party exits through the gate" behavior. Safe to call speculatively any time a player leaves one; a no-op if others remain. */
function closeDungeonInstanceIfEmpty(instanceId) {
  const inst = dungeonInstances.get(instanceId);
  if (!inst) return;
  const stillIn = [...players.values()].some((p) => p.dungeonInstanceId === instanceId);
  if (stillIn) return;
  if (inst.closeTimer) clearTimeout(inst.closeTimer);
  dungeonInstances.delete(instanceId);
}

/** The auto-close timer firing — unlike the exit-gate path, players may still be inside, so they get forcibly ejected to the default overworld's spawn point with a 'dungeon-closed' notice first. */
function forceCloseDungeonInstance(instanceId) {
  const inst = dungeonInstances.get(instanceId);
  if (!inst) return;
  const room = `dungeon-${inst.mapId}-${instanceId}`;
  for (const [id, p] of players.entries()) {
    if (p.dungeonInstanceId !== instanceId) continue;
    p.dungeonInstanceId = null;
    p.mapId = null;
    p.towerRun = null; // an auto-closed instance ends any Tower Dungeon run inside it (banked floor unlocks survive — see checkTowerFloorCleared)
    p.position = spawnPositionOf(world);
    p.facingAngle = spawnFacingOf(world);
    const sock = io.sockets.sockets.get(id);
    if (!sock) continue;
    sock.leave(room);
    sock.emit('dungeon-closed', {});
    const existingPlayers = [...players.entries()]
      .filter(([pid, op]) => pid !== id && op.currentFloor === 0 && !op.inStore && !op.mapId)
      .map(([pid, op]) => ({ id: pid, position: op.position, character: op.character, equipmentLoadout: weaponLoadoutFor(op) }));
    sock.emit('map-entered', { mapId: defaultOverworldMapId, world, position: p.position, facing: p.facingAngle, existingMapPlayers: existingPlayers, isDefaultOverworld: true });
    sock.broadcast.emit('player-joined', { id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) });
  }
  if (inst.closeTimer) clearTimeout(inst.closeTimer);
  dungeonInstances.delete(instanceId);
}

/** Moves a player into their (found-or-created) dungeon instance of `mapId` — the party-scoped counterpart to movePlayerToMap, for teleporters whose target map is type 'dungeon'. `targetFacing` is radians (see spawnFacingOf); null means "no authored facing here", which leaves the player turned however they already were. */
function enterDungeonMap(socket, player, mapId, targetPosition, targetFacing = null) {
  const instanceId = getOrCreateDungeonInstance(mapId, socket.id, player);
  const inst = dungeonInstances.get(instanceId);

  if (player.dungeonInstanceId) {
    const oldRoom = `dungeon-${player.mapId}-${player.dungeonInstanceId}`;
    socket.to(oldRoom).emit('map-player-left', { id: socket.id });
    socket.leave(oldRoom);
    const oldInstanceId = player.dungeonInstanceId;
    player.dungeonInstanceId = null;
    closeDungeonInstanceIfEmpty(oldInstanceId);
  } else if (player.mapId) {
    socket.to(`map-${player.mapId}`).emit('map-player-left', { id: socket.id });
    socket.leave(`map-${player.mapId}`);
  } else {
    socket.broadcast.emit('player-left', { id: socket.id });
  }

  player.position = { ...targetPosition };
  if (targetFacing != null) player.facingAngle = targetFacing;
  player.mapId = mapId;
  player.dungeonInstanceId = instanceId;
  const room = `dungeon-${mapId}-${instanceId}`;
  socket.join(room);

  const existingMapPlayers = [...players.entries()]
    .filter(([id, p]) => id !== socket.id && p.dungeonInstanceId === instanceId)
    .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
  socket.emit('map-entered', {
    mapId,
    world: maps.get(mapId).world,
    position: player.position,
    facing: targetFacing,
    existingMapPlayers,
    isDefaultOverworld: false,
    monsters: inst.monsters,
  });
  socket.to(room).emit('map-player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
}

const TOWER_ZONE = world.zones.find((z) => z.type === 'tower');
const TOWER_ENTRY_BUFFER = 5; // overworld distance beyond the tower footprint that still counts as "at the door"
const TOWER_EXIT_POINT = TOWER_ZONE
  ? { x: TOWER_ZONE.center.x, y: 0, z: TOWER_ZONE.center.z + TOWER_ZONE.footprintRadius + 3 }
  : spawnPositionOf(world);
// Only the fallback arm of TOWER_EXIT_POINT is an AUTHORED point, so only it
// carries an authored facing — the tower-door variant is a computed offset from
// the zone and has none. Since the tower zone is gone from today's maps, this
// is in practice "the plain overworld death respawn faces the way the spawn
// point says", which is exactly where a naked respawn drops you.
const TOWER_EXIT_FACING = TOWER_ZONE ? null : spawnFacingOf(world);

const VENDOR_BUILDING = world.buildings.find((b) => b.id === VENDOR_BUILDING_ID);

// --- Load tower floors ---
const FLOORS_DIR = path.join(ROOT, 'tower/floors');
/** @type {Map<number, {def: object, monsters: object[]}>} */
const towerFloors = new Map();
for (const file of readdirSync(FLOORS_DIR).filter((f) => f.endsWith('.json'))) {
  const def = parseFloor(JSON.parse(readFileSync(path.join(FLOORS_DIR, file), 'utf-8')));
  // Live per-floor monster state, shared by every player currently on that
  // floor (a simple shared instance for now — per-party instancing is a
  // Phase 8 concern).
  const monsters = initMonsterState(def.monsterSpawns);
  towerFloors.set(def.floorNumber, { def, monsters });
}
const MAX_FLOOR = Math.max(...towerFloors.keys());
console.log(`Loaded ${towerFloors.size} tower floors (max floor ${MAX_FLOOR})`);

// --- Gathering nodes: runtime cooldown state, keyed by node id ---
/** @type {Map<string, number>} node id -> ms timestamp when it becomes available again (0/absent = available now) */
const gatherNodeAvailableAt = new Map();

// --- Load authored items (World Editor Items mode) ---
const ITEMS_PATH = path.join(ROOT, 'items/items.json');
const ICONS_DIR = path.join(ROOT, 'public/assets/icons');
mkdirSync(ICONS_DIR, { recursive: true });
let authoredItems = parseAuthoredItems(JSON.parse(readFileSync(ITEMS_PATH, 'utf-8')));
// Live lookups by id for src/sim/equipment.js's canEquip/equipItem/computeGearStatBonus —
// Proxies (not a cached Object.fromEntries snapshot) so they always reflect
// the CURRENT authoredItems array (reassigned whole on every /api/items save)
// and the current weapon-type registry (registerCustomWeaponModels can add
// to it at runtime), without needing to remember to rebuild a cache.
const authoredItemById = new Proxy({}, { get: (_, id) => authoredItems.find((i) => i.id === id) });
const weaponTypeById = new Proxy({}, { get: (_, id) => getWeaponTypeDef(id) });

/** A player's mainHand/offHand weapon-type-id pair — what other clients need to render the weapon they're actually holding. Relayed alongside `character` (cosmetics) in every roster/join broadcast so other players see it too, not just the equipping player's own preview. */
function weaponLoadoutFor(player) {
  return equipmentToWeaponLoadout(player.equipment || initEquipmentState(), authoredItemById);
}

/** Base sell price for an itemId across BOTH catalogs (hardcoded materials, then the authored gear/quest/consumable catalog) — null if the id isn't in either, or has no sellPrice. Used by the general store (materials only, historically) and the openMerchantStore sell-to-merchant path (either catalog). */
function resolveSellPrice(itemId) {
  try {
    return getItemDef(itemId).sellPrice ?? null;
  } catch {
    return authoredItemById[itemId]?.sellPrice ?? null;
  }
}

// --- Load authored quests (World Editor Quests mode) ---
const QUESTS_PATH = path.join(ROOT, 'quests/quests.json');
let quests = parseQuests(JSON.parse(readFileSync(QUESTS_PATH, 'utf-8')));

// --- Load authored recipes (World Editor Recipe Builder) — replaces
// src/sim/crafting.js's old 5-hardcoded-recipe placeholder entirely. Same
// load/validate/save/backup pattern as items/quests. ---
const RECIPES_PATH = path.join(ROOT, 'recipes/recipes.json');
let recipes = parseRecipeDefs(JSON.parse(readFileSync(RECIPES_PATH, 'utf-8')));

// --- Load the class skill catalog (src/sim/skillDefs.js) ---
// No seed-from-generator step needed like character-types.json/building-
// parts.json have — this file's real starter content (the 25 migrated class
// abilities) is committed directly, same as quests.json/objects.json.
const SKILLS_PATH = path.join(ROOT, 'skills/skill-defs.json');
let skillDefs = parseSkillDefs(JSON.parse(readFileSync(SKILLS_PATH, 'utf-8')));
setSkillCatalog(skillDefs);
// Full SkillDef lookup (effects/targeting/etc) by id — classes.js's
// CLASSES[classId].abilities only carries the legacy kind/power bridge
// fields tryUseAbility's cooldown/cost check needs; resolveAbilityEffect
// needs the real skill to know what it actually does.
let skillDefsById = new Map(skillDefs.map((s) => [s.id, s]));

// --- Load Object Builder catalog (World Editor roadmap section E, MVP slice) ---
const OBJECTS_PATH = path.join(ROOT, 'objects/objects.json');
let objectDefs = parseObjectDefs(JSON.parse(readFileSync(OBJECTS_PATH, 'utf-8')));

// --- Imported FBX models (World Editor "Imported Model" placement, and the
// Character & NPC Builder's custom weapon models) ---
// Catalog metadata only (id/name/url/importScale/measured footprint) — the
// FBX bytes live under public/assets/models/, served statically. Collision
// needs footprintRadius/height, which the editor measures client-side right
// after upload (an FBX is opaque binary; the server never parses one).
//
// Loaded BEFORE the Character & NPC Builder catalog below: a character/NPC
// row can reference a category:'weapon' entry from this catalog in its
// equipment/allowedWeaponTypes, and registerCustomWeaponModels must run
// before parseCreatureTypeDefs validates that reference — see
// src/sim/weaponTypes.js's registerCustomWeaponModels doc comment.
const MODELS_PATH = path.join(ROOT, 'models/models.json');
const MODELS_DIR = path.join(ROOT, 'public/assets/models');
mkdirSync(MODELS_DIR, { recursive: true });
if (!existsSync(MODELS_PATH)) {
  mkdirSync(path.dirname(MODELS_PATH), { recursive: true });
  writeFileSync(MODELS_PATH, '[]');
}
let modelCatalog = parseModelCatalog(JSON.parse(readFileSync(MODELS_PATH, 'utf-8')));
registerCustomWeaponModels(modelCatalog);

// --- Dropped-in assets (src/generators/environment/import/) ---
// The share-an-asset path: one folder, drop a file in, refresh the World
// Editor, it's in the palette's "Imported" tab. No upload form, no catalog to
// hand-edit, no server restart. This is how an asset leaves one person's copy
// of the game and arrives in another's — export it, send the file, they drop
// it in. Deliberately the same shape as the flora-plugins folder (scan a
// directory, nothing registered by hand), widened to every form an asset in
// this project actually takes:
//
//   .json  an Object Builder export — a list of primitive shapes
//          (src/sim/objectDefs.js). THE format for an asset somebody built
//          in this game's own builder and wants to hand to someone else, and
//          what the Object Builder's Export button writes.
//   .js    a Three.js generator module — `export const meta` + `export
//          function build(seed)`, the same contract as environment/plugins/.
//          For an asset authored as CODE (which is how everything in
//          src/generators/environment/ is built, and what an AI asked for "a
//          three.js prop" hands back). Seeded, so each placement varies.
//   .glb / .gltf / .fbx  a mesh file, for assets that came from outside this
//          project entirely.
//
// Nothing here is ever written back into the project's own catalogs
// (objects.json / models.json): the FOLDER is the source of truth. A file
// removed from it simply stops being offered, and no code path here deletes,
// rewrites, or overwrites a file somebody dropped in by hand. Entries are
// instead MERGED into what /api/objects and /api/models serve, so every
// existing consumer — the palette, the live game, collision — treats an
// imported asset exactly like a local one with no special-casing.
const IMPORT_DIR = path.join(ROOT, 'src/generators/environment/import');
const IMPORT_METRICS_PATH = path.join(ROOT, 'models/imported-metrics.json');
const IMPORT_MODEL_EXT_RE = /\.(glb|gltf|fbx)$/i;
/** Marks an entry as folder-owned everywhere downstream: no delete button in the editor, never written into a catalog file. */
const IMPORT_SOURCE = 'import-folder';
const IMPORT_URL_BASE = '/src/generators/environment/import';

let importedMetrics = {};
try {
  if (existsSync(IMPORT_METRICS_PATH)) importedMetrics = JSON.parse(readFileSync(IMPORT_METRICS_PATH, 'utf-8'));
} catch (err) {
  console.warn(`imported-metrics.json unreadable (${err.message}) — imported mesh assets will be re-measured`);
}

/** Every file in the import folder, or [] if the folder isn't there yet. */
function importDirFiles() {
  try {
    return readdirSync(IMPORT_DIR).sort();
  } catch {
    return []; // folder missing entirely is fine — just means nothing imported yet
  }
}

/** A stable catalog id for a dropped MESH file. Derived from the FILENAME, not a timestamp, so the id a placed prop stores in world.json still resolves after a restart, and resolves to the same asset on somebody else's copy of the same folder. (A .json/.js asset doesn't need this — it carries its own authored id, which is what lets the same asset keep its identity across two different people's projects.) */
function importedModelId(file) {
  return `imported-${file.replace(IMPORT_MODEL_EXT_RE, '').replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()}`;
}

/** Dropped mesh files as model-catalog entries. Cheap enough (one readdir) to re-run per request, which is what makes "drop a file in, refresh the browser" work with no restart. */
function scanImportedModels() {
  return importDirFiles().filter((f) => IMPORT_MODEL_EXT_RE.test(f)).map((file) => {
    const metrics = importedMetrics[file] || {};
    return {
      id: importedModelId(file),
      name: file.replace(IMPORT_MODEL_EXT_RE, ''),
      // Served by the existing `/src` static mount — no new route needed, and
      // an unpacked .gltf's sibling .bin/textures resolve relative to it.
      url: `${IMPORT_URL_BASE}/${encodeURIComponent(file)}`,
      importScale: 1,
      // The one fact that can't come from the file's name and that the server
      // can't parse out of opaque binary itself: the measured footprint
      // collision needs. Filled in by the editor (POST /api/imported-assets/
      // metrics) into a sidecar keyed by filename — never into the file.
      footprintRadius: metrics.footprintRadius ?? null,
      height: metrics.height ?? null,
      category: 'imported',
      source: IMPORT_SOURCE,
      file,
    };
  });
}

/**
 * Dropped Object Builder exports (.json) as ObjectDefs.
 *
 * A malformed or hand-mangled file is WARNED ABOUT AND SKIPPED rather than
 * thrown: every other catalog in this server is authored here and a parse
 * failure there is a real bug worth crashing on, but this folder holds files
 * that arrived from somewhere else entirely. One bad share must not stop the
 * server from booting.
 *
 * An id that already exists in objects.json is skipped too, with a warning.
 * Silently shadowing a local object would change what every already-placed
 * instance of it looks like, which is a lot of damage for dropping a file in
 * a folder.
 */
function scanImportedObjects() {
  const local = new Set(objectDefs.map((o) => o.id));
  const out = [];
  for (const file of importDirFiles()) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    let defs;
    try {
      const raw = JSON.parse(readFileSync(path.join(IMPORT_DIR, file), 'utf-8'));
      // Accepts a single object as well as an array, so a share can be either
      // one asset or a whole pack of them in one file.
      defs = parseObjectDefs(Array.isArray(raw) ? raw : [raw]);
    } catch (err) {
      console.warn(`[imported assets] skipping "${file}": ${err.message}`);
      continue;
    }
    for (const def of defs) {
      if (local.has(def.id) || out.some((o) => o.id === def.id)) {
        console.warn(`[imported assets] skipping "${def.id}" from "${file}": that id already exists`);
        continue;
      }
      out.push({ ...def, category: 'imported', source: IMPORT_SOURCE, file });
    }
  }
  return out;
}

/** Dropped Three.js generator modules (.js), listed for the client to dynamically import — the server never evaluates them. Same contract as environment/plugins/; see src/generators/pluginLoader.js. */
function scanImportedPlugins() {
  return importDirFiles().filter((f) => f.toLowerCase().endsWith('.js'));
}

let importedModels = scanImportedModels();
let importedObjects = scanImportedObjects();

/** Everything the rest of the server treats as an imported model: hand-uploaded (models.json) plus folder-dropped. Collision and /api/models both read this, so a dropped asset collides exactly like an uploaded one. */
function allModels() {
  return [...modelCatalog, ...importedModels];
}

/** Local Object Builder catalog plus dropped .json assets. Same deal: collision and /api/objects read this, so a dropped object collides exactly like a locally-built one. */
function allObjectDefs() {
  return [...objectDefs, ...importedObjects];
}

/** Re-reads the folder and rebuilds collision if what's in it changed. Returns whether anything moved. */
function refreshImportedAssets() {
  const models = scanImportedModels();
  const objects = scanImportedObjects();
  if (JSON.stringify(models) === JSON.stringify(importedModels)
    && JSON.stringify(objects) === JSON.stringify(importedObjects)) return false;
  importedModels = models;
  importedObjects = objects;
  rebuildCollision();
  mapCollisionCache.clear();
  return true;
}

// --- Custom VFX catalog (Skill Builder's "Custom VFX" panel, see src/sim/vfxDefs.js) ---
// Purely cosmetic — the server never spawns particle effects itself, so
// (unlike models/weapons) there's no live registry to keep in sync here;
// this is just a persisted catalog file the client fetches and registers
// into src/render/vfx/index.js's own registerCustomVfxDefs() locally.
const VFX_PATH = path.join(ROOT, 'vfx/custom-vfx.json');
if (!existsSync(VFX_PATH)) {
  mkdirSync(path.dirname(VFX_PATH), { recursive: true });
  writeFileSync(VFX_PATH, '[]');
}
let vfxCatalog = parseVfxDefs(JSON.parse(readFileSync(VFX_PATH, 'utf-8')));

// --- Load Character & NPC Builder catalog ---
// Seeded from the built-in humanoid prefabs on first run. characterPresets.js is
// plain data (no Three import), so the server can read it directly.
const CHARACTER_TYPES_PATH = path.join(ROOT, 'character-types/character-types.json');
if (!existsSync(CHARACTER_TYPES_PATH)) {
  mkdirSync(path.dirname(CHARACTER_TYPES_PATH), { recursive: true });
  writeFileSync(CHARACTER_TYPES_PATH, JSON.stringify(CHARACTER_PRESETS, null, 2));
  console.log(`Seeded character-types.json with ${CHARACTER_PRESETS.length} built-in prefabs`);
}
let characterTypeDefs = parseCreatureTypeDefs(JSON.parse(readFileSync(CHARACTER_TYPES_PATH, 'utf-8')));

// --- Weapon grip/hold tuning ---
// Authored in the Character & NPC Builder. Applied to this process's weapon
// defs on load so anything the server derives from a grip agrees with the
// client, which fetches the same file and applies it identically.
const WEAPON_TUNING_PATH = path.join(ROOT, 'weapon-tuning/weapon-tuning.json');
if (!existsSync(WEAPON_TUNING_PATH)) {
  mkdirSync(path.dirname(WEAPON_TUNING_PATH), { recursive: true });
  writeFileSync(WEAPON_TUNING_PATH, '{}');
}
// Self-healing, not just strict: a weapon id can go stale here through paths
// other than the /api/models/catalog delete endpoint (a hand-edited JSON
// file, a restored .bak). validateWeaponTuning is intentionally strict for
// the save path (a typo'd id there is an authoring mistake worth failing
// loudly on), but at boot an orphaned entry should never be able to take the
// whole server down — drop it, warn, and persist the cleaned file.
const rawWeaponTuning = JSON.parse(readFileSync(WEAPON_TUNING_PATH, 'utf-8'));
const staleWeaponTuningIds = Object.keys(rawWeaponTuning).filter((id) => !getWeaponTypeDef(id));
if (staleWeaponTuningIds.length) {
  console.warn(`weapon-tuning.json: dropping tuning for unknown weapon type(s) ${staleWeaponTuningIds.join(', ')} (model deleted?)`);
  for (const id of staleWeaponTuningIds) delete rawWeaponTuning[id];
  copyFileSync(WEAPON_TUNING_PATH, WEAPON_TUNING_PATH + '.bak');
  writeFileSync(WEAPON_TUNING_PATH, JSON.stringify(rawWeaponTuning, null, 2));
}
let weaponTuning = validateWeaponTuning(rawWeaponTuning);
applyWeaponTuning(weaponTuning);

// --- Building Builder catalogs (Part Library + assembled Building Catalog) ---
// Part Library seeded from the built-in starter parts on first run, same
// principle as character-types.json seeding from CHARACTER_PRESETS.
// buildingPartPresets.js is plain data (no Three import), so the server can
// read it directly.
const BUILDING_PARTS_PATH = path.join(ROOT, 'building-parts/building-parts.json');
if (!existsSync(BUILDING_PARTS_PATH)) {
  mkdirSync(path.dirname(BUILDING_PARTS_PATH), { recursive: true });
  writeFileSync(BUILDING_PARTS_PATH, JSON.stringify(BUILDING_PART_PRESETS, null, 2));
  console.log(`Seeded building-parts.json with ${BUILDING_PART_PRESETS.length} built-in parts`);
}
let buildingPartDefs = parseBuildingPartDefs(JSON.parse(readFileSync(BUILDING_PARTS_PATH, 'utf-8')));

// The Building Catalog starts empty — there's no built-in "starter building",
// only starter parts; Dennis assembles the first buildings himself.
const BUILDING_TYPES_PATH = path.join(ROOT, 'building-types/building-types.json');
if (!existsSync(BUILDING_TYPES_PATH)) {
  mkdirSync(path.dirname(BUILDING_TYPES_PATH), { recursive: true });
  writeFileSync(BUILDING_TYPES_PATH, '[]');
}
let buildingTypeDefs = parseBuildingTypeDefs(JSON.parse(readFileSync(BUILDING_TYPES_PATH, 'utf-8')));

// --- Custom ground-texture uploads (World Editor Ground Textures mode) ---
// Just catalog metadata (id/name/url) — the painted mask layers themselves
// live on world.groundTextures (src/sim/groundTextures.js), same split as
// items' authored catalog vs. their uploaded icons.
const GROUND_TEXTURES_PATH = path.join(ROOT, 'ground-textures/ground-textures.json');
const GROUND_TEXTURES_DIR = path.join(ROOT, 'public/assets/ground-textures');
mkdirSync(GROUND_TEXTURES_DIR, { recursive: true });
if (!existsSync(GROUND_TEXTURES_PATH)) {
  mkdirSync(path.dirname(GROUND_TEXTURES_PATH), { recursive: true });
  writeFileSync(GROUND_TEXTURES_PATH, '[]');
}
let customGroundTextures = parseCustomGroundTextures(JSON.parse(readFileSync(GROUND_TEXTURES_PATH, 'utf-8')));

// --- Custom path-texture uploads (World Editor Paths mode) ---
// Same catalog-metadata split as ground textures: id/name/url here, the
// drawn polylines themselves live on world.paths (src/sim/paths.js), which
// just references a texture by id ('custom:<uploadId>').
const PATH_TEXTURES_PATH = path.join(ROOT, 'path-textures/path-textures.json');
const PATH_TEXTURES_DIR = path.join(ROOT, 'public/assets/path-textures');
mkdirSync(PATH_TEXTURES_DIR, { recursive: true });
if (!existsSync(PATH_TEXTURES_PATH)) {
  mkdirSync(path.dirname(PATH_TEXTURES_PATH), { recursive: true });
  writeFileSync(PATH_TEXTURES_PATH, '[]');
}
let customPathTextures = parseCustomPathTextures(JSON.parse(readFileSync(PATH_TEXTURES_PATH, 'utf-8')));

// --- Uploaded audio (World Editor Freeform Zones — per-zone music/ambient) ---
// Same catalog-metadata split as ground textures: id/name/kind/url here, the
// zone->track association lives on world.zones[].music/.ambientSound
// (src/sim/zones.js).
const AUDIO_PATH = path.join(ROOT, 'audio/audio-catalog.json');
const AUDIO_DIR = path.join(ROOT, 'public/assets/audio');
mkdirSync(AUDIO_DIR, { recursive: true });
if (!existsSync(AUDIO_PATH)) {
  mkdirSync(path.dirname(AUDIO_PATH), { recursive: true });
  writeFileSync(AUDIO_PATH, '[]');
}
let audioCatalog = parseAudioCatalog(JSON.parse(readFileSync(AUDIO_PATH, 'utf-8')));

// --- Static collision (overworld only; tower floors + interiors are bare rooms) ---
// Rebuilt whenever the editor saves a new world or object catalog, since both
// feed the colliders. The client builds the identical index from the same two
// files and runs the same resolveMovement in its prediction step.
/** @type {import('../src/sim/collision.js').CollisionIndex} */
let collision;
function rebuildCollision() {
  collision = buildCollisionIndex(
    world,
    Object.fromEntries(allObjectDefs().map((o) => [o.id, o])),
    Object.fromEntries(allModels().map((m) => [m.id, m]))
  );
  return collision;
}
rebuildCollision();
console.log(`Built ${collision.colliders.length} static colliders`);

// --- Express: serve client + world JSON ---
const app = express();
app.use(express.json({ limit: '10mb' })); // world JSON with a painted heightmap can be sizable
app.use(express.static(path.join(ROOT, 'public'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
app.use('/src', express.static(path.join(ROOT, 'src'), { setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
// Legacy aliases — kept so nothing that predates multi-map support (an
// old bookmark, a script) breaks; both always resolve to the one map
// flagged isDefault in the manifest. The World Editor's Maps mode (a later
// phase) talks to /api/maps* directly instead.
app.get('/world/world.json', (_req, res) => res.json(world));
app.get('/editor', (_req, res) => res.sendFile(path.join(ROOT, 'public/editor.html')));

function mapFilePath(meta) {
  return path.join(MAPS_DIR, meta.path);
}

function writeManifest() {
  const manifest = [...maps.values()].map((m) => m.meta);
  writeFileSync(MAPS_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

/**
 * Validates + writes one map's document to disk (with a .bak backup, same
 * pattern the old single-world save used), updates the in-memory `maps`
 * entry, and — only when this IS the default overworld map — refreshes the
 * `world` alias and the live overworld monster/NPC/collision state exactly
 * like the old /api/world handler did. Every other map's save is inert
 * beyond the write itself until a later phase wires up building/dungeon
 * live state the same way.
 */
function saveMap(id, rawData) {
  const entry = maps.get(id);
  if (!entry) throw Object.assign(new Error(`No map with id "${id}"`), { status: 404 });
  const validated = parseWorld(rawData);
  if (!validated.graphicsSettings) validated.graphicsSettings = defaultGraphicsSettings(); // an older client/API caller saving without it
  const meta = entry.meta;
  if (existsSync(mapFilePath(meta))) copyFileSync(mapFilePath(meta), mapFilePath(meta) + '.bak');
  writeFileSync(mapFilePath(meta), JSON.stringify(validated, null, 2));
  entry.world = validated;
  mapCollisionCache.delete(id); // stale — rebuilt lazily next time someone's actually on this map
  rebuildTeleporterRegistry();
  if (id === defaultOverworldMapId) {
    world = validated; // live server picks up the new world immediately
    overworldMonsters = initMonsterState(world.monsters); // resets overworld monster health, same as a floor save does
    overworldNpcs = (world.npcs || []).map(initNpcState); // resets NPC wander state to the newly-saved homes
    overworldEvents = world.events || [];
    eventObjectState.clear();
    for (const ev of overworldEvents) eventObjectState.set(ev.id, initEventObjectWorldState());
    rebuildCollision(); // props/buildings/walls just changed
  }
}

app.get('/api/maps', (_req, res) => {
  res.json([...maps.values()].map((m) => m.meta));
});

app.get('/api/maps/:id', (req, res) => {
  const entry = maps.get(req.params.id);
  if (!entry) return res.status(404).json({ error: `No map with id "${req.params.id}"` });
  res.json(entry.world);
});

// World Editor is an admin/dev-only tool (see CLAUDE.md) — no auth gate yet,
// same as the rest of Phase 3. Add one before exposing this beyond localhost.
app.post('/api/world', (req, res) => {
  try {
    saveMap(defaultOverworldMapId, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: `Invalid world data: ${err.message}` });
  }
});

app.post('/api/maps/:id', (req, res) => {
  try {
    saveMap(req.params.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 400).json({ error: `Invalid world data: ${err.message}` });
  }
});

// Creates a new, empty map — id/name/mapType/width/height in the request
// body. Width/height become `bounds` centered on the origin (the World
// Editor's "definable map size" ask); everything else starts empty, same
// minimal shape parseWorld already accepts (no terrain/props/etc.).
app.post('/api/maps', (req, res) => {
  const { id, name, mapType, width = 200, height = 200 } = req.body || {};
  if (!id || !name || !MAP_TYPES.includes(mapType)) {
    return res.status(400).json({ error: 'Map creation needs a non-empty id, name, and a valid mapType.' });
  }
  if (maps.has(id)) {
    return res.status(400).json({ error: `A map with id "${id}" already exists.` });
  }
  if (typeof width !== 'number' || width <= 0 || typeof height !== 'number' || height <= 0) {
    return res.status(400).json({ error: 'Map width/height must be positive numbers.' });
  }
  const doc = {
    id,
    name,
    mapType,
    bounds: { minX: -width / 2, maxX: width / 2, minZ: -height / 2, maxZ: height / 2 },
    spawnPoint: { x: 0, y: 0, z: 0, facingDeg: 0 },
    zones: [],
    buildings: [],
    props: [],
    teleporters: [],
    graphicsSettings: defaultGraphicsSettings(),
  };
  const validated = parseWorld(doc);
  const meta = { id, name, mapType, path: `${id}.json` };
  writeFileSync(mapFilePath(meta), JSON.stringify(validated, null, 2));
  maps.set(id, { meta, world: validated });
  writeManifest();
  rebuildTeleporterRegistry();
  res.json({ ok: true, meta });
});

// Soft delete: removes the map from the manifest/live registry (so it stops
// being loadable/linkable) but deliberately leaves its JSON file on disk —
// same "don't destroy authored content on a click" reasoning as every
// other save here keeping a .bak. A stray orphaned file is cheap; an
// accidentally-deleted hand-built dungeon map is not.
app.delete('/api/maps/:id', (req, res) => {
  const id = req.params.id;
  if (id === defaultOverworldMapId) {
    return res.status(400).json({ error: 'Cannot delete the default overworld map.' });
  }
  if (!maps.has(id)) {
    return res.status(404).json({ error: `No map with id "${id}"` });
  }
  maps.delete(id);
  mapCollisionCache.delete(id);
  writeManifest();
  rebuildTeleporterRegistry();
  res.json({ ok: true });
});

// Convenience read for the World Editor's teleporter-link picker — every
// teleporter across every loaded map, with just enough to build a "link to
// this one" dropdown without the editor needing every map's full document
// loaded at once just to cross-link.
app.get('/api/teleporters', (_req, res) => {
  res.json(
    [...teleporterRegistry.entries()].map(([id, { teleporter, mapId }]) => ({
      id,
      mapId,
      mapName: maps.get(mapId)?.meta.name,
      linkedTeleporterId: teleporter.linkedTeleporterId,
      mode: teleporter.mode,
      visible: teleporter.visible,
    }))
  );
});

// Tower floor editing (monster placement, World Editor roadmap item #4) —
// same load/validate/save/backup pattern as /api/world, just per-floor.
app.get('/api/tower/floors', (_req, res) => {
  res.json({ floors: [...towerFloors.keys()].sort((a, b) => a - b) });
});

app.get('/api/tower/floor/:n', (req, res) => {
  const n = parseInt(req.params.n, 10);
  const floor = towerFloors.get(n);
  if (!floor) return res.status(404).json({ error: `No floor ${n}` });
  res.json(floor.def);
});

app.post('/api/tower/floor/:n', (req, res) => {
  const n = parseInt(req.params.n, 10);
  let validated;
  try {
    validated = parseFloor(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid floor data: ${err.message}` });
  }
  if (validated.floorNumber !== n) {
    return res.status(400).json({ error: `floorNumber (${validated.floorNumber}) doesn't match URL (${n})` });
  }
  const filePath = path.join(FLOORS_DIR, `floor-${n}.json`);
  try {
    if (existsSync(filePath)) copyFileSync(filePath, filePath + '.bak');
    writeFileSync(filePath, JSON.stringify(validated, null, 2));
    // Live server picks it up immediately, same as world.json — this resets
    // that floor's monster health state, which is fine for a dev/admin tool.
    towerFloors.set(n, { def: validated, monsters: initMonsterState(validated.monsterSpawns) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write floor-${n}.json: ${err.message}` });
  }
});

// Authored items (World Editor Items mode) — same load/validate/save/backup
// pattern as world.json and tower floors.
app.get('/api/items', (_req, res) => res.json(authoredItems));

app.post('/api/items', (req, res) => {
  let validated;
  try {
    validated = parseAuthoredItems(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid item data: ${err.message}` });
  }
  try {
    if (existsSync(ITEMS_PATH)) copyFileSync(ITEMS_PATH, ITEMS_PATH + '.bak');
    writeFileSync(ITEMS_PATH, JSON.stringify(validated, null, 2));
    authoredItems = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write items.json: ${err.message}` });
  }
});

// Authored quests — same load/validate/save/backup pattern as items.
app.get('/api/quests', (_req, res) => res.json(quests));

app.post('/api/quests', (req, res) => {
  let validated;
  try {
    validated = parseQuests(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid quest data: ${err.message}` });
  }
  try {
    if (existsSync(QUESTS_PATH)) copyFileSync(QUESTS_PATH, QUESTS_PATH + '.bak');
    writeFileSync(QUESTS_PATH, JSON.stringify(validated, null, 2));
    quests = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write quests.json: ${err.message}` });
  }
});

// Delete ONE quest, rather than re-POSTing the whole catalog.
//
// The editor used to delete by filtering its in-memory list and saving all of
// it back, which meant a single unrelated bad row anywhere in quests.json
// (say, one left half-authored against a map that has since been deleted)
// made it impossible to delete ANY quest — parseQuests rejects the whole
// array or none of it. Deleting by id can't be blocked by its neighbours.
app.delete('/api/quests/:id', (req, res) => {
  const id = req.params.id;
  const next = quests.filter((q) => q.id !== id);
  if (next.length === quests.length) {
    return res.status(404).json({ error: `No quest with id "${id}"` });
  }
  try {
    if (existsSync(QUESTS_PATH)) copyFileSync(QUESTS_PATH, QUESTS_PATH + '.bak');
    writeFileSync(QUESTS_PATH, JSON.stringify(next, null, 2));
    quests = next;
    res.json({ ok: true, quests: next });
  } catch (err) {
    res.status(500).json({ error: `Failed to write quests.json: ${err.message}` });
  }
});

// Authored recipes (World Editor Recipe Builder) — same load/validate/
// save/backup pattern as items/quests.
app.get('/api/recipes', (_req, res) => res.json(recipes));

app.post('/api/recipes', (req, res) => {
  let validated;
  try {
    validated = parseRecipeDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid recipe data: ${err.message}` });
  }
  try {
    if (existsSync(RECIPES_PATH)) copyFileSync(RECIPES_PATH, RECIPES_PATH + '.bak');
    writeFileSync(RECIPES_PATH, JSON.stringify(validated, null, 2));
    recipes = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write recipes.json: ${err.message}` });
  }
});

// Object Builder catalog (World Editor roadmap section E) — same
// load/validate/save/backup pattern as items/quests.
// Re-scans the import folder per request, same as /api/models — dropping an
// exported .json asset in should only need a browser refresh (this server has
// no file watcher and no auto-restart).
app.get('/api/objects', (_req, res) => {
  refreshImportedAssets();
  res.json(allObjectDefs());
});

app.post('/api/objects', (req, res) => {
  let validated;
  try {
    // The client holds ONE merged list (local + folder-dropped, see the GET
    // above) and posts it back wholesale, so folder entries are stripped here
    // rather than trusting the client to have filtered them: they must never
    // be copied into objects.json, where they'd become a second, diverging
    // owner of an asset whose real source is a file in the import folder.
    if (!Array.isArray(req.body)) throw new Error('Object definitions data must be an array');
    validated = parseObjectDefs(req.body.filter((o) => o?.source !== IMPORT_SOURCE));
  } catch (err) {
    return res.status(400).json({ error: `Invalid object data: ${err.message}` });
  }
  try {
    if (existsSync(OBJECTS_PATH)) copyFileSync(OBJECTS_PATH, OBJECTS_PATH + '.bak');
    writeFileSync(OBJECTS_PATH, JSON.stringify(validated, null, 2));
    objectDefs = validated;
    rebuildCollision(); // a placed custom prop's footprint comes from its object def
    mapCollisionCache.clear(); // non-default maps bake the same object defs into their colliders
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write objects.json: ${err.message}` });
  }
});

// Custom ground-texture uploads — list, upload, delete (delete = client posts
// the filtered catalog back, same idiom every other catalog uses).
app.get('/api/ground-textures', (_req, res) => res.json(customGroundTextures));

const groundTextureUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, GROUND_TEXTURES_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
      cb(null, `groundtex-${Date.now()}-${Math.floor(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — these tile across the whole map, a bit more headroom than item icons
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/ground-textures/upload', groundTextureUpload.single('texture'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No texture file uploaded (expected an image, field name "texture")' });
  const entry = {
    id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: (req.body?.name || req.file.originalname || 'Custom Texture').slice(0, 60),
    url: `/assets/ground-textures/${req.file.filename}`,
  };
  const updated = [...customGroundTextures, entry];
  try {
    parseCustomGroundTextures(updated);
    if (existsSync(GROUND_TEXTURES_PATH)) copyFileSync(GROUND_TEXTURES_PATH, GROUND_TEXTURES_PATH + '.bak');
    writeFileSync(GROUND_TEXTURES_PATH, JSON.stringify(updated, null, 2));
    customGroundTextures = updated;
    res.json({ ok: true, entry, catalog: customGroundTextures });
  } catch (err) {
    res.status(500).json({ error: `Failed to save ground texture: ${err.message}` });
  }
});

app.post('/api/ground-textures/catalog', (req, res) => {
  let validated;
  try {
    validated = parseCustomGroundTextures(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid ground texture catalog: ${err.message}` });
  }
  try {
    if (existsSync(GROUND_TEXTURES_PATH)) copyFileSync(GROUND_TEXTURES_PATH, GROUND_TEXTURES_PATH + '.bak');
    writeFileSync(GROUND_TEXTURES_PATH, JSON.stringify(validated, null, 2));
    customGroundTextures = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write ground-textures.json: ${err.message}` });
  }
});

// Custom path-texture uploads — list, upload, delete (delete = client posts
// the filtered catalog back, same idiom as ground textures).
app.get('/api/path-textures', (_req, res) => res.json(customPathTextures));

const pathTextureUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PATH_TEXTURES_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '.png';
      cb(null, `pathtex-${Date.now()}-${Math.floor(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — these tile along a road, same headroom as ground texture uploads
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/path-textures/upload', pathTextureUpload.single('texture'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No texture file uploaded (expected an image, field name "texture")' });
  const entry = {
    id: `custom-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: (req.body?.name || req.file.originalname || 'Custom Texture').slice(0, 60),
    url: `/assets/path-textures/${req.file.filename}`,
  };
  const updated = [...customPathTextures, entry];
  try {
    parseCustomPathTextures(updated);
    if (existsSync(PATH_TEXTURES_PATH)) copyFileSync(PATH_TEXTURES_PATH, PATH_TEXTURES_PATH + '.bak');
    writeFileSync(PATH_TEXTURES_PATH, JSON.stringify(updated, null, 2));
    customPathTextures = updated;
    res.json({ ok: true, entry, catalog: customPathTextures });
  } catch (err) {
    res.status(500).json({ error: `Failed to save path texture: ${err.message}` });
  }
});

app.post('/api/path-textures/catalog', (req, res) => {
  let validated;
  try {
    validated = parseCustomPathTextures(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid path texture catalog: ${err.message}` });
  }
  try {
    if (existsSync(PATH_TEXTURES_PATH)) copyFileSync(PATH_TEXTURES_PATH, PATH_TEXTURES_PATH + '.bak');
    writeFileSync(PATH_TEXTURES_PATH, JSON.stringify(validated, null, 2));
    customPathTextures = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write path-textures.json: ${err.message}` });
  }
});

// Uploaded audio (World Editor Freeform Zones) — list, upload, delete. Same
// list-upload-delete idiom as ground textures; `kind` (music|ambient) comes
// from the upload form so the editor's two dropdowns can filter the catalog.
app.get('/api/audio', (_req, res) => res.json(audioCatalog));

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.mp3', '.ogg', '.wav'].includes(ext) ? ext : '.mp3';
      cb(null, `audio-${Date.now()}-${Math.floor(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB — a multi-minute music loop is bigger than a texture or icon
  fileFilter: (_req, file, cb) => cb(null, /^audio\//.test(file.mimetype)),
});

app.post('/api/audio/upload', audioUpload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded (expected audio, field name "audio")' });
  const kind = req.body?.kind;
  if (!AUDIO_KINDS.includes(kind)) {
    unlinkSync(path.join(AUDIO_DIR, req.file.filename)); // reject cleanly — don't leave an orphaned file with no catalog entry
    return res.status(400).json({ error: `kind must be one of ${AUDIO_KINDS.join(', ')}` });
  }
  const entry = {
    id: `audio-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: (req.body?.name || req.file.originalname || 'Untitled Track').slice(0, 60),
    kind,
    url: `/assets/audio/${req.file.filename}`,
  };
  const updated = [...audioCatalog, entry];
  try {
    parseAudioCatalog(updated);
    if (existsSync(AUDIO_PATH)) copyFileSync(AUDIO_PATH, AUDIO_PATH + '.bak');
    writeFileSync(AUDIO_PATH, JSON.stringify(updated, null, 2));
    audioCatalog = updated;
    res.json({ ok: true, entry, catalog: audioCatalog });
  } catch (err) {
    res.status(500).json({ error: `Failed to save audio track: ${err.message}` });
  }
});

app.post('/api/audio/catalog', (req, res) => {
  let validated;
  try {
    validated = parseAudioCatalog(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid audio catalog: ${err.message}` });
  }
  try {
    const removed = audioCatalog.filter((old) => !validated.some((n) => n.id === old.id));
    for (const entry of removed) {
      const filePath = path.join(AUDIO_DIR, path.basename(entry.url));
      if (existsSync(filePath)) unlinkSync(filePath);
    }
    if (existsSync(AUDIO_PATH)) copyFileSync(AUDIO_PATH, AUDIO_PATH + '.bak');
    writeFileSync(AUDIO_PATH, JSON.stringify(validated, null, 2));
    audioCatalog = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write audio-catalog.json: ${err.message}` });
  }
});

// Imported models (FBX or glTF/GLB) — list, upload, delete/update
// (delete/measurement-save = client posts the filtered/updated catalog
// back, same idiom as every other catalog). Filtered by extension, not
// MIME type: browsers/multer don't reliably report a useful mimetype for
// either format. The uploaded filename keeps its real extension (rather
// than always writing `.fbx` as before) so modelLoader.js can tell client-side
// which loader (FBXLoader vs GLTFLoader) to use for a given catalog entry.
// Re-scans the import folder on every request rather than trusting the boot
// snapshot: dropping a .glb into src/generators/environment/import/ should
// only need a browser refresh, and this server has no file watcher and no
// auto-restart (see the flora-plugins route, which works the same way). When
// the set genuinely changed, collision is rebuilt too, so a newly-appeared
// asset that is already referenced by a placed prop starts blocking movement
// server-side without waiting for the next world save.
app.get('/api/models', (_req, res) => {
  refreshImportedAssets();
  res.json(allModels());
});

// The .js half of the import folder: Three.js generator modules the CLIENT
// dynamically imports (the server never evaluates them — same arrangement as
// /api/flora-plugins, which this deliberately mirrors). Listed separately from
// the models/objects catalogs because a generator isn't data: it only becomes
// a prop type once the browser has actually imported it and read its `meta`.
app.get('/api/imported-assets/plugins', (_req, res) => res.json(scanImportedPlugins()));

// Persist an imported asset's client-measured footprint/height. The folder is
// the source of truth for WHICH assets exist, so this sidecar only ever holds
// measurements, keyed by filename — see the scanImportedModels block above.
app.post('/api/imported-assets/metrics', (req, res) => {
  const { file, footprintRadius, height } = req.body || {};
  if (typeof file !== 'string' || !importedModels.some((m) => m.file === file)) {
    return res.status(400).json({ error: `Unknown imported asset file: "${file}"` });
  }
  if (!Number.isFinite(footprintRadius) || !Number.isFinite(height)) {
    return res.status(400).json({ error: 'footprintRadius and height must both be numbers' });
  }
  try {
    importedMetrics = { ...importedMetrics, [file]: { footprintRadius, height } };
    if (existsSync(IMPORT_METRICS_PATH)) copyFileSync(IMPORT_METRICS_PATH, IMPORT_METRICS_PATH + '.bak');
    writeFileSync(IMPORT_METRICS_PATH, JSON.stringify(importedMetrics, null, 2));
    importedModels = scanImportedModels(); // pick the new numbers up in this process, not just after a restart
    rebuildCollision();
    mapCollisionCache.clear();
    res.json({ ok: true, catalog: allModels() });
  } catch (err) {
    res.status(500).json({ error: `Failed to write imported-metrics.json: ${err.message}` });
  }
});

const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MODELS_DIR),
    filename: (_req, file, cb) => {
      const ext = /\.glb$/i.test(file.originalname) ? 'glb' : 'fbx';
      cb(null, `model-${Date.now()}-${Math.floor(Math.random() * 1e9)}.${ext}`);
    },
  }),
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB — a real FBX/GLB (baked meshes, embedded textures) blew past the original 50MB on the first real upload
  fileFilter: (_req, file, cb) => cb(null, /\.(fbx|glb)$/i.test(file.originalname)),
});

app.post('/api/models/upload', modelUpload.single('model'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No model file uploaded (expected a .fbx or .glb file, field name "model")' });
  const importScale = parseFloat(req.body?.importScale);
  const entry = {
    id: `model-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: (req.body?.name || req.file.originalname || 'Imported Model').slice(0, 60),
    url: `/assets/models/${req.file.filename}`,
    importScale: Number.isFinite(importScale) ? importScale : 1,
    footprintRadius: null, // measured client-side right after this resolves — see /api/models/catalog
    height: null,
  };
  // The Character & NPC Builder uploads a weapon model through this SAME
  // endpoint (see src/sim/weaponTypes.js's registerCustomWeaponModels) rather
  // than a parallel one — hands/slot are the only weapon-specific facts it
  // can't derive from the mesh itself, same reason footprintRadius/height
  // above get measured after the fact instead of guessed here.
  if (req.body?.category === 'weapon') {
    const hands = parseInt(req.body?.hands, 10);
    entry.category = 'weapon';
    entry.weapon = { hands: hands === 2 ? 2 : 1, slot: req.body?.slot || 'main' };
  } else {
    // Which Place/Scatter palette tab this prop shows under — see
    // src/sim/propTypes.js's PROP_CATEGORIES. Falls back to 'misc' for a
    // missing/unrecognized value rather than rejecting the upload outright.
    const category = req.body?.category;
    entry.category = PROP_CATEGORIES.some((c) => c.id === category) ? category : 'misc';
  }
  const updated = [...modelCatalog, entry];
  try {
    parseModelCatalog(updated);
    if (existsSync(MODELS_PATH)) copyFileSync(MODELS_PATH, MODELS_PATH + '.bak');
    writeFileSync(MODELS_PATH, JSON.stringify(updated, null, 2));
    modelCatalog = updated;
    registerCustomWeaponModels(modelCatalog); // so a save later in this SAME process sees it too, not just after a restart
    res.json({ ok: true, entry, catalog: modelCatalog });
  } catch (err) {
    res.status(500).json({ error: `Failed to save model: ${err.message}` });
  }
});

// Flora/decor plugins — src/generators/environment/plugins/. No catalog file,
// no upload endpoint: this just lists what's on disk right now so the client
// can dynamically import each one (see src/generators/pluginLoader.js). The
// zero-edit path — drop a .js file in that folder, refresh, it's placeable.
const PLUGINS_DIR = path.join(ROOT, 'src/generators/environment/plugins');
app.get('/api/flora-plugins', (_req, res) => {
  let files = [];
  try {
    files = readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js'));
  } catch {
    // Folder missing entirely is fine — just means no plugins yet.
  }
  res.json(files);
});

// A weapon model deleted while a character/NPC/monster still equips it left
// a dangling id in character-types.json/monster-types.json that only surfaced
// as a hard crash on the NEXT server start (validateEquipment in
// creatureTypeDefs.js throws on an unknown weapon type). Block the deletion
// instead, at the source, so it's caught in the builder UI, not at boot.
function findWeaponIdUsers(weaponId) {
  const users = [];
  for (const c of [...characterTypeDefs, ...monsterTypeDefs]) {
    const usesIt = c.equipment?.mainHand === weaponId || c.equipment?.offHand === weaponId ||
      c.previewWeapon === weaponId || (c.allowedWeaponTypes || []).includes(weaponId);
    if (usesIt) users.push(c.id);
  }
  return users;
}

app.post('/api/models/catalog', (req, res) => {
  let validated;
  try {
    // The client holds ONE merged list (uploaded + folder-dropped, see
    // /api/models above) and posts it back wholesale, so folder entries are
    // stripped here rather than trusting the client to have filtered them.
    // They must never reach models.json — and, more importantly, their
    // absence from `validated` must never be read as a deletion by the
    // orphan-file cleanup below, which would delete files out of the author's
    // own import folder.
    if (!Array.isArray(req.body)) throw new Error('Model catalog must be an array');
    validated = parseModelCatalog(req.body.filter((m) => m?.source !== 'import-folder'));
  } catch (err) {
    return res.status(400).json({ error: `Invalid model catalog: ${err.message}` });
  }
  try {
    // This endpoint doubles as "persist a measured footprint after upload"
    // and "delete" (client posts the filtered array back, same idiom as
    // every other catalog) — only entries genuinely missing from the new
    // array count as deletions, so an edit-in-place never touches a file.
    // FBX uploads can be huge (up to 300MB), so unlike icons/ground-texture
    // images, leaving these orphaned on disk is worth actually avoiding.
    const removed = modelCatalog.filter((old) => !validated.some((v) => v.id === old.id));
    const blockedByUse = removed
      .filter((entry) => entry.category === 'weapon')
      .map((entry) => ({ entry, users: findWeaponIdUsers(entry.id) }))
      .filter(({ users }) => users.length > 0);
    if (blockedByUse.length) {
      const details = blockedByUse
        .map(({ entry, users }) => `"${entry.name}" (${entry.id}) is still equipped by: ${users.join(', ')}`)
        .join('; ');
      return res.status(409).json({ error: `Cannot delete weapon model still in use — ${details}. Unequip it in the Character & NPC Builder first.` });
    }
    for (const entry of removed) {
      const filePath = path.join(ROOT, 'public', entry.url.replace(/^\//, ''));
      if (existsSync(filePath)) {
        try {
          unlinkSync(filePath);
        } catch (err) {
          console.error(`Failed to delete model file for "${entry.id}" (${filePath}):`, err);
        }
      }
    }
    // A deleted weapon model's grip/hold tuning is now orphaned data — leaving
    // it in weapon-tuning.json doesn't crash immediately (applyWeaponTuning
    // skips unknown ids at runtime), but validateWeaponTuning is strict and
    // throws on it, so it silently time-bombed the NEXT server boot. Prune it
    // here, the one place a weapon id actually goes away.
    const removedWeaponIds = new Set(removed.filter((e) => e.category === 'weapon').map((e) => e.id));
    if (removedWeaponIds.size && weaponTuning) {
      const prunedTuning = Object.fromEntries(Object.entries(weaponTuning).filter(([id]) => !removedWeaponIds.has(id)));
      if (Object.keys(prunedTuning).length !== Object.keys(weaponTuning).length) {
        if (existsSync(WEAPON_TUNING_PATH)) copyFileSync(WEAPON_TUNING_PATH, WEAPON_TUNING_PATH + '.bak');
        writeFileSync(WEAPON_TUNING_PATH, JSON.stringify(prunedTuning, null, 2));
        weaponTuning = prunedTuning;
      }
    }
    if (existsSync(MODELS_PATH)) copyFileSync(MODELS_PATH, MODELS_PATH + '.bak');
    writeFileSync(MODELS_PATH, JSON.stringify(validated, null, 2));
    modelCatalog = validated;
    registerCustomWeaponModels(modelCatalog);
    rebuildCollision(); // a placed model's footprint may have just been measured for the first time
    mapCollisionCache.clear(); // non-default maps bake the same model footprints into their colliders
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write models.json: ${err.message}` });
  }
});

// Character & NPC Builder catalog — the humanoid half of the shared creature
// schema. Same load/validate/save/backup pattern as the monster catalog. The
// file is seeded on first run from the built-in prefabs
// (src/generators/characterPresets.js), so the five player classes are editable
// from the moment the builder opens rather than having to be rebuilt by hand.
// Class skill catalog (src/sim/skillDefs.js). Same load/validate/save/backup
// pattern as every other authoring endpoint — setSkillCatalog() re-derives
// every class's CLASSES[classId].abilities immediately on save, so a change
// takes effect for the next ability use without a server restart.
app.get('/api/skills', (_req, res) => res.json(skillDefs));

app.post('/api/skills', (req, res) => {
  let validated;
  try {
    validated = parseSkillDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid skill data: ${err.message}` });
  }
  try {
    if (existsSync(SKILLS_PATH)) copyFileSync(SKILLS_PATH, SKILLS_PATH + '.bak');
    writeFileSync(SKILLS_PATH, JSON.stringify(validated, null, 2));
    skillDefs = validated;
    setSkillCatalog(skillDefs);
    skillDefsById = new Map(skillDefs.map((s) => [s.id, s]));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write skill-defs.json: ${err.message}` });
  }
});

// Custom VFX catalog (src/sim/vfxDefs.js) — same load/validate/save/backup
// pattern as skills above, but purely a data store: no live server-side
// registry to keep in sync, since the server never spawns particle effects.
app.get('/api/vfx', (_req, res) => res.json(vfxCatalog));

app.post('/api/vfx', (req, res) => {
  let validated;
  try {
    validated = parseVfxDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid VFX data: ${err.message}` });
  }
  try {
    if (existsSync(VFX_PATH)) copyFileSync(VFX_PATH, VFX_PATH + '.bak');
    writeFileSync(VFX_PATH, JSON.stringify(validated, null, 2));
    vfxCatalog = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write custom-vfx.json: ${err.message}` });
  }
});

app.get('/api/character-types', (_req, res) => res.json(characterTypeDefs));

app.post('/api/character-types', (req, res) => {
  let validated;
  try {
    validated = parseCreatureTypeDefs(req.body);
    for (const c of validated) {
      if (c.kind !== 'character' && c.kind !== 'npc') {
        throw new Error(`"${c.id}" is kind "${c.kind}"; this catalog holds characters and NPCs`);
      }
    }
  } catch (err) {
    return res.status(400).json({ error: `Invalid character data: ${err.message}` });
  }
  try {
    if (existsSync(CHARACTER_TYPES_PATH)) copyFileSync(CHARACTER_TYPES_PATH, CHARACTER_TYPES_PATH + '.bak');
    writeFileSync(CHARACTER_TYPES_PATH, JSON.stringify(validated, null, 2));
    characterTypeDefs = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write character-types.json: ${err.message}` });
  }
});

app.get('/api/weapon-tuning', (_req, res) => res.json(weaponTuning));

app.post('/api/weapon-tuning', (req, res) => {
  let validated;
  try {
    validated = validateWeaponTuning(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid weapon tuning: ${err.message}` });
  }
  try {
    if (existsSync(WEAPON_TUNING_PATH)) copyFileSync(WEAPON_TUNING_PATH, WEAPON_TUNING_PATH + '.bak');
    writeFileSync(WEAPON_TUNING_PATH, JSON.stringify(validated, null, 2));
    weaponTuning = validated;
    applyWeaponTuning(weaponTuning); // this process picks it up without a restart
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write weapon-tuning.json: ${err.message}` });
  }
});

// Building Builder — Part Library. Same load/validate/save/backup pattern as
// character-types. No collision rebuild needed on save: a placed building's
// collision footprint (src/sim/collision.js) comes from its own authored
// footprint field, independent of how its parts are visually assembled.
app.get('/api/building-parts', (_req, res) => res.json(buildingPartDefs));

app.post('/api/building-parts', (req, res) => {
  let validated;
  try {
    validated = parseBuildingPartDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid building part data: ${err.message}` });
  }
  try {
    if (existsSync(BUILDING_PARTS_PATH)) copyFileSync(BUILDING_PARTS_PATH, BUILDING_PARTS_PATH + '.bak');
    writeFileSync(BUILDING_PARTS_PATH, JSON.stringify(validated, null, 2));
    buildingPartDefs = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write building-parts.json: ${err.message}` });
  }
});

// Building Builder — assembled Building Catalog.
app.get('/api/building-types', (_req, res) => res.json(buildingTypeDefs));

app.post('/api/building-types', (req, res) => {
  let validated;
  try {
    validated = parseBuildingTypeDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid building type data: ${err.message}` });
  }
  try {
    if (existsSync(BUILDING_TYPES_PATH)) copyFileSync(BUILDING_TYPES_PATH, BUILDING_TYPES_PATH + '.bak');
    writeFileSync(BUILDING_TYPES_PATH, JSON.stringify(validated, null, 2));
    buildingTypeDefs = validated;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write building-types.json: ${err.message}` });
  }
});

// Monster Builder catalog (World Editor roadmap section E) — same
// load/validate/save/backup pattern as objects/items/quests.
app.get('/api/monster-types', (_req, res) => {
  monsterTypeDefs = buildMonsterCatalog(); // rescan monster-types/plugins/ — no restart needed to see a new drop-in
  res.json(monsterTypeDefs);
});

app.post('/api/monster-types', (req, res) => {
  let validated;
  try {
    validated = parseMonsterTypeDefs(req.body);
  } catch (err) {
    return res.status(400).json({ error: `Invalid monster type data: ${err.message}` });
  }
  try {
    if (existsSync(MONSTER_TYPES_PATH)) copyFileSync(MONSTER_TYPES_PATH, MONSTER_TYPES_PATH + '.bak');
    writeFileSync(MONSTER_TYPES_PATH, JSON.stringify(validated, null, 2));
    monsterTypeDefs = validated;
    // Re-init every live monster (overworld + every tower floor) so a
    // changed ability moveset / configuredLevel takes effect immediately —
    // same reset-on-save convention as /api/world and /api/tower/floor/:n.
    overworldMonsters = initMonsterState(world.monsters);
    for (const [n, floor] of towerFloors) {
      towerFloors.set(n, { def: floor.def, monsters: initMonsterState(floor.def.monsterSpawns) });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to write monster-types.json: ${err.message}` });
  }
});

const iconUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ICONS_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? ext : '.png';
      cb(null, `icon-${Date.now()}-${Math.floor(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB — these are small UI icons, not asset uploads
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/api/items/icon', iconUpload.single('icon'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No icon file uploaded (expected an image, field name "icon")' });
  res.json({ url: `/assets/icons/${req.file.filename}` });
});

// Skill icon upload — same generic one-off "upload an image, get a URL back"
// idiom as /api/items/icon (reusing the same icon storage/multer instance),
// just under the Skill Builder's own route name.
app.post('/api/skills/icon', iconUpload.single('icon'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No icon file uploaded (expected an image, field name "icon")' });
  res.json({ url: `/assets/icons/${req.file.filename}` });
});

// Skill cast-sound upload — a one-off per-skill sound effect, not a browsable
// catalog entry like /api/audio/upload's zone music/ambient tracks, so this
// just saves the file (into the same AUDIO_DIR) and hands back its URL.
const skillSoundUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.mp3', '.ogg', '.wav'].includes(ext) ? ext : '.mp3';
      cb(null, `sfx-${Date.now()}-${Math.floor(Math.random() * 1e9)}${safeExt}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB — a short one-shot cast sound, not a music loop
  fileFilter: (_req, file, cb) => cb(null, /^audio\//.test(file.mimetype)),
});

app.post('/api/skills/sound', skillSoundUpload.single('sound'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No sound file uploaded (expected audio, field name "sound")' });
  res.json({ url: `/assets/audio/${req.file.filename}` });
});

// Every upload route above hands off to multer, which calls next(err) on
// failure (wrong extension, over the size limit, etc.) instead of responding
// itself. Without an error-handling middleware here, Express's default
// fallback is an HTML stack-trace page — every upload client on this site
// does `await res.json()`, so that page surfaces as a baffling
// "Unexpected token '<'... is not valid JSON" instead of the real error
// (this is exactly what happened when a real FBX blew past the old model
// upload's 50MB limit). Catches multer's own errors with a clear message,
// anything else as a generic 500 — always as JSON. Must be registered AFTER
// the routes it covers and declared with all 4 params, or Express won't
// recognize it as error-handling middleware at all.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large for this upload type.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  console.error('Unhandled request error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// --- Authoritative player state ---
/** @type {Map<string, { position: {x:number,y:number,z:number}, input: {moveX:number,moveZ:number}, character: object|null, currentFloor: number, health: number, maxHealth: number, isDead: boolean, respawnAt: number|null }>} */
const players = new Map();

/**
 * A skill whose castMs hasn't elapsed yet — keyed by caster socket id, at
 * most one per player (a new use-ability while one is pending is rejected,
 * see the handler). Resolved (or cancelled) in the main 20Hz tick loop, not
 * a separate timer, so it can't race the same player's movement/CC state.
 *
 * startPosition/startFacingAngle are captured at cast START, not read fresh
 * at resolution — a canMoveDuringCast skill lets the caster keep moving
 * while it's pending, and resolving against their CURRENT (post-move)
 * position/facing made a kiting caster's own cast whiff even when the
 * target was correctly in range/cone at the moment they committed to it.
 * @type {Map<string, { ability: object, skill: object, targetId: string|null, resolveAt: number, impactDelayMs: number, startPosition: {x:number,y:number,z:number}, startFacingAngle: number }>}
 */
const pendingCasts = new Map();

/**
 * A resolved (cast-bar-complete) ability whose EFFECT hasn't landed yet
 * because its animation's travel/impact timing (computeImpactDelayMs) runs
 * longer than castMs — e.g. a fireball's ~850ms flight vs. its 250ms cast
 * bar. Kept separate from pendingCasts: once the cast bar finishes the
 * caster is free to move/act again, this queue only delays when the hit
 * itself applies, so a monster doesn't die before the projectile visually
 * arrives (see computeImpactDelayMs's doc comment).
 * @type {Array<{ resolveAt: number, attackerId: string, ability: object, targetId: string|null, casterPosition: {x:number,y:number,z:number}, casterFacingAngle: number }>}
 */
let pendingImpacts = [];

/** The live monster list for wherever a player currently is — the overworld's shared list, a tower floor's own instanced list, or (checked first, since dungeon players also have currentFloor===0 left untouched) their own dungeon instance's list. Monsters aren't tower-exclusive. */
function monstersFor(player) {
  if (player.dungeonInstanceId) return dungeonInstances.get(player.dungeonInstanceId)?.monsters;
  return player.currentFloor === 0 ? overworldMonsters : towerFloors.get(player.currentFloor)?.monsters;
}

/** Live overworld NPC by id (for quest giver/talk proximity checks), or undefined. */
function npcById(id) {
  return overworldNpcs.find((n) => n.id === id);
}

/** True if an overworld player is close enough to the given NPC to interact (quest accept/turn-in/talk). */
function playerNearNpc(player, npcId) {
  if (player.currentFloor !== 0 || player.inStore) return false;
  const npc = npcById(npcId);
  return !!npc && isWithinRange(player.position, npc.position, NPC_TALK_RANGE);
}

// --- Event Objects (src/sim/events.js) — v1, overworld-only ---
const EVENT_INTERACT_RANGE = DEFAULT_EVENT_INTERACT_RANGE; // same idiom/scale as NPC_TALK_RANGE — only the fallback now; an event may author its own `range` box (see isPointInEventRange)
const EVENT_LOCK_SAFETY_MS = 10 * 60 * 1000; // setPlayerControl's freeze cap — a script that forgets to unlock releases the player after 10 minutes instead of trapping them forever

function eventById(id) {
  return overworldEvents.find((e) => e.id === id);
}

/** True if an overworld player is close enough to trigger a talk/interact event object. `mapId` rules out someone standing on a NON-default map (a building interior, a tower floor) who happens to share coordinates with an overworld event — every event object here belongs to the default overworld's own document. */
function playerNearEvent(player, eventDef) {
  if (player.currentFloor !== 0 || player.inStore || player.mapId) return false;
  return isPointInEventRange(eventDef, player.position);
}

/**
 * Applies one command's effect descriptor (as pushed onto ctx.effects by
 * stepEventScript) against the real player object. Mirrors
 * grantQuestRewards's "sim computes, server applies" split. `socket` may be
 * used for command types that need to push something to the client
 * immediately (showDialog, shakeScreen, fadeScreen, playSound) — those also
 * get relayed generically via the 'event-step' emit in runEventTick, so this
 * function only needs to mutate authoritative state, not emit anything itself.
 */
function applyEventEffect(socket, player, effect, eventId) {
  switch (effect.type) {
    case 'giveItem':
      player.inventory[effect.itemId] = (player.inventory[effect.itemId] || 0) + effect.qty;
      break;
    case 'takeItem':
      player.inventory[effect.itemId] = Math.max(0, (player.inventory[effect.itemId] || 0) - effect.qty);
      break;
    case 'setSwitch':
      player.eventState.switches[switchKey(effect.switchId, effect.self, { eventId })] = effect.value;
      break;
    case 'hp':
      player.health = Math.max(0, Math.min(player.maxHealth, player.health + effect.delta));
      break;
    case 'mp':
      if (player.abilityState) {
        const max = CLASSES[player.character?.classId]?.maxResource ?? player.abilityState.resource;
        player.abilityState.resource = Math.max(0, Math.min(max, player.abilityState.resource + effect.delta));
      }
      break;
    case 'exp': {
      if (effect.delta <= 0) break; // negative/zero EXP isn't a v1 use case — grantXp only grows
      const { state, levelsGained } = grantXp({ level: player.level, xp: player.xp }, effect.delta);
      player.level = state.level;
      player.xp = state.xp;
      if (levelsGained > 0 && player.character?.classId) {
        applyLevelUp(player, levelsGained);
        socket?.emit('level-up', { level: player.level, levelsGained, maxHealth: player.maxHealth, unassignedStatPoints: player.unassignedStatPoints });
      }
      socket?.emit('xp-gained', { amount: effect.delta, level: player.level, xp: player.xp, xpToNext: xpForLevel(player.level) });
      break;
    }
    case 'gold':
      player.gold = Math.max(0, player.gold + effect.delta);
      break;
    case 'teleportPlayer':
      player.position = { x: effect.x, y: effect.y, z: effect.z };
      break;
    case 'setVisible': {
      // World-shared, not per-player (mirrors a gathering node's cooldown
      // being global) — broadcast so every OTHER connected client's view
      // updates too, not just the player whose script triggered it.
      const state = eventObjectState.get(effect.targetId);
      if (state) {
        state.visible = effect.visible;
        io.emit('event-object-visibility', { eventId: effect.targetId, visible: effect.visible });
      }
      break;
    }
    case 'moveTo': {
      const npc = npcById(effect.targetId);
      if (npc) {
        npc.position.x = effect.x;
        npc.position.z = effect.z;
        npc.wanderTarget = null;
        io.emit('event-npc-moved', { npcId: effect.targetId, x: effect.x, z: effect.z });
      }
      break;
    }
    case 'learnSkill':
      // No standalone "learned extra skill" state exists yet — class kits
      // are the only source of abilities today (see CLAUDE.md's class/skill
      // system notes). v1 just acknowledges the grant to the client; wiring
      // it into the hotbar/skill book is future work once that data model exists.
      socket?.emit('event-skill-learned', { skillId: effect.skillId });
      break;
    case 'setPlayerControl':
      // Reuses the existing stun CC (isCCd already gates both the movement
      // tick and use-ability) rather than inventing a separate player-level
      // "frozen" flag — a long but finite duration is a safety cap in case a
      // buggy script never sends the matching unlock, so a soft-lock clears
      // on its own eventually instead of trapping the player forever.
      if (effect.locked) {
        player.statusEffects = applyStatusEffect(player.statusEffects, { type: 'stun', durationMs: EVENT_LOCK_SAFETY_MS }, Date.now());
      } else {
        player.statusEffects = (player.statusEffects || []).filter((e) => e.type !== 'stun');
      }
      break;
    // Quest Log entries are display-only bookkeeping (see events.js's
    // startQuest/updateQuestObjective/completeQuest doc comment) — a
    // separate namespace from src/sim/quests.js, no reward/state side
    // effects of their own. The client also applies these itself from the
    // same 'event-step' effects array (see main.js's onEventStep), so this
    // just keeps the authoritative copy in sync for the next 'welcome' on
    // reconnect.
    case 'startQuest':
      player.eventQuestLog[effect.questId] = { name: effect.name, description: effect.description || '', objectiveText: effect.description || '', status: 'active' };
      break;
    case 'updateQuestObjective':
      if (player.eventQuestLog[effect.questId]) player.eventQuestLog[effect.questId].objectiveText = effect.text;
      break;
    case 'completeQuest':
      if (player.eventQuestLog[effect.questId]) {
        const entry = player.eventQuestLog[effect.questId];
        entry.status = 'complete';
        if (effect.text) entry.objectiveText = effect.text; // authored closing line
      }
      break;
    // acceptQuest/turnInQuest drive a REAL src/sim/quests.js QuestDef (unlike
    // startQuest/completeQuest above) — see events.js's v1.4 doc comment.
    // Emits the same 'quest-accepted'/'quest-turn-in-result' events the
    // accept-quest/turn-in-quest socket handlers already emit, so the
    // client's existing toast handlers fire unchanged regardless of which
    // path triggered the accept/turn-in.
    case 'acceptQuest': {
      const quest = quests.find((q) => q.id === effect.questId);
      if (quest && acceptQuest(player.questState, quest, player.level, player.eventState.switches)) {
        applyQuestSwitches(socket, player, quest, 'accept');
        if (socket) sendQuestState(socket, player);
        socket?.emit('quest-accepted', { questId: effect.questId });
      }
      break;
    }
    case 'turnInQuest': {
      const quest = quests.find((q) => q.id === effect.questId);
      if (quest) {
        const result = turnInQuest(player.questState, quest, player.inventory);
        if (result.ok) {
          applyQuestSwitches(socket, player, quest, 'complete');
          grantQuestRewards(socket?.id, player, result.rewards);
          if (socket) sendQuestState(socket, player);
          socket?.emit('quest-turn-in-result', { ok: true, questId: effect.questId, rewards: result.rewards, inventory: player.inventory, gold: player.gold });
        }
      }
      break;
    }
    // Snapshots the merchant's authored item list + sellMultiplier + where
    // the player was standing when it opened — the buy/sell socket handlers
    // below validate against THIS, never anything the client claims, same
    // "server never trusts the client for state that affects gold/inventory"
    // rule every other economy path here follows.
    case 'openMerchantStore':
      player.activeMerchant = {
        eventId,
        items: effect.items.map((it) => ({ ...it })),
        sellMultiplier: effect.sellMultiplier ?? 0.5,
        openedAt: { ...player.position },
      };
      break;
    // Mirrors openMerchantStore exactly: snapshot authoritative state (which
    // station, where the player was standing) for the craft socket handler to
    // validate against — never trust anything the client claims about which
    // station it thinks it's near.
    case 'openCraftingStation':
      player.activeCraftingStation = {
        eventId,
        stationTypeId: effect.stationTypeId,
        openedAt: { ...player.position },
      };
      break;
    // Same snapshot idiom as openMerchantStore/openCraftingStation: the
    // authored floor list + where the player was standing become the ONLY
    // thing tower-enter-floor validates against. The panel payload is
    // emitted directly here (rather than left to the generic 'event-step'
    // relay) because the client also needs this player's unlock progress,
    // which is server-side state the effect descriptor itself doesn't carry.
    case 'openTowerDungeon': {
      player.activeTower = {
        eventId,
        title: effect.title || 'Tower',
        floors: effect.floors.map((f) => ({ ...f })),
        openedAt: { ...player.position },
      };
      socket?.emit('tower-panel', {
        eventId,
        title: player.activeTower.title,
        floors: player.activeTower.floors.map((f) => ({ name: f.name, requiredKills: f.requiredKills || 0, requiredMonsterId: f.requiredMonsterId || null })),
        clearedFloors: clearedFloorCount(player.towerProgress, eventId),
      });
      break;
    }
    // World-shared, not per-player — see events.js's scheduleRespawn doc
    // comment for why this can't just be a `wait` inside the triggering
    // player's own script (that cursor dies on disconnect). The dedicated
    // respawn-sweep tick pass below consumes this independently of any
    // player's activeEventRuns entry.
    case 'scheduleRespawn': {
      let state = eventObjectState.get(eventId);
      if (!state) { state = initEventObjectWorldState(); eventObjectState.set(eventId, state); }
      state.respawnAt = Date.now() + effect.ms;
      break;
    }
    // showDialog/playSound/shakeScreen/fadeScreen carry no server-side
    // state mutation — they're relayed to the client as-is (see the
    // 'event-step' emit below) and applied purely client-side.
    default:
      break;
  }
}

/** Emits every non-dialog effect from a step result to the client as one batch, plus the dialog/choice payload if the script parked on one. Called after every stepEventScript call (start, resume, or wait-tick). */
function emitEventStep(socket, eventId, stepResult, effects) {
  const clientEffects = effects.filter((e) => e.type !== 'showDialog');
  socket?.emit('event-step', {
    eventId,
    effects: clientEffects,
    dialog: stepResult.status === 'awaitingChoice' ? stepResult.dialogPayload : (effects.find((e) => e.type === 'showDialog') || null),
    done: stepResult.status === 'done',
  });
}

/**
 * A quest's current phase for this player, as far as an event script's
 * `questPhase` condition is concerned — 'locked' means "no eligible sheet",
 * matching the sheet system's own silent-no-op convention for an
 * unconditioned dead end. Reuses quests.js's own pure functions rather than
 * re-deriving any of this state itself (see events.js's v1.4 doc comment).
 */
function questPhaseFor(player, quest) {
  if (!quest) return 'locked';
  if (isCompleted(player.questState, quest.id)) return 'done';
  if (isActive(player.questState, quest.id)) {
    return isReadyToTurnIn(player.questState, quest, player.inventory) ? 'ready' : 'active';
  }
  return canAccept(player.questState, quest, player.level, player.eventState.switches) ? 'offer' : 'locked';
}

/** Builds the read-only ctx stepEventScript/selectEligibleSheet need — `completedSheetIds` only matters for sheet SELECTION (startEventScript), not for stepping an already-running cursor, but it's harmless to include either way. */
function buildEventCtx(player, eventDef) {
  return {
    switches: player.eventState.switches,
    inventory: player.inventory,
    questCompleted: (id) => isCompleted(player.questState, id),
    questPhase: (id) => questPhaseFor(player, quests.find((q) => q.id === id)),
    rollNodeYield: (nodeType) => rollYield(nodeType, rng),
    completedSheetIds: eventObjectState.get(eventDef.id)?.completedSheetIds || {},
    eventId: eventDef.id,
    effects: [],
  };
}

/** Runs one script step for `player`/`socket`, applies every resulting effect, and relays the step to the client. Shared by start-event, event-choice, and the tick-loop wait sweep. */
function runEventStep(socket, player, cursor, eventDef, now) {
  const ctx = buildEventCtx(player, eventDef);
  const result = stepEventScript(cursor, eventDef, ctx, now);
  for (const effect of ctx.effects) applyEventEffect(socket, player, effect, eventDef.id);
  emitEventStep(socket, eventDef.id, result, ctx.effects);
  if (result.status === 'done') {
    activeEventRuns.delete(socket.id);
    const sheet = eventDef.sheets[cursor.sheetIndex];
    if (sheet.runOnce !== false) {
      const state = eventObjectState.get(eventDef.id);
      if (state) state.completedSheetIds[cursor.sheetId] = true;
    }
  }
  return result;
}

// --- Party system ---
// Bot-ready: every operation here is a plain function (not a socket closure)
// so future simulated-player bots call the same API. Client emits are guarded
// with `?.` because a bot has no socket. A party is { id, leaderId, memberIds }.
/** @type {Map<string, {id:string, leaderId:string, memberIds:string[]}>} */
const parties = new Map();
/** @type {Map<string, {partyId:string, inviterId:string, expiresAt:number}>} inviteeId -> pending invite */
const pendingInvites = new Map();
let nextPartyId = 1;

/** A human label for a player (players have no names yet — use their name if set (bots), else class + short id). */
function playerLabel(player) {
  if (player.name) return player.name;
  const cls = player.character?.classId;
  return cls ? `${cls[0].toUpperCase()}${cls.slice(1)}` : 'Adventurer';
}

/** Roster (id + display label + class) each member's client needs; live position/health arrive via the normal state broadcast. */
function partyRoster(party) {
  return party.memberIds.map((id) => {
    const p = players.get(id);
    return { id, name: p?.name || null, classId: p?.character?.classId || null, isLeader: id === party.leaderId };
  });
}

/** Push current party state to every (real) member. Called after any membership change. */
function broadcastPartyState(party) {
  const roster = partyRoster(party);
  for (const id of party.memberIds) {
    io.sockets.sockets.get(id)?.emit('party-state', { partyId: party.id, leaderId: party.leaderId, members: roster });
  }
}

/** Invite `inviteeId` to `inviterId`'s party (creating one if the inviter is solo). Returns an error reason string, or null on success. */
function sendPartyInvite(inviterId, inviteeId) {
  const inviter = players.get(inviterId);
  const invitee = players.get(inviteeId);
  if (!inviter || !invitee || inviterId === inviteeId) return 'invalid';
  if (invitee.partyId) return 'already-in-party';

  let party = inviter.partyId ? parties.get(inviter.partyId) : null;
  if (party && !canAddMember(party)) return 'party-full';
  if (party && inviter.partyId && party.leaderId !== inviterId) return 'not-leader'; // only the leader invites

  // Materialize the inviter's party lazily on first invite.
  if (!party) {
    party = createParty(`party-${nextPartyId++}`, inviterId);
    parties.set(party.id, party);
    inviter.partyId = party.id;
  }
  pendingInvites.set(inviteeId, { partyId: party.id, inviterId, expiresAt: Date.now() + PARTY_INVITE_TTL_MS });
  io.sockets.sockets.get(inviteeId)?.emit('party-invite', {
    partyId: party.id,
    inviterId,
    inviterLabel: playerLabel(inviter),
  });
  return null;
}

/** Accept a pending invite. Returns an error reason string, or null on success. */
function acceptPartyInvite(inviteeId) {
  const invite = pendingInvites.get(inviteeId);
  const invitee = players.get(inviteeId);
  if (!invite || !invitee) return 'no-invite';
  pendingInvites.delete(inviteeId);
  if (Date.now() > invite.expiresAt) return 'expired';
  if (invitee.partyId) return 'already-in-party';
  const party = parties.get(invite.partyId);
  if (!party) return 'party-gone';
  if (!addMember(party, inviteeId)) return 'party-full';
  invitee.partyId = party.id;
  broadcastPartyState(party);
  return null;
}

/** Remove a player from their party (leave/disconnect). Promotes a new leader or disbands as needed. */
function removeFromParty(playerId) {
  const player = players.get(playerId);
  const partyId = player?.partyId;
  if (!partyId) return;
  const party = parties.get(partyId);
  if (player) player.partyId = null;
  if (!party) return;

  const { disbanded } = removeMember(party, playerId);
  io.sockets.sockets.get(playerId)?.emit('party-state', { partyId: null, leaderId: null, members: [] });
  if (disbanded) {
    for (const id of party.memberIds) {
      const m = players.get(id);
      if (m) m.partyId = null;
      io.sockets.sockets.get(id)?.emit('party-state', { partyId: null, leaderId: null, members: [] });
    }
    parties.delete(party.id);
  } else {
    broadcastPartyState(party);
  }
}

/** Members eligible to share a kill's rewards: the killer, plus same-location party members within range of the kill. */
function killCreditRecipients(killerId, killerPlayer, monster) {
  const recipients = [{ id: killerId, player: killerPlayer }];
  if (!killerPlayer.partyId) return recipients;
  const party = parties.get(killerPlayer.partyId);
  if (!party) return recipients;
  for (const id of party.memberIds) {
    if (id === killerId) continue;
    const p = players.get(id);
    if (!p || p.isDead) continue;
    // "Same location" now means the same dungeon INSTANCE (not just the
    // same map — several parties can share one dungeon map, each in their
    // own instance) when the killer is in one; plain currentFloor equality
    // otherwise, same as before dungeons existed.
    if (killerPlayer.dungeonInstanceId ? p.dungeonInstanceId !== killerPlayer.dungeonInstanceId : p.currentFloor !== killerPlayer.currentFloor) continue;
    if (isWithinRange(p.position, monster.position, SHARED_CREDIT_RANGE)) recipients.push({ id, player: p });
  }
  return recipients;
}

/**
 * Party members (including the caster) within `range` of the CASTER — same
 * same-location rule as killCreditRecipients (same dungeon instance if the
 * caster is in one, else same currentFloor/mapId), just centered on the
 * caster's position instead of a monster's, and generalized for any ally-
 * targeting skill (heal/buff), not just kill-credit. A skill's ally
 * targeting picks the caster's chosen target (if it's a valid party member
 * in this list) or falls back to self (see resolveAbilityEffect).
 * @returns {{id:string, player:object}[]} caster included
 */
function partyMembersNear(casterId, casterPlayer, range) {
  const nearby = [{ id: casterId, player: casterPlayer }];
  if (!casterPlayer.partyId) return nearby;
  const party = parties.get(casterPlayer.partyId);
  if (!party) return nearby;
  for (const id of party.memberIds) {
    if (id === casterId) continue;
    const p = players.get(id);
    if (!p || p.isDead) continue;
    const sameLocation = casterPlayer.dungeonInstanceId
      ? p.dungeonInstanceId === casterPlayer.dungeonInstanceId
      : casterPlayer.mapId
        ? p.mapId === casterPlayer.mapId
        : p.currentFloor === casterPlayer.currentFloor;
    if (!sameLocation) continue;
    if (isWithinRange(p.position, casterPlayer.position, range)) nearby.push({ id, player: p });
  }
  return nearby;
}

/**
 * Applies one SkillEffect (src/sim/skillDefs.js) to a single target — a
 * player OR a monster object, both shaped closely enough (health/maxHealth/
 * statusEffects/position/aggroTargetId) that one function resolves both
 * directions (a player's Frost Nova landing on a monster, or — once monster
 * abilities gain an optional effects[], not this pass — a boss's stun
 * landing on a player). `now`/`casterId`/`casterLevel`/`casterPosition`
 * describe whoever cast the skill; `isMonsterTarget` gates knockback/pull,
 * which only moves monsters (see the note below). `casterStats` (a player's
 * getPlayerDerivedStats() result, or null for a monster/NPC caster with no
 * GSE stats) layers the Global Stat Engine on top of the pre-existing
 * level-only `scale`: physPower/spellPower add flat bonus damage (physical
 * damageType uses physPower, everything else uses spellPower), healPower
 * adds bonus healing, and DEX's critChance can multiply a damage hit. None
 * of this fires when casterStats is absent, so a monster's own attacks
 * (which go through applyDamageToPlayer, not this function) are unaffected.
 */
function applySkillEffect(target, effect, now, casterId, casterLevel, casterPosition, isMonsterTarget, casterStats = null) {
  const scale = powerMultiplierForLevel(casterLevel);
  switch (effect.type) {
    case 'damage': {
      const isPhysical = !effect.damageType || effect.damageType === 'physical';
      const statBonus = casterStats ? (isPhysical ? casterStats.physPower : casterStats.spellPower) * DAMAGE_STAT_COEFF : 0;
      const isCrit = !!casterStats && Math.random() < casterStats.critChance;
      const rawDamage = (effect.amount * scale + statBonus) * (isCrit ? CRIT_DAMAGE_MULTIPLIER : 1);
      // Flat reduction from an active 'armor' buff (e.g. Shield Wall) before
      // shields get a chance to absorb the rest.
      const armor = getBuffAmount(target.statusEffects, 'armor', now);
      const afterArmor = Math.max(0, rawDamage - armor);
      const { statusEffects, remainingDamage } = absorbDamage(target.statusEffects, afterArmor, now);
      target.statusEffects = statusEffects;
      target.health = Math.max(0, target.health - remainingDamage);
      // Any attack — not just a dedicated Taunt skill — should make a
      // monster fight back, per src/sim/monster.js's stepMonsterAI doc
      // comment. Without this, hitting a monster from outside its
      // aggroRange (any ranged attack) never registered as a threat, so it
      // only ever "aggroed" once a player wandered into melee-ish range.
      target.aggroTargetId = casterId;
      break;
    }
    case 'heal': {
      const statBonus = casterStats ? casterStats.healPower * DAMAGE_STAT_COEFF : 0;
      target.health = Math.min(target.maxHealth, target.health + effect.amount * scale + statBonus);
      break;
    }
    case 'taunt':
      target.aggroTargetId = casterId; // see src/sim/statusEffects.js's header note — not stored as a timed status
      break;
    case 'knockback':
    case 'pull':
      // Monsters only: players are client-predicted, forcing their position
      // outside stepMovement risks desync/rubber-banding — a bigger feature
      // than this pass covers.
      if (isMonsterTarget) {
        const dx = target.position.x - casterPosition.x;
        const dz = target.position.z - casterPosition.z;
        const len = Math.hypot(dx, dz) || 1;
        const sign = effect.type === 'knockback' ? 1 : -1;
        target.position = {
          x: target.position.x + (dx / len) * effect.distance * sign,
          y: target.position.y,
          z: target.position.z + (dz / len) * effect.distance * sign,
        };
      }
      break;
    default: // stun/freeze/sleep/slow/dot/hot/buff/shield — all lingering status, see statusEffects.js
      target.statusEffects = applyStatusEffect(target.statusEffects, effect, now);
  }
}

/** Expires timed-out status effects and applies any DoT/HoT tick due this instant — shared by every monster loop below, and by resolveAbilityEffect's target for damage/heal (which goes through applySkillEffect/absorbDamage instead, not this). */
function tickMonsterStatusEffects(monster, now) {
  const { statusEffects, events } = tickStatusEffects(monster.statusEffects, now);
  monster.statusEffects = statusEffects;
  for (const ev of events) {
    if (ev.type === 'dot') monster.health = Math.max(0, monster.health - ev.amount);
    else if (ev.type === 'hot') monster.health = Math.min(monster.maxHealth, monster.health + ev.amount);
  }
}

/**
 * Resolve what a skill actually does once its use is confirmed: self/ally
 * effects land on the caster or a chosen/nearby party member
 * (partyMembersNear), enemy effects land on whichever monster(s)
 * src/sim/skillResolution.js's targeting/shape picks out. Works anywhere —
 * combat is no longer tower-only.
 *
 * casterPosition/casterFacingAngle default to the player's CURRENT state
 * (instant-cast skills with no extra impact delay) but callers going through
 * pendingCasts/pendingImpacts pass the values captured at cast start — see
 * those queues' doc comments for why resolving against current position
 * would let a moving caster's own cast whiff.
 */
function resolveAbilityEffect(attackerId, player, ability, targetId = null, casterPosition = null, casterFacingAngle = null) {
  const skill = skillDefsById.get(ability.id);
  if (!skill) return; // shouldn't happen — every CLASSES ability comes from this same catalog

  const now = Date.now();
  const position = casterPosition || player.position;
  const facingAngle = casterFacingAngle != null ? casterFacingAngle : (player.facingAngle || 0);

  if (skill.targeting.modes.includes('self') || skill.targeting.modes.includes('ally')) {
    const isAoe = skill.targeting.shape === 'aoe-circle';
    let allyTargets;
    if (skill.targeting.modes.includes('ally') && isAoe) {
      // Mass Heal etc: every party member (including self) within the AoE
      // radius, centered on the caster — targetId is irrelevant, it already
      // hits everyone nearby.
      const radius = skill.targeting.radius ?? skill.targeting.range;
      allyTargets = partyMembersNear(attackerId, player, radius).map((r) => r.player);
    } else if (skill.targeting.modes.includes('ally') && targetId && targetId !== attackerId) {
      // A single-target ally skill (Heal, Shield of Faith, ...) with an
      // explicit party-member target selected — only valid if that id is
      // actually a nearby party member; otherwise falls back to self.
      const nearby = partyMembersNear(attackerId, player, skill.targeting.range);
      const chosen = nearby.find((r) => r.id === targetId);
      allyTargets = [chosen ? chosen.player : player];
    } else {
      allyTargets = [player]; // self-only skill, or an ally skill with no explicit target selected
    }
    const effects = effectiveEffectsForLevel(skill, player.level);
    const casterStats = getPlayerDerivedStats(player);
    for (const target of allyTargets) {
      for (const effect of effects) {
        applySkillEffect(target, effect, now, attackerId, player.level, player.position, false, casterStats);
      }
    }
  }

  if (!skill.targeting.modes.includes('enemy')) return;

  const monsters = monstersFor(player);
  if (!monsters) return;

  const candidates = monsters.filter((m) => m.health > 0 && !m.friendly);
  const hits = resolveEnemyTargets(skill, position, facingAngle, candidates, targetId);
  const enemyEffects = effectiveEffectsForLevel(skill, player.level);
  const casterStats = getPlayerDerivedStats(player);

  for (const target of hits) {
    const wasBoss = target.isBoss;
    const wasAlive = target.health > 0;
    for (const effect of enemyEffects) {
      applySkillEffect(target, effect, now, attackerId, player.level, player.position, true, casterStats);
    }
    if (target.health === 0 && wasBoss) {
      if (player.dungeonInstanceId) io.to(`dungeon-${player.mapId}-${player.dungeonInstanceId}`).emit('boss-defeated', { monsterId: target.id });
      else if (player.currentFloor === 0) io.emit('boss-defeated', { monsterId: target.id });
      else io.to(`floor-${player.currentFloor}`).emit('boss-defeated', { monsterId: target.id });
    }
    if (wasAlive && target.health === 0) {
      awardKill(attackerId, player, target);
    }
  }
}

/**
 * A player's current Global Stat Engine numbers (src/sim/statDefs.js via
 * leveling.js's computeCharacterDerivedStats) — class base stats + whatever
 * they've allocated + any temporary stat buffs currently active (elixirs,
 * "Battle Cry"-style skill buffs), for their class/level. Returns a
 * harmless all-zero-bonus shape for a player with no class picked yet
 * rather than throwing, since several callers (damage/heal resolution) run
 * before set-character necessarily has.
 */
function getPlayerDerivedStats(player) {
  const classId = player.character?.classId;
  if (!classId) {
    return { raw: zeroStats(), maxHealthBonus: 0, maxManaBonus: 0, spellPower: 0, physPower: 0, healPower: 0, critChance: 0, dodgeChance: 0, hpRegen: 0, mpRegen: 0, physDefense: 0, magicResist: 0, maxHealth: player.maxHealth, maxResourceBonus: 0 };
  }
  const now = Date.now();
  const buffStats = {};
  for (const stat of PRIMARY_STAT_IDS) buffStats[stat] = getBuffAmount(player.statusEffects, stat, now);
  const gearStats = computeGearStatBonus(player.equipment || initEquipmentState(), authoredItemById);
  return computeCharacterDerivedStats(classId, player.level, player.allocatedStats, buffStats, gearStats);
}

/** Passive HP_Regen (VIT-driven, spec Section 1.2) — this project had no passive out-of-combat health regen before the stat system; ticked alongside ability-resource regen in every player-movement loop below. */
function tickPlayerHpRegen(player, dt) {
  if (player.isDead || !player.character?.classId) return;
  const derived = getPlayerDerivedStats(player);
  if (derived.hpRegen <= 0) return;
  player.health = Math.min(player.maxHealth, player.health + derived.hpRegen * dt);
}

/** Recompute + push a player's maxHealth from their current class/level/allocated stats — call after anything that could change any of those three (level-up, stat allocation, respec, class (re)pick). Heals to the new max, same as every existing level-up path already did before stats existed. */
function refreshPlayerMaxHealth(player) {
  if (!player.character?.classId) return;
  const derived = getPlayerDerivedStats(player);
  player.maxHealth = derived.maxHealth;
  player.health = Math.min(player.health, player.maxHealth);
}

/** One level-up's worth of side effects: XP curve already advanced by the caller — this grants the stat point(s), recomputes maxHealth (now VIT-aware), and fully heals, same behavior every level-up path had before the stat system existed. */
function applyLevelUp(player, levelsGained) {
  if (levelsGained <= 0 || !player.character?.classId) return;
  player.unassignedStatPoints = (player.unassignedStatPoints || 0) + levelsGained;
  const derived = getPlayerDerivedStats(player);
  player.maxHealth = derived.maxHealth;
  player.health = player.maxHealth;
}

/** Credit a kill to the last-hitter plus any eligible party members (same location, in range) — each gets full XP + kill-quest progress. Solo players just credit themselves. */
function awardKill(killerId, killerPlayer, monster) {
  for (const { id, player } of killCreditRecipients(killerId, killerPlayer, monster)) {
    creditKill(id, player, monster);
  }
}

/** Grant one player XP + kill-quest progress for a kill, apply any level-ups (full heal + higher maxHealth), and notify their client. */
function creditKill(socketId, player, monster) {
  const amount = xpRewardForMonster(monster);
  const { state, levelsGained } = grantXp({ level: player.level, xp: player.xp }, amount);
  player.level = state.level;
  player.xp = state.xp;

  if (levelsGained > 0 && player.character?.classId) {
    applyLevelUp(player, levelsGained);
  }

  // Kill-quest progress: monsters carry an optional `group` tag; applyKill
  // advances any active kill-quest targeting that group (so area A's slimes
  // count while area B's don't).
  const changed = applyKill(player.questState, quests, monster.group);

  // Loot comes from TWO tables, both rolled: the catalog type's own
  // (Monster Builder — applies to every spawn of that type, including the
  // hundreds already scattered across a map) and this individual placement's
  // (World Editor Monsters mode — for making one hand-placed pack special).
  // Authoring loot in either place has to actually drop something; requiring
  // per-placement authoring meant a type-wide "100% drop" silently did
  // nothing on every monster already in the world. Each entry still rolls
  // independently against its own dropChance, so a kill can drop several at
  // once, or none.
  // Quest-gated entries (`requiresQuestId`) are filtered inside rollLootTable
  // against this player's own quest state, so the same monster drops a quest
  // item for whoever is on the quest and nothing extra for everyone else.
  // Same questPhaseFor an event script's `questPhase` condition uses, so a
  // "while the quest is active" gate means exactly the same thing in both.
  const drops = rollLootTable([
    ...(monsterTypeDefs.find((mt) => mt.id === monster.type)?.lootTable || []),
    ...(monster.lootTable || []),
  ], rng, { questPhase: (id) => questPhaseFor(player, quests.find((q) => q.id === id)) });
  for (const drop of drops) {
    player.inventory[drop.itemId] = (player.inventory[drop.itemId] || 0) + drop.qty;
  }

  const socket = io.sockets.sockets.get(socketId);

  // Tower Dungeon floor progress — counted per PLAYER, not per instance, so
  // each party member's own run advances off the kills they got credit for
  // (killCreditRecipients already scopes credit to this dungeon instance).
  const run = player.towerRun;
  if (run) {
    run.kills += 1;
    if (!run.killedMonsterIds.includes(monster.id)) run.killedMonsterIds.push(monster.id);
    const floor = run.tower.floors[run.floorIndex];
    socket?.emit('tower-progress', {
      kills: run.kills,
      requiredKills: floor?.requiredKills || 0,
      bossDown: !!floor?.requiredMonsterId && run.killedMonsterIds.includes(floor.requiredMonsterId),
    });
    checkTowerFloorCleared(socket, player);
  }

  if (!socket) return; // bots (no socket) still got their state mutated above
  socket.emit('xp-gained', { amount, level: player.level, xp: player.xp, xpToNext: xpForLevel(player.level) });
  if (levelsGained > 0) {
    socket.emit('level-up', { level: player.level, levelsGained, maxHealth: player.maxHealth, unassignedStatPoints: player.unassignedStatPoints });
  }
  if (drops.length) socket.emit('loot-drop', { drops, inventory: player.inventory });
  if (changed.length) sendQuestState(socket, player);
}

/**
 * Everything that has to happen because this player just talked to `npcId`,
 * regardless of WHICH talk path got them here — the plain dialog one
 * ('talk-npc'), or an Event Object attached to that NPC ('start-event').
 * Returns true if quest state changed and the caller should resend it.
 *
 * Both paths need this. Quest authoring moved into Events mode, and the
 * client's talkToNpc() returns early into startEvent() whenever an NPC has an
 * event attached — so 'talk-npc' is never sent for those NPCs, and a "Talk to
 * X" objective could never complete if X happened to be an event NPC.
 *
 * The auto-turn-in below is what makes a `turnInAtTarget` quest work
 * (src/sim/quests.js): the NPC you were sent to pays out the moment you reach
 * them, with no second button to press and — importantly — without needing
 * their own hand-authored event sheet, which is the whole point of the
 * "that NPC also hands over the reward" checkbox.
 */
function registerNpcTalk(socket, player, npcId) {
  let changed = applyTalk(player.questState, quests, npcId).length > 0;

  for (const quest of quests) {
    if (!quest.turnInAtTarget || turnInNpcId(quest) !== npcId) continue;
    if (!player.questState.active[quest.id]) continue;
    const result = turnInQuest(player.questState, quest, player.inventory);
    if (!result.ok) continue; // objective not met yet — they're here early
    applyQuestSwitches(socket, player, quest, 'complete');
    grantQuestRewards(socket.id, player, result.rewards);
    socket.emit('quest-turn-in-result', { ok: true, questId: quest.id, rewards: result.rewards, inventory: player.inventory, gold: player.gold });
    changed = true;
  }
  return changed;
}

/**
 * Apply a quest's authored accept/complete switch (src/sim/quests.js's
 * switchOnAccept/switchOnComplete) and push the player's switch map to their
 * client if anything changed.
 *
 * The client keeps its own mirror of these switches purely so it can evaluate
 * a quest's `requiredSwitch` gate for NPC head-icons without a round trip (see
 * src/main.js's eventSwitches). That mirror is normally fed by an event
 * script's own setSwitch effects — but a quest switch can fire on paths where
 * no script runs at all (the accept-quest socket, the auto-turn-in in
 * registerNpcTalk), so it gets pushed explicitly. A follow-up quest unlocked
 * by finishing this one is exactly the case that would otherwise show no
 * head-icon until the next reconnect.
 */
function applyQuestSwitches(socket, player, quest, phase) {
  if (!applyQuestSwitch(quest, phase, player.eventState.switches)) return;
  socket?.emit('event-switches', player.eventState.switches);
}

/** Push the player's full quest state to their client (active progress + completed set). Cheap enough to just resend wholesale on any change. */
function sendQuestState(socket, player) {
  socket.emit('quest-state', { active: player.questState.active, completed: player.questState.completed });
}

/** Grant a quest's rewards to a player (xp via the same path as kills, plus gold/items). */
function grantQuestRewards(socketId, player, rewards) {
  if (!rewards) return;
  if (rewards.gold) player.gold += rewards.gold;
  for (const item of rewards.items || []) {
    player.inventory[item.itemId] = (player.inventory[item.itemId] || 0) + item.qty;
  }
  if (rewards.xp) {
    const { state, levelsGained } = grantXp({ level: player.level, xp: player.xp }, rewards.xp);
    player.level = state.level;
    player.xp = state.xp;
    const socket = io.sockets.sockets.get(socketId);
    if (levelsGained > 0 && player.character?.classId) {
      applyLevelUp(player, levelsGained);
      socket?.emit('level-up', { level: player.level, levelsGained, maxHealth: player.maxHealth, unassignedStatPoints: player.unassignedStatPoints });
    }
    socket?.emit('xp-gained', { amount: rewards.xp, level: player.level, xp: player.xp, xpToNext: xpForLevel(player.level) });
  }
}

/** Apply monster damage to a player, triggering death (and the respawn countdown) at 0 HP. */
/** Applies monster damage to a player — `damageType` gates which GSE resistance (VIT's physDefense vs WIS's magicResist) applies; every current monster attack is melee/ranged physical, so it defaults there. */
function applyDamageToPlayer(id, damage, damageType = 'physical') {
  const player = players.get(id);
  if (!player || player.isDead) return;
  const now = Date.now();
  const derived = getPlayerDerivedStats(player);
  // AGI's Dodge_Chance: a clean miss, rolled before any other reduction.
  if (Math.random() < derived.dodgeChance) return;
  const gseReduced = damageType === 'physical'
    ? Math.max(0, damage - derived.physDefense)
    : damage * (1 - derived.magicResist);
  const armor = getBuffAmount(player.statusEffects, 'armor', now);
  const afterArmor = Math.max(0, gseReduced - armor);
  const { statusEffects, remainingDamage } = absorbDamage(player.statusEffects, afterArmor, now);
  player.statusEffects = statusEffects;
  player.health = Math.max(0, player.health - remainingDamage);
  if (player.health === 0) {
    player.isDead = true;
    player.respawnAt = Date.now() + RESPAWN_DELAY_MS;
    io.sockets.sockets.get(id)?.emit('player-died', { respawnMs: RESPAWN_DELAY_MS });
  }
}

/** Once a dead player's respawn timer elapses, return them to the overworld at the tower's base, fully healed. */
function respawnIfReady(id, player) {
  if (!player.isDead || !player.respawnAt || Date.now() < player.respawnAt) return;
  const socket = io.sockets.sockets.get(id);

  if (player.currentFloor !== 0 && socket) {
    leaveFloor(socket, player);
  }
  // Dying on a NON-default map (a building interior, or a Tower Dungeon
  // floor) has to hand the player back through movePlayerToMap — the
  // 'player-respawned' path below only ever restored the legacy overworld
  // view, which left a corpse-run player still bound to the map/instance
  // they died in. A tower run ends here: the floors they already banked
  // stay unlocked, but the run itself doesn't survive death.
  const diedOffOverworld = !!player.mapId || !!player.dungeonInstanceId;
  // Falling back to the map's spawn point means arriving at an AUTHORED
  // point, so its facing applies too; a real returnPosition (the tower
  // entrance they walked in through) has no authored facing, so null there
  // leaves them turned however they were.
  const returnPosition = player.towerRun?.returnPosition || spawnPositionOf(world);
  const returnFacing = player.towerRun?.returnPosition ? null : spawnFacingOf(world);
  player.towerRun = null;
  player.currentFloor = 0;
  player.health = player.maxHealth;
  player.isDead = false;
  player.respawnAt = null;
  if (diedOffOverworld) {
    if (socket) {
      socket.emit('tower-left', {});
      // 'player-respawned' first (it clears the death overlay and drops the
      // client back to its overworld view), THEN the map move — whose
      // 'map-entered' rebuilds the real roster/position. The other order
      // would have player-respawned's empty roster wipe what map-entered
      // had just populated.
      socket.emit('player-respawned', { position: returnPosition, existingPlayers: [] });
      movePlayerToMap(socket, player, defaultOverworldMapId, returnPosition, returnFacing);
    } else {
      player.mapId = null;
      player.dungeonInstanceId = null;
      player.position = { ...returnPosition };
      if (returnFacing != null) player.facingAngle = returnFacing;
    }
    return;
  }
  player.position = { ...TOWER_EXIT_POINT };
  if (TOWER_EXIT_FACING != null) player.facingAngle = TOWER_EXIT_FACING;

  if (!socket) return;
  const existingPlayers = [...players.entries()]
    .filter(([pid, p]) => pid !== id && p.currentFloor === 0 && !p.mapId)
    .map(([pid, p]) => ({ id: pid, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
  socket.emit('player-respawned', { position: player.position, facing: TOWER_EXIT_FACING, existingPlayers });
  socket.broadcast.emit('player-joined', { id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
}

function enterFloor(socket, player, floorNumber) {
  const floor = towerFloors.get(floorNumber);
  if (!floor) return;

  const wasInOverworld = player.currentFloor === 0;
  player.currentFloor = floorNumber;
  player.position = { ...floor.def.spawnPoint };
  socket.join(`floor-${floorNumber}`);

  if (wasInOverworld) {
    socket.broadcast.emit('player-left', { id: socket.id }); // vanish from the overworld view
  }

  const existingFloorPlayers = [...players.entries()]
    .filter(([id, p]) => id !== socket.id && p.currentFloor === floorNumber)
    .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));

  socket.emit('floor-entered', {
    floorNumber,
    floorDef: floor.def,
    position: player.position,
    monsters: floor.monsters,
    existingFloorPlayers,
  });

  socket.to(`floor-${floorNumber}`).emit('floor-player-joined', {
    id: socket.id,
    position: player.position,
    character: player.character,
    equipmentLoadout: weaponLoadoutFor(player),
  });
}

/**
 * Moves a player onto a different map via a teleporter — the generalized
 * counterpart to enterFloor/leaveFloor and the store's enter/exit-store
 * handlers above, for the new map system. The default overworld map is
 * "home base" for this system: teleporting there hands the player BACK to
 * the legacy currentFloor===0 tracking (mapId = null) instead of joining a
 * `map-${id}` room, since the untouched tower/store/tick-loop code already
 * knows how to treat that case — only teleporting to a NON-default map
 * (a building or, for now, a dungeon treated as a plain map — party
 * instancing is a later phase) engages the new per-map room.
 */
function movePlayerToMap(socket, player, targetMapId, targetPosition, targetFacing = null) {
  const targetEntry = maps.get(targetMapId);
  if (!targetEntry) return;
  const targetIsDefault = targetMapId === defaultOverworldMapId;

  // A teleporter linking two points that are BOTH on the default overworld
  // map (a same-map quick-travel pair) never actually changes which room
  // the player is in — skip the leave/rejoin dance entirely, or every other
  // overworld player would see this player vanish and instantly reappear
  // for no reason.
  if (!player.mapId && targetIsDefault) {
    player.position = { ...targetPosition };
    if (targetFacing != null) player.facingAngle = targetFacing;
    socket.emit('map-entered', { mapId: targetMapId, world: targetEntry.world, position: player.position, facing: targetFacing, existingMapPlayers: [], isDefaultOverworld: true });
    return;
  }

  if (player.dungeonInstanceId) {
    const oldRoom = `dungeon-${player.mapId}-${player.dungeonInstanceId}`;
    socket.to(oldRoom).emit('map-player-left', { id: socket.id });
    socket.leave(oldRoom);
    const oldInstanceId = player.dungeonInstanceId;
    player.dungeonInstanceId = null;
    // The "closes when the party exits through the gate" behavior — a
    // no-op if teammates are still inside.
    closeDungeonInstanceIfEmpty(oldInstanceId);
  } else if (player.mapId) {
    socket.to(`map-${player.mapId}`).emit('map-player-left', { id: socket.id });
    socket.leave(`map-${player.mapId}`);
  } else {
    socket.broadcast.emit('player-left', { id: socket.id }); // vanish from the legacy overworld view, same idiom as entering a tower floor
  }

  player.position = { ...targetPosition };
  if (targetFacing != null) player.facingAngle = targetFacing;
  player.mapId = targetIsDefault ? null : targetMapId;

  if (targetIsDefault) {
    const existingPlayers = [...players.entries()]
      .filter(([id, p]) => id !== socket.id && p.currentFloor === 0 && !p.inStore && !p.mapId)
      .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
    socket.emit('map-entered', { mapId: targetMapId, world: targetEntry.world, position: player.position, facing: targetFacing, existingMapPlayers: existingPlayers, isDefaultOverworld: true });
    socket.broadcast.emit('player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
    return;
  }

  socket.join(`map-${targetMapId}`);
  const existingMapPlayers = [...players.entries()]
    .filter(([id, p]) => id !== socket.id && p.mapId === targetMapId)
    .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
  socket.emit('map-entered', { mapId: targetMapId, world: targetEntry.world, position: player.position, facing: targetFacing, existingMapPlayers, isDefaultOverworld: false });
  socket.to(`map-${targetMapId}`).emit('map-player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
}

// --- Tower Dungeon runs (src/sim/towerDungeon.js) ---
// A tower floor is entered as a dungeon INSTANCE regardless of the floor
// map's own mapType — two parties running the same tower must never share
// monster state, which is exactly what enterDungeonMap already guarantees.
// The player's live run (`player.towerRun`) carries its own copy of the
// floor list, so a tower panel opened elsewhere mid-run can't retarget a
// run that's already in progress.
const TOWER_PANEL_RANGE = EVENT_INTERACT_RANGE + 2; // small grace over the trigger range: the panel stays usable if the player drifts a step while reading it

/**
 * Moves the player into `tower.floors[floorIndex]` and starts a fresh run
 * on it. `returnPosition` is carried across floors so leaving anywhere in
 * the tower puts the player back at the entrance they came in through.
 */
function enterTowerFloor(socket, player, tower, floorIndex) {
  const floor = tower.floors[floorIndex];
  const mapEntry = floor && maps.get(floor.mapId);
  if (!mapEntry) {
    socket?.emit('tower-denied', { reason: 'missing-map' });
    return;
  }
  const returnPosition = player.towerRun?.returnPosition || { ...player.position };
  enterDungeonMap(socket, player, floor.mapId, spawnPositionOf(mapEntry.world), spawnFacingOf(mapEntry.world));
  player.towerRun = {
    eventId: tower.eventId,
    tower,
    floorIndex,
    kills: 0,
    killedMonsterIds: [],
    cleared: false,
    returnPosition,
  };
  socket?.emit('tower-floor-entered', {
    eventId: tower.eventId,
    floorIndex,
    floorCount: tower.floors.length,
    name: floor.name,
    requiredKills: floor.requiredKills || 0,
    requiredMonsterId: floor.requiredMonsterId || null,
    kills: 0,
  });
  // A floor with no authored requirement at all is cleared on arrival —
  // see towerDungeon.js's isFloorRequirementMet.
  checkTowerFloorCleared(socket, player);
}

/**
 * Re-evaluates the current floor's clear condition (called on entry and
 * after every kill credited to this player). The first time it passes, the
 * floor is banked into towerProgress — permanently unlocking the next one,
 * even if the player then leaves without proceeding — and the client is
 * told to show the "proceed to the next floor?" prompt.
 */
function checkTowerFloorCleared(socket, player) {
  const run = player.towerRun;
  if (!run || run.cleared) return;
  const floor = run.tower.floors[run.floorIndex];
  if (!floor || !isFloorRequirementMet(floor, run)) return;
  run.cleared = true;
  markFloorCleared(player.towerProgress, run.eventId, run.floorIndex);
  const next = run.tower.floors[run.floorIndex + 1] || null;
  socket?.emit('tower-floor-cleared', {
    eventId: run.eventId,
    floorIndex: run.floorIndex,
    name: floor.name,
    hasNext: !!next,
    nextName: next ? next.name : null,
    nextFloorNumber: run.floorIndex + 2,
  });
}

/** Ends a run: back to the overworld entrance the player walked in from. Safe to call when there's no run in progress. */
function leaveTowerRun(socket, player) {
  const run = player.towerRun;
  if (!run) return;
  const returnPosition = run.returnPosition || spawnPositionOf(world);
  const returnFacing = run.returnPosition ? null : spawnFacingOf(world); // same reasoning as respawn's, above
  player.towerRun = null;
  socket?.emit('tower-left', {});
  movePlayerToMap(socket, player, defaultOverworldMapId, returnPosition, returnFacing);
}

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  players.set(socket.id, {
    position: spawnPositionOf(world),
    input: { moveX: 0, moveZ: 0 },
    character: null,
    currentFloor: 0, // 0 = overworld
    health: 100,
    maxHealth: 100,
    isDead: false,
    respawnAt: null,
    inventory: {}, // itemId -> quantity
    equipment: initEquipmentState(), // concrete slot -> equipped itemId|null (src/sim/equipment.js)
    itemCharges: {}, // itemId -> charges remaining on the current stack, for authored consumables with usageConfig.mode==='charges'
    itemCooldowns: {}, // itemId -> ms timestamp when usable again, for authored consumables with usageConfig.cooldownSeconds
    gold: 20,
    inStore: false,
    ...initLevelState(), // level, xp
    questState: initQuestState(), // { active: {questId:{progress}}, completed: {questId:true} }
    eventState: initEventRuntimeState(), // { switches: {switchId:boolean} } — see src/sim/events.js
    eventQuestLog: {}, // questId -> {name, description, objectiveText, status:'active'|'complete'} — display-only, populated by startQuest/updateQuestObjective/completeQuest effects; a SEPARATE namespace from src/sim/quests.js's own quest ids
    partyId: null, // id into the parties Map, or null when solo
    mapId: null, // non-default map (via a teleporter) — see movePlayerToMap. null = the legacy overworld/tower/store systems below apply as always.
    dungeonInstanceId: null, // set alongside mapId when that map is a dungeon — see enterDungeonMap. Party-scoped, unlike a plain map's shared room.
    statusEffects: [], // stun/freeze/sleep/slow/dot/hot/buff/shield — see src/sim/statusEffects.js
    facingAngle: spawnFacingOf(world), // radians, atan2(moveX,moveZ) convention — seeded from the map's authored spawn facing, then updated on real movement input (see the 'input' handler below)
    ...initStatAllocation(), // unassignedStatPoints, allocatedStats — see src/sim/statDefs.js
    professions: initAllProfessions(PROFESSIONS), // {BLACKSMITHING:{level,xp}, ...} — see src/sim/professionLeveling.js. Eagerly initialized (not lazy) so the client can show all six bars from minute one.
    activeCraftingStation: null, // set by the openCraftingStation event effect, cleared implicitly by opening a different one — see src/sim/craftResolution.js's canUseStationForRecipe
    // --- Tower Dungeon (src/sim/towerDungeon.js) ---
    towerProgress: initTowerProgress(), // towerId (the tower event object's id) -> {clearedFloors} — which floors this player may enter
    activeTower: null, // {eventId, title, floors, openedAt} snapshot from the openTowerDungeon effect, exactly like activeMerchant — the tower-enter-floor handler validates against THIS, never against anything the client claims
    towerRun: null, // {eventId, floorIndex, kills, killedMonsterIds, cleared, returnPosition} while actually inside a floor; null in the overworld
  });

  const existingPlayers = [...players.entries()]
    .filter(([id, p]) => id !== socket.id && p.currentFloor === 0 && !p.mapId)
    .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));

  socket.emit('welcome', {
    id: socket.id,
    world,
    position: players.get(socket.id).position,
    facing: players.get(socket.id).facingAngle, // radians — the default overworld's authored spawn facing (spawnFacingOf)
    existingPlayers,
    towerMeta: { maxFloor: MAX_FLOOR, entryPoint: TOWER_ZONE ? TOWER_ZONE.center : null, entryRadius: (TOWER_ZONE?.footprintRadius || 0) + TOWER_ENTRY_BUFFER },
    gatherNodeStates: Object.fromEntries(gatherNodeAvailableAt),
    inventory: players.get(socket.id).inventory,
    equipment: players.get(socket.id).equipment,
    gold: players.get(socket.id).gold,
    vendor: VENDOR_BUILDING ? { position: STORE_INTERIOR.npc.position, range: VENDOR_SELL_RANGE } : null,
    storeEntrance: VENDOR_BUILDING ? { position: VENDOR_BUILDING.position, range: STORE_ENTRY_RANGE } : null,
    level: players.get(socket.id).level,
    xp: players.get(socket.id).xp,
    xpToNext: xpForLevel(players.get(socket.id).level),
    unassignedStatPoints: players.get(socket.id).unassignedStatPoints,
    allocatedStats: players.get(socket.id).allocatedStats,
    quests, // static quest catalog — client looks up defs by id
    questState: players.get(socket.id).questState,
    recipes, // static recipe catalog — client looks up defs by id, same idiom as quests
    craftingStationTypes: Object.values(CRAFTING_STATION_TYPES),
    professions: players.get(socket.id).professions,
    eventObjectStates: Object.fromEntries(eventObjectState), // static defs are in world.events; this is the per-object runtime bit (visible/completed)
    eventSwitches: players.get(socket.id).eventState.switches,
    eventQuestLog: players.get(socket.id).eventQuestLog,
  });

  socket.broadcast.emit('player-joined', {
    id: socket.id,
    position: players.get(socket.id).position,
    character: null,
  });

  // Character appearance/class is cosmetic, not gameplay-authoritative, but
  // the server still relays it so every client sees the same thing — a
  // client should never push cosmetic state directly to other clients.
  // Setting a class also (re)initializes authoritative ability state.
  socket.on('set-character', (character) => {
    const player = players.get(socket.id);
    if (!player || !character || typeof character !== 'object') return;
    const classChanged = player.character?.classId !== character.classId;
    player.character = character;
    if (character.classId) {
      try {
        player.abilityState = initAbilityState(character.classId);
        // A (re)pick of class invalidates any previously-allocated stat
        // points — same "fresh start" rule a respec follows, since the
        // class's own baseStats are what those points were spent against.
        if (classChanged) Object.assign(player, initStatAllocation());
        refreshPlayerMaxHealth(player);
        player.health = player.maxHealth;
        // Same shape as allocate-stat-points' own 'stats-updated' — picking
        // a class is the first time this player has a real derived-stats
        // number (armor, crit, etc.) at all, and nothing else pushes it to
        // them until they touch the Stats or Equipment panel otherwise.
        socket.emit('stats-updated', {
          unassignedStatPoints: player.unassignedStatPoints,
          allocatedStats: player.allocatedStats,
          derived: getPlayerDerivedStats(player),
          maxHealth: player.maxHealth,
          health: player.health,
        });
      } catch {
        // unknown classId — leave abilityState/health untouched rather than crash the connection
      }
    }
    socket.broadcast.emit('player-character', { id: socket.id, character });
  });

  /**
   * Commit a stat-allocation payload (spec Section 3.2's `{ STR: 1, INT: 2 }`
   * shape) against the player's unassigned pool. Pure validate-then-apply
   * (src/sim/statDefs.js's applyStatAllocation) — a bad/over-budget request
   * is rejected wholesale, never partially applied.
   */
  socket.on('allocate-stat-points', (delta) => {
    const player = players.get(socket.id);
    if (!player || !player.character?.classId) return;
    const classDef = CLASSES[player.character.classId];
    const result = applyStatAllocation(
      { unassignedStatPoints: player.unassignedStatPoints, allocatedStats: player.allocatedStats },
      classDef.baseStats,
      delta,
    );
    if (!result.ok) {
      socket.emit('stat-allocation-denied', { reason: result.reason });
      return;
    }
    player.unassignedStatPoints = result.state.unassignedStatPoints;
    player.allocatedStats = result.state.allocatedStats;
    refreshPlayerMaxHealth(player);
    socket.emit('stats-updated', {
      unassignedStatPoints: player.unassignedStatPoints,
      allocatedStats: player.allocatedStats,
      derived: getPlayerDerivedStats(player),
      maxHealth: player.maxHealth,
      health: player.health,
    });
  });

  /** Refund every allocated stat point back to the unassigned pool, at a flat gold cost (spec Section 3.3's respec mechanism — the item-based route is scroll_of_oblivion via use-item, below). */
  socket.on('respec-stats', () => {
    const player = players.get(socket.id);
    if (!player || !player.character?.classId) return;
    if (player.gold < RESPEC_GOLD_COST) {
      socket.emit('stat-allocation-denied', { reason: 'insufficient-gold' });
      return;
    }
    player.gold -= RESPEC_GOLD_COST;
    Object.assign(player, respecStatAllocation({ unassignedStatPoints: player.unassignedStatPoints, allocatedStats: player.allocatedStats }));
    refreshPlayerMaxHealth(player);
    socket.emit('stats-updated', {
      unassignedStatPoints: player.unassignedStatPoints,
      allocatedStats: player.allocatedStats,
      derived: getPlayerDerivedStats(player),
      maxHealth: player.maxHealth,
      health: player.health,
      gold: player.gold,
    });
  });

  // Client requests entering the tower; server validates the player is
  // actually near the tower in the overworld before honoring it.
  socket.on('enter-tower', () => {
    const player = players.get(socket.id);
    if (!player || player.currentFloor !== 0 || player.inStore || player.isDead || !TOWER_ZONE) return;
    const entryRadius = TOWER_ZONE.footprintRadius + TOWER_ENTRY_BUFFER;
    if (!isWithinRange(player.position, TOWER_ZONE.center, entryRadius)) {
      socket.emit('tower-denied', { reason: 'too-far' });
      return;
    }
    enterFloor(socket, player, 1);
  });

  // Advance to the next floor. Requires being near the current floor's exit
  // point AND having cleared every monster on the current floor.
  socket.on('advance-floor', () => {
    const player = players.get(socket.id);
    if (!player || player.currentFloor === 0 || player.isDead) return;
    const floor = towerFloors.get(player.currentFloor);
    if (!floor) return;
    if (!isWithinRange(player.position, floor.def.exitPoint, 3)) {
      socket.emit('tower-denied', { reason: 'not-at-exit' });
      return;
    }
    if (!isFloorCleared(floor.monsters)) {
      socket.emit('tower-denied', { reason: 'floor-not-cleared' });
      return;
    }
    const nextFloorNumber = player.currentFloor + 1;
    if (!towerFloors.has(nextFloorNumber)) {
      socket.emit('tower-denied', { reason: 'top-of-tower' });
      return;
    }
    leaveFloor(socket, player);
    enterFloor(socket, player, nextFloorNumber);
  });

  // Leave the tower entirely, back to the overworld at the tower's base.
  socket.on('exit-tower', () => {
    const player = players.get(socket.id);
    if (!player || player.currentFloor === 0 || player.isDead) return;
    leaveFloor(socket, player);
    player.currentFloor = 0;
    player.position = { ...TOWER_EXIT_POINT };
    const existingPlayers = [...players.entries()]
      .filter(([id, p]) => id !== socket.id && p.currentFloor === 0 && !p.mapId)
      .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
    socket.emit('floor-exited', { position: player.position, existingPlayers });
    socket.broadcast.emit('player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
  });


  // actually goes off (cooldown/resource), using the same pure sim logic
  // the client uses for its own optimistic prediction.
  // Payload is either a plain string (old shape, kept working) or
  // { abilityId, targetId } — targetId is the client's currently-selected
  // target (click or Tab, see main.js), a monster or player id, or absent/
  // null for "no explicit target, use the skill's own fallback" (nearest
  // enemy in range / self). Never trusted blindly: resolveAbilityEffect only
  // honors it if it's actually valid for the skill's targeting modes/range.
  socket.on('use-ability', (payload) => {
    const abilityId = typeof payload === 'string' ? payload : payload?.abilityId;
    const targetId = typeof payload === 'string' ? null : (typeof payload?.targetId === 'string' ? payload.targetId : null);
    const player = players.get(socket.id);
    if (!player || !player.abilityState || player.isDead || typeof abilityId !== 'string') return;
    if (isCCd(player.statusEffects, Date.now())) {
      socket.emit('ability-result', { ok: false, abilityId, reason: 'stunned' });
      return;
    }
    if (pendingCasts.has(socket.id)) {
      socket.emit('ability-result', { ok: false, abilityId, reason: 'casting' });
      return;
    }

    const skill = skillDefsById.get(abilityId);

    if (skill && player.level < (skill.requiredLevel || 1)) {
      socket.emit('ability-result', { ok: false, abilityId, reason: 'locked' });
      return;
    }

    // A single/chain enemy-targeted skill with no valid candidate actually in
    // range/reach right now would otherwise still consume resource/cooldown
    // and play the full cast animation on every client, then silently whiff
    // — reject it up front instead, before anything is committed. AoE shapes
    // (circle/cone/line) are ground/facing-targeted and can legitimately be
    // cast at empty space to pre-empt an approaching enemy, so they're not
    // gated here.
    // Also the one place that works out WHICH enemy the VFX should play on.
    // resolveEnemyTargets silently ignores an explicit target that's out of
    // range and falls back to the nearest one in reach — so echoing the
    // client's raw targetId back in 'ability-used' drew the effect on a
    // monster across the field while the damage landed on the one in front
    // of the player. Broadcast what actually got hit instead.
    let broadcastTargetId = targetId;
    if (skill && skill.targeting.modes.includes('enemy')) {
      const monsters = monstersFor(player) || [];
      const candidates = monsters.filter((m) => m.health > 0 && !m.friendly);
      const hits = resolveEnemyTargets(skill, player.position, player.facingAngle || 0, candidates, targetId);
      if (!hits.length && (skill.targeting.shape === 'single' || skill.targeting.shape === 'chain')) {
        socket.emit('ability-result', { ok: false, abilityId, reason: 'out-of-range' });
        return;
      }
      // Keep the player's own pick when it survived resolution (an AoE aimed
      // at a specific monster still centers there even if a closer one is
      // also caught) — only substitute when it didn't.
      if (!hits.some((h) => h.id === targetId)) broadcastTargetId = hits[0]?.id ?? null;
    }

    const result = tryUseAbility(player.abilityState, abilityId, Date.now());
    if (result.ok) {
      player.abilityState = result.state;
      const castMs = skill?.castMs || 0;
      socket.emit('ability-result', { ok: true, abilityId, resource: result.state.resource, cooldownEndsAt: result.state.cooldownEndsAt[abilityId], castMs });
      io.emit('ability-used', { id: socket.id, abilityId, targetId: broadcastTargetId }); // for animation on every client, including sender — plays immediately, at cast START, regardless of castMs

      if (skill) {
        // Captured now, not read fresh later — a canMoveDuringCast skill
        // lets the caster keep moving while this resolves, and resolving
        // against their CURRENT position/facing instead made a moving
        // caster's own cast whiff (see pendingCasts'/pendingImpacts' doc
        // comments).
        const castStartPosition = { x: player.position.x, y: player.position.y, z: player.position.z };
        const castStartFacingAngle = player.facingAngle || 0;
        const impactDelayMs = computeImpactDelayMs(skill);

        if (castMs > 0) {
          // Resolved later, in the main tick loop — see its "pending casts"
          // section for cancellation (movement when !canMoveDuringCast, or
          // fresh CC) and completion.
          pendingCasts.set(socket.id, {
            ability: result.ability, skill, targetId,
            resolveAt: Date.now() + castMs,
            impactDelayMs,
            startPosition: castStartPosition,
            startFacingAngle: castStartFacingAngle,
          });
        } else if (impactDelayMs > 0) {
          pendingImpacts.push({
            resolveAt: Date.now() + impactDelayMs,
            attackerId: socket.id, ability: result.ability, targetId,
            casterPosition: castStartPosition, casterFacingAngle: castStartFacingAngle,
          });
        } else {
          resolveAbilityEffect(socket.id, player, result.ability, targetId, castStartPosition, castStartFacingAngle);
        }
      }
    } else {
      socket.emit('ability-result', { ok: false, abilityId, reason: result.reason });
    }
  });

  // Enter the store interior — validated against real proximity to the
  // building in the overworld, same pattern as entering the tower.
  socket.on('enter-store', () => {
    const player = players.get(socket.id);
    if (!player || player.currentFloor !== 0 || player.inStore || player.isDead || !VENDOR_BUILDING) return;
    if (!isWithinRange(player.position, VENDOR_BUILDING.position, STORE_ENTRY_RANGE)) {
      socket.emit('tower-denied', { reason: 'too-far' }); // reusing the same denial channel/UI as the tower
      return;
    }

    player.inStore = true;
    player.position = { ...STORE_INTERIOR.spawnPoint };
    socket.join('store');
    socket.broadcast.emit('player-left', { id: socket.id }); // vanish from the overworld view

    const existingStorePlayers = [...players.entries()]
      .filter(([id, p]) => id !== socket.id && p.inStore)
      .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));

    socket.emit('store-entered', {
      interior: STORE_INTERIOR,
      position: player.position,
      existingStorePlayers,
    });
    socket.to('store').emit('store-player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
  });

  socket.on('exit-store', () => {
    const player = players.get(socket.id);
    if (!player || !player.inStore) return;

    socket.to('store').emit('store-player-left', { id: socket.id });
    socket.leave('store');
    player.inStore = false;
    player.position = { x: VENDOR_BUILDING.position.x, y: 0, z: VENDOR_BUILDING.position.z + 3 };

    const existingPlayers = [...players.entries()]
      .filter(([id, p]) => id !== socket.id && p.currentFloor === 0 && !p.inStore && !p.mapId)
      .map(([id, p]) => ({ id, position: p.position, character: p.character, equipmentLoadout: weaponLoadoutFor(p) }));
    socket.emit('store-exited', { position: player.position, existingPlayers });
    socket.broadcast.emit('player-joined', { id: socket.id, position: player.position, character: player.character, equipmentLoadout: weaponLoadoutFor(player) });
  });

  // Generic teleporter use — the one mechanism behind building
  // entrances/exits and (for now, until Phase 4's party instancing)
  // dungeon entrances too. Requires actual proximity to the SOURCE
  // teleporter server-side (never trust the client for "I'm near it"),
  // same isWithinRange idiom the tower/store entrances already use.
  socket.on('use-teleporter', ({ teleporterId } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof teleporterId !== 'string') return;
    const source = teleporterRegistry.get(teleporterId);
    if (!source) return;
    if (!isWithinRange(player.position, source.teleporter.position, TELEPORTER_USE_RANGE)) {
      socket.emit('teleport-denied', { reason: 'too-far' });
      return;
    }
    const target = source.teleporter.linkedTeleporterId ? teleporterRegistry.get(source.teleporter.linkedTeleporterId) : null;
    if (!target) {
      socket.emit('teleport-denied', { reason: 'unlinked' });
      return;
    }
    // Walking out of a Tower Dungeon floor through a teleporter the author
    // placed there ends the run (its banked floor unlocks survive) — the
    // run's floor list only means anything while the player is actually on
    // one of its floors.
    player.towerRun = null;
    if (maps.get(target.mapId)?.meta.mapType === 'dungeon') {
      enterDungeonMap(socket, player, target.mapId, target.teleporter.position);
    } else {
      movePlayerToMap(socket, player, target.mapId, target.teleporter.position);
    }
  });

  // --- Tower Dungeon (src/sim/towerDungeon.js) ---
  // Every gate here is re-checked against server state: which tower the
  // player actually has open (activeTower, set only by the event's own
  // openTowerDungeon effect), that they're still standing at its entrance,
  // and that the floor they asked for is unlocked for THEM.
  socket.on('tower-enter-floor', ({ eventId, floorIndex } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || !Number.isInteger(floorIndex)) return;
    const tower = player.activeTower;
    if (!tower || tower.eventId !== eventId || !tower.floors[floorIndex]) return;
    if (player.towerRun) { socket.emit('tower-denied', { reason: 'already-inside' }); return; }
    if (!isWithinRange(player.position, tower.openedAt, TOWER_PANEL_RANGE)) {
      socket.emit('tower-denied', { reason: 'too-far' });
      return;
    }
    if (!isFloorUnlocked(player.towerProgress, eventId, floorIndex)) {
      socket.emit('tower-denied', { reason: 'locked' });
      return;
    }
    enterTowerFloor(socket, player, tower, floorIndex);
  });

  // The "yes" on the floor-cleared prompt. Uses the RUN's own floor list,
  // not activeTower, so it can't be redirected into a different tower.
  socket.on('tower-next-floor', () => {
    const player = players.get(socket.id);
    const run = player?.towerRun;
    if (!player || player.isDead || !run) return;
    if (!run.cleared) { socket.emit('tower-denied', { reason: 'floor-not-cleared' }); return; }
    if (!run.tower.floors[run.floorIndex + 1]) { socket.emit('tower-denied', { reason: 'top-of-tower' }); return; }
    enterTowerFloor(socket, player, run.tower, run.floorIndex + 1);
  });

  socket.on('tower-leave', () => {
    const player = players.get(socket.id);
    if (!player || !player.towerRun) return;
    leaveTowerRun(socket, player);
  });

  // --- Party ---
  // Invite the given player (client sends the nearest player's id). Server
  // re-validates real proximity in the overworld so a client can't invite
  // someone across the map.
  socket.on('party-invite', (targetId) => {
    const inviter = players.get(socket.id);
    const target = players.get(targetId);
    if (!inviter || !target || typeof targetId !== 'string') return;
    if (inviter.currentFloor !== 0 || target.currentFloor !== 0 || inviter.inStore || target.inStore || inviter.mapId || target.mapId) return;
    if (!isWithinRange(inviter.position, target.position, PARTY_INVITE_RANGE)) return;
    const reason = sendPartyInvite(socket.id, targetId);
    if (reason) socket.emit('party-error', { reason });
  });

  socket.on('party-accept', () => {
    const reason = acceptPartyInvite(socket.id);
    if (reason) socket.emit('party-error', { reason });
  });

  socket.on('party-leave', () => removeFromParty(socket.id));

  // --- Quests ---
  // Talking to an NPC: validates real proximity, advances any 'talk' quests
  // targeting this NPC, and tells the client which quests this NPC can offer
  // or accept as turn-in right now (so the dialog box can show the buttons).
  socket.on('talk-npc', (npcId) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof npcId !== 'string') return;
    if (!playerNearNpc(player, npcId)) return;

    const changed = registerNpcTalk(socket, player, npcId);
    if (changed) sendQuestState(socket, player);

    const offers = quests.filter((q) => q.giverNpcId === npcId && canAccept(player.questState, q, player.level, player.eventState.switches));
    // Turn-in is asked of turnInNpcId, not giverNpcId: a `turnInAtTarget`
    // talk-quest is closed by the NPC it sent you to, and the giver is done
    // with you the moment you accept.
    const turnIns = quests.filter(
      (q) => turnInNpcId(q) === npcId && player.questState.active[q.id] && isReadyToTurnIn(player.questState, q, player.inventory)
    );
    socket.emit('npc-quests', { npcId, offers, turnIns });
  });

  socket.on('accept-quest', (questId) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof questId !== 'string') return;
    const quest = quests.find((q) => q.id === questId);
    if (!quest || !playerNearNpc(player, quest.giverNpcId)) return;
    if (acceptQuest(player.questState, quest, player.level, player.eventState.switches)) {
      applyQuestSwitches(socket, player, quest, 'accept');
      sendQuestState(socket, player);
      socket.emit('quest-accepted', { questId });
    }
  });

  socket.on('turn-in-quest', (questId) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof questId !== 'string') return;
    const quest = quests.find((q) => q.id === questId);
    if (!quest || !playerNearNpc(player, turnInNpcId(quest))) return;

    const result = turnInQuest(player.questState, quest, player.inventory);
    if (!result.ok) {
      socket.emit('quest-turn-in-result', { ok: false, questId, reason: result.reason });
      return;
    }
    applyQuestSwitches(socket, player, quest, 'complete');
    grantQuestRewards(socket.id, player, result.rewards);
    sendQuestState(socket, player);
    socket.emit('quest-turn-in-result', { ok: true, questId, rewards: result.rewards, inventory: player.inventory, gold: player.gold });
  });

  // --- Event Objects (src/sim/events.js) ---
  socket.on('start-event', (eventId) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof eventId !== 'string') return;
    if (activeEventRuns.has(socket.id)) return; // one script in flight per player at a time in v1
    const eventDef = eventById(eventId);
    if (!eventDef) return;
    const state = eventObjectState.get(eventId);
    if (!state || !state.visible) return;

    if (eventDef.start.type === 'talk' || eventDef.start.type === 'interact') {
      if (!playerNearEvent(player, eventDef)) return;
      // A talk-triggered event attached to an NPC IS talking to that NPC, so
      // it owes the same quest bookkeeping the plain dialog path does — see
      // registerNpcTalk. Run BEFORE the script starts, so the sheet it picks
      // sees the phase this talk just produced (a 'talk' objective completing
      // here is exactly what moves the quest from 'active' to 'ready'/'done').
      if (eventDef.start.type === 'talk' && eventDef.attachedType === 'npc' && eventDef.attachedId) {
        if (registerNpcTalk(socket, player, eventDef.attachedId)) sendQuestState(socket, player);
      }
    } else if (eventDef.start.type === 'switchOn') {
      if (!player.eventState.switches[eventDef.start.switchId]) return;
    } else {
      return; // enterArea events are started server-side by the tick loop, never by client request
    }

    const cursor = startEventScript(eventDef, buildEventCtx(player, eventDef));
    if (!cursor) return; // no sheet is currently eligible (all exhausted, no fallback) — silent no-op, same as a Bakin object with no active sheet
    activeEventRuns.set(socket.id, cursor);
    runEventStep(socket, player, cursor, eventDef, Date.now());
  });

  socket.on('event-choice', ({ eventId, choiceIndex } = {}) => {
    const player = players.get(socket.id);
    if (!player || typeof eventId !== 'string' || !Number.isInteger(choiceIndex)) return;
    const cursor = activeEventRuns.get(socket.id);
    if (!cursor || cursor.eventId !== eventId || !cursor.awaitingChoice) return;
    const eventDef = eventById(eventId);
    if (!eventDef) { activeEventRuns.delete(socket.id); return; }
    if (!resumeEventChoice(cursor, choiceIndex)) return;
    runEventStep(socket, player, cursor, eventDef, Date.now());
  });


  socket.on('use-item', (itemId) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof itemId !== 'string') return;
    if ((player.inventory[itemId] || 0) <= 0) return;

    let itemDef;
    try {
      itemDef = getItemDef(itemId);
    } catch {
      itemDef = null;
    }

    if (itemDef) {
      if (!itemDef.healAmount && !itemDef.statBuff && !itemDef.statPointTome && !itemDef.respecScroll) return; // not a usable consumable

      player.inventory[itemId] -= 1;

      if (itemDef.healAmount) {
        player.health = Math.min(player.maxHealth, player.health + itemDef.healAmount);
      }
      if (itemDef.statBuff) {
        // Same generic 'buff' status effect a skill buff uses (BUFF_STATS in
        // skillDefs.js includes the six primary stats) — applyStatusEffect
        // refresh-by-type already handles re-drinking the same elixir.
        player.statusEffects = applyStatusEffect(player.statusEffects, {
          type: 'buff', stat: itemDef.statBuff.stat, amount: itemDef.statBuff.amount,
          durationMs: itemDef.statBuff.durationSeconds * 1000,
        }, Date.now());
        refreshPlayerMaxHealth(player); // a VIT elixir should bump maxHealth immediately, not just on next level/allocation
      }
      if (itemDef.statPointTome) {
        player.unassignedStatPoints = (player.unassignedStatPoints || 0) + 1;
      }
      if (itemDef.respecScroll && player.character?.classId) {
        Object.assign(player, respecStatAllocation({ unassignedStatPoints: player.unassignedStatPoints, allocatedStats: player.allocatedStats }));
        refreshPlayerMaxHealth(player);
      }

      socket.emit('item-used', {
        itemId, healedTo: player.health, inventory: player.inventory,
        unassignedStatPoints: player.unassignedStatPoints, allocatedStats: player.allocatedStats, maxHealth: player.maxHealth,
      });
      return;
    }

    // Authored consumable (Item Builder — src/sim/authoredItems.js), the
    // catalog getItemDef doesn't know about. Same "server never trusts the
    // client for anything that affects persistent state" rule: cooldown and
    // charges are read/written here, never sent by the client.
    const authored = authoredItemById[itemId];
    if (!authored || authored.type !== 'consumable' || !authored.usageConfig) return;
    const usage = authored.usageConfig;
    const now = Date.now();
    if (usage.cooldownSeconds && now < (player.itemCooldowns[itemId] || 0)) {
      socket.emit('item-use-denied', { itemId, reason: 'cooldown' });
      return;
    }

    if (usage.mode === 'charges') {
      const remaining = player.itemCharges[itemId] ?? usage.chargesMax;
      if (remaining <= 1) {
        delete player.itemCharges[itemId];
        player.inventory[itemId] -= 1;
      } else {
        player.itemCharges[itemId] = remaining - 1;
      }
    } else if (usage.mode === 'single') {
      player.inventory[itemId] -= 1;
    } // 'unlimited' — never consumed

    if (usage.cooldownSeconds) player.itemCooldowns[itemId] = now + usage.cooldownSeconds * 1000;

    const trigger = usage.effectTrigger;
    if (trigger?.kind === 'restoreHealth') {
      player.health = Math.min(player.maxHealth, player.health + trigger.amount);
    } else if (trigger?.kind === 'restoreMana') {
      if (player.abilityState) {
        const max = CLASSES[player.character?.classId]?.maxResource ?? player.abilityState.resource;
        player.abilityState.resource = Math.min(max, player.abilityState.resource + trigger.amount);
      }
    } else if (trigger?.kind === 'buff') {
      player.statusEffects = applyStatusEffect(player.statusEffects, {
        type: 'buff', stat: trigger.stat, amount: trigger.amount, durationMs: trigger.durationSeconds * 1000,
      }, now);
      refreshPlayerMaxHealth(player);
    }

    socket.emit('item-used', {
      itemId, healedTo: player.health, inventory: player.inventory,
      unassignedStatPoints: player.unassignedStatPoints, allocatedStats: player.allocatedStats, maxHealth: player.maxHealth,
    });
  });


  // Replaces the old crafting.js hardcoded-recipe path entirely. Emits one
  // craft-result PER completed item (not one summary for the whole batch) so
  // the client's batch-craft UI can advance incrementally and cleanly
  // truncate a run if a later item fails or the player walks out of range —
  // see src/sim/craftResolution.js's canUseStationForRecipe/resolveCraft.
  socket.on('craft', ({ recipeId, quantity } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || typeof recipeId !== 'string') return;
    if (!Number.isInteger(quantity) || quantity < 1) quantity = 1;

    let recipe;
    try {
      recipe = findRecipeDef(recipes, recipeId);
    } catch {
      socket.emit('craft-result', { ok: false, recipeId, reason: 'unknown-recipe' });
      return;
    }

    for (let i = 0; i < quantity; i++) {
      const stationCheck = canUseStationForRecipe(player, recipe, CRAFTING_STATION_TYPES);
      if (!stationCheck.ok) {
        socket.emit('craft-result', { ok: false, recipeId, reason: stationCheck.reason, craftedSoFar: i });
        return;
      }
      const result = resolveCraft(player, recipe, rng);
      if (!result.ok) {
        player.inventory = result.inventory || player.inventory;
        socket.emit('craft-result', { ok: false, recipeId, reason: result.reason, craftedSoFar: i, inventory: player.inventory });
        return;
      }
      player.inventory = result.inventory;
      player.professions = result.professions;
      socket.emit('craft-result', {
        ok: true, recipeId, index: i, crit: result.crit, outputItemId: result.outputItemId, yieldQty: result.yieldQty,
        inventory: player.inventory, professions: player.professions, levelsGained: result.levelsGained,
      });
    }
  });

  // Selling now requires actually being inside the store, near the NPC —
  // not just near the building exterior (see enter-store above).
  socket.on('sell-item', ({ itemId, quantity } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead || !player.inStore) return;
    if (typeof itemId !== 'string' || !Number.isInteger(quantity) || quantity <= 0) return;
    if (!isWithinRange(player.position, STORE_INTERIOR.npc.position, VENDOR_SELL_RANGE)) {
      socket.emit('sell-result', { ok: false, reason: 'too-far' });
      return;
    }

    const owned = player.inventory[itemId] || 0;
    if (owned < quantity) {
      socket.emit('sell-result', { ok: false, reason: 'insufficient-items' });
      return;
    }

    let itemDef;
    try {
      itemDef = getItemDef(itemId);
    } catch {
      return; // unknown item id — silently ignore rather than crash
    }

    player.inventory[itemId] = owned - quantity;
    const earned = itemDef.sellPrice * quantity;
    player.gold += earned;
    socket.emit('sell-result', { ok: true, itemId, quantity, earned, gold: player.gold, inventory: player.inventory });
  });

  // Event-authored merchant (src/sim/events.js's openMerchantStore) — a
  // separate path from the hardcoded general store above. player.activeMerchant
  // is set by applyEventEffect when the triggering script's effect runs;
  // these two handlers never trust anything the client sends except which
  // item/quantity it wants, exactly like sell-item/craft above.
  socket.on('merchant-buy-item', ({ itemId, quantity } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead) return;
    if (typeof itemId !== 'string' || !Number.isInteger(quantity) || quantity <= 0) return;
    const merchant = player.activeMerchant;
    if (!merchant) { socket.emit('merchant-buy-result', { ok: false, reason: 'no-merchant' }); return; }
    if (!isWithinRange(player.position, merchant.openedAt, EVENT_MERCHANT_RANGE)) {
      socket.emit('merchant-buy-result', { ok: false, reason: 'too-far' });
      return;
    }
    const entry = merchant.items.find((i) => i.itemId === itemId);
    if (!entry) { socket.emit('merchant-buy-result', { ok: false, reason: 'not-sold-here' }); return; }
    if (entry.stock !== undefined && entry.stock !== null && entry.stock < quantity) {
      socket.emit('merchant-buy-result', { ok: false, reason: 'out-of-stock' });
      return;
    }
    const cost = entry.price * quantity;
    if (player.gold < cost) { socket.emit('merchant-buy-result', { ok: false, reason: 'insufficient-gold' }); return; }

    player.gold -= cost;
    player.inventory[itemId] = (player.inventory[itemId] || 0) + quantity;
    if (entry.stock !== undefined && entry.stock !== null) entry.stock -= quantity;
    socket.emit('merchant-buy-result', { ok: true, itemId, quantity, cost, gold: player.gold, inventory: player.inventory });
  });

  socket.on('merchant-sell-item', ({ itemId, quantity } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead) return;
    if (typeof itemId !== 'string' || !Number.isInteger(quantity) || quantity <= 0) return;
    const merchant = player.activeMerchant;
    if (!merchant) { socket.emit('merchant-sell-result', { ok: false, reason: 'no-merchant' }); return; }
    if (!isWithinRange(player.position, merchant.openedAt, EVENT_MERCHANT_RANGE)) {
      socket.emit('merchant-sell-result', { ok: false, reason: 'too-far' });
      return;
    }
    const owned = player.inventory[itemId] || 0;
    if (owned < quantity) { socket.emit('merchant-sell-result', { ok: false, reason: 'insufficient-items' }); return; }
    const basePrice = resolveSellPrice(itemId);
    if (basePrice === null) { socket.emit('merchant-sell-result', { ok: false, reason: 'not-sellable' }); return; }

    const earned = Math.round(basePrice * merchant.sellMultiplier * quantity);
    player.inventory[itemId] = owned - quantity;
    player.gold += earned;
    socket.emit('merchant-sell-result', { ok: true, itemId, quantity, earned, gold: player.gold, inventory: player.inventory });
  });

  // Equip-slot system (src/sim/equipment.js) — server-authoritative like
  // every other inventory mutation here: the client only ever suggests an
  // item/slot, canEquip/equipItem do the real two-handed-lockout/shield/
  // slot-matching validation. Both handlers emit the same shape so the
  // client has one result handler to write.
  function emitEquipmentResult(socket, player, extra) {
    socket.emit('equipment-result', {
      equipment: player.equipment, inventory: player.inventory,
      maxHealth: player.maxHealth, health: player.health, derived: getPlayerDerivedStats(player),
      ...extra,
    });
    // A successful equip/unequip changes what OTHER players should see this
    // player holding — same global-broadcast convention 'player-character'
    // already uses for cosmetic changes (not room-scoped; clients gate on
    // whether that player is currently visible in their own context).
    if (extra.ok) {
      socket.broadcast.emit('player-weapon-loadout', { id: socket.id, loadout: weaponLoadoutFor(player) });
    }
  }

  socket.on('equip-item', ({ itemId, slot } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead) return;
    if (typeof itemId !== 'string') return;
    const owned = player.inventory[itemId] || 0;
    if (owned < 1) { emitEquipmentResult(socket, player, { ok: false, action: 'equip', reason: 'not-owned' }); return; }
    const itemDef = authoredItemById[itemId];
    if (!itemDef) { emitEquipmentResult(socket, player, { ok: false, action: 'equip', reason: 'unknown-item' }); return; }

    // A client-suggested slot is only honored if it's actually a legal
    // concrete slot for this item's base slot (e.g. picking ring2
    // specifically to replace it) — anything else falls back to
    // auto-targeting, same rule for a malicious client as for no slot sent.
    const targetSlot = typeof slot === 'string' && EQUIP_SLOT_IDS.includes(slot) && baseSlotFor(slot) === itemDef.slot
      ? slot
      : findAutoTargetSlot(player.equipment, itemDef.slot);

    const result = equipItem(player.equipment, itemId, itemDef, targetSlot, authoredItemById, weaponTypeById);
    if (!result.ok) { emitEquipmentResult(socket, player, { ok: false, action: 'equip', reason: result.reason }); return; }

    player.inventory[itemId] = owned - 1;
    for (const returnedId of result.returnedToInventory) {
      player.inventory[returnedId] = (player.inventory[returnedId] || 0) + 1;
    }
    player.equipment = result.equipment;
    refreshPlayerMaxHealth(player);
    emitEquipmentResult(socket, player, { ok: true, action: 'equip', itemId, slot: targetSlot });
  });

  socket.on('unequip-item', ({ slot } = {}) => {
    const player = players.get(socket.id);
    if (!player || player.isDead) return;
    if (typeof slot !== 'string' || !EQUIP_SLOT_IDS.includes(slot)) return;
    const result = unequipItem(player.equipment, slot);
    if (!result.removed) { emitEquipmentResult(socket, player, { ok: false, action: 'unequip', reason: 'slot-empty' }); return; }
    player.inventory[result.removed] = (player.inventory[result.removed] || 0) + 1;
    player.equipment = result.equipment;
    refreshPlayerMaxHealth(player);
    emitEquipmentResult(socket, player, { ok: true, action: 'unequip', itemId: result.removed, slot });
  });

  socket.on('gather', (nodeId) => {
    const player = players.get(socket.id);
    if (!player || player.currentFloor !== 0 || player.inStore || player.isDead || typeof nodeId !== 'string') return;

    const node = (world.gatheringNodes || []).find((n) => n.id === nodeId);
    if (!node) return;

    if (!isWithinRange(player.position, node.position, GATHER_RANGE)) {
      socket.emit('gather-result', { ok: false, nodeId, reason: 'too-far' });
      return;
    }
    const availableAt = gatherNodeAvailableAt.get(nodeId) || 0;
    const now = Date.now();
    if (now < availableAt) {
      socket.emit('gather-result', { ok: false, nodeId, reason: 'on-cooldown', availableAt });
      return;
    }

    const nodeDef = getNodeTypeDef(node.nodeType);
    const { itemId, quantity } = rollYield(node.nodeType, rng);
    if (quantity > 0) {
      player.inventory[itemId] = (player.inventory[itemId] || 0) + quantity;
    }
    const nextAvailableAt = now + nodeDef.respawnMs;
    gatherNodeAvailableAt.set(nodeId, nextAvailableAt);

    socket.emit('gather-result', { ok: true, nodeId, itemId, quantity, inventory: player.inventory, availableAt: nextAvailableAt });
    socket.broadcast.emit('gather-node-depleted', { nodeId, availableAt: nextAvailableAt });
  });

  // Client sends only *intent*, never a position. Server decides the outcome.
  socket.on('input', (raw) => {
    const player = players.get(socket.id);
    if (!player) return;
    player.input = sanitizeInput(raw);
    // Facing is never sent explicitly — derived from the last real movement
    // input, same atan2(moveX, moveZ) convention the client's own facing
    // calc uses (src/main.js). Needed server-side for aoe-cone/aoe-line
    // targeting (src/sim/skillResolution.js), which has no other notion of
    // "which way is this player looking." Idle: keep the last value, same
    // as the client's own "idle: keep last facing" rule.
    if (player.input.moveX !== 0 || player.input.moveZ !== 0) {
      player.facingAngle = Math.atan2(player.input.moveX, player.input.moveZ);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    removeFromParty(socket.id); // promote/disband before the player object is gone
    pendingInvites.delete(socket.id);
    const player = players.get(socket.id);
    if (player && player.currentFloor !== 0) {
      socket.to(`floor-${player.currentFloor}`).emit('floor-player-left', { id: socket.id });
    }
    if (player && player.inStore) {
      socket.to('store').emit('store-player-left', { id: socket.id });
    }
    if (player && player.dungeonInstanceId) {
      socket.to(`dungeon-${player.mapId}-${player.dungeonInstanceId}`).emit('map-player-left', { id: socket.id });
    } else if (player && player.mapId) {
      socket.to(`map-${player.mapId}`).emit('map-player-left', { id: socket.id });
    }
    const leftDungeonInstanceId = player?.dungeonInstanceId;
    players.delete(socket.id);
    pendingCasts.delete(socket.id);
    activeEventRuns.delete(socket.id);
    playerZoneMembership.delete(socket.id);
    // Safety net: closes an instance whose last remaining member just
    // disconnected instead of walking out the exit gate — otherwise it
    // would sit open (and its auto-close timer, if any, would still fire
    // eventually, but there's no reason to leak a dead instance in the
    // meantime).
    if (leftDungeonInstanceId) closeDungeonInstanceIfEmpty(leftDungeonInstanceId);
    io.emit('player-left', { id: socket.id });
  });
});

// --- Fixed-rate authoritative tick ---
const TICK_HZ = 20;
const DT = 1 / TICK_HZ;

const TICK_BUDGET_MS = 1000 / TICK_HZ;
// A late tick must still advance the world by the time that actually elapsed.
// setInterval only promises "no sooner than" — under GC, a big broadcast, or a
// blocked event loop it fires late, and a body that always integrates a fixed DT
// silently DROPS that lost time forever (the loop never catches up). The client
// integrates with real frame dt and loses nothing, so after any hitch it sits
// permanently ahead of a server that will never arrive: the correction then drags
// it back about as fast as prediction pushes it forward, and the character walks
// on the spot. Clamped so a long stall (laptop sleep, debugger pause) resolves as
// a few dropped frames rather than launching everyone across the map.
const MAX_MOVE_STEP = 0.25; // seconds
let lastTickStart = 0;
setInterval(() => {
  const now = Date.now();
  let moveDt = DT;
  if (lastTickStart) {
    const sinceLastStart = now - lastTickStart;
    moveDt = Math.min(MAX_MOVE_STEP, sinceLastStart / 1000);
    if (sinceLastStart > TICK_BUDGET_MS * 1.5) {
      console.warn(`[tick] late by ${(sinceLastStart - TICK_BUDGET_MS).toFixed(0)}ms (gap ${sinceLastStart.toFixed(0)}ms, budget ${TICK_BUDGET_MS}ms)`);
    }
  }
  lastTickStart = now;

  // Effects whose cast bar already finished but whose animation's travel/
  // impact timing runs longer than castMs (see the pendingImpacts doc
  // comment and computeImpactDelayMs) — land now if their extra delay has
  // elapsed. Independent of the per-player loop below since the caster is
  // already free to move/act again by this point.
  if (pendingImpacts.length) {
    const due = pendingImpacts.filter((pi) => now >= pi.resolveAt);
    if (due.length) {
      pendingImpacts = pendingImpacts.filter((pi) => now < pi.resolveAt);
      for (const pi of due) {
        const attacker = players.get(pi.attackerId);
        if (!attacker) continue; // disconnected before their projectile landed
        resolveAbilityEffect(pi.attackerId, attacker, pi.ability, pi.targetId, pi.casterPosition, pi.casterFacingAngle);
      }
    }
  }

  // Resume any event script parked on a `wait` command whose delay has
  // elapsed — same "systems that need to resume later register themselves
  // and get swept every tick" idiom as pendingImpacts above.
  for (const [socketId, cursor] of activeEventRuns.entries()) {
    if (cursor.waitUntil === 0 || now < cursor.waitUntil) continue;
    const player = players.get(socketId);
    const eventDef = eventById(cursor.eventId);
    if (!player || !eventDef) { activeEventRuns.delete(socketId); continue; }
    runEventStep(io.sockets.sockets.get(socketId), player, cursor, eventDef, now);
  }

  // Flips a scheduleRespawn'd event object (a gathering node/crafting
  // station hidden via setVisible) back to visible once its timer elapses.
  // Deliberately its own sweep over eventObjectState rather than folded into
  // the activeEventRuns loop above — that Map is per-player and is deleted
  // outright on disconnect, so a respawn timer living inside a player's own
  // script cursor would never fire if that player logged off right after
  // triggering it. This sweep depends on no player at all.
  for (const [eventId, state] of eventObjectState.entries()) {
    if (state.respawnAt > 0 && now >= state.respawnAt) {
      state.visible = true;
      state.respawnAt = 0;
      io.emit('event-object-visibility', { eventId, visible: true });
    }
  }

  const overworldSnapshot = [];
  const storeSnapshot = [];
  /** @type {Map<number, Array>} */
  const floorSnapshots = new Map();
  /** @type {Map<string, Array>} */
  const mapSnapshots = new Map();
  /** @type {Map<string, Array>} instanceId -> playerSnapshot[] */
  const dungeonSnapshots = new Map();

  for (const [id, player] of players.entries()) {
    respawnIfReady(id, player);

    // Status effects (stun/freeze/sleep/slow/dot/hot/buff/shield) tick every
    // player every server tick, regardless of which movement branch below
    // applies — expiry + DoT/HoT damage/heal shouldn't pause just because a
    // player is in a store or a dungeon instance.
    {
      const { statusEffects, events } = tickStatusEffects(player.statusEffects, now);
      player.statusEffects = statusEffects;
      for (const ev of events) {
        if (ev.type === 'dot') player.health = Math.max(0, player.health - ev.amount);
        else if (ev.type === 'hot') player.health = Math.min(player.maxHealth, player.health + ev.amount);
      }
    }
    // Stunned/frozen/asleep: input is ignored entirely (no movement, no
    // jump) rather than threading a "can't act" flag through stepMovement
    // itself. Slowed: same input, reduced speed (jump/gravity unaffected).
    const playerCCd = isCCd(player.statusEffects, now);
    const effectiveInput = playerCCd ? { moveX: 0, moveZ: 0, jump: false } : player.input;
    const speedMultiplier = getMoveSpeedMultiplier(player.statusEffects, now);

    // Pending cast (castMs hasn't elapsed yet — see the 'use-ability'
    // handler): cancelled with no refund if a fresh CC lands, or if the
    // skill doesn't allow moving during its cast and the player provided
    // ANY movement/jump input this tick (checked against raw player.input,
    // not effectiveInput — the intent to move is what breaks a hard cast,
    // whether or not it actually displaces the player this instant).
    const pendingCast = pendingCasts.get(id);
    if (pendingCast) {
      const triedToMove = player.input.moveX !== 0 || player.input.moveZ !== 0 || player.input.jump;
      if (playerCCd || (!pendingCast.skill.canMoveDuringCast && triedToMove)) {
        pendingCasts.delete(id);
        io.sockets.sockets.get(id)?.emit('cast-interrupted', { abilityId: pendingCast.ability.id });
      } else if (now >= pendingCast.resolveAt) {
        pendingCasts.delete(id);
        // Cast bar's done — but if this skill's travel/impact timing runs
        // longer than castMs, the hit itself still waits for the remainder
        // (see pendingImpacts' doc comment), rather than landing the instant
        // the bar fills while the projectile is still visually mid-flight.
        const extraDelay = pendingCast.impactDelayMs - (pendingCast.skill.castMs || 0);
        if (extraDelay > 0) {
          pendingImpacts.push({
            resolveAt: now + extraDelay,
            attackerId: id, ability: pendingCast.ability, targetId: pendingCast.targetId,
            casterPosition: pendingCast.startPosition, casterFacingAngle: pendingCast.startFacingAngle,
          });
        } else {
          resolveAbilityEffect(id, player, pendingCast.ability, pendingCast.targetId, pendingCast.startPosition, pendingCast.startFacingAngle);
        }
      }
    }

    // A dungeon instance gets its own bucket (keyed by instanceId, not
    // mapId — several separate instances can share the same dungeon map)
    // so its monster AI and broadcast stay isolated per party/solo run,
    // checked before the plain-map branch below since a dungeon player has
    // BOTH mapId and dungeonInstanceId set.
    if (player.dungeonInstanceId) {
      const mapEntry = maps.get(player.mapId);
      const bounds = mapEntry?.world.bounds;
      if (bounds && !player.isDead) {
        player.position = stepMovement(player.position, effectiveInput, moveDt, bounds, getMapCollision(player.mapId), groundHeightFnFor(mapEntry.world), speedMultiplier);
      }
      if (player.abilityState) player.abilityState = tickResourceRegen(player.abilityState, DT);
      tickPlayerHpRegen(player, DT);
      const snapshotEntry = { id, position: player.position, health: player.health, maxHealth: player.maxHealth, isDead: player.isDead, statusEffects: player.statusEffects, seq: player.input?.seq ?? 0 };
      if (!dungeonSnapshots.has(player.dungeonInstanceId)) dungeonSnapshots.set(player.dungeonInstanceId, []);
      dungeonSnapshots.get(player.dungeonInstanceId).push(snapshotEntry);
      continue;
    }

    // A player on a new-system map (via a teleporter) is handled entirely
    // separately from the legacy inStore/currentFloor branching below —
    // its own bounds/collision, its own snapshot bucket, broadcast to its
    // own `map-${id}` room further down.
    if (player.mapId) {
      const mapEntry = maps.get(player.mapId);
      const bounds = mapEntry?.world.bounds;
      if (bounds && !player.isDead) {
        player.position = stepMovement(player.position, effectiveInput, moveDt, bounds, getMapCollision(player.mapId), groundHeightFnFor(mapEntry.world), speedMultiplier);
      }
      if (player.abilityState) player.abilityState = tickResourceRegen(player.abilityState, DT);
      tickPlayerHpRegen(player, DT);
      const snapshotEntry = { id, position: player.position, health: player.health, maxHealth: player.maxHealth, isDead: player.isDead, statusEffects: player.statusEffects, seq: player.input?.seq ?? 0 };
      if (!mapSnapshots.has(player.mapId)) mapSnapshots.set(player.mapId, []);
      mapSnapshots.get(player.mapId).push(snapshotEntry);
      continue;
    }

    // Same object doubles as the bounds source and (when it has one) the
    // terrain source — a tower floor/store interior has no `.terrain` field,
    // so sampleTerrainHeight just returns flat ground (0) for those, same as
    // the pre-jump behavior.
    const terrainWorld = player.inStore
      ? STORE_INTERIOR
      : player.currentFloor === 0
        ? world
        : towerFloors.get(player.currentFloor)?.def;
    const bounds = terrainWorld?.bounds;
    // Only the overworld has static colliders; a tower floor or the store
    // interior is a bare room, so those pass none and move freely.
    const playerCollision = !player.inStore && player.currentFloor === 0 ? collision : null;
    if (bounds && !player.isDead) {
      player.position = stepMovement(player.position, effectiveInput, moveDt, bounds, playerCollision, groundHeightFnFor(terrainWorld), speedMultiplier);
    }

    // Server-side "enter area" event trigger (v1: overworld only, same scope
    // as quests/NPCs today). isPointInZone already exists purely for the
    // client's music-crossfade zone lookup (src/render/zoneAudio.js) — this
    // reuses that same pure function at a new, authoritative call site, edge
    // -triggering only on a fresh true-containment so standing inside a zone
    // doesn't refire its event every tick.
    if (player.currentFloor === 0 && !player.inStore && !player.isDead) {
      let membership = playerZoneMembership.get(id);
      if (!membership) { membership = new Set(); playerZoneMembership.set(id, membership); }
      for (const zone of world.zones || []) {
        const inside = isPointInZone(zone, player.position.x, player.position.z);
        const wasInside = membership.has(zone.id);
        if (inside && !wasInside) {
          membership.add(zone.id);
          if (!activeEventRuns.has(id)) {
            const eventDef = overworldEvents.find((e) => e.start.type === 'enterArea' && e.start.zoneId === zone.id);
            const state = eventDef && eventObjectState.get(eventDef.id);
            if (eventDef && state?.visible) {
              const cursor = startEventScript(eventDef, buildEventCtx(player, eventDef));
              if (cursor) {
                activeEventRuns.set(id, cursor);
                runEventStep(io.sockets.sockets.get(id), player, cursor, eventDef, now);
              }
            }
          }
        } else if (!inside && wasInside) {
          membership.delete(zone.id);
        }
      }
    }

    if (player.abilityState) {
      player.abilityState = tickResourceRegen(player.abilityState, DT);
    }
    tickPlayerHpRegen(player, DT);

    // `seq` is the input ordinal this tick's movement actually integrated — the
    // ack half of client-side prediction, read here rather than in the 'input'
    // handler because what the client needs is which input the broadcast POSITION
    // accounts for, not merely which one arrived most recently.
    const snapshotEntry = { id, position: player.position, health: player.health, maxHealth: player.maxHealth, isDead: player.isDead, statusEffects: player.statusEffects, seq: player.input?.seq ?? 0 };
    if (player.inStore) {
      storeSnapshot.push(snapshotEntry);
    } else if (player.currentFloor === 0) {
      overworldSnapshot.push(snapshotEntry);
    } else {
      if (!floorSnapshots.has(player.currentFloor)) floorSnapshots.set(player.currentFloor, []);
      floorSnapshots.get(player.currentFloor).push(snapshotEntry);
    }
  }

  // Overworld monster AI: same chase/attack logic as tower floors, against
  // every player currently in the overworld — the overworld isn't
  // room-scoped, so this runs against the whole overworldSnapshot rather
  // than a per-floor subset.
  const overworldAiPlayers = overworldSnapshot.map((p) => ({ id: p.id, position: p.position, isDead: p.isDead }));
  for (let i = 0; i < overworldMonsters.length; i++) {
    const m = overworldMonsters[i];
    if (m.health <= 0) {
      // Overworld monsters respawn (unlike tower floor monsters — a floor
      // staying cleared is the intended dungeon mechanic). deadAt is set once
      // on death; once respawnMs elapses, reset to full health at home.
      if (m.deadAt == null) m.deadAt = now;
      else if (now - m.deadAt >= (m.respawnMs ?? DEFAULT_MONSTER_RESPAWN_MS)) {
        m.health = m.maxHealth;
        m.position = { ...m.spawnPosition };
        m.aggroTargetId = null;
        m.wanderTarget = null; // respawned at home; a target picked before it died is stale
        m.deadAt = null;
      }
      continue;
    }
    tickMonsterStatusEffects(m, now);
    const { attackEvent, ...nextState } = stepMonsterAI(m, overworldAiPlayers, DT, now, collision, rng);
    overworldMonsters[i] = nextState;
    if (attackEvent) {
      applyDamageToPlayer(attackEvent.targetId, attackEvent.damage);
      // For client-side VFX only (src/main.js looks up the full ability def
      // by id from the monster's type catalog entry) — mirrors 'ability-used'
      // for players. Harmless no-op for legacy monsters' synthesized
      // {id:'attack',...} ability: no catalog entry exists for it, so the
      // client just won't find an ability def and skips the burst.
      io.emit('monster-ability-used', { monsterId: m.id, abilityId: attackEvent.abilityId });
    }
  }

  // Town NPCs just mill about — no target/combat, so they tick regardless of
  // who's watching. The broadcast payload is deliberately minimal (id +
  // position): the client already has each NPC's name/appearance/dialog from
  // the static world.npcs it got in `welcome`, keyed by id.
  for (const npc of overworldNpcs) stepNpcWander(npc, DT, now, rng, collision);
  const npcSnapshot = overworldNpcs.map((n) => ({ id: n.id, position: n.position }));

  if (overworldSnapshot.length > 0) {
    // Only players actually in the default overworld care about this — it has no
    // dedicated room (see movePlayerToMap), so target sockets individually from the
    // snapshot we already built rather than io.emit()'ing to store/tower/map/dungeon
    // players who'd otherwise get (and discard) this every tick for nothing.
    const statePayload = { t: now, players: overworldSnapshot, monsters: overworldMonsters, npcs: npcSnapshot };
    for (const p of overworldSnapshot) {
      io.sockets.sockets.get(p.id)?.emit('state', statePayload);
    }
  }
  if (storeSnapshot.length > 0) {
    io.to('store').emit('store-state', { t: now, players: storeSnapshot });
  }

  for (const [floorNumber, playersOnFloor] of floorSnapshots.entries()) {
    const floor = towerFloors.get(floorNumber);

    // Monster AI: chase/attack the nearest living player on this floor.
    const aiPlayers = playersOnFloor.map((p) => ({ id: p.id, position: p.position, isDead: p.isDead }));
    for (let i = 0; i < floor.monsters.length; i++) {
      if (floor.monsters[i].health > 0) tickMonsterStatusEffects(floor.monsters[i], now);
      const { attackEvent, ...nextState } = stepMonsterAI(floor.monsters[i], aiPlayers, DT, now, null, rng);
      floor.monsters[i] = nextState;
      if (attackEvent) {
        applyDamageToPlayer(attackEvent.targetId, attackEvent.damage);
        io.to(`floor-${floorNumber}`).emit('monster-ability-used', { monsterId: floor.monsters[i].id, abilityId: attackEvent.abilityId });
      }
    }

    io.to(`floor-${floorNumber}`).emit('floor-state', {
      t: now,
      floorNumber,
      players: playersOnFloor,
      monsters: floor.monsters,
    });
  }

  // New-system maps (via teleporters) — no monster AI here yet (dungeon
  // instancing + live monster state per-instance is Phase 4); this is
  // purely movement sync for now, same shape as the other *-state events.
  for (const [mapId, playersOnMap] of mapSnapshots.entries()) {
    io.to(`map-${mapId}`).emit('map-state', { t: now, mapId, players: playersOnMap });
  }

  // Dungeon instances: same chase/attack AI as a tower floor, but against
  // only the party/solo player(s) actually inside THIS instance, and
  // broadcast to this instance's own room — never the whole `map-${mapId}`
  // room, which for a dungeon map doesn't correspond to any single live
  // room at all (every instance of it has its own).
  for (const [instanceId, playersInInstance] of dungeonSnapshots.entries()) {
    const inst = dungeonInstances.get(instanceId);
    if (!inst) continue;
    const room = `dungeon-${inst.mapId}-${instanceId}`;
    const aiPlayers = playersInInstance.map((p) => ({ id: p.id, position: p.position, isDead: p.isDead }));
    for (let i = 0; i < inst.monsters.length; i++) {
      if (inst.monsters[i].health > 0) tickMonsterStatusEffects(inst.monsters[i], now);
      const { attackEvent, ...nextState } = stepMonsterAI(inst.monsters[i], aiPlayers, DT, now, null, rng);
      inst.monsters[i] = nextState;
      if (attackEvent) {
        applyDamageToPlayer(attackEvent.targetId, attackEvent.damage);
        io.to(room).emit('monster-ability-used', { monsterId: inst.monsters[i].id, abilityId: attackEvent.abilityId });
      }
    }
    io.to(room).emit('map-state', { t: now, mapId: inst.mapId, players: playersInInstance, monsters: inst.monsters });
  }
}, TICK_BUDGET_MS);

// Node's default on an unhandled rejection (and, since v15, some uncaught
// exceptions) is to KILL THE PROCESS. On a dev server with no auto-restart
// (see CLAUDE.md — there's no nodemon here) that turns one stray async error
// deep in a tick into a dead server, and every subsequent World Editor action
// then fails with a bare "Failed to fetch" that says nothing about the real
// cause, several minutes and several clicks after the fact.
//
// Logging loudly and staying up is the right trade for a local authoring
// server: the editor keeps working, and the actual error is on screen instead
// of being the last line before an exit. This is NOT a licence to ignore what
// gets logged here — anything that reaches this handler is a real bug.
process.on('unhandledRejection', (err) => {
  console.error('\n[UNHANDLED REJECTION] The server survived this, but it IS a bug:\n', err);
});
process.on('uncaughtException', (err) => {
  console.error('\n[UNCAUGHT EXCEPTION] The server survived this, but it IS a bug:\n', err);
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Fantasy MMO server (authoritative) listening on http://localhost:${PORT}`);
});
