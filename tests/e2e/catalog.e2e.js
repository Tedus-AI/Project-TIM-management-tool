'use strict';
// TIM 型號目錄: tim_catalog.json next to tim_db.json on SharePoint, read by the other thermal tools.
const assert = require('node:assert/strict');
const { fakeDrive, setup, allowHttp, saved, openSp } = require('./fake-sharepoint');

const CAT = 'TIM_Manager/Database/tim_catalog.json';

module.exports = [
  {
    name: 'TIM 型號目錄: written when the SharePoint database opens and after material changes only (k, delete); the library says who reads it',
    async run(env) {
      const { page, base } = env;
      await env.context.addInitScript(() => { window.__TIM_TEST_CATALOG_ON = true; });
      const g = fakeDrive();
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      // missing → written on open
      await page.waitForFunction(() => TIM.catalogSync.state.at);
      let cat = g.json(CAT);
      assert.equal(cat.format, 'tim-catalog');
      assert.deepEqual(cat.materials, []);
      const puts = () => g.log.filter(l => l.method === 'PUT' && l.p.includes('tim_catalog.json')).length;
      assert.equal(puts(), 1);
      // a material → in the catalog with its family
      const mid = await page.evaluate(() => TIM.actions.createMaterial({ vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7.5, k_method: 'ASTM D5470', price_ref: 'USD 1' }));
      await saved(page);
      await page.evaluate(() => TIM.catalogSync.flush());
      cat = g.json(CAT);
      assert.deepEqual(cat.materials.map(m => [m.id, m.vendor, m.model, m.family, m.k, m.k_method]), [[mid, 'Vendor-B', 'GF-750', 'Pad', 7.5, 'ASTM D5470']]);
      assert.ok(!JSON.stringify(cat).includes('USD'), 'no prices');
      assert.equal(cat.updated_by, 'Tester A');
      // a project change does not touch the catalog
      const n = puts();
      await page.evaluate(() => TIM.actions.createProject({ name: 'Proj-1' }));
      await saved(page);
      await page.evaluate(() => TIM.catalogSync.flush());
      assert.equal(puts(), n, 'no write for a project change');
      // k edited → follows; the library tells where the other tools read it
      await page.evaluate(id => TIM.actions.updateMaterial(id, 'k', 8.2), mid);
      await saved(page);
      await page.evaluate(() => TIM.catalogSync.flush());
      assert.equal(g.json(CAT).materials[0].k, 8.2);
      await page.click('a.nav-link:has-text("材料庫")');
      await page.waitForSelector('.catalog-note');
      assert.match(await page.locator('.catalog-note').innerText(), /AI-Thermal（含 5G-RRU）、Thermal Network Visualizer、Report Builder[\s\S]*tim_catalog\.json，.*更新/);
      // deleted → gone (the confirmation says what the other tools do)
      await page.click('tr:has-text("GF-750")');
      await page.waitForSelector('.drawer');
      await page.click('.drawer button[title="刪除材料"]');
      await page.waitForSelector('.modal:has-text("刪除材料")');
      assert.match(await page.locator('.modal-body').innerText(), /TIM 管理工具已刪除/);
      await page.click('.modal-foot button:has-text("刪除材料")');
      await saved(page);
      await page.evaluate(() => TIM.catalogSync.flush());
      assert.deepEqual(g.json(CAT).materials, []);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'TIM 型號目錄: an up-to-date file is not rewritten on open; a newer database revision on SharePoint is never overwritten',
    async run(env) {
      const { page, base } = env;
      await env.context.addInitScript(() => { window.__TIM_TEST_CATALOG_ON = true; });
      const g = fakeDrive();
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      await page.waitForFunction(() => TIM.catalogSync.state.at);
      const puts = () => g.log.filter(l => l.method === 'PUT' && l.p.includes('tim_catalog.json')).length;
      // reload: same content → read, not written
      await page.reload();
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      await page.waitForTimeout(1800);
      await page.evaluate(() => TIM.catalogSync.flush());
      assert.equal(puts(), 1);
      // someone published a newer revision: an older database never replaces it
      const newer = Object.assign(g.json('TIM_Manager/Database/tim_catalog.json'), { db_rev: 999, materials: [{ id: 'mat_x', vendor: 'Vendor-Z', model: 'Z-1', family: 'Pad', k: 1 }] });
      g.put('TIM_Manager/Database/tim_catalog.json', Buffer.from(JSON.stringify(newer)));
      const r = await page.evaluate(() => TIM.catalogSync.publish({ rev: TIM.store.db.rev, materials: { m1: TIM.schema.newMaterial({ id: 'm1', vendor: 'Vendor-A', model: 'Old-1' }) } }));
      assert.equal(r, 'newer');
      assert.equal(g.json(CAT).materials[0].model, 'Z-1');
      allowHttp(env, [404]);
    },
  },
];
