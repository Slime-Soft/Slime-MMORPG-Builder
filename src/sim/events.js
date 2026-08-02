// src/sim/events.js
// Event Objects: the Bakin-style "any placed object (or an invisible trigger
// volume) can run a scripted command sequence" system. An event object owns
// one or more SHEETS (v1.1, added 2026-07-19) — each with its own optional
// precondition and its own command list; the first sheet (in authoring
// order) whose precondition passes and hasn't already used up its own
// runOnce is the one that runs when the object is triggered. This is what
// lets an NPC's dialog genuinely change over time (e.g. a quest-giver's
// pre-turn-in vs post-turn-in line) without piling nested branches inside a
// single script — v1 originally punted on this ("a branch command as the
// first step gets equivalent power"), but that only covers a single
// same-visit decision, not "this object behaves differently on a LATER
// visit," which needs its own eligibility state per alternative.
//
// EVENT_COMMAND_TYPES' essential command set, and a resumable-across-ticks executor modeled
// directly on server/index.js's pendingCasts/pendingImpacts pattern: the
// server owns a cursor per in-flight script, steps it once per tick, and
// this module never touches a socket or the DOM — same contract every other
// src/sim file follows.
//
// Switches (v1.3, added 2026-07-19) come in two scopes, matching Bakin's own
// "self switch" vs "global switch" distinction: a plain `setSwitch` writes
// into the player's flat GLOBAL namespace (`player.eventState.switches`),
// meant for cross-event coordination (e.g. one NPC setting a flag a
// DIFFERENT event's sheet condition reads). `{self:true}` instead writes
// into a namespace scoped to THIS event object's own id — needed because
// two unrelated NPCs both authoring a switch called e.g. "accepted" would
// otherwise silently collide in the shared global namespace. Self-switches
// are the default recommendation for a sheet's own precondition/runOnce
// bookkeeping; global switches are for the rarer "event B reacts to
// something event A did" case.
//
// Deliberately NOT built here (future work): the other ~34 wishlist command
// types (movies, image overlays, web browser embed, etc).
//
// Real quest integration (v1.4, added 2026-07-21): src/sim/quests.js's engine
// (objective tracking, level/switch gating, reward payout) is now drivable
// FROM a script via the `acceptQuest`/`turnInQuest` commands and the
// `questPhase` condition kind (`ctx.questPhase(questId)` → 'offer'|'active'|
// 'ready'|'done'|'locked', computed by the caller from quests.js's own
// canAccept/isActive/isReadyToTurnIn/isCompleted — this module stays
// decoupled from quests.js's player-shape specifics, same as the existing
// `questCompleted` hook for the `questState` condition kind). The World
// Editor's Events-mode "Give a Quest" panel is a convenience form that
// auto-generates 4 sheets (one per phase, each `runOnce:false` since the
// phase must be re-evaluated on every talk) from a single quest description —
// see src/editor/main.js's generateQuestSheets. Hand-authoring these
// primitives directly in the generic sheet/command editor is possible but
// not (yet) exposed in that UI.

import { validateTowerDungeon } from './towerDungeon.js';

export const EVENT_START_TYPES = ['talk', 'interact', 'enterArea', 'switchOn'];
/** Trigger distance for a talk/interact event that hasn't authored its own `range` box. Lives here (rather than as two drifting copies in server/index.js and src/main.js, which is what it was) so client and server agree by construction. */
export const DEFAULT_EVENT_INTERACT_RANGE = 5;
export const EVENT_ATTACH_TYPES = ['npc', 'prop', 'teleporter', 'gatheringNode'];
export const EVENT_COMMAND_TYPES = [
  'showDialog', 'giveItem', 'takeItem', 'setSwitch', 'branch', 'wait',
  'moveTo', 'setVisible', 'teleportPlayer', 'hp', 'mp', 'exp', 'gold',
  'playSound', 'shakeScreen', 'fadeScreen', 'learnSkill', 'setPlayerControl',
  'startQuest', 'updateQuestObjective', 'completeQuest',
  'acceptQuest', 'turnInQuest', 'openMerchantStore',
  'openCraftingStation', 'scheduleRespawn', 'rollGatherYield',
  'openTowerDungeon',
];

/**
 * @typedef {Object} EventCommand
 * @property {string} type one of EVENT_COMMAND_TYPES
 * Fields used per type (unused fields for a given type are ignored):
 * - showDialog: {text, choices?:[{text, next?:number}]}
 * - giveItem/takeItem: {itemId, qty}
 * - setSwitch: {switchId, value, self?:boolean} — self:true scopes this switch to THIS event object (see the file header's self-switch/global-switch note); default false (global, shared across all this player's events)
 * - branch: {condition:{kind:'switch'|'item'|'questState'|'questPhase', switchId?, self?:boolean, itemId?, qty?, questId?, state?, phase?}, ifCommands:EventCommand[], elseCommands:EventCommand[]}
 * - wait: {ms}
 * - moveTo: {targetId, x, z, speed?}
 * - setVisible: {targetId, visible}
 * - teleportPlayer: {x, y, z, mapId?}
 * - hp/mp: {delta}
 * - exp/gold: {delta}
 * - playSound: {soundId}
 * - shakeScreen: {intensity, durationMs}
 * - fadeScreen: {direction:'out'|'in', durationMs, color?}
 * - learnSkill: {skillId}
 * - setPlayerControl: {locked:boolean} — freezes/unfreezes movement AND
 *   ability use (implemented as a long-duration 'stun' status effect,
 *   cleared early on unlock — see src/sim/statusEffects.js's isCCd, already
 *   checked by both the movement tick and the use-ability handler). Covers
 *   Bakin's "Enable/Disable Player Operation" for the common cutscene case
 *   ("player enters boss room -> can't move/act until the intro dialog
 *   ends"); NOT split into separate move/jump/run toggles like Bakin's full
 *   set — a deliberate v1.2 scope trim.
 * - startQuest: {questId, name, description?} / completeQuest: {questId, text?}
 *   — registers or
 *   completes an entry in the player's Quest Log panel, DISPLAY ONLY: this
 *   is a separate, purely cosmetic namespace from src/sim/quests.js's own
 *   quest ids, and completing one has no automatic effect on player state —
 *   an author still uses giveItem/gold/exp/setSwitch etc. for the actual
 *   rewards/bookkeeping, same as any other script. `name`/`description` are
 *   only read by `startQuest` (first registration). `completeQuest` needs
 *   only `questId`; its optional `text` is the closing line the log entry
 *   shows once finished ("Delivered the parcel to Mira."), replacing the
 *   objective line. Without it a completed quest just stops showing an
 *   objective, which reads as the entry going blank.
 * - updateQuestObjective: {questId, text} — replaces the quest log entry's
 *   objective line (e.g. "Bring 3 flowers (0/3)" → "(3/3) — return to the
 *   farmer"). No automatic progress tracking — the author re-issues this
 *   whenever they want the displayed text to change (e.g. right after a
 *   `branch` on item count).
 * - acceptQuest/turnInQuest: {questId} — drives a REAL src/sim/quests.js
 *   QuestDef (objective tracking, level/switch gating, reward payout), unlike
 *   startQuest/completeQuest above which are purely cosmetic. `questId` must
 *   match an entry in the quest catalog (quests.json). The server applies
 *   these via quests.js's own acceptQuest/turnInQuest + the existing reward
 *   grant path — see server/index.js's applyEventEffect. Paired with the
 *   `questPhase` condition kind below, these are what the World Editor's
 *   Events-mode "Give a Quest" panel auto-generates into a 4-sheet script
 *   (offer/active/ready/done) rather than something an author typically
 *   hand-writes.
 * - openCraftingStation (v1.6, added 2026-07-25): {stationTypeId} — opens a
 *   crafting UI for the triggering player, scoped to the professions that
 *   station type serves. Exact same "unhandled command falls through to
 *   ctx.effects, server snapshots authoritative state, client opens a panel"
 *   shape as openMerchantStore — no special handling needed in
 *   stepEventScript itself. See server/index.js's applyEventEffect
 *   ('openCraftingStation' case, snapshots player.activeCraftingStation) and
 *   main.js's onEventStep.
 * - scheduleRespawn (v1.6): {ms} — writes a respawn timestamp onto THIS
 *   event object's own world-shared state (not per-player), so a gatherable
 *   object hidden via setVisible reappears on its own after `ms` even if the
 *   player who triggered it disconnects immediately after — see
 *   server/index.js's dedicated respawn-sweep tick pass, which is
 *   independent of activeEventRuns (the per-player script-cursor map) for
 *   exactly this reason.
 * - rollGatherYield (v1.6): {nodeType} — one of src/sim/gathering.js's
 *   NODE_TYPES ids. Unlike every other command, this one IS handled
 *   specially in stepEventScript: it calls ctx.rollNodeYield(nodeType), a
 *   caller-injected hook (server/index.js wires it to gathering.js's
 *   rollYield + the server's own live rng), and the resolved {itemId, qty}
 *   is pushed as an ordinary giveItem effect — keeping this module decoupled
 *   from gathering.js's rng-consuming logic, same "sim stays decoupled,
 *   server injects the real behavior via ctx" split already used for
 *   questCompleted/questPhase.
 * - openTowerDungeon (v1.7, added 2026-08-01): {title?, floors:[{name,
 *   mapId, requiredKills?, requiredMonsterId?}]} — opens the Tower panel
 *   (the floor list with per-floor Enter buttons) for the triggering
 *   player. This is what REPLACED the old hardcoded tower (tower/floors/
 *   *.json + the `enter-tower`/`advance-floor` sockets): a tower is now an
 *   ordinary event object whose floors are ordinary maps. Same "unhandled
 *   command falls through to ctx.effects, server snapshots authoritative
 *   state, client opens a panel" shape as openMerchantStore — the event
 *   object's OWN id is the tower's identity, so per-player unlock progress
 *   (server-side, keyed by that id) survives re-triggering the event and
 *   never collides with a second tower elsewhere in the world. See
 *   src/sim/towerDungeon.js for the schema/predicates and
 *   server/index.js's applyEventEffect + tower-* socket handlers.
 * - openMerchantStore (v1.5, added 2026-07-24): {items:[{itemId, price,
 *   stock?}], sellMultiplier?} — opens a buy/sell UI for the triggering
 *   player. `price` is the gold cost to buy one; `stock` is a positive
 *   integer or omitted for unlimited (no restock-timer support in v1 —
 *   an emptied stock stays empty for the rest of that player's session).
 *   `sellMultiplier` (default 0.5) scales an item's own catalog sell price
 *   when the player sells TO this merchant — any item the player owns can
 *   be sold, not just ones in `items`, matching how a real shop buys
 *   general goods but only stocks specific ones for sale. No server-side
 *   state mutation on trigger itself — server/index.js's applyEventEffect
 *   snapshots `items`/`sellMultiplier`/the player's position onto
 *   `player.activeMerchant` so the buy/sell socket handlers can validate
 *   against it authoritatively, same "sim computes, server applies" split
 *   as everything else here.
 */

/**
 * @typedef {Object} EventSheet
 * @property {string} [id] unique within this event object; auto-derived as `sheet-<index>` if omitted (only matters for completedSheetIds bookkeeping, not authoring)
 * @property {{kind:'switch'|'item'|'questState'|'questPhase', switchId?:string, self?:boolean, itemId?:string, qty?:number, questId?:string, state?:boolean, phase?:'offer'|'active'|'ready'|'done'}} [condition] omitted = always eligible — put an unconditional sheet LAST as the fallback, unless it's genuinely meant to preempt every other sheet
 * @property {EventCommand[]} commands
 * @property {boolean} [runOnce] default true — THIS SHEET stops being eligible again once it completes; other sheets on the same object are unaffected
 */

/**
 * @typedef {Object} EventObjectDef
 * @property {string} id
 * @property {string} [name] editor label only
 * @property {{x:number,y:number,z:number}} position
 * @property {'npc'|'prop'|'teleporter'|'gatheringNode'|null} [attachedType] null = standalone invisible trigger
 * @property {string} [attachedId] id into npcs[]/props[]/etc.
 * @property {{type:'talk'|'interact'|'enterArea'|'switchOn', zoneId?:string, switchId?:string, prompt?:string}} start
 *   `prompt` overrides the on-screen hint shown when a player is in range,
 *   for the two types that show one (talk/interact). Without it the client
 *   falls back to a generic "Press E to talk"/"Press E to interact", which
 *   reads wrong on anything that isn't a person or a chest — an author can
 *   now write "Press E to Fish".
 * @property {{width:number, length:number, height:number}} [range] the
 *   trigger volume for a talk/interact event, in metres: a box centred on
 *   `position` across X (width) and Z (length), rising `height` metres from
 *   `position.y` — it stands ON the ground rather than straddling it, which
 *   is what an author means by "3m tall". Omitted = the default spherical
 *   DEFAULT_EVENT_INTERACT_RANGE, which is all a single NPC ever needs; a box
 *   is for the cases a radius can't express — a doorway you trigger by
 *   walking through, a long market counter, a pressure plate you must be
 *   standing ON rather than merely near. The World Editor draws it as a
 *   wireframe box so it can be sized by eye.
 * @property {EventSheet[]} sheets non-empty — see selectEligibleSheet for how one gets picked
 * @property {string} [quest] links this event to a src/sim/quests.js QuestDef by id (quests.json is the source of truth, not this field) — set when the World Editor's "Give a Quest" panel auto-generated `sheets` above; a dangling/missing reference is a silent dead-end at runtime (questPhase just returns 'locked'), same convention as every other cross-reference in this file
 */

const isObj = (v) => v && typeof v === 'object';

/**
 * Is `point` (a player position) inside this event's trigger volume? Uses the
 * authored `range` box when there is one, otherwise a
 * DEFAULT_EVENT_INTERACT_RANGE circle on XZ — the default deliberately
 * ignores Y, matching how NPC talk range has always worked (nobody wants to
 * lose a conversation to standing on a step). A box, being explicitly
 * authored with a height, DOES check Y.
 * @param {EventObjectDef} eventDef
 * @param {{x:number,y?:number,z:number}} point
 */
export function isPointInEventRange(eventDef, point) {
  const p = eventDef.position;
  const r = eventDef.range;
  if (!r) {
    return Math.hypot(point.x - p.x, point.z - p.z) <= DEFAULT_EVENT_INTERACT_RANGE;
  }
  const baseY = p.y || 0;
  const y = point.y ?? baseY;
  return Math.abs(point.x - p.x) <= r.width / 2
    && Math.abs(point.z - p.z) <= r.length / 2
    // A little slack below the base so a player standing in a shallow dip, or
    // one frame of gravity below the floor, doesn't fall out of the volume.
    && y >= baseY - 0.5 && y <= baseY + r.height;
}

/**
 * Validates one command (recursing into branch's nested command arrays).
 * Throws with a labeled message on the first problem found.
 * @param {boolean} nested true when validating inside a branch's
 *   ifCommands/elseCommands — `wait` and a choice-bearing `showDialog` are
 *   only allowed at the top level of a script. Branches execute their
 *   nested commands synchronously in one tick (see stepEventScript), so
 *   anything that needs to PARK the script (a wait, or a dialog waiting on
 *   player input) inside a branch would have nowhere to resume from. This
 *   keeps the v1 executor a flat, provably-correct loop instead of a
 *   resumable recursive-descent interpreter — plain (choiceless) dialog,
 *   item/switch/stat mutation, teleport, etc. all work fine nested.
 */
function validateCommand(cmd, label, nested = false) {
  if (!isObj(cmd) || !EVENT_COMMAND_TYPES.includes(cmd.type)) {
    throw new Error(`${label} has an unknown or malformed command`);
  }
  const cLabel = `${label} command "${cmd.type}"`;
  switch (cmd.type) {
    case 'showDialog':
      if (typeof cmd.text !== 'string') throw new Error(`${cLabel} missing text`);
      if (cmd.choices !== undefined) {
        if (!Array.isArray(cmd.choices)) throw new Error(`${cLabel} choices must be an array`);
        if (nested && cmd.choices.length) throw new Error(`${cLabel} cannot have choices inside a branch (see validateCommand's nested doc)`);
        for (const c of cmd.choices) {
          if (!isObj(c) || typeof c.text !== 'string') throw new Error(`${cLabel} has a choice missing text`);
          if (c.next !== undefined && !Number.isInteger(c.next)) throw new Error(`${cLabel} choice "${c.text}" next must be an integer command index`);
        }
      }
      break;
    case 'giveItem':
    case 'takeItem':
      if (typeof cmd.itemId !== 'string') throw new Error(`${cLabel} missing itemId`);
      if (!Number.isFinite(cmd.qty) || cmd.qty < 1) throw new Error(`${cLabel} qty must be a positive number`);
      break;
    case 'setSwitch':
      if (typeof cmd.switchId !== 'string') throw new Error(`${cLabel} missing switchId`);
      if (typeof cmd.value !== 'boolean') throw new Error(`${cLabel} value must be a boolean`);
      if (cmd.self !== undefined && typeof cmd.self !== 'boolean') throw new Error(`${cLabel} self must be a boolean`);
      break;
    case 'branch': {
      if (nested) throw new Error(`${cLabel} cannot nest a branch inside another branch in v1`);
      if (!isObj(cmd.condition) || !['switch', 'item', 'questState', 'questPhase'].includes(cmd.condition.kind)) {
        throw new Error(`${cLabel} missing a valid condition.kind`);
      }
      if (cmd.condition.self !== undefined && typeof cmd.condition.self !== 'boolean') {
        throw new Error(`${cLabel} condition.self must be a boolean`);
      }
      if (!Array.isArray(cmd.ifCommands)) throw new Error(`${cLabel} ifCommands must be an array`);
      if (cmd.elseCommands !== undefined && !Array.isArray(cmd.elseCommands)) throw new Error(`${cLabel} elseCommands must be an array`);
      cmd.ifCommands.forEach((c, i) => validateCommand(c, `${cLabel} ifCommands[${i}]`, true));
      (cmd.elseCommands || []).forEach((c, i) => validateCommand(c, `${cLabel} elseCommands[${i}]`, true));
      break;
    }
    case 'wait':
      if (nested) throw new Error(`${cLabel} cannot use "wait" inside a branch in v1`);
      if (!Number.isFinite(cmd.ms) || cmd.ms < 0) throw new Error(`${cLabel} ms must be a non-negative number`);
      if (cmd.castBar !== undefined) {
        if (!isObj(cmd.castBar) || typeof cmd.castBar.label !== 'string') throw new Error(`${cLabel} castBar must be an object with a label`);
        if (cmd.castBar.gatherType !== undefined && typeof cmd.castBar.gatherType !== 'string') throw new Error(`${cLabel} castBar.gatherType must be a string`);
      }
      break;
    case 'moveTo':
      if (typeof cmd.targetId !== 'string') throw new Error(`${cLabel} missing targetId`);
      if (typeof cmd.x !== 'number' || typeof cmd.z !== 'number') throw new Error(`${cLabel} missing numeric x/z`);
      break;
    case 'setVisible':
      if (typeof cmd.targetId !== 'string') throw new Error(`${cLabel} missing targetId`);
      if (typeof cmd.visible !== 'boolean') throw new Error(`${cLabel} visible must be a boolean`);
      break;
    case 'teleportPlayer':
      if (typeof cmd.x !== 'number' || typeof cmd.y !== 'number' || typeof cmd.z !== 'number') {
        throw new Error(`${cLabel} missing numeric x/y/z`);
      }
      break;
    case 'hp':
    case 'mp':
    case 'exp':
    case 'gold':
      if (!Number.isFinite(cmd.delta)) throw new Error(`${cLabel} delta must be a number`);
      break;
    case 'playSound':
      if (typeof cmd.soundId !== 'string') throw new Error(`${cLabel} missing soundId`);
      break;
    case 'shakeScreen':
      if (!Number.isFinite(cmd.intensity) || cmd.intensity < 0) throw new Error(`${cLabel} intensity must be a non-negative number`);
      if (!Number.isFinite(cmd.durationMs) || cmd.durationMs < 0) throw new Error(`${cLabel} durationMs must be a non-negative number`);
      break;
    case 'fadeScreen':
      if (!['out', 'in'].includes(cmd.direction)) throw new Error(`${cLabel} direction must be "out" or "in"`);
      if (!Number.isFinite(cmd.durationMs) || cmd.durationMs < 0) throw new Error(`${cLabel} durationMs must be a non-negative number`);
      break;
    case 'learnSkill':
      if (typeof cmd.skillId !== 'string') throw new Error(`${cLabel} missing skillId`);
      break;
    case 'setPlayerControl':
      if (typeof cmd.locked !== 'boolean') throw new Error(`${cLabel} locked must be a boolean`);
      break;
    case 'startQuest':
      if (typeof cmd.questId !== 'string') throw new Error(`${cLabel} missing questId`);
      if (typeof cmd.name !== 'string') throw new Error(`${cLabel} missing name`);
      if (cmd.description !== undefined && typeof cmd.description !== 'string') throw new Error(`${cLabel} description must be a string`);
      break;
    case 'completeQuest':
      if (typeof cmd.questId !== 'string') throw new Error(`${cLabel} missing questId`);
      if (cmd.text !== undefined && typeof cmd.text !== 'string') throw new Error(`${cLabel} text must be a string`);
      break;
    case 'updateQuestObjective':
      if (typeof cmd.questId !== 'string') throw new Error(`${cLabel} missing questId`);
      if (typeof cmd.text !== 'string') throw new Error(`${cLabel} missing text`);
      break;
    case 'acceptQuest':
    case 'turnInQuest':
      if (typeof cmd.questId !== 'string') throw new Error(`${cLabel} missing questId`);
      break;
    case 'openMerchantStore':
      if (!Array.isArray(cmd.items) || !cmd.items.length) throw new Error(`${cLabel} items must be a non-empty array`);
      for (const it of cmd.items) {
        if (!isObj(it) || typeof it.itemId !== 'string' || !it.itemId) throw new Error(`${cLabel} has an item missing itemId`);
        if (!Number.isFinite(it.price) || it.price < 0) throw new Error(`${cLabel} item "${it.itemId}" price must be a non-negative number`);
        if (it.stock !== undefined && it.stock !== null && (!Number.isInteger(it.stock) || it.stock < 0)) {
          throw new Error(`${cLabel} item "${it.itemId}" stock must be a non-negative integer, or omitted for unlimited`);
        }
      }
      if (cmd.sellMultiplier !== undefined && (!Number.isFinite(cmd.sellMultiplier) || cmd.sellMultiplier < 0)) {
        throw new Error(`${cLabel} sellMultiplier must be a non-negative number`);
      }
      break;
    case 'openCraftingStation':
      if (typeof cmd.stationTypeId !== 'string' || !cmd.stationTypeId) throw new Error(`${cLabel} missing stationTypeId`);
      break;
    case 'openTowerDungeon':
      validateTowerDungeon(cmd, cLabel);
      break;
    case 'scheduleRespawn':
      if (!Number.isFinite(cmd.ms) || cmd.ms < 0) throw new Error(`${cLabel} ms must be a non-negative number`);
      break;
    case 'rollGatherYield':
      // Needs stepEventScript's own top-level loop to resolve ctx.rollNodeYield
      // (see the type's doc comment) — a branch's ifCommands/elseCommands run
      // through runSynchronous instead, which has no such special case and
      // would push the unresolved command itself as a bogus effect.
      if (nested) throw new Error(`${cLabel} cannot use "rollGatherYield" inside a branch in v1`);
      if (typeof cmd.nodeType !== 'string' || !cmd.nodeType) throw new Error(`${cLabel} missing nodeType`);
      break;
  }
}

/**
 * Structural + referential validation, mirroring validateDialogTree's
 * "dangling reference is a silent dead-end, not a crash" philosophy.
 * @param {any} events
 * @param {{npcIds?:Set<string>, propIds?:Set<string>, teleporterIds?:Set<string>, gatheringNodeIds?:Set<string>}} [ctx]
 */
export function validateEventObjects(events, ctx = {}) {
  if (!Array.isArray(events)) throw new Error('World events must be an array');
  const attachIdSets = {
    npc: ctx.npcIds, prop: ctx.propIds, teleporter: ctx.teleporterIds, gatheringNode: ctx.gatheringNodeIds,
  };
  const seen = new Set();
  for (const ev of events) {
    if (!isObj(ev)) throw new Error('Each event object must be an object');
    for (const key of ['id', 'position', 'start', 'sheets']) {
      if (!(key in ev)) throw new Error(`Event object missing required field: "${key}" (id: ${ev.id || '?'})`);
    }
    if (seen.has(ev.id)) throw new Error(`Duplicate event object id: "${ev.id}"`);
    seen.add(ev.id);
    const label = `Event "${ev.id}"`;
    if (typeof ev.position.x !== 'number' || typeof ev.position.z !== 'number') {
      throw new Error(`${label} has a non-numeric position`);
    }
    if (ev.quest !== undefined && typeof ev.quest !== 'string') {
      throw new Error(`${label} quest must be a string`);
    }
    if (ev.attachedType !== undefined && ev.attachedType !== null) {
      if (!EVENT_ATTACH_TYPES.includes(ev.attachedType)) throw new Error(`${label} has unknown attachedType "${ev.attachedType}"`);
      if (typeof ev.attachedId !== 'string') throw new Error(`${label} attachedType set but attachedId missing`);
      const idSet = attachIdSets[ev.attachedType];
      if (idSet && !idSet.has(ev.attachedId)) {
        throw new Error(`${label} attachedId "${ev.attachedId}" does not match any placed ${ev.attachedType}`);
      }
    }
    if (!isObj(ev.start) || !EVENT_START_TYPES.includes(ev.start.type)) {
      throw new Error(`${label} has an unknown or malformed start condition`);
    }
    if (ev.start.type === 'switchOn' && typeof ev.start.switchId !== 'string') {
      throw new Error(`${label} start type "switchOn" missing switchId`);
    }
    if (ev.start.type === 'enterArea' && typeof ev.start.zoneId !== 'string') {
      throw new Error(`${label} start type "enterArea" missing zoneId`);
    }
    if (ev.start.prompt !== undefined && typeof ev.start.prompt !== 'string') {
      throw new Error(`${label} start prompt must be a string`);
    }
    if (ev.range !== undefined) {
      if (!isObj(ev.range)) throw new Error(`${label} range must be an object`);
      for (const dim of ['width', 'length', 'height']) {
        const v = ev.range[dim];
        if (typeof v !== 'number' || !(v > 0) || v > 500) {
          throw new Error(`${label} range.${dim} must be a number greater than 0 and at most 500 (metres)`);
        }
      }
    }
    if (!Array.isArray(ev.sheets) || ev.sheets.length === 0) {
      throw new Error(`${label} sheets must be a non-empty array`);
    }
    const sheetIds = new Set();
    ev.sheets.forEach((sheet, i) => {
      const sLabel = `${label} sheets[${i}]`;
      if (!isObj(sheet)) throw new Error(`${sLabel} must be an object`);
      const id = sheet.id || `sheet-${i}`;
      if (sheetIds.has(id)) throw new Error(`${label} has duplicate sheet id "${id}"`);
      sheetIds.add(id);
      if (sheet.condition !== undefined) {
        if (!isObj(sheet.condition) || !['switch', 'item', 'questState', 'questPhase'].includes(sheet.condition.kind)) {
          throw new Error(`${sLabel} has an invalid condition.kind`);
        }
        if (sheet.condition.self !== undefined && typeof sheet.condition.self !== 'boolean') {
          throw new Error(`${sLabel} condition.self must be a boolean`);
        }
      }
      if (!Array.isArray(sheet.commands)) throw new Error(`${sLabel} commands must be an array`);
      sheet.commands.forEach((c, ci) => validateCommand(c, `${sLabel} commands[${ci}]`));
      if (sheet.runOnce !== undefined && typeof sheet.runOnce !== 'boolean') {
        throw new Error(`${sLabel} runOnce must be a boolean`);
      }
    });
  }
}

/** Fresh per-player event runtime state — parallels initQuestState()'s shape. */
export function initEventRuntimeState() {
  return { switches: {} };
}

/** Fresh per-event-object world-shared state (visible/invisible, per-sheet completion, pending respawn) — process-lifetime, not per-player, mirroring how a teleporter/gathering-node's cooldown is already global today. `respawnAt` (0 = none pending) is set by scheduleRespawn and consumed by server/index.js's dedicated respawn-sweep tick pass — deliberately NOT tied to any player's activeEventRuns cursor, since that dies on disconnect (see the scheduleRespawn doc comment above). */
export function initEventObjectWorldState() {
  return { visible: true, completedSheetIds: {}, respawnAt: 0 };
}

/** A sheet's bookkeeping id — its authored `id`, or `sheet-<index>` if it didn't set one. Index-derived ids shift if sheets are reordered/inserted, so an author relying on runOnce persistence across edits should give a sheet an explicit id; this is a minor, accepted rough edge for v1.1. */
function sheetIdFor(sheet, index) {
  return sheet.id || `sheet-${index}`;
}

/** The actual storage key for a switch — namespaced to `ctx.eventId` when `self` is true, so two different event objects' same-named switch never collide (see the file header's self-switch/global-switch note). `ctx.eventId` must be set by the caller (server/index.js's buildEventCtx) whenever self-switches are in play. Exported so server/index.js's applyEventEffect can compute the identical key when applying a `setSwitch` effect descriptor to real player state. */
export function switchKey(switchId, self, ctx) {
  return self ? `${ctx.eventId}::${switchId}` : switchId;
}

function evalCondition(condition, ctx) {
  if (condition.kind === 'switch') {
    const actual = !!ctx.switches[switchKey(condition.switchId, condition.self, ctx)];
    return actual === (condition.state !== false);
  }
  if (condition.kind === 'item') {
    return (ctx.inventory[condition.itemId] || 0) >= (condition.qty ?? 1);
  }
  if (condition.kind === 'questState') {
    return !!ctx.questCompleted?.(condition.questId) === (condition.state !== false);
  }
  if (condition.kind === 'questPhase') {
    return ctx.questPhase?.(condition.questId) === condition.phase;
  }
  return false;
}

/**
 * Picks which sheet should run right now — the FIRST (authoring order) sheet
 * whose precondition passes (or has none) and hasn't already used up its own
 * runOnce. `ctx.completedSheetIds` is this event object's world-shared
 * `completedSheetIds` map (see initEventObjectWorldState). Returns
 * {sheet, index, id} or null if nothing is eligible right now — the caller
 * (server/index.js) should treat null as "this trigger silently does
 * nothing," same as a Bakin object with no active sheet.
 */
export function selectEligibleSheet(eventDef, ctx) {
  for (let i = 0; i < eventDef.sheets.length; i++) {
    const sheet = eventDef.sheets[i];
    const id = sheetIdFor(sheet, i);
    if (sheet.runOnce !== false && ctx.completedSheetIds?.[id]) continue;
    if (sheet.condition && !evalCondition(sheet.condition, ctx)) continue;
    return { sheet, index: i, id };
  }
  return null;
}

/**
 * @typedef {Object} EventCursor
 * @property {string} eventId
 * @property {number} sheetIndex which of eventDef.sheets this run is executing — picked once at start via selectEligibleSheet and locked for the whole run, even if a mid-script setSwitch would change what selectEligibleSheet returns if called again
 * @property {string} sheetId the same sheet's bookkeeping id, cached so the caller doesn't need eventDef in scope to mark completion
 * @property {number} pc index into the sheet's commands (top level only — a branch's nested commands run synchronously in one pass, see runSynchronous, so the cursor never needs to point inside one)
 * @property {number} waitUntil ms timestamp; 0 = not waiting
 * @property {{choices:Array<{text:string, next?:number}>}|null} awaitingChoice
 */

/**
 * Selects an eligible sheet and starts a fresh cursor for it. Does not
 * execute anything yet — the caller must call stepEventScript once to run
 * the first command. Returns null if no sheet is currently eligible (every
 * conditioned/runOnce sheet is exhausted and there's no unconditional
 * fallback) — the caller should treat this as a silent no-op trigger.
 */
export function startEventScript(eventDef, ctx) {
  const picked = selectEligibleSheet(eventDef, ctx);
  if (!picked) return null;
  return { eventId: eventDef.id, sheetIndex: picked.index, sheetId: picked.id, pc: 0, waitUntil: 0, awaitingChoice: null };
}

/** Runs a flat list of commands to completion in one pass — used for a branch's ifCommands/elseCommands, which validateCommand guarantees contain no `wait` and no choice-bearing `showDialog`, so this never needs to park. Pushes effect descriptors onto ctx.effects same as the top-level loop. */
function runSynchronous(commands, ctx) {
  for (const cmd of commands) {
    ctx.effects.push(cmd);
    if (cmd.type === 'setSwitch') ctx.switches[switchKey(cmd.switchId, cmd.self, ctx)] = cmd.value;
  }
}

/**
 * Advances `cursor` through its selected sheet's `commands` starting at `cursor.pc`,
 * one call per server tick. Pure: `ctx` carries read-only lookups
 * (`switches`, `inventory`, `questCompleted`, `eventId` — needed by any
 * self-scoped switch read/write, see switchKey) and every command that would
 * mutate real state instead pushes an effect descriptor onto `ctx.effects`
 * for the caller (server/index.js) to apply against the real player object
 * — the same "sim computes, server applies" split quests.js already uses.
 *
 * Returns {status:'done'} once it falls off the end, {status:'waiting'} if
 * a `wait` command's delay hasn't elapsed yet, or {status:'awaitingChoice',
 * dialogPayload} if a showDialog with choices is parked — the caller must
 * not call stepEventScript again for this cursor until resumeEventChoice
 * has run (choice) or `now` has advanced past cursor.waitUntil (wait,
 * handled by just calling stepEventScript again on the next tick).
 */
export function stepEventScript(cursor, eventDef, ctx, now) {
  ctx.effects = ctx.effects || [];
  const commands = eventDef.sheets[cursor.sheetIndex].commands;
  let pc = cursor.pc;

  while (pc < commands.length) {
    const cmd = commands[pc];

    if (cmd.type === 'wait') {
      if (cursor.waitUntil === 0) {
        cursor.waitUntil = now + cmd.ms;
        cursor.pc = pc;
        if (cmd.castBar) {
          ctx.effects.push({ type: 'castBarStart', label: cmd.castBar.label, gatherType: cmd.castBar.gatherType, durationMs: cmd.ms });
        }
        return { status: 'waiting' };
      }
      if (now < cursor.waitUntil) return { status: 'waiting' };
      cursor.waitUntil = 0;
      if (cmd.castBar) ctx.effects.push({ type: 'castBarEnd' });
      pc += 1;
      continue;
    }

    if (cmd.type === 'rollGatherYield') {
      const { itemId, quantity } = ctx.rollNodeYield(cmd.nodeType);
      if (quantity > 0) ctx.effects.push({ type: 'giveItem', itemId, qty: quantity });
      pc += 1;
      continue;
    }

    if (cmd.type === 'showDialog' && cmd.choices?.length) {
      cursor.pc = pc;
      cursor.awaitingChoice = { choices: cmd.choices };
      ctx.effects.push({ type: 'showDialog', text: cmd.text, choices: cmd.choices });
      return { status: 'awaitingChoice', dialogPayload: { text: cmd.text, choices: cmd.choices } };
    }

    if (cmd.type === 'branch') {
      const takeIf = evalCondition(cmd.condition, ctx);
      runSynchronous(takeIf ? cmd.ifCommands : (cmd.elseCommands || []), ctx);
      pc += 1;
      continue;
    }

    // Every other command (including a choiceless showDialog) executes
    // synchronously — push its effect descriptor and fall through.
    ctx.effects.push(cmd);
    if (cmd.type === 'setSwitch') ctx.switches[switchKey(cmd.switchId, cmd.self, ctx)] = cmd.value;
    pc += 1;
  }
  cursor.pc = pc;
  return { status: 'done' };
}

/** Resumes a cursor parked at awaitingChoice with the player's picked choice index. Moves cursor.pc to the choice's `next` (or past the end if absent, ending the script next step) and clears awaitingChoice. Returns false if there's no such choice (stale/invalid client reply). */
export function resumeEventChoice(cursor, choiceIndex) {
  const choice = cursor.awaitingChoice?.choices?.[choiceIndex];
  cursor.awaitingChoice = null;
  if (!choice) return false;
  cursor.pc = choice.next !== undefined ? choice.next : Number.MAX_SAFE_INTEGER;
  return true;
}
