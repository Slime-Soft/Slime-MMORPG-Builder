// src/render/postProcessing.js
// The one place both the live game (src/main.js) and the World Editor
// (src/editor/main.js) build their EffectComposer from — previously
// duplicated between the two (see the editor-game-render-sync work). Every
// pass is constructed ONCE, in a fixed order, and toggled/retuned via
// applySettings(graphicsSettings) rather than rebuilt per map switch —
// cheaper, and avoids leaking GPU resources on every teleport.
//
// Pass order: SSAO -> base render -> bloom -> depth of field -> saturation/
// colorfulness -> sharpen -> FXAA -> output (must stay last — see its own
// note in the old main.js/editor.js composer setup about sRGB conversion).
//
// Not a composer pass, so not built here: cloud shadows (a ground-shader
// uniform block, see groundTextureMesh.js). Sunrays ARE partly a pass now —
// see SunraysShader below and the sun-rays sprite in atmosphere.js.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Saturation + "colorfulness" (a vibrance-style boost weighted toward
// already-low-saturation pixels, so skin/near-neutral tones don't blow out
// the way a flat saturation multiplier would) in one pass. Saturation math
// is lifted from three's own HueSaturationShader (hue term dropped — this
// project has no use for a hue-rotation control).
const SaturationColorfulnessShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 0 },
    colorfulness: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation;
    uniform float colorfulness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float average = (color.r + color.g + color.b) / 3.0;
      if (saturation > 0.0) {
        color.rgb += (average - color.rgb) * (1.0 - 1.0 / (1.001 - saturation));
      } else {
        color.rgb += (average - color.rgb) * (-saturation);
      }
      float maxc = max(color.r, max(color.g, color.b));
      float minc = min(color.r, min(color.g, color.b));
      float boost = colorfulness * (1.0 - (maxc - minc));
      color.rgb = mix(vec3(average), color.rgb, 1.0 + boost);
      gl_FragColor = color;
    }`,
};

// Screen-space light shafts for graphicsSettings.environmental.type ===
// 'sunrays'. atmosphere.js already draws a spiky sprite ON the sun, but that
// only exists where the sun is — and a third-person MMO camera looks slightly
// DOWNWARD, so the sun is off-screen essentially always and the setting looked
// like it did nothing. Shafts drawn in screen space still sweep across the
// frame from an off-screen sun, which is the whole point.
//
// Not true god rays: real ones raymarch the depth buffer so geometry occludes
// them, which this toon pipeline has no infrastructure for (same skip-list
// reasoning as the sprite version). These are unoccluded radial shafts,
// anchored to the sun's projected screen position and faded out as the sun
// swings behind the camera.
const SunraysShader = {
  uniforms: {
    tDiffuse: { value: null },
    sunPos: { value: new THREE.Vector2(0.5, 1.2) }, // screen uv; legitimately outside 0..1 when the sun is off-frame
    rayColor: { value: new THREE.Color(0xfff0c8) },
    intensity: { value: 0 },
    facing: { value: 0 }, // 0 = sun behind the camera, 1 = dead ahead
    aspect: { value: 1 },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 sunPos;
    uniform vec3 rayColor;
    uniform float intensity;
    uniform float facing;
    uniform float aspect;
    uniform float time;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      float amount = intensity * facing;
      if (amount <= 0.0) {
        gl_FragColor = base;
        return;
      }
      // Aspect-correct so the shafts stay radial instead of squashing with the
      // window; without this they fan out sideways on a wide viewport.
      vec2 d = (vUv - sunPos) * vec2(aspect, 1.0);
      float dist = length(d);
      float ang = atan(d.y, d.x);
      // Two spoke sets at different frequencies drifting in opposite
      // directions, so the pattern breathes instead of reading as a static
      // starburst decal.
      float spokes = pow(abs(sin(ang * 7.0 + time * 0.06)), 4.0) * 0.65
                   + pow(abs(sin(ang * 13.0 - time * 0.04)), 6.0) * 0.35;
      // The falloff rate has to be measured against how far the ANCHOR actually
      // sits from the frame, not against the frame itself. update() clamps the
      // anchor to ~1.1 uv units off-centre, so the near edge of the screen is
      // already ~0.6 away and the far edge ~1.7: at the old 1.3 rate that span
      // was multiplied by 0.45..0.11, which on top of the gain below left the
      // shafts at well under 1% brightness and the setting looked dead.
      float shaft = exp(-dist * 0.55) * spokes * amount * 1.1;
      gl_FragColor = vec4(base.rgb + rayColor * shaft, base.a);
    }`,
};

// A plain 3x3 sharpen kernel — no built-in three.js addon covers this one.
const SharpenShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    strength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 px = 1.0 / resolution;
      vec4 center = texture2D(tDiffuse, vUv);
      vec4 sum = texture2D(tDiffuse, vUv + vec2(px.x, 0.0))
               + texture2D(tDiffuse, vUv - vec2(px.x, 0.0))
               + texture2D(tDiffuse, vUv + vec2(0.0, px.y))
               + texture2D(tDiffuse, vUv - vec2(0.0, px.y));
      gl_FragColor = center + (center * 4.0 - sum) * strength;
    }`,
};

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @returns {{composer: EffectComposer, applySettings(settings: object): void, setSize(w:number,h:number): void}}
 */
export function createPostProcessing(renderer, scene, camera) {
  // The actual drawing-buffer resolution, NOT renderer.getSize()'s CSS-pixel
  // size — FXAA's resolution uniform is a literal per-texel sample offset,
  // so on any display with devicePixelRatio !== 1 (most laptops/monitors),
  // seeding it from the CSS size samples at the wrong offsets and the whole
  // frame comes out as a flat, detail-less blur. This was the actual cause
  // of a much-investigated "scene renders as a flat colored fill" bug that
  // was originally (wrongly) chased as a bloom/composer-warm-up timing
  // issue — it isn't timing-based at all, it's simply wrong on every load
  // whenever devicePixelRatio !== 1. setSize() below already got this right;
  // construction just hadn't matched it.
  const size = renderer.getSize(new THREE.Vector2());
  const pr = renderer.getPixelRatio();
  const pixelW = size.x * pr;
  const pixelH = size.y * pr;
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pr);

  const ssaoPass = new SSAOPass(scene, camera, pixelW, pixelH);
  ssaoPass.enabled = false;
  composer.addPass(ssaoPass);

  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(pixelW, pixelH), 0.35, 0.4, 0.85);
  composer.addPass(bloomPass);

  const bokehPass = new BokehPass(scene, camera, { focus: 30, aperture: 0.00003, maxblur: 0.01 });
  bokehPass.enabled = false;
  composer.addPass(bokehPass);

  const sunraysPass = new ShaderPass(SunraysShader);
  sunraysPass.enabled = false;
  sunraysPass.uniforms.aspect.value = pixelW / pixelH;
  composer.addPass(sunraysPass);

  const saturationPass = new ShaderPass(SaturationColorfulnessShader);
  composer.addPass(saturationPass);

  const sharpenPass = new ShaderPass(SharpenShader);
  sharpenPass.enabled = false;
  sharpenPass.uniforms.resolution.value.set(pixelW, pixelH);
  composer.addPass(sharpenPass);

  const fxaaPass = new ShaderPass(FXAAShader);
  fxaaPass.material.uniforms.resolution.value.set(1 / pixelW, 1 / pixelH);
  composer.addPass(fxaaPass);

  composer.addPass(new OutputPass()); // must stay last — sRGB/tone-mapping output conversion

  function setSize(w, h) {
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio();
    ssaoPass.setSize(w * pr, h * pr);
    sharpenPass.uniforms.resolution.value.set(w * pr, h * pr);
    sunraysPass.uniforms.aspect.value = w / h;
    fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
  }

  const _sunDir = new THREE.Vector3();
  const _camFwd = new THREE.Vector3();
  const _sunPoint = new THREE.Vector3();
  /**
   * Per-frame update for the sunrays pass — call once per frame, before
   * composer.render(). Everything else here is set-and-forget from
   * applySettings(); this needs the live camera orientation. No-op (and costs
   * nothing) when sunrays aren't the active environmental effect.
   * @param {number} elapsed seconds since start, for the shafts' slow drift
   */
  function update(elapsed) {
    if (!sunraysPass.enabled) return;
    sunraysPass.uniforms.time.value = elapsed;
    const sun = scene.getObjectByName('sun-light');
    if (!sun) {
      sunraysPass.uniforms.facing.value = 0;
      return;
    }
    _sunDir.copy(sun.position).sub(sun.target.position).normalize(); // see atmosphere.js's sunDirection() for why the target is subtracted
    camera.getWorldDirection(_camFwd);
    // Compare AZIMUTHS, not full 3D directions. "Is the sun in front of me" is a
    // compass question; a full dot product also answers "is the sun at my eye
    // level", which it never is — at the default 55 degree elevation the sun's
    // own y term alone subtracts ~0.28 from the dot, so the previous 3D version
    // peaked at ~0.37 even while staring straight down the sun's bearing, and
    // any higher-elevation map drove it to zero regardless of where you looked.
    const sunLen = Math.hypot(_sunDir.x, _sunDir.z) || 1;
    const camLen = Math.hypot(_camFwd.x, _camFwd.z) || 1;
    const bearing = (_sunDir.x * _camFwd.x + _sunDir.z * _camFwd.z) / (sunLen * camLen);
    // Ramped rather than a hard cutoff, so spinning the camera past the sun
    // fades the shafts out instead of popping them off.
    sunraysPass.uniforms.facing.value = Math.max(0, Math.min(1, (bearing + 0.3) / 0.9));
    if (bearing <= -0.3) return;
    // project() negates both axes for a point behind the camera (w < 0), which
    // would mirror the anchor to the wrong side of the frame; the bearing test
    // can't catch that on its own because a sun high overhead can be behind the
    // camera's near plane while still dead ahead on the compass. This is the
    // full 3D dot, i.e. exactly "is it in front of the near plane".
    const behind = _camFwd.dot(_sunDir) < 0;
    _sunPoint.copy(camera.position).addScaledVector(_sunDir, 700).project(camera);
    let ox = (behind ? -_sunPoint.x : _sunPoint.x) * 0.5;
    let oy = (behind ? -_sunPoint.y : _sunPoint.y) * 0.5;
    // Pull the anchor in to just off-frame, preserving its direction. Left
    // unclamped it lands several screen-heights away (the camera looks downward,
    // so the sun is essentially always far above the top edge) and every pixel
    // sits deep in the falloff's tail. Clamping keeps the shafts converging on
    // the correct side of the frame while staying close enough to be seen.
    const off = Math.hypot(ox, oy);
    const MAX_OFFSET = 1.1;
    if (off > MAX_OFFSET) {
      ox *= MAX_OFFSET / off;
      oy *= MAX_OFFSET / off;
    }
    sunraysPass.uniforms.sunPos.value.set(ox + 0.5, oy + 0.5);
  }

  /** @param {object} settings shape matches src/sim/graphicsSettings.js's defaultGraphicsSettings() */
  function applySettings(settings) {
    const fx = settings.postFx;

    ssaoPass.enabled = fx.ssao.enabled;
    ssaoPass.kernelRadius = fx.ssao.intensity;

    bloomPass.enabled = fx.bloom.enabled;
    bloomPass.strength = fx.bloom.strength;
    bloomPass.radius = fx.bloom.radius;
    bloomPass.threshold = fx.bloom.threshold;

    bokehPass.enabled = fx.dof.enabled;
    bokehPass.uniforms.focus.value = fx.dof.focus;
    bokehPass.uniforms.aperture.value = fx.dof.aperture;
    bokehPass.uniforms.maxblur.value = fx.dof.maxBlur;

    saturationPass.uniforms.saturation.value = settings.saturation;
    saturationPass.uniforms.colorfulness.value = settings.colorfulness;

    sharpenPass.enabled = fx.sharpen.enabled;
    sharpenPass.uniforms.strength.value = fx.sharpen.strength;

    fxaaPass.enabled = fx.fxaa.enabled;

    // Not under postFx — sunrays is an `environmental` type, sharing the one
    // "what's in the air on this map" control with rain/snow/dust/wind. Maps
    // saved before that field existed simply have no rays.
    const env = settings.environmental;
    sunraysPass.enabled = env?.type === 'sunrays';
    sunraysPass.uniforms.intensity.value = env?.intensity ?? 1;
    sunraysPass.uniforms.rayColor.value.setHex(settings.light.color);

    renderer.toneMappingExposure = settings.exposure;
  }

  /**
   * The first composer.render() after a scene is (re)populated can still
   * come out blank/stuck on some loads — real, reproducible, independent of
   * which passes are enabled or the FXAA resolution fix above (both were
   * separately investigated and ruled out as the sole cause). The one thing
   * that reliably un-sticks it in every manual repro is a render() call
   * issued from a DevTools console — which runs OUTSIDE the page's normal
   * paint/rAF cycle, unlike a synchronous call from inside an async event
   * handler (e.g. a socket 'welcome' callback), which can land at any point
   * relative to the browser's next paint and doesn't reliably force one.
   * This forces the render across two ACTUAL requestAnimationFrame
   * callbacks (each guaranteed to run right before a real paint) with a
   * synchronous layout reflow forced in between, on the theory that it's
   * the paint/compositor step itself that needs forcing, not the render
   * call's content. Call once after the real scene has been built.
   */
  function warmUp() {
    composer.render();
    requestAnimationFrame(() => {
      void renderer.domElement.offsetHeight; // force a synchronous layout reflow between frames
      composer.render();
      requestAnimationFrame(() => {
        composer.render();
      });
    });
  }

  return { composer, applySettings, setSize, update, warmUp };
}
