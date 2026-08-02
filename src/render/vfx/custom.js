// src/render/vfx/custom.js
// Turns a validated VfxDef (src/sim/vfxDefs.js) into a real three.quarks
// ParticleSystem by calling the SAME shape builder every built-in preset in
// presets.js already uses — a custom VFX is authored data, not authored code.
import {
  burstPreset, sparkleBurstPreset, ringPreset, auraPreset, cloudPreset, streamPreset, fallPreset,
  shardPreset, fallStreakPreset, boltPreset, vortexPreset, wallPreset, ringBurstPreset,
  flashPreset, sparkPreset, shockwavePreset, smokePreset, debrisPreset, slashPreset,
  magicCirclePreset, motePreset, beamPreset, firePreset, vec4,
} from './presets.js';
import {
  getSoftDotTexture, getRingTexture, getSparkTexture, getShardTexture, getArrowTexture,
  getStarTexture, getGlowTexture, getSmokeTexture, getFlameTexture, getWispTexture, getDebrisTexture,
} from './textures.js';

const BUILDERS = {
  burst: burstPreset,
  sparkleBurst: sparkleBurstPreset,
  ring: ringPreset,
  aura: auraPreset,
  cloud: cloudPreset,
  stream: streamPreset,
  fall: fallPreset,
  shard: shardPreset,
  fallStreak: fallStreakPreset,
  bolt: boltPreset,
  vortex: vortexPreset,
  wall: wallPreset,
  ringBurst: ringBurstPreset,
  flash: flashPreset,
  spark: sparkPreset,
  shockwave: shockwavePreset,
  smoke: smokePreset,
  debris: debrisPreset,
  slash: slashPreset,
  magicCircle: magicCirclePreset,
  mote: motePreset,
  beam: beamPreset,
  fire: firePreset,
};

const TEXTURES = {
  dot: getSoftDotTexture,
  ring: getRingTexture,
  spark: getSparkTexture,
  star: getStarTexture,
  glow: getGlowTexture,
  smoke: getSmokeTexture,
  shard: getShardTexture,
  arrow: getArrowTexture,
  flame: getFlameTexture,
  wisp: getWispTexture,
  debris: getDebrisTexture,
};

/**
 * @param {import('../../sim/vfxDefs.js').VfxDef} def
 * @returns {import('three.quarks').ParticleSystem|import('three.quarks').ParticleSystem[]|null}
 *   an array for the composite shapes (bolt/wall/ringBurst) — spawn() in
 *   index.js already treats a factory's return value as "one system or an
 *   array of them" for the built-in presets, and applies the exact same rule
 *   here since a custom def is just data plugged into the same builders.
 */
export function buildCustomVfxSystem(def, spawnOpts = {}) {
  const builder = BUILDERS[def.shape];
  if (!builder) {
    console.warn(`[vfx] custom def "${def.id}" has unknown shape "${def.shape}"`);
    return null;
  }
  const params = def.params || {};
  const opts = {
    ...params,
    colorA: vec4(spawnOpts.colorA || def.colorA),
    colorB: vec4(spawnOpts.colorB || def.colorB || def.colorA),
  };
  // A placed world emitter (src/render/worldParticles.js) can scale and
  // thicken whatever effect it points at, including a custom one — apply
  // those two dials to whichever of this shape's params they mean. Keys the
  // chosen shape doesn't use are simply absent, so this needs no per-shape
  // knowledge.
  const scale = spawnOpts.scale ?? 1;
  const intensity = spawnOpts.intensity ?? 1;
  if (scale !== 1) {
    for (const key of ['size', 'radius', 'length', 'width', 'height', 'spreadRadius', 'burstSize', 'flashSize']) {
      if (typeof opts[key] === 'number') opts[key] *= scale;
    }
  }
  if (intensity !== 1) {
    for (const key of ['count', 'burstCount']) {
      if (typeof opts[key] === 'number') opts[key] = Math.max(1, Math.round(opts[key] * intensity));
    }
  }
  // Only burst/aura (dot/ring/spark) and shard/fallStreak (shard/arrow)
  // accept a `texture` param (see presets.js) — resolve the id to an actual
  // texture for them; every other shape ignores this key already
  // (ParticleSystem opts are destructured, extras no-op).
  if (params.texture) opts.texture = (TEXTURES[params.texture] || getSoftDotTexture)();
  return builder(opts);
}
