'use strict';
// 已發行 TIM: Delta part numbers of every project's TIM list, and adding them to another TIM list.
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

module.exports = [
  {
    name: '已發行 TIM: P/Ns from every TIM list (placeholders left out, different specs flagged), where-used → item; a new TIM list adds them (part attributes only), undo',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      const demo = await page.evaluate(() => Object.values(TIM.store.db.projects)[0]);
      // a placeholder P/N is not a part number; the same P/N with another size in another project is flagged
      const newId = await page.evaluate(id => {
        const p = TIM.store.db.projects[id];
        TIM.actions.updateItem(id, p.items.find(i => i.item_no === 'A2').id, 'delta_pn', 'N/A');
        const other = TIM.actions.createProject({ name: 'Proj-Old' });
        TIM.actions.insertItems(other, [{ fields: { item_no: 'X1', delta_pn: 'demo-0005', vendor: 'Vendor-C', model: 'TP-800', size: { l: 8, w: 6, t: 2.5 }, qty: 3 } }]);
        return TIM.actions.createProject({ name: 'Proj-New' });
      }, demo.id);
      await page.click('a.nav-link:has-text("已發行 TIM")');
      await page.waitForSelector('h1:text-is("已發行 TIM")');
      const rows = page.locator('.rel-tbl > tbody > tr:not(.rel-detail)');
      assert.equal(await rows.count(), 9, '9 items (A2 now N/A: its old P/N stays, as no longer used)');
      assert.match(await page.locator('.eyebrow').innerText(), /Released TIM · 9/i);
      const pns = await rows.locator('td:first-child b').allInnerTexts();
      assert.ok(pns.includes('DEMO-0003') && !pns.includes('N/A'));
      assert.match(await rows.filter({ hasText: 'DEMO-0003' }).innerText(), /已無專案使用/);
      // (attributes from the most recently updated of the two projects — either size, both listed as different specs)
      const r5 = rows.filter({ hasText: /DEMO-0005/i });
      const t5 = await r5.innerText();
      assert.match(t5, /規格不一致[\s\S]*Vendor-C\s+TP-800[\s\S]*(6\*6|8\*6)\*2\.5/);
      assert.ok(/DEMO-RRU/.test(t5) && /Proj-Old/.test(t5) && /\s2$/.test(t5.trim()), t5);
      // search, then where-used → the item in its project
      await page.fill('.searchbox input', 'proj-old');
      assert.equal(await rows.count(), 1);
      await rows.first().click();
      const detail = page.locator('.rel-detail');
      assert.match(await detail.innerText(), /同一料號的規格不同/);
      assert.match(await detail.innerText(), /Proj-Old[\s\S]*X1/);
      await detail.locator('tr.clickable:has-text("X1")').click();
      await page.waitForSelector('.drawer h2:text-is("X1")');
      // a new project's TIM list: 從已發行 TIM 新增
      await page.evaluate(id => { location.hash = '#/p/' + id + '/bom'; }, newId);
      await page.waitForSelector('.empty:has-text("從已發行 TIM 新增")');
      await page.click('.empty button:has-text("從已發行 TIM 新增")');
      await page.waitForSelector('.modal:has-text("從已發行 TIM 新增")');
      const pick = page.locator('.modal .rel-pick tbody tr');
      assert.equal(await pick.count(), 9);
      assert.equal(await page.locator('.modal-foot .btn-primary').isDisabled(), true, 'nothing picked yet');
      await page.fill('.modal .searchbox input', 'GF-600HD');
      assert.equal(await pick.count(), 2);
      await pick.filter({ hasText: 'DEMO-0101' }).click();
      await page.fill('.modal .searchbox input', '');
      await pick.filter({ hasText: 'DEMO-0004' }).locator('input').check();
      await page.selectOption('.modal-foot select', { label: 'Top Case' });
      assert.match(await page.locator('.modal-foot .btn-primary').innerText(), /新增 2 個 Item/);
      await page.click('.modal-foot .btn-primary');
      await page.waitForSelector('.modal', { state: 'detached' });
      const added = await page.evaluate(id => JSON.parse(JSON.stringify(TIM.store.db.projects[id])), newId);
      assert.equal(added.items.length, 2);
      const src = n => demo.items.find(i => i.delta_pn === n);
      const top = added.locations.find(l => l.name === 'Top Case').id;
      for (const n of ['DEMO-0004', 'DEMO-0101']) {
        const it = added.items.find(i => i.delta_pn === n);
        assert.ok(it, n + ' added');
        assert.equal(it.location_id, top);
        assert.equal(it.material_id, src(n).material_id, 'linked to the same material');
        assert.deepEqual(it.size, src(n).size);
        assert.deepEqual(it.sources.map(s => s.vendor), src(n).sources.map(s => s.vendor));
        assert.deepEqual([it.qty, it.used_on, it.covered, it.gap.nom], [null, [], [], null], 'project-specific fields left empty');
      }
      assert.deepEqual(added.items.map(i => i.item_no), ['A1', 'A2']);
      assert.match(added.changelog.slice(-1)[0].text, /從已發行 TIM 新增 2 個 Item/);
      // the toolbar button; a P/N already in this project is marked
      await page.waitForSelector('.bom-toolbar button:has-text("從已發行 TIM 新增")');
      await page.click('.bom-toolbar button:has-text("從已發行 TIM 新增")');
      await page.waitForSelector('.modal .rel-pick');
      assert.match(await pick.filter({ hasText: 'DEMO-0101' }).innerText(), /此專案已有/);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached' });
      // one undo step
      await page.click('.proj-head-actions button[title^="復原"]');
      await page.waitForFunction(id => TIM.store.db.projects[id].items.length === 0, newId);
    },
  },
  {
    name: '已發行 TIM: a P/N no project uses any more stays listed (已無專案使用, last uses), filter, still quick-addable, removable; deleting a project keeps its P/Ns',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      const demo = await page.evaluate(() => Object.values(TIM.store.db.projects)[0]);
      // A8 (DEMO-0103) deleted from the TIM list; a second project with its own P/N deleted altogether
      const otherId = await page.evaluate(id => {
        const p = TIM.store.db.projects[id];
        TIM.actions.deleteItems(id, [p.items.find(i => i.item_no === 'A8').id]);
        const other = TIM.actions.createProject({ name: 'Proj-Gone' });
        TIM.actions.insertItems(other, [{ fields: { item_no: 'G1', delta_pn: 'DEMO-0900', vendor: 'Vendor-B', model: 'GEL-9', tim_type: 'gel', dispense: { amount: 0.3, unit: 'g' }, qty: 2 } }]);
        TIM.actions.deleteProject(other);
        return other;
      }, demo.id);
      assert.ok(otherId);
      await page.click('a.nav-link:has-text("已發行 TIM")');
      await page.waitForSelector('h1:text-is("已發行 TIM")');
      const rows = page.locator('.rel-tbl > tbody > tr:not(.rel-detail)');
      assert.equal(await rows.count(), 10, '9 live P/Ns − A8 + 2 archived');
      const r103 = rows.filter({ hasText: 'DEMO-0103' });
      assert.match(await r103.innerText(), /已無專案使用\s+DEMO-RRU/);
      // filter by usage
      await page.selectOption('select[aria-label="使用狀態"]', 'archived');
      assert.deepEqual(await rows.locator('td:first-child b').allInnerTexts(), ['DEMO-0103', 'DEMO-0900']);
      await page.selectOption('select[aria-label="使用狀態"]', 'live');
      assert.equal(await rows.count(), 8);
      await page.selectOption('select[aria-label="使用狀態"]', '');
      // detail: where it was last used (not clickable any more), and remove
      await rows.filter({ hasText: 'DEMO-0900' }).click();
      const detail = page.locator('.rel-detail');
      assert.match(await detail.innerText(), /已沒有專案使用這個料號[\s\S]*Proj-Gone[\s\S]*G1/);
      assert.equal(await detail.locator('tr.clickable').count(), 0);
      // still offered by the quick add of a TIM list
      await page.evaluate(id => { location.hash = '#/p/' + id + '/bom'; }, demo.id);
      await page.waitForSelector('.bom-toolbar button:has-text("從已發行 TIM 新增")');
      await page.click('.bom-toolbar button:has-text("從已發行 TIM 新增")');
      const pick = page.locator('.modal .rel-pick tbody tr');
      await page.waitForSelector('.modal .rel-pick');
      assert.match(await pick.filter({ hasText: 'DEMO-0900' }).innerText(), /已無專案使用\s+Proj-Gone/);
      await pick.filter({ hasText: 'DEMO-0103' }).click();
      await page.click('.modal-foot .btn-primary');
      await page.waitForSelector('.modal', { state: 'detached' });
      const back = await page.evaluate(id => TIM.store.db.projects[id].items.filter(i => i.delta_pn === 'DEMO-0103').map(i => [i.vendor, i.model, i.size.l, i.size.w, i.size.t]), demo.id);
      assert.equal(back.length, 1, 'the archived P/N added back with its attributes: ' + JSON.stringify(back));
      assert.deepEqual(back[0].slice(2), [58, 22, 3]);
      // live again → no 已無專案使用 tag; the other one removed from the list
      await page.click('a.nav-link:has-text("已發行 TIM")');
      await page.waitForSelector('h1:text-is("已發行 TIM")');
      assert.ok(!/已無專案使用/.test(await rows.filter({ hasText: 'DEMO-0103' }).innerText()));
      await rows.filter({ hasText: 'DEMO-0900' }).click();
      await page.click('.rel-detail button:has-text("從已發行 TIM 移除")');
      await page.waitForSelector('.modal:has-text("從已發行 TIM 移除")');
      await page.click('.modal-foot button:has-text("移除")');
      await page.waitForSelector('.modal', { state: 'detached' });
      await page.waitForFunction(() => !document.querySelector('.rel-tbl') || !/DEMO-0900/.test(document.querySelector('.rel-tbl').innerText));
      assert.equal(await rows.count(), 9);
      // saved: the archive and the removal are in the database file
      await page.evaluate(() => TIM.store.flush());
      const saved = await page.evaluate(() => Object.values(TIM.store.db.released).map(r => r.pn));
      assert.deepEqual(saved, ['DEMO-0103'], 'the record of a P/N used again stays (hidden behind the live one)');
    },
  },
];
