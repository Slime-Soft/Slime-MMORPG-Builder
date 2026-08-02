// scripts/check-imports.mjs
// Every bare module specifier the CLIENT imports must be resolvable by the
// import map in public/index.html.
//
// THE BUG THIS EXISTS TO PREVENT: there is no bundler here — the browser loads
// src/ as raw ES modules and resolves bare specifiers ("three", "three.quarks",
// …) through the <script type="importmap"> block in public/index.html. Node,
// meanwhile, resolves them through node_modules and package `exports`. The two
// do NOT agree.
//
// `three/examples/jsm/utils/BufferGeometryUtils.js` resolves fine in Node, and
// every `npm run check` script passed, while the browser could not resolve it
// at all — one unresolvable specifier fails the whole module graph, so the game
// booted to a black screen stuck on "Connecting…". The import map only aliases
// `three/addons/`, not `three/examples/`.
//
// This walks every import in src/ and fails on any bare specifier the import
// map cannot resolve, using the same prefix rules the browser uses:
//   - an exact key match ("three")
//   - a trailing-slash key acting as a prefix ("three/addons/")
// Relative specifiers (./ ../ /) are the browser's problem, not the map's.
//
//   node scripts/check-imports.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');
const HTML = path.join(ROOT, 'public/index.html');

function importMapFrom(html) {
  const m = html.match(/<script\s+type="importmap"\s*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error('No <script type="importmap"> found in public/index.html');
  return JSON.parse(m[1]).imports || {};
}

/** Mirrors the browser's import-map lookup: exact key, then longest prefix key. */
function resolvable(spec, imports) {
  if (imports[spec]) return true;
  let best = null;
  for (const key of Object.keys(imports)) {
    if (key.endsWith('/') && spec.startsWith(key)) {
      if (!best || key.length > best.length) best = key;
    }
  }
  return best !== null;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'vendor' || entry === 'node_modules') continue;
    const p = path.join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
const DYNAMIC_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Comments have to go first. An import statement may span lines, so the regex
 * above deliberately crosses newlines — which means a later COMMENT containing
 * the word "from" followed by a quoted phrase gets swallowed into the match.
 * That produced two confident false positives on the first run
 * (`-> "still in flight"`, `-> "everywhere"`), both ordinary English prose.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

function specifiersIn(src) {
  const clean = stripComments(src);
  const found = new Set();
  for (const re of [IMPORT_RE, DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) found.add(m[1]);
  }
  return [...found];
}

const isBare = (s) => !s.startsWith('.') && !s.startsWith('/') && !s.startsWith('http');

// --- self-test: prove the matcher has teeth before trusting a pass -----------
{
  const imports = { three: 'x', 'three/addons/': 'y' };
  const cases = [
    ['three', true],
    ['three/addons/utils/BufferGeometryUtils.js', true],
    ['three/examples/jsm/utils/BufferGeometryUtils.js', false], // the real bug
    ['three.quarks', false],
  ];
  const bad = cases.filter(([spec, want]) => resolvable(spec, imports) !== want);
  if (bad.length) {
    console.error('FAIL: self-test — the import-map matcher is broken, so a pass would mean nothing.');
    for (const [spec, want] of bad) console.error(`  ${spec}: expected ${want}`);
    process.exit(1);
  }
  const parsed = specifiersIn(
    "import { a } from 'three';\n" +
    "import {\n  b,\n} from 'three/addons/x.js';\n" +           // multi-line import still found
    "const m = await import('./x.js');\n" +
    "// a note about where packets come from 'everywhere'\n" +   // prose, not an import
    "/* blocked from 'still in flight' */\n"
  );
  const wantFound = ['three', 'three/addons/x.js', './x.js'];
  const wantMissing = ['everywhere', 'still in flight'];
  if (wantFound.some((s) => !parsed.includes(s)) || wantMissing.some((s) => parsed.includes(s))) {
    console.error('FAIL: self-test — specifier extraction is wrong.');
    console.error(`  got: ${JSON.stringify(parsed)}`);
    process.exit(1);
  }
}
console.log('self-test        ok (matcher rejects three/examples/, accepts three/addons/)');

const imports = importMapFrom(readFileSync(HTML, 'utf8'));
console.log(`import map       ${Object.keys(imports).length} entries: ${Object.keys(imports).join(', ')}`);

const files = walk(SRC);
const violations = [];
for (const file of files) {
  for (const spec of specifiersIn(readFileSync(file, 'utf8'))) {
    if (!isBare(spec)) continue;
    if (resolvable(spec, imports)) continue;
    violations.push(`${path.relative(ROOT, file)}  ->  "${spec}"`);
  }
}

console.log(`browser-resolvable ${violations.length ? `${violations.length} violation(s)` : 'ok'}`);
if (violations.length) {
  console.error(
    '\n  The browser loads src/ as raw ES modules and resolves bare specifiers through\n' +
    '  the import map in public/index.html. A specifier missing there fails the whole\n' +
    '  module graph — the game boots to a black screen — even though Node resolves it\n' +
    '  happily and every other check passes.\n'
  );
  for (const v of violations) console.error(`    ${v}`);
  console.error('\n  Fix the import, or add the prefix to the import map in public/index.html.\n');
  process.exit(1);
}

console.log(`\n${files.length} client files scanned.`);
console.log('PASS');
