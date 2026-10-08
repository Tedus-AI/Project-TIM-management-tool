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
    name: 'SharePoint mode: the local copy goes to tim_db.json in the folder of the local database last opened (even one opened from a backup file), with Backup/ and Datasheets/ like SharePoint; permission asked once; can be turned off',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      const sheet = Buffer.from('%PDF-1.4 demo datasheet');
      g.put(DB, Buffer.from(JSON.stringify(seed({ materials: {
        mat_1: { id: 'mat_1', rev: 1, vendor: 'Vendor-A', model: 'GF-750', tim_type: 'pad', datasheets: [{ id: 'ds_1', name: 'spec.pdf', path: 'mat_1/spec.pdf', size: sheet.length }] },
        mat_2: { id: 'mat_2', rev: 1, vendor: 'Vendor-B', model: 'GF-300', tim_type: 'pad', datasheets: [{ id: 'ds_2', name: 'gone.pdf', path: 'mat_2/gone.pdf', size: 1 }] },
      } }))));
      g.put('TIM_Manager/Datasheets/mat_1/spec.pdf', sheet);
      await setup(env, g);
      // real folder handles (origin private file system): they can be remembered in IndexedDB like the user's folder;
      // window.__perm stands in for the browser's permission state after a restart
      await env.context.addInitScript(() => {
        window.__TIM_TEST_SYNC_OFF = false;        // this scenario reloads: sync on from the start of every load
        const P = FileSystemHandle.prototype;
        P.queryPermission = async function () { return window.__perm || 'granted'; };
        P.requestPermission = async function () { window.__asked = (window.__asked || 0) + 1; window.__perm = 'granted'; return 'granted'; };
        window.__opfs = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('TIM-local', { create: true });
        window.__readLocal = async path => {
          try { let d = await window.__opfs(); const parts = path.split('/'); const n = parts.pop(); for (const s of parts) d = await d.getDirectoryHandle(s);
            return await (await (await d.getFileHandle(n)).getFile()).text(); } catch (e) { return null; }
        };
        window.__localNames = async sub => {
          const out = []; let d = await window.__opfs();
          if (sub) { try { d = await d.getDirectoryHandle(sub); } catch (e) { return []; } }
          for await (const [n] of d.entries()) out.push(n); return out.sort();
        };
      });
      await page.goto(base);
      await page.waitForSelector('.gate');
      await page.evaluate(SIGNED_IN);
      // as on the user's PC: the folder once held only a daily backup, which was opened as the local database
      const old = JSON.stringify(seed({ rev: 2, updated_at: '2026-09-01T00:00:00.000Z' }));
      await page.evaluate(async old => {
        const dir = await window.__opfs();
        const fh = await dir.getFileHandle('tim_db_backup_2026-10-01.json', { create: true });
        const w = await fh.createWritable(); await w.write(old); await w.close();
        TIM.fileBackend.useFolderFile(dir, fh);
        await TIM.fileBackend.remember();
        window.__perm = 'prompt';                  // browser restarted: permission not granted yet
      }, old);
      await page.click('button:has-text("SharePoint 共用資料庫")');
      await page.waitForSelector('.proj-name:has-text("Q")');
      // nothing picked in settings → that folder gets the copy; it asks for permission (banner + toolbar)
      const banner = page.locator('.banner:has-text("需要授權")');
      await banner.waitFor();
      assert.match(await banner.innerText(), /本機資料庫「TIM-local \/ tim_db\.json」需要授權/);
      assert.match(await banner.innerText(), /每次造訪時都允許/);
      assert.match(await page.locator('.toolbar .copy-chip').innerText(), /本機副本：點擊授權/);
      assert.deepEqual(await page.evaluate(() => window.__localNames()), ['tim_db_backup_2026-10-01.json'], 'nothing written before permission');
      await banner.locator('button:has-text("授權")').first().click();
      await page.waitForFunction(() => TIM.sync.mirror.at);
      assert.equal(await page.evaluate(() => window.__asked), 1);
      assert.equal(await page.evaluate(() => window.__readLocal('tim_db.json')), g.text(DB), 'tim_db.json = SharePoint');
      assert.equal(await page.evaluate(() => window.__readLocal('tim_db_backup_2026-10-01.json')), old, 'the old file is left as it was');
      await page.waitForSelector('.toast:has-text("已同步寫入本機資料庫 TIM-local / tim_db.json")');
      // backup next to it, named with date + time, same content
      await until(() => page.evaluate(() => window.__localNames('Backup')).then(n => n.length === 1), 'local backup');
      const [bk] = await page.evaluate(() => window.__localNames('Backup'));
      assert.match(bk, /^tim_db_backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
      assert.equal(await page.evaluate(n => window.__readLocal('Backup/' + n), bk), g.text(DB));
      // datasheets the folder lacks are copied (one missing on SharePoint is skipped)
      await until(() => page.evaluate(() => window.__readLocal('Datasheets/mat_1/spec.pdf')).then(t => t === '%PDF-1.4 demo datasheet'), 'datasheet copied');
      await page.waitForFunction(() => !TIM.sync.mirror.filesBusy);
      assert.equal(await page.evaluate(() => window.__readLocal('Datasheets/mat_2/gone.pdf')), null);
      assert.deepEqual(await page.evaluate(() => window.__localNames()), ['Backup', 'Datasheets', 'tim_db.json', 'tim_db_backup_2026-10-01.json']);
      await page.waitForSelector('.toolbar .copy-chip:has-text("本機副本 ")');
      assert.equal(await page.locator('.banner:has-text("需要授權")').count(), 0);
      assert.match(await page.locator('.toolbar .copy-chip').getAttribute('title'), /TIM-local \/ tim_db\.json（上次開啟的本機資料庫）[\s\S]*已複製 1 份規格書/);
      // every save follows
      await page.evaluate(() => TIM.actions.updateProject('prj_p', 'customer', 'edited on SharePoint'));
      await saved(page);
      await until(() => page.evaluate(() => window.__readLocal('tim_db.json')).then(t => /edited on SharePoint/.test(t)), 'copy after our save');
      // settings show where it goes, and both backup destinations
      await page.click('.toolbar button[title="設定"]');
      const kv = await page.locator('.modal dl.kv').innerText();
      assert.match(kv, /本機副本\s+TIM-local \/ tim_db\.json （上次開啟的本機資料庫） · 最近寫入/);
      assert.match(kv, /Thermal-Spec-DB \/ TIM_Manager \/ Database \/ Backup · 最近：tim_db_backup_\d{4}-\d{2}-\d{2}_\d{4}\.json/);
      assert.match(kv, /TIM-local \/ Backup · 最近：tim_db_backup_\d{4}-\d{2}-\d{2}_\d{4}\.json/);
      await page.keyboard.press('Escape');
      // reload (permission kept; SharePoint opens by itself): no new prompt, no new notice, nothing kept aside
      await page.reload();
      await page.waitForSelector('.proj-name:has-text("Q")');
      await page.waitForFunction(() => TIM.sync.mirror.state === 'ready');
      assert.equal(await page.evaluate(() => TIM.sync.mirror.adopted), '');
      await page.evaluate(() => TIM.actions.updateProject('prj_q', 'customer', 'after reload'));
      await saved(page);
      await until(() => page.evaluate(() => window.__readLocal('tim_db.json')).then(t => /after reload/.test(t)), 'copy after reload');
      assert.equal((await page.evaluate(() => window.__localNames())).filter(n => /^tim_db_local_/.test(n)).length, 0, 'nothing kept aside');
      assert.equal((await page.evaluate(() => window.__localNames('Backup'))).length, 1, 'still one backup today');
      // turned off → stays off (also after a reload) until a folder is picked again
      await page.click('.toolbar button[title="設定"]');
      await page.click('.modal button:has-text("停用本機副本")');
      await page.waitForSelector('.modal dl.kv:has-text("已停用")');
      assert.match(await page.locator('.modal dl.kv').innerText(), /本機副本\s+已停用/);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.toolbar .copy-chip').count(), 0);
      await page.evaluate(() => TIM.actions.updateProject('prj_q', 'customer', 'not copied'));
      await saved(page);
      await page.waitForTimeout(300);
      assert.doesNotMatch(await page.evaluate(() => window.__readLocal('tim_db.json')), /not copied/);
      await page.reload();
      await page.waitForSelector('.proj-name:has-text("Q")');
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => TIM.sync.mirror.state), 'none');
      // picking the folder again → tim_db.json there
      await page.evaluate(() => { window.showDirectoryPicker = () => window.__opfs(); });
      await page.click('.toolbar button[title="設定"]');
      await page.click('.modal button:has-text("設定本機副本資料夾")');
      await until(() => page.evaluate(() => window.__readLocal('tim_db.json')).then(t => /not copied/.test(t)), 'copy after picking the folder again');
      await page.keyboard.press('Escape');
      // opening that folder locally again uses tim_db.json, not the backup file it was first opened from
      const r = await page.evaluate(() => TIM.fileBackend.tryRestore());
      assert.deepEqual([r.ok, r.name], [true, 'TIM-local / tim_db.json']);
      assert.equal((await page.evaluate(() => TIM.fileBackend.remembered())).name, 'tim_db.json');
      allowHttp(env, [404]);
    },
  },
  {
    name: 'backups: SharePoint Database/Backup and the local copy\'s Backup keep only today\'s latest and the previous day\'s last (date + time in the name)',
    async run(env) {
      const { page, base } = env;
      const g = fakeDrive();
      g.put(DB, Buffer.from(JSON.stringify(seed())));
      const p2 = n => (n < 10 ? '0' : '') + n;
      const day = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      const today = day(new Date()), yesterday = day(new Date(Date.now() - 86400000));
      const BK = 'TIM_Manager/Database/Backup/';
      const seeded = ['tim_db_backup_2026-09-01.json', 'tim_db_backup_2026-09-02.json', 'tim_db_backup_2026-09-03.json',
        'tim_db_backup_' + yesterday + '_0900.json', 'tim_db_backup_' + yesterday + '_1802.json', 'tim_db_backup_' + today + '_0000.json'];
      seeded.forEach(n => g.put(BK + n, Buffer.from('{"old":"' + n + '"}')));
      g.put(BK + 'readme.txt', Buffer.from('not a backup'));
      await setup(env, g);
      await page.goto(base);
      await page.waitForSelector('.gate');
      await page.evaluate(() => { TIM.sync.__disableForTest = false; });
      await page.evaluate(SIGNED_IN);
      await installFakeFs(page);
      await page.evaluate(([seeded]) => { window.__copy = __fs.dir('TIM-copy'); window.showDirectoryPicker = async () => window.__copy;
        return Promise.all(seeded.map(n => __fs.write(window.__copy, 'Backup/' + n, '{"old":"' + n + '"}'))); }, [seeded]);
      await page.click('button:has-text("SharePoint 共用資料庫")');
      await page.waitForSelector('.proj-name:has-text("Q")');
      // SharePoint: written on open; older ones deleted (other files left alone)
      const spBackups = () => Array.from(g.files.keys()).filter(k => k.startsWith(BK)).map(k => k.slice(BK.length)).sort();
      await until(async () => spBackups().length === 3, 'SharePoint backups pruned');
      const sp = spBackups();
      assert.equal(sp[0], 'readme.txt');
      assert.equal(sp[1], 'tim_db_backup_' + yesterday + '_1802.json', "the previous day's last one stays");
      assert.match(sp[2], new RegExp('^tim_db_backup_' + today + '_\\d{4}\\.json$'), "today's latest");
      assert.equal(g.text(BK + sp[2]), g.text(DB), 'the backup = the database');
      // the local copy folder: its Backup follows the same rule as soon as the copy is set up
      await page.click('.toolbar button[title="設定"]');
      await page.click('.modal button:has-text("設定本機副本資料夾")');
      await page.waitForFunction(() => TIM.sync.mirror.at);
      const localBackups = () => page.evaluate(() => __fs.names(window.__copy.children.get('Backup')));
      await until(async () => (await localBackups()).length === 2, 'local backups pruned');
      const lb = await localBackups();
      assert.equal(lb[0], 'tim_db_backup_' + yesterday + '_1802.json');
      assert.equal(lb[1], sp[2], 'same name as on SharePoint');
      assert.equal(await page.evaluate(n => __fs.read(window.__copy, 'Backup/' + n), lb[1]), g.text(DB));
      assert.equal(await page.evaluate(() => __fs.read(window.__copy, 'tim_db.json')), g.text(DB));
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
      // backups of a local folder database go to its Backup folder, named with date + time
      await until(() => page.evaluate(() => !!window.__local.children.get('Backup')), 'local backup');
      const lb = await page.evaluate(() => __fs.names(window.__local.children.get('Backup')));
      assert.equal(lb.length, 1);
      assert.match(lb[0], /^tim_db_backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
      assert.equal(await page.locator('.toolbar .copy-chip').count(), 0, 'no local-copy chip in local folder mode');
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
