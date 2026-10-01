/* JSON-file storage backend (File System Access API — Chrome / Edge).
 * The file handle is remembered in IndexedDB so the next visit only needs one click
 * to re-grant permission. createWritable() writes to a swap file and replaces the
 * original on close(), so a crash never leaves a half-written database.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const META_DB = 'tim-mgmt-meta', META_STORE = 'handles', HANDLE_KEY = 'db_file';
  let handle = null;

  const pickerTypes = [{ description: 'TIM 資料庫 (JSON)', accept: { 'application/json': ['.json'] } }];

  async function saveHandle(h) { try { await TIM.idb.put(META_DB, META_STORE, HANDLE_KEY, h); } catch (e) { /* not persistable */ } }
  async function loadHandle() { try { return await TIM.idb.get(META_DB, META_STORE, HANDLE_KEY); } catch (e) { return null; } }

  const fileBackend = {
    kind: 'file',
    supported() { return typeof window.showOpenFilePicker === 'function' && typeof window.showSaveFilePicker === 'function'; },
    label() { return handle ? handle.name : ''; },
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
      const h = await loadHandle();
      if (!h) return { ok: false, reason: 'none' };
      try {
        const st = await h.queryPermission({ mode: 'readwrite' });
        if (st === 'granted') { handle = h; return { ok: true, name: h.name }; }
        return { ok: false, needsPermission: true, name: h.name };
      } catch (e) { return { ok: false, reason: 'error', error: String(e) }; }
    },

    /** Re-grant permission on the remembered file (must run inside a click handler). */
    async reconnect() {
      const h = await loadHandle();
      if (!h) return { ok: false, reason: 'none' };
      try {
        const st = await h.requestPermission({ mode: 'readwrite' });
        if (st === 'granted') { handle = h; return { ok: true, name: h.name }; }
        return { ok: false, reason: 'denied' };
      } catch (e) { return { ok: false, reason: 'error', error: String(e) }; }
    },

    /** Pick an existing database file. */
    async open() {
      try {
        const opts = { types: pickerTypes, multiple: false };
        if (handle) opts.startIn = handle;
        const [h] = await window.showOpenFilePicker(opts);
        const st = await h.requestPermission({ mode: 'readwrite' });
        if (st !== 'granted') return { ok: false, reason: 'denied' };
        handle = h;
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
        handle = h;
        await saveHandle(h);
        return { ok: true, name: h.name, isNew: true };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: String(e && e.message || e) };
      }
    },

    async forget() { handle = null; try { await TIM.idb.del(META_DB, META_STORE, HANDLE_KEY); } catch (e) { /* ignore */ } },

    /** Directory hint for other pickers (start next to the database). */
    startIn() { return handle || undefined; },

    // Test seam (headless E2E): inject a fake FileSystemFileHandle.
    __setHandleForTest(h) { handle = h; },
  };

  TIM.fileBackend = fileBackend;
})();
