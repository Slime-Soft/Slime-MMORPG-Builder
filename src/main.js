// src/main.js
// Client entry point. Owns nothing authoritative. Wires together:
//  - src/net   (talks to server, sends input, receives authoritative state)
//  - src/sim   (same deterministic code as server, used here for prediction)
//  - src/render (Three.js drawing only)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPostProcessing } from './render/postProcessing.js';
import { defaultGraphicsSettings, playerCameraOf, PLAYER_CAMERA_DEFAULTS } from './sim/graphicsSettings.js';
import { createRenderer, createScene, createCamera, buildWorldMeshes, buildFloorMeshes, buildStoreInteriorMeshes, buildPlayerMesh, buildMonsterMesh, buildNameLabel, buildPlayerNameplate, disposeNameplate, buildQuestIndicatorSprite, updateQuestIndicatorSprite, triggerAbilityAnimation, updateAbilityAnimations, buildMonsterHealthBar, updateMonsterHealthBar, buildGatheringNodeMarker, setGatheringNodeDepleted, updateWalkCycle, toonify, applyColorTint, setCharacterTypes, updateWaterTime, renderUiOverlay } from './render/scene.js';
import { createVfxSystem, registerCustomVfxDefs } from './render/vfx/index.js';
import { NetClient, PredictedPlayer } from './net/client.js';
import { parseWorld, sampleTerrainHeight } from './sim/world.js';
import { buildCollisionIndex } from './sim/collision.js';
import { groundHeightFnFor } from './sim/platforms.js';
import { updateAtmosphere, applyGraphicsSettingsToAtmosphere } from './render/atmosphere.js';
import { setCurrentAnisotropy } from './render/renderSettings.js';
import { buildGroundTextureOverlay } from './render/groundTextureMesh.js';
import { registerCustomGroundTexture, setCustomGroundTextureLoadedCallback } from './render/groundTextureThemes.js';
import { registerCustomPathTexture, setCustomPathTextureLoadedCallback } from './render/pathThemes.js';
import { buildPathMeshes } from './render/pathMesh.js';
import { createAmbientParticleSystem, createZoneParticleSystem, createEnvironmentalParticleSystem } from './render/ambientParticles.js';
import { createWorldParticleEmitters } from './render/worldParticles.js';
import { createWorldLights } from './render/worldLights.js';
import { updateCloudShadowTime, applyCloudShadowSettings } from './render/cloudShadows.js';
import { createZoneAudioController, findActiveAudioZone } from './render/zoneAudio.js';
import { createMinimapController, questObjectiveTarget, buildQuestTargetLookups } from './render/minimap.js';
import { registerModelCatalog, waitForModels, updateModelAnimations } from './generators/modelLoader.js';
import { applyWeaponTuning, registerCustomWeaponModels, getWeaponTypeDef } from './sim/weaponTypes.js';
import { distanceXZ } from './sim/tower.js';
import { canAccept, isReadyToTurnIn, turnInNpcId } from './sim/quests.js';
import { switchKey, isPointInEventRange } from './sim/events.js';
import { getItemDef } from './sim/items.js';
import { canAffordReagents } from './sim/recipes.js';
import { xpForProfessionLevel } from './sim/professionLeveling.js';
import { CLASS_META } from './sim/classMeta.js';
import { CLASSES, getAbilityByKey, getAbilityDef, setSkillCatalog } from './sim/classes.js';
import { PRIMARY_STAT_IDS, PRIMARY_STAT_NAMES, zeroStats, STAT_HARD_CAP } from './sim/statDefs.js';
import { effectiveRankForLevel } from './sim/skillDefs.js';
import { isCCd, getMoveSpeedMultiplier } from './sim/statusEffects.js';
import { loadFloraPlugins } from './generators/pluginLoader.js';
import { EQUIP_SLOT_IDS, initEquipmentState, baseSlotFor, equipmentToWeaponLoadout } from './sim/equipment.js';
import { wornGearVisuals, weaponRenderLoadout } from './sim/gearVisuals.js';
import { buildPlayerCharacter } from './generators/playerCharacter.js';
import { resolveCharacter } from './web/character.js';
import { displayName } from './web/characterName.js';

// Zero-edit flora/decor props (src/generators/environment/plugins/) —
// registers each one before the world below is fetched/built, so a placed
// plugin prop renders in the live game exactly like a built-in one. See
// src/editor/main.js for the matching World Editor hookup.
await loadFloraPlugins();

// Signed in, this comes from the ACCOUNT (so it follows you across browsers);
// signed out, it falls back to this browser's localStorage exactly as before.
// See src/web/character.js.
const myCharacter = await resolveCharacter();
if (!myCharacter) {
  window.location.href = '/character-creation.html';
  throw new Error('No character found — redirecting to character creation.');
}

// Object Builder catalog (World Editor roadmap section E, MVP slice) —
// fetched in parallel with everything else below rather than blocking
// module load, since buildWorldMeshes isn't called until the socket
// 'welcome' event fires anyway (see onWelcome below). Falls back to an
// empty catalog so a down/erroring endpoint degrades placed custom props to
// their generic fallback shape instead of breaking world load.
// Class skill catalog (src/sim/skillDefs.js) — populates CLASSES[classId].abilities
// so tryUseAbility/getAbilityDef see the same cooldown/cost/effect data the
// server does. Falls back to an empty catalog (no abilities usable) if the
// fetch fails — matches this file's existing fetch-catalog idiom.
const skillsPromise = fetch('/api/skills')
  .then((r) => r.json())
  .then((s) => { setSkillCatalog(s); preloadAbilitySounds(s); return s; })
  .catch(() => []);

// Cast sounds, fetched and decoded up front rather than on the first cast.
// `new Audio(url).play()` at cast time starts a cold network request and an
// audio-decode for a file the player has never heard, which is the audible
// half of the "first cast hitches" problem (the visible half was the VFX
// light pool — see render/vfx/lights.js). One primed element per URL, cloned
// per playback so two casts of the same skill can overlap.
/** @type {Map<string, HTMLAudioElement>} soundUrl -> a loaded, never-played template element */
const abilitySoundCache = new Map();

function preloadAbilitySounds(skills) {
  for (const skill of skills) {
    if (!skill.soundUrl || abilitySoundCache.has(skill.soundUrl)) continue;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = skill.soundUrl;
    audio.load();
    abilitySoundCache.set(skill.soundUrl, audio);
  }
}

/** Plays a cast sound from the warmed cache, falling back to a cold Audio for anything not in the catalog at load time. */
function playAbilitySound(url) {
  const cached = abilitySoundCache.get(url);
  const audio = cached ? /** @type {HTMLAudioElement} */ (cached.cloneNode()) : new Audio(url);
  audio.play().catch(() => {});
}

const objectDefsPromise = fetch('/api/objects').then((r) => r.json()).catch(() => []);
// Editor-authored gear/quest/consumable catalog (src/sim/authoredItems.js) —
// getItemDef only knows the hardcoded materials in src/sim/items.js, so an
// authored item (a loot drop, a merchant's stock) needs this lookup to show
// a real name/icon instead of its raw id.
// Awaited in onWelcome, not merely kicked off: since the Equipment Builder an
// item also carries how it LOOKS on a body (src/sim/gearVisuals.js), so this
// catalog is now a prerequisite for building the player's mesh at all — not
// just for labelling a toast. A mesh built before it lands would be a
// stark-naked character that only dresses itself on the next equip.
let authoredItemById = {};
const authoredItemsPromise = fetch('/api/items')
  .then((r) => r.json())
  .then((list) => { authoredItemById = Object.fromEntries(list.map((i) => [i.id, i])); })
  .catch(() => {});

/** Name + icon for ANY itemId — hardcoded materials/consumables first, then the authored catalog, else the raw id with no icon. */
function resolveItemDisplay(itemId) {
  try {
    const def = getItemDef(itemId);
    return { name: def.name, iconUrl: null, sellPrice: def.sellPrice ?? null };
  } catch {
    const authored = authoredItemById[itemId];
    if (authored) return { name: authored.name, iconUrl: authored.iconUrl || null, sellPrice: authored.sellPrice ?? null };
    return { name: itemId, iconUrl: null, sellPrice: null };
  }
}
// Class bodies authored in the Character & NPC Builder — players are rendered
// from these, so tuning a class model there changes the live game.
let characterTypeCatalog = []; // raw catalog rows, kept locally too (setCharacterTypes only feeds render/scene.js's own world-rendering path) — the Equipment panel's 3D preview needs the array itself to call buildPlayerCharacter directly
const characterTypesPromise = fetch('/api/character-types')
  .then((r) => r.json())
  .then((t) => { setCharacterTypes(t); characterTypeCatalog = t; return t; })
  .catch(() => []);
// Monster Builder catalog (World Editor roadmap section E) — same
// fire-and-forget/fall-back-to-empty idiom as objectDefsPromise above.
const monsterTypeDefsPromise = fetch('/api/monster-types').then((r) => r.json()).catch(() => []);
let monsterTypesById = {}; // populated once monsterTypeDefsPromise resolves (see onWelcome below)
// buildMonsterMesh falls back to a slime for any type it can't find in the
// catalog. onWorldState starts arriving the moment the socket connects —
// often before this fetch lands — and it CACHES the mesh it builds, so every
// monster created in that window stayed a slime for the rest of the session
// regardless of its real type. Monster mesh creation waits on this flag
// instead; a skipped tick just means the mesh appears ~50ms later.
let monsterCatalogReady = false;
monsterTypeDefsPromise.then((defs) => {
  monsterTypesById = Object.fromEntries((defs || []).map((mt) => [mt.id, mt]));
  monsterCatalogReady = true; // true even if the fetch failed and defs is [] — better a slime than no monsters at all
});
// Building Builder catalogs — same fire-and-forget idiom. A `type: 'custom'`
// world building resolves its pieces from these (src/render/scene.js).
const buildingPartsPromise = fetch('/api/building-parts').then((r) => r.json()).catch(() => []);
const buildingTypesPromise = fetch('/api/building-types').then((r) => r.json()).catch(() => []);
// Custom ground-texture uploads (World Editor Ground Textures mode) — kicks
// off loading each uploaded image into the tile cache immediately; a layer
// referencing one that hasn't finished loading yet is just skipped on the
// first bake and picked up by the reload triggered below once it lands.
const groundTexturesPromise = fetch('/api/ground-textures')
  .then((r) => r.json())
  .then((catalog) => {
    for (const entry of catalog) registerCustomGroundTexture(entry.id, entry.url);
    return catalog;
  })
  .catch(() => []);
// Custom path-texture uploads (World Editor Paths mode) — same
// kick-off-loading-now, pick-up-later idiom as ground textures above.
const pathTexturesPromise = fetch('/api/path-textures')
  .then((r) => r.json())
  .then((catalog) => {
    for (const entry of catalog) registerCustomPathTexture(entry.id, entry.url);
    return catalog;
  })
  .catch(() => []);
// Uploaded music/ambient tracks (World Editor Freeform Zones). The zone
// audio controller reads this object by reference at playback time, so it's
// safe to populate it lazily — no ordering dependency with the controller's
// own construction below.
const audioCatalogById = {};
fetch('/api/audio')
  .then((r) => r.json())
  .then((catalog) => {
    for (const entry of catalog) audioCatalogById[entry.id] = entry;
  })
  .catch(() => {});
// Set once the initial buildWorldMeshes() call (which builds its OWN ground-
// texture overlay from whatever's loaded by then) has actually run. Without
// this guard, an image that finishes loading WHILE onWelcome is still
// awaiting other catalogs fires this callback early, adding its own overlay
// mesh to overworldGroup BEFORE buildWorldMeshes gets a chance to run —
// buildWorldMeshes's own toonify(scene) call then sweeps up that
// already-added mesh (toonify walks the whole group, not just what IT
// added) and silently strips its custom shader, while buildWorldMeshes ALSO
// adds its own second, correct overlay — two overlapping meshes racing for
// which one wins visually. Once this flag is set, the guard is moot: this
// callback's own remove-then-add each time keeps exactly one mesh present.
let worldMeshesReady = false;
setCustomGroundTextureLoadedCallback((id) => {
  if (!world || !worldMeshesReady) return;
  // The catalog can hold uploads that aren't painted anywhere on this map —
  // every one of them fires this callback once its image loads, and a
  // rebuild for an IRRELEVANT id still tears down and recreates the overlay
  // mesh, racing its still-compiling shader against whatever rebuild comes
  // next. Skip rebuilding unless the id that just loaded is actually used.
  const isRelevant = (world.groundTextures || []).some((l) => l.textureId === `custom:${id}`);
  if (!isRelevant) return;
  const fresh = buildGroundTextureOverlay(world);
  if (groundTextureOverlayMesh) overworldGroup.remove(groundTextureOverlayMesh);
  groundTextureOverlayMesh = fresh;
  if (fresh) overworldGroup.add(fresh);
});
// Same idiom as the ground-texture callback above: a custom path texture can
// still be loading when buildWorldMeshes first builds the paths group (its
// getPathThemeTexture call falls back to 'basic' silently), so rebuild the
// group in place once the actual image lands. Only for paths that reference
// this exact upload — every catalog entry's image load fires this once,
// whether or not it's used on this map.
setCustomPathTextureLoadedCallback((id) => {
  if (!world || !worldMeshesReady) return;
  const isRelevant = (world.paths || []).some((p) => p.theme === `custom:${id}`);
  if (!isRelevant) return;
  const old = overworldGroup.getObjectByName('paths');
  if (old) overworldGroup.remove(old);
  const fresh = buildPathMeshes(world);
  toonify(fresh); // buildWorldMeshes's own paths group gets toonified as part of toonify(scene); a later standalone rebuild needs the same treatment itself
  overworldGroup.add(fresh);
});
// Imported FBX models (World Editor "Imported Model" placement) — registered
// immediately so buildWorldMeshes' prop loop can resolve modelId -> mesh; the
// live game additionally AWAITS every model actually referenced by a placed
// prop (see onWelcome below) rather than ever showing a placeholder box, at
// the cost of a bounded startup delay — the editor gets away with showing
// placeholders because it's an authoring tool, the live game shouldn't.
const modelCatalogPromise = fetch('/api/models')
  .then((r) => r.json())
  .then((catalog) => {
    registerModelCatalog(catalog);
    registerCustomWeaponModels(catalog); // category:'weapon' entries become real WeaponTypeDefs
    return catalog;
  })
  .catch(() => []);

// Author-created VFX (Skill Builder's "Custom VFX" panel, see src/sim/vfxDefs.js)
// — cheap fetch, awaited alongside the other authoring catalogs below so a
// skill referencing a custom vfx id never spawns before it's registered.
const vfxCatalogPromise = fetch('/api/vfx')
  .then((r) => r.json())
  .then((catalog) => {
    registerCustomVfxDefs(catalog);
    return catalog;
  })
  .catch(() => []);

// Weapon grips authored in the Character & NPC Builder. Applied before any
// character mesh is built, so the player holds a sword exactly the way the
// builder previewed it. Falls back to the shipped defaults if the fetch fails.
//
// Chained after modelCatalogPromise, not fetched independently — a custom
// weapon model's saved grip is a patch applied to its BY_ID entry
// (applyWeaponTuning silently no-ops any id not yet in BY_ID), and that
// entry doesn't exist until registerCustomWeaponModels runs above. Firing
// both fetches concurrently raced them, and weapon-tuning usually won,
// silently dropping every custom weapon's saved grip.
const weaponTuningPromise = modelCatalogPromise.then(() =>
  fetch('/api/weapon-tuning')
    .then((r) => r.json())
    .then((t) => { applyWeaponTuning(t); return t; })
    .catch(() => ({}))
);

/** Deterministic string->int seed so a remote player who hasn't sent their character yet still renders consistently. */
function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

const canvas = document.getElementById('game-canvas');
const renderer = createRenderer(canvas);
// The world's look. A per-region atmosphere is a natural next step (world.json
// growing an `atmosphere` field); for now one preset drives sky, fog, lights,
// ground tint and grass colour together, so they can never disagree.
const ATMOSPHERE = 'meadow';
const scene = createScene(ATMOSPHERE);
const vfxSystem = createVfxSystem(scene); // three.quarks-backed skill VFX — see render/vfx/
let grassCover = null; // static, authored ground cover (see render/grassCover.js)
let flowerCover = null; // 'flower-meadow' preset (see render/flowerCover.js)
let propSway = null; // individually-placed 'flower'/'flower-daisy'/'flower-bell' wind sway (see render/windSway.js)
let treeSway = null; // each individually-placed tree's own leaf wind sway (see render/scene.js's buildWorldMeshes)
let treeLod = null; // drops each round-canopy tree's ~10k-triangle leaf shell past ~160m (see render/treeLod.js); null on maps with no such trees
/** @type {Map<string, THREE.Object3D>} prop id -> mesh, only for props an Event Object is attached to (see render/scene.js's buildWorldMeshes) — used to hide/show a prop like a treasure chest once its event's world-shared visibility flips */
let propMeshesById = new Map();
let waterMesh = null; // ripple animation driven per-frame — see render/scene.js's updateWaterTime
let seabedMesh = null; // same Voronoi cel-shading as waterMesh, driven by the same updateWaterTime call
let lakeBodies = []; // per-body lakes/puddles (src/sim/waterBodies.js) — [{body, water, seabed}], each pair driven by updateWaterTime same as waterMesh/seabedMesh
let riverBodies = []; // sloped rivers (src/sim/waterBodies.js) — same [{body, water, seabed}] shape as lakeBodies
let ambientParticles = null; // dust/snow/rain/... over painted ground-texture layers (see render/ambientParticles.js)
let zoneParticles = null; // dust/snow/rain/... confined to a world.zones[] entry instead of a painted layer (see render/ambientParticles.js)
let environmentalParticles = null; // map-wide dust/snow/rain/... from graphicsSettings.environmental (see render/ambientParticles.js)
// The three above are the DEFAULT OVERWORLD's, built once into overworldGroup
// and never rebuilt. Every other map (a second overworld like Asteria, a
// building interior, a dungeon) gets its own set here, rebuilt on each map
// switch — without this, a non-default map's painted-layer, zone AND
// environmental particles all silently did nothing, since nothing ever built
// them and the overworld's are gated on overworldGroup.visible.
let mapParticles = [];
// Placed particle emitters (world.particleEmitters — campfires, glitter,
// tornadoes; see render/worldParticles.js). One streamer for the default
// overworld and one that's rebuilt per non-default map, mirroring the
// three ambient systems above.
let worldEmitters = null;
let mapWorldEmitters = null;
// Placed light sources (world.lights — torches, braziers, a shaft of daylight
// through a cell grate; see render/worldLights.js). Split default-overworld /
// per-map exactly like the emitters above, and for the same reason: a
// dungeon's lights must die with the dungeon, or the next map inherits them.
let worldLights = null;
let mapWorldLights = null;
let groundTextureOverlayMesh = null; // rebuilt in place once an async custom-texture upload finishes loading (see registerCustomGroundTexture)
const zoneAudioController = createZoneAudioController(audioCatalogById);
// AudioContext starts suspended until a real user gesture happens on THIS
// page — the "Enter World" click lives on character-creation.html, a
// separate page load, so it doesn't count. Resume on whatever real
// interaction happens first here instead.
window.addEventListener('pointerdown', () => zoneAudioController.resume(), { once: true });
window.addEventListener('keydown', () => zoneAudioController.resume(), { once: true });

const minimapController = createMinimapController({
  minimap: document.getElementById('minimap-canvas'),
  fullMap: document.getElementById('map-overlay-canvas'),
});
const minimapWrapEl = document.getElementById('minimap-wrap');
const minimapHintEl = document.getElementById('minimap-hint');
let questTargetLookups = { monsterGroupById: new Map(), staticMonsterPosByGroup: new Map(), gatheringNodesByGroup: new Map() };
// No text-input UI exists yet in the live game (chat is unbuilt), so unlike
// the editor's isTypingInFormField() guard, there's nothing to protect
// against here — 'M' is safe to bind directly.
/**
 * True while the player is typing into a form field. The game's hotkeys are
 * bare letters (M, G, I, J...), so without this, naming a guild "Iron Wolves"
 * would open the inventory on the I, toggle the guild panel on the second
 * word, and walk the character across the map on the W.
 */
function isTypingInField() {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || isTypingInField()) return;
  toggleGameWindow('map');
});

const camera = createCamera();
camera.position.set(0, 14, 20);

// Post-processing — the full pass chain (SSAO/bloom/DOF/saturation/sharpen/
// FXAA/output) lives in postProcessing.js, shared with the World Editor.
// Reapplied per-map (see applyActiveGraphicsSettings below) once a map's
// graphicsSettings is known; this call just seeds today's default look
// before that first happens.
const { composer, applySettings: applyPostProcessingSettings, setSize: setPostProcessingSize, update: updatePostProcessing, warmUp: warmUpPostProcessing } = createPostProcessing(renderer, scene, camera);
applyPostProcessingSettings(defaultGraphicsSettings());

// Third-person orbit-follow camera: the target re-centers on the player
// every frame, but the player fully controls the viewing angle and distance
// by dragging/scrolling — previously the camera had a rigid fixed offset
// and never responded to input at all.
const cameraControls = new OrbitControls(camera, canvas);
cameraControls.enableDamping = true;
cameraControls.dampingFactor = 0.12;
cameraControls.enablePan = false; // panning away would just get overridden next frame anyway
// Zoom limits are per-map (graphicsSettings.playerCamera) — see
// applyPlayerCameraLimits, which overwrites these the moment a map is known.
// These seeds are PLAYER_CAMERA_DEFAULTS, i.e. what every map played at before
// the field existed.
cameraControls.minDistance = PLAYER_CAMERA_DEFAULTS.minDistance;
cameraControls.maxDistance = PLAYER_CAMERA_DEFAULTS.maxDistance;
cameraControls.maxPolarAngle = Math.PI * 0.49;
cameraControls.target.set(0, 1, 40); // roughly matches world.json spawnPoint until the real one arrives
let lastCameraTargetPos = cameraControls.target.clone();

/** @type {Map<string, THREE.Object3D>} */
const remoteMeshes = new Map();
/** @type {Map<string, object>} id -> character (needed to resolve which class's ability animation to play) */
const playerCharacters = new Map();
/** @type {Map<string, {mainHand:string|null, offHand:string|null, slots:object}>} id -> another player's equipment as the server sees it: the weapon TYPE ids (src/sim/equipment.js's equipmentToWeaponLoadout) plus `slots`, the raw slot->itemId state that worn gear's visuals are resolved from. Merged into their cosmetic character params so their mesh holds the right weapon AND wears the right armor, mirroring the local player's own preview. */
const otherPlayerWeaponLoadouts = new Map();

/** @type {Map<string, {id:string,name:string,logoUrl:string}|null>} id -> that player's guild badge, as the server reports it. `null` means "we know they have no guild"; absent means "we haven't been told yet". */
const playerGuilds = new Map();

/**
 * (Re)builds the overhead plate — character name plus guild name/logo — on a
 * remote player's mesh, replacing whatever plate it already had.
 *
 * A player's plate is rebuilt rather than mutated whenever their name or
 * guild changes (see buildPlayerNameplate), and their MESH is itself rebuilt
 * on every cosmetic/gear change, so this runs on a fresh mesh far more often
 * than it runs on a change of name — which is why it takes the mesh rather
 * than looking one up.
 */
function attachPlayerNameplate(id, mesh) {
  if (!mesh) return;
  const existing = mesh.userData.nameplate;
  if (existing) {
    mesh.remove(existing);
    disposeNameplate(existing);
  }
  const plate = buildPlayerNameplate({ name: playerCharacters.get(id)?.name, guild: playerGuilds.get(id) });
  mesh.add(plate);
  mesh.userData.nameplate = plate;
}

/** Merges a remote player's currently-known equipment onto their cosmetic character params for buildPlayerMesh — never mutates the stored character object. No-op (returns character as-is) if we don't know their loadout yet. */
function withWeaponLoadout(id, character) {
  const loadout = otherPlayerWeaponLoadouts.get(id);
  if (!loadout) return character;
  return { ...character, equipmentOverride: loadout, ...gearVisualParams(loadout.slots) };
}

/**
 * The two appearance fields that turn an EquipmentState into a LOOK: the worn
 * pieces' authored shapes, and how the held weapons render (enchantment and
 * per-item grip nudge). Both resolve item ids against this client's own
 * /api/items catalog.
 *
 * One helper for the local player, remote players and the equipment panel's
 * preview alike — three call sites that must agree, since they render the same
 * character and any disagreement shows up as gear that appears in the preview
 * and not in the world.
 */
function gearVisualParams(equipmentState) {
  if (!equipmentState) return {};
  return {
    gear: wornGearVisuals(equipmentState, authoredItemById),
    weaponRender: weaponRenderLoadout(equipmentState, authoredItemById),
  };
}
let localMesh = null;
let localId = null;
let predicted = null;
let world = null;
let zonesById = {}; // world.zones keyed by id, rebuilt whenever a fresh world arrives (see onWelcome)

// Overworld, tower-floor, store-interior, and (new) generic-map geometry
// each live in their own group so entering/leaving any of them is a clean
// swap rather than tracking and removing dozens of individually-added
// meshes. `mapGroup` is the Phase-3 multi-map addition: any map other than
// the default overworld (a building, or — until dungeon instancing lands —
// a dungeon map treated as a plain teleport target) gets built into this
// ONE shared group, torn down and rebuilt fresh on every 'map-entered'.
const overworldGroup = new THREE.Group();
const floorGroup = new THREE.Group();
const storeGroup = new THREE.Group();
const mapGroup = new THREE.Group();
scene.add(overworldGroup, floorGroup, storeGroup, mapGroup);
floorGroup.visible = false;
storeGroup.visible = false;
mapGroup.visible = false;
// null = the default overworld map (legacy tracking below still applies);
// otherwise the manifest id of whatever's currently built into `mapGroup`.
// Mirrors server/index.js's player.mapId convention exactly.
let currentMapId = null;
let mapCollision = null; // built fresh per map-entered; null while on the default overworld (overworldCollision is used instead)
// Populated once in onWelcome, then reused by onMapEntered so entering a
// different map doesn't need to re-fetch every catalog from scratch.
let objectDefsById = {};
let buildingPartsById = {};
let buildingTypesById = {};
let modelCatalogById = {};
let buildingCatalogForRender = { partsById: {}, typesById: {} };

/** @type {Map<string, THREE.Object3D>} monster id -> mesh, current floor only */
const monsterMeshes = new Map();
/** @type {Map<string, THREE.Object3D>} monster id -> mesh, overworld monsters (parented to overworldGroup, so tower/store visibility toggling hides them for free) */
const overworldMonsterMeshes = new Map();
/** @type {Map<string, Object>} npc id -> static def (name/appearance/dialog) from world.npcs, for rendering + dialog lookup */
const npcDefs = new Map();
/** @type {Map<string, THREE.Object3D>} npc id -> mesh, overworld NPCs (also parented to overworldGroup) */
const overworldNpcMeshes = new Map();
/** @type {Object[]} static Event Object defs (see src/sim/events.js), from world.events */
let activeEventObjects = [];
/** @type {Map<string, boolean>} event id -> current visible flag (world-shared, kept in sync via event-object-visibility) */
const eventObjectVisibility = new Map();
let activeEventId = null; // event currently in flight / whose dialog is open, or null

/** Applies an Event Object's current world-shared visible/hidden state to whatever mesh it's attached to (a treasure-chest prop, an NPC) — a no-op for a standalone trigger (nothing to render) or if the target mesh hasn't been built yet (NPCs are built lazily on first onState; re-called from there once it exists). */
function applyEventObjectVisibility(ev) {
  const visible = eventObjectVisibility.get(ev.id) !== false;
  if (ev.attachedType === 'prop') {
    const mesh = propMeshesById.get(ev.attachedId);
    if (mesh) mesh.visible = visible;
  } else if (ev.attachedType === 'npc') {
    const mesh = overworldNpcMeshes.get(ev.attachedId);
    if (mesh) mesh.visible = visible;
  }
}
let towerMeta = null; // { maxFloor, entryPoint, entryRadius } from welcome
let inTower = false;
let inStore = false;
let storeEntranceInfo = null; // { position, range } from welcome
let currentFloorNumber = 0;
let currentFloorDef = null;
let activeBounds = null; // world.bounds or currentFloorDef.bounds, whichever context is active
let activeTerrainWorld = null; // whichever world-like object activeBounds came from — sampleTerrainHeight(activeTerrainWorld, x, z) for jump's ground height, same object server-side uses (see server/index.js's terrainWorld)
// The overworld's static colliders, built from the same world.json + object
// catalog the server builds them from, so prediction and authority agree. Null
// inside a tower floor or a store interior — those are bare rooms.
let overworldCollision = null;
let activeCollision = null;
let activeGraphicsSettings = defaultGraphicsSettings(); // whichever map's graphicsSettings is currently relevant — see applyActiveGraphicsSettings
let isDeadLocally = false; // freezes local prediction to match the server's authoritative freeze

/** Reapplies post-processing, atmosphere (light/ambient/fog), and anisotropy from activeGraphicsSettings — called whenever the active map changes (initial load, entering/leaving a building or dungeon map). Anisotropy must be set before any texture-creation happens (buildWorldMeshes et al.), since ground/path/mountain textures read it at creation time rather than taking a parameter. */
function applyActiveGraphicsSettings() {
  setCurrentAnisotropy(activeGraphicsSettings.anisotropy);
  applyPostProcessingSettings(activeGraphicsSettings);
  applyGraphicsSettingsToAtmosphere(scene, activeGraphicsSettings);
  applyPlayerCameraLimits();
  if (groundTextureOverlayMesh) applyCloudShadowSettings(groundTextureOverlayMesh, activeGraphicsSettings.postFx.cloudShadows);
  warmUpPostProcessing(); // see postProcessing.js's warmUp() for why this exists
}

/**
 * Pushes the active map's authored zoom range onto the orbit controls. Called
 * on every map change — a dungeon that caps zoom-out at 25 must not leave you
 * parked at the overworld's 60 after a teleport (OrbitControls.update() clamps
 * the live distance into the new range on its next frame, which animate()
 * calls unconditionally, so there is nothing to clamp by hand here).
 */
function applyPlayerCameraLimits() {
  const cam = playerCameraOf(activeGraphicsSettings);
  cameraControls.minDistance = cam.minDistance;
  cameraControls.maxDistance = cam.maxDistance;
}

const healthUI = { health: 100, maxHealth: 100 };
let localStatusEffects = []; // this player's own stun/freeze/sleep/slow/dot/hot/buff/shield state — see src/sim/statusEffects.js, updated from the 'state'-family broadcasts' self entry

// Without this, a stunned/poisoned/shielded player has no way to see it —
// a small icon-per-active-effect row above the health bar (public/index.html's
// #status-effect-row). Rebuilt fresh each call rather than diffed since the
// list is always short (a handful of effects at most).
const STATUS_EFFECT_LABELS = {
  stun: '💫 Stunned', freeze: '❄️ Frozen', sleep: '💤 Asleep', slow: '🐌 Slowed',
  dot: '☠️ Poisoned', hot: '💚 Renewing', buff: '✨ Buffed', shield: '🛡️ Shielded',
};
const statusEffectRowEl = document.getElementById('status-effect-row');
function renderStatusEffectRow(statusEffects, now) {
  statusEffectRowEl.innerHTML = (statusEffects || []).map((e) => {
    const label = STATUS_EFFECT_LABELS[e.type] || e.type;
    const secs = e.expiresAt !== undefined ? Math.max(0, Math.ceil((e.expiresAt - now) / 1000)) : null;
    return `<div class="status-icon">${label}${secs !== null ? ` (${secs}s)` : ''}</div>`;
  }).join('');
}

// Cast-progress bar (public/index.html's #cast-bar-wrap) — a skill's castMs
// (src/sim/skillDefs.js), server-authoritative: this is purely a visual
// countdown of what the server already told us it'll take, not a second
// timer deciding anything. onCastInterrupted (a 'cast-interrupted' server
// event — moved during a hard cast, or got CC'd mid-cast) flashes it red
// and hides it early instead of waiting out the fill.
const castBarWrapEl = document.getElementById('cast-bar-wrap');
const castBarFillEl = document.getElementById('cast-bar-fill');
let castBar = null; // { startedAt, durationMs } in performance.now() space, or null when idle
function startCastBar(durationMs) {
  castBar = { startedAt: performance.now(), durationMs };
  castBarWrapEl.classList.remove('interrupted');
  castBarWrapEl.style.display = 'block';
  castBarFillEl.style.width = '0%';
}
function interruptCastBar() {
  if (!castBar) return;
  castBar = null;
  castBarWrapEl.classList.add('interrupted');
  setTimeout(() => { castBarWrapEl.style.display = 'none'; }, 250);
}
function updateCastBar(nowPerf) {
  if (!castBar) return;
  const t = (nowPerf - castBar.startedAt) / castBar.durationMs;
  if (t >= 1) {
    castBar = null;
    castBarWrapEl.style.display = 'none';
    return;
  }
  castBarFillEl.style.width = `${Math.max(0, Math.min(100, t * 100))}%`;
}
const healthFillEl = document.getElementById('health-bar-fill');
const healthLabelEl = document.getElementById('health-label');
const deathOverlayEl = document.getElementById('death-overlay');
const deathSubEl = document.getElementById('death-sub');
const bossBannerEl = document.getElementById('boss-banner');

const xpUI = { level: 1, xp: 0, xpToNext: 100 };
const xpFillEl = document.getElementById('xp-bar-fill');
const levelLabelEl = document.getElementById('level-label');
const levelUpBannerEl = document.getElementById('level-up-banner');

function refreshXpUI() {
  xpFillEl.style.width = `${Math.max(0, Math.min(100, (xpUI.xp / xpUI.xpToNext) * 100))}%`;
  levelLabelEl.textContent = `Lv. ${xpUI.level}`;
}

// --- Gathering ---
const GATHER_RANGE = 3; // mirrors server/index.js GATHER_RANGE
// Monster health bars and NPC name labels hide past this range — without it
// they render at a fixed world size with depthTest off, so they stayed fully
// readable no matter how far away the target was.
const NAMEPLATE_MAX_DISTANCE = 30;
// Slightly under the server's TELEPORTER_USE_RANGE (3) — triggering just
// inside that margin means client-predicted position is never the reason a
// legitimate use gets an authoritative "too-far" denial back.
const TELEPORTER_TRIGGER_RANGE = 2.5;
// Guards against an instant-mode teleporter re-firing every single frame
// while the player stands on it, and against a same-spot teleporter pair
// bouncing back and forth the instant you arrive.
const TELEPORTER_RETRIGGER_MS = 1500;
let activeTeleporters = []; // whichever map's teleporters[] is currently relevant — the default overworld's, or the currently-loaded mapGroup's
let lastTeleportFiredAt = 0;
/** @type {Map<string, THREE.Object3D>} node id -> marker mesh */
const gatherNodeMeshes = new Map();
/** @type {Map<string, number>} node id -> ms timestamp when it's available again */
const gatherNodeAvailableAt = new Map();
const inventory = {}; // itemId -> quantity, mirrors server (server is authoritative; this is just for display)
const gatherToastsEl = document.getElementById('gather-toasts');

/** Called any time inventory changes — keeps the Equipment panel's inventory grid, craft affordability, vendor sell list and quest log all in sync. Cheap enough to just always run rather than tracking whether each panel happens to be open. */
function syncInventoryUI() {
  // A 'gather' quest tracks no progress of its own — its objective is read
  // live off the inventory (see isReadyToTurnIn/questProgressText), so an
  // inventory change IS quest progress. refreshQuestLog only ran on quest-
  // STATE messages and on opening the panel, neither of which a loot drop
  // sends, so an open log sat at "0/10 gathered" with ten of them in the bag
  // until you closed and reopened it. Turn-in worked the whole time — the
  // server reads the same inventory — which is what made it look purely
  // cosmetic rather than like stuck progress.
  if (questLogOpen) refreshQuestLog();
  if (equipmentPanelOpen) refreshEquipmentGrid();
  refreshCraftPanel();
  refreshVendorPanel();
}

function showGatherToast(text) {
  const el = document.createElement('div');
  el.className = 'gather-toast';
  el.textContent = text;
  gatherToastsEl.appendChild(el);
  setTimeout(() => el.remove(), 1500);
}

// --- Gathering/crafting cast bar (castBarStart/castBarEnd event effects —
// see src/sim/events.js's wait+castBar doc comment). Reuses the existing
// skill-cast bar (startCastBar/interruptCastBar/updateCastBar above) rather
// than a second progress-bar mechanism — only adds a text label, since a
// skill cast doesn't show one today. ---
const castBarLabelEl = document.getElementById('cast-bar-label');
function showCastBar(label, durationMs) {
  castBarLabelEl.textContent = label;
  castBarLabelEl.style.display = 'block';
  startCastBar(durationMs);
}
/** Plain "we're done" hide — NOT interruptCastBar(), which flashes the bar
 * red for an interrupted skill cast; a gathering/craft wait finishing on
 * schedule (castBarEnd) is the opposite of an interruption. */
function hideCastBar() {
  castBarLabelEl.style.display = 'none';
  castBar = null;
  castBarWrapEl.style.display = 'none';
}

// --- Crafting & economy ---
let gold = 0;
let vendorInfo = null; // { position, range } from welcome
const craftPanelEl = document.getElementById('craft-panel');
const vendorPanelEl = document.getElementById('vendor-panel');
const craftListEl = document.getElementById('craft-list');
const vendorListEl = document.getElementById('vendor-list');
let craftPanelOpen = false;
let vendorPanelOpen = false;

// Event-authored merchant (openMerchantStore, src/sim/events.js) — separate
// panel from the hardcoded general-store vendor above. Opens whenever an
// NPC event script's openMerchantStore effect arrives (onEventStep), closes
// on ✕ or walking out of talk range like the dialog box itself.
const merchantPanelEl = document.getElementById('merchant-panel');
const merchantBuyListEl = document.getElementById('merchant-buy-list');
const merchantSellListEl = document.getElementById('merchant-sell-list');
let merchantPanelOpen = false;
let currentMerchant = null; // { items:[{itemId, price, stock}], sellMultiplier } — the authored offer, mirrored client-side for display only; the server is the actual authority on every buy/sell

function openMerchantPanel(items, sellMultiplier) {
  currentMerchant = { items, sellMultiplier };
  merchantPanelOpen = true;
  merchantPanelEl.style.display = 'block';
  document.getElementById('merchant-tab-buy').classList.add('active');
  document.getElementById('merchant-tab-sell').classList.remove('active');
  merchantBuyListEl.style.display = '';
  merchantSellListEl.style.display = 'none';
  refreshMerchantPanel();
}
function closeMerchantPanel() {
  merchantPanelOpen = false;
  currentMerchant = null;
  merchantPanelEl.style.display = 'none';
}
/** An icon <img> if the item has one, else a blank placeholder box — keeps every row the same height/alignment whether or not an icon exists. */
function merchantIconHtml(iconUrl) {
  return iconUrl
    ? `<img class="merchant-icon" src="${iconUrl}" alt="" />`
    : `<div class="merchant-icon-placeholder"></div>`;
}
function refreshMerchantPanel() {
  if (!currentMerchant) return;
  merchantBuyListEl.innerHTML = currentMerchant.items.length
    ? currentMerchant.items.map((entry) => {
        const { name, iconUrl } = resolveItemDisplay(entry.itemId);
        const outOfStock = entry.stock !== undefined && entry.stock !== null && entry.stock <= 0;
        const stockText = entry.stock === undefined || entry.stock === null ? '' : ` (${entry.stock} left)`;
        return `<div class="merchant-row">
          ${merchantIconHtml(iconUrl)}
          <div class="merchant-name">${name}${stockText}</div>
          <button class="rb-btn" data-buy="${entry.itemId}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'Sold out' : `Buy 1 (${entry.price}g)`}</button>
        </div>`;
      }).join('')
    : '<div style="color:#888">Nothing for sale</div>';
  const sellableEntries = Object.entries(inventory).filter(([, qty]) => qty > 0);
  merchantSellListEl.innerHTML = sellableEntries.length
    ? sellableEntries.map(([itemId, qty]) => {
        const { name, iconUrl, sellPrice } = resolveItemDisplay(itemId);
        const price = sellPrice !== null ? Math.round(sellPrice * currentMerchant.sellMultiplier) : null;
        return `<div class="merchant-row">
          ${merchantIconHtml(iconUrl)}
          <div class="merchant-name">${name} x${qty}</div>
          <button class="rb-btn" data-merchant-sell="${itemId}" ${price === null ? 'disabled' : ''}>${price === null ? 'Not sellable' : `Sell 1 (${price}g)`}</button>
        </div>`;
      }).join('')
    : '<div style="color:#888">Nothing to sell</div>';
}
document.getElementById('merchant-tab-buy').addEventListener('click', () => {
  document.getElementById('merchant-tab-buy').classList.add('active');
  document.getElementById('merchant-tab-sell').classList.remove('active');
  merchantBuyListEl.style.display = '';
  merchantSellListEl.style.display = 'none';
});
document.getElementById('merchant-tab-sell').addEventListener('click', () => {
  document.getElementById('merchant-tab-sell').classList.add('active');
  document.getElementById('merchant-tab-buy').classList.remove('active');
  merchantSellListEl.style.display = '';
  merchantBuyListEl.style.display = 'none';
});
merchantBuyListEl.addEventListener('click', (e) => {
  const itemId = e.target.dataset.buy;
  if (itemId) net.buyFromMerchant(itemId, 1);
});
merchantSellListEl.addEventListener('click', (e) => {
  const itemId = e.target.dataset.merchantSell;
  if (itemId) net.sellToMerchant(itemId, 1);
});
document.getElementById('close-merchant').addEventListener('click', closeMerchantPanel);

// --- Tower Dungeon (src/sim/towerDungeon.js) ---
// Three pieces of UI, all driven by the server's tower-* events: the floor
// list (opened by an event object's openTowerDungeon command), the run HUD
// shown while standing on a floor, and the "proceed to the next floor?"
// prompt that appears the moment a floor's clear condition is met. Rows are
// built with DOM APIs rather than innerHTML because floor names are
// author-supplied strings.
const towerPanelEl = document.getElementById('tower-panel');
const towerFloorListEl = document.getElementById('tower-floor-list');
const towerRunHudEl = document.getElementById('tower-run-hud');
const towerRunLabelEl = document.getElementById('tower-run-label');
const towerPromptEl = document.getElementById('tower-prompt');
/** @type {{eventId:string, title:string, floors:Array<{name:string, requiredKills:number, requiredMonsterId:string|null}>, clearedFloors:number}|null} the tower whose floor list is open — display only; the server re-validates every Enter click */
let towerPanel = null;
/** @type {{eventId:string, floorIndex:number, floorCount:number, name:string, requiredKills:number, requiredMonsterId:string|null, kills:number, bossDown:boolean, cleared:boolean}|null} the floor run in progress */
let towerRun = null;

function openTowerPanel(payload) {
  towerPanel = payload;
  document.getElementById('tower-panel-title').textContent = payload.title || 'Tower';
  towerPanelEl.style.display = 'block';
  refreshTowerPanel();
}
function closeTowerPanel() {
  towerPanel = null;
  towerPanelEl.style.display = 'none';
}
/** The requirement line under a floor's name — "Defeat 5 monsters", "Defeat the floor boss", both, or nothing at all for a walk-through floor. */
function towerFloorRequirementText(floor) {
  const parts = [];
  if (floor.requiredKills > 0) parts.push(`Defeat ${floor.requiredKills} monster${floor.requiredKills === 1 ? '' : 's'}`);
  if (floor.requiredMonsterId) parts.push('Defeat the floor boss');
  return parts.join(' · ');
}
function refreshTowerPanel() {
  if (!towerPanel) return;
  towerFloorListEl.innerHTML = '';
  towerPanel.floors.forEach((floor, i) => {
    // Floor 1 is always open; every later one needs the previous cleared —
    // the same rule the server enforces (towerDungeon.js's isFloorUnlocked).
    const unlocked = i === 0 || towerPanel.clearedFloors >= i;
    const cleared = towerPanel.clearedFloors > i;
    const row = document.createElement('div');
    row.className = `tower-floor-row${unlocked ? '' : ' locked'}${cleared ? ' cleared' : ''}`;

    const nameWrap = document.createElement('div');
    nameWrap.className = 'tower-floor-name';
    nameWrap.textContent = `${unlocked ? '' : '🔒 '}Floor ${i + 1} - ${floor.name}`;
    const req = towerFloorRequirementText(floor);
    if (req) {
      const reqEl = document.createElement('span');
      reqEl.className = 'tower-floor-req';
      reqEl.textContent = req;
      nameWrap.appendChild(reqEl);
    }
    row.appendChild(nameWrap);

    const btn = document.createElement('button');
    btn.className = 'rb-btn';
    btn.textContent = unlocked ? 'Enter' : 'Locked';
    btn.disabled = !unlocked;
    btn.addEventListener('click', () => {
      if (!towerPanel) return;
      net.enterTowerFloor(towerPanel.eventId, i);
    });
    row.appendChild(btn);
    towerFloorListEl.appendChild(row);
  });
}

function refreshTowerRunHud() {
  if (!towerRun) {
    towerRunHudEl.style.display = 'none';
    return;
  }
  const bits = [];
  if (towerRun.requiredKills > 0) bits.push(`Kills ${Math.min(towerRun.kills, towerRun.requiredKills)}/${towerRun.requiredKills}`);
  if (towerRun.requiredMonsterId) bits.push(towerRun.bossDown ? 'Boss defeated' : 'Boss alive');
  if (towerRun.cleared) bits.push('✓ Cleared');
  towerRunLabelEl.innerHTML = '';
  const title = document.createElement('b');
  title.textContent = `Floor ${towerRun.floorIndex + 1} - ${towerRun.name}`;
  towerRunLabelEl.appendChild(title);
  if (bits.length) towerRunLabelEl.appendChild(document.createTextNode(` · ${bits.join(' · ')}`));
  towerRunHudEl.style.display = 'flex';
}

function showTowerPrompt({ hasNext, nextName, nextFloorNumber }) {
  document.getElementById('tower-prompt-title').textContent = hasNext ? 'Floor cleared!' : 'Tower conquered!';
  document.getElementById('tower-prompt-text').textContent = hasNext
    ? `Proceed to Floor ${nextFloorNumber} - ${nextName}?`
    : 'That was the final floor. Leave the tower?';
  const yesBtn = document.getElementById('tower-prompt-yes');
  yesBtn.textContent = hasNext ? 'Proceed' : 'Leave Tower';
  yesBtn.dataset.towerAction = hasNext ? 'next' : 'leave';
  towerPromptEl.style.display = 'block';
}
function hideTowerPrompt() {
  towerPromptEl.style.display = 'none';
}
/** Everything that has to reset when a run ends, however it ended (left voluntarily, died, instance auto-closed). */
function endTowerRunUI() {
  towerRun = null;
  hideTowerPrompt();
  refreshTowerRunHud();
}

document.getElementById('close-tower').addEventListener('click', closeTowerPanel);
document.getElementById('tower-leave-btn').addEventListener('click', () => net.leaveTower());
document.getElementById('tower-prompt-yes').addEventListener('click', (e) => {
  hideTowerPrompt();
  if (e.target.dataset.towerAction === 'leave') net.leaveTower();
  else net.towerNextFloor();
});
document.getElementById('tower-prompt-no').addEventListener('click', hideTowerPrompt);
const skillbookPanelEl = document.getElementById('skillbook-panel');
const skillbookListEl = document.getElementById('skillbook-list');
let skillbookOpen = false;

// --- Character Stats panel (spec: Global Stat Engine / Section 3) ---
const statsPanelEl = document.getElementById('stats-panel');
const statsListEl = document.getElementById('stats-list');
const statsPointsAvailableEl = document.getElementById('stats-points-available');
const statsDerivedEl = document.getElementById('stats-derived');
let statsPanelOpen = false;
let unassignedStatPoints = 0;
let allocatedStats = zeroStats(); // committed (server-confirmed) allocation
let pendingStatDelta = zeroStats(); // buffered, not-yet-applied clicks — spec Section 3.2's "Buffer State"
// The server's latest getPlayerDerivedStats() snapshot (armor, crit, hpRegen,
// etc, gear-inclusive) — arrives via 'stats-updated' (stat alloc + class
// pick) and 'equipment-result' (equip/unequip). Null until the first of
// those fires, which the Equipment panel's readout falls back to zeros for.
let playerDerived = null;

function classBaseStats() {
  return CLASSES[myCharacter?.classId]?.baseStats || zeroStats();
}

/** Client-side preview of what the Global Stat Engine derives from a stat total — mirrors src/sim/statDefs.js's computeDerivedStats formulas so the panel can show a live "would become" preview before Apply is pressed, without waiting on a round trip. */
function previewDerivedStats(totals) {
  const eff = (v) => {
    if (v <= 50) return v;
    const over = v - 50;
    let out = 50, remaining = over, step = 0;
    while (remaining > 0) {
      const chunk = Math.min(10, remaining);
      out += chunk * Math.max(0.1, 1 - 0.10 * (step + 1));
      remaining -= chunk; step += 1;
    }
    return out;
  };
  const vit = eff(totals.VIT), int_ = eff(totals.INT), wis = eff(totals.WIS), str = eff(totals.STR), agi = eff(totals.AGI), dex = eff(totals.DEX);
  return {
    maxHealthBonus: Math.round(vit * 10),
    physPower: (str * 1.5 + agi * 0.5).toFixed(1),
    spellPower: (int_ * 1.5).toFixed(1),
    healPower: (wis * 1.2).toFixed(1),
    critChance: (Math.min(0.6, dex * 0.0005) * 100).toFixed(1),
    dodgeChance: (Math.min(0.5, agi * 0.0004) * 100).toFixed(1),
    hpRegen: (vit * 0.15).toFixed(1),
  };
}

function refreshStatsPanel() {
  const base = classBaseStats();
  const pendingSpent = PRIMARY_STAT_IDS.reduce((sum, id) => sum + pendingStatDelta[id], 0);
  const remaining = unassignedStatPoints - pendingSpent;
  statsPointsAvailableEl.textContent = `Points Available: ${remaining}`;

  const totals = {};
  for (const id of PRIMARY_STAT_IDS) totals[id] = (base[id] || 0) + allocatedStats[id] + pendingStatDelta[id];

  statsListEl.innerHTML = PRIMARY_STAT_IDS.map((id) => {
    const committed = (base[id] || 0) + allocatedStats[id];
    const pending = pendingStatDelta[id];
    const total = committed + pending;
    const valueHtml = pending > 0 ? `${committed} <span class="stat-pending">+${pending}</span>` : `${total}`;
    const canPlus = remaining > 0 && total < STAT_HARD_CAP;
    const canMinus = pending > 0;
    return `<div class="stat-row">
      <div class="stat-name">${PRIMARY_STAT_NAMES[id]} (${id})</div>
      <div class="stat-value">${valueHtml}</div>
      <div class="stat-btns">
        <button data-stat-minus="${id}" ${canMinus ? '' : 'disabled'}>-</button>
        <button data-stat-plus="${id}" ${canPlus ? '' : 'disabled'}>+</button>
      </div>
    </div>`;
  }).join('');

  const d = previewDerivedStats(totals);
  statsDerivedEl.innerHTML = `
    <div>Max HP bonus: +${d.maxHealthBonus}</div>
    <div>Phys. Power: ${d.physPower} &nbsp; Spell Power: ${d.spellPower} &nbsp; Heal Power: ${d.healPower}</div>
    <div>Crit Chance: ${d.critChance}% &nbsp; Dodge Chance: ${d.dodgeChance}%</div>
    <div>HP Regen: ${d.hpRegen}/s</div>
  `;

  document.getElementById('stats-apply-btn').disabled = pendingSpent === 0;
  document.getElementById('stats-reset-btn').disabled = pendingSpent === 0;
}

statsListEl.addEventListener('click', (e) => {
  const plusStat = e.target.dataset.statPlus;
  const minusStat = e.target.dataset.statMinus;
  if (plusStat) pendingStatDelta[plusStat] += 1;
  if (minusStat) pendingStatDelta[minusStat] -= 1;
  if (plusStat || minusStat) refreshStatsPanel();
});
document.getElementById('stats-reset-btn').addEventListener('click', () => {
  pendingStatDelta = zeroStats();
  refreshStatsPanel();
});
document.getElementById('stats-apply-btn').addEventListener('click', () => {
  const delta = {};
  let any = false;
  for (const id of PRIMARY_STAT_IDS) {
    if (pendingStatDelta[id] > 0) { delta[id] = pendingStatDelta[id]; any = true; }
  }
  if (!any) return;
  net.allocateStatPoints(delta);
  pendingStatDelta = zeroStats(); // optimistic clear — onStatsUpdated (or onStatAllocationDenied) reconciles for real
  refreshStatsPanel();
});
document.getElementById('stats-respec-btn').addEventListener('click', () => {
  net.respecStats();
});
document.getElementById('close-stats').addEventListener('click', () => { statsPanelOpen = false; statsPanelEl.style.display = 'none'; });

// --- Equipment panel (gear slots + 3D preview + inventory grid) ---
// Mirrors the server's authoritative EquipmentState (src/sim/equipment.js) —
// every equip/unequip is a round trip (net.equipItem/unequipItem ->
// 'equipment-result'), never applied optimistically, since two-handed
// lockout/shield rules need the full item catalog to validate correctly
// and a wrong optimistic guess would have to un-animate itself.
const equipment = initEquipmentState();
const equipmentPanelEl = document.getElementById('equipment-panel');
const equipmentGridEl = document.getElementById('equipment-grid');
const equipmentStatsEl = document.getElementById('equipment-stats-readout');
let equipmentPanelOpen = false;

/** The local player's own cosmetic character params, with their currently-equipped weapon AND worn gear merged in — so the player sees their own held weapon and armor on their in-world body, not just in the Equipment panel's separate preview. */
function localCharacterWithLoadout() {
  return {
    ...myCharacter,
    equipmentOverride: equipmentToWeaponLoadout(equipment, authoredItemById),
    ...gearVisualParams(equipment),
  };
}

/**
 * (Re)builds the local player's OWN overhead plate. They never appear in
 * remoteMeshes — a client doesn't network itself to itself — so joining or
 * leaving a guild has to re-plate localMesh explicitly, or you'd be the one
 * player who can't see their own guild tag.
 */
function refreshLocalNameplate() {
  if (!localMesh) return;
  playerCharacters.set(localId, myCharacter);
  attachPlayerNameplate(localId, localMesh);
}

/** Rebuilds the local player's in-world mesh in place after an equip/unequip — mirrors onPlayerCharacter's remote-rebuild pattern, since a weapon can't hot-swap onto an already-built rig. */
function rebuildLocalMesh() {
  if (!localMesh) return;
  const old = localMesh;
  localMesh = buildPlayerMesh(localCharacterWithLoadout());
  localMesh.position.copy(old.position);
  localMesh.rotation.copy(old.rotation);
  scene.remove(old);
  scene.add(localMesh);
  refreshLocalNameplate(); // the plate was a child of the mesh that just got thrown away
}

const EQUIP_SLOT_LABELS = {
  head: 'Head', neck: 'Neck', chest: 'Chest', gloves: 'Gloves', pants: 'Pants', shoes: 'Shoes',
  ring1: 'Ring 1', ring2: 'Ring 2', earring1: 'Earring 1', earring2: 'Earring 2',
  mainHand: 'Main Hand', offHand: 'Off Hand',
};

function refreshEquipmentSlots() {
  for (const slot of EQUIP_SLOT_IDS) {
    const el = document.getElementById(`equip-slot-${slot}`);
    if (!el) continue;
    const itemId = equipment[slot];
    if (itemId) {
      const { name, iconUrl } = resolveItemDisplay(itemId);
      el.innerHTML = iconUrl ? `<img src="${iconUrl}" alt="" />` : `<span class="equip-slot-fallback">${name.slice(0, 2).toUpperCase()}</span>`;
      el.title = `${name} — click to unequip`;
      el.classList.add('filled');
    } else {
      el.innerHTML = '';
      el.title = EQUIP_SLOT_LABELS[slot];
      el.classList.remove('filled');
    }
  }
}

// A dense fixed-size bag grid (Dennis's own mockup — 8 columns, enough rows
// to read as a real inventory even mostly empty), not sized to what's
// actually owned. There's no real bag-capacity limit server-side; this is a
// purely visual slot count, padded up if someone genuinely owns more
// distinct item types than fit.
const INVENTORY_GRID_MIN_SLOTS = 80;

function refreshEquipmentGrid() {
  const entries = Object.entries(inventory).filter(([, qty]) => qty > 0);
  const slotCount = Math.max(INVENTORY_GRID_MIN_SLOTS, entries.length);
  const cells = entries.map(([itemId, qty]) => {
    const { name, iconUrl } = resolveItemDisplay(itemId);
    const authored = authoredItemById[itemId];
    const equippable = authored && (authored.type === 'weapon' || authored.type === 'armor');
    return `<div class="equip-grid-cell${equippable ? ' equippable' : ''}" data-item="${itemId}" title="${name}${equippable ? ' (click to equip)' : ''}">
      ${iconUrl ? `<img src="${iconUrl}" alt="" />` : `<span class="equip-grid-fallback">${name.slice(0, 2).toUpperCase()}</span>`}
      <span class="equip-grid-qty">${qty}</span>
    </div>`;
  });
  for (let i = entries.length; i < slotCount; i++) cells.push('<div class="equip-grid-cell"></div>');
  equipmentGridEl.innerHTML = cells.join('');
}

function refreshEquipmentStatsReadout() {
  const d = playerDerived;
  // playerDerived.raw already includes gear's primary-stat contribution
  // (src/sim/leveling.js's computeCharacterDerivedStats folds it into
  // totalStats server-side) — prefer that so equipping a STR ring actually
  // moves this number; fall back to the base+allocated-only calc before the
  // first server round trip has landed.
  const base = classBaseStats();
  const totals = d?.raw || {};
  for (const id of PRIMARY_STAT_IDS) if (totals[id] === undefined) totals[id] = (base[id] || 0) + allocatedStats[id];
  const className = CLASS_META[myCharacter?.classId]?.name || myCharacter?.classId || '';
  document.getElementById('equip-level').textContent = xpUI.level;
  document.getElementById('equip-classname').textContent = className;
  document.getElementById('equip-gold-display').textContent = `Gold: ${gold}`;
  equipmentStatsEl.innerHTML = `
    <div class="equip-stats-col">
      <div>STR ${totals.STR}</div><div>AGI ${totals.AGI}</div><div>DEX ${totals.DEX}</div>
      <div>INT ${totals.INT}</div><div>WIS ${totals.WIS}</div><div>VIT ${totals.VIT}</div>
    </div>
    <div class="equip-stats-col">
      <div>Armor ${d ? Math.round(d.physDefense) : '—'}</div>
      <div>Crit ${d ? (d.critChance * 100).toFixed(1) : '—'}%</div>
      <div>HP Regen ${d ? d.hpRegen.toFixed(1) : '—'}/s</div>
      <div>MP Regen ${d ? d.mpRegen.toFixed(1) : '—'}/s</div>
    </div>
  `;
}

// --- 3D preview: reuses the exact character-creation.html pattern (own
// isolated Scene/Camera/Renderer, buildPlayerCharacter, drag/auto-rotate)
// scaled down to panel size. It's fed by localCharacterWithLoadout(), the same
// params the in-world body is built from, so equipping anything with a visual —
// a weapon in the hand, an armor piece authored in the Equipment Builder
// (src/sim/gearVisuals.js), an enchantment glow on either — changes this
// preview and the character walking around outside identically.
let equipPreviewRenderer = null, equipPreviewScene = null, equipPreviewCamera = null, equipPreviewMesh = null;
let equipPreviewRotY = 0, equipPreviewDragging = false, equipPreviewLastX = 0, equipPreviewAutoRotate = true;

function ensureEquipPreview() {
  if (equipPreviewRenderer) return;
  const canvas = document.getElementById('equipment-preview-canvas');
  equipPreviewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  equipPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  equipPreviewScene = new THREE.Scene();
  equipPreviewScene.add(new THREE.HemisphereLight(0xffffff, 0x2a2015, 1.2));
  const key = new THREE.DirectionalLight(0xfff2d0, 1.0);
  key.position.set(3, 6, 4);
  equipPreviewScene.add(key);
  equipPreviewCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 50);
  equipPreviewCamera.position.set(0, 1.05, 3.2);
  equipPreviewCamera.lookAt(0, 0.9, 0);
  canvas.addEventListener('pointerdown', (e) => { equipPreviewDragging = true; equipPreviewLastX = e.clientX; equipPreviewAutoRotate = false; });
  window.addEventListener('pointerup', () => { equipPreviewDragging = false; });
  window.addEventListener('pointermove', (e) => {
    if (!equipPreviewDragging) return;
    equipPreviewRotY += (e.clientX - equipPreviewLastX) * 0.01;
    equipPreviewLastX = e.clientX;
    if (equipPreviewMesh) equipPreviewMesh.rotation.y = equipPreviewRotY;
  });
}

function rebuildEquipPreview() {
  ensureEquipPreview();
  if (equipPreviewMesh) equipPreviewScene.remove(equipPreviewMesh);
  equipPreviewMesh = buildPlayerCharacter(characterTypeCatalog, myCharacter.classId, localCharacterWithLoadout());
  equipPreviewMesh.rotation.y = equipPreviewRotY;
  equipPreviewScene.add(equipPreviewMesh);
}

function animateEquipPreview() {
  if (!equipmentPanelOpen) return;
  requestAnimationFrame(animateEquipPreview);
  const canvas = document.getElementById('equipment-preview-canvas');
  const w = canvas.clientWidth || 260, h = canvas.clientHeight || 320;
  if (canvas.width !== w || canvas.height !== h) {
    equipPreviewRenderer.setSize(w, h, false);
    equipPreviewCamera.aspect = w / h;
    equipPreviewCamera.updateProjectionMatrix();
  }
  if (equipPreviewAutoRotate && equipPreviewMesh) {
    equipPreviewRotY += 0.006;
    equipPreviewMesh.rotation.y = equipPreviewRotY;
  }
  // Idle-ticked so an enchantment's glow breathes here too — updateWalkCycle
  // owns the aura animation (see updateGearAuras there), and a preview that
  // held a dead-still glow would misrepresent what the piece looks like in
  // the world, which is the whole point of previewing it.
  if (equipPreviewMesh) updateWalkCycle(equipPreviewMesh, false, performance.now() / 1000, 1 / 60);
  equipPreviewRenderer.render(equipPreviewScene, equipPreviewCamera);
}

function openEquipmentPanel() {
  equipmentPanelOpen = true;
  equipmentPanelEl.style.display = 'flex';
  refreshEquipmentSlots();
  refreshEquipmentGrid();
  refreshEquipmentStatsReadout();
  rebuildEquipPreview();
  animateEquipPreview();
}
function closeEquipmentPanel() {
  equipmentPanelOpen = false;
  equipmentPanelEl.style.display = 'none';
}
document.getElementById('close-equipment').addEventListener('click', closeEquipmentPanel);

equipmentPanelEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-slot]');
  if (!btn) return;
  const slot = btn.dataset.slot;
  if (equipment[slot]) net.unequipItem(slot);
});
equipmentGridEl.addEventListener('click', (e) => {
  const cell = e.target.closest('[data-item]');
  if (!cell) return;
  const itemId = cell.dataset.item;
  const authored = authoredItemById[itemId];
  if (authored && (authored.type === 'weapon' || authored.type === 'armor')) net.equipItem(itemId);
  else net.useItem(itemId); // consumable/misc — server no-ops safely if it isn't actually usable
});

function refreshGoldUI() {
  if (equipmentPanelOpen) refreshEquipmentStatsReadout(); // the Equipment panel's gold display is the only one now
}

/** Every recipe for the station currently open, gated on level and reagents — a locked recipe still shows (with its reason) rather than disappearing, so a player can see what's coming. */
function refreshCraftPanel() {
  const station = activeCraftingStationTypeId ? craftingStationTypesById.get(activeCraftingStationTypeId) : null;
  const recipesForStation = station
    ? [...recipeCatalog.values()].filter((r) => r.requiredStationTypeId === activeCraftingStationTypeId)
    : [];
  craftListEl.innerHTML = recipesForStation.length
    ? recipesForStation.map((recipe) => {
        const profState = professions[recipe.profession] || { level: 1, xp: 0 };
        const levelOk = profState.level >= recipe.requiredSkillLevel;
        const afford = canAffordReagents(inventory, recipe);
        const reagentText = recipe.reagents.map((r) => {
          const owned = inventory[r.itemId] || 0;
          const short = owned < r.quantity;
          return `<span${short ? ' class="reagent-short"' : ''}>${owned}/${r.quantity} ${resolveItemDisplay(r.itemId).name}</span>`;
        }).join(', ');
        const lockReason = !levelOk ? `Requires ${recipe.profession} level ${recipe.requiredSkillLevel}` : (!afford ? 'Missing reagents' : '');
        const craftable = levelOk && afford;
        return `<div class="craft-recipe">
          <div><div>${recipe.name}</div><div class="cost">${reagentText}</div>${lockReason ? `<div class="cost" style="color:#c86;">${lockReason}</div>` : ''}</div>
          <button data-craft="${recipe.id}" ${craftable ? '' : 'disabled'}>Craft</button>
        </div>`;
      }).join('')
    : '<div style="color:#888">Nothing craftable here yet</div>';

  const professionsEl = document.getElementById('craft-professions');
  if (station) {
    professionsEl.innerHTML = station.professions.map((profId) => {
      const state = professions[profId] || { level: 1, xp: 0 };
      const needed = xpForProfessionLevel(state.level);
      const pct = Math.min(100, Math.round((state.xp / needed) * 100));
      return `<div class="profession-bar-row">${profId} — Level ${state.level}
        <div class="profession-bar-track"><div class="profession-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  } else {
    professionsEl.innerHTML = '';
  }
}

/** Opens the Crafting Station panel — mirrors openMerchantPanel, triggered by the openCraftingStation event effect (see onEventStep below). */
function openCraftingStationPanel(stationTypeId) {
  activeCraftingStationTypeId = stationTypeId;
  craftBatchQueue = [];
  craftPanelOpen = true;
  craftPanelEl.style.display = 'block';
  refreshCraftPanel();
}
function closeCraftingStationPanel() {
  craftPanelOpen = false;
  activeCraftingStationTypeId = null;
  craftBatchQueue = [];
  craftPanelEl.style.display = 'none';
}

function refreshVendorPanel() {
  // The general store only ever deals in the hardcoded materials catalog
  // (src/sim/items.js) — an authored gear/quest item (now genuinely
  // reachable in inventory via loot/equip) isn't in it, so getItemDef
  // throws. Filter those out rather than let one unrecognized item crash
  // the whole panel (and, since this runs inside onWelcome via
  // syncInventoryUI, potentially abort the entire connect sequence).
  const sellableEntries = Object.entries(inventory).filter(([itemId, qty]) => {
    if (qty <= 0) return false;
    try { getItemDef(itemId); return true; } catch { return false; }
  });
  vendorListEl.innerHTML = sellableEntries.length
    ? sellableEntries.map(([itemId, qty]) => {
        const def = getItemDef(itemId);
        return `<div class="vendor-row">
          <div>${def.name} x${qty}</div>
          <button data-sell="${itemId}">Sell 1 (${def.sellPrice}g)</button>
        </div>`;
      }).join('')
    : '<div style="color:#888">Nothing to sell</div>';
}

/** Every skill the player's class owns — locked ones stay listed (greyed, with
 * their unlock level) so a player can see what's coming, not just what they have. */
function refreshSkillbookPanel() {
  skillbookListEl.innerHTML = classDef.abilities.map((ability) => {
    const locked = xpUI.level < (ability.requiredLevel || 1);
    const isUploadedIcon = typeof ability.icon === 'string' && /^(\/|https?:)/.test(ability.icon);
    const iconHtml = isUploadedIcon ? `<img class="ability-icon" src="${ability.icon}" alt="" />` : `<span class="skillbook-icon">${ability.icon || '✦'}</span>`;
    const rank = effectiveRankForLevel(ability, xpUI.level);
    const rankSuffix = rank > 1 ? ` — Rank ${rank}` : '';
    const meta = locked
      ? `🔒 Unlocks at level ${ability.requiredLevel}`
      : `Cost ${ability.cost} · Cooldown ${(ability.cooldownMs / 1000).toFixed(1)}s`;
    return `<div class="skillbook-row${locked ? ' locked' : ''}">
      ${iconHtml}
      <div>
        <div class="skillbook-name">${ability.name}${rankSuffix}</div>
        <div class="skillbook-desc">${ability.description || ''}</div>
        <div class="skillbook-meta">${meta}</div>
      </div>
    </div>`;
  }).join('');
}

craftListEl.addEventListener('click', (e) => {
  const recipeId = e.target.dataset.craft;
  if (recipeId) net.craft(recipeId, 1);
});
vendorListEl.addEventListener('click', (e) => {
  const itemId = e.target.dataset.sell;
  if (itemId) net.sellItem(itemId, 1);
});
document.getElementById('close-craft').addEventListener('click', closeCraftingStationPanel);
document.getElementById('craft-batch-btn').addEventListener('click', () => {
  // "Max" quantity for whatever recipe is currently selected isn't tracked
  // separately in this v1 layout (no per-row quantity stepper yet) — Craft
  // All queues up as many of the FIRST craftable recipe as the player can
  // currently afford, a simple, honest reading of "craft all you can" until
  // a per-recipe quantity UI exists.
  if (!activeCraftingStationTypeId) return;
  const recipe = [...recipeCatalog.values()].find((r) => {
    if (r.requiredStationTypeId !== activeCraftingStationTypeId) return false;
    const profState = professions[r.profession] || { level: 1, xp: 0 };
    return profState.level >= r.requiredSkillLevel && canAffordReagents(inventory, r);
  });
  if (!recipe) return;
  const maxCount = Math.min(...recipe.reagents.map((r) => Math.floor((inventory[r.itemId] || 0) / r.quantity)));
  if (maxCount < 1) return;
  craftBatchQueue = Array(maxCount).fill(recipe.id);
  net.craft(recipe.id, 1);
});
document.getElementById('close-vendor').addEventListener('click', () => { vendorPanelOpen = false; vendorPanelEl.style.display = 'none'; });
document.getElementById('close-skillbook').addEventListener('click', () => { skillbookOpen = false; skillbookPanelEl.style.display = 'none'; });

/** Nearest teleporter (in `activeTeleporters` — whichever map is currently active) within trigger range, or null. */
function findNearestTeleporter() {
  if (!predicted) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const t of activeTeleporters) {
    const d = distanceXZ(predicted.position, t.position);
    if (d <= TELEPORTER_TRIGGER_RANGE && d < nearestDist) {
      nearestDist = d;
      nearest = t;
    }
  }
  return nearest;
}

/** Nearest gathering node within range that isn't currently on cooldown, or null. */
function findNearestGatherNode() {
  if (!predicted || !world) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const node of world.gatheringNodes || []) {
    const d = distanceXZ(predicted.position, node.position);
    if (d <= GATHER_RANGE && d < nearestDist) {
      nearestDist = d;
      nearest = node;
    }
  }
  return nearest;
}

/** Nearest standalone (not NPC-attached — talkToNpc already covers those) talk/interact Event Object within range that's visible and not already completed, or null. Mirrors findNearestNpc/findNearestTeleporter's shape. Range is whatever the event authored (a `range` box, else the shared default circle) — isPointInEventRange is the SAME function the server gates on, so the prompt can never appear a step outside what the server will accept. */
function findNearestEventObject() {
  if (!predicted) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const ev of activeEventObjects) {
    if (ev.attachedType === 'npc') continue; // handled by talkToNpc instead
    if ((ev.start.type !== 'talk' && ev.start.type !== 'interact')) continue;
    if (eventObjectVisibility.get(ev.id) === false) continue;
    if (!isPointInEventRange(ev, predicted.position)) continue;
    // Still nearest-wins when two volumes overlap; distance to the centre is
    // the tie-break, which is all it ever was.
    const d = distanceXZ(predicted.position, ev.position);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = ev;
    }
  }
  return nearest;
}

const NPC_TALK_RANGE = 4;

/** Nearest NPC within talk range (by live mesh position), or null. Returns { id, mesh }. */
function findNearestNpc() {
  if (!predicted) return null;
  let nearest = null;
  let nearestDist = Infinity;
  for (const [id, mesh] of overworldNpcMeshes) {
    const d = distanceXZ(predicted.position, mesh.position);
    if (d <= NPC_TALK_RANGE && d < nearestDist) {
      nearestDist = d;
      nearest = { id, mesh };
    }
  }
  return nearest;
}

// --- NPC dialog box ---
const npcDialogEl = document.getElementById('npc-dialog');
const npcDialogNameEl = document.getElementById('npc-dialog-name');
const npcDialogTextEl = document.getElementById('npc-dialog-text');
const npcDialogChoicesEl = document.getElementById('npc-dialog-choices');
const npcDialogQuestsEl = document.getElementById('npc-dialog-quests');
const npcDialogHintEl = document.getElementById('npc-dialog-hint');
let dialogNpcId = null;   // id of the NPC currently being talked to, or null
let dialogLineIndex = 0;  // linear dialog[] NPCs only
let dialogNodeId = null;  // dialogTree NPCs only — id of the currently-shown node

// --- Quests ---
const questCatalog = new Map(); // questId -> quest def (from welcome)
let questState = { active: {}, completed: {} }; // mirrors server; authoritative copy lives server-side
/** @type {Object<string, {name:string, description:string, objectiveText:string, status:'active'|'complete'}>} questId -> entry — a SEPARATE, event-script-driven namespace from questState above (see src/sim/events.js's startQuest doc comment); mirrors server, kept in sync via onEventStep's effects loop */
let eventQuestLog = {};
/** Mirrors player.eventState.switches (server-authoritative) — needed client-side so computeNpcQuestStatus can evaluate a quest's requiredSwitch gate for the head-icon. Seeded from onWelcome, kept in sync via onEventStep's setSwitch effects below. */
let eventSwitches = {};
let currentNpcQuests = { offers: [], turnIns: [] }; // latest offers/turn-ins for the open dialog NPC

// --- Crafting (src/sim/recipes.js, src/sim/craftResolution.js) ---
const recipeCatalog = new Map(); // recipeId -> recipe def (from welcome)
const craftingStationTypesById = new Map(); // stationTypeId -> {id,name,professions,visualPropType} (from welcome)
let professions = {}; // {professionId: {level,xp}} — mirrors server, see src/sim/professionLeveling.js
let activeCraftingStationTypeId = null; // set by the openCraftingStation event effect (onEventStep), cleared on panel close
let craftBatchQueue = []; // recipeIds queued for the current "Craft All" run — advanced one at a time by incoming craft-result events, so a rejection or walking away truncates cleanly

function objectiveGoal(quest) {
  return quest.objective.type === 'talk' ? 1 : quest.objective.count;
}

/**
 * This NPC's head-icon quest state — 'ready' (yellow ?, something to turn
 * in) beats 'available' (yellow !, something new to accept — only true once
 * the player's level meets the quest's minLevel, see canAccept) beats
 * 'active' (grey ?, working on it but not there yet) beats null (nothing to
 * show). Recomputed every frame in animate() — cheap (a handful of
 * NPCs/quests), simpler than wiring change-detection through every event
 * that can affect it (accept, kill, gather, talk, turn-in, level-up).
 */
function computeNpcQuestStatus(npcId) {
  let hasReady = false, hasAvailable = false, hasActive = false;
  for (const quest of questCatalog.values()) {
    // Offering and turning in are two different NPCs for a `turnInAtTarget`
    // talk-quest, so each half asks the NPC that actually owns it. That's
    // what makes the giver drop its icon the instant you accept (its job is
    // done) while the ? appears over the NPC you were sent to.
    if (questState.active[quest.id]) {
      if (turnInNpcId(quest) !== npcId) continue;
      if (isReadyToTurnIn(questState, quest, inventory)) hasReady = true;
      else hasActive = true;
    } else if (quest.giverNpcId === npcId && canAccept(questState, quest, xpUI.level, eventSwitches)) {
      hasAvailable = true;
    }
  }
  if (hasReady) return 'ready';
  if (hasAvailable) return 'available';
  if (hasActive) return 'active';
  return null;
}

/** Human progress label for a quest given local state (gather reads the inventory mirror; kill/talk read tracked progress). */
function questProgressText(quest) {
  const o = quest.objective;
  if (o.type === 'gather') return `${Math.min(o.count, inventory[o.target] || 0)}/${o.count} gathered`;
  const p = questState.active[quest.id]?.progress || 0;
  if (o.type === 'talk') return p >= 1 ? 'ready' : 'not yet visited';
  return `${p}/${o.count} slain`;
}

function closeDialog() {
  dialogNpcId = null;
  dialogNodeId = null;
  activeEventId = null;
  currentNpcQuests = { offers: [], turnIns: [] };
  npcDialogQuestsEl.innerHTML = '';
  npcDialogChoicesEl.innerHTML = '';
  npcDialogEl.style.display = 'none';
}

/**
 * Renders one Event Object script step's dialog into the SAME dialog box a
 * dialogTree NPC uses — reuses npcDialogEl/npcDialogTextEl/npcDialogChoicesEl
 * wholesale, just wiring choice-clicks to net.eventChoice instead of a
 * dialogTree next-lookup (see the npcDialogChoicesEl click listener below).
 * Called from onEventStep whenever the payload carries a `dialog` field.
 * `done && !dialog` (a script that ends without a final dialog line) just
 * closes the box instead of leaving stale text showing.
 */
function openEventDialogStep({ eventId, dialog, done }) {
  activeEventId = eventId;
  if (!dialog) {
    if (done) closeDialog();
    return;
  }
  npcDialogNameEl.textContent = '';
  npcDialogTextEl.textContent = dialog.text;
  npcDialogChoicesEl.innerHTML = (dialog.choices || [])
    .map((c, i) => `<button data-choice-index="${i}">${c.text}</button>`)
    .join('');
  npcDialogHintEl.textContent = dialog.choices?.length ? 'Choose a response' : (done ? 'Press E to close' : 'Press E to continue');
  npcDialogEl.style.display = 'block';
}

/** Renders a dialogTree node's text + its choice buttons (if any) into the open dialog box. */
function openDialogTreeNode(def, nodeId) {
  const tree = def.dialogTree;
  const node = tree.nodes.find((n) => n.id === nodeId) || tree.nodes.find((n) => n.id === tree.start);
  dialogNodeId = node.id;
  npcDialogNameEl.textContent = def.name || 'NPC';
  npcDialogTextEl.textContent = node.text;
  npcDialogChoicesEl.innerHTML = (node.choices || [])
    .map((c, i) => `<button data-choice-index="${i}">${c.text}</button>`)
    .join('');
  npcDialogHintEl.textContent = node.choices?.length ? 'Choose a response' : 'Press E to close';
  npcDialogEl.style.display = 'block';
}

npcDialogChoicesEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.choiceIndex;
  if (idx === undefined) return;
  if (activeEventId != null) {
    net.eventChoice(activeEventId, parseInt(idx, 10));
    npcDialogChoicesEl.innerHTML = ''; // wait for the server's next event-step rather than leaving stale buttons clickable
    return;
  }
  if (dialogNpcId == null) return;
  const def = npcDefs.get(dialogNpcId);
  const node = def?.dialogTree?.nodes.find((n) => n.id === dialogNodeId);
  const choice = node?.choices?.[parseInt(idx, 10)];
  if (!choice) return;
  if (choice.acceptQuestId) net.acceptQuest(choice.acceptQuestId);
  if (choice.next) openDialogTreeNode(def, choice.next);
  else closeDialog();
});

/**
 * Open dialog on `npcId`, or advance it if already open on that NPC.
 * Branches on whether the NPC has a dialogTree: tree NPCs render choice
 * buttons and only close on E once the current node has none left to click;
 * everything else is the original linear dialog[]-array behavior, advancing
 * one line per E press and closing past the last line.
 */
/** The Event Object attached to this NPC (attachedType:'npc'), if any — takes over from dialogTree/dialog entirely, same "either/or, never both" rule the World Editor's Attach Event button enforces. */
function eventAttachedToNpc(npcId) {
  return activeEventObjects.find((e) => e.attachedType === 'npc' && e.attachedId === npcId);
}

function talkToNpc(npcId) {
  const attachedEvent = eventAttachedToNpc(npcId);
  if (attachedEvent) {
    if (activeEventId === attachedEvent.id) {
      // Script already ran its synchronous steps and is showing its last
      // dialog line with no choices pending — E just closes it. While a
      // choice is showing, E does nothing; the player must click one.
      if (!npcDialogChoicesEl.children.length) closeDialog();
      return;
    }
    if (eventObjectVisibility.get(attachedEvent.id) === false) return;
    net.startEvent(attachedEvent.id);
    return;
  }

  const def = npcDefs.get(npcId);
  if (def?.dialogTree) {
    if (dialogNpcId !== npcId) {
      dialogNpcId = npcId;
      currentNpcQuests = { offers: [], turnIns: [] };
      npcDialogQuestsEl.innerHTML = '';
      net.talkNpc(npcId); // ask the server what this NPC can offer / accept as turn-in
      openDialogTreeNode(def, def.dialogTree.start);
    } else if (!def.dialogTree.nodes.find((n) => n.id === dialogNodeId)?.choices?.length) {
      closeDialog(); // a leaf node (no choices) — E just closes, same as running off the end of a linear dialog
    }
    // else: a node with choices is showing — E does nothing, must click one
    return;
  }

  const lines = def?.dialog?.length ? def.dialog : ['...'];
  if (dialogNpcId !== npcId) {
    dialogNpcId = npcId;
    dialogLineIndex = 0;
    currentNpcQuests = { offers: [], turnIns: [] };
    npcDialogQuestsEl.innerHTML = '';
    net.talkNpc(npcId); // ask the server what this NPC can offer / accept as turn-in
  } else {
    dialogLineIndex += 1;
    if (dialogLineIndex >= lines.length) {
      closeDialog();
      return;
    }
  }
  npcDialogNameEl.textContent = def?.name || 'NPC';
  npcDialogTextEl.textContent = lines[dialogLineIndex];
  npcDialogHintEl.textContent = dialogLineIndex < lines.length - 1 ? 'Press E to continue' : 'Press E to close';
  npcDialogEl.style.display = 'block';
}

/** Render the Accept / Turn-in quest buttons inside the open dialog box from the server's latest npc-quests reply. */
function renderDialogQuests() {
  const { offers, turnIns } = currentNpcQuests;
  npcDialogQuestsEl.innerHTML = [
    ...turnIns.map(
      (q) => `<div class="quest-offer"><div class="q-title">✔ ${q.name}</div><div class="q-obj">Ready to turn in</div><button class="turn-in" data-turn-in-quest="${q.id}">Turn in</button></div>`
    ),
    ...offers.map(
      (q) => `<div class="quest-offer"><div class="q-title">! ${q.name}</div><div class="q-obj">${q.description || ''}</div><button data-accept-quest="${q.id}">Accept</button></div>`
    ),
  ].join('');
}

npcDialogQuestsEl.addEventListener('click', (e) => {
  const accept = e.target.dataset.acceptQuest;
  const turnIn = e.target.dataset.turnInQuest;
  if (accept) { net.acceptQuest(accept); e.target.closest('.quest-offer')?.remove(); }
  if (turnIn) { net.turnInQuest(turnIn); e.target.closest('.quest-offer')?.remove(); }
});

// --- Quest log panel ---
const questLogEl = document.getElementById('quest-log');
const questLogListEl = document.getElementById('quest-log-list');
let questLogOpen = false;

function refreshQuestLog() {
  const active = Object.keys(questState.active);
  const oldSystemHtml = active
    .map((id) => {
      const q = questCatalog.get(id);
      if (!q) return '';
      const ready = q.objective.type === 'gather'
        ? (inventory[q.objective.target] || 0) >= q.objective.count
        : (questState.active[id]?.progress || 0) >= objectiveGoal(q);
      return `<div class="quest-log-entry${ready ? ' ready' : ''}"><div class="q-title">${q.name}</div><div class="q-progress">${questProgressText(q)}${ready ? ' — return to turn in' : ''}</div></div>`;
    })
    .join('');
  // Event Editor-driven quests (src/sim/events.js's startQuest/updateQuestObjective/
  // completeQuest) — a separate namespace from the old system above, shown in
  // the same panel so a player never needs to know which system authored a quest.
  // Completed entries stay listed, below the active ones, whenever the author
  // gave completeQuest a closing line — otherwise finishing a quest made its
  // entry vanish mid-sentence with nothing to read.
  const eventQuests = Object.values(eventQuestLog);
  const eventQuestHtml = eventQuests
    .filter((q) => q.status === 'active')
    .map((q) => `<div class="quest-log-entry"><div class="q-title">${q.name}</div><div class="q-progress">${q.objectiveText || ''}</div></div>`)
    .join('')
    + eventQuests
      .filter((q) => q.status === 'complete' && q.objectiveText)
      .map((q) => `<div class="quest-log-entry done"><div class="q-title">${q.name} ✓</div><div class="q-progress">${q.objectiveText}</div></div>`)
      .join('');
  const combined = oldSystemHtml + eventQuestHtml;
  questLogListEl.innerHTML = combined || '<div style="color:#889">No active quests. Talk to townsfolk with a ! above them.</div>';
}

// --- Party ---
const partyPanelEl = document.getElementById('party-panel');
const partyMembersEl = document.getElementById('party-members');
const partyInvitePromptEl = document.getElementById('party-invite-prompt');
let partyMembers = []; // [{id, name, classId, isLeader}]
let pendingPartyInvite = null; // { partyId, inviterLabel } — accept with Y
/** @type {Map<string, {health:number, maxHealth:number}>} every seen player's latest HP, for party member bars */
const playerHealth = new Map();
const PARTY_INVITE_RANGE = 8; // mirrors server PARTY_INVITE_RANGE

function refreshPartyPanel() {
  if (!partyMembers.length) {
    partyPanelEl.style.display = 'none';
    return;
  }
  partyPanelEl.style.display = 'block';
  partyMembersEl.innerHTML = partyMembers
    .map((m) => {
      const label = m.name || (m.classId ? m.classId[0].toUpperCase() + m.classId.slice(1) : 'Adventurer');
      const isMe = m.id === localId;
      const hp = m.id === localId ? healthUI : playerHealth.get(m.id);
      const pct = hp ? Math.max(0, (hp.health / hp.maxHealth) * 100) : 100;
      return `<div class="party-member"><div class="pm-name"><span>${label}${isMe ? ' (you)' : ''}</span>${m.isLeader ? '<span class="pm-leader">★</span>' : ''}</div><div class="pm-hp-wrap"><div class="pm-hp-fill" style="width:${pct}%"></div></div></div>`;
    })
    .join('');
}

/** Nearest other overworld player within party-invite range, or null. */
function findNearestRemotePlayer() {
  if (!predicted || inTower || inStore) return null;
  let nearestId = null;
  let nearestDist = Infinity;
  for (const [id, mesh] of remoteMeshes) {
    const d = distanceXZ(predicted.position, mesh.position);
    if (d <= PARTY_INVITE_RANGE && d < nearestDist) {
      nearestDist = d;
      nearestId = id;
    }
  }
  return nearestId;
}

document.getElementById('party-leave-btn').addEventListener('click', () => net.leaveParty());

// --- Guilds -----------------------------------------------------------------
//
// One panel, five tabs, all rendered from the single 'guild-state' payload the
// server pushes after every change. Nothing here decides what a player is
// ALLOWED to do — `guildState.permissions` is resolved server-side and every
// handler re-checks it — this only decides what to draw.
const guildPanelEl = document.getElementById('guild-panel');
const guildBodyEl = document.getElementById('guild-body');
const guildErrorEl = document.getElementById('guild-error');
const guildInvitePromptEl = document.getElementById('guild-invite-prompt');
const guildBuffBannerEl = document.getElementById('guild-buff-banner');

let guildPanelOpen = false;
let guildTab = 'roster';
/** Last 'guild-state' payload: { guild, permissions, myAccountId, myRankId, canFound, buffCatalog }. */
let guildState = { guild: null, permissions: {}, canFound: false, buffCatalog: [] };
/** Working copy of the rank table while the Ranks tab is open — edits are local until "Save ranks", so a half-typed rank name never reaches the server. */
let guildRankDraft = null;

/** Permission ids -> the label the Ranks tab shows. Mirrors src/sim/guilds.js's GUILD_PERMISSIONS, kept as a plain table here so the game client doesn't import the sim module just for prose. */
const GUILD_PERMISSION_LABELS = {
  invite: 'Invite members',
  kick: 'Kick members',
  promote: 'Change ranks',
  editRanks: 'Edit ranks',
  bankDeposit: 'Bank: deposit',
  bankWithdraw: 'Bank: withdraw',
  buyBuffs: 'Buy guild buffs',
  editGuild: 'Edit guild',
};

const GUILD_EFFECT_LABELS = { xp: 'XP', craftXp: 'Crafting XP', damage: 'Damage', defense: 'Damage reduction', gold: 'Gold' };

/** HTML-escapes anything player-authored (guild names, member names, MOTDs) before it goes near innerHTML. */
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** "1h 12m" / "4m 30s" — buff timers, which people read as "is it worth re-buying yet". */
function formatGuildDuration(ms) {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const sec = totalSeconds % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/** The panel's one status line. `tone` only colours it — 'ok' for confirmations (invite sent), the default for refusals. */
function showGuildError(text, tone = 'error') {
  guildErrorEl.textContent = text || '';
  guildErrorEl.classList.toggle('ok', tone === 'ok');
}

function openGuildPanel() {
  guildPanelOpen = true;
  guildPanelEl.style.display = 'block';
  net?.requestGuild(); // a guildmate may have changed things since the last push
  refreshGuildPanel();
}

function closeGuildPanel() {
  guildPanelOpen = false;
  guildPanelEl.style.display = 'none';
  guildRankDraft = null;
  showGuildError('');
}

document.getElementById('close-guild').addEventListener('click', closeGuildPanel);

function guildCrestHtml(guild, cls = 'guild-crest') {
  return guild?.logoUrl
    ? `<img class="${cls}" src="${esc(guild.logoUrl)}" alt="" />`
    : `<div class="${cls} empty">🛡</div>`;
}

function refreshGuildPanel() {
  if (!guildPanelOpen) return;
  const { guild } = guildState;
  if (!guild) {
    guildBodyEl.innerHTML = `
      <div class="guild-section-title">No guild</div>
      <div class="guild-empty">${guildState.canFound
        ? 'Found your own guild, or get an invite from someone already in one.'
        : 'Guilds are tied to an account — sign in from the home page to join or found one.'}</div>
      ${guildState.canFound ? `
        <div class="guild-form">
          <input type="text" id="guild-create-name" maxlength="24" placeholder="Guild name" />
          <button class="rb-btn" data-act="create">Found guild</button>
        </div>` : ''}`;
    return;
  }

  const tabs = [['roster', 'Roster'], ['bank', 'Bank'], ['buffs', 'Buffs'], ['ranks', 'Ranks'], ['settings', 'Settings']];
  guildBodyEl.innerHTML = `
    <div class="guild-head">
      ${guildCrestHtml(guild)}
      <div class="guild-head-meta">
        <div class="gh-name">${esc(guild.name)}</div>
        <div class="gh-sub">${guild.members.length}/${guild.maxMembers} members · ${guild.bank.gold.toLocaleString()}g in the bank</div>
        ${guild.motd ? `<div class="gh-sub">${esc(guild.motd)}</div>` : ''}
      </div>
    </div>
    <div class="guild-tabs">
      ${tabs.map(([id, label]) => `<button class="rb-btn${guildTab === id ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('')}
    </div>
    ${renderGuildTab(guild)}`;
}

function renderGuildTab(guild) {
  switch (guildTab) {
    case 'bank': return renderGuildBankTab(guild);
    case 'buffs': return renderGuildBuffsTab(guild);
    case 'ranks': return renderGuildRanksTab(guild);
    case 'settings': return renderGuildSettingsTab(guild);
    default: return renderGuildRosterTab(guild);
  }
}

function renderGuildRosterTab(guild) {
  const { permissions, myAccountId } = guildState;
  const ranks = [...guild.ranks].sort((a, b) => a.order - b.order);
  const rankName = (id) => ranks.find((r) => r.id === id)?.name || '-';
  const myOrder = ranks.find((r) => r.id === guildState.myRankId)?.order ?? Infinity;
  const isLeader = guild.leaderAccountId === myAccountId;

  const rows = [...guild.members]
    // Highest rank first, then alphabetically — the roster reads as a chain
    // of command rather than in join order.
    .sort((a, b) => (ranks.findIndex((r) => r.id === a.rankId) - ranks.findIndex((r) => r.id === b.rankId)) || a.name.localeCompare(b.name))
    .map((m) => {
      const isMe = m.accountId === myAccountId;
      const theirOrder = ranks.find((r) => r.id === m.rankId)?.order ?? Infinity;
      // The server enforces "strictly below you" for both; drawing the
      // control anyway would just be a button that always errors.
      const canAct = !isMe && (isLeader || theirOrder > myOrder);
      const rankCell = permissions.promote && canAct
        ? `<select data-act="set-rank" data-account="${esc(m.accountId)}">
             ${ranks.map((r) => `<option value="${esc(r.id)}"${r.id === m.rankId ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}
           </select>`
        : `<span class="gr-sub">${esc(rankName(m.rankId))}</span>`;
      return `<div class="guild-row">
        <span class="gr-dot${m.online ? ' online' : ''}"></span>
        <div class="gr-main">
          <div class="gr-name${m.online ? '' : ' offline'}">${esc(m.name)}${isMe ? ' (you)' : ''}${guild.leaderAccountId === m.accountId ? ' &#9733;' : ''}</div>
          <div class="gr-sub">Contributed ${(m.contributedGold || 0).toLocaleString()}g</div>
        </div>
        ${rankCell}
        ${isLeader && !isMe ? `<button class="rb-btn" data-act="make-leader" data-account="${esc(m.accountId)}">Make leader</button>` : ''}
        ${permissions.kick && canAct ? `<button class="rb-btn rb-danger" data-act="kick" data-account="${esc(m.accountId)}">Kick</button>` : ''}
      </div>`;
    }).join('');

  return `
    ${permissions.invite ? `<div class="guild-form">
      <input type="text" id="guild-invite-name" maxlength="20" placeholder="Player name" />
      <button class="rb-btn" data-act="invite">Invite</button>
      <span class="gr-sub">They have to be online.</span>
    </div>` : ''}
    <div class="guild-section-title">Members</div>
    ${rows}`;
}

function renderGuildBankTab(guild) {
  const { permissions } = guildState;
  const bankItems = Object.entries(guild.bank.items || {});
  const myItems = Object.entries(inventory).filter(([, qty]) => qty > 0);

  const bankRows = bankItems.length
    ? bankItems.map(([itemId, qty]) => `<div class="guild-row">
          <div class="gr-main"><div class="gr-name">${esc(resolveItemDisplay(itemId).name)}</div><div class="gr-sub">x${qty}</div></div>
          ${permissions.bankWithdraw ? `<input type="number" min="1" max="${qty}" value="1" data-qty-for="${esc(itemId)}" style="width:70px" />
          <button class="rb-btn" data-act="withdraw-item" data-item="${esc(itemId)}">Take</button>` : ''}
        </div>`).join('')
    : '<div class="guild-empty">The vault is empty.</div>';

  const myRows = myItems.length
    ? myItems.map(([itemId, qty]) => `<div class="guild-row">
          <div class="gr-main"><div class="gr-name">${esc(resolveItemDisplay(itemId).name)}</div><div class="gr-sub">x${qty}</div></div>
          <input type="number" min="1" max="${qty}" value="1" data-my-qty-for="${esc(itemId)}" style="width:70px" />
          <button class="rb-btn" data-act="deposit-item" data-item="${esc(itemId)}">Give</button>
        </div>`).join('')
    : '<div class="guild-empty">You are carrying nothing to deposit.</div>';

  const log = (guild.bank.log || []).slice(0, 10).map((e) => {
    const what = e.kind === 'buff'
      ? `activated ${esc(e.buffName)} (${e.amount.toLocaleString()}g)`
      : e.kind === 'deposit-gold' ? `deposited ${e.amount.toLocaleString()}g`
      : e.kind === 'withdraw-gold' ? `withdrew ${e.amount.toLocaleString()}g`
      : e.kind === 'deposit-item' ? `deposited ${e.amount}x ${esc(resolveItemDisplay(e.itemId).name)}`
      : `withdrew ${e.amount}x ${esc(resolveItemDisplay(e.itemId).name)}`;
    return `<div class="gr-sub">${esc(e.by)} ${what}</div>`;
  }).join('') || '<div class="guild-empty">Nothing yet.</div>';

  return `
    <div class="guild-section-title">Treasury</div>
    <div class="guild-bank-gold">${guild.bank.gold.toLocaleString()}g</div>
    <div class="guild-form">
      <input type="number" min="1" id="guild-gold-amount" placeholder="Amount" />
      ${permissions.bankDeposit ? '<button class="rb-btn" data-act="deposit-gold">Deposit</button>' : ''}
      ${permissions.bankWithdraw ? '<button class="rb-btn" data-act="withdraw-gold">Withdraw</button>' : ''}
      <span class="gr-sub">You carry ${gold.toLocaleString()}g</span>
    </div>
    <div class="guild-section-title">Vault</div>
    ${bankRows}
    ${permissions.bankDeposit ? `<div class="guild-section-title">Your bags</div>${myRows}` : ''}
    <div class="guild-section-title">Recent activity</div>
    ${log}`;
}

function renderGuildBuffsTab(guild) {
  const now = Date.now();
  const active = (guild.activeBuffs || []).filter((b) => b.expiresAt > now);
  const catalog = guildState.buffCatalog || [];

  const effectLine = (effects) => (effects || [])
    .map((e) => `${e.percent > 0 ? '+' : ''}${e.percent}% ${GUILD_EFFECT_LABELS[e.type] || e.type}`)
    .join(' / ');

  const activeHtml = active.length
    ? `<div class="guild-grid">${active.map((b) => `
        <div class="guild-buff-card active">
          ${b.iconUrl ? `<img src="${esc(b.iconUrl)}" alt="" />` : '<div class="bi-fallback">&#10022;</div>'}
          <div>
            <div class="bc-name">${esc(b.name)}</div>
            <div class="bc-effects">${esc(effectLine(b.effects))}</div>
            <div class="bc-line">${formatGuildDuration(b.expiresAt - now)} left, bought by ${esc(b.purchasedBy || '?')}</div>
          </div>
        </div>`).join('')}</div>`
    : '<div class="guild-empty">No guild buffs running.</div>';

  const catalogHtml = catalog.length
    ? `<div class="guild-grid">${catalog.map((b) => `
        <div class="guild-buff-card">
          ${b.iconUrl ? `<img src="${esc(b.iconUrl)}" alt="" />` : '<div class="bi-fallback">&#10022;</div>'}
          <div>
            <div class="bc-name">${esc(b.name)}</div>
            <div class="bc-effects">${esc(effectLine(b.effects))}</div>
            <div class="bc-line">${b.costGold.toLocaleString()}g for ${formatGuildDuration(b.durationMinutes * 60000)}</div>
            ${b.description ? `<div class="bc-line">${esc(b.description)}</div>` : ''}
            ${guildState.permissions.buyBuffs
              ? `<button class="rb-btn" data-act="buy-buff" data-buff="${esc(b.id)}"${guild.bank.gold < b.costGold ? ' disabled' : ''}>${
                  guild.bank.gold < b.costGold ? 'Bank too low' : (active.some((a) => a.buffId === b.id) ? 'Extend' : 'Activate')
                }</button>`
              : ''}
          </div>
        </div>`).join('')}</div>`
    : '<div class="guild-empty">No guild buffs have been authored yet - build some in the Guild Buff Builder.</div>';

  return `
    <div class="guild-section-title">Active</div>
    ${activeHtml}
    <div class="guild-section-title">Available</div>
    ${catalogHtml}`;
}

function renderGuildRanksTab(guild) {
  if (!guildState.permissions.editRanks) {
    return '<div class="guild-section-title">Ranks</div>' + [...guild.ranks].sort((a, b) => a.order - b.order).map((r) => `
      <div class="guild-rank-block">
        <div class="gr-name">${esc(r.name)}</div>
        <div class="gr-sub">${Object.keys(GUILD_PERMISSION_LABELS).filter((p) => r.permissions[p]).map((p) => GUILD_PERMISSION_LABELS[p]).join(', ') || 'No permissions'}</div>
      </div>`).join('');
  }
  // Edits accumulate in the draft and only reach the server on Save — the
  // rank table is order-sensitive, so it is sent whole or not at all.
  if (!guildRankDraft) guildRankDraft = JSON.parse(JSON.stringify([...guild.ranks].sort((a, b) => a.order - b.order)));

  return `
    <div class="guild-section-title">Ranks, highest first</div>
    <div class="gr-sub">The top rank is the guild master's and always keeps every permission.</div>
    ${guildRankDraft.map((r, i) => `
      <div class="guild-rank-block">
        <div class="grb-head">
          <input type="text" maxlength="24" value="${esc(r.name)}" data-rank-name="${i}" />
          <button class="rb-btn" data-act="rank-up" data-index="${i}"${i === 0 ? ' disabled' : ''}>&#8593;</button>
          <button class="rb-btn" data-act="rank-down" data-index="${i}"${i === guildRankDraft.length - 1 ? ' disabled' : ''}>&#8595;</button>
          <button class="rb-btn rb-danger" data-act="rank-delete" data-index="${i}"${i === 0 || guildRankDraft.length <= 1 ? ' disabled' : ''}>x</button>
        </div>
        ${i === 0
          ? '<div class="gr-sub">All permissions.</div>'
          : `<div class="guild-perm-grid">
              ${Object.entries(GUILD_PERMISSION_LABELS).map(([id, label]) => `
                <label><input type="checkbox" data-rank-perm="${i}" data-perm="${id}"${r.permissions[id] ? ' checked' : ''} />${label}</label>`).join('')}
            </div>`}
      </div>`).join('')}
    <div class="guild-form">
      <button class="rb-btn" data-act="rank-add">Add rank</button>
      <button class="rb-btn" data-act="rank-save">Save ranks</button>
      <button class="rb-btn" data-act="rank-revert">Revert</button>
    </div>`;
}

function renderGuildSettingsTab(guild) {
  const canEdit = guildState.permissions.editGuild;
  return `
    ${canEdit ? `
      <div class="guild-section-title">Crest</div>
      <div class="guild-form">
        ${guildCrestHtml(guild)}
        <input type="file" id="guild-logo-file" accept="image/*" />
        ${guild.logoUrl ? '<button class="rb-btn rb-danger" data-act="clear-logo">Remove</button>' : ''}
      </div>
      <div class="gr-sub">Shown above every member's head. Up to 2MB; square images look best.</div>
      <div class="guild-section-title">Message of the day</div>
      <div class="guild-form">
        <input type="text" id="guild-motd-input" maxlength="240" style="flex:1" value="${esc(guild.motd || '')}" placeholder="Raid at eight." />
        <button class="rb-btn" data-act="save-motd">Save</button>
      </div>` : ''}
    <div class="guild-section-title">Danger zone</div>
    <button class="rb-btn rb-danger" data-act="leave">Leave guild</button>
    ${guild.leaderAccountId === guildState.myAccountId ? '<div class="gr-sub">As guild master you must pass leadership on before you can leave.</div>' : ''}`;
}

/** Reads a number out of one of the panel's inputs, defaulting to 0 so a blank box is simply rejected by the server's own "above zero" check. */
function guildInputNumber(selector) {
  return Math.floor(Number(guildBodyEl.querySelector(selector)?.value) || 0);
}

guildBodyEl.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) {
    guildTab = tabBtn.dataset.tab;
    guildRankDraft = null;
    showGuildError('');
    refreshGuildPanel();
    return;
  }
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  showGuildError('');

  switch (act) {
    case 'create':
      net.createGuild(guildBodyEl.querySelector('#guild-create-name')?.value || '');
      break;
    case 'invite': {
      const input = guildBodyEl.querySelector('#guild-invite-name');
      const name = input?.value.trim();
      if (!name) { showGuildError('Type the name of the player to invite.'); break; }
      net.inviteToGuild(name);
      if (input) input.value = '';
      break;
    }
    case 'kick': net.kickFromGuild(btn.dataset.account); break;
    case 'make-leader': net.transferGuildLeadership(btn.dataset.account); break;
    case 'leave': net.leaveGuild(); break;
    case 'deposit-gold': net.guildDepositGold(guildInputNumber('#guild-gold-amount')); break;
    case 'withdraw-gold': net.guildWithdrawGold(guildInputNumber('#guild-gold-amount')); break;
    case 'deposit-item':
      net.guildDepositItem(btn.dataset.item, guildInputNumber(`[data-my-qty-for="${CSS.escape(btn.dataset.item)}"]`));
      break;
    case 'withdraw-item':
      net.guildWithdrawItem(btn.dataset.item, guildInputNumber(`[data-qty-for="${CSS.escape(btn.dataset.item)}"]`));
      break;
    case 'buy-buff': net.buyGuildBuff(btn.dataset.buff); break;
    case 'save-motd': net.setGuildMotd(guildBodyEl.querySelector('#guild-motd-input')?.value || ''); break;
    case 'clear-logo': net.setGuildLogo(''); break;
    case 'rank-add':
      guildRankDraft.push({ id: `rank${guildRankDraft.length}${Math.random().toString(36).slice(2, 6)}`, name: 'New rank', order: guildRankDraft.length, permissions: {} });
      refreshGuildPanel();
      break;
    case 'rank-up': {
      const i = Number(btn.dataset.index);
      [guildRankDraft[i - 1], guildRankDraft[i]] = [guildRankDraft[i], guildRankDraft[i - 1]];
      refreshGuildPanel();
      break;
    }
    case 'rank-down': {
      const i = Number(btn.dataset.index);
      [guildRankDraft[i + 1], guildRankDraft[i]] = [guildRankDraft[i], guildRankDraft[i + 1]];
      refreshGuildPanel();
      break;
    }
    case 'rank-delete':
      guildRankDraft.splice(Number(btn.dataset.index), 1);
      refreshGuildPanel();
      break;
    case 'rank-save':
      net.saveGuildRanks(guildRankDraft.map((r, i) => ({ ...r, order: i })));
      guildRankDraft = null;
      break;
    case 'rank-revert':
      guildRankDraft = null;
      refreshGuildPanel();
      break;
    default: break;
  }
});

// Rank name/permission edits write straight into the draft, so a re-render
// (triggered by a reorder, or by someone else's change arriving) doesn't throw
// away what was typed.
guildBodyEl.addEventListener('input', (e) => {
  const nameIdx = e.target.dataset?.rankName;
  if (nameIdx !== undefined && guildRankDraft) guildRankDraft[Number(nameIdx)].name = e.target.value;
});

guildBodyEl.addEventListener('change', (e) => {
  const permIdx = e.target.dataset?.rankPerm;
  if (permIdx !== undefined && guildRankDraft) {
    guildRankDraft[Number(permIdx)].permissions[e.target.dataset.perm] = e.target.checked;
    return;
  }
  const rankSelect = e.target.closest('select[data-act="set-rank"]');
  if (rankSelect) {
    net.setGuildRank(rankSelect.dataset.account, rankSelect.value);
    return;
  }
  if (e.target.id === 'guild-logo-file') uploadGuildLogo(e.target.files?.[0]);
});

/** Uploads a crest, then points the guild at the URL the server hands back. Two steps on purpose: the upload route mints the path, and only paths it minted are accepted by 'guild-set-logo'. */
async function uploadGuildLogo(file) {
  if (!file) return;
  showGuildError('Uploading crest...');
  try {
    const body = new FormData();
    body.append('logo', file);
    const res = await fetch('/api/guilds/logo', { method: 'POST', body });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    net.setGuildLogo(data.url);
    showGuildError('');
  } catch (err) {
    showGuildError(err.message);
  }
}

function showGuildInvitePrompt(invite) {
  guildInvitePromptEl.innerHTML = `
    ${invite.logoUrl ? `<img src="${esc(invite.logoUrl)}" alt="" />` : ''}
    <div><b>${esc(invite.inviterName)}</b> invites you to <b>${esc(invite.guildName)}</b></div>
    <div class="guild-form" style="justify-content:center">
      <button class="rb-btn" data-guild-invite="accept">Accept</button>
      <button class="rb-btn rb-danger" data-guild-invite="decline">Decline</button>
    </div>`;
  guildInvitePromptEl.style.display = 'block';
}

guildInvitePromptEl.addEventListener('click', (e) => {
  const choice = e.target.closest('[data-guild-invite]')?.dataset.guildInvite;
  if (!choice) return;
  if (choice === 'accept') net.acceptGuildInvite();
  else net.declineGuildInvite();
  guildInvitePromptEl.style.display = 'none';
});

/** A short banner when a guildmate activates a buff — the panel may not be open, and a guild-wide XP boost starting is worth noticing. */
function showGuildBuffBanner(text) {
  guildBuffBannerEl.textContent = text;
  guildBuffBannerEl.style.display = 'block';
  clearTimeout(showGuildBuffBanner._timer);
  showGuildBuffBanner._timer = setTimeout(() => { guildBuffBannerEl.style.display = 'none'; }, 5000);
}


function clearGroup(group) {
  while (group.children.length) group.remove(group.children[0]);
}

/** Drops the current non-default map's particle systems. Explicit disposal, not just clearGroup() — that only detaches children, and these are rebuilt on every map switch, so each one would otherwise leak a Points/LineSegments buffer. */
function clearMapParticles() {
  for (const sys of mapParticles) {
    mapGroup.remove(sys.group);
    sys.group.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
  }
  mapParticles.length = 0;
  // Placed emitters own three.quarks systems (not Points buffers), so they
  // dispose through the VFX system rather than by dropping geometry — but
  // they must go at exactly the same moments, or a building's fireplace keeps
  // burning after you walk out of the building.
  mapWorldEmitters?.dispose();
  mapWorldEmitters = null;
  // Same timing for placed lights — leaving a dungeon must take its torches
  // with it, and a stale pool would also keep charging every material in the
  // next map for light slots nothing is bound to.
  mapWorldLights?.dispose();
  mapWorldLights = null;
}

/** Builds the same three particle layers the default overworld gets (painted-layer, zone, map-wide environmental) for whichever map is being entered. @param {object} mapWorld @param {object} settings that map's graphicsSettings */
function buildMapParticles(mapWorld, settings) {
  clearMapParticles(); // also disposes the previous map's placed emitters
  mapWorldEmitters = createWorldParticleEmitters(mapGroup, mapWorld, vfxSystem);
  mapWorldLights = createWorldLights(mapGroup, mapWorld);
  for (const sys of [
    createAmbientParticleSystem(mapWorld),
    createZoneParticleSystem(mapWorld),
    createEnvironmentalParticleSystem(mapWorld, settings.environmental),
  ]) {
    if (sys.isEmpty) continue;
    mapGroup.add(sys.group);
    mapParticles.push(sys);
  }
}

function clearRemoteMeshes() {
  for (const mesh of remoteMeshes.values()) scene.remove(mesh);
  remoteMeshes.clear();
}

function populateRemoteRoster(roster) {
  clearRemoteMeshes();
  for (const p of roster || []) {
    if (p.equipmentLoadout) otherPlayerWeaponLoadouts.set(p.id, p.equipmentLoadout);
    // Character and guild first: attachPlayerNameplate reads both out of
    // these maps, so recording them afterwards would build every plate in the
    // roster nameless and guildless.
    if (p.character) playerCharacters.set(p.id, p.character);
    if (p.guild !== undefined) playerGuilds.set(p.id, p.guild);
    const mesh = buildPlayerMesh(withWeaponLoadout(p.id, p.character || { seed: hashStringToSeed(p.id), outfitColor: 0xc23b3b }));
    mesh.position.set(p.position.x, p.position.y, p.position.z);
    remoteMeshes.set(p.id, mesh);
    attachPlayerNameplate(p.id, mesh);
    scene.add(mesh);
  }
}

const _spawnCamOffset = new THREE.Vector3();

/**
 * Turn the local player to an authored spawn facing and swing the orbit camera
 * around behind them, so a spawn point framed a certain way in the World Editor
 * actually looks that way on arrival.
 *
 * `facing` is radians in the atan2(x, z) convention every other facing in this
 * project uses (0 = looking down +Z) — see the server's spawnFacingOf. `null`
 * or `undefined` means the arrival point authored no facing (a teleporter, a
 * corpse run back to a tower entrance), and leaves the body — and, unless
 * `resetView`, the camera — exactly as they were.
 *
 * `resetView` additionally swings the camera back to the ARRIVED-IN map's
 * authored default framing (graphicsSettings.playerCamera's distance + pitch),
 * so entering a cramped dungeon doesn't keep the overworld's far-out view.
 * Only map arrivals pass it: mid-map teleports leave the player's own zoom and
 * pitch alone, since yanking those on every short hop would feel broken.
 *
 * Must run AFTER localMesh.position is set: the camera offset is computed
 * relative to the player's new spot, and `lastCameraTargetPos` has to be
 * re-seeded there too or animate()'s follow-delta would immediately shove the
 * camera by the whole distance the player just teleported.
 */
function applySpawnFacing(position, facing, { resetView = false } = {}) {
  const targetPos = _newTargetPos.set(position.x, position.y + 1, position.z);
  if (facing == null && !resetView) {
    // Still re-seed the follow bookkeeping — a facing-less teleport moved the
    // player, and the delta from the OLD target is not a camera motion we want.
    camera.position.add(_cameraDelta.subVectors(targetPos, lastCameraTargetPos));
  } else {
    if (facing != null) localMesh.rotation.y = facing;
    // Keep the player's own zoom distance and pitch unless this arrival resets
    // the view, and change only the azimuth. OrbitControls derives its
    // spherical angles from (camera.position - target) on every update(), with
    // theta = atan2(offset.x, offset.z) — so putting the camera BEHIND a player
    // facing `facing` is theta = facing + PI.
    _spawnCamOffset.subVectors(camera.position, cameraControls.target);
    const currentRadius = Math.max(_spawnCamOffset.length(), cameraControls.minDistance);
    const theta = facing != null
      ? facing + Math.PI
      : Math.atan2(_spawnCamOffset.x, _spawnCamOffset.z); // resetView with no authored facing: keep where they were looking
    let radius = currentRadius;
    let phi = Math.acos(Math.min(1, Math.max(-1, _spawnCamOffset.y / currentRadius)));
    if (resetView) {
      const cam = playerCameraOf(activeGraphicsSettings);
      radius = THREE.MathUtils.clamp(cam.distance, cam.minDistance, cam.maxDistance);
      // pitchDeg is measured up from the ground; OrbitControls' phi is measured
      // down from straight up — hence 90 minus. Clamped to the same polar limit
      // the controls enforce, so an extreme authored pitch can't put the camera
      // somewhere update() will immediately snap it out of.
      phi = THREE.MathUtils.clamp(
        THREE.MathUtils.degToRad(90 - cam.pitchDeg),
        cameraControls.minPolarAngle,
        cameraControls.maxPolarAngle,
      );
    }
    _spawnCamOffset.setFromSphericalCoords(radius, phi, theta);
    camera.position.copy(targetPos).add(_spawnCamOffset);
  }
  cameraControls.target.copy(targetPos);
  lastCameraTargetPos.copy(targetPos);
  cameraControls.update();
}

/**
 * Apply a networked position update to a remote player's mesh. Also
 * detects movement (for the walk-cycle animation, since we only get
 * position snapshots for remote players, never their input) and turns the
 * mesh to face the direction it's actually traveling.
 */
function applyRemotePosition(mesh, position) {
  const dx = position.x - mesh.position.x;
  const dz = position.z - mesh.position.z;
  if (dx * dx + dz * dz > 0.0009) { // ~0.03 units — ignore server-tick jitter, not real movement
    mesh.userData.movingUntil = performance.now() + 200; // bridges the ~50ms gap between network ticks
    mesh.rotation.y = Math.atan2(dx, dz);
  }
  mesh.position.set(position.x, position.y, position.z);
}

const keys = { w: false, a: false, s: false, d: false };
window.addEventListener('keydown', (e) => { if (!isTypingInField()) setKey(e.code, true); });
window.addEventListener('keyup', (e) => setKey(e.code, false));
function setKey(code, val) {
  if (code === 'KeyW' || code === 'ArrowUp') keys.w = val;
  if (code === 'KeyA' || code === 'ArrowLeft') keys.a = val;
  if (code === 'KeyS' || code === 'ArrowDown') keys.s = val;
  if (code === 'KeyD' || code === 'ArrowRight') keys.d = val;
}
// Jump: edge-triggered, not held — set true on the keydown edge (ignoring
// OS key-repeat via e.repeat, so holding Space doesn't queue a jump every
// repeat event), consumed once network-side by the throttled input send
// below. stepMovement() itself is what makes repeated "still true" reads
// harmless while airborne (see src/sim/movement.js) — jump only does
// anything while grounded, so this doesn't need to be cleared every frame.
let jumpQueued = false;
window.addEventListener('keydown', (e) => {
  if (isTypingInField()) return;
  if (e.code === 'Space' && !e.repeat) jumpQueued = true;
});
// Fix for the "character auto-moves and won't stop" bug: if the window loses
// focus (alt-tab, click away) while a movement key is held, its keyup never
// fires and the key stays stuck down forever. Clear all movement keys
// whenever focus is lost or the tab is hidden.
function clearMovementKeys() { keys.w = keys.a = keys.s = keys.d = false; }
window.addEventListener('blur', clearMovementKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearMovementKeys(); });
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _moveDir = new THREE.Vector3(); // reused each currentInput() call — was allocated fresh every frame
const _newTargetPos = new THREE.Vector3(); // reused each animate() frame — was allocated fresh every frame
const _cameraDelta = new THREE.Vector3(); // reused each animate() frame — was .clone()'d fresh every frame

// --- Event Object screen effects (shake/fade) ---
// Neither existed anywhere in the render layer before the Event Editor —
// combat has no camera shake today. Shake perturbs camera.position by a
// decaying random offset that's undone at the START of the next frame
// (before the orbit-follow delta is computed from camera.position), so it
// never leaks into OrbitControls' own internal spherical state — otherwise
// each frame's shake would compound into permanent camera drift.
const _shakeOffset = new THREE.Vector3();
let activeShake = null; // { startedAt, durationMs, intensity } | null
const eventFadeOverlayEl = document.getElementById('event-fade-overlay');

function triggerScreenShake(intensity, durationMs) {
  activeShake = { startedAt: performance.now(), durationMs, intensity };
}

function triggerScreenFade(direction, durationMs, color = '#000') {
  eventFadeOverlayEl.style.background = color;
  eventFadeOverlayEl.style.transitionDuration = `${durationMs}ms`;
  // Force layout so the transition actually animates from the current
  // opacity rather than jumping instantly if a fade is already mid-flight.
  void eventFadeOverlayEl.offsetHeight;
  eventFadeOverlayEl.style.opacity = direction === 'out' ? '1' : '0';
}
function currentInput() {
  let localX = 0, localZ = 0; // localZ: +1 = forward (W), localX: +1 = right (D)
  if (keys.w) localZ += 1;
  if (keys.s) localZ -= 1;
  if (keys.d) localX += 1;
  if (keys.a) localX -= 1;
  if (localX === 0 && localZ === 0) return { moveX: 0, moveZ: 0 };

  // Camera-relative movement: "forward" means "away from the camera" on
  // screen, regardless of how far the player has orbited it. Without this,
  // free camera orbit (added last session) makes movement feel reversed or
  // broken the moment you drag the camera to look around — which you
  // naturally do in a new enclosed room like a tower floor.
  camera.getWorldDirection(_forward);
  _forward.y = 0;
  if (_forward.lengthSq() < 1e-6) _forward.set(0, 0, -1);
  _forward.normalize();
  _right.crossVectors(_forward, camera.up).normalize();

  _moveDir.set(0, 0, 0)
    .addScaledVector(_forward, localZ)
    .addScaledVector(_right, localX);
  if (_moveDir.lengthSq() < 1e-6) return { moveX: 0, moveZ: 0 };
  _moveDir.normalize();
  return { moveX: _moveDir.x, moveZ: _moveDir.z };
}

// --- Abilities / hotbar ---
// classDef.abilities is empty until the skill catalog fetch resolves (see
// setSkillCatalog above) — top-level await (already used by
// loadFloraPlugins() above) so the hotbar UI below always has real data.
await skillsPromise;
const classDef = CLASSES[myCharacter.classId];
const abilityUI = {
  resource: classDef.maxResource,
  maxResource: classDef.maxResource,
  regenPerSecond: classDef.regenPerSecond,
  cooldownEndsAt: {}, // abilityId -> ms timestamp (from performance.now() space, see below)
};
// Server timestamps are Date.now()-based; the client render loop uses
// performance.now(). This offset lets us convert server cooldownEndsAt into
// the client's clock space without assuming they start at the same epoch.
const clockOffset = performance.now() - Date.now();

const hotbarEl = document.getElementById('hotbar');
const resourceFillEl = document.getElementById('resource-bar-fill');
const resourceLabelEl = document.getElementById('resource-label');

const abilitiesByKey = new Map(classDef.abilities.map((a) => [a.key, a]));
const slotEls = new Map(); // key -> {root, overlay, text}

for (const ability of classDef.abilities) {
  const slot = document.createElement('div');
  slot.className = 'hotbar-slot';
  // An uploaded icon (Skill Builder) is a URL; anything else (or absent) is
  // treated as plain text/emoji, same field either way (see skillDefs.js).
  const isUploadedIcon = typeof ability.icon === 'string' && /^(\/|https?:)/.test(ability.icon);
  const iconHtml = isUploadedIcon ? `<img class="ability-icon" src="${ability.icon}" alt="" />` : '';
  slot.innerHTML = `
    <span class="key">${ability.key}</span>
    ${iconHtml}
    <div class="cooldown-overlay"></div>
    <div class="cooldown-text"></div>
    <span class="name">${ability.name}</span>
    <div class="lock-overlay">🔒<span class="lock-level"></span></div>
  `;
  hotbarEl.appendChild(slot);
  slotEls.set(ability.key, {
    root: slot,
    overlay: slot.querySelector('.cooldown-overlay'),
    text: slot.querySelector('.cooldown-text'),
    lockLevel: slot.querySelector('.lock-level'),
  });
}

/** Grey out + lock any hotbar slot the player hasn't reached the required level for yet —
 * called once at hotbar build and again on every level-up, since a level-up can newly
 * unlock a slot that was locked a moment ago. */
function refreshHotbarLockState() {
  for (const ability of classDef.abilities) {
    const el = slotEls.get(ability.key);
    if (!el) continue;
    const locked = xpUI.level < (ability.requiredLevel || 1);
    el.root.classList.toggle('locked', locked);
    if (locked) el.lockLevel.textContent = `Lv. ${ability.requiredLevel}`;
  }
}
refreshHotbarLockState();

function flashSlot(key, className, ms) {
  const el = slotEls.get(key)?.root;
  if (!el) return;
  el.classList.add(className);
  setTimeout(() => el.classList.remove(className), ms);
}

// --- Targeting: click a monster/player to select them, or cycle nearby
// monsters with Tab/Shift+Tab. Purely client-side selection state — the
// server never trusts targetId blindly (see resolveAbilityEffect), this
// just decides what use-ability sends.
let currentTargetId = null;
const targetPanelEl = document.getElementById('target-panel');
const targetNameEl = document.getElementById('target-name');
const targetHpFillEl = document.getElementById('target-hp-fill');
const targetHpTextEl = document.getElementById('target-hp-text');

/** id -> {kind, name, health, maxHealth} for whoever's currently on-screen this
 * tick — cleared and rebuilt at the top of each of the three onState/
 * onFloorState/onMapState handlers (only one is ever "live" at a time, gated
 * by inTower/inStore/floor-or-map-id checks), so a target that's died or
 * walked out of the current context/range simply stops appearing here rather
 * than leaving the panel showing stale HP forever. */
const targetStateCache = new Map();

function monsterDisplayName(type) {
  return monsterTypesById[type]?.name || 'Monster';
}
function playerDisplayName(id) {
  const character = playerCharacters.get(id);
  // Their actual character name, when we have it — the target panel used to
  // read "Warrior" for every warrior on the map, which is exactly as useful
  // as no name at all now that plates overhead say who people are.
  if (character?.name) return character.name;
  return (character?.classId && CLASSES[character.classId]?.name) || 'Player';
}

/** Reflects currentTargetId's latest cached HP/name — call after every state
 * tick (so a targeted monster's health bar actually moves) and whenever the
 * target itself changes. */
function refreshTargetPanel() {
  if (!currentTargetId) { targetPanelEl.style.display = 'none'; return; }
  const info = targetStateCache.get(currentTargetId);
  if (!info) { setCurrentTarget(null); return; } // no longer present anywhere this tick — dead, left, or out of range
  targetPanelEl.style.display = 'block';
  targetNameEl.textContent = info.name;
  const pct = info.maxHealth > 0 ? Math.max(0, Math.min(1, info.health / info.maxHealth)) * 100 : 0;
  targetHpFillEl.style.width = `${pct}%`;
  targetHpTextEl.textContent = `${Math.max(0, Math.round(info.health))} / ${Math.round(info.maxHealth)}`;
}

function setCurrentTarget(id) {
  currentTargetId = id;
  refreshTargetPanel();
  updateTargetRing();
}

// --- Selection ring: a flat glowing disc on the ground under whoever is
// currently targeted. The HUD target panel alone doesn't answer "which of
// these three monsters standing on top of each other am I hitting?", which is
// what this is for. Built once and re-parented by position each frame rather
// than attached to the target mesh, so nothing here can be swept up by
// toonify() (MeshBasicMaterial is skipped anyway) or torn down by a
// monster-mesh rebuild.
const TARGET_RING_COLORS = {
  monster: { fill: 0xffe14a, edge: 0xfff6b0 },
  player: { fill: 0x5ad2ff, edge: 0xc7f0ff },
};
const targetRingGroup = new THREE.Group();
targetRingGroup.visible = false;
targetRingGroup.renderOrder = 3;
// Unit-radius geometry (radius 1) — the group is scaled to the target's
// footprint each frame instead of rebuilding geometry per target.
const targetRingFillMat = new THREE.MeshBasicMaterial({
  color: TARGET_RING_COLORS.monster.fill,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const targetRingEdgeMat = new THREE.MeshBasicMaterial({
  color: TARGET_RING_COLORS.monster.edge,
  transparent: true,
  opacity: 0.9,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const targetRingFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48), targetRingFillMat);
const targetRingEdge = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), targetRingEdgeMat);
for (const m of [targetRingFill, targetRingEdge]) {
  m.rotation.x = -Math.PI / 2; // CircleGeometry/RingGeometry face +Z; lay them flat on the ground
  m.renderOrder = 3;
  targetRingGroup.add(m);
}
scene.add(targetRingGroup);

const _targetRingBox = new THREE.Box3();
/** Footprint radius + foot offset of a target mesh, measured once and cached
 * on the mesh — a Box3.setFromObject per frame walks every body part of every
 * targeted monster, which is real cost for a value that never changes. */
function targetRingMetrics(mesh) {
  if (mesh.userData.targetRingMetrics) return mesh.userData.targetRingMetrics;
  _targetRingBox.setFromObject(mesh);
  const radius = Math.max(
    0.5,
    Math.max(_targetRingBox.max.x - _targetRingBox.min.x, _targetRingBox.max.z - _targetRingBox.min.z) / 2 + 0.25,
  );
  const metrics = { radius, footOffset: _targetRingBox.min.y - mesh.position.y };
  mesh.userData.targetRingMetrics = metrics;
  return metrics;
}

/** Places/hides the selection ring. Called on every target change and once per
 * animation frame (the target moves between network ticks). */
function updateTargetRing(nowMs = performance.now()) {
  const mesh = currentTargetId ? findMeshById(currentTargetId) : null;
  // Visibility has to be checked up the whole parent chain: entering a tower
  // hides overworldGroup wholesale without touching the monster meshes inside
  // it, so `mesh.visible` alone would leave a ring floating in an empty scene.
  let visible = !!mesh;
  for (let n = mesh; n && visible; n = n.parent) if (!n.visible) visible = false;
  if (!visible) { targetRingGroup.visible = false; return; }

  const colors = TARGET_RING_COLORS[targetStateCache.get(currentTargetId)?.kind === 'player' ? 'player' : 'monster'];
  targetRingFillMat.color.setHex(colors.fill);
  targetRingEdgeMat.color.setHex(colors.edge);

  const { radius, footOffset } = targetRingMetrics(mesh);
  const pulse = 1 + Math.sin(nowMs / 260) * 0.04;
  targetRingGroup.visible = true;
  targetRingGroup.position.set(mesh.position.x, mesh.position.y + footOffset + 0.06, mesh.position.z);
  targetRingGroup.scale.set(radius * pulse, 1, radius * pulse);
  targetRingFillMat.opacity = 0.18 + (pulse - 1) * 1.5;
  targetRingEdgeMat.opacity = 0.75 + (pulse - 1) * 2.5;
}

/** Walks up from a raycast hit (which may be a nested body-part mesh) to find which tracked entity map it belongs to. */
/** Forward lookup: a targetId (from ability-used/monster-ability-used) to its
 * current mesh, so VFX can be aimed at wherever that entity actually is. */
function findMeshById(id) {
  if (!id) return null;
  if (id === localId) return localMesh;
  return overworldMonsterMeshes.get(id) || monsterMeshes.get(id) || remoteMeshes.get(id) || null;
}

/** Nearest monster to a given world position within range — mirrors the
 * server's own nearest-in-range fallback (resolveEnemyTargets), so a cast's
 * travel/impact VFX aims at a sensible target even when the caster never
 * explicitly clicked/tabbed one (the common case in casual play). */
function nearestEnemyMeshInRange(casterPosition, range) {
  const meshMap = overworldGroup.visible ? overworldMonsterMeshes : monsterMeshes;
  let nearest = null;
  let nearestDist = Infinity;
  for (const mesh of meshMap.values()) {
    const d = Math.hypot(mesh.position.x - casterPosition.x, mesh.position.z - casterPosition.z);
    if (d <= range && d < nearestDist) {
      nearestDist = d;
      nearest = mesh;
    }
  }
  return nearest;
}

function findEntityForObject(obj) {
  let node = obj;
  while (node) {
    for (const [id, mesh] of overworldMonsterMeshes) if (mesh === node) return { id, kind: 'monster' };
    for (const [id, mesh] of monsterMeshes) if (mesh === node) return { id, kind: 'monster' };
    for (const [id, mesh] of remoteMeshes) if (mesh === node) return { id, kind: 'player' };
    node = node.parent;
  }
  return null;
}

const targetRaycaster = new THREE.Raycaster();
const targetPointerNdc = new THREE.Vector2();
let pointerDownPos = null;
canvas.addEventListener('pointerdown', (e) => { pointerDownPos = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (!pointerDownPos) return;
  const dragDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
  pointerDownPos = null;
  if (dragDist > 6) return; // a camera-rotate drag, not a click-to-target

  targetPointerNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
  targetPointerNdc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  targetRaycaster.setFromCamera(targetPointerNdc, camera);
  const meshes = [...overworldMonsterMeshes.values(), ...monsterMeshes.values(), ...remoteMeshes.values()];
  const hits = targetRaycaster.intersectObjects(meshes, true);
  if (!hits.length) { setCurrentTarget(null); return; }
  const found = findEntityForObject(hits[0].object);
  setCurrentTarget(found?.id ?? null);
});

/** Nearby monsters, nearest-first, whichever mesh map matches what's currently visible (overworld vs a tower floor/dungeon/map). */
function nearbyMonstersForTabTarget() {
  if (!predicted) return [];
  const meshMap = overworldGroup.visible ? overworldMonsterMeshes : monsterMeshes;
  const myPos = predicted.position;
  return [...meshMap.keys()]
    .map((id) => {
      const p = meshMap.get(id).position;
      return { id, dist: Math.hypot(p.x - myPos.x, p.z - myPos.z) };
    })
    .sort((a, b) => a.dist - b.dist);
}

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Tab' || isTypingInField()) return;
  e.preventDefault(); // Tab would otherwise move focus off the page
  const list = nearbyMonstersForTabTarget();
  if (!list.length) return;
  const idx = list.findIndex((m) => m.id === currentTargetId);
  const nextIdx = e.shiftKey
    ? (idx <= 0 ? list.length - 1 : idx - 1)
    : (idx === -1 || idx === list.length - 1 ? 0 : idx + 1);
  setCurrentTarget(list[nextIdx].id);
});

window.addEventListener('keydown', (e) => {
  const key = { Digit1: 1, Digit2: 2, Digit3: 3, Digit4: 4, Digit5: 5, Digit6: 6, Digit7: 7, Digit8: 8 }[e.code];
  if (isTypingInField()) return;
  if (!key || isDeadLocally || isCCd(localStatusEffects, Date.now())) return;
  const ability = abilitiesByKey.get(key);
  if (!ability) return;
  if (xpUI.level < (ability.requiredLevel || 1)) {
    showTransientMessage(`Unlocks at level ${ability.requiredLevel}`);
    return;
  }
  net.useAbility(ability.id, currentTargetId);
});

const net = new NetClient({
  onWelcome: async ({ id, world: worldData, position, facing, existingPlayers, towerMeta: meta, gatherNodeStates, inventory: initialInventory, equipment: initialEquipment, gold: welcomeGold, vendor: welcomeVendor, storeEntrance, level, xp, xpToNext, quests: questDefs, questState: initialQuestState, eventObjectStates, eventSwitches: initialEventSwitches, eventQuestLog: initialEventQuestLog, unassignedStatPoints: welcomeStatPoints, allocatedStats: welcomeAllocatedStats, recipes: recipeDefs, craftingStationTypes: stationTypeDefs, professions: initialProfessions }) => {
    localId = id;
    world = parseWorld(worldData);
    zonesById = Object.fromEntries((world.zones || []).map((z) => [z.id, z]));
    questTargetLookups = buildQuestTargetLookups(world);
    towerMeta = meta;
    activeBounds = world.bounds;
    activeTerrainWorld = world;
    activeTeleporters = world.teleporters || [];
    activeGraphicsSettings = world.graphicsSettings || defaultGraphicsSettings();
    // Anisotropy must land before buildWorldMeshes creates any ground/path/
    // mountain textures — they read it at creation time (see renderSettings.js).
    setCurrentAnisotropy(activeGraphicsSettings.anisotropy);
    await Promise.all([weaponTuningPromise, characterTypesPromise, vfxCatalogPromise, authoredItemsPromise]); // grips + bodies + worn-gear visuals before any character mesh is built; custom VFX before any skill can be used
    objectDefsById = Object.fromEntries((await objectDefsPromise).map((o) => [o.id, o]));
    monsterTypesById = Object.fromEntries((await monsterTypeDefsPromise).map((mt) => [mt.id, mt]));
    buildingPartsById = Object.fromEntries((await buildingPartsPromise).map((p) => [p.id, p]));
    buildingTypesById = Object.fromEntries((await buildingTypesPromise).map((t) => [t.id, t]));
    buildingCatalogForRender = { partsById: buildingPartsById, typesById: buildingTypesById };
    await groundTexturesPromise; // custom texture loads are kicked off, not necessarily finished — see the reload callback registered above
    await pathTexturesPromise; // same deal — see the path-texture reload callback registered above
    modelCatalogById = Object.fromEntries((await modelCatalogPromise).map((m) => [m.id, m]));
    // Unlike ground textures, models get AWAITED before building anything —
    // no placeholder box should ever be visible in the live game (see the
    // comment on modelCatalogPromise above). This includes a custom weapon
    // model any class/NPC currently equips (not just world props) — without
    // this, the first player mesh built with one attaches
    // buildModelPlaceholder's wireframe box, and (unlike the World Editor)
    // nothing here ever rebuilds to swap in the real mesh once it loads.
    const equippedWeaponModelIds = (await characterTypesPromise).flatMap((c) => [c.equipment?.mainHand, c.equipment?.offHand])
      .filter(Boolean)
      .map((id) => getWeaponTypeDef(id))
      .filter((def) => def?.family === 'custom')
      .map((def) => def.modelId);
    const referencedModelIds = [...new Set([
      ...(world.props || []).filter((p) => p.type === 'model').map((p) => p.modelId).filter(Boolean),
      ...equippedWeaponModelIds,
    ])];
    await waitForModels(referencedModelIds);
    ({ grass: grassCover, flowers: flowerCover, sway: propSway, treeSway, treeLod, groundTextureOverlay: groundTextureOverlayMesh, water: waterMesh, seabed: seabedMesh, lakeBodies, riverBodies, propMeshesById } = buildWorldMeshes(overworldGroup, world, objectDefsById, ATMOSPHERE, buildingCatalogForRender));
    worldMeshesReady = true;
    applyPostProcessingSettings(activeGraphicsSettings);
    applyGraphicsSettingsToAtmosphere(scene, activeGraphicsSettings);
    applyPlayerCameraLimits(); // before applySpawnFacing below, which clamps the default distance into this range
    if (groundTextureOverlayMesh) applyCloudShadowSettings(groundTextureOverlayMesh, activeGraphicsSettings.postFx.cloudShadows);
    warmUpPostProcessing(); // see postProcessing.js's warmUp() for why this exists
    overworldCollision = buildCollisionIndex(world, objectDefsById, modelCatalogById);
    activeCollision = overworldCollision;

    const particleSystem = createAmbientParticleSystem(world);
    if (!particleSystem.isEmpty) {
      overworldGroup.add(particleSystem.group);
      ambientParticles = particleSystem;
    }
    const zoneParticleSystem = createZoneParticleSystem(world);
    if (!zoneParticleSystem.isEmpty) {
      overworldGroup.add(zoneParticleSystem.group);
      zoneParticles = zoneParticleSystem;
    }
    const envParticleSystem = createEnvironmentalParticleSystem(world, activeGraphicsSettings.environmental);
    if (!envParticleSystem.isEmpty) {
      overworldGroup.add(envParticleSystem.group);
      environmentalParticles = envParticleSystem;
    }
    worldEmitters = createWorldParticleEmitters(overworldGroup, world, vfxSystem);
    worldLights = createWorldLights(overworldGroup, world);

    for (const node of world.gatheringNodes || []) {
      const marker = buildGatheringNodeMarker(node.nodeType);
      marker.position.set(node.position.x, node.position.y, node.position.z);
      overworldGroup.add(marker);
      gatherNodeMeshes.set(node.id, marker);
    }
    for (const npc of world.npcs || []) npcDefs.set(npc.id, npc);
    activeEventObjects = world.events || [];
    for (const [evId, st] of Object.entries(eventObjectStates || {})) eventObjectVisibility.set(evId, st.visible !== false);
    for (const ev of activeEventObjects) applyEventObjectVisibility(ev); // props' meshes exist by now; NPCs' don't yet — re-applied when their mesh is built below
    for (const q of questDefs || []) questCatalog.set(q.id, q);
    for (const r of recipeDefs || []) recipeCatalog.set(r.id, r);
    for (const st of stationTypeDefs || []) craftingStationTypesById.set(st.id, st);
    professions = initialProfessions || {};
    if (initialQuestState) questState = initialQuestState;
    eventQuestLog = initialEventQuestLog || {};
    eventSwitches = initialEventSwitches || {};
    for (const [nodeId, availableAt] of Object.entries(gatherNodeStates || {})) {
      gatherNodeAvailableAt.set(nodeId, availableAt);
      if (availableAt > Date.now()) setGatheringNodeDepleted(gatherNodeMeshes.get(nodeId), true);
    }
    Object.assign(inventory, initialInventory || {});
    Object.assign(equipment, initialEquipment || {});
    gold = welcomeGold || 0;
    vendorInfo = welcomeVendor || null;
    storeEntranceInfo = storeEntrance || null;
    refreshGoldUI();
    syncInventoryUI();

    xpUI.level = level || 1;
    xpUI.xp = xp || 0;
    xpUI.xpToNext = xpToNext || 100;
    refreshXpUI();

    unassignedStatPoints = welcomeStatPoints || 0;
    allocatedStats = { ...zeroStats(), ...(welcomeAllocatedStats || {}) };
    pendingStatDelta = zeroStats();
    refreshHotbarLockState(); // hotbar was built before the real level arrived (see below)

    localMesh = buildPlayerMesh(localCharacterWithLoadout());
    localMesh.position.set(position.x, position.y, position.z);
    applySpawnFacing(position, facing, { resetView: true }); // the default overworld's authored spawn facing + its authored default camera framing
    scene.add(localMesh);
    net.sendCharacter(myCharacter);
    playerCharacters.set(id, myCharacter);
    refreshLocalNameplate();

    populateRemoteRoster(existingPlayers);

    predicted = new PredictedPlayer(position);
    const className = CLASS_META[myCharacter.classId]?.name || myCharacter.classId;
    // Your character's name, not the socket id. The socket id is regenerated on
    // every connection, so this used to read as a different random player after
    // every refresh. Characters made before names existed fall back.
    document.getElementById('status').textContent = `${displayName(myCharacter)} — ${className}`;
  },
  onState: ({ players, monsters, npcs }) => {
    if (inTower || inStore) return; // irrelevant to the floor/store I'm currently in
    targetStateCache.clear();
    for (const p of players) {
      playerHealth.set(p.id, { health: p.health, maxHealth: p.maxHealth }); // for party member bars
      targetStateCache.set(p.id, { kind: 'player', name: playerDisplayName(p.id), health: p.health, maxHealth: p.maxHealth });
      if (p.id === localId) {
        predicted?.reconcile(p.position, { ack: p.seq });
        healthUI.health = p.health;
        healthUI.maxHealth = p.maxHealth;
        localStatusEffects = p.statusEffects || [];
        continue;
      }
      let mesh = remoteMeshes.get(p.id);
      if (!mesh) {
        mesh = buildPlayerMesh({ seed: hashStringToSeed(p.id), outfitColor: 0xc23b3b });
        remoteMeshes.set(p.id, mesh);
        attachPlayerNameplate(p.id, mesh);
        scene.add(mesh);
      }
      applyRemotePosition(mesh, p.position);
    }
    if (partyMembers.length) refreshPartyPanel();
    // Overworld monsters — same lazy create/update/remove-on-death pattern as
    // floor monsters (onFloorState below), just parented to overworldGroup
    // instead of floorGroup so tower/store visibility toggling hides them for free.
    for (const m of monsters || []) {
      targetStateCache.set(m.id, { kind: 'monster', name: monsterDisplayName(m.type), health: m.health, maxHealth: m.maxHealth });
      let mesh = overworldMonsterMeshes.get(m.id);
      if (m.health <= 0) {
        if (mesh) {
          if (mesh.userData.healthBar) overworldGroup.remove(mesh.userData.healthBar); // sibling, not a child — not auto-removed with mesh
          overworldGroup.remove(mesh);
          overworldMonsterMeshes.delete(m.id);
        }
        continue;
      }
      if (!mesh) {
        if (!monsterCatalogReady) continue; // see monsterCatalogReady — building now would cache a slime for a real catalog type
        mesh = buildMonsterMesh(m.type, hashStringToSeed(m.id), monsterTypesById);
        mesh.scale.setScalar(m.scale ?? 1);
        if (m.color !== undefined) applyColorTint(mesh, m.color);
        mesh.userData.monsterType = m.type; // looked up on 'monster-ability-used' to find the fired ability's full def
        const healthBar = buildMonsterHealthBar(m.type === 'boss-golem' ? 3.2 : 1.6);
        overworldGroup.add(mesh, healthBar); // sibling, not a child of mesh — see buildMonsterHealthBar's doc comment
        mesh.userData.healthBar = healthBar;
        overworldMonsterMeshes.set(m.id, mesh);
      }
      applyRemotePosition(mesh, m.position); // also flags movingUntil + faces travel dir, so the walk cycle can run
      if (mesh.userData.healthBar) {
        updateMonsterHealthBar(mesh.userData.healthBar, m.health / m.maxHealth, camera, mesh);
      }
    }
    // Town NPCs — lazily built from the static def (name/appearance) received
    // in welcome, keyed by the id in each minimal {id, position} tick entry.
    // Reuses applyRemotePosition for the same walk-cycle + face-travel-direction
    // handling remote players get (NPCs only send positions, never input).
    for (const n of npcs || []) {
      let mesh = overworldNpcMeshes.get(n.id);
      if (!mesh) {
        const def = npcDefs.get(n.id);
        if (!def) continue; // an NPC we have no def for (world/server out of sync) — skip rather than guess
        mesh = buildPlayerMesh(def.appearance || { seed: hashStringToSeed(n.id) });
        // Grouped so distance culling (toggling nameplate.visible below) can't
        // fight with updateQuestIndicatorSprite's own state-based visibility —
        // a Three.js child stays hidden if ANY ancestor is invisible regardless
        // of its own `visible` flag, so the group is the single distance switch.
        const nameplate = new THREE.Group();
        nameplate.add(buildNameLabel(def.name));
        const questIndicator = buildQuestIndicatorSprite();
        nameplate.add(questIndicator);
        mesh.add(nameplate);
        mesh.userData.questIndicator = questIndicator;
        mesh.userData.nameplate = nameplate;
        mesh.position.set(n.position.x, n.position.y, n.position.z);
        // Authored facing (World Editor → NPCs → Facing). Only meaningful for
        // a standing NPC — applyRemotePosition overwrites rotation.y the moment
        // one actually walks anywhere, which is what a wanderer should do.
        mesh.rotation.y = ((def.facingDeg || 0) * Math.PI) / 180;
        overworldGroup.add(mesh);
        overworldNpcMeshes.set(n.id, mesh);
        const attachedEvent = eventAttachedToNpc(n.id);
        if (attachedEvent) applyEventObjectVisibility(attachedEvent); // this NPC's mesh just got built for the first time — catch up to any hidden state from before we connected
      }
      applyRemotePosition(mesh, n.position);
    }
    refreshTargetPanel();
  },
  onPlayerJoined: ({ id, position, character, equipmentLoadout, guild }) => {
    if (character) playerCharacters.set(id, character);
    if (guild !== undefined) playerGuilds.set(id, guild);
    if (equipmentLoadout) otherPlayerWeaponLoadouts.set(id, equipmentLoadout);
    if (inTower || inStore || id === localId || remoteMeshes.has(id)) return;
    const mesh = buildPlayerMesh(withWeaponLoadout(id, character || { seed: hashStringToSeed(id), outfitColor: 0xc23b3b }));
    mesh.position.set(position.x, position.y, position.z);
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  onPlayerCharacter: ({ id, character, guild }) => {
    playerCharacters.set(id, character);
    if (guild !== undefined) playerGuilds.set(id, guild);
    if (inTower || inStore || id === localId) return;
    const old = remoteMeshes.get(id);
    const mesh = buildPlayerMesh(withWeaponLoadout(id, character));
    if (old) {
      mesh.position.copy(old.position);
      scene.remove(old);
    }
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  // A live equip/unequip elsewhere — same rebuild-mesh-in-place pattern as
  // onPlayerCharacter above (that one's for cosmetic changes, this one's
  // for gear), since a weapon can't hot-swap onto an already-built rig.
  onPlayerWeaponLoadout: ({ id, loadout }) => {
    otherPlayerWeaponLoadouts.set(id, loadout);
    if (inTower || inStore || id === localId) return;
    const old = remoteMeshes.get(id);
    if (!old) return; // not currently visible to us — the map update above is enough, picked up next time their mesh is (re)built
    const mesh = buildPlayerMesh(withWeaponLoadout(id, playerCharacters.get(id)));
    mesh.position.copy(old.position);
    mesh.rotation.copy(old.rotation);
    scene.remove(old);
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  onPlayerLeft: ({ id }) => {
    playerCharacters.delete(id);
    playerGuilds.delete(id);
    otherPlayerWeaponLoadouts.delete(id);
    if (inTower || inStore) return;
    const mesh = remoteMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      remoteMeshes.delete(id);
    }
  },
  onAbilityResult: ({ ok, abilityId, resource, cooldownEndsAt, castMs, reason }) => {
    const ability = classDef.abilities.find((a) => a.id === abilityId);
    if (!ability) return;
    if (ok) {
      abilityUI.resource = resource;
      abilityUI.cooldownEndsAt[abilityId] = cooldownEndsAt + clockOffset;
      if (castMs > 0) startCastBar(castMs);
    } else {
      flashSlot(ability.key, 'denied', 350);
      if (reason === 'out-of-range') showTransientMessage('Out of range');
      else if (reason === 'locked') showTransientMessage(`Unlocks at level ${ability.requiredLevel}`);
    }
  },
  onCastInterrupted: (msg) => {
    interruptCastBar();
  },
  onAbilityUsed: ({ id, abilityId, targetId }) => {
    const character = playerCharacters.get(id);
    if (!character) return;
    let ability;
    try {
      ability = getAbilityDef(character.classId, abilityId);
    } catch {
      return; // unknown class/ability combo — ignore rather than crash rendering
    }
    const mesh = id === localId ? localMesh : remoteMeshes.get(id);
    if (mesh) {
      let targetMesh = findMeshById(targetId);
      if (!targetMesh && ability.targeting?.modes?.includes('enemy')) {
        targetMesh = nearestEnemyMeshInRange(mesh.position, ability.targeting.range ?? 15);
      }
      triggerAbilityAnimation(scene, mesh, ability, vfxSystem, targetMesh ? targetMesh.position : null);
    }
    if (ability.soundUrl) playAbilitySound(ability.soundUrl); // every client hears it, same as the VFX above
    if (id === localId) flashSlot(ability.key, 'flash-effect', ability.windupMs + ability.effectMs);
  },
  onMonsterAbilityUsed: ({ monsterId, abilityId }) => {
    // Legacy monsters (slime/goblin/boss-golem, or any hand-authored spawn
    // with no catalog type) fire a synthesized {id:'attack',...} ability
    // that never matches a monsterTypesById entry — no VFX for them, same
    // as today (monsters have never had ability bursts before this
    // feature). Only catalog-typed monsters with a real ability def get one,
    // and even then only the flat flash burst (monster abilities have no
    // `vfx` field — see the plan's "Monster abilities NOT unified" decision).
    const mesh = overworldMonsterMeshes.get(monsterId) || monsterMeshes.get(monsterId);
    if (!mesh) return;
    const monsterType = monsterTypesById[mesh.userData.monsterType];
    const ability = monsterType?.abilitySlots.find((a) => a.id === abilityId);
    if (ability) triggerAbilityAnimation(scene, mesh, ability);
  },
  onFloorEntered: ({ floorNumber, floorDef, position, monsters, existingFloorPlayers }) => {
    vendorPanelOpen = false;
    vendorPanelEl.style.display = 'none';
    closeMerchantPanel();
    inTower = true;
    currentFloorNumber = floorNumber;
    currentFloorDef = floorDef;
    activeBounds = floorDef.bounds;
    activeTerrainWorld = floorDef;
    activeCollision = null; // a tower floor is a bare room

    overworldGroup.visible = false;
    floorGroup.visible = true;
    clearGroup(floorGroup);
    buildFloorMeshes(floorGroup, floorDef);
    toonify(floorGroup); // World Editor's floor preview does the same (src/editor/main.js's rebuildFloorView) — kept in sync so the editor matches what players see

    monsterMeshes.clear();
    for (const m of monsters) {
      const mesh = buildMonsterMesh(m.type, hashStringToSeed(m.id), monsterTypesById);
      mesh.scale.setScalar(m.scale ?? 1);
      if (m.color !== undefined) applyColorTint(mesh, m.color);
      mesh.userData.monsterType = m.type;
      mesh.position.set(m.position.x, m.position.y, m.position.z);
      const healthBar = buildMonsterHealthBar(m.type === 'boss-golem' ? 3.2 : 1.6);
      healthBar.position.set(m.position.x, m.position.y + healthBar.userData.barHeight, m.position.z); // initial placement — the first onFloorState tick (which calls updateMonsterHealthBar) may be a beat away
      floorGroup.add(mesh, healthBar); // sibling, not a child of mesh — see buildMonsterHealthBar's doc comment
      mesh.userData.healthBar = healthBar;
      monsterMeshes.set(m.id, mesh);
    }

    populateRemoteRoster(existingFloorPlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);

    const label = floorDef.isBossFloor ? `Floor ${floorNumber} — BOSS  (Q to leave)` : `Floor ${floorNumber} / ${towerMeta?.maxFloor ?? '?'}  (Q to leave)`;
    const indicator = document.getElementById('floor-indicator');
    indicator.textContent = label;
    indicator.style.display = 'block';
  },
  onFloorState: ({ floorNumber, players, monsters }) => {
    if (floorNumber !== currentFloorNumber) return; // stale event from a floor we've since left
    targetStateCache.clear();
    for (const p of players) {
      playerHealth.set(p.id, { health: p.health, maxHealth: p.maxHealth });
      targetStateCache.set(p.id, { kind: 'player', name: playerDisplayName(p.id), health: p.health, maxHealth: p.maxHealth });
      if (p.id === localId) {
        predicted?.reconcile(p.position, { ack: p.seq });
        healthUI.health = p.health;
        healthUI.maxHealth = p.maxHealth;
        localStatusEffects = p.statusEffects || [];
        continue;
      }
      let mesh = remoteMeshes.get(p.id);
      if (!mesh) {
        mesh = buildPlayerMesh(withWeaponLoadout(p.id, playerCharacters.get(p.id) || { seed: hashStringToSeed(p.id), outfitColor: 0xc23b3b }));
        remoteMeshes.set(p.id, mesh);
        attachPlayerNameplate(p.id, mesh);
        scene.add(mesh);
      }
      applyRemotePosition(mesh, p.position);
    }
    if (partyMembers.length) refreshPartyPanel();
    for (const m of monsters) {
      targetStateCache.set(m.id, { kind: 'monster', name: monsterDisplayName(m.type), health: m.health, maxHealth: m.maxHealth });
      const mesh = monsterMeshes.get(m.id);
      if (!mesh) continue;
      if (m.health <= 0) {
        if (mesh.userData.healthBar) floorGroup.remove(mesh.userData.healthBar); // sibling, not a child — not auto-removed with mesh
        floorGroup.remove(mesh);
        monsterMeshes.delete(m.id);
        continue;
      }
      applyRemotePosition(mesh, m.position); // also flags movingUntil + faces travel dir, so the walk cycle can run
      if (mesh.userData.healthBar) {
        updateMonsterHealthBar(mesh.userData.healthBar, m.health / m.maxHealth, camera, mesh);
      }
    }
    refreshTargetPanel();
  },
  onFloorPlayerJoined: ({ id, position, character }) => {
    if (character) playerCharacters.set(id, character);
    if (id === localId || remoteMeshes.has(id)) return;
    const mesh = buildPlayerMesh(withWeaponLoadout(id, character || { seed: hashStringToSeed(id), outfitColor: 0xc23b3b }));
    mesh.position.set(position.x, position.y, position.z);
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  onFloorPlayerLeft: ({ id }) => {
    const mesh = remoteMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      remoteMeshes.delete(id);
    }
  },
  onFloorExited: ({ position, existingPlayers }) => {
    inTower = false;
    currentFloorNumber = 0;
    currentFloorDef = null;
    activeBounds = world.bounds;
    activeTerrainWorld = world;
    activeCollision = overworldCollision;

    floorGroup.visible = false;
    clearGroup(floorGroup);
    monsterMeshes.clear();
    overworldGroup.visible = true;

    populateRemoteRoster(existingPlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);

    document.getElementById('floor-indicator').style.display = 'none';
  },
  onStoreEntered: ({ interior, position, existingStorePlayers }) => {
    inStore = true;
    activeBounds = interior.bounds;
    activeTerrainWorld = interior;
    activeCollision = null; // the store interior is a hand-built room

    overworldGroup.visible = false;
    storeGroup.visible = true;
    clearGroup(storeGroup);
    buildStoreInteriorMeshes(storeGroup, interior);

    populateRemoteRoster(existingStorePlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);

    document.getElementById('floor-indicator').textContent = interior.npc.name + "'s Store  (Q to leave)";
    document.getElementById('floor-indicator').style.display = 'block';
  },
  onStoreState: ({ players }) => {
    if (!inStore) return;
    for (const p of players) {
      if (p.id === localId) {
        predicted?.reconcile(p.position, { ack: p.seq });
        healthUI.health = p.health;
        healthUI.maxHealth = p.maxHealth;
        localStatusEffects = p.statusEffects || [];
        continue;
      }
      let mesh = remoteMeshes.get(p.id);
      if (!mesh) {
        mesh = buildPlayerMesh(withWeaponLoadout(p.id, playerCharacters.get(p.id) || { seed: hashStringToSeed(p.id), outfitColor: 0xc23b3b }));
        remoteMeshes.set(p.id, mesh);
        attachPlayerNameplate(p.id, mesh);
        scene.add(mesh);
      }
      applyRemotePosition(mesh, p.position);
    }
  },
  onStorePlayerJoined: ({ id, position, character }) => {
    if (character) playerCharacters.set(id, character);
    if (id === localId || remoteMeshes.has(id)) return;
    const mesh = buildPlayerMesh(withWeaponLoadout(id, character || { seed: hashStringToSeed(id), outfitColor: 0xc23b3b }));
    mesh.position.set(position.x, position.y, position.z);
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  onStorePlayerLeft: ({ id }) => {
    const mesh = remoteMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      remoteMeshes.delete(id);
    }
  },
  onStoreExited: ({ position, existingPlayers }) => {
    inStore = false;
    activeBounds = world.bounds;
    activeTerrainWorld = world;
    activeCollision = overworldCollision;

    storeGroup.visible = false;
    clearGroup(storeGroup);
    overworldGroup.visible = true;

    populateRemoteRoster(existingPlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);

    document.getElementById('floor-indicator').style.display = 'none';
    vendorPanelOpen = false;
    vendorPanelEl.style.display = 'none';
    closeMerchantPanel();
  },
  onTowerDenied: ({ reason }) => {
    const messages = {
      'too-far': "You're too far from the Tower entrance.",
      'not-at-exit': 'Get closer to the glowing exit to advance.',
      'floor-not-cleared': 'Clear this floor first.',
      'top-of-tower': "You've reached the top of the Tower!",
      'already-inside': "You're already inside the Tower.",
      locked: 'Clear the previous floor first.',
      'missing-map': 'That floor has no map assigned yet.',
    };
    showTransientMessage(messages[reason] || 'Action denied.');
  },
  onPlayerDied: ({ respawnMs }) => {
    isDeadLocally = true;
    deathSubEl.textContent = `Respawning in ${Math.ceil(respawnMs / 1000)}s...`;
    deathOverlayEl.style.display = 'flex';
  },
  onPlayerRespawned: ({ position, facing, existingPlayers }) => {
    isDeadLocally = false;
    inTower = false;
    currentFloorNumber = 0;
    currentFloorDef = null;
    activeBounds = world.bounds;
    activeTerrainWorld = world;
    activeCollision = overworldCollision;
    // Respawning always lands on the default overworld, so its camera zoom
    // range has to come back with it — otherwise dying inside a dungeon leaves
    // that dungeon's (possibly much tighter) limits in force out here.
    activeGraphicsSettings = world.graphicsSettings || defaultGraphicsSettings();
    applyPlayerCameraLimits();

    floorGroup.visible = false;
    clearGroup(floorGroup);
    monsterMeshes.clear();
    overworldGroup.visible = true;

    populateRemoteRoster(existingPlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);
    applySpawnFacing(position, facing);

    document.getElementById('floor-indicator').style.display = 'none';
    deathOverlayEl.style.display = 'none';
  },
  onBossDefeated: () => {
    bossBannerEl.textContent = 'Boss Defeated!';
    bossBannerEl.style.display = 'block';
    setTimeout(() => { bossBannerEl.style.display = 'none'; }, 3000);
  },
  onXpGained: ({ amount, level, xp, xpToNext }) => {
    xpUI.level = level;
    xpUI.xp = xp;
    xpUI.xpToNext = xpToNext;
    refreshXpUI();
    refreshHotbarLockState();
    showGatherToast(`+${amount} XP`);
  },
  onLevelUp: ({ level, unassignedStatPoints: newPoints }) => {
    if (typeof newPoints === 'number') {
      unassignedStatPoints = newPoints;
      if (statsPanelOpen) refreshStatsPanel();
    }
    levelUpBannerEl.textContent = `Level Up! Lv. ${level}`;
    levelUpBannerEl.style.display = 'block';
    setTimeout(() => { levelUpBannerEl.style.display = 'none'; }, 3000);
    refreshHotbarLockState();
    if (skillbookOpen) refreshSkillbookPanel();
  },
  onLootDrop: ({ drops, inventory: serverInventory }) => {
    if (serverInventory) { Object.keys(inventory).forEach((k) => delete inventory[k]); Object.assign(inventory, serverInventory); }
    syncInventoryUI();
    for (const drop of drops || []) {
      showGatherToast(`+${drop.qty} ${resolveItemDisplay(drop.itemId).name}`);
    }
  },
  onQuestState: ({ active, completed }) => {
    questState = { active: active || {}, completed: completed || {} };
    if (questLogOpen) refreshQuestLog();
  },
  onNpcQuests: ({ npcId, offers, turnIns }) => {
    if (npcId !== dialogNpcId) return; // a reply for an NPC we're no longer talking to
    currentNpcQuests = { offers: offers || [], turnIns: turnIns || [] };
    renderDialogQuests();
  },
  onQuestAccepted: () => {
    showGatherToast('Quest Accepted!');
  },
  // A wholesale replacement of the switch mirror, pushed by the server when a
  // quest's switchOnAccept/switchOnComplete fires (see its applyQuestSwitches).
  // Head-icons read these through canAccept, so a follow-up quest unlocked by
  // the switch that just flipped shows its "!" immediately rather than after
  // the next reconnect.
  onEventSwitches: (switches) => {
    eventSwitches = switches || {};
  },
  onQuestTurnInResult: ({ ok, questId, rewards, inventory: serverInventory, gold: serverGold, reason }) => {
    if (!ok) {
      showTransientMessage(reason === 'not-complete' ? 'Objective not complete yet.' : 'Cannot turn that in.');
      return;
    }
    if (serverInventory) { Object.keys(inventory).forEach((k) => delete inventory[k]); Object.assign(inventory, serverInventory); }
    if (typeof serverGold === 'number') { gold = serverGold; refreshGoldUI(); }
    syncInventoryUI();
    // rewards.items is an ARRAY of {itemId, qty} (see QuestDef in
    // src/sim/quests.js) — this used to read a flat r.itemId/r.itemQty that no
    // reward has ever had, so item rewards were silently missing from the
    // toast. resolveItemDisplay covers authored items too, which getItemDef
    // alone throws on.
    const r = rewards || {};
    const parts = [
      r.xp && `${r.xp} XP`,
      r.gold && `${r.gold}g`,
      ...(r.items || []).map((it) => `${it.qty || 1}× ${resolveItemDisplay(it.itemId).name}`),
    ].filter(Boolean);
    showGatherToast(`Quest Completed! ${parts.length ? '+' + parts.join(', ') : ''}`);
  },
  onPartyState: ({ members }) => {
    partyMembers = members || [];
    refreshPartyPanel();
  },
  onPartyInvite: ({ partyId, inviterLabel }) => {
    pendingPartyInvite = { partyId, inviterLabel };
    partyInvitePromptEl.textContent = `${inviterLabel} invited you to a party — press Y to accept`;
    partyInvitePromptEl.style.display = 'block';
    setTimeout(() => {
      if (pendingPartyInvite?.partyId === partyId) { pendingPartyInvite = null; partyInvitePromptEl.style.display = 'none'; }
    }, 30000);
  },
  onPartyError: ({ reason }) => {
    const messages = {
      'already-in-party': 'They (or you) are already in a party.',
      'party-full': 'That party is full.',
      'not-leader': 'Only the party leader can invite.',
      'no-invite': 'No pending invite.',
      expired: 'That invite expired.',
      'party-gone': 'That party no longer exists.',
    };
    showTransientMessage(messages[reason] || 'Party action failed.');
  },
  // --- Multi-map support (teleporters) ---
  // The default overworld map is "home base": isDefaultOverworld=true means
  // this event is just a reposition (possibly returning from a real other
  // map, possibly a same-map quick-travel pair that never actually left it
  // — both cases are safely idempotent to run the same restore-overworld
  // logic against). Anything else builds `world` (a full IWorld doc, same
  // shape the overworld itself is) into the shared `mapGroup` via the
  // SAME buildWorldMeshes the overworld uses — no new render code needed.
  onMapEntered: ({ mapId, world: mapWorld, position, facing, existingMapPlayers, isDefaultOverworld, monsters }) => {
    vendorPanelOpen = false;
    vendorPanelEl.style.display = 'none';
    closeMerchantPanel();
    closeTowerPanel();
    // Any map change ends the run as far as the HUD is concerned. Entering
    // the NEXT tower floor also arrives as a map-entered, but its
    // 'tower-floor-entered' follows immediately after on the same (ordered)
    // socket and re-establishes the run — so clearing here is safe and
    // covers every other way out (leaving, dying, the instance closing).
    endTowerRunUI();
    inTower = false;
    inStore = false;
    document.getElementById('floor-indicator').style.display = 'none';

    if (isDefaultOverworld) {
      currentMapId = null;
      clearMapParticles(); // before clearGroup, which detaches without disposing
      clearGroup(mapGroup);
      monsterMeshes.clear(); // a dungeon instance's monsters, if we were just in one
      mapGroup.visible = false;
      floorGroup.visible = false;
      storeGroup.visible = false;
      overworldGroup.visible = true;
      activeBounds = world.bounds;
      activeTerrainWorld = world;
      activeCollision = overworldCollision;
      activeTeleporters = world.teleporters || [];
      activeGraphicsSettings = world.graphicsSettings || defaultGraphicsSettings();
      applyActiveGraphicsSettings(); // no new meshes about to build here, so anisotropy-before-textures ordering doesn't matter
      populateRemoteRoster(existingMapPlayers);
      predicted = new PredictedPlayer(position);
      localMesh.position.set(position.x, position.y, position.z);
      applySpawnFacing(position, facing, { resetView: true }); // back on the overworld — its own default framing, not the dungeon's
      return;
    }

    currentMapId = mapId;
    overworldGroup.visible = false;
    floorGroup.visible = false;
    storeGroup.visible = false;
    mapGroup.visible = true;
    clearMapParticles(); // before clearGroup, which detaches without disposing
    clearGroup(mapGroup);
    activeGraphicsSettings = mapWorld.graphicsSettings || defaultGraphicsSettings();
    // Anisotropy must land before buildWorldMeshes creates any ground/path/
    // mountain textures — they read it at creation time (see renderSettings.js).
    setCurrentAnisotropy(activeGraphicsSettings.anisotropy);
    // NOT followed by its own toonify(mapGroup) call — buildWorldMeshes
    // already toonifies internally at the right point in its own pipeline
    // (before building the ground-texture overlay/water/seabed, each of
    // which carries a custom onBeforeCompile shader toonify() doesn't know
    // how to preserve). A second sweep here used to clobber the overlay's
    // material back to a plain MeshToonMaterial sampling its dummy texture
    // stretched across raw UV — the exact "ground texture stretched across
    // the whole map" bug this project already fixed once for the overworld
    // (see buildWorldMeshes' own comments), reintroduced here for every
    // OTHER map via this redundant call. Removed.
    buildWorldMeshes(mapGroup, mapWorld, objectDefsById, ATMOSPHERE, buildingCatalogForRender);
    buildMapParticles(mapWorld, activeGraphicsSettings);
    applyPostProcessingSettings(activeGraphicsSettings);
    applyGraphicsSettingsToAtmosphere(scene, activeGraphicsSettings);
    applyPlayerCameraLimits(); // before applySpawnFacing below, which clamps the default distance into this range
    warmUpPostProcessing(); // see postProcessing.js's warmUp() for why this exists
    mapCollision = buildCollisionIndex(mapWorld, objectDefsById, modelCatalogById);
    activeBounds = mapWorld.bounds;
    activeTerrainWorld = mapWorld;
    activeCollision = mapCollision;
    activeTeleporters = mapWorld.teleporters || [];

    // `monsters` is only present when this map is a live dungeon instance
    // (see server/index.js's enterDungeonMap) — a plain building/overworld
    // map has no live monster state yet, same as Phase 3 left it.
    monsterMeshes.clear();
    for (const m of monsters || []) {
      const mesh = buildMonsterMesh(m.type, hashStringToSeed(m.id), monsterTypesById);
      mesh.scale.setScalar(m.scale ?? 1);
      if (m.color !== undefined) applyColorTint(mesh, m.color);
      mesh.userData.monsterType = m.type;
      mesh.position.set(m.position.x, m.position.y, m.position.z);
      const healthBar = buildMonsterHealthBar(m.type === 'boss-golem' ? 3.2 : 1.6);
      healthBar.position.set(m.position.x, m.position.y + healthBar.userData.barHeight, m.position.z);
      mapGroup.add(mesh, healthBar); // sibling, not a child of mesh — see buildMonsterHealthBar's doc comment
      mesh.userData.healthBar = healthBar;
      monsterMeshes.set(m.id, mesh);
    }

    populateRemoteRoster(existingMapPlayers);
    predicted = new PredictedPlayer(position);
    localMesh.position.set(position.x, position.y, position.z);
    applySpawnFacing(position, facing, { resetView: true }); // this map's own default framing (a corridor dungeon wants a much closer camera than the overworld)

    document.getElementById('floor-indicator').textContent = `${mapWorld.name}`;
    document.getElementById('floor-indicator').style.display = 'block';
  },
  onMapState: ({ mapId, players, monsters }) => {
    if (mapId !== currentMapId) return; // stale event from a map we've since left
    targetStateCache.clear();
    for (const p of players) {
      targetStateCache.set(p.id, { kind: 'player', name: playerDisplayName(p.id), health: p.health, maxHealth: p.maxHealth });
      if (p.id === localId) {
        predicted?.reconcile(p.position, { ack: p.seq });
        healthUI.health = p.health;
        healthUI.maxHealth = p.maxHealth;
        localStatusEffects = p.statusEffects || [];
        continue;
      }
      let mesh = remoteMeshes.get(p.id);
      if (!mesh) {
        mesh = buildPlayerMesh(withWeaponLoadout(p.id, playerCharacters.get(p.id) || { seed: hashStringToSeed(p.id), outfitColor: 0xc23b3b }));
        remoteMeshes.set(p.id, mesh);
        attachPlayerNameplate(p.id, mesh);
        scene.add(mesh);
      }
      applyRemotePosition(mesh, p.position);
    }
    // Only present for a live dungeon instance — same sync as onFloorState's
    // monster handling, just targeting mapGroup's monster meshes.
    for (const m of monsters || []) {
      targetStateCache.set(m.id, { kind: 'monster', name: monsterDisplayName(m.type), health: m.health, maxHealth: m.maxHealth });
      const mesh = monsterMeshes.get(m.id);
      if (!mesh) continue;
      if (m.health <= 0) {
        if (mesh.userData.healthBar) mapGroup.remove(mesh.userData.healthBar);
        mapGroup.remove(mesh);
        monsterMeshes.delete(m.id);
        continue;
      }
      applyRemotePosition(mesh, m.position);
      if (mesh.userData.healthBar) {
        updateMonsterHealthBar(mesh.userData.healthBar, m.health / m.maxHealth, camera, mesh);
      }
    }
    refreshTargetPanel();
  },
  onMapPlayerJoined: ({ id, position, character }) => {
    if (character) playerCharacters.set(id, character);
    if (id === localId || remoteMeshes.has(id)) return;
    const mesh = buildPlayerMesh(withWeaponLoadout(id, character || { seed: hashStringToSeed(id), outfitColor: 0xc23b3b }));
    mesh.position.set(position.x, position.y, position.z);
    remoteMeshes.set(id, mesh);
    attachPlayerNameplate(id, mesh);
    scene.add(mesh);
  },
  onMapPlayerLeft: ({ id }) => {
    const mesh = remoteMeshes.get(id);
    if (mesh) {
      scene.remove(mesh);
      remoteMeshes.delete(id);
    }
  },
  onTeleportDenied: ({ reason }) => {
    const messages = { 'too-far': "You're too far from that teleporter.", unlinked: "This teleporter isn't linked to anything yet." };
    showTransientMessage(messages[reason] || 'Cannot use that teleporter right now.');
  },
  // Fires right before the server's own `map-entered` (isDefaultOverworld)
  // that actually moves everyone still inside back out — this is purely
  // the "why did I just get moved" explanation.
  onDungeonClosed: () => {
    showTransientMessage('The dungeon has closed.');
  },
  onGatherResult: ({ ok, nodeId, itemId, quantity, inventory: serverInventory, reason, availableAt }) => {
    if (ok) {
      Object.assign(inventory, serverInventory);
      syncInventoryUI();
      showGatherToast(quantity > 0 ? `+${quantity} ${getItemDef(itemId).name}` : 'No luck this time...');
      gatherNodeAvailableAt.set(nodeId, availableAt);
    } else {
      const messages = { 'too-far': 'Too far from that resource.', 'on-cooldown': 'Still recovering — try again soon.' };
      showTransientMessage(messages[reason] || 'Cannot gather right now.');
      if (availableAt) gatherNodeAvailableAt.set(nodeId, availableAt);
    }
  },
  onGatherNodeDepleted: ({ nodeId, availableAt }) => {
    gatherNodeAvailableAt.set(nodeId, availableAt);
    const mesh = gatherNodeMeshes.get(nodeId);
    if (mesh) setGatheringNodeDepleted(mesh, true);
  },
  onCraftResult: ({ ok, recipeId, inventory: serverInventory, professions: serverProfessions, reason, crit, outputItemId, yieldQty }) => {
    const recipe = recipeCatalog.get(recipeId);
    if (ok) {
      Object.assign(inventory, serverInventory);
      professions = serverProfessions || professions;
      syncInventoryUI();
      const name = resolveItemDisplay(outputItemId).name;
      showGatherToast(crit ? `Critical craft! +${yieldQty} ${name}` : `Crafted +${yieldQty} ${name}`);
    } else {
      const messages = {
        'unknown-recipe': 'Unknown recipe.',
        'level-too-low': `Requires a higher ${recipe?.profession || ''} level.`,
        'insufficient-reagents': 'Missing reagents.',
        'craft-failed': 'The craft failed!',
        'no-station-open': 'Open a crafting station first.',
        'wrong-station': "This station can't make that.",
        'too-far': 'Too far from the crafting station.',
      };
      showGatherToast(messages[reason] || 'Cannot craft that.');
      if (serverInventory) { Object.assign(inventory, serverInventory); syncInventoryUI(); }
    }
    // Advance/stop the batch queue regardless of outcome — a failure (or the
    // player having walked out of range mid-batch) truncates the rest of the
    // run rather than hammering the server with doomed repeat attempts.
    if (craftBatchQueue.length) craftBatchQueue.shift();
    if (ok && craftBatchQueue.length && craftBatchQueue[0] === recipeId) {
      net.craft(recipeId, 1);
    } else {
      craftBatchQueue = [];
    }
    if (craftPanelOpen) refreshCraftPanel();
  },
  onSellResult: ({ ok, itemId, quantity, earned, gold: newGold, inventory: serverInventory, reason }) => {
    if (ok) {
      Object.assign(inventory, serverInventory);
      gold = newGold;
      refreshGoldUI();
      syncInventoryUI();
      showGatherToast(`Sold ${quantity} ${getItemDef(itemId).name} for ${earned}g`);
    } else {
      const messages = { 'too-far': 'Too far from the vendor.', 'insufficient-items': "You don't have that many." };
      showTransientMessage(messages[reason] || 'Cannot sell that.');
    }
  },
  onMerchantBuyResult: ({ ok, itemId, quantity, cost, gold: newGold, inventory: serverInventory, reason }) => {
    if (ok) {
      Object.assign(inventory, serverInventory);
      gold = newGold;
      refreshGoldUI();
      syncInventoryUI();
      if (merchantPanelOpen) refreshMerchantPanel();
      showGatherToast(`Bought ${quantity} ${resolveItemDisplay(itemId).name} for ${cost}g`);
    } else {
      const messages = {
        'too-far': 'Too far from the merchant.', 'not-sold-here': "This merchant doesn't sell that.",
        'out-of-stock': 'Out of stock.', 'insufficient-gold': "You don't have enough gold.",
      };
      showTransientMessage(messages[reason] || 'Cannot buy that.');
    }
  },
  onMerchantSellResult: ({ ok, itemId, quantity, earned, gold: newGold, inventory: serverInventory, reason }) => {
    if (ok) {
      Object.assign(inventory, serverInventory);
      gold = newGold;
      refreshGoldUI();
      syncInventoryUI();
      if (merchantPanelOpen) refreshMerchantPanel();
      showGatherToast(`Sold ${quantity} ${resolveItemDisplay(itemId).name} for ${earned}g`);
    } else {
      const messages = {
        'too-far': 'Too far from the merchant.', 'insufficient-items': "You don't have that many.", 'not-sellable': 'This item has no sell value.',
      };
      showTransientMessage(messages[reason] || 'Cannot sell that.');
    }
  },
  onEquipmentResult: ({ ok, action, itemId, slot, reason, equipment: serverEquipment, inventory: serverInventory, maxHealth: newMaxHealth, health: newHealth, derived }) => {
    if (ok) {
      Object.assign(equipment, serverEquipment);
      Object.assign(inventory, serverInventory);
      if (typeof newMaxHealth === 'number') healthUI.maxHealth = newMaxHealth;
      if (typeof newHealth === 'number') healthUI.health = newHealth;
      if (derived) playerDerived = derived;
      syncInventoryUI();
      rebuildLocalMesh(); // so the player sees their own held weapon in the world, not just in the Equipment panel preview
      if (equipmentPanelOpen) {
        refreshEquipmentSlots();
        refreshEquipmentGrid();
        refreshEquipmentStatsReadout();
        rebuildEquipPreview();
      }
      // The starter kit (server/index.js's grantStarterKit) arrives on this
      // same channel as one result covering six pieces at once, and has no
      // single `itemId` to name — one summary line, not six phantom toasts.
      if (action === 'starter-kit') {
        showGatherToast('Starting gear equipped');
      } else {
        const name = resolveItemDisplay(itemId).name;
        showGatherToast(action === 'equip' ? `Equipped ${name}` : `Unequipped ${name}`);
      }
    } else {
      const messages = {
        'not-owned': "You don't have that.", 'unknown-item': 'Unknown item.', 'wrong-slot': "That doesn't go there.",
        'shield-must-be-offhand': 'Shields go in the off hand.', 'two-handed-cannot-offhand': "Two-handed weapons can't go in the off hand.",
        'main-only-weapon': 'That weapon needs the main hand.', 'main-hand-is-two-handed': 'Your main hand weapon needs both hands.',
        'not-equippable': "That can't be equipped.", 'slot-empty': 'Nothing equipped there.',
      };
      showTransientMessage(messages[reason] || `Cannot ${action} that.`);
    }
  },
  onItemUsed: ({ itemId, inventory: serverInventory, unassignedStatPoints: newPoints, allocatedStats: newAllocated }) => {
    Object.assign(inventory, serverInventory);
    syncInventoryUI();
    showGatherToast(`Used ${resolveItemDisplay(itemId).name}`);
    if (typeof newPoints === 'number') unassignedStatPoints = newPoints;
    if (newAllocated) allocatedStats = { ...zeroStats(), ...newAllocated };
    if (statsPanelOpen) refreshStatsPanel();
  },
  onItemUseDenied: ({ itemId, reason }) => {
    const messages = { cooldown: 'Still on cooldown.' };
    showTransientMessage(messages[reason] || `Cannot use ${resolveItemDisplay(itemId).name} yet.`);
  },
  // --- Guilds ---
  onGuildState: (state) => {
    guildState = { ...state, buffCatalog: state.buffCatalog || guildState.buffCatalog || [] };
    // A guild change also changes MY OWN overhead plate, and the local player
    // draws from localMesh rather than remoteMeshes, so it is re-plated here
    // rather than through the 'player-guild' broadcast (which the server does
    // not send to the player it is about).
    playerGuilds.set(localId, state.guild ? { id: state.guild.id, name: state.guild.name, logoUrl: state.guild.logoUrl } : null);
    refreshLocalNameplate();
    refreshGuildPanel();
  },
  onGuildInvite: (invite) => showGuildInvitePrompt(invite),
  onGuildError: ({ error }) => {
    if (guildPanelOpen) showGuildError(error);
    else showTransientMessage(error);
  },
  onGuildNotice: ({ message }) => {
    if (guildPanelOpen) showGuildError(message, 'ok');
    else showTransientMessage(message);
  },
  onGuildKicked: ({ guildName }) => showTransientMessage(`You were removed from ${guildName}.`),
  onGuildBuffActivated: ({ name, by }) => showGuildBuffBanner(`${by} activated ${name} for the guild`),
  onGuildGold: ({ gold: newGold }) => { gold = newGold; refreshGoldUI(); refreshGuildPanel(); },
  onGuildInventory: ({ inventory: serverInventory }) => {
    for (const key of Object.keys(inventory)) delete inventory[key];
    Object.assign(inventory, serverInventory);
    syncInventoryUI();
    refreshGuildPanel();
  },
  onPlayerGuild: ({ id, guild }) => {
    playerGuilds.set(id, guild);
    if (id === localId) { refreshLocalNameplate(); return; }
    const mesh = remoteMeshes.get(id);
    if (mesh) attachPlayerNameplate(id, mesh);
  },
  onStatsUpdated: ({ unassignedStatPoints: newPoints, allocatedStats: newAllocated, derived }) => {
    unassignedStatPoints = newPoints;
    allocatedStats = { ...zeroStats(), ...newAllocated };
    pendingStatDelta = zeroStats();
    if (derived) playerDerived = derived;
    if (statsPanelOpen) refreshStatsPanel();
    if (equipmentPanelOpen) refreshEquipmentStatsReadout();
  },
  onStatAllocationDenied: ({ reason }) => {
    pendingStatDelta = zeroStats();
    if (statsPanelOpen) refreshStatsPanel();
    showTransientMessage(`Stat change rejected: ${reason}`);
  },
  // --- Tower Dungeon ---
  onTowerPanel: (payload) => {
    closeMerchantPanel();
    openTowerPanel(payload);
  },
  onTowerFloorEntered: ({ eventId, floorIndex, floorCount, name, requiredKills, requiredMonsterId, kills }) => {
    closeTowerPanel();
    hideTowerPrompt();
    towerRun = { eventId, floorIndex, floorCount, name, requiredKills, requiredMonsterId, kills, bossDown: false, cleared: false };
    refreshTowerRunHud();
  },
  onTowerProgress: ({ kills, requiredKills, bossDown }) => {
    if (!towerRun) return;
    towerRun.kills = kills;
    towerRun.requiredKills = requiredKills;
    towerRun.bossDown = bossDown;
    refreshTowerRunHud();
  },
  onTowerFloorCleared: ({ floorIndex, hasNext, nextName, nextFloorNumber }) => {
    if (towerRun) {
      towerRun.cleared = true;
      refreshTowerRunHud();
    }
    // Keeps the entrance panel's own unlock state honest if the player
    // leaves and reopens it without a reconnect.
    if (towerPanel) towerPanel.clearedFloors = Math.max(towerPanel.clearedFloors, floorIndex + 1);
    showTowerPrompt({ hasNext, nextName, nextFloorNumber });
  },
  onTowerLeft: () => endTowerRunUI(),
  onEventStep: ({ eventId, effects, dialog, done }) => {
    for (const effect of effects) {
      if (effect.type === 'giveItem' || effect.type === 'takeItem') syncInventoryUI();
      else if (effect.type === 'gold') refreshGoldUI();
      else if (effect.type === 'setSwitch') {
        eventSwitches[switchKey(effect.switchId, effect.self, { eventId })] = effect.value;
      } else if (effect.type === 'playSound') {
        const url = audioCatalogById[effect.soundId]?.url;
        if (url) new Audio(url).play().catch(() => {});
      } else if (effect.type === 'shakeScreen') triggerScreenShake(effect.intensity, effect.durationMs);
      else if (effect.type === 'fadeScreen') triggerScreenFade(effect.direction, effect.durationMs, effect.color);
      else if (effect.type === 'startQuest') {
        eventQuestLog[effect.questId] = { name: effect.name, description: effect.description || '', objectiveText: effect.description || '', status: 'active' };
        if (questLogOpen) refreshQuestLog();
      } else if (effect.type === 'updateQuestObjective') {
        if (eventQuestLog[effect.questId]) eventQuestLog[effect.questId].objectiveText = effect.text;
        if (questLogOpen) refreshQuestLog();
      } else if (effect.type === 'completeQuest') {
        if (eventQuestLog[effect.questId]) {
          eventQuestLog[effect.questId].status = 'complete';
          if (effect.text) eventQuestLog[effect.questId].objectiveText = effect.text;
        }
        if (questLogOpen) refreshQuestLog();
      } else if (effect.type === 'openMerchantStore') {
        openMerchantPanel(effect.items, effect.sellMultiplier ?? 0.5);
      } else if (effect.type === 'openCraftingStation') {
        openCraftingStationPanel(effect.stationTypeId);
      } else if (effect.type === 'castBarStart') {
        showCastBar(effect.label, effect.durationMs, effect.gatherType);
      } else if (effect.type === 'castBarEnd') {
        hideCastBar();
      }
    }
    // openEventDialogStep handles both cases: a final dialog line with no
    // choices stays open (activeEventId set) until the player's next E press
    // closes it (see talkToNpc/the KeyE handler); done with no dialog at all
    // closes immediately via closeDialog().
    openEventDialogStep({ eventId, dialog, done });
  },
  onEventObjectVisibility: ({ eventId, visible }) => {
    eventObjectVisibility.set(eventId, visible);
    const ev = activeEventObjects.find((e) => e.id === eventId);
    if (ev) applyEventObjectVisibility(ev);
  },
  onEventNpcMoved: ({ npcId, x, z }) => {
    const npc = npcDefs.get(npcId);
    if (npc) { npc.position.x = x; npc.position.z = z; }
  },
  onEventSkillLearned: ({ skillId }) => {
    showGatherToast(`Learned skill: ${skillId}`);
  },
});

const interactPromptEl = document.getElementById('interact-prompt');
let transientMessageUntil = 0;
function showTransientMessage(text) {
  interactPromptEl.textContent = text;
  interactPromptEl.style.display = 'block';
  transientMessageUntil = performance.now() + 2000;
}

window.addEventListener('keydown', (e) => {
  if (isTypingInField()) return;
  if (e.code === 'KeyE') {
    // An event script's dialog is open — closing it always takes priority
    // over starting some OTHER interaction, and must not depend on the
    // triggering object still being detectable: a script can hide itself
    // mid-run (e.g. a looted treasure chest's setVisible:false), which would
    // otherwise drop it out of findNearestEventObject()'s results and leave
    // the "Press E to close" dialog with no way to actually close it.
    if (activeEventId && !npcDialogChoicesEl.children.length) {
      closeDialog();
      return;
    }
    const nearbyNpc = !inTower && !inStore ? findNearestNpc() : null;
    const nearConfirmTeleporter = !inTower && !inStore ? (() => {
      const t = findNearestTeleporter();
      return t && t.mode === 'confirm' ? t : null;
    })() : null;
    const nearEventObject = !inTower && !inStore ? findNearestEventObject() : null;
    if (nearbyNpc) {
      // Talking to a townsperson takes priority over other overworld E-actions
      // (you walked right up to them). Also handles advancing/closing dialog.
      talkToNpc(nearbyNpc.id);
    } else if (nearEventObject) {
      if (activeEventId === nearEventObject.id) {
        if (!npcDialogChoicesEl.children.length) closeDialog();
      } else {
        net.startEvent(nearEventObject.id);
      }
    } else if (nearConfirmTeleporter) {
      net.useTeleporter(nearConfirmTeleporter.id);
    } else if (!inTower && !inStore && towerMeta && towerMeta.entryPoint && predicted && distanceXZ(predicted.position, towerMeta.entryPoint) <= towerMeta.entryRadius) {
      net.enterTower();
    } else if (inTower && currentFloorDef && predicted && distanceXZ(predicted.position, currentFloorDef.exitPoint) <= 3) {
      net.advanceFloor();
    } else if (!inTower && !inStore && storeEntranceInfo && predicted && distanceXZ(predicted.position, storeEntranceInfo.position) <= storeEntranceInfo.range) {
      net.enterStore();
    }
  }
  if (e.code === 'KeyQ') {
    if (inTower) net.exitTower();
    else if (inStore) net.exitStore();
  }
  if (e.code === 'KeyF' && !inTower && !inStore) {
    const node = findNearestGatherNode();
    if (node) net.gather(node.id);
  }
  // Crafting now opens via interacting with a placed station (the
  // openCraftingStation event effect, see onEventStep) rather than a bare
  // hotkey — there's no "browse every recipe" view without a station's
  // context anymore. C still closes it, mirroring Q's "only ever closes"
  // role for tower/store.
  if (e.code === 'KeyC' && craftPanelOpen) {
    closeCraftingStationPanel();
  }
  if (e.code === 'KeyJ') toggleGameWindow('quests');
  if (e.code === 'KeyK') toggleGameWindow('skills');
  if (e.code === 'KeyT') toggleGameWindow('stats');
  if (e.code === 'KeyP' && !inTower && !inStore) {
    const targetId = findNearestRemotePlayer();
    if (targetId) net.inviteParty(targetId);
    else showTransientMessage('No one nearby to invite.');
  }
  if (e.code === 'KeyY' && pendingPartyInvite) {
    net.acceptParty();
    pendingPartyInvite = null;
    partyInvitePromptEl.style.display = 'none';
  }
  if (e.code === 'KeyV') {
    if (!vendorPanelOpen) {
      if (!inStore || !vendorInfo || !predicted || distanceXZ(predicted.position, vendorInfo.position) > vendorInfo.range) {
        showTransientMessage('Get closer to the shopkeeper to sell.');
        return;
      }
    }
    vendorPanelOpen = !vendorPanelOpen;
    vendorPanelEl.style.display = vendorPanelOpen ? 'block' : 'none';
    if (vendorPanelOpen) refreshVendorPanel();
  }
  if (e.code === 'KeyI') toggleGameWindow('inventory');
  if (e.code === 'KeyG') toggleGameWindow('guild');
});

// --- Window bar (#window-bar in index.html) ---------------------------------
// Every full-screen panel is reachable by clicking an icon, not only by
// remembering a letter. The hotkeys route through the SAME table, so a key and
// its button can't drift apart, and the button's lit state is derived from the
// panel's real open flag rather than tracked separately.
const WINDOW_TOGGLES = {
  inventory: {
    isOpen: () => equipmentPanelOpen,
    toggle: () => (equipmentPanelOpen ? closeEquipmentPanel() : openEquipmentPanel()),
  },
  quests: {
    isOpen: () => questLogOpen,
    toggle: () => {
      questLogOpen = !questLogOpen;
      questLogEl.style.display = questLogOpen ? 'block' : 'none';
      if (questLogOpen) refreshQuestLog();
    },
  },
  skills: {
    isOpen: () => skillbookOpen,
    toggle: () => {
      skillbookOpen = !skillbookOpen;
      skillbookPanelEl.style.display = skillbookOpen ? 'block' : 'none';
      if (skillbookOpen) refreshSkillbookPanel();
    },
  },
  stats: {
    isOpen: () => statsPanelOpen,
    toggle: () => {
      statsPanelOpen = !statsPanelOpen;
      statsPanelEl.style.display = statsPanelOpen ? 'block' : 'none';
      if (statsPanelOpen) refreshStatsPanel();
    },
  },
  guild: {
    isOpen: () => guildPanelOpen,
    toggle: () => (guildPanelOpen ? closeGuildPanel() : openGuildPanel()),
  },
  map: {
    isOpen: () => minimapController.isFullMapOpen,
    toggle: () => minimapController.toggleFullMap(),
  },
};

function refreshWindowBar() {
  for (const btn of document.querySelectorAll('#window-bar .window-btn')) {
    btn.classList.toggle('open', !!WINDOW_TOGGLES[btn.dataset.window]?.isOpen());
  }
}

function toggleGameWindow(name) {
  WINDOW_TOGGLES[name]?.toggle();
  refreshWindowBar();
}

document.getElementById('window-bar').addEventListener('click', (e) => {
  const btn = e.target.closest('.window-btn');
  if (btn) toggleGameWindow(btn.dataset.window);
});
// A panel's own X button (and every other close path) bypasses the table, so
// the lit states are re-derived on a slow timer rather than only on click.
setInterval(refreshWindowBar, 250);
// The Buffs tab shows live countdowns, so it re-renders on a slow timer while
// it's the visible tab. Every other tab is push-driven and needs no polling.
setInterval(() => {
  if (guildPanelOpen && guildTab === 'buffs') refreshGuildPanel();
}, 1000);

let lastInputSent = 0;
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (predicted && activeBounds) {
    // Client-predicted CC/slow — purely a responsiveness thing (the server
    // enforces both authoritatively regardless), so a stunned/frozen/asleep
    // player's own WASD feels locked instantly rather than only snapping
    // back once the server's rejection round-trips.
    const nowMs = Date.now();
    const locallyCCd = isCCd(localStatusEffects, nowMs);
    const speedMultiplier = getMoveSpeedMultiplier(localStatusEffects, nowMs);
    renderStatusEffectRow(localStatusEffects, nowMs);
    updateCastBar(now);
    const input = (isDeadLocally || locallyCCd) ? { moveX: 0, moveZ: 0, jump: false } : { ...currentInput(), jump: jumpQueued };
    // Terrain height PLUS any walkable prop deck over it (piers) — the server
    // uses the identical function on the identical map data, which is what
    // keeps prediction from fighting the authority at every deck edge.
    const groundHeightFn = activeTerrainWorld ? groundHeightFnFor(activeTerrainWorld) : null;
    predicted.predict(input, dt, activeBounds, activeCollision, groundHeightFn, speedMultiplier);
    localMesh.position.set(predicted.position.x, predicted.position.y, predicted.position.z);

    // Face the direction of movement. The model's forward axis is +Z (see
    // generateCharacter), so this is the angle that rotates (0,0,1) onto
    // the normalized (moveX, moveZ) input vector. Idle: keep last facing.
    if (input.moveX !== 0 || input.moveZ !== 0) {
      localMesh.rotation.y = Math.atan2(input.moveX, input.moveZ);
    }
    updateWalkCycle(localMesh, (input.moveX !== 0 || input.moveZ !== 0) && !isDeadLocally, now / 1000, dt);

    // Re-center the orbit target on the player each frame. OrbitControls
    // recomputes its spherical offset from (camera.position - target) on
    // every update() call rather than remembering a persisted offset, so
    // moving the target alone would leave the camera frozen in place while
    // the player walks away. Translating the camera by the same delta first
    // keeps the player's chosen orbit angle/zoom while still following.
    camera.position.sub(_shakeOffset); // undo last frame's shake before recomputing the real orbit-follow position
    const newTargetPos = _newTargetPos.set(predicted.position.x, predicted.position.y + 1, predicted.position.z);
    const delta = _cameraDelta.subVectors(newTargetPos, lastCameraTargetPos);
    camera.position.add(delta);
    cameraControls.target.copy(newTargetPos);
    lastCameraTargetPos.copy(newTargetPos);
    cameraControls.update();

    if (activeShake) {
      const elapsed = now - activeShake.startedAt;
      if (elapsed >= activeShake.durationMs) {
        activeShake = null;
        _shakeOffset.set(0, 0, 0);
      } else {
        const mag = activeShake.intensity * (1 - elapsed / activeShake.durationMs);
        _shakeOffset.set((Math.random() * 2 - 1) * mag, (Math.random() * 2 - 1) * mag, 0);
        camera.position.add(_shakeOffset);
      }
    } else {
      _shakeOffset.set(0, 0, 0);
    }

    // Throttle input sends to ~20/s to match server tick.
    if (now - lastInputSent > 50) {
      // stampInput both tags the payload with a sequence number and buffers it
      // for replay — reconcile() needs it to undo the round-trip staleness of
      // the server's position instead of dragging the player back toward it.
      net.sendInput(predicted.stampInput(input));
      jumpQueued = false; // consumed — see the Space keydown handler above for why this isn't cleared every frame
      lastInputSent = now;
    }

    // Freeform zone music/ambient crossfade — tower floors and store
    // interiors have no zones of their own, so audio just holds whatever it
    // was already playing while inside them (no jarring cut on entry/exit).
    // update() itself no-ops unless the active zone actually changed.
    if (!inTower && !inStore) {
      const activeAudioZoneId = findActiveAudioZone(world.zones || [], predicted.position.x, predicted.position.z);
      zoneAudioController.update(activeAudioZoneId, zonesById, activeGraphicsSettings.sound);
    }

    // Close an open dialog if the player has wandered out of range of that NPC.
    if (dialogNpcId) {
      const npcMesh = overworldNpcMeshes.get(dialogNpcId);
      if (inTower || inStore || !npcMesh || distanceXZ(predicted.position, npcMesh.position) > NPC_TALK_RANGE + 1) {
        closeDialog();
      }
    }

    // Instant-mode teleporters fire automatically on proximity, no keypress
    // — cooldown-guarded so standing on one (or the pair you just arrived
    // at) doesn't retrigger every frame. Confirm-mode ones only get a
    // "Press E" prompt below; firing them is the KeyE handler's job.
    if (!inTower && !inStore) {
      const nearTeleporter = findNearestTeleporter();
      if (nearTeleporter && nearTeleporter.mode === 'instant' && now - lastTeleportFiredAt > TELEPORTER_RETRIGGER_MS) {
        lastTeleportFiredAt = now;
        net.useTeleporter(nearTeleporter.id);
      }
    }

    // Proximity-based "Press E"/"Press F" hints, unless a denial message is
    // showing or a dialog is already open (the dialog box carries its own hint).
    if (dialogNpcId || activeEventId) {
      interactPromptEl.style.display = 'none';
    } else if (now > transientMessageUntil) {
      const nearNode = !inTower && !inStore ? findNearestGatherNode() : null;
      const nodeOnCooldown = nearNode && (gatherNodeAvailableAt.get(nearNode.id) || 0) > Date.now();
      const nearbyNpc = !inTower && !inStore ? findNearestNpc() : null;
      const nearEventObject = !inTower && !inStore ? findNearestEventObject() : null;
      const nearConfirmTeleporter = !inTower && !inStore ? (() => {
        const t = findNearestTeleporter();
        return t && t.mode === 'confirm' ? t : null;
      })() : null;

      if (nearbyNpc) {
        interactPromptEl.textContent = `Press E to talk to ${npcDefs.get(nearbyNpc.id)?.name || 'NPC'}`;
        interactPromptEl.style.display = 'block';
      } else if (nearEventObject) {
        // An authored prompt wins outright (World Editor → Events → Prompt
        // text), so a fishing spot can say "Press E to Fish" instead of the
        // generic verb the trigger type implies.
        interactPromptEl.textContent = nearEventObject.start.prompt?.trim()
          || `Press E to ${nearEventObject.start.type === 'talk' ? 'talk' : 'interact'}`;
        interactPromptEl.style.display = 'block';
      } else if (nearConfirmTeleporter) {
        interactPromptEl.textContent = 'Press E to teleport';
        interactPromptEl.style.display = 'block';
      } else if (!inTower && !inStore && towerMeta && towerMeta.entryPoint && distanceXZ(predicted.position, towerMeta.entryPoint) <= towerMeta.entryRadius) {
        interactPromptEl.textContent = 'Press E to enter the Tower';
        interactPromptEl.style.display = 'block';
      } else if (inTower && currentFloorDef && distanceXZ(predicted.position, currentFloorDef.exitPoint) <= 3) {
        interactPromptEl.textContent = 'Press E to advance to the next floor';
        interactPromptEl.style.display = 'block';
      } else if (!inTower && !inStore && storeEntranceInfo && distanceXZ(predicted.position, storeEntranceInfo.position) <= storeEntranceInfo.range) {
        interactPromptEl.textContent = 'Press E to enter the store';
        interactPromptEl.style.display = 'block';
      } else if (nearNode && !nodeOnCooldown) {
        interactPromptEl.textContent = `Press F to gather ${getItemDef(nearNode.nodeType).name}`;
        interactPromptEl.style.display = 'block';
      } else {
        interactPromptEl.style.display = 'none';
      }
    }

    // Minimap + full map — hidden while inside a tower floor or store
    // interior (neither has a meaningful position on the overworld map).
    minimapWrapEl.style.display = inTower || inStore ? 'none' : 'block';
    minimapHintEl.style.display = inTower || inStore ? 'none' : 'block';
    if (!inTower && !inStore) {
      const partyDots = partyMembers
        .filter((m) => m.id !== localId)
        .map((m) => remoteMeshes.get(m.id))
        .filter(Boolean)
        .map((mesh) => ({ x: mesh.position.x, z: mesh.position.z }));
      const npcDots = [];
      for (const [npcId, mesh] of overworldNpcMeshes) {
        npcDots.push({ x: mesh.position.x, z: mesh.position.z, questState: computeNpcQuestStatus(npcId) });
      }
      // Only the first active quest gets an arrow — simplest rule for
      // multiple simultaneous objectives, matching zone audio's identical
      // "first match in iteration order wins" choice.
      const firstActiveQuestId = Object.keys(questState.active)[0];
      const firstActiveQuest = firstActiveQuestId ? questCatalog.get(firstActiveQuestId) : null;
      const questArrow = firstActiveQuest
        ? questObjectiveTarget(firstActiveQuest, { ...questTargetLookups, overworldMonsterMeshes, npcDefs })
        : null;
      minimapController.update({
        world,
        playerPos: predicted.position,
        playerFacing: localMesh.rotation.y,
        partyDots,
        npcDots,
        questArrow,
      });
    }
  }

  // Selection ring — per frame, not per network tick, so it stays glued to a
  // walking monster's interpolated position instead of stepping 20x/s.
  updateTargetRing(now);

  // Health bar (own HP) and monster health bar billboarding.
  healthFillEl.style.width = `${Math.max(0, (healthUI.health / healthUI.maxHealth) * 100)}%`;
  healthLabelEl.textContent = `HP ${Math.max(0, Math.round(healthUI.health))}/${healthUI.maxHealth}`;
  for (const [nodeId, mesh] of gatherNodeMeshes) {
    setGatheringNodeDepleted(mesh, (gatherNodeAvailableAt.get(nodeId) || 0) > Date.now());
  }
  // Remote players' plates cull at the same distance NPC plates do — without
  // it a player across the map renders a full-size, fully readable name.
  for (const mesh of remoteMeshes.values()) {
    if (mesh.userData.nameplate) {
      mesh.userData.nameplate.visible = camera.position.distanceTo(mesh.position) <= NAMEPLATE_MAX_DISTANCE;
    }
  }
  for (const [npcId, mesh] of overworldNpcMeshes) {
    if (mesh.userData.questIndicator) {
      updateQuestIndicatorSprite(mesh.userData.questIndicator, computeNpcQuestStatus(npcId));
    }
    if (mesh.userData.nameplate) {
      mesh.userData.nameplate.visible = camera.position.distanceTo(mesh.position) <= NAMEPLATE_MAX_DISTANCE;
    }
  }
  // Re-synced every frame (not just on network ticks) so the bar smoothly
  // tracks a monster's walk-cycle/prediction motion between ticks, now that
  // it's a sibling with its own independent position rather than a child.
  // Distance-culled the same way (miles-away monsters were showing full-size
  // readable health bars with no falloff — see NAMEPLATE_MAX_DISTANCE).
  for (const mesh of monsterMeshes.values()) {
    const bar = mesh.userData.healthBar;
    if (bar) {
      bar.position.set(mesh.position.x, mesh.position.y + bar.userData.barHeight, mesh.position.z);
      bar.quaternion.copy(camera.quaternion);
      bar.visible = camera.position.distanceTo(mesh.position) <= NAMEPLATE_MAX_DISTANCE;
    }
  }
  for (const mesh of overworldMonsterMeshes.values()) {
    const bar = mesh.userData.healthBar;
    if (bar) {
      bar.position.set(mesh.position.x, mesh.position.y + bar.userData.barHeight, mesh.position.z);
      bar.quaternion.copy(camera.quaternion);
      bar.visible = camera.position.distanceTo(mesh.position) <= NAMEPLATE_MAX_DISTANCE;
    }
  }

  // Resource regenerates continuously; visually extrapolate between the
  // authoritative updates that arrive on each ability-result so the bar
  // doesn't sit static between casts.
  abilityUI.resource = Math.min(abilityUI.maxResource, abilityUI.resource + abilityUI.regenPerSecond * dt);
  resourceFillEl.style.width = `${(abilityUI.resource / abilityUI.maxResource) * 100}%`;
  resourceLabelEl.textContent = `${classDef.resourceType} ${Math.round(abilityUI.resource)}/${abilityUI.maxResource}`;

  for (const ability of classDef.abilities) {
    const { overlay, text } = slotEls.get(ability.key);
    const readyAt = abilityUI.cooldownEndsAt[ability.id] || 0;
    const remaining = Math.max(0, readyAt - now);
    overlay.style.height = `${Math.min(100, (remaining / ability.cooldownMs) * 100)}%`;
    text.textContent = remaining > 0 ? Math.ceil(remaining / 1000) : '';
  }

  for (const mesh of remoteMeshes.values()) {
    const isMoving = (mesh.userData.movingUntil || 0) > now;
    updateWalkCycle(mesh, isMoving, now / 1000, dt);
  }
  for (const mesh of overworldNpcMeshes.values()) {
    const isMoving = (mesh.userData.movingUntil || 0) > now;
    updateWalkCycle(mesh, isMoving, now / 1000, dt);
  }
  // Monsters animate too — until now updateWalkCycle was never called on them.
  // Catalog-built monsters carry their authored gait on userData.gaitTable
  // (buildMonsterRig); the 3 hardcoded types have no rig, so this no-ops on
  // them exactly as before.
  for (const mesh of overworldMonsterMeshes.values()) {
    updateWalkCycle(mesh, (mesh.userData.movingUntil || 0) > now, now / 1000, dt);
  }
  for (const mesh of monsterMeshes.values()) {
    updateWalkCycle(mesh, (mesh.userData.movingUntil || 0) > now, now / 1000, dt);
  }

  updateAbilityAnimations(scene, [localMesh, ...remoteMeshes.values()].filter(Boolean));
  vfxSystem.update(dt);

  // Sky follows the camera; the sun's shadow frustum follows the player, so
  // shadows exist away from the origin instead of only near the city.
  updateAtmosphere(scene, camera.position, localMesh ? localMesh.position : camera.position, now / 1000);
  if (grassCover && overworldGroup.visible) grassCover.update(now / 1000, camera);
  if (flowerCover && overworldGroup.visible) flowerCover.update(now / 1000);
  if (propSway && overworldGroup.visible) propSway.update(now / 1000);
  if (treeSway && overworldGroup.visible) treeSway.update(now / 1000);
  if (treeLod && overworldGroup.visible) treeLod.update(camera);
  if (waterMesh && overworldGroup.visible) updateWaterTime(waterMesh, now / 1000);
  if (groundTextureOverlayMesh && overworldGroup.visible) updateCloudShadowTime(groundTextureOverlayMesh, dt);
  if (seabedMesh && overworldGroup.visible) updateWaterTime(seabedMesh, now / 1000);
  if (overworldGroup.visible) {
    for (const { water: w, seabed: s } of lakeBodies) {
      if (w) updateWaterTime(w, now / 1000);
      if (s) updateWaterTime(s, now / 1000);
    }
    for (const { water: w, seabed: s } of riverBodies) {
      if (w) updateWaterTime(w, now / 1000);
      if (s) updateWaterTime(s, now / 1000);
    }
  }
  if (ambientParticles && overworldGroup.visible) ambientParticles.update(dt);
  if (zoneParticles && overworldGroup.visible) zoneParticles.update(dt);
  if (environmentalParticles && overworldGroup.visible) environmentalParticles.update(dt, predicted.position);
  // The painted-layer and zone systems ignore the second argument; only the
  // map-wide environmental one follows the player.
  if (mapGroup.visible) for (const sys of mapParticles) sys.update(dt, predicted.position);
  // Placed emitters stream against the CAMERA, not the player: what's worth
  // simulating is what's in view, and the orbit camera can sit a long way
  // from the character it's framing.
  if (worldEmitters && overworldGroup.visible) worldEmitters.update(dt, camera.position);
  if (mapWorldEmitters && mapGroup.visible) mapWorldEmitters.update(dt, camera.position);
  // Placed lights bind against the camera too — what matters is what's in
  // frame, and the orbit camera can sit well away from the character.
  if (worldLights && overworldGroup.visible) worldLights.update(dt, camera.position);
  if (mapWorldLights && mapGroup.visible) mapWorldLights.update(dt, camera.position);
  if (overworldGroup.visible) updateModelAnimations(overworldGroup, dt); // ambient-only clips on imported models (a turning windmill, etc.) — see modelLoader.js

  updatePostProcessing(now / 1000); // sunrays pass needs the live camera orientation — see postProcessing.js
  composer.render();
  renderUiOverlay(renderer, scene, camera); // name labels / quest icons, drawn AFTER bloom so they don't glow
}
// Dev affordance: inspect the live scene from the console. Measuring the
// rendered scene graph beats guessing from a screenshot.
window.__game = { scene, camera, renderer, cameraControls, vfxSystem, updateAbilityAnimations, triggerAbilityAnimation, get grass() { return grassCover; }, get flowers() { return flowerCover; }, get world() { return world; }, get localMesh() { return localMesh; }, get overworldMonsterMeshes() { return overworldMonsterMeshes; } };

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  setPostProcessingSize(window.innerWidth, window.innerHeight);
});
