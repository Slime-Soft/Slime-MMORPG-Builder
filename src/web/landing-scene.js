// src/web/landing-scene.js
// The animated backdrop behind the landing page (public/home.html).
//
// The art ships as two layers — assets/web/bg.png (the vista) and
// assets/web/hill.png (the cliff and the party, cut out with alpha) — and the
// whole point of this file is to pull them apart. hill.png is a
// native-resolution crop of the bottom-left corner of the 1920×1080 vista, so
// the two can be recomposed pixel-exactly and then drifted against each other
// for depth. Layers, back to front:
//
//   1. the vista, cover-fit, with a drifting warp that shimmers the sky and
//      leaves the town still, an aura pulsing at the tower's foot, and a
//      noise-scrolled beam up the spire
//   2. rising embers and cool arcane motes
//   3. the cliff and party, moving ~4× the vista's drift — the depth cue
//   4. god rays raking down from above
//
// Camera and layer planes are fixed; parallax is applied as small positional
// and uv offsets. Moving the camera instead would push the vista's edges into
// view and break the screen-space maths that pins the beam to the tower.
import * as THREE from 'three';

/** Where things are in bg.png, in image uv (0,0 = bottom-left). The beam and aura are pinned to these, so they track the tower at any viewport aspect. */
const TOWER_BASE_UV = new THREE.Vector2(0.583, 0.445); // the glowing pool where the spire meets the city
const TOWER_TOP_UV = new THREE.Vector2(0.583, 0.880);  // the spire tip, where the beam trails off

const IMAGE_ASPECT = 1920 / 1080;

/** hill.png's own proportions (438×719). Kept exact so the cliff is never stretched. */
const HILL_ASPECT = 438 / 719;

/**
 * The cliff's height as a fraction of the VIEWPORT, not of the painting.
 *
 * Dropping it back into its original slot (a 438×719 crop flush to the
 * bottom-left of the 1920×1080 original) is the pixel-faithful thing to do,
 * and it is wrong here. That composition was framed for a squarer canvas: at
 * 16:9 it puts the party across the left-MIDDLE of the screen, which is
 * exactly where a left-aligned hero panel has to sit. The two fought, and the
 * panel won — it covered the party completely.
 *
 * Separating the layers is what makes the fix available: the cliff becomes a
 * foreground element placed for the LAYOUT, anchored low in the bottom-left
 * where the panel never reaches, so the party stays visible at every size.
 */
const HILL_SCREEN_HEIGHT = 0.62;

/** Never shrink below this, whatever the layout asks for — a sliver of cliff reads as a bug, not a composition. */
const HILL_MIN_HEIGHT = 0.42;

/** Pushed off the left and bottom edges so the cut-out's own boundary is never on screen. */
const HILL_BLEED = 0.035;

/** The party occupies the top 20% of hill.png (measured off its alpha channel: rows 1–147 of 719). Everything below is solid cliff mass, which panels may safely overlap. */
const HILL_FIGURES_BAND = 0.204;

/**
 * Parallax travel, in world units per unit of eased pointer input.
 *
 * THE CLIFF DOES NOT MOVE, and that is deliberate. Strict parallax says the
 * nearer layer should travel further, which would mean the cliff travelling
 * most — but the cliff is flush against the bottom-left corner and frames the
 * whole composition, so the eye reads it as part of the FRAME rather than part
 * of the world. Sliding a frame looks like the page came unstuck, not like
 * depth; it also has to be chased with bleed margins to stop it uncovering the
 * screen edge it is supposed to be welded to.
 *
 * So the cliff is the anchor — you are standing on it with the party — and the
 * world beyond it drifts instead. The trade is that the vista technically
 * travels further than a nearer layer, which is not what a translating camera
 * would do; it is invisible here because the cliff is an opaque silhouette
 * with no shared depth cues to give the inversion away.
 */
const MIDGROUND_PARALLAX = { x: 0.55, y: 0.34 }; // embers, genuinely nearest — still the most motion
const BACKDROP_PARALLAX = { x: 0.24, y: 0.15 };  // the vista, drifting behind the anchored cliff

/**
 * The vista is drawn slightly larger than the viewport so it has somewhere to
 * drift INTO. Without this the drift would be done by sliding uvs, which at
 * 16:9 (where the cover crop has zero spare pixels) just smears the clamped
 * edge pixels across the border.
 *
 * It also guarantees the cliff overhangs the screen: the cliff is placed
 * relative to this enlarged image rect, so its left and bottom edges sit
 * off-screen by the overscan and can never reveal a seam.
 */
const BG_OVERSCAN = 1.08;

/** Ceiling on |eased|: the pointer contributes ±1 and the idle drift another ±0.35. Rounded up — the overscan has to cover the worst case, not the typical one. */
const MAX_EASED = 1.4;

const CAMERA_Z = 10;
const FOV = 45;

const EMBER_COUNT = 850;
const MOTE_COUNT = 240;

// --- shared GLSL ------------------------------------------------------------

const NOISE_GLSL = /* glsl */ `
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * valueNoise(p);
      p *= 2.03;
      a *= 0.5;
    }
    return v;
  }
`;

// --- layer 1: the vista -------------------------------------------------------

function createBackdrop(texture) {
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    uniforms: {
      uTex: { value: texture },
      uTime: { value: 0 },
      uPlaneAspect: { value: 1 },
      uImageAspect: { value: IMAGE_ASPECT },
      uMotion: { value: 1 },
      uTowerBase: { value: TOWER_BASE_UV.clone() },
      uTowerTop: { value: TOWER_TOP_UV.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform float uTime;
      uniform float uPlaneAspect;
      uniform float uImageAspect;
      uniform float uMotion;
      uniform vec2 uTowerBase;
      uniform vec2 uTowerTop;

      ${NOISE_GLSL}

      /** background-size: cover, in uv space — crops the long axis instead of stretching. */
      vec2 coverUv(vec2 uv) {
        vec2 scale = vec2(1.0);
        if (uPlaneAspect > uImageAspect) scale.y = uImageAspect / uPlaneAspect;
        else scale.x = uPlaneAspect / uImageAspect;
        return (uv - 0.5) * scale + 0.5;
      }

      void main() {
        // No parallax term here: the vista drifts by MOVING THE MESH (see
        // BG_OVERSCAN), which has real room to travel into. Sliding uvs
        // instead would smear clamped edge pixels along the border at 16:9,
        // where the cover crop has no spare pixels to give.
        vec2 uv = coverUv(vUv);

        // Shimmer, weighted toward the sky. The town and fields hold still —
        // warping painted architecture reads as a rendering fault, not magic.
        float sky = smoothstep(0.30, 0.92, uv.y);
        vec2 warp = vec2(
          fbm(uv * 3.1 + vec2(uTime * 0.030, 0.0)) - 0.5,
          fbm(uv * 3.1 + vec2(0.0, uTime * 0.021) + 11.3) - 0.5
        ) * 0.0075 * (0.18 + sky) * uMotion;

        vec3 col = texture2D(uTex, clamp(uv + warp, 0.001, 0.999)).rgb;

        // Aura pooling at the tower's foot, breathing on two beats so the
        // rhythm never resolves into an obvious sine.
        float dBase = length((uv - uTowerBase) * vec2(uImageAspect, 1.0));
        float pulse = 0.55 + 0.28 * sin(uTime * 0.85) + 0.17 * sin(uTime * 1.97 + 1.1);
        float aura = exp(-dBase * 8.5) * pulse;

        // The beam up the spire: a narrow vertical band gated to the stretch
        // between base and tip, with noise flowing upward through it.
        float band = exp(-abs(uv.x - uTowerTop.x) * uImageAspect * 22.0);
        float rise = smoothstep(uTowerBase.y - 0.06, uTowerTop.y + 0.10, uv.y)
                   * (1.0 - smoothstep(uTowerTop.y + 0.02, 1.02, uv.y));
        float flow = fbm(vec2(uv.x * 26.0, uv.y * 4.5 - uTime * 0.40));
        float beam = band * rise * (0.20 + 0.62 * flow);

        col += vec3(0.62, 0.79, 1.0) * (aura * 0.42 + beam * 0.40) * uMotion;

        // A very slow warm/cool drift — the light moving, not the scene.
        float dayDrift = 0.5 + 0.5 * sin(uTime * 0.055);
        col *= mix(vec3(0.985, 0.985, 1.02), vec3(1.03, 1.005, 0.965), dayDrift);

        // Gentle vignette only. The page's panels carry their own backgrounds
        // now, so this no longer has to buy contrast for any text — crushing
        // the picture to make room for copy was the old design's mistake.
        vec2 vd = (vUv - 0.5) * vec2(1.0, 0.94);
        float vig = smoothstep(0.92, 0.28, length(vd));
        col *= mix(0.74, 1.0, vig);

        gl_FragColor = vec4(col, 1.0);
        // MANDATORY on a raw ShaderMaterial. uTex is flagged SRGBColorSpace, so
        // texture2D hands back LINEAR values — but three only appends the
        // linear→sRGB encode to materials built from its own shader chunks.
        // Without this the whole painting renders about five times too dark.
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

// --- layer 3: the cliff and party --------------------------------------------

/**
 * The cut-out foreground. Straight alpha-blended texture — no warp, no
 * shimmer: it is rock and standing figures, and any wobble here would read as
 * a bug. Its whole contribution is the parallax offset applied by the caller,
 * plus a very slight lift toward the viewer.
 */
function createForeground(texture) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTex: { value: texture },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      uniform sampler2D uTex;
      uniform float uOpacity;
      void main() {
        vec4 texel = texture2D(uTex, vUv);
        if (texel.a < 0.004) discard;
        // Deepen the cliff very slightly so it sits as the nearest, shadiest
        // plane rather than competing with the lit valley behind it.
        gl_FragColor = vec4(texel.rgb * 0.94, texel.a * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
}

// --- layer 2: embers + arcane motes -------------------------------------------

/**
 * One additive point cloud. Particles wrap vertically in the VERTEX shader
 * (a modulo on travelled distance), so there is no per-frame CPU work and no
 * buffer re-upload — the system costs one uniform update per frame.
 */
function createParticles({ count, area, tint, tint2, sizeRange, speedRange, sway, seed }) {
  const positions = new Float32Array(count * 3);
  const attributes = new Float32Array(count * 4); // size, speed, phase, tintMix
  // Deterministic scatter — a page that reshuffles its embers on every reload
  // looks accidental, and a seed makes the layout tunable.
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (rand() - 0.5) * area.x;
    positions[i * 3 + 1] = (rand() - 0.5) * area.y;
    positions[i * 3 + 2] = (rand() - 0.5) * area.z;
    attributes[i * 4 + 0] = sizeRange[0] + rand() * (sizeRange[1] - sizeRange[0]);
    attributes[i * 4 + 1] = speedRange[0] + rand() * (speedRange[1] - speedRange[0]);
    attributes[i * 4 + 2] = rand() * Math.PI * 2;
    attributes[i * 4 + 3] = rand();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aParticle', new THREE.BufferAttribute(attributes, 4));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: area.y },
      uSway: { value: sway },
      uTint: { value: new THREE.Color(tint) },
      uTint2: { value: new THREE.Color(tint2) },
      uPixelRatio: { value: 1 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aParticle; // size, speed, phase, tintMix
      uniform float uTime;
      uniform float uHeight;
      uniform float uSway;
      uniform float uPixelRatio;
      varying float vTintMix;
      varying float vFade;

      void main() {
        float size = aParticle.x;
        float speed = aParticle.y;
        float phase = aParticle.z;
        vTintMix = aParticle.w;

        vec3 p = position;
        // Rise and wrap: a particle leaving the top reappears at the bottom
        // with its phase intact.
        float travelled = mod(p.y + uTime * speed + phase, uHeight) - uHeight * 0.5;
        p.y = travelled;
        p.x += sin(uTime * 0.55 + phase * 3.1) * uSway;
        p.z += cos(uTime * 0.41 + phase * 2.3) * uSway * 0.6;

        float t = (travelled + uHeight * 0.5) / uHeight;
        vFade = smoothstep(0.0, 0.16, t) * (1.0 - smoothstep(0.72, 1.0, t));
        vFade *= 0.55 + 0.45 * sin(uTime * 2.3 + phase * 6.0); // embers flicker

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = size * uPixelRatio * (90.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      uniform vec3 uTint;
      uniform vec3 uTint2;
      uniform float uOpacity;
      varying float vTintMix;
      varying float vFade;

      void main() {
        // Soft falloff with a hot core — a flat disc reads as a dead sprite.
        float d = length(gl_PointCoord - 0.5) * 2.0;
        if (d > 1.0) discard;
        float halo = pow(1.0 - d, 2.2);
        float core = pow(max(0.0, 1.0 - d * 2.4), 3.0);
        vec3 col = mix(uTint, uTint2, vTintMix);
        gl_FragColor = vec4(col * (halo + core * 1.6), (halo * 0.75 + core) * vFade * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });

  return new THREE.Points(geometry, material);
}

// --- layer 4: god rays ---------------------------------------------------------

function createGodRays() {
  const group = new THREE.Group();
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uOpacity: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      attribute float aOffset;
      varying float vOffset;
      void main() {
        vUv = uv;
        vOffset = aOffset;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision mediump float;
      varying vec2 vUv;
      varying float vOffset;
      uniform float uTime;
      uniform float uOpacity;
      void main() {
        // Across the shaft: a soft lobe. Along it: fade out toward the floor.
        float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
        float lobe = pow(smoothstep(0.0, 1.0, across), 2.0);
        float along = smoothstep(0.0, 0.35, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
        float breathe = 0.55 + 0.45 * sin(uTime * 0.30 + vOffset * 5.0);
        gl_FragColor = vec4(vec3(1.0, 0.965, 0.88), lobe * along * breathe * 0.11 * uOpacity);
        #include <colorspace_fragment>
      }
    `,
  });

  const shafts = [
    { w: 2.4, h: 26, x: -3.4 }, { w: 1.5, h: 26, x: -0.6 },
    { w: 3.1, h: 26, x: 2.6 }, { w: 1.1, h: 26, x: 5.1 },
  ];
  shafts.forEach((s, i) => {
    const geometry = new THREE.PlaneGeometry(s.w, s.h);
    const offsets = new Float32Array(geometry.attributes.position.count).fill(i / shafts.length);
    geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 1));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(s.x, 2, 0);
    mesh.rotation.z = 0.42;
    group.add(mesh);
  });
  group.userData.material = material;
  return group;
}

// --- assembly -------------------------------------------------------------------

function loadTexture(url) {
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(url, resolve, undefined, () => resolve(null));
  });
}

function prepare(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  // The vista shader nudges uvs for parallax and warp; clamping means those
  // nudges sample the edge pixel rather than wrapping the town into the sky.
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

/**
 * Boots the scene onto `canvas`.
 *
 * @returns {Promise<{dispose: () => void} | null>} null when the scene cannot
 *   or should not run (no WebGL, or the vista failed to load) — the caller
 *   falls back to a static CSS background, which is why this resolves rather
 *   than throwing.
 */
export async function startLandingScene(canvas, { reducedMotion = false, clearanceBelow = null } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  } catch {
    return null; // no WebGL — caller shows the CSS background instead
  }

  const [bgTexture, hillTexture] = await Promise.all([
    loadTexture('/assets/web/bg.png'),
    loadTexture('/assets/web/hill.png'),
  ]);
  if (!bgTexture) {
    renderer.dispose();
    return null;
  }
  prepare(bgTexture);
  if (hillTexture) prepare(hillTexture);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.z = CAMERA_Z;

  const backdrop = createBackdrop(bgTexture);
  backdrop.renderOrder = 0;
  scene.add(backdrop);

  // Mid-depth group: drifts more than the vista, less than the cliff.
  const midground = new THREE.Group();
  scene.add(midground);

  const embers = createParticles({
    count: EMBER_COUNT,
    area: new THREE.Vector3(34, 20, 6),
    tint: 0xffc46b, tint2: 0xff8a3d,
    sizeRange: [1.0, 3.2], speedRange: [0.25, 0.95], sway: 0.5, seed: 20260807,
  });
  embers.position.z = 3.2;
  embers.renderOrder = 1;
  midground.add(embers);

  const motes = createParticles({
    count: MOTE_COUNT,
    area: new THREE.Vector3(30, 20, 5),
    tint: 0x9fd8ff, tint2: 0xdff1ff,
    sizeRange: [1.4, 4.4], speedRange: [0.55, 1.6], sway: 0.85, seed: 991733,
  });
  motes.position.z = 4.6;
  motes.renderOrder = 1;
  midground.add(motes);

  // The cliff. Kept at the same z as the vista so there is no perspective
  // scale difference to compensate for — the depth comes purely from how much
  // further it travels during parallax, which is the effect we actually want
  // and the one we can tune directly.
  const foreground = hillTexture ? createForeground(hillTexture) : null;
  if (foreground) {
    foreground.position.z = 0.02;
    foreground.renderOrder = 2;
    scene.add(foreground);
  }

  const godRays = createGodRays();
  godRays.position.z = 5.4;
  godRays.renderOrder = 3;
  midground.add(godRays);

  const animatedMaterials = [
    backdrop.material, embers.material, motes.material, godRays.userData.material,
    ...(foreground ? [foreground.material] : []),
  ];

  // --- layout -------------------------------------------------------------------

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    // A zero-sized canvas would put a NaN aspect into the projection matrix
    // and the scene would never recover, even once it gained a real box.
    if (width < 1 || height < 1) return;
    const aspect = width / height;

    renderer.setSize(width, height, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();

    // The vista fills the frustum at z = 0, plus overscan so it has room to
    // drift without ever showing an edge.
    const halfHeight = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z;
    const viewW = halfHeight * 2 * aspect;
    const viewH = halfHeight * 2;
    const planeW = viewW * BG_OVERSCAN;
    const planeH = viewH * BG_OVERSCAN;
    backdrop.scale.set(planeW, planeH, 1);
    backdrop.material.uniforms.uPlaneAspect.value = aspect; // unchanged by uniform scaling

    if (foreground) {
      // Sized and anchored against the VIEWPORT (viewW/viewH), not the
      // overscanned vista — this is a layout element now, so it has to answer
      // to the layout's box, not the painting's. Aspect is preserved from the
      // source, so the cliff is never stretched.
      //
      // The clamp is what stops the party being buried again. The figures sit
      // at the TOP of the cut-out, so a taller cliff pushes them HIGHER up the
      // screen and back under the hero panel — the conflict is structural, not
      // a one-off. `clearanceBelow` reports the y (in CSS px) that the panel
      // occupies down to, and the cliff is capped so its top lands below that.
      // Tall windows get the full-size cliff; short ones shrink it rather than
      // letting it collide.
      const clearancePx = Math.max(0, clearanceBelow?.() ?? 0);
      const clearanceFrac = Math.min(0.85, clearancePx / height);
      const maxH = viewH * (1 - clearanceFrac) + viewH * HILL_BLEED;
      const hillH = Math.max(
        viewH * HILL_MIN_HEIGHT,
        Math.min(viewH * HILL_SCREEN_HEIGHT, maxH)
      );
      const hillW = hillH * HILL_ASPECT;
      foreground.scale.set(hillW, hillH, 1);
      // Bottom-left, pushed out past both edges by the bleed so the cut-out's
      // own straight boundary never shows up as a visible seam.
      foreground.position.x = -viewW / 2 + hillW / 2 - viewW * HILL_BLEED;
      foreground.position.y = -viewH / 2 + hillH / 2 - viewH * HILL_BLEED;
    }

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(pixelRatio);
    embers.material.uniforms.uPixelRatio.value = pixelRatio;
    motes.material.uniforms.uPixelRatio.value = pixelRatio;
  }
  resize();

  // --- motion --------------------------------------------------------------------

  const pointer = new THREE.Vector2();   // where the cursor wants the scene
  const eased = new THREE.Vector2();     // where the scene actually is
  function onPointerMove(event) {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -((event.clientY / window.innerHeight) * 2 - 1)
    );
  }

  const clock = new THREE.Clock();
  let running = true;
  let visible = true;
  let frame = 0;

  function renderFrame() {
    const time = clock.getElapsedTime();
    for (const material of animatedMaterials) material.uniforms.uTime.value = time;

    // Ease toward the pointer, plus an idle drift so the scene still moves for
    // a visitor who never touches the mouse (and on touch, where there is no
    // pointer at all).
    const idleX = Math.sin(time * 0.11) * 0.35;
    const idleY = Math.cos(time * 0.083) * 0.22;
    eased.x += (pointer.x + idleX - eased.x) * 0.035;
    eased.y += (pointer.y + idleY - eased.y) * 0.035;

    // The cliff is the anchor and never moves; the world drifts behind it.
    // Clamping to MAX_EASED keeps the vista inside the overscan resize() sized
    // for it, so no amount of pointer flailing can drag an edge into view.
    const px = THREE.MathUtils.clamp(eased.x, -MAX_EASED, MAX_EASED);
    const py = THREE.MathUtils.clamp(eased.y, -MAX_EASED, MAX_EASED);

    backdrop.position.set(-px * BACKDROP_PARALLAX.x, -py * BACKDROP_PARALLAX.y, 0);
    midground.position.set(-px * MIDGROUND_PARALLAX.x, -py * MIDGROUND_PARALLAX.y, 0);

    renderer.render(scene, camera);
  }

  function loop() {
    if (!running) return;
    frame = requestAnimationFrame(loop);
    if (visible) renderFrame();
  }

  if (reducedMotion) {
    // Still WebGL, still the aura and the layering — just frozen. The visitor
    // asked for no motion, not for a worse-looking page.
    backdrop.material.uniforms.uMotion.value = 0;
    renderFrame();
  } else {
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    loop();
  }

  const onResize = () => {
    resize();
    if (reducedMotion) renderFrame();
  };
  window.addEventListener('resize', onResize);

  // The window `resize` event is not enough on its own. Tailwind arrives from
  // a CDN and injects its stylesheet asynchronously, so this can very
  // plausibly run while the canvas still measures 0×0 — and a window that
  // never subsequently resizes would leave the backdrop permanently blank. A
  // ResizeObserver fires the moment the element actually gets a box.
  let canvasObserver = null;
  if ('ResizeObserver' in window) {
    canvasObserver = new ResizeObserver(onResize);
    canvasObserver.observe(canvas);
  }

  // Don't burn a GPU on a tab nobody is looking at.
  let onScreen = true;
  const onVisibility = () => {
    visible = !document.hidden && onScreen;
    if (visible) clock.getDelta(); // swallow the gap so nothing lurches on return
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Same idea for scrolling past the hero. The canvas is fixed behind the whole
  // page, so once the visitor is down among the builder cards it would happily
  // keep rendering a scene nobody can see.
  let heroObserver = null;
  const hero = document.getElementById('top');
  if (hero && 'IntersectionObserver' in window && !reducedMotion) {
    heroObserver = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        onVisibility();
      },
      { threshold: 0 }
    );
    heroObserver.observe(hero);
  }

  return {
    dispose() {
      running = false;
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      canvasObserver?.disconnect();
      heroObserver?.disconnect();
      scene.traverse((object) => {
        object.geometry?.dispose();
        object.material?.dispose();
      });
      bgTexture.dispose();
      hillTexture?.dispose();
      renderer.dispose();
    },
  };
}
