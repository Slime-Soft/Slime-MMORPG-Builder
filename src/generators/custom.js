// src/generators/custom.js
// Object Builder (World Editor roadmap section E, MVP slice): objects
// composed from a list of primitive shapes instead of a hand-written
// per-species generator. Each shape is a unit-sized base geometry scaled
// per-axis, so `scale` on a shape descriptor directly controls its final
// dimensions — no separate "size" concept to reconcile with `scale`.
import * as THREE from 'three';
import { logWallGeometry, shingleRoofPanelGeometry } from './environment/buildingParts.js';
import { buildFaceTexture } from './faceTexture.js';

// The shape vocabulary itself lives in src/sim/shapeKinds.js (the schema
// validators need it and sim may not import this Three-dependent module).
// Re-exported here so renderer-side callers can keep reaching for it where
// the meshes are built. All kinds are unit-sized (~1×1×1) so a shape's
// `scale` directly controls its final dimensions — EXCEPT 'log-wall' and
// 'shingle-roof-panel', see PARAMETRIC_KINDS below.
export { SHAPE_KINDS } from '../sim/shapeKinds.js';

// These two kinds build their geometry directly at the requested size
// instead of stretching a unit template — a log wall widened via uniform
// scale would stretch each post into an oval instead of adding more posts,
// and a shingle panel would stretch every diamond instead of tiling more of
// them. `buildShapeMesh` skips its normal mesh.scale.set() step for these.
export const PARAMETRIC_KINDS = ['log-wall', 'shingle-roof-panel'];

/** A unit triangular prism (roof/fin shape): triangle in XY (base along X at y=-0.5, apex at y=+0.5), extruded along Z from -0.5..0.5. ExtrudeGeometry handles face winding, so it lights correctly from all sides. */
function wedgeGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.5, -0.5);
  shape.lineTo(0.5, -0.5);
  shape.lineTo(0, 0.5);
  shape.lineTo(-0.5, -0.5);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.translate(0, 0, -0.5); // ExtrudeGeometry pushes +Z from 0; recenter on the origin
  return geo;
}

function geometryForKind(kind, shapeDef) {
  switch (kind) {
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 16, 12);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 16);
    case 'capsule':
      return new THREE.CapsuleGeometry(0.35, 0.3, 6, 12); // radius*2 + length = 1.0 tall
    case 'pyramid': {
      // 4-sided cone = square pyramid; rotate 45° so its faces (not corners)
      // point along the axes, reading as a proper pyramid rather than a diamond.
      const g = new THREE.ConeGeometry(0.5, 1, 4);
      g.rotateY(Math.PI / 4);
      return g;
    }
    case 'wedge':
      return wedgeGeometry();
    case 'log-wall': {
      // Not unit+scale like everything else — scale.x/scale.y ARE the real
      // length/height, so widening this adds more posts instead of
      // stretching each one into an oval.
      const scale = shapeDef?.scale || {};
      return logWallGeometry(Math.max(0.5, scale.x || 3), Math.max(0.3, scale.y || 2.5));
    }
    case 'shingle-roof-panel': {
      // Same deal: scale.x/scale.z are the real slope-length/depth, so
      // widening this tiles more diamonds instead of stretching them.
      const scale = shapeDef?.scale || {};
      return shingleRoofPanelGeometry(Math.max(0.5, scale.x || 3), Math.max(0.5, scale.z || 4));
    }
    case 'box':
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

/**
 * A shape carrying a `face` descriptor (a head box) gets a SIX-material array
 * instead of one material, with the drawn face on the +Z side only — that's
 * BoxGeometry's material index 4. Every other side keeps the plain skin
 * material, so the head is still one solid of one colour with a picture on the
 * front.
 *
 * Returns null for everything else, which is every shape in the game except a
 * head. Under plain Node buildFaceTexture returns null (no canvas) and this
 * falls through to the flat material too, so `npm run check:prefabs` is
 * unaffected.
 */
function faceMaterials(shapeDef, base) {
  if (!shapeDef.face || shapeDef.kind !== 'box') return null;
  const tex = buildFaceTexture(shapeDef.face);
  if (!tex) return null;
  const front = base.clone();
  front.map = tex;
  // The plate is drawn already containing the skin tone, so leave the tint
  // white — multiplying the texture by the skin colour a second time renders
  // a face two shades too dark.
  front.color = new THREE.Color(0xffffff);
  return [base, base, base, base, front, base];
}

/**
 * One shape descriptor -> one mesh, positioned/rotated/scaled/colored in
 * local space only (no knowledge of where the finished object is placed in
 * the world — that's applied to the outer group by buildPropPlaceholder,
 * same as every other prop type).
 *
 * Rotation: an optional `rotation: {x,y,z}` object (degrees, applied in
 * THREE's default XYZ order) enables tilting on any axis — needed for
 * organic creature parts (angled snouts, splayed legs, swept horns). The
 * older single-axis `rotationDeg` (Y only) is still honored when no
 * `rotation` object is present, so existing saved shapes/props are
 * unaffected.
 */
export function buildShapeMesh(shapeDef) {
  const geometry = geometryForKind(shapeDef.kind, shapeDef);
  const opacity = shapeDef.opacity ?? 1;
  // emissive/metalness/roughness arrived with equipment gear
  // (src/sim/gearVisuals.js): a glowing rune on a chestplate and a polished
  // pauldron are the same shape descriptor with different material fields, and
  // authoring them as material properties means gear goes through this one
  // mesh builder like everything else instead of needing its own. Undefined on
  // every pre-existing shape, so nothing else changes — note `emissive`
  // deliberately falls back to BLACK (Three's own default, i.e. no glow)
  // rather than to `color`, or every prop in the game would start glowing.
  const material = new THREE.MeshStandardMaterial({
    color: shapeDef.color ?? 0xcccccc,
    emissive: shapeDef.emissive ?? 0x000000,
    emissiveIntensity: shapeDef.emissiveIntensity ?? 1,
    ...(shapeDef.metalness !== undefined ? { metalness: shapeDef.metalness } : {}),
    ...(shapeDef.roughness !== undefined ? { roughness: shapeDef.roughness } : {}),
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geometry, faceMaterials(shapeDef, material) || material);
  const pos = shapeDef.position || { x: 0, y: 0, z: 0 };
  mesh.position.set(pos.x, pos.y, pos.z);
  const rot = shapeDef.rotation;
  if (rot && typeof rot === 'object') {
    mesh.rotation.set(
      ((rot.x || 0) * Math.PI) / 180,
      ((rot.y || 0) * Math.PI) / 180,
      ((rot.z || 0) * Math.PI) / 180
    );
  } else {
    mesh.rotation.y = ((shapeDef.rotationDeg || 0) * Math.PI) / 180;
  }
  // log-wall/shingle-roof-panel already baked scale.x/scale.y(/scale.z) into
  // the geometry itself above — applying mesh.scale on top would stretch the
  // already-correctly-sized posts/shingles a second time.
  if (!PARAMETRIC_KINDS.includes(shapeDef.kind)) {
    const scale = shapeDef.scale || { x: 1, y: 1, z: 1 };
    mesh.scale.set(scale.x || 1, scale.y || 1, scale.z || 1);
  }
  mesh.userData.shapeId = shapeDef.id;
  mesh.userData.kind = shapeDef.kind; // lets tooling (e.g. monsterConnectivity) reason about the solid, not just its bounding box
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Restyle an ALREADY-BUILT shape mesh's opacity — the live counterpart to the
 * `transparent`/`opacity` pair buildShapeMesh sets at construction.
 *
 * `material.transparent` is part of three.js's shader-program cache key, so
 * flipping it on a material that has already been compiled does nothing at all
 * until the material is marked dirty: the old, blend-disabled program keeps
 * getting used. Every opacity slider in the builders hit exactly that — the
 * value landed on the material and in the saved data, and the viewport never
 * changed, which reads as "opacity does nothing".
 *
 * Exists here rather than in each editor because buildShapeMesh owns the
 * opacity convention, and two copies of this had already drifted into the
 * Monster Builder and the World Editor's Object Builder.
 * @param {import('three').Mesh} mesh
 * @param {number} opacity 0..1
 */
export function setShapeOpacity(mesh, opacity) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const wantsTransparent = opacity < 1;
  for (const material of materials) {
    if (!material) continue;
    material.opacity = opacity;
    if (material.transparent !== wantsTransparent) {
      material.transparent = wantsTransparent;
      material.needsUpdate = true; // recompile: `transparent` changes the program, not just a uniform
    }
  }
}

/** A saved object's full shape list -> one THREE.Group, ready for buildPropPlaceholder's position/rotation/scale/tint pass. */
export function generateCustomObject(shapes) {
  const group = new THREE.Group();
  for (const shapeDef of shapes || []) {
    group.add(buildShapeMesh(shapeDef));
  }
  return group;
}
