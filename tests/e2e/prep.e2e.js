'use strict';
// 聯絡人 (shared factories / suppliers) and the 備料 tab: items from the TIM list, sets, need date, one Outlook
// draft (.eml with HTML table + Excel) per organisation, lock after generating, duplicate.
const assert = require('node:assert/strict');
const fs = require('fs');
const { openWithDemo } = require('./helpers');

const demoId = page => page.evaluate(() => Object.keys(TIM.store.db.projects)[0]);
const prepOf = page => page.evaluate(() => JSON.parse(JSON.stringify(Object.values(TIM.store.db.projects)[0].preps)));

/** Parse an .eml (MIME) written by the tool: headers, decoded text / html parts and attachments. */
function parseEml(text) {
  const [head, ...rest] = text.split('\r\n\r\n');
  // RFC 2047: white space between two encoded words is dropped, elsewhere it is kept
  const words = h => h.replace(/\r\n /g, ' ').replace(/(\?=)\s+(?==\?UTF-8\?B\?)/g, '$1')
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (m, b) => Buffer.from(b, 'base64').toString('utf8'));
  const field = name => { const m = head.match(new RegExp('^' + name + ': ((?:.*)(?:\\r\\n .*)*)', 'm')); return m ? words(m[1]) : ''; };
  const body = rest.join('\r\n\r\n');
  const parts = [];
  body.split(/\r\n--[^\r\n]+/).forEach(chunk => {
    const i = chunk.indexOf('\r\n\r\n');
    if (i < 0) return;
    const h = chunk.slice(0, i);
    const type = (h.match(/Content-Type: ([^;\r\n]+)/) || [])[1];
    if (!type || /^multipart/.test(type) || !/base64/.test(h)) return;
    const name = (h.match(/filename="([^"]+)"/) || [])[1];
    parts.push({ type, name: name ? words(name) : '', data: Buffer.from(chunk.slice(i + 4).replace(/\s+/g, ''), 'base64') });
  });
  return { raw: text, head, field, parts };
}

module.exports = [
  {
    name: '聯絡人: factories and suppliers shared by all projects — typed fields, roles, brands from the library, one default factory, undo',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await page.click('a.nav-link:has-text("聯絡人")');
      await page.waitForSelector('h1:text-is("聯絡人")');
      // the first factory becomes the default; type its name and two people
      await page.click('button:has-text("新增工廠")');
      await page.waitForSelector('.drawer .org-edit');
      await page.fill('.drawer .field:has(.field-label:text-is("名稱")) input, .drawer .field:has(label:text-is("名稱")) input', '甲廠 物料課');
      await page.click('.drawer button:has-text("新增聯絡人")');
      const people = page.locator('.drawer .people-tbl tbody tr');
      await people.nth(0).locator('input').nth(0).fill('王小明');
      await people.nth(0).locator('input').nth(2).fill('wang@factory.example');
      await page.click('.drawer button:has-text("新增聯絡人")');
      await people.nth(1).locator('input').nth(0).fill('林佳慧');
      await people.nth(1).locator('input').nth(2).fill('not-an-email');
      assert.equal(await people.nth(1).locator('input.invalid').count(), 1, 'a wrong e-mail is flagged');
      await people.nth(1).locator('input').nth(2).fill('lin@factory.example');
      assert.equal(await people.nth(1).locator('.seg button.on').innerText(), '副本', 'the second person defaults to 副本');
      let orgs = await page.evaluate(() => Object.values(TIM.store.db.contacts));
      assert.equal(orgs.length, 1);
      assert.deepEqual([orgs[0].kind, orgs[0].name, orgs[0].is_default], ['factory', '甲廠 物料課', true]);
      assert.deepEqual(orgs[0].people.map(p => [p.name, p.email, p.role]), [['王小明', 'wang@factory.example', 'to'], ['林佳慧', 'lin@factory.example', 'cc']]);
      await page.click('.drawer button[title^="關閉"]');
      // a second factory made default → the first one is not the default any more
      await page.click('button:has-text("新增工廠")');
      await page.waitForSelector('.drawer .org-edit');
      await page.fill('.drawer .org-edit input.inp >> nth=0', '丁廠');
      await page.check('.drawer .check input');
      orgs = await page.evaluate(() => Object.values(TIM.store.db.contacts));
      assert.deepEqual(orgs.filter(o => o.is_default).map(o => o.name), ['丁廠'], 'one default factory');
      await page.click('.drawer button[title^="關閉"]');
      // supplier: brand picked from the names in the material library / TIM lists
      await page.click('button:has-text("新增供應商")');
      await page.waitForSelector('.drawer .brand-add');
      await page.fill('.drawer .org-edit input.inp >> nth=0', '乙公司');
      const opts = await page.locator('.drawer .brand-add option').allInnerTexts();
      assert.ok(opts.includes('Vendor-B') && opts.includes('Vendor-C'), 'brands of the library offered: ' + opts.join(','));
      await page.selectOption('.drawer .brand-add', 'Vendor-B');
      await page.waitForSelector('.drawer .brand-chip:has-text("Vendor-B")');
      assert.ok(!(await page.locator('.drawer .brand-add option').allInnerTexts()).includes('Vendor-B'), 'an added brand leaves the list');
      await page.click('.drawer button[title^="關閉"]');
      assert.match(await page.locator('.section:has-text("供應商") .tbl').innerText(), /乙公司\s+Vendor-B/);
      assert.match(await page.locator('.section:has-text("供應商") .tbl').innerText(), /沒有 Email/);
      // undo (Ctrl+Z on the page) removes the brand; redo brings it back
      await page.keyboard.press('Control+z');
      await page.waitForFunction(() => Object.values(TIM.store.db.contacts).find(o => o.name === '乙公司').brands.length === 0);
      await page.keyboard.press('Control+Shift+z');
      await page.waitForFunction(() => Object.values(TIM.store.db.contacts).find(o => o.name === '乙公司').brands[0] === 'Vendor-B');
      // saved with the database (shared by every project)
      await page.evaluate(() => TIM.store.flush());
      const saved = await page.evaluate(() => JSON.parse(window.__fakeFile.text));
      assert.equal(Object.keys(saved.contacts).length, 3);
    },
  },
  {
    name: '備料: items from the TIM list, sources, sets, need date → one Outlook draft per organisation (.eml: table + Excel), lock, re-edit, duplicate',
    async run(env) {
      const { page } = env;
      await openWithDemo(env, 'tester');
      await page.evaluate(() => {
        const A = TIM.actions;
        const f = A.createContact({ kind: 'factory', name: '甲廠', is_default: true });
        A.addContactPerson(f, { name: '王小明', email: 'wang@factory.example', role: 'to' });
        A.addContactPerson(f, { name: '林佳慧', email: 'lin@factory.example', role: 'cc' });
        const s = A.createContact({ kind: 'supplier', name: '乙公司', brands: ['vendor-b'] });
        A.addContactPerson(s, { name: '李大華', email: 'li@vendor-b.example', role: 'to' });
        A.createContact({ kind: 'supplier', name: '丙材料' });
      });
      const pid = await demoId(page);
      await page.evaluate(id => { location.hash = '#/p/' + id; }, pid);
      await page.click('.tab:has-text("備料")');
      await page.waitForSelector('.prep .empty:has-text("還沒有備料單")');
      await page.click('.prep button:has-text("建立第一張備料單")');
      await page.waitForSelector('.prep-grid');
      let prs = await prepOf(page);
      assert.equal(prs.length, 1);
      assert.equal(prs[0].no, 'PR-01');
      assert.equal(prs[0].purpose, 'EVT 組裝', 'the first 用途 preselected');
      // default columns + total; every TIM-list item (all have a Delta P/N → 工廠)
      assert.deepEqual(await page.locator('.prep-grid thead th').allInnerTexts(),
        ['', 'LOC', '#', 'ITEM', 'USED ON', 'VENDOR', 'Model', 'k (W/m·K)', 'SIZE', "Q'ty / 套", 'Delta PN', '總數量', '來源']);
      const rows = page.locator('.prep-grid tbody tr');
      assert.equal(await rows.count(), 9);
      assert.match(await page.locator('.card-head:has-text("品項")').innerText(), /帶入 9 項 · 已選 9 項/);
      const row = n => page.locator('.prep-grid tbody tr', { has: page.locator('td:text-is("' + n + '")') });
      assert.equal(await row('A4').locator('.src-toggle button.on').innerText(), '工廠');
      // A5 (Vendor-B) → supplier; A4 (Vendor-C) → supplier with no contact yet; A3 not prepared
      await row('A5').locator('.src-toggle button.s').click();
      await row('A4').locator('.src-toggle button.s').click();
      await row('A3').locator('input[type=checkbox]').uncheck();
      await page.waitForFunction(() => document.querySelector('.card-head').innerText.includes('已選 8 項'));
      assert.equal(await row('A3').locator('td.tot').innerText(), '', 'unticked: no total');
      // sets: chip + stepper; totals follow (A1-1: 4 / set)
      await page.click('.chip:has-text("5 套")');
      await page.click('.stepper button:has-text("＋")');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].preps[0].sets === 6);
      assert.equal(await row('A1-1').locator('td.tot').innerText(), '24');
      // need date: 指定日期
      await page.click('.seg button:has-text("指定日期")');
      assert.match(await page.locator('.computed').innerText(), /請選日期/);
      await page.fill('.need-date', '2030-01-15');
      await page.waitForFunction(() => /2030\/01\/15（二） 前/.test(document.querySelector('.computed').innerText));
      // groups: factory, supplier 乙公司 (brand matched case-insensitively), Vendor-C without a contact
      const grps = page.locator('.grp');
      assert.equal(await grps.count(), 3);
      assert.match(await grps.nth(0).innerText(), /工廠[\s\S]*甲廠[\s\S]*6 項/);
      assert.match(await grps.nth(1).innerText(), /供應商[\s\S]*乙公司[\s\S]*1 項：A5/);
      assert.match(await grps.nth(2).innerText(), /Vendor-C 還沒有供應商聯絡人/);
      assert.match(await page.locator('.card-head:has-text("對象與郵件") .btn-primary').innerText(), /產生 2 封 Outlook 郵件/);
      // Vendor-C → added to an existing supplier's brands (all projects); now 3 emails
      await grps.nth(2).locator('select').selectOption({ label: '丙材料' });
      await page.waitForFunction(() => Object.values(TIM.store.db.contacts).find(o => o.name === '丙材料').brands.includes('Vendor-C'));
      await page.waitForSelector('.grp:has-text("丙材料") .grp-note:has-text("沒有收件者")');
      // a recipient click cycles 收件者 → 副本 → 不寄; 林佳慧 (副本) → 不寄 → 收件者
      const lin = grps.nth(0).locator('.person:has-text("林佳慧")');
      assert.match(await lin.innerText(), /副本/);
      await lin.click();
      await page.waitForFunction(() => /不寄/.test(document.querySelector('.grp .person:nth-child(2)').innerText));
      await lin.click();
      await page.waitForFunction(() => /收件者/.test(document.querySelector('.grp .person:nth-child(2)').innerText));
      // preview: table and wording
      await grps.nth(0).locator('button:has-text("預覽")').click();
      await page.waitForSelector('.modal .mail-frame');
      const head = await page.locator('.modal .mail-head').innerText();
      assert.match(head, /王小明 <wang@factory\.example>; 林佳慧 <lin@factory\.example>/);
      assert.match(head, /【TIM 備料】.* DVT｜6 套｜需求：1\/15 前/);
      const frame = await page.locator('.modal .mail-frame').getAttribute('srcdoc');
      assert.match(frame, /麻煩協助備料/);
      assert.match(frame, /<td[^>]*>A1-1<\/td>/);
      assert.ok(!/A3<\/td>/.test(frame), 'unticked items are not in the email');
      await page.keyboard.press('Escape');
      await page.waitForSelector('.modal', { state: 'detached' });
      // generate: 2 drafts (丙材料 has no recipient yet)
      const downloads = [];
      page.on('download', d => downloads.push(d));
      await page.click('.card-head:has-text("對象與郵件") button:has-text("產生 2 封 Outlook 郵件")');
      await page.waitForSelector('.prep-lock');
      for (let i = 0; i < 60 && downloads.length < 2; i++) await page.waitForTimeout(100);
      assert.equal(downloads.length, 2);
      const files = await Promise.all(downloads.map(async d => ({ name: d.suggestedFilename(), text: fs.readFileSync(await d.path(), 'utf8') })));
      assert.ok(files.every(f => /\.eml$/.test(f.name)), files.map(f => f.name).join(','));
      const fac = parseEml(files.find(f => /甲廠/.test(f.name)).text);
      assert.match(fac.head, /^X-Unsent: 1\r\n/, 'opens as a new message in Outlook');
      assert.match(fac.field('To'), /王小明 <wang@factory\.example>, 林佳慧 <lin@factory\.example>/);
      assert.equal(fac.field('Cc'), '');
      assert.match(fac.field('Subject'), /^【TIM 備料】.*｜6 套｜需求：1\/15 前$/);
      const html = fac.parts.find(x => x.type === 'text/html').data.toString('utf8');
      assert.match(html, /王小明、林佳慧 您好/);
      assert.match(html, /<th[^>]*>總數量<\/th>/);
      const xlsx = fac.parts.find(x => x.name);
      assert.match(xlsx.name, /_DVT_TIM備料_\d{8}_甲廠\.xlsx$/);
      assert.equal(xlsx.type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      assert.equal(xlsx.data.slice(0, 2).toString(), 'PK', 'a real xlsx (zip)');
      // the Excel content, read back with ExcelJS in the page
      const sheet = await page.evaluate(async b64 => {
        const ExcelJS = await TIM.loader.load('exceljs');
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
        const ws = wb.worksheets[0];
        const rows = [];
        ws.eachRow(r => rows.push(r.values.slice(1).map(v => (v && v.richText ? v.richText.map(t => t.text).join('') : v))));
        return { name: ws.name, rows };
      }, xlsx.data.toString('base64'));
      assert.equal(sheet.name, '備料清單');
      assert.equal(sheet.rows[0][0], 'TIM 備料清單 · PR-01');
      assert.ok(sheet.rows.some(r => r[0] === '需求日期' && /2030\/01\/15/.test(r[2])));
      const hdr = sheet.rows.findIndex(r => r[0] === 'LOC');
      assert.deepEqual(sheet.rows[hdr].slice(-2), ['Delta PN', '總數量']);
      assert.deepEqual(sheet.rows[hdr + 1].slice(0, 3).concat(sheet.rows[hdr + 1].slice(-1)), ['Bottom Case', 1, 'A1-1', 24]);
      const sup = parseEml(files.find(f => /乙公司/.test(f.name)).text);
      assert.match(sup.parts.find(x => x.type === 'text/plain').data.toString('utf8'), /麻煩協助提供/);
      // saved: mailed + frozen content, change log entry; inputs locked, the remaining email can still be made
      prs = await prepOf(page);
      assert.equal(prs[0].status, 'mailed');
      assert.deepEqual(prs[0].mailed.map(m => m.org).sort(), ['乙公司', '甲廠']);
      assert.equal(prs[0].mailed.find(m => m.org === '甲廠').rows.length, 6);
      assert.equal(await page.locator('.prep-grid input[type=checkbox]:not([disabled])').count(), 0, 'locked');
      assert.equal(await page.locator('.chip:has-text("10 套")').isDisabled(), true);
      assert.match(await page.locator('.prep-rec.on').innerText(), /已產生郵件/);
      assert.equal(await page.locator('.grp:has-text("甲廠") button:has-text("下載郵件")').count(), 1, 'a made email is re-downloaded as it was');
      const log = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].changelog.slice(-1)[0].text);
      assert.match(log, /備料單 PR-01 產生郵件：/);
      // the sent list re-downloads the frozen email
      const again = page.waitForEvent('download');
      await page.locator('.prep-card:has-text("已產生的郵件") tr:has-text("甲廠") button:has-text("下載郵件")').click();
      const re = parseEml(fs.readFileSync(await (await again).path(), 'utf8'));
      assert.equal(re.field('Subject'), fac.field('Subject'));
      // 重新編輯 → draft again
      await page.click('.prep-lock button:has-text("重新編輯")');
      await page.waitForSelector('.prep-lock', { state: 'detached' });
      assert.equal(await page.locator('.chip:has-text("10 套")').isDisabled(), false);
      // duplicate → PR-02 with the same choices, draft, no emails
      await page.click('.prep-title button:has-text("複製成新備料單")');
      await page.waitForSelector('.prep-title h2:text-is("PR-02")');
      prs = await prepOf(page);
      const pr2 = prs.find(x => x.no === 'PR-02');
      assert.deepEqual([pr2.status, pr2.sets, pr2.mailed.length, pr2.need.date], ['draft', 6, 0, '2030-01-15']);
      assert.equal(await page.locator('.prep-rec').count(), 2);
      assert.match(await page.locator('.prep-rec').first().innerText(), /PR-02/, 'newest first');
      // columns: add 覆蓋元件 (TIM-list column), the email table follows
      await page.click('.prep-card button:has-text("欄位")');
      await page.locator('.col-pop label:has-text("覆蓋元件") input').check();
      await page.waitForFunction(() => (Object.values(TIM.store.db.projects)[0].preps.find(x => x.no === 'PR-02').cols || []).includes('covered'));
      assert.ok((await page.locator('.prep-grid thead th').allInnerTexts()).includes('覆蓋元件'));
      await page.keyboard.press('Escape');
      // project undo restores the deleted 備料單
      await page.click('.prep-title button[title="刪除備料單"]');
      await page.click('.modal-foot button:has-text("刪除")');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].preps.length === 1);
      await page.click('.proj-head-actions button[title^="復原"]');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].preps.length === 2);
    },
  },
  {
    name: '備料: a brand without a supplier → 新增聯絡人 dialog right in the project; 設定: 用途 choices and the 依流程 wording',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      const pid = await demoId(page);
      await page.evaluate(id => {
        TIM.actions.createPrep(id, {});
        const p = TIM.store.db.projects[id];
        TIM.actions.setPrepLine(id, p.preps[0].id, p.items.map(i => i.id), { src: 'supplier' });
        location.hash = '#/p/' + id + '/prep';
      }, pid);
      await page.waitForSelector('.grp');
      assert.deepEqual(await page.locator('.grp .who b').allInnerTexts(), ['還沒有工廠聯絡人', 'Vendor-A 還沒有供應商聯絡人', 'Vendor-B 還沒有供應商聯絡人', 'Vendor-C 還沒有供應商聯絡人'].slice(1));
      await page.click('.grp:has-text("Vendor-B") button:has-text("新增 Vendor-B 聯絡人")');
      await page.waitForSelector('.modal .org-edit');
      assert.equal(await page.inputValue('.modal .org-edit input.inp >> nth=0'), 'Vendor-B', 'named after the brand');
      assert.equal(await page.locator('.modal .brand-chip').innerText(), 'Vendor-B');
      await page.click('.modal button:has-text("新增聯絡人")');
      await page.locator('.modal .people-tbl input').nth(0).fill('Amy');
      await page.locator('.modal .people-tbl input').nth(2).fill('amy@vendor-b.example');
      await page.click('.modal-foot button:has-text("完成")');
      await page.waitForSelector('.modal', { state: 'detached' });
      await page.waitForSelector('.grp:has-text("Vendor-B") .person:has-text("Amy")');
      assert.match(await page.locator('.card-head:has-text("對象與郵件") .btn-primary').innerText(), /產生 1 封 Outlook 郵件/);
      // 設定 → 備料: add a 用途, change the 依流程 wording; the tab offers / writes them
      await page.click('.toolbar button[title="設定"]');
      await page.waitForSelector('.modal:has-text("備料")');
      await page.click('.modal .field:has(label:has-text("用途")) button:has-text("新增")');
      await page.fill('.modal:has-text("新增用途") input', '客戶樣品');
      await page.press('.modal:has-text("新增用途") input', 'Enter');
      await page.waitForFunction(() => TIM.store.db.settings.prep_purposes.includes('客戶樣品'));
      await page.fill('.modal .field:has(label:has-text("依流程")) input', '依工廠排程');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => TIM.store.db.settings.prep_proc === '依工廠排程');
      await page.click('.modal-foot button:has-text("完成")');
      await page.click('.chip:has-text("客戶樣品")');
      await page.click('.seg button:has-text("依流程")');
      await page.waitForFunction(() => /郵件寫：依工廠排程/.test(document.querySelector('.computed').innerText));
      const pr = (await prepOf(page))[0];
      assert.deepEqual([pr.purpose, pr.need.mode], ['客戶樣品', 'proc']);
    },
  },
];
