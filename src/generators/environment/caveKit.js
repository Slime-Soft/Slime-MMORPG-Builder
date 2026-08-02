// src/generators/environment/caveKit.js
// The structural half of the cave/dungeon kit: walls, arches, piers, floor
// tiles, columns, spires, stalactites and the natural rock arch.
// The lights and dressing live in ./caveDecor.js.
//
// Built from references/cave-dungeon-massing.md, which is a transcription of
// the six reference sheets — read that first, not this header.
//
// THE ONE TECHNIQUE THAT MAKES THESE READ AS THE REFERENCE. Every sheet shares
// a signature: near-black BLUE stone with every joint and crack catching the
// light. That is not something a flat-shaded material can do, so it is geometry
// here: each stacked surface is a light BACKING SLAB with the dark blocks laid
// on top of it, spaced ~8cm apart. The backing shows through the gaps as grout.
// One extra box per piece, and it is the whole look — without it these are
// black boxes and nothing else about the shapes will save them. (The reference
// sheets' joints are warm tan; see CAVE_SEAM for why this set's are grey.)
//
// The existing rock library (stones.js, rock.js) is deliberately NOT reused:
// its palette is a warm mid-grey and the cave sheets are blue-black. A warm
// piece in this set is wrong even when its shape is right.
//
// THE CEILING KIT'S ONE RULE: a `mounted` piece's MOUNT PLANE IS y = 0. A
// ceiling panel's underside, a torch bracket's centre, a lantern's hook all sit
// at zero and the geometry hangs BELOW it. The author then types the ceiling
// height into the editor's Height field and the piece lands exactly there —
// 3.0 caps a `cave-wall`, 5.0 caps a `cave-wall-tall`. These first shipped with
// their heights baked in (3.4, 4.2, 3.6, 2.0), which made every one of them a
// different, undocumented offset to fight with, and made a room of any height
// but that one impossible to build.
//
// Conventions, same as the rest of the library: front is +Z, nothing
// self-rotates (the author aims it with prop.rotation), everything is built
// through makeKit so a piece costs 3-5 draw calls rather than 60.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte } from './meshKit.js';

// --- palette (section 0 of the spec) ---------------------------------------
// These were first set from the reference's DARKEST pixels and the result was
// an unreadable black silhouette — the sheets look near-black as a whole, but
// their individual block faces sit well above that, which is the only reason
// you can count the blocks at all. Sampled from the block faces instead.
export const CAVE_STONE = [0x3c4657, 0x37414f, 0x424c60];
export const CAVE_STONE_DARK = [0x282f3c, 0x2c3340];
export const CAVE_STONE_LIGHT = [0x525f76, 0x4b576b];
/**
 * The grout showing through every joint.
 *
 * WAS a warm tan (0xa17c48), taken straight off the reference sheets' glowing
 * cracks. In isolation it matched; placed next to the rest of the library it
 * did not — every gap, every backing slab and every boulder crack read as
 * BROWN, which put a warm earth note through a set whose whole point is
 * blue-black stone, and clashed with the actual browns already in the world
 * (timber, dirt, thatch). It is now a neutral grey, still clearly lighter than
 * the block faces so a joint still reads as a joint.
 *
 * Anything that should genuinely stay warm — the mine support's timber, the
 * walkway's boards, candle wax, flame — has its own colour and is unaffected.
 *
 * IT HAS TO BE THIS BRIGHT. The first grey tried was 0x6b7079, which is a
 * perfectly sensible "slightly lighter than the stone" value on a swatch — and
 * every joint disappeared, because a joint is geometry sitting 2-6cm BEHIND
 * the block faces and is therefore in shadow. It has to out-value the stone by
 * a wide margin to read at all once lit. The tan it replaced was bright for
 * the same reason; matching its luminance, not its hue, is what keeps the
 * blocks countable.
 */
export const CAVE_SEAM = 0x969ba4;

/** The material set every piece in this file finishes with. */
export function caveMats(rng, extra = {}) {
  return {
    stone: matte(pick(rng, CAVE_STONE)),
    stoneDark: matte(pick(rng, CAVE_STONE_DARK)),
    stoneLight: matte(pick(rng, CAVE_STONE_LIGHT)),
    seam: matte(CAVE_SEAM),
    ...extra,
  };
}

/** Block body keys, weighted so the wall isn't a checkerboard. */
const BODY_KEYS = ['stone', 'stone', 'stone', 'stoneLight', 'stoneDark'];

// The grout's width. Generous on purpose: at 0.055 the warm backing was
// barely a hairline in a render and the whole identity feature disappeared.
const GAP = 0.085;

// ---------------------------------------------------------------------------
// Shared builders
// ---------------------------------------------------------------------------

/**
 * A course-stacked block face: the warm backing slab plus irregular blocks
 * laid on it. Used by every wall, pier and arch in the file.
 *
 * Each block's DEPTH is jittered on purpose. Blocks sharing an exact front
 * plane is both wrong against the reference (the sheets show blocks standing
 * proud of each other) and a coplanar-face risk once two of them land in
 * different material buckets — see scripts/check-zfight.mjs.
 *
 * @param {object} k a makeKit()
 * @param {() => number} rng
 * @param {{w:number, h:number, d:number, x?:number, y?:number, z?:number,
 *          courses?:number, backing?:boolean, capLight?:boolean, along?:'x'|'z',
 *          skip?: (bx:number, by:number) => boolean}} o
 *   `y` is the BOTTOM of the face, not its centre. `w` runs along `along`
 *   (default X) and `d` across it. `skip` returns true for a block whose centre
 *   should be left out (that is how the arch and the niche get their openings).
 */
export function blockFace(k, rng, o) {
  const { w, h, d, x = 0, y = 0, z = 0, backing = true, capLight = true, along = 'x', skip } = o;
  const courses = o.courses || Math.max(2, Math.round(h / 0.62));
  const ch = h / courses;
  // Along Z, `w` and `d` swap in world axes and the per-block yaw is the same
  // number about the same axis — only the placement changes.
  const alongZ = along === 'z';
  // Two blockFace calls in one prop (a stepped wall's two halves, an arch's
  // piers and its header) overlap where they meet, so their block depths have
  // to come from DIFFERENT series or the two faces put front faces in one
  // plane. The phase is derived from the face's own placement, so it needs no
  // plumbing at the call sites and stays deterministic.
  const phase = (Math.abs(x) * 7.13 + Math.abs(z) * 3.71 + h * 1.37) % 1;
  const put = (key, bw, bh, bd, along1, yy, across, rot) => (alongZ
    ? k.box(key, bd, bh, bw, x + across, yy, z + along1, rot)
    : k.box(key, bw, bh, bd, x + along1, yy, z + across, rot));

  if (backing) {
    // Inset all round so its own edges never break the ragged block outline,
    // and set back so the grout reads as a deep, shadowed seam.
    //
    // The top inset is not cosmetic: flush with the face, the slab's top
    // landed in the same plane as the top course's block tops, and two opaque
    // coplanar faces in different material buckets flicker (check:zfight).
    // 0.11 is the smallest inset that clears the SHORTEST top-course block the
    // height ramp can draw — larger values (0.25 was the first try) open a
    // black void behind the top course that you can see straight into through
    // the grout gaps.
    const bh = h - 0.11;
    put('seam', w - 0.12, bh, d * 0.62, 0, y + bh / 2, -d * 0.02);
  }

  for (let c = 0; c < courses; c++) {
    const cy = y + ch * (c + 0.5);
    // Break the vertical joints differently on every course, so no seam runs
    // the full height (spec 1.3).
    const n = rangeInt(rng, 3, 5);
    const widths = [];
    let total = 0;
    for (let i = 0; i < n; i++) { const bw = range(rng, 0.7, 1.3); widths.push(bw); total += bw; }
    let cursor = -w / 2;
    for (let i = 0; i < n; i++) {
      const bw = (widths[i] / total) * w;
      const bx = cursor + bw / 2;
      cursor += bw;
      if (skip && skip(bx, cy - y)) continue;
      // DEPTH steps the same way, and across courses as well as along one:
      // vertically adjacent blocks overlap in the (x, y) plane too, so their
      // front faces have to be separated as deliberately as their tops.
      // (3c + i) mod 7 differs for every neighbouring pair in the grid.
      const bd = d * (0.9 + ((c * 3 + i) % 7) * 0.028) + phase * 0.05;
      // HEIGHT steps by POSITION, not by a random draw, and for a subtle
      // reason: a block carries a tiny yaw, so its top face's axis-aligned
      // extent is bigger than the block itself. Two neighbours at the same top
      // height therefore overlap in that extent even across a 5cm gap, and two
      // opaque coplanar faces in different material buckets is what
      // check:zfight reports — the whole wall flickered. A random jitter only
      // makes a collision unlikely; a monotonic ramp across the course makes
      // it impossible.
      // The per-call `phase` rides on the HEIGHT ramp as well as the depth
      // one. Two blockFace calls in a piece (a corner's two arms, an arch's
      // piers and header) can share a height `h`, and then share the whole
      // ramp — the corner's arms put block tops in one plane where they meet.
      const bh = (ch - GAP) * (0.86 + (i / n) * 0.3) * (1 + phase * 0.15);
      // Top course reads lightest (it catches the light in every sheet).
      const key = capLight && c === courses - 1 && chance(rng, 0.6)
        ? 'stoneLight' : pick(rng, BODY_KEYS);
      // YAW IS FORCED AWAY FROM ZERO — this is the load-bearing line for the
      // side faces. check:zfight only considers a face axis-aligned when its
      // normal is within 0.999 of an axis (~2.5 degrees). A block turned by at
      // least 0.055 rad is past that, so its four upright faces stop being
      // candidates at all, and two blocks can no longer put their sides in one
      // plane however their widths happen to fall. A *random* ±0.05 yaw left
      // some blocks square, which is exactly where the wall flickered.
      // Top faces are unaffected by yaw — that is what the height ramp above
      // is for. It is also simply truer to the sheets: hand-fitted blocks are
      // never square to each other.
      const yaw = (i % 2 ? 1 : -1) * range(rng, 0.055, 0.1);
      put(key, Math.max(0.18, bw - GAP), bh, bd, bx, cy, 0, [0, yaw, 0]);
    }
  }
}

/**
 * One flat-topped, few-sided cobble. The floor sheets' basic unit: a 5-7 sided
 * chunk with a flat top and slightly tapered sides, never a smooth stone.
 */
export function cobble(k, rng, key, x, y, z, r, h) {
  // YAW ONLY. A cobble used to carry a ±0.03 rad tilt on X and Z as well, and
  // that tilt is why the floors kept flickering however carefully their
  // heights were staggered: a tilted top face is still "axis-aligned enough"
  // for check:zfight (cos 0.03 > 0.999), but the plane it records comes from
  // one vertex, so its coordinate wanders by up to a centimetre and lands back
  // on a neighbour's. The sheets show flat-topped cobbles anyway.
  k.cyl(key, r, r * range(rng, 0.84, 0.96), h, rangeInt(rng, 5, 7), x, y, z,
    [0, range(rng, 0, Math.PI * 2), 0]);
}

/**
 * A cobbled slab: warm backing + a jittered grid of cobbles standing on it.
 * The outer edge is left ragged (cobble-shaped) rather than square — spec 2.
 *
 * @param {{w:number, d?:number, x?:number, z?:number, base?:number, top?:number,
 *          cells?:number, round?:boolean, seamRows?:boolean,
 *          keyFor?: (bx:number, bz:number) => string|null}} o
 *   `base` is the backing slab's thickness, `top` the finished height.
 *   `keyFor` returning null drops that cobble (broken tiles); returning a
 *   material key overrides the body colour (stains, kerbs).
 * @returns {number} the finished top height, for the walkable block
 */
export function cobbleSlab(k, rng, o) {
  const { w, d = o.w, x = 0, z = 0, base = 0.09, top = 0.18, round = false, keyFor } = o;
  const cells = o.cells || Math.max(3, Math.round(w / 0.8));
  const cellsZ = Math.max(3, Math.round((d / w) * cells));
  const cw = w / cells, cd = d / cellsZ;
  const ch = top - base * 0.55; // cobbles sink into the backing, no shared plane
  // A prop can lay several slabs (cave-floor-quad lays four). Same size, same
  // grid, same height ramp — so their cobbles met along the join with tops in
  // one plane. Offsetting the ramp by the slab's own placement fixes it with
  // no plumbing at the call site. The odd multipliers matter: whole numbers
  // put all four of the quad's quadrants back on the same offset.
  const lvl0 = ((Math.round((x * 3.1 + z * 5.7) * 7) % 7) + 7) % 7;

  if (round) k.cyl('seam', w / 2 - 0.22, w / 2 - 0.22, base, 16, x, base / 2, z);
  else k.box('seam', w - 0.26, base, d - 0.26, x, base / 2, z);

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cellsZ; j++) {
      const bx = -w / 2 + cw * (i + 0.5) + range(rng, -cw * 0.1, cw * 0.1);
      const bz = -d / 2 + cd * (j + 0.5) + range(rng, -cd * 0.1, cd * 0.1);
      if (round && Math.hypot(bx, bz) > w / 2 - cw * 0.15) continue;
      const key = keyFor ? keyFor(bx, bz) : pick(rng, BODY_KEYS);
      if (!key) continue;
      // Sized to nearly fill its cell. The first pass used `cell/2 - GAP/2`
      // as a CIRCUMradius, but a 5-7 sided cobble's flats sit ~13% inside its
      // circumradius, so every stone came out a third too small and the tile
      // rendered as dark pebbles scattered on a bright orange mat. The warm
      // backing is meant to be a seam, not the floor.
      const r = Math.min(cw, cd) * 0.58;
      // Same reason as blockFace's height ramp: cobbles carry a random yaw,
      // so identical tops fight even though the cobbles never touch. Here the
      // level comes from BOTH grid axes — (2i + 3j) mod 7 differs for every
      // neighbouring pair, including diagonals, which a single running index
      // cannot promise. It also just looks better: a floor of exactly level
      // stones reads as tiling, not as fitted rock.
      const hh = ch * (0.80 + (((i * 2 + j * 3 + lvl0) % 7) * 0.06));
      cobble(k, rng, key, x + bx, base * 0.45 + hh / 2, z + bz, r * range(rng, 0.95, 1.05), hh);
    }
  }
  return top;
}

/**
 * A stepped spike — the stalagmite/stalactite unit. The sheets never show a
 * smooth cone: each spike has 2-3 visible width breaks along its length.
 * @param {number} dir +1 for a stalagmite standing up, -1 for a hanging drip
 */
export function spike(k, rng, key, x, yBase, z, r, len, dir = 1) {
  const segs = rangeInt(rng, 2, 4);
  let y = yBase;
  let rr = r;
  const lean = [range(rng, -0.06, 0.06), range(rng, 0, Math.PI), range(rng, -0.06, 0.06)];
  for (let s = 0; s < segs; s++) {
    const sl = (len / segs) * range(rng, 0.85, 1.15);
    const rNext = rr * range(rng, 0.5, 0.7) * (s === segs - 1 ? 0.3 : 1);
    // COLLAR. Each segment starts wider than the previous one ended, so the
    // joint is a visible ledge. Without it every segment's base exactly met
    // the last one's tip and the "stepped" spike rendered as one smooth cone —
    // the sheets show 2-3 clear width breaks up each spire.
    const rBase = s === 0 ? rr : rr * 1.3;
    // Overlap each joint by 2cm so the spike is one solid island.
    k.cyl(key, dir > 0 ? rNext : rBase, dir > 0 ? rBase : rNext, sl + 0.02,
      rangeInt(rng, 4, 6), x, y + (dir * sl) / 2, z, lean);
    y += dir * sl;
    rr = rNext;
  }
}

// ---------------------------------------------------------------------------
// 1. Walls (spec section 1)
// ---------------------------------------------------------------------------

function wall(seed, w, h, d) {
  const rng = createRng(seed);
  const k = makeKit();
  blockFace(k, rng, { w, h, d });
  // Buttress blocks at the foot, both ends — every wall piece on the sheet has
  // them and they are what stops the wall reading as a slab dropped on grass.
  for (const sx of [-1, 1]) {
    const bh = range(rng, 0.35, 0.55);
    k.box(pick(rng, BODY_KEYS), range(rng, 0.5, 0.7), bh, d * 0.7,
      sx * (w / 2 - 0.25), bh / 2, d * 0.42, [0, range(rng, -0.15, 0.15), 0]);
  }
  return k.finish(caveMats(rng));
}

export const generateCaveWall = (seed) => wall(seed, 3.0, 3.0, 0.9);
export const generateCaveWallTall = (seed) => wall(seed, 3.0, 5.0, 1.0);

/** Spec 1.2: the left half runs a course or two higher, leaving a ledge. */
export function generateCaveWallStepped(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const D = 0.95;
  blockFace(k, rng, { w: 1.9, h: 3.4, d: D, x: -0.85, courses: 4 });
  blockFace(k, rng, { w: 1.8, h: 2.0, d: D * 0.92, x: 0.9, courses: 3 });
  // Ledge over the lower half, so the step reads as a surface and not a cut.
  // Three stones rather than one slab — a single box across the whole step
  // reads as a poured lintel, which is nowhere on the sheet.
  for (let i = 0; i < 3; i++) {
    k.box(i === 1 ? 'stoneLight' : pick(rng, BODY_KEYS), 0.58, 0.15 + i * 0.012, D * 0.96,
      0.9 + (i - 1) * 0.62, 2.04, 0.01, [0, (i % 2 ? 1 : -1) * range(rng, 0.06, 0.11), 0]);
  }
  for (const sx of [-1, 1]) {
    k.box(pick(rng, BODY_KEYS), 0.6, 0.42, D * 0.7, sx * 1.5, 0.21, D * 0.42);
  }
  return k.finish(caveMats(rng));
}

/** An L, for turning a corridor. Both arms 2.4m from the inside corner. */
export function generateCaveWallCorner(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const D = 0.9, H = 3.0, L = 2.4;
  // Each arm runs from INSIDE the corner block to the end of the piece. Sizing
  // them `L - D` and pushing them clear of the corner instead left a 42cm hole
  // where the two walls should meet — it read as two walls, not a corner.
  const armW = L - D * 0.5;
  const armX = -L / 2 + D * 0.5 + armW / 2;
  blockFace(k, rng, { w: armW, h: H, d: D, x: armX, z: -L / 2 });
  // Arm along +Z. Same builder, `along:'z'` — a rotation would need the whole
  // kit re-centred, and this piece is authored rather than generated in place.
  blockFace(k, rng, { w: armW, h: H, d: D, along: 'z', x: -L / 2, z: armX });
  // The corner block itself, tying the two arms together.
  k.box('stoneLight', D * 1.06, H, D * 1.06, -L / 2, H / 2, -L / 2);
  for (const [bx, bz] of [[L / 2 - 0.3, -L / 2 + D * 0.45], [-L / 2 + D * 0.45, L / 2 - 0.3]]) {
    k.box(pick(rng, BODY_KEYS), 0.55, 0.45, 0.5, bx, 0.22, bz, [0, range(rng, -0.2, 0.2), 0]);
  }
  return k.finish(caveMats(rng));
}

/** Spec 1 (bottom row): a wall with a rectangular niche in the middle course. */
export function generateCaveWallNiche(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.0, H = 3.0, D = 1.0;
  const skip = (bx, by) => Math.abs(bx) < 0.55 && by > 1.0 && by < 2.0;
  // NO shared backing slab. blockFace's warm slab spans the whole face, so
  // with blocks skipped for the alcove it showed straight through the opening
  // as a flat orange panel — the niche read as a lit doorway. The grout is
  // laid here as two side slabs and a header instead, none of which reaches
  // across the opening.
  blockFace(k, rng, { w: W, h: H, d: D, courses: 4, backing: false, skip });
  for (const sx of [-1, 1]) {
    // Kept inboard of the blocks' own outer edge (w/2 - GAP/2), or the slab
    // shows as a bright orange fin down the end of the wall.
    k.box('seam', 0.66, H - 0.11, D * 0.62, sx * 1.06, (H - 0.11) / 2, -D * 0.02);
  }
  // Header and sill grout sit BEHIND the alcove's back panel. In front of it
  // they were visible straight through the opening, and the niche read as a
  // lit doorway rather than a shadowed recess.
  k.box('seam', 1.3, 0.7, 0.2, 0, 2.3, -D * 0.45);
  k.box('seam', 1.3, 0.85, 0.2, 0, 0.5, -D * 0.45);
  // The alcove's own back and reveals, set behind the wall face.
  k.box('stoneDark', 1.5, 1.1, 0.16, 0, 1.5, -D * 0.32);
  k.box('stoneDark', 1.5, 0.14, D * 0.5, 0, 1.0, -D * 0.12);
  k.box('stoneLight', 1.6, 0.18, D * 0.62, 0, 2.06, -D * 0.06);
  for (const sx of [-1, 1]) {
    k.box(pick(rng, BODY_KEYS), 0.5, 0.4, D * 0.7, sx * (W / 2 - 0.25), 0.2, D * 0.4);
  }
  return k.finish(caveMats(rng));
}

/** Spec 1.4: two piers, a two-course header, the opening's corners softened. */
export function generateCaveArch(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 4.0, D = 1.1;
  const PIER_W = 1.2, OPEN = 1.9, HEAD = 1.2;
  const pierX = OPEN / 2 + PIER_W / 2;
  for (const sx of [-1, 1]) {
    blockFace(k, rng, { w: PIER_W, h: H - HEAD, d: D, x: sx * pierX, courses: 4 });
    // Outer buttress at the base (spec: "small blocks buttress each pier").
    k.box(pick(rng, BODY_KEYS), 0.55, 0.5, D * 0.8, sx * (pierX + PIER_W / 2 - 0.1), 0.25, D * 0.35);
    // Half-block softening the opening's top corner.
    k.box('stoneLight', 0.5, 0.4, D * 0.9, sx * (OPEN / 2 - 0.12), H - HEAD - 0.22, 0.02,
      [0, 0, sx * 0.34]);
  }
  blockFace(k, rng, {
    w: OPEN + PIER_W * 2, h: HEAD, d: D * 1.04, y: H - HEAD, courses: 2,
  });
  return k.finish(caveMats(rng));
}

/** Spec 1.6: leaning piers, a rounded head, drips hanging into the opening. */
export function generateCaveArchNatural(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 4.3, D = 1.15, OPEN = 2.0;
  for (const sx of [-1, 1]) {
    const px = sx * (OPEN / 2 + 0.7);
    blockFace(k, rng, { w: 1.5, h: H - 1.5, d: D, x: px, courses: 4 });
    // The lean. These used to sit INSIDE the opening (x = OPEN/2 - …) and
    // three of them per side closed it up completely — the piece read as one
    // lumpy mass with no arch in it. They now stand just outside the reveal
    // and lean over it, which is what the sheet shows.
    for (let i = 0; i < 3; i++) {
      const y = 0.9 + i * 0.85;
      k.box(pick(rng, BODY_KEYS), range(rng, 0.5, 0.8), 0.62, D * range(rng, 0.7, 0.95),
        sx * (OPEN / 2 + 0.22 - i * 0.06), y, range(rng, -0.12, 0.12),
        // Yaw forced past ~2.5 degrees, same as blockFace's — below that an
        // upright face is still a coplanar candidate and these fought the
        // piers' faces.
        [0, (i % 2 ? 1 : -1) * range(rng, 0.09, 0.24), sx * range(rng, 0.08, 0.2)]);
    }
  }
  // Rounded head: a shallow ring of blocks stepping over the opening.
  for (let i = 0; i <= 6; i++) {
    const t = (i / 6) * Math.PI;
    const bx = -Math.cos(t) * (OPEN / 2 + 0.42);
    const by = H - 1.35 + Math.sin(t) * 0.62;
    k.box(pick(rng, BODY_KEYS), 0.78, 0.66, D * range(rng, 0.85, 1.05), bx, by,
      range(rng, -0.08, 0.08),
      [0, (i % 2 ? 1 : -1) * range(rng, 0.09, 0.24), -Math.cos(t) * 0.5]);
  }
  k.box('seam', OPEN + 1.0, 0.5, D * 0.5, 0, H - 1.3, -D * 0.1);
  blockFace(k, rng, { w: OPEN + 2.6, h: 0.85, d: D, y: H - 0.85, courses: 1, backing: false });
  k.box('seam', OPEN + 2.4, 0.3, D * 0.6, 0, H - 0.9, -D * 0.08);
  // Drips under the head, hanging INTO the opening — the identity feature.
  const drips = rangeInt(rng, 6, 9);
  for (let i = 0; i < drips; i++) {
    const dx = -OPEN / 2 + (OPEN / (drips - 1)) * i + range(rng, -0.08, 0.08);
    // Hung from the arc the head blocks actually follow, so each drip starts
    // inside stone instead of at one flat hardcoded height.
    const t = Math.acos(Math.max(-1, Math.min(1, -dx / (OPEN / 2 + 0.42))));
    const under = H - 1.42 + Math.sin(t) * 0.62 - 0.3;
    spike(k, rng, 'stoneDark', dx, under, range(rng, -0.15, 0.15),
      range(rng, 0.11, 0.19), range(rng, 0.4, 0.95), -1);
  }
  return k.finish(caveMats(rng));
}

/** Spec 1.5: tapered pier — wide capital, waisted stem, ring of base blocks. */
export function generateCavePier(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 3.6;
  k.box('seam', 1.0, H - 0.5, 1.0, 0, (H - 0.5) / 2, 0);
  // The capital used to flare to r=1.02 out of a 0.62 waist and the piece read
  // as a mushroom lamp, not as sheet 1.5's pier. The flare is now modest and
  // the blocks are fewer and chunkier, so you can count them.
  const rings = [
    { y: 0.0, h: 0.6, r: 0.92 },
    { y: 0.6, h: 0.7, r: 0.8 },
    { y: 1.3, h: 0.8, r: 0.66 },
    { y: 2.1, h: 0.7, r: 0.7 },
    { y: 2.8, h: 0.8, r: 0.86 },
  ];
  for (const ring of rings) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + range(rng, -0.1, 0.1);
      const key = ring === rings[rings.length - 1] ? 'stoneLight' : pick(rng, BODY_KEYS);
      k.box(key, ring.r * 0.95, (ring.h - GAP) * (0.82 + (i / n) * 0.36), ring.r * 0.75,
        Math.sin(a) * ring.r * 0.62, ring.y + ring.h / 2, Math.cos(a) * ring.r * 0.62,
        [0, a, 0]);
    }
  }
  // Base skirt.
  for (let i = 0; i < 6; i++) {
    const a = range(rng, 0, Math.PI * 2);
    k.box(pick(rng, BODY_KEYS), range(rng, 0.35, 0.55), range(rng, 0.25, 0.4), range(rng, 0.35, 0.5),
      Math.sin(a) * 0.85, 0.2, Math.cos(a) * 0.85, [0, a, 0]);
  }
  return k.finish(caveMats(rng));
}

/** A pile of loose blocks. */
export function generateCaveRubble(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const n = rangeInt(rng, 12, 17);
  for (let i = 0; i < n; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const rad = range(rng, 0, 0.85);
    const s = range(rng, 0.24, 0.5);
    const bh = s * range(rng, 0.6, 0.9), bd = s * range(rng, 0.8, 1.2);
    const tilt = [range(rng, -0.3, 0.3), a, range(rng, -0.3, 0.3)];
    // Lowest corner of a tilted box, so no block ever cuts below y=0. Tilting
    // first and floating the pile 10cm up afterwards is what a rubble heap
    // looks like from above and a hovering one looks like from the side.
    const drop = (Math.abs(Math.sin(tilt[0])) + Math.abs(Math.sin(tilt[2]))) * Math.max(s, bd) / 2;
    const y = Math.max(bh / 2 + drop, (0.85 - rad) * range(rng, 0.5, 1.0));
    k.box(pick(rng, BODY_KEYS), s, bh, bd, Math.sin(a) * rad, y, Math.cos(a) * rad, tilt);
  }
  // Small enough to stay UNDER the pile: at 1.3m square it stuck out all round
  // as a bright orange mat.
  k.box('seam', 0.9, 0.12, 0.9, 0, 0.06, 0);
  return k.finish(caveMats(rng));
}

// ---------------------------------------------------------------------------
// 2. Floors (spec section 2)
// ---------------------------------------------------------------------------

export function generateCaveFloorTile(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleSlab(k, rng, { w: 4.0, cells: 5 });
  return k.finish(caveMats(rng));
}

export function generateCaveFloorSmall(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleSlab(k, rng, { w: 2.0, cells: 3 });
  return k.finish(caveMats(rng));
}

/** Spec 2: split by a cross seam into four quadrants, wider than the grout. */
export function generateCaveFloorQuad(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 4.0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cobbleSlab(k, rng, { w: W / 2 - 0.12, x: sx * W / 4, z: sz * W / 4, cells: 3 });
    }
  }
  return k.finish(caveMats(rng));
}

/** Ragged, with rubble crumbling off two edges. */
export function generateCaveFloorBroken(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.4;
  cobbleSlab(k, rng, {
    w: W, cells: 4,
    // Drop a corner and thin the far edge so the outline breaks up.
    keyFor: (bx, bz) => (bx > W * 0.2 && bz > W * 0.2 ? null
      : (bz > W * 0.3 && chance(rng, 0.35) ? null : pick(rng, BODY_KEYS))),
  });
  for (let i = 0; i < 8; i++) {
    const bx = range(rng, W * 0.15, W * 0.62);
    const bz = range(rng, W * 0.15, W * 0.62);
    cobble(k, rng, pick(rng, BODY_KEYS), bx, range(rng, 0.05, 0.09), bz,
      range(rng, 0.14, 0.26), range(rng, 0.1, 0.16));
  }
  return k.finish(caveMats(rng));
}

/** A tile with a dark stained patch — the stain is flat, never raised. */
export function generateCaveFloorStain(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.4;
  const cx = range(rng, -0.5, 0.5), cz = range(rng, -0.5, 0.5);
  cobbleSlab(k, rng, {
    w: W, cells: 4,
    keyFor: (bx, bz) => (Math.hypot(bx - cx, bz - cz) < 1.0 ? 'stain' : pick(rng, BODY_KEYS)),
  });
  return k.finish(caveMats(rng, { stain: matte(0x141a15) }));
}

/** Spec 3 (bottom centre): a round platform, a step high. */
export function generateCaveFloorRound(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleSlab(k, rng, { w: 4.0, cells: 5, round: true, base: 0.14, top: 0.30 });
  // A ring of kerb blocks around the rim, which is what gives it thickness.
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + range(rng, -0.06, 0.06);
    // A LOW foot ring: at kerb height it shared a plane with the cobble
    // field's tops. Reading as a footing rather than a rim is also closer to
    // the sheet, where the platform's edge is the cobbles themselves.
    const kh = 0.16 + (i / 16) * 0.06;
    k.box(pick(rng, BODY_KEYS), 0.42, kh, 0.34,
      Math.sin(a) * 1.86, kh / 2, Math.cos(a) * 1.86, [0, a, 0]);
  }
  return k.finish(caveMats(rng));
}

// ---------------------------------------------------------------------------
// 2b. Ceilings — the pieces that make a dungeon INDOORS
// ---------------------------------------------------------------------------
//
// The floors, walls and arches build a room you can walk around; without a lid
// you are still standing outside under an open sky, and every one of the
// atmosphere's tricks (sun, cloud shadows, fog) says so. These are the lid.
//
// MOUNT PLANE AT y = 0, per the file header: the visible underside is at zero
// and everything hangs below it, so the editor's Height field IS the ceiling
// height. Set 3.0 over a ring of `cave-wall` and the panel closes it exactly.
//
// They are laid out to tile with the floors on the same 4m / 2m module, so a
// room can be built as a grid: floor tiles down, walls round, ceiling panels
// over, at the same spacing.

/**
 * A cobbled panel hanging under its mount plane — the ceiling twin of
 * cobbleSlab, and deliberately the same stones so a lit ceiling and a lit
 * floor read as the same rock.
 *
 * Not cobbleSlab with a flipped sign: the two differ in what has to be hidden.
 * A floor hides its backing UNDER the stones and shows their tops; a ceiling
 * hides its backing ABOVE them and shows their undersides, so the stones taper
 * the other way and the grout gap has to be read from below.
 *
 * @param {{w:number, d?:number, x?:number, z?:number, cells?:number,
 *          drop?:number, keyFor?: (bx:number, bz:number) => string|null}} o
 *   `drop` is how far the deepest stone hangs below the mount plane.
 */
export function cobbleCeiling(k, rng, o) {
  const { w, d = o.w, x = 0, z = 0, drop = 0.26, keyFor } = o;
  const cells = o.cells || Math.max(3, Math.round(w / 0.8));
  const cellsZ = Math.max(3, Math.round((d / w) * cells));
  const cw = w / cells, cd = d / cellsZ;
  // Backing sits ABOVE the mount plane, so nothing of it is ever in shot from
  // below except through the grout gaps — which is the entire point of it.
  k.box('seam', w - 0.26, 0.16, d - 0.26, x, 0.1, z);
  const lvl0 = ((Math.round((x * 3.1 + z * 5.7) * 7) % 7) + 7) % 7;

  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cellsZ; j++) {
      const bx = -w / 2 + cw * (i + 0.5) + range(rng, -cw * 0.1, cw * 0.1);
      const bz = -d / 2 + cd * (j + 0.5) + range(rng, -cd * 0.1, cd * 0.1);
      const key = keyFor ? keyFor(bx, bz) : pick(rng, BODY_KEYS);
      if (!key) continue;
      const r = Math.min(cw, cd) * 0.58;
      // Stones hang to DIFFERENT depths, on the same 2-axis scheme the floors
      // use. It is not only for looks: a ceiling's visible faces point DOWN,
      // and check:zfight skips -Y faces entirely (it assumes the camera is
      // always above the ground — true outdoors, false under a roof), so
      // nothing would catch a flat ceiling of identical stones flickering.
      // Staggering them is the fix, applied rather than relied upon.
      const hang = drop * (0.62 + ((i * 2 + j * 3 + lvl0) % 7) * 0.063);
      // How far the stone pushes UP into the backing also steps, on its own
      // series. Those top faces are buried and never seen, but they are still
      // opaque faces in a different material bucket from the backing, and at a
      // constant embed depth every one of them landed in a single plane.
      //
      // The multipliers are 3 and 1, NOT 3 and 2: with (3i + 2j) a DIAGONAL
      // pair differs by 5, which is 0 mod 5, so diagonal neighbours shared a
      // level — and with the position jitter they overlap often enough to
      // fight. Any scheme here has to separate all four neighbours *and* both
      // diagonals.
      const embed = 0.05 + ((i * 3 + j + lvl0) % 5) * 0.022;
      // Cylinder taper reversed against the floor's: wider where it meets the
      // backing, narrower at the face you actually see.
      k.cyl(key, r * range(rng, 0.95, 1.05), r * range(rng, 0.8, 0.92), hang + embed,
        rangeInt(rng, 5, 7), x + bx, (embed - hang) / 2, z + bz,
        [0, range(rng, 0, Math.PI * 2), 0]);
    }
  }
}

/** A row of drips along one edge, for the wall/ceiling junction. */
function dripEdge(k, rng, along, edge, halfLen, count) {
  for (let i = 0; i < count; i++) {
    const t = -halfLen + ((halfLen * 2) / (count - 1)) * i + range(rng, -0.1, 0.1);
    const px = along === 'x' ? t : edge;
    const pz = along === 'x' ? edge : t;
    spike(k, rng, pick(rng, BODY_KEYS), px, -0.04, pz,
      range(rng, 0.1, 0.2), range(rng, 0.35, 0.95), -1);
  }
}

/** 4 m square panel — the standard bay, matching `cave-floor-tile`. */
export function generateCaveCeilingTile(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleCeiling(k, rng, { w: 4.0, cells: 5 });
  return k.finish(caveMats(rng));
}

/** 2 m square panel, for closing gaps and small chambers. */
export function generateCaveCeilingSmall(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleCeiling(k, rng, { w: 2.0, cells: 3 });
  return k.finish(caveMats(rng));
}

/**
 * The natural cavern roof: no grid, no joints — lumps of rock at wildly
 * different depths with a few drips. Sheet 6's room has this over its edges
 * and the paved panel look only in the middle, and mixing the two is what
 * stops a big dungeon reading as a tiled bathroom.
 */
export function generateCaveCeilingRough(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 4.0;
  k.box('seam', W - 0.3, 0.16, W - 0.3, 0, 0.1, 0);
  const cells = 4;
  const cw = W / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const bx = -W / 2 + cw * (i + 0.5) + range(rng, -cw * 0.22, cw * 0.22);
      const bz = -W / 2 + cw * (j + 0.5) + range(rng, -cw * 0.22, cw * 0.22);
      // Far deeper spread than the panel's — that irregularity IS the look,
      // and at the panel's own range it rendered as one flat slab from below.
      const hang = 0.15 + ((i * 2 + j * 3) % 7) * 0.14;
      const embed = 0.05 + ((i * 3 + j) % 5) * 0.022; // see cobbleCeiling
      k.box(pick(rng, BODY_KEYS), cw * range(rng, 0.9, 1.25), hang + embed, cw * range(rng, 0.9, 1.25),
        bx, (embed - hang) / 2, bz,
        // Tilt forced away from zero on X and Z as well as yaw on Y. A rough
        // roof's lumps are meant to sit at angles anyway, and past ~0.05 rad
        // a face stops being a coplanar candidate at all (check:zfight) — a
        // random ±0.09 leaves some of them dead flat, which is exactly where
        // two of them shared a plane.
        [(j % 2 ? 1 : -1) * range(rng, 0.05, 0.11),
          (i % 2 ? 1 : -1) * range(rng, 0.09, 0.24),
          ((i + j) % 2 ? 1 : -1) * range(rng, 0.05, 0.11)]);
    }
  }
  for (let i = 0; i < rangeInt(rng, 7, 11); i++) {
    spike(k, rng, 'stoneDark', range(rng, -1.7, 1.7), -0.18, range(rng, -1.7, 1.7),
      range(rng, 0.1, 0.2), range(rng, 0.3, 0.9), -1);
  }
  return k.finish(caveMats(rng));
}

/** Panel with a fringe of drips down its +Z edge — the wall/ceiling junction. */
export function generateCaveCeilingFringe(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleCeiling(k, rng, { w: 4.0, cells: 5 });
  dripEdge(k, rng, 'x', 1.78, 1.8, rangeInt(rng, 7, 10));
  return k.finish(caveMats(rng));
}

/** Fringe down TWO edges (+Z and +X), for a room's corner bay. */
export function generateCaveCeilingCorner(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  cobbleCeiling(k, rng, { w: 4.0, cells: 5 });
  dripEdge(k, rng, 'x', 1.78, 1.8, rangeInt(rng, 7, 9));
  dripEdge(k, rng, 'z', 1.78, 1.55, rangeInt(rng, 6, 8));
  return k.finish(caveMats(rng));
}

// ---------------------------------------------------------------------------
// 3. Formations (spec section 3)
// ---------------------------------------------------------------------------

/** Wide cobbled capital, waisted fluted stem, chunky base. ~6 m. */
export function generateCaveColumn(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 6.0;
  k.cyl('seam', 0.42, 0.5, H, 8, 0, H / 2, 0);
  // Fluting: 6 vertical facets, each a tapered slab following the waist.
  const profile = (t) => 1.15 - Math.sin(Math.min(1, t) * Math.PI) * 0.62; // 1.15 -> 0.53 -> 1.15
  const flutes = 6;
  const bands = 7;
  for (let b = 0; b < bands; b++) {
    const t0 = b / bands, t1 = (b + 1) / bands;
    const y = 0.55 + (H - 1.5) * ((t0 + t1) / 2);
    const r = (profile(t0) + profile(t1)) / 2;
    for (let f = 0; f < flutes; f++) {
      const a = (f / flutes) * Math.PI * 2 + b * 0.06;
      k.box(b === bands - 1 ? 'stoneLight' : pick(rng, BODY_KEYS),
        r * 0.75, (((H - 1.5) / bands) - GAP) * (0.82 + (f / flutes) * 0.36), r * 0.5,
        Math.sin(a) * r * 0.62, y, Math.cos(a) * r * 0.62, [0, a, 0]);
    }
  }
  // Capital: a cobbled disc of the same unit as the floors, laid by hand
  // because cobbleSlab always builds at ground level.
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const rr = 1.5 * (i % 2 ? 0.62 : 0.95);
    cobble(k, rng, pick(rng, BODY_KEYS), Math.sin(a) * rr, H - 0.32, Math.cos(a) * rr,
      range(rng, 0.28, 0.42), 0.36 + (i / 14) * 0.36);
  }
  cobble(k, rng, 'stoneLight', 0, H - 0.32, 0, 0.55, 0.52);
  k.cyl('seam', 1.45, 1.3, 0.3, 12, 0, H - 0.62, 0);
  // Base blocks. Centre is half the block's own height or higher — a block
  // placed at a fixed y sinks whenever it draws a tall enough height.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + range(rng, -0.1, 0.1);
    const bh = range(rng, 0.4, 0.75);
    k.box(pick(rng, BODY_KEYS), range(rng, 0.5, 0.7), bh, range(rng, 0.45, 0.6),
      Math.sin(a) * 0.85, bh / 2, Math.cos(a) * 0.85, [0, a, 0]);
  }
  return k.finish(caveMats(rng));
}

/** One tall stalagmite, 3-4x a figure. */
export function generateCaveSpire(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  spike(k, rng, 'stone', 0, 0, 0, 0.62, range(rng, 3.6, 4.6), 1);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + range(rng, -0.2, 0.2);
    k.box(pick(rng, BODY_KEYS), range(rng, 0.35, 0.55), range(rng, 0.25, 0.45), range(rng, 0.3, 0.45),
      Math.sin(a) * 0.6, 0.23, Math.cos(a) * 0.6, [0, a, 0]);
  }
  // Small enough to stay under the base blocks — at 1.1m it read as an orange
  // doormat around the spire.
  k.box('seam', 0.72, 0.12, 0.72, 0, 0.06, 0);
  return k.finish(caveMats(rng));
}

/** A cluster: tallest in the middle, sharing a base of small blocks. */
export function generateCaveStalagmites(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const n = rangeInt(rng, 3, 5);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const rad = i === 0 ? 0 : range(rng, 0.3, 0.62);
    const len = i === 0 ? range(rng, 1.9, 2.5) : range(rng, 0.8, 1.6);
    spike(k, rng, pick(rng, BODY_KEYS), Math.sin(a) * rad, 0, Math.cos(a) * rad,
      range(rng, 0.24, 0.4), len, 1);
  }
  for (let i = 0; i < 6; i++) {
    const a = range(rng, 0, Math.PI * 2);
    k.box(pick(rng, BODY_KEYS), range(rng, 0.3, 0.48), range(rng, 0.2, 0.34), range(rng, 0.3, 0.42),
      Math.sin(a) * range(rng, 0.5, 0.85), 0.17, Math.cos(a) * range(rng, 0.5, 0.85), [0, a, 0]);
  }
  k.box('seam', 0.95, 0.1, 0.95, 0, 0.05, 0);
  return k.finish(caveMats(rng));
}

// --- ceiling pieces. These hang; they never reach y=0. See the `mounted` flag
// in src/sim/propTypes.js and the exemptions in check-props/check-parts. ---

/** A small cap with 3-5 drips under it, for hanging off a ceiling. */
export function generateCaveStalactites(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  // MOUNT PLANE AT y = 0 — see the CEILING KIT note further down. The author
  // sets the height with the editor's Height field; nothing here bakes one in.
  const TOP = 0;
  cobbleRoof(k, rng, 1.1, TOP, 3);
  const n = rangeInt(rng, 3, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const rad = i === 0 ? 0 : range(rng, 0.15, 0.45);
    // Started high enough to bite into the thinnest cobble the roof can draw:
    // thinning the warm disc dropped the drips clear of it and check:parts
    // caught them hanging in mid-air.
    spike(k, rng, pick(rng, BODY_KEYS), Math.sin(a) * rad, TOP - 0.05, Math.cos(a) * rad,
      range(rng, 0.14, 0.24), i === 0 ? range(rng, 1.1, 1.7) : range(rng, 0.5, 1.1), -1);
  }
  return k.finish(caveMats(rng));
}

/** A cobbled ceiling disc, laid downward-facing. Shared by the two roof props. */
function cobbleRoof(k, rng, radius, y, ring = 5) {
  // The warm disc is a SEAM, so it has to stay well inside the cobbles that
  // cover it. At the full radius it was a bright orange plate hanging from the
  // ceiling with a few dark stones stuck to it.
  // Thin and set low, not just narrow: at 16cm thick its TOP half stood proud
  // of every cobble and the piece read as an orange plate with stones stuck
  // underneath.
  k.cyl('seam', radius * 0.72, radius * 0.66, 0.08, 14, 0, y - 0.02, 0);
  // Heights ramp strictly upward across EVERY cobble on the disc, centre
  // included. A per-ring ramp isn't enough: the inner and outer rings sit
  // close enough that a cobble from each can overlap, and two of them at the
  // same height would then fight (check:zfight). A single ramp makes every
  // top face on the piece a distinct plane by construction.
  const counts = [1, ring, ring * 2];
  const total = counts[0] + counts[1] + counts[2];
  let ci = 0;
  const nextH = () => 0.16 + (ci++ / total) * 0.20;
  cobble(k, rng, 'stoneDark', 0, y - 0.04, 0, radius * 0.4, nextH());
  for (let r = 1; r <= 2; r++) {
    const n = counts[r];
    const rad = radius * (r === 1 ? 0.46 : 0.8);
    // Enough radius to close the ring at this many stones, plus a little.
    const cr = Math.max(radius * 0.22, (Math.PI * rad) / n * 0.62);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.4;
      cobble(k, rng, pick(rng, BODY_KEYS), Math.sin(a) * rad, y - 0.04, Math.cos(a) * rad,
        cr * range(rng, 0.95, 1.1), nextH());
    }
  }
}

/** Spec 3 top-left: a big ceiling chunk with a fringe of drips. */
export function generateCaveCeilingSlab(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const TOP = 0; // mount plane; see the CEILING KIT note
  cobbleRoof(k, rng, 2.2, TOP, 6);
  const n = rangeInt(rng, 9, 13);
  for (let i = 0; i < n; i++) {
    const a = range(rng, 0, Math.PI * 2);
    const rad = range(rng, 0, 1.85);
    // Longest at the centre, shortest at the rim (spec).
    const len = (1.9 - rad * 0.75) * range(rng, 0.6, 1.15);
    spike(k, rng, pick(rng, BODY_KEYS), Math.sin(a) * rad, TOP - 0.05, Math.cos(a) * rad,
      range(rng, 0.12, 0.24), Math.max(0.35, len), -1);
  }
  return k.finish(caveMats(rng));
}

/** A natural bridge: two footings, a thick block span, deliberately asymmetric. */
export function generateCaveRockArch(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const SPAN = 5.0, H = 3.6;
  const footW = [1.5, 1.1];
  for (const s of [0, 1]) {
    const sx = s ? 1 : -1;
    blockFace(k, rng, {
      w: footW[s], h: H - 1.5 - s * 0.3, d: 1.2, x: sx * (SPAN / 2 - footW[s] / 2), courses: 3,
    });
  }
  // The span itself: blocks stepping over the gap on a shallow arc.
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const bx = -SPAN / 2 + 0.7 + t * (SPAN - 1.4);
    const arc = Math.sin(t * Math.PI);
    const by = H - 1.5 + arc * 1.1 - 0.1;
    k.box(pick(rng, BODY_KEYS), range(rng, 0.62, 0.86), range(rng, 0.6, 0.95), range(rng, 0.9, 1.25),
      bx, by, range(rng, -0.12, 0.12),
      // Yaw forced off-square (see blockFace) so the span's blocks can't put
      // their upright faces in a shared plane.
      [0, (i % 2 ? 1 : -1) * range(rng, 0.09, 0.24), Math.cos(t * Math.PI) * -0.35]);
  }
  k.box('seam', SPAN - 1.0, 0.5, 0.68, 0, H - 1.17, -0.1);
  // A couple of drips under the span's centre. Their attach height comes from
  // the SAME arc the span blocks are laid on — a hardcoded y left them hanging
  // a metre below the stone with nothing between.
  for (let i = 0; i < 3; i++) {
    const dx = range(rng, -0.9, 0.9);
    const t = (dx + SPAN / 2 - 0.7) / (SPAN - 1.4);
    const under = H - 1.6 + Math.sin(t * Math.PI) * 1.1 - 0.36;
    spike(k, rng, 'stoneDark', dx, under, range(rng, -0.2, 0.2),
      range(rng, 0.1, 0.16), range(rng, 0.3, 0.6), -1);
  }
  return k.finish(caveMats(rng));
}

/** Spec 5: a dark faceted boulder, cracks warm between the planes. */
export function generateCaveBoulder(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const R = range(rng, 0.9, 1.25);
  // The warm core is what shows through the cracks between facets. At R*1.02
  // it was the same size as the facet shell and the boulder read as an orange
  // rock wearing dark plates.
  k.ico('seam', R * 0.94, 0, R * 0.62, 0, [1, 0.72, 1]);
  // Faceted shell: chunky slabs standing off the warm core, gaps = the cracks.
  const facets = rangeInt(rng, 7, 10);
  for (let i = 0; i < facets; i++) {
    const a = (i / facets) * Math.PI * 2 + range(rng, -0.15, 0.15);
    const tilt = range(rng, -0.5, 0.15);
    const rr = R * range(rng, 0.72, 0.92);
    k.box(pick(rng, BODY_KEYS), R * range(rng, 0.85, 1.15), R * range(rng, 0.72, 1.05), R * 0.72,
      Math.sin(a) * rr * 0.58, R * 0.62 + Math.sin(-tilt) * R * 0.4, Math.cos(a) * rr * 0.58,
      [tilt * Math.cos(a), a, -tilt * Math.sin(a)]);
  }
  k.ico('stoneLight', R * 0.66, 0, R * 1.02, 0, [1.1, 0.7, 1.1]);
  // Two small companions, as on the sheet.
  for (const sx of [-1, 1]) {
    const r = R * range(rng, 0.28, 0.42);
    k.ico(pick(rng, BODY_KEYS), r, sx * R * range(rng, 1.2, 1.5), r * 0.7,
      range(rng, -0.6, 0.6), [1.2, 0.8, 1.1]);
  }
  return k.finish(caveMats(rng));
}
