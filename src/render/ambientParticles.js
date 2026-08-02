// src/render/ambientParticles.js
// Ambient "air particle" effects (dust, snow, wind, rain, storm, sand,
// fireflies, miasma), confined to some region with an arbitrary containment
// test. Two independent sources feed the same PARTICLE_DEFS/buildRegion
// Particles machinery: a painted world.groundTextures[] layer's mask
// (src/sim/groundTextures.js's particleType, createAmbientParticleSystem)
// and a freeform/circle world.zones[] entry (src/sim/zones.js's
// particleType, createZoneParticleSystem). Live game only, same reasoning
// the editor already applies to toonify()/shadows: it's a static blockout
// tool, not the final view, so it doesn't run atmospheric effects.
import * as THREE from 'three';
import { isPointInZone, zoneBounds } from '../sim/zones.js';

// `size` is a WORLD-SPACE diameter (PointsMaterial with sizeAttenuation), not
// a pixel size. The gameplay camera orbits ~15-25m out at fov 60, where a
// particle's on-screen size is roughly `size * 780 / distance` pixels — so the
// original 0.03-0.06 values worked out to 1-3px of a sprite that's a radial
// gradient fading to fully transparent at its rim, i.e. invisible. Anything
// meant to be *seen* rather than merely *simulated* needs ~0.15+ here.
//
// `streak` is the streak LENGTH in metres, and is what makes rain read as rain:
// a falling round dot doesn't, at any size. A def with `streak` renders as
// LineSegments trailing behind its own velocity vector instead of as Points
// (`size` is then unused — WebGL can't do line thickness).
const PARTICLE_DEFS = {
  // Dust motes are lit specks, not dirt: 0xd8c9a6 is a mid tan that reads as
  // brown against terrain instead of as light catching in the air. The colour
  // has to stay near-white with only a warm bias. The height band was also the
  // reason it looked like a knee-high haze — 3m is barely above head height on
  // a chibi character, so nothing ever drifted through the upper frame. Raising
  // the ceiling multiplies the box's volume, so `count` has to climb with it or
  // the same motes just spread thinner.
  dust: { color: 0xf4ecd8, size: 0.2, count: 900, height: [0.2, 14], fall: 0.05, drift: 0.15, opacity: 0.5 },
  snow: { color: 0xffffff, size: 0.18, count: 700, height: [0.5, 9], fall: 0.9, drift: 0.25, opacity: 0.9 },
  wind: { color: 0xeef2e6, count: 300, height: [0.3, 4], fall: 0, drift: 2.4, opacity: 0.35, horizontal: true, streak: 1.4 },
  rain: { color: 0xa8ccea, count: 900, height: [1, 12], fall: 11, drift: 1.2, opacity: 0.5, streak: 0.9 },
  storm: { color: 0x8fa8bd, count: 1300, height: [1, 14], fall: 15, drift: 3.5, opacity: 0.55, streak: 1.6 },
  sand: { color: 0xd9b878, size: 0.14, count: 500, height: [0.1, 2.5], fall: 0, drift: 1.6, opacity: 0.45, horizontal: true },
  fireflies: { color: 0xdfff8a, size: 0.16, count: 60, height: [0.3, 2], fall: 0, drift: 0.4, opacity: 0.95, glow: true },
  miasma: { color: 0x9d7fb5, size: 0.9, count: 40, height: [0.2, 2.2], fall: 0, drift: 0.08, opacity: 0.3, glow: true },
};
export const PARTICLE_TYPE_IDS = Object.keys(PARTICLE_DEFS);
export const PARTICLE_TYPE_LABELS = {
  dust: 'Dust', snow: 'Snow', wind: 'Wind', rain: 'Rain', storm: 'Storm',
  sand: 'Sand', fireflies: 'Fireflies', miasma: 'Miasma',
};

let spriteTexture = null;
function getSpriteTexture() {
  if (spriteTexture) return spriteTexture;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  spriteTexture = new THREE.CanvasTexture(canvas);
  return spriteTexture;
}

function bilinearSampleMask(layer, bounds, x, z) {
  const { resolution, cells } = layer;
  const u = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  const v = (z - bounds.minZ) / (bounds.maxZ - bounds.minZ);
  const gx = Math.min(1, Math.max(0, u)) * resolution;
  const gz = Math.min(1, Math.max(0, v)) * resolution;
  const x0 = Math.floor(gx), x1 = Math.min(resolution, x0 + 1);
  const z0 = Math.floor(gz), z1 = Math.min(resolution, z0 + 1);
  const tx = gx - x0, tz = gz - z0;
  const c00 = cells[z0 * (resolution + 1) + x0];
  const c10 = cells[z0 * (resolution + 1) + x1];
  const c01 = cells[z1 * (resolution + 1) + x0];
  const c11 = cells[z1 * (resolution + 1) + x1];
  const top = c00 + (c10 - c00) * tx;
  const bot = c01 + (c11 - c01) * tx;
  return top + (bot - top) * tz;
}

/** World-space bounding box of a mask's painted area (weight above a small threshold), or null if nothing's painted. */
function maskBounds(layer, bounds) {
  const { resolution, cells } = layer;
  let minGX = resolution, maxGX = 0, minGZ = resolution, maxGZ = 0, any = false;
  for (let gz = 0; gz <= resolution; gz++) {
    for (let gx = 0; gx <= resolution; gx++) {
      if (cells[gz * (resolution + 1) + gx] > 0.15) {
        any = true;
        if (gx < minGX) minGX = gx;
        if (gx > maxGX) maxGX = gx;
        if (gz < minGZ) minGZ = gz;
        if (gz > maxGZ) maxGZ = gz;
      }
    }
  }
  if (!any) return null;
  const toWorldX = (gx) => bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
  const toWorldZ = (gz) => bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
  return { minX: toWorldX(minGX), maxX: toWorldX(maxGX), minZ: toWorldZ(minGZ), maxZ: toWorldZ(maxGZ) };
}

/** Rejection-samples within the region's bbox against `containsFn(x,z)`, so particles follow the actual painted/zone shape instead of just its bounding box. Falls back to the region center after a few misses rather than looping indefinitely on a thin sliver-shaped region. */
function spawnPointInRegion(containsFn, region) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = region.minX + Math.random() * (region.maxX - region.minX);
    const z = region.minZ + Math.random() * (region.maxZ - region.minZ);
    if (containsFn(x, z)) return { x, z };
  }
  return { x: (region.minX + region.maxX) / 2, z: (region.minZ + region.maxZ) / 2 };
}

function buildRegionParticles(def, region, containsFn, sizeMul = 1, densityMul = 1) {
  const count = Math.max(1, Math.round(def.count * densityMul));
  // A streaked particle owns TWO vertices (head + tail) instead of one.
  const verticesPer = def.streak ? 2 : 1;
  const positions = new Float32Array(count * verticesPer * 3);
  const velocities = new Float32Array(count * 3);
  // Constant per-particle head->tail offset, so the streak keeps pointing back
  // along its own direction of travel for its whole life.
  const tails = def.streak ? new Float32Array(count * 3) : null;
  const lateral = def.horizontal || def.streak ? 1 : 0.3;
  for (let i = 0; i < count; i++) {
    const p = spawnPointInRegion(containsFn, region);
    const y = def.height[0] + Math.random() * (def.height[1] - def.height[0]);
    let vx, vz;
    if (def.streak && !def.horizontal) {
      // Falling streaks slant along ONE shared wind direction (+x/+z, varied
      // only in magnitude). A per-particle random angle — what this used to do
      // — makes rain fall in every direction at once, which reads as confetti.
      vx = def.drift * (0.6 + Math.random() * 0.4);
      vz = def.drift * (0.3 + Math.random() * 0.3);
    } else {
      const driftAngle = Math.random() * Math.PI * 2;
      vx = Math.cos(driftAngle) * def.drift * lateral;
      vz = Math.sin(driftAngle) * def.drift * lateral;
    }
    const vy = -def.fall;
    velocities[i * 3] = vx;
    velocities[i * 3 + 1] = vy;
    velocities[i * 3 + 2] = vz;
    if (tails) {
      const len = Math.hypot(vx, vy, vz) || 1;
      tails[i * 3] = (-vx / len) * def.streak;
      tails[i * 3 + 1] = (-vy / len) * def.streak;
      tails[i * 3 + 2] = (-vz / len) * def.streak;
      positions[i * 6] = p.x;
      positions[i * 6 + 1] = y;
      positions[i * 6 + 2] = p.z;
      positions[i * 6 + 3] = p.x + tails[i * 3];
      positions[i * 6 + 4] = y + tails[i * 3 + 1];
      positions[i * 6 + 5] = p.z + tails[i * 3 + 2];
    } else {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = p.z;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const obj = def.streak
    ? new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      color: def.color,
      transparent: true,
      opacity: def.opacity,
      depthWrite: false,
      blending: def.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    }))
    : new THREE.Points(geo, new THREE.PointsMaterial({
      color: def.color,
      size: def.size * sizeMul,
      map: getSpriteTexture(),
      transparent: true,
      opacity: def.opacity,
      depthWrite: false,
      blending: def.glow ? THREE.AdditiveBlending : THREE.NormalBlending,
      sizeAttenuation: true,
    }));
  obj.renderOrder = 5;
  obj.frustumCulled = false;
  return { points: obj, velocities, tails, region, def };
}

/** Shared per-frame advection + wrap-on-exit for both particle sources below — a toroidal-wrap infinite-effect loop, not a spawn/despawn system. */
function updateRegionParticleSystems(systems, dt) {
  for (const sys of systems) {
    const pos = sys.points.geometry.attributes.position;
    const { velocities, tails, region, def } = sys;
    const stride = tails ? 2 : 1; // head vertex, then (for streaks) its tail
    const count = pos.count / stride;
    for (let i = 0; i < count; i++) {
      const h = i * stride;
      let x = pos.getX(h) + velocities[i * 3] * dt;
      let y = pos.getY(h) + velocities[i * 3 + 1] * dt;
      let z = pos.getZ(h) + velocities[i * 3 + 2] * dt;
      // Wrap within the region's bbox / height band so the effect reads as
      // continuous rather than draining away after a few seconds. `region` is
      // mutable on purpose — the follow-the-player system below slides it every
      // frame, which is what keeps the particles themselves in world space.
      const baseY = region.baseY || 0;
      if (x < region.minX) x = region.maxX;
      else if (x > region.maxX) x = region.minX;
      if (z < region.minZ) z = region.maxZ;
      else if (z > region.maxZ) z = region.minZ;
      if (y < baseY + def.height[0]) y = baseY + def.height[1];
      pos.setXYZ(h, x, y, z);
      if (tails) pos.setXYZ(h + 1, x + tails[i * 3], y + tails[i * 3 + 1], z + tails[i * 3 + 2]);
    }
    pos.needsUpdate = true;
  }
}

/**
 * Builds one Points system per world.groundTextures layer that has a
 * particleType set. Returns { group, update(dt), isEmpty } — add `group` to
 * the scene and call `update(dt)` once per frame.
 */
export function createAmbientParticleSystem(world) {
  const group = new THREE.Group();
  group.name = 'ambient-particles';
  const systems = [];

  for (const layer of world.groundTextures || []) {
    if (!layer.particleType || !PARTICLE_DEFS[layer.particleType]) continue;
    const region = maskBounds(layer, world.bounds);
    if (!region) continue;
    const def = PARTICLE_DEFS[layer.particleType];
    const containsFn = (x, z) => bilinearSampleMask(layer, world.bounds, x, z) > 0.2;
    const sys = buildRegionParticles(def, region, containsFn, layer.particleSizeMultiplier ?? 1, layer.particleDensityMultiplier ?? 1);
    group.add(sys.points);
    systems.push(sys);
  }

  return { group, update: (dt) => updateRegionParticleSystems(systems, dt), isEmpty: systems.length === 0 };
}

// A box that follows the player rather than covering world.bounds — this
// effect is meant to read as "weather around the player," and spreading one
// particle budget across an entire (often much larger) map leaves almost
// nothing near the camera.
//
// 26, not 40: the single biggest lever on whether the effect reads at all,
// because def.count is spread across the box's whole VOLUME. Doubling the
// radius is 4x the area for the same budget, and the camera only ever sees the
// ~25m nearest it — the rest is simulated where nobody is looking.
const ENV_PARTICLE_BOX_RADIUS = 26;

/** Offsets every vertex of a built system in place. Used once, to drop a freshly-built field onto the player instead of leaving it at the world origin. */
function translateParticles(sys, dx, dy, dz) {
  const pos = sys.points.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
  }
  pos.needsUpdate = true;
}

/**
 * One particle system that stays around the player, for
 * graphicsSettings.environmental (src/sim/graphicsSettings.js) — a map-wide
 * effect, unlike a ground-texture layer's or zone's own particleType which is
 * confined to a painted/drawn shape. Same PARTICLE_DEFS/buildRegionParticles
 * machinery, with containsFn always true since there's no shape to test
 * against. 'sunrays' isn't a particle system at all (it's a screen-space pass
 * plus a sun sprite — see postProcessing.js/atmosphere.js) so it's excluded.
 *
 * The particles live in WORLD SPACE and only the wrap box follows the player.
 * Translating the group itself instead — the obvious implementation, and what
 * this did first — welds every flake to the camera: walk north and the entire
 * snowfall walks north with you, so nothing ever passes you and the weather
 * reads as a decal stuck to the screen. Here the flakes stay where they are and
 * a flake that falls out the back of the box reappears at the front, which is
 * invisible precisely because they're interchangeable.
 *
 * Returns { group, update(dt, followPosition), isEmpty } — followPosition is
 * required (unlike the other two builders' update(dt), whose regions are static
 * world-space shapes that don't move).
 */
export function createEnvironmentalParticleSystem(world, environmental) {
  const group = new THREE.Group();
  group.name = 'environmental-particles';
  const type = environmental?.type;
  if (!type || type === 'sunrays' || !PARTICLE_DEFS[type]) {
    return { group, update: () => {}, isEmpty: true };
  }
  const def = PARTICLE_DEFS[type];
  const r = ENV_PARTICLE_BOX_RADIUS;
  const region = { minX: -r, maxX: r, minZ: -r, maxZ: r, baseY: 0 };
  const sys = buildRegionParticles(def, region, () => true, 1, environmental.intensity ?? 1);
  group.add(sys.points);
  let placed = false; // the field is built around the origin; the first update drops it onto the player
  return {
    group,
    update: (dt, followPosition) => {
      if (followPosition) {
        const px = followPosition.x;
        const pz = followPosition.z;
        // Follow y as well — def.height is a band above the followed point's
        // FEET, so a box pinned to y=0 rains below you on any elevated terrain.
        const py = followPosition.y || 0;
        const cx = (region.minX + region.maxX) / 2;
        const cz = (region.minZ + region.maxZ) / 2;
        // Any jump bigger than the box (first placement, a teleport, a respawn)
        // moves the whole field bodily. Letting the per-particle wrap handle it
        // would clamp EVERY particle to the same edge in one frame — a visible
        // sheet — since wrapping only ever mirrors a coordinate once.
        if (!placed || Math.hypot(px - cx, pz - cz) > r) {
          translateParticles(sys, px - cx, py - region.baseY, pz - cz);
          placed = true;
        }
        region.minX = px - r; region.maxX = px + r;
        region.minZ = pz - r; region.maxZ = pz + r;
        region.baseY = py;
      }
      updateRegionParticleSystems([sys], dt);
    },
    isEmpty: false,
  };
}

/**
 * Builds one Points system per world.zones entry that has a particleType
 * set (either shape — circle or freeform polygon, see src/sim/zones.js).
 * Returns { group, update(dt), isEmpty } — same shape as
 * createAmbientParticleSystem, add `group` to the scene and call
 * `update(dt)` once per frame.
 */
export function createZoneParticleSystem(world) {
  const group = new THREE.Group();
  group.name = 'zone-particles';
  const systems = [];

  for (const zone of world.zones || []) {
    if (!zone.particleType || !PARTICLE_DEFS[zone.particleType]) continue;
    const region = zoneBounds(zone);
    const def = PARTICLE_DEFS[zone.particleType];
    const containsFn = (x, z) => isPointInZone(zone, x, z);
    const sys = buildRegionParticles(def, region, containsFn);
    group.add(sys.points);
    systems.push(sys);
  }

  return { group, update: (dt) => updateRegionParticleSystems(systems, dt), isEmpty: systems.length === 0 };
}
