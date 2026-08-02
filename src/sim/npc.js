// src/sim/npc.js
// Town NPC data schema + idle-wander AI. NPCs are the wandering townsfolk
// from CLAUDE.md's City Life spec: cosmetic, non-combat, with a short
// dialog. Like monster AI this only ever runs server-side — NPCs aren't
// client-predicted, the client just renders whatever position the server
// broadcasts. Shop NPCs that stand behind a counter are a separate,
// hardcoded thing (see src/sim/interiors.js); this module is for the
// editor-authored overworld crowd.

/**
 * @typedef {Object} DialogChoice
 * @property {string} text            button label, e.g. "Yes"
 * @property {string} [next]          id of the next DialogNode; absent = dialog closes after this choice
 * @property {string} [acceptQuestId] clicking this choice also accepts this quest (subject to the normal canAccept gate)
 */
/**
 * @typedef {Object} DialogNode
 * @property {string} id
 * @property {string} text
 * @property {DialogChoice[]} [choices] omit for a plain "click to continue" node
 */
/**
 * @typedef {Object} DialogTree
 * @property {string} start  id of the first node
 * @property {DialogNode[]} nodes
 */

/**
 * @typedef {Object} NpcDef
 * @property {string} id
 * @property {string} name                 shown on a label above the NPC and in its dialog box
 * @property {{x:number,y:number,z:number}} position   home/spawn point (wandering stays near it)
 * @property {Object} [appearance]         character-generator params (gender, hair*, eyeColor, skinTone, outfitColor, seed)
 * @property {string[]} [dialog]           2–4 short lines, shown one at a time on interact — ignored if dialogTree is present
 * @property {DialogTree} [dialogTree]     branching alternative to `dialog`; takes over entirely when present
 * @property {boolean} [wander]            true = idle-wander near home; false/absent = stand still facing facingDeg
 * @property {number} [wanderRadius]       how far from home it strays (world units)
 * @property {number} [speed]              wander walk speed (units/sec)
 * @property {number} [facingDeg]          facing when standing still (only meaningful if !wander)
 */

import { resolveMovement } from './collision.js';

const NPC_RADIUS = 0.4;
const DEFAULT_WANDER_RADIUS = 8;
const DEFAULT_SPEED = 1.2;
const ARRIVE_EPSILON = 0.3;   // close enough to a wander target to count as "arrived"
const PAUSE_MIN_MS = 1500;
const PAUSE_MAX_MS = 4000;

/** Validates one NPC's dialogTree — id-referential integrity (start/next must point at a real node) is what actually protects the client, since a dangling reference there is a silent dead-end, not a crash. */
function validateDialogTree(tree, label) {
  if (!tree || typeof tree !== 'object') throw new Error(`${label} dialogTree must be an object`);
  if (!Array.isArray(tree.nodes) || tree.nodes.length === 0) {
    throw new Error(`${label} dialogTree.nodes must be a non-empty array`);
  }
  const nodeIds = new Set();
  for (const node of tree.nodes) {
    if (!node || typeof node !== 'object' || !node.id || typeof node.text !== 'string') {
      throw new Error(`${label} dialogTree has a node missing id/text`);
    }
    if (nodeIds.has(node.id)) throw new Error(`${label} dialogTree has duplicate node id "${node.id}"`);
    nodeIds.add(node.id);
    if (node.choices !== undefined) {
      if (!Array.isArray(node.choices)) throw new Error(`${label} dialogTree node "${node.id}" choices must be an array`);
      for (const choice of node.choices) {
        if (!choice || typeof choice.text !== 'string') {
          throw new Error(`${label} dialogTree node "${node.id}" has a choice missing text`);
        }
      }
    }
  }
  if (typeof tree.start !== 'string' || !nodeIds.has(tree.start)) {
    throw new Error(`${label} dialogTree.start "${tree.start}" does not match any node id`);
  }
  for (const node of tree.nodes) {
    for (const choice of node.choices || []) {
      if (choice.next !== undefined && !nodeIds.has(choice.next)) {
        throw new Error(`${label} dialogTree node "${node.id}" choice "${choice.text}" points at unknown next node "${choice.next}"`);
      }
    }
  }
}

/**
 * Structural validation so a malformed NPC in world.json fails loudly
 * instead of corrupting sim state. Mirrors validateMonsterSpawns in tower.js.
 * @param {any} npcs
 */
export function validateNpcs(npcs) {
  if (!Array.isArray(npcs)) throw new Error('World npcs must be an array');
  const seen = new Set();
  for (const n of npcs) {
    if (!n || typeof n !== 'object') throw new Error('Each NPC must be an object');
    for (const key of ['id', 'name', 'position']) {
      if (!(key in n)) throw new Error(`NPC missing required field: "${key}" (id: ${n.id || '?'})`);
    }
    if (seen.has(n.id)) throw new Error(`Duplicate NPC id: "${n.id}"`);
    seen.add(n.id);
    if (n.dialog !== undefined && !Array.isArray(n.dialog)) {
      throw new Error(`NPC "${n.id}" dialog must be an array of strings`);
    }
    if (n.dialogTree !== undefined) {
      validateDialogTree(n.dialogTree, `NPC "${n.id}"`);
    }
  }
}

/** Turn a static NpcDef into live runtime state (position + wander bookkeeping). Server-only. */
export function initNpcState(def) {
  return {
    ...def,
    position: { ...def.position },
    home: { x: def.position.x, z: def.position.z },
    wanderTarget: null,
    pauseUntil: 0,
  };
}

/**
 * Advance one NPC by one tick. Non-wandering NPCs never move. Wanderers pick
 * a random point within wanderRadius of home, walk to it, pause a random
 * beat, then pick another — a simple "milling about town" behavior. Mutates
 * and returns `npc` (server-only, no client reconciliation to keep pure for).
 *
 * @param {ReturnType<typeof initNpcState>} npc
 * @param {number} dt seconds
 * @param {number} now ms timestamp
 * @param {() => number} rng float in [0,1); see src/sim/rng.js — sim code never calls Math.random
 * @param {import('./collision.js').CollisionIndex|null} [collision] static world colliders
 */
export function stepNpcWander(npc, dt, now, rng, collision = null) {
  if (typeof rng !== 'function') throw new Error('stepNpcWander requires an rng (see src/sim/rng.js)');
  if (!npc.wander) return npc;
  if (now < npc.pauseUntil) return npc;

  const radius = npc.wanderRadius ?? DEFAULT_WANDER_RADIUS;
  const speed = npc.speed ?? DEFAULT_SPEED;

  if (!npc.wanderTarget) {
    const angle = rng() * Math.PI * 2;
    const dist = rng() * radius;
    npc.wanderTarget = {
      x: npc.home.x + Math.cos(angle) * dist,
      z: npc.home.z + Math.sin(angle) * dist,
    };
    return npc;
  }

  const dx = npc.wanderTarget.x - npc.position.x;
  const dz = npc.wanderTarget.z - npc.position.z;
  const dist = Math.hypot(dx, dz);

  if (dist < ARRIVE_EPSILON) {
    npc.wanderTarget = null;
    npc.pauseUntil = now + PAUSE_MIN_MS + rng() * (PAUSE_MAX_MS - PAUSE_MIN_MS);
    return npc;
  }

  const step = Math.min(speed * dt, dist);
  const moved = resolveMovement(
    collision,
    npc.position.x,
    npc.position.z,
    npc.position.x + (dx / dist) * step,
    npc.position.z + (dz / dist) * step,
    NPC_RADIUS
  );
  // Wedged against a building corner: drop the target and pick a new one next
  // tick, rather than grinding into the wall until the arrive-epsilon triggers.
  if (Math.hypot(moved.x - npc.position.x, moved.z - npc.position.z) < step * 0.25) {
    npc.wanderTarget = null;
  }
  npc.position.x = moved.x;
  npc.position.z = moved.z;
  return npc;
}
