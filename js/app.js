/* App bootstrap: store, database connection, toolbar, routing, global shortcuts, sync, version check. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, render, useEffect, Icon, cx, go, useStore, useRoute, Overlays, toast, confirm } = TIM.ui;
  const { util, schema, merge } = TIM;

  const VERSION = (document.querySelector('meta[name="tim-version"]') || {}).content || 'dev';
  const IS_DEV = /__BUILD_VERSION__/.test(VERSION);
  const USER_KEY = 'tim_user_name';

  TIM.store = TIM.storeLib.createStore({ saveDelay: 800 });
  const app = {
    version: IS_DEV ? 'dev' : VERSION,
    gateError: '',
    noAutoRestore: false,
    backupState: 'none',
    updateAvailable: false,
  };
  TIM.app = app;

  // ───────── user ─────────
  app.getUserName = () => { try { return localStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; } };
  app.setUserName = name => { try { localStorage.setItem(USER_KEY, name || ''); } catch (e) { /* ignore */ } TIM.store.emit(); };
  TIM.store.setUser(() => app.getUserName() || '（未設定名稱）');

  // ───────── connect ─────────
  function fail(msg) {
    app.gateError = msg;
    TIM.store.emit();
    return false;
  }

  /** Read + validate the backend content and attach it to the store. Never overwrites unreadable files. */
  app.attach = async function (backend, opts) {
    opts = opts || {};
    let text;
    try { text = await backend.read(); } catch (e) { return fail('無法讀取資料庫：' + (e.message || e)); }
    let db;
    if (!text || !String(text).trim()) {
      db = schema.newDb();
      try { await backend.write(merge.serializeDb(db)); } catch (e) { return fail('無法寫入資料庫：' + (e.message || e)); }
    } else {
      let obj;
      try { obj = JSON.parse(text); } catch (e) { return fail('檔案不是有效的 JSON（可能已損毀）'); }
      const v = schema.validateDb(obj);
      if (!v.ok) return fail(v.error);
      db = schema.normalizeDb(obj);
    }
    app.gateError = '';
    app.noAutoRestore = false;
    TIM.store.attach(backend, db);
    if (opts.sample) {
      try { await TIM.sample.addSampleToStore(); } catch (e) { console.error(e); toast('範例專案建立失敗：' + e.message, 'err'); }
    }
    startBackground();
    initBackup();
    return true;
  };

  app.connectFile = async function (mode, opts) {
    const fb = TIM.fileBackend;
    const r = mode === 'reconnect' ? await fb.reconnect() : mode === 'create' ? await fb.create('tim_db.json') : await fb.open();
    if (!r.ok) {
      if (r.reason !== 'cancelled') fail(r.reason === 'denied' ? '沒有取得檔案讀寫權限' : '無法開啟：' + (r.error || r.reason));
      return false;
    }
    if (r.isNew) { try { await fb.write(''); } catch (e) { /* attach will initialise */ } }
    const ok = await app.attach(fb, { sample: r.isNew && opts && opts.sample });
    if (ok) toast((r.isNew ? '已建立 ' : '已開啟 ') + r.name, 'ok');
    return ok;
  };

  /**
   * Pick the database folder: an existing database opens directly (several → the user picks
   * one); an empty folder asks whether to create tim_db.json and then opens it.
   */
  app.openFolder = async function () {
    const fb = TIM.fileBackend;
    const r = await fb.pickFolder();
    if (!r.ok) {
      if (r.reason !== 'cancelled') fail(r.reason === 'denied' ? '沒有取得資料夾讀寫權限' : '無法開啟資料夾：' + (r.error || r.reason));
      return false;
    }
    let found;
    try { found = await fb.scanFolder(r.dir); } catch (e) { return fail('無法讀取資料夾：' + (e.message || e)); }
    let pick = found.find(c => c.main) || (found.length === 1 ? found[0] : null);
    if (!pick && found.length) {
      pick = await TIM.ui.chooseDatabase(r.dir.name, found);
      if (!pick) return false;
    }
    let isNew = false, sample = false;
    if (pick) fb.useFolderFile(r.dir, pick.handle);
    else {
      const ans = await TIM.ui.askCreateDatabase(r.dir.name);
      if (!ans) return false;
      const c = await fb.createInFolder(r.dir);
      if (!c.ok) return fail('無法建立資料庫：' + (c.error || c.reason));
      isNew = true; sample = ans.sample;
    }
    const ok = await app.attach(fb, { sample });
    if (ok) { await fb.remember(); toast((isNew ? '已建立 ' : '已開啟 ') + fb.location(), 'ok'); }
    return ok;
  };

  app.connectBrowser = async function (opts) {
    return app.attach(TIM.browserBackend, { sample: opts && opts.sample });
  };

  app.disconnect = async function () {
    try { await TIM.store.flush(); } catch (e) { /* ignore */ }
    app.noAutoRestore = true;
    stopBackground();
    TIM.store.detach();
    go('', true);
  };

  /** Browser (trial) mode → save everything into a new JSON file and switch to it. */
  app.moveToFile = async function () {
    const st = TIM.store;
    await st.flush();
    const r = await TIM.fileBackend.create('tim_db.json');
    if (!r.ok) { if (r.reason !== 'cancelled') toast('無法建立檔案：' + (r.error || r.reason), 'err'); return; }
    const db = st.db;
    db.rev = (db.rev || 0) + 1;
    await TIM.fileBackend.write(merge.serializeDb(db));
    st.attach(TIM.fileBackend, db);
    initBackup();
    toast('已改用 ' + r.name + '（瀏覽器暫存資料保留，可再清除）', 'ok', { timeout: 6000 });
  };

  // ───────── backup ─────────
  async function latestText() {
    await TIM.store.flush();
    return TIM.store.backend ? TIM.store.backend.read() : '';
  }
  app.downloadBackup = async function () {
    const text = await latestText();
    TIM.ui.downloadBlob(new Blob([text], { type: 'application/json' }), 'tim_db_backup_' + util.todayStr() + '.json');
  };
  app.pickBackupDir = async function () {
    const r = await TIM.backup.pick(TIM.store.backend && TIM.store.backend.startIn ? TIM.store.backend.startIn() : undefined);
    if (r.ok) {
      app.backupState = 'ready';
      const w = await TIM.backup.run(latestText, true);
      toast(w.ok ? '自動備份資料夾：' + r.name + '（已寫入 ' + w.name + '）' : '已設定自動備份資料夾：' + r.name, 'ok');
      TIM.store.emit();
    } else if (r.reason !== 'cancelled') toast('無法設定備份資料夾：' + (r.error || r.reason), 'err');
  };
  async function initBackup() {
    if (!TIM.backup.supported()) return;
    const r = await TIM.backup.tryRestore();
    if (r.ok) { app.backupState = 'ready'; TIM.backup.run(latestText, true); }
    else if (r.needsPermission) app.backupState = 'needs-permission';
    else app.backupState = 'none';
    TIM.backup.schedule(latestText, res => { if (res && res.needsPermission) { app.backupState = 'needs-permission'; TIM.store.emit(); } });
    TIM.store.emit();
  }

  // ───────── background sync & version check ─────────
  let syncTimer = null;
  function startBackground() {
    stopBackground();
    syncTimer = setInterval(() => { if (document.visibilityState === 'visible') TIM.store.syncCheck(); }, 15000);
  }
  function stopBackground() { clearInterval(syncTimer); syncTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && TIM.store.db) TIM.store.syncCheck(); });

  async function checkVersion() {
    if (IS_DEV || !/^https?:/.test(location.protocol)) return;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) return;
      const v = await res.json();
      if (v && v.version && v.version !== VERSION && !/__BUILD_VERSION__/.test(v.version)) { app.updateAvailable = true; TIM.store.emit(); }
    } catch (e) { /* offline: ignore */ }
  }
  setInterval(checkVersion, 10 * 60 * 1000);
  setTimeout(checkVersion, 15000);

  window.addEventListener('beforeunload', e => {
    if (TIM.store.db && TIM.store.hasUnsaved()) { TIM.store.saveNow(); e.preventDefault(); e.returnValue = ''; }
  });

  // ───────── exports used by pages ─────────
  app.exportExcel = pid => TIM.ui.openExport(pid);
  app.openImportExcel = () => TIM.ui.openImportExcel();
  app.importShareFile = async () => {
    const f = await TIM.ui.pickFile('.json,application/json');
    if (!f) return;
    try {
      const pid = await TIM.share.importProjectFile(f);
      toast('已匯入專案', 'ok');
      go('p/' + pid);
    } catch (e) { toast(e.message || String(e), 'err'); }
  };

  // ───────── global shortcuts ─────────
  window.addEventListener('keydown', e => {
    const st = TIM.store;
    if (!st.db) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      st.saveNow().then(() => toast(st.status.state === 'error' ? '儲存失敗：' + st.status.error : '已儲存', st.status.state === 'error' ? 'err' : 'ok', { timeout: 1500 }));
      return;
    }
    if (k !== 'z' && k !== 'y') return;
    if (document.querySelector('.modal-backdrop')) return;
    const r = TIM.ui.parseHash();
    const scope = r.page === 'project' ? 'p:' + r.pid : r.page === 'library' ? 'lib' : null;
    if (!scope) return;
    e.preventDefault();
    const redo = k === 'y' || (k === 'z' && e.shiftKey);
    const ok = redo ? st.redo(scope) : st.undo(scope);
    if (!ok) toast(redo ? '沒有可重做的動作' : '沒有可復原的動作', 'info', { timeout: 1200 });
  });

  // ───────── UI ─────────
  function SaveState() {
    const st = TIM.store;
    const s = st.status;
    const text = s.state === 'saving' ? '儲存中…' : s.state === 'dirty' ? '未儲存…' : s.state === 'error' ? '儲存失敗，重試中' :
      s.state === 'readonly' ? '唯讀' : s.at ? '已儲存 ' + util.fmtDateTime(s.at).slice(11) : '已儲存';
    return html`<div class=${cx('save-state', s.state)} title=${s.error || ''}><span class="save-dot"></span><span>${text}</span></div>`;
  }

  function Toolbar(props) {
    const st = TIM.store;
    const r = props.route;
    const p = r.page === 'project' ? st.db.projects[r.pid] : null;
    return html`<header class="toolbar">
      <div class="brand" onClick=${() => go('')} title="專案列表">
        <img src="assets/delta-logo-toolbar.png" alt="Delta" />
        <div class="brand-divider"></div>
        <div class="brand-text"><span class="brand-name">DELTA</span><span class="brand-sub">TIM MANAGER</span></div>
      </div>
      <nav class="nav">
        <a class=${cx('nav-link', (r.page === 'home' || r.page === 'project') && 'active')} href="#/"><${Icon} name="layers" size=${14} /> 專案</a>
        <a class=${cx('nav-link', r.page === 'library' && 'active')} href="#/library"><${Icon} name="book" size=${14} /> 材料庫</a>
      </nav>
      ${p ? html`<div class="crumb"><${Icon} name="chevR" size=${12} /><b title=${p.name}>${p.name}</b></div>` : null}
      <div class="toolbar-spacer"></div>
      <div class="toolbar-right">
        <${SaveState} />
        <button class="db-chip" title=${'目前資料庫：' + (st.backend && st.backend.location ? st.backend.location() : st.backend ? st.backend.label() : '') + '\n點擊回到資料庫選擇畫面（會先存檔）'} onClick=${() => app.disconnect()}>
          <${Icon} name=${st.backend && st.backend.kind === 'browser' ? 'eye' : 'db'} size=${13} /><span>${st.backend ? st.backend.label() : ''}</span>
          <span class="db-chip-exit"><${Icon} name="exit" size=${13} />切換</span>
        </button>
        <button class="btn btn-dark btn-sm btn-icon" title="設定" onClick=${() => TIM.ui.openSettings()}><${Icon} name="gear" /></button>
      </div>
    </header>`;
  }

  function Banners() {
    const st = TIM.store;
    const out = [];
    if (st.readonly) {
      out.push(html`<div class="banner err"><${Icon} name="lock" /> <b>唯讀模式</b>：${st.readonlyReason || '資料庫無法寫入'}。檔案不會被修改，請檢查檔案或改開備份。
        <button class="btn btn-secondary btn-sm" onClick=${() => app.disconnect()}>重新選擇資料庫</button></div>`);
    }
    if (st.backend && st.backend.kind === 'browser') {
      out.push(html`<div class="banner info"><${Icon} name="info" /> 試用模式：資料只存在這個瀏覽器，清除瀏覽器資料就會消失。
        ${TIM.fileBackend.supported() ? html`<button class="btn btn-secondary btn-sm" onClick=${() => app.moveToFile()}>另存為 JSON 檔</button>` : null}</div>`);
    }
    if (st.status.state === 'error') {
      out.push(html`<div class="banner warn"><${Icon} name="warn" /> 儲存失敗：${st.status.error}（會自動重試；也可按 Ctrl+S）
        <button class="btn btn-secondary btn-sm" onClick=${() => st.saveNow()}>立即重試</button></div>`);
    }
    if (st.conflicts.length) {
      const msg = st.conflicts.map(c => {
        if (c.type === 'conflict') return (c.kind === 'projects' ? '專案' : '材料') + '「' + c.name + '」同時被其他人修改：對方版本已保留，你的修改另存為「衝突副本」';
        if (c.type === 'delete_skipped') return '「' + c.name + '」在你刪除前被其他人修改，已保留';
        if (c.type === 'restored') return '「' + c.name + '」被其他人刪除，但你有修改，已保留你的版本';
        return c.name;
      });
      out.push(html`<div class="banner warn"><${Icon} name="warn" /><div>${msg.map(m => html`<div>${m}</div>`)}</div>
        <button class="btn btn-secondary btn-sm" onClick=${() => st.dismissConflicts()}>知道了</button></div>`);
    }
    if (app.backupState === 'needs-permission') {
      out.push(html`<div class="banner info"><${Icon} name="folder" /> 自動備份資料夾需要重新授權才能繼續備份。
        <button class="btn btn-secondary btn-sm" onClick=${() => app.pickBackupDir()}>授權</button></div>`);
    }
    return out.length ? html`<div>${out}</div>` : null;
  }

  function App() {
    const st = useStore();
    const route = useRoute();
    useEffect(() => { document.title = (st.db && route.page === 'project' && st.db.projects[route.pid] ? st.db.projects[route.pid].name + ' · ' : '') + '專案 TIM 管理器'; });
    if (!st.db) {
      return html`<div class="app" style="grid-template-rows:1fr"><${TIM.ui.Gate} error=${app.gateError} noAutoRestore=${app.noAutoRestore} /><${Overlays} /></div>`;
    }
    let page;
    if (route.page === 'library') page = html`<${TIM.ui.Library} route=${route} />`;
    else if (route.page === 'project') page = html`<${TIM.ui.ProjectPage} route=${route} key=${route.pid} />`;
    else page = html`<${TIM.ui.Home} />`;
    return html`<div class=${cx('app', st.readonly && 'is-readonly')}>
      <${Toolbar} route=${route} />
      <main class="main"><${Banners} />${page}</main>
      ${app.updateAvailable ? html`<div class="update-banner">有新版本可用 <button class="btn btn-accent btn-sm" onClick=${() => location.reload()}>重新整理</button></div>` : null}
      <${Overlays} />
    </div>`;
  }

  render(html`<${App} />`, document.getElementById('app'));
})();
