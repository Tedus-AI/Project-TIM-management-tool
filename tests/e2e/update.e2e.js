'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { addDemo, ROOT } = require('./helpers');

/**
 * Pretend to be a deployed site: index.html stamped with `site.served`, version.json reporting
 * `site.online` (what the deploy would publish), so a test can "deploy" a new build mid-session.
 */
async function deployedSite(env, site) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  await env.context.route(u => new URL(u).pathname === '/', route =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html.replace(/__BUILD_VERSION__/g, site.served) }));
  await env.context.route(u => new URL(u).pathname === '/version.json', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: site.online }) }));
}

/** Database file whose writes survive the reload (mirrored to Node through an exposed function). */
async function attachPersistentFile(page, disk) {
  await page.exposeFunction('__persist', text => { disk.text = text; });
  await page.evaluate(() => {
    let text = '';
    const handle = {
      name: 'tim_db.json', kind: 'file',
      async getFile() { return new File([text], 'tim_db.json', { type: 'application/json' }); },
      async createWritable() {
        if (window.__failWrites) throw new Error('disk full');
        let buf = '';
        return { async write(t) { buf += t; }, async close() { text = buf; await window.__persist(buf); } };
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    window.__failWrites = false;
    TIM.fileBackend.__setHandleForTest(handle);
    window.__attach = TIM.app.attach(TIM.fileBackend);
  });
  return page.evaluate(() => window.__attach);
}
const meta = page => page.evaluate(() => document.querySelector('meta[name="tim-version"]').content);

module.exports = [
  {
    name: 'new build online → notice, the cell being typed is saved, page reloads on the new build',
    async run(env) {
      const { page, base } = env;
      const site = { served: 'b1', online: 'b1' };
      const disk = { text: '' };
      await deployedSite(env, site);
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await page.locator('.gate-version').innerText(), 'b1');
      assert.equal(await attachPersistentFile(page, disk), true);
      await addDemo(page);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.waitForSelector('table.grid');
      await page.locator('[data-cell="0,5"]').fill('51.5*9*4');     // Size cell (after Model, k): parsed on blur, still focused
      site.served = site.online = 'b2';
      await page.evaluate(() => TIM.app.checkVersion());
      await page.waitForSelector('.update-box:has-text("b1 → b2")');
      assert.match(await page.locator('.update-box').innerText(), /10 秒後自動更新/);
      // countdown expiry (what the timer calls): focus is still in the field, nothing clicked
      await Promise.all([page.waitForNavigation(), page.evaluate(() => { TIM.app.applyUpdate(); })]);
      await page.waitForSelector('.gate');
      assert.equal(await meta(page), 'b2', 'reloaded on the new build');
      assert.equal(new URL(page.url()).search, '', '?v= removed from the address bar');
      const a11 = Object.values(JSON.parse(disk.text).projects)[0].items.find(i => i.item_no === 'A1-1');
      assert.equal(a11.size.t, 4, 'the cell being typed was committed and saved before the reload');
      assert.equal(await page.evaluate(() => sessionStorage.getItem('tim_update_attempt')), null, 'loop guard cleared');
    },
  },
  {
    name: 'start page updates on its own after a short countdown',
    async run(env) {
      const { page, base } = env;
      const site = { served: 'b1', online: 'b1' };
      await deployedSite(env, site);
      await page.goto(base);
      await page.waitForSelector('.gate');
      site.served = site.online = 'b2';
      await page.evaluate(() => TIM.app.checkVersion());
      await page.waitForSelector('.update-box:has-text("3 秒後自動更新")');
      await page.waitForFunction(() => document.querySelector('meta[name="tim-version"]') && document.querySelector('meta[name="tim-version"]').content === 'b2', null, { timeout: 8000 });
      await page.waitForSelector('.gate');
      assert.equal(await page.locator('.update-backdrop').count(), 0);
    },
  },
  {
    name: 'a failed save blocks the update; reload loops stop after two tries',
    async run(env) {
      const { page, base } = env;
      const site = { served: 'b1', online: 'b1' };
      const disk = { text: '' };
      await deployedSite(env, site);
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await attachPersistentFile(page, disk), true);
      await addDemo(page);
      await page.evaluate(() => TIM.store.flush());
      await page.click('.proj-name');
      await page.evaluate(() => { window.__failWrites = true; });
      await page.locator('.field:has(label:text-is("客戶")) input').fill('Unsaved-1');
      site.online = 'b2';
      await page.evaluate(() => TIM.app.checkVersion());
      await page.click('.update-box button:has-text("立即更新")');
      await page.waitForSelector('.update-box:has-text("存檔失敗")');
      assert.equal(await meta(page), 'b1', 'no reload over unsaved work');
      assert.equal(new URL(page.url()).search, '');
      // loop guard: this build was already reloaded twice for b3 → only a banner, no forced reload
      await page.evaluate(() => { TIM.app.update = null; sessionStorage.setItem('tim_update_attempt', JSON.stringify({ to: 'b3', n: 2 })); TIM.store.emit(); });
      site.online = 'b3';
      await page.evaluate(() => TIM.app.checkVersion());
      await page.waitForSelector('.update-banner:has-text("b3")');
      assert.equal(await page.locator('.update-backdrop').count(), 0);
      // the failed writes were provoked on purpose; any other browser error still fails the test
      const other = env.errors.filter(e => !/save failed Error: disk full/.test(e));
      env.errors.length = 0; env.errors.push(...other);
    },
  },
];
