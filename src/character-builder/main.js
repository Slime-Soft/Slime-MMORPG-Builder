// src/character-builder/main.js
// Character & NPC Builder — the humanoid counterpart to the World Editor's
// Monster Builder, served at /characters.html (renamed from /creatures.html).
//
// Everything a humanoid body is made of is editable here: each slot's ANCHOR
// (where the limb attaches — this is the knob that decides whether an arm sits
// inside the chest or clear of it), the shapes inside each slot, and the weapon
// grips and arm hold poses.
//
// The five player classes are ordinary rows in the catalog (kind: 'character'),
// so tuning a class model is the same act as authoring an NPC. The catalog is
// seeded from src/generators/characterPresets.js on the server's first run and
// then lives in character-types/character-types.json.
//
// Weapon grip/hold tuning is SAVED, not just exported: "Save catalog" writes
// both the bodies (character-types.json) and the grips (weapon-tuning.json).
// The game and the editor fetch the same tuning file and apply it over the
// defaults in src/sim/weaponTypes.js, so a grip tuned here is the grip the
// player sees. (The "Copy snippet" button remains, for promoting a tuned grip
// into the shipped defaults.)
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { HUMANOID_PART_PRESETS } from '../generators/characterPresets.js';
import { buildCreatureRig } from '../generators/creatureRig.js';
import { applyIdlePose, applyGaitPose, setBasePose } from '../generators/rig.js';
import { SHAPE_KINDS } from '../sim/shapeKinds.js';
import { WEAPON_TYPES, getWeaponTypeDef, validateLoadout, applyWeaponTuning, pristineWeaponDefault, registerCustomWeaponModels } from '../sim/weaponTypes.js';
import { CLASS_IDS } from '../sim/classes.js';
import { registerModelCatalog, onModelLoadedEvent } from '../generators/modelLoader.js';

const WALK_FREQUENCY = 8; // matches render/scene.js so the preview gait reads like the game's
const SLOT_ORDER = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
const SLOT_LABEL = { head: 'Head', torso: 'Torso', armL: 'Arm L', armR: 'Arm R', legL: 'Leg L', legR: 'Leg R' };
const AXES = ['x', 'y', 'z'];

/** Which preset list a slot draws from — arms and legs share one list per limb type. */
const presetCategory = (role) =>
  role.startsWith('arm') ? 'arm' : role.startsWith('leg') ? 'leg' : role;

// --- State -------------------------------------------------------------------
let catalog = [];
let skillCatalog = [];    // /api/skills — assignment lives here, not on this page's own catalog
let modelCatalog = [];    // /api/models — shared with the World Editor's props; this page only cares about category:'weapon' entries
let selected = null;      // the creature being edited
let activeSlot = 'torso';
let activeShapeId = null;
let mesh = null;
let rig = null;
let rotationY = 0.6;
let camDist = 4.2;
let gizmo = null;          // TransformControls, attached to the selected shape's mesh
let gizmoDragging = false; // suppress the camera drag while the gizmo has the pointer

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
scene.add(new THREE.GridHelper(6, 12, 0x3a4152, 0x2a303d));

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

// --- Direct manipulation -----------------------------------------------------
// Click a body part in the preview to select it, then drag the gizmo to move,
// rotate or scale it. The sliders stay (they're better for precise, symmetric
// values); this is for the cases where you just want to grab the thing and put
// it where it belongs.
//
// Dragging writes straight into the shape descriptor. The rig is NOT rebuilt
// mid-drag — rebuilding would delete the very mesh the gizmo is holding — so the
// panel resyncs on release.
gizmo = new TransformControls(camera, canvas);
gizmo.setSize(0.75);
gizmo.addEventListener('dragging-changed', (e) => {
  gizmoDragging = e.value;
  if (!e.value) { syncShapeFromMesh(); refreshShapeEditor(); }
});
gizmo.addEventListener('objectChange', syncShapeFromMesh);
scene.add(gizmo);

/** Copy the dragged mesh's transform back into the shape it came from. */
function syncShapeFromMesh() {
  const obj = gizmo.object;
  if (!obj || !selected) return;
  const slot = selected.slots.find((sl) => sl.role === obj.userData.slotRole);
  const sh = slot?.shapes.find((x) => x.id === obj.userData.shapeId);
  if (!sh) return;
  const R2D = 180 / Math.PI;
  sh.position = { x: +obj.position.x.toFixed(4), y: +obj.position.y.toFixed(4), z: +obj.position.z.toFixed(4) };
  sh.scale = { x: +obj.scale.x.toFixed(4), y: +obj.scale.y.toFixed(4), z: +obj.scale.z.toFixed(4) };
  const rot = { x: +(obj.rotation.x * R2D).toFixed(2), y: +(obj.rotation.y * R2D).toFixed(2), z: +(obj.rotation.z * R2D).toFixed(2) };
  if (rot.x || rot.y || rot.z) sh.rotation = rot; else delete sh.rotation;
}

/** The rendered mesh for a given slot+shape, if it's currently in the scene. */
function findShapeMesh(role, shapeId) {
  if (!mesh) return null;
  let found = null;
  mesh.traverse((o) => {
    if (o.isMesh && o.userData.shapeId === shapeId && o.parent?.userData.slotRole === role) found = o;
  });
  return found;
}

/** Point the gizmo at the active shape (or hide it when nothing is selected). */
function attachGizmo() {
  const target = activeShapeId ? findShapeMesh(activeSlot, activeShapeId) : null;
  if (target) {
    // The mesh's parent is the slot pivot, so the gizmo edits SLOT-LOCAL values —
    // exactly what the shape descriptor stores.
    target.userData.slotRole = activeSlot;
    gizmo.attach(target);
  } else {
    gizmo.detach();
  }
}

// Click (not drag) on a body part selects it.
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (gizmoDragging || !downAt) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return; // that was a camera drag
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = mesh ? ray.intersectObject(mesh, true) : [];
  const hit = hits.find((h) => h.object.userData.shapeId);
  if (!hit) return;
  const role = hit.object.parent?.userData.slotRole;
  if (!role) return;
  activeSlot = role;
  activeShapeId = hit.object.userData.shapeId;
  buildSlotTabs();
  refreshSlotPanel();
  attachGizmo();
  say(`Selected ${role} / ${activeShapeId} — G move, R rotate, S scale, Esc deselect`);
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'g' || e.key === 'G') gizmo.setMode('translate');
  else if (e.key === 'r' || e.key === 'R') gizmo.setMode('rotate');
  else if (e.key === 's' || e.key === 'S') gizmo.setMode('scale');
  else if (e.key === 'Escape') { activeShapeId = null; gizmo.detach(); refreshShapeList(); }
});

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  // A canvas is a replaced element: setSize writes an inline width/height that
  // silently beats the CSS. Pass `false` so it leaves the CSS box alone.
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// --- DOM handles -------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const catalogEl = $('catalog');
const nameEl = $('name-input');
const kindEl = $('kind-sel');
const slotTabsEl = $('slot-tabs');
const anchorEl = $('anchor-sliders');
const presetGridEl = $('preset-grid');
const shapeListEl = $('shape-list');
const shapeEditorEl = $('shape-editor');
const mainSel = $('main-hand');
const offSel = $('off-hand');
const animSel = $('anim');
const targetSel = $('tune-target');
const tunerEl = $('tuner');
const classSkillsSectionEl = $('class-skills-section');
const assignedSkillsListEl = $('assigned-skills-list');
const addSkillSelEl = $('add-skill-sel');
const weaponModelListEl = $('weapon-model-list');
const weaponModelUploadStatusEl = $('weapon-model-upload-status');
const statusEl = $('status');

function say(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? 'err' : '';
}

// --- Small widget helpers ----------------------------------------------------
/**
 * A labelled slider with a numeric box beside it. The box is not decoration: a
 * slider can't express "exactly -0.48", and these bodies are built out of
 * numbers that have to line up with each other. The box also accepts values
 * beyond the slider's range, which the slider then clamps its handle to.
 */
function slider(host, label, min, max, step, get, set) {
  const row = document.createElement('div');
  row.className = 'slider';
  const l = document.createElement('span');
  l.textContent = label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = get();

  const num = document.createElement('input');
  num.type = 'number';
  num.step = step;
  num.className = 'numbox';
  const fmt = (v) => (+v).toFixed(step < 1 ? 2 : 0);
  num.value = fmt(get());

  const commit = (v, from) => {
    if (!Number.isFinite(v)) return;
    set(v);
    if (from !== 'range') input.value = v;
    if (from !== 'number') num.value = fmt(v);
    rebuild();
  };
  input.addEventListener('input', () => commit(parseFloat(input.value), 'range'));
  num.addEventListener('change', () => commit(parseFloat(num.value), 'number'));

  row.append(l, input, num);
  host.appendChild(row);
  return input;
}

function subhead(host, text) {
  const d = document.createElement('div');
  d.className = 'sub';
  d.textContent = text;
  host.appendChild(d);
}

const toHex = (n) => '#' + (n ?? 0).toString(16).padStart(6, '0');
const fromHex = (s) => parseInt(s.slice(1), 16);

// --- Catalog -----------------------------------------------------------------
// What /api/weapon-tuning currently holds. Saves MERGE the session's edits over
// this rather than replacing the file with only the weapons touched today —
// replacing is how a save used to wipe every previously tuned weapon that
// wasn't equipped in the current session.
let serverTuning = {};

async function loadCatalog() {
  // Custom weapon models MUST be registered (registerCustomWeaponModels)
  // BEFORE the saved grip/hold tuning below is applied — applyWeaponTuning
  // silently no-ops any id not yet in weaponTypes.js's BY_ID (see its own
  // comment), so a custom weapon's saved grip was being dropped on every
  // reload: weapon-tuning used to get applied first, while the custom
  // weapon didn't exist in BY_ID yet (only registered further down).
  modelCatalog = await fetch('/api/models').then((r) => r.json()).catch(() => []);
  registerModelCatalog(modelCatalog);
  registerCustomWeaponModels(modelCatalog);
  refreshWeaponModelList();

  // Saved grips: they patch the weapon defs that defFor() then snapshots, so
  // the sliders open on the values that are actually in effect.
  serverTuning = await fetch('/api/weapon-tuning').then((r) => r.json()).catch(() => ({}));
  applyWeaponTuning(serverTuning);
  for (const id of Object.keys(tuned)) delete tuned[id];
  const tuning = serverTuning;

  const res = await fetch('/api/character-types');
  catalog = await res.json();
  skillCatalog = await fetch('/api/skills').then((r) => r.json()).catch(() => []);
  const keep = selected?.id;
  renderCatalog();
  select(catalog.find((c) => c.id === keep) || catalog[0]);
  tuneSignature = ''; // force the tuner to redraw against the reloaded values
  buildTuner();
  say(`Loaded ${catalog.length} types, ${Object.keys(tuning).length} tuned weapon(s)`);
}

function renderCatalog() {
  catalogEl.innerHTML = '';
  for (const c of catalog) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name}  (${c.kind})`;
    catalogEl.appendChild(o);
  }
}

function select(creature) {
  if (!creature) return;
  selected = creature;
  catalogEl.value = creature.id;
  nameEl.value = creature.name;
  kindEl.value = creature.kind ?? 'character';
  if (!creature.slots.some((s) => s.role === activeSlot)) activeSlot = creature.slots[0].role;
  activeShapeId = null;
  buildSlotTabs();
  fillWeaponSelects();
  refreshSlotPanel();
  refreshClassSkillsPanel();
  rebuild();
}

/** Which skills a class owns, at what hotbar key and required level — shown only
 * for kind:'character' rows that match a real playable class (CLASS_IDS).
 * Warlock's row (kind:'character', no CLASSES entry) gets no panel, since any
 * skill assigned to it would be silently dropped by classes.js's setSkillCatalog. */
function refreshClassSkillsPanel() {
  const applicable = selected?.kind === 'character' && CLASS_IDS.includes(selected.id);
  classSkillsSectionEl.style.display = applicable ? 'block' : 'none';
  if (!applicable) return;

  const assigned = skillCatalog.filter((s) => s.classId === selected.id).sort((a, b) => (a.key || 0) - (b.key || 0));
  assignedSkillsListEl.innerHTML = '';
  for (const skill of assigned) {
    const row = document.createElement('div');
    row.className = 'skill-row';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'skill-name';
    nameSpan.textContent = skill.name;
    nameSpan.title = skill.name;

    const keySel = document.createElement('select');
    for (let k = 1; k <= 8; k++) {
      const o = document.createElement('option');
      o.value = k; o.textContent = `Key ${k}`;
      keySel.appendChild(o);
    }
    keySel.value = skill.key || 1;
    keySel.addEventListener('change', () => { skill.key = parseInt(keySel.value, 10); });

    const levelInput = document.createElement('input');
    levelInput.type = 'number';
    levelInput.min = 1; levelInput.max = 50;
    levelInput.value = skill.requiredLevel || 1;
    levelInput.title = 'Required level';
    levelInput.addEventListener('change', () => {
      skill.requiredLevel = Math.max(1, Math.min(50, parseInt(levelInput.value, 10) || 1));
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.title = 'Unassign (becomes a custom/unassigned skill)';
    removeBtn.addEventListener('click', () => {
      delete skill.classId;
      delete skill.key;
      refreshClassSkillsPanel();
    });

    row.append(nameSpan, keySel, levelInput, removeBtn);
    assignedSkillsListEl.appendChild(row);
  }

  // Every OTHER skill in the catalog is a valid pick — including one
  // currently on a different class, flagged inline since picking it
  // reassigns it here rather than copying it.
  addSkillSelEl.innerHTML = '<option value="">(choose a skill to assign)</option>';
  for (const skill of skillCatalog) {
    if (skill.classId === selected.id) continue;
    const o = document.createElement('option');
    o.value = skill.id;
    o.textContent = skill.classId ? `${skill.name} (currently: ${skill.classId})` : skill.name;
    addSkillSelEl.appendChild(o);
  }
}

$('add-skill-btn').addEventListener('click', () => {
  const skillId = addSkillSelEl.value;
  if (!skillId) return;
  const skill = skillCatalog.find((s) => s.id === skillId);
  if (!skill) return;
  const usedKeys = new Set(skillCatalog.filter((s) => s.classId === selected.id).map((s) => s.key));
  let nextKey = 1;
  while (usedKeys.has(nextKey) && nextKey <= 8) nextKey++;
  skill.classId = selected.id;
  skill.key = nextKey <= 8 ? nextKey : 1;
  skill.requiredLevel = skill.requiredLevel || 1;
  refreshClassSkillsPanel();
});

catalogEl.addEventListener('change', () => select(catalog.find((c) => c.id === catalogEl.value)));
nameEl.addEventListener('input', () => { selected.name = nameEl.value; renderCatalog(); catalogEl.value = selected.id; });
kindEl.addEventListener('change', () => { selected.kind = kindEl.value; renderCatalog(); catalogEl.value = selected.id; });

/** A fresh id that doesn't collide — the schema rejects duplicates on save. */
function uniqueId(base) {
  let id = base;
  let n = 2;
  while (catalog.some((c) => c.id === id)) id = `${base}-${n++}`;
  return id;
}

$('dup-btn').addEventListener('click', () => {
  const copy = structuredClone(selected);
  copy.id = uniqueId(`${selected.id}-copy`);
  copy.name = `${selected.name} copy`;
  catalog.push(copy);
  renderCatalog();
  select(copy);
});

$('new-btn').addEventListener('click', () => {
  // A new body starts as a copy of the villager (or whatever is selected), since
  // an empty slot list can't be posed and would render as nothing at all.
  const base = catalog.find((c) => c.id === 'villager') || selected;
  const fresh = structuredClone(base);
  fresh.id = uniqueId('new-npc');
  fresh.name = 'New NPC';
  fresh.kind = 'npc';
  catalog.push(fresh);
  renderCatalog();
  select(fresh);
});

$('del-btn').addEventListener('click', () => {
  if (catalog.length === 1) return say('Cannot delete the last type', true);
  const i = catalog.indexOf(selected);
  catalog.splice(i, 1);
  renderCatalog();
  select(catalog[Math.max(0, i - 1)]);
});

$('revert-btn').addEventListener('click', () => loadCatalog());

/**
 * The complete tuning file to save: the server's current contents, with this
 * session's touched weapons merged over it.
 *
 * Each touched weapon is diffed against the PRISTINE shipped defaults — never
 * against the live defs, which applyWeaponTuning has already patched with the
 * saved values. Diffing against the live defs concludes "unchanged" for
 * everything saved before this session and drops it, which is exactly the
 * everything-resets-after-refresh bug. A weapon returned to its pristine
 * values is REMOVED from the file (that's what "reset" means).
 */
function tuningPayload() {
  const out = { ...serverTuning };
  for (const [id, d] of Object.entries(tuned)) {
    const pristine = pristineWeaponDefault(id);
    const grip = { position: { ...d.grip.position }, rotationDeg: { ...d.grip.rotationDeg } };
    const hold = {};
    for (const arm of ['armR', 'armL']) if (d.poses[arm]) hold[arm] = { ...d.hold[arm] };
    const same = JSON.stringify({ grip, hold }) === JSON.stringify({
      grip: { position: pristine.grip.position, rotationDeg: pristine.grip.rotationDeg },
      hold: Object.fromEntries(Object.entries(pristine.hold).map(([k, v]) => [k, { x: 0, y: 0, z: 0, swingScale: 1, ...v }])),
    });
    if (same) delete out[id];
    else out[id] = { grip, hold };
  }
  return out;
}

$('save-btn').addEventListener('click', async () => {
  say('Saving…');
  const post = (url, body) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  const bodies = await post('/api/character-types', catalog);
  const bodiesJson = await bodies.json();
  if (!bodies.ok) return say(bodiesJson.error || 'Save failed', true);

  const tuningBody = tuningPayload();
  const grips = await post('/api/weapon-tuning', tuningBody);
  const gripsJson = await grips.json();
  if (!grips.ok) return say(gripsJson.error || 'Weapon tuning save failed', true);
  serverTuning = tuningBody;

  const skills = await post('/api/skills', skillCatalog);
  const skillsJson = await skills.json();
  if (!skills.ok) return say(skillsJson.error || 'Skill assignment save failed', true);

  const n = Object.keys(tuningBody).length;
  say(`Saved ${catalog.length} types, ${n} tuned weapon(s), ${skillCatalog.length} skill(s) on file`);
});

// --- Slot editing ------------------------------------------------------------
const slotOf = (role) => selected.slots.find((s) => s.role === role);

function buildSlotTabs() {
  slotTabsEl.innerHTML = '';
  const roles = SLOT_ORDER.filter((r) => selected.slots.some((s) => s.role === r));
  for (const role of roles) {
    const b = document.createElement('button');
    b.textContent = SLOT_LABEL[role] || role;
    b.classList.toggle('active', role === activeSlot);
    b.addEventListener('click', () => {
      activeSlot = role;
      activeShapeId = null;
      buildSlotTabs();
      refreshSlotPanel();
    });
    slotTabsEl.appendChild(b);
  }
}

function refreshSlotPanel() {
  const slot = slotOf(activeSlot);

  // Anchor. The single most load-bearing number on a limb: it is the pivot the
  // limb rotates about, and it must clear the torso or the arm swings through it.
  anchorEl.innerHTML = '';
  for (const ax of AXES) {
    slider(anchorEl, ax, -2, 3, 0.01, () => slot.anchor[ax], (v) => (slot.anchor[ax] = v));
  }

  // Presets for this slot's category.
  presetGridEl.innerHTML = '';
  const presets = HUMANOID_PART_PRESETS[presetCategory(activeSlot)] || [];
  for (const p of presets) {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.addEventListener('click', () => {
      // Left limbs mirror the right-authored presets, same rule as the prefabs.
      const shapes = structuredClone(p.shapes);
      slot.shapes = activeSlot.endsWith('L') ? shapes.map(mirrorShape) : shapes;
      activeShapeId = null;
      refreshSlotPanel();
      rebuild();
    });
    presetGridEl.appendChild(b);
  }

  refreshShapeList();
}

/** Mirror a right-side shape onto the left. Matches characterPresets.mirrorShapes. */
function mirrorShape(s) {
  const out = { ...s, position: { ...s.position, x: -s.position.x } };
  if (s.rotation) out.rotation = { ...s.rotation, y: -s.rotation.y, z: -s.rotation.z };
  return out;
}

function refreshShapeList() {
  const slot = slotOf(activeSlot);
  shapeListEl.innerHTML = '';
  for (const sh of slot.shapes) {
    const d = document.createElement('div');
    d.textContent = `${sh.id} · ${sh.kind}`;
    d.classList.toggle('active', sh.id === activeShapeId);
    d.addEventListener('click', () => { activeShapeId = sh.id; refreshShapeList(); attachGizmo(); });
    shapeListEl.appendChild(d);
  }
  refreshShapeEditor();
}

function refreshShapeEditor() {
  shapeEditorEl.innerHTML = '';
  const slot = slotOf(activeSlot);
  const sh = slot.shapes.find((s) => s.id === activeShapeId);
  if (!sh) return;

  const kindLabel = document.createElement('label');
  kindLabel.textContent = 'Kind';
  const kindSel = document.createElement('select');
  for (const k of SHAPE_KINDS) {
    const o = document.createElement('option');
    o.value = k; o.textContent = k;
    kindSel.appendChild(o);
  }
  kindSel.value = sh.kind;
  kindSel.addEventListener('change', () => { sh.kind = kindSel.value; refreshShapeList(); rebuild(); });
  kindLabel.appendChild(kindSel);
  shapeEditorEl.appendChild(kindLabel);

  subhead(shapeEditorEl, 'Position (local to the slot anchor)');
  for (const ax of AXES) slider(shapeEditorEl, ax, -2, 2, 0.01, () => sh.position[ax], (v) => (sh.position[ax] = v));

  subhead(shapeEditorEl, 'Scale');
  // Up to 3.0: a shape must be able to be a torso, not just a finger.
  for (const ax of AXES) slider(shapeEditorEl, ax, 0.02, 3, 0.01, () => sh.scale[ax], (v) => (sh.scale[ax] = v));

  subhead(shapeEditorEl, 'Rotation (degrees)');
  for (const ax of AXES) {
    slider(shapeEditorEl, ax, -180, 180, 1,
      () => (typeof sh.rotation === 'object' ? sh.rotation[ax] || 0 : 0),
      (v) => {
        if (typeof sh.rotation !== 'object' || !sh.rotation) sh.rotation = { x: 0, y: 0, z: 0 };
        sh.rotation[ax] = v;
      });
  }

  const colorLabel = document.createElement('label');
  colorLabel.textContent = 'Colour';
  const color = document.createElement('input');
  color.type = 'color';
  color.value = toHex(sh.color);
  color.addEventListener('input', () => { sh.color = fromHex(color.value); rebuild(); });
  colorLabel.appendChild(color);
  shapeEditorEl.appendChild(colorLabel);
}

$('add-shape').addEventListener('click', () => {
  const slot = slotOf(activeSlot);
  let n = slot.shapes.length + 1;
  while (slot.shapes.some((s) => s.id === `s${n}`)) n++;
  const sh = { id: `s${n}`, kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 0.2, y: 0.2, z: 0.2 }, color: 0xc9a876 };
  slot.shapes.push(sh);
  activeShapeId = sh.id;
  refreshShapeList();
  rebuild();
});

$('del-shape').addEventListener('click', () => {
  const slot = slotOf(activeSlot);
  if (slot.shapes.length <= 1) return say('A slot needs at least one shape', true);
  slot.shapes = slot.shapes.filter((s) => s.id !== activeShapeId);
  activeShapeId = null;
  refreshShapeList();
  rebuild();
});

// --- Weapons -----------------------------------------------------------------
const hasArms = (c) => c.slots.some((s) => s.role === 'armL' || s.role === 'armR');

function optionsFor(creature, hand) {
  const allowed = creature.allowedWeaponTypes;
  return WEAPON_TYPES.filter((w) => {
    // A custom-uploaded weapon (registerCustomWeaponModels) always shows,
    // regardless of a class/NPC's curated allowlist — uploading it FOR this
    // purpose already is the explicit opt-in an allowlist normally gates.
    // Without this, a brand-new upload is invisible in every select (it's in
    // no existing allowlist yet) and commitEquipment's auto-add below never
    // gets a chance to run, since you can never select it in the first place.
    if (allowed && w.family !== 'custom' && !allowed.includes(w.id)) return false;
    return hand === 'off' ? w.slot === 'off' || w.slot === 'either' : w.slot !== 'off';
  });
}

function fillWeaponSelects() {
  const eq = selected.equipment || {};
  for (const [sel, hand, current] of [[mainSel, 'main', eq.mainHand], [offSel, 'off', eq.offHand]]) {
    sel.innerHTML = '<option value="">(empty)</option>';
    for (const w of optionsFor(selected, hand)) {
      const o = document.createElement('option');
      o.value = w.id;
      o.textContent = `${w.name}${w.hands === 2 ? ' (2H)' : ''}`;
      sel.appendChild(o);
    }
    sel.value = current || '';
    sel.disabled = !hasArms(selected);
  }
}

function currentLoadout() {
  const mainHand = mainSel.value || null;
  let offHand = offSel.value || null;
  // Mirror the schema's rule rather than previewing something save would reject.
  if (validateLoadout(mainHand, offHand)) {
    offSel.value = '';
    offHand = null;
  }
  return { mainHand, offHand };
}

function commitEquipment(loadout) {
  selected.equipment = { mainHand: loadout.mainHand, offHand: loadout.offHand };
  // An allowlist that doesn't cover what's equipped fails validation on save.
  if (selected.allowedWeaponTypes) {
    for (const id of [loadout.mainHand, loadout.offHand]) {
      if (id && !selected.allowedWeaponTypes.includes(id)) selected.allowedWeaponTypes.push(id);
    }
  }
}

mainSel.addEventListener('change', rebuild);
offSel.addEventListener('change', rebuild);

// --- Custom weapon models (FBX/GLB import) ------------------------------------
// Uploaded through the SAME /api/models endpoint the World Editor uses for
// world props (server/index.js), tagged category:'weapon' so it's filtered
// out of the editor's prop lists and into this one instead. Once uploaded,
// registerCustomWeaponModels (src/sim/weaponTypes.js) turns it into a real
// WeaponTypeDef — it shows up in the Main/Off hand selects above and the
// grip/hold tuner below completely for free, no separate UI needed for those.
function refreshWeaponModelList() {
  const weaponModels = modelCatalog.filter((m) => m.category === 'weapon');
  weaponModelListEl.innerHTML = weaponModels.map((m) => `
    <div class="weapon-model-row">
      <span>${m.name} (${m.weapon.hands}H, ${m.weapon.slot})</span>
      <button data-delete-weapon-model="${m.id}">✕</button>
    </div>
  `).join('') || '<div style="font-size:11px;color:#8a6423">None uploaded yet.</div>';
}

weaponModelListEl.addEventListener('click', async (e) => {
  const id = e.target.dataset.deleteWeaponModel;
  if (!id) return;
  const entry = modelCatalog.find((m) => m.id === id);
  if (!entry) return;
  if (!confirm(`Delete "${entry.name}"? This removes the uploaded file too — any character/NPC holding it falls back to a placeholder box.`)) return;
  const removed = modelCatalog;
  modelCatalog = modelCatalog.filter((m) => m.id !== id);
  refreshWeaponModelList();
  try {
    const res = await fetch('/api/models/catalog', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(modelCatalog),
    });
    if (!res.ok) throw new Error((await res.json()).error || `Server responded ${res.status}`);
    rebuild(); // any equipped instance of the deleted weapon falls back to a placeholder box
  } catch (err) {
    modelCatalog = removed; // save failed — don't leave the in-memory list ahead of what's on disk
    refreshWeaponModelList();
    weaponModelUploadStatusEl.textContent = `Delete failed: ${err.message}`;
  }
});

$('weapon-model-upload-btn').addEventListener('click', async () => {
  const fileInput = $('weapon-model-upload-file');
  const nameInput = $('weapon-model-upload-name');
  const scaleInput = $('weapon-model-upload-scale');
  const handsInput = $('weapon-model-upload-hands');
  const slotInput = $('weapon-model-upload-slot');
  const file = fileInput.files[0];
  if (!file) {
    weaponModelUploadStatusEl.textContent = 'Choose a .fbx or .glb file first.';
    return;
  }
  const formData = new FormData();
  formData.append('model', file);
  if (nameInput.value.trim()) formData.append('name', nameInput.value.trim());
  formData.append('importScale', scaleInput.value || '1');
  formData.append('category', 'weapon');
  formData.append('hands', handsInput.value);
  formData.append('slot', slotInput.value);
  weaponModelUploadStatusEl.textContent = 'Uploading…';
  try {
    const res = await fetch('/api/models/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server responded ${res.status}`);
    modelCatalog.push(data.entry);
    registerModelCatalog([data.entry]);
    registerCustomWeaponModels([data.entry]);
    refreshWeaponModelList();
    fillWeaponSelects(); // the new weapon is now a real WEAPON_TYPES entry
    fileInput.value = '';
    nameInput.value = '';
    weaponModelUploadStatusEl.textContent = `Uploaded "${data.entry.name}" — pick it in Main/Off hand above, then tune its grip below.`;
  } catch (err) {
    weaponModelUploadStatusEl.textContent = `Upload failed: ${err.message}`;
  }
});

// --- Weapon grip / hold tuning (export-only) ---------------------------------
const tuned = {};

function defFor(id) {
  if (!tuned[id]) {
    const base = getWeaponTypeDef(id);
    tuned[id] = {
      grip: { position: { ...base.grip.position }, rotationDeg: { ...base.grip.rotationDeg } },
      hold: {
        armR: { x: 0, y: 0, z: 0, swingScale: 1, ...(base.hold.armR || {}) },
        armL: { x: 0, y: 0, z: 0, swingScale: 1, ...(base.hold.armL || {}) },
      },
      poses: { armR: !!base.hold.armR, armL: !!base.hold.armL },
    };
  }
  return tuned[id];
}

function mergedHold(mainHandId, offHandId) {
  const pose = {};
  for (const id of [mainHandId, offHandId]) {
    if (!id) continue;
    const d = defFor(id);
    for (const arm of ['armR', 'armL']) if (d.poses[arm]) pose[arm] = { ...(pose[arm] || {}), ...d.hold[arm] };
  }
  return pose;
}

// Every slider drag calls rebuild(), which calls this. Rebuilding the tuner DOM
// mid-drag would tear the input out from under the pointer, so only redraw when
// the equipped set actually changes.
let tuneSignature = '';

function refreshTuneTargets(ids) {
  const signature = ids.join(',');
  if (signature === tuneSignature) return;
  tuneSignature = signature;
  const prev = targetSel.value;
  targetSel.innerHTML = '';
  for (const id of ids) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = getWeaponTypeDef(id).name;
    targetSel.appendChild(o);
  }
  targetSel.value = ids.includes(prev) ? prev : (ids[0] || '');
  buildTuner();
}

function buildTuner() {
  tunerEl.innerHTML = '';
  const id = targetSel.value;
  if (!id) return;
  const d = defFor(id);

  subhead(tunerEl, 'Grip position');
  // Wide enough for a custom uploaded model's arbitrary origin (a procedural
  // weapon's origin is already its grip point per weapon.js's convention, so
  // it never needed more than a small nudge — an imported mesh's pivot can
  // be anywhere the artist left it).
  for (const ax of AXES) slider(tunerEl, ax, -1.2, 1.2, 0.01, () => d.grip.position[ax], (v) => (d.grip.position[ax] = v));
  subhead(tunerEl, 'Grip rotation');
  for (const ax of AXES) slider(tunerEl, ax, -180, 180, 1, () => d.grip.rotationDeg[ax], (v) => (d.grip.rotationDeg[ax] = v));

  for (const arm of ['armR', 'armL']) {
    if (!d.poses[arm]) continue;
    subhead(tunerEl, `${arm === 'armR' ? 'Right' : 'Left'} arm hold`);
    for (const ax of AXES) slider(tunerEl, ax, -180, 180, 1, () => d.hold[arm][ax], (v) => (d.hold[arm][ax] = v));
    slider(tunerEl, 'swing', 0, 1, 0.05, () => d.hold[arm].swingScale, (v) => (d.hold[arm].swingScale = v));
  }
}

targetSel.addEventListener('change', buildTuner);

$('copy-btn').addEventListener('click', async () => {
  const id = targetSel.value;
  if (!id) return;
  const d = defFor(id);
  const n = (v) => +(+v).toFixed(3);
  const armLine = (a) => {
    const h = d.hold[a];
    const parts = AXES.filter((ax) => h[ax]).map((ax) => `${ax}: ${n(h[ax])}`);
    parts.push(`swingScale: ${n(h.swingScale)}`);
    return `      ${a}: { ${parts.join(', ')} },`;
  };
  const p = d.grip.position;
  const r = d.grip.rotationDeg;
  const text = [
    `    grip: { position: vec(${n(p.x)}, ${n(p.y)}, ${n(p.z)}), rotationDeg: deg(${n(r.x)}, ${n(r.y)}, ${n(r.z)}) },`,
    `    hold: {`,
    ['armR', 'armL'].filter((a) => d.poses[a]).map(armLine).join('\n'),
    `    },`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    say(`Copied ${id} — paste into src/sim/weaponTypes.js`);
  } catch {
    say('Clipboard blocked; snippet is in the console', true);
  }
  console.log(text);
});

$('reset-weapon').addEventListener('click', () => {
  const id = targetSel.value;
  if (!id) return;
  // Back to the SHIPPED defaults — not to the tuned values the live def was
  // patched with on load, which is what a plain re-snapshot would give.
  const pristine = pristineWeaponDefault(id);
  const d = defFor(id);
  d.grip = { position: { ...pristine.grip.position }, rotationDeg: { ...pristine.grip.rotationDeg } };
  for (const arm of ['armR', 'armL']) {
    if (d.poses[arm]) d.hold[arm] = { x: 0, y: 0, z: 0, swingScale: 1, ...(pristine.hold[arm] || {}) };
  }
  buildTuner();
  rebuild();
  say(`${id} reset to shipped defaults — Save catalog to persist`);
});

// --- Build -------------------------------------------------------------------
function rebuild() {
  if (!selected) return;
  if (mesh) scene.remove(mesh);

  const loadout = currentLoadout();
  commitEquipment(loadout);

  let built;
  try {
    built = buildCreatureRig(selected, { weapon: loadout });
  } catch (err) {
    say(`Cannot build: ${err.message}`, true);
    return;
  }
  mesh = built.group;
  rig = built.rig;
  mesh.rotation.y = rotationY;
  scene.add(mesh);

  // Layer the tuned grip/hold over what the rig built from sim's definitions.
  for (const hand of Object.values(built.hands)) {
    for (const w of hand.children) {
      const { grip } = defFor(w.userData.weaponTypeId);
      w.position.set(grip.position.x, grip.position.y, grip.position.z);
      w.rotation.set(
        (grip.rotationDeg.x * Math.PI) / 180,
        (grip.rotationDeg.y * Math.PI) / 180,
        (grip.rotationDeg.z * Math.PI) / 180
      );
    }
  }
  for (const arm of ['armR', 'armL']) {
    if (rig[arm]) setBasePose(rig[arm], { x: 0, y: 0, z: 0, swingScale: 1 });
  }
  for (const [arm, hold] of Object.entries(mergedHold(loadout.mainHand, loadout.offHand))) {
    if (rig[arm]) setBasePose(rig[arm], hold);
  }

  refreshTuneTargets([loadout.mainHand, loadout.offHand].filter(Boolean));
  attachGizmo(); // the old mesh just died with the rebuild; re-grab the new one
}

// --- Camera controls ---------------------------------------------------------
let dragging = false;
let lastX = 0;
canvas.addEventListener('pointerdown', (e) => { if (gizmoDragging) return; dragging = true; lastX = e.clientX; });
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (!dragging || gizmoDragging) return;
  rotationY += (e.clientX - lastX) * 0.01;
  lastX = e.clientX;
  if (mesh) mesh.rotation.y = rotationY;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camDist = Math.max(1.4, Math.min(9, camDist + Math.sign(e.deltaY) * 0.3));
}, { passive: false });

// --- Loop --------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const t = now / 1000;
  last = now;
  if (rig) {
    if (animSel.value === 'walk') applyGaitPose(rig, mesh.userData.gaitTable, t * WALK_FREQUENCY, 1);
    else applyIdlePose(rig);
  }
  camera.position.set(0, 1.15, camDist);
  camera.lookAt(0, 0.9, 0);
  resize();
  renderer.render(scene, camera);
}

// Dev affordance: inspect the RENDERED rig from the console. Measuring the live
// scene graph (rather than a freshly-built copy) is how sign errors in the
// weapon grips got found.
window.__builder = { scene, camera, get mesh() { return mesh; }, get rig() { return rig; }, get selected() { return selected; }, get catalog() { return catalog; }, get gizmo() { return gizmo; } };

// A custom weapon model uploaded/equipped before it finishes loading shows a
// wireframe placeholder (buildModelPlaceholder, see modelLoader.js/weapon.js)
// — rebuild once it's actually ready, mirroring the World Editor's identical
// live-rebuild-on-load pattern for props.
onModelLoadedEvent(() => rebuild());

await loadCatalog();
resize();
requestAnimationFrame(frame);
