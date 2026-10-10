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
/**
 * A pick, under every spelling the editor has for one: `select`, `doc.selectMany`, the stable wrappers `selectNode` and
 * `clearSelection`, and a dispatch. `setTool('select')` is none: the word is not followed by a parenthesis there.
 */
const anyPick = /\b(?:select\w*|clearSelection|dispatch)\(/;
/**
 * One branch: from `opener`, which ends with the brace that opens it, through the brace that closes it. Braces are
 * counted as written: no branch read here has an unpaired one inside a string or a pattern.
 */
function block(source: string, opener: string): string {
  const start = source.indexOf(opener);
  assert.ok(start > -1, `branch not found: ${opener}`);
  let depth = 0;
  for (let at = start + opener.length - 1; at < source.length; at++) {
    if (source[at] === '{') depth++;
    else if (source[at] === '}' && --depth === 0) return source.slice(start, at + 1);
  }
  return assert.fail(`branch not closed: ${opener}`);
}

/** A handler of the editor: from its own first line up to the code that follows it in the file. */
const handler = {
  planGestureOf: () => piece(editor, 'function planGestureOf(', 'function mapPath('),
  onSpaceKey: () => piece(editor, 'const onSpaceKey = useEvent(', 'useEffect('),
  select: () => piece(editor, 'function select(', 'function updateView('),
  navigate: () => piece(editor, 'function navigate(', 'function switchMode('),
  switchMode: () => piece(editor, 'function switchMode(', 'const leave3D = useEvent('),
  leave3D: () => piece(editor, 'const leave3D = useEvent(', 'function expandPath('),
  placeSymbol: () => piece(editor, 'function placeSymbol(', 'function beginEditing('),
  confirmAction: () => piece(editor, 'async function confirmAction(', 'async function createMap('),
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
const view3d = read('BackgroundMap3D.tsx');
/** A method of the 3D viewport, cut the same way as a handler of the editor. */
const viewport = {
  start: () => piece(view3d, 'private start(', 'update(props: Map3DProps): void {'),
  update: () => piece(view3d, 'update(props: Map3DProps): void {', 'zoom(factor: number): void {'),
  dispose: () => piece(view3d, 'dispose(): void {', 'private readonly requestRender ='),
  click: () => piece(view3d, 'private click(', 'private clickHandle('),
  clickHandle: () => piece(view3d, 'private clickHandle(', 'private pick('),
  pick: () => piece(view3d, 'private pick(', 'private opens('),
  onPressElsewhere: () => piece(view3d, 'private readonly onPressElsewhere =', 'private readonly onPointerDown ='),
  onPointerDown: () => piece(view3d, 'private readonly onPointerDown =', 'private readonly onPointerMove ='),
  onPointerUp: () => piece(view3d, 'private readonly onPointerUp =', 'private readonly onPointerCancel ='),
  onPointerCancel: () => piece(view3d, 'private readonly onPointerCancel =', 'private readonly onDoubleClick ='),
  onDoubleClick: () => piece(view3d, 'private readonly onDoubleClick =', 'private readonly onContextMenu ='),
  onMouseDown: () => piece(view3d, 'private readonly onMouseDown =', 'private readonly onDragKey ='),
};

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
    assert.doesNotMatch(read(name), /['"][^'"]*\/(?:mapSnap|mapPlanGesture|mapPlanEdit|mapPlanSelect)(?:\.ts)?['"]/, `${name} imports a plan editing module`);
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

test('anchor 21: overlapping spaces are stacked in one place, mapStack.ts, and nothing orders them by the map array', () => {
  // The plan draws them from the bottom up, so the smaller room takes the press whichever was drawn first.
  assert.ok(editor.includes('stackedSpaces(current).map('), 'the plan draws the spaces as they are stacked');
  assert.doesNotMatch(editor, /nodes\.filter\(\(node\): node is BackgroundSpace/);
  const preview = read('BackgroundMapPlanPreview.tsx');
  assert.ok(preview.includes('stackedSpaces(map).map('), 'the companion plan draws them the same way');
  assert.doesNotMatch(preview, /node\.type === 'space' && <PlanShape/);
  // Floors on one level in 3D are told apart by the same ranks.
  const floor = piece(read('map3dScene.ts'), 'export function pickMapFloor(', 'export function pickMapNode(');
  assert.match(floor, /spaceStackRanks\(map\)/);
  assert.doesNotMatch(floor, /map\.nodes\.findIndex\(/);
  // A new symbol belongs to the topmost space that holds its spot.
  assert.match(handler.placeSymbol(), /spacesAt\(base, point\)\[0\]/);
  assert.doesNotMatch(editor, /reverse\(\)\.find\(/);
});

test('anchor 22: switching between the plan and 3D, and going to another map, leave the selection alone', () => {
  // Several nodes picked on the plan are still picked on the way back: a line that folds them to one for 3D would lose them.
  for (const [name, body] of Object.entries({ switchMode: handler.switchMode(), leave3D: handler.leave3D(), navigate: handler.navigate() }))
    assert.doesNotMatch(body, anyPick, `${name} touches the selection`);
});

test('anchor 23: the 3D view and its companion plan are given one node, and a pick in 3D leaves the group picked on the plan alone', () => {
  // The selection is the stored list without the nodes that are gone, and the one node of the single views is read from it.
  assert.ok(editor.includes('const selection = useMemo(() => mapSelection(current, view.selectedIds), [current, view.selectedIds]);'));
  assert.ok(editor.includes('const singleId = singleViewId(current, selection, view.selectedId);'));
  assert.ok(editor.includes('<Map3D map={current} selectedId={singleId} canEdit={canEdit} onSelect={selectNode}'), 'the 3D view');
  assert.ok(editor.includes('<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode}'), 'the companion plan');
  // Every pick of the editor is this one line. In 3D, on the map on show, pickAction moves only the node the 3D view works on.
  assert.match(handler.select(), /^function select\(id: string \| null, mapId = current\?\.id\) \{\s*if \(mapId\) doc\.dispatch\(pickAction\(mapId, id, mode === '3d' && mapId === current\?\.id, selection\)\);\s*\}/);
  // Nothing picks around it: pickAction alone makes the action that moves the one node, and what the 3D view, the
  // companion plan and the object list report comes in through that line.
  assert.doesNotMatch(editor, /\bdoc\.select\(/);
  assert.doesNotMatch(editor, /pick-one/);
  assert.match(editor, /const selectNode = useEvent\(\(id: string \| null\) => select\(id\)\);/);
  assert.equal(count(editor, /\bdoc\.dispatch\(/g), 1, 'the editor dispatches nowhere else');
  // The list is written in three more places, all of them on the plan: a box, a Shift+click and a group delete.
  assert.equal(count(editor, /\bdoc\.selectMany\(/g), 3);
  // Deleting one node still ends with an empty pick: in 3D that empties the node in hand and keeps the rest of the group.
  assert.match(block(handler.confirmAction(), "if (confirmation === 'delete-node' && selected && canEdit) {"), /select\(null\); setConfirmation\(null\); return;\s*\}$/);
  // The contract of the views that show one node knows one selected id, and so do they.
  for (const name of ['mapCanvas.ts', 'BackgroundMap3D.tsx', 'map3dScene.ts', 'BackgroundMapCameraGizmo.ts', 'BackgroundMapPlanPreview.tsx'])
    assert.doesNotMatch(read(name), /selectedIds/, `${name} knows the group`);
});

test('anchor 24: the tools for one node step back while several are selected on the plan', () => {
  assert.ok(editor.includes('const multiple = selection.ids.length > 1;'));
  assert.ok(editor.includes("const selected = mode === 'plan' && multiple ? undefined : current?.nodes.find(node => node.id === singleId);"));
  // The handles hang on that one node, like the form.
  assert.match(editor, /\{selected && canEdit && !selected\.locked && <MapNodeHandles /);
  // On the plan the summary takes the place of the form. In 3D the form of the one node stays, under one line about the group.
  assert.match(editor, /<\/> : mode === 'plan' && multiple \? <BackgroundMapSelectionSummary /);
  assert.match(editor, /\{mode === '3d' && multiple && <p className="bmap-hint">\{`평면에서 고른 /);
});

test('anchor 25: what a press of the select tool does is decided by resolvePlanPress alone, and the editor carries it out', () => {
  const down = handler.pointerDown();
  assert.equal(count(down, /resolvePlanPress\(/g), 1, 'one decision per press');
  // It is handed the map and the selection as they are at this very moment, and the pile of what the plan draws under the pointer.
  assert.ok(editor.includes('function liveSelection(mapId: string, map: BackgroundMap): MapSelection { return mapSelection(map, mapViewport(doc.getState(), mapId).selectedIds); }'));
  assert.ok(down.includes('const held = liveSelection(current.id, live);'));
  assert.match(down, /resolvePlanPress\(\{ canEdit, shift: event\.shiftKey, hit: hit \?\? null,\s*pile: hit \? planPileAt\(live, hit\.id, point, undefined, item => planMarkCovers\(item, point\)\) : \[\],\s*selection: held, again, node: id => live\.nodes\.find\(item => item\.id === id\) \}\);/);
  // Nothing is decided beside it from the selection of the last render.
  assert.doesNotMatch(down, /view\.selectedId/);
  // What it said is carried out as it is: the node a drag takes, the nodes that travel along, what a release without movement does.
  assert.ok(down.includes('else if (plan) { mode = plan.drag; target = plan.nodeId === null ? undefined : live.nodes.find(item => item.id === plan.nodeId); }'));
  assert.ok(down.includes('groupIds: plan?.groupIds ?? null, click: plan?.click ?? NO_CLICK,'));
  // The node that was pressed is handed over by each of the three kinds of node: without it every press is one on nothing.
  assert.equal(count(editor, /onPointerDown=\{event => pointerDown\(event, node\)\}/g), 3, 'spaces, symbols and cameras');
  // A drag of several nodes is a gesture of its own, with all of them. It is asked for a move, and before the line
  // that takes any drag of a node for a drag of that one node: behind it the group would never be reached.
  inOrder(handler.planGestureOf(), "if (mode === 'move' && node && session.groupIds) return { mode: 'move-group', nodeId: node.id, ids: session.groupIds };",
    "if (node && mode !== 'pan' && mode !== 'marquee' && mode !== 'draw' && mode !== 'vertex') return { mode, nodeId: node.id };");
  // Shift+click puts a new list in place of the selection as it is read right now: the id of a node that is gone is not carried along.
  inOrder(block(handler.pointerUp(), "else if (click.kind === 'toggle') {"), 'const ids = liveSelection(session.mapId, liveMap).ids;',
    'doc.selectMany(session.mapId, ids.includes(click.id) ? ids.filter(id => id !== click.id) : [...ids, click.id]);');
  // The document has no action that adds to the stored list.
  const store = read('mapDocument.ts');
  assert.doesNotMatch(store, /toggle-select/);
  assert.doesNotMatch(store, /add\?:/);
});

test('anchor 26: the wheel button, the hand tool and a held Space move the view, before anything else a press could do', () => {
  const down = handler.pointerDown();
  assert.ok(down.includes("const panning = event.button === 1 || tool === 'hand' || spaceHeld.current;"));
  // What they do: the view follows the pointer, and nothing else is asked of that move.
  assert.ok(handler.pointerMove().includes("if (session.mode === 'pan') { if (first) setPanning(true); updateView({ x: session.view.x - delta.x, y: session.view.y - delta.y }, session.mapId); return; }"));
  // With Space held the polygon tool adds no point and the symbol tool places nothing.
  assert.match(down, /if \(!panning && canEdit && !handle && tool === 'polygon'\) \{\s*setPolygon\(previous => \{/);
  assert.match(down, /if \(!panning && canEdit && !handle && tool === 'symbol'\) \{ placeSymbol\(point, live\); return; \}/);
  assert.equal(count(down, /setPolygon\(/g), 1, 'points are added nowhere else');
  assert.equal(count(down, /placeSymbol\(/g), 1, 'a symbol is placed nowhere else');
  // Nor does the select tool decide anything, so the selection stays. The same goes for a press of any of the five
  // drawing tools while editing: left to the select tool, a click with one of them would pick, toggle or step.
  assert.ok(down.includes("const drawing = canEdit && (isDrawTool(tool) || tool === 'symbol');"));
  assert.match(down, /const plan = panning \|\| drawing \|\| handle \? null : resolvePlanPress\(/);
  // A press with Space held is no half of a double-click, like a press the plan did not log (Shift). The wheel button
  // and the hand tool are logged as before: the hand tool enters a linked space on a double-click.
  assert.match(down, /const press: PlanPress \| null = plan \? \(plan\.logged \? \{ hitId: hit\?\.id \?\? null, targetId: plan\.targetId, handle: false \} : null\)\s*: spaceHeld\.current \? null : \{ hitId: hit\?\.id \?\? null, targetId: handle \? null : hit\?\.id \?\? null, handle: !!handle \};/);
  // The session is a pan unless the block below says otherwise, and its mode is set nowhere outside that block.
  inOrder(down, "let mode: PointerSession['mode'] = 'pan', target = hit;", 'if (!panning) {', "if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;");
  assert.equal(count(block(down, 'if (!panning) {'), /\bmode = /g), 3, 'drawing, what the press was resolved to, a handle');
  assert.equal(count(down, /\bmode = /g), 3, 'no mode is set outside the block');
});

test('anchor 27: the selection box is no gesture of the document: it leaves no undo step, and a cancel takes it away', () => {
  assert.ok(handler.pointerDown().includes("if (mode !== 'pan' && mode !== 'marquee' && !doc.beginGesture(current.id)) return;"));
  // A move only draws the box and never reaches the preview of a gesture. It needs no node and no edit of the map.
  inOrder(handler.pointerMove(), "if (session.mode === 'marquee') { setMarquee(planRect(session.start, point)); return; }", 'if (!canEdit || !session.node) return;', 'previewPlanGesture(');
  // While it is drawn, what it touches is shown as the selection it will become: screen state, and the three kinds of node read it.
  assert.ok(editor.includes('const marqueeIds = useMemo(() => marquee && current ? planMarqueeIds(current, marquee) : null, [marquee, current]);'));
  assert.ok(editor.includes('const shownIds = useMemo(() => new Set(marqueeIds ?? selection.ids), [marqueeIds, selection]);'));
  assert.equal(count(editor, /shownIds\.has\(node\.id\)/g), 3, 'spaces, symbols and cameras');
  // The box itself is drawn whenever there is one, over the snap guides and under the handles.
  inOrder(editor, '<MapSnapGuides guides={guides} scale={screenScale} />', '{marquee && <MapMarquee rect={marquee} />}', '{selected && canEdit && !selected.locked && <MapNodeHandles ');
  // The release selects what the box touches, unless it was cancelled, and writes nothing to the map.
  const up = handler.pointerUp(), box = block(up, "if (session.mode === 'marquee') {");
  inOrder(box, 'setMarquee(null);', 'if (!cancel && session.moved && canEdit) {', 'doc.selectMany(session.mapId, planMarqueeIds(live, planRect(session.start, point)));');
  assert.doesNotMatch(box, /doc\.(?:finishGesture|update)\(|updateMap\(/);
  assert.ok(up.includes("} else if (session.mode !== 'pan') {"), 'the gestures are finished in the other branch');
  assert.match(handler.abortGesture(), /setMarquee\(null\);/);
});

test('anchor 28: Space held for panning is tracked wherever the focus is, and swallowed only where it is nobody\'s key', () => {
  // Built under the two selectors anchor 13 reads, which stay as they are. A checkbox is no text field for Space.
  assert.ok(editor.includes('const tickInputs = \'input:is([type="checkbox"], [type="radio"])\';'));
  assert.ok(editor.includes('const spaceEntry = `:is(${textEntry}):not(${tickInputs})`;'));
  const key = handler.onSpaceKey();
  // The ref is what a press reads; the state only drives the cursor.
  inOrder(key, "if (event.code !== 'Space') return;", 'const hold = (held: boolean) => { if (spaceHeld.current !== held) { spaceHeld.current = held; setSpacePan(held); } };',
    "if (event.type === 'keyup') { hold(false); return; }",
    'const root = rootRef.current, element = event.target instanceof Element ? event.target : null;',
    "if (mode !== 'plan' || !root || root.offsetParent === null || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;",
    'if (element?.closest(spaceEntry)) return;', 'hold(true);',
    'if (element === document.body || (element && root.contains(element) && !element.closest(`${interactive}, summary`))) event.preventDefault();');
  // Tracking never asks where the focus is: right after a button outside the editor was clicked, Space must still be heard.
  assert.doesNotMatch(key.slice(0, key.indexOf('hold(true);')), /root\.contains\(|document\.body/);
  assert.doesNotMatch(key, /closest\(textEntry\)/);
  assert.equal(count(key, /preventDefault\(/g), 1, 'swallowed on that one line only');
  // That root is the editor itself. With the ref on nothing, or with another element read for it, the tracking line
  // would turn every Space away (no root) or ask the wrong element whether the plan is on show.
  assert.match(editor, /<div className="bmap-layout" ref=\{rootRef\} /);
  // Heard on the window, in the capture phase: the press moves the focus to the canvas, and the release must still be seen.
  const effect = piece(editor, 'const release = () => {', '}, [onSpaceKey]);');
  assert.match(effect, /^const release = \(\) => \{ if \(spaceHeld\.current\) \{ spaceHeld\.current = false; setSpacePan\(false\); \} \};/);
  for (const listener of ["'keydown', onSpaceKey, true", "'keyup', onSpaceKey, true", "'blur', release"]) {
    assert.ok(effect.includes(`window.addEventListener(${listener});`), `listens: ${listener}`);
    assert.ok(effect.includes(`window.removeEventListener(${listener});`), `lets go: ${listener}`);
  }
  // The rule lives in one place: keyboard() has no Space of its own.
  assert.doesNotMatch(handler.keyboard(), /'Space'/);
  // The hand cursor of a held Space is not shown over a drag that Space did not start.
  assert.ok(canvasTag().includes("spacePan && !gestureActive && !marquee ? ' is-space-pan'"));
});

test('anchor 29: several selected nodes are deleted and locked together, on the plan only, and the keyboard is back on the canvas afterwards', () => {
  // What the summary counts and the group actions work on: the selected nodes, in map order.
  assert.ok(editor.includes('const groupNodes = useMemo(() => current ? current.nodes.filter(node => selection.ids.includes(node.id)) : [], [current, selection]);'));
  // The summary is given those nodes, offers the group actions only while editing, and its × empties the selection.
  assert.ok(editor.includes('<BackgroundMapSelectionSummary nodes={groupNodes} canAct={canEdit} disabled={disabled} onClear={() => select(null)}'));
  // Its delete button asks about the group: asked about one node, the dialog would confirm and delete nothing.
  assert.ok(editor.includes("onDelete={() => { setError(''); setConfirmation('delete-group'); }} />"));
  // The whole group goes to removeMapNodes in one update, which leaves the locked ones. What stayed is still selected.
  const group = block(handler.confirmAction(), "if (confirmation === 'delete-group' && canEdit) {");
  inOrder(group, 'const next = removeMapNodes(source, selection.ids); updateMap(next);',
    'doc.selectMany(current.id, selection.ids.filter(id => next.nodes.some(node => node.id === id)));', 'focusAfterConfirm.current = true; setConfirmation(null); return;');
  assert.equal(count(group, /updateMap\(/g), 1, 'one undo step');
  // The canvas takes the focus once the dialog is gone: while it is open nothing outside it can.
  assert.ok(editor.includes('useEffect(() => { if (!confirmation && focusAfterConfirm.current) { focusAfterConfirm.current = false; focusCanvas(); } }, [confirmation]);'));
  // What both callers rely on: the canvas of the mode on show really takes the focus.
  assert.ok(editor.includes("function focusCanvas() { (mode === 'plan' ? svgRef.current : stageRef.current)?.focus({ preventScroll: true }); }"));
  // A lock button disables itself with its own click, and the keys of a disabled button reach nothing.
  assert.match(editor, /onLock=\{locked => \{\s*updateMap\(lockMapNodes\(current, selection\.ids, locked\)\); focusCanvas\(\);\s*\}\}/);
  // Delete: the picked point, then the one node, then the group. In 3D only the one node.
  inOrder(handler.keyboard(), "if (event.key === 'Delete' && activeIndex !== null", "if (selected && !selected.locked) { event.preventDefault(); setConfirmation('delete-node'); }",
    "else if (mode === 'plan' && multiple && groupNodes.some(node => !node.locked)) { event.preventDefault(); setConfirmation('delete-group'); }");
});

test('anchor 30: Escape cancels a selection box like any drag, and never clears the selection', () => {
  const escape = block(handler.keyboard(), "if (event.key === 'Escape') {");
  // A box is no gesture of the document, so it is asked for by its own name. The tool is left as it is.
  inOrder(escape, "if (pointerRef.current?.mode === 'marquee' || doc.isGestureActive()) { abortGesture(); return; }", "setPolygon([]); setTool('select');");
  assert.doesNotMatch(escape, anyPick, 'Escape touches the selection');
});

test('anchor 31: in 3D a click steps to the space underneath only on the same spot again, and never as the second click of a double click', () => {
  // A release carries no click count: the mousedown of the same press does.
  assert.ok(viewport.onMouseDown().includes('this.press.repeat = event.detail >= 2'));
  // One function for every pick. The first click remembers what it was aimed at, the second never overwrites it, and
  // the spot is written before the selection is reported: the props that come back must find it.
  inOrder(viewport.pick(), 'const again = top !== null && this.turn?.hitId === top && this.turn.pickedId === selectedId;',
    'if (!repeat) this.aimed = mapClickAim(props.map, selectedId, hits, again);', 'else if (this.opens(this.doubleClickNode(hits))) return;',
    'resolveMapClick(props.map, selectedId, hits, again, repeat)', 'this.turn = top === null ? null : { hitId: top, pickedId: next };', 'props.onSelect(next);');
  assert.equal(count(view3d, /resolveMapClick\(/g), 1, 'what a click picks is decided in one place');
  // A click with another tool, while placing or while looking through a camera is no pick: nothing of the last one is kept.
  inOrder(viewport.click(), "if (this.look || props.placing || props.tool !== 'select') { this.aimed = null; this.turn = null; }", 'this.pick(clientX, clientY, repeat, false);');
  // A press on a handle goes through the same function, with its click count.
  assert.match(viewport.clickHandle(), /^private clickHandle\(clientX: number, clientY: number, repeat: boolean\): void \{ this\.pick\(clientX, clientY, repeat, true\); \}\s*$/);
  const up = viewport.onPointerUp();
  assert.ok(up.includes('this.clickHandle(event.clientX, event.clientY, press.repeat);'), 'the count of a handle click');
  assert.ok(up.includes('this.click(event.clientX, event.clientY, press.repeat);'), 'the count of a click');
  // The dblclick is about the same node as the second click. The editor enters that space and picks it on the way, as
  // on the plan: the look tool picks nothing.
  assert.ok(viewport.onDoubleClick().includes('this.doubleClickNode('));
  assert.match(editor, /const openSpaceFrom3D = useEvent\(\(id: string\) => \{ if \(tool !== 'symbol'\) openSpace\(id, tool !== 'hand'\); \}\);/);
  // And that is what the 3D view is given: handed openSpace itself, it would enter without picking, and with the symbol tool too.
  assert.ok(editor.includes('onOpenSpace={openSpaceFrom3D}'));
  // A selection made some other way, and another map, end what was remembered.
  const update = viewport.update();
  assert.ok(update.includes('if (this.turn && props.selectedId !== this.turn.pickedId) this.turn = null;'));
  assert.ok(block(update, 'if (mapChanged) {').includes('this.aimed = null; this.turn = null;'));
  // The rule itself: resolveMapClick hands both answers on, the floors are a pile only under `again`, and a repeated click keeps the selected space.
  const scene = read('map3dScene.ts');
  assert.ok(piece(scene, 'export function resolveMapClick(', 'export function mapClickAim(').includes('return mapClickStep(map, selectedId, hits, again, repeat).next;'));
  const step = piece(scene, 'function mapClickStep(', 'export function resolveMapClick(');
  inOrder(block(step, "if (map.nodes.some(node => node.id === selectedId && node.type === 'space')) {"), 'if (!again) return plain;', 'pile = mapSpacePile(hits, map);',
    'if (repeat) return pile.includes(selectedId) && pile.includes(picked) ? { picked, next: selectedId, stepped: false } : plain;');
  assert.equal(count(step, /mapSpacePile\(/g), 1, 'the spaces are a pile nowhere else');
  assert.equal(count(step, /mapFloorPile\(/g), 0, 'the click never reads the floors alone');
});

test('anchor 32: the stacking and press modules stay pure: no three.js, no DOM', () => {
  for (const name of ['mapStack.ts', 'mapPlanSelect.ts']) {
    const source = read(name);
    assert.doesNotMatch(source, /from\s+['"]three/, `${name} imports three.js`);
    assert.doesNotMatch(source, /\b(?:document|window)\.\w/, `${name} touches the DOM`);
  }
});

test('anchor 33: the same spot pressed again is told from one memory, read and emptied by every press and written by the release of a press that picked or moved its node', () => {
  const down = handler.pointerDown();
  // Read before this press is logged: an emptied press log (a press outside the canvas since then) ends the memory too.
  inOrder(down, 'const spot = pressLog.current[1] ? lastSpot.current : null; lastSpot.current = null;',
    'const again = sameSpotAgain(spot, current.id, hit?.id ?? null, held);', 'resolvePlanPress(', 'pressLog.current = press ?');
  assert.ok(down.includes('spotId: plan?.logged && hit ? hit.id : null'));
  // A press dragged into a pan or a box picked nothing on its spot and writes none. A node that was moved keeps its spot.
  const up = handler.pointerUp();
  inOrder(block(up, "if (!cancel && session.spotId !== null && !(session.moved && session.mode !== 'move')) {"), 'const left = liveSelection(session.mapId, liveMap);',
    'lastSpot.current = { mapId: session.mapId, hitId: session.spotId, pickedId: left.ids.length === 1 ? left.primaryId : null };');
  assert.equal(count(editor, /session\.spotId !== null/g), 1, 'asked under that one condition');
  // The step of the click is what the press left selected: the next press on the spot goes on from it.
  inOrder(piece(canvasTag(), 'onClick={event => {', '}}'), 'select(next, cycle.mapId);',
    'if (lastSpot.current?.mapId === cycle.mapId) lastSpot.current = { ...lastSpot.current, pickedId: next };');
  assert.equal(count(editor, /lastSpot\.current\s*=(?!=)/g), 3, 'emptied by the press, written by the release, corrected by the step');
});

test('anchor 34: on the companion plan a click steps to the space underneath only on the same spot again, and never as a repeated click', () => {
  const preview = read('BackgroundMapPlanPreview.tsx');
  // A click carries its point and its count. A keyboard pick carries neither.
  assert.ok(preview.includes('onActivate(node.id, true, clickPoint(event), event.detail >= 2)'));
  // Told apart by the second argument: taken for a click, a keyboard pick would step through piles and write the spot memory.
  assert.ok(preview.includes('event.preventDefault(); event.stopPropagation(); onActivate(node.id, false);'), 'a keyboard pick is no click');
  const activate = piece(preview, 'const activate = useCallback<Activate>(', '}, []);');
  // Only a click leaves a spot behind, and it is written before the selection is reported.
  inOrder(activate, 'const again = cycle && turn.current?.hitId === id && turn.current.pickedId === now.selectedId;',
    'turn.current = cycle ? { hitId: id, pickedId: next } : null;', 'now.onSelect(next);');
  assert.match(activate, /nextPlanSelection\([^;]*, point, again, repeat\) : id;/);
  assert.equal(count(preview, /nextPlanSelection\(/g), 1, 'what a click picks is decided in one place');
  // A selection made elsewhere ends the memory, and so does a press that is no left press on this plan.
  assert.ok(preview.includes('if (turn.current && turn.current.pickedId !== selectedId) turn.current = null;'));
  assert.match(preview, /const forget = \(event: PointerEvent\) => \{\s*if \(!\(event\.target instanceof Node\) \|\| !svgRef\.current\?\.contains\(event\.target\) \|\| !event\.isPrimary \|\| event\.button !== 0\) turn\.current = null;\s*\};\s*window\.addEventListener\('pointerdown', forget, true\);\s*return \(\) => window\.removeEventListener\('pointerdown', forget, true\);/);
  // Without the ref on the plan every press would be one outside it.
  assert.match(preview, /<svg className="bmap-plan-svg" ref=\{svgRef\} /);
  // The rule itself: the spaces are a pile only with a point and `again`, and a repeated click keeps the selected one.
  const next = piece(read('mapPlanPreview.ts'), 'export function nextPlanSelection(', 'export function planNumber(');
  inOrder(block(next, "if (map.nodes.find(node => node.id === hitId)?.type === 'space') {"), 'if (!point || !again) return hitId;',
    'const pile = planPileAt(map, hitId, point, tolerance, covers);', 'if (repeat) return selectedId;', 'return pile[(pile.indexOf(selectedId) + 1) % pile.length];');
  assert.equal(count(next, /planPileAt\(/g), 1, 'the spaces are a pile nowhere else');
});

test('anchor 35: in 3D the memory of the spot ends with every press that picked nothing there, as on the plan', () => {
  // A press anywhere but on the canvas. On the window and in the capture phase, so one that stops its own propagation is heard too.
  assert.ok(viewport.start().includes("window.addEventListener('pointerdown', this.onPressElsewhere, true);"));
  assert.ok(viewport.dispose().includes("window.removeEventListener('pointerdown', this.onPressElsewhere, true);"));
  assert.match(viewport.onPressElsewhere(), /^private readonly onPressElsewhere = \(event: PointerEvent\): void => \{ if \(event\.target !== this\.canvas\) this\.turn = null; \};\s*$/);
  // Another button on the canvas: the right one turns the world, the wheel button moves it.
  inOrder(viewport.onPointerDown(), 'this.press = event.isPrimary && event.button === 0', 'if (!this.press) this.turn = null;');
  // A left drag that was no gizmo drag. A gizmo drag keeps the memory, like a move on the plan.
  assert.match(block(viewport.onPointerUp(), 'if (press.moved || Math.hypot(event.clientX - press.x, event.clientY - press.y) >= CLICK_SLOP) {'),
    /\{\s*this\.lastDragAt = performance\.now\(\);\s*if \(!press\.gizmo\) this\.turn = null;\s*return;\s*\}$/);
  // A cancelled drag and a cancelled press.
  assert.ok(viewport.start().includes('onCancelGesture: () => { if (this.press) this.press.moved = true; this.turn = null; this.props.onCancelGesture(); },'));
  assert.match(viewport.onPointerCancel(), /^private readonly onPointerCancel = \(\): void => \{ this\.press = null; this\.turn = null; \};\s*$/);
  // These five and the three of anchor 31 (a click that is no pick, another selection, another map): it ends nowhere else.
  assert.equal(count(view3d, /this\.turn = null/g), 8);
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

// Numbered past 21-35 as well.
test('anchor 38: Delete is not heard from inside an open dialog, for a point, a node or a group', () => {
  // A dialog is a React child of the editor, so its keys reach keyboard(). The guard for buttons and fields lets the
  // disclosure line of a dialog (a summary) through. Nodes deleted under the open settings dialog would come back
  // with its save, which writes the map as it was when the dialog opened.
  const keys = handler.keyboard();
  const pointBranch = keys.indexOf("if (event.key === 'Delete'"), nodeLine = keys.indexOf("if (event.key === 'Delete'", pointBranch + 1);
  assert.ok(pointBranch > -1 && nodeLine > pointBranch, 'the point branch and the line that deletes nodes are both there');
  // The point branch looks for itself: it comes before the return below, and a Delete it does not take goes on.
  assert.match(keys.slice(pointBranch, nodeLine), /^if \(event\.key === 'Delete' && activeIndex !== null && .*&& !target\.closest\('dialog'\)\) \{/);
  // The line that asks about one node or about the group is reached only past a return for dialogs: nothing but
  // comments stands between the two.
  assert.match(keys.slice(0, nodeLine), /if \(target\.closest\('dialog'\)\) return;\s*$/);
  // Both questions are asked there, and nowhere else in keyboard().
  inOrder(keys.slice(nodeLine), "setConfirmation('delete-node')", "setConfirmation('delete-group')");
  assert.equal(count(keys, /setConfirmation\('delete-(?:node|group)'\)/g), 2);
});

// Numbered past 21-35 as well.
test('anchor 39: on the companion plan a left press that never became a click there ends the spot memory', () => {
  // The press listener lets a left press on the plan through: the click that follows needs the memory. Dragged off the
  // plan and released there, that press is no click on the plan (the click goes to what holds both ends), and nothing
  // was pressed elsewhere either. Without this listener the next slow click on the same room would step down.
  const preview = read('BackgroundMapPlanPreview.tsx');
  const effect = piece(preview, 'const release = (event: PointerEvent) => {', '}, []);');
  // A release on the plan is the release of a click and keeps the memory. A cancelled press ends it wherever it was.
  assert.match(effect, /^const release = \(event: PointerEvent\) => \{\s*if \(event\.type === 'pointercancel' \|\| !\(event\.target instanceof Node\) \|\| !svgRef\.current\?\.contains\(event\.target\)\) turn\.current = null;\s*\};/);
  // On the window, in the capture phase, like the press listener: a release over a portal or over the 3D canvas is heard too.
  for (const type of ['pointerup', 'pointercancel']) {
    assert.ok(effect.includes(`window.addEventListener('${type}', release, true);`), `${type} is listened for`);
    assert.ok(effect.includes(`window.removeEventListener('${type}', release, true);`), `${type} is let go of`);
  }
  inOrder(effect, "window.addEventListener('pointercancel', release, true);", 'return () => {', "window.removeEventListener('pointerup', release, true);");
  // It stands next to the press listener and takes nothing from it: that one still forgets on the press alone.
  inOrder(preview, 'const forget = (event: PointerEvent) => {', "window.addEventListener('pointerdown', forget, true);",
    "return () => window.removeEventListener('pointerdown', forget, true);", 'const release = (event: PointerEvent) => {', 'const activate = useCallback<Activate>(');
});

// 40-49: the new map elements (stairs, roads, camera colours) and the update notice.
test('anchor 40: the road tool is a drawing tool, and one drag with it draws a rectangle that carries the road key', () => {
  assert.match(editor, /type Tool = (?:'[a-z]+' \| )*'road'(?: \| '[a-z]+')*;/);
  // Counted with the drawing tools: going to 3D puts the select tool back, and a press with it is no press of the select tool.
  assert.ok(editor.includes("const isDrawTool = (tool: Tool) => tool === 'rect' || tool === 'ellipse' || tool === 'polygon' || tool === 'road';"));
  // Offered with them: on the plan, while editing.
  assert.match(editor, /\.\.\.\(editing \? \[[^\]]*\{ id: 'road' as const, label: '도로', title: '도로: 끌어서 곧은 길 그리기 · 꺾이는 길은 그린 뒤 다각형으로 바꿔 점을 다듬어요', icon: '═' \}\] : \[\]\)/);
  // The drag of a rectangle, told to be a road.
  assert.ok(handler.pointerDown().includes("if (canEdit && (tool === 'rect' || tool === 'ellipse' || tool === 'road')) { mode = 'draw'; target = newSpace(tool === 'road' ? 'rect' : tool, point, tool === 'road'); }"));
  const make = piece(editor, 'function newSpace(', 'function finishPolygon(');
  assert.ok(make.includes("name: road ? '새 도로' : '새 공간'"));
  // The key is there for a road and absent for a room. Written as `undefined` it would stay in the node, and the save would be refused.
  assert.ok(make.includes("...(road ? { surface: 'road' as const } : {})"));
  assert.doesNotMatch(make, /\bsurface:\s*road\b/);
});

test('anchor 41: a road is drawn by the one pass that draws every space, its centre line under its name, on the plan and on the companion plan, and it is called a road wherever a space is named', () => {
  // The plan. Rooms and roads come out of one pass over the stack: a pass of their own would draw the roads twice, or out of the stack.
  assert.equal(count(editor, /\bstackedSpaces\(/g), 1, 'one pass over the stack');
  assert.ok(editor.includes('stackedSpaces(current).map('));
  assert.equal(count(editor, /\bbmap-space(?!-)/g), 1, 'one line draws a space');
  assert.equal(count(editor, /shownIds\.has\(node\.id\)/g), 3, 'spaces, symbols and cameras');
  const spaces = piece(editor, '{stackedSpaces(current).map(node => {', '{current.nodes.filter((node): node is BackgroundSymbol');
  assert.ok(spaces.includes('road = isRoadSpace(node), centre = roadCentreLine(node);'));
  assert.ok(spaces.includes("${road ? 'is-road ' : ''}"));
  // A polyline, so the fill rule of a space (rect, ellipse, polygon) does not reach it. After the shape and before the
  // name: the outline behind the letters of the name covers the line, never the other way round.
  inOrder(spaces, '<rect width={node.width} height={node.height} rx={road ? 0 : 4} />', '{centre && <polyline className="bmap-road-line" fill="none" points={centre.map(', '<text');
  assert.equal(count(editor, /bmap-road-line/g), 1, 'the centre line is drawn in that one place');
  // That outline: without it the line strikes the name through, and with a fixed width it thins away on a zoomed-out plan.
  const nameRule = read('backgrounds-map.css').split('\n').filter(line => line.startsWith('.bmap-space.is-road text {'));
  assert.equal(nameRule.length, 1, 'the name of a road has one rule of its own');
  assert.ok(nameRule[0].includes('paint-order:stroke'), nameRule[0]);
  assert.match(nameRule[0], /stroke-width:[^;]*var\(--bmap-label-scale/);
  // The companion plan. Nothing else tells it a road from a room: without these it draws a road as a room.
  const preview = read('BackgroundMapPlanPreview.tsx'), shape = piece(preview, 'const PlanShape = memo(function PlanShape(', 'function VerticalMark(');
  assert.ok(shape.includes("const road = node.type === 'space' && isRoadSpace(node), centre = node.type === 'space' ? roadCentrePlanLine(node) : null;"));
  assert.ok(shape.includes("${road ? ' is-road' : ''}"));
  inOrder(shape, '<polygon', '{centre && <polyline className="bmap-plan-road-line" fill="none" points={pointList(centre)} />}');
  assert.ok(preview.includes("isRoadSpace(selected) ? '선택한 도로' : '선택한 공간'"));
  // The words. The kind in the object list and in the name box, the heading of the inspector, the icon in the list.
  assert.ok(piece(editor, 'const kindLabel = ', 'const ObjectList = memo(function ObjectList(').includes("node.type === 'space' ? (isRoadSpace(node) ? '도로' : '공간')"));
  assert.ok(editor.includes("selected.type === 'space' ? (isRoadSpace(selected) ? '선택한 도로' : '선택한 공간')"));
  assert.ok(piece(editor, 'const ObjectList = memo(function ObjectList(', 'export function BackgroundMapEditor(').includes("isRoadSpace(node) ? '═' : node.shape === 'ellipse'"));
  // A road whose shape has no centre line says why, right where that line is computed: the line goes away with one more point.
  assert.ok(editor.includes("const ROAD_HINT_ROUND = '둥근 도로에는 가운데 점선이 없어요.';"));
  assert.match(editor, /const ROAD_HINT_NO_STRIP = '가운데 점선은 길 양쪽 옆줄의 점이 같은 수로 서로 마주 볼 때 보여요\.[^']*';/);
  assert.ok(editor.includes(`{isRoadSpace(selected) && !roadCentreLine(selected) && <p className="bmap-hint">{selected.shape === 'ellipse' ? ROAD_HINT_ROUND : ROAD_HINT_NO_STRIP}</p>}`));
  assert.ok(editor.includes("{isRoadSpace(selected) ? '꺾이는 길은 다각형으로 바꾼 뒤 점을 끌어 만들어요.' : '꼭짓점을 끌어 ㄱ자 같은 모양으로 고칠 수 있어요.'}"));
  // A road under another space cannot be pressed there: the hint of every road ends with how to get hold of it.
  assert.match(editor, /const ROAD_HINT = '[^']*다른 공간에 덮인 도로는 그 자리를 천천히 한 번 더 누르거나 오른쪽 목록에서 골라요\.';/);
  assert.ok(editor.includes('<p className="bmap-hint">{isRoadSpace(selected) ? ROAD_HINT : '));
});

test('anchor 42: roads are a layer of their own under every room, asked before the areas are compared', () => {
  const stacked = piece(read('mapStack.ts'), 'export function stackedSpaces(', 'export function spaceStackRanks(');
  assert.ok(stacked.includes('layer: isRoadSpace(space) ? 0 : 1'));
  // Asked after the area, only a road larger than every room would lie under them.
  assert.ok(stacked.includes('entries.sort((a, b) => a.layer !== b.layer ? a.layer - b.layer : a.area === b.area ? a.index - b.index : b.area - a.area)'));
  assert.equal(count(stacked, /\.sort\(/g), 1, 'sorted once');
});

test('anchor 43: the surface of a space and the colour of a camera are changed by two pure functions alone, and the default is the key taken away', () => {
  // A road just drawn gets its key from newSpace (anchor 40). On a node that is there, each key has one writer.
  const surface = piece(editor, 'function changeSpaceSurface(', 'function changeCameraColor('), colour = piece(editor, 'function changeCameraColor(', 'function duplicateSymbol(');
  // The same node back means nothing changed: no update and no undo step.
  inOrder(surface, 'const next = setSpaceSurface(selected, surface);', 'if (next !== selected) updateMap(replaceMapNode(current, next));');
  inOrder(colour, 'const next = setCameraColor(selected, color);', 'if (next !== selected) updateMap(replaceMapNode(current, next));');
  assert.equal(count(editor, /\bsetSpaceSurface\(/g), 1); assert.equal(count(editor, /\bsetCameraColor\(/g), 1);
  assert.ok(editor.includes("onChange={event => changeSpaceSurface(event.target.value === 'road' ? 'road' : null)}"));
  assert.ok(editor.includes('onChange={changeCameraColor}'));
  // patchNode merges: it can write a key and never take one away. A key left as `undefined` or `null` is refused by the save.
  assert.doesNotMatch(editor, /patchNode\(\{\s*(?:surface|color)\b/);
  assert.doesNotMatch(editor, /\b(?:surface|color):\s*(?:undefined|null)\b/);
  const geometry = read('mapGeometry.ts');
  const setSurface = piece(geometry, 'export function setSpaceSurface(', 'export function setCameraColor('), setColour = piece(geometry, 'export function setCameraColor(', 'export function containsPoint(');
  assert.ok(setSurface.includes('delete next.surface'));
  assert.ok(setColour.includes('delete next.color'));
  assert.doesNotMatch(`${setSurface}${setColour}`, /\b(?:surface|color):\s*(?:undefined|null)\b/);
});

test('anchor 44: a road has a floor level and no height: no field for it, nothing written to it from 3D, no handle that sizes it, and its floor is drawn under the floors of the rooms', () => {
  assert.ok(editor.includes("const selectedRoad = selected?.type === 'space' && isRoadSpace(selected);"));
  assert.ok(editor.includes('{!selectedRoad && <NumberField label="입체 높이" '));
  assert.equal(count(editor, /label="입체 높이"/g), 1, 'the height field is drawn in that one branch');
  // The box height of a gizmo result is never stored for a road: one stored while it was a room stays as it is.
  assert.ok(piece(read('mapGeometry.ts'), 'export function applyNodeWorldPose(', 'export function stackedMapNodeIds(')
    .includes("volumeHeight: node.type === 'space' && isRoadSpace(node) ? null : settle(volumeHeight * scale.y,"));
  // The size handles leave the vertical axis out: the viewport says the node is flat, and the gizmo passes it on.
  assert.ok(piece(view3d, 'private applyGizmo(', 'private applyOrbit(').includes("flat: node.type === 'space' && isRoadSpace(node)"));
  assert.ok(piece(read('BackgroundMapCameraGizmo.ts'), 'setTarget(target: MapGizmoTarget | null, mode: Map3DGizmoMode): boolean {', 'detach(): void {')
    .includes('const setup = target ? mapGizmoSetup(target.type, mode, target.flat) : null;'));
  const scene = read('map3dScene.ts');
  // Two see-through floors on one level, drawn in an order that depends on the view, would flicker where they overlap.
  assert.ok(piece(scene, 'private buildSpace(', 'private buildSymbol(').includes('floor.renderOrder = road ? -1.5 : -1;'));
  // The world box holds the floor of a road and no walls.
  assert.ok(piece(scene, 'export function mapWorldBounds(', 'export function fitMapView(').includes("node.type === 'space' ? spaceWallHeight(node) : nodeVolumeHeight(node)"));
});

test('anchor 45: the colour of a camera is picked from six circles and a text button, and every view that draws the camera is told its colour', () => {
  // The inspector: in the camera branch, while editing.
  assert.equal(count(editor, /<BackgroundMapCameraColor\b/g), 1);
  assert.ok(piece(editor, "{selected.type === 'camera' && (() => {", "{selected.type === 'symbol' && <section")
    .includes('{editing && <BackgroundMapCameraColor color={selected.color} disabled={fieldLocked} onChange={changeCameraColor} />}'));
  // A circle for each row of the colour table and no other: the amber is no colour to pick, it is a camera without the key.
  const field = read('BackgroundMapCameraColor.tsx');
  assert.equal(count(field, /className="bmap-color-swatch"/g), 1, 'one line draws the circles');
  assert.match(field, /\{MAP_CAMERA_COLORS\.map\(item => <button [^<>]*className="bmap-color-swatch" data-camera-color=\{item\.id\} aria-pressed=\{color === item\.id\} /);
  // The way back to the default is a text button, the last button of the row.
  const reset = field.match(/<button (?:(?!<button )[\s\S])*>기본 색으로<\/button>/)?.[0] ?? '';
  assert.ok(reset, 'the text button was found');
  assert.doesNotMatch(reset, /bmap-color-swatch/);
  assert.ok(reset.includes('onClick={() => { if (color !== undefined) onChange(null); }}'));
  // With nothing to reset it is dimmed, not switched off: its own click would switch it off under the focus, and the
  // keys of the editor would reach nothing. Only a locked camera or a running save switches it off.
  assert.ok(reset.includes('aria-disabled={color === undefined}'));
  assert.match(reset, /(?<!aria-)disabled=\{disabled\}/);
  assert.equal(count(reset, /disabled=/g), 2, 'the dimmed state and the switch, each once');
  // The plan: the camera and its direction handle. The object list: the icon of a camera.
  assert.match(editor, /<g key=\{node\.id\} className=\{`bmap-camera [^`]*`\} data-camera-color=\{node\.color\} /);
  assert.ok(editor.includes("<span className={`bmap-node-kind is-${node.type}`} data-camera-color={node.type === 'camera' ? node.color : undefined} "));
  assert.equal(count(editor, /data-camera-color=/g), 2);
  assert.ok(overlays.includes('<g className="bmap-handles" data-camera-color={node.color} '));
  // The companion plan: the camera, its readout with the side view, and what is drawn for the selected camera outside its own button.
  const preview = read('BackgroundMapPlanPreview.tsx');
  assert.ok(preview.includes("<g className={`bmap-plan-node bmap-plan-camera${node.locked ? ' is-locked' : ''}`} data-camera-color={node.color} "));
  assert.ok(preview.includes('<div className="bmap-plan-readout is-camera" data-camera-color={camera.color} '));
  assert.ok(preview.includes("const selectedColor = selected?.type === 'camera' ? selected.color : undefined;"));
  assert.ok(preview.includes('<g className="bmap-plan-selected bmap-plan-camera" data-camera-color={selectedColor} '));
  assert.equal(count(preview, /<p className="bmap-plan-note" data-camera-color=\{selectedColor\}>/g), 2, 'the two notes of the selected camera');
  assert.equal(count(preview, /data-camera-color=/g), 5);
  // 3D: the colour is part of what a camera is built from, so a new colour builds it again.
  const scene = read('map3dScene.ts');
  assert.match(piece(scene, 'function shapeKey(', 'function labelSpec('), /if \(node\.type === 'camera'\) return `camera\|[^`]*\|\$\{node\.color \?\? ''\}`;/);
  // Six materials take the colour. The lens stays dark, and the invisible click target is one material for every camera.
  const build = piece(scene, 'private buildCamera(', 'function boxEdges(');
  assert.ok(build.includes('const tint = node.color;'));
  const calls = [...build.matchAll(/this\.material\(([^()]*)\)/g)].map(match => match[1]);
  assert.equal(calls.length, count(build, /this\.material\(/g), 'every material of a camera was read');
  assert.deepEqual(calls.filter(call => !call.endsWith(', tint')).sort(), ["'cameraLens'", "'proxy'"]);
  assert.deepEqual(calls.filter(call => call.endsWith(', tint')).flatMap(call => call.match(/'\w+'/g) ?? []).sort(),
    ["'camera'", "'cameraFar'", "'cameraFarOn'", "'cameraLine'", "'cameraLineOn'", "'cameraRing'"]);
});

test('anchor 46: stored data this version does not know is refused whole and turns the update notice on: nothing is drawn under it, nothing is saved, and the reason is logged once', () => {
  const domain = read('domain.ts');
  // An unknown key is refused, never dropped: a map read around it would be saved back without it.
  assert.ok(piece(domain, 'function onlyKeys(', 'function commandSize(').includes("if (unknown.length) throw new BackgroundUnsupportedError('지원하지 않는 배경 속성이 포함되어 있습니다.',"));
  // The operator, not the 'delete' of a request.
  assert.doesNotMatch(domain, /\bdelete\b(?!')/);
  const store = read('useBackgroundStore.ts');
  const refresh = piece(store, 'refresh:async(', 'execute:async('), execute = piece(store, 'execute:async(', 'export const useBackgroundStore');
  // A read that fails that way is no error on screen. The reason goes to the console as the notice turns on, and not
  // again while it is on: the screen reads every 15 seconds and would repeat the line.
  inOrder(refresh, 'error instanceof BackgroundUnsupportedError', "if (!get().updateRequired) console.warn('[background] update required:', error.message, error.detail);",
    'set({ loading: false, updateRequired: true, error: null });');
  // A save is turned away right after the login check, before anything is applied or sent.
  inOrder(execute, "throw new Error('로그인이 필요합니다.');", "if (get().updateRequired) throw new Error('앱을 업데이트한 뒤 다시 저장해 주세요.');", 'applyBackgroundCommand(', 'active.execute(');
  inOrder(execute, "if (!get().updateRequired) console.warn('[background] update required:', unsupported.message, unsupported.detail);",
    'set({ snapshot: restored, pending: false, updateRequired: true, error: null });');
  assert.equal(count(store, /console\.warn\('\[background\] update required:'/g), 2, 'the failed read and the failed save');
  assert.equal(count(store, /if \(!get\(\)\.updateRequired\) console\.warn\(/g), 2, 'each only as the notice turns on');
  assert.equal(count(store, /console\.warn\(/g), 2, 'nothing else is logged');
  // The screen: the notice stands in place of the tabs, the error strip and every panel. With the editor still drawn
  // under it the map could be seen and edited.
  const view = read('BackgroundLibraryView.tsx'), [at] = positions(view, '{updateRequired ? (');
  const head = view.slice(0, at), notice = piece(view.slice(at), '{updateRequired ? (', ') : ('), rest = piece(view.slice(at), ') : (', '</section>');
  assert.ok(notice.includes('<h3>업데이트가 필요해요</h3>'));
  assert.match(notice, /onClick=\{\(\) => void refresh\(\)\}>다시 확인<\/button>/);
  for (const part of ['<nav className="bg-library-tabs"', 'className="bg-error bg-global-error"', '<div className="bg-library-body"', '<BackgroundMapEditor']) {
    assert.ok(rest.includes(part), `drawn where there is no notice: ${part}`);
    assert.ok(!head.includes(part) && !notice.includes(part), `drawn beside the notice: ${part}`);
  }
  // That other branch opens with the tabs and runs to the end of the screen: nothing follows it that is drawn either way.
  assert.match(rest, /^\) : \(\s*<>\s*<nav className="bg-library-tabs"[\s\S]*<\/>\s*\)\}\s*$/);
});

test('anchor 47: the colour table and the spatial module stay pure: no three.js, no DOM', () => {
  for (const name of ['mapCameraColor.ts', 'mapSpatial.ts']) {
    const source = read(name);
    assert.doesNotMatch(source, /from\s+['"]three/, `${name} imports three.js`);
    assert.doesNotMatch(source, /\b(?:document|window)\.\w/, `${name} touches the DOM`);
  }
});

test('anchor 48: a symbol kind that is not listed falls back to the generic object by its name, and the stairs have a drawing of their own', () => {
  const catalog = read('symbolCatalog.ts');
  // By name: by position, the next kind added at the end of the list would be what every removed kind turns into.
  assert.ok(catalog.includes('?? symbolCatalog.find(item => item.id === "custom")!;'));
  assert.doesNotMatch(catalog, /symbolCatalog\.length - 1/);
  assert.doesNotMatch(catalog, /symbolCatalog\s*(?:\[|\.at\()/);
  // The annotation keeps `id` a stored kind: without it the id of a preset is any string, and what is built from it no longer compiles.
  assert.ok(catalog.includes('export const symbolCatalog: ReadonlyArray<{'));
  // No test imports the drawing. Without this branch the stairs are an empty group: nothing on the plan, and an empty icon
  // in the toolbar, the palette, the object list and the inspector.
  const glyph = read('BackgroundSymbolGlyph.tsx'), stairs = piece(glyph, '{symbol === "stairs" && (', '{symbol === "custom" && (');
  assert.ok(stairs.includes('d="M10 19.33H90M10 34.67H90M10 50H90M10 65.33H90M10 80.67H90"'), 'the five treads');
  assert.ok(stairs.includes('d="M50 86V16M40 28L50 14L60 28"'), 'the arrow up the stairs');
  // The lines of the stairs are in drawing units like those of every other symbol: they grow and shrink with the box.
  assert.doesNotMatch(glyph, /<pattern/);
  assert.doesNotMatch(glyph, /vectorEffect|vector-effect/);
});

test('anchor 49: in 3D a road gives way to a room that stands on it, and behind a wall of that room it is reached by pressing the same spot again', () => {
  // Standing on it: the two share ground on the plan.
  const stack = read('mapStack.ts');
  assert.ok(stack.includes('const OVERLAP_SLACK = '));
  const overlap = block(stack, 'export function spacesOverlap(a: BackgroundSpace, b: BackgroundSpace): boolean {');
  assert.ok(overlap.includes('nodePlanOutline(a)') && overlap.includes('nodePlanOutline(b)'));
  assert.ok(overlap.includes('OVERLAP_SLACK'));
  // Cut where roadsUnderRooms stands, between pickMapFloor and pickMapNode: cut as anchor 21 cuts it, the floor rule would hold the road rule.
  const scene = read('map3dScene.ts');
  const floor = piece(scene, 'export function pickMapFloor(', 'function roadsUnderRooms('), under = piece(scene, 'function roadsUnderRooms(', 'export function pickMapNode(');
  const pick = piece(scene, 'export function pickMapNode(', 'export function mapFloorPile('), floors = piece(scene, 'export function mapFloorPile(', 'export function mapSpacePile(');
  const pile = piece(scene, 'export function mapSpacePile(', 'function mapClickStep('), step = piece(scene, 'function mapClickStep(', 'export function resolveMapClick(');
  // Only a room that overlaps the road sets it aside: a building beside the road must not stand in the way of it.
  assert.ok(under.includes('rooms.some(room => spacesOverlap(room, space))'));
  // The first step of a pick, before anything is compared: the floor of such a road takes no part.
  inOrder(pick, 'const under = map ? roadsUnderRooms(hits, map) : null;', 'hits.filter(hit => !under.has(String(hit.object.userData.nodeId)))', 'for (const hit of list) {', 'pickMapFloor(list, map)');
  // Where a symbol is put down and the pile of floors know no roads: a road is a floor like any other there.
  for (const [name, body] of Object.entries({ pickMapFloor: floor, mapFloorPile: floors }))
    assert.doesNotMatch(body, /isRoadSpace|roadsUnderRooms|spacesOverlap/, `${name} has a rule for roads`);
  // The pile a slow second click steps through: the floors, and in front of them the room that was picked on a wall.
  // Only a space goes in front (a camera or an object on top is no part of it), and only where there is a floor to step on to.
  inOrder(pile, 'const pile = mapFloorPile(hits, map), picked = pickMapNode(hits, map);', 'pile.length > 0', "node.type === 'space'", '[picked, ...pile]');
  // Which space is a road, and which overlap, pickMapNode has settled already.
  assert.doesNotMatch(pile, /isRoadSpace|spacesOverlap/);
  // Both clicks read that pile: the click on the canvas, and the click on a handle of the selected space.
  assert.ok(step.includes('pile = mapSpacePile(hits, map);'));
  assert.doesNotMatch(step, /mapFloorPile\(/);
  assert.ok(viewport.pick().includes('again ? mapSpacePile(hits, props.map) : []'));
  assert.doesNotMatch(view3d, /mapFloorPile/);
});
