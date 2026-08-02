// src/generators/rig.js
// Generic pose/gait math, generalized off src/generators/character.js's
// original hardcoded 4-limb walk cycle so any rig — biped or quadruped,
// character or monster — can be posed the same way. A "rig" is just
// `{ [role]: THREE.Group }`, where each Group is a pivot positioned at the
// joint (mesh offset below/behind it) — see character.js's
// buildLegPivot/buildArmPivot for the convention every rig-builder follows.

/**
 * @typedef {Object} GaitEntry
 * @property {string} part rig role key, e.g. 'legL'
 * @property {'x'|'y'|'z'} axis
 * @property {number} amplitude radians
 * @property {number} phase radians offset from the master gait phase
 */

// Biped's part names match generateCharacter's existing rig keys exactly —
// this table produces identical output to the old hardcoded walk cycle.
export const GAIT_TABLES = {
  biped: [
    { part: 'legL', axis: 'x', amplitude: 0.55, phase: 0 },
    { part: 'legR', axis: 'x', amplitude: 0.55, phase: Math.PI },
    { part: 'armR', axis: 'x', amplitude: 0.4, phase: 0 },
    { part: 'armL', axis: 'x', amplitude: 0.4, phase: Math.PI },
  ],
  // Alternating tetrapod gait: legFrontL's group (front-L, mid-front-R,
  // mid-back-L, back-R) swings opposite legFrontR's group — the same
  // diagonal-trot pattern the original 4-entry table used, just extended to
  // the two extra leg pairs. A rig missing a part (a 4-legged wolf has no
  // legMidFrontL) just doesn't animate that entry — see applyGaitPose below.
  quadruped: [
    { part: 'legFrontL', axis: 'x', amplitude: 0.5, phase: 0 },
    { part: 'legFrontR', axis: 'x', amplitude: 0.5, phase: Math.PI },
    { part: 'legMidFrontL', axis: 'x', amplitude: 0.5, phase: Math.PI },
    { part: 'legMidFrontR', axis: 'x', amplitude: 0.5, phase: 0 },
    { part: 'legMidBackL', axis: 'x', amplitude: 0.5, phase: 0 },
    { part: 'legMidBackR', axis: 'x', amplitude: 0.5, phase: Math.PI },
    { part: 'legBackL', axis: 'x', amplitude: 0.5, phase: Math.PI },
    { part: 'legBackR', axis: 'x', amplitude: 0.5, phase: 0 },
  ],
};

const DEG2RAD = Math.PI / 180;

/**
 * A pivot's resting rotation. Normally zero, but a limb carrying a weapon rests
 * in that weapon's hold pose instead (a bow arm stays extended; see
 * src/sim/weaponTypes.js) — `setBasePose` stamps it onto the pivot, and every
 * pose function below composes ON TOP of it rather than overwriting rotation.
 * Without this, the walk cycle would snap an armed limb back to rest each frame.
 * @param {import('three').Object3D} pivot
 * @param {{x?:number, y?:number, z?:number, swingScale?:number}} holdDeg degrees
 */
export function setBasePose(pivot, holdDeg) {
  if (!pivot || !holdDeg) return;
  pivot.userData.basePose = {
    x: (holdDeg.x || 0) * DEG2RAD,
    y: (holdDeg.y || 0) * DEG2RAD,
    z: (holdDeg.z || 0) * DEG2RAD,
    swingScale: holdDeg.swingScale ?? 1,
  };
}

const ZERO_BASE = { x: 0, y: 0, z: 0, swingScale: 1 };
const baseOf = (pivot) => pivot.userData.basePose || ZERO_BASE;
// Falls back to the pivot's current position for rigs built outside
// creatureRig.js (e.g. character.js's standalone NPC pivots), which never
// set userData.baseAnchor and never get position-animated either — reading
// the current value back is a safe no-op reset for them.
const baseAnchorOf = (pivot) => pivot.userData.baseAnchor || pivot.position;

/**
 * Rest pose: return every pivot on the rig to its base pose (zero rotation,
 * unless a weapon hold pose says otherwise; base anchor position; unit
 * scale).
 *
 * This used to only zero parts named in the two built-in GAIT_TABLES, which
 * silently left anything else stuck in its last pose — a problem the moment
 * a monster type animates a part those tables never mention (a tail, a head,
 * a wing). Position/scale reset was added alongside applyKeyframeClip below,
 * which is the first thing in this file that ever moves/scales a pivot —
 * without resetting those here too, a keyframe clip's last pose would stick
 * on a pivot forever once the clip stops being driven.
 */
export function applyIdlePose(rig) {
  for (const pivot of Object.values(rig)) {
    if (!pivot) continue;
    const b = baseOf(pivot);
    pivot.rotation.set(b.x, b.y, b.z);
    const a = baseAnchorOf(pivot);
    pivot.position.set(a.x, a.y, a.z);
    pivot.scale.set(1, 1, 1);
  }
}

/**
 * @typedef {Object} AnimEntry An authored gait entry, in degrees (author-facing).
 * @property {string} part rig role, e.g. 'legFrontL' or 'tail'
 * @property {'x'|'y'|'z'} axis
 * @property {number} amplitudeDeg peak swing, degrees
 * @property {number} phaseDeg offset within the cycle, degrees (180 = opposite the leading limb)
 */

/**
 * Author-facing degrees -> the radians GaitEntry[] that applyGaitPose wants.
 * Entries with no swing are dropped: a zero-amplitude entry would just pin
 * that part to 0 every frame, which is what applyIdlePose is for.
 * @param {AnimEntry[]} entries
 * @returns {GaitEntry[]}
 */
export function gaitTableFromAnimation(entries) {
  return (entries || [])
    .filter((e) => e && e.part && Math.abs(e.amplitudeDeg || 0) > 0.001)
    .map((e) => ({
      part: e.part,
      axis: e.axis || 'x',
      amplitude: (e.amplitudeDeg || 0) * DEG2RAD,
      phase: (e.phaseDeg || 0) * DEG2RAD,
    }));
}

/** The built-in stance gait, expressed as author-facing degrees — the starting point the editor offers. */
export function defaultAnimationForStance(stance) {
  const table = GAIT_TABLES[stance === 'quadruped' ? 'quadruped' : 'biped'];
  return table.map((e) => ({
    part: e.part,
    axis: e.axis,
    amplitudeDeg: +(e.amplitude / DEG2RAD).toFixed(1),
    phaseDeg: +(e.phase / DEG2RAD).toFixed(1),
  }));
}

/**
 * Generic replacement for the old hardcoded walk-cycle math: for each entry in
 * `gaitTable`, swing `rig[part]` on `axis` as a sine wave AROUND its base pose
 * (see setBasePose — zero for an empty limb, the weapon's hold pose for an
 * armed one), damped by that limb's `swingScale`.
 *
 * Every pivot is returned to its base pose first, so a limb the table doesn't
 * mention doesn't keep a stale rotation from a previous frame.
 *
 * Entries whose `part` isn't present on `rig` are skipped silently — an
 * incomplete/asymmetric rig just doesn't animate that slot instead of
 * throwing (relevant once monster rigs are built from author-defined slots
 * that might omit a limb).
 * @param {Record<string, import('three').Object3D>} rig
 * @param {GaitEntry[]} gaitTable
 * @param {number} masterPhase radians, continuously increasing (e.g. t * frequency)
 * @param {number} blend 0-1, how much of the pose to apply
 */
export function applyGaitPose(rig, gaitTable, masterPhase, blend) {
  applyIdlePose(rig);
  for (const { part, axis, amplitude, phase } of gaitTable) {
    const pivot = rig[part];
    if (!pivot) continue;
    const b = baseOf(pivot);
    pivot.rotation[axis] = b[axis] + Math.sin(masterPhase + phase) * amplitude * blend * b.swingScale;
  }
}

/**
 * @typedef {Object} AttackPoseDef
 * @property {string} part rig role that lunges/swings, e.g. 'armR' or 'head'
 * @property {'x'|'y'|'z'} [axis='x']
 * @property {number} [amplitude=0.9] radians, peak displacement at the strike instant
 */

/**
 * One-shot lunge/swing pose driven by a single dominant limb, timed to
 * compose with triggerAbilityAnimation's windup/effect/recovery phases:
 * `t01` is 0 at the start of windup and 1 at the end of recovery, ramping
 * up through windup, holding near peak through effect, and easing back to
 * 0 through recovery. Callers own translating their own windup/effect/
 * recovery millisecond timings into this single 0-1 value.
 * @param {Record<string, import('three').Object3D>} rig
 * @param {AttackPoseDef} attackPoseDef
 * @param {number} t01 0-1
 */
export function applyAttackPose(rig, attackPoseDef, t01) {
  const pivot = rig[attackPoseDef.part];
  if (!pivot) return;
  const axis = attackPoseDef.axis || 'x';
  const amplitude = attackPoseDef.amplitude ?? 0.9;
  // Rises to peak by the midpoint, eases back to 0 by the end — a single
  // half-sine hump rather than a full cycle, since this is a one-shot pose.
  // Swings from the limb's base pose, so an armed limb strikes from where it
  // was actually holding the weapon rather than from rest.
  const envelope = Math.sin(Math.min(1, Math.max(0, t01)) * Math.PI);
  pivot.rotation[axis] = baseOf(pivot)[axis] + envelope * amplitude;
}

/**
 * @typedef {import('../sim/creatureTypeDefs.js').KeyframeClip} KeyframeClip
 */

const lerp = (a, b, u) => a + (b - a) * u;
/** Lerps an optional {x,y,z}, defaulting either side to `fallback` on missing axes/keyframes. */
function lerpVec(a, b, u, fallback) {
  return {
    x: lerp(a?.x ?? fallback, b?.x ?? fallback, u),
    y: lerp(a?.y ?? fallback, b?.y ?? fallback, u),
    z: lerp(a?.z ?? fallback, b?.z ?? fallback, u),
  };
}

/**
 * Hand-authored position/rotation/scale keyframe playback — the counterpart
 * to applyGaitPose's procedural sine gait, for poses sine math can't express
 * (a jump's crouch/launch/land, an asymmetric telegraphed swing). Position
 * offsets ADD onto the pivot's base anchor, rotation offsets ADD onto its
 * base pose (same "compose on top of the weapon hold pose" convention
 * applyGaitPose uses), and scale multiplies the pivot's rest scale of 1.
 *
 * Does NOT reset untouched pivots to rest first (unlike applyGaitPose) —
 * callers that want a full-body reset before overlaying a clip should call
 * applyIdlePose(rig) themselves first (see updateWalkCycle). This lets an
 * attack clip overlay only the parts it animates on top of whatever the
 * walk/idle pass already set for that frame, rather than stomping it.
 * @param {Record<string, import('three').Object3D>} rig
 * @param {KeyframeClip} clip
 * @param {number} elapsedMs
 */
export function applyKeyframeClip(rig, clip, elapsedMs) {
  if (!clip || !Array.isArray(clip.tracks) || !clip.tracks.length) return;
  const duration = clip.durationMs > 0 ? clip.durationMs : 1;
  const loop = clip.loop ?? true;
  let tFrac = elapsedMs / duration;
  tFrac = loop ? tFrac - Math.floor(tFrac) : Math.min(1, Math.max(0, tFrac));

  for (const track of clip.tracks) {
    const pivot = rig[track.part];
    const frames = track.keyframes;
    if (!pivot || !frames || frames.length < 2) continue;

    let lo = frames[0];
    let hi = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (tFrac >= frames[i].t && tFrac <= frames[i + 1].t) {
        lo = frames[i];
        hi = frames[i + 1];
        break;
      }
    }
    const span = hi.t - lo.t;
    const u = span > 0 ? (tFrac - lo.t) / span : 0;

    const anchor = baseAnchorOf(pivot);
    const posOffset = lerpVec(lo.position, hi.position, u, 0);
    pivot.position.set(anchor.x + posOffset.x, anchor.y + posOffset.y, anchor.z + posOffset.z);

    const b = baseOf(pivot);
    const rotOffsetDeg = lerpVec(lo.rotation, hi.rotation, u, 0);
    pivot.rotation.set(
      b.x + rotOffsetDeg.x * DEG2RAD,
      b.y + rotOffsetDeg.y * DEG2RAD,
      b.z + rotOffsetDeg.z * DEG2RAD
    );

    const scaleMul = lerpVec(lo.scale, hi.scale, u, 1);
    pivot.scale.set(scaleMul.x, scaleMul.y, scaleMul.z);
  }
}
