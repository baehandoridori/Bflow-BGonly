import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('calendar:create validates members before creating a calendar', () => {
  const source = readFileSync('electron/calendarIpc.ts', 'utf8');
  const createStart = source.indexOf("ipcMain.handle('calendar:create'");
  const createEnd = source.indexOf("ipcMain.handle('calendar:update'", createStart);
  const createHandler = source.slice(createStart, createEnd);

  assert.match(source, /function normalizeCalendarMembers\(members: unknown, ownerId: string\)/);
  assert.match(source, /if \(!Array\.isArray\(members\)\) throw new Error/);
  assert.match(source, /typeof candidate\.user_id !== 'string'/);
  assert.match(source, /typeof candidate\.can_edit !== 'boolean'/);
  assert.ok(
    createHandler.indexOf('normalizeCalendarMembers(input.members, user.id)')
      < createHandler.indexOf('const created = await store.createCalendar'),
    'malformed members must be rejected before calendar creation',
  );
});
