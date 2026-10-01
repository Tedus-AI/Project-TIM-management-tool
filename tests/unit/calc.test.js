'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const calc = require('../../js/core/calc.js');

function mkDb() {
  const db = schema.newDb();
  const mat = schema.newMaterial({ vendor: 'VendorB', model: 'GF-750', k: 7.5, comp_rec_min: 10, comp_rec_max: 40 });
  db.materials[mat.id] = mat;
  const p = schema.newProject({ name: 'P1' });
  db.projects[p.id] = p;
  return { db, mat, p };
}

test('compression check: ok / warn / error', () => {
  const { db, mat, p } = mkDb();
  const it = schema.newItem({ material_id: mat.id, size: { l: 11, w: 11, t: 2 }, gap: { nom: 1.6, min: 1.5, max: 1.7 } });
  let c = calc.compressionCheck(it, mat, db.settings);
  assert.equal(c.status, 'ok');
  assert.equal(Math.round(c.min * 10) / 10, 15);   // (2-1.7)/2
  assert.equal(Math.round(c.max * 10) / 10, 25);   // (2-1.5)/2
  assert.equal(c.rec.source, 'material');

  it.gap = { nom: 1.0, min: 0.9, max: 1.1 };        // 45~55 % → too much
  c = calc.compressionCheck(it, mat, db.settings);
  assert.equal(c.status, 'warn');
  assert.ok(c.msgs.some(m => m.includes('高於建議')));

  it.gap = { nom: 2.0, min: 1.9, max: 2.1 };        // max gap > T → no contact
  c = calc.compressionCheck(it, mat, db.settings);
  assert.equal(c.status, 'error');

  it.gap = { nom: null, min: null, max: null };
  assert.equal(calc.compressionCheck(it, mat, db.settings).status, 'na');

  // override wins over material; generic fallback when material has none
  it.gap = { nom: 1.6, min: 1.5, max: 1.7 };
  it.comp_override = { min: 20, max: 30 };
  c = calc.compressionCheck(it, mat, db.settings);
  assert.equal(c.rec.source, 'item'); assert.equal(c.status, 'warn');   // min 15 % < 20 %
  const bare = schema.newItem({ size: { l: 5, w: 5, t: 2 }, gap: { nom: 1.6 } });
  assert.equal(calc.recCompression(bare, null, db.settings).source, 'generic');
  void p;
});

test('thermal estimate: R = t_c·1000/(k·A), ΔT = P·R, effective area', () => {
  const { mat } = mkDb();
  const it = schema.newItem({
    material_id: mat.id, size: { l: 11, w: 11, t: 2 }, gap: { nom: 1.6 },
    covered: [schema.newCovered({ part: 'U1', power_w: 3 }), schema.newCovered({ part: 'U2', power_w: 2, pkg_l: 5, pkg_w: 5 })],
  });
  const th = calc.thermalEstimate(it, mat);
  assert.equal(th.t_c, 1.6);
  assert.equal(th.t_src, 'gap');
  const R121 = 1.6 * 1000 / (7.5 * 121);
  assert.ok(Math.abs(th.R_pad - R121) < 1e-9);
  assert.ok(Math.abs(th.rows[0].dT - 3 * R121) < 1e-9);
  const R25 = 1.6 * 1000 / (7.5 * 25);              // pad 121 mm² > package 25 mm²
  assert.ok(Math.abs(th.rows[1].R - R25) < 1e-9);
  assert.ok(Math.abs(th.dt_max - Math.max(3 * R121, 2 * R25)) < 1e-9);

  const noMat = calc.thermalEstimate(schema.newItem({ size: { l: 1, w: 1, t: 1 } }), null);
  assert.equal(noMat.R_pad, null);
  assert.equal(noMat.t_src, 'thickness');
});

test('source risk', () => {
  assert.equal(calc.sourceRisk(schema.newItem()), 'single');
  assert.equal(calc.sourceRisk(schema.newItem({ sources: [schema.newSource({ vendor: 'Z' })] })), 'unverified');
  assert.equal(calc.sourceRisk(schema.newItem({ sources: [schema.newSource({ vendor: 'Z', status: 'qualified' })] })), 'ok');
  assert.equal(calc.sourceRisk(schema.newItem({ sources: [schema.newSource({ vendor: 'Z', status: 'rejected' })] })), 'single');
});

test('project checks: duplicates, P/N conflict, placement mismatch, EOL', () => {
  const { db, mat, p } = mkDb();
  const loc = p.locations[0].id;
  const a = schema.newItem({ item_no: 'A1', location_id: loc, material_id: mat.id, size: { l: 5, w: 5, t: 2 }, qty: 2, delta_pn: '111' });
  const b = schema.newItem({ item_no: 'a1', location_id: loc, vendor: 'X', model: 'Y', size: { l: 6, w: 6, t: 2 }, qty: 1, delta_pn: '111' });
  p.items.push(a, b);
  const v = schema.newView({ shapes: [schema.newShape({ item_id: a.id })] });
  p.views.push(v);
  let checks = calc.projectChecks(p, db);
  const codes = checks.map(c => c.code);
  assert.ok(codes.includes('dup_item_no'));
  assert.ok(codes.includes('pn_conflict'));
  assert.ok(checks.some(c => c.code === 'placement_mismatch' && c.item_id === a.id));
  assert.ok(checks.some(c => c.code === 'single_source'));
  assert.equal(checks[0].level, 'error');            // errors sorted first
  mat.avl_status = 'eol';
  checks = calc.projectChecks(p, db);
  assert.ok(checks.some(c => c.code === 'mat_eol'));
});

test('project stats & cost', () => {
  const { db, p } = mkDb();
  const loc = p.locations[0].id;
  p.items.push(schema.newItem({ item_no: 'A1', location_id: loc, vendor: 'V', model: 'M', qty: 4, price: { unit: 0.5, currency: 'USD' } }));
  p.items.push(schema.newItem({ item_no: 'A2', location_id: loc, vendor: 'V', model: 'M', qty: 2 }));
  p.items.push(schema.newItem({ item_no: 'A3', location_id: loc, vendor: 'V', model: 'N', qty: 9, status: 'obsolete' }));
  const s = calc.projectStats(p, db);
  assert.equal(s.items, 2); assert.equal(s.pcs, 6); assert.equal(s.materials, 1);
  assert.equal(s.cost.USD, 2); assert.equal(s.cost_missing, 1); assert.equal(s.single, 2);
});

test('baseline diff matches by id then item_no', () => {
  const { db, p } = mkDb();
  const loc = p.locations[0].id;
  const a = schema.newItem({ item_no: 'A1', location_id: loc, size: { l: 5, w: 5, t: 2 }, qty: 2 });
  const b = schema.newItem({ item_no: 'A2', location_id: loc, qty: 1 });
  p.items.push(a, b);
  const snap1 = calc.makeSnapshot(p);
  a.size.t = 2.5; a.qty = 3;
  p.items.splice(1, 1);
  p.items.push(schema.newItem({ item_no: 'A3', location_id: loc }));
  const d = calc.diffSnapshots(snap1, calc.makeSnapshot(p), db);
  assert.deepEqual(d.added.map(x => x.item_no), ['A3']);
  assert.deepEqual(d.removed.map(x => x.item_no), ['A2']);
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed[0].fields.map(f => f.field).sort(), ['qty', 'size']);
});

test('where-used and search', () => {
  const { db, mat, p } = mkDb();
  const loc = p.locations[0].id;
  p.items.push(schema.newItem({ item_no: 'A1', location_id: loc, material_id: mat.id, delta_pn: '3249', covered: [schema.newCovered({ part: 'LX2160', refdes: 'U5' })] }));
  p.items.push(schema.newItem({ item_no: 'A2', location_id: loc, vendor: 'Other', model: 'Pad', sources: [schema.newSource({ vendor: 'VendorB', model: 'GF-750' })] }));
  const wu = calc.whereUsed(db, mat.id);
  assert.deepEqual(wu.map(w => [w.item_no, w.role]), [['A1', 'primary'], ['A2', '2nd source']]);
  assert.deepEqual(calc.searchItems(db, 'lx2160').map(r => r.item_no), ['A1']);
  assert.deepEqual(calc.searchItems(db, 'gf-750').map(r => r.item_no), ['A1', 'A2']);
  assert.deepEqual(calc.searchItems(db, 'A1 u5').map(r => r.item_no), ['A1']);
  assert.equal(calc.searchItems(db, '').length, 0);
});

test('top-side fraction scales the heat through the TIM; compression rounding', () => {
  const { mat } = mkDb();
  const it = schema.newItem({ material_id: mat.id, size: { l: 10, w: 10, t: 2 }, gap: { nom: 1.6 },
    covered: [schema.newCovered({ part: 'PA', power_w: 10, top_pct: 20 }), schema.newCovered({ part: 'FPGA', power_w: 10 })] });
  const th = calc.thermalEstimate(it, mat);
  const R = 1.6 * 1000 / (7.5 * 100);
  assert.ok(Math.abs(th.rows[0].power - 2) < 1e-9);
  assert.ok(Math.abs(th.rows[0].dT - 2 * R) < 1e-9);
  assert.ok(Math.abs(th.rows[1].dT - 10 * R) < 1e-9, 'blank fraction = 100 %');
  assert.equal(calc.compressionAt(3, 2.7), 10);
  const cc = calc.compressionCheck(schema.newItem({ size: { l: 1, w: 1, t: 3 }, gap: { min: 2.3, nom: 2.5, max: 2.7 } }), mat, schema.newDb().settings);
  assert.equal(cc.status, 'ok', '10 % at the edge of a 10–40 % band is not a warning');
});

test('material usage: pads in pcs, dispensed TIM in g / cc (Q\'ty × amount), obsolete skipped', () => {
  const { db, mat, p } = mkDb();
  const loc = p.locations[0].id;
  p.items.push(schema.newItem({ item_no: 'A1', location_id: loc, material_id: mat.id, qty: 4 }));
  p.items.push(schema.newItem({ item_no: 'A2', location_id: loc, material_id: mat.id, qty: 2 }));
  p.items.push(schema.newItem({ item_no: 'A3', location_id: loc, material_id: mat.id, qty: 9, status: 'obsolete' }));
  p.items.push(schema.newItem({ item_no: 'G1', location_id: loc, vendor: 'Vendor-C', model: 'GF-3500', tim_type: 'gap_filler', qty: 3, dispense: { amount: 1.5, unit: 'g', blt: 0.3 } }));
  p.items.push(schema.newItem({ item_no: 'G2', location_id: loc, vendor: 'Vendor-C', model: 'GF-3500', tim_type: 'gap_filler', dispense: { amount: 0.25, unit: 'g' } }));
  p.items.push(schema.newItem({ item_no: 'H1', location_id: loc, vendor: 'Vendor-D', model: 'TG-1', tim_type: 'grease', qty: 2, dispense: { amount: 0.4, unit: 'cc' } }));
  const u = calc.materialUsage(p, db);
  const by = m => u.find(x => x.model === m);
  assert.deepEqual(by('GF-750').amounts, { pcs: 6 });
  assert.equal(by('GF-750').usage, '6 pcs');
  assert.deepEqual(by('GF-750').items, ['A1', 'A2']);
  assert.deepEqual(by('GF-3500').amounts, { g: 4.75 }, '3 × 1.5 g + one dispense of 0.25 g');
  assert.equal(by('GF-3500').usage, '4.75 g');
  assert.equal(by('TG-1').usage, '0.8 cc');
});
