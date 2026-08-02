// src/sim/world.js
// Loads the fixed, hand-authored world JSON. Shared shape used by sim, render,
// and the (future) World Editor. No DOM/rendering dependencies here.
import { validateMonsterSpawns } from './tower.js';
import { validateNpcs } from './npc.js';
import { validatePaths } from './paths.js';
import { validateBarriers } from './barriers.js';
import { validateMountains } from './mountains.js';
import { validateGroundTextureLayers } from './groundTextures.js';
import { validateZones, isPointInPolygon } from './zones.js';
import { validateWaterBodies, nearestPointOnPolyline, sampleRiverSurfaceLevel } from './waterBodies.js';
import { validateTeleporters } from './teleporters.js';
import { MAP_TYPES } from './maps.js';
import { validateGraphicsSettings } from './graphicsSettings.js';
import { validateEventObjects } from './events.js';
import { validateParticleEmitters } from './particleEmitters.js';
import { validateLightSources } from './lightSources.js';

/**
 * @typedef {Object} IWorld
 * @property {string} id
 * @property {string} name
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @property {{x:number,y:number,z:number,facingDeg?:number}} spawnPoint where a
 *   player arrives on this map, and (optionally) which way they're turned when
 *   they get there. `facingDeg` is degrees in the same convention NPC
 *   `facingDeg` and the movement code's `rotation.y = atan2(moveX, moveZ)` use:
 *   0 = looking down +Z, 90 = +X. Absent on a map authored before spawn facing
 *   existed = 0, which is the old behavior. The server turns it into radians
 *   and ships it as `facing` on 'welcome'/'map-entered' (see spawnFacingOf in
 *   server/index.js); the client also swings the orbit camera behind the
 *   player to match (applySpawnFacing in src/main.js).
 * @property {Array<Object>} zones
 * @property {Array<Object>} buildings
 * @property {Array<Object>} props
 * @property {Array<Object>} [monsters] optional overworld monster spawns —
 *   same MonsterSpawnDef shape as tower floors (see src/sim/tower.js);
 *   monsters are no longer tower-exclusive.
 * @property {Array<Object>} [npcs] optional wandering town NPCs (see src/sim/npc.js).
 * @property {Array<Object>} [paths] optional drawn pathways/roads (see src/sim/paths.js).
 * @property {Array<Object>} [barriers] optional invisible walls (see src/sim/barriers.js) — block movement, render nothing.
 * @property {Array<Object>} [mountains] optional drawn mountain ridges (see src/sim/mountains.js) — raise terrain.heights on save, then render as an opaque rock-textured ribbon.
 * @property {{leafDensity?: number}} [treeSettings] optional world-wide render tuning — leafDensity is a multiplier on ez-tree's round-canopy branch/leaf counts (see src/generators/environment/ezTree.js), editable live via the World Editor's Scatter mode slider.
 * @property {Array<Object>} [groundTextures] optional painted ground-texture layers (see src/sim/groundTextures.js).
 * @property {{resolution:number, heights:number[]}} [terrain] optional heightmap
 *   painted in the World Editor. `resolution` is the grid cell count per side;
 *   `heights` is a flat (resolution+1)^2 array of Y offsets, row-major from
 *   -Z,-X to +Z,+X across `bounds`. Absent = flat ground (Phase 1 behavior).
 * @property {'overworld'|'building'|'dungeon'} [mapType] which of the three
 *   map categories this document is (see src/sim/maps.js) — absent is
 *   treated as 'overworld' for backward compatibility with worlds saved
 *   before multi-map support existed.
 * @property {string} [linkedOverworldMapId] building maps only — the
 *   overworld (or other) map this building's exterior is placed in.
 * @property {string} [linkedBuildingMapId] the inverse of the above, set on
 *   a `buildings[]` entry in the map that CONTAINS the building shell — not
 *   a top-level field, noted here for discoverability.
 * @property {number} [autoCloseMinutes] dungeon maps only — how long a live
 *   instance of this map stays open with no activity before auto-closing.
 * @property {Array<Object>} [teleporters] optional placed teleporters (see
 *   src/sim/teleporters.js) — the one generalized primitive for building
 *   entrances/exits and dungeon entrances/exit-gates, not just plain
 *   same-map jumps.
 * @property {Array<Object>} [events] optional Event Objects (see
 *   src/sim/events.js) — talk/interact/enterArea/switchOn-triggered command
 *   scripts, either attached to an existing npc/prop/teleporter/gathering
 *   node via attachedType+attachedId, or a standalone invisible trigger.
 * @property {Array<Object>} [waterBodies] optional discrete water bodies —
 *   lakes/puddles (closed polygon + flat surfaceLevel) and rivers (open
 *   polyline + sloped surfaceHeights), see src/sim/waterBodies.js. Replaces
 *   the older single world-wide `waterMask` bitmap (still supported below
 *   for backward compatibility with maps not yet migrated).
 * @property {Array<Object>} [particleEmitters] optional particle effects
 *   placed directly into the world from the World Editor's Particles mode
 *   (campfires, glitter, tornadoes, mist) — see src/sim/particleEmitters.js
 *   for the schema and src/render/worldParticles.js for the runtime that
 *   streams them in and out around the camera.
 * @property {Array<Object>} [lights] optional placed point/spot light sources
 *   from the World Editor's Lights mode (torches, braziers, lanterns, a shaft
 *   of daylight through a cell grate) — see src/sim/lightSources.js for the
 *   schema and src/render/worldLights.js for the pooled runtime. The one way
 *   to light an enclosed space: the map-wide directional light + hemisphere
 *   ambient in graphicsSettings has no notion of "indoors".
 * @property {Object} [graphicsSettings] optional per-map graphics profile
 *   (see src/sim/graphicsSettings.js) — post-processing, light/fog/ambient,
 *   default outside-zone audio, environmental effects, anisotropy. Absent
 *   on an old map is normalized to defaultGraphicsSettings() by whoever
 *   loads it (editor's applyLoadedWorldDoc, server's map loading) rather
 *   than validated as a hard requirement here.
 */

/**
 * Basic structural validation so a malformed world JSON fails loudly
 * instead of corrupting sim state silently.
 * @param {any} data
 * @returns {IWorld}
 */
export function parseWorld(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('World data must be an object');
  }
  const required = ['id', 'name', 'bounds', 'spawnPoint', 'zones', 'buildings', 'props'];
  for (const key of required) {
    if (!(key in data)) {
      throw new Error(`World data missing required field: "${key}"`);
    }
  }
  const { bounds } = data;
  for (const k of ['minX', 'maxX', 'minZ', 'maxZ']) {
    if (typeof bounds[k] !== 'number') {
      throw new Error(`World bounds missing numeric field: "${k}"`);
    }
  }

  validateZones(data.zones);

  if (data.terrain !== undefined) {
    const { resolution, heights } = data.terrain;
    if (typeof resolution !== 'number' || resolution < 1) {
      throw new Error('World terrain.resolution must be a positive number');
    }
    const expected = (resolution + 1) * (resolution + 1);
    if (!Array.isArray(heights) || heights.length !== expected) {
      throw new Error(
        `World terrain.heights must be an array of length ${expected} (got ${heights?.length})`
      );
    }
  }

  if (data.gatheringNodes !== undefined) {
    if (!Array.isArray(data.gatheringNodes)) {
      throw new Error('World gatheringNodes must be an array');
    }
    for (const n of data.gatheringNodes) {
      for (const key of ['id', 'zoneId', 'nodeType', 'position']) {
        if (!(key in n)) throw new Error(`Gathering node missing required field: "${key}" (id: ${n.id || '?'})`);
      }
      if (n.group !== undefined && typeof n.group !== 'string') {
        throw new Error(`Gathering node "${n.id}" group must be a string`);
      }
    }
  }

  if (data.monsters !== undefined) {
    validateMonsterSpawns(data.monsters, 'World');
  }

  if (data.npcs !== undefined) {
    validateNpcs(data.npcs);
  }

  if (data.waterMask !== undefined) {
    const { resolution, cells, level } = data.waterMask;
    if (typeof resolution !== 'number' || resolution < 1) {
      throw new Error('World waterMask.resolution must be a positive number');
    }
    const expected = (resolution + 1) * (resolution + 1);
    if (!Array.isArray(cells) || cells.length !== expected) {
      throw new Error(`World waterMask.cells must be an array of length ${expected} (got ${cells?.length})`);
    }
    if (typeof level !== 'number') {
      throw new Error('World waterMask.level (the flat water surface height) must be a number');
    }
  }

  if (data.waterBodies !== undefined) {
    validateWaterBodies(data.waterBodies);
  }

  if (data.paths !== undefined) {
    validatePaths(data.paths);
  }

  if (data.barriers !== undefined) {
    validateBarriers(data.barriers);
  }

  if (data.mountains !== undefined) {
    validateMountains(data.mountains);
  }

  if (data.groundTextures !== undefined) {
    validateGroundTextureLayers(data.groundTextures);
  }

  if (data.treeSettings !== undefined) {
    if (typeof data.treeSettings !== 'object' || data.treeSettings === null) {
      throw new Error('World treeSettings must be an object');
    }
    if (data.treeSettings.leafDensity !== undefined && typeof data.treeSettings.leafDensity !== 'number') {
      throw new Error('World treeSettings.leafDensity must be a number');
    }
  }

  if (data.mapType !== undefined && !MAP_TYPES.includes(data.mapType)) {
    throw new Error(`World mapType must be one of ${MAP_TYPES.join(', ')} (got "${data.mapType}")`);
  }

  if (data.linkedOverworldMapId !== undefined && typeof data.linkedOverworldMapId !== 'string') {
    throw new Error('World linkedOverworldMapId must be a string');
  }

  if (data.autoCloseMinutes !== undefined && (typeof data.autoCloseMinutes !== 'number' || data.autoCloseMinutes <= 0)) {
    throw new Error('World autoCloseMinutes must be a positive number');
  }

  if (data.teleporters !== undefined) {
    validateTeleporters(data.teleporters);
  }

  if (data.graphicsSettings !== undefined) {
    validateGraphicsSettings(data.graphicsSettings);
  }

  if (data.particleEmitters !== undefined) {
    validateParticleEmitters(data.particleEmitters);
  }

  if (data.lights !== undefined) {
    validateLightSources(data.lights);
  }

  if (data.events !== undefined) {
    // Props have no stable `id` field in general (see src/editor/main.js's
    // placement code) — only ones the editor has explicitly attached an
    // event to gain one, so propIds only covers those, not every prop.
    validateEventObjects(data.events, {
      npcIds: new Set((data.npcs || []).map((n) => n.id)),
      propIds: new Set((data.props || []).filter((p) => p.id).map((p) => p.id)),
      teleporterIds: new Set((data.teleporters || []).map((t) => t.id)),
      gatheringNodeIds: new Set((data.gatheringNodes || []).map((n) => n.id)),
    });
  }

  return data;
}

/** Sample the terrain heightmap at a world-space (x, z) via bilinear interpolation. Returns 0 if no heightmap is present. */
export function sampleTerrainHeight(world, x, z) {
  if (!world.terrain) return 0;
  const { bounds } = world;
  const { resolution, heights } = world.terrain;

  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const gx = clamp01(u) * resolution;
  const gz = clamp01(v) * resolution;

  const x0 = Math.floor(gx), x1 = Math.min(resolution, x0 + 1);
  const z0 = Math.floor(gz), z1 = Math.min(resolution, z0 + 1);
  const tx = gx - x0, tz = gz - z0;

  const h00 = heights[z0 * (resolution + 1) + x0];
  const h10 = heights[z0 * (resolution + 1) + x1];
  const h01 = heights[z1 * (resolution + 1) + x0];
  const h11 = heights[z1 * (resolution + 1) + x1];

  const hTop = h00 + (h10 - h00) * tx;
  const hBot = h01 + (h11 - h01) * tx;
  return hTop + (hBot - hTop) * tz;
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

/** Sample the water mask at a world-space (x, z) via bilinear interpolation. Returns 0 (no water) if no mask is present. Value is 0..1 — how "watery" that point is, for soft edges. */
export function sampleWaterMask(world, x, z) {
  if (!world.waterMask) return 0;
  const { bounds } = world;
  const { resolution, cells } = world.waterMask;

  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const gx = clamp01(u) * resolution;
  const gz = clamp01(v) * resolution;

  const x0 = Math.floor(gx), x1 = Math.min(resolution, x0 + 1);
  const z0 = Math.floor(gz), z1 = Math.min(resolution, z0 + 1);
  const tx = gx - x0, tz = gz - z0;

  const c00 = cells[z0 * (resolution + 1) + x0];
  const c10 = cells[z0 * (resolution + 1) + x1];
  const c01 = cells[z1 * (resolution + 1) + x0];
  const c11 = cells[z1 * (resolution + 1) + x1];

  const cTop = c00 + (c10 - c00) * tx;
  const cBot = c01 + (c11 - c01) * tx;
  return cTop + (cBot - cTop) * tz;
}

/**
 * Finds which discrete `world.waterBodies` entry (if any) contains
 * world-space (x, z), and reports its real depth there — the vertical gap
 * between the water's own surface and the terrain underneath it, not a
 * proxy derived from paint alpha the way `sampleWaterMask` is. This is the
 * one query both the future per-body renderer and the swim-physics hook in
 * `src/sim/movement.js` will call, so client and server never disagree
 * about whether a given point counts as "in water."
 * @returns {{body: Object, level: number, depth: number} | null}
 */
export function sampleWaterBody(world, x, z) {
  if (!Array.isArray(world.waterBodies)) return null;
  for (const body of world.waterBodies) {
    let level;
    if (body.kind === 'river') {
      const nearest = nearestPointOnPolyline(body.points, x, z);
      if (nearest.distance > body.width / 2) continue;
      level = sampleRiverSurfaceLevel(body, nearest.segmentIndex, nearest.t);
    } else {
      if (!isPointInPolygon(body.points, x, z)) continue;
      level = body.surfaceLevel;
    }
    return { body, level, depth: level - sampleTerrainHeight(world, x, z) };
  }
  return null;
}

