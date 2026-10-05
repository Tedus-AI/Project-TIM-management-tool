'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { openWithDemo, ROOT } = require('./helpers');

const OUT = path.join(ROOT, 'test-results');

/** Inspect an .xlsx with Python's stdlib zipfile (independent of ExcelJS). */
function zipSummary(file) {
  const py = [
    'import zipfile, re, json, sys, html',
    'z = zipfile.ZipFile(sys.argv[1])',
    'wb = z.read("xl/workbook.xml").decode()',
    's1 = z.read("xl/worksheets/sheet1.xml").decode()',
    'print(json.dumps({"sheets": [html.unescape(n) for n in re.findall(r\'<sheet [^>]*name="([^"]+)"\', wb)],',
    '  "media": sorted(n for n in z.namelist() if n.startswith("xl/media/") and not n.endswith("/")),',
    '  "merges": re.findall(r\'<mergeCell ref="([^"]+)"\', s1)}))',
  ].join('\n');
  return JSON.parse(execFileSync('python3', ['-c', py, file]).toString());
}

module.exports = [
  {
    name: 'export: current Excel layout + drawings + detail sheets',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.proj-head-actions button:has-text("匯出 Excel")');
      await page.waitForSelector('.modal');
      const dl = page.waitForEvent('download', { timeout: 60000 });
      await page.click('.modal-foot button:has-text("匯出")');
      const d = await dl;
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, 'export-demo.xlsx');
      await d.saveAs(file);
      assert.match(d.suggestedFilename(), /^DEMO-RRU_n78.*_TIM_DVT_\d{8}\.xlsx$/);
      const z = zipSummary(file);
      assert.deepEqual(z.sheets, ['TIM List', 'Components', '2nd Source', 'Gap & Thermal', 'Pressure', 'Changelog', 'Project']);
      assert.equal(z.media.length, 2, 'both placement drawings embedded');
      assert.ok(z.merges.includes('A2:A7') && z.merges.includes('A8:A10'), 'Location cells merged per group: ' + z.merges);
      // cell values through ExcelJS in the page
      const b64 = fs.readFileSync(file).toString('base64');
      const cells = await page.evaluate(async b64 => {
        const ExcelJS = await TIM.loader.load('exceljs');
        const wb = new ExcelJS.Workbook();
        const buf = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        await wb.xlsx.load(buf.buffer);
        const ws = wb.getWorksheet('TIM List');
        const row = r => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(c => ws.getCell(r, c).text);
        return { head: row(1), first: row(2), a8: row(10), single: ws.getCell(2, 10).fill.fgColor.argb, rot: ws.getCell(2, 1).alignment.textRotation };
      }, b64);
      assert.deepEqual(cells.head, ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source']);
      assert.deepEqual(cells.first, ['Bottom Case', 'A1-1', 'RF', 'Vendor-A', 'AbsorbPad AX', '51.5*9*3', '4', 'DEMO-0001', 'PAD-2601*4', 'Vendor-A only source']);
      assert.equal(cells.a8[1], 'A8'); assert.equal(cells.a8[2], 'PWR/DDR'); assert.equal(cells.a8[9], 'Vendor-C TP-750');
      assert.equal(cells.single, 'FFF9CBF0', 'single-source cell is pink');
      assert.equal(cells.rot, 90);
    },
  },
  {
    name: 'export follows the TIM 清單 顯示 / 隱藏: hidden rows left out of every sheet, hidden columns out of TIM List; can be turned off',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('.proj-name');
      await page.click('.tab:has-text("TIM 清單")');
      await page.waitForSelector('table.grid');
      // hide row A2 and the Delta P/N + Q'ty columns in the grid
      await page.click('.bom-toolbar button:has-text("顯示 / 隱藏")');
      await page.locator('.hide-panel .hp-col >> nth=0 >> .hp-item:has-text("Delta P/N") input').uncheck();
      await page.locator('.hide-panel .hp-col >> nth=0 >> .hp-item:has-text("Q\'ty") input').uncheck();
      await page.locator('.hide-panel .hp-col >> nth=1 >> .hp-item:has(b:text-is("A2")) input').uncheck();
      await page.keyboard.press('Escape');
      const exportXlsx = async (follow) => {
        await page.click('.proj-head-actions button:has-text("匯出 Excel")');
        await page.waitForSelector('.modal:has-text("匯出 Excel")');
        const note = page.locator('.modal label.hidden-follow');
        assert.match(await note.innerText(), /不匯出隱藏的 1 列（A2）、2 欄（Q'ty、Delta Part No\.）/);
        if ((await note.locator('input').isChecked()) !== follow) await note.locator('input').click();
        const dl = page.waitForEvent('download', { timeout: 60000 });
        await page.click('.modal-foot button:has-text("匯出")');
        const file = path.join(OUT, 'export-hidden-' + follow + '.xlsx');
        fs.mkdirSync(OUT, { recursive: true });
        await (await dl).saveAs(file);
        await page.waitForFunction(() => !document.querySelector('.modal'));
        const b64 = fs.readFileSync(file).toString('base64');
        return page.evaluate(async b64 => {
          const ExcelJS = await TIM.loader.load('exceljs');
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer);
          const ws = wb.getWorksheet('TIM List');
          const head = []; for (let c = 1; c <= 12; c++) head.push(ws.getCell(1, c).text);
          const items = []; for (let r = 2; r <= 30; r++) { const t = ws.getCell(r, 2).text; if (/^A\d/.test(t)) items.push(t); }
          const col = (name, key) => { const w = wb.getWorksheet(name); const out = []; w.eachRow((row, i) => { if (i > 1) out.push(row.getCell(key).text); }); return out; };
          return { head, items, pink: ws.getCell(2, head.indexOf('2nd source') + 1).fill.fgColor.argb, comp: col('Components', 1), gap: col('Gap & Thermal', 1), legend: ws.getCell(items.length + 3, 1).text };
        }, b64);
      };
      let x = await exportXlsx(true);
      assert.deepEqual(x.head.filter(Boolean), ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', 'Note', '2nd source', 'Type', 'Status']);
      assert.ok(!x.items.includes('A2') && x.items.includes('A1-1') && x.items.includes('A3'));
      assert.equal(x.pink, 'FFF9CBF0', 'the 2nd source colour follows its column');
      assert.ok(!x.comp.includes('A2') && !x.gap.includes('A2'), 'hidden Item left out of the detail sheets');
      assert.match(x.legend, /未列出隱藏的 1 個 Item、2 欄/);
      // turned off → everything
      x = await exportXlsx(false);
      assert.deepEqual(x.head.slice(0, 10), ['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source']);
      assert.ok(x.items.includes('A2') && x.comp.includes('A2'));
    },
  },
  {
    name: 'import: existing Excel format with merged cells and a drawing',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      // Build a workbook shaped like the current TIM list (fictional data)
      const logo = fs.readFileSync(path.join(ROOT, 'assets/delta-logo-transparent.png')).toString('base64');
      const b64 = await page.evaluate(async logo => {
        const ExcelJS = await TIM.loader.load('exceljs');
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('TIM');
        ws.addRow(['Location', 'Item', 'Used On', 'Vendor', 'Model', 'Size', "Q'ty", 'Delta Part No.', 'Note', '2nd source']);
        ws.addRow(['Bottom Case', 'B1-1', 'RF', 'VendorX', 'Absorb Ultra', '51.5*9*3', 4, 'X-0001', 'PA1*4', 'VendorX only source']);
        ws.addRow(['', 'B2', 'RF', 'VendorY', 'TP900', '6*6*2.5', 8, 'X-0002', 'LDO1*2,BUCK1*4,BUCK2*2', 'short:LocalCo,long:VendorY']);
        ws.addRow(['', 'B3', 'DIGI', 'VendorB', 'GF-750', '11*11*2', 3, 'X-0003', 'CLK1,SYNC1,FAN1', 'VendorC']);
        ws.addRow(['Top Case', 'B4', 'PWR/DDR', 'VendorB', 'GF-750', '58*22*3', 4, 'X-0004', 'BRICK1,DDR*3', 'VendorC']);
        ws.addRow(['', 'B5', 'DIGI', 'VendorB', 'GF-600HD', '34*34*3.5', 2, 'X-0005', 'SOC1', 'VendorC']);
        ws.mergeCells('A2:A4'); ws.mergeCells('A5:A6');
        ws.getCell('A8').value = 'Bottom case';
        const img = wb.addImage({ base64: 'data:image/png;base64,' + logo, extension: 'png' });
        ws.addImage(img, { tl: { col: 0, row: 8 }, ext: { width: 256, height: 212 } });
        const buf = await wb.xlsx.writeBuffer();
        let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); });
        return btoa(s);
      }, logo);
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, 'import-sample.xlsx');
      fs.writeFileSync(file, Buffer.from(b64, 'base64'));

      await page.click('.nav-link:has-text("專案")');
      const chooser = page.waitForEvent('filechooser');
      await page.click('.home-actions button:has-text("匯入 Excel")');
      await page.click('.dropzone');
      await (await chooser).setFiles(file);
      await page.waitForSelector('.step.on:has-text("欄位對應")', { timeout: 30000 });
      const summary = await page.locator('.modal-body').innerText();
      assert.match(summary, /5\s*個 Item/);
      assert.match(summary, /偵測到 1 張圖片/);
      await page.click('.modal-foot button:has-text("下一步")');
      await page.fill('.modal .field:has(label:text-is("專案名稱")) input', 'Imported RRU');
      await page.click('.modal-foot button:has-text("匯入")');
      await page.waitForSelector('table.grid', { timeout: 30000 });
      const p = await page.evaluate(() => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects).find(x => x.name === 'Imported RRU'))));
      assert.deepEqual(p.locations.map(l => l.name), ['Bottom Case', 'Top Case']);
      const byNo = {}; p.items.forEach(i => { byNo[i.item_no] = i; });
      assert.deepEqual(Object.keys(byNo), ['B1-1', 'B2', 'B3', 'B4', 'B5']);
      const locName = id => p.locations.find(l => l.id === id).name;
      assert.equal(locName(byNo.B3.location_id), 'Bottom Case', 'merged Location carried down');
      assert.equal(locName(byNo.B5.location_id), 'Top Case');
      assert.deepEqual(byNo['B1-1'].size, { l: 51.5, w: 9, t: 3 });
      assert.equal(byNo['B1-1'].sourcing_note, 'VendorX only source');
      assert.equal(byNo['B1-1'].tim_type, 'absorber');
      assert.deepEqual(byNo.B2.sources.map(s => [s.vendor, s.note]), [['LocalCo', 'short'], ['VendorY', 'long']]);
      assert.deepEqual(byNo.B4.used_on, ['PWR', 'DDR']);
      assert.ok(byNo.B3.material_id && byNo.B4.material_id === byNo.B3.material_id, 'same Vendor+Model → one library material');
      assert.equal(p.views.length, 1);
      assert.equal(p.views[0].name, 'Bottom case');
      assert.equal(locName(p.views[0].location_id), 'Bottom Case', 'drawing linked to the location by name');
    },
  },
];
