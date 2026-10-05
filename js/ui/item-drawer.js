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
  // ───────── 元件快選: RefDes field with a dropdown of the components entered before (any item, any project) ─────────
  /**
   * props: value, covId, disabled, focus (focus on mount — a row just added), onChange(text) (live),
   * onPick(entry) (calc.knownComponents entry).
   * The list is grouped by 類別; it opens with ▾, on typing, on ArrowDown and on focus when empty. ↑↓ choose, Enter
   * applies, Esc closes the list only. Only an exact RefDes / 元件料號 match is preselected, so Enter never replaces
   * a new name being typed.
   */
  const AUTO = -2;      // preselect only an exact match
  const LIST_MAX = 100;
  function CompField(props) {
    const [open, setOpen] = useState(false);
    const [act, setAct] = useState(AUTO);
    const box = useRef(null);
    const input = () => box.current && box.current.querySelector('input');
    useLayoutEffect(() => { const inp = props.focus && input(); if (inp) inp.focus(); }, []);
    const all = open ? calc.matchKnown(calc.knownComponents(TIM.store.db, { exclude: props.covId }), props.value, Infinity) : [];
    const groups = calc.groupKnown(all.slice(0, LIST_MAX));
    const flat = [].concat.apply([], groups.map(g => g.items));
    const key = calc.nameKey(props.value);
    const cur = act === AUTO ? (key ? flat.findIndex(e => e.rkey === key || e.pkey === key) : -1) : Math.min(act, flat.length - 1);
    const empty = open && !flat.length && !key;   // nothing entered anywhere yet
    // a row near the bottom of the drawer: bring the list into view when it appears
    const shown = flat.length > 0 || empty;
    const sref = useRef(null);
    useLayoutEffect(() => { if (shown && sref.current && sref.current.scrollIntoView) sref.current.scrollIntoView({ block: 'nearest' }); }, [shown]);
    useLayoutEffect(() => { if (sref.current) sref.current.scrollTop = 0; }, [props.value]);        // new text → from the top
    const byKey = useRef(false);
    useLayoutEffect(() => {                                                                          // ↑↓ keep the choice visible
      const on = byKey.current && sref.current && sref.current.querySelector('.suggest-row.on');
      byKey.current = false;
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }, [cur]);
    const close = () => { setOpen(false); setAct(AUTO); };
    const pick = e => { close(); props.onPick(e); };
    const onKey = e => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); byKey.current = true; if (!open) { setOpen(true); setAct(0); } else if (flat.length) setAct((cur + 1) % flat.length); }
      else if (e.key === 'ArrowUp') { if (open && flat.length) { e.preventDefault(); byKey.current = true; setAct(cur <= 0 ? flat.length - 1 : cur - 1); } }
      else if (e.key === 'Enter') { if (open && flat[cur]) { e.preventDefault(); pick(flat[cur]); } }
      else if (e.key === 'Escape') { if (open) { e.stopPropagation(); close(); } }
      else if (e.key === 'Tab') close();
    };
    let i = -1;
    return html`<div class="comp-field" ref=${box}>
      <${TextField} class="inp mono" value=${props.value} placeholder="U101,U102" disabled=${props.disabled}
        onFocus=${() => { if (!props.value) { setOpen(true); setAct(AUTO); } }}
        onChange=${v => { setOpen(true); setAct(AUTO); props.onChange(v); }}
        onBlur=${close}
        onKeyDown=${onKey} />
      ${props.disabled ? null : html`<button type="button" class="dd-btn" tabindex="-1" title="從用過的元件快選（依類別）"
        onMouseDown=${ev => ev.preventDefault()}
        onClick=${() => { const inp = input(); if (inp && document.activeElement !== inp) inp.focus(); setOpen(!open); setAct(AUTO); }}><${Icon} name="chevD" size=${13} /></button>`}
      ${shown ? html`<div class="suggest" ref=${sref} role="listbox" aria-label="用過的元件">
        <div class="suggest-head">用過的元件（本案與其他專案，依類別）· ↑↓ 選擇 · Enter 帶入 · Esc 關閉</div>
        ${empty ? html`<div class="suggest-empty">還沒有用過的元件。填好的元件（RefDes / 元件料號、類別、封裝…）之後就會列在這裡，同案或他案都能快選。</div>` : null}
        ${groups.map(g => html`<div class="suggest-group" key=${'g:' + g.cat} role="presentation">
          <i style=${{ background: g.color }}></i>${g.label}<span>${g.items.length}</span></div>
          ${g.items.map(e => {
            const n = ++i;
            const u = e.uses[0];
            const sum = calc.componentSummary(e.values, { cat: false });
            return html`<button type="button" role="option" aria-selected=${n === cur} key=${e.key} class=${cx('suggest-row', n === cur && 'on')}
                title=${'用於：\n' + e.uses.map(x => x.project + ' / ' + (x.item_no || '(未編號)')).join('\n')}
                onMouseDown=${ev => ev.preventDefault()} onMouseEnter=${() => setAct(n)} onClick=${() => pick(e)}>
              <div class="sg-top"><b class="mono">${e.name}</b>${e.refdes && e.part ? html`<span class="mono muted">${e.part}</span>` : null}
                <span class="sg-uses">${e.uses.length} 處</span></div>
              <div class="sg-sum">${sum || html`<span class="muted">只有名稱，沒有其他資料</span>`}</div>
              <div class="sg-src">來源：${u.project} / ${u.item_no || '(未編號)'}${e.differs.length ? html` · <span class="text-warn">${e.differs.join('、')}各處不同，帶入來源的值</span>` : null}</div>
            </button>`;
          })}`)}
        ${all.length > LIST_MAX ? html`<div class="suggest-empty">只列出最近的 ${LIST_MAX} 個，輸入文字可篩選其餘 ${all.length - LIST_MAX} 個</div>` : null}
      </div>` : null}
    </div>`;
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
        ${cc.rec && cc.rec.min != null ? html`<div class="rec rec-min" style=${{ left: pct(cc.rec.min) + '%', width: (100 - pct(cc.rec.min)) + '%' }} title=${'最小壓縮 ' + cc.rec.min + '%（接觸）'}></div>` : null}
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
    const [newCov, setNewCov] = useState(null);   // covered row just added → its part number field takes focus
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
    const sug = calc.libraryMatch(db, it);   // same Vendor + Model as a library material, not linked
    const exemptOf = c => { const t = schema.loadType(c.load_type); return !!(t && !t.check); };
    const history = (p.changelog || []).filter(c => c.target_id && String(c.target_id).startsWith(it.id)).slice(-30).reverse();
    const covQty = calc.coveredQty(it);
    const totalPower = util.sum(it.covered, c => { const pt = calc.timPower(c); return pt === null ? NaN : pt * (Number.isFinite(c.qty) ? c.qty : 1); });
    const recSrcLabel = cc.rec ? { item: '手動', generic: '預設' }[cc.rec.source] : '';
    const lowC = !!(cc.rec && cc.min != null && cc.min > 0 && cc.min < cc.rec.min);   // compression min below the minimum → red (Fail)
    const gi = cc.gap || calc.gapInfo(it);
    const stack = gi.stackReady && !it.gap_manual;
    const uc = (c, f, v) => A().updateCovered(p.id, it.id, c.id, f, v);
    const STATUS_TAG = { ok: ['tag-ok', 'OK'], warn: ['tag-warn', 'Warning'], error: ['tag-err', 'Fail'] };
    const tag = s => (STATUS_TAG[s] ? html`<span class=${cx('tag', STATUS_TAG[s][0])}>${STATUS_TAG[s][1]}</span>` : html`<span class="muted">—</span>`);
    const psiTxt = r => (r ? (r.beyond ? '> ' : '') + util.fmt(r.psi, 1) : '—');
    const basisTxt = r => (!r ? '' : r.basis === 'interp' ? '由 ' + r.t_used.join(' / ') + ' mm 曲線內插' : r.basis === 'nearest' ? '以最接近的 ' + r.t_used[0] + ' mm 曲線估算' : r.t_used[0] + ' mm 曲線');

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
              <${Field} label="型態"><div class="ref-value">${schema.materialTypeText(mat)}</div></${Field}>
              <${Field} label="k"><div class="ref-value mono">${mat.k == null ? '—' : util.fmt(mat.k, 2) + ' W/m·K'} <span class="src">${mat.k_method || ''}</span></div></${Field}>
            </div>
            <div class="row mt8" style="gap:8px">
              <button class="btn btn-ghost btn-sm" onClick=${() => go('library/' + mat.id)}><${Icon} name="book" /> 開啟材料資料</button>
              <button class="btn btn-ghost btn-sm rw-only" onClick=${() => pickMaterial(p.id, it.id)}>改連結其他材料…</button>
            </div>` : html`<div class="form-grid">
              <${Field} label="Vendor"><${TIM.ui.MaterialCombo} pid=${p.id} itemId=${it.id} field="vendor" value=${it.vendor} disabled=${ro} onChange=${v => u('vendor', v)} /></${Field}>
              <${Field} label="Model"><${TIM.ui.MaterialCombo} pid=${p.id} itemId=${it.id} field="model" value=${it.model} disabled=${ro} onChange=${v => u('model', v)} /></${Field}>
              <${Field} label="型態"><${SelectField} value=${it.tim_type} allowEmpty=${false} disabled=${ro} options=${schema.TIM_TYPES.map(t => ({ v: t.v, label: t.label + '｜' + t.zh }))} onChange=${v => u('tim_type', v)} /></${Field}>
            </div>
            <div class="row mt8 wrap rw-only" style="gap:8px">
              ${sug ? html`<button class="btn btn-primary btn-sm" onClick=${() => A().linkMaterial(p.id, it.id, sug.id)}><${Icon} name="link" /> 連結材料庫的「${sug.vendor} ${sug.model}」</button>` : null}
              <button class="btn btn-ghost btn-sm" onClick=${() => pickMaterial(p.id, it.id)}><${Icon} name="book" /> 從材料庫選擇…</button>
              ${!sug ? html`<button class="btn btn-ghost btn-sm" onClick=${addToLibrary}><${Icon} name="plus" /> 加入材料庫並連結</button>` : null}
              <span class="muted" style="font-size:11.5px">Vendor / Model 點開會列出整個材料庫，選了就連結；未連結時無法帶入 k 值與壓力–壓縮曲線</span>
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
          right=${html`<button class="btn btn-ghost btn-sm rw-only" onClick=${() => setNewCov(A().addCovered(p.id, it.id, { cat: it.used_on[0] || '' }))}><${Icon} name="plus" /> 新增元件</button>`}>
          ${it.covered.length ? html`<table class="subtbl">
            <thead><tr><th style="width:19%">元件料號</th><th style="width:16%">RefDes</th><th class="r" style="width:7%">數量</th><th style="width:10%">類別</th><th class="r" style="width:10%">功耗 W/顆</th>
              <th class="r" style="width:9%" title="經由頂面 TIM 散出的比例；空白 = 100%">頂面 % <${InfoDot}><div style="max-width:300px;line-height:1.6">元件功耗經由頂面 TIM 散出的比例。<br/>底部散熱為主的封裝（QFN / PA 走 PCB、copper coin）只有一小部分走頂面；有 lid 的 BGA 大部分走頂面。<br/>可由模擬（FloTHERM 熱流分配）或 θ<sub>JC-top</sub> / θ<sub>JB</sub> 估算。空白 = 100%。</div></${InfoDot}></th>
              <th class="r" style="width:8%">封裝 L</th><th class="r" style="width:8%">封裝 W</th><th>備註</th><th></th></tr></thead>
            <tbody>${it.covered.map(c => html`<tr key=${c.id}>
              <td><${TextField} class="inp mono" value=${c.part} disabled=${ro} onChange=${v => A().updateCovered(p.id, it.id, c.id, 'part', v)} /></td>
              <td><${CompField} value=${c.refdes} covId=${c.id} disabled=${ro} focus=${c.id === newCov}
                onChange=${v => A().updateCovered(p.id, it.id, c.id, 'refdes', v)}
                onPick=${e => { if (A().applyKnownComponent(p.id, it.id, c.id, e)) toast('已帶入 ' + e.name + '：' + (calc.componentSummary(e.values) || '名稱'), 'ok'); }} /></td>
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
              ${it.qty != null && covQty !== it.qty ? html`<div class="text-warn">覆蓋元件 ${covQty} 顆 ≠ Q'ty ${it.qty} 片（一片 pad 對一顆元件時兩者應相等）</div>` : html`<div>封裝尺寸 → 有效接觸面積 = min(pad 面積, 元件頂面)；功耗 × 頂面 % → 經 TIM 的熱量，用於溫升估算</div>`}
              <div>元件快選：在 RefDes 欄按 ▾ 或輸入文字，依類別列出用過的元件（本案與其他專案）；選取即帶入 RefDes、元件料號、類別、功耗、頂面 %、封裝、高度、耐壓（數量、備註不帶）</div>
            </td></tr></tfoot>
          </table>` : html`<div class="muted" style="font-size:12px">尚未記錄。可在 TIM 清單的 Note 欄直接輸入 <span class="mono">LDO-A*2, BUCK-B*4</span>，或在此新增並補上 RefDes 與功耗。用過的元件（本案或其他專案）可在 RefDes 欄下拉快選帶入。</div>`}
        </${Sec}>

        <${Sec} id="d-gap" title="機構間隙、壓縮與壓力" sub="設計間距 ± 公差 + 元件高度公差 → 間隙（最壞情況）→ 壓縮率 → 壓力"
          right=${html`<${InfoDot}><div class="formula">設計間距 = 凸台到元件頂面（元件高度 nom 時）<br/>間隙 min = (間距 − 下公差) − (元件 max − 元件 nom)<br/>間隙 nom = 間距<br/>間隙 max = (間距 + 上公差) + (元件 nom − 元件 min)<br/>一片 pad 蓋多顆元件：間距以最高（nom）的元件為準，較矮的元件加上高度差<br/>壓縮率 C = (T − g) / T × 100%：C<sub>min</sub> 用 g<sub>max</sub>、C<sub>max</sub> 用 g<sub>min</sub><br/>C<sub>min</sub> 低於最小壓縮率（預設 10%）→ Fail（接觸可能不足，紅字）；g ≥ T → 未接觸<br/>壓力：材料庫的壓力–壓縮曲線（依厚度內插）在 C<sub>max</sub> 的值<br/>受力 = 壓力 × min(pad 面積, 元件頂面)<br/>壓力 > 耐壓 → Fail；≥ 耐壓的 ${db.settings.pressure_warn_pct || 80}% → Warning<br/>曲線是廠商標準樣品、等速壓縮的值：實際面積、組裝速度、應力鬆弛都會不同，接近耐壓請實測。</div></${InfoDot}>`}>
          ${dispense ? html`<div class="muted" style="font-size:12px">點膠類材料不檢核壓縮率與壓力；請記錄 BLT 與設計間隙供熱估算。</div>` : null}
          <div class="form-grid">
            <${Field} label="T（未壓縮厚度）"><div class="ref-value mono">${it.size.t == null ? '—' : util.fmt(it.size.t) + ' mm'}</div></${Field}>
            <${Field} label="設計間距 nom" info="散熱片凸台（或機殼）到元件頂面的間距，以元件高度 nom 為準 —— 也就是給機構的間距；一片 pad 蓋多顆元件時，以最高的那顆為準"><${NumField} value=${it.gap_design.nom} unit="mm" disabled=${ro} onChange=${v => u('gap_design.nom', v)} /></${Field}>
            <${Field} label="間距公差 +" info="機構公差：凸台加工、PCB 翹曲、組裝；+ 讓間距變大（壓得少）"><${NumField} value=${it.gap_design.plus} unit="mm" placeholder="0" disabled=${ro} onChange=${v => u('gap_design.plus', v)} /></${Field}>
            <${Field} label="間距公差 −" info="− 讓間距變小（壓得多）"><${NumField} value=${it.gap_design.minus} unit="mm" placeholder="0" disabled=${ro} onChange=${v => u('gap_design.minus', v)} /></${Field}>
          </div>
          ${it.covered.length ? html`<table class="subtbl mt12 h-table">
            <thead><tr><th style="width:18%">元件（覆蓋元件）</th>
              <th style="width:22%">受壓類型 <${InfoDot}><div style="max-width:340px;line-height:1.6">決定要不要檢核耐壓：<br/>${schema.LOAD_TYPES.map(t => html`<b>${t.label}</b>${t.check ? '：檢核' : '：不檢核'} — ${t.why}<br/>`)}<b>未指定</b>：有填耐壓就檢核。<br/>不檢核時壓力照算，只顯示供參考。</div></${InfoDot}></th>
              <th class="r">高度 min mm</th><th class="r">高度 nom mm</th><th class="r">高度 max mm</th>
              <th class="r">耐壓 <${InfoDot}><div style="max-width:300px;line-height:1.6">元件頂面可承受的壓力或力（元件規格書的 max static load / compressive force）。<br/>填力（N / kgf / lbf）時以 min(pad 面積, 封裝 L × W) 換算成壓力。</div></${InfoDot}></th><th style="width:13%">單位</th></tr></thead>
            <tbody>${it.covered.map(c => html`<tr key=${c.id}>
              <td class="mono">${c.part || c.refdes || html`<span class="muted">（未命名）</span>`}${c.part && c.refdes ? html` <span class="muted">${c.refdes}</span>` : null}</td>
              <td><${SelectField} class="sel" value=${c.load_type} emptyLabel="未指定" disabled=${ro} title=${schema.loadType(c.load_type) ? schema.loadType(c.load_type).why : '未指定：有填耐壓就檢核'}
                options=${schema.LOAD_TYPES.map(t => ({ v: t.v, label: t.label }))} onChange=${v => uc(c, 'load_type', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.h_min} disabled=${ro} onChange=${v => uc(c, 'h_min', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.h_nom} disabled=${ro} onChange=${v => uc(c, 'h_nom', v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${c.h_max} disabled=${ro} onChange=${v => uc(c, 'h_max', v)} /></td>
              ${exemptOf(c) ? html`<td colspan="2" class="r muted" title=${schema.loadType(c.load_type).why}>不需（${schema.loadType(c.load_type).short} 不檢核）</td>`
                : html`<td><${NumField} class="inp" right=${true} value=${c.p_allow} disabled=${ro} onChange=${v => uc(c, 'p_allow', v)} /></td>
              <td><${SelectField} class="sel" value=${c.p_unit} allowEmpty=${false} disabled=${ro} options=${schema.P_UNITS.map(x => x.v)} onChange=${v => uc(c, 'p_unit', v)} /></td>`}
            </tr>`)}</tbody>
            <tfoot><tr><td colspan="7">元件高度照封裝圖的上 / 中 / 下限填（例如 1.10 / 1.20 / 1.30），用來加上元件高度公差；沒填就只算間距公差。
              受壓類型選 BGA / 裸晶 / 空腔有蓋 → 檢核耐壓；E-PAD / QFN / LGA / 引腳 → 壓力只顯示、不判定；未指定 → 有填耐壓才判定。</td></tr></tfoot>
          </table>` : !dispense ? html`<div class="muted mt8" style="font-size:12px">在「覆蓋元件」新增元件後，可填元件高度（自動算間隙）與耐壓（判定過壓）。</div>` : null}
          <div class="form-grid mt12">
            <${Field} label="間隙 min / nom / max" class="span-2">
              ${gi.stackReady ? html`<${Locked} unlocked=${!!it.gap_manual} source="設計間距"
                  display=${html`<span class="mono">${[gi.min, gi.nom, gi.max].map(v => (v == null ? '—' : util.fmt(v, 3))).join(' / ')} mm</span>`}
                  onUnlock=${ro ? null : () => A().patchItems(p.id, [{ itemId: it.id, patch: { gap_manual: true, gap: { min: gi.min, nom: gi.nom, max: gi.max } } }], '間隙手動輸入')}
                  onRelock=${ro ? null : () => u('gap_manual', false)}>
                  <div class="triple">
                    <${NumField} value=${it.gap.min} unit="min" disabled=${ro} onChange=${v => u('gap.min', v)} />
                    <${NumField} value=${it.gap.nom} unit="nom" disabled=${ro} onChange=${v => u('gap.nom', v)} />
                    <${NumField} value=${it.gap.max} unit="max" disabled=${ro} onChange=${v => u('gap.max', v)} />
                  </div>
                </${Locked}>`
                : html`<div class="triple">
                  <${NumField} value=${it.gap.min} unit="min" disabled=${ro} onChange=${v => u('gap.min', v)} />
                  <${NumField} value=${it.gap.nom} unit="nom" disabled=${ro} onChange=${v => u('gap.nom', v)} />
                  <${NumField} value=${it.gap.max} unit="max" disabled=${ro} onChange=${v => u('gap.max', v)} />
                </div>`}
            </${Field}>
            <${Field} label="最小壓縮率" info="低於此值 → Fail（接觸可能不足，壓縮率 min 以紅字標示）。過壓改由壓力判定（材料曲線 vs 元件耐壓）。預設 10% 為經驗值，可解鎖依材料 / 專案調整。">
              <${Locked} unlocked=${!!(it.comp_override && it.comp_override.min != null)} source=${recSrcLabel}
                display=${cc.rec ? html`<span class="mono">${cc.rec.min} %</span>` : html`<span class="muted">—</span>`}
                onUnlock=${ro ? null : () => u('comp_override', { min: cc.rec ? cc.rec.min : 10 })}
                onRelock=${ro ? null : () => u('comp_override', null)}>
                <${NumField} value=${it.comp_override ? it.comp_override.min : null} unit="%" disabled=${ro} onChange=${v => u('comp_override', { min: v })} />
              </${Locked}>
            </${Field}>
          </div>
          ${cc.status !== 'na' ? html`<div class="calc-box mt12">
              <div title=${lowC ? '低於最小壓縮率 ' + cc.rec.min + '%：接觸可能不足' : ''}><div class="k">壓縮率 min</div><div class=${cx('v', lowC && 'text-err')}>${cc.min == null ? '—' : util.fmt(cc.min, 1) + '%'}${lowC ? html`<span class="low-c">＜ ${cc.rec.min}%</span>` : null}</div></div>
              <div><div class="k">壓縮率 nom</div><div class="v">${cc.nom == null ? '—' : util.fmt(cc.nom, 1) + '%'}</div></div>
              <div><div class="k">壓縮率 max</div><div class="v">${cc.max == null ? '—' : util.fmt(cc.max, 1) + '%'}</div></div>
              <div title=${basisTxt(cc.pressure)}><div class="k">壓力 max</div><div class="v">${cc.pressure ? psiTxt(cc.pressure) + ' psi' : html`<span class=${sug ? 'text-warn' : 'muted'} style="font-size:12px">${mat ? '材料無曲線' : '未連結材料'}</span>`}</div></div>
              <div><div class="k">判定</div><div class="v">${tag(cc.status)}</div></div>
            </div>
            <${RangeBar} cc=${cc} />
            ${sug && !ro ? html`<div class="link-hint mt8"><${Icon} name="warn" size=${14} /><span>Vendor / Model 與材料庫的「${sug.vendor} ${sug.model}」相同，但這個 Item 還沒連結，壓力曲線與 k 值都沒有帶入。</span>
              <button class="btn btn-secondary btn-xs" onClick=${() => A().linkMaterial(p.id, it.id, sug.id)}><${Icon} name="link" /> 連結</button></div>` : null}
            ${cc.comps.length ? html`<table class="subtbl mt12 p-table">
              <thead><tr><th>元件</th><th class="r">間隙 min / nom / max mm</th><th class="r">壓縮率 %</th><th class="r">壓力 psi</th><th class="r">受力 N</th><th class="r">耐壓</th><th>判定</th></tr></thead>
              <tbody>${cc.comps.map(r => html`<tr key=${r.id}>
                <td class="mono">${r.part || r.refdes || '—'}${r.part && r.refdes ? html` <span class="muted">${r.refdes}</span>` : null}</td>
                <td class="r mono">${[r.gap.min, r.gap.nom, r.gap.max].map(v => (v == null ? '—' : util.fmt(v, 3))).join(' / ')}</td>
                <td class="r mono">${r.cMin == null ? '—' : util.fmt(r.cMin, 1)} ~ ${r.cMax == null ? '—' : util.fmt(r.cMax, 1)}</td>
                <td class="r mono" title=${basisTxt(r.pMax)}>${r.pMax ? (r.pMin ? psiTxt(r.pMin) + ' ~ ' : '') + psiTxt(r.pMax) : '—'}</td>
                <td class="r mono">${r.force == null ? '—' : util.fmt(r.force, 1)}</td>
                <td class="r mono" title=${r.allow && r.allow.unit !== 'psi' && r.allow.psi != null ? '= ' + util.fmt(r.allow.psi, 1) + ' psi' : ''}>${r.exempt ? html`<span class="muted">不需</span>` : r.allow ? util.fmt(r.allow.value) + ' ' + r.allow.unit : html`<span class="muted">未填</span>`}${r.ratio != null ? html`<div class="muted" style="font-size:10.5px">${util.fmt(r.ratio, 0)}%</div>` : null}</td>
                <td>${r.exempt ? html`<span class="tag tag-mute" title=${schema.loadType(r.loadType).why}>不檢核</span>` : tag(r.status)}</td>
              </tr>`)}</tbody>
            </table>` : null}
            ${cc.msgs.length ? html`<ul style="margin:8px 0 0 18px;font-size:12px">${cc.msgs.map((m, i) => html`<li class=${cc.levels[i] === 'error' ? 'text-err' : 'text-warn'}>${m}</li>`)}</ul>` : null}
            ${cc.notes.length ? html`<ul style="margin:6px 0 0 18px;font-size:12px" class="muted">${cc.notes.map(m => html`<li>${m}</li>`)}</ul>` : null}
            ${cc.pressure && cc.pressure.basis !== 'exact' ? html`<div class="muted mt8" style="font-size:11.5px">壓力${basisTxt(cc.pressure)}（材料庫沒有 ${util.fmt(it.size.t)} mm 的曲線）。</div>` : null}`
            : !dispense ? html`<div class="muted mt8" style="font-size:12px">填入 T 與設計間距（或手動間隙）後自動計算。</div>` : null}
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
