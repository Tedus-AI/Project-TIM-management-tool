'use strict';
// TIM 備料: quantities, routing to factory / suppliers, recipients, wording and the .eml draft.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const prep = require('../../js/core/prep.js');

function fixture() {
  const db = schema.newDb();
  const p = schema.newProject({ name: 'DEMO-RRU-A', stage: 'EVT' });
  const [bot, top] = p.locations;
  const mk = (loc, f) => { const it = schema.newItem(Object.assign({ location_id: loc.id }, f)); p.items.push(it); return it; };
  const a1 = mk(top, { item_no: 'A1', vendor: 'Vendor-A', model: 'GF-750', qty: 2, delta_pn: 'DEMO-1001-01', size: { l: 40, w: 30, t: 1.5 } });
  const b1 = mk(bot, { item_no: 'B1', vendor: 'vendor-b', model: 'GF-300', tim_type: 'gap_filler', qty: 4, dispense: { amount: 0.8, unit: 'g', blt: null } });
  const c1 = mk(bot, { item_no: 'C1', vendor: 'Vendor-C', model: 'TP-200', qty: 3 });
  const d1 = mk(bot, { item_no: 'D1', vendor: 'Vendor-D', model: 'TP-X1', qty: 1 });
  const ob = mk(bot, { item_no: 'X1', vendor: 'Vendor-A', model: 'GF-750', qty: 9, status: 'obsolete' });
  const f1 = schema.newContactOrg({ kind: 'factory', name: '甲廠', is_default: true, people: [
    schema.newContactPerson({ name: '王小明', email: 'wang@factory.example', role: 'to' }),
    schema.newContactPerson({ name: '林佳慧', email: 'lin@factory.example', role: 'cc' })] });
  const f2 = schema.newContactOrg({ kind: 'factory', name: '丁廠', people: [schema.newContactPerson({ name: 'Ding', email: 'ding@factory.example' })] });
  const s1 = schema.newContactOrg({ kind: 'supplier', name: '乙公司', brands: ['Vendor-B', 'Vendor-C'], people: [
    schema.newContactPerson({ name: '李大華', email: 'li@vendor-b.example' }),
    schema.newContactPerson({ name: 'No mail', email: '' })] });
  [f1, f2, s1].forEach(o => { db.contacts[o.id] = o; });
  db.projects[p.id] = p;
  const pr = schema.newPrep({ no: 'PR-01', sets: 5, purpose: 'EVT 組裝' });
  return { db, p, a1, b1, c1, d1, ob, f1, f2, s1, pr };
}

test('quantities: one set from the TIM list, × sets, pieces rounded up, dispensed TIM in g to 0.1', () => {
  const { a1, b1, c1 } = fixture();
  assert.deepEqual(prep.perSet(a1, null), { v: 2, unit: 'pcs' });
  assert.deepEqual(prep.perSet(b1, null), { v: 3.2, unit: 'g' });             // 0.8 g × 4 dispenses
  assert.equal(prep.totalOf({ v: 2, unit: 'pcs' }, 5), 10);
  assert.equal(prep.totalOf({ v: 0.5, unit: 'pcs' }, 3), 2);
  assert.equal(prep.totalOf({ v: 3.2, unit: 'g' }, 3), 9.6);
  assert.equal(prep.totalOf({ v: 0.33, unit: 'cc' }, 1), 0.4);
  assert.equal(prep.totalOf({ v: null, unit: 'pcs' }, 3), null);
  assert.equal(prep.qtyText(9.6, 'g'), '9.6 g');
  assert.equal(prep.qtyText(10, 'pcs'), '10');
  c1.qty = null;
  assert.equal(prep.perSet(c1, null).v, null);
});

test('routing: Delta P/N → default factory, otherwise the supplier of the brand; unknown brands are flagged; one email per organisation', () => {
  const { db, p, a1, b1, c1, d1, f1, f2, s1, pr } = fixture();
  let gs = prep.groups(p, db, pr);
  assert.deepEqual(gs.map(g => g.key), [f1.id, s1.id, 'none:s:VENDOR-D']);
  assert.deepEqual(gs[0].lines.map(l => l.it.item_no), ['A1']);
  assert.deepEqual(gs[1].lines.map(l => l.it.item_no), ['B1', 'C1'], 'brand match is case-insensitive; one email for both brands');
  assert.equal(gs[1].lines[0].total, 16, '3.2 g × 5 sets');
  assert.equal(gs[2].org, null);
  assert.equal(gs[2].vendor, 'Vendor-D');
  assert.ok(!gs.some(g => g.lines.some(l => l.it.item_no === 'X1')), 'obsolete items are not prepared');
  // switch the source of one item, untick another, route the factory items to another factory
  pr.lines[c1.id] = { src: 'factory' };
  pr.lines[d1.id] = { off: true };
  pr.route = { factory: f2.id };
  gs = prep.groups(p, db, pr);
  assert.deepEqual(gs.map(g => g.key), [f2.id, s1.id]);
  assert.deepEqual(gs[0].lines.map(l => l.it.item_no), ['C1', 'A1'], 'TIM-list order: Bottom Case first');
  assert.equal(prep.sourceOf(pr, a1), 'factory');
  assert.equal(prep.sourceOf(pr, b1), 'supplier');
  // no factory at all → a group without organisation
  delete db.contacts[f1.id]; delete db.contacts[f2.id];
  assert.equal(prep.groups(p, db, pr)[1].key, 'none:factory');
});

test('recipients: people by role + our colleagues as CC, changed by hand per organisation; people without email are skipped', () => {
  const { f1, s1, pr } = fixture();
  const ours = [{ name: 'ME Owner', email: 'me@example.test' }];
  let r = prep.recipients(f1, pr, ours, [{ name: 'Other', email: 'other@example.test' }, { name: '王', email: 'WANG@factory.example' }]);
  assert.deepEqual(r.to.map(p => p.email), ['wang@factory.example']);
  assert.deepEqual(r.cc.map(p => p.email), ['lin@factory.example', 'me@example.test']);
  assert.equal(r.people.length, 4, 'known colleagues listed once (email compared case-insensitively)');
  pr.pick[f1.id] = { to: ['wang@factory.example', 'other@example.test'], cc: [] };
  r = prep.recipients(f1, pr, ours, [{ name: 'Other', email: 'other@example.test' }]);
  assert.deepEqual(r.to.map(p => p.email), ['wang@factory.example', 'other@example.test']);
  assert.deepEqual(r.cc, []);
  assert.deepEqual(prep.recipients(s1, pr, [], []).to.map(p => p.name), ['李大華']);
});

test('wording: need date, subject, intro and file name', () => {
  const today = new Date(2026, 9, 19);              // Mon 2026/10/19
  const s = schema.newDb().settings;
  assert.equal(prep.needText({ mode: 'days', days: 7 }, s, today), '7 天內（2026/10/26（一） 前）');
  assert.equal(prep.needShort({ mode: 'days', days: 7 }, s, today), '7 天內（10/26 前）');
  assert.equal(prep.needText({ mode: 'date', date: '2026-11-03' }, s, today), '2026/11/03（二） 前');
  assert.equal(prep.needText({ mode: 'date', date: '' }, s, today), '');
  assert.equal(prep.needText({ mode: 'asap' }, s, today), '越快越好');
  assert.equal(prep.needText({ mode: 'proc' }, s, today), '依對方作業流程');
  assert.equal(prep.needText({ mode: 'proc' }, Object.assign({}, s, { prep_proc: '依工廠排程' }), today), '依工廠排程');

  const { db, p, pr } = fixture();
  const gs = prep.groups(p, db, pr);
  const cellOf = (k, l) => ({ item_no: l.it.item_no, vendor: l.it.vendor, model: l.it.model, k: '', size: '', used_on: '', delta_pn: l.it.delta_pn })[k];
  const t = prep.table(gs[1], prep.colsOf(pr, s), cellOf);
  assert.deepEqual(t.head, ['LOC', '#', 'ITEM', 'USED ON', 'VENDOR', 'Model', 'k (W/m·K)', 'SIZE', "Q'ty / 套", 'Delta PN', '總數量']);
  assert.deepEqual(t.rows[0], ['Bottom Case', '1', 'B1', '', 'vendor-b', 'GF-300', '', '', '3.2 g', '', '16 g']);
  assert.equal(t.num[t.head.length - 1], true);
  const m = prep.compose({ project: p, prep: pr, group: gs[1], table: t, recips: prep.recipients(gs[1].org, pr, [], []), settings: s, today, sender: 'Tester' });
  assert.equal(m.subject, '【TIM 備料】DEMO-RRU-A EVT｜5 套｜需求：7 天內（10/26 前）');
  assert.equal(m.greet, '李大華 您好：');
  assert.equal(m.intro, 'DEMO-RRU-A（EVT）EVT 組裝需要以下 TIM 材料，麻煩協助提供，謝謝。');
  assert.equal(m.file, 'DEMO-RRU-A_EVT_TIM備料_20261019_乙公司.xlsx');
  const fm = prep.compose({ project: p, prep: Object.assign({}, pr, { need: { mode: 'asap' } }), group: gs[0], table: prep.table(gs[0], ['no', 'qty'], cellOf), recips: { to: [], cc: [] }, settings: s, today });
  assert.match(fm.intro, /麻煩協助備料/);
  assert.match(fm.subject, /越快越好（急件）$/);
  assert.equal(fm.greet, '您好：');
  // columns: own choice → settings default → built-in; # and Q'ty always present
  assert.deepEqual(prep.colsOf({ cols: ['item_no', 'vendor_pn'] }, s), ['item_no', 'no', 'vendor_pn', 'qty']);
  assert.deepEqual(prep.colsOf({ cols: null }, Object.assign({}, s, { prep_cols: ['no', 'item_no', 'qty'] })), ['no', 'item_no', 'qty']);
  assert.deepEqual(prep.colsOf({ cols: null }, s), prep.DEFAULT_COLS);
  assert.equal(prep.nextNo({ preps: [{ no: 'PR-01' }, { no: 'PR-09' }] }), 'PR-10');
  assert.equal(prep.nextNo({ preps: [] }), 'PR-01');
});

test('.eml: unsent draft with encoded headers, HTML table and the Excel attachment; mailto fallback', () => {
  const { db, p, pr } = fixture();
  const today = new Date(2026, 9, 19);
  const s = schema.newDb().settings;
  const g = prep.groups(p, db, pr)[0];
  const t = prep.table(g, ['no', 'item_no', 'qty'], (k, l) => l.it.item_no);
  const recips = prep.recipients(g.org, pr, [{ name: 'Me <ME>', email: 'me@example.test' }], []);
  const m = prep.compose({ project: p, prep: pr, group: g, table: t, recips, settings: s, today, sender: 'Tester' });
  const html = prep.bodyHtml(m);
  assert.match(html, /<th[^>]*>總數量<\/th>/);
  assert.match(html, /<td[^>]*>A1<\/td>/);
  const xlsx = Uint8Array.from([80, 75, 3, 4, 0, 255, 1]);
  const eml = prep.buildEml({ to: m.to, cc: m.cc, subject: m.subject, html, text: prep.bodyText(m), attachments: [{ name: m.file, type: prep.XLSX_TYPE, data: xlsx }] });
  const head = eml.slice(0, eml.indexOf('\r\n\r\n'));
  assert.match(head, /^X-Unsent: 1\r\n/);
  assert.ok(!/[^\x00-\x7f]/.test(eml), 'all ASCII (encoded words / base64)');
  assert.ok(!/(^|[^\r])\n/.test(eml), 'CRLF line ends only');
  assert.ok(eml.split('\r\n').every(l => l.length <= 998), 'no line over the RFC 5322 limit');
  const dec = w => Buffer.from(w, 'base64').toString('utf8');
  const words = h => (h.match(/=\?UTF-8\?B\?([^?]+)\?=/g) || []).map(x => dec(x.slice(10, -2))).join('');
  const field = name => { const m2 = head.match(new RegExp('^' + name + ': ((?:.*)(?:\\r\\n .*)*)', 'm')); return m2 ? m2[1] : ''; };
  assert.equal(words(field('Subject')), m.subject);
  assert.match(field('To'), /<wang@factory\.example>/);
  assert.equal(words(field('To')), '王小明');
  assert.match(field('Cc'), /"Me <ME>" <me@example\.test>/);
  // parts: text, html (base64 utf-8), attachment bytes unchanged
  const b64parts = eml.split(/\r\n\r\n/).slice(1).map(x => x.split('\r\n--')[0]);
  const htmlPart = b64parts.map(x => { try { return dec(x.replace(/\r\n/g, '')); } catch (e) { return ''; } }).find(x => x.startsWith('<!DOCTYPE html>'));
  assert.equal(htmlPart, html);
  assert.match(eml, /Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
  const att = eml.split('Content-Transfer-Encoding: base64\r\n\r\n').pop().split('\r\n--')[0];
  assert.deepEqual(Uint8Array.from(Buffer.from(att, 'base64')), xlsx);
  assert.equal(prep.emlName(m), 'TIM備料_DEMO-RRU-A_EVT_甲廠.eml');
  // mailto: recipients separated by ';', the table dropped when too long
  const url = prep.mailtoUrl(m);
  assert.match(url, /^mailto:wang@factory\.example\?cc=lin%40factory\.example%3Bme%40example\.test&subject=/);
  assert.ok(decodeURIComponent(url).includes('A1'));
  const big = Object.assign({}, m, { rows: Array.from({ length: 80 }, (_, i) => ['' + i, 'ITEM-' + i, '1', '5']) });
  const u2 = prep.mailtoUrl(big);
  assert.ok(u2.length < 1900);
  assert.ok(!decodeURIComponent(u2).includes('ITEM-5'));
  assert.ok(decodeURIComponent(u2).includes('請手動附加'));
  // long subjects fold into several encoded words
  const long = prep.encodeWord('【TIM 備料】' + '很長的專案名稱'.repeat(8));
  assert.ok(long.split('\r\n ').length > 2);
  assert.ok(long.split('\r\n ').every(w => w.length <= 75));
  assert.equal(prep.base64(Uint8Array.from([1, 2])), Buffer.from([1, 2]).toString('base64'));
});
