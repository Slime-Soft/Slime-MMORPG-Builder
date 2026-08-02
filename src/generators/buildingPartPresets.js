// src/generators/buildingPartPresets.js
// Starter content for the Building Part Library (src/sim/buildingPartDefs.js)
// — seeded into building-parts.json on first server boot, same principle as
// characterPresets.js seeding character-types.json: the Building Builder
// opens with real, editable pieces instead of a blank canvas.
//
// Every part here is built from the EXISTING shape vocabulary
// (src/sim/shapeKinds.js) — box/cylinder/cone plus the two parametric
// building kinds (log-wall, shingle-roof-panel) — so adding a preset is pure
// data, no new geometry-generator code. `buildShapeMesh`
// (src/generators/custom.js) applies `scale` BEFORE `rotation` BEFORE
// `position` (standard Three.js T*R*S composition), which matters for the
// round window/arched-door pieces below: a cylinder is scaled into a flat
// disc first, THEN rotated 90° about X so its flat round face ends up
// pointing along +Z (outward from a wall) instead of +Y.
export const BUILDING_PART_PRESETS = [
  // --- Walls ---------------------------------------------------------------
  {
    id: 'wall-log', name: 'Log Wall', category: 'wall',
    shapes: [
      { id: 's1', kind: 'log-wall', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 2.5, z: 1 }, color: 0x6b4a34 },
    ],
  },
  {
    id: 'wall-timber-frame', name: 'Timber-Frame Wall', category: 'wall',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 1.25, z: 0 }, scale: { x: 3, y: 2.5, z: 0.3 }, color: 0xd8cdb8 },
      { id: 's2', kind: 'box', position: { x: -0.9, y: 1.25, z: 0.16 }, rotation: { x: 0, y: 0, z: 35 }, scale: { x: 0.12, y: 2.6, z: 0.08 }, color: 0x4a3320 },
      { id: 's3', kind: 'box', position: { x: 0.9, y: 1.25, z: 0.16 }, rotation: { x: 0, y: 0, z: -35 }, scale: { x: 0.12, y: 2.6, z: 0.08 }, color: 0x4a3320 },
      { id: 's4', kind: 'box', position: { x: 0, y: 2.3, z: 0.16 }, scale: { x: 3, y: 0.12, z: 0.08 }, color: 0x4a3320 },
    ],
  },
  {
    id: 'wall-stone', name: 'Stone Block Wall', category: 'wall',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 1.25, z: 0 }, scale: { x: 3, y: 2.5, z: 0.4 }, color: 0x8f867d },
      { id: 's2', kind: 'box', position: { x: -1, y: 0.5, z: 0.22 }, scale: { x: 0.9, y: 0.9, z: 0.06 }, color: 0x776e64 },
      { id: 's3', kind: 'box', position: { x: 0, y: 0.5, z: 0.22 }, scale: { x: 0.9, y: 0.9, z: 0.06 }, color: 0x999088 },
      { id: 's4', kind: 'box', position: { x: 1, y: 0.5, z: 0.22 }, scale: { x: 0.9, y: 0.9, z: 0.06 }, color: 0x776e64 },
    ],
  },
  {
    id: 'wall-plaster', name: 'Plaster Wall', category: 'wall',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 1.25, z: 0 }, scale: { x: 3, y: 2.5, z: 0.35 }, color: 0xe8d9b8 },
    ],
  },

  // --- Roofs -----------------------------------------------------------------
  {
    id: 'roof-shingle-blue', name: 'Shingle Roof — Blue', category: 'roof',
    shapes: [
      { id: 's1', kind: 'shingle-roof-panel', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 4 }, color: 0x3f6f8a },
    ],
  },
  {
    id: 'roof-shingle-red', name: 'Shingle Roof — Red', category: 'roof',
    shapes: [
      { id: 's1', kind: 'shingle-roof-panel', position: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 1, z: 4 }, color: 0xa8543f },
    ],
  },
  {
    id: 'roof-flat-tile', name: 'Flat Tile Roof', category: 'roof',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.25, z: 4.5 }, color: 0x6a6a6a },
    ],
  },
  {
    id: 'roof-tower-cone', name: 'Conical Tower Roof', category: 'roof',
    shapes: [
      { id: 's1', kind: 'cone', position: { x: 0, y: 1.5, z: 0 }, scale: { x: 2.6, y: 3, z: 2.6 }, color: 0x3a3a6a },
    ],
  },

  // --- Windows -----------------------------------------------------------------
  {
    id: 'window-framed', name: 'Framed Window', category: 'window',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 1.05, y: 1.15, z: 0.1 }, color: 0x3a2818 },
      { id: 's2', kind: 'box', position: { x: 0, y: 0, z: 0.06 }, scale: { x: 0.9, y: 1.0, z: 0.04 }, color: 0x3a5a6a },
    ],
  },
  {
    id: 'window-round', name: 'Round Window', category: 'window',
    shapes: [
      { id: 's1', kind: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 0.9, y: 0.12, z: 0.9 }, color: 0x3a2818 },
      { id: 's2', kind: 'cylinder', position: { x: 0, y: 0, z: 0.06 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 0.7, y: 0.08, z: 0.7 }, color: 0x3a5a6a },
    ],
  },

  // --- Doors -----------------------------------------------------------------
  {
    id: 'door-framed', name: 'Framed Door', category: 'door',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 1.1, z: 0 }, scale: { x: 1.65, y: 2.35, z: 0.15 }, color: 0x3a2818 },
      { id: 's2', kind: 'box', position: { x: 0, y: 1.1, z: 0.08 }, scale: { x: 1.5, y: 2.2, z: 0.05 }, color: 0x0f0a08 },
    ],
  },
  {
    id: 'door-arched', name: 'Arched Door', category: 'door',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0.9, z: 0 }, scale: { x: 1.5, y: 1.8, z: 0.15 }, color: 0x3a2818 },
      { id: 's2', kind: 'cylinder', position: { x: 0, y: 1.8, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1.5, y: 0.15, z: 1.5 }, color: 0x3a2818 },
      { id: 's3', kind: 'box', position: { x: 0, y: 0.9, z: 0.08 }, scale: { x: 1.35, y: 1.7, z: 0.05 }, color: 0x0f0a08 },
    ],
  },

  // --- Trim / ornaments --------------------------------------------------------
  {
    id: 'trim-horns', name: 'Crossed Roof Horns', category: 'trim',
    shapes: [
      { id: 's1', kind: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 28.6 }, scale: { x: 0.12, y: 4, z: 0.18 }, color: 0x3a2818 },
      { id: 's2', kind: 'cylinder', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: -28.6 }, scale: { x: 0.12, y: 4, z: 0.18 }, color: 0x3a2818 },
    ],
  },
  {
    id: 'trim-ridge-beam', name: 'Ridge Beam', category: 'trim',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0, z: 0 }, scale: { x: 0.22, y: 0.22, z: 4.3 }, color: 0x3a2818 },
    ],
  },
  {
    id: 'trim-chimney', name: 'Chimney', category: 'trim',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0.75, z: 0 }, scale: { x: 0.6, y: 1.5, z: 0.6 }, color: 0x8f867d },
      { id: 's2', kind: 'box', position: { x: 0, y: 1.58, z: 0 }, scale: { x: 0.75, y: 0.16, z: 0.75 }, color: 0x776e64 },
    ],
  },

  // Gable infill: the triangular gap between a flat wall's top edge and a
  // sloped roof above it — without one of these, that gap is just open air
  // (this is what the very first longhouse attempt was missing entirely).
  // The 'wedge' shape kind already IS this exact triangle (base along X at
  // its bottom, apex at its top — see custom.js's wedgeGeometry), so no new
  // geometry code, just one per wall style so the color matches whichever
  // wall it's paired with. `position.y = scale.y/2` puts the wedge's base at
  // local y=0, matching the wall presets' own bottom-center origin — sits
  // flush on top of a wall of the same width without extra offsetting.
  {
    id: 'gable-log', name: 'Gable — Log', category: 'trim',
    shapes: [
      { id: 's1', kind: 'wedge', position: { x: 0, y: 1.2, z: 0 }, scale: { x: 3, y: 2.4, z: 0.15 }, color: 0x6b4a34 },
    ],
  },
  {
    id: 'gable-timber-frame', name: 'Gable — Timber-Frame', category: 'trim',
    shapes: [
      { id: 's1', kind: 'wedge', position: { x: 0, y: 1.2, z: 0 }, scale: { x: 3, y: 2.4, z: 0.15 }, color: 0xd8cdb8 },
    ],
  },
  {
    id: 'gable-stone', name: 'Gable — Stone', category: 'trim',
    shapes: [
      { id: 's1', kind: 'wedge', position: { x: 0, y: 1.2, z: 0 }, scale: { x: 3, y: 2.4, z: 0.2 }, color: 0x8f867d },
    ],
  },
  {
    id: 'gable-plaster', name: 'Gable — Plaster', category: 'trim',
    shapes: [
      { id: 's1', kind: 'wedge', position: { x: 0, y: 1.2, z: 0 }, scale: { x: 3, y: 2.4, z: 0.15 }, color: 0xe8d9b8 },
    ],
  },

  // --- Other -----------------------------------------------------------------
  {
    id: 'plinth-stone', name: 'Stone Plinth', category: 'other',
    shapes: [
      { id: 's1', kind: 'box', position: { x: 0, y: 0.22, z: 0 }, scale: { x: 3.5, y: 0.44, z: 4.5 }, color: 0x8f867d },
    ],
  },
];
