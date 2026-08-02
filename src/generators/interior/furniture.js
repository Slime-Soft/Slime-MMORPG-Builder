// src/generators/interior/furniture.js
import * as THREE from 'three';
import { createRng, range, pick } from '../seededRandom.js';

const WOOD_COLORS = [0x6b4a34, 0x7a5a3f, 0x5a3d2b];

function woodMat(rng) {
  return new THREE.MeshStandardMaterial({ color: pick(rng, WOOD_COLORS) });
}

export function generateTable(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? range(rng, 1.2, 2.0);
  const depth = options.depth ?? range(rng, 0.8, 1.4);
  const height = 0.75;
  const mat = woodMat(rng);

  const group = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, depth), mat);
  top.position.y = height;
  top.castShadow = true;
  group.add(top);

  const legOffsets = [
    [width / 2 - 0.1, depth / 2 - 0.1],
    [-(width / 2 - 0.1), depth / 2 - 0.1],
    [width / 2 - 0.1, -(depth / 2 - 0.1)],
    [-(width / 2 - 0.1), -(depth / 2 - 0.1)],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, height, 6), mat);
    leg.position.set(lx, height / 2, lz);
    leg.castShadow = true;
    group.add(leg);
  }
  return group;
}

export function generateChair(seed) {
  const rng = createRng(seed);
  const mat = woodMat(rng);
  const group = new THREE.Group();

  const seatH = 0.45;
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), mat);
  seat.position.y = seatH;
  seat.castShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.06), mat);
  back.position.set(0, seatH + 0.25, -0.2);
  back.castShadow = true;
  group.add(back);

  const legOffsets = [
    [0.18, 0.18], [-0.18, 0.18], [0.18, -0.18], [-0.18, -0.18],
  ];
  for (const [lx, lz] of legOffsets) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, seatH, 6), mat);
    leg.position.set(lx, seatH / 2, lz);
    leg.castShadow = true;
    group.add(leg);
  }
  return group;
}

export function generateBed(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? 1.2;
  const length = options.length ?? 2.0;
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.35, length),
    woodMat(rng)
  );
  frame.position.y = 0.175;
  frame.castShadow = true;
  group.add(frame);

  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.92, 0.18, length * 0.94),
    new THREE.MeshStandardMaterial({ color: 0xe8e0d0 })
  );
  mattress.position.y = 0.35 + 0.09;
  mattress.castShadow = true;
  group.add(mattress);

  const pillow = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.7, 0.1, length * 0.22),
    new THREE.MeshStandardMaterial({ color: 0xffffff })
  );
  pillow.position.set(0, 0.35 + 0.18 + 0.05, -length * 0.35);
  group.add(pillow);

  return group;
}

export function generateShelf(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? 1.4;
  const height = options.height ?? 1.8;
  const depth = 0.35;
  const mat = woodMat(rng);
  const group = new THREE.Group();

  const frame = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  frame.position.y = height / 2;
  frame.castShadow = true;
  group.add(frame);

  const shelfCount = 3;
  for (let i = 1; i <= shelfCount; i++) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.94, 0.04, depth * 0.9),
      mat
    );
    plank.position.y = (height / (shelfCount + 1)) * i;
    group.add(plank);
  }
  return group;
}

export function generateCounter(seed, options = {}) {
  const rng = createRng(seed);
  const width = options.width ?? range(rng, 1.8, 3.0);
  const mat = woodMat(rng);
  const group = new THREE.Group();

  const base = new THREE.Mesh(new THREE.BoxGeometry(width, 0.9, 0.6), mat);
  base.position.y = 0.45;
  base.castShadow = true;
  group.add(base);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.03, 0.06, 0.66),
    new THREE.MeshStandardMaterial({ color: 0x3a2a1f })
  );
  top.position.y = 0.93;
  group.add(top);

  return group;
}

/** Generic entry point used by interior placement tooling. */
export function generateFurniture(type, seed, options = {}) {
  switch (type) {
    case 'table': return generateTable(seed, options);
    case 'chair': return generateChair(seed);
    case 'bed': return generateBed(seed, options);
    case 'shelf': return generateShelf(seed, options);
    case 'counter': return generateCounter(seed, options);
    default:
      throw new Error(`Unknown furniture type: "${type}"`);
  }
}
