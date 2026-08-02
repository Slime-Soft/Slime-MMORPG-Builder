// src/net/client.js
// Talks to the Node.js server. Owns nothing authoritative — only forwards
// input intent and reconciles local prediction against server state.
import { stepMovement } from '../sim/movement.js';

export class NetClient {
  /**
   * @param {{ onWelcome: Function, onState: Function, onPlayerJoined: Function, onPlayerLeft: Function, onPlayerCharacter: Function, onAbilityUsed: Function, onAbilityResult: Function, onFloorEntered: Function, onFloorState: Function, onFloorPlayerJoined: Function, onFloorPlayerLeft: Function, onFloorExited: Function, onTowerDenied: Function }} handlers
   */
  constructor(handlers) {
    this.handlers = handlers;
    // `io` is provided globally by /socket.io/socket.io.js, served by the server.
    this.socket = io();
    this.socket.on('welcome', (msg) => this.handlers.onWelcome(msg));
    this.socket.on('state', (msg) => this.handlers.onState(msg));
    this.socket.on('player-joined', (msg) => this.handlers.onPlayerJoined(msg));
    this.socket.on('player-left', (msg) => this.handlers.onPlayerLeft(msg));
    this.socket.on('player-character', (msg) => this.handlers.onPlayerCharacter?.(msg));
    this.socket.on('player-weapon-loadout', (msg) => this.handlers.onPlayerWeaponLoadout?.(msg));
    this.socket.on('ability-used', (msg) => this.handlers.onAbilityUsed?.(msg));
    this.socket.on('monster-ability-used', (msg) => this.handlers.onMonsterAbilityUsed?.(msg));
    this.socket.on('ability-result', (msg) => this.handlers.onAbilityResult?.(msg));
    this.socket.on('cast-interrupted', (msg) => this.handlers.onCastInterrupted?.(msg));
    this.socket.on('floor-entered', (msg) => this.handlers.onFloorEntered?.(msg));
    this.socket.on('floor-state', (msg) => this.handlers.onFloorState?.(msg));
    this.socket.on('floor-player-joined', (msg) => this.handlers.onFloorPlayerJoined?.(msg));
    this.socket.on('floor-player-left', (msg) => this.handlers.onFloorPlayerLeft?.(msg));
    this.socket.on('floor-exited', (msg) => this.handlers.onFloorExited?.(msg));
    this.socket.on('tower-denied', (msg) => this.handlers.onTowerDenied?.(msg));
    this.socket.on('player-died', (msg) => this.handlers.onPlayerDied?.(msg));
    this.socket.on('player-respawned', (msg) => this.handlers.onPlayerRespawned?.(msg));
    this.socket.on('boss-defeated', (msg) => this.handlers.onBossDefeated?.(msg));
    this.socket.on('gather-result', (msg) => this.handlers.onGatherResult?.(msg));
    this.socket.on('gather-node-depleted', (msg) => this.handlers.onGatherNodeDepleted?.(msg));
    this.socket.on('craft-result', (msg) => this.handlers.onCraftResult?.(msg));
    this.socket.on('sell-result', (msg) => this.handlers.onSellResult?.(msg));
    this.socket.on('merchant-buy-result', (msg) => this.handlers.onMerchantBuyResult?.(msg));
    this.socket.on('merchant-sell-result', (msg) => this.handlers.onMerchantSellResult?.(msg));
    this.socket.on('equipment-result', (msg) => this.handlers.onEquipmentResult?.(msg));
    this.socket.on('item-used', (msg) => this.handlers.onItemUsed?.(msg));
    this.socket.on('item-use-denied', (msg) => this.handlers.onItemUseDenied?.(msg));
    this.socket.on('store-entered', (msg) => this.handlers.onStoreEntered?.(msg));
    this.socket.on('store-state', (msg) => this.handlers.onStoreState?.(msg));
    this.socket.on('store-player-joined', (msg) => this.handlers.onStorePlayerJoined?.(msg));
    this.socket.on('store-player-left', (msg) => this.handlers.onStorePlayerLeft?.(msg));
    this.socket.on('store-exited', (msg) => this.handlers.onStoreExited?.(msg));
    this.socket.on('xp-gained', (msg) => this.handlers.onXpGained?.(msg));
    this.socket.on('loot-drop', (msg) => this.handlers.onLootDrop?.(msg));
    this.socket.on('level-up', (msg) => this.handlers.onLevelUp?.(msg));
    this.socket.on('quest-state', (msg) => this.handlers.onQuestState?.(msg));
    this.socket.on('npc-quests', (msg) => this.handlers.onNpcQuests?.(msg));
    this.socket.on('quest-accepted', (msg) => this.handlers.onQuestAccepted?.(msg));
    this.socket.on('quest-turn-in-result', (msg) => this.handlers.onQuestTurnInResult?.(msg));
    this.socket.on('event-switches', (msg) => this.handlers.onEventSwitches?.(msg));
    this.socket.on('party-state', (msg) => this.handlers.onPartyState?.(msg));
    this.socket.on('party-invite', (msg) => this.handlers.onPartyInvite?.(msg));
    this.socket.on('party-error', (msg) => this.handlers.onPartyError?.(msg));
    this.socket.on('map-entered', (msg) => this.handlers.onMapEntered?.(msg));
    this.socket.on('map-state', (msg) => this.handlers.onMapState?.(msg));
    this.socket.on('map-player-joined', (msg) => this.handlers.onMapPlayerJoined?.(msg));
    this.socket.on('map-player-left', (msg) => this.handlers.onMapPlayerLeft?.(msg));
    this.socket.on('teleport-denied', (msg) => this.handlers.onTeleportDenied?.(msg));
    this.socket.on('dungeon-closed', (msg) => this.handlers.onDungeonClosed?.(msg));
    // Tower Dungeon (src/sim/towerDungeon.js) — the floor-list panel, the
    // live floor run, and the "proceed to the next floor?" prompt.
    this.socket.on('tower-panel', (msg) => this.handlers.onTowerPanel?.(msg));
    this.socket.on('tower-floor-entered', (msg) => this.handlers.onTowerFloorEntered?.(msg));
    this.socket.on('tower-progress', (msg) => this.handlers.onTowerProgress?.(msg));
    this.socket.on('tower-floor-cleared', (msg) => this.handlers.onTowerFloorCleared?.(msg));
    this.socket.on('tower-left', (msg) => this.handlers.onTowerLeft?.(msg));
    this.socket.on('event-step', (msg) => this.handlers.onEventStep?.(msg));
    this.socket.on('event-object-visibility', (msg) => this.handlers.onEventObjectVisibility?.(msg));
    this.socket.on('event-npc-moved', (msg) => this.handlers.onEventNpcMoved?.(msg));
    this.socket.on('event-skill-learned', (msg) => this.handlers.onEventSkillLearned?.(msg));
    this.socket.on('stats-updated', (msg) => this.handlers.onStatsUpdated?.(msg));
    this.socket.on('stat-allocation-denied', (msg) => this.handlers.onStatAllocationDenied?.(msg));
  }

  sendInput(input) {
    this.socket.emit('input', input);
  }

  sendCharacter(character) {
    this.socket.emit('set-character', character);
  }

  /** @param {string|null} [targetId] the client's currently-selected target (click or Tab) — server validates it, never trusts it blindly */
  useAbility(abilityId, targetId = null) {
    this.socket.emit('use-ability', { abilityId, targetId });
  }

  enterTower() {
    this.socket.emit('enter-tower');
  }

  advanceFloor() {
    this.socket.emit('advance-floor');
  }

  exitTower() {
    this.socket.emit('exit-tower');
  }

  gather(nodeId) {
    this.socket.emit('gather', nodeId);
  }

  craft(recipeId, quantity = 1) {
    this.socket.emit('craft', { recipeId, quantity });
  }

  sellItem(itemId, quantity) {
    this.socket.emit('sell-item', { itemId, quantity });
  }

  buyFromMerchant(itemId, quantity) {
    this.socket.emit('merchant-buy-item', { itemId, quantity });
  }

  sellToMerchant(itemId, quantity) {
    this.socket.emit('merchant-sell-item', { itemId, quantity });
  }

  /** @param {string} itemId @param {string} [slot] omit for auto-target (ring/earring pick whichever's free) */
  equipItem(itemId, slot) {
    this.socket.emit('equip-item', { itemId, slot });
  }

  unequipItem(slot) {
    this.socket.emit('unequip-item', { slot });
  }

  useItem(itemId) {
    this.socket.emit('use-item', itemId);
  }

  /** @param {Object<string,number>} delta stat id -> points to spend, e.g. `{ STR: 1, INT: 2 }` */
  allocateStatPoints(delta) {
    this.socket.emit('allocate-stat-points', delta);
  }

  respecStats() {
    this.socket.emit('respec-stats');
  }

  enterStore() {
    this.socket.emit('enter-store');
  }

  exitStore() {
    this.socket.emit('exit-store');
  }

  talkNpc(npcId) {
    this.socket.emit('talk-npc', npcId);
  }

  acceptQuest(questId) {
    this.socket.emit('accept-quest', questId);
  }

  turnInQuest(questId) {
    this.socket.emit('turn-in-quest', questId);
  }

  inviteParty(targetId) {
    this.socket.emit('party-invite', targetId);
  }

  acceptParty() {
    this.socket.emit('party-accept');
  }

  leaveParty() {
    this.socket.emit('party-leave');
  }

  useTeleporter(teleporterId) {
    this.socket.emit('use-teleporter', { teleporterId });
  }

  /** Enter a Tower Dungeon floor from its panel — the server re-checks proximity and whether this floor is unlocked. */
  enterTowerFloor(eventId, floorIndex) {
    this.socket.emit('tower-enter-floor', { eventId, floorIndex });
  }

  /** "Yes" on the floor-cleared prompt. */
  towerNextFloor() {
    this.socket.emit('tower-next-floor');
  }

  /** Abandon the current tower run and return to the tower's entrance. */
  leaveTower() {
    this.socket.emit('tower-leave');
  }

  startEvent(eventId) {
    this.socket.emit('start-event', eventId);
  }

  eventChoice(eventId, choiceIndex) {
    this.socket.emit('event-choice', { eventId, choiceIndex });
  }
}

/**
 * Client-side prediction helper: applies the same deterministic sim step
 * locally so movement feels instant, ahead of server confirmation.
 */
export class PredictedPlayer {
  constructor(startPosition) {
    this.position = { ...startPosition };
    // Inputs handed to sendInput() but not yet acknowledged by a state snapshot,
    // as {seq, input, dt} — `dt` accumulating the local simulated time that input
    // stayed in effect. reconcile() replays these on top of each authoritative
    // position; without them the server's position is stale by a full round trip
    // and correcting toward it drags the player backward every single packet.
    this.pending = [];
    this.inputSeq = 0;
    this._ctx = null;
    this._preCorrectionPos = null; // position before this frame's first correction — see reconcile()
    this._unsentDt = 0; // locally-simulated time not yet attributed to any sent input
  }

  predict(input, dt, bounds, collision = null, groundHeightFn = null, speedMultiplier = 1) {
    // A new frame: the next correction is this frame's first.
    this._preCorrectionPos = null;
    // Remember the exact sim context this frame predicted with, so reconcile()'s
    // replay re-integrates through identical parameters. A replay run against
    // different bounds/collision/speed than the prediction diverges by construction.
    this._ctx = { bounds, collision, groundHeightFn, speedMultiplier };
    this.position = stepMovement(this.position, input, dt, bounds, collision, groundHeightFn, speedMultiplier);
    // Accrue this frame onto the input currently in flight. The server integrates
    // one sampled input across the whole send interval, so the replay has to too.
    // When the buffer is empty (server has acked everything) the time still has to
    // go somewhere — park it until the next stampInput adopts it, or the replay
    // would under-count up to a full send interval of real movement and pull the
    // player backward by that much.
    const inFlight = this.pending[this.pending.length - 1];
    if (inFlight) inFlight.dt += dt;
    else this._unsentDt += dt;
    return this.position;
  }

  /**
   * Stamp an input with a sequence number and buffer it for replay. Returns the
   * payload to actually put on the wire — the server echoes the last seq it
   * applied back in each snapshot, which is what lets reconcile() tell
   * "already accounted for" apart from "still in flight".
   */
  stampInput(input) {
    const seq = ++this.inputSeq;
    this.pending.push({ seq, input: { ...input }, dt: this._unsentDt });
    this._unsentDt = 0;
    // Only reachable if the server stops acking entirely (disconnect mid-flight);
    // bounds the buffer instead of letting a dead connection grow it forever.
    if (this.pending.length > 240) this.pending.shift();
    return { ...input, seq };
  }

  /**
   * Reconcile against authoritative server position.
   *
   * The server's position is always stale by about a full round trip: the input
   * that produced it took ~RTT/2 to arrive, and the snapshot took ~RTT/2 to come
   * back. While walking in a straight line the local prediction is therefore
   * legitimately AHEAD by roughly RTT * PLAYER_SPEED, and correcting toward the
   * raw server position would tug the player backward 20x a second forever —
   * that is the rubberbanding, and no amount of tuning correctionFactor fixes it
   * because the error it is chasing never goes to zero.
   *
   * So: replay every input the server hasn't acknowledged yet on top of its
   * position, which reconstructs "where the server will say I am once it has
   * caught up." The residual error against that is unbiased, so smoothing it
   * actually converges. Small drift is still eased in over a few frames rather
   * than snapped (a hard snap on every crossing of a fixed tolerance is what
   * caused visible micro-stutters every few meters). Large discrepancies
   * (teleports, respawns, floor transitions) still snap immediately, since those
   * *should* be instant and smoothing them would look like sliding.
   *
   * @param {number|null} [ack] the last input seq the server had applied when it
   *   built this snapshot. Every snapshot path (overworld/floor/store/map/dungeon)
   *   echoes it; omitting it falls back to correcting toward the raw stale
   *   position, which is the pre-2026-07-25 behavior and rubberbands.
   */
  reconcile(serverPosition, { snapDistance = 3, correctionFactor = 0.2, ack = null } = {}) {
    let target = serverPosition;
    if (ack != null) {
      this.pending = this.pending.filter((e) => e.seq > ack);
      if (this._ctx) {
        const { bounds, collision, groundHeightFn, speedMultiplier } = this._ctx;
        let replayed = { ...serverPosition };
        for (const e of this.pending) {
          if (e.dt > 0) replayed = stepMovement(replayed, e.input, e.dt, bounds, collision, groundHeightFn, speedMultiplier);
        }
        target = replayed;
      }
    }
    // Snapshots arrive in bursts (a stalled server tick, or just TCP delivering
    // several at once), so reconcile can run 2-3 times between two frames. Each
    // would otherwise ease another correctionFactor toward the target with no
    // movement in between, compounding 20% into ~50% — a visible jerk. Only the
    // newest snapshot is worth anything, so rewind the earlier corrections of
    // this frame and let this one apply from where the frame actually started.
    if (this._preCorrectionPos) this.position = { ...this._preCorrectionPos };
    else this._preCorrectionPos = { ...this.position };

    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > snapDistance) {
      // A gap this big is a teleport/respawn/floor change, not drift. Snap to the
      // raw server position and drop the in-flight inputs unreplayed — they were
      // issued against the position the player just left, so replaying them on
      // top of the destination would drag them right back off the arrival point.
      this.position = { ...serverPosition };
      this.pending.length = 0;
      this._unsentDt = 0;
    } else if (dist > 0.001) {
      this.position = {
        x: this.position.x + dx * correctionFactor,
        y: target.y,
        z: this.position.z + dz * correctionFactor,
        velocityY: target.velocityY, // must carry over — a fresh object here (like x/z) would otherwise silently reset an in-progress jump/fall to 0 on every reconcile, which runs ~20/s
      };
    }
  }
}
