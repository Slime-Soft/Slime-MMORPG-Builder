// scripts/check-props.mjs
// The scenery catalog is split in two on purpose: metadata + collision in
// src/sim/propTypes.js (pure, so the server can size a collider without ever
// loading Three), builders in src/generators/props.js. That split is only safe
// if the two can't drift, so this asserts:
//
//   1. every metadata id has a builder, and every builder has metadata;
//   2. every builder actually produces geometry (an empty group is a silent
//      "invisible prop" — it places fine and renders nothing);
//   3. every prop stands ON the ground, not buried in it or hovering;
//   4. every blocking prop's collider actually covers its mesh, so you can't
//      clip into a boulder or get stopped by thin air.
//
//   node scripts/check-props.mjs
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

// Round-canopy trees load real bark/leaf textures via the vendored ez-tree
// library (src/generators/environment/ezTree.js), which calls
// THREE.TextureLoader.load() at MODULE EVALUATION time (top-level, not
// lazily) — that hits ImageLoader -> document.createElementNS, which
// doesn't exist under plain Node. This script only checks geometry/
// collision, never pixels, so a stub texture is a correct substitute, not
// a workaround-that-hides-a-bug.
//
// Must run before props.js (and anything it transitively imports) is
// evaluated — a plain `import` declaration here wouldn't work no matter
// where it's written, since static imports are all hoisted and evaluated
// before any of this file's own top-level statements, in source order
// among THEMSELVES, not interleaved with regular code. Dynamic import()
// runs at the point it's actually called, so it's the only way to
// guarantee the patch lands first.
THREE.TextureLoader.prototype.load = function () {
  return new THREE.Texture();
};

// Round-canopy trees (src/generators/environment/fluffyTree.js) build a
// procedural leaf-alpha texture on a <canvas> at build time — `document`
// again doesn't exist under plain Node. A minimal stub is enough: this
// script builds geometry and never touches the canvas's pixels. Same
// reasoning as the TextureLoader stub above; same must-run-before-import
// ordering (hence the dynamic imports below).
if (typeof globalThis.document === 'undefined') {
  const noop = () => {};
  const stubCtx = new Proxy({}, { get: () => noop }); // every 2d-context method is a no-op
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => stubCtx }),
  };
}

const { PROP_TYPES, getPropType, registerPluginType } = await import('../src/sim/propTypes.js');
const { buildProp, BUILDER_IDS, registerPluginBuilder } = await import('../src/generators/props.js');
const { propCollider } = await import('../src/sim/collision.js');

const SEEDS = [1, 7, 42, 1001, 90210];

// Load plugins (src/generators/environment/plugins/) the same way the
// browser does at runtime, so this check covers them too — a plugin that
// builds no geometry or floats above the ground should fail CI same as a
// hand-authored prop would.
const PLUGINS_DIR_URL = new URL('../src/generators/environment/plugins/', import.meta.url);
const PLUGINS_DIR = fileURLToPath(PLUGINS_DIR_URL);
for (const file of readdirSync(PLUGINS_DIR).filter((f) => f.endsWith('.js'))) {
  const mod = await import(new URL(file, PLUGINS_DIR_URL).href);
  if (!mod.meta?.id || typeof mod.build !== 'function') {
    console.log(`  FAIL plugins/${file}: missing exported meta.id or build(seed)`);
    process.exitCode = 1;
    continue;
  }
  registerPluginType(mod.meta);
  registerPluginBuilder(mod.meta.id, mod.build);
}

/**
 * An edge shared by exactly two triangles is interior; anything else is a hole.
 * Jittering a non-indexed polyhedron per-VERTEX (rather than per unique corner)
 * pulls its faces apart and you can see straight through the rock, so this
 * pins the fix in src/generators/environment/jitter.js.
 */
function openEdgeCount(mesh) {
  let worst = 0;
  mesh.traverse((o) => {
    if (!o.isMesh || !o.geometry.attributes.position || o.geometry.index) return;
    const p = o.geometry.attributes.position;
    const key = (i) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    const edges = new Map();
    for (let i = 0; i < p.count; i += 3) {
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const k = [key(i + a), key(i + b)].sort().join('|');
        edges.set(k, (edges.get(k) || 0) + 1);
      }
    }
    let open = 0;
    for (const c of edges.values()) if (c !== 2) open++;
    worst = Math.max(worst, open);
  });
  return worst;
}

/** Types whose meshes are closed solids, so a hole in them is a bug. */
const WATERTIGHT = new Set(['rock', 'boulder', 'rock-cluster', 'pebbles']);
/** Categories whose meshes may legitimately overhang the collider: a tree's
 *  canopy hangs past its trunk, and a shop sign or banner hangs off an arm
 *  well past the post you actually walk into.
 *
 *  NOTE: this used to read `['trees', 'decor']`, but there has never been a
 *  category id `decor` — PROP_CATEGORIES calls them `outdoors-decor` and
 *  `indoors-decor`. That dead string made the check STRICTER than intended
 *  (a false-failure source, never a false pass): every decor prop was held to
 *  the rock rule and had to be tucked inside its own collider. */
const OVERHANG_ALLOWED = new Set(['trees', 'outdoors-decor', 'indoors-decor']);

let problems = 0;
const fail = (msg) => { console.log(`  FAIL ${msg}`); problems++; };

// --- 1. The two halves agree ---
const metaIds = new Set(PROP_TYPES.map((p) => p.id));
const builderIds = new Set(BUILDER_IDS);
for (const id of metaIds) if (!builderIds.has(id)) fail(`"${id}" has metadata but no builder in props.js`);
for (const id of builderIds) if (!metaIds.has(id)) fail(`"${id}" has a builder but no metadata in propTypes.js`);
console.log(`catalog: ${metaIds.size} prop types, ${builderIds.size} builders`);

// --- 2/3/4. Each type builds, stands on the ground, and matches its collider ---
console.log('\ntype               tris  height  footprint  collider   verdict');
for (const def of PROP_TYPES) {
  if (def.id === 'custom' || def.id === 'model') continue; // 'custom' needs an authored object def, 'model' needs a real uploaded+measured FBX — both covered by the editor, not this synthetic per-seed check

  let worstNote = 'ok';
  for (const seed of SEEDS) {
    const mesh = buildProp(def.id, seed);
    mesh.updateMatrixWorld(true);

    let tris = 0;
    mesh.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    if (tris === 0) { fail(`${def.id} (seed ${seed}) builds no geometry`); worstNote = 'EMPTY'; continue; }

    const box = new THREE.Box3().setFromObject(mesh);
    // Sits on the ground: base near y=0. A prop floating or sunk reads instantly.
    // Rocks are deliberately half-buried (propTypes' `buried`), so only the
    // floating half of the check applies to them.
    // `mounted` props (a ceiling panel, a torch bracket, a lantern on a chain,
    // a stalactite) are exempt from BOTH halves of this rule. Their mount plane
    // is y = 0 and their geometry hangs below it, so "floats" and "sinks" are
    // equally meaningless — there is no ground where they live, and the author
    // sets their height. Everything else still applies: they must build
    // geometry, and they must match their collider.
    //
    // In its place they get the rule that IS meaningful for them: the mount
    // plane must actually be at zero. A ceiling panel whose top drifted to
    // +0.4 hangs 40cm up inside the rock it was meant to sit against, and one
    // that stops short of zero leaves a gap you can see the sky through —
    // neither is visible in any other check.
    if (def.mounted === 'ceiling') {
      // Hangs entirely below the plane, so its top IS the plane.
      if (box.max.y > 0.35) { fail(`${def.id} (seed ${seed}) is ceiling-mounted but reaches ${box.max.y.toFixed(2)} above its mount plane, which must be y=0`); worstNote = 'MOUNT PLANE'; }
      if (box.max.y < -0.05) { fail(`${def.id} (seed ${seed}) is ceiling-mounted but its highest point is ${box.max.y.toFixed(2)} — nothing reaches the mount plane`); worstNote = 'MOUNT PLANE'; }
    } else if (def.mounted === 'wall') {
      // Fixed to a vertical face and reaches both ways from the fixing point,
      // so what's checked is that it STRADDLES y=0 rather than sitting wholly
      // to one side of it — a bracket drawn entirely above its own fixing
      // point is one whose author picked the wrong origin.
      if (!(box.min.y < -0.02 && box.max.y > 0.02)) {
        fail(`${def.id} (seed ${seed}) is wall-mounted but spans ${box.min.y.toFixed(2)}..${box.max.y.toFixed(2)} — it must straddle its fixing point at y=0`);
        worstNote = 'MOUNT PLANE';
      }
    } else if (def.mounted) {
      fail(`${def.id} has mounted: ${JSON.stringify(def.mounted)} — it must be 'ceiling' or 'wall'`);
      worstNote = 'MOUNT PLANE';
    } else {
      if (!def.buried && box.min.y < -0.12) { fail(`${def.id} (seed ${seed}) sinks into the ground: min.y=${box.min.y.toFixed(3)}`); worstNote = 'SUNK'; }
      if (box.min.y > 0.12) { fail(`${def.id} (seed ${seed}) floats above the ground: min.y=${box.min.y.toFixed(3)}`); worstNote = 'FLOATS'; }
    }

    if (WATERTIGHT.has(def.id)) {
      const open = openEdgeCount(mesh);
      if (open > 0) { fail(`${def.id} (seed ${seed}) has ${open} open edge(s) — holes in the solid`); worstNote = 'HOLES'; }
    }

    // Collider vs footprint.
    const prop = { type: def.id, seed, position: { x: 0, y: 0, z: 0 } };
    const col = propCollider(prop, {});
    const footprint = Math.max(
      Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)
    );
    if (def.collider && !col) { fail(`${def.id} declares a collider but propCollider returned null`); worstNote = 'NO COLLIDER'; }
    if (!def.collider && col) { fail(`${def.id} is decoration but propCollider returned one`); worstNote = 'UNWANTED COLLIDER'; }
    if (col && !OVERHANG_ALLOWED.has(def.category) && col.r < footprint * 0.45) {
      // A rock you can walk into isn't a rock. Trees/decor are exempt: their
      // canopy and branches overhang a deliberately trunk-sized collider.
      fail(`${def.id} (seed ${seed}) collider r=${col.r.toFixed(2)} is far under its ${footprint.toFixed(2)} footprint`);
      worstNote = 'COLLIDER TOO SMALL';
    }

    // Walkable surface vs mesh. propTypes.js promises "what you see is what
    // you stand on", and nothing else would ever catch a drift: a deck
    // declared 20cm above the boards it represents looks perfect in every
    // screenshot and drops the player through the floor in play.
    if (def.walkable) {
      const w = def.walkable;
      const surfaceTop = w.kind === 'ramp' ? Math.max(w.low, w.high) : w.top;
      // The deck's top face must exist somewhere in the mesh's vertical span,
      // and must not be declared above everything the prop actually builds.
      if (surfaceTop > box.max.y + 0.01) {
        fail(`${def.id} (seed ${seed}) walkable surface ${surfaceTop} is above the mesh top ${box.max.y.toFixed(2)} — nothing to stand on`);
        worstNote = 'WALKABLE ABOVE MESH';
      }
      // The footprint it claims must be covered by real geometry, or a player
      // stands on thin air out past the last board.
      const half = Math.max(w.width, w.depth) / 2;
      if (half > footprint + 0.15) {
        fail(`${def.id} (seed ${seed}) walkable half-extent ${half.toFixed(2)} overhangs its ${footprint.toFixed(2)} mesh footprint`);
        worstNote = 'WALKABLE OVERHANGS';
      }
      if (def.collider) {
        fail(`${def.id} declares both a collider and a walkable surface — a prop you stand on can't also be one you bump into`);
        worstNote = 'WALKABLE + COLLIDER';
      }
    }

    if (seed === SEEDS[0]) {
      const h = (box.max.y - box.min.y).toFixed(2);
      const c = col ? col.r.toFixed(2) : '—';
      console.log(`  ${def.id.padEnd(17)} ${String(Math.round(tris)).padStart(4)}  ${h.padStart(6)}  ${footprint.toFixed(2).padStart(9)}  ${c.padStart(8)}   ${worstNote}`);
    }
  }
}

// --- 5. Props that must be mirror-symmetric actually are ---
// The Great Tower is a monument read head-on from the city's south avenue, so
// asymmetry in it is a VISIBLE defect and an invisible one in code: every ring
// in it looks symmetric at a glance, and a stray phase offset or a tilt applied
// in world space instead of in the part's own frame quietly breaks the mirror.
// Reflection about the gate axis is the plane x = 0 (the gate faces +Z).
const MIRROR_SYMMETRIC = ['tower-great'];
/** Fraction of vertices with no partner at (-x, y, z), quantised to 1mm. */
function mirrorMismatch(mesh) {
  let total = 0, unmatched = 0;
  mesh.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    const key = (x, y, z) => `${Math.round(x * 1e3)}|${Math.round(y * 1e3)}|${Math.round(z * 1e3)}`;
    const seen = new Set();
    for (let i = 0; i < pos.count; i++) seen.add(key(pos.getX(i), pos.getY(i), pos.getZ(i)));
    for (let i = 0; i < pos.count; i++) {
      total++;
      if (!seen.has(key(-pos.getX(i), pos.getY(i), pos.getZ(i)))) unmatched++;
    }
  });
  return { total, unmatched };
}
console.log('');
for (const id of MIRROR_SYMMETRIC) {
  const { total, unmatched } = mirrorMismatch(buildProp(id, SEEDS[0]));
  if (unmatched > 0) {
    fail(`${id} is not mirror-symmetric about x=0: ${unmatched}/${total} vertices have no partner`);
  } else {
    console.log(`mirror symmetry: ${id} ok (${total} vertices)`);
  }
}

console.log(problems ? `\nFAIL: ${problems} problem(s)` : '\nPASS');
process.exit(problems ? 1 : 0);
