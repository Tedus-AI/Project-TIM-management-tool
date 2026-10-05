/* Material combobox for an item's Vendor / Model (Item drawer and TIM 清單 cells).
 * Opened, it lists every library material — not just the ones matching the text already in the field (the native
 * datalist did that, so a wrong pick could only be changed by clearing the field first); typing filters. Picking a
 * material links the item to it (k, deflection curves…). Free text stays as typed, and leaving the field after a
 * change links the item when Vendor + Model name exactly one library material (calc.libraryMatch). */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useRef, useLayoutEffect, useEffect, Icon, cx, TextField, toast } = TIM.ui;
  const { schema, calc, util } = TIM;
  const A = () => TIM.actions;

  /** Link item → material (one undo step) and say so. */
  function linkTo(pid, itemId, m) {
    A().linkMaterial(pid, itemId, m.id);
    toast('已連結材料庫：' + m.vendor + ' ' + m.model + '（k 值、壓力曲線會帶入）', 'ok');
  }

  /** Leaving a Vendor / Model field after typing: link when the pair names exactly one library material. */
  function autoLinkLater(pid, itemId) {
    setTimeout(() => {
      const p = TIM.store.db.projects[pid];
      const it = p && p.items.find(x => x.id === itemId);
      const m = it && calc.libraryMatch(TIM.store.db, it);
      if (m) linkTo(pid, itemId, m);
    }, 0);
  }

  /**
   * props: pid, itemId, field ('vendor' | 'model'), value, disabled, class, dataCell, onChange(text) (live),
   * grid (true in the TIM 清單: arrows move between cells while the list is closed; Alt+↓ or a click opens it).
   */
  function MaterialCombo(props) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState(null);          // null = everything (just opened); text = filter
    const [act, setAct] = useState(-1);
    const [pos, setPos] = useState(null);      // fixed position of the list (not clipped by the grid / drawer scroll)
    const box = useRef(null);
    const listRef = useRef(null);
    const v0 = useRef(null);                   // value when focused → typed something?
    const input = () => box.current && box.current.querySelector('input');
    const mats = open ? Object.values(TIM.store.db.materials)
      .filter(m => !q || (m.vendor + ' ' + m.model + ' ' + schema.timType(m.tim_type).label).toUpperCase().includes(q.trim().toUpperCase()))
      .sort((a, b) => util.naturalCompare(a.vendor + ' ' + a.model, b.vendor + ' ' + b.model)) : [];
    const cur = Math.min(act, mats.length - 1);
    const place = () => {
      const inp = input();
      if (!inp) return;
      const r = inp.getBoundingClientRect();
      setPos({ left: r.left, top: r.bottom + 2, above: r.top, width: Math.max(r.width, 360) });
    };
    const openList = () => { place(); setOpen(true); setQ(null); setAct(-1); };
    const close = () => { setOpen(false); setAct(-1); };
    const pick = m => {
      close(); v0.current = null;
      linkTo(props.pid, props.itemId, m);
      // the linked cell replaces this field: keep the keyboard on the same grid cell
      const dc = props.dataCell;
      if (dc) setTimeout(() => { const el = document.querySelector('[data-cell="' + dc + '"]'); if (el) el.focus(); }, 30);
    };

    // keep the list inside the viewport (above the field when there is no room below)
    useLayoutEffect(() => {
      const el = listRef.current;
      if (!open || !el || !pos) return;
      const h = el.getBoundingClientRect().height;
      const top = pos.top + h > window.innerHeight - 8 && pos.above - h - 2 > 8 ? pos.above - h - 2 : pos.top;
      const left = Math.max(8, Math.min(pos.left, window.innerWidth - el.getBoundingClientRect().width - 8));
      el.style.top = top + 'px'; el.style.left = left + 'px';
    });
    // the page scrolls under a fixed list → close it (scrolling the list itself is fine)
    useEffect(() => {
      if (!open) return undefined;
      const onScroll = e => { if (!listRef.current || !listRef.current.contains(e.target)) close(); };
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', close);
      return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', close); };
    }, [open]);
    useLayoutEffect(() => {
      const on = open && cur >= 0 && listRef.current && listRef.current.querySelector('.mc-row.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }, [cur, open]);

    const onKey = e => {
      if (e.isComposing) return;
      if (!open) {
        if (e.key === 'ArrowDown' && (!props.grid || e.altKey)) { e.preventDefault(); e.stopPropagation(); openList(); }
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); e.stopPropagation();
        if (!mats.length) return;
        setAct(e.key === 'ArrowDown' ? (cur + 1) % mats.length : (cur <= 0 ? mats.length - 1 : cur - 1));
      } else if (e.key === 'Enter') {
        if (mats[cur]) { e.preventDefault(); e.stopPropagation(); pick(mats[cur]); } else close();
      } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Tab') close();
    };
    const sel = m => String(m[props.field] || '').trim().toUpperCase() === String(props.value || '').trim().toUpperCase();

    return html`<div class=${cx('mat-combo', props.grid && 'in-grid')} ref=${box}
        onMouseDown=${e => { if (!props.disabled && e.target.tagName === 'INPUT' && !open) openList(); }}>
      <${TextField} class=${props.class || 'inp'} value=${props.value} disabled=${props.disabled} dataCell=${props.dataCell}
        placeholder=${props.placeholder || ''}
        onFocus=${() => { v0.current = props.value || ''; }}
        onChange=${v => { if (!open) place(); setOpen(true); setQ(v); setAct(-1); props.onChange(v); }}
        onBlur=${e => { close(); if (v0.current !== null && e.target.value !== v0.current) autoLinkLater(props.pid, props.itemId); v0.current = null; }}
        onKeyDown=${onKey} />
      ${props.disabled || props.grid ? null : html`<button type="button" class="dd-btn" tabindex="-1" title="從材料庫選擇（選了就連結）"
        onMouseDown=${e => e.preventDefault()} onClick=${() => { const inp = input(); if (inp && document.activeElement !== inp) inp.focus(); if (open) close(); else openList(); }}><${Icon} name="chevD" size=${13} /></button>`}
      ${open && pos ? html`<div class="mat-list" ref=${listRef} role="listbox" aria-label="材料庫" style=${{ left: pos.left + 'px', top: pos.top + 'px', minWidth: pos.width + 'px' }}>
        <div class="mc-head">材料庫 ${q ? '· 篩選「' + q + '」' : '· 全部 ' + Object.keys(TIM.store.db.materials).length + ' 筆'} · 選取即連結（k 值、壓力曲線會帶入）</div>
        ${mats.map((m, i) => html`<button type="button" role="option" key=${m.id} aria-selected=${i === cur} class=${cx('mc-row', i === cur && 'on')}
            onMouseDown=${e => e.preventDefault()} onMouseEnter=${() => setAct(i)} onClick=${() => pick(m)}>
          <span class="mc-v">${m.vendor}</span><b class="mc-m">${m.model}</b>
          <span class="mc-t">${schema.materialTypeText(m)}${m.k != null ? ' · ' + util.fmt(m.k, 2) + ' W/m·K' : ''}${(m.pressure_curves || []).length ? ' · 有壓力曲線' : ''}</span>
          ${sel(m) ? html`<${Icon} name="check" size=${13} />` : null}
        </button>`)}
        ${!mats.length ? html`<div class="mc-empty">${Object.keys(TIM.store.db.materials).length ? '材料庫沒有符合的材料，文字會照打的保留（未連結）。' : '材料庫還沒有材料：先到「材料庫」新增或匯入。'}</div>` : null}
      </div>` : null}
    </div>`;
  }

  TIM.ui.MaterialCombo = MaterialCombo;
})();
