'use strict';
// Settings, project list owners, material library columns and datasheets in a local database folder.
const assert = require('node:assert/strict');

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
];
