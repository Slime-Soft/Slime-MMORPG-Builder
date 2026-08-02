# Imported assets

**Drop a file in this folder. Refresh the World Editor. It's in the scenery
palette under the 📥 Imported tab, ready to place.**

That's the whole thing. No upload form, no catalog file to edit, no server
restart, no code to touch. This is how an asset gets from one person's copy of
the game into another's: they export it, send you the file, you drop it here.

## What you can drop in

### `.json` — an Object Builder export (the main one)

An asset built right here in the World Editor's **Object Builder**, exported
with the **⬇** button (either the one under the form, or the ⬇ next to any
object in the catalog list). It's just the object's shapes as data, so it looks
and behaves identically on your machine and theirs.

That's the round trip: *you* build something in the Object Builder and hit ⬇;
*they* drop the file in here and it's in their palette.

One file can hold a single object, or an array of them — a whole pack shared as
one file.

### `.js` — a Three.js generator module

An asset authored as **code**, which is how every built-in prop in this project
is made (see `src/generators/environment/`) and what you get back when you ask
an AI for "a three.js prop". Two exports:

```js
export const meta = { id: 'mossy-lantern', label: 'Mossy Lantern' };
export function build(seed) { /* return a THREE.Object3D standing on y = 0 */ }
```

Full format (including how to use `seed` so each placement varies) is in
`../plugins/README.md` — the contract is exactly the same, and `clover.js` in
that folder is a working example to copy. The only difference: a module in
*this* folder always lands under the **Imported** tab, whatever its
`meta.category` says, so shared assets never get mixed in with your own.

### `.glb` / `.gltf` / `.fbx` — a mesh file

For assets that came from outside this project entirely (a modelling tool, an
asset pack). Works, but it's the weakest of the three: a mesh is opaque, so it
gets no seeded variation, and nothing corrects for the units the exporter chose.

- The **id comes from the filename** (`dragon-statue.glb` →
  `imported-dragon-statue`), so renaming the file orphans anything already
  placed with it. Rename before you place, not after.
- **Scale isn't guessed.** If it lands enormous or ant-sized, rescale it in
  whatever made it. For reference: a player is ~1.75 units tall, this project's
  buildings run 4-8.
- **Origin at the base** (standing on y = 0, not centred on it), same as every
  other prop here, or it floats/sinks when placed.
- An unpacked `.gltf` works with its `.bin` and textures beside it here.
- The first time the editor sees one, it loads it once, measures its real
  footprint and height, and saves that to `models/imported-metrics.json` —
  that measurement is what gives it collision. Automatic; you don't do
  anything. The **↻** badge on its palette cell re-measures, for when you
  replace a file in place with a different-sized version.

## Rules that apply to everything here

- **This folder is the source of truth.** Nothing is ever copied into the
  project's own catalogs (`objects.json`, `models.json`), and no code path
  writes to, rewrites, or deletes a file you put here. Remove a file and the
  asset simply stops being offered.
- **Read-only in the editor.** Imported assets have no delete button. An
  imported Object Builder asset shows in the Object Builder's catalog list with
  a **⧉** button — that copies it into your own catalog so you can adapt it,
  leaving the original file untouched.
- **Ids must not collide.** An asset whose id already exists locally is skipped
  with a warning in the server console, rather than silently replacing yours
  (which would change every already-placed instance of it).
- **A broken file is skipped, not fatal.** Malformed JSON or a module that
  throws gets a console warning and is ignored — one bad share can't stop the
  game from starting.
- **Everything here is walk-through except mesh files**, which collide on their
  measured footprint. `.json` objects collide exactly like a locally-built
  Object Builder object; `.js` modules are decorative only (same as the
  `../plugins/` path — if you need a real collider, that needs a hand-written
  row in `src/sim/propTypes.js`).
