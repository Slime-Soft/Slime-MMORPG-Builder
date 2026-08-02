// src/generators/environment/longhouse.js
// A detailed Viking-longhouse-style building matching Dennis's reference
// screenshots: a stone plinth, log-post walls, a diamond-scale shingled roof,
// a ridge beam, and crossed roof-beam "horn" ornaments at each gable end.
// Built entirely from primitive geometry — no textures, per the project's
// "everything is real 3D geometry" rule: the shingle scale pattern is
// hundreds of small diamond shapes tiled across the roof and merged into one
// mesh per panel (same technique as the tree canopy rework — one draw call
// regardless of shingle count), not a texture map.
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';
import { logWallGeometry, shingleRoofPanelGeometry } from './buildingParts.js';

const ROOF_COLORS = [0x3f6f8a, 0x4a7a5f, 0x6b4a3a];
const WALL_COLORS = [0x6b4a34, 0x5a3d2b, 0x7a5540];
const STONE_COLORS = [0x8f867d, 0x999088, 0x776e64];
const TRIM_COLOR = 0x3a2818;
const LOG_POST_RADIUS = 0.22; // must match buildingParts.js's logWallGeometry

/** A short stone plinth the whole building sits on. */
function buildPlinth(width, depth, rng) {
  const height = range(rng, 0.35, 0.55);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.5, height, depth + 0.5),
    new THREE.MeshStandardMaterial({ color: pick(rng, STONE_COLORS) })
  );
  mesh.position.y = height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, height };
}

/** One wall face: a row of vertical half-round log posts — reads as log construction instead of a flat painted box. */
function buildLogWall(length, height, color) {
  const mesh = new THREE.Mesh(logWallGeometry(length, height), new THREE.MeshStandardMaterial({ color }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A sloped roof panel tiled with staggered diamond shingles — the "fish scale" look. */
function buildShinglePanel(slopeLength, panelDepth, color) {
  const mesh = new THREE.Mesh(shingleRoofPanelGeometry(slopeLength, panelDepth), new THREE.MeshStandardMaterial({ color }));
  mesh.castShadow = true;
  return mesh;
}

/** Two beams crossing exactly at the ridge peak — the Norse gable "horn" ornament, tips poking up past the roofline. */
function buildRoofHorns(ridgeY, roofHeight) {
  const group = new THREE.Group();
  const beamLen = roofHeight * 1.6;
  const geo = new THREE.CylinderGeometry(0.06, 0.1, beamLen, 5);
  const mat = new THREE.MeshStandardMaterial({ color: TRIM_COLOR });
  for (const sign of [-1, 1]) {
    const beam = new THREE.Mesh(geo, mat);
    beam.position.y = ridgeY; // both beams pivot around the same point, so they cross there exactly
    beam.rotation.z = sign * 0.5;
    beam.castShadow = true;
    group.add(beam);
  }
  return group;
}

/** The triangular gable-end wall — without this the space between the flat wall top and the sloped roof above it is just open air. */
function buildGableEnd(width, roofHeight, color) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(0, roofHeight);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A small framed window: a trim box plus a glass-toned pane, built facing local +Z (the caller rotates it to match whichever wall it sits on). */
function buildWindow(w, h) {
  const group = new THREE.Group();
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.15, h + 0.15, 0.1),
    new THREE.MeshStandardMaterial({ color: TRIM_COLOR })
  );
  frame.castShadow = true;
  group.add(frame);
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ color: 0x3a5a6a })
  );
  pane.position.z = 0.06;
  group.add(pane);
  return group;
}

/**
 * @param {number} seed
 * @param {{width?:number, depth?:number, wallHeight?:number, wallColor?:number, roofColor?:number}} [options]
 */
export function generateLonghouse(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? range(rng, 6, 10);
  const depth = options.depth ?? range(rng, 8, 14);
  const wallHeight = options.wallHeight ?? range(rng, 2.6, 3.4);
  const wallColor = options.wallColor ?? pick(rng, WALL_COLORS);
  const roofColor = options.roofColor ?? pick(rng, ROOF_COLORS);

  const group = new THREE.Group();

  const { mesh: plinth, height: plinthHeight } = buildPlinth(width, depth, rng);
  group.add(plinth);
  const wallY = plinthHeight;

  const frontWall = buildLogWall(width, wallHeight, wallColor);
  frontWall.position.set(0, wallY, depth / 2 - 0.1);
  group.add(frontWall);
  const backWall = buildLogWall(width, wallHeight, wallColor);
  backWall.position.set(0, wallY, -depth / 2 + 0.1);
  group.add(backWall);
  const leftWall = buildLogWall(depth, wallHeight, wallColor);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-width / 2 + 0.1, wallY, 0);
  group.add(leftWall);
  const rightWall = buildLogWall(depth, wallHeight, wallColor);
  rightWall.rotation.y = Math.PI / 2;
  rightWall.position.set(width / 2 - 0.1, wallY, 0);
  group.add(rightWall);

  // Drawn once and reused for both the gable infill and the roof panels
  // below — two separate draws for what has to be the same physical height
  // is exactly what caused "doesn't align at the top": the gable triangle
  // and the roof peak disagreeing on how tall the roof actually is.
  const roofHeight = range(rng, 2.0, 2.8);

  // Gable-end infill: without this, the triangular gap between the flat
  // wall top and the sloped roof above it (front and back) is just open air.
  const gableFront = buildGableEnd(width, roofHeight, wallColor);
  gableFront.position.set(0, wallY + wallHeight, depth / 2 - 0.1);
  group.add(gableFront);
  const gableBack = buildGableEnd(width, roofHeight, wallColor);
  gableBack.rotation.y = Math.PI; // faces outward the other way
  gableBack.position.set(0, wallY + wallHeight, -depth / 2 + 0.1);
  group.add(gableBack);

  // Roof: gabled ridge running along depth, two shingled panels sloping down
  // across width — same A-frame math the old flat-panel longhouse used.
  const slopeAngle = Math.atan2(roofHeight, width / 2);
  const slopeLength = Math.hypot(width / 2, roofHeight);
  const roofBaseY = wallY + wallHeight;
  const panelDepth = depth + 0.8; // eave overhang at the gable ends only — doesn't touch the ridge-side edge

  const rightPanel = buildShinglePanel(slopeLength, panelDepth, roofColor);
  rightPanel.position.set(width / 4, roofBaseY + roofHeight / 2, 0);
  rightPanel.rotation.z = -slopeAngle;
  group.add(rightPanel);

  const leftPanel = buildShinglePanel(slopeLength, panelDepth, roofColor);
  leftPanel.position.set(-width / 4, roofBaseY + roofHeight / 2, 0);
  leftPanel.rotation.z = slopeAngle;
  group.add(leftPanel);

  const ridgeY = roofBaseY + roofHeight;

  // Leaned outward (away from the building) rather than standing straight
  // up: front and back are both centered near x=0 at the same ridge height,
  // so viewed head-on they used to sit almost exactly on top of each other —
  // reading as one confused 4-line tangle instead of two separate ornaments.
  // Leaning each one away from center visually separates them by depth in
  // perspective, and reads closer to how a real Norse gable horn flares out.
  const hornsFront = buildRoofHorns(ridgeY, roofHeight);
  hornsFront.position.z = panelDepth / 2 + 0.15;
  hornsFront.rotation.x = 0.3;
  group.add(hornsFront);
  const hornsBack = buildRoofHorns(ridgeY, roofHeight);
  hornsBack.position.z = -(panelDepth / 2 + 0.15);
  hornsBack.rotation.x = -0.3;
  group.add(hornsBack);

  // Windows: two per wall (skipping straight through the doorway on the
  // front) — a bare log wall with only a door read as "naked".
  const windowW = 0.9;
  const windowH = 1.0;
  const windowY = wallY + wallHeight * 0.6;
  // The log posts' round cross-section sticks out LOG_POST_RADIUS past the
  // wall's own centerline — anything meant to sit "on" the wall face has to
  // clear that, or the posts physically occlude it. This is why the windows
  // weren't visible at all: they were built at the wall's centerline offset,
  // well inside the posts' outer surface.
  const wallFaceOffset = LOG_POST_RADIUS + 0.1;
  for (const sign of [-1, 1]) {
    const front = buildWindow(windowW, windowH);
    front.position.set(sign * width * 0.3, windowY, depth / 2 - 0.1 + wallFaceOffset);
    group.add(front);

    const back = buildWindow(windowW, windowH);
    back.rotation.y = Math.PI;
    back.position.set(sign * width * 0.3, windowY, -depth / 2 + 0.1 - wallFaceOffset);
    group.add(back);

    const left = buildWindow(windowW, windowH);
    left.rotation.y = -Math.PI / 2;
    left.position.set(-width / 2 + 0.1 - wallFaceOffset, windowY, sign * depth * 0.28);
    group.add(left);

    const right = buildWindow(windowW, windowH);
    right.rotation.y = Math.PI / 2;
    right.position.set(width / 2 - 0.1 + wallFaceOffset, windowY, sign * depth * 0.28);
    group.add(right);
  }

  // Door: a framed opening, not just a flat plane on the wall face — real
  // walk-through geometry comes with the interior/instancing rework.
  const doorWidth = 1.5;
  const doorHeight = 2.2;
  const doorFrame = new THREE.Mesh(
    new THREE.BoxGeometry(doorWidth + 0.3, doorHeight + 0.25, 0.15),
    new THREE.MeshStandardMaterial({ color: TRIM_COLOR })
  );
  doorFrame.position.set(0, wallY + doorHeight / 2, depth / 2 - 0.1 + wallFaceOffset);
  doorFrame.castShadow = true;
  group.add(doorFrame);
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(doorWidth, doorHeight),
    new THREE.MeshStandardMaterial({ color: 0x0f0a08 })
  );
  door.position.set(0, wallY + doorHeight / 2, depth / 2 - 0.1 + wallFaceOffset + 0.08);
  group.add(door);

  return group;
}
