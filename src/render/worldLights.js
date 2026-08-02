// src/render/worldLights.js
// Runtime for `world.lights[]` — the placed point/spot lights authored in the
// World Editor's Lights mode (see src/sim/lightSources.js for the schema).
//
// The whole design is dictated by one three.js fact: the number of lights in
// a scene is compiled into every material's shader program. Adding a light,
// removing a light, toggling `light.visible`, or flipping `castShadow` all
// change that count and force every visible material to recompile — a hitch
// you can feel, every time. So none of those things happen here after build.
//
// Instead a fixed POOL of real lights is created once, and authored light
// sources are BOUND to pool slots as the camera moves: a slot's position,
// colour, distance and intensity are plain uniforms and cost nothing to
// change. An unused slot sits at intensity 0 rather than being removed. Same
// trick, same reason, as the VFX light pool (src/render/vfx/lights.js) — the
// difference is that these are authored world content rather than borrowed by
// spell effects, so they're bound by distance to the camera rather than
// claimed on demand.
//
// Shadow-casting slots are a separate, much smaller sub-pool, because a
// shadow-casting point light is SIX render passes of the scene (one per cube
// face). They're built only if the map actually authors shadow-casting
// lights, and only shadow-casting lights are ever bound to them.
import * as THREE from 'three';
import {
  DEFAULT_LIGHT_ACTIVATION_RADIUS,
  lightSpotTargetPosition,
  lightFlickerFactor,
} from '../sim/lightSources.js';

/** Plain (non-shadow) pool sizes. Past this the nearest ones win — an author can place a hundred torches across a dungeon; only this many are ever lit at once. */
const MAX_POINT_SLOTS = 8;
const MAX_SPOT_SLOTS = 4;
/** Shared shadow budget across BOTH types. Two is already 12 extra scene passes in the worst case. */
const MAX_SHADOW_SLOTS = 2;

/** Leaving costs 15% more distance than entering, so a light sitting on the boundary can't chatter on and off. */
const EXIT_HYSTERESIS = 1.15;
/** Re-binding is cheap but pointless every frame; flicker still updates every frame. */
const BIND_INTERVAL = 0.2;

const POINT_SHADOW_MAP_SIZE = 512; // x6 faces — 1024 here is 6MB of shadow map for one torch
const SPOT_SHADOW_MAP_SIZE = 1024;

/**
 * @param {THREE.Object3D} parent scene (or the map group) the pool attaches to
 * @param {{lights?: Array}} world
 * @param {{ignoreActivationRadius?: boolean}} [opts] the World Editor sets
 *   ignoreActivationRadius for the same reason it does for particle emitters:
 *   its camera routinely sits 150m above the map, so honouring the in-game
 *   radius there means you place a lantern and see nothing at all. The pool
 *   caps still apply, so the worst case stays bounded either way.
 * @returns {{update: Function, rebuild: Function, dispose: Function, isEmpty: boolean, activeCount: () => number}}
 */
export function createWorldLights(parent, world, { ignoreActivationRadius = false } = {}) {
  /** @type {Array<{light: THREE.Light, target: THREE.Object3D|null, kind: 'point'|'spot', shadow: boolean, def: object|null, phase: number}>} */
  let slots = [];
  /** @type {Array<object>} the authored defs, re-read on every rebuild */
  let defs = [];
  /** The pool shape currently built, so a rebuild that doesn't change it can skip the recompile entirely — see rebuild(). */
  let poolSpec = null;
  let sinceBind = BIND_INTERVAL;
  let elapsed = 0;

  /** How many slots of each flavour this map's authored lights actually need. */
  function specFor(list) {
    let point = 0; let spot = 0; let pointShadow = 0; let spotShadow = 0;
    for (const def of list) {
      if (def.castShadow) {
        if (def.type === 'spot') spotShadow++; else pointShadow++;
      } else if (def.type === 'spot') spot++;
      else point++;
    }
    // Shadow slots come out of one shared budget, points first (they're the
    // common case for an enclosed space — a brazier in the middle of a room).
    const shadowPoint = Math.min(pointShadow, MAX_SHADOW_SLOTS);
    const shadowSpot = Math.min(spotShadow, MAX_SHADOW_SLOTS - shadowPoint);
    return {
      point: Math.min(point, MAX_POINT_SLOTS),
      spot: Math.min(spot, MAX_SPOT_SLOTS),
      shadowPoint,
      shadowSpot,
    };
  }

  const sameSpec = (a, b) => !!a && !!b
    && a.point === b.point && a.spot === b.spot
    && a.shadowPoint === b.shadowPoint && a.shadowSpot === b.shadowSpot;

  function makeSlot(kind, shadow, index) {
    const light = kind === 'spot'
      ? new THREE.SpotLight(0xffffff, 0, 10, Math.PI / 5, 0.5, 2)
      : new THREE.PointLight(0xffffff, 0, 10, 2);
    light.name = `world-light-slot:${kind}${shadow ? ':shadow' : ''}:${index}`;
    light.castShadow = shadow;
    if (shadow) {
      light.shadow.mapSize.set(
        kind === 'spot' ? SPOT_SHADOW_MAP_SIZE : POINT_SHADOW_MAP_SIZE,
        kind === 'spot' ? SPOT_SHADOW_MAP_SIZE : POINT_SHADOW_MAP_SIZE,
      );
      // A placed light lives INSIDE the geometry it lights (a torch a
      // hand's width off a wall), so the near plane has to be tight or the
      // wall behind it is clipped out of its own shadow map.
      light.shadow.camera.near = 0.15;
      light.shadow.camera.far = 60;
      light.shadow.bias = -0.002;
      light.shadow.normalBias = 0.05;
    }
    parent.add(light);
    let target = null;
    if (kind === 'spot') {
      // A SpotLight aims at its `target`, which must itself be in the scene
      // graph — a target left as the default (0,0,0 object with no parent)
      // silently points every spot at the world origin.
      target = new THREE.Object3D();
      target.name = `${light.name}:target`;
      parent.add(target);
      light.target = target;
    }
    return { light, target, kind, shadow, def: null, phase: index * 1.7 };
  }

  function buildPool(spec) {
    teardownPool();
    poolSpec = spec;
    let i = 0;
    for (let n = 0; n < spec.point; n++) slots.push(makeSlot('point', false, i++));
    for (let n = 0; n < spec.spot; n++) slots.push(makeSlot('spot', false, i++));
    for (let n = 0; n < spec.shadowPoint; n++) slots.push(makeSlot('point', true, i++));
    for (let n = 0; n < spec.shadowSpot; n++) slots.push(makeSlot('spot', true, i++));
  }

  function teardownPool() {
    for (const slot of slots) {
      parent.remove(slot.light);
      if (slot.target) parent.remove(slot.target);
      slot.light.shadow?.dispose?.();
      slot.light.dispose?.();
    }
    slots = [];
    poolSpec = null;
  }

  /** Writes everything about `def` onto `slot` except its live (flickering) intensity. */
  function bind(slot, def) {
    slot.def = def;
    const { light } = slot;
    light.color.set(def.color || '#ffffff');
    light.distance = def.distance ?? 12;
    light.decay = def.decay ?? 2;
    light.position.set(def.position.x, def.position.y ?? 0, def.position.z);
    if (slot.kind === 'spot') {
      const rad = Math.PI / 180;
      light.angle = (def.angleDeg ?? 35) * rad;
      light.penumbra = def.penumbra ?? 0.5;
      const t = lightSpotTargetPosition(def);
      slot.target.position.set(t.x, t.y, t.z);
    }
    light.intensity = def.intensity ?? 0;
    if (slot.shadow) light.shadow.camera.far = Math.max(2, (def.distance ?? 12) * 1.2);
  }

  function unbind(slot) {
    slot.def = null;
    // NOT `visible = false` — that changes the compiled light count. Zero
    // intensity is free.
    slot.light.intensity = 0;
  }

  /** Nearest-first assignment of the defs matching one slot flavour. */
  function bindBucket(bucketSlots, bucketDefs, viewerPosition) {
    if (!bucketSlots.length) return;
    const candidates = [];
    for (const def of bucketDefs) {
      const dx = def.position.x - viewerPosition.x;
      const dy = (def.position.y ?? 0) - viewerPosition.y;
      const dz = def.position.z - viewerPosition.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const radius = def.activationRadius ?? DEFAULT_LIGHT_ACTIVATION_RADIUS;
      // An already-bound light is judged against the wider exit radius.
      const bound = bucketSlots.some((s) => s.def === def);
      const limit = ignoreActivationRadius ? Infinity : (bound ? radius * EXIT_HYSTERESIS : radius);
      if (dist <= limit) candidates.push({ def, dist });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    const winners = candidates.slice(0, bucketSlots.length).map((c) => c.def);
    // Keep already-bound defs in the slot they're already in: re-shuffling
    // them would swap two torches' flicker phases every cull, which looks
    // like both of them stuttering.
    const unclaimed = [];
    for (const slot of bucketSlots) {
      if (slot.def && winners.includes(slot.def)) continue;
      unbind(slot);
      unclaimed.push(slot);
    }
    for (const def of winners) {
      if (bucketSlots.some((s) => s.def === def)) continue;
      const slot = unclaimed.pop();
      if (!slot) break;
      bind(slot, def);
    }
  }

  function rebind(viewerPosition) {
    const buckets = [
      [slots.filter((s) => s.kind === 'point' && !s.shadow), defs.filter((d) => d.type !== 'spot' && !d.castShadow)],
      [slots.filter((s) => s.kind === 'spot' && !s.shadow), defs.filter((d) => d.type === 'spot' && !d.castShadow)],
      [slots.filter((s) => s.kind === 'point' && s.shadow), defs.filter((d) => d.type !== 'spot' && d.castShadow)],
      [slots.filter((s) => s.kind === 'spot' && s.shadow), defs.filter((d) => d.type === 'spot' && d.castShadow)],
    ];
    for (const [bucketSlots, bucketDefs] of buckets) bindBucket(bucketSlots, bucketDefs, viewerPosition);
  }

  /**
   * @param {number} dt seconds
   * @param {THREE.Vector3|{x:number,y:number,z:number}} viewerPosition camera position
   */
  function update(dt, viewerPosition) {
    if (!slots.length) return;
    elapsed += dt;
    if (viewerPosition) {
      sinceBind += dt;
      if (sinceBind >= BIND_INTERVAL) {
        sinceBind = 0;
        rebind(viewerPosition);
      }
    }
    for (const slot of slots) {
      if (!slot.def || !slot.def.flicker) continue;
      slot.light.intensity = (slot.def.intensity ?? 0) * lightFlickerFactor(slot.def, elapsed, slot.phase);
    }
  }

  /**
   * Re-read the authored data. If the POOL SHAPE is unchanged (the usual case
   * — dragging an intensity slider, moving a light, recolouring one) the pool
   * is kept and only the bindings are refreshed, so editing a light doesn't
   * recompile every material in the scene on every mouse-move.
   */
  function rebuild(w) {
    defs = (w?.lights || []).slice();
    const spec = specFor(defs);
    if (sameSpec(spec, poolSpec)) {
      for (const slot of slots) unbind(slot);
    } else {
      buildPool(spec);
    }
    sinceBind = BIND_INTERVAL; // rebind on the very next update, not a fifth of a second in
  }

  function dispose() {
    teardownPool();
    defs = [];
  }

  rebuild(world);

  return {
    update,
    rebuild,
    dispose,
    get isEmpty() { return defs.length === 0; },
    activeCount: () => slots.filter((s) => s.def).length,
  };
}
