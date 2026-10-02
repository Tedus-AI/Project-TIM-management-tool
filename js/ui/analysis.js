/* 間隙與熱檢核: compression range chart per item + TIM temperature-rise ranking. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useMemo, useState, Icon, cx, go, usePref, InfoDot } = TIM.ui;
  const { util, schema, calc } = TIM;

  const STATUS = {
    ok: { label: 'OK', icon: '✓', cls: 'tag-ok' },
    warn: { label: 'Warning', icon: '!', cls: 'tag-warn' },
    error: { label: 'Fail', icon: '✕', cls: 'tag-err' },
  };

  function RangeCell(props) {
    const { cc, hi } = props;
    const pct = v => util.clamp(v / hi * 100, 0, 100);
    const tip = 'min ' + util.fmt(cc.min, 1) + '% · nom ' + (cc.nom == null ? '—' : util.fmt(cc.nom, 1) + '%') + ' · max ' + util.fmt(cc.max, 1) + '%' +
      (cc.rec ? '\n最小壓縮 ' + cc.rec.min + '%' : '');
    return html`<div class="rangebar" title=${tip}>
      ${cc.rec && cc.rec.min != null ? html`<div class="rec rec-min" style=${{ left: pct(cc.rec.min) + '%', width: (100 - pct(cc.rec.min)) + '%' }}></div>` : null}
      <div class=${cx('span', cc.status !== 'ok' && cc.status)} style=${{ left: pct(Math.max(0, cc.min || 0)) + '%', width: Math.max(0.8, pct(cc.max || 0) - pct(Math.max(0, cc.min || 0))) + '%', borderRadius: '4px' }}></div>
      ${cc.nom != null ? html`<div class="nom" style=${{ left: pct(cc.nom) + '%' }}></div>` : null}
    </div>`;
  }

  function Analysis(props) {
    const p = props.p;
    const st = TIM.store;
    const db = st.db;
    const [sort, setSort] = usePref('an_sort', 'item');
    const dtWarn = db.settings.dt_warn || 10;

    const rows = useMemo(() => calc.orderedItems(p).filter(it => it.status !== 'obsolete').map(it => {
      const mat = calc.materialOf(db, it);
      return { it, mat, eff: calc.effective(it, mat), cc: calc.compressionCheck(it, mat, db.settings), th: calc.thermalEstimate(it, mat), loc: calc.locationOf(p, it) };
    }), [st.version, p.id]);

    const withComp = rows.filter(r => r.cc.status !== 'na');
    const missing = rows.filter(r => r.cc.status === 'na' && !schema.isDispense(r.eff.tim_type));
    const rank = { error: 0, warn: 1, ok: 2 };
    const sorted = withComp.slice().sort((a, b) =>
      sort === 'status' ? (rank[a.cc.status] - rank[b.cc.status]) || util.naturalCompare(a.it.item_no, b.it.item_no)
        : sort === 'min' ? a.cc.min - b.cc.min
          : sort === 'max' ? b.cc.max - a.cc.max
            : 0);
    const hi = Math.max(50, Math.ceil((Math.max.apply(null, withComp.map(r => r.cc.max).concat([0])) + 5) / 10) * 10);
    const counts = { ok: 0, warn: 0, error: 0 };
    withComp.forEach(r => { counts[r.cc.status]++; });

    const thermal = [];
    rows.forEach(r => r.th.rows.forEach(t => { if (t.dT != null) thermal.push(Object.assign({ item: r.it, k: r.th.k, t_c: r.th.t_c, t_src: r.th.t_src }, t)); }));
    thermal.sort((a, b) => b.dT - a.dT);
    const dtMax = thermal.length ? thermal[0].dT : 0;
    const noPower = rows.filter(r => !r.th.rows.some(t => t.power != null)).length;

    const th = (key, label, cls) => html`<th class=${cx('an-sortable', cls)} onClick=${() => setSort(key)}>${label}${sort === key ? ' ▾' : ''}</th>`;

    return html`<div class="page-inner">
      <div class="section">
        <div class="section-head">
          <div class="section-title">壓縮率與壓力檢核</div>
          <div class="section-sub">${withComp.length} 個 Item 有間隙資料 · ✓ ${counts.ok} · ! ${counts.warn} · ✕ ${counts.error}</div>
          <div class="right">
            <div class="legend">
              <span><i class="swatch" style="background:rgba(30,142,78,.18);box-shadow:inset 0 0 0 1px var(--ok)"></i>≥ 最小壓縮率</span>
              <span><i class="swatch" style="background:var(--d-500)"></i>min~max 壓縮率</span>
              <span><i class="swatch" style="background:var(--ink);width:3px"></i>nom</span>
            </div>
            <${InfoDot}><div class="formula">C = (T − g) / T × 100%<br/>C<sub>min</sub>：間隙最大時；C<sub>max</sub>：間隙最小時<br/>間隙：設計間距 ± 公差，加上元件高度公差（最壞情況），或手動輸入<br/>! Warning：C<sub>min</sub> 低於最小壓縮率（Item 手動 → 一般值 10%）、壓力 ≥ 耐壓的 ${db.settings.pressure_warn_pct || 80}%<br/>✕ Fail：最大間隙 ≥ T（未接觸）、壓力超過元件耐壓<br/>壓力：材料的壓力–壓縮曲線在 C<sub>max</sub> 的值</div></${InfoDot}>
          </div>
        </div>
        ${withComp.length ? html`<div class="tbl-wrap"><table class="tbl an-table">
          <thead><tr>
            ${th('item', 'Item')}<th>Location</th><th>材料</th><th class="r">T</th><th class="r">間隙 min / nom / max</th>
            <th class="r">最小 %</th>${th('min', 'C min', 'r')}${th('max', 'C max', 'r')}<th class="r">壓力 max psi</th>
            <th class="rangecell">0 ~ ${hi}%</th>${th('status', '判定')}
          </tr></thead>
          <tbody>${sorted.map(r => html`<tr key=${r.it.id} class="clickable" onClick=${() => go('p/' + p.id + '/bom/' + r.it.id)}>
            <td class="mono"><b>${r.it.item_no}</b></td><td>${r.loc ? r.loc.name : ''}</td>
            <td class="ellipsis" style="max-width:180px">${[r.eff.vendor, r.eff.model].filter(Boolean).join(' ')}</td>
            <td class="r mono">${util.fmt(r.it.size.t)}</td>
            <td class="r mono" title=${r.cc.gap.source === 'stack' ? '設計間距 ± 公差 + 元件高度公差' : '手動輸入'}>${[r.cc.gap.min, r.cc.gap.nom, r.cc.gap.max].map(v => (v == null ? '—' : util.fmt(v, 3))).join(' / ')}${r.cc.gap.source === 'stack' ? html` <span class="tag tag-mute" style="font-size:10px">設計間距</span>` : null}</td>
            <td class="r mono" title=${r.cc.rec ? { item: 'Item 手動', generic: '一般值' }[r.cc.rec.source] : ''}>${r.cc.rec ? r.cc.rec.min + (r.cc.rec.source === 'generic' ? '*' : '') : '—'}</td>
            <td class="r mono">${util.fmt(r.cc.min, 1)}</td><td class="r mono">${util.fmt(r.cc.max, 1)}</td>
            <td class="r mono">${r.cc.pressure ? (r.cc.pressure.beyond ? '> ' : '') + util.fmt(r.cc.pressure.psi, 1) : '—'}</td>
            <td class="rangecell"><${RangeCell} cc=${r.cc} hi=${hi} /></td>
            <td><span class=${'tag ' + STATUS[r.cc.status].cls} title=${r.cc.msgs.join('\n')}>${STATUS[r.cc.status].icon} ${STATUS[r.cc.status].label}</span></td>
          </tr>`)}</tbody>
        </table></div>
        <div class="muted" style="font-size:11px;margin-top:6px">* = 未手動設定最小壓縮率，使用一般值（經驗值 10%）。壓力需要材料庫的壓力–壓縮曲線。點擊列開啟 Item。</div>` : html`<div class="empty"><h3>還沒有可檢核的 Item</h3><p>在 Item 詳細的「機構間隙、壓縮與壓力」填入設計間距（凸台到元件頂面）與元件高度（或直接填間隙 min / nom / max），或在 TIM 清單開啟「機構」欄位直接輸入。</p></div>`}
        ${missing.length ? html`<div class="panel panel-pad mt12" style="font-size:12px">
          <b>缺間隙資料：</b> ${missing.map((r, i) => html`${i ? '、' : ''}<a href=${'#/p/' + p.id + '/bom/' + r.it.id}>${r.it.item_no || '(未編號)'}</a>`)}
        </div>` : null}
      </div>

      <div class="section">
        <div class="section-head">
          <div class="section-title">TIM 溫升估算排行</div>
          <div class="section-sub">每顆元件經過 TIM 的溫升 ΔT = P_TIM × R（P_TIM = 功耗 × 頂面 %）· 門檻 ${dtWarn} °C（可在設定修改）${noPower ? ' · ' + noPower + ' 個 Item 未填功耗' : ''}</div>
          <div class="right"><${InfoDot}><div class="formula">R = t<sub>c</sub>[mm] × 1000 / (k × A<sub>eff</sub>[mm²])，ΔT = P<sub>TIM</sub> × R<br/>P<sub>TIM</sub> = 單顆功耗 × 頂面散熱比例（空白 = 100%）<br/>t<sub>c</sub> = min(間隙 nom, T)（公差疊加時用各元件自己的間隙）；A<sub>eff</sub> = min(pad, 元件頂面)<br/>bulk k 估算，不含接觸 / 擴散熱阻，用於找出「TIM 本身是瓶頸」的位置。</div></${InfoDot}></div>
        </div>
        ${thermal.length ? html`<div class="tbl-wrap"><table class="tbl an-table">
          <thead><tr><th>Item</th><th>元件</th><th class="r">功耗 W</th><th class="r">頂面 %</th><th class="r">P_TIM W</th><th class="r">k</th><th class="r">t_c mm</th><th class="r">A_eff mm²</th><th class="r">R °C/W</th><th style="min-width:260px">ΔT °C</th></tr></thead>
          <tbody>${thermal.map((t, i) => {
            const hot = t.dT >= dtWarn;
            return html`<tr key=${i} class="clickable" onClick=${() => go('p/' + p.id + '/bom/' + t.item.id)}>
              <td class="mono"><b>${t.item.item_no}</b></td>
              <td class="mono">${t.part}${t.refdes ? html` <span class="muted">${t.refdes}</span>` : null}</td>
              <td class="r mono">${util.fmt(t.power_total, 2)}</td><td class="r mono">${t.top_pct == null ? html`<span class="muted">100</span>` : util.fmt(t.top_pct, 1)}</td>
              <td class="r mono">${util.fmt(t.power, 3)}</td><td class="r mono">${util.fmt(t.k, 2)}</td>
              <td class="r mono" title=${t.t_src === 'thickness' ? '無間隙資料，用未壓縮厚度（保守）' : ''}>${util.fmt(t.t_c, 3)}${t.t_src === 'thickness' ? '*' : ''}</td>
              <td class="r mono">${util.fmt(t.area, 1)}</td><td class="r mono">${util.fmt(t.R, 3)}</td>
              <td><div class="dt-bar" title=${util.fmt(t.dT, 2) + ' °C'}>
                <i class=${hot ? 'hot' : ''} style=${{ width: Math.max(1, t.dT / Math.max(dtMax, dtWarn) * 180) + 'px', borderRadius: '0 4px 4px 0' }}></i>
                <span class="mono">${util.fmt(t.dT, 2)}</span>${hot ? html`<span class="tag tag-warn">! ≥ ${dtWarn}</span>` : null}
              </div></td>
            </tr>`;
          })}</tbody>
        </table></div>
        <div class="muted" style="font-size:11px;margin-top:6px">* = 無間隙資料，以未壓縮厚度計算（偏保守）。</div>` : html`<div class="empty"><h3>還沒有可估算的元件</h3><p>需要：材料 k 值（連結材料庫）、TIM 厚度 / 間隙、覆蓋元件的單顆功耗。</p></div>`}
      </div>
    </div>`;
  }

  TIM.ui.Analysis = Analysis;
})();
