// src/sim/colorGrading.js
// A small, shared colour grade that can be hung on anything the world paints
// the ground with: a painted ground-texture layer (src/sim/groundTextures.js)
// and a drawn path (src/sim/paths.js) both carry an optional `colorGrade`.
//
// WHY THIS EXISTS. Every ground texture and path texture in the project is
// BAKED FROM CODE — a base RGB triple plus noise or Voronoi parameters, in
// src/render/groundTextureThemes.js and src/render/pathThemes.js. That makes
// them free (no image files, CLAUDE.md's rule) and it makes them completely
// fixed: 'meadow' is one specific green, everywhere, on every map. A desert
// map and a swamp map paint the same grass. The only way to get a different
// colour was to add another builtin theme and bake another tile, which is a
// code change per shade.
//
// A grade is the alternative: the SAME baked tile, tinted/desaturated/
// brightened per layer at draw time, authored in the World Editor. It costs
// three uniforms and a handful of shader instructions, no extra texture, no
// extra bake, and no new texture unit — which matters, because the ground
// overlay is already up against WebGL2's 16-sampler guarantee.
//
// Pure data, no Three and no DOM (scripts/check-architecture.mjs). The GLSL
// that consumes it lives in src/render/colorGrade.js.

/**
 * @typedef {Object} ColorGrade
 * @property {string} tint       '#rrggbb', multiplied into the sampled colour.
 *   White is the identity, which is why it's the default rather than black.
 * @property {number} saturation 0 = greyscale, 1 = as baked, 2 = twice as
 *   colourful. Applied BEFORE the tint (see applyColorGrade's GLSL) so a
 *   fully-desaturated texture can then be tinted to a flat colour of your
 *   choosing — the useful order; tinting first and then desaturating always
 *   collapses back to grey no matter what tint you picked.
 * @property {number} brightness 0 = black, 1 = as baked, 2 = twice as bright.
 */

/** The identity grade: applying it changes nothing. */
export const DEFAULT_COLOR_GRADE = Object.freeze({
  tint: '#ffffff',
  saturation: 1,
  brightness: 1,
});

export const COLOR_GRADE_RANGES = Object.freeze({
  saturation: { min: 0, max: 2 },
  brightness: { min: 0.2, max: 2 },
});

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

/**
 * Fills in a partial/absent grade with the identity, clamping the numbers.
 * Total by design: `colorGrade` is optional on every carrier and absent from
 * every map authored before this existed, so a normalizer that can throw would
 * put a crash in the render path for old data. Validation of AUTHORED data is
 * validateColorGrade's job and happens on load, once, where a throw is useful.
 * @param {Partial<ColorGrade>|null|undefined} grade
 * @returns {ColorGrade}
 */
export function normalizeColorGrade(grade) {
  if (!grade) return { ...DEFAULT_COLOR_GRADE };
  const { saturation: s, brightness: b } = COLOR_GRADE_RANGES;
  return {
    tint: typeof grade.tint === 'string' && HEX_RE.test(grade.tint) ? grade.tint : DEFAULT_COLOR_GRADE.tint,
    saturation: typeof grade.saturation === 'number' && Number.isFinite(grade.saturation)
      ? clamp(grade.saturation, s.min, s.max) : DEFAULT_COLOR_GRADE.saturation,
    brightness: typeof grade.brightness === 'number' && Number.isFinite(grade.brightness)
      ? clamp(grade.brightness, b.min, b.max) : DEFAULT_COLOR_GRADE.brightness,
  };
}

/**
 * True when a grade would leave the texture exactly as baked. Callers use this
 * to avoid persisting a no-op object into world.json — an untouched layer
 * should serialize the same bytes it always did.
 * @param {Partial<ColorGrade>|null|undefined} grade
 */
export function isNeutralColorGrade(grade) {
  const g = normalizeColorGrade(grade);
  return g.tint.toLowerCase() === DEFAULT_COLOR_GRADE.tint
    && g.saturation === DEFAULT_COLOR_GRADE.saturation
    && g.brightness === DEFAULT_COLOR_GRADE.brightness;
}

/**
 * @param {any} grade
 * @param {string} label used in the error message, e.g. `Path "main-road"`
 * @returns {void} throws on malformed data.
 */
export function validateColorGrade(grade, label) {
  if (grade === undefined || grade === null) return;
  if (typeof grade !== 'object' || Array.isArray(grade)) {
    throw new Error(`${label} colorGrade must be an object`);
  }
  if (grade.tint !== undefined && (typeof grade.tint !== 'string' || !HEX_RE.test(grade.tint))) {
    throw new Error(`${label} colorGrade.tint must be a "#rrggbb" string (got ${JSON.stringify(grade.tint)})`);
  }
  for (const key of ['saturation', 'brightness']) {
    const v = grade[key];
    if (v === undefined) continue;
    const { min, max } = COLOR_GRADE_RANGES[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      throw new Error(`${label} colorGrade.${key} must be a number in [${min}, ${max}] (got ${JSON.stringify(v)})`);
    }
  }
}

/**
 * '#rrggbb' -> [r, g, b] in 0..1, for handing straight to a shader uniform
 * without pulling THREE.Color into a sim file.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb01(hex) {
  const h = HEX_RE.test(hex) ? hex : DEFAULT_COLOR_GRADE.tint;
  return [
    parseInt(h.slice(1, 3), 16) / 255,
    parseInt(h.slice(3, 5), 16) / 255,
    parseInt(h.slice(5, 7), 16) / 255,
  ];
}
