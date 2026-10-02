/* TIM Management Tool — placement map geometry.
 * One layout function feeds both the interactive SVG editor and the canvas/PNG exporter,
 * so what you see is exactly what gets exported. All stored coordinates are relative
 * to the drawing (0…1); this module converts them to natural image pixels.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const util = isNode ? require('./util.js') : root.TIM.util;
  const calc = isNode ? require('./calc.js') : root.TIM.calc;
  const mod = factory(util, calc);
  if (isNode) module.exports = mod;
  else { root.TIM = root.TIM || {}; root.TIM.geom = mod; }
})(typeof self !== 'undefined' ? self : this, function (util, calc) {
  'use strict';

  /** Label font family (system fallbacks keep editor and export metrics aligned). */
  const FONT_FAMILY = '"DM Sans", "Noto Sans TC", "Microsoft JhengHei", Arial, sans-serif';
  const FONT_WEIGHT = 700;
  const fontCss = px => FONT_WEIGHT + ' ' + px.toFixed(2) + 'px ' + FONT_FAMILY;

  const HALO = '#111827';
  const LABEL_BG = '#FFFFFF';
  const LABEL_FG = '#0F1B2D';
  const LABEL_BORDER = '#0F1B2D';
  const MISSING = '#9CA3AF';

  /** Natural image pixels per millimetre from the two-point calibration (null if none). */
  function pxPerMm(view) {
    const c = view && view.calib;
    if (!c || !(c.mm > 0) || !view.img_w || !view.img_h) return null;
    const dx = (c.x2 - c.x1) * view.img_w;
    const dy = (c.y2 - c.y1) * view.img_h;
    const d = Math.hypot(dx, dy);
    return d > 0 ? d / c.mm : null;
  }

  /** Base label font (natural px) — scales with the drawing so labels look the same at any resolution. */
  function baseFont(view) {
    const m = Math.min(view.img_w || 800, view.img_h || 600);
    const scale = (view.style && view.style.font_scale) || 1;
    return util.clamp(m * 0.026, 10, 90) * scale;
  }

  /**
   * Pad size in natural px. 'item' mode + calibration + item L×W → true size (L along local x).
   * Otherwise the stored relative w/h.
   */
  function padSize(view, shape, item) {
    const ppm = pxPerMm(view);
    if (shape.size_mode !== 'manual' && ppm && item && item.size && item.size.l > 0 && item.size.w > 0) {
      return { w: item.size.l * ppm, h: item.size.w * ppm, trueSize: true };
    }
    return { w: Math.max(1, (shape.w || 0.03) * view.img_w), h: Math.max(1, (shape.h || 0.03) * view.img_h), trueSize: false };
  }

  function rot(x, y, cx, cy, deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    const dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }

  function padCorners(cx, cy, w, h, deg) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => rot(cx + x, cy + y, cx, cy, deg));
  }

  /** Point where the ray from the pad centre toward (tx,ty) leaves the rotated rectangle. */
  function rectExit(cx, cy, w, h, deg, tx, ty) {
    const r = -deg * Math.PI / 180;
    const dx0 = tx - cx, dy0 = ty - cy;
    const lx = dx0 * Math.cos(r) - dy0 * Math.sin(r);
    const ly = dx0 * Math.sin(r) + dy0 * Math.cos(r);
    if (lx === 0 && ly === 0) return { x: cx, y: cy };
    const t = Math.min(lx !== 0 ? (w / 2) / Math.abs(lx) : Infinity, ly !== 0 ? (h / 2) / Math.abs(ly) : Infinity);
    const ex = lx * t, ey = ly * t;
    const p = rot(cx + ex, cy + ey, cx, cy, deg);
    return { x: p[0], y: p[1] };
  }

  /** Point where the ray from the box centre toward (tx,ty) leaves the axis-aligned box. */
  function boxExit(box, tx, ty) {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const t = Math.min(dx !== 0 ? (box.w / 2) / Math.abs(dx) : Infinity, dy !== 0 ? (box.h / 2) / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t };
  }

  function pointInPad(px, py, pad) {
    const r = -pad.rot * Math.PI / 180;
    const dx = px - pad.cx, dy = py - pad.cy;
    const lx = dx * Math.cos(r) - dy * Math.sin(r);
    const ly = dx * Math.sin(r) + dy * Math.cos(r);
    return Math.abs(lx) <= pad.w / 2 && Math.abs(ly) <= pad.h / 2;
  }

  function pointInBox(px, py, b) { return px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h; }

  /** Normalise an angle to (-90, 90] so text never renders upside down. */
  function uprightAngle(a) {
    let x = ((a % 180) + 180) % 180;   // [0,180)
    if (x > 90) x -= 180;
    return x;
  }

  const fallbackMeasure = (text, px) => String(text).length * px * 0.6;

  /** Pick a "nice" scale-bar length (mm) for ~15 % of the drawing width. */
  function niceScale(ppm, imgW) {
    const target = imgW * 0.16;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    let best = steps[0];
    steps.forEach(s => { if (s * ppm <= target) best = s; });
    return best;
  }

  /**
   * Compute everything needed to draw a view.
   * opts.measure(text, fontPx) → width in px (canvas measureText in the browser).
   */
  function layout(view, project, opts) {
    opts = opts || {};
    const measure = opts.measure || fallbackMeasure;
    const style = Object.assign({ label_inside: true, leader_color: '#FACC15', fill_opacity: 0.85, font_scale: 1, show_scale: true }, view.style || {});
    const font = baseFont(view);
    const items = {};
    (project.items || []).forEach(it => { items[it.id] = it; });

    const pads = (view.shapes || []).map(s => {
      const item = items[s.item_id] || null;
      const sz = padSize(view, s, item);
      const cx = s.cx * view.img_w, cy = s.cy * view.img_h;
      const color = item ? calc.itemColor(project, item) : MISSING;
      const pad = {
        id: s.id, item_id: s.item_id, item_no: item ? (item.item_no || '?') : '?', missing: !item,
        color, stroke: util.shade(color, 0.35), cx, cy, w: sz.w, h: sz.h, rot: s.rot || 0, trueSize: sz.trueSize,
        corners: padCorners(cx, cy, sz.w, sz.h, s.rot || 0), inside: null, ref: s.ref || '',
      };
      if (style.label_inside) {
        const long = Math.max(sz.w, sz.h), short = Math.min(sz.w, sz.h);
        const f = Math.min(font * 0.9, short * 0.62);
        if (f >= Math.max(6, font * 0.42)) {
          const tw = measure(pad.item_no, f);
          if (tw <= long * 0.88) {
            const angle = uprightAngle((s.rot || 0) + (sz.w >= sz.h ? 0 : 90));
            pad.inside = { text: pad.item_no, x: cx, y: cy, font: f, angle, color: util.textOn(color) };
          }
        }
      }
      return pad;
    });
    const padById = {};
    pads.forEach(p => { padById[p.id] = p; });

    // Auto targets: every pad of an item goes to its nearest auto-callout of that item,
    // so two "A4" labels split the A4 pads by proximity (top group / bottom group).
    const autoTargets = {};
    const autoCallouts = (view.callouts || []).filter(c => !Array.isArray(c.targets));
    pads.forEach(p => {
      let best = null, bestD = Infinity;
      autoCallouts.forEach(c => {
        if (c.item_id !== p.item_id) return;
        const d = Math.hypot(c.x * view.img_w - p.cx, c.y * view.img_h - p.cy);
        if (d < bestD) { bestD = d; best = c.id; }
      });
      if (best) (autoTargets[best] = autoTargets[best] || []).push(p);
    });

    const leaderW = Math.max(1.5, font * 0.11);
    const callouts = (view.callouts || []).map(c => {
      const item = items[c.item_id] || null;
      const text = c.text || (item ? item.item_no : '?') || '?';
      const tw = measure(text, font);
      const w = tw + font * 0.9, h = font * 1.6;
      const cx = c.x * view.img_w, cy = c.y * view.img_h;
      const box = { x: cx - w / 2, y: cy - h / 2, w, h };
      const targets = Array.isArray(c.targets)
        ? c.targets.map(id => padById[id]).filter(Boolean)
        : (autoTargets[c.id] || []);
      const leaders = [];
      const arrowLen = font * 0.62, arrowHalf = font * 0.3;
      targets.forEach(p => {
        if (pointInPad(cx, cy, p)) return;                    // label sits on the pad itself
        const start = boxExit(box, p.cx, p.cy);
        const tip = rectExit(p.cx, p.cy, p.w, p.h, p.rot, cx, cy);
        const dx = tip.x - start.x, dy = tip.y - start.y;
        const len = Math.hypot(dx, dy);
        if (len < font * 0.6) return;
        const ux = dx / len, uy = dy / len;
        const bx = tip.x - ux * arrowLen, by = tip.y - uy * arrowLen;
        leaders.push({
          target: p.id, x1: start.x, y1: start.y, x2: tip.x - ux * arrowLen * 0.7, y2: tip.y - uy * arrowLen * 0.7,
          arrow: [[tip.x, tip.y], [bx - uy * arrowHalf, by + ux * arrowHalf], [bx + uy * arrowHalf, by - ux * arrowHalf]],
        });
      });
      return { id: c.id, item_id: c.item_id, text, box, font, cx, cy, leaders, missing: !item, auto: !Array.isArray(c.targets), targetIds: targets.map(t => t.id) };
    });

    let scaleBar = null;
    const ppm = pxPerMm(view);
    if (ppm && style.show_scale) {
      const mm = niceScale(ppm, view.img_w);
      const len = mm * ppm;
      const f = font * 0.8;
      scaleBar = { x: font, y: view.img_h - font * 1.0, len, mm, text: mm + ' mm', font: f, h: Math.max(2, font * 0.28) };
    }

    return {
      w: view.img_w, h: view.img_h, font, pads, callouts, scaleBar,
      style: {
        leader: style.leader_color || '#FACC15', halo: HALO, leaderW, haloW: leaderW + Math.max(2, font * 0.16),
        padStrokeW: Math.max(1, font * 0.07), fillOpacity: style.fill_opacity == null ? 0.85 : style.fill_opacity,
        labelBg: LABEL_BG, labelFg: LABEL_FG, labelBorder: LABEL_BORDER, labelBorderW: Math.max(1, font * 0.08),
      },
    };
  }

  /**
   * Draw a layout on a 2D canvas context (export). The background image must already
   * be drawn by the caller; scale converts natural px to canvas px.
   */
  function drawLayout(ctx, L, scale) {
    const s = scale || 1;
    ctx.save();
    ctx.scale(s, s);
    // pads
    L.pads.forEach(p => {
      ctx.beginPath();
      p.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = L.style.fillOpacity;
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = L.style.padStrokeW;
      ctx.strokeStyle = p.stroke;
      if (p.missing) ctx.setLineDash([L.style.padStrokeW * 3, L.style.padStrokeW * 2]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (p.inside) {
        ctx.save();
        ctx.translate(p.inside.x, p.inside.y);
        ctx.rotate(p.inside.angle * Math.PI / 180);
        ctx.font = fontCss(p.inside.font);
        ctx.fillStyle = p.inside.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.inside.text, 0, p.inside.font * 0.04);
        ctx.restore();
      }
    });
    // leaders (halo first, then colour) and arrowheads
    L.callouts.forEach(c => c.leaders.forEach(l => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = L.style.halo; ctx.globalAlpha = 0.75; ctx.lineWidth = L.style.haloW;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.beginPath(); l.arrow.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.lineJoin = 'round'; ctx.lineWidth = L.style.haloW - L.style.leaderW; ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = L.style.leader; ctx.lineWidth = L.style.leaderW;
      ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();
      ctx.fillStyle = L.style.leader;
      ctx.beginPath(); l.arrow.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
    }));
    // label boxes
    L.callouts.forEach(c => {
      ctx.fillStyle = L.style.labelBg;
      ctx.strokeStyle = c.missing ? MISSING : L.style.labelBorder;
      ctx.lineWidth = L.style.labelBorderW;
      ctx.fillRect(c.box.x, c.box.y, c.box.w, c.box.h);
      ctx.strokeRect(c.box.x, c.box.y, c.box.w, c.box.h);
      ctx.font = fontCss(c.font);
      ctx.fillStyle = L.style.labelFg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, c.cx, c.cy + c.font * 0.04);
    });
    // scale bar
    if (L.scaleBar) {
      const b = L.scaleBar;
      ctx.fillStyle = L.style.labelBg;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(b.x - b.font * 0.4, b.y - b.font * 1.6, b.len + b.font * 0.8, b.font * 1.6 + b.h + b.font * 0.4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = L.style.labelFg;
      ctx.fillRect(b.x, b.y, b.len, b.h);
      ctx.font = fontCss(b.font);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(b.text, b.x, b.y - b.font * 0.35);
    }
    ctx.restore();
  }

  /**
   * Crop a view's drawing to r = { x, y, w, h } (fractions of the current image; snap to whole pixels
   * first). Coordinates are remapped so everything stays on the same spot of the drawing and the
   * calibration (px / mm) is unchanged. Pads whose centre falls outside are dropped; labels are kept
   * (moved inside the edge) while they still point at a pad, otherwise dropped.
   * → { shapes, callouts, calib, removedShapes, removedCallouts }  (new arrays; the view is not modified)
   */
  function cropRemap(view, r) {
    const f = (x, y) => [(x - r.x) / r.w, (y - r.y) / r.h];
    const inside = (x, y) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
    const kept = new Set(), keptItems = new Set();
    let removedShapes = 0, removedCallouts = 0;
    const shapes = (view.shapes || []).map(s => Object.assign({}, s)).filter(s => {
      const [x, y] = f(s.cx, s.cy);
      if (!inside(x, y)) { removedShapes++; return false; }
      Object.assign(s, { cx: x, cy: y, w: s.w / r.w, h: s.h / r.h });
      kept.add(s.id); if (s.item_id) keptItems.add(s.item_id);
      return true;
    });
    const callouts = (view.callouts || []).map(c => Object.assign({}, c, Array.isArray(c.targets) ? { targets: c.targets.filter(t => kept.has(t)) } : {})).filter(c => {
      const alive = Array.isArray(c.targets) ? c.targets.length > 0 : keptItems.has(c.item_id);
      if (!alive) { removedCallouts++; return false; }
      const [x, y] = f(c.x, c.y);
      c.x = util.clamp(x, 0.01, 0.99); c.y = util.clamp(y, 0.01, 0.99);
      return true;
    });
    let calib = view.calib || null;
    if (calib) { const a = f(calib.x1, calib.y1), b = f(calib.x2, calib.y2); calib = Object.assign({}, calib, { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); }
    return { shapes, callouts, calib, removedShapes, removedCallouts };
  }

  /** Crop rectangle snapped to whole pixels of a W × H image (fractions in, fractions out). */
  function snapCrop(r, W, H) {
    const x0 = util.clamp(Math.round(r.x * W), 0, W - 1), y0 = util.clamp(Math.round(r.y * H), 0, H - 1);
    const x1 = util.clamp(Math.round((r.x + r.w) * W), x0 + 1, W), y1 = util.clamp(Math.round((r.y + r.h) * H), y0 + 1, H);
    return { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H, px: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }

  return {
    FONT_FAMILY, FONT_WEIGHT, fontCss, HALO, MISSING,
    pxPerMm, baseFont, padSize, padCorners, rectExit, boxExit, pointInPad, pointInBox, uprightAngle,
    layout, drawLayout, niceScale, cropRemap, snapCrop,
  };
});
