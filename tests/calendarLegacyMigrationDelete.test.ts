import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('deleting a migrated personal-calendar event also clears its legacy row first', () => {
  const source = readFileSync('src/services/calendarService.ts', 'utf8');
  const deleteStart = source.indexOf('export async function deleteEvent');
  const legacyPrivateStart = source.indexOf('// ── 비공개 이벤트 분기', deleteStart);
  const bflowDelete = source.slice(deleteStart, legacyPrivateStart);

  assert.match(source, /let legacyPrivateEventIds = new Set<string>\(\)/);
  assert.match(source, /loadedLegacyPrivateEventIds\.add\(row\.id\)/);
  assert.match(source, /legacyPrivateEventIds = loadedLegacyPrivateEventIds/);
  assert.match(bflowDelete, /legacyPrivateEventIds\.has\(actualId\)/);
  assert.ok(
    bflowDelete.indexOf('await window.electronAPI.supabaseDeletePrivateEvent(actualId)')
      < bflowDelete.indexOf('await window.electronAPI.calendarEventDelete(actualId)'),
    'legacy row must be removed before the copied B flow row',
  );
  assert.ok(
    bflowDelete.indexOf('legacyPrivateEventIds.delete(actualId)')
      < bflowDelete.indexOf('await window.electronAPI.calendarEventDelete(actualId)'),
    'a successful legacy cleanup must not be retried after a later B flow delete failure',
  );
});
