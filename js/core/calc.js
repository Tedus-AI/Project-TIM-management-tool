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

  /**
   * The library material an unlinked item names exactly (Vendor + Model, case and spaces ignored) — the item does not
   * use it (k, curves…) until it is linked. null when linked, unnamed, or not exactly one match.
   */
  function libraryMatch(db, item) {
    if (!item || item.material_id || !db || !db.materials) return null;
    const norm = s => util.toHalfWidth(String(s == null ? '' : s)).trim().replace(/\s+/g, ' ').toUpperCase();
    const v = norm(item.vendor), m = norm(item.model);
    if (!v && !m) return null;
    const hits = Object.values(db.materials).filter(x => norm(x.vendor) === v && norm(x.model) === m);
    return hits.length === 1 ? hits[0] : null;
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
   * Minimum compression (contact) for an item: item override (manual) → generic default for the TIM type
   * (settings.generic_comp). Over-compression is judged by pressure, so there is no upper limit.
   * Returns { min, source: 'item'|'generic' } or null.
   */
  function recCompression(item, mat, settings) {
    const o = item && item.comp_override;
    if (o && fin(o.min)) return { min: o.min, source: 'item' };
    const type = (mat && mat.tim_type) || (item && item.tim_type) || 'pad';
    const gc = (settings && settings.generic_comp) || schema.DEFAULT_SETTINGS.generic_comp;
    const g = gc[type];
    if (g && fin(g.min)) return { min: g.min, source: 'generic' };
    return null;
  }

  // ───────────────────────── gap stack-up & pressure ─────────────────────────

  const PSI_PA = 6894.757;
  const r4 = v => Math.round(v * 1e4) / 1e4;

  /** 設計間距 (pedestal → component top, nominal) as { min, nom, max } with its ± tolerance; null without a nominal. */
  function designRange(item) {
    const d = item && item.gap_design;
    if (!d || !fin(d.nom)) return null;
    const plus = fin(d.plus) ? Math.abs(d.plus) : 0, minus = fin(d.minus) ? Math.abs(d.minus) : 0;
    return { min: r4(d.nom - minus), nom: d.nom, max: r4(d.nom + plus) };
  }

  /** Component height { min, nom, max } (missing values fall back to the others); null when none given. */
  function heightRange(c) {
    if (!c || ![c.h_min, c.h_nom, c.h_max].some(fin)) return null;
    const min = fin(c.h_min) ? c.h_min : fin(c.h_nom) ? c.h_nom : c.h_max;
    const max = fin(c.h_max) ? c.h_max : fin(c.h_nom) ? c.h_nom : c.h_min;
    return { min, nom: fin(c.h_nom) ? c.h_nom : r4((min + max) / 2), max };
  }

  /**
   * Design gap of an item. With a 設計間距 (pedestal → component top at nominal height, ± tolerance) the gap
   * is derived per component, worst case, adding the component's height tolerance:
   *   g_min = (間距 − 下公差) − (h_max − h_nom),  g_nom = 間距,  g_max = (間距 + 上公差) + (h_nom − h_min)
   * Several components: by default each sits under its own pedestal at the 設計間距 (each adds its own height
   * tolerance). item.gap_flat (one flat pedestal over all of them): the 設計間距 is to the tallest one (nominal),
   * a lower component gets the height difference on top. Components without a height: no height tolerance
   * (flat: counted at the reference height). Otherwise (or with item.gap_manual) the manual item.gap.
   * → { source: 'stack'|'manual'|null, min, nom, max, design, stackReady, flat, ref (flat only),
   *     comps: [{ id, c, h, min, nom, max }] }  (item min / nom = the tightest component, max = the loosest)
   */
  function gapInfo(item) {
    const design = designRange(item);
    const covered = (item && item.covered) || [];
    const hs = covered.map(heightRange);
    const noms = hs.filter(Boolean).map(h => h.nom);
    // gap_flat: one flat pedestal over every component → the design gap is for the tallest one (ref), the shorter
    // ones add the height difference. Otherwise each component has its own pedestal at the design gap.
    const flat = !!(item && item.gap_flat);
    const ref = flat && noms.length ? Math.max.apply(null, noms) : null;
    const out = { source: null, min: null, nom: null, max: null, design, stackReady: !!design, flat, ref, comps: [] };
    if (design && !item.gap_manual) {
      out.source = 'stack';
      out.comps = covered.map((c, i) => {
        const h = hs[i];
        const off = h && ref !== null ? ref - h.nom : 0;
        return { id: c.id, c, h, min: r4(design.min + off - (h ? h.max - h.nom : 0)), nom: r4(design.nom + off), max: r4(design.max + off + (h ? h.nom - h.min : 0)) };
      });
      if (out.comps.length) {
        out.min = Math.min.apply(null, out.comps.map(x => x.min));
        out.nom = Math.min.apply(null, out.comps.map(x => x.nom));
        out.max = Math.max.apply(null, out.comps.map(x => x.max));
      } else Object.assign(out, { min: design.min, nom: design.nom, max: design.max });
      return out;
    }
    const g = (item && item.gap) || {};
    if (!fin(g.min) && !fin(g.nom) && !fin(g.max)) return out;
    out.source = 'manual';
    out.min = fin(g.min) ? g.min : fin(g.nom) ? g.nom : null;
    out.nom = fin(g.nom) ? g.nom : null;
    out.max = fin(g.max) ? g.max : fin(g.nom) ? g.nom : null;
    out.comps = covered.map((c, i) => ({ id: c.id, c, h: hs[i], min: out.min, nom: out.nom, max: out.max }));
    return out;
  }

  /**
   * A material's pressure–deflection curves, cleaned for interpolation: sorted by thickness, each curve
   * starts at (0 psi, 0 %) and never decreases. → [{ t, pts: [[psi, %], …] }]
   */
  function curveSet(mat) {
    return ((mat && mat.pressure_curves) || []).map(cv => {
      const raw = (cv.points || []).filter(p => Array.isArray(p) && fin(p[0]) && fin(p[1]) && p[0] >= 0).slice().sort((a, b) => a[0] - b[0]);
      const pts = raw.length && raw[0][0] > 0 ? [[0, 0]] : [];
      let top = 0;
      raw.forEach(p => { top = Math.max(top, p[1]); pts.push([p[0], top]); });
      return { t: cv.t, pts };
    }).filter(cv => fin(cv.t) && cv.t > 0 && cv.pts.length >= 2).sort((a, b) => a.t - b.t);
  }

  /** Pressure on one curve for a deflection (linear between points); beyond = deflection past the last point. */
  function psiOnCurve(pts, c) {
    if (c <= pts[0][1]) return { psi: pts[0][0], beyond: false };
    for (let i = 1; i < pts.length; i++) {
      const [p0, d0] = pts[i - 1], [p1, d1] = pts[i];
      if (c <= d1) return { psi: d1 === d0 ? p0 : p0 + (c - d0) / (d1 - d0) * (p1 - p0), beyond: false };
    }
    return { psi: pts[pts.length - 1][0], beyond: true };
  }

  /**
   * Pressure (psi) to compress a material of thickness t (mm) by c %, from its deflection curves:
   * same thickness → that curve; between two thicknesses → linear in thickness; outside → nearest curve.
   * → { psi, beyond (c past the curve: psi is only a lower bound), basis: 'exact'|'interp'|'nearest', t_used } or null
   */
  function pressureAt(mat, t, c) {
    const cs = curveSet(mat);
    if (!cs.length || !fin(t) || !fin(c)) return null;
    const same = cs.find(cv => Math.abs(cv.t - t) < 1e-6);
    if (same || cs.length === 1 || t < cs[0].t || t > cs[cs.length - 1].t) {
      const cv = same || cs.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
      const r = psiOnCurve(cv.pts, c);
      return { psi: r4(r.psi), beyond: r.beyond, basis: same ? 'exact' : 'nearest', t_used: [cv.t] };
    }
    const i = cs.findIndex(cv => cv.t > t);
    const a = cs[i - 1], b = cs[i];
    const ra = psiOnCurve(a.pts, c), rb = psiOnCurve(b.pts, c);
    const f = (t - a.t) / (b.t - a.t);
    return { psi: r4(ra.psi + f * (rb.psi - ra.psi)), beyond: ra.beyond || rb.beyond, basis: 'interp', t_used: [a.t, b.t] };
  }

  /** Contact area (mm²) of a component under the pad: min(pad, component top); either one when the other is unknown. */
  function contactArea(item, c) {
    const aPad = padArea(item);
    const aPkg = c && fin(c.pkg_l) && fin(c.pkg_w) ? c.pkg_l * c.pkg_w : null;
    if (fin(aPad) && fin(aPkg)) return Math.min(aPad, aPkg);
    return fin(aPkg) ? aPkg : fin(aPad) ? aPad : null;
  }

  /**
   * A component's allowable load in psi. Force units are spread over the contact area.
   * → { psi, unit, value } | { psi: null, needsArea: true, unit, value } | null (not given)
   */
  function allowPsi(c, area) {
    if (!c || !fin(c.p_allow) || c.p_allow <= 0) return null;
    const u = schema.P_UNITS.find(x => x.v === c.p_unit) || schema.P_UNITS[0];
    if (u.kind === 'pressure') return { psi: r4(c.p_allow * u.toPsi), unit: u.v, value: c.p_allow };
    if (!fin(area) || area <= 0) return { psi: null, needsArea: true, unit: u.v, value: c.p_allow };
    return { psi: r4(c.p_allow * u.toN / (area * 1e-6) / PSI_PA), unit: u.v, value: c.p_allow };
  }

  /** Force (N) of a pressure (psi) over an area (mm²). */
  function forceN(psi, area) {
    return fin(psi) && fin(area) ? r4(psi * PSI_PA * area * 1e-6) : null;
  }

  const LEVEL = { na: 0, ok: 1, warn: 2, error: 3 };
  const worse = (a, b) => (LEVEL[b] > LEVEL[a] ? b : a);

  /**
   * Gap / compression / pressure check for one item.
   *  - compression C = (T − g) / T: C_min uses the largest gap, C_max the smallest; C_min below the minimum
   *    (item override → generic 10 %) or ≤ 0 (no contact) → error (Fail)
   *  - pressure: per covered component, from the material's deflection curves at C_max, against the
   *    component's allowable load: > 100 % → error (Fail), ≥ settings.pressure_warn_pct → warn
   * status: 'na' (no data), 'ok', 'warn', 'error'. comps: per-component rows (gap, compression, pressure, status).
   */
  function compressionCheck(item, mat, settings) {
    // msgs: warning / error texts; levels[i] is the level of msgs[i] ('warn' | 'error'); notes: informational
    const out = { min: null, nom: null, max: null, rec: null, status: 'na', msgs: [], levels: [], notes: [], gap: null, comps: [], pressure: null };
    const flag = (level, text) => { out.status = worse(out.status, level); out.msgs.push(text); out.levels.push(level); };
    if (!item || schema.isDispense((mat && mat.tim_type) || item.tim_type)) return out;
    const t = item.size && item.size.t;
    const gi = out.gap = gapInfo(item);
    if (!fin(t) || !gi.source) return out;
    out.max = fin(gi.min) ? compressionAt(t, gi.min) : null;
    out.min = fin(gi.max) ? compressionAt(t, gi.max) : null;
    out.nom = fin(gi.nom) ? compressionAt(t, gi.nom) : null;
    out.rec = recCompression(item, mat, settings);
    out.status = 'ok';
    const warnPct = fin(settings && settings.pressure_warn_pct) ? settings.pressure_warn_pct : schema.DEFAULT_SETTINGS.pressure_warn_pct;
    // several components with their own gaps: name the one that sets the worst value
    const who = key => {
      if (gi.source !== 'stack' || gi.comps.length < 2) return '';
      const x = gi.comps.find(y => y[key] === gi[key]);
      return x ? '（' + ([x.c.part, x.c.refdes].filter(Boolean).join(' ') || '元件') + '）' : '';
    };
    if (out.min !== null && out.min <= 0) flag('error', '最大間隙 ' + util.fmt(gi.max) + ' mm ≥ 厚度 ' + util.fmt(t) + ' mm' + who('max') + '，可能完全未接觸');
    else if (out.rec && out.min !== null && out.min < out.rec.min) flag('error', '最小壓縮 ' + util.fmt(out.min, 1) + '% 低於下限 ' + out.rec.min + '%' + who('max') + '（接觸可能不足）');
    if (out.max !== null && out.max >= 100) flag('error', '最小間隙 ≤ 0' + who('min') + '，請檢查間隙數值');

    const hasCurve = curveSet(mat).length > 0;
    out.pressure = fin(out.max) ? pressureAt(mat, t, out.max) : null;
    out.comps = gi.comps.map(x => {
      const row = { id: x.id, part: x.c.part, refdes: x.c.refdes, h: x.h, gap: { min: x.min, nom: x.nom, max: x.max },
        cMin: fin(x.max) ? compressionAt(t, x.max) : null, cNom: fin(x.nom) ? compressionAt(t, x.nom) : null, cMax: fin(x.min) ? compressionAt(t, x.min) : null,
        pMin: null, pMax: null, area: contactArea(item, x.c), force: null, allow: null, ratio: null, status: 'na', msg: '',
        loadType: x.c.load_type || '', exempt: false };
      // 受壓類型: E-PAD / QFN / LGA / leaded → the pressure is computed and shown, the allowable load is not judged
      const lt = schema.loadType(x.c.load_type);
      row.exempt = !!(lt && !lt.check);
      row.allow = row.exempt ? null : allowPsi(x.c, row.area);
      if (fin(row.cMax) && row.cMax > 0) row.pMax = pressureAt(mat, t, row.cMax);
      if (fin(row.cMin) && row.cMin > 0) row.pMin = pressureAt(mat, t, row.cMin);
      if (row.pMax) row.force = forceN(row.pMax.psi, row.area);
      const name = [x.c.part, x.c.refdes].filter(Boolean).join(' ') || '元件';
      if (lt && lt.check && !row.allow) row.msg = lt.short + ' 需檢核耐壓：請填元件規格書的 max static load';
      else if (row.allow && row.allow.needsArea) row.msg = '耐壓以力表示，需要封裝尺寸（L × W）才能換算壓力';
      else if (row.allow && !row.pMax && fin(row.cMax) && row.cMax > 0) row.msg = hasCurve ? '' : '材料沒有壓力–壓縮曲線，無法判定是否過壓';
      else if (row.allow && row.pMax && fin(row.allow.psi)) {
        row.ratio = r4(row.pMax.psi / row.allow.psi * 100);
        if (row.ratio > 100) {
          row.status = 'error';
          row.msg = name + '：壓力' + (row.pMax.beyond ? ' > ' : ' ') + util.fmt(row.pMax.psi, 1) + ' psi 超過耐壓 ' + util.fmt(row.allow.psi, 1) + ' psi';
        } else if (row.pMax.beyond) {
          row.status = 'warn';
          row.msg = name + '：壓縮 ' + util.fmt(row.cMax, 1) + '% 超出材料曲線範圍（> ' + util.fmt(row.pMax.psi, 1) + ' psi），無法確認是否過壓';
        } else if (row.ratio >= warnPct) {
          row.status = 'warn';
          row.msg = name + '：壓力 ' + util.fmt(row.pMax.psi, 1) + ' psi 達耐壓的 ' + util.fmt(row.ratio, 0) + '%（≥ ' + warnPct + '%）';
        } else row.status = 'ok';
      }
      if (row.status === 'error' || row.status === 'warn') flag(row.status, row.msg);
      else if (row.msg) out.notes.push(name + '：' + row.msg);
      return row;
    });
    if (gi.source === 'stack' && gi.ref !== null) {
      (item.covered || []).filter(c => !heightRange(c)).forEach(c => out.notes.push(([c.part, c.refdes].filter(Boolean).join(' ') || '元件') + '：未填元件高度，視為與基準元件同高、不含元件公差'));
    }
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
    const gi = gapInfo(item);
    const T = item.size && item.size.t;
    if (dispense) {
      if (fin(item.dispense && item.dispense.blt)) { t_c = item.dispense.blt; t_src = 'blt'; }
      else if (fin(gi.nom)) { t_c = gi.nom; t_src = 'gap'; }
    } else {
      if (fin(T) && fin(gi.nom)) { t_c = Math.min(T, gi.nom); t_src = 'gap'; }
      else if (fin(T)) { t_c = T; t_src = 'thickness'; }   // no gap data → uncompressed thickness (conservative)
    }
    const aPad = padArea(item);
    const res = { k, t_c, t_src, area: aPad, R_pad: null, rows: [], dt_max: null, contact: true };
    if (!dispense && fin(T) && fin(gi.nom) && gi.nom >= T) res.contact = false;
    const R = (area, tc) => (fin(k) && k > 0 && fin(tc) && fin(area) && area > 0) ? tc * 1000 / (k * area) : null;
    res.R_pad = R(aPad, t_c);
    const compGap = {};
    if (gi.source === 'stack') gi.comps.forEach(x => { compGap[x.id] = x.nom; });
    (item.covered || []).forEach(c => {
      const aPkg = fin(c.pkg_l) && fin(c.pkg_w) ? c.pkg_l * c.pkg_w : null;
      let area = aPad;
      if (fin(aPkg)) area = fin(aPad) ? Math.min(aPad, aPkg) : (dispense ? aPkg : null);
      // stack-up: each component has its own nominal gap (taller component → thinner TIM)
      const tc = !dispense && fin(T) && fin(compGap[c.id]) ? Math.min(T, compGap[c.id]) : t_c;
      const r = R(area, tc);
      const p = timPower(c);
      const dT = fin(r) && fin(p) ? r * p : null;
      res.rows.push({ id: c.id, part: c.part, refdes: c.refdes, qty: c.qty, power_total: fin(c.power_w) ? c.power_w : null, top_pct: fin(c.top_pct) ? c.top_pct : null, power: p, area, t_c: tc, R: r, dT });
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
      const twin = libraryMatch(db, it);
      if (twin) add('warn', 'unlinked_material', it, label + '：Vendor / Model 與材料庫的 ' + twin.vendor + ' ' + twin.model + ' 相同但未連結（k 值、壓力曲線不會帶入）');
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
      else if (cc.status === 'na' && !dispense && fin(it.size.t)) add('info', 'no_gap', it, label + '：未填設計間距（或手動間隙），無法檢核壓縮率');
      cc.notes.forEach(m => add('info', 'pressure_na', it, label + '：' + m));

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
    'fabricator', 'covered', 'gap_design', 'gap', 'sources', 'status', 'price', 'note'];

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
      gap_design: item.gap_design && fin(item.gap_design.nom) ? util.fmt(item.gap_design.nom) + ' +' + util.fmt(fin(item.gap_design.plus) ? item.gap_design.plus : 0) + ' / −' + util.fmt(fin(item.gap_design.minus) ? item.gap_design.minus : 0) + (item.gap_flat ? '（同一平面）' : '') : '',
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
    const label = f => ({ location: 'Location', used_on: 'Used On', vendor: 'Vendor', model: 'Model', tim_type: '型態', size: 'Size', qty: "Q'ty", delta_pn: 'Delta P/N', vendor_pn: 'Vendor P/N', fabricator: '加工廠', covered: '覆蓋元件', gap_design: '設計間距 ± 公差', gap: '間隙 min/nom/max', sources: '2nd source', status: '狀態', price: '單價', note: '備註' }[f] || f);
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

  // ───────── known components: 覆蓋元件 entered before, in any project (元件快選 in the RefDes field) ─────────

  /**
   * What is copied from a known component besides its name (RefDes + 元件料號), in groups that always travel
   * together (the three heights of one package drawing, a load and its unit…). 數量 / 備註 belong to the design.
   */
  const COMP_GROUPS = [
    { key: 'cat', label: '類別', fields: ['cat'] },
    { key: 'power', label: '功耗', fields: ['power_w'] },
    { key: 'top', label: '頂面 %', fields: ['top_pct'] },
    { key: 'pkg', label: '封裝', fields: ['pkg_l', 'pkg_w'] },
    { key: 'height', label: '高度', fields: ['h_min', 'h_nom', 'h_max'] },
    { key: 'allow', label: '耐壓', fields: ['p_allow', 'p_unit'], has: ['p_allow'] },
    { key: 'load', label: '受壓類型', fields: ['load_type'] },
  ];
  const filledVal = v => v !== null && v !== undefined && v !== '';
  const groupHas = (c, g) => (g.has || g.fields).some(f => filledVal(c[f]));
  /** Name as a lookup key: half-width, trimmed, single spaces, upper case. */
  const nameKey = s => util.toHalfWidth(String(s == null ? '' : s)).trim().replace(/\s+/g, ' ').toUpperCase();

  /**
   * Components already entered in 覆蓋元件 of any project, one entry per name — RefDes and 元件料號 as entered
   * (many rows carry only the component name in RefDes, so the part number alone is not the key):
   * { key, rkey, pkey, refdes, part, name, values:{field:value}, from:{group:{pid, project, item_no}},
   *   uses:[{pid, project, item_id, item_no}], differs:[group labels whose values are not the same everywhere] }.
   * Each group comes from the most recently updated project that has it (the project being edited wins; an
   * older one fills what it leaves empty). Order: most recently used first. opts.exclude: covered id to skip.
   */
  function knownComponents(db, opts) {
    opts = opts || {};
    const map = new Map();
    Object.values((db && db.projects) || {}).slice()
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))
      .forEach(p => (p.items || []).forEach(it => (it.covered || []).forEach(c => {
        if (!c || c.id === opts.exclude) return;
        const rkey = nameKey(c.refdes), pkey = nameKey(c.part);
        if (!rkey && !pkey) return;
        const key = rkey + '|' + pkey;
        let e = map.get(key);
        if (!e) {
          const refdes = String(c.refdes || '').trim(), part = String(c.part || '').trim();
          e = { key, rkey, pkey, refdes, part, name: refdes || part, values: {}, from: {}, uses: [], sigs: {} };
          map.set(key, e);
        }
        e.uses.push({ pid: p.id, project: p.name || '', item_id: it.id, item_no: it.item_no || '' });
        COMP_GROUPS.forEach(g => {
          if (!groupHas(c, g)) return;
          const vals = g.fields.map(f => (filledVal(c[f]) ? c[f] : null));
          (e.sigs[g.key] = e.sigs[g.key] || new Set()).add(JSON.stringify(vals));
          if (e.from[g.key]) return;
          g.fields.forEach((f, i) => { e.values[f] = vals[i]; });
          e.from[g.key] = { pid: p.id, project: p.name || '', item_no: it.item_no || '' };
        });
      })));
    return Array.from(map.values()).map(e => {
      e.differs = COMP_GROUPS.filter(g => e.sigs[g.key] && e.sigs[g.key].size > 1).map(g => g.label);
      delete e.sigs;
      return e;
    });
  }

  /**
   * Known components for typed text, matched on RefDes or 元件料號: exact, starts with, contains, then ignoring
   * - / spaces; most recently used first within each. Empty text = all, most recent first. → entries (at most `limit`).
   */
  function matchKnown(known, text, limit) {
    const q = nameKey(text);
    const n = limit || 50;
    if (!q) return known.slice(0, n);
    const compact = s => s.replace(/[^0-9A-Z\u0080-\uFFFF]/g, '');
    const qc = compact(q);
    const rank1 = k => (!k ? 9 : k === q ? 0 : k.startsWith(q) ? 1 : k.includes(q) ? 2 : qc && compact(k).includes(qc) ? 3 : 9);
    return known.map((e, i) => ({ e, i, r: Math.min(rank1(e.rkey), rank1(e.pkey)) })).filter(x => x.r < 9)
      .sort((a, b) => a.r - b.r || a.i - b.i)   // same match quality: most recently used first
      .slice(0, n).map(x => x.e);
  }

  /**
   * Known components grouped by 類別 (the order of schema.CATEGORIES, other text after, 未分類 last), order inside a
   * group kept → [{ cat, label, color, items }].
   */
  function groupKnown(list) {
    const order = schema.CATEGORIES.map(c => c.v);
    const groups = new Map();
    (list || []).forEach(e => {
      const cat = e.values.cat || '';
      if (!groups.has(cat)) {
        const def = schema.CATEGORIES.find(c => c.v === cat);
        groups.set(cat, { cat, label: cat ? (def ? def.label : cat) : '未分類', color: def ? def.color : '#94A3B8', items: [] });
      }
      groups.get(cat).items.push(e);
    });
    const rank = g => (!g.cat ? 1e4 : order.indexOf(g.cat) >= 0 ? order.indexOf(g.cat) : 1e3);
    return Array.from(groups.values()).sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
  }

  /** Fields written when a known component is picked: its name (RefDes + 元件料號) + every group it has (overwrites those). */
  function knownPatch(e) {
    const patch = { refdes: e.refdes, part: e.part };
    COMP_GROUPS.forEach(g => { if (e.from[g.key]) g.fields.forEach(f => { patch[f] = e.values[f]; }); });
    return patch;
  }

  /** "RF · 功耗 5 W · 封裝 11 × 7 · 高度 1.1 / 1.2 / 1.3 · 耐壓 1 kgf" — the filled groups of a component. */
  function componentSummary(v, opts) {
    const o = opts || {};
    const f = x => (fin(x) ? util.fmt(x, 4) : '—');
    const out = [];
    if (o.cat !== false && v.cat) out.push(v.cat);
    if (schema.loadType(v.load_type)) out.push(schema.loadType(v.load_type).short);
    if (fin(v.power_w)) out.push('功耗 ' + f(v.power_w) + ' W');
    if (fin(v.top_pct)) out.push('頂面 ' + f(v.top_pct) + '%');
    if (fin(v.pkg_l) || fin(v.pkg_w)) out.push('封裝 ' + f(v.pkg_l) + ' × ' + f(v.pkg_w));
    if (['h_min', 'h_nom', 'h_max'].some(k => fin(v[k]))) out.push('高度 ' + ['h_min', 'h_nom', 'h_max'].map(k => f(v[k])).join(' / '));
    if (fin(v.p_allow)) out.push('耐壓 ' + f(v.p_allow) + ' ' + (v.p_unit || 'psi'));
    return out.join(' · ');
  }

  return {
    knownComponents, matchKnown, groupKnown, knownPatch, componentSummary, nameKey, COMP_GROUPS,
    libraryMatch, materialOf, effective, padArea, compressionAt, timPower, recCompression, compressionCheck, thermalEstimate,
    designRange, heightRange, gapInfo, curveSet, pressureAt, contactArea, allowPsi, forceN, PSI_PA,
    sourceRisk, placedCount, placedCounts, coveredQty, itemCost, itemColor, locationOf, orderedItems,
    projectChecks, projectStats, materialUsage, itemDigest, makeSnapshot, diffSnapshots,
    whereUsed, materialUseCount, searchItems,
  };
});
