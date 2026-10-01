'use strict';
// SharePoint database + datasheets against an in-memory Microsoft Graph (routed in Node) and a
// stand-in for MSAL.js (window.msal defined before the page loads, so the CDN copy is not used).
const assert = require('node:assert/strict');
const { attachFakeFile, addDemo } = require('./helpers');

const DB = 'TIM_Manager/Database/tim_db.json';
const SITE = 'site-1';

/** In-memory document library: path → { id, content: Buffer, etag, modified }. */
function fakeDrive() {
  const g = { files: new Map(), seq: 0, n: 0, log: [], tokens: new Set(), beforePut: null };
  g.put = (path, buf) => {
    let f = g.files.get(path);
    if (!f) { f = { id: 'item-' + (++g.seq), path }; g.files.set(path, f); }
    f.content = buf; f.etag = '"{' + f.id + '},' + (++g.n) + '"'; f.modified = new Date().toISOString();
    return f;
  };
  g.byId = id => Array.from(g.files.values()).find(f => f.id === id) || null;
  g.text = path => (g.files.get(path) ? g.files.get(path).content.toString('utf8') : null);
  g.json = path => JSON.parse(g.text(path));
  return g;
}

async function routeGraph(context, g) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS', 'Access-Control-Expose-Headers': '*' };
  const json = (route, status, obj) => route.fulfill({ status, headers: Object.assign({ 'Content-Type': 'application/json' }, cors), body: JSON.stringify(obj) });
  const meta = f => ({ id: f.id, name: f.path.split('/').pop(), eTag: f.etag, size: f.content.length, lastModifiedDateTime: f.modified, webUrl: 'https://sharepoint.test/' + encodeURI(f.path), file: {} });
  const notFound = route => json(route, 404, { error: { code: 'itemNotFound', message: 'The resource could not be found.' } });
  await context.route(/^https:\/\/graph\.microsoft\.com\//, async route => {
    const req = route.request();
    const method = req.method();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const u = new URL(req.url());
    const p = decodeURIComponent(u.pathname).replace(/^\/v1\.0/, '');
    const auth = req.headers()['authorization'] || '';
    g.log.push({ method, p, ifMatch: req.headers()['if-match'] || null, auth, query: u.search });
    if (!/^Bearer tok-/.test(auth)) return json(route, 401, { error: { code: 'InvalidAuthenticationToken', message: 'no token' } });
    g.tokens.add(auth);
    if (p === '/sites/deltao365.sharepoint.com:/sites/Thermal-Spec-DB') return json(route, 200, { id: SITE });
    let m = /^\/sites\/site-1\/drive\/root:\/(.+?)(?::\/(content|children))?$/.exec(p);
    if (m) {
      const path = m[1], what = m[2] || 'meta';
      if (what === 'children') {
        const names = Array.from(g.files.keys()).filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/')).map(k => ({ name: k.slice(path.length + 1) }));
        return names.length ? json(route, 200, { value: names }) : notFound(route);
      }
      const f = g.files.get(path);
      if (method === 'GET') {
        if (!f) return notFound(route);
        return what === 'content' ? route.fulfill({ status: 200, headers: cors, body: f.content }) : json(route, 200, meta(f));
      }
      if (method === 'PUT') {
        if (f && /conflictBehavior=fail/.test(u.search)) return json(route, 409, { error: { code: 'nameAlreadyExists', message: 'exists' } });
        return json(route, f ? 200 : 201, meta(g.put(path, req.postDataBuffer() || Buffer.alloc(0))));
      }
      if (method === 'DELETE') { g.files.delete(path); return route.fulfill({ status: 204, headers: cors }); }
    }
    m = /^\/sites\/site-1\/drive\/items\/([^/]+)(\/content)?$/.exec(p);
    if (m) {
      const f = g.byId(m[1]);
      if (!f) return notFound(route);
      if (method === 'GET') return m[2] ? route.fulfill({ status: 200, headers: cors, body: f.content }) : json(route, 200, meta(f));
      if (method === 'PUT') {
        if (g.beforePut) { const h = g.beforePut; g.beforePut = null; h(f); }
        const im = req.headers()['if-match'];
        if (im && im !== f.etag) return json(route, 412, { error: { code: 'resourceModified', message: 'ETag does not match' } });
        return json(route, 200, meta(g.put(f.path, req.postDataBuffer() || Buffer.alloc(0))));
      }
    }
    return json(route, 400, { error: { code: 'badRequest', message: 'unhandled ' + method + ' ' + p } });
  });
}

/** MSAL stand-in: accounts in localStorage (like the real cache); window.__expired makes silent token calls fail. */
function fakeMsal() {
  const key = '__fake_msal_account';
  window.msal = {
    PublicClientApplication: class {
      constructor(cfg) { window.__msalConfig = cfg; }
      async initialize() {}
      async handleRedirectPromise() { return null; }
      getAllAccounts() { const a = localStorage.getItem(key); return a ? [JSON.parse(a)] : []; }
      async loginPopup() {
        window.__logins = (window.__logins || 0) + 1;
        const acc = window.__nextAccount || { name: 'Tester A', username: 'tester.a@example.test' };
        localStorage.setItem(key, JSON.stringify(acc));
        return { account: acc };
      }
      async acquireTokenSilent(req) {
        if (window.__expired) throw Object.assign(new Error('interaction required'), { errorCode: 'interaction_required' });
        return { accessToken: 'tok-' + req.account.username };
      }
      async acquireTokenPopup(req) { window.__expired = false; window.__popups = (window.__popups || 0) + 1; return { accessToken: 'tok-' + req.account.username, account: req.account }; }
    },
  };
}

async function setup(env, g) {
  await env.context.addInitScript(fakeMsal);
  await routeGraph(env.context, g);
}
/**
 * Chrome logs every 4xx response as a console error. 404 (does the database / folder exist?)
 * and 412 (someone saved first) are answers the tool expects; anything else still fails the test.
 */
function allowHttp(env, statuses) {
  const re = new RegExp('Failed to load resource: the server responded with a status of (' + statuses.join('|') + ')');
  const other = env.errors.filter(e => !re.test(e));
  env.errors.length = 0; env.errors.push(...other);
}
const saved = page => page.waitForFunction(() => TIM.store.status.state === 'saved' && !TIM.store.hasUnsaved());
async function openSp(page, base) {
  await page.goto(base);
  await page.waitForSelector('.gate');
  await page.click('button:has-text("SharePoint 共用資料庫")');
}

module.exports = [
  {
    name: 'SharePoint: sign in → create the database → autosave with If-Match → daily backup → silent restore after reload',
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
      // daily backup next to the database
      await page.waitForFunction(() => TIM.backup.lastAt() > 0);
      const backups = Array.from(g.files.keys()).filter(k => k.startsWith('TIM_Manager/Database/Backup/'));
      assert.equal(backups.length, 1);
      assert.match(backups[0], /tim_db_backup_\d{4}-\d{2}-\d{2}\.json$/);
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
      await page.evaluate(() => { window.__expired = true; TIM.actions.createProject({ name: 'Later' }); });
      await page.waitForSelector('.banner:has-text("Microsoft 登入已過期")');
      assert.equal(await page.evaluate(() => window.__popups || 0), 0, 'no popup without a click (it would be blocked)');
      assert.equal(Object.keys(g.json(DB).projects).length, 0);
      await page.click('.banner button:has-text("重新登入 Microsoft")');
      await saved(page);
      assert.equal(Object.values(g.json(DB).projects)[0].name, 'Later');
      assert.equal(await page.locator('.banner:has-text("儲存失敗")').count(), 0);
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
