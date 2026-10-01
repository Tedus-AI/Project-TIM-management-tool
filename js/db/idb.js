/* Tiny promise wrapper around IndexedDB key/value stores. */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const cache = {};

  function open(dbName, storeName) {
    const key = dbName + '/' + storeName;
    if (cache[key]) return cache[key];
    cache[key] = new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { delete cache[key]; reject(req.error); };
      req.onblocked = () => { delete cache[key]; reject(new Error('IndexedDB blocked')); };
    });
    return cache[key];
  }

  async function get(dbName, storeName, k) {
    const db = await open(dbName, storeName);
    return new Promise((resolve, reject) => {
      const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(k);
      req.onsuccess = () => resolve(req.result === undefined ? null : req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Put several key/values in one transaction (atomic). */
  async function putMany(dbName, storeName, entries) {
    const db = await open(dbName, storeName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const st = tx.objectStore(storeName);
      Object.keys(entries).forEach(k => {
        if (entries[k] === undefined) st.delete(k); else st.put(entries[k], k);
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    });
  }

  async function put(dbName, storeName, k, v) { return putMany(dbName, storeName, { [k]: v }); }
  async function del(dbName, storeName, k) { return putMany(dbName, storeName, { [k]: undefined }); }

  TIM.idb = { get, put, putMany, del };
})();
