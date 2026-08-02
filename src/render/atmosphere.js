// src/render/atmosphere.js
// Sky, fog and lighting — the three things that carry most of the stylized
// low-poly look in the reference screenshots.
//
// The single biggest change from the old setup is that FOG COLOUR IS TIED TO
// THE SKY'S HORIZON COLOUR, and the fog is exponential rather than linear.
// A linear fog fading to a flat sky-blue leaves a hard, visible band where the
// world ends. Exponential squared fog whose colour matches the horizon makes
// distant trees dissolve into the sky, which is exactly the hazy depth every
// one of those screenshots has.
//
// Everything is driven by a PRESET, so a region can carry its own mood (snowy
// pine forest, pink blossom valley, sunlit meadow) without touching code.
import * as THREE from 'three';
import { DEFAULT_SHADOW_MAP_SIZE, recommendedShadowNormalBias } from '../sim/graphicsSettings.js';

/**
 * @typedef {Object} AtmospherePreset
 * @property {string} id
 * @property {string} name
 * @property {number} skyTop       zenith colour
 * @property {number} skyHorizon   colour at the horizon; the fog matches it
 * @property {number} fogDensity   exp2 density. ~0.0035 = mist at 300 units
 * @property {number} sunColor
 * @property {number} sunIntensity
 * @property {[number,number,number]} sunDir  direction the light comes FROM
 * @property {number} hemiSky      bounce light from above
 * @property {number} hemiGround   bounce light from the ground (tints shadows)
 * @property {number} hemiIntensity
 * @property {number} groundLow    ground tint at low elevation
 * @property {number} groundHigh   ground tint at high elevation (snow caps, rock)
 * @property {number} grassColor   base colour of the grass field
 */

/** @type {AtmospherePreset[]} */
export const ATMOSPHERE_PRESETS = [
  {
    id: 'meadow', name: 'Sunlit Meadow',
    skyTop: 0x6fb8e0, skyHorizon: 0xf0e6b8, fogDensity: 0.0026,
    sunColor: 0xfff0c8, sunIntensity: 1.75, sunDir: [0.55, 0.6, 0.4],
    hemiSky: 0xbfe8ff, hemiGround: 0x5f7a3a, hemiIntensity: 0.85,
    groundLow: 0x5fa03c, groundHigh: 0x87b85a, grassColor: 0x5aa832,
  },
  {
    id: 'pine', name: 'Snowy Pines',
    skyTop: 0xc9b6d8, skyHorizon: 0xe8dfe6, fogDensity: 0.0045,
    sunColor: 0xf0eaff, sunIntensity: 1.15, sunDir: [0.3, 0.6, 0.6],
    hemiSky: 0xdfe6f2, hemiGround: 0x6a7a86, hemiIntensity: 1.0,
    groundLow: 0x4a6a56, groundHigh: 0xe8f0f4, grassColor: 0x4d6b52,
  },
  {
    id: 'blossom', name: 'Blossom Valley',
    skyTop: 0xa8dcc8, skyHorizon: 0xf2dfe6, fogDensity: 0.0042,
    sunColor: 0xfff0f4, sunIntensity: 1.3, sunDir: [0.5, 0.7, 0.35],
    hemiSky: 0xf6e2ea, hemiGround: 0x8aa06a, hemiIntensity: 1.0,
    groundLow: 0x8fbf72, groundHigh: 0xe6dbe0, grassColor: 0x86bb63,
  },
  {
    id: 'gloom', name: 'Deep Forest',
    skyTop: 0x3f5a52, skyHorizon: 0x8fa88c, fogDensity: 0.006,
    sunColor: 0xd8ecc0, sunIntensity: 0.9, sunDir: [0.35, 0.8, 0.4],
    hemiSky: 0x9fbfa8, hemiGround: 0x2a3a2a, hemiIntensity: 0.75,
    groundLow: 0x3e7a34, groundHigh: 0x5c8a48, grassColor: 0x46912f,
  },
  {
    id: 'dusk', name: 'Dusk',
    skyTop: 0x3a3a6a, skyHorizon: 0xe8a86a, fogDensity: 0.005,
    sunColor: 0xffbe78, sunIntensity: 1.1, sunDir: [-0.5, 0.25, -0.4],
    hemiSky: 0x6a6ab0, hemiGround: 0x3a2a2a, hemiIntensity: 0.7,
    groundLow: 0x4a5a3a, groundHigh: 0x6a6250, grassColor: 0x46583a,
  },
];

export const getPreset = (id) =>
  ATMOSPHERE_PRESETS.find((p) => p.id === id) || ATMOSPHERE_PRESETS[0];

/**
 * A handful of cumulus-style cloud clusters scattered across an overhead
 * band of sky. Same technique the tree/bush foliage generators use —
 * several overlapping flat-shaded spheres per cluster rather than one big
 * sphere — because a single sphere reads as a ball, not a cloud silhouette.
 * Two-toned per cluster (bright top puffs, a slightly cooler/darker
 * underside) for cheap fake depth without any lighting cost, since the sky
 * dome itself is `fog: false`/unlit and clouds should match that — a lit
 * cloud would darken oddly as the sun direction changes between presets.
 */
function createClouds(radius = 850, count = 9) {
  const group = new THREE.Group();
  group.name = 'cloud-layer';
  const topMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
  const underMat = new THREE.MeshBasicMaterial({ color: 0xd8e4ec, fog: false });

  for (let i = 0; i < count; i++) {
    const cluster = new THREE.Group();
    // Spherical placement: full circle around, but only in an overhead band
    // (not down at the horizon, not directly at zenith) so clouds read as
    // "in the sky ahead of you" from any direction you're facing.
    const azimuth = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const elevation = 0.35 + Math.random() * 0.4; // ~20-65 degrees up
    const x = Math.cos(azimuth) * Math.cos(elevation);
    const y = Math.sin(elevation);
    const z = Math.sin(azimuth) * Math.cos(elevation);
    cluster.position.set(x * radius, y * radius, z * radius);
    cluster.lookAt(0, 0, 0); // orient so the cluster's own "up" reads correctly from the camera at the dome's center

    const puffCount = 4 + Math.floor(Math.random() * 4);
    const clusterScale = 18 + Math.random() * 22;
    for (let p = 0; p < puffCount; p++) {
      const puffR = clusterScale * (0.5 + Math.random() * 0.5);
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(puffR, 0), topMat);
      puff.position.set(
        (Math.random() - 0.5) * clusterScale * 1.8,
        Math.random() * clusterScale * 0.5,
        (Math.random() - 0.5) * clusterScale * 0.9 // flattened front-to-back — clouds are wide and shallow, not round
      );
      puff.scale.y *= 0.55;
      cluster.add(puff);
    }
    // One or two darker under-puffs, offset low and behind — reads as the
    // cloud's shaded underside without needing real lighting.
    for (let p = 0; p < 2; p++) {
      const puffR = clusterScale * (0.45 + Math.random() * 0.3);
      const under = new THREE.Mesh(new THREE.IcosahedronGeometry(puffR, 0), underMat);
      under.position.set((Math.random() - 0.5) * clusterScale * 1.4, -clusterScale * 0.22, -clusterScale * 0.2);
      under.scale.y *= 0.5;
      cluster.add(under);
    }
    group.add(cluster);
  }
  return group;
}

/**
 * A soft glowing disc hanging in the sun's direction — the sky dome's
 * gradient alone doesn't produce anything bright enough to read as "there's
 * the sun", which is a big part of what makes the reference screenshots
 * feel sunlit rather than just brightly lit. Additive-blended radial falloff
 * so it brightens whatever's behind it (more clouds, more sky) rather than
 * covering it — a solid disc would look like a sticker.
 */
const GLOW_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const GLOW_FRAG = /* glsl */`
  uniform vec3 glowColor;
  varying vec2 vUv;
  void main() {
    float d = distance(vUv, vec2(0.5));
    float a = smoothstep(0.5, 0.0, d);
    a = pow(a, 1.6); // concentrates brightness toward the center rather than a linear falloff
    gl_FragColor = vec4(glowColor, a);
  }
`;
function createSunGlow(preset) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color(preset.sunColor) } },
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false, // always visible through/in front of the sky dome and clouds, same as a real sun would be
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  glow.name = 'sun-glow';
  glow.renderOrder = -1;
  glow.frustumCulled = false;
  return glow;
}

// "Sunrays" (graphicsSettings.environmental.type === 'sunrays') aren't real
// volumetric light shafts — that needs depth-aware raymarching this
// project's toon pipeline has no infrastructure for (see the plan's
// skip-list) — so this is a second, larger streaky layer on the same
// sun-glow sprite: angular sine bands radiating from center, faded by the
// same radial falloff as the base glow so it still reads as "light source",
// just spikier. Hidden (intensity 0) unless environmental.type is
// specifically 'sunrays' — see applyGraphicsSettingsToAtmosphere.
const RAYS_FRAG = /* glsl */`
  uniform vec3 glowColor;
  uniform float intensity;
  varying vec2 vUv;
  void main() {
    vec2 centered = vUv - vec2(0.5);
    float d = length(centered);
    float ang = atan(centered.y, centered.x);
    float rays = pow(abs(sin(ang * 10.0)), 3.0); // 10 soft spokes around the disc
    float falloff = smoothstep(0.5, 0.0, d);
    float a = falloff * mix(0.25, 1.0, rays) * intensity;
    gl_FragColor = vec4(glowColor, a);
  }
`;
function createSunRays(preset) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(preset.sunColor) },
      intensity: { value: 0 },
    },
    vertexShader: GLOW_VERT,
    fragmentShader: RAYS_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  });
  const rays = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  rays.name = 'sun-rays';
  rays.renderOrder = -1;
  rays.frustumCulled = false;
  return rays;
}

// A sky DOME rather than a flat scene.background. A flat background colour can
// never produce the vertical gradient the screenshots have, and — more subtly —
// it can't match the fog at the horizon while staying a different colour
// overhead. The dome is drawn on the inside of a big sphere, unlit, unfogged,
// and with depth writing off so it never occludes anything.
const SKY_VERT = /* glsl */`
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform float exponent;
  varying vec3 vWorldPosition;
  void main() {
    // Height above the horizon, 0..1, biased so the gradient concentrates near
    // the horizon the way real aerial haze does.
    float h = normalize(vWorldPosition).y;
    float t = pow(clamp(h, 0.0, 1.0), exponent);
    gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
  }
`;

/**
 * The sky dome. Radius must sit inside the camera's far plane; it renders first
 * and writes no depth, so its size is arbitrary as long as it encloses the view.
 */
export function createSkyDome(preset, radius = 1500) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(preset.skyTop) },
      horizonColor: { value: new THREE.Color(preset.skyHorizon) },
      exponent: { value: 0.6 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), mat);
  dome.name = 'sky-dome';
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/**
 * Install (or re-tune) sky, fog and lights on a scene. Idempotent: calling it
 * again with a different preset re-colours what's already there instead of
 * stacking a second sun, so a live "atmosphere" dropdown just works.
 *
 * @param {THREE.Scene} scene
 * @param {AtmospherePreset|string} presetOrId
 * @param {{shadows?: boolean, shadowRadius?: number}} [opts]
 * @returns {{preset: AtmospherePreset, sun: THREE.DirectionalLight, sky: THREE.Mesh}}
 */
export function applyAtmosphere(scene, presetOrId, opts = {}) {
  const preset = typeof presetOrId === 'string' ? getPreset(presetOrId) : presetOrId;
  const { shadows = true, shadowRadius = 300 } = opts;

  // Fog first: its colour is the horizon, so distant geometry melts into the sky.
  scene.fog = new THREE.FogExp2(preset.skyHorizon, preset.fogDensity);
  scene.background = new THREE.Color(preset.skyHorizon);

  let sky = scene.getObjectByName('sky-dome');
  if (!sky) {
    sky = createSkyDome(preset);
    scene.add(sky);
  } else {
    sky.material.uniforms.topColor.value.setHex(preset.skyTop);
    sky.material.uniforms.horizonColor.value.setHex(preset.skyHorizon);
  }

  let clouds = scene.getObjectByName('cloud-layer');
  if (!clouds) {
    clouds = createClouds();
    scene.add(clouds);
  }
  // Presets don't currently vary cloud density/color — same clusters read
  // fine across moods since they're already a fairly neutral white/grey.
  // If a future preset wants stormy or absent clouds, this is the spot.

  let glow = scene.getObjectByName('sun-glow');
  if (!glow) {
    glow = createSunGlow(preset);
    scene.add(glow);
  } else {
    glow.material.uniforms.glowColor.value.setHex(preset.sunColor);
  }

  let rays = scene.getObjectByName('sun-rays');
  if (!rays) {
    rays = createSunRays(preset);
    scene.add(rays);
  } else {
    rays.material.uniforms.glowColor.value.setHex(preset.sunColor);
  }

  let hemi = scene.getObjectByName('hemi-light');
  if (!hemi) {
    hemi = new THREE.HemisphereLight();
    hemi.name = 'hemi-light';
    scene.add(hemi);
  }
  hemi.color.setHex(preset.hemiSky);
  hemi.groundColor.setHex(preset.hemiGround);
  hemi.intensity = preset.hemiIntensity;

  let sun = scene.getObjectByName('sun-light');
  if (!sun) {
    sun = new THREE.DirectionalLight();
    sun.name = 'sun-light';
    sun.castShadow = shadows;
    // Three defaults a directional light's shadow frustum to +/-5 units, which
    // covers nothing at this scale. This one is static and centred on the
    // origin; see updateSunShadow to make it follow the player instead.
    sun.shadow.mapSize.set(DEFAULT_SHADOW_MAP_SIZE, DEFAULT_SHADOW_MAP_SIZE); // per-map override lands in applyGraphicsSettingsToAtmosphere
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 900;
    // Peter-panning vs acne: a small normal bias is the cheap fix for the
    // stripe artefacts you otherwise get on low-poly slopes.
    sun.shadow.normalBias = 0.04;
    scene.add(sun);
    scene.add(sun.target);
  }
  sun.color.setHex(preset.sunColor);
  sun.intensity = preset.sunIntensity;
  const [dx, dy, dz] = preset.sunDir;
  const len = Math.hypot(dx, dy, dz) || 1;
  sun.position.set((dx / len) * 400, (dy / len) * 400, (dz / len) * 400);

  const cam = sun.shadow.camera;
  cam.left = -shadowRadius; cam.right = shadowRadius;
  cam.top = shadowRadius; cam.bottom = -shadowRadius;
  cam.updateProjectionMatrix();

  return { preset, sun, sky };
}

/**
 * Re-tunes the sun light, hemisphere ambient light, and fog from a map's own
 * graphicsSettings (src/sim/graphicsSettings.js) — layered on top of whatever
 * applyAtmosphere(preset) already set up at scene creation. The sky dome's
 * zenith color, clouds, and sun-glow sprite stay preset-driven (Dennis's
 * settings list has no sky-color control, only light/ambient/fog); the
 * horizon strip still follows fog color so distant geometry keeps dissolving
 * into the sky instead of leaving a hard band (same reasoning as
 * applyAtmosphere's own fog-matches-horizon design, see this file's header).
 * Idempotent — safe to call every time a map's settings are (re)applied,
 * including live per-keystroke edits from the World Editor's settings modal.
 * @param {THREE.Scene} scene
 * @param {object} graphicsSettings shape matches defaultGraphicsSettings()
 */
export function applyGraphicsSettingsToAtmosphere(scene, graphicsSettings) {
  const { light, ambient, fog, environmental } = graphicsSettings;

  scene.fog = new THREE.FogExp2(fog.color, fog.density);
  scene.background = new THREE.Color(fog.color);
  const sky = scene.getObjectByName('sky-dome');
  if (sky) sky.material.uniforms.horizonColor.value.setHex(fog.color);

  const hemi = scene.getObjectByName('hemi-light');
  if (hemi) {
    hemi.color.setHex(ambient.skyColor);
    hemi.groundColor.setHex(ambient.groundColor);
    hemi.intensity = ambient.intensity;
  }

  const sun = scene.getObjectByName('sun-light');
  if (sun) {
    sun.color.setHex(light.color);
    sun.intensity = light.intensity;
    // Direction is set relative to sun.target's CURRENT position (which
    // updateAtmosphere recenters on the player every frame), not the world
    // origin — setting an absolute position here would silently undo that
    // recentering the next time this runs after gameplay has moved the target.
    const elevRad = THREE.MathUtils.degToRad(light.shadowElevationDeg);
    const azRad = THREE.MathUtils.degToRad(light.shadowAzimuthDeg);
    const dir = new THREE.Vector3(
      Math.cos(elevRad) * Math.cos(azRad),
      Math.sin(elevRad),
      Math.cos(elevRad) * Math.sin(azRad)
    );
    sun.position.copy(sun.target.position).add(dir.multiplyScalar(400));
    // A POSITIVE shadow.bias pushes the comparison toward the light and makes
    // acne worse, which is the opposite of what it's usually reached for.
    // Clamp it to <= 0 so an authored positive value can't fight normalBias.
    sun.shadow.bias = Math.min(0, light.shadowBias ?? 0);
    // Floor the normal bias at what this range/resolution actually needs. The
    // authored value wins whenever it is already large enough; it can only be
    // raised, never lowered, so widening Shadow Range in the editor can't
    // silently bring the acne back.
    sun.shadow.normalBias = Math.max(
      light.shadowNormalBias ?? 0,
      recommendedShadowNormalBias(light)
    );
    // Resizing the map has to drop the already-allocated render target, or
    // three keeps rendering into the old one at the old resolution and the
    // setting silently does nothing. Guarded so an unchanged value doesn't
    // throw away a live target every time this runs (it also fires on every
    // slider drag in the editor's graphics modal).
    const mapSize = light.shadowMapSize || DEFAULT_SHADOW_MAP_SIZE;
    if (sun.shadow.mapSize.width !== mapSize) {
      sun.shadow.mapSize.set(mapSize, mapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    const cam = sun.shadow.camera;
    cam.left = -light.shadowRange; cam.right = light.shadowRange;
    cam.top = light.shadowRange; cam.bottom = -light.shadowRange;
    cam.updateProjectionMatrix();
  }

  const rays = scene.getObjectByName('sun-rays');
  if (rays) {
    rays.material.uniforms.intensity.value = environmental.type === 'sunrays' ? environmental.intensity : 0;
    rays.material.uniforms.glowColor.value.setHex(light.color); // tied to the tunable sun color, not the fixed preset sunColor the base glow sprite keeps
  }
}

/**
 * Unit vector from the ground toward the sun. This is `sun.position -
 * sun.target.position`, NOT `sun.position` normalized: the target is recentred
 * on the player every frame (see snapShadowFocusToTexelGrid) and the position
 * is set relative to it, so normalizing the absolute position gives the
 * direction from the WORLD ORIGIN to the sun. That's only the real sun
 * direction while the player happens to be standing at 0,0 — walk a few hundred
 * metres out and it tilts toward the horizon and eventually underground,
 * dragging the sun glow/rays sprites with it.
 * @param {THREE.DirectionalLight} sun
 * @returns {THREE.Vector3} a fresh vector, safe to mutate.
 */
export function sunDirection(sun) {
  return sun.position.clone().sub(sun.target.position).normalize();
}

/**
 * Keep the sky centred on the camera (so you can never walk out of it) and the
 * sun's shadow frustum centred on the player (so shadows exist away from the
 * origin). Call once per frame with the camera and the player's position.
 */
export function updateAtmosphere(scene, cameraPosition, focusPosition = cameraPosition, elapsed = 0) {
  const sky = scene.getObjectByName('sky-dome');
  if (sky) sky.position.copy(cameraPosition);

  const clouds = scene.getObjectByName('cloud-layer');
  if (clouds) {
    clouds.position.copy(cameraPosition); // same reasoning as the sky dome — never walk out from under them
    clouds.rotation.y = elapsed * 0.004; // slow drift across the sky; not "wind speed", just enough to read as alive
  }

  const sun = scene.getObjectByName('sun-light');
  const glow = scene.getObjectByName('sun-glow');
  if (sun && glow) {
    // Same direction as the sun light, projected out to a fixed display
    // distance from the camera (inside the cloud layer/sky dome) and always
    // facing the camera — a flat quad instead of a real billboard/sprite so
    // it can use a custom radial-falloff shader (see createSunGlow).
    const dir = sunDirection(sun);
    glow.position.copy(cameraPosition).add(dir.multiplyScalar(700));
    glow.lookAt(cameraPosition);
    const dist = glow.position.distanceTo(cameraPosition);
    glow.scale.setScalar(dist * 0.32); // scales with distance so it holds a consistent apparent size
  }

  const rays = scene.getObjectByName('sun-rays');
  if (sun && rays) {
    const dir = sunDirection(sun);
    rays.position.copy(cameraPosition).add(dir.multiplyScalar(699)); // just in front of the glow sprite, same anchor logic
    rays.lookAt(cameraPosition);
    const dist = rays.position.distanceTo(cameraPosition);
    rays.scale.setScalar(dist * 0.6); // larger than the base glow — rays reach further out
    rays.rotation.z = elapsed * 0.05; // slow spin so the spokes read as light, not a static sticker
  }

  if (!sun) return;
  snapShadowFocusToTexelGrid(sun, focusPosition);
}

// Scratch objects — updateAtmosphere runs every frame, and this used to
// allocate four Vector3s and a Matrix4 per call.
const _shadowBasis = new THREE.Matrix4();
const _shadowBasisInv = new THREE.Matrix4();
const _shadowDir = new THREE.Vector3();
const _shadowFocus = new THREE.Vector3();
const _shadowOffset = new THREE.Vector3();
const _shadowOrigin = new THREE.Vector3();
const _shadowUp = new THREE.Vector3(0, 1, 0); // three's Object3D default up, which is what the shadow camera's lookAt uses

/**
 * Move the sun's shadow frustum onto the player WITHOUT letting the shadow
 * map re-rasterize: quantize the focus to the map's own texel grid, so a
 * walking player slides the frustum in whole-texel jumps and every shadow
 * edge keeps landing on the same texels it did last frame. Un-snapped, a
 * sub-texel translation redraws every edge each frame, which reads as
 * shadows crawling, flickering, or "regenerating in a different pattern."
 *
 * The snap has to happen in the shadow camera's OWN basis. Two earlier
 * versions got this wrong in the same way — first by snapping world X/Z (the
 * sun isn't overhead, so its grid is rotated relative to world axes), then by
 * rotating into the light's horizontal AZIMUTH frame, which fixes the
 * camera's right axis but not its up axis: the camera is also tilted by the
 * sun's elevation, so a world-space step of one texel ALONG the azimuth maps
 * to sin(elevation) texels vertically — 0.82 of a texel at the default 55°.
 * That leaves 0.18 of a texel of slip per snap, so the vertical grid drifts
 * and re-lands constantly while walking. It's especially loud on grass, where
 * each blade takes ONE shadow sample for its whole body (see grassCover.js's
 * uShadowSampleY) and so flips fully lit/unlit as the grid moves under it.
 *
 * Deriving the basis from the light direction instead of from angles covers
 * both axes at once and can't drift out of sync with however the direction
 * was set. It must match what three.js does in DirectionalLightShadow: look
 * from the light at its target, with the default (0,1,0) up.
 */
function snapShadowFocusToTexelGrid(sun, focusPosition) {
  const cam = sun.shadow.camera;
  const texelX = (cam.right - cam.left) / sun.shadow.mapSize.width;
  const texelY = (cam.top - cam.bottom) / sun.shadow.mapSize.height;
  if (!texelX || !texelY) return;

  _shadowOffset.subVectors(sun.position, sun.target.position); // light's fixed offset from whatever it looks at
  _shadowDir.copy(_shadowOffset).normalize();
  if (!_shadowDir.lengthSq()) return;

  // Rotation-only basis: columns are the shadow camera's right/up/back axes.
  // Built at the origin because only the ROTATION matters here — the
  // translation is exactly what we're solving for.
  _shadowOrigin.set(0, 0, 0);
  _shadowBasis.lookAt(_shadowDir, _shadowOrigin, _shadowUp);
  _shadowBasisInv.copy(_shadowBasis).transpose(); // pure rotation, so transpose === inverse

  // Into shadow-camera axes, quantize the two that map to texels (depth is
  // free to slide — it doesn't change which texel anything rasterizes into),
  // and back out to world space.
  _shadowFocus.set(focusPosition.x, 0, focusPosition.z).applyMatrix4(_shadowBasisInv);
  _shadowFocus.x = Math.round(_shadowFocus.x / texelX) * texelX;
  _shadowFocus.y = Math.round(_shadowFocus.y / texelY) * texelY;
  _shadowFocus.applyMatrix4(_shadowBasis);

  sun.target.position.copy(_shadowFocus);
  sun.position.addVectors(sun.target.position, _shadowOffset);
  sun.target.updateMatrixWorld();
}
