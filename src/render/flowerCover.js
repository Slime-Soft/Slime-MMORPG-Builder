// src/render/flowerCover.js
// 'flower-meadow' ("Meadow Flowers") — the flower equivalent of grass's
// 'grass-meadow': one new, additive Scatter preset, dense, cel-shaded, and
// gently wind-swaying. The existing sparse 'flower'/'flower-daisy'/
// 'flower-bell' props are untouched, same reasoning as grass's 'grass' tuft
// staying untouched — don't upgrade an existing preset in place when asked
// for an additional option.
//
// Three InstancedMeshes per meadow (stems, petal heads, centers), same shape
// as grassCover.js's tuft/meadow split — one draw call each, independent of
// how many flower-meadow props are scattered. Stems sway like a grass blade
// (bend grows toward the tip); heads and centers sway as one rigid unit
// riding the stem tip's motion — a bend gradient across a small sphere
// would shear it in half instead of moving it (see windSway.js). Centers
// are their own mesh (not baked into the head geometry) so every flower's
// center stays a fixed bright yellow instead of getting muddied by that
// flower's random petal tint.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, pick } from '../sim/rng.js';
import { sampleTerrainHeight } from '../sim/world.js';
import { getToonGradientMap } from './toonGradient.js';
import { applyWindSway } from './windSway.js';

const STEM_HEIGHT = 0.3;
const HEAD_RADIUS = 0.06;
const CENTER_RADIUS = HEAD_RADIUS * 0.4;
const CENTER_COLOR = 0xf0c030; // matches generateFlower()'s center — the visible-from-the-editor "actual flower" look this preset was missing
const FLOWERS_PER_MEADOW = 40;
const HEAD_COLORS = [0xe05a7a, 0xf0d030, 0xe0e0f0, 0x7a5ae0, 0xe08a30];

function stemGeometry() {
  const geo = new THREE.CylinderGeometry(0.012, 0.016, STEM_HEIGHT, 5);
  geo.translate(0, STEM_HEIGHT / 2, 0);
  return geo;
}

// A ring of flattened petals merged into ONE geometry — instanced as a
// whole, so it's still one draw call for every flower's petals, unlike
// generateFlower()'s per-flower Group (fine for the sparse 'flower' preset,
// far too many draw calls for a dense scattered meadow). Replaces a bare
// IcosahedronGeometry, which read as a colored polyhedron blob rather than
// a flower — see grass-meadow-white-bug-fix memory for the pairing bug this
// was found alongside (grass color; this is head shape, a separate issue).
function petalRingGeometry() {
  const petalCount = 6;
  const petalRadius = HEAD_RADIUS * 0.62;
  const ringDist = HEAD_RADIUS * 0.65;
  const petals = [];
  for (let i = 0; i < petalCount; i++) {
    const a = (i / petalCount) * Math.PI * 2;
    const petal = new THREE.IcosahedronGeometry(petalRadius, 0);
    petal.scale(1, 0.4, 1); // flatten toward a petal-like disc
    petal.translate(Math.cos(a) * ringDist, 0, Math.sin(a) * ringDist);
    petals.push(petal);
  }
  return mergeGeometries(petals);
}

function centerGeometry() {
  return new THREE.IcosahedronGeometry(CENTER_RADIUS, 0);
}

// The three materials are module-level singletons, created once and shared
// by every meadow mesh built on the page — the live game only ever builds
// one, but the World Editor builds one mesh set per placed prop (see
// buildFlowerMeadowPropMesh below) and a material apiece would mean a shader
// compile per prop plus a separate uTime to tick, so half a field would
// visibly lag the other half in the wind. Never disposed: they outlive any
// one map.
let sharedMats = null;
function flowerMaterials() {
  if (sharedMats) return sharedMats;
  // perInstancePhase: without it every flower swayed through the exact same
  // sin(uTime) at once — the whole meadow moved as one rigid card, which is
  // what read as "stiff" rather than individual plants swaying. Each flower
  // gets its own random (but seeded, so stable across loads) phase offset,
  // shared between its stem and head so the two still move together.
  const stemMat = new THREE.MeshToonMaterial({ color: 0x3f7a30, gradientMap: getToonGradientMap() });
  applyWindSway(stemMat, { height: STEM_HEIGHT, strength: 0.15, perInstancePhase: true });

  const headMat = new THREE.MeshToonMaterial({ gradientMap: getToonGradientMap() });
  applyWindSway(headMat, { strength: 0.15, perInstancePhase: true }); // no `height` — the head sways as one rigid piece

  // Fixed yellow, no per-instance tint — every reference flower has the same
  // bright center regardless of petal color (see generateFlower()), and
  // multiplying a per-flower instanceColor into it would just muddy it
  // toward that flower's petal hue instead. Rides the exact same transform
  // and phase as its head, so it can never drift off-center.
  const centerMat = new THREE.MeshToonMaterial({ color: CENTER_COLOR, gradientMap: getToonGradientMap() });
  applyWindSway(centerMat, { strength: 0.15, perInstancePhase: true });

  sharedMats = { stemMat, headMat, centerMat };
  return sharedMats;
}

/**
 * 'flower-meadow' — dense, cel-shaded, gently wind-swaying. A separate
 * preset, not an upgrade of the existing flower props.
 * @param {{x:number,y:number,z:number}|null} [origin] see grassCover.js's
 *   placeBlades — when set, flowers are placed relative to this world point
 *   instead of in absolute world space, for the editor's per-prop meshes.
 */
function buildMeadowMesh(meadowProps, world, origin = null) {
  if (!meadowProps.length) return null;
  const count = meadowProps.length * FLOWERS_PER_MEADOW;

  const { stemMat, headMat, centerMat } = flowerMaterials();
  const stems = new THREE.InstancedMesh(stemGeometry(), stemMat, count);
  stems.receiveShadow = true;
  stems.name = 'flower-meadow-stems';

  const heads = new THREE.InstancedMesh(petalRingGeometry(), headMat, count);
  heads.receiveShadow = true;
  heads.name = 'flower-meadow-heads';
  heads.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  const centers = new THREE.InstancedMesh(centerGeometry(), centerMat, count);
  centers.receiveShadow = true;
  centers.name = 'flower-meadow-centers';

  const stemPhases = new Float32Array(count);
  const headPhases = new Float32Array(count);

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let i = 0;
  for (const prop of meadowProps) {
    // Seeded off the prop, so a meadow patch looks the same every load.
    const rng = createRng(prop.seed ?? 1);
    const propScale = prop.scale ?? 1;
    const spread = 0.5 * propScale;
    for (let f = 0; f < FLOWERS_PER_MEADOW; f++) {
      const r = Math.sqrt(range(rng, 0, 1)) * spread;
      const a = range(rng, 0, Math.PI * 2);
      const worldX = prop.position.x + Math.cos(a) * r;
      const worldZ = prop.position.z + Math.sin(a) * r;
      const x = origin ? worldX - origin.x : worldX;
      const z = origin ? worldZ - origin.z : worldZ;
      const y = sampleTerrainHeight(world, worldX, worldZ) - (origin ? origin.y : 0);
      const scale = range(rng, 0.7, 1.2) * propScale;
      // A small jitter, not the full 0..2*PI range — that let different
      // flowers land on near-OPPOSITE phases, so at any instant roughly half
      // the meadow was clearly shifted one way and half the other,  which
      // read as "moving in different directions" rather than "gently out of
      // sync." This keeps them loosely synchronized instead.
      const phase = range(rng, -0.6, 0.6);
      stemPhases[i] = phase;
      headPhases[i] = phase;

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, range(rng, 0, Math.PI * 2), 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      stems.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, y + STEM_HEIGHT * scale, z);
      dummy.updateMatrix();
      heads.setMatrixAt(i, dummy.matrix);
      centers.setMatrixAt(i, dummy.matrix); // same transform as its head — same position, rotation, scale
      tint.set(pick(rng, HEAD_COLORS));
      tint.toArray(heads.instanceColor.array, i * 3);
      i++;
    }
  }
  stems.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(stemPhases, 1));
  heads.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(headPhases, 1));
  centers.geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(headPhases.slice(), 1));
  stems.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  centers.instanceMatrix.needsUpdate = true;
  heads.instanceColor.needsUpdate = true;
  stems.computeBoundingSphere();
  heads.computeBoundingSphere();
  centers.computeBoundingSphere();
  return { stems, heads, centers };
}

/** @param {number} elapsed seconds — one tick drives every meadow mesh on the page (shared materials). */
function tickWind(elapsed) {
  if (!sharedMats) return;
  for (const mat of [sharedMats.stemMat, sharedMats.headMat, sharedMats.centerMat]) {
    if (mat.userData.shader) mat.userData.shader.uniforms.uTime.value = elapsed;
  }
}

/**
 * @param {Array<object>} meadowProps world.props filtered to type 'flower-meadow'
 * @param {object} world parsed world.json (for terrain height)
 * @returns {{mesh: THREE.Group, update(elapsed:number): void, dispose(): void}|null}
 *   null when no meadow flowers have been scattered
 */
export function createFlowerCover(meadowProps, world) {
  const meadow = buildMeadowMesh(meadowProps, world);
  if (!meadow) return null;

  const group = new THREE.Group();
  group.name = 'flower-cover';
  group.add(meadow.stems, meadow.heads, meadow.centers);

  return {
    mesh: group,
    /** @param {number} elapsed seconds */
    update: tickWind,
    // Geometries only — the materials are shared page-wide singletons (see
    // flowerMaterials), so disposing them here would blank out every other
    // meadow mesh still on screen.
    dispose() {
      meadow.stems.geometry.dispose();
      meadow.heads.geometry.dispose();
      meadow.centers.geometry.dispose();
    },
  };
}

/**
 * One 'flower-meadow' prop as its own selectable object, from the SAME
 * geometry, materials and seeded scatter createFlowerCover() batches — the
 * World Editor counterpart, reached via buildPropPlaceholder() in scene.js.
 * See grassCover.js's buildGrassPropMesh for the shared rationale, and for
 * the two authoring behaviours (per-prop color, per-prop rotation) that the
 * batched path has no equivalent of and so are not applied here either.
 */
export function buildFlowerMeadowPropMesh(prop, world) {
  const originY = (prop.position.y || 0) + sampleTerrainHeight(world, prop.position.x, prop.position.z);
  const origin = { x: prop.position.x, y: originY, z: prop.position.z };
  const meadow = buildMeadowMesh([prop], world, origin);
  const group = new THREE.Group();
  group.name = 'flower-meadow-prop';
  group.add(meadow.stems, meadow.heads, meadow.centers);
  group.position.set(origin.x, origin.y, origin.z);
  return group;
}

/**
 * Advances the wind on every per-prop meadow mesh at once (they all share the
 * same three materials) — the editor's counterpart to the update() returned
 * by createFlowerCover, called once per frame from its render loop.
 * @param {number} elapsed seconds
 */
export const updateFlowerPropTime = tickWind;
