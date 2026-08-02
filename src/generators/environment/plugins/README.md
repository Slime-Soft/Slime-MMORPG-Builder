# Flora/decor plugins

Drop a `.js` file in this folder. Refresh the World Editor (or the live game).
It's placeable. No other file needs to change.

This is a separate, lighter-weight path than the hand-registered catalog in
`src/sim/propTypes.js` + `src/generators/props.js` (where things like
`tree-birch` and `flower-snowdrop` live) — that path exists because *those*
props need real collision (a tree you can't walk through). Everything in this
folder is decorative and always walk-through, same as the built-in flowers,
grass, and ferns. If you're building something that needs a solid collider
(a big rock, a structure), add it to propTypes.js/props.js by hand instead —
see the comment at the top of propTypes.js.

## File format

Every plugin file has exactly two exports:

```js
// src/generators/environment/plugins/clover.js
import * as THREE from 'three';
import { createRng } from '../../seededRandom.js';

// id: unique, kebab-case, this is what gets stored in world.json.
// label: shown in the World Editor palette.
// category: 'trees' | 'plants' | 'rocks' | 'decor' (must be one of the
//   existing palette tabs — see PROP_CATEGORIES in src/sim/propTypes.js).
export const meta = {
  id: 'flower-clover',
  label: 'Clover',
  category: 'plants',
};

// build(seed) -> a THREE.Object3D standing on y=0 (its own base at y=0, not
// its center — same convention every other prop in the game follows, so it
// doesn't float or sink when placed).
//
// Use the seed for variation (see createRng below) so the same prop placed
// twice in the World Editor doesn't look identical. Not required, but every
// other prop in the game does this and it reads much better in a scattered
// patch.
export function build(seed) {
  const rng = createRng(seed);
  const group = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a7c3f });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5fae4a });

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.18, 5), stemMat);
  stem.position.y = 0.09;
  group.add(stem);

  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), leafMat);
    const angle = (i / 3) * Math.PI * 2 + rng() * 0.4;
    leaf.position.set(Math.cos(angle) * 0.05, 0.19, Math.sin(angle) * 0.05);
    leaf.scale.set(1, 0.5, 1.2);
    group.add(leaf);
  }

  return group;
}
```

That's the whole contract. Copy `clover.js` in this folder as a working
starting point — it's a real, functioning example, not just documentation.

## Notes / limits of this path

- **Always walk-through.** No collider. If you need one, use the manual
  propTypes.js/props.js path instead (a couple extra lines, but full control).
- **`category` must be an existing tab** (`trees`, `plants`, `rocks`, `decor`).
  This system doesn't add new palette tabs.
- **The World Editor's automated checks (`npm run check:props`) don't scan
  this folder.** It validates the hand-authored catalog only. Test a new
  plugin by placing it in the World Editor and eyeballing it — does it stand
  on the ground, does it look right at a few different seeds.
- A duplicate `meta.id` (matching an existing built-in prop, or another
  plugin) silently overwrites the earlier registration — last one loaded
  wins. Keep ids unique.
- Both the World Editor and the live game load plugins from this same folder
  on startup, so anything you drop in shows up in actual gameplay too, not
  just the editor.
- **This folder is for YOUR props.** For an asset that arrived from somebody
  else, use `../import/` instead — identical file format, but everything there
  is forced into the palette's own "Imported" tab (and that folder also takes
  Object Builder `.json` exports and mesh files). See its README.
