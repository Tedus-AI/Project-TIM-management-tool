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
      assert.deepEqual(labels, ['總覽：專案資訊與狀態', 'TIM 清單：與畫面上的 TIM 清單相同欄位（含展開的欄位群組）與底色', '位置標註圖：每張視圖一頁，旁邊附 Item 與覆蓋元件對照表', '材料用量彙總', '壓縮率與壓力檢核']);
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
      // everything: overview + list + 2 views + usage and compression flowed together (the compression table has one
      // row per covered component → 16 rows, so the two take 2 pages)
      let r = await exportPdf(page, [0, 1, 2, 3, 4]);
      assert.match(r.name, /_TIM_DVT_\d{8}\.pdf$/);
      assert.equal(r.bytes.slice(0, 5).toString(), '%PDF-');
      assert.equal(r.pages, 6);
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
  {
    name: 'PDF TIM 清單 = the columns the TIM 清單 shows (k after Model, 覆蓋元件, expanded groups, hidden left out), no legend; map pages list Item / 覆蓋元件; section titles on one line',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.waitForSelector('table.grid');
      // the grid: k right after Model in 基本, the Note column is called 覆蓋元件
      const heads = await page.locator('table.grid thead th[data-col]').evaluateAll(els => els.map(e => e.dataset.col));
      assert.deepEqual(heads.slice(0, 6), ['item_no', 'used_on', 'vendor', 'model', 'k', 'size']);
      assert.match(await page.locator('table.grid thead th[data-col="covered"]').innerText(), /^覆蓋元件/);
      assert.ok(!/Note/.test(await page.locator('table.grid thead').innerText()));
      // 熱 group shown, Delta P/N hidden → the PDF list has exactly those columns, in the grid order
      await page.evaluate(() => {
        localStorage.setItem('tim_pref_bom_groups', JSON.stringify({ mech: false, thermal: true, supply: false, trace: false }));
        localStorage.setItem('tim_pref_bom_hidden_cols', JSON.stringify(['delta_pn']));
      });
      const list = await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        const h = TIM.ui.bomHiddenForExport(p);
        const html = TIM.pdfExport.internals.listPages(p, TIM.store.db, { rows: h.rows, cols: h.cols, gridCols: h.gridCols }).map(x => x.html).join('');
        const d = document.createElement('div'); d.innerHTML = html;
        const rowOf = no => Array.from(d.querySelectorAll('tbody tr')).find(tr => Array.from(tr.children).some(td => td.textContent === no));
        return { heads: Array.from(d.querySelectorAll('thead th')).map(th => th.firstChild.textContent), html,
          a5: Array.from(rowOf('A5').children).map(td => td.textContent), gridCols: h.gridCols, labels: h.colLabels,
          a5covered: TIM.parse.formatCovered(p.items.find(i => i.item_no === 'A5').covered) };
      });
      assert.deepEqual(list.heads, ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'k', 'Size', "Q'ty", '覆蓋元件', '2nd source', '型態', '狀態', '面積', 'P_TIM', 'R_TIM', 'ΔT max']);
      assert.deepEqual([list.gridCols, list.labels], [['delta_pn'], ['Delta P/N']]);
      assert.ok(list.a5covered && list.a5.includes(list.a5covered), 'covered components printed: ' + list.a5.join(' | '));
      assert.ok(list.a5.includes('7.5'), 'k of the linked material: ' + list.a5.join(' | '));
      assert.ok(!/單一來源（無第二來源）|第二來源尚未承認/.test(list.html), 'no colour legend under the list');
      assert.match(list.html, /#F9CBF0/i, 'single-source 2nd source cells still pink');
      // the export dialog counts the hidden grid column
      await page.click('.proj-head-actions button:has-text("匯出 PDF")');
      assert.match(await page.locator('.modal label.hidden-follow').innerText(), /不匯出隱藏的 1 欄（Delta P\/N）/);
      await page.click('.modal-foot button:has-text("取消")');
      // placement pages: the drawing and a table of the Items on it with their 覆蓋元件 and piece count
      const maps = await page.evaluate(async () => {
        const p = Object.values(TIM.store.db.projects)[0];
        const pages = await TIM.pdfExport.internals.mapPages(p, TIM.store.db);
        return pages.map((pg, i) => {
          const d = document.createElement('div'); d.innerHTML = pg.html;
          const v = p.views.filter(x => x.image_id)[i];
          const placed = TIM.calc.orderedItems(p).filter(it => v.shapes.some(s => s.item_id === it.id));
          return { img: !!d.querySelector('img'), heads: Array.from(d.querySelectorAll('thead th')).map(th => th.textContent),
            rows: Array.from(d.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())),
            want: placed.map(it => [it.item_no, TIM.parse.formatCovered(it.covered) || '—', String(v.shapes.filter(s => s.item_id === it.id).length)]) };
        });
      });
      assert.ok(maps.length >= 1);
      maps.forEach(m => {
        assert.ok(m.img);
        assert.deepEqual(m.heads, ['Item', '覆蓋元件', '片數']);
        assert.deepEqual(m.rows.map(r => [r[0], r[1], r[2].replace(/Q'ty.*/, '')]), m.want);
      });
      // section titles stay on one line even with a long sub-title beside them
      const titleH = await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        const pg = TIM.pdfExport.internals.checkPages(p, TIM.store.db, { usage: false, compression: true })[0];
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;left:0;top:0;width:774px;font-size:10px;line-height:1.45';
        box.innerHTML = pg.html;
        document.body.appendChild(box);
        const span = box.querySelector('span');
        const r = { text: span.textContent, h: span.getBoundingClientRect().height };
        box.remove();
        return r;
      });
      assert.equal(titleH.text, '壓縮率與壓力檢核');
      assert.ok(titleH.h < 22, 'one line: ' + titleH.h + ' px');
      // the check table: every row carries Item / Location / 材料 / T (no blank or grey continuation rows), no ⧉ mark
      const rows = await page.evaluate(() => {
        const p = Object.values(TIM.store.db.projects)[0];
        const d = document.createElement('div');
        d.innerHTML = TIM.pdfExport.internals.checkPages(p, TIM.store.db, { usage: false, compression: true }).map(x => x.html).join('');
        return { html: d.innerHTML, rows: Array.from(d.querySelectorAll('tbody tr')).map(tr => Array.from(tr.children).slice(0, 6).map(td => ({ t: td.textContent.trim(), grey: /color:\s*(#6B7A90|rgb\(107, 122, 144\))/i.test(td.getAttribute('style') || '') }))) };
      });
      assert.ok(rows.rows.length > 9, 'one row per component');
      rows.rows.forEach(r => {
        assert.ok(r[0].t && r[1].t && r[3].t && r[4].t, 'Item / Location / 材料 / T filled: ' + r.map(c => c.t).join(' | '));
        assert.ok(!r[0].grey, 'Item number not grey');
      });
      const a5 = rows.rows.filter(r => r[0].t === 'A5');
      assert.ok(a5.length >= 2 && new Set(a5.map(r => r[1].t + '/' + r[3].t)).size === 1, 'repeated rows show the same Location / 材料');
      assert.ok(!/⧉/.test(rows.html), 'no ⧉ mark in the gap column');
      // overview: Fail and Warning counted apart (by Item), same numbers as the 間隙與壓力檢核 tab
      await page.click('.tab:has-text("總覽")');
      await page.waitForSelector('.readouts');
      const tiles = await page.locator('.readout').evaluateAll(els => els.map(e => [e.querySelector('.k').textContent.trim(), e.querySelector('.v').textContent.trim(), e.className]));
      const fail = tiles.find(t => /^壓縮 \/ 壓力 Fail/.test(t[0])), warn = tiles.find(t => /^壓縮 \/ 壓力 Warning/.test(t[0]));
      assert.ok(fail && warn && !tiles.some(t => /異常/.test(t[0])), tiles.map(t => t[0]).join(', '));
      const st = await page.evaluate(() => { const p = Object.values(TIM.store.db.projects)[0]; const s = TIM.calc.projectStats(p, TIM.store.db); return [s.comp_fail, s.comp_warn]; });
      assert.deepEqual([fail[1], warn[1]], [st[0] + 'Item', st[1] + 'Item']);
      assert.ok(st[0] > 0 && /is-err/.test(fail[2]), 'Fail count in red');
      assert.equal(tiles.length, 9);
    },
  },
];
