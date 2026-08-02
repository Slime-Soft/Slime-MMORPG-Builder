// src/generators/environment/meshKit.js
// Accumulate many small primitives into ONE mesh per material.
//
// Extracted from townhouse.js, where it took a 60-90 box building down to ~10
// draw calls. The same problem applies to street props: a street lantern built
// the obvious way is 14 separate meshes, and 50 of them on a map is 700 draw
// calls for some lamp posts. Detail should cost triangles, not draw calls.
//
// Two rules learned the hard way, both encoded below:
//  - Geometry must agree on indexing before merging. BoxGeometry/CylinderGeometry
//    are indexed, ExtrudeGeometry is not; mergeGeometries refuses a mixed batch
//    and returns null, which silently deletes a whole material's worth of parts
//    while the object still "builds fine".
//  - A null merge therefore THROWS rather than being skipped.
//
// Import via 'three/addons/...', never 'three/examples/jsm/...': the browser
// resolves bare specifiers through the import map in public/index.html, which
// only aliases `three/addons/`. Getting this wrong fails the whole module graph
// and boots the game to a black screen. See scripts/check-imports.mjs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * @returns {{
 *   box: Function, cyl: Function, cone: Function, sphere: Function,
 *   ico: Function, torus: Function, raw: Function, finish: Function
 * }}
 */
export function makeKit() {
  const buckets = new Map();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const m4 = new THREE.Matrix4();

  const push = (key, geo, x, y, z, rot, scale) => {
    e.set(rot?.[0] || 0, rot?.[1] || 0, rot?.[2] || 0);
    q.setFromEuler(e);
    v.set(x || 0, y || 0, z || 0);
    m4.compose(v, q, scale ? new THREE.Vector3(scale[0], scale[1], scale[2]) : one);
    geo.applyMatrix4(m4);
    if (geo.index) geo = geo.toNonIndexed();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(geo);
  };

  return {
    box: (k, w, h, d, x, y, z, rot) => push(k, new THREE.BoxGeometry(w, h, d), x, y, z, rot),
    // `arc` (thetaLength) makes a half-cylinder, which is how every arch head
    // in the library is built. Without it an arch silently renders as a full
    // drum sticking out of the wall.
    //
    // `arcStart` (thetaStart) picks WHICH half, and leaving it out is a trap:
    // three.js generates a cylinder's shell at x = r·sin(theta), z = r·cos(theta),
    // so theta 0..PI is the +X half, NOT the top half. Laid on its side with a
    // [PI/2, 0, 0] rotation — the way every tunnel and arch head here is
    // oriented — that comes out as a half-tube hanging down the RIGHT side of
    // the opening instead of as a ceiling over it. That is exactly what the
    // city gate's passage did until this parameter existed. For a top half,
    // pass arcStart = PI/2.
    cyl: (k, rt, rb, h, seg, x, y, z, rot, arc, arcStart) =>
      push(k, new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, arcStart || 0, arc), x, y, z, rot),
    cone: (k, r, h, seg, x, y, z, rot) =>
      push(k, new THREE.ConeGeometry(r, h, seg), x, y, z, rot),
    sphere: (k, r, x, y, z, scale) =>
      push(k, new THREE.SphereGeometry(r, 10, 7), x, y, z, null, scale),
    ico: (k, r, x, y, z, scale) =>
      push(k, new THREE.IcosahedronGeometry(r, 0), x, y, z, null, scale),
    torus: (k, r, tube, x, y, z, rot, arc) =>
      push(k, new THREE.TorusGeometry(r, tube, 6, 14, arc), x, y, z, rot),
    raw: (k, geo, x, y, z, rot) => push(k, geo, x, y, z, rot),
    finish(materials) {
      const g = new THREE.Group();
      for (const [key, list] of buckets) {
        if (!list.length) continue;
        const merged = mergeGeometries(list, false);
        if (!merged) {
          throw new Error(`meshKit: mergeGeometries failed for material "${key}" (${list.length} parts)`);
        }
        // A MISSING KEY IS FATAL. `new Mesh(geo, undefined)` silently falls back
        // to three's default MeshBasicMaterial: pure white, unlit, and immune to
        // shading — which then trips the composer's bloom threshold and glows.
        // The cooking house shipped like that because its dressing used
        // 'stoneLight' and the material set didn't define it; it read as a bloom
        // bug for a whole round of review.
        if (!materials[key]) {
          throw new Error(`meshKit: no material for key "${key}" — ${list.length} part(s) would render as unlit white`);
        }
        const mesh = new THREE.Mesh(merged, materials[key]);
        // Lets scripts/check-embedded.mjs find a building's doorway.
        mesh.userData.materialKey = key;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      return g;
    },
  };
}

/**
 * A striped awning/valance cloth: ONE continuous sheet in `baseKey`, with the
 * accent stripes as thin ribs standing proud of BOTH faces in `ribKey`.
 *
 * WHY NOT A ROW OF SLABS (which is how every awning here was first built, and
 * what had to be undone twice): laying `stripes` boxes side by side at
 * `width * 0.98` leaves a slit of a few millimetres between each pair. At a
 * grazing viewing angle perspective foreshortens each slab's visible width
 * towards zero while the slits keep theirs, so the awning reads as loose planks
 * with the sky showing through — and it is grazing angles that dominate, because
 * a player's eye is near the height of the cloth. Butting the slabs exactly
 * instead puts two opaque faces in one plane (see check:zfight), and backing the
 * row with a second sheet only helps a viewer looking DOWN through the slits;
 * from underneath they still open straight to the sky. A single sheet is the only
 * shape with no gap from any direction.
 *
 * @param {object} k a makeKit()
 * @param {{w:number, thru:number, t:number, x:number, y:number, z:number,
 *          tilt?:number, stripes:number, vertical?:boolean,
 *          baseKey?:string, ribKey?:string}} o
 *   `w` is across the stripes, `thru` is along them (the slope's depth, or the
 *   valance's height when `vertical`), `t` is the cloth's thickness.
 */
export function stripedCloth(k, o) {
  const { w, thru, t, x, y, z, tilt = 0, tiltAxis = 'x', stripes, vertical = false, baseKey = 'stripeB', ribKey = 'stripeA' } = o;
  // tiltAxis 'z' slopes the sheet across `w` instead of across `thru`.
  const rot = tilt ? (tiltAxis === 'z' ? [0, 0, tilt] : [tilt, 0, 0]) : null;
  const sw = w / stripes;
  const ribT = t * 0.7;
  // Rib centre sits 0.62t off the sheet's own centre: deep enough that the rib's
  // inner face is buried inside the sheet (no shared plane), proud enough to
  // read as a stitched-on stripe.
  const off = t * 0.62;
  // Ribs are inset from the sheet's edges in every other direction too, so no
  // rib end face lands in one of the sheet's planes either.
  const ribW = sw * 0.9;
  const ribThru = thru - 0.06;

  if (vertical) k.box(baseKey, w, thru, t, x, y, z, rot);
  else k.box(baseKey, w, t, thru, x, y, z, rot);

  // A rib's offset from the sheet's centre has to be ROTATED by the tilt, not
  // added in world axes: with tiltAxis 'z' a rib sits up to w/2 along the slope,
  // so ignoring the rotation drops it a full `w/2 * sin(tilt)` off the sheet.
  const c = Math.cos(tilt), s = Math.sin(tilt);
  for (let i = 0; i < stripes; i += 2) {
    const dx = -w / 2 + sw * (i + 0.5);
    for (const side of [-1, 1]) {
      const d = side * off;
      if (vertical) k.box(ribKey, ribW, ribThru, ribT, x + dx, y, z + d, rot);
      else if (tiltAxis === 'z') {
        k.box(ribKey, ribW, ribT, ribThru, x + dx * c - d * s, y + dx * s + d * c, z, rot);
      } else {
        k.box(ribKey, ribW, ribT, ribThru, x + dx, y + d * c, z + d * s, rot);
      }
    }
  }
}

/** The matte, flat-shaded look the rest of the environment library uses. */
export const matte = (color, flat = true) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: flat });

/**
 * Metal. `metalness` stays 0 deliberately — there is no environment map
 * anywhere in src/render, and a metallic MeshStandardMaterial has no diffuse
 * term, so it renders as a black silhouette.
 */
export const metal = (color) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 });

export const glow = (color, intensity = 0.8) =>
  new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0,
  });

// ─────────────────────────────────────────────────────────────────────────────
/**
 * Merge a built prop's plain static meshes down to one per material, in place.
 *
 * makeKit above only helps builders that opt into it. Most of the prop library
 * predates it and assembles loose meshes, which is invisible until you count:
 * facing north from asteria's spawn (through the city, toward the great tower)
 * put 1,338 props in the frustum for 5,602 DRAW CALLS — versus 207 facing the
 * other way. Triangles were never the issue there; call count was.
 *
 * Applied centrally in buildProp (src/generators/props.js) rather than builder
 * by builder, so every existing type — and every type added later — gets it
 * without having to remember.
 *
 * DELIBERATELY CONSERVATIVE. A mesh is left exactly as it is if it carries any
 * userData at all (`preserveMaterial`, `isTreeLeaves`, `excludeFromColorTint`,
 * `shellKey`, `materialKey`, `oreType`, `isWater`, `shapeId`, …), is instanced,
 * has children, uses a material array, or has a custom shader hooked onto its
 * material. Those flags all mean something downstream — a per-frame uniform, a
 * colour-tint opt-out, a raycast target — and merging such a mesh into a shared
 * one would silently break it. Fewer merged draw calls is never worth that, so
 * anything the slightest bit special keeps its own mesh. Trees, for instance,
 * come through completely untouched.
 *
 * @param {THREE.Object3D} root mutated in place
 * @returns {THREE.Object3D} the same root, for chaining
 */
export function mergeStaticMeshes(root) {
  const mergeable = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    if (o.children.length) return;
    if (Object.keys(o.userData).length) return;
    if (Array.isArray(o.material)) return;
    const m = o.material;
    if (!m || m.map || Object.keys(m.userData || {}).length) return;
    // Compared against the PROTOTYPE, not just checked for truthiness:
    // THREE.Material defines both of these as default no-op methods, so a
    // plain `if (m.onBeforeCompile)` is true for every material in existence
    // and silently skips the entire library. Only an OVERRIDDEN hook means the
    // material has a custom shader worth protecting.
    if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return;
    if (m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return;
    mergeable.push(o);
  });
  if (mergeable.length < 2) return root;

  const buckets = new Map();
  for (const mesh of mergeable) {
    const m = mesh.material;
    // Everything that makes two materials render differently. Anything not
    // captured here would let visually distinct meshes collapse into one, so
    // it errs toward MORE buckets rather than fewer.
    const key = [
      m.type, m.color?.getHexString(), m.emissive?.getHexString(), m.emissiveIntensity,
      m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.flatShading, m.wireframe,
    ].join('|');
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { material: m, meshes: [] }; buckets.set(key, bucket); }
    bucket.meshes.push(mesh);
  }

  const _m = new THREE.Matrix4();
  for (const { material, meshes } of buckets.values()) {
    if (meshes.length < 2) continue; // nothing gained, and it would needlessly reparent the mesh
    const geometries = [];
    let castShadow = false, receiveShadow = false;
    for (const mesh of meshes) {
      // World matrix RELATIVE TO ROOT, so the merged mesh can hang off the
      // root itself — the prop's own placement (position/rotation/scale in the
      // world) is applied to the root later by buildPropPlaceholder and must
      // not be baked in here.
      _m.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
      const geo = mesh.geometry.clone().applyMatrix4(_m);
      geometries.push(geo.index ? geo.toNonIndexed() : geo);
      castShadow = castShadow || mesh.castShadow;
      receiveShadow = receiveShadow || mesh.receiveShadow;
      mesh.removeFromParent();
    }
    const merged = mergeGeometries(geometries, false);
    if (!merged) {
      // Mismatched attribute sets (e.g. one geometry carries uv and another
      // doesn't). Put the originals back rather than dropping them — a
      // missing prop is a far worse outcome than an unmerged one.
      for (const mesh of meshes) root.add(mesh);
      continue;
    }
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = receiveShadow;
    root.add(mesh);
  }
  return root;
}
