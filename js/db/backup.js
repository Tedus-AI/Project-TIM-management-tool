/* Automatic backups — the same layout for the SharePoint database and a local folder:
 *
 *   <database folder>/Backup/tim_db_backup_YYYY-MM-DD_HHmm.json
 *
 * Two are kept (util.backupsToPrune): today's — replaced by every backup, so its name shows the time
 * of the latest one — and the last one of the previous day that has a backup. Older ones are deleted.
 * Destinations ("targets", set by app.initBackup):
 *   SharePoint database  → TIM_Manager/Database/Backup, and the local copy folder's Backup (sync.mirror)
 *   local folder         → <that folder>/Backup
 *   a database file picked directly (older versions) → a folder the user picks (no sub-folder)
 * Web pages cannot run while closed, so backups happen on open, every 3 h and when the tab is hidden
 * (each destination at most every 10 min); a destination that becomes writable later (the local copy
 * after its permission is granted) gets its first backup right away (kick).
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const META_DB = 'tim-mgmt-meta', META_STORE = 'handles', DIR_KEY = 'backup_dir';
  const FOLDER = 'Backup';
  const MIN_GAP = 10 * 60 * 1000;
  let targets = [];          // [{ name(), ready(), write(text, file), lastAt, file, error }]
  let picked = null;         // folder picked for a directly opened database file
  let getText = null;        // async () => database text (set by schedule)
  let timer = null, hooked = false, busy = null;
  const errText = e => String((e && e.message) || e);

  /** Write a backup into `root` (or root/Backup when sub) and delete the ones no longer kept. */
  async function writeToFolder(root, text, file, sub) {
    const dir = sub ? await root.getDirectoryHandle(FOLDER, { create: true }) : root;
    const w = await (await dir.getFileHandle(file, { create: true })).createWritable();
    await w.write(text);
    await w.close();
    const names = [];
    for await (const [n, h] of dir.entries()) if (h.kind === 'file') names.push(n);
    for (const n of TIM.util.backupsToPrune(names)) { try { await dir.removeEntry(n); } catch (e) { /* next time */ } }
  }

  /** Destination: <dir()>/Backup of a database folder. dir: () => folder handle or null; label: shown name. */
  function folderTarget(dir, label) {
    return {
      name: () => (label ? label() : dir() ? dir().name : '') + ' / ' + FOLDER,
      ready: () => !!dir(),
      write: (text, file) => writeToFolder(dir(), text, file, true),
    };
  }

  const backup = {
    supported() { return typeof window.showDirectoryPicker === 'function'; },
    folderTarget,
    /** Write a backup into <root>/Backup (and delete the ones no longer kept). */
    writeFolder: (root, text, file) => writeToFolder(root, text, file, true),
    /** Destinations for the open database (replaces the previous ones). */
    use(list) {
      targets = (list || []).filter(Boolean).map(t => Object.assign({ lastAt: 0, file: '', error: '' }, t));
    },
    targets() { return targets; },
    name() { return targets.map(t => t.name()).filter(Boolean).join('、'); },
    ready() { return targets.some(t => t.ready()); },
    lastAt() { return targets.reduce((m, t) => Math.max(m, t.lastAt), 0); },

    // ───── a database file picked directly (no folder): backups go to a folder the user picks ─────
    /** That folder, as a destination (written into directly, as older versions did). */
    pickedTarget() {
      return {
        name: () => (picked ? picked.name : ''),
        ready: () => !!picked,
        async write(text, file) {
          if (await picked.queryPermission({ mode: 'readwrite' }) !== 'granted') throw Object.assign(new Error('備份資料夾需要重新授權'), { needsPermission: true });
          await writeToFolder(picked, text, file, false);
        },
      };
    },
    async tryRestore() {
      let h = null;
      try { h = await TIM.idb.get(META_DB, META_STORE, DIR_KEY); } catch (e) { /* none */ }
      if (!h) return { ok: false, reason: 'none' };
      try {
        const st = await h.queryPermission({ mode: 'readwrite' });
        if (st === 'granted') { picked = h; return { ok: true, name: h.name }; }
        return { ok: false, needsPermission: true, name: h.name };
      } catch (e) { return { ok: false, reason: 'error' }; }
    },
    /** Pick (or re-grant) that folder — call from a click handler. */
    async pick(startIn) {
      try {
        let h = null;
        try { h = await TIM.idb.get(META_DB, META_STORE, DIR_KEY); } catch (e) { /* none */ }
        if (h && !picked) {
          const st = await h.requestPermission({ mode: 'readwrite' });
          if (st === 'granted') { picked = h; return { ok: true, name: h.name }; }
        }
        const opts = { mode: 'readwrite' };
        if (startIn) opts.startIn = startIn;
        h = await window.showDirectoryPicker(opts);
        picked = h;
        try { await TIM.idb.put(META_DB, META_STORE, DIR_KEY, h); } catch (e) { /* ignore */ }
        return { ok: true, name: h.name };
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
        return { ok: false, reason: 'error', error: errText(e) };
      }
    },

    /**
     * Back up to every destination that is writable and due (force: ignore the 10-min gap;
     * only: a filter for the destinations to try). One file name (time) for all of them.
     * → { ok, name, needsPermission, results: [{ target, ok, error }] }
     */
    async run(textFn, force, only) {
      const fn = textFn || getText;
      if (!fn) return { ok: false, reason: 'no-text' };
      while (busy) await busy.catch(() => null);
      const due = targets.filter(t => t.ready() && (!only || only(t)) && (force || Date.now() - t.lastAt >= MIN_GAP));
      if (!due.length) return { ok: false, reason: targets.length ? 'throttled' : 'no-dir' };
      busy = (async () => {
        const text = await fn();
        if (!text) return { ok: false, reason: 'empty' };
        const file = TIM.util.backupFileName(new Date());
        const results = [];
        for (const t of due) {
          try { await t.write(text, file); t.lastAt = Date.now(); t.file = file; t.error = ''; results.push({ target: t.name(), ok: true }); }
          catch (e) { t.error = errText(e); results.push({ target: t.name(), ok: false, error: t.error, needsPermission: !!(e && e.needsPermission) }); console.warn('[backup] ' + t.name() + ':', t.error); }
        }
        return { ok: results.some(r => r.ok), name: file, results, needsPermission: results.some(r => r.needsPermission) };
      })();
      try { return await busy; } finally { busy = null; }
    },

    /** A destination became writable (e.g. the local copy after its permission): back up there now if it has none yet. */
    kick() { if (getText) backup.run(getText, true, t => !t.lastAt).then(r => { if (r && r.results && TIM.store && TIM.store.emit) TIM.store.emit(); }, () => null); },

    /** Start the periodic schedule (once per page; textFn / onResult are for the database open now). */
    schedule(textFn, onResult) {
      getText = textFn;
      backup.onResult = onResult || null;
      if (hooked) return;
      hooked = true;
      const tick = async () => { const r = await backup.run(getText, false); if (backup.onResult) backup.onResult(r); };
      timer = setInterval(tick, 3 * 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(); });
    },
  };

  TIM.backup = backup;
})();
