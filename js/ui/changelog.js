/* 變更紀錄: automatic field-level log, manual / ECN entries, build baselines and diff. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, Icon, cx, go, Modal, openModal, confirm, toast, SelectField, Field } = TIM.ui;
  const { util, schema, calc } = TIM;
  const A = () => TIM.actions;

  function EntryModal(props) {
    const p = props.p;
    const [f, setF] = useState({ kind: 'ecn', ecn: '', item_no: '', text: '' });
    const set = (k, v) => setF(Object.assign({}, f, { [k]: v }));
    const save = () => {
      if (!f.text.trim()) return;
      A().addLogEntry(p.id, { kind: f.kind, ecn: f.kind === 'ecn' ? f.ecn.trim() : '', item_no: f.item_no, text: f.text.trim() });
      props.close(true);
    };
    return html`<${Modal} title="新增變更紀錄" onClose=${() => props.close(false)} onEnter=${null}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button><button class="btn btn-primary" disabled=${!f.text.trim()} onClick=${save}>新增</button>`}>
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <${Field} label="類型"><${SelectField} value=${f.kind} allowEmpty=${false} options=${[{ v: 'ecn', label: 'ECN / ECR' }, { v: 'manual', label: '一般紀錄' }]} onChange=${v => set('kind', v)} /></${Field}>
        ${f.kind === 'ecn' ? html`<${Field} label="ECN / ECR 編號"><input class="inp mono" value=${f.ecn} onInput=${e => set('ecn', e.target.value)} /></${Field}>` : html`<div></div>`}
        <${Field} label="相關 Item（選填）" class="span-2"><${SelectField} value=${f.item_no} emptyLabel="（整個專案）" options=${calc.orderedItems(p).map(it => ({ v: it.item_no, label: it.item_no }))} onChange=${v => set('item_no', v)} /></${Field}>
        <${Field} label="內容（原因 / 說明）" class="span-2"><textarea class="ta" autofocus rows="4" value=${f.text} placeholder="例如：A4 改為 2.5 mm，EVT 拆機壓痕覆蓋不足" onInput=${e => set('text', e.target.value)}></textarea></${Field}>
      </div>
    </${Modal}>`;
  }

  function BaselineModal(props) {
    const p = props.p;
    const [name, setName] = useState(p.stage);
    const [note, setNote] = useState('');
    const save = () => { if (!name.trim()) return; A().createBaseline(p.id, name.trim(), note.trim()); toast('已建立基準「' + name.trim() + '」', 'ok'); props.close(true); };
    return html`<${Modal} title="建立 Build 基準" onClose=${() => props.close(false)} onEnter=${save}
      footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(false)}>取消</button><button class="btn btn-primary" onClick=${save}>建立</button>`}>
      <p style="margin-bottom:12px">把目前 ${p.items.length} 個 Item 的完整組態存成快照，之後可與任何時間點比較（新增 / 刪除 / 欄位差異）。建議每個 build（EVT、DVT、PVT）發行時建立一次。</p>
      <div class="form-grid" style="grid-template-columns:1fr">
        <${Field} label="基準名稱"><input class="inp" autofocus value=${name} onInput=${e => setName(e.target.value)} /></${Field}>
        <${Field} label="說明（選填）"><input class="inp" value=${note} placeholder="例如：DVT build 發行組態" onInput=${e => setNote(e.target.value)} /></${Field}>
      </div>
    </${Modal}>`;
  }

  function DiffView(props) {
    const d = props.diff;
    const total = d.added.length + d.removed.length + d.changed.length;
    return html`<div>
      ${!total ? html`<div class="empty"><h3>沒有差異</h3><p>兩個版本的 TIM 組態相同。</p></div>` : null}
      ${d.added.length ? html`<div class="diff-sec"><h4><span class="log-kind add">新增</span> ${d.added.length} 個 Item</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Location</th><th>材料</th><th>Size</th><th class="r">Q'ty</th><th>Delta P/N</th></tr></thead>
        <tbody>${d.added.map(x => html`<tr><td class="mono"><b>${x.item_no}</b></td><td>${x.location}</td><td>${x.vendor} ${x.model}</td><td class="mono">${x.size}</td><td class="r mono">${x.qty}</td><td class="mono">${x.delta_pn}</td></tr>`)}</tbody></table></div></div>` : null}
      ${d.removed.length ? html`<div class="diff-sec"><h4><span class="log-kind remove">刪除</span> ${d.removed.length} 個 Item</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Item</th><th>Location</th><th>材料</th><th>Size</th><th class="r">Q'ty</th><th>Delta P/N</th></tr></thead>
        <tbody>${d.removed.map(x => html`<tr><td class="mono"><b>${x.item_no}</b></td><td>${x.location}</td><td>${x.vendor} ${x.model}</td><td class="mono">${x.size}</td><td class="r mono">${x.qty}</td><td class="mono">${x.delta_pn}</td></tr>`)}</tbody></table></div></div>` : null}
      ${d.changed.length ? html`<div class="diff-sec"><h4><span class="log-kind">修改</span> ${d.changed.length} 個 Item</h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th style="width:80px">Item</th><th style="width:130px">欄位</th><th>${props.fromLabel}</th><th>${props.toLabel}</th></tr></thead>
        <tbody>${d.changed.map(c => c.fields.map((f, i) => html`<tr>
          ${i === 0 ? html`<td class="mono" rowspan=${c.fields.length}><b>${c.item_no}</b></td>` : null}
          <td>${f.label}</td><td class="log-from">${f.from || '（空）'}</td><td class="log-to"><b>${f.to || '（空）'}</b></td>
        </tr>`))}</tbody></table></div></div>` : null}
    </div>`;
  }

  function openDiff(p, fromSnap, toSnap, fromLabel, toLabel) {
    const diff = calc.diffSnapshots(fromSnap, toSnap, TIM.store.db);
    openModal(close => html`<${Modal} title=${'差異比較：' + fromLabel + ' → ' + toLabel} size="wide" onClose=${() => close()}
      footer=${html`<span class="left">比對依 Item 識別碼，找不到時依 Item 編號</span><button class="btn btn-primary" onClick=${() => close()}>關閉</button>`}>
      <${DiffView} diff=${diff} fromLabel=${fromLabel} toLabel=${toLabel} />
    </${Modal}>`);
  }

  function Changelog(props) {
    const p = props.p;
    const st = TIM.store;
    const ro = st.readonly;
    const [kind, setKind] = useState('');
    const [item, setItem] = useState('');
    const [q, setQ] = useState('');
    const [cmp, setCmp] = useState({ a: '', b: 'current' });
    const log = useMemo(() => (p.changelog || []).slice().reverse(), [st.version, p.id]);
    const users = Array.from(new Set(log.map(l => l.user).filter(Boolean)));
    const [user, setUser] = useState('');
    const qq = q.trim().toUpperCase();
    const shown = log.filter(l => (!kind || l.kind === kind) && (!item || l.item_no === item) && (!user || l.user === user) &&
      (!qq || [l.item_no, l.field, l.from, l.to, l.text, l.ecn].some(v => String(v || '').toUpperCase().includes(qq))));
    const bls = (p.baselines || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const current = calc.makeSnapshot(p);
    const snapOf = id => (id === 'current' ? current : (bls.find(b => b.id === id) || {}).snapshot);
    const labelOf = id => (id === 'current' ? '目前' : (bls.find(b => b.id === id) || {}).name || '?');

    return html`<div class="page-inner">
      <div class="ov-grid" style="grid-template-columns:minmax(0,1fr) 360px">
        <div class="section">
          <div class="section-head">
            <div class="section-title">變更紀錄</div><div class="section-sub">${log.length} 筆 · 欄位修改自動記錄，連續輸入自動合併</div>
            <div class="right"><button class="btn btn-secondary btn-sm rw-only" onClick=${() => openModal(close => html`<${EntryModal} p=${p} close=${close} />`)}><${Icon} name="plus" /> 新增紀錄 / ECN</button></div>
          </div>
          <div class="filters" style="margin-top:0">
            <select class="sel" style="width:120px" value=${kind} onChange=${e => setKind(e.target.value)}>
              <option value="">全部類型</option>${schema.CHANGE_KINDS.map(k => html`<option value=${k.v}>${k.label}</option>`)}
            </select>
            <select class="sel" style="width:120px" value=${item} onChange=${e => setItem(e.target.value)}>
              <option value="">全部 Item</option>${calc.orderedItems(p).map(it => html`<option value=${it.item_no}>${it.item_no}</option>`)}
            </select>
            <select class="sel" style="width:120px" value=${user} onChange=${e => setUser(e.target.value)}>
              <option value="">全部人員</option>${users.map(u => html`<option value=${u}>${u}</option>`)}
            </select>
            <div class="searchbox" style="width:220px"><${Icon} name="search" /><input class="inp" style="height:30px" placeholder="搜尋內容 / ECN…" value=${q} onInput=${e => setQ(e.target.value)} /></div>
          </div>
          ${shown.length ? html`<div class="tbl-wrap" style="max-height:calc(100vh - 330px)"><table class="tbl">
            <thead><tr><th style="width:128px">時間</th><th style="width:90px">人員</th><th style="width:70px">類型</th><th style="width:70px">Item</th><th style="width:110px">欄位</th><th>變更</th><th style="width:30px"></th></tr></thead>
            <tbody>${shown.slice(0, 600).map(l => html`<tr key=${l.id}>
              <td class="mono" style="font-size:11.5px;white-space:nowrap">${util.fmtDateTime(l.ts)}</td>
              <td>${l.user || html`<span class="muted">—</span>`}</td>
              <td><span class=${cx('log-kind', l.kind)}>${schema.labelOf(schema.CHANGE_KINDS, l.kind)}</span></td>
              <td class="mono">${l.item_no ? html`<b>${l.item_no}</b>` : ''}</td>
              <td>${l.field}</td>
              <td>${l.ecn ? html`<span class="tag tag-info mono" style="margin-right:6px">${l.ecn}</span>` : null}
                ${l.text ? html`<span>${l.text}</span>` : html`<span class="log-from">${l.from}</span> → <span class="log-to">${l.to}</span>`}</td>
              <td>${(l.kind === 'manual' || l.kind === 'ecn') && !ro ? html`<button class="icon-btn danger" title="刪除此紀錄" onClick=${async () => { if (await confirm({ title: '刪除紀錄', danger: true, okText: '刪除', message: '刪除這筆' + schema.labelOf(schema.CHANGE_KINDS, l.kind) + '？' })) A().deleteLogEntry(p.id, l.id); }}><${Icon} name="x" /></button>` : null}</td>
            </tr>`)}</tbody>
          </table></div>${shown.length > 600 ? html`<div class="muted" style="font-size:11px;margin-top:4px">只顯示最新 600 筆，請用篩選縮小範圍。</div>` : null}`
          : html`<div class="empty"><h3>沒有符合的紀錄</h3><p>修改任何欄位都會自動記錄（誰、何時、從什麼改成什麼）。ECN / ECR 或會議決議可用「新增紀錄」手動補上。</p></div>`}
        </div>

        <div class="section">
          <div class="section-head">
            <div class="section-title">Build 基準</div><div class="section-sub">${bls.length} 個</div>
            <div class="right"><button class="btn btn-primary btn-sm rw-only" onClick=${() => openModal(close => html`<${BaselineModal} p=${p} close=${close} />`)}><${Icon} name="flag" /> 建立基準</button></div>
          </div>
          <div class="panel">
            ${bls.length ? bls.map(b => html`<div class="baseline-card" key=${b.id}>
              <div>
                <div class="name">${b.name} <span class="tag tag-stage">${b.stage || ''}</span></div>
                <div class="muted" style="font-size:11.5px">${util.fmtDateTime(b.created_at)} · ${b.created_by || ''} · ${(b.snapshot && b.snapshot.items || []).length} items</div>
                ${b.note ? html`<div style="font-size:12px;margin-top:2px">${b.note}</div>` : null}
              </div>
              <div class="row" style="gap:2px">
                <button class="btn btn-secondary btn-xs" onClick=${() => openDiff(p, b.snapshot, current, b.name, '目前')}>與目前比較</button>
                <button class="icon-btn danger rw-only" title="刪除基準" onClick=${async () => { if (await confirm({ title: '刪除基準', danger: true, okText: '刪除', message: '刪除基準「' + b.name + '」？' })) A().deleteBaseline(p.id, b.id); }}><${Icon} name="trash" /></button>
              </div>
            </div>`) : html`<div class="panel-pad muted" style="font-size:12px">尚未建立。建議在每個 build 發行時建立一次，之後可直接比較 EVT → DVT 改了什麼。</div>`}
          </div>
          ${bls.length >= 1 ? html`<div class="panel panel-pad mt12">
            <div class="field-label" style="margin-bottom:8px">任選兩個版本比較</div>
            <div class="row" style="gap:6px">
              <select class="sel" value=${cmp.a || (bls[1] || bls[0]).id} onChange=${e => setCmp(Object.assign({}, cmp, { a: e.target.value }))}>
                ${bls.map(b => html`<option value=${b.id}>${b.name}</option>`)}
              </select>
              <span>→</span>
              <select class="sel" value=${cmp.b} onChange=${e => setCmp(Object.assign({}, cmp, { b: e.target.value }))}>
                <option value="current">目前</option>${bls.map(b => html`<option value=${b.id}>${b.name}</option>`)}
              </select>
            </div>
            <button class="btn btn-secondary btn-sm mt8" onClick=${() => { const a = cmp.a || (bls[1] || bls[0]).id; openDiff(p, snapOf(a), snapOf(cmp.b), labelOf(a), labelOf(cmp.b)); }}>比較</button>
          </div>` : null}
        </div>
      </div>
    </div>`;
  }

  TIM.ui.Changelog = Changelog;
})();
