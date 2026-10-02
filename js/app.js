/* App bootstrap: store, database connection, toolbar, routing, global shortcuts, sync, version check. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, render, useEffect, Icon, cx, go, useStore, useRoute, Overlays, toast, confirm } = TIM.ui;
  const { util, schema, merge } = TIM;

  // Microsoft sign-in popup: the login page sends the popup back to this page; MSAL in the
  // opener reads the result from the address bar and closes it. Do not start the tool here
  // (it would open the database and could touch the URL before MSAL has read it).
  if (window.opener && window.opener !== window && /^msal\./.test(window.name || '')) {
    document.getElementById('app').innerHTML = '<div class="msal-popup">正在完成 Microsoft 登入…</div>';
    return;
  }

  const VERSION = (document.querySelector('meta[name="tim-version"]') || {}).content || 'dev';
  const IS_DEV = /__BUILD_VERSION__/.test(VERSION);
  const USER_KEY = 'tim_user_name';
  const MODE_KEY = 'tim_db_mode';            // last database used: 'sharepoint' | 'folder'

  TIM.store = TIM.storeLib.createStore({ saveDelay: 800 });
  const app = {
    version: IS_DEV ? 'dev' : VERSION,
    gateError: '',
    noAutoRestore: false,
    backupState: 'none',
    update: null,              // { to, left, state: 'countdown' | 'saving' | 'error' | 'failed', error }
  };
  TIM.app = app;

  // ───────── user ─────────
  // Who is editing: the Microsoft account when the database is on SharePoint, otherwise a name saved
  // in this browser by an earlier version (there is no name field any more).
  app.getUserName = () => { try { return localStorage.getItem(USER_KEY) || ''; } catch (e) { return ''; } };
  app.setUserName = name => { try { localStorage.setItem(USER_KEY, name || ''); } catch (e) { /* ignore */ } TIM.store.emit(); };
  app.currentUser = () => {
    const b = TIM.store.backend;
    const acc = b && b.account ? b.account() : null;
    return (acc && acc.name) || app.getUserName() || '';
  };
  TIM.store.setUser(() => app.currentUser());

  // ───────── connect ─────────
  app.dbMode = () => { try { return localStorage.getItem(MODE_KEY) || ''; } catch (e) { return ''; } };
  function setDbMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* ignore */ } }

  function fail(msg) {
    app.gateError = msg;
    TIM.store.emit();
    return false;
  }

  /** Read + validate the backend content and attach it to the store. Never overwrites unreadable files. */
  app.attach = async function (backend) {
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
    startBackground();
    initBackup();
    startSync(backend, db);
    return true;
  };

  /** Continue with the remembered database (click handler: re-grants permission). */
  app.reconnect = async function () {
    const fb = TIM.fileBackend;
    const r = await fb.reconnect();
    if (!r.ok) {
      fail(r.reason === 'denied' ? '沒有取得讀寫權限' : r.reason === 'missing' ? '找不到上次的資料庫（' + r.name + '），請重新選擇資料夾' : '無法開啟：' + (r.error || r.reason));
      return false;
    }
    const ok = await app.attach(fb);
    if (ok) { setDbMode('folder'); toast('已開啟 ' + r.name, 'ok'); }
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
    let isNew = false;
    if (pick) fb.useFolderFile(r.dir, pick.handle);
    else {
      if (!await TIM.ui.askCreateDatabase(r.dir.name)) return false;
      const c = await fb.createInFolder(r.dir);
      if (!c.ok) return fail('無法建立資料庫：' + (c.error || c.reason));
      isNew = true;
    }
    const ok = await app.attach(fb);
    if (ok) { await fb.remember(); setDbMode('folder'); toast((isNew ? '已建立 ' : '已開啟 ') + fb.location(), 'ok'); }
    return ok;
  };

  function signInError(s) {
    return s.reason === 'popup' ? '登入視窗被瀏覽器擋下：請允許本網站的彈出式視窗後再試一次'
      : 'Microsoft 登入失敗：' + (s.error || s.reason);
  }

  /**
   * Shared database on SharePoint (click handler: may open the Microsoft sign-in popup).
   * Opens TIM_Manager/Database/tim_db.json; when it does not exist yet, asks and creates it.
   * opts.select: let the user pick another account.
   */
  app.openSharePoint = async function (opts) {
    const sp = TIM.spBackend;
    const s = await sp.signIn(opts);
    if (!s.ok) { if (s.reason !== 'cancelled') fail(signInError(s)); return false; }
    const pr = await sp.probe();
    if (!pr.ok) return fail(pr.error);
    let isNew = false;
    if (!pr.exists) {
      if (!await TIM.ui.askCreateSharePoint(sp.location())) return false;
      const c = await sp.create();
      if (!c.ok) return fail('無法在 SharePoint 建立資料庫：' + c.error);
      isNew = !c.existed;
    }
    const ok = await app.attach(sp);
    if (ok) { setDbMode('sharepoint'); toast((isNew ? '已建立' : '已開啟') + ' SharePoint 資料庫', 'ok'); }
    return ok;
  };

  /** Save failed because the Microsoft sign-in expired → sign in again (click) and save. */
  app.spRelogin = async function () {
    const s = await TIM.spBackend.signIn();
    if (!s.ok) { if (s.reason !== 'cancelled') toast(signInError(s), 'err'); return; }
    await TIM.store.saveNow();
    TIM.store.syncCheck();
  };

  /**
   * Move the open local database to SharePoint: upload its datasheet files and the database,
   * then continue on SharePoint. Never overwrites a database that already exists there.
   */
  app.moveToSharePoint = async function () {
    const st = TIM.store, fb = st.backend, sp = TIM.spBackend;
    if (!st.db || !fb || fb.kind === 'sharepoint' || st.readonly) return false;
    const mats = Object.values(st.db.materials);
    const files = [];
    mats.forEach(m => (m.datasheets || []).forEach(d => { if (!files.includes(d.path)) files.push(d.path); }));
    const ok = await confirm({
      title: '搬到 SharePoint', okText: '上傳並改用 SharePoint',
      message: '把目前的資料庫（' + Object.keys(st.db.projects).length + ' 個專案、' + mats.length + ' 種材料' + (files.length ? '、' + files.length + ' 份規格書' : '') + '）上傳到\n' +
        sp.location() + '\n之後所有人都開這個共用資料庫。本機的 ' + fb.location() + ' 保留不動，但之後的修改只會存到 SharePoint。',
    });
    if (!ok) return false;
    await st.flush();
    if (st.hasUnsaved() || st.status.state === 'error') { toast('目前資料尚未存檔，請稍後再試', 'err'); return false; }
    const s = await sp.signIn();
    if (!s.ok) { if (s.reason !== 'cancelled') toast(signInError(s), 'err'); return false; }
    const pr = await sp.probe();
    if (!pr.ok) { toast(pr.error, 'err'); return false; }
    if (pr.exists && String(await sp.read()).trim()) {
      toast('SharePoint 上已經有資料庫，為避免覆蓋不會上傳。請按右上角「切換」回起始頁，改用 SharePoint 開啟。', 'err', { timeout: 10000 });
      return false;
    }
    if (!pr.exists) { const c = await sp.create(); if (!c.ok) { toast('無法在 SharePoint 建立資料庫：' + c.error, 'err'); return false; } }
    const missing = [];
    for (let i = 0; i < files.length; i++) {
      toast('上傳規格書 ' + (i + 1) + ' / ' + files.length + '…', 'info', { timeout: 1500 });
      try { await sp.files.put(files[i], await fb.files.blob(files[i])); } catch (e) { missing.push(files[i]); }
    }
    try { await sp.write(await fb.read()); } catch (e) { toast('上傳資料庫失敗：' + (e.message || e), 'err'); return false; }
    stopBackground();
    await stopSync();
    const done = await app.attach(sp);
    if (!done) { startBackground(); toast(app.gateError || '無法開啟 SharePoint 資料庫', 'err'); return false; }
    setDbMode('sharepoint');
    toast('已搬到 SharePoint' + (missing.length ? '（' + missing.length + ' 份規格書在本機找不到，未上傳）' : ''), missing.length ? 'err' : 'ok', { timeout: 6000 });
    return true;
  };

  app.disconnect = async function () {
    try { await TIM.store.flush(); } catch (e) { /* ignore */ }
    app.noAutoRestore = true;
    stopBackground();
    await stopSync();
    const b = TIM.store.backend;
    await runFileGc();
    fileDeletes.clear();
    TIM.store.detach();
    if (b && b.close) b.close();
    go('', true);
  };

  // ───────── SharePoint is the master copy (js/db/sync.js) ─────────
  // SharePoint mode: every save also refreshes the local copy (write-only).
  // Local folder mode: every save is also merged into SharePoint; the user is reminded (on open and
  // again on a save at least REMIND_MS later) to switch to SharePoint, and warned when a push fails.
  const sync = TIM.sync;
  const REMIND_MS = 10 * 60 * 1000;
  const FAIL_WARN_MS = 10 * 60 * 1000;
  let remindedAt = 0, failWarnedAt = 0, mirrorRev = null, wasFailing = false, warnedFailures = 0;
  let closingSync = false, remindModal = null, failModal = null;

  function startSync(backend, db) {
    mirrorRev = null;
    if (backend.kind !== 'file') sync.push.stop();
    if (sync.__disableForTest) return;
    if (backend.kind === 'sharepoint') { sync.onSharePointOpened(); backend.members().catch(() => { /* list optional */ }); return; }
    if (backend.kind !== 'file') return;
    sync.push.start(backend.startIn ? backend.startIn() : null, backend.location ? backend.location() : backend.label(), db);
    remindedAt = 0;
    setTimeout(() => remindLocal(), 0);
  }
  async function stopSync() {
    if (!sync.push.active) return;
    closingSync = true;
    // let a running push finish, then push what is left (whatever fails stays remembered for later)
    try { await sync.push.run(); if (sync.push.pendingCount()) await sync.push.run(); } catch (e) { /* stays pending */ }
    sync.push.stop();
    if (remindModal) remindModal.close(false);
    if (failModal) failModal.close('');
    closingSync = false;
  }
  TIM.store.onSaved = taken => {
    const b = TIM.store.backend;
    if (b && b.kind === 'file' && sync.push.active) {
      sync.push.saved(taken);
      if (Date.now() - remindedAt >= REMIND_MS) remindLocal();
    }
  };
  // SharePoint content changed (our save, or other people's changes pulled in) → refresh the local copy
  TIM.store.subscribe(st => {
    if (!st.db || !st.backend || st.backend.kind !== 'sharepoint' || st.status.state === 'saving' || st.status.state === 'dirty') return;
    if (st.db.rev === mirrorRev) return;
    mirrorRev = st.db.rev;
    sync.mirror.schedule();
  });
  // local work that cannot reach SharePoint → warn (when it starts failing, then at most every FAIL_WARN_MS)
  sync.subscribe(() => {
    const p = sync.push;
    if (!p.active) wasFailing = false;
    else if (p.state !== 'pushing' && p.state !== 'checking') {          // a retry in progress changes nothing
      const failing = (p.state === 'error' || p.state === 'login') && p.pendingCount() > 0;
      if (failing && !closingSync && (!wasFailing || (p.failures > warnedFailures && Date.now() - failWarnedAt >= FAIL_WARN_MS))) {
        failWarnedAt = Date.now(); warnedFailures = p.failures;
        setTimeout(() => warnPushFailed(), 0);
      }
      wasFailing = failing;
    }
    if (sync.mirror.leftovers) { toast('已把本機副本中 ' + sync.mirror.leftovers + ' 筆尚未同步的修改合併到 SharePoint', 'ok', { timeout: 6000 }); sync.mirror.leftovers = 0; }
    if (sync.mirror.kept) { toast('本機副本在其他地方被修改過，已另存為 ' + sync.mirror.kept + '，沒有覆蓋', 'info', { timeout: 8000 }); sync.mirror.kept = ''; }
    TIM.store.emit();
  });

  /** Local folder → SharePoint: save, push what is left, then open the SharePoint database (click). */
  app.switchToSharePoint = async function () {
    try { await TIM.store.flush(); } catch (e) { /* reported by the store */ }
    if (sync.push.active) await sync.push.run();
    if (sync.push.active && sync.push.pendingCount()) {
      const go2 = await confirm({ title: '還有修改沒同步到 SharePoint', okText: '仍要切換', message: '有 ' + sync.push.pendingCount() + ' 筆修改還沒寫入 SharePoint（' + (sync.push.error || '連線問題') + '）。\n它們已存在本機資料夾，下次開啟 SharePoint 且能存取這個資料夾時會自動合併。' });
      if (!go2) return false;
    }
    await app.disconnect();
    return app.openSharePoint();
  };
  app.pushNow = () => sync.push.run({ interactive: true });

  function remindLocal() {
    const st = TIM.store;
    if (!st.db || !st.backend || st.backend.kind !== 'file' || remindModal) return;
    remindedAt = Date.now();
    remindModal = TIM.ui.openModal(close => html`<${TIM.ui.Modal} title="目前在本機資料夾作業" size="sync-remind" onClose=${() => close(false)} onEnter=${() => close(true)}
        footer=${html`<button class="btn btn-ghost" onClick=${() => close(false)}>繼續在本機作業</button>
          <button class="btn btn-primary" data-enter-ok="1" onClick=${() => close(true)}><${Icon} name="cloud" /> 切換到 SharePoint</button>`}>
      <p>資料以 <b>SharePoint 共用資料庫</b>為準。你現在開的是本機資料夾「<b>${st.backend.location ? st.backend.location() : st.backend.label()}</b>」。</p>
      <p class="mt8">在這裡的每次存檔也會同步寫入 SharePoint（不會覆蓋別人的修改），但請盡快切換到線上版本。</p>
      ${sync.push.state === 'login' ? html`<p class="mt8 text-err">尚未登入 Microsoft 帳號：在登入之前，修改不會寫入 SharePoint。</p>` : null}
    </${TIM.ui.Modal}>`);
    remindModal.promise.then(ok => { remindModal = null; if (ok) app.switchToSharePoint(); });
  }

  function warnPushFailed() {
    const p = sync.push;
    if (!p.active || closingSync || failModal) return;
    const login = p.state === 'login';
    failModal = TIM.ui.openModal(close => html`<${TIM.ui.Modal} title="未同步到 SharePoint" size="sync-fail" onClose=${() => close('')}
        footer=${html`<button class="btn btn-ghost" onClick=${() => close('')}>知道了</button>
          ${login ? html`<button class="btn btn-secondary" onClick=${() => close('login')}>登入 Microsoft</button>` : html`<button class="btn btn-secondary" onClick=${() => close('retry')}>立即重試</button>`}
          <button class="btn btn-primary" onClick=${() => close('switch')}><${Icon} name="cloud" /> 切換到 SharePoint</button>`}>
      <p class="text-err">${login ? '尚未登入 Microsoft 帳號，修改無法寫入 SharePoint。' : '寫入 SharePoint 失敗：' + (p.error || '未知錯誤')}</p>
      <p class="mt8">修改已存在本機資料夾（${p.pendingCount()} 筆待同步）${login ? '，登入後會補寫。' : '，會自動重試；恢復連線後會補上。'}</p>
    </${TIM.ui.Modal}>`);
    failModal.promise.then(a => {
      failModal = null;
      if (a === 'login' || a === 'retry') sync.push.run({ interactive: a === 'login' });
      else if (a === 'switch') app.switchToSharePoint();
    });
  }

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
    const b = TIM.store.backend;
    if (b && b.kind === 'sharepoint') {
      // shared database → backups go next to it (Database/Backup); no folder to pick
      TIM.backup.useRemote({ name: b.backupName(), write: text => b.writeBackup(text) });
      app.backupState = 'ready';
      TIM.backup.run(latestText, true).then(() => TIM.store.emit());
      TIM.backup.schedule(latestText, () => TIM.store.emit());
      return;
    }
    TIM.backup.useRemote(null);
    if (!TIM.backup.supported()) return;
    const r = await TIM.backup.tryRestore();
    if (r.ok) { app.backupState = 'ready'; TIM.backup.run(latestText, true); }
    else if (r.needsPermission) app.backupState = 'needs-permission';
    else app.backupState = 'none';
    TIM.backup.schedule(latestText, res => { if (res && res.needsPermission) { app.backupState = 'needs-permission'; TIM.store.emit(); } });
    TIM.store.emit();
  }

  // ───────── datasheet files removed from the database ─────────
  // The file is deleted from storage (SharePoint: to its recycle bin) only after the change is
  // saved, and only when no material refers to it any more (a duplicate may share it).
  const fileDeletes = new Set();
  let gcBusy = false;
  app.queueFileDeletes = paths => { (paths || []).forEach(p => p && fileDeletes.add(p)); };
  async function runFileGc() {
    const st = TIM.store;
    const files = st.backend && st.backend.files;
    if (gcBusy || !fileDeletes.size || !files || !files.supported() || st.readonly || st.status.state !== 'saved') return;
    gcBusy = true;
    try {
      for (const path of Array.from(fileDeletes)) {
        if (Object.values(st.db.materials).some(m => (m.datasheets || []).some(d => d.path === path))) { fileDeletes.delete(path); continue; }
        try { await files.del(path); fileDeletes.delete(path); } catch (e) { console.warn('[datasheets] delete failed, will retry', path, e && e.message); break; }
      }
    } finally { gcBusy = false; }
  }
  TIM.store.subscribe(() => { if (fileDeletes.size) setTimeout(runFileGc, 0); });

  // ───────── background sync & version check ─────────
  let syncTimer = null;
  function startBackground() {
    stopBackground();
    syncTimer = setInterval(() => { if (document.visibilityState === 'visible') TIM.store.syncCheck(); }, 15000);
  }
  function stopBackground() { clearInterval(syncTimer); syncTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && TIM.store.db) TIM.store.syncCheck(); });

  // ───────── new version → save everything, then reload ─────────
  // The deploy stamps index.html (meta tim-version) and version.json with the same build id.
  // A different id in version.json means a newer build is online: a non-dismissable notice
  // counts down, commits the field being edited, saves the database and reloads with
  // ?v=<build> so neither the browser nor the CDN can hand back the old page.
  const UPDATE_KEY = 'tim_update_attempt';      // sessionStorage: { to, n } — stops reload loops
  const COUNTDOWN = 10;                          // seconds (3 on the start page: nothing to save)
  let updateTimer = null;

  /** version.json with timeout; one retry on network errors / 5xx. */
  async function fetchVersion() {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
        if (res.ok) { const v = await res.json(); return v && v.version ? String(v.version) : null; }
        if (res.status < 500 && res.status !== 429) return null;
      } catch (e) { /* offline / timeout → retry once */ } finally { clearTimeout(t); }
    }
    return null;
  }
  function readAttempt() { try { return JSON.parse(sessionStorage.getItem(UPDATE_KEY) || 'null') || {}; } catch (e) { return {}; } }

  app.checkVersion = async function () {
    if (IS_DEV || !/^https?:/.test(location.protocol) || app.update) return;
    const v = await fetchVersion();
    if (!v || v === VERSION || /__BUILD_VERSION__/.test(v) || app.update) return;
    const att = readAttempt();
    if (att.to === v && att.n >= 2) { app.update = { to: v, state: 'failed' }; TIM.store.emit(); return; }   // reloaded twice, still old
    app.update = { to: v, state: 'countdown', left: TIM.store.db ? COUNTDOWN : 3 };
    TIM.store.emit();
    clearInterval(updateTimer);
    updateTimer = setInterval(() => {
      if (!app.update || app.update.state !== 'countdown') { clearInterval(updateTimer); return; }
      app.update.left -= 1;
      if (app.update.left <= 0) { clearInterval(updateTimer); app.applyUpdate(); } else TIM.store.emit();
    }, 1000);
  };

  app.applyUpdate = async function () {
    const u = app.update;
    if (!u || u.state === 'saving') return;
    clearInterval(updateTimer);
    u.state = 'saving'; TIM.store.emit();
    const st = TIM.store;
    if (st.db && !st.readonly) {
      const a = document.activeElement;
      if (a && a.blur) a.blur();                                    // commit the field being edited
      await new Promise(r => setTimeout(r, 0));
      try { await st.flush(); } catch (e) { /* reported below */ }
      if (st.hasUnsaved() || st.status.state === 'error') {
        u.state = 'error'; u.error = st.status.error || '資料尚未寫入'; TIM.store.emit();
        return;                                                     // never reload over unsaved work
      }
    }
    const att = readAttempt();
    try { sessionStorage.setItem(UPDATE_KEY, JSON.stringify({ to: u.to, n: att.to === u.to ? (att.n || 0) + 1 : 1 })); } catch (e) { /* ignore */ }
    location.replace(location.pathname + '?v=' + encodeURIComponent(u.to) + location.hash);
  };

  // After an update reload: drop ?v= from the address bar; clear the loop guard once on the new build.
  if (/[?&]v=/.test(location.search)) { try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ } }
  if (readAttempt().to === VERSION) { try { sessionStorage.removeItem(UPDATE_KEY); } catch (e) { /* ignore */ } }
  setTimeout(app.checkVersion, 3000);
  setInterval(app.checkVersion, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') app.checkVersion(); });

  function UpdateNotice() {
    const u = app.update;
    if (!u) return null;
    if (u.state === 'failed') {
      return html`<div class="update-banner">新版本 <span class="mono">${u.to}</span> 尚未生效，請稍後按 Ctrl+Shift+R 重新整理
        <button class="btn btn-accent btn-sm" onClick=${() => { app.update = null; try { sessionStorage.removeItem(UPDATE_KEY); } catch (e) { /* ignore */ } app.checkVersion(); }}>再試一次</button></div>`;
    }
    const saving = u.state === 'saving';
    return html`<div class="update-backdrop"><div class="update-box" role="alertdialog" aria-modal="true" aria-label="有新版本">
      <h3>有新版本</h3>
      <p class="mono" style="font-size:11.5px;color:var(--ink-3)">${VERSION} → ${u.to}</p>
      ${u.state === 'error' ? html`<p class="text-err">存檔失敗：${u.error}。資料還沒寫入，所以先不更新；請處理後按「重試」。</p>`
        : html`<p>${TIM.store.db ? '會先儲存所有資料，再載入新版本。' : '正在載入新版本。'}${saving ? '' : html` <b>${u.left}</b> 秒後自動更新。`}</p>`}
      <div class="update-foot">
        <button class="btn btn-primary" disabled=${saving} onClick=${() => app.applyUpdate()}>${saving ? '儲存中…' : u.state === 'error' ? '重試' : '立即更新'}</button>
      </div>
    </div></div>`;
  }

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
      <div class="brand" onClick=${() => go('')} title=${'專案列表 · 版本 ' + app.version}>
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
          <${Icon} name=${st.backend && st.backend.kind === 'sharepoint' ? 'cloud' : 'db'} size=${13} /><span>${st.backend ? st.backend.label() : ''}</span>
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
    if (st.status.state === 'error') {
      const relogin = st.backend && st.backend.kind === 'sharepoint' && st.backend.needsLogin();
      out.push(html`<div class="banner warn"><${Icon} name="warn" /> 儲存失敗：${st.status.error}${relogin ? '' : '（會自動重試；也可按 Ctrl+S）'}
        ${relogin ? html`<button class="btn btn-secondary btn-sm" onClick=${() => app.spRelogin()}>重新登入 Microsoft</button>`
          : html`<button class="btn btn-secondary btn-sm" onClick=${() => st.saveNow()}>立即重試</button>`}</div>`);
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
    const p = sync.push;
    if (st.backend && st.backend.kind === 'file' && p.active) {
      const fail = p.state === 'error' || p.state === 'login';
      const stateText = p.state === 'pushing' ? '同步到 SharePoint 中…'
        : p.state === 'checking' ? '正在連線 SharePoint…'
        : p.state === 'login' ? '未登入 Microsoft，修改還沒寫入 SharePoint（' + p.pendingCount() + ' 筆待同步）'
        : p.state === 'error' ? '寫入 SharePoint 失敗：' + p.error + '（' + p.pendingCount() + ' 筆待同步，會自動重試）'
        : p.state === 'pending' ? p.pendingCount() + ' 筆修改等待同步到 SharePoint'
        : p.at ? '已同步到 SharePoint ' + util.fmtDateTime(p.at).slice(11) : '已連線 SharePoint，存檔時會同步寫入';
      out.push(html`<div class=${cx('banner sync-banner', fail ? 'err' : 'warn')}><${Icon} name=${fail ? 'warn' : 'folder'} />
        <div style="flex:1"><b>目前在本機資料夾作業</b>，資料以 SharePoint 為準，請切換到線上版本。<div class="sync-state">${stateText}</div></div>
        ${p.state === 'login' ? html`<button class="btn btn-secondary btn-sm" onClick=${() => app.pushNow()}>登入 Microsoft</button>` : null}
        ${p.state === 'error' ? html`<button class="btn btn-secondary btn-sm" onClick=${() => sync.push.run()}>立即重試</button>` : null}
        <button class="btn btn-primary btn-sm" onClick=${() => app.switchToSharePoint()}><${Icon} name="cloud" /> 切換到 SharePoint</button></div>`);
    }
    if (p.conflicts.length && st.backend && st.backend.kind === 'file') {
      out.push(html`<div class="banner warn"><${Icon} name="warn" /><div>${p.conflicts.map(c => html`<div>${c.type === 'conflict'
          ? (c.kind === 'projects' ? '專案' : '材料') + '「' + c.name + '」在 SharePoint 上也被修改：SharePoint 的版本保留，你在本機的修改存成「衝突副本」'
          : c.type === 'delete_skipped' ? '「' + c.name + '」在 SharePoint 上被修改過，沒有刪除' : '「' + c.name + '」在 SharePoint 上已被刪除，已用你的版本補回'}</div>`)}</div>
        <button class="btn btn-secondary btn-sm" onClick=${() => { p.conflicts = []; st.emit(); }}>知道了</button></div>`);
    }
    const mr = sync.mirror;
    if (st.backend && st.backend.kind === 'sharepoint' && mr.state === 'needs-permission') {
      out.push(html`<div class="banner info"><${Icon} name="folder" /> 本機副本資料夾「${mr.name()}」需要重新授權，才能繼續寫入最新內容。
        <button class="btn btn-secondary btn-sm" onClick=${() => mr.grant()}>授權</button></div>`);
    } else if (st.backend && st.backend.kind === 'sharepoint' && mr.state === 'error') {
      out.push(html`<div class="banner err"><${Icon} name="warn" /> 本機副本沒有寫入：${mr.error}
        <button class="btn btn-secondary btn-sm" onClick=${() => mr.write()}>重試</button></div>`);
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
      return html`<div class="app" style="grid-template-rows:1fr"><${TIM.ui.Gate} error=${app.gateError} noAutoRestore=${app.noAutoRestore} /><${Overlays} /><${UpdateNotice} /></div>`;
    }
    let page;
    if (route.page === 'library') page = html`<${TIM.ui.Library} route=${route} />`;
    else if (route.page === 'project') page = html`<${TIM.ui.ProjectPage} route=${route} key=${route.pid} />`;
    else page = html`<${TIM.ui.Home} />`;
    return html`<div class=${cx('app', st.readonly && 'is-readonly')}>
      <${Toolbar} route=${route} />
      <main class="main"><${Banners} />${page}</main>
      <${Overlays} />
      <${UpdateNotice} />
    </div>`;
  }

  render(html`<${App} />`, document.getElementById('app'));
})();
