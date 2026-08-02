// src/generators/environment/cityWall.js
// The city's curtain wall and its towers, rebuilt 2026-07-31 from Dennis's
// reference sheets (the "WALLS & DEFENSES" row: straight wall, gate, small and
// large towers, archer tower).
//
// What the old wall was: ONE box plus a row of 0.7 m cubes on top. At the ring's
// real dimensions (19.4 m long, 10 m tall, 2.6 m thick) that reads as a grey
// slab — no base, no depth, no shadow line, and nothing at all at eye level,
// which is the only height a player ever sees it from.
//
// What the reference actually has, and what this builds:
//   - a BATTERED BASE: three stepped courses flaring out at the foot, so the
//     wall grows out of the ground instead of being stuck into it;
//   - horizontal COURSE BANDS standing proud of the face, which is what puts a
//     shadow line on a big flat surface and gives it scale;
//   - a CORNICE on corbels (machicolation) under the parapet — the single
//     detail that separates a castle wall from a retaining wall;
//   - CRENELLATIONS with capped merlons, on BOTH long edges with a wall-walk
//     between them (see the symmetry note below);
//   - ARROW LOOPS with a lintel and sill, and hanging HERALDIC SHIELDS.
//
// DELIBERATELY FRONT/BACK SYMMETRIC. Everywhere else in this library the
// convention is "front is +Z, the author aims it" — a wall can't work that way.
// world.walls[] entries carry a rotationDeg that was authored to make the ring
// tangent, and for the existing 40-segment ring that puts local +Z INWARD, a
// fact nothing in the data records. A wall with a decorated outer face and a
// plain inner one would therefore come out inside-out on half of any future
// ring, silently. Symmetric geometry cannot be placed backwards.
//
// Every accent piece is either PROUD of the face it sits on or SUNK into the
// piece below it — never flush. Two opaque faces in one plane is a hard
// depth-buffer flicker; see scripts/check-zfight.mjs for the townhouse bug that
// taught this. The offsets below all exist for that reason.
//
// Built through meshKit, so a whole gatehouse is 4-6 draw calls.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal } from './meshKit.js';

// Kept in the same family as townDecor.js's STONE (0xb4aca0 …) on purpose: the
// wall stands behind the town's own stonework in almost every shot of the city,
// and a first pass two shades darker made the whole ring read as a bruise
// behind the buildings rather than as the same quarry.
const STONE = [0xb2aa9d, 0xbbb3a5, 0xa8a094];
const STONE_LIGHT = 0xc2bbad;
const STONE_DARK = 0x8d8578;
const SLOT = 0x1c1a18;      // the black of an arrow loop / an open passage
const HERALD = [0x3f5f9c, 0x8c3f3f, 0x3f7a52, 0x6a4f9c];
const IRON = 0x4c4c56;
// Mid brown, not the 0x6b4c30 this started at: against light stone that dark a
// timber read as a black belt painted round the tower rather than as boarding.
const WOOD_DARK = 0x8d6740;

const wallMats = (rng, extra = {}) => ({
  stone: matte(pick(rng, STONE)),
  stoneLight: matte(STONE_LIGHT),
  stoneDark: matte(STONE_DARK),
  slot: matte(SLOT),
  iron: metal(IRON),
  wood: matte(WOOD_DARK),
  ...extra,
});

// =============================================================================
// Shared parts
// =============================================================================

/**
 * A run of capped merlons along a straight edge, centred on `cx`, running
 * `length` along X at depth `z`.
 *
 * The cap is sunk 3 cm INTO the merlon rather than stacked on it: stacked, the
 * cap's underside and the merlon's top face occupy one plane in two different
 * materials, which is exactly the flicker check-zfight looks for.
 */
function crenellate(k, { length, cx = 0, z, baseY, pitch = 2.1, h = 1.05, depth = 0.5 }) {
  const n = Math.max(3, Math.round(length / pitch));
  const step = length / n;
  const w = step * 0.55;
  for (let i = 0; i < n; i++) {
    const x = cx - length / 2 + step * (i + 0.5);
    // Sunk 4 cm into the deck it stands on, same reason as the cap.
    k.box('stone', w, h + 0.04, depth, x, baseY + h / 2 - 0.02, z);
    k.box('stoneDark', w + 0.09, 0.11, depth + 0.09, x, baseY + h - 0.035, z);
  }
  return n;
}

/** Merlons around a circle of `radius` at `baseY` — the towers' parapet. */
function crenellateRing(k, { radius, baseY, count = 12, h = 1.0, w = 0.62, d = 0.46 }) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    k.box('stone', w, h + 0.04, d, x, baseY + h / 2 - 0.02, z, [0, -a, 0]);
    k.box('stoneDark', w + 0.08, 0.11, d + 0.08, x, baseY + h - 0.035, z, [0, -a, 0]);
  }
}

/**
 * A cross-shaped arrow loop, pierced through BOTH faces of a wall `T` thick and
 * centred on z=0, with a lintel and sill standing further proud in front of it.
 *
 * The slot stands PROUD rather than being recessed. There is no CSG here, so a
 * recessed box would simply be buried inside an opaque wall and invisible; at
 * 4 cm on a 10 m wall the proud version reads as a hole, and the deeper
 * lintel/sill in front of it sell the depth.
 */
function arrowLoop(k, x, y, T) {
  k.box('slot', 0.16, 1.15, T + 0.08, x, y, 0);
  k.box('slot', 0.44, 0.15, T + 0.08, x, y + 0.12, 0);
  k.box('stoneDark', 0.54, 0.15, T + 0.19, x, y + 0.62, 0);
  k.box('stoneDark', 0.54, 0.13, T + 0.19, x, y - 0.62, 0);
}

/**
 * A heraldic shield hung on a face at (x, y), facing ±Z. Layered outwards:
 * board (back edge buried in the wall) -> point -> emblem, each in front of the
 * last so no two faces share a plane.
 */
function shield(k, x, y, faceZ, rot = null) {
  const s = Math.sign(faceZ);
  const z0 = faceZ + s * 0.06;
  k.box('herald', 0.62, 0.72, 0.11, x, y, z0, rot);
  // The point: a square post rotated 45° about Z reads as the shield's tip.
  k.box('herald', 0.44, 0.44, 0.11, x, y - 0.44, z0, [0, 0, Math.PI / 4]);
  k.box('heraldTrim', 0.24, 0.30, 0.08, x, y + 0.05, faceZ + s * 0.15, rot);
}

/** A pole with a hanging pennant, for a tower top. */
function pennant(k, x, y, z, h = 3.0) {
  k.cyl('wood', 0.07, 0.09, h, 6, x, y + h / 2, z);
  k.cyl('heraldTrim', 0.075, 0.02, 0.26, 6, x, y + h + 0.11, z);
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    k.box('herald', 0.62 - t * 0.30, 0.26, 0.035, x + 0.36 - t * 0.10, y + h - 0.30 - i * 0.26,
      z + Math.sin(t * 2.6) * 0.05);
  }
}

// =============================================================================
// Curtain wall segment
// =============================================================================

/**
 * One straight run of city wall. Parametric on the numbers world.walls[]
 * already stores, so the existing ring becomes the new wall with no data
 * migration: `length` along local X, `thickness` along local Z, `height` to the
 * top of the wall-walk (merlons stand ~1.1 m above that, same as the box wall
 * this replaces put its crenels above `height`).
 */
export function generateWallSegment(seed, options = {}) {
  const rng = createRng(seed);
  const L = Math.max(2.5, options.length ?? 6);
  const H = Math.max(3, options.height ?? 5);
  const T = Math.max(0.6, options.thickness ?? 1);
  const k = makeKit();
  const hz = T / 2;

  // --- battered base: three stepped courses, widest at the ground ---
  const batterH = Math.min(1.6, H * 0.19);
  const step = batterH / 3;
  const flare = [0.62, 0.40, 0.19];
  for (let i = 0; i < 3; i++) {
    k.box(i === 1 ? 'stoneLight' : 'stone', L + 0.10 - i * 0.03, step + 0.02, T + flare[i],
      0, step * (i + 0.5), 0);
  }

  // --- curtain ---
  const corniceBottom = H - 0.58;
  const curtainH = corniceBottom - batterH + 0.10;
  k.box('stone', L, curtainH, T, 0, batterH + curtainH / 2 - 0.05, 0);

  // Course bands: proud on both faces, ends held 3 cm inboard of the curtain's
  // own end faces so no two end faces land in one plane.
  const bandGap = 1.65;
  const rowY = [];
  for (let y = batterH + bandGap; y < corniceBottom - 0.5; y += bandGap) {
    k.box('stoneLight', L - 0.06, 0.11, T + 0.08, 0, y, 0);
    rowY.push(y);
  }
  // Vertical joints between the bands, staggered row to row. Without these the
  // curtain is one 19 m slab with four stripes on it; with them it reads as
  // laid ashlar, which is the whole difference between the reference sheet's
  // wall and a retaining wall. They project 2.75 cm — less than the bands'
  // 4 cm, so a joint's face can never land in a band's.
  rowY.forEach((y, r) => {
    const per = 3;
    for (let i = 0; i < per; i++) {
      const x = -L / 2 + (L / per) * (i + (r % 2 ? 0.42 : 0.86));
      if (Math.abs(x) > L / 2 - 1.0) continue;
      k.box('stoneLight', 0.13, bandGap - 0.20, T + 0.055, x, y - bandGap / 2, 0);
    }
  });

  // --- end piers, which also hide the kink between two ring segments ---
  // They start inside the batter (bottom face buried) rather than at y=0, where
  // they would share the ground plane with the batter's own underside.
  // Held 0.50 back from the curtain's own end face, not 0.42: at 0.42 the
  // pier's outer face landed 7 mm from the curtain's, which clears the
  // check-zfight threshold on paper and still shimmers in a real frame.
  for (const sx of [-1, 1]) {
    const px = sx * (L / 2 - 0.50);
    k.box('stoneLight', 0.84, corniceBottom - batterH + 0.55, T + 0.26,
      px, batterH + (corniceBottom - batterH - 0.15) / 2, 0);
  }

  // --- arrow loops ---
  const loopY = batterH + curtainH * 0.62;
  const loops = Math.max(1, Math.floor(L / 7));
  for (let i = 0; i < loops; i++) {
    arrowLoop(k, -L / 2 + (L / (loops + 1)) * (i + 1), loopY, T);
  }

  // --- hanging shields, sometimes ---
  if (chance(rng, 0.45)) {
    const sx = range(rng, -L * 0.22, L * 0.22);
    for (const s of [1, -1]) shield(k, sx, loopY + 1.55, s * hz);
  }

  // --- cornice on corbels, then the wall-walk deck ---
  const corbelPitch = 2.9;
  const corbels = Math.max(2, Math.round(L / corbelPitch));
  for (let i = 0; i < corbels; i++) {
    const x = -L / 2 + (L / corbels) * (i + 0.5);
    for (const s of [1, -1]) {
      k.box('stoneDark', 0.26, 0.30, 0.30, x, corniceBottom - 0.13, s * (hz + 0.12));
    }
  }
  k.box('stone', L + 0.06, 0.32, T + 0.52, 0, corniceBottom + 0.16, 0);
  const deckY = H - 0.10;
  k.box('stoneDark', L + 0.10, 0.19, T + 0.64, 0, deckY - 0.095, 0);

  // --- parapet: merlons on BOTH edges, wall-walk between (see file header) ---
  const merlonD = Math.min(0.56, T * 0.30);
  for (const s of [1, -1]) {
    crenellate(k, { length: L, z: s * (hz + 0.30 - merlonD / 2), baseY: deckY, depth: merlonD, pitch: 2.15 });
  }

  return k.finish(wallMats(rng, {
    herald: matte(pick(rng, HERALD)),
    heraldTrim: matte(0xd9be6a),
  }));
}

// =============================================================================
// Round wall tower
// =============================================================================

/**
 * The ring tower: a 12-sided drum that stands ~6 m above the curtain, with a
 * battered plinth, corbelled cornice, crenellated crown and a pennant. Front
 * (the doorway) is +Z.
 */
export function generateCityWallTower(seed, options = {}) {
  const rng = createRng(seed);
  const R = options.radius ?? 3.0;
  const H = options.height ?? 16;
  const k = makeKit();
  const SEG = 12;

  // Plinth: two flaring courses.
  k.cyl('stone', R + 0.52, R + 0.84, 0.62, SEG, 0, 0.31, 0);
  k.cyl('stoneLight', R + 0.26, R + 0.52, 0.60, SEG, 0, 0.90, 0);

  const corniceBottom = H - 1.5;
  k.cyl('stone', R, R + 0.30, corniceBottom - 0.9, SEG, 0, 0.9 + (corniceBottom - 0.9) / 2, 0);

  // Proud course rings. Radius follows the drum's own taper at that height so a
  // ring never sinks inside the shaft near the base.
  const taperAt = (y) => R + 0.30 * (1 - (y - 0.9) / (corniceBottom - 0.9));
  for (let y = 3.0; y < corniceBottom - 1.0; y += 2.6) {
    k.cyl('stoneLight', taperAt(y) + 0.09, taperAt(y) + 0.09, 0.13, SEG, 0, y, 0);
  }

  // Doorway (+Z): a dark recess under a half-round head, with a stone surround.
  const dz = taperAt(1.6) - 0.05;
  k.box('slot', 1.24, 2.35, 0.5, 0, 1.18, dz);
  // arcStart PI/2 = the TOP half. Without it three.js builds the +X half and
  // the "arch head" is a half-disc stuck to the right jamb — see meshKit's cyl.
  k.cyl('slot', 0.62, 0.62, 0.5, 10, 0, 2.35, dz, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
  k.torus('stoneDark', 0.74, 0.16, 0, 2.35, dz + 0.16, null, Math.PI);
  for (const sx of [-1, 1]) k.box('stoneDark', 0.20, 2.4, 0.24, sx * 0.73, 1.20, dz + 0.16);
  k.box('wood', 1.10, 2.20, 0.14, 0, 1.16, dz - 0.14);

  // Arrow loops, three faces of the drum.
  for (const a of [0, Math.PI * 0.66, -Math.PI * 0.66]) {
    for (const y of [5.4, 9.0]) {
      const rr = taperAt(y);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      k.box('slot', 0.16, 1.15, 0.30, x, y, z, [0, -a + Math.PI / 2, 0]);
      k.box('stoneDark', 0.50, 0.14, 0.36, x, y + 0.61, z, [0, -a + Math.PI / 2, 0]);
      k.box('stoneDark', 0.50, 0.13, 0.36, x, y - 0.61, z, [0, -a + Math.PI / 2, 0]);
    }
  }

  // Corbels, cornice, deck.
  for (let i = 0; i < SEG; i++) {
    const a = ((i + 0.5) / SEG) * Math.PI * 2;
    k.box('stoneDark', 0.28, 0.32, 0.34, Math.cos(a) * (R + 0.16), corniceBottom - 0.14, Math.sin(a) * (R + 0.16), [0, -a, 0]);
  }
  k.cyl('stone', R + 0.62, R + 0.44, 0.36, SEG, 0, corniceBottom + 0.18, 0);
  const deckY = corniceBottom + 0.55;
  k.cyl('stoneDark', R + 0.68, R + 0.68, 0.22, SEG, 0, deckY - 0.11, 0);

  crenellateRing(k, { radius: R + 0.38, baseY: deckY, count: SEG, h: 1.05, w: R * 0.30, d: 0.5 });

  shield(k, 0, corniceBottom - 2.6, taperAt(corniceBottom - 2.6) + 0.02);
  pennant(k, 0, deckY, -R * 0.42, 3.4);

  return k.finish(wallMats(rng, {
    herald: matte(pick(rng, HERALD)),
    heraldTrim: matte(0xd9be6a),
  }));
}

// =============================================================================
// Square archer tower
// =============================================================================

/** The reference sheet's "ARCHER TOWER": a slimmer square tower with a timber
 *  hoarding under the parapet. Front (+Z) carries the shield. */
export function generateWatchTower(seed, options = {}) {
  const rng = createRng(seed);
  const W = options.width ?? 4.2;
  const H = options.height ?? 13;
  const k = makeKit();

  k.box('stone', W + 0.85, 0.55, W + 0.85, 0, 0.275, 0);
  k.box('stoneLight', W + 0.46, 0.52, W + 0.46, 0, 0.80, 0);

  const corniceBottom = H - 1.5;
  k.box('stone', W, corniceBottom - 0.9, W, 0, 0.9 + (corniceBottom - 0.9) / 2, 0);
  for (let y = 3.0; y < corniceBottom - 1.0; y += 2.7) {
    k.box('stoneLight', W + 0.14, 0.12, W + 0.14, 0, y, 0);
  }
  // Quoins: alternating corner blocks, the cheapest way to make a plain box
  // read as cut stone.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const y = 1.5 + i * 1.35;
        if (y > corniceBottom - 0.7) break;
        const long = i % 2 === 0;
        k.box('stoneLight', long ? 0.86 : 0.52, 0.52, long ? 0.52 : 0.86,
          sx * (W / 2 - (long ? 0.34 : 0.17)), y, sz * (W / 2 - (long ? 0.17 : 0.34)));
      }
    }
  }

  const dz = W / 2;
  k.box('slot', 1.20, 2.30, 0.34, 0, 1.15, dz - 0.02);
  k.cyl('slot', 0.60, 0.60, 0.34, 10, 0, 2.30, dz - 0.02, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
  k.torus('stoneDark', 0.72, 0.15, 0, 2.30, dz + 0.13, null, Math.PI);
  k.box('wood', 1.06, 2.16, 0.13, 0, 1.13, dz - 0.16);

  // Loops pierce the tower on both axes — one box per axis does both faces at
  // once, which is why there are two rotations here and not four.
  for (const rot of [0, Math.PI / 2]) {
    for (const y of [5.2, 8.4]) {
      k.box('slot', 0.16, 1.10, W + 0.08, 0, y, 0, [0, rot, 0]);
      k.box('slot', 0.42, 0.15, W + 0.08, 0, y + 0.12, 0, [0, rot, 0]);
      // W + 0.26, not W + 0.20: the course bands below already project W + 0.14,
      // and two trim pieces at the same projection share a plane.
      k.box('stoneDark', 0.52, 0.14, W + 0.26, 0, y + 0.60, 0, [0, rot, 0]);
      k.box('stoneDark', 0.52, 0.13, W + 0.26, 0, y - 0.60, 0, [0, rot, 0]);
    }
  }

  // Timber hoarding: a projecting boarded gallery, the wooden band the
  // reference tower has under its stone crown.
  const hoardY = corniceBottom - 0.75;
  for (const [sx, sz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const rot = sx ? [0, Math.PI / 2, 0] : null;
    k.box('wood', W + 0.9, 0.9, 0.22, sx * (W / 2 + 0.24), hoardY, sz * (W / 2 + 0.24), rot);
    k.box('stoneDark', 0.20, 0.34, 0.44, sx * (W / 2 + 0.16), hoardY - 0.58, sz * (W / 2 + 0.16), rot);
  }

  k.box('stone', W + 1.0, 0.32, W + 1.0, 0, corniceBottom + 0.16, 0);
  const deckY = corniceBottom + 0.52;
  k.box('stoneDark', W + 1.1, 0.20, W + 1.1, 0, deckY - 0.10, 0);
  // Four parapet runs, one per side. crenellate() only lays a row along X, so
  // the two runs that face ±X are placed here with a yaw instead.
  // Merlons sit inboard of the deck's own edge (W/2 + 0.55) — flush with it
  // puts two opaque faces in one plane.
  const pr = W / 2 + 0.26;
  for (const [dx, dz2, rot] of [[0, pr, 0], [0, -pr, 0], [pr, 0, Math.PI / 2], [-pr, 0, Math.PI / 2]]) {
    const n = 3;
    const runLen = W + 0.5;
    const stp = runLen / n;
    for (let i = 0; i < n; i++) {
      const off = -runLen / 2 + stp * (i + 0.5);
      const x = rot ? dx : off, z = rot ? off : dz2;
      k.box('stone', stp * 0.55, 0.94, 0.46, x, deckY + 0.45, z, [0, rot, 0]);
      k.box('stoneDark', stp * 0.55 + 0.09, 0.11, 0.55, x, deckY + 0.855, z, [0, rot, 0]);
    }
  }

  // Clear of the upper arrow loop at 8.4, whose lintel would otherwise sit
  // behind the shield board in the same plane.
  shield(k, 0, corniceBottom - 1.85, W / 2 + 0.02);
  pennant(k, -W * 0.28, deckY, -W * 0.28, 2.8);

  return k.finish(wallMats(rng, {
    herald: matte(pick(rng, HERALD)),
    heraldTrim: matte(0xd9be6a),
  }));
}

// =============================================================================
// Gatehouse
// =============================================================================

/**
 * The city gate: a central block pierced by a round-headed passage, flanked by
 * two square towers, with a raised portcullis and its doors swung open.
 *
 * The doors are OPEN and the portcullis is UP on purpose. This prop declares no
 * collider (src/sim/propTypes.js) — the passage has to be walkable, and the
 * ring's piers are authored as separate invisible wall segments either side, the
 * same pattern the Great Tower's gate already uses. A closed gate you can stroll
 * through looks worse than an open one.
 *
 * Front is +Z (the side you approach from outside the city).
 */
export function generateCityGate(seed, options = {}) {
  const rng = createRng(seed);
  const k = makeKit();
  // 18.6 m overall, sized to the Asteria ring's own gate gaps: the ring leaves
  // 18.32 m of clear chord between the two wall ends either side of a gate, so
  // a 17 m gatehouse (the first size tried) left a 66 cm slot at each shoulder
  // that you could see the countryside through.
  const HALF = options.width ? options.width / 2 : 9.3;
  const T = options.thickness ?? 4.6;                      // passage depth
  const H = options.height ?? 11.5;                        // central block
  const TW = 3.9;                                          // tower width
  const TH = options.towerHeight ?? 15.5;
  const hz = T / 2;

  const OPEN_W = 4.6;      // clear passage width
  const SPRING = 4.5;      // springing line of the arch
  const ARCH_R = OPEN_W / 2;
  const CROWN = SPRING + ARCH_R;

  // --- central block: two jambs + a header, leaving the passage open ---
  const jambInner = OPEN_W / 2;
  const jambOuter = HALF - TW;
  const jambW = jambOuter - jambInner;
  // 1.05, NOT 1.4. The two base courses below only reach y = 1.2, so a jamb
  // starting at 1.4 left a 20 cm slot running straight through the gatehouse at
  // knee height — daylight under the whole front, on both sides of the arch.
  // At 1.05 the jamb starts 15 cm inside the course it stands on.
  const batterH = 1.05;
  for (const sx of [-1, 1]) {
    const cx = sx * (jambInner + jambW / 2);
    k.box('stone', jambW + 0.5, 0.6, T + 0.62, cx + sx * 0.1, 0.30, 0);
    k.box('stoneLight', jambW + 0.26, 0.6, T + 0.34, cx + sx * 0.05, 0.90, 0);
    k.box('stone', jambW, H - batterH, T, cx, batterH + (H - batterH) / 2, 0);
    // A pilaster up the middle of each jamb face. It used to sit on the jamb's
    // OUTER edge, where its end face shared a plane with the jamb's own — and
    // where the flanking tower covered it anyway, so it was invisible as well
    // as flickering.
    k.box('stoneLight', 0.58, H - batterH - 0.4, T + 0.22, cx, batterH + (H - batterH - 0.4) / 2, 0);
  }
  // Header over the arch. Its underside sits at the crown, and the spandrels
  // below it are stepped in by hand (no CSG here — see the arch note).
  k.box('stone', OPEN_W + 0.04, H - CROWN, T, 0, CROWN + (H - CROWN) / 2, 0);

  // Spandrels: the stone left over between the square opening and the round
  // head, stepped in three courses a side. Each is inset 1 cm from the jamb
  // face so no two end faces share a plane.
  for (const sx of [-1, 1]) {
    const steps = [[0.62, 0.30], [0.42, 0.72], [0.22, 1.30]];
    for (const [w, rise] of steps) {
      k.box('stone', w, ARCH_R - rise, T - 0.02,
        sx * (ARCH_R - w / 2), SPRING + rise + (ARCH_R - rise) / 2, 0);
    }
  }

  // Archivolt: a torus arc on each face, which is what turns the stepped
  // spandrels into a clean arch from any angle.
  for (const s of [1, -1]) {
    k.torus('stoneDark', ARCH_R + 0.16, 0.30, 0, SPRING, s * (hz - 0.02), null, Math.PI);
    k.box('stoneDark', 0.34, SPRING, 0.42, -ARCH_R - 0.16, SPRING / 2, s * (hz - 0.02));
    k.box('stoneDark', 0.34, SPRING, 0.42, ARCH_R + 0.16, SPRING / 2, s * (hz - 0.02));
  }
  // NO barrel vault. It was a 12-segment cylinder built with openEnded = false,
  // so three.js capped each end with a solid pie-slice disc — a black lid right
  // across the archway that hid the portcullis behind it. Building it open
  // instead does not help either: a single-sided shell is invisible from inside
  // the tunnel, which is where a player stands. The passage simply reads
  // through to the far side, which is what it did before the vault existed.

  // Portcullis, raised into the arch head: only its bar ends and spiked feet
  // hang below the crown.
  for (let i = 0; i < 7; i++) {
    const x = -ARCH_R + 0.5 + i * ((OPEN_W - 1.0) / 6);
    k.box('iron', 0.10, 1.5, 0.10, x, CROWN - 0.55, hz - 0.55);
    k.cone('iron', 0.09, 0.28, 4, x, CROWN - 1.42, hz - 0.55, [Math.PI, 0, 0]);
  }
  for (const y of [CROWN - 0.35, CROWN - 1.0]) k.box('iron', OPEN_W - 0.75, 0.09, 0.09, 0, y, hz - 0.55);

  // Door leaves, swung back flat against the passage walls.
  for (const sx of [-1, 1]) {
    k.box('wood', T * 0.62, 3.9, 0.16, sx * (ARCH_R - 0.14), 1.95, -hz + T * 0.34, [0, sx * Math.PI / 2, 0]);
    for (const by of [0.7, 3.1]) {
      k.box('iron', T * 0.58, 0.14, 0.06, sx * (ARCH_R - 0.24), by, -hz + T * 0.34, [0, sx * Math.PI / 2, 0]);
    }
  }

  // --- flanking towers ---
  for (const sx of [-1, 1]) {
    const cx = sx * (HALF - TW / 2);
    k.box('stone', TW + 0.8, 0.6, TW + 0.8, cx, 0.30, 0);
    k.box('stoneLight', TW + 0.42, 0.6, TW + 0.42, cx, 0.90, 0);
    const corniceBottom = TH - 1.4;
    k.box('stone', TW, corniceBottom - 0.9, TW, cx, 0.9 + (corniceBottom - 0.9) / 2, 0);
    for (let y = 3.2; y < corniceBottom - 1.0; y += 2.7) {
      k.box('stoneLight', TW + 0.14, 0.12, TW + 0.14, cx, y, 0);
    }
    for (const y of [5.6, 9.2]) {
      k.box('slot', 0.16, 1.10, TW + 0.06, cx, y, 0);
      // TW + 0.26 clears the course bands' own TW + 0.14 projection.
      k.box('stoneDark', 0.52, 0.14, TW + 0.26, cx, y + 0.58, 0);
      k.box('stoneDark', 0.52, 0.13, TW + 0.26, cx, y - 0.58, 0);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      k.box('stoneDark', 0.26, 0.30, 0.32, cx + Math.cos(a) * (TW / 2 + 0.1), corniceBottom - 0.13, Math.sin(a) * (TW / 2 + 0.1), [0, -a, 0]);
    }
    k.box('stone', TW + 0.92, 0.32, TW + 0.92, cx, corniceBottom + 0.16, 0);
    const deckY = corniceBottom + 0.52;
    k.box('stoneDark', TW + 1.02, 0.20, TW + 1.02, cx, deckY - 0.10, 0);
    const pr = TW / 2 + 0.24;
    for (const [dx, dz2, rot] of [[0, pr, 0], [0, -pr, 0], [pr, 0, Math.PI / 2], [-pr, 0, Math.PI / 2]]) {
      const n = 3, runLen = TW + 0.5, stp = runLen / n;
      for (let i = 0; i < n; i++) {
        const off = -runLen / 2 + stp * (i + 0.5);
        const x = cx + (rot ? dx : off), z = rot ? off : dz2;
        k.box('stone', stp * 0.55, 0.94, 0.46, x, deckY + 0.45, z, [0, rot, 0]);
        k.box('stoneDark', stp * 0.55 + 0.09, 0.11, 0.55, x, deckY + 0.855, z, [0, rot, 0]);
      }
    }
    shield(k, cx, corniceBottom - 2.8, TW / 2 + 0.02);
    pennant(k, cx, deckY, 0, 3.2);
  }

  // --- central block's crown: corbels, cornice, crenellations ---
  const cb = H - 0.6;
  const blockL = 2 * (HALF - TW);
  const corbels = Math.round(blockL / 2.4);
  for (let i = 0; i < corbels; i++) {
    const x = -blockL / 2 + (blockL / corbels) * (i + 0.5);
    if (Math.abs(x) < ARCH_R - 0.2) continue; // nothing to corbel off over the passage
    for (const s of [1, -1]) k.box('stoneDark', 0.26, 0.30, 0.32, x, cb - 0.14, s * (hz + 0.12));
  }
  k.box('stone', blockL + 0.06, 0.32, T + 0.54, 0, cb + 0.16, 0);
  const bDeck = H + 0.05;
  k.box('stoneDark', blockL + 0.12, 0.20, T + 0.66, 0, bDeck - 0.10, 0);
  const merlonD = Math.min(0.56, T * 0.28);
  for (const s of [1, -1]) {
    crenellate(k, { length: blockL - 0.6, z: s * (hz + 0.30 - merlonD / 2), baseY: bDeck, depth: merlonD, pitch: 2.0, h: 1.0 });
  }
  // Banners hung either side of the arch — the reference gate's strongest cue.
  for (const sx of [-1, 1]) {
    for (const s of [1, -1]) {
      const bx = sx * (ARCH_R + 0.95);
      k.box('herald', 0.86, 3.4, 0.09, bx, H - 2.6, s * (hz + 0.05));
      k.box('heraldTrim', 0.34, 0.36, 0.06, bx, H - 2.0, s * (hz + 0.12));
      // The point is a FLAT square turned 45°, whose diagonal matches the
      // banner's width — the same trick the shields use. It was a 3-sided cone
      // before, i.e. a solid triangular pyramid wider than the cloth it hung
      // off, which read as a chunky arrowhead bolted to the bottom of the flag.
      // Thinner than the banner (0.07 vs 0.09) so its faces sit inside the
      // banner's rather than coinciding with them.
      k.box('herald', 0.61, 0.61, 0.07, bx, H - 4.30, s * (hz + 0.05), [0, 0, Math.PI / 4]);
    }
  }

  return k.finish(wallMats(rng, {
    herald: matte(pick(rng, HERALD)),
    heraldTrim: matte(0xd9be6a),
  }));
}
