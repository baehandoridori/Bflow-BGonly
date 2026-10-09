import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Source anchors of the plan editor's wiring: what the pure tests cannot reach. Every anchor was checked by
// mutation: the line it guards was broken in a scratch copy, and the anchor failed.

const directory = new URL('../src/features/backgrounds/', import.meta.url);
/**
 * Read with LF line endings (a fresh checkout under core.autocrlf has CRLF; no marker or pattern below carries a
 * line break) and without comments: a guarded line that is commented out is as gone as a deleted one.
 * The pattern knows no strings, so `//` right after a quote, a colon or a backslash stays (a string, a URL, a regex).
 * On every source of this feature it removes exactly what the TypeScript parser reads as a comment.
 */
const read = (name: string) => readFileSync(new URL(name, directory), 'utf8').replace(/\r\n/g, '\n')
  .replace(/\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/.*$/gm, '');
const editor = read('BackgroundMapEditor.tsx');
const nameBox = read('BackgroundMapNameBox.tsx');
const overlays = read('BackgroundMapPlanOverlays.tsx');

/**
 * The source from one marker up to the next. Both must be found: with a missing marker the piece would be empty,
 * and an anchor that looks for an absence would pass on it.
 */
function piece(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  assert.ok(start > -1, `marker not found: ${from}`);
  const end = source.indexOf(to, start + from.length);
  assert.ok(end > start, `marker not found after "${from}": ${to}`);
  return source.slice(start, end);
}
/** First position of each fragment. Each must be found: a missing one (-1) would come before anything. */
function positions(source: string, ...fragments: string[]): number[] {
  return fragments.map(fragment => {
    const at = source.indexOf(fragment);
    assert.ok(at > -1, `not found: ${fragment}`);
    return at;
  });
}
/** The fragments are all there, and first appear in this order. */
function inOrder(source: string, ...fragments: string[]): void {
  positions(source, ...fragments).forEach((at, index, all) => {
    if (index) assert.ok(all[index - 1] < at, `"${fragments[index - 1]}" must come before "${fragments[index]}"`);
  });
}
const count = (source: string, pattern: RegExp) => (source.match(pattern) ?? []).length;

/** A handler of the editor: from its own first line up to the code that follows it in the file. */
const handler = {
  abortGesture: () => piece(editor, 'const abortGesture = useEvent(', 'useLayoutEffect(() => { abortGesture(); }'),
  commitName: () => piece(editor, 'const commitName = useEvent(', 'const cancelName = useEvent('),
  pointerDown: () => piece(editor, 'function pointerDown(', 'function pointerMove('),
  pointerMove: () => piece(editor, 'function pointerMove(', 'function pointerUp('),
  pointerUp: () => piece(editor, 'function pointerUp(', 'function doubleClickIntent('),
  doubleClickIntent: () => piece(editor, 'function doubleClickIntent(', 'function canvasDoubleClick('),
  canvasDoubleClick: () => piece(editor, 'function canvasDoubleClick(', 'function zoomBy('),
  openSpace: () => piece(editor, 'function openSpace(', 'function beginRename('),
  fitView: () => piece(editor, 'function fitView(', 'function keyboard('),
  keyboard: () => piece(editor, 'function keyboard(', 'const selectNode = useEvent('),
};
/** The opening tag of the plan SVG, through the end of its last attribute. */
function canvasTag(): string {
  const start = editor.indexOf('<svg ref={svgRef}');
  assert.ok(start > -1, 'the plan SVG was not found');
  const end = editor.indexOf('}>', start);
  assert.ok(end > start, 'the end of the plan SVG tag was not found');
  return editor.slice(start, end + 2);
}

test('anchor 1: the wheel is a native, non-passive listener on the plan SVG, attached again for each map and mode', () => {
  // The registration and the dependency list are one effect: no other effect starts between them.
  assert.match(editor, /svg\.addEventListener\('wheel', onWheel, \{ passive: false \}\);(?:(?!useEffect\()[\s\S])*?\}, \[onWheel, current\?\.id, mode\]\);/);
  // What the listener is non-passive for: the wheel is swallowed first, whatever the handler does next.
  assert.match(editor, /const onWheel = useEvent\(\(event: WheelEvent\) => \{\s*event\.preventDefault\(\);/);
  // React listens to onWheel passively: preventDefault would do nothing there.
  assert.doesNotMatch(editor, /onWheel(?:Capture)?=/);
});

test('anchor 2: fit shows everything that is drawn, and the reset of the view is gone', () => {
  assert.match(handler.fitView(), /updateView\(fitMapViewport\(current\)\);/);
  assert.match(editor, /onClick=\{fitView\}>맞춤<\/button>/);
  assert.doesNotMatch(editor, /updateView\(\{\s*x:\s*0,\s*y:\s*0,\s*zoom:\s*1\s*\}\)/);
});

test('anchor 3: a drag on the plan is computed by previewPlanGesture, and only then previewed', () => {
  // What is previewed is the map previewPlanGesture returned, and a move previews nothing else.
  const move = handler.pointerMove();
  inOrder(move, 'const preview = previewPlanGesture(gesture, session.initial, session.start, point, snap);', 'doc.previewGesture(preview.map);');
  assert.equal(count(move, /doc\.previewGesture\(/g), 1, 'one preview per move');
  // The gesture maths lives in one place, mapPlanGesture.ts.
  assert.doesNotMatch(editor, /\bresizeSpace\(/);
  assert.doesNotMatch(editor, /moveMapNode\(next/);
});

test('anchor 4: the name of a node just drawn joins the drawing step only while the draft is still that drawing', () => {
  assert.match(handler.commitName(), /updateMap\(next, edit\.created && draftNow\.value === edit\.created \? \{ history: false \} : undefined\);/);
  // Only a node just drawn carries that value: a rename by F2 or by double-click is an undo step of its own.
  assert.match(editor, /setRenaming\(\{ mapId: current\.id, nodeId: id, created: created \? value : null \}\);/);
});

test('anchor 5: the step to the next pile item is taken by the click on the SVG, never by the release, and a repeated click never steps through spaces', () => {
  const click = piece(canvasTag(), 'onClick={event => {', '}}');
  // A pile of spaces is settled by the click count alone, before the double-click is asked.
  inOrder(click, 'const cycle = pendingCycle.current; pendingCycle.current = null;',
    'if (!cycle || (event.detail >= 2 && (cycle.spaces || doubleClickIntent(pointFrom(event))))) return;',
    'const next = cycle.ids[(cycle.ids.indexOf(cycle.from) + 1) % cycle.ids.length];',
    'select(next, cycle.mapId);');
  assert.equal(count(editor, /if \(!cycle \|\| \(event\.detail >= 2 && \(cycle\.spaces \|\| doubleClickIntent\(pointFrom\(event\)\)\)\)\) return;/g), 1, 'one condition for the step');
  // The release only asks for the step, and says what kind of pile it is.
  const up = handler.pointerUp();
  assert.match(up, /pendingCycle\.current = \{ ids: click\.ids, from: click\.from, mapId: session\.mapId, spaces: click\.spaces \};/);
  // The release selects twice, the node of the drag that ended and what the click picks: no step under any spelling.
  assert.equal(count(up, /\bselect\(/g), 2, 'the release selects nowhere else');
  assert.match(up, /select\(session\.node\.id, session\.mapId\)/);
  // The click of a press is done only by a release that neither moved nor was cancelled, and it sits right under that
  // condition: after a pan, a box or the drag of a group it would put the pressed node (or nothing) over what the drag left.
  assert.match(up, /if \(!cancel && !session\.moved\) \{\s*const click = session\.click;\s*if \(click\.kind === 'select'\) select\(click\.id, session\.mapId\);/);
  assert.doesNotMatch(up, /click\.ids\[/);
  assert.doesNotMatch(up, /indexOf\(click\.from/);
  // A group that was dragged stays the selection.
  assert.match(up, /if \(!session\.groupIds && session\.node\) select\(session\.node\.id, session\.mapId\);/);
  // The press itself selects one thing only, what resolvePlanPress said to select at once: the node a drag is about to move.
  const down = handler.pointerDown();
  assert.match(down, /if \(plan\?\.selectAtPress !== undefined\) select\(plan\.selectAtPress\);/);
  assert.equal(count(down, /\bselect\(/g), 1, 'the press selects nowhere else');
});

test('anchor 6: double-clicks are handled in one place, the SVG, and what one does is decided once, from the presses that pointerDown logged', () => {
  // A press that captured the pointer sends its dblclick to the SVG: a handler on a node or on a handle would never run.
  assert.equal(count(`${editor}${overlays}`, /onDoubleClick(?:Capture)?=/g), 1);
  assert.match(canvasTag(), /onDoubleClick=\{canvasDoubleClick\}/);
  // No double-click on a handle. What it does is asked in one place, and a space that is entered is picked on the way.
  // Both are done to the node the answer names: the topmost node of the press may be another one.
  inOrder(handler.canvasDoubleClick(), 'if (!current || !last || last.handle || Date.now() - lastDrag.current <= 450) return;',
    'doubleClickIntent(', "openSpace(intent.node.id, tool !== 'hand')", 'else if (intent) beginRename(intent.node.id);');
  // What the log is read for: both presses on the same node. The node of the first press is asked first, then the topmost one.
  inOrder(handler.doubleClickIntent(), 'pressLog.current', 'first.hitId !== last.hitId', 'doubleClickNodeId(first.targetId, node.id, pile)',
    'for (const item of target === node ? [node] : [target, node])', 'planDoubleClickAction(item,');
  // The step of a click and the double-click itself ask the same question, and nothing else does.
  assert.equal(count(editor, /(?<!function )\bdoubleClickIntent\(/g), 2, 'the step and the double-click');
  inOrder(handler.openSpace(), 'if (pick && id !== singleId) select(id);', 'navigate(');
  assert.match(handler.pointerDown(), /pressLog\.current = press \? \[pressLog\.current\[1\], press\] : NO_PRESSES;/);
});

test('anchor 7: the name box keeps Escape and compositions to itself, hands the history over only untouched, and never commits while it is taken down', () => {
  // Escape stops before the composition guard, so it never reaches the editor in the middle of a composition either.
  inOrder(nameBox, "if (event.key === 'Escape') event.stopPropagation();",
    'if (event.nativeEvent.isComposing || event.keyCode === 229) return;', "if (event.key === 'Enter')");
  assert.match(nameBox, /else if \(\(event\.ctrlKey \|\| event\.metaKey\) && !event\.altKey && text === opened\.current\) \{(?:(?!onBlur=)[\s\S])*?onHistory\(key === 'y' \|\| event\.shiftKey\);/);
  // `opened` is the name at the opening and is never assigned again: otherwise the comparison above says nothing.
  assert.match(nameBox, /const opened = useRef\(initial\);/);
  assert.doesNotMatch(nameBox, /opened\.current\s*=(?!=)/);
  assert.match(nameBox, /onBlur=\{\(\) => \{ if \(!leaving\.current\) onCommit\(text, false\); \}\}/);
  assert.match(nameBox, /return \(\) => \{ leaving\.current = true; \};/);
  assert.match(editor, /onHistory=\{passNameHistory\}/);
  assert.match(editor, /const passNameHistory = useEvent\(\(redo: boolean\) => \{ cancelName\(\); undo\(redo\); \}\);/);
});

test('anchor 8: no screen of the background feature puts HTML inside an SVG', () => {
  const screens = readdirSync(directory).filter(name => name.endsWith('.tsx'));
  assert.ok(screens.includes('BackgroundMapEditor.tsx') && screens.includes('BackgroundMapNameBox.tsx'), 'the screens were listed');
  // With the opening bracket: the markup, not the word.
  for (const name of screens) assert.doesNotMatch(read(name), /<foreignObject/, `${name} has a <foreignObject>`);
});

test('anchor 9: the snap and gesture modules stay pure: no three.js, no DOM', () => {
  for (const name of ['mapSnap.ts', 'mapPlanGesture.ts']) {
    const source = read(name);
    // The import and the access, not the words.
    assert.doesNotMatch(source, /from\s+['"]three/, `${name} imports three.js`);
    assert.doesNotMatch(source, /\b(?:document|window)\.\w/, `${name} touches the DOM`);
  }
});

test('anchor 10: the 3D files import none of the plan editing modules', () => {
  // By whatever path: './mapSnap', '../backgrounds/mapSnap' and '@/features/backgrounds/mapSnap' are one module.
  for (const name of ['BackgroundMap3D.tsx', 'map3dScene.ts', 'BackgroundMapCameraGizmo.ts'])
    assert.doesNotMatch(read(name), /['"][^'"]*\/(?:mapSnap|mapPlanGesture|mapPlanEdit)(?:\.ts)?['"]/, `${name} imports a plan editing module`);
});

test('anchor 11: the plan has no grid that is always drawn', () => {
  for (const [name, source] of Object.entries({ editor, overlays, nameBox })) assert.doesNotMatch(source, /<pattern/, `${name} has a <pattern>`);
});

test('anchor 12: Delete removes a point only through activeIndex, which exists only while the point handles are drawn', () => {
  assert.match(editor, /const activeIndex = vertexHandles && activeVertex && /);
  const keys = handler.keyboard();
  const pointBranch = keys.indexOf("if (event.key === 'Delete'"), nodeLine = keys.indexOf("if (event.key === 'Delete'", pointBranch + 1);
  assert.ok(pointBranch > -1 && nodeLine > pointBranch, 'the point branch comes before the line that deletes the node');
  const branch = keys.slice(pointBranch, nodeLine);
  assert.match(branch, /^if \(event\.key === 'Delete' && activeIndex !== null && /);
  assert.match(branch, /removePolygonVertex\(selected, activeIndex\)/);
  // The picked point as stored may be one that is not on show.
  assert.doesNotMatch(branch, /\bactiveVertex\b/);
});

test('anchor 13: the plan shortcuts come before the guard that leaves keys to a focused button', () => {
  // Looked up inside keyboard(): `function fitView() {` above it carries the same letters.
  const keys = handler.keyboard(), shortcuts = ["event.key === 'F2'", 'fitView()', 'zoomBy(1.25)', 'zoomBy(0.8)'];
  const [guard] = positions(keys, 'if (target.closest(interactive)) return;');
  positions(keys, ...shortcuts).forEach((at, index) => assert.ok(at < guard, `${shortcuts[index]} must come before the guard`));
  // What they stop at themselves is text entry and dialogs, never a button: with one in it they would be as deaf as behind the guard.
  assert.match(keys, /&& !event\.nativeEvent\.isComposing && !target\.closest\(textEntry\)\) \{/);
  assert.match(editor, /const textEntry = `\$\{textFields\}, dialog`;/);
  assert.match(editor, /const textFields = 'input, textarea, select, \[contenteditable\]:not\(\[contenteditable="false"\]\)';/);
});

test('anchor 14: the polygon tool takes a press for the same point within the dot size on screen, not within one map unit', () => {
  assert.match(handler.pointerDown(), /Math\.hypot\(last\.x - point\.x, last\.y - point\.y\) < MAP_EDIT_MARK\.polygonDot \* screenScale \? previous : \[\.\.\.previous, point\]/);
  assert.doesNotMatch(editor, /last\.y - point\.y\) < 1\b/);
});

test('anchor 15: a pulled-out + picks its point only when the polygon really gained one', () => {
  const up = handler.pointerUp();
  inOrder(up, 'const added = points(mapDraft(doc.getState(), session.mapId)?.value) === points(session.initial) + 1;',
    'setActiveVertex(added ? { mapId: session.mapId, nodeId: session.node.id, index: session.vertex.index + 1 } : null);');
  assert.equal(count(up, /setActiveVertex\(/g), 1, 'the release picks a point nowhere else');
});

test('anchor 16: a press the canvas did not take empties the press log', () => {
  // Outside the SVG: one capture listener on the window, so portals and anything drawn over the canvas are seen too.
  assert.match(editor, /const forget = \(event: PointerEvent\) => \{\s*if \(!\(event\.target instanceof Node\) \|\| !svgRef\.current\?\.contains\(event\.target\)\) pressLog\.current = NO_PRESSES;\s*\};\s*window\.addEventListener\('pointerdown', forget, true\);/);
  assert.match(editor, /const NO_PRESSES: readonly \[PlanPress \| null, PlanPress \| null\] = \[null, null\];/);
  // Inside the SVG: both ways pointerDown turns a press away.
  const down = handler.pointerDown();
  assert.match(down, /\(event\.button !== 0 && event\.button !== 1\)\) \{ pressLog\.current = NO_PRESSES; return; \}/);
  assert.match(down, /if \(!point \|\| !matrix\) \{ pressLog\.current = NO_PRESSES; return; \}/);
});

test('anchor 17: the Alt of a drag is kept from the window menu until that key is released, whatever the pointer does', () => {
  const effect = piece(editor, 'const altDrag = useRef(false);', '}, []);');
  for (const listener of ["window.addEventListener('keydown', key, true);", "window.addEventListener('keyup', key, true);", "window.addEventListener('blur', forget);"])
    assert.ok(effect.includes(listener), listener);
  const key = piece(effect, 'const key = (event: KeyboardEvent) => {', 'const forget = () =>');
  // The third place that switches it on: Alt pressed while the pointer is already down and resting.
  inOrder(key, "if (event.key !== 'Alt') return;", "if (event.type === 'keydown' && pointerRef.current) altDrag.current = true;",
    'if (!altDrag.current) return;', 'event.preventDefault();', "if (event.type === 'keyup') altDrag.current = false;");
  assert.equal(count(key, /altDrag\.current = false/g), 1, 'only the release of the key ends it');
  assert.match(effect, /const forget = \(\) => \{ altDrag\.current = false; \};/);
  // Switched on where the session is recorded, and on every move of it, before the drag threshold.
  assert.match(handler.pointerDown(), /pointerRef\.current = \{[^;]*\};\s*if \(event\.altKey\) altDrag\.current = true;/);
  inOrder(handler.pointerMove(), 'if (!session || session.pointerId !== event.pointerId) return;', 'if (event.altKey) altDrag.current = true;', 'if (!session.moved &&');
  // Never assigned where the pointer is released: the release of Alt that follows is the event to keep from the menu.
  assert.doesNotMatch(handler.pointerUp(), /altDrag\.current\s*=(?!=)/);
  assert.doesNotMatch(handler.abortGesture(), /altDrag\.current\s*=(?!=)/);
  assert.equal(count(editor, /altDrag\.current = false/g), 2, 'the key release and the window blur, nothing else');
  // The shape that blocks Alt only while a pointer is pressed lets that release through.
  assert.doesNotMatch(editor, /event\.key === 'Alt' && pointerRef\.current|pointerRef\.current && event\.key === 'Alt'/);
});

test('anchor 18: the snap input carries the reach, in screen pixels at the zoom of the press, and there is none while Alt is held', () => {
  // From the condition on: the toggle and the Alt of this very move decide whether there is a snap input at all.
  assert.match(handler.pointerMove(), /const snap = snapEnabled && !event\.altKey\s*\? \{ candidates: .*\s*tolerance: MAP_SNAP\.tolerancePx \* session\.scale, reach: MAP_SNAP\.reachPx \* session\.scale \}\s*: null;/);
});

test('anchor 19: a press that starts a drag changes nothing laid out above the canvas', () => {
  // The message sits above the canvas. Clearing it on the press would resize the canvas under a drag that still
  // converts positions with the transform taken at the press, so the point would run ahead of the pointer.
  assert.equal(count(handler.pointerDown(), /setError\(/g), 1, 'only the polygon tool, which returns before any session');
  inOrder(handler.pointerUp(), 'pointerRef.current = null;', "if (session.mode === 'vertex') setError('');");
});

test('anchor 20: the polygon tool stops at the number of points a space can store', () => {
  inOrder(handler.pointerDown(), 'setPolygon(previous => {', 'if (previous.length >= POLYGON_POINT_LIMIT) return previous;', 'const last = previous[previous.length - 1];');
});

// Numbered past 21-35, which the selection tools add in their last step: this one guards the lines none of those read.
test('anchor 36: the image grid, the look-through, the picked point and the object list follow the selection as the editor reads it, never the raw viewport', () => {
  // The image grid is scoped to the one node the single-node tools work on: with a group on the plan, the whole map.
  assert.match(editor, /const settledSelected = settledCurrent\?\.nodes\.find\(node => node\.id === selected\?\.id\);/);
  // Looking through a camera ends when the node the 3D view works on is another one: the comparison, and what the effect waits for.
  assert.match(editor, /setLookThrough\(previous => previous && mode === '3d' && previous\.mapId === current\?\.id && previous\.id === singleId \? previous : null\);\s*\}, \[singleId, current\?\.id, mode\]\);/);
  // The picked point belongs to that one node too.
  assert.match(editor, /useEffect\(\(\) => setActiveVertex\(null\), \[selected\?\.id, current\?\.id, mode, canEdit\]\);/);
  // The object list marks the whole group on the plan and, in 3D, only the node the 3D view marks.
  inOrder(piece(editor, 'const listSelection = useMemo(', 'useEffect('), 'const group = mapSelection(settledCurrent, view.selectedIds);',
    "if (mode === 'plan') return group;", 'const id = singleViewId(settledCurrent, group, view.selectedId);',
    'return id === null ? mapSelection(undefined, group.ids) : { ids: [id], primaryId: id };',
    '}, [settledCurrent, view.selectedIds, view.selectedId, mode]);');
  assert.match(editor, /<ObjectList nodes=\{settledCurrent\?\.nodes \?\? current\.nodes\} selectedIds=\{listSelection\.ids\} primaryId=\{listSelection\.primaryId\} onSelect=\{selectNode\} \/>/);
  // Every selected row is marked; the primary alone is the current one.
  assert.match(piece(editor, 'const ObjectList = memo(function ObjectList(', 'export function BackgroundMapEditor('),
    /className=\{selectedIds\.includes\(node\.id\) \? 'is-selected' : ''\} aria-current=\{node\.id === primaryId \? 'true' : undefined\}/);
  // The `select` of the document is called from nowhere: in 3D it would fold the group that pickAction keeps.
  const sources = readdirSync(directory).filter(name => /\.tsx?$/.test(name));
  assert.ok(sources.includes('BackgroundMapEditor.tsx') && sources.includes('useBackgroundMapDocument.ts'), 'the sources were listed');
  for (const name of sources) assert.doesNotMatch(read(name), /\bdoc\.select\(/, `${name} calls doc.select`);
});

// Numbered past 21-35 as well.
test('anchor 37: the selection box is drawn as a path, so a box dragged along one line still shows', () => {
  // An SVG <rect> with no width or no height is not drawn at all, its stroke included: a drag that is exactly horizontal
  // or vertical would mark what it touches and show no box. A path is stroked along its length, whatever its area.
  const box = piece(overlays, 'export function MapMarquee(', 'export function MapNodeHandles(');
  assert.match(box, /<path className="bmap-marquee" d=\{`M \$\{rect\.left\} \$\{rect\.top\} H \$\{rect\.right\} V \$\{rect\.bottom\} H \$\{rect\.left\} Z`\} /);
  assert.doesNotMatch(box, /<rect/);
});
