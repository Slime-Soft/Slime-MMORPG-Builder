// src/sim/skillResolution.js
// Turns a SkillDef's targeting (src/sim/skillDefs.js) into the actual set of
// enemy candidates a cast hits — server-authoritative, never trust a client-
// supplied entity list. Self/ally targeting doesn't go through here: self is
// just the caster, ally is src/sim/party.js's partyMembersNear() — both
// resolved directly by the caller (server/index.js).
//
// Zero DOM/rendering dependencies, same purity rules as every other src/sim
// file — takes plain position/candidate data and a distance function, no
// knowledge of "player" vs "monster" shape.

/**
 * @param {{x:number,z:number}} a
 * @param {{x:number,z:number}} b
 * @returns {number}
 */
function distanceXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Angle (radians, atan2(dx,dz) convention — matches the client's facing calc) from `from` to `to`, XZ plane only. */
function angleTo(from, to) {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/** Smallest signed difference between two angles, in radians, always in [-PI, PI]. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * @typedef {Object} TargetCandidate
 * @property {string} id
 * @property {{x:number,y:number,z:number}} position
 */

/**
 * Resolves which of `candidates` (already filtered by the caller to
 * alive/attackable — e.g. non-friendly monsters with health > 0) a skill's
 * cast actually hits, from the caster's position/facing.
 * @param {import('./skillDefs.js').SkillDef} skill
 * @param {{x:number,y:number,z:number}} casterPosition
 * @param {number} facingAngle radians, atan2(moveX, moveZ) convention (0 = +Z)
 * @param {TargetCandidate[]} candidates
 * @param {string|null} [explicitTargetId] a client-selected target (Phase 3) —
 *   used for 'single'/chain's first hit when it's a valid, in-range candidate
 * @returns {TargetCandidate[]} the ones actually hit, nearest-first
 */
export function resolveEnemyTargets(skill, casterPosition, facingAngle, candidates, explicitTargetId = null) {
  const { range, shape } = skill.targeting;
  const inRange = candidates.filter((c) => distanceXZ(casterPosition, c.position) <= range);
  const explicit = explicitTargetId ? inRange.find((c) => c.id === explicitTargetId) : null;

  const byNearest = (list) => [...list].sort((a, b) => distanceXZ(casterPosition, a.position) - distanceXZ(casterPosition, b.position));

  switch (shape) {
    case 'single': {
      if (explicit) return [explicit];
      const sorted = byNearest(inRange);
      return sorted.length ? [sorted[0]] : [];
    }
    case 'aoe-circle': {
      // Ground-targeted at an explicit target's position when one was given
      // (e.g. Meteor dropped where you're aiming), else centered on the caster.
      const center = explicit ? explicit.position : casterPosition;
      const radius = skill.targeting.radius;
      return byNearest(candidates.filter((c) => distanceXZ(center, c.position) <= radius));
    }
    case 'aoe-cone': {
      const halfAngle = (skill.targeting.angleDeg / 2) * (Math.PI / 180);
      return byNearest(inRange.filter((c) => Math.abs(angleDiff(angleTo(casterPosition, c.position), facingAngle)) <= halfAngle));
    }
    case 'aoe-line': {
      // A rectangle `radius` wide, extending `range` forward along facing —
      // project each candidate onto the facing axis (forward distance) and
      // its perpendicular offset (side distance).
      const dirX = Math.sin(facingAngle);
      const dirZ = Math.cos(facingAngle);
      const halfWidth = skill.targeting.radius / 2;
      return byNearest(candidates.filter((c) => {
        const dx = c.position.x - casterPosition.x;
        const dz = c.position.z - casterPosition.z;
        const forward = dx * dirX + dz * dirZ;
        const side = Math.abs(dx * dirZ - dz * dirX);
        return forward >= 0 && forward <= range && side <= halfWidth;
      }));
    }
    case 'chain': {
      const sorted = byNearest(inRange);
      const first = explicit || sorted[0];
      if (!first) return [];
      const hit = [first];
      let from = first.position;
      const remaining = sorted.filter((c) => c.id !== first.id);
      const maxBounces = skill.targeting.chainCount;
      for (let i = 0; i < maxBounces && remaining.length; i++) {
        remaining.sort((a, b) => distanceXZ(from, a.position) - distanceXZ(from, b.position));
        const next = remaining.shift();
        if (distanceXZ(from, next.position) > range) break; // too far to bounce to
        hit.push(next);
        from = next.position;
      }
      return hit;
    }
    default:
      return [];
  }
}
