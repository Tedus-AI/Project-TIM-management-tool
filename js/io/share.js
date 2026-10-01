/* Project share file (JSON): one project + the images and materials it uses, so a
 * colleague with a different database can import it. Ids are re-generated on import. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { util, schema } = TIM;

  function exportProject(pid) {
    const db = TIM.store.db;
    const p = db.projects[pid];
    const images = {};
    schema.projectImageIds(p).forEach(id => { if (db.images[id]) images[id] = db.images[id]; });
    const materials = {};
    p.items.forEach(it => { if (it.material_id && db.materials[it.material_id]) materials[it.material_id] = db.materials[it.material_id]; });
    const out = { schema: 'tim-project', schema_version: 1, exported_at: util.nowIso(), exported_by: TIM.store.user(), project: p, materials, images };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    TIM.ui.downloadBlob(blob, util.fileSafe(p.name) + '_' + util.fileSafe(p.stage) + '.timproject.json');
  }

  /** Import a share file. Materials matching vendor+model reuse the library entry. → new project id */
  async function importProjectFile(file) {
    const text = await file.text();
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('檔案不是有效的 JSON'); }
    if (!obj || obj.schema !== 'tim-project' || !obj.project) {
      if (obj && obj.schema === 'tim-db') throw new Error('這是完整資料庫檔案，請用「開啟資料庫」開啟，或在該資料庫中匯出單一專案');
      throw new Error('不是 TIM 專案分享檔（*.timproject.json）');
    }
    const st = TIM.store;
    const db = st.db;
    const p = schema.normalizeProject(util.clone(obj.project));
    const idMap = {};
    const remap = (old, prefix) => { if (!old) return old; if (!idMap[old]) idMap[old] = util.uid(prefix); return idMap[old]; };

    // materials
    const key = m => (String(m.vendor) + '|' + String(m.model)).trim().toUpperCase();
    const existing = {};
    Object.values(db.materials).forEach(m => { existing[key(m)] = m.id; });
    const newMats = {};
    Object.values(obj.materials || {}).forEach(m0 => {
      const m = schema.normalizeMaterial(util.clone(m0));
      if (existing[key(m)]) { idMap[m0.id] = existing[key(m)]; return; }
      const nid = util.uid('mat');
      idMap[m0.id] = nid;
      m.id = nid; m.rev = 0;
      m.datasheets = [];          // the files live in the other database's storage
      newMats[nid] = m;
    });
    // images
    const newImgs = {};
    Object.keys(obj.images || {}).forEach(old => { const nid = util.uid('img'); idMap[old] = nid; newImgs[nid] = obj.images[old]; });

    p.id = util.uid('prj'); p.rev = 0;
    if (Object.values(db.projects).some(x => x.name === p.name)) p.name += '（匯入）';
    p.locations.forEach(l => { l.id = remap(l.id, 'loc'); });
    p.items.forEach(it => {
      it.id = remap(it.id, 'itm');
      it.location_id = idMap[it.location_id] || it.location_id;
      if (it.material_id) it.material_id = idMap[it.material_id] || null;
      if (it.validation && it.validation.image_id) it.validation.image_id = idMap[it.validation.image_id] || null;
    });
    p.views.forEach(v => {
      v.id = util.uid('view');
      if (v.location_id) v.location_id = idMap[v.location_id] || null;
      if (v.image_id) v.image_id = idMap[v.image_id] || null;
      v.shapes.forEach(s => { s.id = remap(s.id, 'shp'); s.item_id = idMap[s.item_id] || s.item_id; });
      v.callouts.forEach(c => { c.id = util.uid('cal'); c.item_id = idMap[c.item_id] || c.item_id; if (Array.isArray(c.targets)) c.targets = c.targets.map(t => idMap[t] || t); });
    });
    p.changelog.push({ id: util.uid('chg'), ts: util.nowIso(), user: st.user(), kind: 'import', target: 'project', target_id: p.id, item_no: '', field: '', from: '', to: '', text: '由分享檔匯入（' + (obj.exported_by || '?') + '，' + util.fmtDateTime(obj.exported_at) + '）', ecn: '' });
    st.mutateDb(d => {
      Object.assign(d.materials, newMats);
      Object.assign(d.images, newImgs);
      d.projects[p.id] = p;
    }, { projects: [p.id], materials: Object.keys(newMats), images: Object.keys(newImgs) });
    return p.id;
  }

  TIM.share = { exportProject, importProjectFile };
})();
