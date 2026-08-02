// src/sim/zones.js
// Zone containment + validation. Two shapes share the same world.zones[]
// array: 'circle' (the original — city/tower/gathering zones, untouched by
// this file's addition) and 'polygon' (new — freeform-drawn zones with
// optional music/ambientSound/particleType, authored via the World Editor's
// Freeform Zones tool). No DOM/rendering dependencies here — same rule as
// every other src/sim file.
import { PARTICLE_TYPES } from './groundTextures.js';

export const ZONE_SHAPES = ['circle', 'polygon'];

/**
 * @typedef {Object} ZoneDef
 * @property {string} id
 * @property {string} [name]
 * @property {'circle'|'polygon'} [shape] defaults to 'circle' for back-compat with existing world.json data
 * @property {string} [type] 'gathering'|'city'|'tower' — circle zones only, unrelated to the polygon addition
 * @property {{x:number,y:number,z:number}} [center] circle zones
 * @property {number} [radius] circle zones
 * @property {Array<{x:number,z:number}>} [points] polygon zones, world-space, closed implicitly (no repeated last point)
 * @property {{musicId:string, volume?:number, loop?:boolean}} [music] loop defaults to true
 * @property {{soundId:string, volume?:number}} [ambientSound]
 * @property {string} [particleType] one of groundTextures.js's PARTICLE_TYPES
 */

const isObj = (v) => v && typeof v === 'object';

function validateAudioRef(ref, label, field) {
  if (ref === undefined || ref === null) return;
  if (!isObj(ref)) throw new Error(`${label} ${field} must be an object`);
  if (typeof ref.musicId !== 'string' && typeof ref.soundId !== 'string') {
    throw new Error(`${label} ${field} must have a musicId or soundId string`);
  }
  if (ref.volume !== undefined && (typeof ref.volume !== 'number' || ref.volume < 0 || ref.volume > 1)) {
    throw new Error(`${label} ${field} volume must be a number between 0 and 1`);
  }
  if (ref.loop !== undefined && typeof ref.loop !== 'boolean') {
    throw new Error(`${label} ${field} loop must be a boolean`);
  }
}

/** @param {any} zones @returns {void} throws on malformed data. */
export function validateZones(zones) {
  if (!Array.isArray(zones)) {
    throw new Error('World zones must be an array');
  }
  const ids = new Set();
  for (const z of zones) {
    if (!isObj(z)) throw new Error('Each zone must be an object');
    if (!z.id) throw new Error('Zone missing required field: "id"');
    if (ids.has(z.id)) throw new Error(`Duplicate zone id: "${z.id}"`);
    ids.add(z.id);

    const shape = z.shape ?? 'circle';
    if (!ZONE_SHAPES.includes(shape)) {
      throw new Error(`Zone "${z.id}" has unknown shape "${shape}"`);
    }
    const label = `Zone "${z.id}"`;

    if (shape === 'circle') {
      if (!isObj(z.center) || typeof z.center.x !== 'number' || typeof z.center.z !== 'number') {
        throw new Error(`${label} (circle) missing numeric center.x/center.z`);
      }
      if (typeof z.radius !== 'number' && typeof z.footprintRadius !== 'number') {
        throw new Error(`${label} (circle) needs a numeric radius`);
      }
    } else {
      if (!Array.isArray(z.points) || z.points.length < 3) {
        throw new Error(`${label} (polygon) needs at least 3 points`);
      }
      for (const pt of z.points) {
        if (typeof pt.x !== 'number' || typeof pt.z !== 'number') {
          throw new Error(`${label} has a non-numeric point`);
        }
      }
    }

    validateAudioRef(z.music, label, 'music');
    validateAudioRef(z.ambientSound, label, 'ambientSound');
    if (z.particleType !== undefined && z.particleType !== null && !PARTICLE_TYPES.includes(z.particleType)) {
      throw new Error(`${label} has unknown particleType "${z.particleType}"`);
    }
  }
}

/** Ray-casting point-in-polygon (odd-crossings test). Points define a closed loop; the last-to-first edge is implicit. Exported for reuse by src/sim/waterBodies.js (lake/puddle containment — same closed-polygon shape as a polygon zone). */
export function isPointInPolygon(points, x, z) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, zi = points[i].z;
    const xj = points[j].x, zj = points[j].z;
    const intersects = zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Whether world-space (x, z) falls inside a zone, regardless of its shape. */
export function isPointInZone(zone, x, z) {
  if ((zone.shape ?? 'circle') === 'circle') {
    const r = zone.radius ?? zone.footprintRadius ?? 0;
    return Math.hypot(x - zone.center.x, z - zone.center.z) <= r;
  }
  return isPointInPolygon(zone.points, x, z);
}

/** World-space axis-aligned bounding box of a zone, regardless of shape — used to seed rejection-sampling for zone particles and to frame the editor camera on a zone. */
export function zoneBounds(zone) {
  if ((zone.shape ?? 'circle') === 'circle') {
    const r = zone.radius ?? zone.footprintRadius ?? 0;
    return {
      minX: zone.center.x - r, maxX: zone.center.x + r,
      minZ: zone.center.z - r, maxZ: zone.center.z + r,
    };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of zone.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}
