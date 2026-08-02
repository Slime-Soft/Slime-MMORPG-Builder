// src/render/grassCover.js
// Two separate, independently-scattered grass presets, both instanced blade
// cones batched into one draw call each:
//   - 'grass' ("Grass Tuft")     — plain, sparse, lit, static. Unchanged from
//                                  before this project's grass work started.
//   - 'grass-meadow' ("Meadow Grass") — a SEPARATE, additive preset: dense,
//                                  cel-shaded, gently swaying in wind.
// Two earlier attempts at a single unified "field" (a flow-noise shader, then
// a hand-drawn tiled ground texture) both moved away from real, scatterable
// geometry and were rejected. A third attempt made the mistake of upgrading
// the EXISTING 'grass' preset in place instead of adding a new one, and gave
// every blade its own wind phase keyed to world position — which reads as a
// coherent traveling ripple, not wind. This version keeps 'grass' exactly as
// it always was, and gives 'grass-meadow' one uniform sway shared by every
// blade (no spatial phase term), so the whole patch simply leans left-right
// together.
//
// The World Editor still needs one selectable, draggable Object3D per placed
// prop, so it can't use the batched meshes above — but it used to satisfy
// that with a completely DIFFERENT generator (generateGrassPatch), which is
// why grass was the single most obvious "the editor doesn't look like the
// game" difference. buildGrassPropMesh() below is the fix: one prop's worth
// of these exact blades, sharing these exact materials, as a standalone
// object. See its comment for the two authoring behaviours that had to go to
// make the two match.
import * as THREE from 'three';
import { createRng, range } from '../sim/rng.js';
import { sampleTerrainHeight } from '../sim/world.js';
import { getToonGradientMap } from './toonGradient.js';

const BLADE_HEIGHT = 0.3;
const TUFT_BLADES = 14; // 'grass' — original density, untouched
const MEADOW_BLADES = 70; // 'grass-meadow' — the "very high density" preset
const BLADE_COLOR = 0x5aab3f; // base tint both presets scatter around (per-instance HSL jitter in placeBlades)

/**
 * How much of a blade's shadow lookup is pinned to ONE point on the blade
 * rather than taken per-fragment. 1 = fully pinned, 0 = ordinary per-fragment
 * shadowing.
 *
 * This was 1 (hard-pinned), chosen so a shadow edge crossing the field reads
 * as the grass's own jagged silhouette instead of cutting a straight line
 * through individual blades. That's a good look in a still frame and a bad
 * one in motion: a pinned blade is entirely lit or entirely shadowed, so a
 * MOVING shadow — the player's own, most of all — makes thousands of blades
 * pop on and off individually instead of an edge sweeping across them.
 * Measured, that accounted for ~80% of all shadow-attributable pixel change
 * per frame while a character walked (1.57% of the frame with grass
 * receiving shadows, 0.32% without).
 *
 * Partially pinning keeps most of the jagged-silhouette character — a blade
 * still shades largely as a unit, distinct from its neighbours — while
 * letting the lookup vary along its length, so it fades base-to-tip through
 * a passing shadow rather than flipping whole.
 */
const MEADOW_SHADOW_COHESION = 0.5;

// Named looks for 'grass-meadow', ported from stylized-components'
// GrassField presets (github.com/cortiz2894/stylized-components) — a tip
// tint (root-to-tip color gradient) and a dirt color, the two things that
// actually change between seasons here. Swap by passing a season id into
// createGrassCover; 'spring' is the default.
export const GRASS_SEASONS = {
  spring: { tip: 0x9fe870, dirt: 0x6b5236 },
  summer: { tip: 0x6ecB3f, dirt: 0x5a4527 },
  autumn: { tip: 0xd9a12a, dirt: 0x4a3a22 },
};

/**
 * The MEADOW blade — softer and rounder than the tuft's, so a patch reads as
 * fluffy rather than as a hedgehog of spikes.
 *
 * Three deliberate differences from bladeGeometry() above, and 'grass' keeps
 * none of them (this file's header rule: the tuft preset stays exactly as it
 * always was, new looks get a new preset, not an in-place upgrade):
 *
 *   - `heightSegments: 2`, so the blade has a middle ring of vertices to bend
 *     around. A 1-segment cone is a rigid triangle and CANNOT curve no matter
 *     what the vertex shader does to it — this is the whole reason the change
 *     needs new geometry at all rather than just a shader tweak.
 *   - `openEnded: true`, which pays for that. The cone's base cap is 3
 *     triangles facing straight down into the ground where nothing can ever
 *     see it; dropping it takes a blade from 6 tris to 3, and the extra height
 *     segment brings it back to 9. So the whole change is 1.5x triangles, not
 *     3x — which matters, because a big map scatters ~9M grass triangles
 *     before culling (see the CELL_SIZE note below).
 *   - a wider base (0.045 -> 0.062). Fluff is silhouette area, and area is
 *     cheaper bought from width than from blade count.
 */
function meadowBladeGeometry(height) {
  const geo = new THREE.ConeGeometry(0.062, height, 3, 2, true);
  geo.translate(0, height / 2, 0);
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

function bladeGeometry(height) {
  const geo = new THREE.ConeGeometry(0.045, height, 3, 1, false);
  geo.translate(0, height / 2, 0);
  // Normals point straight up, not outward from the cone: a blade's real
  // normals face sideways, so an overhead sun barely lights them and the tuft
  // reads as near-black. Pointing every normal at the sky makes it take the
  // same light as the ground beneath it.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  n.needsUpdate = true;
  return geo;
}

const TUFT_STYLE = { lean: 0.12, widthMin: 1, widthMax: 1, heightMin: 0.6, heightMax: 1.4 };
// Fluffier meadow: blades splay out three times as far and vary in thickness.
// Lean is what actually fills a tuft out — 7 degrees of tilt leaves 70 blades
// standing as a bundle of near-parallel needles with sky between them, while
// 20 degrees spreads them into a dome that overlaps its neighbours. It buys
// the silhouette a much higher blade count would, without the triangles.
// The wider height range is the third free lever: a patch whose blades all
// finish within ±40% of one height has a flat, mown top edge, and a mown edge
// is the opposite of fluffy. Spreading it feathers the top of the patch.
const MEADOW_STYLE = { lean: 0.34, widthMin: 0.7, widthMax: 1.35, heightMin: 0.45, heightMax: 1.55 };

/**
 * Scatter `count` blades per prop around its center, seeded so it's stable
 * across loads.
 * @param {{x:number,y:number,z:number}|null} [origin] when set, blades are
 *   placed RELATIVE to this world point instead of in absolute world space —
 *   the caller then puts the mesh there itself. Only the editor's per-prop
 *   path needs it (the batched meshes sit at the origin, so world space and
 *   local space are the same thing for them). The shader is unaffected either
 *   way: it derives world XZ from `modelMatrix * instanceMatrix`, so the dirt
 *   mask and shadow sampling resolve identically.
 * @param {typeof TUFT_STYLE} [style] per-preset scatter character. Defaults to
 *   the ORIGINAL tuft numbers, so 'grass' keeps byte-identical placement (same
 *   values, same rng draw order) and only the meadow passes something else —
 *   see this file's header on why the tuft preset is never upgraded in place.
 */
function placeBlades(mesh, props, world, count, spread, colors, baseColor, origin = null, style = TUFT_STYLE) {
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  let i = 0;
  for (const prop of props) {
    const rng = createRng(prop.seed ?? 1);
    const propScale = prop.scale ?? 1;
    const r0 = spread * propScale;
    for (let b = 0; b < count; b++) {
      const r = Math.sqrt(range(rng, 0, 1)) * r0;
      const a = range(rng, 0, Math.PI * 2);
      const x = prop.position.x + Math.cos(a) * r;
      const z = prop.position.z + Math.sin(a) * r;
      const y = sampleTerrainHeight(world, x, z);
      if (origin) dummy.position.set(x - origin.x, y - origin.y, z - origin.z);
      else dummy.position.set(x, y, z);
      const lean = style.lean;
      dummy.rotation.set(range(rng, -lean, lean), range(rng, 0, Math.PI * 2), range(rng, -lean, lean));
      // Width is jittered independently of height, so a patch mixes fine
      // wisps with fat ones instead of scaling uniformly — a tuft of
      // identically-proportioned blades reads as a cut-out, not as grass.
      const width = style.widthMin === style.widthMax
        ? style.widthMin
        : range(rng, style.widthMin, style.widthMax);
      dummy.scale.set(width, range(rng, style.heightMin, style.heightMax) * propScale, width);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (colors) {
        tint.copy(baseColor).offsetHSL(range(rng, -0.03, 0.03), range(rng, -0.1, 0.1), range(rng, -0.12, 0.1));
        tint.toArray(colors, i * 3);
      }
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (colors) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function tuftMaterial() {
  return new THREE.MeshLambertMaterial({ color: BLADE_COLOR, side: THREE.DoubleSide });
}

/** 'grass' — the original "Grass Tuft" preset. Plain lit material, static, sparse. */
function buildTuftMesh(grassProps, world) {
  // Chunked on the same grid as the meadow. Tufts are far sparser, so this
  // matters less for them — but a map is free to scatter tens of thousands,
  // and leaving one preset unchunked would make it the new bottleneck.
  return buildChunkedCover(grassProps, world, {
    blades: TUFT_BLADES,
    spread: 0.55,
    geo: bladeGeometry(BLADE_HEIGHT),
    mat: tuftMaterial(),
    name: 'grass-tufts',
    style: TUFT_STYLE,
  });
}

// ── Ground dirt mask, ported verbatim from stylized-components'
// GrassField/shaders/groundMask.ts — a procedural (not painted/authored)
// FBM noise patch pattern in world XZ. Shared by nothing else in this file
// on purpose: this project already tried and deliberately walked back a
// painted/unified "field" system once (see this file's header comment) —
// this is NOT that. It's a pure per-fragment shader effect layered onto the
// existing scattered-blade geometry, no new placement/painting mechanism,
// no new geometry.
const MEADOW_DIRT_GLSL = `
  float meadowDirtHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float meadowDirtNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(meadowDirtHash(i), meadowDirtHash(i + vec2(1.0, 0.0)), u.x),
      mix(meadowDirtHash(i + vec2(0.0, 1.0)), meadowDirtHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float meadowDirtFbm(vec2 p) {
    float v = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 4; i++) {
      v += a * meadowDirtNoise(p);
      n += a;
      p = p * 2.03 + vec2(3.1, 7.7);
      a *= 0.5;
    }
    return v / max(n, 0.001);
  }
  float meadowDirt(vec2 worldXZ, float scale, float coverage, float softness) {
    float n = meadowDirtFbm(worldXZ * scale);
    float threshold = 1.0 - coverage;
    return smoothstep(threshold - softness, threshold + softness, n);
  }
`;

/**
 * Combines this project's own wind-sway technique (a world-space push after
 * <project_vertex>, quadratic height mask — see windSway.js's file header
 * for why THIS project's grass sways as one uniform patch rather than per-
 * blade) with three effects ported from stylized-components' GrassField:
 * a root-to-tip color gradient, a procedural dirt-patch mask that shrinks
 * and browns blades in patches, and cohesive per-blade shadow sampling (see
 * MEADOW_SHADOW_COHESION). All four have to live in one onBeforeCompile — a
 * material only gets one — which is why this isn't built on top of the
 * shared applyWindSway() utility.
 */
function applyMeadowShading(mat, { tip: tipColor, dirt: dirtColor }) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: 0.25 };
    shader.uniforms.uWindSpeed = { value: 0.6 };
    shader.uniforms.uTipColor = { value: new THREE.Color(tipColor) };
    shader.uniforms.uDirtColor = { value: new THREE.Color(dirtColor) };
    shader.uniforms.uDirtScale = { value: 0.35 };
    shader.uniforms.uDirtCoverage = { value: 0.22 };
    shader.uniforms.uDirtSoftness = { value: 0.12 };
    shader.uniforms.uDirtCut = { value: 0.75 }; // how much shorter a fully-dirt blade gets (1 = gone)
    shader.uniforms.uShadowSampleY = { value: 0.25 }; // 0 = sample at the base, 1 = at the tip
    shader.uniforms.uShadowCohesion = { value: MEADOW_SHADOW_COHESION };
    shader.uniforms.uArch = { value: 0.105 }; // metres the tip is thrown sideways by its own curve

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uWindSpeed;
        uniform float uDirtScale;
        uniform float uDirtCoverage;
        uniform float uDirtSoftness;
        uniform float uDirtCut;
        uniform float uShadowSampleY;
        uniform float uShadowCohesion;
        uniform float uArch;
        varying float vBH;    // blade height 0..1, after dirt shrink
        varying float vDirt;  // 0 = full grass, 1 = full dirt, sampled once at the blade's base
        ${MEADOW_DIRT_GLSL}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec2 baseXZ = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        vDirt = meadowDirt(baseXZ, uDirtScale, uDirtCoverage, uDirtSoftness);
        float shrink = 1.0 - uDirtCut * vDirt;
        transformed.y *= shrink;
        // Downstream (wind mask, color gradient) must use the SHRUNK height,
        // not the raw one — otherwise a blade squashed flat over dirt still
        // takes the full wind offset (skates sideways as a flat sliver) and
        // still paints its tip color (speckles the dirt patch green).
        vBH = clamp(transformed.y / ${BLADE_HEIGHT.toFixed(4)}, 0.0, 1.0);
        // FLUFF, part two. The scatter gives each blade a fixed tilt (see
        // MEADOW_STYLE), which spreads the tuft but leaves every blade dead
        // straight — and straight is exactly what reads as spiky. Curving the
        // blade so it leaves the ground upright and flops over toward its tip
        // is what turns a bundle of needles into something soft.
        //
        // Bent in the blade's OWN local space, before <project_vertex>, so
        // the curve rides along with the instance's yaw and tilt instead of
        // every blade in the field arching the same way (which is wind, not
        // shape — and the field already has wind further down).
        //
        // The direction is a cheap hash of the instance's own base position:
        // stable per blade, needs no extra instanced attribute, and is
        // uncorrelated with the yaw the scatter already drew.
        float archAngle = meadowDirtHash(baseXZ * 13.7) * 6.2831;
        transformed.xz += vec2(cos(archAngle), sin(archAngle)) * uArch * vBH * vBH;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        gl_Position += projectionMatrix * viewMatrix * vec4(sin(uTime * uWindSpeed) * uWindStrength * vBH * vBH, 0.0, 0.0, 0.0);`
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        #ifdef USE_SHADOWMAP
          // Pull every vertex of one blade TOWARD a single shared shadow
          // coordinate (a fixed point between base and tip), so the blade
          // shades largely as a unit and a shadow edge reads as the grass's
          // own jagged silhouette rather than a straight line sliced through
          // individual blades. Only partially, though — see
          // MEADOW_SHADOW_COHESION for why pulling it all the way makes a
          // moving shadow pop blades on and off. Safe here:
          // <worldpos_vertex> runs AFTER <project_vertex>, so gl_Position
          // (already final) is unaffected.
          vec3 _shBase = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 _shTip = (modelMatrix * instanceMatrix * vec4(0.0, ${BLADE_HEIGHT.toFixed(4)}, 0.0, 1.0)).xyz;
          vec3 _shBlade = mix(_shBase, _shTip, uShadowSampleY);
          worldPosition.xyz = mix(worldPosition.xyz, _shBlade, uShadowCohesion);
        #endif`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uTipColor;
        uniform vec3 uDirtColor;
        varying float vBH;
        varying float vDirt;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // 0.85, up from 0.7. FLUFF, part three: a tuft looks soft when its
        // top is lighter than its interior, because that is what a mass of
        // fine stuff does under a sky — the tips catch light and the base
        // sits in its own shade. Pushing more of the tip tint up the blade
        // widens that light band, and paired with the arch above (which
        // fans the tips out over the shaded bases) it is what actually
        // separates "fluffy" from "dense".
        diffuseColor.rgb = mix(diffuseColor.rgb, uTipColor, vBH * 0.85);
        // Dirt browns the BASE of a blade, never its tip. Tinting the whole
        // blade by vDirt (what this used to do) turned every blade inside a
        // dirt patch fully brown, so a meadow read as randomly rust-colored
        // rather than as grass thinning out over bare earth — and the patches
        // are big and soft-edged enough that the discoloration was the first
        // thing you noticed. The blade is already squashed short over dirt
        // (uDirtCut in the vertex stage); this only has to darken what's left.
        diffuseColor.rgb = mix(diffuseColor.rgb, uDirtColor, vDirt * (1.0 - vBH) * 0.55);`
      );

    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => `meadow-shading-${tipColor}-${dirtColor}`;
}

function meadowMaterial(season) {
  const mat = new THREE.MeshToonMaterial({ color: BLADE_COLOR, side: THREE.DoubleSide, gradientMap: getToonGradientMap() });
  applyMeadowShading(mat, GRASS_SEASONS[season] || GRASS_SEASONS.spring);
  return mat;
}

// ── Chunking ─────────────────────────────────────────────────────────────────
// One InstancedMesh for the whole map is one draw call, which sounds ideal
// until you count triangles: asteria carries 21,286 grass-meadow props x 70
// blades x 6 triangles = 8.9 MILLION triangles, and a single mesh spanning the
// whole 800x800 map can never be frustum-culled — its bounding sphere always
// intersects the camera, so every one of those triangles is submitted every
// frame no matter which way you face or how far away the grass is.
//
// Splitting the scatter into a grid of per-cell meshes trades a handful of
// extra draw calls for real culling: three.js discards whole cells outside the
// frustum for free, and updateCulling() below drops the ones that are simply
// too far to see. A few dozen visible cells is a couple of hundred thousand
// triangles instead of nine million.
//
// CELL_SIZE is a balance — smaller cells cull more precisely but cost a draw
// call each. At 64m an 800m map is at most 156 cells, of which only the
// handful in front of the camera ever draw.
const CELL_SIZE = 64;
// Grass past this is a sub-pixel fuzz that the fog has already washed out.
// Generous on purpose: popping grass is far more noticeable than popping trees.
const GRASS_VIEW_DISTANCE = 170;

/** Group props into CELL_SIZE buckets by world XZ. */
function chunkProps(props) {
  const cells = new Map();
  for (const p of props) {
    const key = `${Math.floor(p.position.x / CELL_SIZE)},${Math.floor(p.position.z / CELL_SIZE)}`;
    let cell = cells.get(key);
    if (!cell) { cell = []; cells.set(key, cell); }
    cell.push(p);
  }
  return [...cells.values()];
}

/**
 * One InstancedMesh per populated grid cell, all sharing ONE geometry and ONE
 * material — the per-cell split is purely spatial, so there is no reason for
 * each to compile its own shader or hold its own copy of a blade. Sharing the
 * material also means the wind's uTime is a single uniform write per frame
 * rather than one per cell (and so cells can never drift out of sync with each
 * other, which would read as the field tearing along the cell seams).
 */
function buildChunkedCover(props, world, { blades, spread, geo, mat, name, style }) {
  if (!props.length) return null;
  const meshes = [];
  for (const cellProps of chunkProps(props)) {
    const count = cellProps.length * blades;
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    placeBlades(mesh, cellProps, world, blades, spread, mesh.instanceColor.array, new THREE.Color(BLADE_COLOR), null, style);
    // placeBlades already called computeBoundingSphere, which for an
    // InstancedMesh spans its instances — that sphere is exactly what
    // three.js frustum-culls against, and what makes this split pay off.
    meshes.push(mesh);
  }
  return { meshes, geo, mat };
}

/** 'grass-meadow' — dense, cel-shaded, gently wind-swaying, thinning into dirt patches. A separate preset, not an upgrade of 'grass'. */
function buildMeadowMesh(meadowProps, world, season) {
  return buildChunkedCover(meadowProps, world, {
    blades: MEADOW_BLADES,
    spread: 0.5,
    geo: meadowBladeGeometry(BLADE_HEIGHT),
    mat: meadowMaterial(season),
    name: 'grass-meadow',
    style: MEADOW_STYLE,
  });
}

/**
 * @param {Array<object>} grassProps world.props filtered to type 'grass'
 * @param {Array<object>} meadowProps world.props filtered to type 'grass-meadow'
 * @param {object} world parsed world.json (for terrain height)
 * @param {string} [season] one of GRASS_SEASONS' keys; defaults to 'spring'.
 *   No editor UI to pick this yet — swap the call site's argument for now.
 * @returns {{mesh: THREE.Group, update(elapsed:number): void, dispose(): void}|null}
 *   null when neither preset has been scattered
 */
export function createGrassCover(grassProps, meadowProps, world, season) {
  const tufts = buildTuftMesh(grassProps, world);
  const meadow = buildMeadowMesh(meadowProps, world, season);
  if (!tufts && !meadow) return null;

  const group = new THREE.Group();
  group.name = 'grass-cover';
  const chunks = [];
  for (const cover of [tufts, meadow]) {
    if (!cover) continue;
    for (const mesh of cover.meshes) {
      group.add(mesh);
      // Cached rather than recomputed per frame: these never move, and the
      // whole point of this pass is to stop doing per-frame work proportional
      // to the size of the map.
      chunks.push({ mesh, center: mesh.boundingSphere.center.clone(), radius: mesh.boundingSphere.radius });
    }
  }

  const _camPos = new THREE.Vector3();
  return {
    mesh: group,
    /**
     * @param {number} elapsed seconds
     * @param {THREE.Camera} [camera] when passed, chunks beyond
     *   GRASS_VIEW_DISTANCE are hidden. Frustum culling is three.js's job and
     *   happens regardless; this only removes grass that is in front of you
     *   but too far to resolve.
     */
    update(elapsed, camera) {
      if (meadow?.mat.userData.shader) meadow.mat.userData.shader.uniforms.uTime.value = elapsed;
      if (!camera) return;
      camera.getWorldPosition(_camPos);
      for (const c of chunks) {
        // Measured to the chunk's nearest edge, not its centre — a 64m cell
        // has a ~45m half-diagonal, and centre-distance would pop a cell out
        // while its near corner is still well inside view.
        c.mesh.visible = _camPos.distanceTo(c.center) - c.radius <= GRASS_VIEW_DISTANCE;
      }
    },
    dispose() {
      // Geometry and material are shared across every chunk of a preset, so
      // they're disposed once here, not once per mesh.
      tufts?.geo.dispose(); tufts?.mat.dispose();
      meadow?.geo.dispose(); meadow?.mat.dispose();
    },
  };
}

// ── World Editor per-prop path ───────────────────────────────────────────
// Geometry and materials are module-level singletons shared by every
// per-prop mesh: an editor map can hold thousands of grass props, and a
// material apiece would mean thousands of shader compiles and thousands of
// separate uTime uniforms to tick (so half the field would visibly lag the
// other half in the wind). Never disposed — they outlive any one map, and a
// map switch just rebuilds meshes around them.
let sharedBladeGeo = null;
// The two presets no longer share a blade — the meadow's arches and the
// tuft's does not, and that needs a middle ring of vertices only one of them
// has (see meadowBladeGeometry). One shared geo would have silently given the
// editor's meadow props the tuft's rigid blade, i.e. exactly the
// editor-doesn't-match-the-game difference this whole code path exists to
// close.
let sharedMeadowBladeGeo = null;
let sharedTuftMat = null;
const sharedMeadowMats = new Map(); // season id -> material

/**
 * One grass prop as its own selectable object, built from the SAME blades,
 * material and seeded scatter the batched meshes above use — so the World
 * Editor shows exactly what players see. Reached via buildPropPlaceholder()
 * in scene.js, which is every editor placement path.
 *
 * Two authoring behaviours deliberately do NOT apply here, because the live
 * game's batched path has no equivalent and honouring them in the editor is
 * precisely what "looks different in the editor" means:
 *   - `prop.color` — the shared material can't be tinted per prop, and
 *     createGrassCover() ignores prop.color anyway.
 *   - `prop.rotation`/`rotationDeg` — the scatter brush stamps a random Y
 *     rotation onto every prop it places, but blades are already randomly
 *     yawed per blade, and the batched path never reads it.
 *
 * @param {object} prop a world.props entry of type 'grass' or 'grass-meadow'
 * @param {object} world parsed world.json (for terrain height)
 * @param {string} [season] see createGrassCover
 */
export function buildGrassPropMesh(prop, world, season) {
  const isMeadow = prop.type === 'grass-meadow';
  const count = isMeadow ? MEADOW_BLADES : TUFT_BLADES;

  let mat;
  let geo;
  if (isMeadow) {
    const key = GRASS_SEASONS[season] ? season : 'spring';
    if (!sharedMeadowMats.has(key)) sharedMeadowMats.set(key, meadowMaterial(key));
    mat = sharedMeadowMats.get(key);
    if (!sharedMeadowBladeGeo) sharedMeadowBladeGeo = meadowBladeGeometry(BLADE_HEIGHT);
    geo = sharedMeadowBladeGeo;
  } else {
    if (!sharedTuftMat) sharedTuftMat = tuftMaterial();
    mat = sharedTuftMat;
    if (!sharedBladeGeo) sharedBladeGeo = bladeGeometry(BLADE_HEIGHT);
    geo = sharedBladeGeo;
  }

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.receiveShadow = true;
  mesh.name = isMeadow ? 'grass-meadow-prop' : 'grass-tuft-prop';
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);

  // The mesh sits at the prop, blades are placed relative to it — so the
  // editor's drag/move code can keep moving `mesh.position` like it does for
  // every other prop. With the usual prop.position.y of 0 this lands each
  // blade at exactly the world height the batched path gives it.
  const originY = (prop.position.y || 0) + sampleTerrainHeight(world, prop.position.x, prop.position.z);
  const origin = { x: prop.position.x, y: originY, z: prop.position.z };
  placeBlades(mesh, [prop], world, count, isMeadow ? 0.5 : 0.55, mesh.instanceColor.array, new THREE.Color(BLADE_COLOR), origin, isMeadow ? MEADOW_STYLE : TUFT_STYLE);
  mesh.position.set(origin.x, origin.y, origin.z);
  return mesh;
}

/**
 * Advances the wind on every per-prop meadow mesh at once (they all share one
 * material). The batched createGrassCover() returns its own update() instead;
 * this is the editor's counterpart, called once per frame from its render
 * loop.
 * @param {number} elapsed seconds
 */
export function updateGrassPropTime(elapsed) {
  for (const mat of sharedMeadowMats.values()) {
    if (mat.userData.shader) mat.userData.shader.uniforms.uTime.value = elapsed;
  }
}
