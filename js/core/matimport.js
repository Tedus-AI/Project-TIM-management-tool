/* Material import (材料匯入): the "tim-material" JSON an AI writes after reading a vendor
 * datasheet, the prompt that asks for exactly that, and parsing / normalising / planning the
 * merge into the library. FIELDS is the single source of truth for the prompt, the parser and
 * the preview. No DOM.
 *
 *   { "format": "tim-material", "version": 1,
 *     "materials": [ { "vendor": "...", "model": "...", "k": 7.5, ..., "evidence": { "k": "p.1 …" } } ] }
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const schema = isNode ? require('./schema.js') : root.TIM.schema;
  const mod = factory(util, schema);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.matImport = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, schema) {
  'use strict';

  const FORMAT = 'tim-material';
  const VERSION = 1;

  const FIELDS = [
    { key: 'vendor', label: 'Vendor', kind: 'text', required: true, hint: '廠商名稱：常用簡稱，不要加 Inc. / Co., Ltd. 等公司後綴（才能對上材料庫裡已有的材料）' },
    { key: 'model', label: 'Model', kind: 'text', required: true, hint: '型號（產品系列名，不含厚度）' },
    { key: 'tim_type', label: '型態', kind: 'enum', values: schema.TIM_TYPES.map(t => t.v),
      hint: schema.TIM_TYPES.map(t => t.v + ' = ' + t.label + '（' + t.zh + '）').join('、') },
    { key: 'parts', label: '劑型', kind: 'enum', values: schema.PARTS.map(p => p.v),
      hint: '只有 ' + schema.TIM_TYPES.filter(t => t.parts).map(t => t.v).join(' / ') + ' 才填：one_part = 單劑型（1-part）、two_part = 雙劑型（2-part，A / B 兩劑混合）；其他型態填 null' },
    { key: 'color', label: '顏色', kind: 'text' },
    { key: 'k', label: '熱傳導係數 k', kind: 'num', unit: 'W/m·K' },
    { key: 'k_method', label: 'k 量測標準', kind: 'enum', values: schema.K_METHODS, hint: '規格書沒寫量測方法時填 "Other / 未註明"' },
    { key: 'impedance', label: '熱阻抗', kind: 'num', unit: '°C·cm²/W', hint: 'K·cm²/W 與 °C·cm²/W 相同；°C·in²/W × 6.4516、°C·mm²/W ÷ 100 換算；有多個壓力 / 厚度時取最常用的一組' },
    { key: 'impedance_cond', label: '熱阻抗條件', kind: 'text', hint: '上面那個熱阻抗的壓力與厚度，例如 "@10 psi, 1.0 mm"' },
    { key: 'thickness_options', label: '可用厚度', kind: 'text', hint: '例如 "0.5–5.0 mm（0.5 mm 一級）"' },
    { key: 'hardness', label: '硬度', kind: 'num' },
    { key: 'hardness_scale', label: '硬度標準', kind: 'enum', values: schema.HARDNESS_SCALES },
    { key: 'density', label: '密度', kind: 'num', unit: 'g/cm³' },
    { key: 'temp_min', label: '使用溫度 min', kind: 'num', unit: '°C', hint: '°F 要換算成 °C' },
    { key: 'temp_max', label: '使用溫度 max', kind: 'num', unit: '°C' },
    { key: 'dielectric_kv_mm', label: '絕緣耐壓', kind: 'num', unit: 'kV/mm', hint: 'V/mil ÷ 25.4 = kV/mm；只給某厚度的崩潰電壓 kV 時除以該厚度（mm）' },
    { key: 'volume_resistivity', label: '體積電阻', kind: 'text', hint: '連單位一起，例如 "1E13 Ω·cm"' },
    { key: 'dk', label: '介電常數 Dk', kind: 'num' },
    { key: 'dk_freq', label: 'Dk 頻率', kind: 'text', hint: '例如 "1 MHz"' },
    { key: 'absorber_freq', label: '吸波頻段', kind: 'text', hint: '吸波材才填，例如 "2–18 GHz"' },
    { key: 'silicone', label: '矽系', kind: 'enum', values: schema.SILICONE.map(s => s.v), hint: 'silicone = 矽系、low_volatile = 低揮發矽、silicone_free = 非矽系' },
    { key: 'outgassing', label: '出油 / 揮發', kind: 'text', hint: '例如 "TML 0.12 %, CVCM 0.02 %"、oil bleed 數值' },
    { key: 'ul94', label: 'UL94', kind: 'enum', values: schema.UL94 },
    { key: 'rohs', label: 'RoHS', kind: 'bool' },
    { key: 'reach', label: 'REACH', kind: 'bool' },
    { key: 'halogen_free', label: '無鹵', kind: 'bool' },
    { key: 'pressure_curves', label: '壓力–壓縮曲線', kind: 'curves',
      hint: '規格書的 Deflection vs Pressure（壓縮率–壓力）曲線或表格，每個厚度一筆 { "thickness_mm": 1.0, "points": [[壓力 psi, 壓縮率 %], …] }。' +
        '壓力換算成 psi（kPa ÷ 6.895、MPa × 145.04、kgf/cm² × 14.22、N/cm² × 1.450），厚度換算成 mm（mil ÷ 39.37、inch × 25.4；圖例是料號時依規格書的料號規則換算，例如料號尾碼 1000 µm = 1.0 mm）。' +
        '只有曲線圖時每條讀 4–8 個點（讀圖取點不算推測，但 evidence 要註明「讀圖」）；只有單點（例如「Deflection @10 psi on 1 mm: 8 %」）也寫成一點；沒有就填 null' },
    { key: 'curve_note', label: '曲線出處', kind: 'text', hint: '例如 "p.2 Deflection vs Pressure 讀圖值"' },
    { key: 'shelf_life_months', label: '保存期限', kind: 'num', unit: '月' },
    { key: 'storage', label: '保存條件', kind: 'text' },
    { key: 'price_ref', label: '參考價格', kind: 'text' },
    { key: 'moq', label: 'MOQ', kind: 'num' },
    { key: 'lead_time_wk', label: '交期', kind: 'num', unit: '週' },
    { key: 'note', label: '備註', kind: 'text', hint: '規格書上重要但沒有對應欄位的資訊（不同厚度的 k 值、測試條件、注意事項）' },
  ];
  const BY_KEY = {};
  FIELDS.forEach(f => { BY_KEY[f.key.toLowerCase()] = f; });
  const META_KEYS = ['evidence', '_evidence', 'source', '_source', 'format', 'version'];

  // ───────── values ─────────
  const low = s => util.toHalfWidth(String(s == null ? '' : s)).trim().toLowerCase();
  const empty = v => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
  const same = (a, b) => a === b || (typeof a === 'object' && a !== null && JSON.stringify(a) === JSON.stringify(b));

  /** "7.5 W/m·K" / "−40" / "≥ 6" / "1,200" → number; NaN when there is none. */
  function toNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = util.toHalfWidth(String(v)).replace(/[−–—]/g, '-').replace(/,(?=\d{3}(\D|$))/g, '');
    const m = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(s);
    return m ? parseFloat(m[0]) : NaN;
  }
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    const s = low(v);
    if (/^(false|no|n|0|否|無|不符合)$/.test(s) || /non-?compliant|not compliant|不符合/.test(s)) return false;
    if (/^(true|yes|y|1|是|有|符合|pass|ok)$/.test(s) || /compliant|符合/.test(s)) return true;
    return undefined;
  }
  const TYPE_WORDS = [
    ['absorber', /absorb|吸波|emi/], ['gap_filler', /gap ?filler|dispens|liquid|填隙|點膠/], ['gel', /\bgel\b|凝膠/],
    ['putty', /putty|導熱泥/], ['grease', /grease|paste|compound|導熱膏|散熱膏|矽脂/], ['pcm', /phase ?change|\bpcm\b|相變/],
    ['graphite', /graphite|石墨/], ['tape', /tape|膠帶|adhesive/], ['pad', /pad|sheet|墊|片/],
  ];
  function enumValue(f, v) {
    const s = low(v);
    if (!s) return undefined;
    const exact = f.values.find(x => low(x) === s);
    if (exact) return exact;
    if (f.key === 'tim_type') {
      const t = schema.TIM_TYPES.find(x => low(x.label) === s || low(x.zh) === s);
      if (t) return t.v;
      const w = TYPE_WORDS.find(([, re]) => re.test(s));
      return w ? w[0] : undefined;
    }
    if (f.key === 'k_method') {
      if (/5470/.test(s)) return 'ASTM D5470';
      if (/hot ?disk|22007|transient plane/.test(s)) return 'ISO 22007-2 (Hot Disk)';
      if (/1461|laser|flash|lfa/.test(s)) return 'ASTM E1461 (Laser Flash)';
      return 'Other / 未註明';
    }
    if (f.key === 'hardness_scale') {
      if (/asker/.test(s)) return 'Asker C';
      if (/00|oo/.test(s)) return 'Shore 00';
      if (/shore ?a\b|^a$/.test(s)) return 'Shore A';
      if (/shore ?c\b|^c$/.test(s)) return 'Shore C';
      return undefined;
    }
    if (f.key === 'silicone') {
      if (typeof v === 'boolean') return v ? 'silicone' : 'silicone_free';
      if (/free|non|不含|非矽|無矽/.test(s)) return 'silicone_free';
      if (/low|低/.test(s)) return 'low_volatile';
      if (/silicon|矽|siloxane/.test(s)) return 'silicone';
      return undefined;
    }
    if (f.key === 'parts') {
      if (v === 2 || /雙|兩劑|二液|2液|\btwo\b|^2$|\b2\s*-?\s*(part|k|c)\b|\ba\s*[\/+&]\s*b\b/.test(s)) return 'two_part';
      if (v === 1 || /單|一液|1液|\bone\b|\bsingle\b|^1$|\b1\s*-?\s*(part|k|c)\b/.test(s)) return 'one_part';
      return undefined;
    }
    if (f.key === 'ul94') {
      const m = /v-?\s*([012])/.exec(s);
      if (m) return 'V-' + m[1];
      if (/hb/.test(s)) return 'HB';
      if (/n\/?a|none|not/.test(s)) return 'N/A';
      return undefined;
    }
    return undefined;
  }

  /** One field value → { value } or { warn }. */
  function normalizeValue(f, v) {
    if (f.kind === 'num') {
      const n = toNum(v);
      if (Number.isNaN(n)) return { warn: '「' + f.label + '」不是數字：' + String(v) };
      const several = typeof v === 'string' && (util.toHalfWidth(v).replace(/,(?=\d{3})/g, '').match(/\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).length > 1;
      return several ? { value: n, warn: '「' + f.label + '」有好幾個數字，只取第一個：' + String(v) + ' → ' + n } : { value: n };
    }
    if (f.kind === 'bool') {
      const b = toBool(v);
      return b === undefined ? { warn: '「' + f.label + '」看不懂是否符合：' + String(v) } : { value: b };
    }
    if (f.kind === 'enum') {
      const e = enumValue(f, v);
      return e === undefined ? { warn: '「' + f.label + '」不在選項內：' + String(v) } : { value: e };
    }
    if (f.kind === 'curves') return curvesValue(f, v);
    return { value: String(v).trim() };
  }

  /**
   * pressure_curves → [{ t, points: [[psi, %], …] }]. Accepts thickness_mm / thickness / t, and points as
   * [psi, %] pairs or { psi | pressure_psi | pressure, pct | deflection_pct | deflection } objects.
   */
  function curvesValue(f, v) {
    const list = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : null);
    if (!list) return { warn: '「' + f.label + '」不是陣列：' + String(v) };
    let dropped = 0;
    const raw = list.filter(c => c && typeof c === 'object').map(c => {
      const t = toNum(c.thickness_mm != null ? c.thickness_mm : c.thickness != null ? c.thickness : c.t);
      const pts = (Array.isArray(c.points) ? c.points : []).map(p => {
        const pair = Array.isArray(p) ? [p[0], p[1]]
          : p && typeof p === 'object' ? [p.psi != null ? p.psi : p.pressure_psi != null ? p.pressure_psi : p.pressure, p.pct != null ? p.pct : p.deflection_pct != null ? p.deflection_pct : p.deflection] : [];
        const n = pair.map(x => (x == null ? NaN : toNum(x)));
        if (Number.isNaN(n[0]) || Number.isNaN(n[1])) { dropped++; return null; }
        return n;
      }).filter(Boolean);
      return { t: Number.isNaN(t) ? null : t, points: pts };
    });
    const value = schema.normalizeCurves(raw);
    const lost = raw.length - value.length;
    const warns = [];
    if (dropped) warns.push(dropped + ' 個點不是數字');
    if (lost) warns.push(lost + ' 條沒有厚度或沒有點');
    if (!value.length) return { warn: '「' + f.label + '」沒有可用的曲線' + (warns.length ? '（' + warns.join('、') + '）' : '') };
    return warns.length ? { value, warn: '「' + f.label + '」略過：' + warns.join('、') } : { value };
  }

  // ───────── input ─────────
  /** The JSON in an AI reply: bare, in a ``` code block, or surrounded by other text. */
  function extractJson(text) {
    let t = String(text == null ? '' : text).replace(/^﻿/, '').trim();
    if (!t) throw new Error('沒有內容');
    const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(t);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch (e) { /* look for the object inside */ }
    const i = t.search(/[{[]/);
    const j = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (i >= 0 && j > i) { try { return JSON.parse(t.slice(i, j + 1)); } catch (e) { /* fall through */ } }
    throw new Error('找不到可讀的 JSON：請確認 AI 只輸出 JSON（可用「複製 AI 指令」重新要求）');
  }

  /**
   * Parse an AI reply / file → { entries: [{ fields, evidence, warnings }], warnings }.
   * Entries without vendor and model are dropped with a warning.
   */
  function parse(text) {
    const obj = extractJson(text);
    const warnings = [];
    let list;
    if (Array.isArray(obj)) list = obj;
    else if (obj && Array.isArray(obj.materials)) list = obj.materials;
    else if (obj && typeof obj === 'object' && (obj.vendor || obj.model)) list = [obj];
    else throw new Error('JSON 裡沒有 materials 清單');
    if (obj && !Array.isArray(obj) && obj.format && obj.format !== FORMAT) warnings.push('format 是「' + obj.format + '」，不是 ' + FORMAT + '，仍嘗試讀取');
    const entries = [];
    list.forEach((m, i) => {
      if (!m || typeof m !== 'object' || Array.isArray(m)) { warnings.push('第 ' + (i + 1) + ' 筆不是物件，略過'); return; }
      const fields = {}, ew = [], unknown = [];
      Object.keys(m).forEach(k => {
        if (META_KEYS.includes(k.toLowerCase())) return;
        const f = BY_KEY[k.toLowerCase()];
        if (!f) { if (!empty(m[k])) unknown.push(k); return; }
        if (empty(m[k])) return;
        const r = normalizeValue(f, m[k]);
        if (r.warn) ew.push(r.warn);
        if (r.value !== undefined) fields[f.key] = r.value;
      });
      if (unknown.length) ew.push('沒有對應欄位，未匯入：' + unknown.join('、'));
      if (!fields.vendor && !fields.model) { warnings.push('第 ' + (i + 1) + ' 筆沒有 vendor / model，略過'); return; }
      if (fields.parts && !schema.hasParts(fields.tim_type)) {
        ew.push('「劑型」只用在 ' + schema.TIM_TYPES.filter(t => t.parts).map(t => t.label).join(' / ') + '，未匯入');
        delete fields.parts;
      }
      const ev = m.evidence || m._evidence;
      const evidence = {};
      if (ev && typeof ev === 'object') Object.keys(ev).forEach(k => { const f = BY_KEY[k.toLowerCase()]; if (f && !empty(ev[k])) evidence[f.key] = String(ev[k]); });
      entries.push({ fields, evidence, warnings: ew });
    });
    if (!entries.length) throw new Error('沒有可匯入的材料');
    return { entries, warnings };
  }

  // ───────── merge plan ─────────
  const keyOf = (vendor, model) => (String(vendor || '') + '|' + String(model || '')).trim().toUpperCase();

  /** Library material with the same vendor + model (case-insensitive), or null. */
  function findMatch(materials, fields) {
    const k = keyOf(fields.vendor, fields.model);
    return Object.values(materials || {}).find(m => keyOf(m.vendor, m.model) === k) || null;
  }

  /**
   * What an import row would change. action: 'new' | 'fill' (only empty fields) | 'overwrite' | 'skip'.
   * opts.keepName: re-import of a chosen material — its Vendor / Model stay as they are in the library.
   * Returns [{ key, label, unit, from, to }].
   */
  function changesFor(entry, existing, action, opts) {
    if (action === 'skip') return [];
    const out = [];
    const keepName = !!(opts && opts.keepName && existing);
    FIELDS.forEach(f => {
      if (!(f.key in entry.fields)) return;
      if (keepName && (f.key === 'vendor' || f.key === 'model')) return;
      const to = entry.fields[f.key];
      const from = existing ? existing[f.key] : undefined;
      if (action === 'fill' && existing && !empty(from)) return;
      if (existing && same(from, to)) return;
      out.push({ key: f.key, label: f.label, unit: f.unit || '', from: empty(from) ? null : from, to });
    });
    // 劑型 follows the resulting type: dropped when it ends up without one, cleared when the type changes away
    const tt = out.find(c => c.key === 'tim_type');
    const typeAfter = tt ? tt.to : existing ? existing.tim_type : entry.fields.tim_type;
    if (!schema.hasParts(typeAfter)) {
      const i = out.findIndex(c => c.key === 'parts');
      if (i >= 0) out.splice(i, 1);
      if (existing && !empty(existing.parts)) out.push({ key: 'parts', label: BY_KEY.parts.label, unit: '', from: existing.parts, to: '' });
    }
    return out;
  }

  /**
   * Rows for the preview: one per entry, matched against the library, default action.
   * targetId (重新匯入 from a material): the entry with that material's Vendor + Model — or the first one —
   * updates it (default 覆蓋, names kept, nameDiff set when the AI wrote other names); the rest as usual.
   */
  function plan(parsed, materials, targetId) {
    const target = targetId && materials && materials[targetId];
    let ti = -1;
    if (target) {
      ti = parsed.entries.findIndex(e => keyOf(e.fields.vendor, e.fields.model) === keyOf(target.vendor, target.model));
      if (ti < 0) ti = 0;
    }
    return parsed.entries.map((entry, i) => {
      if (i === ti) {
        const diff = keyOf(entry.fields.vendor, entry.fields.model) !== keyOf(target.vendor, target.model);
        return { i, entry, matchId: target.id, action: 'overwrite', target: true, keepName: true,
          nameDiff: diff ? [entry.fields.vendor, entry.fields.model].filter(Boolean).join(' ') : '' };
      }
      const match = findMatch(materials, entry.fields);
      const action = match ? (target && match.id === target.id ? 'skip' : 'fill') : 'new';
      return { i, entry, matchId: match ? match.id : null, action };
    });
  }

  // ───────── prompt & example ─────────
  function example() {
    return {
      format: FORMAT, version: VERSION,
      materials: [{
        vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', parts: null, color: 'Gray',
        k: 7.5, k_method: 'ASTM D5470', impedance: 0.45, impedance_cond: '@10 psi, 1.0 mm',
        thickness_options: '0.5–5.0 mm（0.5 mm 一級）', hardness: 45, hardness_scale: 'Shore 00', density: 3.2,
        temp_min: -40, temp_max: 200, dielectric_kv_mm: 6, volume_resistivity: '1E13 Ω·cm', dk: 7.1, dk_freq: '1 MHz', absorber_freq: null,
        silicone: 'silicone', outgassing: 'TML 0.12 %', ul94: 'V-0', rohs: true, reach: true, halogen_free: null,
        pressure_curves: [
          { thickness_mm: 1.0, points: [[10, 13], [20, 38], [30, 55], [50, 68]] },
          { thickness_mm: 2.0, points: [[10, 45], [20, 70], [50, 85]] },
        ],
        curve_note: 'p.2 Deflection vs Pressure 讀圖值',
        shelf_life_months: 12, storage: '5–35 °C', price_ref: null, moq: null, lead_time_wk: null,
        note: 'k 為 1.0 mm 厚度的值；2.0 mm 以上為 7.0 W/m·K',
        evidence: { k: 'p.1 Thermal Conductivity 7.5 W/m-K (ASTM D5470)', temp_max: 'p.1 Operating Temp. -40 to 200 °C', pressure_curves: 'p.2 Deflection vs Pressure（讀圖）' },
      }],
    };
  }

  /**
   * Instructions to give the AI together with the datasheet.
   * opts.target { vendor, model }: re-import — the AI must keep those names and output only that material.
   */
  function prompt(opts) {
    const target = opts && opts.target;
    const lines = FIELDS.map(f => '- ' + f.key + '：' + f.label + (f.unit ? '（單位 ' + f.unit + '）' : '') +
      (f.kind === 'num' ? '，數字' : f.kind === 'bool' ? '，true / false' : f.kind === 'enum' ? '，只能是 ' + f.values.map(v => JSON.stringify(v)).join(' / ') : f.kind === 'curves' ? '，陣列' : '，文字') +
      (f.hint ? '。' + f.hint : ''));
    return [
      '請閱讀我附上的 TIM（導熱介面材料）廠商規格書，把數據整理成下面格式的 JSON，用來匯入「專案 TIM 管理器」的材料庫。',
      target ? '這次是更新材料庫裡已有的材料：vendor 請填 ' + JSON.stringify(target.vendor || '') + '、model 請填 ' + JSON.stringify(target.model || '') + '（照抄），只輸出這一種材料。' : null,
      '',
      '規則：',
      '1. 只填規格書上明確寫出的資料；沒寫的填 null。不要推測，也不要用其他型號或一般常識補數字（RoHS / REACH / 無鹵等合規欄位也一樣）。曲線圖可以讀圖取點。',
      '2. 數字欄只放數字（不要帶單位），並換算成下面指定的單位。',
      '3. 一份規格書有多個型號 / 等級時，每個型號一筆；同一型號的不同厚度只算一筆：厚度範圍寫在 thickness_options，數值用規格書的 typical 值（或最常用厚度的值），差異寫在 note。',
      '4. evidence：每個非 null 的數值欄，寫出規格書上的原文與頁碼，方便人工核對。',
      '5. 只輸出 JSON（可放在 ```json 區塊內），不要其他說明文字。',
      '',
      '欄位（key 照抄）：',
      lines.join('\n'),
      '',
      '格式（format 與 version 照抄；materials 是陣列）：',
      JSON.stringify(example(), null, 2),
    ].filter(l => l !== null).join('\n');
  }

  return { FORMAT, VERSION, FIELDS, toNum, toBool, enumValue, extractJson, parse, findMatch, changesFor, plan, example, prompt };
});
