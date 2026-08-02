// src/sim/paths.js
// Drawn pathways/roads (World Editor "Paths" mode). A path is an ordered
// polyline of ground points plus a width and a visual theme; the renderer
// turns it into a ribbon mesh (src/render/pathMesh.js). No DOM/rendering
// dependencies here — same rule as every other src/sim file.

import { validateColorGrade } from './colorGrading.js';

export const PATH_THEMES = ['basic', 'desert', 'snow', 'forest'];
export const DEFAULT_PATH_WIDTH = 3;

function isKnownPathTheme(theme) {
  return PATH_THEMES.includes(theme) || /^custom:.+/.test(theme);
}

/**
 * @typedef {Object} PathDef
 * @property {string} id
 * @property {Array<{x:number,z:number}>} points
 * @property {number} width
 * @property {string} [theme] one of PATH_THEMES, or "custom:<uploadId>" for a
 *   user-uploaded texture (src/sim/customPathTextures.js); renderer falls
 *   back to 'basic'
 * @property {import('./colorGrading.js').ColorGrade} [colorGrade] optional
 *   tint/saturation/brightness applied to the theme's baked texture, so one
 *   theme can serve a dozen different-coloured roads
 */

/** @param {any} paths @returns {void} throws on malformed data. */
export function validatePaths(paths) {
  if (!Array.isArray(paths)) {
    throw new Error('World paths must be an array');
  }
  const ids = new Set();
  for (const p of paths) {
    for (const key of ['id', 'points', 'width']) {
      if (!(key in p)) {
        throw new Error(`Path missing required field: "${key}" (id: ${p.id || '?'})`);
      }
    }
    if (ids.has(p.id)) {
      throw new Error(`Duplicate path id: "${p.id}"`);
    }
    ids.add(p.id);
    if (!Array.isArray(p.points) || p.points.length < 2) {
      throw new Error(`Path "${p.id}" needs at least 2 points`);
    }
    for (const pt of p.points) {
      if (typeof pt.x !== 'number' || typeof pt.z !== 'number') {
        throw new Error(`Path "${p.id}" has a non-numeric point`);
      }
    }
    if (typeof p.width !== 'number' || p.width <= 0) {
      throw new Error(`Path "${p.id}" width must be a positive number`);
    }
    if (p.theme !== undefined && !isKnownPathTheme(p.theme)) {
      throw new Error(`Path "${p.id}" has unknown theme "${p.theme}"`);
    }
    validateColorGrade(p.colorGrade, `Path "${p.id}"`);
  }
}
