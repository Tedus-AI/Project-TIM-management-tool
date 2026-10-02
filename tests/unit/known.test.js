'use strict';
// 元件快選 (RefDes field): components entered before (覆蓋元件 of any project) — index, matching, grouping, picking.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const calc = require('../../js/core/calc.js');

const cov = f => schema.newCovered(f);
function db() {
  const d = schema.newDb();
  const old = schema.newProject({ name: 'Proj-Old', updated_at: '2026-01-01T00:00:00Z' });
  const neu = schema.newProject({ name: 'Proj-New', updated_at: '2026-09-01T00:00:00Z' });
  old.items = [schema.newItem({ item_no: 'T1', covered: [
    // the component name only in RefDes (no part number) — how many rows are filled
    cov({ refdes: 'TRX-A', cat: 'RF', power_w: 4.5, pkg_l: 11, pkg_w: 7, h_min: 1.1, h_nom: 1.2, h_max: 1.3, p_allow: 1, p_unit: 'kgf' }),
    cov({ part: 'LDO-A', refdes: 'U7', cat: 'PWR', power_w: 0.5, pkg_l: 3, pkg_w: 3 }),
  ] })];
  neu.items = [
    schema.newItem({ item_no: 'B1', covered: [cov({ id: 'cov_new_trx', refdes: ' trx-a ', power_w: 5, top_pct: 80 })] }),
    schema.newItem({ item_no: 'B2', covered: [cov({ part: 'LDO-A', refdes: 'U9', qty: 4, cat: 'PWR' }), cov({ refdes: 'FPGA-B', cat: 'DIGI', power_w: 18 }), cov({ part: 'MISC-1' })] }),
  ];
  d.projects[old.id] = old; d.projects[neu.id] = neu;
  return d;
}

test('known components: one entry per RefDes + 元件料號, newest project first, older projects fill the gaps', () => {
  const known = calc.knownComponents(db());
  assert.deepEqual(known.map(e => e.name), ['trx-a', 'U9', 'FPGA-B', 'MISC-1', 'U7']);
  const trx = known[0];
  assert.deepEqual([trx.refdes, trx.part, trx.rkey, trx.pkey], ['trx-a', '', 'TRX-A', '']);   // spelling of the most recent use
  assert.equal(trx.uses.length, 2);
  assert.equal(trx.values.power_w, 5);                      // newest project wins…
  assert.equal(trx.from.power.project, 'Proj-New');
  assert.deepEqual([trx.values.cat, trx.values.pkg_l, trx.values.h_nom, trx.values.p_allow, trx.values.p_unit], ['RF', 11, 1.2, 1, 'kgf']);   // …older one fills the rest
  assert.equal(trx.from.height.project, 'Proj-Old');
  assert.deepEqual(trx.differs, ['功耗']);
  // the same part number with another RefDes is another entry (not keyed on the part number alone)
  assert.deepEqual(known.filter(e => e.pkey === 'LDO-A').map(e => e.refdes), ['U9', 'U7']);
  // the row being edited is left out
  assert.equal(calc.knownComponents(db(), { exclude: 'cov_new_trx' })[0].uses.length, 1);
});

test('matching typed text on RefDes or 元件料號: exact, starts with, contains, ignoring separators; empty = all, most recent first', () => {
  const known = calc.knownComponents(db());
  assert.equal(calc.matchKnown(known, '').length, 5);
  assert.equal(calc.matchKnown(known, '', 2).length, 2);
  assert.deepEqual(calc.matchKnown(known, 'trx').map(e => e.name), ['trx-a']);
  assert.deepEqual(calc.matchKnown(known, 'trxa').map(e => e.name), ['trx-a']);
  assert.deepEqual(calc.matchKnown(known, 'ldo').map(e => e.name), ['U9', 'U7']);      // via the part number
  assert.deepEqual(calc.matchKnown(known, 'u9').map(e => e.name), ['U9']);              // via RefDes
  assert.deepEqual(calc.matchKnown(known, 'ＦＰＧＡ').map(e => e.name), ['FPGA-B']);   // full-width typing
  assert.deepEqual(calc.matchKnown(known, 'nothing'), []);
});

test('the list is grouped by 類別 in the usual order, 未分類 last, order kept inside a group', () => {
  const groups = calc.groupKnown(calc.knownComponents(db()));
  assert.deepEqual(groups.map(g => [g.cat, g.label, g.items.map(e => e.name)]),
    [['RF', 'RF', ['trx-a']], ['DIGI', 'DIGI', ['FPGA-B']], ['PWR', 'PWR', ['U9', 'U7']], ['', '未分類', ['MISC-1']]]);
  assert.equal(groups[0].color, schema.CATEGORIES.find(c => c.v === 'RF').color);
  assert.deepEqual(calc.groupKnown([]), []);
});

test('picking writes the name (RefDes + 元件料號) and every group the component has', () => {
  const known = calc.knownComponents(db());
  assert.deepEqual(calc.knownPatch(known.find(e => e.name === 'FPGA-B')), { refdes: 'FPGA-B', part: '', cat: 'DIGI', power_w: 18 });
  const p = calc.knownPatch(known[0]);
  assert.deepEqual([p.refdes, p.part, p.power_w, p.top_pct, p.pkg_w, p.h_max, p.p_allow, p.p_unit], ['trx-a', '', 5, 80, 7, 1.3, 1, 'kgf']);
  assert.equal('qty' in p || 'note' in p, false);
});

test('component summary for the list and the change log', () => {
  const known = calc.knownComponents(db());
  assert.equal(calc.componentSummary(known[0].values), 'RF · 功耗 5 W · 頂面 80% · 封裝 11 × 7 · 高度 1.1 / 1.2 / 1.3 · 耐壓 1 kgf');
  assert.equal(calc.componentSummary(known[0].values, { cat: false }).startsWith('功耗'), true);
  assert.equal(calc.componentSummary({}), '');
});
