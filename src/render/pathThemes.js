// src/render/pathThemes.js
// Procedurally-baked, tileable path/road textures — one per biome theme, no
// external image files (CLAUDE.md's "all assets generated at runtime" rule).
// Lazy-cached singleton per theme id, same pattern as getToonGradientMap()
// (src/render/toonGradient.js).
//
// Custom uploaded textures (id `custom:<uploadId>`) are the one deliberate
// exception, per the same "use your own texture" ask that added uploads to
// ground textures (src/render/groundTextureThemes.js) — mirrors that file's
// registerCustomGroundTexture/getGroundTextureTileTexture pattern.
import * as THREE from 'three';
import { currentAnisotropy } from './renderSettings.js';

export const PATH_THEME_DEFS = [
  {
    id: 'basic',
    label: 'Meadow Stone',
    base: [150, 150, 138],
    variance: 22,
    mortar: [92, 104, 78],
    cellCount: 46,
    mortarWidth: 2.2,
  },
  {
    id: 'desert',
    label: 'Desert Flagstone',
    base: [206, 176, 128],
    variance: 26,
    mortar: [150, 118, 78],
    cellCount: 34,
    mortarWidth: 2.8,
  },
  {
    id: 'snow',
    label: 'Packed Snow',
    base: [224, 230, 236],
    variance: 12,
    mortar: [188, 198, 210],
    cellCount: 30,
    mortarWidth: 1.6,
  },
  {
    id: 'forest',
    label: 'Mossy Forest Path',
    base: [96, 74, 54],
    variance: 24,
    mortar: [58, 78, 46],
    cellCount: 40,
    mortarWidth: 3.2,
  },
];

const themesById = Object.fromEntries(PATH_THEME_DEFS.map((t) => [t.id, t]));

/** Deterministic per-string seed, mirroring hashStringToSeed used elsewhere in the editor. */
function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

/** Local mulberry32 — this file lives in src/render, not src/sim, so it isn't bound by the sim purity/no-Math.random rule; a seeded generator is used anyway so a theme's texture is stable across reloads. */
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Matches groundTextureThemes.js's TILE_SIZE, and with pathMesh.js's
// PATH_TILE_WORLD_SIZE also matching that module's TILE_WORLD_SIZE, a path
// and a painted ground texture now carry exactly the same texels per metre.
// That parity is the point: at 128px this was the coarser of the two by 2-4x
// depending on path width, so a road mipped down to a flat colour while the
// ground beside it still had detail, and the two became indistinguishable a
// short way out.
//
// 256px used to be a visible multi-theme stutter on editor load (the palette
// eagerly bakes all four for its swatches). That was an artifact of this
// being an O(size^2 * cellCount * 9) search that recomputed all nine wrapped
// seed copies inside the per-pixel loop; they're precomputed once now, which
// more than pays for the 4x pixel count.
const TEXTURE_SIZE = 256;
// mortarWidth is authored in pixels against the original 128px bake, so it
// has to scale with the texture or the grout lines get half as wide.
const MORTAR_WIDTH_SCALE = TEXTURE_SIZE / 128;

/**
 * Bakes a seamlessly-tileable cellular (Voronoi/Worley-style) flagstone
 * pattern: for every pixel, find the nearest of N scattered seed points,
 * also checking each seed's 8 wrapped copies (offset by canvas size) so the
 * pattern has no seam at the texture's edges when repeated.
 */
function buildThemeTexture(themeId) {
  const theme = themesById[themeId] || themesById.basic;
  const size = TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const rng = mulberry32(hashStringToSeed(theme.id));
  // Every seed's nine wrapped copies (itself plus the 8 neighbours), flattened
  // once into typed arrays. This used to be rebuilt inside the innermost pixel
  // loop — size^2 * cellCount * 9 object reads and multiplies, which is what
  // made a 256px bake feel slow. Flat arrays, computed once.
  const copyCount = theme.cellCount * 9;
  const seedX = new Float32Array(copyCount);
  const seedY = new Float32Array(copyCount);
  const seedShade = new Float32Array(copyCount);
  let n = 0;
  for (let i = 0; i < theme.cellCount; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const shade = rng(); // per-cell variance draw; shared by all nine copies so a cell looks the same across the seam
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        seedX[n] = x + dx * size;
        seedY[n] = y + dy * size;
        seedShade[n] = shade;
        n++;
      }
    }
  }

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const [br, bg, bb] = theme.base;
  const [mr, mg, mb] = theme.mortar;
  const mortarWidth = theme.mortarWidth * MORTAR_WIDTH_SCALE;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity;
      let second = Infinity;
      let bestShade = seedShade[0];
      for (let s = 0; s < copyCount; s++) {
        const ddx = seedX[s] - x;
        const ddy = seedY[s] - y;
        const d = ddx * ddx + ddy * ddy;
        if (d < best) {
          second = best;
          best = d;
          bestShade = seedShade[s];
        } else if (d < second) {
          second = d;
        }
      }
      const edgeDist = Math.sqrt(second) - Math.sqrt(best);
      const isMortar = edgeDist < mortarWidth;
      const idx = (y * size + x) * 4;
      if (isMortar) {
        data[idx] = mr;
        data[idx + 1] = mg;
        data[idx + 2] = mb;
      } else {
        const shade = 1 + (bestShade - 0.5) * (theme.variance / 128);
        data[idx] = clampByte(br * shade);
        data[idx + 1] = clampByte(bg * shade);
        data[idx + 2] = clampByte(bb * shade);
      }
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // A path is exactly the shape anisotropic filtering exists for: a long
  // strip tiled edge-to-edge, receding into the distance under a top-down-
  // ish camera. Without it, isotropic mipmapping picks one blur level for
  // both UV axes and over-blurs the along-path axis; 16 is safely clamped
  // to the GPU's real max internally, no renderer reference needed here.
  texture.anisotropy = currentAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const textureCache = new Map();
const CUSTOM_TILE_SIZE = 256;
let onCustomTextureLoaded = null;

/** Called once by the editor/live client after they fetch the custom path-texture catalog, so a mesh rebuild triggered later can re-run once images are actually loaded. */
export function setCustomPathTextureLoadedCallback(cb) {
  onCustomTextureLoaded = cb;
}

/** Loads an uploaded image into a tileable RepeatWrapping THREE.Texture and caches it under `custom:<id>`. Async — the texture isn't available until it loads; callers should tolerate a transient miss (getPathThemeTexture falls back to 'basic') and re-bake once onCustomTextureLoaded fires. */
export function registerCustomPathTexture(id, url) {
  const key = `custom:${id}`;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const size = CUSTOM_TILE_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    canvas.getContext('2d').drawImage(img, 0, 0, size, size); // stretched to a square repeat tile
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = currentAnisotropy;
    texture.needsUpdate = true;
    textureCache.set(key, texture);
    onCustomTextureLoaded?.(id);
  };
  img.onerror = () => console.error(`Failed to load custom path texture "${id}" from ${url}`);
  img.src = url;
}

/** Lazily-built, cached-per-theme tileable CanvasTexture. Falls back to 'basic' for an unknown builtin id, or a custom upload that hasn't finished loading yet. */
export function getPathThemeTexture(themeId) {
  if (typeof themeId === 'string' && themeId.startsWith('custom:')) {
    return textureCache.get(themeId) || textureCache.get('basic') || getPathThemeTexture('basic');
  }
  const id = themesById[themeId] ? themeId : 'basic';
  if (!textureCache.has(id)) {
    textureCache.set(id, buildThemeTexture(id));
  }
  return textureCache.get(id);
}

/** Small standalone canvas rendering of a theme's texture, for UI swatches (theme picker). Not cached — cheap, called rarely (once per dropdown option). Shows a gray placeholder for a custom upload that hasn't finished loading yet. */
export function renderThemeSwatchCanvas(themeId, sizePx = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  if (typeof themeId === 'string' && themeId.startsWith('custom:') && !textureCache.has(themeId)) {
    ctx.fillStyle = '#444';
    ctx.fillRect(0, 0, sizePx, sizePx);
    return canvas;
  }
  const texture = getPathThemeTexture(themeId);
  ctx.drawImage(texture.image, 0, 0, sizePx, sizePx);
  return canvas;
}
