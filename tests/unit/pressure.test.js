'use strict';
// Gaps (設計間距 ± 公差 + 元件高度公差), deflection-curve interpolation and the pressure check.
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

test('設計間距 (pedestal → component top) ± tolerance + component height tolerance → worst-case gaps per component', () => {
  const ic = schema.newCovered({ part: 'FPGA-A', h_min: 1.10, h_nom: 1.20, h_max: 1.30 });
  const it = schema.newItem({ size: { l: 20, w: 20, t: 3 }, gap: { nom: 1.4 }, gap_design: { nom: 1.5, plus: 0.1, minus: 0.1 }, covered: [ic] });
  const g = calc.gapInfo(it);
  assert.equal(g.source, 'stack');
  assert.deepEqual([g.min, g.nom, g.max], [1.3, 1.5, 1.7]);   // (1.5−0.1)−(1.30−1.20) / 1.5 / (1.5+0.1)+(1.20−1.10)
  const cc = calc.compressionCheck(it, mat, settings);
  assert.deepEqual([cc.min, cc.nom, cc.max].map(v => Math.round(v * 10) / 10), [43.3, 50, 56.7]);
  // ✂ manual → the typed gap again; no 設計間距 → manual gap
  assert.equal(calc.gapInfo(Object.assign({}, it, { gap_manual: true })).nom, 1.4);
  assert.equal(calc.gapInfo(Object.assign({}, it, { gap_design: { nom: null } })).source, 'manual');
  // no component height: the 設計間距 ± tolerance alone; no tolerance at all: a single value
  const noH = calc.gapInfo(Object.assign({}, it, { covered: [schema.newCovered({ part: 'X' })] }));
  assert.deepEqual([noH.source, noH.min, noH.nom, noH.max], ['stack', 1.4, 1.5, 1.6]);
  const bare = calc.gapInfo(schema.newItem({ gap_design: { nom: 0.8 } }));
  assert.deepEqual([bare.min, bare.nom, bare.max], [0.8, 0.8, 0.8]);
  // two components of very different heights (a 12.2 mm module and a 4.05 mm DDR): by default each has its own
  // pedestal at the design gap, each with its own height tolerance
  const cov = () => [schema.newCovered({ refdes: 'PWR', h_min: 11.7, h_nom: 12.2, h_max: 12.7 }), schema.newCovered({ refdes: 'DDR', h_min: 3.95, h_nom: 4.05, h_max: 4.15 })];
  const each = calc.gapInfo(schema.newItem({ gap_design: { nom: 1.5, plus: 0.1, minus: 0.1 }, covered: cov() }));
  assert.equal(each.flat, false);
  assert.deepEqual(each.comps.map(x => [x.min, x.nom, x.max]), [[0.9, 1.5, 2.1], [1.3, 1.5, 1.7]]);
  assert.deepEqual([each.min, each.nom, each.max], [0.9, 1.5, 2.1]);
  // gap_flat (one flat pedestal over both): the gap is to the tallest; the lower one gets the height difference
  const flat = calc.gapInfo(schema.newItem({ gap_flat: true, gap_design: { nom: 1.5, plus: 0.1, minus: 0.1 }, covered: cov() }));
  assert.deepEqual(flat.comps[1].nom, 9.65);   // 1.5 + (12.2 − 4.05)
  const two = calc.gapInfo(schema.newItem({ gap_flat: true, gap_design: { nom: 1 }, covered: [schema.newCovered({ h_nom: 1 }), schema.newCovered({ h_nom: 2 })] }));
  assert.deepEqual([two.min, two.nom, two.max, two.comps[0].nom, two.comps[1].nom], [1, 1, 2, 2, 1]);
  // the worst component is named when several have their own gaps
  const t2 = schema.newItem({ size: { l: 10, w: 10, t: 2.5 }, gap_flat: true, gap_design: { nom: 1.5, plus: 0.1, minus: 0.1 }, covered: cov() });
  assert.match(calc.compressionCheck(t2, mat, settings).msgs.join('\n'), /9\.85 mm ≥ 厚度 2\.5 mm（DDR）/);
  t2.gap_flat = false;
  assert.equal(calc.compressionCheck(t2, mat, settings).status, 'ok');
  // per-component thermal thickness
  const th = calc.thermalEstimate(schema.newItem({ size: { l: 10, w: 10, t: 2.5 }, gap_flat: true, gap_design: { nom: 1 },
    covered: [schema.newCovered({ h_nom: 1, power_w: 1 }), schema.newCovered({ h_nom: 2, power_w: 1 })] }), mat);
  near(th.rows[0].R / th.rows[1].R, 2 / 1);   // t_c 2.0 vs 1.0 mm
  // earlier saved format (PCB → pedestal height) converts to the same gaps — one pedestal height, so flat
  const old = schema.normalizeItem({ mech: { nom: 2.7, plus: 0.1, minus: 0.1 }, covered: [{ h_min: 1.1, h_nom: 1.2, h_max: 1.3 }] });
  assert.deepEqual(old.gap_design, { nom: 1.5, plus: 0.1, minus: 0.1 });
  assert.equal(old.gap_flat, true);
  assert.ok(!('mech' in old));
  assert.equal(schema.normalizeItem({ gap_flat: 'yes' }).gap_flat, false);
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
  const it = schema.newItem({ size: { l: 12, w: 12, t: 1 }, gap_design: { nom: 0.5 }, covered: [ic] });   // gap 0.5 → 50 %
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
  const tight = schema.newItem({ size: { l: 12, w: 12, t: 1 }, gap_design: { nom: 0.05 }, covered: [schema.newCovered({ h_nom: 1, p_allow: 40 })] });
  assert.equal(calc.compressionCheck(tight, mat, settings).comps[0].status, 'error');   // 95 % > curve (50 psi ≥ 40)
  tight.covered[0].p_allow = 80;
  assert.match(calc.compressionCheck(tight, mat, settings).msgs.join('\n'), /超出材料曲線範圍/);
  // flat: a component without a height next to one with a height → treated as the reference height (noted)
  const mixed = schema.newItem({ size: { l: 12, w: 12, t: 1 }, gap_flat: true, gap_design: { nom: 0.5 }, covered: [schema.newCovered({ part: 'A', h_nom: 1 }), schema.newCovered({ part: 'B' })] });
  const mc = calc.compressionCheck(mixed, mat, settings);
  assert.match(mc.notes.join('\n'), /B：未填元件高度，視為與基準元件同高/);
  assert.deepEqual(mc.comps.map(r => r.gap.nom), [0.5, 0.5]);
  // material without a curve: compression only, with a note
  const bare = calc.compressionCheck(it, schema.newMaterial(), settings);
  assert.equal(bare.comps[0].pMax, null);
});

test('schema: new fields normalised; old {min,max} settings still give a minimum only', () => {
  const it = schema.normalizeItem({ gap_design: { nom: '1.5', plus: 'x' }, gap_manual: 'yes', covered: [{ h_max: '1.3', p_allow: '30', p_unit: 'bar' }] });
  assert.deepEqual(it.gap_design, { nom: 1.5, plus: null, minus: null });
  assert.equal(it.gap_manual, false);
  assert.deepEqual([it.covered[0].h_max, it.covered[0].p_allow, it.covered[0].p_unit], [1.3, 30, 'psi']);
  const old = { generic_comp: { pad: { min: 10, max: 30 } } };
  assert.deepEqual(calc.recCompression(schema.newItem(), null, old), { min: 10, source: 'generic' });
  const m = schema.normalizeMaterial({ pressure_curves: [{ t: 1, points: [[20, 38], [10, 13]] }, { t: null, points: [[1, 1]] }] });
  assert.deepEqual(m.pressure_curves, [{ t: 1, points: [[10, 13], [20, 38]] }]);
});

test('受壓類型: E-PAD / QFN shows the pressure but is not judged; BGA without an allowable load asks for it', () => {
  const comp = (f) => schema.newCovered(Object.assign({ refdes: 'IC1', pkg_l: 10, pkg_w: 10, h_min: 1.1, h_nom: 1.2, h_max: 1.3 }, f));
  const item = c => schema.newItem({ size: { l: 20, w: 20, t: 1 }, gap_design: { nom: 0.5, plus: 0, minus: 0 }, covered: [c] });
  // 50 % compression of the 1 mm pad → ~ 28 psi, far above a 5 psi allowable
  const bga = calc.compressionCheck(item(comp({ load_type: 'bga', p_allow: 5 })), mat, settings);
  assert.equal(bga.status, 'error');
  assert.equal(bga.comps[0].exempt, false);
  const epad = calc.compressionCheck(item(comp({ load_type: 'epad', p_allow: 5 })), mat, settings);
  assert.equal(epad.status, 'ok', 'not judged');
  assert.equal(epad.comps[0].exempt, true);
  assert.equal(epad.comps[0].allow, null);
  assert.ok(epad.comps[0].pMax && epad.comps[0].pMax.psi > 20, 'pressure still computed');
  assert.deepEqual(epad.notes, []);
  // unspecified: judged only when the allowable load is filled (as before)
  assert.equal(calc.compressionCheck(item(comp({ p_allow: 5 })), mat, settings).status, 'error');
  assert.equal(calc.compressionCheck(item(comp({})), mat, settings).status, 'ok');
  // BGA / bare die / cavity without an allowable load: a note asks for it
  const ask = calc.compressionCheck(item(comp({ load_type: 'bare_die' })), mat, settings);
  assert.equal(ask.status, 'ok');
  assert.match(ask.notes.join(), /裸晶 需檢核耐壓/);
  // normalisation and the quick-select carry the type
  assert.equal(schema.normalizeItem({ covered: [{ load_type: 'nonsense' }] }).covered[0].load_type, '');
  assert.ok(calc.COMP_GROUPS.some(g => g.fields.includes('load_type')));
  assert.equal(calc.componentSummary({ cat: 'DIGI', load_type: 'epad' }), 'DIGI · E-PAD');
});

test('library match: an unlinked item named exactly like one library material is flagged', () => {
  const db = schema.newDb();
  const m = schema.newMaterial({ vendor: 'Vendor-B', model: 'GF-750' });
  db.materials[m.id] = m;
  const p = schema.newProject({ name: 'P' });
  const it = schema.newItem({ item_no: 'A1', vendor: ' vendor-b', model: 'GF-750 ', location_id: p.locations[0].id });
  p.items.push(it); db.projects[p.id] = p;
  assert.equal(calc.libraryMatch(db, it), m);
  assert.ok(calc.projectChecks(p, db).some(c => c.code === 'unlinked_material' && /GF-750 相同但未連結/.test(c.msg)));
  assert.equal(calc.libraryMatch(db, Object.assign({}, it, { material_id: m.id })), null, 'linked');
  assert.equal(calc.libraryMatch(db, Object.assign({}, it, { model: 'GF-75' })), null, 'not exact');
  const twin = schema.newMaterial({ vendor: 'Vendor-B', model: 'GF-750' });
  db.materials[twin.id] = twin;
  assert.equal(calc.libraryMatch(db, it), null, 'ambiguous');
});

test('per component: compression judgement (cStatus) apart from the pressure; why the pressure is not judged (pNote)', () => {
  const m = schema.newMaterial({ pressure_curves: [{ t: 2.5, points: [[10, 20], [20, 40], [40, 60]] }] });
  const it = schema.newItem({ size: { l: 20, w: 20, t: 2.5 }, gap_design: { nom: 1.5, plus: 0.1, minus: 0.1 }, covered: [
    schema.newCovered({ refdes: 'A', h_nom: 1, p_allow: 30, p_unit: 'psi' }),
    schema.newCovered({ refdes: 'B', h_nom: 1, load_type: 'epad' }),
    schema.newCovered({ refdes: 'C', h_nom: 1 }),
    schema.newCovered({ refdes: 'D', h_nom: 1, p_allow: 10, p_unit: 'N' }),
  ] });
  it.size.l = null;   // a force spec without a package size or pad area cannot be converted
  const cc = calc.compressionCheck(it, m, settings);
  assert.equal(cc.cStatus, 'ok');
  assert.deepEqual(cc.comps.map(r => r.cStatus), ['ok', 'ok', 'ok', 'ok']);
  assert.deepEqual(cc.comps.map(r => r.pNote), ['', '不檢核（E-PAD）', '未填規格', '缺封裝尺寸']);
  assert.equal(cc.comps[0].status, 'warn');   // 24 psi of 30 → 80 %
  assert.equal(calc.compressionCheck(it, null, settings).comps[2].pNote, '未連結材料');
  assert.equal(calc.compressionCheck(it, schema.newMaterial(), settings).comps[2].pNote, '材料無曲線');
  // not enough compression: the compression fails, the pressure judgement stays its own
  it.gap_design.nom = 2.4;
  const loose = calc.compressionCheck(it, m, settings);
  assert.equal(loose.cStatus, 'error');
  assert.deepEqual(loose.comps.map(r => r.cStatus), ['error', 'error', 'error', 'error']);
  assert.equal(loose.comps[0].status, 'ok');
});

test('projectStats: compression / pressure Fail and Warning counted apart, one per Item', () => {
  const db = schema.newDb();
  db.materials[mat.id] = mat;
  const p = schema.newProject({ name: 'X' }, 'u', db.settings);
  const loc = p.locations[0].id;
  const pad = extra => schema.newItem(Object.assign({ location_id: loc, material_id: mat.id, size: { l: 12, w: 12, t: 1 } }, extra));
  p.items = [
    // Fail twice over (C min below 10 % on two components) → one Item
    pad({ item_no: 'F1', gap_design: { nom: 0.95 }, covered: [schema.newCovered({ h_nom: 1 }), schema.newCovered({ h_nom: 1 })] }),
    // Warning: 27 psi at 50 % against 30 psi (90 %)
    pad({ item_no: 'W1', gap_design: { nom: 0.5 }, covered: [schema.newCovered({ h_nom: 1, p_allow: 30, p_unit: 'psi' })] }),
    pad({ item_no: 'OK', gap_design: { nom: 0.5 }, covered: [schema.newCovered({ h_nom: 1, p_allow: 100, p_unit: 'psi' })] }),
    pad({ item_no: 'OLD', status: 'obsolete', gap_design: { nom: 0.95 } }),   // obsolete: not counted
  ];
  const s = calc.projectStats(p, db);
  assert.deepEqual([s.comp_fail, s.comp_warn, s.comp_issues], [1, 1, 2]);
});
