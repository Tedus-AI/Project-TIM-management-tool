/* TIM Management Tool — engineering calculations, checks, statistics, diff, search. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const parse = isNode ? require('./parse.js') : root.TIM.parse;
  const mod = factory(util, schema, parse);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.calc = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema, parse) {
  'use strict';

  const fin = v => typeof v === 'number' && Number.isFinite(v);

  function materialOf(db, item) {
    return item && item.material_id && db && db.materials ? db.materials[item.material_id] || null : null;
  }

  /** Effective vendor/model/type/k for an item (mirrors the linked material — single source of truth). */
  function effective(item, mat) {
    if (mat) return { vendor: mat.vendor, model: mat.model, tim_type: mat.tim_type || item.tim_type, k: fin(mat.k) ? mat.k : null, linked: true };
    return { vendor: item.vendor, model: item.model, tim_type: item.tim_type, k: null, linked: false };
  }

  /** Pad area in mm² (null when L or W missing). */
  function padArea(item) {
    const s = item && item.size;
    return s && fin(s.l) && fin(s.w) ? s.l * s.w : null;
  }

  /** Compression percentage for thickness t at gap g. */
  function compressionAt(t, g) {
    if (!fin(t) || !fin(g) || t <= 0) return null;
    return Math.round((t - g) / t * 100 * 1e4) / 1e4;   // 4 decimals: (3-2.7)/3 must be exactly 10 %
  }

  /** Heat through the TIM for one component: power × top-side fraction (blank fraction = 100 %). */
  function timPower(c) {
    if (!c || !fin(c.power_w)) return null;
    const f = fin(c.top_pct) ? c.top_pct : 100;
    return c.power_w * f / 100;
  }

  /**
   * Recommended compression range for an item:
   * item override → material datasheet → generic default for the TIM type (settings).
   * Returns { min, max, source: 'item'|'material'|'generic' } or null.
   */
  function recCompression(item, mat, settings) {
    const o = item && item.comp_override;
    if (o && (fin(o.min) || fin(o.max))) return { min: fin(o.min) ? o.min : null, max: fin(o.max) ? o.max : null, source: 'item' };
    if (mat && (fin(mat.comp_rec_min) || fin(mat.comp_rec_max))) {
      return { min: fin(mat.comp_rec_min) ? mat.comp_rec_min : null, max: fin(mat.comp_rec_max) ? mat.comp_rec_max : null, source: 'material' };
    }
    const type = (mat && mat.tim_type) || (item && item.tim_type) || 'pad';
    const gc = (settings && settings.generic_comp) || schema.DEFAULT_SETTINGS.generic_comp;
    const g = gc[type];
    if (g && (fin(g.min) || fin(g.max))) return { min: g.min, max: g.max, source: 'generic' };
    return null;
  }

  /**
   * Gap / compression check for one item.
   * Uses gap.min → max compression, gap.max → min compression.
   * status: 'na' (no data), 'ok', 'warn' (outside recommended range), 'error' (no contact).
   */
  function compressionCheck(item, mat, settings) {
    const out = { min: null, nom: null, max: null, rec: null, status: 'na', msgs: [] };
    if (!item || schema.isDispense((mat && mat.tim_type) || item.tim_type)) return out;
    const t = item.size && item.size.t;
    const g = item.gap || {};
    const gMin = fin(g.min) ? g.min : (fin(g.nom) ? g.nom : null);
    const gMax = fin(g.max) ? g.max : (fin(g.nom) ? g.nom : null);
    if (!fin(t) || (!fin(g.nom) && !fin(g.min) && !fin(g.max))) return out;
    out.max = compressionAt(t, gMin);
    out.min = compressionAt(t, gMax);
    out.nom = fin(g.nom) ? compressionAt(t, g.nom) : null;
    out.rec = recCompression(item, mat, settings);
    out.status = 'ok';
    if (out.min !== null && out.min <= 0) {
      out.status = 'error';
      out.msgs.push('最大間隙 ' + util.fmt(gMax) + ' mm ≥ 厚度 ' + util.fmt(t) + ' mm，可能完全未接觸');
    }
    if (out.rec) {
      if (fin(out.rec.min) && out.min !== null && out.min > 0 && out.min < out.rec.min) {
        if (out.status === 'ok') out.status = 'warn';
        out.msgs.push('最小壓縮 ' + util.fmt(out.min, 1) + '% 低於建議 ' + out.rec.min + '%（接觸可能不足）');
      }
      if (fin(out.rec.max) && out.max !== null && out.max > out.rec.max) {
        if (out.status === 'ok') out.status = 'warn';
        out.msgs.push('最大壓縮 ' + util.fmt(out.max, 1) + '% 高於建議 ' + out.rec.max + '%（元件受力 / 焊點風險）');
      }
    }
    if (out.max !== null && out.max >= 100) { out.status = 'error'; out.msgs.push('最小間隙 ≤ 0，請檢查間隙數值'); }
    return out;
  }

  /**
   * TIM thermal estimate per covered-component entry:
   *  t_c = min(gap_nom, T) (or BLT for dispensed TIM), A_eff = min(pad area, component top area)
   *  R = t_c[mm]·1000 / (k·A[mm²])  [°C/W],  ΔT = P_TIM·R,  P_TIM = P × top-side fraction
   * Returns { k, t_c, area, R_pad, rows:[{part, qty, power, area, R, dT}], dt_max } (nulls when data missing).
   */
  function thermalEstimate(item, mat) {
    const eff = effective(item, mat);
    const k = eff.k;
    const dispense = schema.isDispense(eff.tim_type);
    let t_c = null, t_src = '';
    if (dispense) {
      if (fin(item.dispense && item.dispense.blt)) { t_c = item.dispense.blt; t_src = 'blt'; }
      else if (fin(item.gap && item.gap.nom)) { t_c = item.gap.nom; t_src = 'gap'; }
    } else {
      const T = item.size && item.size.t;
      const g = item.gap && item.gap.nom;
      if (fin(T) && fin(g)) { t_c = Math.min(T, g); t_src = 'gap'; }
      else if (fin(T)) { t_c = T; t_src = 'thickness'; }   // no gap data → uncompressed thickness (conservative)
    }
    const aPad = padArea(item);
    const res = { k, t_c, t_src, area: aPad, R_pad: null, rows: [], dt_max: null, contact: true };
    if (!dispense && fin(item.size && item.size.t) && fin(item.gap && item.gap.nom) && item.gap.nom >= item.size.t) res.contact = false;
    const R = (area) => (fin(k) && k > 0 && fin(t_c) && fin(area) && area > 0) ? t_c * 1000 / (k * area) : null;
    res.R_pad = R(aPad);
    (item.covered || []).forEach(c => {
      const aPkg = fin(c.pkg_l) && fin(c.pkg_w) ? c.pkg_l * c.pkg_w : null;
      let area = aPad;
      if (fin(aPkg)) area = fin(aPad) ? Math.min(aPad, aPkg) : (dispense ? aPkg : null);
      const r = R(area);
      const p = timPower(c);
      const dT = fin(r) && fin(p) ? r * p : null;
      res.rows.push({ id: c.id, part: c.part, refdes: c.refdes, qty: c.qty, power_total: fin(c.power_w) ? c.power_w : null, top_pct: fin(c.top_pct) ? c.top_pct : null, power: p, area, R: r, dT });
      if (fin(dT) && (res.dt_max === null || dT > res.dt_max)) res.dt_max = dT;
    });
    return res;
  }

  /** 'single' (no 2nd source listed), 'unverified' (listed but none qualified) or 'ok'. */
  function sourceRisk(item) {
    const list = (item && item.sources || []).filter(s => s.status !== 'rejected' && (s.vendor || s.model));
    if (!list.length) return 'single';
    return list.some(s => s.status === 'qualified') ? 'ok' : 'unverified';
  }

  /** Number of pads placed for an item across all views. */
  function placedCount(project, itemId) {
    let n = 0;
    (project.views || []).forEach(v => (v.shapes || []).forEach(s => { if (s.item_id === itemId) n++; }));
    return n;
  }

  function placedCounts(project) {
    const m = {};
    (project.views || []).forEach(v => (v.shapes || []).forEach(s => { m[s.item_id] = (m[s.item_id] || 0) + 1; }));
    return m;
  }

  function coveredQty(item) {
    return util.sum(item.covered || [], c => fin(c.qty) ? c.qty : 1);
  }

  function itemCost(item) {
    if (!item || !fin(item.qty) || !item.price || !fin(item.price.unit)) return null;
    return item.qty * item.price.unit;
  }

  /** Item colour on the placement map: explicit colour, else palette by position in the project. */
  function itemColor(project, item) {
    if (item && item.color) return item.color;
    const idx = Math.max(0, (project.items || []).findIndex(i => i.id === (item && item.id)));
    return schema.ITEM_COLORS[idx % schema.ITEM_COLORS.length];
  }

  function locationOf(project, item) {
    return (project.locations || []).find(l => l.id === item.location_id) || null;
  }

  /** Items in display order: grouped by location order, then by array order. */
  function orderedItems(project) {
    const locIdx = {};
    (project.locations || []).forEach((l, i) => { locIdx[l.id] = i; });
    return (project.items || []).map((it, i) => ({ it, i }))
      .sort((a, b) => ((locIdx[a.it.location_id] ?? 999) - (locIdx[b.it.location_id] ?? 999)) || (a.i - b.i))
      .map(x => x.it);
  }

  // ───────────────────────── checks ─────────────────────────

  /**
   * Automatic checks for a project. Each: { level: 'error'|'warn'|'info', code, item_id, item_no, msg }.
   * db is needed for material look-ups (AVL, silicone, dielectric) and settings.
   */
  function projectChecks(project, db) {
    const out = [];
    const settings = (db && db.settings) || schema.DEFAULT_SETTINGS;
    const add = (level, code, item, msg) => out.push({ level, code, item_id: item ? item.id : null, item_no: item ? item.item_no : '', msg });
    const items = project.items || [];
    const placed = placedCounts(project);
    const hasViews = (project.views || []).some(v => (v.shapes || []).length > 0);

    // duplicate item numbers
    const byNo = {};
    items.forEach(it => { const k = String(it.item_no || '').trim().toUpperCase(); if (k) (byNo[k] = byNo[k] || []).push(it); });
    Object.keys(byNo).forEach(k => { if (byNo[k].length > 1) byNo[k].forEach(it => add('error', 'dup_item_no', it, 'Item 編號重複：' + it.item_no)); });

    // same Delta P/N with different spec / same spec with different P/N
    const byPn = {};
    const bySpec = {};
    items.forEach(it => {
      const eff = effective(it, materialOf(db, it));
      const spec = [eff.vendor, eff.model, parse.formatSize(it.size)].map(s => String(s || '').trim().toUpperCase()).join('|');
      const pn = String(it.delta_pn || '').trim();
      if (pn) (byPn[pn] = byPn[pn] || []).push({ it, spec });
      if (spec.replace(/\|/g, '') && parse.formatSize(it.size)) (bySpec[spec] = bySpec[spec] || []).push({ it, pn });
    });
    Object.keys(byPn).forEach(pn => {
      const specs = new Set(byPn[pn].map(x => x.spec));
      if (specs.size > 1) byPn[pn].forEach(x => add('error', 'pn_conflict', x.it, '台達料號 ' + pn + ' 對應到不同材料或尺寸'));
    });
    Object.keys(bySpec).forEach(spec => {
      const pns = new Set(bySpec[spec].map(x => x.pn).filter(Boolean));
      if (pns.size > 1) bySpec[spec].forEach(x => add('info', 'pn_merge', x.it, '相同材料與尺寸卻有不同料號（' + Array.from(pns).join(' / ') + '），可考慮合併'));
    });

    items.forEach(it => {
      if (it.status === 'obsolete') return;
      const mat = materialOf(db, it);
      const eff = effective(it, mat);
      const label = it.item_no || '(未編號)';
      const dispense = schema.isDispense(eff.tim_type);

      if (!eff.vendor && !eff.model) add('info', 'no_material', it, label + '：未填材料（Vendor / Model）');
      if (!dispense && !(fin(it.size.l) && fin(it.size.w) && fin(it.size.t))) add('info', 'no_size', it, label + '：尺寸不完整（L × W × T）');
      if (!fin(it.qty)) add('info', 'no_qty', it, label + "：未填 Q'ty");
      if (!String(it.delta_pn || '').trim()) add('info', 'no_pn', it, label + '：未填台達料號');

      if (mat) {
        if (mat.avl_status === 'eol') add('error', 'mat_eol', it, label + '：材料 ' + mat.vendor + ' ' + mat.model + ' 已 EOL');
        else if (mat.avl_status === 'not_approved') add('warn', 'mat_not_approved', it, label + '：材料未承認');
        else if (mat.avl_status === 'qualifying') add('info', 'mat_qualifying', it, label + '：材料承認中');
        if (!fin(mat.k)) add('info', 'no_k', it, label + '：材料庫未填 k 值，無法估算熱阻');
        if (mat.silicone === 'silicone' && (it.used_on || []).includes('OPT')) add('warn', 'silicone_opt', it, label + '：矽系材料用在光學元件，注意矽油揮發污染');
        if ((it.used_on || []).includes('PWR') && !fin(mat.dielectric_kv_mm)) add('info', 'pwr_dielectric', it, label + '：電源元件用料，建議確認材料絕緣耐壓');
      }

      const cc = compressionCheck(it, mat, settings);
      if (cc.status === 'error') cc.msgs.forEach(m => add('error', 'comp_error', it, label + '：' + m));
      else if (cc.status === 'warn') cc.msgs.forEach(m => add('warn', 'comp_warn', it, label + '：' + m));
      else if (cc.status === 'na' && !dispense && fin(it.size.t)) add('info', 'no_gap', it, label + '：未填設計間隙，無法檢核壓縮率');

      const risk = sourceRisk(it);
      if (risk === 'single') add('warn', 'single_source', it, label + '：單一來源' + (it.sourcing_note ? '（' + it.sourcing_note + '）' : ''));
      else if (risk === 'unverified') add('info', 'source_unverified', it, label + '：第二來源尚未承認');

      if (hasViews && fin(it.qty) && (placed[it.id] || 0) !== it.qty) {
        add('warn', 'placement_mismatch', it, label + "：位置圖放置 " + (placed[it.id] || 0) + " 片 ≠ Q'ty " + it.qty);
      }
      const cq = coveredQty(it);
      if ((it.covered || []).length && fin(it.qty) && cq !== it.qty) {
        add('info', 'covered_qty', it, label + '：覆蓋元件共 ' + cq + ' 顆，Q\'ty ' + it.qty + ' 片（一片對一顆時應相等）');
      }
      const th = thermalEstimate(it, mat);
      if (fin(th.dt_max) && th.dt_max >= (settings.dt_warn || 10)) {
        add('warn', 'dt_high', it, label + '：TIM 溫升估算 ' + util.fmt(th.dt_max, 1) + ' °C（≥ ' + (settings.dt_warn || 10) + ' °C）');
      }
      if (it.validation && it.validation.result === 'ng') add('error', 'validation_ng', it, label + '：拆機驗證 NG');
    });

    const rank = { error: 0, warn: 1, info: 2 };
    out.sort((a, b) => rank[a.level] - rank[b.level] || util.naturalCompare(a.item_no, b.item_no));
    return out;
  }

  /** Summary numbers for a project (home list / overview tiles). */
  function projectStats(project, db) {
    const items = (project.items || []).filter(it => it.status !== 'obsolete');
    const placed = placedCounts(project);
    const mats = new Set();
    let pcs = 0, single = 0, unverified = 0, placedPcs = 0, qtyWithMap = 0;
    const costByCur = {};
    let costMissing = 0;
    items.forEach(it => {
      const eff = effective(it, materialOf(db, it));
      if (eff.vendor || eff.model) mats.add((eff.vendor + '|' + eff.model).toUpperCase());
      if (fin(it.qty)) pcs += it.qty;
      const r = sourceRisk(it);
      if (r === 'single') single++; else if (r === 'unverified') unverified++;
      placedPcs += placed[it.id] || 0;
      if (fin(it.qty)) qtyWithMap += it.qty;
      const c = itemCost(it);
      if (c !== null) {
        const cur = (it.price && it.price.currency) || (db && db.settings && db.settings.currency) || 'USD';
        costByCur[cur] = (costByCur[cur] || 0) + c;
      } else costMissing++;
    });
    const checks = projectChecks(project, db);
    return {
      items: items.length, pcs, materials: mats.size, single, unverified,
      placed: placedPcs, qty_total: qtyWithMap,
      cost: costByCur, cost_missing: costMissing,
      errors: checks.filter(c => c.level === 'error').length,
      warns: checks.filter(c => c.level === 'warn').length,
      infos: checks.filter(c => c.level === 'info').length,
      comp_issues: checks.filter(c => c.code === 'comp_warn' || c.code === 'comp_error').length,
    };
  }

  /** Total pieces per material across the project (purchasing summary). */
  /**
   * Per-unit usage of each material (non-obsolete items), in its own unit: sheet TIM in pcs
   * (Q'ty), dispensed TIM in g / cc (Q'ty × dispense amount; no Q'ty = one dispense).
   * → [{ vendor, model, items, amounts: { pcs, g, cc }, usage: "9 pcs" | "4.5 g" | "6 pcs + 1.2 g" }]
   */
  function materialUsage(project, db) {
    const m = {};
    (project.items || []).forEach(it => {
      if (it.status === 'obsolete') return;
      const eff = effective(it, materialOf(db, it));
      const key = (eff.vendor || '') + ' ' + (eff.model || '');
      if (!key.trim()) return;
      const e = m[key] = m[key] || { vendor: eff.vendor, model: eff.model, items: [], amounts: {} };
      e.items.push(it.item_no);
      const add = (unit, v) => { e.amounts[unit] = Math.round(((e.amounts[unit] || 0) + v) * 1e4) / 1e4; };
      if (schema.isDispense(eff.tim_type)) {
        const amt = it.dispense && it.dispense.amount;
        if (fin(amt)) add(it.dispense.unit || 'g', amt * (fin(it.qty) ? it.qty : 1));
      } else if (fin(it.qty)) add('pcs', it.qty);
    });
    const order = ['pcs', 'g', 'cc'];
    return Object.values(m).map(e => Object.assign(e, {
      usage: Object.keys(e.amounts).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(u => util.fmt(e.amounts[u], 3) + ' ' + u).join(' + '),
    })).sort((a, b) => (b.amounts.pcs || 0) - (a.amounts.pcs || 0) || String(a.vendor + a.model).localeCompare(String(b.vendor + b.model)));
  }

  // ───────────────────────── baselines & diff ─────────────────────────

  const DIFF_FIELDS = ['location', 'used_on', 'vendor', 'model', 'tim_type', 'size', 'qty', 'delta_pn', 'vendor_pn',
    'fabricator', 'covered', 'gap', 'sources', 'status', 'price', 'note'];

  /** Flatten an item into comparable display strings (uses the snapshot's own locations). */
  function itemDigest(item, locations, db) {
    const loc = (locations || []).find(l => l.id === item.location_id);
    const mat = item.material_id && db ? db.materials[item.material_id] : null;
    const eff = effective(item, mat);
    return {
      location: loc ? loc.name : '',
      used_on: parse.formatUsedOn(item.used_on),
      vendor: eff.vendor || '', model: eff.model || '',
      tim_type: schema.timType(eff.tim_type).label,
      size: parse.formatSize(item.size),
      qty: fin(item.qty) ? String(item.qty) : '',
      delta_pn: item.delta_pn || '', vendor_pn: item.vendor_pn || '', fabricator: item.fabricator || '',
      covered: parse.formatCovered(item.covered),
      gap: [item.gap && item.gap.min, item.gap && item.gap.nom, item.gap && item.gap.max].map(v => fin(v) ? util.fmt(v) : '-').join(' / ').replace(/^- \/ - \/ -$/, ''),
      sources: parse.formatSources(item),
      status: schema.labelOf(schema.ITEM_STATUS, item.status),
      price: item.price && fin(item.price.unit) ? item.price.unit + ' ' + (item.price.currency || '') : '',
      note: item.note || '',
    };
  }

  /** Snapshot for a baseline (no images, no views). */
  function makeSnapshot(project) {
    return util.clone({ locations: project.locations, items: project.items });
  }

  /**
   * Compare two snapshots ({locations, items}). Items are matched by id, falling back to item_no.
   * → { added:[digest], removed:[digest], changed:[{item_no, fields:[{field,label,from,to}]}] }
   */
  function diffSnapshots(a, b, db) {
    const A = (a && a.items) || [], B = (b && b.items) || [];
    const used = new Set();
    const res = { added: [], removed: [], changed: [] };
    const label = f => ({ location: 'Location', used_on: 'Used On', vendor: 'Vendor', model: 'Model', tim_type: '型態', size: 'Size', qty: "Q'ty", delta_pn: 'Delta P/N', vendor_pn: 'Vendor P/N', fabricator: '加工廠', covered: '覆蓋元件', gap: '間隙 min/nom/max', sources: '2nd source', status: '狀態', price: '單價', note: '備註' }[f] || f);
    A.forEach(ia => {
      let j = B.findIndex((ib, k) => !used.has(k) && ib.id === ia.id);
      if (j < 0) j = B.findIndex((ib, k) => !used.has(k) && ib.item_no && String(ib.item_no).toUpperCase() === String(ia.item_no).toUpperCase());
      const da = itemDigest(ia, a.locations, db);
      if (j < 0) { res.removed.push(Object.assign({ item_no: ia.item_no }, da)); return; }
      used.add(j);
      const ib = B[j];
      const dbb = itemDigest(ib, b.locations, db);
      const fields = [];
      if (String(ia.item_no) !== String(ib.item_no)) fields.push({ field: 'item_no', label: 'Item', from: ia.item_no, to: ib.item_no });
      DIFF_FIELDS.forEach(f => { if (da[f] !== dbb[f]) fields.push({ field: f, label: label(f), from: da[f], to: dbb[f] }); });
      if (fields.length) res.changed.push({ item_no: ib.item_no || ia.item_no, fields });
    });
    B.forEach((ib, k) => { if (!used.has(k)) res.added.push(Object.assign({ item_no: ib.item_no }, itemDigest(ib, b.locations, db))); });
    const byNo = (x, y) => util.naturalCompare(x.item_no, y.item_no);
    res.added.sort(byNo); res.removed.sort(byNo); res.changed.sort(byNo);
    return res;
  }

  // ───────────────────────── where-used & search ─────────────────────────

  /** Every place a material is used: as the item's material or as a 2nd source (matched by vendor+model). */
  function whereUsed(db, materialId) {
    const mat = db.materials[materialId];
    if (!mat) return [];
    const key = (mat.vendor + ' ' + mat.model).trim().toUpperCase();
    const out = [];
    Object.values(db.projects || {}).forEach(p => {
      (p.items || []).forEach(it => {
        const loc = locationOf(p, it);
        if (it.material_id === materialId) out.push({ project_id: p.id, project: p.name, stage: p.stage, item_id: it.id, item_no: it.item_no, location: loc ? loc.name : '', qty: it.qty, role: 'primary' });
        (it.sources || []).forEach(s => {
          if ((String(s.vendor) + ' ' + String(s.model)).trim().toUpperCase() === key && key) {
            out.push({ project_id: p.id, project: p.name, stage: p.stage, item_id: it.id, item_no: it.item_no, location: loc ? loc.name : '', qty: it.qty, role: '2nd source', status: s.status });
          }
        });
      });
    });
    return out;
  }

  function materialUseCount(db, materialId) {
    let n = 0;
    Object.values(db.projects || {}).forEach(p => (p.items || []).forEach(it => { if (it.material_id === materialId) n++; }));
    return n;
  }

  /**
   * Cross-project search over items. Query terms are AND-ed; each term matches any field.
   * → [{project_id, project, item_id, item_no, location, hits:[{field,label,value}]}] (max 200)
   */
  function searchItems(db, query) {
    const terms = util.toHalfWidth(String(query || '')).trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    Object.values(db.projects || {}).forEach(p => {
      (p.items || []).forEach(it => {
        const eff = effective(it, materialOf(db, it));
        const loc = locationOf(p, it);
        const fields = [
          ['item_no', 'Item', it.item_no], ['vendor', 'Vendor', eff.vendor], ['model', 'Model', eff.model],
          ['delta_pn', 'Delta P/N', it.delta_pn], ['vendor_pn', 'Vendor P/N', it.vendor_pn],
          ['covered', '覆蓋元件', (it.covered || []).map(c => [c.part, c.refdes].filter(Boolean).join(' ')).join(', ')],
          ['sources', '2nd source', (it.sources || []).map(s => [s.vendor, s.model, s.mpn, s.delta_pn].filter(Boolean).join(' ')).join(', ') + ' ' + (it.sourcing_note || '')],
          ['fabricator', '加工廠', it.fabricator], ['note', '備註', it.note], ['project', '專案', p.name + ' ' + (p.code || '') + ' ' + schema.productTypeLabel(p.product_type)],
        ];
        const ok = terms.every(t => fields.some(f => String(f[2] || '').toUpperCase().includes(t)));
        if (!ok) return;
        const hits = fields.filter(f => f[0] !== 'project' && terms.some(t => String(f[2] || '').toUpperCase().includes(t)))
          .map(f => ({ field: f[0], label: f[1], value: String(f[2] || '') }));
        out.push({ project_id: p.id, project: p.name, stage: p.stage, item_id: it.id, item_no: it.item_no, location: loc ? loc.name : '', vendor: eff.vendor, model: eff.model, hits });
      });
    });
    out.sort((a, b) => String(a.project).localeCompare(String(b.project)) || util.naturalCompare(a.item_no, b.item_no));
    return out.slice(0, 200);
  }

  return {
    materialOf, effective, padArea, compressionAt, timPower, recCompression, compressionCheck, thermalEstimate,
    sourceRisk, placedCount, placedCounts, coveredQty, itemCost, itemColor, locationOf, orderedItems,
    projectChecks, projectStats, materialUsage, itemDigest, makeSnapshot, diffSnapshots,
    whereUsed, materialUseCount, searchItems,
  };
});
