// src/sim/quests.js
// Quest definitions + a pure quest engine. Every function here is plain data
// in / data out (mutating the state objects it's handed) with no socket or
// DOM dependency — so the exact same acceptQuest/applyKill/turnInQuest calls
// drive both a real player (from server socket handlers) and, later, a
// simulated "bot" player. That's the whole reason the logic lives here and
// not inside server socket closures.
//
// Objective types that work today: 'kill' (a monster GROUP, so slimes in
// area A can count while area B's don't), 'gather' (bring N of an item),
// and 'talk' (visit another NPC). A fourth type from the design — 'interact'
// with a world object — is intentionally absent: it needs the interaction/
// trigger system (WORLD_BUILDER_ROADMAP #15), which doesn't exist yet.

export const QUEST_TYPES = ['kill', 'gather', 'talk'];

/**
 * @typedef {Object} QuestDef
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string} giverNpcId              NPC that offers AND accepts turn-in
 * @property {{type:'kill'|'gather'|'talk', target:string, count:number}} objective
 *   target = monster group (kill) | itemId (gather) | npcId (talk)
 * @property {{xp?:number, gold?:number, items?:Array<{itemId:string, qty:number}>}} [rewards]
 * @property {boolean} [turnInAtTarget] 'talk' objectives only — hand the rewards over at the NPC you were
 *   sent to talk to, instead of walking back to `giverNpcId`. ("Guard: go see the Guild Master" — the guard's
 *   part is over the moment you accept, and the Guild Master pays out.) See turnInNpcId below, which is what
 *   every turn-in / head-icon path actually asks; `giverNpcId` still owns OFFERING the quest either way.
 * @property {string} [requiresQuestId] another quest's id that must be completed before this one can be accepted — for questlines ("talk to NPC X" unlocking a follow-up quest from the same NPC)
 * @property {number} [minLevel] player level required before the giver NPC offers this quest (default 1, i.e. no gate); also gates the giver's head-icon — see canAccept
 * @property {{switchId:string, state?:boolean}} [requiredSwitch] an additional accept gate on a GLOBAL event switch (see src/sim/events.js) — global only, no self-scoping: a quest's own unique id is already a natural namespace. Only meaningful for quests linked from an Event Object (World Editor's Events-mode "Give a Quest" panel); ignored otherwise.
 * @property {{switchId:string, state?:boolean}} [switchOnAccept] a GLOBAL event switch to WRITE the moment this quest is accepted (default state true).
 * @property {{switchId:string, state?:boolean}} [switchOnComplete] the same, written the moment it is turned in.
 *   These two are the write half of `requiredSwitch`'s read: one quest's completion switch is what unlocks a
 *   later quest, opens a door, changes an NPC's dialog sheet, or flips a `switchOn` event into being triggerable.
 *   That was already expressible by hand — a `setSwitch` command dropped into the right generated sheet — but
 *   only for the plain giver-turns-it-in shape: a `turnInAtTarget` quest is closed by the SERVER the instant you
 *   reach the target NPC, with no sheet running at all, so there was no script to hang the switch off. Living on
 *   the QuestDef instead means every accept path and every turn-in path applies them (see the server's
 *   applyQuestSwitches), which is the only way "when this quest finishes" can mean what it says.
 *   Global scope only, for the same reason requiredSwitch is: the quest id already namespaces them, and the
 *   whole point is for OTHER events to read what this quest did.
 * @property {string} [dialogActive] shown when the giver is talked to while this quest is accepted but not yet ready to turn in — event-authored quests only
 * @property {string} [dialogReady] shown when the giver is talked to once the objective is met; this is also when turn-in + rewards happen — event-authored quests only
 * @property {string} [dialogComplete] shown on every subsequent talk after turn-in — event-authored quests only
 * @property {string} [dialogLocked] shown when the giver is talked to while this quest CAN'T be offered yet —
 *   its `requiresQuestId` prerequisite isn't done, `minLevel` isn't reached, or `requiredSwitch` is off. Every
 *   other dialog field above maps to a questPhase; this one maps to 'locked', the phase a follow-up quest's
 *   giver sits in for most of the game. Without it that NPC has no eligible sheet at all and stands mute,
 *   which reads as a broken NPC rather than as "come back later" — event-authored quests only.
 */

/** @param {any} data @returns {QuestDef[]} */
export function parseQuests(data) {
  if (!Array.isArray(data)) throw new Error('Quests data must be an array');
  const seen = new Set();
  for (const q of data) {
    if (!q || typeof q !== 'object') throw new Error('Each quest must be an object');
    for (const key of ['id', 'name', 'giverNpcId', 'objective']) {
      if (!q[key]) throw new Error(`Quest missing required field: "${key}" (id: ${q.id || '?'})`);
    }
    if (seen.has(q.id)) throw new Error(`Duplicate quest id: "${q.id}"`);
    seen.add(q.id);
    const o = q.objective;
    if (!QUEST_TYPES.includes(o.type)) throw new Error(`Quest "${q.id}" has unknown objective type "${o.type}"`);
    if (!o.target) throw new Error(`Quest "${q.id}" objective missing target`);
    if (o.type !== 'talk' && (!Number.isFinite(o.count) || o.count < 1)) {
      throw new Error(`Quest "${q.id}" objective count must be a positive number`);
    }
    if (q.turnInAtTarget !== undefined) {
      if (typeof q.turnInAtTarget !== 'boolean') {
        throw new Error(`Quest "${q.id}" turnInAtTarget must be a boolean`);
      }
      if (q.turnInAtTarget && o.type !== 'talk') {
        throw new Error(`Quest "${q.id}" turnInAtTarget only applies to a 'talk' objective`);
      }
    }
    if (q.requiresQuestId !== undefined && typeof q.requiresQuestId !== 'string') {
      throw new Error(`Quest "${q.id}" requiresQuestId must be a string`);
    }
    if (q.minLevel !== undefined && (!Number.isFinite(q.minLevel) || q.minLevel < 1)) {
      throw new Error(`Quest "${q.id}" minLevel must be a positive number`);
    }
    for (const key of ['requiredSwitch', 'switchOnAccept', 'switchOnComplete']) {
      if (q[key] === undefined) continue;
      if (!q[key] || typeof q[key].switchId !== 'string') {
        throw new Error(`Quest "${q.id}" ${key} must have a switchId string`);
      }
      if (q[key].state !== undefined && typeof q[key].state !== 'boolean') {
        throw new Error(`Quest "${q.id}" ${key}.state must be a boolean`);
      }
    }
    if (q.rewards?.items !== undefined) {
      if (!Array.isArray(q.rewards.items)) throw new Error(`Quest "${q.id}" rewards.items must be an array`);
      for (const item of q.rewards.items) {
        if (!item || typeof item.itemId !== 'string') throw new Error(`Quest "${q.id}" has a reward item missing itemId`);
        if (!Number.isFinite(item.qty) || item.qty < 1) throw new Error(`Quest "${q.id}" has a reward item with an invalid qty`);
      }
    }
  }
  // Separate pass: requiresQuestId may point at a quest defined later in the
  // array, so this can't be checked against `seen` while it's still filling.
  for (const q of data) {
    if (q.requiresQuestId && !seen.has(q.requiresQuestId)) {
      throw new Error(`Quest "${q.id}" requiresQuestId "${q.requiresQuestId}" does not match any quest id`);
    }
    if (q.requiresQuestId === q.id) {
      throw new Error(`Quest "${q.id}" cannot require itself`);
    }
  }
  return data;
}

/**
 * Which NPC actually accepts this quest's turn-in and pays the rewards —
 * `giverNpcId` for everything, EXCEPT a 'talk' objective flagged
 * `turnInAtTarget`, where the NPC you were sent to visit pays out instead.
 *
 * Every turn-in path (server proximity check, the NPC's offer/turn-in
 * lists, the client's head-icon state) must ask this rather than reading
 * `giverNpcId` directly, or the quest becomes unturn-in-able at the one NPC
 * that's supposed to close it.
 */
export function turnInNpcId(quest) {
  if (quest.turnInAtTarget && quest.objective.type === 'talk') return quest.objective.target;
  return quest.giverNpcId;
}

/** How many the objective needs. 'talk' is always a single visit. */
export function objectiveGoal(quest) {
  return quest.objective.type === 'talk' ? 1 : quest.objective.count;
}

/** Fresh per-player quest state. `active` maps questId -> { progress }, `completed` is a set of turned-in questIds. */
export function initQuestState() {
  return { active: {}, completed: {} };
}

export function isActive(questState, questId) {
  return Object.prototype.hasOwnProperty.call(questState.active, questId);
}
export function isCompleted(questState, questId) {
  return questState.completed[questId] === true;
}

/** A quest is offerable by its giver if the player hasn't accepted or finished it, any prerequisite quest is already completed, the player meets its minLevel (default 1, i.e. no gate), and any requiredSwitch is set to the expected value (default true) in `switches` (a flat global switch map — see src/sim/events.js's player.eventState.switches). */
export function canAccept(questState, quest, playerLevel = 1, switches = {}) {
  if (quest.requiresQuestId && !isCompleted(questState, quest.requiresQuestId)) return false;
  if (playerLevel < (quest.minLevel || 1)) return false;
  if (quest.requiredSwitch && !!switches[quest.requiredSwitch.switchId] !== (quest.requiredSwitch.state !== false)) return false;
  return !isActive(questState, quest.id) && !isCompleted(questState, quest.id);
}

/**
 * Write this quest's `switchOnAccept`/`switchOnComplete` into a player's flat
 * GLOBAL switch map (`player.eventState.switches` — see src/sim/events.js).
 * No-op when the quest doesn't author one for this phase.
 *
 * Kept here rather than inlined at each server call site because there are
 * three ways a quest gets turned in (the giver's generated sheet, the
 * turn-in-quest socket, and the server's own auto-turn-in for
 * `turnInAtTarget`) and two ways it gets accepted — a switch that only fires
 * on some of them is worse than no switch at all, since the author has no way
 * to tell which path a player took.
 *
 * @param {QuestDef} quest
 * @param {'accept'|'complete'} phase
 * @param {Record<string, boolean>} switches  mutated in place
 * @returns {boolean} whether anything was written (the caller may need to
 *   re-check switch-gated state, e.g. a newly unlocked quest offer)
 */
export function applyQuestSwitch(quest, phase, switches) {
  const spec = phase === 'accept' ? quest.switchOnAccept : quest.switchOnComplete;
  if (!spec?.switchId) return false;
  switches[spec.switchId] = spec.state !== false;
  return true;
}

/** Accept a quest — adds it to `active` at 0 progress. Returns true if newly accepted. */
export function acceptQuest(questState, quest, playerLevel = 1, switches = {}) {
  if (!canAccept(questState, quest, playerLevel, switches)) return false;
  questState.active[quest.id] = { progress: 0 };
  return true;
}

/**
 * Record a monster kill against every active 'kill' quest whose target group
 * matches. Returns the ids of quests whose progress changed (for notifying
 * the client). Monsters with no group match nothing.
 */
export function applyKill(questState, quests, monsterGroup) {
  if (!monsterGroup) return [];
  const changed = [];
  for (const quest of quests) {
    if (quest.objective.type !== 'kill' || quest.objective.target !== monsterGroup) continue;
    const entry = questState.active[quest.id];
    if (!entry) continue;
    const goal = objectiveGoal(quest);
    if (entry.progress < goal) {
      entry.progress = Math.min(goal, entry.progress + 1);
      changed.push(quest.id);
    }
  }
  return changed;
}

/** Record talking to an NPC against active 'talk' quests targeting it. Returns changed quest ids. */
export function applyTalk(questState, quests, npcId) {
  const changed = [];
  for (const quest of quests) {
    if (quest.objective.type !== 'talk' || quest.objective.target !== npcId) continue;
    const entry = questState.active[quest.id];
    if (!entry) continue;
    if (entry.progress < 1) {
      entry.progress = 1;
      changed.push(quest.id);
    }
  }
  return changed;
}

/**
 * Whether an accepted quest can be turned in. kill/talk check tracked
 * progress; gather checks the live inventory (you "bring" the items, they
 * aren't tracked incrementally).
 */
export function isReadyToTurnIn(questState, quest, inventory) {
  const entry = questState.active[quest.id];
  if (!entry) return false;
  if (quest.objective.type === 'gather') {
    return (inventory[quest.objective.target] || 0) >= quest.objective.count;
  }
  return entry.progress >= objectiveGoal(quest);
}

/**
 * Turn a quest in at its giver: verify readiness, consume gathered items for
 * 'gather' quests, move it from active -> completed, and return the rewards
 * to grant. The caller (server) applies xp/gold/items to the player, since
 * those live in player state this module doesn't own.
 * @returns {{ok:true, rewards:object} | {ok:false, reason:string}}
 */
export function turnInQuest(questState, quest, inventory) {
  if (!isActive(questState, quest.id)) return { ok: false, reason: 'not-active' };
  if (!isReadyToTurnIn(questState, quest, inventory)) return { ok: false, reason: 'not-complete' };

  if (quest.objective.type === 'gather') {
    inventory[quest.objective.target] -= quest.objective.count; // consume the delivered items
  }
  delete questState.active[quest.id];
  questState.completed[quest.id] = true;
  return { ok: true, rewards: quest.rewards || {} };
}
