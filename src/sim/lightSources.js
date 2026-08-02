// src/sim/lightSources.js
// Schema + validator for `world.lights[]` — placed light sources, authored
// from the World Editor's Lights mode.
//
// Why this exists at all: the whole game is lit by ONE directional light plus
// a hemisphere ambient (see src/render/atmosphere.js), which is exactly right
// for an outdoor map and useless the moment you build something enclosed. A
// cave, a cell block, a cellar, the inside of a cage — the sun still reaches
// it (nothing occludes the hemisphere term) but nothing in there ever reads as
// *lit by something*: no falloff, no pool of warm light on the floor, no dark
// corners. A torch prop with no light next to it is a decal.
//
// So: point and spot lights placed like any other world content, with a
// strength, a radius (the "area of effect"), falloff, flicker, and — for spot
// lights — a cone and an aim direction.
//
// The hard constraint the runtime works around lives in three.js, not here:
// the NUMBER of lights in a scene is baked into every material's shader
// program, so adding or removing one recompiles everything visible. That's why
// src/render/worldLights.js streams these through a fixed pool of real lights
// instead of adding/removing them per light source — same trick, same reason,
// as the VFX light pool (src/render/vfx/lights.js). This file only describes
// the authored data; it knows nothing about pools or three.js.
//
// Zero DOM/rendering dependencies, same purity rule as every other src/sim file.

const isObj = (v) => v && typeof v === 'object';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

export const LIGHT_SOURCE_TYPES = ['point', 'spot'];

/** Beyond this distance from the camera a light source isn't given a pool slot at all (see src/render/worldLights.js). Per-light override via `activationRadius`. */
export const DEFAULT_LIGHT_ACTIVATION_RADIUS = 70;

/**
 * @typedef {Object} LightSourceDef
 * @property {string} id unique within the map
 * @property {'point'|'spot'} type
 * @property {{x:number,y:number,z:number}} position world-space, y is ABSOLUTE (not an offset above ground) — a ceiling lantern lives at the ceiling
 * @property {string} color "#rrggbb"
 * @property {number} intensity brightness multiplier
 * @property {number} distance the "area of effect": metres at which the light reaches zero. Not a soft suggestion — three.js clamps hard at this radius, which is exactly what makes a light stay inside one cell of a dungeon instead of leaking through the wall behind it.
 * @property {number} [decay] falloff exponent, default 2 (physically correct inverse-square). Lower it for a flatter, more stylized pool of light that fills a room evenly.
 * @property {number} [flicker] 0..1 — how much the intensity wavers. 0 is a steady lamp, ~0.25 is a torch, 1 is a dying fire.
 * @property {number} [flickerSpeed] Hz-ish, default 9
 * @property {boolean} [castShadow] EXPENSIVE (a point light shadow is six render passes). Off by default; the runtime caps how many are honoured at once regardless of how many are authored.
 * @property {number} [angleDeg] spot only — half-angle of the cone, 5..85
 * @property {number} [penumbra] spot only — 0..1 edge softness
 * @property {number} [yawDeg] spot only — compass direction the cone points, degrees
 * @property {number} [pitchDeg] spot only — -90 is straight down (the default: a ceiling spot), 0 is horizontal, 90 straight up
 * @property {number} [activationRadius] metres from the camera at which this light claims a pool slot, default DEFAULT_LIGHT_ACTIVATION_RADIUS
 * @property {string} [label] author-facing name shown in the editor list
 */

const NUMERIC_RANGES = {
  intensity: [0, 200],
  distance: [0.5, 300],
  decay: [0, 4],
  flicker: [0, 1],
  flickerSpeed: [0.2, 30],
  angleDeg: [5, 85],
  penumbra: [0, 1],
  yawDeg: [-360, 360],
  pitchDeg: [-90, 90],
  activationRadius: [5, 1000],
};

const REQUIRED_NUMBERS = ['intensity', 'distance'];

/**
 * Starting points for Lights mode's palette. Deliberately data, not code: the
 * editor drops a copy into `world.lights[]` and every field stays editable
 * afterwards, so a preset is a good first guess and never a hidden dependency.
 *
 * The intensities look large next to a directional light's 1.75 because a
 * point light's contribution is divided by distance^decay — at 3m from a
 * torch with decay 2 you are already down by a factor of nine.
 * @type {Array<{id:string,label:string,category:string,def:Partial<LightSourceDef>}>}
 */
export const LIGHT_PRESETS = [
  {
    id: 'torch', label: 'Wall Torch', category: 'Fire',
    def: { type: 'point', color: '#ffa64d', intensity: 14, distance: 11, decay: 2, flicker: 0.28, flickerSpeed: 11 },
  },
  {
    id: 'campfire', label: 'Campfire', category: 'Fire',
    def: { type: 'point', color: '#ff8a3d', intensity: 26, distance: 18, decay: 2, flicker: 0.22, flickerSpeed: 8 },
  },
  {
    id: 'brazier', label: 'Brazier', category: 'Fire',
    def: { type: 'point', color: '#ffb066', intensity: 20, distance: 15, decay: 2, flicker: 0.18, flickerSpeed: 9 },
  },
  {
    id: 'candle', label: 'Candle', category: 'Fire',
    def: { type: 'point', color: '#ffd9a0', intensity: 4, distance: 5, decay: 2, flicker: 0.35, flickerSpeed: 13 },
  },
  {
    id: 'forge', label: 'Forge Coals', category: 'Fire',
    def: { type: 'point', color: '#ff5a1e', intensity: 22, distance: 12, decay: 2, flicker: 0.12, flickerSpeed: 5 },
  },
  {
    id: 'lantern', label: 'Hanging Lantern', category: 'Lamps',
    def: { type: 'point', color: '#ffe0a8', intensity: 12, distance: 13, decay: 2, flicker: 0.05, flickerSpeed: 6 },
  },
  {
    id: 'room-fill', label: 'Room Fill (soft, wide)', category: 'Lamps',
    // decay 1 on purpose: a fill light's job is to keep an interior readable
    // from wall to wall, and inverse-square makes the far corner black.
    def: { type: 'point', color: '#cfd8e8', intensity: 9, distance: 22, decay: 1, flicker: 0 },
  },
  {
    id: 'crystal', label: 'Magic Crystal', category: 'Magic',
    def: { type: 'point', color: '#7fd4ff', intensity: 14, distance: 14, decay: 2, flicker: 0.14, flickerSpeed: 2.5 },
  },
  {
    id: 'rune', label: 'Rune Glow (green)', category: 'Magic',
    def: { type: 'point', color: '#7dffb0', intensity: 10, distance: 9, decay: 2, flicker: 0.1, flickerSpeed: 3 },
  },
  {
    id: 'cursed', label: 'Cursed Glow (violet)', category: 'Magic',
    def: { type: 'point', color: '#b06bff', intensity: 12, distance: 12, decay: 2, flicker: 0.2, flickerSpeed: 4 },
  },
  {
    id: 'ceiling-spot', label: 'Ceiling Spot (down)', category: 'Spots',
    def: { type: 'spot', color: '#fff2d0', intensity: 30, distance: 20, decay: 2, angleDeg: 35, penumbra: 0.5, pitchDeg: -90, flicker: 0 },
  },
  {
    id: 'cell-shaft', label: 'Shaft of Daylight', category: 'Spots',
    // A grate or barred window high in a cell wall: cold, narrow, hard-edged.
    def: { type: 'spot', color: '#dceaff', intensity: 45, distance: 26, decay: 1.4, angleDeg: 18, penumbra: 0.22, pitchDeg: -68, flicker: 0 },
  },
  {
    id: 'corridor-spot', label: 'Corridor Wash', category: 'Spots',
    def: { type: 'spot', color: '#ffd9a0', intensity: 26, distance: 24, decay: 1.6, angleDeg: 42, penumbra: 0.7, pitchDeg: -20, flicker: 0.08, flickerSpeed: 7 },
  },
];

export const LIGHT_PRESETS_BY_ID = Object.fromEntries(LIGHT_PRESETS.map((p) => [p.id, p]));

/** Presets grouped for the editor palette, in first-seen category order. */
export function lightPresetsByCategory() {
  const groups = [];
  for (const preset of LIGHT_PRESETS) {
    let group = groups.find((g) => g.category === preset.category);
    if (!group) groups.push((group = { category: preset.category, presets: [] }));
    group.presets.push(preset);
  }
  return groups;
}

/**
 * A complete, valid light source built from a preset — every optional field
 * filled in, so the editor's sliders always have something real to show and
 * the saved JSON is self-describing rather than half-defaults.
 * @param {string} presetId
 * @param {{x:number,y:number,z:number}} position
 * @param {string} id
 * @returns {LightSourceDef}
 */
export function lightSourceFromPreset(presetId, position, id) {
  const preset = LIGHT_PRESETS_BY_ID[presetId] || LIGHT_PRESETS[0];
  const def = {
    id,
    label: preset.label,
    type: 'point',
    color: '#ffffff',
    intensity: 12,
    distance: 12,
    decay: 2,
    flicker: 0,
    flickerSpeed: 9,
    castShadow: false,
    activationRadius: DEFAULT_LIGHT_ACTIVATION_RADIUS,
    ...preset.def,
    position: { x: position.x, y: position.y, z: position.z },
  };
  if (def.type === 'spot') {
    def.angleDeg = def.angleDeg ?? 35;
    def.penumbra = def.penumbra ?? 0.5;
    def.yawDeg = def.yawDeg ?? 0;
    def.pitchDeg = def.pitchDeg ?? -90;
  }
  return def;
}

/**
 * @param {any} list
 * @returns {LightSourceDef[]}
 */
export function validateLightSources(list) {
  if (!Array.isArray(list)) throw new Error('World lights must be an array');
  const seen = new Set();
  for (const l of list) {
    if (!isObj(l)) throw new Error('Each light source must be an object');
    for (const key of ['id', 'type', 'position', 'color']) {
      if (l[key] === undefined) throw new Error(`Light source missing required field: "${key}" (id: ${l.id || '?'})`);
    }
    if (typeof l.id !== 'string') throw new Error('Light source id must be a string');
    if (seen.has(l.id)) throw new Error(`Duplicate light source id: "${l.id}"`);
    seen.add(l.id);
    if (!LIGHT_SOURCE_TYPES.includes(l.type)) {
      throw new Error(`Light source "${l.id}" type must be one of ${LIGHT_SOURCE_TYPES.join(', ')}`);
    }
    if (!isObj(l.position)) throw new Error(`Light source "${l.id}" position must be an object`);
    for (const axis of ['x', 'y', 'z']) {
      if (typeof l.position[axis] !== 'number') {
        throw new Error(`Light source "${l.id}" position.${axis} must be a number`);
      }
    }
    if (!isHex(l.color)) throw new Error(`Light source "${l.id}" color must be a "#rrggbb" hex string`);
    for (const key of REQUIRED_NUMBERS) {
      if (l[key] === undefined) throw new Error(`Light source "${l.id}" missing required field: "${key}"`);
    }
    for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
      if (l[key] === undefined) continue;
      if (typeof l[key] !== 'number' || Number.isNaN(l[key]) || l[key] < min || l[key] > max) {
        throw new Error(`Light source "${l.id}" ${key} must be a number between ${min} and ${max}`);
      }
    }
    if (l.castShadow !== undefined && typeof l.castShadow !== 'boolean') {
      throw new Error(`Light source "${l.id}" castShadow must be a boolean`);
    }
    if (l.label !== undefined && typeof l.label !== 'string') {
      throw new Error(`Light source "${l.id}" label must be a string`);
    }
  }
  return list;
}

/**
 * Unit vector the cone of a spot light points along, from its authored
 * yaw/pitch in degrees. Lives here (rather than in the renderer) so the
 * editor's gizmo, the editor's live preview and the game all aim identically
 * — a spot whose preview points somewhere other than where it lights is worse
 * than no preview at all.
 *
 * yaw 0 looks along -Z (the same "north" the rest of the world uses for
 * facing), pitch -90 straight down.
 * @param {LightSourceDef} def
 * @returns {{x:number,y:number,z:number}}
 */
export function lightSpotDirection(def) {
  const rad = Math.PI / 180;
  const yaw = (def.yawDeg || 0) * rad;
  const pitch = (def.pitchDeg ?? -90) * rad;
  const horizontal = Math.cos(pitch);
  return {
    x: horizontal * Math.sin(yaw),
    y: Math.sin(pitch),
    z: -horizontal * Math.cos(yaw),
  };
}

/** Where a spot light's three.js target object belongs: one `distance` out along its aim. */
export function lightSpotTargetPosition(def) {
  const dir = lightSpotDirection(def);
  const reach = def.distance || 10;
  return {
    x: def.position.x + dir.x * reach,
    y: def.position.y + dir.y * reach,
    z: def.position.z + dir.z * reach,
  };
}

/**
 * The flicker multiplier for a light at time `t` seconds. Two out-of-phase
 * sines (same idea as the VFX light pool) so the period never becomes
 * obvious, plus a per-light phase offset so a row of torches along a corridor
 * doesn't pulse in unison — which is the single thing that most makes placed
 * lights read as fake.
 * @param {LightSourceDef} def
 * @param {number} t seconds
 * @param {number} phase per-light constant offset in radians
 */
export function lightFlickerFactor(def, t, phase = 0) {
  const amount = def.flicker || 0;
  if (amount <= 0) return 1;
  const speed = def.flickerSpeed ?? 9;
  const wave = Math.sin(t * speed + phase) * 0.6 + Math.sin(t * speed * 2.7 + phase * 1.7) * 0.4;
  // Clamped at 0.15 so even a "dying fire" never blinks fully out — a light
  // that reaches zero reads as a bug, not as a flame.
  return Math.max(0.15, 1 + amount * wave);
}
