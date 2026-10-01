/* Test fixture (not shipped with the app): demo project for the browser tests — fictional
 * vendors / parts / numbers, synthetic case drawings. Structure mirrors a real 5G RRU TIM
 * list (bottom case + top case, multi-instance pads). Injected by tests/e2e/helpers.js. */
(function () {
  'use strict';
  const TIM = window.TIM;
  const { schema, util } = TIM;
  const DEMO_NOTE = '範例資料（虛構數值，請勿用於設計）';

  function holes(w, h, inset) {
    let s = '';
    const xs = [inset, w / 3, (2 * w) / 3, w - inset], ys = [inset, h / 2, h - inset];
    xs.forEach(x => [inset, h - inset].forEach(y => { s += `<circle cx="${x}" cy="${y}" r="7" fill="#8A95A3" stroke="#5E6876" stroke-width="2"/>`; }));
    ys.forEach(y => [inset, w - inset].forEach(x => { s += `<circle cx="${x}" cy="${y}" r="7" fill="#8A95A3" stroke="#5E6876" stroke-width="2"/>`; }));
    return s;
  }

  function bottomSvg() {
    const W = 1100, H = 720;
    const pipes = [
      'M140 120 C 260 250, 330 205, 640 205', 'M110 250 C 250 300, 330 252, 640 252',
      'M100 400 C 300 360, 400 330, 640 330', 'M120 520 C 300 450, 420 420, 640 420',
      'M160 640 C 300 560, 420 500, 640 470', 'M330 690 C 330 560, 420 540, 640 540',
    ].map(d => `<path d="${d}" fill="none" stroke="#7D8794" stroke-width="22" stroke-linecap="round"/><path d="${d}" fill="none" stroke="#AEB7C2" stroke-width="15" stroke-linecap="round"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#D3D9E0"/>
      <rect x="40" y="30" width="1020" height="660" rx="30" fill="#BAC3CD" stroke="#5E6876" stroke-width="3"/>
      <rect x="72" y="60" width="956" height="600" rx="18" fill="#C7CED7" stroke="#8D97A4" stroke-width="2"/>
      ${holes(1100, 720, 58)}
      <rect x="640" y="180" width="270" height="140" fill="#BCC4CE" stroke="#7D8794" stroke-width="2"/>
      <rect x="640" y="370" width="270" height="140" fill="#BCC4CE" stroke="#7D8794" stroke-width="2"/>
      <rect x="120" y="300" width="120" height="70" rx="14" fill="none" stroke="#7D8794" stroke-width="3"/>
      <rect x="560" y="600" width="140" height="50" fill="#AEB7C2" stroke="#6B7684" stroke-width="2"/>
      ${pipes}
      <g fill="#9AA4B1" stroke="#6B7684" stroke-width="1.5">
        <rect x="508" y="128" width="20" height="20"/><rect x="588" y="128" width="20" height="20"/><rect x="628" y="128" width="20" height="20"/>
        <rect x="548" y="228" width="20" height="20"/><rect x="508" y="548" width="20" height="20"/><rect x="588" y="588" width="20" height="20"/>
        <rect x="628" y="588" width="20" height="20"/><rect x="548" y="478" width="20" height="20"/>
      </g>
      <text x="1020" y="705" text-anchor="end" font-family="Arial" font-size="14" fill="#5E6876">DEMO BOTTOM CASE · synthetic drawing</text>
    </svg>`;
  }

  function topSvg() {
    const W = 1100, H = 720;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <rect width="${W}" height="${H}" fill="#0E1B33"/>
      <rect x="40" y="30" width="1020" height="660" rx="34" fill="#A9B3BF" stroke="#E2E8EF" stroke-width="3"/>
      <rect x="66" y="56" width="968" height="608" rx="22" fill="#B8C1CB" stroke="#7D8794" stroke-width="2"/>
      ${holes(1100, 720, 52)}
      <path d="M110 90 h220 a18 18 0 0 1 0 36 a18 18 0 0 0 0 36 a18 18 0 0 1 0 36 a18 18 0 0 0 0 36 a18 18 0 0 1 0 36 a18 18 0 0 0 0 36 a18 18 0 0 1 0 36 a18 18 0 0 0 0 36 a18 18 0 0 1 0 36 v40 h-220 z" fill="#0E1B33" stroke="#5E6876" stroke-width="2"/>
      <rect x="96" y="560" width="190" height="90" rx="14" fill="none" stroke="#5E6876" stroke-width="3"/>
      <g fill="#9EA8B5" stroke="#6B7684" stroke-width="2">
        <rect x="520" y="210" width="80" height="80"/><rect x="560" y="345" width="80" height="80"/>
        <rect x="700" y="200" width="120" height="120"/><rect x="700" y="390" width="120" height="120"/>
        <rect x="950" y="130" width="80" height="160"/><rect x="950" y="300" width="80" height="160"/><rect x="950" y="470" width="80" height="160"/>
        <rect x="330" y="585" width="180" height="80"/>
      </g>
      <text x="1020" y="705" text-anchor="end" font-family="Arial" font-size="14" fill="#E2E8EF">DEMO TOP CASE · synthetic drawing</text>
    </svg>`;
  }

  async function svgToImage(svg, name) {
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    return TIM.image.fromBlob(blob, name);
  }

  /** Build the demo records → { project, materials:{}, images:{} } (not yet in the store). */
  async function buildSample(user) {
    const mats = {};
    const mk = f => { const m = schema.newMaterial(Object.assign({ note: DEMO_NOTE, k_method: 'ASTM D5470', hardness_scale: 'Shore 00', silicone: 'silicone', ul94: 'V-0', rohs: true, reach: true, avl_status: 'approved' }, f)); mats[m.id] = m; return m; };
    const absAX = mk({ vendor: 'Vendor-A', model: 'AbsorbPad AX', tim_type: 'absorber', k: 1.6, hardness: 55, temp_min: -40, temp_max: 150, comp_rec_min: 10, comp_rec_max: 30, absorber_freq: '2–18 GHz', dk: 18, dk_freq: '3.5 GHz', thickness_options: '0.5–5.0 mm（0.5 mm 一級）', price_ref: 'USD 0.9 / 10 cm²' });
    const abs500 = mk({ vendor: 'Vendor-A', model: 'AbsorbPad AX-500', tim_type: 'absorber', k: 3.0, hardness: 60, temp_min: -40, temp_max: 150, comp_rec_min: 10, comp_rec_max: 30, absorber_freq: '1–10 GHz' });
    const gp75 = mk({ vendor: 'Vendor-B', model: 'GF-750', tim_type: 'pad', k: 7.5, hardness: 45, temp_min: -40, temp_max: 200, comp_rec_min: 10, comp_rec_max: 40, dielectric_kv_mm: 5, thickness_options: '0.5–5.0 mm', shelf_life_months: 24 });
    const gphd = mk({ vendor: 'Vendor-B', model: 'GF-600HD', tim_type: 'pad', k: 6.0, hardness: 35, temp_min: -40, temp_max: 200, comp_rec_min: 10, comp_rec_max: 40, dielectric_kv_mm: 6 });
    const tp800 = mk({ vendor: 'Vendor-C', model: 'TP-800', tim_type: 'pad', k: 8.0, hardness: 50, temp_min: -40, temp_max: 180, comp_rec_min: 10, comp_rec_max: 35 });
    mk({ vendor: 'Vendor-C', model: 'TP-750', tim_type: 'pad', k: 7.5, hardness: 45, temp_min: -40, temp_max: 180, comp_rec_min: 10, comp_rec_max: 40, avl_status: 'qualifying' });

    const p = schema.newProject({
      name: 'DEMO-RRU n78（範例專案）', code: 'DEMO-01', product_type: 'sub6', customer: 'Demo', stage: 'DVT',
      owner: user || 'Thermal', me_owner: 'ME', description: '示範用專案：資料、料號、元件與圖面皆為虛構。',
    }, user);
    const [bottom, top] = p.locations;
    const cov = (part, qty, power, pl, pw, cat, refdes, top) => schema.newCovered({ part, qty, power_w: power, top_pct: top == null ? null : top, pkg_l: pl, pkg_w: pw, cat, refdes: refdes || '' });
    const src = (vendor, model, status, note) => schema.newSource({ vendor, model, status, note: note || '' });
    const item = f => schema.newItem(Object.assign({ status: 'released' }, f));

    const items = [
      item({ item_no: 'A1-1', location_id: bottom.id, used_on: ['RF'], material_id: absAX.id, vendor: absAX.vendor, model: absAX.model, tim_type: 'absorber', size: { l: 51.5, w: 9, t: 3 }, qty: 4, delta_pn: 'DEMO-0001', covered: [cov('PAD-2601', 4, 1.8, 6, 6, 'RF', 'U101-U104', 10)], gap: { nom: 2.4, min: 2.2, max: 2.6 }, sourcing_note: 'Vendor-A only source', price: { unit: 0.62, currency: 'USD' } }),
      item({ item_no: 'A1-2', location_id: bottom.id, used_on: ['RF'], material_id: absAX.id, vendor: absAX.vendor, model: absAX.model, tim_type: 'absorber', size: { l: 66.3, w: 9, t: 3 }, qty: 2, delta_pn: 'DEMO-0002', covered: [cov('PAD-2601', 2, 1.8, 6, 6, 'RF', 'U105-U106', 10)], gap: { nom: 2.4, min: 2.2, max: 2.6 }, sourcing_note: 'Vendor-A only source', price: { unit: 0.78, currency: 'USD' } }),
      item({ item_no: 'A2', location_id: bottom.id, used_on: ['RF'], material_id: absAX.id, vendor: absAX.vendor, model: absAX.model, tim_type: 'absorber', size: { l: 8, w: 8, t: 2 }, qty: 3, delta_pn: 'DEMO-0003', covered: [cov('PLL-4368', 1, 0.9, 7, 7, 'RF', 'U201', 20), cov('MIX-1139', 2, 0.6, 5, 5, 'RF', 'U202,U203', 20)], gap: { nom: 1.7, min: 1.55, max: 1.85 }, sourcing_note: 'Vendor-A only source', price: { unit: 0.12, currency: 'USD' } }),
      item({ item_no: 'A3', location_id: bottom.id, used_on: ['RF'], material_id: abs500.id, vendor: abs500.vendor, model: abs500.model, tim_type: 'absorber', size: { l: 14, w: 5, t: 2 }, qty: 2, delta_pn: 'DEMO-0004', covered: [cov('OPAMP-6409', 2, 0.4, 3, 3, 'RF', 'U211,U212', 30)], gap: { nom: 1.6, min: 1.45, max: 1.75 }, sourcing_note: 'Vendor-A only source' }),
      item({ item_no: 'A4', location_id: bottom.id, used_on: ['RF'], material_id: tp800.id, vendor: tp800.vendor, model: tp800.model, tim_type: 'pad', size: { l: 6, w: 6, t: 2.5 }, qty: 8, delta_pn: 'DEMO-0005', covered: [cov('LDO-7172', 2, 0.5, 3, 3, 'PWR', '', 30), cov('BUCK-8627', 4, 0.8, 4, 4, 'PWR', '', 30), cov('BUCK-3219', 2, 0.6, 3, 3, 'PWR', '', 30)], gap: { nom: 2.0, min: 1.85, max: 2.15 }, sources: [src('Vendor-D', 'DP-8', 'testing', 'short'), src('Vendor-E', 'EP-80', 'candidate', 'long')], sourcing_note: 'short: Vendor-D, long: Vendor-E', price: { unit: 0.05, currency: 'USD' } }),
      item({ item_no: 'A5', location_id: bottom.id, used_on: ['DIGI'], material_id: gp75.id, vendor: gp75.vendor, model: gp75.model, tim_type: 'pad', size: { l: 11, w: 11, t: 2 }, qty: 3, delta_pn: 'DEMO-0006', covered: [cov('CLK-9492', 1, 1.2, 9, 9, 'DIGI', 'U311', 40), cov('SYNC-0793', 1, 1.0, 8, 8, 'DIGI', 'U312', 40), cov('FANOUT-1208', 1, 0.7, 7, 7, 'DIGI', 'U313', 40)], gap: { nom: 1.6, min: 1.45, max: 1.75 }, sources: [src('Vendor-C', 'TP-750', 'qualified')], price: { unit: 0.09, currency: 'USD' } }),
      item({ item_no: 'A6', location_id: top.id, used_on: ['DIGI'], material_id: gphd.id, vendor: gphd.vendor, model: gphd.model, tim_type: 'pad', size: { l: 20.6, w: 20.6, t: 3.5 }, qty: 2, delta_pn: 'DEMO-0101', covered: [cov('TRX-1235', 2, 4.5, 17, 17, 'RF', 'U401,U402', 70)], gap: { nom: 2.9, min: 2.7, max: 3.1 }, sources: [src('Vendor-C', 'TP-750', 'qualified')], price: { unit: 0.35, currency: 'USD' } }),
      item({ item_no: 'A7', location_id: top.id, used_on: ['DIGI'], material_id: gphd.id, vendor: gphd.vendor, model: gphd.model, tim_type: 'pad', size: { l: 34, w: 34, t: 3.5 }, qty: 2, delta_pn: 'DEMO-0102', covered: [cov('FPGA-U301', 1, 18, 35, 35, 'DIGI', 'U301', 85), cov('SOC-U302', 1, 12, 31, 31, 'DIGI', 'U302', 85)], gap: { nom: 3.0, min: 2.8, max: 3.2 }, sources: [src('Vendor-C', 'TP-750', 'qualified')], price: { unit: 0.82, currency: 'USD' } }),
      item({ item_no: 'A8', location_id: top.id, used_on: ['PWR', 'DDR'], material_id: gp75.id, vendor: gp75.vendor, model: gp75.model, tim_type: 'pad', size: { l: 58, w: 22, t: 3 }, qty: 4, delta_pn: 'DEMO-0103', covered: [cov('BRICK-48V', 1, 25, 58, 23, 'PWR', 'PS1', 95), cov('DDR4-16G', 3, 1.5, 13, 8, 'DDR', 'U501-U503', 60)], gap: { nom: 2.5, min: 2.3, max: 2.7 }, sources: [src('Vendor-C', 'TP-750', 'qualified')], price: { unit: 0.66, currency: 'USD' } }),
    ];
    p.items = items.map(schema.normalizeItem);
    const byNo = {};
    p.items.forEach(it => { byNo[it.item_no] = it; });

    // EVT baseline: A4 was 2.0 mm thick and A8 only 3 pcs
    const evt = TIM.calc.makeSnapshot(p);
    evt.items.forEach(it => {
      if (it.item_no === 'A4') it.size.t = 2.0;
      if (it.item_no === 'A8') { it.qty = 3; it.covered = it.covered.map(c => (c.part === 'DDR4-16G' ? Object.assign({}, c, { qty: 2 }) : c)); }
    });
    const tEvt = new Date(Date.now() - 1000 * 3600 * 24 * 40).toISOString();
    p.baselines.push({ id: util.uid('bl'), name: 'EVT', note: 'EVT build 組態', created_at: tEvt, created_by: user || 'Thermal', stage: 'EVT', snapshot: evt });
    p.changelog.push(
      { id: util.uid('chg'), ts: tEvt, user: user || 'Thermal', kind: 'baseline', target: 'project', target_id: p.baselines[0].id, item_no: '', field: '', from: '', to: '', text: '建立基準「EVT」（9 個 Item）', ecn: '' },
      { id: util.uid('chg'), ts: new Date(Date.now() - 1000 * 3600 * 24 * 21).toISOString(), user: user || 'Thermal', kind: 'ecn', target: 'project', target_id: p.id, item_no: 'A4', field: '', from: '', to: '', text: 'A4 改為 2.5 mm：EVT 拆機壓痕覆蓋不足（間隙實測偏大）', ecn: 'ECN-DEMO-001' },
      { id: util.uid('chg'), ts: new Date(Date.now() - 1000 * 3600 * 24 * 21).toISOString(), user: user || 'Thermal', kind: 'edit', target: 'item', target_id: byNo.A4.id, item_no: 'A4', field: 'Size', from: '6*6*2', to: '6*6*2.5', text: '', ecn: '' },
      { id: util.uid('chg'), ts: new Date(Date.now() - 1000 * 3600 * 24 * 14).toISOString(), user: user || 'Thermal', kind: 'edit', target: 'item', target_id: byNo.A8.id, item_no: 'A8', field: "Q'ty", from: '3', to: '4', text: '', ecn: '' },
    );
    byNo.A4.validation = { coverage_pct: 92, result: 'ok', date: util.todayStr(), note: 'DVT 拆機壓痕完整', image_id: null };

    // Drawings + placements (calibration: case width 1020 px = 408 mm → 2.5 px/mm)
    const images = {};
    const bImg = await svgToImage(bottomSvg(), 'demo-bottom-case.png');
    const tImg = await svgToImage(topSvg(), 'demo-top-case.png');
    const bId = util.uid('img'), tId = util.uid('img');
    images[bId] = bImg; images[tId] = tImg;
    const calib = { x1: 40 / 1100, y1: 700 / 720, x2: 1060 / 1100, y2: 700 / 720, mm: 408 };
    const N = (x, y) => ({ cx: x / 1100, cy: y / 720 });
    const shape = (no, x, y, rot) => schema.newShape(Object.assign({ item_id: byNo[no].id, rot: rot || 0 }, N(x, y)));
    const callout = (no, x, y, targets) => schema.newCallout({ item_id: byNo[no].id, x: x / 1100, y: y / 720, targets: targets || null });

    const bShapes = {
      A11: [shape('A1-1', 775, 205), shape('A1-1', 775, 300), shape('A1-1', 775, 395), shape('A1-1', 775, 490)],
      A12: [shape('A1-2', 775, 252), shape('A1-2', 775, 442)],
      A2: [shape('A2', 612, 280), shape('A2', 612, 372), shape('A2', 612, 455)],
      A3: [shape('A3', 588, 318, 90), shape('A3', 588, 410, 90)],
      A4top: [shape('A4', 518, 138), shape('A4', 598, 138), shape('A4', 638, 138), shape('A4', 558, 238)],
      A4bot: [shape('A4', 518, 558), shape('A4', 598, 598), shape('A4', 638, 598), shape('A4', 558, 488)],
      A5: [shape('A5', 300, 430), shape('A5', 352, 520), shape('A5', 455, 300)],
    };
    const bView = schema.newView({
      name: 'Bottom case', location_id: bottom.id, image_id: bId, img_w: bImg.w, img_h: bImg.h, calib,
      shapes: [].concat(bShapes.A11, bShapes.A12, bShapes.A2, bShapes.A3, bShapes.A4top, bShapes.A4bot, bShapes.A5),
      callouts: [
        callout('A4', 560, 82), callout('A4', 470, 640),          // auto targets: nearest pads → top / bottom groups
        callout('A3', 500, 365), callout('A2', 690, 610), callout('A5', 230, 600),
      ],
    });
    const tShapes = {
      A6: [shape('A6', 560, 250, 45), shape('A6', 600, 385)],
      A7: [shape('A7', 760, 260), shape('A7', 760, 450)],
      A8v: [shape('A8', 990, 210, 90), shape('A8', 990, 380, 90), shape('A8', 990, 550, 90)],
      A8h: [shape('A8', 420, 625)],
    };
    const tView = schema.newView({
      name: 'Top case', location_id: top.id, image_id: tId, img_w: tImg.w, img_h: tImg.h, calib,
      shapes: [].concat(tShapes.A6, tShapes.A7, tShapes.A8v, tShapes.A8h),
      callouts: [callout('A6', 455, 330), callout('A7', 880, 360), callout('A8', 880, 640), callout('A8', 640, 640)],
    });
    p.views = [bView, tView];
    return { project: schema.normalizeProject(p), materials: mats, images };
  }

  /** Insert the demo into the open DB. */
  async function addSampleToStore() {
    const s = await buildSample(TIM.store.user());
    const imgIds = Object.keys(s.images);
    TIM.store.mutateDb(db => {
      Object.assign(db.materials, s.materials);
      Object.keys(s.images).forEach(id => { db.images[id] = s.images[id]; });
      db.projects[s.project.id] = s.project;
    }, { projects: [s.project.id], materials: Object.keys(s.materials), images: imgIds });
    return s.project.id;
  }

  TIM.sample = { buildSample, addSampleToStore, DEMO_NOTE };
})();
