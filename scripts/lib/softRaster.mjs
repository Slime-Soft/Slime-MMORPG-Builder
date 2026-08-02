// scripts/lib/softRaster.mjs
// A tiny software rasteriser + PNG writer, extracted from scripts/render-prop.mjs
// so more than one tool can use it.
//
// WHY A SOFTWARE RASTERISER AT ALL: this project's WebGL scene can't be
// screenshotted reliably from a headless/backgrounded tab (a hidden tab pauses
// requestAnimationFrame, so the canvas never composites — see PROJECT_STATUS's
// notes on that). Every visual defect this library has shipped — a hole in a
// roof, a floating post, a stall with daylight between its stripes — was only
// ever findable by LOOKING at the thing. This makes looking cheap: pure Node,
// no browser, no GPU, no dependencies beyond three itself.
//
// It is a SHAPE viewer, not a preview of the game's renderer: no shadows, no
// toon ramp, no bloom, no textures. Silhouette, proportion, part placement and
// colour are what it answers.
//
// The background is MAGENTA on purpose. Anything that should be solid and
// isn't shows sky-through-the-model in a colour that exists nowhere in the
// environment palette, so a hole is impossible to mistake for shading.
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const MAGENTA = [255, 0, 200];

/**
 * Stub out the browser APIs the generator library reaches for at import time.
 * Must be called BEFORE importing anything that pulls in props.js — ez-tree
 * calls TextureLoader.load() at module-evaluation time and fluffyTree.js builds
 * a canvas texture, neither of which exists under plain Node. Same reasoning
 * (and same ordering constraint) as scripts/check-props.mjs's stubs.
 */
export function stubBrowserGlobals() {
  THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
  if (typeof globalThis.document === 'undefined') {
    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop });
    globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  }
}

/**
 * Flatten an Object3D into world-space triangles with a resolved colour.
 * Emissive is folded into the colour rather than being lit, so a lantern's
 * glass or a brazier's coals read as bright instead of as dark glass.
 * @returns {Array<{a:THREE.Vector3,b:THREE.Vector3,c:THREE.Vector3,col:THREE.Color,unlit:number}>}
 */
export function collectTriangles(root, out = []) {
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const m = mats[0];
    const col = m?.color ? m.color.clone() : new THREE.Color(0xcccccc);
    // How much of this surface ignores the light entirely (0 = fully lit).
    let unlit = 0;
    if (m?.emissive) {
      const e = m.emissive.clone().multiplyScalar(m.emissiveIntensity ?? 1);
      unlit = Math.min(1, Math.max(e.r, e.g, e.b));
      if (unlit > 0.01) col.lerp(e, 0.5);
    }
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const v = (i) => new THREE.Vector3()
      .fromBufferAttribute(pos, idx ? idx.getX(i) : i)
      .applyMatrix4(o.matrixWorld);
    for (let i = 0; i + 2 < n; i += 3) out.push({ a: v(i), b: v(i + 1), c: v(i + 2), col, unlit });
  });
  return out;
}

/** A checkered ground plane, 1 metre per square, so scale is readable. */
export function groundTriangles(halfExtent, out = []) {
  const g = Math.max(2, halfExtent);
  const step = 1;
  const n = Math.ceil(g / step);
  const p = (x, z) => new THREE.Vector3(x, 0, z);
  // Deliberately NEUTRAL GREY, not grass green: with a green ground, a green
  // stripe on a prop's roof reads as grass showing through a hole that isn't
  // there. Magenta = sky = a real hole; grey = ground; anything else = the prop.
  const light = new THREE.Color(0x9a9a96), dark = new THREE.Color(0x86867f);
  for (let i = -n; i < n; i++) {
    for (let j = -n; j < n; j++) {
      const x0 = i * step, z0 = j * step, x1 = x0 + step, z1 = z0 + step;
      const col = (i + j) & 1 ? light : dark;
      out.push({ a: p(x0, z0), b: p(x1, z0), c: p(x1, z1), col, unlit: 0 });
      out.push({ a: p(x0, z0), b: p(x1, z1), c: p(x0, z1), col, unlit: 0 });
    }
  }
  return out;
}

/**
 * A 1.8 m human stand-in, so "is this prop the right size" is answerable at a
 * glance. Flat slate blue — a colour nothing in the environment palette uses.
 */
export function humanTriangles(x, z, out = []) {
  const col = new THREE.Color(0x2f4f6f);
  const box = (w, h, d, cx, cy, cz) => {
    const g = new THREE.BoxGeometry(w, h, d).translate(cx, cy, cz);
    const pos = g.attributes.position, idx = g.index;
    for (let i = 0; i + 2 < idx.count; i += 3) {
      const v = (j) => new THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + j));
      out.push({ a: v(0), b: v(1), c: v(2), col, unlit: 0 });
    }
  };
  box(0.40, 0.72, 0.24, x, 1.22, z);        // torso
  box(0.22, 0.24, 0.22, x, 1.70, z);        // head
  box(0.14, 0.86, 0.16, x - 0.11, 0.43, z); // legs
  box(0.14, 0.86, 0.16, x + 0.11, 0.43, z);
  box(0.11, 0.62, 0.13, x - 0.25, 1.25, z); // arms
  box(0.11, 0.62, 0.13, x + 0.25, 1.25, z);
  return out;
}

/**
 * Rasterise triangles into an RGB byte buffer.
 * @param {object} o
 * @param {Array} o.tris          from collectTriangles/groundTriangles
 * @param {THREE.Camera} o.camera positioned and with matrices updated
 * @param {number} o.w @param {number} o.h
 * @param {number[]} [o.bg]       background RGB
 * @returns {{px: Uint8Array, coverage: number}} coverage = fraction of pixels drawn
 */
export function rasterise({ tris, camera, w, h, bg = MAGENTA }) {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  const viewProj = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { px[i * 3] = bg[0]; px[i * 3 + 1] = bg[1]; px[i * 3 + 2] = bg[2]; }
  const depth = new Float32Array(w * h).fill(Infinity);

  // Key + fill + sky ambient. A single key light leaves every surface facing
  // away from it identically black, which reads as one flat silhouette and
  // hides exactly the part-placement errors this exists to catch.
  const KEY = new THREE.Vector3(0.45, 0.78, 0.44).normalize();
  const FILL = new THREE.Vector3(-0.6, 0.25, -0.5).normalize();

  const clip = new THREE.Vector4();
  const project = (v) => {
    clip.set(v.x, v.y, v.z, 1).applyMatrix4(viewProj);
    if (clip.w <= 1e-6) return null; // no near-plane clipping: good enough for a viewer
    return { x: (clip.x / clip.w * 0.5 + 0.5) * w, y: (1 - (clip.y / clip.w * 0.5 + 0.5)) * h, w: clip.w };
  };

  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nrm = new THREE.Vector3();
  for (const t of tris) {
    const p0 = project(t.a), p1 = project(t.b), p2 = project(t.c);
    if (!p0 || !p1 || !p2) continue;
    ab.subVectors(t.b, t.a); ac.subVectors(t.c, t.a); nrm.crossVectors(ab, ac);
    if (nrm.lengthSq() < 1e-16) continue;
    nrm.normalize();
    // Two-sided lighting: these are closed solids, but a hole exposes a
    // backface and it should still be lit rather than turning black and
    // reading as a hole of its own.
    const shade = 0.34 + 0.56 * Math.abs(nrm.dot(KEY)) + 0.16 * Math.abs(nrm.dot(FILL));
    const lit = t.unlit + (1 - t.unlit) * shade;
    const r = Math.min(255, t.col.r * 255 * lit) | 0;
    const g = Math.min(255, t.col.g * 255 * lit) | 0;
    const b = Math.min(255, t.col.b * 255 * lit) | 0;

    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x, p2.x)));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(p0.x, p1.x, p2.x)));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y, p2.y)));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(p0.y, p1.y, p2.y)));
    const area = (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const cx = x + 0.5, cy = y + 0.5;
        const w0 = ((p1.x - cx) * (p2.y - cy) - (p2.x - cx) * (p1.y - cy)) / area;
        const w1 = ((p2.x - cx) * (p0.y - cy) - (p0.x - cx) * (p2.y - cy)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        // Perspective-correct depth: interpolate 1/w, keep the nearest.
        const z = 1 / (w0 / p0.w + w1 / p1.w + w2 / p2.w);
        const o = y * w + x;
        if (z >= depth[o]) continue;
        depth[o] = z;
        px[o * 3] = r; px[o * 3 + 1] = g; px[o * 3 + 2] = b;
      }
    }
  }
  let drawn = 0;
  for (let i = 0; i < w * h; i++) if (depth[i] !== Infinity) drawn++;
  return { px, coverage: drawn / (w * h) };
}

/**
 * Frame a bounding box from an orbit angle.
 * @param {THREE.Box3} bounds
 * @param {{elevDeg:number, azimDeg:number, w:number, h:number, fov?:number, pad?:number}} o
 */
export function orbitCamera(bounds, { elevDeg, azimDeg, w, h, fov = 42, pad = 1.18 }) {
  const centre = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(1e-3, size.length() / 2);
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.05, 4000);
  const a = THREE.MathUtils.degToRad(azimDeg), e = THREE.MathUtils.degToRad(elevDeg);
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(fov) / 2)) * pad;
  cam.position.set(
    centre.x + Math.cos(e) * Math.cos(a) * dist,
    centre.y + Math.sin(e) * dist,
    centre.z + Math.cos(e) * Math.sin(a) * dist
  );
  cam.lookAt(centre);
  return cam;
}

/** Stand `dist` metres away at `eye` height and look at the object's middle. */
export function eyeLevelCamera(bounds, { dist, eye = 1.65, azimDeg = 35, w, h, fov = 55 }) {
  const centre = bounds.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(fov, w / h, 0.05, 4000);
  const a = THREE.MathUtils.degToRad(azimDeg);
  cam.position.set(Math.cos(a) * dist, eye, Math.sin(a) * dist);
  cam.lookAt(new THREE.Vector3(0, Math.min(centre.y, eye + 1.2), 0));
  return cam;
}

// --- a 5x7 bitmap font, so a contact sheet can label its own cells ---
// Each glyph is 7 rows of 5 bits, most-significant bit leftmost.
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e], D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e], J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e], V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], 1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f], 3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], 5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], 7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e], 9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  '-': [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00], '.': [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0], '/': [0x01, 0x02, 0x02, 0x04, 0x08, 0x08, 0x10],
  '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02], ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08],
  '%': [0x19, 0x1a, 0x02, 0x04, 0x08, 0x0b, 0x13], ' ': [0, 0, 0, 0, 0, 0, 0],
};

/** Draw text into an RGB buffer. `scale` pixels per font pixel. */
export function drawText(px, w, h, text, x0, y0, rgb = [255, 255, 255], scale = 2) {
  let cx = x0;
  for (const ch of String(text).toUpperCase()) {
    const glyph = FONT[ch] || FONT[' '];
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (!(glyph[r] & (1 << (4 - c)))) continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const x = cx + c * scale + sx, y = y0 + r * scale + sy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const o = (y * w + x) * 3;
            px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2];
          }
        }
      }
    }
    cx += 6 * scale;
  }
}

/** Copy a `sw x sh` tile into a bigger buffer at (dx, dy). */
export function blit(dst, dw, dh, src, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dh) continue;
    for (let x = 0; x < sw; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dw) continue;
      const s = (y * sw + x) * 3, d = (ty * dw + tx) * 3;
      dst[d] = src[s]; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2];
    }
  }
}

export function fill(px, w, h, rgb) {
  for (let i = 0; i < w * h; i++) { px[i * 3] = rgb[0]; px[i * 3 + 1] = rgb[1]; px[i * 3 + 2] = rgb[2]; }
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

/** @param {Uint8Array} px RGB, row-major */
export function writePng(path, px, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    Buffer.from(px.buffer, px.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}
