/* Domain actions: every data change goes through here so undo, change log and cascades
 * (e.g. deleting an item removes its pads / callouts) stay consistent. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { util, schema, parse, calc } = TIM;
  const st = () => TIM.store;

  // ───────── helpers ─────────
  function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
  function setPath(o, path, v) {
    const ks = path.split('.');
    let cur = o;
    for (let i = 0; i < ks.length - 1; i++) {
      if (cur[ks[i]] == null || typeof cur[ks[i]] !== 'object') cur[ks[i]] = {};
      cur = cur[ks[i]];
    }
    cur[ks[ks.length - 1]] = v;
  }
  const project = pid => st().db && st().db.projects[pid];
  const itemOf = (p, id) => p && p.items.find(i => i.id === id);

  /** Human-readable value of an item field for the change log. */
  function fieldDisplay(p, item, path, v) {
    if (path === 'size') return parse.formatSize(v);
    if (path === 'covered') return parse.formatCovered(v);
    if (path === 'sources') return parse.formatSources({ sources: v });
    if (path === 'used_on') return (v || []).join('/');
    if (path === 'location_id') { const l = p.locations.find(x => x.id === v); return l ? l.name : ''; }
    if (path === 'material_id') { const m = v && st().db.materials[v]; return m ? (m.vendor + ' ' + m.model) : ''; }
    if (path === 'status') return schema.labelOf(schema.ITEM_STATUS, v);
    if (path === 'tim_type') return schema.timType(v).label;
    if (path === 'gap') return [v && v.min, v && v.nom, v && v.max].map(x => (x == null ? '-' : x)).join(' / ');
    if (path === 'comp_override') return v ? (v.min + '~' + v.max + '%') : '自動';
    if (v && typeof v === 'object') return JSON.stringify(v);
    return v;
  }
  function fieldLabel(path) {
    if (schema.FIELD_LABELS[path]) return schema.FIELD_LABELS[path];
    const parts = path.split('.');
    const head = schema.FIELD_LABELS[parts[0]];
    if (head) return parts.length > 1 ? head + ' ' + parts.slice(1).join('.') : head;
    return path;
  }

  // ───────── projects ─────────
  function createProject(fields) {
    const p = schema.newProject(fields, st().user(), st().db.settings);
    p.changelog.push({ id: util.uid('chg'), ts: util.nowIso(), user: st().user(), kind: 'add', target: 'project', target_id: p.id, item_no: '', field: '', from: '', to: '', text: '建立專案', ecn: '' });
    st().mutateDb(db => { db.projects[p.id] = p; }, { projects: [p.id] });
    return p.id;
  }

  function updateProject(pid, path, value) {
    const p = project(pid);
    if (!p) return;
    const from = getPath(p, path);
    if (JSON.stringify(from) === JSON.stringify(value)) return;
    st().mutateProject(pid, pp => { setPath(pp, path, value); }, {
      coalesce: 'proj:' + path,
      changes: [{ kind: 'edit', target: 'project', target_id: pid, field: fieldLabel(path), from, to: value }],
    });
  }

  function duplicateProject(pid, newName) {
    const src = project(pid);
    if (!src) return null;
    const p = util.clone(src);
    const oldNew = {};
    p.id = util.uid('prj');
    p.rev = 0;
    p.name = newName || (src.name + ' (副本)');
    p.created_at = p.updated_at = util.nowIso();
    p.created_by = p.updated_by = st().user();
    p.locations.forEach(l => { const n = util.uid('loc'); oldNew[l.id] = n; l.id = n; });
    p.items.forEach(it => { const n = util.uid('itm'); oldNew[it.id] = n; it.id = n; it.location_id = oldNew[it.location_id]; });
    p.views.forEach(v => {
      v.id = util.uid('view');
      if (v.location_id) v.location_id = oldNew[v.location_id] || null;
      v.shapes.forEach(s => { const n = util.uid('shp'); oldNew[s.id] = n; s.id = n; s.item_id = oldNew[s.item_id] || s.item_id; });
      v.callouts.forEach(c => { c.id = util.uid('cal'); c.item_id = oldNew[c.item_id] || c.item_id; if (Array.isArray(c.targets)) c.targets = c.targets.map(t => oldNew[t] || t); });
    });
    p.changelog = [{ id: util.uid('chg'), ts: util.nowIso(), user: st().user(), kind: 'add', target: 'project', target_id: p.id, text: '由「' + src.name + '」複製建立', from: '', to: '', field: '', item_no: '', ecn: '' }];
    p.baselines = [];
    st().mutateDb(db => { db.projects[p.id] = p; }, { projects: [p.id] });
    return p.id;
  }

  function deleteProject(pid) {
    st().mutateDb(db => { delete db.projects[pid]; }, { deletedProjects: [pid] });
  }

  // ───────── locations ─────────
  function addLocation(pid, name) {
    const p = project(pid);
    const loc = schema.newLocation(name || 'Location', p.locations.length);
    st().mutateProject(pid, pp => { pp.locations.push(loc); }, { changes: [{ kind: 'add', target: 'location', target_id: loc.id, text: '新增 Location：' + loc.name }] });
    return loc.id;
  }
  function updateLocation(pid, locId, patch) {
    const p = project(pid);
    const loc = p && p.locations.find(l => l.id === locId);
    if (!loc) return;
    const changes = [];
    if (patch.name !== undefined && patch.name !== loc.name) changes.push({ kind: 'edit', target: 'location', target_id: locId, field: 'Location 名稱', from: loc.name, to: patch.name });
    st().mutateProject(pid, pp => { Object.assign(pp.locations.find(l => l.id === locId), patch); }, { coalesce: 'loc:' + locId + Object.keys(patch).join(), changes });
  }
  function moveLocation(pid, locId, dir) {
    st().mutateProject(pid, pp => {
      const i = pp.locations.findIndex(l => l.id === locId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= pp.locations.length) return false;
      const [l] = pp.locations.splice(i, 1);
      pp.locations.splice(j, 0, l);
    });
  }
  /** Delete a location; its items move to `moveTo` (required when items exist). */
  function deleteLocation(pid, locId, moveTo) {
    const p = project(pid);
    const loc = p.locations.find(l => l.id === locId);
    st().mutateProject(pid, pp => {
      pp.items.forEach(it => { if (it.location_id === locId) it.location_id = moveTo; });
      pp.views.forEach(v => { if (v.location_id === locId) v.location_id = null; });
      pp.locations = pp.locations.filter(l => l.id !== locId);
    }, { changes: [{ kind: 'remove', target: 'location', target_id: locId, text: '刪除 Location：' + (loc ? loc.name : '') }] });
  }

  // ───────── items ─────────
  function addItem(pid, opts) {
    opts = opts || {};
    const p = project(pid);
    if (!p) return null;
    const locId = opts.location_id || (p.locations[0] && p.locations[0].id);
    const it = schema.newItem(Object.assign({
      item_no: util.nextItemNo(p.items.map(i => i.item_no)),
      location_id: locId,
    }, opts.fields || {}));
    st().mutateProject(pid, pp => {
      if (!pp.locations.length) { const l = schema.newLocation('Location', 0); pp.locations.push(l); it.location_id = l.id; }
      let idx = pp.items.length;
      if (opts.after) { const i = pp.items.findIndex(x => x.id === opts.after); if (i >= 0) idx = i + 1; }
      else if (opts.before) { const i = pp.items.findIndex(x => x.id === opts.before); if (i >= 0) idx = i; }
      else {
        // append after the last item of the same location (keeps groups contiguous)
        let last = -1;
        pp.items.forEach((x, i) => { if (x.location_id === it.location_id) last = i; });
        if (last >= 0) idx = last + 1;
      }
      pp.items.splice(idx, 0, it);
    }, { changes: [{ kind: 'add', target: 'item', target_id: it.id, item_no: it.item_no, text: '新增 Item ' + it.item_no }] });
    return it.id;
  }

  /** Set one field (dot path) on an item. Coalesces typing bursts into one undo step / log entry. */
  function updateItem(pid, itemId, path, value, o) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    if (!it) return;
    const from = util.clone(getPath(it, path));
    if (JSON.stringify(from) === JSON.stringify(value)) return;
    st().mutateProject(pid, pp => { setPath(itemOf(pp, itemId), path, value); }, {
      coalesce: (o && o.coalesce === false) ? null : ('item:' + itemId + ':' + path),
      changes: [{ kind: 'edit', target: 'item', target_id: itemId, item_no: path === 'item_no' ? value : it.item_no, field: fieldLabel(path), from: fieldDisplay(p, it, path, from), to: fieldDisplay(p, it, path, value) }],
    });
  }

  /** Apply several fields at once (paste / import row) as one undo step. patch: {path: value}. */
  function patchItems(pid, patches, label) {
    const p = project(pid);
    if (!p) return;
    const changes = [];
    patches.forEach(({ itemId, patch }) => {
      const it = itemOf(p, itemId);
      if (!it) return;
      Object.keys(patch).forEach(path => {
        const from = getPath(it, path);
        if (JSON.stringify(from) !== JSON.stringify(patch[path])) {
          changes.push({ kind: 'edit', target: 'item', target_id: itemId, item_no: patch.item_no || it.item_no, field: fieldLabel(path), from: fieldDisplay(p, it, path, from), to: fieldDisplay(p, it, path, patch[path]) });
        }
      });
    });
    if (!changes.length) return;
    st().mutateProject(pid, pp => {
      patches.forEach(({ itemId, patch }) => {
        const it = itemOf(pp, itemId);
        if (it) Object.keys(patch).forEach(path => setPath(it, path, util.clone(patch[path])));
      });
    }, { changes: changes.length > 30 ? [{ kind: 'edit', target: 'item', text: (label || '批次修改') + '（' + changes.length + ' 個欄位）' }] : changes });
  }

  /**
   * Grid paste: update existing items and append new ones in ONE undo step.
   * patches: [{itemId, patch:{path:value}}], newRows: [{location_id, fields}], afterId: insert position.
   * Exact vendor+model matches with the library are linked automatically.
   */
  function pasteIntoItems(pid, patches, newRows, afterId) {
    const p = project(pid);
    if (!p) return [];
    const changes = [];
    patches.forEach(({ itemId, patch }) => {
      const it = itemOf(p, itemId);
      if (!it) return;
      Object.keys(patch).forEach(path => {
        const from = getPath(it, path);
        if (JSON.stringify(from) !== JSON.stringify(patch[path])) {
          changes.push({ kind: 'edit', target: 'item', target_id: itemId, item_no: patch.item_no || it.item_no, field: fieldLabel(path), from: fieldDisplay(p, it, path, from), to: fieldDisplay(p, it, path, patch[path]) });
        }
      });
    });
    const existingNos = p.items.map(i => i.item_no);
    const created = (newRows || []).map(r => {
      const it = schema.normalizeItem(schema.newItem(Object.assign({ location_id: r.location_id }, r.fields || {})));
      if (!it.item_no) it.item_no = util.nextItemNo(existingNos);
      existingNos.push(it.item_no);
      return it;
    });
    if (!changes.length && !created.length) return [];
    if (created.length) changes.push({ kind: 'add', target: 'item', text: '貼上新增 ' + created.length + ' 個 Item：' + created.map(i => i.item_no).join(', ') });
    const autoLink = it => {
      if (it.material_id) return;
      const m = findMaterial(it.vendor, it.model);
      if (m) { it.material_id = m.id; it.vendor = m.vendor; it.model = m.model; it.tim_type = m.tim_type; }
    };
    st().mutateProject(pid, pp => {
      patches.forEach(({ itemId, patch }) => {
        const it = itemOf(pp, itemId);
        if (!it) return;
        Object.keys(patch).forEach(path => setPath(it, path, util.clone(patch[path])));
        if (patch.vendor !== undefined || patch.model !== undefined) autoLink(it);
      });
      created.forEach(autoLink);
      if (created.length) {
        let idx = pp.items.length;
        if (afterId) { const i = pp.items.findIndex(x => x.id === afterId); if (i >= 0) idx = i + 1; }
        pp.items.splice(idx, 0, ...created);
      }
    }, { changes: changes.length > 40 ? [{ kind: 'edit', target: 'item', text: '貼上（' + changes.length + ' 個欄位）' }] : changes });
    return created.map(i => i.id);
  }

  /** Insert several new items (paste rows / import). rows: [{location_id?, fields}] → ids */
  function insertItems(pid, rows, opts) {
    opts = opts || {};
    const p = project(pid);
    if (!p || !rows.length) return [];
    const ids = [];
    const existingNos = p.items.map(i => i.item_no);
    const newItems = rows.map(r => {
      const it = schema.normalizeItem(schema.newItem(Object.assign({ location_id: r.location_id || opts.location_id || (p.locations[0] && p.locations[0].id) }, r.fields || {})));
      if (!it.item_no) { it.item_no = util.nextItemNo(existingNos); }
      existingNos.push(it.item_no);
      ids.push(it.id);
      return it;
    });
    st().mutateProject(pid, pp => {
      let idx = pp.items.length;
      if (opts.after) { const i = pp.items.findIndex(x => x.id === opts.after); if (i >= 0) idx = i + 1; }
      pp.items.splice(idx, 0, ...newItems);
    }, { changes: [{ kind: opts.kind || 'add', target: 'item', text: (opts.label || '新增') + ' ' + newItems.length + ' 個 Item：' + newItems.map(i => i.item_no).join(', ') }] });
    return ids;
  }

  function duplicateItem(pid, itemId, asVariant) {
    const p = project(pid);
    const src = itemOf(p, itemId);
    if (!src) return null;
    const it = util.clone(src);
    it.id = util.uid('itm');
    it.item_no = asVariant ? util.nextVariantNo(src.item_no, p.items.map(i => i.item_no)) : util.nextItemNo(p.items.map(i => i.item_no));
    it.covered = it.covered.map(c => Object.assign(c, { id: util.uid('cov') }));
    it.sources = it.sources.map(s => Object.assign(s, { id: util.uid('src') }));
    it.color = null;
    it.validation = { coverage_pct: null, result: '', date: '', note: '', image_id: null };
    st().mutateProject(pid, pp => {
      const i = pp.items.findIndex(x => x.id === itemId);
      pp.items.splice(i + 1, 0, it);
    }, { changes: [{ kind: 'add', target: 'item', target_id: it.id, item_no: it.item_no, text: '複製 ' + src.item_no + ' → ' + it.item_no }] });
    return it.id;
  }

  /** Delete items and everything that points at them (pads, callouts, callout targets). */
  function deleteItems(pid, ids) {
    const p = project(pid);
    const set = new Set(ids);
    const nos = p.items.filter(i => set.has(i.id)).map(i => i.item_no);
    st().mutateProject(pid, pp => {
      pp.items = pp.items.filter(i => !set.has(i.id));
      pp.views.forEach(v => {
        const removedShapes = new Set(v.shapes.filter(s => set.has(s.item_id)).map(s => s.id));
        v.shapes = v.shapes.filter(s => !set.has(s.item_id));
        v.callouts = v.callouts.filter(c => !set.has(c.item_id));
        v.callouts.forEach(c => { if (Array.isArray(c.targets)) c.targets = c.targets.filter(t => !removedShapes.has(t)); });
      });
    }, { changes: [{ kind: 'remove', target: 'item', text: '刪除 Item：' + nos.join(', ') }] });
  }

  /** Move an item to a location, optionally before another item (drag & drop). */
  function moveItem(pid, itemId, locId, beforeId) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    if (!it) return;
    const fromLoc = it.location_id;
    st().mutateProject(pid, pp => {
      const i = pp.items.findIndex(x => x.id === itemId);
      const [moved] = pp.items.splice(i, 1);
      moved.location_id = locId;
      let idx;
      if (beforeId) idx = pp.items.findIndex(x => x.id === beforeId);
      if (idx === undefined || idx < 0) {
        let last = -1;
        pp.items.forEach((x, k) => { if (x.location_id === locId) last = k; });
        idx = last >= 0 ? last + 1 : pp.items.length;
      }
      pp.items.splice(idx, 0, moved);
    }, {
      changes: fromLoc !== locId ? [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: 'Location', from: fieldDisplay(p, it, 'location_id', fromLoc), to: fieldDisplay(p, it, 'location_id', locId) }] : [],
    });
  }

  /** Sort items by item number inside each location. */
  function sortItems(pid) {
    st().mutateProject(pid, pp => {
      const locIdx = {};
      pp.locations.forEach((l, i) => { locIdx[l.id] = i; });
      pp.items.sort((a, b) => ((locIdx[a.location_id] ?? 99) - (locIdx[b.location_id] ?? 99)) || util.naturalCompare(a.item_no, b.item_no));
    });
  }

  // covered components
  function setCovered(pid, itemId, list) { updateItem(pid, itemId, 'covered', list, { coalesce: false }); }
  function updateCovered(pid, itemId, covId, field, value) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    if (!it) return;
    const c = it.covered.find(x => x.id === covId);
    if (!c || c[field] === value) return;
    const before = parse.formatCovered(it.covered);
    st().mutateProject(pid, pp => { itemOf(pp, itemId).covered.find(x => x.id === covId)[field] = value; }, {
      coalesce: 'cov:' + covId + ':' + field,
      changes: ['part', 'qty'].includes(field)
        ? [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: '覆蓋元件', from: before, to: parse.formatCovered(it.covered.map(x => (x.id === covId ? Object.assign({}, x, { [field]: value }) : x))) }]
        : [{ kind: 'edit', target: 'item', target_id: itemId + ':' + covId, item_no: it.item_no, field: '覆蓋元件 ' + (c.part || '') + ' ' + ({ refdes: 'RefDes', power_w: '功耗', top_pct: '頂面 %', pkg_l: '封裝 L', pkg_w: '封裝 W', cat: '類別', note: '備註' }[field] || field), from: c[field], to: value }],
    });
  }
  function addCovered(pid, itemId, fields) {
    const c = schema.newCovered(fields);
    st().mutateProject(pid, pp => { itemOf(pp, itemId).covered.push(c); });
    return c.id;
  }
  function removeCovered(pid, itemId, covId) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    const c = it && it.covered.find(x => x.id === covId);
    st().mutateProject(pid, pp => { const i2 = itemOf(pp, itemId); i2.covered = i2.covered.filter(x => x.id !== covId); },
      { changes: c ? [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: '覆蓋元件', from: parse.formatCovered(it.covered), to: parse.formatCovered(it.covered.filter(x => x.id !== covId)) }] : [] });
  }

  // 2nd sources
  function addSource(pid, itemId, fields) {
    const s = schema.newSource(fields);
    st().mutateProject(pid, pp => { itemOf(pp, itemId).sources.push(s); });
    return s.id;
  }
  function updateSource(pid, itemId, srcId, field, value) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    const s = it && it.sources.find(x => x.id === srcId);
    if (!s || s[field] === value) return;
    const label = field === 'status' ? '2nd source 狀態 (' + (s.vendor || '') + ')' : '2nd source ' + ({ vendor: 'Vendor', model: 'Model', mpn: 'MPN', delta_pn: 'Delta P/N', note: '備註' }[field] || field);
    const from = field === 'status' ? schema.labelOf(schema.SOURCE_STATUS, s.status) : s[field];
    const to = field === 'status' ? schema.labelOf(schema.SOURCE_STATUS, value) : value;
    st().mutateProject(pid, pp => { itemOf(pp, itemId).sources.find(x => x.id === srcId)[field] = value; },
      { coalesce: 'src:' + srcId + ':' + field, changes: [{ kind: 'edit', target: 'item', target_id: itemId + ':' + srcId + ':' + field, item_no: it.item_no, field: label, from, to }] });
  }
  function removeSource(pid, itemId, srcId) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    const s = it && it.sources.find(x => x.id === srcId);
    st().mutateProject(pid, pp => { const i2 = itemOf(pp, itemId); i2.sources = i2.sources.filter(x => x.id !== srcId); },
      { changes: s ? [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: '2nd source', from: parse.formatSources(it), to: parse.formatSources({ sources: it.sources.filter(x => x.id !== srcId) }) }] : [] });
  }

  // material link (single source of truth: linked items mirror the library)
  function linkMaterial(pid, itemId, matId) {
    const m = st().db.materials[matId];
    const p = project(pid);
    const it = itemOf(p, itemId);
    if (!m || !it) return;
    st().mutateProject(pid, pp => {
      const x = itemOf(pp, itemId);
      x.material_id = matId; x.vendor = m.vendor; x.model = m.model; x.tim_type = m.tim_type;
    }, { changes: [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: '材料', from: [it.vendor, it.model].filter(Boolean).join(' '), to: m.vendor + ' ' + m.model + '（連結材料庫）' }] });
  }
  function unlinkMaterial(pid, itemId) {
    const p = project(pid);
    const it = itemOf(p, itemId);
    if (!it || !it.material_id) return;
    const m = st().db.materials[it.material_id];
    st().mutateProject(pid, pp => {
      const x = itemOf(pp, itemId);
      if (m) { x.vendor = m.vendor; x.model = m.model; x.tim_type = m.tim_type; }
      x.material_id = null;
    }, { changes: [{ kind: 'edit', target: 'item', target_id: itemId, item_no: it.item_no, field: '材料連結', from: m ? m.vendor + ' ' + m.model : '', to: '（解除連結，改為手動）' }] });
  }

  /** Library material whose vendor + model match (case-insensitive), for click-to-link suggestions. */
  function findMaterial(vendor, model) {
    const k = (String(vendor || '') + '|' + String(model || '')).trim().toUpperCase();
    if (k === '|') return null;
    return Object.values(st().db.materials).find(m => (String(m.vendor) + '|' + String(m.model)).trim().toUpperCase() === k) || null;
  }

  // ───────── materials ─────────
  function createMaterial(fields) {
    const m = schema.newMaterial(fields);
    st().mutateMaterials(mats => { mats[m.id] = m; }, { touched: [m.id] });
    return m.id;
  }
  function updateMaterial(id, field, value) {
    const m = st().db.materials[id];
    if (!m || m[field] === value) return;
    st().mutateMaterials(mats => { mats[id][field] = value; }, { coalesce: 'mat:' + id + ':' + field, touched: [id] });
  }
  /** Replace a material's datasheet list (upload / replace / remove). Removed files: TIM.app.queueFileDeletes. */
  function setDatasheets(id, list) {
    if (!st().db.materials[id]) return false;
    return st().mutateMaterials(mats => { mats[id].datasheets = list; }, { touched: [id] });
  }
  /** Delete a material; linked items keep its vendor/model as free text (cascade unlink). */
  function deleteMaterial(id) {
    const m = st().db.materials[id];
    if (!m) return;
    if (TIM.app && TIM.app.queueFileDeletes) TIM.app.queueFileDeletes((m.datasheets || []).map(d => d.path));
    const touched = [];
    st().mutateDb(db => {
      Object.values(db.projects).forEach(p => {
        let hit = false;
        p.items.forEach(it => {
          if (it.material_id === id) { it.material_id = null; it.vendor = m.vendor; it.model = m.model; it.tim_type = m.tim_type; hit = true; }
        });
        if (hit) {
          touched.push(p.id);
          p.changelog.push({ id: util.uid('chg'), ts: util.nowIso(), user: st().user(), kind: 'edit', target: 'material', target_id: id, item_no: '', field: '材料庫', from: m.vendor + ' ' + m.model, to: '（材料已從材料庫刪除，保留為手動文字）', text: '', ecn: '' });
        }
      });
      delete db.materials[id];
    }, { projects: touched, deletedMaterials: [id], clearHistory: ['lib'].concat(touched.map(t => 'p:' + t)) });
  }
  function duplicateMaterial(id) {
    const m = st().db.materials[id];
    if (!m) return null;
    const c = util.clone(m);
    c.id = util.uid('mat'); c.rev = 0; c.model = m.model + ' (副本)'; c.created_at = c.updated_at = util.nowIso();
    st().mutateMaterials(mats => { mats[c.id] = c; }, { touched: [c.id] });
    return c.id;
  }

  // ───────── views (placement map) ─────────
  function addView(pid, fields) {
    const v = schema.newView(fields);
    st().mutateProject(pid, pp => { pp.views.push(v); }, { images: v.image_id ? [v.image_id] : [], changes: [{ kind: 'add', target: 'view', target_id: v.id, text: '新增位置視圖：' + v.name }] });
    return v.id;
  }
  function updateView(pid, viewId, patch, coalesce) {
    st().mutateProject(pid, pp => { Object.assign(pp.views.find(v => v.id === viewId), patch); }, { coalesce: coalesce ? 'view:' + viewId + ':' + coalesce : null });
  }
  function updateViewStyle(pid, viewId, patch) {
    st().mutateProject(pid, pp => { const v = pp.views.find(x => x.id === viewId); v.style = Object.assign({}, v.style, patch); }, { coalesce: 'viewstyle:' + viewId + Object.keys(patch).join() });
  }
  function deleteView(pid, viewId) {
    const p = project(pid);
    const v = p.views.find(x => x.id === viewId);
    st().mutateProject(pid, pp => { pp.views = pp.views.filter(x => x.id !== viewId); }, { changes: [{ kind: 'remove', target: 'view', target_id: viewId, text: '刪除位置視圖：' + (v ? v.name : '') }] });
  }
  function moveView(pid, viewId, dir) {
    st().mutateProject(pid, pp => {
      const i = pp.views.findIndex(v => v.id === viewId), j = i + dir;
      if (i < 0 || j < 0 || j >= pp.views.length) return false;
      const [v] = pp.views.splice(i, 1);
      pp.views.splice(j, 0, v);
    });
  }
  /** Generic mutation of one view (shapes / callouts edits from the map editor). */
  function editView(pid, viewId, fn, coalesce) {
    st().mutateProject(pid, pp => { const v = pp.views.find(x => x.id === viewId); if (!v) return false; return fn(v, pp); }, { coalesce: coalesce || null });
  }

  // ───────── change log & baselines ─────────
  function addLogEntry(pid, entry) {
    st().mutateProject(pid, () => {}, { changes: [Object.assign({ target: 'project', target_id: pid }, entry)] });
  }
  function deleteLogEntry(pid, id) {
    st().mutateProject(pid, pp => { pp.changelog = pp.changelog.filter(c => c.id !== id); });
  }
  function createBaseline(pid, name, note) {
    const p = project(pid);
    const b = { id: util.uid('bl'), name, note: note || '', created_at: util.nowIso(), created_by: st().user(), stage: p.stage, snapshot: calc.makeSnapshot(p) };
    st().mutateProject(pid, pp => { pp.baselines.push(b); }, { changes: [{ kind: 'baseline', target: 'project', target_id: b.id, text: '建立基準「' + name + '」（' + p.items.length + ' 個 Item）' }] });
    return b.id;
  }
  function deleteBaseline(pid, id) {
    const p = project(pid);
    const b = p.baselines.find(x => x.id === id);
    st().mutateProject(pid, pp => { pp.baselines = pp.baselines.filter(x => x.id !== id); }, { changes: [{ kind: 'remove', target: 'project', target_id: id, text: '刪除基準「' + (b ? b.name : '') + '」' }] });
  }

  // ───────── settings ─────────
  function updateSettings(patch) {
    st().mutateDb(db => { db.settings = Object.assign({}, db.settings, patch); }, { settings: true });
  }

  TIM.actions = {
    getPath, setPath, fieldDisplay,
    createProject, updateProject, duplicateProject, deleteProject,
    addLocation, updateLocation, moveLocation, deleteLocation,
    addItem, updateItem, patchItems, pasteIntoItems, insertItems, duplicateItem, deleteItems, moveItem, sortItems,
    setCovered, updateCovered, addCovered, removeCovered,
    addSource, updateSource, removeSource,
    linkMaterial, unlinkMaterial, findMaterial,
    createMaterial, updateMaterial, setDatasheets, deleteMaterial, duplicateMaterial,
    addView, updateView, updateViewStyle, deleteView, moveView, editView,
    addLogEntry, deleteLogEntry, createBaseline, deleteBaseline,
    updateSettings,
  };
})();
