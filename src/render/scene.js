// src/render/scene.js
// Three.js rendering only. Reads sim/world state and draws it — never decides
// game logic (that lives in src/sim). Procedural placeholder geometry stands
// in for the Phase 2 parametric asset generator library.
import * as THREE from 'three';
import { generateTree } from '../generators/environment/tree.js';
import { generateRock } from '../generators/environment/rock.js';
import { generateGrassPatch, generateFlower } from '../generators/environment/grass.js';
import { generateCharacter } from '../generators/character.js';
import { buildPlayerCharacter } from '../generators/playerCharacter.js';
import { generateBuildingShell, generateWallSegment } from '../generators/environment/structures.js';
import { buildBuildingFromParts } from '../generators/buildingRig.js';
import { generateFurniture } from '../generators/interior/furniture.js';
import { generateMonster } from '../generators/monster.js';
import { generateCustomObject } from '../generators/custom.js';
import { buildProp } from '../generators/props.js';
import { GAIT_TABLES, applyGaitPose, applyIdlePose, applyKeyframeClip } from '../generators/rig.js';
import { sampleTerrainHeight } from '../sim/world.js';
import { applyAtmosphere, getPreset } from './atmosphere.js';
import { createGrassCover, buildGrassPropMesh } from './grassCover.js';
import { createFlowerCover, buildFlowerMeadowPropMesh } from './flowerCover.js';
import { getToonGradientMap } from './toonGradient.js';
import { createSwayAnimator, updateWindSwayTime } from './windSway.js';
import { createTreeLod } from './treeLod.js';
import { createPropBatcher } from './propBatcher.js';
import { buildPathMeshes } from './pathMesh.js';
import { buildMountainMeshes } from './mountainMesh.js';
import { buildGroundTextureOverlay } from './groundTextureMesh.js';
import { resolveAnchor } from './vfx/anchors.js';
import { getSoftDotTexture } from './vfx/textures.js';

export function createRenderer(canvas, { shadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = shadows;
  // ACES over the previous NoToneMapping default — a real tone-mapping
  // curve is what makes the graphics settings' Exposure control actually do
  // anything (NoToneMapping just clips at 1.0 regardless of exposure).
  // toneMappingExposure itself is set per-map by postProcessing.js's
  // applySettings(), not here.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return renderer;
}

// Re-exported for convenience so existing `from './scene.js'` imports keep
// working — see renderSettings.js for why the actual value lives there
// instead of here (avoids a circular import through the ground-texture
// theme files).
export { currentAnisotropy, setCurrentAnisotropy } from './renderSettings.js';

/**
 * Sky, fog and lights all come from an atmosphere preset now
 * (src/render/atmosphere.js) — the gradient dome plus horizon-matched
 * exponential fog is what gives the stylized, hazy depth of the reference art.
 * The sun's shadow frustum follows the player; call updateAtmosphere per frame.
 * @param {string} presetId see ATMOSPHERE_PRESETS
 */
export function createScene(presetId = 'meadow') {
  const scene = new THREE.Scene();
  applyAtmosphere(scene, presetId, { shadows: true, shadowRadius: 120 });
  return scene;
}

/**
 * Converts every MeshStandardMaterial found under `object` to
 * MeshToonMaterial (cel shading) — a cheap, fully reversible way to try a
 * more stylized look without touching any generator's geometry. Applied to
 * the live game scene (see buildWorldMeshes/buildFloorMeshes/
 * buildStoreInteriorMeshes/buildPlayerMesh/buildMonsterMesh below) AND to
 * the World Editor (src/editor/main.js), which used to deliberately skip
 * this for an "authoring tool, not the final view" look — Dennis asked for
 * the two to match instead, ahead of building real graphics-settings UI, so
 * the editor now calls this too (its own rebuildAll/rebuildFloorView, plus
 * every individual-placement path that bypasses those) and also enabled
 * shadows + the same bloom/OutputPass composer chain as src/main.js.
 */
export function toonify(object) {
  object.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    // An individually-placed prop's own sub-mesh can pre-opt out by setting
    // this — for a mesh whose material is already a MeshToonMaterial with
    // its own custom onBeforeCompile shader (e.g. tree.js's leaf
    // InstancedMesh, wind-swayed the same way grass is), toonify() would
    // otherwise still find a MeshToonMaterial and just leave color/map/etc.
    // alone — but it can't know the material *also* carries a custom
    // vertex-shader animation, and nothing here copies onBeforeCompile.
    // Individually-placed props are built and added to the scene BEFORE
    // this function runs (unlike grass/flowers/water, which are
    // deliberately built AFTER specifically to dodge this), so building the
    // material as its final toon-shaded form up front and flagging it here
    // is the fix for this code path — see tree.js for the actual usage.
    if (obj.userData.preserveMaterial) return;
    const wasArray = Array.isArray(obj.material);
    const materials = wasArray ? obj.material : [obj.material];
    const converted = materials.map((mat) => {
      if (!(mat instanceof THREE.MeshStandardMaterial)) return mat;
      return new THREE.MeshToonMaterial({
        color: mat.color,
        map: mat.map || null,
        transparent: mat.transparent,
        opacity: mat.opacity,
        emissive: mat.emissive,
        emissiveIntensity: mat.emissiveIntensity,
        // Carried over or the prop batcher's merged meshes turn WHITE: it
        // folds each prop's material colour into a per-vertex colour so props
        // of different colours can share one mesh (see render/propBatcher.js),
        // and the material's own colour is left white by design. Dropping the
        // flag here would throw that away and light the lot at full white.
        vertexColors: mat.vertexColors,
        gradientMap: getToonGradientMap(),
      });
    });
    obj.material = wasArray ? converted : converted[0];
  });
}

// Depth-buffer precision is governed almost entirely by the NEAR plane, not
// the far one: resolution at distance z goes as z^2 * (1/near - 1/far), so
// near=0.1 spent 80% of a 24-bit depth buffer on the first 10cm in front of
// the lens and left distant geometry fighting over what was left. That's what
// made textures shimmer in the distance — a path decal sits 3cm above the
// ground, and past ~150m with near=0.1 the depth buffer couldn't resolve 3cm,
// so the two surfaces swapped places from frame to frame.
//
// 0.5 is a 5x precision win at every distance and costs nothing here: this is
// a third-person camera that orbits several metres out, so nothing legitimate
// renders within half a metre of the lens. Do NOT drop it back toward 0.1
// without re-checking distant decals.
const CAMERA_NEAR = 0.5;

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    CAMERA_NEAR,
    2000
  );
  camera.position.set(0, 14, 20);
  return camera;
}

/**
 * Build Three.js objects from the fixed world JSON. Placeholder primitive
 * shapes stand in for the real procedural generators arriving in Phase 2.
 */
/**
 * Ground mesh: flat plane if the world has no `terrain` heightmap (Phase 1
 * behavior), otherwise a subdivided plane displaced to match it so what the
 * World Editor painted is what players walk on.
 */
export function buildGroundMesh(world, presetId = 'meadow') {
  const preset = getPreset(presetId);
  const w = world.bounds.maxX - world.bounds.minX;
  const d = world.bounds.maxZ - world.bounds.minZ;
  const segments = world.terrain ? world.terrain.resolution : 1;

  const geo = new THREE.PlaneGeometry(w, d, segments, segments);
  const pos = geo.attributes.position;

  // Elevation-blended vertex colours: low ground takes the preset's grass tone,
  // high ground its rock/snow tone. A single flat green reads as a prototype;
  // this is what makes a hillside look like a hillside without any texture.
  const low = new THREE.Color(preset.groundLow);
  const high = new THREE.Color(preset.groundHigh);
  const c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);

  let minH = Infinity;
  let maxH = -Infinity;
  if (world.terrain) {
    for (const h of world.terrain.heights) {
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }
  const span = Math.max(1e-3, maxH - minH);

  for (let i = 0; i < pos.count; i++) {
    // Plane is authored in XY before rotation; local x/y map to world x/z.
    const worldX = pos.getX(i) + (world.bounds.minX + world.bounds.maxX) / 2;
    const worldZ = -pos.getY(i) + (world.bounds.minZ + world.bounds.maxZ) / 2;
    const h = world.terrain ? sampleTerrainHeight(world, worldX, worldZ) : 0;
    if (world.terrain) pos.setZ(i, h);

    const t = world.terrain ? Math.min(1, Math.max(0, (h - minH) / span)) : 0;
    // Bias the blend so only genuinely high ground picks up the highland tone.
    c.copy(low).lerp(high, t * t);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (world.terrain) geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

export function buildWorldMeshes(scene, world, objectDefsById = {}, presetId = 'meadow', buildingCatalog = {}) {
  const ground = buildGroundMesh(world, presetId);
  scene.add(ground);

  scene.add(buildPathMeshes(world));
  scene.add(buildMountainMeshes(world));

  // Only the tower is a real in-game structure. The city-wall ring and the
  // gathering-zone markers (colored discs/rings) are World Editor authoring
  // aids — they're rendered in the editor (rebuildStatic/rebuildAll) but must
  // NOT show in the live game. buildCityWallPlaceholder/buildZoneMarker stay
  // exported for the editor's use.
  for (const zone of world.zones) {
    if (zone.type === 'tower') scene.add(buildTowerPlaceholder(zone));
  }

  for (const b of world.buildings) {
    scene.add(buildBuildingPlaceholder(b, world, buildingCatalog));
  }

  // Invisible teleporters render nothing live (same "editor shows it, the
  // game doesn't" convention as invisible walls just below) — they still
  // work server-side purely on proximity, see main.js's teleporter-trigger
  // loop for the client-side half of that.
  for (const t of world.teleporters || []) {
    if (!t.visible) continue;
    scene.add(buildTeleporterMesh(t));
  }

  for (const wallSeg of world.walls || []) {
    // Invisible walls are collider-only (see buildWorldColliders, which
    // already emits their OBB regardless of a mesh) — the live game is the
    // only caller of buildWorldMeshes, so skipping the mesh here means
    // players never see even a faint outline. The editor builds walls via
    // its own direct buildWallSegmentInstance() calls and does show one.
    if (wallSeg.invisible) continue;
    scene.add(buildWallSegmentInstance(wallSeg, world));
  }

  // Every dense/meadow preset (grass, grass-meadow, flower-meadow) becomes
  // instanced blades/stems/heads in one shared mesh apiece rather than one
  // mesh per prop — a scattered field is thousands of instances, and this is
  // the difference between one draw call and thousands.
  const grassProps = [];
  const meadowProps = [];
  const flowerMeadowProps = [];
  const swayingFlowerMeshes = []; // individually-placed 'flower'/'flower-daisy'/'flower-bell' — swayed below, after toonify
  const SWAYING_FLOWER_TYPES = new Set(['flower', 'flower-daisy', 'flower-bell']);
  const treeLeafMeshes = []; // each tree's own leaf InstancedMesh (see tree.js) — a separate material per tree, so each needs its own per-frame uTime update; see updateWindSwayTime below
  const treeLodEntries = []; // round-canopy trees only — see render/treeLod.js
  // Most props have no stable `id` (see src/editor/main.js's placement code)
  // and never need one — but a prop an Event Object has been attached to
  // (src/sim/events.js) DOES get one, specifically so its mesh can be looked
  // up later and hidden/shown when that event's world-shared visibility
  // state changes (e.g. a treasure chest disappearing once looted).
  const propMeshesById = new Map();
  const propBatcher = createPropBatcher();
  for (const prop of world.props) {
    if (prop.type === 'grass') { grassProps.push(prop); continue; }
    if (prop.type === 'grass-meadow') { meadowProps.push(prop); continue; }
    if (prop.type === 'flower-meadow') { flowerMeadowProps.push(prop); continue; }
    const mesh = buildPropPlaceholder(prop, world, objectDefsById);
    if (prop.id) propMeshesById.set(prop.id, mesh);
    if (SWAYING_FLOWER_TYPES.has(prop.type)) swayingFlowerMeshes.push(mesh);
    mesh.traverse((obj) => {
      if (obj.userData.isTreeLeaves) treeLeafMeshes.push(obj);
      // Tagged by generateFluffyTree. Collected off the placed mesh (rather
      // than the tree group) so the LOD reads the tree's real world position,
      // including the prop's terrain-sampled Y and scale.
      if (obj.userData.canopyLod) treeLodEntries.push({ lod: obj.userData.canopyLod, object: mesh });
    });
    // Static props get welded into per-cell meshes (see render/propBatcher.js)
    // — a city was costing ~3 draw calls per prop with no single type to blame,
    // which only a cross-prop merge can fix. Two kinds of prop are held back
    // because the game addresses them individually at runtime: an Event Object
    // (`prop.id`) gets shown/hidden as its event fires, and a swaying flower is
    // rotated per-object every frame.
    const batchable = !prop.id && !SWAYING_FLOWER_TYPES.has(prop.type);
    if (batchable && propBatcher.add(mesh)) continue; // fully consumed — nothing left to place
    scene.add(mesh);
  }
  // Must run BEFORE toonify(): the merged meshes have to be in the scene for
  // it to convert their materials like every other mesh, or the batched half
  // of the world would keep its raw MeshStandardMaterial look.
  propBatcher.flush(scene);

  toonify(scene);

  // Built AFTER toonify(), deliberately never passed through it: this
  // material's real behavior lives entirely in a custom onBeforeCompile
  // fragment shader (see groundTextureMesh.js), and toonify() only knows
  // how to carry over color/map/transparent/opacity/emissive/gradientMap
  // onto a fresh MeshToonMaterial — it has no idea a custom shader exists,
  // so it would silently discard the whole multi-layer blend and leave the
  // mesh sampling its dummy .map directly across the raw 0..1 UV (one
  // texture stretched across the entire map — this is what "ground texture
  // renders correctly in the editor but shows oversized/stretched in the
  // live game" turned out to be: the editor never calls toonify() at all).
  const groundTextureOverlay = buildGroundTextureOverlay(world);
  if (groundTextureOverlay) scene.add(groundTextureOverlay);

  // Also built AFTER toonify(scene) — same reason as groundTextureOverlay
  // just above: its material's ripple animation lives entirely in a custom
  // onBeforeCompile shader (see applyWaterShading), and toonify() would
  // silently replace the whole material with a plain MeshToonMaterial that
  // knows nothing about it.
  const seabed = buildSeabedMesh(world); // must be added before water so water's transparent surface composites over it
  if (seabed) scene.add(seabed);
  const water = buildWaterMesh(world);
  if (water) scene.add(water);

  // Discrete per-body lakes/puddles (src/sim/waterBodies.js) — additive
  // alongside the legacy world.waterMask plane above, not a replacement for
  // it yet (maps not migrated to waterBodies keep rendering exactly as
  // before). Same toonify-avoidance reason: each body's water material has
  // its own onBeforeCompile shader.
  const lakeBodies = buildLakeBodyMeshes(world);
  for (const { water: w, seabed: s, skirt: sk } of lakeBodies) {
    if (s) scene.add(s);
    if (sk) scene.add(sk);
    if (w) scene.add(w);
  }

  // Sloped rivers (kind:'river' bodies) — same additive/toonify-avoidance
  // reasoning as lakeBodies just above.
  const riverBodies = buildRiverBodyMeshes(world);
  for (const { water: w, seabed: s, skirt: sk } of riverBodies) {
    if (s) scene.add(s);
    if (sk) scene.add(sk);
    if (w) scene.add(w);
  }

  // Rocks the whole Group per-frame in JS (see windSway.js) rather than a
  // shader push — these are compound multi-mesh objects (stem/petals/center
  // as separate Meshes) with no generic per-vertex way to know "how close to
  // the base" a given sub-mesh is, so a shader-space push just slid the
  // entire object sideways, base included, which read as stiff/sliding
  // rather than swaying. A handful of individually-placed props is cheap
  // enough to animate this way; toonify() ordering doesn't matter here since
  // nothing touches materials.
  const sway = createSwayAnimator(swayingFlowerMeshes);
  // Same shape as `sway` above ({ update(elapsed) }), but each tree leaf
  // mesh needs its own updateWindSwayTime call (a separate material per
  // tree) rather than one shared rotation update.
  const treeSway = { update: (elapsed) => { for (const m of treeLeafMeshes) updateWindSwayTime(m, elapsed); } };
  // Null when the map has no round-canopy trees, so the caller can skip the
  // per-frame distance loop entirely rather than iterate an empty list.
  const treeLod = createTreeLod(treeLodEntries);

  const grass = createGrassCover(grassProps, meadowProps, world);
  if (grass) scene.add(grass.mesh);
  const flowers = createFlowerCover(flowerMeadowProps, world);
  if (flowers) scene.add(flowers.mesh);
  // Returned (not just added to `scene`) so a caller can rebuild just this
  // one decal later — e.g. once an async custom-texture upload finishes
  // loading after the initial bake (see registerCustomGroundTexture).
  return { grass, flowers, sway, treeSway, treeLod, groundTextureOverlay, water, seabed, lakeBodies, riverBodies, propMeshesById };
}

export function buildCityWallPlaceholder(zone) {
  const geo = new THREE.TorusGeometry(
    (zone.walls.innerRadius + zone.walls.outerRadius) / 2,
    (zone.walls.outerRadius - zone.walls.innerRadius) / 2,
    8,
    48
  );
  const mat = new THREE.MeshStandardMaterial({ color: 0x999088 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(zone.center.x, 4, zone.center.z);
  mesh.castShadow = true;
  return mesh;
}

export function buildTowerPlaceholder(zone) {
  const height = zone.floorCount * 4;
  const geo = new THREE.CylinderGeometry(
    zone.footprintRadius,
    zone.footprintRadius * 1.2,
    height,
    16
  );
  const mat = new THREE.MeshStandardMaterial({ color: 0x777788 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(zone.center.x, height / 2, zone.center.z);
  mesh.castShadow = true;
  return mesh;
}

export function buildZoneMarker(zone) {
  const colors = {
    wood_and_herbs: 0x2fb02f,
    ore: 0xd9772f,
    fish: 0x2fb0e0,
    misc_flora: 0xe0d02f,
  };
  const color = colors[zone.resource] || 0xffffff;
  const group = new THREE.Group();

  // Filled disc — brighter and higher above ground to avoid z-fighting/blending in.
  const fillMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(new THREE.CircleGeometry(zone.radius, 40), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.15;
  group.add(fill);

  // Solid boundary ring so the zone reads clearly even at a distance/in fog.
  const ringMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(zone.radius - 1.5, zone.radius, 48),
    ringMat
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  group.add(ring);

  group.position.set(zone.center.x, 0, zone.center.z);
  return group;
}

// Instant (auto-triggers on proximity) vs confirm (needs a click) get
// visibly different colors so a player — and an author placing them in the
// editor — can tell which is which without reading a tooltip.
const TELEPORTER_MODE_COLOR = { instant: 0x4fd8e0, confirm: 0xb06fe0 };

/**
 * The teleporter's own placeable object — an upright glowing ring with a
 * faint portal disc inside it, standing on the ground. Used by both the
 * live game (buildWorldMeshes, visible ones only — see its own doc
 * comment) and the World Editor (which shows every teleporter, invisible
 * ones as a dimmer gizmo — see editor/main.js's Teleporters mode).
 * @param {import('../sim/teleporters.js').TeleporterDef} teleporter
 * @param {{gizmo?: boolean}} [opts] gizmo = editor-only preview of an
 *   otherwise-invisible teleporter — dimmer/wireframe, never shown live.
 */
export function buildTeleporterMesh(teleporter, { gizmo = false } = {}) {
  const color = TELEPORTER_MODE_COLOR[teleporter.mode] ?? 0x4fd8e0;
  const group = new THREE.Group();
  group.name = 'teleporter';

  const ringMat = gizmo
    ? new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.5 })
    : new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.6 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 12, 32), ringMat);
  ring.position.y = 1;
  group.add(ring);

  const discMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: gizmo ? 0.15 : 0.35,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 24), discMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.05;
  group.add(disc);

  group.position.set(teleporter.position.x, teleporter.position.y || 0, teleporter.position.z);
  group.userData.teleporterId = teleporter.id;
  return group;
}

/**
 * The default overworld map's login spawn point — World Editor only, same
 * "authoring aid, never shipped live" role as buildZoneMarker/buildFreeformZoneMarker
 * above (the live client never draws this; the server just reads
 * `world.spawnPoint` for where a freshly-connected player's position starts —
 * see server/index.js's io.on('connection') handler). A gold beacon (ground
 * ring + rising beam + diamond cap + a facing arrow) so it reads distinctly
 * from teleporters (cyan/purple rings) and zone markers (resource-colored
 * discs) at a glance.
 *
 * The arrow is built pointing along +Z, which is the model-forward axis every
 * character in this project uses (`rotation.y = atan2(moveX, moveZ)`, so
 * rotation.y 0 = facing +Z) — so the caller aims it by simply rotating the
 * whole group to `spawnPoint.facingDeg`.
 */
export function buildSpawnPointMarker() {
  const color = 0xffcc33;
  const group = new THREE.Group();
  group.name = 'spawn-point';

  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.4, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  group.add(ring);

  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 3, 8), beamMat);
  beam.position.y = 1.5;
  group.add(beam);

  const capMat = new THREE.MeshBasicMaterial({ color });
  const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), capMat);
  cap.position.y = 3;
  group.add(cap);

  // Facing arrow, flat on the ground and reaching past the ring so the
  // direction is legible from the usual top-down-ish editor camera.
  const arrowMat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const shaft = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.6), arrowMat);
  shaft.rotation.x = -Math.PI / 2;
  shaft.position.set(0, 0.06, 0.8);
  group.add(shaft);

  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.9, 3), arrowMat);
  // Cone points along +Y in local space; +90deg about X lays it down pointing
  // +Z (a -90deg turn — what the flat planes in this file use — would aim it
  // at -Z, i.e. backwards).
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.06, 2.05);
  group.add(head);

  return group;
}

/**
 * A freeform-drawn (polygon) zone marker — World Editor only, same
 * "authoring aid, never shipped live" role as buildZoneMarker above, and the
 * same flat-not-terrain-following simplification (a zone reads as a region,
 * not ground decal). `zone.points` are world-space {x,z} pairs, implicitly
 * closed (no repeated last point) — same convention src/sim/zones.js's
 * isPointInZone expects.
 */
export function buildFreeformZoneMarker(zone) {
  const color = 0x33bbff;
  const group = new THREE.Group();

  // THREE.Shape lives in local XY; rotating -90deg about X to lay it flat
  // maps local (x, y) -> world (x, -y) on the Z axis (same relationship
  // buildGroundTextureOverlay/buildWaterMesh already rely on for their own
  // XZ<->local mapping) — negate z going in so the drawn shape isn't mirrored.
  const shape = new THREE.Shape();
  zone.points.forEach((p, i) => {
    if (i === 0) shape.moveTo(p.x, -p.z);
    else shape.lineTo(p.x, -p.z);
  });
  const fillMat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.15;
  group.add(fill);

  // Outline built directly in world space (no rotation applied to this
  // mesh), so no sign flip needed here unlike the fill above.
  const outlinePoints = zone.points.map((p) => new THREE.Vector3(p.x, 0.2, p.z));
  const outlineGeo = new THREE.BufferGeometry().setFromPoints(outlinePoints);
  const outline = new THREE.LineLoop(outlineGeo, new THREE.LineBasicMaterial({ color }));
  group.add(outline);

  return group;
}


/**
 * @param {object} b a world.buildings record
 * @param {object} world
 * @param {{partsById?: object, typesById?: object}} [buildingCatalog] the
 *   Building Builder's catalogs, keyed by id — only needed when `b.type ===
 *   'custom'`. Same `type: 'custom', <x>Id: '<id>'` convention props already
 *   use for Object Builder content (`parsePaletteType` in
 *   src/editor/main.js), just with `buildingTypeId` instead of `objectId`.
 */
export function buildBuildingPlaceholder(b, world, buildingCatalog = {}) {
  let mesh;
  if (b.type === 'custom') {
    const buildingDef = buildingCatalog.typesById?.[b.buildingTypeId];
    if (buildingDef) {
      // merge: one mesh per material instead of one per shape. Nothing that
      // places a building in the world needs its individual pieces as
      // separate nodes (the Building Builder's Assemble mode does, and it
      // calls buildBuildingFromParts directly without this flag) — and
      // unmerged, silverspire's 53 buildings alone were 15,709 draw calls.
      mesh = buildBuildingFromParts(buildingDef, buildingCatalog.partsById || {}, { merge: true });
    } else {
      console.warn(`Building "${b.id}" references missing building type "${b.buildingTypeId}" — rendering a placeholder cottage instead`);
      mesh = generateBuildingShell(b.seed ?? hashId(b.id), { width: b.footprint.width, depth: b.footprint.depth });
    }
  } else {
    mesh = generateBuildingShell(b.seed ?? hashId(b.id), {
      width: b.footprint.width,
      depth: b.footprint.depth,
      type: b.type,
    });
  }
  const terrainY = world ? sampleTerrainHeight(world, b.position.x, b.position.z) : 0;
  mesh.position.set(b.position.x, terrainY, b.position.z);
  mesh.rotation.y = ((b.rotationDeg || 0) * Math.PI) / 180;
  return mesh;
}

/**
 * A wall segment's mesh, or — if `wallSeg.invisible` — a faint wireframe
 * outline standing in for it. Collision (buildWorldColliders in
 * src/sim/collision.js) already emits this wall's OBB unconditionally,
 * regardless of visibility, so an invisible wall genuinely blocks movement;
 * this only controls what gets DRAWN. The outline exists purely for
 * authoring — the live game skips adding it to the scene at all (see
 * buildWorldMeshes below), so players never see even a faint box.
 */
export function buildWallSegmentInstance(wallSeg, world) {
  let mesh;
  if (wallSeg.invisible) {
    const length = wallSeg.length ?? 6;
    const height = wallSeg.height ?? 5;
    const thickness = wallSeg.thickness ?? 1;
    const group = new THREE.Group();
    const outline = new THREE.Mesh(
      new THREE.BoxGeometry(length, height, thickness),
      new THREE.MeshBasicMaterial({ color: 0xffdd33, wireframe: true, transparent: true, opacity: 0.5 })
    );
    outline.position.y = height / 2;
    group.add(outline);
    group.userData.invisibleWall = true;
    mesh = group;
  } else {
    mesh = generateWallSegment(wallSeg.seed ?? hashId(wallSeg.id), {
      length: wallSeg.length,
      height: wallSeg.height,
      // `thickness` used to be dropped here, so every wall in the world was
      // DRAWN 1 m thick (generateWallSegment's default) while its collider was
      // built from the authored value — 2.6 m on the Asteria ring. That is a
      // 0.8 m invisible shelf either side of every wall in the city.
      thickness: wallSeg.thickness,
    });
  }
  const terrainY = world ? sampleTerrainHeight(world, wallSeg.position.x, wallSeg.position.z) : 0;
  mesh.position.set(wallSeg.position.x, terrainY, wallSeg.position.z);
  mesh.rotation.y = ((wallSeg.rotationDeg || 0) * Math.PI) / 180;
  return mesh;
}

function hashId(str) {
  if (typeof str !== 'string') return 1;
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h >>> 0 || 1;
}

/**
 * Per-instance recolor (World Editor Place tab): retargets every material's
 * hue+saturation to `colorHex` while keeping its own original lightness, so
 * a tree's dark trunk and bright foliage both become the chosen color at
 * their own brightness (a flat color.set() would make every part of the
 * object identical, losing the shape's natural detail). Hue/saturation
 * replacement — not a multiply — because multiplying can only ever darken a
 * material toward the tint: a red flower has almost no blue channel to
 * begin with, so multiplying it by purple still comes out red. Each
 * material's original color is cached in userData the first time it's
 * tinted, so re-tinting (or clearing via 0xffffff) is always computed from
 * the true base color instead of compounding.
 */
export function applyColorTint(mesh, colorHex) {
  const isReset = colorHex === undefined || colorHex === null || colorHex === 0xffffff;
  const tintHSL = isReset ? null : new THREE.Color(colorHex).getHSL({ h: 0, s: 0, l: 0 });
  mesh.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    // Opt-out for a sub-mesh that must stay untouched regardless of the
    // rest of the object's tint — e.g. ez-tree's bark mesh (see ezTree.js),
    // so "recolor this tree" only ever recolors the leaves, never the trunk.
    if (obj.userData.excludeFromColorTint) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of materials) {
      if (!mat.color) continue;
      if (!mat.userData.baseColor) mat.userData.baseColor = mat.color.clone();
      if (isReset) {
        mat.color.copy(mat.userData.baseColor);
      } else {
        const baseHSL = mat.userData.baseColor.getHSL({ h: 0, s: 0, l: 0 });
        mat.color.setHSL(tintHSL.h, tintHSL.s, baseHSL.l);
      }
    }
  });
}

/**
 * The three dense presets buildWorldMeshes batches into instanced cover
 * meshes instead of building one-by-one. Only the World Editor ever reaches
 * buildPropPlaceholder with one of these (buildWorldMeshes filters them out
 * first), and it needs a separate object per prop to keep them selectable —
 * so it gets one prop's worth of the very same instanced geometry rather
 * than a lookalike from props.js. Before this, the editor's grass came from
 * generateGrassPatch and looked nothing like the game's.
 */
const COVER_PROP_BUILDERS = {
  grass: buildGrassPropMesh,
  'grass-meadow': buildGrassPropMesh,
  'flower-meadow': buildFlowerMeadowPropMesh,
};

/** The prop types buildPropPlaceholder resolves through COVER_PROP_BUILDERS — exported for the editor's palette thumbnails. */
export const COVER_PROP_TYPES = new Set(Object.keys(COVER_PROP_BUILDERS));

export function buildPropPlaceholder(prop, world, objectDefsById = {}) {
  // Positioned, scaled and seeded entirely inside the cover builder (a
  // meadow's scatter radius and per-blade height both already fold in
  // prop.scale), so it returns fully placed and skips everything below —
  // including the color tint and rotation, which the live game's batched
  // path has no equivalent for. See buildGrassPropMesh's comment.
  const coverBuilder = COVER_PROP_BUILDERS[prop.type];
  if (coverBuilder) return coverBuilder(prop, world);

  // One registry resolves every scenery type (src/generators/props.js), so
  // adding a tree variant is a row in propTypes.js + a builder — no switch here
  // to forget. Seeded per-prop, so the World Editor can place a specific seed
  // and get a stable shape.
  const mesh = buildProp(prop.type, prop.seed ?? 1, {
    objectDef: objectDefsById[prop.objectId],
    modelId: prop.modelId,
    // Per-tree override (World Editor Place tab) wins over the world-wide
    // Scatter-mode default, which wins over generateEzTree's own hardcoded
    // fallback — same "instance overrides world default" precedence
    // prop.color/prop.scale already use elsewhere in this function.
    leafDensity: prop.leafDensity ?? world?.treeSettings?.leafDensity,
  });
  const terrainY = world ? sampleTerrainHeight(world, prop.position.x, prop.position.z) : 0;
  mesh.position.set(prop.position.x, prop.position.y + terrainY, prop.position.z);
  // `rotation` (World Editor's X/Y/Z tilt controls) wins over the legacy
  // Y-only `rotationDeg` a prop may still carry from before it existed —
  // same "new object wins, old scalar is the fallback" idiom already used
  // for building shapes (main.js's rotationForShape).
  if (prop.rotation) {
    mesh.rotation.set(
      ((prop.rotation.x || 0) * Math.PI) / 180,
      ((prop.rotation.y || 0) * Math.PI) / 180,
      ((prop.rotation.z || 0) * Math.PI) / 180
    );
  } else if (prop.rotationDeg) {
    mesh.rotation.y = (prop.rotationDeg * Math.PI) / 180;
  }
  if (prop.scale) mesh.scale.setScalar(prop.scale);
  if (prop.color !== undefined && prop.color !== null) applyColorTint(mesh, prop.color);
  return mesh;
}

/**
 * Build a player-representing mesh using the real Phase 2 chibi character
 * generator. `characterParams` is whatever the character-creation UI
 * (Phase 4) produces; pass a seed for a stable look across sessions.
 */
// The class bodies from /api/character-types. Set once on load (see main.js).
// Empty until then, in which case buildPlayerCharacter falls back to the
// built-in presets rather than rendering nothing.
let characterTypes = [];
export function setCharacterTypes(types) { characterTypes = types || []; }

/**
 * A player OR an NPC: a body from the Character & NPC Builder catalog (a
 * `kind: 'character'` class or a `kind: 'npc'` prefab — classBody resolves
 * either by id), wearing the appearance chosen in character creation (or an
 * NPC's authored appearance.classId, set in the World Editor's NPCs mode).
 */
export function buildPlayerMesh(characterParams = {}) {
  const mesh = buildPlayerCharacter(characterTypes, characterParams.classId, characterParams);
  toonify(mesh);
  return mesh;
}

/**
 * Thin toonified wrapper around generateMonster, used by the live game
 * (both tower floors and overworld monsters — see src/main.js). Kept
 * separate from generateMonster itself since the World Editor's Monsters
 * mode calls generateMonster directly for its placement markers and
 * deliberately doesn't want the toon conversion (same reasoning as the
 * rest of this file's editor-vs-game split).
 */
export function buildMonsterMesh(type, seed, monsterTypesById = {}) {
  const mesh = generateMonster(type, seed, monsterTypesById);
  toonify(mesh);
  return mesh;
}

const ABILITY_FLASH_COLORS = { melee: 0xffffff, ranged: 0x66d9ff, heal: 0x66ff88, buff: 0xf0c030 };

/** A rough color guess from a travel preset's id, so the guaranteed-visible
 * traveling marker (see updateAbilityAnimations) at least reads as the right
 * element instead of always being the same generic color. */
function guessTravelColor(vfxId = '') {
  if (/fire|meteor/.test(vfxId)) return 0xff5522;
  if (/frost|ice/.test(vfxId)) return 0x7fd4ff;
  if (/holy|smite/.test(vfxId)) return 0xffe27a;
  if (/poison|dark/.test(vfxId)) return 0x8fef4a;
  if (/arrow|shot/.test(vfxId)) return 0xffffff;
  return 0xbfe0ff;
}

/** A small always-visible glowing sprite marking the travel effect's current
 * position — the particle stream alone (a handful of small, additively-
 * blended dots) reads as "barely there" against a busy scene, especially over
 * the short effect window most skills use; this guarantees the projectile
 * itself is unmistakable regardless of how sparse the trail looks. */
function buildTravelMarker(color) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: getSoftDotTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  sprite.scale.setScalar(0.6);
  return sprite;
}

/**
 * Start (or restart) an ability animation on a player mesh. The character
 * model itself is never scaled or rotated (that previously read as a size
 * glitch/shrink, including a forward-lean version that compressed the
 * character in the follow camera's perspective). The colored burst above the
 * caster's head is kept as a cheap always-on telegraph layer (and the only
 * VFX a monster ability or any skill missing `vfx` fields gets); a skill
 * carrying real `vfx` fields (every migrated player skill, see
 * skills/skill-defs.json) additionally gets real three.quarks particles at
 * cast/travel/impact — see updateAbilityAnimations below.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D} mesh
 * @param {import('../sim/classes.js').AbilityDef} ability
 * @param {ReturnType<typeof import('./vfx/index.js').createVfxSystem>|null} [vfxSystem]
 * @param {{x:number,y:number,z:number}|null} [targetPosition] world position of
 *   whatever this cast is aimed at — null for self-only skills (heal/buff/shield),
 *   in which case travel/impact anchor to the caster instead.
 */
export function triggerAbilityAnimation(scene, mesh, ability, vfxSystem = null, targetPosition = null) {
  const prevAnim = mesh.userData.abilityAnim;
  if (prevAnim?.burst) scene.remove(prevAnim.burst);
  if (prevAnim?.travelAnchor) scene.remove(prevAnim.travelAnchor);
  if (prevAnim?.vfxHandles) for (const h of Object.values(prevAnim.vfxHandles)) h?.dispose();
  if (prevAnim?.timelineHandles) for (const h of Object.values(prevAnim.timelineHandles)) h?.dispose();

  // The flat colored burst is the FALLBACK placeholder only — a skill with
  // real vfx.* fields or an authored timeline (every migrated player skill,
  // or anything built in the Skill Builder's Timeline tab) gets real
  // three.quarks particles/pose animation instead, not both at once.
  const hasRealVfx = !!(ability.timeline?.length || (ability.vfx && (ability.vfx.castVfxId || ability.vfx.travelVfxId || ability.vfx.impactVfxId)));
  let burst = null;
  if (!hasRealVfx) {
    burst = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 10, 10),
      new THREE.MeshBasicMaterial({
        color: ABILITY_FLASH_COLORS[ability.kind] || 0xffffff,
        transparent: true,
        opacity: 0,
      })
    );
    burst.visible = false;
    scene.add(burst);
  }

  // A timeline's own 'cast'-type event (if any) fires at ITS authored atMs
  // via runTimeline below — this immediate spawn is only the legacy
  // implicit-envelope path, so it must not also run for a timeline skill.
  const vfxHandles = {};
  if (!ability.timeline?.length && vfxSystem && ability.vfx?.castVfxId) {
    const anchor = resolveAnchor(ability.vfx.castAnchor || 'hand', { casterMesh: mesh, casterPosition: mesh.position, targetPosition });
    vfxHandles.cast = vfxSystem.spawn(ability.vfx.castVfxId, anchor);
  }

  mesh.userData.abilityAnim = {
    start: performance.now(), ability, burst, vfxSystem, vfxHandles, targetPosition,
    travelAnchor: null, travelFrom: null, travelTo: null, travelSpawned: false, impactSpawned: false,
    // Timeline-only state (see runTimeline below) — a Skill Builder-authored
    // explicit event sequence, when present, entirely replaces the implicit
    // windup/effect/recovery-driven vfx.* playback above. timelineHandles
    // tracks every cast/impact vfx a timeline event has spawned so it can be
    // stopped (durationMs elapsed, or the whole envelope ended) — without
    // this, a looping preset used as a cast/impact effect never gets told to
    // stop and runs forever (see updateAbilityAnimations' envelope-end
    // cleanup and the durationMs check in runTimeline).
    firedEvents: new Set(), activeTravel: null, timelineHandles: {},
  };
}

/**
 * Pose every rig part named by a `pose`-type timeline event at time `t` —
 * interpolated linearly between that part's surrounding keyframes (holding
 * rest pose before its first authored keyframe, so an arm-raise reads as a
 * motion starting from idle rather than a pose that's already mid-raise the
 * instant the ability triggers). Shared by `runTimeline` (live playback) and
 * the Skill Builder's timeline scrubber (paused preview at an arbitrary
 * scrub time) — one implementation, so authoring-time preview can never
 * drift from what the live game actually plays.
 * @param {Record<string, THREE.Object3D>} rig mesh.userData.rig
 * @param {import('../sim/skillDefs.js').TimelineEvent[]} timeline
 * @param {number} t ms since the timeline started
 */
export function applyPoseTimeline(rig, timeline, t) {
  if (!rig) return;
  const parts = new Set(timeline.filter((e) => e.type === 'pose').map((e) => e.part));
  const R2D = 180 / Math.PI;
  for (const part of parts) {
    const pivot = rig[part];
    if (!pivot) continue;
    const keys = timeline
      .filter((e) => e.type === 'pose' && e.part === part)
      .sort((a, b) => a.atMs - b.atMs);
    // Absent a keyframe at ms 0, an arm should start the pose from whatever
    // it's actually resting at right now — the weapon's hold pose stamped by
    // attachWeapons (creatureRig.js), not a hardcoded zero rotation — so the
    // authored motion animates seamlessly OUT of the default in-game stance
    // instead of the limb snapping there the instant the timeline starts.
    const base = pivot.userData.basePose;
    let prev = {
      atMs: 0,
      rotationDeg: base
        ? { x: base.x * R2D, y: base.y * R2D, z: base.z * R2D }
        : { x: 0, y: 0, z: 0 },
    };
    let next = keys[0] || prev;
    for (const k of keys) {
      if (k.atMs <= t) prev = k;
      if (k.atMs >= t) { next = k; break; }
    }
    const span = next.atMs - prev.atMs;
    const p = span > 0 ? Math.min(1, Math.max(0, (t - prev.atMs) / span)) : 1;
    const D2R = Math.PI / 180;
    pivot.rotation.set(
      (prev.rotationDeg.x + (next.rotationDeg.x - prev.rotationDeg.x) * p) * D2R,
      (prev.rotationDeg.y + (next.rotationDeg.y - prev.rotationDeg.y) * p) * D2R,
      (prev.rotationDeg.z + (next.rotationDeg.z - prev.rotationDeg.z) * p) * D2R
    );
  }
}

/**
 * Run an explicit, arbitrary-length `animation.timeline` (see skillDefs.js's
 * TimelineEvent) instead of the implicit windup/effect/recovery-driven
 * vfx.* / burst playback — authored via the Skill Builder's Timeline tab so a
 * skill can genuinely do "raise the arm, THEN the fireball appears, THEN it
 * flies to the target" instead of everything being anchored to three fixed
 * animation phases.
 */
function runTimeline(scene, mesh, anim, t) {
  const timeline = anim.ability.timeline;
  applyPoseTimeline(mesh.userData.rig, timeline, t);

  if (!anim.vfxSystem) return;
  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i];
    if (event.type === 'pose') continue;

    if (event.type === 'travel') {
      if (t >= event.atMs && t < event.endAtMs && !anim.activeTravel) {
        const to = anim.targetPosition || mesh.position;
        const travelAnchor = new THREE.Group();
        const from = { x: mesh.position.x, y: mesh.position.y + 1, z: mesh.position.z };
        const toPos = { x: to.x, y: to.y + 1, z: to.z };
        travelAnchor.position.set(from.x, from.y, from.z);
        // Same orientation fix as the legacy vfx.travelVfxId path above — a
        // ConeEmitter-based directional preset flies along the anchor's local
        // +Z, so it must be rotated to actually face the target (direct
        // lookAt — verified empirically that a plain Group's +Z, not -Z,
        // ends up facing the lookAt argument).
        if (toPos.x !== from.x || toPos.y !== from.y || toPos.z !== from.z) travelAnchor.lookAt(toPos.x, toPos.y, toPos.z);
        scene.add(travelAnchor);
        const marker = buildTravelMarker(guessTravelColor(event.vfxId));
        travelAnchor.add(marker);
        anim.activeTravel = {
          event, anchor: travelAnchor, marker,
          from, to: toPos,
          handle: anim.vfxSystem.spawn(event.vfxId, travelAnchor),
        };
      }
      if (anim.activeTravel?.event === event && t >= event.atMs && t < event.endAtMs) {
        const p = (t - event.atMs) / (event.endAtMs - event.atMs);
        const at = anim.activeTravel;
        at.anchor.position.set(
          at.from.x + (at.to.x - at.from.x) * p,
          at.from.y + (at.to.y - at.from.y) * p,
          at.from.z + (at.to.z - at.from.z) * p
        );
      }
      if (anim.activeTravel?.event === event && t >= event.endAtMs && !anim.firedEvents.has(i)) {
        anim.firedEvents.add(i);
        anim.activeTravel.handle?.stopEmission?.();
        scene.remove(anim.activeTravel.anchor);
        anim.activeTravel = null;
      }
      continue;
    }

    // cast/impact: fire once, at their own anchor, the instant t crosses atMs.
    if (t >= event.atMs && !anim.firedEvents.has(i)) {
      anim.firedEvents.add(i);
      const defaultAnchor = event.type === 'cast' ? 'hand' : 'target';
      const anchor = resolveAnchor(event.anchor || defaultAnchor, { casterMesh: mesh, casterPosition: mesh.position, targetPosition: anim.targetPosition }, event.anchorOffset);
      anim.timelineHandles[i] = anim.vfxSystem.spawn(event.vfxId, anchor);
    }
    // An authored durationMs stops this event's effect early (before the
    // whole envelope ends) — mainly for a LOOPING cast/impact preset (an
    // aura/stream that otherwise never self-terminates); a one-shot burst
    // already has its own fixed lifetime so stopping it early would just cut
    // its fade short, hence the `.looping` gate.
    const handle = anim.timelineHandles[i];
    if (handle?.looping && event.durationMs != null && t >= event.atMs + event.durationMs && !anim.firedEvents.has(`stop${i}`)) {
      anim.firedEvents.add(`stop${i}`);
      handle.stopEmission?.();
    }
  }
}

/** Advance all active ability animations. Call once per frame. */
export function updateAbilityAnimations(scene, meshes) {
  const now = performance.now();
  for (const mesh of meshes) {
    const anim = mesh.userData.abilityAnim;
    if (!anim) continue;
    const { windupMs, effectMs, recoveryMs } = anim.ability;
    const t = now - anim.start;
    const timeline = anim.ability.timeline;
    const total = timeline?.length
      ? Math.max(windupMs + effectMs + recoveryMs, ...timeline.map((e) => e.endAtMs ?? e.atMs))
      : windupMs + effectMs + recoveryMs;
    const burst = anim.burst;
    if (burst) burst.position.set(mesh.position.x, mesh.position.y + 2.3, mesh.position.z);

    if (timeline?.length) {
      runTimeline(scene, mesh, anim, t);
      if (t >= total) {
        // Envelope's over — any cast/impact event still looping (no
        // durationMs authored, or it hasn't elapsed) must be told to stop
        // here, or it keeps emitting forever with nothing left tracking it.
        for (const h of Object.values(anim.timelineHandles)) if (h?.looping) h.stopEmission?.();
        delete mesh.userData.abilityAnim;
      }
      continue;
    }

    // A hand-authored attack clip plays alongside the burst VFX, not instead
    // of it — 0 at the start of windup, 1 at the end of recovery, same
    // envelope applyAttackPose uses. Overlaid on top of whatever
    // updateWalkCycle already posed this frame (called earlier in the frame
    // loop — see main.js), so only the parts the clip's tracks name move;
    // everything else keeps its walk/idle pose.
    const attackClip = mesh.userData.attackClip;
    if (attackClip && mesh.userData.rig) {
      const t01 = Math.min(1, Math.max(0, t / total));
      applyKeyframeClip(mesh.userData.rig, attackClip, t01 * attackClip.durationMs);
    }

    // Real VFX: travel particles fly from caster to target across the
    // effect window, then the impact preset fires once at the end of it —
    // reusing the same windup/effect/recovery envelope the flash burst
    // above already tracks, rather than a second timing system.
    const vfx = anim.ability.vfx;
    if (vfx && anim.vfxSystem) {
      const effectStart = windupMs;
      const effectEnd = windupMs + effectMs;
      if (vfx.travelVfxId && !anim.travelSpawned && t >= effectStart && t < effectEnd) {
        anim.travelSpawned = true;
        const to = anim.targetPosition || mesh.position;
        anim.travelAnchor = new THREE.Group();
        anim.travelAnchor.position.set(mesh.position.x, mesh.position.y + 1, mesh.position.z);
        scene.add(anim.travelAnchor);
        anim.travelFrom = { x: mesh.position.x, y: mesh.position.y + 1, z: mesh.position.z };
        anim.travelTo = { x: to.x, y: to.y + 1, z: to.z };
        // Orient the anchor so its local +Z faces the target. ConeEmitter-based
        // travel VFX (streamPreset's beams/trails, shardPreset's arrows/icicles)
        // all fly along local +Z — without this every directional preset flew
        // toward world +Z regardless of where the target actually was, which
        // read as "arrows going in a random direction" once the shape actually
        // looked like an arrow instead of a soft glow. Verified empirically
        // (not the usual camera "-Z forward" convention): Object3D.lookAt(p)
        // on a plain Group points local +Z at p, so this is a direct lookAt,
        // no mirroring.
        if (anim.travelTo.x !== anim.travelFrom.x || anim.travelTo.y !== anim.travelFrom.y || anim.travelTo.z !== anim.travelFrom.z) {
          anim.travelAnchor.lookAt(anim.travelTo.x, anim.travelTo.y, anim.travelTo.z);
        }
        anim.vfxHandles.travel = anim.vfxSystem.spawn(vfx.travelVfxId, anim.travelAnchor);
        anim.travelMarker = buildTravelMarker(guessTravelColor(vfx.travelVfxId));
        anim.travelAnchor.add(anim.travelMarker);
      }
      if (anim.travelAnchor && t >= effectStart && t < effectEnd) {
        const p = (t - effectStart) / effectMs;
        anim.travelAnchor.position.set(
          anim.travelFrom.x + (anim.travelTo.x - anim.travelFrom.x) * p,
          anim.travelFrom.y + (anim.travelTo.y - anim.travelFrom.y) * p,
          anim.travelFrom.z + (anim.travelTo.z - anim.travelFrom.z) * p
        );
      }
      if (!anim.impactSpawned && t >= effectEnd) {
        anim.impactSpawned = true;
        // Travel stops here (the projectile has arrived). stopEmission (not
        // dispose/stop) halts further emission WITHOUT wiping the particles
        // already in flight — three.quarks' own stop()/dispose() both reset
        // particleNum to 0 internally, which is an instant, total vanish for
        // every particle regardless of its own remaining life. Cast is left
        // alone entirely here — see the comment where it's actually disposed,
        // in the cleanup branch below.
        anim.vfxHandles.travel?.stopEmission?.();
        if (anim.travelAnchor) { scene.remove(anim.travelAnchor); anim.travelAnchor = null; anim.travelMarker = null; }
        if (vfx.impactVfxId) {
          const anchor = resolveAnchor(vfx.impactAnchor || 'target', { casterMesh: mesh, casterPosition: mesh.position, targetPosition: anim.targetPosition });
          anim.vfxHandles.impact = anim.vfxSystem.spawn(vfx.impactVfxId, anchor);
        }
      }
    }

    if (t < windupMs) {
      // Charge-up: small, dim glow growing above the head.
      if (burst) {
        const p = t / windupMs;
        burst.visible = true;
        burst.scale.setScalar(0.15 + 0.25 * p);
        burst.material.opacity = 0.5 * p;
      }
    } else if (t < windupMs + effectMs) {
      // Effect: the glow flashes bright and expands.
      if (burst) {
        const p = (t - windupMs) / effectMs;
        burst.visible = true;
        burst.scale.setScalar(0.4 + 1.6 * p);
        burst.material.opacity = 0.9 - 0.6 * p;
      }
    } else if (t < total) {
      // Recovery: fades out.
      if (burst) {
        const p = (t - windupMs - effectMs) / recoveryMs;
        burst.visible = true;
        burst.scale.setScalar(2.0 - 1.6 * p);
        burst.material.opacity = 0.3 * (1 - p);
      }
    } else {
      if (burst) scene.remove(burst);
      if (anim.travelAnchor) scene.remove(anim.travelAnchor);
      // A one-shot cast burst (sparkle/impact-style presets) is left alone —
      // it self-disposes via its own life+autoDestroy once it's actually
      // done fading, whenever that is, rather than being force-killed on
      // this envelope's schedule. A LOOPING cast aura (buff/shield-style
      // presets) never self-terminates, so it must be disposed somewhere —
      // here, at the end of the full windup/effect/recovery envelope.
      if (anim.vfxHandles.cast?.looping) anim.vfxHandles.cast.dispose();
      delete mesh.userData.abilityAnim;
    }
  }
}

/**
 * Build a tower floor's geometry: a bounded room (ground + four walls) plus
 * monster markers and an exit marker. Separate from buildWorldMeshes since
 * a floor is a totally different instanced space, not part of the fixed
 * overworld JSON.
 */
export function buildFloorMeshes(scene, floorDef) {
  const width = floorDef.bounds.maxX - floorDef.bounds.minX;
  const depth = floorDef.bounds.maxZ - floorDef.bounds.minZ;

  const groundColor = floorDef.isBossFloor ? 0x3a2a2a : 0x3a3a42;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: groundColor })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const wallHeight = 6;
  const wallColor = floorDef.isBossFloor ? 0x5a2a2a : 0x4a4a55;
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor });
  const wallSpecs = [
    { w: width, h: wallHeight, d: 0.5, pos: [0, wallHeight / 2, floorDef.bounds.minZ] },
    { w: width, h: wallHeight, d: 0.5, pos: [0, wallHeight / 2, floorDef.bounds.maxZ] },
    { w: 0.5, h: wallHeight, d: depth, pos: [floorDef.bounds.minX, wallHeight / 2, 0] },
    { w: 0.5, h: wallHeight, d: depth, pos: [floorDef.bounds.maxX, wallHeight / 2, 0] },
  ];
  for (const spec of wallSpecs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), wallMat);
    wall.position.set(...spec.pos);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  // Exit marker: a glowing ring on the floor at the exit point.
  const exitMat = new THREE.MeshBasicMaterial({ color: 0xf0c030, side: THREE.DoubleSide });
  const exitRing = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), exitMat);
  exitRing.rotation.x = -Math.PI / 2;
  exitRing.position.set(floorDef.exitPoint.x, 0.05, floorDef.exitPoint.z);
  scene.add(exitRing);

  return { ground, exitRing };
}

/**
 * The layer overhead UI (name labels, quest indicators) lives on, so it can
 * be rendered in its own pass AFTER post-processing instead of going through
 * it. Bloom treats a bright white nameplate exactly like a light source and
 * smeared a halo around every name in the world; nothing about a 2D text
 * overlay wants tone-mapped glow. Anything put on this layer is invisible to
 * `composer.render()` and must be drawn by the overlay pass — see
 * renderUiOverlay below, which every renderer of this scene has to call.
 */
export const UI_OVERLAY_LAYER = 1;

/**
 * Second render pass for UI_OVERLAY_LAYER, on top of whatever the composer
 * just produced. Cheap: a handful of sprites, all depthTest:false already.
 */
export function renderUiOverlay(renderer, scene, camera) {
  const previousAutoClear = renderer.autoClear;
  const previousShadowAutoUpdate = renderer.shadowMap.autoUpdate;
  const previousBackground = scene.background;
  renderer.autoClear = false;
  // scene.background MUST be nulled for this pass. three's background module
  // force-clears the framebuffer whenever a scene has a background colour or
  // texture, autoClear:false or not — which would erase everything the
  // composer just drew and leave a sky-coloured screen with names floating
  // on it. applyAtmosphere sets a Color background (see atmosphere.js).
  scene.background = null;
  // The composer's own RenderPass already refreshed the shadow maps this
  // frame; a second full scene render would redo all of it for a handful of
  // sprites that don't cast or receive shadows at all.
  renderer.shadowMap.autoUpdate = false;
  camera.layers.set(UI_OVERLAY_LAYER);
  renderer.render(scene, camera);
  camera.layers.set(0);
  scene.background = previousBackground;
  renderer.autoClear = previousAutoClear;
  renderer.shadowMap.autoUpdate = previousShadowAutoUpdate;
}

/**
 * A floating name label — a canvas-textured Sprite (Sprites always face the
 * camera, so no manual billboarding needed). Added as a child of an NPC/
 * player mesh at head height. depthTest is off so the name stays readable
 * even when the character is partly behind other geometry, which is the
 * usual convention for MMO overhead nameplates.
 */
export function buildNameLabel(text, headHeight = 3.2) {
  const fontSize = 48;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  const pad = 16;
  canvas.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  canvas.height = fontSize + pad * 2;
  // Canvas resize resets the context, so re-apply text settings.
  ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#dce8ff';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  );
  const labelHeight = 0.7; // world units tall
  sprite.scale.set((canvas.width / canvas.height) * labelHeight, labelHeight, 1);
  sprite.position.y = headHeight;
  sprite.renderOrder = 998;
  sprite.layers.set(UI_OVERLAY_LAYER); // keeps the nameplate out of bloom
  return sprite;
}

// Quest indicator states, in the order they're checked — 'ready' (turn-in)
// takes priority display-wise but callers pick the state, this just maps it
// to a glyph/color. A THREE.Sprite (like buildNameLabel above), not a
// billboard Group like buildMonsterHealthBar below — sprites always face
// the camera natively regardless of a parent's rotation, so this is safe to
// add as a CHILD of the NPC mesh with no sibling/manual-quaternion dance.
const QUEST_INDICATOR_STYLES = {
  available: { glyph: '!', color: '#ffd23f' },   // yellow ! — a quest here can be accepted (level requirement met)
  active: { glyph: '?', color: '#9aa0a8' },       // grey ? — accepted, objective not yet met
  ready: { glyph: '?', color: '#ffd23f' },        // yellow ? — ready to turn in
};

/** A small billboarded glyph-in-a-circle above an NPC's name label, showing quest availability. Call updateQuestIndicatorSprite to change/hide it after creation — rebuilding the sprite from scratch on every status change would thrash materials/textures for something that changes a few times per play session at most. */
export function buildQuestIndicatorSprite(headHeight = 3.2) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true })
  );
  sprite.scale.set(0.6, 0.6, 1);
  sprite.position.y = headHeight + 0.6; // above the name label
  sprite.renderOrder = 999;
  sprite.layers.set(UI_OVERLAY_LAYER); // same reason as the name label — a bright yellow "!" bloomed hard
  sprite.visible = false;
  sprite.userData.canvas = canvas;
  sprite.userData.ctx = canvas.getContext('2d');
  sprite.userData.currentState = null;
  return sprite;
}

/** Repaints (or hides) a sprite built by buildQuestIndicatorSprite. `state` is null/'available'/'active'/'ready'; a no-op if unchanged from last call. */
export function updateQuestIndicatorSprite(sprite, state) {
  if (state === sprite.userData.currentState) return;
  sprite.userData.currentState = state;
  if (!state) {
    sprite.visible = false;
    return;
  }
  const style = QUEST_INDICATOR_STYLES[state];
  const ctx = sprite.userData.ctx;
  const size = sprite.userData.canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20,20,20,0.75)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = style.color;
  ctx.stroke();
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = style.color;
  ctx.fillText(style.glyph, size / 2, size / 2 + 2);
  sprite.material.map.needsUpdate = true;
  sprite.visible = true;
}

/**
 * A simple billboarded health bar. Must be added as a SIBLING of its monster
 * mesh (same parent group), never as a child — a monster mesh rotates to
 * face its travel direction, and a child's "world-facing" quaternion would
 * compose with that parent rotation instead of actually facing the camera
 * (this was a real bug: the bar visibly turned along with the monster).
 * `barHeight` is stashed on userData since there's no longer a static local
 * offset to bake into `position.y` — see updateMonsterHealthBar, which sets
 * world position explicitly every update.
 */
export function buildMonsterHealthBar(barHeight = 2.0) {
  const group = new THREE.Group();
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthTest: false })
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xd1394f, depthTest: false })
  );
  fill.position.z = 0.001;
  group.add(bg, fill);
  group.userData.fill = fill;
  group.userData.barHeight = barHeight;
  group.renderOrder = 999;
  return group;
}

/**
 * Update a health bar's fill width, follow its monster's current position,
 * and keep it facing the camera. `followMesh` is required now that the bar
 * is a sibling rather than a child — pass the monster mesh it belongs to.
 */
export function updateMonsterHealthBar(bar, healthFraction, camera, followMesh) {
  const f = Math.max(0.001, Math.min(1, healthFraction));
  bar.userData.fill.scale.x = f;
  bar.userData.fill.position.x = -(1 - f) / 2;
  if (followMesh) {
    bar.position.set(followMesh.position.x, followMesh.position.y + bar.userData.barHeight, followMesh.position.z);
  }
  bar.quaternion.copy(camera.quaternion);
}

const GATHER_NODE_COLORS = { wood: 0x8a5a3a, herb: 0x4a8a3a, ore: 0x8a7a6a, fish: 0x4a8ab0, flower: 0xd14f9a };

/** A small glowing gem-on-a-base marker for a gathering node, colored by resource type. */
export function buildGatheringNodeMarker(nodeType) {
  const color = GATHER_NODE_COLORS[nodeType] || 0xffffff;
  const group = new THREE.Group();

  const gem = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, roughness: 0.3 })
  );
  gem.position.y = 0.8;
  gem.castShadow = true;
  group.add(gem);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.7, 0.3, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a5a5a })
  );
  base.position.y = 0.15;
  group.add(base);

  group.userData.gem = gem;
  group.userData.baseColor = color;
  toonify(group);
  return group;
}

/** Dim a gathering node marker while it's on cooldown, restore its glow once available again. */
export function setGatheringNodeDepleted(marker, depleted) {
  const gem = marker.userData.gem;
  gem.material.color.set(depleted ? 0x3a3a3a : marker.userData.baseColor);
  gem.material.emissiveIntensity = depleted ? 0 : 0.4;
}

const WALK_FREQUENCY = 8; // radians/sec of the swing cycle
const WALK_BLEND_EASE = 8; // how fast the walk pose fades in/out, per second

/**
 * Drive a rigged mesh's walk-cycle from its rig (see generateCharacter's
 * group.userData.rig, or generateMonster's for a monster-type body). Which
 * parts swing and how far is data-driven via `mesh.userData.gaitTable`
 * (falls back to GAIT_TABLES.biped, matching every existing character/NPC
 * mesh's rig shape — this is a generalization of what used to be a
 * hardcoded 4-limb swing, not a behavior change for them). `isMoving` only
 * sets the *target* blend — the actual blend eases toward it so starting/
 * stopping doesn't snap between a static pose and a full swing.
 *
 * A hand-authored `mesh.userData.walkClip`/`idleClip` (see buildCreatureRig)
 * takes priority over the procedural gait/rest pose for that state — a hard
 * swap, not a cross-fade, since arbitrary position/scale keyframes don't
 * have an equivalent to the sine gait's blend concept. Creature types with
 * no clips are entirely unaffected — this is a superset of the old behavior.
 * @param {THREE.Object3D} mesh a rigged character/monster mesh
 * @param {boolean} isMoving
 * @param {number} t continuously increasing seconds (e.g. performance.now()/1000)
 * @param {number} dt seconds since the last call
 */
export function updateWalkCycle(mesh, isMoving, t, dt) {
  const rig = mesh.userData.rig;
  if (!rig) return; // not a rigged mesh (e.g. an unrigged prop/monster) — nothing to animate

  if (isMoving && mesh.userData.walkClip) {
    applyIdlePose(rig);
    applyKeyframeClip(rig, mesh.userData.walkClip, t * 1000);
    return;
  }
  if (!isMoving && mesh.userData.idleClip) {
    applyIdlePose(rig);
    applyKeyframeClip(rig, mesh.userData.idleClip, t * 1000);
    return;
  }

  const gaitTable = mesh.userData.gaitTable || GAIT_TABLES.biped;
  const target = isMoving ? 1 : 0;
  const prevBlend = mesh.userData.walkBlend || 0;
  const blend = prevBlend + (target - prevBlend) * Math.min(1, dt * WALK_BLEND_EASE);
  mesh.userData.walkBlend = blend;

  applyGaitPose(rig, gaitTable, t * WALK_FREQUENCY, blend);
}

/**
 * Build a store interior: a small enclosed room, furniture from the Phase 2
 * interior generator library, and a static shopkeeper NPC standing behind
 * the counter. See src/sim/interiors.js for the data this is built from.
 */
export function buildStoreInteriorMeshes(scene, interior) {
  const width = interior.bounds.maxX - interior.bounds.minX;
  const depth = interior.bounds.maxZ - interior.bounds.minZ;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5a })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const wallHeight = 5;
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9b896 });
  const wallSpecs = [
    { w: width, h: wallHeight, d: 0.4, pos: [0, wallHeight / 2, interior.bounds.minZ] },
    { w: width, h: wallHeight, d: 0.4, pos: [0, wallHeight / 2, interior.bounds.maxZ] },
    { w: 0.4, h: wallHeight, d: depth, pos: [interior.bounds.minX, wallHeight / 2, 0] },
    { w: 0.4, h: wallHeight, d: depth, pos: [interior.bounds.maxX, wallHeight / 2, 0] },
  ];
  for (const spec of wallSpecs) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.h, spec.d), wallMat);
    wall.position.set(...spec.pos);
    wall.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall);
  }

  for (const item of interior.furniture) {
    const mesh = generateFurniture(item.type, hashId(item.type + item.position.x + item.position.z));
    mesh.position.set(item.position.x, item.position.y, item.position.z);
    mesh.rotation.y = (item.rotationDeg * Math.PI) / 180;
    scene.add(mesh);
  }

  const npc = generateCharacter({
    seed: hashId(interior.npc.name),
    gender: 'masc',
    outfitColor: 0x5a4a3a,
  });
  npc.position.set(interior.npc.position.x, interior.npc.position.y, interior.npc.position.z);
  npc.rotation.y = (interior.npc.facingDeg * Math.PI) / 180;
  scene.add(npc);

  toonify(scene);
  return { ground, npc };
}

/**
 * Build the painted-lake water layer as a single mesh (one draw call for
 * the whole world), rather than one mesh per painted cell — that per-cell
 * approach is exactly the performance trap the editor-slowness fix (see
 * generators/environment/tree.js) had to walk back from elsewhere, so this
 * uses per-vertex color+alpha over one plane instead: painted cells are
 * opaque blue, unpainted cells are fully transparent, and the plane sits at
 * a fixed flat height (waterMask.level) — the user paints a basin lower
 * with the terrain brush first, then paints water on top of it to fill it.
 */
/**
 * A flat quad spanning `world.bounds`, UV-mapped 1:1 to world X/Z the same
 * way every other ground-like plane in this file is (see buildGroundMesh) —
 * shared by buildWaterMesh and buildSeabedMesh so the UV math (and its
 * "why not per-vertex color" reasoning) isn't duplicated between them.
 */
function buildWorldSpanPlane(bounds) {
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const geo = new THREE.PlaneGeometry(w, d, 1, 1);
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  for (let i = 0; i < posAttr.count; i++) {
    const worldX = posAttr.getX(i) + (bounds.minX + bounds.maxX) / 2;
    const worldZ = -posAttr.getY(i) + (bounds.minZ + bounds.maxZ) / 2;
    uvAttr.setXY(i, (worldX - bounds.minX) / w, (worldZ - bounds.minZ) / d);
  }
  uvAttr.needsUpdate = true;
  return geo;
}

export function buildWaterMesh(world) {
  if (!world.waterMask) return null;
  const { resolution, level, cells } = world.waterMask;
  const size = resolution + 1;

  // Bake the mask into a texture rather than per-vertex color/alpha on a
  // subdivided plane. Vertex-attribute interpolation is linear *per
  // triangle*, which creates a visible diagonal crease wherever the mask
  // changes within just one or two grid cells — exactly what a soft brush
  // edge produces, and exactly what showed up as diagonal streaking
  // in-game. A texture gets proper hardware bilinear filtering regardless
  // of how sharp the underlying gradient is, so this is a plain flat quad
  // (no subdivision needed) with the mask sampled through its UVs instead.
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const alpha = Math.round(Math.min(1, Math.max(0, cells[i])) * 255);
    data[i * 4 + 0] = 40;
    data[i * 4 + 1] = 115;
    data[i * 4 + 2] = 173;
    data[i * 4 + 3] = alpha;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.flipY = false; // set explicitly rather than relying on DataTexture's default — row 0 of `data` must map to v=0 to match the UVs computed below
  texture.needsUpdate = true;

  const geo = buildWorldSpanPlane(world.bounds);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 0.15,
    metalness: 0.1,
    depthWrite: false, // painted-water edges fading to alpha=0 shouldn't punch a depth hole in the ground beneath
  });
  applyWaterShading(mat, world.bounds);
  // Baked fresh from world.waterMask on every rebuild, referenced nowhere else
  // — see src/render/dispose.js for why this declaration is what frees it.
  mat.userData.ownedTextures = [texture];
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = level;
  // Both water and the ground-texture overlay (src/render/groundTextureMesh.js)
  // are transparent, depthWrite:false decals near the same height — without an
  // explicit renderOrder, Three's back-to-front transparent sort can flicker
  // between them depending on camera angle. renderOrder=2 here (overlay=1)
  // guarantees water always composites on top where they overlap.
  mesh.renderOrder = 2;
  return mesh;
}

/**
 * The "lake floor" parallax layer from stylized-components' SeabedFloor —
 * a second, lower, ALWAYS-OPAQUE Voronoi-cel-shaded plane, clipped to the
 * same painted footprint as the water above it via the same alpha mask
 * (reused for its SHAPE only here, not blended). Visible wherever the water
 * above it isn't fully opaque — this project's water alpha comes from the
 * paint mask's shoreline cutout rather than a depth-based transparency
 * gradient the way the reference's infinite-ocean version works, so the
 * parallax reads mainly at painted shallows/edges, not through a fully
 * "deep middle," which is an honest limitation of the mask-driven water
 * model, not a bug in this layer.
 */
export function buildSeabedMesh(world) {
  if (!world.waterMask) return null;
  const { resolution, level, cells } = world.waterMask;
  const size = resolution + 1;

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const alpha = Math.round(Math.min(1, Math.max(0, cells[i])) * 255);
    data[i * 4 + 0] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = alpha; // shape-only mask — color comes entirely from the Voronoi shader below
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.flipY = false;
  texture.needsUpdate = true;

  const geo = buildWorldSpanPlane(world.bounds);
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  });
  // See applyWaterShading's comment above for why this reconstructs real
  // world-space XZ instead of using vMapUv directly — same bug, same fix.
  const originX = world.bounds.minX;
  const originZ = world.bounds.minZ;
  const sizeX = world.bounds.maxX - world.bounds.minX;
  const sizeZ = world.bounds.maxZ - world.bounds.minZ;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlaneOrigin = { value: new THREE.Vector2(originX, originZ) };
    shader.uniforms.uPlaneSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlaneOrigin;
        uniform vec2 uPlaneSize;
        ${VORONOI_CEL_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 vUv = worldXZ * 0.6 + vec2(0.01, 0.015) * uTime;
          float f1 = voronoiF1(vUv, uTime, 0.10);
          float sf1 = voronoiSmoothF1(vUv, uTime, 0.10, 0.4);
          float cel = smoothstep(0.08 - 0.02, 0.08 + 0.02, f1 - sf1);
          // Muddy lakebed tones, dimmer than the water above so it reads as
          // "beneath" rather than competing with it once composited.
          vec3 deepColor = vec3(0.086, 0.098, 0.055);
          vec3 highlight = vec3(0.31, 0.30, 0.16);
          diffuseColor.rgb = mix(deepColor, highlight, cel);
          // diffuseColor.a is untouched — the mask's own shape cutout still applies.
        }`
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'seabed-shading';

  mat.userData.ownedTextures = [texture]; // baked per rebuild — see src/render/dispose.js
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = level - 0.4; // below the water surface, above the terrain it's painted over
  mesh.renderOrder = 1; // under water (2) and over the ground-texture overlay (1) — same tier as the overlay, water always composites above both
  return mesh;
}

// Shared Voronoi F1-minus-SmoothF1 cel-shading GLSL, ported from
// stylized-components (github.com/cortiz2894/stylized-components,
// src/components/WaterFloor) — ask was specifically "use that shader, it's
// way more colorful." Two nearest-cell distance fields (a hard F1 and a
// smooth-min'd SmoothF1) subtracted against each other give ~0 at cell
// centers and a spike right at cell boundaries; a smoothstep against that
// spike is a cheap, animatable cel-shaded mosaic — no textures. Used by
// both the water surface and the seabed below (same functions, different
// color ramps/scale), so it's factored out once rather than duplicated.
const VORONOI_CEL_GLSL = `
  vec2 voronoiHash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float voronoiSmin(float a, float b, float k) {
    float h = max(k - abs(a - b), 0.0) / k;
    return min(a, b) - h * h * h * k / 6.0;
  }
  vec2 voronoiCellPt(vec2 seed, float time, float cellSpeed) {
    return 0.5 + 0.5 * sin(time * cellSpeed + 6.2831 * seed);
  }
  float voronoiF1(vec2 p, float time, float cellSpeed) {
    vec2 i = floor(p), f = fract(p);
    float md = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 n = vec2(float(x), float(y));
        vec2 pt = voronoiCellPt(voronoiHash2(i + n), time, cellSpeed);
        md = min(md, length(n + pt - f));
      }
    return md;
  }
  float voronoiSmoothF1(vec2 p, float time, float cellSpeed, float smoothness) {
    vec2 i = floor(p), f = fract(p);
    float res = 8.0;
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec2 n = vec2(float(x), float(y));
        vec2 pt = voronoiCellPt(voronoiHash2(i + n), time, cellSpeed);
        res = voronoiSmin(res, length(n + pt - f), smoothness);
      }
    return res;
  }
  float voronoiNoiseHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float voronoiValueNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(voronoiNoiseHash(i), voronoiNoiseHash(i + vec2(1.0, 0.0)), f.x),
      mix(voronoiNoiseHash(i + vec2(0.0, 1.0)), voronoiNoiseHash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float voronoiFbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 2; i++) { v += a * voronoiValueNoise(p); p *= 2.0; a *= 0.5; }
    return v;
  }
`;

/**
 * Real water shading, fragment-shader-only — no extra geometry. The plane
 * itself stays the flat 1x1-segment quad it always was (this file's own
 * header comment explains why: a world-spanning plane subdivided for real
 * wave geometry is exactly the per-vertex cost this mesh was written to
 * avoid). Two effects, evaluated per-pixel against the water's own UV
 * (already mapped 1:1 to world X/Z by buildWaterMesh, so no extra varying is
 * needed — `vMapUv` from the standard shader chunks already IS world space
 * here):
 *  1. Voronoi F1-SmoothF1 cel-shaded color (see VORONOI_CEL_GLSL above) —
 *     a 3-stop animated cell mosaic (deep -> mid -> highlight), replacing
 *     the old flat deep/shallow gradient + sine-wave sparkle. This is the
 *     "anime water" look specifically asked for.
 *  2. The mask's own soft-brush-edge alpha still drives shallow-near-shore
 *     vs deep-toward-the-middle blending and the foam/highlight edge — the
 *     painted-lake shape/shoreline logic is unchanged, only what color it
 *     resolves to changed.
 * A subtler normal-perturbation ripple rides on top for glint variation at
 * grazing angles.
 *
 * Must run against a MeshStandardMaterial that toonify() (src/render/scene.js)
 * will never see — toonify swaps MeshStandardMaterial instances for a brand
 * new MeshToonMaterial and does not carry over onBeforeCompile/uniforms, so
 * this shader would be silently discarded if toonify ran on this mesh after
 * the fact. buildWorldMeshes below builds+adds water AFTER its toonify(scene)
 * call for exactly this reason, same as groundTextureOverlay already does.
 */
function applyWaterShading(mat, bounds) {
  // The plane's own UV (vMapUv) is NORMALIZED 0..1 across the whole quad,
  // which spans world.bounds — for a 1000-unit-wide world that's 1000
  // world units per UV unit. Feeding that straight into the Voronoi scale
  // (as an early version of this shader did) makes cell size scale with
  // HOW BIG world.bounds HAPPENS TO BE, not with real distance — a small
  // painted lake ends up showing a fraction of one giant ~37-unit cell
  // (a big blobby smear, not a mosaic), and the pattern doesn't visually
  // "scale with the amount of water drawn" the way a real texture would.
  // Reconstructing true world-space XZ from the UV first (position + size,
  // both fixed per-mesh so they're set once, not updated per frame) fixes
  // this: cell size is now a small FIXED number of world units everywhere,
  // regardless of lake or world size — the same guarantee sampleTerrainHeight
  // and every other world-space-sampled shader in this file already gives.
  const originX = bounds.minX;
  const originZ = bounds.minZ;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlaneOrigin = { value: new THREE.Vector2(originX, originZ) };
    shader.uniforms.uPlaneSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlaneOrigin;
        uniform vec2 uPlaneSize;
        ${VORONOI_CEL_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // The mask's alpha isn't just a hard 0/1 cutout — a soft brush
          // edge already leaves partially-painted cells with alpha
          // somewhere between the two, and bilinear filtering (see
          // buildWaterMesh above) smooths that into a real gradient. Reusing
          // it as a free "shallow near the shore, deep toward the middle"
          // cue rather than a flat single color.
          float rawAlpha = diffuseColor.a;
          // Wider + softer than a bare fwidth() spike: reads as a gentle
          // ring of foam a couple world-units wide rather than a single
          // hard-edged pixel line, which is what "the edges always look
          // off" turned out to mean once the cell-scale bug (see above)
          // stopped drowning it out.
          float edge = clamp(fwidth(rawAlpha) * 3.5, 0.0, 1.0);
          float shallow = 1.0 - smoothstep(0.35, 1.0, rawAlpha);

          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;

          // Noise-distorted Voronoi UV — the distortion keeps the cell
          // mosaic from looking like a rigid animated grid. uScale=0.35
          // means one cell is ~1/0.35 ≈ 2.9 world units across — small
          // enough that even a modest painted pond shows several cells.
          float uScale = 0.35;
          vec2 noiseUV = worldXZ * uScale * 1.52 + vec2(uTime * 0.20, 0.0);
          vec2 distort = vec2(voronoiFbm(noiseUV) - 0.5) * 0.30;
          vec2 vUv = worldXZ * uScale + vec2(0.0, 0.05) * uTime + distort;

          float f1 = voronoiF1(vUv, uTime, 0.30);
          float sf1 = voronoiSmoothF1(vUv, uTime, 0.30, 0.55);
          float cel = smoothstep(0.067 - 0.01, 0.067 + 0.01, f1 - sf1);

          vec3 deepColor = vec3(0.020, 0.118, 0.243);   // #05305c-ish, mirrors the reference's deep tone
          vec3 midColor = vec3(0.086, 0.302, 0.396);    // shallow-lake teal, dimmer than the reference's tropical mid so it still reads as a lake, not open ocean
          vec3 highlight = vec3(0.85, 0.97, 1.0);
          float midPos = 0.35;
          vec3 celColor = cel < midPos
            ? mix(deepColor, midColor, clamp(cel / midPos, 0.0, 1.0))
            : mix(midColor, highlight, clamp((cel - midPos) / (1.0 - midPos), 0.0, 1.0));

          vec3 tinted = mix(deepColor, celColor, shallow * 0.85 + 0.15);
          // Toned down from 0.85 -> 0.5: at full strength this washed the
          // whole shoreline out to near-white, which is likely most of
          // what read as "edges always look off."
          tinted = mix(tinted, highlight, edge * 0.5);

          diffuseColor.rgb = tinted;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // Subtle now that the Voronoi cel color above carries most of the
          // visible motion — this just adds a bit of extra specular glint
          // variation for viewing angles where it does catch the light.
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 p = worldXZ * 0.5;
          float t = uTime;
          float dhx = cos(p.x * 1.0 + t * 1.1) * 1.0 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          float dhy = cos(p.y * 1.3 - t * 0.9) * 1.3 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          normal = normalize(normal + vec3(dhx, dhy, 0.0));
        }`
      );
    mat.userData.shader = shader; // updateWaterTime below reads this each frame — see windSway.js for the same pattern
  };
  mat.customProgramCacheKey = () => 'water-shading';
}

/** Call once per frame (both the live game and the World Editor do — see main.js / editor/main.js) with a mesh built by buildWaterMesh, if one exists. No-ops before the material's shader has compiled once (userData.shader isn't set until the first render). @param {number} elapsed seconds */
export function updateWaterTime(mesh, elapsed) {
  const shader = mesh?.material?.userData?.shader;
  if (shader) shader.uniforms.uTime.value = elapsed;
}

// --- Per-body water (src/sim/waterBodies.js) ---
// The legacy buildWaterMesh/buildSeabedMesh above stay untouched (still read
// world.waterMask, still what un-migrated maps render) — everything below is
// additive: one water+seabed mesh PAIR per `kind:'lake'|'puddle'` entry in
// world.waterBodies, each with its own elevation, so two lakes at different
// heights just fall out of being two separate meshes. Rivers (kind:'river')
// are Phase 2, not built here yet.

/**
 * Bakes `world.terrain.heights` into a small DataTexture so a lake's shader
 * can sample REAL terrain height per-fragment and compute REAL depth
 * (surfaceLevel - terrainHeight) — replacing the old buildWaterMesh's
 * paint-mask-alpha proxy for "how deep does this look" with the actual
 * number the terrain was carved to. One 8-bit channel can't hold an
 * arbitrary float height directly, so values are normalized against this
 * particular terrain's own min/max and decoded back out in-shader via
 * uTerrainHeightMin/uTerrainHeightMax — same DataTexture-for-hardware-
 * bilinear-filtering trick buildWaterMesh's mask texture already uses, for
 * the same reason (per-vertex interpolation creases across a sharp terrain
 * gradient otherwise).
 * Always returns a valid texture (never null) so the lake shader can bind
 * `uTerrainHeightMap` unconditionally — a world with no `world.terrain` at
 * all gets a flat 1x1 texture encoding height 0, matching
 * `sampleTerrainHeight`'s own "no terrain -> 0" convention.
 * @returns {{texture: THREE.DataTexture, min: number, max: number}}
 */
export function buildTerrainHeightTexture(world) {
  if (!world.terrain) {
    const texture = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    texture.needsUpdate = true;
    return { texture, min: 0, max: 0 };
  }
  const { resolution, heights } = world.terrain;
  const size = resolution + 1;
  let min = Infinity, max = -Infinity;
  for (const h of heights) {
    if (h < min) min = h;
    if (h > max) max = h;
  }
  if (!Number.isFinite(min)) { min = 0; max = 0; }
  const range = Math.max(1e-3, max - min);

  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(((heights[i] - min) / range) * 255);
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  // Matches buildWaterMesh's mask-texture convention (row 0 -> v=0), and
  // setWorldSpaceUVs below produces UVs on that same convention.
  texture.flipY = false;
  texture.needsUpdate = true;
  return { texture, min, max };
}

/**
 * Overwrites a geometry's default UVs with world-space-normalized ones
 * (against `bounds`, not the geometry's own local bounding box) — needed
 * because THREE.ShapeGeometry's auto-generated UVs are relative to the
 * SHAPE's own bounding box, which would make a lake's Voronoi cel pattern
 * scale with how big that one lake happens to be (the exact bug
 * applyWaterShading's own header comment already worked through once for
 * the world-spanning water plane). Reusing world.bounds instead means every
 * lake's shader can reconstruct true world XZ from vMapUv the same way
 * applyWaterShading/buildSeabedMesh already do, and can sample the shared
 * terrain-height texture (which also spans world.bounds) directly at
 * vMapUv with no extra coordinate conversion.
 *
 * Assumes vertices are still in PRE-rotation local space (mesh.rotation.x
 * will be set to -PI/2 by the caller afterward) — worldX = localX,
 * worldZ = -localY, same convention buildGroundMesh/buildWorldSpanPlane use.
 */
function setWorldSpaceUVs(geo, bounds) {
  const posAttr = geo.attributes.position;
  const uvAttr = geo.attributes.uv;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  for (let i = 0; i < posAttr.count; i++) {
    const worldX = posAttr.getX(i);
    const worldZ = -posAttr.getY(i);
    uvAttr.setXY(i, (worldX - bounds.minX) / w, (worldZ - bounds.minZ) / d);
  }
  uvAttr.needsUpdate = true;
}

/**
 * The shoreline band a lake/puddle's "distance in from shore" depth cue
 * ramps across (see applyLakeWaterShading for why that cue exists at all),
 * plus the body's own XZ bounding box the shader measures that distance
 * against. Exact for the axis-aligned rectangle every lake is now; an
 * approximation for a leftover freeform polygon from the old draw tool or a
 * legacy mask migration (those read their bbox instead of their true
 * outline — they snap to a rectangle the first time their fields are
 * touched anyway).
 *
 * `depthScale` caps how deep the shore cue alone is allowed to make a body
 * read: a puddle should still look like a puddle in the middle, not a
 * pond, even though its own maxDepth normalizes the same way a lake's does.
 */
function lakeShoreParams(body) {
  const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of body.points) {
    if (p.x < b.minX) b.minX = p.x;
    if (p.x > b.maxX) b.maxX = p.x;
    if (p.z < b.minZ) b.minZ = p.z;
    if (p.z > b.maxZ) b.maxZ = p.z;
  }
  const halfX = (b.maxX - b.minX) / 2;
  const halfZ = (b.maxZ - b.minZ) / 2;
  const shortSide = Math.min(b.maxX - b.minX, b.maxZ - b.minZ);
  return {
    center: new THREE.Vector2((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2),
    half: new THREE.Vector2(halfX, halfZ),
    // World-unit radius the shader's rounded-box SDF uses, from the body's
    // authored 0..1 `cornerRounding` fraction (see WaterBodyDef). 0 — the
    // default, and what every legacy freeform/migrated body gets — makes
    // the SDF collapse to a plain box, i.e. exactly the bounding-box
    // distance this used before rounding existed.
    cornerRadius: Math.max(0, Math.min(1, body.cornerRounding || 0)) * Math.min(halfX, halfZ),
    // A quarter of the short side, capped so a huge lake doesn't get a
    // 20-unit foam ring — half the short side would put the ramp's top
    // exactly at the center line, so a quarter leaves a real deep interior.
    width: Math.max(0.35, Math.min(4, shortSide * 0.25)),
    depthScale: body.kind === 'puddle' ? 0.45 : 1,
  };
}

/** A closed polygon (`body.points`, world-space x/z) as flat geometry in the same pre-rotation local space every other ground-like plane in this file uses — see setWorldSpaceUVs' header comment for the coordinate convention. */
function buildLakeBodyGeometry(body, bounds) {
  const shape = new THREE.Shape(body.points.map((p) => new THREE.Vector2(p.x, -p.z)));
  const geo = new THREE.ShapeGeometry(shape);
  setWorldSpaceUVs(geo, bounds);
  return geo;
}

/**
 * Real water shading for one discrete lake/puddle body — same Voronoi
 * cel-shaded look as applyWaterShading (reuses VORONOI_CEL_GLSL verbatim),
 * but the shallow/deep/foam signal comes from REAL depth
 * (surfaceLevel - sampled terrain height) instead of paint-mask alpha,
 * since this mesh's own boundary already IS the lake's exact shape (no
 * alpha cutout needed for that part anymore).
 *
 * Depth is the MAX of two signals, not real terrain depth alone:
 *
 *  1. real depth (`surfaceLevel - sampled terrain height`), and
 *  2. distance in from the body's own shoreline (`shoreFrac`).
 *
 * (2) exists because nothing carves the terrain under a lake anymore
 * (removed — see src/sim/waterBodies.js's header comment for why), so on
 * ordinary flattish ground (1) is ~0 everywhere: measured against Dennis's
 * real Default World lake, average real depth was 0.18 against a maxDepth
 * of 1, and 15% of the rectangle sat ABOVE the surface. depthFrac ~0.05
 * puts every fragment in the shallow/foam branch, which renders a
 * washed-out grey-white cel pattern (~rgb 0.44,0.54,0.62 rising to near
 * white) instead of water — this is exactly the "water is grey now" bug.
 * A hand-placed body's depth is an AUTHORED number, so the look now comes
 * from author intent (deep in the middle, foam only in a band along the
 * actual shoreline) and only goes DEEPER where real ground genuinely dips.
 * Still zero terrain modification either way.
 */
function applyLakeWaterShading(mat, body, terrainHeightInfo, bounds) {
  const originX = bounds.minX;
  const originZ = bounds.minZ;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;
  const shore = lakeShoreParams(body);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlaneOrigin = { value: new THREE.Vector2(originX, originZ) };
    shader.uniforms.uPlaneSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.uniforms.uTerrainHeightMap = { value: terrainHeightInfo.texture };
    shader.uniforms.uTerrainHeightMin = { value: terrainHeightInfo.min };
    shader.uniforms.uTerrainHeightMax = { value: terrainHeightInfo.max };
    shader.uniforms.uSurfaceLevel = { value: body.surfaceLevel };
    shader.uniforms.uMaxDepth = { value: Math.max(0.01, body.maxDepth) };
    shader.uniforms.uBodyCenter = { value: shore.center };
    shader.uniforms.uBodyHalf = { value: shore.half };
    shader.uniforms.uCornerRadius = { value: shore.cornerRadius };
    shader.uniforms.uShoreWidth = { value: shore.width };
    shader.uniforms.uShoreDepthScale = { value: shore.depthScale };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlaneOrigin;
        uniform vec2 uPlaneSize;
        uniform sampler2D uTerrainHeightMap;
        uniform float uTerrainHeightMin;
        uniform float uTerrainHeightMax;
        uniform float uSurfaceLevel;
        uniform float uMaxDepth;
        uniform vec2 uBodyCenter;
        uniform vec2 uBodyHalf;
        uniform float uCornerRadius;
        uniform float uShoreWidth;
        uniform float uShoreDepthScale;
        ${VORONOI_CEL_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;

          float rawHeight = texture2D(uTerrainHeightMap, vMapUv).r;
          float terrainHeight = uTerrainHeightMin + rawHeight * (uTerrainHeightMax - uTerrainHeightMin);
          float realDepthFrac = clamp(max(0.0, uSurfaceLevel - terrainHeight) / uMaxDepth, 0.0, 1.0);

          // Distance in from the nearest shoreline edge, 0 at the bank and
          // 1 once fully inside — the authored-intent half of the depth
          // signal (see this function's header comment for why real terrain
          // depth alone can't carry it anymore). Standard rounded-box SDF
          // (negative inside), so a lake with rounded corners gets its foam
          // band following the actual curve; uCornerRadius 0 collapses this
          // to a plain box, which is what square lakes and every legacy
          // freeform/migrated body use.
          vec2 q = abs(worldXZ - uBodyCenter) - uBodyHalf + vec2(uCornerRadius);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCornerRadius;
          float shoreFrac = clamp(-sd / uShoreWidth, 0.0, 1.0) * uShoreDepthScale;

          float depthFrac = max(realDepthFrac, shoreFrac);

          // Both cues below read off that combined depth: near the bank
          // (or over ground that pokes up near the surface) it reads
          // shallow and picks up a foam highlight; the interior reads deep.
          float shallow = 1.0 - smoothstep(0.0, 0.55, depthFrac);
          float edge = 1.0 - smoothstep(0.0, 0.12, depthFrac);

          float uScale = 0.35;
          vec2 noiseUV = worldXZ * uScale * 1.52 + vec2(uTime * 0.20, 0.0);
          vec2 distort = vec2(voronoiFbm(noiseUV) - 0.5) * 0.30;
          vec2 vUv = worldXZ * uScale + vec2(0.0, 0.05) * uTime + distort;

          float f1 = voronoiF1(vUv, uTime, 0.30);
          float sf1 = voronoiSmoothF1(vUv, uTime, 0.30, 0.55);
          float cel = smoothstep(0.067 - 0.01, 0.067 + 0.01, f1 - sf1);

          vec3 deepColor = vec3(0.020, 0.118, 0.243);
          vec3 midColor = vec3(0.086, 0.302, 0.396);
          vec3 highlight = vec3(0.85, 0.97, 1.0);
          float midPos = 0.35;
          vec3 celColor = cel < midPos
            ? mix(deepColor, midColor, clamp(cel / midPos, 0.0, 1.0))
            : mix(midColor, highlight, clamp((cel - midPos) / (1.0 - midPos), 0.0, 1.0));

          vec3 tinted = mix(deepColor, celColor, shallow * 0.85 + 0.15);
          tinted = mix(tinted, highlight, edge * 0.5);

          diffuseColor.rgb = tinted;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 p = worldXZ * 0.5;
          float t = uTime;
          float dhx = cos(p.x * 1.0 + t * 1.1) * 1.0 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          float dhy = cos(p.y * 1.3 - t * 0.9) * 1.3 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          normal = normalize(normal + vec3(dhx, dhy, 0.0));
        }`
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'lake-water-shading';
}

/** Muddy lakebed shading for one body — same technique as buildSeabedMesh's inline shader (Voronoi cel, muddier tones, shape-only), just applied to a per-lake polygon mesh instead of the whole-world plane. */
function applyLakeSeabedShading(mat, bounds) {
  const originX = bounds.minX;
  const originZ = bounds.minZ;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlaneOrigin = { value: new THREE.Vector2(originX, originZ) };
    shader.uniforms.uPlaneSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlaneOrigin;
        uniform vec2 uPlaneSize;
        ${VORONOI_CEL_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 vUv = worldXZ * 0.6 + vec2(0.01, 0.015) * uTime;
          float f1 = voronoiF1(vUv, uTime, 0.10);
          float sf1 = voronoiSmoothF1(vUv, uTime, 0.10, 0.4);
          float cel = smoothstep(0.08 - 0.02, 0.08 + 0.02, f1 - sf1);
          vec3 deepColor = vec3(0.086, 0.098, 0.055);
          vec3 highlight = vec3(0.31, 0.30, 0.16);
          diffuseColor.rgb = mix(deepColor, highlight, cel);
        }`
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'lake-seabed-shading';
}

function buildLakeBodyWaterMesh(world, body, terrainHeightInfo) {
  const geo = buildLakeBodyGeometry(body, world.bounds);
  const mat = new THREE.MeshStandardMaterial({
    // `map` is never actually sampled through Three's own built-in path below
    // (the custom map_fragment block overwrites diffuseColor.rgb entirely,
    // same as the legacy buildWaterMesh/buildSeabedMesh) — it's set here
    // purely so Three defines USE_MAP and declares the `vMapUv` varying this
    // shader's own onBeforeCompile block depends on. Reusing the already-
    // built terrain height texture avoids allocating a throwaway one.
    map: terrainHeightInfo.texture,
    transparent: true,
    roughness: 0.15,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide, // so the underside is visible too (looking up from inside/underwater) instead of nothing
  });
  applyLakeWaterShading(mat, body, terrainHeightInfo, world.bounds);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = body.surfaceLevel;
  mesh.renderOrder = 2; // same tier as the legacy water plane — composites above ground-texture/seabed
  mesh.userData.isWater = true;
  mesh.userData.waterBodyId = body.id;
  return mesh;
}

/**
 * How far below the water surface the seabed layer sits — scaled to the
 * body's own maxDepth (capped at the original fixed 0.4 lakes/rivers always
 * used) rather than a flat constant. A puddle's maxDepth can be as small as
 * ~0.15; a fixed 0.4 offset would put its "lake floor" nearly 3x deeper
 * than the puddle itself, which reads as visibly wrong once puddles
 * (Phase 3) share this same seabed builder.
 */
function seabedOffsetFor(maxDepth) {
  return Math.min(0.4, maxDepth * 0.3);
}

function buildLakeBodySeabedMesh(world, body, terrainHeightInfo) {
  const geo = buildLakeBodyGeometry(body, world.bounds);
  // Same `map`-just-to-get-vMapUv reasoning as buildLakeBodyWaterMesh above —
  // the seabed's own shading doesn't read terrain height, it just needs any
  // texture assigned so USE_MAP/vMapUv exist.
  const mat = new THREE.MeshStandardMaterial({ map: terrainHeightInfo.texture, roughness: 1, metalness: 0, depthWrite: false });
  applyLakeSeabedShading(mat, world.bounds);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = body.surfaceLevel - seabedOffsetFor(body.maxDepth);
  mesh.renderOrder = 1;
  mesh.userData.waterBodyId = body.id;
  return mesh;
}

/**
 * A vertical "skirt" ring closing the gap around a lake/puddle's entire
 * shoreline, from the water surface down to the seabed layer — same
 * reasoning as buildRiverSkirtMesh: without it, the water surface and
 * seabed are two disconnected flat sheets, and a grazing-angle or
 * underwater view sees straight through the open perimeter between them.
 * Solid-color backing geometry, not the animated hero surface.
 */
function buildLakeBodySkirtMesh(body) {
  const points = body.points;
  const n = points.length;
  const topY = body.surfaceLevel;
  const botY = body.surfaceLevel - seabedOffsetFor(body.maxDepth);
  const positions = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    positions.push(
      a.x, topY, a.z, b.x, topY, b.z, b.x, botY, b.z,
      a.x, topY, a.z, b.x, botY, b.z, a.x, botY, a.z
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.05, 0.2, 0.35),
    transparent: true,
    opacity: 0.85,
    roughness: 0.3,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1.5; // between the seabed (1) and the water surface (2)
  mesh.userData.waterBodyId = body.id;
  return mesh;
}

/**
 * Builds one {water, seabed, skirt} mesh triple per `kind:'lake'|'puddle'`
 * entry in `world.waterBodies` — the per-body replacement for the single
 * world-spanning buildWaterMesh/buildSeabedMesh above. Bakes the terrain
 * height texture ONCE (not per body) since it's shared: every lake samples
 * the same underlying terrain. `skirt` closes the gap between `water` and
 * `seabed` around the whole shoreline (see buildLakeBodySkirtMesh).
 * @returns {Array<{body: Object, water: THREE.Mesh, seabed: THREE.Mesh, skirt: THREE.Mesh}>}
 */
export function buildLakeBodyMeshes(world) {
  const bodies = (world.waterBodies || []).filter((b) => b.kind === 'lake' || b.kind === 'puddle');
  if (!bodies.length) return [];
  const terrainHeightInfo = buildTerrainHeightTexture(world);
  const built = bodies.map((body) => ({
    body,
    water: buildLakeBodyWaterMesh(world, body, terrainHeightInfo),
    seabed: buildLakeBodySeabedMesh(world, body, terrainHeightInfo),
    skirt: buildLakeBodySkirtMesh(body),
  }));
  claimTerrainHeightTexture(built, terrainHeightInfo);
  return built;
}

// --- Rivers (kind:'river' bodies, src/sim/waterBodies.js) ---
// A sloped ribbon, built the same way buildPathMesh/buildMountainRidgeMesh
// walk a resampled polyline and emit left/right edge vertices — but each
// vertex's Y comes from the river's own interpolated `surfaceHeights` (see
// riverHeightAtFraction below), not whatever terrain height happens to be
// there. Real depth-shading reuses the exact lake technique (a baked
// terrain-height texture sampled per-fragment), just with the surface
// height read from a per-vertex varying instead of a flat per-body
// uniform, since a river's surface genuinely isn't flat.

const RIVER_MAX_SAMPLES = 300; // matches pathMesh.js/mountainMesh.js's own safety cap
const RIVER_Y_OFFSET = 0.06; // lifts the whole ribbon slightly, same reasoning as the ground-hugging ribbons in pathMesh.js/mountainMesh.js — above paths (0.03) since water should read as sitting IN the world, not under a road
// How far a river's surface may sit above the terrain at its own banks. See
// the clamp in computeRiverSpine for why this can't be zero.
const RIVER_BANK_HEADROOM = 0.3;

/** Resample a polyline through a Catmull-Rom spline at ~evenly-spaced intervals — identical technique to pathMesh.js/mountainMesh.js's own resample helpers. */
function resampleRiverPoints(points, spacing) {
  if (points.length < 2) return points.slice();
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'catmullrom',
    0.5
  );
  const length = curve.getLength();
  const numSamples = Math.max(2, Math.min(RIVER_MAX_SAMPLES, Math.ceil(length / Math.max(0.1, spacing))));
  return curve.getSpacedPoints(numSamples).map((v) => ({ x: v.x, z: v.z }));
}

/**
 * Computes the resampled "spine" of a river once — for each sample along
 * the smoothed centerline: its world (x,z), sloped surface Y (BEFORE any
 * Y_OFFSET/seabed offset), and left/right unit-normal direction. Shared by
 * the water, seabed, and skirt-wall geometry builders below so the
 * resample + height-interpolation work happens once per river, not once
 * per mesh.
 *
 * Height comes from the river's authored `points`/`surfaceHeights`,
 * linearly interpolated between whichever two authored points bracket
 * each resampled sample — but ALSO clamped down to never exceed the real
 * (uncarved) terrain height at that sample's bank edge (see the `Math.min`
 * below). Without that clamp, a river drawn with only a few sparse clicks
 * across a curving hillside floats visibly above the real ground wherever
 * the hill's true contour dips below the straight line connecting two
 * distant authored heights — exactly the "flat texture with a gap
 * underneath" symptom this was built to fix. The clamp samples real
 * terrain at the LEFT bank edge (not the centerline) — nothing carves the
 * terrain anymore (see src/sim/waterBodies.js's header comment for why),
 * so this is just a stable, consistent point to read "what does the real
 * ground look like here" from; the middle-of-channel depth illusion still
 * comes entirely from the depth-shader comparing this same surface Y
 * against the real terrain-height texture per-fragment, unaffected by
 * which single point this clamp happens to sample.
 * @returns {Array<{x:number,z:number,y:number,nx:number,nz:number}>|null}
 */
function computeRiverSpine(river, world) {
  if (!river.points || river.points.length < 2) return null;
  const sampled = resampleRiverPoints(river.points, Math.max(0.5, river.width * 0.4));
  if (sampled.length < 2) return null;

  // Cumulative arc length of the ORIGINAL authored points, paired with
  // their surfaceHeights — resampling (for a smooth width extrusion)
  // changes point count/spacing, but a resampled vertex's FRACTIONAL
  // progress along the physical path still corresponds faithfully, so
  // heights are looked up by fraction rather than by index.
  let origTotal = 0;
  const origLens = [0];
  for (let i = 1; i < river.points.length; i++) {
    origTotal += Math.hypot(river.points[i].x - river.points[i - 1].x, river.points[i].z - river.points[i - 1].z);
    origLens.push(origTotal);
  }
  function heightAtFraction(fraction) {
    if (origTotal === 0) return river.surfaceHeights[0];
    const targetLen = fraction * origTotal;
    for (let i = 1; i < origLens.length; i++) {
      if (targetLen <= origLens[i] || i === origLens.length - 1) {
        const segLen = origLens[i] - origLens[i - 1];
        const segT = segLen > 0 ? Math.min(1, Math.max(0, (targetLen - origLens[i - 1]) / segLen)) : 0;
        return river.surfaceHeights[i - 1] + (river.surfaceHeights[i] - river.surfaceHeights[i - 1]) * segT;
      }
    }
    return river.surfaceHeights[river.surfaceHeights.length - 1];
  }

  let sampledTotal = 0;
  const sampledLens = [0];
  for (let i = 1; i < sampled.length; i++) {
    sampledTotal += Math.hypot(sampled[i].x - sampled[i - 1].x, sampled[i].z - sampled[i - 1].z);
    sampledLens.push(sampledTotal);
  }

  const spine = [];
  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i];
    const prev = sampled[Math.max(0, i - 1)];
    const next = sampled[Math.min(sampled.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen;
    tz /= tlen;
    const nx = -tz;
    const nz = tx;
    const fraction = sampledTotal > 0 ? sampledLens[i] / sampledTotal : 0;
    const intendedY = heightAtFraction(fraction);
    const lx = p.x + nx * (river.width / 2), lz = p.z + nz * (river.width / 2);
    const bankY = sampleTerrainHeight(world, lx, lz);
    // Clamped to the bank PLUS headroom, not to the bank exactly. Rivers
    // don't carve the terrain (that was removed deliberately), so on level
    // ground intendedY and bankY are the same number and a hard clamp pinned
    // the surface to precisely ground level: the ribbon vanished under the
    // grass, and "Raise selected river" was a silent no-op because the nudge
    // got clamped straight back down. The headroom is enough to clear the
    // ground cover and read as water lying in a shallow channel, while the
    // clamp still stops a river floating up the side of a real hill.
    spine.push({ x: p.x, z: p.z, y: Math.min(intendedY, bankY + RIVER_BANK_HEADROOM), nx, nz });
  }
  return spine;
}

/**
 * Builds the river's ribbon geometry from a precomputed spine (see
 * computeRiverSpine above). `yOffset` shifts the whole ribbon (used to
 * drop the seabed copy below the water surface). UVs are
 * world-bounds-normalized (same convention as the lake meshes) rather
 * than arc-length-based like pathMesh.js/mountainMesh.js use for their
 * tiling theme textures — a river has no repeating texture, it needs real
 * world XZ per-fragment for the terrain-height-texture lookup and the
 * Voronoi shader's absolute cell scale, exactly like a lake.
 *
 * Three vertices per spine point (left bank / center / right bank), not
 * two, purely so the `aShore` attribute below has somewhere to reach 1:
 * that's the river's half of the same authored-depth cue lakes get from
 * their shoreline distance (see applyLakeWaterShading's header comment) —
 * with two bank-only vertices it would interpolate 0 across the whole
 * ribbon and the river would render as one flat sheet of foam.
 */
function buildRiverGeometry(spine, river, world, yOffset = 0) {
  const width = river.width;
  const { bounds } = world;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;

  const positions = [];
  const uvs = [];
  const shore = [];
  for (const s of spine) {
    const y = s.y + RIVER_Y_OFFSET + yOffset;
    const lx = s.x + s.nx * (width / 2), lz = s.z + s.nz * (width / 2);
    const rx = s.x - s.nx * (width / 2), rz = s.z - s.nz * (width / 2);
    positions.push(lx, y, lz, s.x, y, s.z, rx, y, rz);
    uvs.push(
      (lx - bounds.minX) / sizeX, (lz - bounds.minZ) / sizeZ,
      (s.x - bounds.minX) / sizeX, (s.z - bounds.minZ) / sizeZ,
      (rx - bounds.minX) / sizeX, (rz - bounds.minZ) / sizeZ
    );
    shore.push(0, 1, 0);
  }

  const indices = [];
  for (let i = 1; i < spine.length; i++) {
    const aL = (i - 1) * 3, aC = aL + 1, aR = aL + 2;
    const bL = i * 3, bC = bL + 1, bR = bL + 2;
    indices.push(aL, bL, aC, aC, bL, bC); // left half-ribbon
    indices.push(aC, bC, aR, aR, bC, bR); // right half-ribbon
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A vertical "skirt" wall along BOTH edges of the river, from the water
 * surface down to the seabed layer — without this, the water surface and
 * seabed are two paper-thin, disconnected sheets floating in space, and
 * looking at the riverbank from a grazing angle (or from underwater) sees
 * straight through the gap between them to whatever's behind. Solid-color
 * (not the animated Voronoi shader) — this is backing geometry to close
 * the gap, not the hero surface.
 */
function buildRiverSkirtMesh(spine, river) {
  const width = river.width;
  const bottomOffset = RIVER_Y_OFFSET - seabedOffsetFor(river.maxDepth);
  const positions = [];
  for (const s of spine) {
    const topY = s.y + RIVER_Y_OFFSET;
    const botY = s.y + bottomOffset;
    const lx = s.x + s.nx * (width / 2), lz = s.z + s.nz * (width / 2);
    const rx = s.x - s.nx * (width / 2), rz = s.z - s.nz * (width / 2);
    positions.push(lx, topY, lz, lx, botY, lz, rx, topY, rz, rx, botY, rz);
  }
  const indices = [];
  for (let i = 1; i < spine.length; i++) {
    const aTL = (i - 1) * 4, aBL = aTL + 1, aTR = aTL + 2, aBR = aTL + 3;
    const bTL = i * 4, bBL = bTL + 1, bTR = bTL + 2, bBR = bTL + 3;
    indices.push(aTL, bTL, aBL, aBL, bTL, bBL); // left wall
    indices.push(aTR, aBR, bTR, aBR, bBR, bTR); // right wall (opposite winding — outward normal faces the other way)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.05, 0.2, 0.35),
    transparent: true,
    opacity: 0.85,
    roughness: 0.3,
    metalness: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1.5; // between the seabed (1) and the water surface (2)
  mesh.userData.waterBodyId = river.id;
  return mesh;
}

/**
 * One constant flow direction/speed per river body, derived from its
 * overall start-to-end direction and average slope — a deliberate scope
 * cut (same "core-look-only" restraint as the Voronoi water port itself):
 * a per-vertex flow FIELD that follows every bend would need custom
 * vertex attributes threaded through onBeforeCompile, which is real extra
 * complexity for a look that, for most river shapes, reads the same as a
 * single overall direction. Worth revisiting if a sharply-bending river
 * ever looks wrong because of it.
 */
function computeRiverFlow(river) {
  const first = river.points[0];
  const last = river.points[river.points.length - 1];
  let dx = last.x - first.x;
  let dz = last.z - first.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const heightDrop = river.surfaceHeights[0] - river.surfaceHeights[river.surfaceHeights.length - 1];
  // Steeper drop -> faster visual current, clamped to a range that still
  // reads as a scrolling cel pattern rather than a strobing blur.
  const speed = Math.max(0.05, Math.min(1.5, (heightDrop / len) * 4));
  return { dir: { x: dx, z: dz }, speed };
}

/**
 * Real water shading for one river body — same Voronoi cel-shaded look and
 * real-depth technique as applyLakeWaterShading, with two differences:
 * (1) the surface height varies per-fragment (a river isn't flat), read
 * from a small vertex-shader addition that passes the vertex's own local Y
 * through as a varying (the ribbon's vertices already carry their true
 * world-space Y directly, no mesh-level offset the way lake meshes have);
 * (2) the Voronoi sampling UV scrolls along the river's overall flow
 * direction (computeRiverFlow) — the "current" the water/grass shader port
 * never had, expressed as a shader scroll rather than a real fluid sim.
 */
function applyRiverWaterShading(mat, river, terrainHeightInfo, bounds) {
  const flow = computeRiverFlow(river);
  const originX = bounds.minX;
  const originZ = bounds.minZ;
  const sizeX = bounds.maxX - bounds.minX;
  const sizeZ = bounds.maxZ - bounds.minZ;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uPlaneOrigin = { value: new THREE.Vector2(originX, originZ) };
    shader.uniforms.uPlaneSize = { value: new THREE.Vector2(sizeX, sizeZ) };
    shader.uniforms.uTerrainHeightMap = { value: terrainHeightInfo.texture };
    shader.uniforms.uTerrainHeightMin = { value: terrainHeightInfo.min };
    shader.uniforms.uTerrainHeightMax = { value: terrainHeightInfo.max };
    shader.uniforms.uMaxDepth = { value: Math.max(0.01, river.maxDepth) };
    shader.uniforms.uFlowDir = { value: new THREE.Vector2(flow.dir.x, flow.dir.z) };
    shader.uniforms.uFlowSpeed = { value: flow.speed };

    // Only vertex-shader touch this file makes anywhere — every other
    // custom shader here only edits the fragment stage. A river's surface
    // height genuinely varies per-fragment (unlike a lake's flat
    // surfaceLevel), and the cheapest correct way to get that into the
    // fragment shader is a single pass-through varying of the vertex's own
    // local Y (already the true world-space height — this mesh carries no
    // mesh-level position/rotation offset, unlike the lake meshes).
    // `aShore` rides along the same way (0 at either bank, 1 at the
    // centerline — see buildRiverGeometry): the river's equivalent of a
    // lake's distance-in-from-shore depth cue, which a river can't derive
    // from a bounding box the way applyLakeWaterShading does.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying float vSurfaceY;\nattribute float aShore;\nvarying float vShore;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvSurfaceY = position.y;\nvShore = aShore;`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec2 uPlaneOrigin;
        uniform vec2 uPlaneSize;
        uniform sampler2D uTerrainHeightMap;
        uniform float uTerrainHeightMin;
        uniform float uTerrainHeightMax;
        uniform float uMaxDepth;
        uniform vec2 uFlowDir;
        uniform float uFlowSpeed;
        varying float vSurfaceY;
        varying float vShore;
        ${VORONOI_CEL_GLSL}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float rawHeight = texture2D(uTerrainHeightMap, vMapUv).r;
          float terrainHeight = uTerrainHeightMin + rawHeight * (uTerrainHeightMax - uTerrainHeightMin);
          float realDepthFrac = clamp(max(0.0, vSurfaceY - terrainHeight) / uMaxDepth, 0.0, 1.0);
          // A river's surface is clamped to its own bank height
          // (computeRiverSpine) and nothing carves a channel anymore, so
          // realDepthFrac is ~0 by construction — vShore is what actually
          // makes the middle of the river read as water instead of one flat
          // sheet of shoreline foam. Same fix as applyLakeWaterShading; see
          // its header comment.
          float depthFrac = max(realDepthFrac, clamp(vShore, 0.0, 1.0));

          float shallow = 1.0 - smoothstep(0.0, 0.55, depthFrac);
          float edge = 1.0 - smoothstep(0.0, 0.12, depthFrac);

          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 flowOffset = uFlowDir * uFlowSpeed * uTime;
          float uScale = 0.35;
          vec2 noiseUV = worldXZ * uScale * 1.52 + flowOffset * 1.3;
          vec2 distort = vec2(voronoiFbm(noiseUV) - 0.5) * 0.30;
          vec2 vUv = worldXZ * uScale + flowOffset + distort;

          float f1 = voronoiF1(vUv, uTime, 0.30);
          float sf1 = voronoiSmoothF1(vUv, uTime, 0.30, 0.55);
          float cel = smoothstep(0.067 - 0.01, 0.067 + 0.01, f1 - sf1);

          vec3 deepColor = vec3(0.020, 0.118, 0.243);
          vec3 midColor = vec3(0.086, 0.302, 0.396);
          vec3 highlight = vec3(0.85, 0.97, 1.0);
          float midPos = 0.35;
          vec3 celColor = cel < midPos
            ? mix(deepColor, midColor, clamp(cel / midPos, 0.0, 1.0))
            : mix(midColor, highlight, clamp((cel - midPos) / (1.0 - midPos), 0.0, 1.0));

          vec3 tinted = mix(deepColor, celColor, shallow * 0.85 + 0.15);
          tinted = mix(tinted, highlight, edge * 0.5);

          diffuseColor.rgb = tinted;
        }`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          vec2 worldXZ = uPlaneOrigin + vMapUv * uPlaneSize;
          vec2 p = worldXZ * 0.5;
          float t = uTime;
          float dhx = cos(p.x * 1.0 + t * 1.1) * 1.0 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          float dhy = cos(p.y * 1.3 - t * 0.9) * 1.3 * 0.06
                    + cos((p.x + p.y) * 0.6 + t * 1.7) * 0.6 * 0.05;
          normal = normalize(normal + vec3(dhx, dhy, 0.0));
        }`
      );
    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'river-water-shading';
}

function buildRiverWaterMesh(spine, world, river, terrainHeightInfo) {
  const geo = buildRiverGeometry(spine, river, world, 0);
  const mat = new THREE.MeshStandardMaterial({
    map: terrainHeightInfo.texture, // vMapUv trigger — see buildLakeBodyWaterMesh's comment for why
    transparent: true,
    roughness: 0.15,
    metalness: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide, // so the underside is visible too (looking up from inside/underwater) instead of nothing — the plane would otherwise be invisible from behind, backface-culled by default
  });
  applyRiverWaterShading(mat, river, terrainHeightInfo, world.bounds);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  mesh.userData.isWater = true;
  mesh.userData.waterBodyId = river.id;
  return mesh;
}

function buildRiverSeabedMesh(spine, world, river, terrainHeightInfo) {
  const geo = buildRiverGeometry(spine, river, world, -seabedOffsetFor(river.maxDepth));
  // Reuses the lake seabed shader verbatim — it's a generic muddy Voronoi
  // color keyed only off world XZ, nothing lake-specific about it.
  const mat = new THREE.MeshStandardMaterial({
    map: terrainHeightInfo.texture,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  applyLakeSeabedShading(mat, world.bounds);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.userData.waterBodyId = river.id;
  return mesh;
}

/**
 * Builds one {water, seabed, skirt} mesh triple per `kind:'river'` entry
 * in `world.waterBodies` — the river counterpart to `buildLakeBodyMeshes`.
 * `skirt` (see buildRiverSkirtMesh) is the vertical wall closing the gap
 * between `water` and `seabed` along both banks — null alongside the
 * other two if the river has fewer than 2 points.
 * @returns {Array<{body: Object, water: THREE.Mesh|null, seabed: THREE.Mesh|null, skirt: THREE.Mesh|null}>}
 */
export function buildRiverBodyMeshes(world) {
  const rivers = (world.waterBodies || []).filter((b) => b.kind === 'river');
  if (!rivers.length) return [];
  const terrainHeightInfo = buildTerrainHeightTexture(world);
  const built = rivers.map((river) => {
    const spine = computeRiverSpine(river, world);
    if (!spine) return { body: river, water: null, seabed: null, skirt: null };
    return {
      body: river,
      water: buildRiverWaterMesh(spine, world, river, terrainHeightInfo),
      seabed: buildRiverSeabedMesh(spine, world, river, terrainHeightInfo),
      skirt: buildRiverSkirtMesh(spine, river),
    };
  });
  claimTerrainHeightTexture(built, terrainHeightInfo);
  return built;
}

/**
 * Hands the shared, per-rebuild terrain-height texture to the meshes that use
 * it, so disposeObject3D (src/render/dispose.js) frees it when they're torn
 * down. ONE texture is baked per rebuild and handed to every body in it, so
 * it's claimed by the first mesh only — a second claim would just mean an
 * extra (harmless, but pointless) dispose call on an already-freed texture.
 */
function claimTerrainHeightTexture(built, terrainHeightInfo) {
  const owner = built.find((b) => b.water)?.water;
  if (owner) owner.material.userData.ownedTextures = [terrainHeightInfo.texture];
}
