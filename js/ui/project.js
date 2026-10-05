/* Project page: header + tabs (總覽 / TIM 清單 / 位置標註 / 間隙與壓力檢核 / 變更紀錄). */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useMemo, useState, Icon, cx, go, Modal, openModal, usePref, toast } = TIM.ui;
  const { schema, calc, util } = TIM;

  const TABS = [
    { id: 'overview', label: '總覽', icon: 'home' },
    { id: 'bom', label: 'TIM 清單', icon: 'grid' },
    { id: 'map', label: '位置標註', icon: 'map' },
    { id: 'analysis', label: '間隙與壓力檢核', icon: 'chart' },
    { id: 'log', label: '變更紀錄', icon: 'history' },
  ];

  /**
   * The TIM 清單 hides rows / columns → the export leaves them out too (checkbox, on by default; this browser).
   * → [vnode | null, hide option for the export]
   */
  function useHiddenExport(pid) {
    const h = useMemo(() => TIM.ui.bomHiddenForExport(TIM.store.db.projects[pid]), [pid]);
    const [follow, setFollow] = usePref('export_follow_hidden', true);
    if (!h.rows.length && !h.gridCols.length) return [null, null];
    const short = list => (list.length > 6 ? list.slice(0, 6).join('、') + '…' : list.join('、'));
    const what = [h.rows.length ? h.rows.length + ' 列（' + short(h.rowNos) + '）' : '', h.gridCols.length ? h.gridCols.length + ' 欄（' + short(h.colLabels) + '）' : ''].filter(Boolean).join('、');
    const node = html`<div class="divider"></div>
      <label class="check hidden-follow"><input type="checkbox" checked=${follow} onChange=${e => setFollow(e.target.checked)} /> 依 TIM 清單的「顯示 / 隱藏」：不匯出隱藏的 ${what}</label>
      <div class="muted" style="font-size:11.5px;margin:4px 0 0 22px;line-height:1.55">隱藏的 Item 不出現在任何表格與統計（位置標註圖維持原圖）；隱藏的欄只影響 TIM 清單表格。取消勾選就匯出全部。</div>`;
    return [node, follow ? { rows: h.rows, cols: h.cols, gridCols: h.gridCols } : null];
  }

  function ExportModal(props) {
    const [extra, setExtra] = usePref('xlsx_extra', ['tim_type', 'status']);
    const [images, setImages] = usePref('xlsx_images', true);
    const [details, setDetails] = usePref('xlsx_details', true);
    const [busy, setBusy] = useState(false);
    const [hiddenNode, hide] = useHiddenExport(props.pid);
    const toggle = k => setExtra(extra.includes(k) ? extra.filter(x => x !== k) : extra.concat(k));
    const run = async () => {
      setBusy(true);
      try {
        const name = await TIM.xlsxExport.exportProjectXlsx(props.pid, { extra, images, details, hide });
        toast('已匯出 ' + name, 'ok');
        props.close(true);
      } catch (e) {
        console.error(e);
        toast('匯出失敗：' + (e.message || e), 'err');
        setBusy(false);
      }
    };
    return html`<${Modal} title="匯出 Excel" size="mid" onClose=${() => props.close(false)} onEnter=${run}
      footer=${html`<span class="left">TIM List 工作表維持現行欄位順序：Location ~ 2nd source</span>
        <button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button>
        <button class="btn btn-primary" disabled=${busy} onClick=${run}><${Icon} name="download" /> ${busy ? '產生中…' : '匯出'}</button>`}>
      <div class="field-label" style="margin-bottom:8px">在現行欄位後面附加：</div>
      <div class="row wrap" style="gap:8px 16px">
        ${TIM.xlsxExport.EXTRA_COLUMNS.map(c => html`<label class="check"><input type="checkbox" checked=${extra.includes(c.key)} onChange=${() => toggle(c.key)} /> ${c.header}</label>`)}
      </div>
      <div class="divider"></div>
      <label class="check"><input type="checkbox" checked=${images} onChange=${e => setImages(e.target.checked)} /> 在表格下方附上位置標註圖（與畫面相同的標籤與引線）</label>
      <div style="height:8px"></div>
      <label class="check"><input type="checkbox" checked=${details} onChange=${e => setDetails(e.target.checked)} /> 附加明細工作表：Components、2nd Source、Gap & Thermal、Changelog、Project</label>
      ${hiddenNode}
    </${Modal}>`;
  }

  function openExport(pid) {
    openModal(close => html`<${ExportModal} pid=${pid} close=${close} />`);
  }

  function PdfModal(props) {
    const all = TIM.pdfExport.SECTIONS.map(s => s.key);
    const [saved, setSections] = usePref('pdf_sections', all);
    const sections = TIM.pdfExport.normSections(saved);
    const [busy, setBusy] = useState(null);           // null | 'loading' | { done, total }
    const [hiddenNode, hide] = useHiddenExport(props.pid);
    const toggle = k => setSections(sections.includes(k) ? sections.filter(x => x !== k) : all.filter(x => x === k || sections.includes(x)));
    const run = async () => {
      if (busy || !sections.length) return;
      setBusy('loading');
      try {
        const r = await TIM.pdfExport.exportProjectPdf(props.pid, { sections, hide, onProgress: (done, total) => setBusy({ done, total }) });
        toast('已匯出 ' + r.name + '（' + r.pages + ' 頁）', 'ok');
        props.close(true);
      } catch (e) {
        console.error(e);
        toast('PDF 匯出失敗：' + (e.message || e), 'err');
        setBusy(null);
      }
    };
    const label = busy === 'loading' ? '準備中…' : busy ? '產生第 ' + Math.min(busy.done + 1, busy.total) + ' / ' + busy.total + ' 頁…' : '匯出';
    return html`<${Modal} title="匯出 PDF" size="mid" onClose=${() => !busy && props.close(false)} onEnter=${run}
      footer=${html`<span class="left">A4 橫式，與報告產生器相同的頁框</span>
        <button class="btn btn-ghost" disabled=${!!busy} onClick=${() => props.close(false)}>取消</button>
        <button class="btn btn-primary" disabled=${!!busy || !sections.length} onClick=${run}><${Icon} name="download" /> ${label}</button>`}>
      <div class="field-label" style="margin-bottom:8px">包含的頁面：</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${TIM.pdfExport.SECTIONS.map(s => html`<label class="check"><input type="checkbox" checked=${sections.includes(s.key)} disabled=${!!busy} onChange=${() => toggle(s.key)} /> ${s.label}</label>`)}
      </div>
      ${hiddenNode}
    </${Modal}>`;
  }

  function openPdfExport(pid) {
    openModal(close => html`<${PdfModal} pid=${pid} close=${close} />`);
  }

  function ProjectPage(props) {
    const st = TIM.store;
    const p = st.db.projects[props.route.pid];
    const tab = props.route.tab || 'overview';
    const stats = useMemo(() => (p ? calc.projectStats(p, st.db) : null), [st.version, p && p.id]);
    if (!p) {
      return html`<div class="page"><div class="page-inner"><div class="empty"><h3>找不到這個專案</h3>
        <p>可能已被刪除，或是其他同事的資料庫中才有。</p><div class="actions"><button class="btn btn-primary" onClick=${() => go('')}>回專案列表</button></div></div></div></div>`;
    }
    const scope = 'p:' + p.id;
    const counts = {
      overview: stats.errors ? { n: stats.errors, cls: 'err' } : stats.warns ? { n: stats.warns, cls: 'warn' } : null,
      bom: { n: p.items.length },
      map: { n: p.views.length },
      analysis: stats.comp_issues ? { n: stats.comp_issues, cls: 'warn' } : null,
      log: { n: p.changelog.length },
    };
    const more = e => TIM.ui.openMenu(e, [
      { label: '匯出分享檔（JSON）', icon: 'download', onClick: () => TIM.share.exportProject(p.id) },
      { label: '複製專案…', icon: 'copy', onClick: async () => { const id = await TIM.ui.duplicateProject(p); if (id) go('p/' + id); }, disabled: st.readonly },
      'sep',
      { label: '刪除專案…', icon: 'trash', danger: true, onClick: async () => { await TIM.ui.removeProject(p); if (!st.db.projects[p.id]) go(''); }, disabled: st.readonly },
    ]);

    let body;
    if (tab === 'bom') body = html`<${TIM.ui.Bom} p=${p} route=${props.route} />`;
    else if (tab === 'map') body = html`<${TIM.ui.MapEditor} p=${p} route=${props.route} />`;
    else if (tab === 'analysis') body = html`<${TIM.ui.Analysis} p=${p} />`;
    else if (tab === 'log') body = html`<${TIM.ui.Changelog} p=${p} />`;
    else body = html`<${TIM.ui.Overview} p=${p} stats=${stats} />`;

    return html`<div class="proj">
      <div class="proj-head">
        <div class="proj-head-row">
          <h1 class="proj-title" title=${p.name}>${p.name || '(未命名專案)'}</h1>
          <span class="tag tag-stage">${p.stage}</span>
          ${p.status !== 'active' ? html`<span class="tag tag-mute">${schema.labelOf(schema.PROJECT_STATUS, p.status)}</span>` : null}
          <div class="proj-meta">
            ${schema.projectSubline(p) ? html`<span>${schema.projectSubline(p)}</span>` : null}
            <span class="mono"><b>${stats.items}</b> items · <b>${stats.pcs}</b> pcs</span>
            ${stats.single ? html`<span class="tag tag-single">單一來源 ${stats.single}</span>` : null}
          </div>
          <div class="proj-head-actions">
            <button class="btn btn-ghost btn-sm btn-icon rw-only" title="復原 (Ctrl+Z)" disabled=${!st.canUndo(scope)} onClick=${() => st.undo(scope)}><${Icon} name="undo" /></button>
            <button class="btn btn-ghost btn-sm btn-icon rw-only" title="重做 (Ctrl+Shift+Z)" disabled=${!st.canRedo(scope)} onClick=${() => st.redo(scope)}><${Icon} name="redo" /></button>
            <button class="btn btn-secondary btn-sm" onClick=${() => openExport(p.id)}><${Icon} name="excel" /> 匯出 Excel</button>
            <button class="btn btn-secondary btn-sm" onClick=${() => openPdfExport(p.id)}><${Icon} name="pdf" /> 匯出 PDF</button>
            <button class="btn btn-ghost btn-sm btn-icon" title="更多" onClick=${more}><${Icon} name="more" /></button>
          </div>
        </div>
        <nav class="tabs" role="tablist">
          ${TABS.map(t => html`<button role="tab" aria-selected=${tab === t.id} class=${cx('tab', tab === t.id && 'active')} onClick=${() => go('p/' + p.id + '/' + t.id)}>
            <${Icon} name=${t.icon} size=${14} /> ${t.label}
            ${counts[t.id] ? html`<span class=${cx('count', counts[t.id].cls)}>${counts[t.id].n}</span>` : null}
          </button>`)}
        </nav>
      </div>
      <div class=${cx('proj-body', (tab === 'bom' || tab === 'map') && 'fill')}>${body}</div>
    </div>`;
  }

  TIM.ui.ProjectPage = ProjectPage;
  TIM.ui.openExport = openExport;
  TIM.ui.openPdfExport = openPdfExport;
})();
