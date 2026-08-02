// src/sim/monster.js
// Pure monster AI. Deterministic given the same inputs, but this only ever
// runs server-side — monsters aren't client-predicted, the client just
// renders whatever position/health the server broadcasts.
import { distanceXZ } from './tower.js';
import { resolveMovement, MONSTER_RADIUS } from './collision.js';
import { isCCd } from './statusEffects.js';

/**
 * @typedef {Object} MonsterState
 * @property {string} id
 * @property {string} type
 * @property {{x:number,y:number,z:number}} position
 * @property {number} health
 * @property {number} maxHealth
 * @property {number} damage
 * @property {number} speed
 * @property {number} aggroRange
 * @property {boolean} [friendly] never aggros/attacks, and is skipped as a target by
 *   resolveAbilityEffect (server/index.js) — so it can't be attacked either. See the
 *   "Friendly" checkbox in the World Editor's monster spawn form.
 * @property {number} attackRange
 * @property {number} attackCooldownMs
 * @property {boolean} [wander] idle-wander near spawnPosition when it has no target — the monster-side
 *   equivalent of NpcDef.wander, authored by the "Wanders about" checkbox in the editor's Monsters mode
 * @property {number} [wanderRadius] how far from spawnPosition it strays (world units)
 * @property {{x:number,z:number}|null} [wanderTarget] runtime only — the point it's currently ambling toward
 * @property {number} [wanderPauseUntil] runtime only — ms timestamp it resumes wandering at
 * @property {import('../sim/monsterTypeDefs.js').MonsterAbilitySlotDef[]} [abilities]
 *   A Monster Builder catalog type's active moveset (abilitySlots filtered
 *   to unlockLevel <= configuredLevel), threaded onto spawn state at init.
 *   Absent for every monster spawned before this feature existed (slime/
 *   goblin/boss-golem, or any hand-authored spawn with no catalog type) —
 *   stepMonsterAI synthesizes a single legacy ability from damage/
 *   attackCooldownMs in that case, so no data migration is needed.
 * @property {Record<string, number>} [abilityCooldowns] ability id -> ms timestamp last used
 * @property {object[]} [statusEffects] stun/freeze/sleep/slow/dot/buff/shield state — see
 *   src/sim/statusEffects.js. Absent = none active (every read goes through that module's
 *   helpers, which treat a missing array as empty).
 */

// How many aggroRanges from home a monster will chase before giving up —
// scales with the monster's own aggroRange so a big-aggro boss naturally
// gets a bigger leash too, instead of one flat distance for every monster.
const LEASH_RANGE_MULTIPLIER = 3;
// Close enough to spawnPosition to stop "returning home" and resume normal
// target-acquisition — never exactly 0 so a monster doesn't jitter forever
// chasing an unreachable last few centimeters.
const HOME_ARRIVAL_THRESHOLD = 0.5;

// Idle wander (the "Wanders about" checkbox on a monster spawn) — the same
// pick-a-point/walk/pause loop the town NPCs use (stepNpcWander in
// src/sim/npc.js), reused here rather than invented afresh so a wandering
// boar and a wandering blacksmith read as the same behavior. It only ever
// runs in the "no target at all" branch below: aggro, chasing and leashing
// all outrank it, and a monster that has wandered off still returns to its
// spawnPosition when it leashes, which keeps the leash meaningful.
const DEFAULT_MONSTER_WANDER_RADIUS = 6;
const WANDER_ARRIVE_EPSILON = 0.3;
const WANDER_PAUSE_MIN_MS = 2000;
const WANDER_PAUSE_MAX_MS = 6000;
// Wandering is an idle stroll, not a chase — a monster that ambled at its
// full combat speed looks like it's permanently charging something.
const WANDER_SPEED_FACTOR = 0.45;

/**
 * One tick of idle wandering, returning the fields to merge into the
 * monster's next state. Kept separate from stepMonsterAI's main flow so the
 * "standing still" return stays a single expression in both cases.
 */
function stepWander(monster, dt, now, rng, collision) {
  const idle = { position: monster.position, wanderTarget: monster.wanderTarget ?? null, wanderPauseUntil: monster.wanderPauseUntil ?? 0 };
  if (!monster.wander || typeof rng !== 'function') return idle;
  if (now < idle.wanderPauseUntil) return idle;

  const home = monster.spawnPosition || monster.position;
  if (!idle.wanderTarget) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * (monster.wanderRadius ?? DEFAULT_MONSTER_WANDER_RADIUS);
    return { ...idle, wanderTarget: { x: home.x + Math.cos(angle) * dist, z: home.z + Math.sin(angle) * dist } };
  }

  const dx = idle.wanderTarget.x - monster.position.x;
  const dz = idle.wanderTarget.z - monster.position.z;
  const dist = Math.hypot(dx, dz);
  if (dist < WANDER_ARRIVE_EPSILON) {
    return { ...idle, wanderTarget: null, wanderPauseUntil: now + WANDER_PAUSE_MIN_MS + rng() * (WANDER_PAUSE_MAX_MS - WANDER_PAUSE_MIN_MS) };
  }

  const step = Math.min(monster.speed * WANDER_SPEED_FACTOR * dt, dist);
  const moved = resolveMovement(
    collision,
    monster.position.x,
    monster.position.z,
    monster.position.x + (dx / dist) * step,
    monster.position.z + (dz / dist) * step,
    monster.radius ?? MONSTER_RADIUS
  );
  // Wedged on a collider: drop the target and pick a fresh one next tick
  // instead of grinding into the wall — same guard stepNpcWander has.
  const blocked = Math.hypot(moved.x - monster.position.x, moved.z - monster.position.z) < step * 0.25;
  return {
    ...idle,
    position: { x: moved.x, y: monster.position.y, z: moved.z },
    wanderTarget: blocked ? null : idle.wanderTarget,
  };
}

/**
 * First off-cooldown ability in list order (= authoring priority — no
 * resource-pool gating, unlike the player-side tryUseAbility, since
 * monsters have no mana/stamina pool). Returns null if every ability is
 * still on cooldown (the monster just stands there that tick).
 */
function pickMonsterAbility(monster, abilities, now) {
  for (const ability of abilities) {
    const last = monster.abilityCooldowns?.[ability.id] || 0;
    if (now - last >= ability.cooldownMs) return ability;
  }
  return null;
}

/**
 * Advance one monster by one tick: chase the nearest alive player within
 * aggro range, and — once in range — use the first off-cooldown ability
 * from its moveset. Returns a new monster state plus an optional
 * attackEvent describing damage to apply — this function never mutates
 * player state directly, so the caller (server) stays the single place
 * that resolves combat outcomes.
 *
 * A monster that has been damaged locks onto its attacker via
 * `monster.aggroTargetId` (set by the server on any damaging hit or Taunt)
 * regardless of distance — otherwise a ranged attacker standing outside
 * aggroRange could damage a monster forever without it ever fighting back.
 * That lock releases once the target dies, leaves the floor (falls out of
 * the `players` list), or the monster chases it more than
 * `aggroRange * LEASH_RANGE_MULTIPLIER` from its own spawnPosition (a
 * leash, so a monster can't be kited across the entire map) — a leashed
 * monster walks straight back to spawnPosition and ignores every player,
 * including whoever is still standing right next to it, until it actually
 * arrives home, then resumes normal nearest-in-aggro-range targeting.
 *
 * @param {MonsterState} monster
 * @param {Array<{id:string, position:{x:number,y:number,z:number}, isDead:boolean}>} players
 * @param {number} dt seconds
 * @param {number} now ms timestamp
 * @param {import('./collision.js').CollisionIndex|null} [collision] static world
 *   colliders a chasing monster slides along. Overworld only — tower floors are
 *   bare rooms and pass none.
 * @param {(() => number)|null} [rng] float in [0,1); see src/sim/rng.js. Only used to pick idle-wander
 *   destinations — omit it and a `wander` monster simply stands still, so every existing caller keeps
 *   working unchanged.
 * @returns {MonsterState & { attackEvent: {targetId:string, damage:number, abilityId:string} | null }}
 */
export function stepMonsterAI(monster, players, dt, now, collision = null, rng = null) {
  if (monster.health <= 0) {
    return { ...monster, attackEvent: null }; // dead monsters don't act
  }
  if (monster.friendly) {
    // Friendly creatures (deer, chickens) are exactly the ones worth having
    // amble about, so they still wander — they just never aggro or attack.
    return { ...monster, ...stepWander(monster, dt, now, rng, collision), aggroTargetId: null, attackEvent: null };
  }
  if (isCCd(monster.statusEffects, now)) {
    return { ...monster, attackEvent: null }; // stunned/frozen/asleep: can't move or act, but stays targetable
  }

  const spawnPos = monster.spawnPosition || monster.position;
  const distFromHome = distanceXZ(monster.position, spawnPos);

  let target = null;
  if (monster.aggroTargetId) {
    target = players.find((p) => p.id === monster.aggroTargetId && !p.isDead) || null;
  }

  // Leash: drop a locked chase once too far from home, no matter how aggro
  // was acquired (a hit from anywhere, or wandering into range).
  if (target && distFromHome > monster.aggroRange * LEASH_RANGE_MULTIPLIER) {
    target = null;
  }

  // A wanderer is SUPPOSED to be away from its spawn point, so "go home"
  // can't trigger the moment it takes a step — it only kicks in once the
  // monster is outside its own wander area, i.e. it was actually dragged
  // out there by a chase. Non-wanderers keep the original hair-trigger.
  const homeThreshold = monster.wander
    ? Math.max(HOME_ARRIVAL_THRESHOLD, (monster.wanderRadius ?? DEFAULT_MONSTER_WANDER_RADIUS) + 1)
    : HOME_ARRIVAL_THRESHOLD;

  if (!target) {
    if (distFromHome > homeThreshold) {
      // Returning home — deliberately skip target re-acquisition until it
      // actually arrives, so leashing can't just instantly re-trigger from
      // whoever's still standing next to it (same intent as a real MMO's
      // "evading" state).
      const dx = spawnPos.x - monster.position.x;
      const dz = spawnPos.z - monster.position.z;
      const len = Math.hypot(dx, dz) || 1;
      const stepped = resolveMovement(
        collision,
        monster.position.x,
        monster.position.z,
        monster.position.x + (dx / len) * monster.speed * dt,
        monster.position.z + (dz / len) * monster.speed * dt,
        monster.radius ?? MONSTER_RADIUS
      );
      const position = { x: stepped.x, y: monster.position.y, z: stepped.z };
      // Clear any stale wander target too: it was picked around home, and
      // walking to it from wherever the chase ended is not "going home".
      return { ...monster, position, aggroTargetId: null, wanderTarget: null, attackEvent: null };
    }

    let nearest = null;
    let nearestDist = Infinity;
    for (const p of players) {
      if (p.isDead) continue;
      const d = distanceXZ(monster.position, p.position);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    if (nearest && nearestDist <= monster.aggroRange) {
      target = nearest;
    }
  }

  if (!target) {
    // Nothing worth reacting to — mill about if this spawn is a wanderer,
    // otherwise stand exactly where stepWander leaves it (unchanged).
    return { ...monster, ...stepWander(monster, dt, now, rng, collision), aggroTargetId: null, attackEvent: null };
  }

  const dist = distanceXZ(monster.position, target.position);

  if (dist > monster.attackRange) {
    // Chase: step toward the target at this monster's own speed.
    const dx = target.position.x - monster.position.x;
    const dz = target.position.z - monster.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const stepped = resolveMovement(
      collision,
      monster.position.x,
      monster.position.z,
      monster.position.x + (dx / len) * monster.speed * dt,
      monster.position.z + (dz / len) * monster.speed * dt,
      monster.radius ?? MONSTER_RADIUS
    );
    const position = { x: stepped.x, y: monster.position.y, z: stepped.z };
    return { ...monster, position, aggroTargetId: target.id, attackEvent: null };
  }

  // In range — use the first off-cooldown ability in this monster's moveset.
  const abilities = monster.abilities && monster.abilities.length
    ? monster.abilities
    : [{ id: 'attack', cooldownMs: monster.attackCooldownMs, power: monster.damage, kind: 'melee', windupMs: 0, effectMs: 0, recoveryMs: 0 }];
  const chosen = pickMonsterAbility(monster, abilities, now);
  if (!chosen) {
    return { ...monster, aggroTargetId: target.id, attackEvent: null }; // everything still on cooldown, just stand there
  }

  return {
    ...monster,
    aggroTargetId: target.id,
    abilityCooldowns: { ...(monster.abilityCooldowns || {}), [chosen.id]: now },
    attackEvent: { targetId: target.id, damage: chosen.power, abilityId: chosen.id },
  };
}
