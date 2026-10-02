/* 壓力–壓縮曲線 (deflection vs pressure) of a material: chart + per-thickness point tables.
 * Data: material.pressure_curves = [{ t: mm, points: [[psi, %], …] }] — used by calc.pressureAt for the
 * pressure / over-pressure check of items. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, Icon, NumField, toast } = TIM.ui;
  const { util } = TIM;

  // Thickness is ordered → one hue, light → dark (thin → thick), from the app's blue ramp.
  const RAMP = ['#5BA3E6', '#3A7AD4', '#2357A7', '#1A4E96', '#0B3D7A', '#042952', '#021B3A'];
  const fin = v => typeof v === 'number' && Number.isFinite(v);
  const colorAt = (i, n) => RAMP[n <= 1 ? 2 : Math.round(Math.max(0, i) / (n - 1) * (RAMP.length - 1))];
  /** Colour of a thickness by its rank among all thicknesses of the material (chart and editor agree). */
  const colorOf = (list, t) => {
    const ts = Array.from(new Set((list || []).map(c => c.t).filter(fin))).sort((a, b) => a - b);
    return colorAt(ts.indexOf(t), ts.length);
  };
  /** Round tick step so the axis has at most ~5 intervals. */
  const niceStep = v => [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(s => s * 5 >= v) || Math.ceil(v / 5000) * 1000;

  /** Line chart: deflection % (y) vs pressure psi (x), one line per thickness; native tooltips on the points. */
  function CurveChart(props) {
    const curves = (props.curves || []).map(c => ({ t: c.t, pts: (c.points || []).filter(p => fin(p[0]) && fin(p[1])).slice().sort((a, b) => a[0] - b[0]) }))
      .filter(c => fin(c.t) && c.pts.length).sort((a, b) => a.t - b.t);
    if (!curves.length) return null;
    const direct = curves.length <= 4;   // ≤ 4 lines: labelled at their ends as well as in the legend
    const W = 700, H = 230, L = 44, R = direct ? 64 : 16, T = 12, B = 34;
    const xData = Math.max.apply(null, curves.map(c => c.pts[c.pts.length - 1][0]).concat([5]));
    const xStep = niceStep(xData);
    const xMax = Math.ceil(xData / xStep) * xStep;
    const yMax = Math.min(100, Math.max(20, Math.ceil(Math.max.apply(null, curves.map(c => Math.max.apply(null, c.pts.map(p => p[1])))) / 10) * 10));
    const x = v => L + v / xMax * (W - L - R);
    const y = v => H - B - v / yMax * (H - T - B);
    const xt = Array.from({ length: Math.round(xMax / xStep) + 1 }, (_, i) => i * xStep);
    const yt = Array.from({ length: Math.floor(yMax / 10) + 1 }, (_, i) => i * 10).filter(v => yMax <= 50 || v % 20 === 0);
    return html`<figure class="curve-chart">
      <svg viewBox=${'0 0 ' + W + ' ' + H} role="img" aria-label="壓力–壓縮曲線">
        ${yt.map(v => html`<line x1=${L} x2=${W - R} y1=${y(v)} y2=${y(v)} class="cc-grid" />`)}
        ${yt.map(v => html`<text x=${L - 6} y=${y(v) + 3.5} class="cc-tick" text-anchor="end">${v}</text>`)}
        ${xt.map(v => html`<text x=${x(v)} y=${H - B + 15} class="cc-tick" text-anchor="middle">${util.fmt(v, 2)}</text>`)}
        <text x=${(L + W - R) / 2} y=${H - 4} class="cc-axis" text-anchor="middle">壓力 psi</text>
        <text x=${12} y=${(T + H - B) / 2} class="cc-axis" text-anchor="middle" transform=${'rotate(-90 12 ' + (T + H - B) / 2 + ')'}>壓縮率 %</text>
        <line x1=${L} x2=${W - R} y1=${y(0)} y2=${y(0)} class="cc-base" />
        ${curves.map((c, i) => {
          const col = colorOf(props.curves, c.t);
          const pts = (c.pts[0][0] > 0 ? [[0, 0]] : []).concat(c.pts);
          const last = c.pts[c.pts.length - 1];
          return html`<g>
            <polyline points=${pts.map(p => x(p[0]) + ',' + y(p[1])).join(' ')} fill="none" stroke=${col} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            ${c.pts.map(p => html`<circle cx=${x(p[0])} cy=${y(p[1])} r="4" fill=${col} stroke="#fff" stroke-width="2"><title>${util.fmt(c.t) + ' mm · ' + util.fmt(p[0]) + ' psi → ' + util.fmt(p[1]) + '%'}</title></circle>`)}
            ${direct ? html`<text x=${x(last[0]) + 8} y=${y(last[1]) + 4} class="cc-label">${util.fmt(c.t)} mm</text>` : null}
          </g>`;
        })}
      </svg>
      ${curves.length > 1 ? html`<figcaption class="cc-legend">${curves.map((c, i) => html`<span><i style=${{ background: colorOf(props.curves, c.t) }}></i>${util.fmt(c.t)} mm</span>`)}</figcaption>` : null}
    </figure>`;
  }

  /** Two numbers per line ("10, 13" / "10\t13" / "10 psi 13 %") → [[10, 13], …]; null unless ≥ 2 such lines. */
  function parsePairs(text) {
    const rows = String(text || '').split(/\r?\n/).map(l => (util.toHalfWidth(l).match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number)).filter(n => n.length >= 2);
    return rows.length >= 2 ? rows.map(n => [n[0], n[1]]) : null;
  }

  /** Editor for material.pressure_curves (props: mat, disabled, onChange(list)). */
  function CurvesField(props) {
    const list = props.mat.pressure_curves || [];
    const ro = props.disabled;
    const set = next => props.onChange(next);
    const upd = (i, patch) => set(list.map((c, j) => (j === i ? Object.assign({}, c, patch) : c)));
    const setPt = (i, k, col, v) => upd(i, { points: list[i].points.map((p, j) => (j === k ? (col ? [p[0], v] : [v, p[1]]) : p)) });
    const addCurve = () => {
      const lastT = list.length ? list[list.length - 1].t : null;
      set(list.concat({ t: fin(lastT) ? Math.round((lastT + 1) * 100) / 100 : 1, points: [[null, null], [null, null], [null, null]] }));
    };
    const onPaste = (i, e) => {
      const pairs = parsePairs(e.clipboardData && e.clipboardData.getData('text'));
      if (!pairs || ro) return;
      e.preventDefault();
      upd(i, { points: pairs });
      toast('已貼上 ' + pairs.length + ' 點（壓力 psi, 壓縮率 %）', 'ok');
    };
    return html`<div class="curves">
      <${CurveChart} curves=${list} />
      <div class="curve-list">
        ${list.map((c, i) => html`<div class="curve-card" key=${i} onPaste=${e => onPaste(i, e)}>
          <div class="curve-head">
            <span class="swatch-line" style=${{ background: colorOf(list, c.t) }}></span>
            <span class="muted">厚度</span>
            <${NumField} class="inp" value=${c.t} unit="mm" disabled=${ro} onChange=${v => upd(i, { t: v })} />
            <button class="icon-btn danger rw-only" title="刪除這條曲線" onClick=${() => set(list.filter((x, j) => j !== i))}><${Icon} name="trash" /></button>
          </div>
          <table class="subtbl curve-pts">
            <thead><tr><th class="r">壓力 psi</th><th class="r">壓縮率 %</th><th></th></tr></thead>
            <tbody>${c.points.map((pt, k) => html`<tr key=${k}>
              <td><${NumField} class="inp" right=${true} value=${pt[0]} disabled=${ro} onChange=${v => setPt(i, k, 0, v)} /></td>
              <td><${NumField} class="inp" right=${true} value=${pt[1]} disabled=${ro} onChange=${v => setPt(i, k, 1, v)} /></td>
              <td><button class="icon-btn rw-only" title="移除這一點" onClick=${() => upd(i, { points: c.points.filter((x, j) => j !== k) })}><${Icon} name="x" /></button></td>
            </tr>`)}</tbody>
          </table>
          <button class="btn btn-ghost btn-xs rw-only" onClick=${() => upd(i, { points: c.points.concat([[null, null]]) })}><${Icon} name="plus" /> 新增點</button>
        </div>`)}
        <button class="btn btn-ghost btn-sm rw-only curve-add" onClick=${addCurve}><${Icon} name="plus" /> 新增厚度曲線</button>
      </div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">每個厚度一條：壓力 psi 對應壓縮率 %（規格書的 Deflection vs Pressure）。可從 Excel 複製兩欄貼到某條曲線上（會取代該條的點）。
        Item 依自己的厚度取曲線（介於兩個厚度之間內插），換算壓縮時的壓力並與元件耐壓比較。</div>
    </div>`;
  }

  TIM.ui.CurveChart = CurveChart;
  TIM.ui.CurvesField = CurvesField;
  TIM.ui.parseCurvePairs = parsePairs;
})();
