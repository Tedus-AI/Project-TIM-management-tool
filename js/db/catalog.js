/* TIM 型號目錄 publisher: keeps TIM_Manager/Database/tim_catalog.json (core/catalog.js) in step with the material
 * library, so AI-Thermal / 5G-RRU, the Thermal Network Visualizer and the Report Builder see what is created here.
 *
 *   SharePoint mode    after a save that wrote / deleted materials, and once when the database opens
 *   local folder mode  after a push to SharePoint that carried materials (from the SharePoint copy it wrote)
 *
 * Background only: never opens a sign-in popup, never blocks a save. Nothing is written when the file already
 * holds the same materials, or a newer database revision. A failure is retried with the next change / open.
 */
(function () {
  'use strict';
  const TIM = window.TIM = window.TIM || {};
  const DELAY = 1500;

  let timer = null, pending = null, chain = Promise.resolve();
  const state = { status: 'idle', error: '', at: null, published: '' };   // published: signature last seen on SharePoint
  const listeners = new Set();
  const emit = () => listeners.forEach(fn => { try { fn(state); } catch (e) { console.error(e); } });
  const off = () => !!window.__TIM_TEST_SYNC_OFF && !window.__TIM_TEST_CATALOG_ON;   // E2E: off unless the scenario is about it

  /** Publish the catalog of `db` (the database just saved to SharePoint). → 'written' | 'same' | 'newer' | 'login' */
  async function publish(db) {
    const S = TIM.spBackend, C = TIM.catalog;
    if (!S || !S.account()) return 'login';
    const cat = C.build(db, { by: S.account().name });
    const sig = C.signature(cat);
    if (sig === state.published) return 'same';
    const remote = C.parse(await S.catalog.read());
    if (remote && C.signature(remote) === sig) { state.published = sig; return 'same'; }
    if (remote && (remote.db_rev || 0) > cat.db_rev) return 'newer';      // someone published a newer database already
    await S.catalog.write(JSON.stringify(cat, null, 1));
    state.published = sig;
    return 'written';
  }

  /** Run one publish after the ones before it; the outcome goes to `state`. */
  function queue(db) {
    chain = chain.then(async () => {
      try {
        const r = await publish(db);
        state.status = r === 'login' ? 'login' : 'ok';
        state.error = '';
        if (r === 'written') state.at = TIM.util.nowIso();
      } catch (e) {
        state.status = 'error';
        state.error = (e && e.message) || String(e);
        state.published = '';
        console.warn('[catalog] tim_catalog.json not written:', state.error);
      }
      emit();
    });
    return chain;
  }

  /** Publish soon (the latest database wins when several saves come in a row). */
  function schedule(db) {
    if (off() || !db || (TIM.store && TIM.store.readonly)) return;   // a read-only database (newer / broken file) publishes nothing
    pending = db;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; const d = pending; pending = null; queue(d); }, DELAY);
  }

  /** Publish what is scheduled now and wait for it (tests). */
  async function flush() {
    if (timer) { clearTimeout(timer); timer = null; const d = pending; pending = null; queue(d); }
    await chain;
  }

  TIM.catalogSync = {
    state, schedule, flush, publish,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** A materials change in this save / push? (store.onSaved taken, or a sync taken with arrays) */
    touches(taken) {
      const n = x => (x ? (x.size != null ? x.size : x.length || 0) : 0);
      return !!taken && (n(taken.materials) + n(taken.deletedMaterials)) > 0;
    },
  };
})();
