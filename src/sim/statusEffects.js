// src/sim/statusEffects.js
// Real status-effect state for players and monsters — stun/freeze/sleep/
// slow/dot/hot/buff/shield — driven by src/sim/skillDefs.js's SkillEffect
// vocabulary. Zero DOM/rendering dependencies, same purity rules as every
// other src/sim file.
//
// Storage shape: a plain array on the entity (`entity.statusEffects`), each
// entry `{ type, expiresAt, ...type-specific fields }`. Every function here
// takes/returns that array — it never assumes "player" vs "monster" shape,
// so the exact same code resolves a player's Frost Nova landing on a
// monster and (once monster abilities gain an optional effects[] — not
// this pass) a boss's stun landing on a player.
//
// `taunt` is NOT stored here — it reuses the aggro-lock mechanism combat
// already has (`monster.aggroTargetId`, see server/index.js's
// resolveAbilityEffect), just set unconditionally rather than only on
// damage. A taunt's `durationMs` is not enforced as a timed release yet
// (the existing aggro lock is already indefinite-until-target-dies) — a
// deliberate scope trim, not an oversight.

export const CC_TYPES = ['stun', 'freeze', 'sleep'];

const isActive = (effect, now) => effect.expiresAt === undefined || now < effect.expiresAt;

/**
 * Returns a NEW statusEffects array with `effect` applied — refresh-by-type
 * (an existing entry of the same type is replaced, not stacked; simplest
 * correct rule, stacking is a future nice-to-have not needed now).
 * @param {object[]} statusEffects current array (may be undefined/null)
 * @param {import('./skillDefs.js').SkillEffect} effect
 * @param {number} now ms timestamp
 * @returns {object[]}
 */
export function applyStatusEffect(statusEffects, effect, now) {
  const list = (statusEffects || []).filter((e) => e.type !== effect.type);
  switch (effect.type) {
    case 'stun':
    case 'freeze':
    case 'sleep':
      list.push({ type: effect.type, expiresAt: now + effect.durationMs });
      break;
    case 'slow':
      list.push({ type: 'slow', expiresAt: now + effect.durationMs, slowPercent: effect.slowPercent });
      break;
    case 'dot':
      list.push({
        type: 'dot', expiresAt: now + effect.durationMs,
        damagePerTick: effect.damagePerTick, tickMs: effect.tickMs, damageType: effect.damageType,
        nextTickAt: now + effect.tickMs,
      });
      break;
    case 'hot':
      list.push({
        type: 'hot', expiresAt: now + effect.durationMs,
        healPerTick: effect.healPerTick, tickMs: effect.tickMs,
        nextTickAt: now + effect.tickMs,
      });
      break;
    case 'buff':
      list.push({ type: 'buff', expiresAt: now + effect.durationMs, stat: effect.stat, amount: effect.amount });
      break;
    case 'shield':
      list.push({ type: 'shield', expiresAt: now + effect.durationMs, remaining: effect.amount });
      break;
    default:
      return statusEffects || []; // damage/heal/taunt/knockback/pull aren't lingering status — no-op here
  }
  return list;
}

/**
 * Expires anything past its time and fires dot/hot ticks whose `nextTickAt`
 * has arrived (advancing it by tickMs, not resetting to `now` — so a missed
 * tick from a slow server frame doesn't get silently absorbed).
 * @returns {{ statusEffects: object[], events: {type:'dot'|'hot', amount:number, damageType?:string}[] }}
 */
export function tickStatusEffects(statusEffects, now) {
  const list = [];
  const events = [];
  for (const e of statusEffects || []) {
    if (!isActive(e, now)) continue;
    let entry = e;
    if ((e.type === 'dot' || e.type === 'hot') && now >= e.nextTickAt) {
      events.push(
        e.type === 'dot'
          ? { type: 'dot', amount: e.damagePerTick, damageType: e.damageType }
          : { type: 'hot', amount: e.healPerTick }
      );
      entry = { ...e, nextTickAt: e.nextTickAt + e.tickMs };
    }
    list.push(entry);
  }
  return { statusEffects: list, events };
}

/** True if stunned, frozen, or asleep right now — blocks movement, casting, and ability use. */
export function isCCd(statusEffects, now) {
  return (statusEffects || []).some((e) => CC_TYPES.includes(e.type) && isActive(e, now));
}

/** 0..1 movement speed multiplier from the strongest active slow (1 = unaffected). */
export function getMoveSpeedMultiplier(statusEffects, now) {
  let mult = 1;
  for (const e of statusEffects || []) {
    if (e.type === 'slow' && isActive(e, now)) mult = Math.min(mult, 1 - e.slowPercent);
  }
  return Math.max(0, mult);
}

/** Sum of active buff amounts for a given stat (src/sim/skillDefs.js's BUFF_STATS) — 0 if none active. */
export function getBuffAmount(statusEffects, stat, now) {
  let total = 0;
  for (const e of statusEffects || []) {
    if (e.type === 'buff' && e.stat === stat && isActive(e, now)) total += e.amount;
  }
  return total;
}

/**
 * Runs incoming damage through any active shield(s) before it reaches
 * health — each shield absorbs up to its remaining amount, depleted shields
 * are dropped. A `sleep` effect present in the same list is also broken
 * (removed) by taking damage, since ANY damage should wake a sleeping
 * target regardless of whether a shield fully absorbed it.
 * @returns {{ statusEffects: object[], remainingDamage: number }}
 */
export function absorbDamage(statusEffects, incomingDamage, now) {
  let remaining = incomingDamage;
  const list = [];
  for (const e of statusEffects || []) {
    if (!isActive(e, now)) continue;
    if (e.type === 'sleep' && incomingDamage > 0) continue; // broken by taking damage
    if (e.type === 'shield' && remaining > 0) {
      const absorbed = Math.min(e.remaining, remaining);
      remaining -= absorbed;
      const left = e.remaining - absorbed;
      if (left > 0) list.push({ ...e, remaining: left });
      continue;
    }
    list.push(e);
  }
  return { statusEffects: list, remainingDamage: remaining };
}
