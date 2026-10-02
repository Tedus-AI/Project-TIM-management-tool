'use strict';
// SharePoint is the master copy: local copy written on every SharePoint save; a local folder
// opened by mistake pushes every save into SharePoint, reminds the user and warns on failure.
const assert = require('node:assert/strict');
const { DB, fakeDrive, setup, allowHttp, saved } = require('./fake-sharepoint');
const { installFakeFs } = require('./fake-fs');

const seed = extra => Object.assign({
  schema: 'tim-db', schema_version: 1, rev: 5, updated_at: '2026-09-30T00:00:00.000Z', settings: {},
  materials: { mat_1: { id: 'mat_1', rev: 1, vendor: 'Vendor-A', model: 'GF-750', tim_type: 'pad', datasheets: [] } },
  projects: {
    prj_p: { id: 'prj_p', rev: 2, name: 'P', stage: 'EVT', locations: [], items: [], views: [], changelog: [], baselines: [] },
    prj_q: { id: 'prj_q', rev: 3, name: 'Q', stage: 'EVT', locations: [], items: [], views: [], changelog: [], baselines: [] },
  },
  images: {},
}, extra || {});
/** Change a project on SharePoint the way a colleague's save would. */
function colleague(g, pid, field, value) {
  const d = g.json(DB);
  d.projects[pid][field] = value; d.projects[pid].rev += 1; d.rev += 1; d.updated_at = new Date().toISOString();
  g.put(DB, Buffer.from(JSON.stringify(d)));
}
async function until(fn, what, ms) {
  const t0 = Date.now();
  while (!(await fn())) {
    if (Date.now() - t0 > (ms || 15000)) throw new Error('timed out waiting for ' + what);
    await new Promise(r => setTimeout(r, 50));
  }
}
const SIGNED_IN = () => localStorage.setItem('__fake_msal_account', JSON.stringify({ name: 'Tester A', username: 'tester.a@example.test' }));

/** Page with the fake SharePoint, sync switched on, a local folder holding a copy of the SharePoint database. */
async function prepare(env, g, opts) {
  const { page, base } = env;
  await setup(env, g);
  await page.goto(base);
  await page.waitForSelector('.gate');
  await page.evaluate(() => { TIM.sync.__disableForTest = false; });
  if (!opts || opts.signedIn !== false) await page.evaluate(SIGNED_IN);
  await installFakeFs(page);
  await page.evaluate(text => { window.__local = __fs.dir('TIM-local'); return __fs.write(window.__local, 'tim_db.json', text); }, g.text(DB));
}
async function openLocal(page) {
  assert.equal(await page.evaluate(() => __fs.open(window.__local)), true);
  await page.waitForSelector('.modal.sync-remind');
}

module.exports = [
  {
    name: 'SharePoint mode: every save also writes the local copy (write-only); a copy changed elsewhere is kept aside, never overwritten',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      g.put(DB, Buffer.from(JSON.stringify(seed())));
      await setup(env, g);
      await page.goto(base);
      await page.waitForSelector('.gate');
      await page.evaluate(() => { TIM.sync.__disableForTest = false; });
      await installFakeFs(page);
      // the folder already holds an older database that was changed elsewhere, and another file
      await page.evaluate(old => { window.__copy = __fs.dir('TIM-copy'); window.showDirectoryPicker = async () => window.__copy;
        return Promise.all([__fs.write(window.__copy, 'tim_db.json', old), __fs.write(window.__copy, 'notes.txt', 'keep me')]); },
      JSON.stringify(seed({ rev: 2, updated_at: '2026-09-01T00:00:00.000Z' })));
      await page.click('button:has-text("SharePoint 共用資料庫")');
      await page.waitForSelector('.proj-name:has-text("Q")');
      await page.click('.toolbar button[title="設定"]');
      assert.match(await page.locator('.modal dl.kv').innerText(), /本機副本\s+未設定/);
      await page.click('.modal button:has-text("設定本機副本資料夾")');
      await page.waitForFunction(() => TIM.sync.mirror.at);
      const names = await page.evaluate(() => __fs.names(window.__copy));
      const kept = names.filter(n => /^tim_db_local_\d{8}-\d{6}\.json$/.test(n));
      assert.equal(kept.length, 1, 'the copy changed elsewhere is kept: ' + names.join(', '));
      assert.ok(names.includes('notes.txt'));
      assert.equal(JSON.parse(await page.evaluate(n => __fs.read(window.__copy, n), kept[0])).rev, 2);
      assert.equal(await page.evaluate(() => __fs.read(window.__copy, 'tim_db.json')), g.text(DB), 'local copy = SharePoint');
      await page.waitForSelector('.toast:has-text("已另存為")');
      assert.match(await page.locator('.modal dl.kv').innerText(), /本機副本\s+TIM-copy \/ tim_db\.json · 最近寫入/);
      await page.keyboard.press('Escape');
      // our save → the copy follows
      await page.evaluate(() => TIM.actions.updateProject('prj_p', 'customer', 'edited on SharePoint'));
      await saved(page);
      await until(() => page.evaluate(() => __fs.read(window.__copy, 'tim_db.json')).then(t => /edited on SharePoint/.test(t)), 'copy after our save');
      assert.equal(await page.evaluate(() => __fs.read(window.__copy, 'tim_db.json')), g.text(DB));
      // a colleague's save pulled in → the copy follows too; nothing more kept aside
      colleague(g, 'prj_q', 'customer', 'colleague');
      await page.evaluate(() => TIM.store.syncCheck());
      await until(() => page.evaluate(() => __fs.read(window.__copy, 'tim_db.json')).then(t => /colleague/.test(t)), 'copy after a pulled change');
      assert.equal((await page.evaluate(() => __fs.names(window.__copy))).filter(n => /^tim_db_local_/.test(n)).length, 1);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'local folder opened by mistake: reminder, every save merged into SharePoint (colleague edits kept, datasheets uploaded), switch back',
    async run(env) {
      const { page } = env;
      const g = fakeDrive();
      g.put(DB, Buffer.from(JSON.stringify(seed())));
      await prepare(env, g);
      await openLocal(page);
      assert.match(await page.locator('.modal.sync-remind').innerText(), /TIM-local/);
      await page.click('.modal.sync-remind button:has-text("繼續在本機作業")');
      await page.waitForSelector('.sync-banner:has-text("目前在本機資料夾作業")');
      await page.waitForSelector('.sync-banner:has-text("已連線 SharePoint")');
      // a colleague changes Q on SharePoint; we change P locally
      colleague(g, 'prj_q', 'customer', 'colleague');
      await page.evaluate(() => TIM.actions.updateProject('prj_p', 'customer', 'from local'));
      await until(() => g.json(DB).projects.prj_p.customer === 'from local', 'push of P');
      assert.equal(g.json(DB).projects.prj_q.customer, 'colleague', "colleague's edit kept");
      assert.equal(Object.keys(g.json(DB).projects).length, 2, 'no conflict copies');
      await page.waitForSelector('.sync-banner:has-text("已同步到 SharePoint")');
      assert.match(await page.evaluate(() => __fs.read(window.__local, 'tim_db.json')), /from local/, 'saved locally too');
      // a datasheet uploaded here goes to SharePoint with the material
      await page.evaluate(() => TIM.datasheets.upload('mat_1', [new File(['%PDF-1.4 local'], 'GF-750_TDS.pdf', { type: 'application/pdf' })]));
      await until(() => (g.json(DB).materials.mat_1.datasheets || []).length === 1, 'push of the material');
      assert.equal(g.text('TIM_Manager/Datasheets/Vendor-A/GF-750/GF-750_TDS.pdf'), '%PDF-1.4 local');
      assert.equal(await page.evaluate(() => __fs.read(window.__local, 'Datasheets/Vendor-A/GF-750/GF-750_TDS.pdf')), '%PDF-1.4 local');
      // switch back to the online version from the banner
      await page.click('.sync-banner button:has-text("切換到 SharePoint")');
      await page.waitForFunction(() => TIM.store.backend && TIM.store.backend.kind === 'sharepoint');
      await page.waitForSelector('.proj-table');
      assert.equal(await page.locator('.sync-banner').count(), 0);
      assert.match(await page.locator('.db-chip').innerText(), /SharePoint/);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'local folder: SharePoint unreachable → warning, kept as pending; pushed when the folder is opened again or SharePoint is opened',
    async run(env) {
      const { page } = env;
      const g = fakeDrive();
      g.put(DB, Buffer.from(JSON.stringify(seed())));
      await prepare(env, g);
      await openLocal(page);
      await page.click('.modal.sync-remind button:has-text("繼續在本機作業")');
      await page.waitForSelector('.sync-banner:has-text("已連線 SharePoint")');
      g.down = true;
      await page.evaluate(() => TIM.actions.updateProject('prj_p', 'customer', 'offline P'));
      await page.waitForSelector('.modal.sync-fail');
      const warn = await page.locator('.modal.sync-fail').innerText();
      assert.match(warn, /寫入 SharePoint 失敗/);
      assert.match(warn, /1 筆待同步/);
      await page.click('.modal.sync-fail button:has-text("知道了")');
      await page.waitForSelector('.sync-banner.err:has-text("1 筆待同步")');
      assert.equal(g.json(DB).projects.prj_p.customer, undefined, 'SharePoint untouched');
      // retries that fail again do not pop the warning up again right away (at most every 10 minutes)
      await page.evaluate(() => TIM.sync.push.run());
      await page.evaluate(() => TIM.sync.push.run());
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.modal.sync-fail').count(), 0, 'no repeated warning');
      assert.match(await page.evaluate(() => __fs.read(window.__local, 'tim_db.json')), /offline P/, 'the work is safe locally');
      // close it (still failing: no warning left on the start page); SharePoint comes back;
      // open the same folder again → the pending edit is pushed
      await page.click('.db-chip');
      await page.waitForSelector('.gate');
      await page.waitForTimeout(300);
      assert.equal(await page.locator('.modal').count(), 0, 'nothing left open over the start page');
      g.down = false;
      await openLocal(page);
      await page.click('.modal.sync-remind button:has-text("繼續在本機作業")');
      await until(() => g.json(DB).projects.prj_p.customer === 'offline P', 'push after reopening');
      // pending again, then the user opens SharePoint from the start page → merged there
      g.down = true;
      await page.evaluate(() => TIM.actions.updateProject('prj_q', 'customer', 'offline Q'));
      await page.waitForSelector('.modal.sync-fail');
      await page.click('.modal.sync-fail button:has-text("知道了")');
      await page.click('.db-chip');
      await page.waitForSelector('.gate');
      g.down = false;
      await page.click('button:has-text("SharePoint 共用資料庫")');
      await page.waitForSelector('.toast:has-text("尚未同步的修改合併到 SharePoint")');
      await saved(page);
      await until(() => g.json(DB).projects.prj_q.customer === 'offline Q', 'leftover merged in SharePoint mode');
      assert.equal(g.json(DB).projects.prj_p.customer, 'offline P');
      allowHttp(env, [404, 503]);
      const other = env.errors.filter(e => !/\[sync\]|save failed/.test(e));
      env.errors.length = 0; env.errors.push(...other);
    },
  },
  {
    name: 'local folder without a Microsoft sign-in: reminder says so; the warning signs in and pushes',
    async run(env) {
      const { page } = env;
      const g = fakeDrive();
      g.put(DB, Buffer.from(JSON.stringify(seed())));
      await prepare(env, g, { signedIn: false });
      await openLocal(page);
      await page.waitForSelector('.modal.sync-remind:has-text("尚未登入 Microsoft")');
      await page.click('.modal.sync-remind button:has-text("繼續在本機作業")');
      await page.waitForSelector('.sync-banner:has-text("未登入 Microsoft")');
      await page.evaluate(() => TIM.actions.updateProject('prj_p', 'customer', 'needs sign-in'));
      await page.waitForSelector('.modal.sync-fail:has-text("尚未登入 Microsoft 帳號")');
      await page.click('.modal.sync-fail button:has-text("登入 Microsoft")');
      await until(() => g.json(DB).projects.prj_p.customer === 'needs sign-in', 'push after signing in');
      await page.waitForSelector('.sync-banner:has-text("已同步到 SharePoint")');
      allowHttp(env, [404]);
    },
  },
];
