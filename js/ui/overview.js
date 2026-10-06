/* Overview tab: project info, readouts, automatic checks, locations, material usage. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useMemo, useState, Icon, cx, go, usePref, TextField, NumField, SelectField, Field, ColorField, confirm, prompt, InfoDot } = TIM.ui;
  const { schema, calc, util } = TIM;
  const A = () => TIM.actions;

  function Readout(props) {
    return html`<div class=${cx('readout', props.tone && 'is-' + props.tone)}>
      <div class="k">${props.k}${props.info ? html` <${InfoDot}>${props.info}</${InfoDot}>` : null}</div>
      <div class="v">${props.v}${props.unit ? html`<small>${props.unit}</small>` : null}</div>
      ${props.d ? html`<div class="d">${props.d}</div>` : null}
    </div>`;
  }

  function LocationsEditor(props) {
    const p = props.p;
    const ro = TIM.store.readonly;
    const counts = {};
    p.items.forEach(it => { counts[it.location_id] = (counts[it.location_id] || 0) + 1; });
    const del = async loc => {
      const n = counts[loc.id] || 0;
      if (p.locations.length <= 1) { TIM.ui.toast('至少要保留一個 Location', 'warn'); return; }
      const others = p.locations.filter(l => l.id !== loc.id);
      if (n) {
        const ok = await confirm({ title: '刪除 Location', danger: true, okText: '刪除並移動',
          message: '「' + loc.name + '」有 ' + n + ' 個 Item，刪除後會移到「' + others[0].name + '」。連結到此 Location 的位置圖會改為未指定。' });
        if (!ok) return;
      } else if (!(await confirm({ title: '刪除 Location', danger: true, okText: '刪除', message: '刪除「' + loc.name + '」？' }))) return;
      A().deleteLocation(p.id, loc.id, others[0].id);
    };
    return html`<div class="panel">
      ${p.locations.map((l, i) => html`<div key=${l.id} class="row" style="padding:8px 12px;border-bottom:1px solid var(--line);gap:10px">
        <span class="swatch" style=${{ background: l.color, width: '16px', height: '16px' }}></span>
        <div style="flex:1;max-width:240px"><${TextField} value=${l.name} disabled=${ro} onChange=${v => A().updateLocation(p.id, l.id, { name: v })} /></div>
        <${ColorField} value=${l.color} palette=${schema.LOCATION_COLORS.concat(['#F4B183', '#A9D08E'])} disabled=${ro} onChange=${c => A().updateLocation(p.id, l.id, { color: c })} />
        <span class="muted mono" style="font-size:11px;width:64px;text-align:right">${counts[l.id] || 0} items</span>
        <div class="row rw-only" style="gap:0">
          <button class="icon-btn" title="上移" disabled=${i === 0} onClick=${() => A().moveLocation(p.id, l.id, -1)}><${Icon} name="chevU" /></button>
          <button class="icon-btn" title="下移" disabled=${i === p.locations.length - 1} onClick=${() => A().moveLocation(p.id, l.id, 1)}><${Icon} name="chevD" /></button>
          <button class="icon-btn danger" title="刪除 Location" onClick=${() => del(l)}><${Icon} name="trash" /></button>
        </div>
      </div>`)}
      <div style="padding:8px 12px" class="rw-only">
        <button class="btn btn-ghost btn-sm" onClick=${async () => { const n = await prompt({ title: '新增 Location', label: '名稱', placeholder: '例如：Heatsink、Shield can、PSU cover', validate: v => (v.trim() ? '' : '請輸入名稱') }); if (n) A().addLocation(p.id, n.trim()); }}><${Icon} name="plus" /> 新增 Location</button>
      </div>
    </div>`;
  }

  function Overview(props) {
    const p = props.p;
    const s = props.stats;
    const st = TIM.store;
    const ro = st.readonly;
    const [lv, setLv] = usePref('ov_level', 'all');
    const checks = useMemo(() => calc.projectChecks(p, st.db), [st.version, p.id]);
    const shown = checks.filter(c => lv === 'all' || c.level === lv);
    const usage = useMemo(() => calc.materialUsage(p, st.db), [st.version, p.id]);
    const set = (path, v) => A().updateProject(p.id, path, v);
    const costKeys = Object.keys(s.cost);

    return html`<div class="page-inner">
      <div class="ov-grid">
        <div>
          <div class="section">
            <div class="section-head"><div class="section-title">專案資訊</div><div class="section-sub">變更會記錄在變更紀錄</div></div>
            <div class="panel panel-pad">
              <div class="form-grid">
                <${Field} label="案名" class="span-2"><${TextField} value=${p.name} disabled=${ro} onChange=${v => set('name', v)} /></${Field}>
                <${Field} label="專案代碼"><${TextField} value=${p.code} disabled=${ro} onChange=${v => set('code', v)} /></${Field}>
                <${Field} label="產品類型"><${SelectField} value=${p.product_type} options=${schema.PRODUCT_TYPES} disabled=${ro} onChange=${v => set('product_type', v)} /></${Field}>
                <${Field} label="客戶"><${TextField} value=${p.customer} disabled=${ro} onChange=${v => set('customer', v)} /></${Field}>
                <${Field} label="Stage"><${SelectField} value=${p.stage} allowEmpty=${false} options=${schema.STAGES} disabled=${ro} onChange=${v => set('stage', v)} /></${Field}>
                <${Field} label="專案狀態"><${SelectField} value=${p.status} allowEmpty=${false} options=${schema.PROJECT_STATUS} disabled=${ro} onChange=${v => set('status', v)} /></${Field}>
                <${Field} label="熱流負責人"><${TIM.ui.PersonField} func="TH/ME" value=${p.owner} disabled=${ro} onChange=${v => set('owner', v)} /></${Field}>
                <${Field} label="機構負責人"><${TIM.ui.PersonField} func="TH/ME" value=${p.me_owner} disabled=${ro} onChange=${v => set('me_owner', v)} /></${Field}>
                <${Field} label="備註" class="span-all"><${TextField} multiline=${true} rows=${3} value=${p.description} disabled=${ro} onChange=${v => set('description', v)} /></${Field}>
              </div>
              <div class="muted" style="font-size:11.5px;margin-top:12px">建立：${util.fmtDateTime(p.created_at)} ${p.created_by} · 最後修改：${util.fmtDateTime(p.updated_at)} ${p.updated_by}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-head"><div class="section-title">Location</div><div class="section-sub">TIM 清單分組與 Excel 匯出的 Location 欄（含底色）</div></div>
            <${LocationsEditor} p=${p} />
          </div>

          <div class="section">
            <div class="section-head"><div class="section-title">材料用量彙總</div><div class="section-sub">每台用量（不含停用 Item）· 採購 / 備料參考</div>
              <div class="right"><${InfoDot}><div class="formula">片狀 TIM：Σ Q'ty（pcs）<br/>點膠類：Σ Q'ty × 點膠量（g 或 cc，依 Item 設定）<br/>同一材料有不同單位時分開列出</div></${InfoDot}></div></div>
            ${usage.length ? html`<div class="tbl-wrap"><table class="tbl">
              <thead><tr><th>Vendor</th><th>Model</th><th class="r">每台用量</th><th>Items</th></tr></thead>
              <tbody>${usage.map(u => html`<tr><td>${u.vendor}</td><td>${u.model}</td><td class="r mono">${u.usage || '—'}</td><td class="mono" style="font-size:12px">${u.items.join(', ')}</td></tr>`)}</tbody>
            </table></div>` : html`<div class="empty"><p>尚無 Item。</p></div>`}
          </div>
        </div>

        <div>
          <div class="section">
            <div class="section-head"><div class="section-title">狀態</div><div class="section-sub">不含停用 Item</div></div>
            <div class="readouts">
              <${Readout} k="Items" v=${s.items} d=${p.locations.map(l => l.name + ' ' + p.items.filter(i => i.location_id === l.id && i.status !== 'obsolete').length).join(' · ')} />
              <${Readout} k="每台總片數" v=${s.pcs} unit="pcs" />
              <${Readout} k="材料種類" v=${s.materials} />
              <${Readout} k="每台 TIM 成本" v=${costKeys.length ? util.fmt(s.cost[costKeys[0]], 2) : '—'} unit=${costKeys[0] || ''}
                d=${s.cost_missing ? s.cost_missing + ' 項未填單價' : '全部已填單價'} info="每台成本 = Σ(Q'ty × 單價)。未填單價的 Item 不計入。" />
              <${Readout} k="單一來源" v=${s.single} tone=${s.single ? 'warn' : 'ok'} d="沒有任何第二來源" />
              <${Readout} k="第二來源未承認" v=${s.unverified} tone=${s.unverified ? 'warn' : 'ok'} d="有列出但尚未承認" />
              <${Readout} k="壓縮 / 壓力 Fail" v=${s.comp_fail} unit="Item" tone=${s.comp_fail ? 'err' : 'ok'} d="壓縮不足、未接觸或壓力超過元件耐壓"
                info="間隙與壓力檢核判定 Fail 的 Item 數（一個 Item 只算一次）。" />
              <${Readout} k="壓縮 / 壓力 Warning" v=${s.comp_warn} unit="Item" tone=${s.comp_warn ? 'warn' : 'ok'} d=${'壓力達耐壓 ' + (st.db.settings.pressure_warn_pct || 80) + '% 以上或超出材料曲線'}
                info="間隙與壓力檢核判定 Warning 的 Item 數（沒有 Fail，但需要注意）。" />
              <${Readout} k="位置圖放置" v=${p.views.length ? s.placed + '/' + s.qty_total : '—'} unit=${p.views.length ? 'pcs' : ''}
                tone=${p.views.length && s.placed !== s.qty_total ? 'warn' : null} d=${p.views.length ? p.views.length + ' 張位置圖' : '尚未建立位置圖'} />
            </div>
          </div>

          <div class="section">
            <div class="section-head">
              <div class="section-title">待處理事項</div>
              <div class="section-sub">${checks.length} 項 · 自動檢核</div>
              <div class="right"><div class="seg">
                ${[['all', '全部 ' + checks.length], ['error', '錯誤 ' + s.errors], ['warn', '警示 ' + s.warns], ['info', '提示 ' + s.infos]].map(([v, l]) =>
                  html`<button class=${lv === v ? 'on' : ''} onClick=${() => setLv(v)}>${l}</button>`)}
              </div></div>
            </div>
            ${shown.length ? html`<div class="checks">
              ${shown.map((c, i) => html`<div class="check-row" key=${i} onClick=${() => c.item_id && go('p/' + p.id + '/bom/' + c.item_id)} title=${c.item_id ? '點擊開啟此 Item' : ''}>
                <span class=${'lvl ' + c.level}>${c.level === 'error' ? '✕' : c.level === 'warn' ? '!' : 'i'}</span>
                <span class="msg">${c.msg}</span>
                ${c.item_id ? html`<${Icon} name="chevR" size=${14} class="muted" />` : null}
              </div>`)}
            </div>` : html`<div class="empty"><h3>${checks.length ? '此分類沒有項目' : '沒有待處理事項'}</h3><p>檢核涵蓋：編號重複、料號衝突、壓縮率、單一來源、位置圖片數、材料 AVL / EOL、拆機驗證、溫升估算等。</p></div>`}
          </div>
        </div>
      </div>
    </div>`;
  }

  TIM.ui.Overview = Overview;
})();
