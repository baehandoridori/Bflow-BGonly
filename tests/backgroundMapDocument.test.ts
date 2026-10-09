import test from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundCamera, BackgroundMap, BackgroundSpace, BackgroundSymbol } from '../src/features/backgrounds/types.ts';
import { canRedoMap, canUndoMap, createMapDocument, createMapDocumentStore, fieldEditStartMap, gestureStartMap, isMapGestureActive, mapDraft, mapDraftChanged, mapViewport,
  reduceMapDocument, revealPlanPoint, zoomMapViewport, MAP_ZOOM_LIMITS, MAP_LABEL_SCALE_LIMITS, MAP_FIT_MARGIN, mapScreenScale, zoomMapViewportAt, wheelZoomFactor, fitMapViewport,
  mapSelection, singleViewId, pickAction } from '../src/features/backgrounds/mapDocument.ts';
import type { MapDocumentAction, MapDocumentState } from '../src/features/backgrounds/mapDocument.ts';
import { nextPlanSelection } from '../src/features/backgrounds/mapPlanPreview.ts';
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
  assert.deepEqual(mapViewport(state, A), { x: 30, y: -20, zoom: 2, selectedId: camera.id, selectedIds: [camera.id] });
  assert.deepEqual(mapViewport(state, B), { x: 0, y: 0, zoom: 1, selectedId: 'space-in-b', selectedIds: ['space-in-b'] });
  assert.deepEqual(mapViewport(state, 'never-opened'), { x: 0, y: 0, zoom: 1, selectedId: null, selectedIds: [] }); assert.deepEqual(mapViewport(state, null), mapViewport(state, undefined));
  const selection = (next: MapDocumentState) => [mapViewport(next, A).selectedId, mapViewport(next, B).selectedId];
  const dragging = run(state, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(valueOf(state), 640) });
  const finished = run(dragging, { type: 'gesture-finish' });
  for (const next of [dragging, finished, run(dragging, { type: 'gesture-cancel' }), run(finished, { type: 'undo', mapId: A }),
    run(finished, { type: 'undo', mapId: A }, { type: 'redo', mapId: A }), run(finished, { type: 'drop-drafts', mapIds: [A, B] })]) {
    assert.deepEqual(selection(next), [camera.id, 'space-in-b']); assert.equal(next.viewports, state.viewports);
  }
  // Viewers have no draft and still select and move the view; neither is an edit.
  const viewer = run(createMapDocument(), { type: 'select', mapId: A, id: camera.id }, { type: 'set-viewport', mapId: A, viewport: { zoom: 0.5 } });
  assert.deepEqual(mapViewport(viewer, A), { x: 0, y: 0, zoom: 0.5, selectedId: camera.id, selectedIds: [camera.id] }); assert.deepEqual(viewer.drafts, {});
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
  // Bounds that overshoot the base extent by a rounding step (right; then left, top and bottom) are still inside it.
  assert.deepEqual(fitMapViewport(mapOf(room(900.1, 100, 99.9, 100))), start);
  assert.deepEqual(fitMapViewport(mapOf({ ...room(160, -160, 680, 1000), rotation: 270 })), start);
  const left = fitMapViewport(mapOf(room(-500, 100, 500, 100)));
  near(left.zoom, 0.641026, 1e-3); near(left.x, -560, 1e-3); near(left.y, -190.4, 1e-3);
  // Too wide for the zoom floor: the floor, centred on the box.
  const far = fitMapViewport(mapOf(room(50000, 0, 100, 100)));
  assert.equal(far.zoom, 0.1); near(far.x, 21052, 1e-6); near(far.y, -3060, 1e-6);
  // Only the side the plan sticks out of gets the margin.
  const marginOf = (map: BackgroundMap) => { const bounds = mapPlanBounds(map); return MAP_FIT_MARGIN * Math.max(bounds.width, bounds.height * 1000 / 680); };
  const above = mapOf(room(100, -300, 100, 100)), up = fitMapViewport(above);
  near(up.y, -300 - marginOf(above), 1e-9); near(up.y + 680 / up.zoom, 680, 1e-9);
  const below = mapOf(room(100, 700, 100, 100)), down = fitMapViewport(below);
  near(down.y, 0, 1e-9); near(down.y + 680 / down.zoom, 800 + marginOf(below), 1e-9);
  // The far edge of these bounds comes out as 1000.0000000000001: rounding, not a side that sticks out.
  const beside = mapOf(room(-24.15, 100, 100, 100)), sideways = fitMapViewport(beside);
  assert.ok(mapPlanBounds(beside).x + mapPlanBounds(beside).width > 1000);
  near(sideways.x, -24.15 - marginOf(beside), 1e-9); near(sideways.x + 1000 / sideways.zoom, 1000, 1e-9);
  // Half a unit out is a side that sticks out.
  const barely = mapOf(room(-0.5, 100, 100, 100));
  near(fitMapViewport(barely).x, -0.5 - marginOf(barely), 1e-9);
  // A node without a finite position is left out, as in the plan bounds.
  assert.deepEqual(fitMapViewport(mapOf(room(-500, 100, 500, 100), { ...camera, x: Number.NaN })), left);
  assert.deepEqual(fitMapViewport(mapOf({ ...camera, y: Number.POSITIVE_INFINITY })), start);
  // Away from the zoom limits the view box holds the plan bounds.
  const tilted: BackgroundSpace = { ...room(700, 500, 600, 300), rotation: 30 };
  for (const map of [mapOf(), mapA, mapOf(room(100, 100, 400, 260)), mapOf(room(-500, 100, 500, 100)), above, below, beside, barely, mapOf(room(900, 600, 300, 200)), mapOf(tilted, { ...camera, x: -80, y: 1200 })]) {
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

// Selection. The reducer knows nodes by id only; the functions that read a selection get the map.
const mark = (id: string): BackgroundSymbol => ({ id, type: 'symbol', name: id, symbol: 'chair', spaceId: null, x: 0, y: 0, width: 60, height: 60, rotation: 0, locked: false, hinge: 'left', swing: 'inward' });
const groupMap = mapOf(mark('a'), mark('b'), mark('c'), mark('x'));
const viewOf = (state: MapDocumentState, id = A) => mapViewport(state, id);
const selectOne = (id: string | null, mapId = A): MapDocumentAction => ({ type: 'select', mapId, id });
const selectMany = (ids: readonly string[], mapId = A): MapDocumentAction => ({ type: 'select-many', mapId, ids });
const pickOne = (id: string | null, mapId = A): MapDocumentAction => ({ type: 'pick-one', mapId, id });
/** The selection as the editor reads it: the stored list against the draft as it is now. */
const liveOf = (state: MapDocumentState) => mapSelection(valueOf(state), viewOf(state).selectedIds);

test('select replaces the selection with one node, also when that node is the primary of a group', () => {
  const fresh = createMapDocument(), group = run(fresh, selectMany(['a', 'b']));
  assert.deepEqual(viewOf(group).selectedIds, ['a', 'b']); assert.equal(viewOf(group).selectedId, 'b');
  // No early return on the id the single views already work on: the group folds to that one.
  const folded = run(group, selectOne('b'));
  assert.deepEqual(viewOf(folded).selectedIds, ['b']); assert.equal(viewOf(folded).selectedId, 'b');
  const cleared = run(folded, selectOne(null));
  assert.deepEqual(viewOf(cleared).selectedIds, []); assert.equal(viewOf(cleared).selectedId, null);
  assert.equal(viewOf(cleared).selectedIds, viewOf(fresh).selectedIds, 'every empty selection is the one shared list');
  // The same selection again is the same state.
  assert.equal(run(folded, selectOne('b')), folded); assert.equal(run(cleared, selectOne(null)), cleared); assert.equal(run(fresh, selectOne(null)), fresh);
});

test('select-many replaces the selection with the list, without duplicates and in picked order', () => {
  const other = run(createMapDocument(), selectOne('in-b', B), { type: 'set-viewport', mapId: B, viewport: { x: 5 } });
  const state = run(other, selectMany(['a', 'b', 'a', 'c'])), list = viewOf(state).selectedIds;
  assert.deepEqual(list, ['a', 'b', 'c']); assert.equal(viewOf(state).selectedId, 'c');
  assert.equal(viewOf(state, B), viewOf(other, B), 'the view of another map is left alone');
  // The same ids in the same order are the same selection.
  assert.equal(run(state, selectMany(['a', 'b', 'c'])), state); assert.equal(run(state, selectMany(['a', 'b', 'c', 'a'])), state);
  // Another order, a shorter list and a longer one are not.
  const reordered = run(state, selectMany(['c', 'b', 'a']));
  assert.deepEqual(viewOf(reordered).selectedIds, ['c', 'b', 'a']); assert.equal(viewOf(reordered).selectedId, 'a');
  const shorter = run(state, selectMany(['a', 'b']));
  assert.deepEqual(viewOf(shorter).selectedIds, ['a', 'b']); assert.equal(viewOf(shorter).selectedId, 'b');
  assert.deepEqual(viewOf(run(shorter, selectMany(['a', 'b', 'c']))).selectedIds, ['a', 'b', 'c']);
  const cleared = run(state, selectMany([]));
  assert.deepEqual(viewOf(cleared).selectedIds, []); assert.equal(viewOf(cleared).selectedId, null);
  assert.equal(viewOf(cleared).selectedIds, viewOf(createMapDocument()).selectedIds, 'the one shared empty list');
  assert.equal(run(cleared, selectMany([])), cleared);
  // A pan and a zoom carry the very same list along, so a reader keyed on it does not recompute.
  const panned = run(state, { type: 'set-viewport', mapId: A, viewport: { x: 40, y: -10 } }, { type: 'set-viewport', mapId: A, viewport: { zoom: 2 } });
  assert.notEqual(viewOf(panned), viewOf(state)); assert.equal(viewOf(panned).selectedIds, list); assert.equal(viewOf(panned).selectedId, 'c');
});

test('no action adds to or removes from the stored selection', () => {
  const state = run(createMapDocument(), selectMany(['a', 'b']));
  assert.equal(reduceMapDocument(state, { type: 'toggle-select', mapId: A, id: 'c' } as unknown as MapDocumentAction), state);
  // The reducer reads no `add` flag: the list still replaces the selection.
  const replaced = reduceMapDocument(state, { type: 'select-many', mapId: A, ids: ['c'], add: true } as unknown as MapDocumentAction);
  assert.deepEqual(viewOf(replaced).selectedIds, ['c']); assert.equal(viewOf(replaced).selectedId, 'c');
});

test('after select and select-many the node of the single views is the last selected id', () => {
  const steps = [selectOne('a'), selectMany(['a', 'b']), selectMany(['b', 'a', 'b', 'c']), selectOne('c'), selectMany([]), selectMany(['x']),
    selectOne(null), selectMany(['c', 'a']), selectOne('a'), selectMany(['a', 'x', 'b'])];
  assert.equal(steps.length, 10);
  let state = createMapDocument();
  for (const step of steps) {
    const previous = state;
    state = run(state, step);
    const { selectedId, selectedIds } = viewOf(state);
    assert.notEqual(state, previous); assert.equal(selectedId, selectedIds[selectedIds.length - 1] ?? null);
  }
  assert.deepEqual(viewOf(state).selectedIds, ['a', 'x', 'b']);
});

test('pick-one moves the node of the single views and leaves the selection as it is', () => {
  const key = 'field';
  const group = run(opened(), selectMany(['a', 'b']), selectOne('in-b', B), { type: 'update', map: moved(mapA, 1), coalesceKey: key });
  const list = viewOf(group).selectedIds;
  assert.deepEqual(group.coalescing, { mapId: A, key });
  const picked = run(group, pickOne('x'));
  assert.equal(viewOf(picked).selectedIds, list, 'the same array, not a copy'); assert.equal(viewOf(picked).selectedId, 'x');
  assert.equal(picked.coalescing, null); assert.equal(picked.drafts, group.drafts); assert.equal(viewOf(picked, B), viewOf(group, B));
  const none = run(picked, pickOne(null));
  assert.equal(viewOf(none).selectedId, null); assert.equal(viewOf(none).selectedIds, list);
  // The same node again is the same state.
  assert.equal(run(picked, pickOne('x')), picked); assert.equal(run(none, pickOne(null)), none);
  // A move of the plan view carries the picked node along with the list.
  const panned = run(picked, { type: 'set-viewport', mapId: A, viewport: { x: 40, zoom: 2 } });
  assert.equal(viewOf(panned).selectedId, 'x'); assert.equal(viewOf(panned).selectedIds, list);
});

test('a selection action returns the node of the single views to the primary', () => {
  const group = run(createMapDocument(), selectMany(['a', 'b'])), list = viewOf(group).selectedIds;
  const picked = run(group, pickOne('x'));
  // The same list, but the single views were moved off its primary: this is not the same state.
  const back = run(picked, selectMany(['a', 'b']));
  assert.notEqual(back, picked); assert.equal(viewOf(back).selectedId, 'b'); assert.deepEqual(viewOf(back).selectedIds, ['a', 'b']);
  assert.equal(viewOf(back).selectedIds, list, 'the list itself is kept');
  assert.equal(run(back, selectMany(['a', 'b'])), back);
  const one = run(picked, selectOne('a'));
  assert.deepEqual(viewOf(one).selectedIds, ['a']); assert.equal(viewOf(one).selectedId, 'a');
  // The same for one selected node and for none.
  assert.equal(viewOf(run(createMapDocument(), selectOne('a'), pickOne('x'), selectOne('a'))).selectedId, 'a');
  assert.equal(viewOf(run(createMapDocument(), pickOne('x'), selectOne(null))).selectedId, null);
  assert.equal(viewOf(run(createMapDocument(), pickOne('x'), selectMany([]))).selectedId, null);
});

test('an id whose node is gone leaves the stored selection when the selection is next changed', () => {
  const chair = mark('의자'), space: BackgroundSpace = { ...room(100, 100, 400, 260), id: 'S' };
  const start = run(createMapDocument(), { type: 'begin-editing', map: mapOf(chair) });
  const drawn = run(start, { type: 'update', map: { ...valueOf(start), nodes: [...valueOf(start).nodes, space] } }, selectOne('S'));
  assert.deepEqual(liveOf(drawn).ids, ['S']);
  const undone = run(drawn, { type: 'undo', mapId: A });
  assert.deepEqual(viewOf(undone).selectedIds, ['S'], 'the stored list is raw'); assert.deepEqual(liveOf(undone).ids, []);
  // A Shift+click builds the new list from the live selection, so the removed space does not ride along.
  const added = run(undone, selectMany([...liveOf(undone).ids, chair.id]));
  const redone = run(added, { type: 'redo', mapId: A });
  assert.equal(valueOf(redone).nodes.length, 2); assert.deepEqual(liveOf(redone).ids, ['의자']);
  // Left untouched, the selection comes back with the space.
  assert.deepEqual(liveOf(run(undone, { type: 'redo', mapId: A })).ids, ['S']);
});

test('the node of the single views is the selection itself, or with several selected the one picked there', () => {
  const single = mapSelection(groupMap, ['a']), group = mapSelection(groupMap, ['a', 'b']), none = mapSelection(groupMap, []);
  // At most one selected: the selection, whatever was picked while there were more.
  assert.equal(singleViewId(groupMap, single, 'a'), 'a'); assert.equal(singleViewId(groupMap, single, 'x'), 'a'); assert.equal(singleViewId(groupMap, single, null), 'a');
  assert.equal(singleViewId(groupMap, mapSelection(groupMap, ['a', 'gone']), 'x'), 'a', 'a group that an undo left with one node');
  for (const selectedId of [null, 'a', 'x', 'gone']) assert.equal(singleViewId(groupMap, none, selectedId), null);
  // Several selected: the picked node, in the group or outside it, or none.
  assert.equal(singleViewId(groupMap, group, 'b'), 'b'); assert.equal(singleViewId(groupMap, group, 'a'), 'a');
  assert.equal(singleViewId(groupMap, group, 'x'), 'x'); assert.equal(singleViewId(groupMap, group, null), null);
  // A picked node that is gone gives the primary again.
  assert.equal(singleViewId(groupMap, group, 'gone'), 'b');
  // Without a map nothing is selected.
  for (const selectedId of [null, 'a', 'b']) assert.equal(singleViewId(undefined, mapSelection(undefined, ['a', 'b']), selectedId), null);
});

test('picking one node is a selection, and in a single view while several are selected only a pick-one', () => {
  const group = mapSelection(groupMap, ['a', 'b']);
  // One selected, none, or one left alive of a stored pair.
  const atMostOne = [mapSelection(groupMap, ['a']), mapSelection(groupMap, []), mapSelection(groupMap, ['a', 'gone'])];
  // The primary, another of the group, a node outside it and nothing: what is picked makes no difference.
  for (const id of ['b', 'a', 'x', null]) {
    assert.deepEqual(pickAction(A, id, true, group), { type: 'pick-one', mapId: A, id });
    assert.deepEqual(pickAction(A, id, false, group), { type: 'select', mapId: A, id });
    for (const selection of atMostOne) for (const singleView of [true, false]) assert.deepEqual(pickAction(A, id, singleView, selection), { type: 'select', mapId: A, id });
  }
});

test('a pick in 3D never changes the group selected on the plan', () => {
  /** The editor's `select` in 3D mode. */
  const pick = (state: MapDocumentState, map: BackgroundMap, id: string | null) => run(state, pickAction(A, id, true, mapSelection(map, viewOf(state).selectedIds)));
  const shown = (state: MapDocumentState, map: BackgroundMap) => singleViewId(map, mapSelection(map, viewOf(state).selectedIds), viewOf(state).selectedId);
  let state = run(createMapDocument(), selectMany(['a', 'b', 'c']));
  const list = viewOf(state).selectedIds;
  assert.equal(shown(state, groupMap), 'c', 'the primary at first');
  for (const id of ['x', null, 'a', 'c', 'x']) {
    state = pick(state, groupMap, id);
    assert.equal(viewOf(state).selectedIds, list); assert.equal(shown(state, groupMap), id);
  }
  // The companion plan reports the result of cycling a pile: here the next camera on the spot, outside the group.
  const cameras = mapOf(mark('a'), ...['camA', 'camB', 'camC'].map(id => ({ ...camera, id })));
  const piled = run(createMapDocument(), selectMany(['a', 'camB'])), pair = viewOf(piled).selectedIds;
  assert.equal(shown(piled, cameras), 'camB');
  const next = nextPlanSelection(cameras, 'camA', 'camB');
  assert.equal(next, 'camC');
  const cycled = pick(piled, cameras, next);
  assert.equal(viewOf(cycled).selectedIds, pair); assert.equal(shown(cycled, cameras), 'camC');
  // With one node selected the pick is the selection, as before.
  const single = pick(run(createMapDocument(), selectOne('a')), groupMap, 'x');
  assert.deepEqual(viewOf(single).selectedIds, ['x']); assert.equal(viewOf(single).selectedId, 'x');
});

test('a changed selection ends a field edit and the same selection keeps it', () => {
  const key = 'field';
  const typing = (state: MapDocumentState) => run(state, { type: 'update', map: moved(valueOf(state), 77), coalesceKey: key });
  const group = typing(run(opened(), selectMany(['a', 'b'])));
  assert.deepEqual(group.coalescing, { mapId: A, key });
  for (const action of [selectMany(['a', 'b']), selectMany(['a', 'b', 'a']), pickOne('b')]) assert.equal(run(group, action), group);
  for (const action of [selectMany(['a']), selectMany(['b', 'a']), selectMany([]), selectOne('b'), selectOne(null), pickOne('a'), pickOne(null), selectMany(['a'], B)])
    assert.equal(run(group, action).coalescing, null);
  const single = typing(run(opened(), selectOne('a')));
  assert.equal(run(single, selectOne('a')), single); assert.equal(run(single, selectMany(['a'])), single);
});

test('a selection is no part of the edit: it leaves the drafts alone and no edit action touches it', () => {
  const edited = run(opened(), { type: 'update', map: named(mapA, '편집') }), selected = run(edited, selectMany(['a', 'b']));
  for (const state of [selected, run(selected, selectOne('a')), run(selected, selectOne(null)), run(selected, selectMany(['b'])), run(selected, pickOne('x'))]) assert.equal(state.drafts, edited.drafts);
  const actions: MapDocumentAction[] = [{ type: 'update', map: named(mapA, '둘째') }, { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(mapA, 900) }, { type: 'gesture-cancel' },
    { type: 'gesture-begin', mapId: A }, { type: 'gesture-preview', map: moved(mapA, 640) }, { type: 'gesture-finish' }, { type: 'undo', mapId: A }, { type: 'redo', mapId: A },
    { type: 'discard', mapId: A }, { type: 'drop-drafts', mapIds: [A, B] }, { type: 'begin-editing', map: mapA }, { type: 'enter-new-map', map: mapB }];
  let next = selected;
  for (const action of actions) {
    const previous = next;
    next = run(next, action);
    assert.notEqual(next, previous, action.type); assert.equal(next.viewports, selected.viewports, action.type);
  }
  assert.deepEqual(viewOf(next).selectedIds, ['a', 'b']); assert.equal(viewOf(next).selectedId, 'b');
});

test('switching the display mode is still not an action while several are selected', () => {
  const state = run(opened(), { type: 'update', map: named(mapA, '편집') }, selectMany(['a', 'b', 'c']), pickOne('x'));
  let next = state;
  for (let index = 0; index < 20; index++) next = reduceMapDocument(next, { type: 'set-mode', mode: index % 2 ? 'plan' : '3d' } as unknown as MapDocumentAction);
  assert.equal(next, state);
});

test('the selection is read against the map: the ids of nodes that are gone are left out and nothing is written', () => {
  const stored: readonly string[] = Object.freeze(['a', 'b', 'c']);
  const without = (id: string) => mapOf(...groupMap.nodes.filter(node => node.id !== id));
  const all = mapSelection(groupMap, stored);
  assert.equal(all.ids, stored, 'all alive: the stored list itself'); assert.equal(all.primaryId, 'c');
  // One node gone: only its id drops, and the primary is the last of the rest.
  assert.deepEqual(mapSelection(without('a'), stored), { ids: ['b', 'c'], primaryId: 'c' });
  assert.deepEqual(mapSelection(without('b'), stored), { ids: ['a', 'c'], primaryId: 'c' });
  // The primary gone: the one picked before it takes its place.
  assert.deepEqual(mapSelection(without('c'), stored), { ids: ['a', 'b'], primaryId: 'b' });
  assert.deepEqual(mapSelection(mapOf(), stored), { ids: [], primaryId: null });
  // No map, or nothing selected: one shared empty selection.
  const empty = mapSelection(undefined, stored);
  assert.deepEqual(empty, { ids: [], primaryId: null });
  assert.equal(mapSelection(undefined, stored), empty); assert.equal(mapSelection(groupMap, []), empty); assert.equal(mapSelection(undefined, []), empty);
  // A node that an undo removes and a redo brings back is selected again.
  const start = run(createMapDocument(), { type: 'begin-editing', map: mapOf(mark('a')) });
  const grown = run(start, { type: 'update', map: mapOf(mark('a'), mark('b')) }, selectMany(['a', 'b']));
  const undone = run(grown, { type: 'undo', mapId: A }), redone = run(undone, { type: 'redo', mapId: A });
  assert.deepEqual(liveOf(undone), { ids: ['a'], primaryId: 'a' });
  assert.deepEqual(liveOf(redone), { ids: ['a', 'b'], primaryId: 'b' }); assert.equal(liveOf(redone).ids, viewOf(grown).selectedIds);
});

test('the store notifies once for a new selection and not for the same one', () => {
  const store = createMapDocumentStore();
  let notified = 0;
  store.subscribe(() => { notified++; });
  store.dispatch(selectMany(['a', 'b']));
  assert.equal(notified, 1); assert.deepEqual(viewOf(store.getState()).selectedIds, ['a', 'b']);
  store.dispatch(selectMany(['a', 'b'])); store.dispatch(selectMany(['a', 'b', 'a'])); store.dispatch(pickOne('b'));
  assert.equal(notified, 1);
  store.dispatch(pickOne('x'));
  assert.equal(notified, 2); assert.deepEqual(viewOf(store.getState()).selectedIds, ['a', 'b']);
});
