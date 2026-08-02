// src/generators/environment/buildingParts.js
// Pure geometry builders for the two building pieces that aren't practical to
// hand-place one primitive at a time (a log wall is a whole row of posts, a
// shingled roof panel is hundreds of diamonds) — shared by generateLonghouse
// (src/generators/environment/longhouse.js) and the Object Builder's
// 'log-wall'/'shingle-roof-panel' shape kinds (src/generators/custom.js),
// so both get the exact same geometry instead of two copies drifting apart.
// No material/color here — callers wrap the returned BufferGeometry in
// whatever THREE.Mesh + material fits their context.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A row of vertical half-round log posts spanning `length`, merged into one geometry — reads as log construction instead of a flat wall. */
export function logWallGeometry(length, height) {
  const postRadius = 0.22;
  const postCount = Math.max(3, Math.round(length / (postRadius * 1.7)));
  const spacing = length / postCount;
  const geos = [];
  for (let i = 0; i < postCount; i++) {
    const geo = new THREE.CylinderGeometry(postRadius, postRadius, height, 6, 1);
    geo.translate(-length / 2 + spacing * (i + 0.5), height / 2, 0);
    geos.push(geo);
  }
  return mergeGeometries(geos);
}

/** One diamond roof shingle: base flush with the roof plane, a shallow peak poking outward along the panel's own normal. */
function shingleGeometry(size) {
  const height = size * 0.16;
  // A 4-segment ConeGeometry already places its corners exactly on the
  // +X/-X/+Z/-Z axes (theta starts at 0, vertex = radius*(sin theta, cos
  // theta)) — that IS the diamond orientation, corners reaching the full
  // radius along the tiling axes. An extra 45° rotation turns it into a
  // SQUARE facing those axes instead, whose reach along them is only
  // radius/sqrt(2) — smaller than the spacing below assumes, which is
  // exactly what left visible gaps between every shingle. No rotation.
  //
  // Radius is well past what a snug tiling needs (0.52 would already just
  // touch neighboring centers at the spacing below) — deliberately so. A
  // diamond pinches to a single point at each of its 4 corners, so unless
  // two neighbors' corners land EXACTLY on top of each other, a snug fit
  // still leaves a sliver of background showing through right at the seam.
  // A radius this much larger than the spacing means neighbors overlap by
  // their BELLIES, not just touch at a point, which is what actually
  // guarantees full coverage regardless of exact corner alignment.
  const geo = new THREE.ConeGeometry(size * 0.85, height, 4, 1);
  geo.translate(0, height / 2, 0); // base at local y=0, apex pokes out
  return geo;
}

/**
 * A sloped roof panel tiled with staggered diamond shingles — the "fish
 * scale" look. Built flat in local XZ (X = up the slope, Z = along the
 * ridge) so the caller can rotate/position the whole thing like a plain flat
 * panel; merged into one geometry so shingle count doesn't cost extra draw
 * calls.
 */
export function shingleRoofPanelGeometry(slopeLength, panelDepth) {
  const size = 0.5;
  const rowSpacing = size * 0.62; // rows overlap, like real shingles — not a plain grid
  const colSpacing = size * 0.86;
  const rows = Math.ceil(slopeLength / rowSpacing) + 1;
  // The staggered offset on odd rows (below) SHIFTS their starting column by
  // +colSpacing/2 relative to even rows — the old start point
  // (-panelDepth/2 - colSpacing/2) gave even rows a half-shingle head start
  // past the edge but put odd rows' first shingle exactly ON the edge, with
  // no overhang at all. That colSpacing/2 of under-coverage on every other
  // row is exactly the small notch-shaped gaps in the tiling. Starting a
  // full colSpacing earlier (not just half), for BOTH parities, and adding
  // one more buffer column, guarantees at least half a shingle of overhang
  // past each edge regardless of which row parity lands there.
  const cols = Math.ceil(panelDepth / colSpacing) + 3;
  const geos = [];
  for (let r = 0; r < rows; r++) {
    const x = -slopeLength / 2 + r * rowSpacing;
    const offset = (r % 2) * (colSpacing / 2);
    for (let c = 0; c < cols; c++) {
      const z = -panelDepth / 2 - colSpacing + c * colSpacing + offset;
      const geo = shingleGeometry(size);
      geo.translate(x, 0, z);
      geos.push(geo);
    }
  }
  return mergeGeometries(geos);
}
