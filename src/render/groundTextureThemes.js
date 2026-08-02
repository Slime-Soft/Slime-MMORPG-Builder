// src/render/groundTextureThemes.js
// Procedurally-baked, tileable ground-cover textures (grass/sand/snow/leaf-
// litter/rock/dirt) plus a loader/cache for user-uploaded custom textures.
// No external image files for the builtins (CLAUDE.md's "generated at
// runtime" rule); uploads are the one deliberate exception, per Dennis's
// explicit ask for a "use your own texture" option.
//
// Visually distinct from src/render/pathThemes.js's flagstone generator on
// purpose: paths want hard mortar-line cells (a road), ground cover wants a
// soft mottled blotch look (grass/sand/snow). Built with a cheap tileable
// trig-noise blend instead of Voronoi cells — integer cycle frequencies
// guarantee a seamless wrap with no wrapped-seed search, and it reads as
// organic ground cover rather than a cracked surface.
import * as THREE from 'three';
import { currentAnisotropy } from './renderSettings.js';
import { GROUND_TEXTURE_BUILTIN_IDS } from '../sim/groundTextures.js';

// Two kinds of builtin live here now:
//   `pattern: undefined` — the original soft trig-noise blotch (organic cover)
//   `pattern: 'cell'`     — a jittered-grid Voronoi with mortar gaps, for PAVING
// Paving needed its own baker: a town square is defined by hard-edged stones
// with mortar between them, and no amount of blotch noise produces an edge.
// (pathThemes.js has a flagstone generator for ROADS; this is the ground-cover
// equivalent, so a plaza can be painted as an area rather than a polyline.)
export const GROUND_TEXTURE_BUILTIN_DEFS = [
  { id: 'meadow', label: 'Meadow Grass', base: [92, 140, 68], variance: 30, freq1: 4, freq2: 9 },
  { id: 'desert', label: 'Desert Sand', base: [214, 184, 132], variance: 20, freq1: 3, freq2: 11 },
  { id: 'snow', label: 'Snow', base: [232, 238, 244], variance: 10, freq1: 5, freq2: 13 },
  { id: 'forest', label: 'Forest Floor', base: [74, 58, 40], variance: 28, freq1: 6, freq2: 15 },
  { id: 'stone', label: 'Rocky Ground', base: [122, 120, 116], variance: 22, freq1: 4, freq2: 10 },
  { id: 'dirt', label: 'Dirt', base: [110, 82, 54], variance: 26, freq1: 3, freq2: 8 },
  {
    id: 'cobble', label: 'Cobblestone', pattern: 'cell',
    base: [146, 138, 128], variance: 26, cells: 9, jitter: 0.75,
    mortar: [86, 80, 73], mortarWidth: 0.16, dome: 0.34,
  },
  {
    id: 'flagstone-plaza', label: 'Flagstone Plaza', pattern: 'cell',
    base: [200, 188, 166], variance: 15, cells: 5, jitter: 0.42,
    mortar: [150, 139, 120], mortarWidth: 0.10, dome: 0.14,
  },
  {
    id: 'cobble-dark', label: 'Dark Cobble', pattern: 'cell',
    base: [104, 100, 100], variance: 24, cells: 11, jitter: 0.8,
    mortar: [58, 55, 54], mortarWidth: 0.18, dome: 0.30,
  },
  // --- Cave/dungeon ground (2026-08-02), to go under the cave prop kit.
  //
  // `cave-floor` is keyed to the SAME palette as the kit's floor-tile props
  // (src/generators/environment/caveKit.js): near-black blue stone, a neutral
  // grey joint, chunky stones. A painted floor and a placed `cave-floor-tile`
  // have to read as one surface or the tiles look like litter dropped on a
  // different material.
  //
  // Note the mortar is LIGHTER than the stone here, which is the opposite of
  // every other paving theme above. That is not a slip: in this palette the
  // stone is nearly black, so a darker joint would be invisible and the floor
  // would render as one flat dark sheet with no stones in it at all.
  {
    id: 'cave-floor', label: 'Cave Floor', pattern: 'cell',
    base: [48, 56, 72], variance: 26, cells: 8, jitter: 0.8,
    mortar: [104, 108, 118], mortarWidth: 0.15, dome: 0.34,
  },
  // The bare cavern floor between the paved areas: same stone, no joints —
  // a soft mottle rather than cells, so it doesn't fight the paving's grid.
  { id: 'cave-rock', label: 'Cave Rock', base: [58, 64, 78], variance: 24, freq1: 4, freq2: 11 },
];
const builtinById = Object.fromEntries(GROUND_TEXTURE_BUILTIN_DEFS.map((t) => [t.id, t]));

// The id list lives in sim (it validates saved worlds and must not import
// Three); the pixels live here. Nothing structural keeps the two in step, and
// a mismatch is silent in the worst way — a map saved with a texture sim
// accepts, that renders as nothing. So assert it once, at module load.
{
  const defIds = new Set(Object.keys(builtinById));
  const missingPixels = GROUND_TEXTURE_BUILTIN_IDS.filter((id) => !defIds.has(id));
  const missingIds = [...defIds].filter((id) => !GROUND_TEXTURE_BUILTIN_IDS.includes(id));
  // Reported, NOT thrown. This runs at module-evaluation time in the browser,
  // and a throw here takes the whole module graph down — the game boots to a
  // black screen stuck on "Connecting…" with the real cause buried. A loud
  // console error plus one texture that renders as nothing is a far better
  // failure than no game at all.
  if (missingPixels.length || missingIds.length) {
    console.error(
      'Ground texture builtins are out of sync between src/sim/groundTextures.js and this file. ' +
      (missingPixels.length ? `No tile definition for: ${missingPixels.join(', ')}. ` : '') +
      (missingIds.length ? `Not in GROUND_TEXTURE_BUILTIN_IDS: ${missingIds.join(', ')}.` : '')
    );
  }
}

// 256px source tile — now sampled through a real GPU RepeatWrapping texture
// (see getGroundTextureTileTexture below) with anisotropic filtering, so
// this only bounds close-up sharpness, not repeat-count aliasing.
const TILE_SIZE = 256;

function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Deterministic PRNG, so a paving tile's stone layout is identical every bake. */
function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bakes a paving tile: a jittered grid of Voronoi sites, each site one stone.
 *
 * Tileability is the whole trick here. Sites live on a grid across ONE tile,
 * and every distance test wraps the delta into [-size/2, size/2] — so a stone
 * whose centre sits near the right edge is genuinely the same stone that
 * appears at the left edge, and the seam disappears. Baking sites into a 3x3
 * super-grid and cropping the middle would also work but costs 9x the tests.
 *
 * Per pixel we keep the nearest AND second-nearest site: their difference is
 * (roughly) the distance to the shared border, which is what draws the mortar.
 * Nearest-distance alone gives you circles with gaps, not fitted stones.
 */
function bakeCellTile(theme) {
  const size = TILE_SIZE;
  const n = theme.cells;
  const rand = mulberry32(hashStringToSeed(theme.id));
  const cell = size / n;

  const sites = [];
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      sites.push({
        x: (gx + 0.5 + (rand() - 0.5) * theme.jitter) * cell,
        y: (gy + 0.5 + (rand() - 0.5) * theme.jitter) * cell,
        // Each stone gets its own tone, and a slight warm/cool cast — a plaza
        // of identically-coloured stones reads as a printed pattern.
        shade: 1 + (rand() - 0.5) * (theme.variance / 128) * 2,
        warm: (rand() - 0.5) * 10,
      });
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const [br, bg, bb] = theme.base;
  const [mr, mg, mb] = theme.mortar;
  const half = size / 2;
  const mortarPx = theme.mortarWidth * cell;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let d1 = Infinity;
      let d2 = Infinity;
      let best = sites[0];
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        let dx = s.x - x;
        let dy = s.y - y;
        if (dx > half) dx -= size; else if (dx < -half) dx += size;
        if (dy > half) dy -= size; else if (dy < -half) dy += size;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = s; }
        else if (d < d2) { d2 = d; }
      }

      // Mortar: 0 in the gutter between two stones, 1 well inside a stone.
      const edge = d2 - d1;
      const t = Math.max(0, Math.min(1, edge / mortarPx));
      const mortarMix = t * t * (3 - 2 * t); // smoothstep

      // Dome: each stone is brightest at its centre and falls off to its rim,
      // which is what makes cobbles read as rounded rather than as flat chips.
      const domeShade = 1 - theme.dome * Math.min(1, d1 / (cell * 0.62));

      const sr = br * best.shade * domeShade + best.warm;
      const sg = bg * best.shade * domeShade + best.warm * 0.5;
      const sb = bb * best.shade * domeShade - best.warm * 0.4;

      const idx = (y * size + x) * 4;
      data[idx] = clampByte(mr + (sr - mr) * mortarMix);
      data[idx + 1] = clampByte(mg + (sg - mg) * mortarMix);
      data[idx + 2] = clampByte(mb + (sb - mb) * mortarMix);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return img;
}

/** Bakes one builtin theme's tile as ImageData. Frequencies are integers so `u`/`v` (0..2*PI across the tile) wrap seamlessly with no seam-fixup needed. */
function bakeBuiltinTile(themeId) {
  const theme = builtinById[themeId];
  if (theme.pattern === 'cell') return bakeCellTile(theme);
  const size = TILE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const seedOffset = (hashStringToSeed(theme.id) % 1000) / 1000; // 0..1, just a per-theme phase offset
  const [br, bg, bb] = theme.base;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * Math.PI * 2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      let n = Math.sin(u * theme.freq1 + seedOffset * 6.28) * Math.cos(v * theme.freq1 * 1.3 + seedOffset * 4.1);
      n += 0.5 * Math.sin(u * theme.freq2 - seedOffset * 3.2) * Math.cos(v * theme.freq2 + seedOffset * 5.7);
      n /= 1.5;
      const shade = 1 + (n * theme.variance) / 128;
      const idx = (y * size + x) * 4;
      data[idx] = clampByte(br * shade);
      data[idx + 1] = clampByte(bg * shade);
      data[idx + 2] = clampByte(bb * shade);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return img;
}

const tileCache = new Map(); // 'meadow' | 'custom:<id>' -> ImageData
let onCustomTileLoaded = null;

/** Called once by the editor/live client after they fetch the custom ground-texture catalog, so a bake triggered later can re-run once images are actually loaded. */
export function setCustomGroundTextureLoadedCallback(cb) {
  onCustomTileLoaded = cb;
}

/** Loads an uploaded image into a fixed-size square tile and caches its ImageData under `custom:<id>`. Async — the tile isn't available until it loads; callers should tolerate a transient miss and re-bake once onCustomTileLoaded fires. */
export function registerCustomGroundTexture(id, url) {
  const key = `custom:${id}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const size = TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, size, size); // stretched to a square repeat tile
    tileCache.set(key, ctx.getImageData(0, 0, size, size));
    onCustomTileLoaded?.(id);
  };
  img.onerror = () => console.error(`Failed to load custom ground texture "${id}" from ${url}`);
  img.src = url;
}

/** Returns cached ImageData for a theme id (builtin or `custom:<id>`), baking+caching a builtin on first request. Returns null for a custom id that hasn't finished loading yet, or an unknown id. */
export function getGroundTextureTileImageData(themeId) {
  if (tileCache.has(themeId)) return tileCache.get(themeId);
  if (themeId.startsWith('custom:')) return null;
  if (!builtinById[themeId]) return null;
  const img = bakeBuiltinTile(themeId);
  tileCache.set(themeId, img);
  return img;
}

const liveTextureCache = new Map(); // themeId -> THREE.Texture, built lazily from the same tile ImageData

/**
 * A real, GPU-tiled THREE.Texture for a theme id — RepeatWrapping +
 * anisotropic filtering, so the ground-texture shader (groundTextureMesh.js)
 * gets hardware-correct mipmap/anisotropic sampling at any repeat count
 * instead of a fixed-resolution baked composite aliasing on a large map.
 * Returns null under the same conditions getGroundTextureTileImageData does
 * (an unloaded custom upload, or an unknown id).
 */
export function getGroundTextureTileTexture(themeId) {
  if (liveTextureCache.has(themeId)) return liveTextureCache.get(themeId);
  const imgData = getGroundTextureTileImageData(themeId);
  if (!imgData) return null;
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  canvas.getContext('2d').putImageData(imgData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = currentAnisotropy;
  texture.needsUpdate = true;
  liveTextureCache.set(themeId, texture);
  return texture;
}

/** Small standalone canvas of a theme's tile, for palette swatch buttons. */
export function renderGroundTextureSwatchCanvas(themeId, sizePx = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  const tile = getGroundTextureTileImageData(themeId);
  if (!tile) {
    ctx.fillStyle = '#444';
    ctx.fillRect(0, 0, sizePx, sizePx);
    return canvas;
  }
  const tmp = document.createElement('canvas');
  tmp.width = tile.width;
  tmp.height = tile.height;
  tmp.getContext('2d').putImageData(tile, 0, 0);
  ctx.drawImage(tmp, 0, 0, sizePx, sizePx);
  return canvas;
}
