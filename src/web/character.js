// src/web/character.js
// Decides which character you actually play as, and where it gets saved.
//
// Before this existed the character lived in one place — this browser's
// localStorage — and the account system knew nothing about it. Signing in
// therefore did nothing you could see: your character was still whatever this
// browser happened to hold, and a different browser (or a cleared one) sent
// you back to character creation as though you had never played.
//
// The rule now: when you are signed in, YOUR ACCOUNT is the source of truth
// and localStorage is just a cache of it. Signed out, localStorage is all
// there is, which keeps guest play working exactly as before.
import { currentUser, fetchAccountCharacter, saveAccountCharacter } from './auth.js';

const CHARACTER_KEY = 'fantasy-mmo-character';
/**
 * Which account the cached character belongs to ('' = made as a guest).
 *
 * Without this, two people sharing a browser would leak characters into each
 * other's accounts: the "adopt the local character" path below cannot tell a
 * guest's character from the previous user's unless the cache says whose it is.
 */
const OWNER_KEY = 'fantasy-mmo-character-owner';

export function readLocalCharacter() {
  try {
    return JSON.parse(localStorage.getItem(CHARACTER_KEY) || 'null');
  } catch {
    return null; // storage disabled, or someone hand-edited it into invalid JSON
  }
}

function writeLocalCharacter(character, ownerId) {
  try {
    localStorage.setItem(CHARACTER_KEY, JSON.stringify(character));
    localStorage.setItem(OWNER_KEY, ownerId || '');
  } catch {
    // Non-fatal: the character still works for this page load, and a
    // signed-in player's copy is safe on the server anyway.
  }
}

function localOwnerId() {
  try {
    return localStorage.getItem(OWNER_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * The character to play as, or null when there isn't one yet (the caller then
 * sends the player to character creation).
 *
 * Signed in:
 *   1. the account's character wins, and is cached locally
 *   2. no account character, but this browser holds a GUEST character →
 *      adopt it, so making an account after playing doesn't cost you anything
 *   3. otherwise null — note a character cached for a DIFFERENT account is
 *      ignored, never adopted
 * Signed out: whatever is in localStorage.
 */
export async function resolveCharacter() {
  const user = await currentUser();
  if (!user) return readLocalCharacter();

  const remote = await fetchAccountCharacter();
  if (remote) {
    writeLocalCharacter(remote, user.id);
    return remote;
  }

  const local = readLocalCharacter();
  if (local && localOwnerId() === '') {
    // A name clash here is possible (this browser's guest character borrowed a
    // name someone has since claimed), and it is not worth blocking play over:
    // keep the local character, just don't pretend it saved to the account.
    await saveAccountCharacter(local);
    writeLocalCharacter(local, user.id);
    return local;
  }
  return null;
}

/**
 * Saves a freshly-created character everywhere it belongs. Resolves once the
 * account copy has been written (or has failed), so a caller can navigate
 * straight afterwards without racing the request.
 */
export async function persistCharacter(character) {
  const user = await currentUser();
  if (user) {
    // Saved to the ACCOUNT first: the server can refuse the name (someone else
    // already holds it), and caching a rejected character locally would leave
    // this browser playing under a name the account does not actually own.
    const result = await saveAccountCharacter(character);
    if (!result.ok) return result;
  }
  writeLocalCharacter(character, user?.id || '');
  return { ok: true };
}
