'use strict';
// Screenshots for manual review at a given viewport: node tests/e2e/visual.js 1366 768
const path = require('path');
const fs = require('fs');
const { start, stop, openTrialWithDemo, ROOT } = require('./helpers');
(async () => {
  const W = parseInt(process.argv[2] || '1366', 10), H = parseInt(process.argv[3] || '768', 10);
  const OUT = path.join(ROOT, 'test-results', 'visual-' + W);
  fs.mkdirSync(OUT, { recursive: true });
  const env = await start({ viewport: { width: W, height: H } });
  const { page } = env;
  const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(OUT, n + '.png') }); };
  try {
    await openTrialWithDemo(env, 'Reviewer');
    await shot('01-home');
    await page.click('.proj-name');
    await shot('02-overview');
    await page.click('.tab:has-text("TIM 清單")');
    await shot('03-bom');
    await page.click('tr[data-id] >> nth=6 >> .row-end button[title^="詳細"]');
    await shot('04-drawer-top');
    await page.click('.drawer-nav a:has-text("間隙壓縮")');
    await shot('05-drawer-gap');
    await page.click('.drawer-nav a:has-text("熱估算")');
    await shot('06-drawer-thermal');
    await page.keyboard.press('Escape');
    await page.click('.proj-head-actions button:has-text("匯出 Excel")');
    await shot('07-export-modal');
    await page.keyboard.press('Escape');
    await page.click('.tab:has-text("位置標註")');
    await page.click('.pal-item:has(.no:text-is("A8"))');
    const box = await page.locator('.map-stage svg image').boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
    await shot('08-map-place');
    await page.keyboard.press('Escape');
    await page.mouse.click(box.x + box.width * (990 / 1100), box.y + box.height * (210 / 720));
    await shot('09-map-selected');
    await page.click('.db-chip');
    await shot('10-settings');
    await page.keyboard.press('Escape');
    await page.click('.nav-link:has-text("專案")');
    await page.click('.home-actions button:has-text("匯入 Excel")');
    const xlsx = path.join(ROOT, 'test-results', 'import-sample.xlsx');
    if (fs.existsSync(xlsx)) {
      const ch = page.waitForEvent('filechooser');
      await page.click('.dropzone');
      await (await ch).setFiles(xlsx);
      await page.waitForSelector('.step.on:has-text("欄位對應")');
      await shot('11-import-map');
      await page.click('.modal-foot button:has-text("下一步")');
      await shot('12-import-target');
    }
  } finally {
    if (env.errors.length) console.log('ERRORS', env.errors);
    await stop(env);
  }
  console.log('screenshots in ' + OUT);
})();
