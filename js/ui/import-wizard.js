/* Excel import wizard: 1 選檔 → 2 欄位對應 + 預覽 → 3 匯入設定（專案、材料庫、位置圖）. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, useEffect, useRef, Icon, cx, go, Modal, openModal, toast, SelectField, Field } = TIM.ui;
  const { util, schema, parse } = TIM;

  const FIELDS = [
    ['location', 'Location'], ['item_no', 'Item'], ['used_on', 'Used On'], ['vendor', 'Vendor'], ['model', 'Model'],
    ['size', 'Size'], ['qty', "Q'ty"], ['delta_pn', 'Delta P/N'], ['covered', 'Note（覆蓋元件）'], ['second_source', '2nd source'],
  ];

  function colName(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

  function ImportWizard(props) {
    const [step, setStep] = useState(1);
    const [file, setFile] = useState(null);
    const [wb, setWb] = useState(null);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [sheetIdx, setSheetIdx] = useState(0);
    const [headerRow, setHeaderRow] = useState(0);
    const [map, setMap] = useState({});
    const [srcStatus, setSrcStatus] = useState('unknown');
    const [target, setTarget] = useState('new');
    const [projName, setProjName] = useState('');
    const [stage, setStage] = useState('EVT');
    const [projId, setProjId] = useState('');
    const [addMats, setAddMats] = useState(true);
    const [imgs, setImgs] = useState([]);
    const [over, setOver] = useState(false);
    const projects = Object.values(TIM.store.db.projects);

    const load = async f => {
      if (!f) return;
      if (!/\.xlsx$/i.test(f.name)) { setErr('請選擇 .xlsx 檔（舊版 .xls 請先在 Excel 另存為 .xlsx）'); return; }
      setErr(''); setBusy(true); setFile(f);
      try {
        const w = await TIM.xlsxImport.readWorkbook(f);
        // choose the sheet with the best header match
        let best = 0, bestScore = -1;
        w.sheets.forEach((s, i) => { const h = parse.detectHeader(s.matrix); const sc = h ? h.score : 0; if (sc > bestScore) { bestScore = sc; best = i; } });
        setWb(w);
        pickSheet(w, best);
        setProjName(f.name.replace(/\.xlsx$/i, ''));
        setStep(2);
      } catch (e) {
        console.error(e);
        setErr('讀取失敗：' + (e.message || e));
      } finally { setBusy(false); }
    };
    const pickSheet = (w, i) => {
      setSheetIdx(i);
      const s = w.sheets[i];
      const h = parse.detectHeader(s.matrix);
      setHeaderRow(h ? h.row : 0);
      setMap(h ? h.map : {});
      setImgs(s.images.map((im, k) => ({ blob: im.blob, include: true, name: im.title || ('視圖 ' + (k + 1)), url: URL.createObjectURL(im.blob) })));
    };
    const urls = useRef([]);
    useEffect(() => { imgs.forEach(i => { if (!urls.current.includes(i.url)) urls.current.push(i.url); }); }, [imgs]);
    useEffect(() => () => urls.current.forEach(u => URL.revokeObjectURL(u)), []);

    const sheet = wb ? wb.sheets[sheetIdx] : null;
    const header = sheet ? (sheet.matrix[headerRow] || []) : [];
    const rows = useMemo(() => (sheet ? parse.rowsToItems(sheet.matrix, headerRow, map, { sourceStatus: srcStatus }) : []), [sheet, headerRow, map, srcStatus]);
    const warnCount = rows.reduce((n, r) => n + r.warnings.length, 0);
    const locNames = Array.from(new Set(rows.map(r => r.location).filter(Boolean)));

    const doImport = async () => {
      setBusy(true);
      try {
        const pid = await TIM.xlsxImport.applyImport({
          target, projectName: projName.trim() || '匯入專案', stage, projectId: projId,
          rows, addMaterials: addMats, images: imgs.map(i => ({ blob: i.blob, include: i.include, name: i.name.trim(), locationName: i.name.trim() })),
        });
        toast('已匯入 ' + rows.length + ' 個 Item' + (imgs.filter(i => i.include).length ? '、' + imgs.filter(i => i.include).length + ' 張位置圖' : ''), 'ok');
        props.close(pid);
      } catch (e) {
        console.error(e);
        setErr('匯入失敗：' + (e.message || e));
        setBusy(false);
      }
    };

    const steps = html`<div class="steps">
      ${['選擇檔案', '欄位對應與預覽', '匯入設定'].map((l, i) => html`<div class=${cx('step', step === i + 1 && 'on', step > i + 1 && 'done')}><span class="n">${step > i + 1 ? '✓' : i + 1}</span>${l}</div>`)}
    </div>`;

    let body, foot;
    if (step === 1) {
      body = html`
        <div class=${cx('dropzone', over && 'over')} onClick=${async () => load(await TIM.ui.pickFile('.xlsx'))}
          onDragOver=${e => { e.preventDefault(); setOver(true); }} onDragLeave=${() => setOver(false)}
          onDrop=${e => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}>
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">${busy ? '讀取中…' : '點擊選擇或拖曳 .xlsx 檔'}</div>
          <div>支援現行 TIM 清單格式：Location / Item / Used On / Vendor / Model / Size / Q'ty / Delta Part No. / Note / 2nd source<br/>合併儲存格、工作表內的機殼圖片也會一併讀取。檔案只在瀏覽器內處理，不會上傳。</div>
        </div>
        ${err ? html`<div class="field-err mt8">${err}</div>` : null}`;
      foot = html`<button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>`;
    } else if (step === 2) {
      body = html`
        <div class="row wrap" style="gap:14px;margin-bottom:12px">
          ${wb.sheets.length > 1 ? html`<${Field} label="工作表"><select class="sel" style="width:200px" value=${sheetIdx} onChange=${e => pickSheet(wb, parseInt(e.target.value, 10))}>
            ${wb.sheets.map((s, i) => html`<option value=${i}>${s.name}</option>`)}</select></${Field}>` : html`<${Field} label="工作表"><div class="ref-value">${sheet.name}</div></${Field}>`}
          <${Field} label="標題列（第幾列）"><input class="inp" type="number" min="1" style="width:110px" value=${headerRow + 1} onInput=${e => { const n = parseInt(e.target.value, 10); if (n >= 1) setHeaderRow(n - 1); }} /></${Field}>
          <${Field} label="2nd source 欄位的廠商視為" info="現行 Excel 的 2nd source 沒有記錄是否已承認；選「待確認」最保守（會列入待處理事項）。"><${SelectField} value=${srcStatus} allowEmpty=${false} options=${[{ v: 'unknown', label: '待確認' }, { v: 'qualified', label: '已承認' }, { v: 'testing', label: '驗證中' }]} onChange=${setSrcStatus} /></${Field}>
        </div>
        <div class="field-label" style="margin-bottom:6px">欄位對應（自動偵測，可調整）</div>
        <div class="map-grid">
          ${FIELDS.map(([f, l]) => html`<${Field} label=${l}>
            <select class="sel" value=${map[f] == null ? '' : map[f]} onChange=${e => { const v = e.target.value; const m = Object.assign({}, map); if (v === '') delete m[f]; else m[f] = parseInt(v, 10); setMap(m); }}>
              <option value="">（不匯入）</option>
              ${header.map((h, i) => html`<option value=${i}>${colName(i)}：${String(h || '').slice(0, 24) || '(空白)'}</option>`)}
            </select>
          </${Field}>`)}
        </div>
        <div class="row mt12" style="gap:10px">
          <b>${rows.length}</b> 個 Item · ${locNames.length ? 'Location：' + locNames.join('、') : '（未對應 Location）'}
          ${warnCount ? html`<span class="tag tag-warn">${warnCount} 個儲存格無法解析（見右欄）</span>` : html`<span class="tag tag-ok">全部可解析</span>`}
          ${sheet.images.length ? html`<span class="tag tag-info">偵測到 ${sheet.images.length} 張圖片</span>` : null}
        </div>
        <div class="tbl-wrap mt8" style="max-height:300px">
          <table class="tbl preview-tbl"><thead><tr><th>列</th><th>Location</th><th>Item</th><th>Used On</th><th>Vendor</th><th>Model</th><th>型態</th><th>Size</th><th class="r">Q'ty</th><th>Delta P/N</th><th>覆蓋元件</th><th>2nd source</th><th>注意</th></tr></thead>
          <tbody>${rows.slice(0, 200).map(r => html`<tr>
            <td class="mono muted">${r.row + 1}</td><td>${r.location}</td><td class="mono"><b>${r.fields.item_no}</b></td><td>${r.fields.used_on.join('/')}</td>
            <td>${r.fields.vendor}</td><td>${r.fields.model}</td><td>${schema.timType(r.fields.tim_type).label}</td><td class="mono">${parse.formatSize(r.fields.size)}</td>
            <td class="r mono">${r.fields.qty == null ? '' : r.fields.qty}</td><td class="mono">${r.fields.delta_pn}</td><td>${parse.formatCovered(r.fields.covered)}</td>
            <td>${r.fields.sources.length ? parse.formatSources(r.fields) : html`<span class="tag tag-single">${r.fields.sourcing_note || '單一來源'}</span>`}</td>
            <td class="text-warn" style="font-size:11px">${r.warnings.join('；')}</td>
          </tr>`)}</tbody></table>
        </div>
        ${!rows.length ? html`<div class="field-err mt8">沒有解析到任何資料列：請確認標題列與欄位對應（至少要對應 Item 或 Vendor / Model / Size 其中之一）。</div>` : null}`;
      foot = html`<span class="left">${file ? file.name : ''}</span>
        <button class="btn btn-ghost" onClick=${() => setStep(1)}>上一步</button>
        <button class="btn btn-primary" disabled=${!rows.length} onClick=${() => setStep(3)}>下一步</button>`;
    } else {
      body = html`
        <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr">
          <${Field} label="匯入到"><div class="seg">
            <button class=${target === 'new' ? 'on' : ''} onClick=${() => setTarget('new')}>新專案</button>
            <button class=${target === 'append' ? 'on' : ''} disabled=${!projects.length} onClick=${() => { setTarget('append'); if (!projId && projects[0]) setProjId(projects[0].id); }}>既有專案（附加）</button>
          </div></${Field}>
          ${target === 'new' ? html`
            <${Field} label="專案名稱"><input class="inp" value=${projName} onInput=${e => setProjName(e.target.value)} /></${Field}>
            <${Field} label="Stage"><${SelectField} value=${stage} allowEmpty=${false} options=${schema.STAGES} onChange=${setStage} /></${Field}>
          ` : html`<${Field} label="專案" class="span-2"><${SelectField} value=${projId} allowEmpty=${false} options=${projects.map(p => ({ v: p.id, label: p.name + '（' + p.stage + '）' }))} onChange=${setProjId} /></${Field}>`}
        </div>
        <div class="mt12"><label class="check"><input type="checkbox" checked=${addMats} onChange=${e => setAddMats(e.target.checked)} />
          把材料庫沒有的 Vendor / Model 自動建立成材料並連結（之後到材料庫補 k 值等 datasheet 數值並上傳規格書）</label></div>
        <div class="muted" style="font-size:12px;margin-top:4px">材料庫已有相同 Vendor + Model 的材料會自動連結。</div>
        ${imgs.length ? html`<div class="divider"></div>
          <div class="field-label" style="margin-bottom:8px">工作表中的圖片 → 建立位置標註視圖（名稱與 Location 相同時自動連結）</div>
          <div class="img-thumbs">${imgs.map((im, i) => html`<div class="img-thumb" key=${i}>
            <img src=${im.url} alt=${im.name} />
            <div class="meta">
              <label class="check"><input type="checkbox" checked=${im.include} onChange=${e => setImgs(imgs.map((x, j) => (j === i ? Object.assign({}, x, { include: e.target.checked }) : x)))} /> 匯入此圖</label>
              <input class="inp" value=${im.name} onInput=${e => setImgs(imgs.map((x, j) => (j === i ? Object.assign({}, x, { name: e.target.value }) : x)))} />
            </div>
          </div>`)}</div>
          <div class="muted" style="font-size:11.5px;margin-top:8px">匯入後到「位置標註」：先用「比例尺」校正，再把 pad 放上去（Excel 裡手畫的箭頭不會被讀取）。</div>` : null}
        ${err ? html`<div class="field-err mt8">${err}</div>` : null}`;
      foot = html`<span class="left">${rows.length} 個 Item · ${imgs.filter(i => i.include).length} 張圖</span>
        <button class="btn btn-ghost" onClick=${() => setStep(2)}>上一步</button>
        <button class="btn btn-primary" disabled=${busy || (target === 'append' && !projId)} onClick=${doImport}><${Icon} name="upload" /> ${busy ? '匯入中…' : '匯入'}</button>`;
    }

    return html`<${Modal} title="匯入 Excel TIM 清單" size="wide" dismissable=${false} onClose=${() => props.close(null)} footer=${foot}>
      ${steps}${body}
    </${Modal}>`;
  }

  async function openImportExcel() {
    const pid = await openModal(close => html`<${ImportWizard} close=${close} />`).promise;
    if (pid) go('p/' + pid + '/bom');
  }

  TIM.ui.openImportExcel = openImportExcel;
})();
