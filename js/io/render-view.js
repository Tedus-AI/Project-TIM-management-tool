/* Render a placement view (drawing + pads + callouts + scale bar) to a canvas / PNG.
 * Uses TIM.geom.layout + drawLayout — the same geometry as the on-screen editor. */
(function () {
  'use strict';
  const TIM = window.TIM;

  let measureCtx = null;
  /** Canvas text measurement shared by editor and exporter (same font string → same box sizes). */
  function measure(text, px) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = TIM.geom.fontCss(px);
    return measureCtx.measureText(String(text)).width;
  }

  async function ensureFonts() {
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) { /* ignore */ }
  }

  /**
   * → HTMLCanvasElement. opts.maxSide limits the output size (default: natural size, max 2400).
   */
  async function renderViewCanvas(project, view, opts) {
    opts = opts || {};
    await ensureFonts();
    const img = view.image_id && TIM.store.db.images[view.image_id];
    if (!img) throw new Error('視圖「' + view.name + '」沒有圖片');
    const el = await TIM.image.loadImg(img.data);
    const W = view.img_w || el.naturalWidth, H = view.img_h || el.naturalHeight;
    const maxSide = opts.maxSide || 2400;
    const scale = Math.min(1, maxSide / Math.max(W, H)) * (opts.scale || 1);
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale); c.height = Math.round(H * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(el, 0, 0, c.width, c.height);
    const L = TIM.geom.layout(Object.assign({}, view, { img_w: W, img_h: H }), project, { measure });
    TIM.geom.drawLayout(ctx, L, scale);
    return c;
  }

  async function renderViewPng(project, view, opts) {
    const c = await renderViewCanvas(project, view, opts);
    const dataUrl = c.toDataURL('image/png');
    return { dataUrl, width: c.width, height: c.height };
  }

  async function downloadViewPng(project, view) {
    const c = await renderViewCanvas(project, view);
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    TIM.ui.downloadBlob(blob, TIM.util.fileSafe(project.name) + '_' + TIM.util.fileSafe(view.name || 'view') + '.png');
  }

  TIM.renderView = { measure, renderViewCanvas, renderViewPng, downloadViewPng };
})();
