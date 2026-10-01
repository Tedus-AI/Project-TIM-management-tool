'use strict';
const assert = require('node:assert/strict');
const { openTrialWithDemo } = require('./helpers');

const item = (page, no) => page.evaluate(n => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === n) || null)), no);
const field = (page, label) => page.locator('.drawer .field:has(> label:text-is("' + label + '")) input').first();

module.exports = [
  {
    name: 'item drawer: gap → compression judgement, override unlock, material unlink / relink, Q\'ty suggestion',
    async run(env) {
      const { page } = env;
      await openTrialWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=2 >> .row-end button[title^="詳細"]');     // A2
      await page.waitForSelector('.drawer h2:text-is("A2")');
      await page.waitForTimeout(300);
      // gap within the band → OK
      await field(page, '間隙 min').fill('1.5');
      await field(page, '間隙 nom').fill('1.6');
      await field(page, '間隙 max').fill('1.75');
      await page.waitForSelector('#d-gap .tag-ok:text-is("OK")');
      // over-compression → Warning with explanation
      await field(page, '間隙 min').fill('1.2');
      await page.waitForSelector('#d-gap .tag-warn:text-is("Warning")');
      assert.match(await page.locator('#d-gap').innerText(), /高於建議 30%/);
      // unlock the recommended range (✂) and widen it → OK again
      await page.click('#d-gap button[title="解鎖，改為手動輸入"]');
      await page.locator('#d-gap .locked input').nth(1).fill('45');
      await page.waitForSelector('#d-gap .tag-ok:text-is("OK")');
      assert.deepEqual((await item(page, 'A2')).comp_override, { min: 10, max: 45 });
      await page.click('#d-gap button[title^="回復自動帶入"]');
      assert.equal((await item(page, 'A2')).comp_override, null);
      // unlink material → vendor/model become editable text, then relink via suggestion
      await page.click('#d-basic button[title="解鎖，改為手動輸入"]');
      let a2 = await item(page, 'A2');
      assert.equal(a2.material_id, null);
      assert.equal(a2.vendor, 'Vendor-A');
      await page.click('#d-basic button:has-text("連結材料庫的")');
      assert.ok((await item(page, 'A2')).material_id);
      // Q'ty suggestion from the placement map
      await page.locator('.drawer .field:has(> label:text-is("Q\'ty（每台）")) input').fill('5');
      await page.click('#d-size button:has-text("套用 3")');
      assert.equal((await item(page, 'A2')).qty, 3);
      // add a covered component with power and top-side fraction → thermal row appears
      await page.click('#d-cov button:has-text("新增元件")');
      const row = page.locator('#d-cov tbody tr').last();
      await row.locator('td >> nth=0 >> input').fill('NEW-IC');
      await row.locator('td >> nth=4 >> input').fill('2');
      await row.locator('td >> nth=5 >> input').fill('50');
      await row.locator('td >> nth=6 >> input').fill('4');
      await row.locator('td >> nth=7 >> input').fill('4');
      await page.waitForSelector('#d-th td:has-text("NEW-IC")');
      const c = (await item(page, 'A2')).covered.find(x => x.part === 'NEW-IC');
      assert.deepEqual([c.power_w, c.top_pct, c.pkg_l, c.pkg_w], [2, 50, 4, 4]);
      // history shows the edits
      assert.match(await page.locator('#d-hist').innerText(), /間隙 min/);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.drawer', { state: 'detached' });
    },
  },
  {
    name: 'material library: edit propagates, where-used, delete keeps item text',
    async run(env) {
      const { page } = env;
      await openTrialWithDemo(env);
      await page.click('.nav-link:has-text("材料庫")');
      await page.click('tr.clickable:has-text("GF-750")');
      await page.waitForSelector('.drawer');
      assert.match(await page.locator('#m-wu').innerText(), /A5[\s\S]*A8/);
      await page.locator('#m-basic .field:has(> label:text-is("Model")) input').fill('GF-750 Plus');
      const model = await page.evaluate(() => { const p = Object.values(TIM.store.db.projects)[0]; const it = p.items.find(i => i.item_no === 'A5'); return TIM.calc.effective(it, TIM.store.db.materials[it.material_id]).model; });
      assert.equal(model, 'GF-750 Plus', 'rename visible through every linked item');
      await page.click('.drawer button[title="刪除材料"]');
      await page.waitForSelector('.modal');
      await page.keyboard.press('Enter');
      const a5 = await page.evaluate(() => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === 'A5'))));
      assert.equal(a5.material_id, null);
      assert.equal(a5.model, 'GF-750 Plus', 'item keeps the material text after delete');
    },
  },
  {
    name: 'baseline + diff and manual ECN entry',
    async run(env) {
      const { page } = env;
      await openTrialWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("變更紀錄")');
      await page.click('button:has-text("與目前比較")');
      await page.waitForSelector('.modal:has-text("差異比較")');
      const txt = await page.locator('.modal-body').innerText();
      assert.match(txt, /修改\s*2 個 Item/);
      assert.match(txt, /6\*6\*2\s*6\*6\*2\.5/);
      await page.keyboard.press('Escape');
      await page.click('button:has-text("新增紀錄 / ECN")');
      await page.fill('.modal .field:has(> label:text-is("ECN / ECR 編號")) input', 'ECN-T-77');
      await page.fill('.modal textarea', 'Test reason');
      await page.click('.modal-foot button:has-text("新增")');
      await page.waitForSelector('td:has-text("ECN-T-77")');
      await page.click('button:has-text("建立基準")');
      await page.fill('.modal input.inp', 'DVT');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.baseline-card:has-text("DVT")');
    },
  },
];

module.exports.push({
  name: 'dialogs take Enter / Esc pressed in the same instant they open',
  async run(env) {
    const { page } = env;
    await openTrialWithDemo(env);
    await page.click('.proj-name');
    await page.click('.tab:has-text("變更紀錄")');
    await page.waitForSelector('.baseline-card');
    // Open the dialog and press the key within one task: no animation frame or timer runs in
    // between, like a fast typist or a busy machine where effects run late.
    const openThenKey = (button, key) => page.evaluate(async ([button, key]) => {
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === button).click();
      for (let i = 0; i < 20 && !document.querySelector('.modal'); i++) await Promise.resolve();
      if (!document.querySelector('.modal')) return 'dialog not rendered';
      (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      return 'ok';
    }, [button, key]);
    assert.equal(await openThenKey('與目前比較', 'Escape'), 'ok');
    await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 3000 });
    assert.equal(await openThenKey('建立基準', 'Enter'), 'ok');    // default name = project stage
    await page.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 3000 });
    const names = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].baselines.map(b => b.name));
    assert.deepEqual(names, ['EVT', 'DVT']);
  },
});
