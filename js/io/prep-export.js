/* TIM 備料 output: the Excel list (ExcelJS), the Outlook draft (.eml) and the mailto fallback.
 * Everything comes from one composed email (TIM.prep.compose), so the email table, the Excel and a
 * later re-download of a sent 備料單 (prep.mailed) are the same. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { prep } = TIM;

  const argb = hex => 'FF' + String(hex).replace('#', '').toUpperCase();
  const fill = hex => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } });
  const thin = { style: 'thin', color: { argb: 'FF7F7F7F' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const FONT = { name: 'Arial', size: 10 };
  const textWidth = s => Array.from(String(s || '')).reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);

  /** The Excel list of one email: header block (專案, 套數, 需求日期…), then the table. → Uint8Array */
  async function xlsx(m) {
    const ExcelJS = await TIM.loader.load('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'TIM Management Tool';
    const ws = wb.addWorksheet('備料清單', { pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    const width = m.head.length;
    let r = 1;
    ws.mergeCells(r, 1, r, width);
    ws.getCell(r, 1).value = m.title;
    ws.getCell(r, 1).font = { name: 'Arial', size: 14, bold: true };
    ws.getRow(r).height = 24;
    m.info.forEach(([k, v]) => {
      r++;
      ws.mergeCells(r, 1, r, 2);
      ws.mergeCells(r, 3, r, width);
      const kc = ws.getCell(r, 1), vc = ws.getCell(r, 3);
      kc.value = k; vc.value = v || '';
      kc.font = Object.assign({ bold: true, color: { argb: 'FF404040' } }, FONT);
      vc.font = FONT;
      kc.fill = fill('#F2F2F2');
      [kc, vc].forEach(c => { c.border = border; c.alignment = { vertical: 'middle' }; });
      for (let c = 2; c <= width; c++) ws.getCell(r, c).border = border;
    });
    r += 2;
    const headRow = r;
    m.head.forEach((h, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = h;
      c.font = Object.assign({ bold: true }, FONT);
      c.fill = fill('#D9E1F2');
      c.border = border;
      c.alignment = { vertical: 'middle', horizontal: m.num[i] ? 'right' : 'left', wrapText: true };
    });
    m.rows.forEach(row => {
      r++;
      row.forEach((v, i) => {
        const c = ws.getCell(r, i + 1);
        c.value = m.num[i] && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
        c.font = i === width - 1 ? Object.assign({ bold: true }, FONT) : FONT;
        c.border = border;
        c.alignment = { vertical: 'top', horizontal: m.num[i] ? 'right' : 'left', wrapText: true };
      });
    });
    r += 2;
    ws.getCell(r, 1).value = m.note;
    ws.getCell(r, 1).font = { name: 'Arial', size: 9, color: { argb: 'FF595959' } };
    m.head.forEach((h, i) => {
      const w = Math.max(textWidth(h), ...m.rows.map(row => textWidth(row[i])));
      ws.getColumn(i + 1).width = Math.min(48, Math.max(i < 2 ? 9 : 6, w + 2));
    });
    ws.views = [{ state: 'frozen', ySplit: headRow }];
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  /** The Outlook draft of one email (HTML table + Excel attached). → { blob, name } */
  async function eml(m) {
    const data = await xlsx(m);
    const text = prep.buildEml({
      to: m.to, cc: m.cc, subject: m.subject, html: prep.bodyHtml(m), text: prep.bodyText(m),
      attachments: [{ name: m.file, type: prep.XLSX_TYPE, data }],
    });
    return { blob: new Blob([text], { type: 'message/rfc822' }), name: prep.emlName(m) };
  }

  async function downloadEml(m) { const e = await eml(m); TIM.ui.downloadBlob(e.blob, e.name); return e.name; }
  async function downloadXlsx(m) { TIM.ui.downloadBlob(new Blob([await xlsx(m)], { type: prep.XLSX_TYPE }), m.file); return m.file; }

  /** Fallback: the default mail app with recipients, subject and text (no table formatting, no attachment). */
  function openMailto(m) {
    const a = document.createElement('a');
    a.href = prep.mailtoUrl(m);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  }

  /** Copy the email body (HTML table) to paste into any mail app. */
  async function copyBody(m) {
    const html = prep.bodyHtml(m), text = prep.bodyText(m);
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
    } else {
      await navigator.clipboard.writeText(text);
    }
  }

  TIM.prepExport = { xlsx, eml, downloadEml, downloadXlsx, openMailto, copyBody };
})();
