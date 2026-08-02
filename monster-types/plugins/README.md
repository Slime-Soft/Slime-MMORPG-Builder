# Monster plugins

Drop a `.json` file in this folder. Refresh (World Editor, Monster Builder,
or the live game). It's in the catalog — placeable as a spawner, editable in
the Monster Builder, no server restart. No other file needs to change.

This merges into the same catalog as `monster-types/monster-types.json` (the
Monster Builder's save file) — a plugin file is just one monster written by
hand instead of built by clicking through that UI. Both are read fresh every
time something fetches `/api/monster-types`, so a file dropped in here shows
up on the next page refresh.

## File format

One file = one monster = the same JSON shape as a single entry in
`monster-types.json`. `goblin-scout.json` in this folder is a real, working
example — copy it as a starting point rather than writing one from scratch.

Required top-level fields:

```json
{
  "id": "goblin-scout",       // unique, kebab-case — this is what world.json spawners reference
  "name": "Goblin Scout",     // shown in the Monster Builder / spawn palette
  "stance": "humanoid",       // or "quadruped" (needs legFrontL/R + legBackL/R instead of legL/R)
  "configuredLevel": 2,       // authoring dial — gates which abilitySlots are active, not a runtime stat
  "baseStats": { "maxHealth": 28, "damage": 4, "speed": 1.9, "aggroRange": 9, "attackRange": 1.4, "attackCooldownMs": 1200 },
  "abilitySlots": [ /* can be empty [] */ ],
  "slots": [ /* body, see below */ ]
}
```

`slots` is a list of body parts, each a `role` (`head`, `torso`, `armL`,
`armR`, `legL`, `legR`, `tail`, or the quadruped leg roles), an `anchor`
(where that part pivots from, relative to the creature's feet at the
origin), and one or more primitive `shapes` (`box`, `cylinder`, `sphere`,
`cone`, `capsule`, `pyramid`, `wedge`) positioned relative to the anchor.
`torso` and `head` are required in practice even though only `stance` and
`slots` are strictly enforced — a body with no torso won't look like
anything. See `goblin-scout.json` for real anchor/shape numbers to start
from; nudging those is easier than deriving them from scratch.

## What you get for free vs. what still needs the Monster Builder UI

- **Free (just the JSON file):** the body shape, base stats, one simple melee
  ability. Enough for a functional, spawnable monster.
- **Still easiest through the Monster Builder UI in-browser:** walk-cycle
  tuning, hand-authored attack/idle animation clips, weapon grips. A plugin
  monster is a perfectly valid starting point to load into that UI and
  refine — editing it there and saving writes it into `monster-types.json`
  proper (it stops being "just a plugin file" at that point, which is fine).

## Notes / limits of this path

- **Validation is strict.** A malformed file (missing required field, unknown
  shape kind, etc.) is logged to the server console and skipped — it won't
  crash the catalog or the server. Check the terminal running `npm start` if
  a monster you dropped in doesn't show up.
- **Duplicate ids are skipped, not overwritten** — unlike the flora plugin
  path, a monster with an id that collides with an existing one (built-in or
  another plugin) does NOT replace it. Monster stats affect game balance, so
  a silent overwrite here is riskier than a redundant rose bush. Rename it.
- Placing a spawner in the World Editor copies that monster type's stats into
  `world.json` at placement time — later edits to the plugin file won't
  retroactively change monsters already placed in the world, same as editing
  a catalog monster in the Monster Builder wouldn't.
