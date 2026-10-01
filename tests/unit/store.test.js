'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const schema = require('../../js/core/schema.js');
const merge = require('../../js/core/merge.js');
const { createStore } = require('../../js/core/store.js');

/** In-memory backend shared by several "clients" (simulates one JSON file on a network drive). */
function memFile(initialText) {
  const f = { text: initialText || '', writes: 0 };
  return {
    file: f,
    backend: () => ({
      kind: 'mem',
      label: () => 'mem.json',
      head: async () => f.text.slice(0, 512),
      read: async () => f.text,
      write: async (t) => { f.text = t; f.writes++; },
    }),
  };
}

async function open(file, name) {
  const st = createStore({ saveDelay: 1 });
  st.setUser(name || 'u');
  const text = file.file.text;
  const db = text ? schema.normalizeDb(JSON.parse(text)) : schema.newDb();
  st.attach(file.backend(), db);
  return st;
}

function addProject(st, name) {
  const p = schema.newProject({ name });
  st.mutateDb(db => { db.projects[p.id] = p; }, { projects: [p.id] });
  return p.id;
}

test('serializeDb puts rev in the head', () => {
  const db = schema.newDb(); db.rev = 42;
  const s = merge.serializeDb(db);
  assert.equal(merge.revFromHead(s.slice(0, 120)), 42);
  assert.ok(s.indexOf('"images"') > s.indexOf('"projects"'));
});

test('save, undo coalescing and change log', async () => {
  const file = memFile('');
  const st = await open(file, 'alice');
  const pid = addProject(st, 'Alpha');
  const it = schema.newItem({ item_no: 'A1', location_id: st.db.projects[pid].locations[0].id });
  st.mutateProject(pid, p => { p.items.push(it); }, { changes: [{ kind: 'add', target_id: it.id, item_no: 'A1' }] });
  // three keystrokes → one undo step, one log entry
  ['A', 'A9', 'A99'].forEach(v => st.mutateProject(pid, p => { p.items[0].vendor = v; },
    { coalesce: 'v', changes: [{ target_id: it.id, item_no: 'A1', field: 'vendor', from: '', to: v }] }));
  const log = st.db.projects[pid].changelog;
  assert.equal(log.length, 2);
  assert.equal(log[1].to, 'A99'); assert.equal(log[1].from, '（空）'); assert.equal(log[1].user, 'alice');
  assert.equal(st.undo('p:' + pid), true);
  assert.equal(st.db.projects[pid].items[0].vendor, '');
  assert.equal(st.redo('p:' + pid), true);
  assert.equal(st.db.projects[pid].items[0].vendor, 'A99');
  await st.flush();
  const saved = JSON.parse(file.file.text);
  assert.equal(saved.schema, 'tim-db');
  assert.equal(saved.projects[pid].items[0].vendor, 'A99');
  assert.equal(saved.rev, st.db.rev);
  assert.equal(st.status.state, 'saved');
});

test('two clients editing different projects both survive', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const p1 = addProject(a, 'P1');
  const p2 = addProject(a, 'P2');
  await a.flush();
  const b = await open(file, 'bob');
  a.mutateProject(p1, p => { p.customer = 'from alice'; });
  b.mutateProject(p2, p => { p.customer = 'from bob'; });
  await a.flush();
  await b.flush();                         // b must merge, not overwrite alice
  const disk = JSON.parse(file.file.text);
  assert.equal(disk.projects[p1].customer, 'from alice');
  assert.equal(disk.projects[p2].customer, 'from bob');
  assert.equal(b.db.projects[p1].customer, 'from alice');   // b adopted alice's change
  assert.equal(b.conflicts.length, 0);
  await a.syncCheck();
  assert.equal(a.db.projects[p2].customer, 'from bob');     // a pulled bob's change
});

test('same project edited by two clients → conflict copy, nothing lost', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const p1 = addProject(a, 'Shared');
  await a.flush();
  const b = await open(file, 'bob');
  a.mutateProject(p1, p => { p.customer = 'A'; });
  b.mutateProject(p1, p => { p.customer = 'B'; });
  await a.flush();
  await b.flush();
  const disk = JSON.parse(file.file.text);
  const projects = Object.values(disk.projects);
  assert.equal(projects.length, 2);
  assert.equal(disk.projects[p1].customer, 'A');
  const copy = projects.find(p => p.id !== p1);
  assert.equal(copy.customer, 'B');
  assert.match(copy.name, /衝突副本/);
  assert.equal(b.conflicts[0].type, 'conflict');
});

test('delete vs remote edit keeps the edited project', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const p1 = addProject(a, 'X');
  await a.flush();
  const b = await open(file, 'bob');
  a.mutateProject(p1, p => { p.customer = 'edited'; });
  await a.flush();
  b.mutateDb(db => { delete db.projects[p1]; }, { deletedProjects: [p1] });
  await b.flush();
  const disk = JSON.parse(file.file.text);
  assert.equal(disk.projects[p1].customer, 'edited');
  assert.equal(b.conflicts[0].type, 'delete_skipped');
  assert.equal(b.db.projects[p1].customer, 'edited');
});

test('corrupt or foreign file → read-only, never overwritten', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  addProject(a, 'X');
  await a.flush();
  file.file.text = '{"thermal_reports": {}}';
  a.mutateDb(db => { db.settings.dt_warn = 5; }, { settings: true });
  await a.flush();
  assert.equal(a.readonly, true);
  assert.equal(file.file.text, '{"thermal_reports": {}}');
  assert.equal(a.mutateDb(db => { db.settings.dt_warn = 6; }, { settings: true }), false);
});

test('edit during an in-flight save is not lost and does not clobber remote edits', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const p1 = addProject(a, 'P1');
  await a.flush();
  // slow writer to open a window for concurrent edits
  const slow = a.backend.write;
  a.backend.write = async (t) => { await new Promise(r => setTimeout(r, 30)); return slow(t); };
  a.mutateProject(p1, p => { p.customer = 'first'; });
  const pending = a.saveNow();
  await new Promise(r => setTimeout(r, 5));
  a.mutateProject(p1, p => { p.code = 'second'; });
  await pending;
  await a.flush();
  const disk = JSON.parse(file.file.text);
  assert.equal(disk.projects[p1].customer, 'first');
  assert.equal(disk.projects[p1].code, 'second');
});

test('orphan images are pruned but undo history keeps them alive', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const pid = addProject(a, 'Img');
  let imgId;
  a.mutateProject(pid, p => {
    imgId = a.addImage({ data: 'data:image/png;base64,AAAA', w: 1, h: 1 });
    p.views.push(schema.newView({ image_id: imgId }));
  });
  await a.flush();
  assert.ok(JSON.parse(file.file.text).images[imgId]);
  a.mutateProject(pid, p => { p.views = []; });
  await a.flush();
  assert.ok(JSON.parse(file.file.text).images[imgId], 'kept while undo can restore the view');
  a.clearHistory('p:' + pid);
  a.mutateProject(pid, p => { p.customer = 'x'; }, { noUndo: true });
  await a.flush();
  assert.equal(JSON.parse(file.file.text).images[imgId], undefined);
});

test('remote edit adopted mid-save + local edit of the same project → conflict copy, not overwrite', async () => {
  const file = memFile('');
  const a = await open(file, 'alice');
  const P = addProject(a, 'P');
  const Q = addProject(a, 'Q');
  await a.flush();
  const b = await open(file, 'bob');
  b.mutateProject(P, p => { p.customer = 'bob'; });
  await b.flush();                                   // disk now has bob's P
  const slow = a.backend.write;
  a.backend.write = async (t) => { await new Promise(r => setTimeout(r, 30)); return slow(t); };
  a.mutateProject(Q, p => { p.customer = 'alice-q'; });
  const pending = a.saveNow();                       // merge path (disk rev moved)
  await new Promise(r => setTimeout(r, 5));
  a.mutateProject(P, p => { p.code = 'alice-p'; });  // edits P while the save is in flight
  await pending;
  await a.flush();
  const disk = JSON.parse(file.file.text);
  assert.equal(disk.projects[P].customer, 'bob', "bob's edit must survive");
  const copy = Object.values(disk.projects).find(p => p.id !== P && p.id !== Q);
  assert.ok(copy, 'alice edit kept as a conflict copy');
  assert.equal(copy.code, 'alice-p');
  assert.equal(disk.projects[Q].customer, 'alice-q');
});
