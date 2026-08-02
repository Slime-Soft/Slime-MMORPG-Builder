// src/sim/waterBodies.js
// Discrete water body objects (World Editor "Water" mode's Lake/River/
// Puddle tools) — replaces the single world-wide flat `waterMask` bitmap
// (still read elsewhere for backward compatibility during the migration) with
// independent bodies, each owning its own shape AND elevation. That's what
// makes multiple lakes at different heights and sloped rivers possible at
// all: the old mask had exactly one `level` field for the whole world.
//
// Two shapes:
//  - 'lake' / 'puddle': a closed axis-aligned rectangle by convention (the
//    World Editor's Lake tool always places/resizes one), but validated
//    generically as any closed polygon (same point-list shape as a polygon
//    zone, see src/sim/zones.js) — a freeform shape from the old draw tool
//    or a waterMask migration still loads and renders fine, it just can't
//    be resized via the Width/Depth fields without snapping to a rectangle.
//    A puddle is just a lake with a tiny `maxDepth` — same data shape, no
//    separate kind-specific fields needed.
//  - 'river': an open polyline (same shape as src/sim/paths.js's PathDef /
//    src/sim/mountains.js's MountainRidgeDef) with a `width` and one
//    `surfaceHeights` entry per point — the water's own Y at that point,
//    enforced non-increasing along the polyline so it can never visually
//    flow uphill.
//
// Neither shape carves the terrain (that used to be carveWaterBodyBasin/
// carveRiverChannel) — removed per Dennis's explicit call: carving created
// visible mismatches between the drawn water and the actual ground, and he'd
// rather fit the water to the ground by eye (Position/Width/Depth fields,
// raise/lower nudge) than trust automatic terrain-matching.
//
// No DOM/rendering dependencies here — same rule as every other src/sim file.

export const WATER_BODY_KINDS = ['lake', 'puddle', 'river'];
export const DEFAULT_LAKE_MAX_DEPTH = 3;
export const DEFAULT_PUDDLE_MAX_DEPTH = 0.15;
export const DEFAULT_RIVER_WIDTH = 6;

/**
 * @typedef {Object} WaterBodyDef
 * @property {string} id
 * @property {'lake'|'puddle'|'river'} kind
 * @property {Array<{x:number,z:number}>} points closed polygon (lake/puddle) or open polyline (river)
 * @property {number} maxDepth how deep the water LOOKS (feeds the depth-shader only — purely visual, doesn't carve anything)
 * @property {number} [surfaceLevel] lake/puddle only — the single flat water Y
 * @property {number} [cornerRounding] lake only — 0..1, how round the rectangle's corners are as a FRACTION of half its short side (0 = square, 1 = fully rounded: a circle when square, a stadium when not). Stored as a fraction, not a radius in world units, so rounding stays proportional when the lake is resized. `points` already carries the resulting rounded outline (that's what renders and collides); this field exists so the editor can repopulate its slider and so the water shader's shoreline distance can use an exact rounded-rect SDF instead of the plain bounding box.
 * @property {number} [edgeSoftness] lake/puddle only — legacy field from when lakes carved a basin; harmless if present on an old save, unused now
 * @property {number} [width] river only — full channel width
 * @property {number[]} [surfaceHeights] river only — one Y per point, must be non-increasing (flows downhill)
 */

const isObj = (v) => v && typeof v === 'object';

/** @param {any} waterBodies @returns {void} throws on malformed data. */
export function validateWaterBodies(waterBodies) {
  if (!Array.isArray(waterBodies)) {
    throw new Error('World waterBodies must be an array');
  }
  const ids = new Set();
  for (const b of waterBodies) {
    if (!isObj(b)) throw new Error('Each water body must be an object');
    if (!b.id) throw new Error('Water body missing required field: "id"');
    if (ids.has(b.id)) throw new Error(`Duplicate water body id: "${b.id}"`);
    ids.add(b.id);

    if (!WATER_BODY_KINDS.includes(b.kind)) {
      throw new Error(`Water body "${b.id}" has unknown kind "${b.kind}"`);
    }
    const label = `Water body "${b.id}" (${b.kind})`;
    const minPoints = b.kind === 'river' ? 2 : 3;
    if (!Array.isArray(b.points) || b.points.length < minPoints) {
      throw new Error(`${label} needs at least ${minPoints} points`);
    }
    for (const pt of b.points) {
      if (typeof pt.x !== 'number' || typeof pt.z !== 'number') {
        throw new Error(`${label} has a non-numeric point`);
      }
    }
    if (typeof b.maxDepth !== 'number' || b.maxDepth <= 0) {
      throw new Error(`${label} maxDepth must be a positive number`);
    }

    if (b.kind === 'river') {
      if (typeof b.width !== 'number' || b.width <= 0) {
        throw new Error(`${label} width must be a positive number`);
      }
      if (!Array.isArray(b.surfaceHeights) || b.surfaceHeights.length !== b.points.length) {
        throw new Error(`${label} surfaceHeights must be an array matching points.length`);
      }
      for (const h of b.surfaceHeights) {
        if (typeof h !== 'number') throw new Error(`${label} has a non-numeric surfaceHeights entry`);
      }
      for (let i = 1; i < b.surfaceHeights.length; i++) {
        if (b.surfaceHeights[i] > b.surfaceHeights[i - 1]) {
          throw new Error(
            `${label} surfaceHeights must be non-increasing along the polyline (a river can't flow uphill) — index ${i} (${b.surfaceHeights[i]}) is higher than index ${i - 1} (${b.surfaceHeights[i - 1]})`
          );
        }
      }
    } else {
      if (typeof b.surfaceLevel !== 'number') {
        throw new Error(`${label} surfaceLevel must be a number`);
      }
      if (b.edgeSoftness !== undefined && (typeof b.edgeSoftness !== 'number' || b.edgeSoftness < 0)) {
        throw new Error(`${label} edgeSoftness must be a non-negative number`);
      }
      if (b.cornerRounding !== undefined && (typeof b.cornerRounding !== 'number' || b.cornerRounding < 0 || b.cornerRounding > 1)) {
        throw new Error(`${label} cornerRounding must be a number between 0 and 1`);
      }
    }
  }
}

/**
 * Nearest point on a river's polyline to (x, z), reported as the segment it
 * fell on plus a local 0..1 blend factor within that segment — the same
 * pair `sampleRiverSurfaceLevel` (interpolating surfaceHeights) and the
 * upcoming Phase 2 channel-carving both need, so it's shared here rather
 * than re-derived per caller.
 * @returns {{distance:number, segmentIndex:number, t:number}}
 */
export function nearestPointOnPolyline(points, x, z) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const ax = points[i - 1].x, az = points[i - 1].z;
    const bx = points[i].x, bz = points[i].z;
    const dx = bx - ax, dz = bz - az;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((x - ax) * dx + (z - az) * dz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cz = az + t * dz;
    const distance = Math.hypot(x - cx, z - cz);
    if (!best || distance < best.distance) best = { distance, segmentIndex: i - 1, t };
  }
  return best;
}

/** Interpolates a river's per-point `surfaceHeights` at a (segmentIndex, t) pair from `nearestPointOnPolyline`. */
export function sampleRiverSurfaceLevel(river, segmentIndex, t) {
  const h0 = river.surfaceHeights[segmentIndex];
  const h1 = river.surfaceHeights[segmentIndex + 1];
  return h0 + (h1 - h0) * t;
}

/**
 * One-time migration helper: traces the boundary of a connected painted
 * region in the legacy `world.waterMask` bitmap into a rough closed polygon,
 * in world-space coordinates. Pure grid/geometry logic, no editor
 * dependency, so the World Editor's "Convert painted water to lakes" button
 * (Phase 1) can call this per connected component (reusing the same
 * flood-fill traversal `eraseConnectedWaterBody` in src/editor/main.js
 * already does to find one component) and hand the result straight to a new
 * `kind:'lake'` WaterBodyDef. Deliberately rough — the editor's polygon
 * point-drag UI is how these get cleaned up afterward, not this function.
 *
 * Walks the outer boundary edges of the painted cells (marching-squares
 * style: for every painted cell, an edge facing an unpainted/out-of-bounds
 * neighbor is a boundary edge) and stitches them into ordered loops via
 * shared endpoints. Cells are treated as unit squares in grid space, then
 * mapped to world space via `bounds`.
 * @param {{resolution:number, cells:number[]}} waterMask
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @param {Set<number>} componentIndices grid cell indices belonging to one connected component (e.g. from a flood-fill)
 * @param {number} [threshold] cell alpha above which a cell counts as painted
 * @returns {Array<{x:number,z:number}>} a closed polygon loop in world space, or [] if no boundary could be traced
 */
export function traceWaterMaskComponentToPolygon(waterMask, bounds, componentIndices, threshold = 0.02) {
  const { resolution, cells } = waterMask;
  const size = resolution + 1;
  const painted = (gx, gz) => {
    if (gx < 0 || gx >= size || gz < 0 || gz >= size) return false;
    const idx = gz * size + gx;
    return componentIndices.has(idx) && cells[idx] > threshold;
  };
  const gridToWorld = (gx, gz) => ({
    x: bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX),
    z: bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ),
  });

  // Collect every boundary edge (as a pair of grid-corner keys) of every
  // painted cell whose neighbor across that edge isn't painted.
  const edges = []; // [ [gx0,gz0], [gx1,gz1] ]
  for (const idx of componentIndices) {
    const gx = idx % size;
    const gz = Math.floor(idx / size);
    if (!painted(gx, gz)) continue;
    // Cell (gx,gz) occupies grid-corner square [gx,gx+1] x [gz,gz+1].
    if (!painted(gx, gz - 1)) edges.push([[gx, gz], [gx + 1, gz]]); // top
    if (!painted(gx + 1, gz)) edges.push([[gx + 1, gz], [gx + 1, gz + 1]]); // right
    if (!painted(gx, gz + 1)) edges.push([[gx + 1, gz + 1], [gx, gz + 1]]); // bottom
    if (!painted(gx - 1, gz)) edges.push([[gx, gz + 1], [gx, gz]]); // left
  }
  if (!edges.length) return [];

  // Stitch edges into one ordered loop by chaining shared endpoints.
  const key = ([gx, gz]) => `${gx},${gz}`;
  const byStart = new Map();
  for (const edge of edges) byStart.set(key(edge[0]), edge);

  const startKey = key(edges[0][0]);
  const loop = [edges[0][0]];
  let cursor = edges[0][1];
  const visited = new Set([startKey]);
  while (key(cursor) !== startKey) {
    loop.push(cursor);
    visited.add(key(cursor));
    const next = byStart.get(key(cursor));
    if (!next || visited.has(key(next[1]))) break; // malformed/branching boundary — stop rather than loop forever
    cursor = next[1];
    if (loop.length > edges.length + 1) break; // safety valve against a pathological edge set
  }

  return loop.map(([gx, gz]) => gridToWorld(gx, gz));
}

/**
 * Finds every connected component (4-connected) of painted cells in a
 * legacy `world.waterMask` bitmap — the whole-mask counterpart to the
 * single-clicked-component flood-fill `eraseConnectedWaterBody` in
 * src/editor/main.js already does. The World Editor's "Convert painted
 * water to lakes" button runs this once, then calls
 * `traceWaterMaskComponentToPolygon` on each returned component to build
 * one lake body per separately-painted pond/lake.
 * @param {{resolution:number, cells:number[]}} waterMask
 * @param {number} [threshold] same convention as traceWaterMaskComponentToPolygon
 * @returns {Array<Set<number>>} one Set of grid indices per connected component
 */
export function findWaterMaskComponents(waterMask, threshold = 0.02) {
  const { resolution, cells } = waterMask;
  const size = resolution + 1;
  const visited = new Uint8Array(cells.length);
  const components = [];

  for (let start = 0; start < cells.length; start++) {
    if (visited[start] || !(cells[start] > threshold)) continue;
    const component = new Set();
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const idx = stack.pop();
      component.add(idx);
      const gx = idx % size;
      const gz = Math.floor(idx / size);
      const neighbors = [[gx + 1, gz], [gx - 1, gz], [gx, gz + 1], [gx, gz - 1]];
      for (const [nx, nz] of neighbors) {
        if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
        const nIdx = nz * size + nx;
        if (visited[nIdx]) continue;
        if (cells[nIdx] > threshold) {
          visited[nIdx] = 1;
          stack.push(nIdx);
        }
      }
    }
    components.push(component);
  }
  return components;
}
