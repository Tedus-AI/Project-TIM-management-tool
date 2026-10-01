/* Browser storage backend (IndexedDB) — "試用模式" and fallback for browsers without
 * the File System Access API. Data lives only in this browser profile; clearing site
 * data removes it, which the UI states clearly.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const DATA_DB = 'tim-mgmt-data', STORE = 'kv';

  const browserBackend = {
    kind: 'browser',
    supported() { return typeof indexedDB !== 'undefined'; },
    label() { return '瀏覽器暫存'; },
    ready() { return true; },
    async head() { return (await TIM.idb.get(DATA_DB, STORE, 'head')) || ''; },
    async read() { return (await TIM.idb.get(DATA_DB, STORE, 'db')) || ''; },
    async size() { const t = await this.read(); return t.length; },
    async write(text) { await TIM.idb.putMany(DATA_DB, STORE, { db: text, head: text.slice(0, 512) }); },
    async exists() { return !!(await this.head()); },
    async clear() { await TIM.idb.putMany(DATA_DB, STORE, { db: undefined, head: undefined }); },
    startIn() { return undefined; },
  };

  TIM.browserBackend = browserBackend;
})();
