/* Image helpers: read a File / Blob, downscale, and keep whichever of PNG / JPEG is
 * smaller (CAD screenshots stay crisp as PNG; photos shrink as JPEG). */
(function () {
  'use strict';
  const TIM = window.TIM;
  const MAX_SIDE = 2400;

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('無法讀取圖片'));
      img.src = src;
    });
  }

  /** → { data, w, h, name, bytes } */
  async function fromBlob(blob, name) {
    const src = await readAsDataURL(blob);
    const img = await loadImg(src);
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('圖片尺寸無效');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const isSvg = /^data:image\/svg/.test(src);
    if (scale === 1 && !isSvg && src.length < 900 * 1024) return { data: src, w, h, name: name || '', bytes: src.length };
    const cw = Math.round(w * scale), ch = Math.round(h * scale);
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    const png = c.toDataURL('image/png');
    const jpg = c.toDataURL('image/jpeg', 0.9);
    let data = png.length <= jpg.length * 1.15 ? png : jpg;   // prefer PNG unless much larger
    if (!isSvg && scale === 1 && src.length < data.length) data = src;
    return { data, w: cw, h: ch, name: name || '', bytes: data.length };
  }

  /** First image in a paste / drop event (null when none). */
  function imageFromDataTransfer(dt) {
    if (!dt) return null;
    const items = dt.items ? Array.from(dt.items) : [];
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
    }
    const files = dt.files ? Array.from(dt.files) : [];
    return files.find(f => /^image\//.test(f.type)) || null;
  }

  /** Rotate an image data URL by ±90° → { data, w, h }. */
  async function rotate90(dataUrl, dir) {
    const img = await loadImg(dataUrl);
    const w = img.naturalWidth, h = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = h; c.height = w;
    const ctx = c.getContext('2d');
    ctx.translate(h / 2, w / 2);
    ctx.rotate((dir > 0 ? 90 : -90) * Math.PI / 180);
    ctx.drawImage(img, -w / 2, -h / 2);
    const png = c.toDataURL('image/png');
    const jpg = c.toDataURL('image/jpeg', 0.9);
    const data = png.length <= jpg.length * 1.15 ? png : jpg;
    return { data, w: h, h: w, bytes: data.length };
  }

  /** Crop (fractions of the image) → { data, w, h }. */
  async function crop(dataUrl, r) {
    const img = await loadImg(dataUrl);
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * W)); c.height = Math.max(1, Math.round(r.h * H));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, r.x * W, r.y * H, r.w * W, r.h * H, 0, 0, c.width, c.height);
    const png = c.toDataURL('image/png');
    const jpg = c.toDataURL('image/jpeg', 0.9);
    const data = png.length <= jpg.length * 1.15 ? png : jpg;
    return { data, w: c.width, h: c.height, bytes: data.length };
  }

  TIM.image = { readAsDataURL, loadImg, fromBlob, imageFromDataTransfer, rotate90, crop };
})();
