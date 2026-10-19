/* TIM Management Tool — TIM 備料 (material preparation) logic: quantities, who gets what, and the email.
 *
 * A 備料單 (project.preps[], schema.newPrep) takes the project's TIM list (one set = the usage of one unit),
 * a number of sets, a purpose and a need date. Each selected item goes to the factory (default: items with a
 * Delta P/N) or to the supplier of its brand (contacts shared by all projects, db.contacts). One email per
 * organisation: an .eml draft (X-Unsent: 1 → classic Outlook opens it as a new message, ready to send) with an
 * HTML table and the Excel list attached; a mailto: link is the fallback (no table, no attachment).
 * No DOM here: cell texts of TIM-list columns come from the UI (cellOf callback).
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const calc = isNode ? require('./calc.js') : root.TIM.calc;
  const mod = factory(util, schema, calc);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.prep = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema, calc) {
  'use strict';

  // ───────────────────────── columns ─────────────────────────
  // 'loc' and 'no' are 備料-only; every other key is a TIM-list column key (ui/bom.js buildColumns).
  const DEFAULT_COLS = ['loc', 'no', 'item_no', 'used_on', 'vendor', 'model', 'k', 'size', 'qty', 'delta_pn'];
  const FIXED_COLS = ['no', 'qty'];                       // always shown
  const LABELS = {
    loc: 'LOC', no: '#', item_no: 'ITEM', used_on: 'USED ON', vendor: 'VENDOR', model: 'Model', k: 'k (W/m·K)',
    size: 'SIZE', qty: "Q'ty / 套", delta_pn: 'Delta PN',
  };
  const NUM_COLS = ['no', 'k', 'qty', 'price', 'subtotal', 'moq', 'lead'];
  const TOTAL_LABEL = '總數量';

  /** Columns of a 備料單: its own choice, else the settings default, else the built-in one (fixed ones kept). */
  function colsOf(prep, settings) {
    const pick = (prep && prep.cols) || (settings && settings.prep_cols) || DEFAULT_COLS;
    const out = pick.filter((k, i) => typeof k === 'string' && pick.indexOf(k) === i);
    FIXED_COLS.forEach(k => { if (!out.includes(k)) out.splice(k === 'no' ? Math.min(1, out.length) : out.length, 0, k); });
    return out;
  }
  const labelOf = (key, fallback) => LABELS[key] || fallback || key;
  const isNum = key => NUM_COLS.includes(key);

  // ───────────────────────── quantities ─────────────────────────
  const fin = v => typeof v === 'number' && Number.isFinite(v);

  /** Items that can be prepared, in TIM-list order (obsolete ones left out). */
  function itemsOf(project) {
    return calc.orderedItems(project).filter(it => it.status !== 'obsolete');
  }

  /** Usage of one set: sheets in pcs (Q'ty); dispensed TIM in g / cc (amount × Q'ty, no Q'ty = one dispense). */
  function perSet(it, mat) {
    const eff = calc.effective(it, mat);
    if (schema.isDispense(eff.tim_type)) {
      const amt = it.dispense && it.dispense.amount;
      return { v: fin(amt) ? util.round(amt * (fin(it.qty) ? it.qty : 1), 4) : null, unit: (it.dispense && it.dispense.unit) || 'g' };
    }
    return { v: fin(it.qty) ? it.qty : null, unit: 'pcs' };
  }
  /** Total for n sets: pieces rounded up, g / cc rounded up to 0.1. */
  function totalOf(per, sets) {
    if (!per || !fin(per.v)) return null;
    const raw = per.v * (sets || 1);
    return per.unit === 'pcs' ? Math.ceil(raw - 1e-9) : Math.ceil(raw * 10 - 1e-6) / 10;
  }
  const qtyText = (v, unit) => (fin(v) ? util.fmt(v, 4) + (unit && unit !== 'pcs' ? ' ' + unit : '') : '');

  // ───────────────────────── who gets what ─────────────────────────
  const norm = s => util.toHalfWidth(String(s == null ? '' : s)).trim().replace(/\s+/g, ' ').toUpperCase();

  /** Default source of an item: it has a Delta P/N → our factory, otherwise the supplier of its brand. */
  const autoSource = it => (String(it.delta_pn || '').trim() ? 'factory' : 'supplier');
  const lineOf = (prep, it) => (prep && prep.lines && prep.lines[it.id]) || {};
  const sourceOf = (prep, it) => lineOf(prep, it).src || autoSource(it);
  const isOn = (prep, it) => !lineOf(prep, it).off;

  /** Organisations of a kind: the default factory first, then by name. */
  function orgsOf(db, kind) {
    return Object.values((db && db.contacts) || {}).filter(o => o.kind === kind)
      .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0) || util.naturalCompare(a.name, b.name));
  }
  /** Suppliers that carry a brand (listed in brands, or named like it). */
  function suppliersFor(db, vendor) {
    const v = norm(vendor);
    if (!v) return [];
    return orgsOf(db, 'supplier').filter(o => norm(o.name) === v || (o.brands || []).some(b => norm(b) === v));
  }

  /**
   * Where an item goes. base: the routing key ('factory' or 's:<BRAND>') — prep.route[base] picks another
   * organisation than the default; key: the email it is in (organisation id, or 'none:…' when nobody fits).
   */
  function targetOf(db, prep, it, mat) {
    const src = sourceOf(prep, it);
    const route = (prep && prep.route) || {};
    const all = (db && db.contacts) || {};
    if (src === 'factory') {
      const list = orgsOf(db, 'factory');
      const org = (route.factory && all[route.factory] && all[route.factory].kind === 'factory' ? all[route.factory] : null) || list[0] || null;
      return { src, base: 'factory', key: org ? org.id : 'none:factory', org, vendor: '', options: list };
    }
    const vendor = calc.effective(it, mat).vendor || '';
    const base = 's:' + norm(vendor);
    const list = suppliersFor(db, vendor);
    const r = route[base] && all[route[base]] && all[route[base]].kind === 'supplier' ? all[route[base]] : null;
    const org = r || list[0] || null;
    return { src, base, key: org ? org.id : 'none:' + base, org, vendor, options: list };
  }

  /**
   * One group per email, factory first, then suppliers by name, then the ones nobody fits.
   * → [{ key, org, kind: 'factory'|'supplier', vendor, bases: [routing keys], options, lines: [{ it, loc, mat, per, total }] }]
   */
  function groups(project, db, prep) {
    const map = {};
    const locs = {};
    (project.locations || []).forEach(l => { locs[l.id] = l; });
    itemsOf(project).forEach(it => {
      if (!isOn(prep, it)) return;
      const mat = calc.materialOf(db, it);
      const t = targetOf(db, prep, it, mat);
      const g = map[t.key] = map[t.key] || { key: t.key, org: t.org, kind: t.src, vendor: t.vendor, bases: [], options: t.options, lines: [] };
      if (!g.bases.includes(t.base)) g.bases.push(t.base);
      const per = perSet(it, mat);
      g.lines.push({ it, loc: locs[it.location_id] || null, mat, per, total: totalOf(per, prep && prep.sets) });
    });
    const rank = g => (g.org ? (g.kind === 'factory' ? 0 : 1) : 2);
    return Object.values(map).sort((a, b) => rank(a) - rank(b)
      || util.naturalCompare(a.org ? a.org.name : a.vendor, b.org ? b.org.name : b.vendor));
  }

  // ───────────────────────── recipients ─────────────────────────
  const person = p => ({ name: String(p.name || '').trim(), email: String(p.email || '').trim() });
  const hasMail = p => /\S+@\S+/.test(p.email || '');
  const sameMail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

  /**
   * Recipients of a group's email. Defaults: the organisation's people by role (收件者 / 副本) and `ours`
   * (our colleagues, e.g. the project's TH / ME owners) as 副本. prep.pick[org id] = { to: [emails], cc: [emails] }
   * once changed by hand. known: extra people that may be picked (members list).
   * → { to: [{ name, email }], cc: [...], people: [{ name, email, from: 'org'|'ours', role: 'to'|'cc'|'' }] }
   */
  function recipients(org, prep, ours, known) {
    const list = [];
    const add = (p, from, role) => {
      const q = person(p);
      if (!hasMail(q) || list.some(x => sameMail(x.email, q.email))) return;
      list.push(Object.assign(q, { from, role }));
    };
    ((org && org.people) || []).forEach(p => add(p, 'org', p.role === 'cc' ? 'cc' : 'to'));
    (ours || []).forEach(p => add(p, 'ours', 'cc'));
    (known || []).forEach(p => add(p, 'ours', ''));
    const pick = org && prep && prep.pick && prep.pick[org.id];
    if (pick) {
      list.forEach(p => {
        p.role = (pick.to || []).some(e => sameMail(e, p.email)) ? 'to' : (pick.cc || []).some(e => sameMail(e, p.email)) ? 'cc' : '';
      });
    }
    return {
      to: list.filter(p => p.role === 'to').map(person),
      cc: list.filter(p => p.role === 'cc').map(person),
      people: list,
    };
  }

  // ───────────────────────── wording ─────────────────────────
  const WD = '日一二三四五六';
  const p2 = n => (n < 10 ? '0' : '') + n;
  const day0 = d => { const x = new Date(d || Date.now()); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = day0(d); x.setDate(x.getDate() + n); return x; };
  const fmtLong = d => d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + '（' + WD[d.getDay()] + '）';
  const fmtShort = d => (d.getMonth() + 1) + '/' + d.getDate();
  const ymd = d => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
  function parseDate(s) {
    const m = String(s || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const procText = settings => String((settings && settings.prep_proc) || schema.DEFAULT_SETTINGS.prep_proc);

  /** Need date as written in the email ("7 天內（2026/10/26（一） 前）"); days count from `today` (the day the email is made). */
  function needText(need, settings, today) {
    need = need || {};
    if (need.mode === 'date') { const d = parseDate(need.date); return d ? fmtLong(d) + ' 前' : ''; }
    if (need.mode === 'asap') return '越快越好';
    if (need.mode === 'proc') return procText(settings);
    const n = fin(need.days) && need.days > 0 ? need.days : 7;
    return n + ' 天內（' + fmtLong(addDays(today, n)) + ' 前）';
  }
  /** Short form for the subject and the records list ("7 天內（10/26 前）"). */
  function needShort(need, settings, today) {
    need = need || {};
    if (need.mode === 'date') { const d = parseDate(need.date); return d ? fmtShort(d) + ' 前' : ''; }
    if (need.mode === 'asap') return '越快越好';
    if (need.mode === 'proc') return procText(settings);
    const n = fin(need.days) && need.days > 0 ? need.days : 7;
    return n + ' 天內（' + fmtShort(addDays(today, n)) + ' 前）';
  }

  /** Next 備料單 number of a project: PR-01, PR-02 … */
  function nextNo(project) {
    const max = (project.preps || []).reduce((m, p) => { const x = String(p.no || '').match(/(\d+)\s*$/); return x ? Math.max(m, +x[1]) : m; }, 0);
    return 'PR-' + p2(max + 1);
  }

  const orgLabel = g => (g.org ? g.org.name : g.vendor || (g.kind === 'factory' ? '工廠' : '供應商'));

  /** Attachment name: <project>_<stage>_TIM備料_<YYYYMMDD>_<organisation>.xlsx */
  function fileName(project, g, today) {
    const safe = s => util.storageName(s).replace(/\s+/g, '_');
    return [project.name || 'project', project.stage, 'TIM備料', ymd(day0(today)), orgLabel(g)].filter(Boolean).map(safe).join('_') + '.xlsx';
  }

  /**
   * The table of a group: head labels and cell texts. cellOf(key, line) → text of a TIM-list column
   * (UI); 'loc', 'no' and 'qty' (per set) are handled here, and the total is always the last column.
   * labels: { key: label } for TIM-list columns not in LABELS.
   */
  function table(g, cols, cellOf, labels) {
    const head = cols.map(k => labelOf(k, labels && labels[k])).concat(TOTAL_LABEL);
    const num = cols.map(isNum).concat(true);
    const rows = g.lines.map((l, i) => cols.map(k => {
      if (k === 'no') return String(i + 1);
      if (k === 'loc') return l.loc ? l.loc.name : '';
      if (k === 'qty') return qtyText(l.per.v, l.per.unit);
      return cellOf ? String(cellOf(k, l) == null ? '' : cellOf(k, l)) : '';
    }).concat(qtyText(l.total, l.per.unit)));
    return { head, num, rows };
  }

  /**
   * Everything an email (and its Excel) needs, frozen: also what is kept in prep.mailed.
   * o: { project, prep, group, table, recips: { to, cc }, settings, today, sender }
   */
  function compose(o) {
    const { project, prep, group } = o;
    const today = day0(o.today);
    const factory = group.kind === 'factory';
    const need = needText(prep.need, o.settings, today);
    const short = needShort(prep.need, o.settings, today);
    const purpose = String(prep.purpose || '').trim();
    const setsText = prep.sets + ' 套（每套 = 1 台設備用量）';
    const file = fileName(project, group, today);
    const toNames = (o.recips.to || []).map(p => p.name || p.email).filter(Boolean);
    return {
      key: group.key, org_id: group.org ? group.org.id : '', org: orgLabel(group), kind: group.kind,
      no: prep.no || '', project: project.name || '', stage: project.stage || '',
      to: (o.recips.to || []).slice(), cc: (o.recips.cc || []).slice(),
      subject: '【TIM 備料】' + [project.name, project.stage].filter(Boolean).join(' ') + '｜' + prep.sets + ' 套' + (short ? '｜需求：' + short : '') + (prep.need && prep.need.mode === 'asap' ? '（急件）' : ''),
      greet: (toNames.length ? toNames.join('、') + ' ' : '') + '您好：',
      intro: (project.name || '') + (project.stage ? '（' + project.stage + '）' : '') + purpose + '需要以下 TIM 材料，' + (factory ? '麻煩協助備料' : '麻煩協助提供') + '，謝謝。',
      facts: [['套數', setsText], ['需求日期', need]].concat(purpose ? [['用途', purpose]] : []),
      info: [
        ['專案 / 階段', [project.name, project.stage].filter(Boolean).join(' / ')],
        ['套數', setsText],
        ['用途', purpose],
        ['需求日期', need],
        ['對象', orgLabel(group) + (toNames.length ? '（' + toNames.join('、') + '）' : '')],
        ['申請人 / 日期', [o.sender, fmtLong(today)].filter(Boolean).join(' / ')],
      ],
      title: 'TIM 備料清單' + (prep.no ? ' · ' + prep.no : ''),
      note: "總數量 = 每套 Q'ty × 套數；片數無條件進位，點膠類進位到 0.1 g / cc",
      head: o.table.head, num: o.table.num, rows: o.table.rows,
      file, sender: o.sender || '', sets: prep.sets, need,
    };
  }

  // ───────────────────────── email body ─────────────────────────
  const esc = util.escapeHtml;
  const FONT = "font-family:'Microsoft JhengHei','微軟正黑體',Calibri,Arial,sans-serif;font-size:10.5pt";

  function bodyHtml(m) {
    const cell = (t, num, th) => '<' + (th ? 'th' : 'td') + ' style="border:1px solid #9BA7B4;padding:3px 8px;' + (th ? 'background:#DDEBF7;font-weight:bold;' : '') +
      'text-align:' + (num ? 'right' : 'left') + ';white-space:nowrap">' + esc(t) + '</' + (th ? 'th' : 'td') + '>';
    const tbl = '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;' + FONT + '">' +
      '<tr>' + m.head.map((h, i) => cell(h, m.num[i], true)).join('') + '</tr>' +
      m.rows.map(r => '<tr>' + r.map((v, i) => cell(v, m.num[i], false)).join('') + '</tr>').join('') + '</table>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="' + FONT + '">' +
      '<p>' + esc(m.greet) + '</p>' +
      '<p>' + esc(m.intro) + '</p>' +
      '<ul>' + m.facts.map(f => '<li>' + esc(f[0]) + '：' + esc(f[1]) + '</li>').join('') + '</ul>' +
      tbl +
      '<p>明細另附 Excel：' + esc(m.file) + '</p>' +
      (m.sender ? '<p>' + esc(m.sender) + '</p>' : '') +
      '</body></html>';
  }

  /** Plain text (mailto fallback / text part). table: false leaves the rows out (URL length). */
  function bodyText(m, opts) {
    const withTable = !opts || opts.table !== false;
    const lines = [m.greet, '', m.intro, ''].concat(m.facts.map(f => '・' + f[0] + '：' + f[1]), ['']);
    if (withTable) {
      lines.push(m.head.join('\t'));
      m.rows.forEach(r => lines.push(r.join('\t')));
      lines.push('');
    }
    lines.push(opts && opts.attachNote ? opts.attachNote : '明細另附 Excel：' + m.file);
    if (m.sender) lines.push('', m.sender);
    return lines.join('\n');
  }

  // ───────────────────────── .eml (MIME) ─────────────────────────
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(s));
    return Uint8Array.from(Buffer.from(String(s), 'utf8'));        // eslint-disable-line no-undef
  }
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function base64(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
      out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)] +
        (i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : '=') +
        (i + 2 < bytes.length ? B64[c & 63] : '=');
    }
    return out;
  }
  const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');

  /** RFC 2047 header text: plain ASCII as is, otherwise UTF-8 encoded words (≤ 75 chars each, folded). */
  function encodeWord(s) {
    s = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ');
    if (/^[\x20-\x7e]*$/.test(s) && !/=\?/.test(s)) return s;
    const words = [];
    let chunk = '';
    for (const ch of s) {
      if (utf8(chunk + ch).length > 45) { words.push(chunk); chunk = ''; }
      chunk += ch;
    }
    if (chunk) words.push(chunk);
    return words.map(w => '=?UTF-8?B?' + base64(utf8(w)) + '?=').join('\r\n ');
  }
  function address(p) {
    const email = String(p.email || '').trim();
    const name = String(p.name || '').trim();
    if (!name) return '<' + email + '>';
    if (/^[\x20-\x7e]*$/.test(name)) return '"' + name.replace(/["\\]/g, '\\$&') + '" <' + email + '>';
    return encodeWord(name) + ' <' + email + '>';
  }

  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  /**
   * An unsent email draft (.eml): classic Outlook opens it as a new message (X-Unsent: 1) with the
   * recipients, subject, HTML body and attachments filled in — the user only presses 傳送.
   * o: { to: [{ name, email }], cc, subject, html, text, attachments: [{ name, type, data: Uint8Array }] }
   */
  function buildEml(o) {
    const tag = Math.random().toString(36).slice(2, 10);
    const mixed = '----=_TIM_mixed_' + tag, alt = '----=_TIM_alt_' + tag;
    const L = [];
    const h = (k, v) => L.push(k + ': ' + v);
    h('X-Unsent', '1');
    if ((o.to || []).length) h('To', o.to.map(address).join(',\r\n '));
    if ((o.cc || []).length) h('Cc', o.cc.map(address).join(',\r\n '));
    h('Subject', encodeWord(o.subject || ''));
    h('MIME-Version', '1.0');
    h('Content-Type', 'multipart/mixed; boundary="' + mixed + '"');
    L.push('', 'This is a multi-part message in MIME format.', '');
    L.push('--' + mixed, 'Content-Type: multipart/alternative; boundary="' + alt + '"', '');
    const part = (type, body) => {
      L.push('--' + alt, 'Content-Type: ' + type + '; charset="utf-8"', 'Content-Transfer-Encoding: base64', '');
      L.push(wrap76(base64(utf8(body))).replace(/\r\n$/, ''));
    };
    part('text/plain', String(o.text || '').replace(/\r?\n/g, '\r\n'));
    part('text/html', o.html || '');
    L.push('--' + alt + '--', '');
    (o.attachments || []).forEach(a => {
      const name = encodeWord(a.name || 'attachment');
      L.push('--' + mixed,
        'Content-Type: ' + (a.type || 'application/octet-stream') + '; name="' + name + '"',
        'Content-Disposition: attachment; filename="' + name + '"',
        'Content-Transfer-Encoding: base64', '');
      L.push(wrap76(base64(a.data instanceof Uint8Array ? a.data : new Uint8Array(a.data || []))).replace(/\r\n$/, ''));
    });
    L.push('--' + mixed + '--', '');
    return L.join('\r\n');
  }

  /** File name of the .eml: TIM備料_<project>_<organisation>.eml */
  function emlName(m) {
    return ['TIM備料', m.project, m.stage, m.org].filter(Boolean).map(s => util.storageName(s).replace(/\s+/g, '_')).join('_') + '.eml';
  }

  const MAILTO_MAX = 1900;          // classic Outlook / Windows cut longer mailto links
  /** mailto: link (fallback: plain text, no attachment; the table is left out when the link would be too long). */
  function mailtoUrl(m) {
    const list = ps => ps.map(p => p.email).filter(Boolean).join(';');
    const make = text => 'mailto:' + encodeURI(list(m.to)) + '?' + [
      m.cc.length ? 'cc=' + encodeURIComponent(list(m.cc)) : '',
      'subject=' + encodeURIComponent(m.subject),
      'body=' + encodeURIComponent(text),
    ].filter(Boolean).join('&');
    const note = '明細請見附件 Excel：' + m.file + '（請手動附加）';
    let url = make(bodyText(m, { attachNote: note }));
    if (url.length > MAILTO_MAX) url = make(bodyText(m, { table: false, attachNote: note }));
    return url;
  }

  return {
    DEFAULT_COLS, FIXED_COLS, LABELS, TOTAL_LABEL, XLSX_TYPE, colsOf, labelOf, isNum,
    itemsOf, perSet, totalOf, qtyText, autoSource, sourceOf, isOn, orgsOf, suppliersFor, targetOf, groups,
    recipients, needText, needShort, nextNo, fileName, table, compose, bodyHtml, bodyText,
    base64, encodeWord, buildEml, emlName, mailtoUrl, orgLabel,
  };
});
