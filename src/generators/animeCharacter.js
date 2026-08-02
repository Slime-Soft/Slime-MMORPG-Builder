// src/generators/animeCharacter.js
// ONE playable body, authored at cute-anime proportions, as the first step of
// CHARACTER_REDESIGN_CONCEPT.md. Nothing else in the project changes: the six
// existing class bodies in character-types.json are untouched and still render
// exactly as before. This is an additional `kind: 'character'` row.
//
// PROPORTIONS (concept doc §3, tuned to "cute" rather than "adult anime"):
//   total height  1.80   — unchanged from the existing bodies on purpose;
//                          doors, interiors, collision radii and camera height
//                          are all built around it.
//   head height   0.46   — 3.9 heads tall. The old bodies are ~3.5.
// The head shrank and the LEGS got the height back, which is the whole trick:
// a taller character with the same-size head just looks like a bigger chibi.
//
// THE FACE IS A TEXTURE, not shapes — see faceTexture.js for why. The head box
// carries a `face` descriptor and custom.js maps it onto the +Z side. There are
// deliberately no eyeL/eyeR boxes here; eye colour, eye shape, brows and mouth
// are all face parameters, which is what makes "different eyes and eye colours"
// a slider rather than a re-authored mesh.
//
// MASC/FEM ARE TWO BODIES, not one body scaled. Bust shapes exist only on the
// feminine build, and the hips/waist differ. Everything else is shared, so a
// future wardrobe piece still only has to fit one skeleton.

/** shape: id, kind, position [x,y,z], scale [x,y,z], color, optional rotation [x,y,z] (deg). */
function sh(id, kind, p, s, color, r) {
  const o = { id, kind, position: { x: p[0], y: p[1], z: p[2] }, scale: { x: s[0], y: s[1], z: s[2] }, color };
  if (r) o.rotation = { x: r[0], y: r[1], z: r[2] };
  return o;
}

const SKIN = 0xf2d3b0;
const CLOTH = 0x4a6f9a;
const CLOTH_DK = 0x33506f;
const TRIM = 0xd9a92a;
const LEATHER = 0x6a4a2a;
const LEATHER_DK = 0x46301b;
const HAIR = 0x2a1d14;

/**
 * Slot anchors, creature-root space, root at the feet.
 *
 * The arm anchor obeys the invariant CLAUDE.md spells out:
 *   torso half-width 0.24 + upper-arm radius 0.075 = 0.315.
 * An anchor at 0.24 would sit on the chest's surface and still leave half the
 * limb inside the chest. Connectivity is held by the shoulder SPHERE
 * (radius 0.095, spanning 0.22..0.41) overlapping the torso solid.
 */
export const ANIME_ANCHORS = {
  torso: [0, 0.98, 0],
  head: [0, 1.53, 0],
  armL: [-0.315, 1.2, 0],
  armR: [0.315, 1.2, 0],
  legL: [-0.12, 0.66, 0],
  legR: [0.12, 0.66, 0],
};

// --- Torso -----------------------------------------------------------------
// Shared between both builds. World-space spans, for reference when tuning:
//   chest 0.69..1.31, neck 1.26..1.38 (meets the head at 1.30), hips 0.60..0.76.

function torsoShapes(bodyType) {
  const fem = bodyType === 'fem';
  const shapes = [
    sh('chest', 'box', [0, 0.02, 0], [0.48, 0.62, 0.32], CLOTH),
    sh('collar', 'box', [0, 0.28, 0], [0.4, 0.1, 0.34], CLOTH_DK),
    sh('neck', 'cylinder', [0, 0.34, 0], [0.15, 0.12, 0.15], SKIN),
    // Waist is narrower on the feminine build and the hips are wider — the
    // chest is deliberately IDENTICAL on both, because narrowing it would pull
    // the torso surface inside the shoulder spheres and break the arm join.
    sh('belt', 'box', [0, -0.2, 0], [fem ? 0.46 : 0.5, 0.08, 0.34], LEATHER),
    sh('buckle', 'box', [0, -0.2, 0.17], [0.09, 0.09, 0.04], TRIM),
    sh('hips', 'box', [0, -0.3, 0], [fem ? 0.48 : 0.44, 0.16, 0.3], CLOTH_DK),
  ];
  if (fem) {
    // THE CHEST MUST BE ROUND BEFORE THE BREASTS CAN LOOK RIGHT.
    //
    // Every previous attempt stuck a shape onto a flat box and every one
    // failed, in a different way each time: big spheres read as balls, a
    // merged ellipsoid read as a lump, and small cones read as nipples. The
    // common cause was the SURFACE, not the shape sitting on it — a chest
    // that is a hard flat slab makes anything attached to it look attached.
    //
    // In the reference the upper torso is itself a rounded, tapered mass, and
    // the breasts are large forms that blend into that curve rather than
    // protruding from a plane. So `ribcage` rounds the upper torso first, and
    // the bust pair is sized to read as part of that same mass: radius 0.12,
    // nearly meeting at the centreline (inner edges overlap by 3cm) and
    // reaching almost to the chest's full half-width.
    // NO separate ribcage sphere. It rounded the upper torso, but it sat
    // further forward than the chest box and so showed through the notch
    // between the two bust spheres as a distinct lobe — an object that read
    // as neither body nor clothing. The bust pair overlaps at the centreline
    // on its own, so the roundness survives without it.
    shapes.push(
      sh('bustL', 'sphere', [-0.105, 0.09, 0.13], [0.24, 0.22, 0.22], CLOTH),
      sh('bustR', 'sphere', [0.105, 0.09, 0.13], [0.24, 0.22, 0.22], CLOTH)
    );
  }
  return shapes;
}

// --- Head ------------------------------------------------------------------

function headShapes(face) {
  return [
    { ...sh('head', 'box', [0, 0, 0], [0.44, 0.46, 0.42], SKIN), face },
    sh('earL', 'box', [-0.23, -0.02, -0.02], [0.05, 0.13, 0.09], SKIN),
    sh('earR', 'box', [0.23, -0.02, -0.02], [0.05, 0.13, 0.09], SKIN),
  ];
}

// --- Limbs -----------------------------------------------------------------
// Authored symmetric about x, so the same list serves both sides with no
// mirroring step to get wrong.

// A LIMB MUST TAPER: thick at the shoulder/hip, thin at the wrist/ankle.
//
// Getting that right means NOT comparing `scale` across shape kinds, because
// the primitives don't share a unit radius (see custom.js geometryForKind):
//   capsule  CapsuleGeometry(0.35, 0.3)  -> radius 0.35 * scale.x
//   cylinder CylinderGeometry(0.5, ...)  -> radius 0.50 * scale.x
//   sphere   SphereGeometry(0.5)         -> radius 0.50 * scale.x
// So a capsule at scale 0.17 is THINNER than a cylinder at 0.14 (0.060 vs
// 0.070). The first version of this body read those two numbers as if they
// were comparable and ended up with calves fatter than thighs and forearms
// fatter than upper arms. Radii below are written out; keep them that way.
const capsuleScaleFor = (radius) => radius / 0.35;
const cylinderScaleFor = (radius) => radius / 0.5;
const sphereScaleFor = (radius) => radius / 0.5;

// Arm: shoulder 0.095 > upper 0.075 > cuff 0.0675.
// The upper arm's 0.075 is also what sets the arm slot anchor at
// 0.24 (torso half-width) + 0.075 = 0.315 — see ANIME_ANCHORS.
const ARM_SHAPES = [
  sh('shoulder', 'sphere', [0, 0, 0], Array(3).fill(sphereScaleFor(0.095)), CLOTH),
  sh('upper', 'capsule', [0, -0.18, 0], [capsuleScaleFor(0.075), 0.34, capsuleScaleFor(0.075)], CLOTH),
  sh('cuff', 'cylinder', [0, -0.4, 0], [cylinderScaleFor(0.0675), 0.2, cylinderScaleFor(0.0675)], CLOTH_DK),
  // `hand` is the arm's lowest shape, so creatureRig's handAnchorFor derives
  // the weapon grip point from its centre. Keep it last and keep it lowest.
  sh('hand', 'box', [0, -0.55, 0], [0.14, 0.15, 0.13], SKIN),
];

// Leg: hip 0.11 > thigh 0.095 > shin 0.080. NO KNEE SPHERE.
//
// The knee sphere was a mistake. It was wider than the shin, so instead of
// bridging the taper it added a pale knob mid-leg — a ball joint on a doll,
// exactly the "weird" Dennis pointed at. A shoulder sphere works because a
// shoulder genuinely IS a ball that the arm hangs from; a knee is not, and a
// leg reads best as one continuous taper with no hardware in it.
//
// Instead the two capsules overlap by 4cm and the gap between their radii is
// only 1.5cm, so the upper capsule's rounded cap sinks into the lower one and
// the transition disappears. Capsule ends blending into each other is the
// smoothest joint this primitive set can produce.
//
// Slot anchor is at world y=0.66, so local y = world - 0.66.
//   thigh 0.32..0.66   shin 0.06..0.36   shoe 0..0.18
const LEG_SHAPES = [
  sh('hip', 'sphere', [0, 0, 0], Array(3).fill(sphereScaleFor(0.11)), CLOTH_DK),
  sh('thigh', 'capsule', [0, -0.17, 0], [capsuleScaleFor(0.095), 0.34, capsuleScaleFor(0.095)], SKIN),
  sh('shin', 'capsule', [0, -0.45, 0], [capsuleScaleFor(0.08), 0.3, capsuleScaleFor(0.08)], SKIN),

  // A SHOE IS A SOLE PLUS AN UPPER, not a stack of blocks. The previous
  // version bolted a toe cap and a heel onto a boot box, and because each sat
  // at a different height with a different footprint the result was a visible
  // staircase. Three parts now, each a clean horizontal slab:
  //   cuff  — the collar the shin disappears into
  //   boot  — the upper
  //   sole  — slightly longer and wider than the upper, so the shoe overhangs
  //           it the way a real sole does, and reads as footwear from the side
  sh('bootCuff', 'cylinder', [0, -0.52, 0], [cylinderScaleFor(0.082), 0.08, cylinderScaleFor(0.082)], LEATHER),
  sh('boot', 'box', [0, -0.59, 0.02], [0.16, 0.1, 0.22], LEATHER),
  sh('bootSole', 'box', [0, -0.64, 0.03], [0.17, 0.04, 0.26], LEATHER_DK),
];

// --- Hair ------------------------------------------------------------------
// Sized to THIS head (x +/-0.22, y +/-0.23, z +/-0.21), not the older 0.5 one.
//
// Concept doc §5: hair is a SILHOUETTE, not a hat. Every style here overhangs
// the face or jaw and breaks the head's outline — that's what separates an
// anime character from a box with a lid on it. Every shape interpenetrates the
// head rather than resting on it, per the connectivity rule.
//
// Ids all start with `hair` so playerCharacter's tint role dyes the whole mass.

const CAP = sh('hairCap', 'box', [0, 0.17, 0], [0.5, 0.2, 0.48], HAIR);
const BANGS = sh('hairBangs', 'box', [0, 0.1, 0.2], [0.47, 0.17, 0.1], HAIR);
const BACK = sh('hairBack', 'box', [0, 0.02, -0.2], [0.47, 0.34, 0.11], HAIR);

export const ANIME_HAIR_STYLES = [
  'anime-short', 'anime-bob', 'anime-long', 'anime-twintails', 'anime-ponytail', 'anime-spiky',
];

export const ANIME_HAIR_SHAPES = {
  'anime-short': [
    CAP, BANGS, BACK,
    sh('hairTuftL', 'wedge', [-0.21, 0.08, 0.08], [0.12, 0.22, 0.3], HAIR, [0, 0, 22]),
    sh('hairTuftR', 'wedge', [0.21, 0.08, 0.08], [0.12, 0.22, 0.3], HAIR, [0, 0, -22]),
  ],
  'anime-bob': [
    CAP, BANGS,
    sh('hairBack', 'box', [0, -0.04, -0.2], [0.47, 0.44, 0.12], HAIR),
    sh('hairSideL', 'box', [-0.22, -0.08, 0.0], [0.09, 0.42, 0.44], HAIR),
    sh('hairSideR', 'box', [0.22, -0.08, 0.0], [0.09, 0.42, 0.44], HAIR),
  ],
  'anime-long': [
    CAP, BANGS,
    sh('hairBack', 'box', [0, -0.22, -0.2], [0.48, 0.82, 0.13], HAIR),
    sh('hairSideL', 'box', [-0.22, -0.16, 0.02], [0.09, 0.6, 0.42], HAIR),
    sh('hairSideR', 'box', [0.22, -0.16, 0.02], [0.09, 0.6, 0.42], HAIR),
  ],
  // The tie must sit INSIDE the cap, not beside the head. The first version
  // put it at x=0.23 with radius 0.07 against a cap reaching x=0.25 — 2cm of
  // overlap, which passes a connectivity check and still reads as a detached
  // pom-pom floating next to the ear. Tie is now radius 0.095 at x=0.20, i.e.
  // half-buried in the cap, and the tail's top overlaps the tie generously.
  //
  // Splay: rotating about +z moves a hanging capsule's BOTTOM toward +x, so
  // the right tail wants a positive angle and the left a negative one for both
  // to fall outward. Same sign on both would swing them both the same way.
  'anime-twintails': [
    CAP, BANGS, BACK,
    sh('hairTieL', 'sphere', [-0.2, 0.16, -0.06], [0.19, 0.19, 0.19], HAIR),
    sh('hairTieR', 'sphere', [0.2, 0.16, -0.06], [0.19, 0.19, 0.19], HAIR),
    sh('hairTailL', 'capsule', [-0.255, -0.06, -0.09], [0.214, 0.46, 0.214], HAIR, [0, 0, -14]),
    sh('hairTailR', 'capsule', [0.255, -0.06, -0.09], [0.214, 0.46, 0.214], HAIR, [0, 0, 14]),
    sh('hairTailL2', 'capsule', [-0.3, -0.36, -0.12], [0.166, 0.32, 0.166], HAIR, [0, 0, -10]),
    sh('hairTailR2', 'capsule', [0.3, -0.36, -0.12], [0.166, 0.32, 0.166], HAIR, [0, 0, 10]),
  ],
  'anime-ponytail': [
    CAP, BANGS, BACK,
    sh('hairTie', 'sphere', [0, 0.08, -0.24], [0.15, 0.15, 0.15], HAIR),
    sh('hairTail1', 'capsule', [0, -0.08, -0.32], [0.18, 0.4, 0.18], HAIR, [22, 0, 0]),
    sh('hairTail2', 'capsule', [0, -0.38, -0.44], [0.14, 0.34, 0.14], HAIR, [12, 0, 0]),
  ],
  'anime-spiky': [
    sh('hairCap', 'box', [0, 0.15, 0], [0.49, 0.18, 0.47], HAIR),
    sh('hairBangs', 'box', [0, 0.09, 0.2], [0.46, 0.16, 0.1], HAIR),
    BACK,
    sh('hairSpike1', 'cone', [-0.15, 0.28, 0.06], [0.16, 0.26, 0.16], HAIR, [-18, 0, 20]),
    sh('hairSpike2', 'cone', [0.01, 0.3, -0.02], [0.16, 0.3, 0.16], HAIR, [-8, 0, 0]),
    sh('hairSpike3', 'cone', [0.17, 0.28, 0.05], [0.16, 0.26, 0.16], HAIR, [-18, 0, -20]),
  ],
};

/**
 * The playable anime body.
 *
 * @param {'masc'|'fem'} [bodyType]
 * @param {import('./faceTexture.js').FaceParams} [face] baked into the head
 *   shape; `applyAppearance` overwrites it per player, so what's here is only
 *   the default the Character Builder opens with.
 * @returns {import('../sim/creatureTypeDefs.js').CreatureTypeDef}
 */
export function animeCharacterBody(bodyType = 'fem', face = {}) {
  const a = ANIME_ANCHORS;
  const anchor = ([x, y, z]) => ({ x, y, z });
  return {
    id: bodyType === 'masc' ? 'adventurer-m' : 'adventurer-f',
    name: bodyType === 'masc' ? 'Adventurer (Masc)' : 'Adventurer (Fem)',
    kind: 'character',
    stance: 'humanoid',
    slots: [
      { role: 'torso', anchor: anchor(a.torso), shapes: torsoShapes(bodyType) },
      {
        role: 'head',
        anchor: anchor(a.head),
        shapes: [
          ...headShapes({ faceStyle: bodyType === 'masc' ? 'masc' : 'fem', ...face }),
          ...ANIME_HAIR_SHAPES['anime-short'],
        ],
      },
      { role: 'armL', anchor: anchor(a.armL), shapes: ARM_SHAPES },
      { role: 'armR', anchor: anchor(a.armR), shapes: ARM_SHAPES },
      { role: 'legL', anchor: anchor(a.legL), shapes: LEG_SHAPES },
      { role: 'legR', anchor: anchor(a.legR), shapes: LEG_SHAPES },
    ],
    equipment: { mainHand: null, offHand: null },
  };
}

/** Both builds, ready to append to a preset catalog. */
export const ANIME_CHARACTER_PRESETS = [
  animeCharacterBody('fem'),
  animeCharacterBody('masc'),
];
