# Fantasy MMO — Project Overview & Status

This is a full, honest snapshot of the project as of today: what's actually
built and working, what's known to be missing or broken, and a concrete
recommendation for what to tackle next. Written to be handed to a fresh
Claude Code session (or read by a future you) without needing to
reverse-engineer progress from the code alone.

For the original spec, see `CLAUDE.md`. For the full backlog of planned
World Editor features (and a large 2026-07-09 idea dump), see
`WORLD_BUILDER_ROADMAP.md`. This document sits above both — it's the
"where are we, and what next" summary.

---

## Placeable light sources — editor Lights mode (2026-08-02)

Every map was lit by exactly one directional light plus a hemisphere ambient
(`graphicsSettings.light` / `.ambient`, see `src/render/atmosphere.js`). That's
right for a field and useless for anything enclosed — a cave, a cell block, a
cellar, the inside of a cage got the same flat sky term with no falloff, no
pool of warm light, no dark corners. A torch prop with no light beside it is a
decal.

**`world.lights[]`** now holds placed point/spot lights, authored in the World
Editor's new **Lights** mode (hotkey `I`, badge I):

- Per light: colour, **strength**, **area of effect** (a hard radius — this is
  what keeps a torch inside its own cell instead of glowing through the wall
  behind it, since the shading model has no idea walls exist), falloff decay,
  absolute height, flicker amount + speed, activation radius, optional shadow
  casting. Spots add cone width, edge softness, and a yaw/pitch aim.
- 13 presets (Wall Torch, Campfire, Brazier, Candle, Forge Coals, Hanging
  Lantern, Room Fill, Magic Crystal, Rune Glow, Cursed Glow, Ceiling Spot,
  Shaft of Daylight, Corridor Wash). A preset is a starting point copied into
  the map — every field stays editable afterwards.
- Each light gets an authoring gizmo (bulb + wireframe sphere at its exact
  radius + a spot's real cone + a dropline to the ground), shown only in
  Lights mode. The lights themselves shine in every mode, which is the point —
  you place the props a torch lights from Place mode.

**The constraint that shaped the runtime.** three.js compiles the *number* of
lights into every material's shader program, so adding a light, removing one,
toggling `visible`, or flipping `castShadow` recompiles everything visible.
`src/render/worldLights.js` therefore builds a fixed pool once and *binds*
authored lights to slots as the camera moves — position/colour/distance/
intensity are plain uniforms and free to change; an unbound slot sits at
intensity 0 rather than being removed. Caps: 8 point + 4 spot lit at once
(nearest wins), and 2 shadow-casters total across the whole map, in their own
sub-pool (a shadow-casting point light is six render passes). Editing a light
in the editor only rebuilds the pool when the *shape* changes — i.e. only the
shadow checkbox, not any slider.

Files: `src/sim/lightSources.js` (schema, presets, aim/flicker maths),
`src/render/worldLights.js` (pooled runtime), `world.lights` validation in
`src/sim/world.js`, overworld + per-map wiring in `src/main.js`, and Lights
mode in `src/editor/main.js` + `public/editor.html`.

Not done: no lights are authored into any existing map yet, and the placed
particle emitters' own dynamic lights (`src/render/vfx/lights.js`) remain a
separate pool — a campfire emitter and a campfire light source are still two
things you place.

---

## Tower reworked into an Event (2026-08-02)

The tower is no longer its own content pipeline. It's now an ordinary Event
Object command — **Open Tower Dungeon** in the Event Builder's command list —
whose floors are ordinary maps:

- Each floor row = a name ("Red Desert"), a **map** picked from the manifest,
  and a clear condition: *defeat N monsters* and/or *defeat this specific
  monster* (a dropdown of that map's own spawn ids). Both optional; a floor
  with neither clears the moment you walk in.
- Interacting with the event opens a floor list — `Floor 1 - Red Desert
  [Enter]`, `Floor 2 - Shadow Plains [Locked]`, … Floor 1 is always open;
  every later floor needs the previous one cleared by *that player*.
- Meeting a floor's condition pops "Proceed to Floor N - X?" (Proceed / Stay).
  The last floor offers Leave Tower instead. A HUD strip shows the live
  kill/boss count and a Leave Tower button.
- Every floor is entered as a **party-scoped dungeon instance** regardless of
  the map's own mapType, so two parties never share monster state.

Progress is per-player, keyed by the event object's own id (so two towers
never share unlock state), and lives in memory for the session — like every
other player state here, it dies with the connection until persistence lands.

Files: `src/sim/towerDungeon.js` (schema + predicates), the
`openTowerDungeon` command in `src/sim/events.js`, `tower-*` sockets +
`enterTowerFloor`/`checkTowerFloorCleared`/`leaveTowerRun` in
`server/index.js`, the panel/HUD/prompt in `src/main.js` + `public/index.html`,
and the floor editor in `src/editor/main.js`.

Fixed alongside it: dying on a non-default map (a floor, or a building
interior) left the player bound to the map/instance they died in — respawn
now hands them back through `movePlayerToMap`.

**The old tower is dead but not deleted.** `tower/floors/*.json`,
`src/sim/tower.js`'s `IFloor` schema, the `enter-tower`/`advance-floor`
sockets and the `type:'tower'` zone are all still in the tree and still load,
but no map has a tower zone anymore, so `TOWER_ZONE` is null and the entrance
is unreachable. Removing that code is a clean, separate cleanup — don't build
anything new on it.

---

## Trade buildings rebuilt reference-first (2026-08-02)

All seven were withdrawn on 2026-08-01 (see below) and have now been rebuilt one
at a time, each from a written transcription of its reference in `references/`:
blacksmith, tailor, carpenter, alchemist, jeweller, church, bakery. All are back
in the Buildings palette tab.

**The process change that mattered.** A massing spec is now written BEFORE any
code, and written as a *transcription of what is visible, region by region* —
not as a description of what the building "is". The first blacksmith attempt had
a spec, and it still failed, because the spec said "stone forge hall, front open,
roof on piers" and none of that was in the image. Naming a region ("a second
closed wing") is safe; naming a concept ("forge hall") imports everything you
already believe and silently overwrites the reference. Each spec ends with a
numbered identity-feature list and an explicit NON-features list of things
earlier attempts invented.

**Two new gates, both from defects Dennis found by hand:**

- `npm run check:parts` — floating geometry. Welds vertices to recover the
  original primitives, unions them by bbox overlap, and fails any island that
  touches neither the ground nor the model. Found the blacksmith's bellows and
  quench trough, the alchemist's condenser coil, the dragon statue's wings and
  the fountain's jets — all of which had shipped "verified".
- `npm run check:embedded` — doorway blocked, or geometry buried in a wall.
  Caught the blacksmith's ridge chimney sitting 98% inside its own roof, the
  alchemist's bottle shelf standing in the doorway, and the bakery's peel inside
  the left wall.

Both are in `npm run check` (now 6 checks). Neither is visible to `check:props`
(it all builds and stands on the ground) or `check:zfight` (overlapping volumes
share no plane).

**`public/asset-check.html`** renders any prop through the game's own renderer,
atmosphere, `toonify()` and bloom chain — `?types=a,b` or `?category=buildings`,
with Bloom/Toon/Shadow toggles so a defect can be attributed rather than
guessed at. The Node rasteriser (`scripts/prop-sheet.mjs`) has no bloom and
missed a bakery whose entire facade was blown to white in game.

## City wall rebuilt + 26 town-dressing props + a headless model viewer (2026-07-31)

Dennis wanted "more assets to make the town more lively and nicer" plus
"fancier city walls", from five reference sheets, and — importantly — a
**testing environment so the models could actually be checked**, since
`npm run check:props` proves a prop builds and collides correctly and cannot
tell you the roof has a hole in it.

### 1. `scripts/prop-sheet.mjs` — the model viewer (build this first, next time)

A labelled PNG contact sheet of any props, any angles, rendered by a software
rasteriser in pure Node — no browser, no GPU, no WebGL, so it works from a
backgrounded tab (which pauses rAF and breaks screenshots — see
`feedback_hidden_tab_pauses_raf`). Each cell carries a **1.8 m human figure**
and prints the prop's metre dimensions and triangle count.

```bash
node scripts/prop-sheet.mjs bench fountain --out sheet.png
node scripts/prop-sheet.mjs --category defenses --out defenses.png
node scripts/prop-sheet.mjs citywall-gate --views 3q,front,side,eye
```

The rasteriser was extracted out of the existing `scripts/render-prop.mjs` into
`scripts/lib/softRaster.mjs` (magenta background, so a hole reads as sky;
neutral grey checkered ground at 1 m per square, so a green roof gap can't be
mistaken for grass showing through).

**It paid for itself immediately.** Every one of these was invisible in the
code, invisible to `check:props`, and obvious in one render:
- the round flowerbed's kerbstones were rotated `-a` instead of `-a - PI/2`, so
  they pointed radially and the bed came out as a cog;
- the dragon statue's neck was tilted `-0.55` about X, swinging it backwards
  while the head sat forwards — a floating head;
- the produce stall's awning was tilted `-TILT`, so it sloped UP towards the
  customer with the front post dangling half a metre beneath it;
- the dovecote's four roof slabs each needed a different rotation ORDER and
  three.js applies one fixed Euler order, so it rendered as a black bowtie;
- the spike row leaned 36-45° and read as logs lying on the ground.

### 2. The city wall (`src/generators/environment/cityWall.js`)

`generateWallSegment` was one box plus a row of 0.7 m cubes. It is now a
parametric kit — battered base, proud course bands with staggered vertical
joints (ashlar, not a slab), cross-shaped arrow loops with lintel and sill, a
cornice on corbels, capped crenellations, hanging heraldic shields, and end
piers that hide the kink between two ring segments. **Parametric on the
length/height/thickness `world.walls[]` already stores, so the entire existing
ring upgraded with no data migration.** ~960 tris a segment.

It is deliberately **front/back symmetric**: a wall's `rotationDeg` was
authored for tangency and nothing in the data records which side faces out, so
a decorated outer face would come out inside-out on half of any future ring.

New props: `citywall-tower` (round, 18.7 m), `citywall-watchtower` (square
archer tower with a timber hoarding), `citywall-gate` (18.6 m gatehouse, open
doors, raised portcullis, banners), plus `barricade`, `spikes`, `guard-post`,
under a new **"Walls & Defenses"** palette tab.

**Bug found and fixed on the way**: `buildWallSegmentInstance` never passed
`wallSeg.thickness` to the generator, so every wall in the world was DRAWN 1 m
thick (the default) while its collider used the authored 2.6 m — a 0.8 m
invisible shelf either side of every wall in the city.

### 3. 20 town-dressing props (`src/generators/environment/townLife.js`)

Garden/plaza: `flowerbed-round`/`-square`/`-long`, `hedge`, `statue-knight`,
`statue-dragon`, `fountain-scalloped` (a quatrefoil basin, a different
silhouette from townDecor's octagonal one, not a restyle), `pergola`.
Street life: `flower-cart`, `wagon`, `sacks`, `trestle-table`, `wooden-chair`,
`laundry-line`, `produce-stall` (a lean-to, so a row of it and `market-stall`
reads as a market rather than one stall copy-pasted), `dovecote`.
Stone: `stone-fence`, `bridge-stone`, `wayshrine`, `gravestones`.

`pergola` and `laundry-line` have no collider (you walk under them);
`bridge-stone` declares a **walkable deck at exactly `PLATFORM_STEP_UP`**, so
it needs no ramp piece the way the pier does. It is deliberately NOT arched
despite the reference — an arch only reads if its crown clears the deck
soffit, and this deck's soffit is 10 cm off the ground.

### 4. Placement — the ONLY thing placed on Dennis's behalf

`node scripts/place-city-wall-kit.mjs world/maps/asteria.json` derives the ring
from the wall data itself (radius, step, where the gaps are — nothing
hard-coded), then adds **4 gatehouses** (one per gap, at 0/90/180/270°),
**8 towers** (2 per wall run, so the four sides match), and **8 invisible pier
walls** fencing each gatehouse's solid halves while leaving the 4.6 m archway
walkable — the same pattern the Great Tower's gate piers already use. It
removes its own previous output first, so re-running is idempotent.

`world/maps/silverspire.json` has the identical 40-segment ring and was left
alone; the same one command applies it there.

### Verified

`npm run check` clean (149 prop types / 149 builders). `check:zfight` — all 10
coplanar-face failures the new props introduced are fixed; the 32 that remain
are pre-existing (houses, workstations, `banner-pole`, `cabin-log`, `ore-cart`).
Every new prop rendered and inspected at 3/4 and at player eye level, plus the
whole ring from above and the north gate from 21 m out. Collision verified
numerically: **72/72 assertions** — all four gate passages walkable at ±1.5 m
across and ±4 m through, both piers blocking at each, towers blocking, curtain
still blocking between them. `parseWorld` accepts the written map.

### Follow-up after Dennis's first in-game pass (2026-08-01)

He screenshotted the north gate from inside and reported three defects, all
real, none catchable by any existing check:

1. **"entrance has a gap"** — the gatehouse's two base courses reached y = 1.2
   but its jambs started at `batterH = 1.4`. A **20 cm slot ran straight
   through the building at knee height**, on both sides of the arch. `batterH`
   is now 1.05, so the jamb starts 15 cm inside the course it stands on.
2. **"weird black thing hanging inside the door on the right"** — the passage's
   barrel vault. `THREE.CylinderGeometry` lays its shell at
   `x = r·sin(theta), z = r·cos(theta)`, so `thetaLength = PI` gives the **+X
   half, not the top half**; laid on its side it became a 4.3 m black half-tube
   down the right-hand wall. meshKit's `cyl` gained an `arcStart` parameter
   (default 0, so nothing else moved) and every half-cylinder in the new code —
   two tower doorways, the gate vault, the wayshrine niche, a gravestone head —
   now passes `PI/2`. **Worth knowing: this trap applies to every arch head in
   the library.**
3. **"bottom part of the flags look weird"** — the banner points were 3-sided
   cones, i.e. solid triangular pyramids wider than the cloth they hung off.
   Now a flat square turned 45°, the same trick the shields use.

### Buildings (2026-08-01) — the miss from the first pass

He then pointed out the buildings couldn't be placed. Audited it: **all 26 props
were correctly registered** (`propTypesIn`/`buildProp` both resolve, the palette
is fully data-driven off `PROP_CATEGORIES`, so the new "Walls & Defenses" tab
appears by itself). The truth was simpler — **the first pass shipped no
buildings at all**, and the reference sheets are mostly buildings. That scoping
decision was never stated in the handover, which is the actual mistake.

Added `src/generators/environment/tradeBuildings.js` — 7 placeable Buildings-tab
props: `bld-church`, `bld-blacksmith`, `bld-bakery`, `bld-tailor`,
`bld-alchemist`, `bld-jeweler`, `bld-carpenter`.

**Architecture — shell + dressing.** Each shop is `buildTownhouse(...)` plus a
bespoke meshKit dressing group. A `townhouse.js` preset is just different
numbers, and numbers cannot tell a baker from a jeweller; what identifies these
in the reference is the STUFF ON THEM — a forge chimney the width of the facade,
a copper still coiling over the roof, bolts of cloth in the street, a log pile
and a saw horse. This keeps the shell identical to the houses already on the
street while making the trade readable across a square. `gableGeo`,
`addWindow`, `addWindowOn` and `addDormer` are now exported from townhouse.js
for it. The church is built outright — a nave, tower and spire share nothing
with a half-timbered box.

The church wraps its geometry in an offset group: the nave is authored about
z=0 but the tower pushes it 13 m to +Z and 7.7 m to -Z, so its true centre is
2.7 m forward of its origin. Left alone it would swing in a wide arc whenever
an author rotated it. The offset has to go on a WRAPPER — the renderer
overwrites the returned object's own position.

**Known, deliberately not fixed:** the six shops inherit the townhouse shell's
pre-existing `check:zfight` failures. Verified as identical material pairs to
`house-wide` and `bld-store` (glass vs a framing stud, timber vs plasterUp,
timber vs foliage), so they are no worse than the 13 buildings already shipped.
Root cause: **`addFraming` places studs every ~1.25 m regardless of where
windows are, so a stud crossing a window puts its face in the glass plane.**
Fixing that in townhouse.js would clear all 20 buildings at once, but it changes
the look of 13 already-placed ones, so it wants Dennis's eyes first.

**Not yet Dennis-verified in a real session** — the software rasteriser is a
shape viewer, not the game's renderer: no shadows, no toon ramp, no bloom. How
the new stone reads under the real sun, and whether the wall's two-tone
coursing is too strong once toonified, needs his own pass.

---

## VFX overhaul + placeable world particles (2026-07-26)

Dennis: the skill VFX were "very underwhelming", and he wanted to be able to
put particles directly into the world (glitter, a tornado, fire, glowing
things). Both halves are done.

### Why the old skill VFX looked flat (the actual diagnosis)

Every preset was ONE emitter of the same soft dot. Three things followed from
that, and all three are fixed in `src/render/vfx/presets.js`:

1. **Nothing was ever brighter than the ground.** Colours were plain LDR and
   the materials were tone-mapped, so a "fire" impact was a pastel orange
   smudge that the bloom pass never touched. Gradients now run
   white-hot → colour A → colour B with the first stops pushed above 1.0
   (`boost`), and every VFX material is `toneMapped: false` so that overshoot
   survives to the bloom pass instead of being crushed by the ACES curve in
   the material's own shader.
2. **Every effect faded IN.** The old alpha envelope ramped 0 → 1 over the
   first quarter of a particle's life, softening the one frame that sells an
   impact. Alpha is now full at birth and decays.
3. **No layers.** Effects are now stacks: a flash at the moment of contact,
   a core burst, decelerating velocity-aligned sparks (`SpeedOverLife` drag —
   constant-speed particles read as a mechanical spray), a hard-fronted
   shockwave, normal-blended smoke (additive smoke can only ever brighten the
   screen), and tumbling debris. The recipes `impactFx`/`novaFx`/`castFx`/
   `projectileFx`/`slashFx`/`stormFx` compose those layers, so the PRESETS
   table is mostly one line per effect.

Plus **dynamic light**: `src/render/vfx/lights.js` is a fixed pool of 4
PointLights that effects borrow — a pop for an impact, a held (flickering)
one for a campfire or a channelled aura. It's a POOL because three.js bakes
the scene's light count into every material's shader program, so genuinely
adding/removing a light recompiles every visible material — a hitch on every
cast. The pool is created once on first use and only ever has its uniforms
changed.

New sprites in `textures.js` (glow/flare, smoke puff, shockwave front, melee
crescent, rune circle, 4-point twinkle, debris chip, beam) — the old library
was dots, stars and silhouettes only, which is why everything looked related.
**Every preset id is unchanged**, so `skills/skill-defs.json` and
`vfx/custom-vfx.json` needed no migration; only what each id builds changed.

### Placeable world particles (editor Particles mode, hotkey V)

- `world.particleEmitters[]` (`src/sim/particleEmitters.js`) — id, effectId,
  position, scale, intensity, colour A/B overrides, activation radius, light
  on/off. Validated by `parseWorld`, so the server rejects malformed data the
  same way it does for every other authored field.
- **35 effects** in `src/render/vfx/worldEffects.js`, grouped Fire / Magic /
  Nature / Weather / Water / Smoke & Dust / Light. Adding one is a single
  entry there and it appears in the editor palette automatically.
- `src/render/worldParticles.js` streams them: an emitter spawns when the
  camera comes inside its activation radius and is disposed when it leaves
  (with hysteresis so the boundary can't chatter), capped at 24 simultaneous
  emitters, nearest-first. Without that, every campfire in the city would run
  while you're out in the forest.
- The editor runs the real effects live (not a stand-in gizmo) through the
  same streaming runtime — a small wireframe marker at each origin is the
  click target, hidden outside Particles mode.

### New invariant: `npm run check:vfx`

`scripts/check-vfx.mjs` builds all 241 effect variants headlessly (canvas
stubbed) and fails if any emits nothing, forgets `autoDestroy` on a one-shot
(which leaks a system per cast), is tone-mapped, has no texture, or blows the
particle budget. It self-tests its matchers against known-bad input first.
It caught a real bug immediately: `Math.round(count * intensity)` silently
rounded small layers to ZERO particles the moment an author dragged an
emitter's density below ~0.4 — now clamped by `emitCount()`.
`three.quarks`/`quarks.core` were added as devDependencies (with
`--legacy-peer-deps`; they want three ≥0.182, the game pins 0.164) purely so
this can run under plain Node — the browser still loads them from the
importmap.

### Round 2, same day: Dennis looked at it and it still wasn't good

His report: "the fire doesn't look like fire, they all have some white
particles whose color can't be changed, many have some square glowing effect."
All three were real defects, and none of them were visible from the JS side —
they were only findable by rendering sprites and effects and LOOKING at them
(done by pushing frames out of the browser to PNGs, since a backgrounded tab
won't screenshot). What each turned out to be:

- **"White particles whose colour can't be changed"** — `hotGradient`
  hardcoded a pure-white first colour stop, so every particle of every effect
  was born white and only reached its authored colour a third of the way
  through its life. Now the core is `lighten(colorA, whiteHot)`, with
  `whiteHot` a per-builder (and authorable) knob: ~0.45 for a flash, 0.08 for
  fire. Removed the hardcoded white layers in `projectileFx`/`slashFx` too.
- **"Square glowing effect"** — two independent causes stacking. (1) Seven
  sprites had alpha 127-161 still sitting on their canvas border, so the
  particle quad cut the shape off flat. (2) Every sprite generated mipmaps,
  and a mipmapped additive sprite averages to a uniform bright block when it's
  small on screen. And the worst offender was the **beam** sprite, which was
  simply a rectangle to begin with — used by every holy beam, light shaft and
  portal. All sprites now go through `makeSprite()`, which feathers the edge
  and turns mipmaps off; `check:vfx` enforces it.
- **"The fire doesn't look like fire"** — four separate mistakes, fixed in
  order: a bezier teardrop sprite (read as a *water droplet*; now ~30
  overlapping low-alpha gradient blobs with no outline anywhere), a scalar
  `startSize` squashing the tall sprite into a square quad, `height` being fed
  to `ForceOverLife` as if it were metres when it's an acceleration (the fire
  was a flat puddle — a campfire's licks travelled 0.5m), and far too few, too
  large licks to ever merge into a mass (now ~90/s at 0.48 size, plus a
  core-glow layer that fills the dark gaps between licks).

Two more bugs surfaced while looking: **`SizeOverLife` multiplies `startSize`
rather than replacing it**, so every ground ring in the project had been
rendering at a tenth of its authored radius (a "radius 4.5" Frost Nova was
0.45 units across — which is exactly why an old comment in presets.js
concluded that flat rings "read as showing nothing"); and stacked additive
beam quads at 0.75 alpha blew the entire frame to white. Both fixed, with the
ring radii retuned to real metres. The unit traps are written up in
`CLAUDE.md` since they're quarks-wide, not fire-specific.

### Round 3: "barely visible, and as soon as I raise them they disappear"

Rounds 1 and 2 were both judged against a DARK preview background. In the
actual sunlit city every placed effect was a faint smudge, and raising one put
it against the sky where it vanished completely. Three causes, all of them
things a black backdrop hides:

- **Additive blending cannot compete with a bright background.** Adding 0.3 of
  orange to a sunlit stone path changes nothing. Fire now has a
  normal-blended, opaque body layer (`getFlameBodyTexture`) carrying its shape
  and colour, with the additive layers on top for glow; physical motes
  (leaves, petals, snow, pollen, dust, bubbles) are normal-blended too, since
  they're objects rather than light; the remaining glow effects (glitter,
  fireflies, wisps, embers) got their `boost` raised to 3-4, because *bright*
  additive still reads in daylight while dim additive can't.
- **Opaque isn't enough if the colour matches the background.** The flame body
  started at the authored pale yellow and was still invisible on a pale path.
  It now starts at a saturated orange (`mixColor(colorA, colorB, 0.45)`) and
  leaves near-white to the small additive core. The core glow was also
  saturating to white over bright ground and swallowing the body, so it's much
  dimmer now.
- **The mote effects were pixel-sized.** They shipped at 0.07-0.22 units —
  5-20cm sprites, one to three pixels at a normal 8-15m camera. All bumped
  ~2.3x, and `check:vfx` now FAILS any world effect with particles under 0.12
  units (it caught three more inside `firePreset` immediately).

Also fixed: dragging an emitter slider rebuilt the effect on every mouse-move,
so it flickered instead of resizing — the rebuild is debounced now.

### Verified

Headlessly: all 258 effects and sprites build and pass the guard;
`parseWorld` accepts real map data with
emitters and rejects every malformed variant; the server returns 400 on a bad
emitter without writing. In-browser (numerically, via `window.__editor` /
`window.__skillBuilder` — a backgrounded tab pauses rAF, so counts beat
screenshots): placing a campfire in the editor spawns systems + a pooled light
that follows it, walking away releases both, 8 simultaneous skill effects
produced 21 live systems / 132 particles, and after 5s only the 7 looping
systems remained (every one-shot self-reaped).

Visually (round 2): every sprite was rendered to a contact sheet and inspected,
and campfire / torch / bonfire / fire impact / frost nova / fire ring / holy
pillar / green-tinted glitter were each rendered through a bloom composer at
the game's own bloom settings and inspected. Fire now reads as fire, rings as
expanding waves, beams as columns, and an authored colour survives all the way
through.

Visually (round 3): the same effects re-checked **inside the real editor scene
in daylight** — the sunlit city, at 6m and 13m, at ground level and raised 5m.
That is the only view that would have caught any of round 3's bugs, and it's
the view to use from now on. **Still worth Dennis's own pass in-game** — a
still frame can't judge motion, and there are 79 presets, of which about a
dozen have been eyeballed.

---

## Real water system: Lakes are now a resizable box, terrain carving removed entirely (2026-07-24, fifth round)

Dennis was clear this time: not "adjust the auto-fit," but stop auto-
fitting altogether. He wanted to place water, then resize/reposition it
himself with plain numeric fields "like in the buildings editor" (really:
the Object Builder's shape panel — Position/Scale fields, select-then-edit
— since Buildings themselves don't have post-placement resize), and no
terrain modification at all, since carving was the actual source of the
"ugly holes."

- **Lakes are now a plain axis-aligned rectangle**, placed with one click
  (arm "Place Lake", click the ground — same pattern as Buildings/Object
  Builder placement) and edited entirely via numeric fields: Position X/Y/Z,
  Width, Depth, Max Depth (visual only). The old click-multiple-points
  freeform draw tool and draggable corner handles are GONE — a lake is a
  box now, full stop. `src/editor/main.js` regenerates the 4 corner
  points fresh from Position+Width+Depth on every field change
  (`computeLakeRectPoints`); `points` in the saved JSON is unchanged
  (still a plain polygon), so old freeform/migrated lakes still load and
  render, they just snap to a rectangle the first time their fields get
  touched.
- **Terrain carving is gone completely** — `carveWaterBodyBasin` (lakes)
  and `carveRiverChannel` (rivers) both deleted from `src/sim/
  waterBodies.js`/`src/sim/rivers.js`, along with every call site. Placing
  or editing water no longer touches `world.terrain.heights` at all, for
  either lakes or rivers. Depth-shading still works exactly as before
  (`surfaceLevel - realTerrainHeight`, sampled from the same terrain-height
  texture) — it just now reflects whatever the ground naturally is,
  instead of a carved basin.
- **Rivers keep their point-by-point path authoring** (a path can't
  sensibly be "a box"), including drag-to-reshape and the Phase 4 bank-
  height render clamp — just with all carving stripped out too, and the
  raise/lower nudge from last round unchanged.
- **Verified**: placed, resized, repositioned, and nudged several lakes via
  the exact same code paths the UI calls, and confirmed `world.terrain.
  heights`' checksum was BYTE-IDENTICAL before and after all of it — direct
  proof nothing touches the terrain anymore, not just "looks unmodified."
  Confirmed a clean editor boot with the new Lake panel present. `npm run
  check` clean throughout.
- **Not yet Dennis-confirmed in a real session** — the natural next check
  is placing a lake, resizing/positioning it to fit a real hillside by
  eye, and confirming it now looks right with no gap and no leftover
  terrain scarring from past carving attempts (an OLD lake/river placed
  before this change may still have carved terrain sitting under it from
  earlier sessions — that's real terrain data, this change doesn't undo
  past carves, only stops future ones).

---

## Real water system: swim mechanics scrapped for manual fit + solid collision (2026-07-24, fourth round)

Dennis called it: after three rounds of auto-fitting attempts (skirt
walls, river bank-clamp, lake auto-sample) still didn't look right to him
and were burning a lot of session budget, he asked to stop chasing
automatic terrain-matching and instead (1) get direct manual controls to
raise/lower water himself until it looks right by eye, and (2) make water
solid/unpassable and drop the swim-mechanics plan (Phase 4) entirely.
Both delivered:

- **Manual raise/lower** — Lake and River panels each gained ▲/▼ "nudge"
  buttons plus a step-size field (`src/editor/main.js`,
  `public/editor.html`). Raising/lowering a selected lake shifts its
  `surfaceLevel` by the step and re-carves; for a river, the SAME delta is
  added to every point's `surfaceHeights` entry at once (shifts the whole
  river as one rigid piece, slope untouched — a uniform shift can never
  violate the non-increasing/no-uphill invariant, so no re-clamp needed).
  Both re-carve and re-render immediately, same as the existing numeric
  fields, just faster to iterate with than typing exact numbers.
- **Water is now solid** — `src/sim/collision.js` gained two new collider
  types: `'polygon'` (real point-in-polygon + nearest-edge push-out for
  lakes — not a bounding-box approximation, which would over-block any
  non-rectangular shape) and `'river'` (distance-to-centerline + push
  perpendicular past the bank). `buildWorldColliders` now adds one
  collider per lake/river in `world.waterBodies`. **Puddles are
  deliberately excluded** — still walk-over decoration. Because both
  client prediction and the server already build their collision index
  from the full `world` object, this required ZERO changes anywhere else
  — no swim state, no movement.js changes, nothing.
- **A real sign bug was caught and fixed during verification**: the first
  version of the lake polygon push-out pushed the player DEEPER into the
  lake instead of out of it (had the edge-to-player vector backwards).
  Caught by a pure Node.js test script (no browser needed) asserting the
  pushed-out point actually lands outside the polygon — cheaper and more
  reliable than any visual check for this kind of math bug.
- **Phase 4 (swim mechanics) is no longer planned** — superseded by "solid
  and unpassable," which is simpler and is what Dennis actually wants now.
- Verified: 10/10 assertions passed in the collision test (lake polygon
  push-out lands outside the shape, river push-out lands past the correct
  bank without crossing to the other side, puddles never block, far-away
  points are untouched). Confirmed a clean editor boot with the new nudge
  UI present and wired (a missing element there would throw at load time
  and break the whole script, so a clean boot is real proof the wiring is
  intact). `npm run check` clean throughout.

---

## Real water system: the "floating in the air" root cause, later superseded above (2026-07-24, third round of screenshots)

The two rendering fixes just below (skirt walls, river bank-height clamp)
turned out not to be the real cause of Dennis's "floats in the air,
nothing below it" screenshots — those showed a rectangular LAKE hovering
high above a valley floor, not a river. **Root cause: the Lake tool never
auto-sampled the terrain height when starting a new lake.** The Surface
Level field just kept whatever number was left over from the last lake
(or the form's default, `0`) — so drawing a lake anywhere the local
terrain isn't near 0 (e.g. a mountain valley sitting at +14) rendered the
water at Y=0 while the real ground sat 14 units below it, an obvious
floating slab with a huge gap. The River and Puddle tools already sampled
real terrain per-click; the Lake tool was the one place this was missing.

**Fixed** in `src/editor/main.js`'s pointerdown handler: starting a brand
new lake draft now sets `lake-surface-level` from
`sampleTerrainHeight(world, point.x, point.z)` at the exact clicked spot,
the same "sample where you actually clicked" idea already used elsewhere.
Verified directly (not just visually): calling the fix's exact code path
against the real Default World terrain returned the real height there
(14.36) and confirmed it lands in the form field, replacing the stale `0`.

**Important — this fixes lakes drawn from now on, not the lake already in
Dennis's screenshots.** That specific one still has the wrong Surface
Level baked in and needs manual correction: select it in Lake mode and
edit its Surface Level number to match the ground (or delete it and
redraw, since the field now auto-fills correctly), then Save World.

---

## Real water system: two rendering bugs fixed from Dennis's actual in-game screenshots (2026-07-24 session, still going)

After Phases 0-3 shipped, Dennis tested a real river in the live game and
sent screenshots back: the water still read as two disconnected flat
sheets (a top surface and a seabed layer) with visible dirt/gap between
them and "nothing" if you looked from inside/underwater, AND the water
surface visibly floated above the real ground with a gap, rather than
sitting on it. Both were real, structural bugs in how Phases 1-2 built
water geometry — not the same "shore softness" concern from earlier in
this arc.

**Bug 1 — no actual volume.** A lake/puddle/river was always exactly two
infinitely-thin flat sheets (the water surface and, some distance below
it, the seabed decal) with literally nothing connecting them — looking at
the shoreline from a grazing angle, or from underwater, looked straight
through the open gap between the two sheets to whatever was behind. Fixed
by adding a third mesh, a "skirt": a vertical wall ring (lakes, around the
whole polygon perimeter) or a pair of wall strips (rivers, along both
banks) connecting the water surface down to the seabed everywhere, solid
dark-blue and double-sided so it reads as a continuous volume rather than
two floating cards. Also made the water top surface material itself
double-sided (`buildLakeBodyWaterMesh`/`buildRiverWaterMesh`,
`src/render/scene.js`) so looking up from underneath shows the underside
of the surface instead of nothing.

**Bug 2 — the water surface floated above the real ground.** A river's
surface height came from linearly interpolating between just the handful
of points Dennis actually clicked — fine on a straight, gently-sloping
stretch, but a real hillside's contour between two far-apart clicks isn't
a straight line, and wherever the true ground dipped below that
straight-line guess, the water rendered floating above it with a visible
gap (exactly what the screenshots showed, worst on a winding uphill
river). Fixed in `computeRiverSpine` (`src/render/scene.js`): each
resampled point along the river now clamps its intended (interpolated)
height down to the REAL terrain height sampled right at that point's bank
edge — safe to do specifically at the bank edge because
`carveRiverChannel`'s own carving falloff always reaches exactly zero
there (so it's guaranteed to still be natural, uncarved ground, never the
carved-down channel floor), meaning the clamp can't accidentally flatten
out the "looks deep in the middle" effect the depth-shader creates
separately. Lakes/puddles didn't need the equivalent fix — their surface
level is one author-set number, not an interpolation across sparse
clicks, so they don't have this specific failure mode.

**Verified** via the same debug-hook technique: built a terrain with a
deliberate dip between two sparse authored river points (exactly the
failure scenario), confirmed the RENDERED water surface at the dip now
reads ~4 (matching the real carved-terrain height there) instead of ~10
(the old naive straight-line value) — a direct, numeric confirmation the
fix works, not just "looks better." Confirmed both lake and river skirts
build successfully with zero GL errors. `npm run check` clean throughout.
Not yet re-confirmed by Dennis visually in a real playtest — that's the
natural next check before calling this closed.

---

## Real water system: Phase 3 of 5 done — Puddles (2026-07-24 session, still going)

The smallest phase, exactly as the plan predicted — almost entirely an
authoring-UI convenience, since puddles (`kind:'puddle'`) already rendered
correctly through Phase 1's lake pipeline (`buildLakeBodyMeshes` already
filtered for `'lake' || 'puddle'`, and `carveWaterBodyBasin` already
excluded puddles from carving). Water mode's toggle is now four-way:
Paint / Lake / River / **Puddle**.

- **Editor only** (`src/editor/main.js`, `public/editor.html`) — no draft,
  no shape editing, no terrain carving. Click (or click-drag, which
  scatters several, min-spaced) drops a puddle: a slightly-irregular
  10-gon (not a perfect circle — same jittered-blob aesthetic as this
  project's rock generators) at a small author-set radius, with
  `surfaceLevel` sampled directly from the terrain right there plus a hair
  of clearance. Deliberately no reshaping — delete and re-place is the
  whole editing story, matching the plan's "quick-place, not hand-sculpted"
  framing.
- **One real correctness gap found and fixed along the way**:
  `buildLakeBodySeabedMesh`/`buildRiverSeabedMesh` (`src/render/scene.js`)
  both had a FIXED `0.4`-unit seabed offset below the water surface. Fine
  for a normal lake (maxDepth ~3), but a puddle's maxDepth can be as small
  as ~0.15 — a flat 0.4 offset would've put the muddy "lake floor" nearly
  3x deeper than the puddle itself. Added `seabedOffsetFor(maxDepth)`
  (`Math.min(0.4, maxDepth * 0.3)`) so the offset scales down for shallow
  bodies and stays at the original 0.4 for anything deep enough that it
  wouldn't matter — applies to both lakes/puddles and rivers now.
- **Verified** via the same temporary-debug-hook technique: placed puddles,
  confirmed they show up as `kind:'puddle'` entries rendering through the
  shared lake pipeline with correct point count/surfaceLevel/maxDepth;
  confirmed delete-from-list actually removes one; confirmed the shader
  compiles clean. **The same transient, non-reproducing `gl.getError()`
  1281 reading from the Rivers phase showed up once more here** — same
  investigation as before (checked incrementally instead of once-at-the-
  end: always reads 0; only shows up when checked once after several
  `javascript_tool` round-trips, i.e. after real wall-clock time lets the
  editor's own render loop draw unrelated frames of the ~7000-prop scene
  in between) — now confirmed 3 times total across Phases 2-3, treated as
  environment noise, not a real bug. Also confirmed via a real click in a
  fresh tab that the 4-way Paint/Lake/River/Puddle toggle works, zero
  console errors. `npm run check` clean throughout.
- **Next**: Phase 4 (real swim mechanics) — the last and biggest remaining
  phase, touching shared client+server movement code
  (`src/sim/movement.js`).

---

## Real water system: Phase 2 of 5 done — Rivers (2026-07-24 session, cont'd yet again)

Same day, same overall arc, next phase: **sloped, flowing rivers**, the
feature Dennis originally called out as the hardest gap ("hard to create
rivers"). Water mode's Paint/Lake toggle is now a three-way Paint/Lake/River
toggle.

- **`src/sim/rivers.js`** (new) — `carveRiverChannel(world, river)`, the
  along-stroke counterpart to `carveWaterBodyBasin`/`stampMountainHeight`:
  same perpendicular-distance-to-polyline falloff as a mountain ridge, but
  it LOWERS terrain (never raises) and the target height varies along the
  stroke (via Phase 0's `nearestPointOnPolyline` + `sampleRiverSurfaceLevel`)
  instead of one constant peak. Also `enforceNonIncreasingHeights()` —
  a single left-to-right clamp pass that keeps a river's per-point
  `surfaceHeights` non-increasing regardless of which point last changed.
- **`src/render/scene.js`** gained `buildRiverBodyMeshes(world)` — a sloped
  ribbon (same resample-and-walk technique as `buildPathMesh`/
  `buildMountainRidgeMesh`), but each vertex's Y comes from the river's own
  interpolated `surfaceHeights` rather than draping onto terrain. Real
  depth-shading reuses the lake technique exactly (baked terrain-height
  texture), with one addition: since a river's surface genuinely isn't
  flat, the surface height reaches the fragment shader via a small
  vertex-shader pass-through varying (`vSurfaceY = position.y`) — the only
  place in this file that touches the vertex stage; every other custom
  shader here only edits the fragment stage. "Current" is one constant
  flow direction/speed per river (from its overall start-to-end direction
  and average slope), scrolling the Voronoi sampling UV — a deliberate
  scope cut against a per-vertex flow field that follows every bend,
  same "core-look-only" restraint as the original water/grass port.
- **Editor authoring** (`src/editor/main.js`, `public/editor.html`) — the
  River tool mirrors Mountains/Paths' click-polyline draft pattern (open
  path, Enter to finish, no click-to-close since it's not a closed shape).
  Each clicked point auto-samples its `surfaceHeights` entry from the
  terrain there and immediately clamps it non-increasing. Handle-dragging
  an existing river point re-samples that point's height and re-clamps the
  whole chain live, but — same restraint as the Lake tool's own handle-drag
  — only re-carves the actual terrain channel on drag-RELEASE, not every
  pointermove tick, since carving is an O(terrain-resolution²) sweep.
- **Verified** via the same temporary-debug-hook technique as the Lake tool
  (removed before landing): drew a river with realistic auto-sampled
  heights and confirmed the channel actually carved below the natural
  terrain by roughly `maxDepth` (small numeric fuzz from grid resolution
  vs. a narrow river width — an accepted characteristic already true of
  every other carving system here, not a bug); confirmed both the water
  and seabed river shaders compile with zero GL errors via direct
  `gl.getShaderParameter(COMPILE_STATUS)` inspection; confirmed
  handle-drag re-sampling + cascading monotonic re-clamp works correctly
  end-to-end (not just in the pure-function unit test); confirmed
  delete-point and cancel-draft behave correctly. Also confirmed via a
  real click in a fresh tab that the Paint/Lake/River toggle swaps panels
  with zero console errors. **One transient, non-reproducing `gl.getError()`
  reading (1281/INVALID_VALUE) turned up once during a monkey-patched
  shader-capture test** — re-ran the identical sequence three more times
  (including with the same monkey-patching) and got a clean `0` every
  time, so treated as background-rendering noise unrelated to the river
  code (the live editor's own `animate()` loop keeps rendering the full
  7000+-prop Default World scene independently between test steps),
  not a real bug — flagged here rather than silently ignored. `npm run
  check` clean throughout.
- **Next**: Phase 3 (puddles) — the smallest remaining phase (a quick-place
  shallow variant of the Lake body, no terrain carving), then Phase 4
  (real swim mechanics).

---

## Real water system: Phase 1 of 5 fully done — Lake authoring tool + migration (2026-07-24 session, cont'd again)

Finished what the previous entry below flagged as split off: the World
Editor's Water mode now has a **Lake tool** alongside the legacy Paint
brush, plus the **migration button** for existing painted maps. Phase 1 is
now completely done (Phase 2 rivers is next, per the plan).

- **`public/editor.html`** — Water mode gained a Paint/Lake tool toggle
  (same button-pair pattern as Zones' Circle/Freeform toggle). The Lake
  panel: surface level / max depth / edge softness fields, Finish/Cancel
  buttons, a live Lakes list, and a "Convert painted water to lakes" button.
- **`src/editor/main.js`** — the Lake tool is a direct mirror of the
  existing Freeform Zone click-polygon draw loop (click points, Enter or
  click-near-start to close, Escape cancels/deselects, Delete removes a
  selected point, draggable yellow point handles). Finishing a lake pushes
  a new `kind:'lake'` body into `world.waterBodies` and calls
  `carveWaterBodyBasin` (Phase 1's own basin-carve function) immediately.
  **One deliberate deviation from the Freeform Zone pattern**: dragging a
  point handle updates the shape live but does NOT re-carve the terrain
  basin on every pointermove tick — only on drag-release — same
  per-frame-cost restraint Mountains' own ridge-stamping already
  established, since carving means an O(terrain-resolution²) sweep.
- **Migration**: `findWaterMaskComponents()` (new, `src/sim/waterBodies.js`)
  is the whole-mask counterpart to the single-click flood-fill
  `eraseConnectedWaterBody` already had — finds every separately-painted
  region in the legacy `world.waterMask`. The "Convert painted water to
  lakes" button runs this, traces each component to a polygon (Phase 0's
  `traceWaterMaskComponentToPolygon`), and adds one rough `kind:'lake'`
  body per region — deliberately NOT clearing the old mask or re-carving
  terrain (already carved by the legacy paint flow), so Dennis can drag
  points into shape and manually clear the old mask once satisfied, per
  the plan's semi-automatic-convert-then-manual-touch-up decision.
- **Verified end-to-end via the same temporary-debug-hook technique as
  Phase 1's rendering work** (removed before landing): drew a lake,
  confirmed it pushed into `world.waterBodies` AND actually carved the
  terrain to `surfaceLevel - maxDepth` at its center; dragged a point
  handle and confirmed the basin re-carved correctly on release (and did
  NOT touch terrain mid-drag); deleted a point; canceled a draft with no
  side effects; ran the migration converter against a hand-built two-blob
  waterMask and got exactly two correctly-shaped, correctly-leveled lake
  bodies back, both rendering with zero GL errors. Also confirmed via a
  real click in a fresh browser tab that the Paint/Lake toggle actually
  swaps panels, with zero console errors. `npm run check` clean throughout.
- **Found along the way**: the Default World's current `waterMask` is
  effectively empty (max cell value ~0.01, i.e. noise/rounding residue,
  not real painted water) — so there's currently nothing on Dennis's actual
  map for the migration button to convert yet. Not a bug; just means the
  migration path was verified against synthetic test data this session,
  not his real map, because there's nothing real to migrate right now.
- **Next**: Phase 2 (rivers) — sloped polyline authoring, channel carving,
  flowing shader.

---

## Real water system: Phase 1 of 5 (lake rendering) done (2026-07-24 session, cont'd)

Same session as Phase 0 below, continued: **per-body lake/puddle rendering
now exists and is verified working.** `src/render/scene.js` gained
`buildLakeBodyMeshes(world)` — one water+seabed mesh PAIR per `kind:'lake'|
'puddle'` entry in `world.waterBodies`, additive alongside the legacy
world-spanning `buildWaterMesh`/`buildSeabedMesh` (untouched, still what
un-migrated maps render). Each lake is a real `THREE.Shape`/`ShapeGeometry`
built directly from the body's polygon points (no alpha-mask texture needed
for shape anymore — the mesh boundary IS the shape), positioned at its OWN
`surfaceLevel`, so two lakes at different heights just fall out of being two
separate meshes. `carveWaterBodyBasin()` (added to `src/sim/waterBodies.js`)
carves the terrain basin under a lake only (puddles are deliberately left
uncarved, per the plan).

**The depth-based shading is real now, not a paint-alpha proxy**:
`buildTerrainHeightTexture(world)` bakes `world.terrain.heights` into a
small DataTexture once per rebuild; each lake's shader
(`applyLakeWaterShading`) samples it per-fragment and computes
`depth = surfaceLevel - terrainHeight` directly, feeding the same Voronoi
cel color ramp the old shader used. Depth naturally reads shallow near the
shore (since `carveWaterBodyBasin` already tapers the basin to nothing at
the polygon boundary) and deep in the middle, with zero separate
edge-distance texture needed — a simplification over the original plan,
which had proposed a second SDF-style edge texture that turned out to be
unnecessary once depth itself was real.

**A real, non-obvious bug was caught and fixed during verification**: a
material needs `.map` set to SOME texture for Three.js to define `USE_MAP`
and declare the `vMapUv` varying at all — both new shaders referenced
`vMapUv` in their injected GLSL without ever assigning `.map`, which
compiles fine at the JS level (`onBeforeCompile` always runs) but fails at
actual GL shader compile time. Fixed by assigning the already-built terrain
height texture as `.map` (harmless — `#include <map_fragment>`'s built-in
sampling gets fully overwritten by the custom block right after, same
pattern the legacy water/seabed shaders already rely on with their own mask
texture).

**How this was verified, since the WebGL canvas doesn't composite frames
while the Browser pane tab isn't visually focused** (screenshot times out,
per [[feedback_hidden_tab_pauses_raf]]): a TEMPORARY `window.__waterDebug`
hook (removed before this landed) let a live editor session — loaded on
the REAL "Default World" map, never saved — have its in-memory `world`
copy mutated with hand-built test lake bodies + a sloped test terrain, then
rebuilt and inspected directly. Confirmed via low-level `gl.shaderSource`/
`gl.compileShader` interception (ground truth, not just console-log
watching — the Browser pane's console-message tool turned out to
accumulate stale entries across same-tab navigations, which initially
looked like a persistent failure until cross-checked against
`gl.getShaderParameter(..., COMPILE_STATUS)` directly): two lakes at very
different `surfaceLevel`s each rendered at their own correct height, a
puddle rendered with no terrain carving, all three shaders compiled with
zero GL errors, and `gl.getError()` was clean after a real render pass. A
fresh separate tab load of both `editor.html` and the live game client
(`/`) also confirmed zero console errors on the unmigrated Default World
(the new code is a correct no-op when `world.waterBodies` is absent/empty).

**Not built this session** (still next): the World Editor's actual Lake
authoring TOOL (click-polygon draw loop, surfaceLevel/maxDepth sliders —
Phase 1 rendering exists but there's no in-editor way to create a lake
body yet without hand-editing JSON) and the migration button that makes
`traceWaterMaskComponentToPolygon` (Phase 0) reachable. Both were
originally scoped as part of "Phase 1" but split off given how much the
rendering rework alone turned out to involve — pick this up first next
session before moving to Phase 2 (rivers).

---

## Real water system: Phase 0 of 5 (data model) done (2026-07-24 session)

Dennis is unhappy with water being a single flat world-wide painted mask
(no per-lake elevation, no rivers/slope, "depth" faked from paint alpha, zero
gameplay physics). Full 5-phase plan agreed and saved at
`~/.claude/plans/memoized-knitting-bonbon.md`: **Phase 1 lakes** (per-body
elevation + real depth) → **Phase 2 rivers** (sloped polyline, flowing
current) → **Phase 3 puddles** → **Phase 4 real swim mechanics** (float,
slowdown, river current push — touches `src/sim/movement.js`, shared
client+server). Existing painted lakes migrate via a semi-automatic
boundary-trace + manual touch-up tool (not built yet — planned alongside
Phase 1, since there's nothing to visually touch up until Lake rendering
exists).

**This session shipped Phase 0 only** — the sim-layer foundation, no
rendering or editor UI yet (intentionally; verified via a standalone script,
not in-browser):
- **`src/sim/waterBodies.js`** (new) — `WaterBodyDef` schema: `'lake'`/
  `'puddle'` (closed polygon + flat `surfaceLevel`, same point-list shape as
  a polygon zone) and `'river'` (open polyline + `width` + one
  `surfaceHeights` entry per point, validated non-increasing along the
  stroke so it can never flow uphill). `validateWaterBodies()` follows the
  existing `validatePaths`/`validateMountains` pattern. Also exports
  `nearestPointOnPolyline()` (distance + segment + local t — shared by
  river containment now and Phase 2's channel-carving later) and
  `traceWaterMaskComponentToPolygon()`, a pure marching-squares-style
  boundary tracer that turns one flood-filled connected component of the
  OLD `waterMask` bitmap into a rough polygon — the core of the not-yet-
  wired migration tool.
- **`src/sim/world.js`** — new `waterBodies` field (validated, additive,
  doesn't touch the existing `waterMask` path) and `sampleWaterBody(world,
  x, z)`, the one query both the future per-body renderer and the Phase 4
  swim hook will call: finds which body (if any) contains a point and
  returns real depth as `level - sampleTerrainHeight(world, x, z)` — a real
  number derived from actual terrain, not paint-mask alpha.
- **`src/sim/zones.js`** — exported its existing `isPointInPolygon` (was
  file-private) for reuse by `sampleWaterBody`'s lake/puddle containment
  check, same closed-polygon shape as a polygon zone.
- **Verified**: `npm run check` clean (43 sim files, 0 arch-guard failures —
  confirms the new files stay pure/host-agnostic). A throwaway Node script
  (not committed) exercised: lake containment + depth math, river surface-
  height interpolation at an arbitrary point along a 3-point sloped
  polyline, width cutoff, uphill-river validation rejection, and the
  boundary tracer on a known small painted blob — all 10 checks passed.
- **Next session (Phase 1)**: per-lake rendering rework in
  `src/render/scene.js` (replace the single world-spanning
  `buildWaterMesh`/`buildSeabedMesh` with one clipped-polygon mesh per
  lake, real depth-based color via a baked terrain-height texture instead
  of mask alpha) + the World Editor's new Lake authoring tool (mirrors the
  existing Freeform Zone click-polygon draw loop) + the migration button
  that finally makes `traceWaterMaskComponentToPolygon` reachable/useful.

---

## Mountains draw tool + round-tree rewrite via ez-tree (2026-07-16 session)

- **Mountains draw tool** — new World Editor mode (hotkey `M`), draws a
  ridge like Paths (click points, Enter to finish). Permanently raises
  `world.terrain.heights` under the stroke (max-merged, same falloff as the
  interactive "mountain preset" brush) and lays an opaque rock-textured
  ribbon mesh on top — opaque, not a decal, which is what fixes the "green
  gaps between brush strokes" problem the old Ground Texture painting had
  for mountains specifically. See `src/sim/mountains.js`,
  `src/render/mountainMesh.js`/`mountainThemes.js`.
- **Round-canopy trees, rewritten twice in one session.** First pass:
  reverted an earlier (pre-session) "realistic trees" regression — sparse
  floating leaf-cards — back to solid jittered-icosahedron blob clumps (like
  the boulders) plus added branch geometry connecting trunk to canopy.
  Dennis's verdict: still not close enough to his reference (a painterly
  tree with a gnarled visible trunk and many individual leaves). Second
  pass: **integrated the vendored `ez-tree` library**
  (`src/vendor/ez-tree/`, MIT, real recursive branching + billboard leaves
  with actual bark/leaf textures) — the project's **first deliberate
  exception to "no external asset files"**, agreed explicitly after two
  procedural attempts both fell short. See `src/generators/environment/
  ezTree.js`, and CLAUDE.md's new "First exception to no external asset
  files" addendum section for the full contract (toon-converted materials,
  known ~6800-tri-per-tree perf tradeoff, why `check-props.mjs` needed a
  headless texture-loader stub). Conifer trees are untouched, still fully
  procedural.
- **Not yet Dennis-visually-confirmed** — verified thoroughly via automated
  checks + structural browser inspection (real render pass, zero GL/console
  errors, textures decode, correct material setup) but the Browser pane's
  screenshot tool times out on this project's heavy WebGL scene, so nobody
  has actually looked at the on-screen result yet. First thing to check
  next session if trees come up again.

---

## Zones/audio, dialog/quests/minimap, keyframe animation (2026-07-12 session)

Three features built back-to-back in one session, on top of everything below.

- **Freeform zones + audio** — `world.zones` now supports hand-drawn polygon
  shapes (`src/sim/zones.js`) alongside the original circles, tagged with
  music/ambient audio (crossfades in/out via Web Audio as the player crosses
  the boundary, with Loop/Default Volume options) and particle effects.
  Editor: Zones mode gained a Circle/Freeform toggle.
- **Branching NPC dialog + quest chaining + minimap** — `NpcDef.dialogTree`
  (multi-choice dialog trees, additive next to the old linear `dialog[]`),
  `QuestDef.requiresQuestId` (quest prerequisite chains), a yellow `?`/grey
  `?`/yellow `!` quest-status icon above NPC heads, and a corner minimap +
  `M`-toggled full map (plain Canvas 2D dot-map, not a second Three.js pass)
  with a directional arrow to the active quest's objective. "Quest Accepted!"
  / "Quest Completed!" toasts added. **Known gap, not a bug:** gathering
  nodes still have no editor placement UI at all (hand-authored in
  world.json) — a `group` tag was added to `GatheringNodeDef` for minimap
  wayfinding, but authoring one is still manual JSON editing.
- **Keyframe animation clips** — `CreatureTypeDef.animation.{walkClip,
  idleClip,attackClip}` (`src/sim/creatureTypeDefs.js`): hand-authored
  position/rotation/scale keyframe clips, additive next to the existing
  procedural sine-wave gait (`animation.walk`). New `applyKeyframeClip`
  (`src/generators/rig.js`) plays them; `updateWalkCycle` hard-swaps to a
  walk/idle clip when present, and `updateAbilityAnimations` overlays an
  attack clip on top of the existing burst-VFX flash (fixing a real gap —
  monster attacks previously animated no limbs at all). Editor: Monster
  Builder → Model Editor → Settings → new "Keyframe Animation" section
  (Walk/Idle/Attack toggle, tracks per body part, keyframes per track with
  posing sliders, live preview). **Not yet Dennis-verified in an actual live
  combat encounter** (attackClip firing during a real monster attack) —
  everything else (schema validation, clip-playback math, full editor
  create/pose/save/reload round-trip) was verified this session.

See memory (if you're a fresh Claude Code session with access to it):
`freeform-zones-and-audio.md`, `dialog-trees-quest-chains-minimap.md`,
`keyframe-animation-clips.md`.

## FBX model import (2026-07-12, later same day)

Roadmap item #11, first half (model import; audio is still unbuilt). Lets an
author upload a `.fbx` file and place it as a prop, alongside the procedural
generators — same position/rotation/scale placement data every other prop
already uses.

- **`src/sim/models.js`** — pure schema for the catalog metadata
  (`id/name/url/importScale/footprintRadius/height`). The FBX bytes
  themselves live under `public/assets/models/`, served statically.
- **`src/generators/modelLoader.js`** — the one genuinely new architectural
  wrinkle: every other prop builder is synchronous (`buildProp` returns a
  mesh immediately), but loading an FBX is inherently async. Solved the same
  way the ground-texture custom-upload work did it two nights ago: `buildProp`'s
  new `'model'` branch returns a translucent wireframe-box placeholder
  immediately if the model hasn't loaded yet, kicks off the load in the
  background via `THREE.FBXLoader`, and fires a listener
  (`onModelLoadedEvent`) once it lands so a caller can rebuild. Clones for
  placement go through `SkeletonUtils.clone` (not plain `Object3D.clone()`),
  which handles both skinned and static models correctly. If the FBX carries
  an animation clip, the first one auto-plays in a loop — ambient detail
  only (a turning windmill), not creature/combat rigging.
- **Import scale is user-set, not guessed.** FBX exporters disagree on units
  (centimeters vs meters is the classic split — this is explicitly called
  out as a risk in the roadmap item itself). Rather than silently assume a
  0.01 conversion and be wrong for half of Dennis's files, the upload form
  has an "Import scale" field (default 1) applied once at load time.
- **Collision footprint is measured, never guessed** — same "what you see is
  what you collide with" rule every other collider in this project follows
  (`src/sim/collision.js`'s own header comment). An FBX is opaque binary the
  server can't parse, so the World Editor measures it client-side right
  after upload (`THREE.Box3().setFromObject`, post-`importScale`) and saves
  `footprintRadius`/`height` back to the catalog. `collision.js` gained a
  `modelCatalogById` parameter (threaded through `propCollider`/
  `buildWorldColliders`/`buildCollisionIndex`, default `{}` so every
  existing caller keeps working unchanged) and a `'model'` collider kind
  that reads the measured radius — returns no collider (not a guess, not a
  crash) for a model that hasn't been measured yet.
- **Live game vs. editor load differently, on purpose.** The World Editor
  shows the placeholder box and rebuilds on `onModelLoadedEvent` — instant
  feedback matters more there. The live game client instead **awaits every
  model actually referenced by a placed prop** before building the scene at
  all (`waitForModels`, bounded by an 8s timeout so one broken/slow model
  can't hang the game forever) — a placeholder box should never be visible
  to a player.
- **Editor UI**: a new "Imported Model" section in Place mode, mirroring the
  existing "Custom object" (Object Builder) section exactly — upload
  file+name+scale inputs, a dropdown of uploaded models (deliberately
  **text-only, no thumbnail** — a thumbnail rendered before the model
  finishes its async load would cache a wireframe-box image forever, since
  `sceneryPalette.js`'s thumbnail cache has no invalidation), pick one and
  click the ground to place it.
- **Scope cuts, stated on purpose**: models are Place-mode only, not
  scatter-brushable (the scatter palette's thumbnail grid has the same
  async-thumbnail problem, times a hundred instances). No animation retargeting
  or skeleton-driven combat — that's a much bigger, separate undertaking the
  roadmap item itself flags ("the real fix for the character animation
  ceiling," future work, not this pass). No glTF/GLB support yet, only FBX,
  per Dennis's explicit ask this time — the roadmap's original framing
  preferred glTF long-term; worth adding `GLTFLoader` alongside `FBXLoader`
  later using the exact same `modelLoader.js` machinery if that comes up.
- **Verified**: real upload → server persists file + catalog with `.bak` →
  editor dropdown repopulates after reload → `FBXLoader` genuinely attempts
  to parse the file (confirmed via a deliberately-invalid upload throwing
  the real `THREE.FBXLoader` parse error, not silently no-oping) →
  `waitForModels` respects its timeout rather than hanging →
  `propCollider('model', ...)` returns a correctly-scaled circle for a
  measured model and `null` (not a crash) for an unmeasured one →
  `npm run check` (arch/prefabs/props) all pass. **Not verified**: an
  actual successful FBX parse+render, since no real `.fbx` test asset was
  available this session — the failure path was exercised thoroughly, the
  success path was verified structurally (loader instantiates, scale/clone/
  measure logic is correct) but not with a real model in view. Worth doing
  the first time a real FBX is uploaded.

---

## Character creation fixed, gender restored, 13 new biome props (2026-07-12)

Three independent asks landed together.

**1. Character creation was completely broken — root cause found and fixed.**
`public/character-creation.html`'s import map only mapped `"three"`, not
`"three/addons/"`. `character-creation/main.js` statically imports
`buildPlayerCharacter` → `buildCreatureRig` → `custom.js` →
`buildingParts.js`, and that last file does `import { mergeGeometries }
from 'three/addons/utils/BufferGeometryUtils.js'` (added 2026-07-10 for the
Object Builder's log-wall/shingle-roof shapes — unrelated to characters, but
`custom.js` is the shared shape-rendering primitive every `CreatureTypeDef`
consumer pulls in). A missing import-map entry makes an unresolvable static
import abort the ENTIRE module graph — no class cards, no swatches, "Enter
World" stuck disabled, no console error surfaced by casual testing. Fixed by
adding the same `"three/addons/"` mapping `public/index.html` already has.
**One-line fix, verified end-to-end**: class cards populate, picked
Guardian, entered the world, confirmed in the live game with zero console
errors.

**2. Gender restored, as a body-proportion toggle, not a re-authored body.**
The 2026-07-10 character overhaul deliberately dropped gender — bodies
became part-based/class-owned with no gender axis. Re-adding it as
individually-authored masc/fem bodies per class would be a much bigger lift
(10+ new catalog rows) and risk exactly the floating-limb bugs that overhaul
worked hard to fix (see this file's own 2026-07-10 "hard-won lessons").
Instead: `src/generators/playerCharacter.js` exports `GENDERS = ['masc',
'fem']` and applies a **non-uniform scale on the whole assembled rig group**
(masc `{1.04, 1.03, 1.04}`, fem `{0.95, 0.98, 0.93}`) in `buildPlayerCharacter`
— mathematically this can't disconnect anything (every child's transform is
multiplied by the same factor, so shapes that touched before scaling still
touch after). `character-creation.html`/`main.js` got the selector back
(`<select id="gender">`, wired into `currentParams()`). Verified: the two
genders produce visibly different `group.scale` values through the exact
function the page and the live game both call, and a saved character's
`gender` field survives into `localStorage` → the live game with no schema
changes needed anywhere (character payload is relayed opaquely by the
server). **Known limitation, stated on purpose**: this is a size/proportion
difference like the old system had, not a differently-sculpted body —
shoulder width, hips, etc. aren't independently authored. Revisit if more
differentiation is wanted.

**3. 13 new biome-themed scenery props** — desert, swamp, snow, mountain,
following `src/sim/propTypes.js` + `src/generators/props.js`'s existing
catalog pattern exactly (a metadata row + a builder = done, appears in the
editor's palette automatically, `npm run check:props` validates it — all 13
passed on the first run):
- **Desert**: Palm (`tree-palm`), Saguaro Cactus (`cactus-saguaro`),
  Sandstone Rock (`rock-sandstone`), Desert Bloom (`flower-desert`).
- **Swamp**: Cypress (`tree-cypress`, buttressed trunk + hanging moss
  strands), Mossy Rock (`rock-mossy`), Marsh Flower (`flower-swamp`).
- **Snow**: Snow Pine (`tree-pine-snow`, real conifer tiers with a snow-cap
  cone on each), Snowy Rock (`rock-snowy`, capped with a flattened sphere),
  Snowdrop (`flower-snowdrop`).
- **Mountain**: Alpine Conifer (`tree-alpine`, squat + wind-leaning),
  Mountain Rock (`rock-mountain`, cold-toned jittered dodecahedron),
  Alpine Flower (`flower-alpine`).
- New generators live in `src/generators/environment/flora.js` (trees +
  flowers, flowers reuse the existing shared `flowerPatch()` helper) and
  `src/generators/environment/stones.js` (rocks, all jittered via
  `jitterSharedVertices` per the corner-not-vertex rule).
- **The one easy-to-get-wrong part, gotten right**: every new tree calls
  `sampleTree(rng, { type: 'conifer' })` with a FIXED type, and
  `propTypes.js`'s `treeSilhouette()` returns that exact same fixed string
  for each new id. `sampleTree` only draws a random type via `pick()` when
  `options.type` is falsy/`'random'` — that extra draw shifts every
  subsequent draw (including `trunkRadius`, which collision reads) by one
  position. A mismatched silhouette mapping would silently desync the
  client-rendered trunk radius from the server's collision radius, the
  exact bug class `propMetrics.js`'s draw-order comment warns about. Get
  this wrong and nothing crashes — you just occasionally collide with air
  next to a new tree type, on a seed-dependent subset of placements.
- No new palette category was added — these live as more entries in the
  existing Trees/Small Plants/Rocks tabs, verified live in the editor (all
  13 render correct thumbnails, zero console errors).
- **Not done**: no per-biome authoring convenience (e.g. a "desert" scatter
  preset bundling palm+cactus+sandstone+bloom at once) — an author picks
  the new prop types individually from the palette like any other prop.

**4. Four faceted crystal-cluster variants**, added the same session after
Dennis shared reference images (a dominant tall spike + shorter shards
fanned around it, on a small rock outcrop, with tiny chip shards scattered
around the base — noticeably more polished than the existing `crystal`
prop's plain cone-shard look). New shared builder `crystalCluster(seed,
hues)` in `stones.js`, wrapped into `crystal-rose` (pink), `crystal-emerald`
(green), `crystal-frost` (icy blue), `crystal-amethyst` (purple) — all
`buried: true`/`fixed(0.5)` collider, category `rocks`, verified live in the
editor palette. **`generateCrystal`/`crystal` itself was deliberately left
untouched** — Dennis's explicit rule from the grass work applies here too:
add a new preset alongside an existing one, don't upgrade it in place.

---

## Drawn paths, ground-texture painting, and ambient particles (2026-07-11 night session)

Two features shipped back-to-back, unattended overnight per Dennis's request
("do it in one go" — he was going to sleep). Both are verified working via
direct in-browser function calls (`buildPathMesh`/`buildGroundTextureOverlay`/
`createAmbientParticleSystem`/`buildWorldMeshes` all called and inspected
live through the running server), plus a real end-to-end custom-texture
upload (browser-generated PNG → `/api/ground-textures/upload` → file +
catalog persisted → re-fetched → pixel-verified). **Not verified**: a real
screenshot — the Browser pane tab was backgrounded (`document.hidden: true`)
for this whole session, which pauses `requestAnimationFrame` (so the
editor's dirty-flag render loop never ticks) and made the `computer`
screenshot tool time out every attempt. Everything was checked by calling
the actual render functions directly instead and inspecting their output
(vertex counts, texture presence, scene-graph contents), not by guessing.
**Worth a real look/screenshot pass before trusting the visuals fully.**

### 1. Drawn paths — `world.paths[]`

- **`src/sim/paths.js`** — schema + `validatePaths`. `world.paths[i] =
  {id, theme, width, points: [{x,z}, ...]}`, wired into `parseWorld`.
- **`src/render/pathThemes.js`** — 4 procedurally-baked, seamlessly-tileable
  road textures (basic/desert/snow/forest), periodic-Voronoi flagstone look,
  cached per theme.
- **`src/render/pathMesh.js`** — `buildPathMesh`/`buildPathMeshes`: Catmull-Rom-
  smoothed ribbon strip, each edge vertex height-sampled via
  `sampleTerrainHeight` (follows slopes, doesn't float), small Y offset
  (0.03) above the ground so it doesn't z-fight.
- **Editor**: new "Paths" mode (hotkey `P`) in `src/editor/main.js` +
  `public/editor.html`. Click to place points, or click-drag to sketch a
  stroke; live preview while drafting; Finish/Cancel (also Enter/Escape).
  Click a saved path to select it — drag its control-point spheres directly
  (matches the Character Builder's direct-manipulation style), edit
  width/theme live, delete a point or the whole path.
- **Live game**: `buildWorldMeshes` (`src/render/scene.js`) renders
  `world.paths` — no `src/main.js` changes needed beyond that one wire-in.
- **Not built**: NPC pathfinding along paths — Dennis explicitly scoped this
  as "later, when the NPC AI gets added." The schema (ordered waypoints per
  path, stable ids) is nav-graph-ready; no pathfinding code exists yet.

### 2. Ground texture painting — `world.groundTextures[]`

- **`src/sim/groundTextures.js`** — schema + `validateGroundTextureLayers`.
  `world.groundTextures[i] = {id, textureId, particleType, resolution,
  cells}` — `textureId` is a builtin (`meadow|desert|snow|forest|stone|dirt`)
  or `custom:<uploadId>`. Each layer is its own soft-edged weight mask,
  painted with the exact same brush mechanic as the existing water mask
  (radius + softness sliders, shift-drag erases). **Multiple layers
  alpha-composite in creation order** into one baked overlay — this is what
  gives smooth transitions between two different painted textures: both
  layers' brush edges are soft, and "over" compositing two overlapping soft
  edges blends them, the same way two overlapping soft brush strokes blend
  in any paint program.
- **`src/render/groundTextureThemes.js`** — 6 procedurally-baked ground-cover
  tiles (cheap tileable trig-noise blotches — visually distinct from paths'
  flagstone-cell look on purpose), plus the custom-upload pipeline: an
  uploaded image loads async into a 128×128 tile cache keyed `custom:<id>`,
  with a load-callback so a bake triggered before the image finishes just
  skips that layer and retries once it lands.
- **`src/render/groundTextureMesh.js`** — `buildGroundTextureOverlay`: bakes
  every layer into ONE big composite canvas (512×512 across the whole map),
  then builds a mesh that **follows terrain per-vertex** (like
  `buildGroundMesh`, NOT a flat plane like water — ground textures sit on
  real, possibly-sloped ground). Sits at Y=0.015 — above the ground (0),
  below paths (0.03), so **paths always render on top of ground textures**
  exactly as asked, via ordinary opaque-vs-transparent depth testing (paths
  are opaque, the overlay is `transparent + depthWrite:false`, so an opaque
  path fragment always wins the depth test regardless of paint order).
- **Custom texture upload**: `POST /api/ground-textures/upload` (multer,
  mirrors the existing item-icon upload pattern) saves to
  `public/assets/ground-textures/` and appends to
  `ground-textures/ground-textures.json` (`GET /api/ground-textures` to
  list, `POST /api/ground-textures/catalog` to replace-save — the delete
  idiom every other catalog uses). New `src/sim/customGroundTextures.js` is
  just this catalog's schema (id/name/url) — separate from the painted-layer
  schema above, same split as items' authored catalog vs. their icons.
- **Editor**: new "Ground Textures" mode (hotkey `G`). Texture palette
  (6 builtin swatches + any uploaded customs, rendered from the real baked
  tiles), an upload file input, brush radius/softness sliders, a particle-
  type dropdown that applies to whichever texture is currently selected
  (creates/edits that texture's layer even before any paint stroke), and a
  layer list with delete.
- **Live game**: wired into `buildWorldMeshes` between the base ground and
  water. `src/main.js` fetches the custom-texture catalog and registers each
  upload for loading before the first bake, with a reload-in-place callback
  for uploads that finish loading after that first bake.
- **Not built**: reordering layers (compositing order = creation order, no
  UI to change it), flattening terrain under a painted texture, a visible
  soft-glow edge blend into ungrounded areas beyond what the alpha
  compositing already gives.

### 3. Ambient particles — linked to ground-texture layers

- **`src/render/ambientParticles.js`** — `createAmbientParticleSystem(world)`
  scans `world.groundTextures` for a layer with `particleType` set (dust,
  snow, wind, rain, storm, sand, fireflies, miasma — each its own
  color/size/count/fall-speed/drift/blend-mode) and builds one `THREE.Points`
  system per tagged layer. Particles spawn via rejection-sampling against
  the layer's own mask (so they follow the painted shape, not just its
  bounding box) and wrap within that region + a height band each frame — CPU
  position updates, same pattern `windSway.js`/`createSwayAnimator` already
  use elsewhere in this codebase, not a custom shader.
- **Live game only** — the editor doesn't simulate particles, same
  reasoning it already skips toonify/shadows (it's a blockout tool, not the
  final view). Wired into `src/main.js`'s existing `animate()` loop
  (`ambientParticles.update(dt)`, alongside `propSway.update(...)`).
- Picking a particle type is independent of painting a stroke — the
  dropdown writes straight to `ensureGroundTextureLayer(id).particleType`,
  so "I want fireflies here" and "paint the meadow grass here" can happen in
  either order.

### What to check first when you're back

1. **Actually look at it.** Open `/editor`, hotkey `G`, paint a couple of
   ground textures next to each other and confirm the soft blend looks
   right (not a hard seam), confirm a path drawn over a painted texture
   really renders on top, try the particle dropdown on a live game session.
2. Upload a real custom texture image through the UI (the automated test
   used a synthetic 8×8 solid-color PNG — never tried a real photo/texture
   file, e.g. how it looks stretched into a 128×128 tile before it tiles).
3. Composite bake cost: `COMPOSITE_SIZE = 512` in `groundTextureMesh.js` is
   untuned against the real ~1000×1000 world — worth watching for a
   noticeable pause when painting on a slower machine; the water mask's
   equivalent bake is much cheaper (single flat quad, no per-pixel tile
   sampling) so this hasn't been load-tested the same way.

---

## Grass: settled — two scatter presets, no mask (2026-07-11)

Grass went through four rewrites this project (noise "fur" shader, a
hand-drawn tiled ground texture, an in-place density upgrade — all rejected)
before landing on what actually shipped and was confirmed working:

**Two independent Scatter-palette prop types, both instanced blade cones,
each its own `InstancedMesh` (one draw call apiece) in `src/render/grassCover.js`:**
- **`grass`** ("Grass Tuft") — the original, untouched: 14 blades/prop, plain
  `MeshLambertMaterial`, static, sparse. Left alone on purpose after an
  earlier attempt upgraded it in place without being asked to.
- **`grass-meadow`** ("Meadow Grass") — new, additive: 70 blades/prop,
  `MeshToonMaterial` (cel-shaded, shares `getToonGradientMap()` from the new
  `src/render/toonGradient.js`), and a gentle uniform wind sway.

No painted density mask anymore — `world.grassMask`, the Grass Brush UI, and
`editorGrassCover` were all removed. Both types scatter through the editor's
normal discrete-prop Scatter brush (`src/sim/propTypes.js` + a builder in
`src/generators/props.js` is the entire registration — the palette picks it up
automatically). This matters for next steps: **the same pattern (plain
existing preset + one new dense/cel-shaded/animated preset, both discrete
scatterable props) is what Dennis wants repeated for flowers next.**

**Two real bugs hit and fixed while building the wind sway, both worth
remembering if wind/sway code shows up elsewhere:**
1. Adding the sway offset to `transformed.x` at `<begin_vertex>` is LOCAL
   space, still before each instance's own random Y-rotation (baked into
   `instanceMatrix` for visual variety) gets applied. Result: a "uniform" sway
   actually got rotated a different direction per blade — reported as "every
   single grass is moving into a different direction." Fix: compute the bend
   factor at `<begin_vertex>` (that part is legitimately local-space geometry),
   but apply the actual push to `gl_Position` *after* `<project_vertex>` has
   already run the instance transform, as a world-space direction vector
   (`vec4(dx, 0, 0, 0)`, w=0 so it carries no rotation/translation) — see
   `applyWindSway()`.
2. Amplitude/frequency defaults (`uWindStrength: 1`, `sin(uTime * 1.4)`) were
   wildly too strong — a blade tip could swing a full blade-height sideways.
   Tuned down to `uWindStrength: 0.05`, `sin(uTime * 0.6)` after Dennis flagged
   it as "too hard." These are the two knobs to touch if it ever needs
   retuning again — no other logic should need to change.

**Process lesson, stated directly by Dennis and worth not repeating:** don't
upgrade an existing preset in place when asked for an *additional* option —
add a new one and leave the original alone. Also: stop running
screenshot/pixel-sampling/video verification loops — he tests in-browser
himself and asks to be shown a screenshot only when he wants to hand one to
me (see `feedback_testing_scope.md` in memory).

## Next up, per Dennis (2026-07-11): flowers, then a tree rework

**1. Flowers — same pattern as grass, most likely fast.** Add a new,
additive, dense/cel-shaded/wind-swaying flower preset alongside the existing
sparse `flower`/`flower-daisy`/`flower-bell` props, the same way
`grass-meadow` was added: a `propTypes.js` row, a `props.js` builder for the
editor preview, and a batched-`InstancedMesh` renderer (can very likely reuse
`applyWindSway()` from `grassCover.js` as-is, or extract it into a shared
helper if a second caller shows up).

**2. Trees — a real visual rework, not a tuning pass.** Dennis shared a
reference image: a stylized, painterly, cel-shaded tree — a big rounded,
"fluffy" canopy built from overlapping soft blob-clusters of 2–3 green tones
(not individual geometric leaf shapes the way `generateTree`/`generateBirch`
etc. in `src/generators/environment/tree.js` and `flora.js` currently build
canopies), sitting on a smooth tapered brown trunk with a slight root-flare at
the base. This is a bigger lift than grass was — expect to design a new
canopy-generation approach (e.g. layered/clustered rounded blobs with toon
shading) rather than adjust existing tree generator parameters. Read the
grass section above first for the pattern to follow (additive where
possible, don't break what already works, keep wind/sway math in world
space) before starting.

---

## Weapon-save-wipe root cause (2026-07-10)

Dennis reported "Save catalog" still not sticking for weapon grips (bodies
saved fine, grips didn't survive a refresh).

### The actual save bug: diffing against the wrong baseline

`tuningPayload()` decided whether a weapon's grip differed from "the defaults" by
comparing against `getWeaponTypeDef(id)` — but that function returns the **live**
definition, which `applyWeaponTuning()` had already patched with the saved
values on page load. So on a fresh load: patch defaults with saved tuning ->
diff against those same now-patched defaults -> everything reads "unchanged" ->
gets dropped from the next save. Editing sword and saving would silently erase
every OTHER weapon's tuning that had been saved in a prior session, because none
of them were in the in-memory `tuned` object this time and the payload was never
merged with what the server already had — it just replaced the file outright.

Fixed with two changes:
- **`pristineWeaponDefault(id)`** (`src/sim/weaponTypes.js`) snapshots the
  shipped defaults at module init, before `applyWeaponTuning` can touch
  anything. Diffs now compare against this, never against the live (patchable)
  definition.
- **`tuningPayload()` merges over `serverTuning`** (what `/api/weapon-tuning`
  returned on load) instead of replacing it outright — only the weapons touched
  *this session* are added/updated/removed; everything else passes through
  untouched. "Reset weapon" now explicitly resets to the pristine snapshot and,
  on save, that weapon is *removed* from the file (not left as a redundant
  identity patch).

Verified against a running server: saved sword, reloaded the page (fresh
in-memory state), saved a completely different weapon (spear) without ever
touching sword this session — sword's tuning and a pre-existing bow entry (real
user data) both survived three separate saves across two page loads. Reset +
save correctly removes a weapon from the file rather than leaving a stale patch.

## Builder: direct manipulation (2026-07-10)

Dennis kept getting robe geometry wrong through sliders alone and asked to move
parts himself. The Character & NPC Builder (`/creatures.html`) now has:

- **Click-to-select in the 3D preview** — raycast picks the body part under the
  cursor (a click, not a drag; a >4px move is treated as an orbit).
- **A TransformControls gizmo** on the selected shape: `G` move, `R` rotate,
  `S` scale, `Esc` deselect. It edits SLOT-LOCAL space (the mesh's parent is the
  slot pivot), which is exactly what the shape descriptor stores, so a drag
  writes straight back into `position` / `rotation` / `scale`. The rig is not
  rebuilt mid-drag (that would delete the mesh the gizmo is holding); the panel
  resyncs on release, and the gizmo re-attaches after every rebuild.
- **A numeric box beside every slider** — for exact values a slider can't hit
  (these bodies are numbers that have to line up), and it accepts values past
  the slider's range.

Verified: gizmo attaches to the clicked shape; dragging moves `skirt.position.y`
from -0.5 to -0.3 in the descriptor; typing -0.55 in the box moves both the
value and the slider handle.

## Fixes pass — save, character creator, grass, stones (2026-07-10)

Dennis's list, all five:

**1. "Save catalog doesn't do anything."** The bodies *were* saving; the WEAPON
GRIPS were not. I had built the grip/hold sliders as export-only (copy a snippet,
paste it into `weaponTypes.js`), which is not a way to work. Grips are now a
persisted catalog like everything else: `weapon-tuning/weapon-tuning.json`,
`GET/POST /api/weapon-tuning`, validated + `.bak` on save. `applyWeaponTuning()`
overlays it on the shipped defaults, and the game, the editor, the character
creator and the builder all apply it on load — so a grip tuned in the builder is
the grip the player sees. "Save catalog" now writes bodies *and* grips, and only
records weapons whose values actually differ from the defaults.

**2. Character creator used the old models.** It now builds from the same class
bodies the builder edits (`/api/character-types`), via
`src/generators/playerCharacter.js`. Appearance is applied by TINT ROLE rather
than by re-authoring presets: a shape is skin / hair / eye based on its id, so a
Warlock's dark robe stays his robe while his hands and face take the player's
skin tone. 6 hair styles (short, long, ponytail, spiky, bun, bald) as real shape
sets, 12 hair dyes, 7 skin tones, 7 eye colours. Gender and outfit colour are
gone: the body is part-based and the outfit belongs to the class.
**A hat is not hair** — picking "bald" strips the hair and keeps the Mage's hat.
Players in the live game render from these too.

**3. Grass followed the player.** Correct, and it was inherent to the design: the
old field scattered blades in a disc around the camera and re-scattered as you
walked. Replaced by `src/render/grassCover.js` — every authored `type: 'grass'`
prop becomes a tuft, and every tuft in the world merges into ONE static
InstancedMesh. Place it where you want it; still one draw call.

**4. Stones had holes.** `IcosahedronGeometry`/`DodecahedronGeometry` are
NON-INDEXED: a shared corner exists once per touching triangle. Jittering the
position buffer per-VERTEX moved each copy a different way and pulled the faces
apart. `src/generators/environment/jitter.js` now jitters per unique CORNER, so
every copy moves together and the surface stays closed. `check:props` grew a
watertight test (counts edges used by exactly two triangles); rocks and boulders
report 0 open edges.

**5. Size sliders too small.** Character/NPC Builder shape scale now goes to 3.0
(was 1.2), position to +/-2, slot anchors to +/-2..3.

## Visual overhaul — pass 2: scenery catalog + palette (2026-07-10)

**22 new prop types, and a picker to place them with.**

- **`src/sim/propTypes.js`** — the scenery catalog's METADATA: id, palette
  category, label, and how it collides. Pure (no Three), because the server has
  to size a collider without ever building a mesh.
- **`src/generators/props.js`** — the other half: id → builder. New generators in
  `environment/flora.js` (birch, dead tree, willow, bush, fern, reeds, mushroom,
  mushroom cluster, daisies, bluebells, stump, log, branch) and
  `environment/stones.js` (boulder, sharp rock, rock cluster, pebbles, crystal).
  26 types total. `buildPropPlaceholder` is now a one-line registry lookup
  instead of an if/else chain nobody would remember to extend.
- **`src/editor/sceneryPalette.js`** — the picker from the reference screenshot:
  category tabs (Trees / Small Plants / Rocks / Decor) over a grid of **rendered**
  thumbnails. Generated from the catalog, so a new prop type appears in both
  Place and Scatter for free. Thumbnails are rendered offscreen from the real
  builder and cached, so a thumbnail can never drift from what gets placed.
  Object Builder props appear as their own cells in the Decor tab.
- **Brush settings** on the scatter tool, matching the screenshot: pattern
  (scatter / hexagon / grid), radius, density, position variation, angle + angle
  variation, min/max scale, snap, and **overwrite** (clears props under the brush
  first — without it a second pass just doubles what's there).

**`npm run check:props`** (new, wired into `npm run check`) asserts: the two
halves of the catalog have identical id sets; every builder produces geometry (an
empty group is a silent invisible prop); every prop stands ON the ground; and
every blocking prop's collider actually covers its mesh. It found two real bugs
immediately — the boulder's mesh is 1.9x its seeded base radius, so a plain
`'rock'` collider under-covered it (you could walk into a boulder), and a fern
seed sank 8cm. Rocks are deliberately half-buried (`buried: true` in the
metadata), which the guard now knows about instead of me loosening the check.

### Still to do, in order

1. **Prop instancing.** Every prop is its own mesh + material. Now 26 types on a
   world you're about to fill — this is the next thing, and the prerequisite for
   a bigger world. Bucket by (type, seed-bucket) into `InstancedMesh`es; the
   editor keeps individual meshes for selection.
2. Ground textures (the cobble/dirt blends in the screenshots).
3. Drawable paths (spline → ribbon mesh, `world.paths[]`), which later doubles
   as the nav graph so NPCs prefer roads A→B.
4. Bigger world (chunked terrain + chunked prop loading).
5. Per-region atmosphere (`world.json` grows an `atmosphere` field per zone).

## Visual overhaul — pass 1: atmosphere + grass (2026-07-10)

Goal (Dennis): make the game look like the MMORPG-Tycoon-2 screenshots, then
add assets, drawable paths, and a bigger world, so he can build the world during
session limits. This is the first slice: **atmosphere and ground cover**, the two
things carrying most of that look.

- **`src/render/atmosphere.js`** — gradient sky dome (shader, inside of a sphere
  that follows the camera), **exponential fog whose colour IS the sky's horizon
  colour**, and preset-driven lights. The old setup used linear fog fading to a
  flat blue background, which left a hard band where the world ended. Matching
  fog to the horizon is what makes distant trees dissolve into the sky.
  Five presets: `meadow`, `pine` (snowy), `blossom` (pink), `gloom`, `dusk`.
  Switch with the `ATMOSPHERE` constant at the top of `src/main.js`.
  `updateAtmosphere()` per frame keeps the sky on the camera and the sun's
  shadow frustum on the player (snapped to an 8-unit grid so shadows don't
  shimmer), so shadows now exist away from the origin.
- ~~`src/render/grassField.js`~~ — a camera-following grass disc. **Replaced**
  by `src/render/grassCover.js` (see the fixes pass above): the disc re-scattered
  as you walked, so the grass visibly moved with the player and could never be
  authored. Grass is now placed, not followed.
- **Ground** is now elevation-blended vertex colours from the preset (`groundLow`
  → `groundHigh`) instead of one flat green.

**The one non-obvious trick, worth keeping:** a grass blade's real normals face
sideways, so an overhead sun barely lights them and the field renders as a
carpet of near-black spikes (it did, first try). Forcing every blade normal to
point straight up makes each blade take the same light as the ground under it,
and the field reads as one lit surface with texture.

`window.__game` exposes `{scene, camera, renderer, cameraControls, grass, world}`
for inspecting the live scene from the console.

### Next, in the order Dennis asked for

1. **More assets.** Tree types (birch, dead, bushy, palm), rock variants, more
   flowers, mushrooms, stumps, crystals, ground textures. The generators are the
   easy part; see #2 first.
2. **Prop instancing.** Every prop is currently its own mesh + own material —
   1064 draw calls on the current small world. Before "more assets" and "bigger
   world", props need batching by (type, seed-bucket) into `InstancedMesh`es.
   This is the load-bearing prerequisite for both.
3. **Drawable paths.** A spline tool in the World Editor emitting a ribbon mesh
   with the cobble texture from the screenshots. Store as `world.paths[]`
   (points + width + material). Later, NPC A→B movement prefers path nodes —
   which wants a nav graph built from the same spline data.
4. **Bigger world.** `world.bounds` is ±500 and the terrain heightmap is a single
   `(res+1)²` array; a much larger world wants chunked terrain + chunked prop
   loading. The grass field already doesn't care.
5. **Per-region atmosphere.** `world.json` grows an `atmosphere` field (or per
   zone), so Silvershadow can be snowy while the meadow is sunlit. The preset
   system is already shaped for this; only the plumbing is missing.

## Session handoff — 2026-07-10 (character/NPC overhaul, pass 1 of N)

Dennis asked for characters and NPCs that look like the MMORPG-Tycoon-2
"Character Type Editor" screenshots, hold different weapon types properly, and
get an NPC Builder like the Monster Builder. He chose: **one shared schema**,
**rig + weapons first** (no builder UI this pass), **fantasy-core weapon set**.

### What shipped

- **`src/sim/creatureTypeDefs.js`** — monsters, NPCs and characters are now one
  `CreatureTypeDef` with a `kind` discriminator. `monsterTypeDefs.js` is a thin
  façade fixing `kind:'monster'`, so `monster-types.json`, the server, the editor
  and `check-prefabs` are untouched. **Zero data migration**, same as the
  multi-ability monster work.
- **`src/sim/weaponTypes.js`** — 12 weapon types (sword, greatsword, dagger, axe,
  mace, hammer, spear, staff, wand, bow, crossbow, shield). Each carries a *grip*
  (weapon-relative-to-hand) and a *hold pose* (what the arms do), plus
  `swingScale` per limb. Pure data. `validateLoadout` rejects two-handed +
  off-hand, shield-in-main-hand, etc.
- **`src/generators/weapon.js`** — all 12 meshes, on a documented local-space
  convention (origin = grip point, +Y up the weapon, +Z the business face).
- **`src/generators/creatureRig.js`** — builds any creature; derives `handL`/
  `handR` attach points from each arm's lowest shape, parents weapons there, and
  stamps hold poses.
- **`src/generators/rig.js`** — `applyGaitPose` now composes ON TOP of a per-pivot
  base pose instead of overwriting rotation. This is what lets an archer's bow arm
  stay extended while he walks. Unarmed rigs are numerically unchanged.
- **`src/generators/characterPresets.js`** — a humanoid part library (9 heads incl.
  hats/hoods/helms, 7 torsos, 6 arms, 5 legs) and 10 complete prefabs: the 5
  classes + a Warlock, plus villager / town guard / merchant / hooded stranger.
- **`/creatures.html`** (`src/creature-preview/`) — dev harness rendering every
  prefab, every grip, idle/walk. Built because the new bodies otherwise had no
  surface that renders them, and because grips must be *seen*.
- `generateCharacter` (the live player mesh) now routes weapons through the same
  grips + hold poses, so the game already benefits. `generateWeaponSet` is gone.
- `seededRandom.js`'s second mulberry32 was folded into `src/sim/rng.js`.

### Pass 2 — the Character & NPC Builder (`/creatures.html`)

Dennis, after three rounds of me failing to fix the arms: *"just let me fix it
manually. Create the NPC builder with the option to adjust the classes."* Right
call. The builder now exists and everything is editable in it:

- **Catalog** of humanoid types, new/duplicate/delete/rename, kind switch. The
  five player classes are ordinary `kind: 'character'` rows, so tuning a class
  model is the same act as authoring an NPC. Seeded on the server's first run
  from `characterPresets.js` into `character-types/character-types.json`
  (`GET/POST /api/character-types`, validated + `.bak` on save like every other
  catalog).
- **Per-slot editing**: the slot ANCHOR (x/y/z) — the knob that decides whether
  an arm sits inside the chest — plus part presets, a shape list, add/delete
  shape, and per-shape kind/position/scale/rotation/colour.
- **Weapon grip + arm hold sliders**, export-only: they drive the preview and
  emit a `weaponTypes.js` snippet to paste. Sim stays the source of truth so the
  builder and the game can't drift.

**And the arms are actually fixed, verified by measurement rather than by eye.**
Three separate causes, each of which I "fixed" and re-broke:
1. anchor buried inside the chest (x=±0.20 vs a ±0.26 half-width);
2. anchor merely ON the surface (±0.29) while the arm's own 0.08 radius still
   left half the limb inside — the anchor must be `chestHalf + armRadius` = 0.34;
3. an inward `z` roll in every weapon's hold pose, which rolled the limb back
   into the chest. **The z sign MIRRORS between arms**: negative tucks the right
   arm in, positive tucks the left arm in. I had left arms rolled inward.

`check:prefabs` now has an **arms-clear-of-the-torso** check: it idle-poses each
prefab and compares the upper arm's inner face against the chest's outer face,
per arm, in world space. Connectivity alone can't catch this — an arm buried in
the chest is, after all, extremely connected. Verified it fails on an injected
bad anchor. All 20 arms clear.

### Pass 1b — the weapons were held wrong, and a grip tuner

Dennis looked at pass 1 and said: arms still go inside the body, staves and the
spear are upside down, the warrior holds his greatsword wrong, the archer grips
the *string* and holds his arm out permanently, and nothing looks held in the
hand. He was right on every count. Four distinct bugs:

1. **The shoulder pivot was buried inside the torso** (x=±0.20 against a ±0.26
   half-width chest). The anchor is what the limb ROTATES ABOUT, so every
   forward swing swept the arm through the ribcage. Pivots now sit on the
   torso's surface at x=±0.29; the joint sphere still reaches back inside, which
   is what connectivity actually requires. Over-applying "anchor inside the
   torso" was my mistake — the rule is *overlapping solids*, not a buried pivot.
2. **`handAnchorFor` returned the lowest shape's BOTTOM, not its centre**, so
   weapons hung off the underside of the fist. Invisible on a hanging arm;
   glaring on a raised one, where "below the hand" points forward.
3. **The grip pitches all had the wrong sign.** Three's `rotation.x` maps
   `(0,1,0) -> (0,cos t,sin t)`: a NEGATIVE x tilts a weapon's +Y end (staff orb,
   spear point) BACKWARD and a blade's tip FORWARD. Every melee weapon had a
   negative net pitch, so the staff and spear leaned their heads back *through
   the character's own torso* (the mage's orb measured at z=-0.13, inside his
   back — which is why it looked "upside down": you only ever saw the shaft
   below the hand) and the greatsword couched forward like a lance. Both blades
   and shafts want a POSITIVE net pitch. This is now written at the top of
   `weaponTypes.js`, because it is the single easiest thing here to invert.
4. **`grip.position.y` was being used to fix floor clipping**, which "fixes" the
   clip by sliding the weapon up out of the fist (sword: 16cm above the hand).
   Meshes now define their own grip point: a staff/spear's origin is the upper
   third of the shaft, a bow's origin is the RISER (centring the torus put the
   fist on the chord — i.e. gripping the bowstring). `grip.position.y` must stay
   ~0; a forward `z` nudge is the opposite, and *required*, since arm and weapon
   share an axis and a shaft at z=0 hides inside the forearm.

The archer now **carries** his bow at his side rather than holding a permanent
draw. A drawn pose needs the draw hand at the string near the cheek, and these
rigs have no elbow — the forearm can't fold, so it read as pointing a hoop.
Drawing belongs to an attack animation.

**New guards** (all in `check:prefabs`): grip-offset limits (y ≈ 0 or it floats
out of the fist), net-pitch reporting per weapon, ranged weapons must be within
5° of level, and floor clearance per prefab. The floor check caught two clips I
had already eyeballed and called fine.

**New: a grip/pose tuner** in `/creatures.html`. Sliders for grip position,
grip rotation, and both arms' hold (x/y/z/swingScale), live on the model, plus a
"Copy weaponTypes.js snippet" button. Nothing is persisted — `src/sim/weaponTypes.js`
stays the source of truth, so the preview and the game can never drift. Tune
there, paste the snippet in. `window.__preview` exposes the live scene graph;
measuring the rendered rig (rather than a freshly-built one) is what finally
located bug #3.

### Three bugs the headless tests could not see, and the guards that now can

1. **The arms were buried inside the torso.** Anchors sat at x=±0.24 inside a
   ±0.31 half-width chest, so the limbs never emerged — it looked like a creature
   with no arms, and `check:prefabs` called it *connected*, because it was.
   Fixed by narrowing the torso and stepping the arm's shapes outward from the
   joint (`ARM_OUT`), which forced arm presets to be authored right-side-only and
   mirrored (`mirrorShapes`).
2. **The bow lay flat, aiming at the sky.** These rigs have no wrist, so the
   weapon inherits the shoulder's whole rotation; a bow arm raised 68° carries the
   bow 68° out of vertical with it. Fixed by making a ranged weapon's grip cancel
   its arm's hold pitch. `check:prefabs` now prints each weapon's **net pitch** and
   fails a ranged weapon over 5°.
3. **Sword and spear tips punched through the floor.** Chibi arms are short (the
   hand rests at y≈0.52), so long weapons need a deliberate backward lean.
   `check:prefabs` now assembles each prefab, idle-poses it, and **measures the
   lowest weapon vertex** — it caught the guardian (-0.034) and the town guard
   (-0.043) after I had already eyeballed both and called them fine.

Also verified: the connectivity guard genuinely *fails* on a floating hat and a
detached arm (injected, then reverted); the schema rejects each illegal loadout;
a quadruped handed a sword builds without throwing and simply holds nothing; the
bow arm holds -68° through a full walk cycle while the legs still swing 63°.

### Known gaps (the next passes)

- **No builder UI yet.** The Character/NPC Builder modal is the next piece — the
  Monster Builder's Model Editor should be generalized rather than copied. The
  weapon-type checkbox grid from the screenshots maps to `allowedWeaponTypes`.
- **Hats and hair are shapes inside the head slot, not their own slots.** The
  screenshots separate Head / Hat columns for combinatorics. Adding `hair`/`hat`
  slot roles means deciding whether they follow the head pivot.
- **Nothing in the live game renders a `CreatureTypeDef` humanoid yet.** Players
  and NPCs still use the parametric `generateCharacter`. Swapping them over is a
  deliberate, separate step (character creation UI depends on the old params).
- **Warrior now carries a greatsword** rather than a sword (it's the natural
  two-handed showcase). Easy to revert in `CLASS_LOADOUTS`.
- No dual-wield (`slot:'either'` exists but nothing uses it), no back-slung
  weapons when sheathed, no per-weapon attack animation (the generic attack pose
  now swings from the weapon's hold pose, which is at least correct).

---

## Session handoff — 2026-07-10 (later session: guard + collision)

Two things shipped, in this order, and the first one paid for the second.

### 2. Collision (roadmap #13) — overworld statics

`src/sim/collision.js`. Circle colliders for trees, rocks and custom Object
Builder props; OBB colliders for building footprints and wall segments; grass
and flowers pass through. 499 colliders over the current world, bucketed into a
16-unit spatial grid. `resolveMovement` sweeps each step in 0.2-unit sub-steps
(so nothing tunnels through a trunk on a lag spike) and slides along obstacles
rather than sticking.

Applied to player movement, overworld monster chase, and NPC wander — all
server-authoritative. The client's prediction step calls the **same pure
function** on an index built from the same `world.json` + object catalog; if
the two ever disagreed the player would stutter against every tree. Tower
floors and the store interior pass `null` and keep the old free movement (they
are bare rooms). The server rebuilds its index on `POST /api/world` and
`POST /api/objects`.

**The idea worth keeping: a collider is never a hand-tuned guess at a prop's
size.** A tree's collision radius is its *actual* trunk radius. Getting that
required a real change: the generators' parameter sampling moved down into
`src/sim/propMetrics.js` (pure, Three-free), and `generateTree`/`generateRock`
became "build meshes from this descriptor". Now the server can know a tree's
trunk radius without loading Three, and changing how a tree looks moves its
collider with it. The alternative — hardcoding `r = 0.35` in sim — silently
rots the first time someone edits the generator.

That refactor was verified by fingerprinting geometry (every mesh's transform,
geometry params, vertex-position checksum, and material color) across 360
generated trees and rocks before and after: **identical hash**, so the move
changed nothing visible.

Also verified headlessly against the real `world.json`: a head-on walk stops
exactly at `trunkRadius + PLAYER_RADIUS`; a single 16-unit step across a trunk
does not tunnel; a diagonal approach to the store slides along it instead of
sticking; the store is **still enterable** (closest approach 4.40 < the 5-unit
server gate — worth re-checking if a building's footprint ever grows past
that); the spawn point, every NPC, every overworld monster and every gathering
node starts un-stuck; passing no index reproduces the old movement exactly; and
100k `resolveMovement` calls take 17ms (0.2µs each), which the 20Hz tick can
afford many times over.

Not done: entity-vs-entity collision (players and monsters still walk through
each other), tower floors, interiors, terrain slope. Invisible walls are now
nearly free — a `walls` entry already yields an OBB collider, so it just needs
an editor mode that skips the mesh.

While here: `src/generators/seededRandom.js` was a second copy of mulberry32.
It now re-exports `src/sim/rng.js`. One PRNG in the project.

### 1. The architecture guard

Ported the reference project's `tests/architecture.test.ts` as
`scripts/check-architecture.mjs` (`npm run check:arch`; `npm run check` runs it
plus `check:prefabs`). It scans every `src/sim` file and fails on a forbidden
import, a DOM global, or `Math.random`/`Date.now`/`performance.now`.

**It was not a formality — the tree was already violating all three rules:**

1. `src/sim/objectDefs.js` and `src/sim/monsterTypeDefs.js` imported
   `../generators/custom.js`, which does `import * as THREE from 'three'`. So
   **the server was loading Three.js at startup**, transitively, just to read a
   `SHAPE_KINDS` string array. That array now lives at `src/sim/shapeKinds.js`
   (`custom.js` re-exports it, so renderer-side callers are unchanged).
2. `src/sim/npc.js` called `Math.random()` three times (wander angle, distance,
   pause length).
3. `src/sim/gathering.js` had `rng = Math.random` as a **default parameter** —
   the subtlest of the three, since every call site looked clean.

Fixed by adding `src/sim/rng.js` (a seeded mulberry32). The caller now owns the
generator and threads it in, exactly as it already threads `dt`/`now`:
`rollYield(nodeType, rng)` and `stepNpcWander(npc, dt, now, rng)` both **throw**
if it's missing, so a new call site can't quietly reintroduce the old default.
`server/index.js` creates the one live generator. Seeding it from a constant
instead of the clock makes a whole session replayable — which is what the bot
harness will want.

Verified: guard passes; guard **fails on injected violations** (5/5 caught, and
a `Math.random()` in a comment correctly ignored); `check:prefabs` still passes;
server boots and serves `/api/monster-types` (the parse path through the moved
constant); `rollYield` reproduces its 65/35 table and is deterministic per seed.

The guard self-tests its own matchers before scanning and refuses to run if they
have lost their teeth — the direct lesson from the `check-prefabs` story below.

---

## Session handoff — 2026-07-10 (read this first)

Everything below is finished, verified, and left clean — **nothing is
mid-implementation**. No server left running. All *my* test data was cleaned
out after verification.

**What's in the data files is Dennis's own work — don't "clean" it:**
- `monster-types/monster-types.json` → one monster, `test2`.
- `objects/objects.json` → one object, `test` (4 shapes).
- `world/world.json` → one placed `type:'custom'` prop at (-8, 76) scaled
  2.5, referencing that `test` object. This is the Object Builder → Place
  mode round-trip working, not leftover junk.
- `*.json.bak` files are normal: every `POST /api/*` writes a backup before
  overwriting. Not test residue.

**Sanity command before you touch anything:** `npm run check:prefabs`
— should print `14 prefabs — 0 detached shape(s), 0 invalid.` / `PASS`.

### What shipped this session (the "builder vision", section E)

The whole session was roadmap section E, in five passes. `WORLD_BUILDER_ROADMAP.md`
has the blow-by-blow with dates; the short version:

1. **Object Builder** (World Editor mode, hotkey `B`) — compose props from
   primitive shapes, save to a named catalog (`objects/objects.json`,
   `GET/POST /api/objects`), place them as `type:'custom'` props. Coexists
   with the old parametric generators; nothing about existing props changed.
2. **Animation system generalized** — `src/generators/rig.js` replaced the
   hardcoded 4-limb walk cycle with data-driven `GAIT_TABLES` +
   `applyGaitPose`/`applyIdlePose`/`applyAttackPose`. Player animation is
   numerically identical to before (verified to ~1e-15).
3. **Monster Builder** — a tabbed modal (the first modal UI in this codebase,
   `src/editor/modal.js`) authoring a reusable *monster type*
   (`monster-types/monster-types.json`, `GET/POST /api/monster-types`),
   separate from a placed spawn, mirroring the Object Builder catalog split.
   Model Editor with per-body-part slots, live 3D preview, real rendered
   preset thumbnails, Abilities tab (level-gated moveset), Prefabs tab.
4. **Multi-ability monster combat** — `stepMonsterAI` picks the first
   off-cooldown ability from its moveset. Legacy spawns (slime/goblin/
   boss-golem) synthesize a single ability from their old `damage`/
   `attackCooldownMs`, so **zero data migration**. Monster attacks now emit
   VFX via a new `monster-ability-used` socket event.
5. **Per-monster walk animation** — `MonsterTypeDef.animation.walk` (an
   array of `{part, axis, amplitudeDeg, phaseDeg}`), edited in a Walk
   Animation panel (Model Editor → Settings). `resolveGaitTable()` is used
   *identically* by the editor preview and the live game so they can't drift.

Also fixed along the way: **monsters never animated in-game at all** —
`updateWalkCycle` was only ever called on players and NPCs. Monster positions
now route through `applyRemotePosition` (movement detection + facing) and the
walk cycle runs for overworld + floor monsters.

### Two hard-won lessons — please don't relearn these

**1. `npm run check:prefabs` before calling any preset work done.**
Creature prefabs kept shipping with limbs/eyes floating detached from the
body. It is *invisible* while editing one body-part tab and hides behind
geometry in screenshots. `src/generators/monsterConnectivity.js` now tests
**per-shape solid overlap** (point-in-primitive + union-find) and requires
the whole creature to be one connected piece. It's also wired into the
editor's Save button as a non-blocking warning.

**2. Validate the guard before trusting it.** The *first* version of that
checker compared per-slot **bounding boxes** with a 0.05 tolerance and
reported a confident `PASS` on visibly broken creatures (an arm 0.045 outside
a torso slipped the tolerance; an eye inside its own head's slot was never
compared at all). I shipped it and Dennis had to point at the screen again.
Under the honest per-shape check the roster scored **91 detached shapes**,
now 0. Feed a new checker known-bad input and confirm it *fails*.

The structural rule that keeps creatures connected: **a limb slot's anchor
sits INSIDE the torso solid**, each limb starts with a joint sphere at its
own origin, and head details are placed on the head's real surface via the
`surf()` helper. Never eyeball coordinates — non-uniform `scale` makes them
lie (a capsule scaled `{0.32,0.48,0.26}` has an x-radius of only **0.112**).

### Known gaps in what just shipped

- **The spider only animates 4 of its 8 legs.** `SLOT_ROLES` has exactly four
  leg roles, so its other four legs are static shapes baked into the torso —
  geometry, not joints. Fixing needs extra/free-form leg slots (touches the
  role enum, validator, default anchors, part-tab UI, and the prefab).
- Animation is a **procedural sine gait**, not keyframes. Fine for walk
  cycles and idle sway; a timeline/clip editor is its own planning pass.
- **Prefabs tab is only whole-body starter creatures.** Saving your *own*
  part/body presets ("Prefabs" in the reference sense) is still deferred.
- Monster Builder abilities are `melee|ranged` only — no heal/buff, because
  `stepMonsterAI` has no ally-targeting.
- Primitive-composed creatures have an honest fidelity ceiling. See the
  reference-project note below.

### New: `world-of-claudecraft-REFERENCE ONLY/` (read-only)

Dennis dropped a **working, shipped MMO built with Claude** inside the
project folder, as a reference to learn from. **Do not modify it.** Caveats:

- It lives at `fantasy-mmo/world-of-claudecraft-REFERENCE ONLY/` — i.e.
  *inside* our project. It's **415 MB / ~4,853 files**, so unscoped
  `find`/`grep`/globs across the repo will be slow and noisy. Scope searches
  to `src/`, `server/`, `public/`, etc. It is **not** served by our Express
  (`server/index.js` serves only `public/` and `src/`), so it can't break the
  running game. This project isn't a git repo, so it isn't gitignorable.

What's actually worth stealing from it (surveyed, not yet applied):

- **Same `src/{sim,render,net}` split as us** — encouraging. But they
  *enforce* it: `tests/architecture.test.ts` asserts `src/sim` imports
  nothing from render/ui/game/net or Three, touches no DOM, and draws no
  `Math.random`/`Date.now`. Ours was convention-only prose in `CLAUDE.md`;
  **ported 2026-07-10 as `npm run check:arch`** (see the newer handoff above).
- **Monsters are data-driven `MobTemplate`s** (`src/sim/content/delves/mobs.ts`):
  `{id, name, minLevel, maxLevel, family, hpBase, hpPerLevel, dmgBase,
  dmgPerLevel, attackSpeed, armorPerLevel, moveSpeed, aggroRadius, loot[],
  scale, color}` — plus **per-mob mechanics as optional typed fields**
  (`corrode`, `aoePulse`, `packFrenzy`) rather than a generic ability list.
  Two things we lack: **level-scaled stats** (`hpBase + hpPerLevel`; our
  `baseStats` are flat) and a **`family`** tag that groups mobs for shared
  audio (`public/audio/sfx/mob_undead_*.mp3`) and behavior.
- **Their creatures are 29 authored `.glb` models** (`public/models/creatures/`),
  content-hash-manifested, *not* procedural primitives. So the reference does
  **not** teach us how to make better primitive monsters — it shows they
  sidestepped that ceiling entirely with real assets + a loader/manifest.
  Relevant to the "custom model (FBX/glTF) import" roadmap item.
- Also present and potentially instructive: `bot/` (they have simulated
  players — we want these), `headless/`, extensive `docs/design/`, and
  `src/sim/colliders.ts` (which we since ported the shape of — see the newer
  handoff above; their swept-slide + spatial-grid structure is what
  `src/sim/collision.js` follows).

### Working-style notes for whoever picks this up

- Dennis tests in the browser himself — don't run heavy `preview_start` /
  screenshot loops for routine verification. Prefer cheap deterministic
  checks (`node --check`, unit-style node scripts, `npm run check:prefabs`,
  curl against the API). **Exception:** genuinely novel or visual work, and
  anything where a screenshot could lie — see the two lessons above.
- **Test modal / embedded-canvas UI at several viewport widths.** A canvas is
  a replaced element: `createRenderer()` leaves an inline `style="width:..px"`
  on it (from `setSize`) that silently beats any CSS rule, and nested flex
  containers need `min-height:0`/`min-width:0` to scroll instead of overflow.
  Both bugs shipped once each.
- If you write a Node script that opens a `socket.io-client` connection,
  import `socket.io-client/build/esm/index.js`, **not** `dist/socket.io.js`
  (the browser UMD bundle silently fails to connect under plain Node).
- `WORLD_BUILDER_ROADMAP.md` is kept current as things ship — mark items done
  there (with a date) rather than letting this doc and that one drift apart.
- There's a persistent memory system outside this repo with Dennis's
  preferences and open threads — check it too.

---

## What's built

### Phase 1 — Foundation
- Clean `sim` / `render` / `net` split, exactly as specified in `CLAUDE.md`.
- Server-authoritative movement: a 20Hz tick loop runs `stepMovement`
  against sanitized client input; the client never dictates its own position.
- Client-side prediction with **smooth** reconciliation (blends toward the
  server's position gradually; only hard-snaps on large discrepancies like
  teleports).
- Fixed JSON world loading (`world/world.json`), validated by `parseWorld`.

### Phase 2 — Procedural asset generator library
- Chibi character generator: gender, hair style/color, eye color, skin
  tone, outfit color, face shape (down to just "round").
- Environment generators: trees, rocks (+ ore deposit variant), grass
  patches, flowers, a water plane, a terrain patch, wall segments,
  **4 distinct building shell shapes** (cottage/shop/guild-hall/longhouse,
  selected by the building's `type` field).
- Interior furniture generators: table, chair, bed, shelf, counter.
- Weapon generator (`generators/weapon.js`): per-class weapon/offhand.
- **Monster generator** (`generators/monster.js`): slime, goblin, boss-golem.

### Phase 3 — World Editor
The editor's chrome was fully redesigned this session: a **floating flyout
panel** (top-left) shows the active tool's controls, and a **bottom
icon-toolbar with numbered hotkeys (1–9, then 0)** is the primary mode
switcher — replacing the old top tab row, which had started overflowing as
modes were added. 10 modes now exist:

1. **Place** — click-to-place trees/rocks/flowers/grass/walls, grid snap,
   select → rotate/scale/**recolor** (HSL hue-shift, preserves per-material
   lightness so it doesn't flatten shading)/delete.
2. **Scatter** — brush-based bulk placement, density/min-max scale
   randomization, brush-radius indicator, generalized "erase any type."
3. **Terrain** — height painting, mountain preset (taller/jagged).
4. **Water** — lake painting (baked-texture mesh, not per-vertex color).
5. **Zones** — gathering/city/tower zone tagging.
6. **Buildings** — placement + the 4 shape types above.
7. **Monsters** — place/edit/delete monster spawns with full stats (HP,
   damage, speed, ranges, cooldown, boss flag, optional XP-reward override,
   optional quest-group tag, optional respawn time). Works on **both** tower
   floors and the overworld now (floor dropdown includes "🌍 Overworld").
8. **Items** — author a gear/weapon/quest-item catalog with icon upload.
9. **NPCs** — place wandering town NPCs with dialog.
0. **Quests** — author kill/gather/talk quests tied to a giver NPC.

Save/load to the server via `/api/world` (+ per-floor `/api/tower/floor/:n`,
`/api/items`, `/api/quests`), all with server-side validation and automatic
`.bak` backups on save.

### Phase 4 — Character system
- Character creation UI: appearance controls with a live 3D preview, class
  selection, persistence (`localStorage`).
- 5 classes × 5 abilities each (25 total), server-validated cooldowns/costs.
- **Leveling/XP**: killing a monster (anywhere — see Phase 5 note) grants
  XP; level-ups fully heal and raise max HP (per-class growth curve) and
  scale outgoing ability power. XP bar + level-up banner in the HUD.
- Hotbar UI with live cooldown countdown and resource bar.
- Ability animations: three-phase windup/effect/recovery via a colored
  burst effect — the character model itself never scales/rotates.
- Real walk-cycle animation, camera-relative movement, free-orbit camera.

### Phase 5 — The Tower, and monsters beyond it
- 5 hand-authored floors (`tower/floors/*.json`), floor 5 a boss floor.
- Tower entry/exit/advance, server-validated against real proximity.
- Each floor is a room-scoped Socket.io instance.
- Monster AI: chases within aggro range, attacks on cooldown, locks onto
  whoever damages it regardless of distance.
- Floor-clear gating, boss-defeated banner, death/respawn (3s, full heal).
- **Monsters are no longer tower-exclusive** (design reversal, 2026-07-09 —
  `CLAUDE.md`'s World Setting section updated). `world.json` has its own
  `monsters` array, authored via the same editor Monsters mode. Overworld
  monsters:
  - Share one global list (not instanced per-floor like tower monsters).
  - **Respawn** at full health at their home position after `respawnMs`
    (default 30s, editable per-monster) — tower floor monsters intentionally
    do NOT respawn once a floor is cleared; that's the dungeon mechanic.
  - Carry an optional `group` tag so kill-quests can target "slimes in area
    A" without also counting "slimes in area B."
- Combat resolution (`resolveAbilityEffect` in `server/index.js`) picks the
  right monster list — overworld shared list, or the current floor's — based
  on where the player actually is. Healing works everywhere now too (it was
  accidentally gated behind the old tower-only check).

### Phase 6 — Gathering, crafting, economy
- 12 gathering nodes, chance-based yield tables, server-validated cooldowns.
- 5 crafting recipes, 2 real consumables (healAmount, usable anywhere).
- Vendor selling inside the store interior, near an actual NPC.
- Gold tracking, inventory UI, toast feedback.
- **Player-to-player trade is still NOT built** (see Known limitations).

### Phase 7 — City life & progression (partial)
- **NPCs**: placeable via the editor, idle-wander AI (server-authoritative,
  stays within a radius of home, pauses between wanders), 2–4 line dialog
  shown via walk-up-and-press-E, billboarded name-label sprites.
- **Quests**: full catalog + state machine. Three of four originally-scoped
  objective types work: kill N of a monster group, bring N of an item
  (consumes inventory on turn-in), talk to an NPC. The fourth — interact
  with a world object — is blocked on the interaction/trigger system
  (`WORLD_BUILDER_ROADMAP.md` #15), which doesn't exist. Quest engine
  functions are pure/socket-free by design (bot-readiness — see below).
  **Quest progress is in-memory, resets on server restart** — no
  persistence yet.
- **Not built**: the Adventurer Guild quest board specifically as described
  in `CLAUDE.md` (quests are currently NPC-given, not board-based — could
  still add a board UI that lists available quests without much rework); a
  separate guild *system* (persistent membership + activity-based rewards)
  is a distinct, unbuilt idea (see roadmap idea backlog, section C).

### Phase 8 — Multiplayer social layer (partial)
- **Party system**: invite (P key, nearest player) / accept (Y) / leave,
  cap of 4, leader promotion on leave, auto-disband below 2 members. Party
  panel shows member HP bars. **Shared kill credit**: the last-hitter plus
  any same-location party member within range both get full XP and
  kill-quest progress — a party can grind the same quest together.
  Deliberately built as bot-callable plain functions (`src/sim/party.js` +
  the manager functions in `server/index.js`), not socket closures, so a
  future bot system uses the identical API.
- **Not built**: minimap; per-party tower instancing (floors are still
  globally shared — everyone on a floor sees each other, party or not);
  loot rules (no loot system exists to have rules about).

### Phase 9 — UI polish (not really started)
- Still using ad-hoc panels, not the drag-drop inventory grid `CLAUDE.md`
  specifies. No chat system exists at all (say/party/guild channels are
  spec'd, none built). No settings panel.

### Not part of the original phase list
- **Enterable store interiors** (Phase 6-adjacent): a hand-built room
  instance, same pattern as the Tower, predates this session.
- **Simulated-player "bots"**: not built, but the quest and party engines
  were deliberately built bot-ready this session (pure functions, not
  socket closures) in anticipation of this.
- **A toon-shading + bloom experiment**: `MeshToonMaterial` conversion
  (`toonify` in `src/render/scene.js`) + a subtle `UnrealBloomPass`, applied
  to the live game only (not the World Editor, which keeps plain lit
  materials — it's a blockout tool). Kept, but Dennis found it not very
  noticeable — the real gap for the "make it look like the reference
  screenshots" ask is geometry detail (flat primitive shapes), not shading
  technique. This is part of the motivation for the "builder vision" idea
  in the roadmap's idea backlog (section E) — a part/shape-based modeling
  system instead of parametric generators.

### Performance & rendering fixes
- Removed several per-frame `Vector3` allocations from the render loop.
- Fixed the directional light's shadow camera frustum (was defaulting to
  ±5 units). Editor disables shadows entirely; tree foliage doesn't cast
  shadows (trunks still do).

---

## Known limitations (not bugs so much as things not built yet)

- **Collision covers overworld statics only** (done 2026-07-10). No
  entity-vs-entity collision — players and monsters walk through each other.
  Tower floors and interiors have no colliders (nothing in them to hit yet),
  and terrain slope doesn't block. Keyed doors and PvP zone edges still also
  want the interaction/trigger system.
- **No persistence.** Prisma is still stubbed out — player state, inventory,
  gold, level, **quest progress, and party membership** all live in server
  memory and reset on restart. The case for finally wiring this up keeps
  growing (quests and the proposed guild system are the two strongest
  motivators now).
- **No player-to-player trade.**
- **No chat system at all** — no say/party/guild channels exist. This also
  blocks the "right-click a player → chat" idea from the 2026-07-09 backlog.
- **No minimap.**
- **No real inventory/settings UI** — still a functional list, not the
  drag-drop grid `CLAUDE.md` specifies.
- **No guild system** (distinct from the party system — persistent
  membership + activity rewards, not built).
- **No loot system** — nothing drops from monsters, so item rewards only
  come from quests/vendors/crafting. Blocks a "real" item economy.
- **Quest interact-with-object type** — blocked on the interaction/trigger
  system.
- **No per-party tower instancing** — floors are shared globally, not
  per-party.
- **Item system has no gameplay effect** — the authored catalog exists but
  nothing equips it, no stats apply, no loot grants it.
- **Monster stats are flat, not level-scaled.** `MonsterTypeDef.baseStats` is
  a fixed maxHealth/damage/etc. The reference project uses
  `hpBase + hpPerLevel` (see the reference note in the handoff) — worth
  copying if monster levels ever become a real axis.
- **Only 4 leg slots exist** (`SLOT_ROLES`), so 8-legged creatures like the
  spider have half their legs baked into the torso as static geometry.
- ~~**`src/sim` purity is convention only**~~ — **fixed 2026-07-10**, now
  enforced by `npm run check:arch`. See the handoff at the top.

---

## What's queued in `WORLD_BUILDER_ROADMAP.md`

The original numbered wishlist (items 1–21) is now mostly resolved: NPCs,
quests, monster placement, building types, environment props, item system +
icon uploads, editor UX polish, monster respawn/group tags/XP override, and
object recoloring are all done (each marked with a date in that file).
Still open from that original list: larger maps, ability authoring + a real
animation library, custom model import + audio, a generalized instance/
portal system, drawn paths/fences/bridges, the interaction/trigger system,
loot + chests + keyed doors, atmosphere/post-processing settings, particle
effects, and full monster/NPC stat authoring's remaining gaps (level,
defense, an actual ability set for monsters).

A large **new idea backlog was added 2026-07-09** (see that section at the
end of the roadmap doc), organized A–E:
- **A. Bugs** — all 3 done this session.
- **B. Quest follow-ups** — questlog changes (needs Dennis's input on what),
  optional turn-in dialog, minimap w/ quest region.
- **C. Social/progression** — right-click→invite/chat (+ a chat system),
  guild system with daily activity-reward tiers, drawable PvP zones.
- **D. Editor** — freeform zone drawing (→ per-zone music), monster
  respawn (done), monster size/color, export/import presets.
- **E. The "builder" vision** — a major, engine-scale shift to part/shape-
  based building (Object Builder, Monster Builder, part-based character
  creation, a whole-game graphics transition, an animation/rig system, a
  Place/Scatter UI rework) modeled on MMORPG Tycoon 2 screenshots Dennis
  supplied. **Needs its own planning pass and probably a prototype before
  committing** — it's bigger than everything else on this document combined.

Collision and the interaction-event system remain the two items most other
unbuilt features quietly depend on (chests, keyed doors, lootable props,
PvP zone edges).

---

## Recommendation: what to do next

Section E (the builder vision) is now **largely built** — Object Builder,
Monster Builder, the animation system, and the creature prefab library all
shipped 2026-07-09/10. What remains of E is Character Creation and the
whole-game graphics transition. Rough priority order:

1. **Small follow-ons to what just shipped**, if you want to keep moving
   without a design conversation:
   - Free-form / extra leg slots so the spider animates all 8 legs.
   - Level-scaled monster stats (`hpBase + hpPerLevel`), copying the
     reference project's `MobTemplate`.
   - A `family` tag on monster types (drives shared audio/behavior — again
     straight from the reference).
   - Saving your own part/body presets (the deferred half of "Prefabs").

2. ~~**Steal the architecture test from the reference.**~~ **Done 2026-07-10**
   as `scripts/check-architecture.mjs`. It found a Three.js leak into the
   server and two determinism violations; see the handoff at the top.

3. **Character/NPC overhaul.** Pass 1 (shared schema, part-based humanoid rig,
   weapon grips, preset library) shipped 2026-07-10 — see the handoff at the top.
   Next: the Character/NPC Builder UI, then swapping the live game's players and
   NPCs off the parametric `generateCharacter`.

4. ~~**Collision.**~~ **Done 2026-07-10** for overworld statics; see the
   handoff at the top. What's left is entity-vs-entity, floors/interiors, and
   terrain slope.

5. **Persistence (Prisma).** Quest progress, party state, and a prospective
   guild system all want it. Its own scoped piece, not an ad-hoc bolt-on.

6. **Bot NPCs.** Explicitly requested; the quest/party engines were
   deliberately built bot-ready (pure functions, not socket closures). The
   reference project has a `bot/` directory — read it before designing ours.

7. **Quest follow-ups (roadmap section B)** — the questlog-changes item still
   needs Dennis to say what he wants; turn-in dialog and minimap are
   otherwise well-scoped.

Trade (Phase 6's dangling piece) and the Adventurer Guild quest *board* UI
remain lower urgency — quests work via NPCs already, and trade hasn't come up
again since it was first flagged.

A **keyframe/timeline animation editor** is the one genuinely large unstarted
idea adjacent to this session's work. Don't start it without a planning pass;
the current procedural sine gait may well be enough.
