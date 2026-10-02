'use strict';
// Settings, project list owners, material library columns and datasheets in a local database folder.
const assert = require('node:assert/strict');
const { installFakeFs } = require('./fake-fs');

/** Open an in-memory database folder (File System Access stand-in with sub-folders). */
async function openLocalFolder(page) {
  return page.evaluate(async () => {
    const notFound = () => Object.assign(new Error('not found'), { name: 'NotFoundError' });
    const file = name => {
      const f = {
        name, kind: 'file', blob: new Blob([]),
        async getFile() { return new File([f.blob], name); },
        async createWritable() { const parts = []; return { async write(x) { parts.push(x); }, async close() { f.blob = new Blob(parts); } }; },
        async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
      };
      return f;
    };
    const dir = name => {
      const d = {
        name, kind: 'directory', children: new Map(),
        async getDirectoryHandle(n, o) { let c = d.children.get(n); if (!c) { if (!(o && o.create)) throw notFound(); c = dir(n); d.children.set(n, c); } return c; },
        async getFileHandle(n, o) { let c = d.children.get(n); if (!c) { if (!(o && o.create)) throw notFound(); c = file(n); d.children.set(n, c); } return c; },
        async removeEntry(n) { if (!d.children.delete(n)) throw notFound(); },
        async *entries() { for (const e of d.children) yield e; },
        async queryPermission() { return 'granted'; }, async requestPermission() { return 'granted'; },
      };
      return d;
    };
    const root = window.__root = dir('TIM-local');
    /** Text of a file below the root ("a/b/c.txt"), or null. */
    window.__read = async p => {
      let d = root; const parts = p.split('/'); const n = parts.pop();
      for (const s of parts) { d = d.children.get(s); if (!d) return null; }
      const f = d.children.get(n);
      return f ? f.blob.text() : null;
    };
    TIM.fileBackend.__setHandleForTest(await root.getFileHandle('tim_db.json', { create: true }), root);
    return TIM.app.attach(TIM.fileBackend);
  });
}

module.exports = [
  {
    name: 'settings: only the new-project Location (dropdown) + currency; new project + list show TH / ME owners',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await openLocalFolder(page), true);
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      await page.click('.toolbar button[title="設定"]');
      await page.waitForSelector('.modal:has-text("新專案預設 Location")');
      const labels = await page.locator('.modal .form-grid .field > label').allInnerTexts();
      assert.deepEqual(labels.map(l => l.replace(/\s*\?$/, '').trim()), ['新專案預設 Location', '預設幣別']);
      const body = await page.locator('.modal-body').innerText();
      for (const gone of ['你的名字', 'TIM 溫升警示門檻', '一般建議壓縮率', 'Thermal Pad min']) assert.ok(!body.includes(gone), gone + ' removed');
      const sel = '.modal .field:has(label:has-text("新專案預設 Location")) select';
      assert.deepEqual(await page.locator(sel + ' option').allInnerTexts(), ['Bottom Case + Top Case', 'Bottom Case', 'Top Case']);
      assert.equal(await page.inputValue(sel), 'both');
      await page.selectOption(sel, 'top');
      assert.deepEqual(await page.evaluate(() => TIM.store.db.settings.default_locations), ['Top Case']);
      assert.match(await page.locator('.modal dl.kv').innerText(), /規格書\s+TIM-local \/ Datasheets/);
      await page.click('.modal-foot button:has-text("完成")');
      // new project: Location preset from the settings, both owners
      await page.click('button:has-text("新增專案")');
      await page.waitForSelector('.modal:has-text("新增專案")');
      assert.equal(await page.inputValue('.modal .field:has(label:text-is("Location")) select'), 'top');
      await page.fill('.modal .field:has(label:text-is("案名 *")) input', 'Proj-L');
      await page.fill('.modal .field:has(label:text-is("熱流負責人")) input', 'Thermal-X');
      await page.fill('.modal .field:has(label:text-is("機構負責人")) input', 'ME-Y');
      await page.click('.modal-foot button:has-text("建立專案")');
      await page.waitForSelector('.crumb:has-text("Proj-L")');
      assert.deepEqual(await page.evaluate(() => Object.values(TIM.store.db.projects)[0].locations.map(l => l.name)), ['Top Case']);
      // project list: 負責人 column (TH: / ME:), no cost; Thermal owner under the last update
      await page.evaluate(() => TIM.ui.go(''));
      await page.waitForSelector('.proj-table');
      const head = await page.locator('.proj-table thead').innerText();
      assert.match(head, /負責人/);
      assert.doesNotMatch(head, /成本/);
      const owners = await page.locator('.proj-table tbody tr .proj-owners').innerText();
      assert.match(owners, /TH:\s*Thermal-X/);
      assert.match(owners, /ME:\s*ME-Y/);
      const cells = await page.locator('.proj-table tbody tr td').allInnerTexts();
      assert.match(cells[6], /Thermal-X/, 'Thermal engineer under the last-update time');
    },
  },
  {
    name: 'material library: no 建議壓縮 % / AVL columns or fields; datasheets in the database folder (drag & drop), read-only keeps view',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await openLocalFolder(page), true);
      const mid = await page.evaluate(() => TIM.actions.createMaterial({ vendor: 'Vendor-B', model: 'GF-600HD', k: 6, datasheet_url: 'https://example.test/old.pdf' }));
      await page.evaluate(() => TIM.ui.go('library'));
      await page.waitForSelector('.tbl tbody tr:has-text("GF-600HD")');
      const head = await page.locator('.tbl thead').innerText();
      assert.doesNotMatch(head, /建議壓縮|AVL/);
      assert.match(head, /規格書/);
      assert.equal(await page.locator('.lib-filters select').count(), 1, 'type filter only (no AVL filter)');
      await page.click('.tbl tbody tr:has-text("GF-600HD")');
      await page.waitForSelector('.drawer .ds-field');
      const labels = (await page.locator('.drawer .field > label').allInnerTexts()).map(l => l.replace(/\s*\?$/, '').trim());
      for (const gone of ['建議壓縮率 min', '建議壓縮率 max', 'Datasheet 版次 / 日期', 'Datasheet 連結 / 路徑']) assert.ok(!labels.includes(gone), gone + ' removed');
      assert.ok(labels.includes('規格書'));
      // the old link is still shown (read-only) and can be removed
      assert.equal(await page.locator('.ds-legacy a').getAttribute('href'), 'https://example.test/old.pdf');
      // drop two files onto the field (synthetic DragEvent: Playwright drag would coalesce the events)
      const over = await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add(new File(['%PDF-1.4 demo'], 'GF-600HD datasheet.pdf', { type: 'application/pdf' }));
        dt.items.add(new File(['msds'], 'MSDS.txt', { type: 'text/plain' }));
        window.__dt = dt;
        document.querySelector('.ds-field').dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        return new Promise(r => requestAnimationFrame(() => r(document.querySelector('.ds-field').classList.contains('over'))));
      });
      assert.equal(over, true, 'drop target highlighted');
      await page.evaluate(() => document.querySelector('.ds-field').dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
      await page.waitForSelector('.ds-field [data-ds="view"] .ds-n:text-is("2")');
      assert.equal(await page.evaluate(() => window.__read('Datasheets/Vendor-B/GF-600HD/GF-600HD datasheet.pdf')), '%PDF-1.4 demo');
      assert.equal(await page.evaluate(() => window.__read('Datasheets/Vendor-B/GF-600HD/MSDS.txt')), 'msds');
      await page.waitForFunction(() => TIM.store.status.state === 'saved');
      const disk = JSON.parse(await page.evaluate(() => window.__read('tim_db.json')));
      assert.equal(disk.materials[mid].datasheets.length, 2);
      // delete one (single-file 🗑 after the list) → removed from the folder once saved
      await page.click('.ds-field [data-ds="list"]');
      await page.click('.ds-list tr:has-text("MSDS.txt") button[title="刪除"]');
      await page.waitForSelector('.modal:has-text("刪除規格書")');
      assert.match(await page.locator('.modal:has-text("刪除規格書") .modal-body').innerText(), /資料庫資料夾刪除/);
      await page.click('.modal-foot button:has-text("刪除")');
      await page.waitForFunction(() => document.querySelectorAll('.ds-list tbody tr').length === 1);
      await page.waitForFunction(() => window.__read('Datasheets/Vendor-B/GF-600HD/MSDS.txt').then(t => t === null));
      await page.keyboard.press('Escape');
      await page.click('.ds-legacy button:has-text("移除")');
      await page.waitForFunction(id => TIM.store.db.materials[id].datasheet_url === '', mid);
      assert.equal(await page.locator('.ds-legacy').count(), 0);
      // read-only database: viewing still works, writing is off
      await page.evaluate(() => { TIM.store.readonly = true; TIM.store.readonlyReason = 'test'; TIM.store.emit(); });
      assert.ok(await page.locator('.ds-field [data-ds="upload"]').isDisabled());
      assert.ok(await page.locator('.ds-field [data-ds="delete"]').isDisabled());
      assert.ok(!(await page.locator('.ds-field [data-ds="view"]').isDisabled()));
      await page.click('.ds-field [data-ds="view"]');
      await page.waitForSelector('.modal.viewer iframe.ds-frame');
    },
  },
  {
    name: '匯入材料: copy the AI prompt, AI reply pasted / dropped with the datasheet, preview (new / fill), import + attach, undo',
    async run(env) {
      const { page, base, context } = env;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
      await page.goto(base);
      await page.waitForSelector('.gate');
      await installFakeFs(page);
      assert.equal(await page.evaluate(() => { window.__root = __fs.dir('TIM-local'); return __fs.open(window.__root); }), true);
      const mid = await page.evaluate(() => TIM.actions.createMaterial({ vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7, note: 'kept' }));
      await page.evaluate(() => TIM.ui.go('library'));
      await page.click('.home-actions button:has-text("匯入材料")');
      await page.waitForSelector('.modal:has-text("匯入材料")');
      // 1. the instructions for the AI
      await page.click('.modal button:has-text("複製 AI 指令")');
      await page.waitForSelector('.toast:has-text("已複製 AI 指令")');
      const prompt = await page.evaluate(() => navigator.clipboard.readText());
      assert.match(prompt, /"format": "tim-material"/);
      assert.match(prompt, /- k：熱傳導係數 k（單位 W\/m·K）/);
      // 2. a reply that is not JSON → clear message
      await page.fill('.mi-paste', '抱歉，這份 PDF 我讀不到表格。');
      await page.waitForSelector('.modal .text-err:has-text("找不到可讀的 JSON")');
      await page.fill('.mi-paste', '');
      // the AI's file + the datasheet, dropped together
      const reply = {
        format: 'tim-material', version: 1,
        materials: [
          { vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7.5, hardness: 45, hardness_scale: 'Shore 00', temp_min: -40, temp_max: 200,
            evidence: { hardness: 'p.2 Hardness 45 Shore 00', temp_min: 'p.1 -40 to 200 °C' } },
          { vendor: 'Vendor-C', model: 'TP-800', tim_type: 'grease', k: 3.2, ul94: 'V0', evidence: { k: 'p.1 3.2 W/m-K' } },
        ],
      };
      await page.evaluate(json => {
        const dt = new DataTransfer();
        dt.items.add(new File([json], 'GF-750.tim-material.json', { type: 'application/json' }));
        dt.items.add(new File(['%PDF-1.4 TDS'], 'GF-750_TDS.pdf', { type: 'application/pdf' }));
        document.querySelector('.mi-drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, JSON.stringify(reply));
      await page.waitForSelector('.mi-table tbody tr:has-text("TP-800")');
      const rows = page.locator('.mi-table > tbody > tr:not(.mi-detail)');
      assert.equal(await rows.count(), 2);
      assert.equal(await rows.nth(0).locator('select').inputValue(), 'fill', 'existing material: fill the empty fields');
      assert.match(await rows.nth(0).innerText(), /已在材料庫/);
      assert.equal(await rows.nth(1).locator('select').inputValue(), 'new');
      assert.match(await rows.nth(1).innerText(), /新材料/);
      await rows.nth(0).locator('button:has-text("明細")').click();
      const detail = await page.locator('.mi-detail').innerText();
      assert.match(detail, /p\.2 Hardness 45 Shore 00/, 'AI evidence shown next to the value');
      assert.doesNotMatch(detail, /熱傳導係數 k/, 'k already in the library → not changed when filling');
      // the datasheet goes to GF-750 only
      await page.selectOption('.mi-doc select', '0');
      await page.click('.modal-foot button:has-text("匯入 2 種材料")');
      await page.waitForSelector('.toast:has-text("新增 1 種、更新 1 種")');
      await page.waitForSelector('.drawer:has-text("GF-750")');
      await page.waitForFunction(id => (TIM.store.db.materials[id].datasheets || []).length === 1, mid);
      const lib = await page.evaluate(() => Object.values(TIM.store.db.materials).map(m => ({ model: m.model, k: m.k, hardness: m.hardness, note: m.note, type: m.tim_type, ul94: m.ul94, ds: (m.datasheets || []).map(d => d.name) })));
      const gf = lib.find(m => m.model === 'GF-750'), tp = lib.find(m => m.model === 'TP-800');
      assert.deepEqual([gf.k, gf.hardness, gf.note, gf.ds], [7, 45, 'kept', ['GF-750_TDS.pdf']]);
      assert.deepEqual([tp.k, tp.type, tp.ul94, tp.ds], [3.2, 'grease', 'V-0', []]);
      assert.equal(await page.evaluate(() => __fs.read(window.__root, 'Datasheets/Vendor-B/GF-750/GF-750_TDS.pdf')), '%PDF-1.4 TDS');
      // undo: the attachment, then the whole import (one step)
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.drawer'));
      await page.keyboard.press('Control+z');
      await page.waitForFunction(id => !(TIM.store.db.materials[id].datasheets || []).length, mid);
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => Object.keys(TIM.store.db.materials).length === 1);
      assert.equal(await page.evaluate(id => TIM.store.db.materials[id].hardness, mid), null);
    },
  },
  {
    name: '劑型: dropdown only for Gap Filler / Thermal Putty (new material), cleared with another type, undo; list / item / import show it',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      await installFakeFs(page);
      assert.equal(await page.evaluate(() => { window.__root = __fs.dir('TIM-local'); return __fs.open(window.__root); }), true);
      await page.evaluate(() => TIM.ui.go('library'));
      await page.click('.home-actions button:has-text("新增材料")');
      await page.waitForSelector('.drawer .field:has(> label:has-text("型態")) select');
      const mid = await page.evaluate(() => location.hash.split('/').pop());
      const typeSel = '.drawer .field:has(> label:has-text("型態")) select';
      const partsSel = '.drawer .field:has(> label:has-text("劑型")) select';
      const parts = () => page.evaluate(id => TIM.store.db.materials[id].parts, mid);
      assert.equal(await page.inputValue(typeSel), 'pad');
      assert.equal(await page.locator(partsSel).count(), 0, 'Thermal Pad: no 劑型');
      for (const t of ['absorber', 'gel', 'grease', 'pcm']) {
        await page.selectOption(typeSel, t);
        await page.waitForFunction(([id, v]) => TIM.store.db.materials[id].tim_type === v, [mid, t]);
        assert.equal(await page.locator(partsSel).count(), 0, t + ': no 劑型');
      }
      // Gap Filler → the dropdown appears, nothing chosen yet
      await page.selectOption(typeSel, 'gap_filler');
      await page.waitForSelector(partsSel);
      assert.deepEqual(await page.locator(partsSel + ' option').allInnerTexts(), ['— 請選擇 —', '單劑型（1-part）', '雙劑型（2-part）']);
      assert.equal(await page.inputValue(partsSel), '');
      await page.selectOption(partsSel, 'two_part');
      await page.waitForFunction(id => TIM.store.db.materials[id].parts === 'two_part', mid);
      await page.waitForSelector('.tbl tbody tr:has-text("新材料") td:text-is("Gap Filler · 雙劑")');
      // Thermal Putty keeps it
      await page.selectOption(typeSel, 'putty');
      await page.waitForFunction(id => TIM.store.db.materials[id].tim_type === 'putty', mid);
      assert.equal(await page.inputValue(partsSel), 'two_part');
      await page.waitForSelector('.tbl tbody tr:has-text("新材料") td:text-is("Thermal Putty · 雙劑")');
      // another type → gone and cleared; undo brings both back (one step)
      await page.selectOption(typeSel, 'pad');
      await page.waitForFunction(id => TIM.store.db.materials[id].tim_type === 'pad', mid);
      assert.equal(await parts(), '');
      assert.equal(await page.locator(partsSel).count(), 0);
      await page.waitForSelector('.tbl tbody tr:has-text("新材料") td:text-is("Thermal Pad")');
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press('Control+z');
      // type changes within 2.5 s share one undo step (putty → pad), so this lands on Gap Filler: 劑型 is back either way
      await page.waitForFunction(id => TIM.store.db.materials[id].parts === 'two_part', mid);
      const back = await page.evaluate(id => TIM.store.db.materials[id].tim_type, mid);
      assert.ok(['gap_filler', 'putty'].includes(back), back);
      await page.waitForSelector(partsSel);
      assert.equal(await page.inputValue(partsSel), 'two_part');
      await page.selectOption(typeSel, 'putty');
      await page.waitForFunction(id => TIM.store.db.materials[id].tim_type === 'putty', mid);
      // saved with the database
      await page.waitForFunction(id => Promise.resolve(__fs.read(window.__root, 'tim_db.json')).then(t => {
        const m = t && JSON.parse(t).materials[id];
        return !!m && m.tim_type === 'putty' && m.parts === 'two_part';
      }), mid);
      // a linked item shows the material's type with its 劑型
      const ids = await page.evaluate(id => {
        const pid = TIM.actions.createProject({ name: 'DEMO-P' });
        const iid = TIM.actions.addItem(pid);
        TIM.actions.linkMaterial(pid, iid, id);
        return { pid, iid };
      }, mid);
      await page.evaluate(x => TIM.ui.go('p/' + x.pid + '/bom/' + x.iid), ids);
      await page.waitForSelector('.drawer .field:has(> label:text-is("型態")) .ref-value:text-is("Thermal Putty · 雙劑")');
      // import: 劑型 from the AI file; on a grease it is dropped with a reminder
      await page.evaluate(() => TIM.ui.go('library'));
      await page.click('.home-actions button:has-text("匯入材料")');
      await page.waitForSelector('.modal:has-text("匯入材料")');
      await page.fill('.mi-paste', JSON.stringify({ format: 'tim-material', version: 1, materials: [
        { vendor: 'Vendor-D', model: 'GF-D1', tim_type: 'gap_filler', parts: '1-Part Dispensable', k: 9, evidence: { parts: 'p.1 1-Part Dispensable Gap Filler' } },
        { vendor: 'Vendor-C', model: 'TP-800', tim_type: 'grease', parts: 'one_part', k: 3.2 },
      ] }));
      await page.waitForSelector('.mi-table tbody tr:has-text("TP-800")');
      const rows = page.locator('.mi-table > tbody > tr:not(.mi-detail)');
      assert.match(await rows.nth(0).innerText(), /Gap Filler · 單劑/);
      assert.match(await rows.nth(1).innerText(), /1 個提醒/);
      await rows.nth(0).locator('button:has-text("明細")').click();
      const detail = await page.locator('.mi-detail').innerText();
      assert.match(detail, /劑型[\s\S]*單劑型（1-part）/);
      assert.match(detail, /p\.1 1-Part Dispensable Gap Filler/);
      await page.click('.modal-foot button:has-text("匯入 2 種材料")');
      await page.waitForSelector('.toast:has-text("新增 2 種")');
      const got = await page.evaluate(() => Object.values(TIM.store.db.materials).filter(m => m.vendor !== '').map(m => [m.model, m.tim_type, m.parts]).sort());
      assert.deepEqual(got, [['GF-D1', 'gap_filler', 'one_part'], ['TP-800', 'grease', '']]);
    },
  },
  {
    name: '壓力–壓縮曲線: add a thickness, paste points from Excel, chart; 重新匯入 updates the material (覆蓋, names kept), undo',
    async run(env) {
      const { page, base, context } = env;
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base.replace(/\/$/, '') });
      await page.goto(base);
      await page.waitForSelector('.gate');
      await installFakeFs(page);
      assert.equal(await page.evaluate(() => { window.__root = __fs.dir('TIM-local'); return __fs.open(window.__root); }), true);
      const mid = await page.evaluate(() => TIM.actions.createMaterial({ vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7, note: 'kept' }));
      await page.evaluate(id => TIM.ui.go('library/' + id), mid);
      await page.waitForSelector('#m-curve');
      assert.equal(await page.locator('#m-curve .curve-chart').count(), 0, 'no curve → no chart');
      await page.click('#m-curve button:has-text("新增厚度曲線")');
      await page.waitForSelector('#m-curve .curve-card');
      // paste two columns copied from Excel onto the card → replaces its points
      await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', '10\t13\r\n20\t38\r\n30\t55\r\n');
        document.querySelector('#m-curve .curve-card').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      });
      await page.waitForSelector('.toast:has-text("已貼上 3 點")');
      const cur = () => page.evaluate(id => JSON.parse(JSON.stringify(TIM.store.db.materials[id])), mid);
      assert.deepEqual((await cur()).pressure_curves, [{ t: 1, points: [[10, 13], [20, 38], [30, 55]] }]);
      await page.waitForFunction(() => document.querySelectorAll('#m-curve .curve-chart circle').length === 3);
      assert.match(await page.locator('#m-curve .curve-chart svg').innerHTML(), /1 mm · 20 psi → 38%/);
      // edit one point in the table
      await page.locator('#m-curve .curve-pts tbody tr').nth(2).locator('input').nth(1).fill('60');
      await page.waitForFunction(id => TIM.store.db.materials[id].pressure_curves[0].points[2][1] === 60, mid);

      // 重新匯入 from the drawer: prompt names the material; the AI's other names are ignored
      await page.click('.drawer button:has-text("重新匯入")');
      await page.waitForSelector('.modal-head:has-text("重新匯入：Vendor-B GF-750")');
      await page.click('.modal button:has-text("複製 AI 指令")');
      await page.waitForSelector('.toast:has-text("已複製 AI 指令")');
      assert.match(await page.evaluate(() => navigator.clipboard.readText()), /vendor 請填 "Vendor-B"、model 請填 "GF-750"（照抄）/);
      await page.fill('.mi-paste', JSON.stringify({ format: 'tim-material', version: 1, materials: [{ vendor: 'Vendor B Inc.', model: 'GF-750 Series', tim_type: 'pad', k: 7.5,
        pressure_curves: [{ thickness_mm: 1.0, points: [[10, 13], [20, 38], [50, 68]] }, { thickness_mm: 2.0, points: [[10, 45], [20, 70]] }],
        evidence: { pressure_curves: 'p.2 Deflection vs Pressure（讀圖）' } }] }));
      const row = page.locator('.mi-table > tbody > tr:not(.mi-detail)').first();
      await row.waitFor();
      assert.equal(await row.locator('select').inputValue(), 'overwrite');
      assert.match(await row.innerText(), /Vendor-B[\s\S]*GF-750[\s\S]*重新匯入[\s\S]*AI 寫的是「Vendor B Inc\. GF-750 Series」/);
      await page.waitForSelector('.mi-detail');                 // a single row opens its details by itself
      const detail = await page.locator('.mi-detail').innerText();
      assert.match(detail, /壓力–壓縮曲線\s+2 條（1 mm \/ 2 mm，共 5 點）\s+1 條（1 mm，共 3 點）\s+p\.2 Deflection vs Pressure（讀圖）/);
      assert.doesNotMatch(detail, /\bVendor\b\s/, 'names are not changed');
      await page.click('.modal-foot button:has-text("匯入 1 種材料")');
      await page.waitForSelector('.toast:has-text("新增 0 種、更新 1 種")');
      const after = await cur();
      assert.deepEqual([after.vendor, after.model, after.k, after.note, after.pressure_curves.length], ['Vendor-B', 'GF-750', 7.5, 'kept', 2]);
      await page.waitForFunction(() => document.querySelectorAll('#m-curve .curve-card').length === 2);
      // one undo step brings the hand-entered curve back
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      await page.keyboard.press('Control+z');
      await page.waitForFunction(id => TIM.store.db.materials[id].k === 7, mid);
      assert.equal((await cur()).pressure_curves.length, 1);
    },
  },
];
