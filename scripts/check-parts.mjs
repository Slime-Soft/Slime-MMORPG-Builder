// scripts/check-parts.mjs
// Finds FLOATING PARTS: geometry that touches neither the ground nor the rest
// of the prop it belongs to.
//
// WHY THIS EXISTS. On 2026-08-01 Dennis circled defects in five of the assets
// that had just shipped "verified": a blacksmith's bellows hanging off a wall
// with nothing under it, a quench trough adrift, an alchemist's condenser coil
// rendered as a line of disconnected sticks floating over a roof, a dragon
// statue's wing panels detached from its shoulder, a fountain whose jets were
// four unconnected droplets. Every one of them passed `check:props` (they build
// geometry, stand on the ground, match their collider) and `check:zfight`, and
// every one of them was invisible in a 400px whole-building render.
//
// This is the same idea `check-prefabs.mjs` already applies to monster
// prefabs — where it caught 91 detached shapes — finally pointed at props.
//
//   node scripts/check-parts.mjs [propType...]
//
// HOW IT DECIDES. Merged geometry from meshKit is many primitives concatenated
// into one buffer, and separate primitives never share a vertex. So welding
// vertices inside each mesh recovers the original primitives exactly. Those are
// then joined into islands by bounding-box overlap, and an island is a defect
// only if it BOTH:
//   - fails to touch any other island, and
//   - fails to reach the ground.
// That second clause is what keeps the check honest: a pile of sacks, a cluster
// of mushrooms, three headstones on a plot and a scatter of pebbles are all
// legitimately several separate objects standing on the terrain, and none of
// them is floating.
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Same browser-API stubs, and the same must-run-before-import ordering, as
// scripts/check-props.mjs — see the long comment there.
THREE.TextureLoader.prototype.load = function () { return new THREE.Texture(); };
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const stubCtx = new Proxy({}, { get: () => noop });
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }) };
}

const { PROP_TYPES, registerPluginType } = await import('../src/sim/propTypes.js');
const { buildProp, registerPluginBuilder } = await import('../src/generators/props.js');

const PLUGINS_DIR_URL = new URL('../src/generators/environment/plugins/', import.meta.url);
for (const file of readdirSync(fileURLToPath(PLUGINS_DIR_URL)).filter((f) => f.endsWith('.js'))) {
  const mod = await import(new URL(file, PLUGINS_DIR_URL).href);
  if (!mod.meta?.id || typeof mod.build !== 'function') continue;
  registerPluginType(mod.meta);
  registerPluginBuilder(mod.meta.id, mod.build);
}

/** Touching the terrain counts as attached — props sit ON the ground. */
const GROUND_Y = 0.16;
/** Islands smaller than this across are specks; reporting them is noise. */
const MIN_ISLAND = 0.22;
/** How close two islands must come to count as touching. */
const TOUCH = 0.03;

const SEEDS = [1, 42];

/**
 * Types whose parts are MEANT to be airborne: `id -> {islands, why}`, where
 * `islands` is how many airborne islands are legitimate. Anything not listed
 * here that floats is a bug, not a style choice — and an entry here is an
 * ALLOWANCE, not an exemption: a listed prop that breaks into MORE islands
 * than it declares still fails, so a real break inside one can't hide behind
 * the reason it's airborne at all.
 */
const ALLOWED = new Map([
  // Add an entry only with a reason a reader can check — "it looked fine to
  // me" is how the defects above shipped in the first place.
  //
  // The cave kit's ceiling/wall pieces (2026-08-02). Each carries `mounted:
  // true` in src/sim/propTypes.js and hangs off a wall or ceiling the author
  // places it against, so it reaches no ground BY DEFINITION. Each is ONE
  // connected island, so a second one means a drip or a bracket came loose.
  ['cave-ceiling-tile', { islands: 1, why: 'ceiling panel; hangs under its mount plane' }],
  ['cave-ceiling-small', { islands: 1, why: 'ceiling panel; hangs under its mount plane' }],
  ['cave-ceiling-rough', { islands: 1, why: 'ceiling panel; hangs under its mount plane' }],
  ['cave-ceiling-fringe', { islands: 1, why: 'ceiling panel + edge drips; one island' }],
  ['cave-ceiling-corner', { islands: 1, why: 'ceiling panel + two edges of drips; one island' }],
  ['cave-stalactites', { islands: 1, why: 'hangs from a ceiling; cap + drips are one island' }],
  ['cave-ceiling-slab', { islands: 1, why: 'hangs from a ceiling; slab + drips are one island' }],
  ['cave-torch', { islands: 1, why: 'wall bracket; mounts against a wall face, never reaches the floor' }],
  ['cave-lantern', { islands: 1, why: 'hangs from a ceiling hook on a chain' }],
]);

/**
 * Props that already floated before this check existed. They are REPORTED but
 * do not fail the build, so the check can act as a gate on new work today
 * instead of being switched off until someone finds time for a 14-prop cleanup.
 *
 * This list is written out by hand, not generated: every entry is a real defect
 * somebody should eventually look at, and an auto-refreshing baseline would
 * quietly swallow new ones. Deleting a line here is the definition of done for
 * fixing that prop.
 */
const LEGACY = new Set([
  'tree-cypress',          // branch sticks inside the canopy, unattached to the trunk
  'station-workbench', 'workstation-carpenter', 'workstation-floor-loom',
  'banner-pole',           // the small tie-cloths hang clear of the pole
  'arcane-obelisk',        // may be an intentionally levitating capstone — needs Dennis's call
  'crop-pumpkin',          // individual pumpkins sitting above their furrow
  'plough', 'rowboat', 'ore-cart',
  'tower-great',           // upper stages don't reach the stage below within 3cm
]);

/** Union-find. */
function makeUF(n) {
  const p = new Int32Array(n);
  for (let i = 0; i < n; i++) p[i] = i;
  const find = (i) => { while (p[i] !== i) { p[i] = p[p[i]]; i = p[i]; } return i; };
  return { find, union: (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) p[ra] = rb; } };
}

/**
 * Recover a prop's individual primitives as world-space bounding boxes, by
 * welding vertices within each mesh.
 */
function primitiveBoxes(root) {
  root.updateMatrixWorld(true);
  const boxes = [];
  root.traverse((o) => {
    // Instanced meshes (tree leaves, grass blades) carry their placement in a
    // per-instance matrix that isn't in the geometry, so a bounding box built
    // from the buffer alone would be meaningless.
    if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
    if (!triCount) return;
    const vi = (i) => (idx ? idx.getX(i) : i);
    const uf = makeUF(triCount);
    const seen = new Map();
    const q = (n) => Math.round(n * 1e4);
    for (let t = 0; t < triCount; t++) {
      for (let c = 0; c < 3; c++) {
        const v = vi(t * 3 + c);
        const key = `${q(pos.getX(v))},${q(pos.getY(v))},${q(pos.getZ(v))}`;
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, t);
        else uf.union(prev, t);
      }
    }
    const groups = new Map();
    const v = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const r = uf.find(t);
      let b = groups.get(r);
      if (!b) { b = new THREE.Box3().makeEmpty(); groups.set(r, b); }
      for (let c = 0; c < 3; c++) {
        v.fromBufferAttribute(pos, vi(t * 3 + c)).applyMatrix4(o.matrixWorld);
        b.expandByPoint(v);
      }
    }
    boxes.push(...groups.values());
  });
  return boxes;
}

/** Join primitives into islands by overlap, and report the floating ones. */
function floatingIslands(root) {
  const boxes = primitiveBoxes(root);
  if (boxes.length < 2) return [];
  const grown = boxes.map((b) => b.clone().expandByScalar(TOUCH / 2));
  const uf = makeUF(boxes.length);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (grown[i].intersectsBox(grown[j])) uf.union(i, j);
    }
  }
  const islands = new Map();
  boxes.forEach((b, i) => {
    const r = uf.find(i);
    const cur = islands.get(r);
    if (!cur) islands.set(r, b.clone());
    else cur.union(b);
  });
  const all = [...islands.values()];
  const size = new THREE.Vector3();
  return all
    .filter((b) => b.min.y > GROUND_Y && b.getSize(size).length() > MIN_ISLAND)
    .map((b) => {
      const c = b.getCenter(new THREE.Vector3());
      const s = b.getSize(new THREE.Vector3());
      return { c, s, span: s.length() };
    })
    .sort((a, b) => b.span - a.span);
}

// --- self-test: the detector must catch a known floater and clear a known
// grounded pile. A guard nobody has watched fail is not a guard.
{
  const g = new THREE.Group();
  const onGround = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
  const alsoOnGround = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(3, 0.5, 0));
  const inTheAir = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 6, 0));
  g.add(onGround, alsoOnGround);
  if (floatingIslands(g).length !== 0) {
    console.error('FAIL: self-test — two separate objects standing on the ground are not floating.');
    process.exit(1);
  }
  g.add(inTheAir);
  if (floatingIslands(g).length !== 1) {
    console.error('FAIL: self-test — detector missed a box hanging 6m in the air.');
    process.exit(1);
  }
}
console.log('self-test        ok (catches airborne islands, ignores grounded ones)\n');

const only = process.argv.slice(2);
const targets = PROP_TYPES.filter((d) => d.id !== 'custom' && d.id !== 'model')
  .filter((d) => !only.length || only.includes(d.id));

let problems = 0;
let legacy = 0;
for (const def of targets) {
  let worst = [];
  for (const seed of SEEDS) {
    let root;
    try { root = buildProp(def.id, seed); } catch { continue; }
    const f = floatingIslands(root);
    if (f.length > worst.length) worst = f;
  }
  if (!worst.length) continue;
  const allowance = ALLOWED.get(def.id);
  if (allowance && worst.length <= allowance.islands) {
    console.log(`  skip ${def.id} — ${allowance.why}`);
    continue;
  }
  if (allowance) {
    problems++;
    console.log(`  FAIL ${def.id}: ${worst.length} airborne island(s), but only ${allowance.islands} is legitimate (${allowance.why})`);
    for (const f of worst.slice(0, 5)) {
      console.log(`         ${f.s.x.toFixed(2)}x${f.s.y.toFixed(2)}x${f.s.z.toFixed(2)}m at (${f.c.x.toFixed(2)}, ${f.c.y.toFixed(2)}, ${f.c.z.toFixed(2)})`);
    }
    continue;
  }
  if (LEGACY.has(def.id)) {
    legacy++;
    console.log(`  old  ${def.id}: ${worst.length} floating part(s) (pre-existing, not gating)`);
    continue;
  }
  problems++;
  console.log(`  FAIL ${def.id}: ${worst.length} floating part(s)`);
  for (const f of worst.slice(0, 5)) {
    console.log(`         ${f.s.x.toFixed(2)}x${f.s.y.toFixed(2)}x${f.s.z.toFixed(2)}m at (${f.c.x.toFixed(2)}, ${f.c.y.toFixed(2)}, ${f.c.z.toFixed(2)})`);
  }
  if (worst.length > 5) console.log(`         ...and ${worst.length - 5} more`);
}

console.log(`\n${targets.length} prop type(s) checked`);
if (problems) {
  console.error(`\nFAIL: ${problems} prop(s) have geometry attached to nothing — it hangs in mid-air in game.`);
  process.exit(1);
}
console.log('PASS');
