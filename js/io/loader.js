/* Lazy loader for heavy CDN libraries (ExcelJS): pinned version + SRI, timeout,
 * one retry, then the fallback CDN. */
(function () {
  'use strict';
  const TIM = window.TIM;

  const LIBS = {
    exceljs: {
      global: 'ExcelJS',
      integrity: 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz',
      urls: [
        'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
        'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js',
      ],
    },
  };
  const pending = {};

  function loadOnce(url, integrity, timeoutMs) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
      const t = setTimeout(() => { s.remove(); reject(new Error('timeout')); }, timeoutMs);
      s.onload = () => { clearTimeout(t); resolve(); };
      s.onerror = () => { clearTimeout(t); s.remove(); reject(new Error('network')); };
      document.head.appendChild(s);
    });
  }

  /** Resolve the library global, loading it on first use. */
  function load(name) {
    const lib = LIBS[name];
    if (!lib) return Promise.reject(new Error('unknown library ' + name));
    if (window[lib.global]) return Promise.resolve(window[lib.global]);
    if (pending[name]) return pending[name];
    pending[name] = (async () => {
      const attempts = [lib.urls[0], lib.urls[0], lib.urls[1]];   // primary, retry once, fallback
      let lastErr;
      for (const url of attempts) {
        try {
          await loadOnce(url, lib.integrity, 20000);
          if (window[lib.global]) return window[lib.global];
        } catch (e) { lastErr = e; }
      }
      delete pending[name];
      throw new Error('無法載入 ' + name + '（' + (lastErr ? lastErr.message : '未知錯誤') + '）。請確認網路或防火牆允許 cdn.jsdelivr.net / unpkg.com');
    })();
    return pending[name];
  }

  TIM.loader = { load };
})();
