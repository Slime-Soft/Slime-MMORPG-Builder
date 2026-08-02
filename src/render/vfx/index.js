// src/render/vfx/index.js
// Thin wrapper around three.quarks' BatchedRenderer: one shared batch per
// scene, spawn(presetId, anchor, opts) hands back a handle the caller can
// stop()/dispose() early, and one-shot presets (autoDestroy: true in
// presets.js) clean themselves up once their burst finishes emitting.
import * as THREE from 'three';
import { BatchedRenderer } from 'three.quarks';
import { ConstantValue } from 'quarks.core';
import { PRESETS } from './presets.js';
import { WORLD_EFFECTS } from './worldEffects.js';
import { buildCustomVfxSystem } from './custom.js';
import { createVfxLightPool } from './lights.js';

export { PRESET_IDS } from './presets.js';
export { WORLD_EFFECT_IDS, WORLD_EFFECT_CATEGORIES, getWorldEffectDef } from './worldEffects.js';

/**
 * Author-created VFX defs (Skill Builder's "Custom VFX" panel, see
 * src/sim/vfxDefs.js), keyed by id — mutated in place by
 * registerCustomVfxDefs() the same way registerCustomWeaponModels() merges
 * into the live WEAPON_TYPES registry, so every caller that already knows
 * how to spawn(presetId, ...) works unchanged for a custom id too.
 * @type {Map<string, import('../../sim/vfxDefs.js').VfxDef>}
 */
const customVfxDefs = new Map();

/** Call once after fetching /api/vfx (main.js/editor.js/skill-builder's loadCatalog), and again after any save — replaces the whole registry so a deleted def stops resolving. */
export function registerCustomVfxDefs(defs) {
  customVfxDefs.clear();
  for (const def of defs) customVfxDefs.set(def.id, def);
}

/**
 * @param {THREE.Scene} scene
 * @returns {{ spawn: Function, update: Function, dispose: Function, batchRenderer: THREE.Object3D }}
 */
export function createVfxSystem(scene) {
  const batchRenderer = new BatchedRenderer();
  scene.add(batchRenderer);
  const lights = createVfxLightPool(scene);
  const active = []; // { systems, anchorObj, tempHolder, releaseLight }

  /**
   * @param {string} presetId one of PRESET_IDS (see presets.js), a world
   *   effect id (worldEffects.js), or a custom author-created def's id
   * @param {THREE.Object3D|{x:number,y:number,z:number}} anchor a live attach
   *   point (hand/chest group — the effect follows it every frame) or a
   *   plain world position (ground/target — a fixed point, wrapped in a
   *   throwaway Group this module owns and cleans up on dispose).
   * @returns {{ stop: Function, dispose: Function }|null} null if presetId is unknown
   */
  function spawn(presetId, anchor, opts = {}) {
    // Resolution order: hand-tuned skill preset, then world-ambience effect
    // (worldEffects.js — placed from the World Editor's Particles mode, but
    // nothing stops a skill from using one), then an author-created custom
    // def. All three end up as the same array of three.quarks systems.
    const factory = PRESETS[presetId] || WORLD_EFFECTS[presetId]?.build;
    const customDef = !factory ? customVfxDefs.get(presetId) : null;
    if (!factory && !customDef) {
      console.warn(`[vfx] unknown preset "${presetId}"`);
      return null;
    }
    const built = factory ? factory(opts) : buildCustomVfxSystem(customDef, opts);
    if (!built) return null;
    // A factory normally returns one ParticleSystem, but some effects
    // genuinely need more than one emitter at once (e.g. a ground ring PLUS
    // a vertical accent so it reads from any camera angle, or a "wall" made
    // of several offset flame-lick emitters) — those return an array instead.
    const systems = Array.isArray(built) ? built : [built];
    let anchorObj = anchor;
    let tempHolder = false;
    if (!(anchor instanceof THREE.Object3D)) {
      anchorObj = new THREE.Group();
      anchorObj.position.set(anchor.x, anchor.y, anchor.z);
      scene.add(anchorObj);
      tempHolder = true;
    }
    for (const system of systems) {
      anchorObj.add(system.emitter);
      batchRenderer.addSystem(system);
      system.play();
    }

    // A preset can ask for a dynamic light alongside its particles (see
    // presets.js's withLight) — a one-shot pop for an impact, or one that
    // follows the anchor for as long as a looping effect lives. The spec
    // rides on the first system's emitter userData so a factory's return
    // type didn't have to change.
    const lightSpec = systems[0]?.emitter.userData.vfxLight;
    let releaseLight = null;
    if (lightSpec && opts.light !== false) {
      const intensity = (lightSpec.intensity ?? 4) * (opts.lightScale ?? 1);
      if (lightSpec.persistent) {
        releaseLight = lights.attach(anchorObj, { ...lightSpec, intensity });
      } else {
        // World position, not the anchor's local one: an anchor parented to a
        // hand is metres away from where its .position says.
        anchorObj.updateWorldMatrix(true, false);
        const p = new THREE.Vector3();
        anchorObj.getWorldPosition(p);
        lights.flash(p, { ...lightSpec, intensity });
      }
    }

    const entry = { systems, anchorObj, tempHolder, releaseLight };
    active.push(entry);
    return {
      // false for a one-shot burst (it self-disposes via autoDestroy once its
      // particles finish their own life — callers should NOT dispose it
      // early, or the fade-out gets cut short mid-way). true for a looping
      // preset (auras/clouds/streams never self-terminate — a caller MUST
      // dispose it eventually or it runs forever).
      looping: systems.some((s) => s.looping),
      stop: () => systems.forEach((s) => s.stop()),
      dispose: () => disposeEntry(entry),
      // For a looping preset only: halt future emission WITHOUT touching the
      // particles already alive (system.stop()/dispose() both reset
      // particleNum to 0 internally, which hides every currently-alive
      // particle in the very next frame — no different from an instant
      // vanish). This just zeroes emission going forward; already-emitted
      // particles keep aging and fading via the system's own normal
      // per-particle death check, then the system self-reaps once
      // particleNum reaches 0 (same check createVfxSystem's update() already
      // uses for one-shot bursts).
      stopEmission: () => {
        for (const system of systems) {
          system.emissionOverTime = new ConstantValue(0);
          system.emissionBursts = [];
          system.emitEnded = true;
          system.markForDestroy = true;
        }
      },
    };
  }

  function disposeEntry(entry) {
    const idx = active.indexOf(entry);
    if (idx === -1) return;
    active.splice(idx, 1);
    entry.releaseLight?.();
    for (const system of entry.systems) {
      batchRenderer.deleteSystem(system);
      system.dispose();
    }
    if (entry.tempHolder) scene.remove(entry.anchorObj);
  }

  /** Call once per frame. delta in seconds. */
  function update(delta) {
    batchRenderer.update(delta);
    lights.update(delta);
    // autoDestroy presets set markForDestroy the moment their burst finishes
    // EMITTING — which, for a one-shot burst (duration ~0.05s), is nearly
    // instant, well before its particles have actually finished living out
    // their `life` and fading. Sweeping on markForDestroy alone disposed the
    // system (and every currently-alive particle with it) right after that
    // instant emission, cutting every burst's fade short — exactly what
    // three.quarks' OWN internal update() avoids by also checking
    // `particleNum === 0` before it self-disposes. Match that here. A
    // composite entry is only reaped once EVERY one of its systems is done.
    for (let i = active.length - 1; i >= 0; i--) {
      const entry = active[i];
      if (entry.systems.every((s) => s.markForDestroy && s.particleNum === 0)) disposeEntry(entry);
    }
  }

  function dispose() {
    for (const entry of [...active]) disposeEntry(entry);
    lights.dispose();
    scene.remove(batchRenderer);
  }

  return { spawn, update, dispose, batchRenderer };
}
