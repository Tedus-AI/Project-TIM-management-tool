/* 匯入材料: the AI reads the vendor datasheet and writes "tim-material" JSON (js/core/matimport.js);
 * this dialog copies the instructions for the AI, takes the reply (files or pasted text, plus the
 * datasheet files to attach), previews every material against the library and imports in one
 * undo step. Existing materials (same Vendor + Model) only get their empty fields filled unless
 * the user picks 覆蓋. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, Icon, cx, Modal, openModal, toast, downloadBlob, pickFiles, go } = TIM.ui;
  const { schema } = TIM;
  const MI = TIM.matImport;
  const isData = f => /\.(json|txt|md)$/i.test(f.name) || /^(application\/json|text\/)/.test(f.type || '');
  const ACTIONS_NEW = [{ v: 'new', label: '新增' }, { v: 'skip', label: '略過' }];
  const ACTIONS_OLD = [{ v: 'fill', label: '補空白欄位' }, { v: 'overwrite', label: '覆蓋' }, { v: 'skip', label: '略過' }];

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  function show(f, v) {
    if (v === null || v === undefined || v === '') return '—';
    if (f.kind === 'bool') return v ? '是' : '否';
    if (f.key === 'tim_type') return schema.timType(v).label;
    if (f.key === 'silicone') return schema.labelOf(schema.SILICONE, v);
    return String(v) + (f.unit ? ' ' + f.unit : '');
  }
  const fieldOf = key => MI.FIELDS.find(f => f.key === key);

  /** Several files / one pasted text → { entries, warnings } (a file that cannot be read becomes a warning). */
  function parseAll(sources) {
    const entries = [], warnings = [];
    let firstErr = '';
    sources.forEach(src => {
      try {
        const r = MI.parse(src.text);
        r.entries.forEach(e => entries.push(Object.assign(e, { from: src.name })));
        r.warnings.forEach(w => warnings.push((src.name ? src.name + '：' : '') + w));
      } catch (e) {
        if (!firstErr) firstErr = (src.name ? src.name + '：' : '') + e.message;
        else warnings.push((src.name ? src.name + '：' : '') + e.message);
      }
    });
    if (!entries.length) throw new Error(firstErr || '沒有可匯入的材料');
    if (firstErr) warnings.unshift(firstErr);
    return { entries, warnings };
  }

  function ImportModal(props) {
    const st = TIM.ui.useStore();
    const [text, setText] = useState('');
    const [parsed, setParsed] = useState(null);
    const [rows, setRows] = useState([]);
    const [err, setErr] = useState('');
    const [open, setOpen] = useState({});
    const [docs, setDocs] = useState([]);          // [{ file, target: 'all' | 'none' | row index }]
    const [over, setOver] = useState(false);
    const [busy, setBusy] = useState(false);
    const files = st.backend && st.backend.files && st.backend.files.supported() ? st.backend.files : null;

    const use = sources => {
      try {
        const p = parseAll(sources);
        const r = MI.plan(p, st.db.materials);
        setParsed(p); setRows(r); setErr('');
        setOpen(r.length === 1 ? { 0: true } : {});
      } catch (e) { setParsed(null); setRows([]); setErr(e.message); }
    };
    const addFiles = async list => {
      const data = list.filter(isData), other = list.filter(f => !isData(f));
      if (other.length) setDocs(prev => prev.concat(other.filter(f => !prev.some(d => d.file.name === f.name)).map(file => ({ file, target: 'auto' }))));
      if (data.length) { const sources = await Promise.all(data.map(async f => ({ name: f.name, text: await f.text() }))); setText(''); use(sources); }
    };
    const setAction = (i, action) => setRows(prev => prev.map(r => (r.i === i ? Object.assign({}, r, { action }) : r)));
    const active = rows.filter(r => r.action !== 'skip');
    const targetOf = d => (d.target === 'auto' ? (active.length === 1 ? active[0].i : 'all') : d.target);

    const run = async () => {
      if (busy || !active.length) return;
      setBusy(true);
      try {
        const res = TIM.actions.importMaterials(rows.map(r => ({ fields: r.entry.fields, matchId: r.matchId, action: r.action })));
        const firstId = res.ids.find(Boolean);
        if (files) {
          for (const d of docs) {
            const t = targetOf(d);
            const ids = t === 'all' ? res.ids.filter(Boolean) : t === 'none' ? [] : [res.ids[t]].filter(Boolean);
            for (const id of ids) await TIM.datasheets.upload(id, [d.file]);
          }
        }
        toast('已匯入材料：新增 ' + res.created + ' 種、更新 ' + res.updated + ' 種（材料庫可按 Ctrl+Z 復原）', 'ok', { timeout: 5000 });
        props.close(res);
        if (firstId) go('library/' + firstId);
      } finally { setBusy(false); }
    };

    const intro = html`<div class="mi-steps">
      <div class="mi-step"><b>1</b><div>按「複製 AI 指令」，把指令和廠商規格書（PDF）一起交給 AI（Claude、ChatGPT、Copilot…）。
        <div class="row" style="gap:8px;margin-top:8px">
          <button class="btn btn-primary btn-sm" onClick=${async () => toast((await copyText(MI.prompt())) ? '已複製 AI 指令' : '無法自動複製，請展開「看指令內容」手動複製', 'ok')}><${Icon} name="copy" /> 複製 AI 指令</button>
          <button class="btn btn-secondary btn-sm" onClick=${() => downloadBlob(new Blob([JSON.stringify(MI.example(), null, 2)], { type: 'application/json' }), 'tim-material-example.json')}><${Icon} name="download" /> 下載範例檔</button>
        </div>
        <details class="mi-prompt"><summary>看指令內容</summary><pre>${MI.prompt()}</pre></details></div></div>
      <div class="mi-step"><b>2</b><div>把 AI 輸出的檔案（.json）拖進來，或直接貼上 AI 的回覆；規格書檔案也可以一起拖進來，匯入時附到材料上。</div></div>
    </div>`;

    const drop = html`<div class=${cx('dropzone mi-drop', over && 'over')}
        onDragOver=${e => { e.preventDefault(); if (!over) setOver(true); }}
        onDragLeave=${e => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
        onDrop=${e => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files || [])); }}
        onClick=${async () => addFiles(await pickFiles('.json,.txt,.md,.pdf,image/*,application/json'))}>
      <${Icon} name="upload" size=${20} />
      <div><b>拖進 AI 輸出的 JSON 檔（與規格書檔案）</b>，或點這裡選檔</div>
    </div>
    <textarea class="ta mono mi-paste" rows="4" placeholder="或把 AI 的回覆貼在這裡（有沒有 \`\`\`json 都可以）" value=${text}
      onInput=${e => { const t = e.target.value; setText(t); if (t.trim()) use([{ name: '', text: t }]); else { setParsed(null); setRows([]); setErr(''); } }}></textarea>`;

    const table = parsed ? html`<table class="subtbl mi-table">
      <thead><tr><th style="width:120px">動作</th><th>Vendor</th><th>Model</th><th>型態</th><th class="r">k</th><th>變更</th><th></th></tr></thead>
      <tbody>${rows.map(r => {
        const cur = r.matchId ? st.db.materials[r.matchId] : null;
        const ch = MI.changesFor(r.entry, cur, r.action);
        const f = r.entry.fields;
        const warn = r.entry.warnings.length;
        return html`<tr key=${r.i} class=${cx(r.action === 'skip' && 'mi-skip')}>
            <td><select class="sel" value=${r.action} onChange=${e => setAction(r.i, e.target.value)}>${(cur ? ACTIONS_OLD : ACTIONS_NEW).map(a => html`<option value=${a.v}>${a.label}</option>`)}</select></td>
            <td>${f.vendor || html`<span class="muted">—</span>`}</td>
            <td><b>${f.model || '—'}</b> ${cur ? html`<span class="tag tag-mute">已在材料庫</span>` : html`<span class="tag tag-ok">新材料</span>`}</td>
            <td>${f.tim_type ? schema.timType(f.tim_type).label : html`<span class="muted">—</span>`}</td>
            <td class="r mono">${(() => {
              const keep = cur && r.action === 'fill' && cur.k != null;
              const k = r.action === 'skip' ? (cur ? cur.k : null) : keep ? cur.k : f.k;
              return html`${k == null ? '' : k}${keep && f.k != null && f.k !== cur.k ? html`<div class="muted" style="font-size:10.5px">AI ${f.k}（不覆蓋）</div>` : null}`;
            })()}</td>
            <td>${r.action === 'skip' ? html`<span class="muted">不匯入</span>` : ch.length + ' 個欄位'}${warn ? html` <span class="tag tag-warn" title=${r.entry.warnings.join('\n')}>${warn} 個提醒</span>` : null}</td>
            <td><button class="btn btn-ghost btn-xs" onClick=${() => setOpen(o => Object.assign({}, o, { [r.i]: !o[r.i] }))}>${open[r.i] ? '收合' : '明細'}</button></td>
          </tr>
          ${open[r.i] ? html`<tr class="mi-detail"><td colspan="7">
            ${r.entry.warnings.length ? html`<ul class="mi-warn">${r.entry.warnings.map(w => html`<li>${w}</li>`)}</ul>` : null}
            ${ch.length ? html`<table class="mi-fields"><thead><tr><th>欄位</th><th>匯入值</th>${cur ? html`<th>材料庫目前</th>` : null}<th>規格書依據（AI 提供）</th></tr></thead>
              <tbody>${ch.map(c => { const fd = fieldOf(c.key); return html`<tr><td>${c.label}</td><td class="mono"><b>${show(fd, c.to)}</b></td>${cur ? html`<td class="mono muted">${show(fd, c.from)}</td>` : null}<td class="muted">${r.entry.evidence[c.key] || ''}</td></tr>`; })}</tbody></table>`
              : html`<div class="muted">${r.action === 'skip' ? '不匯入。' : '沒有要變更的欄位（材料庫的值都已填）。'}</div>`}
          </td></tr>` : null}`;
      })}</tbody>
    </table>` : null;

    const docList = docs.length ? html`<div class="mi-docs">
      <div class="field-label">規格書檔案</div>
      ${!files ? html`<p class="text-err" style="font-size:12px">需以 SharePoint 或資料夾開啟資料庫才能附上規格書；這些檔案不會上傳。</p>` : null}
      ${docs.map((d, k) => html`<div class="mi-doc" key=${d.file.name}>
        <${Icon} name="file" /><span class="mono">${d.file.name}</span>
        <span class="muted">附到</span>
        <select class="sel" value=${String(targetOf(d))} disabled=${!files} onChange=${e => { const v = e.target.value; setDocs(prev => prev.map((x, j) => (j === k ? Object.assign({}, x, { target: v === 'all' || v === 'none' ? v : Number(v) }) : x))); }}>
          ${active.length > 1 ? html`<option value="all">全部 ${active.length} 種材料</option>` : null}
          ${active.map(r => html`<option value=${String(r.i)}>${[r.entry.fields.vendor, r.entry.fields.model].filter(Boolean).join(' ')}</option>`)}
          <option value="none">不附加</option>
        </select>
        <button class="icon-btn" title="移除" onClick=${() => setDocs(prev => prev.filter((x, j) => j !== k))}><${Icon} name="x" /></button>
      </div>`)}
    </div>` : null;

    return html`<${Modal} title="匯入材料" size="wide" onClose=${() => props.close(null)}
        footer=${html`<span class="left">AI 擷取的數值請在明細裡對照規格書依據確認；匯入後材料庫可按 Ctrl+Z 復原。</span>
          <button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>
          <button class="btn btn-primary" disabled=${busy || !active.length} onClick=${run}>${busy ? '匯入中…' : active.length ? '匯入 ' + active.length + ' 種材料' : '匯入'}</button>`}>
      ${intro}
      ${drop}
      ${err ? html`<p class="text-err mt8">${err}</p>` : null}
      ${parsed && parsed.warnings.length ? html`<ul class="mi-warn mt8">${parsed.warnings.map(w => html`<li>${w}</li>`)}</ul>` : null}
      ${table}
      ${docList}
    </${Modal}>`;
  }

  TIM.ui.openMaterialImport = () => openModal(close => html`<${ImportModal} close=${close} />`).promise;
})();
