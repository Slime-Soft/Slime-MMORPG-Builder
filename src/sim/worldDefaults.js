// src/sim/worldDefaults.js
// One shared constant so every place that creates a fresh terrain/water
// heightmap (World Editor's ensureTerrain/ensureWaterMask, mountains.js's
// stampMountainHeight fallback) agrees on a resolution. This matters because
// the World Editor auto-carves a water basin directly into terrain.heights
// using the SAME grid index as the water mask (see editor/main.js's
// carveWaterBasin) — a mismatched default would silently misalign the two
// grids. 256 (vs. the old 64) so a small brush radius actually paints a
// small area: at 64 over a 1000-unit world, one cell was ~15.6 units wide,
// so brushes well under that size all looked identical ("fixed block size
// regardless of radius").
export const DEFAULT_TERRAIN_WATER_RESOLUTION = 256;
