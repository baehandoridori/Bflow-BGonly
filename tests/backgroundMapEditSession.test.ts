import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundMap } from '../src/features/backgrounds/types.ts';
import { beginMapGesture, previewMapGesture, finishMapGesture, cancelMapGesture }
  from '../src/features/backgrounds/mapEditSession.ts';
import { MAP_HISTORY_LIMIT, commitMapHistory, replaceMapHistoryValue, undoMapHistory, redoMapHistory }
  from '../src/features/backgrounds/mapEditSession.ts';
import type { MapHistory } from '../src/features/backgrounds/mapEditSession.ts';
const base: BackgroundMap = {
  id: '00000000-0000-4000-8000-000000000010', revision: 1,
  name: '교실', parentId: null, placeId: null, imageUrl: '', nodes: [],
};
test('multiple gesture previews make one undo entry and cancel restores initial', () => {
  let gesture = beginMapGesture(base);
  gesture = previewMapGesture(gesture, { ...base, name: '임시 1' });
  gesture = previewMapGesture(gesture, { ...base, name: '임시 2' });
  assert.deepEqual(cancelMapGesture(gesture), base);
  const result = finishMapGesture(gesture);
  assert.deepEqual(result.historyEntry, base);
  assert.equal(result.value.name, '임시 2');
  assert.equal(finishMapGesture(beginMapGesture(base)).historyEntry, null);
  assert.equal(base.name, '교실');
});

const camera = { id: 'camera', type: 'camera' as const, name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false };
const named = (name: string): BackgroundMap => ({ ...base, name });

test('a gesture keeps the initial snapshot by reference and rejects another map', () => {
  const initial: BackgroundMap = { ...base, nodes: [camera] }, frozen = JSON.stringify(initial);
  const started = beginMapGesture(initial);
  assert.equal(started.initial, initial); assert.equal(started.preview, initial);
  const moved: BackgroundMap = { ...initial, nodes: [{ ...camera, x: 620 }] };
  const previewed = previewMapGesture(started, moved);
  assert.notEqual(previewed, started); assert.equal(started.preview, initial);
  assert.equal(previewed.initial, initial); assert.equal(previewed.preview, moved);
  assert.equal(cancelMapGesture(previewed), initial);
  const other: BackgroundMap = { ...initial, id: '00000000-0000-4000-8000-000000000011' };
  assert.throws(() => previewMapGesture(previewed, other));
  assert.throws(() => previewMapGesture(started, other));
  const finished = finishMapGesture(previewed);
  assert.equal(finished.value, moved); assert.equal(finished.historyEntry, initial);
  assert.equal(JSON.stringify(initial), frozen); assert.equal(initial.nodes[0], camera);
});

test('a gesture that ends where it started leaves no undo entry', () => {
  const initial: BackgroundMap = { ...base, nodes: [camera] };
  let gesture = previewMapGesture(beginMapGesture(initial), { ...initial, nodes: [{ ...camera, x: 620 }] });
  // Dragging back onto the start gives an equal map in a new object.
  gesture = previewMapGesture(gesture, { ...initial, nodes: [{ ...camera, viewIds: [] }] });
  const finished = finishMapGesture(gesture);
  assert.equal(finished.historyEntry, null); assert.equal(finished.value, initial);
  // A value that only differs in an optional vertical field still counts as a change.
  const raised = finishMapGesture(previewMapGesture(beginMapGesture(initial), { ...initial, nodes: [{ ...camera, elevation: 120 }] }));
  assert.equal(raised.historyEntry, initial);
  const reordered = finishMapGesture(previewMapGesture(beginMapGesture({ ...initial, nodes: [camera, { ...camera, id: 'second' }] }), { ...initial, nodes: [{ ...camera, id: 'second' }, camera] }));
  assert.notEqual(reordered.historyEntry, null);
});

test('history commits one entry, clears redo and keeps the newest fifty steps', () => {
  assert.equal(MAP_HISTORY_LIMIT, 50);
  const first = named('0'), start: MapHistory = { value: first, past: [], future: [] };
  const committed = commitMapHistory(start, named('1'));
  assert.equal(committed.past.length, 1); assert.equal(committed.past[0], first); assert.equal(committed.value.name, '1'); assert.equal(committed.future.length, 0);
  assert.equal(start.value, first); assert.equal(start.past.length, 0); assert.equal(start.future.length, 0);

  // A gesture commits its initial snapshot, not the last preview already shown as the value.
  const previewed = replaceMapHistoryValue(committed, named('preview'));
  assert.equal(previewed.past, committed.past); assert.equal(previewed.future, committed.future); assert.equal(previewed.value.name, 'preview');
  assert.equal(committed.value.name, '1');
  assert.equal(replaceMapHistoryValue(committed, committed.value), committed);
  const gestureEntry = committed.value, finished = commitMapHistory(previewed, named('2'), gestureEntry);
  assert.deepEqual(finished.past.map(map => map.name), ['0', '1']); assert.equal(finished.past[1], gestureEntry);

  let history = start;
  for (let step = 1; step <= 60; step++) history = commitMapHistory(history, named(String(step)));
  assert.equal(history.past.length, 50); assert.equal(history.value.name, '60');
  assert.equal(history.past[0].name, '10'); assert.equal(history.past[49].name, '59');

  const undone = undoMapHistory(undoMapHistory(history));
  assert.equal(undone.future.length, 2);
  const branched = commitMapHistory(undone, named('branch'));
  assert.equal(branched.future.length, 0); assert.equal(branched.past[branched.past.length - 1].name, '58');
  assert.equal(branched.past.length, 49); assert.equal(undone.future.length, 2);
});

test('undo and redo mirror each other and return the same history when exhausted', () => {
  const start: MapHistory = { value: named('0'), past: [], future: [] };
  assert.equal(undoMapHistory(start), start); assert.equal(redoMapHistory(start), start);
  const a = commitMapHistory(start, named('1')), b = commitMapHistory(a, named('2')), c = commitMapHistory(b, named('3'));
  const back1 = undoMapHistory(c), back2 = undoMapHistory(back1), back3 = undoMapHistory(back2);
  assert.deepEqual([back1.value.name, back2.value.name, back3.value.name], ['2', '1', '0']);
  assert.equal(back1.value, b.value); assert.equal(back3.value, start.value);
  assert.equal(back3.past.length, 0); assert.deepEqual(back3.future.map(map => map.name), ['3', '2', '1']);
  assert.equal(undoMapHistory(back3), back3);
  const forward1 = redoMapHistory(back3), forward2 = redoMapHistory(forward1), forward3 = redoMapHistory(forward2);
  assert.deepEqual(forward1, back2); assert.deepEqual(forward2, back1); assert.deepEqual(forward3, c);
  assert.equal(forward3.value, c.value); assert.equal(redoMapHistory(forward3), forward3);
  assert.deepEqual(c.past.map(map => map.name), ['0', '1', '2']); assert.equal(c.future.length, 0);
});

test('history helpers keep the other fields of an editor draft', () => {
  const draft = { value: named('0'), past: [] as BackgroundMap[], future: [] as BackgroundMap[], baseRevision: 7 as number | null };
  const committed = commitMapHistory(draft, named('1'));
  assert.equal(committed.baseRevision, 7);
  assert.equal(replaceMapHistoryValue(committed, named('2')).baseRevision, 7);
  assert.equal(undoMapHistory(committed).baseRevision, 7);
  assert.equal(redoMapHistory(undoMapHistory(committed)).baseRevision, 7);
});
