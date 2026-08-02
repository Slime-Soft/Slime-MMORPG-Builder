// src/sim/platforms.js
// Walkable surfaces: props you stand ON TOP of rather than bump into.
//
// Until now a prop was one of two things — an obstacle (src/sim/collision.js)
// or decoration you pass straight through. Neither describes a pier: its deck
// sits 1.15m up, so a collider blocks the very thing it exists for, and no
// collider means the player walks through the boards at ground level. That
// gap is what this module fills.
//
// Pure and Three-free, same contract as collision.js and for the same reason:
// the server is authoritative for position and the client predicts it, so both
// must derive the exact same surface height from the exact same data or the
// player visibly bobs at every deck edge.
//
// WHAT YOU SEE IS WHAT YOU STAND ON. A platform's dimensions come from the
// prop type's own `walkable` block, authored next to the numbers the generator
// actually builds the deck from — not re-guessed here.
import { sampleTerrainHeight } from './world.js';
import { getPropType } from './propTypes.js';

/**
 * How far above your feet a surface can be and still be walked onto without
 * jumping. Deliberately smaller than the pier deck (1.15m): stepping over a
 * kerb should be free, hauling yourself onto a boardwalk should not. It's what
 * makes the pier stairs worth having instead of decoration.
 */
export const PLATFORM_STEP_UP = 0.5;

/**
 * Slack added to the step-up test, on top of PLATFORM_STEP_UP.
 *
 * A surface's height and the body's step-up allowance are measured from two
 * DIFFERENT terrain samples: the deck's from the ground under the prop's own
 * origin, the body's from the ground under the body. Those are never the same
 * point, so on anything but dead-flat ground they differ by a few centimetres
 * — and a prop whose deck is authored at exactly PLATFORM_STEP_UP (the stone
 * footbridge, whose whole design depends on being steppable without a ramp)
 * therefore passed or failed the test depending on which way that difference
 * happened to land. Frame to frame, step to step. Reported as the footbridge
 * "having no collision, you just run through it": the deck was being rejected
 * as too high, so the body stayed at terrain height and the boards passed
 * straight through it.
 *
 * 6 cm is chosen to cover that sampling gap and nothing more — it is far
 * smaller than the smallest gap this system has to keep meaningful (the
 * 0.5 m step-up vs the 1.15 m pier deck), so the pier still needs its stairs.
 */
export const PLATFORM_STEP_UP_TOLERANCE = 0.06;

/**
 * @typedef {{type:'deck', x:number, z:number, hw:number, hd:number, rot:number, top:number}} DeckPlatform
 * @typedef {{type:'ramp', x:number, z:number, hw:number, hd:number, rot:number, low:number, high:number}} RampPlatform
 *   A ramp rises along its own local +Z: `low` at local z = -hd, `high` at +hd.
 * @typedef {DeckPlatform | RampPlatform} Platform
 */

const degToRad = (deg) => ((deg || 0) * Math.PI) / 180;

// Same convention as collision.js's rotY: rotate a local offset by a Three.js
// rotation.y angle (negate `rot` to invert).
function rotY(lx, lz, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: lx * c + lz * s, z: -lx * s + lz * c };
}

/**
 * A prop's rotation about Y in radians, covering both the current 3-axis
 * `rotation` object and the older scalar `rotationDeg` — the same pair
 * src/render/scene.js's buildPropPlaceholder already has to handle.
 */
function propRotationY(prop) {
  if (prop.rotation && typeof prop.rotation.y === 'number') return degToRad(prop.rotation.y);
  return degToRad(prop.rotationDeg);
}

/**
 * The walkable surface one prop contributes, or null when it isn't one.
 * @param {Object} prop
 * @param {Object} world  needed for the terrain height under the prop
 */
export function propPlatform(prop, world) {
  if (!prop) return null;
  const def = getPropType(prop.type);
  if (!def || !def.walkable) return null;

  const { x, z } = prop.position;
  const scale = prop.scale ?? 1;
  // `position.y` is an offset ABOVE the ground, matching how the renderer
  // places every prop (`baseY + terrainY`) — so a deck's world height is the
  // terrain under it plus that offset plus the deck's own height.
  const baseY = sampleTerrainHeight(world, x, z) + (prop.position.y || 0);
  const w = def.walkable;
  const common = {
    x,
    z,
    hw: (w.width / 2) * scale,
    hd: (w.depth / 2) * scale,
    rot: propRotationY(prop),
  };
  if (w.kind === 'ramp') {
    return { type: 'ramp', ...common, low: baseY + w.low * scale, high: baseY + w.high * scale };
  }
  return { type: 'deck', ...common, top: baseY + w.top * scale };
}

/**
 * Every walkable surface in a map. Short by construction — only prop types
 * that declare `walkable` produce one — so callers scan it linearly rather
 * than paying for a spatial index the way collision.js has to.
 * @returns {Platform[]}
 */
export function buildWorldPlatforms(world) {
  const out = [];
  for (const prop of world.props || []) {
    const p = propPlatform(prop, world);
    if (p) out.push(p);
  }
  return out;
}

/** The surface height of one platform at (x,z), or null when (x,z) isn't over it. */
function surfaceOf(p, x, z) {
  const local = rotY(x - p.x, z - p.z, -p.rot);
  if (Math.abs(local.x) > p.hw || Math.abs(local.z) > p.hd) return null;
  if (p.type === 'deck') return p.top;
  // Ramp: linear along local Z, clamped at both ends so the very edge of the
  // footprint reads exactly `low`/`high` rather than an epsilon off it.
  const t = Math.min(1, Math.max(0, (local.z + p.hd) / (2 * p.hd)));
  return p.low + (p.high - p.low) * t;
}

/**
 * The height a body at (x,z) should stand at, given the terrain and every
 * walkable surface over it.
 *
 * `currentY` is what keeps a platform from acting like a lift: a surface only
 * counts when it's no more than PLATFORM_STEP_UP above where the body already
 * is, so walking into the SIDE of a pier does nothing while walking up its
 * stairs (or jumping) carries you onto the deck. Surfaces below the body are
 * always valid — that's just landing on one.
 *
 * @param {Platform[]} platforms
 * @param {number} terrainY  the real ground height at (x,z)
 * @param {number} currentY  the body's height right now
 */
export function surfaceHeightAt(platforms, x, z, terrainY, currentY) {
  let best = terrainY;
  const reach = currentY + PLATFORM_STEP_UP + PLATFORM_STEP_UP_TOLERANCE;
  for (const p of platforms) {
    const h = surfaceOf(p, x, z);
    // Only ever raises the floor: a deck sunk below the terrain it stands on
    // is a modelling accident, not an invitation to sink the player into a hill.
    if (h === null || h <= best || h > reach) continue;
    best = h;
  }
  return best;
}

/**
 * The `groundHeightFn` stepMovement wants, for a map that has walkable props.
 * Returns plain terrain height when there are none, so a map without a single
 * pier pays nothing.
 * @param {Object} world
 * @param {Platform[]} platforms
 */
/**
 * `createGroundHeightFn` for a map, built once and cached.
 *
 * Keyed on the world OBJECT, which is what makes the cache self-invalidating:
 * saving a map replaces `entry.world` with a freshly-parsed object on the
 * server and the client re-fetches one, so an edited map can never be served
 * a stale platform list — and a discarded world's entry is collectible.
 *
 * This is called from the movement hot path (every tick, both sides), which is
 * why it must not rebuild the platform list each time.
 */
const groundHeightFnCache = new WeakMap();
export function groundHeightFnFor(world) {
  let fn = groundHeightFnCache.get(world);
  if (!fn) {
    fn = createGroundHeightFn(world, buildWorldPlatforms(world));
    groundHeightFnCache.set(world, fn);
  }
  return fn;
}

export function createGroundHeightFn(world, platforms) {
  if (!platforms || platforms.length === 0) {
    return (x, z) => sampleTerrainHeight(world, x, z);
  }
  return (x, z, currentY) => {
    const terrainY = sampleTerrainHeight(world, x, z);
    // A caller that predates the third parameter gets terrain-only behaviour
    // rather than a body silently snapping onto every deck on the map.
    if (typeof currentY !== 'number') return terrainY;
    return surfaceHeightAt(platforms, x, z, terrainY, currentY);
  };
}
