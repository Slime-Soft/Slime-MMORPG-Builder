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
