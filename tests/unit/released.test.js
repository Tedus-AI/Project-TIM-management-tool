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

// ───────── kept after no project uses it (db.released) ─────────
const merge = require('../../js/core/merge.js');
const { createStore } = require('../../js/core/store.js');

function memStore(db, user) {
  const f = { text: '' };
  const st = createStore({ saveDelay: 100000 });
  st.setUser(user || 'alice');
  st.attach({ kind: 'mem', label: () => 'mem', head: async () => f.text.slice(0, 512), read: async () => f.text, write: async t => { f.text = t; } }, db);
  return { st, f };
}

test('a P/N no project uses any more stays listed, as it last was', () => {
  const { db, m, old, neu } = db2();
  const { st } = memStore(db);
  // B9 (DEMO-2002, only use) deleted → archived with its attributes and where it was used
  st.mutateProject(neu.id, p => { p.items = p.items.filter(it => it.item_no !== 'B9'); });
  let rel = Object.values(st.db.released);
  assert.equal(rel.length, 1);
  assert.equal(rel[0].pn, 'DEMO-2002');
  assert.equal(rel[0].archived_by, 'alice');
  assert.deepEqual(rel[0].uses.map(u => u.project + '/' + u.item_no + '/' + u.location), ['New/B9/Bottom Case']);
  let e = released.parts(st.db).find(x => x.key === 'DEMO-2002');
  assert.ok(e && e.archived, 'still listed');
  assert.deepEqual(e.uses, []);
  assert.equal(e.spec, 'Vendor-D · GEL-1 · 0.4 g');
  assert.ok(released.matches(e, 'new b9'), 'searchable by where it was used');
  const f = released.itemFields(e, st.db);
  assert.deepEqual([f.delta_pn, f.vendor, f.model, f.tim_type], ['DEMO-2002', 'Vendor-D', 'GEL-1', 'gel']);
  assert.deepEqual(f.dispense, { amount: 0.4, unit: 'g', blt: 0.2 });
  // DEMO-1001 is used by two projects: deleting one keeps it live (nothing archived)
  st.mutateDb(d => { delete d.projects[old.id]; }, { deletedProjects: [old.id] });
  assert.equal(Object.keys(st.db.released).length, 1);
  assert.ok(!released.parts(st.db).find(x => x.key === 'DEMO-1001').archived);
  // … then the P/N is changed on the remaining items → archived with the linked material's names and k
  st.mutateProject(neu.id, p => { p.items.forEach(it => { if (released.pnKey(it.delta_pn) === 'DEMO-1001') it.delta_pn = 'DEMO-1001A'; }); });
  e = released.parts(st.db).find(x => x.key === 'DEMO-1001');
  assert.ok(e.archived);
  assert.equal(e.eff.k, 7.5);
  assert.deepEqual(e.archived.uses.map(u => u.item_no), ['B7', 'B8']);
  assert.ok(st.db.released[e.archived.id].item.material_id === m.id);
  // the material deleted later: the names and k kept in the record
  delete st.db.materials[m.id];
  e = released.parts(st.db).find(x => x.key === 'DEMO-1001');
  assert.deepEqual([e.eff.vendor, e.eff.model, e.eff.k], ['Vendor-A', 'GF-750', 7.5]);
  assert.equal(released.itemFields(e, st.db).material_id, null);
});

test('undo does not archive; used again → listed as live; archived again → the same record refreshed', () => {
  const { db, neu } = db2();
  const { st } = memStore(db);
  const it = schema.newItem({ item_no: 'B10', location_id: neu.locations[0].id, delta_pn: 'DEMO-3003', vendor: 'Vendor-B', model: 'Q' });
  st.mutateProject(neu.id, p => { p.items.push(it); });
  st.undo('p:' + neu.id);
  assert.deepEqual(st.db.released, {}, 'an undone P/N never happened');
  // deleted (archived), undo brings it back (live), deleted again → same record
  st.mutateProject(neu.id, p => { p.items = p.items.filter(x => x.item_no !== 'B9'); });
  const id = Object.keys(st.db.released)[0];
  st.undo('p:' + neu.id);
  assert.ok(!released.parts(st.db).find(x => x.key === 'DEMO-2002').archived, 'live again');
  st.mutateProject(neu.id, p => { const x = p.items.find(y => y.item_no === 'B9'); x.qty = 9; });
  st.mutateProject(neu.id, p => { p.items = p.items.filter(x => x.item_no !== 'B9'); });
  assert.deepEqual(Object.keys(st.db.released), [id], 'one record per P/N');
  assert.equal(st.db.released[id].uses[0].qty, 9);
  // removing it from 已發行 TIM
  const ids = released.archivedIds(st.db, 'DEMO-2002');
  st.mutateDb(d => { ids.forEach(x => { delete d.released[x]; }); }, { deletedReleased: ids });
  assert.ok(!released.parts(st.db).find(x => x.key === 'DEMO-2002'));
});

test('archive records merge one by one; a conflict copy counts as the same P/N', () => {
  const { db } = db2();
  const rec = schema.normalizeReleased({ pn: 'DEMO-9009', item: { vendor: 'Vendor-B', model: 'Q', tim_type: 'pad' }, updated_at: '2026-01-01T00:00:00Z' });
  const copy = schema.normalizeReleased({ pn: 'DEMO-9009 (衝突副本 10/20 10:20)', item: { vendor: 'Vendor-B', model: 'Q2', tim_type: 'pad' }, updated_at: '2026-02-01T00:00:00Z' });
  db.released[rec.id] = rec; db.released[copy.id] = copy;
  const list = released.parts(db).filter(x => x.key === 'DEMO-9009');
  assert.equal(list.length, 1, 'one entry');
  assert.equal(list[0].eff.model, 'Q2', 'the newest record');
  assert.deepEqual(released.archivedIds(db, 'DEMO-9009').sort(), [rec.id, copy.id].sort());
  // serialised and merged like the other record kinds
  const disk = schema.normalizeDb(JSON.parse(merge.serializeDb(db)));
  assert.ok(disk.released[rec.id]);
  const local = schema.normalizeDb(JSON.parse(merge.serializeDb(db)));
  const mine = schema.normalizeReleased({ pn: 'DEMO-7007', item: {} });
  local.released[mine.id] = mine;
  const r = merge.mergeForSave(disk, local, merge.revsOf(disk), { released: new Set([mine.id]), deletedReleased: new Set([rec.id]) });
  assert.ok(r.merged.released[mine.id] && !r.merged.released[rec.id] && r.merged.released[copy.id]);
});
