'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openWithDemo, ROOT } = require('./helpers');

const proj = page => page.evaluate(() => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0])));
const shapesOf = (p, no) => { const it = p.items.find(i => i.item_no === no); return p.views.flatMap(v => v.shapes.filter(s => s.item_id === it.id)); };
async function openMap(page) {
  await page.click('.proj-name');
  await page.click('.tab:has-text("位置標註")');
  await page.waitForSelector('.map-stage svg');
  await page.waitForTimeout(300);
}
/** Click at a relative position (0..1) of the drawing in the current view. */
/** Image position once the view has stopped re-fitting (fit-to-stage runs after paint, late on a busy machine). */
async function stableBox(page) {
  let prev = null;
  for (let i = 0; i < 50; i++) {
    const b = await page.locator('.map-stage svg image').boundingBox();
    if (prev && b && ['x', 'y', 'width', 'height'].every(k => Math.abs(b[k] - prev[k]) < 0.5)) return b;
    prev = b;
    await page.waitForTimeout(60);
  }
  return prev;
}
async function clickImg(page, fx, fy, opts) {
  const box = await stableBox(page);
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, opts);
}

module.exports = [
  {
    name: 'place true-size pads, rotate, delete, undo',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openMap(page);
      await page.click('.pal-item:has(.no:text-is("A5"))');
      assert.equal(await page.locator('.tool-btn.on').innerText().then(t => t.includes('放置')), true, 'palette click switches to place tool');
      await clickImg(page, 0.2, 0.2);
      let p = await proj(page);
      assert.equal(shapesOf(p, 'A5').length, 4);
      const placed = shapesOf(p, 'A5')[3];
      assert.equal(placed.size_mode, 'item');
      assert.ok(Math.abs(placed.cx - 0.2) < 0.01 && Math.abs(placed.cy - 0.2) < 0.01);
      await page.keyboard.press('r');                       // rotate the ghost
      await clickImg(page, 0.25, 0.3);
      p = await proj(page);
      assert.equal(shapesOf(p, 'A5')[4].rot, 90);
      await page.keyboard.press('Escape');                  // back to select
      await clickImg(page, 0.25, 0.3);                      // select the rotated pad
      await page.keyboard.press('Delete');
      p = await proj(page);
      assert.equal(shapesOf(p, 'A5').length, 4);
      await page.keyboard.press('Control+z');
      p = await proj(page);
      assert.equal(shapesOf(p, 'A5').length, 5, 'undo restores the deleted pad');
      // legend shows placed / qty mismatch and offers click-to-apply
      await page.click('.map-side.right button:has-text("Q\'ty=5")');
      p = await proj(page);
      assert.equal(p.items.find(i => i.item_no === 'A5').qty, 5);
    },
  },
  {
    name: 'new view from image, two-point calibration, true-size pad, label, PNG export',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openMap(page);
      const chooser = page.waitForEvent('filechooser');
      await page.click('.map-side-sec button:has-text("新增")');
      await (await chooser).setFiles(path.join(ROOT, 'assets/delta-logo-transparent.png'));
      await page.waitForSelector('.modal');
      await page.fill('.modal input.inp', 'Heatsink');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.view-item.active:has-text("Heatsink")');
      // calibrate: left edge → right edge of the 128 px wide image = 64 mm → 2 px/mm
      await page.keyboard.press('c');
      await clickImg(page, 0, 0.5);
      await clickImg(page, 1, 0.5, { modifiers: ['Shift'] });
      await page.waitForSelector('.modal');
      await page.fill('.modal input.inp', '64');
      await page.keyboard.press('Enter');
      let p = await proj(page);
      const hv = p.views.find(v => v.name === 'Heatsink');
      assert.equal(hv.calib.mm, 64);
      const ppm = Math.hypot((hv.calib.x2 - hv.calib.x1) * hv.img_w, (hv.calib.y2 - hv.calib.y1) * hv.img_h) / hv.calib.mm;
      assert.ok(Math.abs(ppm - 2) < 0.05, 'px per mm ≈ 2 (got ' + ppm + ')');
      // place A6 (20.6 × 20.6 mm) → rendered 41.2 px wide on the 128 px image
      await page.click('.pal-item:has(.no:text-is("A6"))');
      await clickImg(page, 0.5, 0.5);
      const w = await page.evaluate(() => {
        const L = TIM.geom.layout(Object.values(TIM.store.db.projects)[0].views.find(v => v.name === 'Heatsink'), Object.values(TIM.store.db.projects)[0]);
        return L.pads[0].w;
      });
      assert.ok(Math.abs(w - 41.2) < 1.5, 'true-size pad width ' + w);
      // label tool
      await page.keyboard.press('l');
      await clickImg(page, 0.15, 0.15);
      p = await proj(page);
      assert.equal(p.views.find(v => v.name === 'Heatsink').callouts.length, 1);
      // PNG export uses the same renderer
      const dl = page.waitForEvent('download');
      await page.click('.tool-btn:has-text("PNG")');
      const file = await (await dl).path();
      const head = fs.readFileSync(file).slice(0, 8).toString('hex');
      assert.equal(head, '89504e470d0a1a0a', 'PNG signature');
    },
  },
  {
    name: 'crop the drawing: drag a box, pads outside are listed and removed, the rest stay on the same spot, calibration kept, undo',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openMap(page);
      const before = await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        const v = p.views[0];
        // pixel position of every pad, and the scale, before cropping
        return { id: v.id, w: v.img_w, h: v.img_h, n: v.shapes.length, ppm: TIM.geom.pxPerMm(v),
          pads: v.shapes.map(s => ({ id: s.id, x: s.cx * v.img_w, y: s.cy * v.img_h })) };
      });
      await page.click('.map-side button:has-text("裁切")');
      await page.waitForSelector('.modal .crop-box img');
      assert.ok(await page.locator('.modal-foot button:has-text("套用裁切")').isDisabled(), 'nothing to apply before a box is drawn');
      // drag a box covering the middle 70 % × 80 % (synthetic pointer events: Playwright mouse would also work)
      // the dialog animates in: measure once the box has stopped moving
      let box = null;
      for (let i = 0; i < 50; i++) {
        const nb = await page.locator('.crop-box').boundingBox();
        if (box && nb && ['x', 'y', 'width', 'height'].every(k => Math.abs(nb[k] - box[k]) < 0.5)) break;
        box = nb;
        await page.waitForTimeout(60);
      }
      const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
      const a = at(0.15, 0.1), b = at(0.85, 0.9);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
      await page.waitForFunction(() => !document.querySelector('.modal-foot .btn-primary').disabled);
      const outside = before.pads.filter(q => q.x < before.w * 0.15 - 2 || q.x > before.w * 0.85 + 2 || q.y < before.h * 0.1 - 2 || q.y > before.h * 0.9 + 2).length;
      const info = await page.locator('.crop-info').innerText();
      if (outside) assert.match(info, new RegExp('範圍外有 ' + outside + ' 片 pad'));
      assert.equal(await page.locator('.crop-dot.out').count(), outside);
      // move the box a little by dragging inside it, then back (stays the same size)
      const mid = at(0.5, 0.5);
      await page.mouse.move(mid.x, mid.y); await page.mouse.down(); await page.mouse.move(mid.x + 10, mid.y, { steps: 3 }); await page.mouse.move(mid.x, mid.y, { steps: 3 }); await page.mouse.up();
      await page.click('.modal-foot button:has-text("套用裁切")');
      await page.waitForSelector('.toast:has-text("已裁切圖片")');
      const after = await page.evaluate(id => { const v = Object.values(TIM.store.db.projects)[0].views.find(x => x.id === id); return JSON.parse(JSON.stringify({ v, ppm: TIM.geom.pxPerMm(v) })); }, before.id);
      assert.ok(Math.abs(after.v.img_w - before.w * 0.7) <= 3 && Math.abs(after.v.img_h - before.h * 0.8) <= 3, after.v.img_w + ' × ' + after.v.img_h + ' of ' + before.w + ' × ' + before.h);
      assert.equal(after.v.shapes.length, before.n - outside);
      if (before.ppm) assert.ok(Math.abs(after.ppm - before.ppm) < 1e-6, 'calibration unchanged');
      // every kept pad is on the same spot of the drawing (pixel offset = crop origin)
      const kept = after.v.shapes.map(s => ({ id: s.id, x: s.cx * after.v.img_w, y: s.cy * after.v.img_h }));
      const ox = before.pads.find(q => q.id === kept[0].id).x - kept[0].x, oy = before.pads.find(q => q.id === kept[0].id).y - kept[0].y;
      kept.forEach(k => { const q = before.pads.find(x => x.id === k.id); assert.ok(Math.abs(q.x - k.x - ox) < 1e-6 && Math.abs(q.y - k.y - oy) < 1e-6); });
      assert.ok(Math.abs(ox - before.w * 0.15) <= 3 && Math.abs(oy - before.h * 0.1) <= 3, 'offset = crop origin: ' + ox + ', ' + oy);
      // the editor shows the cropped drawing; undo restores the original image and pads
      await page.waitForFunction(w => { const i = document.querySelector('.map-stage svg image'); return i && Number(i.getAttribute('width')) === w; }, after.v.img_w);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(([id, w, n]) => { const v = Object.values(TIM.store.db.projects)[0].views.find(x => x.id === id); return v.img_w === w && v.shapes.length === n; }, [before.id, before.w, before.n]);
    },
  },
];
