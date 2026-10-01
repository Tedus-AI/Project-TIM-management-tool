'use strict';
// Headless smoke run: trial mode + demo project, visit every page, collect console errors, screenshots.
const path = require('path');
const fs = require('fs');
const { start, stop, openTrialWithDemo } = require('./helpers');

const OUT = process.env.SHOT_DIR || path.resolve(__dirname, '../../test-results/smoke');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const env = await start();
  const { page, errors, base } = env;
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + '.png') }); };
  try {
    await page.goto(base);
    await page.waitForSelector('.gate', { timeout: 20000 });
    await shot('01-gate');
    await page.evaluate(() => TIM.app.setUserName('Tester'));
    await page.click('.gate-link:has-text("瀏覽器暫存")');
    await page.waitForSelector('.proj-table', { timeout: 20000 });
    await page.waitForTimeout(500);
    await shot('02-home');
    await page.click('.proj-name');
    await page.waitForSelector('.readouts');
    await shot('03-overview');
    await page.click('.tab:has-text("TIM 清單")');
    await page.waitForSelector('table.grid');
    await shot('04-bom');
    await page.click('.seg button:has-text("機構")');
    await page.click('.seg button:has-text("熱")');
    await page.waitForTimeout(200);
    await shot('05-bom-groups');
    await page.click('tr[data-id] .row-end button[title^="詳細"]');
    await page.waitForSelector('.drawer');
    await shot('06-drawer');
    await page.keyboard.press('Escape');
    await page.click('.tab:has-text("位置標註")');
    await page.waitForSelector('.map-stage svg', { timeout: 10000 });
    await page.waitForTimeout(400);
    await shot('07-map');
    await page.click('.view-item:has-text("Top case")');
    await page.waitForTimeout(400);
    await shot('08-map-top');
    await page.click('.tab:has-text("間隙與熱檢核")');
    await page.waitForSelector('.an-table');
    await shot('09-analysis');
    await page.click('.tab:has-text("變更紀錄")');
    await page.waitForTimeout(200);
    await shot('10-log');
    await page.click('.nav-link:has-text("材料庫")');
    await page.waitForTimeout(200);
    await shot('11-library');
  } catch (e) {
    errors.push('runner: ' + e.message);
    await shot('zz-failure').catch(() => {});
  } finally {
    await stop(env);
  }
  if (errors.length) { console.log('ERRORS:\n' + errors.join('\n')); process.exitCode = 1; }
  else console.log('smoke OK — screenshots in ' + OUT);
})();
