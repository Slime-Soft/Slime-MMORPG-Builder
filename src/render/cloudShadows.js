// src/render/cloudShadows.js
// Cloud shadows aren't real shadow-casting — the sky's cloud meshes are
// unlit billboards, not depth-tested against anything (see atmosphere.js's
// header comment on why) — so this fakes the effect as a scrolling multiply
// on the ground's own diffuse color instead, sampling a real tileable
// grayscale cloud-shape texture rather than a synthetic sine pattern (the
// original version here). This is a deliberate, Dennis-authored exception to
// the "no external asset files" rule — same precedent as ez-tree (see
// CLAUDE.md) — using the file he supplied at
// public/assets/cloud-shadows/cloudshadow.png. White = no shadow, the gray
// blobs = cloud coverage; multiplied straight into the diffuse color.
import * as THREE from 'three';
import { currentAnisotropy } from './renderSettings.js';

let cloudShadowTexture = null;
/**
 * The "long lines"/streaking Dennis reported at a shallow camera angle is
 * the textbook symptom of a tiled, high-contrast texture (this mask is ~92%
 * near-0 with sparse near-1 cloud blobs) sampled without anisotropic
 * filtering — every OTHER tiled ground texture in this project
 * (groundTextureThemes/pathThemes/mountainThemes) sets `.anisotropy` at
 * creation for exactly this reason; this one just got missed. Re-applied on
 * every call (not just at creation) since `currentAnisotropy` can change
 * per map after this singleton texture already exists.
 */
function getCloudShadowTexture() {
  if (!cloudShadowTexture) {
    cloudShadowTexture = new THREE.TextureLoader().load('/assets/cloud-shadows/cloudshadow.png');
    cloudShadowTexture.wrapS = cloudShadowTexture.wrapT = THREE.RepeatWrapping;
    cloudShadowTexture.colorSpace = THREE.NoColorSpace; // a grayscale mask, not an sRGB color — don't gamma-decode it
  }
  cloudShadowTexture.anisotropy = currentAnisotropy;
  return cloudShadowTexture;
}

const CLOUD_SHADOW_UNIFORMS_GLSL = `
  uniform sampler2D uCloudShadowMap;
  uniform float uCloudShadowEnabled;
  uniform float uCloudShadowStrength;
  uniform float uCloudShadowSpeed;
  uniform float uCloudShadowTime;
`;

/** @param {string} worldXZExpr a GLSL expression, valid at the injection point, evaluating to a vec2 world XZ position */
function cloudShadowSampleGLSL(worldXZExpr) {
  return `
  if (uCloudShadowEnabled > 0.5) {
    // mod() the scroll offset before it ever reaches the texture sample —
    // uCloudShadowTime only ever grows (see updateCloudShadowTime), and a
    // large float fed into a wrapped texture sample loses precision in a way
    // that reads as streaking, same family of artifact as the missing
    // anisotropy above. 1000.0 is an arbitrary "plenty of repeats, still
    // small enough to stay precise" cutoff, not a meaningful world unit.
    vec2 scroll = mod(vec2(uCloudShadowTime * uCloudShadowSpeed, uCloudShadowTime * uCloudShadowSpeed * 0.6), 1000.0);
    vec2 cw = (${worldXZExpr}) * 0.008 + scroll;
    // The source PNG's cloud shapes are the OPAQUE (alpha/RGB near-1) blobs;
    // the vast transparent (near-0) majority is clear sky — confirmed by
    // sampling actual pixel data (R and A track together: ~0 for "clear",
    // ~230/255 for "cloud"). Sampling .r directly (as a first pass did) reads
    // "cloud present" as shade=1 = no darkening, inverting the whole effect:
    // it darkened the entire ground EXCEPT the sparse cloud shapes, which
    // read as bright wispy cutouts ("light rays") instead of dark patches.
    float cloud = texture2D(uCloudShadowMap, cw).r;
    float shade = 1.0 - cloud;
    gl_FragColor.rgb *= mix(1.0 - uCloudShadowStrength, 1.0, shade);
  }
`;
}

/**
 * Adds a cloud-shadow uniform block + darkening multiply to a material via
 * onBeforeCompile, composing with any onBeforeCompile the material already
 * has (rather than replacing it) — see groundTextureMesh.js's own hook,
 * which this is meant to layer on top of. worldXZExpr must be a GLSL
 * expression already valid at the fragment shader's `#include
 * <dithering_fragment>` point — callers differ in what varying/local they
 * have on hand (groundTextureMesh.js already computes a `worldXZ` local).
 * @returns {{enabled: {value:number}, strength: {value:number}, speed: {value:number}, time: {value:number}}} live uniform refs — mutate `.value` to retune at runtime.
 */
export function addCloudShadowShader(material, worldXZExpr) {
  const uniforms = {
    enabled: { value: 0 },
    strength: { value: 0.3 },
    speed: { value: 0.02 },
    time: { value: 0 },
    map: { value: getCloudShadowTexture() },
  };
  const prevOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prevOnBeforeCompile) prevOnBeforeCompile(shader, renderer);
    shader.uniforms.uCloudShadowMap = uniforms.map;
    shader.uniforms.uCloudShadowEnabled = uniforms.enabled;
    shader.uniforms.uCloudShadowStrength = uniforms.strength;
    shader.uniforms.uCloudShadowSpeed = uniforms.speed;
    shader.uniforms.uCloudShadowTime = uniforms.time;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${CLOUD_SHADOW_UNIFORMS_GLSL}`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `${cloudShadowSampleGLSL(worldXZExpr)}\n#include <dithering_fragment>`
    );
  };
  material.userData.cloudShadowUniforms = uniforms;
  return uniforms;
}

/** Advances every cloud-shadow-enabled material found under `object` by dt seconds — call once per frame, same pattern as updateWaterTime. */
export function updateCloudShadowTime(object, dt) {
  object.traverse((obj) => {
    const uniforms = obj.material && obj.material.userData && obj.material.userData.cloudShadowUniforms;
    if (uniforms) uniforms.time.value += dt;
  });
}

/** Applies graphicsSettings.postFx.cloudShadows to every cloud-shadow-enabled material found under `object`. */
export function applyCloudShadowSettings(object, cloudShadows) {
  object.traverse((obj) => {
    const uniforms = obj.material && obj.material.userData && obj.material.userData.cloudShadowUniforms;
    if (!uniforms) return;
    uniforms.enabled.value = cloudShadows.enabled ? 1 : 0;
    uniforms.strength.value = cloudShadows.strength;
    uniforms.speed.value = cloudShadows.speed;
  });
}
