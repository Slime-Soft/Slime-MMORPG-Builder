// scripts/generate-city.mjs
// Authoring tool that lays out Silverspire, the walled player-hub city, and
// writes it as a FIXED map file (world/maps/silverspire.json).
//
// This does not violate CLAUDE.md's "the world is fixed, not procedurally
// generated at the layout level". The output is a static JSON file, checked in
// and editable in the World Editor like any hand-placed map. Re-running
// OVERWRITES the map, so once you start editing Silverspire in the editor,
// stop running this.
//
//   node scripts/generate-city.mjs
//
// LAYOUT (rev 3 — quarters + park)
//   r 0-24    the Great Tower's plinth
//   r <56     flagstone plaza
//   r 56-106  the built-up city: three housing rows, two ring roads, and four
//             QUARTERS occupying the wedges between the avenues —
//             Market (45deg), Crafting (135deg), Mage (225deg), Training (315deg)
//   r 108-130 the Green Ring: a park belt of grass, trees, benches and four
//             fountain squares. This band was the single biggest patch of dead
//             ground in rev 2 (~740m of circumference doing nothing).
//   r 132     the city wall, with four gatehouses on the avenues
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// propTypes is pure sim data (no Three), so the layout script can size every
// collider exactly the way the server will.
import { getPropType } from '../src/sim/propTypes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_ID = 'silverspire';
const MAP_NAME = 'Silverspire';

let _s = 20260726;
const rnd = () => {
  _s = (Math.imul(_s ^ (_s >>> 15), 1 | _s) + 0x6d2b79f5) | 0;
  let t = _s;
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rr = (a, b) => a + rnd() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const seed = () => Math.floor(rnd() * 2 ** 30);
const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
/** Shortest signed angular distance, always in [-PI, PI]. */
const angDiff = (a, b) => Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);

const PLAZA_R = 54;
const RING_A = 78;
const RING_B = 112;
const PARK_IN = 108;
const PARK_OUT = 130;
const WALL_R = 132;
const GATE_HALF = 8;
const MAIN_AVENUES = [0, 90, 180, 270];

const faceCentre = (a) => +deg(Math.atan2(-Math.cos(a), -Math.sin(a))).toFixed(1);
const faceOut = (a) => +(faceCentre(a) + 180).toFixed(1);

const world = {
  id: MAP_ID, name: MAP_NAME, mapType: 'overworld',
  bounds: { minX: -400, maxX: 400, minZ: -400, maxZ: 400 },  // countryside reaches r=330
  spawnPoint: { x: 0, y: 0, z: 120 },
  terrain: { resolution: 256, heights: new Array(257 * 257).fill(0) },
  zones: [], props: [], buildings: [], walls: [], npcs: [], monsters: [],
  gatheringNodes: [], paths: [], groundTextures: [], mountains: [],
  teleporters: [], events: [], waterBodies: [],
  waterMask: { resolution: 64, level: 0, cells: new Array(65 * 65).fill(0) },
  grassMask: { resolution: 256, cells: new Array(257 * 257).fill(0) },
  treeSettings: {},
  graphicsSettings: (() => {
    const g = JSON.parse(readFileSync(path.join(ROOT, 'world/maps/overworld-default.json'), 'utf8')).graphicsSettings;
    if (g?.light) { g.light.shadowRange = 150; g.light.shadowBias = 0; g.light.shadowNormalBias = 0.25; }
    return g;
  })(),
};

// --- Placement with an overlap guard -----------------------------------------
// Hand-placing ~700 props by polar maths reliably buries a lantern inside a
// fence and a planter inside a hay bale. Rather than tuning each case by hand,
// every SOLID prop is recorded in a coarse spatial grid and `tryProp` refuses a
// placement that would interpenetrate one already there. Structural pieces
// (buildings, the tower, gate furniture) use `prop`, which always places and
// therefore always wins; decoration uses `tryProp` and yields.
const CELL = 8;
const grid = new Map();
const keyOf = (x, z) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const radiusOf = (type, scale) => {
  const def = getPropType(type);
  return def?.collider?.kind === 'fixed' ? def.collider.radius * (scale || 1) : 0;
};
/** @param {number} [explicitR] bypasses the propType lookup — used for buildings, which aren't in propTypes. */
function remember(type, x, z, scale, explicitR) {
  const r = explicitR ?? radiusOf(type, scale);
  if (!r) return;
  const k = keyOf(x, z);
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push({ x, z, r });
}
/** @param {number} slack 1 = touching allowed; <1 permits gentle overlap. @param {number} [explicitR] see remember(). */
function clear(type, x, z, scale, slack = 0.92, explicitR) {
  const r = explicitR ?? radiusOf(type, scale);
  if (!r) return true;
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  const reach = Math.ceil((r + 12) / CELL);
  for (let ix = gx - reach; ix <= gx + reach; ix++) {
    for (let iz = gz - reach; iz <= gz + reach; iz++) {
      for (const o of grid.get(`${ix},${iz}`) || []) {
        if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * slack) return false;
      }
    }
  }
  return true;
}

// Real buildings (world.buildings), not props — the 13 townhouse.js designs
// rebuilt as editable Building Builder types (scripts/generate-town-buildings.mjs
// must have been run at least once so these ids exist). Footprints are read
// from the live file rather than hardcoded, so a footprint Dennis tweaks in
// buildings.html is honoured here on the next city regeneration too.
const buildingFootprints = Object.fromEntries(
  JSON.parse(readFileSync(path.join(ROOT, 'building-types/building-types.json'), 'utf8'))
    .filter((t) => t.id.startsWith('th-'))
    .map((t) => [t.id, t.footprint])
);
let buildingN = 0;
const building = (buildingTypeId, x, z, rotationDeg = 0) => {
  const footprint = buildingFootprints[buildingTypeId];
  if (!footprint) throw new Error(`Unknown building type "${buildingTypeId}" — run generate-town-buildings.mjs first`);
  world.buildings.push({
    id: `bld-${buildingN++}`, type: 'custom', buildingTypeId, seed: seed(),
    position: { x: +x.toFixed(2), y: 0, z: +z.toFixed(2) },
    rotationDeg: +(+rotationDeg).toFixed(1), footprint,
  });
  // Tracked in the SAME overlap grid as props, so street dressing placed
  // after a building never gets buried in its walls. A circle covering the
  // diagonal is conservative near the corners rather than exact, which is
  // the safe direction to be wrong in here.
  remember(buildingTypeId, x, z, 1, Math.hypot(footprint.width, footprint.depth) / 2);
  return true;
};
const buildingAt = (typeId, a, r, rotationDeg) =>
  building(typeId, Math.cos(a) * r, Math.sin(a) * r, rotationDeg === undefined ? faceCentre(a) : rotationDeg);
/** Places only if nothing solid already occupies the footprint's bounding circle. */
const tryBuildingAt = (typeId, a, r, rotationDeg) => {
  const footprint = buildingFootprints[typeId];
  const cr = Math.hypot(footprint.width, footprint.depth) / 2;
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  if (!clear(typeId, x, z, 1, 0.85, cr)) { skipped++; return false; }
  return buildingAt(typeId, a, r, rotationDeg);
};

const prop = (type, x, z, rotationDeg = 0, scale = 1) => {
  world.props.push({
    type, seed: seed(),
    position: { x: +x.toFixed(2), y: 0, z: +z.toFixed(2) },
    rotationDeg: +(+rotationDeg).toFixed(1), scale,
  });
  remember(type, x, z, scale);
  return true;
};
/** Places only if nothing solid is already there. Returns whether it landed. */
const tryProp = (type, x, z, rotationDeg = 0, scale = 1) => {
  if (!clear(type, x, z, scale)) { skipped++; return false; }
  return prop(type, x, z, rotationDeg, scale);
};
let skipped = 0;

/** Place at polar coordinates, which is how the whole city is reasoned about. */
const propAt = (type, a, r, rotationDeg, scale) =>
  prop(type, Math.cos(a) * r, Math.sin(a) * r,
    rotationDeg === undefined ? faceCentre(a) : rotationDeg, scale);
const tryPropAt = (type, a, r, rotationDeg, scale) =>
  tryProp(type, Math.cos(a) * r, Math.sin(a) * r,
    rotationDeg === undefined ? faceCentre(a) : rotationDeg, scale);

// =============================================================================
// The four quarters
// =============================================================================
const QUARTERS = [
  { id: 'market', name: 'Market Quarter', deg: 45 },
  { id: 'craft', name: 'Crafting Quarter', deg: 135 },
  { id: 'mage', name: 'Mage Quarter', deg: 225 },
  { id: 'training', name: 'Training Quarter', deg: 315 },
];
const SQUARE_R = 78;        // each quarter's square sits on the inner ring road
const SQUARE_HALF = 0.34;   // radians; ~26m of arc

world.zones.push({ id: 'silverspire-city', type: 'city', center: { x: 0, y: 0, z: 0 }, radius: WALL_R });
for (const q of QUARTERS) {
  const a = rad(q.deg);
  world.zones.push({
    id: `silverspire-${q.id}`, type: 'district',
    center: { x: +(Math.cos(a) * SQUARE_R).toFixed(2), y: 0, z: +(Math.sin(a) * SQUARE_R).toFixed(2) },
    radius: 30,
  });
}

const inSquare = (a, r) =>
  QUARTERS.some((q) => r > SQUARE_R - 16 && r < SQUARE_R + 16 && angDiff(a, rad(q.deg)) < SQUARE_HALF + 0.06);

// =============================================================================
// Wall + gatehouses
// =============================================================================
const WALL_SEGS = 44;
const segArc = (Math.PI * 2) / WALL_SEGS;
const segLen = 2 * WALL_R * Math.sin(segArc / 2) + 0.6;
for (let i = 0; i < WALL_SEGS; i++) {
  const a = i * segArc;
  if (MAIN_AVENUES.some((d) => angDiff(a, rad(d)) * WALL_R < GATE_HALF + segLen / 2)) continue;
  world.walls.push({
    id: `wall-${i}`, seed: seed(),
    position: { x: +(Math.cos(a) * WALL_R).toFixed(2), y: 0, z: +(Math.sin(a) * WALL_R).toFixed(2) },
    rotationDeg: faceCentre(a), length: segLen, height: 10, thickness: 2.6,
  });
}
for (const gd of MAIN_AVENUES) {
  const a = rad(gd);
  for (const side of [-1, 1]) {
    const ta = a + side * ((GATE_HALF + 7) / WALL_R);
    buildingAt('th-bld-workshop', ta, WALL_R - 2);
    tryPropAt('banner-pole', a + side * ((GATE_HALF + 2.5) / WALL_R), WALL_R - 8, undefined, 1.1);
    tryPropAt('street-lantern', a + side * ((GATE_HALF + 1.5) / WALL_R), WALL_R - 14);
  }
  tryPropAt('signpost', a + 0.06, WALL_R - 20);
}

// =============================================================================
// Tower + teleporters
// =============================================================================
world.props.push({ type: 'tower-great', seed: 1, position: { x: 0, y: 0, z: 0 }, rotationDeg: 0, scale: 1 });
// The Great Tower's collider is a single 21m circle, so the grand gate's two
// stone piers would otherwise be walk-through. Two INVISIBLE wall segments give
// them real collision while leaving the archway between them open — the whole
// point of a gate. Positions mirror greatTower.js's PIER_SIDE / PORCH_MID.
for (const side of [-1, 1]) {
  world.walls.push({
    id: `tower-gate-pier-${side > 0 ? 'r' : 'l'}`,
    seed: seed(),
    position: { x: side * 7.4, y: 0, z: 26.75 },
    rotationDeg: 90, length: 12.5, height: 16, thickness: 3.8,
    invisible: true,
  });
}

// At the FOOT of the grand gate's stair, not against the tower wall: the
// tower's collider is a 21m circle, so anything closer than that is somewhere
// the player can never actually stand.
world.teleporters.push({
  id: 'Silverspire Tower Entrance', position: { x: 0, y: 0, z: 27 },
  linkedTeleporterId: '', mode: 'instant', visible: true,
});
world.teleporters.push({
  id: 'Silverspire South Gate', position: { x: 0, y: 0, z: WALL_R + 5 },
  linkedTeleporterId: 'Default World', mode: 'instant', visible: true,
});

// =============================================================================
// Streets
// =============================================================================
for (const d of MAIN_AVENUES) {
  const a = rad(d);
  const pts = [];
  for (let r = PLAZA_R - 5; r <= WALL_R + 12; r += 10) {
    pts.push({ x: +(Math.cos(a) * r).toFixed(2), z: +(Math.sin(a) * r).toFixed(2) });
  }
  world.paths.push({ id: `avenue-${d}`, theme: 'basic', width: 10, points: pts });
}
for (const R of [RING_A, RING_B]) {
  const steps = Math.round((Math.PI * 2 * R) / 10);
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    pts.push({ x: +(Math.cos(a) * R).toFixed(2), z: +(Math.sin(a) * R).toFixed(2) });
  }
  world.paths.push({ id: `ring-${R}`, theme: 'basic', width: 8, points: pts });
}
// A winding footpath through the park ring.
{
  const steps = 90;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = (PARK_IN + PARK_OUT) / 2 + Math.sin(a * 5) * 4.5;
    pts.push({ x: +(Math.cos(a) * r).toFixed(2), z: +(Math.sin(a) * r).toFixed(2) });
  }
  world.paths.push({ id: 'park-walk', theme: 'basic', width: 4, points: pts });
}

// =============================================================================
// Ground: flagstone plaza, cobbled streets, grassy park ring
// =============================================================================
function paintLayer(id, textureId, resolution, test) {
  const n = resolution + 1;
  const cells = new Array(n * n).fill(0);
  const { minX, maxX, minZ, maxZ } = world.bounds;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = minX + (gx / resolution) * (maxX - minX);
      const z = minZ + (gz / resolution) * (maxZ - minZ);
      const v = test(x, z);
      if (v > 0) cells[gz * n + gx] = Math.min(1, v);
    }
  }
  world.groundTextures.push({ id, textureId, particleType: null, resolution, cells });
}
paintLayer('gt-plaza', 'flagstone-plaza', 200, (x, z) => (Math.hypot(x, z) <= PLAZA_R + 2 ? 1 : 0));
paintLayer('gt-streets', 'cobble', 200, (x, z) => {
  const r = Math.hypot(x, z);
  return r > PLAZA_R + 1 && r < PARK_IN ? 1 : 0;
});
paintLayer('gt-park', 'meadow', 200, (x, z) => {
  const r = Math.hypot(x, z);
  return r >= PARK_IN - 2 && r <= PARK_OUT + 1 ? 1 : 0;
});
// Real grass blades in the park band (world.grassMask drives the instanced cover).
{
  const res = world.grassMask.resolution;
  const n = res + 1;
  const { minX, maxX, minZ, maxZ } = world.bounds;
  for (let gz = 0; gz < n; gz++) {
    for (let gx = 0; gx < n; gx++) {
      const x = minX + (gx / res) * (maxX - minX);
      const z = minZ + (gz / res) * (maxZ - minZ);
      const r = Math.hypot(x, z);
      const a = Math.atan2(z, x);
      // Leave the avenues and the park footpath bare.
      const onAvenue = MAIN_AVENUES.some((d) => angDiff(a, rad(d)) * r < 7);
      const walkR = (PARK_IN + PARK_OUT) / 2 + Math.sin(a * 5) * 4.5;
      if (r >= PARK_IN && r <= PARK_OUT && !onAvenue && Math.abs(r - walkR) > 3.5) {
        world.grassMask.cells[gz * n + gx] = 0.85;
      }
    }
  }
}

// =============================================================================
// Landmarks around the plaza
// =============================================================================
const guildR = PLAZA_R + 13;
building('th-bld-guild-hall', 0, -guildR, 0);
tryProp('banner-pole', -13, -guildR + 12, 0, 1.3);
tryProp('banner-pole', 13, -guildR + 12, 0, 1.3);
tryProp('notice-board', -6, -(guildR - 16), 0);
tryProp('notice-board', 6, -(guildR - 16), 0);
world.npcs.push({
  id: 'npc-guild-master', name: 'Guild Master',
  position: { x: 0, y: 0, z: -(guildR - 15) },
  appearance: { seed: 77123, classId: 'guardian' },
  dialog: [
    'Welcome to the Adventurers Guild of Silverspire.',
    'The Tower stands at the heart of our city, and none have reached its summit.',
    'Take a contract from the board whenever you are ready.',
  ],
  wander: false, wanderRadius: 0, speed: 0,
});

const LANDMARKS = [
  { type: 'th-bld-tavern', deg: 62 }, { type: 'th-bld-inn', deg: 118 },
  { type: 'th-bld-store', deg: 242 }, { type: 'th-bld-workshop', deg: 298 },
];
for (const lm of LANDMARKS) {
  const a = rad(lm.deg);
  buildingAt(lm.type, a, PLAZA_R + 11);
  tryPropAt('shop-sign', a, PLAZA_R + 4);
  tryPropAt('street-canopy', a + 0.09, PLAZA_R + 3.5);
}

// =============================================================================
// Housing rows
// =============================================================================
const HOUSES = ['th-house-narrow', 'th-house-wide', 'th-house-tall', 'th-house-small',
  'th-house-corner', 'th-house-steep', 'th-house-squat', 'th-house-gabled'];
const avenueRad = MAIN_AVENUES.map(rad);
const clearOfAvenue = (a, r, c) => avenueRad.every((g) => angDiff(a, g) * r > c);
const landmarkAngles = [Math.PI * 1.5, ...LANDMARKS.map((l) => rad(l.deg))];
const clearOfLandmark = (a, r) =>
  r > PLAZA_R + 24 || landmarkAngles.every((g) => angDiff(a, g) * r > 15);

const ROWS = [
  { r: RING_A - 12, facing: 'in' },
  { r: RING_A + 11, facing: 'out' },
  { r: RING_B - 10, facing: 'in' },
];
let houses = 0;
for (const row of ROWS) {
  const slots = Math.max(8, Math.round((Math.PI * 2 * row.r) / 15));
  for (let i = 0; i < slots; i++) {
    const a = (i / slots) * Math.PI * 2 + rr(-0.02, 0.02);
    if (!clearOfAvenue(a, row.r, 11)) continue;
    if (!clearOfLandmark(a, row.r)) continue;
    if (inSquare(a, row.r)) continue;   // quarters get their own dressing
    const r = row.r + rr(-1.2, 1.2);
    tryBuildingAt(pick(HOUSES), a, r, row.facing === 'in' ? faceCentre(a) : faceOut(a));
    houses++;

    const front = row.facing === 'in' ? r - 7.5 : r + 7.5;
    if (rnd() < 0.34) {
      tryPropAt(pick(['barrel', 'crate', 'barrel-stack', 'crate-stack', 'flower-planter',
        'bench', 'woodpile', 'potted-tree']), a + rr(-0.03, 0.03), front, +rr(0, 360).toFixed(1));
    }
    if (rnd() < 0.16) {
      tryPropAt('shop-sign', a, front + 0.5, row.facing === 'in' ? faceCentre(a) : faceOut(a));
    }
    // Something tucked into the alley between neighbours.
    if (rnd() < 0.22) {
      const alley = a + (Math.PI * 2) / slots / 2;
      tryPropAt(pick(['barrel', 'crate', 'woodpile', 'hay-bales', 'handcart']),
        alley, r + rr(-2, 2), +rr(0, 360).toFixed(1));
    }
  }
}

// =============================================================================
// Quarter squares — each wedge gets its own trade and its own silhouette
// =============================================================================
/** Lay n props evenly across a quarter square's arc at a given radius. */
function arc(qa, r, n, fn) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const a = qa + (t - 0.5) * 2 * SQUARE_HALF;
    fn(a, r, i);
  }
}

for (const q of QUARTERS) {
  const qa = rad(q.deg);

  // Every square: a fountain-less centre marker, lanterns and a signpost.
  tryPropAt('signpost', qa - SQUARE_HALF * 0.9, SQUARE_R - 12);
  arc(qa, SQUARE_R + 14, 4, (a, r) => tryPropAt('street-lantern', a, r));
  arc(qa, SQUARE_R - 14, 4, (a, r) => tryPropAt('street-lantern', a, r));

  if (q.id === 'market') {
    // Two curved rows of stalls, carts and canopies between them.
    arc(qa, SQUARE_R + 7, 6, (a, r) => tryPropAt('market-stall', a, r, faceCentre(a)));
    arc(qa, SQUARE_R - 7, 6, (a, r) => tryPropAt('market-stall', a, r, faceOut(a)));
    arc(qa, SQUARE_R, 4, (a, r, i) => {
      tryPropAt(i % 2 ? 'handcart' : 'street-canopy', a, r, faceCentre(a));
    });
    arc(qa, SQUARE_R + 12, 5, (a, r) => tryPropAt(pick(['crate-stack', 'barrel', 'crate', 'hay-bales']), a, r, +rr(0, 360).toFixed(1)));
    tryPropAt('town-well', qa, SQUARE_R, 0, 1.2);
  }

  if (q.id === 'craft') {
    // The eight workstations, ringed with material stacks.
    const STATIONS = ['workstation-forge', 'workstation-carpenter', 'workstation-tapestry-loom',
      'workstation-floor-loom', 'workstation-tanning-rack', 'workstation-jeweler',
      'workstation-alchemy', 'workstation-hearth'];
    arc(qa, SQUARE_R + 7, 4, (a, r, i) => tryPropAt(STATIONS[i], a, r, faceCentre(a)));
    arc(qa, SQUARE_R - 7, 4, (a, r, i) => propAt(STATIONS[i + 4], a, r, faceOut(a)));
    arc(qa, SQUARE_R, 5, (a, r) => tryPropAt(pick(['woodpile', 'barrel-stack', 'crate-stack', 'handcart']), a, r, +rr(0, 360).toFixed(1)));
    arc(qa, SQUARE_R + 13, 3, (a, r) => tryPropAt('woodpile', a, r, faceCentre(a)));
    tryPropAt('town-well', qa, SQUARE_R - 13, 0, 1.1);
  }

  if (q.id === 'mage') {
    // Obelisks and braziers around a central arcane focus.
    tryPropAt('arcane-obelisk', qa, SQUARE_R, 0, 1.15);
    arc(qa, SQUARE_R + 9, 4, (a, r) => tryPropAt('arcane-brazier', a, r));
    arc(qa, SQUARE_R - 9, 4, (a, r) => tryPropAt('arcane-brazier', a, r));
    arc(qa, SQUARE_R + 14, 3, (a, r) => tryPropAt('arcane-obelisk', a, r, 0, 0.8));
    arc(qa, SQUARE_R - 13, 3, (a, r) => tryPropAt('scroll-rack', a, r, faceCentre(a)));
    arc(qa, SQUARE_R + 4, 4, (a, r) => tryPropAt(pick(['crystal-amethyst', 'crystal-frost', 'crystal-emerald']), a, r, +rr(0, 360).toFixed(1)));
    arc(qa, SQUARE_R - 4, 3, (a, r) => tryPropAt('runestone', a, r, +rr(0, 360).toFixed(1)));
    arc(qa, SQUARE_R + 12, 4, (a, r) => tryPropAt('banner-pole', a, r, faceCentre(a), 0.9));
  }

  if (q.id === 'training') {
    // A fenced sparring yard: dummies on one side, targets down the range.
    arc(qa, SQUARE_R - 8, 5, (a, r) => tryPropAt('training-dummy', a, r, faceOut(a)));
    arc(qa, SQUARE_R + 9, 5, (a, r) => tryPropAt('archery-target', a, r, faceCentre(a)));
    arc(qa, SQUARE_R, 4, (a, r) => tryPropAt('weapon-rack', a, r, faceCentre(a)));
    arc(qa, SQUARE_R + 14, 4, (a, r) => tryPropAt('hay-bales', a, r, +rr(0, 360).toFixed(1)));
    // Fence along both long sides of the yard.
    for (const side of [-1, 1]) {
      const fr = SQUARE_R + side * 15;
      const n = Math.max(3, Math.round((2 * SQUARE_HALF * fr) / 3));
      arc(qa, fr, n, (a, r) => tryPropAt('fence-section', a, r, faceCentre(a)));
    }
    arc(qa, SQUARE_R - 13, 3, (a, r) => tryPropAt('weapon-rack', a, r, faceOut(a)));
  }
}

// =============================================================================
// Plaza dressing
// =============================================================================
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2 + 0.22;
  tryPropAt('street-lantern', a, PLAZA_R - 3);
}
for (let i = 0; i < 20; i++) {
  const a = (i / 20) * Math.PI * 2 + 0.5;
  if (!clearOfAvenue(a, PLAZA_R - 8, 9)) continue;
  tryPropAt(pick(['flower-planter', 'potted-tree', 'bench']), a, PLAZA_R - 9, faceCentre(a), 1.1);
}
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2 + 0.9;
  // The Great Tower's grand gate throws a stair out to ~r33 on the +Z side;
  // keep the inner bench ring off it.
  if (angDiff(a, rad(90)) < 0.55) continue;
  tryPropAt('bench', a, 34, faceCentre(a));
}

// =============================================================================
// The Green Ring — the park belt between the last houses and the wall
// =============================================================================
const parkMid = (PARK_IN + PARK_OUT) / 2;
// A fountain square on each diagonal, i.e. behind each quarter.
for (const q of QUARTERS) {
  const a = rad(q.deg);
  tryPropAt('fountain', a, parkMid, 0);
  for (let i = 0; i < 6; i++) {
    const ba = a + (i / 6 - 0.5) * 0.30;
    tryPropAt('bench', ba, parkMid - 7, faceCentre(ba));
    tryPropAt('bench', ba, parkMid + 7, faceOut(ba));
  }
  for (let i = 0; i < 5; i++) {
    const pa = a + (i / 5 - 0.5) * 0.26;
    tryPropAt('flower-planter', pa, parkMid - 11, faceCentre(pa), 1.2);
    tryPropAt('flower-planter', pa, parkMid + 11, faceOut(pa), 1.2);
  }
  tryPropAt('street-lantern', a - 0.05, parkMid - 4);
  tryPropAt('street-lantern', a + 0.05, parkMid + 4);
}
// Trees, benches and lamps scattered through the rest of the belt.
const TREES = ['tree-oak', 'tree-birch'];
for (let i = 0; i < 120; i++) {
  const a = rnd() * Math.PI * 2;
  const r = rr(PARK_IN + 2, PARK_OUT - 2);
  if (!clearOfAvenue(a, r, 12)) continue;
  const walkR = parkMid + Math.sin(a * 5) * 4.5;
  if (Math.abs(r - walkR) < 4.5) continue;         // keep the footpath clear
  if (QUARTERS.some((q) => angDiff(a, rad(q.deg)) < 0.20)) continue; // keep fountain squares clear
  tryPropAt(pick(TREES), a, r, +rr(0, 360).toFixed(1), +rr(0.75, 1.1).toFixed(2));
}
for (let i = 0; i < 34; i++) {
  const a = rnd() * Math.PI * 2;
  const r = rr(PARK_IN + 3, PARK_OUT - 3);
  if (!clearOfAvenue(a, r, 12)) continue;
  const walkR = parkMid + Math.sin(a * 5) * 4.5;
  if (Math.abs(r - walkR) > 6 || Math.abs(r - walkR) < 3.2) continue; // line the path
  tryPropAt(pick(['bench', 'street-lantern', 'potted-tree', 'signpost']), a, r, faceCentre(a));
}
// A rail along the inner edge of the belt so it reads as a designed park.
{
  const n = Math.round((Math.PI * 2 * (PARK_IN - 1)) / 3.1);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    if (!clearOfAvenue(a, PARK_IN - 1, 10)) continue;
    tryPropAt('fence-section', a, PARK_IN - 1, faceCentre(a));
  }
}

// =============================================================================
// Avenue dressing
// =============================================================================
for (const d of MAIN_AVENUES) {
  const a = rad(d);
  for (let r = PLAZA_R + 14; r < WALL_R - 8; r += 22) {
    for (const side of [-1, 1]) {
      const off = 6.6;
      const px = Math.cos(a) * r - Math.sin(a) * side * off;
      const pz = Math.sin(a) * r + Math.cos(a) * side * off;
      tryProp('street-lantern', px, pz, deg(a));
      if (rnd() < 0.4) {
        const o2 = 9.4;
        tryProp(pick(['potted-tree', 'flower-planter', 'bench']),
          Math.cos(a) * (r + 8) - Math.sin(a) * side * o2,
          Math.sin(a) * (r + 8) + Math.cos(a) * side * o2, deg(a));
      }
    }
  }
}
for (const R of [RING_A, RING_B]) {
  const n = Math.round((Math.PI * 2 * R) / 34);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.3;
    if (!clearOfAvenue(a, R, 12) || inSquare(a, R)) continue;
    tryPropAt('street-lantern', a, R + 5);
  }
}

// =============================================================================
// Townsfolk
// =============================================================================
const NAMES = ['Townsperson', 'Merchant', 'Guard', 'Apprentice', 'Traveller', 'Herbalist', 'Porter', 'Bard'];
const CLASSES = ['warrior', 'mage', 'archer', 'priest', 'guardian'];
const CROWDS = [{ x: 0, z: 0, r: 46, n: 10 }, { x: 0, z: -66, r: 12, n: 3 }];
for (const q of QUARTERS) {
  const a = rad(q.deg);
  CROWDS.push({ x: Math.cos(a) * SQUARE_R, z: Math.sin(a) * SQUARE_R, r: 18, n: 6 });
  CROWDS.push({ x: Math.cos(a) * parkMid, z: Math.sin(a) * parkMid, r: 14, n: 3 });
}
let n = 0;
for (const s of CROWDS) {
  for (let i = 0; i < s.n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * s.r;
    const x = s.x + Math.cos(a) * d;
    const z = s.z + Math.sin(a) * d;
    if (Math.hypot(x, z) < 30) continue;
    world.npcs.push({
      id: `npc-town-${n++}`, name: pick(NAMES),
      position: { x: +x.toFixed(2), y: 0, z: +z.toFixed(2) },
      appearance: { seed: seed(), classId: pick(CLASSES) },
      dialog: [], wander: true, wanderRadius: ri(5, 10), speed: +rr(0.9, 1.4).toFixed(2),
    });
  }
}

// =============================================================================
// THE COUNTRYSIDE — everything outside the walls
// =============================================================================
// Four wedges of open land beyond the gates, each with its own trade, plus a
// river down the east side with a walkable fishing pier.
//
//   SW  farmland  crop fields, barn, granary, windmill, scarecrows, coop
//   NW  woodland  hunter cabin, timber stacks, wood + herb gathering
//   NE  mining    adit, headframe, ore carts, spoil heaps, ore gathering
//   E   river     pier out over the water, boats, drying racks, fishing
const OUT_IN = WALL_R + 22;   // clear of the wall and its gate approaches
const OUT_OUT = 330;

/** Far enough from every gate road to build on? */
const offRoad = (x, z, pad = 16) =>
  MAIN_AVENUES.every((d) => {
    const a = rad(d);
    const along = x * Math.cos(a) + z * Math.sin(a);
    if (along < 0) return true;
    return Math.abs(-x * Math.sin(a) + z * Math.cos(a)) > pad;
  });

const inRing = (x, z) => {
  const r = Math.hypot(x, z);
  return r > OUT_IN && r < OUT_OUT;
};
/** Place a countryside prop only if it is outside the walls, off the roads and clear. */
function outProp(type, x, z, rotationDeg = 0, scale = 1) {
  if (!inRing(x, z) || !offRoad(x, z)) return false;
  return tryProp(type, x, z, rotationDeg, scale);
}

// --- Roads continuing the avenues out into the country ----------------------
for (const d of MAIN_AVENUES) {
  const a = rad(d);
  const pts = [];
  for (let r = WALL_R + 4; r <= OUT_OUT - 10; r += 14) {
    const wobble = Math.sin(r * 0.05) * 6;
    pts.push({
      x: +(Math.cos(a) * r - Math.sin(a) * wobble).toFixed(2),
      z: +(Math.sin(a) * r + Math.cos(a) * wobble).toFixed(2),
    });
  }
  world.paths.push({ id: `road-${d}`, theme: 'basic', width: 7, points: pts });
}

// --- The riverside -----------------------------------------------------------
// NO WATER BODY IS WRITTEN HERE. Dennis authors the water himself in the World
// Editor; a generator-written body just gets clobbered on the next run.
// These constants only mark where the bank is meant to run, so the pier, boats
// and reeds line up with water painted between x=196 and x=252.
const PIER_Z = 40;
const RIVER_NEAR = 196;
const PIER_TIP = 232;
for (let x = RIVER_NEAR - 5; x < PIER_TIP - 5; x += 4) {
  prop('pier-section', x, PIER_Z, 90);
}
prop('pier-head', PIER_TIP - 2.6, PIER_Z, 90);

prop('rowboat', RIVER_NEAR + 6, PIER_Z - 9, 12);
prop('rowboat', RIVER_NEAR + 5, PIER_Z + 11, -20);
prop('fish-rack', RIVER_NEAR - 9, PIER_Z - 7, 90);
prop('fish-rack', RIVER_NEAR - 9, PIER_Z + 7, 90);
prop('cabin-log', RIVER_NEAR - 22, PIER_Z + 16, 250);
prop('barrel-stack', RIVER_NEAR - 12, PIER_Z + 2, 0);
prop('crate-stack', RIVER_NEAR - 13, PIER_Z - 3, 0);
for (let i = 0; i < 60; i++) {
  const z = rr(-140, 185);
  if (Math.abs(z - PIER_Z) < 6) continue;
  tryProp(pick(['reeds', 'grass-meadow', 'flower-meadow']), RIVER_NEAR - rr(0.5, 5), z, +rr(0, 360).toFixed(1));
}
world.npcs.push({
  id: 'npc-fisher', name: 'Fisher',
  position: { x: RIVER_NEAR - 12, y: 0, z: PIER_Z + 5 },
  appearance: { seed: 5150, classId: 'archer' },
  dialog: ['The river runs clear this season.', 'Cast from the end of the pier - the big ones sit deep.'],
  wander: true, wanderRadius: 5, speed: 0.8,
});

// --- SW: the farmstead ------------------------------------------------------
{
  const cx = -215, cz = 150;
  prop('barn', cx, cz, 20);
  prop('windmill', cx - 52, cz + 34, 0);
  prop('granary', cx + 16, cz - 9, 20);
  prop('chicken-coop', cx + 12, cz + 13, 200);
  prop('water-trough', cx - 11, cz + 12, 110);
  prop('cabin-log', cx + 34, cz + 22, 210);
  outProp('plough', cx - 6, cz + 19, 40);
  outProp('handcart', cx + 7, cz + 20, 130);
  for (const dz of [[-4, 26], [9, 27], [-16, 22]]) outProp('hay-bales', cx + dz[0], cz + dz[1], +rr(0, 360).toFixed(1));
  for (const dz of [[20, 28], [-24, 10]]) outProp('beehive', cx + dz[0], cz + dz[1], +rr(0, 360).toFixed(1));

  const CROPS = ['crop-wheat', 'crop-wheat', 'crop-cabbage', 'crop-pumpkin'];
  let ci = 0;
  for (let gx = -3; gx <= 3; gx++) {
    for (let gz = -3; gz <= 2; gz++) {
      const px = cx + gx * 8.4 - 4;
      const pz = cz + gz * 8.4 + 44;
      if (!inRing(px, pz) || !offRoad(px, pz)) continue;
      tryProp(CROPS[(ci++) % CROPS.length], px, pz, 0);
      if (rnd() < 0.12) tryProp('scarecrow', px + 4.2, pz + 4.2, +rr(0, 360).toFixed(1));
    }
  }
  for (let i = -4; i <= 4; i++) {
    outProp('fence-section', cx + i * 3.05 - 4, cz + 20.5, 0);
    outProp('fence-section', cx + i * 3.05 - 4, cz + 69.5, 0);
  }
  for (let i = 0; i < 16; i++) {
    outProp('fence-section', cx - 30, cz + 21 + i * 3.05, 90);
    outProp('fence-section', cx + 22, cz + 21 + i * 3.05, 90);
  }
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = rr(60, 105);
    outProp(pick(['tree-oak', 'tree-birch']), cx + Math.cos(a) * d, cz + Math.sin(a) * d,
      +rr(0, 360).toFixed(1), +rr(0.8, 1.2).toFixed(2));
  }
  world.npcs.push({
    id: 'npc-farmer', name: 'Farmer',
    position: { x: cx + 6, y: 0, z: cz + 16 },
    appearance: { seed: 6161, classId: 'warrior' },
    dialog: ['Mind the furrows.', 'Good soil this side of the river.'],
    wander: true, wanderRadius: 8, speed: 1.0,
  });
}

// --- NW: woodland and the hunter camp ---------------------------------------
{
  const cx = -205, cz = -150;
  prop('cabin-log', cx, cz, 130);
  outProp('fish-rack', cx + 11, cz + 7, 130);
  outProp('woodpile', cx - 9, cz + 5, 40);
  outProp('woodpile', cx - 10, cz - 2, 40);
  outProp('station-campfire', cx + 6, cz - 8, 0);
  outProp('hay-bales', cx - 4, cz - 11, 20);
  outProp('crate-stack', cx + 9, cz - 3, 0);
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2, d = rr(16, 95);
    outProp(pick(['tree-oak', 'tree-birch', 'tree-pine', 'tree-oak']),
      cx + Math.cos(a) * d, cz + Math.sin(a) * d,
      +rr(0, 360).toFixed(1), +rr(0.8, 1.25).toFixed(2));
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rr(18, 90);
    outProp(pick(['bush', 'fern', 'mushroom-cluster', 'stump', 'log']),
      cx + Math.cos(a) * d, cz + Math.sin(a) * d, +rr(0, 360).toFixed(1));
  }
  // No gathering nodes are seeded here (nor at the mine below). They used to
  // be, and the result was a scatter of nodes nobody placed, in spots nobody
  // chose, that no editor tool could move or delete. Gathering points are
  // authored content now: place them yourself rather than inheriting a
  // generator's guesses. The scenery above (stumps, logs, ore rocks) is
  // unaffected, so the camps still LOOK like what they are.
  world.npcs.push({
    id: 'npc-hunter', name: 'Hunter',
    position: { x: cx + 5, y: 0, z: cz + 6 },
    appearance: { seed: 7272, classId: 'archer' },
    dialog: ['Tracks everywhere this morning.', 'Keep to the path after dark.'],
    wander: true, wanderRadius: 7, speed: 1.1,
  });
}

// --- NE: the mining camp ----------------------------------------------------
{
  const cx = 175, cz = -175;
  prop('mine-entrance', cx, cz, 200);
  prop('mine-headframe', cx + 24, cz + 10, 0);
  outProp('ore-cart', cx + 7, cz + 12, 205);
  outProp('ore-cart', cx + 16, cz + 3, 30);
  outProp('cabin-log', cx - 26, cz + 16, 120);
  outProp('woodpile', cx - 14, cz + 20, 60);
  outProp('crate-stack', cx + 3, cz + 18, 0);
  outProp('barrel-stack', cx - 4, cz + 21, 0);
  outProp('station-campfire', cx - 10, cz + 26, 0);
  for (let i = 0; i < 30; i++) {
    const a = rnd() * Math.PI * 2, d = rr(18, 70);
    outProp(pick(['rock-mountain', 'boulder', 'rock-sharp', 'rock-cluster', 'pebbles']),
      cx + Math.cos(a) * d, cz + Math.sin(a) * d, +rr(0, 360).toFixed(1), +rr(0.8, 1.3).toFixed(2));
  }
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, d = rr(20, 62);
    const px = +(cx + Math.cos(a) * d).toFixed(2), pz = +(cz + Math.sin(a) * d).toFixed(2);
    outProp('ore', px, pz, +rr(0, 360).toFixed(1)); // scenery only — see the woodland note above
  }
  world.npcs.push({
    id: 'npc-miner', name: 'Miner',
    position: { x: cx - 8, y: 0, z: cz + 14 },
    appearance: { seed: 8383, classId: 'guardian' },
    dialog: ['The seam runs deep here.', 'Watch your step near the shaft.'],
    wander: true, wanderRadius: 6, speed: 0.9,
  });
}

// --- Meadow scatter filling the rest of the ring ----------------------------
for (let i = 0; i < 420; i++) {
  const a = rnd() * Math.PI * 2;
  const r = rr(OUT_IN, OUT_OUT - 8);
  const px = Math.cos(a) * r, pz = Math.sin(a) * r;
  if (px > RIVER_NEAR - 12) continue;              // leave the river bank clear
  outProp(pick(['grass-meadow', 'flower-meadow', 'grass-meadow', 'bush',
    'tree-oak', 'tree-birch', 'rock', 'flower-daisy']), px, pz,
    +rr(0, 360).toFixed(1), +rr(0.75, 1.15).toFixed(2));
}
for (const d of MAIN_AVENUES) {
  const a = rad(d);
  outProp('signpost', Math.cos(a) * (WALL_R + 26) - Math.sin(a) * 9,
    Math.sin(a) * (WALL_R + 26) + Math.cos(a) * 9, deg(a));
  outProp('street-lantern', Math.cos(a) * (WALL_R + 40) + Math.sin(a) * 8,
    Math.sin(a) * (WALL_R + 40) - Math.cos(a) * 8, deg(a));
}

// =============================================================================
// Preserve hand-authored water
// =============================================================================
// This script rewrites the whole map, so anything added in the World Editor is
// lost on the next run. Water is the one thing Dennis authors by hand here, so
// carry it (and its painted mask) over from the existing file rather than
// stamping empty arrays on top of it.
try {
  const prev = JSON.parse(readFileSync(path.join(ROOT, 'world/maps', `${MAP_ID}.json`), 'utf8'));
  if (prev.waterBodies?.length) {
    world.waterBodies = prev.waterBodies;
    console.log(`  carried over ${prev.waterBodies.length} hand-authored water body(ies)`);
  }
  if (prev.waterMask?.cells?.some((c) => c > 0)) {
    world.waterMask = prev.waterMask;
    console.log('  carried over the painted water mask');
  }
} catch {
  /* first run: no previous map to preserve anything from */
}

// =============================================================================
// Write + register
// =============================================================================
writeFileSync(path.join(ROOT, 'world/maps', `${MAP_ID}.json`), JSON.stringify(world));
const indexPath = path.join(ROOT, 'world/maps/index.json');
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
if (!index.some((m) => m.id === MAP_ID)) {
  index.push({ id: MAP_ID, name: MAP_NAME, mapType: 'overworld', path: `${MAP_ID}.json` });
  writeFileSync(indexPath, JSON.stringify(index, null, 2));
}
console.log(`Wrote world/maps/${MAP_ID}.json`);
console.log(`  city radius   ${WALL_R} m (park belt ${PARK_IN}-${PARK_OUT})`);
console.log(`  buildings     ${world.buildings.length} (${houses} house slots attempted)`);
console.log(`  props total   ${world.props.length}`);
console.log(`  walls / npcs  ${world.walls.length} / ${world.npcs.length}`);
console.log(`  decor skipped ${skipped} (would have overlapped something solid)`);
