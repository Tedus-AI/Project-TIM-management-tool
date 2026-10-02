'use strict';
// 匯入材料: tim-material JSON from an AI reply → normalised fields → merge plan.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const mi = require('../../js/core/matimport.js');

const reply = '好的，以下是整理結果：\n```json\n' + JSON.stringify({
  format: 'tim-material', version: 1,
  materials: [
    { vendor: 'Vendor-B', model: 'GF-750', tim_type: 'Gap Pad', k: '7.5 W/m·K', k_method: 'ASTM D5470 (modified)',
      hardness: 45, hardness_scale: 'Shore OO', temp_min: '−40 °C', temp_max: 200, ul94: 'V0', silicone: 'Silicone-based',
      rohs: 'Compliant', halogen_free: 'Non-compliant', thickness_options: '0.5–5.0 mm', color: null, dk: '7.0 / 6.8',
      flame_rating_extra: 'x', evidence: { k: 'p.1 7.5 W/m-K', temp_min: 'p.1 -40 to 200 °C', bogus: 'y' } },
    { vendor: 'Vendor-C', model: 'TP-800', tim_type: 'grease', k: 3.2 },
    { color: 'blue' },
  ],
}) + '\n```\n如有疑問請告訴我。';

test('parse: JSON inside a chatty AI reply; units, synonyms, booleans normalised; unknown keys reported', () => {
  const r = mi.parse(reply);
  assert.equal(r.entries.length, 2, 'entry without vendor / model dropped');
  assert.ok(r.warnings.some(w => /第 3 筆/.test(w)));
  const a = r.entries[0].fields;
  assert.deepEqual(
    [a.tim_type, a.k, a.k_method, a.hardness_scale, a.temp_min, a.temp_max, a.ul94, a.silicone, a.rohs, a.halogen_free],
    ['pad', 7.5, 'ASTM D5470', 'Shore 00', -40, 200, 'V-0', 'silicone', true, false]);
  assert.equal(a.color, undefined, 'null stays empty');
  assert.equal(a.dk, 7, 'first number taken…');
  assert.ok(r.entries[0].warnings.some(w => /介電常數 Dk.*只取第一個/.test(w)), '…with a warning');
  assert.ok(r.entries[0].warnings.some(w => /flame_rating_extra/.test(w)), 'unknown key reported');
  assert.deepEqual(Object.keys(r.entries[0].evidence).sort(), ['k', 'temp_min']);
  assert.equal(r.entries[1].fields.tim_type, 'grease');
});

test('parse: bare array, single object, broken input', () => {
  assert.equal(mi.parse('[{"vendor":"Vendor-A","model":"X"}]').entries.length, 1);
  assert.equal(mi.parse('{"vendor":"Vendor-A","model":"X","k":"abc"}').entries[0].warnings[0].includes('不是數字'), true);
  assert.throws(() => mi.parse('這份規格書看不清楚'), /JSON/);
  assert.throws(() => mi.parse('{"materials":[{"note":"x"}]}'), /沒有可匯入/);
});

test('plan: new vs existing (same vendor + model, any case); fill only empties, overwrite replaces', () => {
  const db = schema.newDb();
  const m = schema.newMaterial({ vendor: 'vendor-b', model: 'gf-750', k: 7.0, hardness: null, note: 'kept' });
  db.materials[m.id] = m;
  const p = mi.parse(reply);
  const rows = mi.plan(p, db.materials);
  assert.deepEqual(rows.map(r => r.action), ['fill', 'new']);
  assert.equal(rows[0].matchId, m.id);
  const fill = mi.changesFor(rows[0].entry, m, 'fill').map(c => c.key);
  assert.ok(fill.includes('hardness') && !fill.includes('k'), 'k already set → not touched when filling');
  const over = mi.changesFor(rows[0].entry, m, 'overwrite');
  assert.deepEqual(over.find(c => c.key === 'k'), { key: 'k', label: '熱傳導係數 k', unit: 'W/m·K', from: 7, to: 7.5 });
  assert.equal(mi.changesFor(rows[0].entry, m, 'skip').length, 0);
});

test('prompt and example agree with the parser', () => {
  const text = mi.prompt();
  mi.FIELDS.forEach(f => assert.ok(text.includes('- ' + f.key + '：'), f.key + ' explained'));
  const r = mi.parse(JSON.stringify(mi.example()));
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].warnings.length, 0, 'the example imports without warnings');
});

test('劑型 (parts): only for Gap Filler / Thermal Putty; synonyms; follows the type when merging', () => {
  assert.deepEqual(schema.TIM_TYPES.filter(t => schema.hasParts(t.v)).map(t => t.v), ['gap_filler', 'putty']);
  const r = mi.parse(JSON.stringify({ format: 'tim-material', version: 1, materials: [
    { vendor: 'Vendor-C', model: 'GF-D1', tim_type: 'Gap Filler', parts: '1-Part Dispensable' },
    { vendor: 'Vendor-C', model: 'GF-D2', tim_type: 'gap_filler', parts: '2K (A/B 1:1)' },
    { vendor: 'Vendor-C', model: 'TP-P2', tim_type: 'putty', parts: 'two_part' },
    { vendor: 'Vendor-C', model: 'TP-800', tim_type: 'grease', parts: 'one_part' },
  ] }));
  assert.deepEqual(r.entries.map(e => e.fields.parts), ['one_part', 'two_part', 'two_part', undefined]);
  const pf = mi.FIELDS.find(f => f.key === 'parts');
  assert.deepEqual(['One-component', 'Two-component', '單液', '雙劑型', 'single', 2, 'None', 'phone', 'N/A'].map(v => mi.enumValue(pf, v)),
    ['one_part', 'two_part', 'one_part', 'two_part', 'one_part', 'two_part', undefined, undefined, undefined]);
  assert.ok(r.entries[3].warnings.some(w => /劑型.*Gap Filler \/ Thermal Putty.*未匯入/.test(w)), 'grease: dropped with a warning');
  assert.equal(schema.materialTypeText(Object.assign(schema.newMaterial(), r.entries[1].fields)), 'Gap Filler · 雙劑');
  assert.equal(schema.materialTypeText(schema.newMaterial({ tim_type: 'gap_filler' })), 'Gap Filler', 'not chosen yet → type only');

  // existing Thermal Pad + fill: the type stays pad, so 劑型 is not offered as a change
  const pad = schema.newMaterial({ vendor: 'Vendor-C', model: 'GF-D1' });
  assert.ok(!mi.changesFor(r.entries[0], pad, 'fill').some(c => c.key === 'parts'));
  assert.deepEqual(mi.changesFor(r.entries[0], pad, 'overwrite').filter(c => /tim_type|parts/.test(c.key)).map(c => [c.key, c.to]),
    [['tim_type', 'gap_filler'], ['parts', 'one_part']]);
  // existing two-part gap filler overwritten as a grease → 劑型 cleared
  const gf = schema.newMaterial({ vendor: 'Vendor-C', model: 'TP-800', tim_type: 'gap_filler', parts: 'two_part' });
  assert.deepEqual(mi.changesFor(r.entries[3], gf, 'overwrite').find(c => c.key === 'parts'), { key: 'parts', label: '劑型', unit: '', from: 'two_part', to: '' });
  // loading: a stray 劑型 on another type, or an unknown value, is dropped
  assert.equal(schema.normalizeMaterial({ tim_type: 'pad', parts: 'one_part' }).parts, '');
  assert.equal(schema.normalizeMaterial({ tim_type: 'putty', parts: 'three' }).parts, '');
  assert.equal(schema.normalizeMaterial({ tim_type: 'putty', parts: 'one_part' }).parts, 'one_part');
});
