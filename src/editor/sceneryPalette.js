// src/editor/sceneryPalette.js
// The scenery picker: category tabs across the top, a grid of live-rendered
// thumbnails below. Modelled on the reference screenshot's "Small Plants" panel.
//
// The palette is generated entirely from the catalog (src/sim/propTypes.js), so
// adding a prop type gives it a slot here for free — there is no hand-maintained
// list of buttons to forget to update. Authored Object Builder objects AND
// uploaded models are injected on top via `extraItems`, each carrying its own
// `category` so they land in the same tab a built-in prop of that category would.
//
// Thumbnails are RENDERED, not authored: a tiny offscreen WebGL renderer builds
// each prop once and caches the data URL. That means a thumbnail can never drift
// from what actually gets placed, which is the same reason the Monster Builder
// renders its preset thumbnails rather than shipping images.
import * as THREE from 'three';
import { PROP_CATEGORIES, propTypesIn } from '../sim/propTypes.js';
import { buildProp } from '../generators/props.js';
import { buildPropPlaceholder, COVER_PROP_TYPES } from '../render/scene.js';
import { isModelLoaded } from '../generators/modelLoader.js';

const THUMB_SIZE = 92;
const THUMB_SEED = 4242; // one fixed seed, so a type's thumbnail is stable across sessions

let thumbRenderer = null;
let thumbScene = null;
let thumbCamera = null;
let thumbCanvas = null;
const thumbCache = new Map();

/** Lazily built: the palette is the only thing that needs an offscreen renderer. */
function initThumbnailRig() {
  if (thumbRenderer) return;
  thumbCanvas = document.createElement('canvas');
  thumbRenderer = new THREE.WebGLRenderer({ canvas: thumbCanvas, antialias: true, alpha: true });
  thumbRenderer.setSize(THUMB_SIZE, THUMB_SIZE);
  thumbScene = new THREE.Scene();
  thumbScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(2, 3, 2);
  thumbScene.add(sun);
  thumbCamera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
}

/** Frames `mesh` to fit and rasterizes it to a data URL. Does not touch the cache. */
function renderThumb(mesh) {
  thumbScene.add(mesh);
  mesh.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const size = Math.max(0.35, box.getSize(new THREE.Vector3()).length());
  // Frame from a low three-quarter angle: a straight-down view makes a tree and
  // a bush look identical, which is exactly what a picker must not do.
  thumbCamera.position.set(center.x + size * 0.55, center.y + size * 0.45, center.z + size * 0.8);
  thumbCamera.lookAt(center);
  thumbCamera.updateProjectionMatrix();
  thumbRenderer.render(thumbScene, thumbCamera);

  const url = thumbCanvas.toDataURL('image/png');
  thumbScene.remove(mesh);
  return url;
}

/**
 * Render one prop type (or custom object, or imported model) to a data URL.
 * Cached forever for built-ins/custom objects — those are deterministic in
 * their seed. An imported model is a special case: while it's still loading,
 * `buildProp('model', ...)` hands back a wireframe placeholder box, so the
 * render is shown but deliberately NOT cached — the next call re-renders
 * (and picks up the real mesh once it's loaded) instead of a placeholder
 * getting stuck in the cache forever. Once `isModelLoaded(modelId)` is true,
 * it caches exactly like everything else.
 */
export function propThumbnail(typeId, objectDef = null, modelId = null) {
  initThumbnailRig();
  if (modelId) {
    const loaded = isModelLoaded(modelId);
    const cacheKey = `model:${modelId}`;
    if (loaded && thumbCache.has(cacheKey)) return thumbCache.get(cacheKey);
    const url = renderThumb(buildProp('model', THUMB_SEED, { modelId }));
    if (loaded) thumbCache.set(cacheKey, url);
    return url;
  }
  const cacheKey = objectDef ? `custom:${objectDef.id}` : typeId;
  if (thumbCache.has(cacheKey)) return thumbCache.get(cacheKey);
  const url = renderThumb(buildThumbMesh(typeId, objectDef));
  thumbCache.set(cacheKey, url);
  return url;
}

/**
 * props.js has no builder that matches what the dense grass/flower presets
 * actually place any more — those come from the instanced cover meshes in
 * render/grassCover.js and render/flowerCover.js — so route them through
 * buildPropPlaceholder like every placement path does, and keep the "a
 * thumbnail can't drift from what places" property this palette is built on.
 * The empty `{}` world is a terrain-less one: sampleTerrainHeight returns 0
 * for it, which is what a thumbnail wants anyway.
 */
function buildThumbMesh(typeId, objectDef) {
  if (COVER_PROP_TYPES.has(typeId)) {
    return buildPropPlaceholder({ type: typeId, seed: THUMB_SEED, position: { x: 0, y: 0, z: 0 } }, {});
  }
  return buildProp(typeId, THUMB_SEED, { objectDef });
}

/**
 * Mount a scenery palette into `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   onSelect: (paletteId: string|null) => void,
 *   selected?: string,
 *   extraItems?: () => Array<{id:string, label:string, category:string, kind:'custom'|'model', objectDef?:object, deletable?:boolean}>,
 *   onDeleteModel?: (modelId: string) => void,
 *   onRemeasureModel?: (modelId: string) => void,
 * }} options `extraItems` injects the Object Builder's saved objects and the
 *   uploaded-model catalog, each tagged with the category tab it belongs
 *   under. `onSelect(null)` fires when the active cell is clicked again
 *   (toggle off) — callers that have no "unarmed" concept (e.g. the Scatter
 *   brush) can just ignore a null paletteId.
 * @returns {{ setSelected(id:string): void, refresh(): void, selected(): string }}
 */
export function createSceneryPalette(container, { onSelect, selected = 'tree', extraItems = () => [], onDeleteModel = null, onRemeasureModel = null }) {
  let activeCategory = PROP_CATEGORIES[0].id;
  let activeType = selected;

  container.classList.add('scenery-palette');
  const tabs = document.createElement('div');
  tabs.className = 'palette-tabs';
  const grid = document.createElement('div');
  grid.className = 'palette-grid';
  container.append(tabs, grid);

  function renderTabs() {
    tabs.innerHTML = '';
    for (const cat of PROP_CATEGORIES) {
      const b = document.createElement('button');
      b.className = 'palette-tab' + (cat.id === activeCategory ? ' active' : '');
      b.innerHTML = `<span>${cat.icon}</span>${cat.label}`;
      b.title = cat.label;
      b.addEventListener('click', () => { activeCategory = cat.id; renderTabs(); renderGrid(); });
      tabs.appendChild(b);
    }
  }

  function cell(id, label, thumbUrl, opts = {}) {
    const b = document.createElement('button');
    b.className = 'palette-cell' + (id === activeType ? ' active' : '');
    b.dataset.type = id;
    b.title = label;
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = label;
    const cap = document.createElement('span');
    cap.textContent = label;
    b.append(img, cap);
    if (opts.onRemeasure) {
      const rem = document.createElement('span');
      rem.className = 'palette-cell-remeasure';
      rem.title = 'Reload and remeasure footprint/height';
      rem.textContent = '↻';
      rem.addEventListener('click', (e) => { e.stopPropagation(); opts.onRemeasure(); });
      b.appendChild(rem);
    }
    if (opts.onDelete) {
      const del = document.createElement('span');
      del.className = 'palette-cell-delete';
      del.title = 'Delete';
      del.textContent = '✕';
      del.addEventListener('click', (e) => { e.stopPropagation(); opts.onDelete(); });
      b.appendChild(del);
    }
    b.addEventListener('click', () => {
      if (id === activeType) {
        // Click the already-armed cell again to unarm it — lets a caller
        // (Place mode) offer a way to stop placing without picking a
        // different type first.
        activeType = null;
        grid.querySelectorAll('.palette-cell').forEach((c) => c.classList.remove('active'));
        onSelect(null);
        return;
      }
      activeType = id;
      grid.querySelectorAll('.palette-cell').forEach((c) => c.classList.toggle('active', c === b));
      onSelect(id);
    });
    return b;
  }

  function renderGrid() {
    grid.innerHTML = '';
    for (const def of propTypesIn(activeCategory)) {
      // Custom objects and imported models are listed individually below
      // (their own thumbnail per catalog entry, filtered to this category) —
      // 'custom'/'model' themselves are sentinel catalog rows, never shown.
      if (def.id === 'custom' || def.id === 'model') continue;
      grid.appendChild(cell(def.id, def.label, propThumbnail(def.id)));
    }
    for (const item of extraItems()) {
      if (item.category !== activeCategory) continue;
      if (item.kind === 'model') {
        const paletteId = `model:${item.id}`;
        const thumbUrl = propThumbnail('model', null, item.id);
        grid.appendChild(cell(paletteId, item.label, thumbUrl, {
          // `deletable === false` is a folder-dropped asset — see
          // paletteExtraItems in src/editor/main.js. Everything else (an
          // uploaded model, or a caller that doesn't set the flag at all)
          // keeps the delete badge it has always had.
          onDelete: onDeleteModel && item.deletable !== false ? () => onDeleteModel(item.id) : null,
          onRemeasure: onRemeasureModel ? () => onRemeasureModel(item.id) : null,
        }));
      } else {
        const paletteId = `custom:${item.id}`;
        grid.appendChild(cell(paletteId, item.label, propThumbnail('custom', item.objectDef)));
      }
    }
    // The Imported tab is populated entirely from a folder on disk, so an
    // empty one is the normal first-run state and looks identical to a broken
    // one. Say where the files go instead of showing nothing.
    if (!grid.children.length && activeCategory === 'imported') {
      const note = document.createElement('p');
      note.className = 'hint';
      note.style.gridColumn = '1 / -1';
      note.innerHTML = 'Nothing imported yet. Drop a shared asset into <code>src/generators/environment/import/</code> and refresh — it appears here automatically. Takes an Object Builder <b>.json</b> export, a Three.js generator <b>.js</b> module, or a <b>.glb</b>/<b>.gltf</b>/<b>.fbx</b> mesh. See that folder\'s README.';
      grid.appendChild(note);
    }
  }

  renderTabs();
  renderGrid();

  return {
    setSelected(id) {
      activeType = id;
      grid.querySelectorAll('.palette-cell').forEach((c) => c.classList.toggle('active', c.dataset.type === id));
    },
    refresh: renderGrid,
    selected: () => activeType,
  };
}
