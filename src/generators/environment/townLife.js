// src/generators/environment/townLife.js
// The props that make a town look INHABITED rather than merely built: garden
// beds, statues, a pergola, laundry strung between poles, carts and wagons,
// tables and chairs left outside, a dovecote, roadside stone, and the light
// defenses that dress a gate.
//
// Built 2026-07-31 from Dennis's reference sheets — specifically the
// "DECORATIONS & ENVIRONMENT", "PROPS & SMALL DETAILS" and "WALLS & DEFENSES"
// rows of the big catalog sheet, plus the flowerbeds/fountain/market stalls on
// the second sheet and the churchyard on the fourth.
//
// Same conventions as townProps.js and townDecor.js, and for the same reasons:
//   - front is +Z and nothing self-rotates (the author aims it with
//     prop.rotation);
//   - everything goes through meshKit, so a 60-piece pergola is 3 draw calls;
//   - no material sets `metalness` — there is no environment map anywhere in
//     src/render, and a metallic MeshStandardMaterial has no diffuse term, so
//     it renders as a black silhouette;
//   - two opaque faces must never share a plane (scripts/check-zfight.mjs), so
//     every trim piece is proud of, or sunk into, the piece it sits on.
import * as THREE from 'three';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';
import { makeKit, matte, metal, stripedCloth } from './meshKit.js';

const WOOD = [0x9c7048, 0xa87a4e, 0x8f6540];
const WOOD_DARK = [0x7a5636, 0x6f4e30, 0x654626];
const STONE = [0xb4aca0, 0xc0b8ab, 0xa9a196];
const STONE_DARK = 0x8f877c;
const IRON = 0x6a6a74;
// Mid brown, not the 0x4a3a2a the planters use. On a bed you look straight
// down into, that darker soil reads as a hole in the ground rather than earth.
const SOIL = 0x6b5539;
const LEAF = [0x4f8a3f, 0x5b9648, 0x477c39];
const LEAF_DARK = 0x36612c;
const PETALS = [0xd8534a, 0xe8a0c0, 0xe4c95a, 0xc27ab8, 0xdcdccd, 0xe0842c, 0x8f7ad0];
const CLOTH = [0xc44a3f, 0x3f6f9c, 0x4f7f3a, 0xd9c48f, 0xd9d2c2];

/** Every material key any builder in this file uses, so a typo can't ship a
 *  white-untextured mesh (an unresolved key becomes three's default material). */
const M = (rng, extra = {}) => ({
  wood: matte(pick(rng, WOOD)),
  woodDark: matte(pick(rng, WOOD_DARK)),
  stone: matte(pick(rng, STONE)),
  stoneDark: matte(STONE_DARK),
  stoneLight: matte(0xcac4b8),
  iron: metal(IRON),
  soil: matte(SOIL),
  leaf: matte(pick(rng, LEAF)),
  leafDark: matte(LEAF_DARK),
  cloth: matte(pick(rng, CLOTH)),
  water: matte(0x4f9fc0),
  ...extra,
});

/**
 * A drift of blooms over a bed: a stem and a head each, clustered rather than
 * evenly spread. `shape(i)` returns a point inside the bed, or null to skip.
 */
function bloomDrift(k, rng, count, shape, opts = {}) {
  const hMin = opts.hMin ?? 0.14, hMax = opts.hMax ?? 0.30;
  const y0 = opts.y ?? 0;
  for (let i = 0; i < count; i++) {
    const p = shape(i);
    if (!p) continue;
    const h = range(rng, hMin, hMax);
    k.cyl('leafDark', 0.015, 0.022, h, 3, p.x, y0 + h / 2, p.z);
    k.ico(`bloom${1 + (i % 3)}`, range(rng, 0.055, 0.085), p.x, y0 + h, p.z);
  }
  // Low foliage between the stems, so the bed isn't a field of lollipops.
  for (let i = 0; i < Math.ceil(count * 0.4); i++) {
    const p = shape(i * 3 + 1);
    if (!p) continue;
    k.ico('leaf', range(rng, 0.075, 0.115), p.x, y0 + range(rng, 0.04, 0.10), p.z, [1.3, 0.65, 1.3]);
  }
}

/** Three petal colours per bed — a single-colour bed reads as plastic. */
const bloomMats = (rng) => {
  const a = pick(rng, PETALS);
  let b = pick(rng, PETALS), c = pick(rng, PETALS);
  if (b === a) b = PETALS[(PETALS.indexOf(a) + 2) % PETALS.length];
  if (c === a || c === b) c = PETALS[(PETALS.indexOf(a) + 4) % PETALS.length];
  return { bloom1: matte(a), bloom2: matte(b), bloom3: matte(c) };
};

// =============================================================================
// Flower beds
// =============================================================================

/**
 * Every bed comes in two versions: planted, and bare soil.
 *
 * The empty ones are not "the same prop with the flowers deleted" as far as an
 * author is concerned — they are the freshly-turned bed outside a house under
 * construction, the one a gardener NPC stands over, the one you re-dress with
 * separate `flower-*` props at whatever density the scene wants. `planted` is
 * the only thing that differs, so the two stay in lockstep by construction.
 */
function bedMats(rng, planted) {
  return M(rng, planted ? bloomMats(rng) : {});
}

/** A circular bed inside a ring of kerbstones. */
export function generateFlowerbedRound(seed, { planted = true } = {}) {
  const rng = createRng(seed);
  const k = makeKit();
  const R = 1.15;
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Alternating heights, so the kerb reads as laid stones and not a pipe.
    // Both stand clear of the soil's top face at 0.22 — a kerb whose top lands
    // exactly on the soil is two opaque faces in one plane.
    const h = i % 2 ? 0.32 : 0.27;
    // -a - PI/2, NOT -a: a Y-rotation of -a points the box's LENGTH along the
    // radius, so the kerb came out as a ring of spokes sticking out of the bed
    // like cog teeth. -a - PI/2 lays each stone along the tangent.
    k.box('stone', 0.56, h, 0.26, Math.cos(a) * R, h / 2, Math.sin(a) * R, [0, -a - Math.PI / 2, 0]);
  }
  k.cyl('soil', R - 0.07, R - 0.07, 0.22, 14, 0, 0.11, 0);
  const spot = (i) => {
    const a = (i * 2.399) % (Math.PI * 2);          // golden-angle spiral: even without clumping
    const r = Math.sqrt(((i * 0.618) % 1)) * (R - 0.22);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };
  if (planted) bloomDrift(k, rng, 28, spot, { y: 0.21 });
  return k.finish(bedMats(rng, planted));
}

/** A square raised bed in a timber frame. */
export function generateFlowerbedSquare(seed, { planted = true } = {}) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.5, H = 0.34;
  for (const [dx, dz, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
    k.box('wood', W, H, 0.13, dx * (W / 2 - 0.065), H / 2, dz * (W / 2 - 0.065), [0, rot, 0]);
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('woodDark', 0.19, H + 0.10, 0.19, sx * (W / 2 - 0.06), (H + 0.10) / 2 - 0.03, sz * (W / 2 - 0.06));
    }
  }
  // Soil top at H - 0.03, so it sits just below the frame's top face.
  k.box('soil', W - 0.20, 0.18, W - 0.20, 0, H - 0.12, 0);
  const spot = () => ({
    x: range(rng, -W / 2 + 0.22, W / 2 - 0.22),
    z: range(rng, -W / 2 + 0.22, W / 2 - 0.22),
  });
  if (planted) bloomDrift(k, rng, 16, spot, { y: H - 0.02 });
  return k.finish(bedMats(rng, planted));
}

/** A long trough bed, for lining a street or an avenue. */
export function generateFlowerbedLong(seed, { planted = true } = {}) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 3.0, D = 0.95, H = 0.32;
  for (const sz of [-1, 1]) k.box('wood', L, H, 0.12, 0, H / 2, sz * (D / 2 - 0.06));
  for (const sx of [-1, 1]) k.box('wood', 0.12, H, D - 0.20, sx * (L / 2 - 0.06), H / 2, 0);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      k.box('woodDark', 0.17, H + 0.09, 0.17, sx * (L / 2 - 0.06), (H + 0.09) / 2 - 0.03, sz * (D / 2 - 0.06));
    }
  }
  k.box('soil', L - 0.20, 0.17, D - 0.22, 0, H - 0.115, 0);
  const spot = () => ({
    x: range(rng, -L / 2 + 0.20, L / 2 - 0.20),
    z: range(rng, -D / 2 + 0.20, D / 2 - 0.20),
  });
  if (planted) bloomDrift(k, rng, 22, spot, { y: H - 0.02 });
  return k.finish(bedMats(rng, planted));
}

/**
 * A clipped hedge run. A plain green box reads as a shipping container, so the
 * body is a dark core with a lighter, jittered crust of blobs over it — the
 * same "solid inside, broken outline" trick the round trees use.
 */
export function generateHedge(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.4, D = 0.85, H = 1.05;
  k.box('leafDark', L - 0.24, H, D - 0.20, 0, H / 2, 0);
  k.box('woodDark', L - 0.5, 0.16, D - 0.42, 0, 0.08, 0);
  // The crust is deliberately TIGHT and squashed. A first pass with fat, varied
  // blobs came out as a pile of boulders painted green — a clipped hedge's
  // silhouette is a box with softened corners, so the blobs overlap heavily and
  // are flattened rather than spherical.
  const cols = 7, rows = 2;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      for (const sz of [-1, 1]) {
        k.ico('leaf', range(rng, 0.25, 0.30),
          -L / 2 + 0.20 + (i * (L - 0.40)) / (cols - 1) + range(rng, -0.03, 0.03),
          0.32 + j * 0.42 + range(rng, -0.04, 0.04),
          sz * (D / 2 - 0.16) + range(rng, -0.02, 0.02),
          [1.35, 1.15, 0.72]);
      }
    }
  }
  for (let i = 0; i < cols; i++) {
    k.ico('leaf', range(rng, 0.24, 0.29),
      -L / 2 + 0.20 + (i * (L - 0.40)) / (cols - 1), H - 0.08 + range(rng, -0.03, 0.03), range(rng, -0.06, 0.06),
      [1.35, 0.62, 1.4]);
  }
  for (const sx of [-1, 1]) {
    for (let j = 0; j < 2; j++) {
      k.ico('leaf', 0.27, sx * (L / 2 - 0.18), 0.36 + j * 0.44, 0, [0.75, 1.2, 1.35]);
    }
  }
  return k.finish(M(rng));
}

// =============================================================================
// Statues
// =============================================================================

/** A tiered plinth, shared by both statues. Returns the top Y. */
function plinth(k, rng, w = 1.25) {
  k.box('stone', w + 0.30, 0.22, w + 0.30, 0, 0.11, 0);
  k.box('stoneDark', w + 0.10, 0.20, w + 0.10, 0, 0.32, 0);
  k.box('stone', w, 1.05, w, 0, 0.94, 0);
  // Inscription panel, proud of the die so the two faces never coincide.
  k.box('stoneDark', w * 0.62, 0.44, 0.05, 0, 0.92, w / 2 + 0.02);
  k.box('stoneDark', w + 0.16, 0.16, w + 0.16, 0, 1.53, 0);
  k.box('stone', w + 0.02, 0.10, w + 0.02, 0, 1.63, 0);
  return 1.66;
}

/** The reference sheet's "STATUE (KNIGHT)": a swordsman at rest, shield down. */
export function generateStatueKnight(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const y0 = plinth(k, rng);

  // Legs, one weighted forward — a statue standing to attention reads as a post.
  k.box('stoneLight', 0.24, 0.86, 0.28, -0.16, y0 + 0.43, -0.02);
  k.box('stoneLight', 0.24, 0.86, 0.30, 0.17, y0 + 0.43, 0.06, [0.10, 0, 0]);
  // Feet wider than the legs and offset, so no boot's inner face lands in the
  // same plane as the shin above it.
  for (const [fx, fz] of [[-0.16, 0.04], [0.19, 0.16]]) {
    k.box('stoneDark', 0.32, 0.12, 0.42, fx, y0 + 0.06, fz);
  }
  // Skirt of mail over the hips.
  k.cyl('stoneLight', 0.34, 0.42, 0.40, 8, 0, y0 + 1.02, 0);
  k.box('stoneLight', 0.56, 0.66, 0.36, 0, y0 + 1.52, 0);
  k.box('stoneDark', 0.60, 0.13, 0.40, 0, y0 + 1.20, 0);               // belt
  // Shoulders and pauldrons.
  k.box('stoneLight', 0.78, 0.20, 0.38, 0, y0 + 1.86, 0);
  for (const sx of [-1, 1]) k.sphere('stoneLight', 0.21, sx * 0.42, y0 + 1.86, 0, [1, 0.75, 1]);
  // Head under a barrel helm with a crest.
  k.cyl('stoneLight', 0.17, 0.19, 0.34, 8, 0, y0 + 2.12, 0);
  k.box('stoneDark', 0.30, 0.06, 0.10, 0, y0 + 2.16, 0.14);            // visor slit
  k.box('stoneDark', 0.07, 0.26, 0.32, 0, y0 + 2.38, -0.02);           // crest
  // Sword arm: down, both hands on the pommel, blade point resting on the base.
  for (const sx of [-1, 1]) {
    k.box('stoneLight', 0.17, 0.62, 0.19, sx * 0.40, y0 + 1.50, 0.10, [0.25, 0, -sx * 0.14]);
    k.box('stoneLight', 0.15, 0.36, 0.16, sx * 0.30, y0 + 1.10, 0.26, [0.55, 0, 0]);
  }
  k.box('stoneDark', 0.13, 0.24, 0.13, 0, y0 + 0.96, 0.34);            // grip
  k.box('stoneDark', 0.42, 0.09, 0.13, 0, y0 + 0.82, 0.34);            // crossguard
  k.box('stoneLight', 0.15, 0.80, 0.06, 0, y0 + 0.40, 0.34);           // blade
  k.cone('stoneLight', 0.10, 0.16, 4, 0, y0 + 0.00, 0.34, [Math.PI, 0, 0]);
  k.sphere('stoneDark', 0.09, 0, y0 + 1.10, 0.34);                     // pommel
  // Shield slung on the left arm.
  k.box('stoneDark', 0.44, 0.62, 0.09, -0.52, y0 + 1.34, 0.18, [0, 0.2, 0.12]);
  k.box('stoneDark', 0.32, 0.32, 0.09, -0.55, y0 + 0.98, 0.20, [0, 0.2, Math.PI / 4]);
  k.sphere('stoneLight', 0.10, -0.52, y0 + 1.36, 0.25, [1, 1, 0.6]);

  return k.finish(M(rng));
}

/** "STATUE (DRAGON)": a wyvern crouched on the plinth, wings half-open. */
export function generateStatueDragon(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const y0 = plinth(k, rng, 1.35);

  // Body: a tapered barrel leaning up onto the forelegs.
  k.cyl('stoneLight', 0.30, 0.44, 1.05, 8, 0, y0 + 0.62, -0.06, [1.30, 0, 0]);
  k.sphere('stoneLight', 0.34, 0, y0 + 0.86, -0.34, [1, 1, 1.2]);
  // Haunches and forelegs.
  for (const sx of [-1, 1]) {
    k.sphere('stoneLight', 0.24, sx * 0.30, y0 + 0.42, -0.38, [1, 1.1, 1.2]);
    k.cyl('stoneLight', 0.10, 0.13, 0.42, 6, sx * 0.30, y0 + 0.21, -0.30);
    k.box('stoneDark', 0.22, 0.10, 0.30, sx * 0.30, y0 + 0.05, -0.22);
    k.cyl('stoneLight', 0.09, 0.12, 0.62, 6, sx * 0.26, y0 + 0.31, 0.30, [0.22, 0, 0]);
    k.box('stoneDark', 0.20, 0.10, 0.28, sx * 0.26, y0 + 0.05, 0.40);
  }
  // Neck and head, raised. The tilt is +0.55, not -0.55: a rotation about X of
  // -0.55 swings the neck's far end BACKWARDS (-Z) while the head sits at +Z,
  // which left the head floating clear of the body with a gap behind it.
  k.cyl('stoneLight', 0.14, 0.24, 0.78, 8, 0, y0 + 1.20, 0.14, [0.55, 0, 0]);
  k.box('stoneLight', 0.30, 0.26, 0.40, 0, y0 + 1.58, 0.38);
  k.box('stoneLight', 0.20, 0.16, 0.30, 0, y0 + 1.52, 0.63);            // snout
  k.box('stoneDark', 0.21, 0.05, 0.26, 0, y0 + 1.47, 0.64);             // jawline
  for (const sx of [-1, 1]) {
    k.cone('stoneDark', 0.06, 0.30, 4, sx * 0.11, y0 + 1.78, 0.30, [-0.5, 0, 0]);  // horns
    k.sphere('stoneDark', 0.05, sx * 0.14, y0 + 1.62, 0.50);                        // eyes
  }
  // Wings, half-open: a fan of four membrane panels springing from one shoulder
  // point, each rolled further out and swept further back than the last.
  //
  // The first attempt hung one big slab off a spar and read as a plank nailed
  // to the statue's back — the fan is what makes it a wing. Each panel's CENTRE
  // has to be derived from its own roll angle (a box rotated by θ about Z runs
  // along (-sin θ, cos θ)), not placed by eye, or the panels leave the shoulder
  // and splay into midair.
  for (const sx of [-1, 1]) {
    const shX = sx * 0.30, shY = y0 + 1.02, shZ = -0.30;
    for (let i = 0; i < 4; i++) {
      const t = i / 3;
      const roll = 0.40 + t * 0.66;                 // near-vertical, out to ~60°
      const len = 1.55 - t * 0.42;
      const cx = shX + Math.sin(roll) * sx * len / 2;
      const cy = shY + Math.cos(roll) * len / 2;
      const cz = shZ - t * 0.30;
      // The outermost finger is the leading-edge spar: thicker and darker.
      const lead = i === 3;
      k.box(lead ? 'stoneDark' : 'stoneLight', lead ? 0.13 : 0.40, len, lead ? 0.13 : 0.06,
        cx, cy, cz, [0, 0, -sx * roll]);
    }
    // Shoulder joint, covering where the four panels converge.
    k.sphere('stoneDark', 0.19, shX, shY + 0.12, shZ, [1, 1, 0.8]);
  }
  // Tail, three tapering joints curling round the plinth's back edge.
  // The tail is walked as a CHAIN: each joint is centred on the midpoint of the
  // step and rotated to point along it, so consecutive joints always overlap.
  //
  // It used to advance by a hand-written (dx, dy, dz) while being rotated by an
  // unrelated hand-written Euler, so the joints pointed one way and marched
  // another — the last two ended up as loose stones hanging behind the plinth.
  let p = new THREE.Vector3(0, y0 + 0.44, -0.62);
  let dir = new THREE.Vector3(0.34, -0.10, -0.92).normalize();
  for (let i = 0; i < 3; i++) {
    const r = 0.15 - i * 0.04;
    const len = 0.5;
    const next = p.clone().addScaledVector(dir, len * 0.82);   // 18% overlap per joint
    const mid = p.clone().add(next).multiplyScalar(0.5);
    // A cylinder's axis is local +Y, so aim it by the rotation that takes +Y
    // onto `dir` — deriving it here rather than guessing Euler angles is the
    // whole point.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    k.cyl('stoneLight', r * 0.72, r, len, 6, mid.x, mid.y, mid.z, [e.x, e.y, e.z]);
    p = next;
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.42).normalize();
  }
  {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    k.cone('stoneDark', 0.085, 0.3, 4, p.x, p.y, p.z, [e.x, e.y, e.z]);
  }

  return k.finish(M(rng));
}

// =============================================================================
// Scalloped fountain (reference sheet 2)
// =============================================================================

/**
 * A quatrefoil fountain: four scalloped lobes round a square basin, a slender
 * fluted column and an upper bowl. Deliberately a different silhouette from the
 * octagonal `fountain` in townDecor.js rather than a restyle of it — an author
 * picking between them should be picking between two shapes, not two palettes.
 */
export function generateFountainScalloped(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const R = 1.55;        // half-width of the square core
  const LOBE = 1.05;     // radius of each scallop

  // Apron, one step proud of the plaza.
  k.box('stoneDark', R * 2 + 0.9, 0.14, R * 2 + 0.9, 0, 0.07, 0);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    k.cyl('stoneDark', LOBE + 0.44, LOBE + 0.44, 0.14, 12, dx * R, 0.07, dz * R);
  }

  // Basin walls: a square core plus four lobes, each an open ring wall.
  const wallY = 0.52, wallH = 0.62;
  const ring = (key, cx, cz, rOut, rIn, y, h) =>
    k.raw(key, new THREE.LatheGeometry([
      new THREE.Vector2(rOut, y), new THREE.Vector2(rOut, y + h),
      new THREE.Vector2(rIn, y + h), new THREE.Vector2(rIn, y),
    ], 12), cx, 0, cz);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ring('stone', dx * R, dz * R, LOBE, LOBE - 0.24, 0.14, wallH);
    // Coping over each lobe, sunk 3 cm into the wall below it.
    ring('stoneLight', dx * R, dz * R, LOBE + 0.13, LOBE - 0.30, wallY + 0.21, 0.16);
  }
  // The square core between the lobes.
  k.box('stone', R * 2, wallH, R * 2, 0, 0.14 + wallH / 2, 0);
  k.box('stoneLight', R * 2 - 0.30, 0.16, R * 2 - 0.30, 0, wallY + 0.29, 0);
  // Water: one disc per lobe plus one square, 12 cm under the coping.
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    k.cyl('water', LOBE - 0.06, LOBE - 0.06, 0.05, 12, dx * R, wallY + 0.06, dz * R);
  }
  k.box('water', R * 2 - 0.10, 0.05, R * 2 - 0.10, 0, wallY + 0.06, 0);

  // Column: a fluted shaft on a moulded base, an upper bowl and a finial.
  k.cyl('stoneLight', 0.46, 0.58, 0.26, 8, 0, 0.42, 0);
  k.cyl('stone', 0.30, 0.40, 0.20, 8, 0, 0.65, 0);
  k.cyl('stone', 0.22, 0.26, 1.35, 8, 0, 1.42, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.cyl('stoneLight', 0.045, 0.045, 1.20, 4, Math.cos(a) * 0.245, 1.42, Math.sin(a) * 0.245);
  }
  k.torus('stoneLight', 0.30, 0.07, 0, 2.10, 0, [Math.PI / 2, 0, 0]);
  // Upper bowl, open — same outer-then-inner lathe ordering as townDecor's
  // fountain, so its normals face the right way on a single-sided material.
  k.raw('stone', new THREE.LatheGeometry([
    new THREE.Vector2(0.24, 2.18), new THREE.Vector2(0.72, 2.44), new THREE.Vector2(0.76, 2.56),
    new THREE.Vector2(0.66, 2.54), new THREE.Vector2(0.60, 2.42), new THREE.Vector2(0.20, 2.28),
  ].map((v) => v), 12), 0, 0, 0);
  k.cyl('water', 0.62, 0.62, 0.04, 12, 0, 2.47, 0);
  k.cyl('stone', 0.10, 0.16, 0.34, 8, 0, 2.72, 0);
  k.cone('stoneLight', 0.13, 0.42, 6, 0, 3.05, 0);

  // Four falling sheets from the bowl's rim to the basins below.
  //
  // These were four SPHERES apiece spaced along an arc — which is what "the
  // fountain only has some droplets" was describing. A fountain reads as water
  // because of a continuous falling ribbon, not because of beads in a line, so
  // each jet is now a chain of overlapping segments following the arc, with a
  // splash where it lands.
  const SEGS = 14;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const at = (t) => new THREE.Vector3(
      dx * (0.66 + t * 1.62), 2.42 - t * t * 1.86, dz * (0.66 + t * 1.62)
    );
    for (let i = 0; i < SEGS; i++) {
      const a = at(i / SEGS), b = at((i + 1) / SEGS);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const seg = b.clone().sub(a);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
      const e = new THREE.Euler().setFromQuaternion(q);
      // 1.35x the step, so consecutive segments always overlap.
      k.cyl('water', 0.055, 0.075, seg.length() * 1.35, 5, mid.x, mid.y, mid.z, [e.x, e.y, e.z]);
    }
    // Splash ring where it meets the lobe's water surface.
    const land = at(1);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      k.sphere('water', 0.09, land.x + Math.cos(a) * 0.17, wallY + 0.09, land.z + Math.sin(a) * 0.17, [1.3, 0.5, 1.3]);
    }
  }

  return k.finish(M(rng, { water: matte(0x5aa8c8) }));
}

// =============================================================================
// Pergola
// =============================================================================

/** A vine-covered arbor. No collider (see propTypes) — walking under it is
 *  the whole point of putting one in a park. */
export function generatePergola(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.0, D = 2.2, H = 2.45;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * (W / 2 - 0.14), pz = sz * (D / 2 - 0.14);
      k.box('stone', 0.34, 0.20, 0.34, px, 0.10, pz);
      k.box('woodDark', 0.19, H, 0.19, px, H / 2 + 0.14, pz);
      // Corner brace, so the frame doesn't read as four loose sticks.
      k.box('wood', 0.42, 0.10, 0.10, px - sx * 0.21, H - 0.22, pz, [0, 0, sx * 0.78]);
    }
  }
  for (const sz of [-1, 1]) k.box('wood', W + 0.24, 0.17, 0.13, 0, H + 0.22, sz * (D / 2 - 0.14));
  const rafters = 7;
  for (let i = 0; i < rafters; i++) {
    const x = -W / 2 + 0.16 + (i * (W - 0.32)) / (rafters - 1);
    k.box('woodDark', 0.09, 0.13, D + 0.44, x, H + 0.37, 0);
  }
  // Lattice down the back panel.
  for (let i = 0; i < 5; i++) {
    k.box('wood', 0.06, H - 0.30, 0.05, -W / 2 + 0.3 + i * ((W - 0.6) / 4), H / 2 + 0.22, -D / 2 + 0.14);
  }
  for (let i = 0; i < 4; i++) {
    k.box('wood', W - 0.4, 0.05, 0.06, 0, 0.55 + i * 0.52, -D / 2 + 0.19);
  }
  // Vine: foliage clumps riding the rafters and running down the back posts.
  for (let i = 0; i < 22; i++) {
    const onTop = i < 15;
    const x = range(rng, -W / 2 - 0.05, W / 2 + 0.05);
    const y = onTop ? range(rng, H + 0.30, H + 0.58) : range(rng, 0.6, H);
    const z = onTop ? range(rng, -D / 2 - 0.16, D / 2 + 0.16) : -D / 2 + range(rng, 0.02, 0.22);
    k.ico(chance(rng, 0.3) ? 'leafDark' : 'leaf', range(rng, 0.17, 0.29), x, y, z, [1.25, 0.72, 1.15]);
  }
  // Blossom sits ON a rafter, not at a free-floating height: the rafters are
  // 9 cm wide and 45 cm apart, so a random x landed between them more often
  // than not and left the flower hanging in the gap.
  const rafterX = (i) => -W / 2 + 0.16 + ((i % rafters) * (W - 0.32)) / (rafters - 1);
  for (let i = 0; i < 9; i++) {
    k.ico('bloom1', range(rng, 0.055, 0.085),
      rafterX(i * 3 + 1) + range(rng, -0.04, 0.04),
      H + 0.37 + range(rng, 0.02, 0.14), range(rng, -D / 2, D / 2));
  }
  return k.finish(M(rng, { bloom1: matte(pick(rng, [0xe8a0c0, 0xdcdccd, 0x8f7ad0])) }));
}

// =============================================================================
// Carts, wagons, market
// =============================================================================

/** A spoked wheel lying in the XY plane (axle along Z), cheap enough to use
 *  four of: a cylinder rim rather than a torus, which is 3x the triangles. */
function wheel(k, x, y, z, r = 0.42, t = 0.11, spokes = 6) {
  k.cyl('woodDark', r, r, t, 12, x, y, z, [Math.PI / 2, 0, 0]);
  k.cyl('iron', r + 0.035, r + 0.035, t * 0.55, 12, x, y, z, [Math.PI / 2, 0, 0]);
  k.cyl('wood', r * 0.24, r * 0.24, t * 1.5, 8, x, y, z, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI;
    k.box('wood', r * 1.75, 0.055, t * 0.7, x, y, z, [0, 0, a]);
  }
}

/** "FLOWER CART": a two-wheeled hand cart heaped with cut flowers. */
export function generateFlowerCart(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 1.9, W = 1.0;
  const bedY = 0.60;
  // The bed is inset from the boards that sit on it, rather than flush with
  // them: a board whose outer face lands exactly on the bed's is a flicker.
  k.box('wood', L - 0.06, 0.10, W - 0.06, 0, bedY, 0);
  for (const sz of [-1, 1]) k.box('woodDark', L, 0.34, 0.09, 0, bedY + 0.19, sz * (W / 2 - 0.045));
  k.box('woodDark', 0.10, 0.34, W - 0.14, -L / 2 + 0.10, bedY + 0.19, 0);
  k.box('woodDark', 0.10, 0.44, W - 0.14, L / 2 - 0.10, bedY + 0.24, 0);
  for (const sz of [-1, 1]) k.box('woodDark', L - 0.2, 0.11, 0.11, 0, bedY - 0.10, sz * (W / 2 - 0.16));
  // Handles out the back, and a leg to stand the cart level.
  for (const sz of [-1, 1]) k.box('wood', 0.85, 0.09, 0.09, -L / 2 - 0.34, bedY - 0.02, sz * (W / 2 - 0.18), [0, 0, 0.16]);
  k.box('woodDark', 0.09, 0.52, 0.09, -L / 2 - 0.62, 0.26, 0);
  for (const sz of [-1, 1]) wheel(k, 0.18, 0.42, sz * (W / 2 + 0.10), 0.42, 0.10);
  k.cyl('iron', 0.05, 0.05, W + 0.3, 6, 0.18, 0.42, 0, [Math.PI / 2, 0, 0]);

  // The load: crates of cut stems and a mound of blooms.
  for (const [cx, cz] of [[-0.5, -0.22], [-0.42, 0.26]]) {
    k.box('wood', 0.44, 0.24, 0.36, cx, bedY + 0.17, cz);
  }
  for (let i = 0; i < 34; i++) {
    const x = range(rng, -L / 2 + 0.2, L / 2 - 0.15);
    const z = range(rng, -W / 2 + 0.16, W / 2 - 0.16);
    // A MOUND, not a random cloud: height falls off towards the cart's edges,
    // so every bloom is part of a continuous heap rooted on the bed (top face
    // at bedY + 0.05). A uniform random height left strays hanging in the air
    // above the crates with nothing under them.
    const t = Math.min(1, Math.hypot(x / (L / 2 - 0.15), z / (W / 2 - 0.16)));
    const y = bedY + 0.04 + (1 - t * 0.8) * range(rng, 0.06, 0.34);
    k.ico(`bloom${1 + (i % 3)}`, range(rng, 0.055, 0.09), x, y, z);
    if (i % 3 === 0) k.ico('leaf', range(rng, 0.08, 0.12), x + 0.05, y - 0.09, z, [1.2, 0.6, 1.2]);
  }
  return k.finish(M(rng, bloomMats(rng)));
}

/** "WAGON": a four-wheeled dray, loaded. */
export function generateWagon(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 3.2, W = 1.45, bedY = 0.78;
  // Inset from the sideboards, same reason as the flower cart's bed.
  k.box('wood', L - 0.06, 0.12, W - 0.06, 0, bedY, 0);
  for (const sz of [-1, 1]) {
    k.box('woodDark', L, 0.52, 0.10, 0, bedY + 0.29, sz * (W / 2 - 0.05));
    k.box('wood', L - 0.1, 0.09, 0.14, 0, bedY + 0.53, sz * (W / 2 - 0.05));
  }
  for (const sx of [-1, 1]) k.box('woodDark', 0.10, 0.52, W - 0.16, sx * (L / 2 - 0.12), bedY + 0.29, 0);
  for (let i = 0; i < 3; i++) k.box('woodDark', 0.12, 0.13, W + 0.2, -0.9 + i * 0.9, bedY - 0.12, 0);
  // Axles and wheels — front pair smaller, as a wagon's steering pair is.
  for (const [ax, r] of [[-1.05, 0.55], [1.12, 0.42]]) {
    k.cyl('iron', 0.055, 0.055, W + 0.42, 6, ax, r, 0, [Math.PI / 2, 0, 0]);
    for (const sz of [-1, 1]) wheel(k, ax, r, sz * (W / 2 + 0.16), r, 0.13, 6);
  }
  // Draught pole and swingletree. The pole runs BACK far enough to reach the
  // front axle (x ≈ 1.12) and sits at its height — at 1.5 long starting at
  // x = 1.47 and y = 0.52 it cleared both the axle and the bed's underside and
  // floated in front of the wagon with nothing holding it.
  k.box('wood', 2.3, 0.11, 0.11, L / 2 + 0.42, 0.47, 0, [0, 0, -0.06]);
  k.box('woodDark', 0.10, 0.10, 0.9, L / 2 + 1.3, 0.44, 0);
  // Load: sacks and a barrel under a tied cloth.
  for (let i = 0; i < 5; i++) {
    k.sphere('cloth', range(rng, 0.20, 0.27),
      range(rng, -L / 2 + 0.4, L / 2 - 0.4), bedY + range(rng, 0.24, 0.36), range(rng, -0.3, 0.3),
      [1.15, 0.85, 1.0]);
  }
  k.cyl('woodDark', 0.30, 0.30, 0.78, 10, -0.9, bedY + 0.45, 0.02, [Math.PI / 2, 0, 0]);
  for (const o of [-0.26, 0.26]) k.cyl('iron', 0.315, 0.315, 0.05, 10, -0.9 + o * 0, bedY + 0.45, o, [Math.PI / 2, 0, 0]);
  return k.finish(M(rng));
}

/** "SACKS": a heap of tied grain sacks. */
export function generateSacks(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const place = (x, z, s, lean) => {
    k.sphere('sack', 0.30 * s, x, 0.28 * s, z, [1.0, 1.25, 0.85]);
    k.sphere('sack', 0.24 * s, x + lean * 0.05, 0.56 * s, z, [0.9, 0.85, 0.8]);
    k.cyl('rope', 0.075 * s, 0.10 * s, 0.10 * s, 6, x + lean * 0.06, 0.70 * s, z);
    k.cone('sack', 0.12 * s, 0.16 * s, 5, x + lean * 0.07, 0.80 * s, z);
  };
  place(-0.34, -0.16, 1.0, -1);
  place(0.30, -0.24, 0.92, 1);
  place(0.02, 0.32, 0.86, 0);
  // One fallen on its side, spilling a little grain.
  k.sphere('sack', 0.27, 0.62, 0.24, 0.44, [1.3, 0.85, 0.85]);
  k.cone('sack', 0.11, 0.18, 5, 0.95, 0.22, 0.46, [0, 0, -Math.PI / 2]);
  for (let i = 0; i < 7; i++) {
    k.ico('grain', range(rng, 0.045, 0.075), range(rng, 1.0, 1.35), 0.05, range(rng, 0.30, 0.60), [1, 0.5, 1]);
  }
  return k.finish(M(rng, {
    sack: matte(pick(rng, [0xc8b088, 0xbfa87e, 0xd2bb93])),
    rope: matte(0x8a7247),
    grain: matte(0xd8c079),
  }));
}

/** "TABLE": a trestle table, for a tavern's terrace or a market square. */
export function generateTrestleTable(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.2, D = 0.85, H = 0.78;
  for (let i = 0; i < 4; i++) k.box('wood', L, 0.055, D / 4 - 0.015, 0, H, -D / 2 + D / 8 + i * (D / 4));
  k.box('woodDark', L + 0.08, 0.06, 0.08, 0, H - 0.055, 0);
  for (const sx of [-1, 1]) {
    const tx = sx * (L / 2 - 0.36);
    for (const sz of [-1, 1]) k.box('woodDark', 0.10, H - 0.07, 0.10, tx + sz * 0.0, (H - 0.07) / 2, sz * (D / 2 - 0.14), [0, 0, sx * 0.10]);
    k.box('woodDark', 0.09, 0.09, D - 0.16, tx, H - 0.15, 0);
    k.box('woodDark', 0.10, 0.08, D + 0.06, tx, 0.05, 0);
  }
  // TWO stretchers, one in each leg plane. A single one down the centreline
  // ran at z=0 while the legs stand at z = ±0.285, so it touched neither
  // trestle and hung in the air between them.
  for (const sz of [-1, 1]) k.box('woodDark', L - 0.7, 0.08, 0.09, 0, 0.30, sz * (D / 2 - 0.14));
  return k.finish(M(rng));
}

/** "CHAIR": a plain ladder-back chair. */
export function generateWoodenChair(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 0.46, D = 0.44, seatY = 0.45;
  for (let i = 0; i < 3; i++) k.box('wood', W - 0.05, 0.045, D / 3 - 0.012, 0, seatY, -D / 2 + D / 6 + i * (D / 3));
  k.box('woodDark', W, 0.05, 0.06, 0, seatY - 0.045, D / 2 - 0.03);
  k.box('woodDark', W, 0.05, 0.06, 0, seatY - 0.045, -D / 2 + 0.03);
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.055, seatY, 0.055, sx * (W / 2 - 0.04), seatY / 2, D / 2 - 0.04);
    k.box('woodDark', 0.055, seatY + 0.62, 0.055, sx * (W / 2 - 0.04), (seatY + 0.62) / 2, -D / 2 + 0.04);
    k.box('woodDark', 0.05, 0.05, D - 0.1, sx * (W / 2 - 0.04), 0.15, 0);
  }
  for (const y of [seatY + 0.26, seatY + 0.50]) k.box('wood', W - 0.1, 0.10, 0.045, 0, y, -D / 2 + 0.04);
  k.box('wood', W - 0.02, 0.07, 0.06, 0, seatY + 0.62, -D / 2 + 0.04);
  return k.finish(M(rng));
}

/** Washing strung between two A-frames — the cheapest prop on this list and
 *  the one that most reads as "people live here". */
export function generateLaundryLine(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const SPAN = 4.4, H = 2.15;
  for (const sx of [-1, 1]) {
    const px = sx * (SPAN / 2);
    k.box('stone', 0.30, 0.14, 0.30, px, 0.07, 0);
    k.box('woodDark', 0.11, H, 0.11, px, H / 2 + 0.08, 0);
    for (const sz of [-1, 1]) k.box('wood', 0.08, H * 0.75, 0.08, px - sx * 0.02, H * 0.40, sz * 0.34, [sz * 0.42, 0, 0]);
    k.box('wood', 0.42, 0.08, 0.08, px, H + 0.04, 0);
  }
  // The rope sags: a chain of short segments, each tilted to follow the curve.
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const sag = (t) => H - 0.02 - 0.30 * Math.sin(Math.PI * t);
    const x0 = -SPAN / 2 + SPAN * t0, x1 = -SPAN / 2 + SPAN * t1;
    const y0 = sag(t0), y1 = sag(t1);
    // 0.05 thick, not 0.035: at the same thickness as the washing the rope's
    // side faces land in the cloths' plane and flicker along the whole line.
    k.box('rope', Math.hypot(x1 - x0, y1 - y0) + 0.01, 0.05, 0.05,
      (x0 + x1) / 2, (y0 + y1) / 2, 0, [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
  }
  const clothKeys = ['wash1', 'wash2', 'wash3'];
  for (let i = 0; i < 6; i++) {
    const t = 0.10 + i * 0.16;
    const x = -SPAN / 2 + SPAN * t;
    const y = H - 0.04 - 0.30 * Math.sin(Math.PI * t);
    const w = range(rng, 0.42, 0.66), hh = range(rng, 0.52, 0.86);
    const lean = range(rng, -0.10, 0.10);
    k.box(clothKeys[i % 3], w, hh, 0.034, x, y - hh / 2 - 0.02, 0, [0, 0, lean]);
    // A hem bar in a different cloth, standing proud so it isn't a shared plane.
    k.box(clothKeys[(i + 1) % 3], w * 0.92, 0.09, 0.07, x + Math.sin(lean) * hh, y - hh - 0.02, 0, [0, 0, lean]);
    for (const px of [-w * 0.3, w * 0.3]) k.box('woodDark', 0.045, 0.11, 0.056, x + px, y + 0.03, 0);
  }
  return k.finish(M(rng, {
    rope: matte(0xbaa478),
    wash1: matte(0xdbd6c8), wash2: matte(0xc9d8e4), wash3: matte(pick(rng, [0xd8a0a0, 0xc8d0a8, 0xe4d2a0])),
  }));
}

/**
 * A greengrocer's stall: a single-slope lean-to awning over a tilted display
 * of produce. Deliberately NOT a restyle of `market-stall` — that one is a
 * ridged twin-slope tent, this is a lean-to, so a row of both reads as a market
 * rather than as one stall copy-pasted.
 */
export function generateProduceStall(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 2.7, D = 1.6;
  const backH = 2.55, frontH = 2.05;
  const postZ = D / 2 - 0.07;
  // The slope runs between the POST TOPS, so the rise is measured over the
  // distance between them (2 * postZ), not over the stall's outside width. Get
  // that wrong and the cloth crosses the posts instead of resting on them.
  const TILT = Math.atan2(backH - frontH, postZ * 2);
  const EAVE = postZ + 0.32;   // how far the cloth oversails the front post

  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.11, backH, 0.11, sx * (W / 2 - 0.07), backH / 2, -postZ);
    k.box('woodDark', 0.11, frontH, 0.11, sx * (W / 2 - 0.07), frontH / 2, postZ);
  }
  k.box('woodDark', W + 0.1, 0.10, 0.10, 0, backH + 0.02, -postZ);
  k.box('woodDark', W + 0.1, 0.10, 0.10, 0, frontH + 0.02, postZ);

  const [c1, c2] = pick(rng, [[0xc44a3f, 0xdfd5c0], [0x4f8a58, 0xdfd5c0], [0x3f6f9c, 0xdfd5c0]]);
  // +TILT, not -TILT: a rotation of -TILT about X lifts the cloth's +Z end, so
  // the awning sloped UP towards the customer and left the front post dangling
  // half a metre under it.
  const ridgeY = (backH + frontH) / 2 + 0.07;
  stripedCloth(k, {
    w: W + 0.5, thru: (EAVE + postZ + 0.10) / Math.cos(TILT), t: 0.06,
    x: 0, y: ridgeY - (EAVE - postZ - 0.10) / 2 * Math.tan(TILT),
    z: (EAVE - postZ - 0.10) / 2, tilt: TILT, stripes: 9,
  });
  // Valance, hung at the eave and overlapping the cloth's underside.
  const eaveY = ridgeY - EAVE * Math.tan(TILT);
  stripedCloth(k, {
    w: W + 0.5, thru: 0.24, t: 0.05,
    x: 0, y: eaveY - 0.09, z: EAVE - 0.03, stripes: 9, vertical: true,
  });

  // Counter, and a display board tilted up towards the customer.
  k.box('wood', W, 0.09, D - 0.25, 0, 0.95, -0.03);
  k.box('woodDark', W - 0.1, 0.06, D - 0.45, 0, 0.42, -0.03);
  for (const sx of [-1, 1]) k.box('woodDark', 0.10, 0.95, 0.10, sx * (W / 2 - 0.12), 0.475, -0.03);
  k.box('wood', W - 0.16, 0.06, 0.62, 0, 1.16, 0.42, [-0.5, 0, 0]);
  k.box('woodDark', W - 0.16, 0.10, 0.07, 0, 1.02, 0.68);

  // Produce: three colours of piled fruit in shallow trays.
  for (let tray = 0; tray < 3; tray++) {
    const tx = -W / 2 + 0.52 + tray * (W - 1.05) / 2;
    k.box('woodDark', 0.72, 0.10, 0.50, tx, 1.20, 0.36, [-0.5, 0, 0]);
    for (let i = 0; i < 9; i++) {
      k.ico(`fruit${tray + 1}`, range(rng, 0.075, 0.105),
        tx + range(rng, -0.26, 0.26), 1.30 + range(rng, 0, 0.08), 0.30 + range(rng, -0.14, 0.14));
    }
  }
  // Crates and a sack stacked at one end.
  k.box('wood', 0.56, 0.44, 0.46, -W / 2 - 0.32, 0.22, 0.1);
  k.box('woodDark', 0.60, 0.06, 0.50, -W / 2 - 0.32, 0.47, 0.1);
  k.sphere('sack', 0.28, W / 2 + 0.34, 0.26, 0.16, [1, 1.2, 0.9]);
  k.cone('sack', 0.12, 0.18, 5, W / 2 + 0.34, 0.56, 0.16);

  return k.finish(M(rng, {
    stripeA: matte(c1), stripeB: matte(c2),
    fruit1: matte(0xd8534a), fruit2: matte(0xe0a63c), fruit3: matte(0x6da350),
    sack: matte(0xc8b088),
  }));
}

/** A dovecote on a post — movement and life above head height. */
export function generateDovecote(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const H = 2.5, W = 0.86;
  k.cyl('stone', 0.28, 0.36, 0.24, 8, 0, 0.12, 0);
  k.box('woodDark', 0.16, H, 0.16, 0, H / 2 + 0.16, 0);
  for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    k.box('wood', 0.42, 0.09, 0.09, sx * 0.20, H - 0.30, sz * 0.20, [0, sx ? 0 : Math.PI / 2, 0]);
  }
  const bodyY = H + 0.16 + 0.42;
  k.box('wood', W, 0.84, W, 0, bodyY, 0);
  k.box('woodDark', W + 0.16, 0.09, W + 0.16, 0, bodyY - 0.44, 0);   // landing floor
  for (const [sx, sz, rot] of [[0, 1, 0], [0, -1, 0], [1, 0, Math.PI / 2], [-1, 0, Math.PI / 2]]) {
    for (const off of [-0.18, 0.18]) {
      const x = sx ? sx * (W / 2 + 0.01) : off, z = sz ? sz * (W / 2 + 0.01) : off;
      k.box('hole', 0.17, 0.21, 0.06, x, bodyY + 0.12, z, [0, rot, 0]);
      k.box('woodDark', 0.30, 0.05, 0.16, sx ? x + sx * 0.06 : x, bodyY - 0.06, sz ? z + sz * 0.06 : z, [0, rot, 0]);
    }
  }
  // Roof: ONE four-sided pyramid, not four tilted slabs.
  //
  // The slab version is what shipped first and it came out as a dark bowtie:
  // each panel needs a different rotation ORDER to lie on its own slope, and
  // three.js applies an Euler's X, Y and Z in one fixed order, so the two
  // panels that needed a yaw-then-tilt got the tilt resolved in the wrong
  // frame. A cone with 4 radial segments is the same shape with none of that.
  k.box('roofDark', W + 0.46, 0.09, W + 0.46, 0, bodyY + 0.46, 0);   // eaves board
  k.cone('roof', (W + 0.46) * 0.72, 0.62, 4, 0, bodyY + 0.80, 0, [0, Math.PI / 4, 0]);
  k.cyl('roofDark', 0.10, 0.14, 0.14, 6, 0, bodyY + 1.14, 0);
  k.cone('roof', 0.13, 0.22, 6, 0, bodyY + 1.30, 0);
  // Two doves: one on the landing, one on the roof.
  for (const [dx, dy, dz, s] of [[0.30, bodyY - 0.30, 0.34, 1], [-0.30, bodyY + 0.62, -0.30, 0.9]]) {
    k.sphere('dove', 0.11 * s, dx, dy + 0.11 * s, dz, [1.4, 1, 1]);
    k.sphere('dove', 0.07 * s, dx + 0.13 * s, dy + 0.19 * s, dz, [1, 1, 1]);
    k.cone('dove', 0.055 * s, 0.16 * s, 4, dx - 0.16 * s, dy + 0.11 * s, dz, [0, 0, Math.PI / 2]);
  }
  return k.finish(M(rng, {
    roof: matte(pick(rng, [0x8c4433, 0x5b6b7a, 0xa8543f])),
    roofDark: matte(0x71372a),
    hole: matte(0x241c14),
    dove: matte(0xe8e6e0),
  }));
}

// =============================================================================
// Stone & structure
// =============================================================================

/**
 * The shared rubble wall run behind both stone-fence variants.
 *
 * The blocks are deliberately spaced — that is what makes it read as coursed
 * rubble rather than one extruded slab — but spacing alone left the wall SEE
 * THROUGH: every 3 cm joint and every 2 cm course line was a hole straight to
 * the skybox. So the run is backed by a solid mortar core, the same
 * backing-slab trick the cave kit uses. The core is thinner than the blocks
 * (T - 0.10 against T), so each block still stands proud on both faces and no
 * two opaque faces end up coplanar.
 */
function rubbleRun(k, rng, { length, cx, H, T }) {
  // Inset 2.5 cm at each end as well as through the thickness, so the core's
  // end faces don't land in the capping course's plane on the pierless run.
  k.box('stoneDark', length - 0.05, H, T - 0.10, cx, H / 2, 0);          // mortar core
  const courses = 4;
  for (let c = 0; c < courses; c++) {
    const ch = H / courses;
    const n = 5 - (c % 2);
    for (let i = 0; i < n; i++) {
      const bw = length / n;
      const x = cx - length / 2 + bw * (i + 0.5);
      k.box(c % 2 ? 'stone' : 'stoneLight', bw - 0.03, ch - 0.02, T + range(rng, -0.04, 0.04),
        x, ch * (c + 0.5), range(rng, -0.02, 0.02));
    }
  }
}

/** "STONE FENCE": a rubble wall run with a squared pier at one end. */
export function generateStoneFence(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.6, H = 0.92, T = 0.36;
  rubbleRun(k, rng, { length: L - 0.55, cx: -0.16, H, T });
  k.box('stoneDark', L - 0.5, 0.10, T + 0.13, -0.16, H + 0.03, 0);       // capping course
  // Pier at the +X end, standing proud of the wall in both directions.
  const px = L / 2 - 0.24;
  k.box('stone', 0.48, H + 0.34, T + 0.26, px, (H + 0.34) / 2, 0);
  k.box('stoneDark', 0.60, 0.12, T + 0.38, px, H + 0.40, 0);
  k.cone('stoneLight', 0.24, 0.22, 4, px, H + 0.57, 0);
  return k.finish(M(rng));
}

/**
 * The same wall with no pier — the piece you run BETWEEN two piers, so a long
 * boundary isn't a pier every 2.6 m. The run fills the full length instead of
 * stopping short, and it is centred, so a row of these butts up end to end.
 */
export function generateStoneFenceWall(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.6, H = 0.92, T = 0.36;
  rubbleRun(k, rng, { length: L, cx: 0, H, T });
  k.box('stoneDark', L, 0.10, T + 0.13, 0, H + 0.03, 0);                 // capping course
  return k.finish(M(rng));
}

/**
 * A low stone footbridge on piers.
 *
 * It declares a WALKABLE deck rather than a collider (src/sim/propTypes.js) —
 * a collider would block the one thing a bridge is for. The deck top sits at
 * exactly PLATFORM_STEP_UP (0.5 m), so a player walks straight on without
 * needing a separate ramp piece the way the pier does.
 *
 * DELIBERATELY NOT ARCHED, though the reference sheet's is. An arch only reads
 * if its crown clears the deck soffit, and this deck's soffit is 10 cm off the
 * ground: any arch that fits under it springs more than a metre below grade and
 * shows a 10 cm sliver above it — i.e. nothing. Raising the deck to where an
 * arch works puts it out of step-up range and turns one prop into three (span +
 * two ramps). Piers show what an arch would have shown — that the deck is
 * carried, not laid on the dirt — and they read from the side over a cut.
 * `buried` is set because they run below y=0.
 */
export function generateStoneBridge(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.4;      // across the crossing (X)
  const LEN = 5.4;    // along it (Z)
  const DECK = 0.5;

  // Piers, stepped, running below grade so the deck reads as carried.
  for (const sz of [-1, 1]) {
    for (const zo of [0.30, 0.86]) {
      k.box('stone', W - 0.30, 1.5, 0.62, 0, -0.55, sz * (LEN * zo * 0.5));
      // W - 0.20, so the cap's ends clear the deck slab's own W - 0.06 faces.
      k.box('stoneDark', W - 0.20, 0.20, 0.80, 0, 0.12, sz * (LEN * zo * 0.5));
    }
  }
  // Cutwaters: a wedge on the upstream face of the outer piers.
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      k.box('stone', 0.44, 1.2, 0.44, sx * (W / 2 - 0.30), -0.42, sz * (LEN * 0.43), [0, Math.PI / 4, 0]);
    }
  }
  k.box('stone', W - 0.06, 0.32, LEN, 0, 0.26, 0);                       // deck slab
  k.box('stoneLight', W, 0.12, LEN + 0.10, 0, 0.44, 0);                  // wearing course, top at 0.50
  // Parapets with a pier at each corner.
  for (const sx of [-1, 1]) {
    k.box('stone', 0.26, 0.52, LEN - 0.95, sx * (W / 2 - 0.13), DECK + 0.26, 0);
    k.box('stoneDark', 0.36, 0.10, LEN - 0.95, sx * (W / 2 - 0.13), DECK + 0.56, 0);
    for (const sz of [-1, 1]) {
      k.box('stone', 0.40, 0.80, 0.40, sx * (W / 2 - 0.13), DECK + 0.40, sz * (LEN / 2 - 0.24));
      k.cone('stoneLight', 0.23, 0.26, 4, sx * (W / 2 - 0.13), DECK + 0.90, sz * (LEN / 2 - 0.24));
    }
  }
  return k.finish(M(rng));
}

/**
 * The footbridge's APPROACH RAMP — the piece that lets you walk up onto the
 * deck instead of stepping over its 0.5 m lip.
 *
 * The deck sits at exactly PLATFORM_STEP_UP, which on paper means you can walk
 * straight on. In practice that is a knife edge: the deck's height is sampled
 * from the terrain under the BRIDGE and your step-up allowance from the
 * terrain under YOU, and a bridge is placed over a dip, so those two samples
 * are never the same number. Whether the deck was steppable came down to which
 * side of the tie the difference landed on, which is why it read as "no
 * collision, you run straight through it". src/sim/platforms.js now allows a
 * tolerance for that sampling gap, and this piece removes the question
 * entirely — butt one against each end and the crossing is a continuous
 * walkable surface from bank to bank.
 *
 * Rises along local +Z (the convention src/sim/platforms.js's ramp platform
 * uses), so the HIGH end is the +Z end: point it at the bridge. `W` and the
 * parapet section deliberately match generateStoneBridge's, since the two are
 * meant to butt together and read as one structure.
 */
export function generateStoneBridgeRamp(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 3.4;      // matches generateStoneBridge
  const LEN = 2.6;    // along the climb (Z)
  const TOP = 0.5;    // matches the bridge deck's finished height

  // The ramp itself: stepped courses rather than one sloped slab. meshKit has
  // no wedge primitive, and a rotated box would leave a wedge of air under its
  // low end and bury its high end in the deck; five steps read as masonry and
  // land exactly on 0 and TOP at the two ends.
  const STEPS = 5;
  const rise = TOP / STEPS;
  const run = LEN / STEPS;
  for (let i = 0; i < STEPS; i++) {
    const z = -LEN / 2 + run * (i + 0.5);
    const top = rise * (i + 1);
    // Each course is a full-height block from below grade up to its own top,
    // so no two courses share a horizontal face and the stack is solid from
    // any angle (a bridge abutment is not hollow).
    k.box('stone', W - 0.06, top + 0.9, run, 0, top / 2 - 0.45, z);
    // Nosing: a lighter lip standing proud of the course's +Z face, which is
    // what makes the steps read from the side instead of as a smooth wedge.
    // Sits ON TOP of the tread (bottom flush with it) rather than embedded
    // flush with its top — embedded put the nosing's top face exactly on the
    // tread's own top face, two opaque coplanar surfaces the depth buffer
    // can't order, which flickered hard (check:zfight).
    k.box('stoneLight', W, 0.03, run + 0.06, 0, top + 0.015, z);
  }
  // Battered abutment cheeks down both sides, running below grade — the ramp
  // is carried by the bank the same way the bridge is carried by its piers.
  for (const sx of [-1, 1]) {
    k.box('stoneDark', 0.28, 1.6, LEN + 0.10, sx * (W / 2 + 0.06), -0.62, 0);
  }
  // Parapets, climbing with the steps so the rail follows the walking surface
  // rather than floating level above a slope. Same section as the bridge's.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < STEPS; i++) {
      const z = -LEN / 2 + run * (i + 0.5);
      const top = rise * (i + 1);
      k.box('stone', 0.26, 0.52, run - 0.02, sx * (W / 2 - 0.13), top + 0.26, z);
      k.box('stoneDark', 0.36, 0.10, run - 0.02, sx * (W / 2 - 0.13), top + 0.56, z);
    }
    // A newel at the LOW end only: the high end butts into the bridge's own
    // corner pier, and two piers in one place would z-fight.
    k.box('stone', 0.40, 0.86, 0.40, sx * (W / 2 - 0.13), 0.30, -LEN / 2 + 0.20);
    k.cone('stoneLight', 0.23, 0.26, 4, sx * (W / 2 - 0.13), 0.86, -LEN / 2 + 0.20);
  }
  return k.finish(M(rng));
}

/** A roadside shrine: stepped base, a niche, a cross and a votive lantern. */
export function generateWayshrine(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  k.box('stone', 1.15, 0.18, 1.15, 0, 0.09, 0);
  k.box('stoneDark', 0.95, 0.17, 0.95, 0, 0.265, 0);
  k.box('stone', 0.72, 1.55, 0.72, 0, 1.12, 0);
  // Corner colonnettes, standing PROUD of the shaft's 0.36 half-width rather
  // than tucked flush into its corner where they would share both faces.
  for (const sx of [-1, 1]) k.box('stoneLight', 0.13, 1.40, 0.13, sx * 0.335, 1.10, 0.335);
  // Niche: a dark recess standing proud, with a small figure inside it.
  k.box('niche', 0.40, 0.62, 0.06, 0, 1.28, 0.37);
  k.cyl('niche', 0.20, 0.20, 0.06, 8, 0, 1.59, 0.37, [Math.PI / 2, 0, 0], Math.PI, Math.PI / 2);
  k.torus('stoneLight', 0.26, 0.07, 0, 1.59, 0.41, null, Math.PI);
  for (const sx of [-1, 1]) k.box('stoneLight', 0.09, 0.66, 0.09, sx * 0.245, 1.26, 0.41);
  k.cyl('stoneLight', 0.07, 0.11, 0.36, 6, 0, 1.20, 0.40);
  k.sphere('stoneLight', 0.075, 0, 1.42, 0.40);
  // Cornice, then a cross.
  k.box('stoneDark', 0.88, 0.15, 0.88, 0, 1.97, 0);
  k.box('stone', 0.74, 0.10, 0.74, 0, 2.08, 0);
  k.box('stoneLight', 0.17, 0.86, 0.17, 0, 2.52, 0);
  k.box('stoneLight', 0.62, 0.16, 0.16, 0, 2.66, 0);
  // Lantern and a few offerings on the step.
  k.box('iron', 0.05, 0.44, 0.05, 0.44, 0.57, 0.40);
  k.cyl('lampGlass', 0.09, 0.11, 0.20, 4, 0.44, 0.89, 0.40, [0, Math.PI / 4, 0]);
  k.cone('iron', 0.11, 0.10, 4, 0.44, 1.03, 0.40);
  for (let i = 0; i < 5; i++) {
    k.ico('bloom1', range(rng, 0.05, 0.08), range(rng, -0.34, 0.34), 0.40, range(rng, 0.42, 0.55));
  }
  return k.finish(M(rng, {
    niche: matte(0x2a2620),
    bloom1: matte(pick(rng, PETALS)),
    lampGlass: new THREE.MeshStandardMaterial({
      color: 0xffe9b0, emissive: 0xffcf70, emissiveIntensity: 0.8,
      transparent: true, opacity: 0.75, roughness: 0.25,
    }),
  }));
}

/** A small cluster of headstones, from the churchyard reference. */
export function generateGravestones(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  // A slightly raised plot of turf, so the stones aren't stuck into the road.
  k.box('turf', 2.3, 0.10, 1.7, 0, 0.05, 0);
  // One of each shape, in a seeded ORDER — picking each independently rolled
  // the same shape three times often enough that the plot read as a row of
  // clones rather than as a churchyard.
  const shapes = ['round', 'cross', 'slab'];
  const start = rangeInt(rng, 0, 2);
  const spots = [[-0.68, -0.28], [0.06, 0.24], [0.74, -0.34]];
  spots.forEach(([x, z], i) => {
    const kind = shapes[(i + start) % 3];
    const lean = range(rng, -0.10, 0.10);
    const rot = [0, range(rng, -0.4, 0.4), lean];
    k.box('stoneDark', 0.60, 0.11, 0.34, x, 0.13, z, [0, rot[1], 0]);   // footing
    if (kind === 'round') {
      k.box('stone', 0.46, 0.72, 0.13, x, 0.52, z, rot);
      k.cyl('stone', 0.23, 0.23, 0.13, 10, x - Math.sin(lean) * 0.86, 0.87, z, [Math.PI / 2, rot[1], 0], Math.PI, Math.PI / 2);
      k.box('stoneDark', 0.24, 0.24, 0.05, x, 0.60, z + 0.09, rot);
    } else if (kind === 'cross') {
      k.box('stone', 0.23, 1.02, 0.20, x, 0.67, z, rot);
      k.box('stone', 0.64, 0.23, 0.20, x - Math.sin(lean) * 0.82, 0.99, z, rot);
      k.sphere('stoneLight', 0.09, x - Math.sin(lean) * 0.82, 0.99, z + 0.13);
    } else {
      k.box('stone', 0.54, 0.60, 0.14, x, 0.46, z, rot);
      k.box('stoneLight', 0.60, 0.10, 0.20, x - Math.sin(lean) * 0.60, 0.79, z, rot);
      k.box('stoneDark', 0.30, 0.22, 0.05, x, 0.52, z + 0.10, rot);
    }
  });
  for (let i = 0; i < 6; i++) {
    k.ico('leaf', range(rng, 0.07, 0.12), range(rng, -1.0, 1.0), 0.11, range(rng, -0.7, 0.7), [1.3, 0.55, 1.3]);
  }
  return k.finish(M(rng, { turf: matte(0x5c7f42) }));
}

// =============================================================================
// Light defenses (the "WALLS & DEFENSES" row's small pieces)
// =============================================================================

/** "BARRICADE": crossed timbers with sharpened tips, lashed to two rails. */
export function generateBarricade(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.2;
  for (const sx of [-1, 1]) {
    // Two X-frames, each a pair of crossed stakes.
    for (const s of [-1, 1]) {
      const lean = s * 0.62;
      k.cyl('wood', 0.075, 0.095, 2.0, 6, sx * (L / 2 - 0.28), 0.82, s * 0.10, [0, 0, lean]);
      k.cone('wood', 0.085, 0.30, 5,
        sx * (L / 2 - 0.28) - Math.sin(lean) * 1.0, 0.82 + Math.cos(lean) * 1.0, s * 0.10, [0, 0, lean]);
    }
  }
  for (const [y, tilt] of [[0.55, 0.05], [1.18, -0.04]]) {
    k.cyl('woodDark', 0.075, 0.075, L + 0.5, 6, 0, y, 0.02, [0, 0, Math.PI / 2 + tilt]);
  }
  // A third rail across the diagonal, and rope lashings at the crossings.
  k.cyl('woodDark', 0.06, 0.06, L + 0.2, 6, 0, 0.90, -0.14, [0.1, 0, Math.PI / 2 - 0.22]);
  for (const sx of [-1, 1]) {
    for (const y of [0.55, 1.18]) {
      k.cyl('rope', 0.10, 0.10, 0.13, 6, sx * (L / 2 - 0.28), y, 0, [0, 0, Math.PI / 2]);
    }
  }
  return k.finish(M(rng, { rope: matte(0x8a7247) }));
}

/** "SPIKES": a row of angled stakes on a ground beam. */
export function generateSpikes(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const L = 2.4;
  k.box('woodDark', L, 0.20, 0.34, 0, 0.10, 0);
  k.box('woodDark', 0.26, 0.16, 0.90, -L / 2 + 0.30, 0.08, 0);
  k.box('woodDark', 0.26, 0.16, 0.90, L / 2 - 0.30, 0.08, 0);
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (L / n) * (i + 0.5);
    // ~26-33° off vertical. The first pass leaned 36-45° and the row read as a
    // stack of logs lying on the ground rather than as stakes set to stop a
    // charge.
    const lean = range(rng, 0.45, 0.58);
    const len = range(rng, 1.35, 1.65);
    const hy = 0.16 + Math.cos(lean) * len / 2;
    const hz = Math.sin(lean) * len / 2;
    k.cyl('wood', 0.065, 0.085, len, 6, x, hy, hz, [lean, 0, 0]);
    k.cone('wood', 0.075, 0.26, 5, x, 0.16 + Math.cos(lean) * (len + 0.13), Math.sin(lean) * (len + 0.13), [lean, 0, 0]);
  }
  k.cyl('rope', 0.045, 0.045, L - 0.2, 5, 0, 0.62, 0.42, [0, 0, Math.PI / 2]);
  return k.finish(M(rng, { rope: matte(0x8a7247) }));
}

/** A sentry box: somewhere for the gate guard to stand out of the rain. */
export function generateGuardPost(seed) {
  const rng = createRng(seed);
  const k = makeKit();
  const W = 1.35, D = 1.15, H = 2.25;
  k.box('stone', W + 0.34, 0.16, D + 0.34, 0, 0.08, 0);
  for (const sx of [-1, 1]) {
    k.box('woodDark', 0.13, H, 0.13, sx * (W / 2 - 0.07), H / 2 + 0.16, -D / 2 + 0.07);
    k.box('woodDark', 0.13, H, 0.13, sx * (W / 2 - 0.07), H / 2 + 0.16, D / 2 - 0.07);
  }
  // Back and two half-height sides; the front is open.
  for (let i = 0; i < 5; i++) k.box('wood', W - 0.14, 0.34, 0.08, 0, 0.35 + i * 0.36, -D / 2 + 0.05);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 3; i++) k.box('wood', 0.08, 0.34, D - 0.20, sx * (W / 2 - 0.05), 0.35 + i * 0.36, 0);
  }
  // Pitched roof with a small overhang.
  for (const sz of [-1, 1]) {
    k.box('roof', W + 0.55, 0.10, D * 0.78, 0, H + 0.42, sz * (D * 0.29), [sz * 0.62, 0, 0]);
  }
  k.box('roofDark', W + 0.62, 0.11, 0.14, 0, H + 0.63, 0);
  for (const sz of [-1, 1]) k.box('woodDark', W + 0.5, 0.09, 0.09, 0, H + 0.20, sz * (D / 2 + 0.14));
  // A spear stood in the corner and a shield hung on the back wall.
  k.cyl('woodDark', 0.035, 0.045, 2.1, 5, W / 2 - 0.26, 1.10, -D / 2 + 0.28, [0.06, 0, -0.06]);
  k.cone('iron', 0.055, 0.30, 4, W / 2 - 0.32, 2.28, -D / 2 + 0.30);
  k.box('herald', 0.44, 0.52, 0.08, -0.14, 1.42, -D / 2 + 0.14);
  k.box('herald', 0.32, 0.32, 0.08, -0.14, 1.11, -D / 2 + 0.14, [0, 0, Math.PI / 4]);
  k.sphere('iron', 0.075, -0.14, 1.44, -D / 2 + 0.20, [1, 1, 0.6]);
  // A brazier by the door.
  k.cyl('iron', 0.16, 0.11, 0.44, 8, W / 2 + 0.34, 0.30, D / 2 - 0.10);
  k.cyl('iron', 0.24, 0.17, 0.22, 8, W / 2 + 0.34, 0.62, D / 2 - 0.10);
  k.ico('coals', 0.17, W / 2 + 0.34, 0.70, D / 2 - 0.10, [1, 0.5, 1]);
  return k.finish(M(rng, {
    roof: matte(0x8c4433), roofDark: matte(0x71372a),
    herald: matte(pick(rng, [0x3f5f9c, 0x8c3f3f, 0x3f7a52])),
    coals: new THREE.MeshStandardMaterial({
      color: 0xff8c3a, emissive: 0xff6a1a, emissiveIntensity: 1.1, roughness: 0.6,
    }),
  }));
}
