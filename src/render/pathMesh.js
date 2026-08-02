// src/render/pathMesh.js
// Turns a world.paths[] entry (an ordered polyline + width + theme) into a
// terrain-following ribbon mesh. Used identically by the World Editor
// (live draft preview + saved paths) and the live game client.
import * as THREE from 'three';
import { applyDecalDepthBias } from './depthBias.js';
import {
  COLOR_GRADE_GLSL, colorGradeUniformDecls, colorGradeUniforms, colorGradeExpr,
} from './colorGrade.js';
import { isNeutralColorGrade } from '../sim/colorGrading.js';
import { sampleTerrainHeight } from '../sim/world.js';
import { getPathThemeTexture } from './pathThemes.js';
import { getToonGradientMap } from './toonGradient.js';
import { DEFAULT_PATH_WIDTH } from '../sim/paths.js';

const Y_OFFSET = 0.03; // sits just above the ground mesh to avoid z-fighting
// Every path used to be laid at EXACTLY Y_OFFSET, so wherever two paths crossed
// their surfaces were coplanar and opaque, and both wrote depth — the classic
// z-fight, seen in game as a hard flicker at every junction. A city with four
// avenues, two ring roads and a park walk has a lot of junctions.
//
// Ground textures dodge this by never writing depth (groundTextureMesh.js), but
// a path IS a solid surface, so instead each path is lifted by a hair more than
// the last. 4mm is invisible underfoot and far larger than any depth-buffer
// resolution at these distances, so the later path simply wins.
const PATH_LAYER_STEP = 0.004;
// ...but the layer must NOT be the path's index in world.paths. That number has
// no ceiling, and Asteria reached 64 paths: the newest road was being laid
// 0.03 + 63*0.004 = 28cm in the air, visibly hovering over the terrain, and
// every path drawn after it floated 4mm higher again. The layer is now derived
// from which paths actually OVERLAP (assignPathLayers below) and capped here,
// so the worst case is 0.03 + 7*0.004 = 5.8cm and stays there forever.
export const MAX_PATH_LAYERS = 8;
// 4mm of real height separates crossings near the camera and nothing at all
// once the depth buffer's step exceeds it, which used to be masked by the
// enormous index-derived gaps (path 5 crossing path 60 was 220mm apart). With
// the spread bounded to 28mm that mask is gone, so each layer also gets a
// nudge of clip-space bias, which — unlike a fixed height — keeps working at
// distance. Deliberately tiny: 7 layers add 17% to PATH_DEPTH_BIAS, so the
// near-field ordering is still decided by the 4mm and only the far field by
// this. See src/render/depthBias.js for why clip space is the right space.
const PATH_LAYER_BIAS_STEP = 0.00001;
const MAX_SAMPLES = 400; // safety cap for very long/dense drafts
// World units per texture repeat, in BOTH directions. Deliberately the same
// number as groundTextureMesh.js's TILE_WORLD_SIZE, and deliberately NOT the
// path's own width.
//
// The UV used to be `u: 0..1` across the width and `v: arcLength / width`, so
// one tile always covered exactly `width` metres. That tied texel density to
// how wide the road is: a 3m footpath got 128px/3m = 43 texels per metre, a
// 10m avenue got 12.8 — a quarter of the detail, and 2.5x coarser than the
// ground textures painted right beside it. Its mip chain therefore collapsed
// to a flat average 2.5x closer to the camera, which is what "pathways only
// render a few metres in front of you" and "ground textures blend together
// with pathways" actually were: the road losing its flagstones first and
// landing on the same featureless colour as its neighbours.
//
// Fixing the density also fixes a look bug it was hiding — flagstones were
// scaling with the road, so a wide avenue was paved in 1.5m slabs and a
// garden path in 0.4m pebbles cut from the same texture. Now stone size is
// absolute, which is what stone does.
const PATH_TILE_WORLD_SIZE = 8;
// 4x the ground-texture overlay's default bias (src/render/depthBias.js) —
// enough headroom that a path always wins against the overlay it lies on,
// still ~4e-4 of the [-1,1] depth range, far too small to see as a shift.
const PATH_DEPTH_BIAS = 0.0004;

/** Resample a polyline through a Catmull-Rom spline at ~evenly-spaced intervals so corners stay smooth even with few authored points. */
function resamplePoints(points, spacing) {
  if (points.length < 2) return points.slice();
  // 'centripetal', not the uniform 'catmullrom' this used to use. Uniform
  // Catmull-Rom overshoots badly when consecutive points are very unevenly
  // spaced: click a couple of points close together, then jump a long way and
  // continue, and the curve loops back BEHIND the first point before heading
  // off — which is the ribbon "extending at the starting point" and looking
  // broken. Drawing the same path click-by-click kept the spacing even, so it
  // never showed up that way. Centripetal parameterisation is the standard
  // remedy: it's provably free of cusps and self-intersections regardless of
  // how uneven the spacing is.
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'centripetal'
  );
  const length = curve.getLength();
  const numSamples = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(length / Math.max(0.1, spacing))));
  return curve.getSpacedPoints(numSamples).map((v) => ({ x: v.x, z: v.z }));
}

/**
 * Builds a single ribbon Mesh for one path. Returns null if the path has
 * fewer than 2 points (nothing to draw yet — e.g. an in-progress draft with
 * only the first click placed).
 */
export function buildPathMesh(path, world, layerIndex = 0) {
  const width = path.width ?? DEFAULT_PATH_WIDTH;
  if (!path.points || path.points.length < 2) return null;

  const sampled = resamplePoints(path.points, Math.max(0.5, width * 0.4));
  if (sampled.length < 2) return null;

  const positions = [];
  const uvs = [];
  let arcLength = 0;

  for (let i = 0; i < sampled.length; i++) {
    const p = sampled[i];
    const prev = sampled[Math.max(0, i - 1)];
    const next = sampled[Math.min(sampled.length - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tlen = Math.hypot(tx, tz) || 1;
    tx /= tlen;
    tz /= tlen;
    // Perpendicular in the XZ plane (rotate tangent +90 deg viewed from above).
    const nx = -tz;
    const nz = tx;

    const lx = p.x + nx * (width / 2);
    const lz = p.z + nz * (width / 2);
    const rx = p.x - nx * (width / 2);
    const rz = p.z - nz * (width / 2);
    const yLift = Y_OFFSET + (layerIndex % MAX_PATH_LAYERS) * PATH_LAYER_STEP;
    const ly = sampleTerrainHeight(world, lx, lz) + yLift;
    const ry = sampleTerrainHeight(world, rx, rz) + yLift;

    positions.push(lx, ly, lz, rx, ry, rz);

    if (i > 0) arcLength += Math.hypot(p.x - sampled[i - 1].x, p.z - sampled[i - 1].z);
    const v = arcLength / PATH_TILE_WORLD_SIZE;
    const u = width / PATH_TILE_WORLD_SIZE;
    uvs.push(0, v, u, v);
  }

  const indices = [];
  for (let i = 1; i < sampled.length; i++) {
    const a = (i - 1) * 2;
    const b = a + 1;
    const c = i * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const texture = getPathThemeTexture(path.theme || 'basic');
  // Built as its FINAL toon-shaded form, not a MeshStandardMaterial that
  // toonify() converts later — paired with `preserveMaterial` below. See that
  // flag's note for why this matters so much here.
  const mat = new THREE.MeshToonMaterial({
    map: texture,
    gradientMap: getToonGradientMap(),
    side: THREE.DoubleSide, // cheap insurance against a winding mistake making the ribbon invisible from above
  });
  // Recolouring, applied to the SAMPLED TEXTURE rather than via mat.color.
  // MeshToonMaterial's own `color` multiplies the map and would cover the tint
  // slider on its own, but nothing about it can desaturate — and desaturating
  // is the half that matters, because every baked path texture is a strongly
  // tinted flagstone (see pathThemes.js's `base` triples) and multiplying one
  // colour by another can only ever go darker and muddier. Washing the stone
  // out first is what makes a path actually take the colour you asked for.
  //
  // Skipped entirely when the grade is the identity: an ungraded path keeps
  // the exact material and the exact shader program it has always had, so this
  // cannot regress the 95% of paths nobody grades. It also keeps the program
  // cache from splitting in two for no reason.
  if (!isNeutralColorGrade(path.colorGrade)) {
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, colorGradeUniforms(path.colorGrade));
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${colorGradeUniformDecls()}\n${COLOR_GRADE_GLSL}`)
        // AFTER <map_fragment>, so `diffuseColor` already holds the sampled
        // flagstone. Grading before it would be graded against nothing.
        .replace('#include <map_fragment>', `#include <map_fragment>\n\tdiffuseColor.rgb = ${colorGradeExpr('diffuseColor.rgb')};`);
    };
    // Same reasoning as applyDecalDepthBias's own key (see depthBias.js):
    // onBeforeCompile does not participate in three.js's program cache key, so
    // without this a graded path and a plain one hash to the same entry and
    // whichever compiles first decides the look of both. The grade's VALUES
    // are uniforms and deliberately absent from the key — two paths graded
    // differently share one program, as they should.
    mat.customProgramCacheKey = () => 'path-color-grade';
  }
  // Y_OFFSET alone stops resolving against the ground once the depth buffer's
  // step size at that distance exceeds 3cm — see src/render/depthBias.js.
  //
  // Deliberately a BIGGER bias than the ground-texture overlay's default: the
  // two decals are only 15mm apart in world space (0.015 vs 0.03), so an
  // identical bias cancels out and leaves them fighting over the same depth
  // value at any distance where 15mm is under one depth step. The overlay
  // renders after paths (renderOrder 1), so it won that coin-flip. A larger
  // constant keeps paths ahead at every distance, which is the whole point of
  // biasing in clip space.
  applyDecalDepthBias(mat, PATH_DEPTH_BIAS + (layerIndex % MAX_PATH_LAYERS) * PATH_LAYER_BIAS_STEP);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = path.id ? `path-${path.id}` : 'path-draft';
  mesh.receiveShadow = true;
  // THE reason paths had a "draw distance". buildWorldMeshes adds paths to the
  // scene BEFORE its toonify(scene) sweep, and toonify rebuilds a material
  // from scratch carrying over only colour/map/opacity/emissive — it has no
  // idea about onBeforeCompile, so the depth bias applied two lines up was
  // being silently thrown away on every path in the game. The ground-texture
  // overlay is built AFTER toonify specifically to dodge this, so it kept its
  // bias: the overlay was pulled toward the camera and the path was not, so
  // the overlay actively won, and all that held it off was the raw 15mm +
  // 4mm-per-layerIndex gap. That resolves only near the camera, varies with
  // view angle, and shifts every time paths are reordered — which is why
  // redrawing one path (moving it to the end of world.paths, and everything
  // else down a layer) fixed that one and broke another.
  mesh.userData.preserveMaterial = true;
  return mesh;
}

// Coarse XZ grid used to decide which paths could possibly z-fight. Smaller
// than the narrowest road, so a cell is never shared by two paths that don't
// really touch.
const LAYER_CELL_SIZE = 2;

/** Stamps the cells a path's ribbon covers into `cellOwners` (cell key -> path indices). */
function stampPathCells(path, index, cellOwners) {
  const half = (path.width ?? DEFAULT_PATH_WIDTH) / 2 + LAYER_CELL_SIZE; // margin: the drawn ribbon is a spline, it bows outside the authored polyline
  const points = path.points || [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(segLen / (LAYER_CELL_SIZE / 2)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const x0 = Math.floor((x - half) / LAYER_CELL_SIZE);
      const x1 = Math.floor((x + half) / LAYER_CELL_SIZE);
      const z0 = Math.floor((z - half) / LAYER_CELL_SIZE);
      const z1 = Math.floor((z + half) / LAYER_CELL_SIZE);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cz = z0; cz <= z1; cz++) {
          const key = `${cx},${cz}`;
          let owners = cellOwners.get(key);
          if (!owners) cellOwners.set(key, (owners = new Set()));
          owners.add(index);
        }
      }
    }
  }
}

/**
 * Gives each path a depth layer, reusing layers freely between paths that
 * never touch. Two paths only need to be separated where they overlap in XZ,
 * so this is graph colouring: build the "these two share ground" graph from a
 * coarse occupancy grid, then greedily assign each path the lowest layer none
 * of its neighbours already holds.
 *
 * A city grid colours in 2 (every north-south road conflicts only with the
 * east-west ones), and even a tangle of 60+ paths settles in a handful — which
 * is what keeps the total height spread invisible no matter how many roads get
 * drawn. Layers are assigned in array order, so adding a path never renumbers
 * the existing ones.
 */
export function assignPathLayers(paths) {
  const cellOwners = new Map();
  paths.forEach((path, i) => stampPathCells(path, i, cellOwners));

  const neighbours = paths.map(() => new Set());
  for (const owners of cellOwners.values()) {
    if (owners.size < 2) continue;
    for (const a of owners) {
      for (const b of owners) if (a !== b) neighbours[a].add(b);
    }
  }

  const layers = new Array(paths.length).fill(0);
  for (let i = 0; i < paths.length; i++) {
    const taken = new Set();
    for (const n of neighbours[i]) if (n < i) taken.add(layers[n]);
    let layer = 0;
    while (layer < MAX_PATH_LAYERS && taken.has(layer)) layer++;
    // Past the cap a crossing may fight again, but a path that genuinely
    // overlaps eight differently-layered others is pathological — and a rare
    // flicker beats every road after the 8th hovering off the ground.
    layers[i] = layer % MAX_PATH_LAYERS;
  }
  return layers;
}

/** Builds every path in the world into one Group (one child mesh per path). */
export function buildPathMeshes(world) {
  const group = new THREE.Group();
  group.name = 'paths';
  const paths = world.paths || [];
  // Each overlapping pair gets its own depth layer so crossings resolve
  // deterministically instead of flickering. NOT the array index — see
  // MAX_PATH_LAYERS.
  const layers = assignPathLayers(paths);
  paths.forEach((path, i) => {
    const mesh = buildPathMesh(path, world, layers[i]);
    if (mesh) group.add(mesh);
  });
  return group;
}
