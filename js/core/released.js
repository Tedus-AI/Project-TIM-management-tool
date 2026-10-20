/* TIM Management Tool — 已發行 TIM: every TIM-list item of any project that carries a Delta P/N, one entry per
 * part number. Derived from the projects: a part number appears as soon as an item gets it. When no project uses
 * it any more (project or item deleted, P/N changed) the store archives it in db.released as it last was, so it
 * stays listed until someone removes it here. A new TIM list can add items from here; the part-number attributes
 * (material, size / dispense, vendor P/N, 2nd source, price…) come along, the project-specific ones (Location,
 * Q'ty, Used On, covered components, gaps) do not.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const calc = isNode ? require('./calc.js') : root.TIM.calc;
  const parse = isNode ? require('./parse.js') : root.TIM.parse;
  const mod = factory(util, schema, calc, parse);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.released = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema, calc, parse) {
  'use strict';

  /** "N/A", "TBD", "-"… typed in the Delta P/N column mean "no part number". */
  const PLACEHOLDER = /^(n\/?a|na|tbd|tba|none|null|nil|無|沒有|未定|待定|[-—–_/.?]+)$/i;
  function pnKey(pn) {
    const s = util.toHalfWidth(String(pn == null ? '' : pn)).trim().replace(/\s+/g, '');
    return !s || PLACEHOLDER.test(s) ? '' : s.toUpperCase();
  }
  const norm = s => util.toHalfWidth(String(s == null ? '' : s)).trim().replace(/\s+/g, ' ').toUpperCase();
  /** Part number of an archive record (a merge "(衝突副本 …)" copy counts as the same part number). */
  const archiveKey = rec => pnKey(String((rec && rec.pn) || '').replace(/\s*\(衝突副本[^)]*\)\s*$/, ''));

  /** The part's own attributes kept in an archive record (what itemFields brings into a new TIM list). */
  const PART_FIELDS = ['material_id', 'vendor', 'model', 'tim_type', 'size', 'shape_note', 'dispense', 'vendor_pn', 'fabricator',
    'drawing_no', 'sources', 'sourcing_note', 'price', 'moq', 'lead_time_wk'];

  /** key → [{ p, it, pn }]: the items of `projects` carrying a part number (live references, taken before a change). */
  function liveIndex(projects) {
    const m = new Map();
    (projects || []).forEach(p => (p && p.items || []).forEach(it => {
      const key = pnKey(it.delta_pn);
      if (!key) return;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push({ p, it, pn: String(it.delta_pn).trim() });
    }));
    return m;
  }

  /**
   * After a change: part numbers of `before` (liveIndex taken before it) that no project of `db` uses any more are
   * archived in db.released — one record per part number, refreshed when it leaves again. Returns the ids written.
   */
  function archiveVanished(db, before, who) {
    if (!db || !before || !before.size) return [];
    let gone = null;
    before.forEach((refs, key) => {
      if (refs.some(r => pnKey(r.it.delta_pn) === key && db.projects[r.p.id] === r.p && r.p.items.includes(r.it))) return;   // still there
      (gone = gone || new Map()).set(key, refs);
    });
    if (!gone) return [];
    const now = liveIndex(Object.values(db.projects || {}));
    db.released = db.released || {};
    const at = util.nowIso(), ids = [];
    gone.forEach((refs, key) => {
      if (now.has(key)) return;
      refs = refs.slice().sort((a, b) => String(b.p.updated_at || '').localeCompare(String(a.p.updated_at || '')));
      const { it, pn } = refs[0];
      const mat = calc.materialOf(db, it);
      const eff = calc.effective(it, mat);
      const item = {};
      PART_FIELDS.forEach(f => { if (it[f] !== undefined) item[f] = util.clone(it[f]); });
      Object.assign(item, { vendor: eff.vendor || '', model: eff.model || '', tim_type: eff.tim_type || it.tim_type });
      const uses = refs.map(({ p, it: x }) => ({
        project: p.name || '', stage: p.stage || '', item_no: x.item_no || '', qty: x.qty == null ? null : x.qty,
        location: ((p.locations || []).find(l => l.id === x.location_id) || {}).name || '',
      }));
      let rec = Object.values(db.released).find(r => archiveKey(r) === key);
      if (!rec) { rec = schema.normalizeReleased({ created_at: at }); db.released[rec.id] = rec; }
      Object.assign(rec, { pn, item, k: eff.k, uses, archived_by: who || '', updated_at: at });
      ids.push(rec.id);
    });
    return ids;
  }

  /** What the part is: material + size / dispense amount (different specs under one P/N are flagged). */
  function specText(it, eff) {
    const shape = schema.isDispense(eff.tim_type)
      ? (it.dispense && it.dispense.amount != null ? util.fmt(it.dispense.amount, 3) + ' ' + (it.dispense.unit || 'g') : '')
      : parse.formatSize(it.size);
    return [eff.vendor, eff.model, shape].filter(Boolean).join(' · ');
  }

  /**
   * All released part numbers. Attributes come from the most recently updated project using it.
   * → [{ key, pn, item, eff, mat, spec, uses: [{ pid, project, stage, item_id, item_no, qty, location }],
   *      specs: [{ text, n }] (more than one = the P/N is used with different specs), updated_at,
   *      archived (the db.released record when no project uses it: uses = [], archived.uses = where it was) }] sorted by P/N
   */
  function parts(db) {
    const map = new Map();
    Object.values((db && db.projects) || {}).slice()
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .forEach(p => {
        const locs = {};
        (p.locations || []).forEach(l => { locs[l.id] = l.name; });
        (p.items || []).forEach(it => {
          const key = pnKey(it.delta_pn);
          if (!key) return;
          const mat = calc.materialOf(db, it);
          const eff = calc.effective(it, mat);
          let e = map.get(key);
          if (!e) {
            e = { key, pn: String(it.delta_pn).trim(), item: it, eff, mat, spec: specText(it, eff), uses: [], specs: [], updated_at: p.updated_at || '' };
            map.set(key, e);
          }
          e.uses.push({ pid: p.id, project: p.name || '', stage: p.stage || '', item_id: it.id, item_no: it.item_no || '', qty: it.qty, location: locs[it.location_id] || '', status: it.status });
          const text = specText(it, eff);
          const s = e.specs.find(x => norm(x.text) === norm(text));
          if (s) s.n++; else e.specs.push({ text, n: 1 });
        });
      });
    // archived: no project uses them any more (the newest record per part number)
    Object.values((db && db.released) || {}).slice()
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .forEach(rec => {
        const key = archiveKey(rec);
        if (!key || map.has(key)) return;
        const item = rec.item || {};
        const mat = calc.materialOf(db, item);
        const eff = mat ? calc.effective(item, mat) : { vendor: item.vendor, model: item.model, tim_type: item.tim_type, k: rec.k, linked: false };
        const spec = specText(item, eff);
        map.set(key, { key, pn: rec.pn, item, eff, mat, spec, uses: [], specs: [{ text: spec, n: 1 }], updated_at: rec.updated_at || '', archived: rec });
      });
    return Array.from(map.values()).sort((a, b) => util.naturalCompare(a.pn, b.pn));
  }

  /** Archive records of a part number (to remove it from 已發行 TIM once no project uses it). */
  function archivedIds(db, key) {
    return Object.values((db && db.released) || {}).filter(r => archiveKey(r) === key).map(r => r.id);
  }

  /** Search over P/N, vendor, model, spec, Vendor P/N and the projects using it. */
  function matches(e, q) {
    const terms = norm(q).split(' ').filter(Boolean);
    if (!terms.length) return true;
    const hay = norm([e.pn, e.eff.vendor, e.eff.model, e.spec, e.item.vendor_pn, schema.timType(e.eff.tim_type).label,
      e.uses.concat(e.archived ? e.archived.uses : []).map(u => u.project + ' ' + u.item_no).join(' ')].join(' '));
    return terms.every(t => hay.includes(t));
  }

  /** Fields of a new TIM-list item made from a released part (the part's own attributes only). */
  function itemFields(e, db) {
    const it = e.item;
    const linked = it.material_id && db && db.materials && db.materials[it.material_id];
    const f = util.clone({
      delta_pn: e.pn,
      material_id: linked ? it.material_id : null,
      vendor: linked ? db.materials[it.material_id].vendor : it.vendor,
      model: linked ? db.materials[it.material_id].model : it.model,
      tim_type: e.eff.tim_type || it.tim_type,
      size: it.size, shape_note: it.shape_note, dispense: it.dispense,
      vendor_pn: it.vendor_pn, fabricator: it.fabricator, drawing_no: it.drawing_no,
      sources: it.sources, sourcing_note: it.sourcing_note,
      price: it.price, moq: it.moq, lead_time_wk: it.lead_time_wk,
    });
    f.sources = (f.sources || []).map(s => Object.assign(s, { id: util.uid('src') }));
    return f;
  }

  return { pnKey, parts, matches, itemFields, specText, liveIndex, archiveVanished, archivedIds, archiveKey };
});
