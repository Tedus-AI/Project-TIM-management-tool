/* TIM Management Tool — text parsers shared by the grid, Excel paste and Excel import. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const mod = factory(util, schema);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.parse = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema) {
  'use strict';

  const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';

  /**
   * "51.5*9*3", "51.5 x 9 x 3", "51.5×9×3t", "20.6*20.6*3.5mm", "8*8", "T3.0".
   * Returns { ok, l, w, t } — missing parts are null. Empty input → ok:true with all null.
   */
  function parseSize(input) {
    const raw = util.toHalfWidth(String(input == null ? '' : input)).trim();
    const empty = { ok: true, l: null, w: null, t: null };
    if (!raw) return empty;
    let s = raw.toLowerCase().replace(/mm/g, '').replace(/[×✕✖＊]/g, '*').replace(/\s*\*\s*/g, '*');
    // "t=3" / "t3" only thickness
    let m = s.match(new RegExp('^t\\s*=?\\s*' + NUM + '$'));
    if (m) return { ok: true, l: null, w: null, t: parseFloat(m[1]) };
    s = s.replace(/\s+x\s+/g, '*').replace(new RegExp(NUM + 'x(?=' + NUM + ')', 'g'), '$1*').replace(/t$/, '');
    const parts = s.split('*').map(p => p.trim()).filter(p => p !== '');
    if (!parts.length || parts.length > 3) return { ok: false, l: null, w: null, t: null };
    const nums = parts.map(p => (new RegExp('^' + NUM + '$').test(p) ? parseFloat(p) : NaN));
    if (nums.some(n => !Number.isFinite(n))) return { ok: false, l: null, w: null, t: null };
    if (nums.length === 1) return { ok: true, l: null, w: null, t: nums[0] };
    if (nums.length === 2) return { ok: true, l: nums[0], w: nums[1], t: null };
    return { ok: true, l: nums[0], w: nums[1], t: nums[2] };
  }

  /** {l,w,t} → "51.5*9*3" (Excel-compatible), '' when all empty. */
  function formatSize(size, sep) {
    if (!size) return '';
    const s = sep || '*';
    const { l, w, t } = size;
    const f = v => (v === null || v === undefined) ? '' : util.fmt(v, 3);
    if (l == null && w == null && t == null) return '';
    if (l == null && w == null) return 'T' + f(t);
    if (t == null) return f(l) + s + f(w);
    return f(l) + s + f(w) + s + f(t);
  }

  const LIST_SPLIT = /[,，;；、\n\r]+/;

  /**
   * "LDO-A*2, BUCK-B*4,PMIC-C*2" → [{part:'LDO-A',qty:2}, ...]
   * Accepted multiplier forms: "X*2", "X×2", "X ＊2", "X x2" (space before x), "X(2)", "X (x2)".
   */
  function parseCovered(input) {
    const raw = util.toHalfWidth(String(input == null ? '' : input));
    const out = [];
    raw.split(LIST_SPLIT).map(t => t.trim()).filter(Boolean).forEach(tok => {
      let m = tok.match(/^(.+?)\s*[*×＊]\s*(\d+)\s*(pcs|ea|顆|個|片)?$/i)
        || tok.match(/^(.+?)\s+x\s*(\d+)\s*(pcs|ea|顆|個|片)?$/i)
        || tok.match(/^(.+?)\s*\(\s*x?\s*(\d+)\s*\)$/i);
      if (m && m[1].trim()) out.push({ part: m[1].trim(), qty: parseInt(m[2], 10) });
      else {
        m = tok.match(/^(\d+)\s*[*×＊x]\s*(.+)$/i);   // "2*LDO-A"
        if (m && /[A-Za-z]/.test(m[2])) out.push({ part: m[2].trim(), qty: parseInt(m[1], 10) });
        else out.push({ part: tok, qty: 1 });
      }
    });
    return out;
  }

  /** Covered entries → "LDO-A*2, BUCK-B*4" (qty 1 written without multiplier). */
  function formatCovered(list) {
    return (list || []).filter(c => c && (c.part || c.refdes)).map(c => {
      const name = c.part || c.refdes;
      const q = util.num(c.qty);
      return q && q !== 1 ? name + '*' + q : name;
    }).join(', ');
  }

  /**
   * Merge parsed covered tokens into existing structured entries so extra fields
   * (RefDes, power, package size) survive a text edit. Same count → match by index
   * (a rename keeps its data); otherwise match by part name.
   */
  function mergeCovered(existing, parsed) {
    const ex = (existing || []).slice();
    if (ex.length === parsed.length) {
      return parsed.map((p, i) => Object.assign({}, ex[i], { part: p.part, qty: p.qty }));
    }
    const used = new Set();
    return parsed.map(p => {
      const idx = ex.findIndex((e, i) => !used.has(i) && String(e.part).toUpperCase() === p.part.toUpperCase());
      if (idx >= 0) { used.add(idx); return Object.assign({}, ex[idx], { qty: p.qty }); }
      return schema.newCovered({ part: p.part, qty: p.qty });
    });
  }

  /** "PWR/DDR" → ['PWR','DDR'];  "Digital" → ['DIGI']. */
  function parseUsedOn(input) {
    const raw = util.toHalfWidth(String(input == null ? '' : input)).trim();
    if (!raw) return [];
    const out = [];
    raw.split(/[\/,，;；、+&|\n]+|\s{1,}/).map(t => t.trim()).filter(Boolean).forEach(t => {
      const c = schema.normalizeCategory(t);
      if (c && !out.includes(c)) out.push(c);
    });
    return out;
  }

  function formatUsedOn(list) { return (list || []).join('/'); }

  const SINGLE_RE = /(only\s*source|single\s*source|sole\s*source|唯一|獨家|單一來源|無第二|no\s*2nd|none)/i;

  /**
   * Second-source cell → { single, sources:[{vendor, model, note}], note }.
   *  "Vendor-A only source"       → single, no sources
   *  "Vendor-C"                   → one source
   *  "short:甲廠,long:Vendor-C"   → two sources with notes short / long
   *  "Vendor-C TP-800; Vendor-D"  → vendor + model, second vendor
   */
  function parseSecondSource(input) {
    const raw = util.toHalfWidth(String(input == null ? '' : input)).trim();
    if (!raw) return { single: false, sources: [], note: '' };
    if (SINGLE_RE.test(raw)) return { single: true, sources: [], note: raw };
    const sources = [];
    raw.split(LIST_SPLIT).map(t => t.trim()).filter(Boolean).forEach(tok => {
      let note = '';
      let body = tok;
      const m = tok.match(/^([^:：]{1,24})[:：]\s*(.+)$/);
      if (m) { note = m[1].trim(); body = m[2].trim(); }
      const pm = body.match(/^(.*?)\s*[(（]([^()（）]*)[)）]$/);      // "Vendor Model(note)"
      if (pm && pm[1].trim()) { body = pm[1].trim(); if (!note) note = pm[2].trim(); }
      const parts = body.split(/\s+/);
      const vendor = parts.shift();
      sources.push({ vendor, model: parts.join(' '), note });
    });
    const hasLabels = sources.some(s => s.note);
    return { single: false, sources, note: hasLabels ? raw : '' };
  }

  /** Structured sources → compact text, e.g. "甲廠(short), Vendor-C(long)". */
  function formatSources(item) {
    const list = (item && item.sources) || [];
    if (!list.length) return (item && item.sourcing_note) || '';
    return list.map(s => {
      let t = [s.vendor, s.model].filter(Boolean).join(' ');
      if (s.note) t += '(' + s.note + ')';
      return t;
    }).join(', ');
  }

  /** Merge parsed 2nd-source entries into existing ones (same vendor keeps status/MPN). */
  function mergeSources(existing, parsed, defaultStatus) {
    const ex = (existing || []).slice();
    const used = new Set();
    return parsed.map(p => {
      const idx = ex.findIndex((e, i) => !used.has(i) && String(e.vendor).toUpperCase() === String(p.vendor).toUpperCase());
      if (idx >= 0) {
        used.add(idx);
        return Object.assign({}, ex[idx], { model: p.model || ex[idx].model, note: p.note || ex[idx].note });
      }
      return schema.newSource({ vendor: p.vendor, model: p.model || '', note: p.note || '', status: defaultStatus || 'unknown' });
    });
  }

  /**
   * Parse clipboard text copied from Excel (TSV). Handles quoted cells with
   * embedded tabs/newlines/quotes. Trailing empty line removed.
   */
  function parseTsv(text) {
    const s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const rows = [];
    let row = [], cell = '', i = 0, quoted = false;
    while (i < s.length) {
      const ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"' && cell === '') { quoted = true; i++; continue; }
      if (ch === '\t') { row.push(cell); cell = ''; i++; continue; }
      if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
      cell += ch; i++;
    }
    row.push(cell);
    rows.push(row);
    if (rows.length > 1 && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }

  /** Rows → TSV (quotes cells containing tab/newline/quote, like Excel). */
  function toTsv(rows) {
    return rows.map(r => r.map(c => {
      const v = c == null ? '' : String(c);
      return /[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join('\t')).join('\n');
  }

  /** Header synonyms (normalised with util.normalizeKey). */
  const HEADER_SYNONYMS = {
    location: ['location', 'loc', '位置', '區域', 'side', 'case'],
    item_no: ['item', 'itemno', 'no', '編號', '項次', '項目', 'id'],
    used_on: ['usedon', 'used', 'use', '用途', 'category', '類別', 'board', 'cat'],
    vendor: ['vendor', '廠商', '供應商', 'supplier', 'maker', 'manufacturer', 'mfr', 'brand'],
    model: ['model', '型號', 'material', '材料', 'series', 'type'],
    size: ['size', '尺寸', 'dimension', 'dim', 'lwt', 'lxwxt', '規格'],
    qty: ['qty', 'quantity', '數量', '用量', 'pcs', 'q'],
    delta_pn: ['deltapartno', 'deltapn', 'deltap', 'partno', 'pn', '料號', '台達料號', 'partnumber'],
    covered: ['note', 'notes', '備註', 'component', 'components', '元件', '覆蓋元件', 'coveredcomponent', 'usedfor', 'cover', 'ic'],
    second_source: ['2ndsource', 'secondsource', '2nd', '第二來源', '第二供應商', 'alternate', 'alternative', '替代料', 'altsource'],
  };

  /** Which field does a header cell mean? → field key or null. */
  function matchHeader(text) {
    const k = util.normalizeKey(text);
    if (!k) return null;
    for (const f of Object.keys(HEADER_SYNONYMS)) {
      if (HEADER_SYNONYMS[f].includes(k)) return f;
    }
    // looser: startsWith for long headers like "Delta Part No. (料號)"
    for (const f of Object.keys(HEADER_SYNONYMS)) {
      if (HEADER_SYNONYMS[f].some(s => s.length >= 4 && k.startsWith(s))) return f;
    }
    return null;
  }

  /**
   * Find the header row in a matrix of cell texts (first 40 rows). Returns
   * { row, map: {field: colIndex}, score } or null when fewer than 3 known headers.
   */
  function detectHeader(matrix) {
    let best = null;
    const limit = Math.min(matrix.length, 40);
    for (let r = 0; r < limit; r++) {
      const map = {};
      (matrix[r] || []).forEach((cell, c) => {
        const f = matchHeader(cell);
        if (f && map[f] === undefined) map[f] = c;
      });
      const score = Object.keys(map).length;
      if (score >= 3 && (!best || score > best.score)) best = { row: r, map, score };
    }
    return best;
  }

  /**
   * Rows copied from the tool's own TIM List (Excel export) have the material k between Model and Size; the
   * existing Excel does not. True when the cells at kIdx look like k (a number or empty) with a size (L*W*T)
   * right after them, and no row has its size at kIdx.
   */
  function hasKColumn(rows, kIdx) {
    const cell = v => String(v == null ? '' : v).trim();
    const num = v => cell(v) === '' || /^[-+]?\d+(\.\d+)?$/.test(cell(v));
    const size = v => /\d\s*[*xX×]\s*\d/.test(cell(v));
    let yes = 0;
    for (const r of rows || []) {
      if (!r || r.length <= kIdx) continue;
      if (size(r[kIdx])) return false;
      if (num(r[kIdx]) && size(r[kIdx + 1])) yes++;
    }
    return yes > 0;
  }

  /** Guess the TIM type from vendor / model wording. */
  function guessTimType(vendor, model) {
    const s = (String(vendor || '') + ' ' + String(model || '')).toLowerCase();
    if (/zorb|absorb|吸波/.test(s)) return 'absorber';
    if (/gap\s*filler|dispens|點膠|liquid/.test(s)) return 'gap_filler';
    if (/\bgel\b|凝膠/.test(s)) return 'gel';
    if (/putty|導熱泥/.test(s)) return 'putty';
    if (/grease|paste|導熱膏|矽脂/.test(s)) return 'grease';
    if (/phase|pcm|相變/.test(s)) return 'pcm';
    if (/graphite|石墨/.test(s)) return 'graphite';
    if (/tape|膠帶/.test(s)) return 'tape';
    return 'pad';
  }

  /**
   * Convert sheet rows (matrix of cell texts) to item drafts using a header map
   * {field: colIndex}. Location carries down (merged / blank cells). Stops after 3
   * consecutive empty rows (the drawings area below the table).
   * → [{ row, location, fields:{...}, warnings:[] }]
   */
  function rowsToItems(matrix, headerRow, map, opts) {
    opts = opts || {};
    const out = [];
    let lastLoc = '', empty = 0;
    const cellOf = (row, f) => {
      const c = map[f];
      if (c === undefined || c === null || c < 0) return '';
      const v = row[c];
      return v == null ? '' : String(v).trim();
    };
    for (let r = headerRow + 1; r < matrix.length; r++) {
      const row = matrix[r] || [];
      if (row.every(c => !String(c == null ? '' : c).trim())) { if (++empty >= 3) break; continue; }
      empty = 0;
      let loc = cellOf(row, 'location');
      if (loc) lastLoc = loc; else loc = lastLoc;
      const itemNo = cellOf(row, 'item_no'), vendor = cellOf(row, 'vendor'), model = cellOf(row, 'model'), sizeTxt = cellOf(row, 'size');
      if (!itemNo && !vendor && !model && !sizeTxt) continue;
      const warnings = [];
      const size = parseSize(sizeTxt);
      if (!size.ok) warnings.push('Size 無法解析：「' + sizeTxt + '」（保留在備註）');
      const qtyTxt = cellOf(row, 'qty');
      const qty = util.num(qtyTxt);
      if (qtyTxt && qty === null) warnings.push("Q'ty 無法解析：「" + qtyTxt + '」');
      const ss = parseSecondSource(cellOf(row, 'second_source'));
      out.push({
        row: r, location: loc, warnings,
        fields: {
          item_no: itemNo, used_on: parseUsedOn(cellOf(row, 'used_on')), vendor, model,
          tim_type: guessTimType(vendor, model),
          size: size.ok ? { l: size.l, w: size.w, t: size.t } : { l: null, w: null, t: null },
          qty, delta_pn: cellOf(row, 'delta_pn'),
          covered: parseCovered(cellOf(row, 'covered')).map(c => schema.newCovered({ part: c.part, qty: c.qty })),
          sources: ss.sources.map(s => schema.newSource({ vendor: s.vendor, model: s.model, note: s.note, status: opts.sourceStatus || 'unknown' })),
          sourcing_note: ss.note,
          note: size.ok ? '' : 'Size 原文：' + sizeTxt,
        },
      });
    }
    return out;
  }

  return {
    parseSize, formatSize, parseCovered, formatCovered, mergeCovered, parseUsedOn, formatUsedOn,
    parseSecondSource, formatSources, mergeSources, parseTsv, toTsv, HEADER_SYNONYMS, matchHeader, detectHeader, hasKColumn,
    guessTimType, rowsToItems,
  };
});
