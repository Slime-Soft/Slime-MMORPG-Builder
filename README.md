![Logo](assets/preview/logo.png)

# Slime MMORPG Builder

Concept of a MMORPG Builder written in Java



\# Slime MMO-Builder



Slime MMO-Builder is a work in progress no-code MMO Builder written in JavaScript with Three.js, Express, and Socket.IO. Everything needed can be created directly inside the Builder. Character Models, Monsters and Animations, Buildings and Structures and more! You can already edit an entire Map, add Quests, Items, Monsters, Dungeons, you can Craft Items, Gather stuff, create parties and create more advanced events via the Events System and much more!



This repo is both a playable demo map and the toolchain that built it: a full \*\*World Editor\*\* plus dedicated \*\*Building\*\*, \*\*Character/NPC\*\*, and \*\*Skill\*\* builders that a non-programmer could use to design new content — buildings, monsters, spells, terrain, quests — entirely through the browser, with live 3D previews and no code changes required.

![Ingame](assets/preview/ingame.png)

You can however NOT create an actual MMO for this now. There are still many features missing to make this possible, like a proper netcode, saved character progression etc. which will come at the very end. But as for now, you basically have everything you need to 



\## Architecture at a glance



\- \*\*Sim / Render / Net split\*\* — gameplay logic (`src/sim/`) is pure, host-agnostic JavaScript with no DOM/Three.js/socket dependencies, so the exact same simulation code runs on the authoritative Node server and predicts client-side. Rendering (`src/render/`, `src/generators/`) and networking are separate layers. An architecture guard (`npm run check:arch`) enforces this split automatically.

\- \*\*Server-authoritative\*\* — the Node/Express/Socket.IO server (`server/`) owns world state, movement, combat, and collision; clients predict and reconcile.

\- \*\*Everything is data\*\* — buildings, monsters, items, skills, quests, NPCs, recipes, ground textures, and world layout are all JSON catalogs under version control, edited through the builder UIs described below.

\- \*\*Procedural-first content\*\* — nearly every visual asset (trees, rocks, characters, monsters, buildings, weapons, VFX) is built from primitive shapes and shaders at runtime, so new content is authored, not modeled in an external DDCC tool.



\## The World Editor (`/editor.html`)

![Builder](assets/preview/editor.png)

The World Editor is the central authoring surface — a live 3D view of the map with a mode toolbar down the side. Each mode below is a first-class editing tool with its own panel:



\- \*\*Place\*\* — hand-place individual props, imported models, and custom Object Builder shapes one at a time.

\- \*\*Scatter\*\* — brush-paint props (trees, rocks, flora) across an area with density/radius controls.

\- \*\*Terrain\*\* — raise/lower/flatten terrain with brush presets, including a "Flatten (brush area only)" tool.

\- \*\*Water\*\* — a four-way tool: paint legacy water, place resizable rectangular \*\*Lakes\*\* (numeric Position/Width/Depth fields, drag handles, edge rounding), draw sloped \*\*Rivers\*\* (click-polyline with per-point surface height, flowing current shader), and quick-place \*\*Puddles\*\*. Water is solid/collidable; depth shading is computed from real terrain height, not paint alpha.

\- \*\*Zones\*\* — circular or freeform (hand-drawn polygon) regions tagged with music/ambient audio (crossfading Web Audio) and particle effects.

\- \*\*Buildings\*\* — place structures authored in the Building Builder.

\- \*\*Monsters\*\* — place monster spawns, and open the full \*\*Monster Type Editor\*\* modal (see below) to design creature types in place.

\- \*\*Items\*\* — author the item catalog: armor types, equip slots, weapon-type references, and craftable recipes.

\- \*\*NPCs\*\* — place NPCs and author branching dialog trees (multi-choice, in addition to simple linear dialog).

\- \*\*Quests\*\* — author quests, including prerequisite chains (`requiresQuestId`) and turn-in flow; quest status icons (yellow `?`/grey `?`/yellow `!`) appear over NPC heads in-game.

\- \*\*Paths\*\* — draw roads/trails as smoothed ribbon meshes that follow terrain slope, with 4 tileable themes (basic/desert/snow/forest).

\- \*\*Mountains\*\* — draw a ridge stroke that both raises terrain and lays an opaque textured rock ribbon on top (avoids the texture-painting seam problem).

\- \*\*Ground Textures\*\* — paint terrain textures, including uploading custom textures.

\- \*\*Object Builder\*\* — assemble one-off custom props from primitive shapes directly in the editor, for content that doesn't need a full catalog entry.

\- \*\*Maps\*\* — manage multiple maps/zones and the teleporters that connect them, including dungeon instancing.

\- \*\*Teleporters\*\* — place map-to-map (or in-map) transition points.

\- \*\*Events\*\* — a full visual scripting system for cutscenes and interactive objects, in the spirit of RPG Maker/Bakin's event editor. Any placed object (an NPC, prop, teleporter, or gathering node) — or an invisible standalone trigger volume — can own an \*\*Event Object\*\*, triggered by talking to it, interacting with it, walking into a zone, or a switch turning on. Each event object holds one or more \*\*sheets\*\*: independent command scripts, each with its own optional precondition (a switch, item count, quest completion state, or quest phase) and its own "run once" flag. At trigger time, the first sheet whose precondition passes and hasn't already used up its run-once is the one that plays — which is what lets a single quest-giver NPC deliver a different line before/during/after a quest without a tangle of nested branches, since each phase is just a separate sheet.

&#x20; - \*\*26 command types\*\*, editable as a visual list per sheet: dialog (`showDialog`, with branching player choices), inventory (`giveItem`/`takeItem`), state (`setSwitch` — global or self-scoped to the event, `branch` on switch/item/quest conditions), pacing (`wait`, optionally showing a cast bar), movement/visibility (`moveTo`, `setVisible`, `teleportPlayer`), player stats (`hp`/`mp`/`exp`/`gold`), feedback (`playSound`, `shakeScreen`, `fadeScreen`), progression (`learnSkill`, `setPlayerControl` to lock movement for a cutscene), quest hooks (cosmetic `startQuest`/`completeQuest`/`updateQuestObjective` log entries, or `acceptQuest`/`turnInQuest` which drive a real quest from the Quests catalog), and world systems (`openMerchantStore` with per-item price/stock and a sell multiplier, `openCraftingStation`, `scheduleRespawn` for a gathered node to reappear, `rollGatherYield` to roll real loot from a gathering-node table).

&#x20; - A dedicated \*\*"Give a Quest" panel\*\* auto-generates the whole 4-sheet offer/active/ready/done script from a single quest description, so the common "NPC hands out and collects a quest" case never needs the raw sheet/command editor at all — that stays available for anything more custom.

&#x20; - Every command and reference (item ids, quest ids, switch ids, attached object ids) is structurally validated on save, so a malformed or dangling script is caught by `npm run check` rather than failing silently at runtime.

\- \*\*Recipes\*\* — author crafting recipes (inputs, outputs, requirements).

\- \*\*Particles\*\* — place ambient world particle emitters (fire, magic, nature, weather, water, smoke/dust, light — 35+ effects) that stream in/out as the player approaches, with per-emitter color, intensity, radius, and optional dynamic light.



A corner minimap and full-map overlay (toggle `M`) render a live top-down view with a directional arrow to the active quest objective.



\## Monster Type Editor (inside the World Editor)



A tabbed modal for designing creature types, with a live 3D preview:



\- \*\*General\*\* — id, name, and base stats (HP, damage, speed, attack cooldown, aggro range, attack range).

\- \*\*Abilities\*\* — a per-level ability ladder / moveset.

\- \*\*Model Editor\*\* — per-body-part tabs, each with a preset grid, whole-part recolor swatches, manual anchor (position) fields, and a 7-shape palette (box/cylinder/sphere/cone/capsule/pyramid/wedge) with full position/rotation/scale/color/opacity control per shape.

&#x20; - \*\*Settings\*\* — humanoid vs. quadruped stance, animation preview selector, and sine-wave gait tuning (amplitude/phase per body part).

&#x20; - \*\*Keyframe Animation\*\* — hand-authored Walk/Idle/Attack clips: per-body-part tracks, keyframes with position/rotation/scale offsets and normalized time, live preview.

\- \*\*Prefabs\*\* — starter creature bodies (all slots + stance) as a base for further customization; validated for part connectivity by `npm run check:prefabs`.



\## Standalone builder tools



\### Building Builder (`/buildings.html`)

Two-mode Three.js editor for structures:

\- \*\*Parts mode\*\* — build reusable pieces (Wall, Roof, Window, Door, Trim, Other) from a primitive-shape palette, with per-shape editing.

\- \*\*Assemble mode\*\* — compose buildings from the part catalog (or raw shapes) with numeric footprint fields, full transform gizmos (move/rotate/scale), and orbit/pan/zoom navigation.



\### Character \& NPC Builder (`/characters.html`)

Live body editor for both playable classes and NPCs:

\- Per-body-slot editing (anchors, shape presets, individual primitive shapes) shared with the Monster Type Editor's shape UI.

\- Main/off-hand weapon assignment, weapon model import (FBX/GLB upload with scale + hand-slot config), and a grip/pose tuner with a "copy snippet" export.

\- Class Skills panel to assign skills from the Skill Builder's catalog to a class.



\### Skill Builder (`/skills.html`)

The most elaborate authoring tool — full spells with real particle VFX and animation:

\- Identity (name, description, icon, cast sound), costs/cooldown/cast-time, targeting shape and range, multiple stacked effects per skill, and level-scaling breakpoints.

\- \*\*Custom VFX Library\*\* — author new particle effects from 7 base shapes (Burst, Sparkle Burst, Ring, Aura, Cloud, Stream, Fall) with full color and parameter control.

\- \*\*Timeline editor\*\* — a scrubbable track for pose keyframes (grab and rotate a body part live in the preview), VFX events, and draggable VFX anchors (e.g. pin an effect to a weapon tip).

\- \*\*Test Dummies\*\* in the live preview to aim and play the full windup → cast → effect → recovery sequence with real VFX before saving.



\### Character Creation (`/character-creation.html`, player-facing)

The in-game screen players use at signup: live rotating 3D preview, body type/gender/hair/eyes/expression dropdowns with color swatches, a randomize button, and class selection cards.



\## VFX system



Skill and world VFX are built from layered, physically-motivated particle systems (via `three.quarks`) rather than single soft-dot sprites — flash + core burst + decelerating sparks + shockwave + smoke + debris, with HDR color grading that survives the bloom post-process pass. `npm run check:vfx` headlessly builds every effect variant and fails on common defects (invisible tone-mapped particles, leaked one-shot systems, sub-pixel particle sizes).



\## Tech stack



\- \*\*Client\*\*: vanilla JS + Three.js (no framework), custom procedural generators for geometry/materials/animation.

\- \*\*Server\*\*: Node.js, Express, Socket.IO — authoritative simulation, world persistence, asset upload endpoints.

\- \*\*Validation\*\*: a suite of `npm run check:\*` scripts (architecture boundaries, prefab connectivity, prop/collision consistency, VFX correctness, import hygiene) that run headlessly, no browser required.



\## Getting started



```bash

npm install

npm start

```



Then open `http://localhost:<port>` to play, or `/editor.html`, `/buildings.html`, `/characters.html`, `/skills.html` for the builder tools.



\## Status



This is an actively developed solo project. See `PROJECT\_STATUS.md` for a detailed, honest session-by-session log of what's built, verified, and still in progress, and `WORLD\_BUILDER\_ROADMAP.md` for the feature backlog.



