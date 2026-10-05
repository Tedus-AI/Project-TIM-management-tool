'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../../js/core/parse.js');
const util = require('../../js/core/util.js');

test('parseSize: Excel formats', () => {
  assert.deepEqual(parse.parseSize('51.5*9*3'), { ok: true, l: 51.5, w: 9, t: 3 });
  assert.deepEqual(parse.parseSize('20.6*20.6*3.5'), { ok: true, l: 20.6, w: 20.6, t: 3.5 });
  assert.deepEqual(parse.parseSize('51.5 x 9 x 3'), { ok: true, l: 51.5, w: 9, t: 3 });
  assert.deepEqual(parse.parseSize('51.5x9x3'), { ok: true, l: 51.5, w: 9, t: 3 });
  assert.deepEqual(parse.parseSize('51.5×9×3t'), { ok: true, l: 51.5, w: 9, t: 3 });
  assert.deepEqual(parse.parseSize('34 * 34 * 3.5 mm'), { ok: true, l: 34, w: 34, t: 3.5 });
  assert.deepEqual(parse.parseSize('５８＊２２＊３'), { ok: true, l: 58, w: 22, t: 3 });
  assert.deepEqual(parse.parseSize('8*8'), { ok: true, l: 8, w: 8, t: null });
  assert.deepEqual(parse.parseSize('T3.0'), { ok: true, l: null, w: null, t: 3 });
  assert.deepEqual(parse.parseSize(''), { ok: true, l: null, w: null, t: null });
  assert.equal(parse.parseSize('abc').ok, false);
  assert.equal(parse.parseSize('1*2*3*4').ok, false);
});

test('formatSize round-trips', () => {
  assert.equal(parse.formatSize({ l: 51.5, w: 9, t: 3 }), '51.5*9*3');
  assert.equal(parse.formatSize({ l: 8, w: 8, t: null }), '8*8');
  assert.equal(parse.formatSize({ l: null, w: null, t: 2 }), 'T2');
  assert.equal(parse.formatSize({ l: null, w: null, t: null }), '');
});

test('parseCovered: multiplier forms', () => {
  assert.deepEqual(parse.parseCovered('LDO-A*2,BUCK-B*4,PMIC-C*2'),
    [{ part: 'LDO-A', qty: 2 }, { part: 'BUCK-B', qty: 4 }, { part: 'PMIC-C', qty: 2 }]);
  assert.deepEqual(parse.parseCovered('8V19N492,ZL30793,8SLVP1208'),
    [{ part: '8V19N492', qty: 1 }, { part: 'ZL30793', qty: 1 }, { part: '8SLVP1208', qty: 1 }]);
  assert.deepEqual(parse.parseCovered('E48SK12038RNAH,DDR16G*3'),
    [{ part: 'E48SK12038RNAH', qty: 1 }, { part: 'DDR16G', qty: 3 }]);
  assert.deepEqual(parse.parseCovered('BUCK-B x4； FPGA(2)'), [{ part: 'BUCK-B', qty: 4 }, { part: 'FPGA', qty: 2 }]);
  assert.deepEqual(parse.parseCovered('2*LDO-A'), [{ part: 'LDO-A', qty: 2 }]);
  assert.deepEqual(parse.parseCovered(''), []);
});

test('mergeCovered keeps extra fields on rename and qty change', () => {
  const ex = [{ id: 'a', part: 'BUCK-B', qty: 4, power_w: 1.2, refdes: 'U1' }, { id: 'b', part: 'LDO-A', qty: 2, power_w: 0.5 }];
  const renamed = parse.mergeCovered(ex, [{ part: 'BUCK-B2', qty: 4 }, { part: 'LDO-A', qty: 3 }]);
  assert.equal(renamed[0].id, 'a'); assert.equal(renamed[0].part, 'BUCK-B2'); assert.equal(renamed[0].power_w, 1.2);
  assert.equal(renamed[1].qty, 3); assert.equal(renamed[1].power_w, 0.5);
  const removed = parse.mergeCovered(ex, [{ part: 'LDO-A', qty: 2 }]);
  assert.equal(removed.length, 1); assert.equal(removed[0].id, 'b');
  const added = parse.mergeCovered(ex, [{ part: 'LDO-A', qty: 2 }, { part: 'BUCK-B', qty: 4 }, { part: 'NEW1', qty: 1 }]);
  assert.equal(added.length, 3); assert.equal(added[1].id, 'a'); assert.ok(added[2].id && added[2].id !== 'a');
});

test('parseUsedOn normalises categories', () => {
  assert.deepEqual(parse.parseUsedOn('PWR/DDR'), ['PWR', 'DDR']);
  assert.deepEqual(parse.parseUsedOn('DIGI'), ['DIGI']);
  assert.deepEqual(parse.parseUsedOn('Digital, rf'), ['DIGI', 'RF']);
  assert.deepEqual(parse.parseUsedOn('RF/RF'), ['RF']);
  assert.deepEqual(parse.parseUsedOn(''), []);
});

test('parseSecondSource', () => {
  const a = parse.parseSecondSource('Vendor-A only source');
  assert.equal(a.single, true); assert.equal(a.sources.length, 0); assert.equal(a.note, 'Vendor-A only source');
  const b = parse.parseSecondSource('short:甲廠,long:Vendor-C');
  assert.equal(b.single, false);
  assert.deepEqual(b.sources.map(s => [s.vendor, s.note]), [['甲廠', 'short'], ['Vendor-C', 'long']]);
  assert.equal(b.note, 'short:甲廠,long:Vendor-C');
  const c = parse.parseSecondSource('Vendor-C');
  assert.deepEqual(c.sources.map(s => s.vendor), ['Vendor-C']); assert.equal(c.note, '');
  const d = parse.parseSecondSource('Vendor-C TP-800; Vendor-D');
  assert.deepEqual(d.sources.map(s => [s.vendor, s.model]), [['Vendor-C', 'TP-800'], ['Vendor-D', '']]);
  assert.equal(parse.parseSecondSource('').sources.length, 0);
});

test('formatSources / mergeSources', () => {
  assert.equal(parse.formatSources({ sources: [{ vendor: '甲廠', model: '', note: 'short' }, { vendor: 'Vendor-C', model: 'TP-800', note: '' }] }), '甲廠(short), Vendor-C TP-800');
  assert.equal(parse.formatSources({ sources: [], sourcing_note: 'Vendor-A only source' }), 'Vendor-A only source');
  const merged = parse.mergeSources([{ id: 's1', vendor: 'Vendor-C', status: 'qualified', mpn: 'X1' }], [{ vendor: 'vendor-c', model: '' }, { vendor: 'Vendor-D', model: '' }]);
  assert.equal(merged[0].id, 's1'); assert.equal(merged[0].status, 'qualified');
  assert.equal(merged[1].vendor, 'Vendor-D'); assert.equal(merged[1].status, 'unknown');
});

test('parseTsv handles quotes, tabs and newlines', () => {
  assert.deepEqual(parse.parseTsv('a\tb\nc\td\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(parse.parseTsv('"x\ny"\t"he said ""hi"""\n1\t2'), [['x\ny', 'he said "hi"'], ['1', '2']]);
  assert.deepEqual(parse.parseTsv('single'), [['single']]);
  const rows = [['a\tb', 'c'], ['"q"', '']];
  assert.deepEqual(parse.parseTsv(parse.toTsv(rows)), rows);
});

test('detectHeader finds the Excel header row', () => {
  const m = [
    ['TIM list', '', ''],
    ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source'],
    ['Bottom Case', 'A1-1', 'RF', 'Vendor-A', 'X', '51.5*9*3', '4', '123', 'A*2', 'only source'],
  ];
  const h = parse.detectHeader(m);
  assert.equal(h.row, 1);
  assert.deepEqual(h.map, { location: 0, item_no: 1, used_on: 2, vendor: 3, model: 4, size: 5, qty: 6, delta_pn: 7, covered: 8, second_source: 9 });
  assert.equal(parse.detectHeader([['a', 'b'], ['c', 'd']]), null);
  assert.equal(parse.matchHeader('台達料號'), 'delta_pn');
  assert.equal(parse.matchHeader('數量'), 'qty');
});

test('util helpers', () => {
  assert.equal(util.num('1,234.5'), 1234.5);
  assert.equal(util.num('４ pcs'), 4);
  assert.equal(util.num(''), null);
  assert.equal(util.num('abc'), null);
  assert.equal(util.fmt(3.14159, 2), '3.14');
  assert.equal(util.fmt(null), '');
  assert.deepEqual(['A10', 'A2', 'A1-2', 'A1-1', 'B1', 'A1'].sort(util.naturalCompare), ['A1', 'A1-1', 'A1-2', 'A2', 'A10', 'B1']);
  assert.equal(util.nextItemNo(['A1-1', 'A1-2', 'A2', 'A8']), 'A9');
  assert.equal(util.nextItemNo([]), 'A1');
  assert.equal(util.nextVariantNo('A1-2', ['A1-1', 'A1-2']), 'A1-3');
  assert.equal(util.nextVariantNo('A5', ['A5']), 'A5-1');
  assert.equal(util.escapeHtml('<a href="x">\'&'), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  assert.equal(util.textOn('#00B050'), '#0F1B2D');
  assert.equal(util.textOn('#021B3A'), '#FFFFFF');
});

test('rowsToItems: merged location carry-down, parsing, stop at drawings area', () => {
  const m = [
    ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source'],
    ['Bottom Case', 'A1-1', 'RF', 'VendorA', 'AbsorbPad AX', '51.5*9*3', '4', 'DEMO-1', 'PAD-2601', 'VendorA only source'],
    ['', 'A4', 'RF', 'VendorC', 'TP-800', '6*6*2.5', '8', 'DEMO-5', 'LDO*2,BUCK*4,BUCK2*2', 'short:LocalCo,long:VendorE'],
    ['Top Case', 'A8', 'PWR/DDR', 'VendorB', 'GF-750', '58*22*3', '4', 'DEMO-9', 'BRICK,DDR4*3', 'VendorC'],
    ['', 'A9', '', 'VendorB', 'GF-750', 'odd size', 'x', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['Bottom case', '', '', '', '', '', '', '', '', ''],
  ];
  const h = parse.detectHeader(m);
  const rows = parse.rowsToItems(m, h.row, h.map, { sourceStatus: 'qualified' });
  assert.deepEqual(rows.map(r => [r.location, r.fields.item_no]), [['Bottom Case', 'A1-1'], ['Bottom Case', 'A4'], ['Top Case', 'A8'], ['Top Case', 'A9']]);
  assert.equal(rows[0].fields.tim_type, 'absorber');
  assert.deepEqual(rows[0].fields.size, { l: 51.5, w: 9, t: 3 });
  assert.equal(rows[0].fields.sources.length, 0);
  assert.equal(rows[0].fields.sourcing_note, 'VendorA only source');
  assert.equal(rows[1].fields.covered.length, 3);
  assert.deepEqual(rows[1].fields.sources.map(s => [s.vendor, s.note, s.status]), [['LocalCo', 'short', 'qualified'], ['VendorE', 'long', 'qualified']]);
  assert.deepEqual(rows[2].fields.used_on, ['PWR', 'DDR']);
  assert.equal(rows[3].warnings.length, 2);
  assert.match(rows[3].fields.note, /odd size/);
});

test('2nd source display text round-trips through the parser', () => {
  const item = { sources: [{ vendor: '甲廠', model: '', note: 'short' }, { vendor: 'Vendor-C', model: 'TP-800', note: 'long' }] };
  const text = parse.formatSources(item);
  assert.equal(text, '甲廠(short), Vendor-C TP-800(long)');
  const back = parse.parseSecondSource(text);
  assert.deepEqual(back.sources.map(s => [s.vendor, s.model, s.note]), [['甲廠', '', 'short'], ['Vendor-C', 'TP-800', 'long']]);
});

test('hasKColumn: rows from the tool\'s own Excel export carry k between Model and Size, the existing Excel does not', () => {
  // existing Excel: Item, Used On, Vendor, Model, Size, Q'ty …  (k slot = index 4)
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'AbsorbPad AX', '51.5*9*3', '4']], 4), false);
  // export: … Model, k, Size …
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'AbsorbPad AX', '1.6', '51.5*9*3', '4']], 4), true);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'Pad', '', '10x10x1.5', '2']], 4), true, 'no k on file: empty cell');
  // a size where k would be in any row → no k column; no size after an empty cell → no k column
  assert.equal(parse.hasKColumn([['A1', 'RF', 'V', 'M', '1.6', '5*5*1'], ['A2', 'RF', 'V', 'M', '6*6*2']], 4), false);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'V', 'M', '', '4', 'PN']], 4), false);
  assert.equal(parse.hasKColumn([], 4), false);
  // every Size form the export writes: dispensed amount, thickness only (and the same forms in the k slot = no k)
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'GEL-30', '3.5', '2 g', '1']], 4), true);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'GEL-30', '', '1.5 cc', '1']], 4), true);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'Pad', '1.6', 'T3', '2']], 4), true);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'GEL-30', '2 g', '1', 'PN']], 4), false);
  assert.equal(parse.hasKColumn([['A1', 'RF', 'Vendor-A', 'Pad', 'T3', '2', 'PN']], 4), false);
  // no Size anywhere: a full exported row (Item … 2nd source = 10 cells from Item) is one cell wider
  const full = ['A1', 'RF', 'Vendor-A', 'Pad', '1.6', '', '2', 'PN', 'U1', 'Vendor-B'];
  assert.equal(parse.hasKColumn([full], 4, 10), true);
  assert.equal(parse.hasKColumn([full.slice(0, 4).concat(full.slice(5))], 4, 10), false, 'existing Excel row, 9 cells');
  assert.equal(parse.hasKColumn([['A1', 'RF', 'V', 'M', '', '2', 'PN', 'U1', 'Vendor-B', 'extra']], 4, 10), false, 'Q\'ty after an empty Size');
});
