// scripts/check-vfx.mjs  (npm run check:vfx)
// Builds EVERY VFX in the catalog — hand-tuned skill presets
// (src/render/vfx/presets.js), placeable world effects
// (src/render/vfx/worldEffects.js) and one authored def per custom shape
// (src/sim/vfxDefs.js) — and asserts each one is a well-formed, actually
// visible three.quarks system.
//
// This exists because a VFX failure is silent. A preset that emits zero
// particles, references a behaviour the installed three.quarks doesn't have,
// or forgets autoDestroy on a one-shot doesn't throw where anyone will see it:
// it just quietly renders nothing, or leaks a system per cast for the rest of
// the session. Both are invisible in a screenshot of a working game.
//
// Like the project's other guards, this one self-tests its own matchers on
// startup (see SELF_TESTS) — a checker that has never been seen failing is
// not evidence of anything.
//
// three.quarks/quarks.core are devDependencies purely so this can run under
// plain Node; the browser still loads them from the importmap in the HTML.
import assert from 'node:assert';

// --- Minimal browser stubs -------------------------------------------------
// textures.js draws its sprites with the canvas 2D API at module scope, and
// THREE.CanvasTexture only ever reads width/height off the element. A no-op
// context is enough to let every drawing call through untouched.
function stubCanvas() {
  const gradient = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => gradient;
      if (prop === 'canvas') return null;
      return () => {};
    },
    set() { return true; },
  });
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`check-vfx canvas stub got unexpected element "${tag}"`);
      return { width: 0, height: 0, getContext: () => ctx, style: {} };
    },
  };
}
stubCanvas();

// Dynamic imports: the stub above must exist before any module that draws a
// texture at import time is evaluated, and static imports all hoist.
const { PRESETS } = await import('../src/render/vfx/presets.js');
const { WORLD_EFFECTS, WORLD_EFFECT_CATEGORIES } = await import('../src/render/vfx/worldEffects.js');
const { buildCustomVfxSystem } = await import('../src/render/vfx/custom.js');
const { VFX_SHAPES, VFX_TEXTURES, VFX_PARAM_SPECS, VFX_SHAPE_TEXTURES, defaultVfxParams, parseVfxDefs } = await import('../src/sim/vfxDefs.js');
const TEXTURES = await import('../src/render/vfx/textures.js');
const THREE = await import('three');

// --- Matchers --------------------------------------------------------------

const asArray = (b) => (Array.isArray(b) ? b : [b]);

/** Upper bound of a quarks value generator, for particle-budget estimation. */
function genMax(v) {
  if (!v) return 0;
  if (typeof v.value === 'number') return v.value;
  if (typeof v.b === 'number') return v.b;
  return 0;
}

/** Peak simultaneous particles a system can hold: a burst's total, or a looping emitter's rate x lifetime. */
function peakParticles(sys) {
  const burst = (sys.emissionBursts || []).reduce((n, b) => n + genMax(b.count) * (b.cycle || 1), 0);
  const rate = genMax(sys.emissionOverTime) * genMax(sys.startLife);
  return burst + rate;
}

const MAX_PARTICLES_PER_EFFECT = 900;
/**
 * A placed world effect whose particles are smaller than this is invisible in
 * practice — at a normal gameplay camera distance (8-15m) a 0.06-unit sprite
 * is one or two pixels. Most of the mote-based world effects shipped at
 * 0.07-0.22 and Dennis's report was exactly "barely visible". Skill VFX are
 * exempt: they're seen at melee range and legitimately use fine sparks.
 */
const MIN_WORLD_EFFECT_SIZE = 0.12;

/** Largest start size a system can emit, handling both scalar and per-axis (Vector3Function) sizes. */
function maxStartSize(sys) {
  const g = sys.startSize;
  if (!g) return 0;
  const scalar = genMax(g);
  if (scalar) return scalar;
  // Vector3Function keeps its per-axis generators; take the biggest axis.
  const axes = [g.x, g.y, g.z, ...(Array.isArray(g.functions) ? g.functions : [])];
  return Math.max(0, ...axes.map((a) => genMax(a)));
}

/**
 * @returns {string[]} problems found; empty means the effect is fine.
 */
function checkEffect(label, built, { minSize = 0 } = {}) {
  const problems = [];
  const systems = asArray(built).filter(Boolean);
  if (systems.length === 0) {
    problems.push(`${label}: built nothing`);
    return problems;
  }
  let total = 0;
  systems.forEach((sys, i) => {
    const at = `${label}[${i}]`;
    if (!sys || typeof sys !== 'object' || !sys.emitter) {
      problems.push(`${at}: not a ParticleSystem (no .emitter)`);
      return;
    }
    const emits = (sys.emissionBursts || []).length > 0 || genMax(sys.emissionOverTime) > 0;
    if (!emits) problems.push(`${at}: emits nothing (no bursts and emissionOverTime is 0) — it would render as an invisible no-op`);
    if (!sys.looping && !sys.autoDestroy) {
      problems.push(`${at}: one-shot system without autoDestroy — createVfxSystem only reaps systems that mark themselves for destroy, so this leaks one system per spawn`);
    }
    const mat = sys.material;
    if (!mat) problems.push(`${at}: no material`);
    else {
      if (!mat.map) problems.push(`${at}: material has no texture map — an untextured quad renders as a hard square`);
      if (mat.toneMapped !== false) {
        problems.push(`${at}: material.toneMapped is not false — the renderer's ACES curve would crush this effect's HDR core back below the bloom threshold (see presets.js's spriteMat)`);
      }
      if (mat.depthWrite !== false) problems.push(`${at}: material writes depth — transparent particles must not`);
    }
    if (minSize) {
      const size = maxStartSize(sys);
      if (size && size < minSize) {
        problems.push(`${at}: largest particle is ${size.toFixed(3)} units — under ${minSize}, which is a pixel or two at gameplay distance. This renders as "barely visible", not as an effect.`);
      }
    }
    total += peakParticles(sys);
  });
  if (total > MAX_PARTICLES_PER_EFFECT) {
    problems.push(`${label}: ~${Math.round(total)} peak particles across ${systems.length} layers, over the ${MAX_PARTICLES_PER_EFFECT} budget — a handful of these on screen at once will cost real frames`);
  }
  return problems;
}

/**
 * Sprite rules, learned the hard way (see textures.js's header). Both of these
 * produced the same visible artefact — a glowing SQUARE where a soft particle
 * should be — and neither is detectable from the JS side of a preset:
 * a sprite whose alpha is still non-zero at the quad border gets cut off flat,
 * and a mipmapped additive sprite averages to a uniform bright block when it's
 * small on screen. Both are guaranteed structurally by going through
 * makeSprite(), which is what `spriteSafe` records.
 *
 * The pixel-level edge check can't run here (the canvas is a stub with no
 * rasteriser) — that was verified in a browser once. What IS enforceable
 * headlessly is that no sprite bypasses the helper.
 */
function checkTexture(name, tex) {
  const problems = [];
  if (!tex || !tex.image) return [`texture ${name}: did not return a texture`];
  if (!tex.userData?.spriteSafe) {
    problems.push(`texture ${name}: not built via makeSprite() — no edge feather and no filter setup, so it can render as a hard-edged square`);
  }
  if (tex.generateMipmaps !== false) {
    problems.push(`texture ${name}: generateMipmaps is not false — mip levels average an additive sprite into a uniform bright square at distance`);
  }
  if (tex.minFilter !== THREE.LinearFilter) {
    problems.push(`texture ${name}: minFilter must be THREE.LinearFilter when mipmaps are off`);
  }
  return problems;
}

// --- Self-test: the matchers must reject known-bad input --------------------
const SELF_TESTS = [
  ['a system that emits nothing', { emitter: {}, looping: true, emissionBursts: [], emissionOverTime: { value: 0 }, material: { map: {}, toneMapped: false, depthWrite: false } }],
  ['a one-shot without autoDestroy', { emitter: {}, looping: false, autoDestroy: false, emissionBursts: [{ count: { value: 5 } }], material: { map: {}, toneMapped: false, depthWrite: false } }],
  ['a tone-mapped material', { emitter: {}, looping: true, emissionOverTime: { value: 10 }, startLife: { value: 1 }, material: { map: {}, toneMapped: true, depthWrite: false } }],
  ['an untextured material', { emitter: {}, looping: true, emissionOverTime: { value: 10 }, startLife: { value: 1 }, material: { toneMapped: false, depthWrite: false } }],
  ['a system over the particle budget', { emitter: {}, looping: true, emissionOverTime: { value: 5000 }, startLife: { value: 2 }, material: { map: {}, toneMapped: false, depthWrite: false } }],
  ['nothing at all', null],
];
SELF_TESTS.push(['a world effect with pixel-sized particles', { emitter: {}, looping: true, emissionOverTime: { value: 10 }, startLife: { value: 1 }, startSize: { value: 0.02 }, material: { map: {}, toneMapped: false, depthWrite: false } }]);
for (const [what, bad] of SELF_TESTS) {
  const problems = checkEffect('self-test', bad, { minSize: MIN_WORLD_EFFECT_SIZE });
  assert.ok(problems.length > 0, `check-vfx self-test FAILED: the matchers accepted ${what}. A guard that can't fail proves nothing.`);
}
for (const [what, bad] of [
  ['a hand-built sprite (no spriteSafe mark)', { image: {}, generateMipmaps: false, minFilter: THREE.LinearFilter, userData: {} }],
  ['a mipmapped sprite', { image: {}, generateMipmaps: true, minFilter: THREE.LinearFilter, userData: { spriteSafe: true } }],
  ['a mipmap-filtered sprite', { image: {}, generateMipmaps: false, minFilter: THREE.LinearMipmapLinearFilter, userData: { spriteSafe: true } }],
]) {
  assert.ok(checkTexture('self-test', bad).length > 0, `check-vfx self-test FAILED: the texture matchers accepted ${what}.`);
}

// --- The real sweep ---------------------------------------------------------
const failures = [];
let built = 0;

function run(label, fn, opts) {
  built++;
  try {
    failures.push(...checkEffect(label, fn(), opts));
  } catch (err) {
    failures.push(`${label}: threw while building — ${err.message}`);
  }
}

for (const [name, fn] of Object.entries(TEXTURES)) {
  if (typeof fn !== 'function') continue;
  built++;
  try {
    failures.push(...checkTexture(name, fn()));
  } catch (err) {
    failures.push(`texture ${name}: threw while drawing — ${err.message}`);
  }
}

for (const id of Object.keys(PRESETS)) run(`preset "${id}"`, () => PRESETS[id]());

const seenCategories = new Set();
for (const [id, def] of Object.entries(WORLD_EFFECTS)) {
  if (!WORLD_EFFECT_CATEGORIES.includes(def.category)) {
    failures.push(`world effect "${id}": category "${def.category}" isn't one of ${WORLD_EFFECT_CATEGORIES.join(', ')} — the editor palette groups by category and would drop it`);
  }
  seenCategories.add(def.category);
  if (!def.label) failures.push(`world effect "${id}": no label`);
  for (const key of ['defaultColorA', 'defaultColorB']) {
    if (!/^#[0-9a-fA-F]{6}$/.test(def[key] || '')) failures.push(`world effect "${id}": ${key} must be a "#rrggbb" hex string (the editor binds it to a colour input)`);
  }
  run(`world effect "${id}"`, () => def.build(), { minSize: MIN_WORLD_EFFECT_SIZE });
  // The authored dials must survive a build, including at their extremes —
  // an emitter scaled to 4x is a normal thing for an author to do.
  run(`world effect "${id}" (scaled)`, () => def.build({ scale: 4, intensity: 2.5, colorA: '#ff00ff', colorB: '#00ff88' }));
  run(`world effect "${id}" (tiny)`, () => def.build({ scale: 0.1, intensity: 0.1 }));
}
for (const category of WORLD_EFFECT_CATEGORIES) {
  if (!seenCategories.has(category)) failures.push(`world effect category "${category}" has no effects in it — an empty tab in the editor palette`);
}

// Every authored shape must build from its own documented defaults, which is
// exactly what the Skill Builder hands a freshly-created custom VFX.
for (const shape of VFX_SHAPES) {
  const def = { id: `check-${shape}`, name: shape, shape, colorA: '#88ccff', colorB: '#2244aa', params: defaultVfxParams(shape) };
  try {
    parseVfxDefs([def]);
  } catch (err) {
    failures.push(`custom shape "${shape}": its own defaultVfxParams() fails validation — ${err.message}`);
    continue;
  }
  run(`custom shape "${shape}"`, () => buildCustomVfxSystem(def));
  run(`custom shape "${shape}" (emitter opts)`, () => buildCustomVfxSystem(def, { scale: 2, intensity: 2, colorA: '#ffaa00' }));
}

// The Skill Builder generates its parameter inputs from VFX_PARAM_SPECS and
// its texture dropdown from VFX_SHAPE_TEXTURES, so a shape missing from
// either table is an empty (or wrong) authoring panel, not a crash.
for (const shape of VFX_SHAPES) {
  if (!VFX_PARAM_SPECS[shape]) failures.push(`shape "${shape}": no VFX_PARAM_SPECS entry — the Skill Builder would render an empty parameter panel for it`);
  if (!Object.keys(defaultVfxParams(shape)).length) failures.push(`shape "${shape}": defaultVfxParams() returns nothing`);
}
for (const [shape, textures] of Object.entries(VFX_SHAPE_TEXTURES)) {
  if (!VFX_SHAPES.includes(shape)) failures.push(`VFX_SHAPE_TEXTURES lists textures for unknown shape "${shape}"`);
  for (const t of textures) {
    if (!VFX_TEXTURES.includes(t)) failures.push(`shape "${shape}" offers texture "${t}", which isn't in VFX_TEXTURES — picking it would silently fall back to the default dot`);
  }
}

// Every advertised texture id must actually resolve, or an author picks it in
// the dropdown and silently gets the default dot.
for (const texture of VFX_TEXTURES) {
  const def = { id: `tex-${texture}`, name: texture, shape: 'burst', colorA: '#ffffff', params: { ...defaultVfxParams('burst'), texture } };
  run(`custom texture "${texture}"`, () => buildCustomVfxSystem(def));
}

if (failures.length) {
  console.error(`\ncheck:vfx FAILED — ${failures.length} problem(s) across ${built} built effects:\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log(`check:vfx OK — ${built} effects built and verified (${Object.keys(PRESETS).length} skill presets, ${Object.keys(WORLD_EFFECTS).length} world effects, ${VFX_SHAPES.length} authored shapes).`);
