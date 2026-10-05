'use strict';
// Material linking (the Vendor / Model combobox lists the whole library and links on a pick; exact names typed by hand
// link on leaving; "全部連結" for items named like a library material), 受壓類型 and the 間隙與壓力檢核 table.
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

const item = (page, no) => page.evaluate(n => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === n))), no);
const matId = (page, model) => page.evaluate(m => Object.values(TIM.store.db.materials).find(x => x.model === m).id, model);
const rowOf = (page, no) => page.evaluate(n => {
  const el = Array.from(document.querySelectorAll('[data-cell$=",0"]')).find(x => x.value === n);
  return el ? parseInt(el.dataset.cell, 10) : -1;
}, no);

module.exports = [
  {
    name: 'materials: combobox lists the whole library and links on a pick (grid + drawer), exact names link on leaving, 全部連結',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      // A4 / A5 named like library materials but not linked (as data typed before linking existed)
      await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        TIM.store.mutateProject(p.id, pp => pp.items.filter(i => i.item_no === 'A4' || i.item_no === 'A5').forEach(i => { i.material_id = null; }));
      });
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.waitForSelector('.unlinked-banner:has-text("2 個 Item（A4、A5）")');

      // grid: clicking the Model cell opens the whole library (not just the current text), a pick links
      const r4 = await rowOf(page, 'A4');
      await page.click('[data-cell="' + r4 + ',3"]');
      await page.waitForSelector('.mat-list');
      assert.match(await page.locator('.mat-list .mc-head').innerText(), /全部 6 筆/);
      assert.equal(await page.locator('.mat-list .mc-row').count(), 6);
      // keyboard: ↓ moves inside the list (not to the next row), Enter picks
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      const chosen = await page.locator('.mat-list .mc-row.on .mc-m').innerText();
      await page.keyboard.press('Enter');
      await page.waitForSelector('.mat-list', { state: 'detached' });
      assert.equal((await item(page, 'A4')).material_id, await matId(page, chosen));
      await page.waitForSelector('.toast:has-text("已連結材料庫")');
      await page.waitForFunction(r => document.activeElement && document.activeElement.dataset.cell === r + ',3', r4);
      // the banner now lists A5 only → 全部連結
      await page.waitForSelector('.unlinked-banner:has-text("1 個 Item（A5）")');
      await page.click('.unlinked-banner button:has-text("全部連結")');
      await page.waitForSelector('.unlinked-banner', { state: 'detached' });
      assert.equal((await item(page, 'A5')).material_id, await matId(page, 'GF-750'));
      // Esc closes the list without reverting / closing anything else
      const r1 = await rowOf(page, 'A1-1');
      await page.evaluate(() => { const p = Object.values(TIM.store.db.projects)[0]; TIM.store.mutateProject(p.id, pp => { pp.items.find(i => i.item_no === 'A1-1').material_id = null; }); });
      await page.click('[data-cell="' + r1 + ',3"]');
      await page.waitForSelector('.mat-list');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.mat-list', { state: 'detached' });
      assert.equal((await item(page, 'A1-1')).model, 'AbsorbPad AX');

      // drawer: unlink A2 → Vendor / Model combos; ▾ lists everything even with a value in the field; a pick links
      await page.click('tr:has([data-cell="' + (await rowOf(page, 'A2')) + ',0"]) .row-end button[title^="詳細"]');
      await page.waitForSelector('.drawer h2:text-is("A2")');
      await page.waitForTimeout(300);
      await page.click('#d-basic button[title="解鎖，改為手動輸入"]');
      await page.waitForSelector('#d-basic .mat-combo');
      await page.click('#d-basic .field:has(> label:text-is("Model")) .dd-btn');
      await page.waitForSelector('.mat-list');
      assert.equal(await page.locator('.mat-list .mc-row').count(), 6, 'the whole library, not only "AbsorbPad AX"');
      await page.click('.mat-list .mc-row:has(.mc-m:text-is("TP-800"))');
      let a2 = await item(page, 'A2');
      assert.equal(a2.material_id, await matId(page, 'TP-800'));
      assert.deepEqual([a2.vendor, a2.model], ['Vendor-C', 'TP-800']);
      // unlink, type an exact library name by hand, leave the field → linked
      await page.click('#d-basic button[title="解鎖，改為手動輸入"]');
      const vendor = page.locator('#d-basic .field:has(> label:text-is("Vendor")) input');
      const model = page.locator('#d-basic .field:has(> label:text-is("Model")) input');
      await vendor.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('vendor-b');
      await page.keyboard.press('Tab');
      await model.click(); await page.keyboard.press('Control+A'); await page.keyboard.type('GF-600HD');
      await page.waitForSelector('.mat-list:has-text("篩選「GF-600HD」")');
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => document.querySelector('#d-basic .lock-badge'));
      a2 = await item(page, 'A2');
      assert.equal(a2.material_id, await matId(page, 'GF-600HD'));
      assert.deepEqual([a2.vendor, a2.model], ['Vendor-B', 'GF-600HD'], 'the library spelling');
    },
  },
  {
    name: '受壓類型: E-PAD not judged (耐壓 不需), BGA without 耐壓 asks for it; 間隙與壓力檢核 tab with the 覆蓋元件 column',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=2 >> .row-end button[title^="詳細"]');     // A2: PLL-4368, MIX-1139
      await page.waitForSelector('.drawer h2:text-is("A2")');
      await page.waitForTimeout(300);
      const hrow = n => page.locator('#d-gap .h-table tbody tr').nth(n);
      assert.equal(await hrow(0).locator('td >> nth=1 >> select').inputValue(), '', '未指定 by default');
      await hrow(0).locator('td >> nth=1 >> select').selectOption('epad');
      await page.waitForSelector('#d-gap .h-table tbody tr:nth-child(1) td:has-text("不需（E-PAD 不檢核）")');
      assert.equal((await item(page, 'A2')).covered[0].load_type, 'epad');
      await page.waitForSelector('#d-gap .p-table tbody tr:nth-child(1) .tag:has-text("不檢核")');
      await hrow(0).locator('td >> nth=1 >> select').selectOption('bga');
      await page.waitForSelector('#d-gap:has-text("BGA 需檢核耐壓")');
      assert.equal(await hrow(0).locator('td >> nth=5 >> input').count(), 1, '耐壓 editable again');
      assert.match(await page.locator('#d-hist').innerText(), /受壓類型/);
      await hrow(0).locator('td >> nth=1 >> select').selectOption('epad');
      await page.waitForSelector('#d-gap .p-table tbody tr:nth-child(1) .tag:has-text("不檢核")');
      await page.click('.drawer button[title="關閉 (Esc)"]');
      await page.waitForSelector('.drawer', { state: 'detached' });

      await page.click('.tab:has-text("間隙與壓力檢核")');
      await page.waitForSelector('table.an-table thead th:text-is("覆蓋元件")');
      const heads = (await page.locator('table.an-table >> nth=0 >> thead th').allInnerTexts()).map(t => t.replace(/[▾\s]+$/, '').trim());
      const li = heads.indexOf('Location');
      assert.deepEqual(heads.slice(li, li + 3), ['Location', '覆蓋元件', '材料']);
      const a11 = await page.locator('table.an-table >> nth=0 >> tbody tr:has(b:text-is("A1-1"))').innerText();
      assert.match(a11, /U101-U104/);
      // the E-PAD component: compression still judged, pressure 不檢核 (not an OK that looks like a judgement)
      const a2first = page.locator('table.an-table >> nth=0 >> tbody.an-item:has(b:text-is("A2")) tr >> nth=0');
      assert.match(await a2first.innerText(), /E-PAD/);
      const tags = (await a2first.locator('td .tag:not(.lt-chip)').allInnerTexts()).map(t => t.trim());
      assert.equal(tags.length, 2);
      assert.match(tags[0], /OK|Fail/);
      assert.equal(tags[1], '不檢核');
    },
  },
];
