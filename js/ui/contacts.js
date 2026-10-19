/* 聯絡人: factories and suppliers shared by all projects. 備料 picks the organisation (default factory; the
 * supplier whose 代理廠牌 includes an item's Vendor) and preselects its people as 收件者 / 副本. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useRef, useLayoutEffect, Icon, cx, go, TextField, Field, confirm, prompt } = TIM.ui;
  const { util, schema, calc } = TIM;
  const A = () => TIM.actions;

  const KIND_LABEL = { factory: '工廠', supplier: '供應商' };
  const isMail = s => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

  /** Brand names known to the database (material library + every project's TIM list), case-insensitive unique. */
  function knownBrands(db) {
    const seen = new Map();
    const add = v => { const s = String(v || '').trim(); if (s && !seen.has(s.toUpperCase())) seen.set(s.toUpperCase(), s); };
    Object.values(db.materials).forEach(m => add(m.vendor));
    Object.values(db.projects).forEach(p => p.items.forEach(it => add(calc.effective(it, calc.materialOf(db, it)).vendor)));
    return Array.from(seen.values()).sort(util.naturalCompare);
  }

  /** Editing form of one organisation (drawer on the 聯絡人 page, dialog from 備料). */
  function OrgEditor(props) {
    const st = TIM.store;
    const db = st.db;
    const ro = st.readonly;
    const o = db.contacts[props.id];
    if (!o) return html`<div class="muted">找不到這個聯絡單位（可能已被刪除）。</div>`;
    const u = (f, v) => A().updateContact(o.id, f, v);
    const taken = new Set(o.brands.map(b => b.toUpperCase()));
    const brands = knownBrands(db).filter(b => !taken.has(b.toUpperCase()));
    const others = b => Object.values(db.contacts).filter(x => x.id !== o.id && x.kind === 'supplier' && x.brands.some(y => y.toUpperCase() === b.toUpperCase())).map(x => x.name);
    const addBrand = async v => {
      if (v === '__other__') {
        const t = await prompt({ title: '新增代理廠牌', label: '廠牌（與 TIM 清單的 Vendor 相同）', okText: '加入' });
        if (t && String(t).trim()) A().addContactBrand(o.id, t);
        return;
      }
      if (v) A().addContactBrand(o.id, v);
    };
    return html`<div class="org-edit">
      <section class="dsec"><div class="dsec-head"><h3>基本</h3></div>
        <div class="form-grid">
          <${Field} label="類型"><div class="seg">${schema.ORG_KINDS.map(k => html`<button type="button" class=${o.kind === k.v ? 'on' : ''} disabled=${ro} onClick=${() => u('kind', k.v)}>${k.label}</button>`)}</div></${Field}>
          <${Field} label="名稱" class="span-2"><${TextField} value=${o.name} placeholder=${o.kind === 'factory' ? '例如：甲廠 物料課' : '例如：乙公司'} disabled=${ro} autofocus=${props.autofocus} onChange=${v => u('name', v)} /></${Field}>
          ${o.kind === 'factory' ? html`<${Field} label="預設工廠" info="有 Delta 料號的品項預設寄給這個工廠；只能有一個">
            <label class="check"><input type="checkbox" checked=${o.is_default} disabled=${ro} onChange=${() => A().setDefaultFactory(o.id)} /> 備料預設寄給這裡</label></${Field}>` : null}
        </div>
        ${o.kind === 'supplier' ? html`<div class="field mt12">
          <div class="field-label">代理廠牌 <span class="muted" style="font-weight:400">TIM 清單 Vendor 是這些廠牌的品項，備料時自動寄給這家</span></div>
          <div class="brand-chips">
            ${o.brands.map(b => html`<span class="brand-chip" key=${b} title=${others(b).length ? '也在：' + others(b).join('、') : ''}>${b}${others(b).length ? html`<i>＋${others(b).length}</i>` : null}
              ${!ro ? html`<button type="button" title=${'移除 ' + b} onClick=${() => A().removeContactBrand(o.id, b)}><${Icon} name="x" size=${11} /></button>` : null}</span>`)}
            ${!ro ? html`<select class="sel brand-add" value="" onChange=${e => { const v = e.target.value; e.target.value = ''; addBrand(v); }}>
              <option value="">＋ 加入廠牌…</option>
              ${brands.map(b => html`<option value=${b}>${b}</option>`)}
              <option value="__other__">其他（輸入）…</option>
            </select>` : null}
          </div>
          ${!o.brands.length ? html`<div class="field-hint">還沒有廠牌：名稱與 Vendor 相同時也會自動對應。</div>` : null}
        </div>` : null}
      </section>
      <section class="dsec"><div class="dsec-head"><h3>聯絡人</h3><span class="muted" style="font-size:11.5px">角色是備料郵件的預設：收件者 / 副本；PM 列出但預設不寄（寄信前都可再改）</span></div>
        ${o.people.length ? html`<table class="subtbl people-tbl">
          <thead><tr><th>姓名</th><th>職稱</th><th>Email</th><th>電話</th><th>角色</th><th></th></tr></thead>
          <tbody>${o.people.map(p => html`<tr key=${p.id}>
            <td><${TextField} value=${p.name} placeholder="姓名" disabled=${ro} onChange=${v => A().updateContactPerson(o.id, p.id, 'name', v)} /></td>
            <td><${TextField} value=${p.title} placeholder="物料課 / 業務" disabled=${ro} onChange=${v => A().updateContactPerson(o.id, p.id, 'title', v)} /></td>
            <td><${TextField} value=${p.email} placeholder="name@example.com" mono=${true} invalid=${!isMail(p.email)} disabled=${ro} onChange=${v => A().updateContactPerson(o.id, p.id, 'email', v.trim())} /></td>
            <td><${TextField} value=${p.phone} placeholder="市話 / 分機 / 手機" disabled=${ro} onChange=${v => A().updateContactPerson(o.id, p.id, 'phone', v)} /></td>
            <td><div class="seg seg-sm">${schema.CONTACT_ROLES.map(r => html`<button type="button" class=${p.role === r.v ? 'on' : ''} disabled=${ro} onClick=${() => A().updateContactPerson(o.id, p.id, 'role', r.v)}>${r.label}</button>`)}</div></td>
            <td class="r">${!ro ? html`<button class="icon-btn danger" title="移除聯絡人" onClick=${() => A().removeContactPerson(o.id, p.id)}><${Icon} name="trash" /></button>` : null}</td>
          </tr>`)}</tbody>
        </table>` : html`<div class="muted" style="font-size:12px;margin-bottom:8px">還沒有聯絡人：沒有 Email 的對象無法產生郵件。</div>`}
        ${!ro ? html`<button class="btn btn-secondary btn-sm mt8" onClick=${() => A().addContactPerson(o.id, { role: o.people.some(p => p.role === 'to') ? 'cc' : 'to' })}><${Icon} name="plus" /> 新增聯絡人</button>` : null}
      </section>
      <section class="dsec"><div class="dsec-head"><h3>備註</h3></div>
        <${TextField} multiline=${true} rows=${2} value=${o.note} placeholder="地址、收料窗口時間、注意事項…" disabled=${ro} onChange=${v => u('note', v)} />
      </section>
      <div class="muted mt12" style="font-size:11px">建立 ${util.fmtDateTime(o.created_at)} · 更新 ${util.fmtDateTime(o.updated_at)} · 所有專案共用</div>
    </div>`;
  }

  async function removeOrg(o) {
    const ok = await confirm({ title: '刪除聯絡單位', danger: true, okText: '刪除',
      message: '刪除「' + (o.name || '(未命名)') + '」與它的 ' + o.people.length + ' 位聯絡人？\n所有專案共用這份資料；已產生的備料郵件紀錄不受影響。' });
    if (!ok) return false;
    A().deleteContact(o.id);
    return true;
  }

  function OrgDrawer(props) {
    const st = TIM.store;
    const o = st.db.contacts[props.id];
    const live = useRef(props);
    live.current = props;
    useLayoutEffect(() => {
      const on = e => { if (e.key === 'Escape' && !document.querySelector('.modal-backdrop, .menu, .popover')) { const a = document.activeElement; if (a && a.blur) a.blur(); live.current.onClose(); } };
      window.addEventListener('keydown', on);
      return () => window.removeEventListener('keydown', on);
    }, []);
    return html`<aside class="drawer" role="dialog" aria-label=${o ? o.name : '聯絡單位'}>
      <div class="drawer-head">
        <h2>${o ? o.name || '(未命名)' : '找不到聯絡單位'}</h2>
        ${o ? html`<span class=${cx('tag', o.kind === 'factory' ? 'tag-info' : 'tag-mute')}>${KIND_LABEL[o.kind]}</span>` : null}
        ${o && o.is_default ? html`<span class="tag tag-ok"><${Icon} name="star" size=${11} /> 預設工廠</span>` : null}
        <div class="right">
          ${o ? html`<button class="icon-btn danger rw-only" title="刪除聯絡單位" onClick=${async () => { if (await removeOrg(o)) props.onClose(); }}><${Icon} name="trash" /></button>` : null}
          <button class="icon-btn" title="關閉 (Esc)" onClick=${props.onClose}><${Icon} name="x" /></button>
        </div>
      </div>
      <div class="drawer-body">${o ? html`<${OrgEditor} id=${o.id} />` : null}</div>
    </aside>`;
  }

  /** Edit an organisation in a dialog (from 備料, without leaving the project). */
  function openOrgEditor(id) {
    TIM.ui.openModal(close => html`<${OrgDialog} id=${id} close=${close} />`);
  }
  function OrgDialog(props) {
    TIM.ui.useStore();
    const o = TIM.store.db.contacts[props.id];
    return html`<${TIM.ui.Modal} title=${(o && o.kind === 'factory' ? '工廠' : '供應商') + '聯絡人'} size="mid" onClose=${() => props.close()} onEnter=${() => props.close()}
      footer=${html`<span class="left">所有專案共用；也可以在上方「聯絡人」頁管理</span><button class="btn btn-primary" data-enter-ok="1" onClick=${() => props.close()}>完成</button>`}>
      <${OrgEditor} id=${props.id} autofocus=${!(o && o.name)} />
    </${TIM.ui.Modal}>`;
  }

  function OrgTable(props) {
    const { list, kind, sel } = props;
    if (!list.length) return html`<div class="empty compact"><p>${kind === 'factory' ? '還沒有工廠：有 Delta 料號的品項備料時寄給工廠。' : '還沒有供應商：沒有料號的品項依廠牌寄給供應商。'}</p></div>`;
    const names = (o, role) => o.people.filter(p => p.role === role).map(p => p.name || p.email).filter(Boolean).join('、');
    return html`<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${kind === 'factory' ? '工廠' : '供應商'}</th>${kind === 'supplier' ? html`<th>代理廠牌</th>` : null}<th>收件者</th><th>副本</th><th>PM</th><th class="r">Email 數</th></tr></thead>
      <tbody>${list.map(o => {
        const noMail = !o.people.some(p => /@/.test(p.email || ''));
        return html`<tr key=${o.id} class=${cx('clickable', sel === o.id && 'sel')} onClick=${() => go('contacts/' + o.id)}>
          <td><b>${o.name || html`<span class="muted">(未命名)</span>`}</b>${o.is_default ? html` <span class="tag tag-ok" title="有 Delta 料號的品項預設寄給這裡"><${Icon} name="star" size=${11} /> 預設</span>` : null}</td>
          ${kind === 'supplier' ? html`<td>${o.brands.length ? o.brands.join('、') : html`<span class="muted">—</span>`}</td>` : null}
          <td>${names(o, 'to') || html`<span class="muted">—</span>`}</td>
          <td>${names(o, 'cc') || html`<span class="muted">—</span>`}</td>
          <td>${names(o, 'pm') || html`<span class="muted">—</span>`}</td>
          <td class="r">${noMail ? html`<span class="tag tag-warn">沒有 Email</span>` : o.people.filter(p => /@/.test(p.email || '')).length}</td>
        </tr>`;
      })}</tbody>
    </table></div>`;
  }

  function Contacts(props) {
    const st = TIM.store;
    const db = st.db;
    const all = Object.values(db.contacts);
    const by = kind => TIM.prep.orgsOf(db, kind);
    const add = kind => {
      const id = A().createContact({ kind, is_default: kind === 'factory' && !all.some(o => o.kind === 'factory') });
      go('contacts/' + id);
    };
    return html`<div class="page"><div class="page-inner">
      <div class="home-head">
        <div><div class="eyebrow">Contacts · ${all.length}</div><h1>聯絡人</h1></div>
        <div class="home-actions">
          <button class="btn btn-ghost btn-sm btn-icon rw-only" title="復原 (Ctrl+Z)" disabled=${!st.canUndo('ct')} onClick=${() => st.undo('ct')}><${Icon} name="undo" /></button>
          <button class="btn btn-ghost btn-sm btn-icon rw-only" title="重做 (Ctrl+Shift+Z)" disabled=${!st.canRedo('ct')} onClick=${() => st.redo('ct')}><${Icon} name="redo" /></button>
          <button class="btn btn-secondary rw-only" onClick=${() => add('factory')}><${Icon} name="plus" /> 新增工廠</button>
          <button class="btn btn-primary rw-only" onClick=${() => add('supplier')}><${Icon} name="plus" /> 新增供應商</button>
        </div>
      </div>
      <p class="muted" style="margin:-8px 0 16px;max-width:780px;line-height:1.6">所有專案共用。備料時：有 Delta 料號的品項寄給<b>預設工廠</b>，其他品項依 Vendor 寄給<b>代理那個廠牌的供應商</b>；聯絡人的角色就是郵件預設的收件者 / 副本。</p>
      <div class="section"><div class="section-head"><span class="section-title">工廠</span><span class="section-sub">${by('factory').length} 個</span></div>
        <${OrgTable} list=${by('factory')} kind="factory" sel=${props.route.org} /></div>
      <div class="section"><div class="section-head"><span class="section-title">供應商</span><span class="section-sub">${by('supplier').length} 個</span></div>
        <${OrgTable} list=${by('supplier')} kind="supplier" sel=${props.route.org} /></div>
      ${props.route.org ? html`<${OrgDrawer} id=${props.route.org} onClose=${() => go('contacts')} />` : null}
    </div></div>`;
  }

  Object.assign(TIM.ui, { Contacts, OrgEditor, openOrgEditor, knownBrands });
})();
