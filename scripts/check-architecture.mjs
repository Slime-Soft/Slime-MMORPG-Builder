// scripts/check-architecture.mjs
// Guardrail runner: enforces the src/sim invariants CLAUDE.md has always
// demanded in prose but nothing checked —
//
//   "src/sim/ — deterministic simulation core. Zero DOM/rendering
//    dependencies. This same code path must be usable both client-side
//    (prediction/offline) and server-side (authoritative)."
//
// Concretely, every file under src/sim must:
//   1. import nothing but its own siblings (no three, no render/net/editor/
//      generators/ui, no npm package at all),
//   2. touch no DOM/browser global, and
//   3. draw no randomness or wall-clock time (Math.random / Date.now /
//      performance.now) — randomness comes from src/sim/rng.js, and `now`
//      is passed in by the caller.
//
//   node scripts/check-architecture.mjs
//
// Exits non-zero on any violation, so it can gate CI later. Ported from the
// reference project's tests/architecture.test.ts (which the reference's own
// CLAUDE.md calls a load-bearing invariant), adapted to this project's plain
// -node, no-test-framework setup.
//
// SELF-TEST FIRST. This file checks its own matchers against known-bad and
// benign-lookalike inputs before it scans anything. A purity guard that has
// silently stopped matching reports a confident PASS over a broken tree —
// which is exactly how the first version of check-prefabs.mjs shipped green
// over 91 detached shapes. A guard you haven't watched fail is not a guard.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIM_ROOT = join(ROOT, 'src', 'sim');

// --- matchers ---------------------------------------------------------------

// Blank out comments while preserving line numbers, so prose (a comment that
// names Math.random, or a "the search window" sentence) can't create a false
// positive. The `[^:]` guard keeps `https://...` inside a string from eating
// the rest of the line.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOM_GLOBAL_RE = /\b(document|window|navigator|localStorage|sessionStorage|alert)\s*[.[(]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

/**
 * A specifier a host-agnostic sim file must never import. The sim's whole
 * contract is that it runs unchanged in Node and the browser, so its import
 * surface is: its own siblings, and nothing else. Returns a short reason, or
 * null when the import is allowed.
 *
 * @param {string} spec the module specifier as written
 * @param {string} fromDir directory of the importing file (absolute)
 */
export function forbiddenImport(spec, fromDir) {
  if (!spec.startsWith('.')) {
    // Bare specifier: an npm package or a node: builtin. Either drags a host
    // dependency into the core. `three` is called out by name because it is
    // the one that actually leaked in (via src/generators/custom.js).
    if (spec === 'three' || spec.startsWith('three/')) return 'three';
    return spec.startsWith('node:') ? 'node builtin' : 'npm package';
  }
  const target = resolve(fromDir, spec);
  if (target.startsWith(SIM_ROOT)) return null;
  // Reaching out of src/sim entirely: name the layer it landed in.
  const rel = relative(join(ROOT, 'src'), target).split(/[\\/]/)[0];
  return `src/${rel}`;
}

// --- scanning ---------------------------------------------------------------

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function importSpecs(src) {
  const specs = [];
  for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1]);
  for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
  return specs;
}

function scanImports(files) {
  const violations = [];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const spec of importSpecs(src)) {
      const bad = forbiddenImport(spec, dirname(file));
      if (bad) violations.push(`${relative(ROOT, file)} imports '${spec}' (${bad})`);
    }
  }
  return violations;
}

function scanLines(files, re) {
  const violations = [];
  for (const file of files) {
    stripComments(readFileSync(file, 'utf8'))
      .split('\n')
      .forEach((line, i) => {
        if (re.test(line)) violations.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
      });
  }
  return violations;
}

// --- self-test: prove the matchers still have teeth --------------------------

function selfTest() {
  const failures = [];
  const check = (ok, label) => { if (!ok) failures.push(label); };
  const simDir = SIM_ROOT;

  // forbiddenImport must flag every forbidden shape...
  check(forbiddenImport('three', simDir) === 'three', "forbiddenImport('three')");
  check(forbiddenImport('three/examples/jsm/x.js', simDir) === 'three', "forbiddenImport('three/...')");
  check(forbiddenImport('socket.io', simDir) === 'npm package', "forbiddenImport('socket.io')");
  check(forbiddenImport('node:fs', simDir) === 'node builtin', "forbiddenImport('node:fs')");
  check(forbiddenImport('../generators/custom.js', simDir) === 'src/generators', 'forbiddenImport(generators)');
  check(forbiddenImport('../render/scene.js', simDir) === 'src/render', 'forbiddenImport(render)');
  check(forbiddenImport('../net/client.js', simDir) === 'src/net', 'forbiddenImport(net)');
  check(forbiddenImport('../editor/main.js', simDir) === 'src/editor', 'forbiddenImport(editor)');
  // ...and allow a sibling, at any depth.
  check(forbiddenImport('./tower.js', simDir) === null, 'forbiddenImport(sibling)');
  check(forbiddenImport('../sim/rng.js', simDir) === null, 'forbiddenImport(sim via ..)');

  // The import regex must actually see real import forms.
  check(importSpecs("import {a} from './x.js';").length === 1, 'IMPORT_RE named import');
  check(importSpecs("export {a} from './x.js';").length === 1, 'IMPORT_RE re-export');
  check(importSpecs("await import('./x.js')").length === 1, 'DYN_IMPORT_RE');

  // DOM globals: real access matches, benign lookalikes do not.
  for (const bad of ['document.body.append(x)', 'window.location.href', 'navigator.userAgent', "localStorage['k']", 'sessionStorage.setItem(a, b)', 'alert("hi")']) {
    check(DOM_GLOBAL_RE.test(bad), `DOM_GLOBAL_RE should match: ${bad}`);
  }
  for (const ok of ['const windowless = 1;', 'this.documentTitle = t;', 'const navigatorState = 1;']) {
    check(!DOM_GLOBAL_RE.test(ok), `DOM_GLOBAL_RE should NOT match: ${ok}`);
  }

  // Nondeterminism: real sources match, deterministic lookalikes do not.
  for (const bad of ['Math.random()', 'Date.now()', 'performance.now()']) {
    check(NONDETERMINISM_RE.test(bad), `NONDETERMINISM_RE should match: ${bad}`);
  }
  for (const ok of ['Math.round(x)', 'Date.parse(s)', 'rng()', 'const now = 5;']) {
    check(!NONDETERMINISM_RE.test(ok), `NONDETERMINISM_RE should NOT match: ${ok}`);
  }

  // stripComments blanks prose but keeps code and line numbers.
  check(!NONDETERMINISM_RE.test(stripComments('// uses Math.random somewhere')), 'stripComments line comment');
  check(!NONDETERMINISM_RE.test(stripComments('/* Math.random */')), 'stripComments block comment');
  check(NONDETERMINISM_RE.test(stripComments('const r = Math.random();')), 'stripComments keeps code');
  check(stripComments('a\n/* x\ny */\nb').split('\n').length === 4, 'stripComments keeps line count');

  return failures;
}

// --- run --------------------------------------------------------------------

const selfTestFailures = selfTest();
if (selfTestFailures.length) {
  console.error('FAIL: the guard\'s own matchers are broken — it would report a vacuous PASS.\n');
  for (const f of selfTestFailures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`self-test        ok (matchers still have teeth)`);

const simFiles = walk(SIM_ROOT);
if (simFiles.length < 10) {
  console.error(`FAIL: only found ${simFiles.length} files under src/sim — did the tree move?`);
  process.exit(1);
}

const checks = [
  ['host-agnostic    ', scanImports(simFiles), 'src/sim must import nothing but its own siblings — no three, no npm package, no render/net/editor/generators.'],
  ['headless         ', scanLines(simFiles, DOM_GLOBAL_RE), 'src/sim must run in Node as well as the browser — no DOM/browser globals.'],
  ['deterministic    ', scanLines(simFiles, NONDETERMINISM_RE), 'src/sim randomness goes through src/sim/rng.js, and `now` is passed in by the caller.'],
];

let failed = 0;
for (const [label, violations, why] of checks) {
  console.log(`${label} ${violations.length ? `${violations.length} violation(s)` : 'ok'}`);
  if (violations.length) {
    failed++;
    console.error(`\n  ${why}`);
    for (const v of violations) console.error(`    ${v}`);
    console.error('');
  }
}

console.log(`\n${simFiles.length} sim files — ${failed} failing check(s).`);
if (failed) {
  console.error('\nFAIL: src/sim is the deterministic core both the client and the server run.\nA violation here means that guarantee is gone. See CLAUDE.md > Architecture.');
  process.exit(1);
}
console.log('PASS');
