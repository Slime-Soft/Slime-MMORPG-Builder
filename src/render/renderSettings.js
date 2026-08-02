// src/render/renderSettings.js
// A tiny standalone module (imports nothing else under render/) holding the
// current map's anisotropy level. Every texture-creation site (ground/path/
// mountain tile textures) reads currentAnisotropy at creation time rather
// than taking a parameter, same "one shared module-level default, updated
// when a map's settings load" pattern as grassCover.js's
// DEFAULT_TERRAIN_WATER_RESOLUTION. Deliberately its own file rather than
// living in scene.js: scene.js imports groundTextureMesh.js, which imports
// groundTextureThemes.js — if that theme file imported currentAnisotropy
// back from scene.js, it would be a circular import.
export let currentAnisotropy = 4;

/** @param {number} value one of graphicsSettings.js's ANISOTROPY_LEVELS */
export function setCurrentAnisotropy(value) {
  currentAnisotropy = value;
}
