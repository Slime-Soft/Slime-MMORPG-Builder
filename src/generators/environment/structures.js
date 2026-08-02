// src/generators/environment/structures.js
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';
import { generateLonghouse } from './longhouse.js';

// The wall segment used to live here as a box with a row of cubes on top. It
// was rebuilt from Dennis's reference sheets into a full modular kit (battered
// base, corbelled cornice, wall-walk, arrow loops) and moved to cityWall.js
// alongside the towers and the gatehouse. Re-exported under the original name
// so src/render/scene.js and the World Editor keep importing it from here.
export { generateWallSegment } from './cityWall.js';

/** Building silhouettes selectable by `type` in generateBuildingShell — anything else falls back to 'cottage'. */
export const BUILDING_SHAPES = ['cottage', 'shop', 'guild-hall', 'longhouse'];

/**
 * A building shell: box footprint plus a roof whose shape depends on
 * `options.type` (see BUILDING_SHAPES) — previously every building used the
 * same box-and-pyramid silhouette regardless of its `type` field, so a shop
 * and a guild hall looked identical. Interior furniture is generated
 * separately (see interior/furniture.js) and placed inside once the World
 * Editor links an interior scene.
 */
export function generateBuildingShell(seed, options = {}) {
  const shape = BUILDING_SHAPES.includes(options.type) ? options.type : 'cottage';

  // 'longhouse' is a fully bespoke build (stone plinth, log walls, shingled
  // roof, gable horns) — see longhouse.js — not a variation on the generic
  // box-walls-plus-roof shape every other type shares below.
  if (shape === 'longhouse') return generateLonghouse(seed, options);

  const rng = createRng(seed);
  const width = options.width ?? range(rng, 6, 12);
  const depth = options.depth ?? range(rng, 6, 10);
  const wallHeight = options.wallHeight ?? range(rng, 3, 4.5);
  const wallColor = options.wallColor ?? pick(rng, [0xc9a876, 0xd6b98a, 0xb89468]);
  const roofColor = options.roofColor ?? pick(rng, [0x8a3f3f, 0x6b4a3a, 0x555555]);

  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor });
  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor });
  const group = new THREE.Group();

  const walls = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), wallMat);
  walls.position.y = wallHeight / 2;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  if (shape === 'shop') {
    // Flat overhanging roof slab plus a small tilted awning over the
    // doorway — reads as a storefront rather than a house.
    const roofThickness = 0.3;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.8, roofThickness, depth + 0.8), roofMat);
    roof.position.y = wallHeight + roofThickness / 2;
    roof.castShadow = true;
    group.add(roof);

    const awning = new THREE.Mesh(new THREE.BoxGeometry(width * 0.6, 0.12, 1.0), roofMat);
    awning.position.set(0, wallHeight - 0.3, depth / 2 + 0.5);
    awning.rotation.x = -0.3;
    awning.castShadow = true;
    group.add(awning);
  } else if (shape === 'guild-hall') {
    // Grander two-tier silhouette: a narrower, taller second story set back
    // on top of the main walls, capped with the same pyramid roof cottages
    // use — reads as more important than a single-story building.
    const upperWidth = width * 0.55;
    const upperDepth = depth * 0.55;
    const upperHeight = range(rng, 1.8, 2.4);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(upperWidth, upperHeight, upperDepth), wallMat);
    upper.position.y = wallHeight + upperHeight / 2;
    upper.castShadow = true;
    group.add(upper);

    const roofHeight = range(rng, 1.6, 2.2);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(upperWidth, upperDepth) * 0.75, roofHeight, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = wallHeight + upperHeight + roofHeight / 2;
    roof.castShadow = true;
    group.add(roof);
  } else {
    // cottage (default): box walls capped with a simple pyramid roof.
    const roofHeight = range(rng, 1.5, 2.5);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(width, depth) * 0.75, roofHeight, 4), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = wallHeight + roofHeight / 2;
    roof.castShadow = true;
    group.add(roof);
  }

  // Door gap marker (dark rectangle) — real doorway/interior linking comes
  // with the World Editor's interior mode in Phase 3.
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 2.2),
    new THREE.MeshStandardMaterial({ color: 0x2a1e14 })
  );
  door.position.set(0, 1.1, depth / 2 + 0.01);
  group.add(door);

  return group;
}
