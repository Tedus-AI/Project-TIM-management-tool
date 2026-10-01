/* Settings: new-project defaults, database / backup management. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon, Modal, openModal, Field } = TIM.ui;
  const { util } = TIM;

  function SettingsModal(props) {
    const st = TIM.store;
    const db = st.db;
    const s = db.settings;
    const ro = st.readonly;
    const locKey = TIM.schema.locationPresetOf(s.default_locations);
    const locOptions = TIM.schema.LOCATION_PRESETS.concat(locKey ? [] : [{ v: '', label: (s.default_locations || []).join(' + ') || '—' }]);
    const [size, setSize] = useState(null);
    const backend = st.backend;
    useEffect(() => { (async () => { try { setSize(await backend.size()); } catch (e) { /* ignore */ } })(); }, []);
    const counts = { p: Object.keys(db.projects).length, m: Object.keys(db.materials).length, i: Object.keys(db.images).length,
      d: Object.values(db.materials).reduce((n, m) => n + ((m.datasheets && m.datasheets.length) || 0), 0) };
    const isSp = backend.kind === 'sharepoint';
    const acc = isSp ? backend.account() : null;
    const files = backend.files;

    const close = () => props.close();
    const setLocs = v => { const f = TIM.schema.LOCATION_PRESETS.find(x => x.v === v); if (f) TIM.actions.updateSettings({ default_locations: f.names.slice() }); };

    return html`<${Modal} title="設定" size="mid" onClose=${close} footer=${html`<button class="btn btn-primary" onClick=${close}>完成</button>`}>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <${Field} label="新專案預設 Location" info="新增專案時預先帶入的 Location（TIM 清單分組、Excel 的 Location 欄）；建立後仍可在專案總覽增減、改名">
          <select class="sel" value=${locKey} disabled=${ro} onChange=${e => setLocs(e.target.value)}>${locOptions.map(o => html`<option value=${o.v}>${o.label}</option>`)}</select></${Field}>
        <${Field} label="預設幣別"><select class="sel" value=${s.currency} disabled=${ro} onChange=${e => TIM.actions.updateSettings({ currency: e.target.value })}>${TIM.schema.CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</select></${Field}>
      </div>
      <div class="divider"></div>
      <div class="field-label" style="margin-bottom:8px">資料庫</div>
      <dl class="kv">
        <dt>位置</dt><dd class="mono">${isSp ? 'SharePoint · ' : ''}${backend.location ? backend.location() : backend.label()}</dd>
        ${isSp && acc ? html`<dt>帳號</dt><dd>${acc.name}${acc.email && acc.email !== acc.name ? html` <span class="muted">${acc.email}</span>` : null}</dd>` : null}
        <dt>大小</dt><dd class="mono">${size == null ? '…' : util.fmtBytes(size)}</dd>
        <dt>內容</dt><dd>${counts.p} 個專案 · ${counts.m} 種材料 · ${counts.i} 張圖片 · ${counts.d} 份規格書 · rev ${db.rev}</dd>
        <dt>規格書</dt><dd class="mono">${files && files.supported() ? files.where() : html`<span class="muted" style="font-family:var(--font-body)">需以資料夾或 SharePoint 開啟資料庫</span>`}</dd>
        <dt>自動備份</dt><dd>${TIM.backup.ready() ? TIM.backup.name() + (TIM.backup.lastAt() ? '（最近 ' + util.fmtDateTime(new Date(TIM.backup.lastAt()).toISOString()) + '）' : '') : '未設定'}</dd>
      </dl>
      <div class="row wrap mt12" style="gap:8px">
        <button class="btn btn-secondary btn-sm" onClick=${() => TIM.app.downloadBackup()}><${Icon} name="download" /> 下載備份（JSON）</button>
        ${!isSp && TIM.backup.supported() ? html`<button class="btn btn-secondary btn-sm" onClick=${() => TIM.app.pickBackupDir()}><${Icon} name="folder" /> ${TIM.backup.ready() ? '變更' : '設定'}自動備份資料夾</button>` : null}
        ${!isSp && !ro ? html`<button class="btn btn-secondary btn-sm" onClick=${async () => { if (await TIM.app.moveToSharePoint()) props.close(); }}><${Icon} name="cloud" /> 搬到 SharePoint…</button>` : null}
      </div>
      <p class="muted" style="font-size:11.5px;margin-top:12px;line-height:1.6">自動備份：開啟工具時、每 3 小時、切換分頁時寫入「tim_db_backup_YYYY-MM-DD.json」${isSp ? '（SharePoint 的 Database / Backup 資料夾）' : ''}，每天一份、保留最近 30 份。<br/>
        ${isSp ? html`多人同時編輯：每次存檔都會比對 SharePoint 上的版本，有人剛存過就先合併再寫入，不會互相覆蓋。<br/>` : null}
        沒有被任何專案使用的圖片會在存檔時自動清除（可復原範圍內的圖片會保留）。</p>
      <p class="muted mono" style="font-size:10.5px;margin-top:8px">版本 ${TIM.app.version}</p>
    </${Modal}>`;
  }

  TIM.ui.openSettings = () => openModal(close => html`<${SettingsModal} close=${close} />`);
})();
