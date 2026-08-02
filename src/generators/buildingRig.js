// src/generators/buildingRig.js
// Schema -> THREE.Group for an assembled building (src/sim/buildingTypeDefs.js).
// The SAME function the Building Builder's own Assemble-mode preview calls
// and buildBuildingPlaceholder (src/render/scene.js) calls to place a
// `type: 'custom'` building in the world — no separate "export" step, so the
// builder preview and the live game can never drift apart. Mirrors
// buildCreatureRig's authoring/runtime symmetry for characters.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildShapeMesh } from './custom.js';

/**
 * Collects shape meshes into one merged mesh per material instead of leaving
 * each as its own child.
 *
 * WHY: an assembled building is a few hundred pieces of a handful of shapes
 * each, and one mesh apiece meant a town house cost 200-580 DRAW CALLS for
 * ~20 triangles per call. Measured on silverspire, its 53 buildings were
 * 15,709 draw calls for 310,752 triangles — nearly 3x the entire rest of the
 * map's scenery, and the reason turning the camera toward the city tanked the
 * frame rate (frustum culling means you only pay for them once the city is
 * actually in view, so the cost arrives all at once).
 *
 * Buildings only use 17 distinct colours, so bucketing by material collapses
 * that to a handful of calls per building with identical geometry.
 *
 * Keyed by the material's own properties rather than its uuid: buildShapeMesh
 * news up a MeshStandardMaterial per shape, so every one is a distinct object
 * even when a hundred of them are the same colour.
 */
function createMergeSink() {
  const buckets = new Map();
  const loose = []; // meshes that can't be merged — kept as-is rather than dropped
  return {
    /** @param {THREE.Mesh} mesh @param {THREE.Matrix4} matrix its full local transform */
    add(mesh, matrix) {
      // A multi-material mesh carries geometry groups that index into its
      // material array, which can't survive being merged into a shared
      // bucket. Nothing in the building catalog hits this today (face
      // plates are a character feature, see faceMaterials in custom.js), but
      // silently mangling one later would be worse than an extra draw call.
      if (Array.isArray(mesh.material)) {
        // Decomposed, NOT applyMatrix4: `matrix` is already the mesh's full
        // local transform (piece * shape), while applyMatrix4 PREmultiplies
        // onto whatever the mesh is currently holding — which is its own
        // shape matrix — and would apply that half of it twice.
        matrix.decompose(mesh.position, mesh.quaternion, mesh.scale);
        loose.push(mesh);
        return;
      }
      const m = mesh.material;
      const key = `${m.color.getHexString()}|${m.opacity}|${m.transparent}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { material: m, geometries: [] };
        buckets.set(key, bucket);
      }
      const geo = mesh.geometry.applyMatrix4(matrix);
      // mergeGeometries refuses a batch that mixes indexed and non-indexed
      // geometry and returns null — the same trap meshKit.js documents.
      bucket.geometries.push(geo.index ? geo.toNonIndexed() : geo);
    },
    flush(group) {
      for (const { material, geometries } of buckets.values()) {
        const merged = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries, false);
        if (!merged) {
          throw new Error(`buildBuildingFromParts: mergeGeometries failed for material ${material.color.getHexString()} (${geometries.length} parts)`);
        }
        const mesh = new THREE.Mesh(merged, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      for (const mesh of loose) group.add(mesh);
    },
  };
}

/**
 * @param {import('../sim/buildingTypeDefs.js').BuildingTypeDef} buildingDef
 * @param {Record<string, import('../sim/buildingPartDefs.js').BuildingPartDef>} partsById
 * @param {{merge?: boolean}} [opts] `merge` collapses the whole building to
 *   one mesh per material. Defaults to FALSE because the Building Builder's
 *   Assemble mode raycast-selects whole pieces and edits their placement,
 *   which needs the per-piece groups below to still exist. The live game and
 *   the World Editor's world view only ever draw the finished building, so
 *   they pass true — see buildBuildingPlaceholder in src/render/scene.js.
 * @returns {THREE.Group}
 */
export function buildBuildingFromParts(buildingDef, partsById, { merge = false } = {}) {
  const group = new THREE.Group();
  const sink = merge ? createMergeSink() : null;
  const _pieceMatrix = new THREE.Matrix4();

  for (const piece of buildingDef.pieces || []) {
    const part = partsById[piece.partId];
    if (!part) {
      console.warn(`Building "${buildingDef.id}": piece "${piece.id}" references missing part "${piece.partId}" — skipped`);
      continue;
    }
    const pieceGroup = new THREE.Group();
    for (const shapeDef of part.shapes) {
      const shape = piece.colorOverride != null ? { ...shapeDef, color: piece.colorOverride } : shapeDef;
      pieceGroup.add(buildShapeMesh(shape));
    }
    pieceGroup.position.set(piece.position.x, piece.position.y, piece.position.z);
    const rot = piece.rotation;
    if (rot) {
      pieceGroup.rotation.set(((rot.x || 0) * Math.PI) / 180, ((rot.y || 0) * Math.PI) / 180, ((rot.z || 0) * Math.PI) / 180);
    }
    const scale = piece.scale || { x: 1, y: 1, z: 1 };
    pieceGroup.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);

    if (sink) {
      // Bake the piece's transform into each shape's geometry and hand it to
      // the sink — the pieceGroup itself is then thrown away, since a merged
      // building has no per-piece nodes left to hang it on. Composed rather
      // than read off matrixWorld so this doesn't depend on the group ever
      // being added to a scene or having its world matrix updated.
      pieceGroup.updateMatrix();
      for (const shapeMesh of pieceGroup.children) {
        shapeMesh.updateMatrix();
        sink.add(shapeMesh, _pieceMatrix.multiplyMatrices(pieceGroup.matrix, shapeMesh.matrix));
      }
      continue;
    }

    // Tagged so the Building Builder can raycast-select a whole placed piece
    // (Assemble mode edits piece placement, not the shapes inside it — those
    // are edited on the underlying part in Parts mode). Unused, harmless
    // metadata for the live game.
    pieceGroup.userData.pieceId = piece.id;
    pieceGroup.userData.partId = piece.partId;
    group.add(pieceGroup);
  }

  for (const shapeDef of buildingDef.inlineShapes || []) {
    const shapeMesh = buildShapeMesh(shapeDef);
    if (sink) {
      shapeMesh.updateMatrix();
      sink.add(shapeMesh, shapeMesh.matrix);
    } else {
      group.add(shapeMesh);
    }
  }

  if (sink) sink.flush(group);
  return group;
}
