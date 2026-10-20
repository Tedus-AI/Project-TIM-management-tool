/* TIM Management Tool — TIM 型號目錄 (tim_catalog.json): the material library as the other thermal tools read it.
 *
 * The TIM manager is where TIM materials are created; AI-Thermal (TIM 型號庫, which 5G-RRU reads), the RRU
 * Thermal Network Visualizer and the Thermal Test Report Builder follow it. They read this small file next to
 * tim_db.json on SharePoint (TIM_Manager/Database/tim_catalog.json) instead of the whole database (images…),
 * link their entries by `id` and keep their own copy of the values, so they still work offline. Written by the
 * tool after a save that changed materials (db/catalog.js); never edited by hand or by another tool.
 *
 * Only material properties go out — no projects, part numbers, prices or sourcing. Application values (the
 * compressed / bond-line thickness a calculation uses) stay in each tool: they depend on the design.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const mod = factory(util, schema);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.catalog = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema) {
  'use strict';

  const FORMAT = 'tim-catalog';
  const VERSION = 1;
  const FILE = 'tim_catalog.json';

  /**
   * The three TIM families the calculation tools use (AI-Thermal / 5G-RRU timType, Report Builder tabs).
   * `exact: false` — the type has no natural family (sheet-like phase change, graphite, tape, other): the
   * consumer shows the guess and lets the engineer pick.
   */
  const FAMILY = {
    pad: { family: 'Pad', exact: true }, absorber: { family: 'Pad', exact: true },
    gap_filler: { family: 'Putty', exact: true }, gel: { family: 'Putty', exact: true }, putty: { family: 'Putty', exact: true },
    grease: { family: 'Grease', exact: true },
    pcm: { family: 'Grease', exact: false }, graphite: { family: 'Pad', exact: false },
    tape: { family: 'Pad', exact: false }, other: { family: 'Pad', exact: false },
  };
  const familyOf = t => FAMILY[t] || FAMILY.other;

  const num = v => (Number.isFinite(v) ? v : null);
  const text = v => String(v == null ? '' : v).trim();

  /** One catalog entry of a library material. */
  function entryOf(m) {
    const t = schema.timType(m.tim_type);
    const f = familyOf(m.tim_type);
    const parts = schema.hasParts(m.tim_type) ? (schema.PARTS.find(p => p.v === m.parts) || {}).label || '' : '';
    return {
      id: m.id,
      vendor: text(m.vendor), model: text(m.model),
      tim_type: t.v, type_label: t.label, family: f.family, family_exact: f.exact,
      parts,
      k: num(m.k), k_method: text(m.k_method),
      thickness_options: text(m.thickness_options),
      hardness: num(m.hardness), hardness_scale: num(m.hardness) === null ? '' : text(m.hardness_scale),
      temp_min: num(m.temp_min), temp_max: num(m.temp_max),
      avl_status: m.avl_status || '', avl_label: schema.labelOf(schema.AVL_STATUS, m.avl_status),
      updated_at: m.updated_at || '',
    };
  }

  /** The catalog of a database: materials with a model name, sorted by vendor / model. */
  function build(db, o) {
    o = o || {};
    const materials = Object.values((db && db.materials) || {})
      .filter(m => text(m.model))
      .map(entryOf)
      .sort((a, b) => util.naturalCompare(a.vendor + ' ' + a.model, b.vendor + ' ' + b.model));
    return {
      format: FORMAT, version: VERSION,
      note: '由 TIM Management Tool 自動產生（唯讀）。TIM 材料請在 TIM 管理工具的材料庫新增 / 修改，其他工具依 id 參照。',
      db_rev: (db && db.rev) || 0,
      updated_at: o.at || util.nowIso(),
      updated_by: o.by || '',
      materials,
    };
  }

  /** What the content is, without the time stamps: equal → nothing to publish. */
  function signature(cat) {
    return cat && Array.isArray(cat.materials) ? JSON.stringify(cat.materials) : '';
  }

  /** Read a catalog file → the object, or null when it is not one (missing, broken, another format). */
  function parse(textIn) {
    try {
      const o = JSON.parse(textIn);
      return o && o.format === FORMAT && Array.isArray(o.materials) ? o : null;
    } catch (e) { return null; }
  }

  return { FORMAT, VERSION, FILE, FAMILY, familyOf, entryOf, build, signature, parse };
});
