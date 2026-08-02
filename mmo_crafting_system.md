# Classic MMO Crafting & Professions Engine Architecture Specification

## Executive Summary
This document provides a comprehensive technical and system design specification for a **Classic MMO Crafting & Professions Engine**. It details profession architectures, recipe definitions, crafting station requirements, experience/leveling dynamics, and full integration with the **Standalone Item Builder**, **Monster Loot System**, and **NPC/Event Merchant System**.

---

## 1. System Overview & Architecture

The Crafting System operates as a core module within the Global Engine. It acts as an **Item Transformer Engine**, accepting input items (Reagents, Ingredients, Materials), validating player conditions (Recipe Mastery, Profession Level, Crafting Station Proximity, Mana/Energy Cost), and producing output items defined within the **Item Builder Engine**.

```
+-----------------------------------------------------------------------+
|                         CRAFTING ENGINE FLOW                          |
+-----------------------------------------------------------------------+
|  [ Player Inputs ]  +  [ Station Check ]  +  [ Recipe / Skill Check ] |
|  - Raw Materials        - Anvil / Oven        - Profession Level      |
|  - Catalysts            - Alchemy Lab         - Unlocked Recipe ID    |
+-----------------------------------------------------------------------+
                                   |
                                   v
+-----------------------------------------------------------------------+
|                        CRAFTING EXECUTION PROCESS                     |
+-----------------------------------------------------------------------+
|  1. Deduct Required Energy / Mana & Reagents                          |
|  2. Roll Success Rate / Quality Multiplier                            |
|  3. Award Profession Experience Points (EXP)                          |
|  4. Instantiate Generated Item(s) via Item Builder Engine             |
+-----------------------------------------------------------------------+
```

---

## 2. Professions Structure

Professions are categorized into primary production disciplines and harvesting/gathering disciplines.

### 2.1 Discipline Categories

| Category | Profession | Primary Station | Inputs | Target Output Items |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Production** | **Blacksmithing** | Anvil & Forge | Metal Ores, Bars, Leather Straps | Heavy Armor (Helm, Chest, Pants, Gloves, Shoes), 1H/2H Swords, Shields |
| **Primary Production** | **Woodworking / Fletching** | Workbench | Wood Logs, Plumes, String | Staves, Bows, Wands |
| **Primary Production** | **Tailoring / Leatherworking** | Loom & Tanning Rack | Cloth Bolts, Hides, Threads | Light/Medium Armor, Bags |
| **Primary Production** | **Jewelcrafting** | Jeweler's Bench | Gemstones, Metal Filigree | Rings, Earrings, Necklaces |
| **Primary Production** | **Alchemy** | Alchemy Lab / Still | Herbs, Vials, Monster Drops | Stat Potions (INT/STR/VIT), Elixirs, Buff Food |
| **Gathering** | **Mining / Herbalism** | Node Field | Pickaxe / Sickle | Ores, Raw Gems, Herbs |
| **Gathering** | **Fishing** | Open Water / Fishing Node | Fishing Pole & Bait | Raw Fish, Treasure Chests, Water Reagents, Quest Items |
| **Secondary Production** | **Cooking** | Campfire / Oven / Stove | Raw Meat, Fish, Spices, Herbs | Buff Food, Well Fed Feasts, Health/Mana Regen Consumables |


### 2.2 Secondary Discipline: Fishing Mechanics
* **Interaction Model:** Active minigame / timer-based gathering at open water bodies or highlighted Fishing Nodes.
* **Tool & Bait Requirements:** Requires a Fishing Pole equipped in hand/accessory slot and optional consumable Bait (from Item Builder) to increase catch chance or rare loot rates.
* **Catch Table Engine:** Cross-references the region's Loot Table to yield raw fish (used as ingredients in **Alchemy / Cooking**), locked treasure chests (yields gear/coins), or rare water-based crafting reagents.


### 2.3 Secondary Discipline: Cooking Mechanics
* **Interaction Model:** Stationary crafting at cooking stations (Campfires, Ores, Stoves) or field-crafted campfires.
* **Ingredient Synergy:** Combines raw ingredients gathered via **Fishing** (Raw Fish) and **Monster Drops** (Raw Meats, Eggs) with merchant-purchased spices/vendor items.
* **Buff Food Engine:** Produces consumable food items that grant the **"Well Fed"** state:
  * Applies long-duration primary stat boosts (e.g., `+10 STR` or `+15 INT` for 60 minutes).
  * Accelerates out-of-combat HP and Mana regeneration rates.
  * Party Feasts: Allows high-tier cooks to drop group feasts on the ground that buff all nearby raid/party members.

---

## 3. Recipe Builder & Configuration Specs

Recipes are defined using a dedicated **Recipe Builder Sub-Panel** that cross-references items built in the **Item Builder Engine**.

### 3.1 Recipe Attributes
* **Recipe Identifier (`recipe_id`):** Unique string identifier.
* **Required Profession & Tier:** E.g., `Blacksmithing`, Skill Level Required: `150`.
* **Required Station:** E.g., `ANVIL_TIER_2` (Player must be within interaction radius of this station object).
* **Crafting Time:** Duration in seconds for the crafting progress bar.
* **Reagents List:**
  * `item_id`: Item from the Item Builder.
  * `quantity`: Number of items consumed on execution.
* **Primary Output:**
  * `item_id`: Output item produced from the Item Builder.
  * `yield_min` / `yield_max`: Quantity range produced per craft (e.g., 1 Potion vs 1-3 Potions).
* **Success Rate & Quality Scaling (Configurable):**
  * `base_success_chance`: Base percentage probability ($0.0\% - 100.0\%$).
  * `fail_action`: Options: `DESTROY_ALL_MATERIALS`, `DESTROY_PERCENTAGE`, or `KEEP_MATERIALS_LOSS_ENERGY`.
  * `crit_chance`: Chance to yield doubled output or a higher-tier variant item.

---

## 4. UI System: Crafting Station Interface

The Crafting UI opens when interacting with a Crafting Station or launching the Profession window.

```
+-----------------------------------------------------------------------+
| BLACKSMITHING (Level 125 / 300)                            [ X ]      |
+-----------------------+-----------------------------------------------+
| RECIPES               | SELECTED RECIPE: Iron Broadsword              |
| Search: [_________]   |                                               |
|                       | Produces: [1H Sword] Iron Broadsword          |
| > Heavy Armor         | Crafting Time: 3.5s | Success Rate: 100%      |
|   - Iron Helm         +-----------------------------------------------+
|   - Iron Chestplate   | REQUIRED REAGENTS:                            |
| > Weapons             |  - [Icon] Iron Bar x8      (In Bag: 14/8)     |
|  * Iron Broadsword    |  - [Icon] Oak Wood x2      (In Bag: 5/2)      |
|   - Steel Longsword   |  - [Icon] Leather Strip x2 (In Bag: 1/2) *MISS|
| > Shield              +-----------------------------------------------+
|   - Iron Guard        | [ - ] Quantity: [ 1 ] [ + ]   [ Max ]         |
|                       |                                               |
|                       | [ CRAFT ITEM ]  [ CRAFT ALL ]                 |
+-----------------------+-----------------------------------------------+
```

### 4.1 UI Mechanics & User Flow
1. **Recipe Filter & Search:** Filters recipes by category, search text, or toggle `[x] Show Only Craftable`.
2. **Reagent Availability Tracking:** Real-time inventory check displaying current player count vs required count.
3. **Batch Crafting:** Allows players to set a slider or input number to craft multiple items sequentially.
4. **Progress Bar & State Lock:** Initiates a cast bar with optional crafting animations. Moving or closing UI cancels batch crafting cleanly.

---

## 5. Integration Specifications

### 5.1 Monster Loot Integration (Crafting Reagents)
* Monster drop tables configured in the **Monster Editor** must support linking directly to crafting materials created in the Item Builder (e.g., *Monster Bone*, *Elemental Dust*, *Raw Leather Hide*).

### 5.2 NPC / Merchant Integration (Recipes & Materials)
* **Recipe Learning Drops/Purchases:** Recipes can exist as item scrolls (created in Item Builder) that are consumed to permanently teach the player the recipe.
* **Merchant Event Stores:** NPC vendors managed via the **Events Tab** sell basic crafting tools (Pickaxe, Vial), elemental fluxes, and rare recipe scrolls.

---

## 6. Technical Data Schema Examples

### 6.1 Recipe Definition Schema
```json
{
  "recipe_id": "rec_alchemy_elixir_int_02",
  "recipe_name": "Greater Elixir of Intelligence",
  "profession": "ALCHEMY",
  "required_skill_level": 175,
  "required_station": "STATION_ALCHEMY_LAB",
  "crafting_time_seconds": 4.0,
  "exp_reward": 25,
  "reagents": [
    {
      "item_id": "mat_herb_silverleaf",
      "quantity": 3
    },
    {
      "item_id": "mat_herb_fadeleaf",
      "quantity": 2
    },
    {
      "item_id": "mat_crystal_vial",
      "quantity": 1
    }
  ],
  "output": {
    "item_id": "potion_int_tier_3",
    "yield_min": 1,
    "yield_max": 1,
    "success_chance_percent": 100.0,
    "crit_chance_percent": 5.0,
    "crit_output_item_id": "potion_int_tier_3_masterwork"
  }
}
```

### 6.2 Player Profession Progress State Schema
```json
{
  "character_id": "char_982341",
  "professions": [
    {
      "profession_id": "ALCHEMY",
      "current_level": 182,
      "max_level": 300,
      "current_xp": 1420,
      "unlocked_recipes": [
        "rec_alchemy_potion_hp_01",
        "rec_alchemy_elixir_int_01",
        "rec_alchemy_elixir_int_02"
      ]
    }
  ]
}
```
