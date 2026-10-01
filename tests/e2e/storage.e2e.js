'use strict';
const assert = require('node:assert/strict');

/** Install an in-memory FileSystemFileHandle stand-in and attach it as the JSON database. */
async function attachFakeFile(page, text, opts) {
  await page.evaluate(([text, opts]) => {
    const f = window.__fakeFile = { text, writes: 0 };
    const handle = {
      name: 'tim_db.json',
      kind: 'file',
      async getFile() { return new File([f.text], 'tim_db.json', { type: 'application/json' }); },
      async createWritable() { let buf = ''; return { async write(t) { buf += t; }, async close() { f.text = buf; f.writes++; } }; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
    };
    TIM.fileBackend.__setHandleForTest(handle);
    window.__attachResult = TIM.app.attach(TIM.fileBackend, opts || {});
  }, [text, opts || {}]);
  return page.evaluate(() => window.__attachResult);
}
const disk = page => page.evaluate(() => JSON.parse(window.__fakeFile.text));
const flush = page => page.evaluate(() => TIM.store.flush());

module.exports = [
  {
    name: 'JSON file: create, autosave with rev, colleague edit merged, same-project conflict copy',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await attachFakeFile(page, '', { sample: true }), true);
      await page.waitForSelector('.proj-table');
      await flush(page);
      let d = await disk(page);
      assert.equal(d.schema, 'tim-db');
      const pid = Object.keys(d.projects)[0];
      const rev0 = d.rev;
      // local edit → autosave
      await page.click('.proj-name');
      await page.fill('.field:has(label:text-is("客戶")) input', 'Customer-L');
      await flush(page);
      d = await disk(page);
      assert.equal(d.projects[pid].customer, 'Customer-L');
      assert.ok(d.rev > rev0);
      // a colleague adds a project in the same file
      await page.evaluate(() => {
        const db = JSON.parse(window.__fakeFile.text);
        db.rev += 1;
        db.projects.prj_colleague = Object.assign(TIM.schema.newProject({ name: 'Colleague project' }), { id: 'prj_colleague', rev: 1 });
        window.__fakeFile.text = TIM.merge.serializeDb(db);
      });
      await page.fill('.field:has(label:text-is("專案代碼")) input', 'CODE-L');
      await flush(page);
      d = await disk(page);
      assert.equal(d.projects.prj_colleague.name, 'Colleague project', "colleague's project kept");
      assert.equal(d.projects[pid].code, 'CODE-L', 'our edit written');
      assert.ok(await page.evaluate(() => !!TIM.store.db.projects.prj_colleague), 'colleague project pulled into this session');
      // both edit the same project → their version kept, ours saved as a conflict copy, banner shown
      await page.evaluate(pid => {
        const db = JSON.parse(window.__fakeFile.text);
        db.rev += 1;
        db.projects[pid].rev += 1;
        db.projects[pid].customer = 'Customer-Colleague';
        window.__fakeFile.text = TIM.merge.serializeDb(db);
      }, pid);
      await page.fill('.field:has(label:text-is("客戶")) input', 'Customer-Mine');
      await flush(page);
      d = await disk(page);
      assert.equal(d.projects[pid].customer, 'Customer-Colleague');
      const copy = Object.values(d.projects).find(p => /衝突副本/.test(p.name));
      assert.ok(copy && copy.customer === 'Customer-Mine', 'our version preserved as a copy');
      await page.waitForSelector('.banner.warn:has-text("衝突副本")');
    },
  },
  {
    name: 'corrupt / foreign files are refused and never overwritten',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await attachFakeFile(page, '{"broken": '), false);
      await page.waitForSelector('.gate-restore:has-text("無法開啟資料庫")');
      assert.equal(await page.evaluate(() => window.__fakeFile.text), '{"broken": ');
      assert.equal(await attachFakeFile(page, '{"thermal_reports":{}}'), false);
      await page.waitForSelector('.gate-restore:has-text("Thermal Test Report Builder")');
      assert.equal(await page.evaluate(() => window.__fakeFile.writes), 0);
    },
  },
  {
    name: 'file replaced by a foreign file mid-session → read-only, untouched',
    async run(env) {
      const { page, base } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      await attachFakeFile(page, '', { sample: true });
      await page.waitForSelector('.proj-table');
      await flush(page);
      await page.evaluate(() => { window.__fakeFile.text = '{"thermal_reports":{"x":1}}'; });
      await page.click('.proj-name');
      await page.fill('.field:has(label:text-is("客戶")) input', 'should-not-be-written');
      await flush(page);
      await page.waitForSelector('.banner.err:has-text("唯讀模式")');
      assert.equal(await page.evaluate(() => window.__fakeFile.text), '{"thermal_reports":{"x":1}}');
      assert.equal(await page.locator('.field:has(label:text-is("客戶")) input').isDisabled(), true, 'inputs locked in read-only');
    },
  },
  {
    name: 'project share file round trip (JSON) re-maps ids and reuses materials',
    async run(env) {
      const { page, base } = env;
      const { openTrialWithDemo } = require('./helpers');
      await openTrialWithDemo(env);
      const dl = page.waitForEvent('download');
      await page.click('.proj-table tr .row-actions button[title="更多"]');
      await page.click('.menu button:has-text("匯出分享檔")');
      const file = await (await dl).path();
      const chooser = page.waitForEvent('filechooser');
      await page.click('.home-actions button:has-text("匯入分享檔")');
      await (await chooser).setFiles(file);
      await page.waitForSelector('.proj-head');
      const r = await page.evaluate(() => {
        const ps = Object.values(TIM.store.db.projects);
        const [a, b] = ps;
        const viewOk = b.views.every(v => TIM.store.db.images[v.image_id]) && b.views.every(v => v.shapes.every(s => b.items.some(i => i.id === s.item_id)));
        return { n: ps.length, names: ps.map(p => p.name), mats: Object.keys(TIM.store.db.materials).length, sharedIds: a.items.some(i => b.items.some(j => j.id === i.id)), viewOk };
      });
      assert.equal(r.n, 2);
      assert.ok(r.names[1].endsWith('（匯入）'));
      assert.equal(r.mats, 6, 'materials matched by vendor+model, not duplicated');
      assert.equal(r.sharedIds, false, 'ids re-generated');
      assert.equal(r.viewOk, true, 'images and pad → item links intact');
    },
  },
];
