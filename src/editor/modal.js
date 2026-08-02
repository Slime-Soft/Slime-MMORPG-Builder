// src/editor/modal.js
// Minimal reusable tabbed modal — the first of its kind in this codebase
// (every other World Editor surface is an inline sidebar mode-panel, never
// a closable overlay dialog). Vanilla JS, matching the rest of the editor's
// plain-DOM style: getElementById, manual innerHTML, addEventListener, no
// framework. Not a component system — just wiring for a modal whose HTML
// skeleton already exists in the page (see the #monster-builder-modal
// markup in public/editor.html).

/**
 * @param {string} rootId id of the modal's outer overlay div
 * @param {{id: string, label: string}[]} tabs top-level tabs, each needs a
 *   sibling `[data-tab="id"]` button and a `#${rootId}-tab-${id}` panel
 * @returns {{ open(): void, close(): void, isOpen(): boolean, showTab(id: string): void, onOpen(fn: Function): void, onClose(fn: Function): void }}
 */
export function createTabbedModal(rootId, tabs) {
  const root = document.getElementById(rootId);
  const tabButtons = root.querySelectorAll('[data-tab]');
  const openCallbacks = [];
  const closeCallbacks = [];
  let open = false;

  function showTab(id) {
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
    for (const tab of tabs) {
      const panel = document.getElementById(`${rootId}-tab-${tab.id}`);
      if (panel) panel.style.display = tab.id === id ? 'block' : 'none';
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // Clicking the dark backdrop (not the dialog itself) closes the modal,
  // same convention as most overlay dialogs elsewhere on the web.
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  function openModal() {
    open = true;
    root.style.display = 'flex';
    showTab(tabs[0].id);
    openCallbacks.forEach((fn) => fn());
  }

  function close() {
    open = false;
    root.style.display = 'none';
    closeCallbacks.forEach((fn) => fn());
  }

  return {
    open: openModal,
    close,
    isOpen: () => open,
    showTab,
    onOpen: (fn) => openCallbacks.push(fn),
    onClose: (fn) => closeCallbacks.push(fn),
  };
}

/** Same shape as createTabbedModal but for a nested sub-tab strip (Model Editor's Slots/Settings). */
export function createSubTabs(containerSelector, subtabs) {
  const container = document.querySelector(containerSelector);
  const buttons = container.querySelectorAll('[data-subtab]');
  function show(id) {
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.subtab === id));
    for (const st of subtabs) {
      const panel = document.getElementById(st.panelId);
      if (panel) panel.style.display = st.id === id ? 'block' : 'none';
    }
  }
  buttons.forEach((btn) => btn.addEventListener('click', () => show(btn.dataset.subtab)));
  return { show };
}
