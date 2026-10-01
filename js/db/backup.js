/* Automatic daily backup into a user-chosen folder (same behaviour as the Thermal Test
 * Report Builder): one file per day (overwritten with the latest state), newest 30 kept.
 * Web pages cannot run while closed, so "daily" = on open (catch-up) + every 3 h +
 * when the tab is hidden (throttled to 10 min).
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const META_DB = 'tim-mgmt-meta', META_STORE = 'handles', DIR_KEY = 'backup_dir';
  const PREFIX = 'tim_db_backup_';
  const KEEP = 30;
  let dir = null;
  let lastAt = 0;
  let timer = null;

  /** Names to delete so only the newest `keep` backups remain (YYYY-MM-DD sorts by time). */
  function toPrune(names, keep) {
    const b = names.filter(n => n.startsWith(PREFIX) && n.endsWith('.json')).sort();
    return b.length > keep ? b.slice(0, b.length - keep) : [];
  }

  const backup = {
    supported() { return typeof window.showDirectoryPicker === 'function'; },
    name() { return dir ? dir.name : ''; },
    ready() { return !!dir; },
    toPrune,

    async tryRestore() {
      let h = null;
      try { h = await TIM.idb.get(META_DB, META_STORE, DIR_KEY); } catch (e) { /* none */ }
      if (!h) return { ok: false, reason: 'none' };
      try {
        const st = await h.queryPermission({ mode: 'readwrite' });
        if (st === 'granted') { dir = h; return { ok: true, name: h.name }; }
        return { ok: false, needsPermission: true, name: h.name };
      } catch (e) { return { ok: false, reason: 'error' }; }
    },

    /** Pick (or re-grant) the backup folder — call from a click handler. */
    async pick(startIn) {
      try {
        let h = null;
        try { h = await TIM.idb.get(META_DB, META_STORE, DIR_KEY); } catch (e) { /* none */ }
        if (h && !dir) {
          const st = await h.requestPermission({ mode: 'readwrite' });
          if (st === 'granted') { dir = h; return { ok: true, name: h.name }; }
        }
        const opts = { mode: 'readwrite' };
        if (startIn) opts.startIn = startIn;
        h = await window.showDirectoryPicker(opts);
        dir = h;
        try { await TIM.idb.put(META_DB, META_STORE, DIR_KEY, h); } catch (e) { /* ignore */ }
        return { ok: true, name: h.name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: String(e && e.message || e) };
      }
    },

    /** Write today's backup (text = full DB JSON) and prune old ones. */
    async write(text) {
      if (!dir) return { ok: false, reason: 'no-dir' };
      try {
        const st = await dir.queryPermission({ mode: 'readwrite' });
        if (st !== 'granted') return { ok: false, needsPermission: true };
        const d = new Date();
        const p = n => (n < 10 ? '0' : '') + n;
        const name = PREFIX + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
        const names = [];
        for await (const [n, h] of dir.entries()) if (h.kind === 'file') names.push(n);
        for (const n of toPrune(names, KEEP)) { try { await dir.removeEntry(n); } catch (e) { /* ignore */ } }
        lastAt = Date.now();
        return { ok: true, name };
      } catch (e) { return { ok: false, reason: 'error', error: String(e && e.message || e) }; }
    },

    /** Throttled backup using a text provider (async () => string). */
    async run(getText, force) {
      if (!dir) return { ok: false, reason: 'no-dir' };
      if (!force && Date.now() - lastAt < 10 * 60 * 1000) return { ok: false, reason: 'throttled' };
      const text = await getText();
      if (!text) return { ok: false, reason: 'empty' };
      return this.write(text);
    },

    /** Start the periodic schedule. */
    schedule(getText, onResult) {
      if (timer) return;
      timer = setInterval(async () => { const r = await backup.run(getText, false); if (onResult) onResult(r); }, 3 * 60 * 60 * 1000);
      document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'hidden') { const r = await backup.run(getText, false); if (onResult) onResult(r); }
      });
    },
    lastAt() { return lastAt; },
  };

  TIM.backup = backup;
})();
