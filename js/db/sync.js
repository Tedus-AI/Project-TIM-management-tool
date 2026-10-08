/* SharePoint is the master copy of the database. Two helpers keep a local folder in step:
 *
 *  mirror  (SharePoint mode): after every save — and whenever other people's changes are pulled
 *          in — the latest SharePoint content is written to tim_db.json in a local folder
 *          (write-only; never read back in this mode), laid out like SharePoint's Database folder:
 *          tim_db.json + Backup/ (backup.js; mirror.backupTarget) + Datasheets/. By default the
 *          folder is the one of the local database last opened in this browser; the user may pick
 *          another folder or turn it off. A tim_db.json there that was changed elsewhere since our
 *          last write is kept as tim_db_local_<time>.json first. Datasheet files the folder lacks
 *          are copied into Datasheets (added only, never deleted), so the copy also works offline.
 *
 *  push    (local folder mode, i.e. someone opened the local copy): every local save is also
 *          merged into SharePoint (merge.mergePush: per project / material, If-Match; work changed
 *          on both sides becomes a conflict copy, never an overwrite). What could not be pushed
 *          yet is remembered in IndexedDB per folder and pushed on the next chance — the next
 *          local save, opening that folder again, or opening SharePoint while the folder is
 *          still accessible. Datasheet files of pushed materials are uploaded too.
 *
 * No DOM here; the app shows the state (banners, reminders) and calls these from click handlers.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const META_DB = 'tim-mgmt-meta', META_STORE = 'handles';
  const MIRROR_KEY = 'mirror_dir';        // { dir, file, stamp, auto } | { off: true } — stamp: updated_at of the tim_db.json we last wrote
  const PENDING_KEY = 'sp_pending';       // [{ handle, name, base, taken, copies, at }]
  const DB_NAME = 'tim_db.json';
  const FILES_DIR = 'Datasheets';
  const RETRY_MS = 30000;

  const sp = () => TIM.spBackend;
  const merge = () => TIM.merge;
  const errText = e => String((e && e.message) || e);
  const p2 = n => (n < 10 ? '0' : '') + n;
  const stampOf = text => { const m = String(text || '').slice(0, 600).match(/"updated_at"\s*:\s*"([^"]+)"/); return m ? m[1] : null; };
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });

  // IndexedDB may refuse a handle (tests use stand-ins) → keep it in memory for this page.
  const memo = {};
  async function idbGet(k) { try { const v = await TIM.idb.get(META_DB, META_STORE, k); return v == null ? (memo[k] || null) : v; } catch (e) { return memo[k] || null; } }
  async function idbPut(k, v) { memo[k] = v; try { await TIM.idb.put(META_DB, META_STORE, k, v); } catch (e) { /* memo only */ } }
  async function idbDel(k) { delete memo[k]; try { await TIM.idb.del(META_DB, META_STORE, k); } catch (e) { /* ignore */ } }
  async function same(a, b) { try { return !!(a && b && await a.isSameEntry(b)); } catch (e) { return false; } }

  function emptyTaken() { return { projects: [], materials: [], images: [], settings: false, deletedProjects: [], deletedMaterials: [] }; }
  /** Add a store "taken" (Sets) or a stored one (arrays) into `into`; the later change of a record wins. */
  function addTaken(into, t) {
    const arr = x => Array.from(x || []);
    const put = (list, id) => { if (!list.includes(id)) list.push(id); };
    const drop = (list, id) => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); };
    arr(t.projects).forEach(id => { put(into.projects, id); drop(into.deletedProjects, id); });
    arr(t.deletedProjects).forEach(id => { put(into.deletedProjects, id); drop(into.projects, id); });
    arr(t.materials).forEach(id => { put(into.materials, id); drop(into.deletedMaterials, id); });
    arr(t.deletedMaterials).forEach(id => { put(into.deletedMaterials, id); drop(into.materials, id); });
    arr(t.images).forEach(id => put(into.images, id));
    if (t.settings) into.settings = true;
    return into;
  }
  const isEmpty = t => !(t.projects.length || t.materials.length || t.images.length || t.settings || t.deletedProjects.length || t.deletedMaterials.length);
  const countOf = t => t.projects.length + t.materials.length + t.deletedProjects.length + t.deletedMaterials.length + (t.settings ? 1 : 0);

  async function loadPending() { const v = await idbGet(PENDING_KEY); return Array.isArray(v) ? v : []; }
  async function savePending(list) { if (list.length) await idbPut(PENDING_KEY, list); else await idbDel(PENDING_KEY); }

  /**
   * Merge `taken` records of `local` into SharePoint (If-Match; re-read and retry on 412).
   * files(path) → Blob | null: datasheet files of the pushed materials that SharePoint lacks.
   * Returns { base, copies, conflicts }.
   */
  async function pushRecords(local, entry, files) {
    const S = sp();
    // datasheets first, so SharePoint never lists a file it does not have
    for (const id of entry.taken.materials) {
      const m = local.materials[id];
      for (const d of (m && m.datasheets) || []) {
        if (pushRecords.known.has(d.path)) continue;
        if (await S.files.exists(d.path)) { pushRecords.known.add(d.path); continue; }
        let blob = null;
        try { blob = files ? await files(d.path) : null; } catch (e) { blob = null; }
        if (!blob) continue;                                         // not here either: nothing to upload
        await S.files.put(d.path, blob, { quiet: true });
        pushRecords.known.add(d.path);
      }
    }
    for (let attempt = 0; ; attempt++) {
      const text = await S.read();
      if (!String(text).trim()) throw new Error('SharePoint 上的資料庫是空的');
      const obj = JSON.parse(text);
      const v = TIM.schema.validateDb(obj);
      if (!v.ok) throw new Error('SharePoint 上的資料庫無法讀取：' + v.error);
      const disk = TIM.schema.normalizeDb(obj);
      const r = merge().mergePush(disk, local, entry.base, entry.taken, entry.copies);
      try { await S.write(merge().serializeDb(r.merged)); }
      catch (e) { if (e.conflict && attempt < 4) continue; throw e; }
      return r;
    }
  }
  pushRecords.known = new Set();

  // ═════════════ push: local folder mode → SharePoint ═════════════
  const push = {
    active: false,
    handle: null,            // the local database folder (or file)
    name: '',
    file: DB_NAME,           // the database file name in that folder
    entry: null,             // { base, taken, copies } — taken: not pushed yet
    state: 'idle',           // idle | checking | login | pending | pushing | ok | error
    error: '',
    at: null,                // last successful push (ISO)
    conflicts: [],
    failures: 0,             // consecutive failed pushes
    busy: false,
    again: false,
    timer: null,
    current: null,           // the running push (promise)

    /** Local database opened. handle: its folder (or file); file: the database file name; db: the loaded database. */
    async start(handle, name, db, file) {
      push.stop();
      push.active = true; push.handle = handle; push.name = name || ''; push.file = file || DB_NAME;
      push.state = 'checking'; push.error = ''; push.at = null; push.conflicts = []; push.failures = 0;
      push.entry = { base: merge().revsOf(db), taken: emptyTaken(), copies: { projects: {}, materials: {} } };
      for (const e of await loadPending()) {
        if (await same(e.handle, handle)) { push.entry = { base: e.base, taken: e.taken, copies: e.copies || { projects: {}, materials: {} } }; break; }
      }
      emit();
      await push.run();
    },
    /** Session closed (a push still running finishes on its own session). */
    stop() {
      clearTimeout(push.timer);
      push.active = false; push.handle = null; push.entry = null; push.state = 'idle'; push.again = false;
      emit();
    },
    pendingCount() { return push.entry ? countOf(push.entry.taken) : 0; },

    /** A local save finished: remember what it wrote, push soon. */
    async saved(taken) {
      if (!push.active) return;
      addTaken(push.entry.taken, taken);
      await push.persist();
      push.state = push.state === 'error' || push.state === 'login' ? push.state : 'pending';
      emit();
      clearTimeout(push.timer);
      push.timer = setTimeout(() => push.run(), 400);
    },

    async persist() { await persistEntry(push.handle, push.name, push.entry, push.file); },

    /**
     * Push what is pending. opts.interactive: from a click (may open the sign-in popup).
     * Each run works on the session it started in (folder, pending entry, database object),
     * so a run that outlives its session never touches the next one. Returns when done.
     */
    run(opts) {
      if (!push.active) return Promise.resolve();
      if (push.busy) { push.again = true; return push.current; }
      push.busy = true;
      clearTimeout(push.timer);
      const handle = push.handle, name = push.name, file = push.file, entry = push.entry, local = TIM.store.db;
      const mine = () => push.active && push.entry === entry;
      push.current = (async () => {
        try {
          const S = sp();
          if (opts && opts.interactive) {
            const s = await S.signIn();
            if (!s.ok) { if (mine()) { push.state = 'login'; push.error = s.reason === 'cancelled' ? '' : (s.error || s.reason); } return; }
          }
          const r = await S.tryRestore();
          if (!r.ok) {
            if (mine()) {
              push.state = r.needsLogin ? 'login' : 'error';
              push.error = r.needsLogin ? '尚未登入 Microsoft 帳號' : r.reason === 'missing' ? 'SharePoint 上找不到資料庫' : (r.error || '無法連線到 SharePoint');
              if (!r.needsLogin || !isEmpty(entry.taken)) push.failures++;
            }
            return;
          }
          if (isEmpty(entry.taken)) { if (mine()) { push.state = 'ok'; push.error = ''; push.failures = 0; } return; }
          if (mine()) { push.state = 'pushing'; emit(); }
          const take = entry.taken;
          entry.taken = emptyTaken();
          let res;
          try {
            res = await pushRecords(local, { base: entry.base, taken: take, copies: entry.copies }, path => TIM.fileBackend.files.localBlob(path));
          } catch (e) {
            entry.taken = addTaken(take, entry.taken);     // later saves win over what failed
            await persistEntry(handle, name, entry, file);
            throw e;
          }
          entry.base = res.base;
          entry.copies = res.copies;
          await persistEntry(handle, name, entry, file);
          if (mine()) {
            push.conflicts = push.conflicts.concat(res.conflicts.map(c => Object.assign({ at: TIM.util.nowIso() }, c)));
            push.at = TIM.util.nowIso();
            push.state = isEmpty(entry.taken) ? 'ok' : 'pending';
            push.error = ''; push.failures = 0;
            // the local copy now holds nothing SharePoint lacks → the mirror may overwrite it again
            if (isEmpty(entry.taken) && !TIM.store.hasUnsaved()) await mirror.markSynced(handle, file, local.updated_at);
          }
        } catch (e) {
          if (mine()) { push.state = e && e.auth ? 'login' : 'error'; push.error = errText(e); push.failures++; }
          console.warn('[sync] push to SharePoint failed:', errText(e));
        } finally {
          push.busy = false; push.current = null;
          emit();
          if (mine()) {
            if (push.again) { push.again = false; push.timer = setTimeout(() => push.run(), 0); }
            else if (push.state === 'error' || push.state === 'pending') push.timer = setTimeout(() => push.run(), push.state === 'pending' ? 0 : RETRY_MS);
          }
        }
      })();
      return push.current;
    },
  };

  /** Remember (or forget) what a folder still has to push. */
  async function persistEntry(handle, name, entry, file) {
    if (!handle || !entry) return;
    const keep = [];
    for (const e of await loadPending()) if (!(await same(e.handle, handle))) keep.push(e);
    if (!isEmpty(entry.taken)) keep.push({ handle, name, file: file || DB_NAME, base: entry.base, taken: entry.taken, copies: entry.copies, at: TIM.util.nowIso() });
    await savePending(keep);
  }

  // ═════════════ mirror: SharePoint mode → local folder ═════════════
  /** The local database last opened in this browser ({ dir, name }), or null. */
  async function localDb() { try { return TIM.fileBackend && TIM.fileBackend.remembered ? await TIM.fileBackend.remembered() : null; } catch (e) { return null; } }
  /** Folder below `root` (Datasheets/<parts…>); create: make missing folders, else null when one is missing. */
  async function subdir(root, parts, create) {
    let d = root;
    try { for (const s of parts) d = await d.getDirectoryHandle(s, create ? { create: true } : undefined); }
    catch (e) { if (!create && e && e.name === 'NotFoundError') return null; throw e; }
    return d;
  }

  const mirror = {
    dir: null,
    file: DB_NAME,           // the copy is always tim_db.json (the same name as on SharePoint)
    auto: false,             // true: the folder of the local database last opened (not a folder the user picked)
    off: false,              // the user turned the local copy off
    stamp: null,
    state: 'none',           // none | needs-permission | ready | writing | error
    error: '',
    at: null,
    lastRev: null,
    kept: '',                // name of the last locally changed copy we kept aside
    adopted: '',             // set when the copy starts in a folder (or moves to tim_db.json there) — for a notice
    busy: false,
    again: false,
    filesBusy: false,
    filesAgain: false,
    filesCopied: 0,          // datasheet files copied into the folder (this page)

    /** "folder / file" of the copy ('' when none). */
    name() { return mirror.dir ? mirror.dir.name + ' / ' + mirror.file : ''; },

    /** SharePoint database opened: restore the remembered folder (and push any leftover local work). */
    async restore() {
      const rec = await idbGet(MIRROR_KEY);
      mirror.off = !!(rec && rec.off);
      mirror.dir = !mirror.off && rec && rec.dir ? rec.dir : null;
      mirror.file = DB_NAME;
      mirror.auto = !!(rec && rec.auto);
      // the stamp belongs to the file it was taken from (older versions wrote the local database's own file name)
      const sameFile = !(rec && rec.file) || rec.file === DB_NAME;
      mirror.stamp = rec && sameFile ? rec.stamp || null : null;
      mirror.lastRev = null; mirror.error = ''; mirror.kept = ''; mirror.adopted = '';
      copied.clear();
      if (!mirror.off && (!mirror.dir || mirror.auto)) {
        // nothing picked → the folder of the local database follows SharePoint
        const loc = await localDb();
        if (loc) {
          if (!(mirror.dir && await same(mirror.dir, loc.dir))) mirror.stamp = null;
          mirror.dir = loc.dir; mirror.auto = true;
        } else if (mirror.auto) mirror.dir = null;
      }
      if (mirror.dir && (!rec || !rec.dir || !sameFile)) mirror.adopted = mirror.name();
      if (!mirror.dir) { mirror.state = 'none'; emit(); return; }
      let st = 'prompt';
      try { st = await mirror.dir.queryPermission({ mode: 'readwrite' }); } catch (e) { st = 'denied'; }
      mirror.state = st === 'granted' ? 'ready' : 'needs-permission';
      emit();
      if (mirror.state === 'ready') mirror.schedule();
    },

    /** Pick the folder (click handler). */
    async pick() {
      let dir;
      try {
        dir = await window.showDirectoryPicker({ id: 'tim-mirror', mode: 'readwrite' });
        if (await dir.queryPermission({ mode: 'readwrite' }) !== 'granted' && await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') return { ok: false, reason: 'denied' };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: errText(e) };
      }
      const file = DB_NAME;
      // a file there that is not a TIM database is never overwritten
      try {
        const head = await (await (await dir.getFileHandle(file)).getFile()).slice(0, 600).text();
        if (head.trim() && !/"schema"\s*:\s*"tim-db"/.test(head)) return { ok: false, reason: 'foreign' };
      } catch (e) { /* no file yet */ }
      mirror.dir = dir; mirror.file = file; mirror.auto = false; mirror.off = false; mirror.stamp = null;
      copied.clear();
      await idbPut(MIRROR_KEY, { dir, file, stamp: null });
      mirror.state = 'ready'; mirror.error = ''; mirror.lastRev = null;
      emit();
      await mirror.write();
      return { ok: true, name: mirror.name() };
    },

    /** Re-grant permission after a reload (click handler). */
    async grant() {
      if (!mirror.dir) return false;
      try { if (await mirror.dir.requestPermission({ mode: 'readwrite' }) !== 'granted') return false; } catch (e) { return false; }
      mirror.state = 'ready'; emit();
      await mirror.write();
      return true;
    },

    /** Turn the local copy off (also the default one, until a folder is picked again). */
    async disable() { mirror.dir = null; mirror.stamp = null; mirror.auto = false; mirror.off = true; mirror.adopted = ''; mirror.state = 'none'; await idbPut(MIRROR_KEY, { off: true }); emit(); },

    /** Our local push left this folder in step with SharePoint at `stamp`. */
    async markSynced(handle, file, stamp) {
      if (!handle || handle.kind !== 'directory' || !stamp || String(file || DB_NAME).toLowerCase() !== DB_NAME) return;
      const rec = await idbGet(MIRROR_KEY);
      if (rec && rec.off) return;
      if (rec && rec.dir && !rec.auto) {
        if (await same(rec.dir, handle)) await idbPut(MIRROR_KEY, Object.assign({}, rec, { file: DB_NAME, stamp }));
        return;
      }
      await idbPut(MIRROR_KEY, { dir: handle, file: DB_NAME, stamp, auto: true });   // the default copy is this folder
    },

    /** Backup destination: <copy folder>/Backup, once the folder is writable (backup.js decides when and what is kept). */
    backupTarget() {
      return {
        name: () => (mirror.dir ? mirror.dir.name + ' / Backup' : ''),
        ready: () => !!mirror.dir && (mirror.state === 'ready' || mirror.state === 'writing'),
        write: (text, file) => TIM.backup.writeFolder(mirror.dir, text, file),
      };
    },

    /** Write the latest SharePoint content soon (coalesced). */
    schedule() {
      if (mirror.state !== 'ready' && mirror.state !== 'writing' && mirror.state !== 'error') return;
      if (mirror.busy) { mirror.again = true; return; }
      setTimeout(() => mirror.write(), 0);
    },

    async write() {
      if (!mirror.dir || mirror.state === 'needs-permission' || mirror.state === 'none') return;
      if (mirror.busy) { mirror.again = true; return; }
      const text = sp().currentText();
      if (!String(text).trim()) return;
      const stamp = stampOf(text);
      const dir = mirror.dir, file = mirror.file;
      mirror.busy = true;
      let wrote = false;
      try {
        await applyLeftovers(dir);
        let existing = '';
        try { existing = await (await (await dir.getFileHandle(file)).getFile()).text(); } catch (e) { existing = ''; }
        if (existing === text) { mirror.at = TIM.util.nowIso(); mirror.state = 'ready'; wrote = true; return; }
        if (existing.trim()) {
          if (!/"schema"\s*:\s*"tim-db"/.test(existing.slice(0, 600))) throw new Error('資料夾裡的 ' + file + ' 不是 TIM 資料庫，不會覆蓋');
          const was = stampOf(existing);
          if (was && was !== mirror.stamp && was !== stamp) {
            // changed somewhere else since our last copy → keep it, never overwrite
            const d = new Date();
            const keep = 'tim_db_local_' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '.json';
            const w0 = await (await dir.getFileHandle(keep, { create: true })).createWritable();
            await w0.write(existing); await w0.close();
            mirror.kept = keep;
          }
        }
        mirror.state = 'writing'; emit();
        const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
        await w.write(text);
        await w.close();
        mirror.stamp = stamp;
        await idbPut(MIRROR_KEY, { dir, file, stamp, auto: mirror.auto });
        mirror.lastRev = TIM.merge.revFromHead(text);
        mirror.at = TIM.util.nowIso();
        mirror.state = 'ready'; mirror.error = '';
        wrote = true;
      } catch (e) {
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) mirror.state = 'needs-permission';
        else { mirror.state = 'error'; mirror.error = errText(e); }
        console.warn('[sync] local copy not written:', errText(e));
      } finally {
        mirror.busy = false;
        emit();
        if (wrote) { copyDatasheets(); if (TIM.backup && TIM.backup.kick) TIM.backup.kick(); }   // first backup of this folder right away
        if (mirror.again) { mirror.again = false; setTimeout(() => mirror.write(), 0); }
      }
    },
  };

  /**
   * Datasheet files of the database that the copy folder lacks → downloaded from SharePoint into
   * <folder>/Datasheets/<path>. Only added, never deleted (the copy is write-only). Runs in the
   * background after a write; a file missing on SharePoint is skipped, other failures retry on the next write.
   */
  const copied = new Set();      // paths known to be in the folder (or missing on SharePoint)
  async function copyDatasheets() {
    if (mirror.filesBusy) { mirror.filesAgain = true; return; }
    const dir = mirror.dir, db = TIM.store.db, S = sp();
    if (!dir || !db || !S.files || TIM.store.backend !== S) return;
    mirror.filesBusy = true;
    try {
      const paths = [];
      Object.values(db.materials).forEach(m => (m.datasheets || []).forEach(d => { if (d.path && !paths.includes(d.path)) paths.push(d.path); }));
      for (const rel of paths) {
        if (mirror.dir !== dir || mirror.state !== 'ready') break;
        if (copied.has(rel)) continue;
        const parts = [FILES_DIR].concat(String(rel).split('/').filter(Boolean));
        const name = parts.pop();
        const there = await subdir(dir, parts, false);
        let have = false;
        if (there) { try { await there.getFileHandle(name); have = true; } catch (e) { if (!(e && e.name === 'NotFoundError')) throw e; } }
        if (!have) {
          let blob;
          try { blob = await S.files.blob(rel, { quiet: true }); }
          catch (e) { if (e && e.status === 404) { copied.add(rel); continue; } throw e; }
          const w = await (await (await subdir(dir, parts, true)).getFileHandle(name, { create: true })).createWritable();
          await w.write(blob);
          await w.close();
          mirror.filesCopied++;
        }
        copied.add(rel);
      }
    } catch (e) {
      console.warn('[sync] datasheets not copied to the local copy:', errText(e));
    } finally {
      mirror.filesBusy = false;
      emit();
      if (mirror.filesAgain) { mirror.filesAgain = false; setTimeout(copyDatasheets, 0); }
    }
  }

  /**
   * SharePoint mode: local work that never reached SharePoint (saved while offline in local
   * folder mode) is merged into the open SharePoint session first. Entries whose folder is
   * not accessible right now stay for later. dir: a folder we may access now (the mirror).
   */
  async function applyLeftovers(dir) {
    const list = await loadPending();
    if (!list.length || !TIM.store.db || TIM.store.backend !== sp()) return 0;
    let applied = 0;
    const keep = [];
    for (const e of list) {
      let text = null;
      try {
        const h = e.handle;
        const ok = h && (await same(h, dir) || await h.queryPermission({ mode: 'readwrite' }) === 'granted');
        if (ok) {
          const fh = h.kind === 'directory' ? await h.getFileHandle(e.file || DB_NAME) : h;
          text = await (await fh.getFile()).text();
        }
      } catch (x) { text = null; }
      if (text === null) { keep.push(e); continue; }
      let local;
      try { local = TIM.schema.normalizeDb(JSON.parse(text)); }
      catch (x) { throw new Error('本機資料夾「' + (e.name || (e.handle && e.handle.name) || '') + '」裡尚未同步的資料無法讀取（' + errText(x) + '）'); }
      const cur = TIM.store.db;
      const r = merge().mergePush(cur, local, e.base, e.taken, e.copies);
      const projects = [], materials = [], deletedProjects = [], deletedMaterials = [], images = [];
      TIM.store.mutateDb(db => {
        ['projects', 'materials'].forEach(kind => {
          Object.keys(r.merged[kind]).forEach(id => {
            if (db[kind][id] !== r.merged[kind][id]) { db[kind][id] = r.merged[kind][id]; (kind === 'projects' ? projects : materials).push(id); }
          });
          Object.keys(db[kind]).forEach(id => {
            if (!r.merged[kind][id]) { delete db[kind][id]; (kind === 'projects' ? deletedProjects : deletedMaterials).push(id); }
          });
        });
        Object.keys(r.merged.images).forEach(id => { if (!db.images[id]) { db.images[id] = r.merged.images[id]; images.push(id); } });
        if (e.taken.settings) db.settings = r.merged.settings;
      }, { projects, materials, deletedProjects, deletedMaterials, images, settings: !!e.taken.settings, clearHistory: ['lib'].concat(projects.map(id => 'p:' + id)) });
      applied += countOf(e.taken);
      if (r.conflicts.length) TIM.store.conflicts = TIM.store.conflicts.concat(r.conflicts.map(c => Object.assign({ at: TIM.util.nowIso() }, c)));
    }
    await savePending(keep);
    if (applied) { mirror.leftovers = applied; emit(); }
    return applied;
  }

  /** SharePoint opened: restore the local copy folder; merge leftover local work that is accessible now. */
  async function onSharePointOpened() {
    await mirror.restore();
    if (mirror.state !== 'ready') { try { await applyLeftovers(null); } catch (e) { console.warn('[sync] leftovers:', errText(e)); } }
  }

  TIM.sync = {
    push, mirror, onSharePointOpened, applyLeftovers,
    __disableForTest: !!window.__TIM_TEST_SYNC_OFF,    // E2E: off unless the scenario is about syncing
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    pendingFolders: async () => (await loadPending()).map(e => e.name || (e.handle && e.handle.name) || ''),
    // pure helpers, exported for tests
    addTaken, emptyTaken, stampOf,
  };
})();
