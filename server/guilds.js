// server/guilds.js
// Persistence + mutation for guilds. The same load/validate/save/.bak pattern
// every other catalog in this server uses (items, quests, accounts), so it
// fails the same way and is backed up the same way.
//
// Guilds are keyed by ACCOUNT id, not socket id: membership has to survive a
// reconnect, and a guest (no account) genuinely cannot be in a guild — the
// socket layer refuses those requests rather than inventing a temporary id
// that would evaporate on refresh.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'fs';
import { randomBytes } from 'crypto';
import path from 'path';
import {
  defaultRanks, allPermissions, noPermissions, GUILD_PERMISSION_IDS,
  MAX_GUILD_RANKS, MAX_GUILD_MEMBERS, validateGuildName, normalizeGuildName,
  hasPermission, outranks, rankOf, guildBuffMultipliers,
} from '../src/sim/guilds.js';

const MAX_BANK_LOG = 60; // recent bank movements kept for the panel's history list

export function createGuildStore(rootDir) {
  const dir = path.join(rootDir, 'guilds');
  const file = path.join(dir, 'guilds.json');
  mkdirSync(dir, { recursive: true });

  /** @type {object[]} */
  let guilds = [];
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      guilds = Array.isArray(parsed) ? parsed : (parsed?.guilds ?? []);
    }
  } catch (err) {
    // Same rule as accounts.json: a corrupt file must not take the server
    // down. The .bak next to it is the recovery path.
    console.error(`[guilds] could not read ${file}: ${err.message} — starting with no guilds`);
    guilds = [];
  }
  for (const g of guilds) migrate(g);

  function persist() {
    if (existsSync(file)) copyFileSync(file, file + '.bak');
    writeFileSync(file, JSON.stringify(guilds, null, 2));
  }

  /** Back-fills fields added after a guild was first written, so an old guilds.json never reads as half-broken. */
  function migrate(guild) {
    guild.ranks = Array.isArray(guild.ranks) && guild.ranks.length ? guild.ranks : defaultRanks();
    for (const r of guild.ranks) {
      r.permissions = { ...noPermissions(), ...(r.permissions || {}) };
    }
    guild.members = Array.isArray(guild.members) ? guild.members : [];
    guild.bank = guild.bank || { gold: 0, items: {} };
    guild.bank.items = guild.bank.items || {};
    guild.bank.log = Array.isArray(guild.bank.log) ? guild.bank.log : [];
    guild.activeBuffs = Array.isArray(guild.activeBuffs) ? guild.activeBuffs : [];
    guild.motd = typeof guild.motd === 'string' ? guild.motd : '';
    guild.logoUrl = typeof guild.logoUrl === 'string' ? guild.logoUrl : '';
    return guild;
  }

  const byId = (id) => guilds.find((g) => g.id === id) || null;
  const byAccount = (accountId) =>
    (accountId ? guilds.find((g) => g.members.some((m) => m.accountId === accountId)) : null) || null;
  const byNameLower = (name) => guilds.find((g) => g.name.toLowerCase() === String(name).toLowerCase()) || null;

  function memberOf(guild, accountId) {
    return guild.members.find((m) => m.accountId === accountId) || null;
  }

  function logBank(guild, entry) {
    guild.bank.log.unshift({ at: Date.now(), ...entry });
    if (guild.bank.log.length > MAX_BANK_LOG) guild.bank.log.length = MAX_BANK_LOG;
  }

  /** Drops expired buffs. Called before anything reads them, so an expired buff is never served to a client and never persisted forever. */
  function sweepBuffs(guild, now = Date.now()) {
    const before = guild.activeBuffs.length;
    guild.activeBuffs = guild.activeBuffs.filter((b) => b.expiresAt > now);
    return guild.activeBuffs.length !== before;
  }

  return {
    get all() {
      return guilds;
    },

    byId,
    byAccount,

    /** Sweeps expired buffs across every guild; returns the ids whose buff list actually changed, so the caller only re-broadcasts those. */
    sweepAllBuffs(now = Date.now()) {
      const changed = [];
      for (const g of guilds) if (sweepBuffs(g, now)) changed.push(g.id);
      if (changed.length) persist();
      return changed;
    },

    /**
     * Founds a guild with `accountId` as its leader.
     * @returns {{ok:true, guild:object} | {ok:false, error:string}}
     */
    create({ accountId, characterName, name }) {
      if (!accountId) return { ok: false, error: 'Sign in to found a guild.' };
      if (byAccount(accountId)) return { ok: false, error: 'You are already in a guild.' };
      const clean = normalizeGuildName(name);
      const invalid = validateGuildName(clean);
      if (invalid) return { ok: false, error: invalid };
      if (byNameLower(clean)) return { ok: false, error: 'A guild with that name already exists.' };

      const guild = migrate({
        id: `guild-${randomBytes(8).toString('hex')}`,
        name: clean,
        logoUrl: '',
        motd: '',
        createdAt: Date.now(),
        leaderAccountId: accountId,
        ranks: defaultRanks(),
        members: [{ accountId, name: characterName || 'Adventurer', rankId: 'leader', joinedAt: Date.now(), contributedGold: 0 }],
        bank: { gold: 0, items: {}, log: [] },
        activeBuffs: [],
      });
      guilds.push(guild);
      persist();
      return { ok: true, guild };
    },

    /** Keeps the stored display name in step with the character name the player actually plays under. Cheap, and it means the roster isn't stale for anyone who renamed. */
    touchMemberName(accountId, characterName) {
      const guild = byAccount(accountId);
      if (!guild || !characterName) return null;
      const member = memberOf(guild, accountId);
      if (!member || member.name === characterName) return guild;
      member.name = characterName;
      persist();
      return guild;
    },

    addMember(guildId, accountId, characterName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (byAccount(accountId)) return { ok: false, error: 'You are already in a guild.' };
      if (guild.members.length >= MAX_GUILD_MEMBERS) return { ok: false, error: 'That guild is full.' };
      const lowest = [...guild.ranks].sort((a, b) => a.order - b.order).at(-1);
      guild.members.push({
        accountId,
        name: characterName || 'Adventurer',
        rankId: lowest?.id || 'member',
        joinedAt: Date.now(),
        contributedGold: 0,
      });
      persist();
      return { ok: true, guild };
    },

    /**
     * Removes a member. `actorId === accountId` is a voluntary leave (always
     * allowed unless they're the leader of a guild that still has other
     * members); otherwise it's a kick and needs both the permission and a
     * strictly higher rank.
     */
    removeMember(guildId, actorId, accountId) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!memberOf(guild, accountId)) return { ok: false, error: 'They are not in this guild.' };

      if (actorId !== accountId) {
        if (!hasPermission(guild, actorId, 'kick')) return { ok: false, error: 'Your rank cannot kick members.' };
        if (!outranks(guild, actorId, accountId)) return { ok: false, error: 'You can only kick members ranked below you.' };
      } else if (guild.leaderAccountId === accountId && guild.members.length > 1) {
        return { ok: false, error: 'Pass leadership to someone else before leaving.' };
      }

      guild.members = guild.members.filter((m) => m.accountId !== accountId);
      // Last one out closes the guild. Keeping an empty guild alive would
      // squat its name forever with nobody able to reclaim it.
      if (!guild.members.length) {
        guilds = guilds.filter((g) => g.id !== guild.id);
        persist();
        return { ok: true, guild: null, disbanded: true };
      }
      persist();
      return { ok: true, guild, disbanded: false };
    },

    setRank(guildId, actorId, accountId, rankId) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'promote')) return { ok: false, error: 'Your rank cannot change ranks.' };
      const member = memberOf(guild, accountId);
      if (!member) return { ok: false, error: 'They are not in this guild.' };
      const target = guild.ranks.find((r) => r.id === rankId);
      if (!target) return { ok: false, error: 'No such rank.' };
      if (accountId !== actorId && !outranks(guild, actorId, accountId)) {
        return { ok: false, error: 'You can only change ranks below your own.' };
      }
      // Nobody may hand out a rank at or above their own — that's a promotion
      // to peer/superior, which is how an Officer would quietly seize a guild.
      const actorRank = rankOf(guild, actorId);
      if (guild.leaderAccountId !== actorId && actorRank && target.order <= actorRank.order) {
        return { ok: false, error: 'You cannot promote anyone to your own rank or higher.' };
      }
      member.rankId = rankId;
      persist();
      return { ok: true, guild };
    },

    /** Hands the guild (and the leader rank) to another member. Leader-only, deliberately: it is the one action with no undo. */
    transferLeadership(guildId, actorId, accountId) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (guild.leaderAccountId !== actorId) return { ok: false, error: 'Only the guild master can pass leadership.' };
      const member = memberOf(guild, accountId);
      if (!member) return { ok: false, error: 'They are not in this guild.' };
      const top = [...guild.ranks].sort((a, b) => a.order - b.order)[0];
      const second = [...guild.ranks].sort((a, b) => a.order - b.order)[1] || top;
      memberOf(guild, actorId).rankId = second.id;
      member.rankId = top.id;
      guild.leaderAccountId = accountId;
      persist();
      return { ok: true, guild };
    },

    /**
     * Replaces the whole rank table. Whole-table rather than per-rank because
     * `order` is relative — editing one rank's position is meaningless
     * without the others, and a partial write could leave two ranks claiming
     * order 0.
     */
    setRanks(guildId, actorId, rawRanks) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'editRanks')) return { ok: false, error: 'Your rank cannot edit ranks.' };
      if (!Array.isArray(rawRanks) || !rawRanks.length) return { ok: false, error: 'A guild needs at least one rank.' };
      if (rawRanks.length > MAX_GUILD_RANKS) return { ok: false, error: `At most ${MAX_GUILD_RANKS} ranks.` };

      const seen = new Set();
      const ranks = [];
      for (const [i, raw] of rawRanks.entries()) {
        const id = String(raw?.id || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '') || `rank${i}`;
        if (seen.has(id)) return { ok: false, error: 'Two ranks share the same id.' };
        seen.add(id);
        const name = String(raw?.name || '').trim().slice(0, 24);
        if (!name) return { ok: false, error: 'Every rank needs a name.' };
        const permissions = { ...noPermissions() };
        for (const p of GUILD_PERMISSION_IDS) permissions[p] = !!raw?.permissions?.[p];
        ranks.push({ id, name, order: i, permissions });
      }
      // The top rank is the leader's, and it always holds everything — an
      // editRanks holder must not be able to strip the guild master's own
      // powers out from under them.
      ranks[0].permissions = allPermissions();

      // Members sitting on a rank that just disappeared fall to the bottom
      // rather than becoming permissionless ghosts.
      const validIds = new Set(ranks.map((r) => r.id));
      for (const m of guild.members) if (!validIds.has(m.rankId)) m.rankId = ranks.at(-1).id;
      memberOf(guild, guild.leaderAccountId) && (memberOf(guild, guild.leaderAccountId).rankId = ranks[0].id);

      guild.ranks = ranks;
      persist();
      return { ok: true, guild };
    },

    setLogo(guildId, actorId, logoUrl) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'editGuild')) return { ok: false, error: 'Your rank cannot edit the guild.' };
      const url = String(logoUrl || '');
      // Only paths this server itself handed back from the upload route. A
      // free-form URL here would be an arbitrary remote image loaded into
      // every player's client the moment they walk past a guild member.
      if (url && !/^\/assets\/guilds\/[\w.-]+$/.test(url)) return { ok: false, error: 'That logo path is not one of ours.' };
      guild.logoUrl = url;
      persist();
      return { ok: true, guild };
    },

    setMotd(guildId, actorId, motd) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'editGuild')) return { ok: false, error: 'Your rank cannot edit the guild.' };
      guild.motd = String(motd || '').slice(0, 240);
      persist();
      return { ok: true, guild };
    },

    // --- Bank ---------------------------------------------------------------

    depositGold(guildId, actorId, amount, actorName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'bankDeposit')) return { ok: false, error: 'Your rank cannot deposit.' };
      const gold = Math.floor(Number(amount));
      if (!Number.isFinite(gold) || gold <= 0) return { ok: false, error: 'Enter an amount above zero.' };
      guild.bank.gold += gold;
      const member = memberOf(guild, actorId);
      if (member) member.contributedGold = (member.contributedGold || 0) + gold;
      logBank(guild, { kind: 'deposit-gold', by: actorName || member?.name || '?', amount: gold });
      persist();
      return { ok: true, guild, gold };
    },

    withdrawGold(guildId, actorId, amount, actorName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'bankWithdraw')) return { ok: false, error: 'Your rank cannot withdraw.' };
      const gold = Math.floor(Number(amount));
      if (!Number.isFinite(gold) || gold <= 0) return { ok: false, error: 'Enter an amount above zero.' };
      if (guild.bank.gold < gold) return { ok: false, error: 'The guild bank does not hold that much.' };
      guild.bank.gold -= gold;
      logBank(guild, { kind: 'withdraw-gold', by: actorName || memberOf(guild, actorId)?.name || '?', amount: gold });
      persist();
      return { ok: true, guild, gold };
    },

    depositItem(guildId, actorId, itemId, quantity, actorName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'bankDeposit')) return { ok: false, error: 'Your rank cannot deposit.' };
      const qty = Math.floor(Number(quantity));
      if (!itemId || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Nothing to deposit.' };
      guild.bank.items[itemId] = (guild.bank.items[itemId] || 0) + qty;
      logBank(guild, { kind: 'deposit-item', by: actorName || memberOf(guild, actorId)?.name || '?', itemId, amount: qty });
      persist();
      return { ok: true, guild, itemId, quantity: qty };
    },

    withdrawItem(guildId, actorId, itemId, quantity, actorName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'bankWithdraw')) return { ok: false, error: 'Your rank cannot withdraw.' };
      const qty = Math.floor(Number(quantity));
      if (!itemId || !Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Nothing to withdraw.' };
      const held = guild.bank.items[itemId] || 0;
      if (held < qty) return { ok: false, error: 'The guild bank does not hold that many.' };
      const left = held - qty;
      if (left > 0) guild.bank.items[itemId] = left;
      else delete guild.bank.items[itemId];
      logBank(guild, { kind: 'withdraw-item', by: actorName || memberOf(guild, actorId)?.name || '?', itemId, amount: qty });
      persist();
      return { ok: true, guild, itemId, quantity: qty };
    },

    // --- Buffs --------------------------------------------------------------

    /**
     * Buys `buffDef` for the guild out of bank gold.
     *
     * Re-buying a buff that is already running EXTENDS it rather than
     * stacking a second copy — stacking would let one rich guild sit on
     * +300% XP, and "the timer went up" is what a player expects when they
     * pay for something they already have.
     */
    purchaseBuff(guildId, actorId, buffDef, actorName) {
      const guild = byId(guildId);
      if (!guild) return { ok: false, error: 'That guild no longer exists.' };
      if (!hasPermission(guild, actorId, 'buyBuffs')) return { ok: false, error: 'Your rank cannot buy guild buffs.' };
      if (!buffDef) return { ok: false, error: 'No such guild buff.' };
      sweepBuffs(guild);
      if (guild.bank.gold < buffDef.costGold) return { ok: false, error: 'The guild bank cannot afford that.' };

      guild.bank.gold -= buffDef.costGold;
      const now = Date.now();
      const ms = Math.round(buffDef.durationMinutes * 60_000);
      const existing = guild.activeBuffs.find((b) => b.buffId === buffDef.id);
      if (existing) {
        existing.expiresAt += ms;
        existing.effects = buffDef.effects; // re-read from the catalog, so an edited buff takes effect on re-purchase
        existing.name = buffDef.name;
        existing.iconUrl = buffDef.iconUrl;
      } else {
        guild.activeBuffs.push({
          buffId: buffDef.id,
          name: buffDef.name,
          iconUrl: buffDef.iconUrl,
          effects: buffDef.effects,
          startedAt: now,
          expiresAt: now + ms,
          purchasedBy: actorName || memberOf(guild, actorId)?.name || '?',
        });
      }
      logBank(guild, { kind: 'buff', by: actorName || memberOf(guild, actorId)?.name || '?', amount: buffDef.costGold, buffName: buffDef.name });
      persist();
      return { ok: true, guild };
    },

    /** Live multipliers for whoever's account this is — 1 across the board for guests and the guildless. */
    multipliersFor(accountId, now = Date.now()) {
      return guildBuffMultipliers(byAccount(accountId), now);
    },

    persist,
  };
}
