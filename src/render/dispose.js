// src/render/dispose.js
// Releasing GPU memory for a mesh that's being thrown away.
//
// `scene.remove(mesh)` only unparents it. The geometry's vertex buffers and
// any textures it owns stay allocated until they're explicitly disposed, and
// three.js has no finalizer that will do it for you. That is invisible until
// something rebuilds the same mesh over and over — which is exactly what the
// World Editor does while you drag a terrain brush: every stroke throws away a
// 257x257 ground plane (~2MB of vertex data) plus a freshly-baked terrain-
// height DataTexture per lake and per painted ground-texture layer. Paint for
// a minute and that is hundreds of megabytes of orphaned buffers; the editor
// freezes, and the next page load dies on "Array buffer allocation failed"
// before the leaked memory has been reclaimed.
//
// TEXTURES ARE OPT-IN, deliberately. Plenty of materials here point `.map` at
// a SHARED, cached texture (a ground tile, a path theme, the toon gradient) —
// disposing those would break every other mesh still using them, and the next
// rebuild besides. So a builder that mints a texture per build declares it:
//
//     mat.userData.ownedTextures = [maskTexture];
//
// and only those are freed. Anything unlisted is assumed shared and left alone.
// Geometries and materials themselves are always per-build, so they're always
// disposed.

/**
 * Dispose one material and any textures it declares ownership of.
 * @param {import('three').Material} mat
 */
function disposeMaterial(mat) {
  for (const tex of mat.userData?.ownedTextures || []) {
    if (tex && typeof tex.dispose === 'function') tex.dispose();
  }
  mat.dispose();
}

/**
 * Free the GPU resources of `root` and everything under it. Safe to call on
 * null, and safe to call on an object still parented (it doesn't unparent —
 * call `scene.remove` yourself, same as before).
 * @param {import('three').Object3D|null|undefined} root
 */
export function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    const mat = obj.material;
    if (!mat) return;
    if (Array.isArray(mat)) for (const m of mat) disposeMaterial(m);
    else disposeMaterial(mat);
  });
}

/**
 * `scene.remove(mesh)` + dispose, the pairing every rebuild path actually
 * wants. Tolerates a null mesh so callers can drop their `if (mesh)` guards.
 * @param {import('three').Object3D} parent
 * @param {import('three').Object3D|null|undefined} child
 */
export function removeAndDispose(parent, child) {
  if (!child) return;
  parent.remove(child);
  disposeObject3D(child);
}
