// =============================================================================
// INTEGRATION SNIPPET — paste these into your existing files
// =============================================================================
//
// 1. In src/generators/props.js, add these imports (after the caveDecor import):
//
//    import {
//      generateSundial, generateBirdbath, generateGardenTrellis,
//      generateTopiary, generateStoneGazebo,
//    } from './environment/gardenDecor.js';
//    import {
//      generateBrokenPillar, generateCrumbledArch, generateAncientAltar,
//      generateOvergrownStatue, generateMossyTomb,
//    } from './environment/ruinsDecor.js';
//    import {
//      generateSummoningCircle, generateFloatingRunes, generateCrystalBallStand,
//      generatePotionShelf, generateSpellPodium,
//    } from './environment/arcaneDecor.js';
//    import {
//      generateButterChurn, generateSpitRoast, generateRainBarrel,
//      generateChoppingBlock, generateGrainSackStack, generateCiderPress,
//    } from './environment/ruralDecor.js';
//
//
// 2. In the BUILDERS object (in props.js), add these entries:
//
//    // --- Garden decorations ---
//    'garden-sundial': generateSundial,
//    'garden-birdbath': generateBirdbath,
//    'garden-trellis': generateGardenTrellis,
//    'garden-topiary': generateTopiary,
//    'garden-gazebo': generateStoneGazebo,
//
//    // --- Ruins & ancient ---
//    'ruins-broken-pillar': generateBrokenPillar,
//    'ruins-arch': generateCrumbledArch,
//    'ruins-altar': generateAncientAltar,
//    'ruins-statue': generateOvergrownStatue,
//    'ruins-tomb': generateMossyTomb,
//
//    // --- Arcane & magical ---
//    'arcane-summoning-circle': generateSummoningCircle,
//    'arcane-floating-runes': generateFloatingRunes,
//    'arcane-crystal-ball': generateCrystalBallStand,
//    'arcane-potion-shelf': generatePotionShelf,
//    'arcane-spell-podium': generateSpellPodium,
//
//    // --- Domestic & rural ---
//    'rural-butter-churn': generateButterChurn,
//    'rural-spit-roast': generateSpitRoast,
//    'rural-rain-barrel': generateRainBarrel,
//    'rural-chopping-block': generateChoppingBlock,
//    'rural-grain-sacks': generateGrainSackStack,
//    'rural-cider-press': generateCiderPress,
//
//
// 3. In src/sim/propTypes.js, add catalog entries for each prop.
//    The catalog is an object keyed by the same id as BUILDERS.
//    Here is the metadata block for all 21 new props — add each one
//    to the PROP_CATEGORIES map and the PROPS catalog object.
//    Example entry format (match your existing entries' structure):
//
//    { id: 'garden-sundial', label: 'Sundial', category: 'garden',
//      collider: { type: 'cylinder', radius: 0.5, height: 1.2 } },
//
//    Category suggestions:
//      - 'garden' for the gardenDecor props
//      - 'ruins'  for the ruinsDecor props (new category)
//      - 'arcane' for the arcaneDecor props
//      - 'rural'  for the ruralDecor props (new category)
//
//    Or split into existing categories if you prefer:
//      - garden props → 'decor' or 'park'
//      - ruins props → 'decor'
//      - arcane props → 'arcane' (already exists from arcane-obelisk etc.)
//      - rural props → 'countryside' (already exists)
//
//
// 4. Run `npm run check:props` to verify both files agree on all ids.
//    This script is what enforces that every id in BUILDERS has a
//    matching entry in propTypes, and vice versa.
//
// =============================================================================
//
// SUGGESTED propTypes.js ENTRIES (copy the structure, adjust to your format):
//
// --- gardenDecor ---
// { id: 'garden-sundial',       label: 'Sundial',       category: 'garden', collider: { type: 'cylinder', radius: 0.45, height: 1.3 } },
// { id: 'garden-birdbath',      label: 'Birdbath',      category: 'garden', collider: { type: 'cylinder', radius: 0.50, height: 1.4 } },
// { id: 'garden-trellis',      label: 'Garden Trellis', category: 'garden', collider: { type: 'box',     w: 1.2,  d: 0.15, height: 1.8 } },
// { id: 'garden-topiary',      label: 'Topiary',       category: 'garden', collider: { type: 'cylinder', radius: 0.35, height: 1.8 } },
// { id: 'garden-gazebo',       label: 'Stone Gazebo',  category: 'garden', collider: { type: 'cylinder', radius: 1.8,  height: 3.8 } },
//
// --- ruinsDecor ---
// { id: 'ruins-broken-pillar', label: 'Broken Pillar', category: 'ruins',  collider: { type: 'cylinder', radius: 0.50, height: 3.5 } },
// { id: 'ruins-arch',          label: 'Crumbled Arch', category: 'ruins',  collider: { type: 'box',     w: 4.0,  d: 1.5,  height: 4.5 } },
// { id: 'ruins-altar',         label: 'Ancient Altar', category: 'ruins',  collider: { type: 'box',     w: 2.3,  d: 1.5,  height: 0.6 } },
// { id: 'ruins-statue',        label: 'Overgrown Statue', category: 'ruins', collider: { type: 'cylinder', radius: 0.6, height: 2.2 } },
// { id: 'ruins-tomb',          label: 'Mossy Tomb',    category: 'ruins',  collider: { type: 'box',     w: 2.8,  d: 2.8,  height: 1.0 } },
//
// --- arcaneDecor ---
// { id: 'arcane-summoning-circle', label: 'Summoning Circle', category: 'arcane', collider: { type: 'cylinder', radius: 2.5, height: 0.2 } },
// { id: 'arcane-floating-runes',   label: 'Floating Runes',   category: 'arcane', collider: { type: 'cylinder', radius: 0.8, height: 2.0 } },
// { id: 'arcane-crystal-ball',    label: 'Crystal Ball',     category: 'arcane', collider: { type: 'cylinder', radius: 0.35, height: 1.0 } },
// { id: 'arcane-potion-shelf',    label: 'Potion Shelf',     category: 'arcane', collider: { type: 'box',     w: 1.8,  d: 0.3,  height: 1.8 } },
// { id: 'arcane-spell-podium',    label: 'Spell Podium',     category: 'arcane', collider: { type: 'cylinder', radius: 0.4, height: 1.4 } },
//
// --- ruralDecor ---
// { id: 'rural-butter-churn',  label: 'Butter Churn',  category: 'rural', collider: { type: 'cylinder', radius: 0.25, height: 1.5 } },
// { id: 'rural-spit-roast',    label: 'Spit Roast',     category: 'rural', collider: { type: 'cylinder', radius: 0.5,  height: 1.0 } },
// { id: 'rural-rain-barrel',   label: 'Rain Barrel',    category: 'rural', collider: { type: 'cylinder', radius: 0.45, height: 1.1 } },
// { id: 'rural-chopping-block', label: 'Chopping Block', category: 'rural', collider: { type: 'cylinder', radius: 0.45, height: 0.6 } },
// { id: 'rural-grain-sacks',   label: 'Grain Sacks',   category: 'rural', collider: { type: 'box',     w: 1.2,  d: 0.8,  height: 1.2 } },
// { id: 'rural-cider-press',   label: 'Cider Press',    category: 'rural', collider: { type: 'box',     w: 1.0,  d: 0.8,  height: 1.7 } },
