// src/sim/barriers.js
// Invisible walls (World Editor "Terrain" mode -> Invisible Wall tool). A
// barrier is an ordered polyline of ground points plus a thickness: players
// can't cross it, and nothing renders it in the live game. Drawn exactly like
// a path (src/sim/paths.js), which is the point — it's the tool you reach for
// to fence off a map edge, a cliff, or an unfinished area.
//
// The collider itself is built in src/sim/collision.js, reusing the swept
// polyline shape rivers used to use. No DOM/rendering dependencies here —
// same rule as every other src/sim file.

export const DEFAULT_BARRIER_THICKNESS = 1;

/**
 * @typedef {Object} BarrierDef
 * @property {string} id
 * @property {Array<{x:number,z:number}>} points
 * @property {number} [thickness]  how wide the wall is, world units (default 1)
 */

/** @param {any} barriers @returns {void} throws on malformed data. */
export function validateBarriers(barriers) {
  if (!Array.isArray(barriers)) {
    throw new Error('World barriers must be an array');
  }
  const ids = new Set();
  for (const b of barriers) {
    if (!b || typeof b !== 'object') throw new Error('Each barrier must be an object');
    for (const key of ['id', 'points']) {
      if (!(key in b)) {
        throw new Error(`Barrier missing required field: "${key}" (id: ${b.id || '?'})`);
      }
    }
    if (ids.has(b.id)) {
      throw new Error(`Duplicate barrier id: "${b.id}"`);
    }
    ids.add(b.id);
    // Two points is the minimum that describes a wall at all; a one-point
    // "barrier" would silently block nothing, which is worse than refusing it.
    if (!Array.isArray(b.points) || b.points.length < 2) {
      throw new Error(`Barrier "${b.id}" needs at least 2 points`);
    }
    for (const pt of b.points) {
      if (typeof pt.x !== 'number' || typeof pt.z !== 'number') {
        throw new Error(`Barrier "${b.id}" has a non-numeric point`);
      }
    }
    if (b.thickness !== undefined && (typeof b.thickness !== 'number' || b.thickness <= 0)) {
      throw new Error(`Barrier "${b.id}" thickness must be a positive number`);
    }
  }
}
