// src/generators/monsterPresets.js
// Built-in Monster Builder content — NOT user-authored/saved, shipped as
// static data so building a recognizable monster takes clicks instead of
// hand-placing every primitive. Two things live here:
//   - PART_PRESETS: shape compositions per body-part category, clicked to
//     replace the active slot's shapes wholesale.
//   - BODY_PRESETS: complete starter creatures, clicked to replace an
//     entire monster type's slots + stance as a starting point.
// Every shape uses the same descriptor shape as a hand-authored one
// (src/sim/monsterTypeDefs.js's MonsterShapeDef) — buildShapeMesh
// (src/generators/custom.js) renders these with zero special-casing,
// including the `rotation: {x,y,z}` object used heavily below to angle
// snouts, splay legs, and sweep horns/tails.

/** Which PART_PRESETS category a given slot role's presets come from — arm/leg presets are generic per limb type, applied to whichever specific slot is active. */
export function presetCategoryForRole(role) {
  if (role === 'armL' || role === 'armR') return 'arm';
  if (role.startsWith('leg')) return 'leg';
  return role; // head, torso, tail
}

// --- Compact authoring helpers (keeps the data below readable) ---
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

// --- Shared palette (hex ints) ---
const C = {
  tan: 0xc9a876, green: 0x6a9a4a, greenDk: 0x4a7a3a, gray: 0x6b6b73, grayDk: 0x45454e,
  stone: 0x7a7280, stoneDk: 0x4a4650, brown: 0x6a4a2a, brownLt: 0x8a6a4a, brownDk: 0x3a2a1a,
  bone: 0xe8e0d0, cream: 0xe8e0c8, red: 0xb0402a, redDk: 0x2a1010, blue: 0x3a5a9a, blueBird: 0x3a6ac0,
  slime: 0x5ac86a, purpleDk: 0x4a3a4a, mushroom: 0xc0403a, orange: 0xe0a040, white: 0xeeeeee,
  black: 0x1a1a1a, pink: 0xcc8f8f, eyeRed: 0xd83030, eyeAmber: 0xf0c040, eyeYellow: 0xf5e060,
  ladybugRed: 0xcc3e22,
  glow: 0xff7a2a, fur: 0x8a7a6a,
};

// ============================ PART PRESETS ============================
// Clicking one replaces the active slot's shapes. Each is a self-contained
// composition authored around the slot's own origin (0,0,0 = the pivot).
const SKIN = C.tan;
export const PART_PRESETS = {
  head: [
    { id: 'head-round', label: 'Round', shapes: [sh('h1', 'sphere', [0, 0, 0], [0.32, 0.32, 0.32], SKIN)] },
    { id: 'head-boxy', label: 'Boxy', shapes: [sh('h1', 'box', [0, 0, 0], [0.3, 0.28, 0.28], SKIN)] },
    { id: 'head-snouted', label: 'Snouted', shapes: [
      sh('h1', 'sphere', [0, 0, 0], [0.28, 0.28, 0.28], SKIN),
      sh('h2', 'box', [0, -0.05, 0.2], [0.16, 0.14, 0.2], SKIN),
      sh('h3', 'sphere', [0, -0.06, 0.32], [0.06, 0.05, 0.05], C.black),
    ] },
    { id: 'head-horned', label: 'Horned', shapes: [
      sh('h1', 'sphere', [0, 0, 0], [0.32, 0.32, 0.32], SKIN),
      sh('h2', 'cone', [-0.13, 0.2, -0.04], [0.07, 0.22, 0.07], C.white, [-20, 0, 12]),
      sh('h3', 'cone', [0.13, 0.2, -0.04], [0.07, 0.22, 0.07], C.white, [-20, 0, -12]),
    ] },
    { id: 'head-eared', label: 'Eared', shapes: [
      sh('h1', 'sphere', [0, 0, 0], [0.3, 0.3, 0.3], SKIN),
      sh('h2', 'pyramid', [-0.16, 0.22, 0], [0.12, 0.26, 0.08], SKIN, [0, 0, 18]),
      sh('h3', 'pyramid', [0.16, 0.22, 0], [0.12, 0.26, 0.08], SKIN, [0, 0, -18]),
    ] },
    { id: 'head-beaked', label: 'Beaked', shapes: [
      sh('h1', 'sphere', [0, 0, 0], [0.26, 0.26, 0.26], SKIN),
      sh('h2', 'cone', [0, -0.02, 0.2], [0.1, 0.18, 0.1], C.orange, [90, 0, 0]),
    ] },
    { id: 'head-skull', label: 'Skull', shapes: [
      sh('h1', 'sphere', [0, 0.02, 0], [0.27, 0.29, 0.27], C.bone),
      sh('h2', 'sphere', [-0.09, 0.02, 0.2], [0.07, 0.08, 0.05], C.black),
      sh('h3', 'sphere', [0.09, 0.02, 0.2], [0.07, 0.08, 0.05], C.black),
      sh('h4', 'box', [0, -0.16, 0.06], [0.2, 0.08, 0.16], C.bone),
    ] },
  ],
  torso: [
    { id: 'torso-slim', label: 'Slim', shapes: [sh('t1', 'capsule', [0, 0, 0], [0.34, 0.55, 0.26], SKIN)] },
    { id: 'torso-bulky', label: 'Bulky', shapes: [sh('t1', 'box', [0, 0, 0], [0.5, 0.6, 0.35], SKIN)] },
    { id: 'torso-round', label: 'Round', shapes: [sh('t1', 'sphere', [0, 0, 0], [0.4, 0.42, 0.36], SKIN)] },
    { id: 'torso-barrel', label: 'Barrel', shapes: [sh('t1', 'capsule', [0, 0, 0], [0.36, 0.5, 0.36], SKIN)] },
    { id: 'torso-hunched', label: 'Hunched', shapes: [
      sh('t1', 'sphere', [0, 0, 0], [0.4, 0.36, 0.34], SKIN),
      sh('t2', 'sphere', [0, 0.16, -0.08], [0.34, 0.3, 0.32], SKIN),
    ] },
    { id: 'torso-armored', label: 'Armored', shapes: [
      sh('t1', 'box', [0, 0, 0], [0.44, 0.56, 0.32], SKIN),
      sh('t2', 'box', [-0.28, 0.2, 0], [0.16, 0.2, 0.34], C.stoneDk),
      sh('t3', 'box', [0.28, 0.2, 0], [0.16, 0.2, 0.34], C.stoneDk),
    ] },
  ],
  tail: [
    { id: 'tail-stub', label: 'Stub', shapes: [sh('x1', 'sphere', [0, 0, -0.06], [0.12, 0.12, 0.14], SKIN)] },
    { id: 'tail-whip', label: 'Whip', shapes: [
      sh('x1', 'cone', [0, 0.04, -0.16], [0.09, 0.4, 0.09], SKIN, [-105, 0, 0]),
    ] },
    { id: 'tail-bushy', label: 'Bushy', shapes: [
      sh('x1', 'capsule', [0, 0.08, -0.18], [0.16, 0.34, 0.16], SKIN, [-70, 0, 0]),
    ] },
    { id: 'tail-spade', label: 'Spade', shapes: [
      sh('x1', 'cone', [0, 0.05, -0.2], [0.06, 0.42, 0.06], SKIN, [-115, 0, 0]),
      sh('x2', 'pyramid', [0, 0.2, -0.42], [0.14, 0.16, 0.06], SKIN, [-115, 0, 0]),
    ] },
    { id: 'tail-fan', label: 'Fan', shapes: [
      sh('x1', 'box', [0, 0.06, -0.14], [0.28, 0.04, 0.26], SKIN, [30, 0, 0]),
    ] },
  ],
  arm: [
    { id: 'arm-thin', label: 'Thin', shapes: [sh('a1', 'capsule', [0, -0.15, 0], [0.09, 0.34, 0.09], SKIN)] },
    { id: 'arm-clawed', label: 'Clawed', shapes: [
      sh('a1', 'capsule', [0, -0.14, 0], [0.1, 0.3, 0.1], SKIN),
      sh('a2', 'cone', [0, -0.32, 0], [0.09, 0.12, 0.09], C.white, [180, 0, 0]),
    ] },
    { id: 'arm-stubby', label: 'Stubby', shapes: [
      sh('a1', 'capsule', [0, -0.1, 0], [0.11, 0.22, 0.11], SKIN),
      sh('a2', 'sphere', [0, -0.22, 0], [0.1, 0.1, 0.1], SKIN),
    ] },
    { id: 'arm-bulky', label: 'Bulky', shapes: [
      sh('a1', 'box', [0, -0.18, 0], [0.18, 0.42, 0.18], SKIN),
      sh('a2', 'box', [0, -0.42, 0], [0.22, 0.18, 0.22], SKIN),
    ] },
    { id: 'arm-wing', label: 'Wing', shapes: [
      sh('a1', 'box', [-0.16, -0.02, 0], [0.4, 0.03, 0.3], SKIN, [0, 20, 35]),
    ] },
  ],
  leg: [
    { id: 'leg-thin', label: 'Thin', shapes: [sh('l1', 'capsule', [0, -0.16, 0], [0.1, 0.32, 0.1], SKIN)] },
    { id: 'leg-thick', label: 'Thick', shapes: [sh('l1', 'capsule', [0, -0.15, 0], [0.16, 0.3, 0.16], SKIN)] },
    { id: 'leg-paw', label: 'Paw', shapes: [
      sh('l1', 'capsule', [0, -0.14, 0], [0.12, 0.28, 0.12], SKIN),
      sh('l2', 'box', [0, -0.29, 0.05], [0.14, 0.07, 0.2], C.brownDk),
    ] },
    { id: 'leg-hoof', label: 'Hoof', shapes: [
      sh('l1', 'capsule', [0, -0.15, 0], [0.11, 0.3, 0.11], SKIN),
      sh('l2', 'cone', [0, -0.3, 0], [0.1, 0.1, 0.1], C.brownDk, [180, 0, 0]),
    ] },
    { id: 'leg-boxy', label: 'Boxy', shapes: [sh('l1', 'box', [0, -0.16, 0], [0.18, 0.32, 0.18], SKIN)] },
  ],
};

// ============================ BODY PRESETS ============================
// Complete starter creatures. Parts are sized/positioned to overlap into
// one silhouette (floating disconnected parts read as broken). For body
// plans that don't fit the humanoid/quadruped rigs (spiders, snakes),
// extra non-animated detail is packed into the torso slot.

// --- Placement helpers that make connection structural, not lucky ---
//
// CONNECTION RULES (enforced by `npm run check:prefabs`):
//  1. A limb slot's ANCHOR sits INSIDE the torso solid, not beside it. The
//     limb then grows outward from within the body, so it always overlaps.
//  2. Head details (eyes/ears/horns/noses) are placed on the head's actual
//     SURFACE via surf(), never at a hand-guessed offset — an eye at z=0.2
//     on a head of radius 0.14 floats in mid-air, which is exactly the bug
//     that shipped twice before the geometry-level checker existed.

/** A point on (or just inside) a sphere of radius R in direction `dir`. frac<1 sinks it into the surface so it overlaps. */
function surf(R, dir, frac = 0.95) {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const d = R * frac;
  return [(dir[0] / l) * d, (dir[1] / l) * d, (dir[2] / l) * d];
}
/** Mirrored eyes sitting on a spherical head of radius R (centre `c`), half-sunk into it. */
function eyesOn(R, dx, dy, dz, r, color, c = [0, 0, 0]) {
  const mk = (sx, id) => {
    const p = surf(R, [sx * dx, dy, dz], 0.95);
    return sh(id, 'sphere', [c[0] + p[0], c[1] + p[1], c[2] + p[2]], [r, r, r * 0.8], color);
  };
  return [mk(-1, 'eyeL'), mk(1, 'eyeR')];
}

export const BODY_PRESETS = [
  // 1. SLIME — a blobby double-bump body with a little face. No limbs.
  { id: 'body-slime', name: 'Slime', stance: 'humanoid', slots: [
    slot('torso', [0, 0.45, 0], [
      sh('b1', 'sphere', [0, 0, 0], [0.72, 0.55, 0.72], C.slime),
      sh('b2', 'sphere', [0.08, 0.22, 0.02], [0.42, 0.34, 0.42], C.slime),
      ...eyesOn(0.34, 0.5, 0.15, 1, 0.09, C.black),
      sh('mouth', 'box', [0, -0.06, 0.3], [0.16, 0.03, 0.06], C.black),
    ]),
  ] },

  // 2. GOBLIN — lanky green humanoid: snout+ears head, clawed arms.
  { id: 'body-goblin', name: 'Goblin', stance: 'humanoid', slots: [
    slot('torso', [0, 0.66, 0], [
      sh('t1', 'capsule', [0, 0, 0], [0.36, 0.52, 0.28], C.green),
      sh('belt', 'box', [0, -0.16, 0], [0.4, 0.08, 0.32], C.brownDk),
    ]),
    slot('head', [0, 1.0, 0], [
      sh('h1', 'sphere', [0, 0, 0], [0.3, 0.3, 0.3], C.green),
      sh('snout', 'box', [0, -0.05, 0.16], [0.16, 0.14, 0.2], C.green),
      sh('earL', 'pyramid', surf(0.15, [-1, 0.45, 0], 0.75), [0.08, 0.26, 0.06], C.green, [0, 0, 55]),
      sh('earR', 'pyramid', surf(0.15, [1, 0.45, 0], 0.75), [0.08, 0.26, 0.06], C.green, [0, 0, -55]),
      ...eyesOn(0.15, 0.5, 0.25, 1, 0.05, C.eyeRed),
    ]),
    slot('armL', [-0.11, 0.82, 0], humanoidArm(C.green)),
    slot('armR', [0.11, 0.82, 0], humanoidArm(C.green)),
    slot('legL', [-0.09, 0.46, 0], humanoidLeg(C.green)),
    slot('legR', [0.09, 0.46, 0], humanoidLeg(C.green)),
  ] },

  // 3. WOLF — quadruped: long body, angled snout, ears, whip tail, 4 paws.
  { id: 'body-wolf', name: 'Wolf', stance: 'quadruped', slots: [
    slot('torso', [0, 0.52, 0], [
      sh('body', 'box', [0, 0, 0], [0.34, 0.32, 0.82], C.gray),
      sh('hump', 'sphere', [0, 0.12, 0.2], [0.36, 0.32, 0.36], C.gray),
      sh('neck', 'box', [0, 0.06, 0.4], [0.24, 0.24, 0.24], C.gray),
      sh('rump', 'sphere', [0, 0.02, -0.34], [0.32, 0.3, 0.3], C.gray),
    ]),
    slot('head', [0, 0.64, 0.5], [
      sh('skull', 'box', [0, 0, 0], [0.26, 0.26, 0.3], C.gray),
      sh('snout', 'box', [0, -0.07, 0.2], [0.16, 0.13, 0.24], C.gray, [-6, 0, 0]),
      sh('nose', 'sphere', [0, -0.1, 0.31], [0.06, 0.05, 0.05], C.black),
      sh('earL', 'pyramid', [-0.1, 0.15, -0.02], [0.09, 0.18, 0.07], C.gray),
      sh('earR', 'pyramid', [0.1, 0.15, -0.02], [0.09, 0.18, 0.07], C.gray),
      sh('fangL', 'cone', [-0.05, -0.13, 0.26], [0.03, 0.07, 0.03], C.white, [175, 0, 0]),
      sh('fangR', 'cone', [0.05, -0.13, 0.26], [0.03, 0.07, 0.03], C.white, [175, 0, 0]),
      sh('eyeL', 'sphere', [-0.1, 0.05, 0.12], [0.04, 0.04, 0.03], C.eyeAmber),
      sh('eyeR', 'sphere', [0.1, 0.05, 0.12], [0.04, 0.04, 0.03], C.eyeAmber),
    ]),
    slot('tail', [0, 0.56, -0.34], [sh('x1', 'cone', [0, 0.04, -0.12], [0.09, 0.36, 0.09], C.gray, [-115, 0, 0])]),
    slot('legFrontL', [-0.13, 0.42, 0.3], quadLeg(C.gray)),
    slot('legFrontR', [0.13, 0.42, 0.3], quadLeg(C.gray)),
    slot('legBackL', [-0.13, 0.42, -0.3], quadLeg(C.gray)),
    slot('legBackR', [0.13, 0.42, -0.3], quadLeg(C.gray)),
  ] },

  // 4. SPIDER — bulbous 2-part body, fangs, eye cluster, 8 legs, all animated
  // (used to be 4 animated + 4 baked-into-the-torso static — see rig.js/
  // creatureTypeDefs.js's legMidFront*/legMidBack* roles).
  { id: 'body-spider', name: 'Spider', stance: 'quadruped', slots: [
    slot('torso', [0, 0.4, 0], [
      sh('cephalo', 'sphere', [0, 0, 0.16], [0.36, 0.3, 0.36], C.grayDk),
      sh('abdomen', 'sphere', [0, 0.05, -0.2], [0.46, 0.42, 0.46], C.grayDk),
      sh('fangL', 'cone', [-0.06, -0.09, 0.26], [0.04, 0.11, 0.04], C.white, [150, 0, 0]),
      sh('fangR', 'cone', [0.06, -0.09, 0.26], [0.04, 0.11, 0.04], C.white, [150, 0, 0]),
      // eyes ride the cephalothorax sphere (centre z=0.16, r≈0.16)
      ...eyesOn(0.16, 0.4, 0.5, 1, 0.045, C.eyeRed, [0, 0, 0.16]).map((s, i) => ({ ...s, id: `e${i + 1}` })),
      ...eyesOn(0.16, 0.9, 0.2, 1, 0.035, C.eyeRed, [0, 0, 0.16]).map((s, i) => ({ ...s, id: `e${i + 3}` })),
    ]),
    slot('legFrontL', [-0.1, 0.4, 0.14], spiderLeg(-1, [0, 25, 58])),
    slot('legFrontR', [0.1, 0.4, 0.14], spiderLeg(1, [0, -25, -58])),
    slot('legMidFrontL', [-0.12, 0.4, 0.02], spiderLeg(-1, [0, 20, 62])),
    slot('legMidFrontR', [0.12, 0.4, 0.02], spiderLeg(1, [0, -20, -62])),
    slot('legMidBackL', [-0.12, 0.4, -0.16], spiderLeg(-1, [0, -18, 62])),
    slot('legMidBackR', [0.12, 0.4, -0.16], spiderLeg(1, [0, 18, -62])),
    slot('legBackL', [-0.1, 0.4, -0.1], spiderLeg(-1, [0, -25, 58])),
    slot('legBackR', [0.1, 0.4, -0.1], spiderLeg(1, [0, 25, -58])),
  ] },

  // 5. GNOME — round belly, bulbous nose, big pointy hat + beard.
  { id: 'body-gnome', name: 'Gnome', stance: 'humanoid', slots: [
    slot('torso', [0, 0.6, 0], [
      sh('belly', 'capsule', [0, 0, 0], [0.36, 0.44, 0.34], C.blue),
      sh('belt', 'box', [0, -0.13, 0], [0.4, 0.07, 0.38], C.brownDk),
    ]),
    slot('head', [0, 0.94, 0], [
      sh('h1', 'sphere', [0, 0, 0], [0.28, 0.26, 0.28], 0xe8b890),
      sh('nose', 'sphere', surf(0.14, [0, -0.2, 1], 0.95), [0.1, 0.09, 0.12], 0xe8b890),
      sh('beard', 'cone', [0, -0.16, 0.06], [0.24, 0.3, 0.16], C.white, [180, 0, 0]),
      sh('hat', 'cone', [0, 0.3, 0], [0.36, 0.56, 0.36], C.red),
      ...eyesOn(0.14, 0.5, 0.2, 1, 0.03, C.black),
    ]),
    slot('armL', [-0.11, 0.72, 0], armStub(C.blue)),
    slot('armR', [0.11, 0.72, 0], armStub(C.blue)),
    slot('legL', [-0.09, 0.44, 0], humanoidLeg(0x5a3a2a, C.brownDk)),
    slot('legR', [0.09, 0.44, 0], humanoidLeg(0x5a3a2a, C.brownDk)),
  ] },

  // 6. BAT — small furry body, big-eared head, membrane wings for arms.
  { id: 'body-bat', name: 'Bat', stance: 'humanoid', slots: [
    slot('torso', [0, 0.6, 0], [sh('t1', 'capsule', [0, 0, 0], [0.26, 0.36, 0.24], C.purpleDk)]),
    slot('head', [0, 0.82, 0], [
      sh('h1', 'sphere', [0, 0, 0], [0.22, 0.2, 0.22], C.purpleDk),
      sh('earL', 'pyramid', surf(0.11, [-0.8, 1, 0], 0.7), [0.1, 0.26, 0.06], C.purpleDk, [0, 0, 14]),
      sh('earR', 'pyramid', surf(0.11, [0.8, 1, 0], 0.7), [0.1, 0.26, 0.06], C.purpleDk, [0, 0, -14]),
      sh('snout', 'sphere', surf(0.11, [0, -0.3, 1], 0.9), [0.1, 0.09, 0.1], 0x6a5a6a),
      sh('fangL', 'cone', [-0.035, -0.06, 0.09], [0.025, 0.06, 0.025], C.white, [180, 0, 0]),
      sh('fangR', 'cone', [0.035, -0.06, 0.09], [0.025, 0.06, 0.025], C.white, [180, 0, 0]),
      ...eyesOn(0.11, 0.55, 0.2, 1, 0.03, C.eyeRed),
    ]),
    slot('armL', [-0.07, 0.68, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], C.purpleDk),
      sh('wing', 'box', [-0.2, -0.02, 0], [0.44, 0.03, 0.32], 0x5a4a5a, [4, 22, 34]),
    ]),
    slot('armR', [0.07, 0.68, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], C.purpleDk),
      sh('wing', 'box', [0.2, -0.02, 0], [0.44, 0.03, 0.32], 0x5a4a5a, [4, -22, -34]),
    ]),
    slot('legL', [-0.06, 0.47, 0], [sh('l1', 'capsule', [0, -0.14, 0], [0.05, 0.3, 0.05], C.purpleDk)]),
    slot('legR', [0.06, 0.47, 0], [sh('l1', 'capsule', [0, -0.14, 0], [0.05, 0.3, 0.05], C.purpleDk)]),
  ] },

  // 7. GOLEM — bulky stone humanoid, glowing eyes, blocky fists.
  { id: 'body-golem', name: 'Golem', stance: 'humanoid', slots: [
    slot('torso', [0, 0.72, 0], [
      sh('body', 'box', [0, 0, 0], [0.6, 0.66, 0.42], C.stone),
      sh('shL', 'box', [-0.36, 0.26, 0], [0.2, 0.24, 0.36], C.stone),
      sh('shR', 'box', [0.36, 0.26, 0], [0.2, 0.24, 0.36], C.stone),
      sh('crack', 'box', [0, -0.05, 0.2], [0.06, 0.4, 0.02], C.stoneDk),
    ]),
    slot('head', [0, 1.16, 0], [
      sh('h1', 'box', [0, 0, 0], [0.32, 0.3, 0.3], C.stone),
      sh('spL', 'cone', [-0.1, 0.18, 0], [0.06, 0.14, 0.06], C.stoneDk),
      sh('spR', 'cone', [0.1, 0.18, 0], [0.06, 0.14, 0.06], C.stoneDk),
      sh('eyeL', 'box', [-0.09, 0.02, 0.13], [0.06, 0.04, 0.04], C.glow),
      sh('eyeR', 'box', [0.09, 0.02, 0.13], [0.06, 0.04, 0.04], C.glow),
    ]),
    slot('armL', [-0.34, 0.9, 0], armBulk(C.stone)),
    slot('armR', [0.34, 0.9, 0], armBulk(C.stone)),
    slot('legL', [-0.18, 0.46, 0], legThickBox(C.stone)),
    slot('legR', [0.18, 0.46, 0], legThickBox(C.stone)),
  ] },

  // 8. SKELETON — bony white humanoid, hollow-eyed skull, thin limbs.
  { id: 'body-skeleton', name: 'Skeleton', stance: 'humanoid', slots: [
    slot('torso', [0, 0.65, 0], [
      sh('spine', 'box', [0, 0, 0], [0.08, 0.52, 0.08], C.bone),
      sh('rib1', 'box', [0, 0.12, 0.02], [0.34, 0.07, 0.2], C.bone),
      sh('rib2', 'box', [0, 0.01, 0.02], [0.3, 0.07, 0.19], C.bone),
      sh('rib3', 'box', [0, -0.1, 0.02], [0.24, 0.07, 0.17], C.bone),
      sh('pelvis', 'box', [0, -0.22, 0], [0.28, 0.12, 0.18], C.bone),
    ]),
    slot('head', [0, 1.0, 0], [
      sh('skull', 'sphere', [0, 0.02, 0], [0.26, 0.28, 0.26], C.bone),
      sh('sockL', 'sphere', surf(0.13, [-0.55, 0.1, 1], 0.92), [0.06, 0.07, 0.05], C.black),
      sh('sockR', 'sphere', surf(0.13, [0.55, 0.1, 1], 0.92), [0.06, 0.07, 0.05], C.black),
      sh('jaw', 'box', [0, -0.14, 0.04], [0.2, 0.08, 0.16], C.bone),
      sh('teeth', 'box', [0, -0.1, 0.1], [0.16, 0.04, 0.04], C.white),
    ]),
    slot('armL', [-0.12, 0.78, 0.02], boneLimb()),
    slot('armR', [0.12, 0.78, 0.02], boneLimb()),
    slot('legL', [-0.1, 0.44, 0], boneLimb()),
    slot('legR', [0.1, 0.44, 0], boneLimb()),
  ] },

  // 9. SERPENT — coiled rising body of stacked spheres, fanged head. No limbs.
  { id: 'body-serpent', name: 'Serpent', stance: 'humanoid', slots: [
    slot('torso', [0, 0.32, 0], [
      sh('c1', 'sphere', [0, 0, -0.18], [0.34, 0.3, 0.34], C.greenDk),
      sh('c2', 'sphere', [0, 0.14, -0.02], [0.3, 0.28, 0.3], C.green),
      sh('c3', 'sphere', [0.02, 0.3, 0.1], [0.26, 0.26, 0.26], C.green),
      sh('c4', 'sphere', [0.05, 0.46, 0.2], [0.22, 0.24, 0.22], C.green),
      sh('c5', 'sphere', [0.07, 0.6, 0.28], [0.2, 0.22, 0.2], C.green),
    ]),
    slot('head', [0.08, 0.76, 0.36], [
      sh('h1', 'sphere', [0, 0, 0], [0.21, 0.18, 0.24], C.green),
      sh('snout', 'box', [0, -0.02, 0.11], [0.16, 0.13, 0.14], C.green),
      sh('fangL', 'cone', [-0.05, -0.08, 0.13], [0.03, 0.08, 0.03], C.white, [160, 0, 0]),
      sh('fangR', 'cone', [0.05, -0.08, 0.13], [0.03, 0.08, 0.03], C.white, [160, 0, 0]),
      sh('tongue', 'box', [0, -0.04, 0.2], [0.02, 0.02, 0.12], C.eyeRed),
      sh('eyeL', 'sphere', [-0.08, 0.05, 0.06], [0.05, 0.05, 0.04], C.eyeYellow),
      sh('eyeR', 'sphere', [0.08, 0.05, 0.06], [0.05, 0.05, 0.04], C.eyeYellow),
    ]),
  ] },

  // 10. BIRD — plump body, beaked head, folded wings, fan tail, thin legs.
  { id: 'body-bird', name: 'Bird', stance: 'humanoid', slots: [
    slot('torso', [0, 0.55, 0], [
      sh('body', 'sphere', [0, 0, 0], [0.3, 0.38, 0.34], C.blueBird),
      sh('belly', 'sphere', [0, -0.06, 0.12], [0.22, 0.24, 0.18], 0xd8d8ec),
    ]),
    slot('head', [0, 0.82, 0.02], [
      sh('h1', 'sphere', [0, 0, 0], [0.22, 0.22, 0.22], C.blueBird),
      sh('beak', 'cone', [0, -0.02, 0.14], [0.1, 0.18, 0.1], C.orange, [90, 0, 0]),
      ...eyesOn(0.11, 0.6, 0.35, 1, 0.04, C.black),
    ]),
    slot('tail', [0, 0.5, -0.12], [sh('fan', 'box', [0, 0.06, -0.14], [0.26, 0.03, 0.28], C.blueBird, [28, 0, 0])]),
    slot('armL', [-0.11, 0.58, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.1, 0.1, 0.1], C.blueBird),
      sh('wing', 'box', [-0.06, -0.04, 0], [0.14, 0.03, 0.36], C.blueBird, [0, 8, 22]),
    ]),
    slot('armR', [0.11, 0.58, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.1, 0.1, 0.1], C.blueBird),
      sh('wing', 'box', [0.06, -0.04, 0], [0.14, 0.03, 0.36], C.blueBird, [0, -8, -22]),
    ]),
    slot('legL', [-0.08, 0.4, 0], birdLeg()),
    slot('legR', [0.08, 0.4, 0], birdLeg()),
  ] },

  // 11. RAT — low body, pointy pink-nosed snout, big round ears, long tail.
  { id: 'body-rat', name: 'Rat', stance: 'quadruped', slots: [
    slot('torso', [0, 0.26, 0], [
      sh('body', 'sphere', [0, 0, -0.04], [0.32, 0.28, 0.56], C.fur),
    ]),
    slot('head', [0, 0.3, 0.26], [
      sh('h1', 'sphere', [0, 0, 0], [0.2, 0.18, 0.2], C.fur),
      sh('snout', 'cone', [0, -0.03, 0.1], [0.12, 0.18, 0.1], C.fur, [90, 0, 0]),
      sh('nose', 'sphere', [0, -0.03, 0.19], [0.04, 0.04, 0.04], C.pink),
      sh('earL', 'sphere', surf(0.1, [-1, 1.1, -0.2], 0.8), [0.13, 0.13, 0.04], C.pink),
      sh('earR', 'sphere', surf(0.1, [1, 1.1, -0.2], 0.8), [0.13, 0.13, 0.04], C.pink),
      ...eyesOn(0.1, 0.7, 0.25, 1, 0.035, C.black),
    ]),
    slot('tail', [0, 0.28, -0.24], [sh('x1', 'cone', [0, 0.02, -0.22], [0.04, 0.6, 0.04], C.pink, [-98, 0, 0])]),
    slot('legFrontL', [-0.1, 0.2, 0.16], ratLeg()),
    slot('legFrontR', [0.1, 0.2, 0.16], ratLeg()),
    slot('legBackL', [-0.1, 0.2, -0.16], ratLeg()),
    slot('legBackR', [0.1, 0.2, -0.16], ratLeg()),
  ] },

  // 12. BEAR — big bulky brown quadruped, round snouted head, thick legs.
  { id: 'body-bear', name: 'Bear', stance: 'quadruped', slots: [
    slot('torso', [0, 0.52, 0], [
      sh('body', 'box', [0, 0, 0], [0.5, 0.44, 0.82], C.brown),
      sh('hump', 'sphere', [0, 0.14, 0.24], [0.46, 0.34, 0.42], C.brown),
    ]),
    slot('head', [0, 0.6, 0.44], [
      sh('h1', 'sphere', [0, 0, 0], [0.3, 0.28, 0.3], C.brown),
      sh('snout', 'box', [0, -0.06, 0.16], [0.18, 0.16, 0.2], C.brownLt),
      sh('nose', 'sphere', [0, -0.05, 0.26], [0.07, 0.06, 0.06], C.black),
      sh('earL', 'sphere', surf(0.15, [-1, 1, -0.1], 0.85), [0.1, 0.1, 0.06], C.brown),
      sh('earR', 'sphere', surf(0.15, [1, 1, -0.1], 0.85), [0.1, 0.1, 0.06], C.brown),
      ...eyesOn(0.15, 0.55, 0.3, 1, 0.04, C.black),
    ]),
    slot('tail', [0, 0.5, -0.36], [sh('x1', 'sphere', [0, 0.02, -0.05], [0.09, 0.09, 0.09], C.brown)]),
    slot('legFrontL', [-0.18, 0.42, 0.3], legThickPaw(C.brown)),
    slot('legFrontR', [0.18, 0.42, 0.3], legThickPaw(C.brown)),
    slot('legBackL', [-0.18, 0.42, -0.3], legThickPaw(C.brown)),
    slot('legBackR', [0.18, 0.42, -0.3], legThickPaw(C.brown)),
  ] },

  // 13. MYCONID — mushroom-folk: cream stem body, big red spotted cap.
  { id: 'body-myconid', name: 'Myconid', stance: 'humanoid', slots: [
    slot('torso', [0, 0.6, 0], [
      sh('stem', 'cylinder', [0, 0, 0], [0.24, 0.5, 0.24], C.cream),
      sh('eyeL', 'sphere', [-0.06, 0.28, 0.1], [0.04, 0.05, 0.03], C.black),
      sh('eyeR', 'sphere', [0.06, 0.28, 0.1], [0.04, 0.05, 0.03], C.black),
    ]),
    slot('head', [0, 0.9, 0], [
      sh('cap', 'sphere', [0, 0.02, 0], [0.52, 0.42, 0.52], C.mushroom),
      sh('sp1', 'sphere', [-0.14, 0.14, 0.08], [0.08, 0.04, 0.08], C.white),
      sh('sp2', 'sphere', [0.16, 0.11, -0.05], [0.09, 0.04, 0.09], C.white),
      sh('sp3', 'sphere', [0.02, 0.18, 0.13], [0.07, 0.04, 0.07], C.white),
    ]),
    slot('armL', [-0.09, 0.7, 0], armStub(C.cream)),
    slot('armR', [0.09, 0.7, 0], armStub(C.cream)),
    slot('legL', [-0.08, 0.4, 0], [sh('l1', 'capsule', [0, -0.2, 0], [0.09, 0.44, 0.09], C.cream)]),
    slot('legR', [0.08, 0.4, 0], [sh('l1', 'capsule', [0, -0.2, 0], [0.09, 0.44, 0.09], C.cream)]),
  ] },

  // 14. IMP — small red horned demon, clawed arms, spade tail.
  { id: 'body-imp', name: 'Imp', stance: 'humanoid', slots: [
    slot('torso', [0, 0.66, 0], [sh('t1', 'capsule', [0, 0, 0], [0.32, 0.48, 0.26], C.red)]),
    slot('head', [0, 1.02, 0], [
      sh('h1', 'sphere', [0, 0, 0], [0.28, 0.28, 0.28], C.red),
      sh('hornL', 'cone', surf(0.14, [-0.55, 1, -0.3], 0.8), [0.06, 0.2, 0.06], C.redDk, [-25, 0, 12]),
      sh('hornR', 'cone', surf(0.14, [0.55, 1, -0.3], 0.8), [0.06, 0.2, 0.06], C.redDk, [-25, 0, -12]),
      sh('snout', 'sphere', surf(0.14, [0, -0.25, 1], 0.92), [0.1, 0.09, 0.1], C.red),
      sh('grin', 'box', [0, -0.09, 0.12], [0.14, 0.03, 0.05], C.redDk),
      ...eyesOn(0.14, 0.55, 0.2, 1, 0.05, C.eyeYellow),
    ]),
    slot('tail', [0, 0.56, -0.08], [
      sh('x1', 'cone', [0, 0.05, -0.16], [0.06, 0.36, 0.06], C.red, [-120, 0, 0]),
      sh('tip', 'pyramid', [0, -0.02, -0.29], [0.12, 0.14, 0.05], C.redDk, [-120, 0, 0]),
    ]),
    slot('armL', [-0.09, 0.82, 0], humanoidArm(C.red)),
    slot('armR', [0.09, 0.82, 0], humanoidArm(C.red)),
    slot('legL', [-0.08, 0.5, 0], humanoidLeg(C.red, C.redDk)),
    slot('legR', [0.08, 0.5, 0], humanoidLeg(C.red, C.redDk)),
  ] },

  // 15. LADYBUG — small red-domed body with black spots, antennae, 6 thin
  // legs (uses the legMidFrontL/R roles alongside legFrontL/R + legBackL/R).
  { id: 'body-ladybug', name: 'Ladybug', stance: 'quadruped', slots: [
    slot('torso', [0, 0.14, 0], [
      sh('shell', 'sphere', [0, 0, 0], [0.3, 0.2, 0.34], C.ladybugRed),
      sh('seam', 'box', [0, 0.07, 0], [0.018, 0.15, 0.289], C.black),
      sh('spot1', 'sphere', [-0.0687, 0.0625, 0.0779], [0.055, 0.05, 0.055], C.black),
      sh('spot2', 'sphere', [0.0687, 0.0625, 0.0779], [0.055, 0.05, 0.055], C.black),
      sh('spot3', 'sphere', [-0.0988, 0.0517, -0.056], [0.055, 0.05, 0.055], C.black),
      sh('spot4', 'sphere', [0.0988, 0.0517, -0.056], [0.055, 0.05, 0.055], C.black),
      sh('spot5', 'sphere', [0.0, 0.0617, -0.1114], [0.055, 0.05, 0.055], C.black),
    ]),
    slot('head', [0, 0.1482, 0.115], [
      sh('headball', 'sphere', [0, 0, 0], [0.09, 0.081, 0.09], C.black),
      sh('antL', 'cylinder', [-0.03, 0.05, 0.02], [0.008, 0.07, 0.008], C.black, [-55, 0, 20]),
      sh('antR', 'cylinder', [0.03, 0.05, 0.02], [0.008, 0.07, 0.008], C.black, [-55, 0, -20]),
    ]),
    slot('legFrontL', [-0.0928, 0.1182, 0.0618], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [-0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, -45]),
    ]),
    slot('legFrontR', [0.0928, 0.1182, 0.0618], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, 45]),
    ]),
    slot('legMidFrontL', [-0.1076, 0.1185, 0.0061], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [-0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, -45]),
    ]),
    slot('legMidFrontR', [0.1076, 0.1185, 0.0061], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, 45]),
    ]),
    slot('legBackL', [-0.0883, 0.1192, -0.0706], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [-0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, -45]),
    ]),
    slot('legBackR', [0.0883, 0.1192, -0.0706], [
      sh('hip', 'sphere', [0, 0, 0], [0.07, 0.07, 0.07], C.black),
      sh('l1', 'capsule', [0.035, -0.075, 0], [0.014, 0.15, 0.014], C.black, [0, 0, 45]),
    ]),
  ] },

  // 16. FOX — bushy tail, pointed ears, standard 4 legs.
  { id: 'body-fox', name: 'Fox', stance: 'quadruped', slots: [
    slot('torso', [0, 0.34, 0], [
      sh('body', 'box', [0, 0, 0], [0.22, 0.2, 0.5], 14251822),
      sh('chest', 'sphere', [0, 0.04, 0.24], [0.22, 0.2, 0.22], 14251822),
      sh('rump', 'sphere', [0, 0.02, -0.23], [0.2, 0.19, 0.2], 14251822),
      sh('belly', 'box', [0, -0.09, 0], [0.16, 0.06, 0.4], 15788248),
    ]),
    slot('head', [0, 0.42, 0.34], [
      sh('skull', 'box', [0, 0, 0], [0.17, 0.16, 0.18], 14251822),
      sh('snout', 'box', [0, -0.05, 0.12], [0.09, 0.08, 0.14], 14251822),
      sh('nose', 'sphere', [0, -0.07, 0.19], [0.045, 0.04, 0.045], C.black),
      sh('earL', 'pyramid', [-0.07, 0.12, -0.02], [0.07, 0.13, 0.06], 14251822),
      sh('earR', 'pyramid', [0.07, 0.12, -0.02], [0.07, 0.13, 0.06], 14251822),
      sh('eyeL', 'sphere', [-0.06, 0.02, 0.1], [0.028, 0.028, 0.022], C.eyeAmber),
      sh('eyeR', 'sphere', [0.06, 0.02, 0.1], [0.028, 0.028, 0.022], C.eyeAmber),
    ]),
    slot('tail', [0, 0.38, -0.34], [
      sh('x1', 'cone', [0, 0.03, -0.11], [0.1, 0.34, 0.1], 14251822, [-100, 0, 0]),
      sh('tip', 'sphere', [0, -0.02, -0.25], [0.11, 0.11, 0.11], 15788248),
    ]),
    slot('legFrontL', [-0.09, 0.24, 0.18], [
      sh('hip', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 14251822),
      sh('l1', 'box', [0, -0.09, 0], [0.075, 0.19, 0.075], 14251822),
      sh('paw', 'box', [0, -0.19, 0.02], [0.085, 0.045, 0.1], C.black),
    ]),
    slot('legFrontR', [0.09, 0.24, 0.18], [
      sh('hip', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 14251822),
      sh('l1', 'box', [0, -0.09, 0], [0.075, 0.19, 0.075], 14251822),
      sh('paw', 'box', [0, -0.19, 0.02], [0.085, 0.045, 0.1], C.black),
    ]),
    slot('legBackL', [-0.09, 0.24, -0.18], [
      sh('hip', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 14251822),
      sh('l1', 'box', [0, -0.09, 0], [0.075, 0.19, 0.075], 14251822),
      sh('paw', 'box', [0, -0.19, 0.02], [0.085, 0.045, 0.1], C.black),
    ]),
    slot('legBackR', [0.09, 0.24, -0.18], [
      sh('hip', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 14251822),
      sh('l1', 'box', [0, -0.09, 0], [0.075, 0.19, 0.075], 14251822),
      sh('paw', 'box', [0, -0.19, 0.02], [0.085, 0.045, 0.1], C.black),
    ]),
  ] },

  // 17. OWL — facial disc, big eyes, ear tufts, wings + thin legs.
  { id: 'body-owl', name: 'Owl', stance: 'humanoid', slots: [
    slot('torso', [0, 0.55, 0], [
      sh('body', 'sphere', [0, 0, 0], [0.3, 0.38, 0.34], 7031338),
      sh('belly', 'sphere', [0, -0.06, 0.12], [0.22, 0.24, 0.18], 15260864),
    ]),
    slot('head', [0, 0.82, 0.02], [
      sh('h1', 'sphere', [0, 0, 0], [0.22, 0.22, 0.22], 7031338),
      sh('faceDisc', 'sphere', [0, -0.01, 0.06], [0.19, 0.17, 0.1], 15260864),
      sh('beak', 'cone', [0, -0.03, 0.13], [0.07, 0.13, 0.07], 4864554, [90, 0, 0]),
      sh('eyeL', 'sphere', [-0.0463, 0.0139, 0.0926], [0.075, 0.075, 0.06], C.eyeYellow),
      sh('eyeR', 'sphere', [0.0463, 0.0139, 0.0926], [0.075, 0.075, 0.06], C.eyeYellow),
      sh('pupilL', 'sphere', [-0.0512, 0.0154, 0.1024], [0.028, 0.028, 0.022], C.black),
      sh('pupilR', 'sphere', [0.0512, 0.0154, 0.1024], [0.028, 0.028, 0.022], C.black),
      sh('tuftL', 'pyramid', [-0.044, 0.08, -0.02], [0.05, 0.1, 0.045], 4862488, [-15, 0, 15]),
      sh('tuftR', 'pyramid', [0.044, 0.08, -0.02], [0.05, 0.1, 0.045], 4862488, [-15, 0, -15]),
    ]),
    slot('tail', [0, 0.5, -0.12], [
      sh('fan', 'box', [0, 0.06, -0.14], [0.26, 0.03, 0.28], 7031338, [28, 0, 0]),
    ]),
    slot('armL', [-0.11, 0.58, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.1, 0.1, 0.1], 7031338),
      sh('wing', 'box', [-0.06, -0.04, 0], [0.14, 0.03, 0.36], 7031338, [0, 8, 22]),
    ]),
    slot('armR', [0.11, 0.58, 0], [
      sh('sh', 'sphere', [0, 0, 0], [0.1, 0.1, 0.1], 7031338),
      sh('wing', 'box', [0.06, -0.04, 0], [0.14, 0.03, 0.36], 7031338, [0, -8, -22]),
    ]),
    slot('legL', [-0.08, 0.4, 0], [
      sh('hip', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], 7031338),
      sh('l1', 'capsule', [0, -0.2, 0], [0.04, 0.4, 0.04], 7031338),
      sh('foot', 'box', [0, -0.38, 0.04], [0.1, 0.03, 0.14], 9078136),
    ]),
    slot('legR', [0.08, 0.4, 0], [
      sh('hip', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], 7031338),
      sh('l1', 'capsule', [0, -0.2, 0], [0.04, 0.4, 0.04], 7031338),
      sh('foot', 'box', [0, -0.38, 0.04], [0.1, 0.03, 0.14], 9078136),
    ]),
  ] },

  // 18. FOREST SPIDER — woodland-colored variant of the 8-legged Spider body.
  { id: 'body-forest-spider', name: 'Forest Spider', stance: 'quadruped', slots: [
    slot('torso', [0, 0.34, 0], [
      sh('cephalo', 'sphere', [0, 0, 0.14], [0.3, 0.25, 0.3], 4862488),
      sh('abdomen', 'sphere', [0, 0.04, -0.17], [0.39, 0.35, 0.39], 7031338),
      sh('fangL', 'cone', [-0.05, -0.08, 0.22], [0.035, 0.09, 0.035], C.white, [150, 0, 0]),
      sh('fangR', 'cone', [0.05, -0.08, 0.22], [0.035, 0.09, 0.035], C.white, [150, 0, 0]),
      sh('eyeL', 'sphere', [-0.06, 0.08, 0.24], [0.035, 0.035, 0.028], C.eyeRed),
      sh('eyeR', 'sphere', [0.06, 0.08, 0.24], [0.035, 0.035, 0.028], C.eyeRed),
      sh('eyeML', 'sphere', [-0.03, 0.05, 0.26], [0.025, 0.025, 0.02], C.eyeRed),
      sh('eyeMR', 'sphere', [0.03, 0.05, 0.26], [0.025, 0.025, 0.02], C.eyeRed),
    ]),
    slot('legFrontL', [-0.085, 0.34, 0.12], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [-0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, 25, 58]),
    ]),
    slot('legFrontR', [0.085, 0.34, 0.12], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, -25, -58]),
    ]),
    slot('legMidFrontL', [-0.1, 0.34, 0.02], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [-0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, 20, 62]),
    ]),
    slot('legMidFrontR', [0.1, 0.34, 0.02], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, -20, -62]),
    ]),
    slot('legMidBackL', [-0.1, 0.34, -0.14], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [-0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, -18, 62]),
    ]),
    slot('legMidBackR', [0.1, 0.34, -0.14], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, 18, -62]),
    ]),
    slot('legBackL', [-0.085, 0.34, -0.09], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [-0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, -25, 58]),
    ]),
    slot('legBackR', [0.085, 0.34, -0.09], [
      sh('joint', 'sphere', [0, 0, 0], [0.11, 0.11, 0.11], 4862488),
      sh('l1', 'capsule', [0.07, -0.04, 0], [0.042, 0.46, 0.042], 4862488, [0, 25, -58]),
    ]),
  ] },

  // 19. DEER — antlers, slender legs, quiet forest grazer.
  { id: 'body-deer', name: 'Deer', stance: 'quadruped', slots: [
    slot('torso', [0, 0.56, 0], [
      sh('body', 'box', [0, 0, 0], [0.26, 0.28, 0.7], 10119738),
      sh('neck', 'box', [0, 0.08, 0.32], [0.2, 0.22, 0.22], 10119738),
      sh('rump', 'sphere', [0, 0.03, -0.3], [0.26, 0.24, 0.26], 10119738),
      sh('belly', 'box', [0, -0.1, 0], [0.16, 0.05, 0.5], 15260864),
    ]),
    slot('head', [0, 0.68, 0.42], [
      sh('skull', 'box', [0, 0, 0], [0.16, 0.16, 0.2], 10119738),
      sh('snout', 'box', [0, -0.06, 0.13], [0.09, 0.09, 0.14], 12619872),
      sh('nose', 'sphere', [0, -0.09, 0.2], [0.045, 0.038, 0.045], C.black),
      sh('earL', 'pyramid', [-0.1, 0.1, -0.02], [0.07, 0.12, 0.06], 10119738, [0, 0, -20]),
      sh('earR', 'pyramid', [0.1, 0.1, -0.02], [0.07, 0.12, 0.06], 10119738, [0, 0, 20]),
      sh('eyeL', 'sphere', [-0.08, 0.02, 0.09], [0.028, 0.028, 0.022], C.black),
      sh('eyeR', 'sphere', [0.08, 0.02, 0.09], [0.028, 0.028, 0.022], C.black),
      sh('antlerL1', 'cone', [-0.08, 0.14, -0.03], [0.028, 0.3, 0.028], 12097648, [165, 0, -15]),
      sh('antlerR1', 'cone', [0.08, 0.14, -0.03], [0.028, 0.3, 0.028], 12097648, [165, 0, 15]),
    ]),
    slot('tail', [0, 0.6, -0.42], [
      sh('t1', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], 15260864),
    ]),
    slot('legFrontL', [-0.12, 0.42, 0.24], [
      sh('hip', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], 10119738),
      sh('l1', 'box', [0, -0.22, 0], [0.11, 0.46, 0.11], 10119738),
      sh('hoof', 'box', [0, -0.41, 0.03], [0.13, 0.07, 0.17], C.black),
    ]),
    slot('legFrontR', [0.12, 0.42, 0.24], [
      sh('hip', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], 10119738),
      sh('l1', 'box', [0, -0.22, 0], [0.11, 0.46, 0.11], 10119738),
      sh('hoof', 'box', [0, -0.41, 0.03], [0.13, 0.07, 0.17], C.black),
    ]),
    slot('legBackL', [-0.12, 0.42, -0.24], [
      sh('hip', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], 10119738),
      sh('l1', 'box', [0, -0.22, 0], [0.11, 0.46, 0.11], 10119738),
      sh('hoof', 'box', [0, -0.41, 0.03], [0.13, 0.07, 0.17], C.black),
    ]),
    slot('legBackR', [0.12, 0.42, -0.24], [
      sh('hip', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], 10119738),
      sh('l1', 'box', [0, -0.22, 0], [0.11, 0.46, 0.11], 10119738),
      sh('hoof', 'box', [0, -0.41, 0.03], [0.13, 0.07, 0.17], C.black),
    ]),
  ] },

  // 20. WILD BOAR — stocky body, tusks, low aggressive stance.
  { id: 'body-wild-boar', name: 'Wild Boar', stance: 'quadruped', slots: [
    slot('torso', [0, 0.46, 0], [
      sh('body', 'box', [0, 0, 0], [0.34, 0.32, 0.6], 5919304),
      sh('hump', 'sphere', [0, 0.13, 0.14], [0.36, 0.3, 0.34], 5919304),
      sh('neck', 'box', [0, 0.02, 0.3], [0.24, 0.22, 0.2], 5919304),
      sh('rump', 'sphere', [0, -0.02, -0.26], [0.32, 0.26, 0.28], 3814440),
    ]),
    slot('head', [0, 0.52, 0.4], [
      sh('skull', 'box', [0, 0, 0], [0.24, 0.2, 0.24], 5919304),
      sh('snout', 'box', [0, -0.07, 0.16], [0.15, 0.11, 0.16], 3814440),
      sh('nose', 'sphere', [0, -0.1, 0.25], [0.07, 0.05, 0.05], C.black),
      sh('earL', 'pyramid', [-0.1, 0.12, -0.03], [0.08, 0.13, 0.07], 3814440),
      sh('earR', 'pyramid', [0.1, 0.12, -0.03], [0.08, 0.13, 0.07], 3814440),
      sh('eyeL', 'sphere', [-0.09, 0.04, 0.08], [0.03, 0.03, 0.025], C.eyeRed),
      sh('eyeR', 'sphere', [0.09, 0.04, 0.08], [0.03, 0.03, 0.025], C.eyeRed),
      sh('tuskL', 'cone', [-0.07, -0.12, 0.22], [0.03, 0.1, 0.03], 15261896, [130, 0, -20]),
      sh('tuskR', 'cone', [0.07, -0.12, 0.22], [0.03, 0.1, 0.03], 15261896, [130, 0, 20]),
    ]),
    slot('tail', [0, 0.5, -0.3], [
      sh('x1', 'cylinder', [0, 0.02, -0.06], [0.025, 0.16, 0.025], 3814440, [-60, 0, 0]),
    ]),
    slot('legFrontL', [-0.14, 0.32, 0.2], [
      sh('hip', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], 5919304),
      sh('l1', 'box', [0, -0.16, 0], [0.1, 0.34, 0.1], 5919304),
      sh('hoof', 'box', [0, -0.31, 0.02], [0.11, 0.06, 0.14], 3814440),
    ]),
    slot('legFrontR', [0.14, 0.32, 0.2], [
      sh('hip', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], 5919304),
      sh('l1', 'box', [0, -0.16, 0], [0.1, 0.34, 0.1], 5919304),
      sh('hoof', 'box', [0, -0.31, 0.02], [0.11, 0.06, 0.14], 3814440),
    ]),
    slot('legBackL', [-0.14, 0.32, -0.2], [
      sh('hip', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], 5919304),
      sh('l1', 'box', [0, -0.16, 0], [0.1, 0.34, 0.1], 5919304),
      sh('hoof', 'box', [0, -0.31, 0.02], [0.11, 0.06, 0.14], 3814440),
    ]),
    slot('legBackR', [0.14, 0.32, -0.2], [
      sh('hip', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], 5919304),
      sh('l1', 'box', [0, -0.16, 0], [0.1, 0.34, 0.1], 5919304),
      sh('hoof', 'box', [0, -0.31, 0.02], [0.11, 0.06, 0.14], 3814440),
    ]),
  ] },
];

// --- Limb builders. Each begins with a JOINT sphere at the slot's own
// origin. Because a limb slot's anchor is placed INSIDE the torso solid,
// that joint always overlaps the body, and every later segment overlaps the
// joint — so the whole limb is structurally guaranteed to be connected.
// Function declarations hoist, so the data above can reference these. ---
function recolor(s, color) { return { ...s, color: s.color === SKIN ? color : s.color }; }
function recolorAll(shapes, color) { return shapes.map((s) => recolor(structuredClone(s), color)); }

function humanoidArm(color, claw) {
  return [
    sh('shoulder', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], color),
    sh('a1', 'capsule', [0, -0.19, 0], [0.1, 0.38, 0.1], color),
    sh('a2', 'cone', [0, -0.37, 0], [0.09, 0.12, 0.09], claw || C.white, [180, 0, 0]),
  ];
}
function humanoidLeg(color, foot) {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.15, 0.15, 0.15], color),
    sh('l1', 'capsule', [0, -0.26, 0], [0.12, 0.56, 0.12], color),
    sh('foot', 'box', [0, -0.5, 0.04], [0.14, 0.08, 0.19], foot || C.brownDk),
  ];
}
function armStub(color) {
  return [
    sh('shoulder', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], color),
    sh('a1', 'capsule', [0, -0.13, 0], [0.1, 0.26, 0.1], color),
    sh('hand', 'sphere', [0, -0.26, 0], [0.11, 0.11, 0.11], color),
  ];
}
function armBulk(color) {
  return [
    sh('shoulder', 'sphere', [0, 0, 0], [0.2, 0.2, 0.2], color),
    sh('a1', 'box', [0, -0.22, 0], [0.2, 0.5, 0.2], color),
    sh('fist', 'box', [0, -0.46, 0], [0.24, 0.2, 0.24], color),
  ];
}
function legThickBox(color) {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.24, 0.24, 0.24], color),
    sh('l1', 'box', [0, -0.24, 0], [0.22, 0.48, 0.22], color),
    sh('foot', 'box', [0, -0.45, 0.05], [0.26, 0.1, 0.3], C.stoneDk),
  ];
}
function quadLeg(color) {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.14, 0.14, 0.14], color),
    sh('l1', 'box', [0, -0.22, 0], [0.11, 0.46, 0.11], color),
    sh('paw', 'box', [0, -0.41, 0.03], [0.13, 0.07, 0.17], C.brownDk),
  ];
}
function legThickPaw(color) {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.19, 0.19, 0.19], color),
    sh('l1', 'cylinder', [0, -0.22, 0], [0.16, 0.46, 0.16], color),
    sh('paw', 'box', [0, -0.42, 0.03], [0.18, 0.08, 0.2], C.brownDk),
  ];
}
function boneLimb() {
  return [
    sh('joint', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], C.bone),
    sh('b1', 'capsule', [0, -0.2, 0], [0.06, 0.42, 0.06], C.bone),
    sh('end', 'sphere', [0, -0.4, 0], [0.07, 0.07, 0.07], C.bone),
  ];
}
function birdLeg() {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.09, 0.09, 0.09], C.orange),
    sh('l1', 'capsule', [0, -0.2, 0], [0.04, 0.4, 0.04], C.orange),
    sh('foot', 'box', [0, -0.38, 0.04], [0.1, 0.03, 0.14], C.orange),
  ];
}
function spiderLeg(side, rot) {
  return [
    sh('joint', 'sphere', [0, 0, 0], [0.13, 0.13, 0.13], C.grayDk),
    sh('l1', 'capsule', [side * 0.08, -0.05, 0], [0.05, 0.54, 0.05], C.grayDk, rot),
  ];
}
function ratLeg() {
  return [
    sh('hip', 'sphere', [0, 0, 0], [0.08, 0.08, 0.08], C.fur),
    sh('l1', 'capsule', [0, -0.11, 0], [0.05, 0.24, 0.05], C.fur),
  ];
}
