'use strict';
// 已發行 TIM: part numbers collected from every project's TIM list; new items made from them.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const released = require('../../js/core/released.js');

function db2() {
  const db = schema.newDb();
  const m = schema.newMaterial({ vendor: 'Vendor-A', model: 'GF-750', tim_type: 'pad', k: 7.5 });
  db.materials[m.id] = m;
  const old = schema.newProject({ name: 'Old', stage: 'PVT' }); old.updated_at = '2026-01-01T00:00:00Z';
  const neu = schema.newProject({ name: 'New', stage: 'EVT' }); neu.updated_at = '2026-09-01T00:00:00Z';
  const mk = (p, f) => { const it = schema.newItem(Object.assign({ location_id: p.locations[0].id }, f)); p.items.push(it); return it; };
  mk(old, { item_no: 'A1', delta_pn: 'DEMO-1001', material_id: m.id, vendor: 'x', model: 'y', size: { l: 10, w: 10, t: 1.5 }, qty: 2, vendor_pn: 'GF750-15',
    sources: [schema.newSource ? schema.newSource({ vendor: 'Vendor-C', model: 'TP-7' }) : { id: 's1', vendor: 'Vendor-C', model: 'TP-7' }], price: { unit: 0.5, currency: 'USD' } });
  mk(old, { item_no: 'A2', delta_pn: 'N/A', vendor: 'Vendor-B', model: 'Q' });
  mk(old, { item_no: 'A3', delta_pn: ' tbd ', vendor: 'Vendor-B', model: 'Q' });
  mk(old, { item_no: 'A4', delta_pn: '', vendor: 'Vendor-B', model: 'Q' });
  mk(neu, { item_no: 'B7', delta_pn: 'demo-1001 ', material_id: m.id, size: { l: 10, w: 10, t: 1.5 }, qty: 4, used_on: ['RF'] });
  mk(neu, { item_no: 'B8', delta_pn: 'DEMO-1001', material_id: m.id, size: { l: 12, w: 10, t: 1.5 }, qty: 1 });
  mk(neu, { item_no: 'B9', delta_pn: 'DEMO-2002', vendor: 'Vendor-D', model: 'GEL-1', tim_type: 'gel', dispense: { amount: 0.4, unit: 'g', blt: 0.2 } });
  db.projects[old.id] = old; db.projects[neu.id] = neu;
  return { db, m, old, neu };
}

test('placeholders are not part numbers; one entry per P/N (case / spaces ignored), newest project first', () => {
  assert.equal(released.pnKey('N/A'), '');
  assert.equal(released.pnKey(' n/a '), '');
  assert.equal(released.pnKey('-'), '');
  assert.equal(released.pnKey('TBD'), '');
  assert.equal(released.pnKey('無'), '');
  assert.equal(released.pnKey('demo-1001 '), 'DEMO-1001');
  const { db } = db2();
  const ps = released.parts(db);
  assert.deepEqual(ps.map(p => p.key), ['DEMO-1001', 'DEMO-2002']);
  const a = ps[0];
  assert.equal(a.pn, 'demo-1001', 'spelling of the most recently updated project');
  assert.deepEqual(a.uses.map(u => u.project + '/' + u.item_no), ['New/B7', 'New/B8', 'Old/A1']);
  assert.deepEqual(a.specs.map(s => [s.text, s.n]), [['Vendor-A · GF-750 · 10*10*1.5', 2], ['Vendor-A · GF-750 · 12*10*1.5', 1]], 'different sizes under one P/N are visible');
  assert.equal(ps[1].spec, 'Vendor-D · GEL-1 · 0.4 g');
  assert.ok(released.matches(a, 'gf-750 old'));
  assert.ok(!released.matches(a, 'Vendor-D'));
});

test('a new item from a released part: the part attributes come along, the project-specific ones do not', () => {
  const { db, m, old } = db2();
  const e = released.parts(db).find(p => p.key === 'DEMO-1001');
  // attributes from the newest use (B7); take the old project's item to check 2nd source / price copies
  const fromOld = Object.assign({}, e, { item: old.items[0], pn: 'DEMO-1001' });
  const f = released.itemFields(fromOld, db);
  assert.equal(f.delta_pn, 'DEMO-1001');
  assert.equal(f.material_id, m.id);
  assert.deepEqual([f.vendor, f.model], ['Vendor-A', 'GF-750'], 'names of the linked material');
  assert.deepEqual(f.size, { l: 10, w: 10, t: 1.5 });
  assert.equal(f.vendor_pn, 'GF750-15');
  assert.equal(f.sources[0].vendor, 'Vendor-C');
  assert.notEqual(f.sources[0].id, old.items[0].sources[0].id, 'new ids');
  assert.deepEqual(f.price, { unit: 0.5, currency: 'USD' });
  for (const k of ['qty', 'used_on', 'covered', 'location_id', 'item_no', 'gap', 'gap_design', 'status', 'note']) assert.ok(!(k in f), k + ' not copied');
  f.size.l = 99;
  assert.equal(old.items[0].size.l, 10, 'a copy');
  // a deleted material → the names typed on the item
  delete db.materials[m.id];
  const g = released.itemFields(Object.assign({}, fromOld), db);
  assert.equal(g.material_id, null);
  assert.deepEqual([g.vendor, g.model], ['x', 'y']);
});
