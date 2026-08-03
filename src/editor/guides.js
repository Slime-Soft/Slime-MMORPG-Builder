// src/editor/guides.js
// Wires up the World Editor's "?" help panel: a small library of author-
// written guides (title + category + rich-text body) stored server-side at
// guides/guides.json (see src/sim/guides.js). Self-contained, same plain-DOM
// style as modal.js — no dependency on the rest of main.js.
//
// Three panes share #guides-main: the empty-state hint, a read-only article
// view (what clicking a guide in the sidebar shows), and the edit form. A
// guide is never dropped straight into edit mode from a sidebar click —
// only the view pane's "Edit" button gets you there — so a stray click
// doesn't put a saved article into an editable state by surprise.

export function initGuides() {
  const helpBtn = document.getElementById('guides-help-btn');
  const modal = document.getElementById('guides-modal');
  const closeBtn = document.getElementById('guides-modal-close');
  const addPostBtn = document.getElementById('guides-add-post-btn');
  const sidebar = document.getElementById('guides-sidebar');
  const emptyState = document.getElementById('guides-empty-state');

  const viewPane = document.getElementById('guides-view');
  const viewCategory = document.getElementById('guide-view-category');
  const viewTitle = document.getElementById('guide-view-title');
  const viewBody = document.getElementById('guide-view-body');
  const viewEditBtn = document.getElementById('guide-view-edit-btn');
  const viewDeleteBtn = document.getElementById('guide-view-delete-btn');

  const editor = document.getElementById('guides-editor');
  const titleInput = document.getElementById('guide-title-input');
  const categoryInput = document.getElementById('guide-category-input');
  const categoryDatalist = document.getElementById('guide-category-datalist');
  const toolbar = document.getElementById('guide-toolbar');
  const bodyEl = document.getElementById('guide-body');
  const colorInput = document.getElementById('guide-color-input');
  const imageBtn = document.getElementById('guide-insert-image-btn');
  const imageFile = document.getElementById('guide-image-file');
  const saveBtn = document.getElementById('guide-save-btn');
  const cancelBtn = document.getElementById('guide-cancel-btn');
  const deleteBtn = document.getElementById('guide-delete-btn');

  let guides = [];
  let currentId = null; // guide being viewed/edited; null when editing a new, unsaved post

  function open() {
    modal.style.display = 'flex';
    refresh();
  }
  function close() {
    modal.style.display = 'none';
  }
  helpBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  async function refresh() {
    try {
      const res = await fetch('/api/guides');
      guides = await res.json();
    } catch {
      guides = [];
    }
    updateCategoryDatalist();
    if (currentId && guides.some((g) => g.id === currentId)) {
      showView(currentId);
    } else {
      showEmpty();
    }
  }

  function updateCategoryDatalist() {
    categoryDatalist.innerHTML = [...new Set(guides.map((g) => g.category))]
      .map((c) => `<option value="${escapeAttr(c)}"></option>`).join('');
  }

  function renderSidebar() {
    sidebar.innerHTML = '';
    if (!guides.length) {
      sidebar.innerHTML = '<p class="hint">No guides yet. Click "+ Add Post" to write the first one.</p>';
      return;
    }
    const byCategory = new Map();
    for (const g of guides) {
      if (!byCategory.has(g.category)) byCategory.set(g.category, []);
      byCategory.get(g.category).push(g);
    }
    for (const [category, list] of byCategory) {
      const h = document.createElement('h4');
      h.textContent = category;
      sidebar.appendChild(h);
      for (const g of list) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'guide-list-item' + (g.id === currentId ? ' active' : '');
        item.textContent = g.title;
        item.addEventListener('click', () => showView(g.id));
        sidebar.appendChild(item);
      }
    }
  }

  function setPane(pane) {
    emptyState.style.display = pane === 'empty' ? '' : 'none';
    viewPane.style.display = pane === 'view' ? 'flex' : 'none';
    editor.style.display = pane === 'edit' ? 'flex' : 'none';
  }

  function showEmpty() {
    currentId = null;
    setPane('empty');
    renderSidebar();
  }

  function showView(id) {
    const g = guides.find((x) => x.id === id);
    if (!g) return showEmpty();
    currentId = id;
    viewCategory.textContent = g.category;
    viewTitle.textContent = g.title;
    viewBody.innerHTML = g.content || '';
    setPane('view');
    renderSidebar();
  }

  function startEdit(id) {
    const g = id ? guides.find((x) => x.id === id) : null;
    titleInput.value = g ? g.title : '';
    categoryInput.value = g ? g.category : '';
    bodyEl.innerHTML = g ? (g.content || '') : '';
    deleteBtn.style.display = g ? '' : 'none';
    setPane('edit');
    titleInput.focus();
  }

  addPostBtn.addEventListener('click', () => startEdit(null));
  viewEditBtn.addEventListener('click', () => startEdit(currentId));
  cancelBtn.addEventListener('click', () => {
    if (currentId) showView(currentId);
    else showEmpty();
  });

  toolbar.querySelectorAll('button[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      bodyEl.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
    });
  });

  // Clicking the native color swatch moves focus to it, which collapses
  // whatever text selection was highlighted in guide-body — so the selection
  // has to be saved before that happens and restored right before applying
  // the color, or foreColor silently does nothing (or colors the wrong spot).
  let savedRange = null;
  function saveSelection() {
    const sel = window.getSelection();
    if (sel.rangeCount && bodyEl.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  }
  bodyEl.addEventListener('mouseup', saveSelection);
  bodyEl.addEventListener('keyup', saveSelection);
  colorInput.addEventListener('mousedown', saveSelection);
  colorInput.addEventListener('input', () => {
    bodyEl.focus();
    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
    document.execCommand('foreColor', false, colorInput.value);
  });

  imageBtn.addEventListener('click', () => imageFile.click());
  imageFile.addEventListener('change', async () => {
    const file = imageFile.files[0];
    imageFile.value = '';
    if (!file) return;
    const form = new FormData();
    form.append('image', file);
    try {
      const res = await fetch('/api/guides/image', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      bodyEl.focus();
      document.execCommand('insertImage', false, data.url);
    } catch (err) {
      alert(`Image upload failed: ${err.message}`);
    }
  });

  async function save() {
    const title = titleInput.value.trim();
    const category = categoryInput.value.trim();
    if (!title) return alert('Give the guide a title.');
    if (!category) return alert('Give the guide a category.');
    const now = Date.now();
    let next;
    let savedId;
    if (currentId) {
      savedId = currentId;
      next = guides.map((g) => g.id === currentId
        ? { ...g, title, category, content: bodyEl.innerHTML, updatedAt: now }
        : g);
    } else {
      savedId = `guide-${now}-${Math.floor(Math.random() * 1e9)}`;
      next = [...guides, { id: savedId, title, category, content: bodyEl.innerHTML, createdAt: now, updatedAt: now }];
    }
    try {
      const res = await fetch('/api/guides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      guides = next;
      updateCategoryDatalist();
      showView(savedId);
    } catch (err) {
      alert(`Failed to save guide: ${err.message}`);
    }
  }
  saveBtn.addEventListener('click', save);

  async function remove() {
    if (!currentId) return;
    if (!confirm('Delete this guide?')) return;
    try {
      const res = await fetch(`/api/guides/${encodeURIComponent(currentId)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      guides = data.guides;
      updateCategoryDatalist();
      showEmpty();
    } catch (err) {
      alert(`Failed to delete guide: ${err.message}`);
    }
  }
  deleteBtn.addEventListener('click', remove);
  viewDeleteBtn.addEventListener('click', remove);
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
