// src/equipment-builder/main.js
// Equipment Builder — standalone page (served at /equipment.html), the gear
// counterpart to the Character & NPC Builder and the Monster Type Editor.
//
// WHAT IT AUTHORS, AND WHERE THAT GOES. Equipment pieces are rows in the ONE
// item catalog (items/items.json, src/sim/authoredItems.js) that the World
// Editor's Items tab, monster loot tables, merchant stores and crafting
// recipes all already read. This page does not own a parallel catalog: it
// edits the same rows, through the same /api/items endpoint, adding the two
// things the Items tab has no UI for — how a piece LOOKS on a body
// (src/sim/gearVisuals.js) and what it glows like. A helm built here is
// droppable, sellable and craftable the moment it's saved, with no extra step.
//
// WHY IT'S ITS OWN PAGE rather than another section of the Items tab: shape
// authoring needs a 3D workspace with a live character in it, orbit controls
// and a transform gizmo. That's a whole authoring surface, not a form field —
// the same reason the Monster Builder moved out of the World Editor's sidebar.
//
// The preview is deliberately built through buildPlayerCharacter, the exact
// function the live game and the character creator call. There is no
// builder-only rendering path, so what you see here is what the game draws.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createRenderer, updateWalkCycle } from '../render/scene.js';
import { createStudioScene } from '../monster-builder/studio.js';
import { buildPlayerCharacter, classBody, selectableBodies } from '../generators/playerCharacter.js';
import { SHAPE_KINDS } from '../sim/shapeKinds.js';
import { ARMOR_TYPES, EQUIP_SLOTS, ITEM_RARITIES, ITEM_STAT_IDS } from '../sim/authoredItems.js';
import { WEAPON_TYPES, getWeaponTypeDef } from '../sim/weaponTypes.js';
import {
  GEAR_ATTACH_ROLES, GLOW_MODES, GLOW_PRESETS, SUGGESTED_ROLES_FOR_SLOT,
  mirrorGearShapes, mirrorRoleOf, weaponRenderLoadout, defaultCoverageFor, HAIR_SHAPE_IDS, GLOW_STYLES,
} from '../sim/gearVisuals.js';
import { EQUIPMENT_PRESET_SETS, expandPresetSet } from '../sim/equipmentPresets.js';

// --- Small shared helpers ---------------------------------------------------
const $ = (id) => document.getElementById(id);
const hexToInput = (hex) => '#' + ((hex ?? 0xcccccc) >>> 0).toString(16).padStart(6, '0').slice(-6);
const inputToHex = (str) => parseInt(String(str).replace('#', ''), 16) || 0;
const num = (el, fallback = 0) => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : fallback; };

/**
 * The item id the piece being edited is merged under while previewing.
 *
 * A literal rather than the real item id because a brand-new piece hasn't got
 * one yet, and because the merged shape ids
 * (src/sim/gearVisuals.js's gearShapeId) are how the viewport finds "the
 * meshes belonging to the thing being edited" as opposed to the other set
 * pieces worn alongside it. A fixed prefix keeps that lookup a string compare.
 */
const EDIT_ID = '_edit';
const EDIT_PREFIX = `gear:${EDIT_ID}:`;
/** The selection key standing for "the held weapon" — not a role:shape pair, because a weapon has no authored shape to name. */
const WEAPON_KEY = '@weapon';

/** Shape kinds this builder offers. log-wall/shingle-roof-panel are excluded: they generate architecture-sized geometry from their scale (see PARAMETRIC_KINDS in src/generators/custom.js) and have no meaning on a gauntlet. */
const GEAR_SHAPE_KINDS = SHAPE_KINDS.filter((k) => k !== 'log-wall' && k !== 'shingle-roof-panel');

const VISUAL_SLOT_ORDER = ['head', 'chest', 'gloves', 'pants', 'shoes', 'mainHand', 'offHand', 'neck', 'ring', 'earring'];

// --- State ------------------------------------------------------------------
let itemCatalog = [];      // the WHOLE /api/items array — saved back wholesale, so non-equipment rows must survive untouched
let characterTypes = [];
let currentItem = null;    // working copy of the piece being edited
let editingExistingId = null;
let activeRole = 'head';
let selectedShapeKey = null; // `${role}:${shapeId}` — a bare shape id isn't unique, since a mirrored pair shares one
let catalogFilter = '';

// --- 3D workspace -----------------------------------------------------------
const canvas = $('eb-canvas');
const renderer = createRenderer(canvas, { shadows: true });
// createRenderer's initial setSize writes an inline width/height onto the
// canvas (Three's default updateStyle=true), which beats the stylesheet's
// width:100%. Cleared here; resizeCanvas below always passes updateStyle=false.
canvas.style.width = '';
canvas.style.height = '';
const scene = createStudioScene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
camera.position.set(0.6, 1.5, 3.4);
const orbit = new OrbitControls(camera, canvas);
orbit.enableDamping = true;
orbit.target.set(0, 1.0, 0);

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.7);
gizmo.addEventListener('dragging-changed', (e) => {
  orbit.enabled = !e.value;
  // Written back on RELEASE, not per-frame. Committing rebuilds the whole
  // preview character, which would both cost a rebuild per mouse-move and
  // delete the very mesh the gizmo is holding on to mid-drag.
  if (!e.value) commitGizmoTransform();
});
scene.add(gizmo.getHelper ? gizmo.getHelper() : gizmo);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let previewMesh = null;
/** `${role}:${shapeId}` -> the mesh in the viewport, rebuilt with the preview. Only shapes of the piece being EDITED are in here; other worn set pieces render but aren't selectable. */
let editableMeshes = new Map();
/** The held weapon group, when the piece being edited IS a weapon. Selectable like a gear shape, but it writes to the item's grip offset rather than to a shape descriptor — a weapon has no authored shapes to move. */
let weaponMesh = null;

function resizeCanvas() {
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  if (canvas.width === w && canvas.height === h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let walkT = 0;
function animate() {
  requestAnimationFrame(animate);
  resizeCanvas();
  orbit.update();
  if (previewMesh) {
    const walking = $('preview-walk').checked;
    walkT += 1 / 60;
    // Always ticked, even standing still: updateWalkCycle is also what advances
    // a weapon enchantment's particles (see updateWeaponEnchants there), so
    // skipping it while idle would show a frozen enchantment that only comes
    // alive when the model walks.
    updateWalkCycle(previewMesh, walking, walkT, 1 / 60);
  }
  renderer.render(scene, camera);
}

/**
 * A wireframe of the box particles are born in.
 *
 * Adjusting an emission volume you cannot see is guesswork — the particles are
 * soft, semi-transparent and moving, so "is the box too tall or is the style
 * just carrying them past the tip?" is not answerable by looking at the cloud.
 * Builder-only: it is a child of the weapon (so it swings with it) but nothing
 * outside this page ever builds one.
 */
let emitterBox = null;
function refreshEmitterBox() {
  if (emitterBox) { emitterBox.parent?.remove(emitterBox); emitterBox.geometry.dispose(); emitterBox.material.dispose(); emitterBox = null; }
  if (!$('preview-emitter').checked || !weaponMesh) return;
  const cloud = weaponMesh.userData?.weaponEnchant;
  if (!cloud) return;
  const { min, extent } = cloud.userData.weaponEnchant;
  emitterBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(extent.x, extent.y, extent.z)),
    new THREE.LineBasicMaterial({ color: 0xd9a441, transparent: true, opacity: 0.75, depthTest: false }),
  );
  emitterBox.position.set(min.x + extent.x / 2, min.y + extent.y / 2, min.z + extent.z / 2);
  emitterBox.renderOrder = 5;
  weaponMesh.add(emitterBox);
}

// --- Preview ----------------------------------------------------------------

/** The other pieces of the same authored set, so a helm can be judged against the chest it ships with rather than against a bare body. Matches on the shared `eq_<setId>_` prefix that expandPresetSet mints; a hand-named item simply finds no siblings. */
function setSiblings() {
  if (!$('preview-set').checked || !currentItem?.id) return [];
  const cut = currentItem.id.lastIndexOf('_');
  if (cut <= 0) return [];
  const prefix = currentItem.id.slice(0, cut + 1);
  return itemCatalog.filter((i) => i.id !== currentItem.id && i.id.startsWith(prefix) && i.appearance?.parts?.length)
    .map((i) => ({ itemId: i.id, appearance: i.appearance }));
}

/** The weapon loadout the preview body should hold: the piece itself when it IS a weapon, otherwise the body's own class default. */
function previewWeaponOverride() {
  if (currentItem?.type !== 'weapon' || !currentItem.weaponTypeId) return null;
  const hand = currentItem.slot === 'offHand' ? 'offHand' : 'mainHand';
  return { [hand]: currentItem.weaponTypeId };
}

function rebuildPreview() {
  if (previewMesh) {
    scene.remove(previewMesh);
    previewMesh.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry?.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose();
    });
  }
  gizmo.detach();
  editableMeshes = new Map();

  const bodyId = $('preview-body').value;
  const gender = $('preview-gender').value;
  const worn = [{ itemId: EDIT_ID, appearance: currentItem?.appearance || { parts: [] } }, ...setSiblings()];
  const override = previewWeaponOverride();

  previewMesh = buildPlayerCharacter(characterTypes, bodyId, {
    gender,
    hairStyle: 'short',
    gear: worn,
    // Resolved through the same helper the live client uses, off a synthetic
    // one-item equipment state — so an enchanted sword, and any grip nudge on
    // it, previews here exactly as it renders in the world.
    weaponRender: weaponRenderLoadout(
      { mainHand: override?.mainHand ? EDIT_ID : null, offHand: override?.offHand ? EDIT_ID : null },
      { [EDIT_ID]: currentItem }
    ),
    ...(override ? { equipmentOverride: override } : {}),
  });
  scene.add(previewMesh);

  for (const pivot of previewMesh.children) {
    const role = pivot.userData?.slotRole;
    if (!role) continue;
    for (const child of pivot.children) {
      const id = child.userData?.shapeId;
      // Skip the glow shells: buildAuraShell clones the shape's mesh, so it
      // carries the same shapeId and would shadow the real one in the map.
      if (!id || child.userData.gearAura || !id.startsWith(EDIT_PREFIX)) continue;
      editableMeshes.set(`${role}:${id.slice(EDIT_PREFIX.length)}`, child);
    }
  }
  // The held weapon, so it can be picked in the viewport and dragged. Found by
  // walking the hand attach points rather than by index: which hand a weapon
  // lands in depends on its type (a shield goes to the left), and that decision
  // belongs to src/sim/weaponTypes.js, not to a guess here.
  weaponMesh = null;
  if (currentItem?.type === 'weapon') {
    previewMesh.traverse((o) => {
      if (!weaponMesh && o.userData?.weaponTypeId) weaponMesh = o;
    });
  }
  refreshEmitterBox();
  if (selectedShapeKey === WEAPON_KEY && weaponMesh) gizmo.attach(weaponMesh);
  else if (selectedShapeKey && editableMeshes.has(selectedShapeKey)) gizmo.attach(editableMeshes.get(selectedShapeKey));
  refreshHideList();
  refreshGripFields();
}

// --- The item being edited --------------------------------------------------

function blankItem() {
  return {
    id: '', name: '', type: 'armor', slot: 'head', armorType: 'plate',
    rarity: 'common', description: '', tintColor: 0x8a8f99, sellPrice: 10,
    statModifiers: [],
    // Pre-filled with the standard coverage for the starting slot rather than
    // left empty: a new piece that covers nothing lands ON TOP of the class
    // outfit and z-fights, and "why does my armor flicker" is not a good first
    // experience of this tool.
    appearance: { parts: [], hideBodyShapes: defaultCoverageFor('head', { enclosed: true }), glow: null },
  };
}

/** The parts array for a role, created on demand. Empty roles are pruned on save so a piece doesn't carry six empty buckets around. */
function partFor(role) {
  const appearance = (currentItem.appearance ||= { parts: [] });
  appearance.parts ||= [];
  let part = appearance.parts.find((p) => p.role === role);
  if (!part) { part = { role, shapes: [] }; appearance.parts.push(part); }
  return part;
}

function shapesFor(role) {
  return currentItem?.appearance?.parts?.find((p) => p.role === role)?.shapes || [];
}

function selectedShape() {
  if (!selectedShapeKey) return null;
  const [role, ...rest] = selectedShapeKey.split(':');
  const id = rest.join(':');
  return shapesFor(role).find((s) => s.id === id) || null;
}

/** Read the gizmo's result off the mesh and back into the shape descriptor. Degrees out, radians in — the schema is authored in degrees everywhere (src/sim/creatureTypeDefs.js's ShapeDef). */
function commitGizmoTransform() {
  if (selectedShapeKey === WEAPON_KEY && weaponMesh) return commitWeaponGrip();
  const shape = selectedShape();
  const mesh = selectedShapeKey && editableMeshes.get(selectedShapeKey);
  if (!shape || !mesh) return;
  shape.position = { x: round(mesh.position.x), y: round(mesh.position.y), z: round(mesh.position.z) };
  shape.scale = { x: round(mesh.scale.x), y: round(mesh.scale.y), z: round(mesh.scale.z) };
  shape.rotation = {
    x: round(THREE.MathUtils.radToDeg(mesh.rotation.x), 1),
    y: round(THREE.MathUtils.radToDeg(mesh.rotation.y), 1),
    z: round(THREE.MathUtils.radToDeg(mesh.rotation.z), 1),
  };
  refreshShapeProps();
  rebuildPreview();
}
const round = (v, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;

/**
 * Read a dragged weapon back into the item's grip offset.
 *
 * The offset is stored RELATIVE to the weapon type's own grip, not as an
 * absolute transform: the type's grip (src/sim/weaponTypes.js) is what makes a
 * fist close around a hilt correctly on every body in the game, and it is
 * guarded to stay a nudge. Baking an absolute pose here would silently opt this
 * item out of any future correction to that shared grip.
 */
function commitWeaponGrip() {
  const def = getWeaponTypeDef(currentItem.weaponTypeId);
  if (!def) return;
  const base = def.grip;
  const offset = (currentItem.appearance ??= { parts: [] }).gripOffset ?? {};
  offset.position = {
    x: round(weaponMesh.position.x - base.position.x),
    y: round(weaponMesh.position.y - base.position.y),
    z: round(weaponMesh.position.z - base.position.z),
  };
  offset.rotationDeg = {
    x: round(THREE.MathUtils.radToDeg(weaponMesh.rotation.x) - base.rotationDeg.x, 1),
    y: round(THREE.MathUtils.radToDeg(weaponMesh.rotation.y) - base.rotationDeg.y, 1),
    z: round(THREE.MathUtils.radToDeg(weaponMesh.rotation.z) - base.rotationDeg.z, 1),
  };
  offset.scale = round(weaponMesh.scale.x, 2);
  currentItem.appearance.gripOffset = offset;
  refreshGripFields();
  rebuildPreview();
}

function refreshGripFields() {
  const isWeapon = currentItem?.type === 'weapon';
  $('grip-section').style.display = isWeapon ? '' : 'none';
  if (!isWeapon) return;
  const o = currentItem.appearance?.gripOffset || {};
  const p = o.position || {}, r = o.rotationDeg || {};
  $('grip-px').value = p.x ?? 0; $('grip-py').value = p.y ?? 0; $('grip-pz').value = p.z ?? 0;
  $('grip-rx').value = r.x ?? 0; $('grip-ry').value = r.y ?? 0; $('grip-rz').value = r.z ?? 0;
  $('grip-scale').value = o.scale ?? 1;
}

function readGripFields() {
  const appearance = (currentItem.appearance ??= { parts: [] });
  appearance.gripOffset = {
    position: { x: num($('grip-px')), y: num($('grip-py')), z: num($('grip-pz')) },
    rotationDeg: { x: num($('grip-rx')), y: num($('grip-ry')), z: num($('grip-rz')) },
    scale: num($('grip-scale'), 1),
  };
  rebuildPreview();
}

// --- Panel: catalog ---------------------------------------------------------

/** Only weapon/armor rows — this page has no UI for a potion, and showing one would invite editing it here and losing its usageConfig. */
function equipmentRows() {
  const q = catalogFilter.trim().toLowerCase();
  return itemCatalog
    .filter((i) => i.type === 'weapon' || i.type === 'armor')
    .filter((i) => !q || i.id.toLowerCase().includes(q) || (i.name || '').toLowerCase().includes(q));
}

function refreshCatalogList() {
  const rows = equipmentRows();
  $('catalog-count').textContent = rows.length;
  $('catalog-list').innerHTML = rows.map((i) => `
    <div class="entry${i.id === editingExistingId ? ' active' : ''}" data-item="${i.id}">
      <span>${escapeHtml(i.name || i.id)}
        <span class="meta">${i.slot || i.type}${i.appearance?.parts?.length ? ' · 3D' : ''}${i.appearance?.glow ? ' ✦' : ''}</span>
      </span>
    </div>`).join('') || '<div class="entry"><span class="meta">no equipment yet</span></div>';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Panel: item fields -----------------------------------------------------

function refreshItemFields() {
  const it = currentItem;
  $('item-id').value = it.id || '';
  $('item-id').disabled = !!editingExistingId; // the id is the key everything else (loot tables, recipes, merchant stock) references — renaming it here would orphan them silently
  $('item-name').value = it.name || '';
  $('item-type').value = it.type;
  $('item-slot').value = it.slot || (it.type === 'weapon' ? 'mainHand' : 'head');
  $('item-armor-type').value = it.armorType || ARMOR_TYPES[0];
  $('item-weapon-type').value = it.weaponTypeId || WEAPON_TYPES[0].id;
  $('item-rarity').value = it.rarity || 'common';
  $('item-sell-price').value = it.sellPrice ?? 0;
  $('item-tint').value = hexToInput(it.tintColor);
  $('item-description').value = it.description || '';
  const starterClass = it.starterForClasses?.[0] || '';
  $('item-starter').checked = !!starterClass;
  if (starterClass) $('item-starter-class').value = starterClass;

  const isWeapon = it.type === 'weapon';
  $('armor-type-wrap').style.display = isWeapon ? 'none' : '';
  $('weapon-type-wrap').style.display = isWeapon ? '' : 'none';
  // A weapon's mesh comes from the procedural catalog, so there is nothing to
  // sculpt: the whole shape editor is replaced by Grip + Enchantment for it.
  $('appearance-section').style.display = isWeapon ? 'none' : '';
  $('appearance-hint').textContent =
    `Shapes are placed in each body part's own space. Suggested for ${it.slot}: ${(SUGGESTED_ROLES_FOR_SLOT[it.slot] || []).join(', ') || '—'}.`;
}

/** Every field the form owns, read back onto the working item. Called on any input, so the preview and the saved row can never disagree with what's on screen. */
function readItemFields() {
  const it = currentItem;
  if (!editingExistingId) it.id = $('item-id').value.trim();
  it.name = $('item-name').value;
  it.type = $('item-type').value;
  it.slot = $('item-slot').value;
  it.rarity = $('item-rarity').value;
  it.sellPrice = num($('item-sell-price'), 0);
  it.tintColor = inputToHex($('item-tint').value);
  it.description = $('item-description').value;
  if (it.type === 'weapon') { it.weaponTypeId = $('item-weapon-type').value; delete it.armorType; }
  else { it.armorType = $('item-armor-type').value; delete it.weaponTypeId; }
  if ($('item-starter').checked) it.starterForClasses = [$('item-starter-class').value];
  else delete it.starterForClasses;
}

// --- Panel: stat modifiers --------------------------------------------------

function refreshStatMods() {
  const mods = currentItem.statModifiers || [];
  $('stat-mod-list').innerHTML = mods.map((m, i) => `
    <div class="modrow">
      <select data-mod-stat="${i}">${ITEM_STAT_IDS.map((s) => `<option value="${s}"${s === m.stat ? ' selected' : ''}>${s}</option>`).join('')}</select>
      <input type="number" step="0.5" data-mod-value="${i}" value="${m.value}" />
      <button data-mod-remove="${i}" class="danger">✕</button>
    </div>`).join('');
}

// --- Panel: appearance ------------------------------------------------------

function refreshRoleTabs() {
  const suggested = SUGGESTED_ROLES_FOR_SLOT[currentItem.slot] || [];
  $('role-tabs').innerHTML = GEAR_ATTACH_ROLES.map((role) => {
    const cls = [
      role === activeRole ? 'active' : '',
      shapesFor(role).length ? 'has-shapes' : '',
      suggested.includes(role) ? 'suggested' : '',
    ].filter(Boolean).join(' ');
    return `<button class="${cls}" data-role="${role}">${role}${shapesFor(role).length ? ` (${shapesFor(role).length})` : ''}</button>`;
  }).join('');
}

function refreshShapeList() {
  const shapes = shapesFor(activeRole);
  $('shape-list').innerHTML = shapes.map((s) => `
    <div class="entry${`${activeRole}:${s.id}` === selectedShapeKey ? ' active' : ''}" data-shape="${escapeHtml(s.id)}">
      <span>${escapeHtml(s.id)} <span class="meta">${s.kind}</span></span>
    </div>`).join('') || '<div class="entry"><span class="meta">no shapes on this body part</span></div>';
  refreshShapeProps();
}

function refreshShapeProps() {
  const shape = selectedShape();
  $('shape-props').style.display = shape ? '' : 'none';
  if (!shape) return;
  const p = shape.position || {}, s = shape.scale || {};
  const r = typeof shape.rotation === 'object' ? shape.rotation : { x: 0, y: shape.rotation || 0, z: 0 };
  $('sp-kind').value = shape.kind;
  $('sp-px').value = p.x ?? 0; $('sp-py').value = p.y ?? 0; $('sp-pz').value = p.z ?? 0;
  $('sp-sx').value = s.x ?? 1; $('sp-sy').value = s.y ?? 1; $('sp-sz').value = s.z ?? 1;
  $('sp-rx').value = r.x ?? 0; $('sp-ry').value = r.y ?? 0; $('sp-rz').value = r.z ?? 0;
  $('sp-color').value = hexToInput(shape.color);
  $('sp-opacity').value = shape.opacity ?? 1;
  $('sp-metalness').value = shape.metalness ?? '';
  $('sp-roughness').value = shape.roughness ?? '';
}

function readShapeProps() {
  const shape = selectedShape();
  if (!shape) return;
  shape.kind = $('sp-kind').value;
  shape.position = { x: num($('sp-px')), y: num($('sp-py')), z: num($('sp-pz')) };
  shape.scale = { x: num($('sp-sx'), 1), y: num($('sp-sy'), 1), z: num($('sp-sz'), 1) };
  shape.rotation = { x: num($('sp-rx')), y: num($('sp-ry')), z: num($('sp-rz')) };
  shape.color = inputToHex($('sp-color').value);
  shape.opacity = num($('sp-opacity'), 1);
  for (const [field, el] of [['metalness', $('sp-metalness')], ['roughness', $('sp-roughness')]]) {
    if (el.value === '') delete shape[field]; else shape[field] = num(el, 0);
  }
  rebuildPreview();
}

/** Every shape id on the preview BODY (not the gear) — what a piece may declare it covers up. Read off the resolved body rather than a hardcoded list, so a hand-tuned class body's own ids show up here too. */
function refreshHideList() {
  const bodyId = $('preview-body').value;
  const body = classBody(characterTypes, bodyId, $('preview-gender').value, undefined);
  const hidden = new Set(currentItem?.appearance?.hideBodyShapes || []);
  const ids = [];
  for (const slot of body?.slots || []) for (const s of slot.shapes) ids.push({ role: slot.role, id: s.id });
  // Hair is a live choice, not part of the body row (playerCharacter.js swaps
  // it in per player), so its ids never appear above — listed explicitly, since
  // "helm covers the hair" is the single most common thing anyone wants here.
  for (const id of HAIR_SHAPE_IDS) {
    if (!ids.some((e) => e.id === id)) ids.push({ role: 'head', id });
  }
  $('hide-list').innerHTML = ids.map(({ role, id }) => `
    <div class="entry" data-hide="${escapeHtml(id)}">
      <span><input type="checkbox" ${hidden.has(id) ? 'checked' : ''} data-hide-cb="${escapeHtml(id)}" />
        ${escapeHtml(id)} <span class="meta">${role}</span></span>
    </div>`).join('');
}

// --- Panel: glow ------------------------------------------------------------

function refreshGlowFields() {
  // Weapons and shields only — see the GLOW_MODES doc comment in
  // gearVisuals.js. Hidden rather than disabled on armor: a greyed-out
  // enchantment panel invites someone to go looking for how to un-grey it.
  const isWeapon = currentItem?.type === 'weapon';
  $('glow-section').style.display = isWeapon ? '' : 'none';
  const g = currentItem?.appearance?.glow;
  $('glow-mode').value = g?.mode || 'none';
  $('glow-style').value = g?.style || 'motes';
  $('glow-color').value = hexToInput(g?.color ?? 0xffd479);
  $('glow-secondary').value = hexToInput(g?.secondaryColor ?? g?.color ?? 0xff9a2a);
  $('glow-intensity').value = g?.intensity ?? 0.7;
  $('glow-density').value = g?.density ?? 28;
  $('glow-size').value = g?.size ?? 0.075;
  $('glow-speed').value = g?.speed ?? 1;
  const o = g?.offset || {}, e = g?.extent || {};
  $('glow-ox').value = o.x ?? 0; $('glow-oy').value = o.y ?? 0; $('glow-oz').value = o.z ?? 0;
  // Blank, not 0, for an unset axis: the placeholder then reads "auto", which
  // is what an unset axis actually does (measure it from the weapon).
  $('glow-ex').value = e.x || ''; $('glow-ey').value = e.y || ''; $('glow-ez').value = e.z || '';
}

function readGlowFields() {
  const mode = $('glow-mode').value;
  const appearance = (currentItem.appearance ||= { parts: [] });
  if (mode === 'none') {
    appearance.glow = null;
  } else {
    appearance.glow = {
      mode,
      style: $('glow-style').value,
      color: inputToHex($('glow-color').value),
      secondaryColor: inputToHex($('glow-secondary').value),
      intensity: num($('glow-intensity'), 0.7),
      density: Math.round(num($('glow-density'), 28)),
      size: num($('glow-size'), 0.075),
      speed: num($('glow-speed'), 1),
      offset: { x: num($('glow-ox')), y: num($('glow-oy')), z: num($('glow-oz')) },
      extent: { x: num($('glow-ex')), y: num($('glow-ey')), z: num($('glow-ez')) },
    };
  }
  rebuildPreview();
}

// --- Load / save ------------------------------------------------------------

function loadItem(item) {
  currentItem = structuredClone(item);
  currentItem.appearance ||= { parts: [], hideBodyShapes: [], glow: null };
  currentItem.appearance.parts ||= [];
  currentItem.statModifiers ||= [];
  editingExistingId = item.id || null;
  selectedShapeKey = null;
  const suggested = SUGGESTED_ROLES_FOR_SLOT[currentItem.slot] || [];
  activeRole = currentItem.appearance.parts[0]?.role || suggested[0] || 'torso';
  refreshEverything();
}

function refreshEverything() {
  refreshItemFields();
  refreshStatMods();
  refreshRoleTabs();
  refreshShapeList();
  refreshGlowFields();
  refreshGripFields();
  refreshCatalogList();
  rebuildPreview();
}

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg;
  el.className = isError ? 'err' : '';
}

/** Strip the working copy back down to what belongs on disk: no empty part buckets, no empty arrays, no null glow. */
function itemForSave() {
  const out = structuredClone(currentItem);
  const appearance = out.appearance || {};

  appearance.parts = (appearance.parts || []).filter((p) => p.shapes?.length);
  if (!appearance.parts.length) delete appearance.parts;
  if (!appearance.hideBodyShapes?.length) delete appearance.hideBodyShapes;
  if (!appearance.glow) delete appearance.glow;
  if (isDefaultGrip(appearance.gripOffset)) delete appearance.gripOffset;
  // glow and gripOffset are weapon-only. An armor row carrying either is
  // rejected by parseAuthoredItems, and it's easy to end up with one by
  // switching an item's type after tuning it as a weapon.
  if (out.type !== 'weapon') { delete appearance.glow; delete appearance.gripOffset; }

  // "Is anything left?" asked of the object itself rather than of a
  // hand-written list of its fields.
  //
  // That list is what silently ate a saved grip: it named parts,
  // hideBodyShapes and glow, `gripOffset` was added to the schema later, and a
  // weapon whose only edit was a grip fix therefore looked empty and had its
  // whole appearance dropped on the way to the server. The edit survived right
  // up to the save and vanished on reload. Asking Object.keys can't fall out of
  // date the next time a field is added.
  if (!Object.keys(appearance).length) delete out.appearance;
  else out.appearance = appearance;

  if (!out.statModifiers?.length) delete out.statModifiers;
  if (!out.description) delete out.description;
  return out;
}

/** An untouched grip — all zeros and scale 1 — is the absence of an override, not an override that happens to do nothing. Dropped so a weapon nobody nudged doesn't carry a no-op object around forever. */
function isDefaultGrip(grip) {
  if (!grip) return true;
  const zeroish = (v) => !v || Math.abs(v) < 1e-9;
  const p = grip.position || {}, r = grip.rotationDeg || {};
  return [p.x, p.y, p.z, r.x, r.y, r.z].every(zeroish)
    && (grip.scale === undefined || Math.abs(grip.scale - 1) < 1e-9);
}

async function postCatalog() {
  const res = await fetch('/api/items', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(itemCatalog),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `server responded ${res.status}`);
}

async function save() {
  readItemFields();
  const item = itemForSave();
  if (!item.id) return setStatus('An item id is required.', true);
  if (!item.name) return setStatus('An item name is required.', true);

  const idx = itemCatalog.findIndex((i) => i.id === item.id);
  if (idx >= 0 && !editingExistingId) {
    return setStatus(`An item with id "${item.id}" already exists — open it from the catalog instead.`, true);
  }
  const before = itemCatalog.slice();
  if (idx >= 0) itemCatalog[idx] = item; else itemCatalog.push(item);
  try {
    await postCatalog();
    editingExistingId = item.id;
    setStatus(`Saved "${item.name}" ✓ — it's now droppable, sellable and craftable like any other item.`);
    refreshItemFields();
    refreshCatalogList();
  } catch (err) {
    itemCatalog = before; // never leave the in-memory catalog ahead of what's on disk
    setStatus(`Save failed: ${err.message}`, true);
  }
}

// --- Wiring -----------------------------------------------------------------

function fillSelect(el, values, labelFn = (v) => v) {
  el.innerHTML = values.map((v) => `<option value="${v}">${labelFn(v)}</option>`).join('');
}

function wire() {
  fillSelect($('item-slot'), VISUAL_SLOT_ORDER.filter((s) => EQUIP_SLOTS.includes(s)));
  fillSelect($('item-armor-type'), ARMOR_TYPES);
  $('item-weapon-type').innerHTML = WEAPON_TYPES.map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
  fillSelect($('item-rarity'), ITEM_RARITIES);
  fillSelect($('shape-kind'), GEAR_SHAPE_KINDS);
  fillSelect($('sp-kind'), GEAR_SHAPE_KINDS);
  fillSelect($('glow-mode'), GLOW_MODES);
  fillSelect($('glow-style'), GLOW_STYLES);
  $('preset-set').innerHTML = EQUIPMENT_PRESET_SETS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
  $('glow-presets').innerHTML = GLOW_PRESETS.map((g) => `<button data-glow-preset="${g.id}">${g.name}</button>`).join('');

  // Item fields: any change re-reads the whole form, then rebuilds. The type/
  // slot switch also re-derives which body roles are suggested.
  for (const id of ['item-id', 'item-name', 'item-type', 'item-slot', 'item-armor-type', 'item-weapon-type',
    'item-rarity', 'item-sell-price', 'item-tint', 'item-description', 'item-starter', 'item-starter-class']) {
    $(id).addEventListener('change', () => { readItemFields(); refreshItemFields(); refreshRoleTabs(); rebuildPreview(); });
    $(id).addEventListener('input', () => { readItemFields(); });
  }

  $('catalog-filter').addEventListener('input', (e) => { catalogFilter = e.target.value; refreshCatalogList(); });
  $('catalog-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-item]')?.dataset.item;
    if (!id) return;
    const item = itemCatalog.find((i) => i.id === id);
    if (item) { loadItem(item); setStatus(''); }
  });

  $('new-btn').addEventListener('click', () => { loadItem(blankItem()); setStatus('New piece — give it an id and a name.'); });
  $('dup-btn').addEventListener('click', () => {
    if (!currentItem) return;
    const copy = itemForSave();
    copy.id = `${copy.id || 'eq'}_copy`;
    copy.name = `${copy.name} (copy)`;
    delete copy.starterForClasses; // a duplicate must not silently become a SECOND starter piece for the same class
    editingExistingId = null;
    loadItem(copy);
    editingExistingId = null;
    refreshItemFields();
    setStatus('Duplicated — rename it, then save.');
  });
  $('del-btn').addEventListener('click', async () => {
    if (!editingExistingId) return setStatus('Nothing saved to delete.', true);
    if (!confirm(`Delete "${currentItem.name || editingExistingId}" from the item catalog?`)) return;
    const before = itemCatalog.slice();
    itemCatalog = itemCatalog.filter((i) => i.id !== editingExistingId);
    try {
      await postCatalog();
      setStatus('Deleted.');
      loadItem(blankItem());
    } catch (err) {
      itemCatalog = before;
      setStatus(`Delete failed: ${err.message}`, true);
    }
  });

  // Presets
  $('preset-load-set').addEventListener('click', async () => {
    const set = EQUIPMENT_PRESET_SETS.find((s) => s.id === $('preset-set').value);
    if (!set) return;
    const before = itemCatalog.slice();
    let added = 0;
    for (const item of expandPresetSet(set)) {
      const idx = itemCatalog.findIndex((i) => i.id === item.id);
      if (idx >= 0) itemCatalog[idx] = item; else { itemCatalog.push(item); added++; }
    }
    try {
      await postCatalog();
      setStatus(`${set.name}: ${added} new piece(s) added, the rest reset to the preset.`);
      refreshCatalogList();
    } catch (err) {
      itemCatalog = before;
      setStatus(`Could not add the set: ${err.message}`, true);
    }
  });
  $('preset-load-piece').addEventListener('click', () => {
    const set = EQUIPMENT_PRESET_SETS.find((s) => s.id === $('preset-set').value);
    if (!set || !currentItem) return;
    // Matched by SLOT, not by index: copying the look of the set's helm onto
    // the boots being edited would be nonsense, and silently placing head
    // shapes on a leg role is exactly the kind of "it did something" that
    // wastes an hour.
    const donor = expandPresetSet(set).find((i) => i.slot === currentItem.slot);
    if (!donor?.appearance) return setStatus(`${set.name} has no ${currentItem.slot} piece to copy.`, true);
    currentItem.appearance = structuredClone(donor.appearance);
    activeRole = currentItem.appearance.parts[0]?.role || activeRole;
    selectedShapeKey = null;
    refreshEverything();
    setStatus(`Copied the look of ${donor.name}. The stats and id are still yours.`);
  });

  // Stat modifiers
  $('stat-mod-add').addEventListener('click', () => {
    (currentItem.statModifiers ||= []).push({ stat: ITEM_STAT_IDS[0], value: 1 });
    refreshStatMods();
  });
  $('stat-mod-list').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.modStat !== undefined) currentItem.statModifiers[+t.dataset.modStat].stat = t.value;
    if (t.dataset.modValue !== undefined) currentItem.statModifiers[+t.dataset.modValue].value = parseFloat(t.value) || 0;
  });
  $('stat-mod-list').addEventListener('click', (e) => {
    const i = e.target.dataset.modRemove;
    if (i === undefined) return;
    currentItem.statModifiers.splice(+i, 1);
    refreshStatMods();
  });

  // Appearance
  $('role-tabs').addEventListener('click', (e) => {
    const role = e.target.closest('[data-role]')?.dataset.role;
    if (!role) return;
    activeRole = role;
    selectedShapeKey = null;
    gizmo.detach();
    refreshRoleTabs();
    refreshShapeList();
  });
  $('shape-add').addEventListener('click', () => {
    const kind = $('shape-kind').value;
    const part = partFor(activeRole);
    // Unique within the role only — a mirrored pair legitimately shares ids
    // across armL/armR, and gearShapeId namespaces per ITEM anyway.
    let n = 1;
    while (part.shapes.some((s) => s.id === `${kind}${n}`)) n++;
    const id = `${kind}${n}`;
    part.shapes.push({
      id, kind,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 0.2, y: 0.2, z: 0.2 },
      rotation: { x: 0, y: 0, z: 0 },
      color: currentItem.tintColor ?? 0x8a8f99,
    });
    selectedShapeKey = `${activeRole}:${id}`;
    refreshRoleTabs();
    refreshShapeList();
    rebuildPreview();
  });
  $('shape-list').addEventListener('click', (e) => {
    const id = e.target.closest('[data-shape]')?.dataset.shape;
    if (!id) return;
    selectedShapeKey = `${activeRole}:${id}`;
    const mesh = editableMeshes.get(selectedShapeKey);
    if (mesh) gizmo.attach(mesh);
    refreshShapeList();
  });
  for (const id of ['sp-kind', 'sp-px', 'sp-py', 'sp-pz', 'sp-sx', 'sp-sy', 'sp-sz',
    'sp-rx', 'sp-ry', 'sp-rz', 'sp-color', 'sp-opacity', 'sp-metalness', 'sp-roughness']) {
    $(id).addEventListener('change', readShapeProps);
  }
  $('sp-delete').addEventListener('click', () => {
    const shape = selectedShape();
    if (!shape) return;
    const part = partFor(activeRole);
    part.shapes = part.shapes.filter((s) => s !== shape);
    selectedShapeKey = null;
    gizmo.detach();
    refreshRoleTabs();
    refreshShapeList();
    rebuildPreview();
  });
  $('sp-mirror').addEventListener('click', () => {
    const other = mirrorRoleOf(activeRole);
    if (!other) return setStatus(`${activeRole} has no left/right counterpart to mirror onto.`, true);
    // The WHOLE role is mirrored, not just the selected shape: a glove is a
    // pair, and mirroring one plate at a time is how you end up with a left
    // hand missing the knuckle guard.
    partFor(other).shapes = mirrorGearShapes(shapesFor(activeRole));
    refreshRoleTabs();
    rebuildPreview();
    setStatus(`Mirrored ${shapesFor(activeRole).length} shape(s) onto ${other}.`);
  });

  $('hide-list').addEventListener('change', (e) => {
    const id = e.target.dataset.hideCb;
    if (!id) return;
    const appearance = (currentItem.appearance ||= { parts: [] });
    const list = new Set(appearance.hideBodyShapes || []);
    if (e.target.checked) list.add(id); else list.delete(id);
    appearance.hideBodyShapes = [...list];
    rebuildPreview();
  });

  // Glow
  $('glow-presets').addEventListener('click', (e) => {
    const id = e.target.dataset.glowPreset;
    if (!id) return;
    const preset = GLOW_PRESETS.find((g) => g.id === id);
    (currentItem.appearance ||= { parts: [] }).glow = preset.glow ? structuredClone(preset.glow) : null;
    refreshGlowFields();
    rebuildPreview();
  });
  for (const id of ['glow-mode', 'glow-style', 'glow-color', 'glow-secondary', 'glow-intensity',
    'glow-density', 'glow-size', 'glow-speed', 'glow-ox', 'glow-oy', 'glow-oz', 'glow-ex', 'glow-ey', 'glow-ez']) {
    $(id).addEventListener('change', readGlowFields);
  }
  $('glow-box-reset').addEventListener('click', () => {
    const g = currentItem?.appearance?.glow;
    if (!g) return;
    delete g.offset;
    delete g.extent;
    refreshGlowFields();
    rebuildPreview();
    setStatus('Emission box fitted back to the weapon.');
  });
  $('preview-emitter').addEventListener('change', rebuildPreview);

  // Grip
  for (const id of ['grip-px', 'grip-py', 'grip-pz', 'grip-rx', 'grip-ry', 'grip-rz', 'grip-scale']) {
    $(id).addEventListener('change', readGripFields);
  }
  $('grip-reset').addEventListener('click', () => {
    if (currentItem?.appearance) delete currentItem.appearance.gripOffset;
    refreshGripFields();
    rebuildPreview();
    setStatus("Grip reset — this item now sits exactly where its weapon type says.");
  });

  // Coverage
  $('hide-defaults').addEventListener('click', () => {
    const appearance = (currentItem.appearance ??= { parts: [] });
    // Head pieces default to enclosed (hair covered) because that is what every
    // shipped head piece does and what avoids fighting hair geometry; untick
    // the hair rows afterwards for an open-topped piece.
    appearance.hideBodyShapes = defaultCoverageFor(currentItem.slot, { enclosed: currentItem.slot === 'head' });
    refreshHideList();
    rebuildPreview();
    setStatus(`Set to the standard ${currentItem.slot} coverage (${appearance.hideBodyShapes.length} shapes).`);
  });

  // Preview bar
  for (const id of ['preview-body', 'preview-gender', 'preview-set']) {
    $(id).addEventListener('change', rebuildPreview);
  }

  $('save-btn').addEventListener('click', save);

  // Viewport selection + gizmo hotkeys, matching the Character/Monster builders.
  canvas.addEventListener('pointerdown', (e) => {
    if (gizmo.dragging) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    // The weapon is tested as a whole group (recursive), because unlike a gear
    // shape it is many sub-meshes that move together — you grab "the sword",
    // not its crossguard.
    if (weaponMesh && raycaster.intersectObject(weaponMesh, true).length) {
      selectedShapeKey = WEAPON_KEY;
      gizmo.attach(weaponMesh);
      setStatus("Weapon selected — G/R/S to move, rotate or scale it. Saved as this item's grip offset.");
      return;
    }
    const hits = raycaster.intersectObjects([...editableMeshes.values()], false);
    if (!hits.length) return;
    for (const [key, mesh] of editableMeshes) {
      if (mesh !== hits[0].object) continue;
      const [role] = key.split(':');
      activeRole = role;
      selectedShapeKey = key;
      gizmo.attach(mesh);
      refreshRoleTabs();
      refreshShapeList();
      break;
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'g' || e.key === 'G') gizmo.setMode('translate');
    if (e.key === 'r' || e.key === 'R') gizmo.setMode('rotate');
    if (e.key === 's' || e.key === 'S') gizmo.setMode('scale');
    if (e.key === 'Escape') { gizmo.detach(); selectedShapeKey = null; refreshShapeList(); }
  });
}

// --- Boot -------------------------------------------------------------------
(async function boot() {
  wire();
  const [types, items] = await Promise.all([
    fetch('/api/character-types').then((r) => r.json()).catch(() => []),
    fetch('/api/items').then((r) => r.json()).catch(() => []),
  ]);
  characterTypes = types;
  itemCatalog = items;

  const bodies = selectableBodies(characterTypes);
  $('preview-body').innerHTML = bodies.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  // Class rows only — a starter kit is granted per CLASS (see grantStarterKit
  // in server/index.js), so offering an NPC prefab here would author a flag
  // nothing could ever act on.
  $('item-starter-class').innerHTML = bodies.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');

  const firstEquipment = equipmentRows()[0];
  loadItem(firstEquipment || blankItem());
  if (!firstEquipment) setStatus('No equipment in the catalog yet — add a preset set, or build a piece from scratch.');
  animate();
})();
