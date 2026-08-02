# Classic MMO Character Stats System Architecture Specification

## Executive Summary
This document provides a complete technical and system design architecture for a **Classic MMO Character Stats System**. It covers stat definitions, allocation logic, user interface workflows, and integration specifications for external sub-systems (Item Builder, Skill/Buff System, Character/Class Editor, and Monster Editor).

---

## 1. Core Architecture & Stat Definitions

The engine utilizes a unified **Global Stat Engine (GSE)**. All entities (Players, NPCs, Monsters, Items, Buffs) interface with the same core stat data structure.

### 1.1 Primary Attributes
Every entity in the game possesses six foundational primary attributes:

| Stat Identifier | Name | Description & Primary Scaling Effects |
| :--- | :--- | :--- |
| `STR` | **Strength** | Increases Physical Melee Damage, Heavy Armor Efficiency, and Carrying Capacity. |
| `AGI` | **Agility** | Increases Attack Speed, Dodge/Evasion Chance, and Ranged Physical Damage. |
| `DEX` | **Dexterity** | Increases Hit Accuracy, Critical Hit Chance, and Armor Penetration. |
| `INT` | **Intelligence** | Increases Magic Power/Spell Damage, Maximum Mana, and Mana Regeneration. |
| `WIS` | **Wisdom** | Increases Healing Power, Status Effect Resistance, and Magic Resistance. |
| `VIT` | **Vitality** | Increases Maximum Health (HP), Health Regeneration, and Physical Defense. |

### 1.2 Derived / Secondary Stats Formulations
Secondary stats are dynamically computed by the GSE based on base values, class multipliers, gear, and active buffs.

```
Max_HP       = Base_HP + (VIT * 10.0) + Level_Scaling
Max_MP       = Base_MP + (INT * 12.0) + (WIS * 4.0)
Spell_Power  = (INT * 1.5) + Equipment_Spell_Power
Phys_Power   = (STR * 1.5) + (AGI * 0.5) + Weapon_Attack
Crit_Chance  = Base_Crit + (DEX * 0.05%)
Dodge_Chance = Base_Dodge + (AGI * 0.04%)
HP_Regen     = (VIT * 0.15) + Base_HP_Regen
MP_Regen     = (WIS * 0.20) + (INT * 0.05)
```

---

## 2. Level Up & Stat Allocation Engine

### 2.1 Progression Rules
1. **Stat Point Award:** Upon each level up event, the system grants the character exactly **1 Assignable Stat Point** (`unassigned_stat_points += 1`).
2. **Point Retention:** Unassigned points persist indefinitely across sessions until allocated.
3. **Stat Limits & Caps (Configurable):**
   - **Hard Cap:** Absolute maximum value per attribute (e.g., 255 points).
   - **Soft Cap (Diminishing Returns):** Past threshold $T$ (e.g., 50 points allocated), stat conversion efficiency drops by $\delta$ (e.g., 10% per 10 additional points).

---

## 3. UI System: Stat Allocation Interface

### 3.1 UI Component Architecture
The Character Sheet UI requires a interactive allocation panel featuring state previewing prior to network commit.

```
+-------------------------------------------------------+
| CHARACTER STATS                   Points Available: 3 |
+-------------------------------------------------------+
| Strength (STR):     24  [ + ] [ - ]                   |
| Agility (AGI):      12  [ + ] [ - ]                   |
| Dexterity (DEX):    15  [ + ] [ - ]                   |
| Intelligence (INT):  8  [ + ] [ - ]                   |
| Wisdom (WIS):       10  [ + ] [ - ]                   |
| Vitality (VIT):     18  [ + ] [ - ]                   |
+-------------------------------------------------------+
|  [ Reset Preview ]                    [ Apply / Save ]|
+-------------------------------------------------------+
```

### 3.2 UI Logic & User Flow
1. **Buffer State (Client-Side):**
   - Clicking `[ + ]` decrements `temporary_unassigned_points` and increments `buffered_stat_value`.
   - Clicking `[ - ]` reverts points back to the pool (only for uncommitted changes in current session).
   - Stat previews (e.g., updated HP/Spell Damage) dynamically highlight in green.
2. **Commit Transaction (Server Authority):**
   - Pressing **Apply / Save** sends a payload to the server: `{ character_id, allocated_points: { STR: 1, INT: 2 } }`.
   - Server validates available points, applies changes, and returns updated entity state.
3. **Respec Mechanism:**
   - Dedicated "Reset Stat Points" API trigger via specific items (e.g., *Scroll of Oblivion*) or gold cost.

---

## 4. Integration Specifications

### 4.1 Item Builder System
Items must support stat modification properties integrated into the GSE.

- **Equipable Equipment (Passive Modifiers):**
  - Items define modifier lists: e.g., `+5 INT`, `+12 VIT`, `+2% Crit Chance`.
- **Consumables / Potions:**
  - **Temporary Buff Potions:** E.g., *Elixir of Arcane Mind* -> Grants `+15 INT` for 1800 seconds.
  - **Permanent Stat Boosters:** E.g., *Tome of Eternal Strength* -> Adds `+1 Permanent Stat Point` to `unassigned_stat_points`.

```json
{
  "item_id": "potion_int_tier_3",
  "name": "Greater Elixir of Intelligence",
  "type": "CONSUMABLE",
  "effect": {
    "type": "STAT_MODIFIER",
    "target_stat": "INT",
    "value": 15,
    "duration_seconds": 1800,
    "is_percentage": false
  }
}
```

### 4.2 Skill & Buff System
Skills and spell effects must be capable of directly reading and modifying stats.

- **Stat Buffs & Debuffs:**
  - *Buff:* "Warrior's Battle Cry" -> Flat `+10 STR` or `+10% STR` for all nearby party members.
  - *Debuff:* "Wither Curse" -> Reductions applied to `VIT` or `AGI`.
- **Dynamic Skill Scaling:**
  - Skill damage formulas parse the character's computed stats.
  - *Formula:* $	ext{Fireball Damage} = 	ext{BaseDamage} + (	ext{Computed\_INT} 	imes 2.5)$.

### 4.3 Character Class & Monster Editors
Initial base stats for all entities must be authorable in administrative tools.

- **Character Class Editor:**
  - Configures starting base stats for Level 1 classes.
  - *Warrior:* High baseline `STR` / `VIT`, low `INT`.
  - *Mage:* High baseline `INT` / `WIS`, low `STR`.
- **Monster Editor:**
  - Applies identical primary stat structures to NPCs and monsters.
  - Bosses and standard mobs use primary stats (`STR`, `VIT`, etc.) to drive their HP pools and hit power, ensuring consistent armor/resistance calculations against players.

---

## 5. System Schema / Data Model

```json
{
  "character_id": "char_982341",
  "level": 12,
  "unassigned_stat_points": 2,
  "base_stats": {
    "STR": 18,
    "AGI": 10,
    "DEX": 12,
    "INT": 5,
    "WIS": 6,
    "VIT": 15
  },
  "allocated_stat_points": {
    "STR": 8,
    "AGI": 1,
    "DEX": 2,
    "INT": 0,
    "WIS": 0,
    "VIT": 0
  }
}
```
