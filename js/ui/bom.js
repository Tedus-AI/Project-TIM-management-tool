/* TIM 清單 (BOM) grid — Excel-like:
 *  - columns in the same order as the existing Excel → rows copied from Excel paste straight in
 *  - arrows / Tab / Enter navigation, Shift+arrows or drag to select a range, Ctrl+C / Ctrl+V / Delete / Ctrl+D (fill down)
 *  - grouped by Location with a vertical colour band (like the merged Excel cell), drag rows between groups
 */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useRef, useMemo, useEffect, useCallback, Icon, cx, go, usePref, TextField, NumField, Modal, openModal, confirm, toast, openMenu } = TIM.ui;
  const { Component } = window.htmPreact;

  /** A grid row that only re-renders when its signature changes (150-row grids stay responsive). */
  class GridRow extends Component {
    shouldComponentUpdate(next) { return next.sig !== this.props.sig; }
    render() { return this.props.render(); }
  }
  const { util, schema, parse, calc } = TIM;
  const A = () => TIM.actions;

  const RISK_LABEL = { single: '單一來源：沒有第二來源', unverified: '第二來源尚未承認', ok: '已有承認的第二來源' };

  // ───────── column model ─────────
  function sizeText(it, ctx) {
    if (schema.isDispense(ctx.eff.tim_type)) return it.dispense.amount != null ? util.fmt(it.dispense.amount, 3) + ' ' + (it.dispense.unit || 'g') : '';
    return parse.formatSize(it.size);
  }
  function sizeParse(t, it) {
    const s = util.toHalfWidth(String(t || '')).trim();
    const m = s.match(/^([\d.]+)\s*(g|cc|ml)$/i);
    if (m) return { 'dispense.amount': parseFloat(m[1]), 'dispense.unit': m[2].toLowerCase() === 'ml' ? 'cc' : m[2].toLowerCase() };
    const r = parse.parseSize(s);
    if (!r.ok) return null;
    return { size: { l: r.l, w: r.w, t: r.t } };
  }
  function secondText(it) { return it.sources.length ? parse.formatSources(it) : (it.sourcing_note || ''); }
  function secondParse(t, it) {
    const r = parse.parseSecondSource(t);
    if (r.single || !r.sources.length) return { sources: [], sourcing_note: String(t || '').trim() };
    const patch = { sources: parse.mergeSources(it.sources, r.sources) };
    if (it.sourcing_note && /only|single|唯一|獨家|單一/i.test(it.sourcing_note)) patch.sourcing_note = '';
    return patch;
  }
  const optMatch = (opts, val) => {
    const v = String(val || '').trim().toLowerCase();
    if (!v) return null;
    const o = opts.find(x => x.v.toLowerCase() === v || String(x.label).toLowerCase() === v || (x.zh && x.zh === val.trim()));
    return o ? o.v : null;
  };
  const fmtNum = (v, d) => (v == null ? '' : util.fmt(v, d == null ? 3 : d));

  function buildColumns(groups) {
    const C = [];
    const add = c => C.push(Object.assign({ group: 'basic', width: 100, kind: 'text' }, c));
    add({ key: 'item_no', label: 'Item', width: 76, kind: 'text', path: 'item_no', mono: true });
    add({ key: 'used_on', label: 'Used On', width: 90, kind: 'parsed', text: it => parse.formatUsedOn(it.used_on), parse: t => ({ used_on: parse.parseUsedOn(t) }) });
    add({ key: 'vendor', label: 'Vendor', width: 112, kind: 'material', field: 'vendor' });
    add({ key: 'model', label: 'Model', width: 150, kind: 'material', field: 'model' });
    add({ key: 'size', label: 'Size', sub: 'L*W*T mm', width: 120, kind: 'parsed', mono: true, text: sizeText, parse: sizeParse });
    add({ key: 'qty', label: "Q'ty", width: 78, kind: 'num', path: 'qty', align: 'r' });
    add({ key: 'delta_pn', label: 'Delta P/N', width: 120, kind: 'text', path: 'delta_pn', mono: true });
    add({ key: 'covered', label: 'Note', sub: '覆蓋元件', width: 230, kind: 'parsed', text: it => parse.formatCovered(it.covered), parse: (t, it) => ({ covered: parse.mergeCovered(it.covered, parse.parseCovered(t)) }) });
    add({ key: 'second', label: '2nd source', width: 190, kind: 'parsed', text: secondText, parse: secondParse,
      cls: (it, ctx) => ({ single: 'c-risk-single', unverified: 'c-risk-unverified', ok: '' }[ctx.risk]), title: (it, ctx) => RISK_LABEL[ctx.risk] });
    add({ key: 'tim_type', label: '型態', width: 120, kind: 'select', path: 'tim_type', options: schema.TIM_TYPES.map(t => ({ v: t.v, label: t.label, zh: t.zh })), lockedByMaterial: true });
    add({ key: 'status', label: '狀態', width: 82, kind: 'select', path: 'status', options: schema.ITEM_STATUS });
    if (groups.mech) {
      add({ key: 'gap_min', group: 'mech', label: 'Gap min', sub: 'mm', width: 72, kind: 'num', path: 'gap.min', align: 'r' });
      add({ key: 'gap_nom', group: 'mech', label: 'Gap nom', sub: 'mm', width: 72, kind: 'num', path: 'gap.nom', align: 'r' });
      add({ key: 'gap_max', group: 'mech', label: 'Gap max', sub: 'mm', width: 72, kind: 'num', path: 'gap.max', align: 'r' });
      add({ key: 'comp', group: 'mech', label: '壓縮率', sub: 'min~max %', width: 104, kind: 'calc', align: 'r',
        text: (it, ctx) => ctx.comp.status === 'na' ? '' : fmtNum(ctx.comp.min, 1) + '~' + fmtNum(ctx.comp.max, 1),
        cls: (it, ctx) => ({ ok: 'c-ok', warn: 'c-warn', error: 'c-err', na: '' }[ctx.comp.status]), title: (it, ctx) => ctx.comp.msgs.join('\n') || (ctx.comp.rec ? '建議 ' + ctx.comp.rec.min + '~' + ctx.comp.rec.max + '%' : '') });
    }
    if (groups.thermal) {
      add({ key: 'k', group: 'thermal', label: 'k', sub: 'W/m·K', width: 64, kind: 'calc', align: 'r', text: (it, ctx) => fmtNum(ctx.eff.k, 2), title: () => '材料庫數值（連結材料時自動帶入）' });
      add({ key: 'area', group: 'thermal', label: '面積', sub: 'mm²', width: 74, kind: 'calc', align: 'r', text: (it, ctx) => fmtNum(ctx.th.area, 1) });
      add({ key: 'power', group: 'thermal', label: 'P_TIM', sub: 'W / 顆 max', width: 78, kind: 'calc', align: 'r', text: it => { const ps = it.covered.map(calc.timPower).filter(Number.isFinite); return ps.length ? fmtNum(Math.max.apply(null, ps), 3) : ''; }, title: () => '經由 TIM 的熱量 = 功耗 × 頂面 %' });
      add({ key: 'r', group: 'thermal', label: 'R_TIM', sub: '°C/W', width: 74, kind: 'calc', align: 'r', text: (it, ctx) => fmtNum(ctx.th.R_pad, 3) });
      add({ key: 'dt', group: 'thermal', label: 'ΔT max', sub: '°C', width: 72, kind: 'calc', align: 'r', text: (it, ctx) => fmtNum(ctx.th.dt_max, 2),
        cls: (it, ctx) => (ctx.th.dt_max != null && ctx.th.dt_max >= ctx.dtWarn ? 'c-warn' : '') });
    }
    if (groups.supply) {
      add({ key: 'vendor_pn', group: 'supply', label: 'Vendor P/N', width: 120, kind: 'text', path: 'vendor_pn', mono: true });
      add({ key: 'fabricator', group: 'supply', label: '加工廠', width: 100, kind: 'text', path: 'fabricator' });
      add({ key: 'price', group: 'supply', label: '單價', width: 72, kind: 'num', path: 'price.unit', align: 'r' });
      add({ key: 'currency', group: 'supply', label: '幣別', width: 70, kind: 'select', path: 'price.currency', options: schema.CURRENCIES.map(c => ({ v: c, label: c })), allowEmpty: true });
      add({ key: 'subtotal', group: 'supply', label: '小計', width: 76, kind: 'calc', align: 'r', text: it => fmtNum(calc.itemCost(it), 3) });
      add({ key: 'moq', group: 'supply', label: 'MOQ', width: 70, kind: 'num', path: 'moq', align: 'r' });
      add({ key: 'lead', group: 'supply', label: '交期', sub: '週', width: 60, kind: 'num', path: 'lead_time_wk', align: 'r' });
    }
    if (groups.trace) {
      add({ key: 'drawing_no', group: 'trace', label: '裁切圖號', width: 110, kind: 'text', path: 'drawing_no', mono: true });
      add({ key: 'note', group: 'trace', label: '備註', width: 200, kind: 'text', path: 'note' });
    }
    return C;
  }

  /** Text of a cell (copy / fill / revert). */
  function cellText(col, it, ctx) {
    if (col.kind === 'text') return String(A().getPath(it, col.path) || '');
    if (col.kind === 'num') { const v = A().getPath(it, col.path); return v == null ? '' : util.fmt(v, 4); }
    if (col.kind === 'select') { const v = A().getPath(it, col.path); const o = col.options.find(x => x.v === v); return o ? o.label : (v || ''); }
    if (col.kind === 'material') return String(ctx.eff[col.field] || '');
    return col.text ? String(col.text(it, ctx) || '') : '';
  }

  /** Patch for a pasted / filled text (null = not applicable). */
  function cellPatch(col, text, it, ctx) {
    const t = String(text == null ? '' : text).replace(/\r/g, '');
    if (col.kind === 'text') return { [col.path]: t.trim() };
    if (col.kind === 'num') { if (!t.trim()) return { [col.path]: null }; const n = util.num(t); return n === null ? null : { [col.path]: n }; }
    if (col.kind === 'select') { if (col.lockedByMaterial && ctx && ctx.mat) return null; if (!t.trim()) return col.allowEmpty ? { [col.path]: '' } : null; const v = optMatch(col.options, t); return v ? { [col.path]: v } : null; }
    if (col.kind === 'material') {
      if (ctx && ctx.mat) return String(ctx.eff[col.field] || '').trim().toUpperCase() === t.trim().toUpperCase() ? {} : null;   // linked: identical = no-op
      return { [col.field]: t.trim() };
    }
    if (col.kind === 'parsed') return col.parse(t, it);
    return null;
  }

  function rowCtx(it, db, dtWarn) {
    const mat = calc.materialOf(db, it);
    return {
      mat, eff: calc.effective(it, mat), comp: calc.compressionCheck(it, mat, db.settings),
      th: calc.thermalEstimate(it, mat), risk: calc.sourceRisk(it), dtWarn,
    };
  }

  // ───────── paste-rows dialog (full rows incl. Location) ─────────
  const DEFAULT_ORDER = ['location', 'item_no', 'used_on', 'vendor', 'model', 'size', 'qty', 'delta_pn', 'covered', 'second_source'];
  function PasteRowsModal(props) {
    const p = props.p;
    const [text, setText] = useState('');
    const [first, setFirst] = useState('auto');
    const matrix = useMemo(() => (text.trim() ? parse.parseTsv(text.replace(/\n+$/, '')) : []), [text]);
    const plan = useMemo(() => {
      if (!matrix.length) return null;
      const h = parse.detectHeader(matrix);
      if (h) return { headerRow: h.row, map: h.map, note: '偵測到標題列（第 ' + (h.row + 1) + ' 列）' };
      const locNames = p.locations.map(l => l.name.toUpperCase());
      const looksLoc = v => locNames.includes(String(v || '').trim().toUpperCase()) || /case|cover|heatsink|shield|location|位置/i.test(String(v || ''));
      const startsWithLoc = first === 'location' || (first === 'auto' && matrix.some(r => looksLoc(r[0])));
      const order = startsWithLoc ? DEFAULT_ORDER : DEFAULT_ORDER.slice(1);
      const map = {};
      order.forEach((f, i) => { map[f] = i; });
      return { headerRow: -1, map, note: startsWithLoc ? '依現行 Excel 欄序（第一欄 = Location）' : '依現行 Excel 欄序（第一欄 = Item，Location 用預設）' };
    }, [matrix, first]);
    const rows = useMemo(() => (plan ? parse.rowsToItems(matrix, plan.headerRow, plan.map, {}) : []), [plan]);
    const defLoc = props.locationId || (p.locations[0] && p.locations[0].id);
    const apply = () => {
      if (!rows.length) return;
      const byName = {};
      p.locations.forEach(l => { byName[l.name.trim().toUpperCase()] = l.id; });
      const newLocs = [];
      rows.forEach(r => { const k = (r.location || '').trim().toUpperCase(); if (k && !byName[k] && !newLocs.includes(r.location.trim())) newLocs.push(r.location.trim()); });
      newLocs.forEach(n => { byName[n.toUpperCase()] = A().addLocation(p.id, n); });
      A().pasteIntoItems(p.id, [], rows.map(r => ({ location_id: byName[(r.location || '').trim().toUpperCase()] || defLoc, fields: r.fields })), null);
      toast('已新增 ' + rows.length + ' 個 Item', 'ok');
      props.close(true);
    };
    return html`<${Modal} title="從 Excel 貼上多列" size="wide" onClose=${() => props.close(false)}
      footer=${html`<span class="left">${plan ? plan.note : '在 Excel 選取整列（可含標題列）→ Ctrl+C → 貼到下方'}</span>
        <button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button>
        <button class="btn btn-primary" disabled=${!rows.length} onClick=${apply}>新增 ${rows.length} 個 Item</button>`}>
      <div class="row" style="margin-bottom:8px;gap:12px">
        <span class="field-label">第一欄是</span>
        <div class="seg">${[['auto', '自動判斷'], ['location', 'Location'], ['item', 'Item']].map(([v, l]) => html`<button class=${first === v ? 'on' : ''} onClick=${() => setFirst(v)}>${l}</button>`)}</div>
        <span class="muted" style="font-size:12px">新的 Location 名稱會自動建立；Vendor + Model 與材料庫相同時自動連結</span>
      </div>
      <textarea class="ta mono" style="min-height:120px;font-size:12px" autofocus placeholder="在這裡 Ctrl+V 貼上…" value=${text} onInput=${e => setText(e.target.value)}></textarea>
      ${rows.length ? html`<div class="tbl-wrap" style="margin-top:12px;max-height:340px">
        <table class="tbl preview-tbl"><thead><tr><th>Location</th><th>Item</th><th>Used On</th><th>Vendor</th><th>Model</th><th>Size</th><th class="r">Q'ty</th><th>Delta P/N</th><th>覆蓋元件</th><th>2nd source</th><th>注意</th></tr></thead>
        <tbody>${rows.map((r, i) => html`<tr key=${i}>
          <td>${r.location || html`<span class="muted">（預設）</span>`}</td><td class="mono">${r.fields.item_no}</td><td>${r.fields.used_on.join('/')}</td>
          <td>${r.fields.vendor}</td><td>${r.fields.model}</td><td class="mono">${parse.formatSize(r.fields.size)}</td><td class="r mono">${r.fields.qty == null ? '' : r.fields.qty}</td>
          <td class="mono">${r.fields.delta_pn}</td><td>${parse.formatCovered(r.fields.covered)}</td>
          <td>${r.fields.sources.length ? parse.formatSources(r.fields) : html`<span class="tag tag-single">${r.fields.sourcing_note || '單一來源'}</span>`}</td>
          <td class="text-warn" style="font-size:11px">${r.warnings.join('；')}</td>
        </tr>`)}</tbody></table>
      </div>` : null}
    </${Modal}>`;
  }

  // ───────── the grid ─────────
  function Bom(props) {
    const p = props.p;
    const st = TIM.store;
    const db = st.db;
    const ro = st.readonly;
    const [groups, setGroups] = usePref('bom_groups', { mech: false, thermal: false, supply: false, trace: false });
    const [filter, setFilter] = useState('');
    const [showObsolete, setShowObsolete] = usePref('bom_obsolete', true);
    const [range, setRange] = useState(null);           // {r0,c0,r1,c1}
    const [dropAt, setDropAt] = useState(null);         // {beforeId|null, locId}
    const dropRef = useRef(null);                       // same value, readable from memoised rows' handlers
    const setDrop = v => { dropRef.current = v; setDropAt(v); };
    const tableRef = useRef(null);
    const focusRef = useRef(null);                      // {r, c, text} at focus time
    const dragSel = useRef(null);
    const dragRow = useRef(null);
    const pending = useRef(null);                       // focus request after re-render
    const openId = props.route.sub;
    const cols = useMemo(() => buildColumns(groups), [groups.mech, groups.thermal, groups.supply, groups.trace]);
    // Latest render values: memoised rows keep older handler closures, which must read these.
    const live = useRef({});
    const dtWarn = db.settings.dt_warn || 10;

    const q = filter.trim().toUpperCase();
    const visible = calc.orderedItems(p).filter(it => (showObsolete || it.status !== 'obsolete') &&
      (!q || [it.item_no, it.vendor, it.model, it.delta_pn, it.vendor_pn, parse.formatCovered(it.covered), parse.formatSources(it), it.note, calc.effective(it, calc.materialOf(db, it)).model]
        .some(v => String(v || '').toUpperCase().includes(q))));
    const ctxs = {};
    visible.forEach(it => { ctxs[it.id] = rowCtx(it, db, dtWarn); });
    const placed = calc.placedCounts(p);
    const hasViews = p.views.some(v => v.shapes.length);
    live.current = { p, visible, ctxs, range, cols };
    const vendors = useMemo(() => Array.from(new Set(Object.values(db.materials).map(m => m.vendor).concat(p.items.map(i => i.vendor)).filter(Boolean))).sort(), [st.version]);
    const models = useMemo(() => Array.from(new Set(Object.values(db.materials).map(m => m.model).concat(p.items.map(i => i.model)).filter(Boolean))).sort(), [st.version]);

    // focus a cell after the next render (new rows etc.)
    useEffect(() => {
      if (!pending.current) return;
      const { r, c } = pending.current;
      pending.current = null;
      focusCell(r, c);
    });

    // deep link: scroll the opened item into view
    useEffect(() => {
      if (!openId || !tableRef.current) return;
      const tr = tableRef.current.querySelector('tr[data-id="' + openId + '"]');
      if (tr) tr.scrollIntoView({ block: 'nearest' });
    }, [openId]);

    function cellEl(r, c) { return tableRef.current && tableRef.current.querySelector('[data-cell="' + r + ',' + c + '"]'); }
    function focusCell(r, c, keepRange) {
      if (!visible.length) return false;
      r = util.clamp(r, 0, visible.length - 1);
      c = util.clamp(c, 0, cols.length - 1);
      const el = cellEl(r, c);
      if (!el) return false;
      el.focus({ preventScroll: true });
      if (el.select) { try { el.select(); } catch (e) { /* select elements */ } }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (!keepRange) setRange(null);
      return true;
    }
    const posOf = el => { const d = el && el.closest && el.closest('[data-cell]'); if (!d) return null; const [r, c] = d.dataset.cell.split(',').map(Number); return { r, c, el: d }; };
    const rangeBox = () => {
      const rg = live.current.range;
      if (!rg) return null;
      return { r0: Math.min(rg.r0, rg.r1), r1: Math.max(rg.r0, rg.r1), c0: Math.min(rg.c0, rg.c1), c1: Math.max(rg.c0, rg.c1) };
    };
    const inRange = (r, c) => { const b = rangeBox(); return b && (b.r1 > b.r0 || b.c1 > b.c0) && r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1; };

    // ── clipboard / bulk operations ──
    function applyMatrix(r0, c0, matrix) {
      if (ro) return;
      const patches = [], newRows = [];
      const anchorItem = visible[r0] || visible[visible.length - 1];
      const locId = anchorItem ? anchorItem.location_id : (p.locations[0] && p.locations[0].id);
      let skipped = 0;
      matrix.forEach((vals, i) => {
        const it = visible[r0 + i];
        const target = it || schema.newItem({ location_id: locId });
        const ctx = it ? ctxs[it.id] : { mat: null, eff: calc.effective(target, null) };
        const patch = {};
        vals.forEach((v, j) => {
          const col = cols[c0 + j];
          if (!col) return;
          const pt = cellPatch(col, v, target, ctx);
          if (pt) Object.assign(patch, pt);
          else if (String(v || '').trim() && col.kind !== 'calc' && cellText(col, target, ctx).trim() !== String(v).trim()) skipped++;
        });
        if (!Object.keys(patch).length) return;
        if (it) patches.push({ itemId: it.id, patch });
        else { const f = {}; Object.keys(patch).forEach(k => A().setPath(f, k, patch[k])); newRows.push({ location_id: locId, fields: f }); }
      });
      const lastId = visible.length ? visible[Math.min(visible.length - 1, r0 + matrix.length - 1)].id : null;
      const created = A().pasteIntoItems(p.id, patches, newRows, lastId);
      const msg = '已貼上 ' + matrix.length + ' 列' + (created.length ? '（新增 ' + created.length + ' 個 Item）' : '') + (skipped ? '，' + skipped + ' 格無法套用（格式不符或為連結材料庫 / 計算欄位）' : '');
      toast(msg, skipped ? 'warn' : 'ok');
      setRange({ r0, c0, r1: r0 + matrix.length - 1, c1: c0 + Math.max.apply(null, matrix.map(r => r.length)) - 1 });
    }

    function rangeTsv(b) {
      const rows = [];
      for (let r = b.r0; r <= b.r1; r++) {
        const it = visible[r];
        if (!it) continue;
        const line = [];
        for (let c = b.c0; c <= b.c1; c++) line.push(cellText(cols[c], it, ctxs[it.id]));
        rows.push(line);
      }
      return parse.toTsv(rows);
    }

    function clearRange(b) {
      const patches = [];
      for (let r = b.r0; r <= b.r1; r++) {
        const it = visible[r];
        if (!it) continue;
        const patch = {};
        for (let c = b.c0; c <= b.c1; c++) {
          const col = cols[c];
          if (col.kind === 'select' || col.kind === 'calc') continue;
          const pt = cellPatch(col, '', it, ctxs[it.id]);
          if (pt) Object.assign(patch, pt);
        }
        if (Object.keys(patch).length) patches.push({ itemId: it.id, patch });
      }
      A().patchItems(p.id, patches, '清除');
    }

    function fillDown(b) {
      const top = visible[b.r0];
      if (!top || b.r1 <= b.r0) return;
      const patches = [];
      for (let r = b.r0 + 1; r <= b.r1; r++) {
        const it = visible[r];
        const patch = {};
        for (let c = b.c0; c <= b.c1; c++) {
          const col = cols[c];
          if (col.kind === 'calc') continue;
          const pt = cellPatch(col, cellText(col, top, ctxs[top.id]), it, ctxs[it.id]);
          if (pt) Object.assign(patch, pt);
        }
        if (Object.keys(patch).length) patches.push({ itemId: it.id, patch });
      }
      A().patchItems(p.id, patches, '向下填滿');
      toast('已向下填滿 ' + (b.r1 - b.r0) + ' 列', 'ok');
    }

    // ── keyboard ──
    const onKeyDown = e => {
      const pos = posOf(e.target);
      if (!pos) return;
      const { r, c } = pos;
      const t = e.target;
      const isText = t.tagName === 'INPUT';
      const isSelect = t.tagName === 'SELECT';
      const mod = e.ctrlKey || e.metaKey;
      if (e.isComposing) return;
      const extend = (nr, nc) => {
        const base = range || { r0: r, c0: c, r1: r, c1: c };
        const nr2 = util.clamp(nr, 0, visible.length - 1), nc2 = util.clamp(nc, 0, cols.length - 1);
        setRange({ r0: base.r0, c0: base.c0, r1: nr2, c1: nc2 });
      };
      const allSel = isText && t.selectionStart === 0 && t.selectionEnd === t.value.length;
      const atStart = !isText || allSel || (t.selectionStart === 0 && t.selectionEnd === 0);
      const atEnd = !isText || allSel || (t.selectionStart === t.value.length && t.selectionEnd === t.value.length);
      const cur = range ? { r: range.r1, c: range.c1 } : { r, c };
      switch (e.key) {
        case 'ArrowUp': case 'ArrowDown': {
          if (isSelect && e.altKey) return;
          e.preventDefault();
          const d = e.key === 'ArrowUp' ? -1 : 1;
          if (e.shiftKey) extend(cur.r + d, cur.c); else focusCell(r + d, c);
          return;
        }
        case 'ArrowLeft':
          if (e.shiftKey) { if (atStart || range) { e.preventDefault(); extend(cur.r, cur.c - 1); } return; }
          if (atStart) { e.preventDefault(); focusCell(r, c - 1); }
          return;
        case 'ArrowRight':
          if (e.shiftKey) { if (atEnd || range) { e.preventDefault(); extend(cur.r, cur.c + 1); } return; }
          if (atEnd) { e.preventDefault(); focusCell(r, c + 1); }
          return;
        case 'Tab': {
          e.preventDefault();
          let nr = r, nc = c + (e.shiftKey ? -1 : 1);
          if (nc >= cols.length) { nc = 0; nr++; } else if (nc < 0) { nc = cols.length - 1; nr--; }
          focusCell(nr, nc);
          return;
        }
        case 'Enter':
          if (isSelect) return;
          e.preventDefault();
          focusCell(r + (e.shiftKey ? -1 : 1), c);
          return;
        case 'Escape': {
          const f = focusRef.current;
          if (range) { e.preventDefault(); setRange(null); return; }
          if (f && f.r === r && f.c === c) {
            const it = visible[r];
            const col = cols[c];
            if (it && cellText(col, it, ctxs[it.id]) !== f.text) {
              e.preventDefault();
              const pt = cellPatch(col, f.text, it, ctxs[it.id]);
              if (pt) A().patchItems(p.id, [{ itemId: it.id, patch: pt }], '復原儲存格');
              if (isText) setTimeout(() => { t.value = f.text; t.select(); }, 0);
            }
          }
          return;
        }
        case 'Delete': case 'Backspace': {
          const b = rangeBox();
          if (b && (b.r1 > b.r0 || b.c1 > b.c0) && !ro) { e.preventDefault(); clearRange(b); }
          return;
        }
        case 'F2':
          if (isText) { e.preventDefault(); const n = t.value.length; t.setSelectionRange(n, n); }
          return;
        default:
          if (mod && (e.key === 'd' || e.key === 'D')) {
            const b = rangeBox();
            if (b && b.r1 > b.r0 && !ro) { e.preventDefault(); fillDown(b); }
          } else if (mod && (e.key === 'a' || e.key === 'A') && !isText) {
            e.preventDefault(); setRange({ r0: 0, c0: 0, r1: visible.length - 1, c1: cols.length - 1 });
          }
      }
    };

    const onFocusIn = e => {
      const pos = posOf(e.target);
      if (!pos) return;
      const it = visible[pos.r];
      if (it) focusRef.current = { r: pos.r, c: pos.c, text: cellText(cols[pos.c], it, ctxs[it.id]) };
    };

    const onCopy = e => {
      const b = rangeBox();
      if (!b || (b.r1 === b.r0 && b.c1 === b.c0)) {
        const pos = posOf(e.target);
        if (pos && !(e.target.tagName === 'INPUT' && e.target.selectionStart !== e.target.selectionEnd)) {
          const it = visible[pos.r];
          if (it) { e.preventDefault(); e.clipboardData.setData('text/plain', cellText(cols[pos.c], it, ctxs[it.id])); }
        }
        return;
      }
      e.preventDefault();
      e.clipboardData.setData('text/plain', rangeTsv(b));
      toast('已複製 ' + (b.r1 - b.r0 + 1) + ' × ' + (b.c1 - b.c0 + 1) + ' 個儲存格', 'ok', { timeout: 1600 });
    };

    const onPaste = e => {
      if (ro) return;
      const pos = posOf(e.target);
      if (!pos) return;
      const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      const multi = /[\t\n]/.test(text.replace(/\r?\n$/, ''));
      const b = rangeBox();
      const many = b && (b.r1 > b.r0 || b.c1 > b.c0);
      if (!multi && !many) return;      // single value into one cell → native paste
      e.preventDefault();
      const matrix = parse.parseTsv(text.replace(/\r?\n$/, ''));
      if (!multi && many) {
        const fill = [];
        for (let r = b.r0; r <= b.r1; r++) { const line = []; for (let c = b.c0; c <= b.c1; c++) line.push(text); fill.push(line); }
        applyMatrix(b.r0, b.c0, fill);
        return;
      }
      applyMatrix(b ? b.r0 : pos.r, b ? b.c0 : pos.c, matrix);
    };

    // ── mouse range selection ──
    const onMouseDown = e => {
      if (e.button !== 0) return;
      const pos = posOf(e.target);
      if (!pos) return;
      if (e.shiftKey && focusRef.current) {
        e.preventDefault();
        setRange({ r0: focusRef.current.r, c0: focusRef.current.c, r1: pos.r, c1: pos.c });
        return;
      }
      dragSel.current = { r: pos.r, c: pos.c, moved: false };
      if (range) setRange(null);
      const up = () => { dragSel.current = null; window.removeEventListener('mouseup', up); };
      window.addEventListener('mouseup', up);
    };
    const onMouseOver = e => {
      const d = dragSel.current;
      if (!d) return;
      const pos = posOf(e.target);
      if (!pos || (pos.r === d.r && pos.c === d.c && !d.moved)) return;
      d.moved = true;
      e.preventDefault();
      if (window.getSelection) window.getSelection().removeAllRanges();
      setRange({ r0: d.r, c0: d.c, r1: pos.r, c1: pos.c });
    };

    // ── row operations ──
    const selRows = () => { const b = rangeBox(); return b && b.r1 > b.r0 ? live.current.visible.slice(b.r0, b.r1 + 1) : null; };
    const addRow = (locId, after, before) => {
      const id = A().addItem(p.id, { location_id: locId, after, before });
      setTimeout(() => {
        const ord = calc.orderedItems(st.db.projects[p.id]).filter(it => (showObsolete || it.status !== 'obsolete'));
        const r = ord.findIndex(x => x.id === id);
        if (r >= 0) { pending.current = { r, c: 0 }; st.emit(); }
      }, 0);
      return id;
    };
    const deleteRows = async items => {
      const pads = items.reduce((n, it) => n + calc.placedCount(live.current.p, it.id), 0);
      const ok = await confirm({ title: '刪除 Item', danger: true, okText: '刪除',
        message: '刪除 ' + items.map(i => i.item_no || '(未編號)').join(', ') + '？' + (pads ? '\n位置圖上這些 Item 的 ' + pads + ' 片 pad 與標籤也會一併移除。' : '') + '\n可用 Ctrl+Z 復原。' });
      if (!ok) return;
      A().deleteItems(p.id, items.map(i => i.id));
      setRange(null);
      if (items.some(i => i.id === openId)) go('p/' + p.id + '/bom');
    };
    const rowMenu = (e, it) => {
      e.preventDefault();
      const p = live.current.p;
      it = p.items.find(x => x.id === it.id) || it;
      const multi = selRows();
      const targets = multi && multi.some(x => x.id === it.id) ? multi : [it];
      openMenu(e, [
        { label: '開啟詳細', icon: 'chevR', onClick: () => go('p/' + p.id + '/bom/' + it.id) },
        'sep',
        { label: '在上方插入', icon: 'plus', disabled: ro, onClick: () => addRow(it.location_id, null, it.id) },
        { label: '在下方插入', icon: 'plus', disabled: ro, onClick: () => addRow(it.location_id, it.id) },
        { label: '複製此列', icon: 'copy', disabled: ro, onClick: () => A().duplicateItem(p.id, it.id) },
        { label: '複製為尺寸變體（' + util.nextVariantNo(it.item_no, p.items.map(i => i.item_no)) + '）', icon: 'copy', disabled: ro, onClick: () => A().duplicateItem(p.id, it.id, true) },
        { header: '移到 Location' },
      ].concat(p.locations.filter(l => l.id !== it.location_id).map(l => ({ label: l.name, icon: 'chevR', disabled: ro, onClick: () => targets.forEach(x => A().moveItem(p.id, x.id, l.id)) })))
        .concat(['sep', { label: targets.length > 1 ? '刪除選取的 ' + targets.length + ' 列' : '刪除此列', icon: 'trash', danger: true, disabled: ro, onClick: () => deleteRows(targets) }]));
    };

    // ── drag rows ──
    const onDragStart = (e, it) => { dragRow.current = it.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.item_no || ''); };
    const onDragOverRow = (e, it) => {
      if (!dragRow.current) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const below = e.clientY > rect.top + rect.height / 2;
      const vis = live.current.visible;
      const idx = vis.findIndex(x => x.id === it.id);
      const next = vis[idx + 1];
      const before = below ? (next && next.location_id === it.location_id ? next.id : null) : it.id;
      const cur = dropRef.current;
      if (!cur || cur.before !== before || cur.loc !== it.location_id) setDrop({ before, loc: it.location_id, after: below ? it.id : null });
    };
    const onDragOverFoot = (e, loc) => { if (!dragRow.current) return; e.preventDefault(); const cur = dropRef.current; if (!cur || cur.loc !== loc.id || cur.before !== null) setDrop({ before: null, loc: loc.id }); };
    const onDrop = e => {
      e.preventDefault();
      const id = dragRow.current;
      dragRow.current = null;
      const d = dropRef.current;
      setDrop(null);
      if (!id || !d || d.before === id) return;
      A().moveItem(p.id, id, d.loc, d.before);
    };
    const onDragEnd = () => { dragRow.current = null; setDrop(null); };

    // ── render helpers ──
    const totalW = cols.reduce((s, c) => s + c.width, 0) + 34 + 34 + 72;
    const renderCell = (col, it, ctx, r, c) => {
      const dc = r + ',' + c;
      const cls = cx(col.cls && col.cls(it, ctx), inRange(r, c) && 'in-range', col.kind === 'calc' && 'c-calc');
      const title = col.title ? col.title(it, ctx) : undefined;
      if (col.kind === 'text') {
        return html`<td class=${cls} title=${title}><${TextField} class=${cx('cell-inp', col.mono && 'mono')} value=${A().getPath(it, col.path)} disabled=${ro}
          dataCell=${dc} onChange=${v => A().updateItem(p.id, it.id, col.path, v)} /></td>`;
      }
      if (col.kind === 'num') {
        const extra = col.key === 'qty' && hasViews ? (() => {
          const n = placed[it.id] || 0;
          const ok = it.qty != null && n === it.qty;
          return html`<span class=${cx('qty-badge', ok ? 'ok' : 'bad')} style="position:absolute;left:6px;top:8px;pointer-events:none" title=${'位置圖已放置 ' + n + ' 片'}>${n}${ok ? '✓' : '≠'}</span>`;
        })() : null;
        return html`<td class=${cls} title=${title}>${extra}<${NumField} class="cell-inp r" right=${true} value=${A().getPath(it, col.path)} disabled=${ro}
          dataCell=${dc} onChange=${v => A().updateItem(p.id, it.id, col.path, v)} /></td>`;
      }
      if (col.kind === 'select') {
        const locked = col.lockedByMaterial && ctx.mat;
        if (locked) return html`<td class=${cls} title="由材料庫帶入（連結材料時不可改）"><div class="cell-ro" tabindex="0" data-cell=${dc}>${schema.timType(ctx.eff.tim_type).label}</div></td>`;
        const v = A().getPath(it, col.path) || '';
        return html`<td class=${cls}><select class="cell-inp" data-cell=${dc} value=${v} disabled=${ro}
            onChange=${e => A().updateItem(p.id, it.id, col.path, e.target.value, { coalesce: false })}>
          ${col.allowEmpty ? html`<option value="">—</option>` : null}
          ${col.options.map(o => html`<option value=${o.v}>${o.label}</option>`)}
        </select></td>`;
      }
      if (col.kind === 'material') {
        if (ctx.mat) {
          return html`<td class=${cls} title=${'連結材料庫：' + ctx.mat.vendor + ' ' + ctx.mat.model + '（在材料庫修改）'}>
            <div class="cell-ro" tabindex="0" data-cell=${dc} onDblClick=${() => go('p/' + p.id + '/bom/' + it.id)}>
              ${col.field === 'vendor' ? html`<span class="linkmark"><${Icon} name="link" /></span>` : null}<span class="ellipsis">${ctx.eff[col.field]}</span>
            </div></td>`;
        }
        const sug = col.field === 'model' && (it.vendor || it.model) ? A().findMaterial(it.vendor, it.model) : null;
        return html`<td class=${cls}>
          <${TextField} class="cell-inp" value=${it[col.field]} disabled=${ro} dataCell=${dc} list=${col.field === 'vendor' ? 'dl-vendors' : 'dl-models'}
            onChange=${v => A().updateItem(p.id, it.id, col.field, v)} />
          ${sug && !ro ? html`<button class="icon-btn" style="position:absolute;right:2px;top:3px;color:var(--d-500)" title=${'材料庫有相同材料，點擊連結：' + sug.vendor + ' ' + sug.model}
            onClick=${() => A().linkMaterial(p.id, it.id, sug.id)}><${Icon} name="link" /></button>` : null}
        </td>`;
      }
      if (col.kind === 'parsed') {
        const txt = col.text(it, ctx);
        return html`<td class=${cls} title=${title || txt}><${TextField} class=${cx('cell-inp', col.mono && 'mono')} value=${txt} commit="blur" disabled=${ro} dataCell=${dc}
          onChange=${v => {
            const pt = col.parse(v, it);
            if (!pt) { toast(col.label + ' 格式無法解析：「' + v + '」', 'warn'); return; }
            A().patchItems(p.id, [{ itemId: it.id, patch: pt }], col.label);
          }} /></td>`;
      }
      // calc
      return html`<td class=${cls} title=${title}><div class=${cx('cell-ro', col.align === 'r' && 'r', 'mono')} tabindex="0" data-cell=${dc}>${col.text(it, ctx)}</div></td>`;
    };

    const groupsOn = Object.keys(groups).filter(k => groups[k]);
    const colsKey = cols.map(c => c.key).join(',');
    const setSig = JSON.stringify(db.settings.generic_comp || null);
    const libSig = Object.keys(db.materials).length + ':' + Object.values(db.materials).reduce((m, x) => (String(x.updated_at) > m ? String(x.updated_at) : m), '');
    const totalPcs = visible.reduce((s, it) => s + (it.status !== 'obsolete' && Number.isFinite(it.qty) ? it.qty : 0), 0);

    return html`
      <div class="bom-toolbar">
        <button class="btn btn-primary btn-sm rw-only" onClick=${() => addRow(visible.length ? visible[visible.length - 1].location_id : (p.locations[0] && p.locations[0].id))}><${Icon} name="plus" /> 新增 Item</button>
        <button class="btn btn-secondary btn-sm rw-only" onClick=${() => openModal(close => html`<${PasteRowsModal} p=${p} close=${close} />`)}><${Icon} name="paste" /> 從 Excel 貼上多列</button>
        <span class="field-label" style="margin-left:6px">欄位</span>
        <div class="seg">
          ${[['mech', '機構'], ['thermal', '熱'], ['supply', '供應'], ['trace', '追溯']].map(([k, l]) =>
            html`<button class=${groups[k] ? 'on' : ''} onClick=${() => setGroups(Object.assign({}, groups, { [k]: !groups[k] }))}>${l}</button>`)}
        </div>
        <div class="searchbox" style="width:220px"><${Icon} name="search" /><input class="inp" style="height:28px" placeholder="篩選…" value=${filter} onInput=${e => setFilter(e.target.value)} /></div>
        <label class="check"><input type="checkbox" checked=${showObsolete} onChange=${e => setShowObsolete(e.target.checked)} /> 顯示停用</label>
        <button class="btn btn-ghost btn-sm rw-only" title="依 Item 編號排序（每個 Location 內）" onClick=${() => A().sortItems(p.id)}>依編號排序</button>
        <span class="grow"></span>
        <div class="legend">
          <span><i class="swatch" style="background:var(--risk-single-bg)"></i>單一來源</span>
          <span><i class="swatch" style="background:#FFF8E4"></i>第二來源未承認</span>
          ${hasViews ? html`<span class="mono">4✓ / 3≠ 位置圖放置數</span>` : null}
          <span class="mono">${visible.length} items · ${totalPcs} pcs</span>
        </div>
      </div>
      <div class="bom-wrap">
        <datalist id="dl-vendors">${vendors.map(v => html`<option value=${v} />`)}</datalist>
        <datalist id="dl-models">${models.map(v => html`<option value=${v} />`)}</datalist>
        <div class="grid-scroll" ref=${tableRef} onKeyDown=${onKeyDown} onfocusin=${onFocusIn} onCopy=${onCopy} onPaste=${onPaste}
          onMouseDown=${onMouseDown} onMouseOver=${onMouseOver} onDrop=${onDrop} onDragEnd=${onDragEnd}>
          <table class="grid" style=${{ minWidth: totalW + 'px' }}>
            <colgroup><col style="width:34px" /><col style="width:28px" />${cols.map(c => html`<col style=${{ width: c.width + 'px' }} />`)}<col style="width:72px" /></colgroup>
            <thead><tr>
              <th title="Location">Loc</th><th>#</th>
              ${cols.map(c => html`<th class=${c.group !== 'basic' ? 'grp-' + c.group : ''} style=${{ textAlign: c.align === 'r' ? 'right' : 'left' }}>${c.label}${c.sub ? html`<span class="th-sub">${c.sub}</span>` : null}</th>`)}
              <th></th>
            </tr></thead>
            <tbody>
              ${p.locations.map(loc => {
                const rows = visible.filter(it => it.location_id === loc.id);
                if (!rows.length && q) return null;
                const pcs = rows.reduce((s, it) => s + (it.status !== 'obsolete' && Number.isFinite(it.qty) ? it.qty : 0), 0);
                const cost = rows.reduce((s, it) => s + (it.status !== 'obsolete' ? (calc.itemCost(it) || 0) : 0), 0);
                const fg = util.textOn(loc.color);
                const band = html`<td class="loc-band" rowspan=${rows.length + 1} style=${{ background: loc.color, color: fg }} onContextMenu=${e => { e.preventDefault(); }}>
                  <span class="loc-text">${loc.name}</span></td>`;
                const out = rows.map((it, i) => {
                  const r = visible.indexOf(it);
                  const ctx = ctxs[it.id];
                  const isDrop = dropAt && dropAt.before === it.id && dragRow.current;
                  const b = rangeBox();
                  const rowRange = b && (b.r1 > b.r0 || b.c1 > b.c0) && r >= b.r0 && r <= b.r1 ? b.c0 + '-' + b.c1 : '';
                  const next = visible[r + 1];
                  const sig = [JSON.stringify(it), ctx.mat ? ctx.mat.id + ctx.mat.updated_at + ctx.mat.rev : '', libSig, hasViews ? placed[it.id] || 0 : '',
                    r, next ? next.id + next.location_id : '', i === 0 ? loc.id + loc.name + loc.color + rows.length : '',
                    openId === it.id, dragRow.current === it.id, !!isDrop, rowRange, ro, colsKey, dtWarn, setSig].join('|');
                  return html`<${GridRow} key=${it.id} sig=${sig} render=${() => html`
                    <tr data-id=${it.id} class=${cx(openId === it.id && 'sel-row', it.status === 'obsolete' && 'row-obsolete', dragRow.current === it.id && 'dragging', isDrop && 'drop-before')}
                      onDragOver=${e => onDragOverRow(e, it)}>
                      ${i === 0 ? band : null}
                      <td class="row-handle" draggable=${!ro} title="拖曳排序 · 右鍵選單 · 雙擊開啟詳細"
                        onDragStart=${e => onDragStart(e, it)} onContextMenu=${e => rowMenu(e, it)}
                        onClick=${() => setRange({ r0: r, c0: 0, r1: r, c1: cols.length - 1 })}
                        onDblClick=${() => go('p/' + p.id + '/bom/' + it.id)}>${r + 1}</td>
                      ${cols.map((col, c) => renderCell(col, it, ctx, r, c))}
                      <td class="row-end"><div class="inner">
                        <button class="icon-btn" title="詳細（所有欄位）" onClick=${() => go('p/' + p.id + '/bom/' + it.id)}><${Icon} name="chevR" /></button>
                        <button class="icon-btn" title="更多" onClick=${e => rowMenu(e, it)}><${Icon} name="more" /></button>
                      </div></td>
                    </tr>`} />`;
                });
                const footDrop = dropAt && dropAt.loc === loc.id && dropAt.before === null && dragRow.current;
                return html`${out}
                  <tr class=${cx('grp-foot', footDrop && 'drop-before')} key=${'f' + loc.id} onDragOver=${e => onDragOverFoot(e, loc)}>
                    ${rows.length ? null : html`<td class="loc-band" style=${{ background: loc.color, color: fg }}><span class="loc-text" style="font-size:10px">${loc.name}</span></td>`}
                    <td colspan=${cols.length + 2}><div class="grp-foot-inner">
                      <button class="btn btn-ghost btn-xs rw-only" onClick=${() => addRow(loc.id)}><${Icon} name="plus" /> 新增至 ${loc.name}</button>
                      <span class="mono"><b>${rows.length}</b> items · <b>${pcs}</b> pcs${cost ? html` · <b>${util.fmt(cost, 2)}</b>` : null}</span>
                    </div></td>
                  </tr>`;
              })}
            </tbody>
          </table>
          ${!p.items.length ? html`<div class="empty" style="margin:18px;border-style:dashed">
            <h3>這個專案還沒有 TIM Item</h3>
            <p>可以直接從 Excel 複製整列貼上（含 Location 欄），或點「新增 Item」逐列建立。Size 可直接打 <span class="mono">51.5*9*3</span>，Note 可打 <span class="mono">LDO-A*2, BUCK-B*4</span>，2nd source 可打 <span class="mono">Vendor-A only source</span>。</p>
            <div class="actions rw-only">
              <button class="btn btn-primary" onClick=${() => openModal(close => html`<${PasteRowsModal} p=${p} close=${close} />`)}><${Icon} name="paste" /> 從 Excel 貼上多列</button>
              <button class="btn btn-secondary" onClick=${() => addRow(p.locations[0] && p.locations[0].id)}><${Icon} name="plus" /> 新增 Item</button>
            </div>
          </div>` : null}
        </div>
        <div class="muted" style="font-size:11px;margin-top:6px">
          方向鍵 / Tab / Enter 移動 · Shift+方向鍵或拖曳框選 · Ctrl+C 複製 · Ctrl+V 貼上（多格）· Delete 清除 · Ctrl+D 向下填滿 · Esc 復原此格 · 右鍵列號：插入 / 複製 / 移動 / 刪除
          ${groupsOn.length ? '' : ' · 上方「欄位」可展開機構 / 熱 / 供應 / 追溯欄'}
        </div>
      </div>
      ${openId ? html`<${TIM.ui.ItemDrawer} p=${p} itemId=${openId} onClose=${() => go('p/' + p.id + '/bom')} />` : null}
    `;
  }

  TIM.ui.Bom = Bom;
  TIM.ui.bomInternals = { buildColumns, cellText, cellPatch, sizeParse, secondParse };
})();
