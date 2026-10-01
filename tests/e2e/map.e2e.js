'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openTrialWithDemo, ROOT } = require('./helpers');

const proj = page => page.evaluate(() => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0])));
const shapesOf = (p, no) => { const it = p.items.find(i => i.item_no === no); return p.views.flatMap(v => v.shapes.filter(s => s.item_id === it.id)); };
async function openMap(page) {
  await page.click('.proj-name');
  await page.click('.tab:has-text("位置標註")');
  await page.waitForSelector('.map-stage svg');
  await page.waitForTimeout(300);
}
/** Click at a relative position (0..1) of the drawing in the current view. */
async function clickImg(page, fx, fy, opts) {
  const box = await page.locator('.map-stage svg image').boundingBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, opts);
}

module.exports = [
  {
    name: 'place true-size pads, rotate, delete, undo',
    async run(env) {
      const { page } = env;
      await openTrialWithDemo(env);
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
      await openTrialWithDemo(env);
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
];
