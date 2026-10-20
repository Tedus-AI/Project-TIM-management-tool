/* TIM Management Tool — optimistic-concurrency merge for a shared JSON database file.
 *
 * Every record (schema.RECORD_KINDS: project / material / contact / released P/N) carries a `rev`. A client remembers the rev it
 * last synced (`base`). On save it re-reads the file:
 *   - disk.rev === base.rev → nobody else wrote, write our copy (fast path, handled by the store)
 *   - otherwise merge per record:
 *       untouched by us            → take disk version
 *       changed by us only         → ours (rev+1)
 *       changed by both            → keep theirs, save ours as "(衝突副本)" — nobody's work is overwritten
 *       deleted by us, unchanged   → delete
 *       deleted by us, they edited → keep theirs (report)
 *       we edited, they deleted    → keep ours (report)
 *   - images are immutable and merged by union.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const mod = factory(util, schema);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.merge = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema) {
  'use strict';

  /** Serialise with a fixed key order so `rev` sits in the first bytes (cheap head read) and images go last. */
  function serializeDb(db) {
    return JSON.stringify({
      schema: db.schema || schema.SCHEMA_ID,
      schema_version: db.schema_version || schema.SCHEMA_VERSION,
      rev: db.rev || 0,
      updated_at: db.updated_at || util.nowIso(),
      settings: db.settings || {},
      materials: db.materials || {},
      contacts: db.contacts || {},
      released: db.released || {},
      projects: db.projects || {},
      images: db.images || {},
    });
  }

  /** Extract `rev` from the first bytes of a serialised DB (null when absent). */
  function revFromHead(head) {
    const m = String(head || '').match(/"rev"\s*:\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function conflictSuffix() {
    const d = new Date();
    const p = n => (n < 10 ? '0' : '') + n;
    return ' (衝突副本 ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ')';
  }

  /**
   * @param disk   normalised DB read from storage now
   * @param local  our in-memory DB
   * @param base   { rev, projects:{id:rev}, materials:{id:rev}, contacts:{id:rev} } as of our last sync
   * @param taken  { projects:Set, materials:Set, contacts:Set, images:Set, settings:bool, deletedProjects:Set, deletedMaterials:Set, deletedContacts:Set }
   * @returns { merged, conflicts:[{kind, id, type, name, copyId?}] }
   *   merged references our live objects for records we write (their rev is updated in place).
   */
  function mergeForSave(disk, local, base, taken) {
    const merged = {
      schema: schema.SCHEMA_ID, schema_version: schema.SCHEMA_VERSION,
      rev: disk.rev || 0, updated_at: disk.updated_at,
      settings: taken.settings ? local.settings : (disk.settings || local.settings),
      materials: Object.assign({}, disk.materials || {}),
      contacts: Object.assign({}, disk.contacts || {}),
      released: Object.assign({}, disk.released || {}),
      projects: Object.assign({}, disk.projects || {}),
      images: Object.assign({}, disk.images || {}),
    };
    const conflicts = [];
    const nameOf = (kind, rec) => kind === 'projects' ? (rec.name || '(未命名專案)')
      : kind === 'contacts' ? (rec.name || '(未命名聯絡單位)') : kind === 'released' ? (rec.pn || '')
      : ((rec.vendor || '') + ' ' + (rec.model || '')).trim();

    schema.RECORD_KINDS.forEach(kind => {
      const dirty = taken[kind] || new Set();
      const deleted = taken[schema.DELETED_KEY[kind]] || new Set();
      const baseRevs = (base && base[kind]) || {};
      const diskRecs = disk[kind] || {};

      dirty.forEach(id => {
        const ours = local[kind] && local[kind][id];
        if (!ours) return;                      // created and deleted before this save
        const theirs = diskRecs[id];
        const baseRev = baseRevs[id];
        if (!theirs) {
          ours.rev = (baseRev || 0) + 1;
          merged[kind][id] = ours;
          if (baseRev !== undefined) conflicts.push({ kind, id, type: 'restored', name: nameOf(kind, ours) });
        } else if ((theirs.rev || 0) === (baseRev || 0)) {
          ours.rev = (theirs.rev || 0) + 1;
          merged[kind][id] = ours;
        } else {
          const copy = util.clone(ours);
          copy.id = util.uid(schema.RECORD_PREFIX[kind]);
          copy.rev = 1;
          const nk = schema.RECORD_NAME_KEY[kind];
          copy[nk] = (copy[nk] || '') + conflictSuffix();
          if (kind === 'contacts') copy.is_default = false;   // the shared default factory stays theirs
          merged[kind][copy.id] = copy;
          conflicts.push({ kind, id, copyId: copy.id, type: 'conflict', name: nameOf(kind, ours) });
        }
      });

      deleted.forEach(id => {
        const theirs = diskRecs[id];
        if (!theirs) return;
        if ((theirs.rev || 0) === (baseRevs[id] || 0)) delete merged[kind][id];
        else conflicts.push({ kind, id, type: 'delete_skipped', name: nameOf(kind, theirs) });
      });
    });

    // Images: union. Our newly added images, plus any image our written projects reference.
    (taken.images || new Set()).forEach(id => { if (local.images && local.images[id]) merged.images[id] = local.images[id]; });
    Object.values(merged.projects).forEach(p => {
      schema.projectImageIds(p).forEach(id => {
        if (!merged.images[id] && local.images && local.images[id]) merged.images[id] = local.images[id];
      });
    });
    return { merged, conflicts };
  }

  /** Revs of every record: { rev, projects:{id:rev}, materials:{id:rev}, contacts:{id:rev} }. */
  function revsOf(db) {
    const b = { rev: db.rev || 0 };
    schema.RECORD_KINDS.forEach(kind => {
      b[kind] = {};
      Object.values(db[kind] || {}).forEach(r => { b[kind][r.id] = r.rev || 0; });
    });
    return b;
  }

  /**
   * Push the records changed in another copy of the database (a local folder copy) into the
   * shared one, with the same rules as mergeForSave but on copies: the local copy keeps its
   * own revs, and `base` holds the shared revs the local records were based on.
   *   taken:  { projects:[ids], materials:[ids], contacts:[ids], images:[ids], settings, deletedProjects:[ids], … }
   *   copies: { projects:{ [localId]: { id, suffix } }, materials:{…}, contacts:{…} } — a local record that once
   *           conflicted keeps updating its conflict copy instead of making a new one on every push.
   * Returns { merged, conflicts, base, copies } (base / copies: to use for the next push).
   */
  function mergePush(disk, local, base, taken, copies) {
    copies = copies || {};
    const K = schema.RECORD_KINDS, D = schema.DELETED_KEY, nameKey = schema.RECORD_NAME_KEY;
    copies = K.reduce((o, kind) => { o[kind] = Object.assign({}, copies[kind]); return o; }, {});
    const view = { images: local.images || {}, settings: local.settings };
    const t = { images: new Set(taken.images || []), settings: !!taken.settings };
    const back = {};                                         // id in the shared copy → local id
    K.forEach(kind => { view[kind] = {}; t[kind] = new Set(); t[D[kind]] = new Set(); back[kind] = {}; });
    K.forEach(kind => {
      const dirty = t[kind];
      const deleted = t[D[kind]];
      (taken[kind] || []).forEach(id => {
        const rec = local[kind] && local[kind][id];
        if (!rec) return;
        const v = util.clone(rec);
        const c = copies[kind][id];
        if (c) { v.id = c.id; v[nameKey[kind]] = (v[nameKey[kind]] || '') + c.suffix; }
        view[kind][v.id] = v;
        dirty.add(v.id);
        back[kind][v.id] = id;
      });
      (taken[D[kind]] || []).forEach(id => {
        const c = copies[kind][id];
        deleted.add(c ? c.id : id);
        delete copies[kind][id];
      });
    });
    const r = mergeForSave(disk, view, base, t);
    r.conflicts.forEach(c => {
      if (c.type !== 'conflict') return;
      const localId = back[c.kind][c.id];
      const copy = r.merged[c.kind][c.copyId];
      if (!localId || !copy) return;
      const own = String(local[c.kind][localId][nameKey[c.kind]] || '');
      const full = String(copy[nameKey[c.kind]] || '');
      copies[c.kind][localId] = { id: c.copyId, suffix: full.startsWith(own) ? full.slice(own.length) : '' };
    });
    r.merged.rev = (disk.rev || 0) + 1;
    r.merged.updated_at = util.nowIso();
    return { merged: r.merged, conflicts: r.conflicts, base: revsOf(r.merged), copies };
  }

  /** Remove images no project references (keep ids in `keep`, e.g. referenced by undo history). */
  function pruneImages(db, keep) {
    const used = new Set(keep ? Array.from(keep) : []);
    Object.values(db.projects || {}).forEach(p => schema.projectImageIds(p).forEach(id => used.add(id)));
    const removed = [];
    Object.keys(db.images || {}).forEach(id => { if (!used.has(id)) { delete db.images[id]; removed.push(id); } });
    return removed;
  }

  /** Image ids mentioned inside JSON snapshot strings (undo / redo history). */
  function imageIdsInText(text, into) {
    const re = /"image_id"\s*:\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) into.add(m[1]);
    return into;
  }

  return { serializeDb, revFromHead, mergeForSave, mergePush, revsOf, pruneImages, imageIdsInText };
});
