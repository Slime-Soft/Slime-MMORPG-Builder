// scripts/place-city-wall-kit.mjs
// Punctuates a map's existing curtain-wall ring with the new gatehouse and
// tower props (src/generators/environment/cityWall.js).
//
// The ring itself is NOT touched: every `world.walls[]` entry already renders as
// the rebuilt wall, because generateWallSegment is parametric on the length /
// height / thickness those entries already carry. What was missing was anything
// AT the four gate gaps and anywhere along the runs between them — the ring was
// 40 identical slabs and four holes.
//
// Everything it adds is tagged, and it removes its own previous output first,
// so re-running is idempotent rather than additive.
//
//   node scripts/place-city-wall-kit.mjs world/maps/asteria.json [--dry-run]
//
// ANGLE CONVENTIONS, all derived rather than assumed (see deriveRing below):
//   - a wall segment's rotationDeg is -(theta + 90), which puts its local +X
//     along the tangent and its local +Z pointing INWARD;
//   - a tower's door and a gate's front are authored at local +Z, so a tower
//     re-uses the wall's own rotation (door faces the city) and a gate uses
//     90 - theta (front faces the countryside).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const [mapPath, ...flags] = process.argv.slice(2);
if (!mapPath) {
  console.error('usage: node scripts/place-city-wall-kit.mjs <world/maps/NAME.json> [--dry-run]');
  process.exit(2);
}
const dryRun = flags.includes('--dry-run');

const world = JSON.parse(readFileSync(mapPath, 'utf8'));
world.props ||= [];
world.walls ||= [];

const PIER_ID = /^citywall-pier-/;
const KIT_TYPES = new Set(['citywall-tower', 'citywall-gate']);

const TOWER_R_OFFSET = 0.5;   // towers sit slightly proud of the wall line
const TOWER_EVERY = 4;        // one tower every 4th segment junction
// The solid half of a gatehouse, per side. The gatehouse runs to |x| = 9.3 and
// its clear passage to |x| = 2.3, so a pier has to be 7.0 long to fence all of
// it; 7.2 overlaps the outer corner slightly rather than leaving a 40 cm notch
// of tower you can stand inside.
const PIER_LENGTH = 7.2;
const PIER_THICKNESS = 5.0;
const PIER_HEIGHT = 15.5;

const deg = (rad) => (rad * 180) / Math.PI;
const norm = (a) => ((a % 360) + 360) % 360;

/**
 * Recover the ring's geometry from the wall data itself — radius, the angle of
 * every segment, and where the gaps are. Nothing here is hard-coded to Asteria;
 * a differently-sized ring on another map falls out of the same read.
 */
function deriveRing(walls) {
  const ring = walls
    .filter((w) => !w.invisible && w.position && Math.hypot(w.position.x, w.position.z) > 20)
    .map((w) => ({ w, r: Math.hypot(w.position.x, w.position.z), a: norm(deg(Math.atan2(w.position.z, w.position.x))) }))
    .sort((p, q) => p.a - q.a);
  if (ring.length < 8) return null;

  const radius = ring.reduce((s, p) => s + p.r, 0) / ring.length;
  // The nominal step is the MEDIAN gap, not the mean: the four gate gaps are
  // each twice a normal step and would drag a mean well off.
  const gaps = ring.map((p, i) => norm(p.a - ring[(i - 1 + ring.length) % ring.length].a)).sort((x, y) => x - y);
  const step = gaps[Math.floor(gaps.length / 2)];

  // Junctions carry their position WITHIN their run (the stretch of wall
  // between two gates), not their index in one flat list. With 9 junctions per
  // run and towers every 4th, a flat index drifts a little further round the
  // ring on each run and the four sides come out visibly unlike each other.
  const gateAngles = [];
  const junctions = [];
  let runPos = 0;
  for (let i = 0; i < ring.length; i++) {
    const prev = ring[(i - 1 + ring.length) % ring.length];
    const gap = norm(ring[i].a - prev.a);
    const mid = norm(prev.a + gap / 2);
    if (gap > step * 1.5) { gateAngles.push({ angle: mid, gap }); runPos = 0; }
    else junctions.push({ angle: mid, runPos: runPos++ });
  }
  return { radius, step, gateAngles, junctions, count: ring.length };
}

const ring = deriveRing(world.walls);
if (!ring) {
  console.error(`${mapPath}: no city-wall ring found (need at least 8 non-invisible walls away from the origin)`);
  process.exit(1);
}
console.log(`ring: ${ring.count} segments, radius ${ring.radius.toFixed(2)}, step ${ring.step.toFixed(2)}deg`);
console.log(`gaps: ${ring.gateAngles.map((g) => `${g.angle.toFixed(1)}deg (${g.gap.toFixed(1)}deg wide)`).join(', ') || 'none'}`);

// --- clear this script's own previous output -------------------------------
const propsBefore = world.props.length, wallsBefore = world.walls.length;
world.props = world.props.filter((p) => !KIT_TYPES.has(p.type));
world.walls = world.walls.filter((w) => !PIER_ID.test(w.id || ''));
const removed = (propsBefore - world.props.length) + (wallsBefore - world.walls.length);
if (removed) console.log(`removed ${removed} entrie(s) from a previous run`);

// Deterministic seeds: a re-run must produce the same towers, not reshuffle
// every shield colour on the ring.
let seedCounter = 1;
const nextSeed = () => {
  seedCounter = (Math.imul(seedCounter, 1103515245) + 12345) >>> 0;
  return seedCounter;
};

const added = { gates: 0, towers: 0, piers: 0 };

// --- gatehouses, one per gap ------------------------------------------------
for (const { angle } of ring.gateAngles) {
  const t = (angle * Math.PI) / 180;
  const cx = Math.cos(t) * ring.radius, cz = Math.sin(t) * ring.radius;
  world.props.push({
    type: 'citywall-gate',
    seed: nextSeed(),
    position: { x: round(cx), y: 0, z: round(cz) },
    scale: 1,
    // 90 - theta puts local +Z outward, so the gate faces the countryside.
    rotation: { x: 0, y: round(wrap(90 - angle)), z: 0 },
  });
  added.gates++;

  // The gatehouse declares no collider (it has to be walkable down the middle),
  // so its two solid halves are fenced with invisible wall segments — the same
  // pattern the Great Tower's own gate piers use. The archway between them
  // stays open.
  //
  // Local +X under the gate's rotation is (sin t, -cos t); the piers sit at
  // local x = +/- (PIER_LENGTH/2 + half the clear opening).
  const ax = Math.sin(t), az = -Math.cos(t);
  const offset = 2.3 + PIER_LENGTH / 2;   // 2.3 = half the 4.6 m clear passage
  for (const side of [-1, 1]) {
    world.walls.push({
      id: `citywall-pier-${Math.round(angle)}-${side > 0 ? 'r' : 'l'}`,
      seed: nextSeed(),
      position: { x: round(cx + ax * offset * side), y: 0, z: round(cz + az * offset * side) },
      // A wall's own convention: local +X along the tangent.
      rotationDeg: round(wrap(-(angle + 90))),
      length: PIER_LENGTH,
      height: PIER_HEIGHT,
      thickness: PIER_THICKNESS,
      invisible: true,
    });
    added.piers++;
  }
}

// --- towers along the runs --------------------------------------------------
for (const { angle, runPos } of ring.junctions) {
  // Offset by 2 so no tower lands hard against a gatehouse's shoulder.
  if (runPos % TOWER_EVERY !== 2) continue;
  const t = (angle * Math.PI) / 180;
  const r = ring.radius + TOWER_R_OFFSET;
  world.props.push({
    type: 'citywall-tower',
    seed: nextSeed(),
    position: { x: round(Math.cos(t) * r), y: 0, z: round(Math.sin(t) * r) },
    scale: 1,
    // Same rotation as a wall segment, so the tower's doorway (+Z) opens onto
    // the city rather than onto the field outside.
    rotation: { x: 0, y: round(wrap(-(angle + 90))), z: 0 },
  });
  added.towers++;
}

function round(n) { return Math.round(n * 1000) / 1000; }
/** Fold an angle into (-180, 180], the range the editor's fields expect. */
function wrap(d) { const a = norm(d); return a > 180 ? a - 360 : a; }

console.log(`added ${added.gates} gatehouse(s), ${added.towers} tower(s), ${added.piers} invisible pier(s)`);
console.log(`props ${propsBefore} -> ${world.props.length}, walls ${wallsBefore} -> ${world.walls.length}`);

if (dryRun) {
  console.log('--dry-run: nothing written');
  process.exit(0);
}
const backup = `${mapPath}.pre-citywall-backup`;
if (!existsSync(backup)) {
  copyFileSync(mapPath, backup);
  console.log(`backed up to ${backup}`);
}
writeFileSync(mapPath, JSON.stringify(world));
console.log(`wrote ${mapPath}`);
