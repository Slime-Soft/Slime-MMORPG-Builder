// src/generators/pluginLoader.js
// Auto-discovers and registers every Three.js generator module dropped into
// one of the two folders that work this way:
//
//   src/generators/environment/plugins/  your own extra flora/decor props,
//     each declaring its own palette `category` — the zero-edit path for
//     adding a new tree/flower/decor prop to this project.
//   src/generators/environment/import/   assets that came from SOMEWHERE
//     ELSE (a teammate, another AI, an export from another copy of the
//     game). Identical file format, but every one of them is forced into the
//     "Imported" palette tab regardless of what its `meta.category` says, so
//     it's always obvious which props are yours and which arrived in a file.
//     That folder also holds .json (Object Builder exports) and mesh files;
//     those aren't modules and are handled server-side — see its README.
//
// See the plugins folder's README.md for the file format (`export const meta`
// + `export function build(seed)`), which both folders share exactly.
//
// Call loadFloraPlugins() once, early, before anything builds the scenery
// palette or places props (both editor and live-game main.js do this with a
// top-level `await` right after their other startup fetches). It's a no-op
// (resolves immediately) if both folders are empty or unreachable, so a
// fresh checkout with no plugins behaves exactly as before.
import { registerPluginType } from '../sim/propTypes.js';
import { registerPluginBuilder } from './props.js';

const SOURCES = [
  { dir: '/src/generators/environment/plugins', listUrl: '/api/flora-plugins', forcedCategory: null },
  { dir: '/src/generators/environment/import', listUrl: '/api/imported-assets/plugins', forcedCategory: 'imported' },
];

/**
 * @returns {Promise<{loaded: string[], failed: {file: string, error: string}[]}>}
 */
export async function loadFloraPlugins() {
  const result = { loaded: [], failed: [] };

  for (const source of SOURCES) {
    let files;
    try {
      const res = await fetch(source.listUrl);
      if (!res.ok) continue; // no server support / route missing — silently skip
      files = await res.json();
    } catch {
      continue; // offline or route unavailable — silently skip, not fatal
    }

    for (const file of files) {
      try {
        const mod = await import(/* @vite-ignore */ `${source.dir}/${file}`);
        if (!mod.meta?.id || typeof mod.build !== 'function') {
          result.failed.push({ file, error: 'missing exported `meta.id` or `build(seed)`' });
          continue;
        }
        const meta = source.forcedCategory ? { ...mod.meta, category: source.forcedCategory } : mod.meta;
        registerPluginType(meta);
        registerPluginBuilder(meta.id, mod.build);
        result.loaded.push(meta.id);
      } catch (err) {
        result.failed.push({ file, error: err?.message || String(err) });
      }
    }
  }

  if (result.failed.length) {
    console.warn('[asset plugins] failed to load:', result.failed);
  }
  if (result.loaded.length) {
    console.log(`[asset plugins] loaded: ${result.loaded.join(', ')}`);
  }
  return result;
}
