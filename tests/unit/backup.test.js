'use strict';
// Backups: <database folder>/Backup/tim_db_backup_YYYY-MM-DD_HHmm.json — the same on SharePoint and locally.
// Two kept: today's latest and the previous day's last.
const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('../../js/core/util.js');

test('backup file name: local date + hour + minute', () => {
  assert.equal(util.backupFileName(new Date(2026, 9, 8, 9, 5)), 'tim_db_backup_2026-10-08_0905.json');
  assert.equal(util.backupFileName(new Date(2026, 0, 2, 23, 59)), 'tim_db_backup_2026-01-02_2359.json');
  assert.ok(util.BACKUP_RE.test('tim_db_backup_2026-10-08_0905.json'));
  assert.ok(util.BACKUP_RE.test('tim_db_backup_2026-10-01.json'), 'older daily name still counts as a backup');
  assert.ok(!util.BACKUP_RE.test('tim_db.json'));
  assert.ok(!util.BACKUP_RE.test('tim_db_local_20261008-083951.json'));
});

test('keeps today\'s latest and the previous day\'s last; never touches other files', () => {
  const names = [
    'tim_db.json', 'notes.json', 'tim_db_local_20261008-083951.json',
    'tim_db_backup_2026-09-30.json', 'tim_db_backup_2026-10-01.json', 'tim_db_backup_2026-10-02.json',
    'tim_db_backup_2026-10-07_0900.json', 'tim_db_backup_2026-10-07_1802.json',
    'tim_db_backup_2026-10-08_0930.json', 'tim_db_backup_2026-10-08_1036.json',
  ];
  const del = util.backupsToPrune(names);
  const kept = names.filter(n => !del.includes(n));
  assert.deepEqual(kept, ['tim_db.json', 'notes.json', 'tim_db_local_20261008-083951.json', 'tim_db_backup_2026-10-07_1802.json', 'tim_db_backup_2026-10-08_1036.json']);
});

test('previous = the last day that has a backup (days without one are skipped); same-day older name format is older', () => {
  assert.deepEqual(util.backupsToPrune(['tim_db_backup_2026-10-02.json', 'tim_db_backup_2026-10-08_0800.json']), []);
  assert.deepEqual(util.backupsToPrune(['tim_db_backup_2026-10-08.json', 'tim_db_backup_2026-10-08_0800.json', 'tim_db_backup_2026-10-02.json']),
    ['tim_db_backup_2026-10-08.json']);
  // one backup only, or none: nothing to delete
  assert.deepEqual(util.backupsToPrune(['tim_db_backup_2026-10-08_0800.json']), []);
  assert.deepEqual(util.backupsToPrune([]), []);
});

test('replacing today\'s backup: the earlier one of today goes, yesterday\'s stays', () => {
  const after = ['tim_db_backup_2026-10-07_1802.json', 'tim_db_backup_2026-10-08_0930.json', 'tim_db_backup_2026-10-08_1236.json'];
  assert.deepEqual(util.backupsToPrune(after), ['tim_db_backup_2026-10-08_0930.json']);
  // first backup of a new day: yesterday's becomes the previous one, the day before goes
  const nextDay = ['tim_db_backup_2026-10-07_1802.json', 'tim_db_backup_2026-10-08_1236.json', 'tim_db_backup_2026-10-09_0815.json'];
  assert.deepEqual(util.backupsToPrune(nextDay), ['tim_db_backup_2026-10-07_1802.json']);
});
