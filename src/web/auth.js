// src/web/auth.js
// Thin client for /api/auth/* (server/accounts.js). Owns exactly one piece of
// state — the session token — and keeps it in localStorage so "Play" doesn't
// ask again on the next visit.
//
// The token is the ONLY credential kept anywhere on the client; the password
// is read out of the form, posted, and never stored, never echoed back, and
// never put in a URL.

const TOKEN_KEY = 'slime-mmo-session';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private mode / storage disabled — the visitor just stays signed out
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Non-fatal: the session simply won't survive a reload.
  }
}

/**
 * POSTs JSON and normalises both arms into something the form can render.
 * A non-2xx answer carries `{ error, field }` (see mountAuthRoutes), which is
 * what lets the modal highlight the specific input that was wrong.
 */
async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(body || {}),
    });
  } catch {
    // fetch only rejects on a transport failure — the server being down is by
    // far the likeliest cause here, and "check the server" is more useful than
    // whatever the browser's own message says.
    throw Object.assign(new Error('Could not reach the realm. Is the server running?'), { field: null });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(data.error || 'Something went wrong.'), { field: data.field || null });
  }
  return data;
}

function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function register({ username, password, email }) {
  const data = await post('/api/auth/register', { username, password, email });
  setToken(data.token);
  return data.user;
}

export async function login({ username, password }) {
  const data = await post('/api/auth/login', { username, password });
  setToken(data.token);
  return data.user;
}

export async function logout() {
  try {
    await post('/api/auth/logout', {});
  } finally {
    // Clear locally even if the request failed — the visitor clicked "sign
    // out" and the page must reflect that regardless of what the server said.
    setToken(null);
  }
}

/** The character saved against the signed-in account, or null. Never throws — a signed-out or offline caller just gets null and falls back to local storage. */
export async function fetchAccountCharacter() {
  if (!getToken()) return null;
  try {
    const response = await fetch('/api/account/character', { headers: authHeader() });
    if (!response.ok) return null;
    return (await response.json()).character || null;
  } catch {
    return null;
  }
}

/** Saves the character against the signed-in account. Returns whether it actually stuck, so callers can tell the player if it did not. */
export async function saveAccountCharacter(character) {
  if (!getToken()) return { ok: true }; // signed out: localStorage is the whole story, so there is nothing to fail
  try {
    const response = await fetch('/api/account/character', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ character }),
    });
    // The reason matters now, not just success: the server rejects a name
    // another account already holds, and the creation form has to be able to
    // say so instead of navigating away as though it had saved.
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => ({}));
    return { ok: false, error: data.error || 'Could not save your character.', field: data.field || null };
  } catch {
    return { ok: false, error: 'Could not reach the server.' };
  }
}

/** The signed-in account, or null. An expired/absent token is a normal null here, never a throw. */
export async function currentUser() {
  if (!getToken()) return null;
  try {
    const response = await fetch('/api/auth/me', { headers: authHeader() });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.user) setToken(null); // the server has forgotten this token (restart, expiry) — stop sending it
    return data.user;
  } catch {
    return null;
  }
}
