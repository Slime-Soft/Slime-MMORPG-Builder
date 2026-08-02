// src/sim/customPathTextures.js
// Catalog of user-uploaded custom path/road textures — id, display name, and
// the URL the image was saved under (public/assets/path-textures/, served
// statically). Separate from src/sim/paths.js's drawn polylines: this is just
// "what custom images exist to pick as a path theme," the same
// catalog-metadata role src/sim/customGroundTextures.js plays for ground
// texture uploads.
/** @param {any} data @returns {any} throws on malformed data. */
export function parseCustomPathTextures(data) {
  if (!Array.isArray(data)) {
    throw new Error('Custom path texture catalog must be an array');
  }
  const ids = new Set();
  for (const entry of data) {
    for (const key of ['id', 'name', 'url']) {
      if (!(key in entry)) {
        throw new Error(`Custom path texture missing required field: "${key}"`);
      }
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate custom path texture id: "${entry.id}"`);
    }
    ids.add(entry.id);
  }
  return data;
}
