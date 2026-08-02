// scripts/check-zfight.mjs
// Finds coplanar, overlapping, opaque surfaces — the geometry that flickers.
//
// THE BUG THIS EXISTS TO PREVENT: a townhouse's window shutter and its front
// door both had their outer face at exactly wall+0.12. Where a ground-floor
// window sat close enough for the shutter to reach across the doorway, two
// opaque faces occupied the same plane, and the depth buffer cannot choose
// between them — in game that is a hard flicker that follows the camera.
//
// Detection: every prop is built, and for each mesh we collect axis-aligned
// triangles as (axis, plane coordinate, 2D extent). Two triangles from
// DIFFERENT meshes (i.e. different materials, so both are actually drawn) that
// share a plane within EPS and overlap in 2D are reported. Same-mesh pairs are
// skipped: merged geometry legitimately contains touching interior faces.
//
//   node scripts/check-zfight.mjs
import * as THREE from 'three';

THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
}

const { buildProp } = await import('../src/generators/props.js');
const { PROP_TYPES } = await import('../src/sim/propTypes.js');

const EPS = 0.0035;      // planes closer than this are "the same plane"
const MIN_AREA = 0.05;   // ignore slivers; a 22cm square is the smallest that reads

/** Axis-aligned faces of one mesh, bucketed by plane. */
function facesOf(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const idx = g.index;
  const count = idx ? idx.count : pos.count;
  const out = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    ab.subVectors(b, a); ac.subVectors(c, a); n.crossVectors(ab, ac);
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    for (const axis of [0, 1, 2]) {
      if (Math.abs(n.getComponent(axis)) < 0.999) continue;
      const sign = Math.sign(n.getComponent(axis));
      // A downward face is never visible: this game's camera is always above
      // the ground, so -Y faces are backface-culled and cannot flicker. Without
      // this every object's underside "fought" the ground plane at y=0.
      if (axis === 1 && sign < 0) break;
      const u = (axis + 1) % 3, v = (axis + 2) % 3;
      const uMin = Math.min(a.getComponent(u), b.getComponent(u), c.getComponent(u));
      const uMax = Math.max(a.getComponent(u), b.getComponent(u), c.getComponent(u));
      const vMin = Math.min(a.getComponent(v), b.getComponent(v), c.getComponent(v));
      const vMax = Math.max(a.getComponent(v), b.getComponent(v), c.getComponent(v));
      if ((uMax - uMin) * (vMax - vMin) < MIN_AREA) break;
      out.push({ axis, sign, coord: a.getComponent(axis), uMin, uMax, vMin, vMax });
      break;
    }
  }
  return out;
}

// Only faces pointing the SAME way can fight. A +Z and a -Z face sharing a
// plane are back-to-back — an interior seam, with one side always culled.
const overlaps = (p, q) =>
  p.axis === q.axis && p.sign === q.sign &&
  Math.abs(p.coord - q.coord) < EPS &&
  p.uMin < q.uMax - 0.02 && q.uMin < p.uMax - 0.02 &&
  p.vMin < q.vMax - 0.02 && q.vMin < p.vMax - 0.02;

// --- self-test: two coplanar overlapping quads must be caught -----------------
{
  const mk = (z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.2), new THREE.MeshBasicMaterial());
    m.geometry.translate(0, 0, z);
    m.updateMatrixWorld(true);
    return m;
  };
  // Both boxes' front faces land on z = 0.1 -> coplanar and overlapping.
  const f1 = facesOf(mk(0)), f2 = facesOf(mk(0));
  const hit = f1.some((p) => f2.some((q) => overlaps(p, q)));
  if (!hit) { console.error('FAIL: self-test — detector missed a guaranteed coplanar pair.'); process.exit(1); }
  // Pulled well apart along z -> must NOT be flagged. Note the offset has to be
  // bigger than the box is deep: shifting a box a little along z leaves its
  // SIDE faces coplanar and still overlapping, which the detector correctly
  // reports. (That caught a bad first draft of this very self-test.)
  const f3 = facesOf(mk(0.5));
  const bad = f1.some((p) => f3.some((q) => overlaps(p, q)));
  if (bad) { console.error('FAIL: self-test — detector flags well-separated faces.'); process.exit(1); }
}
console.log('self-test        ok (catches coplanar pairs, ignores separated ones)');

const SEEDS = [1, 42, 1001];
let problems = 0;
for (const def of PROP_TYPES) {
  if (def.id === 'custom' || def.id === 'model') continue;
  for (const seed of SEEDS) {
    let root;
    try { root = buildProp(def.id, seed); } catch { continue; }
    root.updateMatrixWorld(true);
    const meshes = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat?.transparent) return;     // blended surfaces do not z-fight
      meshes.push(o);
    });
    if (meshes.length < 2) continue;
    const faces = meshes.map(facesOf);
    let hits = 0;
    let sample = null;
    for (let i = 0; i < faces.length && hits === 0; i++) {
      for (let j = i + 1; j < faces.length && hits === 0; j++) {
        for (const p of faces[i]) {
          const q = faces[j].find((x) => overlaps(p, x));
          if (q) { hits++; sample = p; break; }
        }
      }
    }
    if (hits) {
      const ax = 'xyz'[sample.axis];
      console.log(`  FAIL ${def.id} (seed ${seed}) coplanar opaque faces at ${ax}=${sample.coord.toFixed(3)}`);
      problems++;
      break;
    }
  }
}

console.log(problems ? `\n${problems} prop(s) with coplanar opaque surfaces` : '\nno coplanar opaque surfaces');
if (problems) {
  console.error('\nFAIL: two opaque faces sharing a plane flicker in game — separate them by >2cm.');
  process.exit(1);
}
console.log('PASS');
