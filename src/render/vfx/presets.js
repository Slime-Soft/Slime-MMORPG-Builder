// src/render/vfx/presets.js
// The VFX preset library: one plain-JS factory per named effect, each
// returning a fresh three.quarks ParticleSystem (or an array of them). No
// external asset files — every texture is the shared procedural canvas
// sprites from textures.js (same "no external asset" rule the rest of the
// generator library follows).
//
// --- 2026-07-26 overhaul -----------------------------------------------
// Every preset used to be ONE emitter of soft dots. That is why they read as
// underwhelming: a fireball impact and a heal differed only in hue, both were
// a pastel puff that faded IN over its first quarter-life (fadeGradient's old
// alpha ramp started at 0), and nothing in the frame ever got brighter than
// the ground. Three changes fix that, and they are the reason this file is
// structured the way it is now:
//
// 1. HOT CORES. Colour gradients start well above 1.0 (`boost`) and every
//    material is `toneMapped: false`, so a particle's centre lands above the
//    bloom threshold (postProcessing.js's UnrealBloomPass) and actually
//    glows instead of merely being light-coloured.
// 2. ATTACK, NOT FADE-IN. Alpha is full at t=0 and decays. An impact must
//    exist on the very first frame it is drawn.
// 3. LAYERS. A real effect is a stack: a flash for the instant of contact,
//    a core burst for the body, decelerating sparks for detail, a shockwave
//    for the front, smoke for the aftermath, debris for weight. The
//    `impactFx`/`novaFx`/`castFx`/... recipes near the bottom compose those
//    layers; the PRESETS table is then mostly one line per effect. Every
//    preset id that existed before still exists — the data in
//    skills/skill-defs.json and vfx/custom-vfx.json needed no migration.
//
// The individual shape builders (burstPreset, ringPreset, ...) are still
// exported one-per-shape because src/render/vfx/custom.js drives them
// straight from author-picked numbers (see src/sim/vfxDefs.js).
import * as THREE from 'three';
import { ParticleSystem, RenderMode } from 'three.quarks';
import {
  ConstantValue, IntervalValue, ConstantColor, ColorOverLife, SizeOverLife,
  RotationOverLife, ForceOverLife, Gradient, SphereEmitter, ConeEmitter,
  DonutEmitter, PiecewiseBezier, Bezier, Vector3Function, OrbitOverLife,
  SpeedOverLife, Noise, PointEmitter,
} from 'quarks.core';
import {
  getSoftDotTexture, getRingTexture, getSparkTexture, getShardTexture,
  getArrowTexture, getBoltTexture, getFlameTexture, getFlameBodyTexture, getWispTexture,
  getGlowTexture, getSmokeTexture, getShockwaveTexture, getSlashTexture,
  getMagicCircleTexture, getStarTexture, getDebrisTexture, getBeamTexture,
} from './textures.js';

const WHITE = new THREE.Vector4(1, 1, 1, 1);

/** Exported so src/render/vfx/custom.js can turn an author-picked hex color (from an <input type="color">) into the THREE.Vector4 every shape builder below expects. */
export function vec4(hex, a = 1) {
  const c = new THREE.Color(hex);
  return new THREE.Vector4(c.r, c.g, c.b, a);
}

const v3 = (c, mul = 1) => new THREE.Vector3(c.x * mul, c.y * mul, c.z * mul);

/** Blends two colours. Used to derive a saturated body colour from an effect's authored pair. */
export function mixColor(a, b, t) {
  return new THREE.Vector4(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
    a.w,
  );
}

/** Pulls a colour part-way toward white. `t` of 0 keeps the hue exactly as authored. */
export function lighten(color, t = 0.5) {
  return new THREE.Vector4(
    color.x + (1 - color.x) * t,
    color.y + (1 - color.y) * t,
    color.z + (1 - color.z) * t,
    color.w,
  );
}

/**
 * The colour+alpha envelope every particle in this file uses.
 *
 * Colour runs hot-core → colorA → colorB, which is how real emissive things
 * look (a spark's centre is brighter and less saturated than its edge, never a
 * flat single tone). `boost` pushes the first stops above 1.0 so they clear
 * the bloom threshold — that HDR overshoot, not particle count, is what makes
 * an effect feel powerful.
 *
 * `whiteHot` is how far that core is pushed toward WHITE, and it is the single
 * most important knob here. The first version of this hardcoded a pure-white
 * first stop, which meant every particle of every effect was born white: the
 * authored colours barely showed, and changing a colour in the editor looked
 * like it did nothing at all (Dennis's exact complaint — "white particles
 * whose color can't be changed"). Default is a light lift; fire and other
 * effects whose identity IS their hue pass something near 0.
 *
 * Alpha is full at birth and decays to 0, with `hold` controlling how long it
 * stays solid before the fade starts. The very first version ramped alpha UP
 * from 0 over the first quarter of a particle's life, which softened the one
 * frame that matters most.
 */
function hotGradient(colorA, colorB = colorA, { boost = 1.9, hold = 0.2, peak = 1, whiteHot = 0.3 } = {}) {
  return new Gradient(
    [
      [v3(lighten(colorA, whiteHot), boost), 0],
      [v3(colorA, Math.max(1, boost * 0.7)), 0.3],
      [v3(colorB), 1],
    ],
    [
      [peak, 0],
      [peak, hold],
      [0, 1],
    ]
  );
}

/** A soft, non-emissive envelope for smoke/dust — no white core, no HDR boost, and a gentle fade in AND out (a smoke puff genuinely does grow into existence). */
function softGradient(colorA, colorB = colorA, peak = 0.5) {
  return new Gradient(
    [
      [v3(colorA), 0],
      [v3(colorB), 1],
    ],
    [
      [0, 0],
      [peak, 0.18],
      [0, 1],
    ]
  );
}

const shrinkCurve = () => new PiecewiseBezier([[new Bezier(1, 1, 0.4, 0), 0]]);
const growShrinkCurve = () => new PiecewiseBezier([[new Bezier(0.2, 1, 1, 0), 0]]);
/** Pop to full instantly, then shrink away — the size curve of a flash or an impact core. */
const popCurve = () => new PiecewiseBezier([[new Bezier(0.5, 1.15, 0.7, 0), 0]]);
/** Keep growing for the whole life — smoke, expanding waves. */
const swellCurve = (from = 0.35) => new PiecewiseBezier([[new Bezier(from, 0.8, 1, 1.15), 0]]);
/** Fast out of the gate, then almost stationary — sparks and shrapnel losing to air drag. Without this, particles fly at a constant speed and read as a mechanical spray. */
const dragCurve = () => new PiecewiseBezier([[new Bezier(1, 0.32, 0.06, 0), 0]]);

function spriteMat(map, blending = THREE.AdditiveBlending) {
  return new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    blending,
    // Critical for the hot cores above: with tone mapping left on, the
    // material's own shader would compress a 2.4x white back down to ~1.0
    // BEFORE the bloom pass ever sees it, and nothing would ever glow.
    // OutputPass still tone-maps the final composite (see postProcessing.js).
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Never let a count round down to zero. Placed world emitters multiply every
 * layer's count by an authored `intensity` (see worldEffects.js), so a small
 * layer inside a composite — 4 wisps, 3 embers — turns into a system that
 * emits literally nothing the moment an author drags intensity below ~0.4.
 * That failure is completely silent: the effect just partly disappears.
 */
const emitCount = (n) => Math.max(1, Math.round(n));

/** A one-shot burst emitter's boilerplate: emit `count` at `delay`, then live long enough for autoDestroy to fire only after the last particle has actually died. */
function burstEmission(count, delay = 0) {
  return {
    duration: Math.max(0.05, delay + 0.05),
    looping: false,
    autoDestroy: true,
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: delay, count: new ConstantValue(emitCount(count)), cycle: 1, interval: 0.01, probability: 1 }],
  };
}

const asArray = (built) => (Array.isArray(built) ? built : [built]);

/** Flattens any mix of single systems and arrays into the one flat array spawn() expects. */
export function layers(...built) {
  return built.flatMap((b) => (b == null ? [] : asArray(b)));
}

/**
 * Attaches a dynamic-light spec to an effect (read by createVfxSystem's
 * spawn(), see index.js). A muzzle flash lighting up the ground around it is
 * the single cheapest thing that makes a spell feel like it has energy, and
 * no amount of particles substitutes for it. Stored on the emitter's
 * userData rather than changing what a factory returns, so every existing
 * caller — including custom.js's author-driven defs — is unaffected.
 * @param {{color:number, intensity?:number, distance?:number, life?:number, persistent?:boolean}} spec
 */
export function withLight(built, spec) {
  const systems = asArray(built);
  if (systems[0]) systems[0].emitter.userData.vfxLight = spec;
  return systems;
}

/** Shifts a one-shot effect later in time — how a composite stages its layers (flash first, smoke a beat after the bang). No-ops on looping systems, which have no burst to move. */
export function withDelay(built, delay) {
  if (!delay) return built;
  for (const sys of asArray(built)) {
    if (sys.looping || !sys.emissionBursts?.length) continue;
    for (const burst of sys.emissionBursts) burst.time += delay;
    sys.duration = Math.max(sys.duration, delay + 0.05);
  }
  return built;
}

// ---------------------------------------------------------------------------
// Shape builders. Each is one emitter doing one job; the recipes further down
// stack them. src/render/vfx/custom.js calls these directly with author-picked
// numbers, so their parameter names are part of the authoring contract (see
// PARAM_SPECS in src/sim/vfxDefs.js).
// ---------------------------------------------------------------------------

/** One-shot expanding burst of soft dots — the body of an impact. */
export function burstPreset({
  colorA, colorB = colorA, count = 24, size = 0.28, speed = 3, life = 0.5,
  texture = getSoftDotTexture(), spread = Math.PI * 2, gravityY = 0, delay = 0,
  boost = 1.9, whiteHot = 0.35, drag = true,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new IntervalValue(speed * 0.45, speed),
    startSize: new IntervalValue(size * 0.6, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.05, arc: spread }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot })),
      new SizeOverLife(shrinkCurve()),
      ...(drag ? [new SpeedOverLife(dragCurve())] : []),
      ...(gravityY ? [new ForceOverLife(new ConstantValue(0), new ConstantValue(gravityY), new ConstantValue(0))] : []),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture),
  });
}

/** Rotating spark/star burst — stun stars, holy motes, crit glints. */
export function sparkleBurstPreset({
  colorA, colorB = colorA, count = 8, size = 0.4, speed = 0.6, life = 0.9, delay = 0,
  texture = getSparkTexture(), boost = 2.1, whiteHot = 0.4,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.8, life * 1.2),
    startSpeed: new IntervalValue(0, speed),
    startSize: new IntervalValue(size * 0.7, size * 1.3),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.15, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.12 })),
      new SizeOverLife(growShrinkCurve()),
      new RotationOverLife(new IntervalValue(-4, 4)),
      new SpeedOverLife(dragCurve()),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture),
  });
}

/** A flat expanding ring on the ground — the classic Frost Nova footprint. */
export function ringPreset({ colorA, colorB = colorA, radius = 1.8, life = 0.6, delay = 0, texture = getRingTexture(), boost = 1.9, whiteHot = 0.25 } = {}) {
  return new ParticleSystem({
    ...burstEmission(1, delay),
    startLife: new ConstantValue(life),
    startSpeed: new ConstantValue(0),
    // startSize 1, because SizeOverLife MULTIPLIES startSize rather than
    // replacing it. With the 0.1 this used to carry, a "radius 4.5" ring
    // topped out at 0.45 units across — which is why ground rings have always
    // read as a tiny dot at the caster's feet instead of an expanding wave.
    // The curve is in DIAMETERS (a quad's size spans the whole ring).
    startSize: new ConstantValue(1),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new PointEmitter(),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.1 })),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0, radius * 1.4, radius * 2, radius * 2.1), 0]])),
    ],
    renderMode: RenderMode.HorizontalBillBoard,
    material: spriteMat(texture),
  });
}

/**
 * A hard-fronted shockwave disc — same idea as ringPreset but using the
 * wave-front sprite (bright leading rim, soft inner trail) and an ease-OUT
 * expansion: fast for the first third, then decelerating. A linearly
 * expanding ring reads as an animation; a decelerating one reads as a
 * release of energy.
 */
export function shockwavePreset({ colorA, colorB = colorA, radius = 2, life = 0.45, delay = 0, boost = 2.4, whiteHot = 0.45, peak = 0.4, vertical = false } = {}) {
  return new ParticleSystem({
    ...burstEmission(1, delay),
    startLife: new ConstantValue(life),
    startSpeed: new ConstantValue(0),
    startSize: new ConstantValue(1), // see ringPreset — SizeOverLife is a multiplier
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new PointEmitter(),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.05, peak })),
      // Diameters, and eased out: fast for the first third, then decelerating.
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0, radius * 1.4, radius * 1.75, radius * 1.85), 0]])),
    ],
    renderMode: vertical ? RenderMode.BillBoard : RenderMode.HorizontalBillBoard,
    material: spriteMat(getShockwaveTexture()),
  });
}

/**
 * A single bright flare that pops and vanishes — the instant of contact.
 * One sprite, no motion, over in ~0.2s: this is the layer the eye actually
 * registers as "something hit", and every impact composite starts with it.
 */
export function flashPreset({ colorA, colorB = colorA, size = 2, life = 0.18, delay = 0, boost = 3.0, whiteHot = 0.5, count = 1 } = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.8, life * 1.2),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 0.9, size * 1.1),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.08 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.05 })),
      new SizeOverLife(popCurve()),
      new RotationOverLife(new IntervalValue(-1, 1)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getGlowTexture()),
  });
}

/**
 * Rising, swelling, NORMAL-blended puffs. Smoke is the only layer here that
 * isn't additive, and that's the whole point: additive smoke just washes the
 * screen out, while normal-blended grey actually occludes and gives an
 * explosion a silhouette.
 */
export function smokePreset({
  colorA = vec4(0x8a8a8a), colorB = vec4(0x2a2a2a), count = 8, size = 0.9, life = 1.1,
  riseY = 0.8, delay = 0, spread = 0.5, opacity = 0.5, turbulence = 0.6,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new IntervalValue(spread * 0.3, spread),
    startSize: new IntervalValue(size * 0.7, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.2, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(softGradient(colorA, colorB, opacity)),
      new SizeOverLife(swellCurve(0.4)),
      new RotationOverLife(new IntervalValue(-0.8, 0.8)),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
      ...(turbulence ? [new Noise(new ConstantValue(0.9), new ConstantValue(turbulence))] : []),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getSmokeTexture(), THREE.NormalBlending),
  });
}

/** Tumbling angular chunks thrown clear of an impact and pulled down by gravity — the layer that gives a hit physical weight. */
export function debrisPreset({
  colorA, colorB = colorA, count = 8, size = 0.18, speed = 5, life = 0.9, gravityY = -12, delay = 0, boost = 1.1, whiteHot = 0.1,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.6, life * 1.2),
    startSpeed: new IntervalValue(speed * 0.4, speed),
    startSize: new IntervalValue(size * 0.6, size * 1.5),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    // A hemisphere-ish arc: debris flying downward into the ground it came
    // from looks wrong, so bias the spray upward and outward.
    shape: new ConeEmitter({ radius: 0.15, angle: 1.15, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.55 })),
      new RotationOverLife(new IntervalValue(-9, 9)),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(gravityY), new ConstantValue(0)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getDebrisTexture(), THREE.NormalBlending),
  });
}

/** Velocity-aligned streaks that shoot out and brake hard — the "sparks" layer. Reads completely differently from round dots because each one points where it's going. */
export function sparkPreset({
  colorA, colorB = colorA, count = 16, length = 0.35, width = 0.07, speed = 9, life = 0.45,
  gravityY = -3, delay = 0, spread = Math.PI * 2, coneAngle = null, boost = 2.4, whiteHot = 0.45,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.5, life * 1.3),
    startSpeed: new IntervalValue(speed * 0.45, speed),
    startSize: new Vector3Function(new ConstantValue(width), new ConstantValue(length), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: coneAngle != null
      ? new ConeEmitter({ radius: 0.05, angle: coneAngle, arc: Math.PI * 2 })
      : new SphereEmitter({ radius: 0.05, arc: spread }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.1 })),
      new SizeOverLife(shrinkCurve()),
      new SpeedOverLife(dragCurve()),
      ...(gravityY ? [new ForceOverLife(new ConstantValue(0), new ConstantValue(gravityY), new ConstantValue(0))] : []),
    ],
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor: 0.12,
    lengthFactor: 1.6,
    material: spriteMat(getSoftDotTexture()),
  });
}

/** A slow looping halo of motes orbiting the anchor — buffs, shields, enchantments. */
export function auraPreset({
  colorA, colorB = colorA, radius = 0.9, count = 18, texture = getStarTexture(),
  riseY = 0.35, orbitSpeed = 1.2, size = 0.22, boost = 1.8, whiteHot = 0.25,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(1, 1.6),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 0.6, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    shape: new DonutEmitter({ radius, donutRadius: radius * 0.28, arc: Math.PI * 2 }),
    behaviors: [
      // Motes rise as they orbit instead of hanging in a flat static hoop —
      // the old aura was a ring of stationary dots at ankle height.
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.15, peak: 0.9 })),
      new SizeOverLife(growShrinkCurve()),
      new RotationOverLife(new IntervalValue(-2, 2)),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
      new OrbitOverLife(new ConstantValue(orbitSpeed), new THREE.Vector3(0, 1, 0)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture),
  });
}

/** A low ground-hugging looping cloud — poison pools, DoT hazards, fog. Smoke-sprited and half-additive so it has body instead of being a glowing haze. */
export function cloudPreset({
  colorA, colorB = colorA, radius = 1.2, count = 10, riseY = 0.6, size = 0.9,
  texture = getSmokeTexture(), opacity = 0.45, turbulence = 0.5, life = 1.6,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 0.6, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    shape: new SphereEmitter({ radius, arc: Math.PI * 2, thickness: 0 }),
    behaviors: [
      new ColorOverLife(softGradient(colorA, colorB, opacity)),
      new SizeOverLife(growShrinkCurve()),
      new RotationOverLife(new IntervalValue(-0.5, 0.5)),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
      ...(turbulence ? [new Noise(new ConstantValue(0.7), new ConstantValue(turbulence))] : []),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture, THREE.NormalBlending),
  });
}

/** A continuous narrow directional stream along local +Z — beams, trails, jets. */
export function streamPreset({
  colorA, colorB = colorA, count = 30, speed = 4, angle = 0.15, life = 0.4,
  size = 0.22, texture = getSoftDotTexture(), boost = 2.1, whiteHot = 0.3, turbulence = 0,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new IntervalValue(speed * 0.7, speed),
    startSize: new IntervalValue(size * 0.6, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    shape: new ConeEmitter({ radius: 0.05, angle, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.12 })),
      new SizeOverLife(shrinkCurve()),
      ...(turbulence ? [new Noise(new ConstantValue(1.4), new ConstantValue(turbulence))] : []),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture),
  });
}

/** Particles falling from above the anchor — meteors, rain, motes descending. */
export function fallPreset({ colorA, colorB = colorA, count = 20, spreadRadius = 2, dropSpeed = 6, size = 0.25, delay = 0, boost = 1.9, whiteHot = 0.3 } = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(0.5, 0.9),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 0.6, size * 1.4),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: spreadRadius, thickness: 1, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot })),
      new SizeOverLife(shrinkCurve()),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(-dropSpeed), new ConstantValue(0)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getSoftDotTexture()),
  });
}

/**
 * A burst of elongated, pointed shapes (icicles, arrows) that actually point
 * the way they're flying. RenderMode.StretchedBillBoard rotates+stretches
 * each particle's quad to align with its own current velocity vector every
 * frame, so a shard/arrow-shaped texture drawn tall-and-narrow (see
 * textures.js) reads as "flying toward the target," not "a colored dot
 * happens to be moving."
 *
 * Two distinct emission modes, picked by which param is supplied:
 * - `spread` (default): SphereEmitter — an omnidirectional impact burst.
 *   NOTE: SphereEmitter's `arc` only restricts the azimuthal angle; the polar
 *   angle is always full random regardless of `arc`, so this can never be
 *   narrowed into a forward cone — that's what `coneAngle` is for.
 * - `coneAngle`: ConeEmitter, a genuine tight cone around local +Z (same
 *   convention streamPreset already uses) — for anything meant to fly IN A
 *   DIRECTION. Local +Z only points at the actual target if the anchor itself
 *   is oriented that way — see scene.js's travelAnchor.
 */
export function shardPreset({
  colorA, colorB = colorA, count = 12, length = 0.7, width = 0.18, speed = 6, life = 0.4,
  spread = Math.PI * 2, coneAngle = null, gravityY = 0, texture = getShardTexture(),
  speedFactor = 0.05, lengthFactor = 1.3, delay = 0, boost = 1.9, whiteHot = 0.3,
} = {}) {
  const shape = coneAngle != null
    ? new ConeEmitter({ radius: 0.05, angle: coneAngle, arc: Math.PI * 2 })
    : new SphereEmitter({ radius: 0.05, arc: spread });
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new IntervalValue(speed * 0.6, speed),
    startSize: new Vector3Function(new ConstantValue(width), new ConstantValue(length), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape,
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.35 })),
      ...(gravityY ? [new ForceOverLife(new ConstantValue(0), new ConstantValue(gravityY), new ConstantValue(0))] : []),
    ],
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor,
    lengthFactor,
    material: spriteMat(texture),
  });
}

/** fallPreset's drop-and-accelerate motion, rendered as velocity-aligned streaks — rain of arrows, icicle storms, meteors that read as projectiles rather than dots. */
export function fallStreakPreset({
  colorA, colorB = colorA, count = 20, spreadRadius = 2, dropSpeed = 8, width = 0.14, length = 0.6,
  texture = getArrowTexture(), speedFactor = 0.05, lengthFactor = 1, delay = 0, boost = 1.9, whiteHot = 0.3,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(0.5, 0.8),
    startSpeed: new ConstantValue(0),
    startSize: new Vector3Function(new ConstantValue(width), new ConstantValue(length), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: spreadRadius, thickness: 1, arc: Math.PI * 2 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.4 })),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(-dropSpeed), new ConstantValue(0)),
    ],
    renderMode: RenderMode.StretchedBillBoard,
    speedFactor,
    lengthFactor,
    material: spriteMat(texture),
  });
}

/** A jagged lightning bolt (a few overlapping zigzag quads) plus a bright flash and sparks at its base. Returns an array — the bolt shape and the flash need different render modes. */
export function boltPreset({
  colorA, colorB = colorA, count = 3, length = 2.2, width = 0.35, life = 0.22, flashSize = 1, delay = 0,
} = {}) {
  const bolt = new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.6, life),
    startSpeed: new ConstantValue(0),
    startSize: new Vector3Function(new ConstantValue(width), new ConstantValue(length), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.2, arc: Math.PI * 2 }),
    behaviors: [
      // Flicker rather than fade: alpha holds almost to the end, so the bolt
      // snaps off instead of dissolving politely.
      new ColorOverLife(hotGradient(colorA, colorB, { boost: 3, whiteHot: 0.5, hold: 0.6 })),
      new RotationOverLife(new IntervalValue(-0.6, 0.6)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getBoltTexture()),
  });
  return layers(
    bolt,
    flashPreset({ colorA, colorB, size: flashSize * 2.2, life: life * 1.1, delay }),
    sparkPreset({ colorA, colorB, count: 14, speed: 11, life: life * 2, delay, length: 0.3, width: 0.05 }),
  );
}

/** A genuine spinning vortex column — particles spawn in a ring, drift outward, rise, and orbit the vertical axis, so a tornado reads as a swirling funnel rather than a static cluster. */
export function vortexPreset({
  colorA, colorB = colorA, radius = 1.2, height = 3, count = 30, orbitSpeed = 8, life = 1.2,
  texture = getWispTexture(), size = 0.5, opacity = 0.85, additive = true,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new IntervalValue(radius * 0.15, radius * 0.4),
    startSize: new Vector3Function(new ConstantValue(size * 0.36), new ConstantValue(size), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    shape: new DonutEmitter({ radius: radius * 0.4, donutRadius: radius * 0.35, arc: Math.PI * 2 }),
    behaviors: [
      additive
        ? new ColorOverLife(hotGradient(colorA, colorB, { boost: 1.7, whiteHot: 0.15, hold: 0.2, peak: opacity }))
        : new ColorOverLife(softGradient(colorA, colorB, opacity)),
      new SizeOverLife(growShrinkCurve()),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(height), new ConstantValue(0)),
      new OrbitOverLife(new ConstantValue(orbitSpeed), new THREE.Vector3(0, 1, 0)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture, additive ? THREE.AdditiveBlending : THREE.NormalBlending),
  });
}

/**
 * A line of rising flame-licks. Several small flame clusters spaced evenly
 * along X read as one continuous wall, without depending on RectangleEmitter's
 * perimeter emission, which — even though it math-checks out in isolation —
 * produced no visible particles in this project's actual three.quarks build.
 */
export function wallPreset({
  colorA, colorB = colorA, width = 3, riseY = 1.6, count = 24, segments = 6, texture = getFlameTexture(),
} = {}) {
  const perSegment = Math.max(3, Math.round(count / segments));
  const systems = [];
  for (let i = 0; i < segments; i++) {
    const x = segments > 1 ? -width / 2 + (width * i) / (segments - 1) : 0;
    const sys = new ParticleSystem({
      duration: 1,
      looping: true,
      startLife: new IntervalValue(0.45, 0.9),
      startSpeed: new ConstantValue(0),
      startSize: new IntervalValue(0.4, 0.75),
      startColor: new ConstantColor(WHITE),
      worldSpace: false,
      emissionOverTime: new ConstantValue(emitCount(perSegment)),
      shape: new SphereEmitter({ radius: 0.22, arc: Math.PI * 2, thickness: 0 }),
      behaviors: [
        new ColorOverLife(hotGradient(colorA, colorB, { boost: 2.2, whiteHot: 0.12, hold: 0.1 })),
        new SizeOverLife(growShrinkCurve()),
        new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
        new Noise(new ConstantValue(1.6), new ConstantValue(0.7)),
      ],
      renderMode: RenderMode.BillBoard,
      material: spriteMat(texture),
    });
    sys.emitter.position.x = x;
    systems.push(sys);
  }
  return systems;
}

/**
 * A flat expanding ring PLUS an outward burst of billboarded sparks — the
 * ring alone (a paper-thin horizontal disc) is nearly edge-on from the
 * gameplay camera, so on its own it reads as "shows nothing". The burst layer
 * is always camera-facing, so the composite is visible from any angle. Also
 * lifts the ring off y=0 to dodge z-fighting with the ground mesh.
 */
export function ringBurstPreset({
  colorA, colorB = colorA, radius = 1.8, life = 0.6, burstCount = 16, burstSize = 0.3, burstSpeed,
  gravityY = 0, delay = 0,
} = {}) {
  const ring = ringPreset({ colorA, colorB, radius, life, delay });
  ring.emitter.position.y += 0.05;
  const wave = shockwavePreset({ colorA, colorB, radius: radius * 0.85, life: life * 0.7, delay });
  wave.emitter.position.y += 0.06;
  return layers(
    ring,
    wave,
    burstPreset({
      colorA, colorB, count: burstCount, size: burstSize, life: life * 0.85, gravityY, delay,
      speed: burstSpeed ?? Math.max(1.5, radius * 1.2),
    }),
    sparkPreset({ colorA, colorB, count: Math.round(burstCount * 0.8), speed: Math.max(4, radius * 3), life: life * 0.8, delay }),
  );
}

/** A crescent blade arc that sweeps and vanishes — melee swings. Rotating a stretched crescent sells a swing far better than a symmetric star burst ever could. */
export function slashPreset({
  colorA, colorB = colorA, size = 2.2, life = 0.28, delay = 0, spin = 5, boost = 2.6, whiteHot = 0.45, count = 1,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(count, delay),
    startLife: new IntervalValue(life * 0.85, life * 1.15),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 0.9, size * 1.1),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new SphereEmitter({ radius: 0.1 }),
    behaviors: [
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.08 })),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.7, 1.1, 1.2, 1.25), 0]])),
      new RotationOverLife(new IntervalValue(-spin, spin)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getSlashTexture()),
  });
}

/** A spinning rune circle flat on the ground — a cast tell. Grows in, spins, fades. */
export function magicCirclePreset({
  colorA, colorB = colorA, radius = 1.6, life = 1.1, delay = 0, spin = 1.1, boost = 2.2,
} = {}) {
  return new ParticleSystem({
    ...burstEmission(1, delay),
    startLife: new ConstantValue(life),
    startSpeed: new ConstantValue(0),
    startSize: new ConstantValue(radius * 2),
    startColor: new ConstantColor(WHITE),
    worldSpace: true,
    shape: new PointEmitter(),
    behaviors: [
      new ColorOverLife(new Gradient(
        [[v3(colorA, boost), 0], [v3(colorB), 1]],
        [[0, 0], [1, 0.15], [0.85, 0.7], [0, 1]],
      )),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.4, 1.05, 1, 1), 0]])),
      new RotationOverLife(new ConstantValue(spin)),
    ],
    renderMode: RenderMode.HorizontalBillBoard,
    material: spriteMat(getMagicCircleTexture()),
  });
}

/** Slow drifting twinkles that rise and wander — glitter, magic motes, fireflies. Looping; the wandering comes from Noise, without which motes travel in dead-straight lines. */
export function motePreset({
  colorA, colorB = colorA, radius = 1, count = 14, riseY = 0.5, size = 0.16, life = 2.2,
  turbulence = 0.35, texture = getStarTexture(), boost = 2.0, whiteHot = 0.3, spin = 1.5,
  // Physical motes (leaves, petals, snow, dust) must be NORMAL-blended: they're
  // objects, not light, and an additive leaf is invisible over a sunlit path.
  // Glowing motes stay additive but need a high `boost` for the same reason —
  // adding 0.3 to an already-bright background changes nothing, adding 3 reads
  // as a spark in broad daylight.
  additive = true, peak = 1,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * 0.6, life * 1.4),
    startSpeed: new IntervalValue(0, 0.15),
    startSize: new IntervalValue(size * 0.4, size * 1.5),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    shape: new SphereEmitter({ radius, thickness: 1, arc: Math.PI * 2 }),
    behaviors: [
      // Twinkle: alpha rides up and back down mid-life so motes wink in and
      // out at different times instead of the whole field pulsing together
      // (each particle is at a different point in its own life).
      new ColorOverLife(new Gradient(
        additive
          ? [[v3(lighten(colorA, whiteHot), boost), 0], [v3(colorA, boost * 0.7), 0.35], [v3(colorB), 1]]
          : [[v3(colorA), 0], [v3(colorB), 1]],
        [[0, 0], [peak, 0.25], [peak * 0.6, 0.6], [0, 1]],
      )),
      new SizeOverLife(growShrinkCurve()),
      new RotationOverLife(new IntervalValue(-spin, spin)),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
      ...(turbulence ? [new Noise(new ConstantValue(0.45), new ConstantValue(turbulence))] : []),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(texture, additive ? THREE.AdditiveBlending : THREE.NormalBlending),
  });
}

/** A steady column/shaft of light — holy beams, portals, light wells. Vertical billboards stacked up the anchor's Y axis. */
export function beamPreset({
  colorA, colorB = colorA, height = 4, width = 0.8, count = 10, life = 0.7, boost = 1.6, whiteHot = 0.3, riseY = 2,
  peak = 0.3,
} = {}) {
  return new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * 0.7, life * 1.3),
    startSpeed: new ConstantValue(0),
    startSize: new Vector3Function(new ConstantValue(width), new ConstantValue(height), new ConstantValue(1)),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count)),
    // SphereEmitter, not CircleEmitter: quarks' circle/donut emitters lay
    // their ring in the XY plane (z=0), i.e. standing UPRIGHT in this game's
    // Y-up world — a beam's base spread has to be horizontal, and a small
    // filled sphere gives that without fighting the emitter's orientation
    // (rotating the emitter would rotate ForceOverLife's local +Y rise with it).
    shape: new SphereEmitter({ radius: width * 0.3, thickness: 1, arc: Math.PI * 2 }),
    behaviors: [
      // peak, not 1: a beam is a STACK of overlapping quads (count of them
      // alive at once), so each one has to be faint or the pile blows out to
      // pure white and takes the whole screen's exposure with it.
      new ColorOverLife(hotGradient(colorA, colorB, { boost, whiteHot, hold: 0.25, peak })),
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.7, 1, 1, 0.6), 0]])),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(riseY), new ConstantValue(0)),
    ],
    renderMode: RenderMode.VerticalBillBoard,
    material: spriteMat(getBeamTexture()),
  });
}

/**
 * Rising fire. Two nested flame layers plus embers and heat-smoke — the
 * world-effect campfires/torches/braziers are all built from this.
 *
 * The first version of this was one layer of flame sprites tinted through a
 * white-hot gradient, and it did not read as fire at all. Three reasons, and
 * the fixes are the shape of the code below:
 *
 * 1. **Fire is a vertical colour ramp, not a per-particle one.** A real flame
 *    is yellow-white where it's fed and deep red where it's dying, so the
 *    colour has to travel with a particle as it rises — which means life and
 *    rise speed do the work, and the gradient must run
 *    pale-yellow → colorA → colorB with almost no white lift (white kills the
 *    hue that makes it fire).
 * 2. **It needs an inner core.** One layer can only ever be a flat sheet of
 *    tinted sprites. A small, short-lived, brighter inner layer inside a
 *    bigger, cooler, slower outer one is what gives a flame depth.
 * 3. **Flames shrink as they rise, and they don't fly.** startSpeed near zero
 *    with an upward force accelerates them the way heat does, and a size curve
 *    that tapers to nothing turns each sprite into a lick instead of a blob.
 *    Turbulence stays low — high noise reads as sparks in a wind tunnel.
 */
export function firePreset({
  colorA = vec4(0xffd27a), colorB = vec4(0xff2b00), radius = 0.35, height = 1.6, count = 26,
  size = 0.55, smoke = true, embers = true, life = 0.7,
} = {}) {
  /** @param {{scale:number, bright:number, lifeMul:number, countMul:number, riseMul:number, turbulence:number, hot:number, solid?:boolean}} cfg */
  const flameLayer = ({ scale, bright, lifeMul, countMul, riseMul, turbulence, hot, solid = false }) => new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(life * lifeMul * 0.65, life * lifeMul * 1.25),
    // Barely any initial speed: the upward ForceOverLife is what accelerates a
    // lick, so it starts slow and dense at the base and stretches as it climbs.
    startSpeed: new IntervalValue(0.05, 0.3),
    // TALLER THAN WIDE. A scalar startSize gives a square quad, which squashes
    // the flame sprite (128x192) back to 1:1 — the licks came out as stubby
    // blobs no matter how good the sprite was. 1.7:1 restores the plume.
    startSize: new Vector3Function(
      new IntervalValue(size * scale * 0.6, size * scale * 1.15),
      new IntervalValue(size * scale * 1.0, size * scale * 1.95),
      new ConstantValue(1),
    ),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count * countMul)),
    shape: new SphereEmitter({ radius: radius * scale, thickness: 1, arc: Math.PI * 2 }), // see beamPreset for why not CircleEmitter
    behaviors: [
      // A solid body layer is NOT boosted into HDR and not whitened: its job is
      // to be the flame's opaque, correctly-coloured shape against whatever is
      // behind it. The additive layers do the glowing.
      new ColorOverLife(solid
        // The body starts at a SATURATED colour (colorA pulled 45% toward
        // colorB), not at the authored pale yellow. A pale-yellow opaque flame
        // over a sunlit stone path is still invisible — being opaque doesn't
        // help if the colour matches the background. The pale hot yellow now
        // only appears in the small additive inner layer, which is where a real
        // fire's near-white is anyway.
        ? hotGradient(mixColor(colorA, colorB, 0.45), colorB, { boost: 1, whiteHot: 0, hold: 0.3, peak: 1 })
        : hotGradient(lighten(colorA, hot), colorB, { boost: bright, whiteHot: 0.08, hold: 0.12 })),
      // Grow briefly, then taper to a point — a flame lick, not a fading ball.
      new SizeOverLife(new PiecewiseBezier([[new Bezier(0.55, 1, 0.7, 0), 0]])),
      // ForceOverLife is an ACCELERATION, not a speed — so a lick only travels
      // 0.5*a*t² in its lifetime. Passing `height` straight in (2.2 for a
      // campfire, over a 0.7s life) moved each lick barely half a metre, and
      // the fire came out as a wide flat puddle instead of a column. Solve for
      // the acceleration that actually covers `height` metres within THIS
      // layer's own lifetime, so the parameter means what it says.
      new ForceOverLife(
        new ConstantValue(0),
        new ConstantValue((2 * height * riseMul) / (life * lifeMul) ** 2),
        new ConstantValue(0),
      ),
      new Noise(new ConstantValue(1.1), new ConstantValue(turbulence)),
    ],
    renderMode: RenderMode.BillBoard,
    material: solid
      ? spriteMat(getFlameBodyTexture(), THREE.NormalBlending)
      : spriteMat(getFlameTexture()),
  });
  // The hot heart of the fire: a few big, soft, stationary glows sitting at the
  // base. Individual licks always leave dark gaps between them — which is what
  // kept a cluster reading as "several flame sprites" rather than one fire —
  // and no amount of extra licks fills those gaps as cheaply as a glow behind
  // them does. This is also what makes the base the brightest part, which is
  // where a real fire's light comes from.
  const coreGlow = new ParticleSystem({
    duration: 1,
    looping: true,
    startLife: new IntervalValue(0.35, 0.7),
    startSpeed: new ConstantValue(0),
    startSize: new IntervalValue(size * 1.0, size * 1.7),
    startColor: new ConstantColor(WHITE),
    worldSpace: false,
    emissionOverTime: new ConstantValue(emitCount(count * 0.12)),
    shape: new SphereEmitter({ radius: radius * 0.6, thickness: 1, arc: Math.PI * 2 }),
    behaviors: [
      // Kept deliberately dim: over a bright surface (a sunlit stone path) a
      // strong additive glow saturates straight to white and swallows the
      // flame body's colour — the fire turned into a pale smudge on the ground
      // while the same effect against a darker building read fine.
      new ColorOverLife(hotGradient(lighten(colorA, 0.2), colorB, { boost: 1.7, whiteHot: 0.05, hold: 0.2, peak: 0.3 })),
      new SizeOverLife(growShrinkCurve()),
      new ForceOverLife(new ConstantValue(0), new ConstantValue(height * 0.4), new ConstantValue(0)),
    ],
    renderMode: RenderMode.BillBoard,
    material: spriteMat(getSoftDotTexture()),
  });
  coreGlow.emitter.position.y = size * 0.35;
  return layers(
    coreGlow,
    // Body: normal-blended and opaque, so the fire has a shape and a colour
    // against a sunlit path or a bright sky. Everything else here is additive,
    // and additive alone is invisible in daylight — a campfire that read
    // perfectly against a night sky was a faint white smudge in the actual
    // game world, and disappeared completely once raised against the sky.
    flameLayer({ scale: 0.95, bright: 1, lifeMul: 0.95, countMul: 0.62, riseMul: 0.85, turbulence: 0.5, hot: 0, solid: true }),
    // Outer: bigger, cooler, slower, lives longest — the glow around the body.
    flameLayer({ scale: 1, bright: 1.7, lifeMul: 1, countMul: 0.62, riseMul: 0.85, turbulence: 0.5, hot: 0 }),
    // Inner: small, bright, short-lived, and it stays LOW — the hottest part of
    // a fire is the part being fed, not the part that has risen away from it.
    flameLayer({ scale: 0.52, bright: 2.6, lifeMul: 0.5, countMul: 0.5, riseMul: 0.55, turbulence: 0.35, hot: 0.3 }),
    embers ? motePreset({
      colorA: vec4(0xffcf7a), colorB: vec4(0xff5a1a), radius: radius * 1.2, count: Math.max(3, Math.round(count * 0.22)),
      // Clamped: embers scaled purely off `size` came out at 5-11cm for a
      // torch or a campfire, which is a pixel at gameplay distance — the guard
      // in check:vfx now fails on exactly this.
      riseY: height * 0.9, size: Math.max(0.15, size * 0.3), life: 1.6, turbulence: 0.8, whiteHot: 0.1,
      texture: getSoftDotTexture(),
    }) : null,
    smoke ? cloudPreset({
      colorA: vec4(0x4a4a4a), colorB: vec4(0x161616), radius: radius * 1.1, count: Math.max(2, Math.round(count * 0.16)),
      riseY: height * 0.8, size: size * 1.9, opacity: 0.2, life: 2.4, turbulence: 0.5,
    }) : null,
  );
}

// ---------------------------------------------------------------------------
// Composite recipes. These are what the PRESETS table is built from — one
// call produces the whole layered stack for a given element and scale.
// ---------------------------------------------------------------------------

/**
 * The standard impact stack: flash → core → sparks → shockwave → smoke →
 * (optionally) debris, plus a light pop. `scale` is a single dial for "how
 * big a hit is this" and multiplies every layer's size/speed/count coherently.
 */
function impactFx({
  colorA, colorB = colorA, scale = 1, light = 0xffffff, smoke = 0.6, debris = 0, wave = true,
  sparks = 1, count = 1, debrisColor = vec4(0x6b6259),
} = {}) {
  return withLight(layers(
    flashPreset({ colorA, colorB, size: 1.5 * scale, life: 0.16 }),
    burstPreset({ colorA, colorB, count: Math.round(18 * count), size: 0.26 * scale, speed: 4.5 * scale, life: 0.5 }),
    sparks ? sparkPreset({
      colorA, colorB, count: Math.round(14 * sparks), speed: 10 * scale, life: 0.45,
      length: 0.35 * scale, width: 0.07 * scale,
    }) : null,
    wave ? shockwavePreset({ colorA, colorB, radius: 1.6 * scale, life: 0.32, vertical: true }) : null,
    smoke ? smokePreset({
      count: Math.round(6 * smoke), size: 0.6 * scale, life: 0.9, riseY: 0.9,
      spread: 0.8 * scale, delay: 0.05, opacity: 0.4 * smoke,
    }) : null,
    // Rubble is grey-brown, NOT the element's colour. Tinting chips with the
    // spell's own hue turned a fire impact into a scatter of saturated red
    // flecks that read as confetti sitting on top of the effect.
    debris ? debrisPreset({ colorA: debrisColor, colorB: vec4(0x2e2a26), count: Math.round(8 * debris), size: 0.14 * scale, speed: 5 * scale }) : null,
  ), { color: light, intensity: 6 * scale, distance: 8 * scale, life: 0.22 });
}

/** A ground-centred AoE: rune flash, expanding shockwave + ring, an upward burst of sparks, and dust kicked outward. */
function novaFx({ colorA, colorB = colorA, radius = 2.2, light = 0xffffff, dust = true, life = 0.7 } = {}) {
  return withLight(layers(
    flashPreset({ colorA, colorB, size: radius * 0.7, life: 0.2 }),
    shockwavePreset({ colorA, colorB, radius, life: life * 0.75 }),
    ringPreset({ colorA, colorB, radius: radius * 1.05, life }),
    burstPreset({ colorA, colorB, count: 26, size: 0.3, speed: radius * 1.4, life: life * 0.8, gravityY: 1 }),
    sparkPreset({ colorA, colorB, count: 20, speed: radius * 3, life: life * 0.7, length: 0.4, width: 0.07, coneAngle: 1.2 }),
    dust ? smokePreset({ count: 8, size: radius * 0.35, life: 1.2, riseY: 0.5, spread: radius * 0.8, opacity: 0.35, delay: 0.04 }) : null,
  ), { color: light, intensity: 8, distance: radius * 3, life: 0.3 });
}

/** A held/looping caster effect: ground rune, orbiting motes, and a rising glow — for casts, buffs and channelled auras. */
function castFx({ colorA, colorB = colorA, radius = 0.9, circle = true, beam = false, count = 16 } = {}) {
  return withLight(layers(
    circle ? magicCirclePreset({ colorA, colorB, radius: radius * 1.4, life: 1.4 }) : null,
    auraPreset({ colorA, colorB, radius, count }),
    motePreset({ colorA, colorB, radius: radius * 1.2, count: Math.round(count * 0.5), riseY: 0.8, size: 0.14 }),
    beam ? beamPreset({ colorA, colorB, height: 3.2, width: 0.7, count: 8 }) : null,
  ), { color: colorA ? new THREE.Color(colorA.x, colorA.y, colorA.z).getHex() : 0xffffff, intensity: 2.2, distance: 6, persistent: true });
}

/** A projectile's in-flight body: a bright core, a turbulent stream trailing behind it, and embers falling away. */
function projectileFx({ colorA, colorB = colorA, scale = 1, embers = true, smoke = false } = {}) {
  return withLight(layers(
    streamPreset({ colorA, colorB, count: 45, speed: 1.2, angle: 0.5, life: 0.35, size: 0.34 * scale, turbulence: 0.5 }),
    streamPreset({ colorA: lighten(colorA, 0.55), colorB: colorA, count: 24, speed: 0.4, angle: 0.2, life: 0.22, size: 0.2 * scale, boost: 2.6, whiteHot: 0.2 }),
    embers ? motePreset({ colorA, colorB, radius: 0.2 * scale, count: 10, riseY: -0.6, size: 0.1 * scale, life: 0.6, turbulence: 0.9, texture: getSoftDotTexture() }) : null,
    smoke ? cloudPreset({ colorA: vec4(0x666666), colorB: vec4(0x222222), radius: 0.18 * scale, count: 6, riseY: 0.2, size: 0.4 * scale, opacity: 0.25, life: 0.8 }) : null,
  ), { color: colorA ? new THREE.Color(colorA.x, colorA.y, colorA.z).getHex() : 0xffffff, intensity: 3, distance: 7, persistent: true });
}

/** A melee swing: the crescent arc, a spray of sparks along it, and a small flash at the contact point. */
function slashFx({ colorA, colorB = colorA, scale = 1, spark = 1 } = {}) {
  return layers(
    slashPreset({ colorA, colorB, size: 2.2 * scale, life: 0.26 }),
    slashPreset({ colorA: lighten(colorA, 0.55), colorB: colorA, size: 1.7 * scale, life: 0.18, delay: 0.03, boost: 3, whiteHot: 0.3 }),
    spark ? sparkPreset({ colorA, colorB, count: Math.round(12 * spark), speed: 8 * scale, life: 0.35, length: 0.4 * scale, width: 0.06 }) : null,
    flashPreset({ colorA, colorB, size: 0.9 * scale, life: 0.14 }),
  );
}

/** Something raining down over an area, then popping where it lands. */
function stormFx({ colorA, colorB = colorA, count = 20, radius = 2.5, dropSpeed = 10, texture = getShardTexture(), impacts = true }) {
  return layers(
    fallStreakPreset({ colorA, colorB, count, spreadRadius: radius, dropSpeed, texture, length: 0.7, width: 0.16 }),
    impacts ? burstPreset({ colorA, colorB, count: Math.round(count * 0.6), size: 0.28, speed: 2.5, life: 0.4, delay: 0.35 }) : null,
    impacts ? sparkPreset({ colorA, colorB, count: Math.round(count * 0.5), speed: 5, life: 0.4, delay: 0.4, length: 0.3, width: 0.06 }) : null,
  );
}

const FIRE_A = vec4(0xffcc55);
const FIRE_B = vec4(0xff3300);
const FROST_A = vec4(0xd0f2ff);
const FROST_B = vec4(0x3ea8ff);
const POISON_A = vec4(0x9dff5c);
const POISON_B = vec4(0x2f6e1f);
const HOLY_A = vec4(0xfff6c9);
const HOLY_B = vec4(0xffd34d);
const ARCANE_A = vec4(0xd9b3ff);
const ARCANE_B = vec4(0x8a2be2);
const PHYSICAL_A = vec4(0xffffff);
const PHYSICAL_B = vec4(0xcfcfcf);
const HEAL_A = vec4(0xbfffcf);
const HEAL_B = vec4(0x4bd97a);
const SHIELD_A = vec4(0xbfe0ff);
const SHIELD_B = vec4(0x5b9bd5);
const TAUNT_A = vec4(0xffe066);
const TAUNT_B = vec4(0xff9900);
const CC_A = vec4(0xffffff);
const DARK_A = vec4(0x7a5f8f);
const DARK_B = vec4(0x3d2a55);
const ELECTRIC_A = vec4(0xe0f7ff);
const ELECTRIC_B = vec4(0x4fc3ff);
const BLOOD_A = vec4(0xcc3333);
const BLOOD_B = vec4(0x5c0d0d);
const EARTH_A = vec4(0xc9a35c);
const EARTH_B = vec4(0x6b4423);
const SAND_A = vec4(0xe8d9a0);
const SAND_B = vec4(0xb8935a);
const VOID_A = vec4(0xb388ff);
const VOID_B = vec4(0x1a0033);
const LIFE_DRAIN_A = vec4(0x8fbf6f);
const LIFE_DRAIN_B = vec4(0x3d1f4a);
const PLAGUE_A = vec4(0xa8d94f);
const PLAGUE_B = vec4(0x2e3d1a);
const SMOKE_A = vec4(0xaaaaaa);
const SMOKE_B = vec4(0x222222);
const CORRUPTION_A = vec4(0x6fbf4f);
const CORRUPTION_B = vec4(0x1a2e0d);
const WIND_A = vec4(0xe0ffe0);
const WIND_B = vec4(0x8fd98f);
const STAR_A = vec4(0xfff6d9);
const STAR_B = vec4(0xffe066);
const WEB_A = vec4(0xf0f0f0);
const WEB_B = vec4(0xb0b0b0);
const DUST_A = vec4(0xcdbfa0);
const DUST_B = vec4(0x9c8a68);

// The catalog every skill's vfx.* fields (castVfxId / travelVfxId /
// impactVfxId) and the Skill Builder's picker choose from. Every id that
// existed before the 2026-07-26 overhaul is still here — only what each one
// BUILDS changed, so no authored data needed migrating.
export const PRESETS = {
  'sword-slash': () => slashFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B }),
  'impact-physical': () => impactFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, scale: 0.85, light: 0xdddddd, debris: 0.5 }),
  'impact-fire': () => impactFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 1.15, light: 0xff6622, smoke: 1, sparks: 1.4 }),
  'impact-frost': () => impactFx({ colorA: FROST_A, colorB: FROST_B, scale: 1, light: 0x66c8ff, smoke: 0.3, debris: 0.8 }),
  'impact-holy': () => impactFx({ colorA: HOLY_A, colorB: HOLY_B, scale: 1.1, light: 0xffd966, smoke: 0, sparks: 1.4 }),
  'firebolt-trail': () => projectileFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 0.9, smoke: true }),
  'frost-spear-trail': () => projectileFx({ colorA: FROST_A, colorB: FROST_B, scale: 0.85 }),
  'arrow-trail': () => shardPreset({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 3, speed: 16, life: 0.6, coneAngle: 0.06, texture: getArrowTexture(), length: 0.5, width: 0.12 }),
  'holy-beam': () => withLight(layers(
    beamPreset({ colorA: HOLY_A, colorB: HOLY_B, height: 4.5, width: 1.1, count: 8 }),
    motePreset({ colorA: HOLY_A, colorB: HOLY_B, radius: 0.7, count: 14, riseY: 1.4, size: 0.16 }),
  ), { color: 0xffe9a8, intensity: 4, distance: 9, persistent: true }),
  'frost-nova-ring': () => novaFx({ colorA: FROST_A, colorB: FROST_B, radius: 2.4, light: 0x8ad4ff, dust: false }),
  'fire-ring': () => novaFx({ colorA: FIRE_A, colorB: FIRE_B, radius: 1.9, light: 0xff7733 }),
  'taunt-ring': () => novaFx({ colorA: TAUNT_A, colorB: TAUNT_B, radius: 1.2, light: 0xffb833, dust: false, life: 0.5 }),
  'poison-cloud': () => layers(
    cloudPreset({ colorA: POISON_A, colorB: POISON_B, radius: 1.2, count: 10, riseY: 0.35, size: 1.1, opacity: 0.4 }),
    motePreset({ colorA: POISON_A, colorB: POISON_B, radius: 1.2, count: 8, riseY: 0.5, size: 0.13, texture: getSoftDotTexture() }),
  ),
  'firewall': () => withLight(layers(
    wallPreset({ colorA: FIRE_A, colorB: FIRE_B, width: 3, riseY: 2, count: 30 }),
    cloudPreset({ colorA: vec4(0x4a4a4a), colorB: vec4(0x141414), radius: 1.5, count: 6, riseY: 1.4, size: 1.2, opacity: 0.25 }),
  ), { color: 0xff6a22, intensity: 5, distance: 10, persistent: true }),
  'tornado': () => layers(
    vortexPreset({ colorA: WIND_A, colorB: WIND_B, radius: 1.8, height: 3.5, count: 40, orbitSpeed: 7, life: 1.4 }),
    vortexPreset({ colorA: DUST_A, colorB: DUST_B, radius: 2.4, height: 2.2, count: 26, orbitSpeed: 5, life: 1.6, size: 0.9, additive: false, opacity: 0.35, texture: getSmokeTexture() }),
  ),
  'meteor-fall': () => stormFx({ colorA: FIRE_A, colorB: FIRE_B, count: 24, radius: 1.6, dropSpeed: 11, texture: getWispTexture() }),
  'rain-of-arrows': () => stormFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 18, radius: 3, dropSpeed: 13, texture: getArrowTexture() }),
  'dust-puff': () => layers(
    smokePreset({ colorA: DUST_A, colorB: DUST_B, count: 8, size: 0.55, life: 0.7, riseY: 0.4, spread: 1.4, opacity: 0.5 }),
    burstPreset({ colorA: DUST_A, colorB: DUST_B, count: 8, size: 0.2, speed: 1.6, life: 0.45, gravityY: -1.5, boost: 1 }),
  ),
  'charge-trail': () => layers(
    streamPreset({ colorA: DUST_A, colorB: DUST_B, count: 22, speed: 1.5, angle: 0.35, life: 0.35, size: 0.3, boost: 1.1 }),
    cloudPreset({ colorA: DUST_A, colorB: DUST_B, radius: 0.3, count: 8, riseY: 0.4, size: 0.6, opacity: 0.4, life: 0.8 }),
  ),
  'whirlwind': () => layers(
    vortexPreset({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, radius: 1, height: 1.8, count: 30, orbitSpeed: 15, life: 0.6, texture: getWispTexture() }),
    vortexPreset({ colorA: DUST_A, colorB: DUST_B, radius: 1.3, height: 1, count: 16, orbitSpeed: 12, life: 0.8, size: 0.7, additive: false, opacity: 0.3, texture: getSmokeTexture() }),
  ),
  'heal-sparkle': () => withLight(layers(
    sparkleBurstPreset({ colorA: HEAL_A, colorB: HEAL_B, count: 12, size: 0.35, life: 0.9, texture: getStarTexture() }),
    motePreset({ colorA: HEAL_A, colorB: HEAL_B, radius: 0.6, count: 12, riseY: 1.4, size: 0.15, life: 1.1 }),
    ringPreset({ colorA: HEAL_A, colorB: HEAL_B, radius: 0.9, life: 0.6 }),
  ), { color: 0x7df3a4, intensity: 4, distance: 6, life: 0.4 }),
  'renew-aura': () => castFx({ colorA: HEAL_A, colorB: HEAL_B, radius: 0.8, circle: false, count: 14 }),
  'shield-bubble': () => castFx({ colorA: SHIELD_A, colorB: SHIELD_B, radius: 0.75, circle: false, count: 20 }),
  'arcane-shimmer': () => castFx({ colorA: ARCANE_A, colorB: ARCANE_B, radius: 0.85, count: 18 }),
  'armor-aura': () => castFx({ colorA: PHYSICAL_A, colorB: vec4(0x8899aa), radius: 0.75, circle: false, count: 12 }),
  'stun-stars': () => sparkleBurstPreset({ colorA: CC_A, colorB: TAUNT_A, count: 6, size: 0.4, speed: 0.4, life: 1.2, texture: getStarTexture() }),
  'sleep-zzz': () => motePreset({ colorA: vec4(0xaad4ff), colorB: vec4(0x6f9fd8), radius: 0.25, count: 4, riseY: 0.6, size: 0.22, life: 1.8 }),
  'freeze-sparkle': () => layers(
    sparkleBurstPreset({ colorA: FROST_A, colorB: FROST_B, count: 10, size: 0.3, speed: 0.3, life: 1, texture: getStarTexture() }),
    shardPreset({ colorA: FROST_A, colorB: FROST_B, count: 8, speed: 1.2, life: 0.9, length: 0.5, width: 0.14 }),
  ),
  'execute-slash': () => slashFx({ colorA: vec4(0xff5555), colorB: vec4(0x880000), scale: 1.4, spark: 1.6 }),
  'taunt-mark': () => sparkleBurstPreset({ colorA: TAUNT_A, colorB: TAUNT_B, count: 5, size: 0.5, speed: 0, life: 0.8, texture: getStarTexture() }),
  'multishot-fan': () => shardPreset({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 7, speed: 14, life: 0.5, coneAngle: 0.5, texture: getArrowTexture(), length: 0.5, width: 0.12 }),
  'evasive-roll': () => layers(
    smokePreset({ colorA: DUST_A, colorB: DUST_B, count: 7, size: 0.5, life: 0.6, riseY: 0.3, spread: 1.2, opacity: 0.45 }),
  ),
  'dark-burst': () => impactFx({ colorA: DARK_A, colorB: DARK_B, scale: 1, light: 0x8855bb, smoke: 1.2 }),

  // --- Aliases matching the exact vfx.* ids authored in skills/skill-defs.json ---
  // (skill-defs.json was authored with self-descriptive per-skill names before
  // this preset library's own naming settled; rather than rewrite 25 hand-picked
  // data entries, these aliases point them at the equivalent recipe.)
  'impact-burst': () => impactFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, scale: 0.85, light: 0xdddddd, debris: 0.5 }),
  'buff-aura': () => castFx({ colorA: vec4(0xfff2b0), colorB: vec4(0xd9a441), radius: 0.8, count: 16 }),
  'sword-slash-arc': () => slashFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B }),
  'charge-dust-trail': () => PRESETS['charge-trail'](),
  'whirlwind-spin-blur': () => PRESETS['whirlwind'](),
  'execute-critical-slash': () => slashFx({ colorA: vec4(0xff5555), colorB: vec4(0x880000), scale: 1.4, spark: 1.6 }),
  'fire-impact': () => impactFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 1.15, light: 0xff6622, smoke: 1, sparks: 1.4 }),
  'firebolt-projectile': () => projectileFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 0.9, smoke: true }),
  'fireball-projectile': () => projectileFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 1.35, smoke: true }),
  'arcane-shield-shimmer': () => castFx({ colorA: ARCANE_A, colorB: ARCANE_B, radius: 0.85, count: 18 }),
  'meteor-crater-burst': () => impactFx({ colorA: FIRE_A, colorB: FIRE_B, scale: 1.9, light: 0xff5511, smoke: 1.5, debris: 0.8, debrisColor: vec4(0x4a3b30) }),
  'arrow-projectile': () => shardPreset({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 3, speed: 16, life: 0.6, coneAngle: 0.06, texture: getArrowTexture(), length: 0.5, width: 0.12 }),
  'multi-shot-arrow-fan': () => shardPreset({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 7, speed: 14, life: 0.5, coneAngle: 0.5, texture: getArrowTexture(), length: 0.5, width: 0.12 }),
  'evasive-roll-dust-puff': () => PRESETS['dust-puff'](),
  'rain-of-arrows-fall': () => stormFx({ colorA: PHYSICAL_A, colorB: PHYSICAL_B, count: 18, radius: 3, dropSpeed: 13, texture: getArrowTexture() }),
  'renew-glow': () => castFx({ colorA: HEAL_A, colorB: HEAL_B, radius: 0.8, circle: false, count: 14 }),
  'holy-smite-beam': () => PRESETS['holy-beam'](),

  // --- Common RPG spell archetypes (icicles/lightning/blood/earth/sand/void/plague/...) ---
  'icicle-burst': () => layers(
    shardPreset({ colorA: FROST_A, colorB: FROST_B, count: 16, speed: 7, life: 0.45, texture: getShardTexture(), length: 0.6, width: 0.17 }),
    flashPreset({ colorA: FROST_A, colorB: FROST_B, size: 1.4, life: 0.16 }),
    burstPreset({ colorA: FROST_A, colorB: FROST_B, count: 14, size: 0.2, speed: 3, life: 0.4 }),
  ),
  'icicle-storm': () => stormFx({ colorA: FROST_A, colorB: FROST_B, count: 26, radius: 2.2, dropSpeed: 11, texture: getShardTexture() }),
  'lightning-strike': () => withLight(layers(
    boltPreset({ colorA: ELECTRIC_A, colorB: ELECTRIC_B, count: 5, length: 3.4, width: 0.42, life: 0.28, flashSize: 1.3 }),
    shockwavePreset({ colorA: ELECTRIC_A, colorB: ELECTRIC_B, radius: 1.6, life: 0.35 }),
  ), { color: 0x9fe4ff, intensity: 14, distance: 16, life: 0.18 }),
  'chain-lightning': () => withLight(
    boltPreset({ colorA: ELECTRIC_A, colorB: ELECTRIC_B, count: 3, length: 2, width: 0.3, life: 0.22, flashSize: 0.8 }),
    { color: 0x9fe4ff, intensity: 8, distance: 10, life: 0.16 },
  ),
  'thunderclap': () => withLight(layers(
    boltPreset({ colorA: ELECTRIC_A, colorB: ELECTRIC_B, count: 6, length: 2.4, width: 0.42, life: 0.3, flashSize: 1.4 }),
    novaFx({ colorA: ELECTRIC_A, colorB: ELECTRIC_B, radius: 3, light: 0x9fe4ff, dust: true, life: 0.5 }),
  ), { color: 0xcdefff, intensity: 16, distance: 20, life: 0.22 }),
  'blood-splatter': () => layers(
    burstPreset({ colorA: BLOOD_A, colorB: BLOOD_B, count: 18, size: 0.2, speed: 3.5, life: 0.5, gravityY: -8, boost: 1.1 }),
    sparkPreset({ colorA: BLOOD_A, colorB: BLOOD_B, count: 12, speed: 6, life: 0.5, gravityY: -10, length: 0.28, width: 0.08, boost: 1.2 }),
  ),
  'earthquake-shock': () => layers(
    novaFx({ colorA: EARTH_A, colorB: EARTH_B, radius: 3.4, light: 0xc9a35c, life: 1 }),
    debrisPreset({ colorA: EARTH_A, colorB: EARTH_B, count: 20, size: 0.28, speed: 7, life: 1.2 }),
  ),
  'sandstorm': () => layers(
    cloudPreset({ colorA: SAND_A, colorB: SAND_B, radius: 2, count: 18, riseY: 0.25, size: 1.6, opacity: 0.4, turbulence: 1.1 }),
    vortexPreset({ colorA: SAND_A, colorB: SAND_B, radius: 2.2, height: 1.2, count: 18, orbitSpeed: 4, life: 1.8, additive: false, opacity: 0.3, texture: getSmokeTexture() }),
  ),
  'blizzard-storm': () => layers(
    cloudPreset({ colorA: FROST_A, colorB: FROST_B, radius: 2.2, count: 14, riseY: 0.35, size: 1.4, opacity: 0.28 }),
    motePreset({ colorA: FROST_A, colorB: vec4(0xffffff), radius: 2.4, count: 26, riseY: -1.6, size: 0.14, turbulence: 0.9 }),
  ),
  'meteor-shower': () => stormFx({ colorA: FIRE_A, colorB: FIRE_B, count: 30, radius: 3, dropSpeed: 12, texture: getWispTexture() }),
  'void-implosion': () => withLight(layers(
    // An implosion has to move INWARD: motes pulled toward the centre with
    // negative rise, then a single dark flash when they meet.
    motePreset({ colorA: VOID_A, colorB: VOID_B, radius: 2.2, count: 30, riseY: -0.2, size: 0.2, life: 0.7, turbulence: 1.2 }),
    flashPreset({ colorA: VOID_A, colorB: VOID_B, size: 2.4, life: 0.3, delay: 0.35, boost: 3 }),
    burstPreset({ colorA: VOID_A, colorB: VOID_B, count: 22, size: 0.3, speed: 5, life: 0.5, delay: 0.4 }),
  ), { color: 0xa070ff, intensity: 7, distance: 10, life: 0.4 }),
  'life-drain-beam': () => withLight(layers(
    streamPreset({ colorA: LIFE_DRAIN_A, colorB: LIFE_DRAIN_B, count: 34, speed: 1.4, angle: 0.22, life: 0.5, size: 0.24, turbulence: 0.6 }),
    motePreset({ colorA: LIFE_DRAIN_A, colorB: LIFE_DRAIN_B, radius: 0.5, count: 10, riseY: 0.4, size: 0.13 }),
  ), { color: 0x9fd07a, intensity: 2.5, distance: 6, persistent: true }),
  'healing-rain': () => layers(
    fallPreset({ colorA: HEAL_A, colorB: HEAL_B, count: 20, spreadRadius: 1.8, dropSpeed: 3, size: 0.2 }),
    ringPreset({ colorA: HEAL_A, colorB: HEAL_B, radius: 1.5, life: 0.8 }),
    motePreset({ colorA: HEAL_A, colorB: HEAL_B, radius: 1.6, count: 10, riseY: 0.7, size: 0.13 }),
  ),
  'curse-mark': () => layers(
    magicCirclePreset({ colorA: VOID_A, colorB: VOID_B, radius: 1, life: 1.2, spin: -1.4 }),
    sparkleBurstPreset({ colorA: VOID_A, colorB: VOID_B, count: 6, size: 0.4, speed: 0.3, life: 0.9, texture: getStarTexture() }),
  ),
  'holy-nova': () => novaFx({ colorA: HOLY_A, colorB: HOLY_B, radius: 2.3, light: 0xffe9a8, dust: false }),
  'plague-swarm': () => layers(
    cloudPreset({ colorA: PLAGUE_A, colorB: PLAGUE_B, radius: 1.3, count: 12, riseY: 0.25, size: 1, opacity: 0.42, turbulence: 0.9 }),
    motePreset({ colorA: PLAGUE_A, colorB: PLAGUE_B, radius: 1.4, count: 14, riseY: 0.2, size: 0.1, turbulence: 1.4, texture: getSoftDotTexture() }),
  ),
  'frost-armor-shimmer': () => castFx({ colorA: FROST_A, colorB: FROST_B, radius: 0.7, circle: false, count: 14 }),
  'berserker-aura': () => castFx({ colorA: vec4(0xff6644), colorB: vec4(0x992200), radius: 0.8, count: 16 }),
  'smoke-bomb': () => layers(
    smokePreset({ colorA: SMOKE_A, colorB: SMOKE_B, count: 16, size: 1.1, life: 1.6, riseY: 0.7, spread: 2.2, opacity: 0.65, turbulence: 0.9 }),
    flashPreset({ colorA: vec4(0xffffff), colorB: SMOKE_A, size: 1.2, life: 0.12 }),
  ),
  'bleed-tick': () => burstPreset({ colorA: BLOOD_A, colorB: BLOOD_B, count: 8, size: 0.15, speed: 1.4, life: 0.35, gravityY: -6, boost: 1.1 }),
  'mana-surge': () => layers(
    burstPreset({ colorA: ARCANE_A, colorB: ARCANE_B, count: 20, size: 0.24, speed: 3, life: 0.5 }),
    motePreset({ colorA: ARCANE_A, colorB: ARCANE_B, radius: 0.7, count: 12, riseY: 1.6, size: 0.15, life: 0.9 }),
  ),
  'thorn-burst': () => layers(
    shardPreset({ colorA: vec4(0x8fbf4f), colorB: vec4(0x4a3018), count: 12, speed: 5, life: 0.45, length: 0.45, width: 0.13, boost: 1.4 }),
    burstPreset({ colorA: vec4(0x8fbf4f), colorB: vec4(0x4a3018), count: 10, size: 0.2, speed: 2, life: 0.4, boost: 1.3 }),
  ),
  'web-trap': () => layers(
    ringPreset({ colorA: WEB_A, colorB: WEB_B, radius: 1.4, life: 0.9, boost: 1.4 }),
    burstPreset({ colorA: WEB_A, colorB: WEB_B, count: 16, size: 0.24, speed: 3, life: 0.7, boost: 1.2 }),
  ),
  'summon-portal': () => withLight(layers(
    magicCirclePreset({ colorA: VOID_A, colorB: ARCANE_A, radius: 1.5, life: 1.6, spin: 0.9 }),
    vortexPreset({ colorA: VOID_A, colorB: VOID_B, radius: 1.4, height: 2.2, count: 30, orbitSpeed: 9, life: 1.2 }),
    beamPreset({ colorA: ARCANE_A, colorB: VOID_B, height: 3, width: 1.6, count: 6 }),
    motePreset({ colorA: ARCANE_A, colorB: VOID_A, radius: 1.6, count: 16, riseY: 1.2, size: 0.16 }),
  ), { color: 0xa070ff, intensity: 4, distance: 10, persistent: true }),
  'divine-shield-aura': () => castFx({ colorA: HOLY_A, colorB: vec4(0xffffff), radius: 0.8, count: 18, circle: false }),
  'corruption-burst': () => impactFx({ colorA: CORRUPTION_A, colorB: CORRUPTION_B, scale: 1, light: 0x6fbf4f, smoke: 1 }),
  'wind-slash': () => slashFx({ colorA: WIND_A, colorB: WIND_B, scale: 1.1, spark: 0.5 }),
  'gravity-well': () => layers(
    magicCirclePreset({ colorA: VOID_A, colorB: VOID_B, radius: 1.8, life: 1.6, spin: -0.8 }),
    cloudPreset({ colorA: VOID_A, colorB: VOID_B, radius: 1.5, count: 14, riseY: -1.5, size: 1, opacity: 0.4 }),
    motePreset({ colorA: VOID_A, colorB: VOID_B, radius: 2, count: 16, riseY: -0.9, size: 0.14 }),
  ),
  'starfall': () => layers(
    stormFx({ colorA: STAR_A, colorB: STAR_B, count: 20, radius: 2.5, dropSpeed: 6, texture: getWispTexture() }),
    motePreset({ colorA: STAR_A, colorB: STAR_B, radius: 2.5, count: 12, riseY: -0.8, size: 0.18, life: 1.4 }),
  ),
};

export const PRESET_IDS = Object.keys(PRESETS);
