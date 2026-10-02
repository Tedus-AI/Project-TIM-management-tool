/* Overlays: modal, confirm / prompt (Enter = OK, Esc = cancel), toast, context menu, popover. */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useEffect, useRef, useLayoutEffect, useReducer, Icon, cx } = TIM.ui;

  const ov = { modals: [], toasts: [], menu: null, popover: null, listeners: new Set(), version: 0 };
  const emit = () => { ov.version++; ov.listeners.forEach(f => f()); };
  let seq = 0;

  function openModal(render, opts) {
    const id = ++seq;
    const close = (result) => {
      const m = ov.modals.find(x => x.id === id);
      ov.modals = ov.modals.filter(x => x.id !== id);
      emit();
      if (m && m.resolve) m.resolve(result);
    };
    const entry = { id, render, close, opts: opts || {} };
    const p = new Promise(res => { entry.resolve = res; });
    ov.modals.push(entry);
    emit();
    entry.promise = p;
    return entry;
  }

  /** Generic dialog chrome. onEnter runs on Enter (outside textareas); Esc / backdrop → onClose. */
  function Modal(props) {
    const ref = useRef(null);
    // Latest callbacks, updated during render: effects run after paint, so a listener
    // registered in an effect could call a stale onEnter (e.g. Enter right after typing).
    const cb = useRef(props);
    cb.current = props;
    // Layout effect: listen as soon as the dialog is in the DOM. A plain effect waits for the
    // next frame, so Enter / Esc pressed right after the dialog appears was lost.
    useLayoutEffect(() => {
      const onKey = e => {
        // Only the top-most dialog reacts (stacked dialogs, e.g. confirm over a wizard).
        const all = document.querySelectorAll('.modal-backdrop');
        if (!ref.current || all[all.length - 1] !== ref.current.parentElement) return;
        const pr = cb.current;
        // Keys typed on anything behind the dialog belong to the dialog (never re-click the opener);
        // inside it, textareas keep Enter and the dialog's own buttons keep native activation.
        const inside = e.target && ref.current.contains(e.target);
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pr.onClose && pr.onClose(); }
        else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          const own = inside && (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'BUTTON' && !e.target.dataset.enterOk));
          if (own) return;
          if (!inside || pr.onEnter) { e.preventDefault(); e.stopPropagation(); }
          if (pr.onEnter) pr.onEnter();
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, []);
    useEffect(() => {
      // Focus the first field, else the primary button, so Enter / Esc act on this dialog
      // (and Enter can never re-click the button that opened it).
      const el = ref.current && (ref.current.querySelector('[autofocus], .inp, .sel, .ta') || ref.current.querySelector('[data-enter-ok]') || ref.current.querySelector('.modal-foot .btn-primary'));
      // (skipped when focus is already inside the dialog: never pull the caret out of a field being typed in)
      if (el) setTimeout(() => {
        if (ref.current && ref.current.contains(document.activeElement)) return;
        el.focus(); if (el.select && el.tagName !== 'BUTTON' && el.dataset.selectAll !== 'false') el.select();
      }, 30);
      else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }, []);
    return html`<div class="modal-backdrop" onMouseDown=${e => { if (e.target === e.currentTarget && props.dismissable !== false) props.onClose && props.onClose(); }}>
      <div class=${cx('modal', props.size)} ref=${ref} role="dialog" aria-modal="true" aria-label=${props.title}>
        <div class="modal-top-bar"></div>
        <div class="modal-head"><h2>${props.title}</h2>${props.headRight ? html`<div class="right">${props.headRight}</div>` : null}</div>
        <div class="modal-body">${props.children}</div>
        ${props.footer ? html`<div class="modal-foot">${props.footer}</div>` : null}
      </div>
    </div>`;
  }

  function confirm(o) {
    o = typeof o === 'string' ? { message: o } : (o || {});
    const m = openModal(close => html`<${Modal} title=${o.title || '確認'} onClose=${() => close(false)} onEnter=${() => close(true)}
        footer=${html`
          ${o.footNote ? html`<span class="left">${o.footNote}</span>` : null}
          <button class="btn btn-ghost" onClick=${() => close(false)}>${o.cancelText || '取消'}</button>
          <button class=${cx('btn', o.danger ? 'btn-danger' : 'btn-primary')} data-enter-ok="1" onClick=${() => close(true)}>${o.okText || '確定'}</button>`}>
        ${typeof o.message === 'string' ? html`<p style="white-space:pre-line">${o.message}</p>` : o.message}
      </${Modal}>`);
    return m.promise;
  }

  function PromptBody(props) {
    const [v, setV] = useState(props.o.value == null ? '' : String(props.o.value));
    const [err, setErr] = useState('');
    const inputRef = useRef(null);
    const submit = () => {
      const val = inputRef.current ? inputRef.current.value : v;    // DOM value: never stale
      const msg = props.o.validate ? props.o.validate(val) : '';
      if (msg) { setErr(msg); return; }
      props.close(val);
    };
    return html`<${Modal} title=${props.o.title || '輸入'} onClose=${() => props.close(null)} onEnter=${submit}
        footer=${html`<button class="btn btn-ghost" onClick=${() => props.close(null)}>取消</button>
          <button class="btn btn-primary" data-enter-ok="1" onClick=${submit}>${props.o.okText || '確定'}</button>`}>
      <div class="field">
        ${props.o.label ? html`<label>${props.o.label}</label>` : null}
        <div class=${props.o.unit ? 'inp-unit' : ''}>
          <input class=${cx('inp', err && 'invalid')} ref=${inputRef} value=${v} placeholder=${props.o.placeholder || ''} autofocus
            inputmode=${props.o.numeric ? 'decimal' : 'text'}
            onInput=${e => { setV(e.target.value); setErr(''); }} />
          ${props.o.unit ? html`<span>${props.o.unit}</span>` : null}
        </div>
        ${err ? html`<div class="field-err">${err}</div>` : props.o.hint ? html`<div class="field-hint">${props.o.hint}</div>` : null}
      </div>
    </${Modal}>`;
  }

  function prompt(o) {
    const m = openModal(close => html`<${PromptBody} o=${o || {}} close=${close} />`);
    return m.promise;
  }

  function toast(message, type, opts) {
    const id = ++seq;
    const t = { id, message, type: type || 'info', action: opts && opts.action };
    ov.toasts = ov.toasts.concat(t).slice(-4);
    emit();
    setTimeout(() => { ov.toasts = ov.toasts.filter(x => x.id !== id); emit(); }, (opts && opts.timeout) || (type === 'err' ? 7000 : 3600));
  }

  /** Context menu at a mouse event or {x,y}. items: {label, icon, onClick, danger, disabled, kbd} | 'sep' | {header} */
  function openMenu(evt, items) {
    const x = evt.clientX != null ? evt.clientX : evt.x;
    const y = evt.clientY != null ? evt.clientY : evt.y;
    ov.menu = { x, y, items };
    emit();
  }
  function closeMenu() { if (ov.menu) { ov.menu = null; emit(); } }

  /** Small anchored popover (formula explanations etc.). */
  function openPopover(anchor, content) {
    const r = anchor.getBoundingClientRect();
    ov.popover = { x: r.left, y: r.bottom + 6, content };
    emit();
  }
  function closePopover() { if (ov.popover) { ov.popover = null; emit(); } }

  /** Clamp a floating box inside the viewport after it renders. */
  function useClamp(ref, x, y) {
    useLayoutEffect(() => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let nx = x, ny = y;
      if (nx + r.width > window.innerWidth - 8) nx = Math.max(8, window.innerWidth - r.width - 8);
      if (ny + r.height > window.innerHeight - 8) ny = Math.max(8, y - r.height - 12);
      el.style.left = nx + 'px'; el.style.top = ny + 'px';
    }, [x, y]);
  }

  function MenuView(props) {
    const ref = useRef(null);
    const m = props.menu;
    useClamp(ref, m.x, m.y);
    useEffect(() => {
      const down = e => { if (ref.current && !ref.current.contains(e.target)) closeMenu(); };
      const key = e => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); } };
      const t = setTimeout(() => { window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true); }, 0);
      window.addEventListener('blur', closeMenu);
      return () => { clearTimeout(t); window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', closeMenu); };
    }, []);
    return html`<div class="menu" ref=${ref} style=${{ left: m.x + 'px', top: m.y + 'px' }} role="menu">
      ${m.items.filter(Boolean).map((it, i) => {
        if (it === 'sep') return html`<hr key=${i} />`;
        if (it.header) return html`<div class="menu-label" key=${i}>${it.header}</div>`;
        return html`<button key=${i} role="menuitem" class=${it.danger ? 'danger' : ''} disabled=${it.disabled}
          onClick=${() => { closeMenu(); it.onClick && it.onClick(); }}>
          ${it.icon ? html`<${Icon} name=${it.icon} size=${14} />` : html`<span style="width:14px"></span>`}
          <span>${it.label}</span>${it.kbd ? html`<kbd>${it.kbd}</kbd>` : null}
        </button>`;
      })}
    </div>`;
  }

  function PopoverView(props) {
    const ref = useRef(null);
    const p = props.pop;
    useClamp(ref, p.x, p.y);
    useEffect(() => {
      const down = e => { if (ref.current && !ref.current.contains(e.target)) closePopover(); };
      const key = e => { if (e.key === 'Escape') closePopover(); };
      const t = setTimeout(() => { window.addEventListener('mousedown', down, true); window.addEventListener('keydown', key, true); }, 0);
      return () => { clearTimeout(t); window.removeEventListener('mousedown', down, true); window.removeEventListener('keydown', key, true); };
    }, []);
    return html`<div class="popover" ref=${ref} style=${{ left: p.x + 'px', top: p.y + 'px' }}>${p.content}</div>`;
  }

  function Overlays() {
    const [, force] = useReducer(x => x + 1, 0);
    // Layout effect + catch-up (as useStore): a dialog opened between render and subscription —
    // e.g. right after the start page / app screen switch, or on a busy machine — is not lost.
    const seen = ov.version;
    useLayoutEffect(() => {
      ov.listeners.add(force);
      if (ov.version !== seen) force();
      return () => ov.listeners.delete(force);
    }, []);
    return html`<div>
      ${ov.modals.map((m, i) => html`<div key=${m.id}>${m.render(m.close, i === ov.modals.length - 1)}</div>`)}
      ${ov.menu ? html`<${MenuView} menu=${ov.menu} key=${'menu' + ov.menu.x + ',' + ov.menu.y} />` : null}
      ${ov.popover ? html`<${PopoverView} pop=${ov.popover} key=${'pop' + ov.popover.x + ',' + ov.popover.y} />` : null}
      <div class="toasts" aria-live="polite">
        ${ov.toasts.map(t => html`<div key=${t.id} class=${cx('toast', t.type)}>
          <span>${t.message}</span>
          ${t.action ? html`<button onClick=${() => { t.action.fn(); ov.toasts = ov.toasts.filter(x => x.id !== t.id); emit(); }}>${t.action.label}</button>` : null}
        </div>`)}
      </div>
    </div>`;
  }

  /** "?" dot that opens a popover (formulas / data sources). */
  function InfoDot(props) {
    return html`<button type="button" class="info-dot" title=${props.title || '說明'}
      onClick=${e => { e.stopPropagation(); openPopover(e.currentTarget, props.children); }}>?</button>`;
  }

  /** Download a Blob as a file. */
  function downloadBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /** Open a file chooser; resolves File or null. */
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept) inp.accept = accept;
      inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      inp.click();
    });
  }

  /** Open a multi-file chooser; resolves File[] (empty when cancelled). */
  function pickFiles(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.multiple = true;
      if (accept) inp.accept = accept;
      inp.onchange = () => resolve(inp.files ? Array.from(inp.files) : []);
      inp.click();
    });
  }

  Object.assign(TIM.ui, { Modal, openModal, confirm, prompt, toast, openMenu, closeMenu, openPopover, closePopover, Overlays, InfoDot, downloadBlob, pickFile, pickFiles });
})();
