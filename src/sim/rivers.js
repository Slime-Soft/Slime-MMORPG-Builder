// src/sim/rivers.js
// River-specific sim helpers (World Editor Water mode's "River" sub-tool).
// A river is a WaterBodyDef (kind:'river', see src/sim/waterBodies.js) — an
// open polyline like Paths/Mountains, carrying a per-point `surfaceHeights`
// array (the water's own sloped Y) instead of Mountains' single constant
// peak.
//
// Rivers don't carve the terrain (that used to live here as
// carveRiverChannel — removed per Dennis's explicit call: carving created
// visible mismatches between the drawn water and the real ground). The
// render-side bank-height clamp in computeRiverSpine
// (src/render/scene.js) is what keeps a river's surface from floating
// above the ground now, not terrain modification.
//
// No DOM/rendering dependencies here — same rule as every other src/sim file.

/**
 * Forces a river's per-point `surfaceHeights` to be non-increasing
 * left-to-right (a river can't flow uphill), in place. A single
 * left-to-right pass re-clamping each entry against its (already-clamped)
 * predecessor is correct regardless of which single point changed —
 * re-run over the whole array after any point add/move, not just from the
 * changed index. Same validation rule `validateWaterBodies` (waterBodies.js)
 * enforces for a saved river, applied live while authoring.
 * @param {number[]} surfaceHeights mutated in place
 */
export function enforceNonIncreasingHeights(surfaceHeights) {
  for (let i = 1; i < surfaceHeights.length; i++) {
    if (surfaceHeights[i] > surfaceHeights[i - 1]) surfaceHeights[i] = surfaceHeights[i - 1];
  }
}
