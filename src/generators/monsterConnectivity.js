// src/generators/monsterConnectivity.js
// Guardrail against the recurring "floating detached parts" failure when
// authoring monster prefabs by hand.
//
// A creature is CONNECTED when every one of its shapes overlaps at least
// one other shape, so the whole body forms a single connected piece. That
// is checked here against real primitive geometry, per shape.
//
// An earlier version of this file compared per-SLOT axis-aligned bounding
// boxes with a distance tolerance. That was far too permissive and produced
// false "connected" results on visibly broken creatures: a leg dangling
// below a thin body still had an overlapping AABB, an eye floating in front
// of a head lived inside the head's own slot and so was never compared at
// all, and an arm sitting 0.045 outside a torso slipped under a 0.05
// tolerance. Bounding boxes are the wrong instrument — overlap of the
// actual solids is the thing we care about, so that is what we test.
import * as THREE from 'three';
import { buildMonsterRig } from './monsterRig.js';

// How far, in a shape's own unit-local space, a sample point may sit outside
// a solid and still count as touching it. Small on purpose: parts are
// expected to genuinely interpenetrate, not merely graze.
const LOCAL_MARGIN = 0.02;
const MAX_SAMPLES_PER_SHAPE = 160; // primitives are low-poly; this covers them without being slow

/**
 * Is a point (already in the solid's unit-local space) inside that solid?
 * Every geometry in custom.js is authored around a unit primitive, so the
 * mesh's own matrix carries all the scaling — meaning these tests are
 * against fixed, known unit shapes.
 */
function insideUnitSolid(kind, p, m = LOCAL_MARGIN) {
  const { x, y, z } = p;
  switch (kind) {
    case 'sphere':
      return x * x + y * y + z * z <= (0.5 + m) * (0.5 + m);
    case 'cylinder':
      return Math.hypot(x, z) <= 0.5 + m && Math.abs(y) <= 0.5 + m;
    case 'cone': {
      if (Math.abs(y) > 0.5 + m) return false;
      const allowed = 0.5 * (0.5 - y); // apex (r=0) at y=+0.5, base (r=0.5) at y=-0.5
      return Math.hypot(x, z) <= Math.max(0, allowed) + m;
    }
    case 'pyramid': {
      // ConeGeometry(0.5,1,4).rotateY(45°): square cross-section, axis-aligned,
      // half-side 0.5*cos45 = 0.3536 at the base, tapering to 0 at the apex.
      if (Math.abs(y) > 0.5 + m) return false;
      const half = 0.35355 * (0.5 - y);
      return Math.max(Math.abs(x), Math.abs(z)) <= Math.max(0, half) + m;
    }
    case 'capsule': {
      // CapsuleGeometry(0.35, 0.3): radius 0.35 around the segment y ∈ [-0.15, 0.15].
      const yc = Math.max(-0.15, Math.min(0.15, y));
      return Math.hypot(x, y - yc, z) <= 0.35 + m;
    }
    case 'wedge': {
      // Triangular prism: triangle (-.5,-.5) (.5,-.5) (0,.5) in XY, extruded on Z.
      if (Math.abs(z) > 0.5 + m) return false;
      if (y < -0.5 - m) return false;
      // outward-normal half-plane tests for the two sloped edges
      const bc = ((x - 0.5) * 1 + (y + 0.5) * 0.5) / Math.SQRT2; // edge (0.5,-0.5)->(0,0.5)
      const ca = ((x - 0) * -1 + (y - 0.5) * 0.5) / Math.SQRT2; // edge (0,0.5)->(-0.5,-0.5)
      return bc <= m && ca <= m;
    }
    case 'box':
    default:
      return Math.abs(x) <= 0.5 + m && Math.abs(y) <= 0.5 + m && Math.abs(z) <= 0.5 + m;
  }
}

/** Evenly-strided sample of a geometry's vertices, in world space, plus its centre. */
function worldSamples(mesh) {
  const pos = mesh.geometry.attributes.position;
  const stride = Math.max(1, Math.ceil(pos.count / MAX_SAMPLES_PER_SHAPE));
  const out = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += stride) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    out.push(v.clone());
  }
  out.push(mesh.getWorldPosition(new THREE.Vector3()));
  return out;
}

/** Do two shapes' solids actually overlap? Tested both directions, since a small shape can sit wholly inside a large one. */
function shapesOverlap(a, b) {
  if (!a.box.intersectsBox(b.box)) return false; // cheap reject
  const p = new THREE.Vector3();
  for (const s of a.samples) {
    if (insideUnitSolid(b.kind, p.copy(s).applyMatrix4(b.inverse))) return true;
  }
  for (const s of b.samples) {
    if (insideUnitSolid(a.kind, p.copy(s).applyMatrix4(a.inverse))) return true;
  }
  return false;
}

/** Every shape of an assembled creature, with the data needed for overlap tests. */
function collectShapes(monsterType) {
  const { group } = buildMonsterRig(monsterType);
  group.updateMatrixWorld(true); // never added to a scene, so world matrices are stale
  const shapes = [];
  for (const pivot of group.children) {
    const role = pivot.userData.slotRole;
    if (!role) continue;
    for (const mesh of pivot.children) {
      if (!mesh.isMesh) continue;
      shapes.push({
        role,
        shapeId: mesh.userData.shapeId,
        kind: mesh.userData.kind,
        inverse: new THREE.Matrix4().copy(mesh.matrixWorld).invert(),
        box: new THREE.Box3().setFromObject(mesh),
        samples: worldSamples(mesh),
      });
    }
  }
  return shapes;
}

/**
 * Shapes that are NOT part of the creature's main connected piece.
 * @returns {Array<{role:string, shapeId:string}>} empty when the whole body is one piece
 */
export function findDetachedParts(monsterType) {
  const shapes = collectShapes(monsterType);
  if (shapes.length <= 1) return [];

  // union-find over "these two solids overlap"
  const parent = shapes.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };

  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      if (find(i) !== find(j) && shapesOverlap(shapes[i], shapes[j])) union(i, j);
    }
  }

  // The "body" is the component containing the torso, else simply the largest.
  const groups = new Map();
  shapes.forEach((s, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });
  let mainRoot = null;
  for (const [root, members] of groups) {
    if (members.some((i) => shapes[i].role === 'torso')) { mainRoot = root; break; }
  }
  if (mainRoot === null) {
    mainRoot = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  }

  return shapes
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => find(i) !== mainRoot)
    .map(({ s }) => ({ role: s.role, shapeId: s.shapeId }));
}

/** Distinct slot roles containing at least one detached shape — what the editor's save warning surfaces. */
export function findDetachedSlots(monsterType) {
  const parts = findDetachedParts(monsterType);
  const roles = [...new Set(parts.map((p) => p.role))];
  return roles.map((role) => ({ role, shapes: parts.filter((p) => p.role === role).map((p) => p.shapeId) }));
}
