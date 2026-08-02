// src/render/vfx/lights.js
// A small fixed pool of PointLights that VFX borrow: an impact pops one for
// a fifth of a second, a campfire or a channelled aura holds one for as long
// as it lives.
//
// Why a POOL rather than "add a light, remove it when done": three.js bakes
// the number of lights in the scene into every material's shader program, so
// adding or removing one forces a recompile of every visible material — a
// visible hitch, every single time a spell lands. The pool is created once,
// on first use, and its lights are never added to or removed from the scene
// afterwards; borrowing a light only changes its position, colour and
// intensity, which are plain uniforms. That also puts a hard ceiling on how
// much dynamic lighting a chaotic fight can cost, no matter how many effects
// are on screen at once.
//
// Lights are the cheapest big win available for spell VFX: particles alone
// never touch the world around them, so a fireball that doesn't light the
// ground it explodes on always reads as a decal pasted on the screen.
import * as THREE from 'three';

const DEFAULT_POOL_SIZE = 4;

/**
 * @param {THREE.Scene} scene
 * @returns {{ flash: Function, attach: Function, update: Function, dispose: Function }}
 */
export function createVfxLightPool(scene, { size = DEFAULT_POOL_SIZE } = {}) {
  /** @type {Array<{light: THREE.PointLight, mode: 'idle'|'flash'|'hold', age: number, life: number, peak: number, follow: THREE.Object3D|null, offsetY: number, token: object|null}>} */
  const slots = [];
  let built = false;

  function build() {
    if (built) return;
    built = true;
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 10, 2);
      light.castShadow = false; // shadow-casting point lights are 6 render passes each — never worth it for a 0.2s flash
      light.visible = false;
      scene.add(light);
      slots.push({ light, mode: 'idle', age: 0, life: 0, peak: 0, follow: null, offsetY: 0, token: null });
    }
  }

  /** An idle slot if one exists; otherwise the busiest-but-weakest one, so a big explosion can steal a light from a guttering ember rather than being ignored. */
  function claim() {
    build();
    let fallback = null;
    let fallbackScore = Infinity;
    for (const slot of slots) {
      if (slot.mode === 'idle') return slot;
      // Hold-lights are steal-last (they're something persistent in the world);
      // a flash already half-way through its decay is the cheapest thing to cut.
      const remaining = slot.mode === 'flash' ? (1 - slot.age / slot.life) * slot.peak : slot.peak + 100;
      if (remaining < fallbackScore) {
        fallbackScore = remaining;
        fallback = slot;
      }
    }
    return fallback;
  }

  function release(slot) {
    slot.mode = 'idle';
    slot.follow = null;
    slot.token = null;
    slot.light.visible = false;
    slot.light.intensity = 0;
  }

  /**
   * A one-shot burst of light at a fixed world position.
   * @param {{x:number,y:number,z:number}} position
   * @param {{color?: number, intensity?: number, distance?: number, life?: number}} spec
   */
  function flash(position, spec = {}) {
    const slot = claim();
    if (!slot) return;
    slot.mode = 'flash';
    slot.age = 0;
    slot.life = spec.life ?? 0.25;
    slot.peak = spec.intensity ?? 6;
    slot.follow = null;
    slot.token = null;
    slot.light.color.set(spec.color ?? 0xffffff);
    slot.light.distance = spec.distance ?? 10;
    slot.light.position.set(position.x, position.y, position.z);
    slot.light.intensity = slot.peak;
    slot.light.visible = true;
  }

  /**
   * A light that follows an object until released — for looping effects
   * (a torch, a channelled beam, a portal).
   * @param {THREE.Object3D} target
   * @returns {() => void} release function; safe to call more than once, and
   *   safe to call after the slot has already been stolen by a louder effect
   *   (the token check keeps it from releasing someone else's light).
   */
  function attach(target, spec = {}) {
    const slot = claim();
    if (!slot) return () => {};
    const token = {};
    slot.mode = 'hold';
    slot.age = 0;
    slot.life = Infinity;
    slot.peak = spec.intensity ?? 3;
    slot.follow = target;
    slot.offsetY = spec.offsetY ?? 0.4;
    slot.token = token;
    slot.light.color.set(spec.color ?? 0xffffff);
    slot.light.distance = spec.distance ?? 8;
    slot.light.intensity = slot.peak;
    slot.light.visible = true;
    return () => {
      if (slot.token === token) release(slot);
    };
  }

  const worldPos = new THREE.Vector3();

  function update(dt) {
    for (const slot of slots) {
      if (slot.mode === 'idle') continue;
      slot.age += dt;
      if (slot.mode === 'flash') {
        const t = slot.age / slot.life;
        if (t >= 1) {
          release(slot);
          continue;
        }
        // Quartic falloff: a real flash is almost gone by the time the
        // particles it lit are still fading, and a linear ramp-down reads as
        // a dimmer switch instead of a detonation.
        slot.light.intensity = slot.peak * (1 - t) ** 4;
      } else if (slot.follow) {
        if (!slot.follow.parent) { // its anchor left the scene — don't leave a light floating
          release(slot);
          continue;
        }
        slot.follow.getWorldPosition(worldPos);
        slot.light.position.set(worldPos.x, worldPos.y + slot.offsetY, worldPos.z);
        // Gentle flicker so a held light (firelight, magic) never looks like
        // a static lamp. Two out-of-phase sines so the period isn't obvious.
        const f = Math.sin(slot.age * 11) * 0.06 + Math.sin(slot.age * 4.3) * 0.05;
        slot.light.intensity = slot.peak * (1 + f);
      }
    }
  }

  function dispose() {
    for (const slot of slots) {
      scene.remove(slot.light);
      slot.light.dispose?.();
    }
    slots.length = 0;
    built = false;
  }

  return { flash, attach, update, dispose };
}
