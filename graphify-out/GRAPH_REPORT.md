# Graph Report - src  (2026-07-31)

## Corpus Check
- 133 files · ~259,763 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2563 nodes · 5605 edges · 113 communities (98 shown, 15 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 249 edges (avg confidence: 0.68)
- Token cost: 1,400 input · 2,600 output

## Community Hubs (Navigation)
- World Editor Core Shell
- Game Client Main Loop
- Building Builder & Rigging
- Character Builder & Weapon Models
- Skill Builder App
- Countryside & Town Set Dressing
- ez-tree Vendor Library
- VFX Preset Catalog
- Flora, Grass & Seeded Random
- Town Buildings & Crafting Stations
- Ground Cover & Scene Themes
- Stats, Classes & Leveling
- Monster Presets & Rig Editing
- Weapon Model Loading
- Scene Construction
- Tree Generation
- Structures, Decor & Water Props
- VFX System Wiring
- Rocks, Stones & Jitter
- Character Creation Flow
- Atmosphere & Graphics Settings
- Ground Texture Mesh & Cloud Shadows
- Editor Scene Bridge
- Workstation Props
- Network Client
- Editor Inventory Panels
- VFX Preset Parameters
- VFX Textures & Custom Effects
- Item Definitions & Inventory
- Character & Creature Rigs
- Editor World Effects
- Character Presets
- Creature & Monster Type Defs
- Monster Preset Catalog
- Prop Collision Types
- Skill Definitions
- Cloud Shadow Settings
- Wind Sway
- Ambient & World Particles
- Foliage Shading & Toon Gradient
- Skill Builder Forms
- Player Character Presets
- ez-tree Geometry Internals
- Path Meshes & Themes
- Anime Character Generator
- Face Texture Generation
- Event System
- Prop Registry & Models
- Tower Zone Client
- Crafting & Profession Leveling
- Rig Preview in Editor
- Editor Controls (misc A)
- Mountain Meshes & Themes
- Monster Mesh & Connectivity
- Movement & Collision Resolution
- VFX Anchors
- Editor Controls (misc B)
- Quest System
- Minimap & Zone Audio
- Editor Controls (misc C)
- Grass Cover Meshes
- Monster AI & Status Effects
- Maps, Teleporters & Zones
- Map Catalog Management
- Mountain Terrain Stamping
- VFX Parameter Specs
- Weapon Tuning Validation
- Flora Plugin System
- Scenery Palette Thumbnails
- Equipment Preview Meshes
- VFX Light Pool
- Ground Texture Layers
- Skill Builder Field Rendering
- ez-tree Branch Geometry
- Interior Furniture
- VFX Catalog Loading
- Building & Object Def Parsers
- Equipment System
- Water Bodies Validation
- Editor Item Form
- Particle Emitters
- Editor Terrain & Water Painting
- NPC Dialog & Event Client
- Party System
- NPC Wander & Dialog Validation
- Crafting Recipes
- Post-Processing Shaders
- Gathering Nodes
- Tower Floors & Loot Validation
- Path Definitions
- Skill Targeting Resolution
- Rock & Ore Generation
- Crafting Station Types
- Editor Quest Sheets
- Editor Mountain Selection
- Editor River Selection
- Editor Ground Texture Palette
- Editor Modal Framework
- Quest Log UI
- Audio Catalog
- Store Interiors
- Emitter Palette
- Freeform Zone Drafting
- Ground Texture Painting
- Freeform Zone Properties
- River Drafting
- Editor Palette Items
- Audio Upload
- Monster Builder Catalog
- Building Part Presets
- River Height Enforcement

## God Nodes (most connected - your core abstractions)
1. `createRng()` - 138 edges
2. `pick()` - 93 edges
3. `_` - 70 edges
4. `rangeInt()` - 53 edges
5. `makeKit()` - 49 edges
6. `matte()` - 39 edges
7. `range()` - 34 edges
8. `animate()` - 30 edges
9. `NetClient` - 30 edges
10. `rebuildAll()` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Plugin category Must Match an Existing Palette Tab` --references--> `PROP_CATEGORIES`  [EXTRACTED]
  generators/environment/plugins/README.md → sim/propTypes.js
- `Plugin Props Are Always Walk-Through` --rationale_for--> `PROP_TYPES`  [EXTRACTED]
  generators/environment/plugins/README.md → sim/propTypes.js
- `Duplicate meta.id Silently Overwrites` --rationale_for--> `BY_ID`  [INFERRED]
  generators/environment/plugins/README.md → sim/propTypes.js
- `Flora Plugin Contract (meta + build)` --conceptually_related_to--> `registerPluginType()`  [INFERRED]
  generators/environment/plugins/README.md → sim/propTypes.js
- `sampleWaterBody()` --indirect_call--> `body()`  [INFERRED]
  sim/world.js → generators/characterPresets.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Flora Plugin Zero-Registration Flow** — generators_environment_plugins_readme_flora_plugin_contract, generators_pluginloader_loadfloraplugins, generators_props_registerpluginbuilder, sim_proptypes_registerplugintype, generators_environment_plugins_clover_meta [EXTRACTED 1.00]

## Communities (113 total, 15 thin omitted)

### Community 0 - "World Editor Core Shell"
Cohesion: 0.00
Nodes (403): ARMOR_PRESETS, ATTACK_POSE_BY_STANCE, audioCatalog, brushRadiusEl, brushRing, brushStrengthEl, bsColor, bsOpacity (+395 more)

### Community 1 - "Game Client Main Loop"
Cohesion: 0.01
Nodes (146): abilitiesByKey, abilityUI, activeEventObjects, activeGraphicsSettings, activeTeleporters, allocatedStats, audioCatalogById, authoredItemById (+138 more)

### Community 2 - "Building Builder & Rigging"
Cohesion: 0.05
Nodes (68): activeTarget(), addPiece(), attachGizmo(), AXES, buildings, buildPlacementFieldEditor(), buildShapeFieldEditor(), camera (+60 more)

### Community 3 - "Character Builder & Weapon Models"
Cohesion: 0.05
Nodes (66): addSkillSelEl, anchorEl, animSel, assignedSkillsListEl, attachGizmo(), AXES, buildSlotTabs(), buildTuner() (+58 more)

### Community 4 - "Skill Builder App"
Cohesion: 0.03
Nodes (54): blankSkill(), camera, canMoveEl, canvas, castAnchorSel, castMsEl, castVfxSel, catalog (+46 more)

### Community 5 - "Countryside & Town Set Dressing"
Cohesion: 0.09
Nodes (57): CROP_GREEN, cropField(), generateBarn(), generateBeehive(), generateChickenCoop(), generateCropCabbage(), generateCropPumpkin(), generateCropWheat() (+49 more)

### Community 6 - "ez-tree Vendor Library"
Cohesion: 0.04
Nodes (58): _, AA, b, BA, BB, cA, CB, DA (+50 more)

### Community 7 - "VFX Preset Catalog"
Cohesion: 0.04
Nodes (52): ARCANE_A, ARCANE_B, asArray(), BLOOD_A, BLOOD_B, CC_A, CORRUPTION_A, CORRUPTION_B (+44 more)

### Community 8 - "Flora, Grass & Seeded Random"
Cohesion: 0.13
Nodes (45): AUTUMN, buildRuneTexture(), finish(), flowerPatch(), generateAlpineConifer(), generateAlpineFlower(), generateBluebells(), generateBranch() (+37 more)

### Community 9 - "Town Buildings & Crafting Stations"
Cohesion: 0.08
Nodes (46): CLOTH, finish(), generateStationAlchemyLab(), generateStationAnvil(), generateStationCampfire(), generateStationJewelersBench(), generateStationLoom(), generateStationWorkbench() (+38 more)

### Community 10 - "Ground Cover & Scene Themes"
Cohesion: 0.06
Nodes (47): animate(), buildPathHandleMesh(), buildRiverDraftPreviewMesh(), deleteModel(), deleteSelectedPath(), deselectFreeformZone(), deselectPath(), finalizeZone() (+39 more)

### Community 11 - "Stats, Classes & Leveling"
Cohesion: 0.08
Nodes (37): ARMOR_TYPES, CONSUMABLE_USAGE_MODES, EQUIP_SLOTS, ITEM_EFFECT_KINDS, ITEM_RARITIES, ITEM_STAT_IDS, ITEM_TYPES, parseAuthoredItems() (+29 more)

### Community 12 - "Monster Presets & Rig Editing"
Cohesion: 0.07
Nodes (41): addMbShape(), animatableRoles(), animEntryFor(), animWalk(), applyBodyPreset(), applyPartPreset(), blankMonsterType(), ensureSlot() (+33 more)

### Community 13 - "Weapon Model Loading"
Cohesion: 0.13
Nodes (35): remeasureModel(), buildModelPlaceholder(), catalogById, fbxLoader, forgetLoadedModel(), gltfLoader, isGlb(), loadedById (+27 more)

### Community 14 - "Scene Construction"
Cohesion: 0.10
Nodes (33): ABILITY_FLASH_COLORS, applyLakeSeabedShading(), applyLakeWaterShading(), applyRiverWaterShading(), buildLakeBodyGeometry(), buildLakeBodyMeshes(), buildLakeBodySeabedMesh(), buildLakeBodySkirtMesh() (+25 more)

### Community 15 - "Tree Generation"
Cohesion: 0.10
Nodes (29): buildCanopyMaterial(), buildCoreGeometry(), buildCrownBlobs(), buildLeafCards(), buildTrunk(), crownCenter(), _dir, generateFluffyTree() (+21 more)

### Community 16 - "Structures, Decor & Water Props"
Cohesion: 0.14
Nodes (27): BUILDING_SHAPES, generateBuildingShell(), generateWallSegment(), STONE_COLORS, generateArcaneBrazier(), generateArcaneObelisk(), generateArcheryTarget(), generateBench() (+19 more)

### Community 17 - "VFX System Wiring"
Cohesion: 0.14
Nodes (29): buildCustomVfxSystem(), customVfxDefs, auraPreset(), beamPreset(), castFx(), cloudPreset(), emitCount(), firePreset() (+21 more)

### Community 18 - "Rocks, Stones & Jitter"
Cohesion: 0.17
Nodes (26): jitterSharedVertices(), generateOreDeposit(), generateRock(), ROCK_COLORS, crystalCluster(), finish(), generateBoulder(), generateCrystal() (+18 more)

### Community 19 - "Character Creation Flow"
Cohesion: 0.09
Nodes (23): bodyEl, buildSwatches(), camera, canvas, catalogReady, characterTypes, classCardsEl, currentParams() (+15 more)

### Community 20 - "Atmosphere & Graphics Settings"
Cohesion: 0.11
Nodes (26): applyActiveGraphicsSettings(), applyAtmosphere(), applyGraphicsSettingsToAtmosphere(), ATMOSPHERE_PRESETS, createClouds(), createSkyDome(), createSunGlow(), createSunRays() (+18 more)

### Community 21 - "Ground Texture Mesh & Cloud Shadows"
Cohesion: 0.13
Nodes (23): addCloudShadowShader(), cloudShadowSampleGLSL(), getCloudShadowTexture(), updateCloudShadowTime(), buildGroundTextureOverlay(), buildMaskTexture(), getDummyMaskTexture(), getDummyTileTexture() (+15 more)

### Community 22 - "Editor Scene Bridge"
Cohesion: 0.14
Nodes (26): activeMonsterGroup(), activeMonsterList(), applyMonsterAppearance(), brushOffsets(), buildMonsterRef(), clearMonstersUnderBrush(), clearPropsUnderBrush(), deleteSelectedMonster() (+18 more)

### Community 23 - "Workstation Props"
Cohesion: 0.29
Nodes (24): barX(), barZ(), box(), cyl(), finish(), generateWorkstationAlchemy(), generateWorkstationCarpenter(), generateWorkstationFloorLoom() (+16 more)

### Community 25 - "Editor Inventory Panels"
Cohesion: 0.13
Nodes (24): applyAttachPick(), buildEventMarkerMesh(), defaultEventCommand(), defaultEventSheet(), EVENT_NESTED_DISALLOWED, highlightAttachedTarget(), isEventAttachableProp(), labeledInput() (+16 more)

### Community 26 - "VFX Preset Parameters"
Cohesion: 0.27
Nodes (24): boltPreset(), burstEmission(), burstPreset(), debrisPreset(), dragCurve(), fallPreset(), fallStreakPreset(), flashPreset() (+16 more)

### Community 27 - "VFX Textures & Custom Effects"
Cohesion: 0.20
Nodes (21): BUILDERS, TEXTURES, featherEdges(), getArrowTexture(), getBeamTexture(), getBoltTexture(), getDebrisTexture(), getFlameBodyTexture() (+13 more)

### Community 28 - "Item Definitions & Inventory"
Cohesion: 0.10
Nodes (21): populateQuestDropdowns(), animateEquipPreview(), classBaseStats(), merchantIconHtml(), openCraftingStationPanel(), openEquipmentPanel(), openMerchantPanel(), previewDerivedStats() (+13 more)

### Community 29 - "Character & Creature Rigs"
Cohesion: 0.16
Nodes (19): buildHair(), EYE_COLORS, FACE_SHAPES, faceShapeGeometry(), generateCharacter(), HAIR_COLORS, HAIR_STYLES, SKIN_TONES (+11 more)

### Community 30 - "Editor World Effects"
Cohesion: 0.13
Nodes (21): applyMonstersModeVisibility(), buildEmitterMarker(), frameCameraOnBounds(), nextEmitterId(), nextTeleporterId(), placeEmitterAt(), placeTeleporterAt(), rebuildParticleEmitters() (+13 more)

### Community 31 - "Character Presets"
Cohesion: 0.14
Nodes (18): ARM_PRESETS, armCore(), belt(), body(), C, eyes(), hairCap(), HEAD_PRESETS (+10 more)

### Community 32 - "Creature & Monster Type Defs"
Cohesion: 0.23
Nodes (19): ABILITY_KINDS, ABILITY_LEVEL_LADDER, ANIM_AXES, ARM_ROLES, CREATURE_KINDS, CREATURE_STANCES, isObj(), parseCreatureTypeDefs() (+11 more)

### Community 33 - "Monster Preset Catalog"
Cohesion: 0.17
Nodes (18): armBulk(), armStub(), birdLeg(), boneLimb(), C, eyesOn(), humanoidArm(), humanoidLeg() (+10 more)

### Community 34 - "Prop Collision Types"
Cohesion: 0.19
Nodes (19): buildCollisionIndex(), buildWorldColliders(), cellAt(), colliderBounds(), createCollisionIndex(), customObjectRadius(), degToRad(), isBlocked() (+11 more)

### Community 35 - "Skill Definitions"
Cohesion: 0.23
Nodes (17): BUFF_STATS, DAMAGE_TYPES, EFFECT_TYPES, isObj(), parseSkillDefs(), RIG_PARTS, TARGETING_MODES, TARGETING_SHAPES (+9 more)

### Community 36 - "Cloud Shadow Settings"
Cohesion: 0.12
Nodes (19): applyLiveGfx(), applySelectedColor(), applySelectedRotation(), bindGfxColorControl(), bindGfxControl(), bindGfxSelectControl(), deleteSelected(), hexToColorString() (+11 more)

### Community 37 - "Wind Sway"
Cohesion: 0.15
Nodes (19): placeAt(), placeBuildingAt(), rebuildWater(), recollectSwayables(), SWAYING_FLOWER_TYPES, applyWaterShading(), buildBuildingPlaceholder(), buildGatheringNodeMarker() (+11 more)

### Community 38 - "Ambient & World Particles"
Cohesion: 0.20
Nodes (18): rebuildParticles(), buildMapParticles(), clearMapParticles(), bilinearSampleMask(), buildRegionParticles(), createAmbientParticleSystem(), createEnvironmentalParticleSystem(), createZoneParticleSystem() (+10 more)

### Community 39 - "Foliage Shading & Toon Gradient"
Cohesion: 0.20
Nodes (15): BASE_CHILDREN, generateEzTree(), toToonMaterial(), buildFlowerMeadowPropMesh(), buildMeadowMesh(), centerGeometry(), createFlowerCover(), flowerMaterials() (+7 more)

### Community 40 - "Skill Builder Forms"
Cohesion: 0.20
Nodes (19): activeDummyPosition(), addNumberInput(), addSelectInput(), attachAnchorGizmo(), attachPoseGizmo(), detachGizmo(), getTimelineTotal(), handleCanvasClick() (+11 more)

### Community 41 - "Player Character Presets"
Cohesion: 0.16
Nodes (16): CHARACTER_PRESETS, applyAppearance(), buildPlayerCharacter(), classBody(), EYE_COLORS, GENDER_BODY_SCALE, GENDER_LABELS, GENDERED_BODY_IDS (+8 more)

### Community 42 - "ez-tree Geometry Internals"
Cohesion: 0.18
Nodes (4): DE, h, q, u

### Community 43 - "Path Meshes & Themes"
Cohesion: 0.18
Nodes (15): buildThemePalette(), buildPathMesh(), buildPathMeshes(), resamplePoints(), buildThemeTexture(), clampByte(), getPathThemeTexture(), hashStringToSeed() (+7 more)

### Community 44 - "Anime Character Generator"
Cohesion: 0.15
Nodes (13): ANIME_ANCHORS, ANIME_CHARACTER_PRESETS, ANIME_HAIR_SHAPES, ANIME_HAIR_STYLES, animeCharacterBody(), ARM_SHAPES, BACK, BANGS (+5 more)

### Community 45 - "Face Texture Generation"
Cohesion: 0.19
Nodes (16): BROW_GEOM, BROW_STYLES, buildFaceTexture(), cache, cacheKey(), DEFAULTS, drawBrow(), drawEye() (+8 more)

### Community 46 - "Event System"
Cohesion: 0.21
Nodes (13): evalCondition(), EVENT_ATTACH_TYPES, EVENT_COMMAND_TYPES, EVENT_START_TYPES, isObj(), runSynchronous(), selectEligibleSheet(), sheetIdFor() (+5 more)

### Community 47 - "Prop Registry & Models"
Cohesion: 0.15
Nodes (12): Plugin category Must Match an Existing Palette Tab, check:props Does Not Scan the Plugin Folder, Duplicate meta.id Silently Overwrites, pluginBuilders, parseModelCatalog(), PROP_CATEGORY_IDS, BY_ID, PROP_CATEGORIES (+4 more)

### Community 48 - "Tower Zone Client"
Cohesion: 0.16
Nodes (14): animate(), currentInput(), findNearestEventObject(), findNearestGatherNode(), findNearestNpc(), findNearestRemotePlayer(), findNearestTeleporter(), overworldMonsterMeshes (+6 more)

### Community 49 - "Crafting & Profession Leveling"
Cohesion: 0.19
Nodes (12): canUseStationForRecipe(), resolveCraft(), grantProfessionXp(), initAllProfessions(), initProfessionState(), MAX_PROFESSION_LEVEL, xpForProfessionLevel(), canAffordReagents() (+4 more)

### Community 50 - "Rig Preview in Editor"
Cohesion: 0.28
Nodes (14): frame(), resize(), rig(), animateMbWorkspace(), applyAttackPose(), applyGaitPose(), applyIdlePose(), applyKeyframeClip() (+6 more)

### Community 51 - "Editor Controls (misc A)"
Cohesion: 0.14
Nodes (15): buildAppearanceFromForm(), buildNpcMesh(), deleteSelectedNpc(), dialogLinesFromForm(), dialogTreeFromDraft(), placeNpcAt(), populateNpcForm(), readNpcFormValues() (+7 more)

### Community 52 - "Mountain Meshes & Themes"
Cohesion: 0.22
Nodes (13): buildMountainThemePalette(), buildMountainMeshes(), buildMountainRidgeMesh(), resampleRidgePoints(), buildThemeTexture(), clampByte(), getMountainThemeTexture(), hashStringToSeed() (+5 more)

### Community 53 - "Monster Mesh & Connectivity"
Cohesion: 0.24
Nodes (13): generateBossGolem(), generateGoblin(), generateMonster(), generateSlime(), GOBLIN_SKIN_COLORS, SLIME_COLORS, collectShapes(), findDetachedParts() (+5 more)

### Community 54 - "Movement & Collision Resolution"
Cohesion: 0.18
Nodes (9): PredictedPlayer, PLAYER_RADIUS, clamp(), clampAxis(), GRAVITY, JUMP_SPEED, PLAYER_SPEED, sanitizeInput() (+1 more)

### Community 55 - "VFX Anchors"
Cohesion: 0.22
Nodes (14): applyPoseTimeline(), buildTravelMarker(), guessTravelColor(), runTimeline(), triggerAbilityAnimation(), updateAbilityAnimations(), applyAnchorOffset(), getChestAnchor() (+6 more)

### Community 56 - "Editor Controls (misc B)"
Cohesion: 0.19
Nodes (14): clearEventQuestForm(), clearQuestForm(), clearRecipeForm(), loadQuestIntoForm(), loadRecipeIntoForm(), populateEventQuestDropdowns(), populateEventQuestForm(), populateRecipeDropdowns() (+6 more)

### Community 57 - "Quest System"
Cohesion: 0.24
Nodes (11): computeNpcQuestStatus(), acceptQuest(), applyKill(), canAccept(), isActive(), isCompleted(), isReadyToTurnIn(), objectiveGoal() (+3 more)

### Community 58 - "Minimap & Zone Audio"
Cohesion: 0.19
Nodes (11): averagePoint(), buildQuestTargetLookups(), createMinimapController(), drawDot(), drawMap(), NPC_QUEST_COLORS, questObjectiveTarget(), createChannel() (+3 more)

### Community 59 - "Editor Controls (misc C)"
Cohesion: 0.21
Nodes (13): applySelectedLakeFields(), cancelRiverDraft(), computeLakeRectPoints(), deselectLakeBody(), dragSelectedLakeHandle(), nudgeSelectedLake(), placeLakeAt(), pointsBoundsXZ() (+5 more)

### Community 60 - "Grass Cover Meshes"
Cohesion: 0.35
Nodes (12): applyMeadowShading(), bladeGeometry(), buildGrassPropMesh(), buildMeadowMesh(), buildTuftMesh(), createGrassCover(), GRASS_SEASONS, meadowMaterial() (+4 more)

### Community 61 - "Monster AI & Status Effects"
Cohesion: 0.27
Nodes (10): MONSTER_RADIUS, pickMonsterAbility(), stepMonsterAI(), absorbDamage(), CC_TYPES, getBuffAmount(), getMoveSpeedMultiplier(), isActive() (+2 more)

### Community 62 - "Maps, Teleporters & Zones"
Cohesion: 0.26
Nodes (10): MAP_TYPES, validateMapManifest(), TELEPORTER_MODES, validateTeleporters(), nearestPointOnPolyline(), sampleRiverSurfaceLevel(), clamp01(), sampleWaterBody() (+2 more)

### Community 63 - "Map Catalog Management"
Cohesion: 0.18
Nodes (12): applyLoadedWorldDoc(), duplicateMap(), populateBuildingMapDatalist(), rebuildSpawnPointMarker(), refreshMapsCatalog(), renderMapProps(), renderMapsList(), resampleGrid() (+4 more)

### Community 64 - "Mountain Terrain Stamping"
Cohesion: 0.23
Nodes (10): finishMountainDraft(), DEFAULT_MOUNTAIN_WIDTH, DEFAULT_PEAK_HEIGHT, distToPolyline(), distToSegment(), MOUNTAIN_THEMES, stampMountainHeight(), validateMountains() (+2 more)

### Community 65 - "VFX Parameter Specs"
Cohesion: 0.23
Nodes (11): defaultVfxParams(), isHex(), isObj(), PARAM_SPECS, parseVfxDefs(), VFX_PARAM_SPECS, VFX_SHAPE_TEXTURES, VFX_SHAPES (+3 more)

### Community 66 - "Weapon Tuning Validation"
Cohesion: 0.25
Nodes (9): tuningPayload(), BY_ID, deg(), PRISTINE, pristineWeaponDefault(), registerCustomWeaponModels(), vec(), WEAPON_TYPE_IDS (+1 more)

### Community 67 - "Flora Plugin System"
Cohesion: 0.31
Nodes (9): propTypeCategory(), build(), meta, Flora Plugin Contract (meta + build), Plugin Props Are Always Walk-Through, loadFloraPlugins(), registerPluginBuilder(), PROP_TYPES (+1 more)

### Community 68 - "Scenery Palette Thumbnails"
Cohesion: 0.35
Nodes (10): buildThumbMesh(), createSceneryPalette(), initThumbnailRig(), propThumbnail(), renderThumb(), thumbCache, isModelLoaded(), buildProp() (+2 more)

### Community 69 - "Equipment Preview Meshes"
Cohesion: 0.18
Nodes (11): clearRemoteMeshes(), ensureEquipPreview(), hashStringToSeed(), localCharacterWithLoadout(), localMesh(), populateRemoteRoster(), rebuildEquipPreview(), rebuildLocalMesh() (+3 more)

### Community 70 - "VFX Light Pool"
Cohesion: 0.24
Nodes (4): createVfxSystem(), createVfxLightPool(), GE, xE()

### Community 71 - "Ground Texture Layers"
Cohesion: 0.35
Nodes (9): DEFAULT_GROUND_TEXTURE_RESOLUTION, GROUND_TEXTURE_BUILTIN_IDS, isKnownTextureId(), PARTICLE_TYPES, validateGroundTextureLayers(), isObj(), validateAudioRef(), validateZones() (+1 more)

### Community 72 - "Skill Builder Field Rendering"
Cohesion: 0.24
Nodes (11): addNumberField(), defaultEffect(), loadCatalog(), refreshEffectsList(), refreshIconPreview(), refreshLevelUpgradesList(), refreshShapeExtraFields(), renderEffectFieldRows() (+3 more)

### Community 73 - "ez-tree Branch Geometry"
Cohesion: 0.20
Nodes (4): a, e, o(), z

### Community 74 - "Interior Furniture"
Cohesion: 0.50
Nodes (8): generateBed(), generateChair(), generateCounter(), generateFurniture(), generateShelf(), generateTable(), WOOD_COLORS, woodMat()

### Community 75 - "VFX Catalog Loading"
Cohesion: 0.28
Nodes (9): registerCustomVfxDefs(), allVfxIds(), fillSelect(), loadVfxCatalog(), paramStep(), refreshVfxPickers(), renderVfxList(), renderVfxParamsFields() (+1 more)

### Community 76 - "Building & Object Def Parsers"
Cohesion: 0.42
Nodes (5): parseBuildingPartDefs(), PART_CATEGORIES, parseBuildingTypeDefs(), parseObjectDefs(), SHAPE_KINDS

### Community 77 - "Equipment System"
Cohesion: 0.31
Nodes (5): baseSlotFor(), canEquip(), EQUIP_SLOT_IDS, equipItem(), initEquipmentState()

### Community 78 - "Water Bodies Validation"
Cohesion: 0.28
Nodes (8): DEFAULT_LAKE_MAX_DEPTH, DEFAULT_PUDDLE_MAX_DEPTH, DEFAULT_RIVER_WIDTH, findWaterMaskComponents(), isObj(), traceWaterMaskComponentToPolygon(), validateWaterBodies(), WATER_BODY_KINDS

### Community 79 - "Editor Item Form"
Cohesion: 0.43
Nodes (8): applyArmorPreset(), clearItemForm(), loadItemIntoForm(), refreshCraftList(), refreshStatModList(), updateItemEffectSectionVisibility(), updateItemSectionVisibility(), updateUsageModeVisibility()

### Community 80 - "Particle Emitters"
Cohesion: 0.39
Nodes (6): DEFAULT_EMITTER_ACTIVATION_RADIUS, emitterSpawnOptions(), isHex(), isObj(), NUMERIC_RANGES, validateParticleEmitters()

### Community 81 - "Editor Terrain & Water Painting"
Cohesion: 0.38
Nodes (7): applyWaterLevel(), carveWaterBasin(), ensureTerrain(), ensureWaterMask(), flattenTerrain(), paintTerrain(), paintWater()

### Community 82 - "NPC Dialog & Event Client"
Cohesion: 0.29
Nodes (5): closeDialog(), eventAttachedToNpc(), openDialogTreeNode(), openEventDialogStep(), talkToNpc()

### Community 83 - "Party System"
Cohesion: 0.38
Nodes (4): addMember(), canAddMember(), isInParty(), MAX_PARTY_SIZE

### Community 84 - "NPC Wander & Dialog Validation"
Cohesion: 0.47
Nodes (4): resolveMovement(), stepNpcWander(), validateDialogTree(), validateNpcs()

### Community 85 - "Crafting Recipes"
Cohesion: 0.53
Nodes (5): canCraft(), craft(), getRecipeDef(), RECIPE_IDS, RECIPES

### Community 86 - "Post-Processing Shaders"
Cohesion: 0.40
Nodes (4): createPostProcessing(), SaturationColorfulnessShader, SharpenShader, SunraysShader

### Community 87 - "Gathering Nodes"
Cohesion: 0.60
Nodes (4): getNodeTypeDef(), NODE_TYPES, parseGatheringNode(), rollYield()

### Community 88 - "Tower Floors & Loot Validation"
Cohesion: 0.60
Nodes (3): validateLootTable(), parseFloor(), validateMonsterSpawns()

### Community 89 - "Path Definitions"
Cohesion: 0.60
Nodes (4): DEFAULT_PATH_WIDTH, isKnownPathTheme(), PATH_THEMES, validatePaths()

### Community 90 - "Skill Targeting Resolution"
Cohesion: 0.70
Nodes (4): angleDiff(), angleTo(), distanceXZ(), resolveEnemyTargets()

### Community 91 - "Rock & Ore Generation"
Cohesion: 0.67
Nodes (3): generateOreDeposit(), generateRock(), ROCK_COLORS

### Community 93 - "Editor Quest Sheets"
Cohesion: 0.67
Nodes (3): applyEventQuestForm(), generateQuestSheets(), readEventQuestForm()

### Community 94 - "Editor Mountain Selection"
Cohesion: 0.67
Nodes (3): deleteSelectedMountain(), deselectMountain(), selectMountain()

### Community 95 - "Editor River Selection"
Cohesion: 0.67
Nodes (3): deselectRiver(), populateRiverProperties(), selectRiver()

### Community 96 - "Editor Ground Texture Palette"
Cohesion: 0.67
Nodes (3): renderGroundTexPalette(), syncGroundTexParticleDropdown(), syncGroundTexParticleSlidersEnabled()

### Community 98 - "Quest Log UI"
Cohesion: 0.67
Nodes (3): objectiveGoal(), questProgressText(), refreshQuestLog()

## Knowledge Gaps
- **922 isolated node(s):** `AXES`, `CATEGORY_LABEL`, `parts`, `buildings`, `canvas` (+917 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createRng()` connect `Structures, Decor & Water Props` to `Building Builder & Rigging`, `Flora Plugin System`, `Prop Collision Types`, `Countryside & Town Set Dressing`, `Foliage Shading & Toon Gradient`, `Flora, Grass & Seeded Random`, `Town Buildings & Crafting Stations`, `Interior Furniture`, `Tree Generation`, `Rocks, Stones & Jitter`, `Monster Mesh & Connectivity`, `Workstation Props`, `Grass Cover Meshes`, `Character & Creature Rigs`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `_` connect `ez-tree Vendor Library` to `ez-tree Branch Geometry`, `ez-tree Geometry Internals`, `VFX Light Pool`, `Foliage Shading & Toon Gradient`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `createVfxSystem()` connect `VFX Light Pool` to `World Editor Core Shell`, `Game Client Main Loop`, `Skill Builder App`, `VFX System Wiring`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **What connects `AXES`, `CATEGORY_LABEL`, `parts` to the rest of the system?**
  _922 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `World Editor Core Shell` be split into smaller, more focused modules?**
  _Cohesion score 0.00437636761487965 - nodes in this community are weakly interconnected._
- **Should `Game Client Main Loop` be split into smaller, more focused modules?**
  _Cohesion score 0.011829546982121252 - nodes in this community are weakly interconnected._
- **Should `Building Builder & Rigging` be split into smaller, more focused modules?**
  _Cohesion score 0.054385964912280704 - nodes in this community are weakly interconnected._