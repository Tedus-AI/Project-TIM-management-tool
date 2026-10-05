'use strict';
const assert = require('node:assert/strict');
const { openWithDemo } = require('./helpers');

const state = (page, fn, arg) => page.evaluate(fn, arg);
const item = (page, no) => state(page, n => {
  const p = Object.values(TIM.store.db.projects)[0];
  return JSON.parse(JSON.stringify(p.items.find(i => i.item_no === n) || null));
}, no);
async function openBom(page) {
  await page.click('.proj-name');
  await page.click('.tab:has-text("TIM 清單")');
  await page.waitForSelector('table.grid');
}
// Cell coordinates: row index in the visible order, column index in the grid model.
const cell = (page, r, c) => page.locator('[data-cell="' + r + ',' + c + '"]');
const COL = { item_no: 0, used_on: 1, vendor: 2, model: 3, k: 4, size: 5, qty: 6, delta_pn: 7, covered: 8, second: 9, tim_type: 10, status: 11 };

/** Row index (visible order) whose Item cell shows `no`. */
const rowOf = (page, no) => page.evaluate(n => {
  const el = Array.from(document.querySelectorAll('[data-cell$=",0"]')).find(x => x.value === n);
  return el ? parseInt(el.dataset.cell, 10) : -1;
}, no);
const rowMore = async (page, no) => { const r = await rowOf(page, no); await page.click('tr:has([data-cell="' + r + ',0"]) .row-end button[title="更多"]'); };

async function paste(page, r, c, text) {
  await cell(page, r, c).focus();
  await page.evaluate(([r, c, text]) => {
    const el = document.querySelector('[data-cell="' + r + ',' + c + '"]');
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [r, c, text]);
}

module.exports = [
  {
    name: 'inline edit, undo / redo, change log',
    async run({ page }) {
      await openWithDemo(arguments[0], 'Alice');
      await openBom(page);
      const pn = cell(page, 2, COL.delta_pn);            // A2
      await pn.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.type('PN-NEW-9');
      await page.keyboard.press('Enter');
      assert.equal((await item(page, 'A2')).delta_pn, 'PN-NEW-9');
      // Enter moved focus one row down (A3, same column)
      assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '3,' + COL.delta_pn);
      const log = await state(page, () => Object.values(TIM.store.db.projects)[0].changelog.slice(-1)[0]);
      assert.equal(log.item_no, 'A2'); assert.equal(log.field, 'Delta P/N'); assert.equal(log.from, 'DEMO-0003'); assert.equal(log.to, 'PN-NEW-9'); assert.equal(log.user, 'Alice');
      await page.locator('body').click({ position: { x: 5, y: 900 } });
      await page.keyboard.press('Control+Z');
      assert.equal((await item(page, 'A2')).delta_pn, 'DEMO-0003', 'one undo reverts the whole typing burst');
      await page.keyboard.press('Control+Shift+Z');
      assert.equal((await item(page, 'A2')).delta_pn, 'PN-NEW-9');
    },
  },
  {
    name: 'keyboard navigation and Escape revert',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openBom(page);
      await cell(page, 0, COL.item_no).click();
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1,0');
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1,1');
      await page.keyboard.press('ArrowRight');            // whole text selected → move
      assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1,2');
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await page.evaluate(() => document.activeElement.dataset.cell), '1,0');
      await page.keyboard.type('ZZ');
      assert.equal((await item(page, 'ZZ')) !== null, true);
      await page.keyboard.press('Escape');
      assert.equal((await item(page, 'A1-2')).item_no, 'A1-2', 'Esc restores the value at focus time');
    },
  },
  {
    name: 'parsed cells: size, covered components, 2nd source, used on',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openBom(page);
      const typeInto = async (r, c, text) => { await cell(page, r, c).click(); await page.keyboard.press('Control+A'); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
      await typeInto(4, COL.size, '6 x 6 x 3');
      assert.deepEqual((await item(page, 'A4')).size, { l: 6, w: 6, t: 3 });
      await typeInto(4, COL.covered, 'LDO-7172*2, BUCK-8627*4, NEWPART*3');
      const a4 = await item(page, 'A4');
      assert.deepEqual(a4.covered.map(c => [c.part, c.qty]), [['LDO-7172', 2], ['BUCK-8627', 4], ['NEWPART', 3]]);
      assert.equal(a4.covered[0].power_w, 0.5, 'existing component keeps its power');
      await typeInto(0, COL.second, 'Vendor-Q QX-1(short)');
      const a11 = await item(page, 'A1-1');
      assert.deepEqual(a11.sources.map(s => [s.vendor, s.model, s.note, s.status]), [['Vendor-Q', 'QX-1', 'short', 'unknown']]);
      assert.equal(a11.sourcing_note, '', 'old "only source" note cleared');
      await typeInto(0, COL.second, 'Vendor-A only source');
      assert.equal((await item(page, 'A1-1')).sources.length, 0);
      await typeInto(5, COL.used_on, 'digital/pwr');
      assert.deepEqual((await item(page, 'A5')).used_on, ['DIGI', 'PWR']);
      // invalid size is rejected with a warning, value unchanged
      await typeInto(4, COL.size, 'abc');
      assert.deepEqual((await item(page, 'A4')).size, { l: 6, w: 6, t: 3 });
      await page.waitForSelector('.toast.warn');
    },
  },
  {
    name: 'paste rows from Excel (updates + new rows), range copy, clear, fill down',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openBom(page);
      // paste 2 rows starting at A8 (last visible row, r=8) → 1 update + 1 new item in Top Case
      const tsv = 'A8\tPWR/DDR\tVendor-B\tGF-750\t58*22*3\t5\tDEMO-0103\tBRICK-48V, DDR4-16G*4\tVendor-C TP-750\n' +
                  'A9\tRF\tVendor-Z\tNew Pad\t10*10*1.5\t2\tDEMO-0199\tU900*2\tVendor-Z only source\n';
      await paste(page, 8, 0, tsv);
      await page.waitForSelector('.toast.ok');
      assert.equal((await item(page, 'A8')).qty, 5);
      const a9 = await item(page, 'A9');
      assert.ok(a9, 'new item created');
      assert.deepEqual(a9.size, { l: 10, w: 10, t: 1.5 });
      assert.equal(a9.sourcing_note, 'Vendor-Z only source');
      const loc = await state(page, id => Object.values(TIM.store.db.projects)[0].locations.find(l => l.id === id).name, a9.location_id);
      assert.equal(loc, 'Top Case');
      // pasted Vendor-B / GF-750 on a new row links to the library automatically
      const linked = await state(page, () => { const p = Object.values(TIM.store.db.projects)[0]; return p.items.filter(i => i.material_id).length; });
      assert.ok(linked >= 9);
      // a row copied from the tool's own Excel export carries k after Model → detected, the rest stays aligned
      await paste(page, 8, 0, 'A8\tPWR/DDR\tVendor-B\tGF-750\t7.5\t58*22*3.5\t6\tDEMO-0104\tBRICK-48V, DDR4-16G*4\tVendor-C TP-750\n');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].items.find(i => i.item_no === 'A8').qty === 6);
      const a8 = await item(page, 'A8');
      assert.deepEqual([a8.size, a8.qty, a8.delta_pn], [{ l: 58, w: 22, t: 3.5 }, 6, 'DEMO-0104']);
      // … also when its Size is a dispensed amount (the export writes "2 g") — pasted over A9
      await paste(page, 9, 0, 'Z1\tRF\tVendor-X\tGEL-30\t3.5\t2 g\t1\tDEMO-0400\tU950\tVendor-X only source\n');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].items.some(i => i.item_no === 'Z1'));
      const z1 = await item(page, 'Z1');
      assert.deepEqual([z1.dispense.amount, z1.dispense.unit, z1.qty, z1.delta_pn, z1.covered.map(c => c.part)], [2, 'g', 1, 'DEMO-0400', ['U950']]);
      // 「從 Excel 貼上多列」 without a header: the same k column is recognised and skipped
      await page.click('.bom-toolbar button:has-text("從 Excel 貼上多列")');
      await page.waitForSelector('.modal textarea');
      await page.locator('.modal textarea').fill('Top Case\tC1\tRF\tVendor-B\tGF-750\t7.5\t12*12*2\t3\tDEMO-0300\tU901*3\tVendor-B only source\n');
      await page.waitForSelector('.modal .modal-foot:has-text("Model 後面有 k 欄")');
      assert.match(await page.locator('.modal .preview-tbl tbody tr').innerText(), /12\*12\*2\t3\tDEMO-0300/);
      await page.click('.modal-foot button:has-text("新增 1 個 Item")');
      await page.waitForSelector('.modal', { state: 'detached' });
      const c1 = await item(page, 'C1');
      assert.deepEqual([c1.size, c1.qty, c1.delta_pn], [{ l: 12, w: 12, t: 2 }, 3, 'DEMO-0300']);

      // range copy: rows 0-1, cols item..used_on
      await cell(page, 0, 0).click();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowRight');
      const copied = await page.evaluate(() => {
        const dt = new DataTransfer();
        document.activeElement.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
        return dt.getData('text/plain');
      });
      assert.equal(copied, 'A1-1\tRF\nA1-2\tRF');

      // clear a range of delta P/N (rows 0-1)
      await cell(page, 0, COL.delta_pn).click();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Delete');
      assert.equal((await item(page, 'A1-1')).delta_pn, '');
      assert.equal((await item(page, 'A1-2')).delta_pn, '');
      await page.keyboard.press('Control+Z');
      assert.equal((await item(page, 'A1-2')).delta_pn, 'DEMO-0002', 'clear is one undo step');

      // fill down qty rows 2..4 from A2 (3)
      await cell(page, 2, COL.qty).click();
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.press('Control+d');
      assert.equal((await item(page, 'A3')).qty, 3);
      assert.equal((await item(page, 'A4')).qty, 3);
    },
  },
  {
    name: 'row operations: add, duplicate as variant, move location, delete with cascade',
    async run(env) {
      const { page } = env;
      await openWithDemo(env);
      await openBom(page);
      await page.click('.grp-foot button:has-text("新增至 Bottom Case")');
      await page.waitForFunction(() => Object.values(TIM.store.db.projects)[0].items.some(i => i.item_no === 'A9'));
      await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.cell === '6,0');
      // variant of A1-2 via the row menu
      await page.click('tr[data-id] >> nth=1 >> .row-end button[title="更多"]');
      await page.click('.menu button:has-text("複製為尺寸變體")');
      assert.ok(await item(page, 'A1-3'));
      // move A5 to Top Case
      await rowMore(page, 'A5');
      await page.click('.menu button:has-text("Top Case")');
      const a5 = await item(page, 'A5');
      const locName = await state(page, id => Object.values(TIM.store.db.projects)[0].locations.find(l => l.id === id).name, a5.location_id);
      assert.equal(locName, 'Top Case');
      // delete A4 → its 8 pads disappear from the drawings too
      await rowMore(page, 'A4');
      await page.click('.menu button:has-text("刪除此列")');
      await page.waitForSelector('.modal');
      await page.keyboard.press('Enter');
      assert.equal(await item(page, 'A4'), null);
      const pads = await state(page, () => Object.values(TIM.store.db.projects)[0].views.reduce((n, v) => n + v.shapes.filter(s => !Object.values(TIM.store.db.projects)[0].items.some(i => i.id === s.item_id)).length, 0));
      assert.equal(pads, 0, 'no orphan pads left');
    },
  },
];

module.exports.push({
  name: 'IME composition (注音 / 倉頡) commits the composed text',
  async run(env) {
    const { page } = env;
    await openWithDemo(env);
    await page.click('.proj-name');
    await page.click('.tab:has-text("總覽")');
    const inp = page.locator('.field:has(label:text-is("客戶")) input');
    await inp.click();
    await inp.evaluate(el => {
      el.select();
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
      el.value = 'ㄊㄞˊ';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: 'ㄊㄞˊ', inputType: 'insertCompositionText' }));
      el.value = '台達';
      el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '台達', inputType: 'insertCompositionText' }));
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '台達' }));
    });
    const customer = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].customer);
    assert.equal(customer, '台達');
    const log = await page.evaluate(() => Object.values(TIM.store.db.projects)[0].changelog.filter(c => c.field === '客戶').map(c => c.to));
    assert.deepEqual(log, ['台達'], 'no intermediate phonetic text in the change log');
  },
});

module.exports.push({
  name: 'drag reorder: drop target follows the pointer back onto an unchanged row',
  async run(env) {
    const { page } = env;
    await openWithDemo(env);
    await openBom(page);
    const rowBox = async no => page.locator('tr:has([data-cell="' + (await rowOf(page, no)) + ',0"])').boundingBox();
    const order = () => state(page, () => {
      const p = Object.values(TIM.store.db.projects)[0];
      const loc = p.locations.find(l => l.name === 'Bottom Case');
      return TIM.calc.orderedItems(p).filter(i => i.location_id === loc.id).map(i => i.item_no);
    });
    const before = await order();
    assert.deepEqual(before.slice(0, 3), ['A1-1', 'A1-2', 'A2']);
    const src = await page.locator('tr:has([data-cell="' + (await rowOf(page, 'A5')) + ',0"]) td.row-handle').boundingBox();
    const y = await rowBox('A1-2');
    const z = await rowBox('A4');
    // Synthetic drag events: exact control over which row receives each dragover (Playwright's emulated
    // HTML5 drag coalesces them), like a pointer that leaves the table and re-enters on another row.
    const fire = (type, x, yy) => page.evaluate(([type, x, yy]) => {
      window.__dt = window.__dt || new DataTransfer();
      document.elementFromPoint(x, yy).dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: yy, dataTransfer: window.__dt }));
    }, [type, x, yy]);
    const at = (b, f) => [b.x + 260, b.y + b.height * f];
    await fire('dragstart', src.x + src.width / 2, src.y + src.height / 2);
    // A1-2 upper half → A1-2 lower half (= before A2) → A4 → straight back to A1-2 lower half
    for (const [x, yy] of [at(y, 0.25), at(y, 0.75), at(z, 0.25), at(y, 0.75)]) {
      await fire('dragover', x, yy);
      await page.waitForTimeout(60);
    }
    const marked = await page.evaluate(() => Array.from(document.querySelectorAll('tr.drop-before [data-cell$=",0"]')).map(e => e.value));
    assert.deepEqual(marked, ['A2'], 'drop indicator sits on A2, not on the row visited before');
    await fire('drop', ...at(y, 0.75));
    await page.waitForFunction(() => !document.querySelector('tr.drop-before'));
    const after = await order();
    assert.deepEqual(after.slice(0, 4), ['A1-1', 'A1-2', 'A5', 'A2']);
    assert.equal(after.length, before.length);
  },
});

module.exports.push({
  name: '顯示 / 隱藏: tick columns and rows off (panel, header / row right-click), indicator, copy / paste keep the Excel column order, show all',
  async run(env) {
    const { page } = env;
    await openWithDemo(env);
    await openBom(page);
    const heads = () => page.locator('table.grid thead th[data-col]').evaluateAll(els => els.map(e => e.dataset.col));
    const rowNos = () => page.locator('[data-cell$=",0"]').evaluateAll(els => els.map(e => e.value));
    const all = await rowNos();
    assert.ok(all.includes('A2') && all.includes('A3'));
    assert.equal(await page.locator('.hide-chip').count(), 0);

    // panel: Item stays, untick a column and a row
    await page.click('.bom-toolbar button:has-text("顯示 / 隱藏")');
    await page.waitForSelector('.hide-panel');
    assert.equal(await page.locator('.hide-panel .hp-item:has-text("Item") input').isDisabled(), true);
    await page.locator('.hide-panel .hp-col >> nth=0 >> .hp-item:has-text("Delta P/N") input').uncheck();
    await page.locator('.hide-panel .hp-col >> nth=1 >> .hp-item:has(b:text-is("A2")) input').uncheck();
    assert.ok(!(await heads()).includes('delta_pn'));
    assert.ok(!(await rowNos()).includes('A2'));
    await page.waitForSelector('.hide-chip:has-text("已隱藏 1 列、1 欄")');
    assert.match(await page.locator('tr.grp-foot >> nth=0').innerText(), /另有 1 列隱藏/);
    // Esc closes the panel; the hidden state stays (this browser's preference)
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hide-panel', { state: 'detached' });
    const pref = await page.evaluate(() => [localStorage.getItem('tim_pref_bom_hidden_cols'), localStorage.getItem('tim_pref_bom_hidden_rows')]);
    assert.deepEqual(JSON.parse(pref[0]), ['delta_pn']);
    assert.equal(Object.values(JSON.parse(pref[1]))[0].length, 1);

    // row right-click → 隱藏此列; header right-click → 隱藏「…」欄 (Item cannot be hidden)
    await page.click('tr:has([data-cell="' + (await rowOf(page, 'A3')) + ',0"]) td.row-handle', { button: 'right' });
    await page.click('.menu button:has-text("隱藏此列")');
    assert.ok(!(await rowNos()).includes('A3'));
    await page.click('table.grid thead th[data-col="qty"]', { button: 'right' });
    await page.click('.menu button:has-text("隱藏「Q\'ty」欄")');
    assert.ok(!(await heads()).includes('qty'));
    await page.click('table.grid thead th[data-col="item_no"]', { button: 'right' });
    assert.equal(await page.locator('.menu button:has-text("Item 欄固定顯示")').isDisabled(), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('.hide-chip:has-text("已隱藏 2 列、2 欄")');
    assert.equal(await item(page, 'A3').then(i => i.item_no), 'A3', 'hiding changes no data');

    // copy Size .. Note (adjacent on screen): the hidden Q'ty and Delta P/N in between are copied too
    const cIdx = async key => (await heads()).indexOf(key);
    const r = await rowOf(page, 'A4');
    const sizeC = await cIdx('size'), noteC = await cIdx('covered');
    assert.equal(noteC, sizeC + 1, 'Q\'ty and Delta P/N are hidden between Size and Note');
    await cell(page, r, sizeC).click();
    await page.keyboard.press('Shift+ArrowRight');
    const tsv = await page.evaluate(([r, c]) => {
      const el = document.querySelector('[data-cell="' + r + ',' + c + '"]');
      const dt = new DataTransfer();
      el.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
      return dt.getData('text/plain');
    }, [r, sizeC]);
    assert.deepEqual(tsv.split('\t'), ['6*6*2.5', '8', 'DEMO-0005', 'LDO-7172*2, BUCK-8627*4, BUCK-3219*2']);
    // paste at Size: the values follow the full column order, the hidden Q'ty / Delta P/N take theirs
    await page.keyboard.press('Escape');
    await paste(page, r, sizeC, '7*7*2\t5\tDEMO-0999\tLDO-7172*2');
    await page.waitForSelector('.toast:has-text("2 格寫入已隱藏的欄")');
    const a4 = await item(page, 'A4');
    assert.deepEqual([a4.size, a4.qty, a4.delta_pn, a4.covered.map(c => c.part)], [{ l: 7, w: 7, t: 2 }, 5, 'DEMO-0999', ['LDO-7172']]);

    // show all
    await page.click('.hide-chip');
    await page.waitForSelector('.hide-chip', { state: 'detached' });
    assert.deepEqual(await rowNos(), all);
    assert.ok((await heads()).includes('delta_pn') && (await heads()).includes('qty'));
  },
});
