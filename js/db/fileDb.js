/* JSON-file storage backend (File System Access API — Chrome / Edge).
 * Normal use: the user picks the database FOLDER; the database file inside it is found
 * (or created) automatically. The folder handle + file name are remembered in IndexedDB,
 * so the next visit needs at most one click to re-grant permission. A single file picked
 * directly (older sessions, "save trial data as file") is remembered the same way.
 * createWritable() writes to a swap file and replaces the original on close(), so a crash
 * never leaves a half-written database.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const META_DB = 'tim-mgmt-meta', META_STORE = 'handles', HANDLE_KEY = 'db_file', DIR_KEY = 'db_dir';
  const DB_NAME = 'tim_db.json';
  const BACKUP_RE = /^tim_db_backup_\d{4}-\d{2}-\d{2}\.json$/i;
  let handle = null;        // FileSystemFileHandle of the database
  let dirHandle = null;     // its folder, when opened through a folder

  const pickerTypes = [{ description: 'TIM 資料庫 (JSON)', accept: { 'application/json': ['.json'] } }];

  async function idbPut(k, v) { try { await TIM.idb.put(META_DB, META_STORE, k, v); } catch (e) { /* not persistable */ } }
  async function idbGet(k) { try { return await TIM.idb.get(META_DB, META_STORE, k); } catch (e) { return null; } }
  async function idbDel(k) { try { await TIM.idb.del(META_DB, META_STORE, k); } catch (e) { /* ignore */ } }
  /** Remember a directly picked file (and forget any folder). */
  async function saveHandle(h) { await idbDel(DIR_KEY); await idbPut(HANDLE_KEY, h); }
  async function loadHandle() { return idbGet(HANDLE_KEY); }
  const errText = e => String(e && e.message || e);

  /** The remembered database: folder record first, then a directly picked file. */
  async function loadTarget() {
    const rec = await idbGet(DIR_KEY);
    if (rec && rec.dir && rec.name) return { kind: 'dir', dir: rec.dir, name: rec.name, label: rec.dir.name + ' / ' + rec.name };
    const h = await loadHandle();
    return h ? { kind: 'file', file: h, label: h.name } : null;
  }
  /** Permission granted on the remembered target → make it current. */
  async function useTarget(t) {
    if (t.kind === 'dir') {
      try { handle = await t.dir.getFileHandle(t.name); } catch (e) { return { ok: false, reason: 'missing', name: t.label }; }
      dirHandle = t.dir;
    } else { handle = t.file; dirHandle = null; }
    return { ok: true, name: t.label };
  }

  const fileBackend = {
    kind: 'file',
    supported() { return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function'; },
    label() { return handle ? handle.name : ''; },
    /** "folder / file" when opened through a folder. */
    location() { return handle ? (dirHandle ? dirHandle.name + ' / ' : '') + handle.name : ''; },
    folderSupported() { return typeof window.showDirectoryPicker === 'function'; },
    ready() { return !!handle; },

    async head() { const f = await handle.getFile(); return await f.slice(0, 512).text(); },
    async read() { const f = await handle.getFile(); return await f.text(); },
    async size() { const f = await handle.getFile(); return f.size; },
    async write(text) {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    },

    /** Silent restore on page load (no user gesture): granted → ready; otherwise needs a click. */
    async tryRestore() {
      const t = await loadTarget();
      if (!t) return { ok: false, reason: 'none' };
      try {
        const st = await (t.kind === 'dir' ? t.dir : t.file).queryPermission({ mode: 'readwrite' });
        if (st === 'granted') return useTarget(t);
        return { ok: false, needsPermission: true, name: t.label };
      } catch (e) { return { ok: false, reason: 'error', error: String(e) }; }
    },

    /** Re-grant permission on the remembered database (must run inside a click handler). */
    async reconnect() {
      const t = await loadTarget();
      if (!t) return { ok: false, reason: 'none' };
      try {
        const st = await (t.kind === 'dir' ? t.dir : t.file).requestPermission({ mode: 'readwrite' });
        if (st === 'granted') return useTarget(t);
        return { ok: false, reason: 'denied' };
      } catch (e) { return { ok: false, reason: 'error', error: String(e) }; }
    },

    /** Let the user pick the database folder (click handler). */
    async pickFolder() {
      try {
        const opts = { id: 'tim-db', mode: 'readwrite' };
        if (dirHandle || handle) opts.startIn = dirHandle || handle;
        const dir = await window.showDirectoryPicker(opts);
        if (await dir.queryPermission({ mode: 'readwrite' }) !== 'granted' &&
            await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') return { ok: false, reason: 'denied' };
        return { ok: true, dir };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: errText(e) };
      }
    },

    /**
     * TIM databases directly inside a folder: tim_db.json (whatever its content — opening
     * it reports a damaged file instead of creating a second database) and any other JSON
     * file whose header says it is a TIM database. Sorted: tim_db.json, other databases,
     * then daily backups; newest first.
     */
    async scanFolder(dir) {
      const out = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !/\.json$/i.test(name)) continue;
        const f = await h.getFile();
        const main = name.toLowerCase() === DB_NAME;
        const head = main ? '' : await f.slice(0, 512).text();
        if (main || /"schema"\s*:\s*"tim-db"/.test(head)) out.push({ name, handle: h, modified: f.lastModified, size: f.size, main, backup: BACKUP_RE.test(name) });
      }
      const rank = c => (c.main ? 0 : c.backup ? 2 : 1);
      return out.sort((a, b) => rank(a) - rank(b) || b.modified - a.modified);
    },

    /** Use a database file found in a folder (call remember() once it opened successfully). */
    useFolderFile(dir, fileHandle) { dirHandle = dir; handle = fileHandle; return { ok: true, name: dir.name + ' / ' + fileHandle.name }; },

    /** Create tim_db.json in the folder (empty; attach() writes a new database into it). */
    async createInFolder(dir) {
      try {
        const fh = await dir.getFileHandle(DB_NAME, { create: true });
        dirHandle = dir; handle = fh;
        return { ok: true, name: dir.name + ' / ' + DB_NAME, isNew: true };
      } catch (e) { return { ok: false, reason: 'error', error: errText(e) }; }
    },

    /** Remember the current database for the next visit. */
    async remember() {
      if (!handle) return;
      if (dirHandle) { await idbDel(HANDLE_KEY); await idbPut(DIR_KEY, { dir: dirHandle, name: handle.name }); }
      else await saveHandle(handle);
    },

    /** Pick an existing database file. */
    async open() {
      try {
        const opts = { types: pickerTypes, multiple: false };
        if (handle) opts.startIn = handle;
        const [h] = await window.showOpenFilePicker(opts);
        const st = await h.requestPermission({ mode: 'readwrite' });
        if (st !== 'granted') return { ok: false, reason: 'denied' };
        handle = h; dirHandle = null;
        await saveHandle(h);
        return { ok: true, name: h.name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: String(e && e.message || e) };
      }
    },

    /** Create a new database file; the caller writes the initial content. */
    async create(suggestedName) {
      try {
        const opts = { suggestedName: suggestedName || 'tim_db.json', types: pickerTypes };
        if (handle) opts.startIn = handle;
        const h = await window.showSaveFilePicker(opts);
        handle = h; dirHandle = null;
        await saveHandle(h);
        return { ok: true, name: h.name, isNew: true };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: String(e && e.message || e) };
      }
    },

    async forget() { handle = null; dirHandle = null; await idbDel(HANDLE_KEY); await idbDel(DIR_KEY); },

    /** Directory hint for other pickers (start next to the database). */
    startIn() { return dirHandle || handle || undefined; },

    // Test seam (headless E2E): inject a fake FileSystemFileHandle.
    __setHandleForTest(h) { handle = h; dirHandle = null; },
  };

  TIM.fileBackend = fileBackend;
})();
