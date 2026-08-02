// scripts/generate-town-buildings.mjs
// Rebuilds the 13 townhouse.js buildings (8 houses, tavern, inn, store,
// workshop, Adventurers Guild) as EDITABLE Building Builder types — real
// building-types.json entries composed from building-parts.json's placed-part
// vocabulary, so Dennis can open buildings.html and drag/resize/recolor them.
//
// THIS IS AN APPROXIMATION, NOT AN EXPORT. townhouse.js builds raw merged
// Three.js geometry per-house (tapered cylinders, extruded gable triangles,
// hundreds of individual timber studs) for render performance. The Building
// Builder's part system only understands a small primitive vocabulary (box/
// cylinder/cone/wedge/log-wall/shingle-roof-panel) composed from REUSABLE
// parts, each a fixed 3m-wide unit — it cannot represent that geometry
// losslessly. These are close in silhouette and palette, built from the SAME
// parts catalog Dennis already has (wall-timber-frame, gable-*, roof-shingle-*,
// trim-chimney, etc.), not a new one-off system.
//
// Run after building-parts.json / building-types.json exist (they're seeded on
// first server boot from buildingPartPresets.js). Safe to re-run: it replaces
// only the 'th-*' ids this script owns and leaves everything else (including
// anything Dennis has hand-added) untouched.
//
//   node scripts/generate-town-buildings.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PARTS_PATH = path.join(ROOT, 'building-parts/building-parts.json');
const TYPES_PATH = path.join(ROOT, 'building-types/building-types.json');

const parts = JSON.parse(readFileSync(PARTS_PATH, 'utf8'));
// Composed types go into a FRESH array, never the array loaded from disk — on
// a re-run that loaded array already contains this script's own output from
// last time, and pushing onto it directly doubled every 'th-*' id into a
// duplicate pair (the exact bug parseBuildingTypeDefs's dedup check exists to
// catch). Only the final combine step below reads the on-disk file, and only
// to preserve entries this script does NOT own.
const types = [];

// =============================================================================
// New parts. Small additions to the existing catalog, not a parallel one.
// =============================================================================
const NEW_PARTS = [
  // The existing 'window-framed' has no shutters — the single biggest miss
  // against the half-timbered look. Same glass+frame, plus two hinged panels.
  {
    id: 'th-window-shuttered', name: 'Shuttered Window', category: 'window',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 1.05, y: 1.15, z: 0.1 }, color: 0x3a2818 },
      { id: 's2', kind: 'box', position: { x: 0, y: 0, z: 0.06 }, scale: { x: 0.9, y: 1.0, z: 0.04 }, color: 0x3a5a6a },
      { id: 's3', kind: 'box', position: { x: -0.78, y: 0, z: 0.08 }, scale: { x: 0.5, y: 1.1, z: 0.06 }, color: 0x4f7f78 },
      { id: 's4', kind: 'box', position: { x: 0.78, y: 0, z: 0.08 }, scale: { x: 0.5, y: 1.1, z: 0.06 }, color: 0x4f7f78 },
    ],
  },
  // Two more roof colours so 13 buildings aren't all red/blue.
  {
    id: 'roof-shingle-brown', name: 'Shingle Roof — Brown', category: 'roof',
    shapes: [{ id: 's1', kind: 'shingle-roof-panel', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 4 }, color: 0x6f4530 }],
  },
  {
    id: 'roof-shingle-green', name: 'Shingle Roof — Green', category: 'roof',
    shapes: [{ id: 's1', kind: 'shingle-roof-panel', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 4 }, color: 0x4f6f3f }],
  },
  // A small tilted awning over a door — 'doorHood' on several townhouse.js presets.
  {
    id: 'th-door-hood', name: 'Door Hood', category: 'trim',
    shapes: [{ id: 's1', kind: 'box', position: { x: 0, y: 0, z: 0.35 }, rotation: { x: 30, y: 0, z: 0 }, scale: { x: 2.0, y: 0.12, z: 1.0 }, color: 0xa8543f }],
  },
];
for (const np of NEW_PARTS) {
  const i = parts.findIndex((p) => p.id === np.id);
  if (i >= 0) parts[i] = np; else parts.push(np);
}

// =============================================================================
// Composer
// =============================================================================
// piece.scale is a MULTIPLIER on the PART's own baked-in size
// (buildingRig.js's pieceGroup.scale.set(...) scales the whole rendered part),
// never an absolute dimension. Every push below divides the desired metre
// size by the part's native size for that axis to get the right multiplier —
// get this wrong (as the roof panels below originally did, passing slopeLen
// straight through against 'roof-shingle-*'s native 3x4) and a building
// renders 3-5x oversized with its excess swept mostly below ground.
const ROOF_NATIVE_SLOPE = 3;   // roof-shingle-*'s own baked scale.x
const ROOF_NATIVE_DEPTH = 4;   // roof-shingle-*'s own baked scale.z
const SEG = 3;       // native width of every wall/roof-panel part
const FLOOR_H = 2.5;  // native height of every wall part
let uid = 0;
const pid = () => `p${uid++}`;

/**
 * @param {string} id
 * @param {object} o
 *  wSeg/dSeg: footprint in units of SEG (3m) — an ODD wSeg gives the ground
 *    floor a true centre segment for the door.
 *  storeys, stoneGround, jetty (upper-floor overhang, metres), roofPitch,
 *  wallPart ('wall-timber-frame'|'wall-plaster'), timberColor, plasterColor,
 *  roofPart, doorPart, doorHood, chimney, windowPart.
 */
function composeBuilding(id, name, o) {
  const width = o.wSeg * SEG;
  const depth = o.dSeg * SEG;
  const storeys = o.storeys;
  const pieces = [];
  const inlineShapes = [];

  const wallColor = o.wallPart === 'wall-stone' ? undefined : o.timberColor;
  const plasterUpperColor = o.plasterColor;

  let wallTop = 0;
  for (let f = 0; f < storeys; f++) {
    const y0 = f * FLOOR_H;
    const groundStone = f === 0 && o.stoneGround;
    const wallPart = groundStone ? 'wall-stone' : o.wallPart;
    const jetty = f > 0 ? o.jetty : 0;
    const halfW = width / 2 + jetty;
    const halfD = depth / 2 + jetty;
    const color = groundStone ? undefined : (f === 0 ? wallColor : plasterUpperColor);

    // Front/back walls (normal along Z). x runs along the UNJETTIED width
    // (the ground floor's own segments), while z is pushed out to the
    // jettied halfD — an upper storey's wall pieces sit further out than the
    // floor below without changing how many 3m segments make up each row.
    for (const sz of [-1, 1]) {
      for (let i = 0; i < o.wSeg; i++) {
        pieces.push({
          id: pid(), partId: wallPart,
          position: { x: -width / 2 + SEG * (i + 0.5), y: y0 + FLOOR_H / 2, z: sz * halfD },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          ...(color !== undefined ? { colorOverride: color } : {}),
        });
      }
    }
    // Side walls (normal along X).
    for (const sx of [-1, 1]) {
      for (let i = 0; i < o.dSeg; i++) {
        pieces.push({
          id: pid(), partId: wallPart,
          position: { x: sx * halfW, y: y0 + FLOOR_H / 2, z: -depth / 2 + SEG * (i + 0.5) },
          rotation: { x: 0, y: 90, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          ...(color !== undefined ? { colorOverride: color } : {}),
        });
      }
    }

    // Windows. Ground floor skips the centre segment (the door goes there);
    // every other segment on every wall gets one, on both faces where the
    // segment is wide enough to read as a bay rather than a sliver.
    const midSeg = (o.wSeg - 1) / 2;
    for (const sz of [-1, 1]) {
      for (let i = 0; i < o.wSeg; i++) {
        if (f === 0 && i === midSeg) continue;
        pieces.push({
          id: pid(), partId: o.windowPart,
          position: { x: -width / 2 + SEG * (i + 0.5), y: y0 + FLOOR_H * 0.58, z: sz * (halfD + 0.06) },
          rotation: { x: 0, y: sz > 0 ? 0 : 180, z: 0 },
          scale: { x: 0.85, y: 0.85, z: 1 },
        });
      }
    }
    for (const sx of [-1, 1]) {
      for (let i = 0; i < o.dSeg; i++) {
        pieces.push({
          id: pid(), partId: o.windowPart,
          position: { x: sx * (halfW + 0.06), y: y0 + FLOOR_H * 0.58, z: -depth / 2 + SEG * (i + 0.5) },
          rotation: { x: 0, y: sx > 0 ? 90 : -90, z: 0 },
          scale: { x: 0.85, y: 0.85, z: 1 },
        });
      }
    }

    if (f === storeys - 1) wallTop = y0 + FLOOR_H;
  }

  // Door, centred on the front wall's ground floor.
  pieces.push({
    id: pid(), partId: o.doorPart,
    position: { x: 0, y: 0, z: depth / 2 + 0.05 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
  });
  if (o.doorHood) {
    pieces.push({
      id: pid(), partId: 'th-door-hood',
      position: { x: 0, y: 2.3, z: depth / 2 + 0.1 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: Math.min(1.6, o.wSeg * 0.55) / 2.0, y: 1, z: 1 },
    });
  }

  // Roof: two shingle-panel slopes meeting at a ridge, plus a beam and gable
  // ends. Panel local axes: X = up-slope, Z = along the ridge (see
  // buildingParts.js's shingleRoofPanelGeometry) — rotating about X tilts it.
  const eave = 0.6;
  const jettyTop = storeys > 1 ? o.jetty : 0;
  const roofHalfW = width / 2 + jettyTop + eave * 0.4;
  const roofHalfD = depth / 2 + jettyTop + eave;
  const roofH = roofHalfD * o.roofPitch;
  const slopeLen = Math.hypot(roofHalfD, roofH);
  const angleDeg = (Math.atan2(roofHalfD, roofH) * 180) / Math.PI;
  for (const sz of [-1, 1]) {
    pieces.push({
      id: pid(), partId: o.roofPart,
      position: { x: 0, y: wallTop + roofH / 2, z: sz * roofHalfD / 2 },
  // ROTATION IS THE FULL EXPLANATION HERE, not just the numbers. Per
  // buildingParts.js, the shingle-roof-panel's LOCAL X is up-slope and LOCAL Z
  // is along-the-ridge (fixed, unrotated, that comment says so directly).
  // Rotating about a given axis leaves THAT axis's own direction unchanged and
  // mixes the other two — so to make the up-slope direction (X) incline into Y
  // while the ridge (Z) stays flat, the tilt has to rotate about Z, not X. My
  // first version rotated about X, which does the opposite: it leaves the
  // slope direction flat and tilts the ridge instead, producing a roof with
  // wildly wrong world-space dimensions. And because I want the RIDGE to run
  // along world X here (parallel to the wide front wall, not along Z), the
  // panel also needs rotation.y=90 first, to swap which world axis its local Z
  // lands on. Verified numerically (scratch_roofaxis*.mjs, since eyeballing
  // Euler composition is exactly how the first version went wrong): with
  // rotation={x:0,y:90,z:pitchDeg}, a piece fed scale.z=9 (ridge) came out
  // spanning ~11m along world X and scale.x=4 (slope) came out spanning ~4m
  // along world Z with the correct rise — ridge preserved, slope tilted, both
  // on the intended world axes. The pitch angle magnitude itself was already
  // right (90-angleDeg is the same value as atan2(rise,run) by the
  // complementary-angle identity) — only the AXIS it was applied to was wrong.
  rotation: { x: 0, y: 90, z: sz * (90 - angleDeg) },
      scale: { x: slopeLen / ROOF_NATIVE_SLOPE, y: 1, z: (roofHalfW * 2) / ROOF_NATIVE_DEPTH },
    });
  }
  pieces.push({
    id: pid(), partId: 'trim-ridge-beam',
    position: { x: 0, y: wallTop + roofH, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: (roofHalfW * 2 + 0.3) / 4.3 },
  });
  const gablePart = o.stoneGround ? 'gable-stone' : (o.wallPart === 'wall-plaster' ? 'gable-plaster' : 'gable-timber-frame');
  for (const sx of [-1, 1]) {
    pieces.push({
      id: pid(), partId: gablePart,
      position: { x: sx * (width / 2 + jettyTop), y: wallTop + roofH / 2, z: 0 },
      rotation: { x: 0, y: 90, z: 0 },
      scale: { x: (roofHalfD * 2) / 3, y: (roofH * 1.06) / 2.4, z: 1 },
    });
  }

  if (o.chimney) {
    pieces.push({
      id: pid(), partId: 'trim-chimney',
      position: { x: width / 2 - 1.1, y: wallTop + roofH * 0.55, z: -roofHalfD * 0.3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: (roofH * 0.9 + 1.6) / 1.5, z: 1 },
    });
  }

  types.push({ id, name, footprint: { width: width + jettyTop * 2, depth: depth + jettyTop * 2 }, pieces, inlineShapes });
}

// =============================================================================
// The 13 buildings — same silhouette language as townhouse.js's presets.
// =============================================================================
const TIMBER = 0x4a3527;
const B = (id, name, opts) => composeBuilding(id, name, {
  wallPart: 'wall-timber-frame', windowPart: 'th-window-shuttered', doorPart: 'door-framed',
  timberColor: TIMBER, plasterColor: 0xf4ecda, roofPart: 'roof-shingle-red',
  jetty: 0.3, roofPitch: 1.1, doorHood: false, chimney: true, stoneGround: false,
  storeys: 2, wSeg: 3, dSeg: 3,
  ...opts,
});

B('th-house-narrow', 'House — Narrow', { wSeg: 3, dSeg: 3, storeys: 3, jetty: 0.35, stoneGround: false, roofPart: 'roof-shingle-red' });
B('th-house-wide', 'House — Wide', { wSeg: 5, dSeg: 3, storeys: 2, jetty: 0.3, stoneGround: true, roofPart: 'roof-shingle-brown' });
B('th-house-tall', 'House — Tall', { wSeg: 3, dSeg: 3, storeys: 3, jetty: 0.4, stoneGround: true, roofPitch: 1.3, roofPart: 'roof-shingle-red' });
B('th-house-small', 'House — Small', { wSeg: 3, dSeg: 3, storeys: 2, jetty: 0.25, stoneGround: false, roofPart: 'roof-shingle-green', chimney: false });
B('th-house-corner', 'House — Corner', { wSeg: 5, dSeg: 5, storeys: 3, jetty: 0.28, stoneGround: true, roofPart: 'roof-shingle-blue' });
B('th-house-steep', 'House — Steep Gable', { wSeg: 3, dSeg: 3, storeys: 2, jetty: 0.36, roofPitch: 1.5, stoneGround: false, roofPart: 'roof-shingle-red' });
B('th-house-squat', 'House — Squat', { wSeg: 5, dSeg: 5, storeys: 2, jetty: 0.2, stoneGround: true, roofPitch: 0.9, roofPart: 'roof-shingle-brown' });
B('th-house-gabled', 'House — Gabled', { wSeg: 3, dSeg: 3, storeys: 3, jetty: 0.3, stoneGround: false, roofPitch: 1.2, roofPart: 'roof-shingle-green' });

B('th-bld-tavern', 'Tavern', {
  wSeg: 7, dSeg: 5, storeys: 2, jetty: 0.32, stoneGround: true, roofPitch: 1.0,
  roofPart: 'roof-shingle-brown', doorPart: 'door-arched', doorHood: true,
});
B('th-bld-inn', 'Inn', {
  wSeg: 7, dSeg: 5, storeys: 3, jetty: 0.3, stoneGround: true, roofPitch: 1.1,
  roofPart: 'roof-shingle-red', doorPart: 'door-arched', doorHood: true,
});
B('th-bld-store', 'General Store', {
  wSeg: 5, dSeg: 3, storeys: 2, jetty: 0.28, stoneGround: false, roofPitch: 0.95,
  roofPart: 'roof-shingle-blue', doorPart: 'door-arched', doorHood: true,
});
B('th-bld-workshop', 'Craft Workshop', {
  wSeg: 5, dSeg: 5, storeys: 2, jetty: 0.2, stoneGround: true, roofPitch: 0.9,
  roofPart: 'roof-shingle-green', chimney: true,
});

// The Guild Hall gets its own composition — a broad stone hall, not a jettied
// timber house, matching the third reference image (projecting gabled porch,
// twin banner-flanked entrance) rather than reusing composeBuilding's
// residential shape.
{
  const width = 11 * SEG, depth = 6 * SEG, wallTop = 6.5;
  const pieces = [];
  // Stone hall walls, one storey but tall.
  for (const sz of [-1, 1]) {
    for (let i = 0; i < 11; i++) {
      pieces.push({
        id: pid(), partId: 'wall-stone',
        position: { x: -width / 2 + SEG * (i + 0.5), y: wallTop / 2, z: sz * depth / 2 },
        rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: wallTop / FLOOR_H, z: 1.15 },
      });
    }
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      pieces.push({
        id: pid(), partId: 'wall-stone',
        position: { x: sx * width / 2, y: wallTop / 2, z: -depth / 2 + SEG * (i + 0.5) },
        rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1, y: wallTop / FLOOR_H, z: 1.15 },
      });
    }
  }
  // Windows along the front, avoiding the centre porch bay.
  for (let i = 0; i < 11; i++) {
    if (Math.abs(i - 5) < 1.6) continue;
    pieces.push({
      id: pid(), partId: 'window-framed',
      position: { x: -width / 2 + SEG * (i + 0.5), y: 3.2, z: depth / 2 + 0.08 },
      rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.1, y: 1.3, z: 1 },
    });
  }
  // Roof.
  const roofHalfD = depth / 2 + 0.9;
  const roofH = roofHalfD * 1.25;
  const slopeLen = Math.hypot(roofHalfD, roofH);
  const angleDeg = (Math.atan2(roofHalfD, roofH) * 180) / Math.PI;
  for (const sz of [-1, 1]) {
    pieces.push({
      id: pid(), partId: 'roof-shingle-brown',
      position: { x: 0, y: wallTop + roofH / 2, z: sz * roofHalfD / 2 },
      rotation: { x: 0, y: 90, z: sz * (90 - angleDeg) }, // see the comment on the other main-roof panel above
      scale: { x: slopeLen / ROOF_NATIVE_SLOPE, y: 1, z: (width + 1.6) / ROOF_NATIVE_DEPTH },
    });
  }
  pieces.push({
    id: pid(), partId: 'trim-ridge-beam',
    position: { x: 0, y: wallTop + roofH, z: 0 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: (width + 1.8) / 4.3 },
  });
  for (const sx of [-1, 1]) {
    pieces.push({
      id: pid(), partId: 'gable-stone',
      position: { x: sx * width / 2, y: wallTop + roofH / 2, z: 0 },
      rotation: { x: 0, y: 90, z: 0 }, scale: { x: (roofHalfD * 2) / 3, y: (roofH * 1.06) / 2.4, z: 1 },
    });
  }
  // Projecting gabled entrance porch.
  const pW = 2 * SEG, pD = 2 * SEG, pTop = 7.6;
  for (const sx of [-1, 1]) {
    pieces.push({
      id: pid(), partId: 'wall-stone',
      position: { x: sx * pW / 2, y: pTop / 2, z: depth / 2 + pD / 2 },
      rotation: { x: 0, y: 90, z: 0 }, scale: { x: pD / SEG, y: pTop / FLOOR_H, z: 1.15 },
    });
  }
  pieces.push({
    id: pid(), partId: 'door-arched',
    position: { x: 0, y: 0, z: depth / 2 + pD + 0.05 },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.4, y: 1.3, z: 1 },
  });
  // The porch's ridge runs along Z (it projects outward from the hall), NOT
  // along X like the main roof — so the tilt has to be about the Z axis
  // (inclining the X/up-slope direction), with no Y rotation at all. This
  // must stay consistent with the gable-stone piece above, which caps the
  // ridge's far end and therefore spans X at fixed z — a ridge running the
  // other way would put that gable on the wrong face entirely.
  const pRoofHalf = pW / 2 + 0.4, pRoofH = pRoofHalf * 1.3;
  const pSlope = Math.hypot(pRoofHalf, pRoofH), pAngle = (Math.atan2(pRoofHalf, pRoofH) * 180) / Math.PI;
  for (const sx of [-1, 1]) {
    pieces.push({
      id: pid(), partId: 'roof-shingle-brown',
      position: { x: sx * pRoofHalf / 2, y: pTop + pRoofH / 2, z: depth / 2 + pD / 2 },
      rotation: { x: 0, y: 0, z: sx * (90 - pAngle) },
      scale: { x: pSlope / ROOF_NATIVE_SLOPE, y: 1, z: (pD + 0.8) / ROOF_NATIVE_DEPTH },
    });
  }
  pieces.push({
    id: pid(), partId: 'gable-stone',
    position: { x: 0, y: pTop + pRoofH / 2, z: depth / 2 + pD },
    rotation: { x: 0, y: 0, z: 0 }, scale: { x: pW / 3, y: (pRoofH * 1.06) / 2.4, z: 1 },
  });
  for (const sx of [-1, 1]) {
    pieces.push({
      id: pid(), partId: 'trim-horns',
      position: { x: sx * (width / 2 - 1.2), y: wallTop + roofH + 0.4, z: 0 },
      rotation: { x: 0, y: 90, z: 0 }, scale: { x: 0.7, y: 1, z: 0.7 },
    });
  }
  types.push({
    id: 'th-bld-guild-hall', name: 'Adventurers Guild',
    footprint: { width: width + 1, depth: depth + pD + 1 },
    pieces, inlineShapes: [],
  });
}

// =============================================================================
// Replace only the 'th-*' entries this script owns; leave everything else.
// =============================================================================
const OWNED_PREFIX = 'th-';
const kept = JSON.parse(readFileSync(TYPES_PATH, 'utf8')).filter((t) => !t.id.startsWith(OWNED_PREFIX));
const mine = types.filter((t) => t.id.startsWith(OWNED_PREFIX));
const finalTypes = [...kept, ...mine];

writeFileSync(PARTS_PATH, JSON.stringify(parts, null, 2));
writeFileSync(TYPES_PATH, JSON.stringify(finalTypes, null, 2));
console.log(`Wrote ${parts.length} parts (${NEW_PARTS.length} new/updated) to ${path.relative(ROOT, PARTS_PATH)}`);
console.log(`Wrote ${finalTypes.length} building types (${mine.length} th-* entries) to ${path.relative(ROOT, TYPES_PATH)}`);
for (const t of mine) console.log(`  ${t.id.padEnd(22)} ${t.footprint.width}x${t.footprint.depth}m  ${t.pieces.length} pieces`);
