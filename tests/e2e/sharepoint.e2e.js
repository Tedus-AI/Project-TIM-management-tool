'use strict';
// SharePoint database + datasheets against an in-memory Microsoft Graph (routed in Node) and a
// stand-in for MSAL.js (window.msal defined before the page loads, so the CDN copy is not used).
const assert = require('node:assert/strict');
const { attachFakeFile, addDemo } = require('./helpers');
const { DB, fakeDrive, setup, allowHttp, saved, openSp } = require('./fake-sharepoint');


module.exports = [
  {
    name: 'SharePoint: sign in → create the database → autosave with If-Match → backup (date + time) → silent restore after reload',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      assert.match(await page.locator('.modal-body').innerText(), /Thermal-Spec-DB \/ TIM_Manager \/ Database \/ tim_db\.json/);
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      assert.equal(await page.evaluate(() => window.__msalConfig.auth.redirectUri), base + 'auth.html', 'redirect URI = the blank auth page');
      assert.equal(g.json(DB).schema, 'tim-db');
      assert.match(await page.locator('.db-chip').innerText(), /SharePoint/);
      // new project: Thermal owner defaults to the Microsoft account
      await page.click('button:has-text("新增專案")');
      assert.equal(await page.inputValue('.modal .field:has(label:text-is("熱流負責人")) input'), 'Tester A');
      await page.fill('.modal .field:has(label:text-is("案名 *")) input', 'SP-Alpha');
      await page.click('.modal-foot .btn-primary');
      await page.waitForSelector('.crumb:has-text("SP-Alpha")');
      await saved(page);
      const p = Object.values(g.json(DB).projects)[0];
      assert.equal(p.name, 'SP-Alpha');
      assert.equal(p.owner, 'Tester A');
      assert.equal(p.updated_by, 'Tester A', 'change log user = Microsoft account');
      const puts = g.log.filter(l => l.method === 'PUT' && /\/items\//.test(l.p));
      assert.ok(puts.length >= 2 && puts.every(l => l.ifMatch), 'every database write carries If-Match');
      // backup next to the database
      await page.waitForFunction(() => TIM.backup.lastAt() > 0);
      const backups = Array.from(g.files.keys()).filter(k => k.startsWith('TIM_Manager/Database/Backup/'));
      assert.equal(backups.length, 1);
      assert.match(backups[0], /\/tim_db_backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
      // reload: signed in already → opens straight away, no popup
      await page.reload();
      await page.waitForSelector('.crumb:has-text("SP-Alpha")');
      assert.equal(await page.evaluate(() => window.__logins || 0), 0);
      // settings show where everything is
      await page.click('.toolbar button[title="設定"]');
      const kv = await page.locator('.modal dl.kv').innerText();
      assert.match(kv, /SharePoint · Thermal-Spec-DB \/ TIM_Manager \/ Database \/ tim_db\.json/);
      assert.match(kv, /Tester A/);
      assert.match(kv, /Thermal-Spec-DB \/ TIM_Manager \/ Datasheets/);
      assert.match(kv, /Thermal-Spec-DB \/ TIM_Manager \/ Database \/ Backup/);
      assert.equal(await page.locator('.modal button:has-text("自動備份資料夾")').count(), 0);
      assert.equal(await page.locator('.modal button:has-text("搬到 SharePoint")').count(), 0);
      await page.keyboard.press('Escape');
      // switch → start page offers to continue; the database is opened again without signing in
      await page.click('.db-chip');
      await page.waitForSelector('.gate-restore:has-text("SharePoint 共用資料庫")');
      assert.match(await page.locator('.gate-restore').innerText(), /Tester A/);
      await page.click('.gate-restore button:has-text("繼續使用")');
      await page.waitForSelector('.proj-name:has-text("SP-Alpha")');
      assert.equal(await page.evaluate(() => window.__logins || 0), 0);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'SharePoint: someone saves between our read and our write → 412 → merged and written again',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      const seed = { schema: 'tim-db', schema_version: 1, rev: 5, updated_at: '2026-09-30T00:00:00.000Z', settings: {}, materials: {},
        projects: {
          prj_p: { id: 'prj_p', rev: 2, name: 'P', stage: 'EVT', locations: [], items: [], views: [], changelog: [], baselines: [] },
          prj_q: { id: 'prj_q', rev: 3, name: 'Q', stage: 'EVT', locations: [], items: [], views: [], changelog: [], baselines: [] },
        }, images: {} };
      g.put(DB, Buffer.from(JSON.stringify(seed)));
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.proj-name:has-text("Q")');
      // a colleague's save lands right before ours: P changed on SharePoint
      g.beforePut = f => {
        const d = JSON.parse(f.content.toString('utf8'));
        d.rev += 1; d.updated_at = new Date().toISOString();
        d.projects.prj_p.customer = 'from-colleague'; d.projects.prj_p.rev += 1;
        g.put(f.path, Buffer.from(JSON.stringify(d)));
      };
      await page.evaluate(() => TIM.actions.updateProject('prj_q', 'customer', 'from-me'));
      await saved(page);
      const d = g.json(DB);
      assert.equal(d.projects.prj_p.customer, 'from-colleague', "colleague's edit kept");
      assert.equal(d.projects.prj_q.customer, 'from-me', 'our edit written after the merge');
      assert.equal(Object.keys(d.projects).length, 2, 'no conflict copies');
      assert.equal(g.log.filter(l => l.method === 'PUT' && /\/items\//.test(l.p)).length, 2, 'rejected once (412), then written');
      assert.equal(await page.evaluate(() => TIM.store.db.projects.prj_p.customer), 'from-colleague', 'their change is on screen');
      assert.equal(await page.evaluate(() => TIM.store.conflicts.length), 0);
      allowHttp(env, [412]);
    },
  },
  {
    name: 'SharePoint: expired sign-in → save waits, banner asks to sign in again → saved',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      // the toolbar shows the signed-in Microsoft ID
      assert.equal((await page.locator('.toolbar .acct-chip:not(.off)').innerText()).trim(), 'tester.a@example.test');
      assert.match(await page.locator('.toolbar .acct-chip').getAttribute('title'), /已登入 Microsoft[\s\S]*Tester A/);
      await page.evaluate(() => { window.__expired = true; TIM.actions.createProject({ name: 'Later' }); });
      await page.waitForSelector('.banner:has-text("Microsoft 登入已過期")');
      await page.waitForSelector('.toolbar .acct-chip.off:has-text("需重新登入")');
      assert.equal(await page.evaluate(() => window.__popups || 0), 0, 'no popup without a click (it would be blocked)');
      assert.equal(Object.keys(g.json(DB).projects).length, 0);
      await page.click('.banner button:has-text("重新登入 Microsoft")');
      await saved(page);
      assert.equal(Object.values(g.json(DB).projects)[0].name, 'Later');
      assert.equal(await page.locator('.banner:has-text("儲存失敗")').count(), 0);
      await page.waitForSelector('.toolbar .acct-chip:not(.off):has-text("tester.a@example.test")');
      // the expected failure was logged on purpose
      const other = env.errors.filter(e => !/save failed/.test(e));
      env.errors.length = 0; env.errors.push(...other);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'datasheets on SharePoint: upload several, same name replaces, view / switch, download, delete after save',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      const mid = await page.evaluate(() => TIM.actions.createMaterial({ vendor: 'Vendor-A', model: 'GF-750', k: 7.5 }));
      await page.evaluate(id => TIM.ui.go('library/' + id), mid);
      await page.waitForSelector('.drawer .ds-field');
      assert.match(await page.locator('.ds-field').innerText(), /尚未上傳規格書/);
      for (const b of ['view', 'download', 'delete', 'list']) assert.ok(await page.locator('.ds-field [data-ds="' + b + '"]').isDisabled(), b + ' disabled without files');
      assert.equal(await page.locator('.drawer .field:has-text("Datasheet 連結")').count(), 0, 'link field replaced');
      // ↑ upload two files at once
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
      let [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ds-field [data-ds="upload"]')]);
      assert.ok(fc.isMultiple(), 'several files at once');
      await fc.setFiles([{ name: 'GF-750_TDS.pdf', mimeType: 'application/pdf', buffer: pdf }, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('rev A') }]);
      await page.waitForSelector('.ds-field [data-ds="view"] .ds-n:text-is("2")');
      assert.ok(g.files.has('TIM_Manager/Datasheets/Vendor-A/GF-750/GF-750_TDS.pdf'));
      assert.equal(g.text('TIM_Manager/Datasheets/Vendor-A/GF-750/notes.txt'), 'rev A');
      await saved(page);
      let mat = g.json(DB).materials[mid];
      assert.deepEqual(mat.datasheets.map(d => d.name), ['notes.txt', 'GF-750_TDS.pdf'], 'newest first, saved in the database');
      assert.equal(mat.datasheets[0].by, 'Tester A');
      // same name again → replaces that file (still two)
      [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('.ds-field [data-ds="upload"]')]);
      // (a different size than 'rev A', so the wait below cannot pass before this upload is done)
      await fc.setFiles([{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('rev B, updated') }]);
      await page.waitForFunction(id => TIM.store.db.materials[id].datasheets[0].size === 14, mid);
      assert.equal(await page.evaluate(id => TIM.store.db.materials[id].datasheets.length, mid), 2, 'replaced, not added');
      assert.match(await page.locator('.ds-meta').innerText(), /notes\.txt/);
      assert.equal(g.text('TIM_Manager/Datasheets/Vendor-A/GF-750/notes.txt'), 'rev B, updated');
      // 👁 view: text inline, switch to the PDF
      await page.click('.ds-field [data-ds="view"]');
      await page.waitForSelector('.modal.viewer pre.ds-text:has-text("rev B")');
      assert.deepEqual(await page.locator('.modal.viewer .ds-tab').allInnerTexts(), ['notes.txt', 'GF-750_TDS.pdf']);
      await page.click('.modal.viewer .ds-tab:has-text("GF-750_TDS.pdf")');
      await page.waitForSelector('.modal.viewer iframe.ds-frame');
      assert.match(await page.locator('.modal.viewer iframe.ds-frame').getAttribute('src'), /^blob:/);
      assert.ok(await page.locator('.modal.viewer a:has-text("SharePoint ↗")').isVisible(), 'open in SharePoint / Office Online');
      await page.keyboard.press('Escape');
      // the material list has the 👁 column
      assert.equal(await page.locator('.tbl tbody tr:has-text("GF-750") [data-ds="view"] .ds-n').innerText(), '2');
      // 🕘 list → download one, delete the other
      await page.click('.ds-field [data-ds="list"]');
      await page.waitForSelector('.modal:has-text("規格書清單")');
      assert.match(await page.locator('.modal .left').innerText(), /TIM_Manager \/ Datasheets \/ Vendor-A \/ GF-750/);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.ds-list tr:has-text("GF-750_TDS.pdf") button[title="下載"]')]);
      assert.equal(dl.suggestedFilename(), 'GF-750_TDS.pdf');
      await page.click('.ds-list tr:has-text("notes.txt") button[title="刪除"]');
      await page.waitForSelector('.modal:has-text("刪除規格書")');
      assert.match(await page.locator('.modal:has-text("刪除規格書") .modal-body').innerText(), /資源回收筒/);
      await page.click('.modal-foot button:has-text("刪除")');
      await page.waitForFunction(() => document.querySelectorAll('.ds-list tbody tr').length === 1);
      await saved(page);
      for (let i = 0; i < 50 && g.files.has('TIM_Manager/Datasheets/Vendor-A/GF-750/notes.txt'); i++) await page.waitForTimeout(50);
      assert.ok(!g.files.has('TIM_Manager/Datasheets/Vendor-A/GF-750/notes.txt'), 'file deleted once the change was saved');
      assert.ok(g.files.has('TIM_Manager/Datasheets/Vendor-A/GF-750/GF-750_TDS.pdf'));
      mat = g.json(DB).materials[mid];
      assert.deepEqual(mat.datasheets.map(d => d.name), ['GF-750_TDS.pdf']);
      await page.keyboard.press('Escape');
      // one file left: ↓ downloads it directly
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.ds-field [data-ds="download"]')]);
      assert.equal(dl2.suggestedFilename(), 'GF-750_TDS.pdf');
      allowHttp(env, [404]);
    },
  },
  {
    name: 'TH / ME owners: dropdown of the active TH/ME people in Project_Members (one entry per person), manual entry, signed-in user preselected',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      const row = (Title, MemberName, MemberEmail, Function, IsActive) => ({ Title, MemberName, MemberEmail, Function, IsActive });
      g.members = [
        row('DEMO-RRU-A', 'Tester.a', 'Tester.A@example.test', 'TH/ME', true),
        row('DEMO-RRU-A', 'ME.Lin', 'me.lin@example.test', 'TH/ME', true),
        row('DEMO-RRU-B', 'ME.Lin', 'me.lin@example.test', 'TH/ME', true),
        row('DEMO-RRU-A', 'RF.Wu', 'rf.wu@example.test', 'RF', true),
        row('DEMO-RRU-A', 'EE.Chang', 'ee.chang@example.test', 'EE', true),
        row('DEMO-RRU-A', 'Left.Team', 'left@example.test', 'TH/ME', false),
      ];
      await setup(env, g);
      await openSp(page, base);
      await page.waitForSelector('.modal:has-text("建立 SharePoint 資料庫")');
      await page.keyboard.press('Enter');
      await page.waitForSelector('.empty:has-text("還沒有任何專案")');
      await page.click('button:has-text("新增專案")');
      const th = '.modal .field:has(label:text-is("熱流負責人")) select';
      const me = '.modal .field:has(label:text-is("機構負責人")) select';
      await page.waitForSelector(me);
      assert.deepEqual(await page.locator(me + ' option').allInnerTexts(), ['—', 'ME.Lin', 'Tester.a', '手動輸入…'], 'TH/ME only, active only, once per person');
      for (let i = 0; i < 100 && (await page.inputValue(th)) !== 'Tester.a'; i++) await page.waitForTimeout(50);
      assert.equal(await page.inputValue(th), 'Tester.a', 'signed-in user (matched by e-mail) preselected');
      await page.selectOption(me, 'ME.Lin');
      await page.fill('.modal .field:has(label:text-is("案名 *")) input', 'Owners');
      await page.click('.modal-foot button:has-text("建立專案")');
      await page.waitForSelector('.crumb:has-text("Owners")');
      const p = await page.evaluate(() => Object.values(TIM.store.db.projects)[0]);
      assert.equal(p.owner, 'Tester.a');
      assert.equal(p.me_owner, 'ME.Lin');
      // overview: someone not on the list → 手動輸入…
      await page.click('.tab:has-text("總覽")');
      const ov = '.field:has(label:text-is("機構負責人"))';
      await page.selectOption(ov + ' select', '__manual__');
      await page.waitForFunction(() => document.activeElement && document.activeElement.matches('.person-field input'));
      await page.keyboard.type('Outside.ME');
      await page.keyboard.press('Tab');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].me_owner === 'Outside.ME');
      await page.click(ov + ' button:has-text("名單")');
      assert.equal(await page.inputValue(ov + ' select'), 'Outside.ME');
      assert.match(await page.locator(ov + ' select option:checked').innerText(), /不在名單/);
      allowHttp(env, [404]);
    },
  },
  {
    name: 'local database → 搬到 SharePoint: uploads the database and continues there; never overwrites an existing one',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      await setup(env, g);
      await page.goto(base);
      await page.waitForSelector('.gate');
      assert.equal(await attachFakeFile(page, ''), true);
      await addDemo(page);
      await page.waitForSelector('.proj-table');
      await page.evaluate(() => TIM.store.flush());
      // SharePoint already has a database → refused, still local
      g.put(DB, Buffer.from(JSON.stringify({ schema: 'tim-db', schema_version: 1, rev: 9, settings: {}, materials: {}, projects: {}, images: {} })));
      await page.click('.toolbar button[title="設定"]');
      await page.click('.modal button:has-text("搬到 SharePoint")');
      await page.waitForSelector('.modal:has-text("上傳並改用 SharePoint")');
      await page.click('.modal-foot button:has-text("上傳並改用 SharePoint")');
      await page.waitForSelector('.toast:has-text("SharePoint 上已經有資料庫")');
      assert.equal(g.json(DB).rev, 9, 'existing SharePoint database untouched');
      assert.equal(await page.evaluate(() => TIM.store.backend.kind), 'file');
      // empty SharePoint → moved
      g.files.delete(DB);
      await page.click('.modal button:has-text("搬到 SharePoint")');
      await page.click('.modal-foot button:has-text("上傳並改用 SharePoint")');
      await page.waitForSelector('.toast:has-text("已搬到 SharePoint")');
      assert.equal(await page.evaluate(() => TIM.store.backend.kind), 'sharepoint');
      const local = JSON.parse(await page.evaluate(() => window.__fakeFile.text));
      assert.deepEqual(Object.keys(g.json(DB).projects).sort(), Object.keys(local.projects).sort());
      await page.evaluate(() => TIM.actions.createProject({ name: 'After move' }));
      await saved(page);
      assert.ok(Object.values(g.json(DB).projects).some(p => p.name === 'After move'), 'later edits go to SharePoint');
      assert.ok(!/After move/.test(await page.evaluate(() => window.__fakeFile.text)), 'local file left as it was');
      allowHttp(env, [404]);
    },
  },
  {
    name: 'sign-in redirect page is blank (and the tool itself stays idle in an MSAL popup); the real MSAL.js loads with its SRI hash',
    async run(env) {
      const { page, base, context } = env;
      await page.goto(base);
      await page.waitForSelector('.gate');
      const res = await page.request.get(base + 'auth.html');
      assert.equal(res.status(), 200);
      assert.doesNotMatch(await res.text(), /<script/i, 'no scripts on the redirect page');
      // an older registration pointing at the tool itself: it must not start inside the popup
      const [popup] = await Promise.all([context.waitForEvent('page'), page.evaluate(b => { window.open(b + '#code=abc&state=xyz', 'msal.test-popup'); }, base)]);
      await popup.waitForSelector('.msal-popup');
      assert.equal(await popup.locator('.gate').count(), 0);
      assert.equal(new URL(popup.url()).hash, '#code=abc&state=xyz', 'address bar left for MSAL to read');
      await popup.close();
      const t = await page.evaluate(() => TIM.loader.load('msal').then(m => typeof m.PublicClientApplication));
      assert.equal(t, 'function');
    },
  },
];
