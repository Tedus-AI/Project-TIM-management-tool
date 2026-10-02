'use strict';
// Local folder copy → shared (SharePoint) database: merge.mergePush.
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const merge = require('../../js/core/merge.js');

const clone = o => JSON.parse(JSON.stringify(o));
function shared() {
  const db = schema.newDb();
  db.rev = 7;
  ['P', 'Q', 'R'].forEach((n, i) => { const p = schema.newProject({ name: n }); p.id = 'prj_' + n; p.rev = i + 1; db.projects[p.id] = p; });
  const m = schema.newMaterial({ vendor: 'Vendor-A', model: 'GF-750' }); m.id = 'mat_1'; m.rev = 2; db.materials[m.id] = m;
  return db;
}
const none = () => ({ projects: [], materials: [], images: [], settings: false, deletedProjects: [], deletedMaterials: [] });

test('push: our edits land, other people\'s edits stay, the local copy keeps its own revs', () => {
  const disk = shared();
  const local = clone(disk);                 // the local folder copy (a mirror of the shared database)
  const base = merge.revsOf(local);
  disk.projects.prj_Q.customer = 'colleague'; disk.projects.prj_Q.rev++; disk.rev++;   // someone else, on SharePoint
  local.projects.prj_P.customer = 'me'; local.projects.prj_P.rev = 99;                  // our local save
  const n = schema.newProject({ name: 'New one' }); local.projects[n.id] = n;
  delete local.projects.prj_R;
  const t = Object.assign(none(), { projects: ['prj_P', n.id], deletedProjects: ['prj_R'] });
  const r = merge.mergePush(disk, local, base, t);
  assert.equal(r.merged.projects.prj_P.customer, 'me');
  assert.equal(r.merged.projects.prj_P.rev, 2, 'shared rev + 1, not the local rev');
  assert.equal(r.merged.projects.prj_Q.customer, 'colleague');
  assert.ok(r.merged.projects[n.id], 'new project added');
  assert.equal(r.merged.projects.prj_R, undefined, 'deleted (nobody changed it meanwhile)');
  assert.equal(r.merged.rev, 9);
  assert.equal(r.conflicts.length, 0);
  assert.equal(local.projects.prj_P.rev, 99, 'local copy untouched');
  assert.equal(r.base.projects.prj_P, 2);
  assert.equal(r.base.projects.prj_Q, 3);
});

test('push: same project changed on both sides → their version stays, ours becomes one conflict copy that later pushes update', () => {
  const disk = shared();
  const local = clone(disk);
  let base = merge.revsOf(local);
  disk.projects.prj_P.customer = 'colleague'; disk.projects.prj_P.rev++; disk.rev++;
  local.projects.prj_P.customer = 'me v1';
  let r = merge.mergePush(disk, local, base, Object.assign(none(), { projects: ['prj_P'] }));
  assert.equal(r.merged.projects.prj_P.customer, 'colleague', 'never overwritten');
  assert.equal(r.conflicts.length, 1);
  const copyId = r.copies.projects.prj_P.id;
  assert.match(r.merged.projects[copyId].name, /^P \(衝突副本/);
  assert.equal(r.merged.projects[copyId].customer, 'me v1');
  // next local save of P → the same copy is updated, no new copy, theirs still untouched
  const disk2 = r.merged; base = r.base;
  local.projects.prj_P.customer = 'me v2';
  r = merge.mergePush(clone(disk2), local, base, Object.assign(none(), { projects: ['prj_P'] }), r.copies);
  assert.equal(r.conflicts.length, 0);
  assert.equal(Object.keys(r.merged.projects).length, 4, 'P, Q, R + one copy');
  assert.equal(r.merged.projects[copyId].customer, 'me v2');
  assert.equal(r.merged.projects[copyId].name, disk2.projects[copyId].name, 'copy keeps its name');
  assert.equal(r.merged.projects.prj_P.customer, 'colleague');
});

test('push: deleting locally what someone else just edited keeps theirs; materials and settings follow the same rules', () => {
  const disk = shared();
  const local = clone(disk);
  const base = merge.revsOf(local);
  disk.projects.prj_R.customer = 'colleague'; disk.projects.prj_R.rev++;
  delete local.projects.prj_R;
  local.materials.mat_1.k = 6.5;
  local.settings.default_locations = ['Top Case'];
  const r = merge.mergePush(disk, local, base, Object.assign(none(), { materials: ['mat_1'], settings: true, deletedProjects: ['prj_R'] }));
  assert.equal(r.merged.projects.prj_R.customer, 'colleague');
  assert.ok(r.conflicts.some(c => c.type === 'delete_skipped'));
  assert.equal(r.merged.materials.mat_1.k, 6.5);
  assert.equal(r.merged.materials.mat_1.rev, 3);
  assert.deepEqual(r.merged.settings.default_locations, ['Top Case']);
});
