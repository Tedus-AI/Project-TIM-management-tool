/* Form fields. NOTE: events without an on* DOM property (compositionstart / compositionend / focusin)
 * must be written in lower case in htm templates, otherwise Preact listens to "CompositionEnd".
 * Rules (from the UX conventions):
 *  - typing never re-creates the input (focus + caret stay), IME composition (注音/倉頡) is respected
 *  - external changes (undo/redo, another user) replace the local text even while focused
 *  - auto-filled values: plain text + "自動" badge + ✂ unlock escape hatch
 */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useRef, useEffect, useLayoutEffect, Icon, cx } = TIM.ui;
  const util = TIM.util;

  /** Strict number parse for inputs: "", "2", "-0.5", "1,234.5", "２．５" → number|null; junk → NaN. */
  function strictNum(text) {
    const s = util.toHalfWidth(String(text)).trim().replace(/,(?=\d{3}(\D|$))/g, '');
    if (s === '') return null;
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }

  /**
   * Text input with local buffer. onChange(value) fires on every non-composing input
   * (live) unless commit="blur", in which case it fires on blur / Enter.
   */
  function TextField(props) {
    const [focused, setFocused] = useState(false);
    const [text, setText] = useState('');
    const composing = useRef(false);
    const sent = useRef(null);
    const ext = props.value == null ? '' : String(props.value);
    // external change while focused (undo, remote merge) → adopt it
    useLayoutEffect(() => {
      if (focused && sent.current !== null && ext !== sent.current) { sent.current = ext; setText(ext); }
    }, [ext]);
    const blurCommit = props.commit === 'blur';
    const send = v => { sent.current = v; if (props.onChange) props.onChange(v); };
    const Tag = props.multiline ? 'textarea' : 'input';
    return html`<${Tag} class=${cx(props.class || (props.multiline ? 'ta' : 'inp'), props.mono && 'mono', props.invalid && 'invalid')}
      value=${focused ? text : ext} placeholder=${props.placeholder || ''} disabled=${props.disabled}
      title=${props.title || undefined} list=${props.list || undefined} spellcheck=${false} rows=${props.rows || undefined}
      autofocus=${props.autofocus}
      data-cell=${props.dataCell || undefined}
      onFocus=${e => { setText(ext); sent.current = ext; setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur=${e => {
        setFocused(false);
        if (blurCommit && e.target.value !== ext) send(e.target.value);
        sent.current = null;
        props.onBlur && props.onBlur(e);
      }}
      oncompositionstart=${() => { composing.current = true; }}
      oncompositionend=${e => { composing.current = false; setText(e.target.value); if (!blurCommit) send(e.target.value); }}
      onInput=${e => { setText(e.target.value); if (!composing.current && !e.isComposing && !blurCommit) send(e.target.value); }}
      onKeyDown=${e => {
        if (blurCommit && e.key === 'Enter' && !props.multiline && !e.isComposing) e.target.blur();
        if (props.onKeyDown) props.onKeyDown(e);
      }} />`;
  }

  /** Numeric input: keeps "2." while typing, sends number|null, flags invalid text. */
  function NumField(props) {
    const [focused, setFocused] = useState(false);
    const [text, setText] = useState('');
    const sent = useRef(undefined);
    const ext = props.value == null || props.value === '' ? '' : util.fmt(props.value, props.digits == null ? 4 : props.digits);
    useLayoutEffect(() => {
      if (focused && sent.current !== undefined && props.value !== sent.current) { sent.current = props.value; setText(ext); }
    }, [props.value]);
    const parsed = strictNum(text);
    const invalid = focused && Number.isNaN(parsed);
    const input = html`<input class=${cx(props.class || 'inp', 'num', invalid && 'invalid', props.right && 'r')} inputmode="decimal"
      value=${focused ? text : ext} placeholder=${props.placeholder || ''} disabled=${props.disabled} title=${props.title || undefined}
      data-cell=${props.dataCell || undefined}
      onFocus=${e => { setText(ext); sent.current = props.value; setFocused(true); props.onFocus && props.onFocus(e); }}
      onBlur=${e => { setFocused(false); sent.current = undefined; props.onBlur && props.onBlur(e); }}
      onInput=${e => {
        const v = e.target.value;
        setText(v);
        const n = strictNum(v);
        if (Number.isNaN(n)) return;
        if (n !== null && props.min != null && n < props.min) return;
        sent.current = n;
        props.onChange && props.onChange(n);
      }}
      onKeyDown=${props.onKeyDown} />`;
    if (!props.unit) return input;
    return html`<div class="inp-unit">${input}<span>${props.unit}</span></div>`;
  }

  function SelectField(props) {
    const opts = props.options || [];
    return html`<select class=${props.class || 'sel'} value=${props.value == null ? '' : props.value} disabled=${props.disabled}
        data-cell=${props.dataCell || undefined} title=${props.title || undefined}
        onChange=${e => props.onChange && props.onChange(e.target.value)} onKeyDown=${props.onKeyDown}>
      ${props.allowEmpty !== false && props.emptyLabel !== null ? html`<option value="">${props.emptyLabel || '—'}</option>` : null}
      ${opts.map(o => typeof o === 'string'
        ? html`<option value=${o}>${o}</option>`
        : html`<option value=${o.v}>${o.label}</option>`)}
      ${props.value && !opts.some(o => (typeof o === 'string' ? o : o.v) === props.value) ? html`<option value=${props.value}>${props.value}</option>` : null}
    </select>`;
  }

  /** Field wrapper with label + optional hint / error / info dot. */
  function Field(props) {
    return html`<div class=${cx('field', props.class)}>
      <label>${props.label}${props.info ? html` <${TIM.ui.InfoDot}>${props.info}</${TIM.ui.InfoDot}>` : null}${props.labelRight ? html`<span style="margin-left:auto">${props.labelRight}</span>` : null}</label>
      ${props.children}
      ${props.error ? html`<div class="field-err">${props.error}</div>` : props.hint ? html`<div class="field-hint">${props.hint}</div>` : null}
    </div>`;
  }

  /**
   * Auto-filled value: shows plain text + source badge + ✂ unlock. When `unlocked`,
   * renders children (the manual input) + ↺ back-to-auto.
   */
  function Locked(props) {
    if (props.unlocked) {
      return html`<div class="locked">
        <div style="flex:1;min-width:0">${props.children}</div>
        ${props.onRelock ? html`<button type="button" class="icon-btn rw-only" title=${'回復自動帶入（' + (props.source || '') + '）'} onClick=${props.onRelock}><${Icon} name="reset" /></button>` : null}
      </div>`;
    }
    return html`<div class="locked">
      <span class="val">${props.display == null || props.display === '' ? html`<span class="muted">—</span>` : props.display}</span>
      ${props.source ? html`<span class="lock-badge" title="自動帶入的值">${props.source}</span>` : null}
      ${props.onUnlock ? html`<button type="button" class="icon-btn rw-only" title="解鎖，改為手動輸入" onClick=${props.onUnlock}><${Icon} name="scissors" /></button>` : null}
    </div>`;
  }

  /** Tri-state yes / no / unknown toggle (RoHS etc.). */
  function YesNo(props) {
    const v = props.value;
    const b = (val, label) => html`<button type="button" class=${v === val ? 'on' : ''} disabled=${props.disabled}
      onClick=${() => props.onChange(v === val ? null : val)}>${label}</button>`;
    return html`<div class="yesno">${b(true, '是')}${b(false, '否')}</div>`;
  }

  function ColorField(props) {
    const colors = props.palette || TIM.schema.ITEM_COLORS;
    return html`<div class="row wrap" style="gap:4px">
      ${colors.map(c => html`<button type="button" title=${c} disabled=${props.disabled}
        style=${{ width: '18px', height: '18px', background: c, outline: props.value === c ? '2px solid var(--d-700)' : 'none', outlineOffset: '1px', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.15)' }}
        onClick=${() => props.onChange(c)}></button>`)}
      ${props.allowAuto ? html`<button type="button" class="btn btn-xs btn-ghost" disabled=${props.disabled} onClick=${() => props.onChange(null)}>自動</button>` : null}
    </div>`;
  }

  /**
   * People of a function (e.g. "TH/ME") in SharePoint's Project_Members list — the list the
   * AI Thermal tool keeps. null while loading or when it cannot be read (not signed in, offline,
   * no such list): callers then fall back to free text.
   */
  function usePeople(func) {
    const [people, setPeople] = useState(null);
    useEffect(() => {
      const sp = TIM.spBackend;
      if (!sp || !sp.account()) return undefined;
      let dead = false;
      sp.members().then(list => { if (!dead) setPeople(list.filter(p => !func || p.funcs.includes(func))); }, () => { /* free text */ });
      return () => { dead = true; };
    }, [func]);
    return people;
  }

  const MANUAL = '__manual__';
  /**
   * Person picker: the people of `func` from Project_Members as a dropdown (+ 「手動輸入…」 for
   * someone not on the list); a text field while the list is not available.
   */
  function PersonField(props) {
    const people = usePeople(props.func);
    const [manual, setManual] = useState(false);
    const box = useRef(null);
    useEffect(() => { if (manual && box.current) { const i = box.current.querySelector('input'); if (i) { i.focus(); i.select(); } } }, [manual]);   // typing replaces the old name
    const v = props.value == null ? '' : String(props.value);
    if (!people || !people.length || manual) {
      return html`<div class="person-field" ref=${box}>
        <${TextField} value=${v} placeholder=${props.placeholder || ''} disabled=${props.disabled} onChange=${props.onChange} />
        ${people && people.length ? html`<button type="button" class="btn btn-ghost btn-xs" title="從 SharePoint 的 Project_Members 名單選" disabled=${props.disabled} onClick=${() => setManual(false)}>名單</button>` : null}
      </div>`;
    }
    const cur = people.find(p => p.name === v);
    return html`<select class="sel" value=${v} disabled=${props.disabled} title=${cur ? cur.email : ''}
        onChange=${e => { if (e.target.value === MANUAL) { setManual(true); return; } if (props.onChange) props.onChange(e.target.value); }}>
      <option value="">—</option>
      ${people.map(p => html`<option key=${p.email || p.name} value=${p.name} title=${p.email}>${p.name}</option>`)}
      ${v && !cur ? html`<option value=${v}>${v}（不在名單）</option>` : null}
      <option value=${MANUAL}>手動輸入…</option>
    </select>`;
  }

  Object.assign(TIM.ui, { TextField, NumField, SelectField, Field, Locked, YesNo, ColorField, PersonField, usePeople, strictNum });
})();
