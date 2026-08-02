// src/sim/graphicsSettings.js
// Per-map graphics profile — every map (overworld/building/dungeon) carries
// its own copy on world.graphicsSettings, editable from the World Editor's
// gear-icon settings modal. See the "Per-Map Graphics Settings" plan for the
// full feasibility rundown (what's implemented vs. skipped as not
// technically possible with this project's toon-shading pipeline and single-
// shadow-map lighting model — no subsurface scattering, no cascaded shadow
// maps, no spot/point light shadow limits, no fog start-distance, no true
// motion blur).

export const ENVIRONMENTAL_TYPES = [null, 'rain', 'snow', 'dust', 'wind', 'sunrays'];

/**
 * The third-person orbit camera the live game hands the player on this map:
 * where it starts (distance behind the character + pitch above them) and how
 * far in/out they may zoom from there.
 *
 * These numbers reproduce what src/main.js used to hardcode — the initial
 * camera.position/target pair worked out to ~24 units at ~33 degrees, with the
 * OrbitControls zoom clamped to 6..60 — so a map saved before this field
 * existed plays exactly as it did. A cramped dungeon corridor and a
 * 1000-wide overworld want very different framing, which is the whole point of
 * making it per-map.
 */
export const PLAYER_CAMERA_DEFAULTS = { distance: 24, pitchDeg: 33, minDistance: 6, maxDistance: 60 };

/**
 * A map's player-camera block with every field filled in — use this instead of
 * reading `settings.playerCamera` directly, since the field is absent on every
 * map saved before it existed.
 * @param {object} [settings] a graphicsSettings
 */
export function playerCameraOf(settings) {
  return { ...PLAYER_CAMERA_DEFAULTS, ...(settings?.playerCamera || {}) };
}
export const ANISOTROPY_LEVELS = [1, 2, 4, 8, 16];
export const SHADOW_MAP_SIZES = [1024, 2048, 4096, 8192];

/** Was hardcoded in atmosphere.js before `light.shadowMapSize` existed; also the fallback for maps saved without the field. */
export const DEFAULT_SHADOW_MAP_SIZE = 2048;

/**
 * How much world one shadow-map pixel covers, in metres — the single number
 * that decides whether a shadow reads as a shape or as a blob, and the one
 * the Shadow Range and Shadow Resolution controls actually trade against
 * each other. A character is roughly 1m wide, so anything above ~0.1 means
 * their shadow is only a handful of pixels across and visibly re-rasterizes
 * as they walk (static scenery doesn't, because the frustum is snapped to
 * this same grid — see atmosphere.js's snapShadowFocusToTexelGrid).
 * @param {object} light a graphicsSettings.light
 */
export function shadowTexelSize(light) {
  const size = light?.shadowMapSize || DEFAULT_SHADOW_MAP_SIZE;
  return (2 * (light?.shadowRange ?? 300)) / size;
}

/**
 * The smallest `shadowNormalBias` that will not produce shadow acne for a
 * given range/resolution.
 *
 * Normal bias offsets the shadow lookup ALONG THE SURFACE NORMAL, so it has to
 * clear roughly one shadow texel's worth of world space — otherwise a surface
 * lit at a grazing angle samples its own depth and self-shadows in the
 * staircase/herringbone pattern that was crawling over every wall in the city.
 * 1.5x texel is the usual safe multiplier.
 *
 * This is derived rather than hand-tuned on purpose: `shadowRange` and
 * `shadowMapSize` are both editor sliders, and any hand-typed bias silently
 * becomes wrong the moment either moves. Applying it as a FLOOR (see
 * atmosphere.js) means raising the range can never re-introduce the acne.
 */
export function recommendedShadowNormalBias(light) {
  return +(shadowTexelSize(light) * 1.5).toFixed(3);
}

/** @returns {object} a fresh, independently-mutable default settings object (never share one instance across maps). */
export function defaultGraphicsSettings() {
  return {
    postFx: {
      fxaa: { enabled: true },
      ssao: { enabled: false, intensity: 1.0 },
      sharpen: { enabled: false, strength: 0.3 },
      bloom: { enabled: true, strength: 0.35, radius: 0.4, threshold: 0.85 },
      dof: { enabled: false, focus: 30, aperture: 0.00003, maxBlur: 0.01 },
      cloudShadows: { enabled: false, strength: 0.3, speed: 0.02 },
    },
    exposure: 1.0,
    saturation: 0, // -1..1
    colorfulness: 0, // 0..1 — vibrance-style boost, weighted toward already-low-saturation pixels
    light: {
      color: 0xfff0c8,
      intensity: 1.75,
      shadowElevationDeg: 55, // "Shadow Angle" — replaces the raw sunDir vector with two friendly angles
      shadowAzimuthDeg: 40,
      shadowRange: 300, // ortho frustum half-extent ("Shadow Range")
      shadowMapSize: DEFAULT_SHADOW_MAP_SIZE, // "Shadow Resolution" — with shadowRange, sets shadowTexelSize()
      shadowBias: 0,
      shadowNormalBias: 0.04,
    },
    ambient: { skyColor: 0xbfe8ff, groundColor: 0x5f7a3a, intensity: 0.85 },
    fog: { density: 0.0026, color: 0xf0e6b8 },
    sound: { defaultMusicId: null, defaultAmbientSoundId: null }, // plays outside every zone
    environmental: { type: null, intensity: 1.0 },
    playerCamera: { ...PLAYER_CAMERA_DEFAULTS },
    anisotropy: 4,
  };
}

/**
 * @param {any} settings
 * @returns {void} throws on malformed data.
 */
export function validateGraphicsSettings(settings) {
  if (!settings || typeof settings !== 'object') {
    throw new Error('World graphicsSettings must be an object');
  }
  const { postFx, light, ambient, fog, sound, environmental } = settings;

  if (!postFx || typeof postFx !== 'object') throw new Error('graphicsSettings.postFx must be an object');
  for (const key of ['fxaa', 'ssao', 'sharpen', 'bloom', 'dof', 'cloudShadows']) {
    if (!postFx[key] || typeof postFx[key].enabled !== 'boolean') {
      throw new Error(`graphicsSettings.postFx.${key}.enabled must be a boolean`);
    }
  }

  if (typeof settings.exposure !== 'number') throw new Error('graphicsSettings.exposure must be a number');
  if (typeof settings.saturation !== 'number') throw new Error('graphicsSettings.saturation must be a number');
  if (typeof settings.colorfulness !== 'number') throw new Error('graphicsSettings.colorfulness must be a number');

  if (!light || typeof light !== 'object') throw new Error('graphicsSettings.light must be an object');
  for (const key of ['color', 'intensity', 'shadowElevationDeg', 'shadowAzimuthDeg', 'shadowRange', 'shadowBias', 'shadowNormalBias']) {
    if (typeof light[key] !== 'number') throw new Error(`graphicsSettings.light.${key} must be a number`);
  }
  // Optional on purpose: every map saved before this field existed lacks it,
  // and requiring it would reject real world files on load. Absent means
  // DEFAULT_SHADOW_MAP_SIZE, which is exactly what those maps already render at.
  if (light.shadowMapSize !== undefined && !SHADOW_MAP_SIZES.includes(light.shadowMapSize)) {
    throw new Error(`graphicsSettings.light.shadowMapSize must be one of ${SHADOW_MAP_SIZES.join(', ')}`);
  }

  if (!ambient || typeof ambient !== 'object') throw new Error('graphicsSettings.ambient must be an object');
  for (const key of ['skyColor', 'groundColor', 'intensity']) {
    if (typeof ambient[key] !== 'number') throw new Error(`graphicsSettings.ambient.${key} must be a number`);
  }

  if (!fog || typeof fog !== 'object') throw new Error('graphicsSettings.fog must be an object');
  if (typeof fog.density !== 'number' || typeof fog.color !== 'number') {
    throw new Error('graphicsSettings.fog.density and .color must be numbers');
  }

  if (!sound || typeof sound !== 'object') throw new Error('graphicsSettings.sound must be an object');
  if (sound.defaultMusicId !== null && typeof sound.defaultMusicId !== 'string') {
    throw new Error('graphicsSettings.sound.defaultMusicId must be a string or null');
  }
  if (sound.defaultAmbientSoundId !== null && typeof sound.defaultAmbientSoundId !== 'string') {
    throw new Error('graphicsSettings.sound.defaultAmbientSoundId must be a string or null');
  }

  if (!environmental || typeof environmental !== 'object') throw new Error('graphicsSettings.environmental must be an object');
  if (!ENVIRONMENTAL_TYPES.includes(environmental.type)) {
    throw new Error(`graphicsSettings.environmental.type must be one of ${ENVIRONMENTAL_TYPES.join(', ')}`);
  }
  if (typeof environmental.intensity !== 'number') {
    throw new Error('graphicsSettings.environmental.intensity must be a number');
  }

  // Optional for the same reason shadowMapSize is: maps saved before the field
  // existed lack it, and absent means PLAYER_CAMERA_DEFAULTS — which is exactly
  // what those maps already play at.
  if (settings.playerCamera !== undefined) {
    const cam = settings.playerCamera;
    if (!cam || typeof cam !== 'object') throw new Error('graphicsSettings.playerCamera must be an object');
    for (const key of ['distance', 'pitchDeg', 'minDistance', 'maxDistance']) {
      if (typeof cam[key] !== 'number' || !Number.isFinite(cam[key])) {
        throw new Error(`graphicsSettings.playerCamera.${key} must be a number`);
      }
    }
    if (cam.minDistance <= 0) throw new Error('graphicsSettings.playerCamera.minDistance must be greater than 0');
    if (cam.maxDistance < cam.minDistance) {
      throw new Error('graphicsSettings.playerCamera.maxDistance must be >= minDistance');
    }
    // Beyond 89 the orbit camera is straight overhead and OrbitControls' own
    // polar clamp takes over anyway; at 0 it is inside the ground.
    if (cam.pitchDeg <= 0 || cam.pitchDeg > 89) {
      throw new Error('graphicsSettings.playerCamera.pitchDeg must be between 0 (exclusive) and 89');
    }
  }

  if (!ANISOTROPY_LEVELS.includes(settings.anisotropy)) {
    throw new Error(`graphicsSettings.anisotropy must be one of ${ANISOTROPY_LEVELS.join(', ')}`);
  }
}
