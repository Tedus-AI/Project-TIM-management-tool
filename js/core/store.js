/* TIM Management Tool — application store: single source of truth, undo/redo,
 * change log, dirty tracking, autosave with optimistic-concurrency merge.
 * No DOM access; the storage backend is injected ({ kind, label(), head(), read(), write(text) }).
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const merge = isNode ? require('./merge.js') : root.TIM.merge;
  const mod = factory(util, schema, merge);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.storeLib = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema, merge) {
  'use strict';

  const UNDO_MAX = 80;
  const COALESCE_MS = 2500;        // consecutive edits of the same field → one undo step
  const LOG_COALESCE_MS = 90 * 1000; // … and one change-log entry
  const LOG_MAX = 5000;

  function createStore(opts) {
    opts = opts || {};
    const S = {
      db: null,
      backend: null,
      readonly: false,
      readonlyReason: '',
      status: { state: 'idle', at: null, error: '' },
      conflicts: [],
      version: 0,
      saveDelay: opts.saveDelay == null ? 800 : opts.saveDelay,
    };
    let base = { rev: 0, projects: {}, materials: {} };
    let dirty = freshDirty();
    const undo = {}, redo = {};
    let lastMut = { scope: null, key: null, at: 0 };
    const listeners = new Set();
    let userFn = () => '';
    let saveTimer = null, saving = null, saveAgain = false;

    function freshDirty() {
      return { projects: new Set(), materials: new Set(), images: new Set(), settings: false, deletedProjects: new Set(), deletedMaterials: new Set() };
    }
    function hasDirty() {
      return dirty.projects.size || dirty.materials.size || dirty.images.size || dirty.settings ||
        dirty.deletedProjects.size || dirty.deletedMaterials.size;
    }

    function emit() {
      S.version++;
      listeners.forEach(fn => { try { fn(S); } catch (e) { console.error(e); } });
    }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    function setStatus(state, error) {
      S.status = { state, at: util.nowIso(), error: error || '' };
    }
    function user() { try { return userFn() || ''; } catch (e) { return ''; } }
    function setUser(fn) { userFn = typeof fn === 'function' ? fn : () => fn; }

    function syncBaseFromDb() {
      base = { rev: S.db.rev || 0, projects: {}, materials: {} };
      Object.values(S.db.projects).forEach(p => { base.projects[p.id] = p.rev || 0; });
      Object.values(S.db.materials).forEach(m => { base.materials[m.id] = m.rev || 0; });
    }

    /** Attach a freshly opened DB. opts.readonly + reason for corrupt / foreign files. */
    function attach(backend, db, o) {
      o = o || {};
      S.backend = backend;
      S.db = db;
      S.readonly = !!o.readonly;
      S.readonlyReason = o.reason || '';
      S.conflicts = [];
      dirty = freshDirty();
      Object.keys(undo).forEach(k => delete undo[k]);
      Object.keys(redo).forEach(k => delete redo[k]);
      lastMut = { scope: null, key: null, at: 0 };
      if (db) syncBaseFromDb();
      setStatus(S.readonly ? 'readonly' : 'saved');
      emit();
    }

    function detach() {
      clearTimeout(saveTimer);
      S.backend = null; S.db = null; S.readonly = false; S.readonlyReason = '';
      dirty = freshDirty();
      setStatus('idle');
      emit();
    }

    // ───────────── undo / redo ─────────────
    function scopeSnapshot(scope) {
      if (scope === 'lib') return JSON.stringify(S.db.materials);
      const pid = scope.slice(2);
      const p = S.db.projects[pid];
      return p ? JSON.stringify(p) : null;
    }
    function pushUndo(scope, coalesceKey) {
      const now = Date.now();
      const same = coalesceKey && lastMut.scope === scope && lastMut.key === coalesceKey && (now - lastMut.at) < COALESCE_MS;
      lastMut = { scope, key: coalesceKey || null, at: now };
      if (same) return;
      const snap = scopeSnapshot(scope);
      if (snap === null) return;
      (undo[scope] = undo[scope] || []).push(snap);
      if (undo[scope].length > UNDO_MAX) undo[scope].shift();
      redo[scope] = [];
    }
    function restoreScope(scope, snap) {
      if (scope === 'lib') {
        const before = S.db.materials;
        const after = JSON.parse(snap);
        Object.keys(before).forEach(id => { if (!after[id]) { dirty.deletedMaterials.add(id); dirty.materials.delete(id); } });
        Object.keys(after).forEach(id => {
          if (JSON.stringify(before[id]) !== JSON.stringify(after[id])) dirty.materials.add(id);
          dirty.deletedMaterials.delete(id);
        });
        S.db.materials = after;
      } else {
        const pid = scope.slice(2);
        S.db.projects[pid] = JSON.parse(snap);
        dirty.projects.add(pid);
      }
    }
    function canUndo(scope) { return !S.readonly && !!(undo[scope] && undo[scope].length); }
    function canRedo(scope) { return !S.readonly && !!(redo[scope] && redo[scope].length); }
    function doUndo(scope) {
      if (!canUndo(scope)) return false;
      const cur = scopeSnapshot(scope);
      (redo[scope] = redo[scope] || []).push(cur);
      restoreScope(scope, undo[scope].pop());
      lastMut = { scope: null, key: null, at: 0 };
      changed();
      return true;
    }
    function doRedo(scope) {
      if (!canRedo(scope)) return false;
      const cur = scopeSnapshot(scope);
      (undo[scope] = undo[scope] || []).push(cur);
      restoreScope(scope, redo[scope].pop());
      lastMut = { scope: null, key: null, at: 0 };
      changed();
      return true;
    }
    function clearHistory(scope) { delete undo[scope]; delete redo[scope]; }

    // ───────────── change log ─────────────
    function appendChangelog(p, changes) {
      const who = user();
      const now = Date.now();
      p.changelog = p.changelog || [];
      changes.forEach(c => {
        const entry = {
          id: util.uid('chg'), ts: new Date(now).toISOString(), user: who,
          kind: c.kind || 'edit', target: c.target || 'item', target_id: c.target_id || null,
          item_no: c.item_no || '', field: c.field || '', from: c.from === undefined ? '' : util.displayValue(c.from),
          to: c.to === undefined ? '' : util.displayValue(c.to), text: c.text || '', ecn: c.ecn || '',
        };
        const last = p.changelog[p.changelog.length - 1];
        if (entry.kind === 'edit' && last && last.kind === 'edit' && last.user === who && last.target_id === entry.target_id &&
            last.field === entry.field && (now - new Date(last.ts).getTime()) < LOG_COALESCE_MS) {
          last.to = entry.to;
          last.ts = entry.ts;
          if (entry.item_no) last.item_no = entry.item_no;
          if (last.from === last.to) p.changelog.pop();   // edited back to the original value
          return;
        }
        if (entry.kind === 'edit' && entry.from === entry.to) return;
        p.changelog.push(entry);
      });
      if (p.changelog.length > LOG_MAX) p.changelog.splice(0, p.changelog.length - LOG_MAX);
    }

    // ───────────── mutations ─────────────
    function guard() {
      if (!S.db) return false;
      if (S.readonly) return false;
      return true;
    }

    /**
     * Mutate one project. fn(project) edits in place.
     * o.coalesce: key — consecutive same-key edits share one undo step.
     * o.changes:  [{kind, target, target_id, item_no, field, from, to, text}] — appended to the change log.
     * o.noUndo:   skip the undo snapshot.
     */
    function mutateProject(pid, fn, o) {
      o = o || {};
      if (!guard()) return false;
      const p = S.db.projects[pid];
      if (!p) return false;
      if (!o.noUndo) pushUndo('p:' + pid, o.coalesce);
      const r = fn(p);
      if (r === false) return false;
      if (o.changes && o.changes.length) appendChangelog(p, o.changes);
      p.updated_at = util.nowIso();
      p.updated_by = user();
      dirty.projects.add(pid);
      if (o.images) o.images.forEach(id => dirty.images.add(id));
      changed();
      return true;
    }

    /** Mutate the material library (undo scope 'lib'). o.touched: ids changed, o.deleted: ids removed. */
    function mutateMaterials(fn, o) {
      o = o || {};
      if (!guard()) return false;
      if (!o.noUndo) pushUndo('lib', o.coalesce);
      const r = fn(S.db.materials);
      if (r === false) return false;
      const now = util.nowIso();
      (o.touched || []).forEach(id => {
        if (S.db.materials[id]) { S.db.materials[id].updated_at = now; dirty.materials.add(id); dirty.deletedMaterials.delete(id); }
      });
      (o.deleted || []).forEach(id => { dirty.deletedMaterials.add(id); dirty.materials.delete(id); });
      changed();
      return true;
    }

    /**
     * Structural DB change without undo (create / delete project, settings, cascades).
     * o: { projects:[ids touched], deletedProjects:[ids], materials:[ids], deletedMaterials:[ids], images:[ids], settings:bool }
     */
    function mutateDb(fn, o) {
      o = o || {};
      if (!guard()) return false;
      const r = fn(S.db);
      if (r === false) return false;
      (o.projects || []).forEach(id => { dirty.projects.add(id); dirty.deletedProjects.delete(id); });
      (o.deletedProjects || []).forEach(id => { dirty.deletedProjects.add(id); dirty.projects.delete(id); clearHistory('p:' + id); });
      (o.materials || []).forEach(id => { dirty.materials.add(id); dirty.deletedMaterials.delete(id); });
      (o.deletedMaterials || []).forEach(id => { dirty.deletedMaterials.add(id); dirty.materials.delete(id); });
      (o.images || []).forEach(id => dirty.images.add(id));
      if (o.settings) dirty.settings = true;
      if (o.clearHistory) o.clearHistory.forEach(clearHistory);
      changed();
      return true;
    }

    /** Store an image record { data, w, h, name } and return its id. */
    function addImage(img) {
      const id = util.uid('img');
      S.db.images[id] = { data: img.data, w: img.w || 0, h: img.h || 0, name: img.name || '', bytes: img.bytes || (img.data ? img.data.length : 0) };
      dirty.images.add(id);
      return id;
    }

    function changed() {
      setStatus('dirty');
      emit();
      scheduleSave();
    }

    // ───────────── saving ─────────────
    function scheduleSave(delay) {
      if (!S.backend || S.readonly) return;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => { saveNow(); }, delay == null ? S.saveDelay : delay);
    }

    function keepImageIds() {
      const keep = new Set();
      Object.keys(undo).concat(Object.keys(redo)).forEach(scope => {
        (undo[scope] || []).concat(redo[scope] || []).forEach(snap => merge.imageIdsInText(snap, keep));
      });
      return keep;
    }

    function takeDirty() { const t = dirty; dirty = freshDirty(); return t; }
    function restoreDirty(t) {
      t.projects.forEach(id => { if (!dirty.deletedProjects.has(id)) dirty.projects.add(id); });
      t.materials.forEach(id => { if (!dirty.deletedMaterials.has(id)) dirty.materials.add(id); });
      t.images.forEach(id => dirty.images.add(id));
      if (t.settings) dirty.settings = true;
      t.deletedProjects.forEach(id => { if (!dirty.projects.has(id)) dirty.deletedProjects.add(id); });
      t.deletedMaterials.forEach(id => { if (!dirty.materials.has(id)) dirty.deletedMaterials.add(id); });
    }

    /** Read + validate the stored DB. Returns null for an empty file. Throws Error with .corrupt = true when unusable. */
    async function readDisk() {
      const text = await S.backend.read();
      if (!text || !String(text).trim()) return null;
      let obj;
      try { obj = JSON.parse(text); } catch (e) {
        const err = new Error('資料庫檔案 JSON 格式損毀，已切換為唯讀以保護資料'); err.corrupt = true; throw err;
      }
      const v = schema.validateDb(obj);
      if (!v.ok) { const err = new Error(v.error); err.corrupt = true; throw err; }
      return schema.normalizeDb(obj);
    }

    // Set when a remote change could not be adopted because the same record was edited
    // locally meanwhile; the next save must then take the merge path (never the fast path).
    let forceMerge = false;
    // Network storage (SharePoint): a write rejected because the file changed since we read it
    // (HTTP 412, error.conflict) is retried at once through the merge path, a few times in a row.
    let conflictStreak = 0;
    const CONFLICT_RETRIES = 4;
    // A write that failed in a way that may still have reached the server (timeout, dropped
    // connection; error.uncertain): { updated_at, base }. If the next head shows that stamp + rev,
    // the write did land — sync from its revs, so our own edits are not reported as conflicts.
    let unsure = null;
    const stampOf = head => { const m = String(head || '').match(/"updated_at"\s*:\s*"([^"]+)"/); return m ? m[1] : null; };
    function revsOf(db) {
      const b = { rev: db.rev, projects: {}, materials: {} };
      Object.values(db.projects).forEach(p => { b.projects[p.id] = p.rev || 0; });
      Object.values(db.materials).forEach(m => { b.materials[m.id] = m.rev || 0; });
      return b;
    }
    /** Head just read: settle a pending uncertain write. */
    function settleUnsure(head) {
      if (!unsure) return;
      if (stampOf(head) === unsure.updated_at && merge.revFromHead(head) === unsure.base.rev) { base = unsure.base; forceMerge = true; }
      unsure = null;
    }

    /**
     * Adopt remote records after a merge / reload (keeps records edited meanwhile).
     * Returns the ids whose remote version was skipped: { projects:Set, materials:Set }.
     */
    function adopt(merged, conflicts) {
      const db = S.db;
      const skipped = { projects: new Set(), materials: new Set() };
      ['projects', 'materials'].forEach(kind => {
        const dirtyNow = dirty[kind];
        const deletedNow = kind === 'projects' ? dirty.deletedProjects : dirty.deletedMaterials;
        Object.keys(merged[kind]).forEach(id => {
          if (db[kind][id] === merged[kind][id]) return;
          if (dirtyNow.has(id) || deletedNow.has(id)) {
            if (db[kind][id] && (merged[kind][id].rev || 0) !== (base[kind][id] || 0)) skipped[kind].add(id);
            return;
          }
          db[kind][id] = merged[kind][id];
          if (kind === 'projects') clearHistory('p:' + id);
        });
        Object.keys(db[kind]).forEach(id => {
          if (!merged[kind][id] && !dirtyNow.has(id)) { delete db[kind][id]; if (kind === 'projects') clearHistory('p:' + id); }
        });
      });
      const imgs = merged.images;
      dirty.images.forEach(id => { if (db.images[id]) imgs[id] = db.images[id]; });
      db.images = imgs;
      if (!dirty.settings) db.settings = merged.settings;
      if (conflicts && conflicts.length) S.conflicts = S.conflicts.concat(conflicts.map(c => Object.assign({ at: util.nowIso() }, c)));
      return skipped;
    }

    /** Remember the revs we are now in sync with. Skipped records keep their old base rev. */
    function recordBase(merged, skipped) {
      const old = base;
      base = { rev: merged.rev, projects: {}, materials: {} };
      Object.values(merged.projects).forEach(p => { base.projects[p.id] = p.rev || 0; });
      Object.values(merged.materials).forEach(m => { base.materials[m.id] = m.rev || 0; });
      if (skipped) {
        ['projects', 'materials'].forEach(kind => skipped[kind].forEach(id => {
          if (old[kind][id] === undefined) delete base[kind][id]; else base[kind][id] = old[kind][id];
          forceMerge = true;
        }));
      }
    }

    async function saveNow() {
      clearTimeout(saveTimer);
      if (!S.backend || S.readonly || !S.db) return;
      if (saving) { saveAgain = true; return saving; }
      if (!hasDirty()) { if (S.status.state === 'dirty') { setStatus('saved'); emit(); } return; }
      setStatus('saving'); emit();
      const t = takeDirty();
      let attempt = null;
      saving = (async () => {
        try {
          const head = String(await S.backend.head() || '');
          settleUnsure(head);
          const headRev = merge.revFromHead(head);
          const looksTim = /"schema"\s*:\s*"tim-db"/.test(head);
          let mergedDb, conflicts = [], fast = false;
          let disk = null;
          if (!head.trim()) {
            fast = true;   // empty file (new, or emptied by someone) → write our full copy
            if (base.rev > 0) conflicts.push({ kind: 'db', type: 'rewritten', name: '資料庫檔案為空，已用目前資料重新寫入' });
          } else if (looksTim && headRev === base.rev && !forceMerge) {
            fast = true;   // nobody else wrote since our last sync
          } else {
            disk = await readDisk();   // throws .corrupt for foreign / broken files
            if (!disk) fast = true;
          }
          if (fast) {
            t.projects.forEach(id => { const p = S.db.projects[id]; if (p) p.rev = (base.projects[id] || 0) + 1; });
            t.materials.forEach(id => { const m = S.db.materials[id]; if (m) m.rev = (base.materials[id] || 0) + 1; });
            mergedDb = S.db;
            mergedDb.rev = Math.max(base.rev, headRev || 0) + 1;
          } else {
            const r = merge.mergeForSave(disk, S.db, base, t);
            mergedDb = r.merged; conflicts = conflicts.concat(r.conflicts);
            mergedDb.rev = (disk.rev || 0) + 1;
          }
          mergedDb.updated_at = util.nowIso();
          merge.pruneImages(mergedDb, keepImageIds());
          attempt = { updated_at: mergedDb.updated_at, base: revsOf(mergedDb) };
          await S.backend.write(merge.serializeDb(mergedDb));
          forceMerge = false;
          conflictStreak = 0;
          let skipped = null;
          if (mergedDb !== S.db) {
            skipped = adopt(mergedDb, conflicts);
            S.db.rev = mergedDb.rev; S.db.updated_at = mergedDb.updated_at;
          } else if (conflicts.length) {
            S.conflicts = S.conflicts.concat(conflicts.map(c => Object.assign({ at: util.nowIso() }, c)));
          }
          recordBase(mergedDb, skipped);
          setStatus(hasDirty() ? 'dirty' : 'saved');
        } catch (e) {
          if (e && e.corrupt) {
            S.readonly = true; S.readonlyReason = e.message;
            setStatus('readonly', e.message);
            console.warn('[store] database became unreadable — switched to read-only:', e.message);
          } else if (e && e.conflict && conflictStreak < CONFLICT_RETRIES) {
            // someone saved between our read and our write → re-read, merge, write again
            conflictStreak++;
            restoreDirty(t);
            forceMerge = true;
            saveAgain = true;
            setStatus('dirty');
          } else {
            restoreDirty(t);
            if (e && e.conflict) forceMerge = true;
            if (e && e.uncertain && attempt) unsure = attempt;
            conflictStreak = 0;
            setStatus('error', (e && e.message) || String(e));
            console.error('[store] save failed', e);
          }
        }
      })();
      try { await saving; } finally {
        saving = null;
        emit();
        if (!S.readonly && (saveAgain || hasDirty())) {
          saveAgain = false;
          scheduleSave(S.status.state === 'error' ? 5000 : 0);
        }
      }
    }

    /** Wait until pending changes are written (used before export / navigation away). */
    async function flush() {
      if (saving) await saving;
      if (hasDirty()) await saveNow();
      if (saving) await saving;
    }

    /**
     * Pull in other users' changes. When nothing is dirty locally, reload records whose rev
     * changed; otherwise run a save (which merges). Returns true when something changed.
     */
    async function syncCheck() {
      if (!S.backend || !S.db || saving) return false;
      let head;
      try { head = String(await S.backend.head() || ''); } catch (e) { return false; }
      if (saving) return false;
      settleUnsure(head);
      const headRev = merge.revFromHead(head);
      if (!head.trim() || (headRev === base.rev && !forceMerge)) return false;
      if (S.readonly) return false;
      if (hasDirty()) { await saveNow(); return true; }
      try {
        const disk = await readDisk();
        if (!disk || saving) return false;
        const skipped = adopt(disk, []);
        S.db.rev = disk.rev; S.db.updated_at = disk.updated_at;
        forceMerge = false;          // in sync with the disk now (recordBase re-arms it for skipped records)
        recordBase(disk, skipped);
        setStatus(hasDirty() ? 'dirty' : 'saved');
        emit();
        return true;
      } catch (e) {
        if (e && e.corrupt) { S.readonly = true; S.readonlyReason = e.message; setStatus('readonly', e.message); emit(); }
        return false;
      }
    }

    function dismissConflicts() { S.conflicts = []; emit(); }

    function hasUnsaved() { return !!(hasDirty() || saving); }

    return Object.assign(S, {
      subscribe, emit, attach, detach, setUser, user,
      mutateProject, mutateMaterials, mutateDb, addImage,
      undo: doUndo, redo: doRedo, canUndo, canRedo, clearHistory,
      saveNow, scheduleSave, flush, syncCheck, hasUnsaved, dismissConflicts,
      _debug: () => ({ base, dirty, undo, redo }),
    });
  }

  return { createStore };
});
