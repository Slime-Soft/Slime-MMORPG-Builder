// src/generators/props.js
// One place that turns a prop type id into a mesh. The catalog's METADATA
// (category, label, collider) lives in src/sim/propTypes.js — sim needs it to
// answer collision questions without ever loading Three. This file holds the
// other half: the builders.
//
// The two are keyed by the same id, and `npm run check:props` fails if either
// grows an id the other lacks. That guard is the whole reason it's safe to
// split them.
import { generateTree } from './environment/tree.js';
import { generateRock, generateOreDeposit } from './environment/rock.js';
import { generateGrassPatch, generateFlower, generateFlowerPatch } from './environment/grass.js';
import { generateCustomObject } from './custom.js';
import { buildModelPlaceholder } from './modelLoader.js';
import {
  generateDeadTree, generateWillow, generateBush,
  generateFern, generateReeds, generateMushroom, generateMushroomCluster,
  generateDaisies, generateBluebells, generateStump, generateLog, generateBranch, generateRunestone,
  generatePalm, generateCactusSaguaro, generateCypress, generatePineSnow, generateAlpineConifer,
  generateDesertFlower, generateSwampFlower, generateSnowdrop, generateAlpineFlower,
} from './environment/flora.js';
import {
  generateBoulder, generateSharpRock, generateRockCluster, generatePebbles, generateCrystal,
  generateSandstoneRock, generateMossyRock, generateSnowyRock, generateMountainRock,
  generateCrystalRose, generateCrystalEmerald, generateCrystalFrost, generateCrystalAmethyst,
} from './environment/stones.js';
import {
  generateStationAnvil, generateStationWorkbench, generateStationLoom,
  generateStationJewelersBench, generateStationAlchemyLab, generateStationCampfire,
} from './environment/craftingStations.js';
import {
  generateWorkstationForge, generateWorkstationCarpenter, generateWorkstationTapestryLoom,
  generateWorkstationFloorLoom, generateWorkstationTanningRack, generateWorkstationJeweler,
  generateWorkstationAlchemy, generateWorkstationHearth,
} from './environment/workstations.js';
import { generateGreatTower } from './environment/greatTower.js';
import { mergeStaticMeshes } from './environment/meshKit.js';
import {
  generateHouseNarrow, generateHouseWide, generateHouseTall, generateHouseSmall,
  generateHouseCorner, generateHouseSteep, generateHouseSquat, generateHouseGabled,
  generateTavern, generateInn, generateStore, generateWorkshop, generateGuildHall,
} from './environment/townhouse.js';
import {
  generateBench, generateFountain, generatePottedTree, generateFenceSection, generateSignpost, generateTrainingDummy, generateWeaponRack, generateArcheryTarget, generateHayBales, generateArcaneObelisk, generateArcaneBrazier, generateScrollRack, generateWoodpile, generateHandcart, generateStreetCanopy, generateNoticeBoard,
} from './environment/townDecor.js';
import {
  generateWindmill, generateHunterCabin, generateBarn, generateGranary, generateCropWheat, generateCropCabbage, generateCropPumpkin, generateScarecrow, generateChickenCoop, generatePlough, generateBeehive, generateWaterTrough, generatePierSection, generatePierStairs, generatePierHead, generateRowboat, generateFishRack, generateMineEntrance, generateOreCart, generateMineHeadframe,
} from './environment/countryside.js';
import {
  generateMarketStall, generateStreetLantern, generateBarrel, generateBarrelStack,
  generateCrate, generateCrateStack, generateFlowerPlanter, generateTownWell,
  generateShopSign, generateBannerPole,
} from './environment/townProps.js';
import {
  generateFlowerbedRound, generateFlowerbedSquare, generateFlowerbedLong, generateHedge,
  generateStatueKnight, generateStatueDragon, generateFountainScalloped, generatePergola,
  generateFlowerCart, generateWagon, generateSacks, generateTrestleTable, generateWoodenChair,
  generateLaundryLine, generateProduceStall, generateDovecote,
  generateStoneFence, generateStoneFenceWall, generateStoneBridge, generateStoneBridgeRamp, generateWayshrine, generateGravestones,
  generateBarricade, generateSpikes, generateGuardPost,
} from './environment/townLife.js';
import {
  generateWallSegment, generateCityWallTower, generateWatchTower, generateCityGate,
} from './environment/cityWall.js';
import {
  generateCaveWall, generateCaveWallTall, generateCaveWallStepped, generateCaveWallCorner,
  generateCaveWallNiche, generateCaveArch, generateCaveArchNatural, generateCavePier,
  generateCaveRubble, generateCaveFloorTile, generateCaveFloorSmall, generateCaveFloorQuad,
  generateCaveFloorBroken, generateCaveFloorStain, generateCaveFloorRound, generateCaveColumn,
  generateCaveSpire, generateCaveStalagmites, generateCaveStalactites, generateCaveCeilingSlab,
  generateCaveRockArch, generateCaveBoulder,
  generateCaveCeilingTile, generateCaveCeilingSmall, generateCaveCeilingRough,
  generateCaveCeilingFringe, generateCaveCeilingCorner,
} from './environment/caveKit.js';
import {
  generateCaveTorch, generateCaveLantern, generateCaveBrazier, generateCaveBrazierArcane,
  generateCaveCrystalBlue, generateCaveCrystalViolet, generateCaveCandles, generateCaveOreCrystal,
  generateCavePoolWater, generateCavePoolAcid, generateCaveMineSupport, generateCaveGateBars,
  generateCaveWalkway,
} from './environment/caveDecor.js';
import { generateBlacksmith, generateTailor, generateCarpenter, generateAlchemist, generateJeweler, generateChurch, generateBakery, generateCookingHouse, generateTannery } from './environment/tradeBuildings.js';
import {
  generateSundial, generateBirdbath, generateGardenTrellis, generateTopiary, generateStoneGazebo,
} from './environment/gardenDecor.js';
import {
  generateBrokenPillar, generateCrumbledArch, generateAncientAltar, generateOvergrownStatue, generateMossyTomb,
} from './environment/ruinsDecor.js';
import {
  generateSummoningCircle, generateFloatingRunes, generateCrystalBallStand, generatePotionShelf, generateSpellPodium,
} from './environment/arcaneDecor.js';
import {
  generateButterChurn, generateSpitRoast, generateRainBarrel, generateChoppingBlock, generateGrainSackStack, generateCiderPress,
} from './environment/ruralDecor.js';
// The other trade shops and the church built on 2026-08-01 were withdrawn the same day —
// see the WITHDRAWN note in src/sim/propTypes.js for why. Their generators
// still live in ./environment/tradeBuildings.js; they are re-imported and
// re-listed in BUILDERS one at a time, as each is rebuilt from its reference.

/**
 * id -> (seed, options) => THREE.Object3D standing on y=0.
 * `custom` is the odd one out: it needs the authored object definition, not a seed.
 */
const BUILDERS = {
  // (seed, options) — options.leafDensity comes from world.treeSettings
  // (see buildPropPlaceholder in render/scene.js), a world-wide multiplier
  // on ez-tree's round-canopy branch/leaf counts. Only 'round'-type trees
  // read it; 'tree-pine' (conifer, hand-rolled cone tiers) ignores it.
  tree: (seed, options) => generateTree(seed, { leafDensity: options?.leafDensity }),
  'tree-pine': (seed) => generateTree(seed, { type: 'conifer' }),
  'tree-oak': (seed, options) => generateTree(seed, { type: 'round', leafDensity: options?.leafDensity }),
  // Same generator as 'tree-oak' — both are the ez-tree-based birch-styled
  // round canopy now (see ezTree.js); a dedicated low-poly placeholder
  // used to live here (generateBirch, flora.js), which is why clicking
  // "Birch" in the palette used to show old, unrelated geometry while
  // "Oak"/"Tree" showed the real work. Removed to close that gap.
  'tree-birch': (seed, options) => generateTree(seed, { type: 'round', leafDensity: options?.leafDensity }),
  'tree-dead': generateDeadTree,
  'tree-willow': generateWillow,
  bush: generateBush,
  'tree-palm': generatePalm,
  'cactus-saguaro': generateCactusSaguaro,
  'tree-cypress': generateCypress,
  'tree-pine-snow': generatePineSnow,
  'tree-alpine': generateAlpineConifer,

  grass: (seed) => generateGrassPatch(seed),
  'grass-meadow': (seed) => generateGrassPatch(seed, { bladeCount: 70, radius: 1.0 }),
  fern: generateFern,
  reeds: generateReeds,
  flower: (seed) => generateFlower(seed),
  'flower-daisy': generateDaisies,
  'flower-bell': generateBluebells,
  'flower-meadow': (seed) => generateFlowerPatch(seed, { count: 16, radius: 1.0 }),
  mushroom: generateMushroom,
  'mushroom-cluster': generateMushroomCluster,
  'flower-desert': generateDesertFlower,
  'flower-swamp': generateSwampFlower,
  'flower-snowdrop': generateSnowdrop,
  'flower-alpine': generateAlpineFlower,

  rock: (seed) => generateRock(seed),
  boulder: generateBoulder,
  'rock-sharp': generateSharpRock,
  'rock-cluster': generateRockCluster,
  pebbles: generatePebbles,
  ore: (seed) => generateOreDeposit(seed),
  crystal: generateCrystal,
  'rock-sandstone': generateSandstoneRock,
  'rock-mossy': generateMossyRock,
  'rock-snowy': generateSnowyRock,
  'rock-mountain': generateMountainRock,
  'crystal-rose': generateCrystalRose,
  'crystal-emerald': generateCrystalEmerald,
  'crystal-frost': generateCrystalFrost,
  'crystal-amethyst': generateCrystalAmethyst,

  stump: generateStump,
  log: generateLog,
  branch: generateBranch,
  runestone: generateRunestone,

  'station-anvil': generateStationAnvil,
  'station-workbench': generateStationWorkbench,
  'station-loom': generateStationLoom,
  'station-jewelers-bench': generateStationJewelersBench,
  'station-alchemy-lab': generateStationAlchemyLab,
  'station-campfire': generateStationCampfire,

  'workstation-forge': generateWorkstationForge,
  'workstation-carpenter': generateWorkstationCarpenter,
  'workstation-tapestry-loom': generateWorkstationTapestryLoom,
  'workstation-floor-loom': generateWorkstationFloorLoom,
  'workstation-tanning-rack': generateWorkstationTanningRack,
  'workstation-jeweler': generateWorkstationJeweler,
  'workstation-alchemy': generateWorkstationAlchemy,
  'workstation-hearth': generateWorkstationHearth,

  'tower-great': generateGreatTower,

  'house-narrow': generateHouseNarrow,
  'house-wide': generateHouseWide,
  'house-tall': generateHouseTall,
  'house-small': generateHouseSmall,
  'house-corner': generateHouseCorner,
  'house-steep': generateHouseSteep,
  'house-squat': generateHouseSquat,
  'house-gabled': generateHouseGabled,
  'bld-tavern': generateTavern,
  'bld-inn': generateInn,
  'bld-store': generateStore,
  'bld-workshop': generateWorkshop,
  'bld-guild-hall': generateGuildHall,
  'bld-blacksmith': generateBlacksmith,
  'bld-tailor': generateTailor,
  'bld-carpenter': generateCarpenter,
  'bld-alchemist': generateAlchemist,
  'bld-jeweler': generateJeweler,
  'bld-church': generateChurch,
  'bld-bakery': generateBakery,
  'bld-cooking': generateCookingHouse,
  'bld-tannery': generateTannery,

  'bench': generateBench,
  'fountain': generateFountain,
  'potted-tree': generatePottedTree,
  'fence-section': generateFenceSection,
  'signpost': generateSignpost,
  'training-dummy': generateTrainingDummy,
  'weapon-rack': generateWeaponRack,
  'archery-target': generateArcheryTarget,
  'hay-bales': generateHayBales,
  'arcane-obelisk': generateArcaneObelisk,
  'arcane-brazier': generateArcaneBrazier,
  'scroll-rack': generateScrollRack,
  'woodpile': generateWoodpile,
  'handcart': generateHandcart,
  'street-canopy': generateStreetCanopy,
  'notice-board': generateNoticeBoard,

  'windmill': generateWindmill,
  'cabin-log': generateHunterCabin,
  'barn': generateBarn,
  'granary': generateGranary,
  'crop-wheat': generateCropWheat,
  'crop-cabbage': generateCropCabbage,
  'crop-pumpkin': generateCropPumpkin,
  'scarecrow': generateScarecrow,
  'chicken-coop': generateChickenCoop,
  'plough': generatePlough,
  'beehive': generateBeehive,
  'water-trough': generateWaterTrough,
  'pier-section': generatePierSection,
  'pier-stairs': generatePierStairs,
  'pier-head': generatePierHead,
  'rowboat': generateRowboat,
  'fish-rack': generateFishRack,
  'mine-entrance': generateMineEntrance,
  'ore-cart': generateOreCart,
  'mine-headframe': generateMineHeadframe,

  'market-stall': generateMarketStall,
  'street-lantern': generateStreetLantern,
  barrel: generateBarrel,
  'barrel-stack': generateBarrelStack,
  crate: generateCrate,
  'crate-stack': generateCrateStack,
  'flower-planter': generateFlowerPlanter,
  'town-well': generateTownWell,
  'shop-sign': generateShopSign,
  'banner-pole': generateBannerPole,

  'flowerbed-round': generateFlowerbedRound,
  'flowerbed-square': generateFlowerbedSquare,
  'flowerbed-long': generateFlowerbedLong,
  // Bare-soil versions of the three beds above — dress them yourself with
  // separate `flower-*` props, or leave them turned and empty.
  'flowerbed-round-empty': (seed) => generateFlowerbedRound(seed, { planted: false }),
  'flowerbed-square-empty': (seed) => generateFlowerbedSquare(seed, { planted: false }),
  'flowerbed-long-empty': (seed) => generateFlowerbedLong(seed, { planted: false }),
  hedge: generateHedge,
  'statue-knight': generateStatueKnight,
  'statue-dragon': generateStatueDragon,
  'fountain-scalloped': generateFountainScalloped,
  pergola: generatePergola,
  'flower-cart': generateFlowerCart,
  wagon: generateWagon,
  sacks: generateSacks,
  'trestle-table': generateTrestleTable,
  'wooden-chair': generateWoodenChair,
  'laundry-line': generateLaundryLine,
  'produce-stall': generateProduceStall,
  dovecote: generateDovecote,
  'stone-fence': generateStoneFence,
  'stone-fence-wall': generateStoneFenceWall,
  'bridge-stone': generateStoneBridge,
  'bridge-stone-ramp': generateStoneBridgeRamp,
  wayshrine: generateWayshrine,
  gravestones: generateGravestones,

  // Cave & dungeon kit — references/cave-dungeon-massing.md.
  'cave-wall': generateCaveWall,
  'cave-wall-tall': generateCaveWallTall,
  'cave-wall-stepped': generateCaveWallStepped,
  'cave-wall-corner': generateCaveWallCorner,
  'cave-wall-niche': generateCaveWallNiche,
  'cave-arch': generateCaveArch,
  'cave-arch-natural': generateCaveArchNatural,
  'cave-pier': generateCavePier,
  'cave-rubble': generateCaveRubble,
  'cave-floor-tile': generateCaveFloorTile,
  'cave-floor-small': generateCaveFloorSmall,
  'cave-floor-quad': generateCaveFloorQuad,
  'cave-floor-broken': generateCaveFloorBroken,
  'cave-floor-stain': generateCaveFloorStain,
  'cave-floor-round': generateCaveFloorRound,
  'cave-column': generateCaveColumn,
  'cave-spire': generateCaveSpire,
  'cave-stalagmites': generateCaveStalagmites,
  'cave-ceiling-tile': generateCaveCeilingTile,
  'cave-ceiling-small': generateCaveCeilingSmall,
  'cave-ceiling-rough': generateCaveCeilingRough,
  'cave-ceiling-fringe': generateCaveCeilingFringe,
  'cave-ceiling-corner': generateCaveCeilingCorner,
  'cave-stalactites': generateCaveStalactites,
  'cave-ceiling-slab': generateCaveCeilingSlab,
  'cave-rock-arch': generateCaveRockArch,
  'cave-boulder': generateCaveBoulder,
  'cave-ore-crystal': generateCaveOreCrystal,
  'cave-torch': generateCaveTorch,
  'cave-lantern': generateCaveLantern,
  'cave-brazier': generateCaveBrazier,
  'cave-brazier-arcane': generateCaveBrazierArcane,
  'cave-candles': generateCaveCandles,
  'cave-crystal-blue': generateCaveCrystalBlue,
  'cave-crystal-violet': generateCaveCrystalViolet,
  'cave-pool-water': generateCavePoolWater,
  'cave-pool-acid': generateCavePoolAcid,
  'cave-mine-support': generateCaveMineSupport,
  'cave-gate-bars': generateCaveGateBars,
  'cave-walkway': generateCaveWalkway,

  // A fixed-size module of the very same curtain wall the ring is drawn from.
  // The ring passes its own length/height/thickness from world.walls[]; a
  // placed prop has nowhere to author those, so the module dimensions are
  // pinned here.
  //
  // 8 x 4.5, i.e. clearly WIDER THAN TALL. A first pass used 4 x 6 to suit
  // the circular collider, and it rendered as a squat tower with battlements
  // — the one thing a wall segment must not look like. A wall is read from
  // its proportion before anything else, so the proportion wins and the
  // collider takes the approximation (see propTypes.js).
  'citywall-segment': (seed) => generateWallSegment(seed, { length: 8, height: 4.5, thickness: 1.2 }),
  'citywall-tower': generateCityWallTower,
  'citywall-watchtower': generateWatchTower,
  'citywall-gate': generateCityGate,
  barricade: generateBarricade,
  spikes: generateSpikes,
  'guard-post': generateGuardPost,

  // --- Garden & park (gardenDecor.js) ---
  'garden-sundial': generateSundial,
  'garden-birdbath': generateBirdbath,
  'garden-trellis': generateGardenTrellis,
  'garden-topiary': generateTopiary,
  'garden-gazebo': generateStoneGazebo,

  // --- Ruins & ancient (ruinsDecor.js) ---
  'ruins-broken-pillar': generateBrokenPillar,
  'ruins-arch': generateCrumbledArch,
  'ruins-altar': generateAncientAltar,
  'ruins-statue': generateOvergrownStatue,
  'ruins-tomb': generateMossyTomb,

  // --- Arcane & magic (arcaneDecor.js) ---
  'arcane-summoning-circle': generateSummoningCircle,
  'arcane-floating-runes': generateFloatingRunes,
  'arcane-crystal-ball': generateCrystalBallStand,
  'arcane-potion-shelf': generatePotionShelf,
  'arcane-spell-podium': generateSpellPodium,

  // --- Rural & domestic (ruralDecor.js) ---
  'rural-butter-churn': generateButterChurn,
  'rural-spit-roast': generateSpitRoast,
  'rural-rain-barrel': generateRainBarrel,
  'rural-chopping-block': generateChoppingBlock,
  'rural-grain-sacks': generateGrainSackStack,
  'rural-cider-press': generateCiderPress,
};

// Plugin builders (src/generators/environment/plugins/) register here at
// runtime via registerPluginBuilder, called by pluginLoader.js once per
// dynamically-imported file. Kept separate from BUILDERS so BUILDER_IDS below
// stays a live view — no snapshot to go stale.
const pluginBuilders = {};

/** @param {string} id @param {(seed:number)=>import('three').Object3D} build */
export function registerPluginBuilder(id, build) {
  pluginBuilders[id] = build;
}

export const BUILDER_IDS = new Proxy([], {
  get(_t, prop) {
    const arr = Object.keys(BUILDERS).concat(Object.keys(pluginBuilders), 'custom', 'model');
    return typeof arr[prop] === 'function' ? arr[prop].bind(arr) : arr[prop];
  },
});

/**
 * Build a prop's mesh.
 * @param {string} type prop type id (see src/sim/propTypes.js)
 * @param {number} seed
 * @param {{objectDef?: object}} [options] `objectDef` is required for type 'custom'
 * @returns {import('three').Object3D}
 */
export function buildProp(type, seed = 1, options = {}) {
  if (type === 'custom') {
    // Unknown/missing objectId falls through to a rock, same as before — the
    // renderer must always return *something* placeable.
    return options.objectDef ? generateCustomObject(options.objectDef.shapes) : generateRock(seed);
  }
  if (type === 'model') {
    // Async by nature (a model file has to be fetched+parsed) — returns a
    // placeholder immediately if the model hasn't finished loading yet. See
    // modelLoader.js's onModelLoadedEvent for how callers rebuild once it has.
    return buildModelPlaceholder(options.modelId);
  }
  const build = BUILDERS[type] || pluginBuilders[type];
  const built = build ? build(seed, options) : generateRock(seed); // fallback for an unrecognized type
  // One mesh per material instead of one per part. Most of this library
  // assembles loose meshes, which cost draw calls out of all proportion to
  // their triangles — a mushroom cluster was 11 calls, a flowerbed 8, a
  // workstation up to 85. See mergeStaticMeshes for what it refuses to touch
  // (anything carrying userData, instanced, or shader-driven — trees and the
  // cover presets pass through unchanged).
  return built.isMesh ? built : mergeStaticMeshes(built);
}
