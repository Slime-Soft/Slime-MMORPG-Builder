// scripts/ground-texture-sheet.mjs
// Renders the ground-texture builtins to a labelled PNG contact sheet, tiled
// 2x2 so a seam shows up if one exists.
//
// The ground textures are baked in the browser onto a <canvas>, which is
// exactly why they were never reviewable outside one: `npm run check:*` has
// nothing to say about pixels, and prop-sheet.mjs only draws geometry. A
// tile can be the wrong colour, be invisible against its own mortar, or not
// wrap — and all three are silent everywhere else.
//
//   node scripts/ground-texture-sheet.mjs --out sheet.png
//   node scripts/ground-texture-sheet.mjs cave-floor cave-rock
//
// The canvas stub below is real enough for the bakers: they only ever
// createImageData / putImageData / getImageData, never draw.
import { writePng, drawText, fill } from './lib/softRaster.mjs';

class StubImageData {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
globalThis.ImageData = StubImageData;
globalThis.document = {
  createElement: () => {
    let stored = null;
    return {
      width: 0, height: 0,
      getContext: () => ({
        createImageData: (w, h) => new StubImageData(w, h),
        putImageData: (img) => { stored = img; },
        getImageData: () => stored,
        drawImage: () => {},
        fillRect: () => {},
      }),
    };
  },
};

const { GROUND_TEXTURE_BUILTIN_DEFS, getGroundTextureTileImageData } =
  await import('../src/render/groundTextureThemes.js');

const argv = process.argv.slice(2);
let out = 'ground-textures.png';
const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') { out = argv[++i]; continue; }
  ids.push(argv[i]);
}
const targets = ids.length
  ? GROUND_TEXTURE_BUILTIN_DEFS.filter((t) => ids.includes(t.id))
  : GROUND_TEXTURE_BUILTIN_DEFS;
if (!targets.length) { console.error('no matching texture ids'); process.exit(2); }

const CELL = 300;      // px per cell (a 2x2 tiling of the 256px source)
const LABEL = 24;
const COLS = Math.min(4, targets.length);
const ROWS = Math.ceil(targets.length / COLS);
const W = COLS * CELL;
const H = ROWS * (CELL + LABEL);
const px = new Uint8Array(W * H * 3);
fill(px, W, H, [20, 22, 26]);

targets.forEach((def, i) => {
  const cx = (i % COLS) * CELL;
  const cy = Math.floor(i / COLS) * (CELL + LABEL);
  const tile = getGroundTextureTileImageData(def.id);
  if (!tile) return;
  // 2x2 repeats, nearest-sampled. Seams read as a hard line down the middle.
  for (let y = 0; y < CELL; y++) {
    for (let x = 0; x < CELL; x++) {
      const sx = Math.floor((x / CELL) * tile.width * 2) % tile.width;
      const sy = Math.floor((y / CELL) * tile.height * 2) % tile.height;
      const s = (sy * tile.width + sx) * 4;
      const d = ((cy + y) * W + cx + x) * 3;
      px[d] = tile.data[s];
      px[d + 1] = tile.data[s + 1];
      px[d + 2] = tile.data[s + 2];
    }
  }
  drawText(px, W, H, `${def.label} (${def.id})`, cx + 6, cy + CELL + 7, [232, 228, 218], 2);
});

writePng(out, px, W, H);
console.log(`${targets.length} texture(s) -> ${out} (${W}x${H})`);
