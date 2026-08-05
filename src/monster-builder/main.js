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
import { createRenderer, createScene } from '../render/scene.js';
import { buildShapeMesh } from '../generators/custom.js';
import { buildMonsterRig, resolveGaitTable } from '../generators/monsterRig.js';
import { findDetachedSlots } from '../generators/monsterConnectivity.js';
import { applyIdlePose, applyGaitPose, applyAttackPose, applyKeyframeClip, defaultAnimationForStance } from '../generators/rig.js';
import { ABILITY_KINDS, ABILITY_LEVEL_LADDER } from '../sim/monsterTypeDefs.js';
import { PART_PRESETS, BODY_PRESETS, presetCategoryForRole } from '../generators/monsterPresets.js';
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
const ATTACK_POSE_BY_STANCE = {
  humanoid: { part: 'armR', axis: 'x', amplitude: 1.1 },
  quadruped: { part: 'legFrontR', axis: 'x', amplitude: 0.9 },
};

function blankMonsterType() {
  return {
    id: '', name: '', stance: 'humanoid', slots: [], previewAnimation: 'idle',
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
const mbRenderer = createRenderer(mbCanvas, { shadows: false });
// createRenderer's initial setSize(window.innerWidth, window.innerHeight)
// call sets an INLINE style="width:...px;height:...px" on the canvas as a
// side effect (Three.js's default updateStyle=true) — inline style beats
// the external #mb-workspace-canvas{width:100%} rule regardless of
// selector specificity. Clearing it here hands layout sizing back to CSS
// entirely; resizeMbCanvas() below always calls setSize with
// updateStyle=false so this stays cleared.
mbCanvas.style.width = '';
mbCanvas.style.height = '';
const mbScene = createScene();
const mbCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
mbCamera.position.set(0.9, 1.6, 4.5);
const mbControls = new OrbitControls(mbCamera, mbCanvas);
mbControls.enableDamping = true;
mbControls.target.set(0, 0.7, 0);
mbScene.add(new THREE.GridHelper(4, 16, 0x3f88c5, 0x223344));
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

/** Point the gizmo at the selected shape (or hide it when nothing is selected). */
function attachGizmo() {
  if (selectedMbShape) gizmo.attach(selectedMbShape.mesh);
  else gizmo.detach();
}

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'g' || e.key === 'G') gizmo.setMode('translate');
  else if (e.key === 'r' || e.key === 'R') gizmo.setMode('rotate');
  else if (e.key === 's' || e.key === 'S') gizmo.setMode('scale');
  else if (e.key === 'Escape') selectMbShape(null);
});

function resizeMbCanvas() {
  const rect = mbCanvas.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  mbCamera.aspect = rect.width / rect.height;
  mbCamera.updateProjectionMatrix();
  mbRenderer.setSize(rect.width, rect.height, false);
}
window.addEventListener('resize', resizeMbCanvas);

let mbAnimPhase = 0;
let mbClipElapsedMs = 0; // separate accumulator for the *-clip preview modes, which run on milliseconds not radians
let mbLastFrameT = performance.now();
/** Which animation.<key> a #mb-preview-anim clip option previews. */
const KF_PREVIEW_CLIP_KEY = { 'walk-clip': 'walkClip', 'idle-clip': 'idleClip', 'attack-clip': 'attackClip' };
function animateMbWorkspace() {
  requestAnimationFrame(animateMbWorkspace);
  const now = performance.now();
  const dt = Math.min(0.1, (now - mbLastFrameT) / 1000);
  mbLastFrameT = now;
  resizeMbCanvas();
  mbControls.update();
  if (mbRig && Object.keys(mbRig).length) {
    const anim = document.getElementById('mb-preview-anim').value;
    const clipKey = KF_PREVIEW_CLIP_KEY[anim];
    if (anim === 'walk') {
      mbAnimPhase += dt * 8;
      // Resolved the same way the live game resolves it, so the preview and
      // in-world monster can't drift apart.
      applyGaitPose(mbRig, resolveGaitTable(currentMonsterType), mbAnimPhase, 1);
    } else if (anim === 'attack') {
      mbAnimPhase += dt * 2;
      const t01 = (Math.sin(mbAnimPhase) + 1) / 2;
      applyAttackPose(mbRig, ATTACK_POSE_BY_STANCE[currentMonsterType.stance] || ATTACK_POSE_BY_STANCE.humanoid, t01);
    } else if (clipKey) {
      applyIdlePose(mbRig);
      const clip = currentMonsterType.animation?.[clipKey];
      if (clip) {
        mbClipElapsedMs += dt * 1000;
        // Always loops in preview regardless of the clip's own `loop` flag
        // (an attack clip authored loop:false for real gameplay still plays
        // on repeat here) — seeing the whole clip cycle is what's useful
        // while posing it, a single play-once-then-freeze isn't.
        applyKeyframeClip(mbRig, { ...clip, loop: true }, mbClipElapsedMs);
      }
    } else {
      applyIdlePose(mbRig);
    }
  }
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
  refreshAnimRows(); // the animatable-part list follows whichever slots exist
  refreshKfClipEditor(); // ditto for the keyframe track-part dropdown
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
thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
const thumbSun = new THREE.DirectionalLight(0xffffff, 0.8);
thumbSun.position.set(2, 3, 2);
thumbScene.add(thumbSun);
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
  document.getElementById('mb-stance').value = preset.stance;
  document.getElementById('mb-weapon-warning').style.display = preset.stance !== 'humanoid' ? 'block' : 'none';
  rebuildMbWorkspace();
  const roles = SLOTS_BY_STANCE[preset.stance] || SLOTS_BY_STANCE.humanoid;
  selectMbPartTab(roles[0]);
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
  mesh.material.opacity = ref.opacity;
  mesh.material.transparent = ref.opacity < 1;
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
document.getElementById('mb-preview-anim').addEventListener('change', () => {
  currentMonsterType.previewAnimation = document.getElementById('mb-preview-anim').value;
});

// --- Walk animation editor (Settings sub-tab) ---
// Every non-torso slot is a real rig pivot, so any of them can be given a
// swing. Tails/heads/wings were always animatable — nothing ever referenced
// them, which is why they sat still.

/** Non-torso slot roles this monster actually has, in the part-tab order. */
function animatableRoles() {
  const order = SLOTS_BY_STANCE[currentMonsterType.stance] || SLOTS_BY_STANCE.humanoid;
  const present = new Set(currentMonsterType.slots.filter((s) => s.role !== 'torso').map((s) => s.role));
  return order.filter((r) => present.has(r));
}

function animWalk() {
  if (!currentMonsterType.animation) currentMonsterType.animation = {};
  if (!Array.isArray(currentMonsterType.animation.walk)) currentMonsterType.animation.walk = [];
  return currentMonsterType.animation.walk;
}

/** What a part is doing today: its authored entry, else the stance default for that part, else nothing. */
function animEntryFor(part) {
  const authored = currentMonsterType.animation?.walk?.find((e) => e.part === part);
  if (authored) return authored;
  const fallback = defaultAnimationForStance(currentMonsterType.stance).find((e) => e.part === part);
  return fallback || { part, axis: 'x', amplitudeDeg: 0, phaseDeg: 0 };
}

function refreshAnimRows() {
  const el = document.getElementById('mb-anim-rows');
  if (!el) return;
  const roles = animatableRoles();
  if (!roles.length) {
    el.innerHTML = '<p class="hint">No animatable body parts yet — add a slot other than the torso.</p>';
    return;
  }
  el.innerHTML =
    '<div class="anim-head"><span>Part</span><span>Axis</span><span>Amplitude</span><span>Phase</span></div>' +
    roles
      .map((role) => {
        const e = animEntryFor(role);
        const opt = (v) => `<option value="${v}" ${e.axis === v ? 'selected' : ''}>${v.toUpperCase()}</option>`;
        return `<div class="anim-row">
          <span class="anim-part">${role}</span>
          <select data-anim-axis="${role}">${opt('x')}${opt('y')}${opt('z')}</select>
          <input type="number" data-anim-amp="${role}" value="${e.amplitudeDeg}" step="5" /><span class="anim-unit">°</span>
          <input type="number" data-anim-phase="${role}" value="${e.phaseDeg}" step="15" /><span class="anim-unit">°</span>
        </div>`;
      })
      .join('');
}

/** Write one part's swing into the type's own table (creating it on first edit, so untouched types keep using the stance default). */
function setAnimEntry(part, patch) {
  const walk = animWalk();
  // First edit of a type that had no table: seed from what's on screen now,
  // so tweaking one leg doesn't silently zero out every other part.
  if (!walk.length) {
    for (const role of animatableRoles()) walk.push({ ...animEntryFor(role) });
  }
  let entry = walk.find((e) => e.part === part);
  if (!entry) { entry = { part, axis: 'x', amplitudeDeg: 0, phaseDeg: 0 }; walk.push(entry); }
  Object.assign(entry, patch);
}

document.getElementById('mb-anim-rows').addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.animAxis) setAnimEntry(t.dataset.animAxis, { axis: t.value });
  else if (t.dataset.animAmp) setAnimEntry(t.dataset.animAmp, { amplitudeDeg: parseFloat(t.value) || 0 });
  else if (t.dataset.animPhase) setAnimEntry(t.dataset.animPhase, { phaseDeg: parseFloat(t.value) || 0 });
  else return;
  // The preview reads resolveGaitTable() every frame, so it updates itself.
});

document.getElementById('mb-anim-reset').addEventListener('click', () => {
  delete currentMonsterType.animation; // back to the generic stance gait
  applyIdlePose(mbRig); // clear whatever pose the old table left behind
  refreshAnimRows();
});

// --- Keyframe animation editor (Settings sub-tab) ---
// Hand-authored position/rotation/scale clips, independent from the sine
// gait above — see src/generators/rig.js's applyKeyframeClip. Lives at
// currentMonsterType.animation.{walkClip,idleClip,attackClip}, each a
// {durationMs, loop, tracks: [{part, keyframes: [{t, position?, rotation?, scale?}]}]}.
let mbKeyframeClipType = 'walkClip';
let mbSelectedTrackPart = null;
let mbSelectedKeyframeIndex = null;
const KF_CLIP_DEFAULT_LOOP = { walkClip: true, idleClip: true, attackClip: false };
const KF_CLIP_LABELS = { walkClip: 'walk', idleClip: 'idle', attackClip: 'attack' };

function kfClip() { return currentMonsterType.animation?.[mbKeyframeClipType] || null; }

function kfSelectClipType(type) {
  mbKeyframeClipType = type;
  mbSelectedTrackPart = null;
  mbSelectedKeyframeIndex = null;
  document.getElementById('kf-clip-walk').classList.toggle('active', type === 'walkClip');
  document.getElementById('kf-clip-idle').classList.toggle('active', type === 'idleClip');
  document.getElementById('kf-clip-attack').classList.toggle('active', type === 'attackClip');
  refreshKfClipEditor();
}
document.getElementById('kf-clip-walk').addEventListener('click', () => kfSelectClipType('walkClip'));
document.getElementById('kf-clip-idle').addEventListener('click', () => kfSelectClipType('idleClip'));
document.getElementById('kf-clip-attack').addEventListener('click', () => kfSelectClipType('attackClip'));

document.getElementById('kf-clip-create').addEventListener('click', () => {
  if (!currentMonsterType.animation) currentMonsterType.animation = {};
  currentMonsterType.animation[mbKeyframeClipType] = {
    durationMs: 1000,
    loop: KF_CLIP_DEFAULT_LOOP[mbKeyframeClipType],
    tracks: [],
  };
  refreshKfClipEditor();
});

document.getElementById('kf-clip-clear').addEventListener('click', () => {
  if (currentMonsterType.animation) delete currentMonsterType.animation[mbKeyframeClipType];
  mbSelectedTrackPart = null;
  mbSelectedKeyframeIndex = null;
  applyIdlePose(mbRig); // clear whatever pose the deleted clip left behind
  refreshKfClipEditor();
});

document.getElementById('kf-duration').addEventListener('input', () => {
  const clip = kfClip();
  if (clip) clip.durationMs = Math.max(50, parseFloat(document.getElementById('kf-duration').value) || 1000);
});
document.getElementById('kf-loop').addEventListener('change', () => {
  const clip = kfClip();
  if (clip) clip.loop = document.getElementById('kf-loop').checked;
});

function refreshKfClipEditor() {
  const clip = kfClip();
  document.getElementById('kf-clip-empty-label').textContent = KF_CLIP_LABELS[mbKeyframeClipType];
  document.getElementById('kf-clip-empty').style.display = clip ? 'none' : 'block';
  document.getElementById('kf-clip-create').style.display = clip ? 'none' : 'block';
  document.getElementById('kf-clip-editor').style.display = clip ? 'block' : 'none';
  if (!clip) return;
  document.getElementById('kf-duration').value = clip.durationMs;
  document.getElementById('kf-loop').checked = !!clip.loop;
  refreshKfTrackPartOptions();
  refreshKfTrackList();
  refreshKfKeyframeSection();
}

function refreshKfTrackPartOptions() {
  const sel = document.getElementById('kf-add-track-part');
  const clip = kfClip();
  const used = new Set((clip?.tracks || []).map((t) => t.part));
  const available = animatableRoles().filter((r) => !used.has(r));
  sel.innerHTML = available.length
    ? available.map((r) => `<option value="${r}">${r}</option>`).join('')
    : '<option value="">(no parts left)</option>';
  sel.disabled = !available.length;
  document.getElementById('kf-add-track').disabled = !available.length;
}

document.getElementById('kf-add-track').addEventListener('click', () => {
  const clip = kfClip();
  const part = document.getElementById('kf-add-track-part').value;
  if (!clip || !part) return;
  clip.tracks.push({
    part,
    keyframes: [
      { t: 0, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      { t: 1, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    ],
  });
  mbSelectedTrackPart = part;
  mbSelectedKeyframeIndex = 0;
  refreshKfClipEditor();
});

function refreshKfTrackList() {
  const el = document.getElementById('kf-track-list');
  const clip = kfClip();
  const tracks = clip?.tracks || [];
  if (!tracks.length) {
    el.innerHTML = '<p class="hint">No tracks yet — add one above.</p>';
    return;
  }
  el.innerHTML = tracks
    .map(
      (t) => `<div class="anim-row" data-kf-track="${t.part}" style="cursor:pointer; ${mbSelectedTrackPart === t.part ? 'border-color:#3f88c5;' : ''}">
        <span style="flex:1">${t.part} <span class="hint">(${t.keyframes.length} keyframes)</span></span>
        <button data-kf-delete-track="${t.part}" style="flex:0 0 auto;">✕</button>
      </div>`
    )
    .join('');
}

document.getElementById('kf-track-list').addEventListener('click', (e) => {
  const del = e.target.dataset.kfDeleteTrack;
  if (del !== undefined) {
    const clip = kfClip();
    if (clip) clip.tracks = clip.tracks.filter((t) => t.part !== del);
    if (mbSelectedTrackPart === del) { mbSelectedTrackPart = null; mbSelectedKeyframeIndex = null; }
    refreshKfTrackPartOptions();
    refreshKfTrackList();
    refreshKfKeyframeSection();
    return;
  }
  const row = e.target.closest('[data-kf-track]');
  if (row) {
    mbSelectedTrackPart = row.dataset.kfTrack;
    mbSelectedKeyframeIndex = null;
    refreshKfTrackList();
    refreshKfKeyframeSection();
  }
});

function selectedKfTrack() {
  const clip = kfClip();
  return clip?.tracks.find((t) => t.part === mbSelectedTrackPart) || null;
}

function refreshKfKeyframeSection() {
  const sectionEl = document.getElementById('kf-keyframe-section');
  const track = selectedKfTrack();
  sectionEl.style.display = track ? 'block' : 'none';
  if (!track) return;
  document.getElementById('kf-track-part-label').textContent = track.part;
  const listEl = document.getElementById('kf-keyframe-list');
  listEl.innerHTML = track.keyframes
    .map((kf, i) => {
      const fixed = i === 0 || i === track.keyframes.length - 1;
      return `<div class="anim-row" data-kf-index="${i}" style="cursor:pointer; ${mbSelectedKeyframeIndex === i ? 'border-color:#3f88c5;' : ''}">
        <span style="flex:1">t = ${kf.t.toFixed(2)}${fixed ? ' <span class="hint">(fixed)</span>' : ''}</span>
        ${fixed ? '' : `<button data-kf-delete-index="${i}" style="flex:0 0 auto;">✕</button>`}
      </div>`;
    })
    .join('');
  refreshKfKeyframeControls();
}

document.getElementById('kf-keyframe-list').addEventListener('click', (e) => {
  const delIdx = e.target.dataset.kfDeleteIndex;
  if (delIdx !== undefined) {
    const track = selectedKfTrack();
    if (track) track.keyframes.splice(parseInt(delIdx, 10), 1);
    mbSelectedKeyframeIndex = null;
    refreshKfKeyframeSection();
    return;
  }
  const row = e.target.closest('[data-kf-index]');
  if (row) {
    mbSelectedKeyframeIndex = parseInt(row.dataset.kfIndex, 10);
    refreshKfKeyframeSection();
  }
});

document.getElementById('kf-add-keyframe').addEventListener('click', () => {
  const track = selectedKfTrack();
  if (!track) return;
  // Insert at the midpoint of the largest gap between consecutive
  // keyframes — a reasonable default landing spot with no author input,
  // matching "a 3rd/4th point, e.g. a jump's crouch/launch/land."
  let gapStart = 0;
  let bestGap = -1;
  for (let i = 0; i < track.keyframes.length - 1; i++) {
    const gap = track.keyframes[i + 1].t - track.keyframes[i].t;
    if (gap > bestGap) { bestGap = gap; gapStart = i; }
  }
  const t = (track.keyframes[gapStart].t + track.keyframes[gapStart + 1].t) / 2;
  const kf = { t, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } };
  track.keyframes.splice(gapStart + 1, 0, kf);
  mbSelectedKeyframeIndex = gapStart + 1;
  refreshKfKeyframeSection();
});

function selectedKf() {
  const track = selectedKfTrack();
  return track && mbSelectedKeyframeIndex != null ? track.keyframes[mbSelectedKeyframeIndex] : null;
}

function refreshKfKeyframeControls() {
  const track = selectedKfTrack();
  const kf = selectedKf();
  const controlsEl = document.getElementById('kf-keyframe-controls');
  controlsEl.style.display = kf ? 'block' : 'none';
  if (!kf || !track) return;
  const isEndpoint = mbSelectedKeyframeIndex === 0 || mbSelectedKeyframeIndex === track.keyframes.length - 1;
  const tEl = document.getElementById('kf-t');
  tEl.value = kf.t;
  tEl.disabled = isEndpoint;
  const p = kf.position || { x: 0, y: 0, z: 0 };
  const r = kf.rotation || { x: 0, y: 0, z: 0 };
  const s = kf.scale || { x: 1, y: 1, z: 1 };
  document.getElementById('kf-pos-x').value = p.x;
  document.getElementById('kf-pos-y').value = p.y;
  document.getElementById('kf-pos-z').value = p.z;
  document.getElementById('kf-rot-x').value = r.x;
  document.getElementById('kf-rot-y').value = r.y;
  document.getElementById('kf-rot-z').value = r.z;
  document.getElementById('kf-scale-x').value = s.x;
  document.getElementById('kf-scale-y').value = s.y;
  document.getElementById('kf-scale-z').value = s.z;
  document.getElementById('kf-delete-keyframe').disabled = isEndpoint;
}

document.getElementById('kf-t').addEventListener('input', () => {
  const track = selectedKfTrack();
  const kf = selectedKf();
  if (!track || !kf || mbSelectedKeyframeIndex === 0 || mbSelectedKeyframeIndex === track.keyframes.length - 1) return;
  const prev = track.keyframes[mbSelectedKeyframeIndex - 1].t;
  const next = track.keyframes[mbSelectedKeyframeIndex + 1].t;
  const raw = parseFloat(document.getElementById('kf-t').value);
  if (Number.isNaN(raw)) return;
  // Clamped strictly between its neighbors so keyframes on a track can
  // never cross order — applyKeyframeClip assumes ascending t.
  kf.t = Math.min(next - 0.001, Math.max(prev + 0.001, raw));
});

[
  ['kf-pos-x', 'position', 'x'], ['kf-pos-y', 'position', 'y'], ['kf-pos-z', 'position', 'z'],
  ['kf-rot-x', 'rotation', 'x'], ['kf-rot-y', 'rotation', 'y'], ['kf-rot-z', 'rotation', 'z'],
  ['kf-scale-x', 'scale', 'x'], ['kf-scale-y', 'scale', 'y'], ['kf-scale-z', 'scale', 'z'],
].forEach(([id, group, axis]) => {
  document.getElementById(id).addEventListener('input', () => {
    const kf = selectedKf();
    if (!kf) return;
    if (!kf[group]) kf[group] = group === 'scale' ? { x: 1, y: 1, z: 1 } : { x: 0, y: 0, z: 0 };
    const fallback = group === 'scale' ? 1 : 0;
    kf[group][axis] = parseFloat(document.getElementById(id).value);
    if (Number.isNaN(kf[group][axis])) kf[group][axis] = fallback;
  });
});

document.getElementById('kf-delete-keyframe').addEventListener('click', () => {
  const track = selectedKfTrack();
  if (!track || mbSelectedKeyframeIndex == null) return;
  if (mbSelectedKeyframeIndex === 0 || mbSelectedKeyframeIndex === track.keyframes.length - 1) return;
  track.keyframes.splice(mbSelectedKeyframeIndex, 1);
  mbSelectedKeyframeIndex = null;
  refreshKfKeyframeSection();
});

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
      return `<div class="ability-ladder-row"><span class="level-badge">Lv${level}</span><span style="flex:1">${ability.name} <span class="hint">(${ability.kind}, pwr ${ability.power})</span></span><button data-edit-ability="${level}">✎</button><button data-delete-ability="${level}">✕</button></div>`;
    }
    return `<div class="ability-ladder-row" style="opacity:${locked ? 0.4 : 1}"><span class="level-badge">Lv${level}</span><span style="flex:1" class="hint">${locked ? 'Locked (raise configured level)' : 'Empty'}</span><button data-create-ability="${level}" ${locked ? 'disabled' : ''}>+ Create</button></div>`;
  }).join('');
}

document.getElementById('mb-ability-ladder').addEventListener('click', (e) => {
  const createLevel = e.target.dataset.createAbility;
  const editLevel = e.target.dataset.editAbility;
  const deleteLevel = e.target.dataset.deleteAbility;
  if (createLevel !== undefined || editLevel !== undefined) {
    const level = parseInt(createLevel ?? editLevel, 10);
    openAbilityForm(level);
  } else if (deleteLevel !== undefined) {
    const level = parseInt(deleteLevel, 10);
    currentMonsterType.abilitySlots = currentMonsterType.abilitySlots.filter((a) => a.unlockLevel !== level);
    refreshAbilityLadder();
  }
});

/** A tiny inline prompt-based ability editor — simplest possible form for an MVP-scoped ability-authoring flow. */
function openAbilityForm(level) {
  const existing = currentMonsterType.abilitySlots.find((a) => a.unlockLevel === level);
  const name = window.prompt('Ability name?', existing?.name || `Attack Lv${level}`);
  if (!name) return;
  const kind = window.prompt(`Kind (${ABILITY_KINDS.join('/')})?`, existing?.kind || 'melee');
  if (!ABILITY_KINDS.includes(kind)) { alert(`Kind must be one of: ${ABILITY_KINDS.join(', ')}`); return; }
  const power = parseFloat(window.prompt('Power (damage)?', existing?.power ?? 10)) || 10;
  const cooldownMs = parseFloat(window.prompt('Cooldown (ms)?', existing?.cooldownMs ?? 2000)) || 2000;
  const ability = {
    id: existing?.id || `ability-${Date.now()}`,
    name, kind, power, unlockLevel: level,
    cooldownMs,
    windupMs: existing?.windupMs ?? 150,
    effectMs: existing?.effectMs ?? 150,
    recoveryMs: existing?.recoveryMs ?? 200,
    description: existing?.description || '',
  };
  const idx = currentMonsterType.abilitySlots.findIndex((a) => a.unlockLevel === level);
  if (idx >= 0) currentMonsterType.abilitySlots[idx] = ability;
  else currentMonsterType.abilitySlots.push(ability);
  refreshAbilityLadder();
}

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
  document.getElementById('mb-preview-anim').value = currentMonsterType.previewAnimation || 'idle';
  document.getElementById('mb-weapon-warning').style.display = currentMonsterType.stance !== 'humanoid' ? 'block' : 'none';
  document.getElementById('mb-configured-level').value = currentMonsterType.configuredLevel;
  document.getElementById('mb-status').textContent = '';
  refreshMbLootList();
  refreshAbilityLadder();
  kfSelectClipType('walkClip');
  rebuildMbWorkspace();
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
  const [monsterTypes, items, quests] = await Promise.all([
    fetch('/api/monster-types').then((r) => r.json()).catch(() => []),
    fetch('/api/items').then((r) => r.json()).catch(() => []),
    fetch('/api/quests').then((r) => r.json()).catch(() => []),
  ]);
  monsterTypeCatalog = monsterTypes;
  itemCatalog = items;
  questCatalog = quests;
  refreshMbCatalogList();
  refreshMbLootItemOptions();
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
