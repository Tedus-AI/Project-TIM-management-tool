'use strict';
// Gap stack-up (機構高度 ± 公差 − 元件高度), deflection-curve interpolation and the pressure check.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const calc = require('../../js/core/calc.js');

// fictional soft pad: two thickness curves [psi, %]
const mat = schema.newMaterial({ vendor: 'Vendor-B', model: 'GF-750', k: 7.5, pressure_curves: [
  { t: 1.0, points: [[10, 13], [20, 38], [30, 55], [50, 68]] },
  { t: 3.0, points: [[5, 36], [10, 68], [20, 80]] },
] });
const settings = schema.newDb().settings;
const near = (a, b, eps) => assert.ok(Math.abs(a - b) < (eps || 1e-3), a + ' ≈ ' + b);

test('stack-up: worst case per component; manual gap until there is a 機構高度 and a component height', () => {
  const ic = schema.newCovered({ part: 'FPGA-A', h_min: 1.10, h_nom: 1.20, h_max: 1.30 });
  const it = schema.newItem({ size: { l: 20, w: 20, t: 3 }, gap: { nom: 1.4 }, mech: { nom: 2.7, plus: 0.1, minus: 0.1 }, covered: [ic] });
  const g = calc.gapInfo(it);
  assert.equal(g.source, 'stack');
  assert.deepEqual([g.min, g.nom, g.max], [1.3, 1.5, 1.7]);   // 2.6−1.30 / 2.7−1.20 / 2.8−1.10
  const cc = calc.compressionCheck(it, mat, settings);
  assert.deepEqual([cc.min, cc.nom, cc.max].map(v => Math.round(v * 10) / 10), [43.3, 50, 56.7]);
  // ✂ manual → the typed gap again
  assert.equal(calc.gapInfo(Object.assign({}, it, { gap_manual: true })).nom, 1.4);
  // no component height → manual gap; no 機構高度 → manual gap
  assert.equal(calc.gapInfo(Object.assign({}, it, { covered: [schema.newCovered({ part: 'X' })] })).source, 'manual');
  assert.equal(calc.gapInfo(Object.assign({}, it, { mech: { nom: null } })).source, 'manual');
  // only a nominal height and no tolerances → a single value
  const one = calc.gapInfo(schema.newItem({ mech: { nom: 2 }, covered: [schema.newCovered({ h_nom: 0.5 })] }));
  assert.deepEqual([one.min, one.nom, one.max], [1.5, 1.5, 1.5]);
  // two components: the tallest sets the minimum gap, the shortest the maximum
  const two = calc.gapInfo(schema.newItem({ mech: { nom: 3 }, covered: [schema.newCovered({ h_nom: 1 }), schema.newCovered({ h_nom: 2 })] }));
  assert.deepEqual([two.min, two.nom, two.max], [1, 1, 2]);
  // per-component thermal thickness
  const th = calc.thermalEstimate(schema.newItem({ size: { l: 10, w: 10, t: 2.5 }, mech: { nom: 3 },
    covered: [schema.newCovered({ h_nom: 1, power_w: 1 }), schema.newCovered({ h_nom: 2, power_w: 1 })] }), mat);
  near(th.rows[0].R / th.rows[1].R, 2 / 1);   // t_c 2.0 vs 1.0 mm
});

test('pressure from the deflection curves: exact, between thicknesses, nearest, beyond', () => {
  near(calc.pressureAt(mat, 1.0, 50).psi, 20 + (12 / 17) * 10);           // 27.06 psi
  assert.equal(calc.pressureAt(mat, 1.0, 50).basis, 'exact');
  near(calc.pressureAt(mat, 1.0, 6.5).psi, 5);                          // (0,0) → (10,13)
  assert.equal(calc.pressureAt(mat, 1.0, 0).psi, 0);
  const mid = calc.pressureAt(mat, 2.0, 50);                            // half way between 1 mm and 3 mm
  assert.equal(mid.basis, 'interp');
  near(mid.psi, (27.0588 + (5 + (14 / 32) * 5)) / 2, 1e-2);
  assert.equal(calc.pressureAt(mat, 5.0, 50).basis, 'nearest');
  assert.deepEqual(calc.pressureAt(mat, 5.0, 50).t_used, [3]);
  const over = calc.pressureAt(mat, 1.0, 90);
  assert.equal(over.beyond, true); assert.equal(over.psi, 50);
  assert.equal(calc.pressureAt(schema.newMaterial(), 1, 50), null, 'no curve');
});

test('pressure check: Fail above the allowable, Warning from 80 %, force units over the contact area', () => {
  const ic = schema.newCovered({ part: 'FPGA-A', h_nom: 1, pkg_l: 10, pkg_w: 10, p_allow: 30, p_unit: 'psi' });
  const it = schema.newItem({ size: { l: 12, w: 12, t: 1 }, mech: { nom: 1.5 }, covered: [ic] });   // gap 0.5 → 50 %
  let cc = calc.compressionCheck(it, mat, settings);
  near(cc.comps[0].pMax.psi, 27.0588);
  assert.equal(cc.comps[0].status, 'warn');                              // 90 % of 30 psi
  assert.match(cc.msgs.join('\n'), /達耐壓的 90%/);
  ic.p_allow = 25;
  cc = calc.compressionCheck(it, mat, settings);
  assert.equal(cc.status, 'error');
  assert.match(cc.msgs.join('\n'), /超過耐壓 25 psi/);
  ic.p_allow = 100;
  assert.equal(calc.compressionCheck(it, mat, settings).status, 'ok');
  // force: 445 N over 10 × 10 mm (pad is larger) = 4.45 MPa ≈ 645 psi
  Object.assign(ic, { p_allow: 445, p_unit: 'N' });
  cc = calc.compressionCheck(it, mat, settings);
  near(cc.comps[0].allow.psi, 445 / 100e-6 / calc.PSI_PA, 1e-2);
  near(cc.comps[0].force, 27.0588 * calc.PSI_PA * 100e-6, 1e-2);
  // force without a package size → cannot convert (note, not a failure)
  Object.assign(ic, { pkg_l: null, pkg_w: null }); it.size.l = null;
  cc = calc.compressionCheck(it, mat, settings);
  assert.equal(cc.comps[0].status, 'na');
  assert.match(cc.notes.join('\n'), /需要封裝尺寸/);
  // beyond the curve but already above the allowable → Fail; below → Warning (unknown)
  const tight = schema.newItem({ size: { l: 12, w: 12, t: 1 }, mech: { nom: 1.05 }, covered: [schema.newCovered({ h_nom: 1, p_allow: 40 })] });
  assert.equal(calc.compressionCheck(tight, mat, settings).comps[0].status, 'error');   // 95 % > curve (50 psi ≥ 40)
  tight.covered[0].p_allow = 80;
  assert.match(calc.compressionCheck(tight, mat, settings).msgs.join('\n'), /超出材料曲線範圍/);
  // stack-up with a component that has no height → listed as not checked
  const mixed = schema.newItem({ size: { l: 12, w: 12, t: 1 }, mech: { nom: 1.5 }, covered: [schema.newCovered({ part: 'A', h_nom: 1 }), schema.newCovered({ part: 'B' })] });
  assert.match(calc.compressionCheck(mixed, mat, settings).notes.join('\n'), /B：未填元件高度/);
  // material without a curve: compression only, with a note
  const bare = calc.compressionCheck(it, schema.newMaterial(), settings);
  assert.equal(bare.comps[0].pMax, null);
});

test('schema: new fields normalised; old {min,max} settings still give a minimum only', () => {
  const it = schema.normalizeItem({ mech: { nom: '2.7', plus: 'x' }, gap_manual: 'yes', covered: [{ h_max: '1.3', p_allow: '30', p_unit: 'bar' }] });
  assert.deepEqual(it.mech, { nom: 2.7, plus: null, minus: null });
  assert.equal(it.gap_manual, false);
  assert.deepEqual([it.covered[0].h_max, it.covered[0].p_allow, it.covered[0].p_unit], [1.3, 30, 'psi']);
  const old = { generic_comp: { pad: { min: 10, max: 30 } } };
  assert.deepEqual(calc.recCompression(schema.newItem(), null, old), { min: 10, source: 'generic' });
  const m = schema.normalizeMaterial({ pressure_curves: [{ t: 1, points: [[20, 38], [10, 13]] }, { t: null, points: [[1, 1]] }] });
  assert.deepEqual(m.pressure_curves, [{ t: 1, points: [[10, 13], [20, 38]] }]);
});
