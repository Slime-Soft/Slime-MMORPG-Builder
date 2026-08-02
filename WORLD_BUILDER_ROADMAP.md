# World Editor Roadmap: Content Authoring Suite

## Purpose

This document captures the next tier of World Editor capability, to be tackled
**after** the current CLAUDE.md build order (Phases 1-9) is complete. It is a
wishlist + rough spec, not a committed build order yet — treat it as the
starting point for scoping real phases once we get here, the same way
CLAUDE.md itself started as a plan before Phase 1 began.

Nothing here should be started until the current list is finished and Dennis
says go. When we do start, this document should get the same treatment as
CLAUDE.md: broken into scoped phases/parts, each verified before moving on.

## Why this is a separate document

The current World Editor (Phase 3) is a *placement* tool: it drops
pre-generated assets (trees, rocks, walls, buildings) into a fixed world and
paints terrain/zones. Everything below is a step up in kind, not just degree
— it turns the editor into a *content authoring* tool that creates new
gameplay data (quests, items, abilities), not just new geometry. That
implies new data stores, new schemas, and probably new editor UI panels
distinct from the current placement/terrain/zone/building tabs. It's a
big enough jump to deserve its own planning pass rather than being folded
into Phase 3 retroactively.

## Requested capabilities

### 1. Larger maps
- Increase `world.json` bounds beyond the current 1000×1000 units.
- Things to watch: terrain heightmap resolution scaling with size (currently
  a flat resolution×resolution grid — may need chunking at large sizes),
  and whether the World Editor's single ground mesh rebuild-on-paint
  approach stays fast enough (Phase 3 rebuilds the whole ground mesh on
  every terrain edit — fine at current scale, may need a chunked/dirty-rect
  approach at 5-10x the size).

### 2. NPCs — done (2026-07-09), except the quest-giver subtype
- Placeable town NPCs authored via the World Editor's NPCs mode (9th
  toolbar icon): name, seed-based appearance (reuses the chibi character
  generator; 🎲 Reroll for a new look), 2–4 line dialog, and idle-wander
  toggle + radius/speed. Stored in `world.json`'s `npcs` array (schema +
  wander AI in `src/sim/npc.js`).
- Server ticks the idle-wander AI and broadcasts NPC positions in the
  overworld `state` payload (server-authoritative, like monsters). Client
  renders them with billboarded name labels (`buildNameLabel` in
  scene.js) and a dialog box: walk up, "Press E to talk", E cycles the
  lines. Walking away closes it.
- Still open: the **quest-giver subtype** — NPCs can't have a quest
  attached yet, because quests (#3) don't exist. The NPC data model has no
  quest link; that's added when quests are built. Shop NPCs behind counters
  remain the separate hardcoded `STORE_INTERIOR.npc` (not this system).

### 3. Quests — done for 3 of 4 objective types (2026-07-09)
- Quest catalog (`quests/quests.json`, schema + engine in `src/sim/quests.js`)
  authored via the editor's Quests mode (10th toolbar icon): name,
  description, giver NPC, objective, rewards (xp/gold/optional item).
- Objective types live: **kill N of a monster GROUP** (monsters carry an
  optional `group` tag set in Monsters mode, so slimes in area A count while
  area B's don't — this was the key design ask), **bring N of an item**
  (turn-in checks + consumes inventory), and **talk to an NPC**. The 4th
  type from the design — *interact with a world object* — is deliberately
  NOT built: it needs the interaction/trigger system (#15), which doesn't
  exist. `QUEST_TYPES` in quests.js is where it'd slot in.
- Full state machine per player (available → active → turn-in-ready →
  completed), server-authoritative. Client: talking to a giver NPC shows
  Accept in the dialog box; a quest log (J) tracks progress; returning shows
  Turn In. The engine functions (acceptQuest/applyKill/applyTalk/
  turnInQuest) are pure and socket-free **specifically so the planned
  simulated-player "bot" NPCs can drive the same quest flow** — see the bot
  note below.
- **Still not persisted.** Quest progress lives in the in-memory player
  object and resets on server restart, same as inventory/gold/level. This
  remains the roadmap item that most clearly motivates finally wiring up
  Prisma — deferred until accounts/persistence are tackled as their own
  piece.

### 3b. Simulated-player "bot" NPCs (new — requested 2026-07-09)
- Idea (à la MMORPG Tycoon 2): server-side fake players that wander town,
  accept quests, fight in the tower, turn in, repeat — appearing to real
  players as ordinary adventurers, for a "living world" feel.
- **Feasible and well-supported by the architecture**: the server is
  authoritative and the sim is headless, so a bot is just a player-shaped
  state object driven by a behavior FSM that calls the same functions real
  input calls. Not started. Main prerequisite: gameplay logic currently
  inside `socket.on(...)` closures (gather/craft/use-ability) should be
  extracted into plain functions both the socket handler and the bot AI
  call — the quest engine and the party system were both built this way as
  first steps.

### 3c. Party system — done (2026-07-09), CLAUDE.md Phase 8
- Built ahead of bots (3b) specifically so bots use the same grouping
  mechanic. Membership rules in `src/sim/party.js` (pure, unit-tested:
  cap of 4, leader promotion on leave, disband below 2). Server party
  manager (`parties`/`pendingInvites` maps in `server/index.js`) exposes
  `sendPartyInvite`/`acceptPartyInvite`/`removeFromParty` as bot-callable
  functions (socket emits guarded with `?.`).
- **Shared kill credit**: `awardKill` credits the last-hitter plus every
  same-location party member within `SHARED_CREDIT_RANGE` — each gets full
  XP and kill-quest progress (so a party questing together all advance the
  same "kill N of group X" objective). Solo behavior unchanged.
- Client: party roster panel with per-member HP bars, **P** to invite the
  nearest overworld player, **Y** to accept an invite, Leave button.
- Deferred (all noted, not blocking): per-party tower **instancing** (floors
  are still globally shared — everyone on floor N sees each other), **loot
  rules** (no loot drops exist yet — see #16), and the **minimap** (separate
  Phase 8 item). Quest accept/turn-in stay per-player; only progress is
  shared.

### 4. Monster placement via the editor
- Editor UI to place/configure monster spawns visually — pick a type,
  click to place, set health/damage/speed/aggro range via a form, same
  pattern as the building-placement panel. The Monsters mode (built for
  tower floors 2026-07-08) covers this.
- Monsters are no longer tower-only (CLAUDE.md's World Setting section
  updated 2026-07-08) — the Monsters mode is being extended to also cover
  the overworld (`world.json`'s `monsters` field), selected via the same
  floor dropdown as tower floors.

### 5. More building types — roof/shape variety done (2026-07-08)
- Four distinct silhouettes now exist in `generateBuildingShell`
  (`src/generators/environment/structures.js`), selected by the building's
  `type` field (now a dropdown in the editor's Buildings mode, not free
  text): **cottage** (pyramid roof, the original default), **shop** (flat
  overhanging roof + awning over the door), **guild-hall** (grander
  two-tier silhouette), **longhouse** (gabled ridge roof). The two
  buildings already in `world.json` (`type: "shop"`, `type: "guild-hall"`)
  now render with their matching distinct shapes instead of looking
  identical.
- Still open: **per-building interior presets** — interiors are still one
  hardcoded `STORE_INTERIOR` regardless of building type (see roadmap item
  #10's generalized instance system, which interiors would naturally hang
  off of).

### 6. More environment/prop types
- Named explicitly: flowers (generator already exists from Phase 2,
  just needs editor placement support like trees/rocks), stones (may
  already be covered by the existing rock generator — confirm whether
  "stones" means something visually distinct), and general decorative
  objects (a catch-all prop category — worth defining a short concrete
  list rather than leaving it fully open-ended, otherwise the palette
  becomes unbounded).

### 6a. Terrain & texture painting tools (added after visual-quality discussion)
- **Ground texture painting — DONE (2026-07-11, night session).** Built as
  `world.groundTextures[]` (`src/sim/groundTextures.js`): each texture id
  (6 builtins + custom uploads) gets its own soft-edged weight mask, painted
  with the same brush mechanic as the water mask; multiple layers
  alpha-composite in creation order into one baked overlay
  (`src/render/groundTextureMesh.js`), which is what gives smooth blended
  transitions between two different textures. Follows terrain per-vertex
  (unlike water's flat plane). New World Editor "Ground Textures" mode
  (hotkey `G`): palette + brush radius/softness + an "upload your own
  texture" file input (`POST /api/ground-textures/upload`, mirrors the item-
  icon upload pattern). Paths (item #14, done earlier the same day) always
  render above ground textures via ordinary opaque-vs-transparent depth
  testing. See `PROJECT_STATUS.md`'s "Drawn paths, ground-texture painting,
  and ambient particles" handoff for full detail — **flagged there as not
  yet visually verified with a real screenshot**, only via direct function
  calls in a backgrounded browser tab, so a look-and-confirm pass is still
  owed.
- **Mountains**: given their scale, more likely a terrain brush *preset*
  (a big, steep raise with some noise) than a placeable prop — builds on
  the terrain height-painting brush that already exists from Phase 3,
  just with different brush parameters, possibly paired with rock/cliff
  dressing generated along steep slopes automatically.
- **Water areas (lakes/rivers)**: the current water generator (Phase 2) is
  a single static plane, placed as one prop. A real water *tool* needs:
  a paint-a-region (for lakes) or path/spline (for rivers) input in the
  editor, and a better water material (at minimum UV-scroll for flow,
  ideally a proper shader) — same "editor tool and rendering upgrade are
  one piece of work" situation as ground textures above.
- **Grass/tree/prop brush painting**: right now the World Editor places
  one prop per click (Phase 3). A brush tool — hold and drag to scatter
  many instances within a radius, with density/randomization controls —
  would make populating a forest or grass field practical instead of
  hundreds of individual clicks. This is purely an editor UX improvement;
  it works identically whether the thing being scattered is a procedural
  tree or (per item #11 below) an imported model, since the brush just
  places instances of whatever asset type is selected.

### 7. Item system — authoring done (2026-07-09), gameplay wiring not started
- Gear, weapons, and quest items are now authorable content: a catalog
  (`items/items.json`, schema in `src/sim/authoredItems.js`) with name,
  type (weapon/armor/quest/misc), slot, rarity, description, sell price,
  and an icon — built through the editor's new Items mode (8th toolbar
  icon).
- Deliberately scoped OUT of this pass, and still genuinely open: **actual
  combat stats**. The schema reserves a `stats` field but nothing reads it
  — there's still no armor/defense concept anywhere in combat (monsters
  deal flat unmitigated damage), no equip-slot system, and no loot table to
  grant these items to a player in the first place (that's item #16). This
  was the exact ambiguity this roadmap entry originally flagged, and it's
  still unresolved — authoring the catalog didn't require resolving it, but
  making items *do* anything in combat still does.
- Ties into inventory (Phase 9), crafting/gathering (Phase 6, already
  live), and vendor economy (Phase 6, already live) once the above is
  resolved.

### 8. Ability authoring + animation library
- Right now abilities are hardcoded data in `src/sim/classes.js` (Phase 4).
  This asks for the editor to create *new* abilities: name, cooldown,
  resource cost, damage/effect, and — explicitly called out — a proper
  library of skill animations to choose from, not just the current
  generic windup/effect/recovery burst.
- This is probably the single biggest lift on this list. It likely needs:
  - A defined animation *vocabulary* (e.g. melee swing, cast-and-project,
    self-buff pulse, ground-target AoE, channel/beam) that character rigs
    can support, since the current chibi generator has no skeleton/rig —
    it's rigid geometry groups. Rich per-ability animation may require
    revisiting the character generator to support actual bone-based
    animation rather than the current whole-mesh transform tricks.
  - Worth scoping as its own sub-phase given the size.

### 9. Custom icon uploads — done for items (2026-07-09), abilities not started
- Items: `POST /api/items/icon` (multer, `server/index.js`) accepts an
  image, stores it under `public/assets/icons/` with a generated filename,
  and returns the URL for the item's `iconUrl` field. 2MB limit, image
  mimetypes only.
- Abilities don't have icons authored anywhere yet — that's blocked on
  item #8 (ability authoring) existing at all, not on the upload mechanism
  itself, which this item's work already covers and would just be reused.

### 10. Generalized instance/portal system (added after Phase 6 fixes)
- Right now, both the Tower (Phase 5) and the store interiors (added post-Phase-6)
  are each their own **hardcoded** instancing system: fixed bounds, a fixed
  spawn/exit point, a fixed room-scoped Socket.io channel, built by hand in
  server code and (for the tower) JSON floor files.
- The ask: generalize this into an actual World Editor feature — the ability
  to author a new "instance" (a separate small map, its own bounds/geometry),
  place an **entrance point** in the main world that teleports a player into
  it, and place furniture/NPCs/monsters inside using the same placement
  tools already in the editor. This is exactly what would let Dennis build
  custom dungeons, shop interiors, or any other separate space by hand,
  instead of each one needing bespoke server code the way the tower and
  store currently do.
- Concretely this probably means:
  - An `instances/*.json` schema similar to `tower/floors/*.json`, but generic
    (not tower-specific) — bounds, spawnPoint, and free-form placement data
    (props, buildings, NPCs, monsters) using the *same* placement/monster/NPC
    editor tools as the main world, just targeting a different file.
  - Entrance points become a placeable **object type** in the editor (not
    tower-specific logic) — place one in the main world, link it to an
    instance file and that instance's spawnPoint, and the server generically
    handles the room-scoped teleport/state-sync dance that's currently
    duplicated between the tower and store code paths.
  - An exit point (or a generic "leave instance" affordance) inside the
    instance, linking back to a specific point in the main world.
  - This would let the Tower's per-floor system and the store's interior
    system both be rewritten as two *instances* defined through this same
    generic system, rather than being special-cased — worth doing that
    consolidation once this exists, so there's only one instancing
    implementation to maintain instead of two (soon three, once dungeons
    are added) hand-built ones.
- This item is a natural companion to item #4 (monster placement via the
  editor) and item #6 (item system) from above — once instances are
  editor-authored, dungeon design becomes "place an entrance, place a
  monster/furniture/NPC layout inside," which is a lot of this roadmap's
  other asks converging on one underlying capability.

### 11. Custom model import (FBX/glTF) and per-region/combat audio (added after visual-quality discussion)
- **Model import — DONE for FBX (2026-07-12), glTF still open.** Built as
  `src/generators/modelLoader.js` (`THREE.FBXLoader` + `SkeletonUtils.clone`)
  + `src/sim/models.js` (catalog schema). Upload endpoint
  (`POST /api/models/upload`, files under `public/assets/models/`), a new
  "Imported Model" placement section in the World Editor's Place mode
  (dropdown + click-to-place, same position/rotation/scale data as every
  other prop), and a measured (not guessed) collision footprint — see
  `PROJECT_STATUS.md`'s "FBX model import" handoff for the full design,
  including the async-loading wrinkle (every other prop builder is
  synchronous) and why import scale is user-set rather than assumed.
  **glTF/GLB (`GLTFLoader`) was NOT added** — Dennis explicitly asked for
  FBX this time; the roadmap's original preference for glTF as the long-term
  target still stands if that comes up. Would reuse the exact same
  `modelLoader.js` machinery (placeholder + async-load-event + measure
  pattern), just a second loader class.
  - Character animation ceiling: **not addressed by this pass.** Imported
    models are placed as static (or ambient-animation-only, e.g. a turning
    windmill) scenery props — no skeleton/animation retargeting into the
    class/ability/combat system. That remains a separate, much bigger
    undertaking.
- **Audio**: Web Audio API (Three.js wraps this as `THREE.Audio` /
  `THREE.PositionalAudio`, though plain non-positional playback doesn't
  even need the wrapper). Three pieces:
  - **Per-region music**: natural fit with the existing zone system —
    crossfade to a zone's assigned track as the player's position enters
    it.
  - **Combat music**: needs a defined "am I in combat" signal to trigger
    the switch (ability use, monster aggro, taking damage are all real
    events already firing that could drive this state).
  - **Sound effects**: one-shot triggers off events that already exist —
    `onAbilityUsed`, `onGatherResult`, `onCraftResult`, hits, etc.
  - **Known constraint**: browsers block audio autoplay until the user
    interacts with the page, so this needs a "click to enter" gate
    somewhere rather than assuming audio can just start on page load.
- Both of these generalize the same pattern as item #9 (custom icon
  uploads for items/abilities) — an upload pipeline plus a new asset type
  the editor can place/assign — just extended to 3D models and audio.

### 12. Editor performance & UX polish (added after the July 8 wishlist)
- **Zoom/pan slowness — root-caused and partially fixed already**: the
  directional light's shadow camera had no explicit frustum, so it fell
  back to Three.js's tiny ±5 unit default, which never covered the world
  properly, and every shadow-casting object paid the shadow-pass cost
  regardless. Fixed: the editor now disables shadows entirely (it's an
  authoring tool, not the final view — shadow fidelity matters far less
  there than framerate while placing hundreds of scattered objects), the
  live game's shadow camera now has a real sized frustum instead of the
  default, and tree foliage no longer casts shadows (trunks still do) since
  foliage was the biggest per-tree shadow-draw multiplier once scatter
  brushing made placing hundreds of trees trivial. Worth revisiting further
  if scatter-brushed scenes keep growing: the real long-term fix is
  instancing repeated geometry (one draw call per prop *type*, not per
  instance) rather than each scattered tree/rock/flower being a fully
  separate mesh group — a bigger generator-library refactor than today's
  fix, flagged here rather than done today.
- **Brush radius indicator — done**: a white ring on the ground now shows
  the active brush's radius in both Scatter and Terrain modes, visible on
  hover before you even start drawing.
- **Object size + randomizer — done for the scatter brush**: min/max scale
  sliders control the random size range instances are scattered at.
  Individual (non-scattered) placed objects already had a single scale
  slider from Phase 3; a min/max *range* specifically for one-at-a-time
  placement wasn't asked for but could be added trivially if wanted.
- **Delete a single object by clicking it — already existed**: click to
  select, then either the Delete button in the panel or the Delete/Backspace
  key. Worth double-checking this reads as discoverable enough in practice;
  a right-click "Delete" context menu was considered but skipped for now
  since right-click is already claimed by camera-orbit and distinguishing
  a right-click from the start of a right-drag reliably adds real
  complexity for a small UX gain over the existing flow.
- **Brush delete — done, and generalized**: Scatter mode's shift-drag erase
  now has a checkbox to erase *any* prop type within the brush (not just
  whichever type is currently selected in the palette), including walls.
- **Better UI overall** (the reference screenshot showing a bottom
  icon-toolbar with numbered hotkeys): a real visual/UX pass on the editor
  chrome itself — worth doing, but it's a design/polish task independent of
  any of the functional items in this document, and probably makes most
  sense once more tool tabs exist (paths, doors, triggers, etc. from below)
  so the redesign accounts for the final tab count rather than being redone
  each time a new tool is added.

### 13. Collision — **DONE 2026-07-10 (overworld statics)**
- Built as `src/sim/collision.js`: circle colliders for trees (trunk only —
  you walk under canopies), rocks and custom Object Builder props; OBB
  colliders for building footprints and wall segments; grass and flowers pass
  through, exactly the per-type split this item asked for. Colliders live in a
  16-unit spatial grid; `resolveMovement` sweeps the step in sub-steps (no
  tunneling) and slides along what it hits.
- Server-authoritative, as required: the tick loop resolves player movement,
  overworld monster chase, and NPC wander against the index. The client's
  prediction step calls the *same* pure function on an index it builds from
  the same `world.json` + object catalog, so the two can't disagree. The
  index rebuilds on every `POST /api/world` and `POST /api/objects`.
- **A collider is never a hand-tuned guess.** A tree's radius is its actual
  trunk radius, read from the same seeded draw the mesh is built from. That
  required moving the generators' parameter sampling down into
  `src/sim/propMetrics.js` (pure, Three-free) with the generators reduced to
  "build meshes from this descriptor" — so changing how a tree looks moves its
  collider automatically. Geometry was verified byte-identical across that
  refactor.
- **Still open:** tower floors and the store interior pass no collision index
  (they're bare rooms with nothing in them to hit) — wire them up when they
  grow props. No entity-vs-entity collision: players and monsters still walk
  through each other. Terrain slope/height is not a collider either.
- **Invisible walls** are now cheap: they're a wall segment with no mesh. The
  `walls` array already produces OBB colliders; an editor mode that places one
  without a render pass is all that's missing.

### 14. Paths, walls/fences as a drawn line, and bridges
- **Pathways — DONE (2026-07-11).** `world.paths[]` (`src/sim/paths.js`),
  a click-or-click-drag spline tool in a new "Paths" World Editor mode,
  rendered as a Catmull-Rom-smoothed, terrain-following ribbon
  (`src/render/pathMesh.js`) in 4 themes (`src/render/pathThemes.js`).
  Doubles as nav-graph-ready data (ordered waypoints per path) for the
  still-unbuilt "NPCs prefer roads" item, per Dennis's own explicit
  scoping. See `PROJECT_STATUS.md`'s night-session handoff.
- **Walls/fences and rivers as a drawn line — still not built.** The
  pathway tool above was NOT generalized into a shared spline primitive
  (scope was paths only, per session discipline) — a future pass could
  factor `pathMesh.js`'s points-to-ribbon logic out for fences/rivers to
  reuse, but that refactor hasn't happened.
- **Walls/fences drawn as a line**: today's Phase 3 wall tool places one
  straight segment per click. A line-drawing version would let you drag
  a wall/fence along an arbitrary path and have it auto-place/auto-rotate
  segments to follow it — same underlying spline tool as pathways/rivers.
- **Bridges**: naturally follows once water + paths exist — a bridge is a
  path segment placed to cross a water area, probably its own prop type
  (a static mesh) rather than needing anything procedural, positioned
  where a path crosses a river/lake region.

### 15. Trigger events and interaction ("switch") events
- **"If player moves here, teleport to instance X"** — this is exactly
  what item #10 (generalized instance/portal system) already covers: an
  entrance-point placeable object linked to a target instance. Not a new
  system, just that system's core use case stated explicitly.
- **"If player interacts with object X, do Y"** — this is a genuinely new
  ask beyond #10: a general-purpose interaction/scripting layer, where a
  placed object can be tagged with a triggerable behavior (open a door,
  give an item, start a quest, play a sound, etc.). Realistically this
  needs a small, constrained set of built-in "do Y" actions authored via
  the editor (dropdowns/fields), not free-form scripting — free-form
  scripting is a much bigger (and riskier, from a security/sandboxing
  standpoint, since the server would be executing it) undertaking than a
  fixed menu of "give item / open door / start quest / play sound /
  teleport" style actions.
- Chests, keyed doors, and lootable trees/flowers (items below) are all
  specific *instances* of this same general interaction-event system —
  worth building the general system once rather than as one-off features.

### 16. Loot, chests, and keyed doors
- **Monster loot tables**: what a monster type drops and at what chance —
  extends the monster definitions from item #4 (monster placement via the
  editor) with a drop table, same shape as the gathering yield tables that
  already exist in `src/sim/gathering.js` (item + chance), just attached
  to monster types instead of gathering nodes.
- **Chests and other loot objects**: a placeable object type that, on
  interact, grants an item (or rolls a loot table) — an instance of the
  interaction-event system above (item #15) with a "give item(s)" action.
- **Keyed doors**: a door object that checks the interacting player's
  inventory for a specific key item before allowing passage — needs the
  item system (#7) to exist first (for the key item to reference), plus
  the collision system (#13) so a *closed* door is actually solid and an
  *opened* one isn't.
- **Lootable props (trees/flowers etc.)**: a checkbox on a placed prop
  marking it "lootable" plus which item it grants — same interaction-event
  mechanism again, just triggered on a prop instead of a dedicated chest
  object.

### 17. Map rendering & atmosphere options
- A real environment/post-processing settings panel per map: skybox,
  environment background, light color, shadow strength, ambient color,
  fog, cloud shadows, exposure, and a full post-processing stack (SSAO,
  bloom, depth of field, LUT/color grading).
- Weather/time-of-day: sunshine, rain, storm, snow, day/night cycle —
  likely a combination of lighting changes (sun angle/color/intensity)
  plus particle systems (see item #18) plus, for rain/storm specifically,
  probably a screen-space shader effect rather than pure particles for
  it to read well.
- This is real rendering-engineering work: SSAO/bloom/DOF/LUT specifically
  require Three.js's `EffectComposer` post-processing pipeline, which
  isn't part of this project at all yet — worth scoping as its own
  sub-phase rather than folding into general "editor polish," since it's
  a rendering-architecture addition, not an editor-UI addition.

### 18. Particle effects
- **Dust, snow, rain, wind, sand — DONE (2026-07-11), plus fireflies and
  miasma beyond the original list.** Not tied to item #17's atmosphere
  presets as this item originally guessed — instead configurable per
  ground-texture-painted region: painting a texture layer (item #6a) can
  also tag it with a `particleType`, and `src/render/ambientParticles.js`
  spawns one `THREE.Points` system per tagged layer, confined to that
  layer's painted shape. Live-game-only (editor stays a static blockout
  view). Storm was added as an eighth type beyond the original five. See
  `PROJECT_STATUS.md`'s night-session handoff.
- Still open: no true per-region *atmosphere* tie-in (item #17, e.g.
  weather changing sky/fog/lighting) — this is ambient particles only.
- **Placeable point effects — DONE (2026-07-26).** The region-based
  weather above could only ever fill an area with one drifting particle
  type; there was no way to say "a campfire burns *here*". Particles mode
  in the editor (hotkey V) places `world.particleEmitters[]` entries —
  one of 35 looping effects (campfire/bonfire/torch, glitter, rune
  circles, portals, will-o'-wisps, fireflies, pollen, falling leaves,
  tornado, dust devil, waterfall mist, steam, chimney smoke, light
  shafts, ...) with an authored size, density, two colours, height
  offset and activation radius. Effects run live in the editor, are
  streamed in/out around the camera in game (`src/render/
  worldParticles.js`), and can carry a pooled dynamic light. Catalog:
  `src/render/vfx/worldEffects.js`; schema: `src/sim/particleEmitters.js`.

### 19. Object recoloring — done (2026-07-08, tint math fixed 2026-07-09)
- A color picker sits alongside rotation/scale in the Place tab's Selected
  Object panel (`sel-color` in `public/editor.html`). `applyColorTint`
  (`src/render/scene.js`) retargets each material's hue+saturation to the
  chosen color while keeping that material's own original lightness — so a
  tree's dark trunk and bright foliage both become the chosen color at
  their own brightness, instead of one flat color. (First version used a
  multiply tint, which can only ever darken a material toward the target —
  a red flower has almost no blue channel, so multiplying by purple still
  came out red. Switched to HSL hue/saturation replacement to fix that.)
  Works on any prop (tree/rock/flower/grass, including scatter-placed ones
  — they're selectable in the Place tab like any other prop). White
  (#ffffff, the default/Reset value) means "no tint" and isn't written to
  `prop.color` at all, so untouched props stay exactly as their generator
  made them.
  Walls are excluded (flat stone material, not worth tinting) and buildings
  weren't in scope for this pass.

### 20. Spawn points
- **Player's first-ever spawn point**: already exists — `world.spawnPoint`
  in `world.json` — just not currently editor-configurable; it'd be a
  placeable marker like any other editor object.
- **Respawn point per map**: the tower's respawn-on-death logic already
  exists (Phase 5 Part 2) but is hardcoded to the tower's entrance point.
  Generalizing this to "each instance/map defines its own respawn point"
  is a natural extension once item #10's generalized instance system
  exists — respawn point becomes just another field on an instance
  definition instead of a tower-specific constant.

### 21. Monster/NPC stat definition — mostly done (2026-07-08)
- HP, attack, speed, aggro/attack range, attack cooldown, boss flag, and
  XP reward are all authored per-monster through the Monsters mode (item
  #4's editor), for both tower floors and the overworld. XP reward is
  optional — blank uses the maxHealth-scaled formula in
  `src/sim/leveling.js`, filled in overrides it.
- Still missing: **level** and **defense** aren't modeled anywhere in the
  monster system at all (only players have levels), and **abilities** —
  monsters only have a single flat melee-style attack (damage/range/
  cooldown), no ability set. Ability assignment for monsters would reuse
  the same ability data shape from item #8 (ability authoring) once that
  exists, just applied to monsters instead of player classes.



- Does quest/inventory persistence mean it's time to wire up Prisma for
  real, or is a simpler file/in-memory store acceptable for a while longer?
- Should monster placement stay tower-only, or is this the point where
  monsters might exist elsewhere in the world?
- Is a full skeletal animation rig for characters in scope, or should
  "a lot of skill animations" mean a bigger *library of the current*
  transform/burst-style effects (faster to build, less visually rich)?
- What counts as "decorative objects" — a bounded list would help scope the
  environment-generator work realistically.

## Suggested phasing (rough, to be revisited when we start)

1. Item schema + basic item authoring UI + icon upload (self-contained,
   doesn't depend on anything else here).
2. Environment expansion: flowers/stones/decorative props in the placement
   palette, mountain terrain brush presets, river tool.
3. More building types.
4. NPC placement + dialog authoring.
5. Quest authoring + quest state tracking (needs NPC system from #4 first).
6. Monster placement UI (can slot in independently, doesn't block on
   anything above).
7. Ability authoring + animation library (biggest, do last once everything
   else has established patterns for editor-driven content + persistence).

This ordering is a guess at dependency order and effort, not a commitment —
re-evaluate once the current build (through Phase 9) is actually finished,
since priorities may shift.

One dependency worth flagging now, from the July 8 additions (items #13-21):
collision (#13) and the interaction-event system (#15) are prerequisites for
a good chunk of the rest — chests, keyed doors, and lootable props (#16) all
need both to exist first. If those get greenlit, they probably belong
earlier in the order than this original sketch implies, not tacked on at
the end.


---

## Idea backlog added 2026-07-09 (Dennis brain-dump — not started, capture only)

A large batch of ideas raised at once. Grouped by kind. None started; each
awaits an explicit go-ahead. The part-based-editor / builder items are
modeled on **MMORPG Tycoon 2**, screenshots of which Dennis supplied as the
design reference (Character Type Editor with Abilities / Model Editor tabs;
the Scenery placement editor).
### A. Bugs / cleanups to fix — all 3 done (2026-07-09)
- **Weird ring around the city — DONE.** It was `buildCityWallPlaceholder`'s
  `TorusGeometry` (a floating stone donut) drawn by `buildWorldMeshes`.
  `buildWorldMeshes` (live game) now renders only the tower zone; the city
  ring is skipped. The editor still shows it via its own `rebuildStatic`.
- **Zone "colored ground" not in the live game — DONE.** `buildZoneMarker`'s
  translucent disc + ring is likewise skipped by `buildWorldMeshes` now
  (editor-only, kept in the editor's `rebuildAll`).
- **Auto-move bug — DONE.** Root cause: a movement key held while the window
  lost focus never got its `keyup`, so `keys.w/a/s/d` stuck `true`. Added
  `window blur` + `visibilitychange` handlers that clear all movement keys
  (`clearMovementKeys` in `src/main.js`).

### B. Quest-system follow-ups (from the prior 2026-07-09 note)
- Questlog changes (Dennis to specify what — ask before building).
- Optional **turn-in dialog**: author a completion line the NPC says on
  hand-in (quest schema field + editor field + show on turn-in).
- **Minimap**, possibly pulled forward now, with an option to **show the
  quest region** (highlight where the objective is). Implies quests /
  monster groups may need an associated area to point at.
  (These three are also tracked in memory `quest-system-next-changes`.)

### C. Social / progression features
- **Right-click another character → context menu** with "Invite to party"
  and "Chat." Replaces/augments the current P-key nearest-player invite with
  a proper target-click UX, and introduces a **chat system** (none exists yet
  — CLAUDE.md Phase 9 lists say/party/guild channels).
- **Guild system** with a daily activity reward loop: each monster killed
  gives +1 guild activity; at 50 / 100 / 250 activity thresholds, all guild
  members can claim a reward (e.g. gold). Separate from the party system
  (parties are transient groups; guilds are persistent membership). Note:
  "daily" + persistent membership strongly implies real persistence
  (Prisma), which is still stubbed.
- **Drawable PvP zones** — regions where players can fight each other
  (needs the freeform-zone drawing below + a PvP combat rule toggle).

### D. Editor / authoring features
- **Freeform zone drawing:** draw a zone's shape "accurately" by dragging the
  mouse (vs the current click-center + drag-radius circle). Enables
  non-circular zones, and is a prerequisite for per-zone data like **music
  per zone** and the drawable PvP zones above.
- **Monster respawn rate — DONE (2026-07-09), overworld only.** Overworld
  monsters now respawn at full health at their home position
  (`spawnPosition`, captured at load time since `position` itself gets
  mutated by AI chase movement) after `respawnMs` elapses — 30s default
  (`DEFAULT_MONSTER_RESPAWN_MS` in `server/index.js`), optional per-monster
  override editable in Monsters mode. Tower floor monsters are deliberately
  excluded — a cleared floor staying cleared is the intended dungeon
  mechanic, not a bug. Verified with a live socket test: killed a monster
  with `respawnMs: 2000`, confirmed it respawned at t=2.0s exactly, at full
  health, at the exact home coordinates.
- **Monster size and color — DONE (2026-07-09).** Scale slider + color-tint
  picker added to Monsters mode's stat form (`mon-scale`/`mon-color` in
  `public/editor.html`), reusing the exact `applyColorTint` HSL hue-shift
  from prop recoloring (#19) — no new color math needed. Applied at every
  monster mesh build site: editor placement/apply/floor-load (both overworld
  and tower floor), and the live game client (`src/main.js`, both overworld
  and tower floor monster spawn). Fields are plain optional properties on
  the monster spawn object (`scale`, `color`), so they flow through
  `world.json` / floor JSON / the socket broadcast with zero schema changes
  — `validateMonsterSpawns` was never an allowlist.
- **Export/import presets — deferred, tied to the section E "builder"
  vision.** A prop/monster/NPC preset system (save-as-template, load-into-
  form) was prototyped and shipped 2026-07-09, then reverted the same
  session — Dennis clarified this was meant for **later**, once the
  part/shape-based builder (section E below) exists, not as a standalone
  feature on top of today's parametric generators. Revisit this alongside
  section E rather than picking it up on its own.

### E. The "builder" vision — MMORPG Tycoon 2-style (large, coupled cluster)
This is a major direction shift, not a single feature: moving from the
current fixed parametric generators toward **compositional, part/shape-based
building**. Dennis supplied MMORPG Tycoon 2 screenshots as the reference.
These items are tightly coupled and should be scoped together as their own
multi-phase effort.
- **Object Builder — MVP shipped (2026-07-09).** A new World Editor mode
  (hotkey "B") for composing an object from primitive shapes (box/cylinder/
  sphere/cone) on a small local-origin grid workspace: click a shape to add
  it, drag to reposition (grid-snapped, plane-raycast), edit position/
  rotation(Y-axis)/per-axis scale/solid color via number fields, save the
  result as a named reusable object to a new catalog
  (`objects/objects.json`, `GET`/`POST /api/objects`, mirrors the items/
  quests pattern). Saved objects place in the world via Place mode's new
  "Custom object" dropdown as a `type: 'custom'` prop — they **coexist**
  with the parametric generators, nothing about existing props changed.
  `buildPropPlaceholder` (shared by the editor and the live game client)
  gained one new branch; the live client fetches the catalog once and
  renders placed custom props identically to the editor. New generator:
  `src/generators/custom.js` (`buildShapeMesh`/`generateCustomObject`),
  new validator `src/sim/objectDefs.js`. Verified end-to-end: built a
  2-shape object, saved/reloaded the catalog, edited and re-saved an
  existing entry, placed an instance, confirmed it renders via the live
  game client (not just the editor).
  **Deliberately deferred** (per-shape bending/deformation, per-shape image
  textures, a wedge shape, true face/socket snapping — plain grid-snap only)
  — this was scoped as an MVP specifically so Monster Builder and the
  Character Creation rework can reuse the same shape-composition pipeline
  next, rather than each building its own. Export/import presets (the
  roadmap's other "builder vision" prerequisite item) is still explicitly
  deferred to whenever this pipeline is revisited next — see that item's
  own entry above.
- **Animation system — generalized (2026-07-09).** `updateWalkCycle` was
  hardcoded to character.js's 4 named limbs; monsters had zero animation of
  any kind. New `src/generators/rig.js`: `GAIT_TABLES` (declarative per-
  stance swing tables — `biped`, matching character.js's existing rig
  exactly, plus `quadruped`), `applyIdlePose`/`applyGaitPose`/
  `applyAttackPose`, all generic over "whatever named parts a rig has."
  `updateWalkCycle` is now a thin wrapper — verified numerically identical
  to the old hardcoded math (diff ~1e-15) — zero behavior change for
  players. This is the prerequisite the Monster Builder below needed to
  make monsters poseable at all.
- **Monster Builder — shipped (2026-07-09), scoped close to the
  screenshots.** A tabbed modal (General / Model Editor [Slots + Settings]
  / Abilities / Prefabs) — the first modal-dialog UI in this codebase
  (`src/editor/modal.js`, a small reusable `createTabbedModal` helper),
  launched via "Manage Monster Types" in Monsters mode. Authors a reusable
  monster **type** (`monster-types/monster-types.json`, `GET`/
  `POST /api/monster-types`, mirrors the items/objects pattern), separate
  from a placed spawn instance — same split as Object Builder's catalog vs.
  placed props.
  - **Model Editor → Slots**: per-body-part pickers (head/torso/tail/armL/
    armR/legL/legR for humanoid; head/torso/tail + 4 legs for quadruped),
    each with its own shape composition using the *same* box/cylinder/
    sphere/cone palette as Object Builder (adaptation flag: no pre-made
    variant thumbnails exist — every part is still hand-composed from
    primitives, just organized per body region now). Renders in its own
    small isolated Scene/Camera/Renderer (mirroring character-creation's
    pattern) rather than the shared editor canvas, since the modal overlays
    it. New `buildMonsterRig` (`src/generators/monsterRig.js`) turns
    author-defined slots into real poseable pivots — auto-derived anchor
    per role/stance, fine-tunable, no manual pivot placement required.
  - **Model Editor → Settings**: Stance (humanoid/quadruped), Preview
    Animation (idle/walk/attack — actually drives the live rig in the
    Slots workspace via Phase A's gait system), and a derived "cannot use
    weapons: not humanoid" warning (informational only — no monster
    weapon-attachment system exists to actually gate, flagged honestly
    rather than implied as functional).
  - **Abilities**: a fixed level ladder (2,4,…,20, a UI convention, not
    derived from player-leveling data) gated by `configuredLevel` — an
    authoring dial ("what level is this monster balanced for"), not a
    runtime stat monsters progress through. Ability shape reuses
    `classes.js`'s `AbilityDef` fields (cooldown/windup/effect/recovery/
    kind/power) plus `unlockLevel`. Restricted to melee/ranged in this pass
    (no heal/buff — `stepMonsterAI` has no ally-targeting to support them).
  - **Prefabs**: explicitly a "coming soon" stub, not implemented — save/
    apply reusable slot-level shape presets, deferred as a fast-follow
    since it's the least-specified part of the screenshots.
  - **Combat integration**: `stepMonsterAI` rewritten for multi-ability
    selection (first off-cooldown ability in priority order, no resource-
    pool gating since monsters have none) — verified via a scripted test
    exercising 30 ticks against two abilities of different cooldowns, zero
    cooldown violations, correct priority-yielding behavior. **Legacy
    spawns with no catalog type (slime/goblin/boss-golem, or any hand-
    authored spawn) synthesize a single legacy ability from their existing
    `damage`/`attackCooldownMs` fields — zero data migration, verified
    byte-identical damage/behavior to the pre-existing system.** Monster
    attack VFX reuses `triggerAbilityAnimation` unmodified via a new
    `monster-ability-used` socket event (mirrors `ability-used` for
    players) — the first time monsters have ever had ability VFX.
  - Monsters mode's `#mon-type` dropdown now lists catalog types alongside
    the 3 legacy hardcoded ones; picking one pre-fills the stat form from
    the type's `baseStats` (a placed spawn instance keeps its own
    overrides on top, same as `type:'custom'` props already do).
  - **Not migrated**: slime/goblin/boss-golem stay code-defined, not
    converted into catalog entries — this feature shipped additively.
  - **UI overhaul (2026-07-09, same day, follow-up).** Dennis's hands-on
    testing found the first pass's Model Editor layout genuinely broken —
    content overflowed both directions, normal scrolling meant grabbing
    what looked like slider tracks. Root cause: nested flex containers
    were missing `min-height: 0` (flex items default to refusing to shrink
    below content size), and separately a `<canvas>` element is a "replaced
    element" that resists shrinking below the pixel dimensions
    `createRenderer()` set on it (`window.innerWidth`/`innerHeight`)
    unless `min-width: 0` is forced explicitly — both are classic, easy-to-
    miss flexbox gotchas. Rebuilt as a real two-pane layout (fixed-width
    live 3D preview on the left, a tabbed part editor on the right —
    Head/Torso/Tail/Arms/Legs/Settings in one row, replacing the old
    wrapping button list) with only the right column's own content
    scrolling. Added a **built-in preset library**
    (`src/generators/monsterPresets.js`): ~5 shape-composition variants per
    body-part category (head/torso/tail/arm/leg) and 4 full starter
    creatures (Slime/Goblinoid/Wolf/Bird), each rendered as a **real**
    thumbnail (a small dedicated offscreen renderer + `toDataURL()`,
    cached per session) rather than a flat icon — clicking a part preset
    replaces that slot's shapes wholesale, a color-swatch row recolors a
    whole part at once, and the previously-primary manual shape palette
    now lives behind a collapsible "Adjust manually" toggle. Shipped
    built-in only (not user-savable) per Dennis's call. The live preview's
    camera also switched from a fixed hand-tuned position to a bounding-
    box-based auto-frame (same `THREE.Box3` approach as the thumbnails),
    since the new preview pane's aspect ratio (tall and narrow) made any
    fixed camera position frame-dependent and easy to get wrong.
  - **Content + shape-vocabulary pass (2026-07-09, follow-up 2).** Dennis
    found the first prefab set too sparse — parts floated disconnected and
    there were only 4 starter creatures, well short of the reference's
    library feel. Three changes: (1) **3 new primitive shapes** —
    `capsule`, `pyramid`, `wedge` (`src/generators/custom.js`'s SHAPE_KINDS
    + geometryForKind; wedge is an ExtrudeGeometry triangular prism). (2)
    **Full 3-axis rotation** per shape — buildShapeMesh now honors an
    optional `rotation:{x,y,z}` degrees object (backward compatible with
    the old Y-only `rotationDeg`), and the Adjust panel exposes X/Y/Z
    rotation fields; this was the single biggest quality lever, letting
    parts angle (snouts tilt, horns sweep, spider legs splay) instead of
    only spinning on Y. (3) **14 detailed creature prefabs** rewriting
    `monsterPresets.js`: Slime, Goblin, Wolf, Spider, Gnome, Bat, Golem,
    Skeleton, Serpent, Bird, Rat, Bear, Myconid, Imp — each authored so
    parts overlap into one readable silhouette (floating parts were the
    old failure), with non-standard body plans (spider's 8 legs, snake's
    coil) packing extra static detail into the torso slot since the rig
    only has ≤4 leg slots. Part presets also expanded (head 7, torso 6,
    tail 5, arm 5, leg 5) using the new shapes/rotation. Verified: all 14
    validate + build into rigs (16-22 meshes each), render as recognizable
    thumbnails, and a save/reload round-trip preserves rotation objects +
    new shape kinds. Still primitive-composed (not the reference's
    hand-modeled fidelity — an honest ceiling of this approach), but now
    each creature clearly reads as itself.
  - **Connectivity guardrail (2026-07-09, follow-up 3).** Dennis reported
    that despite the richer prefabs, parts were *still* floating detached,
    and asked for "a long term solution to prevent this from happening in
    the future." Root cause: limb slot `anchor`s were placed out in space
    beside/below the torso rather than on its surface, leaving real gaps —
    and the bug is structurally invisible while editing a single body-part
    tab, so screenshots kept missing it. Built
    `src/generators/monsterConnectivity.js` (`findDetachedSlots` — assembles
    the real rig, compares each slot's world bbox to the torso's, returns
    every floating part with its gap distance) plus
    `scripts/check-prefabs.mjs` / **`npm run check:prefabs`**, which also
    re-runs the schema validator and exits non-zero on any detachment. The
    baseline was **37 detached slots across 14 creatures**; re-authored all
    anchors onto the torso surface (humanoid hips ~torso-bottom with legs
    reaching the ground, arm anchors just inside the torso's x-edge) to
    reach **0**. The check is also wired into the editor's Save Monster
    Type button as a non-blocking warning naming the offending slots, so a
    hand-built monster warns at authoring time. Guard verified in both
    directions: deliberately re-detaching the goblin's arm makes the script
    fail with the exact slot + gap, and a connected save reports a clean
    `Saved ✓`.
  - **The guardrail was wrong, then made right (2026-07-09, follow-up 4).**
    Dennis reported parts were *still* detached despite the checker saying
    PASS. It was: that first checker compared per-SLOT **bounding boxes**
    with a 0.05 tolerance, which is the wrong instrument. An imp arm sitting
    0.045 outside its torso slipped under the tolerance; an eye floating in
    front of a head lived inside the head's own slot and so was never
    compared to anything. It reported a confident green light on visibly
    broken creatures. Rewritten to test **per-shape solid overlap**:
    point-in-primitive tests for box/sphere/cylinder/cone/capsule/pyramid/
    wedge, union-find over "these two solids interpenetrate", and a creature
    is connected only when every shape joins the torso's component. The new
    checker is itself unit-tested against known-good/known-bad pairs
    (including a reproduction of the floating-eye bug) — *validate the guard
    before trusting it* was the actual lesson. Under the honest check the
    roster scored **91 detached shapes**; re-authored to **0** by putting
    every limb anchor INSIDE the torso solid, starting each limb with a
    joint sphere at its origin, and placing head details on the head's real
    surface via a `surf()` helper (non-uniform scale makes eyeballed offsets
    untrustworthy — a capsule scaled {0.32,0.48,0.26} has an x-radius of
    just 0.112). Verified in the editor on the exact creatures Dennis
    flagged: rat, spider, imp, bat.
  - **Per-type walk animation (2026-07-09, follow-up 5).** Dennis asked
    whether he could author animation per monster, noting the spider only
    moves 4 legs. Two separate limits were found. (1) `SLOT_ROLES` has only
    four leg roles, so the spider's other four legs are static shapes baked
    into the torso — geometry, not joints. (2) `buildMonsterRig` hardcoded
    `GAIT_TABLES[stance]`, so a monster type carried no animation data and
    every quadruped walked identically. Fixed (2), which also exposed a
    latent bug: **tail/head/wing slots were always rig pivots but no gait
    table ever named them, so they never moved.** `MonsterTypeDef` gained
    an optional `animation: { walk: [{part, axis, amplitudeDeg, phaseDeg}] }`
    (author-facing degrees, converted to radians by
    `gaitTableFromAnimation`); `resolveGaitTable()` in `monsterRig.js` picks
    the authored table or falls back to the stance default, and is used
    identically by the editor preview and the live game so they can't drift.
    A **Walk Animation** panel in the Model Editor's Settings sub-tab gives
    an axis/amplitude/phase row per animatable slot, plus reset-to-stance-
    default. `applyIdlePose` was fixed to zero *every* rig pivot rather than
    only parts named in the two built-in tables (it would otherwise leave a
    wagging tail stuck mid-swing). Also: **monsters never animated in-game
    at all** — `updateWalkCycle` was only ever called on players and NPCs.
    `main.js` now routes monster positions through `applyRemotePosition`
    (movement detection + facing, the same helper remote players use) and
    runs the walk cycle for overworld and floor monsters. Verified:
    resolution + degree→radian conversion + zero-amplitude pruning by unit
    test; a wagging-tail wolf round-tripped through the server validator;
    the validator rejects bad axis / non-numeric amplitude without
    corrupting the catalog.
    **Still open:** all 8 spider legs would need extra/free-form leg slots
    (touches the role enum, validator, default anchors, part-tab UI). And
    this is a procedural sine gait, not keyframes — a timeline/clip editor
    would be its own planning pass.
- **Character/NPC overhaul — PASS 1 DONE 2026-07-10.** The schema, rig and
  weapon system landed; see `PROJECT_STATUS.md`'s handoff for detail.
  - Monsters, NPCs and characters share one `CreatureTypeDef`
    (`src/sim/creatureTypeDefs.js`); `monsterTypeDefs.js` is now a façade over
    it, so no data migrated.
  - `src/sim/weaponTypes.js` + `src/generators/weapon.js`: 12 fantasy weapon
    types, each with a grip (weapon-in-hand) and a hold pose (what the arms do).
    `creatureRig.js` derives `handL`/`handR` attach points so a weapon swings
    with the arm; `applyGaitPose` composes over a base pose so a bow arm stays
    extended while walking.
  - `src/generators/characterPresets.js`: humanoid part library + 10 prefabs
    (5 classes + Warlock, and 4 townsfolk). `/creatures.html` previews them all.
  - **Still open:** the Character/NPC Builder modal UI (generalize the Monster
    Builder's Model Editor rather than copy it; the weapon-type checkbox grid in
    the screenshots is `allowedWeaponTypes`); separate hair/hat slots; and
    swapping the live game's players/NPCs off `generateCharacter`, which the
    character-creation UI still depends on.
- **Overall graphics transition** to this shape/part building system — i.e.
  the whole game's art pipeline moves onto it (relates to the earlier
  "improve graphics" thread; the real gap was flat primitive geometry, which
  this addresses). Not started — natural follow-on once Character Creation
  is reworked too.
- **Place & Scatter reworked** like screenshot #5: a bottom category toolbar
  with numbered slots, scenery **categories** (Small Plants, Large Plants,
  …), and a richer brush **properties panel** — Pattern (e.g. Hexagon),
  Brush Radius %, Density %, Variation %, Angle + Angle Variation, Scale +
  Scale Variation, Overwrite toggle.

**Scoping note:** E is by far the biggest thing on this whole document — it's
an engine/pipeline shift that subsumes several existing systems (character
generation, environment generators, the Place/Scatter tools) and pulls in the
animation system. It should get its own planning pass and probably a
prototype before committing, rather than being started piecemeal.
