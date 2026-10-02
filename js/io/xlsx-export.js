/* Excel export (ExcelJS). Sheet "TIM List" reproduces the existing Excel layout:
 * Location (merged, rotated) | Item | Used On | Vendor | Model | Size | Q'ty | Delta Part No. | Note | 2nd source,
 * location colours on the rows, pink 2nd-source cells for single-source items, and the
 * annotated placement drawings below the table. Detail sheets follow. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { util, schema, parse, calc } = TIM;

  const EXTRA_COLUMNS = [
    { key: 'tim_type', header: 'Type', width: 14, get: (c) => schema.timType(c.eff.tim_type).label },
    { key: 'k', header: 'k (W/m·K)', width: 10, get: (c) => c.eff.k, num: true },
    { key: 'status', header: 'Status', width: 9, get: (c) => schema.labelOf(schema.ITEM_STATUS, c.it.status) },
    { key: 'gap', header: 'Gap min/nom/max (mm)', width: 18, get: (c) => { const g = c.comp.gap || calc.gapInfo(c.it); return fmtTriple(g.min, g.nom, g.max); } },
    { key: 'comp', header: 'Compression (%)', width: 15, get: (c) => c.comp.status === 'na' ? '' : util.fmt(c.comp.min, 1) + ' ~ ' + util.fmt(c.comp.max, 1) },
    { key: 'pressure', header: 'Pressure max (psi)', width: 13, get: (c) => c.comp.pressure ? (c.comp.pressure.beyond ? '> ' : '') + util.fmt(c.comp.pressure.psi, 1) : '' },
    { key: 'power', header: 'P_TIM (W/pc max)', width: 13, get: (c) => { const ps = c.it.covered.map(calc.timPower).filter(Number.isFinite); return ps.length ? util.round(Math.max.apply(null, ps), 3) : null; }, num: true },
    { key: 'dt', header: 'ΔT_TIM (°C)', width: 11, get: (c) => c.th.dt_max === null ? null : util.round(c.th.dt_max, 2), num: true },
    { key: 'price', header: 'Unit price', width: 10, get: (c) => c.it.price.unit, num: true },
    { key: 'subtotal', header: 'Subtotal', width: 10, get: (c) => calc.itemCost(c.it), num: true },
    { key: 'vendor_pn', header: 'Vendor P/N', width: 16, get: (c) => c.it.vendor_pn },
    { key: 'fabricator', header: 'Fabricator', width: 14, get: (c) => c.it.fabricator },
    { key: 'placed', header: 'Placed', width: 8, get: (c) => c.placed, num: true },
  ];

  function fmtTriple(a, b, c) {
    if (a == null && b == null && c == null) return '';
    return [a, b, c].map(v => (v == null ? '-' : util.fmt(v, 3))).join(' / ');
  }
  const argb = hex => 'FF' + String(hex || '#FFFFFF').replace('#', '').toUpperCase();
  const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
  const thin = { style: 'thin', color: { argb: 'FF7F7F7F' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const PINK = '#F9CBF0', AMBER = '#FFF2CC';

  /** Text for the "2nd source" column (keeps the original wording style). */
  function secondSourceText(it, eff) {
    const risk = calc.sourceRisk(it);
    if (risk === 'single') return it.sourcing_note || ((eff.vendor || 'Vendor') + ' only source');
    return it.sourcing_note && it.sources.some(s => s.note) ? it.sourcing_note : parse.formatSources(it);
  }

  const TIM_LIST_HEADERS = ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source'];

  /**
   * TIM List content shared by the Excel and PDF exports: location groups (in location order)
   * of rows { it, vals (10 base columns, Location first), extraVals, risk }.
   */
  function timListGroups(p, db, opts) {
    opts = opts || {};
    const extras = EXTRA_COLUMNS.filter(c => (opts.extra || []).includes(c.key));
    const placed = calc.placedCounts(p);
    const items = calc.orderedItems(p).filter(it => opts.includeObsolete || it.status !== 'obsolete');
    return p.locations.map(loc => ({
      loc,
      rows: items.filter(it => it.location_id === loc.id).map(it => {
        const mat = calc.materialOf(db, it);
        const eff = calc.effective(it, mat);
        const ctx = { it, eff, comp: calc.compressionCheck(it, mat, db.settings), th: calc.thermalEstimate(it, mat), placed: placed[it.id] || 0 };
        return {
          it,
          risk: calc.sourceRisk(it),
          vals: [
            loc.name, it.item_no, parse.formatUsedOn(it.used_on), eff.vendor, eff.model,
            schema.isDispense(eff.tim_type) ? (it.dispense.amount != null ? it.dispense.amount + ' ' + it.dispense.unit : '') : parse.formatSize(it.size),
            Number.isFinite(it.qty) ? it.qty : null, it.delta_pn || '', parse.formatCovered(it.covered), secondSourceText(it, eff),
          ],
          extraVals: extras.map(e => { const v = e.get(ctx); return v === undefined ? '' : v; }),
        };
      }),
    })).filter(g => g.rows.length);
  }

  function colLeftPx(ws, colIdx) {
    let px = 0;
    for (let i = 1; i <= colIdx; i++) px += Math.round(((ws.getColumn(i).width || 9) * 7) + 5);
    return px;
  }

  async function buildWorkbook(pid, opts) {
    opts = opts || {};
    const ExcelJS = await TIM.loader.load('exceljs');
    const db = TIM.store.db;
    const p = db.projects[pid];
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TIM Management Tool';
    wb.created = new Date();
    const extras = EXTRA_COLUMNS.filter(c => (opts.extra || []).includes(c.key));

    // ───────── TIM List ─────────
    const ws = wb.addWorksheet('TIM List', { views: [{ state: 'frozen', ySplit: 1 }] });
    const base = TIM_LIST_HEADERS.map((h, i) => ({ header: h, width: [7, 8, 11, 14, 18, 15, 6, 15, 36, 26][i] }));
    const cols = base.concat(extras.map(e => ({ header: e.header, width: e.width })));
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.width; });
    const head = ws.getRow(1);
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { bold: true, name: 'Arial', size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      cell.fill = fill(i < base.length ? '#D9E1F2' : '#E2EFDA');
    });
    head.height = 22;

    let r = 2;
    timListGroups(p, db, opts).forEach(({ loc, rows }) => {
      const startRow = r;
      const fg = util.textOn(loc.color) === '#FFFFFF' ? 'FFFFFFFF' : 'FF000000';
      rows.forEach(({ it, vals: base10, extraVals, risk }) => {
        const vals = base10.concat(extraVals);
        const row = ws.getRow(r);
        vals.forEach((v, i) => {
          const cell = row.getCell(i + 1);
          cell.value = v === null ? null : v;
          cell.font = { name: 'Arial', size: 10, color: { argb: fg } };
          cell.alignment = { vertical: 'middle', horizontal: i === 8 || i === 9 ? 'left' : 'center', wrapText: i === 8 };
          cell.border = border;
          cell.fill = fill(loc.color);
        });
        row.getCell(8).numFmt = '@';
        const sc = row.getCell(10);
        if (risk === 'single') { sc.fill = fill(PINK); sc.font = { name: 'Arial', size: 10, color: { argb: 'FFB4237A' } }; }
        else if (risk === 'unverified') { sc.fill = fill(AMBER); sc.font = { name: 'Arial', size: 10, color: { argb: 'FF000000' } }; }
        if (it.status === 'obsolete') row.eachCell(c => { c.font = Object.assign({}, c.font, { strike: true }); });
        r++;
      });
      if (r - 1 > startRow) ws.mergeCells(startRow, 1, r - 1, 1);
      const lc = ws.getCell(startRow, 1);
      lc.value = loc.name;
      lc.alignment = { textRotation: 90, vertical: 'middle', horizontal: 'center' };
      lc.font = { name: 'Arial', size: 10, bold: true, color: { argb: fg } };
      lc.fill = fill(loc.color);
      lc.border = border;
    });

    // legend + provenance
    r += 1;
    const legend = ws.getCell(r, 1);
    legend.value = '2nd source 底色：粉紅 = 單一來源（無第二來源）、淺黃 = 第二來源尚未承認';
    legend.font = { name: 'Arial', size: 9, color: { argb: 'FF595959' } };
    ws.getCell(r + 1, 1).value = '匯出：' + p.name + ' · ' + p.stage + ' · ' + util.fmtDateTime(util.nowIso()) + ' · TIM Management Tool';
    ws.getCell(r + 1, 1).font = { name: 'Arial', size: 9, color: { argb: 'FF595959' } };
    r += 3;

    // annotated drawings, two per row (like the existing sheet)
    if (opts.images !== false) {
      const views = p.views.filter(v => v.image_id && db.images[v.image_id]);
      const IMG_W = 560;
      let col = 0, blockRows = 0;
      for (const v of views) {
        let png;
        try { png = await TIM.renderView.renderViewPng(p, v, { maxSide: 1600 }); } catch (e) { continue; }
        const scale = IMG_W / png.width;
        const h = Math.round(png.height * scale);
        const startCol = col === 0 ? 0 : (() => { let c = 1; while (colLeftPx(ws, c) < IMG_W + 24 && c < 40) c++; return c; })();
        const title = ws.getCell(r, startCol + 1);
        title.value = v.name || 'View';
        title.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFF0000' } };
        const imgId = wb.addImage({ base64: png.dataUrl, extension: 'png' });
        ws.addImage(imgId, { tl: { col: startCol, row: r }, ext: { width: IMG_W, height: h } });
        blockRows = Math.max(blockRows, Math.ceil(h / 20) + 3);
        col++;
        if (col === 2) { r += blockRows; col = 0; blockRows = 0; }
      }
      if (col !== 0) r += blockRows;
    }

    if (opts.details !== false) addDetailSheets(wb, p, db, calc.orderedItems(p).filter(it => opts.includeObsolete || it.status !== 'obsolete'));
    return wb;
  }

  function addSheet(wb, name, headers, rows, widths) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.addRow(headers);
    ws.getRow(1).eachCell(c => { c.font = { bold: true, name: 'Arial', size: 10 }; c.fill = fill('#D9E1F2'); c.border = border; c.alignment = { vertical: 'middle', wrapText: true }; });
    rows.forEach(rw => {
      const row = ws.addRow(rw.map(v => (v === undefined ? null : v)));
      row.eachCell({ includeEmpty: true }, c => { c.font = { name: 'Arial', size: 10 }; c.border = border; c.alignment = { vertical: 'top', wrapText: true }; });
    });
    (widths || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    if (rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: headers.length } };
    return ws;
  }

  function addDetailSheets(wb, p, db, items) {
    const locName = it => { const l = calc.locationOf(p, it); return l ? l.name : ''; };
    // Components
    const comp = [];
    items.forEach(it => it.covered.forEach(c => comp.push([it.item_no, locName(it), c.part, c.refdes, c.qty, c.cat, c.power_w, c.top_pct == null ? 100 : c.top_pct, calc.timPower(c), c.pkg_l != null && c.pkg_w != null ? c.pkg_l + '*' + c.pkg_w : '', c.note])));
    addSheet(wb, 'Components', ['Item', 'Location', 'Part', 'RefDes', 'Qty', 'Category', 'Power (W/pc)', 'Top-side %', 'P_TIM (W/pc)', 'Pkg L*W (mm)', 'Note'], comp, [8, 13, 20, 18, 6, 9, 11, 10, 11, 12, 30]);

    // 2nd source
    const src = [];
    items.forEach(it => {
      const eff = calc.effective(it, calc.materialOf(db, it));
      const primary = [eff.vendor, eff.model].filter(Boolean).join(' ');
      const risk = { single: '單一來源', unverified: '未承認', ok: '已承認' }[calc.sourceRisk(it)];
      if (!it.sources.length) src.push([it.item_no, primary, it.delta_pn, '', '', '', '', '', '', risk, it.sourcing_note]);
      it.sources.forEach(s => src.push([it.item_no, primary, it.delta_pn, s.vendor, s.model, s.mpn, s.delta_pn, schema.labelOf(schema.SOURCE_STATUS, s.status), s.note, risk, it.sourcing_note]));
    });
    addSheet(wb, '2nd Source', ['Item', 'Primary', 'Delta P/N', '2nd Vendor', '2nd Model', 'MPN', '2nd Delta P/N', 'Status', 'Note', 'Risk', 'Strategy'], src, [8, 24, 14, 14, 16, 14, 14, 9, 14, 10, 26]);

    // Gap & thermal
    const JUDGE = { na: '', ok: 'OK', warn: 'Warning', error: 'Fail' };
    const r1 = v => (v == null ? null : util.round(v, 1));
    const psi = r => (r ? (r.beyond ? '> ' : '') + util.fmt(r.psi, 1) : '');
    const gt = [], prs = [];
    items.forEach(it => {
      const mat = calc.materialOf(db, it);
      const cc = calc.compressionCheck(it, mat, db.settings);
      const th = calc.thermalEstimate(it, mat);
      const g = cc.gap || calc.gapInfo(it);
      gt.push([it.item_no, it.size.t, it.gap_design.nom, it.gap_design.plus, it.gap_design.minus, { stack: '設計間距', manual: '手動' }[g.source] || '',
        g.min, g.nom, g.max, r1(cc.min), r1(cc.nom), r1(cc.max),
        cc.rec ? cc.rec.min + ' (' + { item: '手動', generic: '一般值' }[cc.rec.source] + ')' : '', psi(cc.pressure),
        JUDGE[cc.status], th.k, r1(th.area), th.R_pad == null ? null : util.round(th.R_pad, 3), th.dt_max == null ? null : util.round(th.dt_max, 2), cc.msgs.concat(cc.notes).join('；')]);
      cc.comps.forEach(r => prs.push([it.item_no, r.part, r.refdes, r.h ? r.h.min : null, r.h ? r.h.nom : null, r.h ? r.h.max : null,
        r.gap.min, r.gap.nom, r.gap.max, r1(r.cMin), r1(r.cMax), psi(r.pMin), psi(r.pMax), r1(r.force),
        r.allow ? r.allow.value + ' ' + r.allow.unit : '', r.allow && r.allow.psi != null ? r1(r.allow.psi) : null, r.ratio == null ? null : util.round(r.ratio, 0), JUDGE[r.status], r.msg]));
    });
    addSheet(wb, 'Gap & Thermal', ['Item', 'T (mm)', 'Design gap', 'Gap tol +', 'Gap tol −', 'Gap source', 'Gap min', 'Gap nom', 'Gap max', 'Comp min %', 'Comp nom %', 'Comp max %', 'Min comp %', 'Pressure max (psi)', 'Judge', 'k', 'Area (mm²)', 'R_TIM (°C/W)', 'ΔT max (°C)', 'Remarks'],
      gt, [8, 7, 9, 7, 7, 10, 8, 8, 8, 10, 10, 10, 13, 14, 9, 7, 10, 11, 11, 50]);
    if (prs.length) {
      addSheet(wb, 'Pressure', ['Item', 'Component', 'RefDes', 'H min', 'H nom', 'H max', 'Gap min', 'Gap nom', 'Gap max', 'Comp min %', 'Comp max %', 'Pressure min (psi)', 'Pressure max (psi)', 'Force max (N)', 'Allowable', 'Allowable (psi)', 'Ratio %', 'Judge', 'Remarks'],
        prs, [8, 16, 12, 7, 7, 7, 8, 8, 8, 10, 10, 13, 13, 11, 12, 12, 8, 9, 50]);
    }

    // Changelog
    const log = (p.changelog || []).slice().reverse().map(c => [util.fmtDateTime(c.ts), c.user, schema.labelOf(schema.CHANGE_KINDS, c.kind), c.item_no, c.field, c.from, c.to, c.text, c.ecn]);
    addSheet(wb, 'Changelog', ['Time', 'User', 'Kind', 'Item', 'Field', 'From', 'To', 'Text', 'ECN'], log, [17, 12, 9, 8, 14, 22, 22, 40, 14]);

    // Project
    const pr = [
      ['案名', p.name], ['專案代碼', p.code], ['產品類型', schema.productTypeLabel(p.product_type)], ['客戶', p.customer], ['Stage', p.stage],
      ['熱流負責人', p.owner], ['機構負責人', p.me_owner], ['備註', p.description], ['匯出時間', util.fmtDateTime(util.nowIso())],
    ];
    calc.materialUsage(p, db).forEach(m => pr.push(['材料用量', m.vendor + ' ' + m.model + '：' + (m.usage || '—') + '（' + m.items.join(', ') + '）']));
    addSheet(wb, 'Project', ['欄位', '內容'], pr, [14, 80]);
  }

  async function exportProjectXlsx(pid, opts) {
    const wb = await buildWorkbook(pid, opts);
    const buf = await wb.xlsx.writeBuffer();
    const p = TIM.store.db.projects[pid];
    const name = util.fileSafe(p.name) + '_TIM_' + util.fileSafe(p.stage) + '_' + util.todayStr().replace(/-/g, '') + '.xlsx';
    TIM.ui.downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name);
    return name;
  }

  TIM.xlsxExport = { EXTRA_COLUMNS, TIM_LIST_HEADERS, PINK, AMBER, timListGroups, buildWorkbook, exportProjectXlsx, secondSourceText };
})();
