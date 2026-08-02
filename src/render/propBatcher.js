// src/render/propBatcher.js
// Merges STATIC props across prop boundaries, per spatial cell.
//
// mergeStaticMeshes (src/generators/environment/meshKit.js) collapses each prop
// to one mesh per material, which is as far as a single prop can go. That still
// leaves a city costing roughly three draw calls per prop: measured facing
// north from asteria's spawn — through the city toward the great tower — 1,338
// props in the frustum came to 4,124 draw calls, against 137 facing the other
// way. No single prop type dominated; it was a long tail, which is the
// signature of a per-object cost rather than a per-type one.
//
// The fix is to stop treating props as the unit of drawing. Props never move,
// so every static mesh inside one spatial cell that shares a material can be
// one mesh. The cell grid is what keeps frustum culling working — a single
// map-wide merge would be one un-cullable object, the exact mistake the grass
// cover made (see grassCover.js).
//
// WHAT IS DELIBERATELY NOT BATCHED, and why each one has to keep its identity:
//   - anything mergeStaticMeshes refuses (instanced meshes, custom shaders,
//     any mesh carrying userData) — same reasoning, same rules;
//   - props with an `id`, which are Event Objects the game shows and hides at
//     runtime (a looted chest) and must stay individually addressable;
//   - props that animate per-object (the swaying flowers), since batching
//     welds them to their neighbours;
//   - trees, whose canopy is instanced and LOD-switched per tree.
// A prop that is only PARTLY mergeable still contributes its plain meshes and
// keeps the rest, so a tree's trunk batches while its canopy stays its own.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';


const CELL_SIZE = 64;

/**
 * userData keys that are safe to weld away AT RUNTIME.
 *
 * Both are build-time QA tags: makeKit().finish() stamps `materialKey` and
 * townhouse.js stamps `shellKey`, and scripts/check-embedded.mjs reads them to
 * locate a building's doorway and shell. They are NOT inert — an earlier
 * version of this batcher shared its rules with meshKit's per-prop merge and
 * broke that check, because merging destroyed the tagged meshes it inspects.
 *
 * The distinction that makes welding them safe HERE is timing, not the tags:
 * check-embedded reads the output of buildProp, whereas this batcher runs only
 * when the live game assembles a world. Nothing reads either tag at runtime.
 * meshKit's mergeStaticMeshes, which DOES run inside buildProp, still refuses
 * them — that asymmetry is deliberate.
 */
const RUNTIME_WELDABLE_USERDATA = new Set(['materialKey', 'shellKey']);

function hasOnlyWeldableUserData(o) {
  for (const k of Object.keys(o.userData)) if (!RUNTIME_WELDABLE_USERDATA.has(k)) return false;
  return true;
}

/** Same mergeability rules as meshKit.mergeStaticMeshes — see its notes. */
function isMergeable(o) {
  if (!o.isMesh || o.isInstancedMesh) return false;
  if (o.children.length) return false;
  if (!hasOnlyWeldableUserData(o)) return false;
  if (Array.isArray(o.material)) return false;
  const m = o.material;
  if (!m || m.map || Object.keys(m.userData || {}).length) return false;
  // Prototype comparison, not truthiness: THREE.Material defines both as
  // default no-op methods, so a truthiness check matches every material.
  if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
  if (m.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey) return false;
  return true;
}

/**
 * Everything that makes two materials render differently — EXCEPT `color`.
 *
 * Colour is deliberately left out and folded into a per-vertex attribute
 * instead. Most generators pick a seeded random shade per prop, so keying on
 * colour put nearly every prop in a bucket of its own: the first working
 * version of this batcher produced 1,429 merged meshes for ~2,000 props, which
 * is barely a merge at all. Baking colour into the geometry collapses a whole
 * cell's props of one material TYPE into one mesh regardless of their shades.
 */
function materialKey(m) {
  return [
    m.type, m.emissive?.getHexString(), m.emissiveIntensity,
    m.roughness, m.metalness, m.opacity, m.transparent, m.side, m.flatShading, m.wireframe,
  ].join('|');
}

/**
 * Write the material's colour into the geometry as a per-vertex `color`.
 * Values are taken straight off THREE.Color, which stores linear-space
 * components — the same space the shader expects a vertex colour in, so no
 * conversion belongs here.
 */
function bakeColor(geo, color) {
  const n = geo.attributes.position.count;
  const existing = geo.attributes.color;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // A geometry that already carries vertex colours keeps them, MULTIPLIED by
    // the material colour — which is exactly how three combines the two, so a
    // generator that painted its own gradient still looks the same batched.
    const r = existing ? existing.getX(i) : 1;
    const g = existing ? existing.getY(i) : 1;
    const b = existing ? existing.getZ(i) : 1;
    arr[i * 3] = color.r * r;
    arr[i * 3 + 1] = color.g * g;
    arr[i * 3 + 2] = color.b * b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * @param {{cellSize?: number}} [opts]
 * @returns {{add(mesh: THREE.Object3D): boolean, flush(parent: THREE.Object3D): number}}
 *   `add` returns true when it consumed the WHOLE mesh (the caller must not
 *   add it to the scene); false when meshes remain on it and it still needs
 *   placing. `flush` builds the merged meshes and returns how many it made.
 */
export function createPropBatcher({ cellSize = CELL_SIZE } = {}) {
  const buckets = new Map();
  const _m = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();

  return {
    add(mesh) {
      mesh.updateMatrixWorld(true);
      const targets = [];
      mesh.traverse((o) => { if (isMergeable(o)) targets.push(o); });
      if (!targets.length) return false;

      // The cell is chosen from the PROP's origin, not each sub-mesh's, so one
      // prop can never be split across two cells and pop half-away.
      const cx = Math.floor(mesh.position.x / cellSize);
      const cz = Math.floor(mesh.position.z / cellSize);
      // Merged geometry is stored in the cell's own local space rather than
      // world space: a map is ±400m, and baking absolute coordinates into
      // float32 vertices throws away precision exactly where the geometry is
      // smallest. The cell's mesh carries the offset as its position instead.
      const originX = cx * cellSize + cellSize / 2;
      const originZ = cz * cellSize + cellSize / 2;
      _inv.makeTranslation(-originX, 0, -originZ);

      for (const o of targets) {
        const key = `${cx},${cz}|${materialKey(o.material)}`;
        let bucket = buckets.get(key);
        if (!bucket) {
          // Cloned and neutralised: the shared material must not carry any one
          // prop's colour, and mutating the original would recolour every
          // unbatched mesh still using it.
          const material = o.material.clone();
          material.vertexColors = true;
          material.color.setRGB(1, 1, 1);
          bucket = { material, geometries: [], originX, originZ, cast: false, receive: false };
          buckets.set(key, bucket);
        }
        _m.multiplyMatrices(_inv, o.matrixWorld);
        const geo = o.geometry.clone().applyMatrix4(_m);
        bucket.geometries.push(bakeColor(geo.index ? geo.toNonIndexed() : geo, o.material.color));
        bucket.cast = bucket.cast || o.castShadow;
        bucket.receive = bucket.receive || o.receiveShadow;
        o.removeFromParent();
      }

      // True only if nothing at all is left to draw — a tree whose canopy
      // survived still has to be added to the scene by the caller.
      let remaining = false;
      mesh.traverse((o) => { if (o.isMesh) remaining = true; });
      return !remaining;
    },

    flush(parent) {
      let made = 0;
      for (const b of buckets.values()) {
        const merged = b.geometries.length === 1 ? b.geometries[0] : mergeGeometries(b.geometries, false);
        // A null merge means mismatched attribute sets. Dropping the batch
        // would silently delete scenery, so fall back to leaving this bucket
        // out of the merge entirely and warn — it is the only case where the
        // props it holds have already been detached from their originals.
        if (!merged) {
          console.warn(`propBatcher: mergeGeometries failed for ${b.geometries.length} parts (material ${b.material.color?.getHexString?.() ?? '?'}) — drawing them unmerged`);
          for (const geo of b.geometries) {
            const m = new THREE.Mesh(geo, b.material);
            m.position.set(b.originX, 0, b.originZ);
            m.castShadow = b.cast; m.receiveShadow = b.receive;
            parent.add(m); made++;
          }
          continue;
        }
        const mesh = new THREE.Mesh(merged, b.material);
        mesh.position.set(b.originX, 0, b.originZ);
        mesh.castShadow = b.cast;
        mesh.receiveShadow = b.receive;
        mesh.name = 'prop-batch';
        parent.add(mesh);
        made++;
      }
      buckets.clear();
      return made;
    },
  };
}
