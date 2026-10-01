/* Home: project list, cross-project search, create / duplicate / delete, imports. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, useEffect, useRef, Icon, cx, go, usePref, highlight, Modal, openModal, confirm, prompt, toast, TextField, SelectField, Field } = TIM.ui;
  const { util, schema, calc } = TIM;

  function NewProjectModal(props) {
    const s = TIM.store.db.settings;
    const [f, setF] = useState({ name: '', code: '', product_type: '', customer: '', stage: 'EVT', owner: TIM.app.currentUser(), me_owner: '',
      locations: schema.locationPresetOf(s.default_locations) || 'both' });
    const [err, setErr] = useState('');
    const set = (k, v) => setF(prev => Object.assign({}, prev, { [k]: v }));
    const submit = () => {
      if (!f.name.trim()) { setErr('請輸入案名'); return; }
      const pid = TIM.actions.createProject({ name: f.name.trim(), code: f.code.trim(), product_type: f.product_type, customer: f.customer.trim(), stage: f.stage, owner: f.owner.trim(), me_owner: f.me_owner.trim() });
      const preset = schema.LOCATION_PRESETS.find(x => x.v === f.locations);
      if (preset) TIM.store.mutateProject(pid, p => { p.locations = preset.names.map((n, i) => schema.newLocation(n, i)); }, { noUndo: true });
      props.close(pid);
    };
    return html`<${Modal} title="新增專案" onClose=${() => props.close(null)} onEnter=${submit}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button><button class="btn btn-primary" onClick=${submit}>建立專案</button>`}>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <${Field} label="案名 *" class="span-2" error=${err}><input class=${cx('inp', err && 'invalid')} autofocus value=${f.name} placeholder="例如：RRU n78 64T" onInput=${e => { set('name', e.target.value); setErr(''); }} /></${Field}>
        <${Field} label="專案代碼"><input class="inp" value=${f.code} onInput=${e => set('code', e.target.value)} /></${Field}>
        <${Field} label="產品類型"><${SelectField} value=${f.product_type} options=${schema.PRODUCT_TYPES} onChange=${v => set('product_type', v)} /></${Field}>
        <${Field} label="客戶"><input class="inp" value=${f.customer} onInput=${e => set('customer', e.target.value)} /></${Field}>
        <${Field} label="Stage"><${SelectField} value=${f.stage} allowEmpty=${false} options=${schema.STAGES} onChange=${v => set('stage', v)} /></${Field}>
        <${Field} label="熱流負責人"><input class="inp" value=${f.owner} onInput=${e => set('owner', e.target.value)} /></${Field}>
        <${Field} label="機構負責人"><input class="inp" value=${f.me_owner} onInput=${e => set('me_owner', e.target.value)} /></${Field}>
        <${Field} label="Location" hint="之後可在專案總覽增減、改名、改顏色"><${SelectField} value=${f.locations} allowEmpty=${false} options=${schema.LOCATION_PRESETS} onChange=${v => set('locations', v)} /></${Field}>
      </div>
    </${Modal}>`;
  }

  async function newProject() {
    const m = openModal(close => html`<${NewProjectModal} close=${close} />`);
    const pid = await m.promise;
    if (pid) go('p/' + pid + '/bom');
  }

  async function duplicate(p) {
    const name = await prompt({ title: '複製專案', label: '新專案名稱', value: p.name + ' (副本)', hint: '會複製 TIM 清單、Location、位置標註（不含變更紀錄與基準）', validate: v => (v.trim() ? '' : '請輸入名稱') });
    if (!name) return;
    const id = TIM.actions.duplicateProject(p.id, name.trim());
    toast('已複製為「' + name.trim() + '」', 'ok');
    return id;
  }

  async function remove(p) {
    const ok = await confirm({
      title: '刪除專案', danger: true, okText: '刪除專案',
      message: '確定刪除「' + p.name + '」？\n' + p.items.length + ' 個 Item、' + p.views.length + ' 張位置圖、所有變更紀錄與基準都會一併刪除，無法復原。\n（建議先用「備份資料庫」留一份）',
    });
    if (!ok) return;
    TIM.actions.deleteProject(p.id);
    toast('已刪除「' + p.name + '」', 'ok');
  }

  function projectMenu(e, p) {
    TIM.ui.openMenu(e, [
      { label: '開啟', icon: 'chevR', onClick: () => go('p/' + p.id) },
      { label: '複製專案…', icon: 'copy', onClick: () => duplicate(p), disabled: TIM.store.readonly },
      { label: '匯出 Excel', icon: 'excel', onClick: () => TIM.app.exportExcel(p.id) },
      { label: '匯出 PDF', icon: 'pdf', onClick: () => TIM.ui.openPdfExport(p.id) },
      { label: '匯出分享檔（JSON）', icon: 'download', onClick: () => TIM.share.exportProject(p.id) },
      'sep',
      { label: '刪除專案…', icon: 'trash', danger: true, onClick: () => remove(p), disabled: TIM.store.readonly },
    ]);
  }

  function Health(props) {
    const s = props.s;
    const tags = [];
    if (s.errors) tags.push(html`<span class="tag tag-err" title="錯誤">✕ ${s.errors}</span>`);
    if (s.warns) tags.push(html`<span class="tag tag-warn" title="警示">! ${s.warns}</span>`);
    if (s.single) tags.push(html`<span class="tag tag-single" title="單一來源 Item">單一來源 ${s.single}</span>`);
    if (!tags.length) tags.push(html`<span class="tag tag-ok">✓ 無警示</span>`);
    return html`<div class="health">${tags}</div>`;
  }



  function SearchResults(props) {
    const res = props.results;
    if (!res.length) return html`<div class="empty"><h3>找不到「${props.q}」</h3><p>可搜尋：Item、Vendor、Model、台達料號、原廠料號、覆蓋元件料號 / RefDes、第二來源、加工廠、備註、專案名稱。多個關鍵字以空白分隔（同時符合）。</p></div>`;
    const groups = [];
    res.forEach(r => { let g = groups.find(x => x.pid === r.project_id); if (!g) { g = { pid: r.project_id, name: r.project, stage: r.stage, rows: [] }; groups.push(g); } g.rows.push(r); });
    return html`<div class="search-results">
      <div class="muted" style="font-size:12px">${res.length} 筆結果${res.length >= 200 ? '（最多顯示 200 筆）' : ''} · ${groups.length} 個專案</div>
      ${groups.map(g => html`<div key=${g.pid}>
        <div class="hit-proj">${g.name} <span class="tag tag-stage">${g.stage}</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th style="width:80px">Item</th><th style="width:120px">Location</th><th style="width:220px">材料</th><th>符合欄位</th></tr></thead>
          <tbody>${g.rows.map(r => html`<tr class="clickable" key=${r.item_id} onClick=${() => go('p/' + r.project_id + '/bom/' + r.item_id)}>
            <td class="mono"><b>${highlight(r.item_no, props.q)}</b></td><td>${r.location}</td>
            <td>${highlight([r.vendor, r.model].filter(Boolean).join(' '), props.q)}</td>
            <td>${r.hits.filter(h => h.field !== 'item_no' && h.field !== 'vendor' && h.field !== 'model').map(h => html`<span style="margin-right:14px"><span class="muted">${h.label}：</span>${highlight(h.value, props.q)}</span>`)}</td>
          </tr>`)}</tbody>
        </table></div>
      </div>`)}
    </div>`;
  }

  function Home() {
    const st = TIM.store;
    const db = st.db;
    const [q, setQ] = useState('');
    const [stage, setStage] = usePref('home_stage', '');
    const [status, setStatus] = usePref('home_status', 'open');
    const [sort, setSort] = usePref('home_sort', 'updated');
    const searchRef = useRef(null);

    useEffect(() => {
      const on = e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current && searchRef.current.focus(); }
      };
      window.addEventListener('keydown', on);
      return () => window.removeEventListener('keydown', on);
    }, []);

    const projects = Object.values(db.projects);
    const rows = useMemo(() => projects
      .filter(p => !stage || p.stage === stage)
      .filter(p => status === 'all' || (status === 'open' ? p.status !== 'closed' : p.status === status))
      .map(p => ({ p, s: calc.projectStats(p, db) }))
      .sort((a, b) => sort === 'name' ? String(a.p.name).localeCompare(String(b.p.name))
        : sort === 'risk' ? (b.s.errors * 100 + b.s.warns) - (a.s.errors * 100 + a.s.warns)
        : String(b.p.updated_at).localeCompare(String(a.p.updated_at))), [st.version, stage, status, sort]);
    const results = useMemo(() => (q.trim() ? calc.searchItems(db, q) : null), [st.version, q]);

    return html`<div class="page"><div class="page-inner">
      <div class="home-head">
        <div>
          <div class="eyebrow">Projects · ${projects.length}</div>
          <h1>專案 TIM 清單</h1>
        </div>
        <div class="home-actions">
          <button class="btn btn-secondary rw-only" onClick=${() => TIM.app.openImportExcel()}><${Icon} name="excel" /> 匯入 Excel</button>
          <button class="btn btn-secondary rw-only" onClick=${() => TIM.app.importShareFile()}><${Icon} name="upload" /> 匯入分享檔</button>
          <button class="btn btn-primary rw-only" onClick=${newProject}><${Icon} name="plus" /> 新增專案</button>
        </div>
      </div>

      <div class="searchbox">
        <${Icon} name="search" />
        <input class="inp" ref=${searchRef} value=${q} placeholder="跨專案搜尋：料號、元件、RefDes、廠商、型號、第二來源…" onInput=${e => setQ(e.target.value)}
          onKeyDown=${e => { if (e.key === 'Escape') setQ(''); }} />
        ${!q ? html`<kbd>Ctrl K</kbd>` : null}
      </div>

      ${results ? html`<div class="section" style="margin-top:18px"><${SearchResults} results=${results} q=${q} /></div>` : html`
        <div class="filters">
          <div class="seg">
            ${[''].concat(schema.STAGES).map(sg => html`<button class=${stage === sg ? 'on' : ''} onClick=${() => setStage(sg)}>${sg || '全部 Stage'}</button>`)}
          </div>
          <select class="sel" style="width:150px" value=${status} onChange=${e => setStatus(e.target.value)}>
            <option value="open">進行中 + 暫停</option><option value="active">只看進行中</option><option value="closed">只看結案</option><option value="all">全部狀態</option>
          </select>
          <span class="spacer"></span>
          <span class="muted" style="font-size:12px">排序</span>
          <select class="sel" style="width:130px" value=${sort} onChange=${e => setSort(e.target.value)}>
            <option value="updated">最近更新</option><option value="name">名稱</option><option value="risk">風險多→少</option>
          </select>
        </div>
        ${!projects.length ? html`<div class="empty">
            <h3>還沒有任何專案</h3>
            <p>從現在的 Excel TIM 清單匯入最快：欄位（Location / Item / Used On / Vendor / Model / Size / Q'ty / Delta Part No. / Note / 2nd source）會自動對應，表格下方的機殼圖片也會變成位置標註視圖。</p>
            <div class="actions">
              <button class="btn btn-primary rw-only" onClick=${() => TIM.app.openImportExcel()}><${Icon} name="excel" /> 匯入 Excel</button>
              <button class="btn btn-secondary rw-only" onClick=${newProject}><${Icon} name="plus" /> 新增空白專案</button>
            </div>
          </div>` : !rows.length ? html`<div class="empty"><h3>沒有符合篩選條件的專案</h3><p>調整上方的 Stage / 狀態篩選。</p></div>` : html`
        <div class="tbl-wrap"><table class="tbl proj-table">
          <thead><tr><th>專案</th><th>Stage</th><th>負責人</th><th>規模</th><th>健康度</th><th>位置圖</th><th>最後更新</th><th></th></tr></thead>
          <tbody>${rows.map(({ p, s }) => html`<tr class="clickable" key=${p.id} onClick=${() => go('p/' + p.id)} onContextMenu=${e => { e.preventDefault(); projectMenu(e, p); }}>
            <td style="min-width:260px">
              <div class="proj-name">${p.name || '(未命名)'}</div>
              <div class="proj-sub">${schema.projectSubline(p) || '—'}${p.status !== 'active' ? html` · <span class="tag tag-mute">${schema.labelOf(schema.PROJECT_STATUS, p.status)}</span>` : null}</div>
            </td>
            <td><span class="tag tag-stage">${p.stage}</span></td>
            <td class="proj-owners"><div><span class="role">TH:</span>${p.owner || html`<span class="muted">—</span>`}</div><div><span class="role">ME:</span>${p.me_owner || html`<span class="muted">—</span>`}</div></td>
            <td><div class="proj-metrics"><span><b>${s.items}</b> items</span><span><b>${s.pcs}</b> pcs</span><span><b>${s.materials}</b> 材料</span></div></td>
            <td><${Health} s=${s} /></td>
            <td class="mono" style="font-size:12px">${p.views.length ? html`${p.views.length} 張 · ${s.placed}/${s.qty_total}` : html`<span class="muted">—</span>`}</td>
            <td style="white-space:nowrap" title=${'最後修改：' + util.fmtDateTime(p.updated_at) + (p.updated_by ? '（' + p.updated_by + '）' : '')}><div>${util.fmtAgo(p.updated_at)}</div><div class="proj-sub">${p.owner || ''}</div></td>
            <td onClick=${e => e.stopPropagation()}><div class="row-actions">
              <button class="icon-btn" title="匯出 Excel" onClick=${() => TIM.app.exportExcel(p.id)}><${Icon} name="excel" /></button>
              <button class="icon-btn rw-only" title="複製專案" onClick=${() => duplicate(p)}><${Icon} name="copy" /></button>
              <button class="icon-btn" title="更多" onClick=${e => projectMenu(e, p)}><${Icon} name="more" /></button>
            </div></td>
          </tr>`)}</tbody>
        </table></div>`}
      `}
    </div></div>`;
  }

  TIM.ui.Home = Home;
  TIM.ui.newProject = newProject;
  TIM.ui.duplicateProject = duplicate;
  TIM.ui.removeProject = remove;
})();
