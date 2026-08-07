// server/accounts.js
// Account storage + session issuing for the public landing page (public/home.html).
//
// SCOPE, honestly stated: this is a dev-grade account system, not a production
// auth stack. It is deliberately the smallest thing that is actually REAL —
// passwords are salted and scrypt-hashed and never stored or logged in the
// clear, comparisons are constant-time — rather than a mock that pretends.
// What it is NOT, and what has to land before this faces the open internet:
//
//   - no HTTPS enforcement (tokens travel in plain HTTP on localhost today)
//   - no email verification / password reset
//   - sessions live in memory, so a server restart signs everyone out
//   - accounts.json is a flat file; concurrent writers would race
//   - no account is bound to a character yet — the game still reads its
//     character out of localStorage (see src/main.js). Wiring saved
//     progression to an account id is the follow-up this exists to enable.
//
// The same load/validate/save/.bak pattern every other catalog in this server
// uses (items, quests, recipes) applies here too, so it fails the same way and
// is backed up the same way.
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import path from 'path';

const scrypt = promisify(_scrypt);

// scrypt cost. 2^15 keeps a single hash around ~100ms on a typical dev box —
// slow enough to matter against an offline crack of a leaked accounts.json,
// fast enough that a login doesn't stall the game's tick loop noticeably.
//
// maxmem is NOT optional here. scrypt needs roughly 128 * N * r bytes
// (128 * 32768 * 8 ≈ 33.5 MB) and Node's default ceiling is 32 MB, so leaving
// it out makes every single hash throw ERR_CRYPTO_INVALID_SCRYPT_PARAMS —
// i.e. raising N without raising this silently breaks all auth rather than
// making it stronger.
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2; // 2× the requirement, as headroom
const SALT_BYTES = 16;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // a week — long enough that "Play" doesn't ask again every session
const MAX_FAILED_LOGINS = 8;      // per username+IP pair
const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;
export const MIN_PASSWORD_LENGTH = 8;

/**
 * A single field's worth of validation failure. Thrown by the functions below
 * and turned into a 400 by the routes — `field` lets the landing page's form
 * highlight the offending input instead of dumping one generic error.
 */
class AccountError extends Error {
  constructor(message, { status = 400, field = null } = {}) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

/**
 * The account store. One JSON file, loaded once at construction and rewritten
 * (with a .bak) on every mutation — same durability story as items.json.
 * Sessions are deliberately NOT persisted: a token is cheap to re-issue and
 * keeping them out of the file means a stolen accounts.json grants nobody an
 * active session.
 */
export function createAccountStore(rootDir) {
  const dir = path.join(rootDir, 'accounts');
  const file = path.join(dir, 'accounts.json');
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, '[]');

  /** @type {Array<{id: string, username: string, usernameLower: string, email: string|null, salt: string, hash: string, createdAt: number, lastLoginAt: number|null}>} */
  let accounts;
  try {
    accounts = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(accounts)) throw new Error('accounts.json must contain an array');
  } catch (err) {
    // Unlike a content catalog, a corrupt accounts file must NOT be silently
    // replaced with an empty one — that would quietly delete everyone. Fail
    // loudly and let a human look at the file.
    throw new Error(`accounts.json is unreadable (${err.message}) — refusing to start with a corrupt account store`);
  }

  /** @type {Map<string, {accountId: string, expiresAt: number}>} token -> session */
  const sessions = new Map();
  /** @type {Map<string, {count: number, firstAt: number}>} "user@ip" -> throttle state */
  const failedLogins = new Map();

  function persist() {
    if (existsSync(file)) copyFileSync(file, file + '.bak');
    writeFileSync(file, JSON.stringify(accounts, null, 2));
  }

  function findByUsername(username) {
    const lower = String(username || '').toLowerCase();
    return accounts.find((a) => a.usernameLower === lower) || null;
  }

  /** What the client is allowed to see about an account — never the salt or hash. */
  function publicView(account) {
    return {
      id: account.id,
      username: account.username,
      email: account.email,
      createdAt: account.createdAt,
      lastLoginAt: account.lastLoginAt,
    };
  }

  async function hashPassword(password, salt) {
    const derived = await scrypt(password, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, maxmem: SCRYPT_MAXMEM });
    return derived.toString('hex');
  }

  function issueSession(account) {
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { accountId: account.id, expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  /** Drops expired sessions. Called on every lookup — the map is small enough that a sweep is cheaper than a timer. */
  function sweepSessions(now) {
    for (const [token, s] of sessions) {
      if (s.expiresAt <= now) sessions.delete(token);
    }
  }

  function validateCredentials(username, password) {
    if (!USERNAME_RE.test(String(username || ''))) {
      throw new AccountError(
        'Username must be 3–20 characters, using only letters, numbers, hyphens and underscores.',
        { field: 'username' }
      );
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
      throw new AccountError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        { field: 'password' }
      );
    }
  }

  /** Optional at signup — stored only so a future password-reset flow has somewhere to send to. */
  function validateEmail(email) {
    if (email == null || email === '') return null;
    const trimmed = String(email).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      throw new AccountError('That email address does not look valid.', { field: 'email' });
    }
    return trimmed;
  }

  return {
    AccountError,

    async register({ username, password, email }) {
      validateCredentials(username, password);
      const cleanEmail = validateEmail(email);
      if (findByUsername(username)) {
        throw new AccountError('That name is already claimed. Choose another.', { field: 'username', status: 409 });
      }
      const salt = randomBytes(SALT_BYTES).toString('hex');
      const account = {
        id: randomBytes(12).toString('hex'),
        username: String(username),
        usernameLower: String(username).toLowerCase(),
        email: cleanEmail,
        salt,
        hash: await hashPassword(password, salt),
        createdAt: Date.now(),
        lastLoginAt: Date.now(),
      };
      accounts.push(account);
      persist();
      return { token: issueSession(account), user: publicView(account) };
    },

    async login({ username, password }, ip = 'unknown') {
      const throttleKey = `${String(username || '').toLowerCase()}@${ip}`;
      const now = Date.now();
      const attempt = failedLogins.get(throttleKey);
      if (attempt && now - attempt.firstAt > FAILED_LOGIN_WINDOW_MS) {
        failedLogins.delete(throttleKey); // window elapsed — start counting again
      } else if (attempt && attempt.count >= MAX_FAILED_LOGINS) {
        throw new AccountError('Too many failed attempts. Wait a few minutes and try again.', { status: 429 });
      }

      const account = findByUsername(username);
      // Deliberately the SAME message and the same rough timing whether the
      // account exists or the password is wrong — a distinguishable "no such
      // user" turns the login form into a username oracle.
      const failure = new AccountError('Wrong name or password.', { status: 401, field: 'password' });
      if (!account) {
        await hashPassword(String(password || ''), 'decoy-salt'); // burn comparable time
        throw failure;
      }
      const candidate = Buffer.from(await hashPassword(String(password || ''), account.salt), 'hex');
      const stored = Buffer.from(account.hash, 'hex');
      if (candidate.length !== stored.length || !timingSafeEqual(candidate, stored)) {
        const prev = failedLogins.get(throttleKey);
        failedLogins.set(throttleKey, { count: (prev?.count || 0) + 1, firstAt: prev?.firstAt || now });
        throw failure;
      }

      failedLogins.delete(throttleKey);
      account.lastLoginAt = now;
      persist();
      return { token: issueSession(account), user: publicView(account) };
    },

    /** The account behind a bearer token, or null if it's absent/expired/unknown. */
    resolveSession(token) {
      if (!token) return null;
      const now = Date.now();
      sweepSessions(now);
      const session = sessions.get(token);
      if (!session) return null;
      const account = accounts.find((a) => a.id === session.accountId);
      return account ? publicView(account) : null;
    },

    logout(token) {
      return sessions.delete(token);
    },

    get count() {
      return accounts.length;
    },
  };
}

/**
 * Mounts /api/auth/* on an Express app. Kept here rather than inline in
 * server/index.js so the account surface is one readable file — index.js is
 * already 4k lines of game server and this is not game logic.
 *
 * Every route answers with either `{ ok: true, ... }` or
 * `{ error, field? }`, which is exactly the shape src/web/auth.js expects.
 */
export function mountAuthRoutes(app, store) {
  /** Reads the `Authorization: Bearer <token>` header, tolerating a missing/odd header. */
  function bearerToken(req) {
    const header = req.get('authorization') || '';
    const match = header.match(/^Bearer\s+(\S+)$/i);
    return match ? match[1] : null;
  }

  function fail(res, err) {
    const status = err?.status || 500;
    if (status >= 500) console.error('[auth]', err);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on our side.' : err.message,
      field: err?.field || null,
    });
  }

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { username, password, email } = req.body || {};
      res.json({ ok: true, ...(await store.register({ username, password, email })) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = req.body || {};
      res.json({ ok: true, ...(await store.login({ username, password }, req.ip)) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    store.logout(bearerToken(req));
    res.json({ ok: true });
  });

  // The landing page calls this on load to decide between "Create Account"
  // and "Welcome back". A stale/expired token is a normal, expected outcome
  // here — not an error — so it answers 200 with user: null.
  app.get('/api/auth/me', (req, res) => {
    res.json({ ok: true, user: store.resolveSession(bearerToken(req)) });
  });
}
