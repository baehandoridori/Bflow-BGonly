import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventTagIds, resolveEventTags, toggleEventTag } from '../src/components/calendar/eventTagPresentation.ts';

test('multiple tag selection preserves order and toggles only the clicked tag', () => {
  assert.deepEqual(toggleEventTag(['upload'], 'meeting'), ['upload', 'meeting']);
  assert.deepEqual(toggleEventTag(['upload', 'meeting'], 'upload'), ['meeting']);
  assert.deepEqual(toggleEventTag(['upload', 'meeting'], undefined), []);
});

test('explicit empty selection clears a legacy tag, otherwise legacy single tags remain visible', () => {
  assert.deepEqual(getEventTagIds({ tagId: 'upload' }), ['upload']);
  assert.deepEqual(getEventTagIds({ tagId: 'upload', tagIds: [] }), []);
  assert.deepEqual(getEventTagIds({ tagId: 'old', tagIds: ['meeting', 'upload', 'meeting'] }), ['meeting', 'upload']);
});

test('badges follow event selection order and retain each stored color, excluding deleted tags', () => {
  const tags = [{ id: 'upload', name: '업로드', color: '#e15d68' }, { id: 'meeting', name: '회의', color: '#44aa77' }];
  assert.deepEqual(resolveEventTags({ tagIds: ['meeting', 'deleted', 'upload'] }, tags), [tags[1], tags[0]]);
});
