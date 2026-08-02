// src/sim/groundTextures.js
// Painted ground-texture layers (World Editor "Ground Textures" mode). Each
// layer paints ONE texture (a builtin biome id, or "custom:<uploadId>" for a
// user-uploaded image) onto a soft-edged weight mask — the same brush
// mechanic src/sim/world.js's waterMask already uses. Layers composite in
// array order (later = drawn on top of earlier where they overlap) into one
// baked ground overlay — see src/render/groundTextureMesh.js. A layer can
// also carry an ambient particleType (dust/snow/rain/... — see
// src/render/ambientParticles.js), so painting a texture region can also
// seed an atmospheric effect over it.
//
// A layer can also carry an optional `colorGrade` (src/sim/colorGrading.js):
// tint/saturation/brightness applied to the baked tile at draw time. Two
// layers of the SAME textureId are still not possible (ensureGroundTextureLayer
// keys layers by texture id, so painting 'meadow' twice paints one mask), but
// the same builtin now serves a lush spring green on one map and a bleached
// summer straw on another without baking a second tile.
// The authoritative list of builtin texture ids. src/render/groundTextureThemes.js
// holds the matching PIXELS (base colour / noise or paving parameters) and
// asserts at module load that it covers exactly these ids — sim can't import
// that file (it would drag Three into the pure layer), so the guard lives on
// the render side and fails loudly rather than letting the two drift.
import { validateColorGrade } from './colorGrading.js';

export const GROUND_TEXTURE_BUILTIN_IDS = [
  'meadow', 'desert', 'snow', 'forest', 'stone', 'dirt',
  // Paving, added for the city (2026-07-25).
  'cobble', 'flagstone-plaza', 'cobble-dark',
  // Cave/dungeon ground, added for the cave kit (2026-08-02). `cave-floor` is
  // the paved dungeon floor and is deliberately the same look as the
  // `cave-floor-*` PROPS, so a hand-placed tile and a painted region read as
  // one surface; `cave-rock` is the bare cavern floor between them.
  'cave-floor', 'cave-rock',
];
export const PARTICLE_TYPES = ['dust', 'snow', 'wind', 'rain', 'storm', 'sand', 'fireflies', 'miasma'];
export const DEFAULT_GROUND_TEXTURE_RESOLUTION = 64;

function isKnownTextureId(id) {
  return GROUND_TEXTURE_BUILTIN_IDS.includes(id) || /^custom:.+/.test(id);
}

/** @param {any} layers @returns {void} throws on malformed data. */
export function validateGroundTextureLayers(layers) {
  if (!Array.isArray(layers)) {
    throw new Error('World groundTextures must be an array');
  }
  const ids = new Set();
  for (const layer of layers) {
    for (const key of ['id', 'textureId', 'resolution', 'cells']) {
      if (!(key in layer)) {
        throw new Error(`Ground texture layer missing required field: "${key}" (id: ${layer.id || '?'})`);
      }
    }
    if (ids.has(layer.id)) {
      throw new Error(`Duplicate ground texture layer id: "${layer.id}"`);
    }
    ids.add(layer.id);
    if (!isKnownTextureId(layer.textureId)) {
      throw new Error(`Ground texture layer "${layer.id}" has unknown textureId "${layer.textureId}"`);
    }
    const { resolution, cells } = layer;
    if (typeof resolution !== 'number' || resolution < 1) {
      throw new Error(`Ground texture layer "${layer.id}" resolution must be a positive number`);
    }
    const expected = (resolution + 1) * (resolution + 1);
    if (!Array.isArray(cells) || cells.length !== expected) {
      throw new Error(`Ground texture layer "${layer.id}" cells must be an array of length ${expected} (got ${cells?.length})`);
    }
    if (layer.particleType !== undefined && layer.particleType !== null && !PARTICLE_TYPES.includes(layer.particleType)) {
      throw new Error(`Ground texture layer "${layer.id}" has unknown particleType "${layer.particleType}"`);
    }
    validateColorGrade(layer.colorGrade, `Ground texture layer "${layer.id}"`);
    for (const key of ['particleSizeMultiplier', 'particleDensityMultiplier']) {
      if (layer[key] !== undefined && layer[key] !== null && (typeof layer[key] !== 'number' || layer[key] <= 0)) {
        throw new Error(`Ground texture layer "${layer.id}" ${key} must be a positive number`);
      }
    }
  }
}
