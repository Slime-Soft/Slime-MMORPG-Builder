// src/generators/environment/caveDecor.js
// The lit half of the cave/dungeon kit: wall torches, hanging lanterns,
// braziers, crystals, candles, the ore boulder, the two pools, mine timbering,
// a barred gate and a plank walkway. Structure lives in ./caveKit.js.
//
// Built from references/cave-dungeon-massing.md (sheets 4, 5 and 6).
//
// THE POINT OF THIS FILE is the contrast the reference room is built on: black
// stone, warm grout, and a handful of SATURATED light sources. So the emissive
// materials here matter more than the geometry does.
//
// Bloom discipline. The game's composer runs a real bloom pass and it is
// unforgiving — the bakery's front wall was blown to solid white by it once
// already (see public/asset-check.html's header). Rules followed here:
//   - emissive colour is never white and never near-white; a flame is
//     saturated orange, a crystal saturated teal or violet;
//   - `emissiveIntensity` stays at or under 0.9, and the biggest surfaces get
//     the LOWEST value — a large glowing face blooms far harder than a spark;
//   - the glowing part is always small relative to the prop, and always framed
//     by dark stone or iron, which is what makes it read as light rather than
//     as a hole in the image.
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, glow } from './meshKit.js';
import { caveMats, cobble } from './caveKit.js';

const IRON = 0x2a2d36;
const IRON_LIGHT = 0x3c414d;
const WOOD = [0x7a5a38, 0x6d5030, 0x836243];

/** Flame colours. Orange for fire; the arcane trio from sheet 4's braziers. */
const FIRE = 0xff8a2b;
const ARCANE = [
  { flame: 0x7de04a, crystal: 0x9dfb63 },
  { flame: 0x49b8ff, crystal: 0x7fd8ff },
  { flame: 0xa25cff, crystal: 0xc492ff },
];

const lights = (rng, extra = {}) => caveMats(rng, {
  iron: metal(IRON),
  ironLight: metal(IRON_LIGHT),
  wood: matte(pick(rng, WOOD)),
  ...extra,
});

/**
 * A tapering flame: 3 stacked, shrinking, slightly offset polygonal segments.
 * Not a cone — the sheets show a flame with a visible waist and a flick at the
 * tip, and a single cone reads as a party hat.
 *
 * Each segment's BOTTOM radius must equal the segment below it's TOP radius.
 * The first pass didn't do that (a 0.42-wide top carrying a 0.78-wide bottom),
 * so the flame flared back out at the waist and grew a hard shoulder — in a
 * render it read as a gold ARROW pointing up, not as fire. The offsets and the
 * tip's tilt are what give it life; the silhouette must only ever shrink.
 */
function flame(k, key, x, y, z, r, h, rng) {
  k.cyl(key, r * 0.78, r, h * 0.34, 6, x, y + h * 0.17, z);
  k.cyl(key, r * 0.48, r * 0.78, h * 0.34, 6,
    x + range(rng, -0.02, 0.02), y + h * 0.51, z + range(rng, -0.02, 0.02), [0, range(rng, 0, 1), 0]);
  k.cyl(key, 0.012, r * 0.48, h * 0.34, 5,
    x + range(rng, -0.04, 0.04), y + h * 0.85, z + range(rng, -0.04, 0.04),
    [range(rng, -0.15, 0.15), 0, range(rng, -0.15, 0.15)]);
}

/** A fan of faceted shards out of a small base — sheet 4's crystal clusters. */
function crystalFan(k, key, x, y, z, scale, rng) {
  const n = rangeInt(rng, 5, 8);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + range(rng, -0.2, 0.2);
    const rad = i === 0 ? 0 : range(rng, 0.1, 0.28) * scale;
    const h = (i === 0 ? range(rng, 0.85, 1.1) : range(rng, 0.35, 0.75)) * scale;
    const lean = i === 0 ? 0 : range(rng, 0.15, 0.4);
    k.cyl(key, 0.012 * scale, range(rng, 0.07, 0.13) * scale, h, rangeInt(rng, 4, 6),
      x + Math.sin(a) * rad, y + h / 2 * Math.cos(lean), z + Math.cos(a) * rad,
      [Math.cos(a) * lean, a, -Math.sin(a) * lean]);
  }
}

// ---------------------------------------------------------------------------
// Sheet 4 — torches and lanterns (wall/ceiling mounted; see `mounted` in
// src/sim/propTypes.js for why these are exempt from the ground-contact check)
// ---------------------------------------------------------------------------

/** Back-plate against the wall, an arm angling up and out, a cup, a flame. */
export function generateCaveTorch(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  // Bracket centre at y = 0, like every other mounted piece in the kit: the
  // author puts it where they want it with the editor's Height field. It used
  // to bake in 2.0m, which meant a torch on a 5m wall or in a low crawl had to
  // be fought with a negative height.
  const Y = 0;
  // Back-plate. Front is +Z, so the plate sits at the BACK of the prop and the
  // arm reaches forward, which is how an author aims it at a wall.
  k.box('iron', 0.22, 0.62, 0.09, 0, Y, -0.16);
  k.box('ironLight', 0.3, 0.1, 0.07, 0, Y + 0.31, -0.15);
  k.box('ironLight', 0.3, 0.1, 0.07, 0, Y - 0.31, -0.15);
  // Arm, angled up and out. The rotation is POSITIVE: a cylinder's axis is +Y,
  // and rotating it by -0.75 about X swings the top towards -Z, i.e. back
  // through the wall — which left the cup and flame hanging in mid-air with a
  // visible gap, the arm poking out behind the plate instead of under them.
  k.cyl('iron', 0.05, 0.055, 0.52, 6, 0, Y + 0.16, 0.06, [0.75, 0, 0]);
  // Cup.
  k.cyl('iron', 0.14, 0.09, 0.18, 8, 0, Y + 0.42, 0.26);
  k.cyl('ironLight', 0.16, 0.14, 0.04, 8, 0, Y + 0.51, 0.26);
  flame(k, 'fire', 0, Y + 0.5, 0.26, 0.13, 0.44, rng);
  return k.finish(lights(rng, { fire: glow(FIRE, 0.85) }));
}

/** Chain, iron cap, glowing glass body with X bracing, small finial. */
export function generateCaveLantern(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const TOP = 0; // the hook — mount plane at y = 0, the chain hangs below it
  const bodyH = range(rng, 0.46, 0.68);
  const r = range(rng, 0.15, 0.2);
  const chainLen = range(rng, 0.7, 1.3);
  const capY = TOP - chainLen;

  // Hook + chain: alternating links, drawn as thin crossed rings.
  // A torus already lies in the XY plane, i.e. VERTICAL — the hook and the
  // links need no X rotation, and adding one lays them flat like washers on a
  // shelf (which also breaks the chain into unconnected rings). Alternating
  // links turn about Y instead, the way a real chain does.
  k.torus('iron', 0.08, 0.022, 0, TOP - 0.06, 0, null, Math.PI * 1.5);
  const links = Math.max(3, Math.round(chainLen / 0.14));
  for (let i = 0; i < links; i++) {
    const y = TOP - 0.1 - (i + 0.5) * (chainLen - 0.1) / links;
    k.torus('iron', 0.045, 0.016, 0, y, 0, [0, i % 2 ? Math.PI / 2 : 0, 0]);
  }

  // Cap.
  k.cyl('ironLight', 0.03, 0.1, 0.1, 6, 0, capY + 0.06, 0);
  k.cyl('iron', r * 1.25, r * 1.1, 0.09, 6, 0, capY - 0.03, 0);
  // Glass body — a hexagonal prism. Kept small and framed by iron.
  k.cyl('glass', r * 0.96, r * 0.82, bodyH, 6, 0, capY - 0.09 - bodyH / 2, 0);
  // Iron uprights at the prism's corners, plus the X bracing on each face.
  const bodyY = capY - 0.09 - bodyH / 2;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    k.box('iron', 0.028, bodyH + 0.04, 0.05, Math.sin(a) * r * 0.93, bodyY, Math.cos(a) * r * 0.93, [0, a, 0]);
    const fa = (i / 6) * Math.PI * 2;
    for (const s of [-1, 1]) {
      k.box('iron', r * 1.0, 0.022, 0.02,
        Math.sin(fa) * r * 0.87, bodyY, Math.cos(fa) * r * 0.87, [0, fa, s * 0.72]);
    }
  }
  // Base ring + finial.
  k.cyl('iron', r * 1.1, r * 0.85, 0.07, 6, 0, capY - 0.12 - bodyH, 0);
  k.cyl('ironLight', 0.05, 0.02, 0.11, 5, 0, capY - 0.2 - bodyH, 0);
  // Low intensity on purpose: this is the biggest emissive surface in the kit.
  return k.finish(lights(rng, { glass: glow(0xffb44a, 0.55) }));
}

// ---------------------------------------------------------------------------
// Sheet 4 — braziers
// ---------------------------------------------------------------------------

function brazier(k, rng, flameKey, crystalKey) {
  const BOWL_Y = 0.72;
  const LEG_H = BOWL_Y + 0.12;
  // Three splayed legs joined by a low ring.
  //
  // The lean is NEGATIVE, i.e. the leg tops tuck IN under the bowl and the
  // feet spread out. Leaning them the other way (as the first pass did) makes
  // a narrow-footed wineglass carrying a wide bowl — which is why it read as a
  // bar stool with a bucket balanced on it rather than as a brazier.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    k.box('iron', 0.09, LEG_H, 0.11,
      Math.sin(a) * 0.19, LEG_H / 2, Math.cos(a) * 0.19,
      [-Math.cos(a) * 0.36, a, Math.sin(a) * 0.36]);
    k.box('ironLight', 0.17, 0.08, 0.11, Math.sin(a) * 0.35, 0.05, Math.cos(a) * 0.35, [0, a, 0]);
  }
  k.torus('iron', 0.23, 0.028, 0, 0.28, 0, [Math.PI / 2, 0, 0]);
  // Bowl: a shallow DISH with a heavy rim, not the deep funnel of the first
  // pass (h 0.26 over a 0.2 base), which was as deep as it was wide and read
  // as a plant pot.
  k.cyl('iron', 0.41, 0.24, 0.24, 10, 0, BOWL_Y + 0.12, 0);
  k.torus('ironLight', 0.4, 0.055, 0, BOWL_Y + 0.24, 0, [Math.PI / 2, 0, 0]);
  k.cyl('coal', 0.33, 0.3, 0.06, 10, 0, BOWL_Y + 0.2, 0);
  // Crystals stand BEHIND the flame and higher than it starts, or the flame
  // hides them completely.
  if (crystalKey) crystalFan(k, crystalKey, 0, BOWL_Y + 0.22, -0.18, 0.45, rng);
  // Slimmer and shorter than the first pass (r 0.3, h 1.05), which put a
  // solid orange blob wider than the bowl and taller than the whole stand on
  // top of it. The sheet's flame is tall but narrow.
  flame(k, flameKey, 0, BOWL_Y + 0.22, 0.04, 0.21, 0.86, rng);
}

export function generateCaveBrazier(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  brazier(k, rng, 'fire', null);
  return k.finish(lights(rng, { fire: glow(FIRE, 0.85), coal: matte(0x241812) }));
}

export function generateCaveBrazierArcane(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const c = pick(rng, ARCANE);
  brazier(k, rng, 'fire', 'crystal');
  return k.finish(lights(rng, {
    fire: glow(c.flame, 0.8),
    crystal: glow(c.crystal, 0.5),
    coal: matte(0x1b1a24),
  }));
}

// ---------------------------------------------------------------------------
// Sheet 4/5 — crystals and candles
// ---------------------------------------------------------------------------

function crystalCluster(seed, color, tip) {
  const rng = createRng(seed);
  const k = makeKit();
  // Rock base first — the shards grow OUT of stone on every sheet, they are
  // never planted in the grass.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + range(rng, -0.2, 0.2);
    // Heights stepped by index rather than drawn freely: five blocks drawn
    // from one range land within a few millimetres of each other often enough
    // that their yawed top faces fight (check:zfight).
    const bh = 0.18 + i * 0.03;
    k.box(pick(rng, ['stone', 'stoneDark']), range(rng, 0.3, 0.46), bh, range(rng, 0.3, 0.42),
      Math.sin(a) * 0.36, bh / 2, Math.cos(a) * 0.36, [0, a, 0]);
  }
  k.box('seam', 0.85, 0.1, 0.85, 0, 0.05, 0);
  crystalFan(k, 'crystal', 0, 0.16, 0, 1.35, rng);
  crystalFan(k, 'crystalTip', 0, 0.62, 0, 0.5, rng);
  return k.finish(caveMats(rng, {
    crystal: glow(color, 0.55),
    crystalTip: glow(tip, 0.75),
  }));
}

export const generateCaveCrystalBlue = (seed) => crystalCluster(seed, 0x2f9fd8, 0x7fe0ff);
export const generateCaveCrystalViolet = (seed) => crystalCluster(seed, 0x7a3fd0, 0xc08fff);

/** Sheet 5: two cream candles with a dribble, on small dark stone bases. */
export function generateCaveCandles(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const spots = [
    { x: -0.22, z: 0.06, stand: 0.34, h: 0.4 },
    { x: 0.2, z: -0.1, stand: 0.14, h: 0.32 },
  ];
  for (const s of spots) {
    // Stand: one plain block, one stepped, as on the sheet.
    if (s.stand > 0.2) {
      k.box('stone', 0.26, s.stand * 0.6, 0.26, s.x, s.stand * 0.3, s.z);
      k.box('stoneLight', 0.2, s.stand * 0.42, 0.2, s.x, s.stand * 0.79, s.z, [0, 0.4, 0]);
    } else {
      k.box('stone', 0.3, s.stand, 0.3, s.x, s.stand / 2, s.z, [0, 0.25, 0]);
    }
    // Both stands finish at exactly `s.stand` (the stepped one's upper block
    // is centred so its top lands there) — anything else stands the candle in
    // mid-air above its own base.
    const base = s.stand;
    k.cyl('wax', 0.06, 0.068, s.h, 8, s.x, base + s.h / 2, s.z);
    // The dribble down one side.
    k.cyl('wax', 0.018, 0.03, s.h * 0.5, 5, s.x + 0.062, base + s.h * 0.62, s.z, [0, 0, 0.03]);
    k.cyl('iron', 0.006, 0.008, 0.05, 4, s.x, base + s.h + 0.02, s.z);
    flame(k, 'fire', s.x, base + s.h + 0.03, s.z, 0.045, 0.14, rng);
  }
  // No warm ground plate here — on a pair of candles it read as a doormat
  // rather than as grout, and two stands standing on the floor are two
  // legitimately separate objects (check:parts agrees).
  return k.finish(lights(rng, { wax: matte(0xe8dcbe), fire: glow(0xffc24a, 0.7) }));
}

/** Sheet 5: a dark boulder with a pale blue crystal seam growing out of it. */
export function generateCaveOreCrystal(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const R = range(rng, 0.85, 1.1);
  // ONE readable mass first. The first pass drew the core in the warm grout
  // colour and then buried it under 7–9 boxes each as large as the core
  // itself, tilted every which way: the result had no silhouette you could
  // name, and the crystal — the entire reason the prop exists — was a few
  // chips down one flank. A player could not tell what they were looking at.
  //
  // So: a dark stone boulder, chips that are CHIPS, and the ore seam pushed to
  // the top at full size where it is the first thing you see.
  k.ico('stone', R, 0, R * 0.58, 0, [1.05, 0.7, 0.95]);
  const facets = rangeInt(rng, 4, 6);
  for (let i = 0; i < facets; i++) {
    const a = (i / facets) * Math.PI * 2 + range(rng, -0.2, 0.2);
    const s = R * range(rng, 0.3, 0.44);
    k.box(pick(rng, ['stoneDark', 'stoneLight']), s * 1.3, s, s * 1.15,
      Math.sin(a) * R * 0.6, R * range(rng, 0.3, 0.75), Math.cos(a) * R * 0.6,
      [range(rng, -0.3, 0.3), a, range(rng, -0.3, 0.3)]);
  }
  // Warm grout skirt where the rock meets the floor, as everywhere else in the
  // kit — it also hides the ico's flat underside.
  k.cyl('seam', R * 0.86, R * 0.96, 0.09, 10, 0, 0.045, 0);
  // The seam, out of the crown of the boulder and leaning slightly forward.
  crystalFan(k, 'crystal', 0, R * 0.9, R * 0.1, 1.3, rng);
  crystalFan(k, 'crystalTip', 0, R * 1.42, R * 0.1, 0.5, rng);
  // The one shard broken off at its foot.
  // Leant AGAINST the boulder's flank rather than dropped a body-length away,
  // where it read as litter someone forgot to clear up.
  k.cyl('crystal', 0.02, 0.12, 0.38, 5, R * 0.66, 0.17, R * 0.5, [0.62, 0.4, 0.28]);
  return k.finish(caveMats(rng, {
    crystal: glow(0x4aa6dc, 0.5),
    crystalTip: glow(0x8fdcff, 0.7),
  }));
}

// ---------------------------------------------------------------------------
// Sheets 5/6 — pools
// ---------------------------------------------------------------------------

/**
 * A pool: an irregular liquid surface below a BROKEN kerb of cave cobbles.
 * The kerb deliberately does not close — on the sheet the liquid spills past
 * it at two points, and a complete ring reads as a fountain instead.
 */
function pool(seed, liquidKey, mats, glowRim) {
  const rng = createRng(seed);
  const k = makeKit();
  const R = 1.7;
  const gapA = range(rng, 0, Math.PI * 2), gapB = gapA + range(rng, 2.0, 3.2);
  const near = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 0.45;
  // Bed, so the pool is a basin rather than a decal lying on grass.
  k.cyl('stoneDark', R * 1.02, R * 0.86, 0.14, 14, 0, 0.07, 0);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (near(a, gapA) || near(a, gapB)) continue;
    const rr = R * range(rng, 0.98, 1.14);
    k.box(pick(rng, ['stone', 'stoneDark', 'stoneLight']),
      range(rng, 0.42, 0.62), range(rng, 0.24, 0.4), range(rng, 0.32, 0.46),
      Math.sin(a) * rr, range(rng, 0.14, 0.2), Math.cos(a) * rr,
      [range(rng, -0.1, 0.1), a, range(rng, -0.12, 0.12)]);
  }
  // Loose cobbles where the kerb breaks.
  for (const ga of [gapA, gapB]) {
    for (let i = 0; i < 3; i++) {
      cobble(k, rng, 'stone', Math.sin(ga) * R * range(rng, 1.1, 1.5), 0.08,
        Math.cos(ga) * R * range(rng, 1.1, 1.5), range(rng, 0.14, 0.24), 0.14);
    }
  }
  // The surface, flat and sitting BELOW the kerb's top (spec 5).
  k.cyl(liquidKey, R * 0.84, R * 0.8, 0.1, 16, 0, 0.13, 0);
  if (glowRim) {
    // A brighter ring right at the waterline — this is what lights the cobbles
    // around it in the reference room, and it costs one cylinder.
    k.cyl('rim', R * 0.86, R * 0.84, 0.035, 16, 0, 0.175, 0);
  }
  return k.finish(mats(rng));
}

export const generateCavePoolWater = (seed) => pool(seed, 'liquid', (rng) => caveMats(rng, {
  liquid: glow(0x1e8f8a, 0.3),
  rim: glow(0x63e8d8, 0.5),
}), true);

export const generateCavePoolAcid = (seed) => pool(seed, 'liquid', (rng) => caveMats(rng, {
  liquid: glow(0x5fbe33, 0.34),
  rim: glow(0x9df05a, 0.5),
}), true);

// ---------------------------------------------------------------------------
// Sheet 6 — the room's carpentry and ironwork
// ---------------------------------------------------------------------------

/**
 * Mine timbering: two posts, a heavy head beam, angled braces at each top
 * corner. NO collider (see propTypes) — the whole point of it is walking under.
 */
export function generateCaveMineSupport(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.6, H = 2.9, T = 0.24;
  for (const sx of [-1, 1]) {
    k.box('wood', T, H, T, sx * (W / 2), H / 2, 0);
    // Foot block, so the post lands on stone rather than in the dirt.
    k.box('stone', T * 1.7, 0.16, T * 1.7, sx * (W / 2), 0.08, 0);
    // Angled brace.
    k.box('woodDark', 0.16, 0.78, 0.16, sx * (W / 2 - 0.26), H - 0.28, 0, [0, 0, sx * 0.78]);
  }
  k.box('wood', W + 0.7, 0.3, T * 1.15, 0, H + 0.15, 0);
  // 3cm clear of the posts' own top (H): a packing plate flush with them puts
  // two opaque faces in one plane, and it flickers.
  k.box('woodDark', W + 0.5, 0.12, T * 1.35, 0, H - 0.09, 0);
  // Iron straps where the beam meets the posts.
  for (const sx of [-1, 1]) k.box('iron', T * 1.3, 0.1, T * 1.4, sx * (W / 2), H + 0.02, 0);
  return k.finish(lights(rng, { woodDark: matte(0x54401f) }));
}

/** A stone-framed opening filled with vertical bars and two rails. */
export function generateCaveGateBars(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.4, H = 3.1, D = 0.5;
  // Frame: two jambs and a head, built as plain cave blocks.
  for (const sx of [-1, 1]) {
    // Warm spine behind the jamb — the grout showing through the course gaps,
    // and the thing that makes the four blocks one piece of masonry instead of
    // four blocks stacked with 6cm of air between them.
    k.box('seam', 0.4, H, D * 0.62, sx * (W / 2 + 0.25), H / 2, -0.07);
    for (let c = 0; c < 4; c++) {
      // Depth steps by course rather than being drawn: two jamb blocks at the
      // same depth put their front faces in one plane and flicker.
      k.box(pick(rng, ['stone', 'stoneDark', 'stoneLight']), 0.5, H / 4 - 0.06,
        D * (0.86 + c * 0.07),
        sx * (W / 2 + 0.25), (H / 4) * (c + 0.5), 0.02 - c * 0.014,
        // Forced off-square, same reason as blockFace's yaw in caveKit.js:
        // past ~2.5 degrees an upright face stops being a coplanar candidate.
        [0, (c % 2 ? 1 : -1) * range(rng, 0.055, 0.1), 0]);
    }
  }
  k.box('seam', W + 1.1, 0.34, D * 0.7, 0, H + 0.1, -0.02);
  for (let i = 0; i < 4; i++) {
    k.box(pick(rng, ['stone', 'stoneLight']), (W + 1.0) / 4 - 0.06,
      0.44 * (0.9 + i * 0.06), D * (0.94 + i * 0.07),
      -(W + 1.0) / 2 + ((W + 1.0) / 4) * (i + 0.5), H + 0.14, 0.05 - i * 0.02,
      [0, (i % 2 ? 1 : -1) * range(rng, 0.055, 0.1), 0]);
  }
  // Bars.
  const bars = 7;
  for (let i = 0; i < bars; i++) {
    const bx = -W / 2 + 0.16 + ((W - 0.32) / (bars - 1)) * i;
    k.cyl('iron', 0.045, 0.045, H - 0.08, 6, bx, (H - 0.08) / 2, 0);
    // Spear tip, tucked under the head so nothing floats.
    k.cyl('ironLight', 0.008, 0.06, 0.16, 5, bx, H - 0.06, 0);
  }
  for (const y of [0.55, H - 0.6]) k.box('iron', W - 0.1, 0.09, 0.09, 0, y, 0);
  k.box('ironLight', 0.2, 0.22, 0.14, 0.06, H * 0.45, 0.06);
  return k.finish(lights(rng));
}

/** Loose boards laid as a path, slightly raised, with a rail post at one end. */
export function generateCaveWalkway(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.6, L = 3.2, DECK = 0.22;
  // Two bearers under the boards.
  for (const sx of [-1, 1]) k.box('woodDark', 0.14, DECK - 0.05, L - 0.2, sx * (W / 2 - 0.2), (DECK - 0.05) / 2, 0);
  // Stone pads, so the bearers meet the ground on something.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('stone', 0.34, 0.1, 0.34, sx * (W / 2 - 0.2), 0.05, sz * (L / 2 - 0.3));
    }
  }
  const boards = 9;
  for (let i = 0; i < boards; i++) {
    const bz = -L / 2 + 0.1 + ((L - 0.2) / boards) * (i + 0.5);
    k.box(chance(rng, 0.35) ? 'woodDark' : 'wood',
      W * range(rng, 0.94, 1.0), 0.07, (L - 0.2) / boards - 0.03,
      range(rng, -0.03, 0.03), DECK - 0.035, bz, [0, range(rng, -0.02, 0.02), 0]);
  }
  // Rail post at the far end.
  k.box('wood', 0.12, 0.95, 0.12, W / 2 - 0.12, DECK + 0.44, L / 2 - 0.2);
  k.box('woodDark', 0.1, 0.09, 0.7, W / 2 - 0.12, DECK + 0.72, L / 2 - 0.5);
  return k.finish(lights(rng, { woodDark: matte(0x54401f) }));
}
