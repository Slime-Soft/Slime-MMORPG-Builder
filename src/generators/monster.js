// src/generators/monster.js
// Procedural monster shapes for the Tower. Monsters only ever exist inside
// the tower (see CLAUDE.md World Setting), so this is a separate generator
// from the player character one, not a reskin of it.
import * as THREE from 'three';
import { createRng, range, pick } from './seededRandom.js';
import { buildMonsterRig } from './monsterRig.js';

const SLIME_COLORS = [0x4fd15a, 0x3fb0d1, 0xd14f9a, 0xc9c93f];

export function generateSlime(seed) {
  const rng = createRng(seed);
  const color = pick(rng, SLIME_COLORS);
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 12, 10),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, roughness: 0.3 })
  );
  body.scale.set(1, 0.72, 1); // squash into a blob
  body.position.y = 0.5;
  body.castShadow = true;
  group.add(body);

  // A couple of simple dark eye dots so it reads as a creature, not a rock.
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), eyeMat);
    eye.position.set(side * 0.18, 0.55, 0.55);
    group.add(eye);
  }

  return group;
}

const GOBLIN_SKIN_COLORS = [0x5a9a4a, 0x4a8a3a, 0x6ba85a];

export function generateGoblin(seed, options = {}) {
  const rng = createRng(seed);
  const skin = pick(rng, GOBLIN_SKIN_COLORS);
  const scale = options.scale ?? 1;
  const skinMat = new THREE.MeshStandardMaterial({ color: skin });
  const clothMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a });

  const group = new THREE.Group();

  const legHeight = 0.35;
  const legGeo = new THREE.CylinderGeometry(0.1, 0.09, legHeight, 6);
  const legL = new THREE.Mesh(legGeo, skinMat);
  legL.position.set(-0.13, legHeight / 2, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  group.add(legL, legR);

  const bodyHeight = 0.6;
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, bodyHeight * 0.5, 4, 8), clothMat);
  body.position.y = legHeight + bodyHeight / 2;
  body.castShadow = true;
  group.add(body);

  const armGeo = new THREE.CapsuleGeometry(0.07, 0.35, 4, 6);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.32, legHeight + bodyHeight * 0.55, 0);
  const armR = armL.clone();
  armR.position.x = 0.32;
  group.add(armL, armR);

  const headY = legHeight + bodyHeight + 0.32;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), skinMat);
  head.position.y = headY;
  head.castShadow = true;
  group.add(head);

  // Pointed ears — the easiest way to read "goblin" at a glance from this angle.
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 5), skinMat);
    ear.position.set(side * 0.34, headY + 0.05, 0);
    ear.rotation.z = side * 0.6;
    group.add(ear);
  }

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0x8a0000, emissiveIntensity: 0.4 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
    eye.position.set(side * 0.12, headY, 0.28);
    group.add(eye);
  }

  group.scale.setScalar(scale);
  return group;
}

/** Bosses are just a much larger, tougher-looking goblin variant for now — a dedicated silhouette can come later without changing the sim/combat contract. */
export function generateBossGolem(seed) {
  const group = generateGoblin(seed, { scale: 2.4 });
  // Recolor to stony/molten tones and add shoulder spikes so it doesn't
  // just look like "big goblin" at a glance.
  group.traverse((obj) => {
    if (obj.isMesh && obj.material.color.getHex() !== 0xff3b3b) {
      obj.material = obj.material.clone();
      obj.material.color.set(0x7a6a5a);
      obj.material.emissive = new THREE.Color(0x3a1a0a);
      obj.material.emissiveIntensity = 0.15;
    }
  });
  const spikeMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a });
  for (const side of [-1, 1]) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 6), spikeMat);
    spike.position.set(side * 0.34, 0.95, 0);
    spike.rotation.z = side * -0.4;
    group.add(spike);
  }
  return group;
}

/**
 * `monsterTypesById` is an optional Monster Builder catalog (see
 * src/sim/monsterTypeDefs.js) — when `type` matches a catalog entry, a
 * data-driven, poseable rig is built from its slots instead of the
 * hardcoded switch below. Defaults to `{}` so every existing call site
 * (which only ever passes 'slime'/'goblin'/'boss-golem') is byte-for-byte
 * unaffected — the 3 hardcoded types are not migrated into the catalog.
 */
export function generateMonster(type, seed, monsterTypesById = {}) {
  const monsterType = monsterTypesById[type];
  if (monsterType) return buildMonsterRig(monsterType).group;
  switch (type) {
    case 'slime': return generateSlime(seed);
    case 'goblin': return generateGoblin(seed);
    case 'boss-golem': return generateBossGolem(seed);
    default: return generateSlime(seed); // unknown type — render something rather than nothing
  }
}
