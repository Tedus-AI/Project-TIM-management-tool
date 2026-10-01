'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const geom = require('../../js/core/geom.js');

const close = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

function setup() {
  const p = schema.newProject({ name: 'G' });
  const it = schema.newItem({ item_no: 'A4', location_id: p.locations[0].id, size: { l: 6, w: 3, t: 2.5 } });
  p.items.push(it);
  // 1000 x 500 px drawing, calibration: 200 px = 50 mm → 4 px/mm
  const v = schema.newView({ img_w: 1000, img_h: 500, calib: { x1: 0.1, y1: 0.5, x2: 0.3, y2: 0.5, mm: 50 } });
  p.views.push(v);
  return { p, it, v };
}

test('calibration → px/mm and true-size pads', () => {
  const { it, v } = setup();
  assert.ok(close(geom.pxPerMm(v), 4));
  const s = schema.newShape({ item_id: it.id, cx: 0.5, cy: 0.5 });
  const sz = geom.padSize(v, s, it);
  assert.equal(sz.trueSize, true); assert.ok(close(sz.w, 24)); assert.ok(close(sz.h, 12));
  const manual = geom.padSize(v, Object.assign({}, s, { size_mode: 'manual', w: 0.1, h: 0.2 }), it);
  assert.equal(manual.trueSize, false); assert.ok(close(manual.w, 100)); assert.ok(close(manual.h, 100));
  assert.equal(geom.pxPerMm(Object.assign({}, v, { calib: null })), null);
});

test('rectExit / boxExit land on the boundary', () => {
  const e = geom.rectExit(0, 0, 20, 10, 0, 100, 0);
  assert.ok(close(e.x, 10) && close(e.y, 0));
  const r = geom.rectExit(0, 0, 20, 10, 90, 100, 0);       // rotated: half-height along x
  assert.ok(close(r.x, 5) && close(r.y, 0));
  const b = geom.boxExit({ x: 0, y: 0, w: 10, h: 10 }, 5, 100);
  assert.ok(close(b.x, 5) && close(b.y, 10));
  assert.equal(geom.pointInPad(4, 0, { cx: 0, cy: 0, w: 10, h: 2, rot: 0 }), true);
  assert.equal(geom.pointInPad(0, 4, { cx: 0, cy: 0, w: 10, h: 2, rot: 0 }), false);
  assert.equal(geom.pointInPad(0, 4, { cx: 0, cy: 0, w: 10, h: 2, rot: 90 }), true);
});

test('callout with targets=null connects every pad of its item', () => {
  const { p, it, v } = setup();
  v.shapes.push(schema.newShape({ item_id: it.id, cx: 0.2, cy: 0.2 }), schema.newShape({ item_id: it.id, cx: 0.8, cy: 0.8, rot: 90 }));
  v.callouts.push(schema.newCallout({ item_id: it.id, x: 0.5, y: 0.5 }));
  const L = geom.layout(v, p);
  assert.equal(L.pads.length, 2);
  assert.equal(L.callouts[0].leaders.length, 2);
  assert.equal(L.callouts[0].text, 'A4');
  const l = L.callouts[0].leaders[0];
  // arrow tip lies on the pad boundary
  const tip = l.arrow[0];
  const pad = L.pads[0];
  const lx = Math.abs(tip[0] - pad.cx), ly = Math.abs(tip[1] - pad.cy);
  assert.ok(close(lx, pad.w / 2, 1e-6) || close(ly, pad.h / 2, 1e-6));
  // explicit targets restrict leaders
  v.callouts[0].targets = [v.shapes[1].id];
  assert.equal(geom.layout(v, p).callouts[0].leaders.length, 1);
  // a scale bar is produced for calibrated views
  assert.ok(L.scaleBar && L.scaleBar.mm > 0);
});

test('upright text angles', () => {
  assert.equal(geom.uprightAngle(0), 0);
  assert.equal(geom.uprightAngle(90), 90);
  assert.equal(geom.uprightAngle(180), 0);
  assert.equal(geom.uprightAngle(135), -45);
  assert.equal(geom.uprightAngle(-90), 90);
});

test('two auto callouts of one item split its pads by proximity', () => {
  const { p, it, v } = setup();
  const top = [schema.newShape({ item_id: it.id, cx: 0.2, cy: 0.1 }), schema.newShape({ item_id: it.id, cx: 0.3, cy: 0.12 })];
  const bottom = [schema.newShape({ item_id: it.id, cx: 0.2, cy: 0.9 }), schema.newShape({ item_id: it.id, cx: 0.3, cy: 0.88 }), schema.newShape({ item_id: it.id, cx: 0.25, cy: 0.8 })];
  v.shapes.push(...top, ...bottom);
  v.callouts.push(schema.newCallout({ item_id: it.id, x: 0.5, y: 0.05 }), schema.newCallout({ item_id: it.id, x: 0.5, y: 0.95 }));
  const L = geom.layout(v, p);
  assert.deepEqual(L.callouts[0].targetIds.sort(), top.map(s => s.id).sort());
  assert.deepEqual(L.callouts[1].targetIds.sort(), bottom.map(s => s.id).sort());
  // a manual callout keeps its explicit list and does not steal auto pads
  v.callouts.push(schema.newCallout({ item_id: it.id, x: 0.25, y: 0.5, targets: [top[0].id] }));
  const L2 = geom.layout(v, p);
  assert.deepEqual(L2.callouts[2].targetIds, [top[0].id]);
  assert.equal(L2.callouts[0].targetIds.length, 2);
});
