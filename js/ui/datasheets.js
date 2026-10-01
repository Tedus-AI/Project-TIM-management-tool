/* 規格書 (datasheet files) on materials — the same five buttons as the 規格書 column of the
 * AI Thermal pad & stud tool:
 *   👁 view      one file: open it; several: the viewer has a file switcher (count badge on the button)
 *   ↑ upload    several files at once; a file with the same name replaces that one
 *   ↓ download  one file: download it; several: open the list to pick
 *   🗑 delete    one file: confirm; several: open the list to pick
 *   🕘 list      every file with size, upload time and uploader: view / download / replace / delete
 * Files live next to the database (SharePoint: TIM_Manager/Datasheets/<Vendor>/<Model>/<file>;
 * local folder: <database folder>/Datasheets/…); the material keeps the list (newest first).
 * A removed file is deleted from storage after the change is saved (TIM.app.queueFileDeletes).
 * View, download and list also work read-only.
 */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon, cx, useStore, Modal, openModal, confirm, toast, downloadBlob, pickFiles, pickFile } = TIM.ui;
  const { util } = TIM;

  const MAX_FILES = 20;                      // per material (guards against selecting a whole folder)
  const MAX_BYTES = 100 * 1024 * 1024;
  const MIME = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', txt: 'text/plain', csv: 'text/plain',
  };
  const NO_STORAGE = '規格書存放在資料庫旁邊：請以「SharePoint 共用資料庫」或「本機資料夾」開啟資料庫後再上傳';

  const extOf = name => { const m = /\.([A-Za-z0-9]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
  const listOf = m => (m && Array.isArray(m.datasheets) ? m.datasheets : []);
  const storage = () => { const b = TIM.store.backend; return b && b.files && b.files.supported() ? b.files : null; };
  const isSp = () => !!(TIM.store.backend && TIM.store.backend.kind === 'sharepoint');
  /** Folder of a material's files below Datasheets/. */
  const folderOf = m => util.storageName(m.vendor || '未填廠商') + '/' + util.storageName(m.model || m.id);
  const metaText = d => [d.size != null ? util.fmtBytes(d.size) : '', d.at ? util.fmtDateTime(d.at) : '', d.by || ''].filter(Boolean).join(' · ');
  const whereText = m => { const f = storage(); return f ? f.where() + ' / ' + folderOf(m).split('/').join(' / ') : ''; };

  // ───────── operations ─────────

  /** Upload files to a material. replacePath: the list entry a 「取代」 replaces. Returns the count uploaded. */
  async function upload(matId, picked, replacePath) {
    const files = storage();
    if (!files) { toast(NO_STORAGE, 'err'); return 0; }
    let n = 0;
    for (const f of picked || []) {
      const m = TIM.store.db && TIM.store.db.materials[matId];
      if (!m || TIM.store.readonly) break;
      const name = util.storageName(f.name);
      if (f.size > MAX_BYTES) { toast(name + ' 超過 100 MB，未上傳', 'err'); continue; }
      const list = listOf(m);
      const same = list.find(d => d.name.toLowerCase() === name.toLowerCase());
      const target = replacePath ? list.find(d => d.path === replacePath) : null;
      if (!same && !target && list.length >= MAX_FILES) { toast('每種材料最多 ' + MAX_FILES + ' 份規格書，請先刪掉不需要的', 'err'); break; }
      const path = same ? same.path : folderOf(m) + '/' + name;
      toast('上傳中… ' + name, 'info', { timeout: 2500 });
      try { await files.put(path, f); } catch (e) { toast('上傳失敗：' + name + '（' + (e.message || e) + '）', 'err'); continue; }
      const now = TIM.store.db.materials[matId];
      if (!now) break;
      const entry = { path, name, size: f.size, at: util.nowIso(), by: TIM.store.user() };
      const rest = listOf(now).filter(d => d.path !== path && (!target || d.path !== target.path));
      if (target && target.path !== path) TIM.app.queueFileDeletes([target.path]);
      TIM.actions.setDatasheets(matId, [entry].concat(rest));
      n++;
    }
    if (n) toast(n === 1 ? '已上傳規格書' : '已上傳 ' + n + ' 份規格書', 'ok');
    return n;
  }

  async function pickAndUpload(matId) {
    if (!storage()) { toast(NO_STORAGE, 'err'); return; }
    const picked = await pickFiles();
    if (picked.length) await upload(matId, picked);
  }

  async function replace(matId, d) {
    const f = await pickFile();
    if (f) await upload(matId, [f], d.path);
  }

  async function download(d) {
    const files = storage();
    if (!files) { toast(NO_STORAGE, 'err'); return; }
    try { downloadBlob(await files.blob(d.path), d.name); } catch (e) { toast('下載失敗：' + (e.message || e), 'err'); }
  }

  /** Remove a file from the material (after a confirm unless o.silent); the file is deleted once saved. */
  async function remove(matId, d, o) {
    if (!(o && o.silent)) {
      const ok = await confirm({ title: '刪除規格書', danger: true, okText: '刪除',
        message: '刪除「' + d.name + '」？\n' + (isSp() ? '存檔後檔案會移到 SharePoint 的資源回收筒（可從那裡還原）。' : '存檔後檔案會從資料庫資料夾刪除。') });
      if (!ok) return false;
    }
    const m = TIM.store.db.materials[matId];
    if (!m) return false;
    if (!TIM.actions.setDatasheets(matId, listOf(m).filter(x => x.path !== d.path))) return false;
    TIM.app.queueFileDeletes([d.path]);
    if (!(o && o.silent)) toast('已刪除規格書', 'ok');
    return true;
  }

  // ───────── viewer ─────────

  function Viewer(props) {
    const st = useStore();
    const m = st.db && st.db.materials[props.matId];
    const list = listOf(m);
    const [cur, setCur] = useState(props.start || (list[0] && list[0].path));
    const d = list.find(x => x.path === cur) || list[0] || null;
    const [view, setView] = useState({ state: 'loading' });
    const [web, setWeb] = useState(null);
    useEffect(() => {
      if (!d) return undefined;
      let url = null, dead = false;
      setView({ state: 'loading' }); setWeb(null);
      (async () => {
        const files = storage();
        if (!files) { setView({ state: 'error', error: NO_STORAGE }); return; }
        try {
          const raw = await files.blob(d.path);
          if (dead) return;
          const type = MIME[extOf(d.name)] || raw.type || 'application/octet-stream';
          const kind = type === 'application/pdf' ? 'pdf' : /^image\//.test(type) ? 'image' : /^text\//.test(type) ? 'text' : 'other';
          if (kind === 'text') { const text = await raw.text(); if (!dead) setView({ state: 'ok', kind, text: text.slice(0, 200000) }); return; }
          url = URL.createObjectURL(new Blob([raw], { type }));
          setView({ state: 'ok', kind, url });
        } catch (e) {
          if (!dead) setView({ state: 'error', error: e.message || String(e), missing: e.status === 404 || /找不到/.test(e.message || '') });
        }
        try { const w = await files.webUrl(d.path); if (!dead) setWeb(w); } catch (e) { /* optional link */ }
      })();
      return () => { dead = true; if (url) URL.revokeObjectURL(url); };
    }, [d && d.path, d && d.at]);

    if (!m || !d) return html`<${Modal} title="規格書" onClose=${props.close}><p class="muted">這個材料沒有規格書。</p></${Modal}>`;
    const head = html`<div class="row" style="gap:6px">
      ${web ? html`<a class="btn btn-ghost btn-sm" href=${web} target="_blank" rel="noopener noreferrer" title="在 SharePoint / Office Online 開啟">SharePoint ↗</a>` : null}
      <button class="btn btn-secondary btn-sm" onClick=${() => download(d)}><${Icon} name="download" /> 下載</button>
    </div>`;
    return html`<${Modal} title=${'規格書 · ' + [m.vendor, m.model].filter(Boolean).join(' ')} size="viewer" onClose=${props.close} headRight=${head}>
      ${list.length > 1 ? html`<div class="ds-tabs" role="tablist">${list.map(x => html`<button key=${x.path} role="tab" aria-selected=${x === d}
          class=${cx('ds-tab', x === d && 'on')} title=${x.name + '\n' + metaText(x)} onClick=${() => setCur(x.path)}>${x.name}</button>`)}</div>` : null}
      <div class="ds-view">
        ${view.state === 'loading' ? html`<div class="ds-msg muted">讀取中… ${d.name}</div>`
          : view.state === 'error' ? html`<div class="ds-msg">
              <p class="text-err">${view.error}</p>
              ${view.missing && !st.readonly ? html`<p class="muted">紀錄還在但檔案已不在${isSp() ? '（可到 SharePoint 的資源回收筒找回）' : ''}。</p>
                <button class="btn btn-secondary btn-sm mt8" onClick=${async () => { if (await remove(m.id, d, { silent: true })) toast('已移除這筆紀錄', 'ok'); }}>移除這筆紀錄</button>` : null}
            </div>`
          : view.kind === 'pdf' ? html`<iframe class="ds-frame" src=${view.url} title=${d.name}></iframe>`
          : view.kind === 'image' ? html`<div class="ds-img"><img src=${view.url} alt=${d.name} /></div>`
          : view.kind === 'text' ? html`<pre class="ds-text">${view.text}</pre>`
          : html`<div class="ds-msg"><p>「${d.name}」無法在這裡預覽。</p>
              <p class="muted">${web ? '可用右上角「SharePoint ↗」在 Office Online 開啟，或下載後開啟。' : '請下載後開啟。'}</p></div>`}
      </div>
      <div class="ds-foot muted">${d.name} · ${metaText(d)}</div>
    </${Modal}>`;
  }

  // ───────── list ─────────

  function ListModal(props) {
    const st = useStore();
    const m = st.db && st.db.materials[props.matId];
    if (!m) return html`<${Modal} title="規格書清單" onClose=${props.close}><p class="muted">找不到材料。</p></${Modal}>`;
    const list = listOf(m);
    const ro = st.readonly;
    const can = !!storage();
    return html`<${Modal} title=${'規格書清單 · ' + [m.vendor, m.model].filter(Boolean).join(' ')} size="mid" onClose=${props.close}
        headRight=${!ro ? html`<button class="btn btn-primary btn-sm" disabled=${!can} title=${can ? '可一次選多個檔案；同檔名會取代原本那一份' : NO_STORAGE}
          onClick=${() => pickAndUpload(m.id)}><${Icon} name="upload" /> 上傳規格書</button>` : null}
        footer=${html`<span class="left">${can ? '存放位置：' + whereText(m) : NO_STORAGE}</span><button class="btn btn-ghost" onClick=${props.close}>關閉</button>`}>
      ${list.length ? html`<table class="subtbl ds-list">
        <thead><tr><th>檔名</th><th class="r">大小</th><th>上傳時間</th><th>上傳者</th><th></th></tr></thead>
        <tbody>${list.map(d => html`<tr key=${d.path}>
          <td class="ds-name" title=${d.path}>${d.name}</td>
          <td class="r mono">${d.size != null ? util.fmtBytes(d.size) : ''}</td>
          <td class="mono">${d.at ? util.fmtDateTime(d.at) : ''}</td>
          <td>${d.by || ''}</td>
          <td class="ds-acts">
            <button class="icon-btn" title="檢視" onClick=${() => openViewer(m.id, d.path)}><${Icon} name="eye" /></button>
            <button class="icon-btn" title="下載" onClick=${() => download(d)}><${Icon} name="download" /></button>
            ${!ro ? html`<button class="icon-btn" title="取代（上傳新檔取代這一份）" disabled=${!can} onClick=${() => replace(m.id, d)}><${Icon} name="upload" /></button>
              <button class="icon-btn danger" title="刪除" onClick=${() => remove(m.id, d)}><${Icon} name="trash" /></button>` : null}
          </td>
        </tr>`)}</tbody>
      </table>` : html`<p class="muted">還沒有規格書。${!ro && can ? '按右上角「上傳規格書」，可一次選多個檔案。' : ''}</p>`}
    </${Modal}>`;
  }

  function openViewer(matId, start) { return openModal(close => html`<${Viewer} matId=${matId} start=${start} close=${close} />`).promise; }
  function openList(matId) { return openModal(close => html`<${ListModal} matId=${matId} close=${close} />`).promise; }

  // ───────── buttons ─────────

  /** The five buttons (👁 ↑ ↓ 🗑 🕘) with tooltips. */
  function DatasheetButtons(props) {
    const m = props.mat;
    const st = TIM.store;
    const list = listOf(m);
    const n = list.length;
    const first = list[0];
    const ro = st.readonly;
    const can = !!storage();
    const lines = list.map((d, i) => (i + 1) + '. ' + d.name).join('\n');
    const tipView = !n ? '尚未上傳規格書' : n === 1 ? '線上瀏覽：' + first.name + '（不必下載）' : '線上瀏覽（共 ' + n + ' 份，視窗上方可切換）：\n' + lines;
    const tipUp = !can ? NO_STORAGE : ro ? '唯讀模式' : !n ? '上傳規格書（可一次選多個檔案）'
      : '上傳規格書（可一次選多個檔案）：新檔加入清單，同檔名則取代原本那一份\n目前 ' + n + ' 份：\n' + lines;
    const tipDown = !n ? '尚未上傳規格書' : n === 1 ? '下載規格書：' + first.name : '下載規格書（共 ' + n + ' 份）→ 開啟清單選要下載哪一份';
    const tipDel = !n ? '尚未上傳規格書' : ro ? '唯讀模式' : n === 1 ? '刪除規格書：' + first.name : '刪除規格書（共 ' + n + ' 份）→ 開啟清單選要刪除哪一份';
    const tipList = !n ? '尚無上傳紀錄' : '規格書清單（共 ' + n + ' 份）：檢視／下載／取代／刪除，並列出每一份的上傳時間\n最新一份：' + first.name + '　' + metaText(first);
    return html`<div class="ds-btns" role="group" aria-label="規格書">
      <button type="button" class=${cx('ds-btn', n && 'has')} data-ds="view" disabled=${!n} title=${tipView} onClick=${() => openViewer(m.id)}>
        <${Icon} name="eye" />${n > 1 ? html`<span class="ds-n">${n}</span>` : null}</button>
      <button type="button" class="ds-btn" data-ds="upload" disabled=${ro || !can} title=${tipUp} onClick=${() => pickAndUpload(m.id)}><${Icon} name="upload" /></button>
      <button type="button" class="ds-btn" data-ds="download" disabled=${!n} title=${tipDown} onClick=${() => (n === 1 ? download(first) : openList(m.id))}><${Icon} name="download" /></button>
      <button type="button" class="ds-btn danger" data-ds="delete" disabled=${!n || ro} title=${tipDel} onClick=${() => (n === 1 ? remove(m.id, first) : openList(m.id))}><${Icon} name="trash" /></button>
      <button type="button" class="ds-btn" data-ds="list" disabled=${!n} title=${tipList} onClick=${() => openList(m.id)}><${Icon} name="history" /></button>
    </div>`;
  }

  /** Drawer field: buttons + newest file; files can also be dropped onto it. */
  function DatasheetField(props) {
    const m = props.mat;
    const [over, setOver] = useState(false);
    const list = listOf(m);
    const first = list[0];
    const canDrop = !TIM.store.readonly && !!storage();
    const files = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    return html`<div class=${cx('ds-field', over && 'over')}
        onDragOver=${e => { if (!canDrop || !files(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; if (!over) setOver(true); }}
        onDragLeave=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop=${e => { if (!canDrop || !files(e)) return; e.preventDefault(); setOver(false); upload(m.id, Array.from(e.dataTransfer.files || [])); }}>
      <${DatasheetButtons} mat=${m} />
      <div class="ds-meta">${first ? html`<b title=${first.name}>${first.name}</b>${list.length > 1 ? html`<span class="muted"> 等 ${list.length} 份</span>` : null}
          <div class="muted">${metaText(first)}</div>`
        : html`<span class="muted">${canDrop ? '尚未上傳規格書（可直接把檔案拖到這裡）' : storage() ? '尚未上傳規格書' : NO_STORAGE}</span>`}</div>
    </div>`;
  }

  /** Material list column: 👁 only (with the count), like the read-only 規格書 column of the AI Thermal tool. */
  function DatasheetEye(props) {
    const n = listOf(props.mat).length;
    return html`<button type="button" class=${cx('ds-btn', n && 'has')} data-ds="view" disabled=${!n}
        title=${n ? '線上瀏覽規格書' + (n > 1 ? '（共 ' + n + ' 份）' : '：' + listOf(props.mat)[0].name) : '尚未上傳規格書'}
        onClick=${e => { e.stopPropagation(); openViewer(props.mat.id); }}><${Icon} name="eye" />${n > 1 ? html`<span class="ds-n">${n}</span>` : null}</button>`;
  }

  Object.assign(TIM.ui, { DatasheetButtons, DatasheetField, DatasheetEye, openDatasheetViewer: openViewer, openDatasheetList: openList });
  TIM.datasheets = { upload, remove, folderOf, whereText };
})();
