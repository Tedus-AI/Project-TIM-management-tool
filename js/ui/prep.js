/* 備料 tab: 備料單 records of the project; items from the TIM list (one set = one unit), sets, purpose, need date,
 * and one Outlook email per organisation (factory / suppliers from 聯絡人). Logic in core/prep.js, files in io/prep-export.js. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useMemo, Icon, cx, go, Modal, openModal, openPopover, openMenu, confirm, toast, usePeople } = TIM.ui;
  const { util, schema } = TIM;
  const P = TIM.prep;
  const A = () => TIM.actions;
  const SET_CHIPS = [1, 2, 3, 5, 10, 20];
  const SKIP_COLS = ['status'];                       // TIM-list columns not offered (status is a TIM-list matter)

  // ───────── columns: 'loc' / 'no' + TIM-list columns (basic, supply, trace) ─────────
  let defsCache = null;
  function colDefs() {
    if (!defsCache) {
      const list = TIM.ui.bomInternals.buildColumns({ supply: true, trace: true }).filter(c => !SKIP_COLS.includes(c.key));
      defsCache = { list, byKey: list.reduce((o, c) => { o[c.key] = c; return o; }, {}) };
    }
    return defsCache;
  }
  const canonical = () => ['loc', 'no'].concat(colDefs().list.map(c => c.key));
  const colLabel = k => { const c = colDefs().byKey[k]; return P.labelOf(k, c ? c.label + (c.sub ? ' (' + c.sub + ')' : '') : k); };
  const labelMap = () => colDefs().list.reduce((o, c) => { o[c.key] = colLabel(c.key); return o; }, {});
  function cellOf(db) {
    const B = TIM.ui.bomInternals;
    const memo = new Map();
    return (k, line) => {
      const c = colDefs().byKey[k];
      if (!c) return '';
      let ctx = memo.get(line.it.id);
      if (!ctx) { ctx = B.rowCtx(line.it, db, 5); memo.set(line.it.id, ctx); }
      return B.cellText(c, line.it, ctx);
    };
  }

  // ───────── people ─────────
  function sender() {
    const acc = TIM.spBackend && TIM.spBackend.account();
    return (acc && acc.name) || TIM.store.user() || '';
  }
  /** Our colleagues CC'd by default: the project's TH owner from Project_Members (not the ME owner), not the sender. */
  function oursOf(p, members) {
    const acc = TIM.spBackend && TIM.spBackend.account();
    const me = acc && acc.email ? acc.email.toLowerCase() : '';
    return [p.owner].map(n => (members || []).find(m => n && m.name === n)).filter(m => m && m.email && m.email.toLowerCase() !== me)
      .map(m => ({ name: m.name, email: m.email }));
  }

  /** Everything the tab needs for one 備料單 (recomputed per render; lists are small). */
  function model(p, pr, members) {
    const db = TIM.store.db;
    const settings = db.settings;
    const cols = P.colsOf(pr, settings);
    const groups = P.groups(p, db, pr);
    const ours = oursOf(p, members);
    const known = (members || []).filter(m => m.email).map(m => ({ name: m.name, email: m.email }));
    const cells = cellOf(db);
    const labels = labelMap();
    const recipOf = g => P.recipients(g.org, pr, ours, known);
    const compose = g => P.compose({ project: p, prep: pr, group: g, table: P.table(g, cols, cells, labels), recips: recipOf(g), settings, today: new Date(), sender: sender() });
    return { db, settings, cols, groups, ours, known, cells, labels, recipOf, compose };
  }

  const shortTime = iso => { const d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const lastMail = (pr, key) => pr.mailed.filter(m => m.key === key).slice(-1)[0] || null;

  // ───────── output ─────────
  async function generate(p, pr, mails) {
    if (!mails.length) return;
    try {
      for (let i = 0; i < mails.length; i++) {
        await TIM.prepExport.downloadEml(mails[i]);
        if (i < mails.length - 1) await new Promise(r => setTimeout(r, 450));
      }
    } catch (e) {
      console.error(e);
      toast('產生郵件失敗：' + (e.message || e), 'err');
      return;
    }
    A().markPrepMailed(p.id, pr.id, mails);
    toast('已產生 ' + mails.length + ' 封郵件（.eml）：用 Outlook 開啟，確認後按「傳送」。想按一下就直接開啟：在瀏覽器下載清單對 .eml 按右鍵 →「一律開啟這類檔案」（設定一次即可）', 'ok', { timeout: 9000 });
  }
  async function run(fn, m, what) {
    try { await fn(m); if (what) toast(what, 'ok'); } catch (e) { console.error(e); toast('失敗：' + (e.message || e), 'err'); }
  }
  function moreMenu(e, m, extra) {
    openMenu(e, [
      { label: '下載 Excel 備料清單', icon: 'excel', onClick: () => run(TIM.prepExport.downloadXlsx, m) },
      { label: '用預設郵件程式開啟（純文字、無附件）', icon: 'mail', onClick: () => TIM.prepExport.openMailto(m) },
      { label: '複製郵件內容（含表格）', icon: 'copy', onClick: () => run(TIM.prepExport.copyBody, m, '已複製郵件內容，可貼到任何郵件程式') },
    ].concat(extra || []));
  }

  function PreviewModal(props) {
    const m = props.m;
    return html`<${Modal} title=${'預覽郵件 · ' + m.org} size="wide" onClose=${() => props.close()}
      footer=${html`<span class="left">實際在 Outlook 開啟後，按「傳送」前都可以再修改</span>
        <button class="btn btn-ghost" onClick=${() => run(TIM.prepExport.downloadXlsx, m)}><${Icon} name="excel" /> 下載 Excel</button>
        ${props.onSend ? html`<button class="btn btn-primary" data-enter-ok="1" onClick=${() => { props.close(); props.onSend(); }}><${Icon} name="mail" /> 產生郵件</button>` : null}`}>
      <div class="mail-head">
        <div><b>收件者</b><span>${m.to.map(x => x.name ? x.name + ' <' + x.email + '>' : x.email).join('; ') || html`<span class="text-warn">（沒有收件者）</span>`}</span></div>
        <div><b>副本</b><span>${m.cc.map(x => x.name ? x.name + ' <' + x.email + '>' : x.email).join('; ') || '—'}</span></div>
        <div><b>主旨</b><span>${m.subject}</span></div>
        <div><b>附件</b><span class="mono"><${Icon} name="excel" size=${12} /> ${m.file}</span></div>
      </div>
      <iframe class="mail-frame" title="郵件內容" sandbox="" srcdoc=${P.bodyHtml(m)}></iframe>
    </${Modal}>`;
  }
  const preview = (m, onSend) => openModal(close => html`<${PreviewModal} m=${m} onSend=${onSend} close=${close} />`);

  // ───────── columns popover (reads the store each render, so it stays live) ─────────
  function ColPop(props) {
    const st = TIM.store;
    const p = st.db.projects[props.pid];
    const pr = p && p.preps.find(x => x.id === props.prepId);
    if (!pr) return null;
    const cols = P.colsOf(pr, st.db.settings);
    const order = canonical();
    const toggle = k => {
      const next = cols.includes(k) ? cols.filter(x => x !== k) : order.filter(x => x === k || cols.includes(x));
      A().updatePrep(p.id, pr.id, { cols: next });
    };
    const box = k => html`<label class="check" key=${k}><input type="checkbox" checked=${cols.includes(k)} disabled=${P.FIXED_COLS.includes(k) || props.locked} onChange=${() => toggle(k)} /> ${colLabel(k)}</label>`;
    const others = order.filter(k => !P.DEFAULT_COLS.includes(k));
    return html`<div class="col-pop">
      <div class="lbl">預設欄位</div>${P.DEFAULT_COLS.map(box)}
      <div class="lbl">TIM 清單其他欄位</div>${others.map(box)}
      <div class="foot">郵件表格與 Excel 照這裡輸出，最後一欄固定是「總數量」。</div>
      <div class="row wrap" style="gap:6px;margin-top:8px">
        <button class="btn btn-ghost btn-xs" disabled=${props.locked || !pr.cols} onClick=${() => A().updatePrep(p.id, pr.id, { cols: null })}>還原預設</button>
        <button class="btn btn-secondary btn-xs" disabled=${st.readonly} title="之後新的備料單（所有專案）預設用這些欄位" onClick=${() => { A().updateSettings({ prep_cols: cols.slice() }); toast('已設為所有專案的備料預設欄位', 'ok'); }}>設為所有專案的預設</button>
      </div>
    </div>`;
  }

  // ───────── per-item target: factory / the brand's suppliers / other suppliers ─────────
  function TargetSelect(props) {
    const { p, pr, it, t, db } = props;
    const factories = P.orgsOf(db, 'factory');
    const own = P.suppliersFor(db, t.vendor);
    const others = P.orgsOf(db, 'supplier').filter(o => !own.includes(o));
    const name = o => o.name || '(未命名)';
    const autoKey = t.auto ? t.auto.id : '';
    const isAuto = !t.explicit && !(pr.lines[it.id] || {}).src && (t.org || null) === (t.auto || null);
    const value = t.org ? t.org.id : '';
    const pick = id => {
      if (!id) return;
      const org = db.contacts[id];
      // the automatic choice again → forget the choice (follows the Delta P/N / brand from now on)
      if (id === autoKey && P.autoSource(it) === org.kind) A().setPrepLine(p.id, pr.id, it.id, { org: '', src: '' });
      else A().setPrepLine(p.id, pr.id, it.id, { org: id, src: org.kind });
    };
    const opt = o => html`<option value=${o.id}>${name(o)}${o.id === autoKey ? '（自動）' : ''}</option>`;
    return html`<span class="tgt">
      <select class=${cx('sel sel-sm tgt-sel', t.src === 'factory' ? 'f' : 's', !t.org && 'none')} value=${value} disabled=${props.disabled}
        aria-label=${'對象 ' + it.item_no} onChange=${e => pick(e.target.value)}>
        ${!t.org ? html`<option value="">${t.src === 'factory' ? '（還沒有工廠聯絡人）' : '（' + (t.vendor || '沒有 Vendor') + ' 沒有供應商）'}</option>` : null}
        ${factories.length ? html`<optgroup label="工廠">${factories.map(opt)}</optgroup>` : null}
        ${own.length ? html`<optgroup label=${'供應商（代理 ' + t.vendor + '）'}>${own.map(opt)}</optgroup>` : null}
        ${others.length ? html`<optgroup label=${own.length ? '其他供應商' : '供應商'}>${others.map(opt)}</optgroup>` : null}
      </select>${isAuto ? html`<span class="auto">自動</span>` : null}</span>`;
  }

  // ───────── one email group ─────────
  function GroupCard(props) {
    const { p, pr, g, md, locked } = props;
    const ro = TIM.store.readonly;
    const items = g.lines.map(l => l.it.item_no || '?').join('、');
    const missing = g.lines.filter(l => l.total == null).map(l => l.it.item_no || '?');
    if (!g.org) {
      const isF = g.kind === 'factory';
      const suppliers = P.orgsOf(md.db, 'supplier');
      const addOrg = () => {
        const id = A().createContact(isF ? { kind: 'factory', is_default: true } : { kind: 'supplier', name: g.vendor, brands: g.vendor ? [g.vendor] : [] });
        TIM.ui.openOrgEditor(id);
      };
      return html`<div class="grp grp-x">
        <span class="kind x">未設定</span>
        <div class="who">
          <b>${isF ? '還沒有工廠聯絡人' : (g.vendor || '(沒有 Vendor)') + ' 還沒有供應商聯絡人'}</b>
          <div class="ppl muted">${items} 暫不產生郵件</div>
        </div>
        <div class="acts">
          ${!isF && g.vendor && suppliers.length ? html`<select class="sel sel-sm" value="" disabled=${ro} title=${'把 ' + g.vendor + ' 加到這家供應商的代理廠牌（所有專案適用）'}
            onChange=${e => { const id = e.target.value; e.target.value = ''; if (id) { A().addContactBrand(id, g.vendor); toast(g.vendor + ' 已加到「' + md.db.contacts[id].name + '」的代理廠牌', 'ok'); } }}>
            <option value="">加到既有供應商…</option>${suppliers.map(o => html`<option value=${o.id}>${o.name || '(未命名)'}</option>`)}</select>` : null}
          <button class="btn btn-secondary btn-sm rw-only" onClick=${addOrg}><${Icon} name="plus" /> ${isF ? '新增工廠' : '新增 ' + (g.vendor || '供應商') + ' 聯絡人'}</button>
        </div>
      </div>`;
    }
    const rec = md.recipOf(g);
    const oursDefault = new Set(md.ours.map(x => x.email.toLowerCase()));
    const shown = rec.people.filter(x => x.from === 'org' || x.role || oursDefault.has(x.email.toLowerCase()));
    const addable = rec.people.filter(x => !shown.includes(x));
    const setRole = (email, role) => {
      const list = rec.people.map(x => ({ email: x.email, role: x.email === email ? role : x.role }));
      const pick = Object.assign({}, pr.pick, { [g.org.id]: { to: list.filter(x => x.role === 'to').map(x => x.email), cc: list.filter(x => x.role === 'cc').map(x => x.email) } });
      A().updatePrep(p.id, pr.id, { pick });
    };
    const cycle = x => setRole(x.email, x.role === 'to' ? 'cc' : x.role === 'cc' ? '' : 'to');
    const sent = lastMail(pr, g.key);
    const m = md.compose(g);
    const ready = rec.to.length > 0;
    const canGen = ready && !(locked && sent);           // a locked 備料單: only the emails not made yet
    const options = g.options || [];
    return html`<div class=${cx('grp', !ready && 'grp-warn')}>
      <span class=${cx('kind', g.kind === 'factory' ? 'f' : 's')}>${g.kind === 'factory' ? '工廠' : '供應商'}</span>
      <div class="who">
        <div class="who-line">
          ${options.length > 1 && !locked ? html`<select class="sel sel-sm org-sel" value=${g.org.id} title="改寄給另一個${g.kind === 'factory' ? '工廠' : '供應商'}（只影響這張備料單）"
            onChange=${e => A().updatePrep(p.id, pr.id, P.rerouteGroup(pr, g, e.target.value))}>
            ${options.map(o => html`<option value=${o.id}>${o.name || '(未命名)'}</option>`)}</select>`
            : html`<b>${g.org.name || '(未命名)'}</b>`}
          <span class="pill">${g.lines.length} 項：${items}</span>
          ${sent ? html`<span class="tag tag-ok" title=${'由 ' + (sent.by || '') + ' 產生'}><${Icon} name="check" size=${11} /> 已產生 ${shortTime(sent.at)}</span>` : null}
        </div>
        <div class="ppl">
          ${shown.map(x => html`<button type="button" key=${x.email} class=${cx('person', x.role || 'none')} disabled=${locked}
              title=${x.email + (x.pm ? '\nPM（預設不寄）' : '') + '\n點一下切換：收件者 → 副本 → 不寄'} onClick=${() => cycle(x)}>
            ${x.name || x.email}${x.pm ? html` <b class="pm-tag">PM</b>` : null} <i>${x.role === 'to' ? '收件者' : x.role === 'cc' ? '副本' : '不寄'}</i></button>`)}
          ${addable.length && !locked ? html`<select class="sel sel-sm add-person" value="" onChange=${e => { const v = e.target.value; e.target.value = ''; if (v) setRole(v, 'cc'); }}>
            <option value="">＋ 副本給同事…</option>${addable.map(x => html`<option value=${x.email}>${x.name + ' <' + x.email + '>'}</option>`)}</select>` : null}
        </div>
        ${!ready ? html`<div class="grp-note text-warn"><${Icon} name="warn" size=${12} /> 沒有收件者：${rec.people.some(x => x.from === 'org') ? '點聯絡人設為「收件者」' : '這個' + (g.kind === 'factory' ? '工廠' : '供應商') + '還沒有聯絡人 Email'}
          <button class="btn btn-ghost btn-xs" onClick=${() => TIM.ui.openOrgEditor(g.org.id)}>編輯聯絡人</button></div>` : null}
        ${missing.length ? html`<div class="grp-note text-warn"><${Icon} name="warn" size=${12} /> ${missing.join('、')} 在 TIM 清單沒有數量（Q'ty / 點膠量），郵件中總數量會是空的</div>` : null}
      </div>
      <div class="acts">
        <button class="btn btn-ghost btn-sm" onClick=${() => preview(locked && sent ? sent : m, canGen ? () => generate(p, pr, [m]) : null)}><${Icon} name="eye" /> 預覽</button>
        ${locked && sent ? html`<button class="btn btn-secondary btn-sm" title="下載當時產生的郵件" onClick=${() => run(TIM.prepExport.downloadEml, sent)}><${Icon} name="download" /> 下載郵件</button>`
          : html`<button class="btn btn-primary btn-sm" disabled=${!canGen} title=${ready ? '下載這封的 Outlook 郵件（.eml）' : '沒有收件者'} onClick=${() => generate(p, pr, [m])}><${Icon} name="mail" /> ${sent ? '重新產生' : '產生郵件'}</button>`}
        <button class="btn btn-ghost btn-sm btn-icon" title="其他方式" onClick=${e => moreMenu(e, m, ['sep', { label: '編輯聯絡人…', icon: 'contacts', onClick: () => TIM.ui.openOrgEditor(g.org.id) }])}><${Icon} name="more" /></button>
      </div>
    </div>`;
  }

  // ───────── one 備料單 ─────────
  function PrepEditor(props) {
    const { p, pr, members } = props;
    const st = TIM.store;
    const ro = st.readonly;
    const locked = ro || pr.status === 'mailed';
    const [filter, setFilter] = useState('all');
    const md = model(p, pr, members);
    const all = P.itemsOf(p);
    const locs = p.locations.reduce((o, l) => { o[l.id] = l; return o; }, {});
    const up = (patch, co) => A().updatePrep(p.id, pr.id, patch, co);
    const src = it => P.sourceOf(pr, it);
    const counts = { all: all.length, factory: all.filter(it => src(it) === 'factory').length, supplier: all.filter(it => src(it) === 'supplier').length };
    const rows = all.filter(it => filter === 'all' || src(it) === filter);
    const onCount = all.filter(it => P.isOn(pr, it)).length;
    const allOn = all.length > 0 && all.every(it => P.isOn(pr, it));
    const totals = {};
    md.groups.forEach(g => g.lines.forEach(l => { totals[l.it.id] = { l }; }));
    let n = 0;
    all.forEach(it => { if (totals[it.id]) totals[it.id].i = n++; });      // # in the grid: running number of the selected items
    const ready = md.groups.filter(g => g.org && md.recipOf(g).to.length && !(locked && lastMail(pr, g.key)));
    const unset = md.groups.filter(g => !g.org);
    const today = new Date();
    const need = pr.need || {};
    const isoToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const purposes = (md.settings.prep_purposes || []).concat(pr.purpose && !(md.settings.prep_purposes || []).includes(pr.purpose) ? [pr.purpose] : []);
    const cellText = (k, it) => {
      const hit = totals[it.id];
      const line = hit ? hit.l : { it, loc: locs[it.location_id], per: P.perSet(it, TIM.calc.materialOf(md.db, it)) };
      if (k === 'no') return hit ? String(hit.i + 1) : '–';
      if (k === 'loc') return line.loc ? line.loc.name : '';
      if (k === 'qty') return P.qtyText(line.per.v, line.per.unit);
      return md.cells(k, line);
    };
    const del = async () => {
      if (!await confirm({ title: '刪除備料單', danger: true, okText: '刪除', message: '刪除備料單 ' + pr.no + '？' + (pr.mailed.length ? '\n它的郵件紀錄（' + pr.mailed.length + ' 封）也會一起刪除；已寄出的郵件不受影響。' : '') })) return;
      A().deletePrep(p.id, pr.id);
      go('p/' + p.id + '/prep', true);
    };
    const dup = () => { const id = A().duplicatePrep(p.id, pr.id); if (id) go('p/' + p.id + '/prep/' + id); };

    return html`<div class="prep-main">
      <div class="prep-title">
        <h2 class="mono">${pr.no}</h2>
        <span class=${cx('tag', pr.status === 'mailed' ? 'tag-ok' : 'tag-mute')}>${pr.status === 'mailed' ? '已產生郵件' : '草稿'}</span>
        <span class="muted" style="font-size:11.5px">建立 ${util.fmtDateTime(pr.created_at)}${pr.created_by ? ' · ' + pr.created_by : ''}</span>
        <div class="right">
          <button class="btn btn-ghost btn-sm rw-only" onClick=${dup}><${Icon} name="copy" /> 複製成新備料單</button>
          <button class="btn btn-ghost btn-sm btn-icon rw-only" title="刪除備料單" onClick=${del}><${Icon} name="trash" /></button>
        </div>
      </div>
      ${pr.status === 'mailed' ? html`<div class="prep-lock"><${Icon} name="lock" size=${14} />
        <span>已產生郵件（${shortTime(pr.mailed.length ? pr.mailed[pr.mailed.length - 1].at : pr.updated_at)}）：內容已鎖定，寄出的內容記在最下方。</span>
        <button class="btn btn-secondary btn-sm rw-only" onClick=${() => A().reopenPrep(p.id, pr.id)}>重新編輯</button></div>` : null}

      <section class="card prep-card">
        <div class="card-head"><span class="step-no">1</span><h3>品項</h3>
          <span class="muted">從 TIM 清單帶入 ${all.length} 項 · 已選 ${onCount} 項</span>
          <div class="right">
            <div class="seg seg-sm">${[['all', '全部'], ['factory', '工廠'], ['supplier', '供應商']].map(([v, l]) => html`<button type="button" class=${filter === v ? 'on' : ''} onClick=${() => setFilter(v)}>${l} ${counts[v]}</button>`)}</div>
            <button class="btn btn-ghost btn-sm" onClick=${e => openPopover(e.currentTarget, html`<${ColPop} pid=${p.id} prepId=${pr.id} locked=${locked} />`)}>欄位 <${Icon} name="chevD" size=${12} /></button>
          </div>
        </div>
        ${all.length ? html`<div class="tbl-wrap prep-grid-wrap"><table class="tbl prep-grid">
          <thead><tr>
            <th class="c"><input type="checkbox" aria-label="全選" checked=${allOn} disabled=${locked} onChange=${() => A().setPrepLine(p.id, pr.id, all.map(it => it.id), { off: allOn })} /></th>
            ${md.cols.map(k => html`<th class=${P.isNum(k) ? 'r' : ''}>${colLabel(k)}</th>`)}
            <th class="r">${P.TOTAL_LABEL}</th><th>對象</th>
          </tr></thead>
          <tbody>${rows.map(it => {
            const on = P.isOn(pr, it);
            const hit = totals[it.id];
            const t = P.targetOf(md.db, pr, it, TIM.calc.materialOf(md.db, it));
            return html`<tr key=${it.id} class=${cx(!on && 'off')}>
              <td class="c"><input type="checkbox" aria-label=${'備料 ' + it.item_no} checked=${on} disabled=${locked} onChange=${() => A().setPrepLine(p.id, pr.id, it.id, { off: on })} /></td>
              ${md.cols.map(k => html`<td class=${cx(P.isNum(k) && 'r', (k === 'delta_pn' || k === 'vendor_pn' || k === 'item_no') && 'mono')}>${cellText(k, it)}</td>`)}
              <td class="r tot">${on && hit ? (hit.l.total == null ? html`<span class="tag tag-warn">缺數量</span>` : P.qtyText(hit.l.total, hit.l.per.unit)) : ''}</td>
              <td class="tgt-cell"><${TargetSelect} p=${p} pr=${pr} it=${it} t=${t} db=${md.db} disabled=${locked} /></td>
            </tr>`;
          })}</tbody>
        </table></div>` : html`<div class="empty compact"><p>TIM 清單還沒有 Item：先到「TIM 清單」建立，這裡就會帶入。</p></div>`}
        <div class="hint">每套 Q'ty 來自 TIM 清單（1 套 = 1 台設備的用量）；點膠類以 g / cc 計（點膠量 × Q'ty）。對象預設（標「自動」）：有 Delta 料號 → 工廠，沒有 → 依 Vendor 找代理的供應商；
          工廠沒庫存、或同一廠牌要分給不同供應商時，在「對象」直接選，每個對象各一封郵件。</div>
      </section>

      <div class="prep-row2">
        <section class="card prep-card">
          <div class="card-head"><span class="step-no">2</span><h3>套數與用途</h3></div>
          <div class="lbl">需要幾套 <span class="muted">清單 = 1 台設備的一套用量</span></div>
          <div class="sets">
            <div class="stepper">
              <button type="button" disabled=${locked || pr.sets <= 1} onClick=${() => up({ sets: pr.sets - 1 }, 'sets')}>−</button>
              <input class="inp num" inputmode="numeric" aria-label="套數" value=${pr.sets} disabled=${locked}
                onChange=${e => { const n = parseInt(util.toHalfWidth(e.target.value), 10); if (n > 0) up({ sets: Math.min(n, 9999) }); else e.target.value = pr.sets; }} />
              <button type="button" disabled=${locked} onClick=${() => up({ sets: pr.sets + 1 }, 'sets')}>＋</button>
            </div>
            <div class="chips">${SET_CHIPS.map(v => html`<button type="button" class=${cx('chip', pr.sets === v && 'on')} disabled=${locked} onClick=${() => up({ sets: v })}>${v} 套</button>`)}</div>
          </div>
          <div class="lbl mt12">用途 <span class="muted">選項在「設定」增減</span></div>
          <div class="chips">${purposes.map(v => html`<button type="button" class=${cx('chip', pr.purpose === v && 'on')} disabled=${locked} onClick=${() => up({ purpose: pr.purpose === v ? '' : v })}>${v}</button>`)}</div>
        </section>
        <section class="card prep-card">
          <div class="card-head"><span class="step-no">3</span><h3>需求日期</h3></div>
          <div class="seg">${schema.PREP_NEED_MODES.map(o => html`<button type="button" class=${need.mode === o.v ? 'on' : ''} disabled=${locked} onClick=${() => up({ need: Object.assign({}, need, { mode: o.v }) })}>${o.label}</button>`)}</div>
          <div class="need-sub">
            ${need.mode === 'date' ? html`<input class="inp need-date" type="date" aria-label="需求日期" value=${need.date || ''} min=${isoToday} disabled=${locked} onChange=${e => up({ need: Object.assign({}, need, { date: e.target.value }) })} />` : null}
            ${need.mode === 'days' ? html`<div class="chips">${schema.PREP_DAYS.map(v => html`<button type="button" class=${cx('chip', need.days === v && 'on')} disabled=${locked} onClick=${() => up({ need: Object.assign({}, need, { days: v }) })}>${v} 天</button>`)}</div>` : null}
            ${need.mode === 'asap' ? html`<div class="hint" style="margin:0">主旨會加註「（急件）」。</div>` : null}
            ${need.mode === 'proc' ? html`<div class="hint" style="margin:0">說法可在「設定」修改。</div>` : null}
          </div>
          <div><span class=${cx('computed', need.mode === 'date' && !need.date && 'empty')}>郵件寫：${P.needText(need, md.settings, today) || '（請選日期）'}</span></div>
        </section>
      </div>

      <section class="card prep-card">
        <div class="card-head"><span class="step-no">4</span><h3>對象與郵件</h3>
          <span class="muted">每個對象一封；收件者 / 副本依聯絡人預選，點人名可切換</span>
          <div class="right">
            <button class="btn btn-primary" disabled=${!ready.length} onClick=${() => generate(p, pr, ready.map(md.compose))}><${Icon} name="mail" /> ${ready.length ? '產生 ' + ready.length + ' 封 Outlook 郵件' : '產生 Outlook 郵件'}</button>
          </div>
        </div>
        ${md.groups.length ? md.groups.map(g => html`<${GroupCard} key=${g.key} p=${p} pr=${pr} g=${g} md=${md} locked=${locked} />`)
          : html`<div class="hint">沒有勾選任何品項。</div>`}
        ${unset.length ? html`<div class="hint text-warn">${unset.length} 組還沒有對象，設定好就會出現在上面。</div>` : null}
        <details class="howto">
          <summary>郵件怎麼開啟？</summary>
          <div>按「產生郵件」會下載 <b>.eml</b> 郵件檔：用 Outlook（傳統版）開啟就是一封寫好的新郵件（收件者、主旨、表格、Excel 附件都在），確認後按「傳送」。
            <br/>Chrome 小技巧：在下載清單對 .eml 檔按右鍵 →「一律開啟這類檔案」，之後產生郵件就會直接開啟 Outlook。
            <br/>新版 Outlook / 網頁版若無法開啟 .eml：用 ⋯ 裡的「用預設郵件程式開啟」帶入收件者與主旨，再「複製郵件內容」貼上，並手動附加「下載 Excel」的檔案。</div>
        </details>
      </section>

      ${pr.mailed.length ? html`<section class="card prep-card">
        <div class="card-head"><h3>已產生的郵件</h3><span class="muted">保留產生當時的內容，可重新下載</span></div>
        <div class="tbl-wrap"><table class="tbl">
          <thead><tr><th>時間</th><th>對象</th><th>收件者</th><th>主旨</th><th class="r">品項</th><th></th></tr></thead>
          <tbody>${pr.mailed.slice().reverse().map(m => html`<tr key=${m.id}>
            <td class="mono" style="white-space:nowrap">${shortTime(m.at)}</td>
            <td><b>${m.org}</b></td>
            <td>${(m.to || []).map(x => x.name || x.email).join('、')}</td>
            <td>${m.subject}</td>
            <td class="r">${(m.rows || []).length}</td>
            <td class="r" style="white-space:nowrap">
              <button class="btn btn-ghost btn-xs" onClick=${() => preview(m)}>預覽</button>
              <button class="btn btn-ghost btn-xs" onClick=${() => run(TIM.prepExport.downloadEml, m)}>下載郵件</button>
              <button class="btn btn-ghost btn-xs btn-icon" title="其他方式" onClick=${e => moreMenu(e, m)}><${Icon} name="more" /></button>
            </td>
          </tr>`)}</tbody>
        </table></div>
      </section>` : null}
    </div>`;
  }

  // ───────── the tab ─────────
  function PrepTab(props) {
    const { p, route } = props;
    const st = TIM.store;
    const members = usePeople();
    const preps = (p.preps || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const pr = preps.find(x => x.id === route.sub) || preps[0] || null;
    const settings = st.db.settings;
    const today = useMemo(() => new Date(), [st.version]);
    const create = () => {
      const id = A().createPrep(p.id, { purpose: (settings.prep_purposes || [])[0] || '' });
      if (id) go('p/' + p.id + '/prep/' + id);
    };
    const meta = x => {
      if (x.status === 'mailed' && x.mailed.length) {
        const last = x.mailed[x.mailed.length - 1];
        const orgs = Array.from(new Set(x.mailed.filter(m => m.at === last.at).map(m => m.org)));
        return shortTime(last.at).split(' ')[0] + ' 寄給' + orgs.join('、');
      }
      return x.sets + ' 套 · ' + (P.needShort(x.need, settings, today) || '未定需求日期');
    };
    return html`<div class="prep">
      <aside class="prep-rail">
        <div class="prep-rail-head"><b>備料紀錄</b>
          <button class="btn btn-primary btn-sm rw-only" onClick=${create}><${Icon} name="plus" /> 新備料單</button></div>
        ${preps.map(x => html`<button type="button" key=${x.id} class=${cx('prep-rec', pr && x.id === pr.id && 'on')} onClick=${() => go('p/' + p.id + '/prep/' + x.id)}>
          <div class="t"><span class="mono">${x.no}</span><span class=${cx('tag', x.status === 'mailed' ? 'tag-ok' : 'tag-mute')}>${x.status === 'mailed' ? '已產生郵件' : '草稿'}</span></div>
          <div class="m">${meta(x)}</div>
        </button>`)}
        ${preps.length ? html`<div class="hint">已產生郵件的備料單保留當時的內容；按「複製成新備料單」可以再備一次。</div>` : null}
      </aside>
      ${pr ? html`<${PrepEditor} key=${pr.id} p=${p} pr=${pr} members=${members} />` : html`<div class="prep-main"><div class="empty">
        <h3>還沒有備料單</h3>
        <p>備料單從 TIM 清單帶入品項（1 套 = 1 台設備的用量），選套數、用途與需求日期後，依對象（工廠 / 供應商）各產生一封寫好的 Outlook 郵件，附 Excel 備料清單。工廠與供應商的聯絡人在上方「聯絡人」頁建立，所有專案共用。</p>
        <div class="actions rw-only"><button class="btn btn-primary" onClick=${create}><${Icon} name="plus" /> 建立第一張備料單</button>
          <button class="btn btn-secondary" onClick=${() => go('contacts')}><${Icon} name="contacts" /> 聯絡人</button></div>
      </div></div>`}
    </div>`;
  }

  TIM.ui.PrepTab = PrepTab;
})();
