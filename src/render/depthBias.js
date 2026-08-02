// src/render/depthBias.js
// Making a decal reliably win the depth test against the surface it lies on.
//
// Ground textures and drawn paths are decals: flat layers a few centimetres
// above the terrain mesh. That gap is fixed in WORLD units, but the depth
// buffer's resolution is not — it degrades with the square of distance. Close
// up, 3cm is hundreds of depth steps; two hundred metres out it can be less
// than one, and the decal and the ground swap places from frame to frame.
// That is the shimmer you see in the distance.
//
// WHY NOT polygonOffset: it was tried and reverted (see the long note in
// groundTextureMesh.js). polygonOffsetUnits is measured in depth-buffer steps,
// so an offset big enough to win at 200m is enormous at 5m — and these meshes
// span the whole 1000x1000 map, covering that entire range at once. No single
// constant is correct.
//
// The fix is to bias in CLIP space instead, where the correction scales with
// distance automatically: subtracting `k * gl_Position.w` from `gl_Position.z`
// is a constant shift in normalised device coordinates, which is exactly the
// space the depth buffer's precision is uniform in. One constant works at
// every distance, which is the property polygonOffset lacks.
//
// Safe because it only moves the decal TOWARD the camera by a hair — far less
// than the thickness of anything real, so it can't punch through a wall — and
// these materials are the flattest, lowest things in the scene.

/** NDC shift toward the camera. ~1e-4 of the [-1,1] depth range: comfortably more than a 24-bit buffer's step at any distance, far too small to see. */
const DEFAULT_BIAS = 0.0001;

/**
 * Pull a material's fragments slightly toward the camera in depth, so it wins
 * against the surface it's laid on at every distance.
 *
 * Composes with an existing `onBeforeCompile` (it chains rather than replaces),
 * so it can be applied alongside the custom fragment shaders these materials
 * already carry — and likewise chains `customProgramCacheKey`.
 *
 * That cache key is NOT optional. `onBeforeCompile` doesn't participate in
 * three.js's program cache key, so without it a biased material and an
 * ordinary MeshStandardMaterial hash to the same entry and whichever compiles
 * first wins for both — either the decal silently loses its bias, or every
 * plain prop in the scene quietly gains one.
 *
 * @param {import('three').Material} material
 * @param {number} [bias] NDC units; larger = more aggressively in front
 */
export function applyDecalDepthBias(material, bias = DEFAULT_BIAS) {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (previous) previous.call(material, shader, renderer);
    // Appended at the very end of main(), after every other vertex chunk has
    // finished writing gl_Position — including the project's own wind sway,
    // which also mutates it.
    shader.vertexShader = shader.vertexShader.replace(
      /\}\s*$/,
      `  gl_Position.z -= ${bias.toFixed(6)} * gl_Position.w;\n}`
    );
  };
  const previousKey = material.customProgramCacheKey;
  material.customProgramCacheKey = () =>
    `${previousKey ? previousKey.call(material) : ''}|decal-depth-bias-${bias}`;
}
