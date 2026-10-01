/* PDF report — same approach and page frame as the Thermal Test Report Builder: every A4
 * landscape page is laid out as HTML off-screen, captured with html2canvas and placed in a
 * jsPDF document, so Chinese text is drawn by the browser and no fonts need embedding.
 * Pages: overview · TIM List (same columns / colours as the Excel sheet, split across pages
 * with the header repeated) · one page per placement view · material usage + compression.
 * NOTE: html2canvas mis-renders letter-spacing — nothing here may use it. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { util, schema, calc } = TIM;
  const esc = s => util.escapeHtml(s == null ? '' : String(s));

  const W = 842, H = 595;                        // A4 landscape, 1 px = 1 pt (captured at 2×)
  const PAD_X = 34, TOP = 28, HEAD_H = 46, BOTTOM = 36;
  const BODY_TOP = TOP + HEAD_H + 10;
  const BODY_W = W - PAD_X * 2;                  // 774
  const BODY_H = H - BODY_TOP - BOTTOM;          // 475
  const FONT = "'DM Sans','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const HFONT = "'Space Grotesk','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif";
  const MONO = "'JetBrains Mono',ui-monospace,Menlo,Consolas,monospace";
  const INK = '#0F1B2D', INK2 = '#3B4A5E', INK3 = '#6B7A90', LINE = '#7F7F7F', BLUE = '#2357A7';
  const LEVEL = { error: ['✕', '#C0392B'], warn: ['!', '#B7791F'], info: ['i', '#2357A7'] };

  const SECTIONS = [
    { key: 'overview', label: '總覽：專案資訊、狀態、待處理事項' },
    { key: 'list', label: 'TIM 清單：與 Excel「TIM List」相同欄位與底色' },
    { key: 'maps', label: '位置標註圖：每張視圖一頁，含圖例' },
    { key: 'checks', label: '材料用量彙總與壓縮率檢核' },
  ];

  // ───────── page frame ─────────
  function frame(p, o, inner) {
    const bar = 'linear-gradient(90deg,#0B3D7A,#2357A7,#3A7AD4,#5BA3E6,#6EC5A0,#4CAF79)';
    const c = 'position:absolute;width:26px;height:26px;';
    return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#fff;color:${INK};font-family:${FONT};font-size:10px;line-height:1.45">
      <div style="position:absolute;top:0;left:0;right:0;height:8px;background:${bar}"></div>
      <div style="position:absolute;bottom:0;left:0;right:0;height:8px;background:${bar}"></div>
      <div style="${c}top:13px;left:13px;border-top:1.5px solid #8DC4F0;border-left:1.5px solid #8DC4F0"></div>
      <div style="${c}top:13px;right:13px;border-top:1.5px solid #8DC4F0;border-right:1.5px solid #8DC4F0"></div>
      <div style="${c}bottom:13px;left:13px;border-bottom:1.5px solid #8DC4F0;border-left:1.5px solid #8DC4F0"></div>
      <div style="${c}bottom:13px;right:13px;border-bottom:1.5px solid #8DC4F0;border-right:1.5px solid #8DC4F0"></div>
      <div style="position:absolute;left:${PAD_X}px;right:${PAD_X}px;top:${TOP}px;height:${HEAD_H}px;box-sizing:border-box;padding-bottom:6px;border-bottom:1.5px solid ${INK};display:flex;align-items:flex-end;justify-content:space-between">
        <div><div style="font:600 8.5px ${MONO};color:${BLUE}">${esc(o.kicker)}</div>
          <div style="font:700 17px ${HFONT};margin-top:3px;color:${INK}">${esc(o.title)}</div></div>
        <div style="text-align:right;font-size:9px;color:${INK3};line-height:1.5">${esc(p.name)}<br/>${esc([p.stage, schema.productTypeLabel(p.product_type), util.todayStr()].filter(Boolean).join(' · '))}</div>
      </div>
      <div style="position:absolute;left:${PAD_X}px;top:${BODY_TOP}px;width:${BODY_W}px;height:${BODY_H}px;overflow:hidden">${inner}</div>
      <div style="position:absolute;left:${PAD_X}px;right:${PAD_X}px;bottom:16px;display:flex;justify-content:space-between;font:8px ${MONO};color:rgba(15,23,42,.45)">
        <span>專案 TIM 管理器 · ${esc(p.name)}</span><span>CONFIDENTIAL · ${o.no} / ${o.count}</span>
      </div>
    </div>`;
  }
  const sectionTitle = (t, sub) => `<div style="display:flex;align-items:baseline;gap:8px;margin:0 0 6px"><span style="font:700 12px ${HFONT}">${esc(t)}</span>${sub ? `<span style="font-size:9px;color:${INK3}">${esc(sub)}</span>` : ''}</div>`;
  const TITLE_H = 24;

  // ───────── tables ─────────
  // html2canvas draws each cell's own border (border-collapse doubles shared edges), so cells
  // only draw right / bottom and the table draws top / left.
  const cellCss = 'border-right:0.75px solid ' + LINE + ';border-bottom:0.75px solid ' + LINE + ';padding:3px 4px;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word';
  function colgroup(widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    return '<colgroup>' + widths.map(w => `<col style="width:${(w / total * 100).toFixed(3)}%">`).join('') + '</colgroup>';
  }
  function table(widths, headHtml, rowsHtml) {
    return `<table style="width:100%;border-collapse:separate;border-spacing:0;border-top:0.75px solid ${LINE};border-left:0.75px solid ${LINE};table-layout:fixed;font-size:9px">${colgroup(widths)}<thead>${headHtml}</thead><tbody>${rowsHtml}</tbody></table>`;
  }
  const th = (t, align) => `<th style="${cellCss};background:#D9E1F2;font-weight:700;text-align:${align || 'center'}">${esc(t)}</th>`;
  const td = (t, css) => `<td style="${cellCss};${css || ''}">${t}</td>`;

  /** Heights (px) of the header row and each body row, measured off-screen at page width. */
  function measure(widths, headHtml, rows) {
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-20000px;top:0;width:${BODY_W}px;font-family:${FONT};font-size:10px;line-height:1.45;visibility:hidden`;
    box.innerHTML = table(widths, headHtml, rows.join(''));
    document.body.appendChild(box);
    const head = box.querySelector('thead tr').getBoundingClientRect().height;
    const heights = Array.from(box.querySelectorAll('tbody tr')).map(tr => tr.getBoundingClientRect().height);
    box.remove();
    return { head, heights };
  }

  /** Split rows into pages: [{ start, end }] given the space left on the first page and on later pages. */
  function paginate(heights, head, firstAvail, avail) {
    const out = [];
    let start = 0, used = head, room = firstAvail;
    heights.forEach((h, i) => {
      if (i > start && used + h > room - 2) { out.push({ start, end: i }); start = i; used = head; room = avail; }
      used += h;
    });
    if (heights.length) out.push({ start, end: heights.length });
    return out;
  }

  // ───────── content builders ─────────
  function overviewPage(p, db) {
    const s = calc.projectStats(p, db);
    const checks = calc.projectChecks(p, db);
    const costKeys = Object.keys(s.cost);
    const info = [
      ['案名', p.name], ['專案代碼', p.code], ['產品類型', schema.productTypeLabel(p.product_type)], ['客戶', p.customer],
      ['Stage', p.stage], ['專案狀態', schema.labelOf(schema.PROJECT_STATUS, p.status)], ['熱流負責人', p.owner], ['機構負責人', p.me_owner],
    ];
    const tile = (k, v, unit, d, tone) => `<div style="border:0.75px solid #C9D3E0;padding:7px 9px;height:58px;box-sizing:border-box">
      <div style="font-size:8.5px;color:${INK3}">${esc(k)}</div>
      <div style="font:700 17px ${HFONT};color:${tone || INK};margin-top:2px">${esc(v)}${unit ? `<span style="font:400 9px ${FONT};color:${INK3};margin-left:3px">${esc(unit)}</span>` : ''}</div>
      <div style="font-size:8px;color:${INK3};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(d || '')}</div></div>`;
    const warn = n => (n ? '#B7791F' : '#1E8E4E');
    const tiles = [
      tile('Items', s.items, '', p.locations.map(l => l.name + ' ' + p.items.filter(i => i.location_id === l.id && i.status !== 'obsolete').length).join(' · ')),
      tile('每台總片數', s.pcs, 'pcs'),
      tile('材料種類', s.materials, ''),
      tile('每台 TIM 成本', costKeys.length ? util.fmt(s.cost[costKeys[0]], 2) : '—', costKeys[0] || '', s.cost_missing ? s.cost_missing + ' 項未填單價' : ''),
      tile('單一來源', s.single, '', '沒有任何第二來源', warn(s.single)),
      tile('第二來源未承認', s.unverified, '', '有列出但尚未承認', warn(s.unverified)),
      tile('壓縮率異常', s.comp_issues, '', '超出建議範圍或未接觸', warn(s.comp_issues)),
      tile('位置圖放置', p.views.length ? s.placed + '/' + s.qty_total : '—', p.views.length ? 'pcs' : '', p.views.length ? p.views.length + ' 張位置圖' : '尚未建立位置圖'),
    ].join('');
    const LINE_H = 17, maxLines = Math.floor((BODY_H - TITLE_H) / LINE_H);
    const shown = checks.length > maxLines ? checks.slice(0, maxLines - 1) : checks;
    const checkRows = shown.map(c => {
      const [mark, color] = LEVEL[c.level] || LEVEL.info;
      return `<div style="display:flex;gap:6px;align-items:center;height:${LINE_H}px;border-bottom:0.5px solid #E3E8EF">
        <span style="flex:none;width:13px;height:13px;line-height:13px;text-align:center;font-size:8px;font-weight:700;color:#fff;background:${color}">${mark}</span>
        <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.msg)}</span></div>`;
    }).join('') + (checks.length > shown.length ? `<div style="height:${LINE_H}px;line-height:${LINE_H}px;color:${INK3}">…另有 ${checks.length - shown.length} 項，請在工具的「總覽」查看</div>` : '');
    return `<div style="display:flex;gap:22px;height:100%">
      <div style="width:47%">
        ${sectionTitle('專案資訊')}
        <table style="width:100%;border-collapse:collapse;font-size:9.5px">${info.map(([k, v]) => `<tr><td style="width:78px;padding:3px 6px;color:${INK3};border-bottom:0.5px solid #E3E8EF">${esc(k)}</td><td style="padding:3px 6px;border-bottom:0.5px solid #E3E8EF">${esc(v || '—')}</td></tr>`).join('')}</table>
        ${p.description ? `<div style="margin-top:6px;font-size:9px;color:${INK2};max-height:40px;overflow:hidden"><span style="color:${INK3}">備註　</span>${esc(p.description)}</div>` : ''}
        <div style="margin-top:12px">${sectionTitle('狀態', '不含停用 Item')}</div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">${tiles}</div>
      </div>
      <div style="flex:1;min-width:0">
        ${sectionTitle('待處理事項', checks.length + ' 項 · 自動檢核')}
        ${checks.length ? checkRows : `<div style="color:${INK3}">沒有待處理事項。</div>`}
      </div>
    </div>`;
  }

  /** TIM List pages: Excel columns, location colour on the rows, rowspan location cell per page. */
  function listPages(p, db) {
    const X = TIM.xlsxExport;
    const groups = X.timListGroups(p, db, {});
    const widths = [10, 7, 10, 12, 16, 13, 5, 13, 30, 24];
    const head = '<tr>' + X.TIM_LIST_HEADERS.map(h => th(h)).join('') + '</tr>';
    const flat = [];
    groups.forEach(g => g.rows.forEach(r => flat.push(Object.assign({ loc: g.loc }, r))));
    const rowHtml = (r, locCell) => {
      const fg = util.textOn(r.loc.color);
      const base = `background:${r.loc.color};color:${fg};text-align:center`;
      const v = r.vals;
      const sc = r.risk === 'single' ? `background:${X.PINK};color:#B4237A` : r.risk === 'unverified' ? `background:${X.AMBER};color:#000` : `background:${r.loc.color};color:${fg}`;
      return '<tr>' + (locCell == null ? td('', base) : locCell) +
        [1, 2, 3, 4, 5, 6, 7].map(i => td(esc(v[i] == null ? '' : v[i]), base + (i === 1 ? ';font-weight:700' : ''))).join('') +
        td(esc(v[8]), base + ';text-align:left') + td(esc(v[9]), sc + ';text-align:left') + '</tr>';
    };
    if (!flat.length) return [{ title: 'TIM 清單', html: `<div style="color:${INK3}">還沒有 Item。</div>` }];
    const m = measure(widths, head, flat.map(r => rowHtml(r)));
    const LEGEND_H = 18;
    const parts = paginate(m.heights.map(h => Math.max(h, 18)), m.head, BODY_H - LEGEND_H, BODY_H - LEGEND_H);
    return parts.map((part, pi) => {
      let rows = '';
      for (let i = part.start; i < part.end;) {
        let j = i;
        while (j < part.end && flat[j].loc.id === flat[i].loc.id) j++;
        for (let k = i; k < j; k++) {
          const loc = flat[k].loc;
          const cell = k === i ? `<td rowspan="${j - i}" style="${cellCss};background:${loc.color};color:${util.textOn(loc.color)};text-align:center;font-weight:700">${esc(loc.name)}</td>` : '';
          rows += rowHtml(flat[k], cell);
        }
        i = j;
      }
      const legend = `<div style="margin-top:6px;font-size:8.5px;color:${INK3};display:flex;gap:14px;align-items:center">
        <span><span style="display:inline-block;width:10px;height:8px;background:${X.PINK};margin-right:4px"></span>單一來源（無第二來源）</span>
        <span><span style="display:inline-block;width:10px;height:8px;background:${X.AMBER};margin-right:4px"></span>第二來源尚未承認</span>
        ${parts.length > 1 ? `<span style="margin-left:auto">第 ${pi + 1} / ${parts.length} 頁</span>` : ''}</div>`;
      return { title: 'TIM 清單' + (pi ? '（續）' : ''), html: table(widths, head, rows) + legend };
    });
  }

  async function mapPages(p, db) {
    const out = [];
    for (const v of p.views.filter(x => x.image_id && db.images[x.image_id])) {
      let png;
      try { png = await TIM.renderView.renderViewPng(p, v, { maxSide: 2200 }); } catch (e) { continue; }
      const counts = {};
      (v.shapes || []).forEach(s => { counts[s.item_id] = (counts[s.item_id] || 0) + 1; });
      const items = calc.orderedItems(p).filter(it => counts[it.id]);
      const LEG_H = items.length ? 22 : 0;
      const sc = Math.min(BODY_W / png.width, (BODY_H - LEG_H) / png.height);
      const w = Math.floor(png.width * sc), h = Math.floor(png.height * sc);
      const loc = p.locations.find(l => l.id === v.location_id);
      const legend = items.map(it => `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;white-space:nowrap">
        <span style="display:inline-block;width:10px;height:10px;background:${calc.itemColor(p, it)}"></span><b>${esc(it.item_no)}</b>
        <span style="color:${INK3}">× ${counts[it.id]}${Number.isFinite(it.qty) && it.qty !== counts[it.id] ? '（Q\'ty ' + it.qty + '）' : ''}</span></span>`).join('');
      out.push({
        title: '位置標註 · ' + v.name + (loc ? '（' + loc.name + '）' : ''), kicker: 'PLACEMENT MAP',
        html: `<div style="height:${BODY_H - LEG_H}px;display:flex;align-items:center;justify-content:center"><img src="${png.dataUrl}" style="width:${w}px;height:${h}px;border:0.75px solid #C9D3E0" /></div>
          ${LEG_H ? `<div style="height:${LEG_H}px;padding-top:6px;box-sizing:border-box;font-size:9px;overflow:hidden;white-space:nowrap">${legend}</div>` : ''}`,
      });
    }
    return out;
  }

  /** Material usage and compression tables flowed across as many pages as needed. */
  function checkPages(p, db) {
    const usage = calc.materialUsage(p, db);
    const uW = [18, 26, 14, 42];
    const uHead = '<tr>' + th('Vendor', 'left') + th('Model', 'left') + th('每台用量') + th('Items', 'left') + '</tr>';
    const uRows = usage.map(u => '<tr>' + td(esc(u.vendor)) + td(esc(u.model)) + td(esc(u.usage || '—'), 'text-align:right;font-family:' + MONO) + td(esc(u.items.join(', ')), 'font-family:' + MONO) + '</tr>');
    const comp = calc.orderedItems(p).filter(it => it.status !== 'obsolete').map(it => {
      const mat = calc.materialOf(db, it);
      return { it, eff: calc.effective(it, mat), cc: calc.compressionCheck(it, mat, db.settings), loc: calc.locationOf(p, it) };
    }).filter(r => r.cc.status !== 'na');
    const STATUS = { ok: ['OK', '#1E8E4E', '#E7F5EC'], warn: ['Warning', '#B7791F', '#FFF4DB'], error: ['Error', '#C0392B', '#FDECEA'] };
    const cW = [8, 13, 24, 7, 16, 10, 8, 8, 10];
    const cHead = '<tr>' + ['Item', 'Location', '材料', 'T (mm)', '間隙 min / nom / max', '建議 %', 'C min %', 'C max %', '判定'].map(t => th(t)).join('') + '</tr>';
    const f = v => (v == null ? '—' : util.fmt(v));
    const cRows = comp.map(r => {
      const [label, color, bg] = STATUS[r.cc.status];
      return '<tr>' + td(esc(r.it.item_no), 'font-weight:700;text-align:center') + td(esc(r.loc ? r.loc.name : '')) +
        td(esc([r.eff.vendor, r.eff.model].filter(Boolean).join(' '))) + td(f(r.it.size.t), 'text-align:right') +
        td([r.it.gap.min, r.it.gap.nom, r.it.gap.max].map(f).join(' / '), 'text-align:center') +
        td(r.cc.rec ? r.cc.rec.min + '~' + r.cc.rec.max + (r.cc.rec.source === 'generic' ? '*' : '') : '—', 'text-align:center') +
        td(util.fmt(r.cc.min, 1), 'text-align:right') + td(util.fmt(r.cc.max, 1), 'text-align:right') +
        td(label, `text-align:center;font-weight:700;color:${color};background:${bg}`) + '</tr>';
    });
    const blocks = [
      { title: '材料用量彙總', sub: "每台用量（不含停用 Item）：片狀 = Σ Q'ty（pcs）；點膠類 = Σ Q'ty × 點膠量（g / cc）", widths: uW, head: uHead, rows: uRows, empty: '尚無 Item。' },
      { title: '壓縮率檢核', sub: 'C = (T − g) / T × 100%；C min 用最大間隙、C max 用最小間隙；* = 使用設定中的一般建議值', widths: cW, head: cHead, rows: cRows, empty: '尚無填寫設計間隙的 Item。' },
    ];
    const pages = [];
    let cur = '', room = BODY_H;
    const flush = () => { if (cur) pages.push(cur); cur = ''; room = BODY_H; };
    blocks.forEach(b => {
      if (!b.rows.length) {
        if (room < TITLE_H + 24) flush();
        cur += sectionTitle(b.title, b.sub) + `<div style="color:${INK3};margin-bottom:14px">${b.empty}</div>`;
        room -= TITLE_H + 28;
        return;
      }
      const m = measure(b.widths, b.head, b.rows);
      if (room < TITLE_H + m.head + (m.heights[0] || 0) + 4) flush();
      const parts = paginate(m.heights, m.head, room - TITLE_H, BODY_H - TITLE_H);
      parts.forEach((part, i) => {
        if (i > 0) flush();
        cur += sectionTitle(b.title + (i ? '（續）' : ''), i ? '' : b.sub) + table(b.widths, b.head, b.rows.slice(part.start, part.end).join(''));
        room -= TITLE_H + m.head + m.heights.slice(part.start, part.end).reduce((a, c) => a + c, 0);
      });
      cur += '<div style="height:14px"></div>';
      room -= 14;
    });
    flush();
    return pages.map((html, i) => ({ title: '材料用量與壓縮率檢核' + (i ? '（續）' : ''), kicker: 'CHECKS', html }));
  }

  /** Load the webfonts for every glyph we are about to draw (CJK fonts come in unicode-range subsets). */
  async function loadFonts(text) {
    try {
      if (!document.fonts || !document.fonts.load) return;
      const glyphs = Array.from(new Set(Array.from(text))).join('').slice(0, 4000);
      const specs = [];
      ["'Space Grotesk'", "'DM Sans'", "'Noto Sans TC'", "'JetBrains Mono'"].forEach(fam => ['400', '600', '700'].forEach(w => specs.push(w + ' 12px ' + fam)));
      await Promise.all(specs.map(s => document.fonts.load(s, glyphs).catch(() => null)));
      if (document.fonts.ready) await document.fonts.ready;
    } catch (e) { /* fall back to whatever is loaded */ }
  }

  /**
   * Build and download the PDF. opts.sections: keys from SECTIONS (default all);
   * opts.onProgress(done, total). → file name.
   */
  async function exportProjectPdf(pid, opts) {
    opts = opts || {};
    const want = new Set(opts.sections || SECTIONS.map(s => s.key));
    const [html2canvas, jspdf] = await Promise.all([TIM.loader.load('html2canvas'), TIM.loader.load('jspdf')]);
    const db = TIM.store.db;
    const p = db.projects[pid];
    const sample = [p.name, p.description, p.customer, ...p.items.map(i => [i.item_no, i.vendor, i.model, i.note, i.sourcing_note, parse(i)].join(' ')),
      ...p.locations.map(l => l.name), ...p.views.map(v => v.name), '專案資訊狀態待處理事項清單位置標註材料用量彙總壓縮率檢核判定單一來源第二來源尚未承認續頁另有請在工具的總覽查看沒有每台片數成本種類放置張圖建議範圍或未接觸間隙一般值片狀點膠類'].join(' ');
    await loadFonts(sample);

    const pages = [];
    if (want.has('overview')) pages.push({ title: 'TIM 專案總覽', kicker: 'PROJECT OVERVIEW', html: overviewPage(p, db) });
    if (want.has('list')) listPages(p, db).forEach(pg => pages.push(Object.assign({ kicker: 'TIM LIST' }, pg)));
    if (want.has('maps')) (await mapPages(p, db)).forEach(pg => pages.push(pg));
    if (want.has('checks')) checkPages(p, db).forEach(pg => pages.push(pg));
    if (!pages.length) throw new Error('沒有可匯出的頁面');

    const pdf = new jspdf.jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4', compress: true });
    pdf.setProperties({ title: p.name + ' · TIM', subject: 'TIM list', creator: '專案 TIM 管理器' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    for (let i = 0; i < pages.length; i++) {
      if (opts.onProgress) opts.onProgress(i, pages.length);
      // Same capture setup as the report builder: a fixed off-screen box with letter-spacing reset.
      const holder = document.createElement('div');
      holder.style.cssText = `position:fixed;left:-9999px;top:0;width:${W}px;height:${H}px;background:#fff;z-index:-1;overflow:hidden;letter-spacing:0px;word-spacing:0px`;
      holder.innerHTML = '<style>*,*::before,*::after{letter-spacing:0px!important;word-spacing:0px!important;text-transform:none!important}</style>' +
        frame(p, Object.assign({}, pages[i], { no: i + 1, count: pages.length }), pages[i].html);
      document.body.appendChild(holder);
      const imgs = Array.from(holder.querySelectorAll('img'));
      await Promise.all(imgs.map(im => (im.complete ? null : new Promise(r => { im.onload = r; im.onerror = r; }))));
      try {
        await new Promise(r => setTimeout(r, 50));
        const canvas = await html2canvas(holder, { scale: 2, backgroundColor: '#ffffff', width: W, height: H, logging: false, useCORS: true });
        if (i) pdf.addPage('a4', 'landscape');
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pw, ph);
      } finally { holder.remove(); }
    }
    if (opts.onProgress) opts.onProgress(pages.length, pages.length);
    const name = util.fileSafe(p.name) + '_TIM_' + util.fileSafe(p.stage) + '_' + util.todayStr().replace(/-/g, '') + '.pdf';
    TIM.ui.downloadBlob(pdf.output('blob'), name);
    return { name, pages: pages.length };
  }
  function parse(it) { return TIM.parse.formatCovered(it.covered) + ' ' + TIM.parse.formatSources(it); }

  TIM.pdfExport = { SECTIONS, exportProjectPdf };
})();
