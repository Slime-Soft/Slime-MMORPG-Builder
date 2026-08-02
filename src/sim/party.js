// src/sim/party.js
// Pure party-membership helpers. A Party is plain data:
//   { id, leaderId, memberIds: [playerId, ...] }
// The server owns the live parties Map and the socket glue; this module is
// just the fiddly membership rules (cap enforcement, leader promotion on
// leave, disband when too few remain) split out so they're unit-testable
// and reusable by both real players and future simulated "bot" players.

export const MAX_PARTY_SIZE = 4;

/** A brand-new party of one — the leader. */
export function createParty(id, leaderId) {
  return { id, leaderId, memberIds: [leaderId] };
}

export function isInParty(party, playerId) {
  return party.memberIds.includes(playerId);
}

export function canAddMember(party) {
  return party.memberIds.length < MAX_PARTY_SIZE;
}

/** Add a member if there's room and they're not already in. Returns true if added. */
export function addMember(party, playerId) {
  if (!canAddMember(party) || isInParty(party, playerId)) return false;
  party.memberIds.push(playerId);
  return true;
}

/**
 * Remove a member. If the leader leaves and others remain, the first
 * remaining member is promoted. A party that drops below 2 members is
 * considered disbanded (a party of one is just a solo player).
 * @returns {{ removed: boolean, disbanded: boolean, promotedLeaderId: string|null }}
 */
export function removeMember(party, playerId) {
  const idx = party.memberIds.indexOf(playerId);
  if (idx === -1) return { removed: false, disbanded: false, promotedLeaderId: null };

  party.memberIds.splice(idx, 1);

  if (party.memberIds.length < 2) {
    return { removed: true, disbanded: true, promotedLeaderId: null };
  }

  let promotedLeaderId = null;
  if (party.leaderId === playerId) {
    party.leaderId = party.memberIds[0];
    promotedLeaderId = party.leaderId;
  }
  return { removed: true, disbanded: false, promotedLeaderId };
}
