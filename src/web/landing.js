// src/web/landing.js
// Page controller for public/home.html. Owns the DOM; the layered WebGL
// backdrop lives in ./landing-scene.js and the account calls in ./auth.js, so
// this file is only ever wiring — nothing here knows how a shader or a
// password hash works.
import { startLandingScene } from './landing-scene.js';
import { register, login, logout, currentUser } from './auth.js';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds an <svg><use href="#id"/></svg> pointing at the sprite in home.html. Icons are markup, not text, so they can't be built with textContent. */
function icon(id, className, { filled = false } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', filled ? 'currentColor' : 'none');
  if (!filled) {
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.75');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.appendChild(use);
  return svg;
}

// --- the layered backdrop -----------------------------------------------------

(async () => {
  const canvas = document.getElementById('scene-canvas');
  const fallback = document.getElementById('scene-fallback');
  const heroCard = document.getElementById('hero-card');

  const scene = await startLandingScene(canvas, {
    reducedMotion: prefersReducedMotion,
    // The party stands at the top of the cliff cut-out, so a taller cliff
    // pushes them further up the screen — straight back under this panel.
    // Handing the scene the panel's real bottom edge lets it size the cliff as
    // large as will actually fit, instead of guessing a fraction that only
    // happens to work at one window height.
    clearanceBelow: () => (heroCard ? heroCard.getBoundingClientRect().bottom + 20 : 0),
  });
  if (!scene) {
    // No WebGL, or the art failed to load. Show the same two layers as plain
    // CSS — the page's composition assumes they are THERE, so an empty
    // background would look broken rather than degraded.
    canvas.classList.add('hidden');
    fallback.classList.remove('hidden');
  }
})();

// --- scroll reveal ------------------------------------------------------------

const revealables = [...document.querySelectorAll('.reveal')];
/**
 * Show everything, unconditionally. Drops the .js-reveal gate rather than
 * relying on the .is-visible transition to carry elements back to opacity 1 —
 * if we are here because the environment is not animating, a transition is
 * exactly the wrong thing to depend on.
 */
function revealAll() {
  document.documentElement.classList.remove('js-reveal');
  revealables.forEach((el) => el.classList.add('is-visible'));
}

if ('IntersectionObserver' in window && !prefersReducedMotion) {
  // Only now does the hidden-until-revealed styling switch on. Sections are
  // visible by default and this script opts into animating them, rather than
  // the markup hiding them and hoping this script shows them again.
  document.documentElement.classList.add('js-reveal');

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target); // one-shot: re-animating on scroll-back is nausea, not delight
      }
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );
  revealables.forEach((el) => observer.observe(el));

  // Failsafe. An observer that never fires (some embedded webviews simply
  // don't run them) would otherwise hide the entire informative half of the
  // page forever. Losing the animation is fine; losing the content is not.
  setTimeout(() => {
    if (!revealables.some((el) => el.classList.contains('is-visible'))) revealAll();
  }, 2500);
} else {
  revealAll();
}

// --- latest updates, from the real changelog ----------------------------------

const newsList = document.getElementById('news-list');

/** One changelog entry. Everything is textContent — the changelog is a file on disk, but it is still not markup. */
function renderNewsEntry(entry, index) {
  const item = document.createElement('article');
  item.className = 'news-item';

  const heading = document.createElement('h3');
  heading.className = 'flex flex-wrap items-center gap-1.5 text-[0.72rem] font-bold text-mist';
  if (index === 0) {
    const isNew = document.createElement('span');
    isNew.className = 'badge-new';
    isNew.textContent = 'New';
    heading.appendChild(isNew);
  }
  const version = document.createElement('span');
  version.className = 'text-gold-bright';
  version.textContent = `v${entry.version}`;
  heading.appendChild(version);
  if (entry.title) {
    const title = document.createElement('span');
    title.className = 'text-mist-dim';
    title.textContent = `— ${entry.title}`;
    heading.appendChild(title);
  }

  const notes = document.createElement('ul');
  notes.className = 'mt-1 space-y-0.5 text-[0.68rem] leading-snug text-mist-dim';
  for (const note of entry.notes.slice(0, 3)) {
    const li = document.createElement('li');
    li.className = 'flex gap-1.5';
    const dot = document.createElement('span');
    dot.className = 'text-gold-deep';
    dot.setAttribute('aria-hidden', 'true');
    dot.textContent = '·';
    const text = document.createElement('span');
    text.textContent = note;
    li.append(dot, text);
    notes.appendChild(li);
  }

  item.append(heading, notes);
  return item;
}

(async () => {
  const message = (text) => {
    newsList.replaceChildren();
    const p = document.createElement('p');
    p.className = 'p-3 text-xs text-mist-faint';
    p.textContent = text;
    newsList.appendChild(p);
  };
  try {
    const response = await fetch('/api/site/news');
    if (!response.ok) throw new Error(String(response.status));
    const { entries = [] } = await response.json();
    if (!entries.length) return message('No release notes yet — add them to changelogs.md and they show up here.');
    newsList.replaceChildren();
    entries.forEach((entry, i) => newsList.appendChild(renderNewsEntry(entry, i)));
  } catch {
    message('Could not load the latest updates.');
  }
})();

// --- live catalog counts ------------------------------------------------------

const STATS = [
  { key: 'assets', label: 'Placeable assets', icon: 'i-box' },
  { key: 'monsters', label: 'Monster types', icon: 'i-skull' },
  { key: 'skills', label: 'Skills', icon: 'i-sparkles' },
  { key: 'items', label: 'Items', icon: 'i-sword' },
  { key: 'quests', label: 'Quests', icon: 'i-braces' },
  { key: 'maps', label: 'Maps', icon: 'i-map' },
];

(async () => {
  const bar = document.getElementById('stat-bar');
  try {
    const response = await fetch('/api/site/stats');
    const { stats = {} } = await response.json();
    bar.replaceChildren();
    for (const { key, label, icon: iconId } of STATS) {
      if (typeof stats[key] !== 'number') continue;

      const cell = document.createElement('div');
      cell.className = 'panel flex items-center gap-3 px-3.5 py-3';
      cell.appendChild(icon(iconId, 'h-5 w-5 shrink-0 text-gold'));

      const text = document.createElement('div');
      const dd = document.createElement('dd');
      dd.className = 'text-lg font-extrabold leading-none text-gold-bright';
      dd.textContent = stats[key].toLocaleString();
      const dt = document.createElement('dt');
      dt.className = 'mt-1 text-[0.58rem] font-bold uppercase tracking-[0.12em] text-mist-faint';
      dt.textContent = label;
      text.append(dd, dt);

      cell.appendChild(text);
      bar.appendChild(cell);
    }
  } catch {
    // A missing stat block is better than a wrong one — leave it empty.
  }
})();

// --- account UI ---------------------------------------------------------------

const dialog = document.getElementById('auth-dialog');
const form = document.getElementById('auth-form');
const errorBox = document.getElementById('auth-error');
const submitBtn = document.getElementById('auth-submit');
const titleEl = document.getElementById('auth-title');
const subEl = document.getElementById('auth-sub');
const accountSlot = document.getElementById('account-slot');
const authTabs = [...document.querySelectorAll('[data-auth-tab]')];
const registerOnly = [...document.querySelectorAll('[data-only="register"]')];

const AUTH_MODES = {
  register: { title: 'Claim your name', sub: 'Keep your characters and creations tied to you.', submit: 'Create account', run: register },
  login: { title: 'Welcome back', sub: 'Sign in to pick up where you left off.', submit: 'Sign in', run: login },
};

const ACTIVE_TAB = ['bg-ink-700', 'text-gold-bright'];
const IDLE_TAB = ['text-mist-dim', 'hover:text-mist'];

let authMode = 'register';

function setAuthMode(next) {
  authMode = next;
  const config = AUTH_MODES[next];
  titleEl.textContent = config.title;
  subEl.textContent = config.sub;
  submitBtn.textContent = config.submit;
  // Email is a signup-only field; hiding it also takes it out of the tab order.
  registerOnly.forEach((el) => el.classList.toggle('hidden', next !== 'register'));
  document.getElementById('auth-password').autocomplete = next === 'register' ? 'new-password' : 'current-password';

  for (const tab of authTabs) {
    const isActive = tab.dataset.authTab === next;
    tab.setAttribute('aria-selected', String(isActive));
    tab.classList.remove(...ACTIVE_TAB, ...IDLE_TAB);
    tab.classList.add(...(isActive ? ACTIVE_TAB : IDLE_TAB));
  }
  clearError();
}

function clearError() {
  errorBox.classList.add('hidden');
  errorBox.textContent = '';
  for (const input of form.querySelectorAll('input')) {
    input.classList.remove('border-red-500');
    input.removeAttribute('aria-invalid');
  }
}

/** Shows the server's message and, when it named a field, focuses and marks that input. */
function showError(message, field) {
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
  if (!field) return;
  const input = form.querySelector(`[name="${field}"]`);
  if (!input) return;
  input.classList.add('border-red-500');
  input.setAttribute('aria-invalid', 'true');
  input.focus();
}

function openDialog(next) {
  setAuthMode(next);
  form.reset();
  if (!dialog.open) dialog.showModal();
  form.querySelector('[name="username"]').focus();
}

for (const tab of authTabs) tab.addEventListener('click', () => setAuthMode(tab.dataset.authTab));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  const data = new FormData(form);
  const credentials = {
    username: String(data.get('username') || '').trim(),
    password: String(data.get('password') || ''),
    email: authMode === 'register' ? String(data.get('email') || '').trim() : undefined,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = authMode === 'register' ? 'Sealing the pact…' : 'Opening the gate…';
  try {
    const user = await AUTH_MODES[authMode].run(credentials);
    renderAccount(user);
    dialog.close();
  } catch (err) {
    showError(err.message, err.field);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = AUTH_MODES[authMode].submit;
  }
});

// Clicking the backdrop (i.e. outside the panel) closes it — <dialog> reports
// those clicks as landing on the dialog element itself.
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

/** Swaps the nav's right-hand slot between signed-out CTAs and the account chip. */
function renderAccount(user) {
  accountSlot.replaceChildren();

  if (!user) {
    const signIn = document.createElement('button');
    signIn.type = 'button';
    signIn.className = 'hidden rounded-lg px-3 py-2 text-[0.68rem] font-bold uppercase tracking-[0.12em] text-mist-dim transition-colors hover:text-mist sm:block';
    signIn.textContent = 'Sign in';
    signIn.addEventListener('click', () => openDialog('login'));

    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'btn-gold px-4 py-2 text-[0.66rem] sm:px-5';
    create.textContent = 'Get started';
    create.addEventListener('click', () => openDialog('register'));

    accountSlot.append(signIn, create);
    return;
  }

  const chip = document.createElement('div');
  chip.className = 'flex items-center gap-2.5 rounded-lg border border-gold/25 bg-ink-800/80 py-1.5 pl-2 pr-1.5';

  const sigil = document.createElement('span');
  sigil.className = 'grid h-7 w-7 place-items-center rounded-full border border-gold/40 bg-ink-700 text-[0.6rem] font-extrabold text-gold-bright';
  sigil.textContent = user.username.slice(0, 2).toUpperCase();
  sigil.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'max-w-[9rem] truncate text-sm font-bold text-mist';
  name.textContent = user.username; // textContent, not innerHTML — a username is untrusted input

  const signOut = document.createElement('button');
  signOut.type = 'button';
  signOut.className = 'rounded-md px-2 py-1 text-[0.58rem] font-bold uppercase tracking-wider text-mist-faint transition-colors hover:text-red-300';
  signOut.textContent = 'Sign out';
  signOut.addEventListener('click', async () => {
    await logout();
    renderAccount(null);
  });

  const play = document.createElement('a');
  play.href = '/play';
  play.className = 'btn-gold px-4 py-2 text-[0.66rem]';
  play.textContent = 'Play';

  chip.append(sigil, name, signOut);
  accountSlot.append(chip, play);
}

// Render signed-out immediately so the nav is never empty, then correct it once
// the server has had its say about the stored token.
renderAccount(null);
setAuthMode('register');
currentUser().then((user) => {
  if (user) renderAccount(user);
});
