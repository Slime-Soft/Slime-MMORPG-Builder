// src/guild-buff-builder/main.js
// The Guild Buff Builder (public/guild-buffs.html).
//
// Authors the catalog of buffs a guild can buy with bank gold: what it boosts,
// by how much, for how long, at what price, and which icon it wears. Same
// whole-catalog GET/POST contract as the Skill and Recipe builders — the list
// is edited locally and saved in one shot, and the server re-validates every
// row (src/sim/guilds.js's parseGuildBuffs) before writing anything.
import { GUILD_BUFF_EFFECT_TYPES, emptyGuildBuff } from '../sim/guilds.js';

const listEl = document.getElementById('buff-list');
const editorEl = document.getElementById('editor');
const statusEl = document.getElementById('status');

/** @type {Array<object>} the working catalog — not written back to the server until "Save catalog". */
let buffs = [];
let selectedId = null;

function status(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = isError ? 'err' : '';
}

const selected = () => buffs.find((b) => b.id === selectedId) || null;

/** A url-safe id derived from the name, uniquified against the catalog — ids are what a guild's activeBuffs reference, so they have to be stable and unique. */
function freshId(base) {
  const root = String(base || 'buff').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'buff';
  let id = root;
  let n = 2;
  while (buffs.some((b) => b.id === id)) id = `${root}-${n++}`;
  return id;
}

function effectSummary(buff) {
  return (buff.effects || [])
    .map((e) => `${e.percent > 0 ? '+' : ''}${e.percent}% ${GUILD_BUFF_EFFECT_TYPES[e.type]?.label || e.type}`)
    .join(' / ');
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderList() {
  listEl.innerHTML = buffs.length
    ? buffs.map((b) => `
      <div class="entry${b.id === selectedId ? ' active' : ''}" data-id="${esc(b.id)}">
        ${b.iconUrl ? `<img src="${esc(b.iconUrl)}" alt="" />` : '<div class="ph">&#10022;</div>'}
        <div class="meta">
          <div class="n">${esc(b.name)}</div>
          <div class="s">${b.costGold.toLocaleString()}g &middot; ${b.durationMinutes}m</div>
        </div>
      </div>`).join('')
    : '<div style="padding:10px;color:rgba(232,217,181,0.55)">No guild buffs yet. Hit New.</div>';
}

function renderEditor() {
  const buff = selected();
  if (!buff) {
    editorEl.innerHTML = '<p class="lede">Pick a buff on the left, or make a new one.</p>';
    return;
  }
  editorEl.innerHTML = `
    <h1>${esc(buff.name)}</h1>
    <p class="lede">id: <code>${esc(buff.id)}</code></p>

    <div class="preview">
      ${buff.iconUrl ? `<img src="${esc(buff.iconUrl)}" alt="" />` : '<div class="ph">&#10022;</div>'}
      <div>
        <div class="p-name">${esc(buff.name)}</div>
        <div class="p-eff">${esc(effectSummary(buff)) || 'No effects yet'}</div>
        <div class="p-line">${buff.costGold.toLocaleString()}g for ${buff.durationMinutes} minutes</div>
      </div>
    </div>
    <p class="hint">This is exactly how the card reads in the game's Guild &rarr; Buffs tab.</p>

    <h2>Identity</h2>
    <label>Name<input type="text" id="f-name" value="${esc(buff.name)}" maxlength="48" /></label>
    <label>Description<textarea id="f-desc">${esc(buff.description)}</textarea></label>
    <label>Icon</label>
    <div class="row">
      <input type="text" id="f-icon" value="${esc(buff.iconUrl)}" placeholder="/assets/icons/…" />
      <input type="file" id="f-icon-file" accept="image/*" />
    </div>
    <p class="hint">Upload an image or paste a path. Blank falls back to a generic sparkle.</p>

    <h2>Price &amp; duration</h2>
    <div class="field2">
      <label>Cost in guild bank gold<input type="number" id="f-cost" min="0" step="10" value="${buff.costGold}" /></label>
      <label>Duration (minutes)<input type="number" id="f-duration" min="1" step="5" value="${buff.durationMinutes}" /></label>
    </div>
    <p class="hint">Buying a buff that is already running extends its timer rather than stacking a second copy.</p>

    <h2>Effects</h2>
    <p class="hint">Percentages from every ACTIVE guild buff add together, so two +10% XP buffs are +20%, not +21%.</p>
    <div id="effects">
      ${(buff.effects || []).map((e, i) => `
        <div class="effect-row">
          <label>Boosts
            <select data-eff-type="${i}">
              ${Object.entries(GUILD_BUFF_EFFECT_TYPES).map(([id, def]) =>
                `<option value="${id}"${e.type === id ? ' selected' : ''}>${esc(def.label)}</option>`).join('')}
            </select>
          </label>
          <label>Percent<input type="number" data-eff-percent="${i}" value="${e.percent}" step="1" /></label>
          <button class="danger" data-eff-remove="${i}">Remove</button>
          <p class="hint" style="grid-column:1/-1;margin:0">${esc(GUILD_BUFF_EFFECT_TYPES[e.type]?.hint || '')}</p>
        </div>`).join('')}
    </div>
    <div class="row" style="max-width:200px"><button id="add-effect">Add effect</button></div>`;
}

function render() {
  renderList();
  renderEditor();
}

listEl.addEventListener('click', (e) => {
  const id = e.target.closest('.entry')?.dataset.id;
  if (!id) return;
  selectedId = id;
  render();
});

editorEl.addEventListener('input', (e) => {
  const buff = selected();
  if (!buff) return;
  const el = e.target;
  if (el.id === 'f-name') buff.name = el.value;
  else if (el.id === 'f-desc') buff.description = el.value;
  else if (el.id === 'f-icon') buff.iconUrl = el.value;
  else if (el.id === 'f-cost') buff.costGold = Math.max(0, Math.round(Number(el.value) || 0));
  else if (el.id === 'f-duration') buff.durationMinutes = Math.max(1, Number(el.value) || 1);
  else if (el.dataset.effPercent !== undefined) buff.effects[Number(el.dataset.effPercent)].percent = Number(el.value) || 0;
  else return;
  // The list row and the card preview both mirror these fields, so they are
  // repainted — but NOT the editor itself, which would blow away the caret
  // mid-word on every keystroke.
  renderList();
  refreshPreview(buff);
});

/** Repaints just the card preview + heading, the two things that echo the fields being typed into. */
function refreshPreview(buff) {
  const preview = editorEl.querySelector('.preview');
  if (!preview) return;
  preview.innerHTML = `
    ${buff.iconUrl ? `<img src="${esc(buff.iconUrl)}" alt="" />` : '<div class="ph">&#10022;</div>'}
    <div>
      <div class="p-name">${esc(buff.name)}</div>
      <div class="p-eff">${esc(effectSummary(buff)) || 'No effects yet'}</div>
      <div class="p-line">${buff.costGold.toLocaleString()}g for ${buff.durationMinutes} minutes</div>
    </div>`;
}

editorEl.addEventListener('change', async (e) => {
  const buff = selected();
  if (!buff) return;
  if (e.target.dataset.effType !== undefined) {
    buff.effects[Number(e.target.dataset.effType)].type = e.target.value;
    render();
    return;
  }
  if (e.target.id === 'f-icon-file') {
    const file = e.target.files?.[0];
    if (!file) return;
    status('Uploading icon…');
    try {
      const body = new FormData();
      body.append('icon', file);
      const res = await fetch('/api/guild-buffs/icon', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      buff.iconUrl = data.url;
      status('Icon uploaded. Remember to save the catalog.');
      render();
    } catch (err) {
      status(err.message, true);
    }
  }
});

editorEl.addEventListener('click', (e) => {
  const buff = selected();
  if (!buff) return;
  if (e.target.id === 'add-effect') {
    buff.effects.push({ type: 'xp', percent: 10 });
    render();
    return;
  }
  const removeIdx = e.target.dataset.effRemove;
  if (removeIdx !== undefined) {
    buff.effects.splice(Number(removeIdx), 1);
    render();
  }
});

document.getElementById('new-btn').addEventListener('click', () => {
  const buff = emptyGuildBuff(freshId('new-buff'));
  buffs.push(buff);
  selectedId = buff.id;
  render();
  status('New buff created — save the catalog when you are happy with it.');
});

document.getElementById('dup-btn').addEventListener('click', () => {
  const source = selected();
  if (!source) return;
  const copy = JSON.parse(JSON.stringify(source));
  copy.name = `${source.name} copy`;
  copy.id = freshId(copy.name);
  buffs.push(copy);
  selectedId = copy.id;
  render();
});

document.getElementById('del-btn').addEventListener('click', () => {
  const buff = selected();
  if (!buff) return;
  // A guild that already bought this keeps its running copy (activeBuffs
  // stores its own snapshot of the effects) — deleting only takes it off the
  // shelf, so no live buff is yanked out from under anyone.
  if (!confirm(`Delete "${buff.name}"? Guilds already running it keep it until it expires.`)) return;
  buffs = buffs.filter((b) => b.id !== buff.id);
  selectedId = buffs[0]?.id || null;
  render();
});

document.getElementById('save-btn').addEventListener('click', async () => {
  status('Saving…');
  try {
    const res = await fetch('/api/guild-buffs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buffs),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    status(`Saved ${buffs.length} guild buff(s).`);
  } catch (err) {
    status(err.message, true);
  }
});

fetch('/api/guild-buffs')
  .then((r) => r.json())
  .then((list) => {
    buffs = Array.isArray(list) ? list : [];
    selectedId = buffs[0]?.id || null;
    render();
  })
  .catch(() => {
    status('Could not load the guild buff catalog.', true);
    render();
  });
