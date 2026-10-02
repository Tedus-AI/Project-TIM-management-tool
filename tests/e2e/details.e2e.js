'use strict';
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

const item = (page, no) => page.evaluate(n => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === n) || null)), no);
const field = (page, label) => page.locator('.drawer .field:has(> label:text-is("' + label + '")) input').first();

module.exports = [
  {
    name: 'item drawer: gap → compression judgement, override unlock, material unlink / relink, Q\'ty suggestion',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=2 >> .row-end button[title^="詳細"]');     // A2
      await page.waitForSelector('.drawer h2:text-is("A2")');
      await page.waitForTimeout(300);
      // manual gap (no 設計間距): T 2 mm, max gap 1.75 → C min 12.5 % ≥ 10 % → OK; heavy compression is not a % warning any more
      const gap = page.locator('#d-gap .field:has(> label:text-is("間隙 min / nom / max")) input');
      await gap.nth(0).fill('1.0');
      await gap.nth(1).fill('1.6');
      await gap.nth(2).fill('1.75');
      await page.waitForSelector('#d-gap .calc-box .tag-ok:text-is("OK")');
      // max gap 1.85 → C min 7.5 % < 10 % → Warning (contact)
      await gap.nth(2).fill('1.85');
      await page.waitForSelector('#d-gap .calc-box .tag-warn:text-is("Warning")');
      assert.match(await page.locator('#d-gap').innerText(), /低於下限 10%/);
      // unlock the minimum (✂) and lower it → OK again
      await page.click('#d-gap .field:has(> label:has-text("最小壓縮率")) button[title="解鎖，改為手動輸入"]');
      await page.locator('#d-gap .field:has(> label:has-text("最小壓縮率")) input').fill('5');
      await page.waitForSelector('#d-gap .calc-box .tag-ok:text-is("OK")');
      assert.deepEqual((await item(page, 'A2')).comp_override, { min: 5 });
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
    name: '設計間距 ± 公差 + 元件高度公差 → gaps per component, pressure from the material curve vs 耐壓 (Warning / Fail), ✂ manual gap, grid read-only',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.click('tr[data-id] >> nth=2 >> .row-end button[title^="詳細"]');     // A2: 8 × 8 × 2 mm, PLL-4368 (7 × 7) + MIX-1139
      await page.waitForSelector('.drawer h2:text-is("A2")');
      // fictional deflection curve for the linked material (2 mm)
      await page.evaluate(() => {
        const it = Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === 'A2');
        TIM.actions.updateMaterial(it.material_id, 'pressure_curves', [{ t: 2, points: [[10, 10], [20, 25], [40, 45], [60, 55]] }]);
      });
      await page.waitForTimeout(200);
      // 設計間距 = pedestal → top of the tallest component (PLL, nominal 1.4 mm)
      await field(page, '設計間距 nom').fill('1.6');
      await field(page, '間距公差 +').fill('0.05');
      await field(page, '間距公差 −').fill('0.05');
      const hrow = n => page.locator('#d-gap .h-table tbody tr').nth(n);
      await hrow(0).locator('td >> nth=1 >> input').fill('1.35');     // PLL: 1.35 / 1.4 / 1.45
      await hrow(0).locator('td >> nth=2 >> input').fill('1.4');
      await hrow(0).locator('td >> nth=3 >> input').fill('1.45');
      await hrow(1).locator('td >> nth=2 >> input').fill('1.3');      // MIX: nom only
      // derived gaps (locked, ✂ to edit): PLL 1.5 / 1.6 / 1.7; MIX is 0.1 mm lower → 1.65 / 1.7 / 1.75 → item 1.5 / 1.6 / 1.75
      const gapField = page.locator('#d-gap .field:has(> label:text-is("間隙 min / nom / max"))');
      await page.waitForFunction(() => /1\.5 \/ 1\.6 \/ 1\.75 mm/.test(document.querySelector('#d-gap').innerText));
      assert.match(await gapField.innerText(), /設計間距/);
      // pressures: PLL C max 25 % → 20 psi; MIX 17.5 % → 15 psi; no allowable yet → no judgement on pressure
      const prow = n => page.locator('#d-gap .p-table tbody tr').nth(n);
      await page.waitForFunction(() => document.querySelectorAll('#d-gap .p-table tbody tr').length === 2);
      assert.match(await prow(0).innerText(), /1\.5 \/ 1\.6 \/ 1\.7\t15 ~ 25\t13\.3 ~ 20\t/);
      assert.match(await prow(1).innerText(), /1\.65 \/ 1\.7 \/ 1\.75\t12\.5 ~ 17\.5\t11\.7 ~ 15\t/);
      // numeric headers line up with their right-aligned values (component table and the thermal table)
      const aligned = await page.evaluate(() => ['#d-gap .p-table', '#d-th .subtbl'].map(sel => {
        const t = document.querySelector(sel);
        return Array.from(t.querySelectorAll('thead th.r')).every((th, k) => {
          const col = Array.from(th.parentElement.children).indexOf(th);
          const td = t.querySelector('tbody tr').children[col];
          return getComputedStyle(th).textAlign === 'right' && getComputedStyle(td).textAlign === 'right';
        });
      }));
      assert.deepEqual(aligned, [true, true]);
      // allowable: PLL 22 psi → 91 % → Warning; MIX 10 psi → Fail
      await hrow(0).locator('td >> nth=4 >> input').fill('22');
      await hrow(1).locator('td >> nth=4 >> input').fill('10');
      await page.waitForSelector('#d-gap .calc-box .tag-err:text-is("Fail")');
      assert.match(await prow(0).innerText(), /Warning/);
      assert.match(await prow(1).innerText(), /Fail/);
      assert.match(await page.locator('#d-gap').innerText(), /MIX-1139[^\n]*超過耐壓 10 psi/);
      // MIX 30 psi → OK; PLL as a force: 10 N over 7 × 7 mm ≈ 29.6 psi → 68 % → OK
      await hrow(1).locator('td >> nth=4 >> input').fill('30');
      await hrow(0).locator('td >> nth=4 >> input').fill('10');
      await hrow(0).locator('td >> nth=5 >> select').selectOption('N');
      await page.waitForSelector('#d-gap .calc-box .tag-ok:text-is("OK")');
      assert.match(await prow(0).innerText(), /10 N[\s\S]*68%/);
      const a2 = await item(page, 'A2');
      assert.deepEqual(a2.gap_design, { nom: 1.6, plus: 0.05, minus: 0.05 });
      assert.deepEqual([a2.covered[0].h_min, a2.covered[0].h_nom, a2.covered[0].h_max, a2.covered[0].p_allow, a2.covered[0].p_unit], [1.35, 1.4, 1.45, 10, 'N']);
      // ✂ manual gap: the derived values are copied, then typed values win; ↺ back to the stack-up
      await gapField.locator('button[title="解鎖，改為手動輸入"]').click();
      assert.deepEqual((await item(page, 'A2')).gap, { nom: 1.6, min: 1.5, max: 1.75 });
      await gapField.locator('input').nth(0).fill('1.2');      // C max 40 % → 40 psi > 30 psi on MIX
      await page.waitForSelector('#d-gap .calc-box .tag-err:text-is("Fail")');
      await gapField.locator('button[title^="回復自動帶入"]').click();
      await page.waitForSelector('#d-gap .calc-box .tag-ok:text-is("OK")');
      assert.equal((await item(page, 'A2')).gap_manual, false);
      // grid: gaps are derived (read-only) and the pressure column shows the curve value
      await page.keyboard.press('Escape');
      await page.waitForSelector('.drawer', { state: 'detached' });
      await page.click('.bom-toolbar .seg button:has-text("機構")');
      const a2row = page.locator('tr[data-id] >> nth=2');
      await a2row.locator('.cell-ro.r.mono').first().waitFor();
      assert.deepEqual((await a2row.locator('.cell-ro.r.mono').allInnerTexts()).slice(0, 3), ['1.5', '1.6', '1.75']);
      assert.match(await a2row.innerText(), /12\.5~25[\s\S]*20/);
    },
  },
  {
    name: 'material library: edit propagates, where-used, delete keeps item text',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
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
      await openWithDemo(env);
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
    await openWithDemo(env);
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
