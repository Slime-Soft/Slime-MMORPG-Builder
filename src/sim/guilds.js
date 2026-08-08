// src/sim/guilds.js
// Pure guild rules — ranks, permissions, buff maths, name validation.
//
// Deliberately free of any I/O or socket knowledge, exactly like party.js:
// the server owns persistence (server/guilds.js) and the wire protocol
// (server/index.js), and both the game client and the Guild Buff Builder
// import the constants below so "what a permission is called" and "what a
// buff can boost" are defined in exactly one place.

/**
 * Every permission a rank can carry. The key is what gets stored on a rank
 * (`rank.permissions.invite === true`); `label`/`hint` are what the in-game
 * Ranks editor renders, so adding a permission here makes it appear in the
 * UI without touching the UI.
 */
export const GUILD_PERMISSIONS = {
  invite: { label: 'Invite members', hint: 'Send guild invites to nearby players.' },
  kick: { label: 'Kick members', hint: 'Remove members of a LOWER rank. Never an equal or higher one.' },
  promote: { label: 'Change ranks', hint: 'Move members between ranks below their own.' },
  editRanks: { label: 'Edit ranks', hint: 'Create, rename, reorder and re-permission ranks.' },
  bankDeposit: { label: 'Bank: deposit', hint: 'Put gold and items into the guild bank.' },
  bankWithdraw: { label: 'Bank: withdraw', hint: 'Take gold and items out of the guild bank.' },
  buyBuffs: { label: 'Buy guild buffs', hint: 'Spend bank gold on guild-wide buffs.' },
  editGuild: { label: 'Edit guild', hint: 'Change the guild logo and message of the day.' },
};

export const GUILD_PERMISSION_IDS = Object.keys(GUILD_PERMISSIONS);

/** A permission set with everything off — the base every rank is built from. */
export function noPermissions() {
  return Object.fromEntries(GUILD_PERMISSION_IDS.map((id) => [id, false]));
}

/** A permission set with everything on — what the leader rank always holds. */
export function allPermissions() {
  return Object.fromEntries(GUILD_PERMISSION_IDS.map((id) => [id, true]));
}

/**
 * Ranks a brand-new guild starts with, lowest `order` = highest authority.
 * `order` is the whole authority model: a member may only kick/promote
 * someone whose order is strictly greater (further down) than their own,
 * which is what stops an Officer from kicking the Leader.
 */
export function defaultRanks() {
  return [
    { id: 'leader', name: 'Guild Master', order: 0, permissions: allPermissions() },
    {
      id: 'officer',
      name: 'Officer',
      order: 1,
      permissions: { ...noPermissions(), invite: true, kick: true, bankDeposit: true, bankWithdraw: true, buyBuffs: true },
    },
    { id: 'veteran', name: 'Veteran', order: 2, permissions: { ...noPermissions(), invite: true, bankDeposit: true } },
    { id: 'member', name: 'Member', order: 3, permissions: { ...noPermissions(), bankDeposit: true } },
  ];
}

export const MAX_GUILD_RANKS = 8;
export const MAX_GUILD_MEMBERS = 60;
export const GUILD_NAME_MIN = 3;
export const GUILD_NAME_MAX = 24;

/**
 * Validates a player-typed guild name. Returns an error string, or null when
 * the name is fine. Same "reject, don't silently rewrite" shape the character
 * name validator uses — this name is shown over people's heads to everyone
 * else, so it is checked on the server, never only in the form.
 */
export function validateGuildName(name) {
  const trimmed = String(name ?? '').trim();
  if (trimmed.length < GUILD_NAME_MIN) return `Guild names need at least ${GUILD_NAME_MIN} characters.`;
  if (trimmed.length > GUILD_NAME_MAX) return `Guild names can be at most ${GUILD_NAME_MAX} characters.`;
  if (!/^[\p{L}\p{N} '\-]+$/u.test(trimmed)) return 'Guild names may only use letters, numbers, spaces, apostrophes and hyphens.';
  if (/\s{2,}/.test(trimmed)) return 'Guild names cannot contain double spaces.';
  return null;
}

export function normalizeGuildName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/** The rank object a member currently holds, falling back to the lowest rank if their stored rankId no longer exists (a rank they were on was deleted). */
export function rankOf(guild, accountId) {
  const member = guild?.members?.find((m) => m.accountId === accountId);
  if (!member) return null;
  const ranks = [...(guild.ranks || [])].sort((a, b) => a.order - b.order);
  return ranks.find((r) => r.id === member.rankId) || ranks[ranks.length - 1] || null;
}

/** Whether `accountId` may do `permission` in `guild`. The leader always may, whatever their rank says — a guild that can lock its own owner out is a support ticket waiting to happen. */
export function hasPermission(guild, accountId, permission) {
  if (!guild) return false;
  if (guild.leaderAccountId === accountId) return true;
  return !!rankOf(guild, accountId)?.permissions?.[permission];
}

/** True when `actorId` outranks `targetId` — strictly, so equals can't act on each other. */
export function outranks(guild, actorId, targetId) {
  if (guild?.leaderAccountId === actorId) return targetId !== actorId;
  const a = rankOf(guild, actorId);
  const b = rankOf(guild, targetId);
  if (!a || !b) return false;
  return a.order < b.order;
}

// --- Guild buffs -----------------------------------------------------------

/**
 * What a guild buff can boost. `id` is stored on an authored buff's effect
 * rows (Guild Buff Builder); `apply` describes where the server multiplies it
 * in, which is documented here rather than in six places in server/index.js.
 */
export const GUILD_BUFF_EFFECT_TYPES = {
  xp: { label: 'Experience', hint: 'Combat XP from kills and quest turn-ins.' },
  craftXp: { label: 'Crafting XP', hint: 'Profession XP from every successful craft.' },
  damage: { label: 'Damage', hint: 'Damage dealt by guild members’ abilities.' },
  defense: { label: 'Damage reduction', hint: 'Damage taken by guild members.' },
  gold: { label: 'Gold', hint: 'Gold from vendor/merchant sales and quest rewards.' },
};

export const GUILD_BUFF_EFFECT_IDS = Object.keys(GUILD_BUFF_EFFECT_TYPES);

/** A blank authored buff, used by the builder's "New" button and as the shape server-side validation normalizes toward. */
export function emptyGuildBuff(id) {
  return {
    id,
    name: 'New Guild Buff',
    description: '',
    iconUrl: '',
    costGold: 500,
    durationMinutes: 60,
    effects: [{ type: 'xp', percent: 10 }],
  };
}

/**
 * Validates + normalizes one authored buff def. Throws on anything it can't
 * make sense of, so a bad POST is rejected wholesale instead of writing a
 * half-valid catalog (same contract as parseQuests/parseRecipeDefs).
 */
export function parseGuildBuff(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('a guild buff must be an object');
  const id = String(raw.id || '').trim();
  if (!/^[a-z0-9_-]{1,48}$/i.test(id)) throw new Error(`bad guild buff id "${raw.id}"`);
  const name = String(raw.name || '').trim();
  if (!name) throw new Error(`guild buff "${id}" needs a name`);
  const costGold = Math.round(Number(raw.costGold));
  if (!Number.isFinite(costGold) || costGold < 0) throw new Error(`guild buff "${id}" has an invalid costGold`);
  const durationMinutes = Number(raw.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new Error(`guild buff "${id}" has an invalid durationMinutes`);
  const effects = (Array.isArray(raw.effects) ? raw.effects : [])
    .map((e) => ({ type: String(e?.type || ''), percent: Number(e?.percent) }))
    .filter((e) => GUILD_BUFF_EFFECT_IDS.includes(e.type) && Number.isFinite(e.percent));
  if (!effects.length) throw new Error(`guild buff "${id}" needs at least one valid effect`);
  return {
    id,
    name,
    description: String(raw.description || ''),
    iconUrl: String(raw.iconUrl || ''),
    costGold,
    durationMinutes,
    effects,
  };
}

export function parseGuildBuffs(raw) {
  if (!Array.isArray(raw)) throw new Error('the guild buff catalog must be an array');
  const out = raw.map(parseGuildBuff);
  const seen = new Set();
  for (const b of out) {
    if (seen.has(b.id)) throw new Error(`duplicate guild buff id "${b.id}"`);
    seen.add(b.id);
  }
  return out;
}

/**
 * Combined multipliers from a guild's currently-active buffs.
 *
 * Percentages ADD before being applied (two +10% XP buffs are +20%, not
 * +21%), which is the rule players intuit and the one that keeps a stack of
 * buffs from quietly compounding into something nobody priced. Returns 1 for
 * every effect type when the guild is null or has nothing running, so callers
 * can multiply unconditionally.
 *
 * `defense` inverts: a +20% "damage reduction" buff returns 0.8, i.e. the
 * factor to multiply INCOMING damage by, clamped so it can never heal.
 */
export function guildBuffMultipliers(guild, now = Date.now()) {
  const out = Object.fromEntries(GUILD_BUFF_EFFECT_IDS.map((id) => [id, 1]));
  const percent = Object.fromEntries(GUILD_BUFF_EFFECT_IDS.map((id) => [id, 0]));
  for (const active of guild?.activeBuffs || []) {
    if (!active || active.expiresAt <= now) continue;
    for (const e of active.effects || []) {
      if (percent[e.type] === undefined) continue;
      percent[e.type] += Number(e.percent) || 0;
    }
  }
  for (const id of GUILD_BUFF_EFFECT_IDS) {
    out[id] = id === 'defense'
      ? Math.max(0.1, 1 - percent[id] / 100)
      : Math.max(0, 1 + percent[id] / 100);
  }
  return out;
}

/** Multipliers meaning "no guild, no buffs" — the value every non-guilded player gets. */
export function neutralGuildMultipliers() {
  return guildBuffMultipliers(null);
}
