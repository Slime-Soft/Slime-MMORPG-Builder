// scripts/prop-sheet.mjs
// Renders props to a labelled PNG contact sheet so they can actually be LOOKED
// at without a browser or a GPU. This is the review half of adding an asset:
// `npm run check:props` proves a prop builds, stands on the ground and matches
// its collider — it cannot tell you the roof has a hole in it, the barrels are
// the size of a house, or the statue's arms are on backwards.
//
//   node scripts/prop-sheet.mjs bench fountain --out sheet.png
//   node scripts/prop-sheet.mjs --category outdoors-decor --out decor.png
//   node scripts/prop-sheet.mjs citywall-gate --views 3q,front,side,eye
//   node scripts/prop-sheet.mjs bench --seeds 1,7,42        # seed variation
//
// Options
//   --out FILE     output png (default prop-sheet.png)
//   --views LIST   any of 3q,front,back,side,top,eye
//                  (default: 3q for many props, 3q,front,side,eye for one)
//   --category ID  every prop in a PROP_CATEGORIES category
//   --all          every prop in the catalog
//   --seeds LIST   comma-separated seeds (default 1)
//   --cell N       cell size in px (default 400)
//   --cols N       columns (default: one row per prop)
//   --no-human     omit the 1.8 m scale figure
//   --lift N       raise every prop N metres before rendering. For the CEILING
//                  props (propTypes' `mounted`), whose mount plane is y=0 and
//                  whose geometry hangs BELOW it — without this they render
//                  underneath the ground plane and you see nothing. `--lift 3
//                  --views eye` is how you look at a ceiling: from under it,
//                  hung at the height it would actually be.
import * as THREE from 'three';
import {
  stubBrowserGlobals, collectTriangles, groundTriangles, humanTriangles,
  rasterise, orbitCamera, eyeLevelCamera, writePng, drawText, blit, fill,
} from './lib/softRaster.mjs';

stubBrowserGlobals();
const { buildProp } = await import('../src/generators/props.js');
const { PROP_TYPES, propTypesIn } = await import('../src/sim/propTypes.js');

// --- args ---
const argv = process.argv.slice(2);
const ids = [];
const opt = { out: 'prop-sheet.png', views: null, seeds: [1], cell: 400, cols: 0, human: true, lift: 0 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--no-human') { opt.human = false; continue; }
  if (a === '--all') { ids.push(...PROP_TYPES.filter((p) => p.id !== 'custom' && p.id !== 'model').map((p) => p.id)); continue; }
  if (a === '--category') { ids.push(...propTypesIn(argv[++i]).map((p) => p.id)); continue; }
  if (a === '--out') { opt.out = argv[++i]; continue; }
  if (a === '--views') { opt.views = argv[++i].split(',').map((s) => s.trim()); continue; }
  if (a === '--seeds') { opt.seeds = argv[++i].split(',').map(Number); continue; }
  if (a === '--cell') { opt.cell = Number(argv[++i]); continue; }
  if (a === '--cols') { opt.cols = Number(argv[++i]); continue; }
  if (a === '--lift') { opt.lift = Number(argv[++i]); continue; }
  if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  ids.push(a);
}
if (!ids.length) {
  console.error('usage: node scripts/prop-sheet.mjs <propType...> [--category id] [--all] [--out sheet.png]');
  process.exit(2);
}
const VIEWS = opt.views ?? (ids.length * opt.seeds.length === 1 ? ['3q', 'front', 'side', 'eye'] : ['3q']);

const CELL = opt.cell | 0;
const LABEL_H = 26;
const PAD = 6;
const BAR = [26, 28, 34];

/** Azimuth/elevation per named view. Front is +Z by this library's convention. */
const VIEW_ANGLES = {
  '3q': { azim: 35, elev: 20 },
  front: { azim: 90, elev: 10 },
  back: { azim: -90, elev: 10 },
  side: { azim: 0, elev: 10 },
  top: { azim: 45, elev: 65 },
};

const cells = [];
for (const id of ids) {
  for (const seed of opt.seeds) {
    let prop;
    try {
      prop = buildProp(id, seed);
    } catch (err) {
      cells.push({ id, seed, error: String(err.message || err) });
      continue;
    }
    if (opt.lift) { prop.position.y += opt.lift; prop.updateMatrixWorld(true); }
    const tris = collectTriangles(prop);
    const propBounds = new THREE.Box3().setFromObject(prop);
    if (!Number.isFinite(propBounds.min.x)) {
      cells.push({ id, seed, error: 'no geometry' });
      continue;
    }
    const size = propBounds.getSize(new THREE.Vector3());

    const scene = [...tris];
    const framed = propBounds.clone();
    if (opt.human) {
      const hx = propBounds.min.x - 0.9;
      humanTriangles(hx, propBounds.max.z + 0.4, scene);
      framed.expandByPoint(new THREE.Vector3(hx - 0.4, 0, propBounds.max.z + 0.4));
      framed.expandByPoint(new THREE.Vector3(hx + 0.4, 1.85, propBounds.max.z + 0.4));
    }
    // Ground last is fine — the depth buffer sorts it — and its extent follows
    // the framed bounds so a 20 m tower still stands on a visible floor.
    groundTriangles(Math.max(size.x, size.z) * 1.4 + 4, scene);

    for (const view of VIEWS) {
      const w = CELL, h = CELL;
      const ang = VIEW_ANGLES[view] ?? VIEW_ANGLES['3q'];
      const camera = view === 'eye'
        ? eyeLevelCamera(framed, { dist: Math.max(4, Math.max(size.x, size.z) * 1.1 + size.y * 0.55), w, h })
        : orbitCamera(framed, { elevDeg: ang.elev, azimDeg: ang.azim, w, h });
      const { px, coverage } = rasterise({ tris: scene, camera, w, h });
      cells.push({ id, seed, view, px, coverage, size, tris: tris.length });
    }
  }
}

// --- lay out ---
const cols = opt.cols || VIEWS.length;
const rows = Math.ceil(cells.length / cols);
const SW = cols * (CELL + PAD) + PAD;
const SH = rows * (CELL + LABEL_H + PAD) + PAD;
const sheet = new Uint8Array(SW * SH * 3);
fill(sheet, SW, SH, BAR);

cells.forEach((c, i) => {
  const cx = PAD + (i % cols) * (CELL + PAD);
  const cy = PAD + Math.floor(i / cols) * (CELL + LABEL_H + PAD);
  if (c.error) {
    drawText(sheet, SW, SH, `${c.id}: ${c.error}`.slice(0, 40), cx + 6, cy + 8, [255, 90, 90], 2);
    return;
  }
  blit(sheet, SW, SH, c.px, CELL, CELL, cx, cy);
  const name = `${c.id} (${c.view})`;
  // W x H x D in metres plus the triangle budget — the two numbers that decide
  // whether a prop is the right size and whether it's affordable to scatter.
  const dims = `${c.size.x.toFixed(1)}x${c.size.y.toFixed(1)}x${c.size.z.toFixed(1)}M ${c.tris}T`;
  drawText(sheet, SW, SH, name, cx + 4, cy + CELL + 6, [235, 235, 240], 2);
  drawText(sheet, SW, SH, dims, cx + CELL - dims.length * 6 - 4, cy + CELL + 9, [140, 165, 190], 1);
});

writePng(opt.out, sheet, SW, SH);
const bad = cells.filter((c) => c.error);
console.log(`${cells.length} cell(s) -> ${opt.out} (${SW}x${SH})`);
for (const c of cells) {
  if (c.error) console.log(`  ERROR ${c.id}: ${c.error}`);
}
process.exit(bad.length ? 1 : 0);
