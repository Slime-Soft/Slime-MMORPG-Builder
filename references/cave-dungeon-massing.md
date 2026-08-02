# Cave dungeon kit — massing spec

Written BEFORE any code, from the six reference sheets Dennis attached on
2026-08-02. Same discipline as the trade-building specs in this folder: this is
a **transcription of what is visible, region by region**, not a description of
what a cave "is". Naming a region ("a slab with spikes hanging under it") is
safe. Naming a concept ("a cavern") imports everything I already believe about
caves and silently overwrites the reference.

Six sheets:

1. cave walls (arches, wall blocks, piers)
2. cave floor tiles + floor stone decor
3. pillars, stalagmites, stalactites, ceiling chunks, a rock arch
4. torches, hanging lanterns, braziers, crystals
5. more decor (boulders, an ore boulder, a green pool, candles)
6. an assembled room, as a target for how the pieces read together

---

## 0. The shared look (read off ALL six sheets)

This is the part that has to be right or nothing else matters. Every sheet
shares one material treatment:

- **Stone body is nearly black, and BLUE.** Not grey. Large faces read around
  `#232a36`; faces turned away from the light go to `#1a1f2a`; up-facing tops
  are the lightest at roughly `#2f3849`. The existing rock library
  (`stones.js`, `0x8a8a8a` etc.) is a completely different, warm mid-grey — the
  cave pieces must NOT reuse it.
- **Every crack and joint glows warm tan.** This is the single strongest
  identity feature of the whole set: the seams between blocks, the chamfers on
  top edges, and the cracks running down big faces are all a warm ochre,
  roughly `#8a6a3f` at its dullest and `#b8925a` where it catches light. It
  reads like lamplight caught in the grout. Without it the pieces are just
  black boxes.
- **Blocks are chunky, faceted, few-sided.** Each cobble/block is an irregular
  5–7 sided flat-topped chunk, not a smooth rock and not a cube. Top faces are
  flat and clearly separated; the sides are steep and slightly tapered.
- **Blocks are stacked, and the stacking is legible** — you can count them.
  Big pieces are 2–4 blocks across and 3–6 courses tall.
- **Nothing is mossy, green, or brown.** No vegetation anywhere on these
  sheets except the green *liquid* in sheet 5.

**Technique implication (the one design decision this spec makes):** the warm
seams are not painted, so they have to be geometry. Every stacked surface is
built as a **warm tan backing slab with dark blocks laid on top of it, leaving
a ~4 cm gap between blocks**. The backing shows through the gaps as glowing
grout. This is one extra box per piece and it produces the sheet's signature
look directly, rather than approximating it with edge bevels.

### NON-features (things earlier cave attempts elsewhere invent, absent here)

- No brick courses, no mortar lines, no dressed ashlar — the blocks are
  irregular and hand-fitted.
- No stalactite *forests* on the walls; drips appear only under overhangs and
  under the arch head in sheet 1's rightmost piece.
- No moss, lichen, roots, vines, skulls, bones, chains-on-walls, or cobwebs.
- No purple/blue *rock*. The blue is in the shading of black stone, and in the
  crystals only.
- Braziers are not fire pits on the floor — they are bowls raised on legs.

---

## 1. Sheet 1 — cave walls

Top row, left to right:

1. **Wall block.** Roughly 3 wide × 4 tall × 1½ deep in block-units. Three or
   four courses of 2–3 blocks each; the top course overhangs slightly. Front
   face is nearly flat.
2. **Stepped wall.** Same construction, but the left half runs a course or two
   higher than the right, giving a clear step down. The lower half's top makes
   a ledge.
3. **Tall wall block.** As (1) but taller than wide — a squarish tower of
   blocks, 4–5 courses, with the courses breaking in different places so no
   vertical joint runs through.
4. **Square-headed arch.** Two thick piers, each 2 blocks wide, carrying a flat
   header 2 courses deep. The opening is about as wide as one pier and rises
   ~⅔ of the total height, with the corners of the opening softened by a
   half-block on each side (so the head reads slightly arched, not a lintel).
   Small blocks buttress the outside of each pier at the base.
5. **Broad pier / plinth.** A single tapered column, narrowest at ⅓ height,
   flaring to a wide capital of 3–4 blocks. Base is a ring of small blocks.
6. **Natural arch with drips.** Same overall gate silhouette as (4) but the
   opening is rounded and irregular, the piers lean, and the underside of the
   arch head grows a row of 5–8 short tapering **drip spikes** hanging into the
   opening. This is the only wall piece with hanging geometry.

Bottom row: smaller pieces of the same family — a low 2-course wall stub, a
single squat block, a **wall with a rectangular niche** cut in its middle
course, two thin pillars, a **very thin tall shard** (one block wide, 5 tall),
a **low round platform** of flat hex slabs, a **rubble pile** of loose blocks,
a rounded boss, and two small blocks.

## 2. Sheet 2 — floor tiles and floor stone decor

All are FLAT — a hand's-breadth thick, seen in isometric so the side face is
visible and is about 1/8 of the tile's width.

- Tiles are **squares of irregular polygonal cobbles** with the warm grout
  showing between them. Cobble count scales with tile size: ~9 on the small
  tile, ~14 on the medium, ~20 on the large.
- Top row: small square, medium square, large square, a tile with a **dark
  blue water inset** occupying the middle third, a tile with a **dark stained
  patch** (the stain is a flat darker region, not raised), an irregular-edged
  tile whose cobbles spill loose off one corner, a rounded tile.
- Bottom row: a scatter of 3–4 loose cobbles; a patch with **rubble crumbling
  off two edges**; a broad plain tile; a tile split by a **cross seam into four
  quadrants** (the seam is wider than the cobble grout); a patch with rubble; a
  tile with a **small dark puddle** in one corner; a **crumbling half-tile**
  with a broken edge; a small patch.

Identity features: the grout is continuous and warm, the cobbles are flat-topped
and clearly individual, and the tiles' outer edges are ragged (cobble-shaped),
never a clean square outline.

## 3. Sheet 3 — pillars and formations

- **Ceiling slab with stalactites** (top-left, large): a horizontal disc of the
  same flat cobbles, seen from below-ish, with 8–12 tapering spikes hanging
  from its underside, longest at the centre. Nothing supports it — it is a
  ceiling piece.
- Two **small hanging clusters**: 3–5 short spikes under a small cobble cap.
- **Full column** (right of centre): a wide flat cobbled capital, a stem that
  tapers in to about ⅓ the capital's width at mid-height, then flares back out
  into a base of chunky blocks. The stem is fluted — you can see 4–6 vertical
  facets.
- **Stalagmite clusters**: 2–4 spires per cluster, tallest in the middle,
  sharing a base of small blocks. Spires are 4–6 sided cones with slight lean,
  and are *stepped* — each has 2–3 visible width breaks up its length rather
  than being one smooth cone.
- **Single tall spire**: as above but one spire, 3–4× a figure's height.
- **Rock arch** (bottom right): a natural bridge — two footings and a thick
  span, the span made of blocks, asymmetric, one footing thicker.
- **Low flat platform** (bottom centre): a wide disc of flat cobbles a step
  high — the same family as sheet 2's round tile but thicker.

## 4. Sheet 4 — torches, lanterns, braziers, crystals

Top row (all WALL/CEILING mounted, none touches the floor):

- **Wall torch ×2**: a dark iron back-plate against the wall, a short arm
  angling up and out, ending in a small bowl/cup; a tapered orange flame stands
  in the cup. The second variant is shorter with a straighter arm.
- **Hanging lanterns ×5**: a hook or a length of chain at the top, then a
  slim iron cap, then a **glass body** — a hexagonal or tapered prism whose
  panes glow warm amber — framed by iron uprights and an **X of iron
  cross-bracing** on each face, then a small iron finial below. Height is
  roughly 3× the width. Variants differ in body proportion (squat hex, tall
  taper, long chain).

Bottom row:

- **Braziers ×4**: an iron bowl on three splayed legs joined by a low ring,
  standing about waist high, with a **large tapering flame** rising well above
  the bowl — the flame is as tall as the whole stand. Four colours: orange,
  green, blue, violet. The green/blue/violet ones have faceted crystal shards
  standing in the bowl behind the flame.
- **Crystal clusters ×2**: 5–8 sharply faceted shards fanning out of a small
  rock base, tallest in the middle. One teal, one violet. They GLOW — the
  shards are lighter at their tips.

## 5. Sheet 5 — more decor

- **Dark boulders**: 1 large + 2 small, same near-black blue stone, faceted
  into flat planes with the warm cracks between planes. Clearly the same
  material as the walls, not the existing grey rocks.
- **Ore boulder**: the same mass with a **blue crystal seam** growing out of
  one side — the crystal is a cluster of pale blue faceted plates set into the
  rock, plus one shard broken off at its foot.
- **Green pool**: an irregular pool of bright, opaque, slightly luminous green
  liquid, ringed by a broken kerb of the same dark cobbles. The kerb does not
  close — the pool spills past it at two points. The liquid's surface is flat
  and sits below the kerb's top.
- **Candles ×2**: cream candles with a visible dribble down one side, standing
  on small dark stone bases (one a plain block, one a small stepped stand),
  small yellow flame.

## 6. Sheet 6 — the assembled room (the target)

Everything above, plus what the kit still needs to build this picture:

- **Timber supports** — a mine-style frame: two square posts and a heavy
  cross-beam over them, with short angled braces at each top corner. Several
  stand against the walls and one stands free in the room. Warm mid-brown wood,
  the only warm-coloured *large* element in the room.
- **Barred gate** — a stone arch (sheet 1's arch #4) filled with vertical iron
  bars and two horizontal rails.
- **Plank walkway** — loose boards laid flat on the floor as a path, slightly
  raised, with a rail post at one end.
- **Glowing water** — teal, luminous at its edges, pooled in the low parts of
  the floor, lighting the cobbles around it.
- Barrels and crates (already in the library as `barrel`/`crate`).
- Crystals standing on small block plinths.

The room reads dark with warm pools of light. That contrast is the whole
picture: black-blue stone, warm grout, and a handful of saturated light
sources. Any piece that comes out mid-grey is wrong even if its shape is right.

---

## Build list (33 pieces)

Category `cave` — "Cave & Dungeon".

| id | from | notes |
|---|---|---|
| `cave-wall` | 1.1 | 3 m wide, 3 m tall |
| `cave-wall-tall` | 1.3 | 3 m wide, 5 m tall |
| `cave-wall-stepped` | 1.2 | steps down left→right |
| `cave-wall-corner` | 1 (bottom) | L, two 2.4 m arms |
| `cave-wall-niche` | 1 (bottom) | alcove in the middle course |
| `cave-arch` | 1.4 | square-headed gate, walk through |
| `cave-arch-natural` | 1.6 | rounded, leaning, drips under the head |
| `cave-pier` | 1.5 | tapered broad pier |
| `cave-rubble` | 1 (bottom) | loose block pile |
| `cave-floor-tile` | 2 | 4 m square, walkable |
| `cave-floor-small` | 2 | 2 m square, walkable |
| `cave-floor-quad` | 2 | 4 m, cross seam |
| `cave-floor-broken` | 2 | ragged, rubble off two edges |
| `cave-floor-stain` | 2 | dark stained patch |
| `cave-floor-round` | 2/3 | round platform |
| `cave-column` | 3 | floor-to-ceiling, ~6 m |
| `cave-spire` | 3 | single tall stalagmite |
| `cave-stalagmites` | 3 | cluster |
| `cave-stalactites` | 3 | hanging cluster (mounted) |
| `cave-ceiling-slab` | 3 | hanging cobble disc + drips (mounted) |
| `cave-rock-arch` | 3 | natural bridge |
| `cave-boulder` | 5 | dark faceted boulder |
| `cave-ore-crystal` | 5 | boulder + blue crystal seam |
| `cave-torch` | 4 | wall torch (mounted) |
| `cave-lantern` | 4 | hanging lantern + chain (mounted) |
| `cave-brazier` | 4 | orange flame |
| `cave-brazier-arcane` | 4 | green/blue/violet by seed, crystals in bowl |
| `cave-candles` | 5 | two candles on stone bases |
| `cave-crystal-blue` | 4 | glowing teal cluster |
| `cave-crystal-violet` | 4 | glowing violet cluster |
| `cave-pool-water` | 6 | glowing teal pool + kerb |
| `cave-pool-acid` | 5 | green pool + broken kerb |
| `cave-mine-support` | 6 | timber frame, walk under |
| `cave-gate-bars` | 6 | barred gate in a stone arch |
| `cave-walkway` | 6 | plank path, walkable |

Three pieces hang from a ceiling and never touch the ground
(`cave-stalactites`, `cave-ceiling-slab`, `cave-torch`, `cave-lantern`). They
carry a `mounted: true` flag in `propTypes.js` — `check:props`'s
"floats above the ground" rule and `check:parts`'s floating-island rule are
both exempted for them, with the reason recorded in each script.
