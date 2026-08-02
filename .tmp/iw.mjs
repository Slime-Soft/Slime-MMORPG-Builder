import * as THREE from 'three';
import { stubBrowserGlobals } from '../scripts/lib/softRaster.mjs';
stubBrowserGlobals();
const { buildProp } = await import('../src/generators/props.js');
const root = buildProp(process.argv[2], 1); root.updateMatrixWorld(true);
// child 0..n-1 = townhouse shell meshes; last child = the dressing group.
const kids = root.children;
const dress = kids[kids.length - 1];
const shell = kids.slice(0, -1);
const shellBox = new THREE.Box3();
for (const m of shell) shellBox.union(new THREE.Box3().setFromObject(m));
// Solid wall volume = shell bbox shrunk to the walls (exclude roof overhang).
console.log('shell bbox', JSON.stringify(shellBox.min).slice(0,60), JSON.stringify(shellBox.max).slice(0,60));
function prims(o) {
  const out = [];
  o.traverse((m) => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const n = idx ? idx.count : pos.count, tri = Math.floor(n / 3);
    const uf = new Int32Array(tri).map((_, i) => i);
    const find = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
    const seen = new Map(), q = (v) => Math.round(v * 1e4);
    const vi = (i) => (idx ? idx.getX(i) : i);
    for (let t = 0; t < tri; t++) for (let c = 0; c < 3; c++) {
      const v = vi(t*3+c), key = `${q(pos.getX(v))},${q(pos.getY(v))},${q(pos.getZ(v))}`;
      const p = seen.get(key); if (p === undefined) seen.set(key, t); else { const a=find(p),b=find(t); if(a!==b) uf[a]=b; }
    }
    const g = new Map(), vv = new THREE.Vector3();
    for (let t = 0; t < tri; t++) { const r = find(t); let b = g.get(r); if (!b) { b = new THREE.Box3().makeEmpty(); g.set(r,b);} 
      for (let c=0;c<3;c++){ vv.fromBufferAttribute(pos, vi(t*3+c)).applyMatrix4(m.matrixWorld); b.expandByPoint(vv);} }
    out.push(...g.values());
  });
  return out;
}
const shellP = shell.flatMap(prims), dressP = prims(dress);
// Report dressing parts deeply inside a shell WALL part (>12cm overlap on every axis).
const sz = new THREE.Vector3();
let n = 0;
for (const d of dressP) {
  for (const s of shellP) {
    const i = d.clone().intersect(s);
    if (i.isEmpty()) continue;
    i.getSize(sz);
    if (sz.x > 0.12 && sz.y > 0.12 && sz.z > 0.12) {
      const c = d.getCenter(new THREE.Vector3()), ds = d.getSize(new THREE.Vector3());
      console.log(`buried: ${ds.x.toFixed(2)}x${ds.y.toFixed(2)}x${ds.z.toFixed(2)} at (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})  overlap ${sz.x.toFixed(2)}x${sz.y.toFixed(2)}x${sz.z.toFixed(2)}`);
      n++; break;
    }
  }
}
console.log(n, 'dressing part(s) intersecting the shell');
