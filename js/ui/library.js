/* 材料庫: shared TIM materials with datasheet properties and files (規格書), AVL status and where-used. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, useEffect, useRef, Icon, cx, go, usePref, TextField, NumField, SelectField, Field, YesNo, confirm, toast } = TIM.ui;
  const { util, schema, calc } = TIM;
  const A = () => TIM.actions;

  const AVL_CLS = { approved: 'tag-ok', qualifying: 'tag-warn', not_approved: 'tag-warn', eol: 'tag-err' };

  function MaterialDrawer(props) {
    const st = TIM.store;
    const db = st.db;
    const ro = st.readonly;
    const m = db.materials[props.id];
    const bodyRef = useRef(null);
    useEffect(() => {
      const on = e => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .menu, .popover')) { const a = document.activeElement; if (a && bodyRef.current && bodyRef.current.contains(a) && a.blur) a.blur(); props.onClose(); } };
      window.addEventListener('keydown', on);
      return () => window.removeEventListener('keydown', on);
    }, [props.onClose]);
    if (!m) return html`<aside class="drawer"><div class="drawer-head"><h2>找不到材料</h2><div class="right"><button class="icon-btn" onClick=${props.onClose}><${Icon} name="x" /></button></div></div></aside>`;
    const u = (f, v) => A().updateMaterial(m.id, f, v);
    const wu = calc.whereUsed(db, m.id);
    const primary = wu.filter(w => w.role === 'primary');
    const del = async () => {
      const ok = await confirm({ title: '刪除材料', danger: true, okText: '刪除材料',
        message: '刪除「' + m.vendor + ' ' + m.model + '」？' + (primary.length ? '\n有 ' + primary.length + ' 個 Item 連結此材料，刪除後會解除連結並保留 Vendor / Model 文字（不會遺失）。' : '') +
          ((m.datasheets || []).length ? '\n它的 ' + m.datasheets.length + ' 份規格書也會一起刪除。' : '') });
      if (!ok) return;
      A().deleteMaterial(m.id);
      props.onClose();
    };
    const sec = (id, title, children, sub) => html`<section class="dsec" id=${id}><div class="dsec-head"><h3>${title}</h3>${sub ? html`<span class="muted" style="font-size:11.5px">${sub}</span>` : null}</div>${children}</section>`;
    return html`<aside class="drawer" role="dialog" aria-label=${m.vendor + ' ' + m.model}>
      <div class="drawer-head">
        <h2>${m.vendor} <span style="font-weight:500">${m.model}</span></h2>
        <span class=${'tag ' + (AVL_CLS[m.avl_status] || 'tag-mute')}>${schema.labelOf(schema.AVL_STATUS, m.avl_status)}</span>
        <div class="right">
          <button class="icon-btn rw-only" title="複製材料" onClick=${() => { const id = A().duplicateMaterial(m.id); if (id) go('library/' + id); }}><${Icon} name="copy" /></button>
          <button class="icon-btn danger rw-only" title="刪除材料" onClick=${del}><${Icon} name="trash" /></button>
          <button class="icon-btn" title="關閉 (Esc)" onClick=${props.onClose}><${Icon} name="x" /></button>
        </div>
      </div>
      <div class="drawer-body" ref=${bodyRef}>
        ${sec('m-basic', '基本', html`<div class="form-grid">
          <${Field} label="Vendor"><${TextField} value=${m.vendor} disabled=${ro} onChange=${v => u('vendor', v)} /></${Field}>
          <${Field} label="Model"><${TextField} value=${m.model} disabled=${ro} onChange=${v => u('model', v)} /></${Field}>
          <${Field} label="型態"><${SelectField} value=${m.tim_type} allowEmpty=${false} disabled=${ro} options=${schema.TIM_TYPES.map(t => ({ v: t.v, label: t.label + '｜' + t.zh }))} onChange=${v => u('tim_type', v)} /></${Field}>
          <${Field} label="AVL 狀態" info="EOL 材料會在所有使用它的專案發出錯誤警示"><${SelectField} value=${m.avl_status} allowEmpty=${false} disabled=${ro} options=${schema.AVL_STATUS} onChange=${v => u('avl_status', v)} /></${Field}>
          <${Field} label="顏色（目視辨識）"><${TextField} value=${m.color} placeholder="Gray / Blue / Pink…" disabled=${ro} onChange=${v => u('color', v)} /></${Field}>
          <${Field} label="備註" class="span-all"><${TextField} multiline=${true} rows=${2} value=${m.note} disabled=${ro} onChange=${v => u('note', v)} /></${Field}>
        </div>`, '改名會同步到所有連結的 Item')}
        ${sec('m-th', '熱性能', html`<div class="form-grid">
          <${Field} label="熱傳導係數 k"><${NumField} value=${m.k} unit="W/m·K" disabled=${ro} onChange=${v => u('k', v)} /></${Field}>
          <${Field} label="k 量測標準" info="ASTM D5470 / Hot Disk / Laser Flash 的數值不能直接互相比較，務必一起記錄"><${SelectField} value=${m.k_method} disabled=${ro} options=${schema.K_METHODS} onChange=${v => u('k_method', v)} /></${Field}>
          <${Field} label="熱阻抗"><${NumField} value=${m.impedance} unit="°C·cm²/W" disabled=${ro} onChange=${v => u('impedance', v)} /></${Field}>
          <${Field} label="熱阻抗條件"><${TextField} value=${m.impedance_cond} placeholder="@10 psi, 1 mm" disabled=${ro} onChange=${v => u('impedance_cond', v)} /></${Field}>
          <${Field} label="可用厚度" class="span-2"><${TextField} value=${m.thickness_options} placeholder="0.5–5.0 mm（0.5 mm 一級）" disabled=${ro} onChange=${v => u('thickness_options', v)} /></${Field}>
        </div>`)}
        ${sec('m-mech', '機械 / 溫度', html`<div class="form-grid">
          <${Field} label="硬度"><${NumField} value=${m.hardness} disabled=${ro} onChange=${v => u('hardness', v)} /></${Field}>
          <${Field} label="硬度標準"><${SelectField} value=${m.hardness_scale} allowEmpty=${false} disabled=${ro} options=${schema.HARDNESS_SCALES} onChange=${v => u('hardness_scale', v)} /></${Field}>
          <${Field} label="密度"><${NumField} value=${m.density} unit="g/cm³" disabled=${ro} onChange=${v => u('density', v)} /></${Field}>
          <${Field} label="使用溫度 min"><${NumField} value=${m.temp_min} unit="°C" disabled=${ro} onChange=${v => u('temp_min', v)} /></${Field}>
          <${Field} label="使用溫度 max"><${NumField} value=${m.temp_max} unit="°C" disabled=${ro} onChange=${v => u('temp_max', v)} /></${Field}>
        </div>`)}
        ${sec('m-elec', '電氣 / RF', html`<div class="form-grid">
          <${Field} label="絕緣耐壓"><${NumField} value=${m.dielectric_kv_mm} unit="kV/mm" disabled=${ro} onChange=${v => u('dielectric_kv_mm', v)} /></${Field}>
          <${Field} label="體積電阻"><${TextField} value=${m.volume_resistivity} placeholder="1E13 Ω·cm" disabled=${ro} onChange=${v => u('volume_resistivity', v)} /></${Field}>
          <${Field} label="介電常數 Dk"><${NumField} value=${m.dk} disabled=${ro} onChange=${v => u('dk', v)} /></${Field}>
          <${Field} label="Dk 頻率"><${TextField} value=${m.dk_freq} placeholder="3.5 GHz" disabled=${ro} onChange=${v => u('dk_freq', v)} /></${Field}>
          <${Field} label="吸波頻段" info="吸波導熱材（如 CoolZorb 類）要對照產品頻段"><${TextField} value=${m.absorber_freq} placeholder="2–18 GHz" disabled=${ro} onChange=${v => u('absorber_freq', v)} /></${Field}>
        </div>`, '電源元件看絕緣、RF 元件看 Dk / 吸波頻段')}
        ${sec('m-rel', '可靠度 / 合規', html`<div class="form-grid">
          <${Field} label="矽系" info="矽油揮發可能污染光學元件、連接器接點"><${SelectField} value=${m.silicone} disabled=${ro} options=${schema.SILICONE} onChange=${v => u('silicone', v)} /></${Field}>
          <${Field} label="出油 / 揮發" class="span-2"><${TextField} value=${m.outgassing} placeholder="TML / CVCM、Oil bleed…" disabled=${ro} onChange=${v => u('outgassing', v)} /></${Field}>
          <${Field} label="UL94"><${SelectField} value=${m.ul94} disabled=${ro} options=${schema.UL94} onChange=${v => u('ul94', v)} /></${Field}>
          <${Field} label="RoHS"><${YesNo} value=${m.rohs} disabled=${ro} onChange=${v => u('rohs', v)} /></${Field}>
          <${Field} label="REACH"><${YesNo} value=${m.reach} disabled=${ro} onChange=${v => u('reach', v)} /></${Field}>
          <${Field} label="無鹵"><${YesNo} value=${m.halogen_free} disabled=${ro} onChange=${v => u('halogen_free', v)} /></${Field}>
          <${Field} label="保存期限"><${NumField} value=${m.shelf_life_months} unit="月" disabled=${ro} onChange=${v => u('shelf_life_months', v)} /></${Field}>
          <${Field} label="保存條件" class="span-2"><${TextField} value=${m.storage} placeholder="5–25 °C、避光、密封…" disabled=${ro} onChange=${v => u('storage', v)} /></${Field}>
        </div>`)}
        ${sec('m-doc', '文件與商務', html`<div class="form-grid">
          <${Field} label="規格書" class="span-all" info=${html`檢視 · 上傳 · 下載 · 刪除 · 清單。<br/>可一次選多個檔案（或直接拖進來），同檔名會取代原本那一份。${TIM.datasheets.whereText(m) ? html`<br/>存放：<span class="mono">${TIM.datasheets.whereText(m)}</span>` : null}`}>
            <${TIM.ui.DatasheetField} mat=${m} /></${Field}>
          ${m.datasheet_url ? html`<div class="span-all ds-legacy"><span class="muted">舊版 Datasheet 連結：</span>${/^https?:\/\//i.test(m.datasheet_url)
            ? html`<a href=${m.datasheet_url} target="_blank" rel="noopener noreferrer" class="mono">${m.datasheet_url}</a>` : html`<span class="mono">${m.datasheet_url}</span>`}
            ${!ro ? html` <button class="btn btn-ghost btn-xs" title="移除舊連結（規格書請改用上傳）" onClick=${() => u('datasheet_url', '')}>移除</button>` : null}</div>` : null}
          <${Field} label="參考價格"><${TextField} value=${m.price_ref} placeholder="USD 0.9 / 10 cm²" disabled=${ro} onChange=${v => u('price_ref', v)} /></${Field}>
          <${Field} label="MOQ"><${NumField} value=${m.moq} disabled=${ro} onChange=${v => u('moq', v)} /></${Field}>
          <${Field} label="交期"><${NumField} value=${m.lead_time_wk} unit="週" disabled=${ro} onChange=${v => u('lead_time_wk', v)} /></${Field}>
        </div>`)}
        ${sec('m-wu', 'Where-used（反查）', wu.length ? html`<table class="subtbl">
          <thead><tr><th>專案</th><th>Stage</th><th>Item</th><th>Location</th><th class="r">Q'ty</th><th>角色</th></tr></thead>
          <tbody>${wu.map(w => html`<tr class="clickable" style="cursor:pointer" onClick=${() => go('p/' + w.project_id + '/bom/' + w.item_id)}>
            <td>${w.project}</td><td><span class="tag tag-stage">${w.stage}</span></td><td class="mono"><b>${w.item_no}</b></td><td>${w.location}</td><td class="r mono">${w.qty == null ? '' : w.qty}</td>
            <td>${w.role === 'primary' ? '主料' : html`第二來源 <span class="muted">(${schema.labelOf(schema.SOURCE_STATUS, w.status)})</span>`}</td>
          </tr>`)}</tbody>
        </table>` : html`<div class="muted" style="font-size:12px">目前沒有專案使用此材料。</div>`, '廠商發 PCN / EOL / 漲價時，用這裡找出所有影響的專案')}
        <div class="muted mt12" style="font-size:11px">建立 ${util.fmtDateTime(m.created_at)} · 更新 ${util.fmtDateTime(m.updated_at)}</div>
      </div>
    </aside>`;
  }

  function Library(props) {
    const st = TIM.store;
    const db = st.db;
    const ro = st.readonly;
    const [q, setQ] = useState('');
    const [type, setType] = usePref('lib_type', '');
    const usage = useMemo(() => {
      const u = {};
      Object.values(db.projects).forEach(p => p.items.forEach(it => { if (it.material_id) u[it.material_id] = (u[it.material_id] || 0) + 1; }));
      return u;
    }, [st.version]);
    const qq = q.trim().toUpperCase();
    const mats = Object.values(db.materials)
      .filter(m => (!type || m.tim_type === type) &&
        (!qq || [m.vendor, m.model, m.note, m.k_method, schema.timType(m.tim_type).label].some(v => String(v || '').toUpperCase().includes(qq))))
      .sort((a, b) => (a.vendor + ' ' + a.model).localeCompare(b.vendor + ' ' + b.model));
    const add = () => {
      const id = A().createMaterial({ vendor: '', model: '新材料' });
      go('library/' + id);
    };
    const range = (a, b, unit) => (a == null && b == null ? '' : (a == null ? '?' : a) + ' ~ ' + (b == null ? '?' : b) + (unit || ''));

    return html`<div class="page"><div class="page-inner">
      <div class="home-head">
        <div><div class="eyebrow">Material Library · ${Object.keys(db.materials).length}</div><h1>材料庫</h1></div>
        <div class="home-actions"><button class="btn btn-primary rw-only" onClick=${add}><${Icon} name="plus" /> 新增材料</button></div>
      </div>
      <p class="muted" style="margin:-8px 0 14px;max-width:760px;line-height:1.6">跨專案共用的 TIM 材料資料。Item 連結材料後，Vendor / Model / 型態 / k 值都從這裡帶入（單一事實來源），改這裡就同步所有專案。</p>
      <div class="lib-filters">
        <div class="searchbox" style="width:280px"><${Icon} name="search" /><input class="inp" placeholder="搜尋廠商、型號…" value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <select class="sel" style="width:170px" value=${type} onChange=${e => setType(e.target.value)}><option value="">全部型態</option>${schema.TIM_TYPES.map(t => html`<option value=${t.v}>${t.label}</option>`)}</select>
      </div>
      ${mats.length ? html`<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>型態</th><th>Vendor</th><th>Model</th><th class="r">k W/m·K</th><th>量測</th><th class="r">硬度</th><th>使用溫度 °C</th><th>矽系</th><th class="c">規格書</th><th class="r">使用中</th></tr></thead>
        <tbody>${mats.map(m => html`<tr key=${m.id} class=${cx('clickable', props.route.mat === m.id && 'sel')} onClick=${() => go('library/' + m.id)}>
          <td>${schema.timType(m.tim_type).label}</td><td>${m.vendor || html`<span class="muted">—</span>`}</td><td><b>${m.model}</b></td>
          <td class="r mono">${util.fmt(m.k, 2)}</td><td class="muted" style="font-size:11.5px">${m.k_method ? m.k_method.split(' ')[0] + ' ' + (m.k_method.split(' ')[1] || '') : ''}</td>
          <td class="r mono" style="white-space:nowrap">${m.hardness == null ? '' : m.hardness + ' ' + (m.hardness_scale || '')}</td>
          <td class="mono">${range(m.temp_min, m.temp_max)}</td>
          <td>${schema.labelOf(schema.SILICONE, m.silicone)}</td>
          <td class="c"><${TIM.ui.DatasheetEye} mat=${m} /></td>
          <td class="r mono">${usage[m.id] || ''}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<div class="empty">
        <h3>${Object.keys(db.materials).length ? '沒有符合的材料' : '材料庫是空的'}</h3>
        <p>新增材料並填入 datasheet 數值（k 值與量測標準、硬度、使用溫度…），並上傳規格書。匯入 Excel 時也可以自動把清單中的 Vendor / Model 建成材料。</p>
        <div class="actions rw-only"><button class="btn btn-primary" onClick=${add}><${Icon} name="plus" /> 新增材料</button></div>
      </div>`}
      ${props.route.mat ? html`<${MaterialDrawer} id=${props.route.mat} onClose=${() => go('library')} />` : null}
    </div></div>`;
  }

  TIM.ui.Library = Library;
})();
