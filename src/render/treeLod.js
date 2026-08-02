// src/render/treeLod.js
// Distance LOD for round-canopy trees (src/generators/environment/fluffyTree.js).
//
// A single oak is ~4,600 instanced leaf cards / ~10,000 triangles, and it is
// the most expensive object in the world by a wide margin — measured, asteria's
// 121 oaks are 1.23M triangles and silverspire's oaks + birches are 1.9M, in
// both cases more than everything else on the map combined.
//
// Past ~150m an individual leaf card is well under a pixel, so all the shell
// actually contributes at that range is the crown's silhouette and colour. The
// solid inner core already provides both — same blobs, same material, same
// volumetric gradient — so the far LOD is simply "hide the cards, keep the
// core". No second mesh, no duplicated geometry, nothing to keep in sync; see
// generateFluffyTree, which measures the core-vs-shell scale compensation and
// stashes it in `group.userData.canopyLod`.
//
// WHY NOT THREE.LOD: it swaps between distinct child Object3Ds, so the near
// level would need its own copy of the trunk and core (an Object3D can only
// have one parent). That means duplicating the geometry for every tree, to
// express something that is really just one mesh's `visible` flag.
import * as THREE from 'three';

const _treePos = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/**
 * @param {Array<{lod: object, object: THREE.Object3D}>} entries one per tree —
 *   `lod` is the group's userData.canopyLod, `object` the placed prop mesh
 *   whose world position is the tree's location.
 * @param {{near?: number, far?: number}} [opts] the hysteresis band. Cards are
 *   dropped beyond `far` and restored inside `near`; the gap between the two
 *   is what stops a tree sitting exactly on the boundary from flipping every
 *   frame as the camera bobs (which reads as a flickering tree, and is worse
 *   than either LOD).
 * @returns {{update(camera: THREE.Camera): void, dispose(): void}|null} null
 *   when the map has no round-canopy trees, so callers can skip the per-frame
 *   work entirely.
 */
export function createTreeLod(entries, { near = 130, far = 160 } = {}) {
  if (!entries.length) return null;

  // Positions are captured once, not per frame: props never move, and
  // getWorldPosition() on a few hundred trees every frame is exactly the kind
  // of quiet per-frame cost this module exists to remove.
  const trees = entries.map(({ lod, object }) => {
    const pos = new THREE.Vector3();
    object.getWorldPosition(pos);
    // The crown, not the base — a tall tree's canopy is several metres up, and
    // measuring to the trunk's foot biases every distance when the camera is
    // near ground level.
    if (lod.core.geometry.boundingSphere) {
      pos.y += lod.core.geometry.boundingSphere.center.y * (object.scale?.y ?? 1);
    }
    return { ...lod, pos, isFar: false, applied: false };
  });

  return {
    /** @param {THREE.Camera} camera */
    update(camera) {
      camera.getWorldPosition(_camPos);
      for (const t of trees) {
        _treePos.copy(t.pos);
        const d = _treePos.distanceTo(_camPos);
        // Hysteresis: only the crossing of the FAR edge turns cards off, and
        // only the crossing of the NEAR edge turns them back on.
        const wantFar = t.isFar ? d > near : d > far;
        if (wantFar === t.isFar && t.applied) continue;
        t.isFar = wantFar;
        t.applied = true;
        t.leaves.visible = !wantFar;
        if (wantFar) {
          t.core.scale.setScalar(t.farScale);
          t.core.position.copy(t.farOffset);
        } else {
          t.core.scale.setScalar(1);
          t.core.position.set(0, 0, 0);
        }
      }
    },
    // Restores every tree to full detail. The meshes belong to the world, not
    // to this module, so it must never dispose them — it only undoes the state
    // it set, so a map teardown can't leave a stale shrunken canopy behind.
    dispose() {
      for (const t of trees) {
        t.leaves.visible = true;
        t.core.scale.setScalar(1);
        t.core.position.set(0, 0, 0);
      }
      trees.length = 0;
    },
  };
}
