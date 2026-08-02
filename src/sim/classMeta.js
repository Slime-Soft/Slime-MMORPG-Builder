// src/sim/classMeta.js
// Lightweight class metadata used by character creation. Zero DOM deps.
// Part 2 of the character system adds full per-class ability lists
// (cooldowns, resource costs, animation timings) alongside this.

export const CLASS_META = {
  guardian: {
    name: 'Guardian',
    tagline: 'Sword & shield — tanky melee, holds the line.',
    resourceType: 'stamina',
  },
  warrior: {
    name: 'Warrior',
    tagline: 'Relentless melee damage.',
    resourceType: 'rage',
  },
  mage: {
    name: 'Mage',
    tagline: 'Ranged magic damage, high burst.',
    resourceType: 'mana',
  },
  archer: {
    name: 'Archer',
    tagline: 'Ranged physical damage, mobile.',
    resourceType: 'focus',
  },
  priest: {
    name: 'Priest',
    tagline: 'Healing and support for the party.',
    resourceType: 'mana',
  },
};

export const CLASS_IDS = Object.keys(CLASS_META);
