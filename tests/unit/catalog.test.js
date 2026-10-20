'use strict';
// TIM 型號目錄 (tim_catalog.json): the material library as the other thermal tools read it.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const catalog = require('../../js/core/catalog.js');

function db() {
  const d = schema.newDb();
  d.rev = 12;
  const add = f => { const m = schema.newMaterial(f); d.materials[m.id] = m; return m; };
  return {
    d,
    pad: add({ vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7.5, k_method: 'ASTM D5470', hardness: 35, thickness_options: '0.5~5.0', price_ref: 'USD 9.9', note: 'internal note' }),
    putty: add({ vendor: 'Vendor-A', model: 'TP-910', tim_type: 'gap_filler', parts: 'two_part', k: 9.1 }),
    grease: add({ vendor: 'Vendor-C', model: 'TG-38', tim_type: 'grease', k: 3.8 }),
    pcm: add({ vendor: 'Vendor-D', model: 'PCM-45', tim_type: 'pcm', k: 4.5 }),
    blank: add({ vendor: 'Vendor-D', model: '  ', tim_type: 'pad' }),
  };
}

test('catalog: material properties only, families for the calculation tools, sorted', () => {
  const { d, pad, putty } = db();
  const c = catalog.build(d, { at: '2026-10-20T00:00:00Z', by: 'tester' });
  assert.equal(c.format, 'tim-catalog');
  assert.equal(c.version, 1);
  assert.equal(c.db_rev, 12);
  assert.deepEqual(c.materials.map(m => m.model), ['TP-910', 'GF-750', 'TG-38', 'PCM-45'], 'by vendor / model; a material without a model left out');
  const p = c.materials.find(m => m.id === pad.id);
  assert.deepEqual([p.vendor, p.family, p.family_exact, p.k, p.k_method, p.hardness, p.hardness_scale, p.type_label], ['Vendor-B', 'Pad', true, 7.5, 'ASTM D5470', 35, 'Shore 00', 'Thermal Pad']);
  assert.ok(!('price_ref' in p) && !('note' in p) && !('datasheets' in p) && !('pressure_curves' in p), 'no price, notes, files or curves');
  const q = c.materials.find(m => m.id === putty.id);
  assert.deepEqual([q.family, q.parts], ['Putty', '雙劑型（2-part）']);
  assert.deepEqual(['grease', 'pcm', 'graphite', 'tape', 'other', 'gel', 'absorber'].map(t => [catalog.familyOf(t).family, catalog.familyOf(t).exact]),
    [['Grease', true], ['Grease', false], ['Pad', false], ['Pad', false], ['Pad', false], ['Putty', true], ['Pad', true]]);
  assert.ok(!JSON.stringify(c).includes('projects'), 'no project data');
});

test('signature ignores time stamps; parse accepts only a catalog', () => {
  const { d, pad } = db();
  const a = catalog.build(d, { at: '2026-10-20T00:00:00Z' });
  const b = catalog.build(d, { at: '2026-10-21T00:00:00Z' });
  assert.equal(catalog.signature(a), catalog.signature(b));
  pad.k = 8;
  assert.notEqual(catalog.signature(catalog.build(d)), catalog.signature(a), 'a k change is a change');
  assert.deepEqual(catalog.parse(JSON.stringify(a)).materials.length, 4);
  assert.equal(catalog.parse('{"schema":"tim-db"}'), null);
  assert.equal(catalog.parse('not json'), null);
});
