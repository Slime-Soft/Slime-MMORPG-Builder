// src/generators/faceTexture.js
// Anime faces, drawn to a canvas at runtime and mapped onto the FRONT FACE of a
// head box. No image files — this is procedural like everything else in the
// project, which is why it needs no "external asset" exception (see CLAUDE.md's
// ez-tree / cloud-shadow precedents; this is deliberately not a third one).
//
// WHY A TEXTURE AND NOT SHAPES: a cute anime face is 80% eye, and an eye is a
// stack of soft concentric shapes with a highlight. Built from box primitives
// that reads as a robot; drawn on a canvas it reads as a face, and every
// parameter a player picks (eye shape, eye colour, brow angle, mouth) becomes a
// number instead of a hand-authored mesh variant.
//
// The background is filled with the SKIN TONE rather than left transparent:
// an opaque face plate can't sort wrongly against the hair in front of it, and
// it means the head box's own colour never has to line up with the drawing.
import * as THREE from 'three';

export const EYE_STYLES = ['round', 'almond', 'sharp', 'sleepy', 'wide'];
export const EYE_STYLE_LABELS = {
  round: 'Round', almond: 'Almond', sharp: 'Sharp', sleepy: 'Sleepy', wide: 'Wide',
};
export const MOUTH_STYLES = ['neutral', 'smile', 'smirk', 'open', 'cat'];
export const BROW_STYLES = ['neutral', 'raised', 'angry', 'worried'];

const SIZE = 256;
const cache = new Map();

const hex = (n) => `#${(n >>> 0).toString(16).padStart(6, '0')}`;

/** Mix two hex ints, t=0 -> a. Used for lash/brow colours derived from hair. */
function mix(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (
    ((Math.round(ar + (br - ar) * t) << 16) |
     (Math.round(ag + (bg - ag) * t) << 8) |
     Math.round(ab + (bb - ab) * t)) >>> 0
  );
}

/**
 * Per-style eye geometry, in canvas units, for ONE eye centred on (0,0).
 * `w`/`h` are the sclera's radii, `tilt` leans the outer corner up (degrees),
 * `lidTop` is how far the upper lid cuts the eye down (0..1 of h) — that cut is
 * what separates "sleepy" from "wide" more than size does.
 */
const EYE_GEOM = {
  round:  { w: 26, h: 30, tilt: 0,  lidTop: 0.06, iris: 0.80 },
  almond: { w: 29, h: 25, tilt: 8,  lidTop: 0.14, iris: 0.78 },
  sharp:  { w: 30, h: 22, tilt: 15, lidTop: 0.20, iris: 0.74 },
  sleepy: { w: 27, h: 21, tilt: -6, lidTop: 0.34, iris: 0.80 },
  wide:   { w: 28, h: 34, tilt: 2,  lidTop: 0.02, iris: 0.82 },
};

const BROW_GEOM = {
  neutral: { tilt: -4, lift: 0 },
  raised:  { tilt: -8, lift: -7 },
  angry:   { tilt: 16, lift: 3 },
  worried: { tilt: -20, lift: -2 },
};

/**
 * Draw one eye. `side` is -1 (left of centre on screen) or +1; the tilt mirrors
 * so both outer corners lift, which is the whole read of an almond/sharp eye —
 * tilting both the same way makes the face look broken, not stylised.
 */
function drawEye(ctx, cx, cy, side, g, eyeColor, lashColor, masc) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((side * g.tilt * Math.PI) / 180);

  // Sclera
  ctx.fillStyle = '#fbf8f6';
  ctx.beginPath();
  ctx.ellipse(0, 0, g.w, g.h, 0, 0, Math.PI * 2);
  ctx.fill();

  // Clip everything else to the sclera so the iris and lid never spill onto
  // the cheek — an iris drawn slightly oversized is what gives an anime eye its
  // "fills the socket" look, and it only works inside a clip.
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(0, 0, g.w, g.h, 0, 0, Math.PI * 2);
  ctx.clip();

  const ir = g.w * g.iris;
  const iy = g.h * 0.10;

  // Iris: a vertical gradient, darker at the top where the lid shades it.
  const grad = ctx.createLinearGradient(0, iy - ir, 0, iy + ir);
  grad.addColorStop(0, hex(mix(eyeColor, 0x000000, 0.45)));
  grad.addColorStop(0.55, hex(eyeColor));
  grad.addColorStop(1, hex(mix(eyeColor, 0xffffff, 0.35)));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, iy, ir, ir * 1.05, 0, 0, Math.PI * 2);
  ctx.fill();

  // Iris rim — reads as depth at a distance where the gradient alone doesn't.
  ctx.strokeStyle = hex(mix(eyeColor, 0x000000, 0.6));
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Pupil
  ctx.fillStyle = '#141018';
  ctx.beginPath();
  ctx.ellipse(0, iy, ir * 0.42, ir * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Highlights: one big off-centre, one small opposite. The pair is what makes
  // an eye look wet instead of painted.
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(-ir * 0.38, iy - ir * 0.42, ir * 0.28, ir * 0.24, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(ir * 0.34, iy + ir * 0.40, ir * 0.15, ir * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Upper lid: a filled cap, not a stroke, so `lidTop` can genuinely close the
  // eye down to a sleepy slit.
  ctx.fillStyle = hex(lashColor);
  ctx.beginPath();
  ctx.rect(-g.w * 1.2, -g.h * 1.2, g.w * 2.4, g.h * (1.2 + g.lidTop));
  ctx.fill();
  ctx.restore();

  // Lash line, drawn OUTSIDE the clip so it thickens the silhouette and the
  // outer corner can flick past the sclera.
  //
  // THIS IS THE SINGLE BIGGEST GENDER CUE. A heavy lash line plus an upward
  // outer flick reads feminine no matter what the rest of the face does — the
  // first version drew both on every character, which is why masculine
  // characters still looked like girls.
  ctx.strokeStyle = hex(lashColor);
  ctx.lineWidth = masc ? 3.5 : 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, g.w, g.h, 0, Math.PI * 1.02, Math.PI * 1.98);
  ctx.stroke();
  if (!masc) {
    ctx.beginPath();
    ctx.moveTo(side * g.w * 0.72, -g.h * 0.66);
    ctx.lineTo(side * g.w * 1.24, -g.h * 0.92);
    ctx.lineWidth = 5;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Brows. Masculine brows are THICKER, STRAIGHTER and sit LOWER — a low straight
 * brow close to the eye is the second gender cue after the lash line, and it's
 * the one that still works at a distance where lashes blur out.
 */
function drawBrow(ctx, cx, cy, side, b, color, masc) {
  ctx.save();
  ctx.translate(cx, cy + b.lift + (masc ? 7 : 0));
  ctx.rotate((side * b.tilt * Math.PI) / 180);
  ctx.strokeStyle = hex(color);
  ctx.lineWidth = masc ? 10 : 7;
  ctx.lineCap = masc ? 'butt' : 'round';
  ctx.beginPath();
  ctx.moveTo(-23, masc ? 1 : 3);
  ctx.quadraticCurveTo(0, masc ? -2 : -6, 23, masc ? 0 : 2);
  ctx.stroke();
  ctx.restore();
}

function drawMouth(ctx, cx, cy, style, color) {
  ctx.strokeStyle = hex(color);
  ctx.fillStyle = hex(color);
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  switch (style) {
    case 'smile':
      ctx.moveTo(cx - 13, cy - 2);
      ctx.quadraticCurveTo(cx, cy + 9, cx + 13, cy - 2);
      ctx.stroke();
      break;
    case 'smirk':
      ctx.moveTo(cx - 12, cy + 2);
      ctx.quadraticCurveTo(cx + 2, cy + 6, cx + 13, cy - 4);
      ctx.stroke();
      break;
    case 'open':
      ctx.ellipse(cx, cy + 1, 9, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'cat':
      ctx.moveTo(cx - 14, cy + 4);
      ctx.quadraticCurveTo(cx - 7, cy - 6, cx, cy + 3);
      ctx.quadraticCurveTo(cx + 7, cy - 6, cx + 14, cy + 4);
      ctx.stroke();
      break;
    default:
      ctx.moveTo(cx - 9, cy);
      ctx.lineTo(cx + 9, cy);
      ctx.stroke();
  }
}

/**
 * @typedef {Object} FaceParams
 * @property {number} [skinTone] hex, fills the plate
 * @property {number} [eyeColor] hex
 * @property {number} [hairColor] hex — lashes and brows derive from it
 * @property {string} [eyeStyle] one of EYE_STYLES
 * @property {string} [browStyle] one of BROW_STYLES
 * @property {string} [mouthStyle] one of MOUTH_STYLES
 * @property {number} [blush] 0..1
 * @property {number} [eyeSpacing] 0.8..1.25, multiplies the gap between eyes
 * @property {number} [eyeScale] 0.75..1.3, multiplies eye size
 * @property {number} [eyeHeight] -0.1..0.1, moves both eyes up/down the face
 */

export const FACE_STYLES = ['fem', 'masc'];

const DEFAULTS = {
  skinTone: 0xf2d3b0,
  eyeColor: 0x3a5ab0,
  hairColor: 0x2a1d14,
  eyeStyle: 'round',
  browStyle: 'neutral',
  mouthStyle: 'smile',
  faceStyle: 'fem',
  blush: null, // null = pick from faceStyle; a number overrides
  eyeSpacing: 1,
  eyeScale: 1,
  eyeHeight: 0,
};

function cacheKey(p) {
  return [
    p.skinTone, p.eyeColor, p.hairColor, p.eyeStyle, p.browStyle, p.mouthStyle, p.faceStyle,
    p.blush.toFixed(2), p.eyeSpacing.toFixed(2), p.eyeScale.toFixed(2), p.eyeHeight.toFixed(2),
  ].join('|');
}

/**
 * A CanvasTexture of one anime face. Cached — a hundred players wearing the
 * same face share one GPU texture, and re-tuning a slider in the builder only
 * costs a redraw for genuinely new parameter sets.
 *
 * Returns null under plain Node (no `document`), which is what lets
 * `npm run check:prefabs` build these bodies headlessly — the head simply keeps
 * its flat skin colour there, and connectivity is unaffected either way.
 * @param {FaceParams} params
 * @returns {THREE.CanvasTexture|null}
 */
export function buildFaceTexture(params = {}) {
  if (typeof document === 'undefined') return null;
  const p = { ...DEFAULTS, ...params };
  const masc = p.faceStyle === 'masc';
  // Masculine faces get smaller, narrower-set eyes and no blush by default.
  // Applied BEFORE the cache key so the two styles can't collide.
  if (p.blush === null || p.blush === undefined) p.blush = masc ? 0 : 0.35;
  if (params.eyeScale === undefined && masc) p.eyeScale = 0.86;
  if (params.eyeSpacing === undefined && masc) p.eyeSpacing = 1.04;
  const key = cacheKey(p);
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = hex(p.skinTone);
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Lashes/brows are the hair colour pushed well toward black. Using the hair
  // colour raw makes blonde characters look eyebrow-less at any distance.
  const lash = mix(p.hairColor, 0x000000, 0.55);
  const brow = mix(p.hairColor, 0x000000, 0.35);

  const g0 = EYE_GEOM[p.eyeStyle] || EYE_GEOM.round;
  const g = { ...g0, w: g0.w * p.eyeScale, h: g0.h * p.eyeScale };

  const cy = SIZE * (0.56 + p.eyeHeight);
  const dx = SIZE * 0.185 * p.eyeSpacing;

  if (p.blush > 0) {
    for (const s of [-1, 1]) {
      const bx = SIZE / 2 + s * dx * 1.5;
      const rg = ctx.createRadialGradient(bx, cy + g.h * 1.5, 2, bx, cy + g.h * 1.5, 34);
      rg.addColorStop(0, `rgba(232,110,110,${0.5 * p.blush})`);
      rg.addColorStop(1, 'rgba(232,110,110,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(bx - 40, cy + g.h * 1.5 - 40, 80, 80);
    }
  }

  drawEye(ctx, SIZE / 2 - dx, cy, -1, g, p.eyeColor, lash, masc);
  drawEye(ctx, SIZE / 2 + dx, cy, 1, g, p.eyeColor, lash, masc);

  const b = BROW_GEOM[p.browStyle] || BROW_GEOM.neutral;
  drawBrow(ctx, SIZE / 2 - dx, cy - g.h - 22, -1, b, brow, masc);
  drawBrow(ctx, SIZE / 2 + dx, cy - g.h - 22, 1, b, brow, masc);

  // Nose: a single short shadow tick. Anything more and the face stops reading
  // as anime and starts reading as a low-poly person with a nose problem.
  ctx.strokeStyle = `rgba(0,0,0,0.16)`;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(SIZE / 2 + 3, cy + g.h * 1.15);
  ctx.lineTo(SIZE / 2 - 2, cy + g.h * 1.45);
  ctx.stroke();

  drawMouth(ctx, SIZE / 2, cy + g.h * 2.05, p.mouthStyle, mix(p.skinTone, 0x000000, 0.62));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No mipmaps: the face is a single small quad seen head-on, and mipping it
  // turns the pupils to mush at the distances a player actually stands at.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  cache.set(key, tex);
  return tex;
}
