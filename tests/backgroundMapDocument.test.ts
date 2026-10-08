import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
import { canRedoMap, canUndoMap, createMapDocument, createMapDocumentStore, fieldEditStartMap, gestureStartMap, isMapGestureActive, mapDraft, mapDraftChanged, mapViewport,
  reduceMapDocument, revealPlanPoint, zoomMapViewport, MAP_ZOOM_LIMITS, MAP_LABEL_SCALE_LIMITS, MAP_FIT_MARGIN, mapScreenScale, zoomMapViewportAt, wheelZoomFactor, fitMapViewport } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentAction, MapDocumentState } from '../src/features/backgrounds/mapDocument.ts';
import { MAP_HISTORY_LIMIT } from '../src/features/backgrounds/mapEditSession.ts';
import { effectiveMaps, saveMapChanges } from '../src/features/backgrounds/mapWorkflow.ts';
import { emptyBackgroundSnapshot } from '../src/features/backgrounds/domain.ts';
import { addMapCamera, transformMapSpace } from '../src/features/backgrounds/mapGeometry.ts';
import { DEFAULT_MAP_CAMERA_POSE, mapPlanBounds } from '../src/features/backgrounds/mapSpatial.ts';

const A = '00000000-0000-4000-8000-00000000000a', B = '00000000-0000-4000-8000-00000000000b';
const camera: BackgroundCamera = { id: '00000000-0000-4000-8000-0000000000c1', type: 'camera', name: '카메라 1', x: 500, y: 340, spaceId: null, angle: 0, fov: 60, viewIds: [], locked: false, elevation: 120, pitch: -35 };
const mapA: BackgroundMap = { id: A, revision: 3, name: '교실', parentId: null, placeId: null, imageUrl: '', nodes: [camera] };
const mapB: BackgroundMap = { id: B, revision: 7, name: '복도', parentId: null, placeId: null, imageUrl: '', nodes: [] };
const run = (state: MapDocumentState, ...actions: MapDocumentAction[]) => actions.reduce(reduceMapDocument, state);
const moved = (map: BackgroundMap, x: number): BackgroundMap => ({ ...map, nodes: map.nodes.map(node => node.id === camera.id ? { ...node, x } : node) });
const named = (map: BackgroundMap, name: string): BackgroundMap => ({ ...map, name });
/** Both maps open for editing. */
const opened = () => run(createMapDocument(), { type: 'begin-editing', map: mapA }, { type: 'begin-editing', map: mapB });
const valueOf = (state: MapDocumentState, id = A) => mapDraft(state, id)!.value;

test('begin editing opens a detached draft on the saved revision and never replaces an open one', () => {
  const state = run(createMapDocument(), { type: 'begin-editing', map: mapA });
  const draft = mapDraft(state, A)!;
  assert.deepEqual(draft.value, mapA); assert.notEqual(draft.value, mapA); assert.notEqual(draft.value.nodes[0], camera);
  assert.equal(draft.baseRevision, 3); assert.deepEqual(draft.past, []); assert.deepEqual(draft.future, []);
  assert.equal(mapDraftChanged(draft), false); assert.equal(mapDraft(state, B), undefined);
  assert.deepEqual(Object.keys(state.drafts), [A]);

  const edited = run(state, { type: 'update', map: named(draft.value, '교실 수정') });
  assert.equal(run(edited, { type: 'begin-editing', map: mapA }), edited);
  assert.equal(valueOf(edited).name, '교실 수정'); assert.equal(mapDraftChanged(mapDraft(edited, A)), true);
});

test('entering a newly created map replaces any draft of it and starts a clean history', () => {
  const stale = run(createMapDocument(), { type: 'begin-editing', map: mapA }, { type: 'update', map: named(mapA, '옛 초안') });
  const created = { ...mapA, revision: 1, nodes: [] };
  const state = run(stale, { type: 'enter-new-map', map: created });
  const draft = mapDraft(state, A)!;
  assert.deepEqual(draft.value, created); assert.notEqual(draft.value, created);
  assert.equal(draft.baseRevision, 1); assert.equal(draft.past.length, 0); assert.equal(mapDraftChanged(draft), false);
  // A gesture on the replaced draft ends with it, so a late finish cannot write the old map back.
  const dragging = run(stale, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: named(mapA, '끌던 중') });
  const entered = run(dragging, { type: 'enter-new-map', map: created });
  assert.equal(entered.gesture, null); assert.deepEqual(mapDraft(run(entered, { type: 'gesture-finish' }), A)!.value, created);
  assert.notEqual(run(dragging, { type: 'enter-new-map', map: { ...mapB, revision: 1 } }).gesture, null);
  // A map that only exists locally has no saved revision and always counts as changed.
  assert.equal(mapDraftChanged({ value: created, baseRevision: null, past: [], future: [] }), true);
  assert.equal(mapDraftChanged(undefined), false);
});

test('discarding and dropping saved drafts remove only the named maps', () => {
  const state = run(opened(), { type: 'update', map: named(mapB, '복도 수정') });
  const draftB = mapDraft(state, B);
  const discarded = run(state, { type: 'discard', mapId: A });
  assert.equal(mapDraft(discarded, A), undefined); assert.equal(mapDraft(discarded, B), draftB);
  assert.equal(run(discarded, { type: 'discard', mapId: A }), discarded);
  const dropped = run(state, { type: 'drop-drafts', mapIds: [A, B, 'unknown'] });
  assert.deepEqual(dropped.drafts, {});
  assert.equal(run(dropped, { type: 'drop-drafts', mapIds: [A] }), dropped);
  // Dropping the draft under an active gesture ends that gesture; another map's gesture goes on.
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 600) });
  assert.equal(run(dragging, { type: 'drop-drafts', mapIds: [A] }).gesture, null);
  const kept = run(dragging, { type: 'discard', mapId: B });
  assert.equal(kept.gesture, dragging.gesture); assert.equal(mapDraft(kept, A), mapDraft(dragging, A));
});

test('an update adds one undo step, clears redo and leaves other drafts untouched', () => {
  const state = opened(), before = valueOf(state), draftB = mapDraft(state, B);
  const next = named(before, '1');
  const updated = run(state, { type: 'update', map: next });
  const draft = mapDraft(updated, A)!;
  assert.equal(draft.value, next); assert.deepEqual(draft.past, [before]); assert.equal(draft.past[0], before); assert.deepEqual(draft.future, []);
  assert.equal(draft.baseRevision, 3); assert.equal(mapDraft(updated, B), draftB);
  assert.equal(canUndoMap(updated, A), true); assert.equal(canRedoMap(updated, A), false); assert.equal(canUndoMap(updated, B), false);

  // The same value, a map without a draft and an update without history add no step.
  assert.equal(run(updated, { type: 'update', map: next }), updated);
  assert.equal(run(updated, { type: 'update', map: { ...mapA, id: 'no-draft' } }), updated);
  const replaced = run(updated, { type: 'update', map: named(next, '바꿔치기'), history: false });
  assert.equal(valueOf(replaced).name, '바꿔치기'); assert.equal(mapDraft(replaced, A)!.past, draft.past); assert.equal(mapDraft(replaced, A)!.future, draft.future);

  const undone = run(updated, { type: 'undo', mapId: A });
  assert.equal(valueOf(undone), before); assert.equal(canRedoMap(undone, A), true);
  const branched = run(undone, { type: 'update', map: named(before, '2') });
  assert.deepEqual(mapDraft(branched, A)!.future, []); assert.deepEqual(mapDraft(branched, A)!.past, [before]);
  assert.equal(run(updated, { type: 'undo', mapId: A }, { type: 'redo', mapId: A }).drafts[A].value, next);
  // Undo and redo with nothing left, or for a map without a draft, change nothing.
  assert.equal(run(state, { type: 'undo', mapId: A }), state); assert.equal(run(state, { type: 'redo', mapId: A }), state);
  assert.equal(run(state, { type: 'undo', mapId: 'no-draft' }), state);
});

test('the undo history of a draft keeps the newest fifty steps', () => {
  let state = opened();
  for (let step = 1; step <= MAP_HISTORY_LIMIT + 10; step++) state = run(state, { type: 'update', map: named(valueOf(state), String(step)) });
  const draft = mapDraft(state, A)!;
  assert.equal(draft.past.length, MAP_HISTORY_LIMIT); assert.equal(draft.value.name, '60'); assert.equal(draft.past[0].name, '10');
});

test('typing in one field is one undo step', () => {
  const state = opened(), before = valueOf(state), key = `${camera.id}:elevation`;
  const typed = run(state, { type: 'update', map: moved(before, 1), coalesceKey: key }, { type: 'update', map: moved(before, 12), coalesceKey: key },
    { type: 'update', map: moved(before, 120), coalesceKey: key });
  const draft = mapDraft(typed, A)!;
  assert.deepEqual(draft.past, [before]); assert.equal(draft.past[0], before); assert.equal((draft.value.nodes[0] as BackgroundCamera).x, 120);
  assert.deepEqual(typed.coalescing, { mapId: A, key });
  const undone = run(typed, { type: 'undo', mapId: A });
  assert.equal(valueOf(undone), before); assert.equal(undone.coalescing, null);
  assert.equal((valueOf(run(undone, { type: 'redo', mapId: A })).nodes[0] as BackgroundCamera).x, 120);
  // A repeat of the same value inside the field edit neither adds a step nor ends the edit.
  assert.equal(run(typed, { type: 'update', map: draft.value, coalesceKey: key }), typed);
});

test('a value typed digit by digit is applied to the map the field edit began with', () => {
  const room: BackgroundSpace = { id: '00000000-0000-4000-8000-0000000000d1', type: 'space', name: '교실', placeId: null, childMapId: null, x: 100, y: 100, width: 400, height: 260, rotation: 0, shape: 'rect', points: [], locked: false };
  const chair: BackgroundSymbol = { id: '00000000-0000-4000-8000-0000000000d2', type: 'symbol', name: '의자', symbol: 'chair', spaceId: room.id, x: 300, y: 200, width: 60, height: 60, rotation: 0, locked: false, hinge: 'left', swing: 'inward' };
  const door: BackgroundSymbol = { ...chair, id: '00000000-0000-4000-8000-0000000000d3', name: '문', symbol: 'door', x: 120, y: 120, width: 100, height: 100 };
  const source: BackgroundMap = { ...mapA, nodes: [room, chair, door] }, key = `${room.id}:width`;
  const widths = (state: MapDocumentState) => valueOf(state).nodes.map(node => (node as BackgroundSpace | BackgroundSymbol).width);
  /** One keystroke of the editor's size field: the value goes onto the map the edit began with. */
  const type = (state: MapDocumentState, width: number, field = key): MapDocumentState => {
    const base = fieldEditStartMap(state, A, field) ?? valueOf(state);
    return run(state, { type: 'update', map: transformMapSpace(base, { ...(base.nodes[0] as BackgroundSpace), width }), coalesceKey: field });
  };
  const start = run(createMapDocument(), { type: 'begin-editing', map: source });
  assert.equal(fieldEditStartMap(start, A, key), undefined, 'no field edit is running');
  const typed = [15, 150].reduce((state, width) => type(state, width), start);
  assert.equal(fieldEditStartMap(typed, A, key), valueOf(start), 'the map before the first keystroke');
  assert.deepEqual(widths(typed), [150, 22.5, 37.5], 'the same as entering 150 in one step');
  assert.deepEqual(widths(type(start, 150)), [150, 22.5, 37.5]);
  assert.equal(mapDraft(typed, A)!.past.length, 1);
  assert.deepEqual(widths(run(typed, { type: 'undo', mapId: A })), [400, 60, 100]);
  // Retyping the size it already has changes nothing, although "40" went through on the way.
  assert.deepEqual(widths([40, 400].reduce((state, width) => type(state, width), start)), [400, 60, 100]);
  // Another field, another map or a finished edit has no start map of its own.
  assert.equal(fieldEditStartMap(typed, A, `${room.id}:height`), undefined);
  assert.equal(fieldEditStartMap(typed, B, key), undefined);
  const both = type(run(start, { type: 'begin-editing', map: mapB }, { type: 'update', map: named(mapB, '복도 수정') }), 150);
  assert.equal(mapDraft(both, B)!.past.length, 1);
  assert.equal(fieldEditStartMap(both, B, key), undefined, 'the other map has history of its own, but no field edit');
  assert.equal(fieldEditStartMap(both, A, key), valueOf(start));
  assert.equal(fieldEditStartMap(run(typed, { type: 'end-coalescing' }), A, key), undefined);
  assert.equal(fieldEditStartMap(run(typed, { type: 'select', mapId: A, id: chair.id }), A, key), undefined);
  // The next edit of the same field starts from the result of the previous one.
  const second = type(run(typed, { type: 'end-coalescing' }), 300);
  assert.equal(fieldEditStartMap(second, A, key), valueOf(typed));
  assert.deepEqual(widths(second), [300, 45, 75]);
  assert.equal(mapDraft(second, A)!.past.length, 2);
});

test('a field edit ends with any other update, undo, redo, gesture, selection change or reset', () => {
  const key = 'field', start = run(opened(), { type: 'update', map: moved(mapA, 1), coalesceKey: key });
  const steps = (state: MapDocumentState) => mapDraft(state, A)!.past.length;
  const again = (state: MapDocumentState) => run(state, { type: 'update', map: moved(valueOf(state), 77), coalesceKey: key });
  assert.equal(steps(start), 1); assert.equal(steps(again(start)), 1);

  assert.equal(steps(again(run(start, { type: 'update', map: moved(valueOf(start), 2), coalesceKey: 'other-field' }))), 3);
  assert.equal(steps(again(run(start, { type: 'update', map: moved(valueOf(start), 2) }))), 3);
  assert.equal(steps(again(run(start, { type: 'update', map: moved(valueOf(start), 2), history: false }))), 2);
  assert.equal(steps(again(run(start, { type: 'update', map: named(mapB, '다른 도면'), coalesceKey: key }))), 2);
  assert.equal(steps(again(run(start, { type: 'end-coalescing' }))), 2);
  assert.equal(steps(again(run(start, { type: 'select', mapId: A, id: camera.id }))), 2);
  assert.equal(steps(again(run(start, { type: 'select', mapId: B, id: 'anything' }))), 2);
  assert.equal(steps(again(run(start, { type: 'gesture-begin', mapId: A }, { type: 'gesture-cancel' }))), 2);
  assert.equal(steps(again(run(start, { type: 'gesture-begin', mapId: B }, { type: 'gesture-finish' }))), 2);
  assert.equal(steps(again(run(start, { type: 'undo', mapId: A }, { type: 'redo', mapId: A }))), 2);
  assert.equal(steps(again(run(start, { type: 'redo', mapId: A }))), 2);
  assert.equal(steps(again(run(start, { type: 'discard', mapId: B }))), 2);
  // Moving the plan view or keeping the same selection is not a document edit and keeps the field edit open.
  assert.equal(steps(again(run(start, { type: 'set-viewport', mapId: A, viewport: { x: 40 } }))), 1);
  assert.equal(steps(again(run(start, { type: 'select', mapId: A, id: null }))), 1);
  assert.equal(run(createMapDocument(), { type: 'end-coalescing' }).coalescing, null);
});

test('a gesture previews without touching history and finishes as exactly one undo step', () => {
  const state = run(opened(), { type: 'update', map: named(mapA, '이전 편집') });
  const before = mapDraft(state, A)!, initial = before.value, draftB = mapDraft(state, B), draftsBefore = state.drafts;
  const begun = run(state, { type: 'gesture-begin', mapId: A });
  assert.equal(isMapGestureActive(begun), true); assert.equal(begun.drafts, draftsBefore);
  assert.equal(begun.gesture!.initial, initial); assert.equal(gestureStartMap(begun, A), initial); assert.equal(gestureStartMap(begun, B), undefined);

  let dragging = begun;
  for (const x of [510, 560, 640]) {
    dragging = run(dragging, { type: 'gesture-preview', map: moved(initial, x) });
    const draft = mapDraft(dragging, A)!;
    assert.equal((draft.value.nodes[0] as BackgroundCamera).x, x);
    assert.equal(draft.past, before.past); assert.equal(draft.future, before.future); assert.equal(draft.baseRevision, 3);
    assert.equal(gestureStartMap(dragging, A), initial); assert.equal(mapDraft(dragging, B), draftB);
  }
  const last = valueOf(dragging);
  const finished = run(dragging, { type: 'gesture-finish' });
  const draft = mapDraft(finished, A)!;
  assert.equal(isMapGestureActive(finished), false); assert.equal(gestureStartMap(finished, A), undefined);
  assert.equal(draft.value, last); assert.equal(draft.past.length, before.past.length + 1); assert.equal(draft.past[draft.past.length - 1], initial);
  assert.deepEqual(draft.future, []); assert.equal(mapDraft(finished, B), draftB);
  // One undo returns to the map at gesture start, with the tilt and height of the camera as they were.
  const undone = run(finished, { type: 'undo', mapId: A });
  assert.equal(valueOf(undone), initial); assert.deepEqual(valueOf(undone).nodes[0], camera);
  assert.equal(valueOf(run(undone, { type: 'redo', mapId: A })), last);
});

test('a gesture that changed nothing leaves no undo step', () => {
  const state = opened(), before = mapDraft(state, A)!;
  const untouched = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-finish' });
  assert.equal(mapDraft(untouched, A), before); assert.equal(untouched.gesture, null);
  // Dragged away and back: an equal map in a new object is still no change, and the start object is kept.
  const back = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(before.value, 620) },
    { type: 'gesture-preview', map: moved(before.value, 500) }, { type: 'gesture-finish' });
  assert.equal(mapDraft(back, A)!.past.length, 0); assert.equal(valueOf(back), before.value); assert.equal(mapDraftChanged(mapDraft(back, A)), false);
});

test('cancelling a gesture restores the map at gesture start', () => {
  const state = run(opened(), { type: 'update', map: named(mapA, '이전 편집') }), before = mapDraft(state, A)!;
  const cancelled = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(before.value, 900) }, { type: 'gesture-cancel' });
  assert.equal(cancelled.gesture, null); assert.equal(valueOf(cancelled), before.value);
  assert.equal(mapDraft(cancelled, A)!.past, before.past); assert.equal(mapDraft(cancelled, A)!.future, before.future);
  // Late calls of a surface that did not notice the cancel are harmless.
  assert.equal(run(cancelled, { type: 'gesture-preview', map: moved(before.value, 950) }), cancelled);
  assert.equal(run(cancelled, { type: 'gesture-finish' }), cancelled); assert.equal(run(cancelled, { type: 'gesture-cancel' }), cancelled);
});

test('undo, redo and other updates of the map wait while a gesture is active', () => {
  const state = run(opened(), { type: 'update', map: named(mapA, '1') }, { type: 'update', map: named(mapA, '2') }, { type: 'undo', mapId: A });
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 700) });
  assert.equal(canUndoMap(state, A), true); assert.equal(canRedoMap(state, A), true);
  assert.equal(canUndoMap(dragging, A), false); assert.equal(canRedoMap(dragging, A), false);
  assert.equal(run(dragging, { type: 'undo', mapId: A }), dragging); assert.equal(run(dragging, { type: 'redo', mapId: A }), dragging);
  assert.equal(run(dragging, { type: 'undo', mapId: B }), dragging);
  assert.equal(run(dragging, { type: 'update', map: named(valueOf(dragging), '끼어들기') }), dragging);
  // Another map is not the gesture's map: its draft can still be edited and stays out of the gesture.
  const other = run(dragging, { type: 'update', map: named(mapB, '복도 수정') });
  assert.equal(valueOf(other, B).name, '복도 수정'); assert.equal(mapDraft(other, A), mapDraft(dragging, A)); assert.equal(other.gesture, dragging.gesture);
});

test('only one gesture runs at a time and a preview for another map is ignored', () => {
  const state = opened(), initial = valueOf(state);
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(initial, 640) });
  assert.equal(run(dragging, { type: 'gesture-begin', mapId: A }), dragging);
  assert.equal(run(dragging, { type: 'gesture-begin', mapId: B }), dragging);
  assert.equal(dragging.gesture!.initial, initial);
  assert.equal(run(dragging, { type: 'gesture-preview', map: named(mapB, '다른 도면') }), dragging);
  assert.equal(run(dragging, { type: 'gesture-preview', map: { ...moved(initial, 1), id: 'unknown' } }), dragging);
  assert.equal(valueOf(dragging, B), mapDraft(state, B)!.value);
  // A map without a draft cannot start a gesture, and a preview needs a gesture.
  const viewer = createMapDocument();
  assert.equal(run(viewer, { type: 'gesture-begin', mapId: A }), viewer);
  assert.equal(run(state, { type: 'gesture-preview', map: moved(initial, 640) }), state);
  assert.equal(run(state, { type: 'gesture-finish' }), state); assert.equal(run(state, { type: 'gesture-cancel' }), state);
});

test('selection and plan view are kept per map and survive preview, finish, cancel and undo', () => {
  const state = run(opened(), { type: 'select', mapId: A, id: camera.id }, { type: 'set-viewport', mapId: A, viewport: { x: 30, y: -20, zoom: 2 } },
    { type: 'select', mapId: B, id: 'space-in-b' });
  assert.deepEqual(mapViewport(state, A), { x: 30, y: -20, zoom: 2, selectedId: camera.id });
  assert.deepEqual(mapViewport(state, B), { x: 0, y: 0, zoom: 1, selectedId: 'space-in-b' });
  assert.deepEqual(mapViewport(state, 'never-opened'), { x: 0, y: 0, zoom: 1, selectedId: null }); assert.deepEqual(mapViewport(state, null), mapViewport(state, undefined));
  const selection = (next: MapDocumentState) => [mapViewport(next, A).selectedId, mapViewport(next, B).selectedId];
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 640) });
  const finished = run(dragging, { type: 'gesture-finish' });
  for (const next of [dragging, finished, run(dragging, { type: 'gesture-cancel' }), run(finished, { type: 'undo', mapId: A }),
    run(finished, { type: 'undo', mapId: A }, { type: 'redo', mapId: A }), run(finished, { type: 'drop-drafts', mapIds: [A, B] })]) {
    assert.deepEqual(selection(next), [camera.id, 'space-in-b']); assert.equal(next.viewports, state.viewports);
  }
  // Viewers have no draft and still select and move the view; neither is an edit.
  const viewer = run(createMapDocument(), { type: 'select', mapId: A, id: camera.id }, { type: 'set-viewport', mapId: A, viewport: { zoom: 0.5 } });
  assert.deepEqual(mapViewport(viewer, A), { x: 0, y: 0, zoom: 0.5, selectedId: camera.id }); assert.deepEqual(viewer.drafts, {});
  assert.equal(run(viewer, { type: 'select', mapId: A, id: camera.id }), viewer);
  assert.equal(run(viewer, { type: 'set-viewport', mapId: A, viewport: { zoom: 0.5 } }), viewer);
  assert.equal(run(viewer, { type: 'set-viewport', mapId: A, viewport: { x: Number.NaN } }), viewer);
  // The selection may change while a gesture runs without disturbing it.
  const reselected = run(dragging, { type: 'select', mapId: A, id: null });
  assert.equal(reselected.gesture, dragging.gesture); assert.equal(mapDraft(reselected, A), mapDraft(dragging, A));
});

test('the display mode is not document state and switching it is not an action', () => {
  const state = run(opened(), { type: 'update', map: named(mapA, '편집') }, { type: 'select', mapId: A, id: camera.id });
  assert.deepEqual(Object.keys(createMapDocument()).sort(), ['coalescing', 'drafts', 'gesture', 'viewports']);
  let next = state;
  for (let index = 0; index < 20; index++) next = reduceMapDocument(next, { type: 'set-mode', mode: index % 2 ? 'plan' : '3d' } as unknown as MapDocumentAction);
  assert.equal(next, state);
  // What a mode switch does do is cancel a gesture in progress; the finished edits and the selection stay.
  const switched = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 640) }, { type: 'gesture-cancel' });
  assert.equal(valueOf(switched), valueOf(state)); assert.equal(mapDraft(switched, A)!.past, mapDraft(state, A)!.past);
  assert.equal(mapDraft(switched, A)!.future, mapDraft(state, A)!.future); assert.equal(switched.viewports, state.viewports);
  assert.equal(mapDraftChanged(mapDraft(switched, A)), true); assert.equal(mapDraft(switched, A)!.past.length, 1);
});

test('document drafts feed the unchanged save workflow', () => {
  const snapshot = { ...emptyBackgroundSnapshot(true), maps: [mapA, mapB] };
  const state = run(opened(), { type: 'update', map: named(mapA, '교실 수정') });
  assert.deepEqual(effectiveMaps(snapshot, state.drafts).map(map => map.name), ['교실 수정', '복도']);
  const command = saveMapChanges(snapshot, state.drafts, [valueOf(state)]);
  assert.deepEqual(command.maps.map(item => [item.entity.name, item.expectedRevision]), [['교실 수정', 3]]);
  // A preview is never what gets saved once the gesture was cancelled before the save.
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 640) });
  const settled = run(dragging, { type: 'gesture-cancel' });
  assert.equal((saveMapChanges(snapshot, settled.drafts, [valueOf(settled)]).maps[0].entity.nodes[0] as BackgroundCamera).x, 500);
  assert.deepEqual(run(settled, { type: 'drop-drafts', mapIds: command.maps.map(item => item.entity.id) }).drafts, { [B]: mapDraft(state, B) });
});

test('three cameras added from different views share the fixed spot as three undo steps', () => {
  let state = run(createMapDocument(), { type: 'begin-editing', map: { ...mapA, nodes: [] } });
  const ids = ['00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d3'];
  const views = [{ x: 0, y: 0, zoom: 1 }, { x: 4000, y: -900, zoom: 4 }, { x: -300, y: 200, zoom: 0.25 }];
  ids.forEach((id, index) => {
    state = run(state, { type: 'set-viewport', mapId: A, viewport: views[index] }, { type: 'select', mapId: A, id: ids[index - 1] ?? null });
    const added = addMapCamera(valueOf(state), id);
    state = run(state, { type: 'update', map: added.map }, { type: 'select', mapId: A, id: added.camera.id });
    assert.equal(mapViewport(state, A).selectedId, id);
  });
  const cameras = valueOf(state).nodes as BackgroundCamera[];
  assert.deepEqual(cameras.map(node => node.id), ids);
  for (const node of cameras) assert.deepEqual([node.x, node.y, node.elevation], [DEFAULT_MAP_CAMERA_POSE.x, DEFAULT_MAP_CAMERA_POSE.y, DEFAULT_MAP_CAMERA_POSE.elevation]);
  assert.equal(mapDraft(state, A)!.past.length, 3);
  assert.equal(valueOf(run(state, { type: 'undo', mapId: A })).nodes.length, 2);
});

test('the plan view pans to a point only when it is out of sight and never zooms', () => {
  const home = { x: 0, y: 0, zoom: 1, selectedId: 'kept' }, spawn = { x: DEFAULT_MAP_CAMERA_POSE.x, y: DEFAULT_MAP_CAMERA_POSE.y };
  assert.equal(revealPlanPoint(home, spawn), home); assert.equal(revealPlanPoint(home, spawn, 24), home);
  assert.equal(revealPlanPoint(home, { x: 0, y: 0 }), home); assert.equal(revealPlanPoint(home, { x: 1000, y: 680 }), home);
  // Zoomed in on a corner: the spawn point is outside the 250 x 170 box, so the box is centred on it.
  const corner = { x: 0, y: 0, zoom: 4, selectedId: 'kept' };
  assert.deepEqual(revealPlanPoint(corner, spawn), { x: 375, y: 255, zoom: 4, selectedId: 'kept' });
  assert.deepEqual(revealPlanPoint({ x: 2000, y: 2000, zoom: 0.5, selectedId: null }, spawn), { x: -500, y: -340, zoom: 0.5, selectedId: null });
  const near = { x: 490, y: 0, zoom: 1, selectedId: null };
  assert.equal(revealPlanPoint(near, spawn), near); assert.deepEqual(revealPlanPoint(near, spawn, 24), { x: 0, y: 0, zoom: 1, selectedId: null });
  assert.equal(revealPlanPoint(home, { x: Number.NaN, y: 0 }), home);
  const centred = revealPlanPoint(corner, spawn);
  assert.equal(revealPlanPoint(centred, spawn, 24), centred);
});

test('zooming keeps the centre of the plan view and stays inside the limits', () => {
  const home = { x: 0, y: 0, zoom: 1, selectedId: 'kept' };
  assert.deepEqual(zoomMapViewport(home, 2), { x: 250, y: 170, zoom: 2, selectedId: 'kept' });
  assert.deepEqual(zoomMapViewport(zoomMapViewport(home, 2), 0.5), home);
  assert.equal(zoomMapViewport(home, 100).zoom, 4); assert.equal(zoomMapViewport(home, 0.001).zoom, 0.1);
  const widest = zoomMapViewport(home, 0.001);
  assert.equal(zoomMapViewport(widest, 0.5), widest);
});

const near = (actual: number, expected: number, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const room = (x: number, y: number, width: number, height: number): BackgroundSpace =>
  ({ id: '00000000-0000-4000-8000-0000000000e1', type: 'space', name: '새 공간', placeId: null, childMapId: null, x, y, width, height, rotation: 0, shape: 'rect', points: [], locked: false });
const mapOf = (...nodes: BackgroundMap['nodes']): BackgroundMap => ({ ...mapA, nodes });

test('zooming at a plan point keeps that point at its place on screen', () => {
  const home = { x: 0, y: 0, zoom: 1, selectedId: 'kept' };
  assert.deepEqual(zoomMapViewportAt(home, 2, { x: 500, y: 340 }), { x: 250, y: 170, zoom: 2, selectedId: 'kept' });
  assert.deepEqual(zoomMapViewportAt(home, 2, { x: 500, y: 340 }), zoomMapViewport(home, 2));
  assert.deepEqual(zoomMapViewportAt(home, 2, { x: 0, y: 0 }), { x: 0, y: 0, zoom: 2, selectedId: 'kept' });
  assert.deepEqual(zoomMapViewportAt(home, 2, { x: 1000, y: 680 }), { x: 500, y: 340, zoom: 2, selectedId: 'kept' });
  assert.deepEqual(zoomMapViewportAt(home, 0.5, { x: 250, y: 170 }), { x: -250, y: -170, zoom: 0.5, selectedId: 'kept' });
  // The anchor stays as many zoomed units from the corner of the view as it was.
  const panned = { x: -120.5, y: 64.25, zoom: 1.6, selectedId: null };
  for (const anchor of [{ x: 37.5, y: 412.25 }, { x: -800, y: 90 }, { x: 4321.125, y: -77.7 }]) for (const factor of [1.25, 0.37]) {
    const next = zoomMapViewportAt(panned, factor, anchor);
    near(next.zoom, 1.6 * factor);
    near((anchor.x - next.x) * next.zoom, (anchor.x - panned.x) * panned.zoom, 1e-9);
    near((anchor.y - next.y) * next.zoom, (anchor.y - panned.y) * panned.zoom, 1e-9);
  }
  // At a limit, or for a broken factor or anchor, the same object comes back.
  const closest = { x: 10, y: 20, zoom: MAP_ZOOM_LIMITS.max, selectedId: 'kept' }, widest = { x: 10, y: 20, zoom: MAP_ZOOM_LIMITS.min, selectedId: 'kept' };
  assert.equal(zoomMapViewportAt(closest, 2, { x: 5, y: 5 }), closest); assert.equal(zoomMapViewportAt(widest, 0.5, { x: 5, y: 5 }), widest);
  assert.equal(zoomMapViewportAt(home, Number.NaN, { x: 5, y: 5 }), home);
  assert.equal(zoomMapViewportAt(home, 2, { x: Number.NaN, y: 5 }), home); assert.equal(zoomMapViewportAt(home, 2, { x: 5, y: Number.NaN }), home);
  assert.equal(zoomMapViewportAt(home, 3, { x: 123, y: 45 }).selectedId, 'kept'); assert.equal(zoomMapViewportAt(panned, 3, { x: 123, y: 45 }).selectedId, null);
  // Past a limit the zoom stops there and the anchor still holds.
  assert.deepEqual(zoomMapViewportAt(home, 100, { x: 1000, y: 680 }), { x: 750, y: 510, zoom: 4, selectedId: 'kept' });
});

test('one wheel event zooms by a bounded step, a pinch by a finer one', () => {
  near(wheelZoomFactor(100, 0, false), 0.8187307530779818); near(wheelZoomFactor(-100, 0, false), 1.2214027581601699);
  near(wheelZoomFactor(3, 1, false), 0.9084640160687062); near(wheelZoomFactor(1000, 0, false), 0.697676326071031);
  near(wheelZoomFactor(2, 0, true), 0.9801986733067553); near(wheelZoomFactor(100, 0, true), 0.8187307530779818);
  // Page units: a quarter of a page is one notch, a whole page is cut off like any long scroll.
  near(wheelZoomFactor(0.25, 2, false), 0.8187307530779818); near(wheelZoomFactor(1, 2, false), 0.697676326071031);
  for (const pinch of [false, true]) {
    assert.equal(wheelZoomFactor(0, 0, pinch), 1); assert.equal(wheelZoomFactor(Number.NaN, 0, pinch), 1); assert.equal(wheelZoomFactor(Number.POSITIVE_INFINITY, 0, pinch), 1);
    for (const delta of [1, 7.5, 100, 5000]) for (const unit of [0, 1, 2]) near(wheelZoomFactor(delta, unit, pinch) * wheelZoomFactor(-delta, unit, pinch), 1);
  }
});

test('fitting shows everything drawn and leaves a map inside the base extent at the start view', () => {
  const start = { x: 0, y: 0, zoom: 1 };
  assert.deepEqual(fitMapViewport(mapOf()), start); assert.deepEqual(fitMapViewport(mapOf(room(100, 100, 400, 260))), start);
  assert.deepEqual(fitMapViewport(mapA), start, 'a camera inside the base extent');
  const left = fitMapViewport(mapOf(room(-500, 100, 500, 100)));
  near(left.zoom, 0.641026, 1e-3); near(left.x, -560, 1e-3); near(left.y, -190.4, 1e-3);
  // Too wide for the zoom floor: the floor, centred on the box.
  const far = fitMapViewport(mapOf(room(50000, 0, 100, 100)));
  assert.equal(far.zoom, 0.1); near(far.x, 21052, 1e-6); near(far.y, -3060, 1e-6);
  // Only the side the plan sticks out of gets the margin.
  const marginOf = (map: BackgroundMap) => { const bounds = mapPlanBounds(map); return MAP_FIT_MARGIN * Math.max(bounds.width, bounds.height * 1000 / 680); };
  const above = mapOf(room(100, -300, 100, 100)), up = fitMapViewport(above);
  near(up.y, -300 - marginOf(above), 1e-9); near(up.y + 680 / up.zoom, 680, 1e-9);
  // The far edge of these bounds comes out as 1000.0000000000001: rounding, not a side that sticks out.
  const beside = mapOf(room(-24.15, 100, 100, 100)), sideways = fitMapViewport(beside);
  assert.ok(mapPlanBounds(beside).x + mapPlanBounds(beside).width > 1000);
  near(sideways.x, -24.15 - marginOf(beside), 1e-9); near(sideways.x + 1000 / sideways.zoom, 1000, 1e-9);
  // A node without a finite position is left out, as in the plan bounds.
  assert.deepEqual(fitMapViewport(mapOf(room(-500, 100, 500, 100), { ...camera, x: Number.NaN })), left);
  assert.deepEqual(fitMapViewport(mapOf({ ...camera, y: Number.POSITIVE_INFINITY })), start);
  // Away from the zoom limits the view box holds the plan bounds.
  const tilted: BackgroundSpace = { ...room(700, 500, 600, 300), rotation: 30 };
  for (const map of [mapOf(), mapA, mapOf(room(100, 100, 400, 260)), mapOf(room(-500, 100, 500, 100)), above, beside, mapOf(room(900, 600, 300, 200)), mapOf(tilted, { ...camera, x: -80, y: 1200 })]) {
    const fit = fitMapViewport(map), bounds = mapPlanBounds(map);
    assert.ok(fit.zoom > MAP_ZOOM_LIMITS.min && fit.zoom <= 1);
    assert.ok(fit.x <= bounds.x + 1e-9 && fit.y <= bounds.y + 1e-9, 'left and top');
    assert.ok(fit.x + 1000 / fit.zoom >= bounds.x + bounds.width - 1e-9 && fit.y + 680 / fit.zoom >= bounds.y + bounds.height - 1e-9, 'right and bottom');
  }
});

test('the screen scale is the map units under one CSS pixel of the plan canvas', () => {
  assert.equal(mapScreenScale(1, { width: 1000, height: 680 }), 1); assert.equal(mapScreenScale(1, { width: 500, height: 680 }), 2);
  assert.equal(mapScreenScale(1, { width: 2000, height: 680 }), 1); assert.equal(mapScreenScale(2, { width: 1000, height: 680 }), 0.5);
  // A canvas without a usable size counts as the base extent.
  assert.equal(mapScreenScale(2, { width: 0, height: 0 }), 0.5); assert.equal(mapScreenScale(2, { width: Number.NaN, height: 680 }), 0.5);
  assert.equal(mapScreenScale(2, { width: 500, height: -1 }), 0.5); assert.equal(mapScreenScale(2, { width: Number.POSITIVE_INFINITY, height: 340 }), 0.5);
  assert.deepEqual(MAP_ZOOM_LIMITS, { min: 0.1, max: 4 }); assert.equal(MAP_FIT_MARGIN, 0.04);
  assert.equal(MAP_LABEL_SCALE_LIMITS.max, 1 / MAP_ZOOM_LIMITS.min); assert.equal(MAP_LABEL_SCALE_LIMITS.min, 0.4);
});

test('a drawn space and the name given right after it are one undo step', () => {
  const start = run(createMapDocument(), { type: 'begin-editing', map: mapA }), before = valueOf(start);
  const space = room(100, 100, 400, 260), drawn: BackgroundMap = { ...before, nodes: [...before.nodes, space] };
  const finished = run(start, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: drawn }, { type: 'gesture-finish' });
  const renamed: BackgroundMap = { ...drawn, nodes: drawn.nodes.map(node => node.id === space.id ? { ...node, name: '거실' } : node) };
  const state = run(finished, { type: 'update', map: renamed, history: false });
  const nameOf = (next: MapDocumentState) => valueOf(next).nodes.find(node => node.id === space.id)?.name;
  assert.equal(mapDraft(state, A)!.past.length, 1); assert.equal(nameOf(state), '거실');
  const undone = run(state, { type: 'undo', mapId: A });
  assert.equal(valueOf(undone), before); assert.equal(nameOf(undone), undefined); assert.equal(valueOf(undone).nodes.length, 1);
  const redone = run(undone, { type: 'redo', mapId: A });
  assert.equal(nameOf(redone), '거실'); assert.equal(valueOf(redone), renamed);
});

test('the store applies actions synchronously and notifies only on a change', () => {
  const store = createMapDocumentStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified++; });
  store.dispatch({ type: 'begin-editing', map: mapA });
  assert.equal(notified, 1); assert.equal(mapDraft(store.getState(), A)!.baseRevision, 3);
  store.dispatch({ type: 'gesture-begin', mapId: A });
  assert.equal(isMapGestureActive(store.getState()), true); assert.equal(notified, 2);
  store.dispatch({ type: 'gesture-begin', mapId: A }); store.dispatch({ type: 'undo', mapId: A });
  assert.equal(notified, 2);
  store.dispatch({ type: 'gesture-cancel' });
  assert.equal(isMapGestureActive(store.getState()), false); assert.equal(notified, 3);
  unsubscribe();
  store.dispatch({ type: 'discard', mapId: A });
  assert.equal(notified, 3); assert.equal(mapDraft(store.getState(), A), undefined);
});
