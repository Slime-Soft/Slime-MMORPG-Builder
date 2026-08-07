// src/monster-builder/main.js
// Monster Type Editor — standalone page (served at /monsters.html), the
// monster-flavored counterpart to the Character & NPC Builder and Building
// Builder. Was formerly a modal dialog embedded in the World Editor
// (public/editor.html's #monster-builder-modal) — moved out to its own page
// for the same reason those got their own pages: it's a whole separate
// authoring surface with its own 3D workspace, not something that belongs
// wedged into the map editor's sidebar.
//
// The World Editor still fetches /api/monster-types itself (see
// src/editor/main.js) so placed monsters render with their real catalog
// body instead of falling back to a slime — this page owns AUTHORING that
// catalog, not the World Editor's placement of it.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createRenderer, applyPoseTimeline } from '../render/scene.js';
import { createStudioScene, addStudioLights, enableStudioShadows } from './studio.js';
import { buildShapeMesh, setShapeOpacity } from '../generators/custom.js';
import { buildMonsterRig } from '../generators/monsterRig.js';
import { findDetachedSlots } from '../generators/monsterConnectivity.js';
import { applyIdlePose } from '../generators/rig.js';
import { ABILITY_KINDS, ABILITY_LEVEL_LADDER } from '../sim/monsterTypeDefs.js';
// A monster ability and a class skill share one effect/targeting vocabulary
// (see the header comment on src/sim/skillDefs.js) — the Abilities tab below
// authors against the same lists the Skill Builder does rather than a
// monster-only subset that would drift from it.
import { TARGETING_SHAPES, EFFECT_TYPES, DAMAGE_TYPES, BUFF_STATS, VFX_ANCHORS } from '../sim/skillDefs.js';
import { PRESET_IDS } from '../render/vfx/index.js';
import { PART_PRESETS, BODY_PRESETS, presetCategoryForRole, defaultClipsForStance } from '../generators/monsterPresets.js';
import { ITEM_IDS } from '../sim/items.js';

// --- Small shared utilities ---------------------------------------------
function hexToColorString(hex) {
  return '#' + (hex ?? 0xcccccc).toString(16).padStart(6, '0');
}

const SLOTS_BY_STANCE = {
  humanoid: ['head', 'torso', 'tail', 'armL', 'armR', 'legL', 'legR'],
  quadruped: ['head', 'torso', 'tail', 'legFrontL', 'legFrontR', 'legBackL', 'legBackR'],
};
// Sensible starting pivot per role/stance so the author never has to place
// a pivot from scratch — Slot anchor fields let them fine-tune afterward.
const DEFAULT_ANCHORS = {
  humanoid: {
    head: { x: 0, y: 1.05, z: 0 }, torso: { x: 0, y: 0.65, z: 0 }, tail: { x: 0, y: 0.5, z: -0.3 },
    armL: { x: -0.35, y: 0.9, z: 0 }, armR: { x: 0.35, y: 0.9, z: 0 },
    legL: { x: -0.15, y: 0.3, z: 0 }, legR: { x: 0.15, y: 0.3, z: 0 },
  },
  quadruped: {
    head: { x: 0, y: 0.6, z: 0.5 }, torso: { x: 0, y: 0.5, z: 0 }, tail: { x: 0, y: 0.5, z: -0.6 },
    legFrontL: { x: -0.25, y: 0.25, z: 0.35 }, legFrontR: { x: 0.25, y: 0.25, z: 0.35 },
    legBackL: { x: -0.25, y: 0.25, z: -0.35 }, legBackR: { x: 0.25, y: 0.25, z: -0.35 },
  },
};
function blankMonsterType() {
  return {
    id: '', name: '', stance: 'humanoid', slots: [],
    configuredLevel: 2, abilitySlots: [],
    baseStats: { maxHealth: 30, damage: 5, speed: 1.6, aggroRange: 8, attackRange: 1.6, attackCooldownMs: 1400 },
  };
}

// --- State -----------------------------------------------------------------
let monsterTypeCatalog = [];
let editingMonsterTypeId = null;
let currentMonsterType = blankMonsterType();
let activeSlotRole = null;
/** @type {Array<{ref: any, mesh: THREE.Mesh}>} */
let mbShapes = []; // tracked shapes for whichever slot is active — parallels currentMonsterType.slots.find(s=>s.role===activeSlotRole).shapes
let selectedMbShape = null;
let mbRig = {}; // role -> pivot Group, rebuilt whenever a monster type loads/clears
let mbMonsterGroup = null;

// Loot table's item/quest pickers draw from these — fetched independently
// since this page doesn't share the World Editor's Items/Events mode state.
let itemCatalog = [];
let questCatalog = [];
// The Skill Builder's Custom VFX Library, so an ability can point at a VFX
// authored there and not just at the built-in presets.
let vfxCatalog = [];

// --- Page tabstrip (was createTabbedModal) ---------------------------------
const TAB_IDS = ['general', 'abilities', 'model', 'prefabs'];
function showTab(id) {
  document.querySelectorAll('.mb-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  for (const tab of TAB_IDS) {
    const panel = document.getElementById(`mb-tab-${tab}`);
    if (panel) panel.style.display = tab === id ? (tab === 'model' ? 'flex' : 'block') : 'none';
  }
  if (id === 'model') setTimeout(resizeMbCanvas, 0);
}
document.querySelectorAll('.mb-tab').forEach((btn) => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// --- 3D workspace (own Scene/Camera/Renderer) -------------------------------
const mbCanvas = document.getElementById('mb-workspace-canvas');
const mbRenderer = createRenderer(mbCanvas, { shadows: true });
// createRenderer's initial setSize(window.innerWidth, window.innerHeight)
// call sets an INLINE style="width:...px;height:...px" on the canvas as a
// side effect (Three.js's default updateStyle=true) — inline style beats
// the external #mb-workspace-canvas{width:100%} rule regardless of
// selector specificity. Clearing it here hands layout sizing back to CSS
// entirely; resizeMbCanvas() below always calls setSize with
// updateStyle=false so this stays cleared.
mbCanvas.style.width = '';
mbCanvas.style.height = '';
// A neutral modelling studio, NOT the game world's atmosphere — see studio.js
// for why (the old createScene() parked a sun-glow sprite in the middle of the
// viewport and fog-tinted every colour you picked).
const mbScene = createStudioScene();
const mbCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
mbCamera.position.set(0.9, 1.6, 4.5);
const mbControls = new OrbitControls(mbCamera, mbCanvas);
mbControls.enableDamping = true;
mbControls.target.set(0, 0.7, 0);
const mbRaycaster = new THREE.Raycaster();
const mbPointer = new THREE.Vector2();
const mbSelectionHighlight = new THREE.BoxHelper(new THREE.Object3D(), 0xffdd33);
mbSelectionHighlight.visible = false;
mbScene.add(mbSelectionHighlight);

// --- Direct manipulation (drag-and-drop gizmo, same as the Building/Character Builders) ---
let gizmoDragging = false;
const gizmo = new TransformControls(mbCamera, mbCanvas);
gizmo.setSize(0.75);
gizmo.addEventListener('dragging-changed', (e) => {
  gizmoDragging = e.value;
  mbControls.enabled = !e.value; // the gizmo and the orbit camera both want the pointer — only one at a time
  if (e.value) pushMbUndo();
  else { syncMbShapeFromMesh(); selectMbShape(selectedMbShape); } // resync the number fields + highlight after the drag
});
gizmo.addEventListener('objectChange', syncMbShapeFromMesh);
mbScene.add(gizmo);

/** Copy the dragged mesh's transform back into the shape it came from. */
function syncMbShapeFromMesh() {
  const obj = gizmo.object;
  if (!obj || !selectedMbShape) return;
  const ref = selectedMbShape.ref;
  const R2D = 180 / Math.PI;
  ref.position = { x: +obj.position.x.toFixed(4), y: +obj.position.y.toFixed(4), z: +obj.position.z.toFixed(4) };
  ref.scale = { x: +obj.scale.x.toFixed(4), y: +obj.scale.y.toFixed(4), z: +obj.scale.z.toFixed(4) };
  ref.rotation = { x: +(obj.rotation.x * R2D).toFixed(2), y: +(obj.rotation.y * R2D).toFixed(2), z: +(obj.rotation.z * R2D).toFixed(2) };
  delete ref.rotationDeg; // migrated to the 3-axis rotation object
  mbSelectionHighlight.update();
}

// The gizmo is shared between two jobs — moving/rotating/scaling a SHAPE, and
// rotating a rig PIVOT to pose it — and those want different modes. Remembering
// the shape mode separately is what stops the pose editor (which is always
// rotate) from permanently leaving the gizmo in rotate mode: re-selecting a
// shape used to inherit whatever mode the pose gizmo last set, so after
// touching any body-part tab you could only ever rotate.
let shapeGizmoMode = 'translate';

/** Point the gizmo at the selected shape (or hide it when nothing is selected). */
function attachGizmo() {
  if (!selectedMbShape) { gizmo.detach(); return; }
  gizmo.setMode(shapeGizmoMode);
  gizmo.attach(selectedMbShape.mesh);
}

window.addEventListener('keydown', (e) => {
  // `matches` guarded: a keydown whose target is window/document (which have no
  // .matches) would otherwise throw and take the whole handler down with it.
  if (e.target?.matches?.('input, select, textarea')) return;
  const mode = { g: 'translate', r: 'rotate', s: 'scale' }[e.key.toLowerCase()];
  if (mode) {
    // A rig pivot only ever rotates — moving or scaling one would desync it
    // from the shapes it carries — so the shortcuts only retarget the gizmo
    // when it is actually driving a shape.
    if (selectedMbShape) { shapeGizmoMode = mode; gizmo.setMode(mode); }
  } else if (e.key === 'Escape') selectMbShape(null);
});

function resizeMbCanvas() {
  const rect = mbCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  mbCamera.aspect = rect.width / rect.height;
  mbCamera.updateProjectionMatrix();
  mbRenderer.setSize(rect.width, rect.height, false);
}
window.addEventListener('resize', resizeMbCanvas);

/**
 * Render loop: the preview always shows whichever animation (idle/walk/
 * attack) the Timeline (advanced) panel is currently editing, posed at the
 * scrubber's current time — same "scrub drives a paused preview pose"
 * pattern as the Skill Builder's frame() loop (src/skill-builder/main.js).
 * Parts with no authored keyframe for the current clip are left untouched
 * rather than reset here, so dragging the rotate gizmo on a not-yet-keyed
 * part isn't fought every frame — see applyPoseTimeline (generators/rig.js).
 */
function animateMbWorkspace() {
  requestAnimationFrame(animateMbWorkspace);
  resizeMbCanvas();
  mbControls.update();
  advanceMbPlayback();
  if (mbRig && Object.keys(mbRig).length) applyPoseTimeline(mbRig, mbClip()?.timeline || [], mbScrubTimeMs);
  if (selectedMbShape) mbSelectionHighlight.update();
  mbRenderer.render(mbScene, mbCamera);
}

/**
 * Point the camera at the current body's actual bounding box, computed
 * fresh each call rather than a fixed hand-tuned position — the preview
 * pane's aspect ratio varies (responsive width), and a fixed camera framed
 * for one aspect ratio cuts off content at another.
 */
function frameMbCamera() {
  if (!mbMonsterGroup || mbMonsterGroup.children.length === 0) return;
  const box = new THREE.Box3().setFromObject(mbMonsterGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(box.getSize(new THREE.Vector3()).x, box.getSize(new THREE.Vector3()).y, box.getSize(new THREE.Vector3()).z, 0.3);
  const aspect = mbCamera.aspect || 1;
  const fovRad = (mbCamera.fov * Math.PI) / 180;
  const fitHeightDist = maxDim / 2 / Math.tan(fovRad / 2);
  const fitWidthDist = fitHeightDist / aspect; // narrower aspect -> smaller effective horizontal FOV -> needs more distance
  const distance = Math.max(fitHeightDist, fitWidthDist) * 1.7; // padding so the body isn't touching the frame edges
  mbControls.target.copy(center);
  const dir = new THREE.Vector3(0.35, 0.45, 1).normalize();
  mbCamera.position.copy(center).addScaledVector(dir, distance);
  mbCamera.updateProjectionMatrix();
}

/** Rebuild the workspace from scratch — used on New/Load, not on every shape edit. */
function rebuildMbWorkspace() {
  if (mbMonsterGroup) mbScene.remove(mbMonsterGroup);
  const built = buildMonsterRig(currentMonsterType);
  mbMonsterGroup = built.group;
  mbRig = built.rig;
  enableStudioShadows(mbMonsterGroup); // the studio floor is a shadow catcher; nothing casts into it unless we say so
  mbScene.add(mbMonsterGroup);
  syncMbShapesToActiveSlot();
  resizeMbCanvas(); // ensure mbCamera.aspect is current before framing off of it
  frameMbCamera();
}

/** Find the pivot Group for a slot role — every pivot buildMonsterRig/ensureSlot creates is tagged with userData.slotRole, torso included, so this is a single uniform lookup rather than special-casing torso against mbRig (which only tracks the animatable subset). */
function mbPivotForRole(role) {
  return mbMonsterGroup?.children.find((c) => c.userData.slotRole === role) || null;
}

/** Point mbShapes at whichever slot is currently active, tracking its shape refs + the corresponding meshes already in the assembled rig. */
function syncMbShapesToActiveSlot() {
  selectMbShape(null);
  mbShapes = [];
  if (!activeSlotRole) return;
  const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  const pivot = mbPivotForRole(activeSlotRole);
  if (!slot || !pivot) return;
  // pivot.children are buildShapeMesh() outputs in the same order as slot.shapes.
  mbShapes = slot.shapes.map((ref, i) => ({ ref, mesh: pivot.children[i] })).filter((s) => s.mesh);
}

function ensureSlot(role) {
  let slot = currentMonsterType.slots.find((s) => s.role === role);
  if (slot) return slot;
  const anchor = DEFAULT_ANCHORS[currentMonsterType.stance]?.[role] || { x: 0, y: 0.5, z: 0 };
  slot = { role, anchor: { ...anchor }, shapes: [] };
  currentMonsterType.slots.push(slot);
  const pivot = new THREE.Group();
  pivot.position.set(anchor.x, anchor.y, anchor.z);
  pivot.userData.slotRole = role;
  mbMonsterGroup.add(pivot);
  if (role !== 'torso') mbRig[role] = pivot;
  return slot;
}

// --- Part tab strip (Head/Torso/Tail/Arms/Legs + Settings, one row) ---
let activePartTab = null; // a slot role, or 'settings'

function refreshMbPartTabstrip() {
  const strip = document.getElementById('mb-part-tabstrip');
  const roles = SLOTS_BY_STANCE[currentMonsterType.stance] || SLOTS_BY_STANCE.humanoid;
  const roleButtons = roles
    .map((role) => {
      const filled = currentMonsterType.slots.some((s) => s.role === role && s.shapes.length);
      const active = role === activePartTab;
      return `<button data-part-tab="${role}" class="${active ? 'active' : ''} ${filled ? 'filled' : ''}">${role}</button>`;
    })
    .join('');
  const settingsActive = activePartTab === 'settings' ? 'active' : '';
  strip.innerHTML = `${roleButtons}<button data-part-tab="settings" class="${settingsActive}">Settings</button>`;
  refreshPtPartOptions(); // the animatable-part list follows whichever slots exist
  refreshPtTimelineList();
  renderPtScrubber();
}

document.getElementById('mb-part-tabstrip').addEventListener('click', (e) => {
  const tab = e.target.dataset.partTab;
  if (tab) selectMbPartTab(tab);
});

function selectMbPartTab(tab) {
  activePartTab = tab;
  const isSettings = tab === 'settings';
  document.getElementById('mb-part-body-content').style.display = isSettings ? 'none' : 'block';
  document.getElementById('mb-part-settings-content').style.display = isSettings ? 'block' : 'none';
  // Collapse manual editing back to the preset picker on every part switch —
  // Adjust is a deliberate secondary action, not the default view.
  document.getElementById('mb-adjust-body').style.display = 'none';
  document.getElementById('mb-adjust-toggle').textContent = '🔧 Adjust manually ▾';
  if (!isSettings) {
    activeSlotRole = tab;
    ensureSlot(tab);
    const anchor = currentMonsterType.slots.find((s) => s.role === tab).anchor;
    document.getElementById('mb-anchor-x').value = anchor.x;
    document.getElementById('mb-anchor-y').value = anchor.y;
    document.getElementById('mb-anchor-z').value = anchor.z;
    syncMbShapesToActiveSlot();
    refreshMbShapeList();
    renderMbPresetGrid();
  }
  refreshMbPartTabstrip();
}

document.getElementById('mb-adjust-toggle').addEventListener('click', () => {
  const body = document.getElementById('mb-adjust-body');
  const nowOpen = body.style.display !== 'block';
  body.style.display = nowOpen ? 'block' : 'none';
  document.getElementById('mb-adjust-toggle').textContent = nowOpen ? '🔧 Adjust manually ▴' : '🔧 Adjust manually ▾';
});

// --- Preset thumbnails: a small dedicated offscreen renderer, not the mini workspace ---
// Cached per preset id for the session — presets are static built-in data,
// so there's nothing to invalidate, and a handful of tiny renders is cheap.
const THUMB_SIZE = 96;
const thumbCanvas = document.createElement('canvas');
const thumbRenderer = new THREE.WebGLRenderer({ canvas: thumbCanvas, antialias: true, alpha: true });
thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
const thumbScene = new THREE.Scene();
addStudioLights(thumbScene); // same three-point rig as the workspace, so a thumbnail predicts the preview
const thumbCamera = new THREE.PerspectiveCamera(40, 1, 0.05, 20);
const thumbCache = new Map(); // cacheId -> dataURL

function renderThumbnail(cacheId, shapes) {
  if (thumbCache.has(cacheId)) return thumbCache.get(cacheId);
  const group = new THREE.Group();
  for (const shapeDef of shapes) group.add(buildShapeMesh(shapeDef));
  thumbScene.add(group);
  const box = new THREE.Box3().setFromObject(group);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(0.3, box.getSize(new THREE.Vector3()).length());
  thumbCamera.position.set(center.x + size * 0.7, center.y + size * 0.6, center.z + size * 0.9);
  thumbCamera.lookAt(center);
  thumbCamera.updateProjectionMatrix();
  thumbRenderer.render(thumbScene, thumbCamera);
  const dataUrl = thumbCanvas.toDataURL('image/png');
  thumbScene.remove(group);
  thumbCache.set(cacheId, dataUrl);
  return dataUrl;
}

/** A full body preset's shapes, flattened to one world-space-ish list (each shape's local position offset by its slot anchor) for a single whole-body thumbnail render. */
function flattenBodyPresetShapes(preset) {
  const flat = [];
  for (const slot of preset.slots) {
    for (const shapeDef of slot.shapes) {
      flat.push({
        ...shapeDef,
        position: { x: shapeDef.position.x + slot.anchor.x, y: shapeDef.position.y + slot.anchor.y, z: shapeDef.position.z + slot.anchor.z },
      });
    }
  }
  return flat;
}

// --- Part preset grid (Model Editor, per body-part tab) ---
function renderMbPresetGrid() {
  const grid = document.getElementById('mb-preset-grid');
  if (!activeSlotRole) { grid.innerHTML = ''; return; }
  const category = presetCategoryForRole(activeSlotRole);
  const presets = PART_PRESETS[category] || [];
  const activeSlot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  grid.innerHTML = presets
    .map((p) => {
      const dataUrl = renderThumbnail(`part:${p.id}`, p.shapes);
      const active = activeSlot?.appliedPresetId === p.id ? 'active' : '';
      return `<div class="preset-thumb ${active}" data-apply-part-preset="${p.id}"><img src="${dataUrl}" alt="${p.label}" /><span>${p.label}</span></div>`;
    })
    .join('');
}

document.getElementById('mb-preset-grid').addEventListener('click', (e) => {
  const el = e.target.closest('[data-apply-part-preset]');
  if (el) applyPartPreset(el.dataset.applyPartPreset);
});

function applyPartPreset(presetId) {
  if (!activeSlotRole) return;
  const category = presetCategoryForRole(activeSlotRole);
  const preset = PART_PRESETS[category].find((p) => p.id === presetId);
  if (!preset) return;
  const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  const pivot = mbPivotForRole(activeSlotRole);
  for (const child of [...pivot.children]) pivot.remove(child);
  slot.shapes = structuredClone(preset.shapes);
  slot.appliedPresetId = presetId;
  for (const shapeDef of slot.shapes) pivot.add(buildShapeMesh(shapeDef));
  syncMbShapesToActiveSlot();
  refreshMbShapeList();
  refreshMbPartTabstrip();
  renderMbPresetGrid();
  frameMbCamera();
}

// --- Color swatches (recolor every shape in the active slot at once) ---
const SWATCH_COLORS = [0xc9a876, 0x8a7a68, 0x5a9a4a, 0x4a6a9a, 0x9a4a4a, 0xd4c04a, 0xeeeeee, 0x3a3a3a];

function renderMbColorSwatches() {
  document.getElementById('mb-color-swatches').innerHTML = SWATCH_COLORS
    .map((hex) => `<button class="color-swatch" style="background:${hexToColorString(hex)}" data-apply-color="${hex}" title="${hexToColorString(hex)}"></button>`)
    .join('');
}
renderMbColorSwatches(); // static list, render once

document.getElementById('mb-color-swatches').addEventListener('click', (e) => {
  const el = e.target.closest('[data-apply-color]');
  if (!el || !activeSlotRole) return;
  const hex = parseInt(el.dataset.applyColor, 10);
  for (const s of mbShapes) {
    s.ref.color = hex;
    s.mesh.material.color.setHex(hex);
  }
  if (selectedMbShape) selectMbShape(selectedMbShape); // re-sync the Adjust panel's color field
});

// --- Whole-body presets (Prefabs tab) ---
function renderMbBodyPresetGrid() {
  document.getElementById('mb-body-preset-grid').innerHTML = BODY_PRESETS
    .map((p) => {
      const dataUrl = renderThumbnail(`body:${p.id}`, flattenBodyPresetShapes(p));
      return `<div class="preset-thumb" data-apply-body-preset="${p.id}"><img src="${dataUrl}" alt="${p.name}" /><span>${p.name}</span></div>`;
    })
    .join('');
}

document.getElementById('mb-body-preset-grid').addEventListener('click', (e) => {
  const el = e.target.closest('[data-apply-body-preset]');
  if (el) applyBodyPreset(el.dataset.applyBodyPreset);
});

function applyBodyPreset(presetId) {
  const preset = BODY_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  currentMonsterType.stance = preset.stance;
  currentMonsterType.slots = structuredClone(preset.slots);
  // Prefabs ship authored idle/walk/attack clips. Cloning them onto the type
  // (rather than leaving the body to fall back on the procedural stance gait)
  // is what makes a freshly-applied prefab ANIMATED — and because they are
  // ordinary keyframes, every one of them shows up in the Timeline panel
  // below, draggable, exactly like something you keyed by hand.
  currentMonsterType.animation = preset.animation ? structuredClone(preset.animation) : {};
  document.getElementById('mb-stance').value = preset.stance;
  document.getElementById('mb-weapon-warning').style.display = preset.stance !== 'humanoid' ? 'block' : 'none';
  rebuildMbWorkspace();
  const roles = SLOTS_BY_STANCE[preset.stance] || SLOTS_BY_STANCE.humanoid;
  selectMbPartTab(roles[0]);
  selectMbClipType(mbClipType); // re-read the newly-applied clip into the timeline UI
  showTab('model');
}

[['mb-anchor-x', 'x'], ['mb-anchor-y', 'y'], ['mb-anchor-z', 'z']].forEach(([id, axis]) => {
  document.getElementById(id).addEventListener('input', () => {
    if (!activeSlotRole) return;
    const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
    const pivot = mbPivotForRole(activeSlotRole);
    if (!slot || !pivot) return;
    slot.anchor[axis] = parseFloat(document.getElementById(id).value) || 0;
    pivot.position.set(slot.anchor.x, slot.anchor.y, slot.anchor.z);
  });
});

document.querySelectorAll('[data-mb-shape]').forEach((btn) => {
  btn.addEventListener('click', () => addMbShape(btn.dataset.mbShape));
});

function addMbShape(kind) {
  if (!activeSlotRole) { document.getElementById('mb-shape-selected-info').textContent = 'Pick a body part above first.'; return; }
  pushMbUndo();
  const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  const pivot = mbPivotForRole(activeSlotRole);
  const ref = {
    id: `shape-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    kind,
    position: { x: (slot.shapes.length % 3) * 0.15 - 0.15, y: 0, z: 0 },
    rotationDeg: 0,
    scale: { x: 0.3, y: 0.3, z: 0.3 },
    color: 0xcccccc,
  };
  const mesh = buildShapeMesh(ref);
  pivot.add(mesh);
  slot.shapes.push(ref);
  mbShapes.push({ ref, mesh });
  selectMbShape(mbShapes[mbShapes.length - 1]);
  refreshMbShapeList();
  refreshMbPartTabstrip();
}

const mbShapeSelectedInfoEl = document.getElementById('mb-shape-selected-info');
const mbShapeControlsEl = document.getElementById('mb-shape-controls');
const mbsPosX = document.getElementById('mbs-pos-x');
const mbsPosY = document.getElementById('mbs-pos-y');
const mbsPosZ = document.getElementById('mbs-pos-z');
const mbsRotX = document.getElementById('mbs-rot-x');
const mbsRotY = document.getElementById('mbs-rot-y');
const mbsRotZ = document.getElementById('mbs-rot-z');
const mbsScaleX = document.getElementById('mbs-scale-x');
const mbsScaleY = document.getElementById('mbs-scale-y');
const mbsScaleZ = document.getElementById('mbs-scale-z');
const mbsColor = document.getElementById('mbs-color');
const mbsOpacity = document.getElementById('mbs-opacity');
const mbsOpacityOut = document.getElementById('mbs-opacity-out');
mbsOpacity.addEventListener('input', () => { mbsOpacityOut.textContent = parseFloat(mbsOpacity.value).toFixed(2); });

// --- MONSTER BUILDER UNDO (Ctrl+Z) ---
// A snapshot is currentMonsterType.slots, deep-cloned — restoring reuses
// rebuildMbWorkspace(), the same "rebuild the whole rig from data" entry
// point already used when switching monster types or stance.
const MB_UNDO_LIMIT = 50;
let mbUndoStack = [];
let mbUndoSuppressed = false;

function pushMbUndo() {
  if (mbUndoSuppressed || !currentMonsterType) return;
  mbUndoStack.push(structuredClone(currentMonsterType.slots));
  if (mbUndoStack.length > MB_UNDO_LIMIT) mbUndoStack.shift();
}

function undoMb() {
  if (mbUndoStack.length === 0 || !currentMonsterType) return;
  mbUndoSuppressed = true;
  currentMonsterType.slots = mbUndoStack.pop();
  rebuildMbWorkspace();
  refreshMbPartTabstrip();
  mbUndoSuppressed = false;
}

mbShapeControlsEl.addEventListener('mousedown', pushMbUndo);

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
  if (e.target.matches('input, select, textarea')) return;
  e.preventDefault();
  undoMb();
});

/** A shape ref's rotation as {x,y,z} degrees — reads the new rotation object if present, else the legacy Y-only rotationDeg (preset/hand-authored shapes now use the object; older ones fall back cleanly). */
function shapeRotation(ref) {
  if (ref.rotation) return { x: ref.rotation.x || 0, y: ref.rotation.y || 0, z: ref.rotation.z || 0 };
  return { x: 0, y: ref.rotationDeg || 0, z: 0 };
}

function selectMbShape(entry) {
  selectedMbShape = entry;
  if (!entry) {
    mbShapeSelectedInfoEl.textContent = 'Nothing selected. Click a shape above.';
    mbShapeControlsEl.style.display = 'none';
    mbSelectionHighlight.visible = false;
    refreshMbShapeList();
    attachGizmo();
    return;
  }
  mbShapeSelectedInfoEl.textContent = `${entry.ref.kind} — ${entry.ref.id.slice(-5)}`;
  mbShapeControlsEl.style.display = 'block';
  mbsPosX.value = entry.ref.position.x;
  mbsPosY.value = entry.ref.position.y;
  mbsPosZ.value = entry.ref.position.z;
  const rot = shapeRotation(entry.ref);
  mbsRotX.value = rot.x;
  mbsRotY.value = rot.y;
  mbsRotZ.value = rot.z;
  mbsScaleX.value = entry.ref.scale.x;
  mbsScaleY.value = entry.ref.scale.y;
  mbsScaleZ.value = entry.ref.scale.z;
  mbsColor.value = hexToColorString(entry.ref.color ?? 0xcccccc);
  mbsOpacity.value = entry.ref.opacity ?? 1;
  mbsOpacityOut.textContent = parseFloat(mbsOpacity.value).toFixed(2);
  mbSelectionHighlight.visible = true;
  mbSelectionHighlight.setFromObject(entry.mesh);
  refreshMbShapeList();
  attachGizmo();
}

function applyMbShapeFields() {
  if (!selectedMbShape) return;
  const { ref, mesh } = selectedMbShape;
  ref.position = { x: parseFloat(mbsPosX.value) || 0, y: parseFloat(mbsPosY.value) || 0, z: parseFloat(mbsPosZ.value) || 0 };
  ref.rotation = { x: parseFloat(mbsRotX.value) || 0, y: parseFloat(mbsRotY.value) || 0, z: parseFloat(mbsRotZ.value) || 0 };
  delete ref.rotationDeg; // migrated to the 3-axis rotation object
  ref.scale = { x: parseFloat(mbsScaleX.value) || 1, y: parseFloat(mbsScaleY.value) || 1, z: parseFloat(mbsScaleZ.value) || 1 };
  ref.color = parseInt(mbsColor.value.slice(1), 16);
  ref.opacity = parseFloat(mbsOpacity.value);
  mesh.position.set(ref.position.x, ref.position.y, ref.position.z);
  mesh.rotation.set((ref.rotation.x * Math.PI) / 180, (ref.rotation.y * Math.PI) / 180, (ref.rotation.z * Math.PI) / 180);
  mesh.scale.set(ref.scale.x, ref.scale.y, ref.scale.z);
  mesh.material.color.setHex(ref.color);
  setShapeOpacity(mesh, ref.opacity); // not a plain assignment — see its doc comment
  mbSelectionHighlight.update();
}
[mbsPosX, mbsPosY, mbsPosZ, mbsRotX, mbsRotY, mbsRotZ, mbsScaleX, mbsScaleY, mbsScaleZ, mbsColor, mbsOpacity].forEach((el) =>
  el.addEventListener('input', applyMbShapeFields)
);

document.getElementById('mb-duplicate-shape').addEventListener('click', () => {
  if (!selectedMbShape || !activeSlotRole) return;
  const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  const pivot = mbPivotForRole(activeSlotRole);
  const src = selectedMbShape.ref;
  const ref = {
    ...structuredClone(src),
    id: `shape-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    position: { x: src.position.x + 0.08, y: src.position.y, z: src.position.z + 0.08 },
  };
  const mesh = buildShapeMesh(ref);
  pivot.add(mesh);
  slot.shapes.push(ref);
  mbShapes.push({ ref, mesh });
  selectMbShape(mbShapes[mbShapes.length - 1]);
  refreshMbShapeList();
});

document.getElementById('mb-delete-shape').addEventListener('click', () => {
  if (!selectedMbShape || !activeSlotRole) return;
  pushMbUndo();
  const slot = currentMonsterType.slots.find((s) => s.role === activeSlotRole);
  const pivot = mbPivotForRole(activeSlotRole);
  pivot.remove(selectedMbShape.mesh);
  slot.shapes.splice(slot.shapes.indexOf(selectedMbShape.ref), 1);
  mbShapes.splice(mbShapes.indexOf(selectedMbShape), 1);
  selectMbShape(null);
  refreshMbShapeList();
  refreshMbPartTabstrip();
});

function refreshMbShapeList() {
  document.getElementById('mb-shape-count').textContent = mbShapes.length;
  document.getElementById('mb-shape-list').innerHTML = mbShapes
    .map((s, i) => `<div class="${s === selectedMbShape ? 'active' : ''}"><span data-select-mb-shape="${i}">${s.ref.kind}</span><button data-delete-mb-shape="${i}">✕</button></div>`)
    .join('');
}
// Click a row to select it — same "hard to select if occluded" fix as the
// World Editor's Object Builder shape list.
document.getElementById('mb-shape-list').addEventListener('click', (e) => {
  const deleteIdx = e.target.dataset.deleteMbShape;
  if (deleteIdx !== undefined) {
    const entry = mbShapes[parseInt(deleteIdx, 10)];
    if (!entry) return;
    selectMbShape(entry);
    document.getElementById('mb-delete-shape').click();
    return;
  }
  const selectIdx = e.target.dataset.selectMbShape;
  if (selectIdx === undefined) return;
  const entry = mbShapes[parseInt(selectIdx, 10)];
  if (entry) selectMbShape(entry);
});

// Click (not drag) selects a shape — pointerdown just records where the
// gesture started; pointerup checks it didn't move far (a camera orbit) and
// that the gizmo isn't mid-drag before raycasting.
let mbDownAt = null;
mbCanvas.addEventListener('pointerdown', (e) => { mbDownAt = { x: e.clientX, y: e.clientY }; });
mbCanvas.addEventListener('pointerup', (e) => {
  if (gizmoDragging || !mbDownAt) return;
  if (Math.hypot(e.clientX - mbDownAt.x, e.clientY - mbDownAt.y) > 4) return; // that was a camera drag
  const rect = mbCanvas.getBoundingClientRect();
  mbPointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mbPointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  mbRaycaster.setFromCamera(mbPointer, mbCamera);
  const hits = mbRaycaster.intersectObjects(mbShapes.map((s) => s.mesh), true);
  if (hits.length === 0) { selectMbShape(null); return; }
  let obj = hits[0].object;
  while (obj.parent && !mbShapes.some((s) => s.mesh === obj)) obj = obj.parent;
  selectMbShape(mbShapes.find((s) => s.mesh === obj) || null);
});

// --- Settings sub-tab ---
document.getElementById('mb-stance').addEventListener('change', () => {
  currentMonsterType.stance = document.getElementById('mb-stance').value;
  document.getElementById('mb-weapon-warning').style.display = currentMonsterType.stance !== 'humanoid' ? 'block' : 'none';
  rebuildMbWorkspace();
  const roles = SLOTS_BY_STANCE[currentMonsterType.stance] || SLOTS_BY_STANCE.humanoid;
  selectMbPartTab(roles[0]);
});
// --- Pose Timeline editor (Settings sub-tab): idle/walk/attack, ported from
// the Skill Builder's Timeline (advanced) system (src/skill-builder/main.js)
// so authoring a monster's poses uses the exact same event-list + scrubber
// + rotate-gizmo workflow as authoring a skill's cast animation. Unlike a
// skill's single ability timeline, a monster has three independent ones —
// stored at currentMonsterType.animation.{idleClip,walkClip,attackClip},
// each { durationMs, loop, timeline: PoseEvent[] } — see creatureTypeDefs.js.
let mbClipType = 'walkClip';
let mbScrubTimeMs = 0;
let mbSelectedPart = null;
const MB_CLIP_DEFAULT_LOOP = { idleClip: true, walkClip: true, attackClip: false };

/** Non-torso slot roles this monster actually has, in the part-tab order — the only rig pivots posable (torso isn't tracked in mbRig, same as the gait/attack-pose systems). */
function animatableRoles() {
  const order = SLOTS_BY_STANCE[currentMonsterType.stance] || SLOTS_BY_STANCE.humanoid;
  const present = new Set(currentMonsterType.slots.filter((s) => s.role !== 'torso').map((s) => s.role));
  return order.filter((r) => present.has(r));
}

/** An `ability:<id>` clip type resolves to that ability's own timeline; anything else is one of the body's three named clips. */
function abilityForClipType(type = mbClipType) {
  if (!type.startsWith('ability:')) return null;
  return currentMonsterType.abilitySlots?.find((a) => a.id === type.slice('ability:'.length)) || null;
}

function mbClip() {
  const ability = abilityForClipType();
  if (ability) {
    ability.timeline = ability.timeline || [];
    // A view over the ability, not a copy: `timeline` is the same array, so
    // every edit the shared Timeline panel makes lands on the ability itself.
    // Its length comes from the ability's own windup/effect/recovery, which is
    // the envelope triggerAbilityAnimation will actually play it against.
    return {
      durationMs: Math.max(1, (ability.windupMs || 0) + (ability.effectMs || 0) + (ability.recoveryMs || 0)),
      loop: false,
      timeline: ability.timeline,
    };
  }
  return currentMonsterType.animation?.[mbClipType] || null;
}

/** Get-or-create the clip currently being edited, seeded with a sensible per-type loop default. */
function ensureMbClip() {
  const ability = abilityForClipType();
  if (ability) {
    ability.timeline = ability.timeline || [];
    return mbClip();
  }
  if (!currentMonsterType.animation) currentMonsterType.animation = {};
  if (!currentMonsterType.animation[mbClipType]) {
    currentMonsterType.animation[mbClipType] = { durationMs: 500, loop: MB_CLIP_DEFAULT_LOOP[mbClipType], timeline: [] };
  }
  return currentMonsterType.animation[mbClipType];
}

/** Total timeline length in ms — same "max authored atMs, floored" calc as the Skill Builder's getTimelineTotal, so the scrubber's right edge matches what durationMs-driven playback actually runs. */
function mbTimelineTotal() {
  const timeline = mbClip()?.timeline || [];
  if (!timeline.length) return 500;
  return Math.max(500, ...timeline.map((e) => e.atMs));
}

function recomputeMbClipDuration() {
  // An ability clip's length is DERIVED from its windup/effect/recovery fields
  // (see mbClip), so growing its timeline must not silently rewrite the timing
  // the author set on the Abilities tab.
  if (abilityForClipType()) return;
  const clip = mbClip();
  if (clip) clip.durationMs = mbTimelineTotal();
}

/**
 * Point the shared gizmo at the selected part's pivot for direct-manipulation
 * posing, deselecting any shape (only one thing the gizmo can drive at a time).
 *
 * Does nothing unless the Timeline panel is the one on screen. This function is
 * reached from refreshPtPartOptions, which refreshMbPartTabstrip calls on every
 * part-tab switch and every shape add/delete — so without this guard, merely
 * clicking the "head" tab or adding a box yanked the gizmo off your shape onto a
 * bone pivot and locked it into rotate mode.
 */
function attachPtGizmo() {
  if (activePartTab !== 'settings') return;
  if (!mbSelectedPart || !mbRig[mbSelectedPart]) { gizmo.detach(); return; }
  if (selectedMbShape) selectMbShape(null);
  gizmo.setMode('rotate');
  gizmo.attach(mbRig[mbSelectedPart]);
  document.getElementById('pt-selected-part-label').textContent = ` (${mbSelectedPart})`;
}

function selectMbClipType(type) {
  mbClipType = type;
  mbSelectedPart = null;
  mbScrubTimeMs = 0;
  setMbPlaying(false);
  document.getElementById('pt-tab-idle').classList.toggle('active', type === 'idleClip');
  document.getElementById('pt-tab-walk').classList.toggle('active', type === 'walkClip');
  document.getElementById('pt-tab-attack').classList.toggle('active', type === 'attackClip');
  const ability = abilityForClipType(type);
  const label = document.getElementById('pt-clip-label');
  label.textContent = ability ? `Editing ability animation: ${ability.name}` : '';
  label.style.display = ability ? 'block' : 'none';
  // An ability's timeline is a one-shot driven by its own envelope — looping it
  // is not a thing the runtime can honour, so don't offer the toggle.
  document.getElementById('pt-loop').disabled = !!ability;
  document.getElementById('pt-loop').checked = ability ? false : (mbClip()?.loop ?? MB_CLIP_DEFAULT_LOOP[type]);
  applyIdlePose(mbRig); // clear whatever pose the previous clip type left behind
  refreshPtPartOptions();
  refreshPtTimelineList();
  renderPtScrubber();
}
document.getElementById('pt-tab-idle').addEventListener('click', () => selectMbClipType('idleClip'));
document.getElementById('pt-tab-walk').addEventListener('click', () => selectMbClipType('walkClip'));
document.getElementById('pt-tab-attack').addEventListener('click', () => selectMbClipType('attackClip'));

document.getElementById('pt-loop').addEventListener('change', () => {
  ensureMbClip().loop = document.getElementById('pt-loop').checked;
});

// --- Clip playback -----------------------------------------------------
// The scrubber alone answers "what does this pose look like"; only playback
// answers "does this animation READ" — whether a gait cycles smoothly, whether
// an attack telegraphs. It drives the same mbScrubTimeMs the scrubber does, so
// pausing leaves the playhead exactly where you stopped it and you can keyframe
// from there.
let mbPlaying = false;
let mbLastFrameMs = 0;
const mbPlayBtn = document.getElementById('pt-play');

function setMbPlaying(on) {
  mbPlaying = on;
  mbLastFrameMs = performance.now();
  mbPlayBtn.textContent = on ? '⏸ Pause' : '▶ Play';
  mbPlayBtn.classList.toggle('active', on);
}
mbPlayBtn.addEventListener('click', () => setMbPlaying(!mbPlaying));

function advanceMbPlayback() {
  const now = performance.now();
  const dt = Math.min(100, now - mbLastFrameMs); // a backgrounded tab must not fast-forward the clip
  mbLastFrameMs = now;
  if (!mbPlaying) return;
  const clip = mbClip();
  if (!clip || !clip.timeline?.length) return;
  const total = mbTimelineTotal();
  mbScrubTimeMs += dt;
  if (mbScrubTimeMs > total) {
    // A non-looping clip (attack) holds a beat on its last frame before
    // replaying, so a one-shot is actually watchable on repeat.
    mbScrubTimeMs = clip.loop ? mbScrubTimeMs % total : (mbScrubTimeMs > total + 400 ? 0 : total);
  }
  renderPtScrubber();
}

function refreshPtPartOptions() {
  const sel = document.getElementById('pt-part-select');
  const roles = animatableRoles();
  const keep = mbSelectedPart;
  sel.innerHTML = roles.length
    ? roles.map((r) => `<option value="${r}">${r}</option>`).join('')
    : '<option value="">(no animatable parts yet)</option>';
  sel.value = roles.includes(keep) ? keep : (roles[0] || '');
  mbSelectedPart = sel.value || null;
  attachPtGizmo();
}
document.getElementById('pt-part-select').addEventListener('change', () => {
  mbSelectedPart = document.getElementById('pt-part-select').value || null;
  attachPtGizmo();
  refreshPtTimelineList();
  renderPtScrubber();
});

/** Reads the gizmo's current live rotation of the selected part and writes/overwrites a keyframe for it at the playhead's time — same "Set Keyframe" affordance as the Skill Builder's set-keyframe-btn. */
document.getElementById('pt-set-keyframe').addEventListener('click', () => {
  if (!mbSelectedPart || !mbRig[mbSelectedPart]) return;
  const pivot = mbRig[mbSelectedPart];
  const R2D = 180 / Math.PI;
  const rotationDeg = {
    x: +(pivot.rotation.x * R2D).toFixed(1),
    y: +(pivot.rotation.y * R2D).toFixed(1),
    z: +(pivot.rotation.z * R2D).toFixed(1),
  };
  const clip = ensureMbClip();
  const atMs = Math.round(mbScrubTimeMs);
  const existing = clip.timeline.find((e) => e.part === mbSelectedPart && e.atMs === atMs);
  if (existing) existing.rotationDeg = rotationDeg;
  else clip.timeline.push({ type: 'pose', atMs, part: mbSelectedPart, rotationDeg });
  recomputeMbClipDuration();
  refreshPtTimelineList();
  renderPtScrubber();
  refreshAbTimelineSummary();
});

document.getElementById('pt-add-event').addEventListener('click', () => {
  if (!mbSelectedPart) return;
  const clip = ensureMbClip();
  const atMs = Math.round(mbScrubTimeMs);
  clip.timeline.push({ type: 'pose', atMs, part: mbSelectedPart, rotationDeg: { x: 0, y: 0, z: 0 } });
  recomputeMbClipDuration();
  refreshPtTimelineList();
  renderPtScrubber();
});

// A hand-built body starts with no clips at all, and "pose every limb by hand
// from scratch" is not a reasonable first step. This seeds all three from the
// body's stance and the slots it actually has — ordinary keyframes, so the
// result is a starting point to edit rather than a black box.
document.getElementById('pt-gen-defaults').addEventListener('click', () => {
  const roles = animatableRoles();
  if (!roles.length) {
    document.getElementById('mb-status').textContent = 'Add some body parts first — there is nothing to animate yet.';
    return;
  }
  currentMonsterType.animation = defaultClipsForStance(currentMonsterType.stance, roles);
  mbScrubTimeMs = 0;
  selectMbClipType(mbClipType);
});

document.getElementById('pt-clip-clear').addEventListener('click', () => {
  const ability = abilityForClipType();
  if (ability) ability.timeline = [];
  else if (currentMonsterType.animation) delete currentMonsterType.animation[mbClipType];
  applyIdlePose(mbRig);
  refreshPtTimelineList();
  renderPtScrubber();
  refreshAbTimelineSummary();
});

function addPtNumberInput(host, value, onChange, step = 1) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = value;
  input.style.width = '100%';
  input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
  host.appendChild(input);
  return input;
}

function refreshPtTimelineList() {
  const el = document.getElementById('pt-timeline-list');
  const timeline = mbClip()?.timeline || [];
  const sorted = [...timeline].sort((a, b) => a.atMs - b.atMs);
  el.innerHTML = '';
  for (const event of sorted) {
    const i = timeline.indexOf(event);
    const row = document.createElement('div');
    row.className = 'anim-row';
    row.style.cssText = 'flex-wrap:wrap; cursor:pointer;' + (event.part === mbSelectedPart && event.atMs === Math.round(mbScrubTimeMs) ? ' border-color:#d9a441;' : '');

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; width:100%; gap:6px; align-items:center;';
    const label = document.createElement('span');
    label.style.flex = '1';
    label.textContent = `${event.part} @ ${event.atMs}ms`;
    head.appendChild(label);
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      timeline.splice(i, 1);
      recomputeMbClipDuration();
      refreshPtTimelineList();
      renderPtScrubber();
    });
    head.appendChild(removeBtn);
    row.appendChild(head);

    for (const ax of ['x', 'y', 'z']) {
      const axLabel = document.createElement('label');
      axLabel.style.cssText = 'flex:1; margin:2px 0 0;';
      axLabel.textContent = `Rot ${ax}°`;
      addPtNumberInput(axLabel, event.rotationDeg[ax], (v) => {
        event.rotationDeg[ax] = v;
        if (event.part === mbSelectedPart) updatePtScrubPreview();
      }, 1);
      row.appendChild(axLabel);
    }

    row.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      mbSelectedPart = event.part;
      document.getElementById('pt-part-select').value = event.part;
      attachPtGizmo();
      mbScrubTimeMs = event.atMs;
      updatePtScrubPreview();
      refreshPtTimelineList();
    });
    el.appendChild(row);
  }
}

// --- Scrubber: drag the playhead to preview a paused pose, drag an event's
// diamond marker to retime it, click empty track to seek — same interaction
// as the Skill Builder's timeline scrubber (src/skill-builder/main.js).
const ptTrackEl = document.getElementById('pt-scrubber-track');
const ptEventsEl = document.getElementById('pt-scrubber-events');
const ptPlayheadEl = document.getElementById('pt-scrubber-playhead');
const ptTimeEl = document.getElementById('pt-scrubber-time');

function renderPtScrubber() {
  const total = mbTimelineTotal();
  ptTimeEl.textContent = `${Math.round(mbScrubTimeMs)} / ${Math.round(total)} ms`;
  const trackWidth = ptTrackEl.clientWidth || 1;
  ptPlayheadEl.style.left = `${(mbScrubTimeMs / total) * trackWidth}px`;

  ptEventsEl.innerHTML = '';
  const timeline = mbClip()?.timeline || [];
  for (const event of timeline) {
    const x = (event.atMs / total) * trackWidth;
    ptEventsEl.appendChild(makePtScrubMarker(event, x, total, trackWidth));
  }
}

function makePtScrubMarker(event, x, total, trackWidth) {
  const el = document.createElement('div');
  el.className = 'pt-scrub-marker';
  el.style.left = `${x}px`;
  el.classList.toggle('selected', event.part === mbSelectedPart && event.atMs === Math.round(mbScrubTimeMs));
  el.title = `${event.part} @ ${event.atMs}ms`;

  let dragStartX = null;
  let moved = false;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    dragStartX = e.clientX;
    moved = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (dragStartX === null) return;
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 2) moved = true;
    if (!moved) return;
    event.atMs = Math.max(0, Math.round(((x + dx) / trackWidth) * total));
    recomputeMbClipDuration();
    renderPtScrubber();
    refreshPtTimelineList();
  });
  el.addEventListener('pointerup', () => {
    const wasMoved = moved;
    dragStartX = null;
    moved = false;
    if (!wasMoved) {
      mbSelectedPart = event.part;
      document.getElementById('pt-part-select').value = event.part;
      attachPtGizmo();
      mbScrubTimeMs = event.atMs;
      updatePtScrubPreview();
      refreshPtTimelineList();
    }
  });
  return el;
}

ptTrackEl.addEventListener('pointerdown', (e) => {
  if (e.target !== ptTrackEl && e.target !== ptEventsEl) return;
  ptSeekFromClientX(e.clientX);
});
let ptPlayheadDragging = false;
ptPlayheadEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  ptPlayheadDragging = true;
  ptPlayheadEl.setPointerCapture(e.pointerId);
});
ptPlayheadEl.addEventListener('pointermove', (e) => { if (ptPlayheadDragging) ptSeekFromClientX(e.clientX); });
ptPlayheadEl.addEventListener('pointerup', () => { ptPlayheadDragging = false; });

function ptSeekFromClientX(clientX) {
  setMbPlaying(false); // grabbing the playhead means you want to look at one frame
  const rect = ptTrackEl.getBoundingClientRect();
  const total = mbTimelineTotal();
  mbScrubTimeMs = Math.max(0, Math.min(total, ((clientX - rect.left) / rect.width) * total));
  updatePtScrubPreview();
}

function updatePtScrubPreview() {
  renderPtScrubber();
  refreshPtTimelineList();
  if (mbRig && Object.keys(mbRig).length) applyPoseTimeline(mbRig, mbClip()?.timeline || [], mbScrubTimeMs);
}
window.addEventListener('resize', renderPtScrubber);

// --- Abilities tab ---
document.getElementById('mb-configured-level').addEventListener('input', () => {
  currentMonsterType.configuredLevel = parseInt(document.getElementById('mb-configured-level').value, 10) || 2;
  refreshAbilityLadder();
});

function refreshAbilityLadder() {
  const el = document.getElementById('mb-ability-ladder');
  el.innerHTML = ABILITY_LEVEL_LADDER.map((level) => {
    const ability = currentMonsterType.abilitySlots.find((a) => a.unlockLevel === level);
    const locked = level > currentMonsterType.configuredLevel;
    if (ability) {
      const tags = [ability.kind, `pwr ${ability.power}`, `${(ability.cooldownMs / 1000).toFixed(1)}s cd`];
      if (ability.effects?.length > 1) tags.push(`${ability.effects.length} effects`);
      if (ability.timeline?.length) tags.push('🎬');
      const editing = editingAbilityId === ability.id ? ' editing' : '';
      return `<div class="ability-ladder-row${editing}"><span class="level-badge">Lv${level}</span><span style="flex:1">${ability.icon ? `${ability.icon} ` : ''}${escapeHtml(ability.name)} <span class="hint">(${tags.join(', ')})</span></span><button data-edit-ability="${level}">✎</button><button data-delete-ability="${level}">✕</button></div>`;
    }
    return `<div class="ability-ladder-row" style="opacity:${locked ? 0.4 : 1}"><span class="level-badge">Lv${level}</span><span style="flex:1" class="hint">${locked ? 'Locked (raise configured level)' : 'Empty'}</span><button data-create-ability="${level}" ${locked ? 'disabled' : ''}>+ Create</button></div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

document.getElementById('mb-ability-ladder').addEventListener('click', (e) => {
  const createLevel = e.target.dataset.createAbility;
  const editLevel = e.target.dataset.editAbility;
  const deleteLevel = e.target.dataset.deleteAbility;
  if (createLevel !== undefined) openAbilityEditor(createAbility(parseInt(createLevel, 10)));
  else if (editLevel !== undefined) {
    const ability = currentMonsterType.abilitySlots.find((a) => a.unlockLevel === parseInt(editLevel, 10));
    if (ability) openAbilityEditor(ability);
  } else if (deleteLevel !== undefined) {
    deleteAbilityAtLevel(parseInt(deleteLevel, 10));
  }
});

// =========================================================================
// Ability editor — the Skill Builder's authoring shape, for monsters.
//
// This used to be four chained window.prompt() calls, which meant a monster's
// moveset could only ever be {name, kind, power, cooldown}: no targeting, no
// status effects, no VFX, no per-ability animation. A monster ability and a
// class skill are the same KIND of object (see src/sim/skillDefs.js, whose
// `effects`/`targeting`/timeline vocabulary was always meant to serve both), so
// they get the same editor: a real form, an effects list you can stack, VFX
// pickers, and — via the shared Timeline panel in the Model tab — its own pose
// timeline. `triggerAbilityAnimation` (src/render/scene.js) already reads a
// flat `timeline`/`vfx` off whatever ability it is handed, so an ability
// authored here plays back with no runtime changes.
// =========================================================================
let editingAbilityId = null;
const abForm = document.getElementById('mb-ability-form');
const abEmpty = document.getElementById('mb-ability-empty');

/** Every VFX id the pickers offer — built-in presets plus the Custom VFX Library. */
function allVfxIds() {
  return [...PRESET_IDS, ...vfxCatalog.map((v) => v.id)];
}

function fillSelect(el, values, { includeNone = false, labels = null } = {}) {
  el.innerHTML = (includeNone ? '<option value="">— none —</option>' : '')
    + values.map((v) => `<option value="${v}">${labels ? labels(v) : v}</option>`).join('');
}

// Static option lists — filled once, since none of them depend on the type.
fillSelect(document.getElementById('ab-kind'), ABILITY_KINDS);
fillSelect(document.getElementById('ab-shape'), TARGETING_SHAPES);
fillSelect(document.getElementById('ab-effect-add-type'), EFFECT_TYPES);
for (const id of ['ab-cast-anchor', 'ab-impact-anchor']) fillSelect(document.getElementById(id), VFX_ANCHORS);

function refreshAbVfxPickers() {
  const ids = allVfxIds();
  for (const id of ['ab-cast-vfx', 'ab-impact-vfx', 'ab-travel-vfx']) {
    const el = document.getElementById(id);
    const keep = el.value;
    fillSelect(el, ids, { includeNone: true });
    el.value = ids.includes(keep) ? keep : '';
  }
}

/** The ability currently open in the form, or null. */
function editingAbility() {
  return currentMonsterType.abilitySlots.find((a) => a.id === editingAbilityId) || null;
}

function createAbility(level) {
  const ability = {
    id: `ability-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    name: `Attack Lv${level}`,
    description: '',
    kind: 'melee',
    unlockLevel: level,
    power: 10,
    cooldownMs: 2000,
    windupMs: 150,
    effectMs: 150,
    recoveryMs: 200,
    targeting: { range: 2, shape: 'single' },
    effects: [{ type: 'damage', amount: 10, damageType: 'physical' }],
  };
  currentMonsterType.abilitySlots.push(ability);
  currentMonsterType.abilitySlots.sort((a, b) => a.unlockLevel - b.unlockLevel);
  return ability;
}

function deleteAbilityAtLevel(level) {
  const gone = currentMonsterType.abilitySlots.find((a) => a.unlockLevel === level);
  currentMonsterType.abilitySlots = currentMonsterType.abilitySlots.filter((a) => a.unlockLevel !== level);
  if (gone && gone.id === editingAbilityId) closeAbilityEditor();
  // An ability's own timeline is the clip the Model tab may currently be
  // editing — drop back to the body's attack clip rather than leaving the
  // Timeline panel pointed at a deleted object.
  if (mbClipType === `ability:${gone?.id}`) selectMbClipType('attackClip');
  refreshAbilityLadder();
}

function closeAbilityEditor() {
  editingAbilityId = null;
  abForm.style.display = 'none';
  abEmpty.style.display = 'block';
  refreshAbilityLadder();
}
document.getElementById('ab-close').addEventListener('click', closeAbilityEditor);

const AB_FIELDS = [
  ['ab-name', 'name', 'text'], ['ab-icon', 'icon', 'text'], ['ab-description', 'description', 'text'],
  ['ab-kind', 'kind', 'text'],
  ['ab-cooldown', 'cooldownMs', 'num'], ['ab-windup', 'windupMs', 'num'],
  ['ab-effect', 'effectMs', 'num'], ['ab-recovery', 'recoveryMs', 'num'],
];

function openAbilityEditor(ability) {
  // Catalogs written before this editor existed carry a bare `power` and no
  // `effects`. Synthesise the equivalent effect on open, or the first keystroke
  // in the form would run syncAbilityPower against an empty effects list and
  // silently zero a working ability's damage.
  if (!ability.effects) {
    ability.effects = ability.power > 0
      ? [{ type: 'damage', amount: ability.power, damageType: 'physical' }]
      : [];
  }
  editingAbilityId = ability.id;
  abForm.style.display = 'block';
  abEmpty.style.display = 'none';
  document.getElementById('ab-title').textContent = `Lv${ability.unlockLevel} — ${ability.name}`;
  document.getElementById('ab-name').value = ability.name || '';
  document.getElementById('ab-icon').value = ability.icon || '';
  document.getElementById('ab-description').value = ability.description || '';
  document.getElementById('ab-kind').value = ability.kind || 'melee';
  document.getElementById('ab-unlock').value = ability.unlockLevel;
  document.getElementById('ab-cooldown').value = ability.cooldownMs ?? 2000;
  document.getElementById('ab-windup').value = ability.windupMs ?? 150;
  document.getElementById('ab-effect').value = ability.effectMs ?? 150;
  document.getElementById('ab-recovery').value = ability.recoveryMs ?? 200;
  const t = ability.targeting || (ability.targeting = { range: 2, shape: 'single' });
  document.getElementById('ab-range').value = t.range ?? 2;
  document.getElementById('ab-shape').value = t.shape || 'single';
  document.getElementById('ab-radius').value = t.radius ?? 3;
  document.getElementById('ab-angle').value = t.angleDeg ?? 45;
  document.getElementById('ab-chain').value = t.chainCount ?? 2;
  refreshAbVfxPickers();
  document.getElementById('ab-cast-vfx').value = ability.vfx?.castVfxId || '';
  document.getElementById('ab-impact-vfx').value = ability.vfx?.impactVfxId || '';
  document.getElementById('ab-travel-vfx').value = ability.vfx?.travelVfxId || '';
  document.getElementById('ab-cast-anchor').value = ability.vfx?.castAnchor || 'hand';
  document.getElementById('ab-impact-anchor').value = ability.vfx?.impactAnchor || 'target';
  refreshAbShapeFields();
  refreshAbEffectList();
  refreshAbTimelineSummary();
  refreshAbilityLadder();
}

/** Only show the targeting fields the chosen shape actually uses. */
function refreshAbShapeFields() {
  const shape = document.getElementById('ab-shape').value;
  document.getElementById('ab-radius-wrap').style.display = (shape === 'aoe-circle' || shape === 'aoe-line') ? 'block' : 'none';
  document.getElementById('ab-angle-wrap').style.display = shape === 'aoe-cone' ? 'block' : 'none';
  document.getElementById('ab-chain-wrap').style.display = shape === 'chain' ? 'block' : 'none';
}

/** Push every scalar field back onto the ability being edited. */
function applyAbilityFields() {
  const ability = editingAbility();
  if (!ability) return;
  ability.name = document.getElementById('ab-name').value.trim() || 'Unnamed';
  const icon = document.getElementById('ab-icon').value.trim();
  if (icon) ability.icon = icon; else delete ability.icon;
  ability.description = document.getElementById('ab-description').value;
  ability.kind = document.getElementById('ab-kind').value;
  ability.cooldownMs = Math.max(0, parseFloat(document.getElementById('ab-cooldown').value) || 0);
  ability.windupMs = Math.max(0, parseFloat(document.getElementById('ab-windup').value) || 0);
  ability.effectMs = Math.max(0, parseFloat(document.getElementById('ab-effect').value) || 0);
  ability.recoveryMs = Math.max(0, parseFloat(document.getElementById('ab-recovery').value) || 0);

  const shape = document.getElementById('ab-shape').value;
  const targeting = { range: parseFloat(document.getElementById('ab-range').value) || 1, shape };
  if (shape === 'aoe-circle' || shape === 'aoe-line') targeting.radius = parseFloat(document.getElementById('ab-radius').value) || 1;
  if (shape === 'aoe-cone') targeting.angleDeg = parseFloat(document.getElementById('ab-angle').value) || 45;
  if (shape === 'chain') targeting.chainCount = parseInt(document.getElementById('ab-chain').value, 10) || 1;
  ability.targeting = targeting;

  const vfx = {};
  const cast = document.getElementById('ab-cast-vfx').value;
  const impact = document.getElementById('ab-impact-vfx').value;
  const travel = document.getElementById('ab-travel-vfx').value;
  if (cast) { vfx.castVfxId = cast; vfx.castAnchor = document.getElementById('ab-cast-anchor').value; }
  if (impact) { vfx.impactVfxId = impact; vfx.impactAnchor = document.getElementById('ab-impact-anchor').value; }
  if (travel) vfx.travelVfxId = travel;
  if (Object.keys(vfx).length) ability.vfx = vfx; else delete ability.vfx;

  syncAbilityPower(ability);
  document.getElementById('ab-title').textContent = `Lv${ability.unlockLevel} — ${ability.name}`;
  refreshAbShapeFields();
  refreshAbilityLadder();
}

/**
 * `power` is the number the SERVER actually deals (server/index.js applies
 * `attackEvent.damage` straight from it), so it is kept in lockstep with the
 * first damage/dot effect rather than being a second, silently-diverging field
 * the author has to remember to update. An ability with no damage effect at all
 * (a pure stun/taunt) reports 0 and says so.
 */
function syncAbilityPower(ability) {
  const dmg = (ability.effects || []).find((e) => e.type === 'damage');
  const dot = (ability.effects || []).find((e) => e.type === 'dot');
  ability.power = dmg ? (dmg.amount || 0) : 0;
  const note = document.getElementById('ab-power-note');
  if (dmg) {
    note.style.display = 'none';
  } else {
    note.style.display = 'block';
    note.textContent = dot
      ? '⚠ No direct damage — this hit deals 0 on impact; only the damage-over-time ticks.'
      : '⚠ No damage effect: this ability lands for 0 damage. Add a "damage" effect if that is not deliberate.';
  }
}

for (const [id] of AB_FIELDS) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', applyAbilityFields);
}
for (const id of ['ab-range', 'ab-shape', 'ab-radius', 'ab-angle', 'ab-chain', 'ab-cast-vfx', 'ab-impact-vfx', 'ab-travel-vfx', 'ab-cast-anchor', 'ab-impact-anchor']) {
  document.getElementById(id).addEventListener('input', applyAbilityFields);
  document.getElementById(id).addEventListener('change', applyAbilityFields);
}

document.getElementById('ab-delete').addEventListener('click', () => {
  const ability = editingAbility();
  if (ability) deleteAbilityAtLevel(ability.unlockLevel);
});

// --- Effects list ---------------------------------------------------------
// Which extra fields each effect type carries. Driving the rows off a table
// (rather than a switch per type) means adding an effect type to skillDefs.js
// makes it authorable here with no UI work.
const EFFECT_FIELDS = {
  damage: [['amount', 'Amount', 'num'], ['damageType', 'Damage type', DAMAGE_TYPES]],
  heal: [['amount', 'Amount', 'num']],
  stun: [['durationMs', 'Duration (ms)', 'num']],
  freeze: [['durationMs', 'Duration (ms)', 'num']],
  sleep: [['durationMs', 'Duration (ms)', 'num']],
  slow: [['durationMs', 'Duration (ms)', 'num'], ['slowPercent', 'Slow (0-1)', 'num']],
  dot: [['damagePerTick', 'Damage / tick', 'num'], ['tickMs', 'Tick every (ms)', 'num'], ['durationMs', 'Duration (ms)', 'num'], ['damageType', 'Damage type', DAMAGE_TYPES]],
  hot: [['healPerTick', 'Heal / tick', 'num'], ['tickMs', 'Tick every (ms)', 'num'], ['durationMs', 'Duration (ms)', 'num']],
  buff: [['stat', 'Stat', BUFF_STATS], ['amount', 'Amount', 'num'], ['durationMs', 'Duration (ms)', 'num']],
  shield: [['amount', 'Absorb', 'num'], ['durationMs', 'Duration (ms)', 'num']],
  taunt: [['durationMs', 'Duration (ms)', 'num']],
  knockback: [['distance', 'Distance (m)', 'num']],
  pull: [['distance', 'Distance (m)', 'num']],
};
const EFFECT_DEFAULTS = {
  damage: { amount: 10, damageType: 'physical' },
  heal: { amount: 10 },
  stun: { durationMs: 1000 },
  freeze: { durationMs: 1500 },
  sleep: { durationMs: 3000 },
  slow: { durationMs: 3000, slowPercent: 0.4 },
  dot: { damagePerTick: 3, tickMs: 1000, durationMs: 5000, damageType: 'poison' },
  hot: { healPerTick: 3, tickMs: 1000, durationMs: 5000 },
  buff: { stat: 'armor', amount: 10, durationMs: 5000 },
  shield: { amount: 20, durationMs: 5000 },
  taunt: { durationMs: 4000 },
  knockback: { distance: 3 },
  pull: { distance: 3 },
};

function refreshAbEffectList() {
  const host = document.getElementById('ab-effect-list');
  host.innerHTML = '';
  const ability = editingAbility();
  if (!ability) return;
  ability.effects = ability.effects || [];
  if (!ability.effects.length) {
    host.innerHTML = '<div class="hint">No effects — this ability currently does nothing. Add one below.</div>';
    return;
  }
  ability.effects.forEach((effect, i) => {
    const row = document.createElement('div');
    row.className = 'ab-effect-row';
    const head = document.createElement('div');
    head.className = 'ab-effect-head';
    const title = document.createElement('strong');
    title.textContent = effect.type;
    head.appendChild(title);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.addEventListener('click', () => {
      ability.effects.splice(i, 1);
      syncAbilityPower(ability);
      refreshAbEffectList();
      refreshAbilityLadder();
    });
    head.appendChild(del);
    row.appendChild(head);

    for (const [key, label, kind] of EFFECT_FIELDS[effect.type] || []) {
      const wrap = document.createElement('label');
      wrap.textContent = label;
      let input;
      if (Array.isArray(kind)) {
        input = document.createElement('select');
        fillSelect(input, kind);
        input.value = effect[key] ?? kind[0];
        input.addEventListener('change', () => { effect[key] = input.value; refreshAbilityLadder(); });
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.step = key === 'slowPercent' ? 0.05 : 1;
        input.value = effect[key] ?? 0;
        input.addEventListener('input', () => {
          effect[key] = parseFloat(input.value) || 0;
          syncAbilityPower(ability);
          refreshAbilityLadder();
        });
      }
      wrap.appendChild(input);
      row.appendChild(wrap);
    }
    host.appendChild(row);
  });
}

document.getElementById('ab-effect-add').addEventListener('click', () => {
  const ability = editingAbility();
  if (!ability) return;
  const type = document.getElementById('ab-effect-add-type').value;
  ability.effects = ability.effects || [];
  ability.effects.push({ type, ...structuredClone(EFFECT_DEFAULTS[type] || {}) });
  syncAbilityPower(ability);
  refreshAbEffectList();
  refreshAbilityLadder();
});

// --- Per-ability animation ------------------------------------------------
function refreshAbTimelineSummary() {
  const ability = editingAbility();
  const el = document.getElementById('ab-timeline-summary');
  const n = ability?.timeline?.length || 0;
  el.textContent = n
    ? `${n} keyframe/VFX event(s) authored — this ability drives its own animation.`
    : 'No animation authored — falls back to this monster’s Attack clip.';
}

document.getElementById('ab-edit-timeline').addEventListener('click', () => {
  const ability = editingAbility();
  if (!ability) return;
  ability.timeline = ability.timeline || [];
  showTab('model');
  selectMbPartTab('settings');
  selectMbClipType(`ability:${ability.id}`);
});

document.getElementById('ab-clear-timeline').addEventListener('click', () => {
  const ability = editingAbility();
  if (!ability) return;
  delete ability.timeline;
  if (mbClipType === `ability:${ability.id}`) selectMbClipType('attackClip');
  refreshAbTimelineSummary();
  refreshAbilityLadder();
});

// --- Type-level loot table (General tab) ---
// Same add/remove-a-row shape as the World Editor's per-placement loot list,
// but this one lives on the catalog TYPE, so it applies to every spawn of
// that type — including ones already scattered across a saved map, which
// per-placement authoring can't retroactively reach.
const LOOT_QUEST_PHASE_LABEL = { active: 'quest active', ready: 'quest ready', done: 'quest done' };

/** Fills a loot form's quest picker from the authored catalog. A refresh rather than a one-time populate, because a quest can be authored elsewhere long after this form was last drawn. */
function refreshLootQuestOptions(selectId) {
  const el = document.getElementById(selectId);
  if (!el) return;
  const prev = el.value;
  el.innerHTML = '<option value="">- always drops -</option>'
    + questCatalog.map((q) => `<option value="${q.id}">${q.name} (${q.id})</option>`).join('');
  el.value = prev; // survives a refresh as long as that quest still exists
}

/** The loot form's two quest-gate fields, as the LootTableEntry fragment to spread onto a new entry. An empty quest picker contributes nothing, so an ungated entry keeps exactly the shape it has always had. */
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

function refreshMbLootItemOptions() {
  const ids = [...ITEM_IDS, ...itemCatalog.map((i) => i.id)];
  document.getElementById('mb-loot-item').innerHTML = ids.map((id) => `<option value="${id}">${id}</option>`).join('');
  refreshLootQuestOptions('mb-loot-quest');
}

function refreshMbLootList() {
  const el = document.getElementById('mb-loot-list');
  const table = currentMonsterType?.lootTable || [];
  el.innerHTML = table
    .map((e, i) => `<div><span>${e.itemId} — ${e.dropChance}% (${e.minQty}-${e.maxQty})${lootGateSuffix(e)}</span><button data-remove-mb-loot="${i}">✕</button></div>`)
    .join('') || '<div class="hint">No drops authored.</div>';
}

document.getElementById('mb-loot-add-btn').addEventListener('click', () => {
  const itemId = document.getElementById('mb-loot-item').value;
  const dropChance = parseFloat(document.getElementById('mb-loot-chance').value);
  const minQty = parseInt(document.getElementById('mb-loot-min').value, 10);
  const maxQty = parseInt(document.getElementById('mb-loot-max').value, 10);
  if (!itemId || !Number.isFinite(dropChance) || dropChance < 0 || dropChance > 100) return;
  if (!Number.isInteger(minQty) || minQty < 1 || !Number.isInteger(maxQty) || maxQty < minQty) return;
  if (!currentMonsterType.lootTable) currentMonsterType.lootTable = [];
  currentMonsterType.lootTable.push({ itemId, dropChance, minQty, maxQty, ...readLootQuestGate('mb') });
  refreshMbLootList();
});

document.getElementById('mb-loot-list').addEventListener('click', (e) => {
  const idx = e.target.dataset.removeMbLoot;
  if (idx === undefined) return;
  currentMonsterType.lootTable.splice(Number(idx), 1);
  // An empty array would round-trip through the catalog as a meaningless
  // `"lootTable": []` on every type ever opened — drop the key instead.
  if (!currentMonsterType.lootTable.length) delete currentMonsterType.lootTable;
  refreshMbLootList();
});

// --- General tab + catalog CRUD ---
function loadMonsterTypeIntoModal(mt) {
  refreshLootQuestOptions('mb-loot-quest'); // a quest authored since the last load
  editingMonsterTypeId = mt ? mt.id : null;
  currentMonsterType = mt ? structuredClone(mt) : blankMonsterType();
  document.getElementById('mb-id').value = currentMonsterType.id;
  document.getElementById('mb-id').disabled = !!mt;
  document.getElementById('mb-name').value = currentMonsterType.name;
  document.getElementById('mb-maxHealth').value = currentMonsterType.baseStats.maxHealth;
  document.getElementById('mb-damage').value = currentMonsterType.baseStats.damage;
  document.getElementById('mb-speed').value = currentMonsterType.baseStats.speed;
  document.getElementById('mb-attackCooldownMs').value = currentMonsterType.baseStats.attackCooldownMs;
  document.getElementById('mb-aggroRange').value = currentMonsterType.baseStats.aggroRange;
  document.getElementById('mb-attackRange').value = currentMonsterType.baseStats.attackRange;
  document.getElementById('mb-stance').value = currentMonsterType.stance;
  document.getElementById('mb-weapon-warning').style.display = currentMonsterType.stance !== 'humanoid' ? 'block' : 'none';
  document.getElementById('mb-configured-level').value = currentMonsterType.configuredLevel;
  document.getElementById('mb-status').textContent = '';
  refreshMbLootList();
  closeAbilityEditor(); // an editor left open would be pointed at the previous monster's ability
  refreshAbilityLadder();
  rebuildMbWorkspace();
  mbScrubTimeMs = 0;
  selectMbClipType('walkClip');
  const roles = SLOTS_BY_STANCE[currentMonsterType.stance] || SLOTS_BY_STANCE.humanoid;
  selectMbPartTab(roles[0]);
}

document.getElementById('mb-new-btn').addEventListener('click', () => loadMonsterTypeIntoModal(null));

document.getElementById('mb-id').addEventListener('input', () => { currentMonsterType.id = document.getElementById('mb-id').value.trim(); });
document.getElementById('mb-name').addEventListener('input', () => { currentMonsterType.name = document.getElementById('mb-name').value.trim(); });
[
  ['mb-maxHealth', 'maxHealth'], ['mb-damage', 'damage'], ['mb-speed', 'speed'],
  ['mb-attackCooldownMs', 'attackCooldownMs'], ['mb-aggroRange', 'aggroRange'], ['mb-attackRange', 'attackRange'],
].forEach(([id, key]) => {
  document.getElementById(id).addEventListener('input', () => {
    currentMonsterType.baseStats[key] = parseFloat(document.getElementById(id).value) || 0;
  });
});

async function saveMonsterTypeCatalog() {
  const res = await fetch('/api/monster-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(monsterTypeCatalog),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `server responded ${res.status}`);
  }
}

document.getElementById('mb-save-btn').addEventListener('click', async () => {
  const statusEl = document.getElementById('mb-status');
  if (!currentMonsterType.id) { statusEl.textContent = 'Monster type id is required.'; return; }
  if (!currentMonsterType.name) { statusEl.textContent = 'Monster type name is required.'; return; }
  if (!currentMonsterType.slots.some((s) => s.shapes.length)) { statusEl.textContent = 'Add at least one shape in the Model Editor tab first.'; return; }

  if (editingMonsterTypeId) {
    const idx = monsterTypeCatalog.findIndex((m) => m.id === editingMonsterTypeId);
    if (idx >= 0) monsterTypeCatalog[idx] = currentMonsterType;
  } else {
    if (monsterTypeCatalog.some((m) => m.id === currentMonsterType.id)) {
      statusEl.textContent = `A monster type with id "${currentMonsterType.id}" already exists — pick it from the catalog below to edit instead.`;
      return;
    }
    monsterTypeCatalog.push(currentMonsterType);
  }

  try {
    await saveMonsterTypeCatalog();
    editingMonsterTypeId = currentMonsterType.id;
    document.getElementById('mb-id').disabled = true;
    // Non-blocking connectivity warning: a body part floating away from the
    // torso is the single most common authoring mistake (it looks fine in
    // the part tab you're editing, wrong only once assembled). Saving is
    // still allowed — a detached part may be deliberate — but you're told.
    const detached = findDetachedSlots(currentMonsterType);
    statusEl.textContent = detached.length
      ? `Saved ✓ — but ${detached.length} part(s) float detached from the torso: ${detached.map((d) => d.role).join(', ')}. Move their Slot anchor onto the body.`
      : 'Saved ✓';
    refreshMbCatalogList();
  } catch (err) {
    statusEl.textContent = `Save failed: ${err.message}`;
  }
});

function refreshMbCatalogList() {
  document.getElementById('mb-catalog-count').textContent = monsterTypeCatalog.length;
  document.getElementById('mb-catalog-list').innerHTML = monsterTypeCatalog
    .map((mt) => `<div><span>${mt.name} <span class="hint">(${mt.stance})</span></span><button data-edit-mb="${mt.id}">✎</button><button data-delete-mb="${mt.id}">✕</button></div>`)
    .join('');
}

document.getElementById('mb-catalog-list').addEventListener('click', async (e) => {
  const editId = e.target.dataset.editMb;
  const deleteId = e.target.dataset.deleteMb;
  if (editId !== undefined) {
    const mt = monsterTypeCatalog.find((m) => m.id === editId);
    if (mt) loadMonsterTypeIntoModal(mt);
    return;
  }
  if (deleteId !== undefined) {
    const removed = monsterTypeCatalog;
    monsterTypeCatalog = monsterTypeCatalog.filter((m) => m.id !== deleteId);
    try {
      await saveMonsterTypeCatalog();
      refreshMbCatalogList();
      if (editingMonsterTypeId === deleteId) loadMonsterTypeIntoModal(null);
    } catch (err) {
      monsterTypeCatalog = removed;
      document.getElementById('mb-status').textContent = `Delete failed: ${err.message}`;
    }
  }
});

// --- Boot ---
renderMbBodyPresetGrid(); // static built-in data, render once — cached thumbnails after that

async function boot() {
  const [monsterTypes, items, quests, vfx] = await Promise.all([
    fetch('/api/monster-types').then((r) => r.json()).catch(() => []),
    fetch('/api/items').then((r) => r.json()).catch(() => []),
    fetch('/api/quests').then((r) => r.json()).catch(() => []),
    fetch('/api/vfx').then((r) => r.json()).catch(() => []),
  ]);
  monsterTypeCatalog = monsterTypes;
  itemCatalog = items;
  questCatalog = quests;
  vfxCatalog = Array.isArray(vfx) ? vfx : [];
  refreshMbCatalogList();
  refreshMbLootItemOptions();
  refreshAbVfxPickers();
  loadMonsterTypeIntoModal(monsterTypeCatalog[0] || null);
}

// Dev affordance: inspect the RENDERED workspace from the console, same as
// the Character/Building Builders' equivalent hooks.
window.__monsterBuilder = {
  scene: mbScene, camera: mbCamera, gizmo,
  get mesh() { return mbMonsterGroup; },
  get rig() { return mbRig; },
  get currentMonsterType() { return currentMonsterType; },
  get catalog() { return monsterTypeCatalog; },
};

boot();
animateMbWorkspace();
