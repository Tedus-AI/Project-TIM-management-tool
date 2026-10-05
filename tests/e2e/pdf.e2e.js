'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { openWithDemo, ROOT } = require('./helpers');

const OUT = path.join(ROOT, 'test-results');
/** Click the dialog's export button, save the download, return { name, bytes, pages }. */
async function exportPdf(page, sections) {
  await page.click('.proj-head-actions button:has-text("匯出 PDF")');
  await page.waitForSelector('.modal:has-text("匯出 PDF")');
  if (sections) {
    const boxes = page.locator('.modal label.check:not(.hidden-follow) input[type=checkbox]');   // the page sections
    for (let i = 0; i < await boxes.count(); i++) {
      const want = sections.includes(i);
      if ((await boxes.nth(i).isChecked()) !== want) await boxes.nth(i).click();
    }
  }
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), page.click('.modal-foot button:has-text("匯出")')]);
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, 'export-' + Date.now() + '.pdf');
  await dl.saveAs(file);
  const bytes = fs.readFileSync(file);
  const pages = (bytes.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  await page.waitForFunction(() => !document.querySelector('.modal'));
  return { name: dl.suggestedFilename(), bytes, pages };
}

module.exports = [
  {
    name: 'overview fields: product type select, no environment / drawing rev, 備註, generic usage unit',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.waitForSelector('.field:has(label:text-is("產品類型")) select');
      const opts = await page.locator('.field:has(label:text-is("產品類型")) select option').allInnerTexts();
      assert.deepEqual(opts.filter(o => o !== '—'), ['Sub-6', 'mmWave']);
      for (const gone of ['產品型號', '環境 Ta min', '環境 Ta max', '環境備註', '機構圖面版次', '說明']) {
        assert.equal(await page.locator('.field:has(label:text-is("' + gone + '"))').count(), 0, gone + ' removed');
      }
      assert.equal(await page.locator('.field:has(label:text-is("備註")) textarea').count(), 1);
      await page.selectOption('.field:has(label:text-is("產品類型")) select', 'mmwave');
      assert.equal(await page.evaluate(() => Object.values(TIM.store.db.projects)[0].product_type), 'mmwave');
      assert.match(await page.locator('.proj-meta').innerText(), /DEMO-01 · mmWave · Demo/);
      const head = await page.locator('.section:has-text("材料用量彙總") thead').innerText();
      assert.match(head, /每台用量/);
      assert.doesNotMatch(head, /每台片數/);
      assert.match(await page.locator('.section:has-text("材料用量彙總") tbody tr').first().innerText(), /9 pcs/);
    },
  },
  {
    name: 'PDF export: button next to Excel, A4 landscape report, section choice, long list paginated',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.waitForSelector('.proj-head-actions button:has-text("匯出 PDF")');
      const buttons = await page.locator('.proj-head-actions button').allInnerTexts();
      const xi = buttons.findIndex(b => /匯出 Excel/.test(b));
      assert.ok(xi >= 0 && /匯出 PDF/.test(buttons[xi + 1]), 'PDF button right next to Excel');
      // options: overview without 待處理事項; material usage and the compression check are separate
      await page.click('.proj-head-actions button:has-text("匯出 PDF")');
      await page.waitForSelector('.modal:has-text("匯出 PDF")');
      const labels = (await page.locator('.modal label.check').allInnerTexts()).map(t => t.trim());
      assert.deepEqual(labels, ['總覽：專案資訊與狀態', 'TIM 清單：與 Excel「TIM List」相同欄位與底色', '位置標註圖：每張視圖一頁，含圖例', '材料用量彙總', '壓縮率與壓力檢核']);
      await page.click('.modal-foot button:has-text("取消")');
      // an earlier saved choice with the combined "checks" turns into both
      await page.evaluate(() => localStorage.setItem('tim_pref_pdf_sections', JSON.stringify(['overview', 'checks'])));
      await page.click('.proj-head-actions button:has-text("匯出 PDF")');
      await page.waitForSelector('.modal:has-text("匯出 PDF")');
      assert.deepEqual(await page.locator('.modal input[type=checkbox]').evaluateAll(els => els.map(e => e.checked)), [true, false, false, true, true]);
      await page.click('.modal-foot button:has-text("取消")');
      // usage only / compression only: one page each
      assert.equal((await exportPdf(page, [3])).pages, 1);
      assert.equal((await exportPdf(page, [4])).pages, 1);
      // everything: overview + list + 2 views + usage and compression (flowed together)
      let r = await exportPdf(page, [0, 1, 2, 3, 4]);
      assert.match(r.name, /_TIM_DVT_\d{8}\.pdf$/);
      assert.equal(r.bytes.slice(0, 5).toString(), '%PDF-');
      assert.equal(r.pages, 5);
      const box = r.bytes.toString('latin1').match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      assert.ok(box && Math.abs(+box[1] - 841.89) < 0.01 && Math.abs(+box[2] - 595.28) < 0.01, 'A4 landscape');
      // TIM list only, with 70 extra items → the table continues over several pages
      await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        TIM.store.mutateProject(p.id, pp => {
          for (let i = 0; i < 70; i++) {
            const covered = i % 5 ? [] : ['LDO-A', 'BUCK-B', 'PMIC-C', 'CLK-9492', 'SYNC-0793', 'FANOUT-1208', 'DDR4-16G'].map(part => TIM.schema.newCovered({ part, qty: 2 }));
            pp.items.push(TIM.schema.newItem({ item_no: 'B' + (i + 1), location_id: pp.locations[i % 2].id, vendor: 'Vendor-B', model: 'GF-750', qty: 1, covered }));
          }
        });
      });
      r = await exportPdf(page, [1]);
      assert.ok(r.pages >= 4 && r.pages <= 6, 'list split over ' + r.pages + ' pages');
      // rows hidden in the TIM 清單 are left out: hide the 70 added rows → the list fits on one page again
      await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        localStorage.setItem('tim_pref_bom_hidden_rows', JSON.stringify({ [p.id]: p.items.filter(i => /^B/.test(i.item_no)).map(i => i.id) }));
      });
      await page.click('.proj-head-actions button:has-text("匯出 PDF")');
      assert.match(await page.locator('.modal label.hidden-follow').innerText(), /不匯出隱藏的 70 列/);
      await page.click('.modal-foot button:has-text("取消")');
      r = await exportPdf(page, [1]);
      assert.equal(r.pages, 1, 'hidden rows are not exported');
    },
  },
];
