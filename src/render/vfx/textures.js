// src/render/vfx/textures.js
// Tiny procedurally-drawn canvas sprites shared by every VFX preset — no
// external asset files, same precedent as ambientParticles.js's sprite dot.
//
// Every sprite goes through makeSprite(), which enforces the two rules that
// were violated across this file and produced visible square-edged blobs in
// game (2026-07-26):
//
// 1. **Alpha must reach zero before the quad's edge.** Anything drawn out to
//    the canvas border gets cut off by the particle quad, and a flat cut on
//    an additively-blended sprite reads as a glowing rectangle. The flame,
//    shard, arrow, bolt and spark sprites all had alpha 127-161 sitting on
//    their border. makeSprite feathers the outer band of every sprite and
//    optionally insets the drawing so nothing can touch it.
// 2. **No mipmaps.** Mip levels average a sprite toward one flat value, so a
//    small or distant additive particle fills its whole quad with uniform
//    brightness — again, a glowing square. Particle sprites use LinearFilter
//    with mipmaps off (the standard choice for additive VFX); the trade is
//    slightly more shimmer on very distant particles, which is invisible next
//    to the artefact it removes.
import * as THREE from 'three';

/** Fraction of each dimension faded out at the sprite's edge. */
const EDGE_FEATHER = 0.05;

/** Erases the outermost band so alpha is guaranteed 0 at the quad boundary, whatever the draw callback did. */
function featherEdges(ctx, w, h, frac) {
  const bx = Math.max(2, Math.round(w * frac));
  const by = Math.max(2, Math.round(h * frac));
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const bands = [
    [ctx.createLinearGradient(0, 0, bx, 0), 0, 0, bx, h],
    [ctx.createLinearGradient(w, 0, w - bx, 0), w - bx, 0, bx, h],
    [ctx.createLinearGradient(0, 0, 0, by), 0, 0, w, by],
    [ctx.createLinearGradient(0, h, 0, h - by), 0, h - by, w, by],
  ];
  for (const [grad, x, y, gw, gh] of bands) {
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, gw, gh);
  }
  ctx.restore();
}

/**
 * @param {number} w
 * @param {number} h
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} draw
 *   called with the origin already at the sprite's centre — every shape here
 *   is drawn centred, so no getter repeats the translate.
 * @param {{inset?: number, feather?: number}} [opts] `inset` shrinks the
 *   drawing (use it for shapes that would otherwise reach the border).
 */
function makeSprite(w, h, draw, { inset = 1, feather = EDGE_FEATHER } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(w / 2, h / 2);
  if (inset !== 1) ctx.scale(inset, inset);
  draw(ctx, w, h);
  ctx.restore();
  featherEdges(ctx, w, h, feather);
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  // Asserted by npm run check:vfx — a sprite built by hand outside this
  // helper is a sprite with no edge guarantee and no filter settings.
  tex.userData.spriteSafe = true;
  return tex;
}

let softDot = null;
/**
 * The workhorse sprite. Its falloff is deliberately NOT a plain linear
 * gradient: a linear ramp spends most of its area at middling alpha, which is
 * what made every additive burst read as a flat pastel smudge rather than a
 * spark. A tight opaque core with a quadratic tail gives the same particle a
 * hot centre that clears the bloom threshold and a halo that fades out
 * invisibly well inside the quad.
 */
export function getSoftDotTexture() {
  if (softDot) return softDot;
  softDot = makeSprite(128, 128, (ctx, size) => {
    const r = size / 2;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.16, 'rgba(255,255,255,1)');
    grad.addColorStop(0.34, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.16)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-r, -r, size, size);
  });
  return softDot;
}

let ringTex = null;
/**
 * A thin ring with SOFT edges, drawn as a narrow bright band in a radial
 * gradient rather than a stroked circle. A hard stroke, stretched to a real
 * 4-5 metre diameter in world space, reads as an opaque painted decal on the
 * ground — a target reticle, not a wave of frost.
 */
export function getRingTexture() {
  if (ringTex) return ringTex;
  ringTex = makeSprite(256, 256, (ctx, size) => {
    const c = size / 2;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.76, 'rgba(255,255,255,0)');
    grad.addColorStop(0.84, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.88, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.92, 'rgba(255,255,255,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-c, -c, size, size);
  });
  return ringTex;
}

let sparkTex = null;
export function getSparkTexture() {
  if (sparkTex) return sparkTex;
  sparkTex = makeSprite(128, 128, (ctx, size) => {
    const r = size / 2;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(size * 0.14, -size * 0.08);
    ctx.lineTo(r, 0);
    ctx.lineTo(size * 0.14, size * 0.08);
    ctx.lineTo(0, r);
    ctx.lineTo(-size * 0.14, size * 0.08);
    ctx.lineTo(-r, 0);
    ctx.lineTo(-size * 0.14, -size * 0.08);
    ctx.closePath();
    ctx.fill();
  }, { inset: 0.86 });
  return sparkTex;
}

// The textures below exist because a soft round dot and an 8-point star can
// only ever read as "colored particles" — an icicle, an arrow, a lightning
// bolt and a flame are recognizable shapes, so they need their own
// silhouettes. Each is drawn narrow-and-tall inside its square canvas
// (transparent padding left/right) so it already reads as elongated even at
// uniform particle scale, and doubly so once a preset also applies a
// non-uniform (narrow x, tall y) startSize on top.

let shardTex = null;
/**
 * Tapered icicle/crystal shard — a long spike with a faceted highlight line
 * down one side. Drawn tip-up, then rotated -90° so the tip ends up on the
 * LEFT (local -X): three.quarks' StretchedBillBoard stretches a particle
 * along local X specifically, anchoring the x=-0.5 edge (the leading edge, no
 * displacement) and pushing x=+0.5 backward along -velocity — so whatever
 * sits at -X is what "leads" the direction of travel. A shape drawn tip-up
 * (local +Y) would lead with its BLUNT end instead, which is what made these
 * read as flying sideways/backwards.
 */
export function getShardTexture() {
  if (shardTex) return shardTex;
  shardTex = makeSprite(128, 128, (ctx, size) => {
    ctx.rotate(-Math.PI / 2);
    const r = size / 2;
    const w = size * 0.16;
    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(w, -size * 0.1);
    ctx.lineTo(w * 0.55, size * 0.44);
    ctx.lineTo(0, r);
    ctx.lineTo(-w * 0.55, size * 0.44);
    ctx.lineTo(-w, -size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = size * 0.02;
    ctx.beginPath();
    ctx.moveTo(0, -size * 0.4);
    ctx.lineTo(0, size * 0.4);
    ctx.stroke();
  }, { inset: 0.84 });
  return shardTex;
}

let arrowTex = null;
/**
 * A literal arrow: triangular head, thin shaft, notched V fletching at the
 * tail. Drawn head-up, then rotated -90° so the head ends up on the LEFT
 * (local -X) — see getShardTexture's comment for why -X is the "leading"
 * edge under StretchedBillBoard.
 */
export function getArrowTexture() {
  if (arrowTex) return arrowTex;
  arrowTex = makeSprite(128, 128, (ctx, size) => {
    ctx.rotate(-Math.PI / 2);
    const r = size / 2;
    ctx.fillStyle = 'white';
    const headW = size * 0.22;
    const shaftW = size * 0.045;
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(headW, -size * 0.28);
    ctx.lineTo(shaftW, -size * 0.28);
    ctx.lineTo(shaftW, size * 0.32);
    ctx.lineTo(-shaftW, size * 0.32);
    ctx.lineTo(-shaftW, -size * 0.28);
    ctx.lineTo(-headW, -size * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-shaftW, size * 0.18);
    ctx.lineTo(-size * 0.16, r);
    ctx.lineTo(-shaftW, size * 0.32);
    ctx.lineTo(shaftW, size * 0.32);
    ctx.lineTo(size * 0.16, r);
    ctx.lineTo(shaftW, size * 0.18);
    ctx.closePath();
    ctx.fill();
  }, { inset: 0.84 });
  return arrowTex;
}

let boltTex = null;
/** Jagged lightning-bolt zigzag silhouette, with a soft glow behind it so it doesn't read as a flat paper cut-out. */
export function getBoltTexture() {
  if (boltTex) return boltTex;
  boltTex = makeSprite(128, 128, (ctx, size) => {
    const w = size * 0.14;
    // Traced twice rather than held in a Path2D: Path2D is a global
    // constructor, not a context method, so it isn't covered by the canvas
    // stub npm run check:vfx uses — and the guard caught exactly that.
    const trace = () => {
      ctx.beginPath();
      ctx.moveTo(w * 0.3, -size / 2);
      ctx.lineTo(w, -size * 0.12);
      ctx.lineTo(w * 0.25, -size * 0.05);
      ctx.lineTo(w * 1.1, size * 0.5);
      ctx.lineTo(-w * 0.15, size * 0.06);
      ctx.lineTo(w * 0.35, -size * 0.02);
      ctx.lineTo(-w * 0.7, -size * 0.42);
      ctx.closePath();
    };
    // Glow pass first (a wide soft stroke), then the hard core on top.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = size * 0.09;
    ctx.lineJoin = 'round';
    trace();
    ctx.stroke();
    ctx.fillStyle = 'white';
    trace();
    ctx.fill();
  }, { inset: 0.8 });
  return boltTex;
}

let flameTex = null;
/**
 * A soft upward flame lick, built as a column of overlapping radial gradients
 * that get smaller, narrower and fainter toward the tip — NOT a filled
 * teardrop path.
 *
 * This is the single most important sprite in the file and the first two
 * attempts both got it wrong the same way: a bezier teardrop, even with a
 * gradient fill, has a defined outline, and an outline makes each particle
 * read as a discrete OBJECT. A cluster of them looked like floating water
 * droplets, which is exactly what Dennis reported ("the fire doesn't look
 * like fire"). Fire has no silhouette — it's a density field. Gradient blobs
 * with no edge anywhere blend into each other additively, so a cluster reads
 * as one body of flame instead of a handful of shapes.
 */
export function getFlameTexture() {
  if (flameTex) return flameTex;
  flameTex = makeSprite(128, 192, (ctx, w, h) => {
    ctx.globalCompositeOperation = 'lighter';
    // MANY overlapping blobs at LOW alpha, not a few at high alpha: nine fat
    // circles left visible scalloped steps up the sides, which is its own kind
    // of "this is made of shapes" tell. Thirty faint ones an eighth of a
    // radius apart accumulate into a smooth density field with no rim
    // anywhere. The radius follows a power curve so the plume narrows fast
    // near the top, and a sine lean keeps it from being a symmetric triangle.
    const N = 30;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const y = h * 0.36 - t * h * 0.78;
      // A sine profile, not a linear one: linear radii stack into a
      // straight-sided cone (it looked like a geometric triangle), while a
      // sine gives a rounded belly low down that narrows to a point.
      const r = w * (0.3 * Math.sin((1 - t) * Math.PI * 0.62) ** 1.15 + 0.012);
      const x = Math.sin(t * 2.4) * w * 0.08 * t;
      const alpha = 0.15 * (1 - t * 0.75);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      // A long, soft tail on every blob so the plume's OUTER boundary is
      // diffuse. With a short falloff, 30 overlapping circles form a crisp
      // envelope and the whole thing gets an edge again.
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.25, `rgba(255,255,255,${alpha * 0.62})`);
      g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.2})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // A brighter, tighter core low down — the hottest part of a lick, and what
    // gives a fire its bloom without whitening the whole sprite.
    // Wide and soft, not a small bright disc: at high alpha the core popped as
    // a visible circle in every particle, so a cluster of flames looked like a
    // bunch of glowing balls with plumes attached.
    const cy = h * 0.28;
    const cr = w * 0.2;
    const core = ctx.createRadialGradient(0, cy, 0, 0, cy, cr);
    core.addColorStop(0, 'rgba(255,255,255,0.5)');
    core.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-cr, cy - cr, cr * 2, cr * 2);
  });
  return flameTex;
}

let flameBodyTex = null;
/**
 * The same plume as getFlameTexture, drawn dense enough to be OPAQUE through
 * its middle.
 *
 * This exists because additive blending is invisible in daylight: adding 0.3
 * of orange to an already-bright sunlit path or a pale sky changes almost
 * nothing, so a campfire that looked great against a night sky was a faint
 * white smudge in the actual game world (and vanished entirely once raised
 * against the sky). A normal-blended body layer OCCLUDES what's behind it, so
 * the flame keeps its shape and colour at any background brightness; the
 * additive layers then sit on top and do the glowing.
 */
export function getFlameBodyTexture() {
  if (flameBodyTex) return flameBodyTex;
  flameBodyTex = makeSprite(128, 192, (ctx, w, h) => {
    ctx.globalCompositeOperation = 'lighter';
    const N = 30;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const y = h * 0.36 - t * h * 0.78;
      const r = w * (0.3 * Math.sin((1 - t) * Math.PI * 0.62) ** 1.15 + 0.012);
      const x = Math.sin(t * 2.4) * w * 0.08 * t;
      // ~3x the per-blob alpha of the additive version, so the overlap
      // saturates to a solid core instead of a translucent haze.
      const alpha = 0.45 * (1 - t * 0.72);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${alpha})`);
      g.addColorStop(0.45, `rgba(255,255,255,${alpha * 0.55})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  return flameBodyTex;
}

let wispTex = null;
/** Soft elongated streak — a blurred capsule, for swirling vortex trails (tornado/whirlwind). */
export function getWispTexture() {
  if (wispTex) return wispTex;
  wispTex = makeSprite(64, 160, (ctx, w) => {
    ctx.scale(1, 2.6);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, -w / 2, w, w);
  });
  return wispTex;
}

// --- Added 2026-07-26 with the VFX overhaul ---------------------------------
// The sprites above can only build effects out of dots, stars and
// silhouettes. What made this project's spell VFX read as underwhelming was
// never the particle COUNT — it was that every layer of every effect was the
// same soft dot, so an explosion and a heal differed only in colour. The
// sprites below are the missing vocabulary: a flare for the hot centre of an
// impact, a smoke puff for the aftermath, a hard-edged shockwave for the
// expanding front, a crescent for a melee arc, a rune circle for a cast, a
// twinkling star for glitter, and an angular chip for debris.

let glowTex = null;
/**
 * A lens-flare-ish core: a very small blown-out centre, a wide soft halo, and
 * four faint anamorphic rays. Used as the single brightest layer of an impact
 * or the body of a magical glow.
 */
export function getGlowTexture() {
  if (glowTex) return glowTex;
  glowTex = makeSprite(256, 256, (ctx, size) => {
    const c = size / 2;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.07, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.34)');
    grad.addColorStop(0.48, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-c, -c, size, size);
    ctx.globalCompositeOperation = 'lighter';
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.rotate(rot);
      const ray = ctx.createLinearGradient(-c, 0, c, 0);
      ray.addColorStop(0, 'rgba(255,255,255,0)');
      ray.addColorStop(0.5, 'rgba(255,255,255,0.45)');
      ray.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = ray;
      ctx.fillRect(-c, -size * 0.012, size, size * 0.024);
      ctx.restore();
    }
  }, { inset: 0.92 });
  return glowTex;
}

let smokeTex = null;
/**
 * A billowy puff: several overlapping soft blobs inside a fading disc, so a
 * cluster of these reads as volume rather than as a grid of identical dots.
 * Deliberately mid-alpha — smoke layers are drawn with NORMAL blending (see
 * presets.js's smokePreset), because additive smoke just brightens the screen
 * and can never read as smoke.
 */
export function getSmokeTexture() {
  if (smokeTex) return smokeTex;
  smokeTex = makeSprite(256, 256, (ctx, size) => {
    const c = size / 2;
    // Offsets kept small and radii large, so the puff's silhouette stays
    // round-ish — widely spaced lumps gave it a visible polygonal outline.
    const blobs = [
      [0, 0, 0.42], [-0.11, -0.08, 0.3], [0.12, -0.05, 0.28],
      [-0.06, 0.12, 0.27], [0.09, 0.11, 0.25], [0.01, -0.14, 0.24],
    ];
    for (const [bx, by, br] of blobs) {
      const x = bx * size;
      const y = by * size;
      const r = br * size;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.42)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.2)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Mask the square's corners away so the puff can never show a hard edge.
    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.68, 'rgba(255,255,255,1)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(-c, -c, size, size);
  });
  return smokeTex;
}

let shockTex = null;
/**
 * An expanding-wave front: a bright, thin outer rim with a soft inner glow
 * trailing behind it and nothing at all in the middle. Unlike getRingTexture's
 * plain even-width stroke, the asymmetry is what makes it read as a wave
 * travelling OUTWARD rather than as a hoop that happens to be getting bigger.
 */
export function getShockwaveTexture() {
  if (shockTex) return shockTex;
  shockTex = makeSprite(256, 256, (ctx, size) => {
    const c = size / 2;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0)');
    grad.addColorStop(0.74, 'rgba(255,255,255,0.26)');
    grad.addColorStop(0.88, 'rgba(255,255,255,1)');
    grad.addColorStop(0.94, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(-c, -c, size, size);
  });
  return shockTex;
}

let slashTex = null;
/** A crescent sword arc — thick through the middle, tapering to points at both ends, with a brighter leading edge. */
export function getSlashTexture() {
  if (slashTex) return slashTex;
  slashTex = makeSprite(256, 256, (ctx, size) => {
    const c = size / 2;
    ctx.fillStyle = 'white';
    const start = -Math.PI * 0.62;
    const end = Math.PI * 0.62;
    const steps = 48;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const a = start + (end - start) * (i / steps);
      const r = c * 0.94;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const a = start + (end - start) * t;
      // Taper: full thickness at t=0.5, zero at both ends.
      const thick = Math.sin(t * Math.PI) ** 0.7 * c * 0.34;
      const r = c * 0.94 - thick;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.arc(0, 0, c * 0.94, start, end);
    ctx.stroke();
  }, { inset: 0.9 });
  return slashTex;
}

let runeTex = null;
/** A summoning circle: two concentric rings, a tick ring, and a ring of small glyphs. Lies flat on the ground under a caster (HorizontalBillBoard) and spins. */
export function getMagicCircleTexture() {
  if (runeTex) return runeTex;
  runeTex = makeSprite(512, 512, (ctx, size) => {
    const c = size / 2;
    ctx.strokeStyle = 'white';
    ctx.fillStyle = 'white';
    for (const [r, w] of [[0.96, 0.014], [0.86, 0.006], [0.62, 0.01], [0.3, 0.005]]) {
      ctx.lineWidth = size * w;
      ctx.beginPath();
      ctx.arc(0, 0, c * r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = size * 0.006;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const long = i % 4 === 0;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * c * 0.86, Math.sin(a) * c * 0.86);
      ctx.lineTo(Math.cos(a) * c * (long ? 0.96 : 0.91), Math.sin(a) * c * (long ? 0.96 : 0.91));
      ctx.stroke();
    }
    ctx.lineWidth = size * 0.008;
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.rotate((i / 12) * Math.PI * 2);
      ctx.translate(0, -c * 0.74);
      const s = size * 0.035;
      ctx.beginPath();
      switch (i % 4) {
        case 0: ctx.moveTo(-s, s); ctx.lineTo(0, -s); ctx.lineTo(s, s); ctx.closePath(); break;
        case 1: ctx.moveTo(-s, -s); ctx.lineTo(s, s); ctx.moveTo(s, -s); ctx.lineTo(-s, s); break;
        case 2: ctx.arc(0, 0, s, 0, Math.PI * 2); break;
        default: ctx.moveTo(-s, -s); ctx.lineTo(s, -s); ctx.lineTo(0, s); ctx.closePath(); break;
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = size * 0.008;
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * Math.PI * 2;
      ctx[i === 0 ? 'moveTo' : 'lineTo'](Math.cos(a) * c * 0.6, Math.sin(a) * c * 0.6);
    }
    ctx.closePath();
    ctx.stroke();
  }, { inset: 0.94 });
  return runeTex;
}

let starTex = null;
/** A four-point twinkle with long thin rays — glitter, mana motes, holy sparkle. Reads as a *point of light*, where getSparkTexture's fat 8-point star reads as an object. */
export function getStarTexture() {
  if (starTex) return starTex;
  starTex = makeSprite(128, 128, (ctx, size) => {
    const c = size / 2;
    ctx.globalCompositeOperation = 'lighter';
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.26);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-c, -c, size, size);
    for (const rot of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
      const short = rot % (Math.PI / 2) !== 0; // diagonals are half-length
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      const len = c * (short ? 0.42 : 0.94);
      const wide = c * (short ? 0.05 : 0.07);
      ctx.moveTo(-len, 0);
      ctx.lineTo(0, -wide);
      ctx.lineTo(len, 0);
      ctx.lineTo(0, wide);
      ctx.closePath();
      ctx.fillStyle = short ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.9)';
      ctx.fill();
      ctx.restore();
    }
  }, { inset: 0.9 });
  return starTex;
}

let debrisTex = null;
/**
 * A small angular chip — rock/ice/bone shrapnel thrown by an impact.
 *
 * Deliberately SMALL within its canvas (~45% across) and irregular. The first
 * version filled most of the quad with a near-regular hexagon at high alpha,
 * which at particle scale read as a flat coloured polygon pasted over the
 * scene — clearly visible as red hexagons in a fire impact. A chip needs to
 * read as a fleck: small, lopsided, and soft enough at the edge that it
 * doesn't announce its own geometry.
 */
export function getDebrisTexture() {
  if (debrisTex) return debrisTex;
  debrisTex = makeSprite(128, 128, (ctx, size) => {
    // A small lopsided chip and NOTHING else. Two earlier attempts added
    // structure — six near-equal sides read as a regular polygon, then a
    // rounded quad with a bright triangular facet read as an envelope icon.
    // At the size these actually render (a fleck a few pixels across), any
    // internal detail is noise; all that matters is that the silhouette is
    // irregular and its edge is soft.
    // One fill, no stroke: stroking AND filling the same path at the same
    // alpha double-covers the outline, which drew a brighter rim and turned
    // the chip into a little picture frame.
    ctx.beginPath();
    const pts = [[-0.13, -0.10], [0.11, -0.15], [0.16, 0.05], [-0.04, 0.15]];
    pts.forEach(([x, y], i) => ctx[i === 0 ? 'moveTo' : 'lineTo'](x * size, y * size));
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fill();
    // Soft haze around it, so the silhouette's edge isn't the only thing
    // drawn and the chip sits in the effect rather than on top of it.
    ctx.globalCompositeOperation = 'destination-over';
    const r = size * 0.3;
    const haze = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    haze.addColorStop(0, 'rgba(255,255,255,0.22)');
    haze.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = haze;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  });
  return debrisTex;
}

let beamTex = null;
/**
 * A vertical shaft of light: a narrow hot centre line with wide, very soft
 * shoulders, tapering away at both ends.
 *
 * The first version was a rectangle — a 30%-wide bright band with a 22% fade
 * at each end — and on screen it was unmistakably a glowing SQUARE (Dennis
 * spotted it immediately; it's used by every holy beam, light shaft and
 * portal). Two things fix it: the horizontal falloff is now a proper
 * gaussian-ish curve that's already near zero at 40% out, and both ends fade
 * across a full third of the sprite, so no straight edge survives anywhere.
 */
export function getBeamTexture() {
  if (beamTex) return beamTex;
  beamTex = makeSprite(128, 256, (ctx, w, h) => {
    const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    // Sampled from exp(-(x/0.17)^2): a real bell, not a band with soft sides.
    const stops = [
      [0.00, 0], [0.20, 0.02], [0.30, 0.09], [0.38, 0.30], [0.44, 0.68],
      [0.50, 1], [0.56, 0.68], [0.62, 0.30], [0.70, 0.09], [0.80, 0.02], [1.00, 0],
    ];
    for (const [pos, a] of stops) grad.addColorStop(pos, `rgba(255,255,255,${a})`);
    ctx.fillStyle = grad;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    // Long fades at both ends so a shaft dissolves instead of stopping.
    ctx.globalCompositeOperation = 'destination-in';
    const fade = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    fade.addColorStop(0, 'rgba(255,255,255,0)');
    fade.addColorStop(0.34, 'rgba(255,255,255,1)');
    fade.addColorStop(0.66, 'rgba(255,255,255,1)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = fade;
    ctx.fillRect(-w / 2, -h / 2, w, h);
  });
  return beamTex;
}
