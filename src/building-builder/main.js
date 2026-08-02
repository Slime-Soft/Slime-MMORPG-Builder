// src/building-builder/main.js
// Building Builder — served at /buildings.html. Two modes:
//
//   Parts mode: edit ONE reusable part (a wall style, a roof style, a
//   window, a door, a trim piece) as a flat shape list, same idea as the
//   World Editor's Object Builder but with full X/Y/Z rotation (see below).
//
//   Assemble mode: build a building by placing PART INSTANCES (referencing
//   a Parts-mode entry by id, not copying it — editing a part updates every
//   building using it) plus optional raw one-off shapes.
//
// Click-select + TransformControls gizmo + the slider() widget are lifted
// directly from src/character-builder/main.js, which already solved full
// X/Y/Z rotation (three per-axis sliders, gizmo rotate mode writing all
// three back) — strictly newer/better than the World Editor's Object
// Builder mode, which only ever exposed a single Y-axis rotation field.
//
// buildBuildingFromParts (src/generators/buildingRig.js) is the SAME
// function this tool's Assemble-mode preview calls and the live game calls
// to place a `type: 'custom'` building — no separate export step.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { buildShapeMesh, SHAPE_KINDS, PARAMETRIC_KINDS } from '../generators/custom.js';
import { buildBuildingFromParts } from '../generators/buildingRig.js';
import { PART_CATEGORIES } from '../sim/buildingPartDefs.js';

const AXES = ['x', 'y', 'z'];
const CATEGORY_LABEL = { wall: 'Wall', roof: 'Roof', window: 'Window', door: 'Door', trim: 'Trim', other: 'Other' };

// --- State -------------------------------------------------------------------
let parts = [];
let buildings = [];
let mode = 'parts'; // 'parts' | 'assemble'
let selectedPart = null;
let selectedBuilding = null;
let activeShapeId = null;       // Parts mode: id into selectedPart.shapes
let activePieceId = null;       // Assemble mode: id into selectedBuilding.pieces
let activeInlineShapeId = null; // Assemble mode: id into selectedBuilding.inlineShapes
let mesh = null;                // whichever preview (part or building) is currently built
let gizmo = null;
let gizmoDragging = false;

const partsById = () => Object.fromEntries(parts.map((p) => [p.id, p]));

// --- Scene -------------------------------------------------------------------
const canvas = document.getElementById('preview-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2029);
scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 1.15));
const key = new THREE.DirectionalLight(0xfff2d0, 1.05);
key.position.set(4, 8, 5);
scene.add(key);
scene.add(new THREE.GridHelper(12, 24, 0x3a4152, 0x2a303d));

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(7, 6, 9);

// A full orbit camera — buildings need to be inspected from above (checking
// a roof) as well as from the side, unlike the Character Builder this tool
// otherwise mirrors, which only ever needed to spin a character in place at
// a fixed eye-height angle. Left-drag orbits (any direction, including
// looking straight down), right-drag pans, scroll zooms.
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1.5, 0);
controls.minDistance = 2;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.98; // just short of straight up from below
controls.update();

// --- Direct manipulation -----------------------------------------------------
gizmo = new TransformControls(camera, canvas);
gizmo.setSize(0.75);
gizmo.addEventListener('dragging-changed', (e) => {
  gizmoDragging = e.value;
  controls.enabled = !e.value; // the gizmo and the orbit camera both want the pointer — only one at a time
  if (!e.value) { syncActiveFromMesh(); refreshActiveEditor(); }
});
gizmo.addEventListener('objectChange', syncActiveFromMesh);
scene.add(gizmo);

/** The data object the current selection edits, whichever mode/kind it is. */
function activeTarget() {
  if (mode === 'parts') {
    return selectedPart?.shapes.find((s) => s.id === activeShapeId) || null;
  }
  if (activePieceId) return selectedBuilding?.pieces.find((p) => p.id === activePieceId) || null;
  if (activeInlineShapeId) return selectedBuilding?.inlineShapes?.find((s) => s.id === activeInlineShapeId) || null;
  return null;
}

/** Copy the dragged mesh's transform back into whatever it's editing (a shape or a placed piece — both store position/rotation/scale the same way). */
function syncActiveFromMesh() {
  const obj = gizmo.object;
  const target = activeTarget();
  if (!obj || !target) return;
  const R2D = 180 / Math.PI;
  target.position = { x: +obj.position.x.toFixed(4), y: +obj.position.y.toFixed(4), z: +obj.position.z.toFixed(4) };
  target.scale = { x: +obj.scale.x.toFixed(4), y: +obj.scale.y.toFixed(4), z: +obj.scale.z.toFixed(4) };
  const rot = { x: +(obj.rotation.x * R2D).toFixed(2), y: +(obj.rotation.y * R2D).toFixed(2), z: +(obj.rotation.z * R2D).toFixed(2) };
  if (rot.x || rot.y || rot.z) target.rotation = rot; else delete target.rotation;
}

/** The rendered mesh for the current selection, if it's in the scene right now. */
function findActiveMesh() {
  if (!mesh) return null;
  if (mode === 'parts') {
    let found = null;
    mesh.traverse((o) => { if (o.isMesh && o.userData.shapeId === activeShapeId) found = o; });
    return found;
  }
  if (activePieceId) {
    return mesh.children.find((c) => c.userData.pieceId === activePieceId) || null;
  }
  if (activeInlineShapeId) {
    let found = null;
    mesh.traverse((o) => { if (o.isMesh && o.userData.shapeId === activeInlineShapeId && !o.parent.userData.pieceId) found = o; });
    return found;
  }
  return null;
}

function attachGizmo() {
  const target = findActiveMesh();
  if (target) gizmo.attach(target);
  else gizmo.detach();
}

// Click (not drag) selects whatever shape/piece is under the cursor.
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (gizmoDragging || !downAt) return;
  if (Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return; // camera drag
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const hits = mesh ? ray.intersectObject(mesh, true) : [];
  if (!hits.length) return;

  if (mode === 'parts') {
    const hit = hits.find((h) => h.object.userData.shapeId);
    if (!hit) return;
    activeShapeId = hit.object.userData.shapeId;
    refreshPartShapeList();
  } else {
    // Walk up from the hit to either a piece group (userData.pieceId) or a
    // top-level inline shape (userData.shapeId, parented directly under mesh).
    let obj = hits[0].object;
    let found = null;
    while (obj && obj !== mesh) {
      if (obj.userData.pieceId) { found = { kind: 'piece', id: obj.userData.pieceId }; break; }
      if (obj.userData.shapeId && obj.parent === mesh) { found = { kind: 'inline', id: obj.userData.shapeId }; break; }
      obj = obj.parent;
    }
    if (!found) return;
    activePieceId = found.kind === 'piece' ? found.id : null;
    activeInlineShapeId = found.kind === 'inline' ? found.id : null;
    refreshPieceList();
  }
  attachGizmo();
});

window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'g' || e.key === 'G') gizmo.setMode('translate');
  else if (e.key === 'r' || e.key === 'R') gizmo.setMode('rotate');
  else if (e.key === 's' || e.key === 'S') gizmo.setMode('scale');
  else if (e.key === 'Escape') {
    activeShapeId = null; activePieceId = null; activeInlineShapeId = null;
    gizmo.detach();
    if (mode === 'parts') refreshPartShapeList(); else refreshPieceList();
  }
});

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false); // canvas is a replaced element — `false` leaves the CSS box alone
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// --- DOM handles -------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const statusEl = $('status');
function say(msg, isError = false) { statusEl.textContent = msg; statusEl.className = isError ? 'err' : ''; }

// --- Small widget helpers (copied from character-builder/main.js) -----------
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

const toHex = (n) => '#' + (n ?? 0xcccccc).toString(16).padStart(6, '0');
const fromHex = (s) => parseInt(s.slice(1), 16);

function uniqueId(list, base) {
  let id = base, n = 2;
  while (list.some((x) => x.id === id)) id = `${base}-${n++}`;
  return id;
}

// --- Load / save ---------------------------------------------------------
async function loadCatalogs() {
  const [partsRes, buildingsRes] = await Promise.all([
    fetch('/api/building-parts').then((r) => r.json()).catch(() => []),
    fetch('/api/building-types').then((r) => r.json()).catch(() => []),
  ]);
  parts = partsRes;
  buildings = buildingsRes;

  renderPartCatalog();
  renderBuildingCatalog();
  refreshPartPicker();
  selectPart(parts.find((p) => p.id === selectedPart?.id) || parts[0]);
  selectBuilding(buildings.find((b) => b.id === selectedBuilding?.id) || buildings[0] || null);
  say(`Loaded ${parts.length} part(s), ${buildings.length} building(s)`);
}

$('save-btn').addEventListener('click', async () => {
  say('Saving…');
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const partsRes = await post('/api/building-parts', parts);
  const partsJson = await partsRes.json();
  if (!partsRes.ok) return say(partsJson.error || 'Part save failed', true);

  const buildingsRes = await post('/api/building-types', buildings);
  const buildingsJson = await buildingsRes.json();
  if (!buildingsRes.ok) return say(buildingsJson.error || 'Building save failed', true);

  say(`Saved ${parts.length} part(s), ${buildings.length} building(s)`);
});

$('revert-btn').addEventListener('click', () => loadCatalogs());

// --- Mode toggle ---------------------------------------------------------
$('mode-parts-btn').addEventListener('click', () => setMode('parts'));
$('mode-assemble-btn').addEventListener('click', () => setMode('assemble'));

function setMode(next) {
  mode = next;
  $('mode-parts-btn').classList.toggle('active', mode === 'parts');
  $('mode-assemble-btn').classList.toggle('active', mode === 'assemble');
  $('parts-mode').style.display = mode === 'parts' ? 'block' : 'none';
  $('assemble-mode').style.display = mode === 'assemble' ? 'block' : 'none';
  activeShapeId = null; activePieceId = null; activeInlineShapeId = null;
  rebuild();
}

// ======================== PARTS MODE ========================
function renderPartCatalog() {
  const el = $('part-catalog');
  el.innerHTML = '';
  for (const p of parts) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.name}  (${p.category})`;
    el.appendChild(o);
  }
}
$('part-catalog').addEventListener('change', () => selectPart(parts.find((p) => p.id === $('part-catalog').value)));

function selectPart(part) {
  if (!part) { selectedPart = null; return; }
  selectedPart = part;
  $('part-catalog').value = part.id;
  $('part-name-input').value = part.name;
  $('part-category-sel').value = part.category;
  activeShapeId = null;
  refreshPartShapeList();
  if (mode === 'parts') rebuild();
}

$('part-name-input').addEventListener('input', () => {
  selectedPart.name = $('part-name-input').value;
  renderPartCatalog();
  $('part-catalog').value = selectedPart.id;
});
$('part-category-sel').addEventListener('change', () => {
  selectedPart.category = $('part-category-sel').value;
  renderPartCatalog();
  $('part-catalog').value = selectedPart.id;
  refreshPartPicker();
});

$('part-new-btn').addEventListener('click', () => {
  const fresh = { id: uniqueId(parts, 'new-part'), name: 'New Part', category: 'other',
    shapes: [{ id: 's1', kind: 'box', position: { x: 0, y: 0.5, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: 0xcccccc }] };
  parts.push(fresh);
  renderPartCatalog();
  refreshPartPicker();
  selectPart(fresh);
});
$('part-dup-btn').addEventListener('click', () => {
  if (!selectedPart) return;
  const copy = structuredClone(selectedPart);
  copy.id = uniqueId(parts, `${selectedPart.id}-copy`);
  copy.name = `${selectedPart.name} copy`;
  parts.push(copy);
  renderPartCatalog();
  refreshPartPicker();
  selectPart(copy);
});
$('part-del-btn').addEventListener('click', () => {
  if (!selectedPart) return;
  if (parts.length === 1) return say('Cannot delete the last part', true);
  const i = parts.indexOf(selectedPart);
  parts.splice(i, 1);
  renderPartCatalog();
  refreshPartPicker();
  selectPart(parts[Math.max(0, i - 1)]);
});

// Shape-kind palette: click an icon, it's added immediately (Monster-Builder
// style) — building parts are more kind-diverse per object than character
// shapes, so a "always add a box, change kind via dropdown" shortcut isn't
// the right default here.
const SHAPE_KIND_ICON = { box: '🧊', cylinder: '🥫', sphere: '⚪', cone: '🔺', capsule: '💊', pyramid: '⛰️', wedge: '📐', 'log-wall': '🪵', 'shingle-roof-panel': '🏠' };
function buildShapeKindPalette(container, onAdd) {
  container.innerHTML = '';
  for (const kind of SHAPE_KINDS) {
    const b = document.createElement('button');
    b.textContent = `${SHAPE_KIND_ICON[kind] || '·'} ${kind}`;
    b.addEventListener('click', () => onAdd(kind));
    container.appendChild(b);
  }
}
buildShapeKindPalette($('part-shape-palette'), (kind) => {
  const p = selectedPart;
  let n = p.shapes.length + 1;
  while (p.shapes.some((s) => s.id === `s${n}`)) n++;
  const defaultScale = PARAMETRIC_KINDS.includes(kind) ? { x: 3, y: 2.5, z: 4 } : { x: 1, y: 1, z: 1 };
  const sh = { id: `s${n}`, kind, position: { x: (p.shapes.length % 4) * 0.7 - 1, y: 0.5, z: Math.floor(p.shapes.length / 4) * 0.7 - 1 }, scale: defaultScale, color: 0xcccccc };
  p.shapes.push(sh);
  activeShapeId = sh.id;
  refreshPartShapeList();
  rebuild();
});

function refreshPartShapeList() {
  const el = $('part-shape-list');
  el.innerHTML = '';
  if (!selectedPart) return;
  for (const sh of selectedPart.shapes) {
    const d = document.createElement('div');
    d.textContent = `${sh.id} · ${sh.kind}`;
    d.classList.toggle('active', sh.id === activeShapeId);
    d.addEventListener('click', () => { activeShapeId = sh.id; refreshPartShapeList(); attachGizmo(); });
    el.appendChild(d);
  }
  refreshPartShapeEditor();
}

$('part-del-shape').addEventListener('click', () => {
  if (!selectedPart || !activeShapeId) return;
  if (selectedPart.shapes.length <= 1) return say('A part needs at least one shape', true);
  selectedPart.shapes = selectedPart.shapes.filter((s) => s.id !== activeShapeId);
  activeShapeId = null;
  refreshPartShapeList();
  rebuild();
});

function refreshPartShapeEditor() {
  const host = $('part-shape-editor');
  host.innerHTML = '';
  const sh = selectedPart?.shapes.find((s) => s.id === activeShapeId);
  if (!sh) return;
  buildShapeFieldEditor(host, sh, { allowKindChange: true });
}

// ======================== ASSEMBLE MODE ========================
function renderBuildingCatalog() {
  const el = $('building-catalog');
  el.innerHTML = '';
  for (const b of buildings) {
    const o = document.createElement('option');
    o.value = b.id;
    o.textContent = b.name;
    el.appendChild(o);
  }
}
$('building-catalog').addEventListener('change', () => selectBuilding(buildings.find((b) => b.id === $('building-catalog').value)));

function selectBuilding(building) {
  selectedBuilding = building || null;
  if (!building) { refreshPieceList(); if (mode === 'assemble') rebuild(); return; }
  $('building-catalog').value = building.id;
  $('building-name-input').value = building.name;
  $('building-width').value = building.footprint.width;
  $('building-depth').value = building.footprint.depth;
  activePieceId = null; activeInlineShapeId = null;
  refreshPieceList();
  if (mode === 'assemble') rebuild();
}

$('building-name-input').addEventListener('input', () => {
  selectedBuilding.name = $('building-name-input').value;
  renderBuildingCatalog();
  $('building-catalog').value = selectedBuilding.id;
});
$('building-width').addEventListener('change', () => { selectedBuilding.footprint.width = parseFloat($('building-width').value) || 1; });
$('building-depth').addEventListener('change', () => { selectedBuilding.footprint.depth = parseFloat($('building-depth').value) || 1; });

$('building-new-btn').addEventListener('click', () => {
  const fresh = { id: uniqueId(buildings, 'new-building'), name: 'New Building', footprint: { width: 8, depth: 8 }, pieces: [], inlineShapes: [] };
  buildings.push(fresh);
  renderBuildingCatalog();
  selectBuilding(fresh);
});
$('building-dup-btn').addEventListener('click', () => {
  if (!selectedBuilding) return;
  const copy = structuredClone(selectedBuilding);
  copy.id = uniqueId(buildings, `${selectedBuilding.id}-copy`);
  copy.name = `${selectedBuilding.name} copy`;
  buildings.push(copy);
  renderBuildingCatalog();
  selectBuilding(copy);
});
$('building-del-btn').addEventListener('click', () => {
  if (!selectedBuilding) return;
  const i = buildings.indexOf(selectedBuilding);
  buildings.splice(i, 1);
  renderBuildingCatalog();
  selectBuilding(buildings[Math.max(0, i - 1)] || null);
});

/** Parts grouped under category subheadings, each a clickable button that adds a new placed piece. */
function refreshPartPicker() {
  const el = $('part-picker');
  el.innerHTML = '';
  for (const cat of PART_CATEGORIES) {
    const inCat = parts.filter((p) => p.category === cat);
    if (!inCat.length) continue;
    const head = document.createElement('div');
    head.className = 'category';
    head.textContent = CATEGORY_LABEL[cat] || cat;
    el.appendChild(head);
    for (const p of inCat) {
      const item = document.createElement('div');
      item.className = 'item';
      item.textContent = p.name;
      item.addEventListener('click', () => addPiece(p.id));
      el.appendChild(item);
    }
  }
}

function addPiece(partId) {
  if (!selectedBuilding) return say('Create or select a building first', true);
  const b = selectedBuilding;
  let n = b.pieces.length + 1;
  while (b.pieces.some((p) => p.id === `piece${n}`)) n++;
  const piece = {
    id: `piece${n}`, partId,
    position: { x: (b.pieces.length % 4) * 1.5 - 2.25, y: 0, z: Math.floor(b.pieces.length / 4) * 1.5 - 2.25 },
    scale: { x: 1, y: 1, z: 1 },
  };
  b.pieces.push(piece);
  activePieceId = piece.id;
  activeInlineShapeId = null;
  refreshPieceList();
  rebuild();
}

buildShapeKindPalette($('building-shape-palette'), (kind) => {
  if (!selectedBuilding) return say('Create or select a building first', true);
  const b = selectedBuilding;
  if (!b.inlineShapes) b.inlineShapes = [];
  let n = b.inlineShapes.length + 1;
  while (b.inlineShapes.some((s) => s.id === `shape${n}`)) n++;
  const defaultScale = PARAMETRIC_KINDS.includes(kind) ? { x: 3, y: 2.5, z: 4 } : { x: 1, y: 1, z: 1 };
  const sh = { id: `shape${n}`, kind, position: { x: 0, y: 0.5, z: 0 }, scale: defaultScale, color: 0xcccccc };
  b.inlineShapes.push(sh);
  activeInlineShapeId = sh.id;
  activePieceId = null;
  refreshPieceList();
  rebuild();
});

function refreshPieceList() {
  const el = $('piece-list');
  el.innerHTML = '';
  if (!selectedBuilding) return;
  for (const piece of selectedBuilding.pieces) {
    const part = partsById()[piece.partId];
    const d = document.createElement('div');
    d.textContent = `🧩 ${part ? part.name : '(missing part)'} · ${piece.id}`;
    d.classList.toggle('active', piece.id === activePieceId);
    d.addEventListener('click', () => { activePieceId = piece.id; activeInlineShapeId = null; refreshPieceList(); attachGizmo(); });
    el.appendChild(d);
  }
  for (const sh of selectedBuilding.inlineShapes || []) {
    const d = document.createElement('div');
    d.textContent = `◆ ${sh.kind} · ${sh.id}`;
    d.classList.toggle('active', sh.id === activeInlineShapeId);
    d.addEventListener('click', () => { activeInlineShapeId = sh.id; activePieceId = null; refreshPieceList(); attachGizmo(); });
    el.appendChild(d);
  }
  refreshActiveEditor();
}

$('piece-dup-btn').addEventListener('click', () => {
  if (!selectedBuilding) return;
  if (activePieceId) {
    const piece = selectedBuilding.pieces.find((p) => p.id === activePieceId);
    if (!piece) return;
    const copy = structuredClone(piece);
    copy.id = uniqueId(selectedBuilding.pieces, `${piece.id}-copy`);
    copy.position = { ...copy.position, x: copy.position.x + 0.6, z: copy.position.z + 0.6 }; // offset so it doesn't land exactly on top of the original
    selectedBuilding.pieces.push(copy);
    activePieceId = copy.id;
    activeInlineShapeId = null;
  } else if (activeInlineShapeId) {
    const sh = selectedBuilding.inlineShapes.find((s) => s.id === activeInlineShapeId);
    if (!sh) return;
    const copy = structuredClone(sh);
    copy.id = uniqueId(selectedBuilding.inlineShapes, `${sh.id}-copy`);
    copy.position = { ...copy.position, x: copy.position.x + 0.6, z: copy.position.z + 0.6 };
    selectedBuilding.inlineShapes.push(copy);
    activeInlineShapeId = copy.id;
    activePieceId = null;
  } else {
    return say('Select a piece or shape to duplicate first', true);
  }
  refreshPieceList();
  rebuild();
});

$('piece-del-btn').addEventListener('click', () => {
  if (!selectedBuilding) return;
  if (activePieceId) selectedBuilding.pieces = selectedBuilding.pieces.filter((p) => p.id !== activePieceId);
  else if (activeInlineShapeId) selectedBuilding.inlineShapes = selectedBuilding.inlineShapes.filter((s) => s.id !== activeInlineShapeId);
  else return;
  activePieceId = null; activeInlineShapeId = null;
  refreshPieceList();
  rebuild();
});

function refreshActiveEditor() {
  if (mode === 'parts') { refreshPartShapeEditor(); return; }
  const host = $('piece-editor');
  host.innerHTML = '';
  if (activePieceId) {
    const piece = selectedBuilding?.pieces.find((p) => p.id === activePieceId);
    if (!piece) return;
    buildPlacementFieldEditor(host, piece, { allowColorOverride: true });
  } else if (activeInlineShapeId) {
    const sh = selectedBuilding?.inlineShapes.find((s) => s.id === activeInlineShapeId);
    if (!sh) return;
    buildShapeFieldEditor(host, sh, { allowKindChange: true });
  }
}

// --- Shared field editors --------------------------------------------------
/** Position/rotation(xyz)/scale/color sliders for a raw shape (kind optional to change). */
function buildShapeFieldEditor(host, sh, { allowKindChange }) {
  if (allowKindChange) {
    const kindLabel = document.createElement('label');
    kindLabel.textContent = 'Kind';
    const kindSel = document.createElement('select');
    for (const k of SHAPE_KINDS) {
      const o = document.createElement('option');
      o.value = k; o.textContent = k;
      kindSel.appendChild(o);
    }
    kindSel.value = sh.kind;
    kindSel.addEventListener('change', () => {
      sh.kind = kindSel.value;
      if (mode === 'parts') refreshPartShapeList(); else refreshPieceList();
      rebuild();
    });
    kindLabel.appendChild(kindSel);
    host.appendChild(kindLabel);
  }

  // log-wall/shingle-roof-panel's scale IS a real dimension, not a 0..3
  // multiplier — give it a range that matches (a few units, not a fraction).
  const parametric = PARAMETRIC_KINDS.includes(sh.kind);
  const scaleMin = parametric ? 0.5 : 0.02;
  const scaleMax = parametric ? 12 : 3;
  const scaleStep = parametric ? 0.1 : 0.01;

  subhead(host, 'Position');
  for (const ax of AXES) slider(host, ax, -6, 6, 0.01, () => sh.position[ax], (v) => (sh.position[ax] = v));

  subhead(host, 'Scale');
  for (const ax of AXES) slider(host, ax, scaleMin, scaleMax, scaleStep, () => sh.scale[ax], (v) => (sh.scale[ax] = v));

  subhead(host, 'Rotation (degrees)');
  for (const ax of AXES) {
    slider(host, ax, -180, 180, 1,
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
  host.appendChild(colorLabel);
}

/** Position/rotation(xyz)/scale (+ optional color override) sliders for a placed piece instance. */
function buildPlacementFieldEditor(host, piece, { allowColorOverride }) {
  const part = partsById()[piece.partId];
  const label = document.createElement('div');
  label.className = 'sub';
  label.textContent = part ? `Part: ${part.name}` : 'Part: (missing — check Part Library)';
  host.appendChild(label);

  subhead(host, 'Position');
  for (const ax of AXES) slider(host, ax, -10, 10, 0.01, () => piece.position[ax], (v) => (piece.position[ax] = v));

  subhead(host, 'Scale');
  for (const ax of AXES) slider(host, ax, 0.1, 5, 0.01, () => piece.scale[ax], (v) => (piece.scale[ax] = v));

  subhead(host, 'Rotation (degrees)');
  for (const ax of AXES) {
    slider(host, ax, -180, 180, 1,
      () => (typeof piece.rotation === 'object' ? piece.rotation[ax] || 0 : 0),
      (v) => {
        if (typeof piece.rotation !== 'object' || !piece.rotation) piece.rotation = { x: 0, y: 0, z: 0 };
        piece.rotation[ax] = v;
      });
  }

  if (allowColorOverride) {
    const wrap = document.createElement('label');
    wrap.textContent = 'Colour override';
    const enable = document.createElement('input');
    enable.type = 'checkbox';
    enable.checked = piece.colorOverride != null;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = toHex(piece.colorOverride ?? 0xcccccc);
    color.style.display = enable.checked ? 'block' : 'none';
    enable.addEventListener('change', () => {
      piece.colorOverride = enable.checked ? fromHex(color.value) : undefined;
      color.style.display = enable.checked ? 'block' : 'none';
      rebuild();
    });
    color.addEventListener('input', () => { piece.colorOverride = fromHex(color.value); rebuild(); });
    wrap.appendChild(enable);
    host.appendChild(wrap);
    host.appendChild(color);
  }
}

// --- Build -------------------------------------------------------------------
function rebuild() {
  if (mesh) scene.remove(mesh);
  if (mode === 'parts') {
    if (!selectedPart) { mesh = null; return; }
    mesh = new THREE.Group();
    for (const sh of selectedPart.shapes) mesh.add(buildShapeMesh(sh));
  } else {
    if (!selectedBuilding) { mesh = null; return; }
    try {
      mesh = buildBuildingFromParts(selectedBuilding, partsById());
    } catch (err) {
      say(`Cannot build: ${err.message}`, true);
      return;
    }
  }
  scene.add(mesh);
  attachGizmo(); // the old mesh just died with the rebuild; re-grab the new one
}

// --- Loop --------------------------------------------------------------------
function frame() {
  requestAnimationFrame(frame);
  controls.update();
  resize();
  renderer.render(scene, camera);
}

// Dev affordance: inspect the live scene from the console, same pattern as
// the Character & NPC Builder.
window.__buildingBuilder = { scene, camera, get mesh() { return mesh; }, get parts() { return parts; }, get buildings() { return buildings; }, get gizmo() { return gizmo; } };

await loadCatalogs();
resize();
requestAnimationFrame(frame);
