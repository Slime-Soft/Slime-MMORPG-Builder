// src/sim/collision.js
// Static world collision: build colliders from world.json, index them in a
// spatial grid, and resolve a movement step against them with sliding.
//
// Pure and Three-free (enforced by scripts/check-architecture.mjs), because
// this has to run in two places at once: the server, which is authoritative
// for position, and the client's prediction step. If the two ever disagreed
// the player would visibly stutter against every tree — so both call the
// exact same functions on the exact same colliders.
//
// WHAT YOU SEE IS WHAT YOU COLLIDE WITH. A collider is never a hand-tuned
// guess at a prop's size; it is derived from the same seeded draw the mesh is
// built from (src/sim/propMetrics.js). Change how a tree looks and its
// collider follows automatically.
//
// Scope: the overworld. Tower floors are bare rooms (their JSON has bounds and
// monster spawns, no props) and building interiors are separate hand-built
// instances, so neither has anything to collide with yet. Both simply pass no
// collision index and get the old free-movement behavior.
import { createRng } from './rng.js';
import { sampleTree, sampleRock } from './propMetrics.js';
import { getPropType, treeSilhouette } from './propTypes.js';

/** Half-width of a player's body, in world units. */
export const PLAYER_RADIUS = 0.4;
/** Fallback half-width for a monster with no per-type size. */
export const MONSTER_RADIUS = 0.5;

const DEFAULT_WALL_THICKNESS = 1; // matches generateWallSegment's `options.thickness ?? 1`
const GRID_CELL = 16;
const MAX_BODY_RADIUS = 1.0; // widest mover we index for; see gridFor's padding

/**
 * @typedef {{type:'circle', x:number, z:number, r:number}} CircleCollider
 * @typedef {{type:'obb', x:number, z:number, hw:number, hd:number, rot:number}} ObbCollider
 * @typedef {{type:'polygon', points:Array<{x:number,z:number}>}} PolygonCollider
 * @typedef {{type:'river', points:Array<{x:number,z:number}>, halfWidth:number}} RiverCollider
 * @typedef {CircleCollider | ObbCollider | PolygonCollider | RiverCollider} Collider
 * @typedef {{cells: Map<string, Collider[]>, colliders: Collider[]}} CollisionIndex
 */

// Rotate a local offset by a Three.js rotation.y angle (negate `rot` to invert).
function rotY(lx, lz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

const degToRad = (deg) => ((deg || 0) * Math.PI) / 180;

/**
 * The XZ radius of a Object Builder custom object: the farthest any of its
 * shapes reaches from the object's own origin. Shapes are unit-sized, so a
 * shape's `scale` is its final size (see src/sim/shapeKinds.js).
 */
export function customObjectRadius(objectDef) {
  let radius = 0;
  for (const shape of objectDef.shapes || []) {
    const pos = shape.position || { x: 0, z: 0 };
    const scale = shape.scale || { x: 1, z: 1 };
    const half = Math.max(scale.x ?? 1, scale.z ?? 1) / 2;
    radius = Math.max(radius, Math.hypot(pos.x || 0, pos.z || 0) + half);
  }
  return radius;
}

/**
 * The collision circle for one prop, or null when it doesn't block.
 *
 * Trees collide at the TRUNK, not the canopy — you walk under branches. A
 * tree's own seeded scale applies only when the placement doesn't override it,
 * mirroring `if (prop.scale) mesh.scale.setScalar(prop.scale)` in the renderer.
 *
 * @param {Object} prop
 * @param {Record<string, Object>} objectDefsById  the Object Builder catalog
 * @param {Record<string, Object>} [modelCatalogById]  imported model catalog (FBX/GLB)
 */
export function propCollider(prop, objectDefsById = {}, modelCatalogById = {}) {
  if (!prop) return null;
  const def = getPropType(prop.type);
  if (!def || !def.collider) return null; // decoration (grass, flowers, pebbles) — walk through it

  const { x, z } = prop.position;
  const seed = prop.seed ?? 1;

  switch (def.collider.kind) {
    case 'trunk': {
      // Derived from the same seeded draw the mesh is built from, so changing
      // how a tree looks moves its collider with it.
      const d = sampleTree(createRng(seed), { type: treeSilhouette(prop.type) || 'random' });
      return { type: 'circle', x, z, r: d.trunkRadius * (prop.scale ?? d.scale) };
    }
    case 'rock': {
      // `scale` covers types whose mesh is drawn larger than the seeded base
      // radius (a boulder is 1.9x it) — without it you'd clip into the rock.
      const { baseRadius } = sampleRock(createRng(seed));
      return { type: 'circle', x, z, r: baseRadius * (def.collider.scale ?? 1) * (prop.scale ?? 1) };
    }
    case 'fixed':
      return { type: 'circle', x, z, r: def.collider.radius * (prop.scale ?? 1) };
    case 'custom': {
      const objectDef = objectDefsById[prop.objectId];
      if (!objectDef) return null; // renderer falls back to a rock; don't invent a collider
      const r = customObjectRadius(objectDef) * (prop.scale ?? 1);
      return r > 0 ? { type: 'circle', x, z, r } : null;
    }
    case 'model': {
      // Measured client-side once (see src/generators/modelLoader.js's
      // measureModel), not a guess — but genuinely absent until the World
      // Editor has loaded the model at least once to measure it, in which
      // case there's nothing honest to collide with yet.
      const modelDef = modelCatalogById[prop.modelId];
      const r = (modelDef?.footprintRadius ?? 0) * (prop.scale ?? 1);
      return r > 0 ? { type: 'circle', x, z, r } : null;
    }
    default:
      return null;
  }
}

/**
 * Every static collider in the overworld: props, building footprints, walls.
 * @param {Object} world  a parsed world.json
 * @param {Record<string, Object>} [objectDefsById]
 * @param {Record<string, Object>} [modelCatalogById]
 * @returns {Collider[]}
 */
export function buildWorldColliders(world, objectDefsById = {}, modelCatalogById = {}) {
  const out = [];

  for (const prop of world.props || []) {
    const c = propCollider(prop, objectDefsById, modelCatalogById);
    if (c && c.r > 0) out.push(c);
  }

  // A building is its footprint — the same width/depth the renderer passes to
  // generateBuildingShell. Enterable ones are entered by walking up to the
  // door and pressing E, so a solid shell is correct.
  for (const b of world.buildings || []) {
    if (!b.footprint) continue;
    out.push({
      type: 'obb',
      x: b.position.x,
      z: b.position.z,
      hw: b.footprint.width / 2,
      hd: b.footprint.depth / 2,
      rot: degToRad(b.rotationDeg),
    });
  }

  for (const w of world.walls || []) {
    out.push({
      type: 'obb',
      x: w.position.x,
      z: w.position.z,
      hw: (w.length ?? 6) / 2,
      hd: (w.thickness ?? DEFAULT_WALL_THICKNESS) / 2,
      rot: degToRad(w.rotationDeg),
    });
  }

  // Water does NOT collide. Lakes/rivers were briefly solid walls
  // (2026-07-24) back when they still carved terrain; once carving was
  // removed a lake became a plain box sitting on flat ground, and a solid
  // box of water reads as an invisible wall in the middle of a field.
  // Dennis's call (2026-07-31): water is walk-through again. The 'polygon'
  // and 'river' collider kinds below are KEPT — the invisible-wall tool
  // (world.barriers) is what uses them now.

  // Invisible walls: author-drawn barriers that block movement but render
  // nothing. Same swept polyline collider a river used to use, so the
  // push-out math is already proven.
  for (const barrier of world.barriers || []) {
    if (!barrier.points || barrier.points.length < 2) continue;
    out.push({ type: 'river', points: barrier.points, halfWidth: (barrier.thickness ?? 1) / 2 });
  }

  return out;
}

function pointsBounds(points, pad = 0) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
}

function colliderBounds(c) {
  if (c.type === 'circle') {
    return { minX: c.x - c.r, maxX: c.x + c.r, minZ: c.z - c.r, maxZ: c.z + c.r };
  }
  if (c.type === 'polygon') {
    return pointsBounds(c.points);
  }
  if (c.type === 'river') {
    return pointsBounds(c.points, c.halfWidth);
  }
  const ext = Math.hypot(c.hw, c.hd); // rotation-agnostic outer bound
  return { minX: c.x - ext, maxX: c.x + ext, minZ: c.z - ext, maxZ: c.z + ext };
}

/**
 * Bucket colliders into a uniform grid so a movement step only tests the
 * handful near the mover, not all ~500 of them. Cells are padded by the widest
 * body radius, so looking up the mover's own cell is enough.
 * @param {Collider[]} colliders
 * @returns {CollisionIndex}
 */
export function createCollisionIndex(colliders) {
  const cells = new Map();
  for (const c of colliders) {
    const b = colliderBounds(c);
    const x0 = Math.floor((b.minX - MAX_BODY_RADIUS) / GRID_CELL);
    const x1 = Math.floor((b.maxX + MAX_BODY_RADIUS) / GRID_CELL);
    const z0 = Math.floor((b.minZ - MAX_BODY_RADIUS) / GRID_CELL);
    const z1 = Math.floor((b.maxZ + MAX_BODY_RADIUS) / GRID_CELL);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gz = z0; gz <= z1; gz++) {
        const key = `${gx},${gz}`;
        const list = cells.get(key);
        if (list) list.push(c);
        else cells.set(key, [c]);
      }
    }
  }
  return { cells, colliders };
}

/** Convenience: world.json -> a ready collision index. */
export function buildCollisionIndex(world, objectDefsById = {}, modelCatalogById = {}) {
  return createCollisionIndex(buildWorldColliders(world, objectDefsById, modelCatalogById));
}

function cellAt(index, x, z) {
  return index.cells.get(`${Math.floor(x / GRID_CELL)},${Math.floor(z / GRID_CELL)}`);
}

/** Nearest point on segment (ax,az)-(bx,bz) to (px,pz). Same math as the private copies in src/sim/mountains.js and src/sim/waterBodies.js — small enough that duplicating it here beats a cross-file dependency for one function. */
function nearestPointOnSegment(ax, az, bx, bz, px, pz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  let t = lenSq > 0 ? ((px - ax) * dx + (pz - az) * dz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * dx, z: az + t * dz };
}

/** Nearest point on an open polyline to (px,pz), as real (x,z) coordinates (not just a distance/fraction — pushOut needs an actual point to push away from). */
function nearestPointOnPolylineXZ(points, px, pz) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const proj = nearestPointOnSegment(points[i - 1].x, points[i - 1].z, points[i].x, points[i].z, px, pz);
    const d = Math.hypot(px - proj.x, pz - proj.z);
    if (!best || d < best.distance) best = { x: proj.x, z: proj.z, distance: d };
  }
  return best;
}

/** Ray-casting point-in-polygon — same algorithm as src/sim/zones.js's isPointInPolygon, duplicated rather than imported since collision.js's colliders are plain {x,z} pairs, not a ZoneDef. */
function isPointInPolygonXZ(points, px, pz) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, zi = points[i].z;
    const xj = points[j].x, zj = points[j].z;
    const intersects = zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Push (x,z) out of one collider along its shortest exit. Returns the
 * corrected point, or null when the body is already clear of it.
 */
function pushOut(c, x, z, r) {
  if (c.type === 'circle') {
    const dx = x - c.x;
    const dz = z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 >= min * min) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: c.x + min, z: c.z }; // dead centre: pick an arbitrary axis
    const k = min / d;
    return { x: c.x + dx * k, z: c.z + dz * k };
  }
  if (c.type === 'polygon') {
    // Lakes can be any hand-drawn shape, not just a box — real point-in-
    // polygon + nearest-edge push-out, not a bounding-box approximation
    // (which would block a much larger area than the actual drawn shape
    // for anything but a perfect rectangle).
    if (!isPointInPolygonXZ(c.points, x, z)) return null;
    let best = null;
    const n = c.points.length;
    for (let i = 0; i < n; i++) {
      const a = c.points[i], b = c.points[(i + 1) % n];
      const proj = nearestPointOnSegment(a.x, a.z, b.x, b.z, x, z);
      const d = Math.hypot(x - proj.x, z - proj.z);
      if (!best || d < best.distance) best = { x: proj.x, z: proj.z, distance: d };
    }
    // `best` is a point ON the boundary edge; (x,z) is strictly inside it
    // (we already returned null above otherwise), so the vector FROM the
    // query point TO the edge point (best - query) is the outward-facing
    // direction — push further along it, past the edge, by the mover's
    // radius. (Getting this backwards pushes deeper into the lake instead
    // of out of it — caught by a real test, see verify-water-collision.)
    let ox = best.x - x, oz = best.z - z;
    const olen = Math.hypot(ox, oz);
    if (olen < 1e-6) return { x: best.x + r, z: best.z }; // dead-on the edge: pick an arbitrary axis
    const k = r / olen;
    return { x: best.x + ox * k, z: best.z + oz * k };
  }
  if (c.type === 'river') {
    const nearest = nearestPointOnPolylineXZ(c.points, x, z);
    const min = c.halfWidth + r;
    if (nearest.distance >= min) return null;
    let ox = x - nearest.x, oz = z - nearest.z;
    const olen = Math.hypot(ox, oz);
    if (olen < 1e-6) return { x: nearest.x + min, z: nearest.z }; // dead-centre of the channel: pick an arbitrary axis
    const k = min / olen;
    return { x: nearest.x + ox * k, z: nearest.z + oz * k };
  }
  // OBB: work in the box's local frame, exit across the nearer face.
  const local = rotY(x - c.x, z - c.z, -c.rot);
  const ex = c.hw + r;
  const ez = c.hd + r;
  if (Math.abs(local.x) >= ex || Math.abs(local.z) >= ez) return null;
  const out = { x: local.x, z: local.z };
  if (ex - Math.abs(local.x) < ez - Math.abs(local.z)) out.x = Math.sign(local.x || 1) * ex;
  else out.z = Math.sign(local.z || 1) * ez;
  const world = rotY(out.x, out.z, c.rot);
  return { x: c.x + world.x, z: c.z + world.z };
}

/**
 * Push a body out of every collider it overlaps. Iterated a few times because
 * escaping one collider can push you into its neighbour (a corner between two
 * trees); it converges or gives up, never loops.
 */
function resolveAgainst(list, x, z, r) {
  let px = x;
  let pz = z;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    for (const c of list) {
      const res = pushOut(c, px, pz, r);
      if (res) {
        px = res.x;
        pz = res.z;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return { x: px, z: pz };
}

/** Nearest non-overlapping point to (x,z). A no-op where nothing is nearby. */
export function resolvePosition(index, x, z, r = PLAYER_RADIUS) {
  if (!index) return { x, z };
  const list = cellAt(index, x, z);
  if (!list) return { x, z };
  return resolveAgainst(list, x, z, r);
}

/** Is a body of radius `r` overlapping anything at (x,z)? */
export function isBlocked(index, x, z, r = PLAYER_RADIUS) {
  const res = resolvePosition(index, x, z, r);
  return Math.abs(res.x - x) > 1e-4 || Math.abs(res.z - z) > 1e-4;
}

/**
 * Move a body from `from` toward `to`, sliding along whatever it hits.
 *
 * Swept in short sub-steps rather than resolved once at the destination: at
 * 6 units/sec a single tick covers 0.3 units, but a lag spike or a fast
 * ability could otherwise carry a body clean through a tree trunk between two
 * samples. The mover also stops advancing once a push-out starts fighting its
 * remaining travel, which is what turns "stuck on the corner" into "slide".
 *
 * @param {CollisionIndex|null} index  null = no collision (tower floors, interiors)
 * @returns {{x:number, z:number}}
 */
export function resolveMovement(index, fromX, fromZ, toX, toZ, r = PLAYER_RADIUS) {
  if (!index) return { x: toX, z: toZ };

  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return resolvePosition(index, toX, toZ, r);

  const steps = Math.max(1, Math.ceil(d / 0.2));
  let x = fromX;
  let z = fromZ;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const nextX = fromX + dx * t;
    const nextZ = fromZ + dz * t;
    const resolved = resolvePosition(index, nextX, nextZ, r);
    x = resolved.x;
    z = resolved.z;
    // If the push-out is shoving us back against the direction we still want
    // to travel, we're against a wall: stop advancing and keep the slide.
    if (Math.hypot(x - nextX, z - nextZ) > r * 0.25) {
      const correctionX = x - nextX;
      const correctionZ = z - nextZ;
      if ((toX - nextX) * correctionX + (toZ - nextZ) * correctionZ < 0) break;
    }
  }
  return { x, z };
}
