// src/web/characterName.js
// One definition of what a character name may be, shared by the creation form
// and the server.
//
// Deliberately free of DOM and storage access so the server can import it too:
// the name is broadcast to every other player in range, so it cannot be
// whatever the client says it is. The form uses this to give immediate
// feedback; the server uses the same rules to decide what it will actually
// accept and relay.

export const NAME_MIN = 2;
export const NAME_MAX = 20;

// Letters (including accented), digits, spaces, hyphens and apostrophes.
// \p{L} rather than A-Z so names outside the Latin alphabet are not rejected.
const ALLOWED = /^[\p{L}\p{N} '-]+$/u;

/**
 * Trims and collapses runs of whitespace. Applied before validation AND before
 * storage, so " Ash   vale " and "Ash vale" cannot coexist as two names that
 * look identical to everyone reading them.
 */
export function normalizeCharacterName(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * @returns {string|null} a human-readable problem, or null when the name is fine.
 */
export function validateCharacterName(raw) {
  const name = normalizeCharacterName(raw);
  if (!name) return 'Your character needs a name.';
  // Counted in code points, not UTF-16 units, so an emoji or an astral-plane
  // character costs one character rather than two.
  const length = [...name].length;
  if (length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!ALLOWED.test(name)) return 'Letters, numbers, spaces, hyphens and apostrophes only.';
  if (!/\p{L}/u.test(name)) return 'Names need at least one letter.';
  return null;
}

/**
 * The name to actually display for a player, given whatever their character
 * object holds. Older characters were created before names existed, so this
 * never returns empty — it falls back rather than showing a blank nameplate.
 */
export function displayName(character, fallback = 'Adventurer') {
  const name = normalizeCharacterName(character?.name);
  return validateCharacterName(name) === null ? name : fallback;
}
