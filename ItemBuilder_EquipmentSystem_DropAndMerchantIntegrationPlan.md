1. System Overview & Architecture
This plan refactors gear and weapon handling out of the Character Editor into a dedicated Standalone Item Builder Engine. It establishes a single source of truth for all items—gear, weapons, consumables, and quest items—and integrates them directly with Monster Loot Tables, NPC Event Stores, and the Player Equipment UI.

2. Standalone Item Builder Specifications

2.1 Creation Scope & Migration
Weapon Uploader Migration: Move the weapon visual uploader out of the Character Editor and place it directly into the Item Builder.Item Categories:Equipment & Gear: Helm, Chest, Gloves, Pants, Shoes, Ring, Earring, Necklace.  Weapons: 1H Sword, 2H Sword, Staff, Bow, Wand, Shield.  Consumables & Usables: Potions (e.g., INT/STR boosters), Buff Food, Quest Items, Scroll Portals.  2.2 Item Builder UI & Configurable AttributesVisual Assets:Icon Uploader: Drag-and-drop icon image asset (PNG/WebP, e.g., $64 \times 64\text{ px}$).  3D Model / Mesh Uploader: For weapons, armor meshes, or dropped loot bag representations.Stat Engine Integration:Apply primary stats (STR, AGI, DEX, INT, WIS, VIT).  Apply secondary stats (Armor, Weapon Min/Max Damage, Attack Speed, Crit Chance %, HP/MP Regen).  Usage & Durability Properties (For Consumables/Items):Usage Mode: Consumable (One-Time Use), Charges (N Times), or Unlimited Use.Cooldown: Delay between uses in seconds.Trigger Effect Link: Link directly to a Buff/Skill ID (e.g., consumable applies Buff_Int_Boost_Tier1 on use).Quest Item Flag: Prevents selling, trading, or dropping unless via explicit quest events.

3. UI System: Equipment Panel & Slot LogicThe player gear UI displays worn equipment around a live 3D character viewport:+-------------------------------------------------------------+
| EQUIPMENT & GEAR                                            |
+-------------------+--------------------+--------------------+
| [ Head ]          |                    | [ Ring 1 ]         |
| [ Neck ]          |     CHARACTER      | [ Ring 2 ]         |
| [ Chest ]         |      3D MODEL      | [ Earring 1 ]      |
| [ Gloves ]        |      PREVIEW       | [ Earring 2 ]      |
| [ Pants ]         |                    |                    |
| [ Shoes ]         |                    |                    |
+-------------------+--------------------+--------------------+
| [ Main Hand ]     |                    | [ Off Hand ]       |
| (1H/2H/Staff/Bow) |                    | (Shield/Dual)      |
+-------------------+--------------------+--------------------+
3.1 Equip & Swap Rules
Two-Handed Lockout: Equipping a 2H Sword, Staff, or Bow automatically clears and disables [ Off Hand ].  Shield Validation: Shields can only be equipped in [ Off Hand ] if [ Main Hand ] holds a 1H weapon (1H Sword or Wand) or is empty.  Accessory Auto-Targeting: Dragging a Ring or Earring onto the character sheet auto-equips into Slot 1 if empty; if occupied, it targets Slot 2 before replacing Slot 1.4. Integration Specifications

4.1 Monster Loot & Drop Tables EngineInside the Monster Editor / Spawner Tool:Loot Table Sub-Panel: A tab allowing designers to attach items created in the Item Builder.Drop Table Fields:Item_ID: Selected item from the Item Builder.Drop_Chance: Percentage probability ($0.001\%$ to $100.0\%$).Min_Quantity / Max_Quantity: Yield range (used for stackable items/consumables).4.2 NPC Store System (Events Tab Integration)Inside the Events Tab / NPC Interaction Editor:New Event Node Type: Open Merchant Store.Merchant Inventory Configurator:Select items from the Item Builder available for purchase.Set purchase currency (Gold, Honor Points, Quest Tokens) and buy/sell multipliers.Unlimited stock toggle or individual stock limit refresh timers.5. Technical Data Schema Examples

5.1 Item Definition Schema
JSON{
  "item_id": "item_potion_int_01",
  "name": "Greater Elixir of Intelligence",
  "category": "CONSUMABLE",
  "icon_url": "assets/icons/potions/int_potion_01.png",
  "usage_config": {
    "type": "CHARGES",
    "charges_max": 3,
    "cooldown_seconds": 10.0,
    "consume_on_zero": true
  },
  "effect_trigger": {
    "buff_id": "buff_int_tier_3",
    "duration_seconds": 1800
  },
  "stat_modifiers": [
    { "stat": "INT", "value": 15, "is_percentage": false }
  ]
}
5.2 Monster Drop Configuration SchemaJSON{
  "monster_id": "mob_skeleton_warrior",
  "loot_table": [
    {
      "item_id": "wpn_sword_1h_iron",
      "drop_chance": 5.0,
      "min_qty": 1,
      "max_qty": 1
    },
    {
      "item_id": "item_potion_int_01",
      "drop_chance": 15.5,
      "min_qty": 1,
      "max_qty": 3
    }
  ]
}

---

## Revision Notes (2026-07-24) — reconciled against the actual codebase

This plan was written without seeing the project. Section 1 of this
revision is what changed and why; Section 2 is what's actually built so
far under this revised scope; Section 3 is what's still open.

### 1. Changes from the original plan

- **No standalone Item Builder page — extended the existing World Editor
  "Items" mode instead.** An item catalog (`items/items.json`,
  `src/sim/authoredItems.js`), icon upload (`POST /api/items/icon`), and an
  editor Items mode already existed (built 2026-07-09). Duplicating that
  as a new page would fork one source of truth into two.
- **Dropped the 3D Model/Mesh Uploader for weapons/armor.** This project's
  hard rule is "no external asset files" — every asset (including
  weapons) is procedurally generated at runtime (`src/generators/weapon.js`,
  `src/sim/weaponTypes.js`). There are exactly two deliberate, explicitly
  agreed exceptions (ez-tree, a cloud-shadow texture) — a generic gear
  mesh uploader would be a third, and wasn't something to decide silently
  inside an item-schema pass. A weapon item now references an existing
  `weaponTypeId` from the procedural catalog instead.
- **Weapon "categories" (1H Sword/2H Sword/Staff/Bow/Wand/Shield) replaced
  by a direct reference into `src/sim/weaponTypes.js`.** That catalog
  already encodes `hands` (1/2) and `slot` (main/off/either) per weapon —
  exactly what two-handed-lockout and shield-validation logic needs — so
  storing a redundant parallel category on the item would just be a second
  place for the two to drift apart.
- **Currency scoped to Gold only for now.** Honor Points/Quest Tokens are
  new economy concepts with no existing design; the live game currently
  only has gold.
- **Field names are camelCase**, not the plan's snake_case, to match every
  other schema in the codebase (`itemId`, `dropChance`, not `item_id`,
  `drop_chance`).
- **Combat stat integration (armor mitigation, weapon damage rolls actually
  affecting combat) is explicitly deferred as its own future phase, not
  part of the Item Builder work.** Monsters currently deal flat
  unmitigated damage — there's no armor/defense formula anywhere in
  combat yet (this was already an open item in `WORLD_BUILDER_ROADMAP.md`
  before this plan existed). `statModifiers` on an item is captured today
  the same way it always was: authored, inert, ready for that future pass.
- **Loot rolls, when built, must draw from `src/sim/rng.js`'s passed-in
  RNG** (never `Math.random()` inside `src/sim`), the same pattern
  `src/sim/gathering.js`'s `rollYield` already uses — required by
  `npm run check:arch`.

### 2. Built this pass (Item Builder schema + UI extensions)

- **`src/sim/authoredItems.js`**: item types now include `consumable`
  (was weapon/armor/quest/misc). New fields, all optional/backward
  compatible: `armorType` (`cloth`/`leather`/`plate`, armor only),
  `slot` now a real enum (`EQUIP_SLOTS`: head/neck/chest/gloves/pants/
  shoes/ring/earring/mainHand/offHand) instead of free text,
  `weaponTypeId` (references `src/sim/weaponTypes.js`, weapon only),
  `tintColor`, `statModifiers[]` (stat/value/isPercentage, `stat` drawn
  from the six GSE primaries + a small gear-secondary set: armor,
  weaponMinDamage, weaponMaxDamage, attackSpeed, critChance, hpRegen,
  mpRegen), `usageConfig` (consumable only — mode single/charges/
  unlimited, chargesMax, cooldownSeconds, `effectTrigger` reusing the
  same `{stat, amount, durationSeconds}` shape `src/sim/items.js`'s
  hardcoded elixir and `skillDefs.js`'s `BUFF_STATS` already use, rather
  than inventing a separate buff-catalog-id concept), `questLocked`
  (bool), and `craftable: {materials:[{itemId, qty}]}` — prep work for a
  future crafting UI, not consumed by anything yet, same "authored, not
  wired" status `statModifiers` already had.
- **World Editor Items mode** (`public/editor.html`, `src/editor/main.js`):
  type-conditional sections (armor/weapon/slot/tint/stats appear only for
  the relevant type), a stat-modifier list editor, consumable usage-config
  fields, a quest-locked checkbox, and a craftable-materials list editor
  (material picker pulls from both `src/sim/items.js`'s hardcoded
  materials and the item catalog itself). Every dropdown's option set
  comes directly from the sim schema module (`ARMOR_TYPES`, `EQUIP_SLOTS`,
  `ITEM_STAT_IDS`, `CONSUMABLE_USAGE_MODES`, `WEAPON_TYPES`, `BUFF_STATS`)
  rather than being retyped in the HTML, so the editor can't drift out of
  sync with what the server validates.
- **Three armor presets** (Cloth Robe / Leather Tunic / Plate Chestpiece —
  "Load: Cloth/Leather/Plate" buttons, visible in the Armor type section):
  each prefills name, rarity, armor type, a tint color, a description, and
  a representative stat spread. **These are data starting points, not
  visual ones** — gear doesn't render on the character model at all yet
  (no equip-visual pipeline exists), so `tintColor` is inert today, the
  same way `statModifiers` is. Load one, rename it, tweak the numbers,
  save under a new id.
- **Verified**: `npm run check` (arch/prefabs/props) clean. Live in-browser
  round trip — opened Items mode in a real editor session, confirmed every
  new dropdown populates from the correct sim module, loaded the Plate
  preset and confirmed the form updates, saved a test item with a craft
  recipe + quest-lock + stat modifiers through the real `/api/items`
  endpoint (exercising the server's `parseAuthoredItems` validation, not
  just the client form), confirmed it persisted correctly to
  `items/items.json`, then cleaned the test entry back out. Zero console
  errors throughout.

### 3. Still open (not built this pass)

- Equip-slot system (inventory, equip/unequip, two-handed lockout, shield
  validation, ring/earring auto-targeting) — nothing in the live game
  grants or equips these items yet. No inventory UI exists at all (Phase 9,
  never started).
- Combat integration (armor mitigation, weapon damage actually applying) —
  see the deferral note above; this is the single biggest remaining lift.
- The "Open Merchant Store" event node — the only vendor today is a single
  hardcoded general-store NPC in `server/index.js` that sells materials
  only (no buying, no per-NPC configuration, no stock limits).
- Gear visual rendering (so `tintColor`/`armorType` actually change how a
  character looks) — a real lift, not scoped here.

### 4. Built same day, second pass — Monster Loot Tables (WORLD_BUILDER_ROADMAP.md item #16)

- **`src/sim/lootTables.js`** (new) — `LootTableEntry` schema (`itemId`,
  `dropChance` 0..100%, `minQty`/`maxQty`) and `rollLootTable(lootTable, rng)`.
  Deliberately NOT the same distribution shape as `src/sim/gathering.js`'s
  `rollYield` (mutually-exclusive entries summing to ~1) — a monster's loot
  entries roll **independently**, so a kill can drop nothing, one item, or
  several at once, matching the original spec's per-entry percentage model.
  Uses `src/sim/rng.js`'s passed-in generator (`chance`/`rangeInt`), never
  `Math.random()`, per the architecture guard.
- **`src/sim/creatureTypeDefs.js`** — monster-only `lootTable` field, validated
  via the above. Optional/backward compatible — every existing monster type
  (deer, fox, goblin-scout, etc.) parses unchanged with no drops.
- **`server/index.js`** — `creditKill` (the existing per-kill XP/quest-progress
  hook) now also looks up the dying monster's catalog type, rolls its
  `lootTable` with the server's one shared `rng` instance (same generator
  gathering already uses), and adds drops straight into `player.inventory`
  (a flat `{itemId: qty}` map — already itemId-agnostic, so an authored gear
  drop works exactly like a material). New `loot-drop` socket event.
- **World Editor** — Monster Builder modal gained a **Loot** tab (between
  Abilities and Model Editor): add/remove drop entries, item picker pulls
  from both `src/sim/items.js` materials and the authored item catalog.
- **Client** (`src/main.js`, `src/net/client.js`) — new `onLootDrop` handler
  (toast per drop + inventory sync), plus a **real bug fix found along the
  way**: `refreshInventoryUI` called `getItemDef()` unconditionally, which
  only knows the hardcoded materials catalog — an authored gear/quest item
  landing in inventory (now genuinely possible via loot, previously only a
  latent risk) would have thrown and blanked the entire inventory panel.
  Now falls back to the raw item id instead of throwing.
- **Verified**: `npm run check` clean. Live in-browser round trip through
  the real Monster Builder Loot tab (added a drop entry, confirmed the list
  renders). Server-side validation exercised directly via `/api/monster-types`
  with a real full monster payload: a valid `lootTable` entry (25% ore,
  1-2 qty) saved successfully; an invalid one (250% drop chance) was
  correctly rejected with `400` and a clear error, without corrupting the
  previously-saved valid state. Confirmed the base `monster-types.json`
  catalog is unaffected by test writes (plugin-authored monsters live in
  `monster-types/plugins/*.json`, merged in on every GET, separate from the
  base file tests wrote to). Zero console errors throughout.
- **Not built**: the drop doesn't show as a distinct "loot" visual/pickup in
  the 3D world (it's granted straight to inventory on kill, no ground item) —
  matches how quest-reward items already work, not a new gap.

### 5. Correction (same day) — loot moved from the Monster Editor to the Monsters placement panel

Dennis's actual ask: author loot in the window where you PLACE monsters
(World Editor "Monsters" mode — type/stats/quest-group/scatter-brush), not
in the Monster Builder modal (which edits the reusable body/appearance
catalog TYPE). Relocated, not layered on top:

- **`src/sim/creatureTypeDefs.js`**: the monster-TYPE-level `lootTable`
  field added in section 4 above was removed — reverted back to exactly
  its pre-loot-table shape.
- **`src/sim/tower.js`**: `lootTable` now lives on `MonsterSpawnDef`
  instead — the schema shared by both `world.monsters` (overworld) and a
  tower floor's `monsterSpawns`, validated by the same
  `validateMonsterSpawns` both already go through. This is a real behavior
  change, not just a relocation: loot is now per **placed spawn instance**,
  not per catalog type — two placements of the same monster type (e.g. a
  scatter-brushed pack vs. one hand-placed "rare" spawn) can carry
  different loot tables.
- **World Editor**: the Loot tab was removed from the Monster Builder modal
  entirely. A new "Loot Table" section now lives directly in Monsters
  mode's placement form (`public/editor.html`), right where Max HP/Quest
  group/Respawn time already are — same "applies to the next placement, or
  Apply to the selected one" convention every other field in that panel
  already follows (staged in a `currentMonsterLootTable` array,
  `src/editor/main.js`, that's read on placement, written into
  `buildMonsterRef`/the apply-edit handler, and repopulated by
  `populateMonsterForm` when selecting an existing spawn).
- **`server/index.js`**: `creditKill` now reads `monster.lootTable`
  directly off the live spawn state (which already carries every
  `MonsterSpawnDef` field via `initMonsterState`'s spread) instead of
  looking up the catalog type.
- **Verified**: `npm run check` clean. Live in-browser: added a loot entry
  in the real Monsters-mode panel, confirmed the item dropdown populates
  from both catalogs, placed a real monster on the live Default World map
  and confirmed the new spawn carried the loot table, selected it back and
  confirmed the form repopulated the same entry, then **deleted the test
  spawn from the in-memory scene without ever pressing "Save World to
  Server"** — the real `world.json` was never touched, so this verification
  left no test data behind. Zero console errors throughout.
### 6. Built same day, third pass — "Open Merchant Store" event command

The last item from the original plan. Added as a new event script command
(`src/sim/events.js`'s `EVENT_COMMAND_TYPES`), so any NPC's event script can
open a merchant, not just the one hardcoded general-store NPC. Additive —
the existing hardcoded store (`server/index.js`'s `sell-item` handler,
`VENDOR_BUILDING`) is untouched and keeps working; fully replacing it with
the event-based system would mean rewriting the "enterable store instance"
plumbing too, a bigger and separate change against a live system, left for
later.

- **`src/sim/events.js`**: `openMerchantStore` command —
  `{items:[{itemId, price, stock?}], sellMultiplier?}`. Each `items` entry
  is what the merchant sells (gold price, optional stock — omitted =
  unlimited; no restock-timer in v1, an emptied stock stays empty for the
  rest of the session, a stated scope cut against the plan's "stock limit
  refresh timers"). `sellMultiplier` (default 0.5) scales what a player
  gets back selling **any** owned item to this merchant — not just ones in
  `items`, matching how a real shop buys general goods. No special runtime
  handling needed: it falls through `stepEventScript`'s generic
  "push effect, keep going" path, same as `giveItem`/`gold`.
- **`server/index.js`**: `applyEventEffect`'s new `openMerchantStore` case
  snapshots the authored item list + sellMultiplier + the player's current
  position onto `player.activeMerchant` — the single source of truth the
  new `merchant-buy-item`/`merchant-sell-item` socket handlers validate
  every purchase/sale against (price, stock, distance via a new
  `EVENT_MERCHANT_RANGE`, gold/inventory ownership). The client is never
  trusted for price or stock, same rule the existing `sell-item`/`craft`
  handlers already follow. New `resolveSellPrice(itemId)` helper checks
  both the hardcoded materials catalog and the authored item catalog, so
  selling an authored gear item back to a merchant works too (the old
  general store could only ever sell materials).
- **World Editor**: Events mode's generic command editor gained an
  "Open Merchant Store" command type — free-text item id / price / stock
  rows (add/remove), matching the existing free-text-id convention every
  other command in this editor already uses (e.g. `giveItem`'s Item id
  field), not a dropdown into the item catalog.
- **Client** (`src/main.js`, `src/net/client.js`, `public/index.html`): a
  new Buy/Sell tabbed merchant panel, opened automatically when an
  `openMerchantStore` effect arrives via the existing `event-step` handling
  (same place `giveItem`/`gold`/etc. effects are already applied
  client-side), closed on ✕ or on any floor/map transition (same places the
  hardcoded vendor panel already force-closes). Uses the same
  raw-id-fallback pattern established during the loot-table pass for
  displaying an authored item's name without crashing if `items.js` doesn't
  recognize the id.
- **Verified**: `npm run check` clean. Schema validation exercised directly
  (a standalone Node script, not a live save) — a valid `openMerchantStore`
  command validates, and empty items / negative price / negative stock are
  each correctly rejected with a clear error. The pure executor
  (`startEventScript`/`stepEventScript`) confirmed to push the command as a
  plain effect exactly like `giveItem`. Live in-browser: booted the real
  game client, opened a second raw socket connection to the running server
  and called both new socket handlers directly — both correctly returned
  `{ok:false, reason:'no-merchant'}` with zero server-side errors when no
  merchant was active (the expected safe response, since no NPC event with
  this command exists in the current world yet to trigger a real one from).
  Confirmed every new DOM element (`merchant-panel` and its children) exists
  and is present in the live page. Zero console errors throughout.
- **Not built**: a live end-to-end test through a real placed NPC (no
  merchant NPC has actually been authored in the world yet — this session
  built and verified the underlying system, not a specific in-game shop).
  The next natural step is placing an NPC in the World Editor, giving it a
  talk-triggered event with this command, and trying it in a real play
  session.

## Equipment & Gear System (2026-07-24, same day) — the last remaining piece

Dennis: "do the complete thing at once" — the full equip-slot system (sim
data model, combat integration, and UI), not just a scoped-down slice.
Reference image supplied for the UI's layout (slots left/right, 3D preview
center, item grid right, stat bar along the bottom); reskinned into this
project's wood/gold Cinzel theme rather than copying that reference's own
art style, per the established "match this project's theme immediately"
rule.

### Sim layer
- **`src/sim/equipment.js`** (new) — `EQUIP_SLOT_IDS` (12 concrete slots),
  `findAutoTargetSlot` (ring/earring auto-targeting per the original spec:
  slot 1 if empty, else slot 2, else replace slot 1), `canEquip`/`equipItem`/
  `unequipItem` (two-handed lockout, shield-needs-free-or-1H-mainhand,
  wrong-slot rejection — all pure, all unit-tested), `computeGearStatBonus`
  (sums equipped items' `statModifiers` into a flat bonus object — `isPercentage`
  stays a stated v1 simplification, not yet interpreted differently from
  flat), `equipmentToWeaponLoadout` (resolves mainHand/offHand item ids to
  weapon-type ids for the rig renderer).
- **`src/sim/statDefs.js`/`src/sim/leveling.js`**: `totalStats`/
  `computeCharacterDerivedStats` gained an optional `gearStats` source,
  additive alongside allocated points and buffs — a STR ring now raises
  physPower through the exact same GSE formula everything else uses, not a
  separate parallel system. Gear's secondary stats (armor, crit, hp/mp
  regen) add flat onto the derived output. `weaponMinDamage`/
  `weaponMaxDamage`/`attackSpeed` are computed and carried through but have
  **no consumer yet** — this project has no "weapon damage roll" mechanic
  (abilities use their own authored `power`), stated explicitly rather than
  silently omitted.
- **`src/generators/playerCharacter.js`**: `applyAppearance` accepts an
  `equipmentOverride` that takes priority over the class catalog's own
  fixed default weapon loadout — the one hook that makes an equipped
  weapon actually visible on the 3D preview (and, since it's the same
  function the live game itself calls, on the character generally,
  wherever a future caller wants to pass it through).

### Server (server/index.js)
- `player.equipment` (initEquipmentState()), included in the welcome payload.
- `getPlayerDerivedStats` now folds `computeGearStatBonus` in — **armor
  genuinely reduces incoming damage** (already-existing `applyDamageToPlayer`
  consumes `physDefense`, unchanged, now gear-inclusive automatically) and
  every primary/secondary gear stat is live in combat, not just authored data.
- `equip-item`/`unequip-item` socket handlers — server-authoritative:
  validates via `canEquip`/`equipItem`, decrements/increments inventory,
  recomputes maxHealth, emits one consistent `equipment-result` shape for
  both actions.
- `set-character` now also emits a `stats-updated` snapshot to the picking
  player (previously only broadcast cosmetic info to OTHER players) — the
  first real derived-stats number a player gets, otherwise nothing pushed
  it until they touched Stats or Equipment.

### Client (public/index.html, src/main.js, src/net/client.js)
- New **Equipment & Gear** panel (`I` to toggle) — wood/gold themed,
  centered, matching the reference layout: Head/Neck/Chest/Gloves/Pants/
  Shoes left, Ring 1/2 + Earring 1/2 right, Main Hand/Off Hand below a
  live 3D preview, inventory grid on the right. The preview reuses
  character-creation.html's exact pattern (isolated Scene/Camera/Renderer,
  drag-to-rotate, auto-rotate) scaled to panel size — genuinely shows the
  equipped weapon, not a static render.
- Click an equippable inventory item to equip (auto-targets ring/earring
  slots); click a filled slot to unequip. Both round-trip through the
  server; nothing is applied optimistically.
- Bottom stat bar shows primary stats (gear-inclusive, via the server's
  `derived.raw`) and key derived numbers (Armor, Crit, HP/MP Regen).

### Two real bugs found and fixed during verification
- **`refreshVendorPanel()` crashed on an authored (non-material) inventory
  item** — same "`getItemDef` only knows `items.js`'s hardcoded catalog"
  class of bug fixed elsewhere earlier the same day, missed in this one
  spot. Because it runs inside `syncInventoryUI()`, called from within the
  async `onWelcome` handler, this **silently broke the entire connect
  sequence** the moment a player owned any equipped-gear-capable item —
  the client got permanently stuck on "Connecting…" with no console error
  surfaced by casual testing. Found by bisection after a live equip test
  reproducibly failed to refresh the panel. Fixed with the same
  try/catch-and-filter pattern used everywhere else this bug class has
  shown up.
- **`POST /api/items` replaces the WHOLE catalog** — briefly overwrote
  Dennis's real `hp_potion_1` (a Health Potion he'd authored himself)
  while setting up test items, because the test payload didn't include it.
  Recovered from the server's own automatic `.bak` file. Lesson: always
  `GET` first and include existing real entries in any test `POST` to this
  endpoint — see memory.

### Verified
`npm run check` clean throughout. Full live round trip in the real running
game (not synthetic-only): equipped a test sword (STR +8) and shield
(armor +20) via real clicks, confirmed inventory/grid/slots/3D-preview/
derived-stat-readout all updated correctly and consistently (STR 18→26,
Armor 5→25), unequipped and confirmed the reverse. Confirmed the
two-handed-lockout/shield-validation/ring-auto-target logic exhaustively
via a standalone Node script (15 assertions, all passing) before ever
touching the server. Confirmed a completely clean connect/boot with the
new system in place, no leftover test data in `items/items.json` or
`server/index.js`.

### Still not done
- Non-weapon gear (armor pieces) has no visual effect on the character —
  only the weapon loadout renders, since there's no gear-visual-rendering
  pipeline (stated as open in the original item-builder revision).
- `isPercentage` stat modifiers are treated as flat (v1 simplification).
- No "weapon damage roll" combat mechanic for `weaponMinDamage`/
  `weaponMaxDamage`/`attackSpeed` to plug into yet.
- Remote players don't see each other's equipped weapons rendered — the
  weapon-override only applies to the local player's own preview/mesh;
  syncing it to other clients' view of you is a separate, not-yet-built
  multiplayer piece.
