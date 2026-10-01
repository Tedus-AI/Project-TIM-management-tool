/* TIM Management Tool — generic helpers (no DOM). Works in browser and Node. */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.util = mod; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let _uidCounter = 0;
  /** Short unique id with a readable prefix, e.g. uid('itm') → "itm_lq3k9a_x7f2". */
  function uid(prefix) {
    _uidCounter = (_uidCounter + 1) % 1679616;
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 6);
    const c = _uidCounter.toString(36);
    return (prefix || 'id') + '_' + t + r + c;
  }

  /** Full-width ASCII (Ａ１．＊ etc.) → half-width, and ideographic space → space. */
  function toHalfWidth(s) {
    return String(s).replace(/[！-～]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
      .replace(/　/g, ' ');
  }

  /**
   * Parse a user-typed number. Accepts "1,234.5", " 3 ", "２．５", "4 pcs", "4片".
   * Returns null for empty / unparseable input (never NaN).
   */
  function num(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = toHalfWidth(String(v)).trim();
    if (!s) return null;
    s = s.replace(/,(?=\d{3}(\D|$))/g, '');           // thousands separators
    const m = s.match(/^[+-]?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?/i);
    if (!m) return null;
    const n = parseFloat(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function round(v, digits) {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round(v * f) / f;
  }

  /** Format a number for display; '' for null. Trims trailing zeros. */
  function fmt(v, digits) {
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '';
    const r = round(Number(v), digits == null ? 2 : digits);
    return String(r);
  }

  /** Fixed-decimals format (keeps zeros), '' for null. */
  function fmtFixed(v, digits) {
    if (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) return '';
    return Number(v).toFixed(digits == null ? 1 : digits);
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  function clone(o) {
    if (o === undefined) return undefined;
    return JSON.parse(JSON.stringify(o));
  }

  /** Escape the five HTML-significant characters. */
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function nowIso() { return new Date().toISOString(); }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** ISO → "YYYY-MM-DD HH:mm" in local time ('' for invalid). */
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** ISO → "YYYY-MM-DD" in local time. */
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso).slice(0, 10);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayStr() { return fmtDate(new Date().toISOString()); }

  /** "3 分鐘前" style relative time (falls back to the date). */
  function fmtAgo(iso, now) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = ((now || Date.now()) - t) / 1000;
    if (diff < 60) return '剛剛';
    if (diff < 3600) return Math.floor(diff / 60) + ' 分鐘前';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小時前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return fmtDate(iso);
  }

  /** Normalise a header / key for fuzzy matching: lower-case, no spaces or punctuation. */
  function normalizeKey(s) {
    return toHalfWidth(String(s == null ? '' : s)).toLowerCase()
      .replace(/[\s_\-.:'"’`/\\()[\]{}#*&]+/g, '');
  }

  /**
   * Natural compare for item numbers: "A1-1" < "A1-2" < "A2" < "A10" < "B1".
   * Numbers inside the string compare numerically.
   */
  function naturalCompare(a, b) {
    const ax = String(a == null ? '' : a).toUpperCase().match(/(\d+(\.\d+)?|\D+)/g) || [];
    const bx = String(b == null ? '' : b).toUpperCase().match(/(\d+(\.\d+)?|\D+)/g) || [];
    const n = Math.min(ax.length, bx.length);
    for (let i = 0; i < n; i++) {
      const x = ax[i], y = bx[i];
      const xn = /^\d/.test(x), yn = /^\d/.test(y);
      if (xn && yn) {
        const d = parseFloat(x) - parseFloat(y);
        if (d) return d < 0 ? -1 : 1;
      } else if (x !== y) {
        if (xn !== yn) return xn ? -1 : 1;
        return x < y ? -1 : 1;
      }
    }
    return ax.length - bx.length;
  }

  /**
   * Suggest the next item number. Existing ["A1-1","A1-2","A2","A8"] → "A9".
   * prefix defaults to the most common letter prefix, else "A".
   */
  function nextItemNo(existing, prefix) {
    const list = (existing || []).filter(Boolean).map(String);
    if (!prefix) {
      const counts = {};
      list.forEach(s => { const m = s.match(/^([A-Za-z]+)/); if (m) counts[m[1].toUpperCase()] = (counts[m[1].toUpperCase()] || 0) + 1; });
      prefix = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'A';
    }
    let max = 0;
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)', 'i');
    list.forEach(s => { const m = s.match(re); if (m) max = Math.max(max, parseInt(m[1], 10)); });
    return prefix + (max + 1);
  }

  /** Suggest the next sub-number for a variant: "A1" or "A1-1" with existing A1-1,A1-2 → "A1-3". */
  function nextVariantNo(base, existing) {
    const root = String(base).replace(/-\d+$/, '');
    let max = 0;
    (existing || []).forEach(s => {
      const m = String(s).match(new RegExp('^' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$', 'i'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return root + '-' + (max + 1);
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function () {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => { t = null; fn.apply(self, args); }, ms);
    };
    d.cancel = () => { clearTimeout(t); t = null; };
    d.pending = () => t !== null;
    return d;
  }

  /** Stable, human-oriented string for a value in change logs. */
  function displayValue(v) {
    if (v === null || v === undefined || v === '') return '（空）';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '（空）';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function sum(arr, f) {
    let s = 0;
    (arr || []).forEach((x, i) => { const v = f ? f(x, i) : x; if (Number.isFinite(v)) s += v; });
    return s;
  }

  /** Byte length of a string when UTF-8 encoded (approximate for display). */
  function byteLength(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return Buffer.byteLength(s, 'utf8');
  }

  function fmtBytes(n) {
    if (!Number.isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  /** Safe file-name fragment. */
  function fileSafe(s) {
    return String(s || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'untitled';
  }

  /** Mix a hex colour with white (t=0 → colour, t=1 → white). */
  function tint(hex, t) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    const m = v => Math.round(v + (255 - v) * t);
    return rgbToHex(m(c.r), m(c.g), m(c.b));
  }

  /** Mix a hex colour with black (t=0 → colour, t=1 → black). */
  function shade(hex, t) {
    const c = hexToRgb(hex);
    if (!c) return hex;
    const m = v => Math.round(v * (1 - t));
    return rgbToHex(m(c.r), m(c.g), m(c.b));
  }

  function hexToRgb(hex) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  /**
   * Pick dark or light text for a background colour: whichever gives the higher WCAG
   * contrast ratio (crossover at relative luminance ≈ 0.179).
   */
  function textOn(hex) {
    const c = hexToRgb(hex);
    if (!c) return '#0F1B2D';
    const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    return L > 0.179 ? '#0F1B2D' : '#FFFFFF';
  }

  return {
    uid, toHalfWidth, num, round, fmt, fmtFixed, clamp, clone, escapeHtml, nowIso,
    fmtDateTime, fmtDate, todayStr, fmtAgo, normalizeKey, naturalCompare, nextItemNo,
    nextVariantNo, debounce, displayValue, sum, byteLength, fmtBytes, fileSafe,
    tint, shade, hexToRgb, rgbToHex, textOn,
  };
});
