// scripts/check-embedded.mjs
// Two defects that kept shipping in the trade buildings, now checked:
//
//   BURIED   — a prop swallowed by the wall it stands against. The tailor's
//              shopfront was built on the ground-floor face at z = Dp/2 while
//              the jettied upper storey overhangs to Dp/2 + 0.21, so the
//              counter and its cloth sat 21 cm INSIDE the floor above and
//              looked embedded in the building.
//   BLOCKED  — something parked in the front doorway. Happened three times in
//              a row: a workbench, a barrel, then a whole shopfront across it.
//
// Neither is visible to check:props (everything builds and stands on the
// ground), check:parts (everything is attached — that is the problem) or
// check:zfight (overlapping volumes share no plane).
//
//   node scripts/check-embedded.mjs [propType...]
//
// The door is found by the `materialKey === 'door'` tag townhouse.js's kit
// writes onto each merged mesh, so this works whatever the shell is rotated to.
import * as THREE from 'three';

THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
}

const { buildProp } = await import('../src/generators/props.js');

/** Buildings assembled as a townhouse shell plus loose dressing. */
const TARGETS = [
  'bld-blacksmith', 'bld-tailor', 'bld-carpenter',
  'bld-alchemist', 'bld-jeweler', 'bld-church', 'bld-bakery', 'bld-cooking', 'bld-tannery',
];

const DOOR_REACH = 1.5;    // how far in front of the door must stay clear
const DOOR_PAD = 0.25;     // and how far to either side of the leaf
const BURIED_MIN = 0.1;    // overlap on ALL three axes to count as embedded

/** Split a mesh into its original primitives by welding vertices. */
function prims(mesh, out = []) {
  const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  const n = idx ? idx.count : pos.count, tri = Math.floor(n / 3);
  if (!tri) return out;
  const uf = new Int32Array(tri);
  for (let i = 0; i < tri; i++) uf[i] = i;
  const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
  const vi = (i) => (idx ? idx.getX(i) : i);
  const seen = new Map(), q = (v) => Math.round(v * 1e4);
  for (let t = 0; t < tri; t++) {
    for (let c = 0; c < 3; c++) {
      const v = vi(t * 3 + c);
      const key = `${q(pos.getX(v))},${q(pos.getY(v))},${q(pos.getZ(v))}`;
      const p = seen.get(key);
      if (p === undefined) seen.set(key, t);
      else { const a = find(p), b = find(t); if (a !== b) uf[a] = b; }
    }
  }
  const groups = new Map(), v = new THREE.Vector3();
  for (let t = 0; t < tri; t++) {
    const r = find(t);
    let b = groups.get(r);
    if (!b) { b = new THREE.Box3().makeEmpty(); groups.set(r, b); }
    for (let c = 0; c < 3; c++) {
      v.fromBufferAttribute(pos, vi(t * 3 + c)).applyMatrix4(mesh.matrixWorld);
      b.expandByPoint(v);
    }
  }
  out.push(...groups.values());
  return out;
}

/**
 * The volume a player needs to reach the door: the leaf's own footprint pushed
 * outward along its thinnest axis, away from the building's centre.
 */
function doorwayBox(doorMesh, centre) {
  const b = new THREE.Box3().setFromObject(doorMesh);
  const s = b.getSize(new THREE.Vector3());
  const c = b.getCenter(new THREE.Vector3());
  const thin = s.x < s.z ? 'x' : 'z';       // the leaf is thin through the wall
  const wide = thin === 'x' ? 'z' : 'x';
  const out = Math.sign(c[thin] - centre[thin]) || 1;
  const box = new THREE.Box3(
    // From 0.3 up: a doorstep or threshold sits in the bay by design and is
    // walked over, not into. Only what stands proud of shin height blocks.
    new THREE.Vector3(-Infinity, 0.3, -Infinity),
    new THREE.Vector3(Infinity, Math.max(2.2, b.max.y), Infinity)
  );
  box.min[wide] = b.min[wide] - DOOR_PAD;
  box.max[wide] = b.max[wide] + DOOR_PAD;
  // Start clear of the leaf itself — the door and its frame live at the wall,
  // and only what is parked OUTSIDE it counts as blocking.
  const face = out > 0 ? b.max[thin] : b.min[thin];
  const near = face + out * 0.3;
  const far = face + out * DOOR_REACH;
  box.min[thin] = Math.min(near, far);
  box.max[thin] = Math.max(near, far);
  return box;
}

const only = process.argv.slice(2);
const targets = only.length ? only : TARGETS;
let problems = 0;
const sz = new THREE.Vector3();

for (const id of targets) {
  const root = buildProp(id, 1);
  root.updateMatrixWorld(true);

  // townhouse.js tags `shellKey`, meshKit.js tags `materialKey` — the two are
  // deliberately different so shell and dressing stay distinguishable. Tagging
  // both with the same name collapsed them and silently switched the buried
  // check off for exactly the buildings it was written for.
  const shellMeshes = [], dressMeshes = [], doors = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.shellKey) {
      // Roof slabs are excluded from the BURIED test: a chimney passing through
      // a roof is correct, and a tilted slab's axis-aligned bounding box is far
      // bigger than the slab, so it reads as swallowing anything near it.
      if (!/^roof/.test(o.userData.shellKey)) shellMeshes.push(o);
      if (o.userData.shellKey === 'door') doors.push(o);
      return;
    } else {
      dressMeshes.push(o);
      if (o.userData.materialKey === 'doorway') doors.push(o);
    }
  });
  if (!doors.length && !shellMeshes.length) { console.log(`  skip ${id} — no door found`); continue; }

  const centre = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  const shellP = shellMeshes.flatMap((m) => prims(m));
  const dressP = dressMeshes.flatMap((m) => prims(m));

  // --- BLOCKED ---
  for (const door of doors) {
    const bay = doorwayBox(door, centre);
    for (const d of dressP) {
      const hit = d.clone().intersect(bay);
      if (hit.isEmpty()) continue;
      hit.getSize(sz);
      if (sz.x < 0.1 || sz.y < 0.1 || sz.z < 0.1) continue;
      const c = d.getCenter(new THREE.Vector3());
      console.log(`  FAIL ${id}: doorway blocked by a part at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`);
      problems++;
      break;
    }
  }

  // --- BURIED ---
  // Only meaningful when a prop has a townhouse shell AND separate dressing;
  // a building assembled from one kit overlaps itself everywhere by design.
  if (!shellP.length) { if (!problems) console.log(`  ok   ${id} (doorway only — single kit)`); continue; }
  // Dressing is ALLOWED to intersect the shell (a shopfront is set into the
  // wall by design); what is not allowed is being swallowed — more than half
  // the part's own volume inside shell geometry.
  let buried = 0, worst = null;
  for (const d of dressP) {
    d.getSize(sz);
    const vol = Math.max(1e-6, sz.x * sz.y * sz.z);
    let inside = 0;
    for (const s of shellP) {
      const hit = d.clone().intersect(s);
      if (hit.isEmpty()) continue;
      hit.getSize(sz);
      if (sz.x < BURIED_MIN || sz.y < BURIED_MIN || sz.z < BURIED_MIN) continue;
      inside = Math.max(inside, (sz.x * sz.y * sz.z) / vol);
    }
    if (inside > 0.5) {
      buried++;
      if (!worst || inside > worst.f) worst = { f: inside, c: d.getCenter(new THREE.Vector3()) };
    }
  }
  if (buried) {
    console.log(`  FAIL ${id}: ${buried} part(s) more than half inside the walls, worst ${(worst.f * 100) | 0}% at (${worst.c.x.toFixed(2)}, ${worst.c.y.toFixed(2)}, ${worst.c.z.toFixed(2)})`);
    problems++;
  }
  if (!problems) console.log(`  ok   ${id}`);
}

console.log(`\n${targets.length} building(s) checked`);
if (problems) {
  console.error('\nFAIL: geometry is blocking a doorway or buried in a wall.');
  process.exit(1);
}
console.log('PASS');
