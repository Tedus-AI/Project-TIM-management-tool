/* PDF report — same approach and page frame as the Thermal Test Report Builder: every A4
 * landscape page is laid out as HTML off-screen, captured with html2canvas and placed in a
 * jsPDF document, so Chinese text is drawn by the browser and no fonts need embedding.
 * Pages: overview · TIM 清單 (the columns the TIM 清單 shows, its groups and order, location colours, split across
 * pages with the header repeated) · one page per placement view (drawing + Item / 覆蓋元件 table) · material
 * usage · compression / pressure. Rows and columns hidden in the TIM 清單 are left out (opts.hide, see
 * xlsxExport.viewProject and ui.bomExportColumns).
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

  const SECTIONS = [
    { key: 'overview', label: '總覽：專案資訊與狀態' },
    { key: 'list', label: 'TIM 清單：與畫面上的 TIM 清單相同欄位（含展開的欄位群組）與底色' },
    { key: 'maps', label: '位置標註圖：每張視圖一頁，旁邊附 Item 與覆蓋元件對照表' },
    { key: 'usage', label: '材料用量彙總' },
    { key: 'compression', label: '壓縮率與壓力檢核' },
  ];
  /** Saved section choices: the earlier combined 'checks' becomes usage + compression. */
  const normSections = list => (list || []).reduce((a, k) => a.concat(k === 'checks' ? ['usage', 'compression'] : [k]), [])
    .filter((k, i, a) => SECTIONS.some(x => x.key === k) && a.indexOf(k) === i);

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
  // the title stays on one line; a long sub-title wraps beside it (titleHeight measures the block)
  const sectionTitle = (t, sub) => `<div style="display:flex;align-items:baseline;gap:10px;margin:0 0 6px"><span style="font:700 12px ${HFONT};white-space:nowrap;flex:none">${esc(t)}</span>${sub ? `<span style="font-size:9px;color:${INK3};flex:1;min-width:0">${esc(sub)}</span>` : ''}</div>`;
  const TITLE_H = 24;
  function titleHeight(t, sub) {
    if (!sub) return TITLE_H;
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-20000px;top:0;width:${BODY_W}px;font-family:${FONT};font-size:10px;line-height:1.45;visibility:hidden`;
    box.innerHTML = sectionTitle(t, sub);
    document.body.appendChild(box);
    const h = box.firstChild.getBoundingClientRect().height + 6;
    box.remove();
    return Math.max(TITLE_H, Math.ceil(h) + 2);
  }

  // ───────── tables ─────────
  // html2canvas draws each cell's own border (border-collapse doubles shared edges), so cells
  // only draw right / bottom and the table draws top / left.
  const cellCss = 'border-right:0.75px solid ' + LINE + ';border-bottom:0.75px solid ' + LINE + ';padding:3px 4px;vertical-align:middle;overflow-wrap:anywhere;word-break:break-word';
  function colgroup(widths) {
    const total = widths.reduce((a, b) => a + b, 0);
    return '<colgroup>' + widths.map(w => `<col style="width:${(w / total * 100).toFixed(3)}%">`).join('') + '</colgroup>';
  }
  function table(widths, headHtml, rowsHtml, fs) {
    return `<table style="width:100%;border-collapse:separate;border-spacing:0;border-top:0.75px solid ${LINE};border-left:0.75px solid ${LINE};table-layout:fixed;font-size:${fs || 9}px">${colgroup(widths)}<thead>${headHtml}</thead><tbody>${rowsHtml}</tbody></table>`;
  }
  const th = (t, align) => `<th style="${cellCss};background:#D9E1F2;font-weight:700;text-align:${align || 'center'}">${esc(t)}</th>`;
  const td = (t, css) => `<td style="${cellCss};${css || ''}">${t}</td>`;

  /**
   * Column widths (px) that fill `avail`: proportional to `ws`, but never below `mins` — the narrow columns keep
   * their minimum and the wide text columns give way (many columns shown → Location / Item still readable).
   */
  function fitWidths(ws, mins, avail) {
    const fixed = ws.map(() => false);
    let out = ws.slice();
    for (let k = 0; k <= ws.length; k++) {
      const freeW = ws.reduce((a, w, i) => a + (fixed[i] ? 0 : w), 0);
      const room = avail - mins.reduce((a, m, i) => a + (fixed[i] ? m : 0), 0);
      out = ws.map((w, i) => (fixed[i] ? mins[i] : w * room / freeW));
      const low = out.map((w, i) => !fixed[i] && w < mins[i]);
      if (!low.some(Boolean)) break;
      low.forEach((l, i) => { if (l) fixed[i] = true; });
    }
    return out;
  }

  /** Heights (px) of the header row and each body row, measured off-screen at page width. */
  function measure(widths, headHtml, rows, fs) {
    const box = document.createElement('div');
    box.style.cssText = `position:fixed;left:-20000px;top:0;width:${BODY_W}px;font-family:${FONT};font-size:10px;line-height:1.45;visibility:hidden`;
    box.innerHTML = table(widths, headHtml, rows.join(''), fs);
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
      tile('壓縮 / 壓力異常', s.comp_issues, '', '壓縮不足、未接觸或超過元件耐壓', warn(s.comp_issues)),
      tile('位置圖放置', p.views.length ? s.placed + '/' + s.qty_total : '—', p.views.length ? 'pcs' : '', p.views.length ? p.views.length + ' 張位置圖' : '尚未建立位置圖'),
    ].join('');
    return `<div style="display:flex;gap:22px;height:100%">
      <div style="width:44%">
        ${sectionTitle('專案資訊')}
        <table style="width:100%;border-collapse:collapse;font-size:9.5px">${info.map(([k, v]) => `<tr><td style="width:78px;padding:3px 6px;color:${INK3};border-bottom:0.5px solid #E3E8EF">${esc(k)}</td><td style="padding:3px 6px;border-bottom:0.5px solid #E3E8EF">${esc(v || '—')}</td></tr>`).join('')}</table>
        ${p.description ? `<div style="margin-top:6px;font-size:9px;color:${INK2};max-height:80px;overflow:hidden"><span style="color:${INK3}">備註　</span>${esc(p.description)}</div>` : ''}
      </div>
      <div style="flex:1;min-width:0">
        ${sectionTitle('狀態', '不含停用 Item')}
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">${tiles}</div>
      </div>
    </div>`;
  }

  /**
   * TIM 清單 pages: the columns the TIM 清單 shows (its 欄位 groups and order, hidden columns left out — the same
   * labels, cell text and source-risk colours), location colour on the rows, rowspan location cell per page.
   */
  function listPages(p, db, hide) {
    const X = TIM.xlsxExport;
    const B = TIM.ui.bomInternals;
    const cols = TIM.ui.bomExportColumns(hide);
    const dtWarn = db.settings.dt_warn || 10;
    const items = calc.orderedItems(p).filter(it => it.status !== 'obsolete');
    const flat = [];
    p.locations.forEach(loc => items.filter(it => it.location_id === loc.id).forEach(it => flat.push({ loc, it, ctx: B.rowCtx(it, db, dtWarn) })));
    const raw = [86].concat(cols.map(c => c.width || 100));
    const total = raw.reduce((a, b) => a + b, 0);
    const fs = total > 2000 ? 7 : total > 1500 ? 8 : 9;          // many 欄位 groups shown → smaller type
    const MIN = { item_no: 44, used_on: 40, vendor: 54, model: 58, size: 54, delta_pn: 54, covered: 80, second: 72, tim_type: 56, note: 70 };
    const widths = fitWidths(raw, [62].concat(cols.map(c => MIN[c.key] || 36)), BODY_W);
    const headCell = (label, sub) => `<th style="${cellCss};background:#D9E1F2;font-weight:700;text-align:center">${esc(label)}${sub ? `<div style="font-weight:400;font-size:${fs - 1.5}px;color:${INK3}">${esc(sub)}</div>` : ''}</th>`;
    const head = '<tr>' + headCell('Location') + cols.map(c => headCell(c.label, c.sub)).join('') + '</tr>';
    const LEFT = ['covered', 'second', 'note', 'sourcing'];
    const rowHtml = (r, locCell) => {
      const fg = util.textOn(r.loc.color);
      const base = `background:${r.loc.color};color:${fg}`;
      return '<tr>' + (locCell == null ? td('', base) : locCell) + cols.map(c => {
        const cls = c.cls ? c.cls(r.it, r.ctx) : '';
        let css = cls === 'c-risk-single' ? `background:${X.PINK};color:#B4237A` : cls === 'c-risk-unverified' ? `background:${X.AMBER};color:#000` : base;
        if (cls === 'c-err') css += ';color:#C0392B;font-weight:700';
        else if (cls === 'c-warn') css += ';color:#8A5A00;font-weight:700';
        if (c.key === 'item_no') css += ';font-weight:700';
        css += ';text-align:' + (LEFT.includes(c.key) ? 'left' : 'center');
        return td(esc(B.cellText(c, r.it, r.ctx)), css);
      }).join('') + '</tr>';
    };
    if (!flat.length) return [{ title: 'TIM 清單', html: `<div style="color:${INK3}">還沒有 Item。</div>` }];
    const m = measure(widths, head, flat.map(r => rowHtml(r)), fs);
    const parts = paginate(m.heights.map(h => Math.max(h, 18)), m.head, BODY_H, BODY_H);
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
      return { title: 'TIM 清單' + (pi ? '（續）' : ''), html: table(widths, head, rows, fs) };
    });
  }

  /** One page per placement view: the drawing, and beside it a table of the Items placed on it with their 覆蓋元件. */
  async function mapPages(p, db) {
    const out = [];
    for (const v of p.views.filter(x => x.image_id && db.images[x.image_id])) {
      let png;
      try { png = await TIM.renderView.renderViewPng(p, v, { maxSide: 2200 }); } catch (e) { continue; }
      const counts = {};
      (v.shapes || []).forEach(s => { counts[s.item_id] = (counts[s.item_id] || 0) + 1; });
      const items = calc.orderedItems(p).filter(it => counts[it.id]);
      const SIDE = items.length ? 236 : 0, GAP = items.length ? 14 : 0;
      const sc = Math.min((BODY_W - SIDE - GAP) / png.width, BODY_H / png.height);
      const w = Math.floor(png.width * sc), h = Math.floor(png.height * sc);
      const loc = p.locations.find(l => l.id === v.location_id);
      const fs = items.length > 18 ? 7.5 : items.length > 12 ? 8 : 9;
      const side = items.length ? table([30, 56, 14],
        '<tr>' + th('Item') + th('覆蓋元件') + th('片數') + '</tr>',
        items.map(it => {
          const n = counts[it.id];
          const off = Number.isFinite(it.qty) && it.qty !== n;
          return '<tr>' + td(`<span style="display:inline-block;width:9px;height:9px;background:${calc.itemColor(p, it)};margin-right:5px;vertical-align:-1px"></span><b>${esc(it.item_no)}</b>`, 'white-space:nowrap') +
            td(esc(TIM.parse.formatCovered(it.covered)) || `<span style="color:${INK3}">—</span>`, 'font-family:' + MONO) +
            td(n + (off ? `<div style="font-size:7px;color:#8A5A00">Q'ty ${it.qty}</div>` : ''), 'text-align:center') + '</tr>';
        }).join(''), fs) : '';
      out.push({
        title: '位置標註 · ' + v.name + (loc ? '（' + loc.name + '）' : ''), kicker: 'PLACEMENT MAP',
        html: `<div style="display:flex;gap:${GAP}px;height:${BODY_H}px">
          <div style="flex:1;min-width:0;display:flex;align-items:center;justify-content:center"><img src="${png.dataUrl}" style="width:${w}px;height:${h}px;border:0.75px solid #C9D3E0" /></div>
          ${SIDE ? `<div style="width:${SIDE}px;flex:none;align-self:center;max-height:${BODY_H}px;overflow:hidden">${side}</div>` : ''}
        </div>`,
      });
    }
    return out;
  }

  /** Material usage and / or compression tables (want.usage / want.compression) flowed across as many pages as needed. */
  function checkPages(p, db, want) {
    const usage = calc.materialUsage(p, db);
    const uW = [18, 26, 14, 42];
    const uHead = '<tr>' + th('Vendor', 'left') + th('Model', 'left') + th('每台用量') + th('Items', 'left') + '</tr>';
    const uRows = usage.map(u => '<tr>' + td(esc(u.vendor)) + td(esc(u.model)) + td(esc(u.usage || '—'), 'text-align:right;font-family:' + MONO) + td(esc(u.items.join(', ')), 'font-family:' + MONO) + '</tr>');
    const comp = calc.orderedItems(p).filter(it => it.status !== 'obsolete').map(it => {
      const mat = calc.materialOf(db, it);
      return { it, eff: calc.effective(it, mat), cc: calc.compressionCheck(it, mat, db.settings), loc: calc.locationOf(p, it) };
    }).filter(r => r.cc.status !== 'na');
    const STATUS = { ok: ['OK', '#1E8E4E', '#E7F5EC'], warn: ['Warning', '#B7791F', '#FFF4DB'], error: ['Fail', '#C0392B', '#FDECEA'] };
    const judge = st => { const [label, color, bg] = STATUS[st]; return td(label, `text-align:center;font-weight:700;color:${color};background:${bg}`); };
    const muted = t => td(esc(t), `text-align:center;color:${INK3}`);
    const cW = [6, 9, 15, 15, 5, 14, 9, 15, 7, 7];
    const cHead = '<tr>' + ['Item', 'Location', '覆蓋元件', '材料', 'T (mm)', '間隙 min / nom / max', '壓縮率 %', '壓力 max / 規格 psi', '壓縮判定', '壓力判定'].map(t => th(t)).join('') + '</tr>';
    const f = v => (v == null ? '—' : util.fmt(v, 3));
    const f1 = v => (v == null ? '—' : util.fmt(v, 1));
    // one row per covered component (gaps, compression and pressure differ per component); the item cells on its
    // first row, the item number repeated in grey on the others so a page break never loses it
    const cRows = [];
    comp.forEach(r => {
      const comps = r.cc.comps.length ? r.cc.comps : [null];
      comps.forEach((c, i) => {
        const g = c ? c.gap : r.cc.gap;
        const min = c ? c.cMin : r.cc.min, max = c ? c.cMax : r.cc.max;
        const cst = c ? c.cStatus : r.cc.cStatus;
        const low = min != null && (min <= 0 || (r.cc.rec && min < r.cc.rec.min));
        const lt = c && schema.loadType(c.loadType);
        const name = c ? esc(c.refdes || c.part || '元件') + (lt ? `<span style="color:${INK3}">（${esc(lt.short)}）</span>` : '') : '—';
        let pr;
        if (c && c.pMax) {
          const v = (c.pMax.beyond ? '> ' : '') + util.fmt(c.pMax.psi, 1);
          pr = c.ratio != null && c.allow ? `<b>${v}</b> / ${util.fmt(c.allow.psi, 1)}（${util.fmt(c.ratio, 0)}%）` : `<b>${v}</b>` + (c.pNote ? `<span style="color:${INK3}">（${esc(c.exempt ? '規格不需' : c.pNote)}）</span>` : '');
        } else if (c) pr = '—' + (c.pNote ? `<span style="color:${INK3}">（${esc(c.pNote)}）</span>` : '');
        else pr = r.cc.pressure ? (r.cc.pressure.beyond ? '> ' : '') + util.fmt(r.cc.pressure.psi, 1) : '—';
        const pj = !c ? muted('未判定') : c.exempt ? td('不檢核', `text-align:center;color:${INK3};background:#F1F3F6`) : c.status === 'na' ? muted('未判定') : judge(c.status);
        cRows.push('<tr>' + (i ? td(esc(r.it.item_no), `text-align:center;color:${INK3}`) + td('') : td(esc(r.it.item_no), 'font-weight:700;text-align:center') + td(esc(r.loc ? r.loc.name : ''))) +
          td(name, 'font-family:' + MONO) +
          (i ? td('') + td('') : td(esc([r.eff.vendor, r.eff.model].filter(Boolean).join(' '))) + td(f(r.it.size.t), 'text-align:right')) +
          td([g.min, g.nom, g.max].map(f).join(' / ') + (r.cc.gap.source === 'stack' ? ' ⧉' : ''), 'text-align:center') +
          td(`<span style="${low ? 'color:#C0392B;font-weight:700' : ''}">${f1(min)}</span> ~ ${f1(max)}`, 'text-align:center') +
          td(pr, 'text-align:right') +
          (cst === 'na' ? muted('—') : judge(cst)) + pj + '</tr>');
      });
    });
    const blocks = [
      want.usage ? { title: '材料用量彙總', sub: "每台用量（不含停用 Item）：片狀 = Σ Q'ty（pcs）；點膠類 = Σ Q'ty × 點膠量（g / cc）", widths: uW, head: uHead, rows: uRows, empty: '尚無 Item。' } : null,
      want.compression ? { title: '壓縮率與壓力檢核', sub: '每顆覆蓋元件一列。C = (T − g) / T × 100%；C min 用最大間隙、C max 用最小間隙；⧉ = 設計間距 ± 公差 + 元件高度公差。壓縮判定：C min 低於最小壓縮率（預設 10%）→ Fail（接觸可能不足）。壓力 = 材料壓力–壓縮曲線在 C max 的值 / 元件規格（耐壓）（比例）；壓力判定：> 100% → Fail、≥ ' + (db.settings.pressure_warn_pct || 80) + '% → Warning；受壓類型 E-PAD / QFN / LGA / 引腳 → 不檢核（壓力只顯示）；未判定 = 缺規格或材料曲線', widths: cW, head: cHead, rows: cRows, empty: '尚無填寫設計間隙的 Item。' } : null,
    ].filter(Boolean);
    const pages = [];
    let cur = '', room = BODY_H;
    const flush = () => { if (cur) pages.push(cur); cur = ''; room = BODY_H; };
    blocks.forEach(b => {
      const tH = titleHeight(b.title, b.sub);   // a long sub-title wraps → taller than TITLE_H
      if (!b.rows.length) {
        if (room < tH + 24) flush();
        cur += sectionTitle(b.title, b.sub) + `<div style="color:${INK3};margin-bottom:14px">${b.empty}</div>`;
        room -= tH + 28;
        return;
      }
      const m = measure(b.widths, b.head, b.rows);
      if (room < tH + m.head + (m.heights[0] || 0) + 4) flush();
      const parts = paginate(m.heights, m.head, room - tH, BODY_H - TITLE_H);
      parts.forEach((part, i) => {
        if (i > 0) flush();
        cur += sectionTitle(b.title + (i ? '（續）' : ''), i ? '' : b.sub) + table(b.widths, b.head, b.rows.slice(part.start, part.end).join(''));
        room -= (i ? TITLE_H : tH) + m.head + m.heights.slice(part.start, part.end).reduce((a, c) => a + c, 0);
      });
      cur += '<div style="height:14px"></div>';
      room -= 14;
    });
    flush();
    const title = want.usage && want.compression ? '材料用量與壓縮率檢核' : want.usage ? '材料用量彙總' : '壓縮率與壓力檢核';
    return pages.map((html, i) => ({ title: title + (i ? '（續）' : ''), kicker: 'CHECKS', html }));
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
   * Build and download the PDF. opts.sections: keys from SECTIONS (default all); opts.hide: rows / columns hidden
   * in the TIM 清單 to leave out ({ rows, cols, gridCols }: xlsxExport.viewProject / ui.bomExportColumns);
   * opts.onProgress(done, total). → file name.
   */
  async function exportProjectPdf(pid, opts) {
    opts = opts || {};
    const want = new Set(opts.sections ? normSections(opts.sections) : SECTIONS.map(s => s.key));
    const [html2canvas, jspdf] = await Promise.all([TIM.loader.load('html2canvas'), TIM.loader.load('jspdf')]);
    const db = TIM.store.db;
    const p0 = db.projects[pid];
    const p = TIM.xlsxExport.viewProject(p0, opts.hide);   // without the rows hidden in the TIM 清單; drawings use p0
    const sample = [p.name, p.description, p.customer, ...p.items.map(i => [i.item_no, i.vendor, i.model, i.note, i.sourcing_note, parse(i)].join(' ')),
      ...p.locations.map(l => l.name), ...p.views.map(v => v.name),
      ...TIM.ui.bomExportColumns(opts.hide).map(c => c.label + ' ' + (c.sub || '')), ...schema.TIM_TYPES.map(t => t.label), ...schema.ITEM_STATUS.map(x => x.label || x),
      '覆蓋元件片數受壓類型不檢核未判定規格不需', '專案資訊狀態待處理事項清單位置標註材料用量彙總壓縮率檢核判定單一來源第二來源尚未承認續頁另有請在工具的總覽查看沒有每台片數成本種類放置張圖建議範圍或未接觸間隙一般值片狀點膠類壓縮與壓力異常不足超過元件耐壓最小設計間距公差元件高度曲線'].join(' ');
    await loadFonts(sample);

    const pages = [];
    if (want.has('overview')) pages.push({ title: 'TIM 專案總覽', kicker: 'PROJECT OVERVIEW', html: overviewPage(p, db) });
    if (want.has('list')) listPages(p, db, opts.hide).forEach(pg => pages.push(Object.assign({ kicker: 'TIM LIST' }, pg)));
    if (want.has('maps')) (await mapPages(p0, db)).forEach(pg => pages.push(pg));
    if (want.has('usage') || want.has('compression')) checkPages(p, db, { usage: want.has('usage'), compression: want.has('compression') }).forEach(pg => pages.push(pg));
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

  // internals: page builders (tests look at the laid-out HTML)
  TIM.pdfExport = { SECTIONS, normSections, exportProjectPdf, internals: { listPages, mapPages, checkPages, sectionTitle } };
})();
