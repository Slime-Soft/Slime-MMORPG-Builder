// scripts/monster-sheet.mjs
// Renders monster body prefabs to a labelled PNG contact sheet, the same way
// scripts/prop-sheet.mjs does for props — because `npm run check:prefabs` can
// prove a prefab is schema-valid and structurally connected and STILL not tell
// you the wolf reads as a brick with sticks in it.
//
//   node scripts/monster-sheet.mjs                       # every prefab, 3/4 view
//   node scripts/monster-sheet.mjs body-wolf body-goblin # named prefabs
//   node scripts/monster-sheet.mjs body-wolf --views 3q,front,side
//   node scripts/monster-sheet.mjs --pose walk --t 0.25   # posed by a clip
//
// Options
//   --out FILE     output png (default monster-sheet.png)
//   --views LIST   any of 3q,front,side,back,top  (default 3q; 3q,front,side for one)
//   --cell N       cell size in px (default 420)
//   --cols N       columns (default: one row per prefab)
//   --pose CLIP    idle|walk|attack — pose the rig with that authored clip
//   --t N          0..1 position within --pose's clip (default 0.4)
import * as THREE from 'three';
import {
  stubBrowserGlobals, collectTriangles, groundTriangles,
  rasterise, orbitCamera, writePng, drawText, blit, fill,
} from './lib/softRaster.mjs';

stubBrowserGlobals();
const { BODY_PRESETS } = await import('../src/generators/monsterPresets.js');
const { buildCreatureRig } = await import('../src/generators/creatureRig.js');
const { applyIdlePose, applyKeyframeClip } = await import('../src/generators/rig.js');

const VIEWS = {
  '3q': { elevDeg: 14, azimDeg: 34 },
  front: { elevDeg: 6, azimDeg: 90 },
  back: { elevDeg: 6, azimDeg: -90 },
  side: { elevDeg: 6, azimDeg: 0 },
  top: { elevDeg: 70, azimDeg: 45 },
};

const argv = process.argv.slice(2);
const opt = { out: 'monster-sheet.png', views: null, cell: 420, cols: 0, pose: null, t: 0.4 };
const ids = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { ids.push(a); continue; }
  const key = a.slice(2);
  if (!(key in opt)) { console.error(`unknown option --${key}`); process.exit(2); }
  const v = argv[++i];
  opt[key] = (key === 'cell' || key === 'cols' || key === 't') ? Number(v) : v;
}

const chosen = ids.length
  ? ids.map((id) => {
      const p = BODY_PRESETS.find((b) => b.id === id || b.id === `body-${id}` || b.name.toLowerCase() === id.toLowerCase());
      if (!p) { console.error(`unknown prefab "${id}"`); process.exit(2); }
      return p;
    })
  : BODY_PRESETS;

const viewKeys = (opt.views ? opt.views.split(',') : (chosen.length === 1 ? ['3q', 'front', 'side'] : ['3q']))
  .map((v) => v.trim());
for (const v of viewKeys) if (!VIEWS[v]) { console.error(`unknown view "${v}"`); process.exit(2); }

const CELL = opt.cell | 0;
const LABEL_H = 26;
const cols = opt.cols > 0 ? opt.cols : viewKeys.length;
const rows = Math.ceil((chosen.length * viewKeys.length) / cols);
const SHEET_W = cols * CELL;
const SHEET_H = rows * (CELL + LABEL_H);
const sheet = new Uint8Array(SHEET_W * SHEET_H * 3);
fill(sheet, SHEET_W, SHEET_H, [22, 22, 26]);

let cell = 0;
for (const preset of chosen) {
  const { group, rig } = buildCreatureRig(preset);
  applyIdlePose(rig);
  if (opt.pose) {
    const clip = preset.animation?.[`${opt.pose}Clip`];
    if (!clip) console.warn(`  (${preset.name} has no ${opt.pose}Clip — showing rest pose)`);
    else applyKeyframeClip(rig, clip, clip.durationMs * Math.min(1, Math.max(0, opt.t)));
  }
  group.updateMatrixWorld(true);

  const tris = collectTriangles(group);
  const bounds = new THREE.Box3().setFromObject(group);
  // Ground plane sized to the body so the silhouette has something to sit on —
  // a floating leg is far easier to see against a floor than against the void.
  const half = Math.max(1.2, bounds.getSize(new THREE.Vector3()).length());
  groundTriangles(half, tris);
  const framed = bounds.clone().expandByScalar(0.08);

  for (const vk of viewKeys) {
    const camera = orbitCamera(framed, { ...VIEWS[vk], w: CELL, h: CELL, fov: 40, pad: 1.3 });
    const { px } = rasterise({ tris, camera, w: CELL, h: CELL, bg: [28, 28, 34] });
    const cx = (cell % cols) * CELL;
    const cy = Math.floor(cell / cols) * (CELL + LABEL_H);
    blit(sheet, SHEET_W, SHEET_H, px, CELL, CELL, cx, cy);
    const label = `${preset.name} ${vk}${opt.pose ? ` ${opt.pose}` : ''}`.toUpperCase();
    drawText(sheet, SHEET_W, SHEET_H, label, cx + 8, cy + CELL + 7, [235, 215, 170], 2);
    cell++;
  }
  const size = bounds.getSize(new THREE.Vector3());
  // y0 is the ground-contact check: a body whose lowest point is well above 0
  // hovers, and one well below 0 has its feet buried. Neither is visible in a
  // framed render, which always centres the body in the cell.
  const y0 = bounds.min.y;
  const ground = Math.abs(y0) < 0.035 ? '' : (y0 > 0 ? `  FLOATS +${y0.toFixed(3)}` : `  SUNK ${y0.toFixed(3)}`);
  console.log(`  ${preset.name.padEnd(18)} h=${size.y.toFixed(2)}  w=${size.x.toFixed(2)}  d=${size.z.toFixed(2)}  y0=${y0.toFixed(3)}${ground}`);
}

writePng(opt.out, sheet, SHEET_W, SHEET_H);
console.log(`\nwrote ${opt.out}  (${SHEET_W}x${SHEET_H}, ${cell} cells)`);
