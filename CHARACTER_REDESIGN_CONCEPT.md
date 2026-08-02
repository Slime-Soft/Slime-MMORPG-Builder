# Character Redesign Concept — human-like bodies & a real gear layer

Status: **concept only**, nothing implemented. Written 2026-07-27 after reading
`src/sim/creatureTypeDefs.js`, `src/generators/creatureRig.js`,
`src/generators/playerCharacter.js`, `src/sim/equipment.js` and the six
`kind: 'character'` rows in `character-types/character-types.json`.

---

## 1. Why gear sets are hard today (the actual reason)

It is not the chibi proportions. It is three structural facts:

### 1.1 Gear is *baked into the class body*

The Mage's robe isn't gear — it's shapes named `skirt`, `trim`, `belt` sitting in
the `torso` slot of the `mage` row. Same for the Warrior's `pauldron`/`bracer`/
`greave`/`boot` and the `scaleA/B/C` chest plates. `applyAppearance()`
(`src/generators/playerCharacter.js:111`) can only recolour those by tint role
and swap **hair**; there is no code path anywhere that adds or removes a body
shape because of an equipped item.

So "make a gear set" currently means "hand-edit the class body", and every class
would need its own copy of every armour set. 6 classes × 5 tiers × 5 slots = 150
hand-authored bodies. That's the wall.

`src/sim/equipment.js` is already complete and server-authoritative — head, neck,
chest, gloves, pants, shoes, rings, earrings, hands. **The data model for gear
exists. It just has no visual layer.** Only weapons render
(`attachWeapons`), because weapons attach to a hand point rather than replacing
body shapes.

### 1.2 Every class is a *different* body

`warrior` torso is `0.52 × 0.70 × 0.38` anchored at y=0.95; `mage` torso is
`0.52 × 0.70 × 0.38` anchored at y=0.91. Arm anchors, leg anchors and head
anchors drift class to class. A chest piece authored to fit the Warrior would
float or sink on the Mage. Armour cannot be shared until the underlying body is.

### 1.3 The rig is **flat, not hierarchical** — this is the real ceiling

In `buildCreatureRig` every slot pivot is `group.add(pivot)` with `slot.anchor`
relative to the *root*. There is no parenting between slots. Consequences:

- One pivot per arm. **No elbow, no wrist** (CLAUDE.md already documents the
  weapon-pitch pain this causes — a weapon inherits the whole arm's pitch).
- One pivot per leg. **No knee, no ankle.**
- Torso is a single rigid box. **No waist, no neck.**

Six pivots total for a humanoid. Everything that reads as "human" in motion —
a bending knee, a counter-rotating shoulder, a head that turns, a waist that
leans into a swing — is currently unreachable, at any level of art polish.

---

## 2. The concept: one mannequin, a wardrobe on top of it

Two changes, in this order. The first is the one that unblocks gear.

### 2.1 Split the body into **Mannequin + Wardrobe**

**Mannequin** — one canonical naked humanoid. Identical slot roles, identical
anchors, identical limb dimensions for all six classes. Skin/hair/eyes only.
Gender stays what it already is: a scale on the outer group
(`GENDER_BODY_SCALE`), which is safe because a uniform outer scale cannot
disconnect parts.

**Wardrobe piece** — a new authored type, edited in the same Character & NPC
Builder, stored in its own catalog (`armor-sets/armor-sets.json`,
`GET/POST /api/armor-sets`):

```js
{
  id: 'iron-plate-chest',
  name: 'Iron Plate Cuirass',
  itemId: 'iron_chest_1',        // -> items.json, the thing players equip
  slot: 'chest',                 // an EQUIP_SLOT_IDS value
  hides: ['chest'],              // mannequin shape ids this replaces
  parts: [                       // shapes merged into the mannequin's slots
    { slot: 'torsoUpper', shapes: [ /* ShapeDef[], same schema as today */ ] },
    { slot: 'armLUpper',  shapes: [ { id: 'pauldronL', kind: 'sphere', ... } ] },
    { slot: 'armRUpper',  shapes: [ { id: 'pauldronR', kind: 'sphere', ... } ] },
  ],
  tintRoles: { trim: 'metal', cloth: 'dye' },  // optional player/rarity recolour
}
```

A chest piece owning shapes in `armLUpper` is deliberate — that's how pauldrons,
gloves-that-cover-forearms and boots-that-cover-shins work in every MMO.

**Why this is cheap to build:** `buildCreatureRig` already walks
`creatureType.slots` and adds `slot.shapes` to a pivot. The whole render change
is a pure function that runs *before* it:

```js
// src/sim/wardrobe.js  (pure, sim-safe, no THREE — server can validate it too)
composeBody(mannequin, equippedPieces) -> CreatureTypeDef
```

…which filters out every `hides` id and concatenates every piece's `parts` into
the matching slot. Everything downstream — rigging, gait, keyframe clips,
shadows, the Builder preview, `check:prefabs` — works unchanged, because the
output is just a normal `CreatureTypeDef`.

**Class identity moves into a default wardrobe set.** The Mage's robe becomes
`mage-starter-robe`, a chest piece the class spawns wearing. Existing class
bodies get split once, by hand: skin/hair/eyes stay on the mannequin, everything
else becomes a starter set. That one-time split is the real cost of this whole
concept, and it's what makes gear infinite afterwards.

**Escape hatch for non-standard bodies** (a hulking town guard, a child NPC):
each slot declares a `fitBox` (its nominal w/h/d). Wardrobe shapes are authored
against the canonical mannequin and multiplied by `target.fitBox / canonical.fitBox`
at compose time. Off by default — the canonical mannequin is the rule, the
fit-box the exception.

### 2.2 Make the rig hierarchical

Add one optional field to `SlotDef`:

```js
{ role: 'armLLower', parent: 'armLUpper', anchor: {...} /* now relative to parent */ }
```

`buildCreatureRig` adds the pivot to `rig[slot.parent]` instead of `group`.
**Absent `parent` = parent to root**, so every existing monster, NPC and the
whole of `monster-types.json` keeps working with zero migration. Slots must be
built parent-before-child (topological order, or two passes).

Proposed humanoid skeleton — 17 slots, up from 6:

```
root
└ pelvis (torso)          ← existing 'torso' role, renamed in spirit only
  ├ torsoUpper            chest; waist bend & breathing live here
  │ ├ neck
  │ │ └ head              head turn, nods, look-at
  │ ├ armLUpper ─ armLLower ─ handL   (handL becomes a real slot, not a derived point)
  │ └ armRUpper ─ armRLower ─ handR
  ├ legLUpper ─ legLLower ─ footL
  └ legRUpper ─ legRLower ─ footR
```

New `SLOT_ROLES` entries; the old flat `armL`/`legL`/`torso` roles stay valid
forever for monsters.

**What this buys, beyond looks:**

- Real knees/elbows → walk, run, sit, jump, cast all become authorable in the
  existing `KeyframeClip` system with no new animation tech.
- **A wrist.** CLAUDE.md's whole "a weapon inherits its arm's pitch whole, so a
  ranged weapon's grip must cancel the arm's hold pitch" problem — and the
  weapon-tuning file that exists to manage it — largely evaporates. Aim the
  wrist, not the shoulder.
- Armour that spans a joint (a vambrace, a greave) has somewhere correct to live.

**Cost / ripple** (be honest about this):
`GAIT_TABLES` in `rig.js` need biped entries for the new roles; `handAnchorFor`
is superseded by a real hand slot; `check:prefabs`' connectivity and buried-arm
matchers need to understand nesting; the Builder's anchor UI becomes
parent-relative (which is *easier* to author, but it's a UI change); keyframe
clips authored against `armL` need remapping to `armLUpper`.

---

## 3. Proportions: how "human" can we go?

Current mannequin is **~3.5 heads tall** (head 0.50 on a ~1.75 body). Your
reference image is **~4.5 heads** — that gap is most of the "doesn't look human"
feeling, and it costs nothing but numbers.

**Keep total height at ~1.80.** Doors, building interiors, collision radii,
camera height and the tower's floor clearances are all built around it. Change
the ratio, not the size.

| Part            | Height | Notes                                    |
|-----------------|--------|------------------------------------------|
| head            | 0.40   | ↓ from 0.50 — the single biggest change  |
| neck            | 0.08   | new                                      |
| torsoUpper      | 0.42   | chest, tapers to waist                   |
| pelvis          | 0.20   | new split                                |
| thigh           | 0.36   | ↑ legs get the height the head gave up   |
| shin            | 0.26   |                                          |
| foot            | 0.08   |                                          |
| **total**       | 1.80   | **4.5 heads**                            |
| upper arm       | 0.30   |                                          |
| forearm         | 0.28   |                                          |
| hand            | 0.10   |                                          |

Widths: head 0.36 wide, shoulders ~0.58 (1.6 head-widths — reads adult without
losing the toon read), waist 0.40, hips 0.44. Arm slot anchors stay at
`torsoHalfWidth + armRadius` per the existing invariant, i.e. ±0.34 → ±0.36.

Anything at or above ~6 heads stops reading as toon and starts looking like a
low-poly realistic character with the wrong shading — the uncanny middle. 4.5 is
the sweet spot for the reference you posted; 5.0 if you want it more "anime
adult", 4.0 for more "cute".

---

## 4. The limits — what this style genuinely cannot reach

Stated plainly so nobody chases these later.

**Hard walls (rigid primitives, no skinning):**

- **No deforming skin.** Every joint is a hard seam between two solids. The
  standard fix is already in your Warrior — a sphere at the shoulder/hip
  (`shoulder: sphere`, `hip: sphere`) that covers the seam through the full
  rotation range. Make that a *mannequin invariant*: every joint carries a
  cap sphere ≥ the limb radius. Then rigid joints are a style, not a bug.
- **No draping cloth.** A robe cannot flow. It can be a cone/skirt that swings
  as one piece, or a hinged chain of 2–3 slabs with a lag on the rotation
  (which reads surprisingly well for capes and coat tails).
- **No sculpted faces.** Boxes give no curved cheekbone. This is much less of a
  loss than it sounds — see §5.
- **No squash/stretch on a bending waist.** Torso bends will always be two rigid
  boxes at an angle.

**Soft walls (breakable, at a stated cost):**

- **No textures on bodies.** Nothing authors UVs; all colour is per-shape. A
  single front-face texture on the head box would give proper anime faces
  (blush, lashes, expression swaps) very cheaply. This would be a **third
  explicit exception** to the "no external asset files" rule, after ez-tree and
  cloud shadows — a decision for you, not something to sneak in.
- **Shape vocabulary is 7 primitives.** No tapered box, no lathe, no extruded
  profile. A tapering cuirass has to be stacked boxes or a squashed cone. Adding
  a `frustum` kind (box with independent top/bottom width) to `SHAPE_KINDS` +
  `custom.js` is ~20 lines and would improve nearly every piece of armour.
- **Poly budget is not a limit.** A 40-shape character is ~1.5k tris. Your round
  trees are 1.5k *each*. Characters are free by comparison.

---

## 5. Making it read as *anime*, not just "low-poly human"

From the reference image, three things do the work — all reachable:

1. **Hair is a silhouette, not a hat.** The reference's hair is a big faceted
   mass with distinct chunky locks that break the head's outline. Current
   `HAIR_SHAPES` are 2–4 boxes hugging the skull. Rebuild hair as 6–10 angled
   slabs/wedges that overhang the face and jaw. Biggest visual win per hour of
   any item in this document.
2. **Faces are graphic, not modelled.** Flat face plane; large dark eye shapes;
   **a brow shape above each eye is what carries expression** — angle the brows
   and the same face reads angry, worried, neutral. Add `browL`/`browR` and a
   `mouth` shape to the mannequin head, animatable via the existing clip system.
3. **Separate materials by value, not just hue.** In the reference, skin, cloth,
   leather and metal are clearly different *brightnesses*. Give wardrobe pieces a
   small material vocabulary (cloth / leather / metal / trim) with fixed value
   bands, so a gear set can't come out mushy no matter what colours are picked.

Also worth noting: the reference's body is **stiff and symmetric** — it's the
proportion and the hair doing the work, not pose or deformation. That's exactly
what a rigid-primitive rig is good at.

---

## 6. Suggested order of work

Each step is independently shippable and independently verifiable.

1. **Hierarchical slots** (`parent` field, backwards-compatible). No visual
   change yet — pure enabling work. Verify: `npm run check:prefabs` still passes
   on all existing monsters unchanged.
2. **Author the canonical mannequin** at the §3 proportions, with joint caps,
   brows and a mouth. One row, `kind: 'character'`, id `mannequin`.
3. **Wardrobe schema + `composeBody()`** in `src/sim/wardrobe.js`, plus a
   `check:wardrobe` guard (every piece composes onto the mannequin without
   leaving a floating shape or a hole where a `hides` id was).
4. **Split the six classes** into mannequin + six starter sets. This is the
   migration; after it, classes are outfits.
5. **Wire equipment → visuals**: `equipment.js` slot → item → wardrobe piece →
   `composeBody`, on the local player, remote players and NPCs. Follows the same
   path the live weapon-visibility work already took.
6. **Wardrobe mode in the Character Builder** — author a piece against the
   mannequin, preview it on all six classes at once.
7. *(optional)* New primitive kinds (`frustum`), hair library expansion, face
   texture decision.

Steps 1–5 are the concept. 6 is what makes it sustainable. 7 is polish.

---

## 7. Open decisions for Dennis

- **4.5 heads** — agree, or push toward 5.0 (more adult/anime) / 4.0 (cuter)?
- **Total height stays 1.80?** (Recommended — everything is built around it.)
- **Face textures**: allow a third exception to the no-asset-files rule, or stay
  fully procedural and accept box-primitive faces?
- **Armour on NPCs and monsters too**, or players only for now? (The schema is
  kind-agnostic; the question is only how much authoring you want to do.)
- **Do the class bodies get re-authored by hand, or scripted?** A script can
  mechanically move non-skin shapes into a starter set, but the result will need
  hand-tuning against the new proportions either way.
