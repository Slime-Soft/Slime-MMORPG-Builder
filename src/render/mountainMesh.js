// src/render/mountainMesh.js
// Turns a world.mountains[] entry (an ordered polyline + width + peakHeight
// + theme) into a terrain-following ribbon mesh — same technique as
// src/render/pathMesh.js's buildPathMesh, extended from a 2-vertex (left/
// right edge) cross-section to a multi-column strip so the mesh actually
// shows the crest that stampMountainHeight (src/sim/mountains.js) raised
// into the middle of the footprint, not just a flat chord across it.
//
// This mesh is opaque (no `transparent`/alpha), unlike the ground-texture
// paint layer (src/render/groundTextureMesh.js) — it fully replaces the
// base ground's color under its footprint instead of alpha-compositing
// over it, which is what makes it immune to the "green gaps between
// brush strokes" problem that alpha-blended decal painting has.
import * as THREE from 'three';
import { sampleTerrainHeight } from '../sim/world.js';
import { getMountainThemeTexture } from './mountainThemes.js';
import { DEFAULT_MOUNTAIN_WIDTH } from '../sim/mountains.js';

const Y_OFFSET = 0.02; // above the ground-texture overlay (0.015) so mountain rock reads over it, below paths (0.03) so a trail drawn across a ridge still shows on top
const MAX_SAMPLES = 300; // safety cap for very long/dense drafts — matches pathMesh.js's reasoning
const CROSS_COLS = 5; // vertices across the width per length-sample: edge, quarter, center, quarter, edge

/** Resample a polyline through a Catmull-Rom spline at ~evenly-spaced intervals — identical technique to pathMesh.js's resamplePoints. */
function resampleRidgePoints(points, spacing) {
  if (points.length < 2) return points.slice();
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p.x, 0, p.z)),
    false,
    'catmullrom',
    0.5
  );
  const length = curve.getLength();
  const numSamples = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil(length / Math.max(0.1, spacing))));
  return curve.getSpacedPoints(numSamples).map((v) => ({ x: v.x, z: v.z }));
}

/**
 * Builds a single ribbon Mesh for one mountain ridge. Returns null if the
 * ridge has fewer than 2 points (an in-progress draft with only the first
 * click placed).
 */
export function buildMountainRidgeMesh(ridge, world) {
  const width = ridge.width ?? DEFAULT_MOUNTAIN_WIDTH;
  if (!ridge.points || ridge.points.length < 2) return null;

  const sampled = resampleRidgePoints(ridge.points, Math.max(0.5, width * 0.35));
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
    const nx = -tz; // perpendicular in the XZ plane, same convention as pathMesh.js
    const nz = tx;

    if (i > 0) arcLength += Math.hypot(p.x - sampled[i - 1].x, p.z - sampled[i - 1].z);
    const v = arcLength / Math.max(0.5, width);

    for (let col = 0; col < CROSS_COLS; col++) {
      const u = col / (CROSS_COLS - 1) - 0.5; // -0.5 (left edge) .. 0.5 (right edge)
      const cx = p.x + nx * u * width;
      const cz = p.z + nz * u * width;
      // Reads back whatever stampMountainHeight actually wrote (plus any
      // manual terrain sculpting layered on top of it) — the crest shape
      // here always matches the real heightmap, never a hand-rolled curve.
      const cy = sampleTerrainHeight(world, cx, cz) + Y_OFFSET;
      positions.push(cx, cy, cz);
      uvs.push(col / (CROSS_COLS - 1), v);
    }
  }

  const indices = [];
  for (let i = 1; i < sampled.length; i++) {
    for (let col = 0; col < CROSS_COLS - 1; col++) {
      const a = (i - 1) * CROSS_COLS + col;
      const b = a + 1;
      const c = i * CROSS_COLS + col;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const texture = getMountainThemeTexture(ridge.theme || 'rock');
  const mat = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide, // cheap insurance against a winding mistake making the ribbon invisible from above
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = ridge.id ? `mountain-${ridge.id}` : 'mountain-draft';
  mesh.receiveShadow = true;
  return mesh;
}

/** Builds every mountain ridge in the world into one Group (one child mesh per ridge). */
export function buildMountainMeshes(world) {
  const group = new THREE.Group();
  group.name = 'mountains';
  for (const ridge of world.mountains || []) {
    const mesh = buildMountainRidgeMesh(ridge, world);
    if (mesh) group.add(mesh);
  }
  return group;
}
