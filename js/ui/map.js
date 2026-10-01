/* 位置標註 — placement map editor.
 * Tools (mutually exclusive): V select/move · P place pad · L label · C calibrate scale.
 * Pads are true-size rectangles once the drawing is calibrated; labels draw leaders to the
 * item's pads automatically (nearest label wins when an item has several labels).
 * Rendering geometry comes from TIM.geom.layout — identical to the PNG / Excel export.
 */
(function () {
  'use strict';
  const TIM = window.TIM;
  if (!TIM.ui) return;
  const { html, useState, useRef, useEffect, useMemo, useCallback, Icon, cx, go, usePref, TextField, NumField, SelectField, Field, confirm, prompt, toast, openMenu, pickFile } = TIM.ui;
  const { util, schema, calc, geom } = TIM;
  const A = () => TIM.actions;

  const TOOLS = [
    { id: 'select', label: '選取', icon: 'cursor', key: 'V' },
    { id: 'place', label: '放置 TIM', icon: 'square', key: 'P' },
    { id: 'label', label: '標籤', icon: 'tag', key: 'L' },
    { id: 'calib', label: '比例尺', icon: 'ruler', key: 'C' },
  ];
  const LEADER_COLORS = ['#FACC15', '#FFFFFF', '#22D3EE', '#F472B6', '#111827'];
  const HANDLE = 7;   // screen px

  async function imageToView(pid, file, name, locationId) {
    const rec = await TIM.image.fromBlob(file, file.name || name);
    let viewId = null;
    TIM.store.mutateProject(pid, pp => {
      const imageId = TIM.store.addImage(rec);
      const v = schema.newView({ name: name || '視圖', location_id: locationId || null, image_id: imageId, img_w: rec.w, img_h: rec.h });
      pp.views.push(v);
      viewId = v.id;
    }, { changes: [{ kind: 'add', target: 'view', text: '新增位置視圖：' + (name || '視圖') }] });
    return viewId;
  }

  async function askNewView(p, file) {
    const used = new Set(p.views.map(v => v.location_id));
    const loc = p.locations.find(l => !used.has(l.id));
    const name = await prompt({ title: '新增位置視圖', label: '視圖名稱', value: loc ? loc.name : '視圖 ' + (p.views.length + 1), hint: '例如 Bottom case、Top case、Heatsink', validate: v => (v.trim() ? '' : '請輸入名稱') });
    if (!name) return null;
    const match = p.locations.find(l => l.name.trim().toUpperCase() === name.trim().toUpperCase()) || loc || null;
    const id = await imageToView(p.id, file, name.trim(), match ? match.id : null);
    toast('已新增視圖「' + name.trim() + '」— 下一步：用「比例尺」點兩點輸入實際長度，之後放置的 pad 就是實際尺寸', 'ok', { timeout: 7000 });
    return id;
  }

  // ───────── editor ─────────
  function MapEditor(props) {
    const p = props.p;
    const st = TIM.store;
    const db = st.db;
    const ro = st.readonly;
    const view = p.views.find(v => v.id === props.route.sub) || p.views[0] || null;
    const img = view && view.image_id ? db.images[view.image_id] : null;

    const [tool, setTool] = useState('select');
    const [activeItem, setActiveItem] = useState(null);
    const [sel, setSel] = useState({ kind: null, ids: [] });
    const [cam, setCam] = useState({ z: 1, tx: 0, ty: 0, fitted: false });
    const [draft, setDraftState] = useState(null);     // {shapes:{id:{...}}, callouts:{id:{...}}} during drag
    const draftRef = useRef(null);
    const setDraft = d => { draftRef.current = d; setDraftState(d); };
    const [ghost, setGhost] = useState(null);           // place-mode preview {x,y}
    const [placeRot, setPlaceRot] = useState(0);
    const [calibPts, setCalibPts] = useState(null);     // {p1, p2?}
    const [drawRect, setDrawRect] = useState(null);     // {x0,y0,x1,y1}
    const [space, setSpace] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [showCalib, setShowCalib] = usePref('map_show_calib', false);
    const stageRef = useRef(null);
    const dragRef = useRef(null);
    const camRef = useRef(cam);
    camRef.current = cam;

    // reset per view
    useEffect(() => { setSel({ kind: null, ids: [] }); setDraft(null); setCalibPts(null); setCam(c => Object.assign({}, c, { fitted: false })); }, [view && view.id]);

    // fit to stage
    const fit = useCallback(() => {
      const el = stageRef.current;
      if (!el || !view || !view.img_w) return;
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      const z = Math.min(cw / view.img_w, ch / view.img_h) * 0.94;
      setCam({ z, tx: (cw - view.img_w * z) / 2, ty: (ch - view.img_h * z) / 2, fitted: true });
    }, [view && view.id, view && view.img_w, view && view.img_h]);
    useEffect(() => { if (!cam.fitted) fit(); });
    useEffect(() => {
      const el = stageRef.current;
      if (!el || typeof ResizeObserver === 'undefined') return;
      let last = el.clientWidth + 'x' + el.clientHeight;
      const ro2 = new ResizeObserver(() => { const k = el.clientWidth + 'x' + el.clientHeight; if (k !== last) { last = k; fit(); } });
      ro2.observe(el);
      return () => ro2.disconnect();
    }, [fit]);

    // layout with drag draft applied
    const viewDraft = useMemo(() => {
      if (!view) return null;
      if (!draft) return view;
      return Object.assign({}, view, {
        shapes: view.shapes.map(s => (draft.shapes && draft.shapes[s.id] ? Object.assign({}, s, draft.shapes[s.id]) : s)),
        callouts: view.callouts.map(c => (draft.callouts && draft.callouts[c.id] ? Object.assign({}, c, draft.callouts[c.id]) : c)),
      });
    }, [view, draft, st.version]);
    const L = useMemo(() => (viewDraft && img ? geom.layout(viewDraft, p, { measure: TIM.renderView.measure }) : null), [viewDraft, img, st.version]);
    const ppm = view ? geom.pxPerMm(view) : null;
    const itemsById = {};
    p.items.forEach(it => { itemsById[it.id] = it; });
    const placedAll = calc.placedCounts(p);
    const active = activeItem && itemsById[activeItem] ? itemsById[activeItem] : null;

    // ── coordinate helpers ──
    const toImg = e => {
      const r = stageRef.current.getBoundingClientRect();
      const c = camRef.current;
      return { x: (e.clientX - r.left - c.tx) / c.z, y: (e.clientY - r.top - c.ty) / c.z };
    };
    const hs = HANDLE / cam.z;   // handle size in image px

    const hitPad = (x, y) => { if (!L) return null; for (let i = L.pads.length - 1; i >= 0; i--) if (geom.pointInPad(x, y, L.pads[i])) return L.pads[i]; return null; };
    const hitCallout = (x, y) => { if (!L) return null; for (let i = L.callouts.length - 1; i >= 0; i--) if (geom.pointInBox(x, y, L.callouts[i].box)) return L.callouts[i]; return null; };

    // ── commits ──
    const commitView = (fn, label) => A().editView(p.id, view.id, fn, label || null);
    const deleteSelection = () => {
      if (!sel.ids.length || ro) return;
      const ids = new Set(sel.ids);
      commitView(v => {
        if (sel.kind === 'shape') {
          v.shapes = v.shapes.filter(s => !ids.has(s.id));
          v.callouts.forEach(c => { if (Array.isArray(c.targets)) c.targets = c.targets.filter(t => !ids.has(t)); });
        } else v.callouts = v.callouts.filter(c => !ids.has(c.id));
      });
      setSel({ kind: null, ids: [] });
    };
    const duplicateSelection = () => {
      if (!sel.ids.length || ro) return;
      const newIds = [];
      commitView(v => {
        const dx = 0.02, dy = 0.02;
        if (sel.kind === 'shape') v.shapes.filter(s => sel.ids.includes(s.id)).forEach(s => { const n = Object.assign({}, s, { id: util.uid('shp'), cx: Math.min(0.99, s.cx + dx), cy: Math.min(0.99, s.cy + dy) }); v.shapes.push(n); newIds.push(n.id); });
        else v.callouts.filter(c => sel.ids.includes(c.id)).forEach(c => { const n = Object.assign({}, c, { id: util.uid('cal'), x: Math.min(0.98, c.x + dx), y: Math.min(0.98, c.y + dy), targets: Array.isArray(c.targets) ? c.targets.slice() : null }); v.callouts.push(n); newIds.push(n.id); });
      });
      setSel({ kind: sel.kind, ids: newIds });
    };
    const rotateSelection = d => {
      if (sel.kind !== 'shape' || !sel.ids.length || ro) return;
      commitView(v => { v.shapes.forEach(s => { if (sel.ids.includes(s.id)) s.rot = (((s.rot || 0) + d) % 360 + 360) % 360; }); });
    };
    const nudge = (dx, dy) => {
      if (!sel.ids.length || ro) return;
      const nx = dx / cam.z / view.img_w, ny = dy / cam.z / view.img_h;
      commitView(v => {
        if (sel.kind === 'shape') v.shapes.forEach(s => { if (sel.ids.includes(s.id)) { s.cx = util.clamp(s.cx + nx, 0, 1); s.cy = util.clamp(s.cy + ny, 0, 1); } });
        else v.callouts.forEach(c => { if (sel.ids.includes(c.id)) { c.x = util.clamp(c.x + nx, 0, 1); c.y = util.clamp(c.y + ny, 0, 1); } });
      }, 'nudge');
    };

    // ── keyboard (handler kept in a ref so it is never one render stale) ──
    const keyRef = useRef(null);
    keyRef.current = {
      down: e => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
        if (document.querySelector('.modal-backdrop')) return;
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key;
        if (k === ' ' && !space) { setSpace(true); e.preventDefault(); return; }
        if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); duplicateSelection(); return; }
        if (mod) return;
        if (k === 'v' || k === 'V') setTool('select');
        else if ((k === 'p' || k === 'P') && !ro) setTool('place');
        else if ((k === 'l' || k === 'L') && !ro) setTool('label');
        else if ((k === 'c' || k === 'C') && !ro) { setTool('calib'); setCalibPts(null); }
        else if (k === 'r' || k === 'R') { if (tool === 'place') setPlaceRot(r => (r + (e.shiftKey ? 45 : 90)) % 360); else rotateSelection(e.shiftKey ? 45 : 90); }
        else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelection(); }
        else if (k === 'Escape') { if (calibPts) setCalibPts(null); else if (tool !== 'select') setTool('select'); else setSel({ kind: null, ids: [] }); }
        else if (k === '0') fit();
        else if (k === '+' || k === '=') zoomBy(1.2);
        else if (k === '-') zoomBy(1 / 1.2);
        else if (k.startsWith('Arrow') && sel.ids.length) {
          e.preventDefault();
          const s = e.shiftKey ? 10 : 1;
          nudge(k === 'ArrowLeft' ? -s : k === 'ArrowRight' ? s : 0, k === 'ArrowUp' ? -s : k === 'ArrowDown' ? s : 0);
        } else return;
      },
      up: e => { if (e.key === ' ') setSpace(false); },
    };
    useEffect(() => {
      const onKey = e => keyRef.current.down(e);
      const onUp = e => keyRef.current.up(e);
      window.addEventListener('keydown', onKey);
      window.addEventListener('keyup', onUp);
      return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onUp); };
    }, []);

    // paste an image → new view
    useEffect(() => {
      const onPaste = async e => {
        const t = e.target;
        if (ro || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) return;
        const f = TIM.image.imageFromDataTransfer(e.clipboardData);
        if (!f) return;
        e.preventDefault();
        const id = await askNewView(p, f);
        if (id) go('p/' + p.id + '/map/' + id);
      };
      window.addEventListener('paste', onPaste);
      return () => window.removeEventListener('paste', onPaste);
    }, [p.id, ro]);

    function zoomBy(f, cxs, cys) {
      const el = stageRef.current;
      if (!el) return;
      const c = camRef.current;
      const mx = cxs == null ? el.clientWidth / 2 : cxs, my = cys == null ? el.clientHeight / 2 : cys;
      const z = util.clamp(c.z * f, 0.05, 30);
      setCam({ z, tx: mx - (mx - c.tx) * (z / c.z), ty: my - (my - c.ty) * (z / c.z), fitted: true });
    }
    const onWheel = e => {
      e.preventDefault();
      const r = stageRef.current.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    };
    useEffect(() => {
      const el = stageRef.current;
      if (!el) return;
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    });

    // ── pointer handling ──
    const startDrag = (e, d) => {
      dragRef.current = Object.assign({ sx: e.clientX, sy: e.clientY, moved: false }, d);
      const move = ev => onDragMove(ev);
      const up = ev => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); onDragEnd(ev); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    const onStageDown = e => {
      if (!view || !img) return;
      stageRef.current.focus({ preventScroll: true });
      const pt = toImg(e);
      if (e.button === 1 || space || (e.button === 0 && e.altKey && tool === 'select')) { e.preventDefault(); startDrag(e, { type: 'pan', cam0: cam }); return; }
      if (e.button !== 0) return;
      const handle = e.target.closest && e.target.closest('[data-handle]');
      if (tool === 'select') {
        if (handle && sel.kind === 'shape' && sel.ids.length === 1) {
          const pad = L.pads.find(x => x.id === sel.ids[0]);
          if (pad) { startDrag(e, { type: handle.dataset.handle === 'rot' ? 'rotate' : 'resize', corner: handle.dataset.handle, pad, shape: view.shapes.find(s => s.id === pad.id) }); return; }
        }
        const c = hitCallout(pt.x, pt.y);
        if (c) {
          const ids = e.shiftKey && sel.kind === 'callout' ? (sel.ids.includes(c.id) ? sel.ids.filter(x => x !== c.id) : sel.ids.concat(c.id)) : (sel.kind === 'callout' && sel.ids.includes(c.id) ? sel.ids : [c.id]);
          setSel({ kind: 'callout', ids });
          if (!ro) startDrag(e, { type: 'move', kind: 'callout', ids, p0: pt, orig: view.callouts.filter(x => ids.includes(x.id)).map(x => ({ id: x.id, x: x.x, y: x.y })) });
          return;
        }
        const pad = hitPad(pt.x, pt.y);
        if (pad) {
          const ids = e.shiftKey && sel.kind === 'shape' ? (sel.ids.includes(pad.id) ? sel.ids.filter(x => x !== pad.id) : sel.ids.concat(pad.id)) : (sel.kind === 'shape' && sel.ids.includes(pad.id) ? sel.ids : [pad.id]);
          setSel({ kind: 'shape', ids });
          if (pad.item_id) setActiveItem(pad.item_id);
          if (!ro) startDrag(e, { type: 'move', kind: 'shape', ids, p0: pt, orig: view.shapes.filter(x => ids.includes(x.id)).map(x => ({ id: x.id, cx: x.cx, cy: x.cy })) });
          return;
        }
        if (!e.shiftKey) setSel({ kind: null, ids: [] });
        startDrag(e, { type: 'pan', cam0: cam });
        return;
      }
      if (ro) return;
      if (tool === 'place') {
        if (!active) { toast('請先在左側選擇要放置的 Item', 'warn'); return; }
        const trueSize = ppm && active.size && active.size.l > 0 && active.size.w > 0;
        if (trueSize) { addPad(pt, null); return; }
        startDrag(e, { type: 'draw', p0: pt });
        setDrawRect({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
        return;
      }
      if (tool === 'label') {
        if (!active) { toast('請先在左側選擇要標示的 Item', 'warn'); return; }
        const c = schema.newCallout({ item_id: active.id, x: util.clamp(pt.x / view.img_w, 0, 1), y: util.clamp(pt.y / view.img_h, 0, 1) });
        commitView(v => { v.callouts.push(c); });
        setSel({ kind: 'callout', ids: [c.id] });
        setTool('select');
        return;
      }
      if (tool === 'calib') {
        const q = clampPt(pt);
        if (!calibPts || calibPts.p2) { setCalibPts({ p1: q, p2: null, hover: q }); return; }
        const p2 = e.shiftKey ? snapAxis(calibPts.p1, q) : q;
        finishCalib(calibPts.p1, p2);
      }
    };

    const clampPt = pt => ({ x: util.clamp(pt.x, 0, view.img_w), y: util.clamp(pt.y, 0, view.img_h) });
    const snapAxis = (a, b) => (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? { x: b.x, y: a.y } : { x: a.x, y: b.y });

    async function finishCalib(p1, p2) {
      const dpx = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (dpx < 5) { toast('兩點太近，請在圖上選兩個距離已知的點（例如機殼外框寬度）', 'warn'); setCalibPts(null); return; }
      setCalibPts({ p1, p2 });
      const mm = await prompt({ title: '比例尺校正', label: '這兩點的實際距離', unit: 'mm', numeric: true, placeholder: '例如 408',
        hint: '量測長度 ' + util.fmt(dpx, 1) + ' px。建議選最長的已知尺寸（機殼外框），誤差最小。',
        validate: v => { const n = util.num(v); return n && n > 0 ? '' : '請輸入大於 0 的數字'; } });
      setCalibPts(null);
      setTool('select');
      if (!mm) return;
      const n = util.num(mm);
      A().updateView(p.id, view.id, { calib: { x1: p1.x / view.img_w, y1: p1.y / view.img_h, x2: p2.x / view.img_w, y2: p2.y / view.img_h, mm: n } });
      toast('比例尺：1 mm = ' + util.fmt(dpx / n, 2) + ' px。之後放置的 pad 會依 Item 的 L × W 自動成為實際大小', 'ok', { timeout: 6000 });
    }

    function addPad(pt, rect) {
      const s = schema.newShape({ item_id: active.id, cx: util.clamp(pt.x / view.img_w, 0, 1), cy: util.clamp(pt.y / view.img_h, 0, 1), rot: placeRot, size_mode: 'item' });
      if (rect) {
        s.size_mode = 'manual';
        s.rot = 0;
        s.w = Math.max(2, rect.w) / view.img_w;
        s.h = Math.max(2, rect.h) / view.img_h;
      } else if (!(ppm && active.size && active.size.l > 0 && active.size.w > 0)) {
        const d = Math.min(view.img_w, view.img_h) * 0.04;
        s.size_mode = 'manual'; s.w = d / view.img_w; s.h = d / view.img_h;
      }
      commitView(v => { v.shapes.push(s); });
      setSel({ kind: 'shape', ids: [s.id] });
    }

    const onDragMove = ev => {
      const d = dragRef.current;
      if (!d) return;
      if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 3) d.moved = true;
      if (d.type === 'pan') { setCam({ z: d.cam0.z, tx: d.cam0.tx + ev.clientX - d.sx, ty: d.cam0.ty + ev.clientY - d.sy, fitted: true }); return; }
      const pt = toImg(ev);
      if (d.type === 'move' && d.moved) {
        const dx = (pt.x - d.p0.x) / view.img_w, dy = (pt.y - d.p0.y) / view.img_h;
        const m = {};
        if (d.kind === 'shape') { d.orig.forEach(o => { m[o.id] = { cx: util.clamp(o.cx + dx, 0, 1), cy: util.clamp(o.cy + dy, 0, 1) }; }); setDraft({ shapes: m }); }
        else { d.orig.forEach(o => { m[o.id] = { x: util.clamp(o.x + dx, 0, 1), y: util.clamp(o.y + dy, 0, 1) }; }); setDraft({ callouts: m }); }
      } else if (d.type === 'rotate') {
        let a = Math.atan2(pt.y - d.pad.cy, pt.x - d.pad.cx) * 180 / Math.PI + 90;
        if (!ev.altKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 360) % 360;
        setDraft({ shapes: { [d.pad.id]: { rot: a } } });
      } else if (d.type === 'resize') {
        // keep the opposite corner fixed; work in the pad's local frame
        const r = -d.pad.rot * Math.PI / 180;
        const lx = (pt.x - d.pad.cx) * Math.cos(r) - (pt.y - d.pad.cy) * Math.sin(r);
        const ly = (pt.x - d.pad.cx) * Math.sin(r) + (pt.y - d.pad.cy) * Math.cos(r);
        const sx = d.corner.includes('e') ? 1 : -1, sy = d.corner.includes('s') ? 1 : -1;
        const fx = -sx * d.pad.w / 2, fy = -sy * d.pad.h / 2;          // fixed corner (local)
        let w = Math.max(3, (lx - fx) * sx), h = Math.max(3, (ly - fy) * sy);
        if (ev.shiftKey) { const k = Math.max(w / d.pad.w, h / d.pad.h); w = d.pad.w * k; h = d.pad.h * k; }
        const clx = fx + sx * w / 2, cly = fy + sy * h / 2;            // new centre (local)
        const rr = d.pad.rot * Math.PI / 180;
        const ncx = d.pad.cx + clx * Math.cos(rr) - cly * Math.sin(rr);
        const ncy = d.pad.cy + clx * Math.sin(rr) + cly * Math.cos(rr);
        setDraft({ shapes: { [d.pad.id]: { size_mode: 'manual', w: w / view.img_w, h: h / view.img_h, cx: ncx / view.img_w, cy: ncy / view.img_h } } });
      } else if (d.type === 'draw') {
        setDrawRect({ x0: d.p0.x, y0: d.p0.y, x1: pt.x, y1: pt.y });
      }
    };

    const onDragEnd = ev => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      if (d.type === 'draw') {
        const r = drawRectFrom(d.p0, toImg(ev));
        setDrawRect(null);
        if (r.w < 4 && r.h < 4) addPad({ x: d.p0.x, y: d.p0.y }, null);
        else addPad({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, r);
        return;
      }
      if (d.type === 'pan' || !d.moved) { setDraft(null); return; }
      const dr = draftRef.current;
      setDraft(null);
      if (!dr) return;
      commitView(v => {
        if (dr.shapes) v.shapes.forEach(s => { if (dr.shapes[s.id]) Object.assign(s, dr.shapes[s.id]); });
        if (dr.callouts) v.callouts.forEach(c => { if (dr.callouts[c.id]) Object.assign(c, dr.callouts[c.id]); });
      });
    };
    const drawRectFrom = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) });

    const onStageMove = e => {
      if (!view || !img) return;
      if (tool === 'place' && active && !dragRef.current) setGhost(toImg(e));
      if (tool === 'calib' && calibPts && !calibPts.p2) {
        const q = clampPt(toImg(e));
        setCalibPts(Object.assign({}, calibPts, { hover: e.shiftKey ? snapAxis(calibPts.p1, q) : q }));
      }
    };

    // drop image files on the stage
    const onDrop = async e => {
      e.preventDefault();
      setDragOver(false);
      if (ro) return;
      const f = TIM.image.imageFromDataTransfer(e.dataTransfer);
      if (!f) return;
      const id = await askNewView(p, f);
      if (id) go('p/' + p.id + '/map/' + id);
    };

    // ── view-level operations ──
    const replaceImage = async () => {
      const f = await pickFile('image/*');
      if (!f) return;
      const rec = await TIM.image.fromBlob(f, f.name);
      const ratioOld = view.img_w / view.img_h, ratioNew = rec.w / rec.h;
      if (Math.abs(ratioOld - ratioNew) / ratioOld > 0.03 && (view.shapes.length || view.callouts.length)) {
        const ok = await confirm({ title: '更換圖片', message: '新圖片的長寬比與原圖不同（' + util.fmt(ratioOld, 3) + ' → ' + util.fmt(ratioNew, 3) + '），已放置的 pad 與標籤位置會依比例變形，比例尺也需重新校正。確定更換？', okText: '更換' });
        if (!ok) return;
      }
      TIM.store.mutateProject(p.id, pp => {
        const id = TIM.store.addImage(rec);
        const v = pp.views.find(x => x.id === view.id);
        v.image_id = id; v.img_w = rec.w; v.img_h = rec.h;
        if (Math.abs(ratioOld - ratioNew) / ratioOld > 0.03) v.calib = null;
      }, { changes: [{ kind: 'edit', target: 'view', target_id: view.id, field: '位置圖圖片', from: '', to: f.name, text: '' }] });
    };
    const rotateImage = async dir => {
      const imgRec = db.images[view.image_id];
      const r = await TIM.image.rotate90(imgRec.data, dir);
      const W = view.img_w, H = view.img_h;
      TIM.store.mutateProject(p.id, pp => {
        const id = TIM.store.addImage(Object.assign({ name: imgRec.name }, r));
        const v = pp.views.find(x => x.id === view.id);
        const tf = dir > 0 ? (x, y) => [1 - y, x] : (x, y) => [y, 1 - x];
        v.shapes.forEach(s => { const [nx, ny] = tf(s.cx, s.cy); s.cx = nx; s.cy = ny; s.rot = ((s.rot || 0) + (dir > 0 ? 90 : 270)) % 360; const w = s.w * W / H, h = s.h * H / W; s.w = w; s.h = h; });
        v.callouts.forEach(c => { const [nx, ny] = tf(c.x, c.y); c.x = nx; c.y = ny; });
        if (v.calib) { const a = tf(v.calib.x1, v.calib.y1), b = tf(v.calib.x2, v.calib.y2); v.calib = Object.assign({}, v.calib, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
        v.image_id = id; v.img_w = r.w; v.img_h = r.h;
      });
      setCam(c => Object.assign({}, c, { fitted: false }));
    };
    const deleteView = async () => {
      const ok = await confirm({ title: '刪除位置視圖', danger: true, okText: '刪除', message: '刪除「' + view.name + '」？圖上 ' + view.shapes.length + ' 片 pad 與 ' + view.callouts.length + ' 個標籤會一併刪除（Item 本身不受影響）。可用 Ctrl+Z 復原。' });
      if (!ok) return;
      A().deleteView(p.id, view.id);
      go('p/' + p.id + '/map', true);
    };

    // ── render ──
    const viewsList = html`<div class="map-side-sec views">
      <h4>視圖 <span class="right"><button class="btn btn-ghost btn-xs rw-only" onClick=${async () => { const f = await pickFile('image/*'); if (f) { const id = await askNewView(p, f); if (id) go('p/' + p.id + '/map/' + id); } }}><${Icon} name="plus" /> 新增</button></span></h4>
      <div class="view-list">
        ${p.views.map((v, i) => html`<div key=${v.id} class=${cx('view-item', view && v.id === view.id && 'active')} onClick=${() => go('p/' + p.id + '/map/' + v.id)}
          onContextMenu=${e => { e.preventDefault(); openMenu(e, [
            { label: '上移', icon: 'chevU', disabled: i === 0 || ro, onClick: () => A().moveView(p.id, v.id, -1) },
            { label: '下移', icon: 'chevD', disabled: i === p.views.length - 1 || ro, onClick: () => A().moveView(p.id, v.id, 1) },
          ]); }}>
          <${Icon} name="image" size=${14} /><span class="name">${v.name || '(未命名)'}</span><span class="cnt">${v.shapes.length}</span>
        </div>`)}
        ${!p.views.length ? html`<div class="muted" style="font-size:12px;padding:4px 2px">尚無視圖</div>` : null}
      </div>
    </div>`;

    const viewLocId = view && view.location_id;
    const paletteGroups = p.locations.slice().sort((a, b) => (a.id === viewLocId ? -1 : b.id === viewLocId ? 1 : 0));
    const palette = html`<div class="map-side-sec pal" style="border-bottom:none">
      <h4>Item 調色盤</h4>
      <div class="muted" style="font-size:11px;margin-bottom:4px">點選 Item → 用「放置」蓋 pad、用「標籤」加說明框</div>
      <div class="palette">
        ${paletteGroups.map(loc => {
          const its = calc.orderedItems(p).filter(it => it.location_id === loc.id && it.status !== 'obsolete');
          if (!its.length) return null;
          return html`<div key=${loc.id}>
            <div class="pal-group"><span class="swatch" style=${{ background: loc.color }}></span>${loc.name}</div>
            ${its.map(it => {
              const n = placedAll[it.id] || 0;
              const ok = it.qty != null && n === it.qty;
              return html`<div key=${it.id} class=${cx('pal-item', activeItem === it.id && 'active')} title=${(it.vendor || '') + ' ' + (it.model || '')}
                onClick=${() => { setActiveItem(it.id); if (tool === 'select' && !ro) setTool('place'); }}>
                <span class="swatch" style=${{ background: calc.itemColor(p, it) }}></span>
                <div style="min-width:0"><div class="no">${it.item_no || '?'}</div><div class="desc">${calc.effective(it, calc.materialOf(db, it)).model || ''} ${TIM.parse.formatSize(it.size)}</div></div>
                <span class=${cx('cnt', ok ? 'ok' : 'bad')} title=${'已放置 ' + n + ' / Q\'ty ' + (it.qty == null ? '?' : it.qty)}>${n}/${it.qty == null ? '?' : it.qty}</span>
              </div>`;
            })}
          </div>`;
        })}
        ${!p.items.length ? html`<div class="muted" style="font-size:12px">先到「TIM 清單」建立 Item。</div>` : null}
      </div>
    </div>`;

    if (!view) {
      return html`<div class="map-layout" style="grid-template-columns:250px 1fr">
        <aside class="map-side left">${viewsList}${palette}</aside>
        <div class="map-center">
          <div class=${cx('map-empty', dragOver && 'drag-over')} onDragOver=${e => { e.preventDefault(); setDragOver(true); }} onDragLeave=${() => setDragOver(false)} onDrop=${onDrop}>
            <div class="box">
              <h3>貼上或拖曳機殼 CAD 截圖</h3>
              <p>每張圖是一個視圖（例如 Bottom case、Top case）。<br/>Ctrl+V 貼上截圖，或把圖片拖到這裡。<br/>接著用「比例尺」點兩個已知距離的點，之後蓋上的 TIM pad 就是實際尺寸。</p>
              <div style="margin-top:16px" class="rw-only"><button class="btn btn-accent" onClick=${async () => { const f = await pickFile('image/*'); if (f) { const id = await askNewView(p, f); if (id) go('p/' + p.id + '/map/' + id); } }}><${Icon} name="image" /> 選擇圖片…</button></div>
            </div>
          </div>
        </div>
      </div>`;
    }

    const selPads = sel.kind === 'shape' ? sel.ids.map(id => L && L.pads.find(x => x.id === id)).filter(Boolean) : [];
    const selCallouts = sel.kind === 'callout' ? sel.ids.map(id => L && L.callouts.find(x => x.id === id)).filter(Boolean) : [];
    const ghostPad = (() => {
      if (tool !== 'place' || !active || !ghost || dragRef.current) return null;
      const s = schema.newShape({ item_id: active.id, cx: ghost.x / view.img_w, cy: ghost.y / view.img_h, rot: placeRot });
      const sz = geom.padSize(view, s, active);
      const w = sz.trueSize ? sz.w : Math.min(view.img_w, view.img_h) * 0.04, h = sz.trueSize ? sz.h : w;
      return { corners: geom.padCorners(ghost.x, ghost.y, w, h, placeRot), color: calc.itemColor(p, active), trueSize: sz.trueSize };
    })();
    const hint = ro ? '唯讀模式' :
      tool === 'place' ? (active ? (ppm && active.size.l ? '點擊放置 ' + active.item_no + '（' + active.size.l + '×' + active.size.w + ' mm 實際尺寸）· R 旋轉 90° · Shift+R 45° · Esc 結束' : '拖曳畫出 ' + active.item_no + ' 的範圍' + (ppm ? '（Item 未填 L×W）' : '（尚未校正比例尺，無法自動實際尺寸）')) : '先在左側選擇 Item') :
      tool === 'label' ? (active ? '點擊放置 ' + active.item_no + ' 的標籤，引線自動連到最近的 ' + active.item_no + ' pad' : '先在左側選擇 Item') :
      tool === 'calib' ? (calibPts && !calibPts.p2 ? '點第二點（Shift 鎖水平 / 垂直）' : '點第一點：選擇圖上一段已知長度（例如機殼外框寬度）') :
      sel.ids.length ? '拖曳移動 · 方向鍵微調（Shift ×10）· R 旋轉 · Ctrl+D 複製 · Delete 刪除' : '點選 pad / 標籤編輯 · 拖曳空白處平移 · 滾輪縮放 · 0 適合畫面';

    const z = cam.z;
    return html`<div class="map-layout">
      <aside class="map-side left">${viewsList}${palette}</aside>

      <div class="map-center">
        <div class="map-tools">
          ${TOOLS.map(t => html`<button class=${cx('tool-btn', tool === t.id && 'on')} disabled=${ro && t.id !== 'select'} title=${t.label + '（' + t.key + '）'}
            onClick=${() => { setTool(t.id); if (t.id === 'calib') setCalibPts(null); }}><${Icon} name=${t.icon} /> ${t.label} <kbd>${t.key}</kbd></button>`)}
          <span class="sep"></span>
          <button class="tool-btn" title="縮小 (-)" onClick=${() => zoomBy(1 / 1.2)}><${Icon} name="zoomOut" /></button>
          <span class="zoom-read">${Math.round(z * 100)}%</span>
          <button class="tool-btn" title="放大 (+)" onClick=${() => zoomBy(1.2)}><${Icon} name="zoomIn" /></button>
          <button class="tool-btn" title="適合畫面 (0)" onClick=${fit}><${Icon} name="fit" /></button>
          <span class="sep"></span>
          <button class="tool-btn" title="下載此視圖 PNG（與 Excel 匯出相同）" onClick=${() => TIM.renderView.downloadViewPng(p, view).catch(e => toast(e.message, 'err'))}><${Icon} name="download" /> PNG</button>
          ${tool === 'place' ? html`<span class="sep"></span><span class="zoom-read" style="min-width:auto">放置角度 ${placeRot}°</span>` : null}
        </div>
        <div ref=${stageRef} tabindex="0" class=${cx('map-stage', 't-' + tool, space && 'space')}
          onMouseDown=${onStageDown} onMouseMove=${onStageMove} onMouseLeave=${() => setGhost(null)}
          onDragOver=${e => { e.preventDefault(); }} onDrop=${onDrop}
          onDblClick=${e => { if (tool !== 'select' || !L) return; const pt = toImg(e); const c = hitCallout(pt.x, pt.y); if (c) editCalloutText(c); }}
          onContextMenu=${e => {
            e.preventDefault();
            if (!L) return;
            const pt = toImg(e);
            const c = hitCallout(pt.x, pt.y), pad = c ? null : hitPad(pt.x, pt.y);
            if (pad) {
              if (!sel.ids.includes(pad.id)) setSel({ kind: 'shape', ids: [pad.id] });
              openMenu(e, [
                { label: '開啟 Item ' + pad.item_no, icon: 'chevR', onClick: () => go('p/' + p.id + '/bom/' + pad.item_id) },
                { label: '旋轉 90°', icon: 'rotate', disabled: ro, onClick: () => rotateSelection(90) },
                { label: '複製', icon: 'copy', kbd: 'Ctrl D', disabled: ro, onClick: duplicateSelection },
                'sep', { label: '刪除', icon: 'trash', danger: true, kbd: 'Del', disabled: ro, onClick: deleteSelection },
              ]);
            } else if (c) {
              if (!sel.ids.includes(c.id)) setSel({ kind: 'callout', ids: [c.id] });
              openMenu(e, [
                { label: '編輯文字…', icon: 'tag', disabled: ro, onClick: () => editCalloutText(c) },
                { label: '複製', icon: 'copy', disabled: ro, onClick: duplicateSelection },
                'sep', { label: '刪除標籤', icon: 'trash', danger: true, disabled: ro, onClick: deleteSelection },
              ]);
            }
          }}>
          ${img && L ? html`<svg>
            <g transform=${'translate(' + cam.tx + ' ' + cam.ty + ') scale(' + z + ')'}>
              <image href=${img.data} x="0" y="0" width=${view.img_w} height=${view.img_h} preserveAspectRatio="none" />
              ${L.pads.map(pd => html`<g key=${pd.id} class="svg-pad">
                <polygon points=${pd.corners.map(c => c.join(',')).join(' ')} fill=${pd.color} fill-opacity=${L.style.fillOpacity}
                  stroke=${pd.stroke} stroke-width=${L.style.padStrokeW} stroke-dasharray=${pd.missing ? (L.style.padStrokeW * 3) + ' ' + (L.style.padStrokeW * 2) : null} />
                ${pd.inside ? html`<text x=${pd.inside.x} y=${pd.inside.y} transform=${'rotate(' + pd.inside.angle + ' ' + pd.inside.x + ' ' + pd.inside.y + ')'}
                  font-family=${geom.FONT_FAMILY} font-weight=${geom.FONT_WEIGHT} font-size=${pd.inside.font} fill=${pd.inside.color}
                  text-anchor="middle" dominant-baseline="central" style="pointer-events:none">${pd.inside.text}</text>` : null}
              </g>`)}
              ${L.callouts.map(c => c.leaders.map((l, i) => html`<g key=${c.id + 'l' + i} style="pointer-events:none">
                <line x1=${l.x1} y1=${l.y1} x2=${l.x2} y2=${l.y2} stroke=${L.style.halo} stroke-opacity="0.75" stroke-width=${L.style.haloW} stroke-linecap="round" />
                <polygon points=${l.arrow.map(a => a.join(',')).join(' ')} fill=${L.style.halo} fill-opacity="0.75" stroke=${L.style.halo} stroke-opacity="0.75" stroke-width=${L.style.haloW - L.style.leaderW} stroke-linejoin="round" />
                <line x1=${l.x1} y1=${l.y1} x2=${l.x2} y2=${l.y2} stroke=${L.style.leader} stroke-width=${L.style.leaderW} stroke-linecap="round" />
                <polygon points=${l.arrow.map(a => a.join(',')).join(' ')} fill=${L.style.leader} />
              </g>`))}
              ${L.callouts.map(c => html`<g key=${c.id} class="svg-callout">
                <rect x=${c.box.x} y=${c.box.y} width=${c.box.w} height=${c.box.h} fill=${L.style.labelBg} stroke=${c.missing ? geom.MISSING : L.style.labelBorder} stroke-width=${L.style.labelBorderW} />
                <text x=${c.cx} y=${c.cy} font-family=${geom.FONT_FAMILY} font-weight=${geom.FONT_WEIGHT} font-size=${c.font} fill=${L.style.labelFg} text-anchor="middle" dominant-baseline="central" style="pointer-events:none">${c.text}</text>
              </g>`)}
              ${L.scaleBar ? html`<g style="pointer-events:none">
                <rect x=${L.scaleBar.x - L.scaleBar.font * 0.4} y=${L.scaleBar.y - L.scaleBar.font * 1.6} width=${L.scaleBar.len + L.scaleBar.font * 0.8} height=${L.scaleBar.font * 2 + L.scaleBar.h} fill=${L.style.labelBg} fill-opacity="0.85" />
                <rect x=${L.scaleBar.x} y=${L.scaleBar.y} width=${L.scaleBar.len} height=${L.scaleBar.h} fill=${L.style.labelFg} />
                <text x=${L.scaleBar.x} y=${L.scaleBar.y - L.scaleBar.font * 0.35} font-family=${geom.FONT_FAMILY} font-weight=${geom.FONT_WEIGHT} font-size=${L.scaleBar.font} fill=${L.style.labelFg}>${L.scaleBar.text}</text>
              </g>` : null}

              ${(showCalib || tool === 'calib') && view.calib ? html`<g style="pointer-events:none">
                <line x1=${view.calib.x1 * view.img_w} y1=${view.calib.y1 * view.img_h} x2=${view.calib.x2 * view.img_w} y2=${view.calib.y2 * view.img_h} stroke="#22D3EE" stroke-width=${2 / z} stroke-dasharray=${(6 / z) + ' ' + (4 / z)} />
                <circle cx=${view.calib.x1 * view.img_w} cy=${view.calib.y1 * view.img_h} r=${4 / z} fill="#22D3EE" />
                <circle cx=${view.calib.x2 * view.img_w} cy=${view.calib.y2 * view.img_h} r=${4 / z} fill="#22D3EE" />
              </g>` : null}
              ${calibPts ? html`<g style="pointer-events:none">
                <line x1=${calibPts.p1.x} y1=${calibPts.p1.y} x2=${(calibPts.p2 || calibPts.hover || calibPts.p1).x} y2=${(calibPts.p2 || calibPts.hover || calibPts.p1).y} stroke="#22D3EE" stroke-width=${2.5 / z} />
                <circle cx=${calibPts.p1.x} cy=${calibPts.p1.y} r=${5 / z} fill="#22D3EE" stroke="#021B3A" stroke-width=${1.5 / z} />
                ${calibPts.p2 || calibPts.hover ? html`<circle cx=${(calibPts.p2 || calibPts.hover).x} cy=${(calibPts.p2 || calibPts.hover).y} r=${5 / z} fill="#22D3EE" stroke="#021B3A" stroke-width=${1.5 / z} />` : null}
              </g>` : null}
              ${ghostPad ? html`<polygon points=${ghostPad.corners.map(c => c.join(',')).join(' ')} fill=${ghostPad.color} fill-opacity="0.45" stroke="#fff" stroke-width=${1.5 / z} stroke-dasharray=${(4 / z) + ' ' + (3 / z)} style="pointer-events:none" />` : null}
              ${drawRect ? html`<rect x=${Math.min(drawRect.x0, drawRect.x1)} y=${Math.min(drawRect.y0, drawRect.y1)} width=${Math.abs(drawRect.x1 - drawRect.x0)} height=${Math.abs(drawRect.y1 - drawRect.y0)}
                fill=${active ? calc.itemColor(p, active) : '#fff'} fill-opacity="0.4" stroke="#fff" stroke-width=${1.5 / z} stroke-dasharray=${(4 / z) + ' ' + (3 / z)} style="pointer-events:none" />` : null}

              ${selPads.map(pd => html`<g key=${'s' + pd.id}>
                <polygon class="svg-sel" points=${geom.padCorners(pd.cx, pd.cy, pd.w + 6 / z, pd.h + 6 / z, pd.rot).map(c => c.join(',')).join(' ')} stroke-width=${1.5 / z} style=${{ strokeDasharray: (4 / z) + ' ' + (3 / z) }} />
                ${selPads.length === 1 && !ro ? html`
                  ${['nw', 'ne', 'se', 'sw'].map((k, i) => { const c = pd.corners[i]; return html`<rect data-handle=${k} class="svg-handle" x=${c[0] - hs / 2} y=${c[1] - hs / 2} width=${hs} height=${hs} stroke-width=${1.2 / z} style=${{ cursor: (k === 'nw' || k === 'se') ? 'nwse-resize' : 'nesw-resize' }} />`; })}
                  ${(() => { const top = geom.padCorners(pd.cx, pd.cy, pd.w, pd.h + 2 * 22 / z, pd.rot); const tx = (top[0][0] + top[1][0]) / 2, ty = (top[0][1] + top[1][1]) / 2;
                    const mx = (pd.corners[0][0] + pd.corners[1][0]) / 2, my = (pd.corners[0][1] + pd.corners[1][1]) / 2;
                    return html`<line x1=${mx} y1=${my} x2=${tx} y2=${ty} stroke="#fff" stroke-width=${1 / z} style="pointer-events:none" /><circle data-handle="rot" class="svg-rot" cx=${tx} cy=${ty} r=${hs * 0.7} stroke-width=${1.2 / z} />`; })()}
                ` : null}
              </g>`)}
              ${selCallouts.map(c => html`<rect key=${'sc' + c.id} class="svg-sel" x=${c.box.x - 3 / z} y=${c.box.y - 3 / z} width=${c.box.w + 6 / z} height=${c.box.h + 6 / z} stroke-width=${1.5 / z} style=${{ strokeDasharray: (4 / z) + ' ' + (3 / z) }} />`)}
            </g>
          </svg>` : html`<div class="map-empty"><div class="box"><h3>圖片遺失</h3><p>此視圖的圖片不存在（可能是資料庫被手動修改）。請用右側「更換圖片」重新指定。</p></div></div>`}
        </div>
        <div class="map-hint" title=${hint}>${hint}</div>
      </div>

      <aside class="map-side right">
        <${MapProps} p=${p} view=${view} L=${L} sel=${sel} setSel=${setSel} ppm=${ppm} ro=${ro} placedAll=${placedAll}
          replaceImage=${replaceImage} rotateImage=${rotateImage} deleteView=${deleteView} deleteSelection=${deleteSelection}
          showCalib=${showCalib} setShowCalib=${setShowCalib} startCalib=${() => { setTool('calib'); setCalibPts(null); }} />
      </aside>
    </div>`;

    async function editCalloutText(c) {
      if (ro) return;
      const cur = view.callouts.find(x => x.id === c.id);
      const it = itemsById[c.item_id];
      const t = await prompt({ title: '標籤文字', label: '顯示文字（留空 = 使用 Item 編號 ' + (it ? it.item_no : '') + '）', value: cur.text || '' });
      if (t === null) return;
      commitView(v => { v.callouts.find(x => x.id === c.id).text = t.trim(); });
    }
  }

  // ───────── properties panel ─────────
  function MapProps(props) {
    const { p, view, L, sel, ppm, ro, placedAll } = props;
    const db = TIM.store.db;
    const itemOpts = calc.orderedItems(p).map(it => ({ v: it.id, label: (it.item_no || '?') + '  ' + (calc.effective(it, calc.materialOf(db, it)).model || '') }));
    const edit = fn => A().editView(p.id, view.id, fn);
    const img = db.images[view.image_id];
    const inView = {};
    view.shapes.forEach(s => { inView[s.item_id] = (inView[s.item_id] || 0) + 1; });

    let selSec = null;
    if (sel.kind === 'shape' && sel.ids.length) {
      const shapes = view.shapes.filter(s => sel.ids.includes(s.id));
      const s = shapes[0];
      const it = p.items.find(x => x.id === s.item_id);
      const pad = L && L.pads.find(x => x.id === s.id);
      const mmW = pad && ppm ? pad.w / ppm : null, mmH = pad && ppm ? pad.h / ppm : null;
      const mismatch = it && it.size.l && it.size.w && mmW && s.size_mode === 'manual'
        ? Math.max(Math.abs(mmW - it.size.l) / it.size.l, Math.abs(mmH - it.size.w) / it.size.w) : 0;
      const refs = it ? it.covered.flatMap(c => String(c.refdes || '').split(/[,，\s]+/).filter(Boolean).concat(c.part ? [c.part] : [])) : [];
      selSec = html`<div class="map-side-sec">
        <h4>選取的 pad ${shapes.length > 1 ? '× ' + shapes.length : ''}</h4>
        <div class="prop-row"><label>Item</label><${SelectField} value=${s.item_id} allowEmpty=${false} disabled=${ro} options=${itemOpts}
          onChange=${v => edit(vw => { vw.shapes.forEach(x => { if (sel.ids.includes(x.id)) x.item_id = v; }); })} /></div>
        <div class="prop-row"><label>旋轉</label><div class="row" style="gap:4px">
          <${NumField} value=${s.rot || 0} unit="°" disabled=${ro} onChange=${v => edit(vw => { vw.shapes.forEach(x => { if (sel.ids.includes(x.id)) x.rot = (((v || 0) % 360) + 360) % 360; }); })} />
          <button class="icon-btn rw-only" title="旋轉 90°" onClick=${() => edit(vw => { vw.shapes.forEach(x => { if (sel.ids.includes(x.id)) x.rot = ((x.rot || 0) + 90) % 360; }); })}><${Icon} name="rotate" /></button>
        </div></div>
        ${shapes.length === 1 ? html`
          <div class="prop-row"><label>尺寸</label><div style="font-size:12px">
            ${s.size_mode !== 'manual' && pad && pad.trueSize ? html`<span class="text-ok">實際尺寸</span> <span class="mono">${it.size.l} × ${it.size.w} mm</span>`
              : html`<span>手動</span>${mmW ? html` <span class="mono">${util.fmt(mmW, 1)} × ${util.fmt(mmH, 1)} mm</span>` : html` <span class="muted">（未校正）</span>`}`}
          </div></div>
          ${mismatch > 0.08 ? html`<div class="prop-row"><label></label><div class="text-warn" style="font-size:11.5px">與 Item 尺寸差 ${util.fmt(mismatch * 100, 0)}%</div></div>` : null}
          ${s.size_mode === 'manual' && it && it.size.l && it.size.w && ppm && !ro ? html`<div class="prop-row"><label></label>
            <button class="btn btn-secondary btn-xs" onClick=${() => edit(vw => { const x = vw.shapes.find(y => y.id === s.id); x.size_mode = 'item'; })}>套用 Item 實際尺寸</button></div>` : null}
          <div class="prop-row"><label>覆蓋 RefDes</label><div>
            <${TextField} value=${s.ref} list=${'dl-refs-' + s.id} placeholder="U101" disabled=${ro} onChange=${v => edit(vw => { vw.shapes.find(y => y.id === s.id).ref = v; })} />
            <datalist id=${'dl-refs-' + s.id}>${refs.map(r => html`<option value=${r} />`)}</datalist>
          </div></div>
          <div class="prop-row"><label>備註</label><${TextField} value=${s.note} disabled=${ro} onChange=${v => edit(vw => { vw.shapes.find(y => y.id === s.id).note = v; })} /></div>
        ` : null}
        <div class="row mt8" style="gap:6px">
          ${it ? html`<button class="btn btn-ghost btn-xs" onClick=${() => go('p/' + p.id + '/bom/' + it.id)}>開啟 Item</button>` : null}
          <button class="btn btn-ghost btn-xs rw-only" onClick=${props.deleteSelection}><${Icon} name="trash" /> 刪除</button>
        </div>
      </div>`;
    } else if (sel.kind === 'callout' && sel.ids.length) {
      const c = view.callouts.find(x => x.id === sel.ids[0]);
      if (c) {
        const lc = L && L.callouts.find(x => x.id === c.id);
        const pads = view.shapes.filter(s => s.item_id === c.item_id);
        const it = p.items.find(x => x.id === c.item_id);
        const manual = Array.isArray(c.targets);
        selSec = html`<div class="map-side-sec">
          <h4>選取的標籤</h4>
          <div class="prop-row"><label>Item</label><${SelectField} value=${c.item_id} allowEmpty=${false} disabled=${ro} options=${itemOpts}
            onChange=${v => edit(vw => { const x = vw.callouts.find(y => y.id === c.id); x.item_id = v; x.targets = null; })} /></div>
          <div class="prop-row"><label>文字</label><${TextField} value=${c.text} placeholder=${it ? it.item_no : ''} disabled=${ro} onChange=${v => edit(vw => { vw.callouts.find(y => y.id === c.id).text = v; })} /></div>
          <div class="prop-row"><label>引線</label><div class="seg">
            <button class=${!manual ? 'on' : ''} disabled=${ro} onClick=${() => edit(vw => { vw.callouts.find(y => y.id === c.id).targets = null; })}>自動</button>
            <button class=${manual ? 'on' : ''} disabled=${ro} onClick=${() => edit(vw => { vw.callouts.find(y => y.id === c.id).targets = lc ? lc.targetIds.slice() : []; })}>指定</button>
          </div></div>
          <div class="muted" style="font-size:11px;margin:-2px 0 6px">${manual ? '只連到勾選的 pad' : '自動連到本圖中「離這個標籤最近」的 ' + (it ? it.item_no : '') + ' pad'}</div>
          ${manual ? html`<div class="check-list">${pads.map((s, i) => html`<label class="check" key=${s.id}>
            <input type="checkbox" disabled=${ro} checked=${c.targets.includes(s.id)} onChange=${e => edit(vw => { const x = vw.callouts.find(y => y.id === c.id); x.targets = e.target.checked ? x.targets.concat(s.id) : x.targets.filter(t => t !== s.id); })} />
            #${i + 1} ${s.ref || ''}</label>`)}</div>` : html`<div class="mini-stat"><span>連到</span><span class="mono">${lc ? lc.targetIds.length : 0} / ${pads.length} 片</span></div>`}
          <div class="row mt8"><button class="btn btn-ghost btn-xs rw-only" onClick=${props.deleteSelection}><${Icon} name="trash" /> 刪除標籤</button></div>
        </div>`;
      }
    }

    const viewItems = calc.orderedItems(p).filter(it => inView[it.id] || it.location_id === view.location_id);
    return html`
      ${selSec}
      <div class="map-side-sec">
        <h4>視圖</h4>
        <div class="prop-row"><label>名稱</label><${TextField} value=${view.name} disabled=${ro} onChange=${v => A().updateView(p.id, view.id, { name: v }, 'name')} /></div>
        <div class="prop-row"><label>Location</label><${SelectField} value=${view.location_id || ''} emptyLabel="（未指定）" disabled=${ro} options=${p.locations.map(l => ({ v: l.id, label: l.name }))} onChange=${v => A().updateView(p.id, view.id, { location_id: v || null })} /></div>
        <div class="prop-row"><label>比例尺</label><div style="font-size:12px">
          ${ppm ? html`<span class="mono">1 mm = ${util.fmt(ppm, 2)} px</span><div class="muted" style="font-size:11px">基準 ${util.fmt(view.calib.mm, 2)} mm</div>` : html`<span class="text-warn">未校正</span>`}
        </div></div>
        <div class="row wrap rw-only" style="gap:6px;margin:-2px 0 8px 82px">
          <button class="btn btn-secondary btn-xs" onClick=${props.startCalib}><${Icon} name="ruler" /> ${ppm ? '重新校正' : '校正比例尺'}</button>
          ${ppm ? html`<label class="check" style="font-size:11.5px"><input type="checkbox" checked=${props.showCalib} onChange=${e => props.setShowCalib(e.target.checked)} />顯示基準線</label>` : null}
        </div>
        <div class="prop-row"><label>pad 內編號</label><label class="check"><input type="checkbox" disabled=${ro} checked=${view.style.label_inside} onChange=${e => A().updateViewStyle(p.id, view.id, { label_inside: e.target.checked })} /> 空間足夠時顯示</label></div>
        <div class="prop-row"><label>比例尺條</label><label class="check"><input type="checkbox" disabled=${ro} checked=${view.style.show_scale} onChange=${e => A().updateViewStyle(p.id, view.id, { show_scale: e.target.checked })} /> 顯示（需校正）</label></div>
        <div class="prop-row"><label>引線顏色</label><div class="row" style="gap:4px">${LEADER_COLORS.map(c => html`<button title=${c} disabled=${ro} onClick=${() => A().updateViewStyle(p.id, view.id, { leader_color: c })}
          style=${{ width: '18px', height: '18px', background: c, outline: view.style.leader_color === c ? '2px solid var(--d-600)' : 'none', outlineOffset: '1px', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.25)' }}></button>`)}</div></div>
        <div class="prop-row"><label>填色透明度</label><input type="range" min="0.2" max="1" step="0.05" disabled=${ro} value=${view.style.fill_opacity} onInput=${e => A().updateViewStyle(p.id, view.id, { fill_opacity: parseFloat(e.target.value) })} /></div>
        <div class="prop-row"><label>字級</label><input type="range" min="0.5" max="2.5" step="0.1" disabled=${ro} value=${view.style.font_scale} onInput=${e => A().updateViewStyle(p.id, view.id, { font_scale: parseFloat(e.target.value) })} /></div>
        <div class="muted mono" style="font-size:10.5px;margin:2px 0 8px">${view.img_w} × ${view.img_h} px · ${img ? util.fmtBytes(img.bytes || img.data.length) : '—'}</div>
        <div class="row wrap rw-only" style="gap:6px">
          <button class="btn btn-ghost btn-xs" onClick=${props.replaceImage}><${Icon} name="image" /> 更換圖片</button>
          <button class="btn btn-ghost btn-xs" title="向左旋轉 90°（pad 與標籤一起轉）" onClick=${() => props.rotateImage(-1)}>⟲ 90°</button>
          <button class="btn btn-ghost btn-xs" title="向右旋轉 90°（pad 與標籤一起轉）" onClick=${() => props.rotateImage(1)}>⟳ 90°</button>
          <button class="btn btn-ghost btn-xs" onClick=${props.deleteView}><${Icon} name="trash" /> 刪除視圖</button>
        </div>
      </div>
      <div class="map-side-sec" style="border-bottom:none">
        <h4>圖例與片數檢核</h4>
        ${viewItems.length ? viewItems.map(it => {
          const n = placedAll[it.id] || 0;
          const ok = it.qty != null && n === it.qty;
          return html`<div class="mini-stat" key=${it.id} style="align-items:center;gap:6px">
            <span class="row" style="gap:6px"><span class="swatch" style=${{ background: calc.itemColor(p, it) }}></span><span class="mono" style="font-weight:600">${it.item_no}</span>
              <span class="muted" style="font-size:11px">本圖 ${inView[it.id] || 0}</span></span>
            <span class="row" style="gap:4px">
              <span class=${cx('mono', ok ? 'text-ok' : 'text-warn')} title="所有視圖合計 / Q'ty">${n}/${it.qty == null ? '?' : it.qty}</span>
              ${!ok && n > 0 && !ro ? html`<button class="btn btn-secondary btn-xs" title=${"以放置數 " + n + " 更新 Q'ty"} onClick=${() => A().updateItem(p.id, it.id, 'qty', n, { coalesce: false })}>Q'ty=${n}</button>` : null}
            </span>
          </div>`;
        }) : html`<div class="muted" style="font-size:12px">此視圖尚未放置 pad。</div>`}
      </div>`;
  }

  TIM.ui.MapEditor = MapEditor;
})();
