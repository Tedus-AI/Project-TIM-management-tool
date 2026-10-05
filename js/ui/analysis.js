/* 間隙與壓力檢核: compression / pressure check per item (range chart) + TIM temperature-rise ranking. */
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


  /** Compression range bar of one component (or of the item when it has none): track 0 ~ hi, ≥ minimum zone, min ~ max, nom. */
  function RangeBar(props) {
    const { min, nom, max, status, hi, rec } = props;
    const pct = v => util.clamp(v / hi * 100, 0, 100);
    return html`<div class="rangebar" title=${props.title || ''}>
      ${rec && rec.min != null ? html`<div class="rec rec-min" style=${{ left: pct(rec.min) + '%', width: (100 - pct(rec.min)) + '%' }}></div>` : null}
      ${min != null && max != null ? html`<div class=${cx('span', status === 'error' && 'error')} style=${{ left: pct(Math.max(0, min)) + '%', width: Math.max(0.8, pct(max) - pct(Math.max(0, min))) + '%', borderRadius: '4px' }}></div>` : null}
      ${nom != null ? html`<div class="nom" style=${{ left: pct(nom) + '%' }}></div>` : null}
    </div>`;
  }

  const fmtC = v => (v == null ? '—' : util.fmt(v, 1));
  const tagOf = (status, title) => html`<span class=${'tag ' + STATUS[status].cls} title=${title || ''}>${STATUS[status].icon} ${STATUS[status].label}</span>`;

  /** Design pressure vs the component's spec: "14.7 / 29.9 psi" + ratio meter, or why it is not judged. */
  function PressureCell(props) {
    const r = props.r;
    if (!r.pMax) return html`<span class="muted">—${r.pNote ? html` <span class="p-note">${r.pNote}</span>` : null}</span>`;
    const v = (r.pMax.beyond ? '> ' : '') + util.fmt(r.pMax.psi, 1);
    const designTip = '設計最大壓力 ' + v + ' psi（C max ' + fmtC(r.cMax) + '%，材料壓力–壓縮曲線）';
    if (r.allow && r.allow.psi != null && r.ratio != null) {
      const spec = r.allow.unit === 'psi' ? util.fmt(r.allow.value) + ' psi' : util.fmt(r.allow.value) + ' ' + r.allow.unit + '（= ' + util.fmt(r.allow.psi, 1) + ' psi，以接觸面積換算）';
      return html`<div class="p-cell" title=${designTip + '\n元件規格（耐壓）' + spec + '\n= 規格的 ' + util.fmt(r.ratio, 0) + '%'}>
        <span class="mono"><b>${v}</b><span class="muted"> / ${util.fmt(r.allow.psi, 1)} psi</span></span>
        <span class=${cx('p-meter', r.status)}><i style=${{ width: Math.min(100, r.ratio) + '%' }}></i></span>
        <span class=${cx('mono p-ratio', r.status === 'error' && 'text-err', r.status === 'warn' && 'text-warn')}>${util.fmt(r.ratio, 0)}%</span>
      </div>`;
    }
    return html`<div class="p-cell" title=${designTip}><span class="mono"><b>${v}</b><span class="muted"> psi</span></span>
      ${r.pNote ? html`<span class="p-note muted">${r.exempt ? '規格不需' : r.pNote}</span>` : null}</div>`;
  }

  /** Pressure judgement of one component: OK / Warning / Fail, 不檢核 (受壓類型 E-PAD…), or 未判定 (missing data). */
  function PressureJudge(props) {
    const r = props.r;
    if (r.exempt) {
      const lt = schema.loadType(r.loadType);
      return html`<span class="tag tag-mute" title=${lt.label + '：' + lt.why}>不檢核</span>`;
    }
    if (r.status === 'na') return html`<span class="muted" style="font-size:11.5px" title=${r.msg || r.pNote}>未判定</span>`;
    return tagOf(r.status, r.msg);
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
    const rank = { error: 0, warn: 1, ok: 2, na: 3 };
    // worst pressure judgement of an item (exempt / not judged components count as na) and its highest ratio
    const pWorst = r => r.cc.comps.reduce((w, c) => (c.exempt ? w : (rank[c.status] < rank[w] ? c.status : w)), 'na');
    const pRatio = r => Math.max.apply(null, r.cc.comps.map(c => (c.ratio == null ? -1 : c.ratio)).concat([-1]));
    const byNo = (a, b) => util.naturalCompare(a.it.item_no, b.it.item_no);
    const sorted = withComp.slice().sort((a, b) =>
      sort === 'status' ? (rank[a.cc.status] - rank[b.cc.status]) || byNo(a, b)
        : sort === 'cstatus' ? (rank[a.cc.cStatus] - rank[b.cc.cStatus]) || byNo(a, b)
          : sort === 'pstatus' ? (rank[pWorst(a)] - rank[pWorst(b)]) || (pRatio(b) - pRatio(a)) || byNo(a, b)
            : sort === 'pressure' ? (pRatio(b) - pRatio(a)) || ((b.cc.pressure ? b.cc.pressure.psi : -1) - (a.cc.pressure ? a.cc.pressure.psi : -1)) || byNo(a, b)
              : sort === 'min' ? a.cc.min - b.cc.min
                : sort === 'max' ? b.cc.max - a.cc.max
                  : 0);
    const hi = Math.max(50, Math.ceil((Math.max.apply(null, withComp.map(r => r.cc.max).concat([0])) + 5) / 10) * 10);   // shared axis
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
              <span><i class="swatch" style="background:var(--d-500)"></i>各元件 min ~ max 壓縮率</span>
              <span><i class="swatch" style="background:var(--ink);width:3px"></i>nom</span>
            </div>
            <${InfoDot}><div class="formula">C = (T − g) / T × 100%<br/>C<sub>min</sub>：間隙最大時；C<sub>max</sub>：間隙最小時<br/>間隙：設計間距 ± 公差，加上元件高度公差（最壞情況），或手動輸入<br/>壓縮判定 Fail：C<sub>min</sub> 低於最小壓縮率（預設 10%，Item 可手動調整）、最大間隙 ≥ T（未接觸）<br/>壓力：材料的壓力–壓縮曲線在 C<sub>max</sub> 的值；比例 = 壓力 ÷ 元件規格（耐壓）<br/>壓力判定：＞ 100% Fail；≥ ${db.settings.pressure_warn_pct || 80}% Warning；受壓類型 E-PAD 類不檢核</div></${InfoDot}>
          </div>
        </div>
        ${withComp.length ? html`<div class="tbl-wrap"><table class="tbl an-table an-check">
          <thead><tr>
            ${th('item', 'Item')}<th>Location</th><th>覆蓋元件</th><th>材料</th><th class="r">T</th><th class="r">間隙 min / nom / max</th>
            ${th('min', '壓縮率 %（0 ~ ' + hi + '）', 'rangecell')}${th('pressure', '壓力 max / 規格（psi）')}
            ${th('cstatus', '壓縮判定')}${th('pstatus', '壓力判定')}
          </tr></thead>
          ${sorted.map(r => {
            // one line per covered component (their gaps, compression and pressure differ); item cells span them
            const comps = r.cc.comps.length ? r.cc.comps : [null];
            const n = comps.length;
            const open = () => go('p/' + p.id + '/bom/' + r.it.id);
            return html`<tbody key=${r.it.id} class="an-item clickable" onClick=${open}>${comps.map((c, i) => {
              const g = c ? c.gap : r.cc.gap;
              const min = c ? c.cMin : r.cc.min, nom = c ? c.cNom : r.cc.nom, max = c ? c.cMax : r.cc.max;
              const cst = c ? c.cStatus : r.cc.cStatus;
              const low = min != null && r.cc.rec && min < r.cc.rec.min;
              const name = c ? [c.part, c.refdes].filter(Boolean).join(' ') : '';
              const lt = c && schema.loadType(c.loadType);
              return html`<tr key=${c ? c.id : 'item'} class=${i ? 'an-sub' : ''}>
                ${i ? null : html`<td class="mono" rowspan=${n}><b>${r.it.item_no}</b></td><td rowspan=${n}>${r.loc ? r.loc.name : ''}</td>`}
                <td class="mono ellipsis" style="max-width:190px" title=${c ? name + (lt ? '（' + lt.label + '）' : '') : ''}>${c ? html`${c.refdes || c.part || '元件'}${c.refdes && c.part ? html` <span class="muted">${c.part}</span>` : null}${lt ? html` <span class="tag tag-mute lt-chip">${lt.short}</span>` : null}` : html`<span class="muted">—</span>`}</td>
                ${i ? null : html`<td class="ellipsis" rowspan=${n} style="max-width:180px">${[r.eff.vendor, r.eff.model].filter(Boolean).join(' ')}</td><td class="r mono" rowspan=${n}>${util.fmt(r.it.size.t)}</td>`}
                <td class="r mono" title=${r.cc.gap.source === 'stack' ? '設計間距 ± 公差 + 元件高度公差' : '手動輸入'}>${[g.min, g.nom, g.max].map(v => (v == null ? '—' : util.fmt(v, 3))).join(' / ')}</td>
                <td class="rangecell"><div class="c-cell">
                  <${RangeBar} min=${min} nom=${nom} max=${max} status=${cst} hi=${hi} rec=${r.cc.rec}
                    title=${(name ? name + '：' : '') + '壓縮率 ' + fmtC(min) + ' ~ ' + fmtC(max) + '%' + (nom != null ? '（nom ' + fmtC(nom) + '%）' : '')} />
                  <span class="mono c-val"><span class=${low || (min != null && min <= 0) ? 'text-err' : ''}>${fmtC(min)}</span> ~ ${fmtC(max)}%</span>
                </div></td>
                <td>${c ? html`<${PressureCell} r=${c} />` : html`<span class="mono">${r.cc.pressure ? (r.cc.pressure.beyond ? '> ' : '') + util.fmt(r.cc.pressure.psi, 1) : '—'}</span>`}</td>
                <td>${cst === 'na' ? html`<span class="muted">—</span>` : tagOf(cst, cst === 'error' ? r.cc.msgs.filter((m, k) => r.cc.levels[k] === 'error' && !/耐壓/.test(m)).join('\n') : '')}</td>
                <td>${c ? html`<${PressureJudge} r=${c} />` : html`<span class="muted" style="font-size:11.5px" title="沒有覆蓋元件，無法對照元件規格">未判定</span>`}</td>
              </tr>`;
            })}</tbody>`;
          })}
        </table></div>
        <div class="muted" style="font-size:11px;margin-top:6px;line-height:1.7">每顆覆蓋元件一列。<b>壓縮判定</b>：C min 低於最小壓縮率（預設 10%，可在 Item 詳細調整）或最大間隙 ≥ T → Fail（接觸可能不足），數字以紅色標示。
          <b>壓力判定</b>：設計最大壓力（材料壓力–壓縮曲線在 C max 的值）÷ 元件規格（耐壓）：＞ 100% → Fail、≥ ${db.settings.pressure_warn_pct || 80}% → Warning；
          <span class="tag tag-mute">不檢核</span> = 受壓類型 E-PAD / QFN / LGA / 引腳（壓力照算、只顯示）；未判定 = 缺規格、材料曲線或未連結材料（滑鼠移到上面看原因）。點擊列開啟 Item。</div>` : html`<div class="empty"><h3>還沒有可檢核的 Item</h3><p>在 Item 詳細的「機構間隙、壓縮與壓力」填入設計間距（凸台到元件頂面）與元件高度（或直接填間隙 min / nom / max），或在 TIM 清單開啟「機構」欄位直接輸入。</p></div>`}
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
