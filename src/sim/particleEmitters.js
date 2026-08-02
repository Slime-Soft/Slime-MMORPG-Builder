// src/sim/particleEmitters.js
// Schema + validator for `world.particleEmitters[]` — particle effects placed
// directly into the world from the World Editor's Particles mode (a campfire's
// flames, glitter over a shrine, a tornado out in the fields, mist at the foot
// of a waterfall).
//
// This file deliberately does NOT know what effect ids exist. The catalog
// lives in src/render/vfx/worldEffects.js, which imports three.js and canvas
// textures and therefore can never be imported from src/sim (see
// npm run check:arch). Same split the world already uses for prop types vs.
// prop builders: sim validates the shape of the data, render decides what it
// looks like. An emitter pointing at an effect id that no longer exists logs
// a warning at spawn time and renders nothing, rather than failing to load
// the whole map.
//
// Zero DOM/rendering dependencies, same purity rule as every other src/sim file.

const isObj = (v) => v && typeof v === 'object';
const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/** Beyond this distance from the camera an emitter isn't simulated at all (see src/render/worldParticles.js). Per-emitter override via `activationRadius`. */
export const DEFAULT_EMITTER_ACTIVATION_RADIUS = 55;

/**
 * @typedef {Object} ParticleEmitterDef
 * @property {string} id unique within the map
 * @property {string} effectId a world-effect id (src/render/vfx/worldEffects.js) — or any skill preset / custom VFX id, since all three resolve through the same spawn()
 * @property {{x:number,y:number,z:number}} position
 * @property {number} [scale] size multiplier, default 1
 * @property {number} [intensity] particle-count multiplier, default 1
 * @property {string} [colorA] "#rrggbb" override for the effect's primary colour
 * @property {string} [colorB] "#rrggbb" override for the effect's secondary colour
 * @property {number} [activationRadius] metres from the camera at which this emitter starts running, default DEFAULT_EMITTER_ACTIVATION_RADIUS
 * @property {boolean} [light] whether this effect's dynamic light (if it has one) is used, default true
 * @property {{x:number,y:number,z:number}} [rotation] DEGREES about each axis, applied to the emitter's anchor — so a
 *   flame licking straight up can be laid on its side as a wall torch's spill, a beam aimed along a corridor, a
 *   waterfall mist angled off a cliff. It sits on the anchor rather than inside the effect recipe because every
 *   effect is authored in its own local space (up is +Y) and rotating the anchor is the one transform that works
 *   for all 79 of them without touching a single preset.
 * @property {string} [label] author-facing name shown in the editor list
 */

const NUMERIC_RANGES = {
  scale: [0.05, 20],
  intensity: [0.05, 10],
  activationRadius: [5, 1000],
};

/**
 * @param {any} list
 * @returns {ParticleEmitterDef[]}
 */
export function validateParticleEmitters(list) {
  if (!Array.isArray(list)) throw new Error('World particleEmitters must be an array');
  const seen = new Set();
  for (const em of list) {
    if (!isObj(em)) throw new Error('Each particle emitter must be an object');
    for (const key of ['id', 'effectId', 'position']) {
      if (em[key] === undefined) throw new Error(`Particle emitter missing required field: "${key}" (id: ${em.id || '?'})`);
    }
    if (typeof em.id !== 'string') throw new Error('Particle emitter id must be a string');
    if (seen.has(em.id)) throw new Error(`Duplicate particle emitter id: "${em.id}"`);
    seen.add(em.id);
    if (typeof em.effectId !== 'string') throw new Error(`Particle emitter "${em.id}" effectId must be a string`);
    for (const axis of ['x', 'y', 'z']) {
      if (typeof em.position[axis] !== 'number') {
        throw new Error(`Particle emitter "${em.id}" position.${axis} must be a number`);
      }
    }
    for (const [key, [min, max]] of Object.entries(NUMERIC_RANGES)) {
      if (em[key] === undefined) continue;
      if (typeof em[key] !== 'number' || em[key] < min || em[key] > max) {
        throw new Error(`Particle emitter "${em.id}" ${key} must be a number between ${min} and ${max}`);
      }
    }
    for (const key of ['colorA', 'colorB']) {
      if (em[key] !== undefined && !isHex(em[key])) {
        throw new Error(`Particle emitter "${em.id}" ${key} must be a "#rrggbb" hex string`);
      }
    }
    if (em.rotation !== undefined) {
      if (!isObj(em.rotation)) throw new Error(`Particle emitter "${em.id}" rotation must be an object`);
      for (const axis of ['x', 'y', 'z']) {
        const v = em.rotation[axis];
        if (v === undefined) continue; // a partial {y:90} is fine — the missing axes are 0
        if (typeof v !== 'number' || v < -360 || v > 360) {
          throw new Error(`Particle emitter "${em.id}" rotation.${axis} must be a number between -360 and 360 (degrees)`);
        }
      }
    }
    if (em.light !== undefined && typeof em.light !== 'boolean') {
      throw new Error(`Particle emitter "${em.id}" light must be a boolean`);
    }
    if (em.label !== undefined && typeof em.label !== 'string') {
      throw new Error(`Particle emitter "${em.id}" label must be a string`);
    }
  }
  return list;
}

/** An emitter's authored rotation in RADIANS, ready for `Object3D.rotation.set(...)`. Kept here (rather than in the two renderers) so the editor's live preview and the game agree on both the default and the degrees→radians conversion. */
export function emitterRotationRadians(emitter) {
  const r = emitter.rotation || {};
  const rad = Math.PI / 180;
  return { x: (r.x || 0) * rad, y: (r.y || 0) * rad, z: (r.z || 0) * rad };
}

/** The spawn options a placed emitter passes to the VFX system — kept here so the game client and the editor build them identically. */
export function emitterSpawnOptions(emitter) {
  return {
    scale: emitter.scale ?? 1,
    intensity: emitter.intensity ?? 1,
    colorA: emitter.colorA,
    colorB: emitter.colorB,
    light: emitter.light !== false,
  };
}
