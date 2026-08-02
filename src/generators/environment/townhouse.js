// src/generators/environment/townhouse.js
// Half-timbered townhouses, rebuilt from Mondstadt-style references: a stone
// or plaster ground floor, jettied (overhanging) upper storeys framed in dark
// timber, a steep terracotta gable roof with deep eaves, dormers, shuttered
// windows and a chimney.
//
// WHY THIS REPLACES generateBuildingShell FOR THE CITY: that builder is one box
// plus one flat roof slab — no windows, no framing, no eaves — which is why a
// street of them read as tin shacks. Everything here is still primitives; the
// look comes from *quantity and placement* of small dark beams on light panels,
// which is exactly what half-timbering is.
//
// PERFORMANCE — the reason for the "kit" below. A detailed house is 60-90
// boxes, and 60 houses at 90 meshes each would be 5,400 draw calls, which is
// hopeless on mobile. Every piece is therefore accumulated as geometry in a
// per-material bucket and merged ONCE, so a finished house is ~5 meshes
// regardless of how much detail it carries. Detail became free; only triangles
// cost anything.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, rangeInt, pick, chance } from '../seededRandom.js';

// --- Palette. Light, chalky plaster against near-black timber is what makes
// half-timbering read at distance; low-contrast versions turn to mush.
//
// BUT NOT NEAR-WHITE. These started at 0xf2-0xf7, whose brightest channel is
// ~0.96. The composer's bloom threshold is 0.85 (see postProcessing.js), so a
// sunlit plaster panel crossed it everywhere and the whole facade bloomed into
// a white blob — which is what "why is bloom so shiny" turned out to be. Every
// value here is now capped around 0.88 so plaster stays bright without
// tripping the threshold. Anything added later must respect the same ceiling. ---
const PLASTER = [0xe0d6c2, 0xdbd0b9, 0xe2dac6, 0xd8ceb8, 0xdfd2bb];
const PLASTER_UPPER = [0xe4dcc9, 0xe0d6c2, 0xded4bd];
const TIMBER = [0x4a3527, 0x543c2b, 0x412e22];
const ROOF = [0xc05f3c, 0xb45538, 0xc96a44, 0xa94e34, 0xbe6440];
const STONE = [0xb9b0a2, 0xc2b9aa, 0xaea596];
const SHUTTER = [0x4f7f78, 0x3f6f9c, 0x5c7f4f, 0x8c5340, 0x6a5a8c];
const GLASS = 0x37474f;
const DOOR = [0x6b4630, 0x5a3a28, 0x74513a];

/**
 * Accumulates geometry into per-material buckets, then merges each bucket into
 * a single mesh. Keys are material names, not colours, so one house is a fixed
 * handful of draw calls.
 */
function makeKit() {
  const buckets = new Map();
  const v = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const m4 = new THREE.Matrix4();

  const push = (key, geo, x, y, z, rot) => {
    e.set(rot?.[0] || 0, rot?.[1] || 0, rot?.[2] || 0);
    q.setFromEuler(e);
    v.set(x, y, z);
    m4.compose(v, q, one);
    geo.applyMatrix4(m4);
    // NORMALISE INDEXING BEFORE MERGING. BoxGeometry/CylinderGeometry are
    // indexed; ExtrudeGeometry (the gable triangles) is not. mergeGeometries
    // refuses a mixed batch and returns null — which silently dropped every
    // gable end and dormer cheek while the house still "built fine".
    if (geo.index) geo = geo.toNonIndexed();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(geo);
  };

  return {
    box: (key, w, h, d, x, y, z, rot) => push(key, new THREE.BoxGeometry(w, h, d), x, y, z, rot),
    cyl: (key, rt, rb, h, seg, x, y, z, rot) =>
      push(key, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rot),
    raw: (key, geo, x, y, z, rot) => push(key, geo, x, y, z, rot),
    finish(materials) {
      const g = new THREE.Group();
      for (const [key, list] of buckets) {
        if (!list.length) continue;
        const merged = mergeGeometries(list, false);
        // Never skip silently: a null here means a whole material's worth of
        // the building vanishes while everything still "works".
        if (!merged) throw new Error(`townhouse: mergeGeometries failed for material "${key}" (${list.length} parts)`);
        // Same fatal-on-missing rule as meshKit.js — see the note there.
        if (!materials[key]) {
          throw new Error(`townhouse: no material for key "${key}" (${list.length} parts)`);
        }
        const mesh = new THREE.Mesh(merged, materials[key]);
        // Tagged so scripts/check-embedded.mjs can find the front door and
        // assert nothing has been parked in front of it.
        mesh.userData.shellKey = key;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        g.add(mesh);
      }
      return g;
    },
  };
}

const matte = (color, flat = true) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, flatShading: flat });

/**
 * The wall that fills the end of a gable roof, extruded to a thickness.
 *
 * It is a PENTAGON, not a triangle: the roof overhangs the wall below it, so
 * at the wall's own edge the roof line is already `eaveH` off the wall top.
 * A plain triangle that runs to zero at that edge sits *below* the slope and
 * leaves an open sliver into the attic along the whole verge; a triangle wide
 * enough to reach the slope instead sticks out past the wall as a fin.
 */
export function gableGeo(halfWidth, eaveH, apexH, thickness) {
  const s = new THREE.Shape();
  s.moveTo(-halfWidth, 0);
  s.lineTo(halfWidth, 0);
  s.lineTo(halfWidth, eaveH);
  s.lineTo(0, apexH);
  s.lineTo(-halfWidth, eaveH);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: thickness, bevelEnabled: false });
  g.translate(0, 0, -thickness / 2);
  return g;
}

// Depth of each decoration layer measured OUTWARD from the wall surface, as
// the coordinate of its outer face. These are deliberately all different.
//
// THE BUG THIS FIXES: a shutter's outer face used to land at wall+0.12 and the
// door's outer face at wall+0.12 too. Where a ground-floor window sat close
// enough to the door for its shutter to reach across, the two faces were
// exactly coplanar and both opaque, which z-fights and flickers hard in game.
// Keep every value here at least ~0.02 apart, and never let two of them meet.
const D_GLASS = -0.02;   // recessed into the opening
const D_MULLION = 0.075;
const D_SHUTTER = 0.115;
const D_FRAME = 0.15;
const D_DOOR = 0.19;
const D_BOX = 0.34;

/**
 * A shuttered window: recessed dark glass, a light surround, a mullion cross
 * and a pair of coloured shutters.
 *
 * `wallZ` is the WALL SURFACE and `dir` is +1 or -1 for which way is outward.
 * The old version took a pre-offset face and assumed +Z, so every window on the
 * back of a house was built inside-out — glass poking out, shutters buried in
 * the wall, and the surround sitting 1cm off the wall plane (another z-fight).
 */
export function addWindowOn(kit, axis, u, y, wallC, dir, w = 0.95, h = 1.25, shutters = true, box = false) {
  const t = 0.06;
  const at = (d) => wallC + dir * d;
  // One placement helper in wall-local terms — `lu` along the wall, `ly` up,
  // `ld` out from it — so the ±Z and ±X faces cannot drift apart.
  const put = (key, lw, lh, lt, lu, ly, ld) => {
    if (axis === 'x') kit.box(key, lt, lh, lw, at(ld), ly, lu);
    else kit.box(key, lw, lh, lt, lu, ly, at(ld));
  };
  put('glass', w, h, 0.08, u, y, D_GLASS);
  // Surround: four bars, thickness centred so the outer face lands on D_FRAME.
  const fT = 0.14;
  const fd = D_FRAME - fT / 2;
  put('timber', w + 0.22, t * 2, fT, u, y + h / 2 + t, fd);
  put('timber', w + 0.22, t * 2, fT, u, y - h / 2 - t, fd);
  put('timber', t * 2, h + 0.24, fT, u - w / 2 - t, y, fd);
  put('timber', t * 2, h + 0.24, fT, u + w / 2 + t, y, fd);
  // Mullions.
  const mT = 0.1;
  put('timber', 0.05, h, mT, u, y, D_MULLION - mT / 2);
  put('timber', w, 0.05, mT, u, y, D_MULLION - mT / 2);
  if (shutters) {
    const sT = 0.06;
    for (const s of [-1, 1]) {
      put('shutter', w * 0.46, h * 0.98, sT,
        u + s * (w / 2 + w * 0.25 + 0.06), y, D_SHUTTER - sT / 2);
    }
  }
  if (box) {
    put('timber', w + 0.18, 0.16, 0.22, u, y - h / 2 - 0.16, D_BOX - 0.11);
    put('foliage', w, 0.16, 0.18, u, y - h / 2 - 0.06, D_BOX - 0.09);
  }
}

/** The same window on a ±Z wall, which is what most callers want. */
export function addWindow(kit, x, y, wallZ, dir, w, h, shutters, box) {
  addWindowOn(kit, 'z', x, y, wallZ, dir, w, h, shutters, box);
}

/**
 * Window centres as FRACTIONS of a wall's half-extent, so one layout serves
 * every storey of a house even as the upper floors jetty outward.
 */
function bayFractions(count) {
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * 2) / count - 1);
}

/**
 * One gabled dormer standing on a roof slope.
 *
 * `baseY`/`baseZ` is the point on the slope it stands on and `slopeK` the main
 * roof's rise per unit of run. EVERY dimension is derived from `slopeK`,
 * because a dormer sits on a rising surface: the roof climbs past the dormer
 * as you go up it, and any piece that stops short of that crossing leaves an
 * open wedge — the black gaps that showed behind every dormer in the town.
 *
 * The dormer's own gable faces FRONT, so its two roof slabs pitch left/right
 * (rotation about Z) and run front-to-back. They used to pitch front/back,
 * which left the pediment standing in front of a roof aimed the wrong way.
 */
export function addDormer(kit, x, baseY, baseZ, slopeK, width, winW, winH, wallKey) {
  // A dormer only fits if the main roof climbs past its ridge before reaching
  // the house's own ridge. On a small or shallow-pitched house it doesn't, so
  // the dormer is SCALED DOWN to fit rather than clipped — a clipped one is
  // exactly the open-backed dormer this rewrite exists to get rid of.
  const fixed = 0.42;                                   // sill + head clearance
  const grows = winH + width * 0.44;                    // the part that can shrink
  const headroom = (baseZ - 0.45) * slopeK - fixed;
  const f = Math.max(0.55, Math.min(1, headroom / grows));
  width *= f; winW *= f; winH *= f;

  const half = width / 2;
  const eaveY = baseY + 0.12 + winH + 0.3; // top of the cheeks
  const rise = width * 0.44;               // gable height above the eaves
  const ridgeY = eaveY + rise;
  const zFront = baseZ + 0.5;
  // Far enough back that the main slope has climbed past the dormer's ridge.
  const zBack = baseZ - (ridgeY - baseY) / slopeK - 0.35;
  const midZ = (zFront + zBack) / 2;
  const bodyD = zFront - zBack;
  const bottomY = baseY - 0.7; // starts under the roof surface, never level with it

  kit.box(wallKey, width, eaveY - bottomY, bodyD, x, (eaveY + bottomY) / 2, midZ);
  addWindow(kit, x, baseY + 0.12 + winH / 2, zFront, 1, winW, winH, false, false);

  const overhang = half + 0.16;
  const a = Math.atan2(overhang, rise);
  const slabLen = Math.hypot(overhang, rise);
  for (const sx of [-1, 1]) {
    kit.box('roof', slabLen, 0.14, bodyD + 0.2, x + (sx * overhang) / 2, eaveY + rise / 2, midZ,
      [0, 0, -sx * (Math.PI / 2 - a)]);
  }
  kit.raw(wallKey, gableGeo(half, rise * (1 - half / overhang), rise - 0.04, 0.16),
    x, eaveY, zFront - 0.02);
}

/** Evenly spread dormer centres across a slope, symmetric about the ridge. */
function dormerXs(count, span) {
  if (count <= 0) return [];
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) => -span / 2 + (span * i) / (count - 1));
}

/** How far a window's shutters reach sideways from its centre. */
const shutterReach = (w = 0.95) => w / 2 + w * 0.25 + 0.06 + (w * 0.46) / 2;

/** Half-timber framing over one wall face: posts, rails and diagonal braces. */
function addFraming(kit, halfW, y0, storeyH, faceZ, rng, braces = true) {
  const t = 0.13;
  const w = halfW * 2;
  // Top and bottom rails.
  kit.box('timber', w, 0.20, t, 0, y0 + 0.10, faceZ);
  kit.box('timber', w, 0.22, t, 0, y0 + storeyH - 0.11, faceZ);
  // Corner posts, pulled 3cm in from the wall's own side plane. Flush would
  // put the post's outer face exactly on the wall face — coplanar, opaque,
  // and flickering along every corner of every house.
  kit.box('timber', 0.22, storeyH, t, -halfW + 0.14, y0 + storeyH / 2, faceZ);
  kit.box('timber', 0.22, storeyH, t, halfW - 0.14, y0 + storeyH / 2, faceZ);
  // Studs roughly every 1.25m.
  const bays = Math.max(2, Math.round(w / 1.25));
  for (let i = 1; i < bays; i++) {
    const x = -halfW + (w * i) / bays;
    kit.box('timber', 0.15, storeyH - 0.3, t, x, y0 + storeyH / 2, faceZ);
  }
  // Diagonal braces in a couple of bays — the signature of the style.
  if (braces) {
    const bayW = w / bays;
    for (let i = 0; i < bays; i++) {
      if (!chance(rng, 0.42)) continue;
      const cx = -halfW + bayW * (i + 0.5);
      const dir = chance(rng, 0.5) ? 1 : -1;
      const len = Math.hypot(bayW, storeyH - 0.4);
      kit.box('timber', 0.13, len, t, cx, y0 + storeyH / 2, faceZ,
        [0, 0, dir * Math.atan2(bayW, storeyH - 0.4)]);
    }
  }
}

/**
 * The core parametric house. Every preset below is a call to this.
 *
 * Front is +Z. Origin is the ground-floor centre, standing on y=0.
 */
export function buildTownhouse(seed, opts = {}) {
  const rng = createRng(seed);
  const kit = makeKit();

  const width = opts.width ?? range(rng, 6.5, 9.5);
  const depth = opts.depth ?? range(rng, 5.5, 8);
  const storeys = opts.storeys ?? rangeInt(rng, 2, 3);
  const storeyH = opts.storeyH ?? range(rng, 2.7, 3.1);
  const jetty = opts.jetty ?? range(rng, 0.22, 0.42);
  const stoneBase = opts.stoneBase ?? chance(rng, 0.55);
  const roofPitch = opts.roofPitch ?? range(rng, 0.95, 1.25); // height per half-depth
  const eave = opts.eave ?? range(rng, 0.45, 0.7);

  const plasterCol = opts.plaster ?? pick(rng, PLASTER);
  const roofCol = opts.roof ?? pick(rng, ROOF);
  const shutterCol = opts.shutter ?? pick(rng, SHUTTER);

  // Faces to leave blank, e.g. ['+x'] where another wing abuts. A window on a
  // buried wall pokes its shutters out through the neighbouring building.
  const skip = new Set(opts.skipFaces ?? []);

  let y = 0;
  let halfW = width / 2;
  let halfD = depth / 2;

  // Window layout, decided ONCE for the whole house — see the comment at the
  // window loop for why it can't be per-storey.
  const colFracs = bayFractions(Math.max(2, Math.round(width / 2.6)));
  const rowFracs = bayFractions(Math.max(1, Math.round(depth / 2.9)));

  for (let s = 0; s < storeys; s++) {
    const isGround = s === 0;
    // Upper storeys jetty out over the one below.
    if (s > 0) { halfW += jetty; halfD += jetty * 0.8; }

    const useStone = isGround && stoneBase;
    kit.box(useStone ? 'stone' : (s === 0 ? 'plaster' : 'plasterUp'),
      halfW * 2, storeyH, halfD * 2, 0, y + storeyH / 2, 0);

    if (s > 0) {
      // Jetty underside + support brackets, so the overhang reads as carpentry
      // rather than a floating box.
      kit.box('timber', halfW * 2 + 0.08, 0.18, halfD * 2 + 0.08, 0, y + 0.09, 0);
      const n = Math.max(2, Math.round(halfW));
      for (let i = 0; i < n; i++) {
        const bx = -halfW + 0.5 + ((halfW * 2 - 1) * i) / Math.max(1, n - 1);
        for (const sz of [-1, 1]) {
          kit.box('timber', 0.16, 0.5, 0.5, bx, y - 0.16, sz * (halfD - 0.2), [sz * 0.7, 0, 0]);
        }
      }
    }

    // Framing on all four faces (skip the stone ground floor — stone isn't framed).
    if (!useStone) {
      addFraming(kit, halfW, y, storeyH, halfD + 0.005, rng);
      addFraming(kit, halfW, y, storeyH, -halfD - 0.005, rng);

      // Side faces: reuse the same routine rotated, by swapping which half-extent
      // it spans and pushing it out along X.
      addFramingSide(kit, halfD, y, storeyH, halfW + 0.005, rng);
      addFramingSide(kit, halfD, y, storeyH, -halfW - 0.005, rng);

    } else {
      // Stone base gets quoins and a plinth instead.
      kit.box('stoneDark', halfW * 2 + 0.16, 0.3, halfD * 2 + 0.16, 0, 0.15, 0);
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          kit.box('stoneDark', 0.42, 0.34, 0.42,
            sx * (halfW - 0.15), 0.5 + i * 0.72, halfD - 0.15);
          kit.box('stoneDark', 0.42, 0.34, 0.42,
            sx * (halfW - 0.15), 0.5 + i * 0.72, -halfD + 0.15);
        }
      }
    }

    // --- Windows. Ground floor gets the door instead of a centre window. ---
    //
    // Columns come from the FRACTIONS worked out above, not from this storey's
    // own half-width. Recomputing them per storey meant both the count and the
    // spacing changed as the upper floors jettied out, so no two floors of a
    // house lined up; the back wall's windows were then placed on a coin flip,
    // leaving random blank panels, and the two side walls got none at all.
    const winY = y + storeyH * 0.55;
    const flowerBoxes = !isGround && chance(rng, 0.5); // per storey, not per window
    for (const f of colFracs) {
      const wx = f * halfW;
      // A ground-floor window near the door gets no shutters: they would
      // reach across the doorway and sit in the same plane as the door.
      const doorHalf = 0.95;
      const canShutter = !isGround || Math.abs(wx) - shutterReach(0.95) > doorHalf;
      if (!(isGround && Math.abs(wx) < 1.2) && !skip.has('+z')) {
        addWindow(kit, wx, winY, halfD, 1, 0.95, 1.25, canShutter, flowerBoxes);
      }
      if (!skip.has('-z')) addWindow(kit, wx, winY, -halfD, -1, 0.95, 1.25, canShutter, false);
    }
    for (const f of rowFracs) {
      for (const sx of [-1, 1]) {
        if (skip.has(sx > 0 ? '+x' : '-x')) continue;
        addWindowOn(kit, 'x', f * halfD, winY, sx * halfW, sx, 0.95, 1.25, true, false);
      }
    }

    y += storeyH;
  }

  const wallTop = y;
  const roofH = halfD * roofPitch;

  // --- Roof: two slopes meeting at a ridge that runs along X. ---
  const slopeD = halfD + eave;
  const slopeLen = Math.hypot(slopeD, roofH);
  const angle = Math.atan2(slopeD, roofH);
  for (const sz of [-1, 1]) {
    kit.box('roof', halfW * 2 + eave * 2, 0.22, slopeLen,
      0, wallTop + roofH / 2, sz * slopeD / 2,
      [sz * (Math.PI / 2 - angle), 0, 0]);
  }
  kit.box('roofDark', halfW * 2 + eave * 2 + 0.2, 0.26, 0.34, 0, wallTop + roofH + 0.02, 0);
  // Gable ends fill the space under the slopes.
  //
  // THE BUG THIS FIXES: the gable was sized by the building's half-WIDTH, but
  // a gable spans its DEPTH — so every building wider than it is deep (the
  // store, the tavern, the wide house, the guild hall worst of all) grew a
  // pair of pale fins standing metres out past its own roof.
  const roofYAt = (z) => roofH * (1 - Math.abs(z) / slopeD) - 0.05;
  for (const sx of [-1, 1]) {
    kit.raw('plasterUp', gableGeo(halfD, roofYAt(halfD), roofYAt(0), 0.3),
      sx * halfW, wallTop, 0, [0, Math.PI / 2, 0]);
    // A collar beam and king post across the gable, proud of its face — at the
    // old offset both sat inside the gable's own thickness, i.e. invisible.
    kit.box('timber', 0.16, 0.16, slopeD, sx * (halfW + 0.22), wallTop + roofH * 0.42, 0);
    kit.box('timber', 0.16, roofH * 0.85, 0.16, sx * (halfW + 0.22), wallTop + roofH * 0.42, 0);
    // Barge boards along the gable edge.
    for (const sz of [-1, 1]) {
      kit.box('timber', 0.14, 0.28, slopeLen,
        sx * (halfW + eave * 0.55), wallTop + roofH / 2, sz * slopeD / 2,
        [sz * (Math.PI / 2 - angle), 0, 0]);
    }
  }

  // --- Dormers on the front slope. ---
  // The old x formula was -halfW*0.5 + halfW*i, which is only inside the roof
  // for one or two dormers; the Inn's third landed at 1.5x half-width — the
  // window seen floating in mid-air beside the building.
  const dormers = opts.dormers ?? (halfW > 4 ? rangeInt(rng, 1, 2) : rangeInt(rng, 0, 1));
  const slopeK = roofH / slopeD;
  const t = 0.34; // how far up the slope the dormers stand
  for (const dx of dormerXs(dormers, halfW * 1.15)) {
    addDormer(kit, dx, wallTop + roofH * t, slopeD * (1 - t), slopeK, 1.4, 0.7, 0.85, 'plasterUp');
  }

  // --- Chimney. ---
  if (opts.chimney ?? chance(rng, 0.8)) {
    const cx = (chance(rng, 0.5) ? 1 : -1) * halfW * range(rng, 0.45, 0.75);
    kit.box('stoneDark', 0.62, roofH + 1.3, 0.62, cx, wallTop + (roofH + 1.3) / 2 - 0.2, range(rng, -0.4, 0.4));
    kit.box('stoneDark', 0.82, 0.2, 0.82, cx, wallTop + roofH + 1.05, 0);
  }

  // --- Front door, centred, with a step and a small hood. ---
  const doorH = 2.15;
  const gz = depth / 2;
  const dT = 0.14;
  kit.box('door', 1.35, doorH, dT, 0, doorH / 2, gz + D_DOOR - dT / 2);
  // Surround sits proud of the door leaf, not level with it.
  const sT = 0.2;
  const sz = gz + D_DOOR + 0.05 - sT / 2;
  kit.box('timber', 1.6, 0.2, sT, 0, doorH + 0.1, sz);
  kit.box('timber', 0.18, doorH + 0.2, sT, -0.79, (doorH + 0.2) / 2, sz);
  kit.box('timber', 0.18, doorH + 0.2, sT, 0.79, (doorH + 0.2) / 2, sz);
  kit.box('stone', 1.8, 0.14, 0.6, 0, 0.07, gz + 0.28);
  if (opts.doorHood ?? chance(rng, 0.5)) {
    kit.box('roofDark', 2.0, 0.14, 0.8, 0, doorH + 0.42, gz + 0.34, [0.42, 0, 0]);
  }

  const materials = {
    plaster: matte(plasterCol),
    plasterUp: matte(opts.plasterUpper ?? pick(rng, PLASTER_UPPER)),
    timber: matte(pick(rng, TIMBER)),
    roof: matte(roofCol),
    roofDark: matte(new THREE.Color(roofCol).multiplyScalar(0.78).getHex()),
    // `opts.stone` lets a caller pick the ground floor's stone rather than
    // taking the town's warm default — the blacksmith needs the cool grey
    // block its reference has, which against cream plaster is what reads as
    // "stone base" instead of "the wall carried on down".
    stone: matte(opts.stone ?? pick(rng, STONE)),
    stoneDark: matte(new THREE.Color(pick(rng, STONE)).multiplyScalar(0.86).getHex()),
    glass: new THREE.MeshStandardMaterial({ color: GLASS, roughness: 0.25, metalness: 0 }),
    shutter: matte(shutterCol),
    door: matte(pick(rng, DOOR)),
    foliage: matte(0x5f8f45),
  };
  return kit.finish(materials);
}

/** Framing for the ±X faces (spans depth, offset along X). */
function addFramingSide(kit, halfD, y0, storeyH, faceX, rng) {
  const t = 0.13;
  const d = halfD * 2;
  kit.box('timber', t, 0.20, d, faceX, y0 + 0.10, 0);
  kit.box('timber', t, 0.22, d, faceX, y0 + storeyH - 0.11, 0);
  kit.box('timber', t, storeyH, 0.22, faceX, y0 + storeyH / 2, -halfD + 0.14);
  kit.box('timber', t, storeyH, 0.22, faceX, y0 + storeyH / 2, halfD - 0.14);
  const bays = Math.max(2, Math.round(d / 1.25));
  for (let i = 1; i < bays; i++) {
    const z = -halfD + (d * i) / bays;
    kit.box('timber', t, storeyH - 0.3, 0.15, faceX, y0 + storeyH / 2, z);
  }
  const bayD = d / bays;
  for (let i = 0; i < bays; i++) {
    if (!chance(rng, 0.38)) continue;
    const cz = -halfD + bayD * (i + 0.5);
    const dir = chance(rng, 0.5) ? 1 : -1;
    const len = Math.hypot(bayD, storeyH - 0.4);
    kit.box('timber', t, len, 0.13, faceX, y0 + storeyH / 2, cz,
      [dir * Math.atan2(bayD, storeyH - 0.4), 0, 0]);
  }
}

// =============================================================================
// Presets. Eight reusable houses plus the civic/commercial variety buildings.
// Each still varies by seed (palette, framing pattern, dormers), so placing the
// same preset 20 times does not give 20 identical houses.
// =============================================================================
const house = (o) => (seed) => buildTownhouse(seed, o);

export const generateHouseNarrow = house({ width: 6.2, depth: 6.0, storeys: 3, jetty: 0.34, stoneBase: false });
export const generateHouseWide = house({ width: 10.5, depth: 7.5, storeys: 2, jetty: 0.3, stoneBase: true });
export const generateHouseTall = house({ width: 7.4, depth: 6.8, storeys: 3, jetty: 0.4, stoneBase: true, roofPitch: 1.3 });
export const generateHouseSmall = house({ width: 6.0, depth: 5.4, storeys: 2, jetty: 0.26, stoneBase: false, dormers: 1 });
export const generateHouseCorner = house({ width: 8.8, depth: 8.6, storeys: 3, jetty: 0.28, stoneBase: true });
export const generateHouseSteep = house({ width: 7.0, depth: 6.2, storeys: 2, jetty: 0.36, roofPitch: 1.45, stoneBase: false, dormers: 2 });
export const generateHouseSquat = house({ width: 9.2, depth: 8.0, storeys: 2, jetty: 0.22, stoneBase: true, roofPitch: 0.9 });
export const generateHouseGabled = house({ width: 7.8, depth: 7.0, storeys: 3, jetty: 0.32, stoneBase: false, roofPitch: 1.2, dormers: 2 });

/** Tavern — wide, warm, with a big hanging sign bracket and a door hood. */
export const generateTavern = house({
  width: 11.5, depth: 9.0, storeys: 2, jetty: 0.34, stoneBase: true,
  roofPitch: 1.05, plaster: 0xecdcc0, roof: 0xa94e34, shutter: 0x8c5340, doorHood: true, dormers: 2,
});
/** Inn — the tallest residential block, three storeys and many dormers. */
export const generateInn = house({
  width: 12.0, depth: 9.5, storeys: 3, jetty: 0.3, stoneBase: true,
  roofPitch: 1.15, plaster: 0xe0d6c2, roof: 0xb45538, dormers: 3, doorHood: true,
});
/** General store — wide shopfront, shallow roof, bright shutters. */
export const generateStore = house({
  width: 10.0, depth: 7.0, storeys: 2, jetty: 0.28, stoneBase: false,
  roofPitch: 0.95, shutter: 0x3f6f9c, doorHood: true, dormers: 1,
});
/** Craft workshop — stone ground floor, squat and sturdy. */
export const generateWorkshop = house({
  width: 9.5, depth: 8.5, storeys: 2, jetty: 0.2, stoneBase: true,
  roofPitch: 0.88, shutter: 0x5c7f4f, plaster: 0xd8ceb8, dormers: 0,
});

/**
 * The Adventurers Guild — the third reference image. A broad stone hall with a
 * steep roof, a projecting gabled entrance bay with a rose window and a hung
 * banner, dormers either side, and chimneys.
 */
export function generateGuildHall(seed) {
  const rng = createRng(seed);
  const kit = makeKit();

  const W = 22;
  const D = 13;
  const wallH = 6.2;
  const halfW = W / 2;
  const halfD = D / 2;
  const roofH = halfD * 1.35;

  // Main hall: stone below, plaster above a string course.
  kit.box('stone', W, wallH * 0.55, D, 0, wallH * 0.275, 0);
  kit.box('plaster', W - 0.1, wallH * 0.45, D - 0.1, 0, wallH * 0.55 + wallH * 0.225, 0);
  kit.box('stoneDark', W + 0.3, 0.28, D + 0.3, 0, wallH * 0.55, 0);
  kit.box('stoneDark', W + 0.4, 0.4, D + 0.4, 0, 0.2, 0);

  // Quoins up both front corners.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      kit.box('stoneDark', 0.5, 0.42, 0.5, sx * (halfW - 0.2), 0.45 + i * 0.72, halfD - 0.2);
    }
  }

  // Windows along the front and back.
  for (let i = 0; i < 6; i++) {
    const wx = -halfW + (W * (i + 0.5)) / 6;
    if (Math.abs(wx) < 3.2) continue;
    addWindow(kit, wx, 2.2, halfD, 1, 1.1, 2.0, false, false);
    addWindow(kit, wx, 2.2, -halfD, -1, 1.1, 2.0, false, false);
  }

  // Roof.
  const slopeD = halfD + 0.7;
  const slopeLen = Math.hypot(slopeD, roofH);
  const angle = Math.atan2(slopeD, roofH);
  for (const sz of [-1, 1]) {
    kit.box('roof', W + 1.4, 0.26, slopeLen, 0, wallH + roofH / 2, sz * slopeD / 2,
      [sz * (Math.PI / 2 - angle), 0, 0]);
  }
  kit.box('roofDark', W + 1.6, 0.3, 0.4, 0, wallH + roofH + 0.03, 0);
  const roofYAt = (z) => roofH * (1 - Math.abs(z) / slopeD) - 0.05;
  for (const sx of [-1, 1]) {
    // Spans the hall's DEPTH, not its width — this hall is 22 wide and 13
    // deep, so the old width-sized gable overhung its own roof by nearly 4m.
    kit.raw('plaster', gableGeo(halfD, roofYAt(halfD), roofYAt(0), 0.35),
      sx * halfW, wallH, 0, [0, Math.PI / 2, 0]);
    kit.box('stoneDark', 0.7, roofH + 2.2, 0.7, sx * (halfW - 1.6), wallH + (roofH + 2.2) / 2 - 0.3, 0);
    kit.box('stoneDark', 0.92, 0.24, 0.92, sx * (halfW - 1.6), wallH + roofH + 1.85, 0);
  }

  // Projecting entrance bay with its own steep gable.
  const bayW = 6.4;
  const bayD = 2.4;
  const bayH = 7.6;
  const bayRoofH = 3.4;
  kit.box('stone', bayW, bayH, bayD * 2, 0, bayH / 2, halfD);
  kit.box('stoneDark', bayW + 0.3, 0.3, bayD * 2 + 0.3, 0, 0.15, halfD);
  const bSlope = Math.hypot(bayW / 2 + 0.4, bayRoofH);
  const bAngle = Math.atan2(bayW / 2 + 0.4, bayRoofH);
  for (const sx of [-1, 1]) {
    // SIGN: rotating about Z sends local +X to (cos, sin), so the right-hand
    // slab needs a NEGATIVE angle to drop away to the right. The positive one
    // used here pitched both slabs upward and outward — the entrance roof was
    // a V with the sky showing through the middle of it.
    kit.box('roof', bSlope, 0.22, bayD * 2 + 1.0, sx * (bayW / 4 + 0.2), bayH + bayRoofH / 2, halfD,
      [0, 0, -sx * (Math.PI / 2 - bAngle)]);
  }
  kit.raw('plaster',
    gableGeo(bayW / 2, bayRoofH * (1 - (bayW / 2) / (bayW / 2 + 0.4)), bayRoofH - 0.05, 0.3),
    0, bayH, halfD + bayD);
  // Rose window in the gable.
  kit.cyl('glass', 1.0, 1.0, 0.16, 16, 0, bayH + 1.25, halfD + bayD + 0.06, [Math.PI / 2, 0, 0]);
  kit.cyl('stoneDark', 1.22, 1.22, 0.12, 16, 0, bayH + 1.25, halfD + bayD + 0.02, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI;
    kit.box('stoneDark', 0.1, 2.0, 0.14, 0, bayH + 1.25, halfD + bayD + 0.1, [0, 0, a]);
  }
  // Guild banner hung under the rose window.
  kit.box('banner', 2.2, 2.6, 0.1, 0, bayH - 1.6, halfD + bayD + 0.1);
  kit.box('timber', 2.5, 0.16, 0.2, 0, bayH - 0.24, halfD + bayD + 0.12);
  kit.cyl('bannerEmblem', 0.62, 0.62, 0.05, 12, 0, bayH - 1.5, halfD + bayD + 0.17, [Math.PI / 2, 0, 0]);

  // Double doors under the bay.
  kit.box('door', 3.0, 3.4, 0.18, 0, 1.7, halfD + bayD + 0.02);
  kit.box('timber', 0.14, 3.4, 0.22, 0, 1.7, halfD + bayD + 0.1);
  kit.box('timber', 3.4, 0.24, 0.26, 0, 3.5, halfD + bayD + 0.06);
  kit.box('stone', 4.2, 0.16, 1.2, 0, 0.08, halfD + bayD + 0.6);
  kit.box('stone', 4.8, 0.16, 1.4, 0, -0.02, halfD + bayD + 1.1);

  // Dormers flanking the entrance bay.
  const slopeK = roofH / slopeD;
  const dt = 0.34;
  for (const sx of [-1, 1]) {
    for (const off of [4.6, 8.0]) {
      addDormer(kit, sx * off, wallH + roofH * dt, slopeD * (1 - dt), slopeK,
        1.6, 0.8, 0.95, 'plaster');
    }
  }

  const materials = {
    plaster: matte(0xdfd5c0),
    plasterUp: matte(0xf4ecda),
    timber: matte(0x4a3527),
    roof: matte(0xbe5f3d),
    roofDark: matte(0x93472e),
    stone: matte(0xd8cdb6),
    stoneDark: matte(0xbfb49c),
    glass: new THREE.MeshStandardMaterial({ color: 0x4a6a86, roughness: 0.25 }),
    shutter: matte(0x4f7f78),
    door: matte(0x6b4630),
    foliage: matte(0x5f8f45),
    banner: matte(0x2f5f8c),
    bannerEmblem: matte(0xe0c25a),
  };
  void rng;
  return kit.finish(materials);
}
