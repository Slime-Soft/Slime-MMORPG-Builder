// src/render/zoneAudio.js
// Per-zone music/ambient-sound playback with a crossfade on zone change.
// Two independent Web Audio channels (music, ambient) since a zone can set
// one without the other. Live-game only — the World Editor stays a static
// blockout view, same reasoning it already applies to ambient particles
// (see ambientParticles.js's identical comment).
import { isPointInZone } from '../sim/zones.js';

const CROSSFADE_SECONDS = 1.5;

function createChannel() {
  return { trackId: null, source: null, gain: null };
}

/** Cached per-URL decode — repeated zone visits (walking back and forth across a boundary) shouldn't re-fetch/re-decode the same file. */
function loadBuffer(ctx, url, cache) {
  if (cache.has(url)) return cache.get(url);
  const promise = fetch(url)
    .then((r) => r.arrayBuffer())
    .then((buf) => ctx.decodeAudioData(buf));
  cache.set(url, promise);
  return promise;
}

/**
 * @param {Record<string, {url:string}>} audioCatalogById rows from /api/audio, keyed by id
 */
export function createZoneAudioController(audioCatalogById) {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const bufferCache = new Map(); // url -> Promise<AudioBuffer>
  const channels = { music: createChannel(), ambient: createChannel() };
  let currentKey = null;

  /** Browsers block audio until a real user gesture — call this from the same click that already gates entering the game. */
  function resume() {
    if (ctx.state === 'suspended') ctx.resume();
  }

  async function crossfadeChannel(channel, ref) {
    const targetTrackId = ref?.musicId ?? ref?.soundId ?? null;
    // Also true for a non-looping track that already finished playing on its
    // own — "loop: false" means "once per zone entry", not "once ever", so
    // it only plays again once you leave the zone and re-enter (which resets
    // channel.trackId to null on the way out).
    if (targetTrackId === channel.trackId) return; // already playing this (or already silent)
    const now = ctx.currentTime;

    if (channel.gain) {
      channel.gain.gain.cancelScheduledValues(now);
      channel.gain.gain.setValueAtTime(channel.gain.gain.value, now);
      channel.gain.gain.linearRampToValueAtTime(0, now + CROSSFADE_SECONDS);
      channel.source.stop(now + CROSSFADE_SECONDS);
    }
    channel.trackId = targetTrackId;
    channel.source = null;
    channel.gain = null;
    if (!targetTrackId) return; // fading to silence — nothing new to start

    const catalogEntry = audioCatalogById[targetTrackId];
    if (!catalogEntry) {
      console.warn(`Zone audio: unknown track id "${targetTrackId}"`);
      return;
    }
    let buffer;
    try {
      buffer = await loadBuffer(ctx, catalogEntry.url, bufferCache);
    } catch (err) {
      console.error(`Zone audio: failed to load "${catalogEntry.url}"`, err);
      return;
    }
    // The active zone could have changed again while this decode was in
    // flight — don't start a track nobody wants anymore.
    if (channel.trackId !== targetTrackId) return;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0;
    gainNode.connect(ctx.destination);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = ref?.loop ?? true;
    source.connect(gainNode);
    source.start();
    gainNode.gain.linearRampToValueAtTime(ref?.volume ?? 1, ctx.currentTime + CROSSFADE_SECONDS);
    channel.source = source;
    channel.gain = gainNode;
  }

  /**
   * Call every frame (or on movement) with the id of the zone the player is
   * currently in for audio purposes (see findActiveAudioZone), or null, plus
   * the current map's graphicsSettings.sound (its map-wide default, played
   * whenever the player isn't inside any music/ambient zone). No-ops unless
   * the effective track actually changed — which includes a map switch while
   * outside every zone (the default itself changed even though zoneId is
   * null both before and after), so the dedup key folds in the default's own
   * ids rather than just zoneId.
   */
  function update(zoneId, zonesById, defaultSound = null) {
    const key = zoneId ?? `__default:${defaultSound?.defaultMusicId || ''}:${defaultSound?.defaultAmbientSoundId || ''}`;
    if (key === currentKey) return;
    currentKey = key;
    const zone = zoneId ? zonesById[zoneId] : null;
    const musicRef = zone?.music ?? (defaultSound?.defaultMusicId ? { musicId: defaultSound.defaultMusicId, loop: true, volume: defaultSound.defaultMusicVolume ?? 1 } : null);
    const ambientRef = zone?.ambientSound ?? (defaultSound?.defaultAmbientSoundId ? { soundId: defaultSound.defaultAmbientSoundId, volume: defaultSound.defaultAmbientVolume ?? 1 } : null);
    crossfadeChannel(channels.music, musicRef);
    crossfadeChannel(channels.ambient, ambientRef);
  }

  return { update, resume };
}

/**
 * First zone (in world.zones array order) that both contains (x, z) and has
 * music or ambientSound set, or null. Array order is the author-controlled
 * priority for overlapping zones — deliberately simple, no nesting/z-order
 * logic; reorder zones in the editor's list to change which wins.
 */
export function findActiveAudioZone(zones, x, z) {
  for (const zone of zones) {
    if (!zone.music && !zone.ambientSound) continue;
    if (isPointInZone(zone, x, z)) return zone.id;
  }
  return null;
}
