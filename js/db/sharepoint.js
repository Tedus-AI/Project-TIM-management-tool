/* SharePoint storage backend (Microsoft Graph + MSAL.js; same Azure app and site as the
 * AI Thermal pad & stud tool). Layout in the site's 文件 (Shared Documents) library:
 *
 *   TIM_Manager/Database/tim_db.json            the shared database
 *   TIM_Manager/Database/Backup/tim_db_backup_YYYY-MM-DD_HHmm.json   backups: today's latest + the previous day's last (backup.js)
 *   TIM_Manager/Datasheets/<Vendor>/<Model>/<file>              material datasheets
 *
 * Every database write carries If-Match: <eTag>. Two people saving at the same moment can
 * never overwrite each other: the second write gets 412, and the store re-reads, merges per
 * project / material and writes again. Missing sub-folders are created by the first write.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};

  const CONFIG = {
    clientId: '17fc1ab4-0ab0-4520-9315-6faa86d9e8ec',
    authority: 'https://login.microsoftonline.com/19f25823-17ff-421f-ad4e-8fed035aedda',
    scopes: ['Files.ReadWrite.All', 'Sites.Read.All', 'Sites.ReadWrite.All'],
    siteHostname: 'deltao365.sharepoint.com',
    sitePath: '/sites/Thermal-Spec-DB',
    siteName: 'Thermal-Spec-DB',
    dbFolder: 'TIM_Manager/Database',
    dbName: 'tim_db.json',
    backupFolder: 'TIM_Manager/Database/Backup',
    datasheetFolder: 'TIM_Manager/Datasheets',
  };
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const GET_MS = 30000, PUT_MS = 120000;
  const STALE_MS = 60000;          // SharePoint may serve the pre-write copy for a short while

  let pca = null, initP = null, account = null;
  let siteId = null;
  let itemId = null;               // drive item of tim_db.json
  let cache = null;                // { etag, text }: the database content we last read or wrote
  let wrote = null;                // { rev, at, text }: our last successful write
  let trustDisk = false;           // after a 412 the next read must take the disk as it is
  let needsLogin = false;
  let membersP = null;             // Project_Members list (cached for the session)

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const enc = p => String(p).split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const dbPath = () => CONFIG.dbFolder + '/' + CONFIG.dbName;
  const revOf = text => TIM.merge.revFromHead(String(text || '').slice(0, 512));
  function mkErr(msg, props) { return Object.assign(new Error(msg), props || {}); }

  /**
   * auth.html next to the tool (registered as SPA redirect URI in the Azure app). A blank page,
   * so neither the sign-in popup nor MSAL's hidden renewal iframe starts the tool itself.
   */
  function redirectUri() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'auth.html'; }

  // ───────── MSAL ─────────
  function init() {
    if (pca) return Promise.resolve(pca);
    if (initP) return initP;
    initP = (async () => {
      const msal = await TIM.loader.load('msal');
      const app = new msal.PublicClientApplication({
        auth: { clientId: CONFIG.clientId, authority: CONFIG.authority, redirectUri: redirectUri() },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      });
      if (typeof app.initialize === 'function') await app.initialize();
      try { const r = await app.handleRedirectPromise(); if (r && r.account) account = r.account; } catch (e) { /* no redirect in progress */ }
      if (!account) { const all = app.getAllAccounts(); if (all.length) account = all[0]; }
      pca = app;
      return app;
    })();
    initP.catch(() => { initP = null; });
    return initP;
  }

  async function token(interactive) {
    await init();
    if (!account) { needsLogin = true; throw mkErr('尚未登入 Microsoft 帳號', { auth: true }); }
    try {
      const r = await pca.acquireTokenSilent({ scopes: CONFIG.scopes, account });
      needsLogin = false;
      return r.accessToken;
    } catch (e) {
      if (!interactive) { needsLogin = true; throw mkErr('Microsoft 登入已過期，請重新登入', { auth: true }); }
      const r = await pca.acquireTokenPopup({ scopes: CONFIG.scopes, account });
      if (r.account) account = r.account;
      needsLogin = false;
      return r.accessToken;
    }
  }

  // ───────── Graph ─────────
  async function timed(url, init, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, Object.assign({}, init, { signal: ctl.signal })); }
    catch (e) {
      throw mkErr(e && e.name === 'AbortError' ? 'SharePoint 連線逾時（' + Math.round(ms / 1000) + ' 秒沒有回應）' : '無法連線到 SharePoint（' + ((e && e.message) || e) + '）', { network: true });
    } finally { clearTimeout(t); }
  }

  async function httpErr(res) {
    let detail = '';
    try { const j = await res.json(); detail = (j && j.error && (j.error.message || j.error.code)) || ''; } catch (e) { /* not JSON */ }
    const s = res.status;
    const msg = s === 401 ? 'Microsoft 登入已過期，請重新登入'
      : s === 403 ? '沒有權限存取 SharePoint 網站 ' + CONFIG.siteName + '（請確認帳號有該網站的編輯權限）'
      : s === 404 ? '在 SharePoint 上找不到'
      : s === 412 ? '資料庫剛被其他人更新'
      : s === 423 ? 'SharePoint 檔案被鎖定（可能正在同步或被其他程式開啟）'
      : s === 429 ? 'SharePoint 要求放慢速度（429）'
      : s === 507 ? 'SharePoint 空間不足'
      : 'SharePoint 錯誤 ' + s;
    return mkErr(msg + (detail && s !== 404 && s !== 412 ? '：' + detail : ''), { status: s, auth: s === 401, conflict: s === 412 });
  }

  /**
   * Graph request with timeout. GET: one retry on network errors / 429 / 5xx.
   * o: { method, body, headers, interactive, ok(status) → treat as success, timeout }.
   * PUT / DELETE errors that may still have reached the server are marked .uncertain.
   */
  async function graph(path, o) {
    o = o || {};
    const method = o.method || 'GET';
    const url = /^https:/.test(path) ? path : GRAPH + path;
    const tries = method === 'GET' ? 2 : 1;
    let last = null;
    for (let i = 0; i < tries; i++) {
      if (i) await sleep(700);
      const headers = Object.assign({ Authorization: 'Bearer ' + await token(!!o.interactive) }, o.headers || {});
      let res;
      try { res = await timed(url, { method, headers, body: o.body, cache: 'no-store' }, o.timeout || (method === 'GET' ? GET_MS : PUT_MS)); }
      catch (e) { last = e; if (method !== 'GET') e.uncertain = true; continue; }
      if (res.ok || (o.ok && o.ok(res.status))) return res;
      last = await httpErr(res);
      if (res.status === 401) needsLogin = true;
      if (method !== 'GET' && res.status >= 500) last.uncertain = true;
      if (!(res.status === 429 || res.status >= 500)) break;
    }
    throw last;
  }

  async function resolveSite(interactive) {
    if (siteId) return siteId;
    const res = await graph('/sites/' + CONFIG.siteHostname + ':' + CONFIG.sitePath + '?$select=id', { interactive, ok: s => s === 404 });
    if (res.status === 404) throw mkErr('找不到 SharePoint 網站 ' + CONFIG.siteHostname + CONFIG.sitePath, { status: 404 });
    siteId = (await res.json()).id;
    return siteId;
  }
  const drive = () => '/sites/' + siteId + '/drive';
  const byPath = p => drive() + '/root:/' + enc(p);

  /** Metadata of tim_db.json: { id, etag, size, modified } or null when it does not exist. */
  async function dbMeta(interactive) {
    await resolveSite(interactive);
    const sel = '?$select=id,eTag,size,lastModifiedDateTime';
    let res = itemId ? await graph(drive() + '/items/' + itemId + sel, { interactive, ok: s => s === 404 }) : null;
    if (!res || res.status === 404) res = await graph(byPath(dbPath()) + sel, { interactive, ok: s => s === 404 });
    if (res.status === 404) { itemId = null; return null; }
    const m = await res.json();
    itemId = m.id;
    return { id: m.id, etag: m.eTag || null, size: m.size, modified: m.lastModifiedDateTime };
  }

  /**
   * Current database text. The eTag is taken BEFORE the content, so the eTag we later send
   * with If-Match can only be older than the content, never newer (worst case: one extra 412).
   */
  async function fetchText(interactive) {
    const m = await dbMeta(interactive);
    if (!m) throw mkErr('SharePoint 上找不到資料庫檔案（' + spLocation() + '），可能被移動或刪除', { status: 404 });
    if (cache && cache.etag && cache.etag === m.etag) return cache.text;
    const res = await graph(drive() + '/items/' + m.id + '/content', { interactive });
    const text = await res.text();
    if (!text.trim() && m.size > 0) throw mkErr('SharePoint 回傳空白內容（檔案大小 ' + m.size + ' bytes）；為避免覆蓋資料已暫停，請稍後再試');
    const rev = revOf(text);
    if (!trustDisk && wrote && Date.now() - wrote.at < STALE_MS && rev !== null && rev < wrote.rev) {
      return wrote.text;   // the copy from before our own write (SharePoint read-after-write lag)
    }
    cache = { etag: m.etag, text };
    trustDisk = false;
    return text;
  }

  function spLocation() { return CONFIG.siteName + ' / ' + dbPath().split('/').join(' / '); }

  const sp = {
    kind: 'sharepoint',
    config: CONFIG,
    supported() { return typeof fetch === 'function'; },
    label() { return 'SharePoint'; },
    location: spLocation,
    ready() { return !!itemId; },
    account() { return account ? { name: account.name || account.username || '', email: account.username || '' } : null; },
    needsLogin() { return needsLogin; },

    async head() { return (await fetchText(false)).slice(0, 512); },
    async read() { return fetchText(false); },
    async size() { const m = await dbMeta(false); return m ? m.size : 0; },
    async write(text) {
      if (!itemId) throw mkErr('SharePoint 資料庫尚未開啟');
      const headers = { 'Content-Type': 'application/json' };
      if (cache && cache.etag) headers['If-Match'] = cache.etag;
      let res;
      try { res = await graph(drive() + '/items/' + itemId + '/content', { method: 'PUT', body: text, headers }); }
      catch (e) { if (e.conflict) trustDisk = true; throw e; }
      let m = null;
      try { m = await res.json(); } catch (e) { /* no body */ }
      cache = { etag: (m && m.eTag) || null, text };
      wrote = { rev: revOf(text), at: Date.now(), text };
    },

    /** Load MSAL in the background (so a later click can open the sign-in popup right away). */
    preload() { return init().then(() => true, () => false); },

    /** Sign in with a popup (click handler). opts.select: always let the user pick the account. */
    async signIn(opts) {
      await init();
      if (account && !(opts && opts.select)) {
        try { await token(true); return { ok: true }; } catch (e) { /* fall through to the popup */ }
      }
      try {
        const r = await pca.loginPopup({ scopes: CONFIG.scopes, prompt: 'select_account' });
        account = r.account;
        needsLogin = false;
        siteId = null; itemId = null; cache = null; wrote = null; membersP = null;
        return { ok: true };
      } catch (e) {
        const code = (e && e.errorCode) || '';
        if (code === 'user_cancelled' || code === 'popup_window_error' || code === 'interaction_in_progress') return { ok: false, reason: code === 'popup_window_error' ? 'popup' : 'cancelled' };
        return { ok: false, reason: 'error', error: (e && e.message) || String(e) };
      }
    },

    /**
     * After sign-in: does the database exist? (click handler; may show a consent popup)
     * → { ok, exists } | { ok:false, error }
     */
    async probe() {
      try { const m = await dbMeta(true); return { ok: true, exists: !!m }; }
      catch (e) { return { ok: false, error: e.message || String(e), status: e.status }; }
    },

    /** Create an empty tim_db.json (never replaces an existing file); attach() writes the new database into it. */
    async create() {
      try {
        await resolveSite(true);
        const res = await graph(byPath(dbPath()) + ':/content?@microsoft.graph.conflictBehavior=fail',
          { method: 'PUT', body: '', headers: { 'Content-Type': 'application/json' }, interactive: true, ok: s => s === 409 });
        if (res.status === 409) { await dbMeta(true); return { ok: true, existed: true }; }
        const m = await res.json();
        itemId = m.id; cache = { etag: m.eTag || null, text: '' }; wrote = null;
        return { ok: true };
      } catch (e) { return { ok: false, error: e.message || String(e) }; }
    },

    /** Silent restore on page load: signed in + token + database found → ready. */
    async tryRestore() {
      try { await init(); } catch (e) { return { ok: false, reason: 'error', error: e.message || String(e) }; }
      if (!account) return { ok: false, needsLogin: true };
      const who = sp.account().name;
      try {
        const m = await dbMeta(false);
        return m ? { ok: true, name: who } : { ok: false, reason: 'missing', name: who };
      } catch (e) {
        if (e.auth) return { ok: false, needsLogin: true, name: who };
        return { ok: false, reason: 'error', name: who, error: e.message || String(e) };
      }
    },

    /**
     * People in the site's Project_Members list (kept by the AI Thermal tool; columns ProjectID
     * (Title), MemberName, MemberEmail, Function, IsActive): active rows only, one entry per
     * person → [{ name, email, funcs:[…], projects:[…] }] sorted by name. Cached for the session.
     */
    members() {
      if (!account) return Promise.reject(mkErr('尚未登入 Microsoft 帳號', { auth: true }));
      if (!membersP) {
        membersP = (async () => {
          await resolveSite(false);
          const lr = await graph('/sites/' + siteId + '/lists?$select=id,displayName&$filter=' + encodeURIComponent("displayName eq 'Project_Members'"));
          const list = ((await lr.json()).value || [])[0];
          if (!list) throw mkErr('SharePoint 上沒有 Project_Members 清單', { status: 404 });
          const people = new Map();
          let url = '/sites/' + siteId + '/lists/' + list.id + '/items?$expand=fields&$top=500';
          while (url) {
            const j = await (await graph(url)).json();
            (j.value || []).forEach(it => {
              const f = it.fields || {};
              const name = String(f.MemberName || '').trim();
              if (!name || f.IsActive === false) return;
              const email = String(f.MemberEmail || '').trim();
              const key = (email || name).toLowerCase();
              const p = people.get(key) || { name, email, funcs: [], projects: [] };
              [].concat(f.Function || 'TH/ME').forEach(fn => { if (!p.funcs.includes(fn)) p.funcs.push(fn); });
              if (f.Title && !p.projects.includes(f.Title)) p.projects.push(f.Title);
              people.set(key, p);
            });
            url = j['@odata.nextLink'] || null;
          }
          return Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name));
        })();
        membersP.catch(() => { membersP = null; });
      }
      return membersP;
    },

    /** The database text last read from / written to SharePoint ('' before the first read). */
    currentText() { return cache ? cache.text : ''; },

    /** Forget the open database (keeps the Microsoft sign-in). */
    close() { itemId = null; cache = null; wrote = null; trustDisk = false; },

    // ───────── backups (Database/Backup; naming and what is kept: util.backupFileName / backupsToPrune) ─────────
    backupName() { return CONFIG.siteName + ' / ' + CONFIG.backupFolder.split('/').join(' / '); },
    async writeBackup(text, name) {
      await resolveSite(false);
      name = name || TIM.util.backupFileName(new Date());
      await graph(byPath(CONFIG.backupFolder + '/' + name) + ':/content', { method: 'PUT', body: text, headers: { 'Content-Type': 'application/json' } });
      const names = [];
      let url = byPath(CONFIG.backupFolder) + ':/children?$select=name&$top=200';
      while (url) {
        const res = await graph(url);
        const j = await res.json();
        (j.value || []).forEach(x => names.push(x.name));
        url = j['@odata.nextLink'] || null;
      }
      for (const n of TIM.util.backupsToPrune(names)) {
        try { await graph(byPath(CONFIG.backupFolder + '/' + n), { method: 'DELETE', ok: s => s === 404 }); } catch (e) { /* next time */ }
      }
      return name;
    },

    // ───────── datasheet files (Datasheets/…) ─────────
    // `rel` is the path below the Datasheets folder, e.g. "Vendor-A/GF-750/GF-750_TDS.pdf".
    files: {
      where() { return CONFIG.siteName + ' / ' + CONFIG.datasheetFolder.split('/').join(' / '); },
      supported() { return !!itemId; },
      /** Upload (replaces a file with the same path). o.quiet: background use, never opens a sign-in popup. */
      async put(rel, blob, o) {
        const interactive = !(o && o.quiet);
        await resolveSite(interactive);
        const res = await graph(byPath(CONFIG.datasheetFolder + '/' + rel) + ':/content',
          { method: 'PUT', body: blob, headers: { 'Content-Type': blob.type || 'application/octet-stream' }, interactive });
        const m = await res.json().catch(() => ({}));
        return { size: m.size != null ? m.size : blob.size };
      },
      /** File content as a Blob (for the viewer / download). o.quiet: background use, never opens a sign-in popup. */
      async blob(rel, o) {
        const interactive = !(o && o.quiet);
        await resolveSite(interactive);
        const res = await graph(byPath(CONFIG.datasheetFolder + '/' + rel) + ':/content', { interactive, ok: s => s === 404 });
        if (res.status === 404) throw mkErr('SharePoint 上找不到這份規格書（可能已被移動或刪除）', { status: 404 });
        return res.blob();
      },
      /** Is the file there? (background use: no sign-in popup) */
      async exists(rel) {
        await resolveSite(false);
        const res = await graph(byPath(CONFIG.datasheetFolder + '/' + rel) + '?$select=id', { ok: s => s === 404 });
        return res.status !== 404;
      },
      /** Link that opens the file in SharePoint / Office Online. */
      async webUrl(rel) {
        await resolveSite(true);
        const res = await graph(byPath(CONFIG.datasheetFolder + '/' + rel) + '?$select=webUrl', { interactive: true, ok: s => s === 404 });
        if (res.status === 404) return null;
        return (await res.json()).webUrl || null;
      },
      async del(rel) {
        await resolveSite(false);
        await graph(byPath(CONFIG.datasheetFolder + '/' + rel), { method: 'DELETE', ok: s => s === 404 });
      },
    },

    // Test seams.
    __reset() { pca = null; initP = null; account = null; siteId = null; itemId = null; cache = null; wrote = null; trustDisk = false; needsLogin = false; membersP = null; },
  };

  TIM.spBackend = sp;
})();
