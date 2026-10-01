/* Settings: user, defaults & thresholds, database / backup management. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, Icon, Modal, openModal, NumField, Field, toast } = TIM.ui;
  const { util } = TIM;

  function SettingsModal(props) {
    const st = TIM.store;
    const db = st.db;
    const s = db.settings;
    const ro = st.readonly;
    const [user, setUser] = useState(TIM.app.getUserName());
    const [locs, setLocs] = useState((s.default_locations || []).join(', '));
    const [size, setSize] = useState(null);
    const backend = st.backend;
    useEffect(() => { (async () => { try { setSize(await backend.size()); } catch (e) { /* ignore */ } })(); }, []);
    const gc = s.generic_comp || {};
    const setGc = (type, k, v) => TIM.actions.updateSettings({ generic_comp: Object.assign({}, gc, { [type]: Object.assign({ min: null, max: null }, gc[type], { [k]: v }) }) });
    const counts = { p: Object.keys(db.projects).length, m: Object.keys(db.materials).length, i: Object.keys(db.images).length };

    const close = () => {
      TIM.app.setUserName(user.trim());
      const names = locs.split(/[,，]/).map(x => x.trim()).filter(Boolean);
      if (!ro && JSON.stringify(names) !== JSON.stringify(s.default_locations || [])) TIM.actions.updateSettings({ default_locations: names });
      props.close();
    };

    return html`<${Modal} title="設定" size="mid" onClose=${close} footer=${html`<button class="btn btn-primary" onClick=${close}>完成</button>`}>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <${Field} label="你的名字" hint="寫入變更紀錄（存在此瀏覽器）"><input class="inp" value=${user} onInput=${e => setUser(e.target.value)} /></${Field}>
        <${Field} label="新專案預設 Location" hint="逗號分隔"><input class="inp" value=${locs} disabled=${ro} onInput=${e => setLocs(e.target.value)} /></${Field}>
        <${Field} label="TIM 溫升警示門檻" hint="ΔT 估算 ≥ 此值列入警示"><${NumField} value=${s.dt_warn} unit="°C" disabled=${ro} onChange=${v => TIM.actions.updateSettings({ dt_warn: v })} /></${Field}>
        <${Field} label="預設幣別"><select class="sel" value=${s.currency} disabled=${ro} onChange=${e => TIM.actions.updateSettings({ currency: e.target.value })}>${TIM.schema.CURRENCIES.map(c => html`<option value=${c}>${c}</option>`)}</select></${Field}>
      </div>
      <div class="divider"></div>
      <div class="field-label" style="margin-bottom:8px">一般建議壓縮率（材料庫沒有 datasheet 數值時的 fallback，畫面上會標示「一般建議值」）</div>
      <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">
        <${Field} label="Thermal Pad min"><${NumField} value=${gc.pad && gc.pad.min} unit="%" disabled=${ro} onChange=${v => setGc('pad', 'min', v)} /></${Field}>
        <${Field} label="Thermal Pad max"><${NumField} value=${gc.pad && gc.pad.max} unit="%" disabled=${ro} onChange=${v => setGc('pad', 'max', v)} /></${Field}>
        <${Field} label="Absorber min"><${NumField} value=${gc.absorber && gc.absorber.min} unit="%" disabled=${ro} onChange=${v => setGc('absorber', 'min', v)} /></${Field}>
        <${Field} label="Absorber max"><${NumField} value=${gc.absorber && gc.absorber.max} unit="%" disabled=${ro} onChange=${v => setGc('absorber', 'max', v)} /></${Field}>
      </div>
      <div class="divider"></div>
      <div class="field-label" style="margin-bottom:8px">資料庫</div>
      <dl class="kv">
        <dt>模式</dt><dd>${backend.kind === 'file' ? 'JSON 檔' : '瀏覽器暫存（試用）'}</dd>
        <dt>檔案</dt><dd class="mono">${backend.location ? backend.location() : backend.label()}</dd>
        <dt>大小</dt><dd class="mono">${size == null ? '…' : util.fmtBytes(size)}</dd>
        <dt>內容</dt><dd>${counts.p} 個專案 · ${counts.m} 種材料 · ${counts.i} 張圖片 · rev ${db.rev}</dd>
        <dt>自動備份</dt><dd>${TIM.backup.ready() ? TIM.backup.name() + (TIM.backup.lastAt() ? '（最近 ' + util.fmtDateTime(new Date(TIM.backup.lastAt()).toISOString()) + '）' : '') : '未設定'}</dd>
      </dl>
      <div class="row wrap mt12" style="gap:8px">
        <button class="btn btn-secondary btn-sm" onClick=${() => TIM.app.downloadBackup()}><${Icon} name="download" /> 下載備份（JSON）</button>
        ${TIM.backup.supported() ? html`<button class="btn btn-secondary btn-sm" onClick=${() => TIM.app.pickBackupDir()}><${Icon} name="folder" /> ${TIM.backup.ready() ? '變更' : '設定'}自動備份資料夾</button>` : null}
        ${backend.kind === 'browser' && TIM.fileBackend.supported() ? html`<button class="btn btn-primary btn-sm" onClick=${async () => { props.close(); await TIM.app.moveToFile(); }}><${Icon} name="save" /> 另存為 JSON 檔並改用檔案模式</button>` : null}
      </div>
      <p class="muted" style="font-size:11.5px;margin-top:12px;line-height:1.6">自動備份：開啟工具時、每 3 小時、切換分頁時寫入「tim_db_backup_YYYY-MM-DD.json」，每天一份、保留最近 30 份。<br/>
        沒有被任何專案使用的圖片會在存檔時自動清除（可復原範圍內的圖片會保留）。</p>
      <p class="muted mono" style="font-size:10.5px;margin-top:8px">版本 ${TIM.app.version}</p>
    </${Modal}>`;
  }

  TIM.ui.openSettings = () => openModal(close => html`<${SettingsModal} close=${close} />`);
})();
