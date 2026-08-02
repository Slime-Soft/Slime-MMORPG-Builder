// src/render/worldParticles.js
// Runtime for `world.particleEmitters[]` — the particle effects placed into
// the map itself from the World Editor's Particles mode (see
// src/sim/particleEmitters.js for the authored schema,
// src/render/vfx/worldEffects.js for the effect catalog).
//
// Everything here exists to solve one problem: these effects LOOP forever, and
// a decent-sized map will eventually have dozens of them. Running every
// campfire in the city while the player is out in the forest would burn the
// whole particle budget on things nobody can see. So each emitter is streamed:
// it spawns when the camera comes within its activation radius and is disposed
// when the camera leaves, with hysteresis on the way out so an emitter sitting
// exactly on the boundary doesn't flicker on and off as the player strafes.
// A hard cap on simultaneously-active emitters keeps the worst case bounded
// even if an author packs fifty of them into one plaza — the nearest ones win.
import * as THREE from 'three';
import { DEFAULT_EMITTER_ACTIVATION_RADIUS, emitterSpawnOptions, emitterRotationRadians } from '../sim/particleEmitters.js';

/** No more than this many placed emitters run at once, nearest-first. */
const MAX_ACTIVE_EMITTERS = 24;
/** Leaving costs 15% more distance than entering, so the boundary can't chatter. */
const EXIT_HYSTERESIS = 1.15;
/** Distance checks are far cheaper than spawning, but there's no reason to run them every frame. */
const CULL_INTERVAL = 0.25;

/**
 * @param {THREE.Object3D} parent scene (or the map group) the holders attach to
 * @param {{particleEmitters?: Array}} world
 * @param {ReturnType<typeof import('./vfx/index.js').createVfxSystem>} vfxSystem
 * @param {{ignoreActivationRadius?: boolean}} [opts] the World Editor sets
 *   ignoreActivationRadius: its camera routinely sits 150m up in an overview,
 *   so honouring the radius there means you place a campfire and see nothing
 *   at all — exactly the wrong feedback from an authoring tool. The nearest-24
 *   cap still applies, so the worst case stays bounded either way.
 * @returns {{ update: Function, rebuild: Function, dispose: Function, isEmpty: boolean, activeCount: () => number }}
 */
export function createWorldParticleEmitters(parent, world, vfxSystem, { ignoreActivationRadius = false } = {}) {
  /** @type {Array<{def: object, holder: THREE.Group, handle: object|null, radius: number}>} */
  let entries = [];
  let sinceCull = CULL_INTERVAL; // cull on the very first update, not a quarter-second in

  function build(w) {
    teardown();
    for (const def of w?.particleEmitters || []) {
      const holder = new THREE.Group();
      holder.name = `particle-emitter:${def.id}`;
      holder.position.set(def.position.x, def.position.y ?? 0, def.position.z);
      // The effect is spawned INTO this holder, so rotating the holder tilts
      // the whole system (emission cone, forces, lights) as one piece — no
      // preset knows or cares that it isn't upright.
      const rot = emitterRotationRadians(def);
      holder.rotation.set(rot.x, rot.y, rot.z);
      parent.add(holder);
      entries.push({
        def,
        holder,
        handle: null,
        radius: def.activationRadius ?? DEFAULT_EMITTER_ACTIVATION_RADIUS,
      });
    }
    sinceCull = CULL_INTERVAL;
  }

  function activate(entry) {
    if (entry.handle) return;
    // The holder Group is the anchor, so the effect (and any light it asks
    // for) tracks the emitter — which matters the moment an author moves one
    // in the editor with the effect already running.
    entry.handle = vfxSystem.spawn(entry.def.effectId, entry.holder, emitterSpawnOptions(entry.def));
  }

  function deactivate(entry) {
    if (!entry.handle) return;
    // dispose(), not stopEmission(): these are looping effects with no natural
    // end, and the point of deactivating is to reclaim the budget now.
    entry.handle.dispose?.();
    entry.handle = null;
  }

  function teardown() {
    for (const entry of entries) {
      deactivate(entry);
      parent.remove(entry.holder);
    }
    entries = [];
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3|{x:number,y:number,z:number}} viewerPosition camera or player position
   */
  function update(dt, viewerPosition) {
    if (!entries.length || !viewerPosition) return;
    sinceCull += dt;
    if (sinceCull < CULL_INTERVAL) return;
    sinceCull = 0;

    const inRange = [];
    for (const entry of entries) {
      const dx = entry.holder.position.x - viewerPosition.x;
      const dz = entry.holder.position.z - viewerPosition.z;
      const dist = Math.hypot(dx, dz);
      // An already-running emitter is judged against the wider exit radius.
      const limit = ignoreActivationRadius
        ? Infinity
        : (entry.handle ? entry.radius * EXIT_HYSTERESIS : entry.radius);
      if (dist <= limit) inRange.push({ entry, dist });
      else deactivate(entry);
    }
    if (inRange.length > MAX_ACTIVE_EMITTERS) {
      inRange.sort((a, b) => a.dist - b.dist);
      // Everything past the cap gets dropped even if it's technically in
      // range — better a coherent nearby set than a thin scattering of
      // half-budget effects, and the cut is stable because it's by distance.
      for (const { entry } of inRange.splice(MAX_ACTIVE_EMITTERS)) deactivate(entry);
    }
    for (const { entry } of inRange) activate(entry);
  }

  build(world);

  return {
    update,
    /** Rebuild from a changed world doc (the editor calls this after any placement/edit; the game calls it on a map switch). */
    rebuild: (w) => build(w),
    dispose: teardown,
    get isEmpty() { return entries.length === 0; },
    activeCount: () => entries.filter((e) => e.handle).length,
  };
}
