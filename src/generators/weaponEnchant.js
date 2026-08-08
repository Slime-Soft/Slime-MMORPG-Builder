// src/generators/weaponEnchant.js
// The particle enchantment on a glowing weapon: a drift of soft, glowing motes
// hugging the blade, born along its length, rising and fading as they go.
//
// WHY NOT three.quarks, which this project already has. The VFX system
// (src/render/vfx/index.js) is a scene-wide BatchedRenderer with a spawn/
// dispose lifecycle: a caller spawns an effect and is responsible for
// disposing it. That model fits a fireball. It fits a weapon enchantment
// badly, for two reasons:
//   1. LIFECYCLE. A weapon's glow lives exactly as long as the mesh holding
//      it, and that mesh is rebuilt on every equip, every remote player join,
//      every zone change — a dozen call sites, each of which would have to
//      remember to release a handle. One missed site is a looping emitter
//      that runs forever. Building the particles INTO the mesh means the
//      existing disposeObject() path already frees them.
//   2. THE BUILDERS HAVE NO VFX SYSTEM. The Equipment Builder and the
//      Character Builder each render into their own bare studio scene with no
//      BatchedRenderer in it. An enchantment you cannot see in the Equipment
//      Builder is not much use, and standing one up per page is more moving
//      parts than the effect is worth.
//
// So this is a plain THREE.Points cloud with a CPU-side update, driven from
// the same per-frame call that already animates every character's walk cycle
// (src/render/scene.js's updateWalkCycle). ~30 particles per weapon on one
// draw call: cheaper than the alternative, and it goes wherever the mesh goes.
import * as THREE from 'three';

/**
 * The sprite sheet, such as it is: one small canvas texture per particle style,
 * drawn once and shared by every enchantment in the scene.
 *
 * A style needs its own sprite, not just its own motion. Snow made of soft
 * round blobs is not snow, and lightning made of them is a string of fairy
 * lights — the silhouette is most of what tells you what you are looking at,
 * especially at these sizes where a particle is a dozen pixels across.
 *
 * Every sprite is drawn in WHITE with an alpha falloff. Colour comes from the
 * per-particle vertex colour at render time, so one texture serves a gold
 * sparkle and a green one.
 */
const textureCache = new Map();

function makeTexture(name, draw) {
  if (textureCache.has(name)) return textureCache.get(name);
  // Guarded for Node: the check scripts import the generators headlessly and
  // there is no canvas there. A null map still renders (as a square), which is
  // fine for a geometry check and never reached in a browser.
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  textureCache.set(name, tex);
  return tex;
}

/**
 * A radial falloff, deliberately NOT linear. A linear gradient reads as a hard
 * disc with a fuzzy edge, which is what makes cheap particle effects look
 * cheap; concentrating the brightness into a small core with a long faint
 * skirt is what a glowing point of light actually looks like.
 */
function radialGrad(ctx, cx, cy, r, peak = 1) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(255,255,255,${peak})`);
  g.addColorStop(0.18, `rgba(255,255,255,${peak * 0.62})`);
  g.addColorStop(0.42, `rgba(255,255,255,${peak * 0.22})`);
  g.addColorStop(0.72, `rgba(255,255,255,${peak * 0.05})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  return g;
}

const SPRITES = {
  mote: (ctx, s) => {
    ctx.fillStyle = radialGrad(ctx, s / 2, s / 2, s / 2);
    ctx.fillRect(0, 0, s, s);
  },
  // A teardrop: fat and bright at the base, tapering to a point at the top.
  // Flames are drawn tip-up because the particles travel up the blade.
  wisp: (ctx, s) => {
    ctx.fillStyle = radialGrad(ctx, s / 2, s * 0.72, s * 0.3);
    ctx.fillRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, s * 0.78, 0, s * 0.06);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.3)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(s * 0.5, s * 0.04);
    ctx.quadraticCurveTo(s * 0.78, s * 0.5, s * 0.68, s * 0.82);
    ctx.quadraticCurveTo(s * 0.5, s * 0.95, s * 0.32, s * 0.82);
    ctx.quadraticCurveTo(s * 0.22, s * 0.5, s * 0.5, s * 0.04);
    ctx.fill();
  },
  // Six arms with a cross-branch on each — the minimum that reads as a
  // snowflake rather than as an asterisk.
  flake: (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = radialGrad(ctx, c, c, s * 0.16, 0.9);
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ex = c + Math.cos(a) * c * 0.86, ey = c + Math.sin(a) * c * 0.86;
      ctx.lineWidth = s * 0.055;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(ex, ey); ctx.stroke();
      const bx = c + Math.cos(a) * c * 0.52, by = c + Math.sin(a) * c * 0.52;
      ctx.lineWidth = s * 0.035;
      for (const off of [0.6, -0.6]) {
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + off) * c * 0.26, by + Math.sin(a + off) * c * 0.26);
        ctx.stroke();
      }
    }
  },
  // A hot core with a vertical streak — a spark caught mid-flight, which is
  // what sells the crackle once these start jumping around.
  spark: (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.5, 'rgba(255,255,255,1)');
    g.addColorStop(0.58, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(s * 0.42, 0, s * 0.16, s);
    ctx.fillStyle = radialGrad(ctx, s / 2, s / 2, s * 0.26);
    ctx.fillRect(0, 0, s, s);
  },
  // Four-point twinkle: two crossed tapering bars plus a core.
  star: (ctx, s) => {
    const c = s / 2;
    ctx.fillStyle = radialGrad(ctx, c, c, s * 0.2);
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const rot of [0, Math.PI / 2]) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, -c * 0.95);
      ctx.lineTo(c * 0.09, 0);
      ctx.lineTo(0, c * 0.95);
      ctx.lineTo(-c * 0.09, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },
  // Overlapping low-alpha blobs: a single clean circle reads as a bubble, and
  // smoke is the one style whose whole job is to look shapeless.
  puff: (ctx, s) => {
    for (const [dx, dy, r] of [[0, 0, 0.46], [-0.16, 0.1, 0.3], [0.18, -0.08, 0.28], [0.06, 0.2, 0.24]]) {
      ctx.fillStyle = radialGrad(ctx, s / 2 + dx * s, s / 2 + dy * s, r * s, 0.42);
      ctx.fillRect(0, 0, s, s);
    }
  },
};

const spriteFor = (name) => makeTexture(name, SPRITES[name] || SPRITES.mote);

/**
 * The region motes are born in: the weapon's own bounding box, computed in the
 * weapon group's local space.
 *
 * Local, not world: the weapon hangs off a hand that is itself swinging inside
 * a walking body, so a world-space box would be wrong the instant anything
 * moved. Computed by walking the group manually rather than with Box3.
 * setFromObject because the mesh is still mid-construction here and its world
 * matrices have not been updated yet — setFromObject would read stale
 * identity matrices and return a box around the origin.
 */
function localBounds(root) {
  const box = new THREE.Box3();
  const walk = (obj, parentMatrix) => {
    obj.updateMatrix();
    const matrix = parentMatrix.clone().multiply(obj.matrix);
    if (obj.isMesh && obj.geometry) {
      if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
      box.union(obj.geometry.boundingBox.clone().applyMatrix4(matrix));
    }
    for (const child of obj.children) walk(child, matrix);
  };
  for (const child of root.children) walk(child, new THREE.Matrix4());
  return box.isEmpty() ? null : box;
}

/**
 * What each STYLE is, mechanically. This is the whole difference between a
 * flame and a snowfall — colour is not it.
 *
 *   sprite  which SPRITES entry to draw the particles with
 *   life    seconds a particle lives, before per-particle variation
 *   rise    how far along the blade it travels over that life, as a fraction
 *           of the blade's length. NEGATIVE falls — that is snow.
 *   spread  how far out from the blade the cloud sits
 *   twinkle 0..1 per-particle brightness wobble
 *   sway    lateral drift amplitude, on its own slow sine per particle
 *   swirl   how fast the cloud rotates around the blade
 *   grow    final size as a multiple of birth size. <1 shrinks (a flame
 *           consuming itself), >1 expands (smoke dissipating)
 *   jitter  0..1 chance per frame that a particle teleports somewhere new.
 *           This is what makes lightning crackle instead of drift, and it is
 *           the one property no amount of colour tuning can fake
 *   strobe  0..1 how strongly the whole cloud flashes at random intervals
 *   additive  false for smoke only — see GLOW_STYLES in gearVisuals.js
 */
const STYLE_TUNING = {
  motes: { sprite: 'mote', life: 1.5, rise: 0.32, spread: 0.55, twinkle: 0.15, sway: 0.06, swirl: 0.9, grow: 0.55 },
  // Fast, short-lived, wandering, and consuming itself as it climbs.
  flame: { sprite: 'wisp', life: 0.75, rise: 1.05, spread: 0.4, twinkle: 0.5, sway: 0.3, swirl: 0.5, grow: 0.25 },
  // The one that falls. Long life and a wide sway are what make it read as
  // drifting snow rather than as sparks running backwards.
  frost: { sprite: 'flake', life: 2.8, rise: -0.55, spread: 0.85, twinkle: 0.3, sway: 0.55, swirl: 0.25, grow: 0.8 },
  // Barely there between crackles: very short life, heavy jitter, whole-cloud
  // flashes on top.
  lightning: { sprite: 'spark', life: 0.3, rise: 0.25, spread: 0.7, twinkle: 0.85, sway: 0.12, swirl: 1.6, grow: 0.4, jitter: 0.35, strobe: 0.9 },
  embers: { sprite: 'mote', life: 1.9, rise: 0.8, spread: 0.5, twinkle: 0.7, sway: 0.22, swirl: 0.7, grow: 0.2 },
  sparkle: { sprite: 'star', life: 1.3, rise: 0.14, spread: 0.75, twinkle: 0.9, sway: 0.1, swirl: 0.35, grow: 0.6 },
  smoke: { sprite: 'puff', life: 2.4, rise: 0.55, spread: 0.9, twinkle: 0.05, sway: 0.18, swirl: 0.3, grow: 2.2, additive: false },
};

/** The brightness envelope over the whole cloud. Orthogonal to style — see the GLOW_MODES doc comment in gearVisuals.js. */
const MODE_ENVELOPE = {
  steady: () => 1,
  pulse: (t, speed) => 0.68 + 0.32 * Math.sin(t * speed * 2),
  // Two detuned sines: one alone reads as a fast pulse, not as something
  // unstable.
  flicker: (t, speed) => 0.72 + 0.28 * Math.sin(t * speed * 5.3) * Math.cos(t * speed * 3.1),
};

/**
 * The box particles are born in, in the weapon's own local space.
 *
 * Defaults to the weapon's own geometry, grown by a pad — particles have to be
 * born slightly OUTSIDE the metal, because spawning them inside the blade puts
 * half the cloud behind an opaque surface at any angle, and that reads as
 * flickering rather than as a haze.
 *
 * An authored `offset` moves that box and an authored `extent` replaces its
 * dimensions, per axis. Both are in metres in the WEAPON's local space, where
 * the origin is the grip point and +Y runs up the weapon toward a staff's orb
 * or a sword's pommel (see the convention at the top of weapon.js). So for a
 * blade, `extent.y` is how far the effect runs along it and `extent.x`/
 * `extent.z` are how far it stands off the flat and the edge.
 *
 * An extent axis left at 0 or omitted keeps the automatic measurement for that
 * axis alone, so you can widen a cloud without also having to re-state how long
 * it is.
 *
 * NOTE this is the BIRTH region, not a hard container: a style's `rise` carries
 * particles on past it over their life, which is what makes flames climb off
 * the tip. Growing the box grows where they start, not a wall they stop at.
 */
function resolveEmissionBox(geometryBounds, glow) {
  const extent = new THREE.Vector3().subVectors(geometryBounds.max, geometryBounds.min);
  const pad = Math.max(0.02, Math.min(extent.x, extent.z) * 0.6);
  const auto = new THREE.Vector3(extent.x + pad * 2, extent.y + pad * 2, extent.z + pad * 2);

  // `extent`, not `size` — `size` is already taken by how big one PARTICLE is,
  // and two fields called size on one object is a bug waiting to be authored.
  const want = glow.extent || {};
  const resolved = new THREE.Vector3(
    want.x > 0 ? want.x : auto.x,
    want.y > 0 ? want.y : auto.y,
    want.z > 0 ? want.z : auto.z,
  );

  const offset = glow.offset || {};
  const centre = geometryBounds.getCenter(new THREE.Vector3());
  centre.x += offset.x || 0;
  centre.y += offset.y || 0;
  centre.z += offset.z || 0;

  return { min: centre.clone().addScaledVector(resolved, -0.5), extent: resolved };
}

/**
 * Build the mote cloud for one weapon and parent it to that weapon.
 *
 * Returns null when there's nothing to do (no glow, or a weapon with no
 * geometry to measure), so callers can call it unconditionally.
 *
 * @param {THREE.Group} weaponMesh a group from generateWeapon, already gripped
 * @param {import('../sim/gearVisuals.js').GearGlow} glow
 * @returns {THREE.Points|null}
 */
export function buildWeaponEnchant(weaponMesh, glow) {
  if (!glow || glow.mode === 'none') return null;
  const bounds = localBounds(weaponMesh);
  if (!bounds) return null;

  const tuning = STYLE_TUNING[glow.style] || STYLE_TUNING.motes;
  const envelope = MODE_ENVELOPE[glow.mode] || MODE_ENVELOPE.steady;
  const count = Math.max(1, Math.round(glow.density ?? 28));
  const size = glow.size ?? 0.075;
  const speed = glow.speed ?? 1;

  const { min, extent } = resolveEmissionBox(bounds, glow);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  // The cloud never leaves the weapon, and the weapon is always on screen when
  // the character is — an auto-computed sphere would be recomputed for nothing
  // and, worse, would be wrong the moment a particle drifts past it and cull
  // the whole cloud mid-swing.
  // Sized off the EMISSION box (which the author may have grown well past the
  // weapon), plus room for the travel that carries particles beyond it.
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3().copy(min).addScaledVector(extent, 0.5),
    extent.length() * 0.5 + Math.abs(tuning.rise) * extent.length() * 0.5 + 0.1,
  );

  const points = new THREE.Points(geometry, new THREE.PointsMaterial({
    size,
    map: spriteFor(tuning.sprite),
    vertexColors: true,
    transparent: true,
    // Additive: light adds to what is behind it. Combined with depthWrite off,
    // motes never occlude each other or the blade, so no sort order exists to
    // be unstable — which is what the previous, shell-based glow got wrong.
    // Smoke is normal-blended: additive dark is invisible, and shadow magic
    // that BRIGHTENS what is behind it reads as fog rather than as shadow.
    blending: tuning.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    fog: false,
  }));
  points.castShadow = false;
  points.receiveShadow = false;
  points.renderOrder = 3;
  // Neither toonify() nor applyCreatureShadowFlags() should touch this: it is
  // unlit by definition and casts nothing.
  points.userData.preserveMaterial = true;

  const bornColor = new THREE.Color(glow.color ?? 0xffffff);
  const deadColor = new THREE.Color(glow.secondaryColor ?? glow.color ?? 0xffffff);

  points.userData.weaponEnchant = {
    count, min: min.clone(), extent: extent.clone(), size, speed, tuning, envelope,
    bornColor, deadColor,
    // Whole-cloud flash level, decaying — driven by `strobe`, so it stays 0 for
    // every style but lightning.
    flash: 0,
    // age[i] runs 0..1 over a particle's life. Seeded spread out rather than at
    // zero so the cloud is already alive on frame one — a weapon drawn for the
    // first time should not visibly "start up".
    age: new Float32Array(count).map(() => Math.random()),
    lifeScale: new Float32Array(count).map(() => 0.7 + Math.random() * 0.6),
    seed: new Float32Array(count).map(() => Math.random() * Math.PI * 2),
    // Where along the blade each mote sits, and how far out. Re-rolled on
    // rebirth (see updateWeaponEnchants).
    along: new Float32Array(count).map(() => Math.random()),
    around: new Float32Array(count).map(() => Math.random() * Math.PI * 2),
    radial: new Float32Array(count).map(() => Math.random()),
  };
  // Give every particle a proper starting spot through the same function
  // rebirth uses, so a style with special birth rules (frost, which must start
  // HIGH on the blade or the cloud immediately falls off the tip) is seeded
  // correctly on frame one rather than only after a full life cycle.
  for (let i = 0; i < count; i++) reseed(points.userData.weaponEnchant, i);
  weaponMesh.add(points);
  writeParticles(points, 0);
  return points;
}

/** Longest axis of the weapon's box — the blade. Motes are distributed along it, which is what makes the effect hug the shape instead of balling up at the grip. */
function majorAxis(extent) {
  if (extent.y >= extent.x && extent.y >= extent.z) return 1;
  return extent.z >= extent.x ? 2 : 0;
}

const _tmp = new THREE.Vector3();

/** Recompute every mote's position/colour/size for the current ages. */
function writeParticles(points, t) {
  const s = points.userData.weaponEnchant;
  const pos = points.geometry.attributes.position;
  const col = points.geometry.attributes.color;
  const siz = points.geometry.attributes.size;
  const axis = majorAxis(s.extent);
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  const crossU = s.extent.getComponent(u) * 0.5;
  const crossV = s.extent.getComponent(v) * 0.5;
  const centreU = s.min.getComponent(u) + s.extent.getComponent(u) * 0.5;
  const centreV = s.min.getComponent(v) + s.extent.getComponent(v) * 0.5;

  // pulse breathes the whole cloud; the other modes hold steady and let the
  // per-particle twinkle do the work.
  // The mode's envelope, plus lightning's strobe on top of it.
  const breathe = s.envelope(t, s.speed) * (1 + s.flash * 2.5);
  const grow = s.tuning.grow ?? 0.55;

  for (let i = 0; i < s.count; i++) {
    const age = s.age[i];
    // Travel along the blade axis as the particle ages — up for most styles,
    // DOWN where `rise` is negative, which is what makes frost fall.
    const travel = age * s.tuning.rise;
    // Swirl around the axis, plus a slow independent sway. The two together
    // stop the cloud looking painted on when the camera is still, and the sway
    // is what gives a falling flake its drift.
    const swirl = s.around[i] + t * s.speed * s.tuning.swirl + s.seed[i] * 0.15;
    const sway = (s.tuning.sway || 0) * Math.sin(t * s.speed * 1.7 + s.seed[i] * 2.3);
    const radial = s.radial[i] * s.tuning.spread + age * 0.35;

    _tmp.setComponent(axis, s.min.getComponent(axis) + (s.along[i] + travel) * s.extent.getComponent(axis));
    _tmp.setComponent(u, centreU + (Math.cos(swirl) * radial + sway) * crossU);
    _tmp.setComponent(v, centreV + (Math.sin(swirl) * radial + sway * 0.6) * crossV);
    pos.setXYZ(i, _tmp.x, _tmp.y, _tmp.z);

    // Fade in fast, out slow — a particle that fades in as slowly as it fades
    // out reads as a pulsing dot rather than a spark catching light.
    const fade = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85;
    const twinkle = 1 - s.tuning.twinkle * (0.5 + 0.5 * Math.sin(t * s.speed * 7 + s.seed[i] * 3));
    const k = Math.max(0, fade) * twinkle * breathe;
    col.setXYZ(i,
      (s.bornColor.r + (s.deadColor.r - s.bornColor.r) * age) * k,
      (s.bornColor.g + (s.deadColor.g - s.bornColor.g) * age) * k,
      (s.bornColor.b + (s.deadColor.b - s.bornColor.b) * age) * k);
    // Size runs from birth size to `grow` x that over the particle's life:
    // shrinking for a flame consuming itself, expanding for smoke dissipating.
    siz.setX(i, s.size * (1 + (grow - 1) * age) * (0.6 + 0.8 * s.lifeScale[i]));
  }
  pos.needsUpdate = true;
  col.needsUpdate = true;
  siz.needsUpdate = true;
}

/**
 * Advance every enchantment under `root` by `dt` seconds.
 *
 * Called from updateWalkCycle (src/render/scene.js), which is already run once
 * per frame for every character mesh in the game and in every builder preview —
 * so an enchantment animates everywhere a character is drawn, with no separate
 * registry of live effects to keep in sync.
 *
 * @param {THREE.Object3D} root a built character/creature group
 * @param {number} t seconds (absolute, for the swirl/twinkle phases)
 * @param {number} dt seconds since the last frame
 */
export function updateWeaponEnchants(root, t, dt) {
  const list = root.userData.weaponEnchants;
  if (!list || !list.length) return;
  for (const points of list) {
    const s = points.userData.weaponEnchant;
    const strobe = s.tuning.strobe || 0;
    if (strobe) {
      // A thunderclap: rare, instant, and gone. Decay is frame-rate
      // independent so the flash lasts the same fraction of a second whether
      // the game is running at 30fps or 144.
      s.flash *= Math.exp(-dt * 9);
      if (Math.random() < dt * 2.2 * s.speed) s.flash = strobe;
    }
    for (let i = 0; i < s.count; i++) {
      s.age[i] += dt / (s.tuning.life * s.lifeScale[i]) * s.speed;
      // Crackle: a jittering style teleports a slice of its particles every
      // frame instead of letting them travel. No amount of colour or speed
      // tuning produces this — a drifting spark reads as a firefly, and it is
      // the discontinuity that reads as electricity.
      if (s.tuning.jitter && Math.random() < s.tuning.jitter) reseed(s, i);
      if (s.age[i] < 1) continue;
      // Reborn with a fresh position, not simply wrapped: reusing the same
      // offsets would make every particle retrace one visible track, which the
      // eye picks out immediately.
      s.age[i] -= 1;
      reseed(s, i);
    }
    writeParticles(points, t);
  }
}

/** Give particle `i` a fresh spot around the blade and a fresh lifespan. */
function reseed(s, i) {
  // Frost falls, so it has to be BORN high up the blade or it drops off the
  // tip immediately and the cloud collects below the weapon.
  s.along[i] = s.tuning.rise < 0 ? 0.3 + Math.random() * 0.7 : Math.random() * 0.7;
  s.around[i] = Math.random() * Math.PI * 2;
  s.radial[i] = Math.random();
  s.lifeScale[i] = 0.7 + Math.random() * 0.6;
}
