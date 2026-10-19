/* 已發行 TIM: Delta part numbers used in any project's TIM list (core/released.js), and the picker that adds
 * them to a TIM list (TIM 清單 →「從已發行 TIM 新增」). */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, Icon, cx, go, Modal, openModal, toast, usePref } = TIM.ui;
  const { util, schema, parse } = TIM;
  const R = TIM.released;
  const A = () => TIM.actions;

  const shapeText = e => (schema.isDispense(e.eff.tim_type)
    ? (e.item.dispense && e.item.dispense.amount != null ? util.fmt(e.item.dispense.amount, 3) + ' ' + (e.item.dispense.unit || 'g') : '')
    : parse.formatSize(e.item.size));
  const projectsText = e => {
    const names = Array.from(new Set(e.uses.map(u => u.project)));
    return names.length > 2 ? names.slice(0, 2).join('、') + ' 等 ' + names.length + ' 個專案' : names.join('、');
  };
  const SpecWarn = props => (props.e.specs.length > 1
    ? html`<span class="tag tag-warn" title=${'同一料號在各專案的規格不同：\n' + props.e.specs.map(s => s.text + '（' + s.n + ' 個 Item）').join('\n')}>規格不一致</span>` : null);

  function ReleasedPage() {
    const st = TIM.store;
    const db = st.db;
    const [q, setQ] = useState('');
    const [type, setType] = usePref('released_type', '');
    const [open, setOpen] = useState(null);
    const all = useMemo(() => R.parts(db), [st.version]);
    const list = all.filter(e => (!type || e.eff.tim_type === type) && R.matches(e, q));
    return html`<div class="page"><div class="page-inner">
      <div class="home-head">
        <div><div class="eyebrow">Released TIM · ${all.length}</div><h1>已發行 TIM</h1></div>
      </div>
      <p class="muted" style="margin:-8px 0 14px;max-width:820px;line-height:1.6">所有專案的 TIM 清單中，填了 Delta 料號的 Item 自動列在這裡（同一料號只列一次，N/A、TBD 這類不算）。
        新專案的 TIM 清單按「從已發行 TIM 新增」就能快選加入：材料、尺寸 / 點膠量、Vendor P/N、2nd source、單價一起帶入，Location、Q'ty、Used On、覆蓋元件、間隙則照新專案填。</p>
      <div class="lib-filters">
        <div class="searchbox" style="width:320px"><${Icon} name="search" /><input class="inp" placeholder="搜尋料號、廠商、型號、尺寸、專案…" value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <select class="sel" style="width:170px" value=${type} onChange=${e => setType(e.target.value)}><option value="">全部型態</option>${schema.TIM_TYPES.map(t => html`<option value=${t.v}>${t.label}</option>`)}</select>
      </div>
      ${list.length ? html`<div class="tbl-wrap"><table class="tbl rel-tbl">
        <thead><tr><th>Delta P/N</th><th>型態</th><th>Vendor</th><th>Model</th><th class="r">k W/m·K</th><th>Size / 點膠量</th><th>Vendor P/N</th><th>使用專案</th><th class="r">Item 數</th></tr></thead>
        <tbody>${list.map(e => [
          html`<tr key=${e.key} class=${cx('clickable', open === e.key && 'sel')} onClick=${() => setOpen(open === e.key ? null : e.key)}>
            <td class="mono"><b>${e.pn}</b> <${SpecWarn} e=${e} /></td>
            <td>${schema.timType(e.eff.tim_type).label}</td><td>${e.eff.vendor}</td><td>${e.eff.model}</td>
            <td class="r mono">${util.fmt(e.eff.k, 2)}</td><td class="mono">${shapeText(e)}</td><td class="mono">${e.item.vendor_pn || ''}</td>
            <td>${projectsText(e)}</td><td class="r mono">${e.uses.length}</td>
          </tr>`,
          open === e.key ? html`<tr key=${e.key + ':d'} class="rel-detail"><td colspan="9">
            ${e.specs.length > 1 ? html`<div class="text-warn" style="font-size:12px;margin-bottom:6px"><${Icon} name="warn" size=${12} /> 同一料號的規格不同：${e.specs.map(s => s.text + '（' + s.n + '）').join('；')}。帶入時用最近更新的專案的資料。</div>` : null}
            <table class="subtbl"><thead><tr><th>專案</th><th>Stage</th><th>Item</th><th>Location</th><th class="r">Q'ty</th><th>狀態</th></tr></thead>
              <tbody>${e.uses.map(u => html`<tr class="clickable" style="cursor:pointer" onClick=${ev => { ev.stopPropagation(); go('p/' + u.pid + '/bom/' + u.item_id); }}>
                <td>${u.project}</td><td><span class="tag tag-stage">${u.stage}</span></td><td class="mono"><b>${u.item_no}</b></td><td>${u.location}</td>
                <td class="r mono">${u.qty == null ? '' : u.qty}</td><td>${schema.labelOf(schema.ITEM_STATUS, u.status)}</td></tr>`)}</tbody></table>
          </td></tr>` : null,
        ])}</tbody>
      </table></div>` : html`<div class="empty">
        <h3>${all.length ? '沒有符合的料號' : '還沒有已發行的料號'}</h3>
        <p>TIM 清單的 Delta P/N 欄填了料號的 Item 會自動出現在這裡，不用另外建立。</p>
      </div>`}
    </div></div>`;
  }

  /** Pick released part numbers and add them to project `pid`'s TIM list (one undo step). */
  function PickerModal(props) {
    const st = TIM.store;
    const db = st.db;
    const p = db.projects[props.pid];
    const all = useMemo(() => R.parts(db), []);
    const here = new Set(p.items.map(it => R.pnKey(it.delta_pn)).filter(Boolean));
    const [q, setQ] = useState('');
    const [sel, setSel] = useState([]);
    const [loc, setLoc] = useState(props.location_id || (p.locations[0] && p.locations[0].id));
    const list = all.filter(e => R.matches(e, q));
    const toggle = key => setSel(prev => (prev.includes(key) ? prev.filter(k => k !== key) : prev.concat(key)));
    const add = () => {
      const picked = all.filter(e => sel.includes(e.key));
      if (!picked.length) return;
      const ids = A().insertItems(p.id, picked.map(e => ({ fields: R.itemFields(e, db) })), { location_id: loc, label: '從已發行 TIM 新增' });
      toast('已新增 ' + ids.length + ' 個 Item：' + picked.map(e => e.pn).join('、'), 'ok');
      props.close(ids);
    };
    return html`<${Modal} title="從已發行 TIM 新增" size="wide" onClose=${() => props.close(null)} onEnter=${add}
      footer=${html`<span class="left">${sel.length ? '已選 ' + sel.length + ' 個料號' : '勾選要加入的料號'} · 加到
          <select class="sel sel-sm" value=${loc} aria-label="Location" onChange=${e => setLoc(e.target.value)}>${p.locations.map(l => html`<option value=${l.id}>${l.name}</option>`)}</select></span>
        <button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>
        <button class="btn btn-primary" data-enter-ok="1" disabled=${!sel.length} onClick=${add}><${Icon} name="plus" /> 新增 ${sel.length || ''} 個 Item</button>`}>
      <div class="searchbox" style="margin-bottom:10px"><${Icon} name="search" /><input class="inp" autofocus placeholder="搜尋料號、廠商、型號、尺寸、專案…" value=${q} onInput=${e => setQ(e.target.value)} /></div>
      ${all.length ? html`<div class="tbl-wrap rel-pick"><table class="tbl">
        <thead><tr><th></th><th>Delta P/N</th><th>型態</th><th>Vendor</th><th>Model</th><th>Size / 點膠量</th><th>用過的專案</th></tr></thead>
        <tbody>${list.map(e => html`<tr key=${e.key} class=${cx('clickable', sel.includes(e.key) && 'sel')} onClick=${() => toggle(e.key)}>
          <td class="c"><input type="checkbox" aria-label=${'選取 ' + e.pn} checked=${sel.includes(e.key)} onClick=${ev => ev.stopPropagation()} onChange=${() => toggle(e.key)} /></td>
          <td class="mono"><b>${e.pn}</b> ${here.has(e.key) ? html`<span class="tag tag-mute">此專案已有</span>` : null} <${SpecWarn} e=${e} /></td>
          <td>${schema.timType(e.eff.tim_type).label}</td><td>${e.eff.vendor}</td><td>${e.eff.model}</td><td class="mono">${shapeText(e)}</td>
          <td class="muted">${projectsText(e)}</td>
        </tr>`)}</tbody>
      </table></div>
      ${!list.length ? html`<div class="hint">沒有符合「${q}」的料號。</div>` : null}`
      : html`<div class="empty compact"><p>還沒有已發行的料號：任何專案的 TIM 清單填了 Delta P/N 後就會出現在這裡。</p></div>`}
      <div class="hint">帶入：材料（連結材料庫）、型態、尺寸 / 點膠量、Vendor P/N、加工廠、裁切圖號、2nd source、單價 / MOQ / 交期。Location、Q'ty、Used On、覆蓋元件與間隙請照這個專案填寫。</div>
    </${Modal}>`;
  }
  const openReleasedPicker = (pid, location_id) => openModal(close => html`<${PickerModal} pid=${pid} location_id=${location_id} close=${close} />`).promise;

  Object.assign(TIM.ui, { ReleasedPage, openReleasedPicker });
})();
