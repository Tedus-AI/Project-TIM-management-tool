/* Item detail drawer: every field of one TIM item, with calculations and its own history. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, useEffect, useRef, useLayoutEffect, Icon, cx, go, Modal, openModal, confirm, toast, TextField, NumField, SelectField, Field, Locked, ColorField, InfoDot, pickFile } = TIM.ui;
  const { util, schema, parse, calc } = TIM;
  const A = () => TIM.actions;

  // ───────── material picker ─────────
  function MaterialPicker(props) {
    const [q, setQ] = useState('');
    const mats = Object.values(TIM.store.db.materials)
      .filter(m => !q || (m.vendor + ' ' + m.model + ' ' + schema.timType(m.tim_type).label).toUpperCase().includes(q.trim().toUpperCase()))
      .sort((a, b) => (a.vendor + a.model).localeCompare(b.vendor + b.model));
    return html`<${Modal} title="從材料庫選擇" size="mid" onClose=${() => props.close(null)}
      footer=${html`<span class="left">連結後 Vendor / Model / 型態 / k 值由材料庫帶入（單一事實來源）</span><button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>`}>
      <input class="inp" autofocus placeholder="搜尋廠商、型號、型態…" value=${q} onInput=${e => setQ(e.target.value)} />
      <div class="tbl-wrap" style="margin-top:10px;max-height:420px">
        <table class="tbl"><thead><tr><th>型態</th><th>Vendor</th><th>Model</th><th class="r">k</th><th>AVL</th></tr></thead>
        <tbody>${mats.map(m => html`<tr class="clickable" onClick=${() => props.close(m.id)}>
          <td>${schema.timType(m.tim_type).label}</td><td>${m.vendor}</td><td><b>${m.model}</b></td><td class="r mono">${util.fmt(m.k, 2)}</td>
          <td><span class=${cx('tag', m.avl_status === 'approved' ? 'tag-ok' : m.avl_status === 'eol' ? 'tag-err' : 'tag-warn')}>${schema.labelOf(schema.AVL_STATUS, m.avl_status)}</span></td>
        </tr>`)}</tbody></table>
        ${!mats.length ? html`<div class="empty" style="border:none"><p>沒有符合的材料。可先在下方欄位手動輸入 Vendor / Model，再按「加入材料庫」。</p></div>` : null}
      </div>
    </${Modal}>`;
  }
  async function pickMaterial(pid, itemId) {
    const id = await openModal(close => html`<${MaterialPicker} close=${close} />`).promise;
    if (id) A().linkMaterial(pid, itemId, id);
  }

  // ───────── sections ─────────
  function Sec(props) {
    return html`<section class="dsec" id=${props.id}>
      <div class="dsec-head"><h3>${props.title}</h3>${props.sub ? html`<span class="muted" style="font-size:11.5px">${props.sub}</span>` : null}${props.right ? html`<div class="right">${props.right}</div>` : null}</div>
      ${props.children}
    </section>`;
  }

  function RangeBar(props) {
    const cc = props.cc;
    if (cc.status === 'na') return null;
    const lo = 0, hi = Math.max(60, Math.ceil(((cc.max || 0) + 5) / 10) * 10);
    const pct = v => util.clamp((v - lo) / (hi - lo) * 100, 0, 100);
    return html`<div style="margin-top:10px">
      <div class="rangebar">
        ${cc.rec && cc.rec.min != null && cc.rec.max != null ? html`<div class="rec" style=${{ left: pct(cc.rec.min) + '%', width: (pct(cc.rec.max) - pct(cc.rec.min)) + '%' }} title=${'建議 ' + cc.rec.min + '~' + cc.rec.max + '%'}></div>` : null}
        ${cc.min != null && cc.max != null ? html`<div class=${cx('span', cc.status)} style=${{ left: pct(Math.max(lo, cc.min)) + '%', width: Math.max(0.6, pct(cc.max) - pct(Math.max(lo, cc.min))) + '%' }}></div>` : null}
        ${cc.nom != null ? html`<div class="nom" style=${{ left: pct(cc.nom) + '%' }} title=${'nom ' + util.fmt(cc.nom, 1) + '%'}></div>` : null}
      </div>
      <div class="rangebar-axis"><span>0%</span><span>${hi / 2}%</span><span>${hi}%</span></div>
    </div>`;
  }

  function ItemDrawer(props) {
    const st = TIM.store;
    const db = st.db;
    const p = props.p;
    const ro = st.readonly;
    const it = p.items.find(x => x.id === props.itemId);
    const bodyRef = useRef(null);
    // registered once, latest onClose through a ref (see CLAUDE.md rule 3)
    const live = useRef(props);
    live.current = props;
    useLayoutEffect(() => {
      const on = e => {
        if (e.key !== 'Escape' || document.querySelector('.modal-backdrop, .menu, .popover')) return;
        const a = document.activeElement;
        if (a && a.closest && a.closest('.grid-scroll')) return;          // Esc in the grid reverts the cell instead
        if (a && bodyRef.current && bodyRef.current.contains(a) && a.blur) a.blur();   // commit, then close
        live.current.onClose();
      };
      window.addEventListener('keydown', on);
      return () => window.removeEventListener('keydown', on);
    }, []);
    if (!it) return html`<aside class="drawer"><div class="drawer-head"><h2>找不到 Item</h2><div class="right"><button class="icon-btn" onClick=${props.onClose}><${Icon} name="x" /></button></div></div></aside>`;

    const mat = calc.materialOf(db, it);
    const eff = calc.effective(it, mat);
    const cc = calc.compressionCheck(it, mat, db.settings);
    const th = calc.thermalEstimate(it, mat);
    const risk = calc.sourceRisk(it);
    const placedN = calc.placedCount(p, it.id);
    const hasViews = p.views.some(v => v.shapes.length);
    const dispense = schema.isDispense(eff.tim_type);
    const ordered = calc.orderedItems(p);
    const idx = ordered.findIndex(x => x.id === it.id);
    const u = (path, v) => A().updateItem(p.id, it.id, path, v);
    const loc = calc.locationOf(p, it);
    const sug = !mat && (it.vendor || it.model) ? A().findMaterial(it.vendor, it.model) : null;
    const history = (p.changelog || []).filter(c => c.target_id && String(c.target_id).startsWith(it.id)).slice(-30).reverse();
    const covQty = calc.coveredQty(it);
    const totalPower = util.sum(it.covered, c => { const pt = calc.timPower(c); return pt === null ? NaN : pt * (Number.isFinite(c.qty) ? c.qty : 1); });
    const recSrcLabel = cc.rec ? { item: '手動', generic: '一般建議值' }[cc.rec.source] : '';

    const addToLibrary = () => {
      if (!it.vendor && !it.model) { toast('請先輸入 Vendor / Model', 'warn'); return; }
      const mid = A().createMaterial({ vendor: it.vendor, model: it.model, tim_type: it.tim_type });
      A().linkMaterial(p.id, it.id, mid);
      toast('已加入材料庫並連結，記得到材料庫補 k 值並上傳規格書', 'ok');
    };
    const del = async () => {
      const ok = await confirm({ title: '刪除 Item', danger: true, okText: '刪除', message: '刪除 ' + (it.item_no || '(未編號)') + '？' + (placedN ? '\n位置圖上的 ' + placedN + ' 片 pad 與標籤也會移除。' : '') + '\n可用 Ctrl+Z 復原。' });
      if (!ok) return;
      A().deleteItems(p.id, [it.id]);
      props.onClose();
    };
    const setPhoto = async (file) => {
      if (!file) return;
      try {
        const rec = await TIM.image.fromBlob(file, file.name);
        let id;
        st.mutateProject(p.id, pp => { id = st.addImage(rec); pp.items.find(x => x.id === it.id).validation.image_id = id; },
          { changes: [{ kind: 'edit', target: 'item', target_id: it.id, item_no: it.item_no, field: '驗證照片', from: it.validation.image_id ? '（舊照片）' : '', to: file.name || '（照片）' }] });
      } catch (e) { toast('圖片讀取失敗：' + e.message, 'err'); }
    };
    const photo = it.validation.image_id && db.images[it.validation.image_id];

    return html`<aside class="drawer" role="dialog" aria-label=${'Item ' + it.item_no}>
      <div class="drawer-head">
        <span class="swatch" style=${{ background: calc.itemColor(p, it), width: '14px', height: '14px' }}></span>
        <h2 class="mono">${it.item_no || '(未編號)'}</h2>
        <span class="tag tag-mute">${loc ? loc.name : ''}</span>
        <span class=${cx('tag', it.status === 'released' ? 'tag-ok' : it.status === 'obsolete' ? 'tag-mute' : 'tag-info')}>${schema.labelOf(schema.ITEM_STATUS, it.status)}</span>
        ${risk === 'single' ? html`<span class="tag tag-single">單一來源</span>` : risk === 'unverified' ? html`<span class="tag tag-warn">2nd 未承認</span>` : html`<span class="tag tag-ok">2nd ✓</span>`}
        <div class="right">
          <button class="icon-btn" title="上一個 Item" disabled=${idx <= 0} onClick=${() => go('p/' + p.id + '/bom/' + ordered[idx - 1].id)}><${Icon} name="chevU" /></button>
          <button class="icon-btn" title="下一個 Item" disabled=${idx >= ordered.length - 1} onClick=${() => go('p/' + p.id + '/bom/' + ordered[idx + 1].id)}><${Icon} name="chevD" /></button>
          <button class="icon-btn rw-only" title="複製此 Item" onClick=${() => { const id = A().duplicateItem(p.id, it.id); if (id) go('p/' + p.id + '/bom/' + id); }}><${Icon} name="copy" /></button>
          <button class="icon-btn danger rw-only" title="刪除此 Item" onClick=${del}><${Icon} name="trash" /></button>
          <button class="icon-btn" title="關閉 (Esc)" onClick=${props.onClose}><${Icon} name="x" /></button>
        </div>
      </div>
      <nav class="drawer-nav">
        ${[['d-basic', '基本'], ['d-size', '尺寸數量'], ['d-cov', '覆蓋元件'], ['d-gap', '間隙壓縮'], ['d-th', '熱估算'], ['d-src', '第二來源'], ['d-cost', '成本供應'], ['d-val', '驗證'], ['d-note', '備註'], ['d-hist', '歷史']].map(([id, l]) =>
          html`<a href="javascript:void 0" onClick=${() => { const el = bodyRef.current && bodyRef.current.querySelector('#' + id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>${l}</a>`)}
      </nav>
      <div class="drawer-body" ref=${bodyRef}>

        <${Sec} id="d-basic" title="基本資訊">
          <div class="form-grid">
            <${Field} label="Item"><${TextField} mono=${true} value=${it.item_no} disabled=${ro} onChange=${v => u('item_no', v)} /></${Field}>
            <${Field} label="Location"><${SelectField} value=${it.location_id} allowEmpty=${false} disabled=${ro} options=${p.locations.map(l => ({ v: l.id, label: l.name }))} onChange=${v => A().moveItem(p.id, it.id, v)} /></${Field}>
            <${Field} label="狀態"><${SelectField} value=${it.status} allowEmpty=${false} disabled=${ro} options=${schema.ITEM_STATUS} onChange=${v => u('status', v)} /></${Field}>
            <${Field} label="Used On" class="span-2">
              <div class="row wrap" style="gap:4px;min-height:30px">
                ${schema.CATEGORIES.map(c => {
                  const on = it.used_on.includes(c.v);
                  return html`<button type="button" class="tag" disabled=${ro} style=${{ cursor: 'pointer', background: on ? c.color : 'var(--surface-2)', color: on ? '#fff' : 'var(--ink-3)', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--line)' }}
                    onClick=${() => u('used_on', on ? it.used_on.filter(x => x !== c.v) : it.used_on.concat(c.v))}>${c.label}</button>`;
                })}
                ${it.used_on.filter(x => !schema.CATEGORIES.some(c => c.v === x)).map(x => html`<span class="tag tag-mute">${x}</span>`)}
              </div>
            </${Field}>
            <${Field} label="位置圖顏色" class="span-all"><${ColorField} value=${it.color} allowAuto=${true} disabled=${ro} onChange=${c => u('color', c)} /></${Field}>
          </div>
          <div class="divider"></div>
          ${mat ? html`<div class="form-grid">
              <${Field} label="材料（連結材料庫）" class="span-2">
                <${Locked} display=${html`<b>${mat.vendor}</b> ${mat.model}`} source="材料庫" onUnlock=${ro ? null : () => A().unlinkMaterial(p.id, it.id)} />
              </${Field}>
              <${Field} label="型態"><div class="ref-value">${schema.timType(mat.tim_type).label}</div></${Field}>
              <${Field} label="k"><div class="ref-value mono">${mat.k == null ? '—' : util.fmt(mat.k, 2) + ' W/m·K'} <span class="src">${mat.k_method || ''}</span></div></${Field}>
            </div>
            <div class="row mt8" style="gap:8px">
              <button class="btn btn-ghost btn-sm" onClick=${() => go('library/' + mat.id)}><${Icon} name="book" /> 開啟材料資料</button>
              <button class="btn btn-ghost btn-sm rw-only" onClick=${() => pickMaterial(p.id, it.id)}>改連結其他材料…</button>
            </div>` : html`<div class="form-grid">
              <${Field} label="Vendor"><${TextField} value=${it.vendor} list="dl-vendors" disabled=${ro} onChange=${v => u('vendor', v)} /></${Field}>
              <${Field} label="Model"><${TextField} value=${it.model} list="dl-models" disabled=${ro} onChange=${v => u('model', v)} /></${Field}>
              <${Field} label="型態"><${SelectField} value=${it.tim_type} allowEmpty=${false} disabled=${ro} options=${schema.TIM_TYPES.map(t => ({ v: t.v, label: t.label + '｜' + t.zh }))} onChange=${v => u('tim_type', v)} /></${Field}>
            </div>
            <div class="row mt8 wrap rw-only" style="gap:8px">
              ${sug ? html`<button class="btn btn-secondary btn-sm" onClick=${() => A().linkMaterial(p.id, it.id, sug.id)}><${Icon} name="link" /> 連結材料庫的「${sug.vendor} ${sug.model}」</button>` : null}
              <button class="btn btn-ghost btn-sm" onClick=${() => pickMaterial(p.id, it.id)}><${Icon} name="book" /> 從材料庫選擇…</button>
              ${!sug ? html`<button class="btn btn-ghost btn-sm" onClick=${addToLibrary}><${Icon} name="plus" /> 加入材料庫並連結</button>` : null}
              <span class="muted" style="font-size:11.5px">未連結材料庫時無法自動帶入 k 值與建議壓縮率</span>
            </div>`}
          <div class="divider"></div>
          <div class="form-grid">
            <${Field} label="Delta P/N"><${TextField} mono=${true} value=${it.delta_pn} disabled=${ro} onChange=${v => u('delta_pn', v)} /></${Field}>
            <${Field} label="Vendor P/N（MPN）"><${TextField} mono=${true} value=${it.vendor_pn} disabled=${ro} onChange=${v => u('vendor_pn', v)} /></${Field}>
            <${Field} label="裁切加工廠" info="實際交貨的裁切 / 加工廠（不一定是材料原廠），品質問題要追到這一層"><${TextField} value=${it.fabricator} disabled=${ro} onChange=${v => u('fabricator', v)} /></${Field}>
            <${Field} label="裁切圖號 / 版次"><${TextField} mono=${true} value=${it.drawing_no} disabled=${ro} onChange=${v => u('drawing_no', v)} /></${Field}>
          </div>
        </${Sec}>

        <${Sec} id="d-size" title="尺寸與數量" sub=${dispense ? '點膠類：記錄點膠量與 BLT' : '片狀：L 沿 pad 長邊，位置圖以此蓋出實際尺寸'}>
          <div class="form-grid">
            ${dispense ? html`
              <${Field} label="點膠量"><${NumField} value=${it.dispense.amount} disabled=${ro} onChange=${v => u('dispense.amount', v)} /></${Field}>
              <${Field} label="單位"><${SelectField} value=${it.dispense.unit} allowEmpty=${false} disabled=${ro} options=${['g', 'cc']} onChange=${v => u('dispense.unit', v)} /></${Field}>
              <${Field} label="BLT（膠層厚度）"><${NumField} value=${it.dispense.blt} unit="mm" disabled=${ro} onChange=${v => u('dispense.blt', v)} /></${Field}>
            ` : html`
              <${Field} label="L"><${NumField} value=${it.size.l} unit="mm" disabled=${ro} onChange=${v => u('size.l', v)} /></${Field}>
              <${Field} label="W"><${NumField} value=${it.size.w} unit="mm" disabled=${ro} onChange=${v => u('size.w', v)} /></${Field}>
              <${Field} label="T（未壓縮厚度）"><${NumField} value=${it.size.t} unit="mm" disabled=${ro} onChange=${v => u('size.t', v)} /></${Field}>
              <${Field} label="面積"><div class="ref-value mono">${th.area == null ? '—' : util.fmt(th.area, 2) + ' mm²'}</div></${Field}>
            `}
            <${Field} label="Q'ty（每台）"><${NumField} value=${it.qty} unit="pcs" disabled=${ro} onChange=${v => u('qty', v)} /></${Field}>
            <${Field} label="位置圖放置">
              <div class="ref-value">${hasViews ? html`<span class=${cx('mono', placedN === it.qty ? 'text-ok' : 'text-warn')}>${placedN} 片</span>
                ${placedN !== it.qty && placedN > 0 && !ro ? html`<button class="btn btn-secondary btn-xs" onClick=${() => u('qty', placedN)} title="以位置圖放置數為 Q'ty">套用 ${placedN}</button>` : null}`
                : html`<span class="muted">尚無位置圖</span>`}</div>
            </${Field}>
            ${!dispense ? html`<${Field} label="外形備註" class="span-2"><${TextField} value=${it.shape_note} placeholder="非矩形、開孔、讓位、拉耳…" disabled=${ro} onChange=${v => u('shape_note', v)} /></${Field}>` : null}
          </div>
        </${Sec}>

        <${Sec} id="d-cov" title="覆蓋元件" sub=${it.covered.length ? '共 ' + covQty + ' 顆 · 經 TIM 總熱量 ' + (Number.isFinite(totalPower) && totalPower ? util.fmt(totalPower, 2) + ' W' : '—') : '取代 Excel 的 Note 欄'}
          right=${html`<button class="btn btn-ghost btn-sm rw-only" onClick=${() => A().addCovered(p.id, it.id, { cat: it.used_on[0] || '' })}><${Icon} name="plus" /> 新增元件</button>`}>
          ${it.covered.length ? html`<table class="subtbl">
            <thead><tr><th style="width:19%">元件料號</th><th style="width:16%">RefDes</th><th style="width:7%">數量</th><th style="width:10%">類別</th><th style="width:10%">功耗 W/顆</th>
              <th style="width:9%" title="經由頂面 TIM 散出的比例；空白 = 100%">頂面 % <${InfoDot}><div style="max-width:300px;line-height:1.6">元件功耗經由頂面 TIM 散出的比例。<br/>底部散熱為主的封裝（QFN / PA 走 PCB、copper coin）只有一小部分走頂面；有 lid 的 BGA 大部分走頂面。<br/>可由模擬（FloTHERM 熱流分配）或 θ<sub>JC-top</sub> / θ<sub>JB</sub> 估算。空白 = 100%。</div></${InfoDot}></th>
              <th style="width:8%">封裝 L</th><th style="width:8%">封裝 W</th><th>備註</th><th></th></tr></thead>
            <tbody>${it.covered.map(c => html`<tr key=${c.id}>
              <td><${TextField} class="inp mono" value=${c.part} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'part', v)} /></td>
              <td><${TextField} class="inp mono" value=${c.refdes} placeholder="U101,U102" disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'refdes', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.qty} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'qty', v)} /></td>
              <td><${SelectField} class="sel" value=${c.cat} disabled=${ro} options=${schema.CATEGORIES} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'cat', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.power_w} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'power_w', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.top_pct} placeholder="100" disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'top_pct', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.pkg_l} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'pkg_l', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.pkg_w} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'pkg_w', v)} /></td>
              <td><${TextField} class="inp" value=${c.note} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'note', v)} /></td>
              <td><button class="icon-btn danger rw-only" title="移除" onClick=${() => A().removeCovered(p.id, it.id, c.id)}><${Icon} name="x" /></button></td>
            </tr>`)}</tbody>
            <tfoot><tr><td colspan="10">
              ${it.qty != null && covQty !== it.qty ? html`<span class="text-warn">覆蓋元件 ${covQty} 顆 ≠ Q'ty ${it.qty} 片（一片 pad 對一顆元件時兩者應相等）</span>` : html`<span>封裝尺寸 → 有效接觸面積 = min(pad 面積, 元件頂面)；功耗 × 頂面 % → 經 TIM 的熱量，用於溫升估算</span>`}
            </td></tr></tfoot>
          </table>` : html`<div class="muted" style="font-size:12px">尚未記錄。可在 TIM 清單的 Note 欄直接輸入 <span class="mono">LDO-A*2, BUCK-B*4</span>，或在此新增並補上 RefDes 與功耗。</div>`}
        </${Sec}>

        <${Sec} id="d-gap" title="機構間隙與壓縮" sub="間隙請用公差疊加後的範圍（元件高度、PCB 翹曲、機殼加工）"
          right=${html`<${InfoDot}><div class="formula">壓縮率 C = (T − g) / T × 100%<br/>C<sub>min</sub> 用 g<sub>max</sub>；C<sub>max</sub> 用 g<sub>min</sub><br/>g ≥ T → 可能未接觸（錯誤）<br/>建議範圍：Item 手動 → 一般建議值（依 TIM 類型）</div></${InfoDot}>`}>
          ${dispense ? html`<div class="muted" style="font-size:12px">點膠類材料不檢核壓縮率；請記錄 BLT 與設計間隙供熱估算。</div>` : null}
          <div class="form-grid">
            <${Field} label="T"><div class="ref-value mono">${it.size.t == null ? '—' : util.fmt(it.size.t) + ' mm'}</div></${Field}>
            <${Field} label="間隙 min"><${NumField} value=${it.gap.min} unit="mm" disabled=${ro} onChange=${v => u('gap.min', v)} /></${Field}>
            <${Field} label="間隙 nom"><${NumField} value=${it.gap.nom} unit="mm" disabled=${ro} onChange=${v => u('gap.nom', v)} /></${Field}>
            <${Field} label="間隙 max"><${NumField} value=${it.gap.max} unit="mm" disabled=${ro} onChange=${v => u('gap.max', v)} /></${Field}>
            <${Field} label="建議壓縮率" class="span-2">
              <${Locked} unlocked=${!!it.comp_override} source=${recSrcLabel}
                display=${cc.rec ? html`<span class="mono">${cc.rec.min ?? '—'} ~ ${cc.rec.max ?? '—'} %</span>` : html`<span class="muted">無建議範圍（可解鎖手動輸入）</span>`}
                onUnlock=${ro ? null : () => u('comp_override', { min: cc.rec ? cc.rec.min : 10, max: cc.rec ? cc.rec.max : 30 })}
                onRelock=${ro ? null : () => u('comp_override', null)}>
                <div class="triple" style="grid-template-columns:1fr 1fr">
                  <${NumField} value=${it.comp_override ? it.comp_override.min : null} unit="% min" disabled=${ro} onChange=${v => u('comp_override', Object.assign({}, it.comp_override, { min: v }))} />
                  <${NumField} value=${it.comp_override ? it.comp_override.max : null} unit="% max" disabled=${ro} onChange=${v => u('comp_override', Object.assign({}, it.comp_override, { max: v }))} />
                </div>
              </${Locked}>
            </${Field}>
          </div>
          ${cc.status !== 'na' ? html`<div class="calc-box mt12">
              <div><div class="k">壓縮率 min</div><div class="v">${util.fmt(cc.min, 1)}%</div></div>
              <div><div class="k">壓縮率 nom</div><div class="v">${cc.nom == null ? '—' : util.fmt(cc.nom, 1) + '%'}</div></div>
              <div><div class="k">壓縮率 max</div><div class="v">${util.fmt(cc.max, 1)}%</div></div>
              <div><div class="k">判定</div><div class="v"><span class=${cx('tag', cc.status === 'ok' ? 'tag-ok' : cc.status === 'warn' ? 'tag-warn' : 'tag-err')}>${{ ok: 'OK', warn: 'Warning', error: 'Error' }[cc.status]}</span></div></div>
            </div>
            <${RangeBar} cc=${cc} />
            ${cc.msgs.length ? html`<ul style="margin:8px 0 0 18px;font-size:12px" class=${cc.status === 'error' ? 'text-err' : 'text-warn'}>${cc.msgs.map(m => html`<li>${m}</li>`)}</ul>` : null}`
            : !dispense ? html`<div class="muted mt8" style="font-size:12px">填入 T 與間隙後自動計算。</div>` : null}
        </${Sec}>

        <${Sec} id="d-th" title="TIM 熱阻估算"
          right=${html`<${InfoDot}><div class="formula">R<sub>TIM</sub> = t<sub>c</sub> / (k · A<sub>eff</sub>)　→　R[°C/W] = t<sub>c</sub>[mm] × 1000 / (k × A[mm²])<br/>ΔT = P<sub>TIM</sub> × R，P<sub>TIM</sub> = 單顆功耗 × 頂面 %<br/>t<sub>c</sub> = min(間隙 nom, T)；無間隙資料時用 T（保守）<br/>A<sub>eff</sub> = min(pad 面積, 元件頂面)<br/>僅 bulk k 估算，不含兩側接觸熱阻與擴散熱阻。<br/>實際以供應商熱阻抗曲線或實測為準。</div></${InfoDot}>`}>
          <div class="calc-box">
            <div><div class="k">k ${mat ? '（材料庫）' : ''}</div><div class="v">${th.k == null ? '—' : util.fmt(th.k, 2)}</div></div>
            <div><div class="k">t_c ${th.t_src ? '（' + { gap: '間隙', thickness: '未壓縮 T', blt: 'BLT' }[th.t_src] + '）' : ''}</div><div class="v">${th.t_c == null ? '—' : util.fmt(th.t_c, 3) + ' mm'}</div></div>
            <div><div class="k">pad 面積</div><div class="v">${th.area == null ? '—' : util.fmt(th.area, 1) + ' mm²'}</div></div>
            <div><div class="k">R_TIM（整片）</div><div class="v">${th.R_pad == null ? '—' : util.fmt(th.R_pad, 3) + ' °C/W'}</div></div>
          </div>
          ${!th.contact ? html`<div class="text-err mt8" style="font-size:12px">間隙 nom ≥ T：TIM 可能未接觸，實際是空氣間隙，以下估算不成立。</div>` : null}
          ${th.rows.length ? html`<table class="subtbl mt12">
            <thead><tr><th>元件</th><th class="r">功耗 W/顆</th><th class="r">頂面 %</th><th class="r">P_TIM W</th><th class="r">A_eff mm²</th><th class="r">R °C/W</th><th class="r">ΔT °C</th></tr></thead>
            <tbody>${th.rows.map(r => html`<tr><td class="mono">${r.part}${r.refdes ? html` <span class="muted">${r.refdes}</span>` : null}</td>
              <td class="r mono">${r.power_total == null ? '—' : util.fmt(r.power_total, 2)}</td>
              <td class="r mono">${r.top_pct == null ? html`<span class="muted">100</span>` : util.fmt(r.top_pct, 1)}</td>
              <td class="r mono">${r.power == null ? '—' : util.fmt(r.power, 3)}</td><td class="r mono">${r.area == null ? '—' : util.fmt(r.area, 1)}</td>
              <td class="r mono">${r.R == null ? '—' : util.fmt(r.R, 3)}</td>
              <td class=${cx('r mono', r.dT != null && r.dT >= (db.settings.dt_warn || 10) && 'text-warn')}><b>${r.dT == null ? '—' : util.fmt(r.dT, 2)}</b></td></tr>`)}</tbody>
          </table>` : html`<div class="muted mt8" style="font-size:12px">在「覆蓋元件」填入功耗即可估算每顆元件經過 TIM 的溫升。</div>`}
          ${th.k == null ? html`<div class="muted mt8" style="font-size:12px">${mat ? '材料庫未填 k 值。' : '連結材料庫後才能取得 k 值。'}</div>` : null}
        </${Sec}>

        <${Sec} id="d-src" title="第二來源" sub=${{ single: '目前為單一來源', unverified: '有第二來源但尚未承認', ok: '已有承認的第二來源' }[risk]}
          right=${html`<button class="btn btn-ghost btn-sm rw-only" onClick=${() => A().addSource(p.id, it.id, {})}><${Icon} name="plus" /> 新增第二來源</button>`}>
          ${it.sources.length ? html`<table class="subtbl">
            <thead><tr><th style="width:17%">Vendor</th><th style="width:17%">Model</th><th style="width:15%">MPN</th><th style="width:14%">Delta P/N</th><th style="width:12%">狀態</th><th>備註</th><th></th></tr></thead>
            <tbody>${it.sources.map(s => html`<tr key=${s.id}>
              <td><${TextField} class="inp" value=${s.vendor} list="dl-vendors" disabled=${ro} onChange=${v => A().updateSource(p.id, it.id, s.id, 'vendor', v)} /></td>
              <td><${TextField} class="inp" value=${s.model} disabled=${ro} onChange=${v => A().updateSource(p.id, it.id, s.id, 'model', v)} /></td>
              <td><${TextField} class="inp mono" value=${s.mpn} disabled=${ro} onChange=${v => A().updateSource(p.id, it.id, s.id, 'mpn', v)} /></td>
              <td><${TextField} class="inp mono" value=${s.delta_pn} disabled=${ro} onChange=${v => A().updateSource(p.id, it.id, s.id, 'delta_pn', v)} /></td>
              <td><${SelectField} class="sel" value=${s.status} allowEmpty=${false} disabled=${ro} options=${schema.SOURCE_STATUS} onChange=${v => A().updateSource(p.id, it.id, s.id, 'status', v)} /></td>
              <td><${TextField} class="inp" value=${s.note} placeholder="short / long / 送樣日期…" disabled=${ro} onChange=${v => A().updateSource(p.id, it.id, s.id, 'note', v)} /></td>
              <td><button class="icon-btn danger rw-only" title="移除" onClick=${() => A().removeSource(p.id, it.id, s.id)}><${Icon} name="x" /></button></td>
            </tr>`)}</tbody>
          </table>` : null}
          <div class="form-grid mt12">
            <${Field} label="供應策略 / 備註" class="span-all" hint="例如：Vendor-A only source、short: 甲廠, long: Vendor-C"><${TextField} value=${it.sourcing_note} disabled=${ro} onChange=${v => u('sourcing_note', v)} /></${Field}>
          </div>
        </${Sec}>

        <${Sec} id="d-cost" title="成本與供應">
          <div class="form-grid">
            <${Field} label="單價"><${NumField} value=${it.price.unit} disabled=${ro} onChange=${v => u('price.unit', v)} /></${Field}>
            <${Field} label="幣別"><${SelectField} value=${it.price.currency} emptyLabel=${'（預設 ' + (db.settings.currency || 'USD') + '）'} disabled=${ro} options=${schema.CURRENCIES} onChange=${v => u('price.currency', v)} /></${Field}>
            <${Field} label="每台小計"><div class="ref-value mono">${calc.itemCost(it) == null ? '—' : util.fmt(calc.itemCost(it), 3) + ' ' + (it.price.currency || db.settings.currency || 'USD')}</div></${Field}>
            <${Field} label="MOQ"><${NumField} value=${it.moq} disabled=${ro} onChange=${v => u('moq', v)} /></${Field}>
            <${Field} label="交期"><${NumField} value=${it.lead_time_wk} unit="週" disabled=${ro} onChange=${v => u('lead_time_wk', v)} /></${Field}>
          </div>
        </${Sec}>

        <${Sec} id="d-val" title="驗證（拆機壓痕）" sub="組裝後拆解，檢查 TIM 壓痕是否完整覆蓋元件 — 最直接的組裝品質證據">
          <div class="form-grid">
            <${Field} label="壓痕覆蓋率"><${NumField} value=${it.validation.coverage_pct} unit="%" disabled=${ro} onChange=${v => u('validation.coverage_pct', v)} /></${Field}>
            <${Field} label="判定"><${SelectField} value=${it.validation.result} disabled=${ro} options=${schema.VALIDATION_RESULT} onChange=${v => u('validation.result', v)} /></${Field}>
            <${Field} label="日期"><input type="date" class="inp" value=${it.validation.date || ''} disabled=${ro} onChange=${e => u('validation.date', e.target.value)} /></${Field}>
            <${Field} label="說明" class="span-all"><${TextField} value=${it.validation.note} placeholder="Build / 樣品編號 / 觀察" disabled=${ro} onChange=${v => u('validation.note', v)} /></${Field}>
          </div>
          <div class="row mt12" style="gap:12px;align-items:flex-start">
            ${photo ? html`<img src=${photo.data} alt="驗證照片" style="max-width:260px;max-height:180px;border:1px solid var(--line);background:#fff" />` : null}
            <div class="row rw-only" style="gap:6px">
              <button class="btn btn-ghost btn-sm" onClick=${async () => setPhoto(await pickFile('image/*'))}><${Icon} name="image" /> ${photo ? '更換照片' : '加入壓痕照片'}</button>
              ${photo ? html`<button class="btn btn-ghost btn-sm" onClick=${() => u('validation.image_id', null)}><${Icon} name="trash" /> 移除照片</button>` : null}
            </div>
          </div>
        </${Sec}>

        <${Sec} id="d-note" title="備註與連結">
          <${TextField} multiline=${true} rows=${3} value=${it.note} placeholder="組裝注意事項、離型膜方向、預貼於機殼、Rework 方式…" disabled=${ro} onChange=${v => u('note', v)} />
          <div class="mt12">
            ${it.links.map((l, i) => html`<div class="row" style="margin-bottom:6px" key=${i}>
              <input class="inp" style="width:34%" value=${l.label} placeholder="名稱（Datasheet、驗證報告…）" disabled=${ro} onChange=${e => u('links', it.links.map((x, j) => (j === i ? Object.assign({}, x, { label: e.target.value }) : x)))} />
              <input class="inp mono" value=${l.url} placeholder="https://… 或 \\\\server\\share\\…" disabled=${ro} onChange=${e => u('links', it.links.map((x, j) => (j === i ? Object.assign({}, x, { url: e.target.value }) : x)))} />
              ${/^https?:\/\//i.test(l.url || '') ? html`<a class="icon-btn" href=${l.url} target="_blank" rel="noopener noreferrer" title="開啟"><${Icon} name="chevR" /></a>` : null}
              <button class="icon-btn danger rw-only" title="移除" onClick=${() => u('links', it.links.filter((x, j) => j !== i))}><${Icon} name="x" /></button>
            </div>`)}
            <button class="btn btn-ghost btn-sm rw-only" onClick=${() => u('links', it.links.concat({ label: '', url: '' }))}><${Icon} name="plus" /> 新增連結</button>
          </div>
        </${Sec}>

        <${Sec} id="d-hist" title="此 Item 的變更歷史" sub="最近 30 筆">
          ${history.length ? html`<table class="subtbl">
            <thead><tr><th>時間</th><th>人員</th><th>欄位</th><th>變更</th></tr></thead>
            <tbody>${history.map(h => html`<tr><td class="mono" style="white-space:nowrap;font-size:11px">${util.fmtDateTime(h.ts)}</td><td>${h.user}</td><td>${h.field || schema.labelOf(schema.CHANGE_KINDS, h.kind)}</td>
              <td>${h.text ? h.text : html`<span class="log-from">${h.from}</span> → <span class="log-to">${h.to}</span>`}</td></tr>`)}</tbody>
          </table>` : html`<div class="muted" style="font-size:12px">尚無紀錄。</div>`}
        </${Sec}>
      </div>
    </aside>`;
  }

  TIM.ui.ItemDrawer = ItemDrawer;
  TIM.ui.pickMaterial = pickMaterial;
})();
