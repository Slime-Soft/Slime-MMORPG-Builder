// src/render/minimap.js
// Abstract top-down dot-map: an always-visible corner minimap (player-
// centered, fixed-north) plus a full-screen toggleable map (world-fixed).
// Plain HTML5 Canvas 2D, not a second Three.js render pass — the live game
// only needs positions/directions, not actually-rendered terrain. Live game
// only, same reasoning every other atmosphere/effects system in this
// codebase already applies to skip the World Editor's static blockout view.
import { isPointInZone } from '../sim/zones.js';

const MINIMAP_WORLD_RADIUS = 90; // world units visible from center to the minimap's edge
const BG_COLOR = 'rgba(10, 16, 26, 0.82)';
const BORDER_COLOR = '#d9a441'; // matches the wood/gold HUD theme (theme.css's --rb-gold) — was a leftover blue from before the reskin
const PLAYER_COLOR = '#ffffff';
const PARTY_COLOR = '#6ad0ff';
const NPC_COLOR = '#9aa0a8';
const NPC_QUEST_COLORS = { available: '#ffd23f', active: '#9aa0a8', ready: '#ffd23f' };
const ARROW_COLOR = '#ffd23f';

/**
 * Resolves an active quest's objective to a world-space {x,z} target, or
 * null if there's nothing to point at right now (e.g. a kill objective
 * whose group has no live spawns AND no known static spawn point either).
 * `data` bundles the lookups the caller already has: overworldMonsterMeshes
 * (live positions), monsterGroupById (built once from world.monsters),
 * staticMonsterPosByGroup (fallback spawn points, also from world.monsters),
 * npcDefs, and gatheringNodesByGroup (built once from world.gatheringNodes).
 */
export function questObjectiveTarget(quest, data) {
  const o = quest.objective;
  if (o.type === 'talk') {
    const npc = data.npcDefs.get(o.target);
    return npc ? { x: npc.position.x, z: npc.position.z } : null;
  }
  if (o.type === 'kill') {
    const live = [];
    for (const [id, mesh] of data.overworldMonsterMeshes) {
      if (data.monsterGroupById.get(id) === o.target) live.push(mesh.position);
    }
    const points = live.length ? live : (data.staticMonsterPosByGroup.get(o.target) || []);
    return averagePoint(points);
  }
  if (o.type === 'gather') {
    const points = data.gatheringNodesByGroup.get(o.target) || [];
    return averagePoint(points);
  }
  return null;
}

function averagePoint(points) {
  if (!points.length) return null;
  let sx = 0, sz = 0;
  for (const p of points) { sx += p.x; sz += p.z; }
  return { x: sx / points.length, z: sz / points.length };
}

/** Builds the two lookup Maps questObjectiveTarget needs from static world data — call once per world load, not per frame. */
export function buildQuestTargetLookups(world) {
  const monsterGroupById = new Map();
  const staticMonsterPosByGroup = new Map();
  for (const m of world.monsters || []) {
    if (!m.group) continue;
    monsterGroupById.set(m.id, m.group);
    if (!staticMonsterPosByGroup.has(m.group)) staticMonsterPosByGroup.set(m.group, []);
    staticMonsterPosByGroup.get(m.group).push(m.position);
  }
  const gatheringNodesByGroup = new Map();
  for (const n of world.gatheringNodes || []) {
    if (!n.group) continue;
    if (!gatheringNodesByGroup.has(n.group)) gatheringNodesByGroup.set(n.group, []);
    gatheringNodesByGroup.get(n.group).push(n.position);
  }
  return { monsterGroupById, staticMonsterPosByGroup, gatheringNodesByGroup };
}

function drawDot(ctx, x, y, radius, color) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * One draw call for either the minimap or the full map — the only
 * difference is `worldRadius` (how many world units fit edge-to-edge) and
 * whether the view follows the player or stays fixed on `world.bounds`.
 */
function drawMap(canvas, { world, playerPos, playerFacing, worldRadius, centerOnPlayer, partyDots, npcDots, questArrow }) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h / 2;
  const scale = (Math.min(w, h) / 2) / worldRadius;
  const originX = centerOnPlayer ? playerPos.x : (world.bounds.minX + world.bounds.maxX) / 2;
  const originZ = centerOnPlayer ? playerPos.z : (world.bounds.minZ + world.bounds.maxZ) / 2;
  // World Z increases "south" in this project's convention (matches every
  // other top-down mapping already in the codebase, e.g. buildZoneMarker's
  // rotation.x = -PI/2 planes) — screen Y also increases downward, so X/Z
  // map to screen X/Y directly with no sign flip needed here.
  const toScreen = (x, z) => ({ x: cx + (x - originX) * scale, y: cy + (z - originZ) * scale });

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  if (centerOnPlayer) ctx.arc(cx, cy, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
  else ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, w, h);

  for (const npc of npcDots) {
    const p = toScreen(npc.x, npc.z);
    drawDot(ctx, p.x, p.y, 3.5, npc.questState ? NPC_QUEST_COLORS[npc.questState] : NPC_COLOR);
  }
  for (const party of partyDots) {
    const p = toScreen(party.x, party.z);
    drawDot(ctx, p.x, p.y, 4, PARTY_COLOR);
  }

  const pp = toScreen(playerPos.x, playerPos.z);
  // Forward direction in screen space: matches toScreen's direct (unrotated)
  // x/z mapping, so a triangle built from this vector points the same way
  // the player actually moves rather than via ctx.rotate (which rotates
  // clockwise in canvas's y-down space — the opposite handedness from this
  // project's atan2(dx, dz) angle convention, and was drawing the arrow
  // exactly backwards).
  const fx = Math.sin(playerFacing), fz = Math.cos(playerFacing);
  const px = fz, pz = -fx; // perpendicular, for the base corners
  ctx.beginPath();
  ctx.moveTo(pp.x + fx * 7, pp.y + fz * 7);
  ctx.lineTo(pp.x - fx * 6 + px * 5, pp.y - fz * 6 + pz * 5);
  ctx.lineTo(pp.x - fx * 6 - px * 5, pp.y - fz * 6 - pz * 5);
  ctx.closePath();
  ctx.fillStyle = PLAYER_COLOR;
  ctx.fill();
  ctx.restore(); // end clip

  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth = 2;
  if (centerOnPlayer) { ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) / 2 - 2, 0, Math.PI * 2); ctx.stroke(); }
  else ctx.strokeRect(1, 1, w - 2, h - 2);

  // Directional quest arrow at the view's edge, pointing toward a target
  // that's off-screen (or anywhere, for the minimap, since it's always
  // "off-screen" relative to its small radius unless very close).
  if (questArrow) {
    const dx = questArrow.x - playerPos.x;
    const dz = questArrow.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 1) {
      const angle = Math.atan2(dx, dz); // fixed-north: 0 = +Z, matches toScreen's un-rotated mapping
      const dirX = Math.sin(angle), dirZ = Math.cos(angle);
      const perpX = dirZ, perpZ = -dirX;
      const edgeR = Math.min(w, h) / 2 - 12;
      const ax = cx + dirX * edgeR;
      const ay = cy + dirZ * edgeR;
      ctx.beginPath();
      ctx.moveTo(ax + dirX * 8, ay + dirZ * 8);
      ctx.lineTo(ax - dirX * 5 + perpX * 5, ay - dirZ * 5 + perpZ * 5);
      ctx.lineTo(ax - dirX * 5 - perpX * 5, ay - dirZ * 5 - perpZ * 5);
      ctx.closePath();
      ctx.fillStyle = ARROW_COLOR;
      ctx.fill();
    }
  }
}

/**
 * Creates the minimap + full-map controller. `canvases` = { minimap,
 * fullMap } DOM canvas elements. Returns { update(frameData), toggleFullMap() }.
 * `frameData` shape: { world, playerPos, playerFacing, partyDots, npcDots,
 * questArrow } — same object works for both draws, only the view
 * radius/centering differs.
 */
export function createMinimapController(canvases) {
  let fullMapOpen = false;

  function toggleFullMap() {
    fullMapOpen = !fullMapOpen;
    canvases.fullMap.parentElement.style.display = fullMapOpen ? 'flex' : 'none';
    return fullMapOpen;
  }

  function update(frameData) {
    if (!frameData.world.bounds) return;
    drawMap(canvases.minimap, { ...frameData, worldRadius: MINIMAP_WORLD_RADIUS, centerOnPlayer: true });
    if (fullMapOpen) {
      const b = frameData.world.bounds;
      const worldRadius = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2;
      drawMap(canvases.fullMap, { ...frameData, worldRadius, centerOnPlayer: false });
    }
  }

  return { update, toggleFullMap, get isFullMapOpen() { return fullMapOpen; } };
}
