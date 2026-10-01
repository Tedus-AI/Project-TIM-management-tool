/* UI foundation: Preact/htm bindings, icons, store hook, hash router. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!window.htmPreact) return;
  const P = window.htmPreact;
  const { html, render, h, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer } = P;

  // 16×16 stroke icons (static constants, never user input).
  const ICONS = {
    plus: '<path d="M8 3v10M3 8h10"/>',
    trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4"/>',
    copy: '<rect x="5.5" y="5.5" width="7.5" height="7.5" rx="1"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>',
    undo: '<path d="M5.5 9.5L2.5 6.5l3-3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8h-2"/>',
    redo: '<path d="M10.5 9.5l3-3-3-3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8h2"/>',
    download: '<path d="M8 2.5v8M4.5 7.5L8 11l3.5-3.5M2.5 13.5h11"/>',
    upload: '<path d="M8 11V3M4.5 6.5L8 3l3.5 3.5M2.5 13.5h11"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/>',
    gear: '<circle cx="8" cy="8" r="2.2"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
    folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
    file: '<path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3h3"/>',
    save: '<path d="M3 2.5h8l2.5 2.5v8.5H3z"/><path d="M5.5 2.5v3h4v-3M5 13.5V9h6v4.5"/>',
    grid: '<rect x="2.5" y="2.5" width="11" height="11"/><path d="M2.5 6.5h11M2.5 10h11M6 6.5v7"/>',
    map: '<path d="M2 4l4-1.5 4 1.5 4-1.5v9.5L10 13.5 6 12l-4 1.5z"/><path d="M6 2.5V12M10 4v9.5"/>',
    chart: '<path d="M2.5 13.5h11"/><path d="M4.5 11V8M8 11V4.5M11.5 11V6.5"/>',
    history: '<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2.5 2.5V5h2.5"/><path d="M8 5v3.2l2 1.3"/>',
    home: '<path d="M2.5 7.5L8 3l5.5 4.5"/><path d="M4 6.5v7h8v-7"/>',
    layers: '<path d="M8 2.5l6 3-6 3-6-3z"/><path d="M2 8.5l6 3 6-3"/><path d="M2 11.5l6 3 6-3"/>',
    link: '<path d="M6.5 9.5l3-3"/><path d="M7.5 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M8.5 11.5l-1 1A2.5 2.5 0 0 1 4 9l1-1"/>',
    scissors: '<circle cx="4.5" cy="11.5" r="2"/><circle cx="4.5" cy="4.5" r="2"/><path d="M6.2 5.6L13.5 12M6.2 10.4L13.5 4"/>',
    reset: '<path d="M3 3v3.5h3.5"/><path d="M3.2 6.3A5 5 0 1 1 3.5 10"/>',
    lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>',
    rotate: '<path d="M13 8a5 5 0 1 1-1.5-3.5"/><path d="M13 2.5v3h-3"/>',
    cursor: '<path d="M3.5 2.5l9 4.2-3.9 1.2-1.4 3.9z"/><path d="M8.6 7.9l3.4 3.6"/>',
    square: '<rect x="3" y="4.5" width="10" height="7" rx="0.5"/>',
    tag: '<path d="M2.5 7.6V2.5h5.1l6 6-5.1 5.1z"/><circle cx="5.3" cy="5.3" r="0.9"/>',
    ruler: '<path d="M2 10.5l8.5-8.5 3.5 3.5L5.5 14z"/><path d="M5 7.5l1.5 1.5M7 5.5l1 1M9 3.5l1.5 1.5"/>',
    fit: '<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>',
    zoomIn: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3M5 7h4M7 5v4"/>',
    zoomOut: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3M5 7h4"/>',
    image: '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="5.5" cy="6.5" r="1.2"/><path d="M14 11l-3.5-3.5L4 13"/>',
    eye: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>',
    warn: '<path d="M8 2.5l6 10.5H2z"/><path d="M8 6.5v3M8 11.2v.3"/>',
    check: '<path d="M3 8.5l3 3 7-7"/>',
    x: '<path d="M4 4l8 8M12 4l-8 8"/>',
    chevR: '<path d="M6 3.5L10.5 8 6 12.5"/>',
    chevL: '<path d="M10 3.5L5.5 8l4.5 4.5"/>',
    chevD: '<path d="M3.5 6L8 10.5 12.5 6"/>',
    chevU: '<path d="M3.5 10L8 5.5 12.5 10"/>',
    more: '<circle cx="3.5" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="12.5" cy="8" r="1" fill="currentColor"/>',
    drag: '<circle cx="6" cy="4" r=".9" fill="currentColor"/><circle cx="10" cy="4" r=".9" fill="currentColor"/><circle cx="6" cy="8" r=".9" fill="currentColor"/><circle cx="10" cy="8" r=".9" fill="currentColor"/><circle cx="6" cy="12" r=".9" fill="currentColor"/><circle cx="10" cy="12" r=".9" fill="currentColor"/>',
    excel: '<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5"/>',
    book: '<path d="M3 2.5h7.5a1.5 1.5 0 0 1 1.5 1.5v9.5H4.5A1.5 1.5 0 0 1 3 12z"/><path d="M3 12a1.5 1.5 0 0 1 1.5-1.5H12"/>',
    flag: '<path d="M3.5 14V2.5M3.5 3h8l-2 3 2 3h-8"/>',
    paste: '<rect x="4" y="3" width="8" height="10.5" rx="1"/><path d="M6 3V2h4v1"/><path d="M6.5 7h3M6.5 9.5h3"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7v4M8 5v.3"/>',
    db: '<ellipse cx="8" cy="4" rx="5" ry="1.8"/><path d="M3 4v8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V4M3 8c0 1 2.2 1.8 5 1.8S13 9 13 8"/>',
  };

  function Icon(props) {
    const s = props.size || 16;
    return html`<svg viewBox="0 0 16 16" width=${s} height=${s} fill="none" stroke="currentColor" stroke-width="1.45"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class=${props.class || ''}
      dangerouslySetInnerHTML=${{ __html: ICONS[props.name] || '' }}></svg>`;
  }

  /** Re-render the calling component whenever the store changes. */
  function useStore() {
    const [, force] = useReducer(x => x + 1, 0);
    useEffect(() => TIM.store.subscribe(() => force()), []);
    return TIM.store;
  }

  // ───────── hash router ─────────
  function parseHash() {
    const raw = decodeURIComponent((location.hash || '').replace(/^#\/?/, ''));
    const [path, query] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const q = {};
    (query || '').split('&').filter(Boolean).forEach(kv => { const [k, v] = kv.split('='); q[k] = v === undefined ? '' : v; });
    if (parts[0] === 'library') return { page: 'library', mat: parts[1] || null, q };
    if (parts[0] === 'p' && parts[1]) return { page: 'project', pid: parts[1], tab: parts[2] || 'overview', sub: parts[3] || null, q };
    return { page: 'home', q };
  }
  function go(path, replace) {
    const h = '#/' + String(path || '').replace(/^#?\/?/, '');
    if (replace) history.replaceState(null, '', h); else location.hash = h;
    if (replace) window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  function useRoute() {
    const [r, setR] = useState(parseHash());
    useEffect(() => {
      const on = () => setR(parseHash());
      window.addEventListener('hashchange', on);
      return () => window.removeEventListener('hashchange', on);
    }, []);
    return r;
  }

  /** Run cb on Escape while mounted. */
  function useEscape(cb, active) {
    useEffect(() => {
      if (active === false) return;
      const on = e => { if (e.key === 'Escape') cb(e); };
      window.addEventListener('keydown', on);
      return () => window.removeEventListener('keydown', on);
    }, [cb, active]);
  }

  /** Persisted UI preference (per browser) — never used for real data. */
  function usePref(key, initial) {
    const k = 'tim_pref_' + key;
    const [v, setV] = useState(() => {
      try { const s = localStorage.getItem(k); return s === null ? initial : JSON.parse(s); } catch (e) { return initial; }
    });
    const set = useCallback(nv => {
      setV(old => {
        const val = typeof nv === 'function' ? nv(old) : nv;
        try { localStorage.setItem(k, JSON.stringify(val)); } catch (e) { /* ignore */ }
        return val;
      });
    }, [k]);
    return [v, set];
  }

  function cx() { return Array.from(arguments).filter(Boolean).join(' '); }

  /** Highlight query terms in text (returns htm nodes, escaped by Preact). */
  function highlight(text, query) {
    const s = String(text == null ? '' : text);
    const terms = String(query || '').trim().split(/\s+/).filter(Boolean).map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!terms.length || !s) return s;
    const re = new RegExp('(' + terms.join('|') + ')', 'ig');
    return s.split(re).map((part, i) => (i % 2 ? html`<mark>${part}</mark>` : part));
  }

  TIM.ui = Object.assign(TIM.ui || {}, {
    html, render, h, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
    Icon, useStore, useRoute, parseHash, go, useEscape, usePref, cx, highlight,
  });
})();
