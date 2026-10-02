'use strict';
// 元件快選: the RefDes field of a covered row drops down the components entered before (same project or another
// one), grouped by 類別; picking one fills the row. Not keyed on the part number: typing one fills nothing.
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

const itemIn = (page, proj, no) => page.evaluate(([pn, n]) => {
  const p = Object.values(TIM.store.db.projects).find(x => x.name === pn);
  return JSON.parse(JSON.stringify(p.items.find(i => i.item_no === n) || null));
}, [proj, no]);

module.exports = [
  {
    name: '元件快選 in RefDes: list grouped by 類別, ↓ Enter / ▾ + click / exact match pick, undo, Esc closes the list only, part numbers fill nothing',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      const demo = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].name);
      // another project whose component carries its name only in RefDes (no part number), with heights + load
      await page.evaluate(() => {
        const id = TIM.actions.createProject({ name: 'Proj-B' });
        TIM.actions.insertItems(id, [{ fields: { item_no: 'B1', covered: [TIM.schema.newCovered({
          refdes: 'BF-7788', cat: 'RF', power_w: 3.2, pkg_l: 11, pkg_w: 7, h_min: 1.1, h_nom: 1.2, h_max: 1.3, p_allow: 1, p_unit: 'kgf' })] } }]);
      });
      await page.click('.proj-name:text-is("' + demo + '")');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=0 >> .row-end button[title^="詳細"]');
      await page.waitForSelector('.drawer h2:text-is("A1-1")');
      await page.waitForTimeout(300);
      const rows = page.locator('#d-cov tbody tr');
      const cov = async i => (await itemIn(page, demo, 'A1-1')).covered[i];
      const ref = i => rows.nth(i).locator('.comp-field input');
      const open = () => page.waitForSelector('#d-cov .suggest .suggest-row');
      const closed = () => page.waitForSelector('#d-cov .suggest', { state: 'detached' });

      // 新增元件 → the cursor is in the new row's RefDes field and the list is open, grouped by 類別 in the usual order
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForFunction(() => document.activeElement && document.activeElement.closest('#d-cov tbody tr:nth-child(2) .comp-field'));
      await open();
      assert.deepEqual(await page.locator('#d-cov .suggest-group').evaluateAll(els => els.map(e => e.firstChild.nextSibling.textContent.trim())), ['RF', 'DIGI', 'PWR', 'DDR']);
      const rf = await page.locator('#d-cov .suggest').innerText();
      assert.ok(rf.indexOf('BF-7788') < rf.indexOf('DIGI'), 'the RefDes-only component of the other project is listed under RF');
      assert.equal(await page.locator('#d-cov tbody tr:nth-child(2) td:first-child .comp-field').count(), 0, 'no quick-select on the part number');
      // typing filters on RefDes; nothing preselected without an exact match; ↓ Enter picks
      await page.keyboard.type('bf');
      await page.waitForFunction(() => document.querySelectorAll('#d-cov .suggest-row').length === 1);
      const sug = await page.locator('#d-cov .suggest-row').innerText();
      for (const re of [/BF-7788/, /功耗 3\.2 W/, /封裝 11 × 7/, /高度 1\.1 \/ 1\.2 \/ 1\.3/, /耐壓 1 kgf/, /Proj-B \/ B1/]) assert.match(sug, re);
      assert.equal(await page.locator('#d-cov .suggest-row.on').count(), 0);
      await page.keyboard.press('ArrowDown');
      await page.waitForSelector('#d-cov .suggest-row.on');
      await page.keyboard.press('Enter');
      await closed();
      let c = await cov(1);
      assert.deepEqual([c.refdes, c.part, c.cat, c.power_w, c.pkg_l, c.pkg_w, c.h_min, c.h_nom, c.h_max, c.p_allow, c.p_unit, c.qty],
        ['BF-7788', '', 'RF', 3.2, 11, 7, 1.1, 1.2, 1.3, 1, 'kgf', 1]);
      assert.equal(await ref(1).inputValue(), 'BF-7788');
      await page.waitForSelector('.toast:has-text("已帶入 BF-7788")');
      assert.match(await page.locator('#d-gap .h-table').innerText(), /BF-7788/);
      assert.match(await page.locator('#d-hist').innerText(), /元件快選/);
      // one undo step back to the typed text, then forward again
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => document.querySelector('#d-cov tbody tr:nth-child(2) .comp-field input').value === 'bf');
      c = await cov(1);
      assert.deepEqual([c.refdes, c.pkg_l, c.h_nom], ['bf', null, null]);
      await page.keyboard.press('Control+y');
      await page.waitForFunction(() => document.querySelector('#d-cov tbody tr:nth-child(2) .comp-field input').value === 'BF-7788');

      // next row: Esc closes the list only; ▾ opens it again; a click picks (a part-number-only component)
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForSelector('#d-cov tbody tr:nth-child(3) .suggest');
      await page.keyboard.press('Escape');
      await closed();
      assert.equal(await page.locator('.drawer h2:text-is("A1-1")').count(), 1);
      await page.click('#d-cov tbody tr:nth-child(3) .dd-btn');
      await open();
      await page.click('#d-cov .suggest-row:has-text("BUCK-8627")');
      await closed();
      c = await cov(2);
      assert.deepEqual([c.refdes, c.part, c.cat, c.power_w, c.top_pct, c.pkg_l], ['', 'BUCK-8627', 'PWR', 0.8, 30, 4]);

      // next row: an exact RefDes is preselected, so Enter takes it
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForSelector('#d-cov tbody tr:nth-child(4) .suggest');
      await page.keyboard.type('u311');
      await page.waitForSelector('#d-cov .suggest-row.on:has-text("U311")');
      await page.keyboard.press('Enter');
      await closed();
      c = await cov(3);
      assert.deepEqual([c.refdes, c.part, c.cat, c.power_w], ['U311', 'CLK-9492', 'DIGI', 1.2]);

      // a new name: Enter keeps it; a known part number typed in 元件料號 fills nothing (not keyed on the part number)
      await page.click('#d-cov button:has-text("新增元件")');
      await page.waitForSelector('#d-cov tbody tr:nth-child(5) .suggest');
      await page.keyboard.type('NEW-IC-77');
      await closed();
      await page.keyboard.press('Enter');
      await rows.nth(4).locator('td >> nth=0 >> input').fill('PLL-4368');
      await rows.nth(4).locator('td >> nth=4 >> input').click();
      await page.waitForTimeout(200);
      c = await cov(4);
      assert.deepEqual([c.refdes, c.part, c.power_w, c.pkg_l], ['NEW-IC-77', 'PLL-4368', null, null]);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.drawer', { state: 'detached' });
      // rows from the Note column / paste / import are not filled by part number either
      await page.evaluate(() => {
        const id = Object.values(TIM.store.db.projects).find(x => x.name === 'Proj-B').id;
        TIM.actions.insertItems(id, [{ fields: { item_no: 'B2', covered: [TIM.schema.newCovered({ part: 'PLL-4368' })] } }]);
      });
      c = (await itemIn(page, 'Proj-B', 'B2')).covered[0];
      assert.deepEqual([c.part, c.power_w, c.pkg_l], ['PLL-4368', null, null]);
    },
  },
];
