// scripts/render-prop.mjs
// Renders a prop to a PNG with a tiny software rasteriser — no WebGL, no browser.
//
// WHY THIS EXISTS: the sandboxed Browser pane can refuse to composite frames
// ("the Browser pane is not displayed"), which makes screenshots impossible, and
// a numeric check cannot answer "does this look right". This does not replace the
// game's renderer — it is a shape/silhouette viewer. It deliberately paints the
// background MAGENTA, so any hole through a prop that should be solid is
// impossible to miss.
//
//   node scripts/render-prop.mjs market-stall out.png [--elev 8] [--azim 30]
//                                              [--seed 1] [--w 900] [--h 640]
//                                              [--eye 1.7] [--dist 6] [--fov 45]
//
// --eye/--dist place the camera at a player's eye height at a given distance
// instead of the default framed orbit, which is how grazing-angle defects show up.
import * as THREE from 'three';
import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
}
const { buildProp } = await import('../src/generators/props.js');

// --- args ---
const [type, outPath = 'prop.png', ...rest] = process.argv.slice(2);
if (!type) {
  console.error('usage: node scripts/render-prop.mjs <propType> [out.png] [--elev N] [--azim N] ...');
  process.exit(2);
}
const opt = { elev: 20, azim: 35, seed: 1, w: 900, h: 640, fov: 45, eye: null, dist: null };
for (let i = 0; i < rest.length; i += 2) {
  const key = rest[i].replace(/^--/, '');
  if (!(key in opt)) { console.error(`unknown option --${key}`); process.exit(2); }
  opt[key] = Number(rest[i + 1]);
}
const W = opt.w | 0, H = opt.h | 0;

// --- gather world-space triangles ---
const prop = buildProp(type, opt.seed);
prop.updateMatrixWorld(true);
const tris = [];
const bounds = new THREE.Box3().setFromObject(prop);
prop.traverse((o) => {
  if (!o.isMesh) return;
  const g = o.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const n = idx ? idx.count : pos.count;
  const col = o.material?.color ? o.material.color.clone() : new THREE.Color(0xcccccc);
  const get = (i) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
  for (let i = 0; i < n; i += 3) tris.push({ a: get(i), b: get(i + 1), c: get(i + 2), col });
});

// A ground plane, so a hole in a roof reads as magenta SKY rather than as ground.
// Tessellated, not two huge triangles: there is no near-plane clipping below, so
// a triangle with any vertex behind the camera is dropped whole — one big quad
// would silently vanish the moment the camera stood on it.
{
  const g = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * 6 + 12;
  const N = 40, step = (g * 2) / N;
  const p = (x, z) => new THREE.Vector3(x, 0, z);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const x0 = -g + i * step, z0 = -g + j * step, x1 = x0 + step, z1 = z0 + step;
      // Deliberately NEUTRAL GREY, not grass green: with a green ground, a green
      // stripe on a prop's roof reads as grass showing through a hole that isn't
      // there. Magenta = sky = a real hole; grey = ground; anything else = the prop.
      const col = new THREE.Color((i + j) % 2 ? 0x9a9a96 : 0x8c8c88); // faint checker, for scale
      tris.push({ a: p(x0, z0), b: p(x1, z0), c: p(x1, z1), col });
      tris.push({ a: p(x0, z0), b: p(x1, z1), c: p(x0, z1), col });
    }
  }
}

// --- camera ---
const centre = bounds.getCenter(new THREE.Vector3());
const size = bounds.getSize(new THREE.Vector3());
const radius = Math.max(size.x, size.y, size.z);
const azim = THREE.MathUtils.degToRad(opt.azim);
const elev = THREE.MathUtils.degToRad(opt.elev);
let eyePos, target;
if (opt.eye !== null || opt.dist !== null) {
  // Player's-eye framing: stand `dist` away at height `eye`, look at the prop.
  const d = opt.dist ?? radius * 1.6;
  eyePos = new THREE.Vector3(Math.cos(azim) * d, opt.eye ?? 1.7, Math.sin(azim) * d);
  target = new THREE.Vector3(0, centre.y, 0);
} else {
  const d = radius * 2.1;
  eyePos = new THREE.Vector3(
    centre.x + Math.cos(elev) * Math.cos(azim) * d,
    centre.y + Math.sin(elev) * d,
    centre.z + Math.cos(elev) * Math.sin(azim) * d
  );
  target = centre.clone();
}
const cam = new THREE.PerspectiveCamera(opt.fov, W / H, 0.05, 2000);
cam.position.copy(eyePos);
cam.lookAt(target);
cam.updateMatrixWorld(true);
cam.updateProjectionMatrix();
const viewProj = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);

// --- rasterise ---
const LIGHT = new THREE.Vector3(0.45, 0.8, 0.35).normalize();
const BG = [255, 0, 200];
const px = new Uint8Array(W * H * 3);
for (let i = 0; i < W * H; i++) { px[i * 3] = BG[0]; px[i * 3 + 1] = BG[1]; px[i * 3 + 2] = BG[2]; }
const depth = new Float32Array(W * H).fill(Infinity);

const clip = new THREE.Vector4();
const project = (v) => {
  clip.set(v.x, v.y, v.z, 1).applyMatrix4(viewProj);
  if (clip.w <= 1e-6) return null;
  return {
    x: (clip.x / clip.w * 0.5 + 0.5) * W,
    y: (1 - (clip.y / clip.w * 0.5 + 0.5)) * H,
    w: clip.w,
  };
};

const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
let drawn = 0;
for (const t of tris) {
  const p0 = project(t.a), p1 = project(t.b), p2 = project(t.c);
  if (!p0 || !p1 || !p2) continue; // no near-plane clipping: good enough for a viewer
  ab.subVectors(t.b, t.a); ac.subVectors(t.c, t.a); nrm.crossVectors(ab, ac);
  if (nrm.lengthSq() < 1e-16) continue;
  nrm.normalize();
  // Two-sided lighting: these are closed solids, but a hole exposes a backface
  // and it should still be lit rather than turning black and reading as a hole.
  const lambert = Math.abs(nrm.dot(LIGHT));
  const shade = 0.32 + 0.68 * lambert;
  const r = Math.min(255, t.col.r * 255 * shade) | 0;
  const g = Math.min(255, t.col.g * 255 * shade) | 0;
  const b = Math.min(255, t.col.b * 255 * shade) | 0;

  const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
  const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
  const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  if (Math.abs(area) < 1e-9) continue;
  drawn++;
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const w0 = ((p1.x - cx) * (p2.y - cy) - (p2.x - cx) * (p1.y - cy)) / area;
      const w1 = ((p2.x - cx) * (p0.y - cy) - (p0.x - cx) * (p2.y - cy)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      // Perspective-correct depth: interpolate 1/w, keep the nearest.
      const invW = w0 / p0.w + w1 / p1.w + w2 / p2.w;
      const z = 1 / invW;
      const o = y * W + x;
      if (z >= depth[o]) continue;
      depth[o] = z;
      px[o * 3] = r; px[o * 3 + 1] = g; px[o * 3 + 2] = b;
    }
  }
}

// --- PNG encode (zlib is built in; no image library needed) ---
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (name, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(name, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
const raw = Buffer.alloc(H * (W * 3 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}
writeFileSync(outPath, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
]));

let bgPixels = 0;
for (let i = 0; i < W * H; i++) if (depth[i] === Infinity) bgPixels++;
console.log(`${type} -> ${outPath}  ${W}x${H}, ${tris.length} tris (${drawn} rasterised), ` +
  `${((bgPixels / (W * H)) * 100).toFixed(1)}% background`);
