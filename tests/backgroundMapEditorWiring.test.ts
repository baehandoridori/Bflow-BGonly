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
  onSaveKey: () => piece(editor, 'const onSaveKey = useEvent(', 'useEffect('),
  select: () => piece(editor, 'function select(', 'function updateView('),
  navigate: () => piece(editor, 'function navigate(', 'function switchMode('),
  switchMode: () => piece(editor, 'function switchMode(', 'const leave3D = useEvent('),
  leave3D: () => piece(editor, 'const leave3D = useEvent(', 'function expandPath('),
  persistMaps: () => piece(editor, 'async function persistMaps(', 'function enterNewMap('),
  placeSymbol: () => piece(editor, 'function placeSymbol(', 'function beginEditing('),
  leaveEditing: () => piece(editor, 'function leaveEditing(', 'function endEditing('),
  endEditing: () => piece(editor, 'function endEditing(', 'function undo('),
  saveMap: () => piece(editor, 'async function saveMap(', 'function requestSave('),
  requestSave: () => piece(editor, 'function requestSave(', 'async function confirmAction('),
  confirmAction: () => piece(editor, 'async function confirmAction(', 'async function createMap('),
  followSaved: () => piece(editor, 'const followSaved = useEvent(() => {', 'const abortGesture = useEvent('),
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
  /** No handler: the one tag with which the editor draws the edit band, up to the `/>` that closes it. */
  strip: () => piece(editor, '<BackgroundMapEditStrip ', '/>'),
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
/** The edit band, read when an anchor asks for it: without the file that anchor fails, not every anchor of this file. */
const editStrip = () => read('BackgroundMapEditStrip.tsx');
/** The stylesheet of the editor, line by line and as written: a rule is one line there, and the comments stay. */
const sheetLines = () => readFileSync(new URL('backgrounds-map.css', directory), 'utf8').replace(/\r\n/g, '\n').split('\n');
/** The number of the one line that starts with this, at the very start of the line. */
function lineOf(lines: string[], opening: string): number {
  const found = lines.flatMap((line, index) => line.startsWith(opening) ? [index] : []);
  assert.equal(found.length, 1, `one line starts with "${opening}"`);
  return found[0];
}
/** What a rule declares, each `property:value` as it is written. */
const declarations = (rule: string) => rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}')).split(';').map(part => part.trim()).filter(Boolean);
/** A base rule: the one line that starts with this selector and its brace. An override inside a media block is indented, and is not it. */
const baseRule = (lines: string[], opening: string) => declarations(lines[lineOf(lines, opening)]);
/** A media block written over several lines: its lines without their indent, from the line that opens it to the brace that closes it. */
function mediaBlock(lines: string[], opening: string): string[] {
  const start = lineOf(lines, opening), end = lines.indexOf('}', start);
  assert.equal(lines[start], opening);
  assert.ok(end > start, `block not closed: ${opening}`);
  return lines.slice(start + 1, end).map(line => line.trim());
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
  // A room unless told otherwise, and only that drag tells it: the polygon tool still draws a room.
  assert.ok(make.startsWith("function newSpace(shape: BackgroundSpace['shape'], origin: BackgroundPoint, road = false): BackgroundSpace {"));
  assert.equal(count(editor, /\bnewSpace\(/g), 3, 'the definition, the drag and the finished polygon');
  assert.ok(editor.includes("newSpace('polygon', geometry)"));
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
  // No other pass over the nodes asks which of them are roads.
  assert.equal(count(editor, /isRoadSpace\(node\)/g), 3, 'the kind label, the list icon and the one pass');
  const spaces = piece(editor, '{stackedSpaces(current).map(node => {', '{current.nodes.filter((node): node is BackgroundSymbol');
  assert.ok(spaces.includes('road = isRoadSpace(node), centre = roadCentreLine(node);'));
  assert.ok(spaces.includes("${road ? 'is-road ' : ''}"));
  // A polyline, so the fill rule of a space (rect, ellipse, polygon) does not reach it. After the shape and before the
  // name: the outline behind the letters of the name covers the line, never the other way round. Its points are
  // centred on the box, and this line alone moves them into the frame of the <g>, whose origin is a corner of the box.
  inOrder(spaces, '<rect width={node.width} height={node.height} rx={road ? 0 : 4} />',
    '{centre && <polyline className="bmap-road-line" fill="none" points={centre.map(point => `${point.x + node.width / 2},${point.y + node.height / 2}`).join(\' \')} />}', '<text');
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
  // Counted by the class token and by the buttons: a seventh circle is one with a second class beside it, and under a class of its own.
  assert.equal(count(field, /\bbmap-color-swatch(?![\w-])/g), 1, 'one line draws the circles');
  assert.equal(count(field, /<button\b/g), 2, 'the circles of the table and the text button');
  // The whole circle, as no test draws this component: switched off with the field, and a press asks for its own
  // colour whatever the colour was. It never takes the colour away: a second press on the same circle changes nothing.
  assert.match(field, /\{MAP_CAMERA_COLORS\.map\(item => <button [^<>]*className="bmap-color-swatch" data-camera-color=\{item\.id\} aria-pressed=\{color === item\.id\} aria-label=\{item\.label\} title=\{item\.label\} disabled=\{disabled\} onClick=\{\(\) => onChange\(item\.id\)\} \/>\)\}/);
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
  // The asset dialog is drawn in that branch but opened by state of this screen, which stays mounted: the state is
  // cleared as the notice turns on, or the dialog would open again by itself when a later read brings the body back.
  assert.match(head, /useEffect\(\(\) => \{\s*if \(updateRequired\) setMapAsset\(null\);\s*\}, \[updateRequired\]\);/);
  assert.ok(rest.includes('{mapAssetView && <AssetDialog ') && !head.includes('<AssetDialog '), 'the dialog is drawn in the branch the notice replaces');
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

test('anchor 50: a save never ends edit mode: every saved map that was being edited goes on from what the command saved', () => {
  // The one function every save of maps goes through. The drafts are put back from the command, in one dispatch.
  const persist = handler.persistMaps(), waited = 'await execute(command);';
  inOrder(persist, waited, 'doc.rebaseDrafts(savedMaps(command));');
  // Only a save that went through puts them back. With a `try` of its own here, a save that failed would leave a draft
  // with nothing unsaved on a revision the library does not have: the edits would read as saved, and the next save be refused.
  assert.doesNotMatch(persist, /\b(?:try|catch|finally)\b/);
  // And no draft is ended here, under any spelling: the drafts that were put back stay.
  assert.doesNotMatch(persist, /doc\.(?:discard|dispatch)\(/);
  // After the wait this handler holds the render that started the save: a draft opened from its map would be on the
  // revision before that save, and the next save would be refused. Nothing after the wait reads that render or opens a draft.
  const after = persist.slice(positions(persist, waited)[0] + waited.length);
  for (const stale of [/\bsnapshot\b/, /\bcurrent\b/, /\bdraft\b/, /doc\.beginEditing/, /doc\.enterNewMap/]) assert.doesNotMatch(after, stale);
  // No save drops a draft any more, and the four saves all go through that function.
  assert.doesNotMatch(editor, /dropDrafts/);
  assert.equal(count(editor, /await persistMaps\(/g), 4, 'the map, a new map, a link, the settings');
  const binding = read('useBackgroundMapDocument.ts');
  assert.doesNotMatch(binding, /dropDrafts/);
  // The calls of the editor reach the reducer through these two lines, and each sends its own action. Swapped, a save would
  // leave its draft on the revision before it, and the library would put fresh drafts over the ones that have unsaved edits.
  assert.ok(binding.includes("rebaseDrafts: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'rebase-drafts', maps }),"));
  assert.ok(binding.includes("followSaved: (maps: readonly BackgroundMap[]) => store.dispatch({ type: 'follow-saved', maps }),"));
  // Only a map that has a draft gets one: a save by someone who was not editing turns no edit mode on. That draft has nothing unsaved.
  const reducer = read('mapDocument.ts'), rebase = piece(reducer, 'function rebaseDrafts(', 'function dropDrafts(');
  assert.ok(rebase.includes('!!draft &&'));
  assert.ok(rebase.includes('freshDraft(map)'));
  assert.ok(piece(reducer, 'function freshDraft(', 'function openDraft(').includes('past: [], future: [], dropped: 0'));
  // Its revision is the one the store and the server give a saved map.
  assert.ok(piece(read('mapWorkflow.ts'), 'export function savedMaps(', 'export function effectiveMaps(').includes('revision: (expectedRevision ?? 0) + 1'));
  // Editing goes on with the tool that is in hand.
  assert.doesNotMatch(handler.saveMap(), /setTool\(/);
});

test('anchor 51: the map is saved only when something is unsaved and never twice at once, and a save that ends in a message brings the message into view', () => {
  const save = handler.saveMap();
  // The checks, in this order. The polygon that is being drawn is asked before the unsaved edits: its points are no part
  // of the draft, and asked after them, Ctrl+S on a map with nothing else unsaved would end without a word. The unsaved
  // edits are read from the store, where the field that was just left is committed already. The ref is set after the
  // checks that return early (set before them, one refused save would leave it set for good) and cleared in `finally`.
  inOrder(save, 'if (!current || !draft || !canEdit || saving.current) return;',
    "if (polygon.length) { setError('그리는 중인 다각형을 완성하거나 취소한 뒤 저장해 주세요.'); setRefused(count => count + 1); return; }",
    'if (!mapDraftChanged(mapDraft(doc.getState(), current.id))) return;', 'if (!current.name.trim()) {', 'const settled = settle()',
    'saving.current = true; setBusy(true);', 'finally { saving.current = false; setBusy(false); }');
  // The save itself. The message of the save before is cleared. What goes out is the map and the drafts `settle()` gave,
  // not those of the render, which do not know the field that was just left. And the command is built inside `try`:
  // built after the ref is set but outside it, a command that cannot be built would leave the ref and `busy` set for good.
  inOrder(save, "saving.current = true; setBusy(true); setError('');", 'try {', 'await persistMaps(saveMapChanges(snapshot, settled.drafts, [captured]));',
    '} catch (cause) { setError(message(cause)); setRefused(count => count + 1); } finally { saving.current = false; setBusy(false); }');
  // The ref is set in that one place only: a second one before the checks that return early would leave it set after one refused save.
  assert.equal(count(save, /saving\.current = true/g), 1);
  // The save ends no draft and opens none, whether it went through or failed: a failed save keeps the unsaved edits.
  assert.doesNotMatch(save, /doc\.(?:discard|dispatch|beginEditing|enterNewMap)\(/);
  // The value of the render does not know the field that leaving it has just committed.
  assert.doesNotMatch(save, /\bdraftChanged\b/);
  // A save ends in a message instead of a save in three places: the polygon, the empty name, a failure.
  assert.equal(count(save, /setRefused\(count => count \+ 1\)/g), 3);
  // Each brings that message into view: it sits above the band and may be scrolled away. `nearest` moves nothing when it is in view.
  assert.ok(editor.includes("useEffect(() => { if (refused) errorRef.current?.scrollIntoView({ block: 'nearest' }); }, [refused]);"));
  assert.ok(editor.includes('<div className="bg-error" role="alert" ref={errorRef}>'));
  // The button of the band. It is on with something to save and nothing running: asked of `disabled` alone it would look on
  // over a map with nothing unsaved (a press would still save nothing, so only the look is wrong and no other check sees it).
  // Its tooltip is the one place that says why the dimmed button does nothing.
  const strip = editStrip();
  for (const part of ['const idle = !status.canSave || disabled;', 'aria-disabled={idle}', 'onClick={() => { if (!idle) onSave(); }}',
    "title={status.canSave ? '도면 저장 (Ctrl+S)' : status.phase === 'saving' ? undefined : '저장할 변경이 없어요'}"]) assert.ok(strip.includes(part), `not found: ${part}`);
  // Dimmed, never switched off: switched off it would leave the Tab order, and its tooltip would not be reached.
  assert.doesNotMatch(piece(strip, 'className="bmap-edit-save"', '</button>'), /(?<!aria-)\bdisabled\b/);
});

test('anchor 52: edit mode ends without a question only when nothing would be lost', () => {
  const leave = handler.leaveEditing(), end = handler.endEditing();
  // 편집 끝내기, in this order. Nothing while a save runs, and a drag in progress is cancelled first. Then the question,
  // only when something would be lost: unsaved edits, read from the store (the press on the button has just committed the
  // field that was being typed in, which the value of the render does not know), or the points of a polygon that is being
  // drawn, which are no part of the draft. With neither, edit mode ends at once and the keyboard goes to the canvas: the
  // button that was pressed is gone.
  inOrder(end, 'if (!current || !editing || disabled) return;', 'abortGesture();',
    "if (mapDraftChanged(mapDraft(doc.getState(), current.id)) || polygon.length) { setError(''); setConfirmation('discard'); return; }",
    'leaveEditing(); focusCanvas();');
  // A draft with every edit undone has nothing to lose: the redo history is not asked.
  assert.doesNotMatch(end, /future/);
  // Ended without a question, the band is gone with the click that ended it and everything below has moved up by its
  // height: the second click of a double-click would land on whatever slid under the pointer (the canvas in a narrow
  // window, where a press drops the selection and a double-click enters a space). For the length of a double-click no
  // press reaches the page. Only on this path: after the question the band goes with a click on the dialog.
  inOrder(end, 'leaveEditing(); focusCanvas();', 'swallowSecondClick();');
  assert.equal(count(editor, /\bswallowSecondClick\b/g), 2);
  assert.deepEqual(piece(editor, 'function swallowSecondClick() {', 'function navigate(').split('\n').map(line => line.trim()).filter(Boolean), [
    'function swallowSecondClick() {',
    'const stop = (event: Event) => { event.stopPropagation(); event.preventDefault(); };',
    'for (const type of pressEvents) window.addEventListener(type, stop, true);',
    'window.setTimeout(() => { for (const type of pressEvents) window.removeEventListener(type, stop, true); }, SECOND_CLICK_MS);',
    '}']);
  assert.ok(editor.includes('const SECOND_CLICK_MS = 500;'));
  assert.ok(editor.includes("const pressEvents = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'];"));
  // What ending is: the draft of the map on show goes, and with it the points that were being drawn, the tool in hand,
  // the editor's message and the word that the map was just saved. The tool is no detail: the bar of the polygon tool
  // (다각형 완성 · 취소) is drawn for the tool alone, in edit mode or not, and left in hand it would stay over a map that
  // is no longer edited. Nor is the palette of symbols: left open it would be drawn open, unasked, at the next 편집 시작.
  for (const part of ['doc.discard(current.id);', 'setPolygon([])', "setTool('select')", 'setSymbolPaletteOpen(false)', "setError('')", 'setSavedNotice(null)']) assert.ok(leave.includes(part), `not found: ${part}`);
  // The answer of the dialog ends it the same way. Its button is gone with the band, so the keyboard is handed to the
  // canvas once the dialog has closed.
  inOrder(block(handler.confirmAction(), "if (confirmation === 'discard') {"), 'leaveEditing();', 'focusAfterConfirm.current = true; setConfirmation(null); return;');
  // The question is asked from one place, and edit mode is ended from those two alone (the third is the function itself):
  // a second way out would ask twice, or not at all.
  assert.equal(count(editor, /setConfirmation\('discard'\)/g), 1);
  assert.equal(count(editor, /\bleaveEditing\b/g), 3);
  // Nor does the row of buttons in the header end it, under any name or by any call: 취소 left the header for the band.
  // One left behind that drops the draft by itself would not ask, and neither count above would see it.
  assert.doesNotMatch(piece(editor, '<div className="bmap-actions">', '</header>'), /discard|leaveEditing|endEditing/);
  // The band's 편집 끝내기 is that handler. Wired to `leaveEditing` it would drop unsaved edits without a question, and
  // everything above would still be found. Both buttons are off while a save or another action of the editor runs.
  const strip = handler.strip();
  for (const part of ['onEnd={endEditing}', 'disabled={disabled}']) assert.ok(strip.includes(part), `not found: ${part}`);
  assert.ok(editStrip().includes('<button type="button" className="bmap-edit-end" disabled={disabled} onClick={onEnd}>편집 끝내기</button>'));
  // The dialog. Its title and its text part on the same value: with only a polygon being drawn nothing is unsaved (the
  // band says so, and those points cannot be saved), so the question does not speak of saving. One button fits both.
  for (const part of ["confirmation === 'discard' ? (draftChanged ? '저장하지 않고 편집을 끝낼까요?' : '편집을 끝낼까요?')",
    "confirmation === 'discard' ? (draftChanged ? '이 도면에서 저장 안 한 변경은 사라져요.' : '그리던 다각형이 사라져요.')",
    "confirmation === 'discard' ? '버리고 끝내기' : '삭제'"]) assert.ok(editor.includes(part), `not found: ${part}`);
  // Going back loses nothing. The dialog's 돌아가기 and its own close do one thing, they close it: nothing in the dialog
  // touches the points that were being drawn or the tool in hand, so the polygon can be gone on with.
  const dialog = piece(editor, '{confirmation && current && <BackgroundModal ', '</BackgroundModal>}');
  for (const part of ["onClose={() => { if (!busy) { setConfirmation(null); setError(''); } }}",
    "onClick={() => { setConfirmation(null); setError(''); }}>돌아가기</button>"]) assert.ok(dialog.includes(part), `not found: ${part}`);
  assert.doesNotMatch(dialog, /setPolygon\(|setTool\(/);
  // Esc in the dialog is 돌아가기 too. The key comes up to the editor's own handler through the portal, and its Escape
  // branch drops the points being drawn and the tool in hand: it leaves before that line when the key was pressed inside
  // a dialog, and before the line that cancels a drag (no drag is in progress under an open dialog).
  const escape = block(handler.keyboard(), "if (event.key === 'Escape') {");
  inOrder(escape, 'if (event.nativeEvent === handledEscape.current) return;', "if ((event.target as HTMLElement).closest('dialog')) return;",
    "if (pointerRef.current?.mode === 'marquee' || doc.isGestureActive()) { abortGesture(); return; }", 'setPolygon([]);');
  // The words of the button this one replaced (취소) are gone, with or without quotes round them.
  for (const old of ['도면 편집을 취소할까요?', '저장하지 않은 변경사항', '변경사항 버리기']) assert.ok(!editor.includes(old), `still there: ${old}`);
});

test('anchor 53: Ctrl+S is heard on the window, passes its guards, commits the field being typed in and saves', () => {
  // The guards, in this order. The key, by its place on the keyboard (the Korean input state does not matter), with Ctrl
  // and without Alt or Shift. The editor on show and editing: while viewing, for a read-only account and in another tab
  // of the library the key is not even swallowed. No open dialog, asked of the state and of the document, never of the
  // target: once Tab has run past the last button of a modal the target is the body. The focus in the library or on
  // nothing at all (the body, right after a button went away): elsewhere the key belongs to what has the focus, a window
  // of the app that is neither a dialog element nor marked modal, say. No text field outside the editor. Only then is the
  // key taken, and taken before its repeats are dropped: a held key saves once and is swallowed all the while.
  const key = handler.onSaveKey(), steps = [
    "if (event.code !== 'KeyS' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;",
    'if (!root || root.offsetParent === null || !editing) return;',
    'if (createForm || linkForm || settingsForm || confirmation || document.querySelector(openDialogs)) return;',
    "if (element && element !== document.body && !element.closest('.bg-library')) return;",
    'if (element?.closest(textFields) && !root.contains(element)) return;',
    'event.preventDefault(); event.stopPropagation();',
    'if (event.repeat) return;',
    'requestSave();',
  ];
  inOrder(key, ...steps);
  // Each is a line of its own: nothing stands in front of one, and none is the tail of another condition.
  const lines = key.split('\n').map(line => line.trim());
  for (const step of steps) assert.ok(lines.includes(step), `not a line of its own: ${step}`);
  // And the handler holds nothing else: its first line, the guards, the line that reads the root and the target, the brace
  // that closes it. One more return (for a focused button, for 3D, for a composition) would make the key deaf there.
  const opener = 'const onSaveKey = useEvent((event: KeyboardEvent) => {';
  assert.deepEqual(block(editor, opener).split('\n').map(line => line.trim()).filter(Boolean),
    [opener, steps[0], 'const root = rootRef.current, element = event.target instanceof Element ? event.target : null;', ...steps.slice(1), '}']);
  // No dialog is asked of the target. And a composition is no dead end: a Korean name typed and saved at once is saved,
  // by the focus leaving the field in requestSave. Swallowed and dropped, that Ctrl+S would die without a word.
  assert.doesNotMatch(key, /closest\('dialog'\)|closest\(textEntry\)|isComposing|229/);
  // What the document is asked: a native dialog that is open, and a window that is none but is marked modal.
  assert.ok(editor.includes('const openDialogs = \'dialog[open], [aria-modal="true"]\';'));
  // Heard on the window, in the capture phase: the editor's own handler is never reached from the body and is deaf behind a
  // focused field or button, and a shortcut of the app bound to the same keys listens on the window as it bubbles. Let go
  // by the cleanup the effect returns, with the same flag: without it the listener would outlive the editor.
  const effect = piece(editor, "window.addEventListener('keydown', onSaveKey, true);", '}, [onSaveKey]);');
  assert.ok(effect.includes("return () => window.removeEventListener('keydown', onSaveKey, true);"));
  // And the effect holds these four lines alone, as the handler holds its own. A return in front of the first would leave the
  // key deaf everywhere: the editor is mounted while viewing and the handler is stable, so the effect never runs a second
  // time. A second listener for the release, the shape of the Space effect above, would save on the press and again on the release.
  const all = editor.split('\n').map(line => line.trim()).filter(Boolean), at = all.indexOf("window.addEventListener('keydown', onSaveKey, true);");
  assert.deepEqual(all.slice(at - 1, at + 3),
    ['useEffect(() => {', "window.addEventListener('keydown', onSaveKey, true);", "return () => window.removeEventListener('keydown', onSaveKey, true);", '}, [onSaveKey]);']);
  // The handler is named where it is made and in those lines, and nowhere else: no second effect, no handler of an element.
  assert.equal(count(editor, /\bonSaveKey\b/g), 4, 'made, added, removed, and what the effect depends on');
  // 도면 저장 and Ctrl+S are one function, and it holds these three lines alone. Nothing while a save runs, and nothing
  // during a drag: the save would cancel it. Then the focus goes to the canvas, before the save: leaving a field commits
  // what was being typed in it (a syllable still being composed too), and the save reads the draft after that.
  const request = handler.requestSave(), asked = ['if (!current || !canEdit || saving.current || pointerRef.current || doc.isGestureActive()) return;', 'focusCanvas();', 'void saveMap();'];
  inOrder(request, ...asked);
  assert.deepEqual(block(editor, 'function requestSave() {').split('\n').map(line => line.trim()).filter(Boolean), ['function requestSave() {', ...asked, '}']);
  // The band's button is that function, and the map is saved from nowhere else: a second way would skip the focus.
  assert.ok(handler.strip().includes('onSave={requestSave}'));
  assert.equal(count(editor, /\bsaveMap\(/g), 2, 'the function itself and requestSave');
  // Nor is that function reached from a third place. It asks of no open dialog itself: the key handler does that before it.
  assert.equal(count(editor, /\brequestSave\b/g), 3, 'the function, the key handler, the band');
  // The rule lives in one place: keyboard() has no S of its own.
  assert.doesNotMatch(handler.keyboard(), /'KeyS'|=== 's'/);
  // Under any spelling of the key: keyboard() also hears the keys pressed inside the editor's own dialogs (its guards for
  // them say so), and a save from there would save the draft under the open settings dialog.
  assert.doesNotMatch(handler.keyboard(), /requestSave|saveMap/);
});

test('anchor 54: the band is one element for the plan and for 3D, stuck over the map at a height that never depends on what it says', () => {
  // The editor draws the band once, in `.bmap-main` and in front of the panels: the plan and 3D part inside the canvas
  // area, so both have the same element in the same place. It hangs on `editing`, not on `canEdit`: that one is off
  // while a save runs, and the band would go and come back with every save, the map moving under the pointer.
  assert.equal(count(editor, /<BackgroundMapEditStrip/g), 1);
  // Its place among the children of `.bmap-main`, a column whose first child is the header: after the header, the
  // editor's message and the notice, in front of the panels and so of the plan. Anywhere before the end of the header it
  // is above the title, or no child of `.bmap-main` at all: beside the tree it would be a column of the editor's row, not
  // a band over the map. In front of the message it would cover it: a refused save brings its message to the top of the
  // tab, which is where the band is stuck.
  inOrder(editor, '</header>', '<div className="bg-error" role="alert" ref={errorRef}>', '{notice && <div className="bmap-notice" role="status">',
    '{editing && draft && <BackgroundMapEditStrip ', '<BackgroundMapPanels gallery={gallery}>', "{mode === 'plan' ? <svg ref={svgRef}");
  // The row of buttons in the header saves nothing, under any name: 도면 저장 went to the band. A second one left here
  // would be lit with nothing to save, and no check of the band's own button would see it.
  assert.doesNotMatch(piece(editor, '<div className="bmap-actions">', '</header>'), /[Ss]ave|저장/);
  // The class the frame, the height taken from the image list and the scroll margin hang on. The whole line: it is the
  // editor of a map, not the `<div className="bmap-main">` that stands there while no map exists.
  assert.ok(editor.includes("<main className={`bmap-main${editing ? ' is-editing' : ''}`}>"));
  // The markup the stylesheet hangs on. The filled box and the tick are drawn by `data-phase` and by the `<span>` round the
  // words: without either the three states differ in their words alone, and every rule below would still be found.
  const strip = editStrip();
  assert.ok(strip.includes('<section className="bmap-edit-strip" data-phase={status.phase}'));
  assert.ok(strip.includes('<p className="bmap-edit-state"><strong>{MAP_EDIT_LABEL}</strong><span>{status.detail}</span></p>'));
  for (const name of ['bmap-edit-key', 'bmap-edit-actions', 'bmap-edit-end', 'bmap-edit-save']) assert.equal(count(strip, new RegExp(`className="${name}"`, 'g')), 1, name);
  // The stylesheet. A base rule is found at the very start of its line, a line of a media block without its indent: the
  // narrow layout overrides three of these rules under the same selectors, and the frame has a second rule for its motion.
  const lines = sheetLines(), has = (rule: string[], ...parts: string[]) => { for (const part of parts) assert.ok(rule.includes(part), `not declared: ${part} (${rule.join('; ')})`); };
  // Stuck to the top of the tab, and over the canvas: that comes later in the page and stacks by itself, so without the
  // z-index the stuck band would be under the map. Its height is the variable, whatever is inside.
  has(baseRule(lines, '.bmap-edit-strip {'), 'position:sticky', 'top:0', 'z-index:5', 'flex:0 0 var(--bmap-edit-h)', 'height:var(--bmap-edit-h)');
  // One line of words that gives way to the buttons and ends in an ellipsis: all four are needed for the ellipsis to be
  // drawn. The least height is that of the filled box: without it the row of buttons of the two-line layout moves at the first edit.
  has(baseRule(lines, '.bmap-edit-state {'), 'white-space:nowrap', 'min-width:0', 'min-height:23px');
  has(baseRule(lines, '.bmap-edit-state>span {'), 'text-overflow:ellipsis', 'overflow:hidden');
  // Nothing between the band and the tab scrolls: `hidden` makes a box a scroll container, and the band would stick to
  // that box, which never scrolls. `clip` cuts at the same edge and is none.
  const first = lines.find(line => line.startsWith('.bmap-layout {'));
  assert.ok(first, 'the first rule of the editor');
  for (const rule of [declarations(first), baseRule(lines, '.bmap-main {')]) { has(rule, 'overflow:clip'); assert.ok(!rule.includes('overflow:hidden')); }
  // The frame is laid over the canvas area: a real border would make the map smaller as edit mode starts.
  has(baseRule(lines, '.bmap-main.is-editing .bmap-canvas-wrap::after {'), 'content:""', 'inset:0', 'position:absolute', 'pointer-events:none');
  assert.ok(!lines[lineOf(lines, '.bmap-canvas-wrap {')].includes('border'));
  // The height of the band is taken from the image list, in a wide window only: outside that block these three would
  // outweigh the heights of the narrow layout.
  const wide = mediaBlock(lines, '@media(min-width:901px) {');
  for (const line of ['.bmap-layout:has(.bmap-main.is-editing) { min-height:calc(500px + var(--bmap-edit-h)); }',
    '.bmap-layout:has(.bmap-main.is-editing):has(.bmap-canvas-wrap.is-3d) { min-height:calc(760px + var(--bmap-edit-h)); }',
    '.bmap-main.is-editing .bmap-panels:not(.is-sized)>.bmap-gallery { flex-basis:calc(clamp(248px,33dvh,370px) - var(--bmap-edit-h)); }']) assert.ok(wide.includes(line), `not in the wide block: ${line}`);
  // The order, by line number. The narrow layout overrides these four under selectors of the same weight, so the later
  // line wins: with the base rules after that block the band would be 40px high around two lines of content.
  const narrowAt = lineOf(lines, '@media(max-width:900px) {'), bandAt = lineOf(lines, '.bmap-edit-strip {');
  for (const opening of ['.bmap-layout { --bmap-edit:', '.bmap-edit-strip {', '.bmap-edit-state {', '.bmap-edit-key {']) assert.ok(lineOf(lines, opening) < narrowAt, `after the narrow layout: ${opening}`);
  // The narrow layout: 72px, the words on a line of their own, the shortcut and the buttons on the second, to the right.
  const narrow = mediaBlock(lines, '@media(max-width:900px) {');
  assert.ok(narrow.includes('.bmap-layout { height:auto; min-height:0; --bmap-edit-h:72px; }'));
  for (const opening of ['.bmap-edit-strip { flex-wrap:wrap', '.bmap-edit-state { flex:1 0 100%', '.bmap-edit-key { margin-left:auto']) assert.equal(narrow.filter(line => line.startsWith(opening)).length, 1, opening);
  // The shortcut is not hidden there: with nothing to save the tooltip of the button does not name it either.
  assert.ok(!lines.some(line => line.includes('.bmap-edit-key { display:none')));
  // Where the header has a narrower side margin the band starts on the same line as the title: after the base rule, which it overrides.
  const marginAt = lineOf(lines, '@media(max-width:1100px) { .bmap-edit-strip {');
  assert.equal(lines[marginAt], '@media(max-width:1100px) { .bmap-edit-strip { padding-left:14px; } }');
  assert.ok(bandAt < marginAt && marginAt < narrowAt);
  // The states are told apart by shape: unsaved edits stand in a filled box, a save that just went through has a tick.
  const pill = baseRule(lines, '.bmap-edit-strip[data-phase="changed"] .bmap-edit-state>span {');
  has(pill, 'background:rgb(var(--bmap-edit-ink))');
  assert.ok(pill.some(part => part.startsWith('border-radius:')));
  has(baseRule(lines, '.bmap-edit-strip[data-phase="saved"] .bmap-edit-state>span::before {'), 'content:"✓"');
  // The save button keeps one width and one weight whatever it says and whether it is on or dimmed: nothing beside it moves.
  const save = baseRule(lines, '.bg-library .bmap-edit-strip .bmap-edit-save {');
  has(save, 'font-weight:600', 'transition:none');
  assert.ok(save.some(part => part.startsWith('min-width:')));
  // What the two buttons are painted with, so that their words can be read on a band of any colour. A button of the band:
  // words in the colour of the band's words, on nothing. The save button the other way round: a box in the colour of the
  // words, with words in the colour of the band.
  has(baseRule(lines, '.bg-library .bmap-edit-strip button {'), 'color:rgb(var(--bmap-edit-ink))', 'background:transparent');
  has(save, 'background:rgb(var(--bmap-edit-ink))', 'color:rgb(var(--bmap-edit))');
  // Under the pointer it stays that box, by a rule of its own: the hover rule of the band's buttons outweighs the save
  // rule, and would lay its faint wash under words in the colour of the band.
  has(baseRule(lines, '.bg-library .bmap-edit-strip .bmap-edit-save:hover:not(:disabled) {'), 'background:rgb(var(--bmap-edit-ink) / .86)');
  // The focus ring is in the colour of the words too: the accent ring of the editor may not show on the band.
  has(baseRule(lines, '.bg-library .bmap-edit-strip button:focus-visible {'), 'outline:2px solid rgb(var(--bmap-edit-ink))');
  // The frame is the sign of edit mode, so nothing else may ring the canvas in its hue. The engine rings a focused svg
  // in orange whenever it was not the keyboard that focused it (a press on the map; 편집 시작 · 도면 저장 · 편집 끝내기, which
  // hand the keyboard to the canvas): after 편집 끝내기 a map that is no longer edited would still wear a ring. That ring
  // is taken off, as a rule of its own line, and the keyboard's ring (the accent, 2px) stays.
  assert.ok(lines.includes('.bmap-canvas:focus:not(:focus-visible) { outline:none; }'), 'the canvas keeps the engine ring after a press');
  assert.ok(lines.some(line => line.includes('.bmap-canvas:focus-visible { outline:2px solid rgb(var(--color-accent-sub)); outline-offset:2px; }')), 'the keyboard ring of the canvas is gone');
  // Dimmed it is an empty box. The line is counted: asked only for what it must not hold, a deleted line would pass.
  const dimmedAt = lineOf(lines, '.bg-library .bmap-edit-strip .bmap-edit-save[aria-disabled="true"],'), dimmed = declarations(lines[dimmedAt]);
  has(dimmed, 'background:transparent', 'cursor:default');
  assert.ok(!lines[dimmedAt].includes('font-weight'));
  // Its words are in the colour of the other words, thinned: left to the save rule they would be in the colour of the
  // band, on the band. How thin is not pinned: that is tuned by eye, in the app.
  assert.ok(dimmed.some(part => /^color:rgb\(var\(--bmap-edit-ink\) \/ \.\d+\)$/.test(part)), `the dimmed words have no colour of their own (${dimmed.join('; ')})`);
  // What the keyboard brings into view stops below the stuck band. Not the canvas (no `[tabindex]`): it takes the focus on
  // a press, and must not scroll then. And not the two buttons of the band: with the margin a focus on them would scroll the tab.
  assert.ok(lines.includes('.bmap-main.is-editing :is(button,input,select,summary) { scroll-margin-top:var(--bmap-edit-h); }'));
  assert.ok(lines.includes('.bmap-main.is-editing .bmap-edit-strip button { scroll-margin-top:0; }'));
  // The motion rules of the app, on every line that styles the band or the editor while editing. The band follows the
  // scroll, so no backdrop-filter: what is behind it would be blurred again at each step. Nothing repeats. No transition
  // of its own: its box has its height at once and its words change without one (`transition:none` on the save button
  // takes one away). And what moves as edit mode starts is declared inside the block for those who want motion, nowhere
  // else: outside it the band would slide in under "reduce motion" and at the app's own "minimal" as well.
  const band = lines.flatMap((line, at) => !line.trimStart().startsWith('/*') && /\.bmap-edit|\.bmap-main\.is-editing/.test(line) ? [at] : []);
  assert.ok(band.length >= 20 && band.includes(bandAt), `${band.length} lines of the band`);
  const calmAt = lines.indexOf('@media (prefers-reduced-motion: no-preference) {'), calmEnd = lines.indexOf('}', calmAt);
  for (const at of band) {
    assert.doesNotMatch(lines[at], /backdrop-filter|infinite|transition(?!:none;)/);
    if (lines[at].includes('animation')) assert.ok(calmAt > -1 && calmAt < at && at < calmEnd, `moves whatever the motion setting: ${lines[at]}`);
  }
});

test('anchor 55: the colours of the band come from the two accents of the theme and the page as they are on screen', () => {
  const hook = read('useMapEditColors.ts');
  // Read from what is painted: the computed style of <html>, whether a theme was applied or the values of the stylesheet
  // stand. The whole call: three values, in the order the function takes them. And the whole call of the observer: it is
  // <html> that changes with the theme and the colour mode, not the editor. The observer is let go by the cleanup the
  // effect returns, the whole line: called in the body of the effect it would stop listening as soon as it began, and
  // the band would keep its colour when the colour mode is switched.
  for (const part of ['getComputedStyle(document.documentElement)',
    "mapEditColors(theme.getPropertyValue('--color-accent'), theme.getPropertyValue('--color-accent-sub'), theme.getPropertyValue('--color-bg-primary'))",
    "root.style.setProperty('--bmap-edit', colors.strip)", "root.style.setProperty('--bmap-edit-ink', colors.ink)",
    "observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'class', 'style'] })",
    'return () => observer.disconnect();']) assert.ok(hook.includes(part), `not found: ${part}`);
  // Written before the first paint: in a `useEffect` the editor would be painted once in the amber of the stylesheet, in
  // every theme but the default one, each time it mounts.
  assert.ok(hook.includes('useLayoutEffect(() => {'));
  assert.doesNotMatch(hook, /\buseEffect\b/);
  // Written on the editor's own element: written on <html> it would wake what observes <html>, this hook and the 3D view.
  assert.ok(!hook.includes('document.documentElement.style.setProperty'));
  // The tone follows the page that is painted, not the mode attribute: a theme picked by hand may not agree with it.
  assert.ok(!hook.includes('getAttribute'));
  // Once at the start: the observer hears only what changes after it. Without that call every theme but the default one
  // would keep the amber of the stylesheet until the colour mode is switched.
  inOrder(hook, 'apply();', 'new MutationObserver(apply)');
  // The editor calls it once, with its own root: the band, the frame and the dot of the tree are all inside that element.
  assert.equal(count(editor, /useMapEditColors\(rootRef\);/g), 1);
});

test('anchor 56: only a draft with nothing unsaved follows the library, never during a save or under an open dialog, and a map that went away is left as on a move to another map', () => {
  // The guard comes first. While a save runs the store shows maps that are not confirmed (a draft that followed would keep
  // the values of a save that failed, and a map that is only being deleted would read as gone). A dialog of the editor asks
  // about the map on show: with that map gone under it, a second press on its delete would go to the first map of the list.
  // Then the draft of the map on show is read before and after. Replaced, the picked point goes: it is a number, and may
  // now name another point. Gone, what `navigate` clears is cleared, and only then: on a mere newer revision the points
  // that are being drawn and the tool stay. The four dialogs are dependencies, so what was skipped is done as one closes.
  const follow = handler.followSaved(), steps = [
    'if (disabled || doc.isGestureActive() || confirmation || createForm || linkForm || settingsForm) return;',
    'const before = mapDraft(doc.getState(), current?.id);',
    'doc.followSaved(snapshot.maps);',
    'if (mapDraft(doc.getState(), current?.id) !== before) setActiveVertex(null);',
    "if (before && !mapDraft(doc.getState(), current?.id)) { setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); }",
    'useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, confirmation, createForm, linkForm, settingsForm]);',
  ];
  inOrder(follow, ...steps);
  // Each is a line of its own: nothing stands in front of one (a condition before the call, say).
  const lines = follow.split('\n').map(line => line.trim());
  for (const step of steps) assert.ok(lines.includes(step), `not a line of its own: ${step}`);
  // And the handler holds nothing else: its first line, the five statements, the brace that closes it. A return put in front
  // of the guard (`if (!editing) return;`, say) would keep the drafts that are not on show from following: the parent that a
  // link or a new map left behind would stay in the tree after its map was deleted elsewhere, as a map that can never be saved.
  const opener = 'const followSaved = useEvent(() => {';
  assert.deepEqual(block(editor, opener).split('\n').map(line => line.trim()).filter(Boolean), [opener, ...steps.slice(0, 5), '}']);
  // The library is followed from that one place: a second call would not ask the guard.
  assert.equal(count(editor, /doc\.followSaved\(/g), 1);
  // The reducer. A draft follows only with nothing unsaved in it, not while it is dragged, and only on to a later revision:
  // with `>=` the echo of one's own save would empty the redo history. The draft of a map the library no longer has goes
  // under the same conditions: one with unsaved edits stays, and so does one that is being dragged.
  const branch = block(read('mapDocument.ts'), "case 'follow-saved': {");
  for (const rule of ['!mapDraftChanged(draft)', 'state.gesture?.mapId !== map.id', 'map.revision > (draft.baseRevision ?? Infinity)',
    '!known.has(id) && !mapDraftChanged(followed.drafts[id]) && followed.gesture?.mapId !== id']) assert.ok(branch.includes(rule), `not found: ${rule}`);
  // Not through dropDrafts: that ends the field edit that is being typed, which may be on another map.
  assert.doesNotMatch(branch, /dropDrafts\(/);
});

test('anchor 57: a save is told inside the band, for a moment', () => {
  // The word is turned on in one place, the function every save of maps goes through. The map on show is taken before the
  // wait: after it this handler holds the render that started the save. And the word is for that map alone: when the save
  // held it, and when it is still edited once its draft was put back. A save by someone who was not editing leaves no
  // draft, and says nothing: there is no band to say it on.
  const persist = handler.persistMaps(), told = 'if (shown && command.maps.some(item => item.entity.id === shown) && mapDraft(doc.getState(), shown)) setSavedNotice({ mapId: shown });';
  inOrder(persist, 'const shown = current?.id;', 'await execute(command);', 'doc.rebaseDrafts(savedMaps(command));', told);
  // The whole line: nothing stands in front of it, and none of its three conditions is gone.
  assert.ok(persist.split('\n').map(line => line.trim()).includes(told), `not a line of its own: ${told}`);
  // And the function holds nothing else: its first line, these four statements, the brace that closes it. A line of its own
  // between them is not seen above. A return after the drafts were put back, on a value of the render that started the save
  // (`if (draftChanged) return;`, which is true on every save from the band and by Ctrl+S), and the word would never come
  // up there: anchor 50 forbids three names of that render after the wait, and this is none of them.
  const opener = 'async function persistMaps(command: MapSaveCommand) {';
  assert.deepEqual(block(editor, opener).split('\n').map(line => line.trim()).filter(Boolean),
    [opener, 'const shown = current?.id;', 'await execute(command);', 'doc.rebaseDrafts(savedMaps(command));', told, '}']);
  // The word leaves the band by itself, timed by the editor: after the effect that follows the library, before the one that
  // brings a refused save into view. Each save sets a new object, so the time starts again. The cleanup clears the timer
  // that runs, at the next save and as the editor is taken down. And the effect hangs on the word: with an empty list it
  // would run once, before any save, and "saved" would never leave the band.
  inOrder(handler.followSaved(), 'useEffect(() => { followSaved(); }', 'window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS)',
    'return () => window.clearTimeout(timer);', '}, [savedNotice]);', 'useEffect(() => { if (refused) ');
  // The effect holds these five lines alone.
  const all = editor.split('\n').map(line => line.trim()).filter(Boolean), at = all.indexOf('const timer = window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS);');
  assert.deepEqual(all.slice(at - 2, at + 3), ['useEffect(() => {', 'if (!savedNotice) return;',
    'const timer = window.setTimeout(() => setSavedNotice(null), MAP_SAVED_NOTICE_MS);', 'return () => window.clearTimeout(timer);', '}, [savedNotice]);']);
  // The band is told so on the map that was saved, and on no other: the word names its map, so a save that goes on to
  // another map (a link that is opened, a new map inside a space) is not told there. "Saving" is the store's own word for
  // a write to the library: the editor's `busy` is also on while an underlay is uploaded.
  const strip = handler.strip();
  for (const part of ['mapEditStatus(draft, pending,', 'savedNotice?.mapId === current.id',
    'status={mapEditStatus(draft, pending, savedNotice?.mapId === current.id)}']) assert.ok(strip.includes(part), `not found: ${part}`);
  // The same words are read out as it happens, from a region that is not seen.
  assert.ok(editStrip().includes('<span className="sr-only" role="status">{status.announce}</span>'));
  // No toast, in any screen of the feature: it would come up in a corner of the window, away from the band that was pressed.
  for (const name of readdirSync(directory).filter(name => name.endsWith('.tsx'))) assert.doesNotMatch(read(name), /sonner/, name);
  // And no block over the map: the editor's notice is laid out above the canvas, and one that comes and goes with a save
  // would move the map under the pointer. Neither save writes it, the word is read by its timer and by the band alone, and
  // what the band says is in mapEditStatus.ts, not here.
  for (const path of [persist, handler.saveMap()]) assert.doesNotMatch(path, /setNotice\(/);
  assert.equal(count(editor, /\bsavedNotice\b/g), 4, 'the state, the timer and what it depends on, the band');
  // That count does not see the calls that set the word (`setSavedNotice` is another word). There are three, each held
  // where it is: the save turns it on and the timer turns it off (both above), and so does the end of edit mode (anchor
  // 52). A fourth would pass everything else. Turned on by 편집 시작, by a save of the settings made while viewing (the
  // band would say so on 편집 시작 pressed within the four seconds), after a save that failed, or for the map that a link
  // or a new map moved on to, the band would say "saved" of a map of which nothing was saved; turned off by an effect of
  // its own (as a save ends, on a move to another map), the word would leave before its time.
  assert.equal(count(editor, /\bsetSavedNotice\(/g), 3, 'the save, the timer, the end of edit mode');
  assert.ok(!editor.includes('도면을 저장했어요'));
});

test('anchor 58: the header keeps a quiet 편집 시작 in its place, and the words name a button only to those who see it', () => {
  const gallery = read('BackgroundMapGallery.tsx');
  /** The tag of the one button of the editor that reads this, from the `<button` that opens it. */
  const button = (label: string) => {
    const close = `>${label}</button>`, at = editor.indexOf(close);
    assert.equal(count(editor, new RegExp(close, 'g')), 1, `one button reads: ${label}`);
    return editor.slice(editor.lastIndexOf('<button', at), at + close.length);
  };
  // 편집 시작, the whole tag. A plain button of the library, a border and no fill: not the accent fill (`bg-primary`) of
  // the button it replaced. While the map is edited it is off and kept from readers, and the stylesheet hides it by that
  // `aria-hidden`. Its own click hides it, so the click sends the keyboard to the canvas: left on a hidden button, Delete
  // and Ctrl+Z would reach nothing. And nothing else is on the tag: `hidden`, say, would take it out of the row.
  const start = button('편집 시작');
  assert.equal(start, '<button type="button" className="bg-button bmap-edit-start" disabled={disabled || editing} aria-hidden={editing || undefined} onClick={() => { beginEditing(); setInspectorOpen(true); focusCanvas(); }}>편집 시작</button>');
  // It keeps its place in the row: straight after 도면 설정, in no branch. Taken out while editing (`!editing &&`), 도면 설정
  // would slide under the pointer, and the second click of a double-click on 편집 시작 would open the settings. And it
  // stays inside what only an account that may edit is shown: a read-only account has no such button.
  const row = piece(editor, '<div className="bmap-actions">', '</header>');
  assert.ok(row.includes('>도면 설정</button><button type="button" className="bg-button bmap-edit-start"'));
  assert.ok(piece(row, '{snapshot.canManage && <>', '</>}').includes(start));
  // Hidden, it still takes its room. `display:none` would give the room away, as the branch would: the line as written,
  // and it is the one line of the sheet that names the class. A second rule could take the button out of the row under
  // another spelling (`display: none`, `position:absolute`, on `:disabled`), or show it again while the map is edited.
  const lines = sheetLines();
  assert.equal(lines[lineOf(lines, '.bmap-edit-start[aria-hidden="true"]')], '.bmap-edit-start[aria-hidden="true"] { visibility:hidden; }');
  assert.equal(lines.filter(line => line.includes('bmap-edit-start')).length, 1, 'one line of the sheet names the class of 편집 시작');
  // The names of the buttons that are gone are said nowhere: 공간 편집 on a button or in a hint, and the 취소 of the header
  // (the bar of the polygon tool has a 취소 of its own, further down).
  for (const source of [editor, gallery]) for (const old of ['공간 편집에서', '도면 편집에서', '>공간 편집<']) assert.ok(!source.includes(old), `still there: ${old}`);
  assert.ok(!row.includes('>취소</button>'));
  // The name of a button is said only to those who have it on screen. The image list is read while editing as well, right
  // under the band, where the button is hidden: its two hints speak of editing the map and name no button. The whole
  // choice, like the hint of the editor below: each hint to its last mark, the one about a view under a picked camera
  // and the other under anything else, and before both the branch of a read-only account, which is not told to edit.
  assert.ok(gallery.includes("!snapshot.canManage ? '관리자가 도면이나 공간에 연결한 배경이 여기에 표시됩니다.' : selected?.type === 'camera' ? '도면을 편집하면서 이 카메라에 배경 시점을 연결해 주세요.' : '도면 설정에서, 또는 도면을 편집하면서 공간에 배경 장소를 연결하면 여기에 모입니다.'"));
  assert.equal(count(gallery, /도면을 편집하면서/g), 2);
  assert.ok(!gallery.includes('편집 시작'));
  // The hint of an empty map, the whole line. It names the button in the branch of those who are not editing, and there
  // only to an account that may edit: a read-only account, which has no such button, is told who fills the map. The
  // editor says the name on the button and in that hint, nowhere else.
  assert.ok(editor.includes(`<span>{editing ? '도형을 고르고 빈 곳을 드래그하거나 밑그림을 올려보세요.' : snapshot.canManage ? "'편집 시작'을 누르면 공간·문·사물·카메라를 배치할 수 있습니다." : '관리자가 공간을 배치하면 여기에 표시됩니다.'}</span>`));
  assert.equal(count(editor, /편집 시작/g), 2);
  // The badge beside the title is gone, in either of its wordings and whatever the quotes: the band says it, and its
  // words are in mapEditStatus.ts.
  for (const old of ['저장 전 변경사항', '편집 중']) assert.ok(!editor.includes(old), `still there: ${old}`);
  // Nor is it back with its words borrowed: no badge of any wording stands in the header, and the editor does not take
  // the label of the band from the status module (the band's own file does).
  assert.doesNotMatch(piece(editor, '<header className="bmap-header">', '</header>'), /bmap-badge/);
  assert.ok(!editor.includes('MAP_EDIT_LABEL'));
  // The dot of the tree hangs on what it always did, unsaved edits of that map, on show or not: not on the state of the
  // band, which knows the map on show alone. Only its tooltip changed, to the words of the band.
  assert.ok(editor.includes('mapDraftChanged(mapDraft(state, map.id)) && <span className="bmap-draft-dot" title="저장 안 한 변경이 있어요">●</span>'));
  // 연결 해제 is drawn only while there is a link, so the save its own click starts takes the button away, and editing goes
  // on. The focus is sent to the canvas before that save: left on a button that is gone, Delete, Ctrl+Z and F2 are not heard.
  assert.ok(button('연결 해제').includes('onClick={() => { focusCanvas(); void linkMap(null, selected.id); }}'));
  // Both clicks send the focus to the canvas of the mode on show, and neither canvas is a control: the SVG of the plan and
  // the stage of the 3D view take it only by their `tabIndex`. Without it `focus()` does nothing there, and the keyboard
  // stays on the hidden 편집 시작, or on a 연결 해제 that is gone.
  assert.ok(canvasTag().includes(' tabIndex={0} '));
  assert.ok(editor.includes('<div className="bmap-3d-main" ref={stageRef} tabIndex={-1} '));
});

test('anchor 59: the new test files run in the build', () => {
  // The build runs every test file a pattern of names finds. A file that is deleted, or renamed out of that pattern, takes
  // its tests with it and leaves the build green. This file is old and inside the pattern: it asks for the new ones by name.
  const tests = new URL('./', import.meta.url), names = readdirSync(tests);
  for (const name of ['backgroundMapEditStatus.test.ts', 'backgroundMapEditColor.test.ts', 'backgroundMapNumberField.test.ts']) {
    assert.ok(names.includes(name), `not in the tests folder: ${name}`);
    const source = readFileSync(new URL(name, tests), 'utf8');
    // And each tests something: a file whose tests are all skipped is green as well.
    assert.ok(count(source, /^test\(/gm) >= 3, `fewer than three tests: ${name}`);
    // Whatever the spelling: `test.skip(`, `describe.skip(`, `t.skip()`, an option `skip:` or `todo:` in any place among
    // the options, `import { skip as test }`. Neither word has any business in these files, so neither is there at
    // all (`skipped`, a count in the colour tests, is another word), and `test` is the runner's own.
    assert.doesNotMatch(source, /\b(?:skip|todo)\b/, `${name} skips a test`);
    assert.ok(source.startsWith("import test from 'node:test';"), `${name} does not take test from node:test`);
  }
  // The pattern itself, letter for letter, and the two builds that run it.
  const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(scripts['test:background'], 'node --test ./tests/background*.test.ts');
  for (const build of ['build', 'build:vite']) assert.ok(scripts[build].includes('npm run test:background'), `${build} does not run the background tests`);
});

test('anchor 62: the pointer of a slide is heard on the window, its capture is only tried, and no listener stays however it ends', () => {
  // The hook is read as this anchor runs: without its file this anchor fails, not every anchor of this file. No test of
  // Node reaches a React hook, so its lines are held by their letters. `lines` are those lines without their indent.
  const hook = read('useMapScrubPointer.ts'), lines = hook.split('\n').map(line => line.trim()).filter(Boolean);
  /** Each is a line of its own, as written: nothing stands in front of one, and none is the head of a longer line. */
  const own = (...texts: string[]) => { for (const text of texts) assert.ok(lines.includes(text), `not a line of its own: ${text}`); };
  // The listeners. The moves and the release are heard on the window, in the capture phase: with a capture the events of
  // the pressed element pass there, and without one (the inspection window has none) those of whatever is under the
  // pointer do. Heard on the element alone, a drag would hang on its capture, and would follow no pointer where there is
  // none. The blur is not heard in the capture phase: the blur of the field the drag takes the focus from would be heard
  // too, and would cancel the drag as it starts. And the same five are taken away, under the same flags: one that stays
  // goes on reading every move of the window.
  const added = ["window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', cancel, true);",
    "window.addEventListener('blur', cancel); target.addEventListener('lostpointercapture', cancel);"];
  const removed = ["window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancel, true);",
    "window.removeEventListener('blur', cancel); target.removeEventListener('lostpointercapture', cancel);"];
  own(...added, ...removed);
  // The capture is only tried: where there is none the call may throw, and the window listeners follow the pointer anyway.
  const captured = 'try { target.setPointerCapture(pointerId); } catch';
  assert.ok(hook.includes(captured), 'the capture is tried');
  // The press, in this order. A pointer that is not the primary one, another button or a control that is off: nothing
  // happens, and the default of that press is left alone. The same while a session of another pointer runs. A session of
  // this very pointer that is still here never heard its release (the pressed element went away, and the button came up
  // outside the window): it is given up first. Turned away instead, the control would take no press until it is drawn
  // anew. Only then is the default prevented, which keeps the focus in a field that is being typed in until the drag
  // starts and moves it.
  const press = ['if (!event.isPrimary || event.button !== 0 || latest.current.disabled) return;',
    'if (session.current) { if (session.current.pointerId !== event.pointerId) return; session.current.giveUp(); }', 'event.preventDefault();'];
  own(...press);
  inOrder(hook, ...press);
  // The guard: what another pointer does is none of this session's business. Three, one in each of the three listeners:
  // without the one of `up`, the release of a second pointer would end the drag of the first.
  const inMove = piece(hook, 'function move(', 'function up('), inUp = piece(hook, 'function up(', 'function cancel('), inCancel = piece(hook, 'function cancel(', 'session.current = active;');
  assert.equal(count(hook, /event\.pointerId !== active\.pointerId/g), 3, 'the guards of move, up and cancel');
  for (const listener of [inMove, inUp, inCancel]) assert.equal(count(listener, /event\.pointerId !== active\.pointerId/g), 1, 'one guard in each');
  // The move. With the left button up it is the release, read where the pointer is: letting go of the left button while
  // another one is held arrives as a move, and so does a pointer that comes back after its button came up outside the
  // window. Without that line the value would go on following a pointer that nothing holds. The slop is measured along
  // the axis of the control alone: measured as a distance, a grip moved up or a lens moved sideways would start a drag.
  // And it is asked at all: without it a mere press on the name of a field would start a gesture.
  const move = ['if ((event.buttons & 1) === 0) { up(event); return; }',
    "const along = drive.axis === 'x' ? event.clientX - active.press.clientX : event.clientY - active.press.clientY;",
    'if (Math.abs(along) >= MAP_NUMBER_SCRUB.slopPx) begin(event, along);'];
  own(...move);
  // The start. Beginning moves the focus, and what that commits is drawn at once: a control that was taken down meanwhile
  // cancels the gesture it has just opened, which nobody else would end. A start that is refused ends the session. And the
  // drag opens where it starts, the press moved by the slop along the axis and towards the pointer, never where the
  // pointer is by then: a fast start would lose that much of its way, and measured from the press itself the first value
  // of the lens would jump. That place is held as the whole line, down to the Shift of the move that started the drag.
  const start = ['if (session.current !== active) { if (origin && latest.current.scrub.alive()) latest.current.scrub.cancel(); return; }',
    'if (!origin) { end(); return; }', 'const slop = Math.sign(along) * MAP_NUMBER_SCRUB.slopPx;',
    "const from = drive.immediate ? active.press : { clientX: active.press.clientX + (drive.axis === 'x' ? slop : 0), clientY: active.press.clientY + (drive.axis === 'y' ? slop : 0), shiftKey: at.shiftKey };",
    "drag = drive.open(origin, from); active.last = origin.start; active.phase = 'dragging';"];
  own(...start);
  assert.ok(!hook.includes('.open(origin, at)'));
  // The reading. Once the editor has cancelled the drag (Escape, a save starting) nothing more comes of this press. And a
  // value is shown only when it is another one: previewed at every pixel, the editor would be drawn again at every pixel.
  const reading = ["if (!latest.current.scrub.alive()) { active.phase = 'dead'; drive.close?.(); return; }",
    'if (Number.isFinite(value) && value !== active.last) { active.last = value; latest.current.scrub.preview(drive.field, value); }'];
  own(...reading);
  assert.equal(count(hook, /scrub\.preview\(/g), 1, 'one preview, in the reading');
  // The release, read inside `up`: a move reads the pointer too. A press that never became a drag is a tap, and the control
  // is told so (a field takes the focus): untold, a press on a grip would do nothing at all. A drag reads the place of the
  // release, and is finished only if it is still a drag after that: finished unasked, the release that follows an Escape
  // would end a gesture that is not this one. Then the click that follows a drag is swallowed (on the name of a field it
  // would put the caret in the box), and the swallowing is taken away again: left there, the window would hear no click.
  const tap = "if (active.phase === 'pressed') { end(); drive.tap?.(); return; }", finish = "if (active.phase === 'dragging') { latest.current.scrub.finish(); drive.close?.(); }";
  const swallow = ["window.addEventListener('click', swallow, true);", "window.setTimeout(() => window.removeEventListener('click', swallow, true), 0);"];
  own(tap, finish, ...swallow);
  inOrder(inUp, tap, 'read(event);', finish, ...swallow);
  assert.equal(count(hook, /drive\.tap\?\.\(\)/g), 1, 'one tap, of a press that is released');
  assert.equal(count(hook, /scrub\.finish\(\)/g), 1, 'one finish, of a drag that is released');
  // Given up (the pointer is cancelled, the window loses the focus, the capture is lost, the same pointer presses again):
  // a drag that still runs is cancelled, never finished.
  const gaveUp = "if (active.phase === 'dragging') { if (latest.current.scrub.alive()) latest.current.scrub.cancel(); drive.close?.(); }";
  own(gaveUp);
  // Taken down with a press still on it: a drag that runs is cancelled, and the listeners go on the very next line, under
  // no condition. Kept for a press that had not become a drag yet, the next move would start the drag on the node that
  // was picked meanwhile.
  const down = "if (active.phase === 'dragging' && latest.current.scrub.alive()) latest.current.scrub.cancel();", downAt = lines.indexOf(down);
  assert.ok(downAt > -1, 'taken down, a drag that runs is cancelled');
  assert.equal(lines[downAt + 1], 'active.end();');
  // A drag is cancelled in those three places (given up, taken down, taken down while it started) and nowhere else, each
  // time after asking whether one still runs: the editor may have cancelled it already (Escape, a save starting).
  assert.equal(count(hook, /scrub\.cancel\(\)/g), 3, 'given up, taken down, taken down while it started');
  assert.equal(count(hook, /scrub\.alive\(\)\) latest\.current\.scrub\.cancel\(\)/g), 3, 'each cancel asks first');
  // Shift is the one modifier that is read, off the pointer events themselves: no key is listened for, and Alt means
  // nothing here (on the plan it is kept from the window menu, anchor 17; a drag that starts outside the canvas is not).
  for (const none of ['altKey', 'ctrlKey', 'metaKey', "addEventListener('keydown'"]) assert.ok(!hook.includes(none), `still there: ${none}`);
  // And the hook holds nothing else: from its first line through the brace that closes it, it is the lines above and what
  // joins them, in this order. What joins them, and what goes wrong without it. `latest` is brought up to date at every
  // render: a control that was off when it was first drawn (view mode, a locked node) would stay deaf once it is on. The
  // cleanup is what an effect that runs once returns, and all that stands in front of its two lines is the return for no
  // session: with a return for a session that is no drag yet the listeners of a mere press would stay, and run after
  // every render it would cancel a drag at its first step. The element is the one that was given the handler, not what
  // was pressed inside it (the picture of a grip). `end` lets the capture go only after the listeners (the
  // lostpointercapture that raises is no cancel) and empties the ref of this session alone. Giving up ends the session,
  // and a cancel gives up: left out, the listeners of a drag that was cancelled from outside would stay. A start reads the
  // pointer at once: a fast start shows the way it has already gone, and a press on the bar shows its value at the press.
  // A drag reads every move, and one the editor cancelled stays dead until the release: without that line the next move
  // would start it again from the press, and Escape would not hold while the hand still moves. A release ends the session
  // after a drag as after a tap. The click that follows is stopped and its default is prevented: stopped alone, the name
  // of a field would still put the caret in its box, and prevented alone, what the pointer was released over would still
  // hear a click. The session is recorded before the press may start a drag: recorded after, a press on the bar would
  // cancel what it has just begun. And a press starts at once only where the control says so (on the bar, away from its
  // dot): started at once everywhere, a press on a name would be no tap, and would open a gesture.
  const signature = 'export function useMapScrubPointer(scrub: MapFieldScrub, disabled: boolean): <S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => void {';
  // Read as above, with one blank where a comment was taken out of a pair of braces.
  assert.deepEqual(block(hook, signature).split('\n').map(line => line.trim().replace(/\{\s+\}/, '{ }')).filter(Boolean), [signature,
    'const latest = useRef({ scrub, disabled }), session = useRef<Session | null>(null);', 'latest.current = { scrub, disabled };',
    'useEffect(() => () => {', 'const active = session.current;', 'if (!active) return;', down, 'active.end();', '}, []);',
    'return useCallback(<S>(event: ReactPointerEvent<Element>, drive: MapScrubDrive<S>) => {', ...press,
    'const target = event.currentTarget, pointerId = event.pointerId;', 'let drag: S;',
    "const active: Session = { pointerId, press: { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey }, phase: 'pressed', last: Number.NaN, end, giveUp };",
    'function end() {', ...removed, 'try { if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId); } catch { }', 'if (session.current === active) session.current = null;', '}',
    'function giveUp() {', gaveUp, 'end();', '}',
    'function read(at: MapScrubPoint) {', reading[0], 'const value = drive.read(drag, at);', reading[1], '}',
    'function begin(at: MapScrubPoint, along: number) {', 'const origin = latest.current.scrub.begin(drive.field);', ...start, 'read(at);', '}',
    'function move(event: PointerEvent) {', 'if (event.pointerId !== active.pointerId) return;', move[0], "if (active.phase === 'dragging') { read(event); return; }", "if (active.phase === 'dead') return;", move[1], move[2], '}',
    'function up(event: PointerEvent) {', 'if (event.pointerId !== active.pointerId) return;', tap, "if (active.phase === 'dragging') {", 'read(event);', finish, '}', 'end();',
    'const swallow = (click: Event) => { click.stopPropagation(); click.preventDefault(); };', ...swallow, '}',
    'function cancel(event: Event) {', "if ('pointerId' in event && event.pointerId !== active.pointerId) return;", 'giveUp();', '}',
    'session.current = active;', ...added, `${captured} { }`, 'if (drive.immediate) begin(active.press, 0);', '}, []);', '}']);
});
