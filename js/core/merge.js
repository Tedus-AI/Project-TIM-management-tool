/* TIM Management Tool — optimistic-concurrency merge for a shared JSON database file.
 *
 * Every record (project / material) carries a `rev`. A client remembers the rev it
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
   * @param base   { rev, projects:{id:rev}, materials:{id:rev} } as of our last sync
   * @param taken  { projects:Set, materials:Set, images:Set, settings:bool, deletedProjects:Set, deletedMaterials:Set }
   * @returns { merged, conflicts:[{kind, id, type, name, copyId?}] }
   *   merged references our live objects for records we write (their rev is updated in place).
   */
  function mergeForSave(disk, local, base, taken) {
    const merged = {
      schema: schema.SCHEMA_ID, schema_version: schema.SCHEMA_VERSION,
      rev: disk.rev || 0, updated_at: disk.updated_at,
      settings: taken.settings ? local.settings : (disk.settings || local.settings),
      materials: Object.assign({}, disk.materials || {}),
      projects: Object.assign({}, disk.projects || {}),
      images: Object.assign({}, disk.images || {}),
    };
    const conflicts = [];
    const nameOf = (kind, rec) => kind === 'projects' ? (rec.name || '(未命名專案)') : ((rec.vendor || '') + ' ' + (rec.model || '')).trim();

    ['projects', 'materials'].forEach(kind => {
      const dirty = taken[kind] || new Set();
      const deleted = kind === 'projects' ? (taken.deletedProjects || new Set()) : (taken.deletedMaterials || new Set());
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
          copy.id = util.uid(kind === 'projects' ? 'prj' : 'mat');
          copy.rev = 1;
          if (kind === 'projects') copy.name = (copy.name || '') + conflictSuffix();
          else copy.model = (copy.model || '') + conflictSuffix();
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

  return { serializeDb, revFromHead, mergeForSave, pruneImages, imageIdsInText };
});
