// src/sim/propTypes.js
// The scenery catalog: every prop type the World Editor can place, what
// category it lives under, and how it collides.
//
// Pure data, no Three (enforced by scripts/check-architecture.mjs). The meshes
// are built in src/generators/props.js; the two files are keyed by the same
// `id`, and `npm run check:props` fails if either grows an id the other lacks.
//
// COLLISION lives here rather than in the generator because the server has to
// answer "can the player walk here" without ever building a mesh:
//   'trunk'  — derived from the tree's own seeded trunk radius (propMetrics)
//   'rock'   — derived from the rock's own seeded base radius
//   'fixed'  — a hand-set radius, for props whose footprint isn't seed-driven
//   null     — walk straight through it (grass, flowers, small plants)
//
// Adding a prop type is: a row here, a builder in props.js, done. It then shows
// up in the editor's scenery palette automatically.
//
// PLUGINS: for a truly zero-edit path (drop a file, it appears — no editing
// this file or props.js at all), see src/generators/environment/plugins/.
// Those register themselves at runtime via registerPluginType() below, kept
// simple on purpose: collider is always null (walk-through), same as flowers/
// small plants. A plugin prop that needs real collision still gets a manual
// row here with a `fixed(radius)` collider — see the plugins README.

/** Palette tabs, in display order. */
export const PROP_CATEGORIES = [
  { id: 'trees', label: 'Trees', icon: '🌲' },
  { id: 'plants', label: 'Small Plants', icon: '🌿' },
  { id: 'rocks', label: 'Rocks', icon: '🪨' },
  { id: 'outdoors-decor', label: 'Outdoors Decor', icon: '🪵' },
  { id: 'indoors-decor', label: 'Indoors Decor', icon: '🪑' },
  { id: 'buildings', label: 'Buildings', icon: '🏚️' },
  { id: 'defenses', label: 'Walls & Defenses', icon: '🛡️' },
  { id: 'crafting-stations', label: 'Crafting Stations', icon: '🔨' },
  { id: 'countryside', label: 'Countryside', icon: '🌾' },
  { id: 'cave', label: 'Cave & Dungeon', icon: '🕯️' },
  { id: 'garden', label: 'Garden & Park', icon: '🏛️' },
  { id: 'ruins', label: 'Ruins & Ancient', icon: '🏚️' },
  { id: 'arcane', label: 'Arcane & Magic', icon: '🔮' },
  // Every model file sitting in src/generators/environment/import/ — the
  // drop-a-file-in-a-folder path for assets made elsewhere (another AI, a
  // teammate, an asset pack). Nothing is ever hand-registered under this tab;
  // the server scans that folder and the entries arrive through the same
  // imported-model catalog an uploaded .glb uses. See that folder's README.
  { id: 'imported', label: 'Imported', icon: '📥' },
  { id: 'misc', label: 'Misc', icon: '📦' },
];

const trunk = { kind: 'trunk' };
const rock = (scale = 1) => ({ kind: 'rock', scale });
// Rocks are modelled half-sunk into the ground on purpose (see generateRock's
// `mesh.position.y = baseRadius * 0.35`), so the ground-contact check exempts them.
const BURIED = true;
// Hangs off a wall or ceiling: a ceiling panel, a torch bracket, a lantern on a
// chain, a stalactite. Its MOUNT PLANE is y = 0 and its geometry hangs BELOW
// that, so the author sets the ceiling height with the editor's Height field
// and the piece lands there — no per-prop offset to remember.
//
// That means BOTH halves of check:props' ground rule are meaningless for these
// (they neither reach the ground nor sink into it — there is no ground where
// they live), and check:parts' floating-island rule is too: floating IS the
// shape. All three are exempted, with the reason recorded in each script, and
// a rule that DOES apply is checked in their place — see check-props.mjs.
// Nothing outside the cave kit's ceiling/wall pieces may use it.
//
// CEILING vs WALL is not decoration. A ceiling piece hangs entirely BELOW its
// mount plane, so "the plane is y=0" means its top is at zero. A wall bracket
// is fixed to a vertical surface and reaches both up and down from its fixing
// point — a torch's arm and flame stand a metre above the plate. Holding the
// torch to the ceiling rule would have forced its flame down to the fixing
// height, which is upside down; so the two are distinguished and checked
// differently. Both are truthy, so `if (def.mounted)` still reads naturally.
const CEILING = 'ceiling';
const WALL = 'wall';
const fixed = (radius) => ({ kind: 'fixed', radius });

/**
 * @typedef {Object} PropTypeDef
 * @property {string} id            the value stored in world.json's prop.type
 * @property {string} label         shown in the palette
 * @property {string} category      one of PROP_CATEGORIES
 * @property {{kind:'trunk'|'rock'|'fixed', radius?:number}|null} collider
 * @property {number} [thumbScale]  camera framing hint for the palette thumbnail
 */

/** @type {PropTypeDef[]} */
export const PROP_TYPES = [
  // --- Trees. 'tree' predates the catalog and picks conifer/round from its
  // seed; the explicit variants let an author choose deliberately. ---
  { id: 'tree', label: 'Tree (any)', category: 'trees', collider: trunk },
  { id: 'tree-pine', label: 'Pine', category: 'trees', collider: trunk },
  { id: 'tree-oak', label: 'Oak', category: 'trees', collider: trunk },
  { id: 'tree-birch', label: 'Birch', category: 'trees', collider: trunk },
  { id: 'tree-dead', label: 'Dead Tree', category: 'trees', collider: trunk },
  { id: 'tree-willow', label: 'Willow', category: 'trees', collider: trunk },
  { id: 'bush', label: 'Bush', category: 'trees', collider: fixed(0.55) },

  // --- Biome trees (desert/swamp/snow/mountain). Same trunk collider as
  // every other tree; see treeSilhouette() below for the forced sampleTree
  // type each one's generator uses — it must match exactly, or the client's
  // rendered trunk radius and the server's collision radius desync (see
  // src/sim/propMetrics.js's draw-order comment).
  { id: 'tree-palm', label: 'Palm', category: 'trees', collider: trunk },
  { id: 'cactus-saguaro', label: 'Saguaro Cactus', category: 'trees', collider: trunk },
  { id: 'tree-cypress', label: 'Cypress', category: 'trees', collider: trunk },
  { id: 'tree-pine-snow', label: 'Snow Pine', category: 'trees', collider: trunk },
  { id: 'tree-alpine', label: 'Alpine Conifer', category: 'trees', collider: trunk },

  // --- Small plants: decoration, never blocking. ---
  { id: 'grass', label: 'Grass Tuft', category: 'plants', collider: null },
  { id: 'grass-meadow', label: 'Meadow Grass', category: 'plants', collider: null },
  { id: 'fern', label: 'Fern', category: 'plants', collider: null },
  { id: 'reeds', label: 'Reeds', category: 'plants', collider: null },
  { id: 'flower', label: 'Flower', category: 'plants', collider: null },
  { id: 'flower-daisy', label: 'Daisies', category: 'plants', collider: null },
  { id: 'flower-bell', label: 'Bluebells', category: 'plants', collider: null },
  { id: 'flower-meadow', label: 'Meadow Flowers', category: 'plants', collider: null },
  { id: 'mushroom', label: 'Mushroom', category: 'plants', collider: null },
  { id: 'mushroom-cluster', label: 'Mushrooms', category: 'plants', collider: null },
  { id: 'flower-desert', label: 'Desert Bloom', category: 'plants', collider: null },
  { id: 'flower-swamp', label: 'Marsh Flower', category: 'plants', collider: null },
  { id: 'flower-snowdrop', label: 'Snowdrop', category: 'plants', collider: null },
  { id: 'flower-alpine', label: 'Alpine Flower', category: 'plants', collider: null },

  // --- Rocks. ---
  { id: 'rock', buried: BURIED, label: 'Rock', category: 'rocks', collider: rock() },
  { id: 'boulder', buried: BURIED, label: 'Boulder', category: 'rocks', collider: rock(1.9) },
  { id: 'rock-sharp', buried: BURIED, label: 'Sharp Rock', category: 'rocks', collider: rock(1.2) },
  { id: 'rock-cluster', buried: BURIED, label: 'Rock Cluster', category: 'rocks', collider: fixed(1.1) },
  { id: 'pebbles', label: 'Pebbles', category: 'rocks', collider: null },
  { id: 'ore', buried: BURIED, label: 'Ore Deposit', category: 'rocks', collider: rock(1.3) },
  { id: 'crystal', label: 'Crystal', category: 'rocks', collider: fixed(0.5) },
  // Faceted crystal-cluster upgrade (reference-image ask, 2026-07-12) —
  // added alongside 'crystal' rather than replacing it.
  { id: 'crystal-rose', buried: BURIED, label: 'Rose Crystal', category: 'rocks', collider: fixed(0.5) },
  { id: 'crystal-emerald', buried: BURIED, label: 'Emerald Crystal', category: 'rocks', collider: fixed(0.5) },
  { id: 'crystal-frost', buried: BURIED, label: 'Frost Crystal', category: 'rocks', collider: fixed(0.5) },
  { id: 'crystal-amethyst', buried: BURIED, label: 'Amethyst Crystal', category: 'rocks', collider: fixed(0.5) },
  { id: 'rock-sandstone', buried: BURIED, label: 'Sandstone Rock', category: 'rocks', collider: rock() },
  { id: 'rock-mossy', buried: BURIED, label: 'Mossy Rock', category: 'rocks', collider: rock() },
  { id: 'rock-snowy', buried: BURIED, label: 'Snowy Rock', category: 'rocks', collider: rock() },
  { id: 'rock-mountain', buried: BURIED, label: 'Mountain Rock', category: 'rocks', collider: rock(1.4) },

  // --- Decor. ---
  { id: 'stump', label: 'Stump', category: 'outdoors-decor', collider: fixed(0.5) },
  { id: 'log', label: 'Fallen Log', category: 'outdoors-decor', collider: fixed(0.45) },
  { id: 'branch', label: 'Branch', category: 'outdoors-decor', collider: null },
  { id: 'runestone', label: 'Runestone', category: 'outdoors-decor', collider: fixed(0.55) },

  // --- Crafting stations. Decorative + collidable like any other prop — the
  // actual interaction (which professions/recipes it serves) comes from an Event
  // object attached to the placed instance, not from anything here. A station
  // type's `visualPropType` (src/sim/craftingStations.js) usually names one of
  // these, but it can name any prop: leatherworking and alchemy point at the
  // detailed `workstation-*` builds further down instead. ---
  { id: 'station-anvil', label: 'Anvil & Forge', category: 'crafting-stations', collider: fixed(0.9) },
  { id: 'station-workbench', label: 'Workbench', category: 'crafting-stations', collider: fixed(0.8) },
  { id: 'station-loom', label: 'Loom', category: 'crafting-stations', collider: fixed(0.9) },
  { id: 'station-jewelers-bench', label: "Jeweler's Bench", category: 'crafting-stations', collider: fixed(0.6) },
  { id: 'station-alchemy-lab', label: 'Alchemy Lab', category: 'crafting-stations', collider: fixed(0.7) },
  { id: 'station-campfire', label: 'Campfire & Oven', category: 'crafting-stations', collider: fixed(0.7) },

  // --- Detailed workstations (src/generators/environment/workstations.js),
  // rebuilt from a reference sheet 2026-07-25. Filed under 'misc' as asked,
  // alongside — not replacing — the simpler `station-*` props above. Each has
  // an authored front (+Z), so place them with a rotation rather than
  // expecting the generator to spin them. ---
  // Colliders are 2x the authored metre dimensions, matching workstations.js's
  // SCALE — keep the two in step if that constant ever moves.
  { id: 'workstation-forge', label: "Blacksmith's Forge", category: 'misc', collider: fixed(1.8) },
  { id: 'workstation-carpenter', label: "Carpenter's Bench", category: 'misc', collider: fixed(1.6) },
  { id: 'workstation-tapestry-loom', label: 'Tapestry Loom', category: 'misc', collider: fixed(1.4) },
  { id: 'workstation-floor-loom', label: "Weaver's Floor Loom", category: 'misc', collider: fixed(1.7) },
  { id: 'workstation-tanning-rack', label: 'Tanning Rack', category: 'misc', collider: fixed(1.7) },
  { id: 'workstation-jeweler', label: "Jeweler's Desk", category: 'misc', collider: fixed(1.2) },
  { id: 'workstation-alchemy', label: 'Alchemy Cabinet', category: 'misc', collider: fixed(1.24) },
  { id: 'workstation-hearth', label: 'Cooking Hearth', category: 'misc', collider: fixed(1.6) },

  // --- Town / street furniture (src/generators/environment/townProps.js).
  // Filed under Outdoors Decor since that is where an author looks for them
  // when dressing a street. Each has an authored front (+Z). ---
  { id: 'market-stall', label: 'Market Stall', category: 'outdoors-decor', collider: fixed(1.6) },
  { id: 'street-lantern', label: 'Street Lantern', category: 'outdoors-decor', collider: fixed(0.3) },
  { id: 'barrel', label: 'Barrel', category: 'outdoors-decor', collider: fixed(0.4) },
  { id: 'barrel-stack', label: 'Barrel Stack', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'crate', label: 'Crate', category: 'outdoors-decor', collider: fixed(0.45) },
  { id: 'crate-stack', label: 'Crate Stack', category: 'outdoors-decor', collider: fixed(0.8) },
  { id: 'flower-planter', label: 'Flower Planter', category: 'outdoors-decor', collider: fixed(0.6) },
  { id: 'town-well', label: 'Town Well', category: 'outdoors-decor', collider: fixed(1.25) },
  { id: 'shop-sign', label: 'Shop Sign', category: 'outdoors-decor', collider: fixed(0.25) },
  { id: 'banner-pole', label: 'Banner Pole', category: 'outdoors-decor', collider: fixed(0.35) },

  // --- Half-timbered townhouses (src/generators/environment/townhouse.js).
  // Placed as PROPS rather than world.buildings[] so they get the seeded
  // generator + palette variation; each merges to ~10 meshes internally.
  // Colliders sit near the INSCRIBED radius, not the circumscribed one: a
  // circle big enough to cover a wide house's corners also blocks thin air
  // out at its sides, and an invisible wall is worse than clipping a corner. ---
  { id: 'house-narrow', label: 'House — Narrow', category: 'buildings', collider: fixed(2.9) },
  { id: 'house-wide', label: 'House — Wide', category: 'buildings', collider: fixed(4.3) },
  { id: 'house-tall', label: 'House — Tall', category: 'buildings', collider: fixed(3.4) },
  { id: 'house-small', label: 'House — Small', category: 'buildings', collider: fixed(2.7) },
  { id: 'house-corner', label: 'House — Corner', category: 'buildings', collider: fixed(4.1) },
  { id: 'house-steep', label: 'House — Steep Gable', category: 'buildings', collider: fixed(3.1) },
  { id: 'house-squat', label: 'House — Squat', category: 'buildings', collider: fixed(4.0) },
  { id: 'house-gabled', label: 'House — Gabled', category: 'buildings', collider: fixed(3.5) },
  { id: 'bld-tavern', label: 'Tavern', category: 'buildings', collider: fixed(4.9) },
  { id: 'bld-inn', label: 'Inn', category: 'buildings', collider: fixed(5.2) },
  { id: 'bld-store', label: 'General Store', category: 'buildings', collider: fixed(4.1) },
  { id: 'bld-workshop', label: 'Craft Workshop', category: 'buildings', collider: fixed(4.4) },
  { id: 'bld-guild-hall', label: 'Adventurers Guild', category: 'buildings', collider: fixed(8.5) },

  // --- Trade shops and the church: WITHDRAWN 2026-08-01, one day after they
  // shipped. They were built as `buildTownhouse(...)` plus a bolted-on dressing
  // group, and that architecture is why they came out as reskins of the houses
  // above rather than as the buildings in the reference sheets — those have
  // genuinely different MASSING (the blacksmith is a stone forge hall joined to
  // a smaller house; the jeweller is two storeys of ornamented stone with a
  // hipped roof; the carpenter is a largely open timber shed). No amount of
  // dressing on one silhouette produces a second silhouette.
  //
  // The rows are removed rather than left in place because `check:props`
  // enforces metadata<->builder parity, so a half-removed type fails loudly
  // instead of quietly staying placeable. None were placed in any map when
  // they were withdrawn, so nothing in world/maps needed migrating.
  //
  // They come back ONE AT A TIME, each re-added here only after its silhouette
  // has been checked against its reference. Generator code stays in
  // src/generators/environment/tradeBuildings.js meanwhile.
  //
  // Rebuilt from references/blacksmith-massing.md as three composed volumes.
  // Collider covers the two roofed masses; the anvil, barrels and woodpile sit
  // outside it on purpose — walking up to the anvil is the point of it.
  { id: 'bld-blacksmith', label: 'Blacksmith', category: 'buildings', collider: fixed(5.4) },
  // From references/tailor-massing.md: one long block; the bolt stack and
  // fabric tables sit outside the collider so you can walk up to them.
  { id: 'bld-tailor', label: 'Tailor', category: 'buildings', collider: fixed(4.6) },
  // From references/carpenter-massing.md: stone workshop, built outright
  // rather than on a townhouse shell. Scaffold, shed and timber stacks sit
  // outside the collider so you can walk among them.
  { id: 'bld-carpenter', label: 'Carpenter', category: 'buildings', collider: fixed(4.0) },
  // From references/alchemist-massing.md: stone block with a cross-gable and
  // a still against the front wall. Shelves, bench and barrels sit outside.
  { id: 'bld-alchemist', label: 'Alchemist', category: 'buildings', collider: fixed(4.5) },
  // From references/jeweler-massing.md: ashlar block under a low hipped roof.
  { id: 'bld-jeweler', label: 'Jeweller', category: 'buildings', collider: fixed(4.4) },
  // From references/church-massing.md. Inscribed radius like the guild hall:
  // a circle covering a 12 m nave's corners would block open air at its sides.
  { id: 'bld-church', label: 'Church', category: 'buildings', collider: fixed(6.2) },
  // From references/bakery-massing.md (LOW-quality source — a thumbnail icon).
  { id: 'bld-bakery', label: 'Bakery', category: 'buildings', collider: fixed(4.4) },
  // From references/cooking-massing.md.
  { id: 'bld-cooking', label: 'Cooking House', category: 'buildings', collider: fixed(4.3) },
  // From references/tannery-massing.md: open-fronted shed, so the collider
  // covers the roofed footprint; the hide frame and vat stand outside it.
  { id: 'bld-tannery', label: 'Tannery', category: 'buildings', collider: fixed(4.4) },

  // --- District decor (src/generators/environment/townDecor.js): the props
  // that give the market / crafting / training / mage quarters and the park
  // their identity. All merged via meshKit, so 2-5 draw calls each. ---
  { id: 'bench', label: 'Bench', category: 'outdoors-decor', collider: fixed(0.9) },
  { id: 'fountain', label: 'Fountain', category: 'outdoors-decor', collider: fixed(2.9) },
  { id: 'potted-tree', label: 'Potted Tree', category: 'outdoors-decor', collider: fixed(0.7) },
  { id: 'fence-section', label: 'Fence Section', category: 'outdoors-decor', collider: fixed(1.6) },
  { id: 'signpost', label: 'Signpost', category: 'outdoors-decor', collider: fixed(0.3) },
  { id: 'training-dummy', label: 'Training Dummy', category: 'outdoors-decor', collider: fixed(0.5) },
  { id: 'weapon-rack', label: 'Weapon Rack', category: 'outdoors-decor', collider: fixed(1.1) },
  { id: 'archery-target', label: 'Archery Target', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'hay-bales', label: 'Hay Bales', category: 'outdoors-decor', collider: fixed(1.1) },
  { id: 'arcane-obelisk', label: 'Arcane Obelisk', category: 'outdoors-decor', collider: fixed(0.9) },
  { id: 'arcane-brazier', label: 'Arcane Brazier', category: 'outdoors-decor', collider: fixed(0.5) },
  { id: 'scroll-rack', label: 'Scroll Rack', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'woodpile', label: 'Woodpile', category: 'outdoors-decor', collider: fixed(1.0) },
  { id: 'handcart', label: 'Handcart', category: 'outdoors-decor', collider: fixed(1.1) },
  { id: 'street-canopy', label: 'Street Canopy', category: 'outdoors-decor', collider: fixed(1.8) },
  { id: 'notice-board', label: 'Notice Board', category: 'outdoors-decor', collider: fixed(1.2) },

  // --- Town dressing (src/generators/environment/townLife.js), built from the
  // reference sheets 2026-07-31: garden beds, statues, a pergola, carts,
  // outdoor furniture, laundry, a dovecote and roadside stone. Same
  // outdoors-decor tab as the rest of the street furniture, since that is where
  // an author looks when dressing a square.
  //
  // `pergola` and `laundry-line` have NO collider on purpose: both are things
  // you walk UNDER, and a circle round either would block the open span that is
  // the entire point of them.
  { id: 'flowerbed-round', label: 'Flowerbed — Round', category: 'outdoors-decor', collider: fixed(1.3) },
  { id: 'flowerbed-square', label: 'Flowerbed — Square', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'flowerbed-long', label: 'Flowerbed — Long', category: 'outdoors-decor', collider: fixed(1.6) },
  // Same three beds, bare soil. Identical footprints, so an author can swap a
  // planted bed for an empty one in place without re-fitting anything round it.
  { id: 'flowerbed-round-empty', label: 'Flowerbed — Round (Empty)', category: 'outdoors-decor', collider: fixed(1.3) },
  { id: 'flowerbed-square-empty', label: 'Flowerbed — Square (Empty)', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'flowerbed-long-empty', label: 'Flowerbed — Long (Empty)', category: 'outdoors-decor', collider: fixed(1.6) },
  { id: 'hedge', label: 'Hedge', category: 'outdoors-decor', collider: fixed(1.2) },
  { id: 'statue-knight', label: 'Statue — Knight', category: 'outdoors-decor', collider: fixed(0.85) },
  { id: 'statue-dragon', label: 'Statue — Dragon', category: 'outdoors-decor', collider: fixed(0.95) },
  { id: 'fountain-scalloped', label: 'Fountain — Scalloped', category: 'outdoors-decor', collider: fixed(2.7) },
  { id: 'pergola', label: 'Pergola', category: 'outdoors-decor', collider: null },
  { id: 'flower-cart', label: 'Flower Cart', category: 'outdoors-decor', collider: fixed(1.0) },
  { id: 'wagon', label: 'Wagon', category: 'outdoors-decor', collider: fixed(1.7) },
  { id: 'sacks', label: 'Sacks', category: 'outdoors-decor', collider: fixed(0.75) },
  { id: 'trestle-table', label: 'Trestle Table', category: 'outdoors-decor', collider: fixed(1.15) },
  { id: 'wooden-chair', label: 'Chair', category: 'outdoors-decor', collider: fixed(0.32) },
  { id: 'laundry-line', label: 'Laundry Line', category: 'outdoors-decor', collider: null },
  { id: 'produce-stall', label: 'Produce Stall', category: 'outdoors-decor', collider: fixed(1.6) },
  { id: 'dovecote', label: 'Dovecote', category: 'outdoors-decor', collider: fixed(0.45) },
  { id: 'stone-fence', label: 'Stone Fence', category: 'outdoors-decor', collider: fixed(1.35) },
  // The pierless run, for the middle of a long boundary. Same 1.35 circle: a
  // circle round a 2.6 m wall over-blocks either way, and matching the piered
  // piece is what lets a mixed row of the two block a continuous line.
  { id: 'stone-fence-wall', label: 'Stone Fence — Wall Only', category: 'outdoors-decor', collider: fixed(1.35) },
  { id: 'wayshrine', label: 'Wayshrine', category: 'outdoors-decor', collider: fixed(0.65) },
  { id: 'gravestones', label: 'Gravestones', category: 'outdoors-decor', collider: fixed(1.0) },
  // Walked ON, not into — same deal as the pier pieces above, and for the same
  // reason. `buried` because its piers run below y=0.
  { id: 'bridge-stone', buried: BURIED, label: 'Stone Footbridge', category: 'outdoors-decor', collider: null, walkable: { kind: 'deck', width: 3.4, depth: 5.4, top: 0.5 } },
  // The bridge's approach ramp. Rises along local +Z, so its HIGH end is the
  // +Z end — butt that against the bridge. See generateStoneBridgeRamp.
  { id: 'bridge-stone-ramp', buried: BURIED, label: 'Stone Footbridge Ramp', category: 'outdoors-decor', collider: null, walkable: { kind: 'ramp', width: 3.4, depth: 2.6, low: 0.0, high: 0.5 } },

  // --- Countryside (src/generators/environment/countryside.js): the farms,
  // fields, fishing pier and mining camp outside the walls.
  //
  // The PIER pieces have a null collider on purpose — a collider would block
  // the very thing the pier exists for. They instead declare a `walkable`
  // deck (src/sim/platforms.js): the player stands ON the boards at
  // PIER_DECK_Y rather than walking through them at ground level, which is
  // what they used to do. `walkable.width`/`depth`/`top` must match the deck
  // the generator in countryside.js actually builds (W/L/PIER_DECK_Y) —
  // what you see is what you stand on. Reaching the deck needs the
  // `pier-stairs` piece or a jump; it is deliberately higher than
  // PLATFORM_STEP_UP. ---
  { id: 'windmill', label: "Windmill", category: 'countryside', collider: fixed(4.6) },
  { id: 'cabin-log', label: "Hunter's Cabin", category: 'countryside', collider: fixed(5.0) },
  { id: 'barn', label: "Barn", category: 'countryside', collider: fixed(7.5) },
  { id: 'granary', label: "Granary", category: 'countryside', collider: fixed(2.2) },
  { id: 'crop-wheat', label: "Crop Field — Wheat", category: 'countryside', collider: null },
  { id: 'crop-cabbage', label: "Crop Field — Cabbage", category: 'countryside', collider: null },
  { id: 'crop-pumpkin', label: "Crop Field — Pumpkin", category: 'countryside', collider: null },
  { id: 'scarecrow', label: "Scarecrow", category: 'countryside', collider: fixed(0.55) },
  { id: 'chicken-coop', label: "Chicken Coop", category: 'countryside', collider: fixed(1.5) },
  { id: 'plough', label: "Plough", category: 'countryside', collider: fixed(0.9) },
  { id: 'beehive', label: "Beehive", category: 'countryside', collider: fixed(0.55) },
  { id: 'water-trough', label: "Water Trough", category: 'countryside', collider: fixed(1.3) },
  { id: 'pier-section', buried: BURIED, label: "Pier Section", category: 'countryside', collider: null, walkable: { kind: 'deck', width: 3.0, depth: 4.0, top: 1.15 } },
  { id: 'pier-stairs', buried: BURIED, label: "Pier Steps", category: 'countryside', collider: null, walkable: { kind: 'ramp', width: 2.6, depth: 2.6, low: 0.0, high: 1.15 } },
  { id: 'pier-head', buried: BURIED, label: "Pier Head", category: 'countryside', collider: null, walkable: { kind: 'deck', width: 4.8, depth: 4.8, top: 1.15 } },
  { id: 'rowboat', label: "Rowboat", category: 'countryside', collider: fixed(1.15) },
  { id: 'fish-rack', label: "Fish Drying Rack", category: 'countryside', collider: fixed(1.6) },
  { id: 'mine-entrance', buried: BURIED, label: "Mine Entrance", category: 'countryside', collider: fixed(4.0) },
  { id: 'ore-cart', label: "Ore Cart", category: 'countryside', collider: fixed(1.0) },
  { id: 'mine-headframe', label: "Mine Headframe", category: 'countryside', collider: fixed(3.2) },

  // --- Cave & dungeon kit (src/generators/environment/caveKit.js +
  // caveDecor.js), built 2026-08-02 from references/cave-dungeon-massing.md.
  // A kit, not a set of one-off props: the walls, arches and floor tiles are
  // sized so they butt together (3 m wall module, 4 m and 2 m floor tiles).
  //
  // The two ARCHES and the mine support declare NO collider, for the same
  // reason `citywall-gate` doesn't: they exist to be walked through/under, and
  // a circle either seals the opening or blocks nothing. Fence their solid
  // parts with authored invisible wall segments (world.barriers).
  //
  // The floor tiles are `walkable` decks rather than colliders — you stand ON
  // a floor. Their `top` matches cobbleSlab's finished height exactly; change
  // one and change the other, or the player floats or sinks (check:props
  // enforces it).
  { id: 'cave-wall', label: 'Cave Wall', category: 'cave', collider: fixed(1.7) },
  { id: 'cave-wall-tall', label: 'Cave Wall — Tall', category: 'cave', collider: fixed(1.7) },
  { id: 'cave-wall-stepped', label: 'Cave Wall — Stepped', category: 'cave', collider: fixed(2.0) },
  { id: 'cave-wall-corner', label: 'Cave Wall — Corner', category: 'cave', collider: fixed(1.8) },
  { id: 'cave-wall-niche', label: 'Cave Wall — Niche', category: 'cave', collider: fixed(1.7) },
  { id: 'cave-arch', label: 'Cave Arch', category: 'cave', collider: null },
  { id: 'cave-arch-natural', label: 'Cave Arch — Natural', category: 'cave', collider: null },
  { id: 'cave-pier', label: 'Cave Pier', category: 'cave', collider: fixed(1.1) },
  { id: 'cave-rubble', label: 'Cave Rubble', category: 'cave', collider: fixed(1.0) },

  { id: 'cave-floor-tile', label: 'Cave Floor — 4m', category: 'cave', collider: null, walkable: { kind: 'deck', width: 4.0, depth: 4.0, top: 0.18 } },
  { id: 'cave-floor-small', label: 'Cave Floor — 2m', category: 'cave', collider: null, walkable: { kind: 'deck', width: 2.0, depth: 2.0, top: 0.18 } },
  { id: 'cave-floor-quad', label: 'Cave Floor — Quartered', category: 'cave', collider: null, walkable: { kind: 'deck', width: 4.0, depth: 4.0, top: 0.18 } },
  { id: 'cave-floor-broken', label: 'Cave Floor — Broken', category: 'cave', collider: null, walkable: { kind: 'deck', width: 3.4, depth: 3.4, top: 0.18 } },
  { id: 'cave-floor-stain', label: 'Cave Floor — Stained', category: 'cave', collider: null, walkable: { kind: 'deck', width: 3.4, depth: 3.4, top: 0.18 } },
  { id: 'cave-floor-round', label: 'Cave Floor — Round', category: 'cave', collider: null, walkable: { kind: 'deck', width: 3.8, depth: 3.8, top: 0.30 } },

  { id: 'cave-column', label: 'Cave Column', category: 'cave', collider: fixed(1.3) },
  { id: 'cave-spire', label: 'Cave Spire', category: 'cave', collider: fixed(0.8) },
  { id: 'cave-stalagmites', label: 'Stalagmites', category: 'cave', collider: fixed(0.9) },
  { id: 'cave-rock-arch', label: 'Cave Rock Arch', category: 'cave', collider: null },
  { id: 'cave-boulder', buried: BURIED, label: 'Cave Boulder', category: 'cave', collider: fixed(1.4) },
  { id: 'cave-ore-crystal', buried: BURIED, label: 'Crystal Ore Boulder', category: 'cave', collider: fixed(1.3) },

  // Ceiling/wall pieces — see MOUNTED above. EVERY one of these has its mount
  // plane at y = 0 and hangs below it, so the editor's Height field is read
  // directly as the ceiling height: 3.0 caps a `cave-wall`, 5.0 a
  // `cave-wall-tall`. The panels tile on the floors' own 4m / 2m module.
  { id: 'cave-ceiling-tile', mounted: CEILING, label: 'Cave Ceiling - 4m', category: 'cave', collider: null },
  { id: 'cave-ceiling-small', mounted: CEILING, label: 'Cave Ceiling - 2m', category: 'cave', collider: null },
  { id: 'cave-ceiling-rough', mounted: CEILING, label: 'Cave Ceiling - Rough', category: 'cave', collider: null },
  { id: 'cave-ceiling-fringe', mounted: CEILING, label: 'Cave Ceiling - Fringed Edge', category: 'cave', collider: null },
  { id: 'cave-ceiling-corner', mounted: CEILING, label: 'Cave Ceiling - Fringed Corner', category: 'cave', collider: null },
  { id: 'cave-stalactites', mounted: CEILING, label: 'Stalactites', category: 'cave', collider: null },
  { id: 'cave-ceiling-slab', mounted: CEILING, label: 'Cave Ceiling Boss', category: 'cave', collider: null },
  { id: 'cave-torch', mounted: WALL, label: 'Wall Torch', category: 'cave', collider: null },
  { id: 'cave-lantern', mounted: CEILING, label: 'Hanging Lantern', category: 'cave', collider: null },

  { id: 'cave-brazier', label: 'Brazier', category: 'cave', collider: fixed(0.5) },
  { id: 'cave-brazier-arcane', label: 'Brazier — Arcane', category: 'cave', collider: fixed(0.5) },
  { id: 'cave-candles', label: 'Candles', category: 'cave', collider: null },
  { id: 'cave-crystal-blue', label: 'Cave Crystal — Blue', category: 'cave', collider: fixed(0.5) },
  { id: 'cave-crystal-violet', label: 'Cave Crystal — Violet', category: 'cave', collider: fixed(0.5) },
  { id: 'cave-pool-water', label: 'Glowing Pool', category: 'cave', collider: null },
  { id: 'cave-pool-acid', label: 'Acid Pool', category: 'cave', collider: null },
  { id: 'cave-mine-support', label: 'Mine Support', category: 'cave', collider: null },
  { id: 'cave-gate-bars', label: 'Barred Gate', category: 'cave', collider: fixed(1.7) },
  { id: 'cave-walkway', buried: BURIED, label: 'Plank Walkway', category: 'cave', collider: null, walkable: { kind: 'deck', width: 1.6, depth: 3.2, top: 0.22 } },

  // --- Walls & defenses (src/generators/environment/cityWall.js). The curtain
  // wall itself is NOT here — a wall run is `world.walls[]`, authored in the
  // editor's Wall mode, and gets its collider from its own length/thickness.
  // These are the pieces that punctuate it.
  //
  // `citywall-gate` deliberately declares NO collider: it is 17 m of gatehouse
  // with a walkable passage down the middle, and the only collider shape this
  // catalog has is a circle, which would either seal the archway or fit inside
  // it and block nothing. Its solid parts are fenced with authored INVISIBLE
  // wall segments instead — the same pattern the Great Tower's own gate piers
  // already use (see `tower-gate-pier-l`/`-r` in the Asteria map).
  //
  // `citywall-segment` is the straight wall run AS A PLACEABLE PROP. The
  // category was missing the one thing it is named after: a wall. Wall mode's
  // world.walls[] is still the right tool for a whole city ring (it's
  // parametric on length, so a ring is a handful of entries rather than a
  // hundred props), but it can only draw a run between two ground points —
  // there was no way to drop a single 8 m stretch of wall as a piece of set
  // dressing, back a courtyard, or fill a gap left by a gatehouse. This is
  // that piece, built by the same generateWallSegment() the ring uses, as an
  // 8 x 4.5 x 1.2 m module you butt end to end.
  //
  // Its collider is the catalog's only shape — a circle — over a long thin
  // box, so it is an APPROXIMATION and knowingly so: r = 2.4 blocks the
  // middle ~5.5 m of the 8 m run and bulges ~1.8 m past each face. That is
  // the same trade `stone-fence` and `barricade` already ship, and the
  // alternative (shrinking the piece until a circle fits it) produced
  // something that rendered as a squat tower rather than a wall. For a run
  // the player has to walk right up against, fence it with authored
  // `world.barriers` segments the way `citywall-gate` does, or draw it in
  // Wall mode, which gets a real oriented-box collider from its own length.
  { id: 'citywall-segment', label: 'Wall Segment', category: 'defenses', collider: fixed(2.4) },
  { id: 'citywall-tower', label: 'Wall Tower', category: 'defenses', collider: fixed(3.4) },
  { id: 'citywall-watchtower', label: 'Archer Tower', category: 'defenses', collider: fixed(2.5) },
  { id: 'citywall-gate', label: 'City Gatehouse', category: 'defenses', collider: null },
  { id: 'barricade', label: 'Barricade', category: 'defenses', collider: fixed(1.1) },
  { id: 'spikes', label: 'Spike Row', category: 'defenses', collider: fixed(1.0) },
  { id: 'guard-post', label: 'Guard Post', category: 'defenses', collider: fixed(1.2) },

  // --- Landmarks. The Great Tower is the city's centrepiece and the future
  // Tower-dungeon entrance; its collider covers the whole 24m plinth so
  // players walk around it and enter through an authored teleporter. ---
  { id: 'tower-great', label: 'Great Tower', category: 'buildings', collider: fixed(21) },

  // --- Garden & park (src/generators/environment/gardenDecor.js).
  { id: 'garden-sundial', label: 'Sundial', category: 'garden', collider: fixed(0.45) },
  { id: 'garden-birdbath', label: 'Birdbath', category: 'garden', collider: fixed(0.50) },
  { id: 'garden-trellis', label: 'Garden Trellis', category: 'garden', collider: fixed(0.65) },
  { id: 'garden-topiary', label: 'Topiary', category: 'garden', collider: fixed(0.40) },
  { id: 'garden-gazebo', label: 'Stone Gazebo', category: 'garden', collider: fixed(1.8) },

  // --- Ruins & ancient (src/generators/environment/ruinsDecor.js).
  { id: 'ruins-broken-pillar', label: 'Broken Pillar', category: 'ruins', collider: fixed(0.55) },
  { id: 'ruins-arch', label: 'Crumbled Arch', category: 'ruins', collider: fixed(2.0) },
  { id: 'ruins-altar', label: 'Ancient Altar', category: 'ruins', collider: fixed(1.0) },
  { id: 'ruins-statue', label: 'Overgrown Statue', category: 'ruins', collider: fixed(0.65) },
  { id: 'ruins-tomb', label: 'Mossy Tomb', category: 'ruins', collider: fixed(1.4) },

  // --- Arcane & magic (src/generators/environment/arcaneDecor.js).
  { id: 'arcane-summoning-circle', label: 'Summoning Circle', category: 'arcane', collider: fixed(2.5) },
  { id: 'arcane-floating-runes', label: 'Floating Runes', category: 'arcane', collider: fixed(0.8) },
  { id: 'arcane-crystal-ball', label: 'Crystal Ball', category: 'arcane', collider: fixed(0.35) },
  { id: 'arcane-potion-shelf', mounted: 'wall', label: 'Potion Shelf', category: 'arcane', collider: fixed(0.9) },
  { id: 'arcane-spell-podium', label: 'Spell Podium', category: 'arcane', collider: fixed(0.45) },

  // --- Rural & domestic (src/generators/environment/ruralDecor.js).
  // Filed under countryside alongside scarecrow, beehive, water-trough etc.
  { id: 'rural-butter-churn', label: 'Butter Churn', category: 'countryside', collider: fixed(0.25) },
  { id: 'rural-spit-roast', label: 'Spit Roast', category: 'countryside', collider: fixed(0.55) },
  { id: 'rural-rain-barrel', label: 'Rain Barrel', category: 'countryside', collider: fixed(0.45) },
  { id: 'rural-chopping-block', label: 'Chopping Block', category: 'countryside', collider: fixed(0.45) },
  { id: 'rural-grain-sacks', label: 'Grain Sacks', category: 'countryside', collider: fixed(0.70) },
  { id: 'rural-cider-press', label: 'Cider Press', category: 'countryside', collider: fixed(0.80) },

  // 'custom' and 'model' are sentinel rows, never shown in the palette grid
  // directly (see sceneryPalette.js's renderGrid, which skips these two ids
  // and injects real entries via extraItems instead, each carrying its own
  // category). Their own `category` here is unused for display — kept as
  // 'misc' just so getPropType() always resolves for collision lookups.
  { id: 'custom', label: 'Custom Object', category: 'misc', collider: { kind: 'custom' } },
  // An imported model — FBX or GLB (CLAUDE.md/roadmap item #11). Footprint is a
  // measured number on the model catalog entry, not derivable here — see
  // src/sim/models.js and collision.js's 'model' collider kind.
  { id: 'model', label: 'Imported Model', category: 'misc', collider: { kind: 'model' } },
];

let BY_ID = Object.fromEntries(PROP_TYPES.map((p) => [p.id, p]));

/** @param {string} id @returns {PropTypeDef|null} */
export function getPropType(id) {
  return BY_ID[id] || null;
}

/**
 * The height a newly placed prop should start at, before the author adjusts it.
 *
 * Zero for everything that stands on the floor. A `mounted` piece's mount plane
 * is y = 0 with the prop hanging BELOW it (ceiling) or straddling it (wall), so
 * dropping one in at y = 0 buries it: a hanging lantern placed from the palette
 * was entirely underground and looked like it had failed to spawn. These start
 * at a plausible ceiling/eye height instead, which the Height field then tunes.
 */
export function defaultPlaceY(typeId) {
  const def = getPropType(typeId);
  if (!def || !def.mounted) return 0;
  return def.mounted === 'ceiling' ? 4 : 2.2;
}

/** Every prop type in a category, in catalog order. */
export function propTypesIn(category) {
  return PROP_TYPES.filter((p) => p.category === category);
}

// `PROP_TYPE_IDS` used to be a snapshot array computed once at module load.
// Plugins register after that point, so it's now a getter — same shape
// (`import { PROP_TYPE_IDS }` still works), always current.
export const PROP_TYPE_IDS = new Proxy([], {
  get(_t, prop) {
    const arr = PROP_TYPES.map((p) => p.id);
    return typeof arr[prop] === 'function' ? arr[prop].bind(arr) : arr[prop];
  },
});

/**
 * Register a plugin-authored prop type at runtime (called by
 * src/generators/pluginLoader.js after it dynamically imports a file from
 * environment/plugins/). Always walk-through (collider: null) — a plugin
 * that needs real collision gets a manual `fixed(radius)` row above instead.
 * A duplicate id (re-registering after a hot reload) replaces in place
 * rather than growing the catalog.
 * @param {{id: string, label: string, category: string}} def
 */
export function registerPluginType(def) {
  const row = { id: def.id, label: def.label, category: def.category, collider: null, plugin: true };
  const existingIndex = PROP_TYPES.findIndex((p) => p.id === def.id);
  if (existingIndex >= 0) PROP_TYPES[existingIndex] = row;
  else PROP_TYPES.push(row);
  BY_ID = Object.fromEntries(PROP_TYPES.map((p) => [p.id, p]));
}

/**
 * Which seeded generator a tree-ish type maps onto, and with what forced shape.
 * Kept here (not in the generator) so `sampleTree` can be asked for the right
 * silhouette from sim, where collision is computed.
 * @param {string} id
 * @returns {'conifer'|'round'|'random'|null}
 */
export function treeSilhouette(id) {
  switch (id) {
    case 'tree': return 'random';
    case 'tree-pine': return 'conifer';
    case 'tree-oak': return 'round';
    case 'tree-birch': return 'round';
    case 'tree-willow': return 'round';
    case 'tree-dead': return 'conifer'; // bare trunk; silhouette only matters for the seeded trunk radius
    // Biome trees all build fully custom canopies and never read sampleTree's
    // tiers/clumps — the forced type here only has to match what each
    // generator itself passes to sampleTree, so trunkRadius stays in sync.
    case 'tree-palm': return 'conifer';
    case 'cactus-saguaro': return 'conifer';
    case 'tree-cypress': return 'conifer';
    case 'tree-pine-snow': return 'conifer';
    case 'tree-alpine': return 'conifer';
    default: return null;
  }
}
