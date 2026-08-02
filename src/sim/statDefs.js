// src/sim/statDefs.js
// The Global Stat Engine (GSE): six primary attributes shared by every
// entity (players, NPCs, monsters), plus the pure formulas that turn them
// into derived combat numbers. Zero DOM/rendering dependencies, same purity
// rule as every other src/sim file — this must produce byte-identical
// results on the client (instant Character Sheet preview) and the server
// (which has the final say once "Apply" is pressed).
//
// A primary stat's RAW total (base class value + points a player has
// allocated + any temporary buff) is what's capped at STAT_HARD_CAP and
// persisted. The EFFECTIVE value fed into the derived-stat formulas below
// applies a soft-cap: allocation past STAT_SOFT_CAP_THRESHOLD becomes less
// efficient in STAT_SOFT_CAP_STEP-point chunks, so late-game min-maxing has
// diminishing (not zero) returns rather than a hard wall.

export const PRIMARY_STAT_IDS = ['STR', 'AGI', 'DEX', 'INT', 'WIS', 'VIT'];

export const PRIMARY_STAT_NAMES = {
  STR: 'Strength', AGI: 'Agility', DEX: 'Dexterity',
  INT: 'Intelligence', WIS: 'Wisdom', VIT: 'Vitality',
};

export const STAT_HARD_CAP = 255;
export const STAT_SOFT_CAP_THRESHOLD = 50;
export const STAT_SOFT_CAP_STEP = 10;
export const STAT_SOFT_CAP_DECAY = 0.10; // efficiency lost per step past the threshold

/** Zero-filled {STR:0, AGI:0, ...} — the shape every stat map (base/allocated/total) shares. */
export function zeroStats() {
  const out = {};
  for (const id of PRIMARY_STAT_IDS) out[id] = 0;
  return out;
}

/**
 * Raw -> effective value for one stat, applying the soft-cap diminishing
 * curve past STAT_SOFT_CAP_THRESHOLD. Every STAT_SOFT_CAP_STEP points beyond
 * the threshold count for STAT_SOFT_CAP_DECAY less (floored at 10% value, so
 * a stat is never worse than not having allocated the points at all).
 * @param {number} raw
 */
export function effectiveStatValue(raw) {
  if (raw <= STAT_SOFT_CAP_THRESHOLD) return raw;
  const over = raw - STAT_SOFT_CAP_THRESHOLD;
  let effective = STAT_SOFT_CAP_THRESHOLD;
  let remaining = over;
  let step = 0;
  while (remaining > 0) {
    const chunk = Math.min(STAT_SOFT_CAP_STEP, remaining);
    const efficiency = Math.max(0.1, 1 - STAT_SOFT_CAP_DECAY * (step + 1));
    effective += chunk * efficiency;
    remaining -= chunk;
    step += 1;
  }
  return effective;
}

/** base[stat] + allocated[stat] + buff[stat] + gear[stat], clamped to the hard cap — the RAW total persisted/shown. `gearStats` (src/sim/equipment.js's computeGearStatBonus) is optional so every existing caller with only 3 sources keeps working unchanged. */
export function totalStatValue(baseStats, allocatedStats, buffStats, stat, gearStats) {
  const raw = (baseStats?.[stat] || 0) + (allocatedStats?.[stat] || 0) + (buffStats?.[stat] || 0) + (gearStats?.[stat] || 0);
  return Math.min(STAT_HARD_CAP, Math.max(0, raw));
}

/** @returns {{STR:number,AGI:number,DEX:number,INT:number,WIS:number,VIT:number}} raw totals, hard-capped */
export function totalStats(baseStats, allocatedStats, buffStats, gearStats) {
  const out = {};
  for (const id of PRIMARY_STAT_IDS) out[id] = totalStatValue(baseStats, allocatedStats, buffStats, id, gearStats);
  return out;
}

/**
 * The Global Stat Engine formulas (Section 1.2 of the spec) — derived
 * combat numbers from a set of RAW primary-stat totals. Each stat is run
 * through effectiveStatValue() first, so allocation past the soft cap still
 * helps, just less. Percent-based outputs (crit/dodge/magicResist) are
 * fractions (0..1), pre-clamped to sane ceilings so a stacked build can't
 * reach 100% crit/dodge/resist.
 * @param {{STR:number,AGI:number,DEX:number,INT:number,WIS:number,VIT:number}} raw
 */
export function computeDerivedStats(raw) {
  const str = effectiveStatValue(raw.STR || 0);
  const agi = effectiveStatValue(raw.AGI || 0);
  const dex = effectiveStatValue(raw.DEX || 0);
  const int_ = effectiveStatValue(raw.INT || 0);
  const wis = effectiveStatValue(raw.WIS || 0);
  const vit = effectiveStatValue(raw.VIT || 0);

  return {
    maxHealthBonus: vit * 10,
    maxManaBonus: int_ * 12 + wis * 4,
    spellPower: int_ * 1.5,
    physPower: str * 1.5 + agi * 0.5,
    healPower: wis * 1.2,                          // "Wisdom increases Healing Power" (spec Section 1.1)
    critChance: Math.min(0.6, dex * 0.0005),      // "DEX * 0.05%" per point
    dodgeChance: Math.min(0.5, agi * 0.0004),     // "AGI * 0.04%" per point
    hpRegen: vit * 0.15,
    mpRegen: wis * 0.20 + int_ * 0.05,
    physDefense: vit * 0.3,                        // flat physical damage reduction
    magicResist: Math.min(0.75, wis * 0.003),       // fractional magic damage reduction
  };
}

/** @returns {{unassignedStatPoints:number, allocatedStats:object}} fresh stat-allocation state for a new/respec'd character. */
export function initStatAllocation() {
  return { unassignedStatPoints: 0, allocatedStats: zeroStats() };
}

/**
 * Validate + apply a client-requested allocation payload
 * (`{STR:1, INT:2}` — spec's Section 3.2 commit payload shape) against a
 * character's current pool. Pure — never mutates its inputs, so the server
 * can safely reject and discard a bad request.
 * @param {{unassignedStatPoints:number, allocatedStats:object}} state
 * @param {object} baseStats class base stats (for the hard-cap check)
 * @param {Object<string,number>} delta stat id -> points to add (must be a non-negative integer)
 * @returns {{ok:true, state:object} | {ok:false, reason:string}}
 */
export function applyStatAllocation(state, baseStats, delta) {
  if (!delta || typeof delta !== 'object') return { ok: false, reason: 'invalid-payload' };
  let spent = 0;
  const nextAllocated = { ...state.allocatedStats };
  for (const [stat, points] of Object.entries(delta)) {
    if (!PRIMARY_STAT_IDS.includes(stat)) return { ok: false, reason: `unknown-stat:${stat}` };
    if (!Number.isInteger(points) || points < 0) return { ok: false, reason: `invalid-amount:${stat}` };
    if (points === 0) continue;
    spent += points;
    const nextTotal = (baseStats?.[stat] || 0) + (nextAllocated[stat] || 0) + points;
    if (nextTotal > STAT_HARD_CAP) return { ok: false, reason: `hard-cap:${stat}` };
    nextAllocated[stat] = (nextAllocated[stat] || 0) + points;
  }
  if (spent > state.unassignedStatPoints) return { ok: false, reason: 'insufficient-points' };
  return {
    ok: true,
    state: { unassignedStatPoints: state.unassignedStatPoints - spent, allocatedStats: nextAllocated },
  };
}

/** Refund every allocated point back into the unassigned pool (a respec). Pure. */
export function respecStatAllocation(state) {
  const spent = PRIMARY_STAT_IDS.reduce((sum, id) => sum + (state.allocatedStats[id] || 0), 0);
  return { unassignedStatPoints: state.unassignedStatPoints + spent, allocatedStats: zeroStats() };
}
