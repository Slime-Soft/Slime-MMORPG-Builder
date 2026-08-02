import { stubBrowserGlobals } from '../scripts/lib/softRaster.mjs';
stubBrowserGlobals();
const { PROP_TYPES } = await import('../src/sim/propTypes.js');
const { buildProp } = await import('../src/generators/props.js');
let bad = 0;
for (const d of PROP_TYPES) {
  if (d.id === 'custom' || d.id === 'model') continue;
  for (const seed of [1, 42, 1001]) {
    try { buildProp(d.id, seed); }
    catch (e) { console.log(`${d.id} (seed ${seed}): ${e.message}`); bad++; break; }
  }
}
console.log(bad ? `\n${bad} prop(s) with a missing material` : '\nall materials resolve');
