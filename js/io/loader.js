/* Lazy loader for heavy CDN libraries (ExcelJS; html2canvas + jsPDF for the PDF report):
 * pinned version + SRI, timeout, one retry, then the fallback CDN. */
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
    // Same versions as the Thermal Test Report Builder.
    html2canvas: {
      global: 'html2canvas',
      integrity: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H',
      urls: [
        'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
        'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
      ],
    },
    jspdf: {
      global: 'jspdf',
      integrity: 'sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/',
      urls: [
        'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js',
        'https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js',
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
