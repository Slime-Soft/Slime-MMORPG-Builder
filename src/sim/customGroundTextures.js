// src/sim/customGroundTextures.js
// Catalog of user-uploaded custom ground textures — id, display name, and
// the URL the image was saved under (public/assets/ground-textures/, served
// statically). Separate from src/sim/groundTextures.js's painted layers:
// this is just "what custom images exist to paint with," the same
// catalog-metadata role src/sim/authoredItems.js plays for item icons.
/** @param {any} data @returns {any} throws on malformed data. */
export function parseCustomGroundTextures(data) {
  if (!Array.isArray(data)) {
    throw new Error('Custom ground texture catalog must be an array');
  }
  const ids = new Set();
  for (const entry of data) {
    for (const key of ['id', 'name', 'url']) {
      if (!(key in entry)) {
        throw new Error(`Custom ground texture missing required field: "${key}"`);
      }
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate custom ground texture id: "${entry.id}"`);
    }
    ids.add(entry.id);
  }
  return data;
}
