// src/render/groundTextureMesh.js
// Renders every painted world.groundTextures[] layer as ONE overlay mesh,
// following the terrain per-vertex (like buildGroundMesh), sitting just
// above the base ground and just below drawn paths (paths must always
// render on top — see GROUND_TEXTURE_Y_OFFSET vs pathMesh.js's Y_OFFSET).
//
// Blending happens in a fragment shader (MeshStandardMaterial.onBeforeCompile),
// NOT a baked whole-map composite texture. A composite bake was tried first
// and aliased badly: it point-samples the tile pattern into a FIXED-size
// canvas covering the entire map, so on a 1000-unit world with an 8-unit
// tile repeat, even a 2048px composite only gets ~16 output pixels per tile
// repeat — a >15:1 undersampling ratio with no averaging, which reads as a
// moving moire/weave pattern (reported as ground textures looking "stretched
// and weird"). No composite resolution fixes this for a large world; it's
// the wrong tool. A real GPU-tiled, RepeatWrapping texture (same technique
// pathThemes.js's path texture already uses correctly, see its identically-
// reasoned anisotropy comment) gets hardware mipmap + anisotropic filtering
// at the exact fragment being drawn — no fixed sampling budget, no aliasing.
// Only the per-layer PAINT MASK (soft brush strokes, inherently low-
// frequency) is still baked, into a small DataTexture sampled with GPU
// bilinear filtering — masks were never the aliasing source.
import * as THREE from 'three';
import { sampleTerrainHeight } from '../sim/world.js';
import { getGroundTextureTileTexture } from './groundTextureThemes.js';
import { addCloudShadowShader } from './cloudShadows.js';
import { applyDecalDepthBias } from './depthBias.js';
import {
  COLOR_GRADE_GLSL, colorGradeUniformDecls, colorGradeUniforms, colorGradeExpr,
} from './colorGrade.js';

export const GROUND_TEXTURE_Y_OFFSET = 0.015; // above ground (0), below paths (0.03 — src/render/pathMesh.js)
const TILE_WORLD_SIZE = 8; // world units per texture repeat

// GLSL samplers can't be dynamically indexed, so the shader below is
// hand-unrolled — but for the number of layers this map ACTUALLY has, not a
// fixed 4. The old fixed-4 build had two costs: painting a 5th texture was
// simply dropped (console.warn "only the first 4 will render"), and a map with
// one painted layer still burned 8 sampler units on dummy slots.
//
// The ceiling is texture units, not the unroll. WebGL2 guarantees only 16
// fragment texture units, and MeshStandardMaterial already spends several of
// its own (map, shadow maps, LTC/env). So the per-layer TILE texture gets a
// sampler each, but the per-layer PAINT MASKS are packed four-to-a-texture,
// one per RGBA channel — masks are single-channel greyscale, so three quarters
// of every mask texture was empty anyway. 8 layers therefore costs 8 tile + 2
// mask = 10 units instead of 16, which fits inside the guaranteed minimum with
// room left for the material's own.
const MAX_LAYERS = 8;
const MASKS_PER_TEXTURE = 4; // one per RGBA channel
const MASK_CHANNELS = ['r', 'g', 'b', 'a'];

/**
 * Bilinearly samples one layer's `cells` grid at normalized (u,v). Layers
 * sharing a packed mask texture must agree on a pixel grid, and layers don't
 * all have to share a `resolution` (the field is per-layer, and older maps
 * predate the current default), so the odd one out is resampled onto the
 * group's grid rather than being rejected or silently mis-scaled.
 */
function sampleLayerCells(layer, u, v) {
  const { resolution, cells } = layer;
  const size = resolution + 1;
  const fx = Math.min(resolution, Math.max(0, u * resolution));
  const fz = Math.min(resolution, Math.max(0, v * resolution));
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(resolution, x0 + 1), z1 = Math.min(resolution, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const at = (x, z) => cells[z * size + x] || 0;
  const top = at(x0, z0) * (1 - tx) + at(x1, z0) * tx;
  const bottom = at(x0, z1) * (1 - tx) + at(x1, z1) * tx;
  return top * (1 - tz) + bottom * tz;
}

/**
 * Bakes up to four layers' paint masks into ONE small RGBA GPU texture, layer
 * i landing in channel i. Same row layout as `cells` (row = z), flipY=false so
 * it lines up with the geometry's own world-bounds-normalized UV without any
 * flip math, matching buildWaterMesh's identical convention.
 *
 * Unused channels are left at 0, which is what makes a partly-filled group
 * safe: the shader still reads them, and a zero weight contributes nothing.
 */
function buildPackedMaskTexture(groupLayers) {
  // The finest grid in the group wins, so packing can only ever resample a
  // coarser layer UP (lossless-ish) rather than throwing detail away.
  const resolution = Math.max(...groupLayers.map((l) => l.resolution));
  const size = resolution + 1;
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < groupLayers.length; ch++) {
    const layer = groupLayers[ch];
    const sameGrid = layer.resolution === resolution;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const value = sameGrid
          ? layer.cells[z * size + x] || 0
          : sampleLayerCells(layer, x / resolution, z / resolution);
        data[(z * size + x) * 4 + ch] = Math.round(Math.min(1, Math.max(0, value)) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false; // size is resolution+1, not power-of-two, and doesn't need mips at mask scale
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Builds the ground-texture overlay mesh, or null if there's nothing painted
 * yet. Follows terrain per-vertex like buildGroundMesh, NOT a flat plane
 * like buildWaterMesh — ground textures are painted onto the actual ground,
 * which can slope (mountain terrain brush), unlike a lake's flat surface.
 */
export function buildGroundTextureOverlay(world) {
  if (!world) return null;
  const allLayers = world.groundTextures || [];
  if (allLayers.length === 0) return null;

  // Only layers whose tile texture has actually loaded (a custom upload may
  // still be in flight — see registerCustomGroundTexture/onCustomTileLoaded,
  // which triggers a rebuild once it's ready) contribute a shader slot.
  const loaded = [];
  for (const layer of allLayers) {
    const tex = getGroundTextureTileTexture(layer.textureId);
    if (tex) loaded.push({ layer, tex });
  }
  if (loaded.length === 0) return null;
  if (loaded.length > MAX_LAYERS) {
    console.warn(`Ground texture overlay: ${loaded.length} painted layers, only the first ${MAX_LAYERS} will render (texture-unit limit).`);
  }
  const slots = loaded.slice(0, MAX_LAYERS);

  const { bounds } = world;
  const w = bounds.maxX - bounds.minX;
  const d = bounds.maxZ - bounds.minZ;
  const segments = world.terrain ? world.terrain.resolution : 1;
  const geo = new THREE.PlaneGeometry(w, d, segments, segments);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const worldX = pos.getX(i) + (bounds.minX + bounds.maxX) / 2;
    const worldZ = -pos.getY(i) + (bounds.minZ + bounds.maxZ) / 2;
    const h = sampleTerrainHeight(world, worldX, worldZ);
    pos.setZ(i, h + GROUND_TEXTURE_Y_OFFSET);
    uv.setXY(i, (worldX - bounds.minX) / w, (worldZ - bounds.minZ) / d);
  }
  pos.needsUpdate = true;
  uv.needsUpdate = true;
  geo.computeVertexNormals();
  // PlaneGeometry's bounding sphere is computed from its flat construction-
  // time vertices, before the loop above pushes them up to terrain height —
  // three.js's frustum culling trusts that stale, low sphere and starts
  // wrongly culling the whole mesh once raised vertices poke far enough
  // outside it (exactly the "works at low height, vanishes past some
  // threshold" symptom). Must recompute after mutating positions.
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    depthWrite: false, // a decal layer, not a solid surface — shouldn't punch depth holes for whatever sits above it (paths, water)
    // A polygonOffset large enough to reliably win depth against the base
    // ground at typical gameplay camera distances (calibrated with a
    // synthetic close-up test camera) turned out to be large enough to win
    // against EVERYTHING in the scene — trees, rocks, all of it — at the
    // real game camera's distances, since polygonOffsetUnits' effect scales
    // with depth-buffer precision at the fragment's actual distance, which
    // varies enormously across a single mesh spanning the whole 1000x1000
    // map. A single constant can't be correct across that whole range, so
    // polygonOffset is the wrong tool here — reverted. The remaining
    // z-fighting-on-steep-slopes issue needs a real fix (per-vertex normal-
    // aligned offset, or splitting the overlay into per-tile chunks so a
    // smaller offset only has to survive a local depth range) rather than a
    // single global bias constant.
    roughness: 0.95,
    // A real map is only set so three.js defines USE_MAP and wires up the
    // vMapUv varying (== the world-bounds-normalized UV set above, since no
    // offset/repeat transform is applied) for the custom fragment code
    // below to read — its own sampled color is never used.
    map: slots[0].tex,
  });

  // One packed RGBA mask texture per group of 4 layers (see MASKS_PER_TEXTURE).
  const maskGroups = [];
  for (let i = 0; i < slots.length; i += MASKS_PER_TEXTURE) {
    maskGroups.push(buildPackedMaskTexture(slots.slice(i, i + MASKS_PER_TEXTURE).map((s) => s.layer)));
  }

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBoundsMin = { value: new THREE.Vector2(bounds.minX, bounds.minZ) };
    shader.uniforms.uBoundsSize = { value: new THREE.Vector2(w, d) };
    shader.uniforms.uTileWorldSize = { value: TILE_WORLD_SIZE };
    for (let i = 0; i < slots.length; i++) {
      shader.uniforms[`uTileTex${i}`] = { value: slots[i].tex };
      // Per-LAYER, not per-mesh: the whole point is that a map can paint the
      // same builtin 'meadow' twice and grade one of them into a dry summer
      // yellow. Uniforms, so a grade change is a re-upload of three floats,
      // not a texture re-bake — but the overlay is rebuilt wholesale on any
      // edit anyway (rebuildGroundTextureOverlay), so nothing reads them back.
      Object.assign(shader.uniforms, colorGradeUniforms(slots[i].layer.colorGrade, String(i)));
    }
    for (let g = 0; g < maskGroups.length; g++) {
      shader.uniforms[`uMaskTex${g}`] = { value: maskGroups[g] };
    }

    const samplerDecls = [
      ...slots.map((_, i) => `uniform sampler2D uTileTex${i};`),
      ...slots.map((_, i) => colorGradeUniformDecls(String(i))),
      ...maskGroups.map((_, g) => `uniform sampler2D uMaskTex${g};`),
    ].join('\n');

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nuniform vec2 uBoundsMin;\nuniform vec2 uBoundsSize;\nuniform float uTileWorldSize;\n${samplerDecls}\n${COLOR_GRADE_GLSL}`
    );

    // One sample per mask GROUP, reused by its up-to-4 member layers — a
    // texture fetch is the expensive part, swizzling out a channel is free.
    const maskFetches = maskGroups
      .map((_, g) => `	vec4 mask${g} = texture2D( uMaskTex${g}, vMapUv );`)
      .join('\n');

    const blendSteps = slots.map((_, i) => `
	{
		float w = mask${Math.floor(i / MASKS_PER_TEXTURE)}.${MASK_CHANNELS[i % MASKS_PER_TEXTURE]};
		if ( w > 0.001 ) {
			// Graded BEFORE the alpha composite below, so a layer's grade is
			// its own and doesn't leak into whatever it's painted over —
			// grading the blended result instead would recolour the layers
			// underneath wherever this one is only partly opaque.
			vec3 c = ${colorGradeExpr(`texture2D( uTileTex${i}, tileUV ).rgb`, String(i))};
			float newA = w + blendAlpha * ( 1.0 - w );
			blendColor = ( c * w + blendColor * blendAlpha * ( 1.0 - w ) ) / max( newA, 0.0001 );
			blendAlpha = newA;
		}
	}`).join('\n');

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
	vec2 worldXZ = uBoundsMin + vMapUv * uBoundsSize;
	vec2 tileUV = worldXZ / uTileWorldSize;
	vec3 blendColor = vec3( 0.0 );
	float blendAlpha = 0.0;
${maskFetches}
	${blendSteps}
	diffuseColor.rgb = blendColor;
	diffuseColor.a *= blendAlpha;
`
    );
  };
  // Layered on top of the blending above (composes with the onBeforeCompile
  // just assigned rather than replacing it) — `worldXZ` is a local declared
  // inside the #include <map_fragment> replacement above, still in scope
  // later in the same shader main() body where cloud shadows sample it.
  addCloudShadowShader(mat, 'worldXZ');
  // The real fix for the z-fighting the (reverted) polygonOffset attempt above
  // couldn't solve: bias in clip space, where one constant is correct at every
  // distance. See src/render/depthBias.js.
  // Distinguishes this material's compiled program from an ordinary
  // MeshStandardMaterial's cache entry — onBeforeCompile alone doesn't
  // change three.js's program cache key, so without this every ground-
  // texture overlay mesh would risk sharing (and fighting over) the plain,
  // un-patched compiled program.
  //
  // The layer count is PART of the key now that the shader is unrolled to the
  // map's real layer count: without it, painting a 5th texture would re-use
  // the cached 4-layer program and the new layer would never appear (the exact
  // bug the fixed-4 unroll used to hide).
  mat.customProgramCacheKey = () => `ground-texture-overlay-${slots.length}`;
  // AFTER the cache key above, not before: applyDecalDepthBias chains onto
  // whatever customProgramCacheKey it finds, and assigning a fresh one
  // afterwards threw its contribution away. Harmless today (the overlay key
  // is already unique), but it silently broke the invariant that module
  // documents as "NOT optional".
  applyDecalDepthBias(mat);
  // The packed masks are baked fresh on every rebuild and referenced only from
  // this material's shader uniforms, so nothing else can free them — declare
  // them so disposeObject3D does (src/render/dispose.js). The TILE textures
  // are deliberately NOT listed: those come from a shared cache and outlive
  // this mesh.
  mat.userData.ownedTextures = maskGroups;

  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 1; // above ground(implicit 0), below water(2) and paths(opaque, depth-tested naturally on top regardless)
  mesh.receiveShadow = true;
  mesh.name = 'ground-texture-overlay';
  return mesh;
}
