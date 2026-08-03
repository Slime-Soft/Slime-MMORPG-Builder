// src/sim/guides.js
// Author-written help guides shown from the World Editor's "?" button —
// short how-to posts grouped by category, each with a title and a chunk of
// rich-text HTML (bold/italic/lists/headings/images) written in a
// contenteditable editor. Same load/validate/save/backup pattern as
// src/sim/quests.js: this module only validates plain data, no DOM/socket.

/** @param {any} data @returns {object[]} */
export function parseGuides(data) {
  if (!Array.isArray(data)) throw new Error('Guides data must be an array');
  const seen = new Set();
  for (const g of data) {
    if (!g || typeof g !== 'object') throw new Error('Each guide must be an object');
    for (const key of ['id', 'title', 'category']) {
      if (!g[key] || typeof g[key] !== 'string') throw new Error(`Guide missing required string field: "${key}" (id: ${g.id || '?'})`);
    }
    if (seen.has(g.id)) throw new Error(`Duplicate guide id: "${g.id}"`);
    seen.add(g.id);
    if (g.content !== undefined && typeof g.content !== 'string') {
      throw new Error(`Guide "${g.id}" content must be a string`);
    }
    if (g.createdAt !== undefined && !Number.isFinite(g.createdAt)) {
      throw new Error(`Guide "${g.id}" createdAt must be a number`);
    }
    if (g.updatedAt !== undefined && !Number.isFinite(g.updatedAt)) {
      throw new Error(`Guide "${g.id}" updatedAt must be a number`);
    }
  }
  return data;
}
