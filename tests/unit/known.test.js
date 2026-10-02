'use strict';
// 元件快選: components entered before (覆蓋元件 of any project) — index, matching, picking and filling.
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
    cov({ part: 'LDO-A', cat: 'PWR', power_w: 0.5, pkg_l: 3, pkg_w: 3, h_min: 0.8, h_nom: 0.9, h_max: 1.0, p_allow: 10, p_unit: 'kgf' }),
    cov({ part: 'TRX-1235', cat: 'RF', power_w: 4.5, top_pct: 70, pkg_l: 17, pkg_w: 17 }),
  ] })];
  neu.items = [
    schema.newItem({ item_no: 'B1', covered: [cov({ id: 'cov_new_ldo', part: ' ldo-a ', power_w: 0.6 })] }),
    schema.newItem({ item_no: 'B2', covered: [cov({ part: 'BUCK-B', qty: 4, refdes: 'U9' })] }),
  ];
  d.projects[old.id] = old; d.projects[neu.id] = neu;
  return d;
}

test('known components: one entry per part number, newest project first, older projects fill the gaps', () => {
  const known = calc.knownComponents(db());
  assert.deepEqual(known.map(e => e.key), ['LDO-A', 'BUCK-B', 'TRX-1235']);
  const ldo = known[0];
  assert.equal(ldo.part, 'ldo-a');                       // spelling of the most recent use
  assert.equal(ldo.uses.length, 2);
  assert.equal(ldo.values.power_w, 0.6);                 // newest project wins…
  assert.equal(ldo.from.power.project, 'Proj-New');
  assert.deepEqual([ldo.values.h_min, ldo.values.h_nom, ldo.values.h_max], [0.8, 0.9, 1.0]);   // …older one fills what it lacks
  assert.deepEqual([ldo.values.p_allow, ldo.values.p_unit], [10, 'kgf']);                     // a load travels with its unit
  assert.equal(ldo.from.height.project, 'Proj-Old');
  assert.deepEqual(ldo.differs, ['功耗']);
  // RefDes / 數量 / 備註 are never part of it; a default unit alone is not data
  const buck = known[1];
  assert.deepEqual(buck.values, {});
  assert.equal(buck.from.allow, undefined);
  // the row being edited is left out
  assert.equal(calc.knownComponents(db(), { exclude: 'cov_new_ldo' })[0].uses.length, 1);
});

test('matching typed text: exact, starts with, contains, then ignoring separators; empty = most recent', () => {
  const known = calc.knownComponents(db());
  assert.deepEqual(calc.matchKnown(known, '').map(e => e.key), ['LDO-A', 'BUCK-B', 'TRX-1235']);
  assert.deepEqual(calc.matchKnown(known, 'trx').map(e => e.key), ['TRX-1235']);
  assert.deepEqual(calc.matchKnown(known, '1235').map(e => e.key), ['TRX-1235']);
  assert.deepEqual(calc.matchKnown(known, 'trx1235').map(e => e.key), ['TRX-1235']);
  assert.deepEqual(calc.matchKnown(known, 'ＬＤＯ').map(e => e.key), ['LDO-A']);     // full-width typing
  assert.deepEqual(calc.matchKnown(known, 'nothing'), []);
  assert.equal(calc.matchKnown(known, '', 1).length, 1);
});

test('picking overwrites the groups the known component has; filling only touches empty groups', () => {
  const known = calc.knownComponents(db());
  const trx = known.find(e => e.key === 'TRX-1235');
  assert.deepEqual(calc.knownPatch(trx), { part: 'TRX-1235', cat: 'RF', power_w: 4.5, top_pct: 70, pkg_l: 17, pkg_w: 17 });

  const typed = cov({ part: 'LDO-A', cat: 'DIGI', refdes: 'U1', qty: 2 });
  const other = cov({ part: 'UNKNOWN-9' });
  const r = calc.fillFromKnown([typed, other], known);
  assert.deepEqual(r.parts, ['LDO-A']);
  const f = r.list[0];
  assert.equal(f.cat, 'DIGI');                            // had a value → kept
  assert.equal(f.power_w, 0.6);
  assert.deepEqual([f.pkg_l, f.pkg_w, f.h_nom, f.p_allow, f.p_unit], [3, 3, 0.9, 10, 'kgf']);
  assert.deepEqual([f.refdes, f.qty, f.id], ['U1', 2, typed.id]);
  assert.equal(r.list[1], other);                         // unknown part: the same object
  // only the entries isNew() accepts
  assert.deepEqual(calc.fillFromKnown([typed], known, () => false).parts, []);
  // nothing left to fill → untouched
  assert.equal(calc.fillFromKnown([f], known).list[0], f);
});

test('component summary for the list and the change log', () => {
  const known = calc.knownComponents(db());
  assert.equal(calc.componentSummary(known[0].values), 'PWR · 功耗 0.6 W · 封裝 3 × 3 · 高度 0.8 / 0.9 / 1 · 耐壓 10 kgf');
  assert.equal(calc.componentSummary(known[0].values, { cat: false }).startsWith('功耗'), true);
  assert.equal(calc.componentSummary({}), '');
});
