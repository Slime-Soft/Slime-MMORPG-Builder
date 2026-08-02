// src/generators/modelLoader.js
// Loads and caches imported models (World Editor "Imported Model" placement,
// CLAUDE.md/roadmap item #11) — FBX and glTF/GLB. Unlike every other
// generator in this project, loading is inherently ASYNC (fetch + parse a
// binary file), so this follows the same pattern src/render/
// groundTextureThemes.js already established for async custom-texture
// uploads: return a placeholder immediately, load in the background, and
// fire a listener once it's ready so the caller can rebuild.
// `buildModelPlaceholder` keeps buildProp/buildPropPlaceholder fully
// synchronous — nothing downstream has to change to accommodate an async
// prop type.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const catalogById = new Map(); // modelId -> catalog entry {id, name, url, importScale, footprintRadius, height}
const loadedById = new Map(); // modelId -> the loaded THREE.Group (never placed directly — always cloned)
const loadingIds = new Set();
const loadListeners = new Set(); // (modelId) => void, fired once per successful load

const fbxLoader = new FBXLoader();
const gltfLoader = new GLTFLoader();

/**
 * Picks a loader by file extension — the only reliable signal we have
 * client-side (no server-side content-sniffing). `.gltf` counts as glTF
 * alongside `.glb`: the folder-drop import path
 * (src/generators/environment/import/) accepts whatever a person exports,
 * and an unpacked .gltf + .bin + textures is a perfectly ordinary export —
 * GLTFLoader resolves those sibling files itself relative to the url.
 */
function isGltf(url) {
  return /\.(glb|gltf)$/i.test(url);
}

/** Populates the id->catalog-entry map from a fetched /api/models response. Safe to call again after an upload to add one more entry. */
export function registerModelCatalog(catalog) {
  for (const entry of catalog) catalogById.set(entry.id, entry);
}

/** Subscribe to "a model finished loading". Returns an unsubscribe function. */
export function onModelLoadedEvent(cb) {
  loadListeners.add(cb);
  return () => loadListeners.delete(cb);
}

export function isModelLoaded(modelId) {
  return loadedById.has(modelId);
}

/** Drops the cached load for a model so the next waitForModels/buildModelPlaceholder call re-fetches and re-parses it from scratch — used by the World Editor's "Remeasure" action, since an already-cached model would otherwise make measureModel keep returning whatever it measured the first time. */
export function forgetLoadedModel(modelId) {
  loadedById.delete(modelId);
  loadingIds.delete(modelId);
}

function loadModel(modelId) {
  const entry = catalogById.get(modelId);
  if (!entry || loadedById.has(modelId) || loadingIds.has(modelId)) return;
  loadingIds.add(modelId);

  const onLoad = (root) => {
    // FBX/glTF exporters disagree on units (centimeters vs meters is the
    // classic split) — rather than guess, importScale is whatever the
    // uploader set (default 1), applied once here so every downstream
    // clone/measurement already reflects it.
    root.scale.setScalar(entry.importScale ?? 1);
    // Strip any lights/cameras baked into the export — a scene exported
    // straight from Blender/Maya often drags its own scene lights along with
    // the mesh, and cloning that into the live game adds a REAL THREE.Light
    // (seen in practice: a PointLight at intensity 1000) that blows out the
    // whole scene's exposure, not just something near the model. Stripped
    // once here on the shared loaded source, so every clone
    // (buildModelPlaceholder) is already clean — no per-instance filtering.
    const toRemove = [];
    root.traverse((obj) => { if (obj.isLight || obj.isCamera) toRemove.push(obj); });
    for (const obj of toRemove) obj.parent?.remove(obj);
    loadedById.set(modelId, root);
    loadingIds.delete(modelId);
    loadListeners.forEach((cb) => cb(modelId));
  };
  const onError = (err) => {
    console.error(`Failed to load model "${modelId}" from ${entry.url}:`, err);
    loadingIds.delete(modelId);
  };

  if (isGltf(entry.url)) {
    gltfLoader.load(
      entry.url,
      (gltf) => {
        // GLTFLoader hands back {scene, animations, ...} — unlike FBXLoader,
        // the loaded group and its animation clips are separate top-level
        // fields, so animations get reattached to .scene here to match the
        // shape the rest of this module (and measureModel/buildModelPlaceholder
        // below) already expects from an FBX load.
        gltf.scene.animations = gltf.animations;
        onLoad(gltf.scene);
      },
      undefined,
      onError
    );
  } else {
    fbxLoader.load(entry.url, onLoad, undefined, onError);
  }
}

function placeholderMesh() {
  // A visibly-a-placeholder wireframe box, not a guess at the real footprint —
  // shown only for the brief window before a model finishes loading (or
  // permanently, if the referenced model failed to load/was deleted).
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x8888aa, wireframe: true, transparent: true, opacity: 0.6 })
  );
  mesh.position.y = 0.5;
  return mesh;
}

/**
 * A ready-to-place clone of a loaded model, or a translucent wireframe box
 * while it's still loading (and kicks off that load if it hasn't started).
 * @param {string} [modelId]
 */
export function buildModelPlaceholder(modelId) {
  if (!modelId) return placeholderMesh();
  const source = loadedById.get(modelId);
  if (!source) {
    loadModel(modelId);
    return placeholderMesh();
  }
  const instance = cloneSkinned(source);
  // Ambient-only: auto-play the first animation clip in a loop, if the
  // source file carries one (a turning windmill, a waving flag) — no
  // gameplay wiring, no ability/combat integration. `updateModelAnimations`
  // (below) advances it.
  if (source.animations && source.animations.length > 0) {
    const mixer = new THREE.AnimationMixer(instance);
    mixer.clipAction(source.animations[0]).play();
    instance.userData.mixer = mixer;
  }
  return instance;
}

/** Advance every placed model instance's animation mixer. Call once per frame with delta seconds. */
export function updateModelAnimations(root, dt) {
  root.traverse((obj) => {
    if (obj.userData?.mixer) obj.userData.mixer.update(dt);
  });
}

/** The real measured footprint of a loaded model (post-importScale), or null if it hasn't loaded yet. */
export function measureModel(modelId) {
  const source = loadedById.get(modelId);
  if (!source) return null;
  const box = new THREE.Box3().setFromObject(source);
  const size = box.getSize(new THREE.Vector3());
  const height = size.y;

  // Footprint radius comes from geometry near the model's *base* only, not
  // its full bounding box — otherwise a tree's overhanging canopy (or a
  // building's eaves) would make its collider many times wider than what
  // should actually block movement. This mirrors how every hand-built tree
  // in this project already colliders on trunk width, not canopy spread
  // (see propTypes.js's 'trunk' collider) — imported models get the same
  // treatment, just measured from the mesh instead of a seeded radius.
  const sliceHeight = Math.max(height * 0.15, 0.3);
  const yThreshold = box.min.y + sliceHeight;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const v = new THREE.Vector3();
  source.updateMatrixWorld(true);
  source.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
    const pos = obj.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      if (v.y > yThreshold) continue;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  });
  // Fallback for a model with no geometry at all within the base slice (e.g.
  // one that floats entirely above y=0) — use the full bounding box rather
  // than silently returning a zero-radius (no collision at all) footprint.
  const footprintRadius = Number.isFinite(minX) ? Math.max(maxX - minX, maxZ - minZ) / 2 : Math.max(size.x, size.z) / 2;
  return { footprintRadius, height };
}

/**
 * Resolves once every given model id has either loaded or been given up on
 * (bounded by `timeoutMs`) — used by the live game client to avoid ever
 * showing a placeholder box, at the cost of a bounded startup delay. The
 * World Editor doesn't use this; it shows placeholders and rebuilds on
 * onModelLoadedEvent instead, since instant feedback matters more there.
 */
export function waitForModels(modelIds, timeoutMs = 8000) {
  const pending = modelIds.filter((id) => catalogById.has(id) && !loadedById.has(id));
  if (pending.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const remaining = new Set(pending);
    for (const id of pending) loadModel(id);
    const off = onModelLoadedEvent((id) => {
      remaining.delete(id);
      if (remaining.size === 0) {
        off();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => {
      off();
      resolve();
    }, timeoutMs);
  });
}
