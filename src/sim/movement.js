// src/sim/movement.js
// Zero DOM/rendering dependencies. Must run identically on client (prediction)
// and server (authoritative). Do not import Three.js or Socket.io here.
import { resolveMovement, PLAYER_RADIUS } from './collision.js';

export const PLAYER_SPEED = 6; // units per second
export const GRAVITY = 20; // units/s^2
export const JUMP_SPEED = 7; // initial upward velocity on jump, units/s
const GROUND_EPSILON = 0.01; // how close to groundHeightFn's result still counts as "grounded"

/**
 * @typedef {{ x: number, y: number, z: number, velocityY?: number }} Vec3
 * @typedef {{ moveX: number, moveZ: number, jump?: boolean }} InputIntent  // moveX/moveZ normalized -1..1; jump is edge-triggered (only does something while grounded)
 */

/**
 * Advance a player's position by one simulation step.
 * Pure function: same inputs always produce same outputs (determinism requirement).
 *
 * The server calls this as the authority and the client calls it to predict,
 * so BOTH must pass the same `collision` index (and `groundHeightFn`, when
 * given) or the two will disagree and the player will stutter against every
 * obstacle, or jump to two different heights. Passing neither means no
 * collision / flat ground at spawn height, which is what the tower floors
 * and interiors want.
 *
 * @param {Vec3} position current position (velocityY defaults to 0 if absent)
 * @param {InputIntent} input movement intent for this tick
 * @param {number} dt delta time in seconds
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds world bounds
 * @param {import('./collision.js').CollisionIndex|null} [collision] static world colliders
 * @param {((x:number,z:number,currentY:number)=>number)|null} [groundHeightFn] ground height at a
 *   given world XZ (e.g. `(x,z) => sampleTerrainHeight(world, x, z)`) — absent means flat ground
 *   at whatever Y the entity is already at (today's pre-jump behavior). The third argument is the
 *   body's CURRENT height, which walkable props need to decide whether a raised deck is close
 *   enough above the body to step onto (see src/sim/platforms.js); a plain terrain sampler
 *   simply ignores it.
 * @param {number} [speedMultiplier] 0..1, from a 'slow' status effect (src/sim/statusEffects.js's
 *   getMoveSpeedMultiplier) — 1 = unaffected. Does not affect jump/gravity, only horizontal speed.
 * @returns {Vec3} next position, always carrying `velocityY`
 */
export function stepMovement(position, input, dt, bounds, collision = null, groundHeightFn = null, speedMultiplier = 1) {
  const len = Math.hypot(input.moveX, input.moveZ) || 1;
  const nx = input.moveX / len;
  const nz = input.moveZ / len;

  const hasInput = input.moveX !== 0 || input.moveZ !== 0;
  const dx = hasInput ? nx * PLAYER_SPEED * speedMultiplier * dt : 0;
  const dz = hasInput ? nz * PLAYER_SPEED * speedMultiplier * dt : 0;

  const targetX = clamp(position.x + dx, bounds.minX, bounds.maxX);
  const targetZ = clamp(position.z + dz, bounds.minZ, bounds.maxZ);

  const { x, z } = resolveMovement(
    collision, position.x, position.z, targetX, targetZ, PLAYER_RADIUS
  );

  // Resolved BEFORE groundY, since a walkable-surface sampler needs to know
  // where the body already is to decide what it can step onto. Falls back to
  // the flat-ground reading (no platforms can apply at that point anyway).
  const currentY = position.y ?? (groundHeightFn ? groundHeightFn(x, z, 0) : 0);
  const groundY = groundHeightFn ? groundHeightFn(x, z, currentY) : (position.y ?? 0);
  let velocityY = position.velocityY || 0;
  const wasGrounded = currentY <= groundY + GROUND_EPSILON;
  if (wasGrounded) {
    velocityY = input.jump ? JUMP_SPEED : 0;
  } else {
    velocityY -= GRAVITY * dt;
  }
  let y = currentY + velocityY * dt;
  if (y <= groundY) {
    y = groundY;
    velocityY = 0;
  }

  return { x, y, z, velocityY };
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Validate an input intent shape coming over the network before trusting it.
 * Server must call this — never trust raw client input.
 */
export function sanitizeInput(raw) {
  const moveX = clampAxis(raw && raw.moveX);
  const moveZ = clampAxis(raw && raw.moveZ);
  const jump = !!(raw && raw.jump);
  // Client-assigned ordinal, echoed back untouched in the state snapshot so the
  // client knows which of its in-flight inputs the server has already applied
  // (see PredictedPlayer.reconcile). Never used to index anything server-side —
  // it is opaque, so a hostile value can't do more than confuse that client's
  // own prediction. 0 means "client isn't sequencing", and disables replay.
  const seq = typeof raw?.seq === 'number' && Number.isFinite(raw.seq) ? raw.seq : 0;
  return { moveX, moveZ, jump, seq };
}

function clampAxis(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(-1, v));
}
