// scripts/check-gear.mjs
// Wears every equipment set on every player body and fails on the two ways
// gear breaks a character.
//
// 1. Z-FIGHTING. Armor REPLACES the class body's own clothing (see
//    BODY_COVERAGE_BY_SLOT in src/sim/gearVisuals.js); it does not cover it.
//    The first version of the equipment system got that wrong, and the result
//    was a Warrior whose cuirass sat 5 mm off his torso box, whose gorget sat
//    5 mm off his scale plates, and so on for every piece — two opaque faces
//    per pair that the depth buffer cannot separate. In game that reads as a
//    hard flicker crawling over the character as the camera moves, and it is
//    invisible in a still screenshot, which is exactly why it needs a guard
//    rather than an eyeball.
//
// 2. DETACHED GEAR. A piece that hides the body shape it was relying on for
//    connection (a pants piece hiding `hip`, a chest piece hiding `shoulder`)
//    has to supply its own replacement, or the limb it belongs to floats.
//    Same failure `check-prefabs.mjs` guards for bodies, applied to the merged
//    body a dressed character actually renders as.
//
//   node scripts/check-gear.mjs
//
// SELF-TEST FIRST, for the reason spelled out at the top of
// check-architecture.mjs: a guard nobody has watched fail reports a confident
// PASS over a broken tree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const { EQUIPMENT_PRESET_SETS, expandPresetSet } = await import('../src/sim/equipmentPresets.js');
const { mergeGearAppearances, wornGearVisuals } = await import('../src/sim/gearVisuals.js');
const { CHARACTER_PRESETS } = await import('../src/generators/characterPresets.js');

/** Two opaque faces closer than this, and overlapping, will fight for the depth buffer. */
const PLANE_EPS = 0.02;
/** Faces smaller than this in cross-section are slivers nobody sees flicker. */
const MIN_OVERLAP = 0.04;

const AXES = ['x', 'y', 'z'];
const half = (shape, axis) => (shape.scale?.[axis] ?? 0) / 2;
const lo = (shape, axis) => (shape.position?.[axis] ?? 0) - half(shape, axis);
const hi = (shape, axis) => (shape.position?.[axis] ?? 0) + half(shape, axis);

/**
 * Which axes a shape actually has FLAT faces on — the only ones that can share
 * a plane with something else and fight over it.
 *
 * Without this the check compares bounding boxes, and a sphere's bounding box
 * has six faces the sphere itself does not: a pauldron ball whose AABB happens
 * to line up with a sleeve's would be reported as flickering when nothing about
 * it is even flat. That noise buries the handful of real box-on-box conflicts,
 * which are the ones that actually flicker in game.
 *
 * A cylinder/cone/pyramid has flat caps on its own Y and a curved or faceted
 * side; a sphere and a capsule have nothing flat at all.
 */
function flatAxes(shape) {
  switch (shape.kind) {
    case 'sphere': case 'capsule': return [];
    case 'cylinder': case 'cone': case 'pyramid': return ['y'];
    // box, wedge and the parametric kinds: treat every axis as flat. A wedge's
    // slope isn't, but calling one extra axis flat only ever over-reports, and
    // this guard should err that way.
    default: return AXES;
  }
}

/** A rotated shape's axis-aligned faces aren't axis-aligned any more, so the flat comparison below doesn't apply to it. */
function isAxisAligned(shape) {
  const r = shape.rotation;
  if (!r) return true;
  if (typeof r === 'number') return r === 0;
  // Any rotation at all, including a multiple of 90: the extents compared below
  // come from `scale`, which is pre-rotation, so a tilted shape's real faces
  // are not where this maths thinks they are. Skipping is the honest answer —
  // it under-reports rather than inventing conflicts at coordinates the shape
  // does not actually occupy.
  return !r.x && !r.y && !r.z;
}

/** Do two shapes overlap enough on the other two axes for a shared plane to be visible? */
function overlapsOffAxis(a, b, axis) {
  for (const other of AXES) {
    if (other === axis) continue;
    const span = Math.min(hi(a, other), hi(b, other)) - Math.max(lo(a, other), lo(b, other));
    if (span < MIN_OVERLAP) return false;
  }
  return true;
}

/** Every near-coplanar face pair between a gear shape and a body shape in one slot. */
function coplanarPairs(shapes) {
  const out = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      const a = shapes[i], b = shapes[j];
      // Gear-vs-gear and body-vs-body are both fine: a set's own pieces are
      // authored together, and a body's own shapes were signed off long ago.
      // Only the seam between the two is new, and only it is checked.
      if (a.id.startsWith('gear:') === b.id.startsWith('gear:')) continue;
      if (!isAxisAligned(a) || !isAxisAligned(b)) continue;
      const shared = flatAxes(a).filter((ax) => flatAxes(b).includes(ax));
      for (const axis of shared) {
        if (!overlapsOffAxis(a, b, axis)) continue;
        for (const [pa, pb, la, lb] of [[lo(a, axis), lo(b, axis), 'min', 'min'], [hi(a, axis), hi(b, axis), 'max', 'max'],
          [lo(a, axis), hi(b, axis), 'min', 'max'], [hi(a, axis), lo(b, axis), 'max', 'min']]) {
          const gap = Math.abs(pa - pb);
          if (gap < PLANE_EPS) out.push({ a: a.id, b: b.id, axis, la, lb, gap });
        }
      }
    }
  }
  return out;
}

/** A limb slot whose shapes no longer reach back into the torso is a floating limb. */
function detachedLimbs(body) {
  const torso = body.slots.find((s) => s.role === 'torso');
  if (!torso) return [];
  const out = [];
  for (const slot of body.slots) {
    if (!/^(armL|armR|legL|legR)$/.test(slot.role)) continue;
    if (!slot.shapes.length) { out.push(`${slot.role}: no shapes at all`); continue; }
    // The joint is the slot's anchor; a shape welds the limb on if it spans
    // that anchor (i.e. reaches back through the pivot into the torso solid).
    const welded = slot.shapes.some((s) => AXES.every((ax) => lo(s, ax) <= 0.001 && hi(s, ax) >= -0.001));
    if (!welded) out.push(`${slot.role}: nothing spans the joint — the limb hangs off the body`);
  }
  return out;
}

// --- self-test --------------------------------------------------------------
{
  const box = (id, y, s) => ({ id, kind: 'box', position: { x: 0, y, z: 0 }, scale: { x: s, y: s, z: s } });
  const fighting = coplanarPairs([box('body', 0, 1), box('gear:x:plate', 0.005, 1)]);
  if (!fighting.length) throw new Error('SELF-TEST FAILED: a 5mm-offset face pair was not detected');
  // Note the clean case has to be bigger on EVERY axis. A shell that only grows
  // in Y still shares its side faces with what it wraps, and those fight just
  // as hard — which is precisely the mistake the preset armor made.
  const clear = coplanarPairs([box('body', 0, 1), box('gear:x:plate', 0, 1.2)]);
  if (clear.length) throw new Error('SELF-TEST FAILED: a shape enclosing on all three axes was reported as fighting');
  const partial = coplanarPairs([box('body', 0, 1), { id: 'gear:x:tall', kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1.2, z: 1 } }]);
  if (!partial.length) throw new Error('SELF-TEST FAILED: a shell sharing its side faces was not detected');
  const sameSide = coplanarPairs([box('body', 0, 1), box('bodyToo', 0.005, 1)]);
  if (sameSide.length) throw new Error('SELF-TEST FAILED: a body-vs-body pair should be ignored');
  console.log('self-test        ok (5mm pair caught, shared side faces caught, fully-enclosing pair passed, body-vs-body ignored)');
}

// --- scan -------------------------------------------------------------------
const catalogPath = path.join(ROOT, 'character-types/character-types.json');
const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8'));
const bodies = [...catalog, ...CHARACTER_PRESETS].filter((c) => c.kind === 'character');
const seen = new Set();
const playerBodies = bodies.filter((b) => (seen.has(b.id) ? false : seen.add(b.id)));

const itemsById = Object.fromEntries(EQUIPMENT_PRESET_SETS.flatMap(expandPresetSet).map((i) => [i.id, i]));
let failures = 0;
let combos = 0;

for (const set of EQUIPMENT_PRESET_SETS) {
  const equipment = Object.fromEntries(
    ['head', 'chest', 'gloves', 'pants', 'shoes'].map((slot) => [slot, `eq_${set.id}_${slot}`])
  );
  const worn = wornGearVisuals(equipment, itemsById);
  for (const body of playerBodies) {
    combos++;
    const merged = mergeGearAppearances(body, worn);
    const problems = [];
    for (const slot of merged.slots) {
      for (const p of coplanarPairs(slot.shapes)) {
        problems.push(`${slot.role}: ${p.a} ${p.axis}${p.la} vs ${p.b} ${p.axis}${p.lb} — ${(p.gap * 1000).toFixed(0)}mm apart`);
      }
    }
    problems.push(...detachedLimbs(merged));
    if (problems.length) {
      failures++;
      console.log(`\nFAIL ${set.id} on ${body.id}`);
      for (const p of problems.slice(0, 8)) console.log(`       ${p}`);
      if (problems.length > 8) console.log(`       …and ${problems.length - 8} more`);
    }
  }
}

console.log(`\n${combos} set/body combination(s) checked, ${EQUIPMENT_PRESET_SETS.length} set(s) across ${playerBodies.length} body/bodies`);
if (failures) {
  console.log(`\nFAIL: ${failures} combination(s) have gear fighting the body underneath it, or a limb that came unwelded.`);
  console.log('Gear must REPLACE the body shapes it covers (appearance.hideBodyShapes) and supply its own joint where it hides one.');
  process.exit(1);
}
console.log('PASS');
