// src/generators/monsterPresets.js
// Built-in Monster Builder content — NOT user-authored/saved, shipped as
// static data so building a recognizable monster takes clicks instead of
// hand-placing every primitive. Three things live here:
//   - PART_PRESETS: shape compositions per body-part category, clicked to
//     replace the active slot's shapes wholesale.
//   - BODY_PRESETS: complete starter creatures, clicked to replace an
//     entire monster type's slots + stance + idle/walk/attack clips.
//   - the clip helpers those bodies animate themselves with, exported so the
//     Monster Builder can re-derive a default gait for a hand-built body.
//
// Every shape uses the same descriptor shape as a hand-authored one
// (src/sim/creatureTypeDefs.js's ShapeDef) — buildShapeMesh
// (src/generators/custom.js) renders these with zero special-casing.
//
// SCALE. The root is at the feet and y=0 is the ground, matching
// characterPresets.js's HUMANOID_ANCHORS (a player tops out near 1.75). A
// goblin is deliberately short (~1.2), a skeleton is player-height, a brute
// and a wraith are taller. Sizes below are real world units, not vibes: the
// helpers convert them into the unit-primitive scales buildShapeMesh wants.
//
// WHY THE HELPERS. The previous version of this file laid every limb out as a
// single capsule with hand-guessed Euler angles, which is why the wolf read as
// a brick on four sticks. Limbs here are CHAINS — hip ball, thigh, knee ball,
// shin, foot — laid end to end by `chainLimb`, which computes each segment's
// position and rotation from a direction vector. A jointed silhouette is the
// single biggest readability win available at this primitive count, and it is
// only affordable if the maths is written once.

/** Which PART_PRESETS category a given slot role's presets come from — arm/leg presets are generic per limb type, applied to whichever specific slot is active. */
export function presetCategoryForRole(role) {
  if (role === 'armL' || role === 'armR') return 'arm';
  if (role.startsWith('leg')) return 'leg';
  return role; // head, torso, tail
}

// ============================ AUTHORING HELPERS ============================

const R2D = 180 / Math.PI;

/** shape: id, kind, position [x,y,z], scale [x,y,z], color, optional rotation [x,y,z] (deg). */
function sh(id, kind, p, s, color, r) {
  const o = { id, kind, position: { x: p[0], y: p[1], z: p[2] }, scale: { x: s[0], y: s[1], z: s[2] }, color };
  if (r) o.rotation = { x: r[0], y: r[1], z: r[2] };
  return o;
}
/** slot: role, anchor [x,y,z], shapes[]. */
function slot(role, a, shapes) {
  return { role, anchor: { x: a[0], y: a[1], z: a[2] }, shapes };
}
/** A sphere given as a real-world DIAMETER (sphere scale is diameter, 1:1). */
function ball(id, p, dia, color, sy = 1, sz = 1) {
  return sh(id, 'sphere', p, [dia, dia * sy, dia * sz], color);
}

const norm = (d) => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};

/**
 * The Euler angles (degrees) that aim a primitive's local +Y axis along `dir`.
 *
 * three.js's default 'XYZ' Euler maps local +Y to
 *   (-sin z, cos x cos z, sin x cos z)   when rotation.y is 0,
 * so the two angles fall straight out of the direction vector and there is no
 * third degree of freedom to guess at (spin about the bone's own axis is
 * irrelevant for a capsule).
 */
function aimY(dir) {
  const [dx, dy, dz] = norm(dir);
  const rz = -Math.asin(Math.max(-1, Math.min(1, dx))) * R2D;
  const rx = Math.atan2(dz, dy) * R2D;
  return [+rx.toFixed(2), 0, +rz.toFixed(2)];
}

const CAPSULE_GIRTH = 0.7; // CapsuleGeometry(0.35, 0.3): unit width is 0.7, unit height 1.0

/**
 * One bone: a capsule of real-world diameter `dia` laid from `from` along
 * `dir` for `len`. Returns the shape plus the far end, so the next bone can
 * start exactly where this one stopped.
 */
function bone(id, from, dir, len, dia, color) {
  const d = norm(dir);
  const mid = [from[0] + d[0] * len * 0.5, from[1] + d[1] * len * 0.5, from[2] + d[2] * len * 0.5];
  const end = [from[0] + d[0] * len, from[1] + d[1] * len, from[2] + d[2] * len];
  return { shape: sh(id, 'capsule', mid, [dia / CAPSULE_GIRTH, len, dia / CAPSULE_GIRTH], color, aimY(d)), end };
}

/** A tapering spike (cone, apex at the far end) laid the same way as `bone`. */
function spike(id, from, dir, len, dia, color) {
  const d = norm(dir);
  const mid = [from[0] + d[0] * len * 0.5, from[1] + d[1] * len * 0.5, from[2] + d[2] * len * 0.5];
  const end = [from[0] + d[0] * len, from[1] + d[1] * len, from[2] + d[2] * len];
  return { shape: sh(id, 'cone', mid, [dia, len, dia], color, aimY(d)), end };
}

/**
 * A jointed limb: a ball at the slot pivot, then bone/joint-ball/bone down the
 * chain. Because consecutive bones share an endpoint and every joint ball
 * straddles it, the whole limb is structurally one connected solid — which is
 * what `npm run check:prefabs` verifies, and what a hand-placed capsule stack
 * only ever got right by luck.
 * @param {string} prefix unique per slot, so shape ids stay unique
 * @param {Array<{dir:number[], len:number, dia:number, color?:number, kind?:'bone'|'spike'}>} segs
 * @returns {{shapes: object[], end: number[]}}
 */
function chainLimb(prefix, segs, { color, jointColor, hipDia, jointScale = 1.2 } = {}) {
  const shapes = [];
  let p = [0, 0, 0];
  const jc = jointColor ?? color;
  if (hipDia !== 0) shapes.push(ball(`${prefix}j0`, p, hipDia ?? segs[0].dia * 1.5, jc));
  segs.forEach((seg, i) => {
    const make = seg.kind === 'spike' ? spike : bone;
    const b = make(`${prefix}b${i}`, p, seg.dir, seg.len, seg.dia, seg.color ?? color);
    shapes.push(b.shape);
    p = b.end;
    if (i < segs.length - 1) shapes.push(ball(`${prefix}j${i + 1}`, p, Math.max(seg.dia, segs[i + 1].dia) * jointScale, jc));
  });
  return { shapes, end: p };
}

/** A foot/paw slab sitting at a chain's end point. */
function footAt(id, end, [w, h, d], color, forward = 0.04) {
  return sh(id, 'box', [end[0], end[1] - h * 0.3, end[2] + forward], [w, h, d], color);
}

/** Mirror a right-side limb onto the left, so one authored limb serves both sides and can never end up inside the torso on one side only. */
function mirrorX(shapes) {
  return shapes.map((s) => ({
    ...s,
    id: s.id,
    position: { ...s.position, x: -s.position.x },
    ...(s.rotation ? { rotation: { ...s.rotation, y: -s.rotation.y, z: -s.rotation.z } } : {}),
  }));
}

/** A point on (or just inside) a sphere of radius R in direction `dir`. frac<1 sinks it into the surface so it overlaps. */
function surf(R, dir, frac = 0.92) {
  const d = norm(dir);
  return [d[0] * R * frac, d[1] * R * frac, d[2] * R * frac];
}

/**
 * A point on (or just inside) an ELLIPSOID — which is what every `ball()` with
 * a non-1 sy/sz actually is. `surf` above only handles true spheres, and
 * eyeballing a detail onto a squashed body is precisely the mistake
 * `check:prefabs` keeps catching: the offset that looks right for the radius is
 * outside the solid on the flattened axis.
 * @param {number[]} centre
 * @param {number[]} semi half-extents [x,y,z]
 * @param {number[]} dir direction from the centre
 * @param {number} frac <1 sinks the point inside so the detail interpenetrates
 */
function onEllipsoid(centre, semi, dir, frac = 0.85) {
  const d = norm(dir);
  return [centre[0] + d[0] * semi[0] * frac, centre[1] + d[1] * semi[1] * frac, centre[2] + d[2] * semi[2] * frac];
}

/** Mirrored details placed on an ellipsoid — the `eyesOn` of squashed bodies. */
function pairOnEllipsoid(prefix, centre, semi, dir, make, frac = 0.85) {
  return [-1, 1].map((sx) => make(
    `${prefix}${sx < 0 ? 'L' : 'R'}`,
    onEllipsoid(centre, semi, [sx * dir[0], dir[1], dir[2]], frac)
  ));
}

/**
 * Mirrored eyes on a spherical head of radius R centred at `c`, half-sunk into
 * it. A whites+pupil pair when `white` is given — the single biggest "this is a
 * creature and not a pile of boxes" cue available.
 */
function eyesOn(R, dir, dia, color, c = [0, 0, 0], white = null, prefix = 'eye') {
  const out = [];
  for (const sx of [-1, 1]) {
    const tag = sx < 0 ? 'L' : 'R';
    const p = surf(R, [sx * dir[0], dir[1], dir[2]], white ? 0.86 : 0.94);
    const at = [c[0] + p[0], c[1] + p[1], c[2] + p[2]];
    if (white) {
      out.push(ball(`${prefix}W${tag}`, at, dia, white, 1, 0.8));
      const q = surf(R, [sx * dir[0], dir[1], dir[2]], 0.99);
      out.push(ball(`${prefix}P${tag}`, [c[0] + q[0], c[1] + q[1], c[2] + q[2]], dia * 0.5, color, 1, 0.7));
    } else {
      out.push(ball(`${prefix}${tag}`, at, dia, color, 1, 0.8));
    }
  }
  return out;
}

// ============================ PALETTE ============================
const C = {
  // slime
  slime: 0x43b2e6, slimeDk: 0x1e6d9e, slimeLt: 0xdaf2ff, slimeEye: 0x123a5c,
  // canine
  wolf: 0x74747e, wolfDk: 0x4c4c56, wolfLt: 0xa8a8b2, wolfBelly: 0xc6c6cc,
  dire: 0x3a3540, direDk: 0x221e28, direLt: 0x565060,
  // arachnid
  chitin: 0x3c3138, chitinDk: 0x241c22, chitinLt: 0x584a52,
  venom: 0x2b2230, venomMark: 0xa02a1e,
  // ursine
  bear: 0x6b4526, bearDk: 0x462b16, bearLt: 0x8f6740, bearMuzzle: 0xa88458,
  // goblin
  gob: 0x6f9a3c, gobDk: 0x4c6d26, gobLt: 0x93bb5e,
  cloth: 0x7a5a34, clothDk: 0x4a3520, leather: 0x53381f, leatherDk: 0x342111,
  iron: 0x707680, ironDk: 0x474c55, ironLt: 0x9aa0aa,
  // undead
  bone: 0xdcd5c0, boneDk: 0xaea68d, boneSh: 0x8a836c,
  rot: 0x93997e, rotDk: 0x4c4a3c, rotFlesh: 0x9c6a62, gore: 0x77241c,
  ghoul: 0xc2b8a4, ghoulDk: 0x8e8471,
  shroud: 0x424a5e, shroudDk: 0x272c38, spectral: 0x74e0d0,
  arcane: 0x8a4fd6, arcaneDk: 0x3d2358, gold: 0xd6a836,
  // shared
  white: 0xf2f2ee, black: 0x14141a, claw: 0xe6e0cf,
  eyeRed: 0xe03a2a, eyeAmber: 0xf0b03a, eyeGreen: 0x8fe04a, eyeVoid: 0x0a0a10,
};

// ============================ LIMB LIBRARY ============================
// Reused by both PART_PRESETS and BODY_PRESETS, so a part you pick from the
// grid is literally the same limb the matching prefab is built from.

/** Digitigrade (wolf/fox) leg: angled thigh, hock, pastern, paw. Front and back differ in how the hock folds. */
function digitigradeLeg({ fur, dark, paw = C.black, drop = 0.56, girth = 0.17, back = false, scale = 1 }) {
  const g = girth * scale;
  const l1 = drop * 0.46 * scale;
  const l2 = drop * 0.42 * scale;
  const l3 = drop * 0.2 * scale;
  const c = chainLimb('lg', [
    { dir: back ? [0, -0.82, -0.57] : [0, -1, -0.16], len: l1, dia: g },
    { dir: back ? [0, -0.92, 0.4] : [0, -1, 0.1], len: l2, dia: g * 0.7, color: dark },
    { dir: [0, -1, 0], len: l3, dia: g * 0.55, color: dark },
  ], { color: fur, jointColor: dark, hipDia: g * 1.7 });
  c.shapes.push(footAt('lgpaw', c.end, [g * 0.95, 0.075 * scale, g * 1.35], paw, 0.035 * scale));
  return c.shapes;
}

/** Plantigrade (bear/humanoid) leg: thigh, knee, shin, flat foot. */
function plantigradeLeg({ fur, dark = fur, foot = C.leatherDk, drop = 0.5, girth = 0.2, scale = 1, toe = 0 }) {
  const g = girth * scale;
  // Joint balls scale DOWN as the limb gets thicker: a 1.45x hip on a slender
  // goblin leg reads as a hip, but on a bear's 0.3-wide leg it reads as a
  // beach ball and the whole limb becomes a stack of spheres.
  const knuckle = g > 0.24 ? 1.06 : 1.4;
  const c = chainLimb('lg', [
    { dir: [0.04, -1, 0.05], len: drop * 0.55 * scale, dia: g },
    { dir: [-0.03, -1, -0.02], len: drop * 0.45 * scale, dia: g * (g > 0.24 ? 0.94 : 0.82), color: dark },
  ], { color: fur, jointColor: dark, hipDia: g * knuckle, jointScale: g > 0.24 ? 1.0 : 1.2 });
  c.shapes.push(footAt('lgfoot', c.end, [g * 1.1, 0.09 * scale, g * 1.7], foot, 0.05 * scale));
  if (toe) {
    for (let i = -1; i <= 1; i++) {
      c.shapes.push(spike(`lgclaw${i + 1}`, [c.end[0] + i * g * 0.34, c.end[1] - 0.03 * scale, c.end[2] + g * 1.0], [0, -0.15, 1], toe * scale, 0.045 * scale, C.claw).shape);
    }
  }
  return c.shapes;
}

/** Bony leg: thin femur/tibia with knobbly joints — the undead silhouette. */
function boneLeg({ tone = C.bone, dark = C.boneDk, drop = 0.82, girth = 0.11 }) {
  const c = chainLimb('lg', [
    { dir: [0.03, -1, 0], len: drop * 0.54, dia: girth },
    { dir: [-0.02, -1, 0.01], len: drop * 0.46, dia: girth * 0.82 },
  ], { color: tone, jointColor: dark, hipDia: girth * 1.5 });
  c.shapes.push(footAt('lgfoot', c.end, [girth * 1.25, 0.07, girth * 2.1], dark, 0.05));
  return c.shapes;
}

/** Insect/arachnid leg: femur up-and-out, tibia down-and-out, tarsus tip. `side` is -1 (left) or +1 (right); `sweep` fans the pair forward/back. */
function arachnidLeg({ side, sweep = 0, chitin = C.chitin, dark = C.chitinDk, scale = 1, girth = 0.09 }) {
  const g = girth * scale;
  const c = chainLimb('lg', [
    { dir: [side * 0.85, 0.55, sweep], len: 0.34 * scale, dia: g },
    { dir: [side * 0.55, -0.83, sweep * 0.5], len: 0.66 * scale, dia: g * 0.78, color: dark },
  ], { color: chitin, jointColor: dark, hipDia: g * 1.8 });
  c.shapes.push(spike('lgtip', c.end, [side * 0.3, -1, 0], 0.09 * scale, g * 0.72, dark).shape);
  return c.shapes;
}

/** Muscled humanoid arm ending in a clawed fist. Authored for the RIGHT side; mirrorX gives the left. */
function clawedArm({ skin, dark = skin, claw = C.claw, drop = 0.46, girth = 0.16, scale = 1, claws = 3 }) {
  const g = girth * scale;
  const c = chainLimb('ar', [
    { dir: [0.2, -1, 0], len: drop * 0.52 * scale, dia: g },
    { dir: [-0.12, -1, 0.24], len: drop * 0.48 * scale, dia: g * 0.85, color: dark },
  ], { color: skin, jointColor: dark, hipDia: g * 1.45 });
  c.shapes.push(ball('arhand', c.end, g * 1.15, dark));
  // Claw roots must sit INSIDE the fist ball (radius 0.575g), not merely near
  // it — spread them by a fraction of the fist rather than a fixed step, or the
  // outermost pair on a 4-clawed hand lands outside and reads as floating.
  for (let i = 0; i < claws; i++) {
    const off = ((i - (claws - 1) / 2) / Math.max(1, claws - 1)) * g * 0.6;
    c.shapes.push(spike(`arclaw${i}`, [c.end[0] + off, c.end[1] - g * 0.2, c.end[2] + g * 0.22], [off * 3, -0.75, 0.66], 0.13 * scale, 0.045 * scale, claw).shape);
  }
  return c.shapes;
}

/** Skeletal arm: humerus, elbow knob, forearm, splayed finger bones. */
function boneArm({ tone = C.bone, dark = C.boneDk, drop = 0.6, girth = 0.09 }) {
  const c = chainLimb('ar', [
    { dir: [0.12, -1, 0], len: drop * 0.52, dia: girth },
    { dir: [-0.08, -1, 0.2], len: drop * 0.48, dia: girth * 0.82 },
  ], { color: tone, jointColor: dark, hipDia: girth * 1.5 });
  c.shapes.push(ball('arhand', c.end, girth * 1.25, dark));
  for (let i = -1; i <= 1; i++) {
    c.shapes.push(bone(`arfinger${i + 1}`, [c.end[0] + i * girth * 0.42, c.end[1] - girth * 0.3, c.end[2] + girth * 0.2], [i * 0.35, -0.9, 0.3], 0.11, girth * 0.42, tone).shape);
  }
  return c.shapes;
}

/** A draped sleeve ending in a bony hand — robed casters and wraiths. */
function robedArm({ robe, trim = robe, hand = C.bone, drop = 0.56, girth = 0.19 }) {
  const c = chainLimb('ar', [
    { dir: [0.16, -1, 0.02], len: drop * 0.5, dia: girth },
    { dir: [-0.1, -1, 0.26], len: drop * 0.5, dia: girth * 1.15, color: trim },
  ], { color: robe, jointColor: robe, hipDia: girth * 1.5 });
  c.shapes.push(ball('arhand', [c.end[0], c.end[1] - 0.02, c.end[2] + 0.02], girth * 0.62, hand));
  for (let i = -1; i <= 1; i++) {
    c.shapes.push(bone(`arfinger${i + 1}`, [c.end[0] + i * girth * 0.2, c.end[1] - girth * 0.28, c.end[2] + girth * 0.1], [i * 0.4, -0.88, 0.28], 0.08, girth * 0.2, hand).shape);
  }
  return c.shapes;
}

// ============================ HEAD LIBRARY ============================

/** Canine head: skull box, brow, tapered snout, jaw with fangs, pricked ears. Origin is the skull centre. */
function canineHead({ fur, dark, light = fur, eye = C.eyeAmber, nose = C.black, scale = 1, ruff = false }) {
  const s = scale;
  const out = [
    sh('skull', 'box', [0, 0, 0], [0.27 * s, 0.25 * s, 0.31 * s], fur),
    sh('brow', 'box', [0, 0.1 * s, 0.05 * s], [0.29 * s, 0.1 * s, 0.18 * s], dark),
    sh('cheekL', 'box', [-0.15 * s, -0.02 * s, -0.02 * s], [0.07 * s, 0.18 * s, 0.2 * s], light),
    sh('cheekR', 'box', [0.15 * s, -0.02 * s, -0.02 * s], [0.07 * s, 0.18 * s, 0.2 * s], light),
    sh('snout', 'box', [0, -0.065 * s, 0.23 * s], [0.15 * s, 0.13 * s, 0.28 * s], fur, [-5, 0, 0]),
    sh('muzzleTop', 'box', [0, 0.005 * s, 0.2 * s], [0.13 * s, 0.08 * s, 0.22 * s], dark),
    ball('nose', [0, -0.045 * s, 0.375 * s], 0.075 * s, nose),
    sh('jaw', 'box', [0, -0.15 * s, 0.19 * s], [0.13 * s, 0.07 * s, 0.24 * s], dark),
    sh('fangL', 'cone', [-0.055 * s, -0.135 * s, 0.29 * s], [0.032 * s, 0.085 * s, 0.032 * s], C.white, [172, 0, 0]),
    sh('fangR', 'cone', [0.055 * s, -0.135 * s, 0.29 * s], [0.032 * s, 0.085 * s, 0.032 * s], C.white, [172, 0, 0]),
    sh('earL', 'pyramid', [-0.105 * s, 0.19 * s, -0.03 * s], [0.11 * s, 0.22 * s, 0.08 * s], fur, [-10, 0, 11]),
    sh('earR', 'pyramid', [0.105 * s, 0.19 * s, -0.03 * s], [0.11 * s, 0.22 * s, 0.08 * s], fur, [-10, 0, -11]),
    sh('earInL', 'pyramid', [-0.105 * s, 0.185 * s, 0.005 * s], [0.06 * s, 0.16 * s, 0.05 * s], dark, [-10, 0, 11]),
    sh('earInR', 'pyramid', [0.105 * s, 0.185 * s, 0.005 * s], [0.06 * s, 0.16 * s, 0.05 * s], dark, [-10, 0, -11]),
    ball('eyeL', [-0.105 * s, 0.04 * s, 0.14 * s], 0.055 * s, eye, 0.85, 0.6),
    ball('eyeR', [0.105 * s, 0.04 * s, 0.14 * s], 0.055 * s, eye, 0.85, 0.6),
    ball('pupilL', [-0.105 * s, 0.04 * s, 0.155 * s], 0.026 * s, C.black, 1.4, 0.5),
    ball('pupilR', [0.105 * s, 0.04 * s, 0.155 * s], 0.026 * s, C.black, 1.4, 0.5),
  ];
  if (ruff) {
    out.push(ball('ruff', [0, -0.02 * s, -0.16 * s], 0.42 * s, dark, 0.95, 0.6));
    for (let i = 0; i < 5; i++) {
      const a = (-0.6 + i * 0.3) * Math.PI;
      out.push(sh(`tuft${i}`, 'pyramid', [Math.cos(a) * 0.2 * s, Math.sin(a) * 0.2 * s, -0.17 * s], [0.09 * s, 0.16 * s, 0.07 * s], dark, [10, 0, -Math.cos(a) * 60]));
    }
  }
  return out;
}

/** Ursine head: heavy round skull, short broad muzzle, small round ears. */
function ursineHead({ fur, dark, muzzle, scale = 1, eye = C.black }) {
  const s = scale;
  return [
    ball('skull', [0, 0, 0], 0.38 * s, fur, 0.88, 0.92),
    sh('brow', 'box', [0, 0.09 * s, 0.11 * s], [0.31 * s, 0.09 * s, 0.16 * s], dark),
    sh('muzzle', 'box', [0, -0.085 * s, 0.21 * s], [0.21 * s, 0.17 * s, 0.24 * s], muzzle, [-4, 0, 0]),
    ball('nose', [0, -0.05 * s, 0.33 * s], 0.1 * s, C.black, 0.8, 0.7),
    sh('jaw', 'box', [0, -0.155 * s, 0.19 * s], [0.17 * s, 0.07 * s, 0.2 * s], dark),
    sh('fangL', 'cone', [-0.06 * s, -0.145 * s, 0.27 * s], [0.035 * s, 0.075 * s, 0.035 * s], C.white, [175, 0, 0]),
    sh('fangR', 'cone', [0.06 * s, -0.145 * s, 0.27 * s], [0.035 * s, 0.075 * s, 0.035 * s], C.white, [175, 0, 0]),
    ball('earL', surf(0.19 * s, [-1, 1.05, -0.15], 0.86), 0.15 * s, fur, 1, 0.5),
    ball('earR', surf(0.19 * s, [1, 1.05, -0.15], 0.86), 0.15 * s, fur, 1, 0.5),
    ball('earInL', surf(0.19 * s, [-1, 1.05, 0.1], 0.9), 0.09 * s, dark, 1, 0.4),
    ball('earInR', surf(0.19 * s, [1, 1.05, 0.1], 0.9), 0.09 * s, dark, 1, 0.4),
    ...eyesOn(0.19 * s, [0.62, 0.28, 1], 0.05 * s, eye),
  ];
}

/** Goblin head: sloped skull, jutting brow, hooked nose, underbite, huge swept ears. */
function goblinHead({ skin, dark, eye = C.eyeAmber, scale = 1 }) {
  const s = scale;
  return [
    ball('skull', [0, 0, 0], 0.35 * s, skin, 0.94, 0.98),
    sh('cranium', 'box', [0, 0.11 * s, -0.05 * s], [0.28 * s, 0.16 * s, 0.28 * s], skin),
    sh('brow', 'box', [0, 0.075 * s, 0.13 * s], [0.29 * s, 0.075 * s, 0.14 * s], dark),
    sh('nose', 'cone', [0, -0.03 * s, 0.16 * s], [0.1 * s, 0.22 * s, 0.1 * s], skin, [102, 0, 0]),
    sh('jaw', 'box', [0, -0.155 * s, 0.07 * s], [0.24 * s, 0.11 * s, 0.22 * s], dark),
    sh('toothL', 'cone', [-0.06 * s, -0.115 * s, 0.15 * s], [0.035 * s, 0.075 * s, 0.035 * s], C.white),
    sh('toothR', 'cone', [0.06 * s, -0.115 * s, 0.15 * s], [0.035 * s, 0.075 * s, 0.035 * s], C.white),
    sh('earL', 'pyramid', [-0.2 * s, 0.06 * s, -0.06 * s], [0.09 * s, 0.34 * s, 0.07 * s], skin, [-12, -22, 68]),
    sh('earR', 'pyramid', [0.2 * s, 0.06 * s, -0.06 * s], [0.09 * s, 0.34 * s, 0.07 * s], skin, [-12, 22, -68]),
    ball('eyeL', [-0.085 * s, 0.015 * s, 0.145 * s], 0.06 * s, C.white, 0.85, 0.6),
    ball('eyeR', [0.085 * s, 0.015 * s, 0.145 * s], 0.06 * s, C.white, 0.85, 0.6),
    ball('pupilL', [-0.09 * s, 0.015 * s, 0.165 * s], 0.032 * s, eye, 1, 0.6),
    ball('pupilR', [0.09 * s, 0.015 * s, 0.165 * s], 0.032 * s, eye, 1, 0.6),
  ];
}

/** Bare skull: cranium, hollow sockets, nasal notch, maxilla + hinged jaw. */
function skullHead({ tone = C.bone, dark = C.boneDk, socket = C.eyeVoid, glow = null, scale = 1 }) {
  const s = scale;
  const out = [
    ball('cranium', [0, 0.03 * s, -0.01 * s], 0.3 * s, tone, 1.02, 1.0),
    sh('brow', 'box', [0, 0.06 * s, 0.1 * s], [0.25 * s, 0.06 * s, 0.13 * s], tone),
    ball('sockL', [-0.075 * s, 0.005 * s, 0.115 * s], 0.095 * s, socket, 1.05, 0.55),
    ball('sockR', [0.075 * s, 0.005 * s, 0.115 * s], 0.095 * s, socket, 1.05, 0.55),
    sh('nasal', 'pyramid', [0, -0.065 * s, 0.13 * s], [0.045 * s, 0.06 * s, 0.04 * s], socket, [180, 0, 0]),
    sh('maxilla', 'box', [0, -0.115 * s, 0.075 * s], [0.19 * s, 0.06 * s, 0.19 * s], tone),
    sh('teethU', 'box', [0, -0.14 * s, 0.13 * s], [0.16 * s, 0.032 * s, 0.06 * s], C.white),
    sh('jaw', 'box', [0, -0.185 * s, 0.07 * s], [0.17 * s, 0.055 * s, 0.18 * s], dark),
    sh('teethL', 'box', [0, -0.168 * s, 0.13 * s], [0.14 * s, 0.03 * s, 0.055 * s], C.white),
    sh('cheekL', 'box', [-0.115 * s, -0.045 * s, 0.06 * s], [0.05 * s, 0.09 * s, 0.14 * s], dark),
    sh('cheekR', 'box', [0.115 * s, -0.045 * s, 0.06 * s], [0.05 * s, 0.09 * s, 0.14 * s], dark),
  ];
  if (glow) {
    out.push(ball('glowL', [-0.075 * s, 0.005 * s, 0.14 * s], 0.05 * s, glow, 1, 0.6));
    out.push(ball('glowR', [0.075 * s, 0.005 * s, 0.14 * s], 0.05 * s, glow, 1, 0.6));
  }
  return out;
}

/** Rotting head: lolling jaw, one eye gone, patchy scalp. */
function rotHead({ flesh = C.rot, dark = C.rotDk, wound = C.gore, scale = 1 }) {
  const s = scale;
  return [
    ball('skull', [0, 0, 0], 0.34 * s, flesh, 1.04, 1.0),
    sh('scalp', 'box', [0.03 * s, 0.13 * s, -0.04 * s], [0.24 * s, 0.09 * s, 0.26 * s], dark),
    sh('wound', 'box', [-0.09 * s, 0.1 * s, 0.09 * s], [0.11 * s, 0.06 * s, 0.09 * s], wound),
    sh('brow', 'box', [0, 0.06 * s, 0.12 * s], [0.26 * s, 0.055 * s, 0.11 * s], dark),
    ball('eyeL', [-0.08 * s, 0.005 * s, 0.14 * s], 0.075 * s, C.eyeVoid, 1, 0.5),
    ball('eyeR', [0.08 * s, 0.005 * s, 0.14 * s], 0.07 * s, C.white, 1, 0.6),
    ball('pupilR', [0.085 * s, 0.005 * s, 0.16 * s], 0.03 * s, C.black, 1, 0.6),
    sh('nose', 'pyramid', [0, -0.05 * s, 0.15 * s], [0.05 * s, 0.06 * s, 0.05 * s], dark, [180, 0, 0]),
    sh('jaw', 'box', [0, -0.21 * s, 0.09 * s], [0.19 * s, 0.09 * s, 0.19 * s], dark, [16, 0, 0]),
    sh('teeth', 'box', [0, -0.17 * s, 0.15 * s], [0.15 * s, 0.035 * s, 0.05 * s], C.white),
    sh('gash', 'box', [0.02 * s, -0.09 * s, 0.16 * s], [0.13 * s, 0.03 * s, 0.04 * s], wound, [0, 0, -18]),
  ];
}

/**
 * Arachnid head-region detail, authored INTO the torso slot (a spider's head
 * does not swivel). Everything here is placed against the CEPHALOTHORAX
 * ellipsoid the caller passes in, so the eye cluster lands on the actual dome
 * rather than in front of it.
 * @param {number[]} thorax centre of the cephalothorax ball
 * @param {number[]} semi its half-extents
 */
function arachnidFace({ chitin, dark, eye = C.eyeRed, scale = 1, thorax, semi }) {
  const s = scale;
  const snout = onEllipsoid(thorax, semi, [0, -0.25, 1], 0.86);
  const out = [
    ball('clypeus', snout, 0.24 * s, dark, 0.85, 0.8),
    sh('fangL', 'cone', [snout[0] - 0.06 * s, snout[1] - 0.07 * s, snout[2] + 0.03 * s], [0.055 * s, 0.17 * s, 0.055 * s], C.white, [152, 0, 8]),
    sh('fangR', 'cone', [snout[0] + 0.06 * s, snout[1] - 0.07 * s, snout[2] + 0.03 * s], [0.055 * s, 0.17 * s, 0.055 * s], C.white, [152, 0, -8]),
    bone('palpL', [snout[0] - 0.1 * s, snout[1] - 0.02 * s, snout[2]], [-0.5, -0.35, 1], 0.16 * s, 0.05 * s, chitin).shape,
    bone('palpR', [snout[0] + 0.1 * s, snout[1] - 0.02 * s, snout[2]], [0.5, -0.35, 1], 0.16 * s, 0.05 * s, chitin).shape,
  ];
  // Eight eyes: a big forward-facing pair, then three smaller pairs arcing up
  // and out across the dome — the cue that reads "spider" from any angle.
  const cluster = [
    ['eyeA', [0.42, 0.42, 1], 0.062],
    ['eyeB', [0.95, 0.3, 0.85], 0.045],
    ['eyeC', [0.22, 0.95, 0.7], 0.04],
    ['eyeD', [0.8, 0.85, 0.5], 0.036],
  ];
  for (const [prefix, dir, dia] of cluster) {
    out.push(...pairOnEllipsoid(prefix, thorax, semi, dir, (id, p) => ball(id, p, dia * s, eye, 1, 0.85), 0.92));
  }
  return out;
}

/**
 * A ribcage: spine, vertebrae, four rib hoops, sternum, clavicle, pelvis.
 *
 * The VERTEBRA and COSTAL balls are not decoration. `check:prefabs` samples a
 * shape's own vertices against its neighbours' solids, and a box's only
 * vertices are its eight corners — so a rib that genuinely passes through the
 * spine, corners outside on both sides, reads as DETACHED. A small ball at each
 * crossing has a centre sample sitting inside both boxes, which is both the
 * honest structural join and what makes the check pass.
 */
function ribcage({ tone = C.bone, dark = C.boneDk, scale = 1, ribs = 4 }) {
  const s = scale;
  const out = [
    sh('spine', 'box', [0, 0, -0.06 * s], [0.09 * s, 0.6 * s, 0.09 * s], tone),
    sh('sternum', 'box', [0, 0.055 * s, 0.11 * s], [0.08 * s, 0.44 * s, 0.06 * s], tone),
    sh('clav', 'box', [0, 0.31 * s, 0.03 * s], [0.38 * s, 0.055 * s, 0.08 * s], tone),
    ball('clavKnob', [0, 0.29 * s, 0.02 * s], 0.1 * s, dark),
    sh('neck', 'cylinder', [0, 0.37 * s, -0.01 * s], [0.09 * s, 0.14 * s, 0.09 * s], dark),
    sh('pelvis', 'box', [0, -0.3 * s, 0], [0.32 * s, 0.14 * s, 0.21 * s], tone),
    ball('sacrum', [0, -0.26 * s, -0.03 * s], 0.13 * s, dark),
    ball('hipL', [-0.14 * s, -0.32 * s, 0], 0.16 * s, dark),
    ball('hipR', [0.14 * s, -0.32 * s, 0], 0.16 * s, dark),
  ];
  for (let i = 0; i < ribs; i++) {
    const y = (0.22 - i * 0.11) * s;
    const w = (0.36 - i * 0.03) * s;
    const d = (0.25 - i * 0.02) * s;
    out.push(sh(`rib${i}`, 'box', [0, y, 0.02 * s], [w, 0.055 * s, d], i % 2 ? dark : tone));
    out.push(ball(`vert${i}`, [0, y, -0.045 * s], 0.085 * s, dark)); // rib <-> spine
    out.push(ball(`costal${i}`, [0, y, 0.105 * s], 0.07 * s, tone)); // rib <-> sternum
  }
  return out;
}

// ============================ PART PRESETS ============================
// Clicking one replaces the active slot's shapes. Each is a self-contained
// composition authored around the slot's own origin (0,0,0 = the pivot).
//
// SKIN is the colour the "Recolor Whole Part" swatch row rewrites, so a preset
// keeps its accent colours (claws, eyes, metal) when you retint the body.
const SKIN = 0xb9a888;
const SKIN_DK = 0x8e7f63;

export const PART_PRESETS = {
  head: [
    { id: 'head-round', label: 'Round', shapes: [
      ball('h1', [0, 0, 0], 0.36, SKIN),
      ...eyesOn(0.18, [0.55, 0.2, 1], 0.075, C.black, [0, 0, 0], C.white),
      sh('mouth', 'box', [0, -0.12, 0.15], [0.12, 0.028, 0.05], SKIN_DK),
    ] },
    { id: 'head-boxy', label: 'Boxy', shapes: [
      sh('h1', 'box', [0, 0, 0], [0.34, 0.32, 0.32], SKIN),
      sh('brow', 'box', [0, 0.08, 0.14], [0.36, 0.07, 0.09], SKIN_DK),
      ball('eyeL', [-0.09, 0, 0.16], 0.06, C.eyeAmber, 1, 0.5),
      ball('eyeR', [0.09, 0, 0.16], 0.06, C.eyeAmber, 1, 0.5),
      sh('jaw', 'box', [0, -0.16, 0.04], [0.28, 0.09, 0.26], SKIN_DK),
    ] },
    { id: 'head-canine', label: 'Canine', shapes: canineHead({ fur: SKIN, dark: SKIN_DK, light: SKIN }) },
    { id: 'head-canine-ruff', label: 'Ruffed Canine', shapes: canineHead({ fur: SKIN, dark: SKIN_DK, light: SKIN, ruff: true }) },
    { id: 'head-ursine', label: 'Ursine', shapes: ursineHead({ fur: SKIN, dark: SKIN_DK, muzzle: 0xa88458 }) },
    { id: 'head-goblin', label: 'Goblinoid', shapes: goblinHead({ skin: SKIN, dark: SKIN_DK }) },
    { id: 'head-skull', label: 'Skull', shapes: skullHead({}) },
    { id: 'head-skull-glow', label: 'Burning Skull', shapes: skullHead({ glow: C.eyeRed }) },
    { id: 'head-rotten', label: 'Rotten', shapes: rotHead({}) },
    { id: 'head-horned', label: 'Horned', shapes: [
      ball('h1', [0, 0, 0], 0.36, SKIN),
      sh('brow', 'box', [0, 0.07, 0.14], [0.3, 0.07, 0.11], SKIN_DK),
      spike('hornL', surf(0.18, [-0.6, 0.9, -0.25], 0.82), [-0.45, 0.82, -0.35], 0.3, 0.085, C.claw).shape,
      spike('hornR', surf(0.18, [0.6, 0.9, -0.25], 0.82), [0.45, 0.82, -0.35], 0.3, 0.085, C.claw).shape,
      ...eyesOn(0.18, [0.5, 0.15, 1], 0.06, C.eyeRed),
      sh('jaw', 'box', [0, -0.16, 0.07], [0.22, 0.09, 0.2], SKIN_DK),
    ] },
    { id: 'head-tusked', label: 'Tusked', shapes: [
      sh('h1', 'box', [0, 0, 0], [0.34, 0.3, 0.34], SKIN),
      sh('snout', 'box', [0, -0.09, 0.22], [0.2, 0.14, 0.18], SKIN_DK),
      ball('nose', [0, -0.07, 0.31], 0.08, C.black, 0.7, 0.6),
      spike('tuskL', [-0.08, -0.13, 0.24], [-0.25, 0.95, 0.18], 0.19, 0.05, C.claw).shape,
      spike('tuskR', [0.08, -0.13, 0.24], [0.25, 0.95, 0.18], 0.19, 0.05, C.claw).shape,
      ...eyesOn(0.17, [0.7, 0.35, 0.9], 0.05, C.eyeRed),
    ] },
    { id: 'head-hooded', label: 'Hooded Void', shapes: [
      sh('hood', 'cone', [0, 0.04, -0.02], [0.42, 0.44, 0.42], C.shroud, [180, 0, 0]),
      ball('void', [0, -0.03, 0.06], 0.28, C.eyeVoid, 0.9, 0.7),
      sh('cowl', 'box', [0, 0.12, 0.02], [0.3, 0.14, 0.3], C.shroudDk, [14, 0, 0]),
      ball('eyeL', [-0.07, -0.02, 0.14], 0.05, C.spectral, 1, 0.6),
      ball('eyeR', [0.07, -0.02, 0.14], 0.05, C.spectral, 1, 0.6),
    ] },
    { id: 'head-beaked', label: 'Beaked', shapes: [
      ball('h1', [0, 0, 0], 0.3, SKIN),
      spike('beak', [0, -0.02, 0.1], [0, -0.15, 1], 0.22, 0.11, 0xe0a040).shape,
      ...eyesOn(0.15, [0.7, 0.3, 0.8], 0.06, C.black, [0, 0, 0], C.white),
    ] },
  ],

  torso: [
    { id: 'torso-lean', label: 'Lean', shapes: [
      ball('chest', [0, 0.1, 0], 0.42, SKIN, 0.95, 0.78),
      ball('belly', [0, -0.14, 0.01], 0.36, SKIN, 0.95, 0.8),
      sh('neck', 'cylinder', [0, 0.26, 0.01], [0.16, 0.14, 0.16], SKIN_DK),
    ] },
    { id: 'torso-brawny', label: 'Brawny', shapes: [
      sh('chest', 'box', [0, 0.12, 0], [0.58, 0.34, 0.36], SKIN),
      ball('pecL', [-0.15, 0.08, 0.14], 0.26, SKIN, 0.8, 0.6),
      ball('pecR', [0.15, 0.08, 0.14], 0.26, SKIN, 0.8, 0.6),
      ball('gut', [0, -0.16, 0.02], 0.44, SKIN, 0.9, 0.82),
      sh('neck', 'cylinder', [0, 0.28, 0], [0.2, 0.16, 0.2], SKIN_DK),
    ] },
    { id: 'torso-ribcage', label: 'Ribcage', shapes: ribcage({}) },
    { id: 'torso-robed', label: 'Robed', shapes: [
      sh('robe', 'cone', [0, -0.1, 0], [0.62, 0.72, 0.58], C.shroud, [180, 0, 0]),
      ball('chest', [0, 0.16, 0], 0.4, C.shroud, 0.9, 0.78),
      sh('collar', 'cylinder', [0, 0.3, 0], [0.3, 0.12, 0.28], C.shroudDk),
      sh('sash', 'box', [0, -0.02, 0.02], [0.46, 0.08, 0.4], C.gold),
    ] },
    { id: 'torso-armored', label: 'Armored', shapes: [
      sh('chest', 'box', [0, 0.1, 0], [0.5, 0.4, 0.34], SKIN),
      sh('plate', 'box', [0, 0.09, 0.16], [0.42, 0.36, 0.08], C.iron),
      sh('rivet', 'box', [0, 0.09, 0.2], [0.06, 0.3, 0.03], C.ironLt),
      ball('gut', [0, -0.16, 0.02], 0.4, SKIN, 0.9, 0.8),
      sh('belt', 'box', [0, -0.24, 0], [0.48, 0.09, 0.4], C.leatherDk),
      sh('neck', 'cylinder', [0, 0.28, 0], [0.18, 0.14, 0.18], SKIN_DK),
    ] },
    { id: 'torso-carapace', label: 'Carapace', shapes: [
      ball('abdomen', [0, 0.06, -0.26], 0.54, SKIN, 0.86, 1.06),
      ball('thorax', [0, -0.02, 0.16], 0.38, SKIN_DK, 0.78, 0.96),
      ball('mark1', [0, 0.24, -0.3], 0.14, SKIN_DK, 0.5, 0.9),
      ball('mark2', [-0.13, 0.18, -0.16], 0.1, SKIN_DK, 0.5, 0.9),
      ball('mark3', [0.13, 0.18, -0.16], 0.1, SKIN_DK, 0.5, 0.9),
    ] },
    { id: 'torso-blob', label: 'Blob', shapes: [
      ball('body', [0, 0, 0], 0.92, SKIN, 0.68, 0.96),
      ball('crown', [0.05, 0.24, 0.02], 0.5, SKIN, 0.66, 0.94),
      ...eyesOn(0.4, [0.45, 0.2, 1], 0.16, C.black, [0, 0.05, 0], C.white),
      sh('mouth', 'box', [0, -0.08, 0.4], [0.15, 0.035, 0.06], C.black),
    ] },
    { id: 'torso-quad', label: 'Quadruped Barrel', shapes: [
      ball('chest', [0, 0.02, 0.26], 0.46, SKIN, 0.96, 1.1),
      sh('barrel', 'box', [0, 0, -0.06], [0.4, 0.4, 0.68], SKIN),
      ball('rump', [0, -0.01, -0.38], 0.42, SKIN, 0.96, 1.0),
      sh('belly', 'box', [0, -0.19, -0.02], [0.32, 0.1, 0.6], SKIN_DK),
      sh('neck', 'box', [0, 0.11, 0.44], [0.26, 0.26, 0.26], SKIN),
    ] },
    { id: 'torso-hunched', label: 'Hunched', shapes: [
      ball('hump', [0, 0.2, -0.08], 0.44, SKIN, 0.8, 0.8),
      sh('chest', 'box', [0, 0.04, 0.02], [0.46, 0.34, 0.32], SKIN, [12, 0, 0]),
      ball('gut', [0, -0.18, 0.04], 0.38, SKIN, 0.9, 0.86),
      sh('neck', 'cylinder', [0, 0.28, 0.11], [0.17, 0.16, 0.17], SKIN_DK, [22, 0, 0]),
    ] },
  ],

  tail: [
    { id: 'tail-brush', label: 'Brush', shapes: (() => {
      const c = chainLimb('tl', [
        { dir: [0, -0.3, -1], len: 0.24, dia: 0.16 },
        { dir: [0, -0.55, -1], len: 0.24, dia: 0.19 },
      ], { color: SKIN, jointColor: SKIN, hipDia: 0.18 });
      c.shapes.push(ball('tltip', c.end, 0.17, SKIN_DK));
      return c.shapes;
    })() },
    { id: 'tail-whip', label: 'Whip', shapes: (() => {
      const c = chainLimb('tl', [
        { dir: [0, 0.1, -1], len: 0.26, dia: 0.1 },
        { dir: [0, 0.35, -1], len: 0.26, dia: 0.06 },
      ], { color: SKIN, hipDia: 0.13 });
      c.shapes.push(spike('tltip', c.end, [0, 0.5, -1], 0.14, 0.06, SKIN_DK).shape);
      return c.shapes;
    })() },
    { id: 'tail-spade', label: 'Spade', shapes: (() => {
      const c = chainLimb('tl', [
        { dir: [0, 0.25, -1], len: 0.3, dia: 0.09 },
        { dir: [0, 0.5, -1], len: 0.26, dia: 0.06 },
      ], { color: SKIN, hipDia: 0.12 });
      c.shapes.push(sh('tlspade', 'pyramid', c.end, [0.16, 0.19, 0.05], SKIN_DK, [-118, 0, 0]));
      return c.shapes;
    })() },
    { id: 'tail-stub', label: 'Stub', shapes: [
      ball('tl1', [0, 0, -0.03], 0.16, SKIN),
      ball('tl2', [0, 0.02, -0.13], 0.12, SKIN_DK),
    ] },
    { id: 'tail-bony', label: 'Bony', shapes: (() => {
      const out = [];
      let p = [0, 0, 0];
      for (let i = 0; i < 5; i++) {
        out.push(ball(`tlv${i}`, p, 0.11 - i * 0.012, C.bone));
        p = [0, p[1] + 0.012 * i, p[2] - 0.1];
      }
      out.push(spike('tltip', p, [0, 0.4, -1], 0.12, 0.05, C.boneDk).shape);
      return out;
    })() },
    { id: 'tail-ragged', label: 'Ragged Shroud', shapes: [
      sh('rag1', 'cone', [0, -0.02, -0.16], [0.3, 0.4, 0.16], C.shroud, [-108, 0, 0]),
      sh('rag2', 'cone', [-0.08, -0.1, -0.28], [0.13, 0.3, 0.09], C.shroudDk, [-96, 0, 12]),
      sh('rag3', 'cone', [0.09, -0.12, -0.3], [0.12, 0.28, 0.08], C.shroudDk, [-92, 0, -14]),
    ] },
  ],

  arm: [
    { id: 'arm-clawed', label: 'Clawed', shapes: clawedArm({ skin: SKIN, dark: SKIN_DK }) },
    { id: 'arm-brawny', label: 'Brawny', shapes: clawedArm({ skin: SKIN, dark: SKIN_DK, girth: 0.24, drop: 0.56, claws: 4 }) },
    { id: 'arm-long', label: 'Long Reach', shapes: clawedArm({ skin: SKIN, dark: SKIN_DK, girth: 0.13, drop: 0.72 }) },
    { id: 'arm-bony', label: 'Bony', shapes: boneArm({}) },
    { id: 'arm-robed', label: 'Robed Sleeve', shapes: robedArm({ robe: C.shroud, trim: C.shroudDk }) },
    { id: 'arm-armored', label: 'Armored', shapes: (() => {
      const c = chainLimb('ar', [
        { dir: [0.18, -1, 0], len: 0.26, dia: 0.18 },
        { dir: [-0.1, -1, 0.22], len: 0.24, dia: 0.15, color: SKIN_DK },
      ], { color: SKIN, jointColor: C.iron, hipDia: 0.3 });
      c.shapes.push(ball('arpauldron', [0.02, 0.05, 0], 0.34, C.iron, 0.8, 0.9));
      c.shapes.push(sh('arbracer', 'cylinder', [c.end[0] + 0.03, c.end[1] + 0.09, c.end[2] - 0.02], [0.19, 0.16, 0.19], C.ironLt));
      c.shapes.push(sh('arfist', 'box', [c.end[0], c.end[1], c.end[2] + 0.01], [0.18, 0.17, 0.18], C.ironDk));
      return c.shapes;
    })() },
    { id: 'arm-wing', label: 'Membrane Wing', shapes: [
      ball('arj0', [0, 0, 0], 0.16, SKIN_DK),
      bone('arb0', [0, 0, 0], [1, 0.28, -0.1], 0.4, 0.08, SKIN).shape,
      sh('armembrane', 'box', [0.3, -0.06, -0.04], [0.5, 0.03, 0.4], SKIN_DK, [0, 16, 22]),
      bone('arb1', [0.36, 0.1, -0.04], [0.7, -0.5, -0.5], 0.34, 0.05, SKIN).shape,
    ] },
    { id: 'arm-stub', label: 'Stubby', shapes: (() => {
      const c = chainLimb('ar', [{ dir: [0.25, -1, 0], len: 0.26, dia: 0.17 }], { color: SKIN, hipDia: 0.24 });
      c.shapes.push(ball('arhand', c.end, 0.2, SKIN_DK));
      return c.shapes;
    })() },
    { id: 'arm-arachnid', label: 'Arachnid', shapes: arachnidLeg({ side: 1, chitin: SKIN, dark: SKIN_DK }) },
  ],

  leg: [
    { id: 'leg-plantigrade', label: 'Plantigrade', shapes: plantigradeLeg({ fur: SKIN, dark: SKIN_DK }) },
    { id: 'leg-digitigrade', label: 'Digitigrade', shapes: digitigradeLeg({ fur: SKIN, dark: SKIN_DK }) },
    { id: 'leg-digi-rear', label: 'Digitigrade (rear)', shapes: digitigradeLeg({ fur: SKIN, dark: SKIN_DK, back: true }) },
    { id: 'leg-thick', label: 'Thick Paw', shapes: plantigradeLeg({ fur: SKIN, dark: SKIN_DK, girth: 0.3, drop: 0.58, foot: SKIN_DK, toe: 0.13 }) },
    { id: 'leg-bony', label: 'Bony', shapes: boneLeg({}) },
    { id: 'leg-arachnid', label: 'Arachnid', shapes: arachnidLeg({ side: 1, chitin: SKIN, dark: SKIN_DK }) },
    { id: 'leg-hoofed', label: 'Hoofed', shapes: (() => {
      const c = chainLimb('lg', [
        { dir: [0.02, -1, -0.12], len: 0.28, dia: 0.16 },
        { dir: [0, -1, 0.06], len: 0.3, dia: 0.09, color: SKIN_DK },
      ], { color: SKIN, jointColor: SKIN_DK, hipDia: 0.26 });
      c.shapes.push(sh('lghoof', 'cylinder', [c.end[0], c.end[1] - 0.03, c.end[2]], [0.13, 0.09, 0.14], C.black));
      return c.shapes;
    })() },
    { id: 'leg-robed', label: 'Robed', shapes: [
      ball('lgj0', [0, 0, 0], 0.26, SKIN),
      sh('lgskirt', 'cone', [0, -0.24, 0], [0.34, 0.52, 0.32], SKIN, [180, 0, 0]),
      sh('lgfoot', 'box', [0, -0.48, 0.05], [0.16, 0.08, 0.24], SKIN_DK),
    ] },
    { id: 'leg-wisp', label: 'Spectral Wisp', shapes: [
      ball('lgj0', [0, 0, 0], 0.24, C.shroud),
      { ...sh('lgwisp', 'cone', [0, -0.24, -0.02], [0.28, 0.48, 0.26], C.shroudDk, [180, 0, 0]), opacity: 0.55 },
      { ...ball('lgtip', [0, -0.46, -0.04], 0.12, C.spectral), opacity: 0.4 },
    ] },
  ],
};

/**
 * A slung quiver plus the arrows in it. The arrows are seated on the quiver's
 * OWN rotated axis rather than at a guessed offset — the tube is tilted, so
 * "just above the top" in world axes lands beside it, not in it.
 * @param {number} s scale
 * @param {number[]} at quiver centre, in unscaled units
 */
function quiver(s, [ax, ay, az]) {
  const tilt = [12, 0, -20];
  const len = 0.44;
  // The local +Y of a shape rotated by `tilt` — the same mapping aimY inverts.
  const d = norm([-Math.sin(tilt[2] / R2D), Math.cos(tilt[0] / R2D) * Math.cos(tilt[2] / R2D), Math.sin(tilt[0] / R2D) * Math.cos(tilt[2] / R2D)]);
  const mouth = [ax + d[0] * len * 0.34, ay + d[1] * len * 0.34, az + d[2] * len * 0.34];
  const out = [sh('quiver', 'cylinder', [ax * s, ay * s, az * s], [0.17 * s, len * s, 0.17 * s], C.leatherDk, tilt)];
  const fletch = [[-0.035, 0.02], [0.03, -0.025], [0.005, 0.045]];
  fletch.forEach(([ox, oz], i) => {
    out.push(spike(`arrow${i}`, [(mouth[0] + ox) * s, mouth[1] * s, (mouth[2] + oz) * s], [d[0] - 0.15 + i * 0.15, d[1], d[2] - 0.1], 0.22 * s, 0.032 * s, i === 1 ? C.gore : C.cloth).shape);
  });
  out.push(sh('quiverStrap', 'box', [(ax - 0.09) * s, (ay + 0.06) * s, (az + 0.13) * s], [0.07 * s, 0.5 * s, 0.05 * s], C.leather, [0, 0, 26]));
  return out;
}

/** Kit entries may return one shape or several — flatten either way. */
function applyKit(kit, s) {
  return kit.flatMap((f) => {
    const r = f(s);
    return Array.isArray(r) ? r : [r];
  });
}

// ============================ ANIMATION HELPERS ============================
// A clip is `{ durationMs, loop, timeline: PoseTimelineEvent[] }` — exactly what
// the Monster Builder's Timeline (advanced) tab authors and
// generators/rig.js's applyKeyframeClip plays back. Everything below just
// SAMPLES a description into that shape, so a shipped clip is not a special
// case: open any prefab and every keyframe is sitting there, draggable.

const poseKey = (atMs, part, x = 0, y = 0, z = 0) => ({
  type: 'pose', atMs: Math.round(atMs), part,
  rotationDeg: { x: +x.toFixed(1), y: +y.toFixed(1), z: +z.toFixed(1) },
});

/**
 * A looping clip sampled from sine waves — the readable way to express a gait.
 * Sampling (rather than shipping the wave itself) is deliberate: the result is
 * ordinary keyframes the author can grab and retime, and playback needs no
 * special "this one is procedural" path.
 * @param {number} durationMs
 * @param {Array<{part:string, axis?:'x'|'y'|'z', ampDeg:number, phaseDeg?:number, offsetDeg?:number}>} waves
 * @param {number} samples keyframes per cycle (the loop point is repeated, so you get samples+1)
 */
export function waveClip(durationMs, waves, samples = 4) {
  const timeline = [];
  for (const w of waves) {
    const axis = w.axis || 'x';
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const angle = (w.offsetDeg || 0) + Math.sin((t * 360 + (w.phaseDeg || 0)) * (Math.PI / 180)) * w.ampDeg;
      const rot = { x: 0, y: 0, z: 0 };
      rot[axis] = angle;
      timeline.push(poseKey(t * durationMs, w.part, rot.x, rot.y, rot.z));
    }
  }
  return { durationMs, loop: true, timeline };
}

/**
 * A one-shot clip from explicit per-part keyframes — for telegraphed attacks,
 * where the whole point is that the timing is NOT a sine wave (slow windup,
 * fast strike, slower recovery).
 * @param {number} durationMs
 * @param {Record<string, Array<[number, number, number?, number?]>>} tracks part -> [[t01, xDeg, yDeg?, zDeg?], ...]
 */
export function keyClip(durationMs, tracks, loop = false) {
  const timeline = [];
  for (const [part, keys] of Object.entries(tracks)) {
    for (const [t, x, y = 0, z = 0] of keys) timeline.push(poseKey(t * durationMs, part, x, y, z));
  }
  return { durationMs, loop, timeline };
}

const LEG_PAIRS = {
  humanoid: [['legL', 0], ['legR', 180]],
  quadruped: [['legFrontL', 0], ['legFrontR', 180], ['legMidFrontL', 180], ['legMidFrontR', 0],
    ['legMidBackL', 0], ['legMidBackR', 180], ['legBackL', 180], ['legBackR', 0]],
};

/** The stock walk for a stance, restricted to the roles a body actually has. Legs swing on x; arms counter-swing. */
function stockWalk(stance, roles, { durationMs = 800, legAmp = 26, armAmp = 20, tailAmp = 9 } = {}) {
  const has = new Set(roles);
  const waves = [];
  for (const [part, phase] of LEG_PAIRS[stance === 'quadruped' ? 'quadruped' : 'humanoid']) {
    if (has.has(part)) waves.push({ part, axis: 'x', ampDeg: legAmp, phaseDeg: phase });
  }
  if (has.has('armL')) waves.push({ part: 'armL', axis: 'x', ampDeg: armAmp, phaseDeg: 180 });
  if (has.has('armR')) waves.push({ part: 'armR', axis: 'x', ampDeg: armAmp, phaseDeg: 0 });
  if (has.has('tail')) waves.push({ part: 'tail', axis: 'y', ampDeg: tailAmp, phaseDeg: 90 });
  if (has.has('head')) waves.push({ part: 'head', axis: 'x', ampDeg: 3, phaseDeg: 0 });
  return waveClip(durationMs, waves);
}

/** The stock idle: a slow breath through the head and a lazy tail/limb drift. Deliberately small — an idle that reads as motion is an idle that reads as twitchy. */
function stockIdle(roles, { durationMs = 2400, headAmp = 4, limbAmp = 3, tailAmp = 7 } = {}) {
  const has = new Set(roles);
  const waves = [];
  if (has.has('head')) waves.push({ part: 'head', axis: 'x', ampDeg: headAmp, phaseDeg: 0 });
  if (has.has('tail')) waves.push({ part: 'tail', axis: 'y', ampDeg: tailAmp, phaseDeg: 40 });
  for (const [part, phase] of [['armL', 0], ['armR', 180], ['legFrontL', 0], ['legFrontR', 180]]) {
    if (has.has(part)) waves.push({ part, axis: 'x', ampDeg: limbAmp, phaseDeg: phase });
  }
  return waveClip(durationMs, waves, 4);
}

/** A two-armed overhead/forward smash: wind back, strike through, settle. */
function armSmashAttack({ durationMs = 700, lead = 'armR', off = 'armL', headDip = true } = {}) {
  const tracks = {
    [lead]: [[0, 0], [0.34, -105, 0, -18], [0.55, 62, 0, 12], [0.78, 30], [1, 0]],
    [off]: [[0, 0], [0.34, -42], [0.55, 26], [1, 0]],
  };
  if (headDip) tracks.head = [[0, 0], [0.34, -16], [0.55, 20], [1, 0]];
  return keyClip(durationMs, tracks);
}

/** A quadruped lunge-bite: rear back, snap the head forward, front legs paw the air. */
function biteAttack({ durationMs = 720, frontL = 'legFrontL', frontR = 'legFrontR' } = {}) {
  return keyClip(durationMs, {
    head: [[0, 0], [0.3, -28], [0.52, 30], [0.72, 12], [1, 0]],
    [frontL]: [[0, 0], [0.3, -48], [0.55, 34], [1, 0]],
    [frontR]: [[0, 0], [0.3, -40], [0.55, 30], [1, 0]],
    tail: [[0, 0], [0.3, 0, -22, 0], [0.6, 0, 18, 0], [1, 0]],
  });
}

/**
 * Stock idle/walk/attack clips for a body the author built themselves, derived
 * from its stance and the slots it actually has. This is what the Monster
 * Builder's "Generate default clips" button hands you: a working animation set
 * to edit, rather than an empty timeline and a rotate gizmo.
 * @param {'humanoid'|'quadruped'} stance
 * @param {string[]} roles the non-torso slot roles present on the body
 */
export function defaultClipsForStance(stance, roles) {
  const has = new Set(roles);
  const quad = stance === 'quadruped';
  const lead = has.has('armR') ? 'armR' : (has.has('legFrontL') ? 'legFrontL' : (has.has('head') ? 'head' : roles[0]));
  const off = has.has('armL') ? 'armL' : (has.has('legFrontR') ? 'legFrontR' : lead);
  return {
    idleClip: stockIdle(roles),
    walkClip: stockWalk(stance, roles, { durationMs: quad ? 700 : 780 }),
    attackClip: quad && !has.has('armR')
      ? biteAttack({ durationMs: 700, frontL: off, frontR: lead })
      : armSmashAttack({ durationMs: 700, lead, off, headDip: has.has('head') }),
  };
}

// ============================ BODY PRESETS ============================
// Complete starter creatures, modelled from the project's monster reference
// sheet (references/): slime, wolf, spider, bear, goblin and undead families,
// each with idle/walk/attack clips already authored so a freshly-applied prefab
// is animated, not a T-pose.
//
// CONNECTION RULES (enforced by `npm run check:prefabs`):
//  1. A limb slot's ANCHOR sits INSIDE the torso solid, so the limb's first
//     joint ball always overlaps the body.
//  2. Head details sit on the head's actual SURFACE via surf()/eyesOn(), never
//     at a hand-guessed offset.

/** Build the four (or eight) leg slots of a quadruped from one leg builder. */
function quadLegs(makeLeg, { x, y, frontZ, backZ }) {
  return [
    slot('legFrontL', [-x, y, frontZ], mirrorX(makeLeg('front'))),
    slot('legFrontR', [x, y, frontZ], makeLeg('front')),
    slot('legBackL', [-x, y, backZ], mirrorX(makeLeg('back'))),
    slot('legBackR', [x, y, backZ], makeLeg('back')),
  ];
}

/** The eight leg slots of an arachnid, fanned front-to-back. */
function arachnidLegs({ x, y, zs, scale = 1, chitin, dark, girth = 0.09 }) {
  const roles = [['legFrontL', 'legFrontR'], ['legMidFrontL', 'legMidFrontR'], ['legMidBackL', 'legMidBackR'], ['legBackL', 'legBackR']];
  const sweeps = [0.62, 0.2, -0.2, -0.62];
  const out = [];
  roles.forEach(([lRole, rRole], i) => {
    const right = arachnidLeg({ side: 1, sweep: sweeps[i], chitin, dark, scale, girth });
    out.push(slot(lRole, [-x, y, zs[i]], mirrorX(right)));
    out.push(slot(rRole, [x, y, zs[i]], right));
  });
  return out;
}

/**
 * A slime is ONE teardrop dome with a face — a rounded top widening to a broad
 * base, painted opaque with a soft highlight.
 *
 * THE WHOLE DOME LIVES IN THE HEAD SLOT, and the torso holds only the puddle it
 * is sitting in. That looks backwards until you remember the torso is the one
 * slot the rig never animates: a slime whose body is the torso can't bob,
 * squash or lunge at all. Putting the dome on the head pivot means the entire
 * creature wobbles, which is the whole of a slime's performance.
 *
 * NOT TRANSLUCENT. The first pass made every mass 0.86-opaque to read as jelly.
 * Three renders overlapping transparent solids with depth-write on, so the
 * crown/drip/core spheres cross-faded into visible seams and the interior
 * geometry showed through as a grey blob behind the face — the reference is a
 * painted, essentially opaque blob whose "glassy" read comes entirely from a
 * bright highlight and a darker base. So: opaque masses, one big sheen, and
 * transparency reserved for the puddle alone.
 */
function slimeDome({ tint, deep, light, eye, scale = 1, bubbles = 0 }) {
  const s = scale;
  const c = [0, 0, 0];
  const semi = [0.48 * s, 0.49 * s, 0.47 * s]; // matches `dome` below — face details ride THIS
  const shapes = [
    ball('dome', c, 0.96 * s, tint, 1.02, 0.98),
    ball('crown', [0.01 * s, 0.24 * s, -0.01 * s], 0.56 * s, tint, 0.66, 0.6),
    ball('skirt', [0, -0.34 * s, 0], 1.04 * s, tint, 0.24, 1.0),
    // Highlight: one big soft oval up and to the left, plus a small companion —
    // the single cue that turns an opaque blob into something wet.
    ball('sheen', onEllipsoid(c, semi, [-0.55, 0.85, 0.5], 0.94), 0.3 * s, light, 0.44, 0.44),
    ball('sheen2', onEllipsoid(c, semi, [-0.78, 0.4, 0.62], 0.96), 0.13 * s, light, 0.5, 0.5),
    // Eyes: flattened navy ovals sunk into the dome, each with a bright glint.
    // NOT white sphere + black pupil — at this size that reads as googly eyes
    // stuck onto the surface rather than a face inside the jelly.
    ...pairOnEllipsoid('eye', c, semi, [0.4, 0.16, 1], (id, p) => ball(id, p, 0.22 * s, eye, 1.15, 0.5), 0.9),
    ...pairOnEllipsoid('glint', c, semi, [0.31, 0.34, 1], (id, p) => ball(id, p, 0.08 * s, C.white, 1, 0.4), 0.99),
    ...pairOnEllipsoid('glintB', c, semi, [0.51, 0.0, 1], (id, p) => ball(id, p, 0.045 * s, C.white, 1, 0.4), 0.99),
    ball('mouth', onEllipsoid(c, semi, [0, -0.32, 1], 0.96), 0.2 * s, eye, 0.42, 0.3),
  ];
  for (let i = 0; i < bubbles; i++) {
    const a = (i / bubbles) * Math.PI * 2 + 0.6;
    shapes.push(ball(`bub${i}`, onEllipsoid(c, semi, [Math.cos(a) * 0.7, 1.1, Math.sin(a) * 0.66], 0.95), (0.18 - (i % 2) * 0.05) * s, light, 1, 1));
  }
  return shapes;
}

/** The puddle a slime sits in — the torso slot, and the only translucent part. */
function slimePuddle({ deep, scale = 1 }) {
  const s = scale;
  return [
    { ...ball('puddle', [0, 0, 0], 1.12 * s, deep, 0.1, 1.06), opacity: 0.55 },
    { ...ball('splashA', [-0.5 * s, 0, 0.2 * s], 0.22 * s, deep, 0.14, 0.9), opacity: 0.5 },
    { ...ball('splashB', [0.49 * s, 0, -0.18 * s], 0.18 * s, deep, 0.14, 0.9), opacity: 0.5 },
    { ...ball('splashC', [0.14 * s, 0, 0.5 * s], 0.15 * s, deep, 0.14, 0.9), opacity: 0.45 },
  ];
}

/** A slime prefab: the dome on the head pivot, a puddle for a torso. */
function slimePreset({ id, name, tint, deep, light, eye, scale = 1, bubbles = 0 }) {
  const s = scale;
  return {
    id, name, stance: 'humanoid',
    slots: [
      slot('torso', [0, 0.03 * s, 0], slimePuddle({ deep, scale: s })),
      slot('head', [0, 0.47 * s, 0], slimeDome({ tint, deep, light, eye, scale: s, bubbles })),
    ],
    animation: {
      // Amplitudes are small on purpose: the head pivot carries the WHOLE body
      // here, so what would be a gentle nod on a humanoid swings a slime's base
      // through the floor.
      idleClip: waveClip(2000 + scale * 400, [
        { part: 'head', axis: 'x', ampDeg: 4, phaseDeg: 0 },
        { part: 'head', axis: 'z', ampDeg: 3, phaseDeg: 90 },
      ], 4),
      walkClip: waveClip(700 + scale * 120, [
        { part: 'head', axis: 'x', ampDeg: 8, phaseDeg: 0 },
        { part: 'head', axis: 'z', ampDeg: 5, phaseDeg: 120 },
      ], 4),
      attackClip: keyClip(520, { head: [[0, 0], [0.34, -16], [0.55, 22], [0.8, 6], [1, 0]] }),
    },
  };
}

// --- WOLF ------------------------------------------------------------------
function wolfBody({ fur, dark, light, belly, eye, scale = 1, spikes: dorsal = 0, ruff = false }) {
  const s = scale;
  const torso = [
    ball('chest', [0, 0.03 * s, 0.28 * s], 0.46 * s, fur, 0.98, 1.0),
    sh('barrel', 'box', [0, 0, -0.06 * s], [0.36 * s, 0.38 * s, 0.74 * s], fur),
    ball('rump', [0, -0.02 * s, -0.44 * s], 0.42 * s, fur, 0.94, 1.0),
    sh('belly', 'box', [0, -0.18 * s, -0.04 * s], [0.3 * s, 0.1 * s, 0.62 * s], belly),
    // The neck is a BONE, not a box: it has to bridge a chest at z≈0.28 to a
    // skull at z≈0.66 across a rising diagonal, and a box big enough to span
    // that reads as a slab wedged between two animals.
    bone('neck', [0, 0.1 * s, 0.28 * s], [0, 0.42, 1], 0.42 * s, 0.27 * s, fur).shape,
    ball('withers', [0, 0.15 * s, 0.16 * s], 0.42 * s, dark, 0.72, 0.7),
  ];
  if (ruff) torso.push(ball('mane', [0, 0.16 * s, 0.4 * s], 0.54 * s, dark, 0.9, 0.66));
  for (let i = 0; i < dorsal; i++) {
    const z = (0.26 - i * 0.15) * s;
    torso.push(sh(`spine${i}`, 'pyramid', [0, (0.2 - Math.abs(i - 2) * 0.012) * s, z], [0.06 * s, (0.15 - Math.abs(i - 2) * 0.02) * s, 0.05 * s], light));
  }
  return {
    torsoAnchor: [0, 0.76 * s, 0],
    torso,
    head: canineHead({ fur, dark, light, eye, scale: s, ruff }),
    headAnchor: [0, 1.0 * s, 0.66 * s],
    tail: (() => {
      const c = chainLimb('tl', [
        { dir: [0, -0.3, -1], len: 0.28 * s, dia: 0.17 * s },
        { dir: [0, -0.6, -1], len: 0.26 * s, dia: 0.21 * s, color: dark },
      ], { color: fur, jointColor: fur, hipDia: 0.22 * s });
      c.shapes.push(ball('tltip', c.end, 0.19 * s, light));
      return c.shapes;
    })(),
    tailAnchor: [0, 0.78 * s, -0.56 * s],
    legs: quadLegs(
      (which) => digitigradeLeg({ fur, dark, paw: dark, drop: 0.62, girth: 0.16, back: which === 'back', scale: s }),
      { x: 0.17 * s, y: 0.7 * s, frontZ: 0.34 * s, backZ: -0.42 * s }
    ),
  };
}

function wolfPreset({ id, name, ...cfg }) {
  const b = wolfBody(cfg);
  const roles = ['head', 'tail', 'legFrontL', 'legFrontR', 'legBackL', 'legBackR'];
  return {
    id, name, stance: 'quadruped',
    slots: [
      slot('torso', b.torsoAnchor, b.torso),
      slot('head', b.headAnchor, b.head),
      slot('tail', b.tailAnchor, b.tail),
      ...b.legs,
    ],
    animation: {
      idleClip: stockIdle(roles, { durationMs: 2600, headAmp: 3, tailAmp: 9 }),
      walkClip: stockWalk('quadruped', roles, { durationMs: 620, legAmp: 30, tailAmp: 12 }),
      attackClip: biteAttack({ durationMs: 640 }),
    },
  };
}

// --- SPIDER ----------------------------------------------------------------
function spiderPreset({ id, name, chitin, dark, light, eye, mark = null, scale = 1 }) {
  const s = scale;
  const thorax = [0, -0.02 * s, 0.14 * s];
  const thoraxSemi = [0.21 * s, 0.164 * s, 0.206 * s]; // ball(dia 0.42s, sy 0.78, sz 0.98) halved
  const torso = [
    ball('abdomen', [0, 0.07 * s, -0.3 * s], 0.58 * s, chitin, 0.86, 1.08),
    ball('waist', [0, 0.0, -0.06 * s], 0.24 * s, dark, 0.8, 0.9),
    ball('thorax', thorax, 0.42 * s, dark, 0.78, 0.98),
    ball('hairA', [0, 0.24 * s, -0.34 * s], 0.2 * s, light, 0.4, 0.9),
    ball('hairB', [-0.16 * s, 0.2 * s, -0.2 * s], 0.14 * s, light, 0.4, 0.9),
    ball('hairC', [0.16 * s, 0.2 * s, -0.2 * s], 0.14 * s, light, 0.4, 0.9),
    ...arachnidFace({ chitin, dark, eye, scale: s, thorax, semi: thoraxSemi }),
  ];
  if (mark) {
    torso.push(sh('markA', 'pyramid', [0, 0.3 * s, -0.34 * s], [0.2 * s, 0.16 * s, 0.3 * s], mark, [180, 0, 0]));
    torso.push(ball('markB', [0, 0.2 * s, -0.56 * s], 0.18 * s, mark, 0.5, 0.7));
  }
  const roles = ['legFrontL', 'legFrontR', 'legMidFrontL', 'legMidFrontR', 'legMidBackL', 'legMidBackR', 'legBackL', 'legBackR'];
  return {
    id, name, stance: 'quadruped',
    slots: [
      slot('torso', [0, 0.44 * s, 0], torso),
      ...arachnidLegs({
        x: 0.15 * s, y: 0.44 * s, scale: s, chitin: dark, dark,
        zs: [0.2 * s, 0.07 * s, -0.07 * s, -0.2 * s],
      }),
    ],
    animation: {
      idleClip: waveClip(2200, roles.map((part, i) => ({ part, axis: 'z', ampDeg: 3, phaseDeg: i * 45 })), 4),
      walkClip: stockWalk('quadruped', roles, { durationMs: 460, legAmp: 22 }),
      // Rear up on the back legs and stab down with the front pair — the
      // silhouette a spider actually makes when it strikes.
      attackClip: keyClip(620, {
        legFrontL: [[0, 0], [0.32, -62], [0.55, 46], [1, 0]],
        legFrontR: [[0, 0], [0.32, -62], [0.55, 46], [1, 0]],
        legMidFrontL: [[0, 0], [0.32, -28], [0.55, 20], [1, 0]],
        legMidFrontR: [[0, 0], [0.32, -28], [0.55, 20], [1, 0]],
        legBackL: [[0, 0], [0.32, 16], [0.55, -10], [1, 0]],
        legBackR: [[0, 0], [0.32, 16], [0.55, -10], [1, 0]],
      }),
    },
  };
}

// --- BEAR ------------------------------------------------------------------
function bearPreset({ id, name, fur, dark, light, muzzle, eye = C.black, scale = 1, spirit = false }) {
  const s = scale;
  const torso = [
    ball('hump', [0, 0.16 * s, 0.16 * s], 0.62 * s, fur, 0.8, 0.8),
    sh('barrel', 'box', [0, 0, -0.1 * s], [0.56 * s, 0.5 * s, 0.78 * s], fur),
    ball('rump', [0, -0.02 * s, -0.46 * s], 0.54 * s, fur, 0.94, 0.94),
    sh('belly', 'box', [0, -0.23 * s, -0.06 * s], [0.42 * s, 0.12 * s, 0.66 * s], light),
    bone('neck', [0, 0.06 * s, 0.22 * s], [0, 0.05, 1], 0.38 * s, 0.32 * s, dark).shape,
  ];
  const head = ursineHead({ fur, dark, muzzle, scale: 1.24 * s, eye });
  const roles = ['head', 'tail', 'legFrontL', 'legFrontR', 'legBackL', 'legBackR'];
  const preset = {
    id, name, stance: 'quadruped',
    slots: [
      slot('torso', [0, 0.72 * s, 0], torso),
      slot('head', [0, 0.76 * s, 0.78 * s], head),
      slot('tail', [0, 0.66 * s, -0.6 * s], [ball('tl1', [0, 0, -0.02 * s], 0.18 * s, fur), ball('tl2', [0, -0.02 * s, -0.12 * s], 0.13 * s, dark)]),
      ...quadLegs(
        () => plantigradeLeg({ fur, dark, foot: dark, drop: 0.54, girth: 0.3, scale: s, toe: 0.13 }),
        { x: 0.26 * s, y: 0.62 * s, frontZ: 0.34 * s, backZ: -0.42 * s }
      ),
    ],
    animation: {
      idleClip: stockIdle(roles, { durationMs: 3000, headAmp: 3.5, tailAmp: 4 }),
      walkClip: stockWalk('quadruped', roles, { durationMs: 900, legAmp: 22, tailAmp: 5 }),
      // A bear swipes rather than bites: rear the front-left paw up and rake down.
      attackClip: keyClip(780, {
        legFrontL: [[0, 0], [0.3, -96, 0, -22], [0.52, 52, 0, 18], [0.75, 20], [1, 0]],
        legFrontR: [[0, 0], [0.3, -30], [0.52, 18], [1, 0]],
        head: [[0, 0], [0.3, -18], [0.52, 22], [1, 0]],
      }),
    },
  };
  if (spirit) for (const sl of preset.slots) for (const shape of sl.shapes) if (shape.color === fur) shape.opacity = 0.78;
  return preset;
}

// --- GOBLIN ----------------------------------------------------------------
/**
 * The shared goblin chassis. `kit` layers gear onto the torso/head without
 * touching the body underneath, which is what keeps Scout/Warrior/Shaman/Brute
 * recognisably the same species.
 */
function goblinPreset({ id, name, scale = 1, skin = C.gob, dark = C.gobDk, eye = C.eyeAmber, torsoKit = [], headKit = [], armGirth = 0.16, backKit = [] }) {
  const s = scale;
  const torso = [
    ball('chest', [0, 0.1 * s, 0], 0.42 * s, skin, 0.86, 0.74),
    ball('gut', [0, -0.14 * s, 0.02 * s], 0.36 * s, skin, 0.9, 0.82),
    sh('neck', 'cylinder', [0, 0.26 * s, 0.01 * s], [0.16 * s, 0.22 * s, 0.16 * s], dark),
    sh('belt', 'box', [0, -0.28 * s, 0], [0.38 * s, 0.08 * s, 0.32 * s], C.leatherDk),
    sh('loin', 'box', [0, -0.37 * s, 0.02 * s], [0.3 * s, 0.16 * s, 0.28 * s], C.cloth),
    ...applyKit(torsoKit, s),
    ...applyKit(backKit, s),
  ];
  const head = [...goblinHead({ skin, dark, eye, scale: 0.92 * s }), ...applyKit(headKit, 0.92 * s)];
  const arm = clawedArm({ skin, dark, girth: armGirth, drop: 0.52, scale: s });
  const leg = plantigradeLeg({ fur: skin, dark, foot: C.leatherDk, drop: 0.56, girth: 0.18, scale: s });
  const roles = ['head', 'armL', 'armR', 'legL', 'legR'];
  return {
    id, name, stance: 'humanoid',
    slots: [
      slot('torso', [0, 0.92 * s, 0], torso),
      slot('head', [0, 1.36 * s, 0.01 * s], head),
      slot('armL', [-0.27 * s, 1.1 * s, 0], mirrorX(arm)),
      slot('armR', [0.27 * s, 1.1 * s, 0], arm),
      slot('legL', [-0.13 * s, 0.64 * s, 0], mirrorX(leg)),
      slot('legR', [0.13 * s, 0.64 * s, 0], leg),
    ],
    animation: {
      idleClip: stockIdle(roles, { durationMs: 2200, headAmp: 4, limbAmp: 4 }),
      walkClip: stockWalk('humanoid', roles, { durationMs: 680, legAmp: 30, armAmp: 24 }),
      attackClip: armSmashAttack({ durationMs: 620 }),
    },
  };
}

// --- UNDEAD ----------------------------------------------------------------
function skeletonPreset({ id, name, tone = C.bone, dark = C.boneDk, glow = null, scale = 1, torsoKit = [], headKit = [] }) {
  const s = scale;
  const torso = [...ribcage({ tone, dark, scale: s }), ...applyKit(torsoKit, s)];
  const head = [...skullHead({ tone, dark, glow, scale: s }), ...applyKit(headKit, s)];
  const arm = boneArm({ tone, dark, drop: 0.62 * s, girth: 0.095 });
  const leg = boneLeg({ tone, dark, drop: 0.62 * s, girth: 0.115 });
  const roles = ['head', 'armL', 'armR', 'legL', 'legR'];
  return {
    id, name, stance: 'humanoid',
    slots: [
      slot('torso', [0, 0.98 * s, 0], torso),
      slot('head', [0, 1.5 * s, 0], head),
      slot('armL', [-0.22 * s, 1.24 * s, 0], mirrorX(arm)),
      slot('armR', [0.22 * s, 1.24 * s, 0], arm),
      slot('legL', [-0.14 * s, 0.66 * s, 0], mirrorX(leg)),
      slot('legR', [0.14 * s, 0.66 * s, 0], leg),
    ],
    animation: {
      idleClip: stockIdle(roles, { durationMs: 2800, headAmp: 3, limbAmp: 2.5 }),
      walkClip: stockWalk('humanoid', roles, { durationMs: 760, legAmp: 24, armAmp: 18 }),
      attackClip: armSmashAttack({ durationMs: 660 }),
    },
  };
}

export const BODY_PRESETS = [
  // ---------------- SLIME ----------------
  slimePreset({ id: 'body-slime', name: 'Slime', tint: C.slime, deep: C.slimeDk, light: C.slimeLt, eye: C.slimeEye }),
  slimePreset({ id: 'body-slime-large', name: 'Large Slime', tint: 0x3aa2dc, deep: 0x1b628f, light: 0xdaf2ff, eye: 0x0e3454, scale: 1.6, bubbles: 3 }),
  slimePreset({ id: 'body-slime-plague', name: 'Plague Slime', tint: 0x7fc23a, deep: 0x456f1c, light: 0xe4f8b8, eye: 0x24400e, scale: 1.15, bubbles: 4 }),

  // ---------------- WOLF ----------------
  wolfPreset({ id: 'body-wolf', name: 'Gray Wolf', fur: C.wolf, dark: C.wolfDk, light: C.wolfLt, belly: C.wolfBelly, eye: C.eyeAmber }),
  wolfPreset({ id: 'body-dire-wolf', name: 'Dire Wolf', fur: C.dire, dark: C.direDk, light: C.direLt, belly: 0x2c2830, eye: C.eyeRed, scale: 1.3, spikes: 5, ruff: true }),
  wolfPreset({ id: 'body-frost-wolf', name: 'Frost Wolf', fur: 0xd8e6f2, dark: 0x9ab6cc, light: 0xf2f8ff, belly: 0xffffff, eye: 0x4fc8f0, scale: 1.12, spikes: 5, ruff: true }),

  // ---------------- SPIDER ----------------
  spiderPreset({ id: 'body-cave-spider', name: 'Cave Spider', chitin: C.chitin, dark: C.chitinDk, light: C.chitinLt, eye: C.eyeRed }),
  spiderPreset({ id: 'body-giant-spider', name: 'Giant Spider', chitin: C.venom, dark: 0x181218, light: 0x463a44, eye: C.eyeRed, mark: C.venomMark, scale: 1.5 }),
  spiderPreset({ id: 'body-poison-spider', name: 'Poison Spider', chitin: 0x4a7a28, dark: 0x2c4a16, light: 0x86bb4a, eye: C.eyeAmber, mark: 0x1c2a12, scale: 1.2 }),

  // ---------------- BEAR ----------------
  bearPreset({ id: 'body-bear', name: 'Brown Bear', fur: C.bear, dark: C.bearDk, light: C.bearLt, muzzle: C.bearMuzzle }),
  bearPreset({ id: 'body-dire-bear', name: 'Dire Bear', fur: 0x2e2a2c, dark: 0x1a1718, light: 0x4a4244, muzzle: 0x5a4c46, eye: C.eyeRed, scale: 1.25 }),
  bearPreset({ id: 'body-arctic-bear', name: 'Arctic Bear', fur: 0xeaeef2, dark: 0xc0ccd6, light: 0xffffff, muzzle: 0xd8dee4, eye: C.black, scale: 1.1 }),

  // ---------------- GOBLIN ----------------
  goblinPreset({
    id: 'body-goblin-scout', name: 'Goblin Scout', scale: 0.84, armGirth: 0.14,
    torsoKit: [(s) => sh('strap', 'box', [0.05 * s, 0.02 * s, 0.15 * s], [0.09 * s, 0.5 * s, 0.05 * s], C.leather, [0, 0, 20])],
    headKit: [(s) => sh('band', 'box', [0, 0.16 * s, 0.02 * s], [0.35 * s, 0.06 * s, 0.33 * s], C.gore)],
  }),
  goblinPreset({
    id: 'body-goblin-warrior', name: 'Goblin Warrior', scale: 0.92, armGirth: 0.17,
    torsoKit: [
      (s) => sh('cuirass', 'box', [0, 0.06 * s, 0.13 * s], [0.42 * s, 0.36 * s, 0.12 * s], C.iron),
      (s) => sh('rivets', 'box', [0, 0.06 * s, 0.19 * s], [0.05 * s, 0.3 * s, 0.03 * s], C.ironLt),
      (s) => ball('pauldronL', [-0.24 * s, 0.2 * s, 0], 0.28 * s, C.ironDk, 0.8, 0.9),
      (s) => ball('pauldronR', [0.24 * s, 0.2 * s, 0], 0.28 * s, C.ironDk, 0.8, 0.9),
    ],
    headKit: [
      (s) => sh('helm', 'box', [0, 0.15 * s, -0.02 * s], [0.34 * s, 0.14 * s, 0.34 * s], C.iron),
      (s) => sh('nasal', 'box', [0, 0.06 * s, 0.16 * s], [0.05 * s, 0.16 * s, 0.06 * s], C.iron),
      (s) => spike('helmSpike', [0, 0.21 * s, -0.02 * s], [0, 1, -0.1], 0.16 * s, 0.07 * s, C.ironLt).shape,
    ],
  }),
  goblinPreset({
    id: 'body-goblin-archer', name: 'Goblin Archer', scale: 0.86, armGirth: 0.14,
    torsoKit: [(s) => sh('strap', 'box', [-0.05 * s, 0.02 * s, 0.14 * s], [0.09 * s, 0.5 * s, 0.05 * s], C.leather, [0, 0, -22])],
    backKit: [(s) => quiver(s, [0.13, 0.02, -0.2])],
    headKit: [(s) => sh('hood', 'cone', [0, 0.1 * s, -0.03 * s], [0.42 * s, 0.34 * s, 0.42 * s], C.clothDk, [180, 0, 0])],
  }),
  goblinPreset({
    id: 'body-goblin-shaman', name: 'Goblin Shaman', scale: 0.87, skin: 0x84a84a, dark: 0x5a7830, eye: C.eyeGreen, armGirth: 0.13,
    torsoKit: [
      (s) => sh('robe', 'cone', [0, -0.2 * s, 0], [0.6 * s, 0.5 * s, 0.56 * s], C.arcaneDk, [180, 0, 0]),
      (s) => sh('beads', 'box', [0, 0.02 * s, 0.17 * s], [0.3 * s, 0.05 * s, 0.06 * s], C.bone),
      (s) => ball('totem', [0.02 * s, -0.06 * s, 0.2 * s], 0.16 * s, C.bone, 1, 0.8),
    ],
    headKit: [
      (s) => sh('mask', 'box', [0, 0.02 * s, 0.16 * s], [0.28 * s, 0.24 * s, 0.06 * s], C.bone),
      (s) => ball('maskEyeL', [-0.07 * s, 0.05 * s, 0.19 * s], 0.06 * s, C.eyeVoid, 1, 0.5),
      (s) => ball('maskEyeR', [0.07 * s, 0.05 * s, 0.19 * s], 0.06 * s, C.eyeVoid, 1, 0.5),
      (s) => spike('featherL', [-0.14 * s, 0.16 * s, -0.04 * s], [-0.5, 1, -0.4], 0.3 * s, 0.06 * s, C.gore).shape,
      (s) => spike('featherR', [0.14 * s, 0.16 * s, -0.04 * s], [0.5, 1, -0.4], 0.3 * s, 0.06 * s, C.arcane).shape,
    ],
  }),
  goblinPreset({
    id: 'body-goblin-brute', name: 'Goblin Brute', scale: 1.14, skin: 0x5f8a34, dark: 0x3f5f22, eye: C.eyeRed, armGirth: 0.26,
    torsoKit: [
      (s) => ball('pecL', [-0.16 * s, 0.12 * s, 0.13 * s], 0.3 * s, 0x5f8a34, 0.78, 0.6),
      (s) => ball('pecR', [0.16 * s, 0.12 * s, 0.13 * s], 0.3 * s, 0x5f8a34, 0.78, 0.6),
      (s) => ball('pauldronL', [-0.3 * s, 0.2 * s, 0], 0.32 * s, C.leatherDk, 0.8, 0.9),
      (s) => spike('spikeL', [-0.34 * s, 0.28 * s, 0], [-0.5, 1, 0], 0.2 * s, 0.08 * s, C.ironLt).shape,
      (s) => sh('scar', 'box', [0.1 * s, 0.04 * s, 0.19 * s], [0.04 * s, 0.28 * s, 0.03 * s], 0x7a4a3a, [0, 0, 16]),
    ],
    headKit: [
      (s) => spike('hornL', surf(0.18 * s, [-0.7, 0.8, -0.2], 0.8), [-0.6, 0.75, -0.3], 0.24 * s, 0.08 * s, C.claw).shape,
      (s) => spike('hornR', surf(0.18 * s, [0.7, 0.8, -0.2], 0.8), [0.6, 0.75, -0.3], 0.24 * s, 0.08 * s, C.claw).shape,
    ],
  }),

  // ---------------- UNDEAD ----------------
  skeletonPreset({ id: 'body-skeleton', name: 'Skeleton' }),
  skeletonPreset({
    id: 'body-skeleton-archer', name: 'Skeleton Archer',
    torsoKit: [
      (s) => quiver(s, [0.14, 0.02, -0.18]),
      (s) => sh('rag', 'box', [0, -0.06 * s, 0.06 * s], [0.36 * s, 0.3 * s, 0.24 * s], C.clothDk, [4, 0, 0]),
      (s) => ball('ragKnot', [0, 0.06 * s, 0.04 * s], 0.14 * s, C.clothDk),
    ],
    headKit: [(s) => sh('hood', 'cone', [0, 0.11 * s, -0.03 * s], [0.4 * s, 0.32 * s, 0.4 * s], C.clothDk, [180, 0, 0])],
  }),
  skeletonPreset({
    id: 'body-lich', name: 'Lich', tone: 0xe6e0cc, dark: 0xb0a68c, glow: C.arcane, scale: 1.06,
    torsoKit: [
      (s) => sh('robe', 'cone', [0, -0.16 * s, 0], [0.72 * s, 0.9 * s, 0.66 * s], C.arcaneDk, [180, 0, 0]),
      (s) => sh('collar', 'cone', [0, 0.34 * s, -0.02 * s], [0.56 * s, 0.34 * s, 0.5 * s], C.arcane, [8, 0, 0]),
      (s) => sh('sash', 'box', [0, 0.04 * s, 0.18 * s], [0.4 * s, 0.06 * s, 0.06 * s], C.gold),
      (s) => ball('gem', [0, 0.14 * s, 0.2 * s], 0.11 * s, C.arcane, 1, 0.7),
    ],
    headKit: [
      (s) => sh('crown', 'cylinder', [0, 0.18 * s, -0.01 * s], [0.32 * s, 0.09 * s, 0.32 * s], C.gold),
      (s) => spike('crownA', [0, 0.21 * s, 0.13 * s], [0, 1, 0.25], 0.12 * s, 0.06 * s, C.gold).shape,
      (s) => spike('crownB', [-0.13 * s, 0.21 * s, 0], [-0.3, 1, 0], 0.1 * s, 0.055 * s, C.gold).shape,
      (s) => spike('crownC', [0.13 * s, 0.21 * s, 0], [0.3, 1, 0], 0.1 * s, 0.055 * s, C.gold).shape,
    ],
  }),
  (() => {
    // ZOMBIE — the skeleton chassis wearing rotted flesh: same proportions,
    // hunched forward, one arm hanging lower than the other.
    const s = 1;
    const torso = [
      ball('chest', [0, 0.1, 0], 0.44, C.rot, 0.92, 0.76),
      ball('gut', [0, -0.14, 0.02], 0.4, C.rot, 0.9, 0.82),
      sh('ribGash', 'box', [-0.1, 0.06, 0.17], [0.16, 0.22, 0.06], C.gore),
      sh('rib1', 'box', [-0.1, 0.12, 0.19], [0.14, 0.03, 0.05], C.bone),
      sh('rib2', 'box', [-0.1, 0.04, 0.19], [0.13, 0.03, 0.05], C.bone),
      sh('shirt', 'box', [0, -0.08, 0], [0.46, 0.3, 0.36], C.rotDk, [6, 0, 0]),
      sh('neck', 'cylinder', [0, 0.26, 0.03], [0.15, 0.16, 0.15], C.rotDk, [16, 0, 0]),
      sh('belt', 'box', [0, -0.28, 0], [0.42, 0.08, 0.36], C.leatherDk),
    ];
    const armR = clawedArm({ skin: C.rot, dark: C.rotDk, girth: 0.15, drop: 0.56, claws: 3 });
    const armL = mirrorX(clawedArm({ skin: C.rot, dark: C.rotDk, girth: 0.15, drop: 0.62, claws: 3 }));
    const leg = plantigradeLeg({ fur: C.rotDk, dark: C.rotDk, foot: C.leatherDk, drop: 0.62, girth: 0.21 });
    const roles = ['head', 'armL', 'armR', 'legL', 'legR'];
    return {
      id: 'body-zombie', name: 'Zombie', stance: 'humanoid',
      slots: [
        slot('torso', [0, 0.92 * s, 0], torso),
        slot('head', [0, 1.36, 0.1], rotHead({})),
        slot('armL', [-0.26, 1.1, 0.02], armL),
        slot('armR', [0.26, 1.1, 0.02], armR),
        slot('legL', [-0.14, 0.66, 0], mirrorX(leg)),
        slot('legR', [0.14, 0.66, 0], leg),
      ],
      animation: {
        // A shamble, not a walk: slow, uneven, arms hanging and barely swinging.
        idleClip: waveClip(3200, [
          { part: 'head', axis: 'z', ampDeg: 5, phaseDeg: 0 },
          { part: 'armL', axis: 'x', ampDeg: 3, phaseDeg: 30 },
          { part: 'armR', axis: 'x', ampDeg: 2.5, phaseDeg: 200 },
        ], 4),
        walkClip: waveClip(1400, [
          { part: 'legL', axis: 'x', ampDeg: 20, phaseDeg: 0 },
          { part: 'legR', axis: 'x', ampDeg: 14, phaseDeg: 180 },
          { part: 'armL', axis: 'x', ampDeg: 8, phaseDeg: 200, offsetDeg: -28 },
          { part: 'armR', axis: 'x', ampDeg: 6, phaseDeg: 20, offsetDeg: -34 },
          { part: 'head', axis: 'z', ampDeg: 6, phaseDeg: 90 },
        ], 4),
        attackClip: keyClip(900, {
          armR: [[0, 0], [0.4, -80, 0, -14], [0.62, 40, 0, 10], [1, 0]],
          armL: [[0, 0], [0.4, -66, 0, 14], [0.62, 32, 0, -10], [1, 0]],
          head: [[0, 0], [0.4, -12], [0.62, 18], [1, 0]],
        }),
      },
    };
  })(),
  (() => {
    // GHOUL — crouched, front-heavy, arms long enough to knuckle the ground.
    const arm = clawedArm({ skin: C.ghoul, dark: C.ghoulDk, girth: 0.14, drop: 0.82, claws: 4 });
    const leg = (() => {
      const c = chainLimb('lg', [
        { dir: [0.05, -0.86, -0.5], len: 0.34, dia: 0.19 },
        { dir: [-0.03, -0.94, 0.35], len: 0.3, dia: 0.15, color: C.ghoulDk },
      ], { color: C.ghoul, jointColor: C.ghoulDk, hipDia: 0.3 });
      c.shapes.push(footAt('lgfoot', c.end, [0.19, 0.08, 0.3], C.ghoulDk, 0.07));
      for (let i = -1; i <= 1; i++) {
        c.shapes.push(spike(`lgclaw${i + 1}`, [c.end[0] + i * 0.06, c.end[1] - 0.02, c.end[2] + 0.16], [i * 0.3, -0.2, 1], 0.1, 0.04, C.claw).shape);
      }
      return c.shapes;
    })();
    const roles = ['head', 'armL', 'armR', 'legL', 'legR'];
    return {
      id: 'body-ghoul', name: 'Ghoul', stance: 'humanoid',
      slots: [
        slot('torso', [0, 0.86, -0.04], [
          ball('hump', [0, 0.2, -0.12], 0.44, C.ghoulDk, 0.8, 0.8),
          sh('chest', 'box', [0, 0.04, 0.04], [0.44, 0.34, 0.32], C.ghoul, [22, 0, 0]),
          sh('rib1', 'box', [0, 0.1, 0.19], [0.32, 0.04, 0.07], C.ghoulDk, [22, 0, 0]),
          sh('rib2', 'box', [0, 0.0, 0.14], [0.3, 0.04, 0.07], C.ghoulDk, [22, 0, 0]),
          ball('gut', [0, -0.2, 0.06], 0.36, C.ghoul, 0.86, 0.84),
          sh('neck', 'cylinder', [0, 0.24, 0.18], [0.15, 0.2, 0.15], C.ghoulDk, [40, 0, 0]),
        ]),
        slot('head', [0, 1.06, 0.24], [
          ball('skull', [0, 0, 0], 0.32, C.ghoul, 1.0, 1.05),
          sh('brow', 'box', [0, 0.07, 0.13], [0.26, 0.06, 0.12], C.ghoulDk),
          ball('sockL', [-0.075, 0.01, 0.13], 0.085, C.eyeVoid, 1, 0.5),
          ball('sockR', [0.075, 0.01, 0.13], 0.085, C.eyeVoid, 1, 0.5),
          ball('pupL', [-0.078, 0.01, 0.15], 0.04, C.eyeAmber, 1, 0.6),
          ball('pupR', [0.078, 0.01, 0.15], 0.04, C.eyeAmber, 1, 0.6),
          sh('maw', 'box', [0, -0.16, 0.11], [0.24, 0.13, 0.2], C.ghoulDk, [10, 0, 0]),
          sh('teethU', 'box', [0, -0.11, 0.18], [0.2, 0.04, 0.05], C.white),
          sh('teethL', 'box', [0, -0.2, 0.18], [0.18, 0.04, 0.05], C.white),
          sh('earL', 'pyramid', [-0.15, 0.08, -0.06], [0.07, 0.2, 0.05], C.ghoul, [-10, -18, 60]),
          sh('earR', 'pyramid', [0.15, 0.08, -0.06], [0.07, 0.2, 0.05], C.ghoul, [-10, 18, -60]),
        ]),
        slot('armL', [-0.24, 1.0, 0.06], mirrorX(arm)),
        slot('armR', [0.24, 1.0, 0.06], arm),
        slot('legL', [-0.15, 0.62, -0.02], mirrorX(leg)),
        slot('legR', [0.15, 0.62, -0.02], leg),
      ],
      animation: {
        idleClip: waveClip(1900, [
          { part: 'head', axis: 'y', ampDeg: 9, phaseDeg: 0 },
          { part: 'armL', axis: 'x', ampDeg: 4, phaseDeg: 0 },
          { part: 'armR', axis: 'x', ampDeg: 4, phaseDeg: 180 },
        ], 4),
        walkClip: waveClip(520, [
          { part: 'legL', axis: 'x', ampDeg: 34, phaseDeg: 0 },
          { part: 'legR', axis: 'x', ampDeg: 34, phaseDeg: 180 },
          { part: 'armL', axis: 'x', ampDeg: 26, phaseDeg: 180 },
          { part: 'armR', axis: 'x', ampDeg: 26, phaseDeg: 0 },
          { part: 'head', axis: 'x', ampDeg: 5, phaseDeg: 0 },
        ], 4),
        attackClip: keyClip(560, {
          armR: [[0, 0], [0.28, -92, 0, -26], [0.5, 58, 0, 22], [1, 0]],
          armL: [[0, 0], [0.28, -78, 0, 26], [0.5, 50, 0, -22], [1, 0]],
          head: [[0, 0], [0.28, -20], [0.5, 26], [1, 0]],
        }),
      },
    };
  })(),
  (() => {
    // WRAITH — no legs at all. The rig only animates the slots a body actually
    // has (see applyGaitPose), so omitting legL/legR is enough to make it float.
    const sleeve = robedArm({ robe: C.shroud, trim: C.shroudDk, drop: 0.66, girth: 0.22 });
    const roles = ['head', 'armL', 'armR', 'tail'];
    return {
      id: 'body-wraith', name: 'Wraith', stance: 'humanoid',
      slots: [
        slot('torso', [0, 1.02, 0], [
          { ...sh('robe', 'cone', [0, -0.26, 0], [0.8, 1.2, 0.7], C.shroud, [180, 0, 0]), opacity: 0.88 },
          ball('chest', [0, 0.2, 0], 0.46, C.shroud, 0.92, 0.8),
          sh('collar', 'cone', [0, 0.36, -0.02], [0.56, 0.3, 0.5], C.shroudDk, [10, 0, 0]),
          { ...ball('coreGlow', [0, 0.1, 0.16], 0.16, C.spectral, 1, 0.6), opacity: 0.75 },
          { ...sh('wispA', 'cone', [-0.18, -0.72, 0.04], [0.2, 0.4, 0.18], C.shroudDk, [172, 0, 10]), opacity: 0.45 },
          { ...sh('wispB', 'cone', [0.2, -0.76, -0.06], [0.18, 0.36, 0.16], C.shroudDk, [174, 0, -12]), opacity: 0.4 },
        ]),
        slot('head', [0, 1.5, 0.02], [
          sh('hood', 'cone', [0, 0.06, -0.02], [0.46, 0.5, 0.46], C.shroud, [180, 0, 0]),
          ball('void', [0, -0.02, 0.05], 0.3, C.eyeVoid, 0.92, 0.72),
          sh('cowlRim', 'box', [0, 0.14, 0.04], [0.32, 0.13, 0.3], C.shroudDk, [16, 0, 0]),
          ball('eyeL', [-0.075, -0.01, 0.15], 0.055, C.spectral, 1, 0.6),
          ball('eyeR', [0.075, -0.01, 0.15], 0.055, C.spectral, 1, 0.6),
          { ...sh('tatterL', 'cone', [-0.2, -0.16, -0.04], [0.12, 0.3, 0.1], C.shroudDk, [168, 0, 16]), opacity: 0.6 },
          { ...sh('tatterR', 'cone', [0.2, -0.18, -0.06], [0.11, 0.28, 0.09], C.shroudDk, [170, 0, -18]), opacity: 0.55 },
        ]),
        slot('armL', [-0.3, 1.24, 0], mirrorX(sleeve)),
        slot('armR', [0.3, 1.24, 0], sleeve),
        slot('tail', [0, 0.66, -0.1], [
          { ...sh('trailA', 'cone', [0, -0.1, -0.14], [0.34, 0.5, 0.24], C.shroud, [-104, 0, 0]), opacity: 0.5 },
          // Seated ON trailA's axis, not beside it: that cone's radius has
          // already narrowed to ~0.09 by z=-0.14, so a wisp at x=±0.1 floats.
          { ...sh('trailB', 'cone', [-0.05, -0.13, -0.16], [0.14, 0.34, 0.11], C.shroudDk, [-96, 0, 14]), opacity: 0.35 },
          { ...sh('trailC', 'cone', [0.05, -0.15, -0.18], [0.13, 0.3, 0.1], C.shroudDk, [-92, 0, -16]), opacity: 0.3 },
        ]),
      ],
      animation: {
        idleClip: waveClip(3400, [
          { part: 'head', axis: 'y', ampDeg: 7, phaseDeg: 0 },
          { part: 'armL', axis: 'z', ampDeg: 6, phaseDeg: 0 },
          { part: 'armR', axis: 'z', ampDeg: 6, phaseDeg: 180 },
          { part: 'tail', axis: 'x', ampDeg: 5, phaseDeg: 90 },
        ], 4),
        // Drifting, not walking: the robe sways and the sleeves trail.
        walkClip: waveClip(1600, [
          { part: 'armL', axis: 'z', ampDeg: 12, phaseDeg: 0, offsetDeg: -8 },
          { part: 'armR', axis: 'z', ampDeg: 12, phaseDeg: 180, offsetDeg: 8 },
          { part: 'tail', axis: 'x', ampDeg: 10, phaseDeg: 90, offsetDeg: -6 },
          { part: 'head', axis: 'y', ampDeg: 5, phaseDeg: 45 },
        ], 4),
        attackClip: keyClip(760, {
          armR: [[0, 0], [0.36, -100, 0, -34], [0.58, 46, 0, 26], [1, 0]],
          armL: [[0, 0], [0.36, -34, 0, 26], [0.58, 20, 0, -14], [1, 0]],
          head: [[0, 0], [0.36, -10], [0.58, 16], [1, 0]],
          tail: [[0, 0], [0.36, -14], [0.58, 12], [1, 0]],
        }),
      },
    };
  })(),
];
