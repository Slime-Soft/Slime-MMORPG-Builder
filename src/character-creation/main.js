// src/character-creation/main.js
import * as THREE from 'three';
import {
  buildPlayerCharacter, HAIR_STYLES, HAIR_COLORS, EYE_COLORS, SKIN_TONES, GENDERS, GENDER_LABELS,
  selectableBodies,
} from '../generators/playerCharacter.js';
import { EYE_STYLES, EYE_STYLE_LABELS, MOUTH_STYLES } from '../generators/faceTexture.js';
import { applyWeaponTuning } from '../sim/weaponTypes.js';
import { CLASS_META, CLASS_IDS } from '../sim/classMeta.js';

// The class bodies authored in the Character & NPC Builder. Fetched, not
// hardcoded, so a body tuned there shows up here without a code change; the
// builder falls back to the built-in presets if the endpoint is unavailable.
let characterTypes = [];
const catalogReady = Promise.all([
  fetch('/api/character-types').then((r) => r.json()).catch(() => []),
  fetch('/api/weapon-tuning').then((r) => r.json()).catch(() => ({})),
]).then(([types, tuning]) => {
  characterTypes = types;
  applyWeaponTuning(tuning); // so the preview holds its weapon the way the game does
  refreshBodyOptions();
  rebuildPreview();
});

// --- Preview scene ---
const canvas = document.getElementById('preview-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a34);
const hemi = new THREE.HemisphereLight(0xffffff, 0x333344, 1.1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xfff2d0, 1.0);
key.position.set(3, 6, 4);
scene.add(key);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
// Framed for the part-based body, which stands ~1.75 units tall.
camera.position.set(0, 1.05, 3.5);
camera.lookAt(0, 0.9, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let previewMesh = null;
let autoRotate = true;
let dragRotationY = 0;

function rebuildPreview() {
  if (previewMesh) scene.remove(previewMesh);
  // A class must be picked before there's a body to show; default to the first
  // so the panel is never empty while the player is still deciding.
  previewMesh = buildPlayerCharacter(characterTypes, selectedClass || CLASS_IDS[0], currentParams());
  previewMesh.rotation.y = dragRotationY;
  scene.add(previewMesh);
}

// --- Drag-to-rotate ---
let dragging = false;
let lastX = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; autoRotate = false; });
window.addEventListener('pointerup', () => (dragging = false));
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX;
  lastX = e.clientX;
  dragRotationY += dx * 0.01;
  if (previewMesh) previewMesh.rotation.y = dragRotationY;
});

function animate() {
  requestAnimationFrame(animate);
  if (autoRotate && previewMesh) {
    dragRotationY += 0.006;
    previewMesh.rotation.y = dragRotationY;
  }
  renderer.render(scene, camera);
}
animate();

// --- Form state ---
let hairColor = HAIR_COLORS[1];
let eyeColor = EYE_COLORS[0];
let skinTone = SKIN_TONES[1];
let selectedClass = null;

const genderEl = document.getElementById('gender');
genderEl.innerHTML = GENDERS.map((g) => `<option value="${g}">${GENDER_LABELS[g]}</option>`).join('');

const hairStyleEl = document.getElementById('hair-style');
// The body is part-based now: hair style is a real set of shapes, and the
// outfit belongs to the class, not the player.
const prettify = (s) => s.replace(/^anime-/, '').replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase());
hairStyleEl.innerHTML = HAIR_STYLES
  .map((h) => `<option value="${h}">${prettify(h)}${h.startsWith('anime-') ? ' (anime)' : ''}</option>`)
  .join('');

// WHICH BODY, separately from which class (see playerCharacter's classBody).
// "Class default" keeps the old behaviour — the body that matches the class —
// so an existing character is unaffected until the player deliberately picks
// something else.
const bodyEl = document.getElementById('body-type');
function refreshBodyOptions() {
  const keep = bodyEl.value;
  bodyEl.innerHTML = ['<option value="">Class default</option>']
    .concat(selectableBodies(characterTypes).map((b) => `<option value="${b.id}">${b.name}</option>`))
    .join('');
  // `adventurer` is the family id; classBody picks -f/-m from the gender, so
  // the player chooses a body and a gender rather than one combined row.
  bodyEl.insertAdjacentHTML('beforeend', '<option value="adventurer">Adventurer (anime)</option>');
  bodyEl.value = keep;
}
refreshBodyOptions();

const eyeStyleEl = document.getElementById('eye-style');
eyeStyleEl.innerHTML = EYE_STYLES.map((e) => `<option value="${e}">${EYE_STYLE_LABELS[e]}</option>`).join('');

const mouthStyleEl = document.getElementById('mouth-style');
mouthStyleEl.innerHTML = MOUTH_STYLES.map((m) => `<option value="${m}">${prettify(m)}</option>`).join('');
mouthStyleEl.value = 'smile';

function currentParams() {
  return {
    gender: genderEl.value,
    bodyId: bodyEl.value || undefined,
    hairStyle: hairStyleEl.value,
    eyeStyle: eyeStyleEl.value,
    mouthStyle: mouthStyleEl.value,
    hairColor,
    eyeColor,
    skinTone,
  };
}

for (const el of [genderEl, bodyEl, hairStyleEl, eyeStyleEl, mouthStyleEl]) {
  el.addEventListener('change', rebuildPreview);
}

function buildSwatches(containerId, colors, getCurrent, setCurrent) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  colors.forEach((color) => {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.style.background = `#${color.toString(16).padStart(6, '0')}`;
    if (color === getCurrent()) el.classList.add('selected');
    el.addEventListener('click', () => {
      setCurrent(color);
      [...container.children].forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');
      rebuildPreview();
    });
    container.appendChild(el);
  });
}

function refreshSwatches() {
  buildSwatches('hair-color-swatches', HAIR_COLORS, () => hairColor, (c) => (hairColor = c));
  buildSwatches('eye-color-swatches', EYE_COLORS, () => eyeColor, (c) => (eyeColor = c));
  buildSwatches('skin-tone-swatches', SKIN_TONES, () => skinTone, (c) => (skinTone = c));
}
refreshSwatches();

const pickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];

document.getElementById('randomize-btn').addEventListener('click', () => {
  hairColor = pickOne(HAIR_COLORS);
  eyeColor = pickOne(EYE_COLORS);
  skinTone = pickOne(SKIN_TONES);
  hairStyleEl.value = pickOne(HAIR_STYLES);
  eyeStyleEl.value = pickOne(EYE_STYLES);
  refreshSwatches();
  rebuildPreview();
});

// --- Class selection ---
const classCardsEl = document.getElementById('class-cards');
const enterBtn = document.getElementById('enter-btn');

CLASS_IDS.forEach((classId) => {
  const meta = CLASS_META[classId];
  const card = document.createElement('div');
  card.className = 'class-card';
  card.innerHTML = `<div class="name">${meta.name}</div><div class="tagline">${meta.tagline}</div>`;
  card.addEventListener('click', () => {
    selectedClass = classId;
    [...classCardsEl.children].forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    enterBtn.disabled = false;
    rebuildPreview();
  });
  classCardsEl.appendChild(card);
});

// --- Persist + enter world ---
enterBtn.addEventListener('click', () => {
  if (!selectedClass) return;
  const character = { ...currentParams(), classId: selectedClass };
  localStorage.setItem('fantasy-mmo-character', JSON.stringify(character));
  window.location.href = '/play'; // '/' is the landing site now — the game lives here
});

rebuildPreview();
