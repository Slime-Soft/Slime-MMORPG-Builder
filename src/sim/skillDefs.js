// src/sim/skillDefs.js
// The authored shape behind every class skill (and, via the optional
// `effects` field also usable on monster abilities — see monsterTypeDefs.js —
// the same vocabulary resolves on both sides). Zero DOM/rendering dependencies,
// same purity rule as every other src/sim file: this must parse and validate
// identically on client and server.
//
// A skill is a bundle of: who it can target and how (self/ally/enemy, single
// target or an AoE shape), a cooldown + resource cost + cast time, whether the
// caster can move while it's resolving, a list of EFFECTS it applies (damage,
// heal, a status effect, a shield, a forced move), and which animation/VFX
// play. `effects` is an array specifically so "this skill deals damage AND
// stuns" is just two entries, not a special case.
import { MAX_LEVEL } from './leveling.js';
import { PRIMARY_STAT_IDS } from './statDefs.js';

export const TARGETING_MODES = ['self', 'ally', 'enemy'];
export const TARGETING_SHAPES = ['single', 'aoe-circle', 'aoe-cone', 'aoe-line', 'chain'];
export const EFFECT_TYPES = [
  'damage', 'heal', 'stun', 'freeze', 'sleep', 'slow',
  'dot', 'hot', 'buff', 'shield', 'taunt', 'knockback', 'pull',
];
export const DAMAGE_TYPES = ['physical', 'fire', 'frost', 'holy', 'poison'];
// 'armor'/'damagePercent'/'movePercent'/'resourceRegen' are the original,
// pre-GSE buff stats (Shield Wall, Battle Shout, slows, etc). The six
// PRIMARY_STAT_IDS (src/sim/statDefs.js) are additive — they let a skill
// buff/debuff a raw primary attribute directly (spec Section 4.2's
// "Warrior's Battle Cry" -> +10 STR), which getBuffAmount(stat) already
// resolved generically before this even existed.
export const BUFF_STATS = ['armor', 'damagePercent', 'movePercent', 'resourceRegen', ...PRIMARY_STAT_IDS];
export const VFX_ANCHORS = ['hand', 'chest', 'ground', 'target'];
export const RIG_PARTS = ['armR', 'armL', 'legR', 'legL', 'head', 'torso'];
export const TIMELINE_EVENT_TYPES = ['pose', 'cast', 'travel', 'impact'];

/**
 * @typedef {Object} SkillTargeting
 * @property {('self'|'ally'|'enemy')[]} modes at least one
 * @property {number} range
 * @property {'single'|'aoe-circle'|'aoe-cone'|'aoe-line'|'chain'} shape
 * @property {number} [radius] aoe-circle/aoe-line width, meters
 * @property {number} [angleDeg] aoe-cone half-angle, degrees
 * @property {number} [chainCount] chain: max additional bounces
 */

/**
 * @typedef {Object} SkillEffect
 * @property {'damage'|'heal'|'stun'|'freeze'|'sleep'|'slow'|'dot'|'hot'|'buff'|'shield'|'taunt'|'knockback'|'pull'} type
 * @property {number} [amount] damage/heal/shield absorbAmount/buff amount
 * @property {string} [damageType] damage/dot only, one of DAMAGE_TYPES
 * @property {number} [durationMs] stun/freeze/sleep/slow/dot/hot/buff/shield/taunt
 * @property {number} [slowPercent] slow only, 0..1
 * @property {number} [damagePerTick] dot only
 * @property {number} [healPerTick] hot only
 * @property {number} [tickMs] dot/hot only
 * @property {string} [stat] buff only, one of BUFF_STATS
 * @property {number} [distance] knockback/pull only, meters
 */

/**
 * @typedef {Object} TimelineEvent
 * @property {'pose'|'cast'|'travel'|'impact'} type
 * @property {number} atMs when this fires, relative to cast start (0 = the instant the ability
 *   goes off). For 'travel', the moment the projectile leaves the caster.
 * @property {number} [endAtMs] 'travel' only — when it arrives; the moving marker/particles
 *   interpolate caster->target across [atMs, endAtMs]
 * @property {'armR'|'armL'|'legR'|'legL'|'head'|'torso'} [part] 'pose' only — which rig pivot
 * @property {{x:number,y:number,z:number}} [rotationDeg] 'pose' only — target local rotation;
 *   interpolated linearly from whatever the previous keyframe for the SAME part left off at
 *   (or from rest, for the first keyframe on that part)
 * @property {string} [vfxId] 'cast'/'travel'/'impact' only — a src/render/vfx preset id
 * @property {'hand'|'chest'|'ground'|'target'} [anchor] 'cast'/'impact' only
 * @property {{x:number,y:number,z:number}} [anchorOffset] 'cast'/'impact' only — a local-space
 *   nudge on top of `anchor` (e.g. moving a 'hand' anchor out to a staff's tip), authored by
 *   dragging a marker in the Skill Builder rather than typed — see resolveAnchor in
 *   src/render/vfx/anchors.js
 * @property {number} [durationMs] 'cast'/'impact' only — how long this spawned effect should
 *   stay active, measured from its own `atMs`. Absent = it persists until the ability's whole
 *   envelope ends. A LOOPING preset (an aura/stream that never self-terminates — e.g. a
 *   continuous cast glow) without this would otherwise run forever, since nothing else ever
 *   tells it to stop; a one-shot burst ignores this (it already has its own fixed lifetime).
 */

/**
 * @typedef {Object} SkillAnimation
 * @property {number} windupMs telegraph before the effect resolves
 * @property {number} effectMs the effect's own visual beat
 * @property {number} recoveryMs recovery before the next action
 * @property {string} [attackClipId] hand-authored KeyframeClip id (see creatureTypeDefs.js);
 *   absent = no clip override, just the VFX below plays over the idle/walk pose
 * @property {TimelineEvent[]} [timeline] an explicit, arbitrary-length sequence of pose/vfx
 *   events authored via the Skill Builder's Timeline tab — when present, this REPLACES the
 *   implicit windup/effect/recovery-driven vfx.* playback below entirely (windupMs/effectMs/
 *   recoveryMs are still used for the cooldown-flash duration and as the envelope's total
 *   length if no event runs longer). Absent = every migrated skill's original behavior,
 *   unchanged.
 */

/**
 * @typedef {Object} SkillVfx
 * @property {string} [castVfxId] plays at cast start, at castAnchor
 * @property {string} [travelVfxId] plays for a projectile-type skill's flight, from caster to target
 * @property {string} [impactVfxId] plays when the effect lands, at impactAnchor
 * @property {'hand'|'chest'|'ground'|'target'} [castAnchor]
 * @property {'hand'|'chest'|'ground'|'target'} [impactAnchor]
 */

/**
 * @typedef {Object} SkillDef
 * @property {string} id
 * @property {string} [classId] which class this belongs to; absent = unassigned/custom.
 *   Assigned via the Character & NPC Builder's Class Skills panel, not here.
 * @property {number} [key] hotbar slot 1-8, only meaningful when classId is set
 * @property {number} [requiredLevel] player level this skill unlocks at; absent/1 = usable
 *   from level 1. Enforced server-side (server/index.js's use-ability handler) and shown
 *   as a locked hotbar slot client-side below that level.
 * @property {string} name
 * @property {string} [description]
 * @property {string} [icon] an emoji/short text label, OR an uploaded image URL (see
 *   /api/skills/icon) — the hotbar renders it as an <img> when it looks like a URL
 * @property {string} [soundUrl] an uploaded one-shot cast sound (see /api/skills/sound),
 *   played once when the ability is used
 * @property {number} resourceCost
 * @property {number} cooldownMs
 * @property {number} castMs time from confirmed cast to effect landing — a real cast/
 *   channel/projectile-travel time, distinct from the animation envelope below
 * @property {boolean} canMoveDuringCast false = moving cancels the cast
 * @property {SkillTargeting} targeting
 * @property {SkillEffect[]} effects
 * @property {SkillAnimation} animation
 * @property {SkillVfx} [vfx]
 * @property {LevelUpgrade[]} [levelUpgrades] optional level-breakpoint overrides for `effects`
 *   — see effectiveEffectsForLevel below. Lets a skill hit harder at a level without being a
 *   separate skill entry ("Firebolt" itself scales, rather than a duplicate "Firebolt Rank 2").
 */

/**
 * @typedef {Object} LevelUpgrade
 * @property {number} level player level this breakpoint applies from
 * @property {SkillEffect[]} effects a full replacement for the base `effects` array from this
 *   level on — same length as the base array, and each entry's `type` must match the base
 *   effect at that index (a level-up can't turn a damage effect into a stun). Authored by
 *   cloning the base effects and editing only the numbers that change (see the Skill Builder's
 *   Level Scaling section), rather than a partial diff, so there's never ambiguity about which
 *   fields "didn't change."
 */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function validateTargeting(targeting, label) {
  if (!isObj(targeting)) throw new Error(`${label} targeting must be an object`);
  if (!Array.isArray(targeting.modes) || targeting.modes.length === 0) {
    throw new Error(`${label} targeting.modes must be a non-empty array`);
  }
  for (const m of targeting.modes) {
    if (!TARGETING_MODES.includes(m)) throw new Error(`${label} targeting has unknown mode "${m}"`);
  }
  if (typeof targeting.range !== 'number' || targeting.range < 0) {
    throw new Error(`${label} targeting.range must be a non-negative number`);
  }
  if (!TARGETING_SHAPES.includes(targeting.shape)) {
    throw new Error(`${label} targeting has unknown shape "${targeting.shape}"`);
  }
  if (targeting.shape === 'aoe-circle' || targeting.shape === 'aoe-line') {
    if (typeof targeting.radius !== 'number' || targeting.radius <= 0) {
      throw new Error(`${label} targeting.radius must be a positive number for shape "${targeting.shape}"`);
    }
  }
  if (targeting.shape === 'aoe-cone' && (typeof targeting.angleDeg !== 'number' || targeting.angleDeg <= 0)) {
    throw new Error(`${label} targeting.angleDeg must be a positive number for shape "aoe-cone"`);
  }
  if (targeting.shape === 'chain' && (typeof targeting.chainCount !== 'number' || targeting.chainCount < 1)) {
    throw new Error(`${label} targeting.chainCount must be a positive number for shape "chain"`);
  }
}

function validateEffect(effect, label) {
  if (!isObj(effect)) throw new Error(`${label} has a non-object effect entry`);
  if (!EFFECT_TYPES.includes(effect.type)) throw new Error(`${label} effect has unknown type "${effect.type}"`);
  const num = (key) => {
    if (typeof effect[key] !== 'number') throw new Error(`${label} effect "${effect.type}" needs numeric "${key}"`);
  };
  switch (effect.type) {
    case 'damage':
      num('amount');
      if (effect.damageType !== undefined && !DAMAGE_TYPES.includes(effect.damageType)) {
        throw new Error(`${label} damage effect has unknown damageType "${effect.damageType}"`);
      }
      break;
    case 'heal':
      num('amount');
      break;
    case 'stun':
    case 'freeze':
    case 'sleep':
    case 'taunt':
      num('durationMs');
      break;
    case 'slow':
      num('durationMs');
      num('slowPercent');
      break;
    case 'dot':
      num('damagePerTick');
      num('tickMs');
      num('durationMs');
      if (effect.damageType !== undefined && !DAMAGE_TYPES.includes(effect.damageType)) {
        throw new Error(`${label} dot effect has unknown damageType "${effect.damageType}"`);
      }
      break;
    case 'hot':
      num('healPerTick');
      num('tickMs');
      num('durationMs');
      break;
    case 'buff':
      if (!BUFF_STATS.includes(effect.stat)) throw new Error(`${label} buff effect has unknown stat "${effect.stat}"`);
      num('amount');
      num('durationMs');
      break;
    case 'shield':
      num('amount');
      num('durationMs');
      break;
    case 'knockback':
    case 'pull':
      num('distance');
      break;
    default:
      throw new Error(`${label} unhandled effect type "${effect.type}"`);
  }
}

function validateTimelineEvent(event, label) {
  if (!isObj(event)) throw new Error(`${label} has a non-object timeline entry`);
  if (!TIMELINE_EVENT_TYPES.includes(event.type)) throw new Error(`${label} timeline event has unknown type "${event.type}"`);
  if (typeof event.atMs !== 'number' || event.atMs < 0) throw new Error(`${label} timeline event "${event.type}" needs a non-negative number "atMs"`);
  if (event.type === 'pose') {
    if (!RIG_PARTS.includes(event.part)) throw new Error(`${label} pose event has unknown part "${event.part}"`);
    if (!isObj(event.rotationDeg) || ['x', 'y', 'z'].some((ax) => typeof event.rotationDeg[ax] !== 'number')) {
      throw new Error(`${label} pose event needs rotationDeg.{x,y,z} as numbers`);
    }
  } else {
    if (typeof event.vfxId !== 'string') throw new Error(`${label} ${event.type} event needs a string "vfxId"`);
    if (event.type === 'travel') {
      if (typeof event.endAtMs !== 'number' || event.endAtMs <= event.atMs) {
        throw new Error(`${label} travel event needs "endAtMs" greater than "atMs"`);
      }
    } else {
      if (event.anchor !== undefined && !VFX_ANCHORS.includes(event.anchor)) {
        throw new Error(`${label} ${event.type} event has unknown anchor "${event.anchor}"`);
      }
      if (event.anchorOffset !== undefined) {
        if (!isObj(event.anchorOffset) || ['x', 'y', 'z'].some((ax) => typeof event.anchorOffset[ax] !== 'number')) {
          throw new Error(`${label} ${event.type} event's anchorOffset must be {x,y,z} numbers`);
        }
      }
      if (event.durationMs !== undefined && (typeof event.durationMs !== 'number' || event.durationMs <= 0)) {
        throw new Error(`${label} ${event.type} event's durationMs must be a positive number`);
      }
    }
  }
}

function validateAnimation(animation, label) {
  if (!isObj(animation)) throw new Error(`${label} animation must be an object`);
  for (const key of ['windupMs', 'effectMs', 'recoveryMs']) {
    if (typeof animation[key] !== 'number' || animation[key] < 0) {
      throw new Error(`${label} animation.${key} must be a non-negative number`);
    }
  }
  if (animation.attackClipId !== undefined && typeof animation.attackClipId !== 'string') {
    throw new Error(`${label} animation.attackClipId must be a string`);
  }
  if (animation.timeline !== undefined) {
    if (!Array.isArray(animation.timeline)) throw new Error(`${label} animation.timeline must be an array`);
    for (const event of animation.timeline) validateTimelineEvent(event, label);
  }
}

function validateVfx(vfx, label) {
  if (vfx === undefined) return;
  if (!isObj(vfx)) throw new Error(`${label} vfx must be an object`);
  for (const key of ['castVfxId', 'travelVfxId', 'impactVfxId']) {
    if (vfx[key] !== undefined && typeof vfx[key] !== 'string') throw new Error(`${label} vfx.${key} must be a string`);
  }
  for (const key of ['castAnchor', 'impactAnchor']) {
    if (vfx[key] !== undefined && !VFX_ANCHORS.includes(vfx[key])) {
      throw new Error(`${label} vfx.${key} must be one of ${VFX_ANCHORS.join(', ')}`);
    }
  }
}

/** @param {any} skill @returns {void} throws on the first problem found */
export function validateSkillDef(skill) {
  if (!isObj(skill)) throw new Error('Skill must be an object');
  if (!skill.id || typeof skill.id !== 'string') throw new Error('Skill missing string "id"');
  const label = `Skill "${skill.id}"`;

  if (skill.classId !== undefined && typeof skill.classId !== 'string') {
    throw new Error(`${label} classId must be a string`);
  }
  if (skill.key !== undefined && (typeof skill.key !== 'number' || skill.key < 1 || skill.key > 8)) {
    throw new Error(`${label} key must be a number 1-8`);
  }
  if (skill.requiredLevel !== undefined && (typeof skill.requiredLevel !== 'number' || skill.requiredLevel < 1 || skill.requiredLevel > MAX_LEVEL)) {
    throw new Error(`${label} requiredLevel must be a number 1-${MAX_LEVEL}`);
  }
  if (!skill.name || typeof skill.name !== 'string') throw new Error(`${label} missing string "name"`);
  if (skill.soundUrl !== undefined && typeof skill.soundUrl !== 'string') {
    throw new Error(`${label} soundUrl must be a string`);
  }
  if (typeof skill.resourceCost !== 'number' || skill.resourceCost < 0) {
    throw new Error(`${label} resourceCost must be a non-negative number`);
  }
  if (typeof skill.cooldownMs !== 'number' || skill.cooldownMs < 0) {
    throw new Error(`${label} cooldownMs must be a non-negative number`);
  }
  if (typeof skill.castMs !== 'number' || skill.castMs < 0) {
    throw new Error(`${label} castMs must be a non-negative number`);
  }
  if (typeof skill.canMoveDuringCast !== 'boolean') {
    throw new Error(`${label} canMoveDuringCast must be a boolean`);
  }
  validateTargeting(skill.targeting, label);
  if (!Array.isArray(skill.effects)) throw new Error(`${label} effects must be an array`);
  for (const effect of skill.effects) validateEffect(effect, label);
  validateAnimation(skill.animation, label);
  validateVfx(skill.vfx, label);
  validateLevelUpgrades(skill.levelUpgrades, skill.effects, label);
}

function validateLevelUpgrades(levelUpgrades, baseEffects, label) {
  if (levelUpgrades === undefined) return;
  if (!Array.isArray(levelUpgrades)) throw new Error(`${label} levelUpgrades must be an array`);
  for (const upgrade of levelUpgrades) {
    if (!isObj(upgrade)) throw new Error(`${label} has a non-object levelUpgrades entry`);
    if (typeof upgrade.level !== 'number' || upgrade.level < 1 || upgrade.level > MAX_LEVEL) {
      throw new Error(`${label} levelUpgrades entry needs a number "level" 1-${MAX_LEVEL}`);
    }
    if (!Array.isArray(upgrade.effects) || upgrade.effects.length !== baseEffects.length) {
      throw new Error(`${label} levelUpgrades entry (level ${upgrade.level}) effects must match the base effects array's length`);
    }
    upgrade.effects.forEach((effect, i) => {
      validateEffect(effect, label);
      if (effect.type !== baseEffects[i].type) {
        throw new Error(`${label} levelUpgrades entry (level ${upgrade.level}) effect ${i} must stay type "${baseEffects[i].type}"`);
      }
    });
  }
}

/**
 * The effects that actually apply for a caster at `level` — the highest
 * levelUpgrades entry whose level they've reached, else the skill's base
 * effects. This is the one place level-scaling takes effect: both the
 * server (actual damage/heal) and any client display (Skill Book, tooltips)
 * must call this instead of reading `skill.effects` directly, so a scaled
 * skill is never under- or over-applied relative to what's shown.
 * @param {SkillDef} skill
 * @param {number} level
 * @returns {SkillEffect[]}
 */
export function effectiveEffectsForLevel(skill, level) {
  if (!skill.levelUpgrades?.length) return skill.effects;
  let best = null;
  for (const upgrade of skill.levelUpgrades) {
    if (upgrade.level <= level && (!best || upgrade.level > best.level)) best = upgrade;
  }
  return best ? best.effects : skill.effects;
}

/** 1 = base skill, 2+ = how many level breakpoints the caster has reached — purely for display
 * (e.g. "Firebolt — Rank 2"), never used to pick the effects themselves (that's
 * effectiveEffectsForLevel above, keyed on level, not rank count). */
export function effectiveRankForLevel(skill, level) {
  if (!skill.levelUpgrades?.length) return 1;
  return 1 + skill.levelUpgrades.filter((u) => u.level <= level).length;
}

/**
 * How long after cast-start the effect should actually land — separate from
 * `castMs` (the server's "how long you're rooted/channeling" window): an
 * animation's windup+effect (legacy) or a timeline's furthest travel-arrival/
 * impact event can run longer than castMs, and applying damage/heal before
 * the effect visually reaches the target reads as the target dying before
 * the fireball arrives. The server schedules the actual hit at
 * max(castMs, this) — see server/index.js's use-ability handler.
 * @param {SkillDef} skill
 * @returns {number} ms since cast start
 */
export function computeImpactDelayMs(skill) {
  const { windupMs, effectMs, timeline } = skill.animation;
  if (timeline?.length) {
    let latest = 0;
    for (const event of timeline) {
      if (event.type === 'impact') latest = Math.max(latest, event.atMs);
      else if (event.type === 'travel') latest = Math.max(latest, event.endAtMs);
    }
    return latest;
  }
  return windupMs + effectMs;
}

/** @param {any[]} raw @returns {SkillDef[]} throws on the first invalid entry */
export function parseSkillDefs(raw) {
  if (!Array.isArray(raw)) throw new Error('Skill catalog must be an array');
  for (const skill of raw) validateSkillDef(skill);
  return raw;
}
