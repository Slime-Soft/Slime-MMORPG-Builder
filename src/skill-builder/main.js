// src/skill-builder/main.js
// Skill Builder — authors skills/skill-defs.json, served at /skills.html.
// Mirrors the Character & NPC Builder's pattern (own renderer/scene/camera,
// fetch/POST its own /api/* endpoint) rather than the World Editor's in-scene
// modal pattern, since a skill preview needs its own live-playback canvas, not
// something anchored to a placed world entity.
//
// Playing back a skill reuses the EXACT SAME animation code the live game
// runs (triggerAbilityAnimation/updateAbilityAnimations from render/scene.js)
// against a fake AbilityDef built from the SkillDef being edited — so what you
// see in Play is what a player actually sees, not a separate reimplementation.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { buildPlayerMesh, triggerAbilityAnimation, updateAbilityAnimations, applyPoseTimeline, setCharacterTypes } from '../render/scene.js';
import { createVfxSystem, PRESET_IDS, registerCustomVfxDefs } from '../render/vfx/index.js';
import { resolveAnchor } from '../render/vfx/anchors.js';
import { applyWeaponTuning } from '../sim/weaponTypes.js';
import {
  TARGETING_MODES, TARGETING_SHAPES, EFFECT_TYPES, DAMAGE_TYPES, BUFF_STATS, VFX_ANCHORS, RIG_PARTS,
} from '../sim/skillDefs.js';
import { VFX_SHAPES, VFX_PARAM_SPECS, VFX_SHAPE_TEXTURES, defaultVfxParams, parseVfxDefs } from '../sim/vfxDefs.js';
import { CLASSES, CLASS_IDS } from '../sim/classes.js';

// --- State -------------------------------------------------------------------
let catalog = [];
let selected = null;
let vfxCatalog = []; // Custom VFX Library — a separate, independent catalog from the skill list above
let selectedVfx = null;
// Which class's body/weapon the preview mesh uses — LOCAL to this editing
// session, never saved onto the skill. classId/key were deliberately removed
// from SkillDef itself (class->skill assignment lives in the Character &
// NPC Builder's Class Skills panel instead), which left every skill's
// preview silently defaulting to Guardian with no way to pick a different
// body — this is that missing picker.
let previewClassId = 'guardian';
let mesh = null;
let enemyDummy = null;
let allyDummy = null;
let activeDummyKind = 'enemy';
let rotationY = 0.6;
let camDist = 5;

// Direct-manipulation posing/anchoring state — see attachPoseGizmo/attachAnchorGizmo.
let scrubTimeMs = 0;
let selectedPart = null;   // rig part name currently under the pose gizmo
let selectedEvent = null;  // timeline event currently under the anchor gizmo
let anchorMarker = null;   // the draggable marker mesh for a cast/impact anchorOffset
let anchorBase = null;     // { isObject3D, base? } — how to convert anchorMarker's position back to a local offset

// --- Scene -------------------------------------------------------------------
const canvas = document.getElementById('preview-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2029);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.15));
const key = new THREE.DirectionalLight(0xfff2d0, 1.05);
key.position.set(3, 6, 4);
scene.add(key);
scene.add(new THREE.GridHelper(8, 16, 0x3a4152, 0x2a303d));

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const vfxSystem = createVfxSystem(scene);

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => { resize(); renderScrubber(); });

// --- Direct-manipulation gizmo (pose a limb, or drag a VFX anchor marker) ---
// Same TransformControls pattern as the Character & NPC Builder
// (src/character-builder/main.js) — one gizmo, reattached to whatever's
// currently selected (a rig pivot for posing, or anchorMarker for VFX
// placement). `gizmoDragging` suppresses the orbit-camera drag below so
// grabbing a gizmo handle doesn't also spin the camera.
let gizmo = new TransformControls(camera, canvas);
gizmo.setSize(0.7);
let gizmoDragging = false;
gizmo.addEventListener('dragging-changed', (e) => { gizmoDragging = e.value; });
scene.add(gizmo);

// --- Camera controls + click-to-select (body part / test dummy) ------------
let dragging = false;
let lastX = 0;
let pointerDownPos = null;
canvas.addEventListener('pointerdown', (e) => {
  if (gizmoDragging) return;
  dragging = true;
  lastX = e.clientX;
  pointerDownPos = { x: e.clientX, y: e.clientY };
});
window.addEventListener('pointerup', (e) => {
  dragging = false;
  const downPos = pointerDownPos;
  pointerDownPos = null;
  if (gizmoDragging || !downPos) return;
  if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) return; // that was a camera-orbit drag
  handleCanvasClick(e);
});
window.addEventListener('pointermove', (e) => {
  if (!dragging || gizmoDragging) return;
  rotationY += (e.clientX - lastX) * 0.01;
  lastX = e.clientX;
  if (mesh) mesh.rotation.y = rotationY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = Math.max(2, Math.min(12, camDist + Math.sign(e.deltaY) * 0.3));
}, { passive: false });

const clickRaycaster = new THREE.Raycaster();
const clickNdc = new THREE.Vector2();
/** Click a body part to pose it, or a test dummy to aim Play at it. */
function handleCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  clickNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  clickNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  clickRaycaster.setFromCamera(clickNdc, camera);

  const dummies = [enemyDummy, allyDummy].filter(Boolean);
  const dummyHits = dummies.length ? clickRaycaster.intersectObjects(dummies, true) : [];
  if (dummyHits.length) {
    setActiveDummy(dummyHits[0].object === enemyDummy ? 'enemy' : 'ally');
    return;
  }

  if (!mesh) return;
  const hits = clickRaycaster.intersectObject(mesh, true);
  if (!hits.length) return;
  let node = hits[0].object;
  while (node && !node.userData.slotRole) node = node.parent;
  const slotRole = node?.userData.slotRole;
  if (slotRole && mesh.userData.rig?.[slotRole]) {
    selectedPart = slotRole;
    selectedEvent = null;
    attachPoseGizmo();
    updateSelectedPartLabel();
    renderScrubber();
  }
}

function attachPoseGizmo() {
  if (!selectedPart || !mesh?.userData.rig?.[selectedPart]) return;
  gizmo.setMode('rotate');
  gizmo.attach(mesh.userData.rig[selectedPart]);
}

function updateSelectedPartLabel() {
  const label = document.getElementById('selected-part-label');
  if (label) label.textContent = selectedPart ? ` (${selectedPart})` : '';
}

function setActiveDummy(kind) {
  activeDummyKind = kind;
  document.getElementById('select-enemy-dummy').classList.toggle('dummy-active', kind === 'enemy');
  document.getElementById('select-ally-dummy').classList.toggle('dummy-active', kind === 'ally');
}

function activeDummyPosition() {
  return activeDummyKind === 'enemy' ? enemyDummy?.position : allyDummy?.position;
}

// --- DOM handles ---------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const skillListEl = $('skill-list');
const previewClassSel = $('preview-class-sel');
const nameEl = $('name-input');
const descEl = $('desc-input');
const iconEl = $('icon-input');
const iconPreviewEl = $('icon-preview');
const iconFileEl = $('icon-file');
const soundFileEl = $('sound-file');
const soundPlayBtn = $('sound-play-btn');
const soundNameEl = $('sound-name');
const costEl = $('cost-input');
const cooldownEl = $('cooldown-input');
const castMsEl = $('castms-input');
const canMoveEl = $('canmove-input');
const modeChecksEl = $('mode-checks');
const shapeSel = $('shape-sel');
const rangeEl = $('range-input');
const shapeExtraEl = $('shape-extra-fields');
const effectsListEl = $('effects-list');
const levelUpgradesListEl = $('level-upgrades-list');
const windupEl = $('windup-input');
const effectMsEl = $('effect-input');
const recoveryEl = $('recovery-input');
const castVfxSel = $('cast-vfx-sel');
const castAnchorSel = $('cast-anchor-sel');
const travelVfxSel = $('travel-vfx-sel');
const impactVfxSel = $('impact-vfx-sel');
const impactAnchorSel = $('impact-anchor-sel');
const vfxListEl = $('vfx-list');
const vfxNameEl = $('vfx-name-input');
const vfxShapeSel = $('vfx-shape-sel');
const vfxColorAEl = $('vfx-colorA-input');
const vfxColorBEl = $('vfx-colorB-input');
const vfxParamsFieldsEl = $('vfx-params-fields');
const timelineListEl = $('timeline-list');
const scrubberTimeEl = $('scrubber-time');
const scrubberTrackEl = $('scrubber-track');
const scrubberEventsEl = $('scrubber-events');
const scrubberPlayheadEl = $('scrubber-playhead');
const statusEl = $('status');

function say(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : '';
}

function fillSelect(sel, ids, { includeNone = false } = {}) {
  sel.innerHTML = '';
  if (includeNone) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '(none)';
    sel.appendChild(o);
  }
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
}

fillSelect(shapeSel, TARGETING_SHAPES);
fillSelect(castAnchorSel, VFX_ANCHORS);
fillSelect(impactAnchorSel, VFX_ANCHORS);
fillSelect(vfxShapeSel, VFX_SHAPES);

previewClassSel.innerHTML = '';
for (const id of CLASS_IDS) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = CLASSES[id].name;
  if (id === previewClassId) o.selected = true;
  previewClassSel.appendChild(o);
}
previewClassSel.addEventListener('change', () => {
  previewClassId = previewClassSel.value;
  rebuildPreview();
});

/** Every VFX id the Cast/Travel/Impact pickers (and a Timeline VFX event) should offer — built-ins plus whatever's in the Custom VFX Library right now. */
function allVfxIds() {
  return [...PRESET_IDS, ...vfxCatalog.map((v) => v.id)];
}

/** Rebuilds the three simple-mode VFX pickers with the current allVfxIds(), preserving whatever was already selected (the currently-edited skill's vfx.*Id) if it still exists. */
function refreshVfxPickers() {
  const ids = allVfxIds();
  const keep = [castVfxSel.value, travelVfxSel.value, impactVfxSel.value];
  fillSelect(castVfxSel, ids, { includeNone: true });
  fillSelect(travelVfxSel, ids, { includeNone: true });
  fillSelect(impactVfxSel, ids, { includeNone: true });
  [castVfxSel, travelVfxSel, impactVfxSel].forEach((sel, i) => { if (ids.includes(keep[i])) sel.value = keep[i]; });
}
refreshVfxPickers();

modeChecksEl.innerHTML = '';
for (const m of TARGETING_MODES) {
  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = m;
  cb.addEventListener('change', () => { syncTargetingFromForm(); rebuildPreview(); });
  label.append(cb, document.createTextNode(m));
  modeChecksEl.appendChild(label);
}

// --- Catalog -------------------------------------------------------------------
async function loadCatalog() {
  const res = await fetch('/api/skills');
  catalog = await res.json();
  const keep = selected?.id;
  renderList();
  select(catalog.find((s) => s.id === keep) || catalog[0]);
  say(`Loaded ${catalog.length} skill(s)`);
}

function renderList() {
  skillListEl.innerHTML = '';
  for (const s of catalog) {
    const d = document.createElement('div');
    d.textContent = `${s.name}${s.classId ? ` (${s.classId} #${s.key})` : ' (custom)'}`;
    d.classList.toggle('active', s === selected);
    d.addEventListener('click', () => select(s));
    skillListEl.appendChild(d);
  }
}

/** A fresh id that doesn't collide — the schema rejects duplicates on save. */
function uniqueId(base) {
  let id = base;
  let n = 2;
  while (catalog.some((s) => s.id === id)) id = `${base}-${n++}`;
  return id;
}

function blankSkill() {
  return {
    id: uniqueId('new-skill'),
    name: 'New Skill',
    description: '',
    resourceCost: 10,
    cooldownMs: 2000,
    castMs: 200,
    canMoveDuringCast: true,
    targeting: { modes: ['enemy'], range: 8, shape: 'single' },
    effects: [{ type: 'damage', amount: 10, damageType: 'physical' }],
    animation: { windupMs: 150, effectMs: 150, recoveryMs: 150 },
    vfx: { impactVfxId: 'impact-burst', impactAnchor: 'target' },
  };
}

$('new-btn').addEventListener('click', () => {
  const fresh = blankSkill();
  catalog.push(fresh);
  renderList();
  select(fresh);
});

$('dup-btn').addEventListener('click', () => {
  if (!selected) return;
  const copy = structuredClone(selected);
  copy.id = uniqueId(`${selected.id}-copy`);
  copy.name = `${selected.name} copy`;
  delete copy.classId;
  delete copy.key;
  catalog.push(copy);
  renderList();
  select(copy);
});

$('del-btn').addEventListener('click', () => {
  if (!selected) return;
  if (catalog.length === 1) return say('Cannot delete the last skill', true);
  const i = catalog.indexOf(selected);
  catalog.splice(i, 1);
  renderList();
  select(catalog[Math.max(0, i - 1)]);
});

// --- Custom VFX Library (separate catalog from the skill list above) -----------
// The parameter inputs are generated from src/sim/vfxDefs.js's VFX_PARAM_SPECS
// rather than a hand-copied table: this panel used to keep its own duplicate,
// so every shape added to the sim rendered an empty parameter panel here until
// someone remembered to copy it across.
/** A sensible input step for a [min, max] range — whole numbers for counts, finer the smaller the range. */
function paramStep(key, min, max) {
  if (/count|segments/i.test(key)) return 1;
  const span = max - min;
  if (span <= 2) return 0.01;
  if (span <= 12) return 0.05;
  return 0.1;
}

function uniqueVfxId(base) {
  let id = base;
  let n = 2;
  while (vfxCatalog.some((v) => v.id === id)) id = `${base}-${n++}`;
  return id;
}

function blankVfx() {
  const shape = 'burst';
  return { id: uniqueVfxId('my-effect'), name: 'My Effect', shape, colorA: '#ffcc55', colorB: '#ff3300', params: defaultVfxParams(shape) };
}

function renderVfxList() {
  vfxListEl.innerHTML = '';
  for (const v of vfxCatalog) {
    const d = document.createElement('div');
    d.textContent = `${v.name} (${v.shape})`;
    d.classList.toggle('active', v === selectedVfx);
    d.addEventListener('click', () => selectVfx(v));
    vfxListEl.appendChild(d);
  }
}

/** Rebuilds the shape-specific number inputs (+ texture picker for burst/aura) for the currently selected custom VFX. Each field edits selectedVfx.params directly and re-registers the whole catalog so Preview always reflects the latest edit without needing a save first. */
function renderVfxParamsFields() {
  vfxParamsFieldsEl.innerHTML = '';
  if (!selectedVfx) return;
  selectedVfx.params = selectedVfx.params || defaultVfxParams(selectedVfx.shape);
  const fields = Object.entries(VFX_PARAM_SPECS[selectedVfx.shape] || {});
  for (const [key, [min, max]] of fields) {
    const label = document.createElement('label');
    label.textContent = key;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = min;
    input.max = max;
    input.step = paramStep(key, min, max);
    input.value = selectedVfx.params[key] ?? defaultVfxParams(selectedVfx.shape)[key];
    input.addEventListener('change', () => {
      selectedVfx.params[key] = parseFloat(input.value);
      registerCustomVfxDefs(vfxCatalog);
    });
    label.appendChild(input);
    vfxParamsFieldsEl.appendChild(label);
  }
  // Only shapes whose builder actually reads params.texture get a picker —
  // see VFX_SHAPE_TEXTURES' comment in src/sim/vfxDefs.js.
  const textureOptions = VFX_SHAPE_TEXTURES[selectedVfx.shape] || null;
  if (textureOptions) {
    const label = document.createElement('label');
    label.textContent = 'texture';
    const sel = document.createElement('select');
    for (const t of textureOptions) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      if ((selectedVfx.params.texture || textureOptions[0]) === t) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => { selectedVfx.params.texture = sel.value; registerCustomVfxDefs(vfxCatalog); });
    label.appendChild(sel);
    vfxParamsFieldsEl.appendChild(label);
  }
}

function selectVfx(v) {
  selectedVfx = v;
  renderVfxList();
  if (!v) return;
  vfxNameEl.value = v.name;
  vfxShapeSel.value = v.shape;
  vfxColorAEl.value = v.colorA;
  vfxColorBEl.value = v.colorB || v.colorA;
  renderVfxParamsFields();
}

vfxNameEl.addEventListener('change', () => { if (selectedVfx) { selectedVfx.name = vfxNameEl.value; renderVfxList(); } });
vfxShapeSel.addEventListener('change', () => {
  if (!selectedVfx) return;
  selectedVfx.shape = vfxShapeSel.value;
  selectedVfx.params = defaultVfxParams(selectedVfx.shape); // fresh, sensible defaults for the new shape rather than leaving stale keys from the old one
  renderVfxParamsFields();
  registerCustomVfxDefs(vfxCatalog);
  renderVfxList();
});
vfxColorAEl.addEventListener('change', () => { if (selectedVfx) { selectedVfx.colorA = vfxColorAEl.value; registerCustomVfxDefs(vfxCatalog); } });
vfxColorBEl.addEventListener('change', () => { if (selectedVfx) { selectedVfx.colorB = vfxColorBEl.value; registerCustomVfxDefs(vfxCatalog); } });

$('vfx-new-btn').addEventListener('click', () => {
  const fresh = blankVfx();
  vfxCatalog.push(fresh);
  registerCustomVfxDefs(vfxCatalog);
  refreshVfxPickers();
  renderVfxList();
  selectVfx(fresh);
});

$('vfx-dup-btn').addEventListener('click', () => {
  if (!selectedVfx) return;
  const copy = structuredClone(selectedVfx);
  copy.id = uniqueVfxId(`${selectedVfx.id}-copy`);
  copy.name = `${selectedVfx.name} copy`;
  vfxCatalog.push(copy);
  registerCustomVfxDefs(vfxCatalog);
  refreshVfxPickers();
  renderVfxList();
  selectVfx(copy);
});

$('vfx-del-btn').addEventListener('click', () => {
  if (!selectedVfx) return;
  const i = vfxCatalog.indexOf(selectedVfx);
  vfxCatalog.splice(i, 1);
  registerCustomVfxDefs(vfxCatalog);
  refreshVfxPickers();
  renderVfxList();
  selectVfx(vfxCatalog[Math.max(0, i - 1)] || null);
});

$('vfx-preview-btn').addEventListener('click', () => {
  if (!selectedVfx) return say('No custom VFX selected', true);
  const pos = activeDummyPosition();
  if (!pos) return say('No dummy available to preview on', true);
  vfxSystem.spawn(selectedVfx.id, { x: pos.x, y: pos.y + 1, z: pos.z });
});

$('vfx-save-btn').addEventListener('click', async () => {
  try {
    parseVfxDefs(vfxCatalog); // same validation the server will run — catch a mistake before the round trip
  } catch (err) {
    return say(err.message, true);
  }
  say('Saving VFX library…');
  const res = await fetch('/api/vfx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(vfxCatalog) });
  const json = await res.json();
  if (!res.ok) return say(json.error || 'Save failed', true);
  say(`Saved ${vfxCatalog.length} custom VFX`);
});

async function loadVfxCatalog() {
  const res = await fetch('/api/vfx');
  vfxCatalog = await res.json();
  registerCustomVfxDefs(vfxCatalog);
  refreshVfxPickers();
  renderVfxList();
  selectVfx(vfxCatalog[0] || null);
}

$('revert-btn').addEventListener('click', () => loadCatalog());

$('save-btn').addEventListener('click', async () => {
  say('Saving…');
  const res = await fetch('/api/skills', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(catalog),
  });
  const json = await res.json();
  if (!res.ok) return say(json.error || 'Save failed', true);
  say(`Saved ${catalog.length} skill(s)`);
});

// --- Form <-> selected sync ----------------------------------------------------
function select(skill) {
  if (!skill) return;
  selected = skill;
  scrubTimeMs = 0;
  selectedPart = null;
  selectedEvent = null;
  renderList();

  nameEl.value = skill.name || '';
  descEl.value = skill.description || '';
  iconEl.value = skill.icon || '';
  refreshIconPreview();
  soundNameEl.textContent = skill.soundUrl ? skill.soundUrl.split('/').pop() : '(none)';
  costEl.value = skill.resourceCost ?? 0;
  cooldownEl.value = skill.cooldownMs ?? 0;
  castMsEl.value = skill.castMs ?? 0;
  canMoveEl.checked = !!skill.canMoveDuringCast;

  for (const cb of modeChecksEl.querySelectorAll('input')) cb.checked = skill.targeting.modes.includes(cb.value);
  shapeSel.value = skill.targeting.shape;
  rangeEl.value = skill.targeting.range ?? 0;
  refreshShapeExtraFields();

  windupEl.value = skill.animation.windupMs ?? 0;
  effectMsEl.value = skill.animation.effectMs ?? 0;
  recoveryEl.value = skill.animation.recoveryMs ?? 0;

  castVfxSel.value = skill.vfx?.castVfxId || '';
  castAnchorSel.value = skill.vfx?.castAnchor || 'hand';
  travelVfxSel.value = skill.vfx?.travelVfxId || '';
  impactVfxSel.value = skill.vfx?.impactVfxId || '';
  impactAnchorSel.value = skill.vfx?.impactAnchor || 'target';

  refreshEffectsList();
  refreshLevelUpgradesList();
  refreshTimelineList();
  rebuildPreview();
}

function refreshIconPreview() {
  const isUrl = typeof selected.icon === 'string' && /^(\/|https?:)/.test(selected.icon);
  iconPreviewEl.style.display = isUrl ? 'block' : 'none';
  if (isUrl) iconPreviewEl.src = selected.icon;
}

function refreshShapeExtraFields() {
  shapeExtraEl.innerHTML = '';
  const shape = shapeSel.value;
  const t = selected.targeting;
  if (shape === 'aoe-circle' || shape === 'aoe-line') {
    addNumberField(shapeExtraEl, 'Radius', t.radius ?? 3, (v) => (t.radius = v));
  } else if (shape === 'aoe-cone') {
    addNumberField(shapeExtraEl, 'Angle (deg)', t.angleDeg ?? 60, (v) => (t.angleDeg = v));
  } else if (shape === 'chain') {
    addNumberField(shapeExtraEl, 'Chain count', t.chainCount ?? 2, (v) => (t.chainCount = v));
  }
}

function addNumberField(host, labelText, value, onChange) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.value = value;
  input.addEventListener('change', () => { onChange(parseFloat(input.value) || 0); rebuildPreview(); });
  label.appendChild(input);
  host.appendChild(label);
}

function syncTargetingFromForm() {
  if (!selected) return;
  selected.targeting.modes = [...modeChecksEl.querySelectorAll('input')].filter((c) => c.checked).map((c) => c.value);
}

nameEl.addEventListener('input', () => { selected.name = nameEl.value; renderList(); });
descEl.addEventListener('input', () => { selected.description = descEl.value; });
iconEl.addEventListener('input', () => { selected.icon = iconEl.value || undefined; refreshIconPreview(); });

iconFileEl.addEventListener('change', async () => {
  const file = iconFileEl.files[0];
  if (!file) return;
  say('Uploading icon…');
  const form = new FormData();
  form.append('icon', file);
  const res = await fetch('/api/skills/icon', { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) return say(json.error || 'Icon upload failed', true);
  selected.icon = json.url;
  iconEl.value = json.url;
  refreshIconPreview();
  iconFileEl.value = '';
  say('Icon uploaded');
});

soundFileEl.addEventListener('change', async () => {
  const file = soundFileEl.files[0];
  if (!file) return;
  say('Uploading sound…');
  const form = new FormData();
  form.append('sound', file);
  const res = await fetch('/api/skills/sound', { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) return say(json.error || 'Sound upload failed', true);
  selected.soundUrl = json.url;
  soundNameEl.textContent = json.url.split('/').pop();
  soundFileEl.value = '';
  say('Sound uploaded');
});

soundPlayBtn.addEventListener('click', () => {
  if (!selected.soundUrl) return say('No sound uploaded for this skill', true);
  new Audio(selected.soundUrl).play().catch(() => say('Could not play sound (browser blocked autoplay?)', true));
});
costEl.addEventListener('change', () => { selected.resourceCost = parseFloat(costEl.value) || 0; });
cooldownEl.addEventListener('change', () => { selected.cooldownMs = parseFloat(cooldownEl.value) || 0; });
castMsEl.addEventListener('change', () => { selected.castMs = parseFloat(castMsEl.value) || 0; });
canMoveEl.addEventListener('change', () => { selected.canMoveDuringCast = canMoveEl.checked; });
shapeSel.addEventListener('change', () => {
  selected.targeting.shape = shapeSel.value;
  // Drop shape-specific fields that no longer apply — the validator rejects
  // an aoe-circle without a radius, but a stale radius on a single-target
  // skill is just harmless clutter; still, keep the JSON clean.
  delete selected.targeting.radius;
  delete selected.targeting.angleDeg;
  delete selected.targeting.chainCount;
  refreshShapeExtraFields();
  rebuildPreview();
});
rangeEl.addEventListener('change', () => { selected.targeting.range = parseFloat(rangeEl.value) || 0; });

windupEl.addEventListener('change', () => { selected.animation.windupMs = parseFloat(windupEl.value) || 0; });
effectMsEl.addEventListener('change', () => { selected.animation.effectMs = parseFloat(effectMsEl.value) || 0; });
recoveryEl.addEventListener('change', () => { selected.animation.recoveryMs = parseFloat(recoveryEl.value) || 0; });

function syncVfxFromForm() {
  const vfx = {};
  if (castVfxSel.value) vfx.castVfxId = castVfxSel.value;
  if (castAnchorSel.value) vfx.castAnchor = castAnchorSel.value;
  if (travelVfxSel.value) vfx.travelVfxId = travelVfxSel.value;
  if (impactVfxSel.value) vfx.impactVfxId = impactVfxSel.value;
  if (impactAnchorSel.value) vfx.impactAnchor = impactAnchorSel.value;
  selected.vfx = Object.keys(vfx).length ? vfx : undefined;
}
for (const el of [castVfxSel, castAnchorSel, travelVfxSel, impactVfxSel, impactAnchorSel]) {
  el.addEventListener('change', syncVfxFromForm);
}

// --- Effects list ----------------------------------------------------------------
/** Which fields an effect type needs, matching src/sim/skillDefs.js's validateEffect. */
const EFFECT_FIELD_SPECS = {
  damage: [{ key: 'amount', label: 'Amount', type: 'number' }, { key: 'damageType', label: 'Damage type', type: 'select', options: DAMAGE_TYPES }],
  heal: [{ key: 'amount', label: 'Amount', type: 'number' }],
  stun: [{ key: 'durationMs', label: 'Duration ms', type: 'number' }],
  freeze: [{ key: 'durationMs', label: 'Duration ms', type: 'number' }],
  sleep: [{ key: 'durationMs', label: 'Duration ms', type: 'number' }],
  taunt: [{ key: 'durationMs', label: 'Duration ms', type: 'number' }],
  slow: [{ key: 'durationMs', label: 'Duration ms', type: 'number' }, { key: 'slowPercent', label: 'Slow % (0-1)', type: 'number' }],
  dot: [
    { key: 'damagePerTick', label: 'Damage/tick', type: 'number' },
    { key: 'tickMs', label: 'Tick ms', type: 'number' },
    { key: 'durationMs', label: 'Duration ms', type: 'number' },
    { key: 'damageType', label: 'Damage type', type: 'select', options: DAMAGE_TYPES },
  ],
  hot: [
    { key: 'healPerTick', label: 'Heal/tick', type: 'number' },
    { key: 'tickMs', label: 'Tick ms', type: 'number' },
    { key: 'durationMs', label: 'Duration ms', type: 'number' },
  ],
  buff: [
    { key: 'stat', label: 'Stat', type: 'select', options: BUFF_STATS },
    { key: 'amount', label: 'Amount', type: 'number' },
    { key: 'durationMs', label: 'Duration ms', type: 'number' },
  ],
  shield: [{ key: 'amount', label: 'Absorb amount', type: 'number' }, { key: 'durationMs', label: 'Duration ms', type: 'number' }],
  knockback: [{ key: 'distance', label: 'Distance', type: 'number' }],
  pull: [{ key: 'distance', label: 'Distance', type: 'number' }],
};

/** Default field values for a freshly-added effect of this type — the
 * validator throws on a missing required field, so a new row must start
 * with something valid rather than empty. */
function defaultEffect(type) {
  const e = { type };
  for (const spec of EFFECT_FIELD_SPECS[type]) {
    e[spec.key] = spec.type === 'select' ? spec.options[0] : (spec.key === 'slowPercent' ? 0.3 : 10);
  }
  return e;
}

/** The type-specific numeric/select fields for one effect — shared by the base
 * Effects list below (which also owns type-switching/remove) and each Level
 * Scaling breakpoint's effect row (src/skill-builder/main.js's
 * refreshLevelUpgradesList — a breakpoint's effect type is fixed, inherited
 * from the base effect at that index, so it only ever needs these fields). */
function renderEffectFieldRows(container, effect) {
  container.innerHTML = '';
  for (const spec of EFFECT_FIELD_SPECS[effect.type] || []) {
    const label = document.createElement('label');
    label.textContent = spec.label;
    let input;
    if (spec.type === 'select') {
      input = document.createElement('select');
      for (const o of spec.options) {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        input.appendChild(opt);
      }
      input.value = effect[spec.key];
      input.addEventListener('change', () => { effect[spec.key] = input.value; });
    } else {
      input = document.createElement('input');
      input.type = 'number';
      input.value = effect[spec.key] ?? 0;
      input.step = spec.key === 'slowPercent' ? '0.05' : '1';
      input.addEventListener('change', () => { effect[spec.key] = parseFloat(input.value) || 0; });
    }
    label.appendChild(input);
    container.appendChild(label);
  }
}

function refreshEffectsList() {
  effectsListEl.innerHTML = '';
  selected.effects.forEach((effect, i) => {
    const row = document.createElement('div');
    row.className = 'effect-row';

    const head = document.createElement('div');
    head.className = 'head';
    const typeSel = document.createElement('select');
    for (const t of EFFECT_TYPES) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      typeSel.appendChild(o);
    }
    typeSel.value = effect.type;
    typeSel.addEventListener('change', () => {
      selected.effects[i] = defaultEffect(typeSel.value);
      // Every Level Scaling breakpoint's effect at this index must stay the
      // SAME type as the base (see validateLevelUpgrades in skillDefs.js) —
      // reset it alongside the base rather than leaving it stale/invalid.
      for (const upgrade of selected.levelUpgrades || []) upgrade.effects[i] = defaultEffect(typeSel.value);
      refreshEffectsList();
      refreshLevelUpgradesList();
      rebuildPreview();
    });
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      selected.effects.splice(i, 1);
      for (const upgrade of selected.levelUpgrades || []) upgrade.effects.splice(i, 1);
      refreshEffectsList();
      refreshLevelUpgradesList();
      rebuildPreview();
    });
    head.append(typeSel, removeBtn);
    row.appendChild(head);

    const fields = document.createElement('div');
    fields.className = 'fields';
    renderEffectFieldRows(fields, effect);
    row.appendChild(fields);
    effectsListEl.appendChild(row);
  });
}

$('add-effect').addEventListener('click', () => {
  selected.effects.push(defaultEffect('damage'));
  for (const upgrade of selected.levelUpgrades || []) upgrade.effects.push(defaultEffect('damage'));
  refreshEffectsList();
  refreshLevelUpgradesList();
});

// --- Level Scaling: optional level breakpoints that replace `effects` from
// that level on — see skillDefs.js's effectiveEffectsForLevel, the one place
// this actually takes effect at runtime. Each breakpoint's effects start as
// a clone of the CURRENT base effects, so authoring one is "re-type the
// numbers that change," never a blank slate. ---------------------------------
function ensureLevelUpgrades() {
  if (!selected.levelUpgrades) selected.levelUpgrades = [];
  return selected.levelUpgrades;
}

function refreshLevelUpgradesList() {
  levelUpgradesListEl.innerHTML = '';
  const upgrades = selected.levelUpgrades || [];
  [...upgrades].sort((a, b) => a.level - b.level).forEach((upgrade) => {
    const i = upgrades.indexOf(upgrade);
    const row = document.createElement('div');
    row.className = 'effect-row';

    const head = document.createElement('div');
    head.className = 'head';
    const levelLabel = document.createElement('span');
    levelLabel.textContent = 'At level';
    levelLabel.style.flex = '1';
    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.min = 1; levelInput.max = 50;
    levelInput.value = upgrade.level;
    levelInput.style.width = '60px';
    levelInput.addEventListener('change', () => {
      upgrade.level = Math.max(1, Math.min(50, parseInt(levelInput.value, 10) || 1));
    });
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      upgrades.splice(i, 1);
      refreshLevelUpgradesList();
    });
    head.append(levelLabel, levelInput, removeBtn);
    row.appendChild(head);

    upgrade.effects.forEach((effect, ei) => {
      const typeLabel = document.createElement('div');
      typeLabel.style.cssText = 'font-size:10px;color:#7d879a;text-transform:uppercase;margin-top:6px';
      typeLabel.textContent = `Effect ${ei + 1}: ${effect.type}`;
      row.appendChild(typeLabel);
      const fields = document.createElement('div');
      fields.className = 'fields';
      renderEffectFieldRows(fields, effect);
      row.appendChild(fields);
    });

    levelUpgradesListEl.appendChild(row);
  });
}

$('add-level-upgrade').addEventListener('click', () => {
  const upgrades = ensureLevelUpgrades();
  const nextLevel = upgrades.length ? Math.min(50, Math.max(...upgrades.map((u) => u.level)) + 10) : 10;
  upgrades.push({ level: nextLevel, effects: structuredClone(selected.effects) });
  refreshLevelUpgradesList();
});

// --- Timeline (advanced) -----------------------------------------------------
function defaultTimelineEvent(type) {
  if (type === 'pose') return { type, atMs: 0, part: 'armR', rotationDeg: { x: -60, y: 0, z: 0 } };
  if (type === 'travel') return { type, atMs: 200, endAtMs: 500, vfxId: PRESET_IDS[0] };
  return { type, atMs: 200, vfxId: PRESET_IDS[0], anchor: type === 'cast' ? 'hand' : 'target' };
}

function ensureTimeline() {
  if (!selected.animation.timeline) selected.animation.timeline = [];
  return selected.animation.timeline;
}

function addNumberInput(host, value, onChange, step = 1) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = value;
  input.style.width = '100%';
  input.addEventListener('change', () => onChange(parseFloat(input.value) || 0));
  host.appendChild(input);
  return input;
}

function addSelectInput(host, options, value, onChange) {
  const sel = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o; opt.textContent = o;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  host.appendChild(sel);
  return sel;
}

function refreshTimelineList() {
  timelineListEl.innerHTML = '';
  const timeline = selected.animation.timeline || [];
  const sorted = [...timeline].sort((a, b) => a.atMs - b.atMs);
  for (const event of sorted) {
    const i = timeline.indexOf(event);
    const row = document.createElement('div');
    row.className = 'effect-row';
    row.classList.toggle('selected', event === selectedEvent || (event.type === 'pose' && event.part === selectedPart));

    const head = document.createElement('div');
    head.className = 'head';
    const typeLabel = document.createElement('span');
    typeLabel.style.flex = '1';
    typeLabel.textContent = event.type;
    head.appendChild(typeLabel);
    if (event.type === 'cast' || event.type === 'impact') {
      const anchorBtn = document.createElement('button');
      anchorBtn.textContent = '🎯';
      anchorBtn.title = 'Drag this VFX\'s anchor position';
      anchorBtn.addEventListener('click', () => selectTimelineEvent(event));
      head.appendChild(anchorBtn);
    }
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      timeline.splice(i, 1);
      if (selectedEvent === event) { selectedEvent = null; detachGizmo(); }
      refreshTimelineList();
      renderScrubber();
    });
    head.appendChild(removeBtn);
    row.appendChild(head);

    const fields = document.createElement('div');
    fields.className = 'fields';

    const atLabel = document.createElement('label');
    atLabel.textContent = event.type === 'travel' ? 'Starts at (ms)' : 'At (ms)';
    addNumberInput(atLabel, event.atMs, (v) => { event.atMs = v; refreshTimelineList(); renderScrubber(); });
    fields.appendChild(atLabel);

    if (event.type === 'pose') {
      const partLabel = document.createElement('label');
      partLabel.textContent = 'Body part';
      addSelectInput(partLabel, RIG_PARTS, event.part, (v) => { event.part = v; renderScrubber(); });
      fields.appendChild(partLabel);
      for (const ax of ['x', 'y', 'z']) {
        const axLabel = document.createElement('label');
        axLabel.textContent = `Rotation ${ax} (deg)`;
        addNumberInput(axLabel, event.rotationDeg[ax], (v) => { event.rotationDeg[ax] = v; updateScrubPreview(); }, 1);
        fields.appendChild(axLabel);
      }
    } else {
      if (event.type === 'travel') {
        const endLabel = document.createElement('label');
        endLabel.textContent = 'Arrives at (ms)';
        addNumberInput(endLabel, event.endAtMs, (v) => { event.endAtMs = v; refreshTimelineList(); renderScrubber(); });
        fields.appendChild(endLabel);
      } else {
        const anchorLabel = document.createElement('label');
        anchorLabel.textContent = 'Anchor';
        addSelectInput(anchorLabel, VFX_ANCHORS, event.anchor, (v) => {
          event.anchor = v;
          if (selectedEvent === event) attachAnchorGizmo(event);
        });
        fields.appendChild(anchorLabel);
      }
      const vfxLabel = document.createElement('label');
      vfxLabel.textContent = 'VFX preset';
      addSelectInput(vfxLabel, allVfxIds(), event.vfxId, (v) => (event.vfxId = v));
      fields.appendChild(vfxLabel);

      if (event.type !== 'travel') {
        const durationLabel = document.createElement('label');
        durationLabel.textContent = 'Duration (ms, blank = until anim ends)';
        const durationInput = addNumberInput(durationLabel, event.durationMs ?? '', (v) => {
          event.durationMs = durationInput.value === '' ? undefined : v;
        });
        durationInput.placeholder = 'until anim ends';
        fields.appendChild(durationLabel);
      }
    }
    row.appendChild(fields);
    timelineListEl.appendChild(row);
  }
}

for (const type of ['pose', 'cast', 'travel', 'impact']) {
  $(`add-${type}-event`).addEventListener('click', () => {
    const event = defaultTimelineEvent(type);
    event.atMs = Math.round(scrubTimeMs);
    if (event.type === 'travel') event.endAtMs = event.atMs + 300;
    ensureTimeline().push(event);
    refreshTimelineList();
    renderScrubber();
  });
}

// --- Timeline scrubber: drag the playhead to preview a paused pose, drag an
// event's diamond marker to retime it, click empty track to seek. ------------
/** Total timeline length in ms — same calc scene.js's runTimeline/updateAbilityAnimations
 * use for the envelope, so the scrubber's right edge matches what Play actually runs. */
function getTimelineTotal() {
  const a = selected.animation;
  const timeline = a.timeline || [];
  const base = a.windupMs + a.effectMs + a.recoveryMs;
  if (!timeline.length) return Math.max(base, 500);
  return Math.max(base, ...timeline.map((e) => e.endAtMs ?? e.atMs));
}

function selectTimelineEvent(event) {
  if (event.type === 'pose') {
    selectedPart = event.part;
    selectedEvent = null;
    attachPoseGizmo();
  } else {
    selectedEvent = event;
    selectedPart = null;
    attachAnchorGizmo(event);
  }
  updateSelectedPartLabel();
  refreshTimelineList();
  renderScrubber();
}

function detachGizmo() {
  gizmo.detach();
  if (anchorMarker) {
    if (anchorMarker.parent) anchorMarker.parent.remove(anchorMarker);
    anchorMarker = null;
    anchorBase = null;
  }
}

/** Show a draggable marker at a cast/impact event's resolved anchor (+ its
 * current offset, if any) and attach the translate gizmo to it. */
function attachAnchorGizmo(event) {
  if (anchorMarker) { if (anchorMarker.parent) anchorMarker.parent.remove(anchorMarker); anchorMarker = null; }
  const defaultAnchor = event.type === 'cast' ? 'hand' : 'target';
  const ctx = { casterMesh: mesh, casterPosition: mesh.position, targetPosition: activeDummyPosition() };
  const base = resolveAnchor(event.anchor || defaultAnchor, ctx);
  anchorMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xf4d78a, transparent: true, opacity: 0.85 })
  );
  const off = event.anchorOffset || { x: 0, y: 0, z: 0 };
  if (base instanceof THREE.Object3D) {
    anchorMarker.position.set(off.x, off.y, off.z);
    base.add(anchorMarker);
    anchorBase = { isObject3D: true };
  } else {
    anchorMarker.position.set(base.x + off.x, base.y + off.y, base.z + off.z);
    scene.add(anchorMarker);
    anchorBase = { isObject3D: false, base };
  }
  gizmo.setMode('translate');
  gizmo.attach(anchorMarker);
}

$('set-keyframe-btn').addEventListener('click', () => {
  if (!selectedPart) return say('Click a body part in the preview first', true);
  const pivot = mesh.userData.rig[selectedPart];
  const R2D = 180 / Math.PI;
  const rotationDeg = {
    x: +(pivot.rotation.x * R2D).toFixed(1),
    y: +(pivot.rotation.y * R2D).toFixed(1),
    z: +(pivot.rotation.z * R2D).toFixed(1),
  };
  const timeline = ensureTimeline();
  const atMs = Math.round(scrubTimeMs);
  const existing = timeline.find((e) => e.type === 'pose' && e.part === selectedPart && e.atMs === atMs);
  if (existing) existing.rotationDeg = rotationDeg;
  else timeline.push({ type: 'pose', atMs, part: selectedPart, rotationDeg });
  refreshTimelineList();
  renderScrubber();
  say(`Keyframe set: ${selectedPart} @ ${atMs}ms`);
});

/** Write the anchor marker's current position into selectedEvent.anchorOffset. */
function captureAnchorOffset() {
  if (!selectedEvent || !anchorMarker) return;
  const p = anchorMarker.position;
  const offset = anchorBase.isObject3D
    ? { x: p.x, y: p.y, z: p.z }
    : { x: p.x - anchorBase.base.x, y: p.y - anchorBase.base.y, z: p.z - anchorBase.base.z };
  selectedEvent.anchorOffset = { x: +offset.x.toFixed(3), y: +offset.y.toFixed(3), z: +offset.z.toFixed(3) };
}

// Captured live on every drag movement, not just on button click — dragging
// the marker and hitting Play without an explicit confirm step used to leave
// anchorOffset at its old value, so the VFX visibly "didn't move with" the
// marker. The button below is now just an explicit re-sync (e.g. after
// switching the anchor base), not the only way to commit a drag.
gizmo.addEventListener('objectChange', () => {
  if (gizmo.object === anchorMarker) captureAnchorOffset();
});

$('use-anchor-btn').addEventListener('click', () => {
  if (!selectedEvent || !anchorMarker) return say('Click a cast/impact event\'s 🎯 first', true);
  captureAnchorOffset();
  refreshTimelineList();
  say('Anchor position captured');
});

$('select-enemy-dummy').addEventListener('click', () => setActiveDummy('enemy'));
$('select-ally-dummy').addEventListener('click', () => setActiveDummy('ally'));

function renderScrubber() {
  if (!selected) return;
  const total = getTimelineTotal();
  scrubberTimeEl.textContent = `${Math.round(scrubTimeMs)} / ${Math.round(total)} ms`;
  const trackWidth = scrubberTrackEl.clientWidth || 1;
  scrubberPlayheadEl.style.left = `${(scrubTimeMs / total) * trackWidth}px`;

  scrubberEventsEl.innerHTML = '';
  const timeline = selected.animation.timeline || [];
  for (const event of timeline) {
    if (event.type === 'travel') {
      const startX = (event.atMs / total) * trackWidth;
      const endX = (event.endAtMs / total) * trackWidth;
      const span = document.createElement('div');
      span.className = 'scrub-travel-span';
      span.style.left = `${startX}px`;
      span.style.width = `${Math.max(2, endX - startX)}px`;
      scrubberEventsEl.appendChild(span);
      scrubberEventsEl.appendChild(makeScrubMarker(event, 'travel-start', startX, 'atMs', total, trackWidth));
      scrubberEventsEl.appendChild(makeScrubMarker(event, 'travel-end', endX, 'endAtMs', total, trackWidth));
    } else {
      const x = (event.atMs / total) * trackWidth;
      scrubberEventsEl.appendChild(makeScrubMarker(event, event.type, x, 'atMs', total, trackWidth));
    }
  }
}

function makeScrubMarker(event, cssClass, x, timeKey, total, trackWidth) {
  const el = document.createElement('div');
  el.className = `scrub-marker ${cssClass}`;
  el.style.left = `${x}px`;
  const isSelected = event === selectedEvent || (event.type === 'pose' && event.part === selectedPart && event.atMs === Math.round(scrubTimeMs));
  el.classList.toggle('selected', isSelected);
  el.title = event.type === 'pose' ? `${event.part} @ ${event[timeKey]}ms` : `${event.type} @ ${event[timeKey]}ms`;

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
    const newMs = Math.max(0, Math.round(((x + dx) / trackWidth) * total));
    event[timeKey] = newMs;
    if (event.type === 'travel') {
      if (event.endAtMs <= event.atMs) {
        if (timeKey === 'atMs') event.atMs = Math.max(0, event.endAtMs - 10);
        else event.endAtMs = event.atMs + 10;
      }
    }
    renderScrubber();
    refreshTimelineList();
  });
  el.addEventListener('pointerup', () => {
    const wasMoved = moved;
    dragStartX = null;
    moved = false;
    if (!wasMoved) {
      selectTimelineEvent(event);
      scrubTimeMs = event[timeKey];
      updateScrubPreview();
    }
  });
  return el;
}

scrubberTrackEl.addEventListener('pointerdown', (e) => {
  if (e.target !== scrubberTrackEl && e.target !== scrubberEventsEl) return;
  seekFromClientX(e.clientX);
});
let playheadDragging = false;
scrubberPlayheadEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  playheadDragging = true;
  scrubberPlayheadEl.setPointerCapture(e.pointerId);
});
scrubberPlayheadEl.addEventListener('pointermove', (e) => { if (playheadDragging) seekFromClientX(e.clientX); });
scrubberPlayheadEl.addEventListener('pointerup', () => { playheadDragging = false; });

function seekFromClientX(clientX) {
  const rect = scrubberTrackEl.getBoundingClientRect();
  const total = getTimelineTotal();
  scrubTimeMs = Math.max(0, Math.min(total, ((clientX - rect.left) / rect.width) * total));
  updateScrubPreview();
}

function updateScrubPreview() {
  renderScrubber();
  if (mesh?.userData.rig && selected) applyPoseTimeline(mesh.userData.rig, selected.animation.timeline || [], scrubTimeMs);
}

// --- Preview ---------------------------------------------------------------------
function rebuildPreview() {
  if (!selected) return;
  if (mesh) { scene.remove(mesh); mesh = null; }
  if (enemyDummy) { scene.remove(enemyDummy); enemyDummy = null; }
  if (allyDummy) { scene.remove(allyDummy); allyDummy = null; }
  selectedPart = null;
  selectedEvent = null;
  detachGizmo();
  updateSelectedPartLabel();

  try {
    mesh = buildPlayerMesh({ classId: previewClassId });
  } catch (err) {
    say(`Cannot build preview: ${err.message}`, true);
    return;
  }
  mesh.rotation.y = rotationY;
  scene.add(mesh);

  // Two always-present test dummies — enemy-targeted and ally-targeted
  // skills can both be tried against whichever is clicked as the active
  // target, independent of what targeting.modes the skill itself declares.
  enemyDummy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a3030 })
  );
  enemyDummy.position.set(1.3, 0.9, -3);
  scene.add(enemyDummy);

  allyDummy = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.3, 0.8, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f5a8a })
  );
  allyDummy.position.set(-1.3, 0.9, -3);
  scene.add(allyDummy);
  setActiveDummy(activeDummyKind);

  renderScrubber();
  updateScrubPreview();
}

$('play-btn').addEventListener('click', () => {
  if (!selected || !mesh) return;
  syncVfxFromForm();
  const fakeAbility = {
    id: selected.id,
    kind: selected.effects[0]?.type === 'heal' ? 'heal' : (selected.targeting.modes.includes('enemy') ? 'ranged' : 'buff'),
    windupMs: selected.animation.windupMs,
    effectMs: selected.animation.effectMs,
    recoveryMs: selected.animation.recoveryMs,
    vfx: selected.vfx,
    timeline: selected.animation.timeline,
  };
  const modes = selected.targeting.modes;
  const targetPosition = modes.some((m) => m !== 'self') ? activeDummyPosition() : null;
  triggerAbilityAnimation(scene, mesh, fakeAbility, vfxSystem, targetPosition);
  if (selected.soundUrl) new Audio(selected.soundUrl).play().catch(() => {});
});

// --- Loop --------------------------------------------------------------------
function frame(now) {
  requestAnimationFrame(frame);
  camera.position.set(0, 1.4, camDist);
  camera.lookAt(0, 0.9, -1);
  vfxSystem.update(Math.min(0.1, (now - (frame.last || now)) / 1000));
  frame.last = now;
  // Base layer: pose at the scrub position every frame; Play's own
  // runTimeline (inside updateAbilityAnimations) overrides on top for
  // whichever parts it's actively animating, then playback naturally
  // reverts to the scrub pose once it finishes.
  if (mesh?.userData.rig && selected) applyPoseTimeline(mesh.userData.rig, selected.animation.timeline || [], scrubTimeMs);
  if (mesh) updateAbilityAnimations(scene, [mesh]);
  resize();
  renderer.render(scene, camera);
}

// Dev affordance: inspect the live scene from the console.
window.__skillBuilder = {
  scene, camera, renderer, vfxSystem, updateAbilityAnimations,
  get mesh() { return mesh; }, get selected() { return selected; }, get catalog() { return catalog; },
  get scrubTimeMs() { return scrubTimeMs; }, set scrubTimeMs(v) { scrubTimeMs = v; updateScrubPreview(); },
};

// Saved weapon grips (Character & NPC Builder) — applied BEFORE the first
// preview build so a shield/sword moved there shows up here too, and so a
// weapon's hold pose (which reads the live, tuned weaponTypes defs) matches
// the pose the player actually sees in-game.
const [characterTypes, weaponTuning] = await Promise.all([
  fetch('/api/character-types').then((r) => r.json()).catch(() => []),
  fetch('/api/weapon-tuning').then((r) => r.json()).catch(() => ({})),
]);
applyWeaponTuning(weaponTuning);
setCharacterTypes(characterTypes);
await loadVfxCatalog(); // before loadCatalog() so a skill's saved vfx.*Id (possibly a custom one) resolves in the picker right away
await loadCatalog();
resize();
requestAnimationFrame(frame);
