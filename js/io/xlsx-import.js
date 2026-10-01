/* Excel import: read every sheet (cell text incl. merged cells, embedded images), then
 * apply the user-confirmed mapping (see ui/import-wizard.js). */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { util, schema, parse } = TIM;
  const MAX_ROWS = 3000, MAX_COLS = 60;

  function cellText(cell) {
    try {
      const v = cell.value;
      if (v == null) return '';
      if (typeof v === 'object') {
        if (v.richText) return v.richText.map(t => t.text).join('');
        if (v.text != null) return String(v.text);           // hyperlink
        if (v.result != null) return String(v.result);       // formula
        if (v instanceof Date) return util.fmtDate(v.toISOString());
      }
      return cell.text != null ? String(cell.text) : String(v);
    } catch (e) { return ''; }
  }

  /** → { sheets:[{ name, matrix, images:[{ blob, ext, col, row, title }] }] } */
  async function readWorkbook(file) {
    const ExcelJS = await TIM.loader.load('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await file.arrayBuffer());
    const sheets = [];
    wb.eachSheet(ws => {
      const matrix = [];
      const rows = Math.min(ws.rowCount || 0, MAX_ROWS);
      const cols = Math.min(Math.max(ws.columnCount || 0, ws.actualColumnCount || 0), MAX_COLS);
      for (let r = 1; r <= rows; r++) {
        const row = ws.getRow(r);
        const arr = [];
        for (let c = 1; c <= cols; c++) arr.push(cellText(row.getCell(c)).replace(/\r\n?/g, '\n'));
        matrix.push(arr);
      }
      const images = [];
      (ws.getImages ? ws.getImages() : []).forEach(img => {
        try {
          const media = wb.getImage(Number(img.imageId));
          if (!media || !media.buffer) return;
          const tl = img.range && img.range.tl ? img.range.tl : {};
          const col = Math.floor(tl.nativeCol != null ? tl.nativeCol : (tl.col || 0));
          const row = Math.floor(tl.nativeRow != null ? tl.nativeRow : (tl.row || 0));
          const ext = (media.extension || 'png').toLowerCase().replace('jpg', 'jpeg');
          images.push({ blob: new Blob([media.buffer], { type: 'image/' + ext }), ext, col, row, title: titleNear(matrix, row, col) });
        } catch (e) { /* skip unreadable image */ }
      });
      sheets.push({ name: ws.name, matrix, images });
    });
    return { sheets };
  }

  /** Text label just above an image's top-left cell (e.g. "Bottom case"). */
  function titleNear(matrix, row, col) {
    for (let r = row - 1; r >= Math.max(0, row - 3); r--) {
      const line = matrix[r] || [];
      for (let c = col; c <= col + 4 && c < line.length; c++) {
        const t = String(line[c] || '').trim();
        if (t && t.length <= 40) return t;
      }
    }
    return '';
  }

  /**
   * Apply an import.
   * cfg: { target:'new'|'append', projectName, projectId, rows:[from parse.rowsToItems], addMaterials:bool,
   *        images:[{ blob, name, include, locationName }] }
   * → project id
   */
  async function applyImport(cfg) {
    const st = TIM.store;
    const db = st.db;
    let pid = cfg.projectId;
    if (cfg.target === 'new') {
      pid = TIM.actions.createProject({ name: cfg.projectName || '匯入專案', stage: cfg.stage || 'EVT' });
      // replace default locations with the ones found in the sheet (keeps order of appearance)
      const names = [];
      cfg.rows.forEach(r => { const n = (r.location || '').trim(); if (n && !names.some(x => x.toUpperCase() === n.toUpperCase())) names.push(n); });
      if (names.length) {
        st.mutateProject(pid, p => { p.locations = names.map((n, i) => schema.newLocation(n, i)); }, { noUndo: true });
      }
    }
    const p = db.projects[pid];

    // locations by name (create missing)
    const locByName = {};
    p.locations.forEach(l => { locByName[l.name.trim().toUpperCase()] = l.id; });
    const missingLocs = [];
    cfg.rows.forEach(r => {
      const k = (r.location || '').trim().toUpperCase();
      if (k && !locByName[k] && !missingLocs.some(x => x.toUpperCase() === k)) missingLocs.push(r.location.trim());
    });
    missingLocs.forEach(n => { locByName[n.toUpperCase()] = TIM.actions.addLocation(pid, n); });

    // materials: link exact vendor+model matches, optionally create the rest
    const matKey = (v, m) => (String(v || '') + '|' + String(m || '')).trim().toUpperCase();
    const matIndex = {};
    Object.values(db.materials).forEach(m => { matIndex[matKey(m.vendor, m.model)] = m.id; });
    if (cfg.addMaterials) {
      const toCreate = {};
      cfg.rows.forEach(r => {
        const k = matKey(r.fields.vendor, r.fields.model);
        if (k !== '|' && !matIndex[k] && !toCreate[k]) toCreate[k] = { vendor: r.fields.vendor, model: r.fields.model, tim_type: r.fields.tim_type, note: '由 Excel 匯入建立，請補齊 datasheet 數值' };
      });
      Object.keys(toCreate).forEach(k => { matIndex[k] = TIM.actions.createMaterial(toCreate[k]); });
    }

    const firstLoc = p.locations[0] && p.locations[0].id;
    const rows = cfg.rows.map(r => {
      const f = util.clone(r.fields);
      const mid = matIndex[matKey(f.vendor, f.model)];
      if (mid) { f.material_id = mid; const m = db.materials[mid]; f.tim_type = m.tim_type || f.tim_type; }
      return { location_id: locByName[(r.location || '').trim().toUpperCase()] || firstLoc, fields: f };
    });
    TIM.actions.insertItems(pid, rows, { kind: 'import', label: '從 Excel 匯入' });

    // drawings → placement views
    for (const im of (cfg.images || []).filter(x => x.include)) {
      try {
        const rec = await TIM.image.fromBlob(im.blob, im.name || 'image');
        const imageId = st.addImage(rec);
        const locId = locByName[(im.locationName || im.name || '').trim().toUpperCase()] || null;
        TIM.actions.addView(pid, { name: im.name || '視圖', location_id: locId, image_id: imageId, img_w: rec.w, img_h: rec.h });
      } catch (e) { console.warn('image import failed', e); }
    }
    return pid;
  }

  TIM.xlsxImport = { readWorkbook, applyImport, titleNear };
})();
