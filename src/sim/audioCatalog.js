// src/sim/audioCatalog.js
// Catalog of user-uploaded audio files — id, display name, kind
// ('music'|'ambient'), and the URL the file was saved under
// (public/assets/audio/, served statically). Same catalog-metadata role
// src/sim/customGroundTextures.js plays for uploaded textures; zones
// reference these ids via ZoneDef.music.musicId / ZoneDef.ambientSound.soundId
// (see src/sim/zones.js) rather than embedding the audio itself.
export const AUDIO_KINDS = ['music', 'ambient'];

/** @param {any} data @returns {any} throws on malformed data. */
export function parseAudioCatalog(data) {
  if (!Array.isArray(data)) {
    throw new Error('Audio catalog must be an array');
  }
  const ids = new Set();
  for (const entry of data) {
    for (const key of ['id', 'name', 'kind', 'url']) {
      if (!(key in entry)) {
        throw new Error(`Audio catalog entry missing required field: "${key}"`);
      }
    }
    if (ids.has(entry.id)) {
      throw new Error(`Duplicate audio catalog id: "${entry.id}"`);
    }
    ids.add(entry.id);
    if (!AUDIO_KINDS.includes(entry.kind)) {
      throw new Error(`Audio catalog entry "${entry.id}" has unknown kind "${entry.kind}"`);
    }
  }
  return data;
}
