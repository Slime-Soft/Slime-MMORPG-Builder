// src/render/vfx/worldEffects.js
// The catalog of AMBIENT effects that can be dropped straight into the world
// from the World Editor's Particles mode (see src/sim/particleEmitters.js for
// the authored data, src/render/worldParticles.js for the runtime that
// streams them in and out around the camera).
//
// How this differs from presets.js's skill VFX:
// - Every one of these LOOPS. A placed campfire is still burning when you
//   walk back an hour later; a skill VFX is a one-shot event tied to a cast.
// - Every one is authored: an emitter carries a scale, a density and two
//   colours, so the same "Glitter" effect is gold dust over a treasure chest
//   in one spot and green spores in a swamp in another. Builders therefore
//   take those four knobs and are written to actually respond to them.
// - They resolve through the SAME spawn(id, anchor) call as everything else
//   (see index.js), so a skill can reference a world effect id and vice
//   versa; nothing about the two paths is separate at runtime.
//
// Adding one is a single entry here — it shows up in the editor's palette,
// grouped under its category, automatically.
import * as THREE from 'three';
import {
  vec4, layers, withLight, motePreset, cloudPreset, vortexPreset, firePreset,
  beamPreset, streamPreset, auraPreset, magicCirclePreset, wallPreset,
} from './presets.js';
import {
  getSoftDotTexture, getStarTexture, getSmokeTexture, getWispTexture,
  getSparkTexture, getShardTexture,
} from './textures.js';

export const WORLD_EFFECT_CATEGORIES = ['Fire', 'Magic', 'Nature', 'Weather', 'Water', 'Smoke & Dust', 'Light'];

/** Authored knobs shared by every world effect — the four fields the editor's emitter panel edits. */
const DEFAULT_OPTS = { scale: 1, intensity: 1, colorA: null, colorB: null };

/**
 * @param {string} id
 * @param {string} label shown in the editor palette
 * @param {typeof WORLD_EFFECT_CATEGORIES[number]} category
 * @param {{colorA: string, colorB: string, light?: {color?: number, intensity?: number, distance?: number, offsetY?: number}}} defaults
 * @param {(o: {scale:number, intensity:number, colorA:THREE.Vector4, colorB:THREE.Vector4, light:object|null}) => any} build
 */
function fx(id, label, category, defaults, build) {
  return {
    id,
    label,
    category,
    defaultColorA: defaults.colorA,
    defaultColorB: defaults.colorB,
    /** @param {{scale?:number,intensity?:number,colorA?:string,colorB?:string,light?:boolean}} opts */
    build(opts = {}) {
      const o = { ...DEFAULT_OPTS, ...opts };
      const scale = Math.max(0.05, o.scale || 1);
      const intensity = Math.max(0.05, o.intensity || 1);
      const built = build({
        scale,
        intensity,
        colorA: vec4(o.colorA || defaults.colorA),
        colorB: vec4(o.colorB || defaults.colorB),
      });
      // A placed effect's light scales with the emitter, so a bonfire twice
      // the size lights twice as far — otherwise every fire in the world
      // casts an identically-sized pool of light regardless of how big it is.
      if (defaults.light && opts.light !== false) {
        return withLight(built, {
          persistent: true,
          color: defaults.light.color ?? new THREE.Color(defaults.colorA).getHex(),
          intensity: (defaults.light.intensity ?? 3) * intensity,
          distance: (defaults.light.distance ?? 8) * scale,
          offsetY: (defaults.light.offsetY ?? 0.5) * scale,
        });
      }
      return built;
    },
  };
}

const DEFS = [
  // --- Fire -----------------------------------------------------------------
  fx('campfire', 'Campfire', 'Fire', { colorA: '#ffd27a', colorB: '#ff3b00', light: { intensity: 4, distance: 9, offsetY: 0.8 } },
    ({ scale, intensity, colorA, colorB }) => firePreset({
      colorA, colorB, radius: 0.18 * scale, height: 1.5 * scale, size: 0.48 * scale, count: Math.round(90 * intensity),
    })),
  fx('bonfire', 'Bonfire', 'Fire', { colorA: '#ffdc96', colorB: '#ff2e00', light: { intensity: 7, distance: 16, offsetY: 1.4 } },
    ({ scale, intensity, colorA, colorB }) => firePreset({
      colorA, colorB, radius: 0.45 * scale, height: 3.2 * scale, size: 0.9 * scale, count: Math.round(120 * intensity), life: 0.95,
    })),
  fx('torch-flame', 'Torch Flame', 'Fire', { colorA: '#ffdc9a', colorB: '#ff6a12', light: { intensity: 2.6, distance: 7, offsetY: 0.35 } },
    ({ scale, intensity, colorA, colorB }) => firePreset({
      colorA, colorB, radius: 0.07 * scale, height: 0.75 * scale, size: 0.22 * scale, count: Math.round(45 * intensity),
      smoke: false, life: 0.42,
    })),
  fx('fire-pit', 'Fire Wall / Trench', 'Fire', { colorA: '#ffcc55', colorB: '#ff3300', light: { intensity: 5, distance: 12, offsetY: 0.7 } },
    ({ scale, intensity, colorA, colorB }) => wallPreset({
      colorA, colorB, width: 3 * scale, riseY: 2 * scale, count: Math.round(28 * intensity), segments: 6,
    })),
  fx('embers', 'Rising Embers', 'Fire', { colorA: '#ffcf7a', colorB: '#ff4400' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ boost: 3.2,
      colorA, colorB, radius: 0.7 * scale, count: Math.round(10 * intensity), riseY: 1.6 * scale,
      size: 0.253 * scale, life: 2.4, turbulence: 0.7, texture: getSoftDotTexture(),
    })),
  fx('lava-vent', 'Lava Vent', 'Fire', { colorA: '#ffb347', colorB: '#8c1b00', light: { color: 0xff5511, intensity: 3.5, distance: 10 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      streamPreset({ colorA, colorB, count: Math.round(14 * intensity), speed: 3.5 * scale, angle: 0.35, life: 0.9, size: 0.3 * scale, turbulence: 0.4 }),
      cloudPreset({ colorA: vec4('#3a2a22'), colorB: vec4('#141010'), radius: 0.5 * scale, count: Math.round(5 * intensity), riseY: 1.2 * scale, size: 1 * scale, opacity: 0.3 }),
    )),

  // --- Magic ----------------------------------------------------------------
  fx('glitter', 'Glitter', 'Magic', { colorA: '#fff3c4', colorB: '#ffcc4d' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ boost: 4.0,
      colorA, colorB, radius: 1.1 * scale, count: Math.round(14 * intensity), riseY: 0.35 * scale,
      size: 0.322 * scale, life: 2.4, turbulence: 0.3, texture: getStarTexture(),
    })),
  fx('magic-glow', 'Magic Glow', 'Magic', { colorA: '#cbb3ff', colorB: '#7a3cff', light: { intensity: 2.5, distance: 8 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      auraPreset({ boost: 3.0, colorA, colorB, radius: 0.5 * scale, count: Math.round(14 * intensity), size: 0.69 * scale, riseY: 0.2, orbitSpeed: 0.8 }),
      motePreset({ boost: 3.0, colorA, colorB, radius: 0.8 * scale, count: Math.round(8 * intensity), riseY: 0.5 * scale, size: 0.276 * scale }),
    )),
  fx('rune-circle', 'Rune Circle', 'Magic', { colorA: '#9fd8ff', colorB: '#3f7fd8', light: { intensity: 1.6, distance: 7, offsetY: 0.2 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      // A magic circle is a one-shot sprite by nature (it grows in and fades
      // out), so the placed version re-lights itself: a slow looping mote
      // field underneath keeps the spot alive between pulses.
      magicCirclePreset({ colorA, colorB, radius: 1.6 * scale, life: 3.2, spin: 0.5 }),
      motePreset({ colorA, colorB, radius: 1.5 * scale, count: Math.round(8 * intensity), riseY: 0.6 * scale, size: 0.276 * scale, life: 2.6 }),
    )),
  fx('portal-swirl', 'Portal Swirl', 'Magic', { colorA: '#c9a3ff', colorB: '#2a0a4a', light: { color: 0xa070ff, intensity: 3, distance: 10, offsetY: 1 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      vortexPreset({ colorA, colorB, radius: 0.9 * scale, height: 2 * scale, count: Math.round(26 * intensity), orbitSpeed: 9, life: 1.1, size: 0.5 * scale }),
      beamPreset({ colorA, colorB, height: 2.4 * scale, width: 1.2 * scale, count: Math.round(4 * intensity) }),
      motePreset({ colorA, colorB, radius: 1.2 * scale, count: Math.round(10 * intensity), riseY: 0.9 * scale, size: 0.322 * scale }),
    )),
  fx('will-o-wisp', "Will-o'-Wisp", 'Magic', { colorA: '#b6ffe4', colorB: '#2ba98a', light: { color: 0x66ffcc, intensity: 2, distance: 7, offsetY: 1 } },
    ({ scale, intensity, colorA, colorB }) => motePreset({ boost: 3.5,
      colorA, colorB, radius: 1.4 * scale, count: Math.round(4 * intensity), riseY: 0.1,
      size: 0.92 * scale, life: 3.4, turbulence: 0.55, texture: getSoftDotTexture(), spin: 0.4,
    })),
  fx('mana-font', 'Mana Font', 'Magic', { colorA: '#bfe4ff', colorB: '#3f6fd8' },
    ({ scale, intensity, colorA, colorB }) => layers(
      streamPreset({ colorA, colorB, count: Math.round(24 * intensity), speed: 3.2 * scale, angle: 0.25, life: 0.8, size: 0.16 * scale }),
      motePreset({ colorA, colorB, radius: 0.9 * scale, count: Math.round(8 * intensity), riseY: -0.5 * scale, size: 0.23 * scale, life: 2 }),
    )),
  fx('cursed-aura', 'Cursed Aura', 'Magic', { colorA: '#8f5fbf', colorB: '#1a0033' },
    ({ scale, intensity, colorA, colorB }) => layers(
      cloudPreset({ colorA, colorB, radius: 1 * scale, count: Math.round(8 * intensity), riseY: 0.5 * scale, size: 0.9 * scale, opacity: 0.35 }),
      motePreset({ colorA, colorB, radius: 1.2 * scale, count: Math.round(10 * intensity), riseY: 0.7 * scale, size: 0.276 * scale, turbulence: 0.8, texture: getSoftDotTexture() }),
    )),

  // --- Nature ---------------------------------------------------------------
  fx('fireflies', 'Fireflies', 'Nature', { colorA: '#eaff9a', colorB: '#8fbf2f' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ boost: 4.0,
      colorA, colorB, radius: 3 * scale, count: Math.round(10 * intensity), riseY: 0.05,
      size: 0.299 * scale, life: 3.2, turbulence: 0.5, texture: getSoftDotTexture(),
    })),
  fx('pollen', 'Pollen / Spores', 'Nature', { colorA: '#fff6d0', colorB: '#d8c98a' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.75, 
      colorA, colorB, radius: 2.4 * scale, count: Math.round(16 * intensity), riseY: 0.12,
      size: 0.207 * scale, life: 4, turbulence: 0.25, texture: getSoftDotTexture(),
    })),
  fx('falling-leaves', 'Falling Leaves', 'Nature', { colorA: '#e2b45a', colorB: '#7a4a1e' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.95, 
      colorA, colorB, radius: 2.6 * scale, count: Math.round(9 * intensity), riseY: -0.5,
      size: 0.506 * scale, life: 3.4, turbulence: 0.7, texture: getShardTexture(), spin: 2.5,
    })),
  fx('petals', 'Blossom Petals', 'Nature', { colorA: '#ffd7e6', colorB: '#e88fb5' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.95, 
      colorA, colorB, radius: 2.4 * scale, count: Math.round(10 * intensity), riseY: -0.4,
      size: 0.368 * scale, life: 3.6, turbulence: 0.8, texture: getShardTexture(), spin: 2,
    })),
  fx('swamp-bubbles', 'Swamp Gas', 'Nature', { colorA: '#a8d94f', colorB: '#2e3d1a' },
    ({ scale, intensity, colorA, colorB }) => layers(
      cloudPreset({ colorA, colorB, radius: 1.2 * scale, count: Math.round(7 * intensity), riseY: 0.35 * scale, size: 0.9 * scale, opacity: 0.35 }),
      motePreset({ colorA, colorB, radius: 1 * scale, count: Math.round(6 * intensity), riseY: 0.8 * scale, size: 0.322 * scale, texture: getSoftDotTexture() }),
    )),

  // --- Weather --------------------------------------------------------------
  fx('tornado', 'Tornado', 'Weather', { colorA: '#e6e6d8', colorB: '#8c8470' },
    ({ scale, intensity, colorA, colorB }) => layers(
      vortexPreset({ colorA, colorB, radius: 1.6 * scale, height: 6 * scale, count: Math.round(38 * intensity), orbitSpeed: 7, life: 1.8, size: 1.1 * scale, additive: false, opacity: 0.45, texture: getSmokeTexture() }),
      vortexPreset({ colorA, colorB, radius: 2.6 * scale, height: 3.5 * scale, count: Math.round(22 * intensity), orbitSpeed: 5, life: 2.2, size: 1.6 * scale, additive: false, opacity: 0.28, texture: getSmokeTexture() }),
      vortexPreset({ colorA, colorB, radius: 0.7 * scale, height: 8 * scale, count: Math.round(16 * intensity), orbitSpeed: 11, life: 1.2, size: 0.5 * scale, additive: false, opacity: 0.5, texture: getWispTexture() }),
    )),
  fx('dust-devil', 'Dust Devil', 'Weather', { colorA: '#d8c9a6', colorB: '#8a7550' },
    ({ scale, intensity, colorA, colorB }) => vortexPreset({
      colorA, colorB, radius: 0.8 * scale, height: 2.5 * scale, count: Math.round(20 * intensity),
      orbitSpeed: 8, life: 1.2, size: 0.7 * scale, additive: false, opacity: 0.35, texture: getSmokeTexture(),
    })),
  fx('snow-flurry', 'Snow Flurry', 'Weather', { colorA: '#ffffff', colorB: '#cfe6ff' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.9, 
      colorA, colorB, radius: 3 * scale, count: Math.round(22 * intensity), riseY: -1.2,
      size: 0.23 * scale, life: 3, turbulence: 0.5, texture: getSoftDotTexture(),
    })),
  fx('wind-gust', 'Wind Gust', 'Weather', { colorA: '#eef6ee', colorB: '#a8c8a8' },
    ({ scale, intensity, colorA, colorB }) => streamPreset({
      colorA, colorB, count: Math.round(14 * intensity), speed: 6 * scale, angle: 0.12, life: 1.1,
      size: 0.22 * scale, texture: getWispTexture(), boost: 1.2, turbulence: 0.5,
    })),

  // --- Water ----------------------------------------------------------------
  fx('waterfall-mist', 'Waterfall Mist', 'Water', { colorA: '#eaf6ff', colorB: '#9dc4e0' },
    ({ scale, intensity, colorA, colorB }) => layers(
      cloudPreset({ colorA, colorB, radius: 1.4 * scale, count: Math.round(12 * intensity), riseY: 0.9 * scale, size: 1.4 * scale, opacity: 0.3, life: 2 }),
      motePreset({ colorA, colorB, radius: 1.2 * scale, count: Math.round(10 * intensity), riseY: 0.6 * scale, size: 0.184 * scale, texture: getSoftDotTexture(), turbulence: 0.6 }),
    )),
  fx('fountain-spray', 'Fountain Spray', 'Water', { colorA: '#ffffff', colorB: '#7fc4e8' },
    ({ scale, intensity, colorA, colorB }) => streamPreset({
      colorA, colorB, count: Math.round(30 * intensity), speed: 4.5 * scale, angle: 0.3, life: 0.7,
      size: 0.12 * scale, boost: 1.6,
    })),
  fx('steam-vent', 'Steam Vent', 'Water', { colorA: '#f2f2f2', colorB: '#b8c4c8' },
    ({ scale, intensity, colorA, colorB }) => cloudPreset({
      colorA, colorB, radius: 0.35 * scale, count: Math.round(9 * intensity), riseY: 2.2 * scale,
      size: 0.8 * scale, opacity: 0.35, life: 1.8, turbulence: 0.8,
    })),
  fx('bubbles', 'Bubbles', 'Water', { colorA: '#e8fbff', colorB: '#7fd8f0' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.7, 
      colorA, colorB, radius: 0.8 * scale, count: Math.round(8 * intensity), riseY: 1.1 * scale,
      size: 0.276 * scale, life: 2.2, turbulence: 0.2, texture: getSoftDotTexture(), boost: 1.4,
    })),

  // --- Smoke & Dust ---------------------------------------------------------
  fx('chimney-smoke', 'Chimney Smoke', 'Smoke & Dust', { colorA: '#8a8a8a', colorB: '#2a2a2a' },
    ({ scale, intensity, colorA, colorB }) => cloudPreset({
      colorA, colorB, radius: 0.3 * scale, count: Math.round(7 * intensity), riseY: 1.6 * scale,
      size: 0.9 * scale, opacity: 0.4, life: 3, turbulence: 0.5,
    })),
  fx('smoke-plume', 'Smoke Plume', 'Smoke & Dust', { colorA: '#6e6e6e', colorB: '#161616' },
    ({ scale, intensity, colorA, colorB }) => cloudPreset({
      colorA, colorB, radius: 0.8 * scale, count: Math.round(14 * intensity), riseY: 2.4 * scale,
      size: 1.6 * scale, opacity: 0.5, life: 3.2, turbulence: 0.7,
    })),
  fx('dust-motes', 'Dust Motes', 'Smoke & Dust', { colorA: '#f0e6cc', colorB: '#b8a888' },
    ({ scale, intensity, colorA, colorB }) => motePreset({ additive: false, peak: 0.6, 
      colorA, colorB, radius: 2 * scale, count: Math.round(18 * intensity), riseY: 0.08,
      size: 0.161 * scale, life: 4.5, turbulence: 0.2, texture: getSoftDotTexture(), boost: 1.4,
    })),
  fx('poison-vent', 'Poison Vent', 'Smoke & Dust', { colorA: '#9dff5c', colorB: '#2f6e1f', light: { color: 0x6fbf3f, intensity: 1.4, distance: 7 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      cloudPreset({ colorA, colorB, radius: 0.6 * scale, count: Math.round(10 * intensity), riseY: 1.2 * scale, size: 1 * scale, opacity: 0.4, turbulence: 0.7 }),
      motePreset({ colorA, colorB, radius: 0.8 * scale, count: Math.round(8 * intensity), riseY: 1 * scale, size: 0.23 * scale, texture: getSoftDotTexture() }),
    )),

  // --- Light ----------------------------------------------------------------
  fx('light-shaft', 'Light Shaft', 'Light', { colorA: '#fff6d9', colorB: '#ffd98a', light: { intensity: 2, distance: 9, offsetY: 1.5 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      beamPreset({ colorA, colorB, height: 6 * scale, width: 1.6 * scale, count: Math.round(5 * intensity), riseY: 0.4 }),
      motePreset({ colorA, colorB, radius: 0.8 * scale, count: Math.round(8 * intensity), riseY: 0.35 * scale, size: 0.23 * scale, life: 3.5, texture: getSoftDotTexture() }),
    )),
  fx('holy-pillar', 'Holy Pillar', 'Light', { colorA: '#fff9e0', colorB: '#ffcf4d', light: { intensity: 4, distance: 12, offsetY: 1.5 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      beamPreset({ colorA, colorB, height: 5 * scale, width: 2 * scale, count: Math.round(7 * intensity), riseY: 1.5 }),
      motePreset({ colorA, colorB, radius: 1.2 * scale, count: Math.round(12 * intensity), riseY: 1.4 * scale, size: 0.345 * scale, texture: getStarTexture() }),
    )),
  fx('glow-orb', 'Glow Orb', 'Light', { colorA: '#ffe9b0', colorB: '#ff9d3c', light: { intensity: 3, distance: 8, offsetY: 0.6 } },
    ({ scale, intensity, colorA, colorB }) => auraPreset({ boost: 3.0,
      colorA, colorB, radius: 0.18 * scale, count: Math.round(12 * intensity), size: 1.15 * scale,
      riseY: 0.05, orbitSpeed: 0.6, texture: getSoftDotTexture(),
    })),
  fx('sparkle-shrine', 'Shrine Sparkle', 'Light', { colorA: '#ffffff', colorB: '#9fe8ff', light: { color: 0x9fe8ff, intensity: 2, distance: 7 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      motePreset({ boost: 3.5, colorA, colorB, radius: 0.9 * scale, count: Math.round(12 * intensity), riseY: 0.8 * scale, size: 0.368 * scale, texture: getStarTexture() }),
      auraPreset({ boost: 3.5, colorA, colorB, radius: 0.6 * scale, count: Math.round(8 * intensity), size: 0.46 * scale, texture: getSparkTexture() }),
    )),
  fx('brazier-glow', 'Brazier Glow', 'Light', { colorA: '#ffcf8a', colorB: '#ff5a12', light: { intensity: 3.5, distance: 9, offsetY: 0.5 } },
    ({ scale, intensity, colorA, colorB }) => layers(
      firePreset({ colorA, colorB, radius: 0.16 * scale, height: 0.9 * scale, size: 0.3 * scale, count: Math.round(48 * intensity), smoke: false, life: 0.5 }),
      motePreset({ colorA, colorB, radius: 0.3 * scale, count: Math.round(6 * intensity), riseY: 1.4 * scale, size: 0.207 * scale, texture: getSoftDotTexture(), life: 1.6 }),
    )),
];

/** Effect id -> def, the registry spawn() resolves against (see index.js). */
export const WORLD_EFFECTS = Object.fromEntries(DEFS.map((d) => [d.id, d]));
export const WORLD_EFFECT_IDS = DEFS.map((d) => d.id);
export const getWorldEffectDef = (id) => WORLD_EFFECTS[id] || null;

/** [{ category, effects: [def, ...] }] in WORLD_EFFECT_CATEGORIES order — what the editor palette renders. */
export function worldEffectsByCategory() {
  return WORLD_EFFECT_CATEGORIES
    .map((category) => ({ category, effects: DEFS.filter((d) => d.category === category) }))
    .filter((g) => g.effects.length > 0);
}
