// src/editor/main.js
// Admin/dev-only World Editor. Builds/edits the fixed JSON world file using
// the Phase 2 generator library. Talks to the server only to load/save
// world.json — it has no gameplay/networking concerns of its own.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPostProcessing } from '../render/postProcessing.js';
import { defaultGraphicsSettings, SHADOW_MAP_SIZES, DEFAULT_SHADOW_MAP_SIZE, shadowTexelSize, playerCameraOf } from '../sim/graphicsSettings.js';
import {
  createRenderer,
  createScene,
  buildGroundMesh,
  buildWaterMesh,
  buildSeabedMesh,
  buildLakeBodyMeshes,
  buildRiverBodyMeshes,
  updateWaterTime,
  buildZoneMarker,
  buildFreeformZoneMarker,
  buildBuildingPlaceholder,
  buildWallSegmentInstance,
  buildPropPlaceholder,
  buildTowerPlaceholder,
  buildFloorMeshes,
  applyColorTint,
  toonify,
  buildTeleporterMesh,
  buildSpawnPointMarker,
  COVER_PROP_TYPES,
} from '../render/scene.js';
import { removeAndDispose } from '../render/dispose.js';
import { applyDecalDepthBias } from '../render/depthBias.js';
import { generateMonster } from '../generators/monster.js';
import { buildPlayerCharacter } from '../generators/playerCharacter.js';
import { createSceneryPalette } from './sceneryPalette.js';
import { applyWeaponTuning, registerCustomWeaponModels, WEAPON_TYPES } from '../sim/weaponTypes.js';
import { ARMOR_TYPES, EQUIP_SLOTS, ITEM_STAT_IDS, CONSUMABLE_USAGE_MODES } from '../sim/authoredItems.js';
import { BUFF_STATS } from '../sim/skillDefs.js';
import { updateAtmosphere, applyGraphicsSettingsToAtmosphere } from '../render/atmosphere.js';
import { setCurrentAnisotropy } from '../render/renderSettings.js';
import { updateGrassPropTime } from '../render/grassCover.js';
import { updateFlowerPropTime } from '../render/flowerCover.js';
import { createSwayAnimator, updateWindSwayTime } from '../render/windSway.js';
import { loadFloraPlugins } from '../generators/pluginLoader.js';
import { DEFAULT_TERRAIN_WATER_RESOLUTION } from '../sim/worldDefaults.js';
import {
  findWaterMaskComponents,
  traceWaterMaskComponentToPolygon,
  DEFAULT_LAKE_MAX_DEPTH,
  DEFAULT_RIVER_WIDTH,
} from '../sim/waterBodies.js';
import { enforceNonIncreasingHeights } from '../sim/rivers.js';
import { createVfxSystem } from '../render/vfx/index.js';
import { worldEffectsByCategory, getWorldEffectDef, WORLD_EFFECT_IDS } from '../render/vfx/worldEffects.js';
import { createWorldParticleEmitters } from '../render/worldParticles.js';
import { DEFAULT_EMITTER_ACTIVATION_RADIUS } from '../sim/particleEmitters.js';
import { DEFAULT_EVENT_INTERACT_RANGE } from '../sim/events.js';
import { createWorldLights } from '../render/worldLights.js';
import {
  DEFAULT_LIGHT_ACTIVATION_RADIUS,
  LIGHT_PRESETS,
  lightPresetsByCategory,
  lightSourceFromPreset,
  lightSpotDirection,
} from '../sim/lightSources.js';

// Zero-edit flora/decor props (src/generators/environment/plugins/) —
// registers each one into propTypes.js/props.js before anything below builds
// a scenery palette or places a prop. Top-level await: this module's own
// execution pauses here, so everything after it already sees plugin props in
// the catalog. See that folder's README.md for the file format.
await loadFloraPlugins();

// Saved weapon grips (Character & NPC Builder) — so an NPC previewed here holds
// its weapon the same way the game does. Re-applied again once /api/models
// registers any custom weapon models further below (search
// registerCustomWeaponModels) — applyWeaponTuning silently no-ops any id not
// yet in weaponTypes.js's BY_ID, and this fetch usually resolves first,
// which was silently dropping a custom weapon's saved grip every load.
const weaponTuningPromise = fetch('/api/weapon-tuning').then((r) => r.json()).then((t) => { applyWeaponTuning(t); return t; }).catch(() => ({}));

// Building Builder catalogs — a `type: 'custom'` placed building resolves its
// pieces from these, same idea as the Object Builder's objectCatalog below.
let buildingPartCatalog = [];
let buildingTypeCatalog = [];
let buildingCatalogForRender = { partsById: {}, typesById: {} };
function refreshBuildingTypeDropdown() {
  const el = document.getElementById('bld-type');
  if (!el) return;
  const current = el.value;
  const builtins = ['cottage', 'shop', 'guild-hall', 'longhouse'];
  const builtinOptions = Array.from(el.options).filter((o) => builtins.includes(o.value));
  el.innerHTML = '';
  for (const o of builtinOptions) el.appendChild(o);
  for (const t of buildingTypeCatalog) {
    const o = document.createElement('option');
    o.value = `custom:${t.id}`;
    o.textContent = `🧱 ${t.name}`;
    el.appendChild(o);
  }
  if (Array.from(el.options).some((o) => o.value === current)) el.value = current;
}
Promise.all([
  fetch('/api/building-parts').then((r) => r.json()).catch(() => []),
  fetch('/api/building-types').then((r) => r.json()).catch(() => []),
]).then(([parts, types]) => {
  buildingPartCatalog = parts;
  buildingTypeCatalog = types;
  buildingCatalogForRender = {
    partsById: Object.fromEntries(parts.map((p) => [p.id, p])),
    typesById: Object.fromEntries(types.map((t) => [t.id, t])),
  };
  refreshBuildingTypeDropdown();
  // Only rebuild if the world already finished loading and rendered once —
  // if it hasn't, world.json's own load callback (below) still will, and by
  // then buildingCatalogForRender is already populated (same shared binding,
  // not a snapshot). Rebuilding here unconditionally raced world loading and
  // crashed buildGroundMesh on a still-null `world`.
  if (world) rebuildAll();
}).catch((err) => console.error('Failed to load building catalogs:', err));
import { buildShapeMesh, setShapeOpacity } from '../generators/custom.js';
import { createTabbedModal } from './modal.js';
import { initGuides } from './guides.js';
import { ITEM_IDS, getItemDef } from '../sim/items.js';
import { parseWorld, sampleTerrainHeight, sampleWaterMask } from '../sim/world.js';
import { DEFAULT_PATH_WIDTH } from '../sim/paths.js';
import { DEFAULT_BARRIER_THICKNESS } from '../sim/barriers.js';
import { buildPathMesh, assignPathLayers, MAX_PATH_LAYERS } from '../render/pathMesh.js';
import {
  PATH_THEME_DEFS,
  renderThemeSwatchCanvas,
  registerCustomPathTexture,
  setCustomPathTextureLoadedCallback,
} from '../render/pathThemes.js';
import { DEFAULT_MOUNTAIN_WIDTH, DEFAULT_PEAK_HEIGHT, stampMountainHeight } from '../sim/mountains.js';
import { buildMountainRidgeMesh } from '../render/mountainMesh.js';
import { MOUNTAIN_THEME_DEFS, renderMountainThemeSwatchCanvas } from '../render/mountainThemes.js';
import { DEFAULT_GROUND_TEXTURE_RESOLUTION } from '../sim/groundTextures.js';
import { DEFAULT_COLOR_GRADE, normalizeColorGrade, isNeutralColorGrade } from '../sim/colorGrading.js';
import { buildGroundTextureOverlay } from '../render/groundTextureMesh.js';
import { updateCloudShadowTime, applyCloudShadowSettings } from '../render/cloudShadows.js';
import {
  GROUND_TEXTURE_BUILTIN_DEFS,
  renderGroundTextureSwatchCanvas,
  registerCustomGroundTexture,
  setCustomGroundTextureLoadedCallback,
} from '../render/groundTextureThemes.js';
import {
  PARTICLE_TYPE_LABELS,
  PARTICLE_TYPE_IDS,
  createAmbientParticleSystem,
  createZoneParticleSystem,
  createEnvironmentalParticleSystem,
} from '../render/ambientParticles.js';
import { registerModelCatalog, onModelLoadedEvent, measureModel, waitForModels, forgetLoadedModel, updateModelAnimations } from '../generators/modelLoader.js';
import { PROP_CATEGORIES, PROP_TYPES, defaultPlaceY } from '../sim/propTypes.js';
import { CRAFTING_STATION_TYPE_IDS, CRAFTING_STATION_TYPES } from '../sim/craftingStations.js';
import { NODE_TYPES } from '../sim/gathering.js';
import { PROFESSIONS, FAIL_ACTIONS } from '../sim/recipes.js';

/** Deterministic string->int seed so a monster's placeholder shape stays stable across reloads without needing its own seed field in the floor schema. */
function hashStringToSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

// --- Brush radius indicator (Scatter & Terrain modes) ---
// A thin ring on the ground at the cursor, scaled to match whichever
// brush's radius slider is currently active.
const brushRing = new THREE.Mesh(
  new THREE.RingGeometry(0.96, 1, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, depthTest: false })
);
brushRing.rotation.x = -Math.PI / 2;
brushRing.visible = false;
brushRing.renderOrder = 999;

const statusLine = document.getElementById('status-line');
const canvas = document.getElementById('editor-canvas');

// --- Resizable tool panel ---------------------------------------------
// Several modes (Events, Items, the dialog-tree editor) have rows that just
// don't fit 300px, so the panel is drag-widenable and remembers its width
// across reloads. The drag strip is a sibling of the panel rather than a
// child: the panel scrolls, and a child handle would scroll away with the
// content instead of staying on the edge.
const FLYOUT_DEFAULT_WIDTH = 345; // matches the CSS default (the old 300 + 15%)
const FLYOUT_MIN_WIDTH = 260;
const FLYOUT_WIDTH_KEY = 'fantasy-mmo-editor-flyout-width';
const toolFlyoutEl = document.getElementById('tool-flyout');
const flyoutResizerEl = document.getElementById('tool-flyout-resizer');

function setFlyoutWidth(px, persist = true) {
  // Never wider than the viewport leaves room to actually see the world.
  const max = Math.max(FLYOUT_MIN_WIDTH, window.innerWidth - 360);
  const width = Math.round(Math.min(max, Math.max(FLYOUT_MIN_WIDTH, px)));
  toolFlyoutEl.style.width = `${width}px`;
  // The handle is fixed-position, so it has to be moved to the panel's new
  // right edge by hand — it can't inherit the layout.
  flyoutResizerEl.style.left = `${12 + width}px`;
  flyoutResizerEl.style.height = getComputedStyle(toolFlyoutEl).maxHeight;
  if (persist) localStorage.setItem(FLYOUT_WIDTH_KEY, String(width));
  return width;
}
setFlyoutWidth(parseInt(localStorage.getItem(FLYOUT_WIDTH_KEY), 10) || FLYOUT_DEFAULT_WIDTH, false);

let flyoutResizing = false;
flyoutResizerEl.addEventListener('pointerdown', (e) => {
  flyoutResizing = true;
  flyoutResizerEl.classList.add('dragging');
  document.body.classList.add('resizing-flyout');
  // Capture, so a fast drag that outruns the 10px strip keeps resizing
  // instead of dropping the gesture onto the canvas as a camera orbit.
  flyoutResizerEl.setPointerCapture(e.pointerId);
  e.preventDefault();
});
flyoutResizerEl.addEventListener('pointermove', (e) => {
  if (!flyoutResizing) return;
  setFlyoutWidth(e.clientX - 12);
});
const endFlyoutResize = () => {
  if (!flyoutResizing) return;
  flyoutResizing = false;
  flyoutResizerEl.classList.remove('dragging');
  document.body.classList.remove('resizing-flyout');
};
flyoutResizerEl.addEventListener('pointerup', endFlyoutResize);
flyoutResizerEl.addEventListener('pointercancel', endFlyoutResize);
flyoutResizerEl.addEventListener('dblclick', () => setFlyoutWidth(FLYOUT_DEFAULT_WIDTH));
window.addEventListener('resize', () => {
  setFlyoutWidth(parseInt(localStorage.getItem(FLYOUT_WIDTH_KEY), 10) || FLYOUT_DEFAULT_WIDTH, false);
});

// --- Save feedback + unsaved-changes tracking ---------------------------
// The corner status line is easy to miss while you're looking at the middle
// of the scene, so a save also flashes a large centre-screen toast, and the
// Save button itself carries the dirty state as a colour.
const saveToastEl = document.getElementById('save-toast');
let saveToastTimer = null;
function showSaveToast(message, isError = false) {
  saveToastEl.textContent = message;
  saveToastEl.classList.toggle('error', isError);
  saveToastEl.classList.add('visible');
  clearTimeout(saveToastTimer);
  // A failure stays up longer — it's a message you need to actually read.
  saveToastTimer = setTimeout(() => saveToastEl.classList.remove('visible'), isError ? 7000 : 2200);
}

const saveBtnEl = document.getElementById('save-btn');
let unsavedChanges = false;
/**
 * Flag the loaded map as edited. Deliberately COARSE: it's fired from the
 * canvas on any authoring click and from any input inside a world-data mode
 * panel, rather than from each of the ~200 places that mutate `world`. Over-
 * reporting costs one extra confirm dialog; under-reporting costs real work,
 * so the bias is intentional.
 */
function markDirty() {
  if (unsavedChanges) return;
  unsavedChanges = true;
  saveBtnEl.classList.add('dirty');
}
function markClean() {
  unsavedChanges = false;
  saveBtnEl.classList.remove('dirty');
}

// --- Undo (Ctrl+Z / the toolbar's ↶ button) ---
//
// Snapshot-based, and deliberately COARSE in the same way markDirty is: one
// canvas authoring action (a brush stroke, a placement, a draw) captures the
// world collections that action can possibly touch, and undo puts them back
// wholesale. Recording per-operation inverse edits would be finer-grained but
// would mean maintaining an undo path in each of the ~15 tools, and the one
// that got forgotten would corrupt the stack silently.
//
// Only whole top-level `world` keys are captured — never the entire document.
// A real map's props array alone is thousands of entries and the file is
// megabytes; cloning all of it 20 times over is the kind of thing that ends
// in "Array buffer allocation failed".
//
// Scope: canvas authoring actions. Panel buttons that mutate the world
// directly (Clear All Water, catalog edits) are NOT undoable — they're
// deliberate, named, confirmable actions, unlike a brush stroke that went
// somewhere you didn't mean.
const UNDO_LIMIT = 20;
const undoStack = [];

/** Which `world` keys the tool that's about to run can mutate. Null = not undoable. */
function undoKeysForCurrentTool() {
  switch (mode) {
    case 'place': return ['props', 'walls'];
    case 'scatter': return ['props'];
    case 'terrain': return terrainToolMode === 'barrier' ? ['barriers'] : ['terrain'];
    case 'water': return waterToolMode === 'paint' ? ['waterMask'] : ['waterBodies'];
    case 'groundtex': return ['groundTextures'];
    case 'zones': return ['zones'];
    case 'buildings': return ['buildings'];
    case 'monsters': return ['monsters'];
    case 'npcs': return ['npcs'];
    case 'path': return ['paths'];
    case 'mountains': return ['mountains', 'terrain']; // a ridge stamps the heightmap as well as laying its ribbon
    case 'teleporters': return ['teleporters'];
    case 'particles': return ['particleEmitters'];
    case 'lights': return ['lights'];
    case 'events': return ['events'];
    default: return null; // object-builder edits a catalog, not the map
  }
}

function pushUndoSnapshot(label, keys) {
  if (!world || !keys?.length) return;
  const data = {};
  for (const key of keys) data[key] = world[key] === undefined ? undefined : structuredClone(world[key]);
  undoStack.push({ label, keys, data });
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  refreshUndoButton();
}

function refreshUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  btn.disabled = undoStack.length === 0;
  btn.title = undoStack.length ? `Undo ${undoStack[undoStack.length - 1].label} (Ctrl+Z)` : 'Nothing to undo';
}

function undoLastAction() {
  const entry = undoStack.pop();
  if (!entry) {
    statusLine.textContent = 'Nothing to undo.';
    return;
  }
  for (const key of entry.keys) {
    if (entry.data[key] === undefined) delete world[key];
    else world[key] = entry.data[key];
  }
  // Everything holding a `ref` into the old arrays (selections, placedItems,
  // placedNpcs, …) now points at objects that are no longer in the world, so
  // the view has to be rebuilt from scratch rather than patched. Clearing the
  // selections first stops a stale highlight outliving its mesh.
  clearAllSelections();
  rebuildAll();
  markDirty();
  refreshUndoButton();
  statusLine.textContent = `Undid: ${entry.label}. (${undoStack.length} more)`;
}

// Mode panels whose fields edit the CURRENT MAP (and so save with the Save
// World button). Everything else — Items, Quests, Recipes, the Object/Monster
// builders, Maps — is a separate server-side catalog with its own save button,
// and editing one of those must not claim the map has unsaved changes.
const WORLD_DATA_PANEL_IDS = new Set([
  'mode-place', 'mode-scatter', 'mode-terrain', 'mode-water', 'mode-zones',
  'mode-buildings', 'mode-monsters', 'mode-npcs', 'mode-path', 'mode-mountains',
  'mode-groundtex', 'mode-teleporters', 'mode-particles', 'mode-lights', 'mode-events',
]);
document.addEventListener('input', (e) => {
  const panel = e.target.closest?.('.mode-panel');
  if (panel && WORLD_DATA_PANEL_IDS.has(panel.id)) markDirty();
}, true);

window.addEventListener('beforeunload', (e) => {
  if (!unsavedChanges && !eventFormDirty) return;
  // Browsers ignore any custom text here and show their own wording; both the
  // preventDefault and the legacy returnValue assignment are needed for the
  // prompt to appear across engines.
  e.preventDefault();
  e.returnValue = '';
});

// Shadows + toon shading + bloom now match the live game exactly (Dennis
// asked for the editor to stop being a visibly different "authoring mood"
// from what players actually see, ahead of building real graphics-settings
// UI — that settings surface should tune ONE shared look, not two
// diverging ones). Previously shadows were off here as a perf shortcut;
// worth revisiting if the scatter brush's prop counts make this laggy.
const renderer = createRenderer(canvas, { shadows: true });
const scene = createScene();
scene.add(brushRing);

// 60° matches createCamera()'s FOV in the live game — the same scene through
// a different lens is a different picture (perspective falloff, how much a
// nearby tree looms), and this tool's whole point is previewing what players
// get. The far plane stays 3000 rather than the game's 2000: the editor's
// pulled-way-back overview needs it, and clipping distance changes nothing
// about how what IS drawn looks.
// near=0.5 matches createCamera()'s in the live game, and for the same reason
// — see CAMERA_NEAR's comment in src/render/scene.js. The editor's fly camera
// can be pushed closer to a prop than the game's ever is, but half a metre is
// still closer than anything you can usefully look at.
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.5, 3000);
const OVERWORLD_CAMERA_POSITION = new THREE.Vector3(0, 220, 260);
const OVERWORLD_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
camera.position.copy(OVERWORLD_CAMERA_POSITION);

// Same shared pass chain as src/main.js's live game — see postProcessing.js.
const { composer, applySettings: applyPostProcessingSettings, setSize: setPostProcessingSize, update: updatePostProcessing, warmUp: warmUpPostProcessing } = createPostProcessing(renderer, scene, camera);
applyPostProcessingSettings(defaultGraphicsSettings());

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.copy(OVERWORLD_CAMERA_TARGET);
controls.maxPolarAngle = Math.PI * 0.49;
// OrbitControls' scroll-zoom is MULTIPLICATIVE against the current distance
// to `target` (dolly by a scale factor, not a fixed step) — with no
// minDistance floor (default 0), each tick at very close range moves an
// ever-smaller absolute amount as distance asymptotically approaches zero,
// which reads as "zoom just stops working" long before you actually reach
// the target. A sane floor keeps zoom in a range where it stays responsive;
// WASD flying below is the intended way to actually get in close.
controls.minDistance = 3;
controls.maxDistance = 2000;

// Tower floors are ~40-60 units across vs. the overworld's 1000 — the
// overworld camera framing makes a floor a tiny, hard-to-click patch, so
// Monsters mode reframes the camera to fit the loaded floor's bounds and
// restores the overworld view on the way out.
function frameCameraOnBounds(bounds) {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  camera.position.set(cx, size * 1.1, cz + size * 1.3);
  controls.target.set(cx, 0, cz);
  controls.update();
}
/**
 * Camera framing for a freshly-loaded map (see switchToMap). Loading a map
 * never used to touch the camera at all, so switching from a 1000-wide
 * overworld to a new 100x100 map left the camera wherever it was — far
 * outside the new map's bounds and, at this fog density, showing nothing but
 * flat fog colour ("I created a map and can't see anything").
 * Distance is capped at the overworld framing so a big map still opens at the
 * familiar close-in view rather than a fogged-out 1700-unit overview: for a
 * 1000-wide map this reproduces OVERWORLD_CAMERA_POSITION exactly.
 */
function frameCameraOnMap(bounds) {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  camera.position.set(
    cx,
    Math.min(size * 1.1, OVERWORLD_CAMERA_POSITION.y),
    cz + Math.min(size * 1.3, OVERWORLD_CAMERA_POSITION.z),
  );
  controls.target.set(cx, 0, cz);
  controls.update();
}
function restoreOverworldCamera() {
  camera.position.copy(OVERWORLD_CAMERA_POSITION);
  controls.target.copy(OVERWORLD_CAMERA_TARGET);
  controls.update();
}
// Left button is reserved entirely for editor tools (place/select/paint/zone) —
// giving OrbitControls the left button too meant the two fought over every
// drag and rotate/pan effectively never worked. Right-drag orbits, middle-drag
// pans, wheel still zooms (zoom isn't gated by mouseButtons at all).
controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.listenToKeyEvents(window); // arrow keys also pan

// --- Camera preferences (sensitivity / fly speed / ground clamp) ---
// An EDITOR preference, deliberately not part of world.json: it describes how
// this browser drives the camera, not anything about the map. Lives in
// localStorage and is edited from the 🎥 Camera Controls panel (CAMERA_SLIDERS
// / CAMERA_CHECKBOXES, wired next to the Graphics Settings modal below).
// Defaults are pitched a notch above OrbitControls' own 1.0/1.0/1.0 because
// the stock feel reads as sluggish at this world scale ("too insensitive").
const CAMERA_PREFS_KEY = 'editor.cameraPrefs.v1';
const DEFAULT_CAMERA_PREFS = {
  rotateSpeed: 1.6,
  panSpeed: 1.4,
  zoomSpeed: 1.2,
  damping: 0.08, // 0 disables damping entirely (instant, no glide)
  invertRotate: false,
  zoomToCursor: true,
  flySpeed: 60,
  flySpeedFast: 200, // Shift held — covering a 1000-unit map on foot would be tedious otherwise
  clampToGround: true,
  groundClearance: 2,
};
const cameraPrefs = { ...DEFAULT_CAMERA_PREFS };
try {
  const stored = JSON.parse(localStorage.getItem(CAMERA_PREFS_KEY) || 'null');
  // Key-by-key rather than a blanket spread so a stored blob written by an
  // older build (or hand-edited to junk) can't inject unknown keys or a
  // string where a number belongs.
  if (stored && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_CAMERA_PREFS)) {
      const value = stored[key];
      if (typeof value === typeof DEFAULT_CAMERA_PREFS[key]) cameraPrefs[key] = value;
    }
  }
} catch { /* unreadable prefs just fall back to defaults */ }

function saveCameraPrefs() {
  try {
    localStorage.setItem(CAMERA_PREFS_KEY, JSON.stringify(cameraPrefs));
  } catch { /* private-mode/quota — prefs still apply for this session */ }
}

function applyCameraPrefs() {
  // OrbitControls has no invert option; the drag delta is scaled by a single
  // rotateSpeed before it becomes theta/phi, so a negative speed is the whole
  // implementation — and it flips both axes together, which is why the panel
  // offers one toggle rather than per-axis ones. (Per-axis would mean patching
  // OrbitControls' internals, and the browser runs the CDN-pinned three
  // 0.164.1 from editor.html's importmap — NOT node_modules' newer copy —
  // where those rotate helpers are closure-private and unpatchable.)
  controls.rotateSpeed = cameraPrefs.rotateSpeed * (cameraPrefs.invertRotate ? -1 : 1);
  controls.panSpeed = cameraPrefs.panSpeed;
  controls.zoomSpeed = cameraPrefs.zoomSpeed;
  controls.zoomToCursor = cameraPrefs.zoomToCursor;
  // dampingFactor is only read while enableDamping is on; a factor of 0 would
  // freeze the camera mid-glide instead of stopping it, so 0 means "off".
  controls.enableDamping = cameraPrefs.damping > 0;
  controls.dampingFactor = cameraPrefs.damping > 0 ? cameraPrefs.damping : 0.05;
  controls.keyPanSpeed = 7 * cameraPrefs.panSpeed; // 7 is OrbitControls' own default
}
applyCameraPrefs();

// Right-dragging past the horizon, or holding Q, used to bury the camera
// under the terrain — from below, the ground is a solid backface-lit slab and
// the only way out is blind flying. maxPolarAngle can't prevent it on its own
// because the fly camera carries the orbit TARGET down with it, so "above the
// pivot" can still be underground. Camera and target are lifted by the SAME
// delta (exactly what updateFlyCamera does) so the view direction survives the
// correction — moving the camera alone would silently re-pitch the shot every
// frame and fight the damping.
function enforceCameraGroundClearance() {
  if (!cameraPrefs.clampToGround || !world) return;
  const minY = sampleTerrainHeight(world, camera.position.x, camera.position.z) + cameraPrefs.groundClearance;
  if (camera.position.y >= minY) return;
  const lift = minY - camera.position.y;
  camera.position.y += lift;
  controls.target.y += lift;
}

// --- WASD/QE fly camera ---
// Translates the camera AND its orbit target by the same delta each frame,
// so right-drag-to-look-around still works mid-flight instead of suddenly
// re-orbiting around a pivot left behind. W/S move along the camera's own
// look direction (not flattened to the ground plane) and A/D strafe
// perpendicular to it, so flying down toward the ground and forward at the
// same time works like an actual fly-through rather than a locked-height pan.
// Speeds live in cameraPrefs (world units/sec) so the 🎥 panel can tune them.
const flyKeys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false };
const FLY_KEY_CODES = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyQ: 'q', KeyE: 'e' };
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  const key = FLY_KEY_CODES[e.code];
  if (key) flyKeys[key] = true;
  if (e.shiftKey) flyKeys.shift = true;
});
window.addEventListener('keyup', (e) => {
  const key = FLY_KEY_CODES[e.code];
  if (key) flyKeys[key] = false;
  if (!e.shiftKey) flyKeys.shift = false;
});
// A held key surviving a window/tab blur (e.g. Alt-Tabbing away) would
// otherwise fly forever with no keyup to stop it.
window.addEventListener('blur', () => {
  for (const k of Object.keys(flyKeys)) flyKeys[k] = false;
});

const _flyForward = new THREE.Vector3();
const _flyRight = new THREE.Vector3();
const _flyMove = new THREE.Vector3();
function updateFlyCamera(dt) {
  if (!flyKeys.w && !flyKeys.a && !flyKeys.s && !flyKeys.d && !flyKeys.q && !flyKeys.e) return;
  camera.getWorldDirection(_flyForward);
  _flyRight.crossVectors(_flyForward, camera.up).normalize();
  _flyMove.set(0, 0, 0);
  if (flyKeys.w) _flyMove.add(_flyForward);
  if (flyKeys.s) _flyMove.sub(_flyForward);
  if (flyKeys.d) _flyMove.add(_flyRight);
  if (flyKeys.a) _flyMove.sub(_flyRight);
  if (flyKeys.e) _flyMove.y += 1;
  if (flyKeys.q) _flyMove.y -= 1;
  if (_flyMove.lengthSq() === 0) return;
  _flyMove.normalize().multiplyScalar((flyKeys.shift ? cameraPrefs.flySpeedFast : cameraPrefs.flySpeed) * dt);
  camera.position.add(_flyMove);
  controls.target.add(_flyMove);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  setPostProcessingSize(window.innerWidth, window.innerHeight);
});

// --- World state ---
/** @type {import('../sim/world.js').IWorld} */
let world = null;
let groundMesh = null;
let terrainDirty = false;
// Same once-per-frame throttle as terrainDirty/pathsDirty: refreshLists() rebuilds
// full innerHTML for every placed-object/zone/building/NPC list, which is O(total
// world content) — calling it on every scatter-brush stamp (every 80ms) instead of
// once per frame is what makes the editor feel unresponsive on a densely-populated map.
let listsDirty = false;
let monsterListDirty = false; // same reasoning as listsDirty, for refreshMonsterList() during monster-scatter drags

// Wind animation, matching what buildWorldMeshes wires up for the live game
// (see the `sway`/`treeSway` it returns): individually-placed flower props
// rock as whole objects, each tree's leaf InstancedMesh advances its own
// shader clock. The editor used to animate neither, so a scene that breathes
// in game stood dead still here. Recollected once per frame when
// swayablesDirty — refreshLists() sets it, and every place/scatter/delete
// path runs through refreshLists().
let swayablesDirty = true;
let propSway = null;
let treeLeafMeshes = [];
let particleSystems = []; // ambient (painted-layer) / zone / environmental — see rebuildParticles
const SWAYING_FLOWER_TYPES = new Set(['flower', 'flower-daisy', 'flower-bell']); // same list as buildWorldMeshes

function recollectSwayables() {
  propSway = createSwayAnimator(placedItems.filter((i) => SWAYING_FLOWER_TYPES.has(i.ref?.type)).map((i) => i.mesh));
  treeLeafMeshes = [];
  scene.traverse((obj) => { if (obj.userData.isTreeLeaves) treeLeafMeshes.push(obj); });
}
let waterMesh = null;
let seabedMesh = null;
let waterDirty = false;
let placedLakeBodies = []; // [{body, water, seabed}] — per-body lakes/puddles (src/sim/waterBodies.js), additive alongside the legacy waterMesh/seabedMesh above
let lakeBodiesDirty = false; // depth-shading bakes terrain height, so this must also refresh whenever terrainDirty does — see the terrainDirty branch in animate()

// --- LAKE TOOL (Water mode's "Lake" sub-tool) ---
// A lake is a simple axis-aligned rectangle: place it with one click (same
// "arm, then click the ground" pattern as Buildings/the Object Builder),
// then resize/reposition it either by dragging its corner/center handles in
// the viewport or through the numeric fields — Position X/Y/Z and
// Width/Depth — the same interaction the Object Builder's shape panel
// already uses (bs-pos-x/bs-scale-x etc.). Fields-only came first, per
// Dennis's ask; the handles were added after "I can't change the size or
// shape of lakes anymore" — with no outline, no handles, and fields that
// silently no-op unless a lake is selected, a placed lake read as an
// uneditable box even though the fields did work.
//
// Deliberately NOT terrain-carving (that used to be carveWaterBodyBasin,
// src/sim/waterBodies.js) — carving created visible mismatches between the
// drawn water and the actual ground ("ugly holes") that three separate
// rendering fixes couldn't reliably close. Depth SHADING no longer depends
// on carving either: applyLakeWaterShading (src/render/scene.js) now takes
// the deeper of real terrain depth and distance-in-from-the-shoreline, so a
// lake on flat ground still reads as blue water with a foam shoreline
// instead of the all-over grey foam that the real-depth-only version
// produced once carving was removed.
const DEFAULT_LAKE_SIZE = 20;
const LAKE_MIN_SIZE = 1; // matches the Width/Depth fields' own min, so dragging can't invert a rectangle
const LAKE_CORNER_SEGMENTS = 10; // per rounded corner — 40 points for a fully-round lake, smooth enough at lake scale and still a small polygon to store/collide against
let waterToolMode = 'paint'; // 'paint' (legacy bitmap) | 'lake' | 'river' | 'puddle'
let armedLakePlacement = false;
let selectedLakeBody = null; // entry from placedLakeBodies
// Handle order is fixed: 0..3 = the four corners in computeLakeRectPoints'
// own order (-x-z, +x-z, +x+z, -x+z), 4 = the center "move whole lake" grab.
let selectedLakeHandleIndex = null;
let lakeHandleDragging = false;
const lakeHandleGroup = new THREE.Group();
lakeHandleGroup.visible = false;
scene.add(lakeHandleGroup);
const lakeOutline = new THREE.LineLoop(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3)),
  new THREE.LineBasicMaterial({ color: 0xffdd33, depthTest: false })
);
lakeOutline.renderOrder = 997;
lakeOutline.visible = false;
scene.add(lakeOutline);

// --- RIVER TOOL (Water mode's "River" sub-tool) ---
// Same click-points/Enter-to-finish draft pattern as Mountains/Paths — an
// OPEN polyline, not a closed loop like the Lake tool above (no
// click-near-start-to-close). The one real addition beyond a plain
// polyline: each point carries its own authored `surfaceHeights` entry,
// auto-sampled from the terrain at click time and immediately clamped
// non-increasing (enforceNonIncreasingHeights, src/sim/rivers.js) so the
// river can never visually flow uphill. Does NOT carve the terrain (no
// more than the Lake tool does) — the render-side bank-height clamp in
// computeRiverSpine (src/render/scene.js) keeps the surface from floating
// above the real ground instead.
// Rivers are long strokes like Mountains/Paths, not tight polygons — but 4
// units was far enough that a short drag recorded no second point at all, and
// the preview only appears at 2 points, so the tool read as dead. Matches
// Mountains now.
const RIVER_MIN_POINT_SPACING = 2;
let riverDraft = null; // { points: [{x,z}, ...], surfaceHeights: [n, ...] }
let riverDraftPreviewMesh = null;
let riverPointerDown = false;
let selectedRiver = null; // entry from placedRivers
let selectedRiverHandleIndex = null;
let riverHandleDragging = false;
const riverHandleGroup = new THREE.Group();
riverHandleGroup.visible = false;
scene.add(riverHandleGroup);
let placedRivers = []; // [{body, water, seabed}] — same shape as placedLakeBodies
let riversDirty = false; // depth-shading bakes terrain height too, same reason lakeBodiesDirty piggybacks on terrainDirty

// --- PUDDLE TOOL (Water mode's "Puddle" sub-tool) ---
// The smallest of the four — no draft, no shape editing, no terrain
// carving. A puddle is a quick-place `kind:'puddle'` WaterBodyDef (see
// src/sim/waterBodies.js), authored by clicking (or click-dragging, which
// scatters several) rather than drawn point-by-point like Lake/River —
// puddles are meant to be scattered fast into spots that already look
// low/damp, not hand-sculpted. Renders through the EXACT SAME
// buildLakeBodyMeshes/placedLakeBodies/rebuildLakeBodies pipeline as
// lakes (Phase 1 already filters for `kind === 'lake' || 'puddle'`), so
// this tool only needs to add data to world.waterBodies and flip
// lakeBodiesDirty — no new rendering code.
const PUDDLE_MIN_PLACEMENT_SPACING = 3; // minimum world-units between two puddles placed in the same drag, so a slow drag doesn't carpet-bomb one spot
const DEFAULT_PUDDLE_RADIUS = 2;
let puddlePointerDown = false;
let lastPuddlePlacePoint = null;

let mountainsDirty = false;

const staticGroup = new THREE.Group(); // zones/city/tower — rebuilt wholesale on change
scene.add(staticGroup);

/** @type {Array<{kind:'tree'|'rock'|'wall', ref: any, mesh: THREE.Object3D}>} */
const placedItems = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedBuildings = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedZones = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedFreeformZones = [];
// Zone markers (gathering-zone discs + freeform polygon fills) are opaque
// enough to obscure the ground underneath, which fights with painting ground
// textures right below a zone (e.g. a "fish" zone over a lake) — a standalone
// toggle independent of setOverworldVisible's all-or-nothing hide, so ground
// texture painting stays visible while only zone markers hide.
let zonesVisible = true;
function setZonesVisible(visible) {
  zonesVisible = visible;
  for (const z of placedZones) z.mesh.visible = visible;
  for (const z of placedFreeformZones) z.mesh.visible = visible;
}

// --- Floor grid (toggle in #top-right, or G) ---------------------------
// A flat reference grid at y=0 for judging distances and lining props up.
// DRAPED over the terrain, not a flat plane at y=0.02 the way it used to be.
// Flat was "a straight ruler can't follow hills" reasoning, but the ruler was
// unusable in practice: raised ground simply swallowed it, and even on the
// flat the ground-texture overlay (y+0.015) and paths (y+0.03) both sit above
// 0.02 and painted straight over it. Draping costs nothing in measuring terms
// — the vertices stay on their exact X/Z grid intersections, only Y moves — and
// it puts the lines on the ground you're actually placing things on.
//
// Rebuilt on map load (spacing derives from the map's bounds) AND on any
// terrain edit, since it now bakes terrain height into its vertices — the same
// staleness the ground-texture overlay has, handled the same way.
let floorGrid = null;
let floorGridVisible = false;
let floorGridDirty = false;
const FLOOR_GRID_SPACING = 5;   // world units per grid square
const FLOOR_GRID_SUBSTEP = 2.5; // how finely each line is chopped up to follow the ground between intersections
const FLOOR_GRID_LIFT = 0.12;   // clears the ground-texture overlay (0.015) and every path layer (0.03+)

/** One draped axis-aligned line, pushed into `positions` as an unindexed segment strip. */
function pushDrapedGridLine(positions, fixedAxis, fixed, from, to) {
  const steps = Math.max(1, Math.ceil((to - from) / FLOOR_GRID_SUBSTEP));
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const along = from + ((to - from) * i) / steps;
    const x = fixedAxis === 'x' ? fixed : along;
    const z = fixedAxis === 'x' ? along : fixed;
    const point = [x, sampleTerrainHeight(world, x, z) + FLOOR_GRID_LIFT, z];
    if (prev) positions.push(...prev, ...point);
    prev = point;
  }
}

function rebuildFloorGrid() {
  if (floorGrid) {
    removeAndDispose(scene, floorGrid);
    floorGrid = null;
  }
  if (!world) return;
  const { bounds } = world;
  const positions = [];
  for (let x = bounds.minX; x <= bounds.maxX + 1e-6; x += FLOOR_GRID_SPACING) {
    pushDrapedGridLine(positions, 'x', x, bounds.minZ, bounds.maxZ);
  }
  for (let z = bounds.minZ; z <= bounds.maxZ + 1e-6; z += FLOOR_GRID_SPACING) {
    pushDrapedGridLine(positions, 'z', z, bounds.minX, bounds.maxX);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x6fa8dc, transparent: true, opacity: 0.5, depthWrite: false });
  // Same distance-proportional bias the other ground decals use — without it
  // the lines start losing the depth test against the terrain they're drawn on
  // once 12cm falls below one depth step. See src/render/depthBias.js.
  applyDecalDepthBias(mat);
  floorGrid = new THREE.LineSegments(geo, mat);
  floorGrid.renderOrder = 3; // after the ground texture overlay (1) and water (2)
  floorGrid.visible = floorGridVisible;
  scene.add(floorGrid);
}

function setFloorGridVisible(visible) {
  floorGridVisible = visible;
  if (floorGrid) floorGrid.visible = visible;
  // Terrain edits made while it was hidden are skipped (see the terrainDirty
  // branch in animate) — re-drape on the way back on so it can't come up
  // buried in ground that moved since.
  if (visible) floorGridDirty = true;
  showGridCheckbox.checked = visible;
}

const showGridCheckbox = document.getElementById('show-grid-checkbox');
showGridCheckbox.addEventListener('change', (e) => setFloorGridVisible(e.target.checked));
// Shift+G, not plain G — MODE_KEYS already binds lowercase `g` to Ground
// Textures mode, and that lookup is keyed on e.key, so the shifted 'G' can't
// collide with it.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (e.shiftKey && (e.key === 'G' || e.key === 'g')) setFloorGridVisible(!floorGridVisible);
});
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedPaths = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedMountains = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedTeleporters = [];
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} world.particleEmitters — the mesh is just a click target/gizmo; the actual effect is spawned by `worldEmitters` (see Particles mode below). */
const placedEmitters = [];
/** Live three.quarks systems for this editor's scene, so placed effects and previewed skill VFX render exactly as they do in game. */
const vfxSystem = createVfxSystem(scene);
/** Streams `world.particleEmitters` in and out around the camera — the same runtime the live game uses (src/render/worldParticles.js). */
let worldEmitters = null;
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} world.lights — the mesh is the authoring gizmo (bulb + radius sphere + spot cone); the actual illumination comes from `worldLightPool` (see Lights mode below). */
const placedLights = [];
/** Binds `world.lights` to a small pool of real three.js lights — the same runtime the live game uses (src/render/worldLights.js). */
let worldLightPool = null;
let spawnPointMarker = null; // the current overworld map's login spawn beacon — see rebuildSpawnPointMarker()
let armedSpawnPoint = false; // Maps mode's "click ground to set spawn point" flow
let armedSpawnFacing = false; // Maps mode's "click ground to aim the spawn facing" flow — the clicked point is looked AT, not moved to

let selected = null; // entry from placedItems
let dragging = false;
let npcDragging = false; // Npcs mode: a placed NPC is being dragged to a new spot
let eventDragging = false; // Events mode: a placed event marker is being dragged to a new spot

// --- Tower floor / monster placement (Monsters mode) ---
// A totally separate bounded space from the overworld, so it lives in its
// own group that's shown/hidden instead of mixed into the overworld scene.
const floorGroup = new THREE.Group();
floorGroup.visible = false;
scene.add(floorGroup);
// currentFloorNumber is either a tower floor number, or the string
// 'overworld' — monsters aren't tower-exclusive, and the overworld's
// monster list (world.monsters) is edited through this same Monsters mode.
let currentFloorNumber = 'overworld';
let currentFloorDef = null;
let floorGroundMesh = null; // returned by buildFloorMeshes, used to raycast placement clicks on a tower floor
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedMonsters = []; // current tower floor's monsters
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedOverworldMonsters = []; // world.monsters — always part of the overworld scene, like props/buildings
let selectedMonster = null;
let armedMonsterPlacement = false;

/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedNpcs = []; // world.npcs — overworld town NPCs, part of the overworld scene like props
let selectedNpc = null;
let armedNpcPlacement = false;

/** @type {Array<{ref: any, mesh: THREE.Object3D}>} world.events — see src/sim/events.js. Every event gets a small marker mesh for authoring, even ones attached to an NPC (so you can still select/edit them without hunting through the NPC panel). */
const placedEvents = [];
let selectedEvent = null;
let armedEventPlacement = false;
let armedAttachPick = false; // "click to pick target in scene" for the Events panel's Attached-to field

// --- Object Builder workspace (Object Builder mode) ---
// A small fixed-size local-origin grid, isolated from the overworld the
// same way the Monsters mode's floorGroup is — hidden/shown rather than a
// second WebGL renderer. Placement raycasts a math plane (no terrain, no
// deformation, and a literal mesh would get occluded by piled-up shapes).
const BUILDER_BOUNDS = { minX: -6, maxX: 6, minZ: -6, maxZ: 6 };
const builderGroup = new THREE.Group();
builderGroup.visible = false;
builderGroup.add(new THREE.GridHelper(12, 24, 0x3f88c5, 0x223344));
scene.add(builderGroup);
const builderPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** @type {Array<{ref: any, mesh: THREE.Mesh}>} */
const builderShapes = []; // the object currently being edited
let selectedBuilderShape = null;
// Offset between the plane point under the cursor at drag-start and the
// shape's own position — without this, the first pointermove of every drag
// would snap the shape's origin to directly under the cursor (a visible
// jump unless you happened to grab exactly at its origin).
let builderDragOffset = { x: 0, z: 0 };
// A wireframe box around the selected shape (works for any geometry kind,
// unlike a per-material emissive tweak which would need per-kind handling).
const builderSelectionHighlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffdd33);
builderSelectionHighlight.visible = false;
builderGroup.add(builderSelectionHighlight);

// Selection highlight for Place/Monsters/NPCs modes — these had zero 3D
// selection feedback before (text panel only); this reuses the exact same
// BoxHelper pattern as builderSelectionHighlight above. Added to `scene`
// directly (not overworldGroup/floorGroup) so it works for a selection in
// either space without caring which one is currently visible.
const selectionHighlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffdd33);
selectionHighlight.visible = false;
selectionHighlight.renderOrder = 999;
scene.add(selectionHighlight);

// --- Place mode multi-selection (Alt+click / Alt+drag marquee) ---
//
// `selected` stays the PRIMARY item — every existing panel binding, the
// "Selected Object" fields and the drag code all keep pointing at it — and
// `multiSelected` is the full set it belongs to. Invariant: whenever
// `selected` is non-null it is also in `multiSelected`, so `selectedItems()`
// is the one thing edit/delete/move operations iterate. A plain click leaves
// a set of exactly one, which is why nothing about single-object editing
// changed.
/** @type {Set<{kind: string, ref: any, mesh: THREE.Object3D}>} */
const multiSelected = new Set();
// Secondary members get their own cyan boxes so the primary (gold) is still
// identifiable — it's the one the panel's fields are showing. Pooled rather
// than created per selection: a crop field is hundreds of props and churning
// that many BoxHelpers per click is exactly the kind of allocation that ends
// in a rebuild leak.
const multiHighlightGroup = new THREE.Group();
multiHighlightGroup.renderOrder = 999;
scene.add(multiHighlightGroup);
/** @type {THREE.BoxHelper[]} */
const multiHighlights = [];

function selectedItems() {
  return [...multiSelected];
}

/**
 * Re-fits one box per secondary selection member. Box3.setFromObject walks
 * every vertex of every child, so this is called on selection CHANGES only —
 * a group drag translates the existing boxes instead (see the pointermove
 * handler).
 */
function refreshMultiHighlights() {
  const extras = selectedItems().filter((it) => it !== selected);
  while (multiHighlights.length < extras.length) {
    const helper = new THREE.BoxHelper(new THREE.Object3D(), 0x55ddff);
    helper.renderOrder = 999;
    multiHighlightGroup.add(helper);
    multiHighlights.push(helper);
  }
  for (let i = 0; i < multiHighlights.length; i++) {
    const helper = multiHighlights[i];
    const item = extras[i];
    helper.position.set(0, 0, 0); // clear any leftover drag translation
    helper.updateMatrix();
    helper.visible = !!item;
    if (item) helper.setFromObject(item.mesh);
  }
}

/** Shifts the secondary boxes by a drag delta without re-fitting them — see refreshMultiHighlights. */
function translateMultiHighlights(dx, dz) {
  for (const helper of multiHighlights) {
    if (!helper.visible) continue;
    helper.position.set(dx, 0, dz);
    helper.updateMatrix();
  }
}

/** Called wherever a placed item is destroyed, so a stale entry can't keep a highlight box alive over nothing. */
function forgetPlacedItem(item) {
  multiSelected.delete(item);
  if (selected === item) selected = null;
}

function updateSelectionInfo() {
  if (!selected) return;
  const count = multiSelected.size;
  selectedInfo.textContent = count > 1
    ? `${count} objects selected — edits, drag and Delete apply to all. (${selected.kind} shown)`
    : `${selected.kind} — seed ${selected.ref.seed}`;
  deleteSelectedBtn.textContent = count > 1 ? `Delete ${count} objects (Del)` : 'Delete (Del)';
}

/** Adds one item to the selection, promoting it to primary if there wasn't one. Callers refresh the panel once, after the whole batch. */
function addItemToSelection(item) {
  multiSelected.add(item);
  if (!selected) selected = item;
}

/** Alt+click on a single object: in the selection -> out of it, and vice versa. */
function toggleItemSelected(item) {
  if (!multiSelected.has(item)) {
    multiSelected.add(item);
    selectItem(item, { keepMulti: true }); // the newly added one becomes the primary, so the panel shows what you just clicked
    return;
  }
  multiSelected.delete(item);
  if (selected !== item) {
    refreshMultiHighlights();
    updateSelectionInfo();
    return;
  }
  // Deselecting the primary hands the panel to whatever is left (null when
  // that was the last one, which selectItem turns into a full deselect).
  selectItem(multiSelected.values().next().value || null, { keepMulti: true });
}

// --- Alt+drag marquee (box select) ---
//
// Alt+POINTERDOWN commits to nothing: the same gesture is a toggle-click if
// the pointer doesn't move and a box-select if it does, and deciding on
// pointerup is what lets a marquee start on top of a prop without also
// toggling that prop. Selection is by screen-projected origin rather than
// by projected bounds — a tree's canopy overhangs its neighbours by metres,
// and "did the box touch any pixel of it" would grab a ring of props well
// outside the rectangle you drew.
const MARQUEE_DRAG_THRESHOLD_PX = 4;
/** @type {{startX: number, startY: number, curX: number, curY: number, hit: any, active: boolean} | null} */
let marquee = null;
const marqueeEl = document.getElementById('marquee-box');

function updateMarqueeVisual() {
  const left = Math.min(marquee.startX, marquee.curX);
  const top = Math.min(marquee.startY, marquee.curY);
  marqueeEl.style.left = `${left}px`;
  marqueeEl.style.top = `${top}px`;
  marqueeEl.style.width = `${Math.abs(marquee.curX - marquee.startX)}px`;
  marqueeEl.style.height = `${Math.abs(marquee.curY - marquee.startY)}px`;
  marqueeEl.style.display = 'block';
}

/** Where a placed item's origin lands on screen, in client (viewport) pixels — or null if it's behind the camera, where projection flips the sign and would land it in the box. */
function screenPositionOf(item, rect) {
  const ndc = item.mesh.position.clone().project(camera);
  if (ndc.z > 1) return null;
  return {
    x: rect.left + ((ndc.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - ndc.y) / 2) * rect.height,
  };
}

function finishMarquee() {
  const box = marquee;
  marquee = null;
  marqueeEl.style.display = 'none';
  if (!box) return;
  if (!box.active) {
    if (box.hit) toggleItemSelected(box.hit);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const minX = Math.min(box.startX, box.curX);
  const maxX = Math.max(box.startX, box.curX);
  const minY = Math.min(box.startY, box.curY);
  const maxY = Math.max(box.startY, box.curY);
  let added = 0;
  for (const item of placedItems) {
    if (multiSelected.has(item)) continue;
    const p = screenPositionOf(item, rect);
    if (!p || p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) continue;
    addItemToSelection(item);
    added++;
  }
  // Boxes stack: each Alt+drag adds to what's already selected, so a field
  // can be gathered in several passes. Escape (or a plain click) clears.
  selectItem(selected, { keepMulti: true });
  statusLine.textContent = added
    ? `Box-selected ${added} more — ${multiSelected.size} selected. Drag to move them, Ctrl+C to copy, Del to delete.`
    : 'Nothing inside the box.';
}

// --- Group drag ---
//
// Captured at pointerdown so every object moves by ONE shared delta off its
// own start position: re-snapping each object to the grid individually would
// collapse a tight row into a single cell, and accumulating per-frame deltas
// would drift.
/** @type {{anchor: {x: number, z: number}, starts: Array<{item: any, x: number, z: number}>} | null} */
let groupDrag = null;

function beginGroupDrag() {
  groupDrag = null;
  if (multiSelected.size < 2) return; // one object keeps the original "snap it under the cursor" behaviour
  const point = raycastGround();
  if (!point) return;
  groupDrag = {
    anchor: { x: point.x, z: point.z },
    starts: selectedItems().map((item) => ({ item, x: item.ref.position.x, z: item.ref.position.z })),
  };
}

// --- Clipboard (Ctrl+C / Ctrl+V) ---
//
// Holds deep CLONES, not live refs: the originals can be moved, edited or
// deleted between a copy and its paste. Seeds are copied along with
// everything else — a paste is meant to look identical to what was copied,
// and a prop's seed is purely generative (see buildProp), not an identity.
/** @type {{entries: Array<{kind: string, ref: any}>, origin: {x: number, z: number}} | null} */
let placeClipboard = null;

function copySelectionToClipboard() {
  const items = selectedItems();
  if (!items.length) {
    statusLine.textContent = 'Nothing selected to copy.';
    return;
  }
  const entries = items.map((it) => ({ kind: it.kind, ref: structuredClone(it.ref) }));
  const xs = entries.map((e) => e.ref.position.x);
  const zs = entries.map((e) => e.ref.position.z);
  placeClipboard = {
    entries,
    // Footprint centre, not the first object's origin, so a copied field
    // pastes centred under the cursor rather than hanging off one corner.
    origin: {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      z: (Math.min(...zs) + Math.max(...zs)) / 2,
    },
  };
  statusLine.textContent = `Copied ${entries.length} object(s). Move the cursor and press Ctrl+V to paste.`;
}

function pasteClipboard() {
  if (!placeClipboard?.entries.length) {
    statusLine.textContent = 'Clipboard is empty — select objects and press Ctrl+C first.';
    return;
  }
  pushUndoSnapshot('paste objects', ['props', 'walls']);
  const point = raycastGround();
  // Nothing under the cursor (it's over a panel, or off the map edge): drop
  // the copies next to the originals instead, so a paste is never silently
  // lost or stacked exactly on top of what it was copied from.
  const target = point
    ? { x: snap(point.x), z: snap(point.z) }
    : { x: placeClipboard.origin.x + 2, z: placeClipboard.origin.z + 2 };
  const pasted = [];
  for (const entry of placeClipboard.entries) {
    const ref = structuredClone(entry.ref);
    ref.position = {
      x: target.x + (entry.ref.position.x - placeClipboard.origin.x),
      y: entry.ref.position.y || 0,
      z: target.z + (entry.ref.position.z - placeClipboard.origin.z),
    };
    if (entry.kind === 'wall') {
      ref.id = `wall-${Math.floor(Math.random() * 1e9)}`; // ids ARE identity for walls, unlike seeds
      world.walls.push(ref);
    } else {
      world.props.push(ref);
    }
    const mesh = entry.kind === 'wall'
      ? buildWallSegmentInstance(ref, world)
      : buildPropPlaceholder(ref, world, objectCatalogById);
    toonify(mesh);
    scene.add(mesh);
    const item = { kind: entry.kind, ref, mesh };
    placedItems.push(item);
    pasted.push(item);
  }
  // The paste becomes the selection, so it can be nudged into place (or
  // pasted again) straight away.
  multiSelected.clear();
  selected = null;
  for (const item of pasted) addItemToSelection(item);
  selectItem(selected, { keepMulti: true });
  refreshLists();
  markDirty();
  statusLine.textContent = `Pasted ${pasted.length} object(s).`;
}

// --- PATH MODE state (drawn pathways) ---
// A path being drawn ("draft") isn't in world.paths yet — it's finalized by
// the Finish button. `pathsDirty` follows the same once-per-frame rebuild
// throttle as terrainDirty/waterDirty, so a fast drag doesn't rebuild the
// ribbon geometry on every pointermove.
const PATH_MIN_POINT_SPACING = 1; // min world-units between two recorded points, for both clicks and drag-sampling
let pathDraft = null; // { points: [{x,z}, ...] }
let pathDraftPreviewMesh = null;
let pathPointerDown = false;
// The ground point under the cursor while a draft is open in straight-segment
// mode, already angle-snapped — the far end of the rubber-band segment the
// preview draws ahead of the last committed point. Null when there's nothing
// to preview (freehand mode, no draft, cursor off the terrain). Drawing a
// straight road used to mean clicking blind and only seeing the segment after
// it existed, which is most of why straight roads were hard to draw at all.
let pathCursorPoint = null;
// Separate from pathsDirty on purpose: the rubber band changes on every mouse
// move, and only the draft ribbon has to be rebuilt for it. See
// rebuildPathDraftPreview.
let pathDraftDirty = false;
let pathsDirty = false;
let pathTheme = 'basic';
// Sticky draw-mode colour grade, alongside pathTheme — see
// pathDraftColorControls. Identity until the author touches a slider.
let pathDraftColorGrade = { ...DEFAULT_COLOR_GRADE };
let selectedPath = null; // entry from placedPaths
let selectedPathHandleIndex = null;
let pathHandleDragging = false;
// Small draggable spheres, one per control point of the selected path —
// direct-manipulation editing rather than sliders-only, matching how the
// Character/NPC Builder's shape gizmo already works.
const pathHandleGroup = new THREE.Group();
pathHandleGroup.visible = false;
scene.add(pathHandleGroup);
function buildPathHandleMesh() {
  const geo = new THREE.SphereGeometry(0.35, 12, 10);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffdd33, depthTest: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 998;
  return mesh;
}

// --- Draft guide: which points are already FIXED, and where the next one goes ---
// A dot on every committed point plus a dashed line running to where the next
// click would land. Deliberately NOT part of the draft ribbon, and that is the
// whole point of it: the ribbon is resampled through a Catmull-Rom spline, so
// feeding it the live cursor as a trailing control point re-shapes the segment
// you already clicked and drags its end along with the mouse — the clicked end
// visibly refuses to stay put. The ribbon therefore only ever shows COMMITTED
// geometry, and the pending segment is this separate, obviously-provisional
// dashed line.
//
// Geometry/materials are created once and reused (the markers are pooled, the
// line's two vertices are written in place) because this updates on every
// mouse move while a draft is open.
const pathDraftGuide = new THREE.Group();
pathDraftGuide.visible = false;
scene.add(pathDraftGuide);
const PATH_DRAFT_MARKER_GEO = new THREE.SphereGeometry(0.4, 12, 10);
const PATH_DRAFT_POINT_MAT = new THREE.MeshBasicMaterial({ color: 0x63d471, depthTest: false });
const PATH_DRAFT_ANCHOR_MAT = new THREE.MeshBasicMaterial({ color: 0xffdd33, depthTest: false });
const pathDraftMarkers = [];
const pathDraftPendingLine = new THREE.Line(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3)),
  new THREE.LineDashedMaterial({ color: 0x8ad6ff, dashSize: 0.7, gapSize: 0.45, depthTest: false })
);
pathDraftPendingLine.renderOrder = 999;
pathDraftPendingLine.visible = false;
pathDraftGuide.add(pathDraftPendingLine);

/** A dot per committed draft point — the last one highlighted, since that's what the next segment's angle is measured from. */
function updatePathDraftMarkers(points) {
  while (pathDraftMarkers.length < points.length) {
    const marker = new THREE.Mesh(PATH_DRAFT_MARKER_GEO, PATH_DRAFT_POINT_MAT);
    marker.renderOrder = 999;
    pathDraftMarkers.push(marker);
    pathDraftGuide.add(marker);
  }
  pathDraftMarkers.forEach((marker, i) => {
    const p = points[i];
    marker.visible = !!p;
    if (!p) return;
    marker.material = i === points.length - 1 ? PATH_DRAFT_ANCHOR_MAT : PATH_DRAFT_POINT_MAT;
    marker.position.set(p.x, sampleTerrainHeight(world, p.x, p.z) + 0.3, p.z);
  });
}

/** The dashed "this is what the next click adds" segment, or hidden when there's nothing pending. */
function updatePathPendingLine(from, to) {
  if (!from || !to) {
    pathDraftPendingLine.visible = false;
    return;
  }
  const pos = pathDraftPendingLine.geometry.attributes.position;
  pos.setXYZ(0, from.x, sampleTerrainHeight(world, from.x, from.z) + 0.3, from.z);
  pos.setXYZ(1, to.x, sampleTerrainHeight(world, to.x, to.z) + 0.3, to.z);
  pos.needsUpdate = true;
  pathDraftPendingLine.geometry.computeBoundingSphere();
  pathDraftPendingLine.computeLineDistances(); // dashes are computed from positions, so this has to follow them
  pathDraftPendingLine.visible = true;
}

// --- INVISIBLE WALL state (Terrain mode's second tool) ---
// Same click-points/Enter-to-finish draft pattern as Paths above, and for the
// same reason: it's the shape a "fence this off" tool wants. A barrier is
// data-only in the live game (src/sim/barriers.js -> a collider in
// collision.js); the translucent red ribbon below exists ONLY here, and only
// while the tool is selected, so it can't be mistaken for something players see.
// Declared up here with the rest of the barrier state, not down beside
// setTerrainToolMode where it's used: setMode() calls setBarrierVisibility(),
// which reads this, and setMode is defined far above that section — a `let` in
// its natural place would be in the temporal dead zone for that path.
let terrainToolMode = 'sculpt'; // Terrain mode's tool: 'sculpt' | 'barrier'
const BARRIER_MIN_POINT_SPACING = 1;
const BARRIER_WALL_HEIGHT = 2.5; // editor-only: how tall the preview ribbon is drawn
let barrierDraft = null; // { points: [{x,z}, ...] }
let barrierDraftPreviewMesh = null;
let barrierPointerDown = false;
let barriersDirty = false;
let selectedBarrier = null; // entry from placedBarriers
let selectedBarrierHandleIndex = null;
let barrierHandleDragging = false;
/** @type {Array<{ref: any, mesh: THREE.Object3D}>} */
const placedBarriers = [];
const barrierGroup = new THREE.Group();
scene.add(barrierGroup);
const barrierHandleGroup = new THREE.Group();
barrierHandleGroup.visible = false;
scene.add(barrierHandleGroup);

// --- MOUNTAINS MODE state (drawn mountain ridges) ---
// Same click-points/Enter-to-finish draft pattern as Paths above. The one
// real difference: finishing a ridge also permanently raises world.terrain
// under it (stampMountainHeight, src/sim/mountains.js) — so unlike a path,
// a finished ridge isn't purely cosmetic and can't be un-drawn by deleting
// it (the raised terrain stays; see stampMountainHeight's doc comment).
// Because of that, and because re-stamping on every drag frame while
// editing an existing ridge would be an O(65^2 * samples) recompute per
// pointermove, control-point handle dragging is deliberately NOT supported
// here (unlike Paths) — a ridge's shape is fixed once finished; only its
// width/peakHeight/theme stay editable afterward via the selected-ridge
// panel, with height changes re-applied on 'change' (drag-release), not
// on every 'input' tick.
const MOUNTAIN_MIN_POINT_SPACING = 2; // sparser than paths' 1 — ridges are big, wide shapes, dense clicking to a mountain-preset breeder isn't needed
let mountainDraft = null; // { points: [{x,z}, ...] }
let mountainDraftPreviewMesh = null;
let mountainPointerDown = false;
let mountainTheme = 'rock';
let selectedMountain = null; // entry from placedMountains

// --- FREEFORM ZONE state (Zones mode's "Freeform" shape) ---
// Same draft/finish/cancel/handle-drag pattern as Paths above, closed into a
// loop instead of left open, and carrying music/ambientSound/particleType
// instead of a visual theme.
const FREEFORM_ZONE_MIN_POINT_SPACING = 1;
const FREEFORM_ZONE_CLOSE_DISTANCE = 2; // clicking within this of the start point closes the loop, same idea as Enter
let zoneShapeMode = 'circle'; // 'circle' | 'freeform' — which Zones-mode sub-tool is active
let freeformZoneDraft = null; // { points: [{x,z}, ...] }
let freeformZoneDraftPreviewMesh = null;
let freeformZonePointerDown = false;
let freeformZonesDirty = false;
let selectedFreeformZone = null; // entry from placedFreeformZones
let selectedFreeformZoneHandleIndex = null;
let freeformZoneHandleDragging = false;
const freeformZoneHandleGroup = new THREE.Group();
freeformZoneHandleGroup.visible = false;
scene.add(freeformZoneHandleGroup);

function setOverworldVisible(visible) {
  if (groundMesh) groundMesh.visible = visible;
  if (groundTextureOverlayMesh) groundTextureOverlayMesh.visible = visible;
  if (waterMesh) waterMesh.visible = visible;
  if (seabedMesh) seabedMesh.visible = visible;
  for (const { water: lbWater, seabed: lbSeabed, skirt: lbSkirt } of placedLakeBodies) {
    if (lbWater) lbWater.visible = visible;
    if (lbSeabed) lbSeabed.visible = visible;
    if (lbSkirt) lbSkirt.visible = visible;
  }
  for (const { water: rWater, seabed: rSeabed, skirt: rSkirt } of placedRivers) {
    if (rWater) rWater.visible = visible;
    if (rSeabed) rSeabed.visible = visible;
    if (rSkirt) rSkirt.visible = visible;
  }
  staticGroup.visible = visible;
  for (const item of placedItems) item.mesh.visible = visible;
  for (const b of placedBuildings) b.mesh.visible = visible;
  for (const z of placedZones) z.mesh.visible = visible;
  for (const z of placedFreeformZones) z.mesh.visible = visible;
  for (const m of placedOverworldMonsters) m.mesh.visible = visible;
  for (const n of placedNpcs) n.mesh.visible = visible;
  for (const p of placedPaths) p.mesh.visible = visible;
  for (const m of placedMountains) m.mesh.visible = visible;
  pathHandleGroup.visible = visible && selectedPath != null && mode === 'path';
  freeformZoneHandleGroup.visible = visible && selectedFreeformZone != null && mode === 'zones' && zoneShapeMode === 'freeform';
  riverHandleGroup.visible = visible && selectedRiver != null && mode === 'water' && waterToolMode === 'river';
  lakeHandleGroup.visible = visible && selectedLakeBody != null && mode === 'water' && waterToolMode === 'lake';
  lakeOutline.visible = lakeHandleGroup.visible;
}

// --- Multi-map support: which map is currently loaded into `world` ---
// Every map (overworld/building/dungeon — see src/sim/maps.js) is its own
// JSON file; the editor only ever has ONE loaded into `world` at a time.
// `currentMapId` is what "Save World to Server" (below) and every Maps-mode
// action key off of — see setMode('maps')'s panel.
let currentMapId = null;
let mapsCatalog = []; // [{id, name, mapType, path, isDefault?}], refreshed from GET /api/maps

async function refreshMapsCatalog() {
  const res = await fetch('/api/maps');
  mapsCatalog = await res.json();
  return mapsCatalog;
}

/** Normalizes a freshly-fetched map document into `world` — the same defaults-backfill + terrain/water resolution migration every loaded map needs, not just the default overworld one. */
function applyLoadedWorldDoc(data) {
  world = parseWorld(structuredClone(data));
  if (!world.walls) world.walls = [];
  if (!world.monsters) world.monsters = [];
  if (!world.npcs) world.npcs = [];
  if (!world.paths) world.paths = [];
  if (!world.mountains) world.mountains = [];
  if (!world.groundTextures) world.groundTextures = [];
  if (!world.teleporters) world.teleporters = [];
  if (!world.particleEmitters) world.particleEmitters = [];
  if (!world.lights) world.lights = [];
  if (!world.waterBodies) world.waterBodies = [];
  if (!world.graphicsSettings) world.graphicsSettings = defaultGraphicsSettings();
  // Absent on every map saved before the field existed — filled in with the
  // values those maps were already playing at, so opening the Player Camera
  // tab shows real numbers and the block persists on the next save.
  if (!world.graphicsSettings.playerCamera) world.graphicsSettings.playerCamera = playerCameraOf(null);
  if (!world.treeSettings) world.treeSettings = { leafDensity: 1.5 };
  // Upgrade an existing world's terrain/water grid to the current shared
  // resolution in place (bilinear-resampled, so already-painted shapes
  // survive) — see DEFAULT_TERRAIN_WATER_RESOLUTION's own comment for why
  // this must stay in lockstep between terrain and water.
  if (world.terrain && world.terrain.resolution < DEFAULT_TERRAIN_WATER_RESOLUTION) {
    world.terrain.heights = resampleGrid(world.terrain.heights, world.terrain.resolution, DEFAULT_TERRAIN_WATER_RESOLUTION);
    world.terrain.resolution = DEFAULT_TERRAIN_WATER_RESOLUTION;
  }
  if (world.waterMask && world.waterMask.resolution < DEFAULT_TERRAIN_WATER_RESOLUTION) {
    world.waterMask.cells = resampleGrid(world.waterMask.cells, world.waterMask.resolution, DEFAULT_TERRAIN_WATER_RESOLUTION);
    world.waterMask.resolution = DEFAULT_TERRAIN_WATER_RESOLUTION;
  }
  treeDensityEl.value = world.treeSettings.leafDensity;
  treeDensityOutEl.textContent = world.treeSettings.leafDensity;
  markClean(); // a freshly-loaded map has, by definition, nothing unsaved yet
}

/** Swaps the editor's entire working `world` for a different map and rebuilds the scene from it — the generalized version of Monsters mode's loadFloor(), for any map instead of just a tower floor. */
async function switchToMap(id) {
  // Loading another map throws away the in-memory `world` outright — the same
  // loss closing the tab would cause, and beforeunload can't cover it because
  // the page never unloads.
  if (unsavedChanges && !confirm('This map has unsaved changes. Load a different map and lose them?')) return;
  const res = await fetch(`/api/maps/${id}`);
  if (!res.ok) throw new Error(`server responded ${res.status}`);
  const data = await res.json();
  currentMapId = id;
  // The stack holds collections cloned out of the OUTGOING map — undoing one
  // into a different map would paste that map's props/monsters into this one.
  undoStack.length = 0;
  refreshUndoButton();
  applyLoadedWorldDoc(data);
  // Anisotropy before rebuildAll() — ground/path/mountain textures read it
  // at creation time (see renderSettings.js).
  setCurrentAnisotropy(world.graphicsSettings.anisotropy);
  applyPostProcessingSettings(world.graphicsSettings);
  applyGraphicsSettingsToAtmosphere(scene, world.graphicsSettings);
  frameCameraOnMap(world.bounds);
  rebuildAll();
  // The Ground Textures panel's particle and colour widgets show ONE layer's
  // settings (the selected texture's), so a map switch has to re-read them
  // from the incoming map — otherwise they keep displaying the previous map's
  // values and the next edit stamps those onto this map's layer.
  syncGroundTexParticleDropdown();
  statusLine.textContent = `Loaded "${world.name}" (${world.mapType || 'overworld'}) — ready`;
  if (currentFloorNumber === 'overworld') loadOverworldMonsters();
  renderMapsList();
  populateBuildingMapDatalist();
}

// --- Load the default overworld map from server on boot ---
refreshMapsCatalog()
  .then((catalog) => {
    const def = catalog.find((m) => m.isDefault) || catalog[0];
    if (!def) throw new Error('no maps in manifest');
    return switchToMap(def.id);
  })
  .catch((err) => {
    statusLine.textContent = `Failed to load world: ${err.message}`;
    console.error(err);
  });

// Every rebuild below DISPOSES what it replaces, not just unparents it.
// These run on a dirty flag once per frame while a brush is dragged, and each
// throws away a full-map plane (257x257 vertices) plus, for water, a freshly
// baked mask/terrain-height DataTexture. Leaking those is what used to freeze
// the editor mid-stroke and then kill the next page load with "Array buffer
// allocation failed" — see src/render/dispose.js.
function rebuildGround() {
  removeAndDispose(scene, groundMesh);
  groundMesh = buildGroundMesh(world);
  scene.add(groundMesh);
}

function rebuildWater() {
  removeAndDispose(scene, seabedMesh);
  seabedMesh = buildSeabedMesh(world); // added before water so water's transparent surface composites over it
  if (seabedMesh) scene.add(seabedMesh);
  removeAndDispose(scene, waterMesh);
  waterMesh = buildWaterMesh(world);
  if (waterMesh) scene.add(waterMesh);
}

/** Rebuilds every discrete lake/puddle body's mesh pair (src/sim/waterBodies.js) — additive alongside rebuildWater()'s legacy waterMask plane above. Driven by lakeBodiesDirty, same once-per-frame throttle as rebuildWater/rebuildGround. Must re-run whenever terrain changes too (depth-shading bakes terrain height into a texture at build time), which is why the terrainDirty branch in animate() also sets lakeBodiesDirty. */
function rebuildLakeBodies() {
  for (const { water: w, seabed: s, skirt: sk } of placedLakeBodies) {
    removeAndDispose(scene, w);
    removeAndDispose(scene, s);
    removeAndDispose(scene, sk);
  }
  placedLakeBodies = buildLakeBodyMeshes(world);
  for (const { water: w, seabed: s, skirt: sk } of placedLakeBodies) {
    if (s) scene.add(s); // seabed first so water's transparent surface composites over it
    if (sk) scene.add(sk);
    if (w) scene.add(w);
  }
  // Re-point selectedLakeBody at its fresh entry (the old object was just
  // discarded above) — same "look it up by id, not by stale reference"
  // pattern rebuildPaths/rebuildFreeformZones don't need since they mutate
  // world.zones/world.paths in place, but buildLakeBodyMeshes builds brand
  // new {body, water, seabed} wrapper objects every call.
  if (selectedLakeBody) {
    selectedLakeBody = placedLakeBodies.find((l) => l.body === selectedLakeBody.body) || null;
  }
  updateLakeHandles();

  refreshLakeList();
  refreshPuddleList(); // puddles are kind:'puddle' entries in the same placedLakeBodies array — see the PUDDLE TOOL section for why
}

/** River counterpart of rebuildLakeBodies() above — same structure, same reasons for each piece. */
function rebuildRivers() {
  for (const { water: w, seabed: s, skirt: sk } of placedRivers) {
    removeAndDispose(scene, w);
    removeAndDispose(scene, s);
    removeAndDispose(scene, sk);
  }
  placedRivers = buildRiverBodyMeshes(world);
  for (const { water: w, seabed: s, skirt: sk } of placedRivers) {
    if (s) scene.add(s);
    if (sk) scene.add(sk);
    if (w) scene.add(w);
  }
  if (selectedRiver) {
    selectedRiver = placedRivers.find((r) => r.body === selectedRiver.body) || null;
  }

  removeAndDispose(scene, riverDraftPreviewMesh);
  riverDraftPreviewMesh = null;
  if (riverDraft && riverDraft.points.length >= 2) {
    riverDraftPreviewMesh = buildRiverDraftPreviewMesh(riverDraft);
    scene.add(riverDraftPreviewMesh);
  }

  updateRiverHandlePositions();
  refreshRiverList();
}

function rebuildStatic() {
  staticGroup.clear();
  // City zones no longer get a rendered ring (buildCityWallPlaceholder) — the
  // live game already dropped it (buildWorldMeshes in scene.js only builds
  // the tower for zone markers), and the editor now matches.
  for (const zone of world.zones) {
    if (zone.type === 'tower') staticGroup.add(buildTowerPlaceholder(zone));
  }
}

/** Rebuilds every saved path's ribbon mesh, plus the in-progress draft's live preview (if any). Driven by pathsDirty, checked once per animate() frame — see rebuildGround/rebuildWater for the same throttling pattern. */
function rebuildPaths() {
  for (const p of placedPaths) removeAndDispose(scene, p.mesh);
  placedPaths.length = 0;
  // Same depth layering the live game uses (buildPathMeshes) — the editor used
  // to build every path at layer 0, so crossings z-fought here and nowhere
  // else, which is exactly the editor/game divergence we keep stamping out.
  const pathLayers = assignPathLayers(world.paths || []);
  (world.paths || []).forEach((ref, i) => {
    const mesh = buildPathMesh(ref, world, pathLayers[i]);
    if (mesh) {
      scene.add(mesh);
      placedPaths.push({ ref, mesh });
    }
  });

  rebuildPathDraftPreview();
  updatePathHandlePositions();
  refreshPathList();
}

/**
 * Just the in-progress draft's translucent ribbon — split out of rebuildPaths
 * so the straight-mode rubber band can follow the cursor without rebuilding
 * every saved path's geometry and re-rendering the path list on every mouse
 * move. Driven by `pathDraftDirty`; rebuildPaths still calls it so the two
 * can't drift.
 */
function rebuildPathDraftPreview() {
  removeAndDispose(scene, pathDraftPreviewMesh);
  pathDraftPreviewMesh = null;
  // Straight mode only: a freehand stroke records a point every metre, so
  // dotting each one would put hundreds of markers on screen for a shape whose
  // individual points nobody is aiming at anyway.
  const showGuide = !!pathDraft && pathStraightEl.checked;
  pathDraftGuide.visible = showGuide;
  if (showGuide) {
    updatePathDraftMarkers(pathDraft.points);
    updatePathPendingLine(pathDraftAnchor(), pathCursorPoint);
  }
  if (!pathDraft) return;

  // COMMITTED POINTS ONLY — never the live cursor. buildPathMesh resamples the
  // polyline through a Catmull-Rom spline, so a trailing cursor point is not a
  // harmless extra segment on the end: it bends the segment before it and
  // pulls its endpoint away from where it was clicked, so a point you fixed
  // with a click carried on moving with the mouse. Where the NEXT point would
  // go is the dashed guide line's job instead.
  if (pathDraft.points.length < 2) return;
  const draftWidth = parseFloat(pathWidthEl.value) || DEFAULT_PATH_WIDTH;
  // Top layer, so the half-transparent preview reads above anything it
  // crosses while you're still clicking it out.
  pathDraftPreviewMesh = buildPathMesh(
    { points: pathDraft.points, width: draftWidth, theme: pathTheme, colorGrade: pathDraftColorGrade },
    world,
    MAX_PATH_LAYERS - 1
  );
  if (pathDraftPreviewMesh) {
    pathDraftPreviewMesh.material.transparent = true;
    pathDraftPreviewMesh.material.opacity = 0.6;
    scene.add(pathDraftPreviewMesh);
  }
}

/** Repositions the selected path's control-point handle spheres (called after rebuildPaths, and after a handle drag). */
function updatePathHandlePositions() {
  pathHandleGroup.clear();
  if (!selectedPath) {
    pathHandleGroup.visible = false;
    return;
  }
  for (const pt of selectedPath.ref.points) {
    const handle = buildPathHandleMesh();
    const y = sampleTerrainHeight(world, pt.x, pt.z) + 0.15;
    handle.position.set(pt.x, y, pt.z);
    pathHandleGroup.add(handle);
  }
  pathHandleGroup.visible = mode === 'path';
}

/** Rebuilds every saved mountain ridge's ribbon mesh, plus the in-progress draft's live preview (if any). Driven by mountainsDirty, same once-per-frame throttle as rebuildPaths. */
function rebuildMountains() {
  for (const m of placedMountains) removeAndDispose(scene, m.mesh);
  placedMountains.length = 0;
  for (const ref of world.mountains || []) {
    const mesh = buildMountainRidgeMesh(ref, world);
    if (mesh) {
      scene.add(mesh);
      placedMountains.push({ ref, mesh });
    }
  }

  removeAndDispose(scene, mountainDraftPreviewMesh);
  mountainDraftPreviewMesh = null;
  if (mountainDraft && mountainDraft.points.length >= 2) {
    const draftWidth = parseFloat(mountainWidthEl.value) || DEFAULT_MOUNTAIN_WIDTH;
    const draftPeak = parseFloat(mountainPeakHeightEl.value) || DEFAULT_PEAK_HEIGHT;
    // The draft preview follows CURRENT terrain (flat, if nothing's been
    // drawn here before) — it can't show the eventual crest because
    // stampMountainHeight hasn't run yet (only Finish triggers it). The
    // ribbon jumps up to its real elevated shape the moment you finish.
    mountainDraftPreviewMesh = buildMountainRidgeMesh(
      { points: mountainDraft.points, width: draftWidth, peakHeight: draftPeak, theme: mountainTheme },
      world
    );
    if (mountainDraftPreviewMesh) {
      mountainDraftPreviewMesh.material.transparent = true;
      mountainDraftPreviewMesh.material.opacity = 0.6;
      scene.add(mountainDraftPreviewMesh);
    }
  }

  refreshMountainList();
}

/** Rebuilds every saved freeform (polygon-shape) zone's marker, plus the in-progress draft's live preview. Same once-per-frame throttle (freeformZonesDirty) as rebuildPaths. */
function rebuildFreeformZones() {
  for (const z of placedFreeformZones) removeAndDispose(scene, z.mesh);
  placedFreeformZones.length = 0;
  for (const ref of world.zones.filter((z) => z.shape === 'polygon')) {
    const mesh = buildFreeformZoneMarker(ref);
    mesh.visible = zonesVisible;
    scene.add(mesh);
    placedFreeformZones.push({ ref, mesh });
  }

  removeAndDispose(scene, freeformZoneDraftPreviewMesh);
  freeformZoneDraftPreviewMesh = null;
  if (freeformZoneDraft && freeformZoneDraft.points.length >= 3) {
    freeformZoneDraftPreviewMesh = buildFreeformZoneMarker({ points: freeformZoneDraft.points });
    freeformZoneDraftPreviewMesh.traverse((obj) => {
      if (obj.material) { obj.material.transparent = true; obj.material.opacity *= 0.7; }
    });
    scene.add(freeformZoneDraftPreviewMesh);
  }

  updateFreeformZoneHandlePositions();
  refreshFreeformZoneList();
}

/** Repositions the selected freeform zone's control-point handle spheres (called after rebuildFreeformZones, and after a handle drag). Flat at a fixed height, not terrain-following — same simplification buildFreeformZoneMarker itself uses. */
function updateFreeformZoneHandlePositions() {
  freeformZoneHandleGroup.clear();
  if (!selectedFreeformZone) {
    freeformZoneHandleGroup.visible = false;
    return;
  }
  for (const pt of selectedFreeformZone.ref.points) {
    const handle = buildPathHandleMesh();
    handle.position.set(pt.x, 0.3, pt.z);
    freeformZoneHandleGroup.add(handle);
  }
  freeformZoneHandleGroup.visible = mode === 'zones' && zoneShapeMode === 'freeform';
}

/**
 * Drop every mode's current selection. Called before an undo restores a
 * world collection: each selection holds a direct `ref` into one of those
 * arrays, and after the swap those refs point at objects the world no longer
 * contains — editing one would silently write into a detached object.
 */
function clearAllSelections() {
  eventFormDirty = false; // the event being edited is about to be replaced wholesale; don't prompt about it
  selectItem(null);
  selectMonster(null);
  selectNpc(null);
  selectPath(null);
  selectBarrier(null);
  selectMountain(null);
  selectTeleporter(null);
  selectEmitter(null);
  selectLight(null);
  selectEvent(null);
  selectLakeBody(null);
  deselectRiver();
  deselectFreeformZone();
}

function rebuildAll() {
  // Several unrelated catalog fetches (monster types, character types,
  // object defs, models) each call rebuildAll() once THEY finish loading,
  // with no guarantee they resolve after the map itself does — multi-map
  // loading added a second network round-trip (list maps, then fetch the
  // one to load) before `world` is set, which made this race far more
  // likely to actually lose. A no-op here is safe: switchToMap() always
  // calls rebuildAll() itself right after `world` is set, so nothing is
  // permanently skipped, just deferred until the map is actually ready.
  if (!world) return;
  rebuildFloorGrid(); // sized from world.bounds, so it follows a map switch
  rebuildGround();
  rebuildStatic();
  rebuildPaths();
  rebuildBarriers();
  rebuildMountains();
  rebuildFreeformZones();

  // Every placedItems entry is about to be replaced by a fresh object, so any
  // surviving Place-mode selection would be holding a detached ref and a mesh
  // that's no longer in the scene — with a multi-selection that also means
  // highlight boxes left floating over nothing.
  selectItem(null);
  for (const item of placedItems) scene.remove(item.mesh);
  placedItems.length = 0;
  for (const prop of world.props) {
    const mesh = buildPropPlaceholder(prop, world, objectCatalogById);
    scene.add(mesh);
    placedItems.push({ kind: prop.type, ref: prop, mesh });
  }
  for (const wallSeg of world.walls) {
    const mesh = buildWallSegmentInstance(wallSeg, world);
    scene.add(mesh);
    placedItems.push({ kind: 'wall', ref: wallSeg, mesh });
  }

  for (const b of placedBuildings) scene.remove(b.mesh);
  placedBuildings.length = 0;
  for (const b of world.buildings) {
    const mesh = buildBuildingPlaceholder(b, world, buildingCatalogForRender);
    scene.add(mesh);
    placedBuildings.push({ ref: b, mesh });
  }

  for (const t of placedTeleporters) scene.remove(t.mesh);
  placedTeleporters.length = 0;
  if (!world.teleporters) world.teleporters = [];
  for (const t of world.teleporters) {
    // Editor shows every teleporter — visible ones as the real glowing
    // ring, invisible ones as a dim wireframe gizmo — so an invisible one
    // (a hidden shortcut, or a plain link that doesn't need its own
    // portal-looking marker) is still selectable/editable here even though
    // the live game renders nothing for it (see buildWorldMeshes).
    const mesh = buildTeleporterMesh(t, { gizmo: !t.visible });
    scene.add(mesh);
    placedTeleporters.push({ ref: t, mesh });
  }

  rebuildSpawnPointMarker();

  for (const z of placedZones) scene.remove(z.mesh);
  placedZones.length = 0;
  for (const zone of world.zones) {
    if (zone.type !== 'gathering') continue;
    const mesh = buildZoneMarker(zone);
    mesh.visible = zonesVisible;
    scene.add(mesh);
    placedZones.push({ ref: zone, mesh });
  }

  for (const m of placedOverworldMonsters) scene.remove(m.mesh);
  placedOverworldMonsters.length = 0;
  for (const spawn of world.monsters || []) {
    const mesh = generateMonster(spawn.type, hashStringToSeed(spawn.id), monsterTypeCatalogById);
    applyMonsterAppearance(mesh, spawn);
    mesh.position.set(spawn.position.x, spawn.position.y || 0, spawn.position.z);
    scene.add(mesh);
    placedOverworldMonsters.push({ ref: spawn, mesh });
  }

  for (const n of placedNpcs) scene.remove(n.mesh);
  placedNpcs.length = 0;
  for (const npc of world.npcs || []) {
    const mesh = buildNpcMesh(npc);
    scene.add(mesh);
    placedNpcs.push({ ref: npc, mesh });
  }

  for (const ev of placedEvents) scene.remove(ev.mesh);
  placedEvents.length = 0;
  if (!world.events) world.events = [];
  for (const ev of world.events) {
    const mesh = buildEventMarkerMesh(ev);
    scene.add(mesh);
    placedEvents.push({ ref: ev, mesh });
  }

  // Matches the live game's shading exactly (buildWorldMeshes/buildPlayerMesh/
  // buildMonsterMesh all call this too). Safe to call on the whole scene every
  // rebuild — it only ever touches MeshStandardMaterial, so already-toonified
  // meshes and the grass/flower/zone-marker materials (all either
  // MeshBasicMaterial or already MeshToonMaterial with their own
  // onBeforeCompile) are untouched. Individual placement functions below
  // (single-item place, scatter brush, selected-mesh rebuild) that bypass
  // rebuildAll() call toonify() on just their own new mesh instead of paying
  // for a full-scene sweep.
  toonify(scene);

  // Ground-texture overlay and water/seabed MUST be built after toonify(),
  // never passed through it — same reason and same ordering as
  // buildWorldMeshes in scene.js (the live game). Their real behavior lives
  // entirely in a custom onBeforeCompile fragment shader; toonify() only
  // knows how to carry over color/map/transparent/opacity/emissive/
  // gradientMap onto a fresh MeshToonMaterial, with no idea a custom shader
  // exists, so it would silently discard the whole multi-layer ground-
  // texture blend (or the water ripple shader) and leave the mesh sampling
  // its raw dummy .map stretched across the entire map's 0..1 UV — this WAS
  // exactly the bug: rebuildGroundTextureOverlay()/rebuildWater() used to run
  // before this toonify(scene) call, unlike the live game, which is why
  // ground textures looked like a giant stretched grid in the editor only.
  rebuildGroundTextureOverlay();
  rebuildWater();
  rebuildLakeBodies();
  rebuildRivers();
  rebuildParticles();
  rebuildParticleEmitters();
  rebuildLightSources();

  refreshLists();

  warmUpPostProcessing(); // see postProcessing.js's warmUp() for why this exists
}

/**
 * The three particle layers the live game builds right after
 * buildWorldMeshes (see src/main.js): per-painted-ground-texture-layer,
 * per-zone, and the map-wide `graphicsSettings.environmental` one. The
 * editor has the UI to author all three but never rendered any of them, so
 * snow authored here only ever showed up in game. Cheap enough to rebuild
 * wholesale on every rebuildAll — they're derived from world data, and the
 * live game builds them exactly once the same way.
 */
function rebuildParticles() {
  for (const p of particleSystems) {
    scene.remove(p.group);
    // The live game never rebuilds these, so nothing owns disposal there —
    // here they're regenerated on every map switch and every Environment
    // slider change, which without this leaks a Points buffer each time.
    p.group.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
  }
  particleSystems.length = 0;
  const built = [
    createAmbientParticleSystem(world),
    createZoneParticleSystem(world),
    createEnvironmentalParticleSystem(world, world.graphicsSettings?.environmental),
  ];
  for (const system of built) {
    if (system.isEmpty) continue;
    scene.add(system.group);
    particleSystems.push(system);
  }
}

/** Map types whose `spawnPoint` is a real, live entry point — an overworld's login spawn, and a dungeon's arrival point (server/index.js's enterTowerFloor hands `mapEntry.world.spawnPoint` to enterDungeonMap, so a dungeon that never set one drops every party at the origin). Building interiors are excluded: they're entered through the door that leads to them, which supplies its own arrival position. */
const SPAWN_POINT_MAP_TYPES = ['overworld', 'dungeon'];

/** Repositions (or creates) the gold spawn-point beacon at world.spawnPoint. Shown for every overworld map, not just the default one — a non-default overworld's spawnPoint is currently unused live, but keeping the marker visible everywhere avoids a "why is it here on this map but not that one" surprise, and it costs nothing (one small unlit mesh). */
function rebuildSpawnPointMarker() {
  if (spawnPointMarker) {
    scene.remove(spawnPointMarker);
    spawnPointMarker = null;
  }
  if (!world || !SPAWN_POINT_MAP_TYPES.includes(world.mapType || 'overworld')) return;
  spawnPointMarker = buildSpawnPointMarker();
  spawnPointMarker.position.set(world.spawnPoint.x, world.spawnPoint.y || 0, world.spawnPoint.z);
  // The beacon's arrow points along +Z at rotation 0, matching the character
  // model's forward axis — so the marker's yaw IS the player's spawn facing.
  spawnPointMarker.rotation.y = ((world.spawnPoint.facingDeg || 0) * Math.PI) / 180;
  scene.add(spawnPointMarker);
}

/** Build the editor placeholder for an NPC from its body + appearance — rebuildAll()'s trailing toonify(scene) call picks this up like everything else, so it matches what players actually see. Uses the same buildPlayerCharacter the live game renders NPCs with. */
function buildNpcMesh(npc) {
  const mesh = buildPlayerCharacter(characterTypeCatalog, npc.appearance?.classId, npc.appearance || {});
  // `position.y` is an offset above the ground, same convention props use —
  // an NPC placed on a hillside otherwise sank into it, since the raw value
  // is 0 for every NPC the placement tool has ever created.
  const terrainY = world ? sampleTerrainHeight(world, npc.position.x, npc.position.z) : 0;
  mesh.position.set(npc.position.x, (npc.position.y || 0) + terrainY, npc.position.z);
  mesh.rotation.y = ((npc.facingDeg || 0) * Math.PI) / 180;
  return mesh;
}

/**
 * A small floating marker so an Event Object is selectable/visible in the
 * editor — purely an authoring aid, never sent to the live game (the game
 * only ever reads world.events' data, not this mesh). Gold for a standalone
 * trigger, cyan when attached to an existing NPC (so it's obviously "riding
 * along" with that NPC rather than its own independent point).
 */
/**
 * The event's marker gizmo: the diamond that's always been the click target,
 * plus a wireframe box showing its authored trigger volume (`ev.range`) so a
 * range can be sized by eye instead of by guessing at numbers. The box is a
 * child of the same group, positioned relative to the event's GROUND point —
 * the diamond floats 1.2m up for visibility, the volume does not — and it is
 * hidden outside Events mode along with the rest of the authoring gizmos.
 *
 * An event with no `range` shows the default sphere's footprint instead, so
 * "how close do I have to be" is answerable either way.
 */
function buildEventMarkerMesh(ev) {
  const group = new THREE.Group();
  const color = ev.attachedType ? 0x4dd0e1 : 0xffca28;
  const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color, wireframe: true }));
  mesh.position.y = 1.2;
  group.add(mesh);

  const rangeMat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.35, depthTest: false });
  let rangeMesh;
  if (ev.range) {
    rangeMesh = new THREE.Mesh(new THREE.BoxGeometry(ev.range.width, ev.range.height, ev.range.length), rangeMat);
    rangeMesh.position.y = ev.range.height / 2; // the box stands ON the ground, matching isPointInEventRange
  } else {
    const r = DEFAULT_EVENT_INTERACT_RANGE;
    rangeMesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.05, 32, 1, true), rangeMat);
    rangeMesh.position.y = 0.03;
  }
  rangeMesh.renderOrder = 998;
  rangeMesh.name = 'event-range';
  // Not a click target: it's metres wide, so leaving it pickable would mean
  // every click on the ground anywhere near an event selected that event
  // instead of doing what the current tool is for. The diamond stays the
  // handle; the box is purely a readout.
  rangeMesh.raycast = () => {};
  group.add(rangeMesh);

  group.position.set(ev.position.x, ev.position.y || 0, ev.position.z);
  group.userData.rangeMesh = rangeMesh;
  group.visible = true;
  rangeMesh.visible = mode === 'events';
  return group;
}

// --- Raycasting helpers ---
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointer(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

function raycastGround() {
  if (!groundMesh) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(groundMesh, false);
  return hits.length > 0 ? hits[0].point : null;
}

function raycastPlacedItems() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedItems.map((i) => i.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedItems.some((i) => i.mesh === obj)) obj = obj.parent;
  return placedItems.find((i) => i.mesh === obj) || null;
}

function snap(value) {
  if (!gridSnapEl.checked) return value;
  const size = parseFloat(snapSizeEl.value) || 1;
  return Math.round(value / size) * size;
}

/** Folds any degree value into [0, 360) so authored facings read consistently in the panel (atan2 hands back negatives, and a user is free to type -90 or 450). */
function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

// --- Mode switching ---
// The bottom icon-toolbar is the primary mode switcher (numbered 1-7,
// matching its on-screen hotkey badges); a plain keydown listener drives the
// same setMode() function so number keys work identically to clicking.
let mode = 'place';
// What the camera is currently framed for — 'overworld' | 'object-builder' |
// 'tower-floor'. Switching between overworld-viewing modes (Place, Water,
// Zones, NPCs, ...) shouldn't reset the camera; only a genuine space change
// (into/out of the Object Builder's isolated workspace, or into/out of a
// tower floor's tiny bounds) should reframe it.
let cameraSpace = 'overworld';
const modeButtons = document.querySelectorAll('.toolbar-btn');
const MODE_KEYS = { 1: 'place', 2: 'scatter', 3: 'terrain', 4: 'water', 5: 'zones', 6: 'buildings', 7: 'monsters', 8: 'items', 9: 'npcs', 0: 'quests', p: 'path', m: 'mountains', g: 'groundtex', b: 'object-builder', l: 'maps', t: 'teleporters', e: 'events', r: 'recipes', v: 'particles', i: 'lights' };

// --- Events mode: unapplied-field guard ---
// The Events panel is the one authoring surface where typing in the fields
// changes NOTHING until you press "Apply fields above to selected" — every
// other mode writes through to the world as you edit. So the map-level
// "unsaved changes" flag can't catch it: the form is dirty while the map
// still looks clean. This is a second, narrower version of the same idea,
// raised whenever anything inside the event's controls is touched and
// lowered by Apply (or by agreeing to throw the edits away).
let eventFormDirty = false;

function markEventFormDirty() {
  if (selectedEvent) eventFormDirty = true;
}

/**
 * Gate for anything that closes/replaces the event currently being edited —
 * selecting another event, deselecting, leaving Events mode, closing the tab.
 * Returns false if the author wants to go back and press Apply.
 */
function confirmDiscardEventForm() {
  if (!eventFormDirty) return true;
  const ok = confirm(
    'This event has changes you haven\'t applied yet.\n\n'
    + 'Click "Apply fields above to selected" first to keep them.\n\n'
    + 'Discard them and continue?'
  );
  if (ok) eventFormDirty = false;
  return ok;
}

document.getElementById('event-selected-controls').addEventListener('input', markEventFormDirty);
document.getElementById('event-selected-controls').addEventListener('change', markEventFormDirty);

function setMode(newMode) {
  // Leaving Events mode closes the event you're editing, so it's one of the
  // ways typed-but-unapplied field edits get thrown away — see
  // confirmDiscardEventForm.
  if (mode === 'events' && newMode !== 'events' && !confirmDiscardEventForm()) return;
  mode = newMode;
  modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  document.querySelectorAll('.mode-panel').forEach((p) => (p.style.display = 'none'));
  document.getElementById(`mode-${mode}`).style.display = 'block';
  armedPlaceType = null;
  armedCustomObjectId = null;
  armedModelId = null;
  armedBuilding = false;
  armedMonsterPlacement = false;
  armedNpcPlacement = false;
  armedTeleporter = false;
  armedParticlePlacement = false;
  armedParticleMove = false;
  armedLightPlacement = false;
  armedLightMove = false;
  armedEventPlacement = false;
  armedAttachPick = false;
  zoneDraft = null;
  scatterDragging = false;
  monsterScatterDragging = false;
  brushRing.visible = false;
  builderGroup.visible = false;
  pathDraft = null;
  pathPointerDown = false;
  pathCursorPoint = null;
  pathHandleDragging = false;
  selectedPathHandleIndex = null;
  pathsDirty = true; // clears any leftover draft-preview mesh next frame
  mountainDraft = null;
  mountainPointerDown = false;
  mountainsDirty = true; // clears any leftover draft-preview mesh next frame
  freeformZoneDraft = null;
  freeformZonePointerDown = false;
  freeformZoneHandleDragging = false;
  selectedFreeformZoneHandleIndex = null;
  freeformZonesDirty = true; // clears any leftover draft-preview mesh next frame
  armedLakePlacement = false;
  lakeHandleDragging = false;
  selectedLakeHandleIndex = null;
  armedSpawnPoint = false;
  armedSpawnFacing = false;
  riverDraft = null;
  riverPointerDown = false;
  riverHandleDragging = false;
  selectedRiverHandleIndex = null;
  riversDirty = true; // clears any leftover draft-preview mesh next frame
  puddlePointerDown = false;
  lastPuddlePlacePoint = null;
  barrierDraft = null;
  barrierPointerDown = false;
  barrierHandleDragging = false;
  selectedBarrierHandleIndex = null;
  barriersDirty = true; // clears any leftover draft-preview mesh next frame
  setBarrierVisibility(); // invisible walls are only drawn while their own tool is up
  updateLakeHandles(); // hides the outline/handles when leaving Water mode (they're authoring gizmos, like the emitter markers below)

  if (mode === 'monsters') {
    applyMonstersModeVisibility();
  } else if (mode === 'object-builder') {
    floorGroup.visible = false;
    setOverworldVisible(false);
    builderGroup.visible = true;
    frameCameraOnBounds(BUILDER_BOUNDS);
    cameraSpace = 'object-builder';
  } else {
    floorGroup.visible = false;
    setOverworldVisible(true);
    if (cameraSpace !== 'overworld') restoreOverworldCamera(); // only reframe when actually returning from a different space
    cameraSpace = 'overworld';
  }
  if (mode === 'quests') populateQuestDropdowns(); // refresh NPC/item pickers from current world
  if (mode === 'maps') renderMapsList(); // refresh in case another mode's edits (e.g. a new building) changed anything relevant
  if (mode === 'teleporters') { refreshTeleporterList(); refreshCrossMapTeleporterOptions(); }
  // Emitter markers are authoring gizmos, not world content — visible only in
  // Particles mode, so they don't clutter every other view. The effects
  // themselves keep running regardless, which is the point: a campfire placed
  // here should still be burning while you lay out the buildings around it.
  for (const e of placedEmitters) e.mesh.visible = mode === 'particles';
  if (mode === 'particles') refreshEmitterList();
  // Light gizmos follow the same rule as emitter markers: the bulb, its
  // radius sphere and a spot's cone are authoring readouts, shown only in
  // Lights mode. The lights themselves keep shining in every mode — which is
  // the point, since you place the props a torch is lighting from Place mode.
  for (const e of placedLights) e.mesh.visible = mode === 'lights';
  if (mode === 'lights') refreshLightList();
  // Same reasoning for an event's trigger-volume box: an authoring readout,
  // not world content. Its parent group stays visible (the diamond is how you
  // find an event from any mode) — only the volume is scoped to Events mode.
  for (const e of placedEvents) {
    if (e.mesh.userData.rangeMesh) e.mesh.userData.rangeMesh.visible = mode === 'events';
  }
  if (mode === 'events') refreshEventList(); // refresh in case NPCs/zones changed (attach/zoneId dropdowns)
  if (mode === 'recipes' && !editingRecipeId) populateRecipeDropdowns(); // refresh item/station pickers; skip while editing so an in-progress edit's selections aren't wiped
  // Monsters mode's loot-table picker is the one item-driven list with no
  // refresh of its own; without this a freshly-authored item was invisible
  // there until a page reload.
  if (mode === 'monsters') refreshMonLootItemOptions();
}

/**
 * Monsters mode shows one of two totally different spaces depending on the
 * floor-select dropdown: a tower floor (its own bounded room, like every
 * other Monsters-mode view before overworld monsters existed) or the
 * overworld itself (monsters are no longer tower-exclusive). Called both on
 * entering Monsters mode and whenever the dropdown selection changes while
 * already in it.
 */
function applyMonstersModeVisibility() {
  if (mode !== 'monsters') return;
  const viewingFloor = currentFloorNumber !== 'overworld';
  floorGroup.visible = viewingFloor;
  setOverworldVisible(!viewingFloor);
  if (viewingFloor && currentFloorDef) {
    frameCameraOnBounds(currentFloorDef.bounds); // always reframe: each floor has different bounds
    cameraSpace = 'tower-floor';
  } else if (!viewingFloor) {
    if (cameraSpace !== 'overworld') restoreOverworldCamera();
    cameraSpace = 'overworld';
  }
}

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

/**
 * True while focus is on anything text-editable — INPUT, SELECT, TEXTAREA,
 * or a contenteditable element. Every keydown listener in this file that
 * fires on plain keys (mode hotkeys, Delete, Paths mode's Enter/Escape) must
 * check this first, or typing normal text (e.g. "9 guards patrol" in the NPC
 * dialog textarea, which IS one of these but was never checked) gets
 * silently intercepted as a shortcut instead of reaching the field.
 */
function isTypingInFormField() {
  const el = document.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  // Bare letters only. Without this, Ctrl+V (paste) also fired MODE_KEYS' 'v'
  // and threw you into Particles mode mid-paste — same for any future
  // shortcut whose letter collides with a mode key.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = MODE_KEYS[e.key];
  if (target) setMode(target);
});

// Catalogs the Place/Scatter palette's `extraItems` reads — declared here
// (rather than down near where they're fetched/uploaded) because the
// palette's first render happens synchronously inside createSceneryPalette()
// below, and a `let`/`const` referenced before its own declaration line
// throws (temporal dead zone) even inside a closure, as soon as that closure
// actually runs. Real population still happens later, on fetch/upload.
let objectCatalog = [];
let objectCatalogById = {};
let modelCatalog = [];
// Weapon models (category: 'weapon') are uploaded through this same /api/models
// catalog, but from the Character & NPC Builder — they're not placeable world
// scenery, so they're filtered out of every editor-facing list here.
const propModels = () => modelCatalog.filter((m) => m.category !== 'weapon');

// --- PLACE MODE: palette ---
let armedPlaceType = null;
let armedCustomObjectId = null; // set alongside armedPlaceType = 'custom' when placing a built object
let armedModelId = null; // set alongside armedPlaceType = 'model' when placing an imported model
document.querySelectorAll('[data-place]').forEach((btn) => {
  btn.addEventListener('click', () => {
    armedPlaceType = btn.dataset.place;
    armedCustomObjectId = null;
    armedModelId = null;
    placePalette?.setSelected(null);
    statusLine.textContent = `Click the ground to place a ${armedPlaceType}`;
  });
});

// The scenery palette drives both Place and Scatter. It is generated from the
// catalog (src/sim/propTypes.js), so a new prop type appears in both without
// touching this file. Object Builder objects and uploaded models are injected
// on top, each tagged with the category tab it belongs under.
function paletteExtraItems() {
  return [
    // Locally-built objects have never carried a category and still land under
    // Outdoors Decor; a DROPPED one (src/generators/environment/import/)
    // arrives tagged 'imported' from the server, so shared assets collect in
    // their own tab instead of being mixed in with what you built yourself.
    ...objectCatalog.map((o) => ({ id: o.id, label: o.name, objectDef: o, category: o.category || 'outdoors-decor', kind: 'custom' })),
    // `deletable: false` for a folder-dropped asset (src/generators/environment/
    // import/) — the file on disk is the author's, put there by hand, and the
    // palette has no business offering to delete it. Remeasure still applies:
    // that only rewrites the measurement sidecar.
    ...propModels().map((m) => ({
      id: m.id,
      label: m.name,
      category: m.category || 'misc',
      kind: 'model',
      deletable: m.source !== 'import-folder',
    })),
  ];
}

const placePalette = createSceneryPalette(document.getElementById('place-palette'), {
  selected: 'tree',
  extraItems: paletteExtraItems,
  onDeleteModel: (id) => deleteModel(id),
  onRemeasureModel: (id) => remeasureModel(id),
  onSelect: (paletteId) => {
    if (!paletteId) {
      // Clicking the already-armed cell again unarms it (see sceneryPalette.js).
      armedPlaceType = null;
      armedCustomObjectId = null;
      armedModelId = null;
      statusLine.textContent = 'Placement cancelled.';
      return;
    }
    const { type, objectId, modelId } = parsePaletteType(paletteId);
    armedPlaceType = type;
    armedCustomObjectId = objectId;
    armedModelId = modelId;
    statusLine.textContent = `Click the ground to place: ${paletteId}`;
  },
});

// Escape cancels an armed placement before it's used — same per-mode Escape
// convention Paths/Zones mode already use — and, with nothing armed, drops
// the current selection (the way out of a marquee that grabbed too much).
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'place' || e.key !== 'Escape') return;
  if (!armedPlaceType) {
    if (selected) {
      selectItem(null);
      statusLine.textContent = 'Selection cleared.';
    }
    return;
  }
  armedPlaceType = null;
  armedCustomObjectId = null;
  armedModelId = null;
  placePalette.setSelected(null);
  statusLine.textContent = 'Placement cancelled.';
});

// Ctrl+C / Ctrl+V duplicate the current selection at the cursor — the fast
// path for laying out repeated structures (a crop field, a row of fences)
// that would otherwise be placed one prop at a time.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'place' || !(e.ctrlKey || e.metaKey) || e.shiftKey) return;
  const key = e.key.toLowerCase();
  if (key === 'c') {
    e.preventDefault();
    copySelectionToClipboard();
  } else if (key === 'v') {
    e.preventDefault();
    pasteClipboard();
  }
});

const gridSnapEl = document.getElementById('grid-snap');
const snapSizeEl = document.getElementById('snap-size');

function placeAt(type, point) {
  const seed = Math.floor(Math.random() * 1e9);
  const x = snap(point.x);
  const z = snap(point.z);

  if (type === 'wall') {
    const ref = {
      id: `wall-${seed}`,
      seed,
      position: { x, y: 0, z },
      rotationDeg: 0,
      length: 6,
      height: 5,
    };
    world.walls.push(ref);
    const mesh = buildWallSegmentInstance(ref, world);
    toonify(mesh);
    scene.add(mesh);
    placedItems.push({ kind: 'wall', ref, mesh });
  } else {
    const ref = { type, seed, position: { x, y: defaultPlaceY(type), z }, rotationDeg: 0, scale: 1 };
    if (type === 'custom') ref.objectId = armedCustomObjectId;
    if (type === 'model') ref.modelId = armedModelId;
    world.props.push(ref);
    const mesh = buildPropPlaceholder(ref, world, objectCatalogById);
    toonify(mesh);
    scene.add(mesh);
    placedItems.push({ kind: type, ref, mesh });
  }
  refreshLists();
}

// --- SCATTER MODE: brush-based bulk placement ---
let scatterType = 'tree';
let scatterDragging = false;
let scatterCount = 0;
let lastScatterTick = 0;
const SCATTER_TICK_MS = 80; // throttle so a fast drag doesn't dump hundreds of props in one frame

const scatterPalette = createSceneryPalette(document.getElementById('scatter-palette'), {
  selected: 'tree',
  extraItems: paletteExtraItems,
  // Scatter has no "unarmed" concept (it's a continuous brush, not a
  // one-shot placement) — a toggle-off click (paletteId === null) is just
  // ignored, leaving whatever type was armed before still armed.
  onSelect: (paletteId) => { if (paletteId) scatterType = paletteId; },
});

/**
 * A palette cell id is a built-in prop type ('tree-birch'), an authored
 * Object Builder prop ('custom:<objectId>'), or an uploaded model
 * ('model:<modelId>'). Everything downstream stores world.json's real shape:
 * `type: 'custom'` + `objectId`, or `type: 'model'` + `modelId`.
 */
function parsePaletteType(paletteId) {
  if (paletteId.startsWith('custom:')) return { type: 'custom', objectId: paletteId.slice(7), modelId: null };
  if (paletteId.startsWith('model:')) return { type: 'model', objectId: null, modelId: paletteId.slice(6) };
  return { type: paletteId, objectId: null, modelId: null };
}

const scatterRadiusEl = document.getElementById('scatter-radius');
const scatterDensityEl = document.getElementById('scatter-density');
const scatterPatternEl = document.getElementById('scatter-pattern');
const scatterVariationEl = document.getElementById('scatter-variation');
const scatterAngleEl = document.getElementById('scatter-angle');
const scatterAngleVarEl = document.getElementById('scatter-angle-var');
const scatterOverwriteEl = document.getElementById('scatter-overwrite');
const scatterScaleMinEl = document.getElementById('scatter-scale-min');
const scatterScaleMaxEl = document.getElementById('scatter-scale-max');
const scatterSnapEl = document.getElementById('scatter-snap');
const scatterEraseAnyEl = document.getElementById('scatter-erase-any');
const scatterCountEl = document.getElementById('scatter-count');
const treeDensityEl = document.getElementById('tree-density');
const treeDensityOutEl = document.getElementById('tree-density-out');

// Live numeric readouts, so the brush sliders say what they're set to.
for (const [input, out] of [
  [scatterRadiusEl, 'scatter-radius-out'],
  [scatterDensityEl, 'scatter-density-out'],
  [scatterVariationEl, 'scatter-variation-out'],
  [scatterAngleEl, 'scatter-angle-out'],
  [scatterAngleVarEl, 'scatter-angle-var-out'],
  [scatterScaleMinEl, 'scatter-scale-min-out'],
  [scatterScaleMaxEl, 'scatter-scale-max-out'],
  [treeDensityEl, 'tree-density-out'],
]) {
  const el = document.getElementById(out);
  const sync = () => { el.textContent = input.value; };
  input.addEventListener('input', sync);
  sync();
}

// World-wide, not per-instance — affects every already-placed round tree,
// not just future ones (see ezTree.js's leafDensity param). Rebuilding
// every prop in the world on every drag frame would hitch badly with
// hundreds of props, so the label follows 'input' (the loop above) but the
// actual rebuild only fires on 'change' (slider release) — same pattern
// Mountains mode uses for width/peak height.
treeDensityEl.addEventListener('change', () => {
  world.treeSettings.leafDensity = parseFloat(treeDensityEl.value) || 1.5;
  rebuildAll();
});

function scatterSnapValue(value) {
  if (!scatterSnapEl.checked) return value;
  const size = parseFloat(snapSizeEl.value) || 1;
  return Math.round(value / size) * size;
}

/**
 * Where the brush drops its instances this tick, in local (dx, dz) offsets.
 *
 *  scatter — uniform random over the disc. sqrt() on the radius, or everything
 *            piles up in the middle.
 *  hexagon — a hex lattice, jittered by `variation`. Even coverage, which is
 *            what you want for a field of crops or a deliberate orchard.
 *  grid    — a square lattice, same jitter.
 *
 * `variation` (0..1) is how far a lattice point may wander from its cell; at 1
 * a lattice is indistinguishable from scatter, which is the point of the knob.
 */
function brushOffsets(pattern, radius, density, variation) {
  const out = [];
  if (pattern === 'scatter') {
    for (let i = 0; i < density; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * radius;
      out.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    return out;
  }

  // Lattice spacing chosen so `density` points land inside the disc.
  const spacing = Math.max(0.6, radius / Math.sqrt(Math.max(1, density)) * 1.4);
  const rows = Math.ceil((radius * 2) / spacing);
  const jitter = spacing * 0.5 * variation;
  for (let r = -rows; r <= rows; r++) {
    for (let c = -rows; c <= rows; c++) {
      // A hex lattice is a square one with every other row shifted half a cell.
      const offsetX = pattern === 'hexagon' && (r & 1) ? spacing * 0.5 : 0;
      const dx = c * spacing + offsetX + (Math.random() * 2 - 1) * jitter;
      const dz = r * spacing * (pattern === 'hexagon' ? 0.866 : 1) + (Math.random() * 2 - 1) * jitter;
      if (Math.hypot(dx, dz) <= radius) out.push([dx, dz]);
    }
  }
  // Honour density as a cap so a big radius doesn't dump hundreds per tick.
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, density);
}

/** Remove every placed prop whose mesh centre lies within `radius` of `point`. */
function clearPropsUnderBrush(point, radius, onlyType = null) {
  const toRemove = placedItems.filter(
    (item) =>
      (!onlyType || item.kind === onlyType) &&
      Math.hypot(item.mesh.position.x - point.x, item.mesh.position.z - point.z) <= radius
  );
  for (const item of toRemove) {
    scene.remove(item.mesh);
    world.props = world.props.filter((p) => p !== item.ref);
    world.walls = world.walls.filter((w) => w !== item.ref);
    placedItems.splice(placedItems.indexOf(item), 1);
  }
  return toRemove.length;
}

/** One scatter-brush tick: place (or, if erasing, remove) several instances within the brush radius around `point`. */
function scatterTick(point, erase) {
  const radius = parseFloat(scatterRadiusEl.value);
  const density = parseInt(scatterDensityEl.value, 10);

  if (erase) {
    const removed = clearPropsUnderBrush(point, radius, scatterEraseAnyEl.checked ? null : scatterType);
    if (removed) listsDirty = true;
    return;
  }

  // Overwrite: the brush owns the ground it covers. Without this, painting a
  // second pass over a field just doubles the props already standing there.
  if (scatterOverwriteEl.checked) clearPropsUnderBrush(point, radius, null);

  const scaleMin = Math.min(parseFloat(scatterScaleMinEl.value), parseFloat(scatterScaleMaxEl.value));
  const scaleMax = Math.max(parseFloat(scatterScaleMinEl.value), parseFloat(scatterScaleMaxEl.value));
  const baseAngle = parseFloat(scatterAngleEl.value);
  const angleVar = parseFloat(scatterAngleVarEl.value);
  const variation = parseFloat(scatterVariationEl.value) / 100;
  const pattern = scatterPatternEl.value;

  const { type, objectId, modelId } = parsePaletteType(scatterType);

  for (const [dx, dz] of brushOffsets(pattern, radius, density, variation)) {
    const x = scatterSnapValue(point.x + dx);
    const z = scatterSnapValue(point.z + dz);
    const seed = Math.floor(Math.random() * 1e9);
    const ref = {
      type,
      seed,
      position: { x, y: defaultPlaceY(type), z },
      rotationDeg: Math.round(baseAngle + (Math.random() - 0.5) * angleVar) % 360,
      scale: scaleMin + Math.random() * (scaleMax - scaleMin),
    };
    if (objectId) ref.objectId = objectId;
    if (modelId) ref.modelId = modelId;
    world.props.push(ref);
    const mesh = buildPropPlaceholder(ref, world, objectCatalogById);
    toonify(mesh);
    scene.add(mesh);
    // kind stays the raw palette id (not the resolved `type`) so
    // clearPropsUnderBrush's erase-by-type stays scoped to this exact
    // custom object/model, not every custom object or every model.
    placedItems.push({ kind: scatterType, ref, mesh });
    scatterCount++;
  }
  scatterCountEl.textContent = scatterCount;
  listsDirty = true;
}

// --- Selection controls ---
const selectedInfo = document.getElementById('selected-info');
const selectedControls = document.getElementById('selected-controls');
const selRotXZRow = document.getElementById('sel-rotation-xz-row');
const selRotYOnlyRow = document.getElementById('sel-rotation-y-only-row');
const selRotX = document.getElementById('sel-rot-x');
const selRotY = document.getElementById('sel-rot-y');
const selRotZ = document.getElementById('sel-rot-z');
const selRotYOnly = document.getElementById('sel-rot-y-only');
const selScaleHeightRow = document.getElementById('sel-scale-height-row');
const selScalePct = document.getElementById('sel-scale-pct');
const selHeight = document.getElementById('sel-height');
const selColor = document.getElementById('sel-color');
const selColorRow = document.getElementById('sel-color-row');
const selWallInvisibleRow = document.getElementById('sel-wall-invisible-row');
const selWallInvisible = document.getElementById('sel-wall-invisible');
const selTreeDensityRow = document.getElementById('sel-tree-density-row');
const selTreeDensity = document.getElementById('sel-tree-density');
const selTreeDensityOut = document.getElementById('sel-tree-density-out');
const deleteSelectedBtn = document.getElementById('delete-selected');
deleteSelectedBtn.addEventListener('click', deleteSelected);

// 'tree'/'tree-oak'/'tree-birch' are the round-canopy ez-tree types (see
// props.js) — 'tree-pine' and everything else in flora.js/stones.js don't
// have a leafDensity concept at all. 'tree' itself can randomly resolve to
// a conifer under its own seed (see sampleTree's random type pick), in
// which case this slider is shown but has no visible effect — not worth
// re-deriving the resolved type just to hide it for that one edge case.
const ROUND_TREE_TYPES = new Set(['tree', 'tree-oak', 'tree-birch']);

function hexToColorString(hex) {
  return '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);
}

/**
 * @param item the new primary selection, or null to deselect everything.
 * @param {{keepMulti?: boolean}} [opts] keepMulti keeps the existing
 *   multi-selection and just re-points the primary at `item` (used by
 *   Alt+click and by group drags); the default replaces the whole selection
 *   with just this one item, which is what a plain click means.
 */
function selectItem(item, opts = {}) {
  selected = item;
  if (!opts.keepMulti) {
    multiSelected.clear();
    if (item) multiSelected.add(item);
  }
  if (!item) {
    multiSelected.clear();
    selectedInfo.textContent = 'Nothing selected. Click a placed object, or Alt+drag to box-select several.';
    selectedControls.style.display = 'none';
    selectionHighlight.visible = false;
    refreshMultiHighlights();
    return;
  }
  updateSelectionInfo();
  refreshMultiHighlights();
  selectedControls.style.display = 'block';
  // Walls only ever rotate around Y (structurally a straight segment) and
  // don't carry scale/height fields at all — same distinction the invisible
  // toggle just below already makes.
  const isWall = item.kind === 'wall';
  // Rotation and colour have no effect on a dense grass/flower patch (see
  // isCoverProp) — hidden rather than left sitting there doing nothing.
  const isCover = isCoverProp(item);
  selRotXZRow.style.display = isWall || isCover ? 'none' : 'block';
  selRotYOnlyRow.style.display = isWall ? 'block' : 'none';
  if (isWall) {
    selRotYOnly.value = item.ref.rotationDeg || 0;
  } else {
    const rot = item.ref.rotation;
    selRotX.value = rot?.x ?? 0;
    selRotY.value = rot?.y ?? item.ref.rotationDeg ?? 0;
    selRotZ.value = rot?.z ?? 0;
  }
  selScaleHeightRow.style.display = isWall ? 'none' : 'block';
  if (!isWall) {
    selScalePct.value = Math.round((item.ref.scale ?? 1) * 100);
    selHeight.value = item.ref.position?.y ?? 0;
  }
  selColorRow.style.display = isCover ? 'none' : 'block';
  selColor.value = item.ref.color !== undefined ? hexToColorString(item.ref.color) : '#ffffff';
  selWallInvisibleRow.style.display = isWall ? 'flex' : 'none';
  selWallInvisible.checked = !!item.ref.invisible;
  const isRoundTree = ROUND_TREE_TYPES.has(item.kind);
  selTreeDensityRow.style.display = isRoundTree ? 'block' : 'none';
  if (isRoundTree) {
    const effective = item.ref.leafDensity ?? world.treeSettings?.leafDensity ?? 1.5;
    selTreeDensity.value = effective;
    selTreeDensityOut.textContent = effective;
  }
  selectionHighlight.visible = true;
  selectionHighlight.setFromObject(item.mesh);
}

/**
 * Regenerates one placed item's mesh in place — for field changes (like
 * leafDensity, or a wall's invisible toggle) that change GEOMETRY, not just a
 * transform/material tweak.
 */
function rebuildItemMesh(item) {
  scene.remove(item.mesh);
  const mesh = item.kind === 'wall'
    ? buildWallSegmentInstance(item.ref, world)
    : buildPropPlaceholder(item.ref, world, objectCatalogById);
  toonify(mesh);
  scene.add(mesh);
  item.mesh = mesh;
  if (item === selected) selectionHighlight.setFromObject(mesh);
}

/** Rebuilds a list of items and re-fits the secondary highlight boxes around their new meshes. */
function rebuildItemMeshes(items) {
  for (const item of items) rebuildItemMesh(item);
  refreshMultiHighlights();
}

selTreeDensity.addEventListener('input', () => {
  selTreeDensityOut.textContent = selTreeDensity.value;
});
// Rebuild only on release, not every drag frame — regenerating a full
// branch+leaf tree is far heavier than the transform-only updates
// rotation/scale get.
selTreeDensity.addEventListener('change', () => {
  const trees = selectedItems().filter((it) => ROUND_TREE_TYPES.has(it.kind));
  if (!trees.length) return;
  const density = parseFloat(selTreeDensity.value) || 1.5;
  for (const tree of trees) tree.ref.leafDensity = density;
  rebuildItemMeshes(trees);
});
document.getElementById('sel-tree-density-reset').addEventListener('click', () => {
  const trees = selectedItems().filter((it) => ROUND_TREE_TYPES.has(it.kind));
  if (!trees.length) return;
  for (const tree of trees) delete tree.ref.leafDensity;
  const worldDefault = world.treeSettings?.leafDensity ?? 1.5;
  selTreeDensity.value = worldDefault;
  selTreeDensityOut.textContent = worldDefault;
  rebuildItemMeshes(trees);
});

selWallInvisible.addEventListener('change', () => {
  const walls = selectedItems().filter((it) => it.kind === 'wall');
  if (!walls.length) return;
  for (const wall of walls) wall.ref.invisible = selWallInvisible.checked;
  // Solid <-> wireframe is a different geometry/material, not a field tweak
  // on the existing mesh, so rebuild it in place.
  rebuildItemMeshes(walls);
});

selRotYOnly.addEventListener('input', () => {
  const deg = parseFloat(selRotYOnly.value) || 0;
  for (const item of selectedItems()) {
    if (item.kind !== 'wall') continue;
    item.ref.rotationDeg = deg;
    item.mesh.rotation.y = (deg * Math.PI) / 180;
  }
  refreshMultiHighlights();
});

/**
 * The dense grass/flower presets don't render as a transformable object —
 * they're one prop's slice of the same instanced cover the live game batches
 * (see COVER_PROP_TYPES in render/scene.js), with prop.scale folded into the
 * scatter itself and rotation ignored outright, exactly as the game does it.
 * So their panel edits regenerate the mesh instead of nudging a transform on
 * it: rotating or scaling the object here would show something the game will
 * never draw, which is the whole class of bug this pass is closing.
 */
function isCoverProp(item) {
  return !!item && COVER_PROP_TYPES.has(item.ref?.type);
}

// Every field below writes to the WHOLE selection, not just the primary — a
// selection of one (a plain click) behaves exactly as it always did, and a
// multi-selection is the point of the feature: retinting or re-scaling a
// whole crop field one prop at a time is what it exists to avoid. Each
// handler still filters by kind, so a mixed selection only touches the items
// the field actually applies to.
function applySelectedRotation() {
  const x = parseFloat(selRotX.value) || 0;
  const y = parseFloat(selRotY.value) || 0;
  const z = parseFloat(selRotZ.value) || 0;
  for (const item of selectedItems()) {
    if (item.kind === 'wall') continue;
    item.ref.rotation = { x, y, z };
    delete item.ref.rotationDeg; // migrated to the 3-axis rotation object — same idiom src/render/scene.js's buildPropPlaceholder falls back on for older worlds
    if (isCoverProp(item)) continue; // no visible effect, in the editor or the game
    item.mesh.rotation.set((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180);
  }
  refreshMultiHighlights();
}
selRotX.addEventListener('input', applySelectedRotation);
selRotY.addEventListener('input', applySelectedRotation);
selRotZ.addEventListener('input', applySelectedRotation);

selScalePct.addEventListener('input', () => {
  const pct = parseFloat(selScalePct.value);
  if (!Number.isFinite(pct) || pct <= 0) return;
  const rebuilds = [];
  for (const item of selectedItems()) {
    if (item.kind === 'wall') continue; // walls don't carry a scale field
    item.ref.scale = pct / 100;
    if (isCoverProp(item)) rebuilds.push(item); // scale changes the scatter, not the object's transform
    else item.mesh.scale.setScalar(item.ref.scale);
  }
  if (rebuilds.length) rebuildItemMeshes(rebuilds);
  else refreshMultiHighlights();
});
selHeight.addEventListener('input', () => {
  const y = parseFloat(selHeight.value) || 0;
  for (const item of selectedItems()) {
    if (item.kind === 'wall') continue; // walls always sit at ground level
    item.ref.position.y = y;
    const terrainY = sampleTerrainHeight(world, item.ref.position.x, item.ref.position.z);
    item.mesh.position.y = y + terrainY;
  }
  refreshMultiHighlights();
});

function applySelectedColor(hexString) {
  const hex = parseInt(hexString.slice(1), 16);
  for (const item of selectedItems()) {
    if (item.kind === 'wall') continue; // walls use a flat stone material, not worth tinting
    // Cover props share ONE material across every patch on the map (that's
    // what keeps them to a couple of shader compiles and one wind clock), so
    // tinting this one would repaint the entire field — and the live game's
    // batched path ignores prop.color for them regardless.
    if (isCoverProp(item)) continue;
    if (hex === 0xffffff) delete item.ref.color;
    else item.ref.color = hex;
    applyColorTint(item.mesh, hex);
  }
}
selColor.addEventListener('input', () => applySelectedColor(selColor.value));
document.getElementById('reset-color').addEventListener('click', () => {
  selColor.value = '#ffffff';
  applySelectedColor('#ffffff');
});

function deleteSelected() {
  const doomed = selectedItems();
  if (!doomed.length) return;
  // One filter pass over world.props/world.walls for the whole selection —
  // a per-item `filter` would be O(n²) over a several-thousand-prop map, and
  // deleting a marquee'd crop field is exactly the case that hits it.
  const doomedRefs = new Set(doomed.map((it) => it.ref));
  for (const item of doomed) scene.remove(item.mesh);
  if (doomed.some((it) => it.kind === 'wall')) world.walls = world.walls.filter((w) => !doomedRefs.has(w));
  if (doomed.some((it) => it.kind !== 'wall')) world.props = world.props.filter((p) => !doomedRefs.has(p));
  for (let i = placedItems.length - 1; i >= 0; i--) {
    if (doomedRefs.has(placedItems[i].ref)) placedItems.splice(i, 1);
  }
  selectItem(null);
  refreshLists();
}

window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (e.code === 'Delete' || e.code === 'Backspace') {
    if (selected) deleteSelected();
  }
});

/**
 * Bilinear-resamples a flat (oldRes+1)^2 grid to a (newRes+1)^2 grid — used
 * to upgrade an existing world's terrain/water resolution in place (see
 * DEFAULT_TERRAIN_WATER_RESOLUTION) without discarding whatever shape was
 * already painted there.
 */
function resampleGrid(values, oldRes, newRes) {
  if (oldRes === newRes) return values;
  const oldSize = oldRes + 1;
  const newSize = newRes + 1;
  const out = new Array(newSize * newSize);
  for (let gz = 0; gz < newSize; gz++) {
    const fz = (gz / newRes) * oldRes;
    const z0 = Math.min(oldRes, Math.floor(fz));
    const z1 = Math.min(oldRes, z0 + 1);
    const tz = fz - z0;
    for (let gx = 0; gx < newSize; gx++) {
      const fx = (gx / newRes) * oldRes;
      const x0 = Math.min(oldRes, Math.floor(fx));
      const x1 = Math.min(oldRes, x0 + 1);
      const tx = fx - x0;
      const v00 = values[z0 * oldSize + x0];
      const v10 = values[z0 * oldSize + x1];
      const v01 = values[z1 * oldSize + x0];
      const v11 = values[z1 * oldSize + x1];
      const top = v00 + (v10 - v00) * tx;
      const bot = v01 + (v11 - v01) * tx;
      out[gz * newSize + gx] = top + (bot - top) * tz;
    }
  }
  return out;
}

// --- TERRAIN MODE ---
const brushRadiusEl = document.getElementById('brush-radius');
const brushStrengthEl = document.getElementById('brush-strength');
const flattenModeEl = document.getElementById('flatten-mode');
document.getElementById('reset-terrain').addEventListener('click', () => {
  if (!world.terrain) return;
  world.terrain.heights.fill(0);
  terrainDirty = true;
});

function ensureTerrain(resolution = DEFAULT_TERRAIN_WATER_RESOLUTION) {
  if (!world.terrain) {
    world.terrain = { resolution, heights: new Array((resolution + 1) * (resolution + 1)).fill(0) };
  }
  return world.terrain;
}

/** "Flatten All Terrain"'s button, scoped to just the brush footprint — blends heights within `radius` toward 0 by `strength` per stroke tick rather than snapping instantly, so a drag gives graded control the same way the raise/lower brush does. */
function flattenTerrain(point) {
  const terrain = ensureTerrain();
  const { resolution, heights } = terrain;
  const { bounds } = world;
  const radius = parseFloat(brushRadiusEl.value);
  const strength = parseFloat(brushStrengthEl.value);

  for (let gz = 0; gz <= resolution; gz++) {
    for (let gx = 0; gx <= resolution; gx++) {
      const wx = bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
      const wz = bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
      const dist = Math.hypot(wx - point.x, wz - point.z);
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const idx = gz * (resolution + 1) + gx;
      heights[idx] += (0 - heights[idx]) * strength * falloff;
    }
  }
  terrainDirty = true;
}

function paintTerrain(point, lower) {
  if (flattenModeEl.checked) {
    flattenTerrain(point);
    return;
  }
  const terrain = ensureTerrain();
  const { resolution, heights } = terrain;
  const { bounds } = world;
  const radius = parseFloat(brushRadiusEl.value);
  const mountainMode = document.getElementById('mountain-preset').checked;
  const baseStrength = parseFloat(brushStrengthEl.value) * (lower ? -1 : 1);
  // Mountains need much taller, steeper, jaggeder results than the gentle
  // hill brush gives by default — a bigger multiplier, a peaked (rather
  // than linear/conical) falloff curve, and a small deterministic jitter
  // per vertex so the result doesn't look like a smooth dome.
  const strength = mountainMode ? baseStrength * 5 : baseStrength;

  // Bound the scan to the brush's own footprint instead of the whole grid — at the
  // 256x256 resolution (bumped 2026-07-17), every mousemove during a drag was
  // otherwise re-visiting all ~66k cells just to `continue` past the ones outside
  // `radius`, with no throttle like the scatter brush has. Same falloff math for
  // every cell that would have passed the old `dist > radius` check; cells outside
  // this box would have failed that check anyway.
  const cellSizeX = (bounds.maxX - bounds.minX) / resolution;
  const cellSizeZ = (bounds.maxZ - bounds.minZ) / resolution;
  const gxCenter = ((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * resolution;
  const gzCenter = ((point.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * resolution;
  const gxSpan = Math.ceil(radius / cellSizeX) + 1;
  const gzSpan = Math.ceil(radius / cellSizeZ) + 1;
  const gxMin = Math.max(0, Math.floor(gxCenter - gxSpan));
  const gxMax = Math.min(resolution, Math.ceil(gxCenter + gxSpan));
  const gzMin = Math.max(0, Math.floor(gzCenter - gzSpan));
  const gzMax = Math.min(resolution, Math.ceil(gzCenter + gzSpan));

  for (let gz = gzMin; gz <= gzMax; gz++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const wx = bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
      const wz = bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
      const dist = Math.hypot(wx - point.x, wz - point.z);
      if (dist > radius) continue;
      let falloff = 1 - dist / radius;
      if (mountainMode) {
        falloff = Math.pow(falloff, 2.2);
        const jitter = 1 + Math.sin(gx * 12.9898 + gz * 78.233) * 0.15;
        heights[gz * (resolution + 1) + gx] += strength * falloff * jitter;
      } else {
        heights[gz * (resolution + 1) + gx] += strength * falloff;
      }
    }
  }
  terrainDirty = true;
}

// --- WATER MODE ---
const waterRadiusEl = document.getElementById('water-radius');
const waterSoftnessEl = document.getElementById('water-softness');
const waterLevelEl = document.getElementById('water-level');
let armedWaterErase = false; // "Remove One Lake" button arms this; next click flood-fills and clears one connected body

function ensureWaterMask(resolution = DEFAULT_TERRAIN_WATER_RESOLUTION) {
  if (!world.waterMask) {
    world.waterMask = {
      resolution,
      level: parseFloat(waterLevelEl.value) || 0.1,
      cells: new Array((resolution + 1) * (resolution + 1)).fill(0),
    };
  }
  return world.waterMask;
}

// How far below the water's own level a fully-painted cell's terrain gets
// pulled down — the "make Water Level mean something" fix: painting water
// (and changing its level) reshapes the terrain UNDER it into an actual
// basin, instead of only moving a flat plane that floats over whatever
// height already happened to be there. Softly graded by the mask's own
// alpha (`cells[idx]`), so the shoreline slopes down instead of dropping off
// a sheer cliff at the brush's edge. Only ever LOWERS terrain — erasing
// water does not raise it back (no reliable "original height" to restore
// to); use the Terrain tab's new "Flatten (brush area only)" tool to fix a
// basin up by hand afterward.
const WATER_BASIN_DEPTH = 2.5;

/** Lowers terrain.heights at each given grid index to at most (level - depth*alpha), never raising it. `indices` and the water mask must share a resolution — true by construction, see DEFAULT_TERRAIN_WATER_RESOLUTION. */
function carveWaterBasin(indices) {
  const terrain = ensureTerrain();
  const mask = world.waterMask;
  for (const idx of indices) {
    const target = mask.level - WATER_BASIN_DEPTH * mask.cells[idx];
    if (terrain.heights[idx] > target) terrain.heights[idx] = target;
  }
  terrainDirty = true;
}

function paintWater(point, erase) {
  const mask = ensureWaterMask();
  const { resolution, cells } = mask;
  const { bounds } = world;
  const radius = parseFloat(waterRadiusEl.value);
  const softness = parseFloat(waterSoftnessEl.value);
  const touched = [];

  for (let gz = 0; gz <= resolution; gz++) {
    for (let gx = 0; gx <= resolution; gx++) {
      const wx = bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
      const wz = bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
      const dist = Math.hypot(wx - point.x, wz - point.z);
      if (dist > radius) continue;
      // softness controls how much of the brush is a soft edge vs. a solid
      // core: at softness=1 the falloff starts from the very center, at low
      // softness most of the brush is fully painted with only a thin
      // feathered rim.
      const falloff = Math.min(1, (1 - dist / radius) / Math.max(0.05, softness));
      const idx = gz * (resolution + 1) + gx;
      if (erase) {
        cells[idx] = Math.max(0, cells[idx] - falloff);
      } else {
        cells[idx] = Math.min(1, cells[idx] + falloff);
        touched.push(idx);
      }
    }
  }
  waterDirty = true;
  if (touched.length) carveWaterBasin(touched);
}

// WATER_PAINTED_THRESHOLD: anything above this counts as "there's water
// here" for flood-fill purposes — matches the near-zero cleared value
// paintWater's erase path already converges to (Math.max(0, ...)).
const WATER_PAINTED_THRESHOLD = 0.02;

/** Flood-fills the connected painted region touching `point` (4-connected over the mask grid) and clears just that one body, leaving every other lake/pond untouched. Arms via the "Remove One Lake" button. */
function eraseConnectedWaterBody(point) {
  if (!world.waterMask) return;
  const { resolution, cells } = world.waterMask;
  const size = resolution + 1;
  const { bounds } = world;
  const gx0 = Math.round(((point.x - bounds.minX) / (bounds.maxX - bounds.minX)) * resolution);
  const gz0 = Math.round(((point.z - bounds.minZ) / (bounds.maxZ - bounds.minZ)) * resolution);
  const startIdx = gz0 * size + gx0;
  if (!(cells[startIdx] > WATER_PAINTED_THRESHOLD)) {
    statusLine.textContent = 'No water there — click directly on a painted lake/pond.';
    return;
  }
  const visited = new Uint8Array(cells.length);
  const stack = [startIdx];
  visited[startIdx] = 1;
  let cleared = 0;
  while (stack.length) {
    const idx = stack.pop();
    cells[idx] = 0;
    cleared++;
    const gx = idx % size;
    const gz = Math.floor(idx / size);
    const neighbors = [[gx + 1, gz], [gx - 1, gz], [gx, gz + 1], [gx, gz - 1]];
    for (const [nx, nz] of neighbors) {
      if (nx < 0 || nx >= size || nz < 0 || nz >= size) continue;
      const nIdx = nz * size + nx;
      if (visited[nIdx]) continue;
      if (cells[nIdx] > WATER_PAINTED_THRESHOLD) {
        visited[nIdx] = 1;
        stack.push(nIdx);
      }
    }
  }
  waterDirty = true;
  statusLine.textContent = `Removed one water body (${cleared} cells).`;
}

document.getElementById('erase-water-body').addEventListener('click', () => {
  armedWaterErase = true;
  statusLine.textContent = 'Click a lake/pond to remove just that one body.';
});

function applyWaterLevel() {
  const mask = ensureWaterMask();
  mask.level = parseFloat(waterLevelEl.value) || 0;
  waterDirty = true;
  // Re-carve every already-painted cell at the new level, not just future
  // strokes — otherwise raising the slider only moves the flat plane
  // upward without deepening the basin that's already there.
  const painted = [];
  for (let i = 0; i < mask.cells.length; i++) {
    if (mask.cells[i] > 0) painted.push(i);
  }
  if (painted.length) carveWaterBasin(painted);
}
// Unlike every other water control (radius/softness apply live while
// painting), this used to need an explicit button click to take effect at
// all — the one control in Water mode that didn't behave like the rest of
// the editor. 'change' (fires on blur/Enter, not every keystroke) applies
// it the moment you're done typing; the button stays as a visible, obvious
// way to trigger the same thing.
waterLevelEl.addEventListener('change', applyWaterLevel);
document.getElementById('apply-water-level').addEventListener('click', applyWaterLevel);

document.getElementById('reset-water').addEventListener('click', () => {
  if (!world.waterMask) return;
  world.waterMask.cells.fill(0);
  waterDirty = true;
});

// --- LAKE TOOL (Water mode's "Lake" sub-tool — src/sim/waterBodies.js) ---
const waterToolPaintBtn = document.getElementById('water-tool-paint');
const waterToolLakeBtn = document.getElementById('water-tool-lake');
const waterToolRiverBtn = document.getElementById('water-tool-river');
const waterToolPuddleBtn = document.getElementById('water-tool-puddle');
const waterPaintControlsEl = document.getElementById('water-paint-controls');
const waterLakeControlsEl = document.getElementById('water-lake-controls');
const waterRiverControlsEl = document.getElementById('water-river-controls');
const waterPuddleControlsEl = document.getElementById('water-puddle-controls');
const lakeWidthEl = document.getElementById('lake-width');
const lakeDepthEl = document.getElementById('lake-depth');
const lakePosXEl = document.getElementById('lake-pos-x');
const lakePosYEl = document.getElementById('lake-pos-y');
const lakePosZEl = document.getElementById('lake-pos-z');
const lakeMaxDepthEl = document.getElementById('lake-max-depth');
const lakeRoundingEl = document.getElementById('lake-rounding');
const lakeRoundingValueEl = document.getElementById('lake-rounding-value');
const lakeNudgeStepEl = document.getElementById('lake-nudge-step');
const lakeListEl = document.getElementById('lake-list');
const lakeCountEl = document.getElementById('lake-count');

function setWaterToolMode(newMode) {
  waterToolMode = newMode;
  waterToolPaintBtn.classList.toggle('active', newMode === 'paint');
  waterToolLakeBtn.classList.toggle('active', newMode === 'lake');
  waterToolRiverBtn.classList.toggle('active', newMode === 'river');
  waterToolPuddleBtn.classList.toggle('active', newMode === 'puddle');
  waterPaintControlsEl.style.display = newMode === 'paint' ? 'block' : 'none';
  waterLakeControlsEl.style.display = newMode === 'lake' ? 'block' : 'none';
  waterRiverControlsEl.style.display = newMode === 'river' ? 'block' : 'none';
  waterPuddleControlsEl.style.display = newMode === 'puddle' ? 'block' : 'none';
  if (newMode !== 'lake') armedLakePlacement = false;
  if (newMode !== 'river' && riverDraft) cancelRiverDraft();
  riverHandleGroup.visible = newMode === 'river' && selectedRiver != null;
  updateLakeHandles();
}
waterToolPaintBtn.addEventListener('click', () => setWaterToolMode('paint'));
waterToolLakeBtn.addEventListener('click', () => setWaterToolMode('lake'));
waterToolRiverBtn.addEventListener('click', () => setWaterToolMode('river'));
waterToolPuddleBtn.addEventListener('click', () => setWaterToolMode('puddle'));

/**
 * The outline of a lake centered at (cx,cz) — an axis-aligned rectangle,
 * optionally with rounded corners. `rounding` is the 0..1 fraction stored
 * on the body (see WaterBodyDef's cornerRounding): 0 gives the plain
 * 4-corner rectangle, 1 rounds by half the short side — a circle when the
 * lake is square, a stadium when it isn't. Everything downstream just sees
 * a polygon, so rendering (ShapeGeometry) and collision (the 'polygon'
 * collider in src/sim/collision.js) pick the curve up for free.
 */
function computeLakeRectPoints(cx, cz, width, depth, rounding = 0) {
  const hw = width / 2, hd = depth / 2;
  const r = Math.max(0, Math.min(1, rounding)) * Math.min(hw, hd);
  if (r < 1e-3) {
    return [
      { x: cx - hw, z: cz - hd },
      { x: cx + hw, z: cz - hd },
      { x: cx + hw, z: cz + hd },
      { x: cx - hw, z: cz + hd },
    ];
  }
  // Same corner order as the square case above (-x-z, +x-z, +x+z, -x+z), so
  // pointsBoundsXZ, the drag handles and the collision winding all behave
  // identically either way — each corner just becomes a quarter-circle arc
  // whose ends land exactly on the straight edges.
  const arcs = [
    { cx: cx - hw + r, cz: cz - hd + r, from: Math.PI },
    { cx: cx + hw - r, cz: cz - hd + r, from: Math.PI * 1.5 },
    { cx: cx + hw - r, cz: cz + hd - r, from: 0 },
    { cx: cx - hw + r, cz: cz + hd - r, from: Math.PI * 0.5 },
  ];
  const points = [];
  for (const arc of arcs) {
    for (let i = 0; i <= LAKE_CORNER_SEGMENTS; i++) {
      const a = arc.from + (Math.PI / 2) * (i / LAKE_CORNER_SEGMENTS);
      points.push({ x: arc.cx + Math.cos(a) * r, z: arc.cz + Math.sin(a) * r });
    }
  }
  return points;
}

/** World-space XZ bounding box of any point list — used to read a lake's current center/size back out of its `points`, regardless of whether it's a clean rectangle (freshly placed/resized) or a leftover freeform shape from the old draw tool / mask migration. */
function pointsBoundsXZ(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

document.getElementById('lake-place-btn').addEventListener('click', () => {
  armedLakePlacement = true;
  statusLine.textContent = 'Click the ground to place the lake';
});

/** Drops a new lake at `point`, sized from the Width/Depth fields, surface level auto-sampled from the real terrain right there (so it starts sitting flush on the ground, not at a stale leftover height) — then selects it immediately so the Position/Size fields are ready to fine-tune. */
function placeLakeAt(point) {
  const width = Math.max(1, parseFloat(lakeWidthEl.value) || DEFAULT_LAKE_SIZE);
  const depth = Math.max(1, parseFloat(lakeDepthEl.value) || DEFAULT_LAKE_SIZE);
  const maxDepth = Math.max(0.1, parseFloat(lakeMaxDepthEl.value) || DEFAULT_LAKE_MAX_DEPTH);
  const rounding = readLakeRounding();
  const seed = Math.floor(Math.random() * 1e9);
  const body = {
    id: `lake-${seed}`,
    kind: 'lake',
    points: computeLakeRectPoints(point.x, point.z, width, depth, rounding),
    surfaceLevel: sampleTerrainHeight(world, point.x, point.z),
    maxDepth,
    cornerRounding: rounding,
  };
  if (!world.waterBodies) world.waterBodies = [];
  world.waterBodies.push(body);
  armedLakePlacement = false;
  rebuildLakeBodies(); // synchronous (not just lakeBodiesDirty=true) so the freshly-placed body exists in placedLakeBodies to select right away
  selectLakeBody(placedLakeBodies.find((l) => l.body.id === body.id) || null);
  statusLine.textContent = `Lake "${body.id}" placed — remember to Save World.`;
}

/** The Rounding slider is 0-100 for a friendlier feel; the body stores the 0..1 fraction. */
function readLakeRounding() {
  return Math.max(0, Math.min(1, (parseFloat(lakeRoundingEl.value) || 0) / 100));
}

function populateLakeFields(body) {
  const b = pointsBoundsXZ(body.points);
  lakeRoundingEl.value = Math.round(Math.max(0, Math.min(1, body.cornerRounding || 0)) * 100);
  lakeRoundingValueEl.textContent = `${lakeRoundingEl.value}%`;
  lakePosXEl.value = ((b.minX + b.maxX) / 2).toFixed(2);
  lakePosZEl.value = ((b.minZ + b.maxZ) / 2).toFixed(2);
  lakePosYEl.value = body.surfaceLevel.toFixed(2);
  lakeWidthEl.value = (b.maxX - b.minX).toFixed(2);
  lakeDepthEl.value = (b.maxZ - b.minZ).toFixed(2);
  lakeMaxDepthEl.value = body.maxDepth;
}

/** Applies the Position/Width/Depth/Max-depth fields to the selected lake — regenerates its `points` as a fresh rectangle every time (a lake is always axis-aligned; there's no rotation control, matching the plain "resize by number" model this replaced hand-drawn/draggable points with). */
function applySelectedLakeFields() {
  if (!selectedLakeBody) {
    // Used to return silently, which is what made the fields feel broken:
    // typing a new Width with nothing selected did nothing and said nothing.
    statusLine.textContent = 'No lake selected — click a lake in the viewport (or in the Lakes list below) first, then resize it.';
    return;
  }
  const x = parseFloat(lakePosXEl.value) || 0;
  const z = parseFloat(lakePosZEl.value) || 0;
  const width = Math.max(1, parseFloat(lakeWidthEl.value) || DEFAULT_LAKE_SIZE);
  const depth = Math.max(1, parseFloat(lakeDepthEl.value) || DEFAULT_LAKE_SIZE);
  const rounding = readLakeRounding();
  selectedLakeBody.body.points = computeLakeRectPoints(x, z, width, depth, rounding);
  selectedLakeBody.body.cornerRounding = rounding;
  selectedLakeBody.body.surfaceLevel = parseFloat(lakePosYEl.value) || 0;
  selectedLakeBody.body.maxDepth = Math.max(0.1, parseFloat(lakeMaxDepthEl.value) || DEFAULT_LAKE_MAX_DEPTH);
  lakeBodiesDirty = true;
  updateLakeHandles(); // outline/handles follow the rectangle immediately, not a frame later when the mesh rebuild lands
}
for (const el of [lakeWidthEl, lakeDepthEl, lakePosXEl, lakePosYEl, lakePosZEl, lakeMaxDepthEl]) {
  el.addEventListener('change', applySelectedLakeFields);
}
// 'input' (not just 'change') so dragging the slider reshapes the lake live —
// the same once-per-frame lakeBodiesDirty throttle every other water edit
// already goes through keeps that cheap.
lakeRoundingEl.addEventListener('input', () => {
  lakeRoundingValueEl.textContent = `${lakeRoundingEl.value}%`;
  applySelectedLakeFields();
});

/**
 * Draws the selected lake's yellow outline + its five drag handles (four
 * corners, one center) — the whole reason a placed lake reads as an
 * editable object rather than a box you can only stare at. Called from
 * every path that changes WHICH lake is selected or WHERE it is
 * (selectLakeBody, applySelectedLakeFields, rebuildLakeBodies).
 */
function updateLakeHandles() {
  lakeHandleGroup.clear();
  const showable = mode === 'water' && waterToolMode === 'lake';
  if (!selectedLakeBody) {
    lakeHandleGroup.visible = false;
    lakeOutline.visible = false;
    return;
  }
  const body = selectedLakeBody.body;
  const b = pointsBoundsXZ(body.points);
  const y = body.surfaceLevel + 0.15;
  const corners = [
    { x: b.minX, z: b.minZ },
    { x: b.maxX, z: b.minZ },
    { x: b.maxX, z: b.maxZ },
    { x: b.minX, z: b.maxZ },
  ];
  const outlinePos = lakeOutline.geometry.attributes.position;
  for (let i = 0; i < 4; i++) {
    const handle = buildPathHandleMesh();
    handle.position.set(corners[i].x, y, corners[i].z);
    lakeHandleGroup.add(handle);
    outlinePos.setXYZ(i, corners[i].x, y, corners[i].z);
  }
  outlinePos.needsUpdate = true;
  lakeOutline.geometry.computeBoundingSphere();
  const center = buildPathHandleMesh();
  center.material = center.material.clone();
  center.material.color.setHex(0x66ccff); // distinct from the yellow corner handles: this one moves the whole lake
  center.position.set((b.minX + b.maxX) / 2, y, (b.minZ + b.maxZ) / 2);
  lakeHandleGroup.add(center);

  lakeHandleGroup.visible = showable;
  lakeOutline.visible = showable;
  // Handles are raycast against their matrixWorld, which Three only
  // refreshes during a render — so a handle placed and clicked within the
  // same frame (or while the tab is backgrounded and rAF is paused) would
  // still be sitting at the origin as far as the raycaster is concerned,
  // and every click would silently miss it.
  lakeHandleGroup.updateMatrixWorld(true);
}

function selectLakeBody(entry) {
  selectedLakeBody = entry || null;
  if (selectedLakeBody) populateLakeFields(selectedLakeBody.body);
  selectedLakeHandleIndex = null;
  updateLakeHandles();
}

function deselectLakeBody() {
  selectLakeBody(null);
}

function raycastLakeHandleIndex() {
  if (!lakeHandleGroup.visible) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(lakeHandleGroup.children, false);
  if (hits.length === 0) return null;
  const idx = lakeHandleGroup.children.indexOf(hits[0].object);
  return idx === -1 ? null : idx;
}

/**
 * Applies a corner or center drag to the selected lake. A corner drag
 * anchors the OPPOSITE corner and resizes to the cursor (so the lake grows
 * out from where you're not dragging, like any resize handle); the center
 * handle translates the whole rectangle, keeping its size. Both write back
 * through the same Position/Width/Depth fields the numeric path uses, so
 * the panel always shows what the viewport shows.
 */
function dragSelectedLakeHandle(handleIndex, point) {
  if (!selectedLakeBody) return;
  const b = pointsBoundsXZ(selectedLakeBody.body.points);
  if (handleIndex === 4) {
    lakePosXEl.value = point.x.toFixed(2);
    lakePosZEl.value = point.z.toFixed(2);
  } else {
    // Opposite corner of the one being dragged, in computeLakeRectPoints' order.
    const anchor = [
      { x: b.maxX, z: b.maxZ },
      { x: b.minX, z: b.maxZ },
      { x: b.minX, z: b.minZ },
      { x: b.maxX, z: b.minZ },
    ][handleIndex];
    const width = Math.max(LAKE_MIN_SIZE, Math.abs(point.x - anchor.x));
    const depth = Math.max(LAKE_MIN_SIZE, Math.abs(point.z - anchor.z));
    // Re-derive the center from the anchor + clamped size rather than from
    // the raw cursor, so dragging a corner past its opposite one stops at
    // the minimum instead of flipping the rectangle inside out.
    const dirX = point.x >= anchor.x ? 1 : -1;
    const dirZ = point.z >= anchor.z ? 1 : -1;
    lakeWidthEl.value = width.toFixed(2);
    lakeDepthEl.value = depth.toFixed(2);
    lakePosXEl.value = (anchor.x + dirX * width / 2).toFixed(2);
    lakePosZEl.value = (anchor.z + dirZ * depth / 2).toFixed(2);
  }
  applySelectedLakeFields();
}

/** Manual raise/lower for a selected lake — nudges Position Y by the step field, a faster way to fit the water to the ground by eye than retyping an exact number every time. */
function nudgeSelectedLake(delta) {
  if (!selectedLakeBody) {
    statusLine.textContent = 'Select a lake first (click it) before raising/lowering it.';
    return;
  }
  lakePosYEl.value = ((parseFloat(lakePosYEl.value) || 0) + delta).toFixed(2);
  applySelectedLakeFields();
}
document.getElementById('lake-nudge-up-btn').addEventListener('click', () => {
  nudgeSelectedLake(Math.abs(parseFloat(lakeNudgeStepEl.value) || 0.25));
});
document.getElementById('lake-nudge-down-btn').addEventListener('click', () => {
  nudgeSelectedLake(-Math.abs(parseFloat(lakeNudgeStepEl.value) || 0.25));
});

function raycastLakeBodies() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedLakeBodies.map((l) => l.water).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return null;
  return placedLakeBodies.find((l) => l.water === hits[0].object) || null;
}

function refreshLakeList() {
  const bodies = (world.waterBodies || []).filter((b) => b.kind === 'lake');
  lakeCountEl.textContent = bodies.length;
  lakeListEl.innerHTML = bodies
    .map((b) => {
      const activeClass = selectedLakeBody?.body === b ? ' class="active"' : '';
      return `<div${activeClass}><span data-select-lake="${b.id}">${b.id} (y=${b.surfaceLevel.toFixed(1)})</span><button data-delete-lake="${b.id}">✕</button></div>`;
    })
    .join('');
}

lakeListEl.addEventListener('click', (e) => {
  const deleteId = e.target.dataset.deleteLake;
  if (deleteId !== undefined) {
    const entry = placedLakeBodies.find((l) => l.body.id === deleteId);
    if (selectedLakeBody === entry) selectLakeBody(null);
    world.waterBodies = world.waterBodies.filter((b) => b.id !== deleteId);
    lakeBodiesDirty = true;
    return;
  }
  const selectId = e.target.dataset.selectLake;
  if (selectId !== undefined) {
    selectLakeBody(placedLakeBodies.find((l) => l.body.id === selectId) || null);
  }
});

// --- Migration: legacy world.waterMask -> discrete lake bodies ---
// Runs findWaterMaskComponents/traceWaterMaskComponentToPolygon (Phase 0,
// src/sim/waterBodies.js) once per connected painted region, adding one
// rough kind:'lake' body per region. Deliberately does NOT clear the old
// waterMask (Dennis reviews/drags the new polygons into shape first, then
// clears the legacy mask by hand via "Clear All Water" once satisfied — see
// the plan's semi-automatic-convert-then-manual-touch-up decision). Doesn't
// re-carve terrain either: the legacy paintWater/applyWaterLevel flow
// already carved a basin under this exact area, so carving again would be
// redundant (and, since the traced polygon is a rough approximation of the
// painted shape, could carve OUTSIDE where the mask actually shaped things).
document.getElementById('convert-water-mask-btn').addEventListener('click', () => {
  const statusEl = document.getElementById('convert-water-mask-status');
  if (!world.waterMask) {
    statusEl.textContent = 'No painted water on this map.';
    return;
  }
  const components = findWaterMaskComponents(world.waterMask);
  if (!components.length) {
    statusEl.textContent = 'No painted water found.';
    return;
  }
  if (!world.waterBodies) world.waterBodies = [];
  let created = 0;
  for (const component of components) {
    const points = traceWaterMaskComponentToPolygon(world.waterMask, world.bounds, component);
    if (points.length < 3) continue;
    let maxAlpha = 0;
    for (const idx of component) if (world.waterMask.cells[idx] > maxAlpha) maxAlpha = world.waterMask.cells[idx];
    const seed = Math.floor(Math.random() * 1e9);
    world.waterBodies.push({
      id: `lake-${seed}`,
      kind: 'lake',
      points,
      surfaceLevel: world.waterMask.level,
      maxDepth: Math.max(0.5, WATER_BASIN_DEPTH * maxAlpha),
    });
    created++;
  }
  lakeBodiesDirty = true;
  statusEl.textContent = created
    ? `Converted ${created} painted water bod${created === 1 ? 'y' : 'ies'} to lake${created === 1 ? '' : 's'} — drag their points to clean up, then "Clear All Water" once you're happy. Remember to Save World.`
    : 'No paintable regions traced to a valid polygon.';
});

// --- RIVER TOOL (Water mode's "River" sub-tool — src/sim/rivers.js) ---
const riverWidthEl = document.getElementById('river-width');
const riverMaxDepthEl = document.getElementById('river-max-depth');
const riverNudgeStepEl = document.getElementById('river-nudge-step');
const riverListEl = document.getElementById('river-list');
const riverCountEl = document.getElementById('river-count');

/**
 * Flat, non-terrain-following translucent preview of the in-progress river
 * draft. Drawn as a depth-test-free overlay ON PURPOSE: at its old +0.1 lift
 * with normal depth testing it was buried under the grass cover the editor
 * now shares with the live game, so dragging out a river looked like it did
 * nothing at all until you hit Finish.
 */
function buildRiverDraftPreviewMesh(draft) {
  const width = parseFloat(riverWidthEl.value) || DEFAULT_RIVER_WIDTH;
  const positions = [];
  for (let i = 0; i < draft.points.length; i++) {
    const p = draft.points[i];
    const prev = draft.points[Math.max(0, i - 1)];
    const next = draft.points[Math.min(draft.points.length - 1, i + 1)];
    let tx = next.x - prev.x, tz = next.z - prev.z;
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen; tz /= tlen;
    const nx = -tz, nz = tx;
    const y = draft.surfaceHeights[i] + 0.3;
    positions.push(p.x + nx * width / 2, y, p.z + nz * width / 2, p.x - nx * width / 2, y, p.z - nz * width / 2);
  }
  const indices = [];
  for (let i = 1; i < draft.points.length; i++) {
    const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: 0x3a9bd5, transparent: true, opacity: 0.7, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 999; // it's a drawing aid, not scenery — always on top
  return mesh;
}

/** Repositions the selected river's control-point handle spheres — same buildPathHandleMesh sphere as the Lake tool, at that point's own authored surfaceHeights entry rather than one shared level. */
function updateRiverHandlePositions() {
  riverHandleGroup.clear();
  if (!selectedRiver) {
    riverHandleGroup.visible = false;
    return;
  }
  const { points, surfaceHeights } = selectedRiver.body;
  for (let i = 0; i < points.length; i++) {
    const handle = buildPathHandleMesh();
    handle.position.set(points[i].x, surfaceHeights[i] + 0.2, points[i].z);
    riverHandleGroup.add(handle);
  }
  riverHandleGroup.visible = mode === 'water' && waterToolMode === 'river';
}

function readRiverProperties() {
  return {
    width: Math.max(1, parseFloat(riverWidthEl.value) || DEFAULT_RIVER_WIDTH),
    maxDepth: Math.max(0.1, parseFloat(riverMaxDepthEl.value) || 1.5),
  };
}

function populateRiverProperties(body) {
  riverWidthEl.value = body.width;
  riverMaxDepthEl.value = body.maxDepth;
}

function finishRiverDraft() {
  if (!riverDraft || riverDraft.points.length < 2) {
    statusLine.textContent = 'A river needs at least 2 points — click the ground to add more before finishing.';
    return;
  }
  const seed = Math.floor(Math.random() * 1e9);
  const body = {
    id: `river-${seed}`,
    kind: 'river',
    points: riverDraft.points,
    surfaceHeights: riverDraft.surfaceHeights,
    ...readRiverProperties(),
  };
  if (!world.waterBodies) world.waterBodies = [];
  world.waterBodies.push(body);
  riverDraft = null;
  riverPointerDown = false;
  riversDirty = true;
  statusLine.textContent = `River "${body.id}" added — remember to Save World.`;
}

function cancelRiverDraft() {
  riverDraft = null;
  riverPointerDown = false;
  riversDirty = true; // clears the leftover draft-preview mesh next frame
}

document.getElementById('river-finish-btn').addEventListener('click', finishRiverDraft);
document.getElementById('river-cancel-btn').addEventListener('click', cancelRiverDraft);

function selectRiver(entry) {
  selectedRiver = entry || null;
  selectedRiverHandleIndex = null;
  if (selectedRiver) populateRiverProperties(selectedRiver.body);
  riversDirty = true; // refreshes handle positions + list highlight next frame
}

function deselectRiver() {
  selectRiver(null);
}

// Same live-apply-on-change pattern as the Lake tool. 'change' not 'input',
// same restraint as everywhere else a numeric field re-triggers a rebuild.
for (const el of [riverWidthEl, riverMaxDepthEl]) {
  el.addEventListener('change', () => {
    if (!selectedRiver) return;
    Object.assign(selectedRiver.body, readRiverProperties());
    riversDirty = true;
  });
}

/** Manual raise/lower for a selected river — shifts EVERY authored point's surfaceHeights entry by the same delta, so the whole river moves up/down as one rigid piece without disturbing its slope (a uniform shift can never break the non-increasing invariant either, so no re-clamp is needed). Same direct "fit it by eye" escape hatch as nudgeSelectedLake. */
function nudgeSelectedRiver(delta) {
  if (!selectedRiver) {
    statusLine.textContent = 'Select a river first (click it) before raising/lowering it.';
    return;
  }
  const heights = selectedRiver.body.surfaceHeights;
  for (let i = 0; i < heights.length; i++) heights[i] += delta;
  riversDirty = true;
}
document.getElementById('river-nudge-up-btn').addEventListener('click', () => {
  nudgeSelectedRiver(Math.abs(parseFloat(riverNudgeStepEl.value) || 0.25));
});
document.getElementById('river-nudge-down-btn').addEventListener('click', () => {
  nudgeSelectedRiver(-Math.abs(parseFloat(riverNudgeStepEl.value) || 0.25));
});

function deleteSelectedRiverPoint() {
  if (!selectedRiver || selectedRiverHandleIndex == null) return;
  if (selectedRiver.body.points.length <= 2) {
    statusLine.textContent = 'A river needs at least 2 points.';
    return;
  }
  selectedRiver.body.points.splice(selectedRiverHandleIndex, 1);
  selectedRiver.body.surfaceHeights.splice(selectedRiverHandleIndex, 1);
  selectedRiverHandleIndex = null;
  riversDirty = true;
}

function raycastRivers() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedRivers.map((r) => r.water).filter(Boolean);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return null;
  return placedRivers.find((r) => r.water === hits[0].object) || null;
}

/** Returns the control-point index of the handle under the cursor, or null. */
function raycastRiverHandleIndex() {
  if (!riverHandleGroup.visible) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(riverHandleGroup.children, false);
  if (hits.length === 0) return null;
  const idx = riverHandleGroup.children.indexOf(hits[0].object);
  return idx === -1 ? null : idx;
}

function refreshRiverList() {
  const rivers = (world.waterBodies || []).filter((b) => b.kind === 'river');
  riverCountEl.textContent = rivers.length;
  riverListEl.innerHTML = rivers
    .map((b) => {
      const activeClass = selectedRiver?.body === b ? ' class="active"' : '';
      return `<div${activeClass}><span data-select-river="${b.id}">${b.id} (${b.points.length} pts, w=${b.width})</span><button data-delete-river="${b.id}">✕</button></div>`;
    })
    .join('');
}

riverListEl.addEventListener('click', (e) => {
  const deleteId = e.target.dataset.deleteRiver;
  if (deleteId !== undefined) {
    const entry = placedRivers.find((r) => r.body.id === deleteId);
    if (selectedRiver === entry) selectRiver(null);
    world.waterBodies = world.waterBodies.filter((b) => b.id !== deleteId);
    riversDirty = true;
    return;
  }
  const selectId = e.target.dataset.selectRiver;
  if (selectId !== undefined) {
    selectRiver(placedRivers.find((r) => r.body.id === selectId) || null);
  }
});

// --- PUDDLE TOOL (Water mode's "Puddle" sub-tool — src/sim/waterBodies.js) ---
const puddleRadiusEl = document.getElementById('puddle-radius');
const puddleMaxDepthEl = document.getElementById('puddle-max-depth');
const puddleListEl = document.getElementById('puddle-list');
const puddleCountEl = document.getElementById('puddle-count');
const PUDDLE_SIDES = 10;

/** A slightly-irregular N-gon rather than a perfect circle — a puddle reads more natural with a bit of blobbiness, same aesthetic reasoning as this project's jittered rock/boulder generators. */
function generatePuddlePolygon(cx, cz, radius) {
  const points = [];
  for (let i = 0; i < PUDDLE_SIDES; i++) {
    const angle = (i / PUDDLE_SIDES) * Math.PI * 2;
    const r = radius * (0.8 + Math.random() * 0.4);
    points.push({ x: cx + Math.cos(angle) * r, z: cz + Math.sin(angle) * r });
  }
  return points;
}

/** Drops one puddle at `point` — no draft, no carving, fires immediately (armed the whole time the Puddle sub-tool is active, same "click again to place another" convention as the scatter brush/prop placement elsewhere in this editor). `surfaceLevel` is sampled from the terrain right there (plus a hair of clearance) since there's no basin to carve it into — the puddle is meant to sit in whatever low spot the author already picked by eye. */
function placePuddleAt(point) {
  const radius = Math.max(0.25, parseFloat(puddleRadiusEl.value) || DEFAULT_PUDDLE_RADIUS);
  const maxDepth = Math.max(0.02, parseFloat(puddleMaxDepthEl.value) || DEFAULT_PUDDLE_MAX_DEPTH);
  const seed = Math.floor(Math.random() * 1e9);
  const body = {
    id: `puddle-${seed}`,
    kind: 'puddle',
    points: generatePuddlePolygon(point.x, point.z, radius),
    surfaceLevel: sampleTerrainHeight(world, point.x, point.z) + 0.02,
    maxDepth,
  };
  if (!world.waterBodies) world.waterBodies = [];
  world.waterBodies.push(body);
  lakeBodiesDirty = true; // same render pipeline as lakes (buildLakeBodyMeshes already handles kind:'puddle') — no separate rebuild path
  statusLine.textContent = `Puddle "${body.id}" placed — remember to Save World.`;
}

function refreshPuddleList() {
  const puddles = (world.waterBodies || []).filter((b) => b.kind === 'puddle');
  puddleCountEl.textContent = puddles.length;
  puddleListEl.innerHTML = puddles
    .map((b) => `<div><span>${b.id}</span><button data-delete-puddle="${b.id}">✕</button></div>`)
    .join('');
}

puddleListEl.addEventListener('click', (e) => {
  const deleteId = e.target.dataset.deletePuddle;
  if (deleteId !== undefined) {
    world.waterBodies = world.waterBodies.filter((b) => b.id !== deleteId);
    lakeBodiesDirty = true;
  }
});

// --- COLOUR GRADING CONTROLS (shared by Ground Textures and Paths) ---
// Every ground/path texture in the project is baked from code, so its colour
// is fixed at one hard-coded RGB triple per theme. A grade
// (src/sim/colorGrading.js) is the per-layer/per-path escape hatch: the same
// baked tile, recoloured at draw time. Three identical widget groups needed
// wiring (painted layer, path draft, selected path), so they share one
// builder rather than three copies of the same six listeners.
//
// The HTML ids are derived from `idPrefix` by fixed suffixes — `-tint`,
// `-saturation`, `-saturation-out`, `-brightness`, `-brightness-out`,
// `-color-reset` — so adding a fourth grade-able thing is a block of markup
// and one call, with no new JS.
function buildColorGradeControls(idPrefix, onChange) {
  const tintEl = document.getElementById(`${idPrefix}-tint`);
  const satEl = document.getElementById(`${idPrefix}-saturation`);
  const satOutEl = document.getElementById(`${idPrefix}-saturation-out`);
  const brightEl = document.getElementById(`${idPrefix}-brightness`);
  const brightOutEl = document.getElementById(`${idPrefix}-brightness-out`);
  const resetEl = document.getElementById(`${idPrefix}-color-reset`);

  const read = () => ({
    tint: tintEl.value,
    saturation: parseFloat(satEl.value),
    brightness: parseFloat(brightEl.value),
  });
  const syncOutputs = () => {
    satOutEl.textContent = `${parseFloat(satEl.value).toFixed(2)}x`;
    brightOutEl.textContent = `${parseFloat(brightEl.value).toFixed(2)}x`;
  };
  const set = (grade) => {
    const g = normalizeColorGrade(grade);
    tintEl.value = g.tint;
    satEl.value = g.saturation;
    brightEl.value = g.brightness;
    syncOutputs();
  };
  // 'input', not 'change': a colour picker and a slider both stream while
  // being dragged, and the whole point of grading in the editor is watching
  // the ground change under the cursor rather than after letting go.
  for (const el of [tintEl, satEl, brightEl]) {
    el.addEventListener('input', () => { syncOutputs(); onChange(read()); });
  }
  resetEl.addEventListener('click', () => {
    set(DEFAULT_COLOR_GRADE);
    onChange({ ...DEFAULT_COLOR_GRADE });
  });
  syncOutputs();
  return { read, set };
}

/**
 * Writes a grade onto whatever carries it, DELETING the field when the grade
 * is the identity. An untouched layer or path must serialize the same bytes it
 * always did — otherwise merely opening a map in the editor and saving it
 * rewrites every path in world.json with a no-op `colorGrade`, which turns
 * every save into an unreviewable diff.
 */
function storeColorGrade(target, grade) {
  if (isNeutralColorGrade(grade)) delete target.colorGrade;
  else target.colorGrade = normalizeColorGrade(grade);
}

// --- GROUND TEXTURES MODE ---
// Paint biome ground-cover textures (or an uploaded custom image) onto the
// terrain, brush mechanics identical to Water's paintWater() above — each
// texture id gets its own soft-edged weight mask, and layers alpha-composite
// in creation order into one baked overlay (src/render/groundTextureMesh.js).
// A layer can also carry an ambient particleType, rendered live-game-only.
let groundTexTheme = 'meadow';
let groundTexDirty = false;
let groundTextureOverlayMesh = null;
let customGroundTextureCatalog = []; // [{id, name, url}], fetched from /api/ground-textures

const groundTexRadiusEl = document.getElementById('groundtex-radius');
const groundTexSoftnessEl = document.getElementById('groundtex-softness');
const groundTexParticleEl = document.getElementById('groundtex-particle');
const groundTexParticleSizeEl = document.getElementById('groundtex-particle-size');
const groundTexParticleSizeOutEl = document.getElementById('groundtex-particle-size-out');
const groundTexParticleDensityEl = document.getElementById('groundtex-particle-density');
const groundTexParticleDensityOutEl = document.getElementById('groundtex-particle-density-out');
const groundTexPaletteEl = document.getElementById('groundtex-palette');
const groundTexListEl = document.getElementById('groundtex-list');
const groundTexCountEl = document.getElementById('groundtex-count');
const groundTexUploadStatusEl = document.getElementById('groundtex-upload-status');

/** Finds an existing painted layer for a texture id, or lazily creates an empty one — so picking a texture in the palette and painting "just works" without a separate "new layer" step. */
function ensureGroundTextureLayer(textureId, resolution = DEFAULT_GROUND_TEXTURE_RESOLUTION) {
  if (!world.groundTextures) world.groundTextures = [];
  let layer = world.groundTextures.find((l) => l.textureId === textureId);
  if (!layer) {
    layer = {
      id: `groundtex-${Math.floor(Math.random() * 1e9)}`,
      textureId,
      particleType: null,
      resolution,
      cells: new Array((resolution + 1) * (resolution + 1)).fill(0),
    };
    world.groundTextures.push(layer);
  }
  return layer;
}

/**
 * One brush stamp. Painting adds to the SELECTED texture's layer; erasing
 * (shift) subtracts from EVERY layer under the brush.
 *
 * Erase used to be scoped to the selected texture too, which meant rubbing
 * out a patch you'd painted a while ago first required working out which of
 * the layers it was and re-selecting it — and until you'd guessed right the
 * brush silently did nothing. What you point at is what comes off.
 */
function paintGroundTexture(point, erase) {
  const layers = erase
    ? (world.groundTextures || [])
    : [(world.groundTextures || []).find((l) => l.textureId === groundTexTheme) || ensureGroundTextureLayer(groundTexTheme)];
  if (!layers.length) return; // erasing with nothing painted anywhere
  const { bounds } = world;
  const radius = parseFloat(groundTexRadiusEl.value);
  const softness = parseFloat(groundTexSoftnessEl.value);

  for (const layer of layers) {
    const { resolution, cells } = layer;
    for (let gz = 0; gz <= resolution; gz++) {
      for (let gx = 0; gx <= resolution; gx++) {
        const wx = bounds.minX + (gx / resolution) * (bounds.maxX - bounds.minX);
        const wz = bounds.minZ + (gz / resolution) * (bounds.maxZ - bounds.minZ);
        const dist = Math.hypot(wx - point.x, wz - point.z);
        if (dist > radius) continue;
        const falloff = Math.min(1, (1 - dist / radius) / Math.max(0.05, softness));
        const idx = gz * (resolution + 1) + gx;
        if (erase) cells[idx] = Math.max(0, cells[idx] - falloff);
        else cells[idx] = Math.min(1, cells[idx] + falloff);
      }
    }
  }
  groundTexDirty = true;
}

function rebuildGroundTextureOverlay() {
  removeAndDispose(scene, groundTextureOverlayMesh);
  groundTextureOverlayMesh = buildGroundTextureOverlay(world);
  if (groundTextureOverlayMesh) {
    scene.add(groundTextureOverlayMesh);
    applyCloudShadowSettings(groundTextureOverlayMesh, world.graphicsSettings.postFx.cloudShadows);
  }
  refreshGroundTexList();
}

function groundTextureLabel(textureId) {
  if (textureId.startsWith('custom:')) {
    const id = textureId.slice(7);
    return customGroundTextureCatalog.find((c) => c.id === id)?.name || textureId;
  }
  return GROUND_TEXTURE_BUILTIN_DEFS.find((t) => t.id === textureId)?.label || textureId;
}

function refreshGroundTexList() {
  const layers = world.groundTextures || [];
  groundTexCountEl.textContent = layers.length;
  groundTexListEl.innerHTML = layers
    .map((l, i) => {
      const particleLabel = l.particleType ? ` — ${PARTICLE_TYPE_LABELS[l.particleType] || l.particleType}` : '';
      return `<div><span>${groundTextureLabel(l.textureId)}${particleLabel}</span><button data-delete-groundtex="${i}">✕</button></div>`;
    })
    .join('');
}

groundTexListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deleteGroundtex;
  if (idx === undefined) return;
  world.groundTextures.splice(parseInt(idx, 10), 1);
  groundTexDirty = true;
});

/** The size/density sliders only ever multiply an ALREADY-selected particle type (see buildLayerParticles in ambientParticles.js) — dragging them with "None" selected does nothing, which read as "particles broken" rather than "no type picked yet". Disabling them makes that dependency visible instead of silent. */
function syncGroundTexParticleSlidersEnabled() {
  const enabled = groundTexParticleEl.value !== '';
  groundTexParticleSizeEl.disabled = !enabled;
  groundTexParticleDensityEl.disabled = !enabled;
}

function syncGroundTexParticleDropdown() {
  const existing = (world.groundTextures || []).find((l) => l.textureId === groundTexTheme);
  groundTexParticleEl.value = existing?.particleType || '';
  const sizeMul = existing?.particleSizeMultiplier ?? 1;
  const densityMul = existing?.particleDensityMultiplier ?? 1;
  groundTexParticleSizeEl.value = sizeMul;
  groundTexParticleSizeOutEl.textContent = `${sizeMul.toFixed(2)}x`;
  groundTexParticleDensityEl.value = densityMul;
  groundTexParticleDensityOutEl.textContent = `${densityMul.toFixed(2)}x`;
  syncGroundTexParticleSlidersEnabled();
  // The grade belongs to the layer, so switching texture in the palette has to
  // pull that layer's colour back into the widgets — otherwise the sliders
  // keep showing the last texture's numbers and the next drag silently stamps
  // them onto a different layer.
  groundTexColorControls.set(existing?.colorGrade);
}

// Grading the SELECTED texture's layer, which is why it lazily creates one:
// picking a colour before you have painted anything is a perfectly reasonable
// order to work in, and the layer's empty mask makes it invisible until you do.
const groundTexColorControls = buildColorGradeControls('groundtex', (grade) => {
  storeColorGrade(ensureGroundTextureLayer(groundTexTheme), grade);
  groundTexDirty = true;
});

groundTexParticleEl.addEventListener('change', () => {
  const layer = ensureGroundTextureLayer(groundTexTheme);
  layer.particleType = groundTexParticleEl.value || null;
  syncGroundTexParticleSlidersEnabled();
  refreshGroundTexList();
});

groundTexParticleSizeEl.addEventListener('input', () => {
  const v = parseFloat(groundTexParticleSizeEl.value);
  groundTexParticleSizeOutEl.textContent = `${v.toFixed(2)}x`;
  ensureGroundTextureLayer(groundTexTheme).particleSizeMultiplier = v;
});

groundTexParticleDensityEl.addEventListener('input', () => {
  const v = parseFloat(groundTexParticleDensityEl.value);
  groundTexParticleDensityOutEl.textContent = `${v.toFixed(2)}x`;
  ensureGroundTextureLayer(groundTexTheme).particleDensityMultiplier = v;
});

function renderGroundTexPalette() {
  groundTexPaletteEl.innerHTML = '';
  const items = [
    ...GROUND_TEXTURE_BUILTIN_DEFS.map((t) => ({ id: t.id, label: t.label })),
    ...customGroundTextureCatalog.map((c) => ({ id: `custom:${c.id}`, label: c.name })),
  ];
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = item.label;
    btn.appendChild(renderGroundTextureSwatchCanvas(item.id, 32));
    btn.classList.toggle('active', item.id === groundTexTheme);
    btn.addEventListener('click', () => {
      groundTexTheme = item.id;
      renderGroundTexPalette();
      syncGroundTexParticleDropdown();
    });
    groundTexPaletteEl.appendChild(btn);
  }
}
renderGroundTexPalette();

// Custom textures — fetch the catalog once, register each for (async) tile
// loading, and re-bake once an image actually finishes loading (it may not
// have by the time the first paint stroke bakes the overlay).
setCustomGroundTextureLoadedCallback(() => {
  groundTexDirty = true;
  renderGroundTexPalette(); // the swatch for this id was a gray placeholder until now
});
fetch('/api/ground-textures')
  .then((r) => r.json())
  .then((catalog) => {
    customGroundTextureCatalog = catalog;
    for (const entry of catalog) registerCustomGroundTexture(entry.id, entry.url);
    renderGroundTexPalette();
  })
  .catch((err) => console.error('Failed to load custom ground textures:', err));

document.getElementById('groundtex-upload-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('groundtex-upload-file');
  const nameInput = document.getElementById('groundtex-upload-name');
  const file = fileInput.files[0];
  if (!file) {
    groundTexUploadStatusEl.textContent = 'Choose an image file first.';
    return;
  }
  const formData = new FormData();
  formData.append('texture', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());
  groundTexUploadStatusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/ground-textures/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    customGroundTextureCatalog.push(data.entry);
    registerCustomGroundTexture(data.entry.id, data.entry.url);
    groundTexTheme = `custom:${data.entry.id}`;
    renderGroundTexPalette();
    syncGroundTexParticleDropdown();
    fileInput.value = '';
    nameInput.value = '';
    groundTexUploadStatusEl.textContent = `Uploaded "${data.entry.name}" ✓`;
  } catch (err) {
    groundTexUploadStatusEl.textContent = `Upload failed: ${err.message}`;
  }
});

// --- ZONES MODE ---
let zoneDraft = null; // { center: {x,z}, previewMesh }
const zoneListEl = document.getElementById('zone-list');
const zoneCountEl = document.getElementById('zone-count');

function finalizeZone(radius) {
  if (!zoneDraft || radius < 2) {
    if (zoneDraft?.previewMesh) scene.remove(zoneDraft.previewMesh);
    zoneDraft = null;
    return;
  }
  const type = document.getElementById('zone-type').value;
  const idInput = document.getElementById('zone-id').value.trim();
  const id = idInput || `zone-${Date.now()}`;
  const zone = {
    id,
    type,
    center: { x: zoneDraft.center.x, y: 0, z: zoneDraft.center.z },
    radius,
  };
  if (type === 'gathering') {
    zone.resource = document.getElementById('zone-resource').value;
  }
  world.zones.push(zone);
  scene.remove(zoneDraft.previewMesh);
  zoneDraft = null;

  if (zone.type === 'gathering') {
    const mesh = buildZoneMarker(zone);
    mesh.visible = zonesVisible;
    scene.add(mesh);
    placedZones.push({ ref: zone, mesh });
  } else {
    rebuildStatic();
  }
  refreshLists();
}

document.getElementById('zone-list').addEventListener('click', (e) => {
  if (e.target.dataset.deleteZone === undefined) return;
  const id = e.target.dataset.deleteZone;
  const entry = placedZones.find((z) => z.ref.id === id);
  if (entry) {
    scene.remove(entry.mesh);
    placedZones.splice(placedZones.indexOf(entry), 1);
  }
  world.zones = world.zones.filter((z) => z.id !== id);
  refreshLists();
});

// --- FREEFORM ZONES (Zones mode's "Freeform" shape) ---
const zoneCircleControlsEl = document.getElementById('zone-circle-controls');
const zoneFreeformControlsEl = document.getElementById('zone-freeform-controls');
const zoneShapeCircleBtn = document.getElementById('zone-shape-circle');
const zoneShapeFreeformBtn = document.getElementById('zone-shape-freeform');
const fzNameEl = document.getElementById('fz-name');
const fzMusicEl = document.getElementById('fz-music');
const fzMusicLoopEl = document.getElementById('fz-music-loop');
const fzMusicVolumeEl = document.getElementById('fz-music-volume');
const fzMusicVolumeOutEl = document.getElementById('fz-music-volume-out');
const fzAmbientEl = document.getElementById('fz-ambient');
const fzParticleEl = document.getElementById('fz-particle');
const fzListEl = document.getElementById('fz-list');
const fzCountEl = document.getElementById('fz-count');

fzMusicVolumeEl.addEventListener('input', () => {
  fzMusicVolumeOutEl.textContent = parseFloat(fzMusicVolumeEl.value).toFixed(2);
});

for (const id of PARTICLE_TYPE_IDS) {
  const opt = document.createElement('option');
  opt.value = id;
  opt.textContent = PARTICLE_TYPE_LABELS[id] || id;
  fzParticleEl.appendChild(opt);
}

function setZoneShapeMode(newMode) {
  zoneShapeMode = newMode;
  zoneShapeCircleBtn.classList.toggle('active', newMode === 'circle');
  zoneShapeFreeformBtn.classList.toggle('active', newMode === 'freeform');
  zoneCircleControlsEl.style.display = newMode === 'circle' ? 'block' : 'none';
  zoneFreeformControlsEl.style.display = newMode === 'freeform' ? 'block' : 'none';
  if (newMode === 'circle' && freeformZoneDraft) cancelFreeformZoneDraft();
  if (newMode === 'freeform' && zoneDraft) { scene.remove(zoneDraft.previewMesh); zoneDraft = null; }
  freeformZoneHandleGroup.visible = newMode === 'freeform' && selectedFreeformZone != null;
}
zoneShapeCircleBtn.addEventListener('click', () => setZoneShapeMode('circle'));
zoneShapeFreeformBtn.addEventListener('click', () => setZoneShapeMode('freeform'));

// --- Audio catalog (music/ambient tracks) — same list-upload idiom as
// custom ground textures, split into two dropdowns by kind.
let audioCatalog = []; // [{id, name, kind, url}]
function refreshAudioDropdowns() {
  const music = audioCatalog.filter((a) => a.kind === 'music');
  const ambient = audioCatalog.filter((a) => a.kind === 'ambient');
  fzMusicEl.innerHTML = '<option value="">— none —</option>' + music.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  fzAmbientEl.innerHTML = '<option value="">— none —</option>' + ambient.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  renderAudioTrackList('music', music);
  renderAudioTrackList('ambient', ambient);
}

/**
 * The delete half of the audio catalog. Uploads were one-way before this:
 * deleting the file off disk by hand left its catalog entry behind, so the
 * dropdown kept offering a track that no longer plays and there was no way
 * to get rid of it from the editor.
 *
 * POST /api/audio/catalog takes the WHOLE list and deletes the file behind
 * any entry that's gone from it, so removal is "send the list minus one".
 */
function renderAudioTrackList(kind, entries) {
  const el = document.getElementById(`fz-${kind}-track-list`);
  el.innerHTML = entries.length
    ? entries.map((a) => `<div><span>${a.name}</span><button data-delete-audio="${a.id}">✕</button></div>`).join('')
    : '<div class="hint">Nothing uploaded yet.</div>';
}

async function deleteAudioTrack(id) {
  const entry = audioCatalog.find((a) => a.id === id);
  if (!entry) return;
  const usedBy = (world?.zones || []).filter((z) => z.music?.musicId === id || z.ambientSound?.soundId === id);
  const warning = usedBy.length
    ? `\n\n${usedBy.length} zone(s) on this map still use it — they'll fall silent.`
    : '';
  if (!confirm(`Delete "${entry.name}"? The audio file is removed from disk too.${warning}`)) return;
  const next = audioCatalog.filter((a) => a.id !== id);
  const res = await fetch('/api/audio/catalog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(next),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    statusLine.textContent = `Delete failed: ${body.error || res.status}`;
    return;
  }
  audioCatalog = next;
  refreshAudioDropdowns();
  statusLine.textContent = `Deleted "${entry.name}".`;
}

for (const kind of ['music', 'ambient']) {
  document.getElementById(`fz-${kind}-track-list`).addEventListener('click', (e) => {
    const id = e.target.dataset.deleteAudio;
    if (id) deleteAudioTrack(id);
  });
}
fetch('/api/audio')
  .then((r) => r.json())
  .then((catalog) => {
    audioCatalog = catalog;
    refreshAudioDropdowns();
  })
  .catch(() => {});

async function uploadAudio(kind, fileInput, nameInput, statusEl, targetSelectEl) {
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = 'Choose an audio file first.';
    return;
  }
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('kind', kind);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());
  statusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/audio/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    audioCatalog.push(data.entry);
    refreshAudioDropdowns();
    targetSelectEl.value = data.entry.id;
    fileInput.value = '';
    nameInput.value = '';
    statusEl.textContent = `Uploaded "${data.entry.name}" ✓`;
  } catch (err) {
    statusEl.textContent = `Upload failed: ${err.message}`;
  }
}
document.getElementById('fz-music-upload-btn').addEventListener('click', () => uploadAudio(
  'music',
  document.getElementById('fz-music-upload-file'),
  document.getElementById('fz-music-upload-name'),
  document.getElementById('fz-music-upload-status'),
  fzMusicEl
));
document.getElementById('fz-ambient-upload-btn').addEventListener('click', () => uploadAudio(
  'ambient',
  document.getElementById('fz-ambient-upload-file'),
  document.getElementById('fz-ambient-upload-name'),
  document.getElementById('fz-ambient-upload-status'),
  fzAmbientEl
));

/** Reads the properties panel into a partial ZoneDef (music/ambientSound/particleType), applied to both new and already-selected freeform zones. */
function readFreeformZoneProperties() {
  const props = { name: fzNameEl.value.trim() || undefined };
  if (fzMusicEl.value) {
    props.music = { musicId: fzMusicEl.value, loop: fzMusicLoopEl.checked, volume: parseFloat(fzMusicVolumeEl.value) };
  }
  if (fzAmbientEl.value) props.ambientSound = { soundId: fzAmbientEl.value };
  if (fzParticleEl.value) props.particleType = fzParticleEl.value;
  return props;
}

function populateFreeformZoneProperties(zone) {
  fzNameEl.value = zone.name || '';
  fzMusicEl.value = zone.music?.musicId || '';
  fzMusicLoopEl.checked = zone.music?.loop ?? true;
  fzMusicVolumeEl.value = zone.music?.volume ?? 1;
  fzMusicVolumeOutEl.textContent = parseFloat(fzMusicVolumeEl.value).toFixed(2);
  fzAmbientEl.value = zone.ambientSound?.soundId || '';
  fzParticleEl.value = zone.particleType || '';
}

function finishFreeformZoneDraft() {
  if (!freeformZoneDraft || freeformZoneDraft.points.length < 3) {
    statusLine.textContent = 'A freeform zone needs at least 3 points — click the ground to add more before finishing.';
    return;
  }
  const seed = Math.floor(Math.random() * 1e9);
  const zone = {
    id: `zone-${seed}`,
    shape: 'polygon',
    points: freeformZoneDraft.points,
    ...readFreeformZoneProperties(),
  };
  world.zones.push(zone);
  freeformZoneDraft = null;
  freeformZonePointerDown = false;
  freeformZonesDirty = true;
  statusLine.textContent = `Zone "${zone.id}" added — remember to Save World.`;
}

function cancelFreeformZoneDraft() {
  freeformZoneDraft = null;
  freeformZonePointerDown = false;
  freeformZonesDirty = true;
}

document.getElementById('fz-finish-btn').addEventListener('click', finishFreeformZoneDraft);
document.getElementById('fz-cancel-btn').addEventListener('click', cancelFreeformZoneDraft);

function selectFreeformZone(entry) {
  selectedFreeformZone = entry || null;
  selectedFreeformZoneHandleIndex = null;
  if (selectedFreeformZone) populateFreeformZoneProperties(selectedFreeformZone.ref);
  updateFreeformZoneHandlePositions();
  refreshFreeformZoneList();
}

function deselectFreeformZone() {
  selectFreeformZone(null);
}

// Editing the properties panel while a zone is selected applies live —
// same "select, then the shared form is the editor" pattern the Selected
// NPC/Path panels already use, rather than a separate Apply button.
for (const el of [fzNameEl, fzMusicEl, fzMusicLoopEl, fzMusicVolumeEl, fzAmbientEl, fzParticleEl]) {
  el.addEventListener('change', () => {
    if (!selectedFreeformZone) return;
    Object.assign(selectedFreeformZone.ref, readFreeformZoneProperties());
    refreshFreeformZoneList();
  });
}

function deleteSelectedFreeformZonePoint() {
  if (!selectedFreeformZone || selectedFreeformZoneHandleIndex == null) return;
  if (selectedFreeformZone.ref.points.length <= 3) {
    statusLine.textContent = 'A freeform zone needs at least 3 points.';
    return;
  }
  selectedFreeformZone.ref.points.splice(selectedFreeformZoneHandleIndex, 1);
  selectedFreeformZoneHandleIndex = null;
  freeformZonesDirty = true;
}

function raycastFreeformZones() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedFreeformZones.map((z) => z.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedFreeformZones.some((z) => z.mesh === obj)) obj = obj.parent;
  return placedFreeformZones.find((z) => z.mesh === obj) || null;
}

/** Returns the control-point index of the handle under the cursor, or null. */
function raycastFreeformZoneHandleIndex() {
  if (!freeformZoneHandleGroup.visible) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(freeformZoneHandleGroup.children, false);
  if (hits.length === 0) return null;
  const idx = freeformZoneHandleGroup.children.indexOf(hits[0].object);
  return idx === -1 ? null : idx;
}

function refreshFreeformZoneList() {
  const zones = world.zones.filter((z) => z.shape === 'polygon');
  fzCountEl.textContent = zones.length;
  fzListEl.innerHTML = zones
    .map((z) => {
      const tags = [z.music ? '♪' : null, z.ambientSound ? '♫' : null, z.particleType ? '✦' : null].filter(Boolean).join(' ');
      const activeClass = selectedFreeformZone?.ref === z ? ' class="active"' : '';
      return `<div${activeClass}><span data-select-fz="${z.id}">${z.name || z.id} (${z.points.length} pts) ${tags}</span><button data-delete-fz="${z.id}">✕</button></div>`;
    })
    .join('');
}

fzListEl.addEventListener('click', (e) => {
  const deleteId = e.target.dataset.deleteFz;
  if (deleteId !== undefined) {
    const entry = placedFreeformZones.find((z) => z.ref.id === deleteId);
    if (selectedFreeformZone === entry) selectFreeformZone(null);
    world.zones = world.zones.filter((z) => z.id !== deleteId);
    freeformZonesDirty = true;
    return;
  }
  const selectId = e.target.dataset.selectFz;
  if (selectId !== undefined) {
    selectFreeformZone(placedFreeformZones.find((z) => z.ref.id === selectId) || null);
  }
});

// --- BUILDINGS MODE ---
let armedBuilding = false;
document.getElementById('place-building-btn').addEventListener('click', () => {
  armedBuilding = true;
  statusLine.textContent = 'Click the ground to place the building';
});

function placeBuildingAt(point) {
  const id = document.getElementById('bld-id').value.trim() || `building-${Date.now()}`;
  const rawType = document.getElementById('bld-type').value.trim() || 'building';
  const width = parseFloat(document.getElementById('bld-width').value) || 8;
  const depth = parseFloat(document.getElementById('bld-depth').value) || 8;
  const enterable = document.getElementById('bld-enterable').checked;
  const interiorId = document.getElementById('bld-interior-id').value.trim() || null;

  // Same 'custom:<id>' convention the Object Builder's prop palette already
  // uses (parsePaletteType) — an authored Building Builder type, not one of
  // the built-in generateBuildingShell shapes.
  const isCustom = rawType.startsWith('custom:');
  const type = isCustom ? 'custom' : rawType;
  const buildingTypeId = isCustom ? rawType.slice(7) : undefined;

  const b = {
    id,
    type,
    ...(buildingTypeId ? { buildingTypeId } : {}),
    seed: Math.floor(Math.random() * 1e9),
    position: { x: snap(point.x), y: 0, z: snap(point.z) },
    rotationDeg: 0,
    footprint: { width, depth },
    enterable,
    interiorId,
  };
  world.buildings.push(b);
  const mesh = buildBuildingPlaceholder(b, world, buildingCatalogForRender);
  toonify(mesh);
  scene.add(mesh);
  placedBuildings.push({ ref: b, mesh });
  armedBuilding = false;
  refreshLists();
}

document.getElementById('bld-list').addEventListener('click', (e) => {
  if (e.target.dataset.deleteBuilding === undefined) return;
  const id = e.target.dataset.deleteBuilding;
  const entry = placedBuildings.find((b) => b.ref.id === id);
  if (entry) {
    scene.remove(entry.mesh);
    placedBuildings.splice(placedBuildings.indexOf(entry), 1);
  }
  world.buildings = world.buildings.filter((b) => b.id !== id);
  refreshLists();
});

document.getElementById('obj-list').addEventListener('click', (e) => {
  if (e.target.dataset.deleteObj === undefined) return;
  const idx = parseInt(e.target.dataset.deleteObj, 10);
  const item = placedItems[idx];
  if (!item) return;
  if (selected === item) selectItem(null);
  else if (multiSelected.has(item)) { forgetPlacedItem(item); refreshMultiHighlights(); }
  scene.remove(item.mesh);
  if (item.kind === 'wall') world.walls = world.walls.filter((w) => w !== item.ref);
  else world.props = world.props.filter((p) => p !== item.ref);
  placedItems.splice(idx, 1);
  refreshLists();
});

// --- MONSTERS MODE ---
const floorSelectEl = document.getElementById('floor-select');
const floorStatusEl = document.getElementById('floor-status');
const monListEl = document.getElementById('mon-list');
const monCountEl = document.getElementById('mon-count');
const monSelectedInfoEl = document.getElementById('mon-selected-info');
const monSelectedControlsEl = document.getElementById('mon-selected-controls');
const monListHeadingEl = document.getElementById('mon-list-heading');

const saveFloorBtnEl = document.getElementById('save-floor-btn');

fetch('/api/tower/floors')
  .then((r) => r.json())
  .then(({ floors }) => {
    floorSelectEl.innerHTML =
      `<option value="overworld">🌍 Overworld</option>` + floors.map((n) => `<option value="${n}">Floor ${n}</option>`).join('');
    floorSelectEl.value = currentFloorNumber === 'overworld' ? 'overworld' : String(currentFloorNumber);
  })
  .catch((err) => {
    floorStatusEl.textContent = `Failed to list floors: ${err.message}`;
  });

floorSelectEl.addEventListener('change', () => {
  const val = floorSelectEl.value;
  if (val === 'overworld') loadOverworldMonsters();
  else loadFloor(parseInt(val, 10));
});

function loadOverworldMonsters() {
  currentFloorNumber = 'overworld';
  currentFloorDef = null;
  floorSelectEl.value = 'overworld';
  saveFloorBtnEl.style.display = 'none';
  monListHeadingEl.textContent = 'Monsters In The Overworld';
  selectMonster(null);
  applyMonstersModeVisibility();
  refreshMonsterList();
  floorStatusEl.textContent = world ? `Overworld — ${(world.monsters || []).length} monster(s)` : 'Waiting for world to load…';
}

async function loadFloor(n) {
  try {
    const res = await fetch(`/api/tower/floor/${n}`);
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    currentFloorDef = await res.json();
    currentFloorNumber = n;
    floorSelectEl.value = String(n);
    saveFloorBtnEl.style.display = 'block';
    monListHeadingEl.textContent = 'Monsters On This Floor';
    selectMonster(null);
    rebuildFloorView();
    applyMonstersModeVisibility();
    floorStatusEl.textContent = `Floor ${n} loaded — ${currentFloorDef.monsterSpawns.length} monster(s)`;
  } catch (err) {
    floorStatusEl.textContent = `Failed to load floor ${n}: ${err.message}`;
  }
}

function rebuildFloorView() {
  floorGroup.clear();
  placedMonsters.length = 0;
  if (!currentFloorDef) return;
  const { ground } = buildFloorMeshes(floorGroup, currentFloorDef);
  floorGroundMesh = ground;
  for (const spawn of currentFloorDef.monsterSpawns) {
    const mesh = generateMonster(spawn.type, hashStringToSeed(spawn.id), monsterTypeCatalogById);
    applyMonsterAppearance(mesh, spawn);
    mesh.position.set(spawn.position.x, spawn.position.y || 0, spawn.position.z);
    floorGroup.add(mesh);
    placedMonsters.push({ ref: spawn, mesh });
  }
  toonify(floorGroup); // matches the live game's own buildFloorMeshes+toonify pairing (src/main.js)
  refreshMonsterList();
}

// --- Monster loot table (per placed spawn, not per catalog type — see
// src/sim/tower.js's MonsterSpawnDef doc comment for why). Staged the same
// way Items mode stages statModifiers/craftMaterials: a plain array the
// add/remove buttons mutate directly, read into the ref on place/apply. Not
// reset between placements on purpose — mirrors every other field in this
// form (Max HP, Quest group, etc.), so it carries over for repeated single
// clicks or a scatter-brush pass, and is overwritten by populateMonsterForm
// whenever an existing spawn is selected for editing.
let currentMonsterLootTable = [];

// --- Quest-gated drops (src/sim/lootTables.js's requiresQuestId) -----------
// Shared by BOTH loot editors - Monsters mode's per-placement table and the
// Monster Builder's type-wide one - since a gate means the same thing in
// either, and two copies of this would drift.
const LOOT_QUEST_PHASE_LABEL = { active: 'quest active', ready: 'quest ready', done: 'quest done' };

/** Fills a loot form's quest picker from the authored catalog. A refresh rather than a one-time populate, because a quest can be authored in Events mode long after this form was last drawn. */
function refreshLootQuestOptions(selectId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = '<option value="">- always drops -</option>'
    + questCatalog.map((q) => `<option value="${q.id}">${q.name} (${q.id})</option>`).join('');
  el.value = prev; // survives a refresh as long as that quest still exists
}

/** A loot form's two quest-gate fields, as the LootTableEntry fragment to spread onto a new entry. An empty quest picker contributes nothing, so an ungated entry keeps exactly the shape it has always had. */
function readLootQuestGate(prefix) {
  const questId = document.getElementById(`${prefix}-loot-quest`)?.value || '';
  if (!questId) return {};
  return { requiresQuestId: questId, requiresQuestPhase: document.getElementById(`${prefix}-loot-quest-phase`).value };
}

/** The trailing "[Quest name: quest active]" tag a gated entry shows in a loot list. */
function lootGateSuffix(entry) {
  if (!entry.requiresQuestId) return '';
  const name = questCatalog.find((q) => q.id === entry.requiresQuestId)?.name || entry.requiresQuestId;
  return ` <span class="hint">[${name}: ${LOOT_QUEST_PHASE_LABEL[entry.requiresQuestPhase || 'active']}]</span>`;
}

function refreshMonLootItemOptions() {
  const el = document.getElementById('mon-loot-item');
  const ids = [...ITEM_IDS, ...itemCatalog.map((i) => i.id)];
  el.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
  refreshLootQuestOptions('mon-loot-quest');
}
function refreshMonLootList() {
  const el = document.getElementById('mon-loot-list');
  el.innerHTML = currentMonsterLootTable
    .map((e, i) => `<div><span>${e.itemId} — ${e.dropChance}% (${e.minQty}-${e.maxQty})${lootGateSuffix(e)}</span><button data-remove-mon-loot="${i}">✕</button></div>`)
    .join('') || '<div class="hint">No drops authored.</div>';
}
document.getElementById('mon-loot-add-btn').addEventListener('click', () => {
  const itemId = document.getElementById('mon-loot-item').value;
  const dropChance = parseFloat(document.getElementById('mon-loot-chance').value);
  const minQty = parseInt(document.getElementById('mon-loot-min').value, 10);
  const maxQty = parseInt(document.getElementById('mon-loot-max').value, 10);
  if (!itemId || !Number.isFinite(dropChance) || dropChance < 0 || dropChance > 100) return;
  if (!Number.isInteger(minQty) || minQty < 1 || !Number.isInteger(maxQty) || maxQty < minQty) return;
  currentMonsterLootTable.push({ itemId, dropChance, minQty, maxQty, ...readLootQuestGate('mon') });
  refreshMonLootList();
});
document.getElementById('mon-loot-list').addEventListener('click', (e) => {
  const idx = e.target.dataset.removeMonLoot;
  if (idx === undefined) return;
  currentMonsterLootTable.splice(Number(idx), 1);
  refreshMonLootList();
});
// Not populated here: itemCatalog (Items mode, later in this module) isn't
// initialized yet at this point in top-to-bottom module evaluation — the
// /api/items fetch callback below (Items mode) calls
// refreshMonLootItemOptions() once real data lands, same timing every other
// itemCatalog-dependent picker in this file already relies on.
refreshMonLootList();

function readMonsterFormValues() {
  const xpRewardRaw = document.getElementById('mon-xpReward').value;
  const respawnMsRaw = document.getElementById('mon-respawnMs').value;
  const colorHex = parseInt(document.getElementById('mon-color').value.slice(1), 16);
  return {
    type: document.getElementById('mon-type').value,
    maxHealth: parseFloat(document.getElementById('mon-maxHealth').value) || 1,
    damage: parseFloat(document.getElementById('mon-damage').value) || 0,
    speed: parseFloat(document.getElementById('mon-speed').value) || 0,
    attackCooldownMs: parseFloat(document.getElementById('mon-attackCooldownMs').value) || 100,
    aggroRange: parseFloat(document.getElementById('mon-aggroRange').value) || 1,
    attackRange: parseFloat(document.getElementById('mon-attackRange').value) || 0.5,
    scale: parseFloat(document.getElementById('mon-scale').value) || 1,
    color: colorHex === 0xffffff ? undefined : colorHex, // white = no tint
    isBoss: document.getElementById('mon-isBoss').checked,
    friendly: document.getElementById('mon-friendly').checked,
    xpReward: xpRewardRaw === '' ? undefined : parseFloat(xpRewardRaw), // undefined = auto (formula fallback in src/sim/leveling.js)
    group: document.getElementById('mon-group').value.trim() || undefined, // kill-quest target tag; undefined = untagged
    respawnMs: respawnMsRaw === '' ? undefined : parseFloat(respawnMsRaw), // undefined = 30s default (overworld only, see server/index.js)
    wander: document.getElementById('mon-wander').checked,
    wanderRadius: parseFloat(document.getElementById('mon-wanderRadius').value) || 6,
    lootTable: currentMonsterLootTable.length ? currentMonsterLootTable.map((e) => ({ ...e })) : undefined,
  };
}

function populateMonsterForm(ref) {
  document.getElementById('mon-type').value = ref.type;
  document.getElementById('mon-maxHealth').value = ref.maxHealth;
  document.getElementById('mon-damage').value = ref.damage;
  document.getElementById('mon-speed').value = ref.speed;
  document.getElementById('mon-attackCooldownMs').value = ref.attackCooldownMs;
  document.getElementById('mon-aggroRange').value = ref.aggroRange;
  document.getElementById('mon-attackRange').value = ref.attackRange;
  document.getElementById('mon-scale').value = ref.scale ?? 1;
  document.getElementById('mon-color').value = ref.color !== undefined ? hexToColorString(ref.color) : '#ffffff';
  document.getElementById('mon-isBoss').checked = !!ref.isBoss;
  document.getElementById('mon-friendly').checked = !!ref.friendly;
  document.getElementById('mon-xpReward').value = ref.xpReward ?? '';
  document.getElementById('mon-group').value = ref.group ?? '';
  document.getElementById('mon-respawnMs').value = ref.respawnMs ?? '';
  document.getElementById('mon-wander').checked = !!ref.wander; // absent = stand still, unlike NPCs (whose default is to wander)
  document.getElementById('mon-wanderRadius').value = ref.wanderRadius ?? 6;
  currentMonsterLootTable = (ref.lootTable || []).map((e) => ({ ...e }));
  refreshMonLootList();
}

/** Apply a monster ref's scale/color tint to its already-built mesh (used everywhere a monster mesh is (re)built). */
function applyMonsterAppearance(mesh, ref) {
  mesh.scale.setScalar(ref.scale ?? 1);
  applyColorTint(mesh, ref.color ?? 0xffffff); // 0xffffff resets any prior tint, same convention as prop recoloring
}

/** Which list/group the Monsters mode is currently editing — the overworld's world.monsters, or a tower floor's monsterSpawns. */
function isOverworldMonsters() {
  return currentFloorNumber === 'overworld';
}
function activeMonsterList() {
  return isOverworldMonsters() ? placedOverworldMonsters : placedMonsters;
}
function activeMonsterGroup() {
  return isOverworldMonsters() ? scene : floorGroup;
}

document.getElementById('place-monster-btn').addEventListener('click', () => {
  if (!isOverworldMonsters() && !currentFloorDef) return;
  armedMonsterPlacement = true;
  statusLine.textContent = `Click the ${isOverworldMonsters() ? 'ground' : 'floor'} to place the monster`;
});

/** Everything the monster stat form defines, turned into a spawn ref at `position` — the single source of truth for what a placed monster's fields are, shared by single-click placement and the scatter brush below. */
function buildMonsterRef(stats, position) {
  const seed = Math.floor(Math.random() * 1e9);
  const idPrefix = isOverworldMonsters() ? 'world' : `f${currentFloorNumber}`;
  return {
    id: `${idPrefix}-${stats.type}-${seed}`,
    type: stats.type,
    position: { x: position.x, y: 0, z: position.z },
    maxHealth: stats.maxHealth,
    damage: stats.damage,
    speed: stats.speed,
    aggroRange: stats.aggroRange,
    attackRange: stats.attackRange,
    attackCooldownMs: stats.attackCooldownMs,
    scale: stats.scale,
    ...(stats.color !== undefined ? { color: stats.color } : {}),
    ...(stats.isBoss ? { isBoss: true } : {}),
    ...(stats.friendly ? { friendly: true } : {}),
    ...(stats.xpReward !== undefined ? { xpReward: stats.xpReward } : {}),
    ...(stats.group ? { group: stats.group } : {}),
    ...(stats.respawnMs !== undefined ? { respawnMs: stats.respawnMs } : {}),
    ...(stats.wander ? { wander: true, wanderRadius: stats.wanderRadius } : {}),
    ...(stats.lootTable ? { lootTable: stats.lootTable } : {}),
  };
}

/** Push a ref into world.monsters / currentFloorDef.monsterSpawns, build its mesh, and add both to the active list/scene. Does NOT select or refresh the list — callers that place many at once (the scatter brush) do that once at the end instead of per-instance. */
function spawnMonsterFromRef(ref) {
  if (isOverworldMonsters()) {
    if (!world.monsters) world.monsters = [];
    world.monsters.push(ref);
  } else {
    currentFloorDef.monsterSpawns.push(ref);
  }
  const mesh = generateMonster(ref.type, hashStringToSeed(ref.id), monsterTypeCatalogById);
  applyMonsterAppearance(mesh, ref);
  mesh.position.set(ref.position.x, ref.position.y, ref.position.z);
  toonify(mesh);
  activeMonsterGroup().add(mesh);
  const entry = { ref, mesh };
  activeMonsterList().push(entry);
  return entry;
}

function placeMonsterAt(point) {
  if (!isOverworldMonsters() && !currentFloorDef) return;
  const stats = readMonsterFormValues();
  const ref = buildMonsterRef(stats, { x: snap(point.x), z: snap(point.z) });
  const entry = spawnMonsterFromRef(ref);
  armedMonsterPlacement = false;
  selectMonster(entry);
  refreshMonsterList();
}

// --- MONSTER SCATTER BRUSH: click+drag bulk placement, mirrors prop Scatter mode but reuses the monster stat form above instead of a separate palette/stat set ---
let monsterScatterDragging = false;
let monsterScatterCount = 0;
let lastMonsterScatterTick = 0;
const MONSTER_SCATTER_TICK_MS = 120; // a bit slower than prop scatter's 80ms — monster meshes are heavier to build

const monScatterActiveEl = document.getElementById('mon-scatter-active');
const monScatterRadiusEl = document.getElementById('mon-scatter-radius');
const monScatterDensityEl = document.getElementById('mon-scatter-density');
const monScatterMinSpacingEl = document.getElementById('mon-scatter-min-spacing');
const monScatterEraseAnyEl = document.getElementById('mon-scatter-erase-any');
const monScatterCountEl = document.getElementById('mon-scatter-count');

for (const [input, out] of [
  [monScatterRadiusEl, 'mon-scatter-radius-out'],
  [monScatterDensityEl, 'mon-scatter-density-out'],
]) {
  const el = document.getElementById(out);
  const sync = () => { el.textContent = input.value; };
  input.addEventListener('input', sync);
  sync();
}

/** Remove every placed monster within `radius` of `point`, same shape as clearPropsUnderBrush. */
function clearMonstersUnderBrush(point, radius, onlyType = null) {
  const list = activeMonsterList();
  const toRemove = list.filter(
    (m) => (!onlyType || m.ref.type === onlyType) &&
      Math.hypot(m.mesh.position.x - point.x, m.mesh.position.z - point.z) <= radius
  );
  for (const entry of toRemove) {
    activeMonsterGroup().remove(entry.mesh);
    if (isOverworldMonsters()) {
      world.monsters = (world.monsters || []).filter((m) => m !== entry.ref);
    } else {
      currentFloorDef.monsterSpawns = currentFloorDef.monsterSpawns.filter((m) => m !== entry.ref);
    }
    list.splice(list.indexOf(entry), 1);
    if (selectedMonster === entry) selectMonster(null);
  }
  return toRemove.length;
}

/** One monster-scatter-brush tick: stamp (or, if erasing, remove) several monsters within the brush radius, using whatever the stat form above is currently set to — same fields as a single placed monster (HP, damage, quest group, Friendly, etc). Skips a candidate spot if it lands within minSpacing of an already-placed monster, so a slow drag doesn't stack instances on top of each other. */
function monsterScatterTick(point, erase) {
  if (!isOverworldMonsters() && !currentFloorDef) return;
  const radius = parseFloat(monScatterRadiusEl.value);
  const density = parseInt(monScatterDensityEl.value, 10);

  if (erase) {
    const stats = readMonsterFormValues();
    const removed = clearMonstersUnderBrush(point, radius, monScatterEraseAnyEl.checked ? null : stats.type);
    if (removed) monsterListDirty = true;
    return;
  }

  const stats = readMonsterFormValues();
  const minSpacing = Math.max(0, parseFloat(monScatterMinSpacingEl.value) || 0);
  const list = activeMonsterList();
  let placed = 0;

  for (const [dx, dz] of brushOffsets('scatter', radius, density, 0)) {
    const x = snap(point.x + dx);
    const z = snap(point.z + dz);
    if (minSpacing > 0 && list.some((m) => Math.hypot(m.mesh.position.x - x, m.mesh.position.z - z) < minSpacing)) {
      continue; // too close to an existing monster — skip this spot rather than stacking
    }
    const ref = buildMonsterRef(stats, { x, z });
    spawnMonsterFromRef(ref);
    placed++;
  }

  if (placed > 0) {
    monsterScatterCount += placed;
    monScatterCountEl.textContent = monsterScatterCount;
    monsterListDirty = true;
  }
}

function selectMonster(entry) {
  selectedMonster = entry;
  if (!entry) {
    monSelectedInfoEl.textContent = 'Nothing selected. Click a placed monster.';
    monSelectedControlsEl.style.display = 'none';
    selectionHighlight.visible = false;
    return;
  }
  monSelectedInfoEl.textContent = `${entry.ref.type} — ${entry.ref.id}`;
  monSelectedControlsEl.style.display = 'block';
  populateMonsterForm(entry.ref);
  selectionHighlight.visible = true;
  selectionHighlight.setFromObject(entry.mesh);
}

document.getElementById('apply-monster-btn').addEventListener('click', () => {
  if (!selectedMonster) return;
  const stats = readMonsterFormValues();
  const typeChanged = stats.type !== selectedMonster.ref.type;
  Object.assign(selectedMonster.ref, stats);
  if (!stats.isBoss) delete selectedMonster.ref.isBoss;
  if (!stats.friendly) delete selectedMonster.ref.friendly;
  if (stats.xpReward === undefined) delete selectedMonster.ref.xpReward;
  if (!stats.group) delete selectedMonster.ref.group;
  if (stats.respawnMs === undefined) delete selectedMonster.ref.respawnMs;
  if (stats.color === undefined) delete selectedMonster.ref.color;
  if (!stats.wander) { delete selectedMonster.ref.wander; delete selectedMonster.ref.wanderRadius; }
  if (!stats.lootTable) delete selectedMonster.ref.lootTable;
  if (typeChanged) {
    const group = activeMonsterGroup();
    group.remove(selectedMonster.mesh);
    const mesh = generateMonster(stats.type, hashStringToSeed(selectedMonster.ref.id), monsterTypeCatalogById);
    mesh.position.copy(selectedMonster.mesh.position);
    toonify(mesh);
    group.add(mesh);
    selectedMonster.mesh = mesh;
  }
  applyMonsterAppearance(selectedMonster.mesh, selectedMonster.ref);
  monSelectedInfoEl.textContent = `${selectedMonster.ref.type} — ${selectedMonster.ref.id}`;
  refreshMonsterList();
});

document.getElementById('delete-monster-btn').addEventListener('click', deleteSelectedMonster);

function deleteSelectedMonster() {
  if (!selectedMonster) return;
  if (!isOverworldMonsters() && !currentFloorDef) return;
  activeMonsterGroup().remove(selectedMonster.mesh);
  if (isOverworldMonsters()) {
    world.monsters = (world.monsters || []).filter((m) => m !== selectedMonster.ref);
  } else {
    currentFloorDef.monsterSpawns = currentFloorDef.monsterSpawns.filter((m) => m !== selectedMonster.ref);
  }
  const list = activeMonsterList();
  list.splice(list.indexOf(selectedMonster), 1);
  selectMonster(null);
  refreshMonsterList();
}

function raycastFloorGround() {
  if (!floorGroundMesh) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(floorGroundMesh, false);
  return hits.length > 0 ? hits[0].point : null;
}

function raycastMonsters() {
  raycaster.setFromCamera(pointer, camera);
  const list = activeMonsterList();
  const meshes = list.map((m) => m.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !list.some((m) => m.mesh === obj)) obj = obj.parent;
  return list.find((m) => m.mesh === obj) || null;
}

// Overworld monsters save with the main "Save World to Server" button
// (they're just a field on `world`, like props/buildings) — this button
// only applies to tower floors, and is hidden while viewing the overworld.
document.getElementById('save-floor-btn').addEventListener('click', async () => {
  if (isOverworldMonsters() || !currentFloorDef) return;
  try {
    const res = await fetch(`/api/tower/floor/${currentFloorNumber}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentFloorDef),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `server responded ${res.status}`);
    }
    floorStatusEl.textContent = `Saved floor ${currentFloorNumber} to server ✓`;
  } catch (err) {
    floorStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

function refreshMonsterList() {
  const list = activeMonsterList();
  monCountEl.textContent = list.length;
  monListEl.innerHTML = list
    .map((m, i) => `<div><span>${m.ref.type} — ${m.ref.id}${m.ref.isBoss ? ' 👑' : ''}</span><button data-delete-mon="${i}">✕</button></div>`)
    .join('');
}

monListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deleteMon;
  if (idx === undefined) return;
  const entry = activeMonsterList()[parseInt(idx, 10)];
  if (!entry) return;
  selectMonster(entry);
  deleteSelectedMonster();
});

// --- Monster type catalog (authoring moved to /monsters.html — see src/monster-builder/main.js) ---
// The World Editor still owns PLACEMENT: it fetches the authored catalog so
// Monsters-mode placement markers render each spawn's real body instead of
// falling back to generateSlime, and it upgrades already-placed instances
// once the catalog loads.
let monsterTypeCatalog = [];
let monsterTypeCatalogById = {}; // kept in sync with monsterTypeCatalog — threaded into generateMonster()

fetch('/api/monster-types')
  .then((r) => r.json())
  .then((list) => {
    monsterTypeCatalog = list;
    monsterTypeCatalogById = Object.fromEntries(monsterTypeCatalog.map((mt) => [mt.id, mt]));
    refreshMonTypeDropdown();
    rebuildAll(); // upgrade any already-placed catalog-typed monsters from their fallback slime shape
  })
  .catch((err) => console.error('Failed to load monster type catalog:', err));

// --- Monsters mode integration: #mon-type gains catalog entries alongside the 3 legacy hardcoded types ---
function refreshMonTypeDropdown() {
  const select = document.getElementById('mon-type');
  const current = select.value;
  const legacyOptions = `<option value="slime">Slime</option><option value="goblin">Goblin</option><option value="boss-golem">Boss Golem</option>`;
  const catalogOptions = monsterTypeCatalog.length
    ? `<optgroup label="Monster Builder">${monsterTypeCatalog.map((mt) => `<option value="${mt.id}">${mt.name}</option>`).join('')}</optgroup>`
    : '';
  select.innerHTML = legacyOptions + catalogOptions;
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

// Picking a catalog type pre-fills the stat fields from its baseStats —
// same "pick a saved thing, get sensible defaults, still hand-editable"
// pattern as Place mode's custom-object dropdown. No-op for the 3 legacy
// types (they've never had catalog-backed defaults, nothing to pre-fill).
document.getElementById('mon-type').addEventListener('change', () => {
  const mt = monsterTypeCatalog.find((m) => m.id === document.getElementById('mon-type').value);
  if (!mt) return;
  document.getElementById('mon-maxHealth').value = mt.baseStats.maxHealth;
  document.getElementById('mon-damage').value = mt.baseStats.damage;
  document.getElementById('mon-speed').value = mt.baseStats.speed;
  document.getElementById('mon-attackCooldownMs').value = mt.baseStats.attackCooldownMs;
  document.getElementById('mon-aggroRange').value = mt.baseStats.aggroRange;
  document.getElementById('mon-attackRange').value = mt.baseStats.attackRange;
});

// --- Graphics Settings modal (per-map profile — src/sim/graphicsSettings.js) ---
// Every control writes straight into world.graphicsSettings (no separate
// save step — it rides along with the regular "Save World to Server"
// button, same as mountains/paths/teleporters). Post-Processing tab
// controls also reapply live via applyPostProcessingSettings() since that
// pipeline already reads this exact shape (GFX Phase 1); light/ambient/
// fog/sound/environmental/anisotropy have nothing to reapply INTO yet
// (GFX Phase 3+) so those just persist for now.
const graphicsSettingsModal = createTabbedModal('graphics-settings-modal', [
  { id: 'postfx', label: 'Post-Processing' },
  { id: 'lighting', label: 'Lighting & Fog' },
  { id: 'sky', label: 'Sky' },
  { id: 'ambient', label: 'Ambient & Sound' },
  { id: 'environment', label: 'Environment' },
  { id: 'playercamera', label: 'Player Camera' },
]);
document.getElementById('gfx-close-btn').addEventListener('click', () => graphicsSettingsModal.close());
document.getElementById('open-graphics-settings-btn').addEventListener('click', () => {
  if (!world) return;
  if (!world.graphicsSettings) world.graphicsSettings = defaultGraphicsSettings();
  if (!world.graphicsSettings.playerCamera) world.graphicsSettings.playerCamera = playerCameraOf(null);
  refreshGfxSoundDropdowns();
  populateGraphicsSettingsForm();
  graphicsSettingsModal.open();
});

initGuides();

// --- Camera Controls panel (🎥, next to the ⚙ gear) ---
// Plain show/hide instead of createTabbedModal: one page, no tab strip for
// that helper to drive. Unlike Graphics Settings this writes to localStorage
// via saveCameraPrefs(), not into the world — no map save required, and it
// survives a reload. The 🎥 button toggles, since the panel is meant to stay
// open while you drag the scene around to feel a slider land.
const cameraSettingsModal = document.getElementById('camera-settings-modal');
const CAMERA_SLIDERS = [
  { id: 'cam-rotate-speed', key: 'rotateSpeed', decimals: 2 },
  { id: 'cam-pan-speed', key: 'panSpeed', decimals: 2 },
  { id: 'cam-zoom-speed', key: 'zoomSpeed', decimals: 2 },
  { id: 'cam-damping', key: 'damping', decimals: 2 },
  { id: 'cam-fly-speed', key: 'flySpeed', decimals: 0, unit: ' u/s' },
  { id: 'cam-fly-speed-fast', key: 'flySpeedFast', decimals: 0, unit: ' u/s' },
  { id: 'cam-ground-clearance', key: 'groundClearance', decimals: 1, unit: ' u' },
];
const CAMERA_CHECKBOXES = [
  { id: 'cam-invert-rotate', key: 'invertRotate' },
  { id: 'cam-zoom-to-cursor', key: 'zoomToCursor' },
  { id: 'cam-clamp-ground', key: 'clampToGround' },
];

function populateCameraSettingsForm() {
  for (const { id, key, decimals, unit } of CAMERA_SLIDERS) {
    document.getElementById(id).value = cameraPrefs[key];
    document.getElementById(`${id}-out`).textContent = cameraPrefs[key].toFixed(decimals) + (unit || '');
  }
  for (const { id, key } of CAMERA_CHECKBOXES) document.getElementById(id).checked = cameraPrefs[key];
}

for (const { id, key, decimals, unit } of CAMERA_SLIDERS) {
  document.getElementById(id).addEventListener('input', (e) => {
    cameraPrefs[key] = parseFloat(e.target.value);
    document.getElementById(`${id}-out`).textContent = cameraPrefs[key].toFixed(decimals) + (unit || '');
    applyCameraPrefs();
    saveCameraPrefs();
  });
}
for (const { id, key } of CAMERA_CHECKBOXES) {
  document.getElementById(id).addEventListener('change', (e) => {
    cameraPrefs[key] = e.target.checked;
    applyCameraPrefs();
    saveCameraPrefs();
  });
}
document.getElementById('cam-reset-btn').addEventListener('click', () => {
  Object.assign(cameraPrefs, DEFAULT_CAMERA_PREFS);
  applyCameraPrefs();
  saveCameraPrefs();
  populateCameraSettingsForm();
});
document.getElementById('cam-close-btn').addEventListener('click', () => {
  cameraSettingsModal.style.display = 'none';
});
document.getElementById('open-camera-settings-btn').addEventListener('click', () => {
  if (cameraSettingsModal.style.display === 'flex') {
    cameraSettingsModal.style.display = 'none';
    return;
  }
  populateCameraSettingsForm();
  cameraSettingsModal.style.display = 'flex';
});

function getGfxPath(path) {
  return path.split('.').reduce((o, k) => o[k], world.graphicsSettings);
}
function setGfxPath(path, value) {
  const keys = path.split('.');
  let o = world.graphicsSettings;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

/** liveApply: 'postfx' reapplies the post-processing pipeline, 'atmosphere' reapplies light/ambient/fog, 'particles' rebuilds the map-wide weather layer — see applyLiveGfx below. */
function applyLiveGfx(kind) {
  if (kind === 'postfx') applyPostProcessingSettings(world.graphicsSettings);
  else if (kind === 'atmosphere') {
    applyGraphicsSettingsToAtmosphere(scene, world.graphicsSettings);
    refreshShadowTexelReadout(); // Shadow Range / Resolution both land here
  }
  else if (kind === 'cloudshadows' && groundTextureOverlayMesh) applyCloudShadowSettings(groundTextureOverlayMesh, world.graphicsSettings.postFx.cloudShadows);
  else if (kind === 'particles') {
    rebuildParticles();
    // 'sunrays' is the one environmental type that isn't particles at all — it
    // lives in the post-processing pass AND the sun sprite, so both have to be
    // reapplied or picking it from the dropdown does nothing until reload.
    applyPostProcessingSettings(world.graphicsSettings);
    applyGraphicsSettingsToAtmosphere(scene, world.graphicsSettings);
  }
}

/** Binds a range input (with a paired #${id}-out) or a checkbox to a dotted path under world.graphicsSettings. */
function bindGfxControl(id, path, { decimals, liveApply } = {}) {
  const input = document.getElementById(id);
  const out = document.getElementById(`${id}-out`);
  const isCheckbox = input.type === 'checkbox';
  input.addEventListener(isCheckbox ? 'change' : 'input', () => {
    const value = isCheckbox ? input.checked : parseFloat(input.value);
    setGfxPath(path, value);
    if (out) out.textContent = value.toFixed(decimals ?? 2);
    if (liveApply) applyLiveGfx(liveApply);
  });
}
function bindGfxColorControl(id, path, { liveApply } = {}) {
  const input = document.getElementById(id);
  input.addEventListener('input', () => {
    setGfxPath(path, parseInt(input.value.slice(1), 16));
    if (liveApply) applyLiveGfx(liveApply);
  });
}
function bindGfxSelectControl(id, path, { parse = (v) => v, liveApply } = {}) {
  const input = document.getElementById(id);
  input.addEventListener('change', () => {
    setGfxPath(path, parse(input.value));
    if (liveApply) applyLiveGfx(liveApply);
  });
}

bindGfxControl('gfx-exposure', 'exposure', { liveApply: 'postfx' });
bindGfxControl('gfx-saturation', 'saturation', { liveApply: 'postfx' });
bindGfxControl('gfx-colorfulness', 'colorfulness', { liveApply: 'postfx' });
bindGfxControl('gfx-bloom-enabled', 'postFx.bloom.enabled', { liveApply: 'postfx' });
bindGfxControl('gfx-bloom-strength', 'postFx.bloom.strength', { liveApply: 'postfx' });
bindGfxControl('gfx-bloom-radius', 'postFx.bloom.radius', { liveApply: 'postfx' });
bindGfxControl('gfx-bloom-threshold', 'postFx.bloom.threshold', { liveApply: 'postfx' });
bindGfxControl('gfx-fxaa-enabled', 'postFx.fxaa.enabled', { liveApply: 'postfx' });
bindGfxControl('gfx-sharpen-enabled', 'postFx.sharpen.enabled', { liveApply: 'postfx' });
bindGfxControl('gfx-sharpen-strength', 'postFx.sharpen.strength', { liveApply: 'postfx' });
bindGfxControl('gfx-ssao-enabled', 'postFx.ssao.enabled', { liveApply: 'postfx' });
bindGfxControl('gfx-ssao-intensity', 'postFx.ssao.intensity', { decimals: 1, liveApply: 'postfx' });
bindGfxControl('gfx-dof-enabled', 'postFx.dof.enabled', { liveApply: 'postfx' });
bindGfxControl('gfx-dof-focus', 'postFx.dof.focus', { decimals: 0, liveApply: 'postfx' });
bindGfxControl('gfx-dof-aperture', 'postFx.dof.aperture', { decimals: 6, liveApply: 'postfx' });
bindGfxControl('gfx-dof-maxblur', 'postFx.dof.maxBlur', { decimals: 3, liveApply: 'postfx' });
bindGfxControl('gfx-cloudshadows-enabled', 'postFx.cloudShadows.enabled', { liveApply: 'cloudshadows' });
bindGfxControl('gfx-cloudshadows-strength', 'postFx.cloudShadows.strength', { liveApply: 'cloudshadows' });
bindGfxControl('gfx-cloudshadows-speed', 'postFx.cloudShadows.speed', { decimals: 3, liveApply: 'cloudshadows' });

bindGfxColorControl('gfx-light-color', 'light.color', { liveApply: 'atmosphere' });
bindGfxControl('gfx-light-intensity', 'light.intensity', { liveApply: 'atmosphere' });
bindGfxControl('gfx-light-elevation', 'light.shadowElevationDeg', { decimals: 0, liveApply: 'atmosphere' });
bindGfxControl('gfx-light-azimuth', 'light.shadowAzimuthDeg', { decimals: 0, liveApply: 'atmosphere' });
bindGfxControl('gfx-light-shadowrange', 'light.shadowRange', { decimals: 0, liveApply: 'atmosphere' });
bindGfxSelectControl('gfx-light-shadowmapsize', 'light.shadowMapSize', { parse: (v) => parseInt(v, 10), liveApply: 'atmosphere' });
bindGfxControl('gfx-light-shadowbias', 'light.shadowBias', { decimals: 4, liveApply: 'atmosphere' });
bindGfxControl('gfx-light-shadownormalbias', 'light.shadowNormalBias', { decimals: 3, liveApply: 'atmosphere' });
bindGfxControl('gfx-fog-density', 'fog.density', { decimals: 4, liveApply: 'atmosphere' });
bindGfxColorControl('gfx-fog-color', 'fog.color', { liveApply: 'atmosphere' });

bindGfxColorControl('gfx-ambient-sky', 'ambient.skyColor', { liveApply: 'atmosphere' });
bindGfxColorControl('gfx-ambient-ground', 'ambient.groundColor', { liveApply: 'atmosphere' });
bindGfxControl('gfx-ambient-intensity', 'ambient.intensity', { liveApply: 'atmosphere' });
bindGfxSelectControl('gfx-sound-music', 'sound.defaultMusicId', { parse: (v) => v || null });
bindGfxControl('gfx-sound-music-volume', 'sound.defaultMusicVolume');
bindGfxSelectControl('gfx-sound-ambient', 'sound.defaultAmbientSoundId', { parse: (v) => v || null });
bindGfxControl('gfx-sound-ambient-volume', 'sound.defaultAmbientVolume');

bindGfxSelectControl('gfx-env-type', 'environmental.type', { parse: (v) => v || null, liveApply: 'particles' });
bindGfxControl('gfx-env-intensity', 'environmental.intensity', { liveApply: 'particles' });
// Not routed through applyLiveGfx: ground/path/mountain textures cache
// themselves by theme id (see groundTextureThemes.js) and only read
// currentAnisotropy at creation time, so this can't retroactively refresh
// what's already on screen — it takes effect for textures created from here
// on (placing a new layer, or a reload/map switch).
document.getElementById('gfx-anisotropy').addEventListener('change', (e) => {
  const value = parseInt(e.target.value, 10);
  setGfxPath('anisotropy', value);
  setCurrentAnisotropy(value);
});

document.getElementById('gfx-light-shadowmapsize').innerHTML =
  SHADOW_MAP_SIZES.map((s) => `<option value="${s}">${s} × ${s}</option>`).join('');

// --- Sky tab: custom skybox texture upload (graphicsSettings.sky.textureUrl) ---
// Not routed through bindGfx*: this is a one-off image upload + URL, not a
// slider/color/select bound straight to a form control, so it needs its own
// fetch call (same idiom as the Ground Textures mode upload below).
function refreshSkyPreview() {
  const url = world.graphicsSettings.sky?.textureUrl || null;
  const wrap = document.getElementById('gfx-sky-preview-wrap');
  const img = document.getElementById('gfx-sky-preview');
  const removeBtn = document.getElementById('gfx-sky-remove-btn');
  wrap.style.display = url ? 'block' : 'none';
  removeBtn.style.display = url ? 'block' : 'none';
  if (url) img.src = url;
}

document.getElementById('gfx-sky-upload-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('gfx-sky-upload-file');
  const statusEl = document.getElementById('gfx-sky-upload-status');
  const file = fileInput.files[0];
  if (!file) {
    statusEl.textContent = 'Choose an image file first.';
    return;
  }
  const formData = new FormData();
  formData.append('texture', file);
  statusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/skybox/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    world.graphicsSettings.sky.textureUrl = data.url;
    applyLiveGfx('atmosphere');
    refreshSkyPreview();
    fileInput.value = '';
    statusEl.textContent = 'Uploaded — this map now uses your custom skybox.';
  } catch (err) {
    statusEl.textContent = `Upload failed: ${err.message}`;
  }
});

document.getElementById('gfx-sky-remove-btn').addEventListener('click', () => {
  world.graphicsSettings.sky.textureUrl = null;
  applyLiveGfx('atmosphere');
  refreshSkyPreview();
  document.getElementById('gfx-sky-upload-status').textContent = 'Reverted to the procedural sky.';
});

bindGfxControl('gfx-sky-rotation-speed', 'sky.rotationSpeed', { decimals: 1, liveApply: 'atmosphere' });

// --- Player Camera tab (graphicsSettings.playerCamera) ---
// Not routed through bindGfxControl: the two zoom limits constrain each other
// (a Closest above Furthest would be a world file the sim's validator rejects
// outright), so each one nudges the other rather than being written blindly.
// Nothing live-applies — the editor's camera is a free-fly one, so the only
// way to see these is the Preview button below or the live game.
const PLAYER_CAMERA_SLIDERS = [
  { id: 'gfx-cam-distance', key: 'distance', decimals: 0, unit: ' u' },
  { id: 'gfx-cam-pitch', key: 'pitchDeg', decimals: 0, unit: '°' },
  { id: 'gfx-cam-mindistance', key: 'minDistance', decimals: 1, unit: ' u' },
  { id: 'gfx-cam-maxdistance', key: 'maxDistance', decimals: 1, unit: ' u' },
];

/** Writes one playerCamera field, keeps minDistance <= maxDistance and the default distance inside that range, then re-renders all four readouts. */
function setPlayerCameraField(key, value) {
  const cam = world.graphicsSettings.playerCamera;
  cam[key] = value;
  if (key === 'minDistance') cam.maxDistance = Math.max(cam.maxDistance, value);
  else if (key === 'maxDistance') cam.minDistance = Math.min(cam.minDistance, value);
  // The default view has to be reachable — a 24u default inside a 6..15 range
  // would silently snap to 15 the moment a player arrived.
  cam.distance = Math.min(Math.max(cam.distance, cam.minDistance), cam.maxDistance);
  refreshPlayerCameraControls();
}

/** Pushes world.graphicsSettings.playerCamera into all four sliders + their readouts (both directions of the clamp above can move a slider the user isn't touching). */
function refreshPlayerCameraControls() {
  const cam = world.graphicsSettings.playerCamera;
  for (const { id, key, decimals, unit } of PLAYER_CAMERA_SLIDERS) {
    document.getElementById(id).value = cam[key];
    document.getElementById(`${id}-out`).textContent = cam[key].toFixed(decimals) + unit;
  }
}

for (const { id, key } of PLAYER_CAMERA_SLIDERS) {
  document.getElementById(id).addEventListener('input', (e) => {
    setPlayerCameraField(key, parseFloat(e.target.value));
  });
}

/**
 * Fly the editor's camera to the framing the live game would give a player
 * standing on the spawn point — the only way to judge "Distance 24, Pitch 33"
 * without saving and logging in. Mirrors src/main.js's applySpawnFacing: the
 * camera sits BEHIND a player facing `facingDeg` (theta = facing + PI), the
 * orbit target is a metre up (roughly chest height), and pitch is measured up
 * from the ground.
 */
function previewPlayerCameraFromSpawn() {
  const cam = world.graphicsSettings.playerCamera;
  const usesSpawnPoint = SPAWN_POINT_MAP_TYPES.includes(world.mapType || 'overworld');
  const spawn = usesSpawnPoint
    ? world.spawnPoint
    : { x: (world.bounds.minX + world.bounds.maxX) / 2, z: (world.bounds.minZ + world.bounds.maxZ) / 2, facingDeg: 0 };
  const groundY = sampleTerrainHeight(world, spawn.x, spawn.z);
  const facing = ((spawn.facingDeg || 0) * Math.PI) / 180;
  const phi = Math.PI / 2 - (cam.pitchDeg * Math.PI) / 180;
  const offset = new THREE.Vector3().setFromSphericalCoords(cam.distance, phi, facing + Math.PI);
  controls.target.set(spawn.x, groundY + 1, spawn.z);
  camera.position.copy(controls.target).add(offset);
  controls.update();
  statusLine.textContent = `Previewing the player camera at ${cam.distance} u / ${cam.pitchDeg}° over ${usesSpawnPoint ? 'the spawn point' : 'the map centre'}.`;
}
document.getElementById('gfx-cam-preview-btn').addEventListener('click', previewPlayerCameraFromSpawn);

/**
 * Shadow Range and Shadow Resolution only matter as a ratio, and neither
 * number tells you what you actually get — so state it: how much world one
 * shadow pixel covers, and how many pixels wide that leaves a character.
 * A ~1m-wide character at 3 pixels reads as a blob that changes shape as
 * they walk; the static world doesn't, because the frustum is snapped to
 * this grid (atmosphere.js's snapShadowFocusToTexelGrid) while a moving
 * character slides across it.
 */
function refreshShadowTexelReadout() {
  const out = document.getElementById('gfx-shadow-texel-out');
  if (!out || !world?.graphicsSettings) return;
  const texel = shadowTexelSize(world.graphicsSettings.light);
  const acrossCharacter = 1.0 / texel; // a class body measures ~1m across the shoulders
  out.textContent = `${texel.toFixed(3)} m/pixel — a character is ~${acrossCharacter.toFixed(1)} shadow pixels wide`;
  out.style.color = acrossCharacter >= 10 ? '#8fd18f' : acrossCharacter >= 5 ? '#d8c98f' : '#d18f8f';
}

function refreshGfxSoundDropdowns() {
  const music = audioCatalog.filter((a) => a.kind === 'music');
  const ambient = audioCatalog.filter((a) => a.kind === 'ambient');
  document.getElementById('gfx-sound-music').innerHTML = '<option value="">— none —</option>' + music.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
  document.getElementById('gfx-sound-ambient').innerHTML = '<option value="">— none —</option>' + ambient.map((a) => `<option value="${a.id}">${a.name}</option>`).join('');
}

/** Reads world.graphicsSettings into every control in the modal — called on open, and by switchToMap while the modal happens to be open across a map switch. */
function populateGraphicsSettingsForm() {
  const g = world.graphicsSettings;
  const setRange = (id, value, decimals = 2) => {
    document.getElementById(id).value = value;
    const out = document.getElementById(`${id}-out`);
    if (out) out.textContent = value.toFixed(decimals);
  };
  const setCheck = (id, value) => { document.getElementById(id).checked = value; };
  const setColor = (id, value) => { document.getElementById(id).value = hexToColorString(value); };
  const setSelect = (id, value) => { document.getElementById(id).value = value ?? ''; };

  setRange('gfx-exposure', g.exposure);
  setRange('gfx-saturation', g.saturation);
  setRange('gfx-colorfulness', g.colorfulness);
  setCheck('gfx-bloom-enabled', g.postFx.bloom.enabled);
  setRange('gfx-bloom-strength', g.postFx.bloom.strength);
  setRange('gfx-bloom-radius', g.postFx.bloom.radius);
  setRange('gfx-bloom-threshold', g.postFx.bloom.threshold);
  setCheck('gfx-fxaa-enabled', g.postFx.fxaa.enabled);
  setCheck('gfx-sharpen-enabled', g.postFx.sharpen.enabled);
  setRange('gfx-sharpen-strength', g.postFx.sharpen.strength);
  setCheck('gfx-ssao-enabled', g.postFx.ssao.enabled);
  setRange('gfx-ssao-intensity', g.postFx.ssao.intensity, 1);
  setCheck('gfx-dof-enabled', g.postFx.dof.enabled);
  setRange('gfx-dof-focus', g.postFx.dof.focus, 0);
  setRange('gfx-dof-aperture', g.postFx.dof.aperture, 6);
  setRange('gfx-dof-maxblur', g.postFx.dof.maxBlur, 3);
  setCheck('gfx-cloudshadows-enabled', g.postFx.cloudShadows.enabled);
  setRange('gfx-cloudshadows-strength', g.postFx.cloudShadows.strength);
  setRange('gfx-cloudshadows-speed', g.postFx.cloudShadows.speed, 3);

  setColor('gfx-light-color', g.light.color);
  setRange('gfx-light-intensity', g.light.intensity);
  setRange('gfx-light-elevation', g.light.shadowElevationDeg, 0);
  setRange('gfx-light-azimuth', g.light.shadowAzimuthDeg, 0);
  setRange('gfx-light-shadowrange', g.light.shadowRange, 0);
  // Maps saved before shadowMapSize existed have no value — write the
  // fallback back into the settings so the dropdown isn't blank and the
  // field persists on the next save (see graphicsSettings.js on why
  // validation treats it as optional rather than requiring a migration).
  if (!g.light.shadowMapSize) g.light.shadowMapSize = DEFAULT_SHADOW_MAP_SIZE;
  setSelect('gfx-light-shadowmapsize', g.light.shadowMapSize);
  refreshShadowTexelReadout();
  setRange('gfx-light-shadowbias', g.light.shadowBias, 4);
  setRange('gfx-light-shadownormalbias', g.light.shadowNormalBias, 3);
  setRange('gfx-fog-density', g.fog.density, 4);
  setColor('gfx-fog-color', g.fog.color);

  // Same story as shadowMapSize/playerCamera — write the default back in so
  // a map saved before this field (or before rotationSpeed was added to it)
  // existed persists it on the next save.
  if (!g.sky) g.sky = { textureUrl: null, rotationSpeed: 0 };
  if (g.sky.rotationSpeed === undefined) g.sky.rotationSpeed = 0;
  setRange('gfx-sky-rotation-speed', g.sky.rotationSpeed, 1);
  refreshSkyPreview();

  setColor('gfx-ambient-sky', g.ambient.skyColor);
  setColor('gfx-ambient-ground', g.ambient.groundColor);
  setRange('gfx-ambient-intensity', g.ambient.intensity);
  setSelect('gfx-sound-music', g.sound.defaultMusicId);
  if (g.sound.defaultMusicVolume === undefined) g.sound.defaultMusicVolume = 1;
  setRange('gfx-sound-music-volume', g.sound.defaultMusicVolume);
  setSelect('gfx-sound-ambient', g.sound.defaultAmbientSoundId);
  if (g.sound.defaultAmbientVolume === undefined) g.sound.defaultAmbientVolume = 1;
  setRange('gfx-sound-ambient-volume', g.sound.defaultAmbientVolume);

  setSelect('gfx-env-type', g.environmental.type);
  setRange('gfx-env-intensity', g.environmental.intensity);
  setSelect('gfx-anisotropy', g.anisotropy);

  // Same story as shadowMapSize above — write the defaults back in so a map
  // saved before this block existed persists it on the next save.
  if (!g.playerCamera) g.playerCamera = playerCameraOf(null);
  refreshPlayerCameraControls();
}

// --- ITEMS MODE ---
// Authoring only (see the hint text in the panel): this builds a catalog of
// gear/weapon/consumable/quest items with icons, but nothing in the live
// game grants, equips, or applies stats/usage from them yet — see
// src/sim/authoredItems.js for why that's deliberately out of scope for
// this pass. Dropdown option sets (armor types, equip slots, stat ids,
// usage modes, weapon types, buff stats) all come straight from the sim
// schema modules — never re-listed here — so the editor can't drift out of
// sync with what the server actually validates.
const itemIdEl = document.getElementById('item-id');
const itemNameEl = document.getElementById('item-name');
const itemTypeEl = document.getElementById('item-type');
const itemRarityEl = document.getElementById('item-rarity');
const itemArmorSectionEl = document.getElementById('item-armor-section');
const itemArmorTypeEl = document.getElementById('item-armor-type');
const itemWeaponSectionEl = document.getElementById('item-weapon-section');
const itemWeaponTypeEl = document.getElementById('item-weapon-type');
const itemSlotSectionEl = document.getElementById('item-slot-section');
const itemSlotEl = document.getElementById('item-slot');
const itemTintSectionEl = document.getElementById('item-tint-section');
const itemTintColorEl = document.getElementById('item-tint-color');
const itemDescriptionEl = document.getElementById('item-description');
const itemSellPriceEl = document.getElementById('item-sellPrice');
const itemQuestLockedEl = document.getElementById('item-quest-locked');
const itemStatsSectionEl = document.getElementById('item-stats-section');
const itemStatModListEl = document.getElementById('item-statmod-list');
const itemStatModStatEl = document.getElementById('item-statmod-stat');
const itemStatModValueEl = document.getElementById('item-statmod-value');
const itemStatModPctEl = document.getElementById('item-statmod-pct');
const itemConsumableSectionEl = document.getElementById('item-consumable-section');
const itemUsageModeEl = document.getElementById('item-usage-mode');
const itemChargesLabelEl = document.getElementById('item-charges-label');
const itemUsageChargesEl = document.getElementById('item-usage-charges');
const itemUsageCooldownEl = document.getElementById('item-usage-cooldown');
const itemEffectKindEl = document.getElementById('item-effect-kind');
const itemEffectStatSectionEl = document.getElementById('item-effect-stat-section');
const itemEffectStatEl = document.getElementById('item-effect-stat');
const itemEffectAmountLabelEl = document.getElementById('item-effect-amount-label');
const itemEffectAmountEl = document.getElementById('item-effect-amount');
const itemEffectDurationSectionEl = document.getElementById('item-effect-duration-section');
const itemEffectDurationEl = document.getElementById('item-effect-duration');
const itemCraftableEnabledEl = document.getElementById('item-craftable-enabled');
const itemCraftSectionEl = document.getElementById('item-craft-section');
const itemCraftListEl = document.getElementById('item-craft-list');
const itemCraftMaterialEl = document.getElementById('item-craft-material');
const itemCraftQtyEl = document.getElementById('item-craft-qty');
const itemIconPreviewEl = document.getElementById('item-icon-preview');
const itemIconFileEl = document.getElementById('item-icon-file');
const itemIconStatusEl = document.getElementById('item-icon-status');
const itemListEl = document.getElementById('item-list');
const itemCountEl = document.getElementById('item-count');

let itemCatalog = [];
let editingItemId = null; // null = the form describes a new item; otherwise the id of the catalog entry currently loaded
let pendingIconUrl = null; // set once an icon upload succeeds, applied to the item on save
let currentStatModifiers = []; // [{stat, value, isPercentage}] — staged for the item currently in the form
let currentCraftMaterials = []; // [{itemId, qty}] — staged craftable recipe for the item currently in the form

itemArmorTypeEl.innerHTML = ARMOR_TYPES.map((t) => `<option value="${t}">${t[0].toUpperCase()}${t.slice(1)}</option>`).join('');
itemWeaponTypeEl.innerHTML = WEAPON_TYPES.map((w) => `<option value="${w.id}">${w.name} (${w.hands}H, ${w.slot})</option>`).join('');
itemSlotEl.innerHTML = EQUIP_SLOTS.map((s) => `<option value="${s}">${s}</option>`).join('');
itemStatModStatEl.innerHTML = ITEM_STAT_IDS.map((s) => `<option value="${s}">${s}</option>`).join('');
itemUsageModeEl.innerHTML = CONSUMABLE_USAGE_MODES.map((m) => `<option value="${m}">${m}</option>`).join('');
itemEffectStatEl.innerHTML = BUFF_STATS.map((s) => `<option value="${s}">${s}</option>`).join('');

function updateItemEffectSectionVisibility() {
  const kind = itemEffectKindEl.value;
  itemEffectStatSectionEl.style.display = kind === 'buff' ? '' : 'none';
  itemEffectDurationSectionEl.style.display = kind === 'buff' ? '' : 'none';
  itemEffectAmountLabelEl.textContent = kind === 'restoreHealth' ? 'Health restored'
    : kind === 'restoreMana' ? 'Mana restored'
    : 'Amount';
}
itemEffectKindEl.addEventListener('change', updateItemEffectSectionVisibility);

// Three starter armor looks (tint color + a small representative stat
// spread) — "load, then tweak and save under a new id," per Dennis's ask.
// Not visual presets in any rendered sense (gear doesn't render on the
// character model yet) — just a faster starting point than a blank form.
const ARMOR_PRESETS = {
  cloth: {
    name: 'Cloth Robe', rarity: 'common', armorType: 'cloth', tintColor: '#3a5a8a',
    description: 'Light woven cloth — favors casters, offers little physical protection.',
    statModifiers: [{ stat: 'armor', value: 4 }, { stat: 'INT', value: 3 }],
  },
  leather: {
    name: 'Leather Tunic', rarity: 'common', armorType: 'leather', tintColor: '#6b4423',
    description: 'Tanned hide armor — balanced protection for agile fighters.',
    statModifiers: [{ stat: 'armor', value: 10 }, { stat: 'AGI', value: 3 }],
  },
  plate: {
    name: 'Plate Chestpiece', rarity: 'common', armorType: 'plate', tintColor: '#9099a8',
    description: 'Heavy forged plate — maximum protection, favors front-line tanks.',
    statModifiers: [{ stat: 'armor', value: 22 }, { stat: 'STR', value: 3 }, { stat: 'VIT', value: 2 }],
  },
};

function applyArmorPreset(preset) {
  itemTypeEl.value = 'armor';
  itemNameEl.value = preset.name;
  itemRarityEl.value = preset.rarity;
  itemArmorTypeEl.value = preset.armorType;
  itemTintColorEl.value = preset.tintColor;
  itemDescriptionEl.value = preset.description;
  currentStatModifiers = preset.statModifiers.map((m) => ({ ...m }));
  refreshStatModList();
  updateItemSectionVisibility();
}
document.getElementById('item-preset-cloth').addEventListener('click', () => applyArmorPreset(ARMOR_PRESETS.cloth));
document.getElementById('item-preset-leather').addEventListener('click', () => applyArmorPreset(ARMOR_PRESETS.leather));
document.getElementById('item-preset-plate').addEventListener('click', () => applyArmorPreset(ARMOR_PRESETS.plate));

function updateItemSectionVisibility() {
  const type = itemTypeEl.value;
  itemArmorSectionEl.style.display = type === 'armor' ? '' : 'none';
  itemWeaponSectionEl.style.display = type === 'weapon' ? '' : 'none';
  itemSlotSectionEl.style.display = type === 'weapon' || type === 'armor' ? '' : 'none';
  itemTintSectionEl.style.display = type === 'weapon' || type === 'armor' ? '' : 'none';
  itemStatsSectionEl.style.display = type === 'weapon' || type === 'armor' ? '' : 'none';
  itemConsumableSectionEl.style.display = type === 'consumable' ? '' : 'none';
}
itemTypeEl.addEventListener('change', updateItemSectionVisibility);

function updateUsageModeVisibility() {
  const showCharges = itemUsageModeEl.value === 'charges';
  itemChargesLabelEl.style.display = showCharges ? '' : 'none';
  itemUsageChargesEl.style.display = showCharges ? '' : 'none';
}
itemUsageModeEl.addEventListener('change', updateUsageModeVisibility);

itemCraftableEnabledEl.addEventListener('change', () => {
  itemCraftSectionEl.style.display = itemCraftableEnabledEl.checked ? '' : 'none';
});

function refreshStatModList() {
  itemStatModListEl.innerHTML = currentStatModifiers
    .map((m, i) => `<div><span>${m.stat}: ${m.value}${m.isPercentage ? '%' : ''}</span><button data-remove-statmod="${i}">✕</button></div>`)
    .join('');
}
document.getElementById('item-statmod-add-btn').addEventListener('click', () => {
  const stat = itemStatModStatEl.value;
  const value = parseFloat(itemStatModValueEl.value);
  if (!stat || !Number.isFinite(value)) return;
  currentStatModifiers.push({ stat, value, isPercentage: itemStatModPctEl.checked });
  itemStatModValueEl.value = '';
  itemStatModPctEl.checked = false;
  refreshStatModList();
});
itemStatModListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.removeStatmod;
  if (idx === undefined) return;
  currentStatModifiers.splice(Number(idx), 1);
  refreshStatModList();
});

// The craftable-material picker offers both hardcoded gathering/crafting
// materials (src/sim/items.js) and other authored items — this catalog is
// referenced loosely (no cross-file id validation, same as e.g. quest
// reward item ids elsewhere in this editor), since it's authoring-only
// prep for a crafting system that doesn't exist yet.
function refreshCraftMaterialOptions() {
  const ids = [...ITEM_IDS, ...itemCatalog.map((i) => i.id)];
  itemCraftMaterialEl.innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
}
function refreshCraftList() {
  itemCraftListEl.innerHTML = currentCraftMaterials
    .map((m, i) => `<div><span>${m.itemId} x${m.qty}</span><button data-remove-craft="${i}">✕</button></div>`)
    .join('');
}
document.getElementById('item-craft-add-btn').addEventListener('click', () => {
  const materialId = itemCraftMaterialEl.value;
  const qty = parseInt(itemCraftQtyEl.value, 10);
  if (!materialId || !Number.isInteger(qty) || qty <= 0) return;
  currentCraftMaterials.push({ itemId: materialId, qty });
  refreshCraftList();
});
itemCraftListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.removeCraft;
  if (idx === undefined) return;
  currentCraftMaterials.splice(Number(idx), 1);
  refreshCraftList();
});

/**
 * Every picker in this editor that lists item ids. Authoring a new item used
 * to populate only the two pickers that happened to sit next to the save
 * button, so a brand-new item was missing from monster loot tables, recipe
 * outputs, and quest/event reward rows until the whole page was reloaded —
 * which is exactly the "need to refresh the entire editor to see new items"
 * report. Anything that offers an item id belongs in here.
 *
 * Called on catalog load, after every item save/delete, and on entering a
 * mode that shows one of these pickers.
 */
function refreshItemDependentPickers() {
  refreshCraftMaterialOptions();
  refreshMonLootItemOptions();
  refreshMbLootItemOptions(); // the Monster Builder's type-level loot picker
  populateRecipeDropdowns();
  populateEventQuestDropdowns(); // Events mode's own quest form has an item picker too
  // Reward/reagent rows rebuild their <select> options from scratch on each
  // render (renderRewardItemRows), so re-rendering the open ones is enough.
  renderQuestRewardItems();
  renderRecipeReagents();
  renderEventQuestRewardItems();
}

fetch('/api/items')
  .then((r) => r.json())
  .then((items) => {
    itemCatalog = items;
    refreshItemList();
    refreshItemDependentPickers();
  })
  .catch((err) => {
    itemIconStatusEl.textContent = `Failed to load item catalog: ${err.message}`;
  });

function clearItemForm() {
  editingItemId = null;
  pendingIconUrl = null;
  itemIdEl.value = '';
  itemIdEl.disabled = false;
  itemNameEl.value = '';
  itemTypeEl.value = 'weapon';
  itemRarityEl.value = 'common';
  itemArmorTypeEl.value = ARMOR_TYPES[0];
  itemWeaponTypeEl.value = WEAPON_TYPES[0]?.id || '';
  itemSlotEl.value = EQUIP_SLOTS[0];
  itemTintColorEl.value = '#8a5a3a';
  itemDescriptionEl.value = '';
  itemSellPriceEl.value = 0;
  itemQuestLockedEl.checked = false;
  currentStatModifiers = [];
  refreshStatModList();
  itemUsageModeEl.value = 'single';
  updateUsageModeVisibility();
  itemUsageChargesEl.value = '';
  itemUsageCooldownEl.value = 0;
  itemEffectKindEl.value = '';
  itemEffectStatEl.value = '';
  itemEffectAmountEl.value = '';
  itemEffectDurationEl.value = '';
  updateItemEffectSectionVisibility();
  itemCraftableEnabledEl.checked = false;
  currentCraftMaterials = [];
  refreshCraftList();
  itemCraftSectionEl.style.display = 'none';
  itemIconPreviewEl.style.display = 'none';
  itemIconPreviewEl.src = '';
  itemIconFileEl.value = '';
  itemIconStatusEl.textContent = '';
  updateItemSectionVisibility();
}
clearItemForm();

function loadItemIntoForm(item) {
  editingItemId = item.id;
  pendingIconUrl = item.iconUrl || null;
  itemIdEl.value = item.id;
  itemIdEl.disabled = true; // id is the stable key an existing item is saved/deleted under — don't let it drift
  itemNameEl.value = item.name;
  itemTypeEl.value = item.type;
  itemRarityEl.value = item.rarity;
  itemArmorTypeEl.value = item.armorType || ARMOR_TYPES[0];
  itemWeaponTypeEl.value = item.weaponTypeId || (WEAPON_TYPES[0]?.id || '');
  itemSlotEl.value = item.slot || EQUIP_SLOTS[0];
  itemTintColorEl.value = item.tintColor !== undefined ? `#${item.tintColor.toString(16).padStart(6, '0')}` : '#8a5a3a';
  itemDescriptionEl.value = item.description || '';
  itemSellPriceEl.value = item.sellPrice ?? 0;
  itemQuestLockedEl.checked = !!item.questLocked;
  currentStatModifiers = (item.statModifiers || []).map((m) => ({ ...m }));
  refreshStatModList();
  const usage = item.usageConfig || {};
  itemUsageModeEl.value = usage.mode || 'single';
  updateUsageModeVisibility();
  itemUsageChargesEl.value = usage.chargesMax ?? '';
  itemUsageCooldownEl.value = usage.cooldownSeconds ?? 0;
  const trigger = usage.effectTrigger || {};
  // Pre-2026-07-24 authored items have no `kind` field — infer 'buff' the
  // same way src/sim/authoredItems.js's validator does, so an old item
  // still shows correctly instead of silently dropping to "none".
  itemEffectKindEl.value = trigger.kind || (trigger.stat ? 'buff' : '');
  itemEffectStatEl.value = trigger.stat || '';
  itemEffectAmountEl.value = trigger.amount ?? '';
  itemEffectDurationEl.value = trigger.durationSeconds ?? '';
  updateItemEffectSectionVisibility();
  itemCraftableEnabledEl.checked = !!item.craftable;
  currentCraftMaterials = (item.craftable?.materials || []).map((m) => ({ ...m }));
  refreshCraftList();
  itemCraftSectionEl.style.display = item.craftable ? '' : 'none';
  itemIconFileEl.value = '';
  if (item.iconUrl) {
    itemIconPreviewEl.src = item.iconUrl;
    itemIconPreviewEl.style.display = 'block';
  } else {
    itemIconPreviewEl.style.display = 'none';
  }
  itemIconStatusEl.textContent = '';
  updateItemSectionVisibility();
}

document.getElementById('new-item-btn').addEventListener('click', clearItemForm);

itemIconFileEl.addEventListener('change', async () => {
  const file = itemIconFileEl.files[0];
  if (!file) return;
  itemIconStatusEl.textContent = 'Uploading…';
  try {
    const formData = new FormData();
    formData.append('icon', file);
    const res = await fetch('/api/items/icon', { method: 'POST', body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `server responded ${res.status}`);
    }
    const { url } = await res.json();
    pendingIconUrl = url;
    itemIconPreviewEl.src = url;
    itemIconPreviewEl.style.display = 'block';
    itemIconStatusEl.textContent = 'Uploaded ✓ — click Save to attach it to this item.';
  } catch (err) {
    itemIconStatusEl.textContent = `Upload failed: ${err.message}`;
  }
});

async function saveItemCatalog() {
  const res = await fetch('/api/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(itemCatalog),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `server responded ${res.status}`);
  }
}

document.getElementById('save-item-btn').addEventListener('click', async () => {
  const id = itemIdEl.value.trim();
  if (!id) {
    itemIconStatusEl.textContent = 'Item id is required.';
    return;
  }
  const name = itemNameEl.value.trim();
  if (!name) {
    itemIconStatusEl.textContent = 'Item name is required.';
    return;
  }

  const type = itemTypeEl.value;
  const item = {
    id,
    name,
    type,
    rarity: itemRarityEl.value,
    description: itemDescriptionEl.value.trim() || undefined,
    sellPrice: parseFloat(itemSellPriceEl.value) || 0,
    questLocked: itemQuestLockedEl.checked || undefined,
    ...(pendingIconUrl ? { iconUrl: pendingIconUrl } : {}),
  };

  if (type === 'weapon' || type === 'armor') {
    item.slot = itemSlotEl.value;
    item.tintColor = parseInt(itemTintColorEl.value.replace('#', ''), 16);
    if (currentStatModifiers.length) item.statModifiers = currentStatModifiers.map((m) => ({ ...m }));
  }
  if (type === 'armor') item.armorType = itemArmorTypeEl.value;
  if (type === 'weapon') item.weaponTypeId = itemWeaponTypeEl.value;

  if (type === 'consumable') {
    const usageConfig = { mode: itemUsageModeEl.value, cooldownSeconds: parseFloat(itemUsageCooldownEl.value) || 0 };
    if (usageConfig.mode === 'charges') usageConfig.chargesMax = parseInt(itemUsageChargesEl.value, 10) || 1;
    const effectKind = itemEffectKindEl.value;
    if (effectKind) {
      usageConfig.effectTrigger = { kind: effectKind, amount: parseFloat(itemEffectAmountEl.value) || 0 };
      if (effectKind === 'buff') {
        usageConfig.effectTrigger.stat = itemEffectStatEl.value;
        usageConfig.effectTrigger.durationSeconds = parseFloat(itemEffectDurationEl.value) || 0;
      }
    }
    item.usageConfig = usageConfig;
  }

  if (itemCraftableEnabledEl.checked && currentCraftMaterials.length) {
    item.craftable = { materials: currentCraftMaterials.map((m) => ({ ...m })) };
  }

  if (editingItemId) {
    const idx = itemCatalog.findIndex((i) => i.id === editingItemId);
    if (idx >= 0) itemCatalog[idx] = item;
  } else {
    if (itemCatalog.some((i) => i.id === id)) {
      itemIconStatusEl.textContent = `An item with id "${id}" already exists — click it in the catalog to edit instead.`;
      return;
    }
    itemCatalog.push(item);
  }

  try {
    await saveItemCatalog();
    itemIconStatusEl.textContent = 'Saved ✓';
    loadItemIntoForm(item);
    refreshItemList();
    refreshItemDependentPickers(); // a new item is immediately pickable everywhere, no page reload
  } catch (err) {
    itemIconStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

function refreshItemList() {
  itemCountEl.textContent = itemCatalog.length;
  itemListEl.innerHTML = itemCatalog
    .map(
      (item) =>
        `<div><span>${item.name} <span class="hint">(${item.type}/${item.rarity})</span></span><button data-edit-item="${item.id}">✎</button><button data-delete-item="${item.id}">✕</button></div>`
    )
    .join('');
}

itemListEl.addEventListener('click', async (e) => {
  const editId = e.target.dataset.editItem;
  const deleteId = e.target.dataset.deleteItem;
  if (editId !== undefined) {
    const item = itemCatalog.find((i) => i.id === editId);
    if (item) loadItemIntoForm(item);
    return;
  }
  if (deleteId !== undefined) {
    const removed = itemCatalog;
    itemCatalog = itemCatalog.filter((i) => i.id !== deleteId);
    try {
      await saveItemCatalog();
      refreshItemList();
      refreshItemDependentPickers(); // a deleted item disappears from every picker too
      if (editingItemId === deleteId) clearItemForm();
    } catch (err) {
      itemCatalog = removed; // save failed — don't leave the in-memory list ahead of what's on disk
      itemIconStatusEl.textContent = `Delete failed: ${err.message}`;
    }
  }
});

// --- NPCS MODE ---
// Overworld town NPCs (world.npcs). Mirrors the overworld-monster editing
// flow: place on the ground, click to select, edit fields + Apply, delete.
// Saved with the main Save World button (they live on the world object).
let characterTypeCatalog = []; // rows from /api/character-types — both kind:'character' (classes) and kind:'npc' (townsfolk prefabs), same catalog buildPlayerCharacter reads live-game-side
const npcBodyEl = document.getElementById('npc-body');

function refreshNpcBodySelect() {
  const prevValue = npcBodyEl.value;
  npcBodyEl.innerHTML = characterTypeCatalog
    .map((c) => `<option value="${c.id}">${c.name} (${c.kind})</option>`)
    .join('');
  if (characterTypeCatalog.some((c) => c.id === prevValue)) npcBodyEl.value = prevValue;
}

fetch('/api/character-types')
  .then((r) => r.json())
  .then((list) => {
    characterTypeCatalog = list;
    refreshNpcBodySelect();
    rebuildAll(); // upgrade already-placed NPCs from the CHARACTER_PRESETS fallback to their real authored body
  })
  .catch((err) => console.error('Failed to load character type catalog:', err));

const npcNameEl = document.getElementById('npc-name');
const npcGenderEl = document.getElementById('npc-gender');
const npcDialogEl = document.getElementById('npc-dialog');
const npcWanderEl = document.getElementById('npc-wander');
const npcWanderRadiusEl = document.getElementById('npc-wanderRadius');
const npcSpeedEl = document.getElementById('npc-speed');
const npcFacingEl = document.getElementById('npc-facing');
const npcHeightEl = document.getElementById('npc-height');
const npcSelectedInfoEl = document.getElementById('npc-selected-info');
const npcSelectedControlsEl = document.getElementById('npc-selected-controls');
const npcListEl = document.getElementById('npc-list');
const npcCountEl = document.getElementById('npc-count');

let npcFormSeed = Math.floor(Math.random() * 1e9); // reroll target for a new NPC's look

document.getElementById('npc-randomize-btn').addEventListener('click', () => {
  npcFormSeed = Math.floor(Math.random() * 1e9);
  // If an NPC is selected, reroll its look live so you can see the change.
  if (selectedNpc) {
    selectedNpc.ref.appearance = buildAppearanceFromForm();
    replaceNpcMesh(selectedNpc);
  }
});

/** Appearance object from the form: which catalog body to render, a seed (drives hair/colors), plus an optional gender override. */
function buildAppearanceFromForm() {
  const appearance = { seed: npcFormSeed };
  if (npcBodyEl.value) appearance.classId = npcBodyEl.value;
  if (npcGenderEl.value !== 'random') appearance.gender = npcGenderEl.value;
  return appearance;
}

function dialogLinesFromForm() {
  return npcDialogEl.value.split('\n').map((l) => l.trim()).filter(Boolean);
}

// --- Branching dialog tree editing (NPCs mode's "Branching" dialog toggle) ---
// A structured list-of-nodes form, not a visual node-graph canvas — each
// node is text + a repeatable list of choices (text + "then go to" node +
// optional "also accept this quest"). The FIRST node in the list is always
// the tree's start (no separate start-picker to keep this simpler).
let npcDialogMode = 'simple'; // 'simple' | 'tree'
let npcDialogTreeDraft = { nodes: [] }; // working copy while a Tree-mode NPC is selected/being placed
let selectedDialogNodeId = null;
const npcDialogModeSimpleBtn = document.getElementById('npc-dialog-mode-simple');
const npcDialogModeTreeBtn = document.getElementById('npc-dialog-mode-tree');
const npcDialogSimpleControlsEl = document.getElementById('npc-dialog-simple-controls');
const npcDialogTreeControlsEl = document.getElementById('npc-dialog-tree-controls');
const npcDialogNodeListEl = document.getElementById('npc-dialog-node-list');
const npcDialogNodeEditorEl = document.getElementById('npc-dialog-node-editor');
const npcDialogNodeTextEl = document.getElementById('npc-dialog-node-text');
const npcDialogChoiceListEl = document.getElementById('npc-dialog-choice-list');

function setNpcDialogMode(newMode) {
  npcDialogMode = newMode;
  npcDialogModeSimpleBtn.classList.toggle('active', newMode === 'simple');
  npcDialogModeTreeBtn.classList.toggle('active', newMode === 'tree');
  npcDialogSimpleControlsEl.style.display = newMode === 'simple' ? 'block' : 'none';
  npcDialogTreeControlsEl.style.display = newMode === 'tree' ? 'block' : 'none';
}
npcDialogModeSimpleBtn.addEventListener('click', () => setNpcDialogMode('simple'));
npcDialogModeTreeBtn.addEventListener('click', () => setNpcDialogMode('tree'));

function selectDialogNode(id) {
  selectedDialogNodeId = id;
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === id);
  npcDialogNodeEditorEl.style.display = node ? 'block' : 'none';
  if (node) npcDialogNodeTextEl.value = node.text || '';
  refreshDialogNodeList();
  refreshDialogChoiceList();
}

function refreshDialogNodeList() {
  npcDialogNodeListEl.innerHTML = npcDialogTreeDraft.nodes
    .map((n, i) => {
      const activeClass = n.id === selectedDialogNodeId ? ' class="active"' : '';
      const preview = (n.text || '').slice(0, 26) || '(empty)';
      return `<div${activeClass}><span data-select-node="${n.id}">${i === 0 ? '▶ ' : ''}${preview}</span><button data-delete-node="${n.id}">✕</button></div>`;
    })
    .join('');
}

npcDialogNodeListEl.addEventListener('click', (e) => {
  const deleteId = e.target.dataset.deleteNode;
  if (deleteId !== undefined) {
    npcDialogTreeDraft.nodes = npcDialogTreeDraft.nodes.filter((n) => n.id !== deleteId);
    // Any choice pointing at the deleted node just ends the dialog instead —
    // a dangling reference would fail validation on save otherwise.
    for (const n of npcDialogTreeDraft.nodes) {
      for (const c of n.choices || []) if (c.next === deleteId) c.next = undefined;
    }
    if (selectedDialogNodeId === deleteId) selectDialogNode(null);
    else { refreshDialogNodeList(); refreshDialogChoiceList(); }
    return;
  }
  const selectId = e.target.dataset.selectNode;
  if (selectId !== undefined) selectDialogNode(selectId);
});

document.getElementById('npc-dialog-add-node-btn').addEventListener('click', () => {
  const node = { id: `node-${Math.floor(Math.random() * 1e9)}`, text: '', choices: [] };
  npcDialogTreeDraft.nodes.push(node);
  selectDialogNode(node.id);
});

npcDialogNodeTextEl.addEventListener('input', () => {
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === selectedDialogNodeId);
  if (!node) return;
  node.text = npcDialogNodeTextEl.value;
  refreshDialogNodeList(); // preview text in the list updates live
});

function refreshDialogChoiceList() {
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === selectedDialogNodeId);
  if (!node) { npcDialogChoiceListEl.innerHTML = ''; return; }
  const nodeOptionsHtml = npcDialogTreeDraft.nodes
    .map((n) => `<option value="${n.id}">${(n.text || '').slice(0, 20) || '(empty)'}</option>`)
    .join('');
  // Only quests this NPC actually gives make sense to auto-accept from its own dialog.
  const questOptionsHtml = questCatalog
    .filter((q) => q.giverNpcId === selectedNpc?.ref.id)
    .map((q) => `<option value="${q.id}">${q.name}</option>`)
    .join('');
  npcDialogChoiceListEl.innerHTML = (node.choices || [])
    .map((_, i) => `
      <div data-choice-index="${i}">
        <input type="text" class="choice-text" placeholder="Choice text" />
        <select class="choice-next"><option value="">— end dialog —</option>${nodeOptionsHtml}</select>
        <select class="choice-quest"><option value="">— no quest —</option>${questOptionsHtml}</select>
        <button data-delete-choice="${i}">✕</button>
      </div>`)
    .join('');
  // Set values via properties, not interpolated attributes — choice text is
  // free-form and could contain a quote that would break the markup above.
  npcDialogChoiceListEl.querySelectorAll('[data-choice-index]').forEach((row, i) => {
    const c = node.choices[i];
    row.querySelector('.choice-text').value = c.text || '';
    row.querySelector('.choice-next').value = c.next || '';
    row.querySelector('.choice-quest').value = c.acceptQuestId || '';
  });
}

document.getElementById('npc-dialog-add-choice-btn').addEventListener('click', () => {
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === selectedDialogNodeId);
  if (!node) return;
  node.choices = node.choices || [];
  node.choices.push({ text: 'Yes' });
  refreshDialogChoiceList();
});

npcDialogChoiceListEl.addEventListener('click', (e) => {
  const deleteIdx = e.target.dataset.deleteChoice;
  if (deleteIdx === undefined) return;
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === selectedDialogNodeId);
  if (!node) return;
  node.choices.splice(parseInt(deleteIdx, 10), 1);
  refreshDialogChoiceList();
});

// Live-apply choice field edits back into the draft — 'input' catches the
// text box as you type, 'change' catches the two selects on their commit.
function applyChoiceRowEdit(e) {
  const row = e.target.closest('[data-choice-index]');
  if (!row) return;
  const node = npcDialogTreeDraft.nodes.find((n) => n.id === selectedDialogNodeId);
  const choice = node?.choices[parseInt(row.dataset.choiceIndex, 10)];
  if (!choice) return;
  choice.text = row.querySelector('.choice-text').value;
  choice.next = row.querySelector('.choice-next').value || undefined;
  choice.acceptQuestId = row.querySelector('.choice-quest').value || undefined;
}
npcDialogChoiceListEl.addEventListener('input', applyChoiceRowEdit);
npcDialogChoiceListEl.addEventListener('change', applyChoiceRowEdit);

/** Builds a validated DialogTree from the current draft, or null if empty/invalid (falls back to no dialogTree — the caller keeps `dialog` instead). */
function dialogTreeFromDraft() {
  const nodes = npcDialogTreeDraft.nodes.filter((n) => n.text.trim());
  if (nodes.length === 0) return null;
  return { start: nodes[0].id, nodes };
}

function readNpcFormValues() {
  const values = {
    name: npcNameEl.value.trim() || 'Townsperson',
    appearance: buildAppearanceFromForm(),
    wander: npcWanderEl.checked,
    wanderRadius: parseFloat(npcWanderRadiusEl.value) || 8,
    speed: parseFloat(npcSpeedEl.value) || 1.2,
    facingDeg: parseFloat(npcFacingEl.value) || 0,
  };
  if (npcDialogMode === 'tree') {
    const tree = dialogTreeFromDraft();
    if (tree) { values.dialogTree = tree; values.dialog = undefined; }
    else { values.dialog = []; values.dialogTree = undefined; }
  } else {
    values.dialog = dialogLinesFromForm();
    values.dialogTree = undefined;
  }
  return values;
}

function populateNpcForm(ref) {
  npcNameEl.value = ref.name || '';
  npcBodyEl.value = ref.appearance?.classId || characterTypeCatalog[0]?.id || '';
  npcGenderEl.value = ref.appearance?.gender || 'random';
  npcFormSeed = ref.appearance?.seed ?? Math.floor(Math.random() * 1e9);
  npcDialogEl.value = (ref.dialog || []).join('\n');
  setNpcDialogMode(ref.dialogTree ? 'tree' : 'simple');
  npcDialogTreeDraft = ref.dialogTree ? structuredClone(ref.dialogTree) : { nodes: [] };
  selectDialogNode(null);
  npcWanderEl.checked = ref.wander !== false;
  npcWanderRadiusEl.value = ref.wanderRadius ?? 8;
  npcSpeedEl.value = ref.speed ?? 1.2;
  npcFacingEl.value = ref.facingDeg ?? 0;
  npcHeightEl.value = ref.position?.y ?? 0;
}

/** Rebuild a placed NPC's mesh in place (after an appearance change), preserving its world position. */
function replaceNpcMesh(entry) {
  const pos = entry.mesh.position.clone();
  scene.remove(entry.mesh);
  entry.mesh = buildNpcMesh(entry.ref);
  entry.mesh.position.copy(pos);
  toonify(entry.mesh);
  scene.add(entry.mesh);
}

document.getElementById('place-npc-btn').addEventListener('click', () => {
  armedNpcPlacement = true;
  statusLine.textContent = 'Click the ground to place the NPC';
});

function placeNpcAt(point) {
  const stats = readNpcFormValues();
  const seed = Math.floor(Math.random() * 1e9);
  const ref = {
    id: `npc-${seed}`,
    name: stats.name,
    position: { x: snap(point.x), y: 0, z: snap(point.z) },
    appearance: stats.appearance,
    dialog: stats.dialog,
    dialogTree: stats.dialogTree,
    wander: stats.wander,
    wanderRadius: stats.wanderRadius,
    speed: stats.speed,
    facingDeg: stats.facingDeg,
  };
  if (!world.npcs) world.npcs = [];
  world.npcs.push(ref);
  const mesh = buildNpcMesh(ref);
  toonify(mesh);
  scene.add(mesh);
  const entry = { ref, mesh };
  placedNpcs.push(entry);
  armedNpcPlacement = false;
  npcFormSeed = Math.floor(Math.random() * 1e9); // fresh look for the next placement
  selectNpc(entry);
  refreshNpcList();
}

function selectNpc(entry) {
  selectedNpc = entry;
  if (!entry) {
    npcSelectedInfoEl.textContent = 'Nothing selected. Click a placed NPC.';
    npcSelectedControlsEl.style.display = 'none';
    selectionHighlight.visible = false;
    return;
  }
  npcSelectedInfoEl.textContent = `${entry.ref.name} — ${entry.ref.id}`;
  npcSelectedControlsEl.style.display = 'block';
  populateNpcForm(entry.ref);
  selectionHighlight.visible = true;
  selectionHighlight.setFromObject(entry.mesh);
}

document.getElementById('apply-npc-btn').addEventListener('click', () => {
  if (!selectedNpc) return;
  const stats = readNpcFormValues();
  const appearanceChanged = JSON.stringify(stats.appearance) !== JSON.stringify(selectedNpc.ref.appearance);
  Object.assign(selectedNpc.ref, stats);
  if (appearanceChanged) replaceNpcMesh(selectedNpc);
  applyNpcTransform(selectedNpc);
  npcSelectedInfoEl.textContent = `${selectedNpc.ref.name} — ${selectedNpc.ref.id}`;
  refreshNpcList();
});

/** Re-syncs a placed NPC's mesh to its ref's position/facing — the one place that knows `position.y` is a ground-relative OFFSET (like props), not an absolute world Y. */
function applyNpcTransform(entry) {
  const { position } = entry.ref;
  const terrainY = sampleTerrainHeight(world, position.x, position.z);
  entry.mesh.position.set(position.x, (position.y || 0) + terrainY, position.z);
  entry.mesh.rotation.y = ((entry.ref.facingDeg || 0) * Math.PI) / 180;
  if (selectedNpc === entry) selectionHighlight.update();
}

// Live-apply, so rotating an NPC is a spin of the number field rather than a
// field edit followed by "Apply" — matching how Place mode's own rotation
// fields behave.
npcFacingEl.addEventListener('input', () => {
  if (!selectedNpc) return;
  selectedNpc.ref.facingDeg = parseFloat(npcFacingEl.value) || 0;
  applyNpcTransform(selectedNpc);
});
npcHeightEl.addEventListener('input', () => {
  if (!selectedNpc) return;
  selectedNpc.ref.position.y = parseFloat(npcHeightEl.value) || 0;
  applyNpcTransform(selectedNpc);
});

document.getElementById('delete-npc-btn').addEventListener('click', deleteSelectedNpc);

function deleteSelectedNpc() {
  if (!selectedNpc) return;
  scene.remove(selectedNpc.mesh);
  world.npcs = (world.npcs || []).filter((n) => n !== selectedNpc.ref);
  placedNpcs.splice(placedNpcs.indexOf(selectedNpc), 1);
  selectNpc(null);
  refreshNpcList();
}

function raycastNpcs() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedNpcs.map((n) => n.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedNpcs.some((n) => n.mesh === obj)) obj = obj.parent;
  return placedNpcs.find((n) => n.mesh === obj) || null;
}

function refreshNpcList() {
  npcCountEl.textContent = placedNpcs.length;
  npcListEl.innerHTML = placedNpcs
    .map((n, i) => `<div><span>${n.ref.name}${n.ref.wander === false ? ' 📍' : ''}</span><button data-delete-npc="${i}">✕</button></div>`)
    .join('');
}

npcListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deleteNpc;
  if (idx === undefined) return;
  const entry = placedNpcs[parseInt(idx, 10)];
  if (!entry) return;
  selectNpc(entry);
  deleteSelectedNpc();
});

/**
 * Renders a repeatable list of {itemId, qty} reward rows into `container`,
 * mutating the `items` array in place (same live-array-of-refs pattern as
 * renderEventCommandRows above) — shared by Quests mode, the Events-mode
 * Quest panel, and Recipes mode (reagents/output) so these authoring
 * surfaces never drift on this bit of UI. Offers both the hardcoded
 * materials catalog (src/sim/items.js) and the authored item catalog (Items
 * mode's itemCatalog, e.g. crafted gear) — a recipe's reagents are usually
 * raw materials but its OUTPUT is frequently authored gear, so both need to
 * be reachable from the same picker.
 */
function renderRewardItemRows(container, items, onChanged) {
  const itemOptions = ITEM_IDS.map((id) => `<option value="${id}">${getItemDef(id).name}</option>`)
    .concat(itemCatalog.map((i) => `<option value="${i.id}">${i.name} (authored)</option>`))
    .join('');
  container.innerHTML = '';
  items.forEach((item, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; gap:4px; align-items:center; margin-bottom:4px;';

    const sel = document.createElement('select');
    sel.innerHTML = itemOptions;
    sel.value = item.itemId;
    sel.addEventListener('change', () => { item.itemId = sel.value; });

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = 1;
    qty.style.width = '70px';
    qty.value = item.qty;
    qty.addEventListener('change', () => { item.qty = parseInt(qty.value, 10) || 1; });

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:#883f3f; border-color:#883f3f;';
    delBtn.addEventListener('click', () => { items.splice(idx, 1); onChanged(); });

    row.appendChild(sel);
    row.appendChild(qty);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

// --- QUESTS MODE ---
// Authored quest catalog (quests/quests.json), same catalog+form+save+list
// shape as Items mode. A quest links to a giver NPC and an objective; the
// server engine (src/sim/quests.js) drives accept/progress/turn-in at runtime.
const questIdEl = document.getElementById('quest-id');
const questNameEl = document.getElementById('quest-name');
const questDescEl = document.getElementById('quest-description');
const questGiverEl = document.getElementById('quest-giver');
const questObjTypeEl = document.getElementById('quest-obj-type');
const questTargetGroupEl = document.getElementById('quest-target-group');
const questTargetItemEl = document.getElementById('quest-target-item');
const questTargetNpcEl = document.getElementById('quest-target-npc');
const questCountEl = document.getElementById('quest-count');
const questRequiresEl = document.getElementById('quest-requires');
const questMinLevelEl = document.getElementById('quest-min-level');
const questRewardXpEl = document.getElementById('quest-reward-xp');
const questRewardGoldEl = document.getElementById('quest-reward-gold');
const questRewardItemsEl = document.getElementById('quest-reward-items');
const questStatusEl = document.getElementById('quest-status');
const questListEl = document.getElementById('quest-list');
const questCountLabelEl = document.getElementById('quest-count-label');

let questCatalog = [];
let editingQuestId = null;
let questRewardItems = []; // working copy of {itemId, qty} rows, edited live — same pattern as eventFormSheets

function renderQuestRewardItems() {
  renderRewardItemRows(questRewardItemsEl, questRewardItems, renderQuestRewardItems);
}
document.getElementById('quest-add-reward-item-btn').addEventListener('click', () => {
  questRewardItems.push({ itemId: ITEM_IDS[0], qty: 1 });
  renderQuestRewardItems();
});

fetch('/api/quests')
  .then((r) => r.json())
  .then((qs) => { questCatalog = qs; refreshQuestList(); refreshEventQuestList(); })
  .catch((err) => { questStatusEl.textContent = `Failed to load quests: ${err.message}`; });

/** Fill the NPC-giver, talk-target, and item dropdowns from the current world + material item registry. */
function populateQuestDropdowns() {
  const npcOptions = (world?.npcs || []).map((n) => `<option value="${n.id}">${n.name} (${n.id})</option>`).join('');
  questGiverEl.innerHTML = npcOptions || '<option value="">— no NPCs placed —</option>';
  questTargetNpcEl.innerHTML = npcOptions || '<option value="">— no NPCs placed —</option>';
  const itemOptions = ITEM_IDS.map((id) => `<option value="${id}">${getItemDef(id).name}</option>`).join('');
  questTargetItemEl.innerHTML = itemOptions;
  questRequiresEl.innerHTML = '<option value="">— none —</option>' + questCatalog.map((q) => `<option value="${q.id}">${q.name}</option>`).join('');
}

// Show only the target field relevant to the selected objective type.
questObjTypeEl.addEventListener('change', updateQuestTargetVisibility);
const questTurnInAtTargetEl = document.getElementById('quest-turnin-at-target');

function updateQuestTargetVisibility() {
  const t = questObjTypeEl.value;
  document.getElementById('quest-target-kill').style.display = t === 'kill' ? 'block' : 'none';
  document.getElementById('quest-target-gather').style.display = t === 'gather' ? 'block' : 'none';
  document.getElementById('quest-target-talk').style.display = t === 'talk' ? 'block' : 'none';
  document.getElementById('quest-count-row').style.display = t === 'talk' ? 'none' : 'block'; // talk is always a single visit
}

function clearQuestForm() {
  editingQuestId = null;
  questIdEl.value = '';
  questIdEl.disabled = false;
  questNameEl.value = '';
  questDescEl.value = '';
  questObjTypeEl.value = 'kill';
  questTurnInAtTargetEl.checked = false;
  questTargetGroupEl.value = '';
  questCountEl.value = 10;
  questRequiresEl.value = '';
  questMinLevelEl.value = 1;
  questRewardXpEl.value = 50;
  questRewardGoldEl.value = 20;
  questRewardItems = [];
  renderQuestRewardItems();
  updateQuestTargetVisibility();
  questStatusEl.textContent = '';
}

function loadQuestIntoForm(q) {
  populateQuestDropdowns();
  editingQuestId = q.id;
  questIdEl.value = q.id;
  questIdEl.disabled = true;
  questNameEl.value = q.name;
  questDescEl.value = q.description || '';
  questGiverEl.value = q.giverNpcId;
  questObjTypeEl.value = q.objective.type;
  updateQuestTargetVisibility();
  if (q.objective.type === 'kill') questTargetGroupEl.value = q.objective.target;
  if (q.objective.type === 'gather') questTargetItemEl.value = q.objective.target;
  if (q.objective.type === 'talk') questTargetNpcEl.value = q.objective.target;
  questTurnInAtTargetEl.checked = !!q.turnInAtTarget;
  questCountEl.value = q.objective.count ?? 1;
  questRequiresEl.value = q.requiresQuestId || '';
  questMinLevelEl.value = q.minLevel ?? 1;
  questRewardXpEl.value = q.rewards?.xp ?? 0;
  questRewardGoldEl.value = q.rewards?.gold ?? 0;
  questRewardItems = structuredClone(q.rewards?.items || []);
  renderQuestRewardItems();
  questStatusEl.textContent = '';
}

document.getElementById('new-quest-btn').addEventListener('click', clearQuestForm);

/**
 * Reads the Quests-mode form into a QuestDef, starting from the existing
 * catalog entry (if editing) and only overwriting the fields this form
 * actually shows — so `requiredSwitch`/`dialogActive`/`dialogReady`/
 * `dialogComplete` (event-specific fields the Events-mode Quest panel owns)
 * survive an edit made from this tab instead of being silently dropped.
 */
function readQuestForm() {
  const existing = editingQuestId ? questCatalog.find((x) => x.id === editingQuestId) : null;
  const type = questObjTypeEl.value;
  const target = type === 'kill' ? questTargetGroupEl.value.trim()
    : type === 'gather' ? questTargetItemEl.value
    : questTargetNpcEl.value;
  const objective = { type, target, count: type === 'talk' ? 1 : (parseInt(questCountEl.value, 10) || 1) };
  const rewards = { ...existing?.rewards };
  const xp = parseInt(questRewardXpEl.value, 10) || 0;
  const gold = parseInt(questRewardGoldEl.value, 10) || 0;
  if (xp) rewards.xp = xp; else delete rewards.xp;
  if (gold) rewards.gold = gold; else delete rewards.gold;
  if (questRewardItems.length) rewards.items = structuredClone(questRewardItems); else delete rewards.items;
  const minLevel = parseInt(questMinLevelEl.value, 10) || 1;
  return {
    ...existing,
    id: questIdEl.value.trim(),
    name: questNameEl.value.trim(),
    description: questDescEl.value.trim() || undefined,
    giverNpcId: questGiverEl.value,
    objective,
    requiresQuestId: questRequiresEl.value || undefined,
    // Only ever set on a 'talk' objective — parseQuests rejects it anywhere
    // else, and the checkbox is hidden for the other two types, so a box
    // left ticked from a previous edit can't leak onto a kill/gather quest.
    turnInAtTarget: type === 'talk' && questTurnInAtTargetEl.checked ? true : undefined,
    ...(minLevel > 1 ? { minLevel } : { minLevel: undefined }),
    ...(Object.keys(rewards).length ? { rewards } : { rewards: undefined }),
  };
}

async function saveQuestCatalog() {
  const res = await fetch('/api/quests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(questCatalog),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `server responded ${res.status}`);
  }
}

document.getElementById('save-quest-btn').addEventListener('click', async () => {
  const q = readQuestForm();
  if (!q.id) { questStatusEl.textContent = 'Quest id is required.'; return; }
  if (!q.name) { questStatusEl.textContent = 'Quest name is required.'; return; }
  if (!q.giverNpcId) { questStatusEl.textContent = 'Pick a giver NPC (place one in NPCs mode first).'; return; }
  if (!q.objective.target) { questStatusEl.textContent = 'Objective target is required.'; return; }

  if (editingQuestId) {
    const idx = questCatalog.findIndex((x) => x.id === editingQuestId);
    if (idx >= 0) questCatalog[idx] = q;
  } else {
    if (questCatalog.some((x) => x.id === q.id)) { questStatusEl.textContent = `A quest with id "${q.id}" already exists — click it to edit.`; return; }
    questCatalog.push(q);
  }
  try {
    await saveQuestCatalog();
    questStatusEl.textContent = 'Saved ✓';
    loadQuestIntoForm(q);
    refreshQuestList();
    refreshEventQuestList(); // Events mode lists the same catalog
  } catch (err) {
    questStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

function refreshQuestList() {
  // Both loot editors' quest-gate pickers are fed from this same catalog, and
  // it loads asynchronously, so they'd otherwise show "- always drops -" and
  // nothing else until the mode was re-entered.
  refreshLootQuestOptions('mon-loot-quest');
  refreshLootQuestOptions('mb-loot-quest');
  questCountLabelEl.textContent = questCatalog.length;
  questListEl.innerHTML = questCatalog
    .map((q) => `<div><span>${q.name} <span class="hint">(${q.objective.type})</span></span><button data-edit-quest="${q.id}">✎</button><button data-delete-quest="${q.id}">✕</button></div>`)
    .join('');
}

questListEl.addEventListener('click', async (e) => {
  const editId = e.target.dataset.editQuest;
  const deleteId = e.target.dataset.deleteQuest;
  if (editId !== undefined) {
    const q = questCatalog.find((x) => x.id === editId);
    if (q) loadQuestIntoForm(q);
    return;
  }
  if (deleteId !== undefined) {
    try {
      // DELETE by id rather than re-saving the whole catalog: one malformed
      // quest elsewhere in quests.json (e.g. left over from a deleted map)
      // would otherwise fail validation and block deleting ANY quest, which
      // is exactly the trap this used to fall into.
      const res = await fetch(`/api/quests/${encodeURIComponent(deleteId)}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `server responded ${res.status}`);
      }
      const { quests } = await res.json();
      questCatalog = quests; // authoritative post-delete list, straight from disk
      refreshQuestList();
      refreshEventQuestList(); // Events mode lists the same catalog
      populateQuestDropdowns(); // the prerequisite-quest picker just lost an entry
      if (editingQuestId === deleteId) clearQuestForm();
      questStatusEl.textContent = 'Deleted ✓';
    } catch (err) {
      // "Failed to fetch" is a TypeError from fetch itself — the request never
      // reached the server — not a rejection from it. Saying so is the
      // difference between "restart your dev server" and hunting a data bug.
      questStatusEl.textContent = err instanceof TypeError
        ? 'Delete failed: could not reach the server. Is it still running? (server/index.js has no auto-reload — restart it after any server-side change.)'
        : `Delete failed: ${err.message}`;
    }
  }
});

// --- RECIPES MODE ---
// Authored recipe catalog (recipes/recipes.json), same catalog+form+save+
// list shape as Quests mode. A recipe is craftable at a Crafting Station
// (Place mode's 'crafting-stations' category props) once an Event object
// attached to that prop runs an "Open Crafting Station" command
// (src/sim/events.js's openCraftingStation) — see src/sim/craftResolution.js
// for the level/station/reagent gating this catalog feeds at runtime.
const recipeIdEl = document.getElementById('recipe-id');
const recipeNameEl = document.getElementById('recipe-name');
const recipeCategoryEl = document.getElementById('recipe-category');
const recipeProfessionEl = document.getElementById('recipe-profession');
const recipeStationEl = document.getElementById('recipe-station');
const recipeRequiredLevelEl = document.getElementById('recipe-required-level');
const recipeCraftTimeEl = document.getElementById('recipe-craft-time');
const recipeExpRewardEl = document.getElementById('recipe-exp-reward');
const recipeReagentListEl = document.getElementById('recipe-reagent-list');
const recipeOutputItemEl = document.getElementById('recipe-output-item');
const recipeYieldMinEl = document.getElementById('recipe-yield-min');
const recipeYieldMaxEl = document.getElementById('recipe-yield-max');
const recipeSuccessPctEl = document.getElementById('recipe-success-pct');
const recipeCritPctEl = document.getElementById('recipe-crit-pct');
const recipeCritOutputItemEl = document.getElementById('recipe-crit-output-item');
const recipeFailActionEl = document.getElementById('recipe-fail-action');
const recipeFailPctRowEl = document.getElementById('recipe-fail-pct-row');
const recipeFailPctEl = document.getElementById('recipe-fail-pct');
const recipeStatusEl = document.getElementById('recipe-status');
const recipeListEl = document.getElementById('recipe-list');
const recipeCountLabelEl = document.getElementById('recipe-count-label');

let recipeCatalog = [];
let editingRecipeId = null;
let recipeReagents = []; // working copy of {itemId, qty} rows — same live-array pattern as questRewardItems

recipeProfessionEl.innerHTML = PROFESSIONS.map((p) => `<option value="${p}">${p}</option>`).join('');
recipeFailActionEl.addEventListener('change', () => {
  recipeFailPctRowEl.style.display = recipeFailActionEl.value === 'DESTROY_PERCENTAGE' ? 'block' : 'none';
});

function renderRecipeReagents() {
  renderRewardItemRows(recipeReagentListEl, recipeReagents, renderRecipeReagents);
}
document.getElementById('recipe-add-reagent-btn').addEventListener('click', () => {
  recipeReagents.push({ itemId: ITEM_IDS[0], qty: 1 });
  renderRecipeReagents();
});

fetch('/api/recipes')
  .then((r) => r.json())
  .then((rs) => { recipeCatalog = rs; refreshRecipeList(); })
  .catch((err) => { recipeStatusEl.textContent = `Failed to load recipes: ${err.message}`; });

/** Station dropdown + output/crit-output item pickers — refreshed on load and whenever Recipes mode is entered, so a freshly-authored item shows up without a page reload. */
function populateRecipeDropdowns() {
  recipeStationEl.innerHTML = CRAFTING_STATION_TYPE_IDS.map((id) => `<option value="${id}">${CRAFTING_STATION_TYPES[id].name}</option>`).join('');
  const itemOptions = ITEM_IDS.map((id) => `<option value="${id}">${getItemDef(id).name}</option>`)
    .concat(itemCatalog.map((i) => `<option value="${i.id}">${i.name} (authored)</option>`))
    .join('');
  recipeOutputItemEl.innerHTML = itemOptions;
  recipeCritOutputItemEl.innerHTML = '<option value="">— none, double yield on crit —</option>' + itemOptions;
}

function clearRecipeForm() {
  editingRecipeId = null;
  recipeIdEl.value = '';
  recipeIdEl.disabled = false;
  recipeNameEl.value = '';
  recipeCategoryEl.value = '';
  populateRecipeDropdowns();
  recipeProfessionEl.value = PROFESSIONS[0];
  recipeRequiredLevelEl.value = 1;
  recipeCraftTimeEl.value = 2;
  recipeExpRewardEl.value = 10;
  recipeReagents = [];
  renderRecipeReagents();
  recipeYieldMinEl.value = 1;
  recipeYieldMaxEl.value = 1;
  recipeSuccessPctEl.value = 100;
  recipeCritPctEl.value = 0;
  recipeCritOutputItemEl.value = '';
  recipeFailActionEl.value = 'DESTROY_ALL_MATERIALS';
  recipeFailPctEl.value = 50;
  recipeFailPctRowEl.style.display = 'none';
  recipeStatusEl.textContent = '';
}

function loadRecipeIntoForm(r) {
  populateRecipeDropdowns();
  editingRecipeId = r.id;
  recipeIdEl.value = r.id;
  recipeIdEl.disabled = true;
  recipeNameEl.value = r.name;
  recipeCategoryEl.value = r.category || '';
  recipeProfessionEl.value = r.profession;
  recipeStationEl.value = r.requiredStationTypeId;
  recipeRequiredLevelEl.value = r.requiredSkillLevel;
  recipeCraftTimeEl.value = r.craftingTimeSeconds;
  recipeExpRewardEl.value = r.expReward;
  // recipeReagents (and renderRewardItemRows, the shared row widget it uses)
  // works in {itemId, qty} shape — same as quest rewards — while a
  // RecipeDef's reagents use {itemId, quantity} (src/sim/recipes.js). Map at
  // the boundary rather than forking the shared widget.
  recipeReagents = (r.reagents || []).map((x) => ({ itemId: x.itemId, qty: x.quantity }));
  renderRecipeReagents();
  recipeOutputItemEl.value = r.output.itemId;
  recipeYieldMinEl.value = r.output.yieldMin;
  recipeYieldMaxEl.value = r.output.yieldMax;
  recipeSuccessPctEl.value = r.output.successChancePercent;
  recipeCritPctEl.value = r.output.critChancePercent;
  recipeCritOutputItemEl.value = r.output.critOutputItemId || '';
  recipeFailActionEl.value = r.failAction;
  recipeFailPctEl.value = r.failDestroyPercent ?? 50;
  recipeFailPctRowEl.style.display = r.failAction === 'DESTROY_PERCENTAGE' ? 'block' : 'none';
  recipeStatusEl.textContent = '';
}

document.getElementById('new-recipe-btn').addEventListener('click', clearRecipeForm);

function readRecipeForm() {
  const failAction = recipeFailActionEl.value;
  return {
    id: recipeIdEl.value.trim(),
    name: recipeNameEl.value.trim(),
    category: recipeCategoryEl.value.trim() || undefined,
    profession: recipeProfessionEl.value,
    requiredStationTypeId: recipeStationEl.value,
    requiredSkillLevel: parseInt(recipeRequiredLevelEl.value, 10) || 1,
    craftingTimeSeconds: parseFloat(recipeCraftTimeEl.value) || 0,
    expReward: parseInt(recipeExpRewardEl.value, 10) || 0,
    // See loadRecipeIntoForm's comment on the {itemId,qty} <-> {itemId,quantity} boundary mapping.
    reagents: recipeReagents.map((x) => ({ itemId: x.itemId, quantity: x.qty })),
    output: {
      itemId: recipeOutputItemEl.value,
      yieldMin: parseInt(recipeYieldMinEl.value, 10) || 1,
      yieldMax: parseInt(recipeYieldMaxEl.value, 10) || 1,
      successChancePercent: parseFloat(recipeSuccessPctEl.value) || 0,
      critChancePercent: parseFloat(recipeCritPctEl.value) || 0,
      critOutputItemId: recipeCritOutputItemEl.value || undefined,
    },
    failAction,
    failDestroyPercent: failAction === 'DESTROY_PERCENTAGE' ? (parseFloat(recipeFailPctEl.value) || 0) : undefined,
  };
}

async function saveRecipeCatalog() {
  const res = await fetch('/api/recipes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipeCatalog),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `server responded ${res.status}`);
  }
}

document.getElementById('save-recipe-btn').addEventListener('click', async () => {
  const r = readRecipeForm();
  if (!r.id) { recipeStatusEl.textContent = 'Recipe id is required.'; return; }
  if (!r.name) { recipeStatusEl.textContent = 'Recipe name is required.'; return; }
  if (!r.reagents.length) { recipeStatusEl.textContent = 'Add at least one reagent.'; return; }
  if (!r.output.itemId) { recipeStatusEl.textContent = 'Pick an output item (author one in Items mode first if needed).'; return; }

  // Snapshot before mutating so a server-side rejection (e.g. a bad field
  // slipping past this form's own checks) doesn't leave a half-added/half-
  // edited entry sitting in the in-memory catalog — a prior version of this
  // handler pushed unconditionally and never rolled back, which left a
  // rejected recipe permanently "already exists" with no way to fix or
  // remove it short of reloading the page.
  const prevCatalog = recipeCatalog;
  if (editingRecipeId) {
    const idx = recipeCatalog.findIndex((x) => x.id === editingRecipeId);
    recipeCatalog = idx >= 0 ? recipeCatalog.map((x, i) => (i === idx ? r : x)) : recipeCatalog;
  } else {
    if (recipeCatalog.some((x) => x.id === r.id)) { recipeStatusEl.textContent = `A recipe with id "${r.id}" already exists — click it to edit.`; return; }
    recipeCatalog = [...recipeCatalog, r];
  }
  try {
    await saveRecipeCatalog();
    recipeStatusEl.textContent = 'Saved ✓';
    loadRecipeIntoForm(r);
    refreshRecipeList();
  } catch (err) {
    recipeCatalog = prevCatalog;
    recipeStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

function refreshRecipeList() {
  recipeCountLabelEl.textContent = recipeCatalog.length;
  recipeListEl.innerHTML = recipeCatalog
    .map((r) => `<div><span>${r.name} <span class="hint">(${r.profession})</span></span><button data-edit-recipe="${r.id}">✎</button><button data-delete-recipe="${r.id}">✕</button></div>`)
    .join('');
}

recipeListEl.addEventListener('click', async (e) => {
  const editId = e.target.dataset.editRecipe;
  const deleteId = e.target.dataset.deleteRecipe;
  if (editId !== undefined) {
    const r = recipeCatalog.find((x) => x.id === editId);
    if (r) loadRecipeIntoForm(r);
    return;
  }
  if (deleteId !== undefined) {
    const prev = recipeCatalog;
    recipeCatalog = recipeCatalog.filter((x) => x.id !== deleteId);
    try {
      await saveRecipeCatalog();
      refreshRecipeList();
      if (editingRecipeId === deleteId) clearRecipeForm();
    } catch (err) {
      recipeCatalog = prev;
      recipeStatusEl.textContent = `Delete failed: ${err.message}`;
    }
  }
});

// --- OBJECT BUILDER MODE ---
// Compose an object from primitive shapes on a small local-origin grid
// workspace (builderGroup, set up alongside floorGroup/placedNpcs above),
// save it to a reusable catalog, then place instances of it in Place mode
// like any other prop (see armedCustomObjectId / placeAt's 'custom' branch).
// objectCatalog/objectCatalogById are declared near the top of the file
// (see the comment there) so the palette's first synchronous render can
// read them.
let editingObjectId = null; // null = the form describes a new object; otherwise the id of the catalog entry currently loaded
let builderDragging = false;

function refreshObjectCatalogById() {
  objectCatalogById = Object.fromEntries(objectCatalog.map((o) => [o.id, o]));
  // Authored objects show up in the palette's Outdoors Decor tab.
  placePalette?.refresh();
  scatterPalette?.refresh();
}

fetch('/api/objects')
  .then((r) => r.json())
  .then((list) => {
    objectCatalog = list;
    refreshObjectCatalogById();
    refreshBuilderObjectList();
    rebuildAll(); // any already-placed custom props loaded before this resolved upgrade from their fallback shape
  })
  .catch((err) => console.error('Failed to load object catalog:', err));

// --- IMPORTED MODELS (FBX/GLB) ---
// Catalog metadata lives on the server (models/models.json); the actual model
// load/cache is modelLoader.js's job (async, unlike every other prop
// builder — see buildProp's 'model' branch). onModelLoadedEvent fires once a
// model finishes loading, whether that's the first time it's ever been
// placed or a later reload — a full rebuildAll() is simpler and safe here
// (matches how the object catalog's own load triggers one above), since
// model loads are infrequent and cached per URL after the first time.
// modelCatalog/propModels are declared near the top of the file (see the
// comment there) so the palette's first synchronous render can read them.
const modelUploadStatusEl = document.getElementById('model-upload-status');

// There's no standalone "Uploaded Models" list anymore — a model shows up as
// a palette cell (under whichever category it was uploaded with), with a
// delete-X and a remeasure-↻ badge on the cell itself (see
// sceneryPalette.js's onDeleteModel/onRemeasureModel). These two functions
// are the shared logic both palettes' callbacks invoke.
async function remeasureModel(id) {
  const entry = modelCatalog.find((m) => m.id === id);
  if (!entry) return;
  modelUploadStatusEl.textContent = `Remeasuring "${entry.name}"…`;
  // Forces a fresh load even if this model was already loaded+cached earlier
  // in the session (e.g. it's currently placed somewhere) — an
  // already-cached entry would otherwise make waitForModels resolve
  // instantly without re-running measureModel's base-slice logic.
  forgetLoadedModel(entry.id);
  await waitForModels([entry.id]);
  const metrics = measureModel(entry.id);
  if (!metrics) {
    modelUploadStatusEl.textContent = `Remeasure failed for "${entry.name}" — check the file still loads correctly.`;
    return;
  }
  const idx = modelCatalog.findIndex((m) => m.id === entry.id);
  if (idx >= 0) modelCatalog[idx] = { ...modelCatalog[idx], ...metrics };
  try {
    await persistModelMetrics(entry, metrics);
    rebuildAll(); // placed instances pick up the corrected collider
    modelUploadStatusEl.textContent = `Remeasured "${entry.name}" ✓ — height ${metrics.height.toFixed(2)}, footprint radius ${metrics.footprintRadius.toFixed(2)}`;
  } catch (err) {
    modelUploadStatusEl.textContent = `Remeasure save failed: ${err.message}`;
  }
}

/**
 * Writes a measured footprint/height back to the server. Two destinations,
 * because the two kinds of imported model have two different sources of truth:
 * an UPLOADED model's row lives in models.json (posted back wholesale, the
 * same idiom every catalog here uses), while a FOLDER-DROPPED asset
 * (src/generators/environment/import/) is owned by the folder itself and only
 * its measurement is persisted, into a sidecar keyed by filename.
 */
async function persistModelMetrics(entry, metrics) {
  const res = entry.source === 'import-folder'
    ? await fetch('/api/imported-assets/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: entry.file, ...metrics }),
      })
    : await fetch('/api/models/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelCatalog),
      });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Server responded ${res.status}`);
}

/**
 * Measures every folder-dropped asset that has no footprint recorded yet, one
 * at a time, and saves each measurement.
 *
 * An uploaded model gets measured by the upload flow itself, at the one moment
 * the author is definitely looking at it. A dropped file has no such moment —
 * nobody clicks anything — so without this every imported asset would be
 * placeable but completely walk-through (footprintRadius stays null, which
 * collision.js reads as a zero radius) until someone thought to press the ↻
 * badge on its palette cell. Runs once per editor session, and only for assets
 * genuinely missing the numbers, so a folder of already-measured assets costs
 * nothing.
 */
async function measureUnmeasuredImports() {
  const pending = modelCatalog.filter((m) => m.source === 'import-folder' && m.footprintRadius == null);
  if (!pending.length) return;
  modelUploadStatusEl.textContent = `Measuring ${pending.length} imported asset(s)…`;
  let measured = 0;
  for (const entry of pending) {
    await waitForModels([entry.id]);
    const metrics = measureModel(entry.id);
    if (!metrics) {
      console.warn(`Imported asset "${entry.file}" failed to load — it will stay walk-through until it does.`);
      continue;
    }
    const idx = modelCatalog.findIndex((m) => m.id === entry.id);
    if (idx >= 0) modelCatalog[idx] = { ...modelCatalog[idx], ...metrics };
    try {
      await persistModelMetrics(entry, metrics);
      measured++;
    } catch (err) {
      console.error(`Failed to save measurement for imported asset "${entry.file}":`, err);
    }
  }
  modelUploadStatusEl.textContent = measured
    ? `Measured ${measured} imported asset(s) ✓`
    : 'Imported assets could not be measured — check the console for which file failed to load.';
  if (measured) rebuildAll();
}

async function deleteModel(id) {
  const entry = modelCatalog.find((m) => m.id === id);
  if (!entry) return;
  if (entry.source === 'import-folder') {
    // The palette doesn't offer the badge for these (see paletteExtraItems),
    // so this is belt-and-braces: the file belongs to whoever dropped it in.
    modelUploadStatusEl.textContent = `"${entry.name}" is a file in src/generators/environment/import/ — delete it from that folder to remove it.`;
    return;
  }
  if (!confirm(`Delete "${entry.name}"? This removes the uploaded file too — any placed instances fall back to a placeholder box.`)) return;
  const removed = modelCatalog;
  modelCatalog = modelCatalog.filter((m) => m.id !== entry.id);
  placePalette.refresh();
  scatterPalette.refresh();
  try {
    const res = await fetch('/api/models/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modelCatalog),
    });
    if (!res.ok) throw new Error((await res.json()).error || `Server responded ${res.status}`);
    rebuildAll(); // any placed instance of the deleted model falls back to a placeholder box
  } catch (err) {
    modelCatalog = removed; // save failed — don't leave the in-memory list ahead of what's on disk
    placePalette.refresh();
    scatterPalette.refresh();
    modelUploadStatusEl.textContent = `Delete failed: ${err.message}`;
  }
}

onModelLoadedEvent(() => {
  rebuildAll();
  // A cell showing an in-progress model's wireframe placeholder upgrades to
  // the real rendered thumbnail the moment it finishes loading (see
  // sceneryPalette.js's propThumbnail — it deliberately doesn't cache an
  // unloaded model's render, so this re-render picks up the real mesh).
  placePalette.refresh();
  scatterPalette.refresh();
});

fetch('/api/models')
  .then((r) => r.json())
  .then((list) => {
    modelCatalog = list;
    registerModelCatalog(modelCatalog);
    registerCustomWeaponModels(modelCatalog); // so an NPC preview here holding a custom weapon renders it, not a placeholder box
    return weaponTuningPromise.then(applyWeaponTuning); // re-apply now that custom weapons exist in BY_ID (see the comment above)
  })
  .then(() => {
    placePalette.refresh();
    scatterPalette.refresh();
    rebuildAll(); // any already-placed model props loaded before this resolved upgrade from their placeholder box
    return measureUnmeasuredImports(); // folder-dropped assets have nobody to measure them at import time — see that function
  })
  .catch((err) => console.error('Failed to load model catalog:', err));

const modelUploadCategoryEl = document.getElementById('model-upload-category');
// 'imported' is left out on purpose: that tab means "came from the import
// folder", and an upload filed under it would be indistinguishable in the
// palette from a file the author can actually find on disk.
modelUploadCategoryEl.innerHTML = PROP_CATEGORIES
  .filter((c) => c.id !== 'imported')
  .map((c) => `<option value="${c.id}">${c.icon} ${c.label}</option>`)
  .join('');

document.getElementById('model-upload-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('model-upload-file');
  const nameInput = document.getElementById('model-upload-name');
  const scaleInput = document.getElementById('model-upload-scale');
  const file = fileInput.files[0];
  if (!file) {
    modelUploadStatusEl.textContent = 'Choose a .fbx or .glb file first.';
    return;
  }
  const formData = new FormData();
  formData.append('model', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());
  formData.append('importScale', scaleInput.value || '1');
  formData.append('category', modelUploadCategoryEl.value);
  modelUploadStatusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/models/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    modelCatalog.push(data.entry);
    registerModelCatalog([data.entry]);
    placePalette.refresh();
    scatterPalette.refresh();
    fileInput.value = '';
    nameInput.value = '';
    modelUploadStatusEl.textContent = `Uploaded "${data.entry.name}" — measuring…`;

    // Load it once now so the footprint is real, not a guess, then persist
    // that measurement back — otherwise the collider stays 0 (no collision)
    // until the model happens to get placed and loaded for some other reason.
    await waitForModels([data.entry.id]);
    const metrics = measureModel(data.entry.id);
    if (metrics) {
      const idx = modelCatalog.findIndex((m) => m.id === data.entry.id);
      if (idx >= 0) modelCatalog[idx] = { ...modelCatalog[idx], ...metrics };
      await fetch('/api/models/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelCatalog),
      });
      placePalette.refresh(); // cell's thumbnail was already rendered post-load; this just covers the (rare) case a measurement changes the collider only
      scatterPalette.refresh();
      // Surfaced directly rather than left to a trip into models.json — a
      // player is ~1.75 units tall and this project's own hand-built
      // buildings run 4-8 units tall, so a measured height wildly outside
      // that range is the single most common real-world FBX/GLB import mistake
      // (an exporter's cm-vs-m unit disagreement) and is worth flagging
      // immediately, before it's placed and only shows up as "looks washed
      // out" from being pushed far enough away to sit deep in the fog.
      const h = metrics.height.toFixed(2);
      const scaleHint = metrics.height > 20 || metrics.height < 0.3
        ? ` — that's ${metrics.height > 20 ? 'much taller' : 'much smaller'} than this game's usual scale (buildings run ~4-8 units, a player is ~1.75); double-check "Import scale" and re-upload if this looks wrong.`
        : '';
      modelUploadStatusEl.textContent = `Uploaded "${data.entry.name}" ✓ — measured height ${h} units${scaleHint}`;
    } else {
      modelUploadStatusEl.textContent = `Uploaded "${data.entry.name}" ✓ (measurement failed — check the file loaded correctly)`;
    }
  } catch (err) {
    modelUploadStatusEl.textContent = `Upload failed: ${err.message}`;
  }
});

const builderGridSnapEl = document.getElementById('builder-grid-snap');
const builderSnapSizeEl = document.getElementById('builder-snap-size');
function builderSnap(value) {
  if (!builderGridSnapEl.checked) return value;
  const size = parseFloat(builderSnapSizeEl.value) || 0.25;
  return Math.round(value / size) * size;
}

function raycastBuilderShapes() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = builderShapes.map((s) => s.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !builderShapes.some((s) => s.mesh === obj)) obj = obj.parent;
  return builderShapes.find((s) => s.mesh === obj) || null;
}

function raycastBuilderPlane() {
  raycaster.setFromCamera(pointer, camera);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(builderPlane, hit) ? hit : null;
}

document.querySelectorAll('[data-builder-shape]').forEach((btn) => {
  btn.addEventListener('click', () => addBuilderShape(btn.dataset.builderShape));
});

// log-wall/shingle-roof-panel read scale.x/scale.y(/scale.z) as real
// dimensions, not a multiplier on a unit template (see custom.js) — a
// default of {1,1,1} would spawn either as a barely-visible sliver.
const BUILDER_SHAPE_DEFAULT_SCALE = {
  'log-wall': { x: 3, y: 2.5, z: 1 },
  'shingle-roof-panel': { x: 3, y: 1, z: 4 },
};

function addBuilderShape(kind) {
  pushBuilderUndo();
  const id = `shape-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  // Stagger new shapes so they don't all spawn stacked in the same spot —
  // still easy to reposition precisely via the numeric fields afterward.
  const ref = {
    id,
    kind,
    position: { x: (builderShapes.length % 4) - 1.5, y: 0.5, z: Math.floor(builderShapes.length / 4) - 1.5 },
    rotationDeg: 0,
    scale: BUILDER_SHAPE_DEFAULT_SCALE[kind] ? { ...BUILDER_SHAPE_DEFAULT_SCALE[kind] } : { x: 1, y: 1, z: 1 },
    color: 0xcccccc,
  };
  const mesh = buildShapeMesh(ref);
  builderGroup.add(mesh);
  const entry = { ref, mesh };
  builderShapes.push(entry);
  selectBuilderShape(entry);
  refreshBuilderShapeList();
}

const builderShapeSelectedInfoEl = document.getElementById('builder-shape-selected-info');
const builderShapeControlsEl = document.getElementById('builder-shape-controls');
const bsPosX = document.getElementById('bs-pos-x');
const bsPosY = document.getElementById('bs-pos-y');
const bsPosZ = document.getElementById('bs-pos-z');
const bsRotation = document.getElementById('bs-rotation');
const bsScaleX = document.getElementById('bs-scale-x');
const bsScaleY = document.getElementById('bs-scale-y');
const bsScaleZ = document.getElementById('bs-scale-z');
const bsColor = document.getElementById('bs-color');
const bsOpacity = document.getElementById('bs-opacity');
const bsOpacityOut = document.getElementById('bs-opacity-out');
bsOpacity.addEventListener('input', () => { bsOpacityOut.textContent = parseFloat(bsOpacity.value).toFixed(2); });

// --- OBJECT BUILDER UNDO (Ctrl+Z) ---
// A snapshot is the plain-data shape array, deep-cloned — restoring clears
// the workspace and rebuilds meshes from scratch, same as loadObjectIntoForm
// already does when switching catalog entries.
const BUILDER_UNDO_LIMIT = 50;
let builderUndoStack = [];
let builderUndoSuppressed = false; // true while restoring, so the restore itself isn't pushed as a new step

function pushBuilderUndo() {
  if (builderUndoSuppressed) return;
  builderUndoStack.push(builderShapes.map((s) => structuredClone(s.ref)));
  if (builderUndoStack.length > BUILDER_UNDO_LIMIT) builderUndoStack.shift();
}

function undoBuilder() {
  if (builderUndoStack.length === 0) return;
  const snapshot = builderUndoStack.pop();
  builderUndoSuppressed = true;
  for (const s of builderShapes) builderGroup.remove(s.mesh);
  builderShapes.length = 0;
  for (const shapeDef of snapshot) {
    const ref = structuredClone(shapeDef);
    const mesh = buildShapeMesh(ref);
    builderGroup.add(mesh);
    builderShapes.push({ ref, mesh });
  }
  selectBuilderShape(null);
  refreshBuilderShapeList();
  builderUndoSuppressed = false;
}

// Snapshot once per drag/edit gesture, not per input tick: mousedown fires
// once at the start of a slider drag or a field click, before its value
// changes — the many `input` events that follow don't trigger another push.
builderShapeControlsEl.addEventListener('mousedown', pushBuilderUndo);

// Ctrl+Z (or Cmd+Z) — routes to whichever surface is actually active: the
// Object Builder if that's the current mode, otherwise the map itself (see
// undoLastAction). Skipped while a form field has focus so the browser's
// own native per-field undo (e.g. an in-progress number-input edit) takes
// precedence instead of fighting with this. No redo in this pass.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if (isTypingInFormField()) return;
  e.preventDefault();
  if (mode === 'object-builder') undoBuilder();
  else undoLastAction();
});

function selectBuilderShape(entry) {
  selectedBuilderShape = entry;
  if (!entry) {
    builderShapeSelectedInfoEl.textContent = 'Nothing selected. Click a shape in the workspace.';
    builderShapeControlsEl.style.display = 'none';
    builderSelectionHighlight.visible = false;
    refreshBuilderShapeList();
    return;
  }
  builderShapeSelectedInfoEl.textContent = `${entry.ref.kind} — ${entry.ref.id}`;
  builderShapeControlsEl.style.display = 'block';
  bsPosX.value = entry.ref.position.x;
  bsPosY.value = entry.ref.position.y;
  bsPosZ.value = entry.ref.position.z;
  bsRotation.value = entry.ref.rotationDeg || 0;
  bsScaleX.value = entry.ref.scale.x;
  bsScaleY.value = entry.ref.scale.y;
  bsScaleZ.value = entry.ref.scale.z;
  bsColor.value = hexToColorString(entry.ref.color ?? 0xcccccc);
  bsOpacity.value = entry.ref.opacity ?? 1;
  bsOpacityOut.textContent = parseFloat(bsOpacity.value).toFixed(2);
  builderSelectionHighlight.visible = true;
  builderSelectionHighlight.setFromObject(entry.mesh);
  refreshBuilderShapeList();
}

function applyBuilderShapeFields() {
  if (!selectedBuilderShape) return;
  const { ref, mesh } = selectedBuilderShape;
  ref.position = { x: parseFloat(bsPosX.value) || 0, y: parseFloat(bsPosY.value) || 0, z: parseFloat(bsPosZ.value) || 0 };
  ref.rotationDeg = parseFloat(bsRotation.value) || 0;
  ref.scale = { x: parseFloat(bsScaleX.value) || 1, y: parseFloat(bsScaleY.value) || 1, z: parseFloat(bsScaleZ.value) || 1 };
  ref.color = parseInt(bsColor.value.slice(1), 16);
  ref.opacity = parseFloat(bsOpacity.value);
  mesh.position.set(ref.position.x, ref.position.y, ref.position.z);
  mesh.rotation.y = (ref.rotationDeg * Math.PI) / 180;
  mesh.scale.set(ref.scale.x, ref.scale.y, ref.scale.z);
  mesh.material.color.setHex(ref.color);
  setShapeOpacity(mesh, ref.opacity); // not a plain assignment — see its doc comment
  builderSelectionHighlight.update();
}
[bsPosX, bsPosY, bsPosZ, bsRotation, bsScaleX, bsScaleY, bsScaleZ, bsColor, bsOpacity].forEach((el) =>
  el.addEventListener('input', applyBuilderShapeFields)
);

document.getElementById('delete-builder-shape').addEventListener('click', () => {
  if (!selectedBuilderShape) return;
  pushBuilderUndo();
  builderGroup.remove(selectedBuilderShape.mesh);
  builderShapes.splice(builderShapes.indexOf(selectedBuilderShape), 1);
  selectBuilderShape(null);
  refreshBuilderShapeList();
});

document.getElementById('duplicate-builder-shape').addEventListener('click', () => {
  if (!selectedBuilderShape) return;
  pushBuilderUndo();
  const src = selectedBuilderShape.ref;
  const ref = {
    ...structuredClone(src),
    id: `shape-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    // Offset so the copy is visibly distinct from the original instead of
    // landing exactly on top of it.
    position: { x: src.position.x + 0.5, y: src.position.y, z: src.position.z + 0.5 },
  };
  const mesh = buildShapeMesh(ref);
  builderGroup.add(mesh);
  const entry = { ref, mesh };
  builderShapes.push(entry);
  selectBuilderShape(entry);
  refreshBuilderShapeList();
});

function refreshBuilderShapeList() {
  document.getElementById('builder-shape-count').textContent = builderShapes.length;
  document.getElementById('builder-shape-list').innerHTML = builderShapes
    .map((s, i) => `<div class="${s === selectedBuilderShape ? 'active' : ''}"><span data-select-builder-shape="${i}">${s.ref.kind} (${s.ref.id.slice(-5)})</span><button data-delete-builder-shape="${i}">✕</button></div>`)
    .join('');
}

// Click a row to select it — useful when the shape is occluded/hard to click
// in the 3D workspace; only the ✕ button deletes.
document.getElementById('builder-shape-list').addEventListener('click', (e) => {
  const deleteIdx = e.target.dataset.deleteBuilderShape;
  if (deleteIdx !== undefined) {
    const entry = builderShapes[parseInt(deleteIdx, 10)];
    if (!entry) return;
    selectBuilderShape(entry);
    document.getElementById('delete-builder-shape').click();
    return;
  }
  const selectIdx = e.target.dataset.selectBuilderShape;
  if (selectIdx === undefined) return;
  const entry = builderShapes[parseInt(selectIdx, 10)];
  if (entry) selectBuilderShape(entry);
});

const builderObjectIdEl = document.getElementById('builder-object-id');
const builderObjectNameEl = document.getElementById('builder-object-name');
const builderObjectStatusEl = document.getElementById('builder-object-status');

function clearBuilderWorkspace() {
  for (const s of builderShapes) builderGroup.remove(s.mesh);
  builderShapes.length = 0;
  selectBuilderShape(null);
  refreshBuilderShapeList();
}

function clearBuilderObjectForm() {
  editingObjectId = null;
  builderObjectIdEl.value = '';
  builderObjectIdEl.disabled = false;
  builderObjectNameEl.value = '';
  builderObjectStatusEl.textContent = '';
  clearBuilderWorkspace();
}

function loadObjectIntoForm(obj) {
  editingObjectId = obj.id;
  builderObjectIdEl.value = obj.id;
  builderObjectIdEl.disabled = true; // id is the stable key placed props reference by — don't let it drift while editing
  builderObjectNameEl.value = obj.name;
  builderObjectStatusEl.textContent = '';
  clearBuilderWorkspace();
  for (const shapeDef of obj.shapes) {
    const ref = structuredClone(shapeDef);
    const mesh = buildShapeMesh(ref);
    builderGroup.add(mesh);
    builderShapes.push({ ref, mesh });
  }
  refreshBuilderShapeList();
}

document.getElementById('new-builder-object-btn').addEventListener('click', clearBuilderObjectForm);

// Exports whatever is in the workspace right now, saved or not — the point is
// to hand somebody a file, and making them save to their own catalog first
// just to share is a step that buys nothing.
document.getElementById('export-builder-object-btn').addEventListener('click', () => {
  const id = builderObjectIdEl.value.trim();
  const name = builderObjectNameEl.value.trim();
  if (!id || !name) { builderObjectStatusEl.textContent = 'Give the object an id and a name before exporting.'; return; }
  if (!builderShapes.length) { builderObjectStatusEl.textContent = 'Add at least one shape first.'; return; }
  exportBuilderObject({ id, name, shapes: builderShapes.map((s) => s.ref) });
});

async function saveObjectCatalog() {
  const res = await fetch('/api/objects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(objectCatalog),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `server responded ${res.status}`);
  }
}

document.getElementById('save-builder-object-btn').addEventListener('click', async () => {
  const id = builderObjectIdEl.value.trim();
  if (!id) { builderObjectStatusEl.textContent = 'Object id is required.'; return; }
  const name = builderObjectNameEl.value.trim();
  if (!name) { builderObjectStatusEl.textContent = 'Object name is required.'; return; }
  if (!builderShapes.length) { builderObjectStatusEl.textContent = 'Add at least one shape first.'; return; }

  const obj = { id, name, shapes: builderShapes.map((s) => s.ref) };

  if (editingObjectId) {
    const idx = objectCatalog.findIndex((o) => o.id === editingObjectId);
    if (idx >= 0) objectCatalog[idx] = obj;
  } else {
    if (objectCatalog.some((o) => o.id === id)) {
      builderObjectStatusEl.textContent = `An object with id "${id}" already exists — click it in the catalog to edit instead.`;
      return;
    }
    objectCatalog.push(obj);
  }

  try {
    await saveObjectCatalog();
    refreshObjectCatalogById();
    loadObjectIntoForm(obj);
    builderObjectStatusEl.textContent = 'Saved ✓';
    refreshBuilderObjectList();
    rebuildAll(); // propagate shape edits to any already-placed instances of this object
  } catch (err) {
    builderObjectStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

/** Is this object def a file in the import folder rather than a row in objects.json? Those are read-only here: the file is the source of truth and this editor never writes back into it. */
const isImportedObject = (obj) => obj?.source === 'import-folder';

/**
 * Downloads an object as a `.json` file — the shareable form of an asset built
 * in this builder. Whoever receives it drops it into
 * src/generators/environment/import/ and it's in their palette's Imported tab;
 * nothing else on their side has to change, and they never touch a catalog
 * file. `source`/`category`/`file` are stripped: those are facts about where
 * THIS copy found the asset, not about the asset, and re-exporting an imported
 * object would otherwise bake one machine's bookkeeping into the share.
 */
function exportBuilderObject(obj) {
  const { source, category, file, ...clean } = obj;
  const blob = new Blob([JSON.stringify(clean, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${obj.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
  builderObjectStatusEl.textContent = `Exported "${obj.name}" as ${obj.id}.json — drop that file into another project's src/generators/environment/import/ folder.`;
}

function refreshBuilderObjectList() {
  document.getElementById('builder-object-count').textContent = objectCatalog.length;
  document.getElementById('builder-object-list').innerHTML = objectCatalog
    .map((o) => {
      const shapes = `<span class="hint">(${o.shapes.length} shapes${isImportedObject(o) ? `, imported from ${o.file}` : ''})</span>`;
      // An imported object gets ⧉ (copy into your own catalog, so you can
      // adapt somebody's asset) in place of ✎/✕ — editing or deleting it in
      // place would mean writing to a file the import folder owns.
      const buttons = isImportedObject(o)
        ? `<button data-copy-builder-object="${o.id}" title="Copy into your own catalog to edit">⧉</button>`
        : `<button data-edit-builder-object="${o.id}">✎</button><button data-delete-builder-object="${o.id}">✕</button>`;
      return `<div><span>${o.name} ${shapes}</span><button data-export-builder-object="${o.id}" title="Export as a shareable .json">⬇</button>${buttons}</div>`;
    })
    .join('');
}

document.getElementById('builder-object-list').addEventListener('click', async (e) => {
  const editId = e.target.dataset.editBuilderObject;
  const deleteId = e.target.dataset.deleteBuilderObject;
  const exportId = e.target.dataset.exportBuilderObject;
  const copyId = e.target.dataset.copyBuilderObject;
  if (exportId !== undefined) {
    const obj = objectCatalog.find((o) => o.id === exportId);
    if (obj) exportBuilderObject(obj);
    return;
  }
  if (copyId !== undefined) {
    const obj = objectCatalog.find((o) => o.id === copyId);
    if (!obj) return;
    // Loaded as a NEW object (id field left editable and pre-filled with a
    // free variant) rather than as an edit — saving must create a row in your
    // own catalog, not try to write back into the imported file.
    loadObjectIntoForm({ ...obj, id: '', name: `${obj.name} (copy)` });
    let candidate = `${obj.id}-copy`;
    for (let n = 2; objectCatalog.some((o) => o.id === candidate); n++) candidate = `${obj.id}-copy-${n}`;
    builderObjectIdEl.value = candidate;
    builderObjectIdEl.disabled = false; // loadObjectIntoForm locks the id for an EDIT; this is a new object, so it has to be typeable
    builderObjectStatusEl.textContent = `Copied "${obj.name}" into a new object — edit and save it as your own.`;
    return;
  }
  if (editId !== undefined) {
    const obj = objectCatalog.find((o) => o.id === editId);
    if (obj) loadObjectIntoForm(obj);
    return;
  }
  if (deleteId !== undefined) {
    const removed = objectCatalog;
    objectCatalog = objectCatalog.filter((o) => o.id !== deleteId);
    try {
      await saveObjectCatalog();
      refreshObjectCatalogById();
      refreshBuilderObjectList();
      if (editingObjectId === deleteId) clearBuilderObjectForm();
      rebuildAll(); // placed instances of the deleted object fall back to a generic shape
    } catch (err) {
      objectCatalog = removed; // save failed — don't leave the in-memory list ahead of what's on disk
      builderObjectStatusEl.textContent = `Delete failed: ${err.message}`;
    }
  }
});

// --- PATHS MODE ---
// Drawn pathways/roads (world.paths). Click or click-drag on the ground to
// sketch a draft polyline (live-previewed as a ribbon), Finish to save it.
// Click a saved path to select it: drag its control-point handles directly
// (matching the Character/NPC Builder's direct-manipulation gizmo rather
// than sliders-only), or edit width/theme, or delete it/a single point.
let customPathTextureCatalog = []; // [{id, name, url}], fetched from /api/path-textures
const pathThemePalettes = []; // every palette built by buildThemePalette, so uploads/loads can refresh them all

function buildThemePalette(container, onSelect) {
  const entry = { container, onSelect, selected: null };
  entry.render = () => {
    container.innerHTML = '';
    const items = [
      ...PATH_THEME_DEFS.map((t) => ({ id: t.id, label: t.label })),
      ...customPathTextureCatalog.map((c) => ({ id: `custom:${c.id}`, label: c.name })),
    ];
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.title = item.label;
      btn.appendChild(renderThemeSwatchCanvas(item.id, 32));
      btn.classList.toggle('active', item.id === entry.selected);
      btn.addEventListener('click', () => {
        entry.selected = item.id;
        entry.render();
        onSelect(item.id);
      });
      container.appendChild(btn);
    }
  };
  entry.render();
  pathThemePalettes.push(entry);
  return {
    setSelected(themeId) {
      entry.selected = themeId;
      entry.render();
    },
  };
}

function refreshPathThemePalettes() {
  for (const entry of pathThemePalettes) entry.render();
}

setCustomPathTextureLoadedCallback(() => {
  pathsDirty = true;
  refreshPathThemePalettes(); // the swatch for this id was a gray placeholder until now
});
fetch('/api/path-textures')
  .then((r) => r.json())
  .then((catalog) => {
    customPathTextureCatalog = catalog;
    for (const entry of catalog) registerCustomPathTexture(entry.id, entry.url);
    refreshPathThemePalettes();
  })
  .catch((err) => console.error('Failed to load custom path textures:', err));

const pathWidthEl = document.getElementById('path-width');
const pathWidthOutEl = document.getElementById('path-width-out');
const pathSelectedInfoEl = document.getElementById('path-selected-info');
const pathSelectedControlsEl = document.getElementById('path-selected-controls');
const pathSelectedWidthEl = document.getElementById('path-selected-width');
const pathSelectedWidthOutEl = document.getElementById('path-selected-width-out');
const pathListEl = document.getElementById('path-list');
const pathCountEl = document.getElementById('path-count');

const pathThemePalette = buildThemePalette(document.getElementById('path-theme-palette'), (themeId) => {
  pathTheme = themeId;
  if (pathDraft) pathsDirty = true;
});
pathThemePalette.setSelected(pathTheme);

const pathSelectedThemePalette = buildThemePalette(document.getElementById('path-selected-theme-palette'), (themeId) => {
  if (!selectedPath) return;
  selectedPath.ref.theme = themeId;
  pathsDirty = true;
});

// The draw-mode grade behaves exactly like the draw-mode Theme and Width
// beside it: it colours the live draft and is what the next finished path is
// created with. Sticky on purpose — drawing six roads for one district in the
// same shade shouldn't mean re-picking the colour six times.
buildColorGradeControls('path', (grade) => {
  pathDraftColorGrade = grade;
  if (pathDraft) pathsDirty = true;
});

const pathSelectedColorControls = buildColorGradeControls('path-selected', (grade) => {
  if (!selectedPath) return;
  storeColorGrade(selectedPath.ref, grade);
  pathsDirty = true;
});

const pathTexUploadStatusEl = document.getElementById('pathtex-upload-status');
document.getElementById('pathtex-upload-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('pathtex-upload-file');
  const nameInput = document.getElementById('pathtex-upload-name');
  const file = fileInput.files[0];
  if (!file) {
    pathTexUploadStatusEl.textContent = 'Choose an image file first.';
    return;
  }
  const formData = new FormData();
  formData.append('texture', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());
  pathTexUploadStatusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/path-textures/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    customPathTextureCatalog.push(data.entry);
    registerCustomPathTexture(data.entry.id, data.entry.url);
    pathTheme = `custom:${data.entry.id}`;
    refreshPathThemePalettes();
    pathThemePalette.setSelected(pathTheme);
    if (pathDraft) pathsDirty = true;
    fileInput.value = '';
    nameInput.value = '';
    pathTexUploadStatusEl.textContent = `Uploaded "${data.entry.name}" ✓`;
  } catch (err) {
    pathTexUploadStatusEl.textContent = `Upload failed: ${err.message}`;
  }
});

pathWidthEl.addEventListener('input', () => {
  pathWidthOutEl.textContent = pathWidthEl.value;
  if (pathDraft) pathsDirty = true;
});

// --- Path-to-path snapping ---
// Two roads meeting is the common case, and hitting the junction by eye left a
// visible seam or a gap every time. Snapping a dropped point onto an existing
// path's control point makes the two ribbons share an exact position, so they
// read as one continuous surface.
const pathSnapEl = document.getElementById('path-snap');
const pathSnapDistanceEl = document.getElementById('path-snap-distance');
const pathSnapDistanceOutEl = document.getElementById('path-snap-distance-out');
pathSnapDistanceEl.addEventListener('input', () => {
  pathSnapDistanceOutEl.textContent = pathSnapDistanceEl.value;
});

/**
 * The nearest control point on any OTHER path within the snap radius, or null.
 *
 * Endpoints win over mid-path points at equal distance: a path almost always
 * wants to start or end at another path's tip (a T-junction or a continuation),
 * and preferring the tip is what makes the two ribbons actually terminate
 * together instead of one overshooting past the join.
 *
 * @param {{x:number,z:number}} point
 * @param {Object|null} excludeRef  the path being drawn/edited, never snapped to itself
 */
function findPathSnapTarget(point, excludeRef = null) {
  if (!pathSnapEl.checked) return null;
  const maxDist = parseFloat(pathSnapDistanceEl.value) || 2.5;
  let best = null;
  for (const path of world.paths || []) {
    if (path === excludeRef) continue;
    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i];
      const d = Math.hypot(point.x - pt.x, point.z - pt.z);
      if (d > maxDist) continue;
      const isEnd = i === 0 || i === path.points.length - 1;
      // Endpoint preference implemented as a scoring bias, not a separate
      // pass, so a much closer mid-path point can still win.
      const score = d - (isEnd ? maxDist * 0.5 : 0);
      if (!best || score < best.score) best = { score, x: pt.x, z: pt.z, width: path.width, path };
    }
  }
  return best;
}

/**
 * `point`, moved onto a nearby path's control point when snapping applies.
 * Alt is the standard "place it exactly where I clicked" escape hatch.
 */
function snapPathPoint(point, altKey, excludeRef = null) {
  if (altKey) return { x: point.x, z: point.z };
  const target = findPathSnapTarget(point, excludeRef);
  if (!target) return { x: point.x, z: point.z };
  return { x: target.x, z: target.z, snappedWidth: target.width };
}

// --- Straight-segment drawing + angle snapping ---
// Drawing a straight road was the weak point of this mode: every pointerdown
// armed the freehand drag sampler, so the smallest wobble between pressing and
// releasing scattered extra points along the way, and even a perfectly still
// click gave no preview of where the segment was going until after it was
// committed. Straight mode turns both off — one point per click, with the
// pending segment rubber-banded to the cursor — and angle snapping constrains
// its direction so "exactly straight" and "exactly 90°" are hittable at all,
// rather than something you eyeball and then fix by dragging handles.
const pathStraightEl = document.getElementById('path-straight');
const pathAngleSnapEl = document.getElementById('path-angle-snap');
const pathAngleStepEl = document.getElementById('path-angle-step');
const pathAngleStepOutEl = document.getElementById('path-angle-step-out');
const pathAngleStepLabelEl = document.getElementById('path-angle-step-label');

pathAngleStepEl.addEventListener('input', () => {
  pathAngleStepOutEl.textContent = pathAngleStepEl.value;
  pathAngleStepLabelEl.textContent = pathAngleStepEl.value;
});

// Turning straight mode off mid-draft would otherwise leave the last
// rubber-band point frozen into the preview, since nothing updates it again.
pathStraightEl.addEventListener('change', () => {
  pathCursorPoint = null;
  if (pathDraft) pathDraftDirty = true;
});

/**
 * How far a new point must be from the previous one to count.
 *
 * Freehand drag-sampling needs a real distance (PATH_MIN_POINT_SPACING) or a
 * single stroke records hundreds of near-identical points. A straight-mode
 * click is a deliberate act, so it only needs enough to reject a genuine
 * double-click on the same spot — holding it to the drag threshold would
 * silently swallow short segments, which is exactly the kind of "my click did
 * nothing" that makes a tool feel broken.
 */
function pathMinPointSpacing() {
  return pathStraightEl.checked ? 0.05 : PATH_MIN_POINT_SPACING;
}

/**
 * `point`, rotated about `from` onto the nearest multiple of the angle step.
 * Distance from `from` is preserved — snapping decides the DIRECTION of the
 * segment, never how long it is.
 *
 * Shift FORCES snapping on, matching what Shift means in every drawing tool
 * there is (constrain). It used to invert the checkbox, so holding Shift while
 * the box was ticked — the obvious thing to do if you want a straight line —
 * silently turned the constraint OFF and the point landed off the line you
 * were aiming along. Turn the checkbox off for free angles; Alt (handled in
 * resolvePathPoint) is the full "exactly where I clicked" escape hatch.
 */
function snapPathAngle(from, point, shiftKey) {
  if (!from) return point;
  const snapping = pathAngleSnapEl.checked || !!shiftKey;
  if (!snapping) return point;
  const dx = point.x - from.x;
  const dz = point.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return point;
  const step = (parseFloat(pathAngleStepEl.value) || 15) * (Math.PI / 180);
  const angle = Math.round(Math.atan2(dz, dx) / step) * step;
  return { x: from.x + Math.cos(angle) * dist, z: from.z + Math.sin(angle) * dist };
}

/** The last committed point of the open draft — what a new segment's angle is measured from. Null for the very first point of a path, which has no direction to constrain. */
function pathDraftAnchor() {
  return pathDraft?.points.length ? pathDraft.points[pathDraft.points.length - 1] : null;
}

/**
 * Where a click actually lands: angle-snapped against the previous point
 * first, then moved onto a nearby path's control point if junction snapping
 * applies. Junction snapping runs LAST on purpose — meeting an existing road
 * exactly matters more than holding an exact angle, and it's the one the
 * author asked for by name.
 *
 * Alt short-circuits BOTH. It's documented as "place it exactly where I
 * clicked", and it only ever bypassed the junction snap: with angle snapping
 * layered on top, an Alt-click was still rotated off the cursor, so the one
 * escape hatch the mode offers didn't actually put the point where you
 * clicked.
 *
 * THE PREVIEW CALLS THIS TOO, and that is the point of it being one function.
 * The rubber band used to apply only the angle snap while the click applied
 * both, so any existing path within the junction radius made the committed
 * point jump somewhere the previewed segment never went — the click looked
 * like it had ignored where you put it.
 */
function resolvePathPoint(point, e) {
  if (e.altKey) return { x: point.x, z: point.z };
  const angled = pathStraightEl.checked ? snapPathAngle(pathDraftAnchor(), point, e.shiftKey) : point;
  return snapPathPoint(angled, false);
}

pathSelectedWidthEl.addEventListener('input', () => {
  pathSelectedWidthOutEl.textContent = pathSelectedWidthEl.value;
  if (selectedPath) {
    selectedPath.ref.width = parseFloat(pathSelectedWidthEl.value) || DEFAULT_PATH_WIDTH;
    pathsDirty = true;
  }
});

function finishPathDraft() {
  if (!pathDraft || pathDraft.points.length < 2) {
    statusLine.textContent = 'Path needs at least 2 points — click the ground to add more before finishing.';
    return;
  }
  const seed = Math.floor(Math.random() * 1e9);
  // Snap the FINAL point on finish as well as on click. A click-drag sketch
  // never gets the per-click snap (snapping mid-stroke would fight the drag),
  // so without this a freehand path drawn up to a junction still stops a
  // little short of it — the exact seam this feature exists to remove.
  const last = pathDraft.points[pathDraft.points.length - 1];
  const snappedEnd = snapPathPoint(last, false);
  last.x = snappedEnd.x;
  last.z = snappedEnd.z;
  const ref = {
    id: `path-${seed}`,
    theme: pathTheme,
    width: parseFloat(pathWidthEl.value) || DEFAULT_PATH_WIDTH,
    points: pathDraft.points,
  };
  // After the literal, so an untouched (identity) grade adds no field at all
  // rather than a no-op object on every path in world.json.
  storeColorGrade(ref, pathDraftColorGrade);
  world.paths.push(ref);
  pathDraft = null;
  pathPointerDown = false;
  pathCursorPoint = null;
  pathDraftDirty = false;
  pathsDirty = true;
  statusLine.textContent = `Path "${ref.id}" added — remember to Save World.`;
}

function cancelPathDraft() {
  pathDraft = null;
  pathPointerDown = false;
  pathCursorPoint = null;
  pathDraftDirty = false;
  pathsDirty = true;
}

// Double-click ends the path, the way every polyline tool does. The second
// click of the pair already tried to add a point and was rejected as a
// duplicate of the one just placed (pathMinPointSpacing), so this only has to
// finish — there's nothing to undo first.
canvas.addEventListener('dblclick', () => {
  if (mode === 'path' && pathDraft && pathStraightEl.checked) finishPathDraft();
});

document.getElementById('path-finish-btn').addEventListener('click', finishPathDraft);
document.getElementById('path-cancel-btn').addEventListener('click', cancelPathDraft);
document.getElementById('delete-path-btn').addEventListener('click', deleteSelectedPath);

function selectPath(entry) {
  selectedPath = entry || null;
  selectedPathHandleIndex = null;
  if (!selectedPath) {
    pathSelectedInfoEl.textContent = 'Nothing selected. Click a drawn path.';
    pathSelectedControlsEl.style.display = 'none';
  } else {
    pathSelectedInfoEl.textContent = `${selectedPath.ref.id} (${selectedPath.ref.points.length} points)`;
    pathSelectedControlsEl.style.display = 'block';
    pathSelectedWidthEl.value = selectedPath.ref.width ?? DEFAULT_PATH_WIDTH;
    pathSelectedWidthOutEl.textContent = pathSelectedWidthEl.value;
    pathSelectedThemePalette.setSelected(selectedPath.ref.theme || 'basic');
    pathSelectedColorControls.set(selectedPath.ref.colorGrade);
  }
  updatePathHandlePositions();
}

function deselectPath() {
  selectPath(null);
}

function deleteSelectedPath() {
  if (!selectedPath) return;
  world.paths = world.paths.filter((p) => p !== selectedPath.ref);
  selectPath(null);
  pathsDirty = true;
}

function deleteSelectedPathPoint() {
  if (!selectedPath || selectedPathHandleIndex == null) return;
  if (selectedPath.ref.points.length <= 2) {
    statusLine.textContent = 'A path needs at least 2 points.';
    return;
  }
  selectedPath.ref.points.splice(selectedPathHandleIndex, 1);
  selectedPathHandleIndex = null;
  pathsDirty = true;
}

function raycastPaths() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedPaths.map((p) => p.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return null;
  return placedPaths.find((p) => p.mesh === hits[0].object) || null;
}

/** Returns the control-point index of the handle under the cursor, or null. */
function raycastPathHandleIndex() {
  if (!pathHandleGroup.visible) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(pathHandleGroup.children, false);
  if (hits.length === 0) return null;
  const idx = pathHandleGroup.children.indexOf(hits[0].object);
  return idx === -1 ? null : idx;
}

function pathThemeLabel(themeId) {
  const theme = themeId || 'basic';
  if (theme.startsWith('custom:')) {
    const id = theme.slice(7);
    return customPathTextureCatalog.find((c) => c.id === id)?.name || theme;
  }
  return theme;
}

function refreshPathList() {
  const paths = world.paths || [];
  pathCountEl.textContent = paths.length;
  pathListEl.innerHTML = paths
    .map((p, i) => `<div><span>${p.id} (${pathThemeLabel(p.theme)}, ${p.points.length} pts)</span><button data-delete-path="${i}">✕</button></div>`)
    .join('');
}

pathListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deletePath;
  if (idx === undefined) return;
  const ref = (world.paths || [])[parseInt(idx, 10)];
  if (!ref) return;
  if (selectedPath && selectedPath.ref === ref) selectPath(null);
  world.paths = world.paths.filter((p) => p !== ref);
  pathsDirty = true;
});

// --- INVISIBLE WALL TOOL (Terrain mode) ---
// Mirrors the Paths section directly above: draft -> finish -> a saved entry
// with draggable control-point handles. See the state block near the top of
// this file for why the ribbon is editor-only.

const barrierThicknessEl = document.getElementById('barrier-thickness');
const barrierSelectedInfoEl = document.getElementById('barrier-selected-info');
const barrierSelectedControlsEl = document.getElementById('barrier-selected-controls');
const barrierListEl = document.getElementById('barrier-list');
const barrierCountEl = document.getElementById('barrier-count');

/**
 * A vertical ribbon standing on the terrain along the polyline — two vertices
 * per point (one on the ground, one BARRIER_WALL_HEIGHT above it) stitched
 * into a strip. Deliberately not the flat, draped ribbon a path uses: the
 * whole point of this tool is a WALL, and a flat stripe on the floor would
 * read as another path.
 */
function buildBarrierMesh(points, isDraft = false) {
  if (!points || points.length < 2) return null;
  const positions = [];
  const indices = [];
  for (let i = 0; i < points.length; i++) {
    const y = sampleTerrainHeight(world, points[i].x, points[i].z);
    positions.push(points[i].x, y, points[i].z);
    positions.push(points[i].x, y + BARRIER_WALL_HEIGHT, points[i].z);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const b0 = i * 2, t0 = i * 2 + 1, b1 = i * 2 + 2, t1 = i * 2 + 3;
    indices.push(b0, t0, b1, t0, t1, b1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    color: isDraft ? 0xff9955 : 0xff4444,
    transparent: true,
    opacity: isDraft ? 0.35 : 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 997;
  return mesh;
}

/** Rebuilds every saved wall's ribbon plus the in-progress draft's preview. Driven by barriersDirty, checked once per animate() frame — same throttle as rebuildPaths. */
function rebuildBarriers() {
  for (const b of placedBarriers) removeAndDispose(barrierGroup, b.mesh);
  placedBarriers.length = 0;
  for (const ref of world.barriers || []) {
    const mesh = buildBarrierMesh(ref.points);
    if (mesh) {
      barrierGroup.add(mesh);
      placedBarriers.push({ ref, mesh });
    }
  }
  removeAndDispose(barrierGroup, barrierDraftPreviewMesh);
  barrierDraftPreviewMesh = null;
  if (barrierDraft && barrierDraft.points.length >= 2) {
    barrierDraftPreviewMesh = buildBarrierMesh(barrierDraft.points, true);
    if (barrierDraftPreviewMesh) barrierGroup.add(barrierDraftPreviewMesh);
  }
  // The selected entry is re-created above, so re-point the selection at the
  // new wrapper for the same underlying ref rather than leaving it dangling.
  if (selectedBarrier) {
    selectedBarrier = placedBarriers.find((b) => b.ref === selectedBarrier.ref) || null;
  }
  updateBarrierHandlePositions();
  refreshBarrierList();
}

function updateBarrierHandlePositions() {
  barrierHandleGroup.clear();
  if (!selectedBarrier) {
    barrierHandleGroup.visible = false;
    return;
  }
  for (const pt of selectedBarrier.ref.points) {
    const handle = buildPathHandleMesh();
    handle.position.set(pt.x, sampleTerrainHeight(world, pt.x, pt.z) + 0.4, pt.z);
    barrierHandleGroup.add(handle);
  }
  barrierHandleGroup.visible = mode === 'terrain' && terrainToolMode === 'barrier';
}

function finishBarrierDraft() {
  if (!barrierDraft || barrierDraft.points.length < 2) {
    statusLine.textContent = 'An invisible wall needs at least 2 points — click the ground to add more before finishing.';
    return;
  }
  const ref = {
    id: `barrier-${Math.floor(Math.random() * 1e9)}`,
    points: barrierDraft.points,
    thickness: parseFloat(barrierThicknessEl.value) || DEFAULT_BARRIER_THICKNESS,
  };
  if (!world.barriers) world.barriers = [];
  world.barriers.push(ref);
  barrierDraft = null;
  barrierPointerDown = false;
  barriersDirty = true;
  markDirty();
  statusLine.textContent = `Invisible wall "${ref.id}" added — remember to Save World.`;
}

function cancelBarrierDraft() {
  barrierDraft = null;
  barrierPointerDown = false;
  barriersDirty = true;
}

function selectBarrier(entry) {
  selectedBarrier = entry || null;
  selectedBarrierHandleIndex = null;
  if (!selectedBarrier) {
    barrierSelectedInfoEl.textContent = 'Nothing selected. Click a wall to select it.';
    barrierSelectedControlsEl.style.display = 'none';
  } else {
    barrierSelectedInfoEl.textContent = `${selectedBarrier.ref.id} (${selectedBarrier.ref.points.length} points)`;
    barrierSelectedControlsEl.style.display = 'block';
    barrierThicknessEl.value = selectedBarrier.ref.thickness ?? DEFAULT_BARRIER_THICKNESS;
  }
  updateBarrierHandlePositions();
}

function deleteSelectedBarrier() {
  if (!selectedBarrier) return;
  world.barriers = (world.barriers || []).filter((b) => b !== selectedBarrier.ref);
  selectBarrier(null);
  barriersDirty = true;
  markDirty();
}

function deleteSelectedBarrierPoint() {
  if (!selectedBarrier || selectedBarrierHandleIndex == null) return;
  if (selectedBarrier.ref.points.length <= 2) {
    statusLine.textContent = 'An invisible wall needs at least 2 points.';
    return;
  }
  selectedBarrier.ref.points.splice(selectedBarrierHandleIndex, 1);
  selectedBarrierHandleIndex = null;
  barriersDirty = true;
  markDirty();
}

function raycastBarriers() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(placedBarriers.map((b) => b.mesh), false);
  if (hits.length === 0) return null;
  return placedBarriers.find((b) => b.mesh === hits[0].object) || null;
}

function raycastBarrierHandleIndex() {
  if (!barrierHandleGroup.visible) return null;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(barrierHandleGroup.children, false);
  if (hits.length === 0) return null;
  const idx = barrierHandleGroup.children.indexOf(hits[0].object);
  return idx === -1 ? null : idx;
}

function refreshBarrierList() {
  const barriers = world?.barriers || [];
  barrierCountEl.textContent = barriers.length;
  barrierListEl.innerHTML = barriers
    .map((b, i) => `<div><span>${b.id} (${b.points.length} pts)</span><button data-delete-barrier="${i}">✕</button></div>`)
    .join('');
}

barrierListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deleteBarrier;
  if (idx === undefined) return;
  const ref = (world.barriers || [])[parseInt(idx, 10)];
  if (!ref) return;
  if (selectedBarrier && selectedBarrier.ref === ref) selectBarrier(null);
  world.barriers = world.barriers.filter((b) => b !== ref);
  barriersDirty = true;
  markDirty();
});

barrierThicknessEl.addEventListener('input', () => {
  if (!selectedBarrier) return;
  selectedBarrier.ref.thickness = parseFloat(barrierThicknessEl.value) || DEFAULT_BARRIER_THICKNESS;
});

document.getElementById('finish-barrier-btn').addEventListener('click', finishBarrierDraft);
document.getElementById('cancel-barrier-btn').addEventListener('click', cancelBarrierDraft);
document.getElementById('delete-barrier-btn').addEventListener('click', deleteSelectedBarrier);

// Terrain mode's Sculpt / Invisible Wall tool toggle. (`terrainToolMode`
// itself lives with the other barrier state near the top of this file.)
function setTerrainToolMode(newMode) {
  terrainToolMode = newMode;
  document.getElementById('terrain-tool-sculpt').classList.toggle('active', newMode === 'sculpt');
  document.getElementById('terrain-tool-barrier').classList.toggle('active', newMode === 'barrier');
  document.getElementById('terrain-sculpt-controls').style.display = newMode === 'sculpt' ? 'block' : 'none';
  document.getElementById('terrain-barrier-controls').style.display = newMode === 'barrier' ? 'block' : 'none';
  if (newMode !== 'barrier') {
    cancelBarrierDraft();
    selectBarrier(null);
  }
  setBarrierVisibility();
  brushRing.visible = false;
}
document.getElementById('terrain-tool-sculpt').addEventListener('click', () => setTerrainToolMode('sculpt'));
document.getElementById('terrain-tool-barrier').addEventListener('click', () => setTerrainToolMode('barrier'));

/** Walls are only drawn while their own tool is selected — they're invisible in the real game, so leaving red ribbons up in every other mode would misrepresent the map. */
function setBarrierVisibility() {
  barrierGroup.visible = mode === 'terrain' && terrainToolMode === 'barrier';
  barrierHandleGroup.visible = barrierGroup.visible && selectedBarrier != null;
}

window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'terrain' || terrainToolMode !== 'barrier') return;
  if (e.key === 'Enter') {
    if (barrierDraft) finishBarrierDraft();
  } else if (e.key === 'Escape') {
    if (barrierDraft) cancelBarrierDraft();
    else if (selectedBarrier) selectBarrier(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedBarrierHandleIndex != null) deleteSelectedBarrierPoint();
  }
});

// Enter finishes the current draft, Escape cancels a draft (or deselects a
// selected path), Delete/Backspace removes the currently-selected control
// point — all scoped to Paths mode, guarded against typing in a form field
// the same way the MODE_KEYS listener above is.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'path') return;
  if (e.key === 'Enter') {
    if (pathDraft) finishPathDraft();
  } else if (e.key === 'Escape') {
    if (pathDraft) cancelPathDraft();
    else if (selectedPath) selectPath(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedPathHandleIndex != null) deleteSelectedPathPoint();
  }
});

// --- MOUNTAINS MODE ---
// Drawn mountain ridges (world.mountains). Click or click-drag on the ground
// to sketch a draft polyline (live-previewed as a ribbon, flat until
// finished — see rebuildMountains's comment), Finish to save it and
// permanently raise the terrain under it. Click a saved ridge to select it
// and tweak width/peak height/theme; no control-point dragging (see the
// MOUNTAINS MODE state comment above for why).
function buildMountainThemePalette(container, onSelect) {
  container.innerHTML = '';
  const buttons = [];
  for (const theme of MOUNTAIN_THEME_DEFS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = theme.label;
    btn.appendChild(renderMountainThemeSwatchCanvas(theme.id, 32));
    btn.addEventListener('click', () => {
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(theme.id);
    });
    container.appendChild(btn);
    buttons.push(btn);
  }
  return {
    setSelected(themeId) {
      buttons.forEach((b, i) => b.classList.toggle('active', MOUNTAIN_THEME_DEFS[i].id === themeId));
    },
  };
}

const mountainWidthEl = document.getElementById('mountain-width');
const mountainWidthOutEl = document.getElementById('mountain-width-out');
const mountainPeakHeightEl = document.getElementById('mountain-peak-height');
const mountainPeakHeightOutEl = document.getElementById('mountain-peak-height-out');
const mountainSelectedInfoEl = document.getElementById('mountain-selected-info');
const mountainSelectedControlsEl = document.getElementById('mountain-selected-controls');
const mountainSelectedWidthEl = document.getElementById('mountain-selected-width');
const mountainSelectedWidthOutEl = document.getElementById('mountain-selected-width-out');
const mountainSelectedPeakHeightEl = document.getElementById('mountain-selected-peak-height');
const mountainSelectedPeakHeightOutEl = document.getElementById('mountain-selected-peak-height-out');
const mountainListEl = document.getElementById('mountain-list');
const mountainCountEl = document.getElementById('mountain-count');

const mountainThemePalette = buildMountainThemePalette(document.getElementById('mountain-theme-palette'), (themeId) => {
  mountainTheme = themeId;
  if (mountainDraft) mountainsDirty = true;
});
mountainThemePalette.setSelected(mountainTheme);

const mountainSelectedThemePalette = buildMountainThemePalette(document.getElementById('mountain-selected-theme-palette'), (themeId) => {
  if (!selectedMountain) return;
  selectedMountain.ref.theme = themeId;
  mountainsDirty = true;
});

mountainWidthEl.addEventListener('input', () => {
  mountainWidthOutEl.textContent = mountainWidthEl.value;
  if (mountainDraft) mountainsDirty = true;
});
mountainPeakHeightEl.addEventListener('input', () => {
  mountainPeakHeightOutEl.textContent = mountainPeakHeightEl.value;
  if (mountainDraft) mountainsDirty = true;
});

// Width/peak height on an already-finished ridge: the ribbon mesh (cheap)
// live-updates on every 'input' tick same as the draft above, but
// re-stamping the heightmap (an O(resolution^2 * ridge length) scan) only
// runs on 'change' — i.e. once, when the slider is released — so dragging
// the slider doesn't hitch the editor on every intermediate frame.
mountainSelectedWidthEl.addEventListener('input', () => {
  if (!selectedMountain) return;
  mountainSelectedWidthOutEl.textContent = mountainSelectedWidthEl.value;
  selectedMountain.ref.width = parseFloat(mountainSelectedWidthEl.value) || DEFAULT_MOUNTAIN_WIDTH;
  mountainsDirty = true;
});
mountainSelectedWidthEl.addEventListener('change', () => {
  if (!selectedMountain) return;
  stampMountainHeight(world, selectedMountain.ref);
  terrainDirty = true;
  mountainsDirty = true;
});
mountainSelectedPeakHeightEl.addEventListener('input', () => {
  if (!selectedMountain) return;
  mountainSelectedPeakHeightOutEl.textContent = mountainSelectedPeakHeightEl.value;
  selectedMountain.ref.peakHeight = parseFloat(mountainSelectedPeakHeightEl.value) || DEFAULT_PEAK_HEIGHT;
  mountainsDirty = true;
});
mountainSelectedPeakHeightEl.addEventListener('change', () => {
  if (!selectedMountain) return;
  stampMountainHeight(world, selectedMountain.ref);
  terrainDirty = true;
  mountainsDirty = true;
});

function finishMountainDraft() {
  if (!mountainDraft || mountainDraft.points.length < 2) {
    statusLine.textContent = 'Mountain ridge needs at least 2 points — click the ground to add more before finishing.';
    return;
  }
  const seed = Math.floor(Math.random() * 1e9);
  const ref = {
    id: `mountain-${seed}`,
    theme: mountainTheme,
    width: parseFloat(mountainWidthEl.value) || DEFAULT_MOUNTAIN_WIDTH,
    peakHeight: parseFloat(mountainPeakHeightEl.value) || DEFAULT_PEAK_HEIGHT,
    points: mountainDraft.points,
  };
  stampMountainHeight(world, ref);
  world.mountains.push(ref);
  mountainDraft = null;
  mountainPointerDown = false;
  terrainDirty = true;
  mountainsDirty = true;
  statusLine.textContent = `Mountain ridge "${ref.id}" added — remember to Save World.`;
}

function cancelMountainDraft() {
  mountainDraft = null;
  mountainPointerDown = false;
  mountainsDirty = true;
}

document.getElementById('mountain-finish-btn').addEventListener('click', finishMountainDraft);
document.getElementById('mountain-cancel-btn').addEventListener('click', cancelMountainDraft);
document.getElementById('delete-mountain-btn').addEventListener('click', deleteSelectedMountain);

function selectMountain(entry) {
  selectedMountain = entry || null;
  if (!selectedMountain) {
    mountainSelectedInfoEl.textContent = 'Nothing selected. Click a drawn mountain ridge.';
    mountainSelectedControlsEl.style.display = 'none';
  } else {
    mountainSelectedInfoEl.textContent = `${selectedMountain.ref.id} (${selectedMountain.ref.points.length} points)`;
    mountainSelectedControlsEl.style.display = 'block';
    mountainSelectedWidthEl.value = selectedMountain.ref.width ?? DEFAULT_MOUNTAIN_WIDTH;
    mountainSelectedWidthOutEl.textContent = mountainSelectedWidthEl.value;
    mountainSelectedPeakHeightEl.value = selectedMountain.ref.peakHeight ?? DEFAULT_PEAK_HEIGHT;
    mountainSelectedPeakHeightOutEl.textContent = mountainSelectedPeakHeightEl.value;
    mountainSelectedThemePalette.setSelected(selectedMountain.ref.theme || 'rock');
  }
}

function deselectMountain() {
  selectMountain(null);
}

function deleteSelectedMountain() {
  if (!selectedMountain) return;
  // Only removes the ridge mesh/entry — the terrain it raised stays raised
  // (see stampMountainHeight's doc comment; there's no per-feature undo for
  // terrain height anywhere in this editor, "Clear All Terrain" is the only
  // way back to flat).
  world.mountains = world.mountains.filter((m) => m !== selectedMountain.ref);
  selectMountain(null);
  mountainsDirty = true;
}

function raycastMountains() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedMountains.map((m) => m.mesh);
  const hits = raycaster.intersectObjects(meshes, false);
  if (hits.length === 0) return null;
  return placedMountains.find((m) => m.mesh === hits[0].object) || null;
}

function refreshMountainList() {
  const mountains = world.mountains || [];
  mountainCountEl.textContent = mountains.length;
  mountainListEl.innerHTML = mountains
    .map((m, i) => `<div><span>${m.id} (${m.theme || 'rock'}, peak ${m.peakHeight})</span><button data-delete-mountain="${i}">✕</button></div>`)
    .join('');
}

mountainListEl.addEventListener('click', (e) => {
  const idx = e.target.dataset.deleteMountain;
  if (idx === undefined) return;
  const ref = (world.mountains || [])[parseInt(idx, 10)];
  if (!ref) return;
  if (selectedMountain && selectedMountain.ref === ref) selectMountain(null);
  world.mountains = world.mountains.filter((m) => m !== ref);
  mountainsDirty = true;
});

// Enter finishes the current draft, Escape cancels a draft (or deselects a
// selected ridge) — same semantics as Paths above, scoped to Mountains mode.
// No Delete/Backspace-a-point handler: mountain ridges have no draggable/
// deletable control points (see the MOUNTAINS MODE state comment above).
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'mountains') return;
  if (e.key === 'Enter') {
    if (mountainDraft) finishMountainDraft();
  } else if (e.key === 'Escape') {
    if (mountainDraft) cancelMountainDraft();
    else if (selectedMountain) selectMountain(null);
  }
});

// Same Enter/Escape/Delete semantics as Paths above, scoped to Zones mode's
// Freeform shape.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'zones' || zoneShapeMode !== 'freeform') return;
  if (e.key === 'Enter') {
    if (freeformZoneDraft) finishFreeformZoneDraft();
  } else if (e.key === 'Escape') {
    if (freeformZoneDraft) cancelFreeformZoneDraft();
    else if (selectedFreeformZone) selectFreeformZone(null);
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedFreeformZoneHandleIndex != null) deleteSelectedFreeformZonePoint();
  }
});

// Escape deselects a selected lake — no draft/points to finish/cancel/
// delete anymore now that a lake is a plain rectangle edited by fields.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'water' || waterToolMode !== 'lake') return;
  if (e.key === 'Escape' && selectedLakeBody) deselectLakeBody();
});

// Same Enter/Escape/Delete semantics as the Lake sub-tool above, scoped to
// Water mode's River sub-tool. No click-to-close (Enter only) since a
// river is an open polyline, not a closed shape.
window.addEventListener('keydown', (e) => {
  if (isTypingInFormField()) return;
  if (mode !== 'water' || waterToolMode !== 'river') return;
  if (e.key === 'Enter') {
    if (riverDraft) finishRiverDraft();
  } else if (e.key === 'Escape') {
    if (riverDraft) cancelRiverDraft();
    else if (selectedRiver) deselectRiver();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selectedRiverHandleIndex != null) deleteSelectedRiverPoint();
  }
});

function refreshLists() {
  // Every path that adds or removes a placed prop ends up here, so it's the
  // one choke point where the wind-animated set can have changed too.
  swayablesDirty = true;
  document.getElementById('prop-count').textContent = placedItems.length;
  refreshNpcList();
  document.getElementById('obj-list').innerHTML = placedItems
    .map((item, i) => `<div><span>${item.kind} (${item.ref.seed})</span><button data-delete-obj="${i}">✕</button></div>`)
    .join('');

  zoneCountEl.textContent = world.zones.filter((z) => z.type === 'gathering').length;
  zoneListEl.innerHTML = world.zones
    .filter((z) => z.type === 'gathering')
    .map((z) => `<div><span>${z.id} (${z.resource})</span><button data-delete-zone="${z.id}">✕</button></div>`)
    .join('');

  document.getElementById('bld-list').innerHTML = world.buildings
    .map((b) => {
      const typeLabel = b.type === 'custom'
        ? (buildingCatalogForRender.typesById[b.buildingTypeId]?.name || `custom:${b.buildingTypeId}`)
        : b.type;
      return `<div>${b.id} — ${typeLabel}${b.interiorId ? ' → ' + b.interiorId : ''} <button data-delete-building="${b.id}">✕</button></div>`;
    })
    .join('');
}

// --- Pointer interaction, dispatched by mode ---
canvas.addEventListener('pointerdown', (e) => {
  if (!world || e.button !== 0) return;
  updatePointer(e);
  // Left-click on the canvas is an authoring action in every mode (place,
  // paint, draw, or select-then-drag). A few of those turn out to be a pure
  // selection that changes nothing — see markDirty's note on why that
  // over-report is the side to err on. Camera navigation is right/middle
  // drag, already filtered out by the button check above.
  markDirty();
  // Same coarse "any canvas authoring click" checkpoint markDirty uses — see
  // pushUndoSnapshot. A click that turns out to be a pure selection just
  // costs one redundant snapshot.
  pushUndoSnapshot(`${mode} edit`, undoKeysForCurrentTool());

  if (mode === 'place') {
    if (armedPlaceType) {
      const point = raycastGround();
      if (point) placeAt(armedPlaceType, point);
      // Unarm after placing so the next click selects/edits an object
      // instead of stacking another instance on top of it. Re-pick the
      // palette cell to place again.
      armedPlaceType = null;
      armedCustomObjectId = null;
      armedModelId = null;
      placePalette.setSelected(null);
      statusLine.textContent = 'Placed. Click an object to select it, or pick a palette item to place another.';
      return;
    }
    const hit = raycastPlacedItems();
    // Alt (or Shift) is the multi-select modifier — nothing is committed here,
    // see the marquee comment block for why the decision waits for pointerup.
    if (e.altKey || e.shiftKey) {
      marquee = { startX: e.clientX, startY: e.clientY, curX: e.clientX, curY: e.clientY, hit, active: false };
      return;
    }
    // Grabbing something that's already part of a multi-selection drags the
    // whole set; grabbing anything else selects just that one, as before.
    if (hit && multiSelected.has(hit) && multiSelected.size > 1) selectItem(hit, { keepMulti: true });
    else selectItem(hit);
    if (hit) {
      dragging = true;
      beginGroupDrag();
    }
  } else if (mode === 'terrain' && terrainToolMode === 'barrier') {
    const point = raycastGround();
    if (!point) return;
    if (!barrierDraft) {
      // Handles take priority over re-selecting, same order as the River/Lake
      // tools — a handle sits on top of the ribbon it belongs to.
      const handleIdx = raycastBarrierHandleIndex();
      if (handleIdx != null) {
        selectedBarrierHandleIndex = handleIdx;
        barrierHandleDragging = true;
        return;
      }
      const hit = raycastBarriers();
      if (hit) {
        selectBarrier(hit);
        return;
      }
      selectBarrier(null);
      barrierDraft = { points: [{ x: point.x, z: point.z }] };
      barrierPointerDown = true;
      barriersDirty = true;
    } else {
      barrierPointerDown = true;
      const last = barrierDraft.points[barrierDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > BARRIER_MIN_POINT_SPACING) {
        barrierDraft.points.push({ x: point.x, z: point.z });
        barriersDirty = true;
      }
    }
  } else if (mode === 'terrain') {
    dragging = true;
    const point = raycastGround();
    if (point) paintTerrain(point, e.shiftKey);
  } else if (mode === 'water' && waterToolMode === 'paint') {
    if (armedWaterErase) {
      const point = raycastGround();
      if (point) eraseConnectedWaterBody(point);
      armedWaterErase = false;
      return;
    }
    dragging = true;
    const point = raycastGround();
    if (point) paintWater(point, e.shiftKey);
  } else if (mode === 'water' && waterToolMode === 'lake') {
    if (armedLakePlacement) {
      const point = raycastGround();
      if (point) placeLakeAt(point);
      return;
    }
    // Handles take priority over re-selecting, same order as the River tool
    // (a handle sits ON the water surface, so a plain body raycast would win
    // every time otherwise).
    const handleIdx = raycastLakeHandleIndex();
    if (handleIdx != null) {
      selectedLakeHandleIndex = handleIdx;
      lakeHandleDragging = true;
      return;
    }
    const hit = raycastLakeBodies();
    selectLakeBody(hit); // clicking empty water-mode ground with nothing under it deselects, same as elsewhere
    statusLine.textContent = hit
      ? `Lake "${hit.body.id}" selected — drag a yellow corner to resize, the blue center to move, or use the fields.`
      : 'Nothing selected. Click a lake to select it, or "Place Lake" to add one.';
  } else if (mode === 'water' && waterToolMode === 'river') {
    const point = raycastGround();
    if (!point) return;
    if (!riverDraft) {
      const handleIdx = raycastRiverHandleIndex();
      if (handleIdx != null) {
        selectedRiverHandleIndex = handleIdx;
        riverHandleDragging = true;
        return;
      }
      const hit = raycastRivers();
      if (hit) {
        selectRiver(hit);
        return;
      }
      // Nothing hit — start a brand new draft at this point. Rivers are an
      // OPEN polyline (no click-near-start-to-close like the Lake tool).
      deselectRiver();
      riverDraft = { points: [{ x: point.x, z: point.z }], surfaceHeights: [sampleTerrainHeight(world, point.x, point.z)] };
      riverPointerDown = true;
      riversDirty = true;
    } else {
      riverPointerDown = true;
      const last = riverDraft.points[riverDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > RIVER_MIN_POINT_SPACING) {
        const heights = riverDraft.surfaceHeights;
        riverDraft.points.push({ x: point.x, z: point.z });
        heights.push(Math.min(sampleTerrainHeight(world, point.x, point.z), heights[heights.length - 1]));
        riversDirty = true;
      }
    }
  } else if (mode === 'water' && waterToolMode === 'puddle') {
    const point = raycastGround();
    if (!point) return;
    placePuddleAt(point);
    lastPuddlePlacePoint = point;
    puddlePointerDown = true;
  } else if (mode === 'groundtex') {
    dragging = true;
    const point = raycastGround();
    if (point) paintGroundTexture(point, e.shiftKey);
  } else if (mode === 'scatter') {
    scatterDragging = true;
    const point = raycastGround();
    if (point) {
      scatterTick(point, e.shiftKey);
      lastScatterTick = performance.now();
    }
  } else if (mode === 'zones' && zoneShapeMode === 'circle') {
    const point = raycastGround();
    if (!point) return;
    const previewMesh = buildZoneMarker({
      resource: document.getElementById('zone-type').value === 'gathering'
        ? document.getElementById('zone-resource').value
        : 'wood_and_herbs',
      center: { x: point.x, y: 0, z: point.z },
      radius: 1,
    });
    scene.add(previewMesh);
    zoneDraft = { center: { x: point.x, z: point.z }, previewMesh };
  } else if (mode === 'zones' && zoneShapeMode === 'freeform') {
    const point = raycastGround();
    if (!point) return;
    if (!freeformZoneDraft) {
      const handleIdx = raycastFreeformZoneHandleIndex();
      if (handleIdx != null) {
        selectedFreeformZoneHandleIndex = handleIdx;
        freeformZoneHandleDragging = true;
        return;
      }
      const hit = raycastFreeformZones();
      if (hit) {
        selectFreeformZone(hit);
        return;
      }
      // Nothing hit — start a brand new draft at this point.
      deselectFreeformZone();
      freeformZoneDraft = { points: [{ x: point.x, z: point.z }] };
      freeformZonePointerDown = true;
      freeformZonesDirty = true;
    } else {
      freeformZonePointerDown = true;
      const first = freeformZoneDraft.points[0];
      if (freeformZoneDraft.points.length >= 3 && Math.hypot(point.x - first.x, point.z - first.z) < FREEFORM_ZONE_CLOSE_DISTANCE) {
        finishFreeformZoneDraft();
        return;
      }
      const last = freeformZoneDraft.points[freeformZoneDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > FREEFORM_ZONE_MIN_POINT_SPACING) {
        freeformZoneDraft.points.push({ x: point.x, z: point.z });
        freeformZonesDirty = true;
      }
    }
  } else if (mode === 'buildings') {
    if (armedBuilding) {
      const point = raycastGround();
      if (point) placeBuildingAt(point);
    }
  } else if (mode === 'monsters') {
    if (monScatterActiveEl.checked) {
      monsterScatterDragging = true;
      const point = isOverworldMonsters() ? raycastGround() : raycastFloorGround();
      if (point) {
        monsterScatterTick(point, e.shiftKey);
        lastMonsterScatterTick = performance.now();
      }
      return;
    }
    if (armedMonsterPlacement) {
      const point = isOverworldMonsters() ? raycastGround() : raycastFloorGround();
      if (point) placeMonsterAt(point);
      return;
    }
    selectMonster(raycastMonsters());
  } else if (mode === 'npcs') {
    if (armedNpcPlacement) {
      const point = raycastGround();
      if (point) placeNpcAt(point);
      return;
    }
    const hit = raycastNpcs();
    selectNpc(hit);
    if (hit) {
      npcDragging = true;
      statusLine.textContent = `NPC "${hit.ref.name}" selected — drag to move, or use the Facing field to turn it.`;
    }
  } else if (mode === 'teleporters') {
    if (armedTeleporter) {
      const point = raycastGround();
      if (point) placeTeleporterAt(point);
      return;
    }
    selectTeleporter(raycastTeleporters());
  } else if (mode === 'particles') {
    if (armedParticleMove && selectedEmitter) {
      const point = raycastGround();
      if (point) {
        selectedEmitter.ref.position.x = snap(point.x);
        selectedEmitter.ref.position.z = snap(point.z);
        selectedEmitter.mesh.position.set(selectedEmitter.ref.position.x, selectedEmitter.ref.position.y || 0, selectedEmitter.ref.position.z);
        respawnParticleEmitters();
      }
      armedParticleMove = false;
      return;
    }
    if (armedParticlePlacement) {
      const point = raycastGround();
      if (point) placeEmitterAt(point);
      return;
    }
    selectEmitter(raycastEmitters());
  } else if (mode === 'lights') {
    if (armedLightMove && selectedLight) {
      const point = raycastGround();
      if (point) {
        selectedLight.ref.position.x = snap(point.x);
        selectedLight.ref.position.z = snap(point.z);
        refreshLightGizmo(selectedLight);
        respawnLightSources();
      }
      armedLightMove = false;
      return;
    }
    if (armedLightPlacement) {
      const point = raycastGround();
      if (point) placeLightAt(point);
      return;
    }
    selectLight(raycastLights());
  } else if (mode === 'events') {
    if (armedAttachPick) {
      const hit = raycastAttachableTargets();
      if (hit) applyAttachPick(hit);
      armedAttachPick = false;
      return;
    }
    if (armedEventPlacement) {
      const point = raycastGround();
      if (point) placeEventAt(point);
      return;
    }
    const hit = raycastEvents();
    selectEvent(hit);
    if (hit) {
      eventDragging = true;
      statusLine.textContent = 'Event selected — drag to move.';
    }
  } else if (mode === 'object-builder') {
    const hit = raycastBuilderShapes();
    selectBuilderShape(hit);
    if (hit) {
      pushBuilderUndo();
      builderDragging = true;
      // Capture the offset between the shape's own position and the plane
      // point under the cursor right now, so the drag moves it relative to
      // where it was grabbed instead of snapping its origin to the cursor.
      const planePoint = raycastBuilderPlane();
      builderDragOffset = planePoint
        ? { x: hit.ref.position.x - planePoint.x, z: hit.ref.position.z - planePoint.z }
        : { x: 0, z: 0 };
    }
  } else if (mode === 'path') {
    const point = raycastGround();
    if (!point) return;
    if (!pathDraft) {
      const handleIdx = raycastPathHandleIndex();
      if (handleIdx != null) {
        selectedPathHandleIndex = handleIdx;
        pathHandleDragging = true;
        return;
      }
      const hit = raycastPaths();
      if (hit) {
        selectPath(hit);
        return;
      }
      // Nothing hit — start a brand new draft at this point. A path that
      // BEGINS on another path's end is the whole point of snapping, so the
      // very first click gets it too, and adopts that path's width so the
      // join doesn't step.
      deselectPath();
      const start = snapPathPoint(point, e.altKey);
      if (start.snappedWidth) {
        pathWidthEl.value = start.snappedWidth;
        pathWidthOutEl.textContent = start.snappedWidth;
      }
      pathDraft = { points: [{ x: start.x, z: start.z }] };
      // Straight mode never arms the freehand drag sampler — that sampler is
      // exactly what turned a click into a spray of points, so a road drawn
      // with a slightly unsteady hand came out wobbly.
      pathPointerDown = !pathStraightEl.checked;
      pathCursorPoint = null;
      pathsDirty = true;
      if (pathStraightEl.checked) statusLine.textContent = 'Path: 1 point. Click to add the next, Enter to finish, Escape to cancel.';
    } else {
      pathPointerDown = !pathStraightEl.checked;
      const last = pathDraft.points[pathDraft.points.length - 1];
      const snapped = resolvePathPoint(point, e);
      if (Math.hypot(snapped.x - last.x, snapped.z - last.z) > pathMinPointSpacing()) {
        pathDraft.points.push({ x: snapped.x, z: snapped.z });
        pathCursorPoint = null; // consumed — the rubber band restarts from this new point
        pathsDirty = true;
        // A committed point looks identical to the rubber band that was
        // already drawn there, so without this the click has no visible
        // effect at all and reads as having been dropped.
        if (pathStraightEl.checked) statusLine.textContent = `Path: ${pathDraft.points.length} points. Click to add the next, Enter to finish, Escape to cancel.`;
      } else if (pathStraightEl.checked) {
        statusLine.textContent = 'That point is on top of the previous one — click further away to add it.';
      }
    }
  } else if (mode === 'mountains') {
    const point = raycastGround();
    if (!point) return;
    if (!mountainDraft) {
      const hit = raycastMountains();
      if (hit) {
        selectMountain(hit);
        return;
      }
      // Nothing hit — start a brand new draft at this point.
      deselectMountain();
      mountainDraft = { points: [{ x: point.x, z: point.z }] };
      mountainPointerDown = true;
      mountainsDirty = true;
    } else {
      mountainPointerDown = true;
      const last = mountainDraft.points[mountainDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > MOUNTAIN_MIN_POINT_SPACING) {
        mountainDraft.points.push({ x: point.x, z: point.z });
        mountainsDirty = true;
      }
    }
  } else if (mode === 'maps' && armedSpawnPoint) {
    const point = raycastGround();
    if (!point) return;
    // Facing is carried over, not reset — moving where players appear
    // shouldn't silently spin them back to north.
    world.spawnPoint = { x: snap(point.x), y: 0, z: snap(point.z), facingDeg: world.spawnPoint.facingDeg || 0 };
    rebuildSpawnPointMarker();
    const xEl = document.getElementById('map-spawn-x');
    const zEl = document.getElementById('map-spawn-z');
    if (xEl) xEl.value = world.spawnPoint.x;
    if (zEl) zEl.value = world.spawnPoint.z;
    armedSpawnPoint = false;
    statusLine.textContent = `Spawn point set to (${world.spawnPoint.x}, ${world.spawnPoint.z})`;
  } else if (mode === 'maps' && armedSpawnFacing) {
    const point = raycastGround();
    if (!point) return;
    const dx = point.x - world.spawnPoint.x;
    const dz = point.z - world.spawnPoint.z;
    if (dx * dx + dz * dz < 0.01) return; // clicked the beacon itself — no direction to derive, stay armed
    // atan2(x, z), the same convention the live game's facing uses
    // (rotation.y = atan2(moveX, moveZ), so 0 = looking down +Z).
    world.spawnPoint.facingDeg = normalizeDeg(Math.round((Math.atan2(dx, dz) * 180) / Math.PI));
    rebuildSpawnPointMarker();
    const facingEl = document.getElementById('map-spawn-facing');
    if (facingEl) facingEl.value = world.spawnPoint.facingDeg;
    armedSpawnFacing = false;
    statusLine.textContent = `Spawn facing set to ${world.spawnPoint.facingDeg}°`;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!world) return;
  updatePointer(e);

  // A pending Alt-gesture turns into a marquee the moment the pointer really
  // moves; below the threshold it's still a click, and stays a toggle.
  if (marquee) {
    marquee.curX = e.clientX;
    marquee.curY = e.clientY;
    if (!marquee.active
      && (Math.abs(marquee.curX - marquee.startX) > MARQUEE_DRAG_THRESHOLD_PX
        || Math.abs(marquee.curY - marquee.startY) > MARQUEE_DRAG_THRESHOLD_PX)) {
      marquee.active = true;
    }
    if (marquee.active) updateMarqueeVisual();
    return;
  }

  // Brush radius indicator — shown whenever hovering in a brush-based mode,
  // not just while actively dragging, so you can see the size before you draw.
  if (mode === 'scatter' || (mode === 'terrain' && terrainToolMode === 'sculpt') || (mode === 'water' && waterToolMode === 'paint') || mode === 'groundtex' || (mode === 'monsters' && monScatterActiveEl.checked)) {
    const hoverPoint = mode === 'monsters' ? (isOverworldMonsters() ? raycastGround() : raycastFloorGround()) : raycastGround();
    if (hoverPoint) {
      const radius = mode === 'scatter' ? parseFloat(scatterRadiusEl.value)
        : mode === 'water' ? parseFloat(waterRadiusEl.value)
        : mode === 'groundtex' ? parseFloat(groundTexRadiusEl.value)
        : mode === 'monsters' ? parseFloat(monScatterRadiusEl.value)
        : parseFloat(brushRadiusEl.value);
      brushRing.position.set(hoverPoint.x, 0.1, hoverPoint.z);
      brushRing.scale.setScalar(radius);
      brushRing.visible = true;
    } else {
      brushRing.visible = false;
    }
  } else {
    brushRing.visible = false;
  }

  if (mode === 'place' && dragging && selected && groupDrag) {
    const point = raycastGround();
    if (point) {
      // The PRIMARY object is what snaps to the grid; everything else moves by
      // the same delta, so the group keeps its internal spacing exactly (a
      // per-object snap would fold a tight row onto one cell).
      const primary = groupDrag.starts.find((s) => s.item === selected) || groupDrag.starts[0];
      const dx = snap(primary.x + point.x - groupDrag.anchor.x) - primary.x;
      const dz = snap(primary.z + point.z - groupDrag.anchor.z) - primary.z;
      for (const start of groupDrag.starts) {
        const x = start.x + dx;
        const z = start.z + dz;
        start.item.ref.position.x = x;
        start.item.ref.position.z = z;
        start.item.mesh.position.set(x, (start.item.ref.position.y || 0) + sampleTerrainHeight(world, x, z), z);
      }
      selectionHighlight.update();
      translateMultiHighlights(dx, dz); // re-fitting every box per frame is what this avoids — see refreshMultiHighlights
    }
  } else if (mode === 'place' && dragging && selected) {
    const point = raycastGround();
    if (point) {
      const x = snap(point.x);
      const z = snap(point.z);
      selected.ref.position.x = x;
      selected.ref.position.z = z;
      const terrainY = sampleTerrainHeight(world, x, z);
      const baseY = selected.ref.position.y || 0;
      selected.mesh.position.set(x, baseY + terrainY, z);
      selectionHighlight.update();
    }
  } else if (mode === 'npcs' && npcDragging && selectedNpc) {
    const point = raycastGround();
    if (point) {
      selectedNpc.ref.position.x = snap(point.x);
      selectedNpc.ref.position.z = snap(point.z);
      applyNpcTransform(selectedNpc);
    }
  } else if (mode === 'events' && eventDragging && selectedEvent) {
    const point = raycastGround();
    if (point) {
      selectedEvent.ref.position.x = snap(point.x);
      selectedEvent.ref.position.z = snap(point.z);
      selectedEvent.mesh.position.set(selectedEvent.ref.position.x, selectedEvent.ref.position.y || 0, selectedEvent.ref.position.z);
    }
  } else if (mode === 'object-builder' && builderDragging && selectedBuilderShape) {
    const point = raycastBuilderPlane();
    if (point) {
      const x = builderSnap(point.x + builderDragOffset.x);
      const z = builderSnap(point.z + builderDragOffset.z);
      selectedBuilderShape.ref.position.x = x;
      selectedBuilderShape.ref.position.z = z;
      selectedBuilderShape.mesh.position.set(x, selectedBuilderShape.ref.position.y, z);
      builderSelectionHighlight.update();
      bsPosX.value = x;
      bsPosZ.value = z;
    }
  } else if (mode === 'terrain' && terrainToolMode === 'barrier' && barrierHandleDragging && selectedBarrier && selectedBarrierHandleIndex != null) {
    const point = raycastGround();
    if (point) {
      selectedBarrier.ref.points[selectedBarrierHandleIndex].x = point.x;
      selectedBarrier.ref.points[selectedBarrierHandleIndex].z = point.z;
      barriersDirty = true;
    }
  } else if (mode === 'terrain' && terrainToolMode === 'barrier' && barrierPointerDown && barrierDraft) {
    const point = raycastGround();
    if (point) {
      const last = barrierDraft.points[barrierDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > BARRIER_MIN_POINT_SPACING) {
        barrierDraft.points.push({ x: point.x, z: point.z });
        barriersDirty = true;
      }
    }
  } else if (mode === 'terrain' && terrainToolMode === 'sculpt' && dragging) {
    const point = raycastGround();
    if (point) paintTerrain(point, e.shiftKey);
  } else if (mode === 'water' && waterToolMode === 'paint' && dragging) {
    const point = raycastGround();
    if (point) paintWater(point, e.shiftKey);
  } else if (mode === 'groundtex' && dragging) {
    const point = raycastGround();
    if (point) paintGroundTexture(point, e.shiftKey);
  } else if (mode === 'scatter' && scatterDragging) {
    const now = performance.now();
    if (now - lastScatterTick >= SCATTER_TICK_MS) {
      const point = raycastGround();
      if (point) scatterTick(point, e.shiftKey);
      lastScatterTick = now;
    }
  } else if (mode === 'monsters' && monsterScatterDragging) {
    const now = performance.now();
    if (now - lastMonsterScatterTick >= MONSTER_SCATTER_TICK_MS) {
      const point = isOverworldMonsters() ? raycastGround() : raycastFloorGround();
      if (point) monsterScatterTick(point, e.shiftKey);
      lastMonsterScatterTick = now;
    }
  } else if (mode === 'zones' && zoneDraft) {
    const point = raycastGround();
    if (!point) return;
    const radius = Math.max(1, Math.hypot(point.x - zoneDraft.center.x, point.z - zoneDraft.center.z));
    scene.remove(zoneDraft.previewMesh);
    zoneDraft.previewMesh = buildZoneMarker({
      resource: document.getElementById('zone-type').value === 'gathering'
        ? document.getElementById('zone-resource').value
        : 'wood_and_herbs',
      center: { x: zoneDraft.center.x, y: 0, z: zoneDraft.center.z },
      radius,
    });
    scene.add(zoneDraft.previewMesh);
    zoneDraft.pendingRadius = radius;
  } else if (mode === 'path' && pathHandleDragging && selectedPath && selectedPathHandleIndex != null) {
    const point = raycastGround();
    if (point) {
      // Excludes the path being dragged, so a handle can't snap onto one of
      // its OWN other points and collapse the path onto itself.
      const snapped = snapPathPoint(point, e.altKey, selectedPath.ref);
      selectedPath.ref.points[selectedPathHandleIndex].x = snapped.x;
      selectedPath.ref.points[selectedPathHandleIndex].z = snapped.z;
      pathsDirty = true;
    }
  } else if (mode === 'path' && pathPointerDown && pathDraft) {
    const point = raycastGround();
    if (point) {
      const last = pathDraft.points[pathDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > PATH_MIN_POINT_SPACING) {
        pathDraft.points.push({ x: point.x, z: point.z });
        pathsDirty = true;
      }
    }
  } else if (mode === 'path' && pathDraft && pathStraightEl.checked) {
    // Rubber-band the pending segment to the cursor, through the SAME resolver
    // the click uses — so the segment you're looking at is the segment you get.
    //
    // Marks only `pathDraftDirty`, never `pathsDirty`. This is plain hover with
    // no button held, so it fires constantly, and a full rebuildPaths() rebuilds
    // every ribbon in the world and re-writes the whole path list's innerHTML.
    // Doing that per mouse-move made the editor crawl in a map with real roads
    // in it, which is its own way of making a click look like it did nothing.
    const point = raycastGround();
    const next = point ? resolvePathPoint(point, e) : null;
    const moved = !next || !pathCursorPoint
      || Math.hypot(next.x - pathCursorPoint.x, next.z - pathCursorPoint.z) > 0.05;
    if (moved) {
      pathCursorPoint = next;
      pathDraftDirty = true;
    }
  } else if (mode === 'mountains' && mountainPointerDown && mountainDraft) {
    const point = raycastGround();
    if (point) {
      const last = mountainDraft.points[mountainDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > MOUNTAIN_MIN_POINT_SPACING) {
        mountainDraft.points.push({ x: point.x, z: point.z });
        mountainsDirty = true;
      }
    }
  } else if (mode === 'zones' && zoneShapeMode === 'freeform' && freeformZoneHandleDragging && selectedFreeformZone && selectedFreeformZoneHandleIndex != null) {
    const point = raycastGround();
    if (point) {
      selectedFreeformZone.ref.points[selectedFreeformZoneHandleIndex].x = point.x;
      selectedFreeformZone.ref.points[selectedFreeformZoneHandleIndex].z = point.z;
      freeformZonesDirty = true;
    }
  } else if (mode === 'water' && waterToolMode === 'lake' && lakeHandleDragging && selectedLakeBody && selectedLakeHandleIndex != null) {
    const point = raycastGround();
    if (point) dragSelectedLakeHandle(selectedLakeHandleIndex, point);
  } else if (mode === 'water' && waterToolMode === 'river' && riverHandleDragging && selectedRiver && selectedRiverHandleIndex != null) {
    // The dragged point's height re-samples from wherever it's dragged to,
    // then the whole array gets re-clamped non-increasing (a drag can only
    // ever change ONE point's raw sample, but clamping must re-run over
    // the full chain — see enforceNonIncreasingHeights' own doc comment).
    const point = raycastGround();
    if (point) {
      selectedRiver.body.points[selectedRiverHandleIndex].x = point.x;
      selectedRiver.body.points[selectedRiverHandleIndex].z = point.z;
      selectedRiver.body.surfaceHeights[selectedRiverHandleIndex] = sampleTerrainHeight(world, point.x, point.z);
      enforceNonIncreasingHeights(selectedRiver.body.surfaceHeights);
      riversDirty = true;
    }
  } else if (mode === 'water' && waterToolMode === 'river' && riverPointerDown && riverDraft) {
    const point = raycastGround();
    if (point) {
      const last = riverDraft.points[riverDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > RIVER_MIN_POINT_SPACING) {
        const heights = riverDraft.surfaceHeights;
        riverDraft.points.push({ x: point.x, z: point.z });
        heights.push(Math.min(sampleTerrainHeight(world, point.x, point.z), heights[heights.length - 1]));
        riversDirty = true;
      }
    }
  } else if (mode === 'water' && waterToolMode === 'puddle' && puddlePointerDown) {
    const point = raycastGround();
    if (point && (!lastPuddlePlacePoint || Math.hypot(point.x - lastPuddlePlacePoint.x, point.z - lastPuddlePlacePoint.z) > PUDDLE_MIN_PLACEMENT_SPACING)) {
      placePuddleAt(point);
      lastPuddlePlacePoint = point;
    }
  } else if (mode === 'zones' && zoneShapeMode === 'freeform' && freeformZonePointerDown && freeformZoneDraft) {
    const point = raycastGround();
    if (point) {
      const last = freeformZoneDraft.points[freeformZoneDraft.points.length - 1];
      if (Math.hypot(point.x - last.x, point.z - last.z) > FREEFORM_ZONE_MIN_POINT_SPACING) {
        freeformZoneDraft.points.push({ x: point.x, z: point.z });
        freeformZonesDirty = true;
      }
    }
  }
});

window.addEventListener('pointerup', () => {
  if (mode === 'zones' && zoneDraft) {
    finalizeZone(zoneDraft.pendingRadius || 1);
  }
  if (marquee) finishMarquee();
  if (groupDrag) {
    groupDrag = null;
    refreshMultiHighlights(); // the boxes were translated during the drag; re-fit them to where things actually landed
  }
  dragging = false;
  npcDragging = false;
  eventDragging = false;
  scatterDragging = false;
  monsterScatterDragging = false;
  builderDragging = false;
  pathPointerDown = false;
  pathHandleDragging = false;
  freeformZonePointerDown = false;
  freeformZoneHandleDragging = false;
  riverPointerDown = false;
  riverHandleDragging = false;
  barrierPointerDown = false;
  barrierHandleDragging = false;
  lakeHandleDragging = false;
  puddlePointerDown = false;
  lastPuddlePlacePoint = null;
});

// --- MAPS MODE ---
// See switchToMap/applyLoadedWorldDoc/refreshMapsCatalog near the top of
// this file (right where the old single-world fetch used to be) for the
// load side; this section is the create/duplicate/delete/list UI plus the
// per-map-type property panel (building's linked overworld map, dungeon's
// auto-close timer).
const mapsListEl = document.getElementById('maps-list');
const MAP_TYPE_LABEL = { overworld: '🌍 Overworld', building: '🏠 Building', dungeon: '⚔️ Dungeon' };

function renderMapsList() {
  const groups = { overworld: [], building: [], dungeon: [] };
  for (const m of mapsCatalog) (groups[m.mapType] || groups.overworld).push(m);
  mapsListEl.innerHTML = ['overworld', 'building', 'dungeon']
    .filter((type) => groups[type].length)
    .map((type) => {
      const rows = groups[type]
        .map((m) => {
          const active = m.id === currentMapId;
          return `<div style="${active ? 'font-weight:bold;' : ''}">
            <span>${m.name}${m.isDefault ? ' (default)' : ''}${active ? ' — editing now' : ''}</span>
            <button data-edit-map="${m.id}">Edit</button>
            <button data-dup-map="${m.id}">Duplicate</button>
            ${m.isDefault ? '' : `<button data-delete-map="${m.id}">✕</button>`}
          </div>`;
        })
        .join('');
      return `<h4>${MAP_TYPE_LABEL[type]}</h4>${rows}`;
    })
    .join('');
  renderMapProps();
}

/** The current map's own type-specific fields — a building's link back to an overworld map, or a dungeon's auto-close timer. Plain fields on `world`, saved by the normal Save button like everything else. */
function renderMapProps() {
  const el = document.getElementById('map-current-props');
  if (!world) {
    el.innerHTML = '';
    return;
  }
  const mapType = world.mapType || 'overworld';
  if (mapType === 'building') {
    const options = mapsCatalog
      .filter((m) => m.mapType === 'overworld')
      .map((m) => `<option value="${m.id}" ${world.linkedOverworldMapId === m.id ? 'selected' : ''}>${m.name}</option>`)
      .join('');
    el.innerHTML = `
      <h3>Building Map Settings</h3>
      <label>Linked overworld map</label>
      <select id="map-linked-overworld"><option value="">— none —</option>${options}</select>
      <p class="hint">Also set "${world.id}" as the Linked Building Map (Buildings mode) on whichever placed building leads here.</p>`;
    document.getElementById('map-linked-overworld').addEventListener('change', (e) => {
      world.linkedOverworldMapId = e.target.value || undefined;
    });
    return;
  }

  // Spawn point, for overworlds AND dungeons. A dungeon's spawnPoint is what
  // server/index.js's enterTowerFloor hands to enterDungeonMap, so a floor map
  // that never set one drops every party at the map origin (usually a corner
  // of the terrain, outside the level). It was unreachable in the editor
  // purely because the Dungeon branch used to end the function before this
  // block could run.
  const dungeonHead = mapType !== 'dungeon' ? '' : `
      <h3>Dungeon Map Settings</h3>
      <label>Auto-close after (minutes, no activity)</label>
      <input type="number" id="map-auto-close" min="1" step="1" value="${world.autoCloseMinutes ?? 30}" />`;
  {
    const isDefault = mapsCatalog.find((m) => m.id === currentMapId)?.isDefault;
    el.innerHTML = dungeonHead + `
      <h3>Starting Point</h3>
      <p class="hint">${mapType === 'dungeon'
        ? 'Where a party arrives when they enter this dungeon (a Tower floor, or anything else that opens it). Put it at the entrance of the level.'
        : isDefault
        ? 'Where a character appears the moment they load into the game (a fresh login, or a dungeon closing under them). This is the default overworld map, so this point is live.'
        : 'Only the default overworld map\'s spawn point is currently read by the server — this map isn\'t it, so this value is saved but unused until it is made the default (see the manifest / Maps API).'}</p>
      <label>X</label>
      <input type="number" id="map-spawn-x" step="0.5" value="${world.spawnPoint.x}" />
      <label>Z</label>
      <input type="number" id="map-spawn-z" step="0.5" value="${world.spawnPoint.z}" />
      <label>Facing (degrees)</label>
      <input type="number" id="map-spawn-facing" step="15" value="${world.spawnPoint.facingDeg || 0}" />
      <p class="hint">Which way the character is turned on arrival, and where the camera sits behind them. 0° = looking down +Z (south on the minimap), 90° = +X, 180° = -Z, 270° = -X. The gold beacon's arrow shows it.</p>
      <button id="map-spawn-set-btn" style="width:100%; margin-top:8px;">Click Ground to Set Starting Point</button>
      <button id="map-spawn-aim-btn" style="width:100%; margin-top:4px;">Click Ground to Aim Facing</button>`;
    if (mapType === 'dungeon') {
      document.getElementById('map-auto-close').addEventListener('change', (e) => {
        world.autoCloseMinutes = parseFloat(e.target.value) || 30;
      });
    }
    document.getElementById('map-spawn-x').addEventListener('change', (e) => {
      world.spawnPoint.x = parseFloat(e.target.value) || 0;
      rebuildSpawnPointMarker();
    });
    document.getElementById('map-spawn-z').addEventListener('change', (e) => {
      world.spawnPoint.z = parseFloat(e.target.value) || 0;
      rebuildSpawnPointMarker();
    });
    document.getElementById('map-spawn-facing').addEventListener('change', (e) => {
      world.spawnPoint.facingDeg = normalizeDeg(parseFloat(e.target.value) || 0);
      e.target.value = world.spawnPoint.facingDeg;
      rebuildSpawnPointMarker();
    });
    document.getElementById('map-spawn-set-btn').addEventListener('click', () => {
      armedSpawnPoint = true;
      armedSpawnFacing = false;
      statusLine.textContent = 'Click the ground to set the spawn point';
    });
    document.getElementById('map-spawn-aim-btn').addEventListener('click', () => {
      armedSpawnFacing = true;
      armedSpawnPoint = false;
      statusLine.textContent = 'Click the ground where the character should be looking';
    });
  }
}

/** Suggests every Building-type map's id in the Buildings-mode "Linked building map" field (a <datalist>, not a hard <select> — a building can be placed before its interior map exists yet, so freeform typing still has to work). */
function populateBuildingMapDatalist() {
  const el = document.getElementById('building-map-ids');
  if (!el) return;
  el.innerHTML = mapsCatalog
    .filter((m) => m.mapType === 'building')
    .map((m) => `<option value="${m.id}">${m.name}</option>`)
    .join('');
}

mapsListEl.addEventListener('click', async (e) => {
  const editId = e.target.dataset.editMap;
  if (editId) {
    switchToMap(editId).catch((err) => { statusLine.textContent = `Failed to load map: ${err.message}`; });
    return;
  }
  const dupId = e.target.dataset.dupMap;
  if (dupId) {
    duplicateMap(dupId);
    return;
  }
  const delId = e.target.dataset.deleteMap;
  if (delId) {
    if (!confirm(`Delete map "${delId}"? The file stays on disk, but it stops loading/showing up here.`)) return;
    await fetch(`/api/maps/${delId}`, { method: 'DELETE' });
    await refreshMapsCatalog();
    renderMapsList();
    populateBuildingMapDatalist();
  }
});

async function duplicateMap(sourceId) {
  const source = mapsCatalog.find((m) => m.id === sourceId);
  if (!source) return;
  const newId = `${sourceId}-copy-${Date.now()}`;
  const newName = `${source.name} (copy)`;
  const createRes = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: newId, name: newName, mapType: source.mapType, width: 10, height: 10 }),
  });
  if (!createRes.ok) {
    statusLine.textContent = 'Duplicate failed: could not create the new map.';
    return;
  }
  const srcDoc = await (await fetch(`/api/maps/${sourceId}`)).json();
  const clone = { ...structuredClone(srcDoc), id: newId, name: newName };
  const saveRes = await fetch(`/api/maps/${newId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clone),
  });
  if (!saveRes.ok) {
    statusLine.textContent = 'Duplicate failed: could not copy the map content.';
    return;
  }
  await refreshMapsCatalog();
  renderMapsList();
  populateBuildingMapDatalist();
  statusLine.textContent = `Duplicated "${source.name}" → "${newName}"`;
}

document.getElementById('map-create-btn').addEventListener('click', async () => {
  const name = document.getElementById('map-new-name').value.trim();
  const mapType = document.getElementById('map-new-type').value;
  const width = parseFloat(document.getElementById('map-new-width').value) || 200;
  const height = parseFloat(document.getElementById('map-new-height').value) || 200;
  if (!name) {
    statusLine.textContent = 'Give the new map a name first.';
    return;
  }
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `map-${Date.now()}`;
  const res = await fetch('/api/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, name, mapType, width, height }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    statusLine.textContent = `Create failed: ${err.error || res.status}`;
    return;
  }
  document.getElementById('map-new-name').value = '';
  await refreshMapsCatalog();
  populateBuildingMapDatalist();
  await switchToMap(id);
});

// --- TELEPORTERS MODE ---
// The one placeable primitive behind building entrances/exits and (for now,
// until party-instanced dungeons exist) dungeon entrances — see the Maps
// mode hint text and buildTeleporterMesh's own doc comment. Placement
// follows the same "arm a button, click the ground" flow as buildings/NPCs;
// selection/editing follows the same "click to select, panel appears" flow
// as a placed prop.
let armedTeleporter = false;
let selectedTeleporter = null; // entry from placedTeleporters
let crossMapTeleporters = []; // GET /api/teleporters — every OTHER map's teleporters, for the link dropdown

document.getElementById('place-teleporter-btn').addEventListener('click', () => {
  armedTeleporter = true;
  statusLine.textContent = 'Click the ground to place a teleporter';
});

function nextTeleporterId() {
  const used = new Set([...world.teleporters.map((t) => t.id), ...crossMapTeleporters.map((t) => t.id)]);
  let n = 1;
  while (used.has(`Teleporter ${n}`)) n++;
  return `Teleporter ${n}`;
}

function placeTeleporterAt(point) {
  const t = {
    id: nextTeleporterId(),
    position: { x: snap(point.x), y: 0, z: snap(point.z) },
    linkedTeleporterId: undefined,
    mode: 'instant',
    visible: true,
  };
  world.teleporters.push(t);
  const mesh = buildTeleporterMesh(t);
  scene.add(mesh);
  const entry = { ref: t, mesh };
  placedTeleporters.push(entry);
  armedTeleporter = false;
  refreshTeleporterList();
  selectTeleporter(entry);
}

function raycastTeleporters() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedTeleporters.map((t) => t.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedTeleporters.some((t) => t.mesh === obj)) obj = obj.parent;
  return placedTeleporters.find((t) => t.mesh === obj) || null;
}

function selectTeleporter(entry) {
  selectedTeleporter = entry;
  const controls = document.getElementById('tp-selected-controls');
  if (!entry) {
    controls.style.display = 'none';
    return;
  }
  controls.style.display = 'block';
  document.getElementById('tp-id').value = entry.ref.id;
  document.getElementById('tp-mode').value = entry.ref.mode;
  document.getElementById('tp-visible').checked = entry.ref.visible;
  refreshCrossMapTeleporterOptions();
}

/** Rebuilds one teleporter's mesh in place after a field change that affects its geometry/material (mode or visible — id/link are pure data, no mesh change needed). */
function rebuildSelectedTeleporterMesh() {
  scene.remove(selectedTeleporter.mesh);
  const mesh = buildTeleporterMesh(selectedTeleporter.ref, { gizmo: !selectedTeleporter.ref.visible });
  scene.add(mesh);
  selectedTeleporter.mesh = mesh;
}

document.getElementById('tp-id').addEventListener('change', (e) => {
  if (!selectedTeleporter) return;
  const newId = e.target.value.trim();
  if (!newId || newId === selectedTeleporter.ref.id) {
    e.target.value = selectedTeleporter.ref.id;
    return;
  }
  const clash = world.teleporters.some((t) => t !== selectedTeleporter.ref && t.id === newId)
    || crossMapTeleporters.some((t) => t.id === newId);
  if (clash) {
    statusLine.textContent = `Teleporter id "${newId}" is already in use somewhere — pick another.`;
    e.target.value = selectedTeleporter.ref.id;
    return;
  }
  // Renaming a teleporter that other teleporters link TO by id would
  // silently break those links — repoint every one of THIS map's own
  // teleporters that referenced the old id. A link from a DIFFERENT,
  // not-currently-loaded map can't be fixed here; same limitation as any
  // cross-file rename.
  const oldId = selectedTeleporter.ref.id;
  for (const t of world.teleporters) {
    if (t.linkedTeleporterId === oldId) t.linkedTeleporterId = newId;
  }
  selectedTeleporter.ref.id = newId;
  refreshTeleporterList();
});

document.getElementById('tp-linked').addEventListener('change', (e) => {
  if (!selectedTeleporter) return;
  selectedTeleporter.ref.linkedTeleporterId = e.target.value || undefined;
  refreshTeleporterList();
});

document.getElementById('tp-mode').addEventListener('change', (e) => {
  if (!selectedTeleporter) return;
  selectedTeleporter.ref.mode = e.target.value;
  rebuildSelectedTeleporterMesh();
  refreshTeleporterList();
});

document.getElementById('tp-visible').addEventListener('change', (e) => {
  if (!selectedTeleporter) return;
  selectedTeleporter.ref.visible = e.target.checked;
  rebuildSelectedTeleporterMesh();
});

document.getElementById('tp-delete-btn').addEventListener('click', () => {
  if (!selectedTeleporter) return;
  scene.remove(selectedTeleporter.mesh);
  world.teleporters = world.teleporters.filter((t) => t !== selectedTeleporter.ref);
  placedTeleporters.splice(placedTeleporters.indexOf(selectedTeleporter), 1);
  selectTeleporter(null);
  refreshTeleporterList();
});

function refreshTeleporterList() {
  document.getElementById('tp-count').textContent = placedTeleporters.length;
  document.getElementById('tp-list').innerHTML = placedTeleporters
    .map((t) => {
      const active = t === selectedTeleporter;
      const linkLabel = t.ref.linkedTeleporterId ? `→ ${t.ref.linkedTeleporterId}` : '(unlinked)';
      return `<div style="${active ? 'font-weight:bold;' : ''}"><span data-select-tp="${t.ref.id}">${t.ref.id} ${linkLabel}</span></div>`;
    })
    .join('');
}

document.getElementById('tp-list').addEventListener('click', (e) => {
  const id = e.target.dataset.selectTp;
  if (!id) return;
  selectTeleporter(placedTeleporters.find((t) => t.ref.id === id) || null);
});

async function refreshCrossMapTeleporterOptions() {
  try {
    const res = await fetch('/api/teleporters');
    crossMapTeleporters = await res.json();
  } catch {
    crossMapTeleporters = [];
  }
  const sel = document.getElementById('tp-linked');
  if (!selectedTeleporter) {
    sel.innerHTML = '<option value="">— unlinked —</option>';
    return;
  }
  // Every teleporter EXCEPT this one — this map's own list is the freshest
  // source for ones just placed/renamed but not yet saved; the server
  // registry (crossMapTeleporters) covers every other map's already-saved
  // ones. Local wins on id collision (shouldn't happen, but if it does the
  // in-progress edit is more truthful than a stale saved copy).
  const localOthers = world.teleporters.filter((t) => t.id !== selectedTeleporter.ref.id).map((t) => ({ id: t.id, mapName: 'this map' }));
  const seen = new Set(localOthers.map((t) => t.id));
  const remoteOthers = crossMapTeleporters.filter((t) => t.id !== selectedTeleporter.ref.id && !seen.has(t.id));
  const options = [...localOthers, ...remoteOthers];
  sel.innerHTML =
    '<option value="">— unlinked —</option>' +
    options.map((t) => `<option value="${t.id}" ${selectedTeleporter.ref.linkedTeleporterId === t.id ? 'selected' : ''}>${t.id}${t.mapName ? ` (${t.mapName})` : ''}</option>`).join('');
}

// --- PARTICLES MODE ---------------------------------------------------------
// Places `world.particleEmitters[]` (src/sim/particleEmitters.js): looping
// ambient effects dropped straight into the map — a campfire, glitter over a
// shrine, a tornado in the fields. Placement/selection follows the same
// "arm a button, click the ground, panel appears" flow as NPCs/teleporters.
//
// The effects themselves RUN here, live, through the same streaming runtime
// the game uses (createWorldParticleEmitters) rather than a stand-in gizmo:
// the whole point of a particle authoring tool is seeing the actual particles,
// and the editor already matches the game's shading/post-processing exactly
// (see the editor/game render-sync work). A small wireframe marker sits at
// each emitter's origin so one can still be clicked when its effect is subtle
// or currently culled — those markers are hidden outside this mode.
let armedParticlePlacement = false;
let armedParticleMove = false;
let selectedEmitter = null; // entry from placedEmitters
let paletteEffectId = WORLD_EFFECT_IDS[0];

const EMITTER_MARKER_COLOR = 0xffd27a;
const EMITTER_MARKER_SELECTED = 0x7dffb0;

function buildEmitterMarker(def) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: EMITTER_MARKER_COLOR, wireframe: true, transparent: true, opacity: 0.9, depthTest: false });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat);
  core.position.y = 0.9;
  core.renderOrder = 999;
  const poleMat = new THREE.MeshBasicMaterial({ color: EMITTER_MARKER_COLOR, transparent: true, opacity: 0.45, depthTest: false });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), poleMat);
  pole.position.y = 0.45;
  pole.renderOrder = 999;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.48, 24), poleMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.renderOrder = 999;
  group.add(core, pole, ring);
  group.userData.markerMats = [mat, poleMat];
  group.position.set(def.position.x, def.position.y || 0, def.position.z);
  group.visible = mode === 'particles';
  return group;
}

function setEmitterMarkerSelected(entry, selected) {
  for (const m of entry.mesh.userData.markerMats || []) {
    m.color.setHex(selected ? EMITTER_MARKER_SELECTED : EMITTER_MARKER_COLOR);
  }
}

/** Rebuilds every emitter marker AND restarts the live effects. Called on load, on any placement/edit, and from rebuildAll(). */
function rebuildParticleEmitters() {
  for (const e of placedEmitters) scene.remove(e.mesh);
  placedEmitters.length = 0;
  if (!world.particleEmitters) world.particleEmitters = [];
  for (const def of world.particleEmitters) {
    const mesh = buildEmitterMarker(def);
    scene.add(mesh);
    placedEmitters.push({ ref: def, mesh });
  }
  if (selectedEmitter) {
    // Keep the selection across a rebuild — the panel is very likely open on
    // the emitter whose slider just moved.
    const again = placedEmitters.find((e) => e.ref === selectedEmitter.ref);
    selectedEmitter = again || null;
    if (again) setEmitterMarkerSelected(again, true);
  }
  if (worldEmitters) worldEmitters.rebuild(world);
  // ignoreActivationRadius: the editor camera is usually far above the map, so
  // honouring each emitter's in-game radius here would mean placing an effect
  // and seeing nothing. The radius is still authored and still enforced in
  // game — see createWorldParticleEmitters' own comment.
  else worldEmitters = createWorldParticleEmitters(scene, world, vfxSystem, { ignoreActivationRadius: true });
  refreshEmitterList();
}

/**
 * Restarts just the live effects (not the markers) — for a colour/scale/effect
 * change, where the marker is already in the right place.
 *
 * Debounced, because a range input fires `input` on every mouse-move: rebuilding
 * disposes and re-spawns the particle systems, so dragging the size slider
 * restarted the effect dozens of times a second and it read as flickering
 * rather than as resizing.
 */
let respawnEmittersTimer = null;
function respawnParticleEmitters() {
  clearTimeout(respawnEmittersTimer);
  respawnEmittersTimer = setTimeout(() => worldEmitters?.rebuild(world), 120);
}

function nextEmitterId() {
  const used = new Set((world.particleEmitters || []).map((e) => e.id));
  let n = 1;
  while (used.has(`emitter-${n}`)) n++;
  return `emitter-${n}`;
}

function placeEmitterAt(point) {
  const def = {
    id: nextEmitterId(),
    effectId: paletteEffectId,
    label: getWorldEffectDef(paletteEffectId)?.label || paletteEffectId,
    // Rounded: a terrain raycast comes back with float noise like -1.4e-14,
    // which is harmless but litters the saved JSON.
    position: { x: snap(point.x), y: Math.round((point.y || 0) * 1000) / 1000, z: snap(point.z) },
    scale: 1,
    intensity: 1,
    activationRadius: DEFAULT_EMITTER_ACTIVATION_RADIUS,
  };
  world.particleEmitters.push(def);
  armedParticlePlacement = false;
  rebuildParticleEmitters();
  selectEmitter(placedEmitters.find((e) => e.ref === def) || null);
}

function raycastEmitters() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(placedEmitters.map((e) => e.mesh), true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedEmitters.some((e) => e.mesh === obj)) obj = obj.parent;
  return placedEmitters.find((e) => e.mesh === obj) || null;
}

function selectEmitter(entry) {
  if (selectedEmitter) setEmitterMarkerSelected(selectedEmitter, false);
  selectedEmitter = entry;
  const panel = document.getElementById('pe-selected-controls'); // NOT `controls` — that's the module-level OrbitControls
  if (!entry) {
    panel.style.display = 'none';
    refreshEmitterList();
    return;
  }
  setEmitterMarkerSelected(entry, true);
  panel.style.display = 'block';
  const def = entry.ref;
  const effect = getWorldEffectDef(def.effectId);
  document.getElementById('pe-label').value = def.label || '';
  document.getElementById('pe-effect').value = def.effectId;
  setSliderPair('pe-scale', def.scale ?? 1, 1);
  setSliderPair('pe-intensity', def.intensity ?? 1, 1);
  setSliderPair('pe-y', def.position.y ?? 0, 1);
  setSliderPair('pe-radius', def.activationRadius ?? DEFAULT_EMITTER_ACTIVATION_RADIUS, 0);
  for (const axis of ['x', 'y', 'z']) setSliderPair(`pe-rot-${axis}`, def.rotation?.[axis] ?? 0, 0);
  // An emitter with no colour override shows the effect's own defaults, so
  // the swatches always reflect what's actually on screen.
  document.getElementById('pe-colorA').value = def.colorA || effect?.defaultColorA || '#ffffff';
  document.getElementById('pe-colorB').value = def.colorB || effect?.defaultColorB || '#ffffff';
  document.getElementById('pe-light').checked = def.light !== false;
  refreshEmitterList();
}

/** Sets a range input and its adjacent `<id>-out` readout together. */
function setSliderPair(id, value, decimals) {
  const el = document.getElementById(id);
  el.value = value;
  const out = document.getElementById(`${id}-out`);
  if (out) out.textContent = Number(value).toFixed(decimals);
}

function refreshEmitterList() {
  const list = document.getElementById('pe-list');
  document.getElementById('pe-count').textContent = placedEmitters.length;
  list.innerHTML = placedEmitters
    .map((e) => {
      const active = e === selectedEmitter;
      const name = e.ref.label || getWorldEffectDef(e.ref.effectId)?.label || e.ref.effectId;
      return `<div style="${active ? 'font-weight:bold;' : ''}"><span data-select-emitter="${e.ref.id}">${name} <span style="opacity:0.6">(${e.ref.effectId})</span></span></div>`;
    })
    .join('') || 'None placed yet.';
}

/** Fills both the palette (grouped, clickable) and the two <select>s from the world-effect catalog. */
function buildEmitterPalette() {
  const groups = worldEffectsByCategory();
  const optionsHtml = groups
    .map((g) => `<optgroup label="${g.category}">${g.effects.map((e) => `<option value="${e.id}">${e.label}</option>`).join('')}</optgroup>`)
    .join('');
  const picker = document.getElementById('pe-effect-picker');
  picker.innerHTML = optionsHtml;
  picker.value = paletteEffectId;
  document.getElementById('pe-effect').innerHTML = optionsHtml;

  document.getElementById('pe-palette').innerHTML = groups
    .map((g) => `<div style="margin-bottom:6px;"><div style="opacity:0.7; text-transform:uppercase; font-size:10px; letter-spacing:1px;">${g.category}</div>`
      + g.effects.map((e) => `<button data-palette-effect="${e.id}" style="margin:2px 2px 0 0; padding:3px 6px; font-size:11px; border-left:6px solid ${e.defaultColorA};">${e.label}</button>`).join('')
      + '</div>')
    .join('');
}

document.getElementById('pe-palette').addEventListener('click', (e) => {
  const id = e.target.dataset?.paletteEffect;
  if (!id) return;
  paletteEffectId = id;
  document.getElementById('pe-effect-picker').value = id;
  armedParticlePlacement = true;
  statusLine.textContent = `Click the ground to place "${getWorldEffectDef(id)?.label || id}"`;
});

document.getElementById('pe-effect-picker').addEventListener('change', (e) => {
  paletteEffectId = e.target.value;
});

document.getElementById('place-particle-btn').addEventListener('click', () => {
  armedParticlePlacement = true;
  armedParticleMove = false;
  statusLine.textContent = `Click the ground to place "${getWorldEffectDef(paletteEffectId)?.label || paletteEffectId}"`;
});

document.getElementById('pe-label').addEventListener('input', (e) => {
  if (!selectedEmitter) return;
  selectedEmitter.ref.label = e.target.value;
  refreshEmitterList();
});

document.getElementById('pe-effect').addEventListener('change', (e) => {
  if (!selectedEmitter) return;
  const wasAutoLabel = selectedEmitter.ref.label === (getWorldEffectDef(selectedEmitter.ref.effectId)?.label || selectedEmitter.ref.effectId);
  selectedEmitter.ref.effectId = e.target.value;
  // Only re-label if the author never renamed it — a "Tavern hearth" stays
  // "Tavern hearth" when its effect is swapped, but an untouched auto-name
  // shouldn't keep saying "Tornado" once it's glitter.
  if (wasAutoLabel) selectedEmitter.ref.label = getWorldEffectDef(e.target.value)?.label || e.target.value;
  // Colour overrides belong to the OLD effect's palette — carrying e.g. a
  // fire's orange onto a snow flurry produces something nobody asked for, so
  // switching effect drops them back to the new effect's own defaults.
  delete selectedEmitter.ref.colorA;
  delete selectedEmitter.ref.colorB;
  selectEmitter(selectedEmitter);
  respawnParticleEmitters();
  refreshEmitterList();
});

for (const [id, apply] of [
  ['pe-scale', (def, v) => { def.scale = v; }],
  ['pe-intensity', (def, v) => { def.intensity = v; }],
]) {
  const el = document.getElementById(id);
  el.addEventListener('input', (e) => {
    if (!selectedEmitter) return;
    const v = parseFloat(e.target.value);
    document.getElementById(`${id}-out`).textContent = v.toFixed(1);
    apply(selectedEmitter.ref, v);
    respawnParticleEmitters();
  });
}

document.getElementById('pe-y').addEventListener('input', (e) => {
  if (!selectedEmitter) return;
  const v = parseFloat(e.target.value);
  document.getElementById('pe-y-out').textContent = v.toFixed(1);
  selectedEmitter.ref.position.y = v;
  selectedEmitter.mesh.position.y = v;
  respawnParticleEmitters();
});

// Rotation is stored in DEGREES (what the sliders show and what an author
// thinks in); src/sim/particleEmitters.js's emitterRotationRadians converts it
// for the anchor Object3D, in both the editor preview and the live game.
for (const axis of ['x', 'y', 'z']) {
  document.getElementById(`pe-rot-${axis}`).addEventListener('input', (e) => {
    if (!selectedEmitter) return;
    const v = parseFloat(e.target.value);
    document.getElementById(`pe-rot-${axis}-out`).textContent = v.toFixed(0);
    const def = selectedEmitter.ref;
    if (!def.rotation) def.rotation = {};
    def.rotation[axis] = v;
    // An all-zero rotation is the default, so drop the key rather than write
    // `"rotation":{"x":0,"y":0,"z":0}` onto every emitter ever selected.
    if (!def.rotation.x && !def.rotation.y && !def.rotation.z) delete def.rotation;
    respawnParticleEmitters();
  });
}

document.getElementById('pe-reset-rotation-btn').addEventListener('click', () => {
  if (!selectedEmitter) return;
  delete selectedEmitter.ref.rotation;
  for (const axis of ['x', 'y', 'z']) setSliderPair(`pe-rot-${axis}`, 0, 0);
  respawnParticleEmitters();
});

document.getElementById('pe-radius').addEventListener('input', (e) => {
  if (!selectedEmitter) return;
  const v = parseFloat(e.target.value);
  document.getElementById('pe-radius-out').textContent = v.toFixed(0);
  selectedEmitter.ref.activationRadius = v;
  respawnParticleEmitters();
});

for (const key of ['colorA', 'colorB']) {
  document.getElementById(`pe-${key}`).addEventListener('input', (e) => {
    if (!selectedEmitter) return;
    selectedEmitter.ref[key] = e.target.value;
    respawnParticleEmitters();
  });
}

document.getElementById('pe-reset-colors-btn').addEventListener('click', () => {
  if (!selectedEmitter) return;
  delete selectedEmitter.ref.colorA;
  delete selectedEmitter.ref.colorB;
  selectEmitter(selectedEmitter);
  respawnParticleEmitters();
});

document.getElementById('pe-light').addEventListener('change', (e) => {
  if (!selectedEmitter) return;
  selectedEmitter.ref.light = e.target.checked;
  respawnParticleEmitters();
});

document.getElementById('pe-move-btn').addEventListener('click', () => {
  if (!selectedEmitter) return;
  armedParticleMove = true;
  armedParticlePlacement = false;
  statusLine.textContent = 'Click the ground to move this emitter';
});

document.getElementById('pe-duplicate-btn').addEventListener('click', () => {
  if (!selectedEmitter) return;
  const copy = structuredClone(selectedEmitter.ref);
  copy.id = nextEmitterId();
  copy.position.x += 2;
  world.particleEmitters.push(copy);
  rebuildParticleEmitters();
  selectEmitter(placedEmitters.find((e) => e.ref === copy) || null);
});

document.getElementById('pe-delete-btn').addEventListener('click', () => {
  if (!selectedEmitter) return;
  world.particleEmitters = world.particleEmitters.filter((d) => d !== selectedEmitter.ref);
  selectedEmitter = null;
  document.getElementById('pe-selected-controls').style.display = 'none';
  rebuildParticleEmitters();
});

document.getElementById('pe-list').addEventListener('click', (e) => {
  const id = e.target.dataset?.selectEmitter;
  if (!id) return;
  selectEmitter(placedEmitters.find((en) => en.ref.id === id) || null);
});

buildEmitterPalette();

// --- LIGHTS MODE ------------------------------------------------------------
// Places `world.lights[]` (src/sim/lightSources.js): point and spot lights for
// enclosed spaces the map's single directional sun can't do anything for — a
// cave, a cell block, a cellar, the inside of a cage. Same "arm a button,
// click the ground, panel appears" flow as NPCs/teleporters/emitters.
//
// The lights are LIVE here, through the same pooled runtime the game uses
// (createWorldLights), for the same reason the particle emitters are: the
// editor already matches the game's shading and post-processing exactly, so
// what you see while dragging the strength slider is what ships. What the
// runtime can't show is where a light *is* when it's subtle or currently
// unbound, so each one also gets an authoring gizmo — a bulb, a wireframe
// sphere at its exact area of effect, and for a spot the cone it actually
// casts. Those are hidden outside this mode.
let armedLightPlacement = false;
let armedLightMove = false;
let selectedLight = null; // entry from placedLights
let paletteLightPresetId = LIGHT_PRESETS[0].id;

/** How far above the clicked ground a new light starts — roughly head height, which is where a wall torch or a hanging lantern lives. */
const NEW_LIGHT_HEIGHT = 1.5;
const LIGHT_GIZMO_SELECTED = 0x7dffb0;

/** Fills `group` with the bulb / radius sphere / spot cone for `def`. Separated from the group itself so an edit can redraw in place without invalidating the raycast entry. */
function populateLightGizmo(group, def, selected) {
  disposeLightGizmoChildren(group);
  const tint = selected ? LIGHT_GIZMO_SELECTED : new THREE.Color(def.color || '#ffffff').getHex();
  // depthTest off on the bulb only: a light buried in a wall still has to be
  // clickable, but an X-ray radius sphere over the whole map is unreadable.
  const bulbMat = new THREE.MeshBasicMaterial({ color: tint, wireframe: true, transparent: true, opacity: 0.95, depthTest: false });
  const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), bulbMat);
  bulb.renderOrder = 999;
  group.add(bulb);

  const shellMat = new THREE.MeshBasicMaterial({ color: tint, wireframe: true, transparent: true, opacity: 0.13 });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.5, def.distance || 12), 16, 10), shellMat);
  group.add(shell);

  // A dropline to the ground, because a light's height is the field that's
  // hardest to judge from an orbit camera and the easiest to get wrong.
  const stemMat = new THREE.LineBasicMaterial({ color: tint, transparent: true, opacity: 0.5 });
  const groundY = sampleTerrainHeight(world, def.position.x, def.position.z);
  const stem = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, groundY - (def.position.y ?? 0), 0)]),
    stemMat,
  );
  group.add(stem);

  if (def.type === 'spot') {
    const reach = Math.max(0.5, def.distance || 12);
    const angle = (def.angleDeg ?? 35) * (Math.PI / 180);
    const geo = new THREE.ConeGeometry(Math.tan(angle) * reach, reach, 20, 1, true);
    // ConeGeometry's apex is at +height/2; shift it to the origin so the cone
    // hangs off the light itself, then rotate -Y onto the authored aim.
    geo.translate(0, -reach / 2, 0);
    const coneMat = new THREE.MeshBasicMaterial({ color: tint, wireframe: true, transparent: true, opacity: 0.28 });
    const cone = new THREE.Mesh(geo, coneMat);
    const dir = lightSpotDirection(def);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(dir.x, dir.y, dir.z).normalize());
    group.add(cone);
    shell.visible = false; // the cone already says where a spot reaches; both at once is noise
  }
}

/** Explicit disposal — the gizmo is rebuilt on every slider tick, and a leaked geometry per tick is exactly how the editor ran itself out of GPU memory once before. */
function disposeLightGizmoChildren(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

function buildLightGizmo(def) {
  const group = new THREE.Group();
  group.name = `light-gizmo:${def.id}`;
  group.position.set(def.position.x, def.position.y ?? 0, def.position.z);
  populateLightGizmo(group, def, false);
  group.visible = mode === 'lights';
  return group;
}

/** Redraws one light's gizmo after any edit (position, colour, radius, cone, type). */
function refreshLightGizmo(entry) {
  entry.mesh.position.set(entry.ref.position.x, entry.ref.position.y ?? 0, entry.ref.position.z);
  populateLightGizmo(entry.mesh, entry.ref, entry === selectedLight);
}

/** Rebuilds every gizmo AND re-reads the world into the light pool. Called on load, on any placement/edit, and from rebuildAll(). */
function rebuildLightSources() {
  for (const e of placedLights) {
    disposeLightGizmoChildren(e.mesh);
    scene.remove(e.mesh);
  }
  placedLights.length = 0;
  if (!world.lights) world.lights = [];
  for (const def of world.lights) {
    const mesh = buildLightGizmo(def);
    scene.add(mesh);
    placedLights.push({ ref: def, mesh });
  }
  if (selectedLight) {
    // Keep the selection across a rebuild — the panel is very likely open on
    // the light whose slider just moved.
    const again = placedLights.find((e) => e.ref === selectedLight.ref);
    selectedLight = again || null;
    if (again) refreshLightGizmo(again);
  }
  if (worldLightPool) worldLightPool.rebuild(world);
  // ignoreActivationRadius, same as the emitters: the editor camera usually
  // sits well above the map, and an authoring tool that shows nothing when you
  // place a light is worse than useless. The radius is still authored and
  // still enforced in game.
  else worldLightPool = createWorldLights(scene, world, { ignoreActivationRadius: true });
  refreshLightList();
}

/**
 * Re-reads the world into the pool without touching the gizmos — for a
 * strength/colour/radius change, where the gizmo is updated separately.
 *
 * Not debounced, unlike the emitter version: rebinding a pool slot writes a
 * handful of uniforms, so it's cheap enough to do on every `input` event, and
 * a light that lags 120ms behind its slider is the one thing that makes
 * dialling in a room's lighting feel wrong.
 */
function respawnLightSources() {
  worldLightPool?.rebuild(world);
}

function nextLightId() {
  const used = new Set((world.lights || []).map((l) => l.id));
  let n = 1;
  while (used.has(`light-${n}`)) n++;
  return `light-${n}`;
}

function placeLightAt(point) {
  const def = lightSourceFromPreset(
    paletteLightPresetId,
    {
      x: snap(point.x),
      // Rounded: a terrain raycast comes back with float noise like -1.4e-14.
      y: Math.round(((point.y || 0) + NEW_LIGHT_HEIGHT) * 1000) / 1000,
      z: snap(point.z),
    },
    nextLightId(),
  );
  world.lights.push(def);
  armedLightPlacement = false;
  rebuildLightSources();
  selectLight(placedLights.find((e) => e.ref === def) || null);
}

function raycastLights() {
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(placedLights.map((e) => e.mesh), true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedLights.some((e) => e.mesh === obj)) obj = obj.parent;
  return placedLights.find((e) => e.mesh === obj) || null;
}

function selectLight(entry) {
  const previous = selectedLight;
  selectedLight = entry;
  if (previous && previous !== entry) refreshLightGizmo(previous); // drop its selected tint
  const panel = document.getElementById('ls-selected-controls');
  if (!entry) {
    panel.style.display = 'none';
    refreshLightList();
    return;
  }
  refreshLightGizmo(entry);
  panel.style.display = 'block';
  const def = entry.ref;
  document.getElementById('ls-label').value = def.label || '';
  document.getElementById('ls-type').value = def.type;
  document.getElementById('ls-color').value = def.color || '#ffffff';
  document.getElementById('ls-shadow').checked = def.castShadow === true;
  setSliderPair('ls-intensity', def.intensity ?? 12, 1);
  setSliderPair('ls-distance', def.distance ?? 12, 1);
  setSliderPair('ls-decay', def.decay ?? 2, 1);
  setSliderPair('ls-y', def.position.y ?? 0, 1);
  setSliderPair('ls-flicker', def.flicker ?? 0, 2);
  setSliderPair('ls-flicker-speed', def.flickerSpeed ?? 9, 1);
  setSliderPair('ls-angle', def.angleDeg ?? 35, 0);
  setSliderPair('ls-penumbra', def.penumbra ?? 0.5, 2);
  setSliderPair('ls-yaw', def.yawDeg ?? 0, 0);
  setSliderPair('ls-pitch', def.pitchDeg ?? -90, 0);
  setSliderPair('ls-radius', def.activationRadius ?? DEFAULT_LIGHT_ACTIVATION_RADIUS, 0);
  document.getElementById('ls-spot-fields').style.display = def.type === 'spot' ? 'block' : 'none';
  refreshLightList();
}

function refreshLightList() {
  const list = document.getElementById('ls-list');
  document.getElementById('ls-count').textContent = placedLights.length;
  list.innerHTML = placedLights
    .map((e) => {
      const active = e === selectedLight;
      const name = e.ref.label || e.ref.id;
      const swatch = `<span style="display:inline-block; width:9px; height:9px; border-radius:50%; background:${e.ref.color}; margin-right:5px;"></span>`;
      return `<div style="${active ? 'font-weight:bold;' : ''}"><span data-select-light="${e.ref.id}">${swatch}${name} <span style="opacity:0.6">(${e.ref.type}, ${e.ref.distance}m)</span></span></div>`;
    })
    .join('') || 'None placed yet.';
}

function buildLightPalette() {
  const groups = lightPresetsByCategory();
  const optionsHtml = groups
    .map((g) => `<optgroup label="${g.category}">${g.presets.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</optgroup>`)
    .join('');
  const picker = document.getElementById('ls-preset-picker');
  picker.innerHTML = optionsHtml;
  picker.value = paletteLightPresetId;

  document.getElementById('ls-palette').innerHTML = groups
    .map((g) => `<div style="margin-bottom:6px;"><div style="opacity:0.7; text-transform:uppercase; font-size:10px; letter-spacing:1px;">${g.category}</div>`
      + g.presets.map((p) => `<button data-palette-light="${p.id}" style="margin:2px 2px 0 0; padding:3px 6px; font-size:11px; border-left:6px solid ${p.def.color};">${p.label}</button>`).join('')
      + '</div>')
    .join('');
}

document.getElementById('ls-palette').addEventListener('click', (e) => {
  const id = e.target.dataset?.paletteLight;
  if (!id) return;
  paletteLightPresetId = id;
  document.getElementById('ls-preset-picker').value = id;
  armedLightPlacement = true;
  statusLine.textContent = `Click the ground to place "${LIGHT_PRESETS.find((p) => p.id === id)?.label || id}"`;
});

document.getElementById('ls-preset-picker').addEventListener('change', (e) => {
  paletteLightPresetId = e.target.value;
});

document.getElementById('place-light-btn').addEventListener('click', () => {
  armedLightPlacement = true;
  armedLightMove = false;
  statusLine.textContent = `Click the ground to place "${LIGHT_PRESETS.find((p) => p.id === paletteLightPresetId)?.label || paletteLightPresetId}"`;
});

document.getElementById('ls-label').addEventListener('input', (e) => {
  if (!selectedLight) return;
  selectedLight.ref.label = e.target.value;
  refreshLightList();
});

document.getElementById('ls-type').addEventListener('change', (e) => {
  if (!selectedLight) return;
  const def = selectedLight.ref;
  def.type = e.target.value;
  // A point light has no cone, so becoming a spot has to invent one. Aim it
  // straight down by default: that's the useful one indoors (a ceiling lamp),
  // and a cone pointing at the horizon out of nowhere reads as broken.
  if (def.type === 'spot') {
    def.angleDeg = def.angleDeg ?? 35;
    def.penumbra = def.penumbra ?? 0.5;
    def.yawDeg = def.yawDeg ?? 0;
    def.pitchDeg = def.pitchDeg ?? -90;
  }
  selectLight(selectedLight); // re-reads the panel, shows/hides the spot fields
  refreshLightGizmo(selectedLight);
  respawnLightSources();
});

document.getElementById('ls-color').addEventListener('input', (e) => {
  if (!selectedLight) return;
  selectedLight.ref.color = e.target.value;
  refreshLightGizmo(selectedLight);
  respawnLightSources();
  refreshLightList();
});

document.getElementById('ls-shadow').addEventListener('change', (e) => {
  if (!selectedLight) return;
  selectedLight.ref.castShadow = e.target.checked;
  // Unlike every other field here, this one changes the POOL's shape (shadow
  // slots are a separate sub-pool), so it's the one edit that really does
  // rebuild — see createWorldLights' rebuild().
  respawnLightSources();
});

// Every plain numeric field: [element id, decimals shown, writer, whether the
// gizmo's geometry has to be redrawn as well as the pool re-read].
for (const [id, decimals, apply, redrawGizmo] of [
  ['ls-intensity', 1, (def, v) => { def.intensity = v; }, false],
  ['ls-distance', 1, (def, v) => { def.distance = v; }, true],
  ['ls-decay', 1, (def, v) => { def.decay = v; }, false],
  ['ls-flicker', 2, (def, v) => { def.flicker = v; }, false],
  ['ls-flicker-speed', 1, (def, v) => { def.flickerSpeed = v; }, false],
  ['ls-angle', 0, (def, v) => { def.angleDeg = v; }, true],
  ['ls-penumbra', 2, (def, v) => { def.penumbra = v; }, false],
  ['ls-yaw', 0, (def, v) => { def.yawDeg = v; }, true],
  ['ls-pitch', 0, (def, v) => { def.pitchDeg = v; }, true],
  ['ls-radius', 0, (def, v) => { def.activationRadius = v; }, false],
  ['ls-y', 1, (def, v) => { def.position.y = v; }, true],
]) {
  document.getElementById(id).addEventListener('input', (e) => {
    if (!selectedLight) return;
    const v = parseFloat(e.target.value);
    document.getElementById(`${id}-out`).textContent = v.toFixed(decimals);
    apply(selectedLight.ref, v);
    if (redrawGizmo) refreshLightGizmo(selectedLight);
    respawnLightSources();
    if (id === 'ls-distance') refreshLightList();
  });
}

document.getElementById('ls-move-btn').addEventListener('click', () => {
  if (!selectedLight) return;
  armedLightMove = true;
  armedLightPlacement = false;
  statusLine.textContent = 'Click the ground to move this light (its height is kept — use the Height slider to change it)';
});

document.getElementById('ls-duplicate-btn').addEventListener('click', () => {
  if (!selectedLight) return;
  const copy = structuredClone(selectedLight.ref);
  copy.id = nextLightId();
  copy.position.x += 2;
  world.lights.push(copy);
  rebuildLightSources();
  selectLight(placedLights.find((e) => e.ref === copy) || null);
});

document.getElementById('ls-delete-btn').addEventListener('click', () => {
  if (!selectedLight) return;
  world.lights = world.lights.filter((d) => d !== selectedLight.ref);
  selectedLight = null;
  document.getElementById('ls-selected-controls').style.display = 'none';
  rebuildLightSources();
});

document.getElementById('ls-list').addEventListener('click', (e) => {
  const id = e.target.dataset?.selectLight;
  if (!id) return;
  selectLight(placedLights.find((en) => en.ref.id === id) || null);
});

buildLightPalette();

// --- EVENTS MODE (v1 — see src/sim/events.js) ---
// Same "arm a button, click ground, panel appears" flow as NPCs/teleporters
// above. The command-script editor follows the dialog-tree editor's proven
// template (src/editor/main.js's npc-dialog-node-list, ~line 4075) — an
// ordered list of rows built imperatively (not innerHTML strings) so each
// row's closures can safely mutate the right array index on edit, with a
// full re-render after any structural change (add/delete/reorder/nest) since
// these lists are always small. A working copy (eventFormSheets) is edited
// live and only written back into the real ref on "Apply", matching how the
// NPC/teleporter panels already separate "form state" from "saved state".
const EVENT_COMMAND_LABELS = {
  showDialog: 'Show Dialog', giveItem: 'Give Item', takeItem: 'Take Item', setSwitch: 'Set Switch',
  branch: 'Branch on Condition', wait: 'Wait', moveTo: 'Move To', setVisible: 'Set Visible',
  teleportPlayer: 'Teleport Player', hp: 'Heal / Damage HP', mp: 'Restore / Drain MP',
  exp: 'Grant EXP', gold: 'Grant Gold', playSound: 'Play Sound', shakeScreen: 'Shake Screen',
  fadeScreen: 'Fade Screen', learnSkill: 'Learn Skill', setPlayerControl: 'Freeze / Unfreeze Player',
  startQuest: 'Start Quest (Log Entry)', updateQuestObjective: 'Update Quest Objective', completeQuest: 'Complete Quest (Log Entry)',
  openMerchantStore: 'Open Merchant Store',
  openCraftingStation: 'Open Crafting Station', scheduleRespawn: 'Schedule Respawn', rollGatherYield: 'Roll Gathering Yield',
  openTowerDungeon: 'Open Tower Dungeon',
};
const EVENT_COMMAND_TYPES = Object.keys(EVENT_COMMAND_LABELS);
// Branch's ifCommands/elseCommands may not contain `wait` or `branch` — a
// branch always resolves synchronously in one tick (see stepEventScript in
// src/sim/events.js), so anything that would need to PARK the script has
// nowhere to resume from if it's buried inside one. showDialog is still
// allowed nested, just without choices (validateCommand enforces the same rule).
const EVENT_NESTED_DISALLOWED = new Set(['wait', 'branch', 'rollGatherYield']);

function defaultEventCommand(type) {
  switch (type) {
    case 'showDialog': return { type, text: '', choices: [] };
    case 'giveItem': case 'takeItem': return { type, itemId: '', qty: 1 };
    case 'setSwitch': return { type, switchId: '', value: true };
    case 'branch': return { type, condition: { kind: 'switch', switchId: '', state: true }, ifCommands: [], elseCommands: [] };
    case 'wait': return { type, ms: 1000 };
    case 'openCraftingStation': return { type, stationTypeId: CRAFTING_STATION_TYPE_IDS[0] || '' };
    case 'scheduleRespawn': return { type, ms: 9000 };
    case 'rollGatherYield': return { type, nodeType: 'wood' };
    case 'moveTo': return { type, targetId: '', x: 0, z: 0 };
    case 'setVisible': return { type, targetId: '', visible: false };
    case 'teleportPlayer': return { type, x: 0, y: 0, z: 0 };
    case 'hp': case 'mp': case 'exp': case 'gold': return { type, delta: 0 };
    case 'playSound': return { type, soundId: '' };
    case 'shakeScreen': return { type, intensity: 0.3, durationMs: 500 };
    case 'fadeScreen': return { type, direction: 'out', durationMs: 800, color: '#000000' };
    case 'learnSkill': return { type, skillId: '' };
    case 'setPlayerControl': return { type, locked: true };
    case 'startQuest': return { type, questId: '', name: '', description: '' };
    case 'updateQuestObjective': return { type, questId: '', text: '' };
    case 'completeQuest': return { type, questId: '' };
    case 'openMerchantStore': return { type, items: [], sellMultiplier: 0.5 };
    // One floor to start with, so the panel isn't an empty box — an author
    // picks its map and clear condition and adds the rest.
    case 'openTowerDungeon': return { type, title: 'Tower', floors: [{ name: 'Floor 1', mapId: '', requiredKills: 1 }] };
    default: return { type };
  }
}

let eventFormSheets = []; // working copy of the selected event's sheets, edited live; written back on Apply

function labeledInput(labelText, input) {
  const wrap = document.createElement('div');
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);
  wrap.appendChild(input);
  return wrap;
}

function numberInput(value, onChange, opts = {}) {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = value;
  if (opts.step !== undefined) el.step = opts.step;
  el.addEventListener('change', () => onChange(parseFloat(el.value) || 0));
  return el;
}

function textInput(value, placeholder, onChange) {
  const el = document.createElement('input');
  el.type = 'text';
  el.value = value || '';
  if (placeholder) el.placeholder = placeholder;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

/**
 * A Global/This-event-only scope select bound to `target.self` (a setSwitch
 * command, or a switch-kind condition) — see events.js's file-header note on
 * self vs global switches. No `onChanged` re-render needed since toggling
 * scope alone never changes what other fields should be showing.
 */
function switchScopeSelect(target) {
  const sel = document.createElement('select');
  const globalOpt = document.createElement('option');
  globalOpt.value = 'global';
  globalOpt.textContent = 'Global (shared across this player\'s events)';
  const selfOpt = document.createElement('option');
  selfOpt.value = 'self';
  selfOpt.textContent = 'This event only';
  if (target.self) selfOpt.selected = true; else globalOpt.selected = true;
  sel.appendChild(globalOpt);
  sel.appendChild(selfOpt);
  sel.addEventListener('change', () => { target.self = sel.value === 'self'; });
  return sel;
}

/**
 * A map's monster spawn ids, for the Tower Dungeon floor editor's "boss"
 * picker — the floor's map is usually NOT the map currently loaded into
 * `world`, so this fetches the document instead of reading local state.
 * Cached per map id for the lifetime of the page; a monster placed on that
 * map after the first fetch needs an editor reload to show up here, which
 * is the same staleness every other cross-map picker here accepts.
 */
const towerMapMonsterCache = new Map();
async function loadMapMonsterSpawns(mapId) {
  if (!mapId) return [];
  if (towerMapMonsterCache.has(mapId)) return towerMapMonsterCache.get(mapId);
  try {
    const res = await fetch(`/api/maps/${mapId}`);
    if (!res.ok) throw new Error(`server responded ${res.status}`);
    const doc = await res.json();
    const list = (doc.monsters || []).map((m) => ({ id: m.id, type: m.type }));
    towerMapMonsterCache.set(mapId, list);
    return list;
  } catch {
    return []; // an unreadable map just leaves the picker showing whatever id is already authored
  }
}

/** Renders `list` (a sheet's own top-level commands, or a branch's ifCommands/elseCommands) into `container`. `onChanged` re-renders from the root after any structural edit (add/delete/reorder/type-change) — cheap and always-correct for these small lists. */
function renderEventCommandRows(container, list, nested, onChanged) {
  container.innerHTML = '';
  list.forEach((cmd, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'border:1px solid #3a3a2a; border-radius:6px; padding:6px 8px; margin-bottom:6px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:4px;';
    const typeSelect = document.createElement('select');
    for (const t of EVENT_COMMAND_TYPES) {
      if (nested && EVENT_NESTED_DISALLOWED.has(t)) continue;
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = EVENT_COMMAND_LABELS[t];
      if (t === cmd.type) opt.selected = true;
      typeSelect.appendChild(opt);
    }
    typeSelect.addEventListener('change', () => { list[idx] = defaultEventCommand(typeSelect.value); onChanged(); });
    header.appendChild(typeSelect);

    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => { [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]]; onChanged(); });
    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.disabled = idx === list.length - 1;
    downBtn.addEventListener('click', () => { [list[idx + 1], list[idx]] = [list[idx], list[idx + 1]]; onChanged(); });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:#883f3f; border-color:#883f3f;';
    delBtn.addEventListener('click', () => { list.splice(idx, 1); onChanged(); });
    header.appendChild(upBtn);
    header.appendChild(downBtn);
    header.appendChild(delBtn);
    row.appendChild(header);

    const body = document.createElement('div');
    body.style.cssText = 'display:flex; flex-direction:column; gap:4px;';
    row.appendChild(body);

    switch (cmd.type) {
      case 'showDialog': {
        const ta = document.createElement('textarea');
        ta.rows = 2;
        ta.value = cmd.text || '';
        ta.addEventListener('change', () => { cmd.text = ta.value; });
        body.appendChild(labeledInput('Text', ta));
        if (!nested) {
          const choiceWrap = document.createElement('div');
          const renderChoices = () => {
            choiceWrap.innerHTML = '';
            (cmd.choices || []).forEach((choice, ci) => {
              const cRow = document.createElement('div');
              cRow.style.cssText = 'display:flex; gap:4px; align-items:center; margin:2px 0;';
              cRow.appendChild(textInput(choice.text, 'Choice text', (v) => { choice.text = v; }));
              const nextInput = document.createElement('input');
              nextInput.type = 'number';
              nextInput.title = 'Command index to jump to (blank = end script here)';
              nextInput.placeholder = 'next #';
              nextInput.style.width = '70px';
              nextInput.value = choice.next ?? '';
              nextInput.addEventListener('change', () => {
                choice.next = nextInput.value === '' ? undefined : parseInt(nextInput.value, 10);
              });
              cRow.appendChild(nextInput);
              const delChoice = document.createElement('button');
              delChoice.textContent = '✕';
              delChoice.addEventListener('click', () => { cmd.choices.splice(ci, 1); renderChoices(); });
              cRow.appendChild(delChoice);
              choiceWrap.appendChild(cRow);
            });
          };
          renderChoices();
          body.appendChild(labeledInput('Choices (leave empty for a plain line)', choiceWrap));
          const addChoiceBtn = document.createElement('button');
          addChoiceBtn.textContent = '+ Add Choice';
          addChoiceBtn.addEventListener('click', () => {
            cmd.choices = cmd.choices || [];
            cmd.choices.push({ text: '' });
            renderChoices();
          });
          body.appendChild(addChoiceBtn);
        }
        break;
      }
      case 'giveItem': case 'takeItem':
        body.appendChild(labeledInput('Item id', textInput(cmd.itemId, 'e.g. moonflower', (v) => { cmd.itemId = v; })));
        body.appendChild(labeledInput('Quantity', numberInput(cmd.qty, (v) => { cmd.qty = Math.max(1, v); })));
        break;
      case 'setSwitch':
        body.appendChild(labeledInput('Switch id', textInput(cmd.switchId, 'e.g. metQuestGiver', (v) => { cmd.switchId = v; })));
        {
          const sel = document.createElement('select');
          for (const v of [true, false]) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v ? 'On' : 'Off';
            if (cmd.value === v) opt.selected = true;
            sel.appendChild(opt);
          }
          sel.addEventListener('change', () => { cmd.value = sel.value === 'true'; });
          body.appendChild(labeledInput('Value', sel));
        }
        body.appendChild(labeledInput('Scope', switchScopeSelect(cmd)));
        break;
      case 'branch': {
        const kindSel = document.createElement('select');
        for (const k of ['switch', 'item', 'questState']) {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = k === 'switch' ? 'Switch is' : k === 'item' ? 'Has item' : 'Quest state';
          if (cmd.condition.kind === k) opt.selected = true;
          kindSel.appendChild(opt);
        }
        kindSel.addEventListener('change', () => { cmd.condition = { kind: kindSel.value, state: true }; onChanged(); });
        body.appendChild(labeledInput('If', kindSel));
        if (cmd.condition.kind === 'switch') {
          body.appendChild(labeledInput('Switch id', textInput(cmd.condition.switchId, 'switch id', (v) => { cmd.condition.switchId = v; })));
          body.appendChild(labeledInput('Scope', switchScopeSelect(cmd.condition)));
        } else if (cmd.condition.kind === 'item') {
          body.appendChild(labeledInput('Item id', textInput(cmd.condition.itemId, 'item id', (v) => { cmd.condition.itemId = v; })));
          body.appendChild(labeledInput('Min qty', numberInput(cmd.condition.qty ?? 1, (v) => { cmd.condition.qty = Math.max(1, v); })));
        } else {
          body.appendChild(labeledInput('Quest id', textInput(cmd.condition.questId, 'quest id', (v) => { cmd.condition.questId = v; })));
        }
        const ifLabel = document.createElement('h4');
        ifLabel.textContent = 'If true:';
        body.appendChild(ifLabel);
        const ifWrap = document.createElement('div');
        body.appendChild(ifWrap);
        const ifAddBtn = document.createElement('select');
        for (const t of EVENT_COMMAND_TYPES) { if (!EVENT_NESTED_DISALLOWED.has(t)) { const o = document.createElement('option'); o.value = t; o.textContent = EVENT_COMMAND_LABELS[t]; ifAddBtn.appendChild(o); } }
        const ifAddGo = document.createElement('button');
        ifAddGo.textContent = '+ Add';
        ifAddGo.addEventListener('click', () => { cmd.ifCommands.push(defaultEventCommand(ifAddBtn.value)); onChanged(); });
        body.appendChild(ifAddBtn);
        body.appendChild(ifAddGo);
        renderEventCommandRows(ifWrap, cmd.ifCommands, true, onChanged);

        const elseLabel = document.createElement('h4');
        elseLabel.textContent = 'Else:';
        body.appendChild(elseLabel);
        const elseWrap = document.createElement('div');
        body.appendChild(elseWrap);
        cmd.elseCommands = cmd.elseCommands || [];
        const elseAddBtn = document.createElement('select');
        for (const t of EVENT_COMMAND_TYPES) { if (!EVENT_NESTED_DISALLOWED.has(t)) { const o = document.createElement('option'); o.value = t; o.textContent = EVENT_COMMAND_LABELS[t]; elseAddBtn.appendChild(o); } }
        const elseAddGo = document.createElement('button');
        elseAddGo.textContent = '+ Add';
        elseAddGo.addEventListener('click', () => { cmd.elseCommands.push(defaultEventCommand(elseAddBtn.value)); onChanged(); });
        body.appendChild(elseAddBtn);
        body.appendChild(elseAddGo);
        renderEventCommandRows(elseWrap, cmd.elseCommands, true, onChanged);
        break;
      }
      case 'wait': {
        body.appendChild(labeledInput('Milliseconds', numberInput(cmd.ms, (v) => { cmd.ms = Math.max(0, v); })));
        const hasCastBar = document.createElement('input');
        hasCastBar.type = 'checkbox';
        hasCastBar.checked = !!cmd.castBar;
        hasCastBar.addEventListener('change', () => {
          cmd.castBar = hasCastBar.checked ? { label: 'Working...' } : undefined;
          onChanged();
        });
        body.appendChild(labeledInput('Show a progress bar to the player while waiting', hasCastBar));
        if (cmd.castBar) {
          body.appendChild(labeledInput('Progress bar label', textInput(cmd.castBar.label, 'e.g. Mining...', (v) => { cmd.castBar.label = v; })));
          const gtSel = document.createElement('select');
          const noneOpt = document.createElement('option');
          noneOpt.value = '';
          noneOpt.textContent = '(none)';
          gtSel.appendChild(noneOpt);
          for (const nt of Object.keys(NODE_TYPES)) {
            const opt = document.createElement('option');
            opt.value = nt;
            opt.textContent = nt;
            if (cmd.castBar.gatherType === nt) opt.selected = true;
            gtSel.appendChild(opt);
          }
          gtSel.addEventListener('change', () => { cmd.castBar.gatherType = gtSel.value || undefined; });
          body.appendChild(labeledInput('Gathering type (drives which VFX/animation flourish plays)', gtSel));
        }
        break;
      }
      case 'moveTo':
        body.appendChild(labeledInput('Target NPC id', textInput(cmd.targetId, 'npc id', (v) => { cmd.targetId = v; })));
        body.appendChild(labeledInput('X', numberInput(cmd.x, (v) => { cmd.x = v; }, { step: 0.1 })));
        body.appendChild(labeledInput('Z', numberInput(cmd.z, (v) => { cmd.z = v; }, { step: 0.1 })));
        break;
      case 'setVisible': {
        body.appendChild(labeledInput('Target event id', textInput(cmd.targetId, 'event id', (v) => { cmd.targetId = v; })));
        const sel = document.createElement('select');
        for (const v of [true, false]) {
          const opt = document.createElement('option'); opt.value = v; opt.textContent = v ? 'Visible' : 'Hidden';
          if (cmd.visible === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { cmd.visible = sel.value === 'true'; });
        body.appendChild(labeledInput('Set to', sel));
        break;
      }
      case 'teleportPlayer':
        body.appendChild(labeledInput('X', numberInput(cmd.x, (v) => { cmd.x = v; }, { step: 0.5 })));
        body.appendChild(labeledInput('Y', numberInput(cmd.y, (v) => { cmd.y = v; }, { step: 0.5 })));
        body.appendChild(labeledInput('Z', numberInput(cmd.z, (v) => { cmd.z = v; }, { step: 0.5 })));
        break;
      case 'hp': case 'mp': case 'exp': case 'gold':
        body.appendChild(labeledInput('Amount (negative to reduce)', numberInput(cmd.delta, (v) => { cmd.delta = v; })));
        break;
      case 'playSound':
        body.appendChild(labeledInput('Sound id', textInput(cmd.soundId, 'sound id from Audio catalog', (v) => { cmd.soundId = v; })));
        break;
      case 'shakeScreen':
        body.appendChild(labeledInput('Intensity', numberInput(cmd.intensity, (v) => { cmd.intensity = Math.max(0, v); }, { step: 0.05 })));
        body.appendChild(labeledInput('Duration (ms)', numberInput(cmd.durationMs, (v) => { cmd.durationMs = Math.max(0, v); })));
        break;
      case 'fadeScreen': {
        const dirSel = document.createElement('select');
        for (const d of ['out', 'in']) {
          const opt = document.createElement('option'); opt.value = d; opt.textContent = d === 'out' ? 'Fade to color' : 'Fade back in';
          if (cmd.direction === d) opt.selected = true;
          dirSel.appendChild(opt);
        }
        dirSel.addEventListener('change', () => { cmd.direction = dirSel.value; });
        body.appendChild(labeledInput('Direction', dirSel));
        body.appendChild(labeledInput('Duration (ms)', numberInput(cmd.durationMs, (v) => { cmd.durationMs = Math.max(0, v); })));
        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = cmd.color || '#000000';
        colorInput.addEventListener('change', () => { cmd.color = colorInput.value; });
        body.appendChild(labeledInput('Color', colorInput));
        break;
      }
      case 'learnSkill':
        body.appendChild(labeledInput('Skill id', textInput(cmd.skillId, 'skill id', (v) => { cmd.skillId = v; })));
        break;
      case 'setPlayerControl': {
        const sel = document.createElement('select');
        for (const v of [true, false]) {
          const opt = document.createElement('option');
          opt.value = v;
          opt.textContent = v ? 'Freeze (locks movement + skills)' : 'Unfreeze';
          if (cmd.locked === v) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { cmd.locked = sel.value === 'true'; });
        body.appendChild(labeledInput('Set to', sel));
        break;
      }
      case 'startQuest':
        body.appendChild(labeledInput('Quest id', textInput(cmd.questId, 'e.g. flower-delivery', (v) => { cmd.questId = v; })));
        body.appendChild(labeledInput('Name (shown in Quest Log)', textInput(cmd.name, 'e.g. Flower Delivery', (v) => { cmd.name = v; })));
        {
          const ta = document.createElement('textarea');
          ta.rows = 2;
          ta.value = cmd.description || '';
          ta.addEventListener('change', () => { cmd.description = ta.value; });
          body.appendChild(labeledInput('Description / initial objective', ta));
        }
        break;
      case 'updateQuestObjective':
        body.appendChild(labeledInput('Quest id', textInput(cmd.questId, 'must match a startQuest above', (v) => { cmd.questId = v; })));
        {
          const ta = document.createElement('textarea');
          ta.rows = 2;
          ta.value = cmd.text || '';
          ta.addEventListener('change', () => { cmd.text = ta.value; });
          body.appendChild(labeledInput('New objective text', ta));
        }
        break;
      case 'completeQuest':
        body.appendChild(labeledInput('Quest id', textInput(cmd.questId, 'must match a startQuest above', (v) => { cmd.questId = v; })));
        {
          // Optional closing line. Without one the entry simply stops showing
          // an objective, so the log reads as if the quest evaporated.
          const ta = document.createElement('textarea');
          ta.rows = 2;
          ta.placeholder = 'e.g. Delivered the parcel to Mira.';
          ta.value = cmd.text || '';
          ta.addEventListener('change', () => { cmd.text = ta.value.trim() || undefined; });
          body.appendChild(labeledInput('Completion text (optional)', ta));
        }
        break;
      case 'openMerchantStore': {
        cmd.items = cmd.items || [];
        const itemsWrap = document.createElement('div');
        const merchantItemOptions = ITEM_IDS.map((id) => `<option value="${id}">${getItemDef(id).name}</option>`)
          .concat(itemCatalog.map((i) => `<option value="${i.id}">${i.name} (authored)</option>`))
          .join('');
        const renderMerchantItems = () => {
          itemsWrap.innerHTML = '';
          cmd.items.forEach((entry, ei) => {
            const iRow = document.createElement('div');
            iRow.style.cssText = 'display:flex; gap:4px; align-items:center; margin:2px 0;';
            const itemIdSel = document.createElement('select');
            itemIdSel.innerHTML = merchantItemOptions;
            itemIdSel.value = entry.itemId;
            itemIdSel.style.cssText = 'flex:1 1 auto; min-width:70px;'; // a flex row shrinks a plain select to near-nothing without this
            itemIdSel.addEventListener('change', () => { entry.itemId = itemIdSel.value; });
            iRow.appendChild(itemIdSel);
            const priceInput = numberInput(entry.price ?? 0, (v) => { entry.price = Math.max(0, v); });
            priceInput.title = 'Gold cost to buy 1';
            priceInput.style.width = '70px';
            iRow.appendChild(priceInput);
            const stockInput = document.createElement('input');
            stockInput.type = 'number';
            stockInput.min = '0';
            stockInput.step = '1';
            stockInput.placeholder = 'unlimited';
            stockInput.title = 'Stock (blank = unlimited)';
            stockInput.style.width = '80px';
            stockInput.value = entry.stock ?? '';
            stockInput.addEventListener('change', () => {
              entry.stock = stockInput.value === '' ? undefined : Math.max(0, parseInt(stockInput.value, 10) || 0);
            });
            iRow.appendChild(stockInput);
            const delItem = document.createElement('button');
            delItem.textContent = '✕';
            delItem.addEventListener('click', () => { cmd.items.splice(ei, 1); renderMerchantItems(); });
            iRow.appendChild(delItem);
            itemsWrap.appendChild(iRow);
          });
        };
        renderMerchantItems();
        body.appendChild(labeledInput('Items for sale (id / price / stock, blank stock = unlimited)', itemsWrap));
        const addMerchantItemBtn = document.createElement('button');
        addMerchantItemBtn.textContent = '+ Add Item';
        addMerchantItemBtn.addEventListener('click', () => {
          cmd.items.push({ itemId: ITEM_IDS[0], price: 0 });
          renderMerchantItems();
        });
        body.appendChild(addMerchantItemBtn);
        body.appendChild(labeledInput(
          'Sell multiplier (what the player gets back selling TO this merchant, × the item\'s normal sell price)',
          numberInput(cmd.sellMultiplier ?? 0.5, (v) => { cmd.sellMultiplier = Math.max(0, v); }, { step: 0.05 }),
        ));
        break;
      }
      case 'openCraftingStation': {
        const sel = document.createElement('select');
        for (const id of CRAFTING_STATION_TYPE_IDS) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = CRAFTING_STATION_TYPES[id].name;
          if (cmd.stationTypeId === id) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { cmd.stationTypeId = sel.value; });
        body.appendChild(labeledInput('Station type', sel));
        break;
      }
      case 'openTowerDungeon': {
        // One row per floor: name, the MAP that floor is (any map from the
        // manifest — it's always entered as a party-scoped instance), and
        // the clear condition (kill count and/or a specific monster). Order
        // in this list IS floor order, and floor N+1 only unlocks once the
        // player cleared floor N (src/sim/towerDungeon.js).
        cmd.floors = cmd.floors || [];
        body.appendChild(labeledInput('Panel title', textInput(cmd.title ?? 'Tower', 'e.g. Spire of Ash', (v) => { cmd.title = v; })));
        const floorsWrap = document.createElement('div');
        const renderTowerFloors = () => {
          floorsWrap.innerHTML = '';
          cmd.floors.forEach((floor, fi) => {
            const fRow = document.createElement('div');
            fRow.style.cssText = 'border:1px solid #3a3a2a; border-radius:5px; padding:5px 6px; margin:4px 0;';

            const head = document.createElement('div');
            head.style.cssText = 'display:flex; gap:4px; align-items:center; margin-bottom:4px;';
            const label = document.createElement('span');
            label.textContent = `Floor ${fi + 1}`;
            label.style.cssText = 'font-size:11px; color:#c9b27a; min-width:52px;';
            head.appendChild(label);
            const nameInput = textInput(floor.name, 'floor name, e.g. Red Desert', (v) => { floor.name = v; });
            nameInput.style.cssText = 'flex:1 1 auto; min-width:70px;';
            head.appendChild(nameInput);
            const upBtn2 = document.createElement('button');
            upBtn2.textContent = '↑';
            upBtn2.disabled = fi === 0;
            upBtn2.addEventListener('click', () => { [cmd.floors[fi - 1], cmd.floors[fi]] = [cmd.floors[fi], cmd.floors[fi - 1]]; renderTowerFloors(); });
            head.appendChild(upBtn2);
            const downBtn2 = document.createElement('button');
            downBtn2.textContent = '↓';
            downBtn2.disabled = fi === cmd.floors.length - 1;
            downBtn2.addEventListener('click', () => { [cmd.floors[fi + 1], cmd.floors[fi]] = [cmd.floors[fi], cmd.floors[fi + 1]]; renderTowerFloors(); });
            head.appendChild(downBtn2);
            const delFloor = document.createElement('button');
            delFloor.textContent = '✕';
            delFloor.addEventListener('click', () => { cmd.floors.splice(fi, 1); renderTowerFloors(); });
            head.appendChild(delFloor);
            fRow.appendChild(head);

            const bossSelect = document.createElement('select');
            /** Refills the boss picker from whichever map this floor now points at, preserving an already-authored id even if that map can't be read. */
            const refreshBossOptions = async () => {
              const spawns = await loadMapMonsterSpawns(floor.mapId);
              bossSelect.innerHTML = '';
              const none = document.createElement('option');
              none.value = '';
              none.textContent = '— none (kill count only) —';
              bossSelect.appendChild(none);
              const ids = new Set(spawns.map((s) => s.id));
              if (floor.requiredMonsterId && !ids.has(floor.requiredMonsterId)) {
                const orphan = document.createElement('option');
                orphan.value = floor.requiredMonsterId;
                orphan.textContent = `${floor.requiredMonsterId} (not on this map)`;
                bossSelect.appendChild(orphan);
              }
              for (const s of spawns) {
                const o = document.createElement('option');
                o.value = s.id;
                o.textContent = `${s.id} (${s.type})`;
                bossSelect.appendChild(o);
              }
              bossSelect.value = floor.requiredMonsterId || '';
            };

            const mapSelect = document.createElement('select');
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '— pick a map —';
            mapSelect.appendChild(emptyOpt);
            for (const m of mapsCatalog) {
              const o = document.createElement('option');
              o.value = m.id;
              o.textContent = `${m.name} (${m.mapType})`;
              mapSelect.appendChild(o);
            }
            if (floor.mapId && !mapsCatalog.some((m) => m.id === floor.mapId)) {
              const orphan = document.createElement('option');
              orphan.value = floor.mapId;
              orphan.textContent = `${floor.mapId} (missing)`;
              mapSelect.appendChild(orphan);
            }
            mapSelect.value = floor.mapId || '';
            mapSelect.addEventListener('change', () => {
              floor.mapId = mapSelect.value;
              // The old boss id belongs to the previous map's spawns.
              floor.requiredMonsterId = undefined;
              refreshBossOptions();
            });
            fRow.appendChild(labeledInput('Map (entered as its own instance per party)', mapSelect));

            fRow.appendChild(labeledInput('Monsters to defeat before the next floor unlocks (0 = none)', numberInput(floor.requiredKills ?? 0, (v) => { floor.requiredKills = Math.max(0, Math.round(v)); })));

            bossSelect.addEventListener('change', () => { floor.requiredMonsterId = bossSelect.value || undefined; });
            refreshBossOptions();
            fRow.appendChild(labeledInput('Also require this specific monster to be defeated (optional)', bossSelect));

            floorsWrap.appendChild(fRow);
          });
        };
        renderTowerFloors();
        body.appendChild(labeledInput('Floors (in order — Floor 2 unlocks once Floor 1 is cleared, and so on)', floorsWrap));
        const addFloorBtn = document.createElement('button');
        addFloorBtn.textContent = '+ Add Floor';
        addFloorBtn.addEventListener('click', () => {
          cmd.floors.push({ name: `Floor ${cmd.floors.length + 1}`, mapId: '', requiredKills: 1 });
          renderTowerFloors();
        });
        body.appendChild(addFloorBtn);
        break;
      }
      case 'scheduleRespawn':
        body.appendChild(labeledInput('Respawn after (ms)', numberInput(cmd.ms, (v) => { cmd.ms = Math.max(0, v); })));
        break;
      case 'rollGatherYield': {
        const sel = document.createElement('select');
        for (const nt of Object.keys(NODE_TYPES)) {
          const opt = document.createElement('option');
          opt.value = nt;
          opt.textContent = nt;
          if (cmd.nodeType === nt) opt.selected = true;
          sel.appendChild(opt);
        }
        sel.addEventListener('change', () => { cmd.nodeType = sel.value; });
        body.appendChild(labeledInput('Gathering node type (yield table from src/sim/gathering.js)', sel));
        break;
      }
    }

    container.appendChild(row);
  });
}

/** A sheet's optional precondition editor — same condition shape as a branch command's, but with an on/off toggle since a sheet's condition is optional (undefined = always eligible, the natural "fallback" case). */
function renderSheetConditionEditor(container, sheet, onChanged) {
  container.innerHTML = '';
  const hasCondCheckbox = document.createElement('input');
  hasCondCheckbox.type = 'checkbox';
  hasCondCheckbox.checked = !!sheet.condition;
  hasCondCheckbox.addEventListener('change', () => {
    sheet.condition = hasCondCheckbox.checked ? { kind: 'switch', switchId: '', state: true } : undefined;
    onChanged();
  });
  container.appendChild(labeledInput('Only eligible if...', hasCondCheckbox));
  if (!sheet.condition) return;

  const kindSel = document.createElement('select');
  for (const k of ['switch', 'item', 'questState']) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = k === 'switch' ? 'Switch is' : k === 'item' ? 'Has item' : 'Quest state';
    if (sheet.condition.kind === k) opt.selected = true;
    kindSel.appendChild(opt);
  }
  kindSel.addEventListener('change', () => { sheet.condition = { kind: kindSel.value, state: true }; onChanged(); });
  container.appendChild(labeledInput('Condition', kindSel));
  if (sheet.condition.kind === 'switch') {
    container.appendChild(labeledInput('Switch id', textInput(sheet.condition.switchId, 'switch id', (v) => { sheet.condition.switchId = v; })));
    container.appendChild(labeledInput('Scope', switchScopeSelect(sheet.condition)));
  } else if (sheet.condition.kind === 'item') {
    container.appendChild(labeledInput('Item id', textInput(sheet.condition.itemId, 'item id', (v) => { sheet.condition.itemId = v; })));
    container.appendChild(labeledInput('Min qty', numberInput(sheet.condition.qty ?? 1, (v) => { sheet.condition.qty = Math.max(1, v); })));
  } else {
    container.appendChild(labeledInput('Quest id', textInput(sheet.condition.questId, 'quest id', (v) => { sheet.condition.questId = v; })));
  }
}

function defaultEventSheet() {
  // Explicitly false, not just absent: src/sim/events.js still DEFAULTS an
  // unspecified runOnce to true (existing authored sheets rely on that), so
  // a new sheet has to say so to start out unticked. A repeatable sheet is
  // the safer thing to author blind — a one-shot that fires before you meant
  // it to is gone for good on that save, and re-ticking the box is one click.
  return { commands: [], runOnce: false };
}

/** Renders every sheet as its own bordered block: id, precondition, runOnce, its own command list + add-command controls, and reorder/delete for the sheet itself. The FIRST sheet whose precondition passes (or has none) is the one selectEligibleSheet (src/sim/events.js) picks at trigger time — see the panel's own hint text. */
function renderEventSheetList() {
  const container = document.getElementById('event-sheet-list');
  container.innerHTML = '';
  eventFormSheets.forEach((sheet, idx) => {
    const block = document.createElement('div');
    block.style.cssText = 'border:2px solid #6b4a2a; border-radius:8px; padding:8px; margin-bottom:10px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex; align-items:center; gap:6px; margin-bottom:4px;';
    const title = document.createElement('strong');
    title.textContent = `Sheet ${idx + 1}`;
    header.appendChild(title);
    const upBtn = document.createElement('button');
    upBtn.textContent = '↑';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => { [eventFormSheets[idx - 1], eventFormSheets[idx]] = [eventFormSheets[idx], eventFormSheets[idx - 1]]; renderEventSheetList(); });
    const downBtn = document.createElement('button');
    downBtn.textContent = '↓';
    downBtn.disabled = idx === eventFormSheets.length - 1;
    downBtn.addEventListener('click', () => { [eventFormSheets[idx + 1], eventFormSheets[idx]] = [eventFormSheets[idx], eventFormSheets[idx + 1]]; renderEventSheetList(); });
    const delBtn = document.createElement('button');
    delBtn.textContent = '✕ Delete Sheet';
    delBtn.style.cssText = 'background:#883f3f; border-color:#883f3f;';
    delBtn.addEventListener('click', () => { eventFormSheets.splice(idx, 1); renderEventSheetList(); });
    header.appendChild(upBtn);
    header.appendChild(downBtn);
    header.appendChild(delBtn);
    block.appendChild(header);

    block.appendChild(labeledInput('Sheet id (optional — only needed if you want a stable target for "runOnce" across edits)', textInput(sheet.id || '', 'e.g. post-turnin', (v) => { sheet.id = v || undefined; })));

    const condWrap = document.createElement('div');
    block.appendChild(condWrap);
    const rerenderCondition = () => renderSheetConditionEditor(condWrap, sheet, rerenderCondition);
    rerenderCondition();

    const runOnceCheckbox = document.createElement('input');
    runOnceCheckbox.type = 'checkbox';
    runOnceCheckbox.checked = sheet.runOnce !== false;
    runOnceCheckbox.addEventListener('change', () => { sheet.runOnce = runOnceCheckbox.checked; });
    block.appendChild(labeledInput('Run once (this sheet stops being eligible again once it completes)', runOnceCheckbox));

    const cmdHeader = document.createElement('h4');
    cmdHeader.textContent = 'Commands';
    block.appendChild(cmdHeader);
    const cmdListEl = document.createElement('div');
    block.appendChild(cmdListEl);
    const rerenderCommands = () => renderEventCommandRows(cmdListEl, sheet.commands, false, rerenderCommands);
    rerenderCommands();

    const addSel = document.createElement('select');
    for (const t of EVENT_COMMAND_TYPES) {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = EVENT_COMMAND_LABELS[t];
      addSel.appendChild(opt);
    }
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Command';
    addBtn.style.cssText = 'width:100%; margin-top:4px;';
    addBtn.addEventListener('click', () => { sheet.commands.push(defaultEventCommand(addSel.value)); rerenderCommands(); });
    block.appendChild(addSel);
    block.appendChild(addBtn);

    container.appendChild(block);
  });
}

document.getElementById('event-add-sheet-btn').addEventListener('click', () => {
  eventFormSheets.push(defaultEventSheet());
  renderEventSheetList();
});

document.getElementById('place-event-btn').addEventListener('click', () => {
  armedEventPlacement = true;
  statusLine.textContent = 'Click the ground to place a standalone event trigger';
});

function nextEventId() {
  const used = new Set(world.events.map((e) => e.id));
  let n = 1;
  while (used.has(`event-${n}`)) n++;
  return `event-${n}`;
}

function placeEventAt(point) {
  const ev = {
    id: nextEventId(),
    name: '',
    position: { x: snap(point.x), y: 0, z: snap(point.z) },
    attachedType: null,
    start: { type: 'talk' },
    sheets: [defaultEventSheet()],
  };
  world.events.push(ev);
  const mesh = buildEventMarkerMesh(ev);
  scene.add(mesh);
  const entry = { ref: ev, mesh };
  placedEvents.push(entry);
  armedEventPlacement = false;
  refreshEventList();
  selectEvent(entry);
}

function raycastEvents() {
  raycaster.setFromCamera(pointer, camera);
  const meshes = placedEvents.map((e) => e.mesh);
  const hits = raycaster.intersectObjects(meshes, true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !placedEvents.some((e) => e.mesh === obj)) obj = obj.parent;
  return placedEvents.find((e) => e.mesh === obj) || null;
}

/** A prop type's palette category, or null for a type not in the catalog (e.g. 'custom'). */
function propTypeCategory(type) {
  return PROP_TYPES.find((pt) => pt.id === type)?.category || null;
}

/**
 * Props have no stable `id` in general (see placeEventAt's doc comment and
 * src/sim/events.js) — offering every single one here would bury the picker
 * under hundreds of anonymous scattered rocks/trees, so only two kinds are
 * eligible: `type:'model'` (a meaningful name from the model catalog, e.g.
 * "Treasure Chest") and anything in the 'crafting-stations' category (2026-
 * 07-25 — a handful of deliberately, individually placed props, same
 * reasoning as models, not scenery scattered by the hundred). The option's
 * value is `prop:<seed>` (a prop's `seed` is already unique and stable from
 * placement time) rather than its `id`, since most props don't have one yet
 * — applyEventForm resolves this back to the actual prop object and assigns
 * a real `id` the first time one gets attached.
 */
function isEventAttachableProp(p) {
  return p.type === 'model' || propTypeCategory(p.type) === 'crafting-stations';
}

function refreshEventAttachedOptions() {
  const sel = document.getElementById('event-attached');
  const attachedType = selectedEvent?.ref.attachedType;
  const currentNpc = attachedType === 'npc' ? selectedEvent.ref.attachedId : '';
  const currentPropSeed = attachedType === 'prop'
    ? world.props.find((p) => p.id === selectedEvent.ref.attachedId)?.seed
    : null;
  const npcOptions = placedNpcs.map((n) => `<option value="${n.ref.id}" ${n.ref.id === currentNpc ? 'selected' : ''}>${n.ref.name} (${n.ref.id})</option>`);
  const propOptions = world.props
    .filter(isEventAttachableProp)
    .map((p) => {
      const name = p.type === 'model'
        ? (modelCatalog.find((m) => m.id === p.modelId)?.name || p.modelId || 'Imported Model')
        : (PROP_TYPES.find((pt) => pt.id === p.type)?.label || p.type);
      return `<option value="prop:${p.seed}" ${p.seed === currentPropSeed ? 'selected' : ''}>${name} (prop)</option>`;
    });
  sel.innerHTML = '<option value="">— standalone trigger —</option>' + npcOptions.concat(propOptions).join('');
  // Setting a <select>'s value from script fires no 'change' event, so the
  // "Give a Quest" toggle — which is gated on this field naming an NPC and
  // was wired only to that event — stayed disabled after picking an NPC with
  // the 🎯 scene-picker, and only unlocked once you manually moved the
  // dropdown to something else and back. Re-deriving it here covers every
  // path that rebuilds these options, not just the one that was noticed.
  updateEventQuestToggleRowVisibility();
}

/** Raycasts against every attachable target (NPCs + isEventAttachableProp props — the same set refreshEventAttachedOptions offers) for the "click to pick target in scene" flow. Returns {type:'npc'|'prop', ref} or null. */
function raycastAttachableTargets() {
  raycaster.setFromCamera(pointer, camera);
  const npcMeshes = placedNpcs.map((n) => n.mesh);
  const propItems = placedItems.filter((i) => isEventAttachableProp(i.ref));
  const propMeshes = propItems.map((i) => i.mesh);
  const hits = raycaster.intersectObjects([...npcMeshes, ...propMeshes], true);
  if (hits.length === 0) return null;
  let obj = hits[0].object;
  while (obj.parent && !npcMeshes.includes(obj) && !propMeshes.includes(obj)) obj = obj.parent;
  const npc = placedNpcs.find((n) => n.mesh === obj);
  if (npc) return { type: 'npc', ref: npc.ref };
  const item = propItems.find((i) => i.mesh === obj);
  if (item) return { type: 'prop', ref: item.ref };
  return null;
}

/** Attaches the currently selected event to whatever was picked in the 3D view — mirrors the apply-event-btn handler's attach logic, but takes effect immediately (no need to also hit Apply) since a mis-click here is easy to notice and redo. */
function applyAttachPick(hit) {
  if (!selectedEvent) return;
  const ref = selectedEvent.ref;
  if (hit.type === 'npc') {
    ref.attachedType = 'npc';
    ref.attachedId = hit.ref.id;
    ref.position = { ...hit.ref.position };
  } else {
    if (!hit.ref.id) hit.ref.id = `prop-${hit.ref.seed}`; // first attach — give this prop a stable id (see refreshEventAttachedOptions' doc comment)
    ref.attachedType = 'prop';
    ref.attachedId = hit.ref.id;
    ref.position = { ...hit.ref.position };
  }
  scene.remove(selectedEvent.mesh);
  const mesh = buildEventMarkerMesh(ref);
  scene.add(mesh);
  selectedEvent.mesh = mesh;
  refreshEventAttachedOptions();
  highlightAttachedTarget(selectedEvent);
  document.getElementById('event-selected-info').textContent = `${ref.name || '(unnamed)'} — ${ref.id}`;
  refreshEventList();
  statusLine.textContent = `Attached to the picked ${hit.type === 'npc' ? hit.ref.name : 'object'} — outlined in gold below.`;
}

/** Outlines whatever object the given event is attached to with the shared selectionHighlight box — the fix for "I have two identically-named props and can't tell which one a dropdown entry means." Hides the outline for a standalone trigger or a dangling attachedId. */
function highlightAttachedTarget(entry) {
  if (!entry || !entry.ref.attachedType) {
    selectionHighlight.visible = false;
    return;
  }
  let mesh = null;
  if (entry.ref.attachedType === 'npc') {
    mesh = placedNpcs.find((n) => n.ref.id === entry.ref.attachedId)?.mesh;
  } else if (entry.ref.attachedType === 'prop') {
    const propRef = world.props.find((p) => p.id === entry.ref.attachedId);
    mesh = propRef && placedItems.find((i) => i.ref === propRef)?.mesh;
  }
  if (mesh) {
    selectionHighlight.visible = true;
    selectionHighlight.setFromObject(mesh);
  } else {
    selectionHighlight.visible = false;
  }
}

document.getElementById('event-pick-attached-btn').addEventListener('click', () => {
  if (!selectedEvent) return;
  armedAttachPick = true;
  statusLine.textContent = 'Click the NPC or object in the scene to attach this event to it';
});

function refreshEventZoneOptions() {
  const sel = document.getElementById('event-start-zone');
  const current = selectedEvent?.ref.start.zoneId || '';
  sel.innerHTML = (world.zones || []).map((z) => `<option value="${z.id}" ${z.id === current ? 'selected' : ''}>${z.name || z.id}</option>`).join('');
}

function updateEventStartRowVisibility() {
  const type = document.getElementById('event-start-type').value;
  document.getElementById('event-start-zone-row').style.display = type === 'enterArea' ? 'block' : 'none';
  document.getElementById('event-start-switch-row').style.display = type === 'switchOn' ? 'block' : 'none';
  // Only talk/interact show an on-screen prompt at all — an area/switch
  // trigger fires on its own, so offering a prompt there would be a field
  // that silently does nothing.
  document.getElementById('event-start-prompt-row').style.display =
    type === 'talk' || type === 'interact' ? 'block' : 'none';
}

document.getElementById('event-start-type').addEventListener('change', updateEventStartRowVisibility);

// --- EVENTS MODE: "Give a Quest" panel (v1.4 — see src/sim/events.js) ---
// A convenience form that authors a REAL src/sim/quests.js QuestDef (the
// same catalog/engine Quests mode uses — questCatalog/saveQuestCatalog are
// defined up in that section and reused here as-is) and auto-generates the
// event's `sheets` as 4 phase-conditioned entries. Mutually exclusive with
// hand-authoring `sheets` on the same event object, matching the existing
// "either/or" pattern (dialogTree vs event, npc dialog vs event) — one
// object, one source of truth for its dialog.
const eventQuestToggleRowEl = document.getElementById('event-quest-toggle-row');
const eventQuestToggleEl = document.getElementById('event-quest-toggle');
const eventNonQuestFieldsEl = document.getElementById('event-non-quest-fields');
const eventQuestFieldsEl = document.getElementById('event-quest-fields');
const eventQuestIdEl = document.getElementById('event-quest-id');
const eventQuestNameEl = document.getElementById('event-quest-name');
const eventQuestDescEl = document.getElementById('event-quest-description');
const eventQuestObjTypeEl = document.getElementById('event-quest-obj-type');
const eventQuestTargetGroupEl = document.getElementById('event-quest-target-group');
const eventQuestTargetItemEl = document.getElementById('event-quest-target-item');
const eventQuestTargetNpcEl = document.getElementById('event-quest-target-npc');
const eventQuestTurnInAtTargetEl = document.getElementById('event-quest-turnin-at-target');
const eventQuestCountEl = document.getElementById('event-quest-count');
const eventQuestMinLevelEl = document.getElementById('event-quest-min-level');
const eventQuestSwitchIdEl = document.getElementById('event-quest-switch-id');
const eventQuestSwitchStateEl = document.getElementById('event-quest-switch-state');
// The write half of the requirement above — see QuestDef's switchOnAccept/
// switchOnComplete. Deliberately fields on the QUEST rather than setSwitch
// commands spliced into the generated sheets: a `turnInAtTarget` quest is
// closed server-side with no sheet running at all, so a script-based version
// of "when this quest finishes" would silently do nothing for those.
const eventQuestSwitchAcceptIdEl = document.getElementById('event-quest-switch-accept-id');
const eventQuestSwitchAcceptStateEl = document.getElementById('event-quest-switch-accept-state');
const eventQuestSwitchCompleteIdEl = document.getElementById('event-quest-switch-complete-id');
const eventQuestSwitchCompleteStateEl = document.getElementById('event-quest-switch-complete-state');
const eventQuestDialogActiveEl = document.getElementById('event-quest-dialog-active');
const eventQuestDialogReadyEl = document.getElementById('event-quest-dialog-ready');
const eventQuestDialogCompleteEl = document.getElementById('event-quest-dialog-complete');
const eventQuestDialogLockedEl = document.getElementById('event-quest-dialog-locked');
const eventQuestRewardXpEl = document.getElementById('event-quest-reward-xp');
const eventQuestRewardGoldEl = document.getElementById('event-quest-reward-gold');
const eventQuestRewardItemsEl = document.getElementById('event-quest-reward-items');
const eventQuestStatusEl = document.getElementById('event-quest-status');
const eventQuestRequiresEl = document.getElementById('event-quest-requires');
const eventQuestListEl = document.getElementById('event-quest-list');
const eventQuestCatalogCountEl = document.getElementById('event-quest-catalog-count'); // NOT 'event-quest-count' — that id is the objective's Count input

let eventQuestRewardItems = [];

function renderEventQuestRewardItems() {
  renderRewardItemRows(eventQuestRewardItemsEl, eventQuestRewardItems, renderEventQuestRewardItems);
}
document.getElementById('event-quest-add-reward-item-btn').addEventListener('click', () => {
  eventQuestRewardItems.push({ itemId: ITEM_IDS[0], qty: 1 });
  renderEventQuestRewardItems();
});

function updateEventQuestObjTypeVisibility() {
  const t = eventQuestObjTypeEl.value;
  document.getElementById('event-quest-target-kill').style.display = t === 'kill' ? 'block' : 'none';
  document.getElementById('event-quest-target-gather').style.display = t === 'gather' ? 'block' : 'none';
  document.getElementById('event-quest-target-talk').style.display = t === 'talk' ? 'block' : 'none';
  document.getElementById('event-quest-count-row').style.display = t === 'talk' ? 'none' : 'block';
}
eventQuestObjTypeEl.addEventListener('change', updateEventQuestObjTypeVisibility);

/** Fills the item/NPC target dropdowns for the event quest form — same source data as populateQuestDropdowns above, just a separate set of <select>s. */
function populateEventQuestDropdowns() {
  const npcOptions = (world?.npcs || []).map((n) => `<option value="${n.id}">${n.name} (${n.id})</option>`).join('');
  eventQuestTargetNpcEl.innerHTML = npcOptions || '<option value="">— no NPCs placed —</option>';
  eventQuestTargetItemEl.innerHTML = [...ITEM_IDS.map((id) => `<option value="${id}">${getItemDef(id).name}</option>`),
    ...itemCatalog.map((i) => `<option value="${i.id}">${i.name} (authored)</option>`)].join('');
  // A quest can't require itself, so the one being edited is left out.
  const editingId = eventQuestIdEl.value.trim();
  const prev = eventQuestRequiresEl.value;
  eventQuestRequiresEl.innerHTML = '<option value="">— none —</option>'
    + questCatalog.filter((q) => q.id !== editingId).map((q) => `<option value="${q.id}">${q.name}</option>`).join('');
  eventQuestRequiresEl.value = prev;
  refreshEventQuestList();
}

/**
 * The whole authored quest catalog, listed inside Events mode — the same
 * quests.json Quests mode edits, so a quest authored in either place shows up
 * in both. Clicking one loads it into the form below AND links it to the
 * selected event, which is what makes "attach an existing quest to this NPC"
 * a click instead of retyping its id exactly.
 */
function refreshEventQuestList() {
  eventQuestCatalogCountEl.textContent = questCatalog.length;
  const linkedId = selectedEvent?.ref?.quest;
  eventQuestListEl.innerHTML = questCatalog.length
    ? questCatalog
        .map((q) => `<div style="${q.id === linkedId ? 'font-weight:bold;' : ''}"><span data-load-event-quest="${q.id}" style="cursor:pointer;">${q.name} <span class="hint">(${q.objective.type}${q.id === linkedId ? ', linked here' : ''})</span></span><button data-delete-event-quest="${q.id}">✕</button></div>`)
        .join('')
    : '<div>No quests authored yet — fill in the form below to make one.</div>';
}

eventQuestListEl.addEventListener('click', async (e) => {
  const loadId = e.target.dataset.loadEventQuest;
  if (loadId) {
    const q = questCatalog.find((x) => x.id === loadId);
    if (q) {
      populateEventQuestForm(q);
      eventQuestStatusEl.textContent = `Loaded "${q.name}" — click Save Quest to Catalog to link it to this NPC.`;
    }
    return;
  }
  const deleteId = e.target.dataset.deleteEventQuest;
  if (!deleteId) return;
  try {
    // Same targeted DELETE the Quests-mode list uses — see its comment for
    // why deleting by id beats re-POSTing the whole catalog.
    const res = await fetch(`/api/quests/${encodeURIComponent(deleteId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `server responded ${res.status}`);
    }
    questCatalog = (await res.json()).quests;
    refreshEventQuestList();
    refreshQuestList();
    if (selectedEvent?.ref?.quest === deleteId) delete selectedEvent.ref.quest;
    eventQuestStatusEl.textContent = 'Deleted ✓';
  } catch (err) {
    eventQuestStatusEl.textContent = err instanceof TypeError
      ? 'Delete failed: could not reach the server. Is it still running?'
      : `Delete failed: ${err.message}`;
  }
});

/** Shows/hides the "Give a Quest" toggle row — only meaningful once this event is attached to an NPC (the giver). Force-unchecks (and hides the quest form) if the event is detached/reattached to a prop while the toggle was on. */
function updateEventQuestToggleRowVisibility() {
  // Deliberately resolved through getElementById rather than the module-level
  // `const` handles below: refreshEventAttachedOptions calls this, and that
  // can run before those consts are initialised — a `const` read in its TDZ
  // throws, and a throw here would take the whole editor script down.
  const attachedValue = document.getElementById('event-attached').value;
  const isNpc = !!attachedValue && !attachedValue.startsWith('prop:');
  const toggle = document.getElementById('event-quest-toggle');
  // The row used to be display:none entirely when the event wasn't attached
  // to an NPC, so "Give a Quest" was simply absent with no explanation — which
  // read as "you can't author quests from Events at all". It's always visible
  // now; when it can't be used, it says why.
  document.getElementById('event-quest-toggle-row').style.display = 'block';
  toggle.disabled = !isNpc;
  document.getElementById('event-quest-needs-npc').style.display = isNpc ? 'none' : 'block';
  if (!isNpc && toggle.checked) {
    toggle.checked = false;
    updateEventQuestPanelVisibility();
  }
}
document.getElementById('event-attached').addEventListener('change', updateEventQuestToggleRowVisibility);

function updateEventQuestPanelVisibility() {
  // Same TDZ reasoning as updateEventQuestToggleRowVisibility above — this is
  // reachable from it, so it can't touch the module-level consts either.
  const on = document.getElementById('event-quest-toggle').checked;
  document.getElementById('event-non-quest-fields').style.display = on ? 'none' : 'block';
  document.getElementById('event-quest-fields').style.display = on ? 'block' : 'none';
}
eventQuestToggleEl.addEventListener('change', updateEventQuestPanelVisibility);

function clearEventQuestForm() {
  eventQuestIdEl.value = '';
  eventQuestIdEl.disabled = false;
  populateEventQuestDropdowns(); // after the id is set — it filters the prerequisite list by it
  eventQuestNameEl.value = '';
  eventQuestDescEl.value = '';
  eventQuestObjTypeEl.value = 'kill';
  eventQuestTurnInAtTargetEl.checked = false;
  eventQuestTargetGroupEl.value = '';
  eventQuestCountEl.value = 10;
  eventQuestMinLevelEl.value = 1;
  eventQuestRequiresEl.value = '';
  eventQuestSwitchIdEl.value = '';
  eventQuestSwitchStateEl.value = 'true';
  eventQuestSwitchAcceptIdEl.value = '';
  eventQuestSwitchAcceptStateEl.value = 'true';
  eventQuestSwitchCompleteIdEl.value = '';
  eventQuestSwitchCompleteStateEl.value = 'true';
  eventQuestDialogActiveEl.value = '';
  eventQuestDialogReadyEl.value = '';
  eventQuestDialogCompleteEl.value = '';
  eventQuestDialogLockedEl.value = '';
  eventQuestRewardXpEl.value = 50;
  eventQuestRewardGoldEl.value = 20;
  eventQuestRewardItems = [];
  renderEventQuestRewardItems();
  updateEventQuestObjTypeVisibility();
  eventQuestStatusEl.textContent = '';
}

function populateEventQuestForm(q) {
  eventQuestIdEl.value = q.id;
  eventQuestIdEl.disabled = true; // the event <-> quest link is fixed once created — delete + recreate this event to change the id
  populateEventQuestDropdowns(); // after the id is set — it filters the prerequisite list by it
  eventQuestNameEl.value = q.name;
  eventQuestDescEl.value = q.description || '';
  eventQuestObjTypeEl.value = q.objective.type;
  updateEventQuestObjTypeVisibility();
  if (q.objective.type === 'kill') eventQuestTargetGroupEl.value = q.objective.target;
  if (q.objective.type === 'gather') eventQuestTargetItemEl.value = q.objective.target;
  if (q.objective.type === 'talk') eventQuestTargetNpcEl.value = q.objective.target;
  eventQuestTurnInAtTargetEl.checked = !!q.turnInAtTarget;
  eventQuestCountEl.value = q.objective.count ?? 1;
  eventQuestMinLevelEl.value = q.minLevel ?? 1;
  eventQuestRequiresEl.value = q.requiresQuestId || '';
  eventQuestSwitchIdEl.value = q.requiredSwitch?.switchId || '';
  eventQuestSwitchStateEl.value = q.requiredSwitch?.state === false ? 'false' : 'true';
  eventQuestSwitchAcceptIdEl.value = q.switchOnAccept?.switchId || '';
  eventQuestSwitchAcceptStateEl.value = q.switchOnAccept?.state === false ? 'false' : 'true';
  eventQuestSwitchCompleteIdEl.value = q.switchOnComplete?.switchId || '';
  eventQuestSwitchCompleteStateEl.value = q.switchOnComplete?.state === false ? 'false' : 'true';
  eventQuestDialogActiveEl.value = q.dialogActive || '';
  eventQuestDialogReadyEl.value = q.dialogReady || '';
  eventQuestDialogCompleteEl.value = q.dialogComplete || '';
  eventQuestDialogLockedEl.value = q.dialogLocked || '';
  eventQuestRewardXpEl.value = q.rewards?.xp ?? 0;
  eventQuestRewardGoldEl.value = q.rewards?.gold ?? 0;
  eventQuestRewardItems = structuredClone(q.rewards?.items || []);
  renderEventQuestRewardItems();
  eventQuestStatusEl.textContent = '';
}

/** Reads the Events-mode quest form into a QuestDef, merging over any existing catalog entry with the same id, so any field this form still doesn't surface survives an edit made here. (`requiresQuestId` used to be one of those; the form owns it now.) */
function readEventQuestForm(giverNpcId) {
  const existing = questCatalog.find((x) => x.id === eventQuestIdEl.value.trim());
  const type = eventQuestObjTypeEl.value;
  const target = type === 'kill' ? eventQuestTargetGroupEl.value.trim()
    : type === 'gather' ? eventQuestTargetItemEl.value
    : eventQuestTargetNpcEl.value;
  const objective = { type, target, count: type === 'talk' ? 1 : (parseInt(eventQuestCountEl.value, 10) || 1) };
  const rewards = { ...existing?.rewards };
  const xp = parseInt(eventQuestRewardXpEl.value, 10) || 0;
  const gold = parseInt(eventQuestRewardGoldEl.value, 10) || 0;
  if (xp) rewards.xp = xp; else delete rewards.xp;
  if (gold) rewards.gold = gold; else delete rewards.gold;
  if (eventQuestRewardItems.length) rewards.items = structuredClone(eventQuestRewardItems); else delete rewards.items;
  const minLevel = parseInt(eventQuestMinLevelEl.value, 10) || 1;
  const switchId = eventQuestSwitchIdEl.value.trim();
  const acceptSwitchId = eventQuestSwitchAcceptIdEl.value.trim();
  const completeSwitchId = eventQuestSwitchCompleteIdEl.value.trim();
  return {
    ...existing,
    id: eventQuestIdEl.value.trim(),
    name: eventQuestNameEl.value.trim(),
    description: eventQuestDescEl.value.trim() || undefined,
    giverNpcId,
    objective,
    // 'talk' objectives only — parseQuests rejects it anywhere else, and the
    // checkbox is hidden for the other two types, so a box left ticked from a
    // previous edit can't leak onto a kill/gather quest.
    turnInAtTarget: type === 'talk' && eventQuestTurnInAtTargetEl.checked ? true : undefined,
    ...(minLevel > 1 ? { minLevel } : { minLevel: undefined }),
    requiresQuestId: eventQuestRequiresEl.value || undefined,
    requiredSwitch: switchId ? { switchId, state: eventQuestSwitchStateEl.value !== 'false' } : undefined,
    switchOnAccept: acceptSwitchId ? { switchId: acceptSwitchId, state: eventQuestSwitchAcceptStateEl.value !== 'false' } : undefined,
    switchOnComplete: completeSwitchId ? { switchId: completeSwitchId, state: eventQuestSwitchCompleteStateEl.value !== 'false' } : undefined,
    dialogActive: eventQuestDialogActiveEl.value.trim() || undefined,
    dialogReady: eventQuestDialogReadyEl.value.trim() || undefined,
    dialogComplete: eventQuestDialogCompleteEl.value.trim() || undefined,
    dialogLocked: eventQuestDialogLockedEl.value.trim() || undefined,
    ...(Object.keys(rewards).length ? { rewards } : { rewards: undefined }),
  };
}

/**
 * Auto-generates the 4 phase-conditioned sheets a quest-giving event runs at
 * runtime — see src/sim/events.js's v1.4 doc comment for how `questPhase`/
 * `acceptQuest`/`turnInQuest` work. All 4 use runOnce:false since the phase
 * must be re-checked on every talk, not frozen after the first match. The
 * "offer" sheet's Accept choice points at command index 1 (the acceptQuest
 * right after it) — declining ("Not now") has no `next`, so the script just
 * ends without accepting, per resumeEventChoice in src/sim/events.js.
 */
function generateQuestSheets(quest, giverDefaultLine = '') {
  const phaseSheet = (phase, commands) => ({
    id: `quest-${phase}`,
    condition: { kind: 'questPhase', questId: quest.id, phase },
    runOnce: false,
    commands,
  });

  // `turnInAtTarget` (src/sim/quests.js) moves the payout to the NPC the
  // quest sent you to, so this giver must NOT also carry a turnInQuest
  // command — whoever you reached first would win the race and the other
  // would silently no-op. The server closes those quests in registerNpcTalk
  // the instant you reach the target, which is why nothing here replaces it.
  //
  // Everything after the offer therefore falls back to the giver's OWN
  // ordinary dialog line rather than the quest description: once you've
  // accepted, this NPC's part is finished and it should just go back to being
  // a guard again. An explicitly authored dialogActive/dialogComplete still
  // wins if you want it to say "the Guild Master is expecting you".
  const afterOffer = (authored) => authored || giverDefaultLine || quest.description || '';

  // The unconditional LAST sheet — the one every phase that isn't offer/
  // active/ready/done falls through to, which in practice means 'locked': a
  // follow-up quest whose prerequisite isn't done, a minLevel gate, an unset
  // requiredSwitch. Before this existed, that NPC had no eligible sheet at
  // all and simply said nothing when talked to, which reads as broken rather
  // than as "not yet". It has no `condition` deliberately — a 'locked'-
  // conditioned sheet would still leave any future phase mute, and a
  // fallback's whole job is to have no gaps.
  const lockedSheet = () => ({
    id: 'quest-locked',
    runOnce: false,
    commands: [{ type: 'showDialog', text: quest.dialogLocked || giverDefaultLine || '...' }],
  });

  if (quest.turnInAtTarget) {
    return [
      phaseSheet('done', [{ type: 'showDialog', text: afterOffer(quest.dialogComplete) }]),
      // Reachable only in the instant between the objective completing and
      // the target's auto-turn-in, so in practice never — but a phase with no
      // eligible sheet leaves the NPC mute, and mute reads as broken.
      phaseSheet('ready', [{ type: 'showDialog', text: afterOffer(quest.dialogActive) }]),
      phaseSheet('active', [{ type: 'showDialog', text: afterOffer(quest.dialogActive) }]),
      phaseSheet('offer', [
        { type: 'showDialog', text: quest.description || '', choices: [{ text: 'Accept', next: 1 }, { text: 'Not now' }] },
        { type: 'acceptQuest', questId: quest.id },
      ]),
      lockedSheet(),
    ];
  }

  return [
    phaseSheet('done', [{ type: 'showDialog', text: quest.dialogComplete || quest.description || '' }]),
    phaseSheet('ready', [
      { type: 'turnInQuest', questId: quest.id },
      { type: 'showDialog', text: quest.dialogReady || quest.description || '' },
    ]),
    phaseSheet('active', [{ type: 'showDialog', text: quest.dialogActive || quest.description || '' }]),
    phaseSheet('offer', [
      { type: 'showDialog', text: quest.description || '', choices: [{ text: 'Accept', next: 1 }, { text: 'Not now' }] },
      { type: 'acceptQuest', questId: quest.id },
    ]),
    lockedSheet(),
  ];
}

// --- EVENTS MODE: custom interaction range (a box instead of the default circle) ---
// See src/sim/events.js's `range` field + isPointInEventRange, which the game
// client and the server both gate on, so what this box draws is exactly what
// triggers.
const eventRangeToggleEl = document.getElementById('event-range-toggle');
const eventRangeFieldsEl = document.getElementById('event-range-fields');
const EVENT_RANGE_INPUT_IDS = ['event-range-width', 'event-range-length', 'event-range-height'];

/** The range object the form currently describes, or undefined when the toggle is off (which is what stores "use the default circle" — an absent field, not a magic number). */
function readEventRangeForm() {
  if (!eventRangeToggleEl.checked) return undefined;
  const [width, length, height] = EVENT_RANGE_INPUT_IDS
    .map((id) => Math.max(0.5, parseFloat(document.getElementById(id).value) || 0.5));
  return { width, length, height };
}

function populateEventRangeForm(ref) {
  eventRangeToggleEl.checked = !!ref.range;
  eventRangeFieldsEl.style.display = ref.range ? 'block' : 'none';
  document.getElementById('event-range-width').value = ref.range?.width ?? 5;
  document.getElementById('event-range-length').value = ref.range?.length ?? 5;
  document.getElementById('event-range-height').value = ref.range?.height ?? 3;
}

/**
 * Redraws just the selected event's marker so the wireframe volume tracks the
 * numbers as they're typed, rather than only after Apply. Deliberately writes
 * `ref.range` as it goes: the box you're looking at IS the authored value, and
 * a preview that could disagree with what gets saved is worse than no preview.
 */
function refreshSelectedEventRangePreview() {
  if (!selectedEvent) return;
  selectedEvent.ref.range = readEventRangeForm();
  scene.remove(selectedEvent.mesh);
  const mesh = buildEventMarkerMesh(selectedEvent.ref);
  scene.add(mesh);
  selectedEvent.mesh = mesh;
}

eventRangeToggleEl.addEventListener('change', () => {
  eventRangeFieldsEl.style.display = eventRangeToggleEl.checked ? 'block' : 'none';
  refreshSelectedEventRangePreview();
});
for (const id of EVENT_RANGE_INPUT_IDS) {
  document.getElementById(id).addEventListener('input', refreshSelectedEventRangePreview);
}

/** An NPC's ordinary opening line — its dialog tree's start node, else the first of its plain `dialog` lines. Used as the post-accept fallback above. */
function npcDefaultDialogLine(npcId) {
  const npc = (world?.npcs || []).find((n) => n.id === npcId);
  if (!npc) return '';
  if (npc.dialogTree) {
    return npc.dialogTree.nodes.find((n) => n.id === npc.dialogTree.start)?.text || '';
  }
  return npc.dialog?.[0] || '';
}

/** Validates + upserts the Events-mode quest form into the in-memory questCatalog, then (re)generates the selected event's `sheets` from it. Returns the QuestDef, or null if validation failed (status text already set) — the caller should bail out without touching the event's mesh/list in that case. */
function applyEventQuestForm() {
  const ref = selectedEvent.ref;
  if (ref.attachedType !== 'npc') { eventQuestStatusEl.textContent = 'Give a Quest requires this event to be attached to an NPC.'; return null; }
  const q = readEventQuestForm(ref.attachedId);
  if (!q.id) { eventQuestStatusEl.textContent = 'Quest id is required.'; return null; }
  if (!q.name) { eventQuestStatusEl.textContent = 'Quest name is required.'; return null; }
  if (!q.objective.target) { eventQuestStatusEl.textContent = 'Objective target is required.'; return null; }
  const idx = questCatalog.findIndex((x) => x.id === q.id);
  if (idx >= 0) questCatalog[idx] = q; else questCatalog.push(q);
  ref.quest = q.id;
  ref.sheets = generateQuestSheets(q, npcDefaultDialogLine(ref.attachedId));
  return q;
}

document.getElementById('save-event-quest-btn').addEventListener('click', async () => {
  if (!selectedEvent) return;
  const q = applyEventQuestForm();
  if (!q) return;
  try {
    await saveQuestCatalog();
    eventQuestStatusEl.textContent = 'Saved ✓';
    refreshEventList();
    refreshEventQuestList();
    refreshQuestList(); // Quests mode lists the same catalog
  } catch (err) {
    eventQuestStatusEl.textContent = `Save failed: ${err.message}`;
  }
});

function selectEvent(entry) {
  // Switching to a different event (or deselecting) discards whatever is
  // typed in the form — same close-the-window moment setMode guards.
  if (entry !== selectedEvent && !confirmDiscardEventForm()) return;
  eventFormDirty = false;
  selectedEvent = entry;
  const controls = document.getElementById('event-selected-controls');
  highlightAttachedTarget(entry);
  if (!entry) {
    document.getElementById('event-selected-info').textContent = 'Nothing selected. Click a placed event marker, or one in the list below.';
    controls.style.display = 'none';
    return;
  }
  document.getElementById('event-selected-info').textContent = `${entry.ref.name || '(unnamed)'} — ${entry.ref.id}`;
  controls.style.display = 'block';
  document.getElementById('event-name').value = entry.ref.name || '';
  refreshEventAttachedOptions(); // also re-derives the "Give a Quest" toggle's enabled state
  populateEventRangeForm(entry.ref);
  refreshEventZoneOptions();
  document.getElementById('event-start-type').value = entry.ref.start.type;
  document.getElementById('event-start-switch').value = entry.ref.start.switchId || '';
  document.getElementById('event-start-prompt').value = entry.ref.start.prompt || '';
  updateEventStartRowVisibility();
  eventFormSheets = JSON.parse(JSON.stringify(entry.ref.sheets && entry.ref.sheets.length ? entry.ref.sheets : [defaultEventSheet()]));
  renderEventSheetList();

  const linkedQuest = entry.ref.quest ? questCatalog.find((q) => q.id === entry.ref.quest) : null;
  eventQuestToggleEl.checked = !!linkedQuest;
  updateEventQuestPanelVisibility();
  if (linkedQuest) populateEventQuestForm(linkedQuest);
  else clearEventQuestForm();
}

document.getElementById('apply-event-btn').addEventListener('click', () => {
  if (!selectedEvent) return;
  const ref = selectedEvent.ref;
  ref.name = document.getElementById('event-name').value.trim();
  const attachedValue = document.getElementById('event-attached').value;
  if (attachedValue.startsWith('prop:')) {
    const seed = parseInt(attachedValue.slice('prop:'.length), 10);
    const prop = world.props.find((p) => p.seed === seed);
    if (prop) {
      if (!prop.id) prop.id = `prop-${prop.seed}`; // first attach — give this prop a stable id (see refreshEventAttachedOptions' doc comment)
      ref.attachedType = 'prop';
      ref.attachedId = prop.id;
      ref.position = { ...prop.position }; // snap the trigger to the object it's riding along with
    }
  } else if (attachedValue) {
    ref.attachedType = 'npc';
    ref.attachedId = attachedValue;
    const npc = placedNpcs.find((n) => n.ref.id === attachedValue);
    if (npc) ref.position = { ...npc.ref.position }; // snap the trigger to the object it's riding along with
  } else {
    ref.attachedType = null;
    delete ref.attachedId;
  }
  ref.range = readEventRangeForm();
  if (eventQuestToggleEl.checked) {
    if (!applyEventQuestForm()) return; // validation message already shown; leave mesh/list untouched
    ref.start = { type: 'talk' }; // a quest giver is always a talk-triggered NPC — the Start Condition selector is hidden in this mode
  } else {
    delete ref.quest;
    const startType = document.getElementById('event-start-type').value;
    if (startType === 'enterArea') ref.start = { type: 'enterArea', zoneId: document.getElementById('event-start-zone').value };
    else if (startType === 'switchOn') ref.start = { type: 'switchOn', switchId: document.getElementById('event-start-switch').value.trim() };
    else ref.start = { type: startType };
    // Only carried for the trigger types that actually display one, so a
    // prompt typed and then switched away from doesn't linger in the data.
    const prompt = document.getElementById('event-start-prompt').value.trim();
    if (prompt && (startType === 'talk' || startType === 'interact')) ref.start.prompt = prompt;
    ref.sheets = JSON.parse(JSON.stringify(eventFormSheets));
  }

  scene.remove(selectedEvent.mesh);
  const mesh = buildEventMarkerMesh(ref);
  scene.add(mesh);
  selectedEvent.mesh = mesh;
  highlightAttachedTarget(selectedEvent);

  document.getElementById('event-selected-info').textContent = `${ref.name || '(unnamed)'} — ${ref.id}`;
  eventFormDirty = false; // the form and the ref agree again
  refreshEventList();
});

document.getElementById('delete-event-btn').addEventListener('click', () => {
  if (!selectedEvent) return;
  eventFormDirty = false; // deleting the event makes its unapplied edits moot — don't prompt on the way out
  scene.remove(selectedEvent.mesh);
  world.events = (world.events || []).filter((e) => e !== selectedEvent.ref);
  placedEvents.splice(placedEvents.indexOf(selectedEvent), 1);
  selectEvent(null);
  refreshEventList();
});

function refreshEventList() {
  document.getElementById('event-count').textContent = placedEvents.length;
  document.getElementById('event-list').innerHTML = placedEvents
    .map((e) => {
      const active = e === selectedEvent;
      return `<div style="${active ? 'font-weight:bold;' : ''}"><span data-select-event="${e.ref.id}">${e.ref.name || '(unnamed)'} — ${e.ref.id}${e.ref.attachedType === 'npc' ? ' (on NPC)' : ''}</span></div>`;
    })
    .join('');
}

document.getElementById('event-list').addEventListener('click', (e) => {
  const id = e.target.dataset.selectEvent;
  if (!id) return;
  selectEvent(placedEvents.find((ev) => ev.ref.id === id) || null);
});

document.getElementById('show-zones-checkbox').addEventListener('change', (e) => {
  setZonesVisible(e.target.checked);
});

document.getElementById('undo-btn').addEventListener('click', undoLastAction);

// --- Save / download ---
document.getElementById('save-btn').addEventListener('click', async () => {
  try {
    const res = await fetch(`/api/maps/${currentMapId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(world),
    });
    if (!res.ok) {
      // The server answers a rejected world with a real reason (parseWorld's
      // own validation message); surfacing "Server responded 400" instead
      // would hide the one thing that says WHICH field is malformed.
      const detail = await res.text().catch(() => '');
      throw new Error(detail ? `${res.status} — ${detail.slice(0, 200)}` : `Server responded ${res.status}`);
    }
    statusLine.textContent = `Saved "${world.name}" to server ✓`;
    showSaveToast(`Saved "${world.name}"`);
    markClean();
  } catch (err) {
    statusLine.textContent = `Save failed: ${err.message}`;
    showSaveToast(`Save FAILED — ${err.message}`, true);
    console.error(err);
  }
});

document.getElementById('download-btn').addEventListener('click', () => {
  if (!world) return;
  const blob = new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'world.json';
  a.click();
  URL.revokeObjectURL(url);
});

// --- Render loop ---
let lastAnimateTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastAnimateTime) / 1000);
  lastAnimateTime = now;
  updateFlyCamera(dt);
  controls.update();
  enforceCameraGroundClearance(); // after update() — that's what writes camera.position from the orbit
  updateAtmosphere(scene, camera.position, camera.position, now / 1000);

  // Everything the live game's own loop animates, so the editor breathes the
  // same way rather than showing a frozen frame of it — see src/main.js's
  // animate(). The grass/flower ticks drive the per-prop meshes' shared
  // materials (render/grassCover.js's updateGrassPropTime).
  if (swayablesDirty) {
    recollectSwayables();
    swayablesDirty = false;
  }
  updateGrassPropTime(now / 1000);
  updateFlowerPropTime(now / 1000);
  propSway?.update(now / 1000);
  for (const m of treeLeafMeshes) updateWindSwayTime(m, now / 1000);
  // The orbit TARGET, not camera.position — the map-wide environmental system
  // spawns its particles in a height band above the point it's given (that's
  // the player's feet in the live game). Handed the camera itself, rain would
  // start 1m above the lens and you'd never fly into it.
  for (const system of particleSystems) system.update(dt, controls.target);
  // Placed emitters + any spawned VFX. Streamed against the CAMERA (what's in
  // view), matching the live game — unlike the weather systems above, which
  // are authored around the orbit target.
  vfxSystem.update(dt);
  worldEmitters?.update(dt, camera.position);
  worldLightPool?.update(dt, camera.position);
  updatePostProcessing(now / 1000); // sunrays pass needs the live camera orientation — see postProcessing.js
  updateModelAnimations(scene, dt); // ambient-only clips on imported models (a turning windmill, etc.)

  if (waterMesh) updateWaterTime(waterMesh, now / 1000);
  if (seabedMesh) updateWaterTime(seabedMesh, now / 1000);
  for (const { water: lbWater, seabed: lbSeabed } of placedLakeBodies) {
    if (lbWater) updateWaterTime(lbWater, now / 1000);
    if (lbSeabed) updateWaterTime(lbSeabed, now / 1000);
  }
  for (const { water: rWater, seabed: rSeabed } of placedRivers) {
    if (rWater) updateWaterTime(rWater, now / 1000);
    if (rSeabed) updateWaterTime(rSeabed, now / 1000);
  }
  if (groundTextureOverlayMesh) updateCloudShadowTime(groundTextureOverlayMesh, dt);
  if (terrainDirty) {
    rebuildGround();
    terrainDirty = false;
    // The overlay bakes terrain height into its own vertices at build time
    // (see groundTextureMesh.js) — any terrain edit (mountain stamp, brush,
    // reset) leaves it stale at the OLD height until something re-triggers
    // groundTexDirty, silently burying/floating already-painted textures
    // relative to the newly-shaped ground until the next unrelated paint
    // stroke happens to fix it as a side effect.
    if (groundTextureOverlayMesh) groundTexDirty = true;
    lakeBodiesDirty = true;
    riversDirty = true;
    barriersDirty = true; // wall ribbons stand ON the terrain, so reshaping it moves them
    if (floorGridVisible) floorGridDirty = true; // draped, so it goes stale with the ground — skip the cost while it's hidden
  }
  if (floorGridDirty) {
    rebuildFloorGrid();
    floorGridDirty = false;
  }
  if (groundTexDirty) {
    rebuildGroundTextureOverlay();
    groundTexDirty = false;
  }
  if (waterDirty) {
    rebuildWater();
    waterDirty = false;
  }
  if (lakeBodiesDirty) {
    rebuildLakeBodies();
    lakeBodiesDirty = false;
  }
  if (riversDirty) {
    rebuildRivers();
    riversDirty = false;
  }
  if (pathsDirty) {
    rebuildPaths(); // rebuilds the draft preview too, so it settles both flags
    pathsDirty = false;
    pathDraftDirty = false;
  } else if (pathDraftDirty) {
    rebuildPathDraftPreview();
    pathDraftDirty = false;
  }
  if (barriersDirty) {
    rebuildBarriers();
    barriersDirty = false;
  }
  if (mountainsDirty) {
    rebuildMountains();
    mountainsDirty = false;
  }
  if (listsDirty) {
    refreshLists();
    listsDirty = false;
  }
  if (monsterListDirty) {
    refreshMonsterList();
    monsterListDirty = false;
  }
  if (freeformZonesDirty) {
    rebuildFreeformZones();
    freeformZonesDirty = false;
  }
  composer.render();
}
animate();

// Dev affordance: inspect the live scene from the console, same pattern as the
// Character & NPC Builder and character-creation preview.
window.__editor = {
  scene, camera, controls, renderer, vfxSystem,
  get world() { return world; },
  // Placed-emitter streaming is driven by requestAnimationFrame, which a
  // backgrounded tab suspends — exposing the streamer lets a headless check
  // tick it directly instead of waiting for frames that never come.
  get worldEmitters() { return worldEmitters; },
  /** Same reasoning for the placed-light pool — bindings only refresh on a frame tick. */
  get worldLights() { return worldLightPool; },
};

// Every <input type="range"> in the editor is finicky to nudge precisely with
// a mouse — this bolts a plain-number twin onto each one so a value can be
// typed exactly instead. Deliberately generic (not per-slider wiring): it
// doesn't touch whatever readout each slider already has, it just drives the
// range's own 'input'/'change' events so all existing bindings fire exactly
// as if the mouse had dragged it there.
const rangeNumTwins = [];
function enhanceRangeInputsWithNumberFields() {
  document.querySelectorAll('input[type="range"]').forEach((range) => {
    if (range.dataset.numTwin) return;
    range.dataset.numTwin = '1';
    range.classList.add('has-num-twin');
    const num = document.createElement('input');
    num.type = 'number';
    num.className = 'range-num-twin';
    if (range.min !== '') num.min = range.min;
    if (range.max !== '') num.max = range.max;
    num.step = range.step || 'any';
    num.value = range.value;
    range.insertAdjacentElement('afterend', num);
    num.addEventListener('input', () => {
      if (num.value === '') return;
      const v = parseFloat(num.value);
      if (Number.isNaN(v)) return;
      range.value = v; // native range setter clamps to min/max for us
      range.dispatchEvent(new Event('input', { bubbles: true }));
    });
    num.addEventListener('change', () => {
      num.value = range.value; // reflect any clamping back once typing settles
      range.dispatchEvent(new Event('change', { bubbles: true }));
    });
    rangeNumTwins.push([range, num]);
  });
}
enhanceRangeInputsWithNumberFields();
// Lots of sliders (e.g. Graphics Settings) get their .value set programmatically
// when a modal opens or a selection changes, which fires no 'input' event — an
// input-listener-only mirror would silently go stale. Polling is the only thing
// that stays correct regardless of how the underlying value changed.
setInterval(() => {
  for (const [range, num] of rangeNumTwins) {
    if (document.activeElement === num) continue;
    if (num.value !== range.value) num.value = range.value;
  }
}, 250);
