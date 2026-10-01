/* TIM Management Tool — data model: enums, defaults, normalisation, validation. */
(function (root, factory) {
  const util = (typeof module === 'object' && module.exports) ? require('./util.js') : root.TIM.util;
  const mod = factory(util);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.schema = mod; }
})(typeof self !== 'undefined' ? self : this, function (util) {
  'use strict';

  const SCHEMA_ID = 'tim-db';
  const SCHEMA_VERSION = 1;

  const STAGES = ['Proto', 'EVT', 'DVT', 'PVT', 'MP'];

  const PRODUCT_TYPES = [
    { v: 'sub6', label: 'Sub-6' },
    { v: 'mmwave', label: 'mmWave' },
  ];

  /** Location sets offered for new projects (Settings default and the 新增專案 dialog). */
  const LOCATION_PRESETS = [
    { v: 'both', label: 'Bottom Case + Top Case', names: ['Bottom Case', 'Top Case'] },
    { v: 'bottom', label: 'Bottom Case', names: ['Bottom Case'] },
    { v: 'top', label: 'Top Case', names: ['Top Case'] },
  ];
  /** Preset key for a list of names, or '' when it is not one of the presets. */
  function locationPresetOf(names) {
    const k = (names || []).join('|');
    const f = LOCATION_PRESETS.find(x => x.names.join('|') === k);
    return f ? f.v : '';
  }

  const PROJECT_STATUS = [
    { v: 'active', label: '進行中' },
    { v: 'on_hold', label: '暫停' },
    { v: 'closed', label: '結案' },
  ];

  const ITEM_STATUS = [
    { v: 'draft', label: '草稿' },
    { v: 'review', label: '審查中' },
    { v: 'released', label: '已發行' },
    { v: 'obsolete', label: '停用' },
  ];

  /** "Used On" categories. Colours follow the Thermal Test Report Builder (RF blue, DIGI green, PWR orange). */
  const CATEGORIES = [
    { v: 'RF', label: 'RF', color: '#2563EB' },
    { v: 'DIGI', label: 'DIGI', color: '#16A34A' },
    { v: 'PWR', label: 'PWR', color: '#EA580C' },
    { v: 'DDR', label: 'DDR', color: '#0891B2' },
    { v: 'OPT', label: 'OPT', color: '#9333EA' },
    { v: 'Other', label: 'Other', color: '#64748B' },
  ];
  const CATEGORY_ALIASES = {
    RF: 'RF', 'R.F': 'RF', RADIO: 'RF',
    DIGI: 'DIGI', DIGITAL: 'DIGI', DIG: 'DIGI', DGT: 'DIGI', BB: 'DIGI', BASEBAND: 'DIGI',
    PWR: 'PWR', POWER: 'PWR', PSU: 'PWR', DCDC: 'PWR', 'DC-DC': 'PWR',
    DDR: 'DDR', MEM: 'DDR', MEMORY: 'DDR', DRAM: 'DDR',
    OPT: 'OPT', OPTIC: 'OPT', OPTICAL: 'OPT', SFP: 'OPT', OPTICS: 'OPT',
    OTHER: 'Other', OTHERS: 'Other',
  };

  /** TIM forms: "sheet" items have L×W×T; "dispense" items have an amount + bond line. */
  const TIM_TYPES = [
    { v: 'pad', label: 'Thermal Pad', zh: '導熱墊片', form: 'sheet' },
    { v: 'absorber', label: 'Absorber Pad', zh: '吸波導熱墊', form: 'sheet' },
    { v: 'gap_filler', label: 'Gap Filler', zh: '點膠導熱填隙', form: 'dispense' },
    { v: 'gel', label: 'Thermal Gel', zh: '導熱凝膠', form: 'dispense' },
    { v: 'putty', label: 'Thermal Putty', zh: '導熱泥', form: 'dispense' },
    { v: 'grease', label: 'Thermal Grease', zh: '導熱膏', form: 'dispense' },
    { v: 'pcm', label: 'Phase Change', zh: '相變化材料', form: 'sheet' },
    { v: 'graphite', label: 'Graphite Sheet', zh: '石墨片', form: 'sheet' },
    { v: 'tape', label: 'Thermal Tape', zh: '導熱膠帶', form: 'sheet' },
    { v: 'other', label: 'Other', zh: '其他', form: 'sheet' },
  ];

  const SOURCE_STATUS = [
    { v: 'unknown', label: '待確認' },
    { v: 'candidate', label: '候選' },
    { v: 'sample', label: '送樣' },
    { v: 'testing', label: '驗證中' },
    { v: 'qualified', label: '已承認' },
    { v: 'rejected', label: '不採用' },
  ];

  const AVL_STATUS = [
    { v: 'approved', label: '已承認' },
    { v: 'qualifying', label: '承認中' },
    { v: 'not_approved', label: '未承認' },
    { v: 'eol', label: 'EOL' },
  ];

  const K_METHODS = ['ASTM D5470', 'ISO 22007-2 (Hot Disk)', 'ASTM E1461 (Laser Flash)', 'Other / 未註明'];
  const HARDNESS_SCALES = ['Shore 00', 'Shore A', 'Shore C', 'Asker C'];
  const SILICONE = [
    { v: 'silicone', label: '矽系' },
    { v: 'low_volatile', label: '低揮發矽' },
    { v: 'silicone_free', label: '非矽系' },
  ];
  const UL94 = ['V-0', 'V-1', 'V-2', 'HB', 'N/A'];
  const CURRENCIES = ['USD', 'TWD', 'CNY', 'JPY', 'EUR'];
  const VALIDATION_RESULT = [
    { v: 'ok', label: 'OK' },
    { v: 'ng', label: 'NG' },
  ];
  const CHANGE_KINDS = [
    { v: 'edit', label: '修改' },
    { v: 'add', label: '新增' },
    { v: 'remove', label: '刪除' },
    { v: 'manual', label: '手動紀錄' },
    { v: 'ecn', label: 'ECN' },
    { v: 'baseline', label: '基準' },
    { v: 'import', label: '匯入' },
  ];

  /** Item palette for placement map pads. Red is deliberately excluded (reserved for errors). */
  const ITEM_COLORS = [
    '#2FA84F', '#2D8CFF', '#F28C28', '#8E5BD9', '#13A8A8', '#C99A00',
    '#D9469E', '#6E8B1E', '#3F51B5', '#A0522D', '#00ACC1', '#B0761E',
  ];
  /** Location colours; the first two match the existing Excel (green bottom case, light orange top case). */
  const LOCATION_COLORS = ['#00B050', '#FFD966', '#9DC3E6', '#C9A0DC', '#8FD3C8', '#BFBFBF'];

  const DEFAULT_SETTINGS = {
    default_locations: ['Bottom Case', 'Top Case'],
    // Fallback recommended compression when the material has no datasheet value.
    generic_comp: { pad: { min: 10, max: 30 }, absorber: { min: 10, max: 30 }, pcm: null, graphite: null, tape: null, other: null },
    dt_warn: 10,           // °C — TIM temperature rise worth flagging
    currency: 'USD',
  };

  /** Human labels for item fields (change log, diff, export). */
  const FIELD_LABELS = {
    item_no: 'Item', location_id: 'Location', used_on: 'Used On', status: '狀態',
    material_id: '材料連結', vendor: 'Vendor', model: 'Model', tim_type: '型態',
    size: 'Size', 'size.l': 'L', 'size.w': 'W', 'size.t': 'T', shape_note: '外形備註',
    dispense: '點膠量', qty: "Q'ty", delta_pn: 'Delta P/N', vendor_pn: 'Vendor P/N',
    fabricator: '裁切加工廠', drawing_no: '裁切圖號', covered: '覆蓋元件',
    gap: '設計間隙', comp_override: '建議壓縮率', sources: '2nd source',
    sourcing_note: '供應策略', price: '單價', moq: 'MOQ', lead_time_wk: '交期 (週)',
    validation: '驗證', note: '備註', links: '連結', color: '標註顏色',
    'gap.nom': '間隙 nom', 'gap.min': '間隙 min', 'gap.max': '間隙 max',
    'price.unit': '單價', 'price.currency': '幣別',
    'dispense.amount': '點膠量', 'dispense.unit': '點膠量單位', 'dispense.blt': 'BLT',
    'validation.coverage_pct': '壓痕覆蓋率', 'validation.result': '驗證判定', 'validation.date': '驗證日期',
    'validation.note': '驗證備註', 'validation.image_id': '驗證照片',
    status_p: '專案狀態',
    // project fields
    name: '案名', code: '專案代碼', product_type: '產品類型', customer: '客戶', stage: 'Stage',
    owner: '熱流負責人', me_owner: '機構負責人', description: '備註', locations: 'Location',
  };

  function labelOf(list, v) {
    const f = list.find(x => x.v === v);
    return f ? f.label : (v || '');
  }

  /** "Sub-6" / "mmWave" / "" */
  function productTypeLabel(v) { const f = PRODUCT_TYPES.find(x => x.v === v); return f ? f.label : ''; }
  /** "code · type · customer" line shown under project names. */
  function projectSubline(p) { return [p.code, productTypeLabel(p.product_type), p.customer].filter(Boolean).join(' · '); }

  function timType(v) { return TIM_TYPES.find(t => t.v === v) || TIM_TYPES[0]; }
  function isDispense(v) { return timType(v).form === 'dispense'; }
  function categoryColor(v) {
    const c = CATEGORIES.find(x => x.v === v);
    return c ? c.color : '#64748B';
  }
  function normalizeCategory(s) {
    const k = util.toHalfWidth(String(s || '')).trim().toUpperCase().replace(/\s+/g, '');
    if (!k) return null;
    return CATEGORY_ALIASES[k] || CATEGORY_ALIASES[k.replace(/[^A-Z0-9-]/g, '')] || String(s).trim();
  }

  // ───────────────────────── factories ─────────────────────────

  function newDb() {
    return {
      schema: SCHEMA_ID, schema_version: SCHEMA_VERSION, rev: 0, updated_at: util.nowIso(),
      projects: {}, materials: {}, images: {}, settings: util.clone(DEFAULT_SETTINGS),
    };
  }

  function newLocation(name, idx) {
    return { id: util.uid('loc'), name: name || 'Location', color: LOCATION_COLORS[(idx || 0) % LOCATION_COLORS.length] };
  }

  function newProject(fields, user, settings) {
    const now = util.nowIso();
    const locNames = (settings && settings.default_locations && settings.default_locations.length)
      ? settings.default_locations : DEFAULT_SETTINGS.default_locations;
    const p = {
      id: util.uid('prj'), rev: 0, created_at: now, updated_at: now,
      created_by: user || '', updated_by: user || '',
      name: '', code: '', product_type: '', customer: '', stage: 'EVT', status: 'active',
      owner: user || '', me_owner: '', description: '',
      locations: locNames.map((n, i) => newLocation(n, i)),
      items: [], views: [], changelog: [], baselines: [],
    };
    return Object.assign(p, fields || {});
  }

  function newItem(fields) {
    const it = {
      id: util.uid('itm'), item_no: '', location_id: null, used_on: [], status: 'draft',
      material_id: null, vendor: '', model: '', tim_type: 'pad',
      size: { l: null, w: null, t: null }, shape_note: '',
      dispense: { amount: null, unit: 'g', blt: null },
      qty: null, delta_pn: '', vendor_pn: '', fabricator: '', drawing_no: '',
      covered: [], gap: { nom: null, min: null, max: null }, comp_override: null,
      sources: [], sourcing_note: '',
      price: { unit: null, currency: '' }, moq: null, lead_time_wk: null,
      validation: { coverage_pct: null, result: '', date: '', note: '', image_id: null },
      note: '', links: [], color: null,
    };
    return Object.assign(it, fields || {});
  }

  function newCovered(fields) {
    return Object.assign({ id: util.uid('cov'), part: '', refdes: '', qty: 1, cat: '', power_w: null, top_pct: null, pkg_l: null, pkg_w: null, note: '' }, fields || {});
  }

  function newSource(fields) {
    return Object.assign({ id: util.uid('src'), vendor: '', model: '', mpn: '', delta_pn: '', status: 'unknown', note: '' }, fields || {});
  }

  function newMaterial(fields) {
    const now = util.nowIso();
    const m = {
      id: util.uid('mat'), rev: 0, created_at: now, updated_at: now,
      vendor: '', model: '', tim_type: 'pad',
      k: null, k_method: '', impedance: null, impedance_cond: '',
      hardness: null, hardness_scale: 'Shore 00', density: null, color: '',
      temp_min: null, temp_max: null,
      dielectric_kv_mm: null, volume_resistivity: '', dk: null, dk_freq: '', absorber_freq: '',
      ul94: '', silicone: '', outgassing: '',
      comp_rec_min: null, comp_rec_max: null, thickness_options: '',
      shelf_life_months: null, storage: '',
      rohs: null, reach: null, halogen_free: null,
      datasheet_url: '', datasheet_rev: '',   // legacy (link field removed; shown read-only when set)
      datasheets: [],        // uploaded files: [{ path (below the Datasheets folder), name, size, at, by }], newest first
      price_ref: '', moq: null, lead_time_wk: null,
      avl_status: 'approved', note: '',
    };
    return Object.assign(m, fields || {});
  }

  function newView(fields) {
    return Object.assign({
      id: util.uid('view'), name: '', location_id: null, image_id: null, img_w: 0, img_h: 0,
      calib: null,
      style: { label_inside: true, leader_color: '#FACC15', fill_opacity: 0.85, font_scale: 1, show_scale: true },
      shapes: [], callouts: [],
    }, fields || {});
  }

  function newShape(fields) {
    return Object.assign({ id: util.uid('shp'), item_id: null, cx: 0.5, cy: 0.5, w: 0.05, h: 0.05, rot: 0, size_mode: 'item', ref: '', note: '' }, fields || {});
  }

  function newCallout(fields) {
    return Object.assign({ id: util.uid('cal'), item_id: null, x: 0.5, y: 0.5, targets: null, text: '' }, fields || {});
  }

  // ───────────────────────── normalisation ─────────────────────────

  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const numOrNull = v => util.num(v);
  const str = v => (v === null || v === undefined) ? '' : String(v);

  function normalizeItem(it) {
    const d = newItem({ id: it && it.id ? it.id : undefined });
    const o = Object.assign(d, isObj(it) ? it : {});
    if (!o.id) o.id = util.uid('itm');
    o.item_no = str(o.item_no);
    o.used_on = Array.isArray(o.used_on) ? o.used_on.filter(Boolean).map(String) : (o.used_on ? [String(o.used_on)] : []);
    o.size = Object.assign({ l: null, w: null, t: null }, isObj(o.size) ? o.size : {});
    ['l', 'w', 't'].forEach(k => { o.size[k] = numOrNull(o.size[k]); });
    o.dispense = Object.assign({ amount: null, unit: 'g', blt: null }, isObj(o.dispense) ? o.dispense : {});
    o.dispense.amount = numOrNull(o.dispense.amount); o.dispense.blt = numOrNull(o.dispense.blt);
    o.qty = numOrNull(o.qty);
    o.covered = (Array.isArray(o.covered) ? o.covered : []).map(c => {
      const n = newCovered(isObj(c) ? c : {});
      n.qty = numOrNull(n.qty); n.power_w = numOrNull(n.power_w); n.top_pct = numOrNull(n.top_pct);
      n.pkg_l = numOrNull(n.pkg_l); n.pkg_w = numOrNull(n.pkg_w);
      n.part = str(n.part); n.refdes = str(n.refdes);
      return n;
    });
    o.gap = Object.assign({ nom: null, min: null, max: null }, isObj(o.gap) ? o.gap : {});
    ['nom', 'min', 'max'].forEach(k => { o.gap[k] = numOrNull(o.gap[k]); });
    if (o.comp_override && isObj(o.comp_override)) {
      o.comp_override = { min: numOrNull(o.comp_override.min), max: numOrNull(o.comp_override.max) };
    } else o.comp_override = null;
    o.sources = (Array.isArray(o.sources) ? o.sources : []).map(s => newSource(isObj(s) ? s : {}));
    o.price = Object.assign({ unit: null, currency: '' }, isObj(o.price) ? o.price : {});
    o.price.unit = numOrNull(o.price.unit);
    o.validation = Object.assign({ coverage_pct: null, result: '', date: '', note: '', image_id: null }, isObj(o.validation) ? o.validation : {});
    o.validation.coverage_pct = numOrNull(o.validation.coverage_pct);
    o.links = Array.isArray(o.links) ? o.links.filter(isObj) : [];
    if (!TIM_TYPES.some(t => t.v === o.tim_type)) o.tim_type = 'pad';
    if (!ITEM_STATUS.some(s => s.v === o.status)) o.status = 'draft';
    return o;
  }

  function normalizeView(v) {
    const o = Object.assign(newView({ id: v && v.id ? v.id : undefined }), isObj(v) ? v : {});
    o.style = Object.assign(newView().style, isObj(o.style) ? o.style : {});
    o.shapes = (Array.isArray(o.shapes) ? o.shapes : []).map(s => newShape(isObj(s) ? s : {}));
    o.callouts = (Array.isArray(o.callouts) ? o.callouts : []).map(c => newCallout(isObj(c) ? c : {}));
    if (o.calib && !(isObj(o.calib) && Number.isFinite(o.calib.mm) && o.calib.mm > 0)) o.calib = null;
    return o;
  }

  function normalizeProject(p) {
    const o = Object.assign(newProject({ id: p && p.id ? p.id : undefined }), isObj(p) ? p : {});
    if (!o.id) o.id = util.uid('prj');
    o.rev = Number.isFinite(o.rev) ? o.rev : 0;
    if (!PRODUCT_TYPES.some(t => t.v === o.product_type)) o.product_type = '';
    o.locations = (Array.isArray(o.locations) ? o.locations : []).filter(isObj).map((l, i) =>
      Object.assign(newLocation('', i), l, { id: l.id || util.uid('loc') }));
    o.items = (Array.isArray(o.items) ? o.items : []).map(normalizeItem);
    // Every item must point at an existing location.
    if (o.items.some(it => !o.locations.find(l => l.id === it.location_id))) {
      if (!o.locations.length) o.locations.push(newLocation('Location', 0));
      o.items.forEach(it => { if (!o.locations.find(l => l.id === it.location_id)) it.location_id = o.locations[0].id; });
    }
    o.views = (Array.isArray(o.views) ? o.views : []).map(normalizeView);
    o.changelog = Array.isArray(o.changelog) ? o.changelog.filter(isObj) : [];
    o.baselines = Array.isArray(o.baselines) ? o.baselines.filter(isObj) : [];
    if (!STAGES.includes(o.stage)) o.stage = o.stage || 'EVT';
    return o;
  }

  function normalizeMaterial(m) {
    const o = Object.assign(newMaterial({ id: m && m.id ? m.id : undefined }), isObj(m) ? m : {});
    ['k', 'impedance', 'hardness', 'density', 'temp_min', 'temp_max', 'dielectric_kv_mm', 'dk',
      'comp_rec_min', 'comp_rec_max', 'shelf_life_months', 'moq', 'lead_time_wk'].forEach(k => { o[k] = numOrNull(o[k]); });
    if (!TIM_TYPES.some(t => t.v === o.tim_type)) o.tim_type = 'pad';
    o.datasheets = Array.isArray(o.datasheets) ? o.datasheets.filter(d => isObj(d) && typeof d.path === 'string' && d.path)
      .map(d => ({ path: d.path, name: String(d.name || d.path.split('/').pop()), size: numOrNull(d.size), at: d.at || '', by: d.by || '' })) : [];
    o.rev = Number.isFinite(o.rev) ? o.rev : 0;
    return o;
  }

  /** Validate an object loaded from disk. Never "repairs" a foreign file into an empty skeleton. */
  function validateDb(obj) {
    if (!isObj(obj)) return { ok: false, error: '檔案內容不是 JSON 物件' };
    if (obj.schema !== SCHEMA_ID) {
      if (obj.thermal_reports) return { ok: false, error: '這是 Thermal Test Report Builder 的資料庫，不是 TIM 資料庫' };
      return { ok: false, error: '不是 TIM 資料庫檔案（缺少 schema: "tim-db"）' };
    }
    if (!Number.isFinite(obj.schema_version) || obj.schema_version > SCHEMA_VERSION) {
      return { ok: false, error: '資料庫版本 ' + obj.schema_version + ' 比此工具新，請更新工具後再開啟' };
    }
    if (!isObj(obj.projects) || !isObj(obj.materials)) return { ok: false, error: '資料庫結構不完整（projects / materials）' };
    return { ok: true };
  }

  /** Fill defaults / migrate an already-validated DB in place and return it. */
  function normalizeDb(db) {
    db.rev = Number.isFinite(db.rev) ? db.rev : 0;
    db.images = isObj(db.images) ? db.images : {};
    db.settings = Object.assign(util.clone(DEFAULT_SETTINGS), isObj(db.settings) ? db.settings : {});
    db.settings.generic_comp = Object.assign(util.clone(DEFAULT_SETTINGS.generic_comp), isObj(db.settings.generic_comp) ? db.settings.generic_comp : {});
    Object.keys(db.projects).forEach(id => { db.projects[id] = normalizeProject(Object.assign({}, db.projects[id], { id })); });
    Object.keys(db.materials).forEach(id => { db.materials[id] = normalizeMaterial(Object.assign({}, db.materials[id], { id })); });
    db.schema_version = SCHEMA_VERSION;
    return db;
  }

  /** All image ids referenced by a project (views + validation photos). */
  function projectImageIds(p) {
    const ids = [];
    (p.views || []).forEach(v => { if (v.image_id) ids.push(v.image_id); });
    (p.items || []).forEach(it => { if (it.validation && it.validation.image_id) ids.push(it.validation.image_id); });
    return ids;
  }

  return {
    SCHEMA_ID, SCHEMA_VERSION, STAGES, PRODUCT_TYPES, LOCATION_PRESETS, locationPresetOf, PROJECT_STATUS, ITEM_STATUS, CATEGORIES, TIM_TYPES,
    SOURCE_STATUS, AVL_STATUS, K_METHODS, HARDNESS_SCALES, SILICONE, UL94, CURRENCIES,
    VALIDATION_RESULT, CHANGE_KINDS, ITEM_COLORS, LOCATION_COLORS, DEFAULT_SETTINGS, FIELD_LABELS,
    labelOf, productTypeLabel, projectSubline, timType, isDispense, categoryColor, normalizeCategory,
    newDb, newLocation, newProject, newItem, newCovered, newSource, newMaterial, newView, newShape, newCallout,
    normalizeItem, normalizeView, normalizeProject, normalizeMaterial, normalizeDb, validateDb, projectImageIds,
  };
});
