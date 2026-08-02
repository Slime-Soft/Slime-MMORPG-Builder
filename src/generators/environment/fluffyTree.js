// src/generators/environment/fluffyTree.js
// Round-canopy trees, "fluffy anime" style — the technique from
// github.com/leoawen/fluffytree-threejs (MIT), which is what actually
// produces the reference look. This is NOT leaves-on-branches (the ez-tree
// approach it replaces, which always exposed bare twigs no matter the
// density). Three ingredients working together:
//
//   1. The canopy is a handful of overlapping SOLID BLOB meshes (jittered
//      icospheres) clustered into a rounded crown — not thousands of leaf
//      cards. Cheap (a few hundred tris).
//   2. A procedural LEAF-ALPHA cutout texture (alphaMap + alphaTest) breaks
//      the blob silhouette into ragged leaf shapes, so the edges read as
//      foliage instead of hard spheres. Overlapping blobs behind fill the
//      interior holes, so only the true silhouette shows background.
//   3. A VOLUMETRIC GRADIENT shader: for each surface point, a direction
//      from the crown's CENTRE outward, dotted with a fixed sun direction,
//      ramps shadow -> lit -> highlight colour. That's what gives the puffs
//      their soft rounded lit-from-one-side depth — the ingredient every
//      earlier "solid blob" attempt was missing.
//
// The gradient's colours all derive from the material's own `diffuse`
// colour, so the existing per-tree colour picker (applyColorTint in
// render/scene.js, which sets material.color) recolours the whole canopy
// for free, and the trunk (a separate mesh, excludeFromColorTint) stays
// brown.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRng, range, rangeInt } from '../seededRandom.js';
import { sampleTree } from '../../sim/propMetrics.js';
import { jitterSharedVertices } from './jitter.js';

// ── Procedural single-leaf alpha mask ────────────────────────────────────────
// ONE leaf silhouette filling the tile — this is the mask for an individual
// leaf CARD, not a tiled cluster texture.
//
// WHY CARDS AND NOT A TEXTURED BLOB: close-ups of the reference show the
// canopy is unmistakably made of thousands of individual leaves — distinct
// overlapping shapes, with leaves poking out past the silhouette into the
// sky. An earlier version of this file tried a solid blob with a tiled
// leaf-cutout alphaMap; that can only ever punch HOLES in a smooth surface
// (it read as a damaged balloon), and the silhouette stayed the blob's own
// polygonal edge. No amount of texture tuning gets individual leaves out of
// a sphere — the leaves have to be real geometry.
//
// Black background + white shape: alphaMap reads the GREEN channel, so
// white=1 (keep) / black=0 (discard).
let leafAlphaTexture = null;
function getLeafAlphaTexture() {
  if (leafAlphaTexture) return leafAlphaTexture;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#fff';

  // A single leaf: rounded base, pointed tip, filling most of the tile.
  const cx = size / 2;
  const w = size * 0.30;
  ctx.beginPath();
  ctx.moveTo(cx, size * 0.04); // tip
  ctx.quadraticCurveTo(cx + w, size * 0.34, cx + w * 0.55, size * 0.84);
  ctx.quadraticCurveTo(cx, size * 1.02, cx, size * 0.96); // base
  ctx.quadraticCurveTo(cx, size * 1.02, cx - w * 0.55, size * 0.84);
  ctx.quadraticCurveTo(cx - w, size * 0.34, cx, size * 0.04);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  // NO MIPMAPS — this is an alpha-TEST mask, not a colour map. With mipmaps
  // the GPU averages the leaf shape down to a roughly uniform grey at render
  // distance; that average sits above alphaTest, every fragment passes, and
  // the leaf silhouette silently turns back into a square card.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  leafAlphaTexture = tex;
  return tex;
}

// ── Volumetric-gradient canopy material ──────────────────────────────────────
// MeshBasicMaterial (unlit): the gradient shader overwrites the fragment
// colour outright, so the canopy looks identical regardless of scene
// lighting — no dependence on light intensities, and no dark grazing
// angles by construction. toonify() only converts MeshStandardMaterial, so
// a MeshBasic canopy is left untouched; the preserveMaterial flag makes
// that explicit.
const LEAF_LOCAL_LIGHT_DIR = new THREE.Vector3(0.35, 1.0, 0.25).normalize();

function buildCanopyMaterial(localCenter, baseColor, { isLeafCards }) {
  const mat = new THREE.MeshBasicMaterial({
    color: baseColor,
    // Only the leaf CARDS get the leaf-shaped cutout. The inner core is a
    // solid dark mass whose whole job is to stop sky showing through the
    // gaps between cards, so it must not be cut up.
    alphaMap: isLeafCards ? getLeafAlphaTexture() : null,
    alphaTest: isLeafCards ? 0.5 : 0,
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    // Only the leaf cards rustle. The solid core sits still — it's the mass
    // the leaves hang on, and swaying it would just drag the whole crown off
    // the trunk again.
    shader.uniforms.uWindStrength = { value: isLeafCards ? 0.035 : 0.0 };
    shader.uniforms.uWindSpeed = { value: 1.4 };
    shader.uniforms.uLocalCenter = { value: localCenter.clone() };
    shader.uniforms.uLightDir = { value: LEAF_LOCAL_LIGHT_DIR.clone() };
    // Gradient tuning — shadow at the bottom/away side, lit through the
    // middle, a brighter warm highlight on the sun side.
    shader.uniforms.uGradStart = { value: -0.75 };
    shader.uniforms.uGradEnd = { value: 1.1 };
    shader.uniforms.uHiStart = { value: 0.35 };
    shader.uniforms.uHiEnd = { value: 1.05 };

    shader.vertexShader = `
      uniform float uTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
      varying vec3 vLocalPos;
      ${shader.vertexShader}
    `.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // For the instanced leaf cards, "transformed" is still the raw quad
      // vertex — Three doesn't apply instanceMatrix until project_vertex.
      // The volumetric gradient needs the leaf's position within the CROWN,
      // so fold the instance transform in here explicitly.
      #ifdef USE_INSTANCING
        vLocalPos = (instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vLocalPos = transformed;
      #endif
      `
    ).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      // Wind: each leaf card rustles on its OWN phase, hashed from where it
      // sits in the crown, and the push is small.
      //
      // It used to be one big sideways push applied to the whole canopy at
      // once. That reads as the entire crown sliding back and forth as a
      // rigid slab (the exact failure render/windSway.js's header warns
      // about) AND — because the trunk doesn't move — it visibly slid the
      // foliage off the trunk, opening a gap between them. Per-leaf phase
      // keeps the crown planted while the leaves themselves flutter.
      float wph = fract(sin(dot(vLocalPos.xz + vLocalPos.y, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831;
      vec3 wpush = vec3(
        sin(uTime * uWindSpeed + wph),
        sin(uTime * uWindSpeed * 1.3 + wph) * 0.35,
        cos(uTime * uWindSpeed * 0.8 + wph)
      ) * uWindStrength;
      gl_Position += projectionMatrix * viewMatrix * vec4(wpush, 0.0);
      `
    );

    shader.fragmentShader = `
      uniform vec3 uLocalCenter;
      uniform vec3 uLightDir;
      uniform float uGradStart;
      uniform float uGradEnd;
      uniform float uHiStart;
      uniform float uHiEnd;
      varying vec3 vLocalPos;
      ${shader.fragmentShader}
    `.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      {
        // base = the material's own colour (so applyColorTint recolours the
        // whole canopy). shadow/lit/highlight are all derived from it and
        // STAY IN HUE — the highlight is a brighter tint of the same green,
        // NOT white. (An earlier version mixed toward white and blew the
        // whole crown-top out to near-snow, the opposite of the reference's
        // bright-but-green top.)
        // NOTE: for the leaf cards this already includes the per-leaf shade
        // from instanceColor (color_fragment multiplied vColor in above), so
        // the whole ramp below varies slightly leaf to leaf — that per-leaf
        // difference is what makes individual leaves readable inside the
        // canopy instead of a single flat green mass.
        vec3 base = diffuseColor.rgb;
        vec3 shadowCol = base * 0.18;                       // deep shade under the crown
        vec3 litCol    = base;
        vec3 hiCol     = min(base * 1.5 + vec3(0.10, 0.22, 0.0), vec3(1.0)); // bright yellow-green sunlit top

        vec3 dir = normalize(vLocalPos - uLocalCenter);
        float align = dot(dir, normalize(uLightDir));
        float g = smoothstep(uGradStart, uGradEnd, align);
        vec3 col = mix(shadowCol, litCol, g);
        float hi = smoothstep(uHiStart, uHiEnd, align);
        col = mix(col, hiCol, hi * 0.7);                    // cap highlight so it never fully takes over

        diffuseColor.rgb = col;
      }`
    );
    mat.userData.shader = shader; // updateWindSwayTime drives uTime — see render/windSway.js
  };
  mat.customProgramCacheKey = () => `fluffy-canopy-${isLeafCards ? 'cards' : 'core'}`;
  return mat;
}

// ── Crown shape ──────────────────────────────────────────────────────────────
/**
 * The crown as a list of overlapping spheres {x,y,z,r}. These are never drawn
 * directly as the visible canopy — they're the VOLUME that leaf cards get
 * scattered over, plus (shrunk) the solid dark core behind them.
 */
function buildCrownBlobs(rng, canopyBottom, R) {
  const blobs = [];
  blobs.push({ x: 0, y: canopyBottom + R * 0.65, z: 0, r: R * 0.62 }); // central mass
  // A modest skirt puff so foliage still wraps a little way down around the
  // branches — but sat high enough that it doesn't swallow the trunk. (An
  // earlier pass put this at R*0.08 with r=R*0.42, hanging the crown's
  // underside ~0.34R BELOW canopyBottom, which buried the trunk down to the
  // fork and left only a stub showing.)
  blobs.push({ x: 0, y: canopyBottom + R * 0.28, z: 0, r: R * 0.38 });
  // A ring of side puffs — the lobes that make the crown read as several
  // fused puffs rather than one ball.
  const ringCount = rangeInt(rng, 4, 6);
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const dist = R * range(rng, 0.5, 0.68);
    blobs.push({
      x: Math.cos(a) * dist,
      y: canopyBottom + R * range(rng, 0.34, 0.6),
      z: Math.sin(a) * dist,
      r: R * range(rng, 0.4, 0.52),
    });
  }
  const topCount = rangeInt(rng, 2, 3);
  for (let i = 0; i < topCount; i++) {
    blobs.push({
      x: range(rng, -R * 0.3, R * 0.3),
      y: canopyBottom + R * range(rng, 0.95, 1.2),
      z: range(rng, -R * 0.3, R * 0.3),
      r: R * range(rng, 0.34, 0.46),
    });
  }
  return blobs;
}

/** Crown centroid — the origin the volumetric gradient radiates from. */
function crownCenter(blobs) {
  const c = new THREE.Vector3();
  for (const b of blobs) c.add(new THREE.Vector3(b.x, b.y, b.z));
  return c.multiplyScalar(1 / blobs.length);
}

/**
 * The solid inner core: each crown blob shrunk, merged, no alpha cutout.
 * Its only job is to be an opaque dark mass behind the leaf cards so gaps
 * between them show shadowed depth instead of sky. Cheap (detail 1).
 */
function buildCoreGeometry(blobs, rng) {
  const geos = blobs.map((b) => {
    const geo = new THREE.IcosahedronGeometry(b.r * 0.82, 1);
    jitterSharedVertices(geo, rng, (rr) => {
      const j = range(rr, 0.85, 1.15);
      return { x: j, y: j * range(rr, 0.9, 1.1), z: j };
    });
    geo.translate(b.x, b.y, b.z);
    return geo;
  });
  return mergeGeometries(geos);
}

// ── Leaf cards ───────────────────────────────────────────────────────────────
const _leafPos = new THREE.Vector3();
const _leafDir = new THREE.Vector3();
const _leafQuat = new THREE.Quaternion();
const _leafSpin = new THREE.Quaternion();
const _leafTilt = new THREE.Quaternion();
const _leafScale = new THREE.Vector3();
const _leafMat4 = new THREE.Matrix4();
const _tiltAxis = new THREE.Vector3();
const _planeNormal = new THREE.Vector3(0, 0, 1);

/**
 * Thousands of individual leaf quads scattered over the crown's surface —
 * this is what actually makes the canopy read as foliage rather than a
 * textured ball. One InstancedMesh, so it's a single draw call.
 *
 * Each card sits near a blob's surface and is oriented FACING OUTWARD
 * (its +Z normal along the outward direction), then randomly spun and
 * tilted. Facing outward matters: a purely random orientation leaves a
 * large share of cards edge-on to any given viewer, which is what made an
 * early leaf-card attempt read as sparse confetti.
 */
function buildLeafCards(blobs, rng, density, leafSize) {
  const cards = [];
  const shades = [];
  for (const b of blobs) {
    // Count scales with the blob's surface area, so big and small puffs get
    // consistent leaf coverage rather than the same absolute count.
    const area = 4 * Math.PI * b.r * b.r;
    const count = Math.max(20, Math.round(area * 26 * density));
    for (let i = 0; i < count; i++) {
      // Uniform point on a sphere (z-slice method — avoids the pole
      // clustering a naive angle-pair pick produces).
      const z = range(rng, -1, 1);
      const a = range(rng, 0, Math.PI * 2);
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      _leafDir.set(s * Math.cos(a), z, s * Math.sin(a));
      // Sit near the surface, a few tucked slightly inside for depth, a few
      // poking out past it — the outliers are what break the silhouette.
      const depth = range(rng, 0.86, 1.1);
      _leafPos.set(b.x + _leafDir.x * b.r * depth, b.y + _leafDir.y * b.r * depth, b.z + _leafDir.z * b.r * depth);

      _leafQuat.setFromUnitVectors(_planeNormal, _leafDir);
      _leafSpin.setFromAxisAngle(_leafDir, range(rng, 0, Math.PI * 2));
      _leafQuat.premultiply(_leafSpin);
      // Random tilt off the surface normal so the shell isn't a uniform
      // hedgehog — some leaves catch the light flat, some at an angle.
      _tiltAxis.set(range(rng, -1, 1), range(rng, -1, 1), range(rng, -1, 1)).normalize();
      _leafTilt.setFromAxisAngle(_tiltAxis, range(rng, -0.6, 0.6));
      _leafQuat.premultiply(_leafTilt);

      const sc = leafSize * range(rng, 0.7, 1.3);
      _leafScale.set(sc, sc, sc);
      _leafMat4.compose(_leafPos, _leafQuat, _leafScale);
      cards.push(_leafMat4.clone());
      // Per-leaf brightness, fed in as instanceColor. The canopy shader
      // derives its whole shadow/lit/highlight ramp from diffuseColor (which
      // vColor has already multiplied), so this makes each leaf sit at a
      // slightly different shade — the thing that lets you pick out
      // individual leaves inside the crown rather than one flat green mass.
      shades.push(range(rng, 0.72, 1.28));
    }
  }
  return { cards, shades };
}

// ── Forking trunk ────────────────────────────────────────────────────────────
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _quat = new THREE.Quaternion();
/** A tapered cylinder from `from` to `to`, radius r0 -> r1. */
function limbGeometry(from, to, r0, r1) {
  _dir.subVectors(to, from);
  const len = _dir.length();
  if (len < 1e-4) return null;
  _dir.normalize();
  _mid.addVectors(from, to).multiplyScalar(0.5);
  _quat.setFromUnitVectors(_up, _dir);
  const geo = new THREE.CylinderGeometry(r1, r0, len, 6, 1);
  geo.applyQuaternion(_quat);
  geo.translate(_mid.x, _mid.y, _mid.z);
  return geo;
}

/** Main trunk up to a fork, then 2-3 branches reaching up into the crown. */
function buildTrunk(rng, trunkHeight, trunkRadius, canopyBottom, R) {
  const geos = [];
  const forkY = trunkHeight * 0.5;
  geos.push(limbGeometry(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, forkY, 0),
    trunkRadius, trunkRadius * 0.75
  ));
  const branchCount = rangeInt(rng, 2, 3);
  const a0 = range(rng, 0, Math.PI * 2);
  for (let i = 0; i < branchCount; i++) {
    const a = a0 + (i / branchCount) * Math.PI * 2 + range(rng, -0.25, 0.25);
    const reach = R * range(rng, 0.18, 0.34);
    // Push the tips well UP INTO the crown rather than stopping at its
    // underside — a branch that ends exactly where the foliage starts reads
    // as a gap between trunk and leaves. Buried tips are hidden by leaves and
    // the two masses read as connected.
    const tip = new THREE.Vector3(
      Math.cos(a) * reach,
      canopyBottom + R * range(rng, 0.3, 0.5),
      Math.sin(a) * reach
    );
    const g = limbGeometry(new THREE.Vector3(0, forkY, 0), tip, trunkRadius * 0.7, trunkRadius * 0.3);
    if (g) geos.push(g);
  }
  return mergeGeometries(geos.filter(Boolean));
}

/**
 * @param {number} seed
 * @param {number} [leafDensity] world.treeSettings.leafDensity or a per-tree
 *   override (World Editor Place tab). Clamped 0.5-3.5. Scales how many leaf
 *   cards get scattered over the crown (and mildly, the crown's radius).
 * @returns {THREE.Group} a posed tree standing on y=0
 */
export function generateFluffyTree(seed, leafDensity) {
  const rng = createRng(seed);
  const d = sampleTree(rng, { type: 'round' }); // trunkHeight/trunkRadius/leafColor/rotationY/scale; rng continues below for canopy jitter
  const density = Math.max(0.5, Math.min(3.5, leafDensity || 1.5));

  const trunkHeight = d.trunkHeight;
  const trunkRadius = d.trunkRadius;
  const canopyBottom = trunkHeight * 0.78;
  const R = trunkHeight * (0.85 + 0.08 * (density - 1)); // crown radius grows mildly with density

  const group = new THREE.Group();

  // Trunk (+ forked branches): one merged MeshStandardMaterial mesh —
  // toonify() converts it to the toon pipeline like every other standard
  // material. excludeFromColorTint keeps the leaf colour-picker off it.
  const trunkMat = new THREE.MeshStandardMaterial({ color: d.trunkColor, roughness: 0.95 });
  const trunkMesh = new THREE.Mesh(buildTrunk(rng, trunkHeight, trunkRadius, canopyBottom, R), trunkMat);
  trunkMesh.castShadow = true;
  trunkMesh.userData.excludeFromColorTint = true;
  group.add(trunkMesh);

  const blobs = buildCrownBlobs(rng, canopyBottom, R);
  const center = crownCenter(blobs);

  // The sim's LEAF_COLORS are fairly dark, muted greens — fine for a flat
  // blob, too drab once a volumetric ramp is riding on top of them. Push
  // saturation/lightness up to a vivid green so the shadow end still reads
  // as green rather than black. applyColorTint retargets hue+saturation off
  // this and keeps its lightness, so recolouring still works.
  const leafBase = new THREE.Color(d.leafColor);
  const hsl = { h: 0, s: 0, l: 0 };
  leafBase.getHSL(hsl);
  leafBase.setHSL(hsl.h, Math.min(1, hsl.s * 1.3), Math.min(0.6, hsl.l * 1.55));

  // 1. Solid inner core — never seen directly, it just backs the leaf cards
  //    so the gaps between them read as shadowed depth, not sky.
  const coreMat = buildCanopyMaterial(center, leafBase, { isLeafCards: false });
  const coreMesh = new THREE.Mesh(buildCoreGeometry(blobs, rng), coreMat);
  // The canopy's shadow comes from the CORE only, never the leaf cards. The
  // shell is ~4,600 alpha-tested instances; shadowing it would re-pay that
  // cost (plus per-fragment alpha discard, which defeats the depth pass's
  // early-z) once per shadow-casting light. The core is a few hundred opaque
  // tris in the crown's shape, it's the one canopy mesh that's visible at
  // every LOD, and a round blob shadow is all the ground can resolve anyway.
  // Slight understatement is deliberate: it sits at blob radius * 0.82, so
  // the shadow is a touch smaller than the silhouette — invisible in practice
  // and it keeps the shadow off the trunk's own base.
  coreMesh.castShadow = true;
  coreMesh.userData.preserveMaterial = true;
  coreMesh.userData.isTreeLeaves = true; // shares the same uTime wind hook
  group.add(coreMesh);

  // 2. The leaf shell — thousands of individual cards, one draw call.
  const leafSize = R * 0.20;
  const { cards, shades } = buildLeafCards(blobs, rng, density, leafSize);
  const leafGeo = new THREE.PlaneGeometry(1, 1);
  const leafMat = buildCanopyMaterial(center, leafBase, { isLeafCards: true });
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, cards.length);
  const shadeColors = new Float32Array(cards.length * 3);
  for (let i = 0; i < cards.length; i++) {
    leaves.setMatrixAt(i, cards[i]);
    shadeColors[i * 3] = shadeColors[i * 3 + 1] = shadeColors[i * 3 + 2] = shades[i];
  }
  leaves.instanceColor = new THREE.InstancedBufferAttribute(shadeColors, 3);
  leaves.instanceColor.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  // This used to be `frustumCulled = false`, on the reasoning that "the
  // instances sit far from the mesh's own origin". That premise is wrong:
  // THREE.Frustum.intersectsObject checks `object.boundingSphere` FIRST and
  // only falls back to the geometry's when the object doesn't define one —
  // and InstancedMesh does, computed across every instance matrix. The 1x1
  // leaf PlaneGeometry's own bounding sphere (r≈0.7 at the origin) never
  // enters into it.
  //
  // Turning culling off instead meant every canopy in the map was submitted
  // every frame no matter where the camera looked — on asteria that is 121
  // oaks x ~10k triangles = 1.2M triangles you could never turn away from,
  // in the main pass AND again in the shadow pass.
  //
  // The pad covers the wind shader's per-leaf push (uWindStrength 0.035 in
  // buildCanopyMaterial, applied after project_vertex so it's a world-space
  // offset): geometry can move slightly outside the computed sphere, and
  // without slack a leaf could pop at the exact cull boundary.
  leaves.computeBoundingSphere();
  const leafShellRadius = leaves.boundingSphere.radius; // captured BEFORE the pad below — it's the real silhouette, used for the LOD scale
  leaves.boundingSphere.radius += 0.1;
  leaves.userData.preserveMaterial = true;
  leaves.userData.isTreeLeaves = true; // per-frame uTime wind — see buildWorldMeshes/treeSway in render/scene.js
  group.add(leaves);

  // 3. Distance LOD. The card shell is ~4,600 instances / ~10k triangles per
  //    tree — by far the heaviest thing in the world (121 oaks on asteria =
  //    1.2M triangles). Past a threshold the individual cards are smaller
  //    than a pixel and all they resolve to is the crown's silhouette and
  //    colour, which the solid core already provides for free: it is built
  //    from the same blobs, with the same material and gradient, and exists
  //    precisely so no sky shows through the crown.
  //
  //    So the far LOD is "hide the cards, keep the core" — no second mesh,
  //    no extra geometry or memory, and nothing to keep in sync.
  //
  //    The catch is silhouette: the core is built at blob radius * 0.82
  //    while the cards sit at 0.86-1.1, so a naive swap visibly shrinks the
  //    crown. Rather than hardcode a fudge factor (the blob layout is
  //    random per seed, so no single constant is right), scale the core by
  //    the MEASURED ratio of the two bounding spheres, about the core's own
  //    centre so the crown doesn't slide down the trunk. Clamped, because a
  //    seed with one far-flung outlier blob would otherwise inflate the
  //    whole crown to cover it.
  coreMesh.geometry.computeBoundingSphere();
  const coreBS = coreMesh.geometry.boundingSphere;
  const farScale = Math.min(1.35, Math.max(1, leafShellRadius / Math.max(1e-4, coreBS.radius)));
  group.userData.canopyLod = {
    leaves,
    core: coreMesh,
    farScale,
    // Scaling a mesh scales about its own ORIGIN, which for this geometry is
    // the tree's base, not the crown — so an uncompensated scale lifts the
    // canopy off the trunk. This offset pins the scale to the core's centre.
    // (The gradient shader is unaffected: it reads `transformed`, the raw
    // geometry position, which no object-level transform touches.)
    farOffset: coreBS.center.clone().multiplyScalar(1 - farScale),
  };

  if (d.rotationY !== null) group.rotation.y = d.rotationY;
  group.scale.setScalar(d.scale);
  return group;
}
