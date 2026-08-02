// src/render/colorGrade.js
// The GLSL half of src/sim/colorGrading.js: turns a ColorGrade into shader
// uniforms and the four lines that apply it to a sampled texture colour.
//
// Shared by the two places a grade can be authored — the painted ground
// overlay (groundTextureMesh.js, which grades each of its up-to-8 layers
// independently inside one unrolled shader) and drawn paths (pathMesh.js,
// one grade per ribbon). They compose the same snippet with a different
// uniform SUFFIX so the ground overlay can declare `uGradeTint0..7` without
// this file knowing anything about layers.
import * as THREE from 'three';
import { normalizeColorGrade, hexToRgb01 } from '../sim/colorGrading.js';

// Rec. 709 luma, the same weights three.js's own tone-mapping/luminance code
// uses. Grading toward the *perceptual* grey rather than the (r+g+b)/3
// average matters here because ground textures are overwhelmingly green:
// under a flat average, desaturating grass makes it noticeably DARKER as well
// as greyer, which reads as a lighting change rather than a colour choice.
const LUMA = 'vec3( 0.2126, 0.7152, 0.0722 )';

/**
 * Uniform declarations for one grade.
 * @param {string} [suffix] appended to every uniform name, so several grades
 *   can coexist in one shader (the ground overlay passes '0'..'7').
 */
export function colorGradeUniformDecls(suffix = '') {
  return `uniform vec3 uGradeTint${suffix};\nuniform float uGradeSat${suffix};\nuniform float uGradeBright${suffix};`;
}

/**
 * The uniform VALUES for one grade, ready to merge into `shader.uniforms`.
 * @param {import('../sim/colorGrading.js').ColorGrade|null|undefined} grade
 * @param {string} [suffix]
 */
export function colorGradeUniforms(grade, suffix = '') {
  const g = normalizeColorGrade(grade);
  const [r, gr, b] = hexToRgb01(g.tint);
  return {
    [`uGradeTint${suffix}`]: { value: new THREE.Color(r, gr, b) },
    [`uGradeSat${suffix}`]: { value: g.saturation },
    [`uGradeBright${suffix}`]: { value: g.brightness },
  };
}

/**
 * An expression that grades `expr` (any vec3 rgb).
 *
 * ORDER IS SATURATION -> BRIGHTNESS -> TINT, and it is not arbitrary. Tinting
 * last is what makes "wash the grass out and make it blue-grey" a two-slider
 * operation instead of an impossible one: desaturate to grey, then multiply by
 * the tint you actually want. Tinting first and desaturating after throws the
 * tint away — the result is grey regardless of which colour you picked, which
 * makes the two controls feel broken when used together.
 *
 * @param {string} expr a vec3-valued GLSL expression
 * @param {string} [suffix]
 */
export function colorGradeExpr(expr, suffix = '') {
  return `applyColorGrade( ${expr}, uGradeTint${suffix}, uGradeSat${suffix}, uGradeBright${suffix} )`;
}

/**
 * The shared function body. Injected ONCE per shader (not once per grade),
 * which is why it takes its parameters rather than reading uniforms directly.
 */
export const COLOR_GRADE_GLSL = `
vec3 applyColorGrade( vec3 c, vec3 tint, float sat, float bright ) {
	float luma = dot( c, ${LUMA} );
	// mix() past t=1 EXTRAPOLATES away from grey, which is exactly what a
	// saturation above 1 means — no separate branch needed for boosting.
	c = mix( vec3( luma ), c, sat );
	c *= bright;
	c *= tint;
	// Saturation > 1 and brightness > 1 can both push a channel past 1.0.
	// Left unclamped that survives into the lighting result and blows out to
	// pure white through the bloom pass, so a mild "more colourful" setting
	// reads as a glowing patch of ground.
	return clamp( c, 0.0, 1.0 );
}
`;
