// src/sim/mountains.js
// Drawn mountain ridges (World Editor "Mountains" mode). A ridge is an
// ordered polyline of ground points plus a width, a peak height, and a
// visual theme — same shape as src/sim/paths.js's PathDef, drawn the same
// way (click points, Enter to finish). Unlike a path, finishing a ridge
// also raises the terrain heightmap under it (see stampMountainHeight
// below) so the renderer's opaque rock-textured ribbon
// (src/render/mountainMesh.js) sits on real elevated ground instead of a
// flat plane — a decal-style ground-texture paint layer would otherwise
// leave visible gaps of the base ground color wherever the painted mask
// doesn't reach full opacity. No DOM/rendering dependencies here — same
// rule as every other src/sim file.

import { DEFAULT_TERRAIN_WATER_RESOLUTION } from './worldDefaults.js';

export const MOUNTAIN_THEMES = ['rock', 'snow-cap', 'red-rock'];
export const DEFAULT_MOUNTAIN_WIDTH = 20;
export const DEFAULT_PEAK_HEIGHT = 8;

/**
 * @typedef {Object} MountainRidgeDef
 * @property {string} id
 * @property {Array<{x:number,z:number}>} points
 * @property {number} width total footprint width across the ridge
 * @property {number} peakHeight how far above the surrounding terrain the ridge's crest rises
 * @property {string} [theme] one of MOUNTAIN_THEMES; renderer falls back to 'rock'
 */

/** @param {any} mountains @returns {void} throws on malformed data. */
export function validateMountains(mountains) {
  if (!Array.isArray(mountains)) {
    throw new Error('World mountains must be an array');
  }
  const ids = new Set();
  for (const m of mountains) {
    for (const key of ['id', 'points', 'width', 'peakHeight']) {
      if (!(key in m)) {
        throw new Error(`Mountain ridge missing required field: "${key}" (id: ${m.id || '?'})`);
      }
    }
    if (ids.has(m.id)) {
      throw new Error(`Duplicate mountain ridge id: "${m.id}"`);
    }
    ids.add(m.id);
    if (!Array.isArray(m.points) || m.points.length < 2) {
      throw new Error(`Mountain ridge "${m.id}" needs at least 2 points`);
    }
    for (const pt of m.points) {
      if (typeof pt.x !== 'number' || typeof pt.z !== 'number') {
        throw new Error(`Mountain ridge "${m.id}" has a non-numeric point`);
      }
    }
    if (typeof m.width !== 'number' || m.width <= 0) {
      throw new Error(`Mountain ridge "${m.id}" width must be a positive number`);
    }
    if (typeof m.peakHeight !== 'number' || m.peakHeight <= 0) {
      throw new Error(`Mountain ridge "${m.id}" peakHeight must be a positive number`);
    }
    if (m.theme !== undefined && !MOUNTAIN_THEMES.includes(m.theme)) {
      throw new Error(`Mountain ridge "${m.id}" has unknown theme "${m.theme}"`);
    }
  }
}

/** Shortest distance from (px,pz) to the segment (ax,az)-(bx,bz). */
function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cz = az + t * dz;
  return Math.hypot(px - cx, pz - cz);
}

/** Shortest distance from (px,pz) to the whole polyline through `points`. */
function distToPolyline(px, pz, points) {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(px, pz, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Raises `world.terrain.heights` under a ridge's footprint — same peaked
 * falloff + per-vertex jitter as the editor's interactive "mountain preset"
 * terrain brush (so a drawn ridge looks consistent with hand-brushed
 * terrain), but MAX-merged into the heightmap rather than added: an
 * additive stamp per resampled point along a dense stroke would blow the
 * ridge far taller than `peakHeight` wherever consecutive stamps overlap
 * (which is everywhere on a continuous line), whereas max-merging against
 * the true point-to-polyline distance gives a clean, predictable crest at
 * exactly `peakHeight` with no double-counting, and never lowers terrain
 * that was already taller (manual sculpting stays intact).
 *
 * Non-destructive is NOT guaranteed the other way: this only ever raises
 * height, so deleting a ridge afterward does not flatten the terrain back
 * down (same as the terrain brush having no per-stroke undo — "Clear All
 * Terrain" is the only way back to flat).
 * @param {import('./world.js').IWorld} world must have `bounds`
 * @param {MountainRidgeDef} ridge
 */
export function stampMountainHeight(world, ridge) {
  if (!world.terrain) {
    const resolution = DEFAULT_TERRAIN_WATER_RESOLUTION;
    world.terrain = { resolution, heights: new Array((resolution + 1) * (resolution + 1)).fill(0) };
  }
  const { resolution, heights } = world.terrain;
  const { bounds } = world;
  const radius = Math.max(0.5, ridge.width / 2);
  const peak = ridge.peakHeight ?? DEFAULT_PEAK_HEIGHT;

  for (let gz = 0; gz <= resolution; gz++) {
    for (let gx = 0; gx <= resolution; gx++) {
      const wx = bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
      const wz = bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
      const dist = distToPolyline(wx, wz, ridge.points);
      if (dist > radius) continue;
      const falloff = Math.pow(1 - dist / radius, 2.2);
      const jitter = 1 + Math.sin(gx * 12.9898 + gz * 78.233) * 0.15;
      const idx = gz * (resolution + 1) + gx;
      const contribution = peak * falloff * jitter;
      if (contribution > heights[idx]) heights[idx] = contribution;
    }
  }
}
