'use strict';
// 元件快選: covered components entered before (same project or another one) fill a new covered row.
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

const itemIn = (page, proj, no) => page.evaluate(([pn, n]) => {
  const p = Object.values(TIM.store.db.projects).find(x => x.name === pn);
  return JSON.parse(JSON.stringify(p.items.find(i => i.item_no === n) || null));
}, [proj, no]);

module.exports = [
  {
    name: '元件快選: list of components used before, ↓ Enter / click picks, typed exact part fills on leave, Esc closes the list only, Note column + imported rows in another project',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      const demo = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].name);
      // heights + allowable load on the TRX of A6 (the demo has power, package and top % already)
      await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        TIM.store.mutateProject(p.id, pp => {
          Object.assign(pp.items.find(i => i.item_no === 'A6').covered[0], { h_min: 1.1, h_nom: 1.2, h_max: 1.3, p_allow: 2, p_unit: 'kgf' });
        });
      });
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=0 >> .row-end button[title^="詳細"]');
      await page.waitForSelector('.drawer h2:text-is("A1-1")');
      await page.waitForTimeout(300);
      const rows = page.locator('#d-cov tbody tr');
      const cov = async i => (await itemIn(page, demo, 'A1-1')).covered[i];

      // 新增元件 → the new part number field has focus and lists the components used before
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForFunction(() => document.activeElement && document.activeElement.closest('#d-cov .part-field'));
      await page.waitForSelector('#d-cov .suggest .suggest-row');
      assert.ok(await page.locator('#d-cov .suggest-row').count() >= 5);
      // typing filters; no exact match → nothing preselected (Enter would keep the typed text)
      await page.keyboard.type('trx');
      await page.waitForFunction(() => document.querySelectorAll('#d-cov .suggest-row').length === 1);
      const sug = await page.locator('#d-cov .suggest-row').innerText();
      for (const re of [/TRX-1235/, /功耗 4\.5 W/, /頂面 70%/, /封裝 17 × 17/, /高度 1\.1 \/ 1\.2 \/ 1\.3/, /耐壓 2 kgf/, /A6/]) assert.match(sug, re);
      assert.equal(await page.locator('#d-cov .suggest-row.on').count(), 0);
      await page.keyboard.press('ArrowDown');
      await page.waitForSelector('#d-cov .suggest-row.on');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#d-cov .suggest', { state: 'detached' });
      let c = await cov(1);
      assert.deepEqual([c.part, c.cat, c.power_w, c.top_pct, c.pkg_l, c.pkg_w, c.h_min, c.h_nom, c.h_max, c.p_allow, c.p_unit, c.refdes, c.qty],
        ['TRX-1235', 'RF', 4.5, 70, 17, 17, 1.1, 1.2, 1.3, 2, 'kgf', '', 1]);
      assert.equal(await rows.nth(1).locator('.part-field input').inputValue(), 'TRX-1235');
      assert.equal(await rows.nth(1).locator('td >> nth=4 >> input').inputValue(), '4.5');
      await page.waitForSelector('.toast:has-text("已帶入 TRX-1235")');
      assert.match(await page.locator('#d-gap .h-table').innerText(), /TRX-1235/);
      assert.match(await page.locator('#d-hist').innerText(), /元件快選/);
      // the pick is one undo step: back to the typed text, then forward again
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => document.querySelector('#d-cov tbody tr:nth-child(2) .part-field input').value === 'trx');
      c = await cov(1);
      assert.deepEqual([c.part, c.power_w, c.h_nom], ['trx', null, null]);
      await page.keyboard.press('Control+y');
      await page.waitForFunction(() => document.querySelector('#d-cov tbody tr:nth-child(2) .part-field input').value === 'TRX-1235');

      // another row: Esc closes the list only, the drawer stays
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForSelector('#d-cov tbody tr:nth-child(3) .suggest');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#d-cov .suggest', { state: 'detached' });
      assert.equal(await page.locator('.drawer h2:text-is("A1-1")').count(), 1);
      // typed by hand: the exact part is preselected; leaving with Tab fills only the empty fields (typed spelling and the row's category stay)
      await page.keyboard.type('buck-8627');
      await page.waitForSelector('#d-cov .suggest-row.on:has-text("BUCK-8627")');
      await page.keyboard.press('Tab');
      await page.waitForSelector('.toast:has-text("已帶入 buck-8627")');
      c = await cov(2);
      assert.deepEqual([c.part, c.cat, c.power_w, c.top_pct, c.pkg_l, c.pkg_w], ['buck-8627', 'RF', 0.8, 30, 4, 4]);
      // leaving a part number nobody used before changes nothing else
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForSelector('#d-cov tbody tr:nth-child(4) .suggest');
      await page.keyboard.type('NEW-IC-77');
      await page.waitForSelector('#d-cov .suggest', { state: 'detached' });
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      c = await cov(3);
      assert.deepEqual([c.part, c.power_w, c.pkg_l], ['NEW-IC-77', null, null]);
      // mouse: click a suggestion (focus stays, the typed text does not come back on blur)
      await rows.nth(3).locator('.part-field input').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('pll');
      await page.click('#d-cov .suggest-row:has-text("PLL-4368")');
      await page.waitForSelector('#d-cov .suggest', { state: 'detached' });
      await page.locator('#d-cov tbody tr:nth-child(1) td >> nth=8 >> input').click();
      await page.waitForTimeout(200);
      c = await cov(3);
      assert.deepEqual([c.part, c.power_w, c.pkg_l, c.pkg_w, c.top_pct], ['PLL-4368', 0.9, 7, 7, 20]);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.drawer', { state: 'detached' });

      // another project: imported / pasted rows and the Note column take the data of parts used in the demo project
      const pid2 = await page.evaluate(() => {
        const id = TIM.actions.createProject({ name: 'Proj-B' });
        TIM.actions.insertItems(id, [{ fields: { item_no: 'B1' } }, { fields: { item_no: 'B2', covered: [TIM.schema.newCovered({ part: 'mix-1139', qty: 2 })] } }]);
        return id;
      });
      c = (await itemIn(page, 'Proj-B', 'B2')).covered[0];
      assert.deepEqual([c.part, c.qty, c.power_w, c.pkg_l, c.cat], ['mix-1139', 2, 0.6, 5, 'RF']);
      await page.evaluate(id => TIM.ui.go('p/' + id + '/bom'), pid2);
      await page.waitForSelector('table.grid');
      await page.locator('[data-cell="0,7"]').click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('TRX-1235*2, NEWPART');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.toast:has-text("已帶入 1 顆用過的元件資料（TRX-1235）")');
      const b1 = await itemIn(page, 'Proj-B', 'B1');
      assert.deepEqual(b1.covered.map(x => [x.part, x.qty, x.power_w, x.h_nom, x.p_allow, x.p_unit]),
        [['TRX-1235', 2, 4.5, 1.2, 2, 'kgf'], ['NEWPART', 1, null, null, null, 'psi']]);
      const log = await page.evaluate(id => TIM.store.db.projects[id].changelog.map(x => x.text || '').join('\n'), pid2);
      assert.match(log, /元件快選）：TRX-1235/);
      assert.match(log, /元件快選）：mix-1139/);
    },
  },
];
