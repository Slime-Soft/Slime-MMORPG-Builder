// src/render/windSway.js
// Two different sway techniques for two different situations:
//
// `applyWindSway` — a per-vertex shader push, for the INSTANCED meadow
// presets (grass-meadow, flower-meadow) where there can be thousands of
// blades/stems in one draw call and animating them from JS would mean
// rewriting every instance matrix every frame. Every instance leans the same
// WORLD direction at the same time (see the fixed-bugs list below);
// `perInstancePhase` desyncs WHEN each swings, not which way.
//
// `createSwayAnimator` — a plain per-frame Object3D.rotation update, for
// individually-PLACED props (a single flower/daisy/bluebell — a handful of
// objects, not thousands). A shader-based "world-space push" was tried here
// first and looked stiff: it's a pure TRANSLATION with no bend gradient
// (these are compound multi-mesh objects — stem, petals, center as separate
// Meshes — with no generic way to know which sub-mesh is "near the base" vs
// "near the tip", so it moved the WHOLE object, including its planted base,
// sideways as one rigid slab — never actually bending, just sliding).
// Rotating the object's own Group around its own origin is a real Three.js
// scene-graph transform: children compose under it correctly regardless of
// their own individual positions/rotations, by construction, and a rotation
// around the base is what an actual swaying plant looks like (an arc, not a
// slide) — no shader, no per-vertex bend math needed at this scale.
//
// Three bugs already got fixed in applyWindSway and must stay fixed:
// (1) A "uniform" offset added at <begin_vertex> is still in LOCAL space —
// for an instanced mesh, before each instance's own rotation applies, so
// every instance would lean a different world-space direction; fixed by
// applying the push to gl_Position AFTER <project_vertex> has already run.
// (2) Default amplitude/frequency were tuned way down after an initial pass
// swayed a full blade-height sideways.
// (3) The AFTER-<project_vertex> push originally used `modelViewMatrix`
// (view * that object's OWN modelMatrix) rather than `viewMatrix` alone.
// That's harmless for an InstancedMesh with no object-level rotation of its
// own (grass/flower-meadow — every per-blade/per-stem rotation lives in
// instanceMatrix, applied earlier, not in modelMatrix). But a scattered
// flower patch (one placed 'flower'/'flower-daisy' prop) builds each petal
// as its OWN separately-rotated Mesh (`pet.rotation.y = -a`) — that rotation
// IS part of modelMatrix, so the same nominal push got redirected a
// different world direction per petal and the flower visibly flew apart.
// `viewMatrix` alone has no object transform baked in at all, so it's a true
// world-space direction regardless of whether — or how — the mesh it's
// applied to is itself rotated.
import * as THREE from 'three';

/**
 * @param {THREE.Material} mat mutated in place (sets onBeforeCompile + customProgramCacheKey)
 * @param {{height?: number, speed?: number, strength?: number, perInstancePhase?: boolean}} [opts]
 *   `height`: for tall thin shapes rooted at their local origin (blades,
 *   stems) — bend grows 0 (at local y=0) to 1 (at local y=height), so the
 *   base stays planted and only the tip sways. Omit for small/rigid shapes,
 *   or a whole multi-part object (e.g. one flower's stem+petals+center) where
 *   a bend gradient would shear the parts apart instead of moving them
 *   together — those sway at full strength uniformly across every vertex.
 *   `speed`/`strength` default to grass-meadow's tuned values.
 *   `perInstancePhase`: reads a per-instance `instancePhase` float attribute
 *   (the caller must set one via `geometry.setAttribute('instancePhase',
 *   new THREE.InstancedBufferAttribute(...))`) and adds it inside the sine,
 *   so instances sway out of sync with each other instead of in lockstep.
 */
export function applyWindSway(mat, { height = null, speed = 0.6, strength = 0.25, perInstancePhase = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWindStrength = { value: strength };
    shader.uniforms.uWindSpeed = { value: speed };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform float uWindStrength;
        uniform float uWindSpeed;
        ${perInstancePhase ? 'attribute float instancePhase;' : ''}
        float windBend;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        windBend = ${
          height != null
            ? `pow(clamp(transformed.y / ${height.toFixed(3)}, 0.0, 1.0), 2.0)`
            : '1.0'
        };`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        gl_Position += projectionMatrix * viewMatrix * vec4(sin(uTime * uWindSpeed${perInstancePhase ? ' + instancePhase' : ''}) * uWindStrength * windBend, 0.0, 0.0, 0.0);`
      );
    mat.userData.shader = shader;
  };
  // onBeforeCompile mutations aren't part of Three's default program-cache
  // key, so without a key unique per (height, speed, strength, perInstancePhase)
  // two materials with different sway parameters could reuse each other's
  // compiled program and silently get the wrong sway (or none).
  mat.customProgramCacheKey = () => `wind-sway-${height ?? 'rigid'}-${speed}-${strength}-${perInstancePhase}`;
}

/**
 * Call once per frame per swaying mesh, for a mesh built with `applyWindSway`
 * whose material ISN'T shared with anything else — grass/flower cover share
 * one material across the whole world and drive `uTime` directly (see
 * grassCover.js/flowerCover.js's own `.update()`), but something like a
 * tree's leaf InstancedMesh gets its own separate material per tree (there
 * can be hundreds of trees), so each one needs its own call. No-ops before
 * the material's shader has compiled once (`userData.shader` isn't set
 * until the first render) — same pattern as scene.js's updateWaterTime.
 * @param {THREE.Object3D} mesh @param {number} elapsed seconds
 */
export function updateWindSwayTime(mesh, elapsed) {
  const shader = mesh?.material?.userData?.shader;
  if (shader) shader.uniforms.uTime.value = elapsed;
}

/**
 * A gentle per-frame rocking rotation for a handful of individually-placed
 * objects (a single flower/daisy/bluebell prop, not a scattered field of
 * them — see the file header for why this is a different technique from
 * `applyWindSway`). Each object gets its own random (but seeded once at
 * setup) phase, so a cluster of them doesn't rock in lockstep.
 * @param {THREE.Object3D[]} objects
 * @param {{speed?: number, maxAngle?: number}} [opts] `maxAngle` in radians
 * @returns {{update(elapsed:number): void}}
 */
export function createSwayAnimator(objects, { speed = 0.6, maxAngle = 0.05 } = {}) {
  const entries = objects.map((object) => ({ object, phase: Math.random() * Math.PI * 2 }));
  return {
    /** @param {number} elapsed seconds */
    update(elapsed) {
      for (const { object, phase } of entries) {
        object.rotation.z = Math.sin(elapsed * speed + phase) * maxAngle;
      }
    },
  };
}
