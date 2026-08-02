// src/render/mountainThemes.js
// Procedurally-baked, tileable mountain/rock textures — one per theme, no
// external image files (CLAUDE.md's "all assets generated at runtime"
// rule). Structurally identical to src/render/pathThemes.js's cellular
// flagstone baker (same algorithm, rock-flavored palettes/cell sizing) —
// kept as its own parallel file rather than sharing code with paths, same
// "duplicate the small self-contained system" call this codebase already
// made for zones' freeform draft state vs. paths' draft state.
import * as THREE from 'three';
import { currentAnisotropy } from './renderSettings.js';

export const MOUNTAIN_THEME_DEFS = [
  {
    id: 'rock',
    label: 'Grey Rock',
    base: [120, 116, 108],
    variance: 30,
    mortar: [58, 54, 48],
    cellCount: 60,
    mortarWidth: 3.5,
  },
  {
    id: 'snow-cap',
    label: 'Snow-Capped Rock',
    base: [235, 238, 242],
    variance: 10,
    mortar: [188, 196, 206],
    cellCount: 50,
    mortarWidth: 2.2,
  },
  {
    id: 'red-rock',
    label: 'Red Rock',
    base: [168, 96, 68],
    variance: 28,
    mortar: [104, 54, 38],
    cellCount: 55,
    mortarWidth: 3.2,
  },
];

const themesById = Object.fromEntries(MOUNTAIN_THEME_DEFS.map((t) => [t.id, t]));

/** Deterministic per-string seed, mirroring pathThemes.js's hashStringToSeed. */
function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0;
}

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

const TEXTURE_SIZE = 128; // see pathThemes.js's TEXTURE_SIZE comment — same load-time-bake-all-swatches cost tradeoff

/** Bakes a seamlessly-tileable cellular rock-fracture pattern — same nearest-seed-with-wrapped-copies technique as pathThemes.js's flagstone bake. */
function buildThemeTexture(themeId) {
  const theme = themesById[themeId] || themesById.rock;
  const size = TEXTURE_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const rng = mulberry32(hashStringToSeed(theme.id));
  const seeds = [];
  for (let i = 0; i < theme.cellCount; i++) {
    seeds.push([rng() * size, rng() * size, rng()]);
  }

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const [br, bg, bb] = theme.base;
  const [mr, mg, mb] = theme.mortar;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity;
      let second = Infinity;
      let bestSeed = seeds[0];
      for (const seed of seeds) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const sx = seed[0] + dx * size;
            const sy = seed[1] + dy * size;
            const d = (sx - x) * (sx - x) + (sy - y) * (sy - y);
            if (d < best) {
              second = best;
              best = d;
              bestSeed = seed;
            } else if (d < second) {
              second = d;
            }
          }
        }
      }
      const edgeDist = Math.sqrt(second) - Math.sqrt(best);
      const isMortar = edgeDist < theme.mortarWidth;
      const idx = (y * size + x) * 4;
      if (isMortar) {
        data[idx] = mr;
        data[idx + 1] = mg;
        data[idx + 2] = mb;
      } else {
        const shade = 1 + (bestSeed[2] - 0.5) * (theme.variance / 128);
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
  texture.anisotropy = currentAnisotropy; // a mountain ribbon tiles into the distance same as a path — see pathThemes.js's comment
  texture.needsUpdate = true;
  return texture;
}

function clampByte(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

const textureCache = new Map();

/** Lazily-built, cached-per-theme tileable CanvasTexture. */
export function getMountainThemeTexture(themeId) {
  const id = themesById[themeId] ? themeId : 'rock';
  if (!textureCache.has(id)) {
    textureCache.set(id, buildThemeTexture(id));
  }
  return textureCache.get(id);
}

/** Small standalone canvas rendering of a theme's texture, for UI swatches (theme picker). */
export function renderMountainThemeSwatchCanvas(themeId, sizePx = 32) {
  const canvas = document.createElement('canvas');
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext('2d');
  const texture = getMountainThemeTexture(themeId);
  ctx.drawImage(texture.image, 0, 0, sizePx, sizePx);
  return canvas;
}
