'use strict';
const assert = require('node:assert/strict');

/** Replace the folder picker with an in-memory folder holding `files` ({ name: text }). */
async function fakeFolder(page, files, name) {
  await page.evaluate(([files, name]) => {
    const dir = window.__fakeDir = { files: {}, writes: 0 };
    Object.keys(files).forEach((n, i) => { dir.files[n] = { text: files[n], modified: Date.UTC(2026, 8, 1 + i) }; });
    const fileHandle = n => ({
      name: n, kind: 'file',
      async getFile() { const e = dir.files[n]; return new File([e.text], n, { type: 'application/json', lastModified: e.modified }); },
      async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { dir.files[n] = { text: buf, modified: Date.now() }; dir.writes++; } }; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    });
    const handle = {
      name, kind: 'directory',
      async *entries() { for (const n of Object.keys(dir.files)) yield [n, fileHandle(n)]; },
      async getFileHandle(n, opts) {
        if (!dir.files[n]) {
          if (!(opts && opts.create)) { const e = new Error('not found'); e.name = 'NotFoundError'; throw e; }
          dir.files[n] = { text: '', modified: Date.now() };
        }
        return fileHandle(n);
      },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    window.showDirectoryPicker = async () => handle;
  }, [files, name || 'TIM-share']);
}
const pickFolder = page => page.click('button:has-text("選擇資料庫資料夾")');
const files = page => page.evaluate(() => Object.keys(window.__fakeDir.files).sort());
const fileText = (page, n) => page.evaluate(n => window.__fakeDir.files[n].text, n);
const tinyDb = name => JSON.stringify({ schema: 'tim-db', schema_version: 1, rev: 3, settings: {}, materials: {},
  projects: { prj_x: { id: 'prj_x', rev: 1, name, stage: 'EVT', locations: [], items: [], views: [], changelog: [], baselines: [] } }, images: {} });

module.exports = [
  {
    name: 'start page: empty folder → create database → enter; switch back saves; reopen loads it',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await page.locator('.gate-title').innerText(), '專案 TIM 管理器');
      assert.equal(await page.locator('.gate input.inp').count(), 0, 'no name field on the start page');
      assert.doesNotMatch(await page.locator('.gate').innerText(), /試用|範例|瀏覽器暫存/, 'no trial / demo options');
      await fakeFolder(page, { 'report_builder.json': '{"reports":[]}' });
      await pickFolder(page);
      await page.waitForSelector('.modal:has-text("建立資料庫")');
      assert.match(await page.locator('.modal-body').innerText(), /TIM-share/);
      assert.equal(await page.locator('.modal input[type=checkbox]').count(), 0, 'no demo-project option');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      assert.doesNotMatch(await page.locator('.empty').innerText(), /範例/);
      await page.evaluate(() => TIM.actions.createProject({ name: 'Gate project' }));
      await page.waitForSelector('.proj-table');
      assert.deepEqual(await files(page), ['report_builder.json', 'tim_db.json']);
      assert.equal(await fileText(page, 'report_builder.json'), '{"reports":[]}', 'other files untouched');
      assert.equal(JSON.parse(await fileText(page, 'tim_db.json')).schema, 'tim-db');
      assert.match(await page.locator('.db-chip').getAttribute('title'), /TIM-share \/ tim_db\.json/);
      // edit, then go back to the start page right away: the edit is written first
      await page.click('.proj-name');
      await page.fill('.field:has(label:text-is("客戶")) input', 'Customer-Z');
      // (a fake handle cannot be stored in IndexedDB: serve the remembered folder record directly)
      await page.evaluate(async () => {
        const dir = await window.showDirectoryPicker();
        const get = TIM.idb.get;
        TIM.idb.get = async (d, s, k) => (k === 'db_dir' ? { dir, name: 'tim_db.json' } : get(d, s, k));
      });
      await page.click('.db-chip');
      await page.waitForSelector('.gate');
      assert.equal(Object.values(JSON.parse(await fileText(page, 'tim_db.json')).projects)[0].customer, 'Customer-Z');
      // the start page offers the last database; one click continues with it
      await page.waitForSelector('.gate-restore:has-text("TIM-share / tim_db.json")');
      await page.click('.gate-restore button:has-text("繼續使用")');
      await page.waitForSelector('.proj-table');
      await page.click('.db-chip');
      await page.waitForSelector('.gate');
      // the same folder again opens the database without asking
      await pickFolder(page);
      await page.waitForSelector('.proj-table');
      assert.equal(await page.locator('.modal').count(), 0);
      assert.ok(await page.locator('.proj-name').first().isVisible());
    },
  },
  {
    name: 'start page: several databases → chooser (non-TIM JSON ignored); cancel creates nothing',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      await fakeFolder(page, { 'team_a.json': tinyDb('Project A'), 'tim_db_backup_2026-09-30.json': tinyDb('Backup copy'), 'notes.json': '{"x":1}' });
      await pickFolder(page);
      await page.waitForSelector('.modal:has-text("選擇資料庫")');
      const rows = await page.locator('.db-pick-row .name').allInnerTexts();
      assert.deepEqual(rows, ['team_a.json', 'tim_db_backup_2026-09-30.json'], 'real database first, backups last, non-TIM files hidden');
      assert.ok(await page.locator('.db-pick-row:has-text("tim_db_backup") .tag').isVisible());
      await page.click('.db-pick-row:has-text("team_a.json")');
      await page.waitForSelector('.proj-name:has-text("Project A")');
      // a folder without databases: cancelling the question leaves it untouched
      await page.click('.db-chip');
      await page.waitForSelector('.gate');
      await fakeFolder(page, { 'notes.json': '{"x":1}' }, 'Empty');
      await pickFolder(page);
      await page.waitForSelector('.modal:has-text("建立資料庫")');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('.modal'));
      assert.deepEqual(await files(page), ['notes.json']);
      assert.ok(await page.locator('.gate').isVisible());
    },
  },
  {
    name: 'start page: damaged tim_db.json is reported, never replaced',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      await fakeFolder(page, { 'tim_db.json': '{"schema":"tim-db", broken' });
      await pickFolder(page);
      await page.waitForSelector('.gate-restore:has-text("無法開啟資料庫")');
      assert.equal(await fileText(page, 'tim_db.json'), '{"schema":"tim-db", broken');
      assert.equal(await page.evaluate(() => window.__fakeDir.writes), 0);
    },
  },
];
