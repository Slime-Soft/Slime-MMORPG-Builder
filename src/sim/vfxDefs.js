// src/sim/vfxDefs.js
// Schema + validator for author-created VFX presets (Skill Builder's "Custom
// VFX" panel). A custom VFX is deliberately NOT a generic particle-system
// graph — it's one of the 7 shape builders src/render/vfx/presets.js already
// hand-tunes every built-in preset from (burst/sparkleBurst/ring/aura/cloud/
// stream/fall), with author-picked colors and numeric parameters instead of
// code-authored ones. This gives real creative range (two colors, timing,
// size, speed, spread, gravity, per shape) without needing a full node-graph
// particle editor — every one of the ~50 existing built-in presets already
// proves these 7 shapes cover the practical range this game's spell VFX need.
//
// Zero DOM/rendering dependencies, same purity rule as every other src/sim
// file — src/render/vfx/custom.js is the render-layer half that turns a
// validated def into an actual three.quarks ParticleSystem.

export const VFX_SHAPES = [
  'burst', 'sparkleBurst', 'ring', 'aura', 'cloud', 'stream', 'fall',
  // Added 2026-07-20 alongside presets.js's 4 new generic builders (shard/
  // fallStreak/bolt/vortex/wall) and the ring+burst composite (ringBurst) —
  // same "author picks one of these shapes + numbers" contract as the
  // original 7, just covering directional/spinning/wall/lightning effects
  // those 7 structurally can't (see presets.js's shardPreset/vortexPreset/
  // wallPreset/boltPreset/ringBurstPreset doc comments for why).
  'shard', 'fallStreak', 'bolt', 'vortex', 'wall', 'ringBurst',
  // Added 2026-07-26 with the VFX overhaul (see src/render/vfx/presets.js's
  // header): the layers every built-in effect is now composed FROM, exposed
  // so an author can build the same kind of stack by hand — a flash for the
  // moment of contact, decelerating sparks, a hard-fronted shockwave,
  // normal-blended smoke, tumbling debris, a melee crescent, a ground rune,
  // drifting motes, a light column, and a looping fire.
  'flash', 'spark', 'shockwave', 'smoke', 'debris', 'slash', 'magicCircle', 'mote', 'beam', 'fire',
];
export const VFX_TEXTURES = ['dot', 'ring', 'spark', 'star', 'glow', 'smoke', 'shard', 'arrow', 'flame', 'wisp', 'debris'];

/**
 * @typedef {Object} VfxDef
 * @property {string} id
 * @property {string} name editor label, also shown in the vfx.* picker dropdowns
 * @property {'burst'|'sparkleBurst'|'ring'|'aura'|'cloud'|'stream'|'fall'|'shard'|'fallStreak'|'bolt'|'vortex'|'wall'|'ringBurst'} shape
 * @property {string} colorA hex, e.g. "#ffcc55"
 * @property {string} [colorB] hex; defaults to colorA if omitted (a solid-color effect)
 * @property {Object} params shape-specific numeric knobs — see PARAM_SPECS below for which keys apply to which shape (unknown/irrelevant keys for the chosen shape are just ignored, not an error, so switching shape in the editor doesn't require clearing params first)
 * @property {'dot'|'ring'|'spark'|'shard'|'arrow'} [params.texture] only 'burst'/'aura' (dot/ring/spark) and 'shard'/'fallStreak' (shard/arrow) honor this — the other shapes use a fixed texture matching their existing built-in presets
 */

const isObj = (v) => v && typeof v === 'object';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * Which params.* keys a given shape reads, and their valid range — mirrors
 * the exact parameters src/render/vfx/presets.js's builders already accept
 * (see that file's PRESETS table for real-world value ranges to default the
 * UI sliders to).
 *
 * Exported as VFX_PARAM_SPECS because the Skill Builder builds its parameter
 * inputs straight from this table. It used to keep its own hand-copied copy,
 * which meant a shape added here silently rendered an empty parameter panel
 * over there — one table, one place to add a shape.
 */
const PARAM_SPECS = {
  burst: { count: [1, 200], size: [0.01, 5], speed: [0, 20], life: [0.05, 5], spread: [0, Math.PI * 2], gravityY: [-20, 20], whiteHot: [0, 1] },
  sparkleBurst: { count: [1, 100], size: [0.01, 5], speed: [0, 20], life: [0.05, 5], whiteHot: [0, 1] },
  ring: { radius: [0.1, 20], life: [0.05, 5], whiteHot: [0, 1] },
  aura: { radius: [0.1, 10], count: [1, 100], whiteHot: [0, 1] },
  cloud: { radius: [0.1, 10], count: [1, 100], riseY: [-10, 10] },
  stream: { count: [1, 200], speed: [0, 20], angle: [0, Math.PI], life: [0.05, 5], whiteHot: [0, 1] },
  fall: { count: [1, 100], spreadRadius: [0.1, 20], dropSpeed: [0, 30], whiteHot: [0, 1] },
  shard: { count: [1, 100], length: [0.05, 3], width: [0.02, 1], speed: [0, 20], life: [0.05, 5], coneAngle: [0, Math.PI], gravityY: [-20, 20], whiteHot: [0, 1] },
  fallStreak: { count: [1, 100], spreadRadius: [0.1, 20], dropSpeed: [0, 30], width: [0.02, 1], length: [0.05, 3], whiteHot: [0, 1] },
  bolt: { count: [1, 10], length: [0.1, 5], width: [0.02, 2], life: [0.05, 3], flashSize: [0.1, 5] },
  vortex: { radius: [0.1, 10], height: [-10, 10], count: [1, 100], orbitSpeed: [-30, 30], life: [0.1, 5], whiteHot: [0, 1] },
  wall: { width: [0.2, 10], riseY: [-10, 10], count: [1, 100], segments: [1, 20], whiteHot: [0, 1] },
  ringBurst: { radius: [0.1, 20], life: [0.05, 5], burstCount: [1, 100], burstSize: [0.01, 5], gravityY: [-20, 20] },
  flash: { size: [0.1, 20], life: [0.05, 3], boost: [1, 8], count: [1, 10], whiteHot: [0, 1] },
  spark: { count: [1, 120], length: [0.05, 3], width: [0.01, 1], speed: [0, 40], life: [0.05, 3], gravityY: [-30, 30], whiteHot: [0, 1] },
  shockwave: { radius: [0.1, 30], life: [0.05, 5], boost: [1, 8], whiteHot: [0, 1] },
  smoke: { count: [1, 60], size: [0.05, 6], life: [0.1, 6], riseY: [-10, 10], spread: [0, 10], opacity: [0, 1], turbulence: [0, 3] },
  debris: { count: [1, 60], size: [0.02, 2], speed: [0, 25], life: [0.1, 4], gravityY: [-40, 10] },
  slash: { size: [0.2, 12], life: [0.05, 2], spin: [0, 20], count: [1, 6], whiteHot: [0, 1] },
  magicCircle: { radius: [0.1, 20], life: [0.1, 8], spin: [-10, 10] },
  mote: { radius: [0.1, 20], count: [1, 120], riseY: [-10, 10], size: [0.01, 3], life: [0.2, 10], turbulence: [0, 3], whiteHot: [0, 1] },
  beam: { height: [0.2, 30], width: [0.05, 10], count: [1, 60], life: [0.1, 5], riseY: [-10, 20], whiteHot: [0, 1] },
  fire: { radius: [0.05, 8], height: [0.2, 20], count: [1, 120], size: [0.05, 4], life: [0.1, 3], whiteHot: [0, 1] },
};

export const VFX_PARAM_SPECS = PARAM_SPECS;

/**
 * Which sprite ids each shape will actually honor as params.texture. Shapes
 * absent from this table hardcode their own sprite (a shockwave is a
 * shockwave; a magic circle is a magic circle) and ignore the key — see the
 * builders in src/render/vfx/presets.js. The Skill Builder shows a texture
 * dropdown only for the shapes listed here, so an author can't pick a sprite
 * that then silently does nothing.
 */
export const VFX_SHAPE_TEXTURES = {
  burst: ['dot', 'glow', 'spark', 'star', 'smoke', 'ring'],
  sparkleBurst: ['spark', 'star', 'dot', 'glow'],
  ring: ['ring', 'glow'],
  aura: ['star', 'dot', 'spark', 'glow'],
  cloud: ['smoke', 'dot'],
  stream: ['dot', 'glow', 'wisp', 'flame', 'spark'],
  shard: ['shard', 'arrow', 'debris'],
  fallStreak: ['arrow', 'shard', 'wisp'],
  vortex: ['wisp', 'smoke', 'dot', 'flame'],
  wall: ['flame', 'smoke', 'dot'],
  mote: ['star', 'dot', 'glow', 'spark', 'shard'],
};

/**
 * @param {any} data
 * @returns {VfxDef[]}
 */
export function parseVfxDefs(data) {
  if (!Array.isArray(data)) throw new Error('VFX catalog must be an array');
  const seen = new Set();
  for (const def of data) {
    if (!isObj(def)) throw new Error('Each VFX def must be an object');
    for (const key of ['id', 'name', 'shape', 'colorA']) {
      if (!def[key]) throw new Error(`VFX def missing required field: "${key}" (id: ${def.id || '?'})`);
    }
    if (seen.has(def.id)) throw new Error(`Duplicate VFX id: "${def.id}"`);
    seen.add(def.id);
    const label = `VFX "${def.id}"`;
    if (!VFX_SHAPES.includes(def.shape)) throw new Error(`${label} has unknown shape "${def.shape}"`);
    if (!isHex(def.colorA)) throw new Error(`${label} colorA must be a "#rrggbb" hex string`);
    if (def.colorB !== undefined && !isHex(def.colorB)) throw new Error(`${label} colorB must be a "#rrggbb" hex string`);
    if (def.params !== undefined && !isObj(def.params)) throw new Error(`${label} params must be an object`);
    const params = def.params || {};
    if (params.texture !== undefined && !VFX_TEXTURES.includes(params.texture)) {
      throw new Error(`${label} params.texture must be one of ${VFX_TEXTURES.join(', ')}`);
    }
    const spec = PARAM_SPECS[def.shape];
    for (const [key, [min, max]] of Object.entries(spec)) {
      if (params[key] === undefined) continue;
      if (typeof params[key] !== 'number' || params[key] < min || params[key] > max) {
        throw new Error(`${label} params.${key} must be a number between ${min} and ${max}`);
      }
    }
  }
  return data;
}

/** Default parameter values for a freshly-created def of the given shape — the Skill Builder seeds a new custom VFX with these before the author starts tuning. Roughly the middle of each existing built-in preset's typical range. */
export function defaultVfxParams(shape) {
  switch (shape) {
    case 'burst': return { count: 20, size: 0.3, speed: 3, life: 0.5, spread: Math.PI * 2, gravityY: 0, texture: 'dot', whiteHot: 0.35 };
    case 'sparkleBurst': return { count: 8, size: 0.4, speed: 0.6, life: 0.9, whiteHot: 0.4 };
    case 'ring': return { radius: 3, life: 0.6, whiteHot: 0.25 };
    case 'aura': return { radius: 0.85, count: 18, texture: 'dot', whiteHot: 0.25 };
    case 'cloud': return { radius: 1, count: 10, riseY: 0.6 };
    case 'stream': return { count: 30, speed: 3, angle: 0.15, life: 0.4, whiteHot: 0.3 };
    case 'fall': return { count: 20, spreadRadius: 2, dropSpeed: 8, whiteHot: 0.3 };
    case 'shard': return { count: 12, length: 0.6, width: 0.16, speed: 6, life: 0.4, coneAngle: 0.15, gravityY: 0, texture: 'shard', whiteHot: 0.3 };
    case 'fallStreak': return { count: 20, spreadRadius: 2, dropSpeed: 8, width: 0.14, length: 0.6, texture: 'arrow', whiteHot: 0.3 };
    case 'bolt': return { count: 3, length: 2.2, width: 0.35, life: 0.25, flashSize: 1 };
    case 'vortex': return { radius: 1.2, height: 3, count: 30, orbitSpeed: 8, life: 1.2, whiteHot: 0.15 };
    case 'wall': return { width: 3, riseY: 1.6, count: 24, segments: 6, whiteHot: 0.12 };
    case 'ringBurst': return { radius: 3, life: 0.6, burstCount: 16, burstSize: 0.3, gravityY: 0 };
    case 'flash': return { size: 2, life: 0.18, boost: 4, count: 1, whiteHot: 0.5 };
    case 'spark': return { count: 16, length: 0.35, width: 0.07, speed: 9, life: 0.45, gravityY: -3, whiteHot: 0.45 };
    case 'shockwave': return { radius: 4, life: 0.45, boost: 3, whiteHot: 0.45 };
    case 'smoke': return { count: 8, size: 0.9, life: 1.1, riseY: 0.8, spread: 0.5, opacity: 0.5, turbulence: 0.6 };
    case 'debris': return { count: 8, size: 0.18, speed: 5, life: 0.9, gravityY: -12 };
    case 'slash': return { size: 2.2, life: 0.28, spin: 5, count: 1, whiteHot: 0.45 };
    case 'magicCircle': return { radius: 1.6, life: 1.1, spin: 1.1 };
    case 'mote': return { radius: 1, count: 14, riseY: 0.5, size: 0.16, life: 2.2, turbulence: 0.35, texture: 'star', whiteHot: 0.3 };
    case 'beam': return { height: 4, width: 0.8, count: 10, life: 0.7, riseY: 2, whiteHot: 0.3 };
    case 'fire': return { radius: 0.35, height: 2.4, count: 26, size: 0.55, life: 0.7, whiteHot: 0.08 };
    default: return {};
  }
}
