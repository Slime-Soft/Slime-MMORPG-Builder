// src/generators/environment/greatTower.js
// The Great Tower — the city's landmark and, later, the entrance to the Tower
// dungeon (CLAUDE.md's Phase 5).
//
// A tapering stack of pale stone drums, fluted with pilasters and belted with
// cornices, wrapped in glowing rune bands, studded with floating crystal shards
// and crowned by a great levitating crystal. The south face carries a GRAND
// GATE — a stepped, buttressed, banner-hung portal that lines up with the
// city's south avenue, which is where the dungeon teleporter is authored.
//
// It is a PROP, not a `world.buildings[]` entry: buildings are composed in the
// Building Builder from 3m wall panels, the wrong tool for a 140m
// rotationally-symmetric monument.
//
// Built through meshKit, so the whole tower is ~8 draw calls instead of 200.
import * as THREE from 'three';
import { makeKit, matte, glow } from './meshKit.js';

/** Total shaft height in metres. City buildings are ~10-16m for scale. */
export const GREAT_TOWER_HEIGHT = 140;
/** Radius of the widest part (the base plinth) — what the collider must cover. */
export const GREAT_TOWER_BASE_RADIUS = 24;
/** Compass angle of the grand gate. 90deg = +Z = the city's south avenue. */
export const GREAT_TOWER_GATE_DEG = 90;

// eslint-disable-next-line no-unused-vars -- `seed` keeps the standard prop
// builder signature; the tower is deliberately identical every time so the
// gate and the four portals stay on known compass angles.
export function generateGreatTower(seed = 1) {
  const k = makeKit();
  const RADIAL = 28;
  /**
   * Phase every decorative ring onto the gate axis. The tower is a monument
   * seen head-on from the city's south avenue, so it has to be mirror-symmetric
   * about that axis: reflection maps an angle `a` to `PI - a`, and a ring
   * `2*PI*j/n + phase` is closed under that reflection exactly when
   * `phase = PI/2 - PI*k/n`. `PI/2` (= the gate direction) is the k=0 case and
   * works for every count, so it is the one phase used everywhere below.
   */
  const GATE_PHASE = Math.PI / 2;

  // --- Stepped base plinth ---
  const plinth = [{ r: 24.0, h: 1.2 }, { r: 22.4, h: 1.2 }, { r: 21.0, h: 1.4 }];
  let y = 0;
  for (const step of plinth) {
    k.cyl('mid', step.r * 0.985, step.r, step.h, RADIAL, 0, y + step.h / 2, 0);
    y += step.h;
  }

  // --- Shaft: stacked tapering drums, each finished with a cornice ---
  const SEGMENTS = 8;
  const shaftTop = GREAT_TOWER_HEIGHT;
  const rBottom = 19.5;
  const rTop = 9.5;
  const segH = (shaftTop - y) / SEGMENTS;
  // Slightly concave taper (entasis); a straight cone reads as a traffic cone.
  const radiusAt = (t) => rBottom + (rTop - rBottom) * Math.pow(t, 1.18);

  for (let i = 0; i < SEGMENTS; i++) {
    const r0 = radiusAt(i / SEGMENTS);
    const r1 = radiusAt((i + 1) / SEGMENTS);
    const y0 = y + i * segH;
    k.cyl(i % 2 === 0 ? 'light' : 'mid', r1, r0, segH, RADIAL, 0, y0 + segH / 2, 0);

    // Pilasters. Standing 0.15 proud of the drum, never flush, so no face
    // shares a plane with the drum beneath it.
    const ribs = 16;
    const rMid = (r0 + r1) / 2;
    for (let j = 0; j < ribs; j++) {
      const a = (j / ribs) * Math.PI * 2;
      k.box(i % 2 === 0 ? 'mid' : 'deep', 0.9, segH * 0.88, 0.55,
        Math.cos(a) * (rMid + 0.15), y0 + segH / 2, Math.sin(a) * (rMid + 0.15), [0, -a, 0]);
    }

    // Glowing rune band recessed just under each cornice — the main source of
    // the tower's "this is arcane, not just tall" read at night.
    k.cyl('rune', r1 * 1.005, r1 * 1.02, 0.55, RADIAL, 0, y0 + segH - 2.6, 0);

    // Cornice: flare out, then tuck back in. Its top is pulled 0.06 BELOW the
    // segment boundary on purpose — sitting exactly on it put the band's top
    // face in the same plane as the drum's, once per cornice, all the way up.
    k.cyl('deep', r1 * 1.02, r1 * 1.11, 1.5, RADIAL, 0, y0 + segH - 0.81, 0);
    k.cyl('shadow', r1 * 1.13, r1 * 1.05, 0.7, RADIAL, 0, y0 + segH - 1.75, 0);
  }

  // --- Floating crystal shards, orbiting the shaft at four heights ---
  const shardRing = (frac, count, size, lift) => {
    const yy = y + (shaftTop - y) * frac;
    const rr = radiusAt(frac) + 4.5;
    for (let j = 0; j < count; j++) {
      // GATE_PHASE, not an arbitrary per-ring offset: the tower is read from the
      // south avenue, so every ring must be MIRROR-SYMMETRIC about the gate axis
      // (a -> PI - a). Phasing the ring onto that axis satisfies it for any
      // count, odd or even; `frac * 2.1` did not, which is what made the shards
      // read as scattered rather than placed.
      const a = (j / count) * Math.PI * 2 + GATE_PHASE;
      const g = new THREE.OctahedronGeometry(size, 0);
      g.scale(1, 2.1, 1);
      // The lean is baked into the GEOMETRY, then the placement only yaws it.
      // A tilt passed in the rotation triple is applied after the yaw (Euler
      // 'XYZ' composes as Rx*Ry*Rz), i.e. about the WORLD x/z axes — the same
      // absolute lean for every shard in the ring, which is chiral and is what
      // made the shards read as scattered. Rotating the geometry about its own
      // Z first makes the lean RADIALLY outward once yawed (yaw maps local +X
      // to the radial direction), and a radial lean mirrors cleanly.
      g.rotateZ(0.2);
      k.raw('crystal', g, Math.cos(a) * rr, yy + lift, Math.sin(a) * rr, [0, -a, 0]);
      // A smaller companion shard, directly outboard of its parent — offsetting
      // it around the ring (`a + 0.12`) was chiral for the same reason.
      const g2 = new THREE.OctahedronGeometry(size * 0.45, 0);
      g2.scale(1, 2.0, 1);
      g2.rotateZ(-0.25);
      k.raw('crystal', g2,
        Math.cos(a) * (rr + 1.6), yy + lift - size * 1.4, Math.sin(a) * (rr + 1.6),
        [0, -a, 0]);
    }
  };
  shardRing(0.22, 6, 1.9, 0);
  shardRing(0.46, 5, 1.7, 0);
  shardRing(0.70, 4, 1.5, 0);
  shardRing(0.90, 3, 1.3, 0);

  // --- Carved medallions ---
  for (const frac of [0.30, 0.62]) {
    const yy = y + (shaftTop - y) * frac;
    const rr = radiusAt(frac) + 0.5;
    for (let j = 0; j < 4; j++) {
      // On the gate/cardinal axes (was `+ 0.4`, which put one medallion off to
      // the side of the gate with no partner on the other side).
      const a = (j / 4) * Math.PI * 2 + GATE_PHASE;
      k.torus('shadow', 2.3, 0.42, Math.cos(a) * rr, yy, Math.sin(a) * rr, [0, -a + Math.PI / 2, 0]);
      k.cyl('rune', 0.9, 0.9, 0.5, 10, Math.cos(a) * (rr + 0.1), yy, Math.sin(a) * (rr + 0.1),
        [Math.PI / 2, 0, -a + Math.PI / 2]);
    }
  }

  // NO LESSER PORTALS. They were 'void'-coloured boxes set 0.6 inside the drum
  // but 1.6 deep, so they stood 0.2 PROUD of it — black slabs stuck onto the
  // tower rather than openings cut into it. There is no CSG here, so a recess
  // cannot be subtracted; the only honest options were a proud slab or nothing,
  // and the tower has one real entrance.

  // ===========================================================================
  // ===========================================================================
  // THE GRAND GATE — south face, aligned with the city's main avenue
  // ===========================================================================
  // A projecting porch standing on the plaza. Deliberately BLOCKY: the previous
  // version had a ring of 17 voussoirs, a second ring of glowing archivolt tiles
  // 1.2m further out, and spandrels layered over both. Those three rings sat at
  // nearly the same depth and overlapped constantly, which is what flickered and
  // what read as a scatter of loose tiles around the opening. Detail here comes
  // from a few big clean solids instead, with nothing sharing a plane.
  //
  // The porch's back is buried WELL INSIDE the drum. The shaft is a cylinder, so
  // a flat back face at radius ~20 only touches it at dead centre and leaves a
  // widening gap out towards the piers — the gap you could see through.
  // PORCH_BACK is therefore inside the base radius at the piers' full width.
  const ga = (GREAT_TOWER_GATE_DEG * Math.PI) / 180;
  const gx = Math.cos(ga);
  const gz = Math.sin(ga);
  /** World [x,z] at `out` metres along the gate's outward normal, `side` across. */
  const at = (out, side = 0) => [gx * out - gz * side, gz * out + gx * side];
  /** Yaw keeping a box square to the gate: rotation.y maps local +Z to
   *  (sin t, cos t), and we need the gate normal (cos ga, sin ga) => t = PI/2 - ga. */
  const GY = Math.PI / 2 - ga;

  const PIER_SIDE = 7.5;      // centre-to-centre half spacing
  const PIER_W = 4.0;
  const PIER_H = 15;
  const OPEN_H = 12.5;        // clear height of the doorway
  const HALF_SPAN = PIER_SIDE - PIER_W / 2;   // 5.5 -> an 11m opening
  const FULL_W = PIER_SIDE * 2 + PIER_W;      // outer width of the whole porch
  // Back face must sit inside the drum even at the porch's outer corners:
  // at |x| = FULL_W/2 the cylinder surface is at z = sqrt(rBottom^2 - x^2).
  const PORCH_BACK = Math.sqrt(Math.max(1, rBottom * rBottom - (FULL_W / 2) ** 2)) - 3.5;
  const PORCH_FRONT = 32;
  const PORCH_MID = (PORCH_BACK + PORCH_FRONT) / 2;
  const PORCH_D = PORCH_FRONT - PORCH_BACK;

  // Pavement + two shallow entry slabs, all at plaza level.
  {
    const [px, pz] = at(PORCH_MID);
    k.box('light', FULL_W + 1.6, 0.3, PORCH_D, px, 0.15, pz, [0, GY, 0]);
    const [d1x, d1z] = at(PORCH_FRONT + 1.3);
    k.box('mid', FULL_W + 3.4, 0.2, 2.6, d1x, 0.10, d1z, [0, GY, 0]);
    const [d2x, d2z] = at(PORCH_FRONT + 3.4);
    k.box('light', FULL_W + 5.2, 0.1, 2.2, d2x, 0.05, d2z, [0, GY, 0]);
  }

  // Piers.
  for (const side of [-1, 1]) {
    const [px, pz] = at(PORCH_MID, side * PIER_SIDE);
    k.box('mid', PIER_W + 1.4, 1.2, PORCH_D + 1.0, px, 0.6, pz, [0, GY, 0]);
    k.box('light', PIER_W, PIER_H - 1.2, PORCH_D, px, 1.2 + (PIER_H - 1.2) / 2, pz, [0, GY, 0]);
    k.box('deep', PIER_W + 1.4, 1.3, PORCH_D + 1.0, px, PIER_H + 0.65, pz, [0, GY, 0]);
    // One rune pilaster per pier, standing proud of the front face.
    const [rx, rz] = at(PORCH_FRONT + 0.25, side * PIER_SIDE);
    k.box('rune', PIER_W * 0.4, PIER_H - 4.5, 0.5, rx, 1.2 + (PIER_H - 4.5) / 2, rz, [0, GY, 0]);
    // Crystal finial.
    const g = new THREE.OctahedronGeometry(2.1, 0);
    g.scale(1, 1.9, 1);
    k.raw('crystal', g, px, PIER_H + 4.6, pz, [0, GY, 0]);
    // Brazier on the pavement, well clear of the pier.
    const [bx, bz] = at(PORCH_FRONT - 3.0, side * (PIER_SIDE - 0.4));
    k.cyl('deep', 1.3, 0.8, 1.2, 10, bx, 0.9, bz);
    k.cyl('crystal', 1.05, 1.05, 0.28, 10, bx, 1.62, bz);
  }

  // Header over the doorway. Embedded 0.3 into each pier so no end face is
  // flush with a pier face.
  {
    const [hx, hz] = at(PORCH_MID);
    k.box('light', HALF_SPAN * 2 + 0.6, PIER_H - OPEN_H - 1.2, PORCH_D,
      hx, OPEN_H + (PIER_H - OPEN_H - 1.2) / 2, hz, [0, GY, 0]);
    // Glowing lintel band on the front face only.
    const [lx, lz] = at(PORCH_FRONT + 0.2);
    k.box('rune', HALF_SPAN * 2 - 0.6, 0.9, 0.4, lx, OPEN_H + 0.85, lz, [0, GY, 0]);
    // Keystone.
    const [kx, kz] = at(PORCH_FRONT + 0.3);
    k.box('deep', 2.2, 2.6, 0.7, kx, OPEN_H + 1.9, kz, [0, GY, 0]);
  }

  // Entablature and cornice across the whole porch.
  {
    const [ex, ez] = at(PORCH_MID);
    k.box('deep', FULL_W + 2.8, 1.9, PORCH_D + 1.6, ex, PIER_H + 2.25, ez, [0, GY, 0]);
    k.box('mid', FULL_W + 1.2, 1.1, PORCH_D + 0.8, ex, PIER_H + 3.75, ez, [0, GY, 0]);
    const [fx, fz] = at(PORCH_FRONT + 1.05);
    k.cyl('gold', 1.9, 1.9, 0.35, 14, fx, PIER_H + 2.25, fz, [Math.PI / 2, GY, 0]);
    const g = new THREE.OctahedronGeometry(3.2, 0);
    g.scale(1, 1.8, 1);
    k.raw('crystal', g, ex, PIER_H + 9.0, ez);
  }

  // Banners hung against the PIERS, not across the opening. A single 4.6 m
  // banner down the centre of the doorway is a curtain over the way in.
  for (const side of [-1, 1]) {
    for (let j = 0; j < 5; j++) {
      const [bx, bz] = at(PORCH_FRONT - 0.4 + j * 0.02, side * (HALF_SPAN - 1.3));
      k.box('banner', 2.2 - j * 0.1, 1.6, 0.2, bx, OPEN_H - 1.1 - j * 1.6, bz, [0, GY, 0]);
    }
  }

  // A REAL ENTRANCE. This used to be a flat 'void' panel at the back of the
  // porch with three steps in FRONT of it that got taller the further out they
  // went — so you climbed a rising kerb and walked into a painted wall. The
  // passage now runs deep into the drum, its mouth arched, with the pavement
  // flat all the way to it.
  {
    const PASS_W = HALF_SPAN * 2 - 1.4;
    // Springing height is capped so the arch CROWN (PASS_H + PASS_W/2) and its
    // surround both stay under the header's underside at OPEN_H. At OPEN_H-1.6
    // the crown reached 15.7 against a 12.5 header and burst through the top of
    // the porch as a fan of dark fins.
    const PASS_H = 6.6;
    const PASS_D = 9.0;
    // The mouth stands 0.3 PROUD of the drum surface (radius rBottom on the
    // gate axis), not behind it. There is no CSG here: a dark box placed inside
    // an opaque cylinder is simply invisible, and what you then walk into is
    // the drum — which is exactly what "walking into a wall" was. Standing it
    // proud is the same trick the arrow loops and hearth mouths use.
    const MOUTH = rBottom + 0.3;
    const [tx, tz] = at(MOUTH - PASS_D / 2);
    k.box('void', PASS_W, PASS_H, PASS_D, tx, PASS_H / 2, tz, [0, GY, 0]);
    const [hx, hz] = at(MOUTH - PASS_D / 2);
    k.cyl('void', PASS_W / 2, PASS_W / 2, PASS_D, 16, hx, PASS_H, hz,
      [Math.PI / 2, GY, 0], Math.PI, Math.PI / 2);
    // Arched surround and jambs on the mouth, standing further proud again.
    const [ax2, az2] = at(MOUTH + 0.35);
    k.torus('deep', PASS_W / 2 + 0.4, 0.5, ax2, PASS_H, az2, [0, GY, 0], Math.PI);
    for (const side of [-1, 1]) {
      const [jx, jz] = at(MOUTH + 0.35, side * (PASS_W / 2 + 0.5));
      k.box('deep', 1.6, PASS_H, 1.6, jx, PASS_H / 2, jz, [0, GY, 0]);
    }
    // A rune strip let into the pavement, running from the plaza to the mouth.
    const [rx2, rz2] = at((PORCH_BACK + PORCH_FRONT) / 2 + 1.0);
    k.box('rune', 2.2, 0.12, PORCH_D - 2.0, rx2, 0.32, rz2, [0, GY, 0]);
  }

  // --- Crown: flared cap, merlons, and a great levitating crystal ---
  const crownY = shaftTop;
  const crownR = rTop * 1.16;
  k.cyl('deep', crownR, rTop * 1.02, 2.6, RADIAL, 0, crownY + 1.3, 0);
  for (let j = 0; j < 16; j++) {
    const a = (j / 16) * Math.PI * 2;
    k.box('light', 1.9, 2.4, 1.1,
      Math.cos(a) * (crownR - 0.7), crownY + 3.8, Math.sin(a) * (crownR - 0.7), [0, -a, 0]);
  }
  k.cyl('rune', crownR * 0.92, crownR * 0.92, 0.6, RADIAL, 0, crownY + 5.4, 0);
  // Three buttresses cradling the crystal. The inward lean is baked into the
  // geometry (as with the shards): the previous world-space tilt triple did not
  // mirror across the gate axis.
  for (let j = 0; j < 3; j++) {
    const a = (j / 3) * Math.PI * 2 + GATE_PHASE;
    const g = new THREE.BoxGeometry(1.0, 7.5, 1.0);
    g.rotateZ(0.3); // +Z roll tips the top towards local -X, i.e. radially inward
    k.raw('mid', g,
      Math.cos(a) * crownR * 0.55, crownY + 8.5, Math.sin(a) * crownR * 0.55, [0, -a, 0]);
  }
  {
    const g = new THREE.OctahedronGeometry(6.2, 0);
    g.scale(1, 1.75, 1);
    k.raw('crystal', g, 0, crownY + 17, 0);
    // SIX, not five: the alternating height uses `j % 2`, and under the mirror
    // (which maps j -> -j mod n) that parity only survives for an even count.
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 2 + GATE_PHASE;
      const g2 = new THREE.OctahedronGeometry(1.5, 0);
      g2.scale(1, 2.0, 1);
      g2.rotateZ(0.3); // radial lean, baked in — see shardRing for why
      k.raw('crystal', g2, Math.cos(a) * 7.5, crownY + 12 + (j % 2) * 2.4, Math.sin(a) * 7.5,
        [0, -a, 0]);
    }
  }

  const CRYSTAL = 0x7fd8f0;
  return k.finish({
    light: matte(0xded8c8),
    mid: matte(0xcbc4b0),
    deep: matte(0xb0a892),
    shadow: matte(0x8f8875),
    void: matte(0x2a2622),
    rune: glow(0x6fc8ea, 1.15),
    crystal: new THREE.MeshStandardMaterial({
      color: CRYSTAL, emissive: CRYSTAL, emissiveIntensity: 0.95,
      roughness: 0.15, metalness: 0, flatShading: true,
      transparent: true, opacity: 0.88,
    }),
    banner: matte(0x2f5f8c),
    gold: matte(0xd8b45a),
  });
}
