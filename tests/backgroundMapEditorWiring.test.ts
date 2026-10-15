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
  /** The four of the delete dialog of a map, as they stand in the file: each up to the next, the last up to the function behind them. */
  dropGoneDrafts: () => piece(editor, 'function dropGoneDrafts(', 'function openMapDelete('),
  openMapDelete: () => piece(editor, 'function openMapDelete(', 'async function runMapDelete('),
  runMapDelete: () => piece(editor, 'async function runMapDelete(', 'function closeMapDelete('),
  closeMapDelete: () => piece(editor, 'function closeMapDelete(', 'function newSpace('),
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
  /** The five handlers of the view settings of this PC (the eye of the object list, the closed box of a room in 3D), up to the stable callback that follows them. */
  viewPrefs: () => piece(editor, 'const setNodesHidden = useEvent(', 'const openView = useEvent('),
  /** No handler of a key or a press: the begin and the preview of a slide and the scrub object made of them, up to the stable callback that follows. */
  fieldScrub: () => piece(editor, 'const beginFieldScrub = useEvent(', 'const placeAt = useEvent('),
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
/** The number fields of the inspector: of each tag what stands between its name and the ` />` that closes it, its attributes as they are written. */
const numberTags = () => editor.split('<NumberField ').slice(1).map(part => part.slice(0, part.indexOf(' />')));
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
  // A new symbol belongs to the topmost space that holds its spot among those on show: a room the eye hides takes none.
  assert.match(handler.placeSymbol(), /spacesAt\(shownMap\(base, hiddenIds\), point\)\[0\]/);
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
  // The list is written in four more places: on the plan a box, a Shift+click and a group delete, and in either mode
  // hiding a node, which takes it out of what is selected (setNodesHidden).
  assert.equal(count(editor, /\bdoc\.selectMany\(/g), 4);
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
  assert.match(down, /resolvePlanPress\(\{ canEdit, shift: event\.shiftKey, hit: hit \?\? null,\s*pile: hit \? planPileAt\(shownMap\(live, hiddenIds\), hit\.id, point, undefined, item => planMarkCovers\(item, point\)\) : \[\],\s*selection: held, again, node: id => live\.nodes\.find\(item => item\.id === id\) \}\);/);
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
  // The release selects what the box touches of what is drawn (nothing the eye hides), unless it was cancelled, and writes nothing to the map.
  const up = handler.pointerUp(), box = block(up, "if (session.mode === 'marquee') {");
  inOrder(box, 'setMarquee(null);', 'if (!cancel && session.moved && canEdit) {', 'doc.selectMany(session.mapId, planMarqueeIds(shownMap(live, hiddenIds), planRect(session.start, point)));');
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
  // It is told what the eye hides and how many of those the editor counted, and a row is picked through selectFromList,
  // which shows a hidden node first: nothing hidden is ever selected.
  assert.match(editor, /<ObjectList nodes=\{settledCurrent\?\.nodes \?\? current\.nodes\} selectedIds=\{listSelection\.ids\} primaryId=\{listSelection\.primaryId\} hiddenIds=\{hiddenIds\} hiddenCount=\{hiddenCount\} onSelect=\{selectFromList\} onToggleHidden=\{toggleHidden\} onShowAll=\{showAll\} \/>/);
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
  // No save drops a draft any more, and the five saves all go through that function.
  assert.doesNotMatch(editor, /dropDrafts/);
  assert.equal(count(editor, /await persistMaps\(/g), 5, 'the map, a new map, a link, the settings, the save step of a map delete');
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
  // The word stands five times: the function, this call, the delete dialog of a map as it comes up and as a run of it
  // stops (anchor 66 holds those two where they are), and hiding a node when what the properties show changes
  // (setNodesHidden).
  assert.equal(count(editor, /\bswallowSecondClick\b/g), 5, 'the function, 편집 끝내기, the delete dialog of a map as it opens and as a run of it stops, and hiding that changes what the properties show');
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
    'if (dialogOpen || document.querySelector(openDialogs)) return;',
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
  // about a map it holds, with what it read of the drafts: they must not change under it (the delete dialog plans from them).
  // Then the draft of the map on show is read before and after. Replaced, the picked point goes: it is a number, and may
  // now name another point. Gone, what `navigate` clears is cleared, and only then: on a mere newer revision the points
  // that are being drawn and the tool stay. `dialogOpen` is a dependency, so what was skipped is done as the dialog closes.
  const follow = handler.followSaved(), steps = [
    'if (disabled || doc.isGestureActive() || dialogOpen) return;',
    'const before = mapDraft(doc.getState(), current?.id);',
    'doc.followSaved(snapshot.maps);',
    'if (mapDraft(doc.getState(), current?.id) !== before) setActiveVertex(null);',
    "if (before && !mapDraft(doc.getState(), current?.id)) { setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null); setError(''); }",
    'useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, dialogOpen]);',
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
  for (const name of ['backgroundMapEditStatus.test.ts', 'backgroundMapEditColor.test.ts', 'backgroundMapNumberField.test.ts', 'backgroundMapDelete.test.ts', 'backgroundMapViewPrefs.test.ts', 'backgroundMapImageDrop.test.ts']) {
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

test('anchor 60: every number of the inspector is one component, on one table and one scrub object', () => {
  // The component comes into the editor under the name its fields always had there, so a tag still reads `<NumberField `
  // (anchor 44 holds one by its letters). The field the editor had of its own is gone, and no number input is left in
  // this file: a field left on one would have no grip and no bar, and could only be typed in. Gone with it are the two
  // limits the editor kept for the plan: what a field accepts is written in one place, the table the component reads.
  assert.ok(editor.includes("import { BackgroundMapNumberField as NumberField } from './BackgroundMapNumberField';"), 'the number fields of the editor are not the component');
  for (const old of ['function NumberField(', 'type="number"', 'PLAN_LIMIT', 'MIN_PLAN_SIZE']) assert.ok(!editor.includes(old), `still there: ${old}`);
  assert.doesNotMatch(editor, /\btype=\{?['"`]number\b/, 'a number input of the editor\'s own, in whatever quotes');
  // It is drawn by that one import and under that one name, fourteen times. A field drawn under another spelling of its
  // tag (a line break after the name, the name of the component itself) would be read by nothing below.
  assert.equal(count(editor, /\bNumberField\b/g), 15, 'the import and the fourteen tags');
  assert.equal(count(editor, /BackgroundMapNumberField/g), 2, 'the one import: the name and the file');
  // The fourteen fields: the name on show, the number of the node it is, the value it shows, and what a typed value
  // does. The second is the key of its row in the table (its limits, its steps, its bar) and the key a slide of it
  // writes. Two names share a key where two kinds of node have the same number: the height of a camera and the floor of
  // a space or an object, the two tilts of a camera and of an object.
  const fields = [
    ['카메라 높이', 'elevation', 'nodeElevation(selected)', "elevation => patchNode({ elevation }, 'elevation')"],
    ['방향 (°)', 'angle', 'selected.angle', "angleValue => patchNode({ angle: normalizeAngle(angleValue) }, 'angle')"],
    ['위아래 각도 (°)', 'pitch', 'angles.pitch', "pitch => patchNode({ pitch }, 'pitch')"],
    ['기울기 (°)', 'roll', 'angles.roll', "roll => patchNode({ roll }, 'roll')"],
    ['화각 (°)', 'fov', 'selected.fov', "fov => patchNode({ fov }, 'fov')"],
    ['바닥 높이', 'elevation', 'nodeElevation(selected)', "elevation => patchNode({ elevation }, 'elevation')"],
    ['입체 높이', 'volumeHeight', 'nodeVolumeHeight(selected)', "volumeHeight => patchNode({ volumeHeight }, 'volumeHeight')"],
    ['앞뒤 기울기 (°)', 'pitch', 'nodeAngles(selected).pitch', "pitch => patchNode({ pitch }, 'pitch')"],
    ['좌우 기울기 (°)', 'roll', 'nodeAngles(selected).roll', "roll => patchNode({ roll }, 'roll')"],
    ['가로 위치', 'x', 'selected.x', "x => moveSelected({ x: x - selected.x, y: 0 }, 'x')"],
    ['세로 위치', 'y', 'selected.y', "y => moveSelected({ x: 0, y: y - selected.y }, 'y')"],
    ['가로 길이', 'width', 'selected.width', "width => patchNode({ width }, 'width')"],
    ['세로 길이', 'height', 'selected.height', "height => patchNode({ height }, 'height')"],
    ['회전 (°)', 'rotation', 'selected.rotation', "rotation => patchNode({ rotation: normalizeAngle(rotation) }, 'rotation')"],
  ];
  const tags = numberTags(), listed = (rows: string[][]) => rows.map(row => row.join(' | ')).sort();
  assert.equal(tags.length, 14, 'the number fields of the inspector');
  // Every tag opens with its name, its key and its value, in that order, and the three are those of one row: compared as
  // whole lists and in no order, so each field is there once, with its own three. A name on another key ('세로 길이' on
  // `width`) would slide one number while what is typed in it changes another. Two values swapped ('가로 위치' showing
  // `selected.y`) would show one number while the slide starts from another.
  const opening = (tag: string) => /^label="([^"]*)" field="([^"]*)" value=\{([^{}]*)\} /.exec(tag)?.slice(1) ?? [];
  for (const tag of tags) assert.equal(opening(tag).length, 3, `a number field does not open with its name, its key and its value: ${tag}`);
  assert.deepEqual(listed(tags.map(tag => opening(tag))), listed(fields.map(row => row.slice(0, 3))));
  // Every field is off while its node is locked or a save runs, slides through the one scrub object of the editor, and
  // ends the undo step of what was typed in it as it is left. None is given a limit: its limits are those of its row in
  // the table, and given here again there would be two sets of them.
  for (const tag of tags) {
    for (const given of ['disabled={fieldLocked}', 'scrub={fieldScrub}', 'onDone={doc.endCoalescing}']) assert.ok(tag.includes(` ${given}`), `not given ${given}: ${tag}`);
    for (const limit of [' min=', ' max=']) assert.ok(!tag.includes(limit), `given a limit of its own (${limit.trim()}): ${tag}`);
  }
  // And that name means what it says, in one line: no right to edit (nothing is being edited, or a save runs), or a
  // locked node in hand. Cut to its first half, the name, the grip and the bar of a locked node would look live, and
  // its boxes would take what is typed: `patchNode` turns away a locked space and no other node, so a height, an angle
  // or a size typed into a locked camera or object would be written. And the name is given that meaning nowhere else:
  // a second one, in the block of the camera say, would be the one the five fields there read.
  assert.ok(editor.includes('const fieldLocked = !canEdit || !!selected?.locked;'), 'a field is not off for a locked node, or not while a save runs');
  assert.equal(count(editor, /\bfieldLocked\s*=(?!=)/g), 1, 'the name is given its meaning once');
  // A typed value goes the way it always went, the one of its row: into the edit of its field, which joins the keys of
  // one stay in the field into one undo step (patchNode, and moveSelected for the two positions, each with the key of
  // the field). Sent through the scrub object instead, every key typed would be a gesture, and an undo step of its own.
  for (const [label, , , typed] of fields) {
    const tag = tags.find(item => item.startsWith(`label="${label}" `)) ?? '';
    assert.ok(tag.endsWith(` onChange={${typed}}`), `what is typed into ${label} does not go the way of its row: ${tag}`);
  }
  // And a tag holds nothing else: those seven attributes, in this order.
  assert.deepEqual([...tags].sort(), fields.map(([label, field, value, typed]) => `label="${label}" field="${field}" value={${value}} disabled={fieldLocked} scrub={fieldScrub} onDone={doc.endCoalescing} onChange={${typed}}`).sort());
  // And that way is the one it always was, line for line: the function every edit of the map goes through, the edit
  // of a field and the move of a position. `patchNode` lays each key typed on the map as it was when the stay in that
  // field began (the members of a space are carried once, whatever was typed on the way) and sends it as an update
  // that joins the others of that stay by the key of the field; `moveSelected` sends a position the same way. Sent
  // through the scrub object in one of the three, or as a gesture of the document, every key typed would be an undo
  // step of its own; so it would be with that key left out, or with the options dropped on the way to the document.
  // (The comments of the editor are not read here: every line of the list is a line of code.)
  assert.deepEqual(piece(editor, 'function updateMap(', 'function changeSpaceSurface(').split('\n').map(line => line.trim()).filter(Boolean), [
    'function updateMap(next: BackgroundMap, options?: MapUpdateOptions) {', 'if (snapshot.canManage) doc.update(next, options);', '}',
    'function patchNode(changes: Partial<BackgroundNode>, field?: string) {', 'if (!current || !selected || !canEdit) return;',
    'const key = field ? `${selected.id}:${field}` : undefined;', 'const base = (key && fieldEditStartMap(doc.getState(), current.id, key)) || current;',
    'const next = { ...(base.nodes.find(node => node.id === selected.id) ?? selected), ...changes } as BackgroundNode;',
    "updateMap(next.type === 'space' ? transformMapSpace(base, next) : { ...base, nodes: base.nodes.map(node => node.id === next.id ? next : node) },",
    'key ? { coalesceKey: key } : undefined);', '}',
    'function moveSelected(delta: BackgroundPoint, field: string) {', 'if (!current || !selected || !canEdit) return;',
    'updateMap(moveMapNode(current, selected.id, delta), { coalesceKey: `${selected.id}:${field}` });', '}']);
  // Every field is taken down as another node comes into hand: each stands in an element whose key holds the id of that
  // node, the five of a camera, the four heights and tilts, the five of the place, the size and the turn. A pick is no
  // release and no cancel: a pointer pressed on a field is let go then only as the field is taken down (anchor 62),
  // and the begin and the preview of a slide write to the node in hand at the latest render (anchor 61). In an element
  // without that key the fields would stay up across a pick, with the press of the node before: the next move would
  // start the drag on the node just picked, and a drag already running would write its value into that node.
  const keyed = [piece(editor, '<section className="bmap-camera-properties" key={`camera-${selected.id}`} ', '</section>'),
    piece(editor, '<details className="bmap-disclosure" open key={`vertical-${selected.id}`}>', '</details>'),
    piece(editor, '<details className="bmap-disclosure" key={`geometry-${selected.id}`}>', '</details>')];
  assert.deepEqual(keyed.map(part => count(part, /<NumberField /g)), [5, 4, 5], 'a number field stands outside the elements keyed by the node in hand');
  // And those elements are drawn only while the map is being edited: someone who views, or an account that may not
  // edit, has no field and no grip (of a camera there is a line of words instead). The five of a camera stand in the
  // first half of a choice asked of `editing`. The others stand in the one element drawn under `editing &&`, which
  // opens right in front of the section that ties a space to a place and holds the two sections with the nine fields.
  // Asked of anything else, or closed before those sections, the fields would be drawn in view mode: off, and there.
  assert.ok(editor.includes('{editing ? <section className="bmap-camera-properties" key={`camera-${selected.id}`} '), 'the fields of a camera are drawn while the map is only viewed');
  const tied = '{selected.type === \'space\' ? <details className="bmap-disclosure" key={`place-${selected.id}`}>', gate = '{editing && <>';
  const tiedAt = positions(editor, tied)[0], gateAt = editor.lastIndexOf(gate, tiedAt);
  assert.ok(gateAt > -1 && !editor.slice(gateAt + gate.length, tiedAt).trim(), 'the sections of the node in hand do not open under `editing &&`');
  const whileEditing = block(editor.slice(gateAt), '{');
  assert.deepEqual([keyed[1], keyed[2]].map(part => whileEditing.includes(part)), [true, true], 'the heights or the place of a node are drawn while the map is only viewed');
});

test('anchor 61: a slide is a gesture of the document, previewed from the map it started on', () => {
  // A number slid from outside the canvas (a field of the inspector, the lens of the side view) goes through the scrub
  // object of the editor: a begin and a preview of its own, and the object the controls are given, which is made of
  // them. `lines` are the lines of the three, without their indent.
  const scrub = handler.fieldScrub(), lines = scrub.split('\n').map(line => line.trim()).filter(Boolean);
  /** Each is a line of its own, as written: nothing stands in front of one, and none is the head of a longer line. */
  const own = (...texts: string[]) => { for (const text of texts) assert.ok(lines.includes(text), `not a line of its own: ${text}`); };
  // The begin. It is refused where there is nothing to slide: no map or no node in hand, a locked node, no right to
  // edit or a save running, a pointer pressed on the plan, another drag. Then the focus goes to the canvas, before
  // anything else: leaving a field commits what was being typed in it (an entry out of range lands on its limit, as an
  // undo step of its own), and an open name box commits its name. Once the gesture has begun that update would be
  // dropped without a word: a gesture is the only writer of its map. Only after that is the value the drag starts from
  // read, from the draft in the store and off the node as it is there (a node locked there has no value to start
  // from). Read off the node of the render (`mapNodeNumber(selected, field)`) it would be the value from before that
  // commit: a box height of 0 typed a moment ago is 1 once its field is left, and the slide of that very field would
  // start from the 180 that was still drawn. Then the gesture begins, and what the control gets back is that value,
  // with that very map.
  const refused = 'if (!current || !selected || selected.locked || !canEdit || pointerRef.current || doc.isGestureActive()) return null;';
  const live = 'const map = mapDraft(doc.getState(), current.id)?.value, node = map?.nodes.find(item => item.id === selected.id);';
  const first = 'const start = node && !node.locked ? mapNodeNumber(node, field) : null;';
  const begun = 'if (!map || start === null || !doc.beginGesture(current.id)) return null;';
  own(refused, 'focusCanvas();', live, first, begun, 'return { start, map };');
  // The preview. It is made from the map the gesture started on, never from the map on show, which is the preview
  // before it: a space carries its cameras and objects along once, from where they stood. Made from the preview before,
  // they would be carried further at every step. And it is a preview of the gesture: an update of the map is dropped
  // while a gesture runs, and nothing would move at all.
  const origin = 'const start = current && gestureStartMap(doc.getState(), current.id);';
  const shown = 'if (start && selected && canEdit) doc.previewGesture(setMapNodeNumber(start, selected.id, field, value));';
  own(origin, shown);
  // The object. A drag ends through the two callbacks the 3D viewport ends its own with: a release finishes it only
  // while the map can still be edited, and is a cancel once a save has started. Handed `doc.finishGesture` itself, that
  // release would make an undo step. And `alive` is the document's own answer: by it the hook and the controls learn
  // that the editor has cancelled a drag (Escape, a save starting, another map).
  const ends = 'finish: finishCanvasGesture, cancel: cancelCanvasGesture, alive: doc.isGestureActive';
  assert.ok(scrub.includes(ends), 'a slide does not end through the callbacks of the editor');
  inOrder(scrub, refused, 'focusCanvas();', 'mapDraft(doc.getState(), current.id)', first, 'doc.beginGesture(current.id)', 'return { start, map };',
    origin, 'doc.previewGesture(setMapNodeNumber(start, selected.id, field, value));', ends);
  // A slide is never an edit that joins others. Joined by the key of its field, as what is typed is, two slides of one
  // field would be one undo step, and its update would be dropped while a gesture runs. And nothing here finishes a
  // gesture by itself.
  for (const none of ['updateMap(', 'doc.update(', 'coalesceKey', 'doc.finishGesture(']) assert.ok(!scrub.includes(none), `still there: ${none}`);
  // And the three hold nothing else: they are the lines above and what joins them, in this order. What joins them. The
  // begin and the preview are stable callbacks that run the handler of the latest render (useEvent): kept from the
  // render that made them, they would go on reading the node that was in hand then. A begin is refused as well where
  // the store has no draft of the map, where the node has no such number, and where the document starts no gesture. A
  // preview comes to something only while a gesture runs on the map on show, with a node in hand and the right to edit.
  // And the object is made once, of callbacks that never change: every control is given the same one at every render.
  assert.deepEqual(lines, ['const beginFieldScrub = useEvent((field: MapNumberKey) => {', refused, 'focusCanvas();', live, first, begun, 'return { start, map };', '});',
    'const previewFieldScrub = useEvent((field: MapNumberKey, value: number) => {', origin, shown, '});',
    `const fieldScrub = useMemo((): MapFieldScrub => ({ begin: beginFieldScrub, preview: previewFieldScrub, ${ends} }),`,
    '[beginFieldScrub, previewFieldScrub, finishCanvasGesture, cancelCanvasGesture, doc.isGestureActive]);']);
  // The four callbacks of the 3D viewport are as they were, letter for letter. Its begin answers nothing and moves no
  // focus: a slide has the begin above, which does both. And the three of the slide stand right behind those four, in
  // no handler another anchor cuts out: placed before them, the object would be made of two callbacks that are not
  // there yet, and the editor could not be drawn.
  const canvas = ['const beginCanvasGesture = useEvent(() => { if (current && canEdit && !pointerRef.current) doc.beginGesture(current.id); });',
    'const previewCanvasGesture = useEvent((map: BackgroundMap) => { if (canEdit) doc.previewGesture(map); });',
    'const finishCanvasGesture = useEvent(() => { if (canEdit) doc.finishGesture(); else doc.cancelGesture(); });', 'const cancelCanvasGesture = useEvent(() => doc.cancelGesture());'];
  assert.ok(editor.includes(canvas[0]), 'the begin of the 3D viewport is not as it was');
  const all = editor.split('\n').map(line => line.trim()).filter(Boolean), at = all.indexOf(lines[0]);
  assert.ok(at >= canvas.length, 'the begin of a slide is a line of its own, behind the callbacks of the 3D viewport');
  assert.deepEqual(all.slice(at - canvas.length, at), canvas);
  // The write is the pure module's, and the N tests run it. Three things of it are held here as well. A value that is
  // the one already there is turned away before it is settled, and the same map object comes back: a drag that comes
  // back to where it started ends without an undo step and invents no key, and a number stored outside its limits (a
  // field of view of 175) is still what it was. Asked of the settled value alone, that drag would leave the 175 at 170.
  // A position is placed at the value: moved there by a difference it can land a last digit off, which the values of
  // the N tests do not show. And a space is written through the function that carries its cameras and objects along,
  // as when its number is typed, while any other node is replaced alone.
  const write = piece(read('mapNumberField.ts'), 'export function setMapNodeNumber(', 'export function scrubSteps(');
  const same = 'if (!node || current === null || !Number.isFinite(value) || value === current) return map;';
  assert.ok(write.includes(same), 'a value that is already there is not turned away');
  inOrder(write, 'value === current', 'settleNumber(');
  for (const writer of ['transformMapSpace(', 'replaceMapNode(', 'placeMapNode(']) assert.ok(write.includes(writer), `nothing is written through ${writer}`);
  // And the function is those lines and what joins them. A locked node is never written, nor a node that has no such
  // number. A value that settles on the one already there (171 on a field of view of 170) is turned away as well.
  assert.deepEqual(write.split('\n').map(line => line.trim()).filter(Boolean), ['export function setMapNodeNumber(map: BackgroundMap, id: string, key: MapNumberKey, value: number): BackgroundMap {',
    'const node = map.nodes.find(item => item.id === id), current = node && !node.locked ? mapNodeNumber(node, key) : null;', same,
    'const next = settleNumber(value, key);', 'if (next === current) return map;',
    "if (key === 'x' || key === 'y') return placeMapNode(map, id, key === 'x' ? { x: next, y: node.y } : { x: node.x, y: next });",
    'const changed = { ...node, [key]: next } as BackgroundNode;', "return changed.type === 'space' ? transformMapSpace(map, changed) : replaceMapNode(map, changed);", '}']);
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
  // What is left is where the slop of those lines comes from: the table of the number fields, by this import. A number
  // of the hook's own in its place (`const MAP_NUMBER_SCRUB = { slopPx: 0 };`) leaves every line above as it is, and
  // then a press that slips by one pixel, across the axis as well, starts a gesture, is no tap, and has its click
  // swallowed. Three places name the table: the import, the move and the start. A fourth would be another source of
  // it, or the table itself rewritten from the hook's file.
  own("import { MAP_NUMBER_SCRUB } from './mapNumberField.ts';");
  assert.equal(count(hook, /\bMAP_NUMBER_SCRUB\b/g), 3, 'the import, the slop of the move and the slop of the start');
});

test('anchor 63: typing and the identity of a field are as they were, and the arithmetic of a slide is the pure module\'s', () => {
  // The component is read as this anchor runs: without its file this anchor fails, not every anchor of this file. No test
  // of Node reaches a React component, so its lines are held by their letters. `lines` are they, without their indent.
  const part = read('BackgroundMapNumberField.tsx'), lines = part.split('\n').map(line => line.trim()).filter(Boolean);
  /** Each is a line of its own, as written: nothing stands in front of one, and none is the head of a longer line. */
  const own = (...texts: string[]) => { for (const text of texts) assert.ok(lines.includes(text), `not a line of its own: ${text}`); };
  // What the field is. Its name is a label tied to the box by an id, where it used to be a label round the box: the box
  // keeps its name and its role, and a press on the name still puts the focus in it. Without the `htmlFor` the box has no
  // name at all. The box is the number input it always was, the whole line: it shows what is being typed, or the value
  // to two decimals (rounded to a whole number, 244.65 would read 245); the engine is told the limits, which its arrow
  // keys stop at; and a field that is off takes no typing.
  const name = '<label className="bmap-num-label" htmlFor={id}';
  const box = '<input ref={box} id={id} type="number" step="any" value={text ?? round(value)} min={Number.isFinite(min) ? min : undefined} max={Number.isFinite(max) ? max : undefined} disabled={disabled}';
  const round = 'const round = (value: number) => Math.round(value * 100) / 100;';
  assert.ok(part.includes(name), 'the name of a field is not tied to its box');
  own(box, round);
  // Typing: the nine lines the field of the editor had, letter for letter and in this order. What is typed is kept as
  // text (dropped, an unfinished entry would vanish from the box at every key), and an empty box is no number (read as
  // zero, a field would be set to 0 the moment it is cleared). A value inside the limits applies at once, and only when
  // it is another one. Enter leaves the field. Leaving it brings an entry outside the limits to the nearest limit, then
  // drops the text and ends the undo step of the field.
  const typing = ['const [text, setText] = useState<string | null>(null);',
    "const parse = (raw: string) => { const next = raw.trim() === '' ? Number.NaN : Number(raw); return Number.isFinite(next) ? next : null; };",
    'const raw = event.target.value, next = parse(raw);', 'setText(raw);', 'if (next !== null && next >= min && next <= max && next !== value) onChange(next);',
    "onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}",
    'const next = text === null ? null : parse(text), clamped = next === null ? value : Math.min(max, Math.max(min, next));',
    'if (clamped !== next && clamped !== value) onChange(clamped);', 'setText(null); onDone?.();'];
  own(...typing);
  inOrder(part, ...typing);
  // The limits typing is held to are those of the one table, by the key of the field. Given as props again, there would
  // be two sets of them: the one a value is typed against and the one it is slid against.
  const table = 'const id = useId(), box = useRef<HTMLInputElement>(null), { min, max, track } = MAP_NUMBER_FIELDS[field];';
  own(table);
  // The slide. The pointer is the one hook's, and it is off while the field is off. The look of a drag goes as soon as
  // the editor ends the drag by itself (Escape, a save starting): asked of `dragging` alone, the field would stay lit
  // until the next pointer event. A drag of the name or of the grip opens where the hook says it starts, on the value the
  // editor gave it and never on the value of this render: the field that was being typed in is committed as the drag
  // takes the focus away, and this render knows nothing of that. Where the pointer is then becomes a value in the pure
  // module (slideNumber), and a press that is released without a drag puts the focus in the box. A press on the bar is
  // read by the pure module as well (pressNumberTrack): it starts a drag at once only away from the dot (started at once
  // on the dot too, a mere press there would open a gesture), and the value under the pointer is trackNumber's.
  const pointer = 'const press = useMapScrubPointer(scrub, disabled);', lit = 'const lit = dragging && scrub.alive();';
  const opened = 'open: (origin, from): MapNumberSlide => { setDragging(true); return { anchorX: from.clientX, anchorValue: origin.start, big: from.shiftKey, value: origin.start }; },';
  const slid = 'read: (drag, at) => slideNumber(drag, at.clientX, at.shiftKey, field),', tap = 'tap: () => box.current?.focus()';
  const onBar = 'pressNumberTrack(value, field, event.clientX, rect.left, rect.width)', immediate = 'immediate: bar.immediate';
  const barRead = 'read: (start, at) => trackNumber(bar.fraction(at.clientX), field, at.shiftKey, start),';
  own(pointer, lit, opened, slid, barRead);
  for (const text of [tap, onBar, immediate]) assert.ok(part.includes(text), `not found: ${text}`);
  // Three controls take a press: the name and the grip slide, and the bar is pressed or dragged.
  assert.equal(count(part, /onPointerDown=\{slide\}/g), 2, 'the name and the grip');
  assert.equal(count(part, /onPointerDown=\{slideBar\}/g), 1, 'the bar');
  // The sums that turn a place into a value are not written again here: the pure tests run them where they are (N-6,
  // N-7), and no test would reach them in a component. Counted here, steps would be added at every event.
  for (const none of ['stepNumber(', 'scrubSteps(']) assert.ok(!part.includes(none), `still there: ${none}`);
  // Nothing joins the Tab order. The grip and the bar are for the pointer and are kept from readers: the keyboard and a
  // screen reader have the box, which holds the same value.
  for (const hidden of ['className="bmap-num-grip" aria-hidden="true"', 'className="bmap-num-track" aria-hidden="true"']) assert.ok(part.includes(hidden), `not found: ${hidden}`);
  assert.ok(!part.includes('tabIndex'), 'a control of the pointer is in the Tab order');
  // And the file holds nothing else: it is the lines above and what joins them, in this order. What joins them, and what
  // goes wrong without it. The table, the sums and the place of the dot come from the pure module and the pointer from
  // the one hook, by these imports: a function of the same name written in this file would pass every line above, and
  // no test would reach it. The picture of the grip is the arrow with a shaft, as it was announced (↔); how large it is
  // drawn is tuned by eye in the app, so its two numbers are read as any number. The two tooltips are the words of the
  // design, and a control that is off has none. The component is a plain function: wrapped in `memo` it would not be
  // drawn again as the editor ends a drag by itself, and `lit` would not be asked again. `dragging` is on from the start
  // of a drag to its end, however it ends: left on, the field would be lit by any gesture of the document that runs
  // later (a handle dragged in 3D). A slide runs sideways and starts past the slop: started at the press, a press on
  // the name would be no tap. The bar is measured where it stands on screen, and one too narrow for its dot takes no
  // press; its drag starts on the value the editor gave as well, and lights the field as a slide does. The root carries
  // the two states the stylesheet draws, a drag and a field that is off, and it is still a field of the library
  // (`bg-field`). Only a number with fixed ends has a bar, and its dot stands where the pure module says: at the
  // fraction pressNumberTrack counts with.
  assert.deepEqual(lines.map(line => line.replace(/(<MoveHorizontal size=\{)[\d.]+(\} strokeWidth=\{)[\d.]+(\} \/>)/, '$1n$2n$3')), [
    "import { useId, useRef, useState } from 'react';", "import type { CSSProperties, JSX, PointerEvent as ReactPointerEvent } from 'react';", "import { MoveHorizontal } from 'lucide-react';",
    "import type { MapFieldScrub } from './mapCanvas';", "import { MAP_NUMBER_FIELDS, pressNumberTrack, slideNumber, trackFraction, trackNumber } from './mapNumberField';",
    "import type { MapNumberKey, MapNumberSlide } from './mapNumberField';", "import { useMapScrubPointer } from './useMapScrubPointer';",
    "const SLIDE_TITLE = '좌우로 끌어 값 바꾸기 · Shift를 누르면 큰 걸음 · 끄는 도중 Esc는 취소';", "const BAR_TITLE = '눌러서 바로 맞추거나 점을 끌어요 · Shift를 누르면 큰 걸음';", round,
    'export function BackgroundMapNumberField({ label, field, value, disabled = false, onChange, onDone, scrub }: {',
    'label: string; field: MapNumberKey; value: number; disabled?: boolean;', 'onChange(value: number): void; onDone?(): void; scrub: MapFieldScrub }): JSX.Element {',
    typing[0], typing[1], table, pointer, 'const [dragging, setDragging] = useState(false);', lit,
    'const slide = (event: ReactPointerEvent<Element>) => press(event, {', "field, axis: 'x', immediate: false,", opened, slid, `${tap},`, 'close: () => setDragging(false),', '});',
    'const slideBar = (event: ReactPointerEvent<HTMLDivElement>) => {', `const rect = event.currentTarget.getBoundingClientRect(), bar = ${onBar};`, 'if (!bar) return;',
    `press(event, { field, axis: 'x', ${immediate},`, 'open: origin => { setDragging(true); return origin.start; },', barRead, 'close: () => setDragging(false) });', '};',
    "return <div className={`bg-field bmap-num${lit ? ' is-dragging' : ''}`} data-disabled={disabled || undefined}>",
    `${name} title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}>{label}</label>`, '<div className="bmap-num-row">', box,
    'onChange={event => {', typing[2], typing[3], typing[4], '}}', typing[5], 'onBlur={() => {', typing[6], typing[7], typing[8], '}} />',
    '<span className="bmap-num-grip" aria-hidden="true" title={disabled ? undefined : SLIDE_TITLE} onPointerDown={slide}><MoveHorizontal size={n} strokeWidth={n} /></span>', '</div>',
    '{track && <div className="bmap-num-track" aria-hidden="true" title={disabled ? undefined : BAR_TITLE} onPointerDown={slideBar}>',
    `<span className="bmap-num-thumb" style={{ '--bmap-num-at': trackFraction(value, field) } as CSSProperties} />`, '</div>}', '</div>;', '}']);
  // And in what the field draws, `read` took nothing away that is more than a comment. Between the tags of JSX a `//`
  // is no comment: it is text that is drawn, and an expression written behind it still runs, while `read` drops the
  // line and the list above never sees it. One comment does stand inside what the field returns, in the handler of
  // its blur, where it is one: a line that is a comment from its first letter and holds no brace.
  const rawField = readFileSync(new URL('BackgroundMapNumberField.tsx', directory), 'utf8').replace(/\r\n/g, '\n'), root = 'return <div className={`bg-field bmap-num';
  const returned = (source: string) => source.slice(positions(source, root)[0]).split('\n').map(line => line.trim()).filter(Boolean);
  assert.deepEqual(returned(rawField).filter(line => !/^\/\/[^{}]*$/.test(line)), returned(part), 'a comment mark inside what the field draws: there it is text on screen, and the anchor does not see its line');
  // The stylesheet, line by line and as written. A number field is drawn by these twelve rules and by no other: each is
  // a base rule, one line that starts so, in this order. No line of a media block names a number field (its width looks
  // after itself): a second rule under another selector could undo any line read below, put the grip at the right end in
  // a narrow window or lay a motion on the dot. What the rules paint with is tuned by eye in the app, and is not held.
  const sheet = sheetLines(), has = (rule: string[], ...parts: string[]) => { for (const item of parts) assert.ok(rule.includes(item), `not declared: ${item} (${rule.join('; ')})`); };
  const arrows = '.bmap-num-row input::-webkit-inner-spin-button,.bmap-num-row input::-webkit-outer-spin-button { -webkit-appearance:none; appearance:none; margin:0; }';
  const room = '.bg-library .bmap-num-row input:not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="range"]) {', off = '.bmap-num[data-disabled] :is(.bmap-num-label,.bmap-num-grip,.bmap-num-track) {';
  // The rules are looked for in what is left of the sheet without its comments, wherever a comment stands and however
  // many lines it runs over. Were a line dropped whole because it starts with a comment, a rule written behind that
  // comment would be read by nothing below: it could hold the grip to the right end, or lay a motion on the dot, unseen.
  const bare = sheet.join('\n').replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, '')).split('\n');
  const num = bare.map(line => line.trim()).filter(line => line.includes('.bmap-num'));
  assert.deepEqual(num.map(line => line.slice(0, line.indexOf('{') + 1)), ['.bmap-num-label {', '.bmap-num-row {', room, arrows.slice(0, arrows.indexOf('{') + 1), '.bmap-num-grip {',
    '.bmap-num-grip:hover,.bmap-num.is-dragging .bmap-num-grip {', '.bmap-num.is-dragging .bmap-num-label {', '.bmap-num-track {', '.bmap-num-track::before {', '.bmap-num-thumb {',
    off, '.bmap-num[data-disabled] .bmap-num-grip:hover {']);
  // And each of those lines is one rule: a second one written behind the first would be read by nothing below either.
  for (const line of num) assert.equal(count(line, /\{/g), 1, `more than one rule on a line: ${line}`);
  // Nothing of a number field moves by itself: a drag is the hand moving it. And nothing of one blurs what is behind it:
  // the inspector shows several at once, and the dot is drawn anew at every step of the pointer (the motion rules of the
  // app: no backdrop-filter on what repeats or moves).
  for (const line of num) assert.doesNotMatch(line, /transition|animation|backdrop-filter/);
  // No letter of a field is slanted, by `font-style` or through the `font` shorthand: the screens of this app are set
  // without italics. And no colour is written out, as a hex or as numbers: a field is painted with the colours of the
  // theme, and the light screen and the dark one each have their own. Which of them a rule paints with is tuned by eye
  // in the app, and is not held.
  for (const line of num) { assert.doesNotMatch(line, /font-style|italic|oblique/); assert.doesNotMatch(line, /#|\b(?:rgb|hsl)a?\((?!var\()/); }
  // The two small arrows of the engine are not drawn, by that one line as it is written. The element stays, so the arrow
  // keys and the wheel over a focused field step the value as before. And no other line of the sheet names the arrows.
  assert.ok(sheet.includes(arrows), 'the small arrows of the engine are drawn');
  assert.equal(sheet.filter(line => line.includes('spin-button')).length, 1, 'one line of the sheet names the small arrows');
  // A sideways drag belongs to the control, and a touch or a pen that goes up or down scrolls the inspector: on each of
  // the three that take a press.
  const gripAt = lineOf(sheet, '.bmap-num-grip {'), grip = declarations(sheet[gripAt]), track = baseRule(sheet, '.bmap-num-track {'), thumb = baseRule(sheet, '.bmap-num-thumb {');
  for (const rule of [baseRule(sheet, '.bmap-num-label {'), grip, track]) has(rule, 'touch-action:pan-y');
  // The dot takes no press of its own: the bar under it does, and tells a press on the dot from one beside it. It is
  // placed inside the bar, and travels from half a dot inside one end to half a dot inside the other, the way
  // pressNumberTrack counts. Over the whole width it would leave the bar at the right end, and be drawn up to 10px from
  // the place a press is counted at.
  has(track, 'position:relative');
  has(thumb, 'position:absolute', 'pointer-events:none', 'left:calc(var(--bmap-num-at,0) * (100% - 10px))');
  // The dot is as wide in the sheet as in the table of the slide (`thumbPx`): one number in two files, changed together.
  const pure = read('mapNumberField.ts'), thumbPx = /\bthumbPx: (\d+)\b/.exec(pure)?.[1];
  assert.ok(thumbPx, 'the width of the dot in the table of the slide');
  has(thumb, `width:${thumbPx}px`, `left:calc(var(--bmap-num-at,0) * (100% - ${thumbPx}px))`);
  // The line of the bar is a box the sheet makes up: without `content` there is none. Its colour is tuned in the app.
  has(baseRule(sheet, '.bmap-num-track::before {'), 'content:""', 'position:absolute');
  // The grip is laid over the left end of the box, and the box keeps its number clear of it. The inspector hugs the right
  // edge of the screen: with the grip at the right end there would be no room to drag towards more. The room is made
  // under a selector that outweighs the shared input rule of the library, which sets the padding: under a lighter one
  // the number would stand beneath the grip.
  has(baseRule(sheet, '.bmap-num-row {'), 'position:relative');
  has(grip, 'position:absolute', 'left:1px');
  assert.ok(!sheet[gripAt].includes(' right:') && !grip.some(item => item.startsWith('right:')), 'the grip is held to the right end as well');
  has(baseRule(sheet, room), 'padding-left:24px');
  // And the grip ends inside that room: its inset and its width are together no more than the padding of the box. How
  // wide it is drawn is tuned by eye in the app and is not held, only that it fits. Wider than the room it lies over the
  // number, and with no width of its own it ends where its picture does, which is tuned in the app as well. The two
  // numbers are changed together (a narrower grip in a narrower room, should a long number be cut off), and this needs
  // no change then. A length is read as the engine reads it: of a property written twice in a rule, the last counts.
  const px = (rule: string[], property: string) => Number(/^(\d+(?:\.\d+)?)px$/.exec(rule.filter(item => item.startsWith(`${property}:`)).pop()?.slice(property.length + 1) ?? '')?.[1]);
  const inset = px(grip, 'left'), wide = px(grip, 'width'), cleared = px(baseRule(sheet, room), 'padding-left');
  assert.ok(inset + wide <= cleared, `the grip does not end inside the room of the box: left ${inset} + width ${wide} against padding-left ${cleared} (px; NaN is a length not written in px)`);
  // The two states the component marks are among those rules: a drag tints the grip and darkens the name, and a field
  // that is off dims its three controls. Off, they take no press (the hook turns it away) and say so by the plain cursor.
  // How much they are dimmed is not held: that is tuned by eye, in the app.
  const dimmed = baseRule(sheet, off);
  has(dimmed, 'cursor:default');
  assert.ok(dimmed.some(item => /^opacity:0?\.\d+$/.test(item)), `the controls of a field that is off are not dimmed (${dimmed.join('; ')})`);
  // A drag changes how the grip and the name are painted, and nothing else. With a size, a weight or a padding of its
  // own in one of those two rules, the rows of the inspector would jump as a drag starts and again as it ends.
  for (const rule of [baseRule(sheet, '.bmap-num-grip:hover,.bmap-num.is-dragging .bmap-num-grip {'), baseRule(sheet, '.bmap-num.is-dragging .bmap-num-label {')])
    for (const item of rule) assert.match(item, /^(?:color|background(?:-color)?|border-color):/, `a drag changes more than a colour: ${item}`);
  // The sums of a slide are in a module that Node runs as it is: no three.js, no DOM.
  assert.doesNotMatch(pure, /from\s+['"]three/, 'mapNumberField.ts imports three.js');
  assert.doesNotMatch(pure, /\b(?:document|window)\.\w/, 'mapNumberField.ts touches the DOM');
});

test('anchor 64: the lens of the side view is a handle only while its camera can be edited, for a pointer alone, on a scale held for the drag', () => {
  // The side view is read as this anchor runs: without its file this anchor fails, not every anchor of this file. No test
  // of Node reaches a React component, so its lines are held by their letters. `lines` are they, without their indent.
  const part = read('BackgroundMapPlanSide.tsx'), lines = part.split('\n').map(line => line.trim()).filter(Boolean);
  /** Each is a line of its own, as written: nothing stands in front of one, and none is the head of a longer line. */
  const own = (...texts: string[]) => { for (const text of texts) assert.ok(lines.includes(text), `not a line of its own: ${text}`); };
  // When the lens is a handle: while the map can be edited right now, and the camera is not locked. Asked of the lock
  // alone, the lens would be dragged in view mode and while a save runs; asked of the right to edit alone, a locked
  // camera would be lifted. The pointer is the one hook's (anchor 62), and it is off whenever the lens is no handle.
  const handle = 'const draggable = canEdit && !camera.locked', pointer = 'useMapScrubPointer(scrub, !draggable)';
  own(`${handle}, box = PLAN_SIDE_VIEW;`, `const press = ${pointer};`);
  // The scale. The picture is drawn on the scale of the map as it is, and while a drag of the lens runs, on the scale
  // that drag started on. Fitted to the map at every step instead (`planSideView(map, camera)`), the picture would be
  // drawn anew as the lens leaves its range, and the lens would run away from the pointer. And a held scale counts only
  // while its drag still runs: asked of `frozen.current` alone, the darker halo and the held scale would stay behind an
  // Escape until the pointer moves or is let go. It is held in a ref and not in state (gate S): the first step of a
  // drag is drawn at once, a state set in the same pointer event arrives one commit later, and for that one frame the
  // room and the floor line were drawn on a scale fitted anew.
  const live = 'const live = frozen.current && scrub.alive() ? frozen.current : null;', drawn = 'const scale = live ?? planSideScale(map, camera), side = planSideView(map, camera, scale);';
  own(live, drawn);
  // The drag. It is the height of the camera, it runs up and down, and it starts past the slop: a press alone, or a move
  // sideways, changes nothing. The scale is taken as the drag starts, from the map the editor hands over and never from
  // the map of this render: the field that was being typed in is committed as the drag takes the focus away, and that
  // may have been a height. It is kept for the sums and given to the picture as well: without `frozen.current = held;` the
  // sums would run on the held scale and the picture on a fitted one. A place on screen becomes a place in the picture
  // through the matrix of the SVG: counted in screen pixels (`clientY - rect.top`), the lens would not keep to the
  // pointer (in a small picture it falls behind, the more the smaller the picture is), while the height still came in
  // steps of ten. And the lens keeps the offset it has where the drag starts, which is the press moved by the slop:
  // with none (`grab: 0`) it would jump to the pointer, and measured from the press itself the first value would skip
  // two or three steps. What the pointer then stands at is a height in the pure module (planSideDragLevel, which the S
  // tests run). And however the drag ends, the scale is let go: still held, it would be the scale of the picture again,
  // under the darker halo, during any gesture of the document that runs later (a slide of the height field, a handle
  // dragged in 3D).
  const drive = "field: 'elevation', axis: 'y', immediate: false", taken = 'planSideScale(origin.map,', kept = 'frozen.current = held; redraw(turn => turn + 1);';
  const toY = 'const toY = (clientY: number) => inverse ? new DOMPoint(0, clientY).matrixTransform(inverse).y : Number.NaN;';
  const grab = 'grab: planSideY(held, origin.start) - toY(from.clientY)', level = 'planSideDragLevel(drag.scale, drag.toY(at.clientY) + drag.grab, drag.start)';
  const closed = 'close: () => { frozen.current = null; redraw(turn => turn + 1); }';
  const held = `const node = origin.map.nodes.find(item => item.id === camera.id), held = ${taken} node?.type === 'camera' ? node : camera);`;
  const opened = `return { scale: held, start: origin.start, toY, ${grab} };`, lifted = `read: (drag, at) => ${level},`;
  own(`${drive},`, held, toY, kept, opened, lifted, `${closed},`);
  // What the handle adds is drawn only while the lens is one: the halo, the small up-down mark and the area that takes
  // the press each stand once, on a line of their own that opens with that condition. Drawn without it, a camera that
  // cannot be edited would be shown a handle that does nothing: a halo, the cursor of a drag, a tooltip.
  const ring = '{draggable && <circle className="bmap-plan-side-ring" cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot} />}';
  const marks = '{draggable && <path className="bmap-plan-side-marks" d={`M ${x0 - 3} ${fixed(y - 4)} L ${x0} ${fixed(y - 8)} L ${x0 + 3} ${fixed(y - 4)} M ${x0 - 3} ${fixed(y + 4)} L ${x0} ${fixed(y + 8)} L ${x0 + 3} ${fixed(y + 4)}`} />}';
  const area = '{draggable && <circle className="bmap-plan-side-grab" onPointerDown={lift} cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot}><title>위아래로 끌어 카메라 높이 바꾸기 · 끄는 도중 Esc는 취소</title></circle>}';
  for (const added of ['bmap-plan-side-ring', 'bmap-plan-side-marks', 'bmap-plan-side-grab']) {
    const found = lines.filter(line => line.includes(added));
    assert.equal(found.length, 1, `one line draws ${added}`);
    assert.ok(found[0].startsWith('{draggable && '), `drawn for a camera that cannot be edited: ${found[0]}`);
  }
  // The caption tells those who can drag the lens that they can, in a span of its own: the stylesheet hides that span
  // where the picture is too narrow for the longer words (below). Written as one text, the caption would always be cut
  // off there. To everyone else it reads as it always did.
  const caption = '<figcaption>옆에서 본 방향{draggable && <span className="bmap-plan-side-tip"> · 점을 끌어 높이 조절</span>}</figcaption>';
  own(caption);
  // The handle is for the pointer alone: no stop for Tab, no slider, no key. The keyboard has the height field of the
  // inspector, which holds the same number: a second stop would be a second rule for joining the undo steps of one
  // value, and an SVG element that takes the focus is drawn a ring by the engine when it is pressed. The SVG stays the
  // picture it was, with its words for a reader. No line marks a ceiling: the height is said by the readout. And the
  // colour of the camera is not told here again: the readout that holds the picture carries it (anchor 45).
  for (const none of ['bmap-plan-side-ceiling', 'tabIndex', 'role="slider"', 'onKeyDown', 'data-camera-color=']) assert.ok(!part.includes(none), `still there: ${none}`);
  assert.ok(part.includes('role="img"'), 'the side view is no picture for a reader');
  // And the file holds nothing else: it is the lines above and what joins them, in this order. What joins them, and what
  // goes wrong without it. The sums and the box of the picture come from the pure module and the pointer from the one
  // hook, by these imports: a function of the same name written in this file would pass every line above, and no test
  // would reach it. The two small helpers are those of the companion plan, a second copy of each: the picture is
  // written with the rounding it always had. The component is a plain function: wrapped in `memo` it would not be drawn
  // again as the editor ends a drag by itself, and `live` would not be asked again. The matrix is read once, as the
  // drag starts, off the SVG, which is found by its ref: without the ref no place on screen becomes a place in the
  // picture, and a drag changes nothing. How far left of the lens the up-down mark stands
  // is tuned by eye in the app, so that number is read as any number. The root carries the two states the stylesheet
  // draws: a lens that can be dragged, and one that is being dragged, asked of the held scale that still counts. Then
  // the figure as it always was, element for element and in its order: for a camera that cannot be edited (view mode,
  // a locked camera, a save running) the lines that open with `draggable` draw nothing, and what is left is the room,
  // the floor line and its six hatches, the pole, the level line, the line of sight with its head, and the lens. The
  // halo and the mark come before the lens, which is drawn over the inner half of the halo. The area that takes the
  // press comes last, over everything, and it is the one element with a handler: under the lens, a press on the very
  // centre of the lens would land on the lens and start nothing.
  assert.deepEqual(lines.map(line => line.replace(/^(const x0 = box\.cameraX - )[\d.]+(, y = side\.camera\.y;)$/, '$1n$2')), [
    "import { useRef, useState } from 'react';", "import type { JSX, PointerEvent as ReactPointerEvent } from 'react';", "import type { MapFieldScrub } from './mapCanvas';",
    "import type { BackgroundCamera, BackgroundMap, BackgroundPoint } from './types';",
    "import { PLAN_SIDE_VIEW, planSideDragLevel, planSideScale, planSideView, planSideY } from './mapPlanPreview';", "import type { PlanSideScale } from './mapPlanPreview';",
    "import { useMapScrubPointer } from './useMapScrubPointer';",
    'const fixed = (value: number) => Math.round(value * 100) / 100 + 0;', "const pointList = (points: BackgroundPoint[]) => points.map(point => `${fixed(point.x)},${fixed(point.y)}`).join(' ');",
    'export function BackgroundMapPlanSide({ map, camera, canEdit, scrub, label }: {', 'map: BackgroundMap; camera: BackgroundCamera;', 'canEdit: boolean; scrub: MapFieldScrub;', 'label: string }): JSX.Element {',
    `${handle}, box = PLAN_SIDE_VIEW;`, 'const frozen = useRef<PlanSideScale | null>(null), [, redraw] = useState(0);', 'const svgRef = useRef<SVGSVGElement>(null);', `const press = ${pointer};`, live, drawn,
    'const lift = (event: ReactPointerEvent<SVGCircleElement>) => press(event, {', `${drive},`, 'open: (origin, from) => {', held, 'const inverse = svgRef.current?.getScreenCTM()?.inverse();', toY, kept, opened, '},',
    lifted, `${closed},`, '});', 'const x0 = box.cameraX - n, y = side.camera.y;',
    "return <figure className={`bmap-plan-side${draggable ? ' is-draggable' : ''}${live ? ' is-lifting' : ''}`}>",
    '<svg ref={svgRef} viewBox={`0 0 ${box.width} ${box.height}`} role="img" aria-label={label}>',
    '{side.room && <rect className="bmap-plan-side-room" x={box.left} y={fixed(side.room.top)} width={box.right - box.left} height={fixed(Math.max(1, side.room.bottom - side.room.top))} />}',
    '<line className="bmap-plan-side-floor" x1={box.left} x2={box.right} y1={fixed(side.floorY)} y2={fixed(side.floorY)} />',
    '{[0, 1, 2, 3, 4, 5].map(index => <line key={index} className="bmap-plan-side-hatch" x1={box.left + 12 + index * 20} x2={box.left + 6 + index * 20} y1={fixed(side.floorY)} y2={fixed(side.floorY + 6)} />)}',
    '<line className="bmap-plan-side-pole" x1={side.camera.x} x2={side.camera.x} y1={fixed(side.floorY)} y2={fixed(side.camera.y)} />',
    '<line className="bmap-plan-side-level" x1={side.camera.x} x2={side.camera.x + box.arrow + box.head} y1={fixed(side.camera.y)} y2={fixed(side.camera.y)} />',
    '<line className="bmap-plan-sight" x1={side.camera.x} y1={fixed(side.camera.y)} x2={fixed(side.tip.x)} y2={fixed(side.tip.y)} />',
    '<polygon className="bmap-plan-sight-head" points={pointList(side.head)} />', ring, marks,
    '<circle className="bmap-plan-dot" cx={side.camera.x} cy={fixed(side.camera.y)} r={box.dot} />', area, '</svg>', caption, '</figure>;', '}']);
  // And in what the side view draws, `read` took nothing away: from its `return` to the end the file is the same
  // letters with and without what `read` drops (anchor 63 says why that is asked).
  const rawSide = readFileSync(new URL('BackgroundMapPlanSide.tsx', directory), 'utf8').replace(/\r\n/g, '\n'), figure = 'return <figure className=';
  assert.equal(part.slice(positions(part, figure)[0]), rawSide.slice(positions(rawSide, figure)[0]), 'a comment mark inside what the side view draws: there it is text on screen, and the anchor does not see its line');
  // The hand-over. The editor gives the companion plan the right to edit as it is right now and its one scrub object,
  // behind the three attributes it always gave (anchor 23 reads those): without the scrub object the lens has nothing
  // to be dragged through. The plan takes the two and hands them to the readout of the picked camera, and that hands
  // them to the side view, as they came: handed a right to edit made up on the way, the side view of a camera in view
  // mode would show a handle. The readout is keyed by its camera: as another camera is picked, a scale still held and
  // a pointer still pressed go with the readout of the old one. And the contract of the plan names the two. Behind them
  // the plan is handed what the eye of the object list hides (anchor 67 reads what it does with it).
  assert.ok(editor.includes('<BackgroundMapPlanPreview map={current} selectedId={singleId} onSelect={selectNode} canEdit={canEdit} scrub={fieldScrub} hiddenIds={hiddenIds} />'), 'the companion plan is not given the right to edit and the scrub object');
  assert.equal(count(editor, /<BackgroundMapPlanPreview\b/g), 1, 'the companion plan is drawn once');
  const preview = read('BackgroundMapPlanPreview.tsx'), keyed = '<CameraReadout key={selected.id} ';
  for (const text of ['export function BackgroundMapPlanPreview({ map, selectedId, onSelect, canEdit, scrub, hiddenIds }: MapPlanPreviewProps) {', `${keyed}map={map} camera={selected} canEdit={canEdit} scrub={scrub} />`,
    'function CameraReadout({ map, camera, canEdit, scrub }: { map: BackgroundMap; camera: BackgroundCamera; canEdit: boolean; scrub: MapFieldScrub }) {',
    '<BackgroundMapPlanSide map={map} camera={camera} canEdit={canEdit} scrub={scrub} label={`옆에서 본 방향: ${pitchText}, ${heightText}`} />']) assert.ok(preview.includes(text), `not found: ${text}`);
  assert.equal(count(preview, /<CameraReadout\b/g), 1, 'the readout of a camera is drawn in one place');
  assert.equal(count(preview, /<BackgroundMapPlanSide\b/g), 1, 'the side view is drawn in one place');
  // In the file of the plan nothing on that way is wrapped in `memo`: not the plan, not the readout of a camera, not the
  // side view where it is brought in (in its own file it is a plain function, by the list above). As the editor ends a
  // drag by itself before a value has changed (Escape), what is handed down that way is what was handed down before:
  // behind a wrapper the side view would not be drawn again, `live` would not be asked again, and the darker halo and
  // the coloured height would stay until the pointer moves or is let go. So every place the word stands in that file
  // is read: its import, and the two wrappers the plan always had, around the shapes and the cameras it draws. A
  // wrapper under any other spelling is one place more: a function handed over by its name, an arrow function, a type
  // argument in front of the parenthesis, the call through the namespace of React.
  const wrappers = preview.match(/\bmemo\b(?:\(function \w+)?/g) ?? [];
  assert.deepEqual(wrappers, ['memo', 'memo(function PlanShape', 'memo(function PlanCamera'], `the plan, the readout of a camera or the side view is wrapped in memo, or a wrapper of the plan is gone: ${wrappers.join(' | ')}`);
  assert.ok(read('mapCanvas.ts').includes("export type MapPlanPreviewProps = Pick<MapCanvasProps, 'map' | 'selectedId' | 'canEdit' | 'onSelect'> & { scrub: MapFieldScrub; hiddenIds?: ReadonlySet<string> };"), 'the contract of the companion plan');
  // The plan itself has no code for the drag: a press is followed by the hook, on the window. The listeners the plan
  // has are those of its picks, and anchors 34 and 39 find them by their place in that file. Nor does it draw a side
  // view of its own any more: left there, a second picture would stand beside the one with the handle.
  for (const none of ['setPointerCapture', "addEventListener('pointermove'", 'bmap-plan-side', 'planSideView(']) assert.ok(!preview.includes(none), `still in the companion plan: ${none}`);
  // The stylesheet of the companion plan, line by line and as written: a rule is one line there, and the comments stay.
  // The handle is drawn by these seven rules and by no other, each one line, in this order: two inside the blocks of
  // the short and wide plan, then five base rules. They are looked for in what is left of the sheet without its
  // comments: a rule written behind a comment, or under another selector, could undo any line read below.
  const plan = readFileSync(new URL('backgrounds-map-plan.css', directory), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const has = (rule: string[], ...parts: string[]) => { for (const item of parts) assert.ok(rule.includes(item), `not declared: ${item} (${rule.join('; ')})`); };
  const bare = plan.join('\n').replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, '')).split('\n');
  const rules = bare.map(line => line.trim()).filter(line => /bmap-plan-side-(?:grab|ring|marks|tip)|is-lifting/.test(line));
  assert.deepEqual(rules.map(line => line.slice(0, line.indexOf('{') + 1)), ['.bmap-plan-side-tip {', '.bmap-plan-side-marks {', '.bmap-plan-side-grab {', '.bmap-plan-side-ring {', '.bmap-plan-side-marks {',
    '.bmap-plan-side.is-lifting .bmap-plan-side-ring {', '.bmap-plan-readout:has(.bmap-plan-side.is-lifting) .is-elevation strong {']);
  for (const line of rules) assert.equal(count(line, /\{/g), 1, `more than one rule on a line: ${line}`);
  // Nothing of the handle moves by itself: a drag is the hand moving it. Nothing of it blurs what is behind it. And no
  // colour is written out: the handle is painted from the camera variables of this plan, or not at all, so the handle
  // of a camera with a colour of its own is in that colour (the last rule of the sheet sets the variables from it).
  for (const line of rules) {
    assert.doesNotMatch(line, /#|transition|animation|backdrop-filter/);
    for (const paint of declarations(line).filter(item => /^(?:fill|stroke|color):/.test(item)))
      assert.match(paint, /:(?:none|transparent|var\(--bmap-plan-cam(?:-line|-edge|-soft)?\))$/, `not painted from a camera variable of the plan: ${paint}`);
  }
  // The area that takes the press is a circle the size of the lens that paints nothing (it lies over the lens), with a
  // stroke 24 pixels wide that takes a press like the rest of it: at least 28 pixels across, however small the picture
  // is drawn. Without that width it is the lens alone, 4 pixels across in the smallest picture. Over it the pointer
  // says which way a drag goes, and a touch or a pen that starts there scrolls nothing. The halo is a stroke as well,
  // 6 pixels wide and unfilled: the lens covers its inner half. Both are widths on screen because every shape of this
  // plan keeps its strokes unscaled, and no rule of the handle undoes that: drawn in the units of the picture, the halo
  // could not be told from the edge of the lens in the smallest picture, and the area would shrink with the picture.
  has(baseRule(plan, '.bmap-plan-side-grab {'), 'fill:transparent', 'stroke:transparent', 'stroke-width:24px', 'pointer-events:all', 'cursor:ns-resize', 'touch-action:none');
  // The engine reads touch-action from boxes only: on a shape inside a picture it is dropped, and the lens inherits the
  // scrolling of the page, so a touch or a pen that starts there turns into a scroll after a few pixels and the drag is
  // cancelled. While the lens can be dragged the picture as a whole takes it; in view mode the picture is as before.
  has(baseRule(plan, '.bmap-plan-side.is-draggable>svg {'), 'touch-action:none');
  has(baseRule(plan, '.bmap-plan-side-ring {'), 'fill:none', 'stroke-width:6px');
  has(baseRule(plan, '.bmap-plan-preview :is(rect,polygon,circle,line,path) {'), 'vector-effect:non-scaling-stroke');
  for (const line of rules) assert.doesNotMatch(line, /vector-effect/);
  // Nor does any other rule of this sheet move something by itself. The one motion the companion plan has is the turn
  // of the arrow on its fold button, with its twin for reduced motion. A motion under another selector (one that makes
  // the lens of a camera that can be dragged pulse, say) would be read by none of the lines above.
  assert.deepEqual(bare.map(line => line.trim()).filter(line => /transition|animation/.test(line)).map(line => line.slice(0, line.indexOf('{') + 1)), ['.bmap-plan-toggle>svg {', '.bmap-plan-toggle>svg {'],
    'something of the companion plan moves by itself');
  // While the lens is lifted its halo is stronger, and the height in the readout takes the colour of the camera: paint,
  // and nothing that has a size. A larger or a heavier number there would make the readout jump as a drag starts.
  for (const lifted of ['.bmap-plan-side.is-lifting .bmap-plan-side-ring {', '.bmap-plan-readout:has(.bmap-plan-side.is-lifting) .is-elevation strong {'])
    for (const item of baseRule(plan, lifted)) assert.match(item, /^(?:color|stroke-opacity):/, `a drag changes more than a colour: ${item}`);
  // The up-down mark is two open lines, and unfilled like the halo. What a shape is filled with has to be written: the
  // check of the colours above reads only what a rule declares, and a shape with no fill declared is filled in black
  // by the engine, the colour of no camera. Each of the two lines would be closed into a small black wedge.
  has(baseRule(plan, '.bmap-plan-side-marks {'), 'fill:none');
  // Where the plan is short and wide the picture stands beside the text and is narrow: the words added to the caption
  // are hidden there, or the caption would always be cut off. Where that plan is lower still the caption is hidden
  // whole and the picture is at its smallest: the up-down mark is not drawn there, where it would run into the halo.
  const wide = '@container bmap-plan (min-aspect-ratio: 3/2) and (min-width: 300px) {', low = '@container bmap-plan (min-aspect-ratio: 3/2) and (min-width: 300px) and (max-height: 159px) {';
  assert.ok(mediaBlock(plan, wide).includes('.bmap-plan-side-tip { display:none; }'), 'the words added to the caption are shown beside the text');
  assert.ok(mediaBlock(plan, low).includes('.bmap-plan-side-marks { display:none; }'), 'the up-down mark is drawn in the smallest picture');
  // The rule that gives a camera with a colour of its own its four variables is still the last rule of the sheet.
  assert.ok(plan.filter(line => line.trim()).pop()?.startsWith('.bmap-plan-preview [data-camera-color] {'), 'the last rule of the sheet is another one');
  // The picture is drawn on a scale handed in, and without one on the scale of the map: that is the pure module's, and
  // the S tests run it. With the third argument dropped there, the line that hands the held scale over would mean nothing.
  assert.ok(read('mapPlanPreview.ts').includes('scale: PlanSideScale = planSideScale(map, camera)'), 'planSideView takes no scale');
});

test('anchor 65: an open dialog of the editor is one line, and three places read it', () => {
  // That a dialog of the editor is open is said in one line, of all five: the question (discard, delete), the three
  // forms (a new map, a link, the settings) and the delete dialog of a map. Each asks about a map it holds: nothing may
  // change the maps under it, and what the editor has to say is shown inside it. One of the five left out of that line
  // is a dialog under which the drafts follow the library and the message is drawn a second time, behind it. Without
  // `mapDelete` that dialog is the delete dialog of a map.
  const made = 'const dialogOpen = !!(confirmation || createForm || linkForm || settingsForm || mapDelete);';
  const lines = editor.split('\n').map(line => line.trim());
  assert.ok(lines.includes(made), `not a line of its own: ${made}`);
  // The word stands five times, on five lines: the one that makes it and, in this order, the three places that read it.
  // The drafts follow the library only while no dialog is open, and the effect that asks them to waits for the value:
  // it asks again as the dialog closes, and without the value there a draft would stay behind the library after the
  // dialog is closed (anchor 56 holds both lines in their place). Ctrl+S is left to an open dialog (anchor 53). And the
  // editor's own message, the block above the band, is not drawn while a dialog is open: the sentence is inside the
  // dialog then. A sixth place would be a reader no anchor knows, and with a place less one of the three asks something else.
  const guard = 'if (disabled || doc.isGestureActive() || dialogOpen) return;', waited = 'useEffect(() => { followSaved(); }, [followSaved, snapshot.maps, disabled, gestureActive, dialogOpen]);';
  const key = 'if (dialogOpen || document.querySelector(openDialogs)) return;', band = '{error && !dialogOpen && <div className="bg-error" role="alert" ref={errorRef}>';
  assert.equal(count(editor, /\bdialogOpen\b/g), 5, 'made, the guard of the follow and what its effect waits for, Ctrl+S, the message');
  assert.deepEqual(lines.filter(line => /\bdialogOpen\b/.test(line)), [made, guard, waited, key, `${band}{error}</div>}`]);
  // The dialogs are listed in that one line and nowhere else: in neither order the three places used to write four of
  // them in, nor denied one by one as the message did. A place with a list of its own would not know the next dialog
  // the editor is given.
  assert.equal(count(editor, /confirmation \|\| createForm/g), 1, 'the dialogs are listed once, where dialogOpen is made');
  for (const old of ['!confirmation && !createForm', 'createForm || linkForm || settingsForm || confirmation']) assert.ok(!editor.includes(old), `still there: ${old}`);
});

test('anchor 66: the delete dialog acts on the map it was opened for, sends the plan in its order, and lets a draft go only once its own map is gone', () => {
  // The editor first. What it does with the delete dialog of a map is four functions, each read from its own first line
  // up to the next (the last up to the function behind them): they stand together, in this order, in no handler another
  // anchor cuts out. `lined` is a piece as its lines, without their indent, and `all` is the editor so. A value of the
  // render is looked for by its name alone: `current`, never the `.current` of a ref, and no part of a longer name.
  const drop = handler.dropGoneDrafts(), open = handler.openMapDelete(), run = handler.runMapDelete(), close = handler.closeMapDelete();
  const lined = (source: string) => source.split('\n').map(line => line.trim()).filter(Boolean), all = lined(editor);
  // 도면 삭제 of the settings dialog opens it, for the map those settings were opened for: the dialog holds that id, and
  // every plan, command and word comes of it. Held from the map on show (`current.id`) it could be another map: while
  // viewing, the map on show changes under the open settings as soon as it is deleted elsewhere, to the first map of
  // the list and without a word. Nothing for a read-only account, and nothing while a save or a run is in progress. The
  // dialog opens on 하위 도면은 남기기, every time: the choice that deletes less. And it comes up where the settings dialog
  // was, so for the length of a double-click no press reaches the page: the second click of a double-click on 도면 삭제
  // would land on a choice or on a button of it.
  for (const text of ['if (!settingsForm || disabled || !snapshot.canManage) return;', 'mapId: settingsForm.id', "mode: 'keep-children'", 'swallowSecondClick();'])
    assert.ok(open.includes(text), `not in openMapDelete: ${text}`);
  assert.doesNotMatch(open, /(?<![.\w])(?:current)\b/, 'the delete dialog is opened for the map on show');
  // And the function holds nothing else. The name and the place of that map as the editor has them now, for the sentence
  // of a map that is gone and for the way back from it; where the map is gone already, the name the settings were opened
  // with. The list of the maps this dialog has set out to delete starts empty: left over from the dialog before, it
  // would let go of the draft of a map that one aimed at and that has gone since. The settings dialog goes, with what
  // was typed in it, and so does the message of the editor: under this dialog it would be drawn inside it.
  assert.deepEqual(lined(open), ['function openMapDelete() {', 'if (!settingsForm || disabled || !snapshot.canManage) return;', 'const map = maps.find(item => item.id === settingsForm.id);',
    'deleteAimed.current = [];',
    "setMapDelete({ mapId: settingsForm.id, name: map?.name ?? settingsForm.name, parentId: map?.parentId ?? null, mode: 'keep-children', progress: null, stopped: null });",
    "setSettingsForm(null); setError('');", 'swallowSecondClick();', '}']);
  // A delete that went through without an answer never reaches the line that lets its draft go, and the draft of a map
  // the library no longer has would stay in the tree, as a map that is being edited and can never be saved. So the
  // dialog lets go of the drafts of the maps it set out to delete, once the library no longer has them: of those alone,
  // and of none the library still has. That one line and no other. Without its condition, going back after a run that
  // stopped would drop the unsaved edits of the maps it aimed at that are still there; turned round, it would drop
  // those alone, and keep the drafts of the ones that are gone.
  assert.deepEqual(lined(drop), ['function dropGoneDrafts() { for (const id of deleteAimed.current) if (!snapshot.maps.some(map => map.id === id)) doc.discard(id); }']);
  // The run, in this order. Nothing without the dialog, while the editor is busy (the snapshot then shows maps that are
  // not confirmed), or while a run is in progress: asked of the ref, because a second press can come before `busy` is
  // drawn. The drafts of maps deleted without an answer go first. Then the plan: for the map the dialog holds, never the
  // map on show, and from the drafts as the store has them at this moment. A map that is gone or a plan that is refused
  // ends it there, and the dialog, drawn from the same plan, says why. Every map the plan deletes is noted as aimed at,
  // over all presses. Only then is the ref set: set before the checks that return early, one refused press would leave it set
  // for good. The save that comes first goes the way every save of maps goes, which puts the drafts of the maps it wrote
  // back: sent by `execute` they would stay on the revision before it, and their next save would be refused. Each delete
  // is sent by itself, and the draft of its map goes on that very line, once that map is gone: let go all at once before
  // the loop, a run that stops would have taken the unsaved edits of maps that are still there. Then the screen goes to
  // where the map hung. A run that stops says why in the words of the dialog (by `message` the wrapper Electron puts
  // round what the main process throws would be shown), keeps the plan of that press for what the dialog says was done,
  // and for the length of a double-click no press reaches the page: the dialog arms itself again under the pointer, and a
  // click still on its way would send a plan nobody has read. That only while the editor is up (its root is there): a link
  // from outside or another window can change the screen during a run, which takes the editor down, and the presses of
  // that screen are none of the dialog's. However it ends, the ref and `busy` are cleared.
  inOrder(run, 'if (!mapDelete || disabled || deleting.current) return;', 'dropGoneDrafts();', 'planMapDelete(snapshot, settle().drafts, mapDelete.mapId, mapDelete.mode)',
    'if (!plan.target || plan.refusal) return;', 'deleteAimed.current = [...new Set([...deleteAimed.current, ...plan.removed])];', 'deleting.current = true; setBusy(true);',
    "if (step.type === 'save-maps') await persistMaps(step);", 'else { await execute(step); doc.discard(step.id); done += 1; }', 'setCurrentId(parentId);',
    'setError(mapDeleteCauseText(cause));', 'stopped: plan', 'swallowSecondClick();', 'finally { deleting.current = false; setBusy(false); }');
  assert.ok(!run.includes('message(cause)'), 'why a run stopped is said with the wrapper of Electron round it');
  assert.doesNotMatch(run, /(?<![.\w])(?:current)\b/, 'the run reads the map on show');
  // After the first wait this handler still holds the render that started the run: its library, its map on show, its
  // draft and its maps are those from before the commands. So the steps, the place the screen goes to and the branch
  // that is unfolded there are values settled before that wait, and the state of the dialog is written by functions of
  // the state before. Read after it, they would pass for the library and the screen as the commands left them, which
  // this handler never sees.
  const waited = run.slice(positions(run, 'await ')[0]);
  assert.doesNotMatch(waited, /(?<![.\w])(?:snapshot|current|draft|maps)\b/, 'the run reads its render after the first wait');
  // A draft is let go in that one line, the ref is set in that one place, and the lost drafts are asked for once.
  assert.equal(count(run, /doc\.discard\(/g), 1, 'the draft of a map goes in one place, behind its own delete');
  assert.equal(count(run, /deleting\.current = true/g), 1, 'the ref is set once, behind the checks that return early');
  assert.equal(count(run, /dropGoneDrafts\(\);/g), 1);
  // The ref starts clear, and the list of the maps aimed at starts empty: with the ref set from the start no run would
  // ever begin. Both are refs of the editor, read and written at once: as state they would be a render behind.
  for (const made of ['const deleting = useRef(false);', 'const deleteAimed = useRef<string[]>([]);']) assert.ok(all.includes(made), `not a line of its own: ${made}`);
  // And the run holds nothing else: the lines above and what joins them. What is counted for the button is maps
  // deleted, of the number the button named: the save that comes first counts for none. The message of the press before
  // is cleared, and with it what the dialog said that press had done. At its end the screen is left as on a move to
  // another map (the points being drawn, the tool, the palette, the focus request), and the branch down to where the
  // map hung is unfolded, so the maps that moved up can be seen.
  assert.deepEqual(lined(run), ['async function runMapDelete() {', 'if (!mapDelete || disabled || deleting.current) return;', 'dropGoneDrafts();',
    'const plan = planMapDelete(snapshot, settle().drafts, mapDelete.mapId, mapDelete.mode);', 'if (!plan.target || plan.refusal) return;',
    'const steps = plan.steps, total = plan.removed.length, parentId = plan.target.parentId, opened = parentId ? mapPath(maps, parentId).map(map => map.id) : [];',
    'deleteAimed.current = [...new Set([...deleteAimed.current, ...plan.removed])];', "deleting.current = true; setBusy(true); setError('');",
    'setMapDelete(previous => previous && { ...previous, progress: { done: 0, total }, stopped: null });', 'let done = 0;', 'try {', 'for (const step of steps) {',
    "if (step.type === 'save-maps') await persistMaps(step);", 'else { await execute(step); doc.discard(step.id); done += 1; }',
    'setMapDelete(previous => previous && { ...previous, progress: { done, total } });', '}',
    "setCurrentId(parentId); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null);",
    'setCollapsed(previous => new Set([...previous].filter(id => !opened.includes(id))));', 'setMapDelete(null);', '} catch (cause) {', 'setError(mapDeleteCauseText(cause));',
    'setMapDelete(previous => previous && { ...previous, progress: null, stopped: plan });', 'if (rootRef.current) swallowSecondClick();', '} finally { deleting.current = false; setBusy(false); }', '}']);
  // 돌아가기, Esc, the close button and 닫기. Not while a run is in progress: the editor is busy then. The drafts of maps
  // deleted without an answer go. The draft of the map the dialog holds goes, and the screen moves to where that map
  // hung, only when the library no longer has that map (deleted here without an answer, or elsewhere): outside that
  // branch, going back would drop the unsaved edits of a map that is still there without a word, and leave it for the
  // map above. Nothing is sent as the dialog closes, and nothing of it is read from the map on show.
  inOrder(close, 'if (!mapDelete || disabled) return;', 'dropGoneDrafts();');
  const gone = block(close, 'if (!snapshot.maps.some(map => map.id === mapDelete.mapId)) {');
  for (const text of ['doc.discard(mapDelete.mapId);', 'setCurrentId(mapDelete.parentId);']) assert.ok(gone.includes(text), `not in the branch of a map that is gone: ${text}`);
  assert.equal(count(close, /doc\.discard\(/g), 1, 'a draft is let go as the dialog closes, outside the branch of a map that is gone');
  assert.equal(count(close, /setCurrentId\(/g), 1, 'the screen moves as the dialog closes, outside the branch of a map that is gone');
  assert.doesNotMatch(close, /(?<![.\w])(?:current)\b/, 'the close reads the map on show');
  assert.ok(!close.includes('execute('), 'the close sends a command');
  assert.deepEqual(lined(close), ['function closeMapDelete() {', 'if (!mapDelete || disabled) return;', 'dropGoneDrafts();', 'if (!snapshot.maps.some(map => map.id === mapDelete.mapId)) {',
    'doc.discard(mapDelete.mapId);', "setCurrentId(mapDelete.parentId); setPolygon([]); setTool('select'); setSymbolPaletteOpen(false); setFocusRequest(null);", '}',
    "setMapDelete(null); setError('');", '}']);
  // The old way is gone from the editor: the question that asked about the map on show, its title, and the sentence
  // that told to take the links off first. Nothing is sent from that question any more (it deletes placements and ends
  // edit mode), and the editor writes no delete of its own: a command goes out in two places, the function every save
  // of maps goes through and the line of the run, and what is deleted is what the plan says.
  for (const old of ['delete-map', '먼저 해제해 주세요', '도면을 삭제할까요']) assert.ok(!editor.includes(old), `still there: ${old}`);
  assert.doesNotMatch(handler.confirmAction(), /\bexecute\(|\bawait\b/, 'the question of the editor sends a command');
  assert.equal(count(editor, /\bexecute\(/g), 2, 'every save of maps, and the deletes of a plan');
  assert.ok(!editor.includes("type: 'delete'"), 'the editor writes a delete of its own');
  // The dialog is drawn while the editor holds one, from the plan of the map it holds: by these three lines, once, with
  // nothing in front of them. Hung on the map on show as well (`current &&`), there would be no dialog to say that the
  // map is gone once the last map of the library is. And they stand where the editor draws its dialogs, right behind the
  // settings dialog and before the question: inside what is drawn only for a map on show, the same would be lost.
  // What it is given: the name it was opened with, the plan, the choice and the run as the editor holds them, what a run
  // that stopped has done, read from the library as it is now, the message of the editor, and what it hands back: the
  // choice, the close, and the press that deletes.
  const drawn = ['{mapDelete && deletePlan && <BackgroundMapDeleteDialog name={mapDelete.name} plan={deletePlan} mode={mapDelete.mode} progress={mapDelete.progress}',
    'stopped={mapDelete.stopped && mapDeleteStopText(mapDelete.stopped, snapshot)} error={error} disabled={disabled}',
    'onMode={mode => setMapDelete(previous => previous && { ...previous, mode })} onClose={closeMapDelete} onConfirm={() => void runMapDelete()} />}'];
  assert.ok(editor.includes('{mapDelete && deletePlan && <BackgroundMapDeleteDialog '), 'the delete dialog is not drawn, or hangs on something else');
  assert.equal(count(editor, /<BackgroundMapDeleteDialog\b/g), 1, 'the delete dialog is drawn once');
  const at = all.indexOf(drawn[0]);
  assert.ok(at > 0, `not a line of its own: ${drawn[0]}`);
  assert.deepEqual(all.slice(at - 1, at + drawn.length), ['</form></BackgroundModal>}', ...drawn]);
  assert.ok(all[at + drawn.length].startsWith('{confirmation && current && <BackgroundModal '), 'the delete dialog is not drawn right before the question of the editor');
  // And nothing is wrapped round those lines. The question ends its line as it always did, and the line behind it
  // closes the root of the editor: a wrapper that hangs the dialogs on the map on show (`{current && <>`, or the same
  // asked the other way round), opened in front of the settings dialog or of all five, has to close behind the
  // question, at the end of that line or on a line of its own.
  assert.ok(all[at + drawn.length].endsWith("{confirmation === 'discard' ? '버리고 끝내기' : '삭제'}</button></div></BackgroundModal>}"), 'something closes behind the question of the editor, on its line');
  assert.equal(all[at + drawn.length + 1], '</div>;', 'something is wrapped round the dialogs of the editor');
  const settings = piece(editor, '{settingsForm && <BackgroundModal title="도면 설정"', drawn[0]);
  assert.equal(count(settings, /<\/form><\/BackgroundModal>\}/g), 1, 'the delete dialog is not drawn right behind the settings dialog');
  // And among the dialogs the editor draws, `read` took nothing away: from the first of them to the end of the file
  // the letters are the same with and without what `read` drops. Between the tags of JSX a `//` is no comment: it is
  // text on screen, and an expression written behind it still runs (a run of the delete, say, at every drawing).
  const rawEditor = readFileSync(new URL('BackgroundMapEditor.tsx', directory), 'utf8').replace(/\r\n/g, '\n'), firstDialog = '{createForm && <BackgroundModal title=';
  assert.equal(editor.slice(positions(editor, firstDialog)[0]), rawEditor.slice(positions(rawEditor, firstDialog)[0]), 'a comment mark among the dialogs of the editor: there it is text on screen, and the anchor does not see its line');
  // The plan on show is made by the function the run makes its own with, for the same map and the same choice, from the
  // library and the drafts of the render: read anew after a run that stopped, it is what is left to do, and without a
  // target once the map is gone. It hangs on the library: without that the dialog would go on showing a map that is gone.
  assert.ok(all.includes('const deletePlan = useMemo(() => mapDelete ? planMapDelete(snapshot, drafts, mapDelete.mapId, mapDelete.mode) : null, [snapshot, drafts, mapDelete?.mapId, mapDelete?.mode]);'),
    'the plan the delete dialog is drawn from');
  assert.equal(count(editor, /\bplanMapDelete\(/g), 2, 'the plan on show and the plan of the press');
  // The button of the settings dialog is that function, the whole tag, and the dialog is given its map in that one
  // place. Each of the four is named where it is made and where it is handed over, and nowhere else: a second way in
  // would open the dialog for another map, and a second way to run would be a delete nobody pressed.
  assert.ok(settings.includes('<button type="button" className="bmap-text-button bmap-danger" disabled={disabled} onClick={openMapDelete}>도면 삭제</button>'), 'the button of the settings dialog does not open the delete dialog');
  assert.ok(editor.includes('onClick={openMapDelete}>도면 삭제</button>'));
  assert.equal(count(editor, />도면 삭제<\/button>/g), 1, 'one button reads: 도면 삭제');
  assert.equal(count(editor, /\bsetMapDelete\(\{/g), 1, 'the delete dialog is given its map in one place');
  for (const [name, times] of Object.entries({ openMapDelete: 2, runMapDelete: 2, closeMapDelete: 2, dropGoneDrafts: 3 }))
    assert.equal(count(editor, new RegExp(`\\b${name}\\b`, 'g')), times, `${name} is named in another place`);
  // And the state of the dialog is written in the places held above and in no other: the open, the four of the run,
  // the close, and the choice the dialog hands back. Closed by an effect of the editor's own (as the map on show
  // changes, say), it would go while a run is in progress, and what a run that stopped has to say could be read nowhere.
  assert.equal(count(editor, /\bsetMapDelete\(/g), 7, 'the open, the run (four), the close, the choice');
  // So are the two refs. Each is named on the line that makes it and in the lines of the functions held above, and in
  // no other place. The list of the maps aimed at: made, read as the lost drafts are let go, emptied as the dialog
  // opens, and read and written by the one line of the run that adds the maps of a press. Emptied in a place of its
  // own as well (a line of the render, or an effect that tidies up as the dialog changes), it is empty by the time it
  // is read, and the draft of a map deleted without an answer stays in the tree after all. The ref of a run: made,
  // asked by the guard of the run, set behind its checks, cleared as the run ends. Cleared in a place of its own as
  // well, it says that no run is in progress while one is: the guard is left with `busy`, and a second press can
  // come before that is drawn.
  assert.equal(count(editor, /\bdeleteAimed\b/g), 5, 'made, the lost drafts, the open, and twice in the line of the run that adds to it');
  assert.equal(count(editor, /\bdeleting\b/g), 4, 'made, the guard of the run, set, cleared');
  // The dialog, the plan and the two sentences come in by their imports. The plan and the sentences are the pure
  // module's, which the D tests run: one of the same name written in the editor would be reached by no test.
  for (const text of ["import { BackgroundMapDeleteDialog } from './BackgroundMapDeleteDialog';", "import { mapDeleteCauseText, mapDeleteStopText, planMapDelete } from './mapDelete';"])
    assert.ok(all.includes(text), `not imported: ${text}`);
  // The plan of a delete and the words the dialog says of it are a module of their own, read as this anchor runs: without
  // its file this anchor fails, not every anchor of this file. Node runs that module as it is, so what a plan holds and
  // what is said of it are tested by running them (the D tests). Held here, by its letters, is what those tests cannot
  // tell apart: whose definitions the module goes by.
  const plan = read('mapDelete.ts');
  // A draft has something unsaved by the one definition the edit band and 도면 저장 go by. The value of a draft that the
  // save would write is checked, before anything is sent, by the check the library itself runs on a map. And the wrapper
  // Electron puts round what the main process throws is taken off by the one function the app has for that. Each comes in
  // by its import and is called: a function of the same name written in this module would pass every D test today, and
  // part from the real one unseen.
  for (const text of ["import { mapDraftChanged } from './mapDocument.ts';", "import { validateBackgroundEntity } from './domain.ts';", "import { cleanIpcErrorMessage } from '../../utils/ipcErrorMessage.ts';",
    'mapDraftChanged(', "validateBackgroundEntity('map',", 'cleanIpcErrorMessage(']) assert.ok(plan.includes(text), `not in mapDelete.ts: ${text}`);
  // A map is deleted on the revision the library has for it, and on the one after it where the save that comes first
  // wrote that map: one expression, the revision plus one or plus nothing. (The revision the save itself expects is not
  // held here: its line begins with the same letters. D-9 runs it.)
  for (const text of ['map.revision + (', '? 1 : 0)']) assert.ok(plan.includes(text), `not in mapDelete.ts: ${text}`);
  assert.match(plan, /map\.revision \+ \(.+ \? 1 : 0\)/, 'the revision a delete expects is not written as the revision of the library, plus one for a map the save wrote');
  // And the module stays one that Node runs as it is: no three.js, no DOM.
  assert.doesNotMatch(plan, /from\s+['"]three/, 'mapDelete.ts imports three.js');
  assert.doesNotMatch(plan, /\b(?:document|window)\.\w/, 'mapDelete.ts touches the DOM');
  // The dialog itself, read as this anchor runs, as the module above is. No test of Node reaches a React component, so
  // its lines are held by their letters. `lines` are they, without their indent.
  const part = read('BackgroundMapDeleteDialog.tsx'), lines = part.split('\n').map(line => line.trim()).filter(Boolean);
  /** Each is a line of its own, as written: nothing stands in front of one, and none is the head of a longer line. */
  const own = (...texts: string[]) => { for (const text of texts) assert.ok(lines.includes(text), `not a line of its own: ${text}`); };
  // While the dialog is drawn it is meant to be open. A run in progress does not hear Esc: the editor turns the close
  // away. But two presses of Esc in a row close a native dialog whatever its cancel handler says, and the editor would
  // then hold a dialog that is nowhere on screen: what a run that stopped has to say could be read nowhere. So the
  // dialog hears the `close` of its own element and opens it again, as long as that element is still in the page.
  const reopen = 'const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };';
  own(reopen);
  // And no key pressed while it is up is for the page behind it. Every keydown is stopped on the window, in the capture
  // phase: the shortcuts of the app listen there as a key bubbles, and hear any key that does not come from a text
  // field. Once Tab has run past the last button the keys come from the body, and during a run the buttons are off:
  // Ctrl and a digit would change the screen, the library would be taken down with it, and the rest of the run would
  // end without a word. An empty handler lets every key through. Two keys are swallowed whole, default and all, because
  // a key that is stopped no longer reaches the handler that used to swallow it: Ctrl+R, which then falls to the menu
  // of the window and loads the whole page anew (the run is cut off, and the unsaved edits of every map are gone), and
  // Ctrl+Z and Ctrl+Y, which the engine turns into an undo of the text last typed in a field of the page behind. Each
  // by its place on the keyboard, whatever the Korean input state. The handler is those two lines and no other: a third
  // that leaves early for some key would hand that key back to the page behind.
  const opener = 'const hold = (event: KeyboardEvent) => {';
  const held = ['event.stopPropagation();', "if ((event.ctrlKey || event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();"];
  assert.deepEqual(block(part, opener).split('\n').map(line => line.trim()).filter(Boolean), [opener, ...held, '}'], 'what the dialog does with a key pressed while it is up');
  // Both are heard from the first drawing of the dialog until it is taken down, by one effect that runs once: it finds
  // the dialog element from the paragraphs it draws, adds the two and returns the cleanup that removes them, the key
  // with the same flag. A listener that is never added does nothing, and one that is never removed would go on
  // stopping every key of the app after the dialog has gone. Each name stands three times: made, added, removed.
  const added = "dialog.addEventListener('close', reopen); window.addEventListener('keydown', hold, true);";
  const removed = "return () => { dialog.removeEventListener('close', reopen); window.removeEventListener('keydown', hold, true); };";
  const once = ['useEffect(() => {', "const dialog = body.current?.closest('dialog');", 'if (!dialog) return;', reopen, opener, ...held, '};', added, removed, '}, []);'];
  own(added, removed);
  for (const name of [/\breopen\b/g, /\bhold\b/g]) assert.equal(count(part, name), 3, `made, added and removed: ${name.source}`);
  // The focus is brought back to the button that only closes whenever it has dropped out of the dialog: as a run stops
  // short (its buttons were off while it ran), and as the map goes and 돌아가기 goes with it. Left outside, the next
  // key would be pressed on nothing at all.
  const refocus = 'useEffect(() => { if (!progress) back.current?.focus(); }, [progress, plan.target === null]);';
  own(refocus);
  // That button is where the dialog opens: 돌아가기, and 닫기 once the map is gone. Each carries the mark the modal looks
  // for as it comes up, and the ref the effect above sends the focus to. So Enter, pressed at once, goes back. And the
  // dialog is no form: the button that deletes is a plain button, pressed on purpose. Inside a form, or as its submit
  // button, Enter anywhere in the dialog would delete.
  const goBack = '<button type="button" className="bg-button" data-autofocus ref={back} disabled={!!progress} onClick={onClose}>돌아가기</button>';
  const shut = '<button type="button" className="bg-button" data-autofocus ref={back} onClick={onClose}>닫기</button>';
  const deletes = '<button type="button" className="bg-button bmap-danger" disabled={!!progress || disabled || !!text.refusal} onClick={onConfirm}>';
  own(goBack);
  for (const text of [shut, deletes]) assert.ok(part.includes(text), `not found: ${text}`);
  assert.equal(count(part, /data-autofocus/g), 2, '돌아가기 and 닫기, and no other');
  assert.equal(count(part, /<button\b/g), 3, 'the three buttons of the dialog');
  assert.equal(count(part, /<button type="button" /g), 3, 'a button of the dialog is not a plain button');
  for (const none of ['<form', 'type="submit"', 'onSubmit']) assert.ok(!part.includes(none), `still there: ${none}`);
  // And the file holds nothing else: it is the lines above and what joins them, in this order. What joins them, and what
  // goes wrong without it. The words are the pure module's, by that import (the D tests run them): a sentence made up
  // here would be reached by no test. During a run they are the words of the press, kept from the last drawing in which
  // no run was in progress: the plan is made anew from the optimistic snapshot at every command, and drawn from that
  // the counts and the two choices would change and go while the run goes on. A map that is gone has no words. The
  // dialog then says so by the name it was opened with, over one button that closes, and shows neither the message
  // of the editor nor a button that deletes: nothing can be sent, so nothing can go to another map. In both looks the
  // paragraphs stand in the element the effect finds the dialog from: without that ref in one of them, a dialog first
  // drawn in that look would hear neither its `close` nor a key. Otherwise the question, from the top: why a run
  // stopped and what it has done, when one has; what goes; the two choices when maps hang under this one, radios of
  // one group that hand the pick to the editor, off during a run and while the editor is busy; what else is saved or
  // lost; why the plan is refused. Then the two buttons. 돌아가기 is off during a run only. The button that deletes is
  // off during a run, while the editor is busy, and when the plan is refused: left on then, it would read as a way
  // past the refusal. During a run it counts the maps deleted, of the number it named when it was pressed, and says
  // only that it is deleting when that number is one.
  const modal = '<BackgroundModal title="도면 삭제" onClose={onClose}>', lead = '<div className="bmap-delete-lead" ref={body}>';
  const choice = (mode: string, words: string) => `<label className="bmap-delete-choice"><input type="radio" name={group} checked={mode === '${mode}'} onChange={() => onMode('${mode}')} /><span><strong>{text.${words}[0]}</strong>{text.${words}[1]}</span></label>`;
  const running = "{progress ? (progress.total === 1 ? '삭제 중…' : `삭제 중… ${progress.done}/${progress.total}`) : text.confirm}";
  assert.deepEqual(lines, [
    "import { useEffect, useId, useRef } from 'react';", "import type { JSX } from 'react';", "import { BackgroundModal } from './BackgroundUI';",
    "import { mapDeleteText } from './mapDelete';", "import type { MapDeleteMode, MapDeletePlan, MapDeleteText } from './mapDelete';",
    'export function BackgroundMapDeleteDialog({ name, plan, mode, progress, stopped, error, disabled, onMode, onClose, onConfirm }: {',
    'name: string; plan: MapDeletePlan; mode: MapDeleteMode; progress: { done: number; total: number } | null;', 'stopped: string | null; error: string; disabled: boolean;',
    'onMode(mode: MapDeleteMode): void; onClose(): void; onConfirm(): void }): JSX.Element {',
    'const group = useId();', 'const live = mapDeleteText(plan, mode), kept = useRef<MapDeleteText | null>(null);', 'if (live && !progress) kept.current = live;', 'const text = progress ? kept.current : live;',
    'const body = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null);', ...once, refocus,
    `if (!text) return ${modal}`, `${lead}<p className="bmap-confirm-text">‘{name}’ 도면은 이미 삭제됐어요.</p></div>`, `<div className="bmap-modal-actions">${shut}</div>`, '</BackgroundModal>;',
    `return ${modal}`, '{error && <p className="bg-error" role="alert">{error}</p>}', '{stopped && <p className="bmap-move-note" role="status">{stopped}</p>}',
    `${lead}{text.lead.map((line, index) => <p key={index} className="bmap-confirm-text">{line}</p>)}</div>`,
    '{text.keep && text.all && <fieldset className="bmap-delete-choices" disabled={!!progress || disabled}>', '<legend className="sr-only">하위 도면을 어떻게 할까요</legend>',
    choice('keep-children', 'keep'), choice('with-children', 'all'), '</fieldset>}',
    '{text.notes.map((note, index) => <p key={index} className="bmap-hint">{note}</p>)}', '{text.refusal && <p className="bg-error" role="alert">{text.refusal}</p>}',
    '<div className="bmap-modal-actions">', goBack, `${deletes}${running}</button>`, '</div>', '</BackgroundModal>;', '}']);
  // And in what the dialog draws, `read` took nothing away. Between the tags of JSX a `//` or a `/*` is no comment: it
  // is text that is drawn, and an expression written behind it still runs. `read` drops it all the same, and the list
  // above never sees that line. So each of the two looks is the same letters with and without what `read` drops: a
  // comment of this file stands above a `return`, never inside one.
  const raw = readFileSync(new URL('BackgroundMapDeleteDialog.tsx', directory), 'utf8').replace(/\r\n/g, '\n');
  const looks = (source: string) => source.split(`return ${modal}`).slice(1).map(tail => tail.slice(0, tail.indexOf('</BackgroundModal>;')));
  assert.equal(looks(raw).length, 2, 'the two looks the dialog returns');
  assert.deepEqual(looks(part), looks(raw), 'a comment mark inside what the dialog draws: there it is text on screen, and the anchor does not see its line');
  // The stylesheet, line by line and as written. The dialog is drawn by these nine rules and by no other, each a base
  // rule on a line of its own, in this order; they are looked for in what is left of the sheet without its comments, so
  // that a rule written behind a comment or under another selector is seen. Each is listed as its line begins, indent
  // and all, and each begins its line. A rule of the dialog inside a media block is not one of the nine: there it
  // stands behind the head of the block or indented under it, as the lines of a block do in this sheet, and it would
  // hold only where the condition of the block does. Its paragraphs and its two choices stand one above the other: the
  // library takes the margin off every paragraph, so the room between them is the gap of that column. Nothing of the
  // dialog moves by itself, and nothing of it blurs what is behind it: the design adds no motion, so none of these
  // rules needs a twin for reduced motion. No letter of it is slanted, by `font-style` or through the `font`
  // shorthand: the screens of this app are set without italics. And no colour is written out, as a hex or as numbers:
  // the dialog is painted with the colours of the theme, and the light screen and the dark one each have their own.
  // The near-white of the dark screen, written out for the title of a choice, could not be read on the light one.
  // Which colour of the theme a rule paints with is tuned by eye in the app, and is not held.
  const sheet = sheetLines(), has = (rule: string[], ...parts: string[]) => { for (const item of parts) assert.ok(rule.includes(item), `not declared: ${item} (${rule.join('; ')})`); };
  const bare = sheet.join('\n').replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, '')).split('\n');
  const rules = bare.filter(line => line.includes('.bmap-delete'));
  assert.deepEqual(rules.map(line => line.slice(0, line.indexOf('{') + 1)), ['.bmap-delete-lead {', '.bmap-delete-choices {', '.bmap-delete-choice {', '.bmap-delete-choice:has(input:checked) {',
    '.bmap-delete-choice strong {', '.bmap-delete-choice input {', '.bmap-delete-choices:disabled .bmap-delete-choice {',
    // Gate D: the paragraph reset of the library (`.bg-library p { margin:0 }`) took the margins of the stopped note and of
    // the notes away, and they sat on the lead. These two keep them clear of it, by a selector that outweighs the reset.
    '.bmap-move-note + .bmap-delete-lead {', '.bmap-delete-lead ~ .bmap-hint {']);
  for (const line of rules) {
    assert.equal(count(line, /\{/g), 1, `more than one rule on a line: ${line}`);
    assert.doesNotMatch(line, /transition|animation|backdrop-filter/);
    assert.doesNotMatch(line, /font-style|italic|oblique/);
    assert.doesNotMatch(line, /#|\b(?:rgb|hsl)a?\((?!var\()/);
  }
  for (const column of ['.bmap-delete-lead {', '.bmap-delete-choices {']) has(baseRule(sheet, column), 'display:flex', 'flex-direction:column');
});

test('anchor 67: the eye filters what is drawn and what a pointer is asked about, and every writer is handed the whole draft', () => {
  // The one rule of the eye: what is drawn and what a pointer is asked about leave out what it hides, and what is
  // written never does. The map without the hidden nodes is made in four places of the editor and in no other, each an
  // argument of a pure question about what lies under the pointer, never a map that is written: the pile of a press,
  // the snap candidates of a drag, what a selection box takes, and the space a new symbol stands in.
  assert.equal(count(editor, /\bshownMap\(/g), 4, 'the pile, the snap candidates, the box and the space of a new symbol');
  const down = handler.pointerDown(), move = handler.pointerMove(), up = handler.pointerUp(), place = handler.placeSymbol();
  // The press. Its pile is what the plan draws under the pointer: a hidden space in the middle of a pile is stepped over,
  // never picked. The session is opened on the whole draft as it is at this very moment: a drag previews that map and
  // writes it back, so a session opened on the shown map would delete every hidden node at the next drag.
  for (const text of ['planPileAt(shownMap(live, hiddenIds), hit.id,', 'const live = mapDraft(doc.getState(), current.id)?.value ?? current;', 'initial: live,'])
    assert.ok(down.includes(text), `not in pointerDown: ${text}`);
  // The move. The snap guides are gathered from what is shown (nothing snaps to what cannot be seen), and the drag is
  // previewed on the whole map of the press: a hidden member follows its space, and the preview is what is saved.
  for (const text of ['planGestureCandidates(gesture, shownMap(session.initial, hiddenIds))', 'previewPlanGesture(gesture, session.initial, session.start, point, snap)'])
    assert.ok(move.includes(text), `not in pointerMove: ${text}`);
  // The release of a box picks what it touches of what is shown: nothing hidden is ever selected.
  assert.ok(up.includes('doc.selectMany(session.mapId, planMarqueeIds(shownMap(live, hiddenIds), planRect(session.start, point)));'), 'the box picks from the whole map');
  // A new symbol stands in the topmost space shown at its spot: a hidden room takes none, on the plan and in 3D alike
  // (asked of the whole map, a symbol put on the floor seen under a hidden upper storey would be saved in that storey, at
  // its height). The symbol is added to the whole map: added to the shown one, every hidden node would go with it.
  for (const text of ['const containingSpace = spacesAt(shownMap(base, hiddenIds), point)[0];', 'updateMap({ ...base, nodes: [...base.nodes, symbol] });'])
    assert.ok(place.includes(text), `not in placeSymbol: ${text}`);
  assert.equal(count(place, /\bshownMap\(/g), 1, 'the shown map is made once in placeSymbol, for the space and nothing else');
  // The floor the symbol stands on and the space it belongs to are both that one answer. The space is asked once: a second
  // question of the whole map, for the height or for the membership alone, would save a symbol put under a hidden upper
  // storey at that storey's height, or as one of its members, with the line above untouched.
  assert.equal(count(place, /\bspacesAt\(/g), 1, 'the space under a new symbol is asked once, of the shown map');
  for (const text of ['const level = containingSpace ? nodeElevation(containingSpace) : MAP_SPATIAL_DEFAULTS.symbolElevation;', 'spaceId: containingSpace?.id ?? null,'])
    assert.ok(place.includes(text), `the new symbol does not take this from the space shown at its spot: ${text}`);
  // In each of the four the hidden nodes are named once, in that call: a second use (a filter of its own, the line that
  // makes the map of the press) would filter what is written as well.
  for (const [name, body] of Object.entries({ pointerDown: down, pointerMove: move, pointerUp: up, placeSymbol: place }))
    assert.equal(count(body, /\bhiddenIds\b/g), 1, `${name} names the hidden nodes elsewhere`);
  // The plan draws no hidden node. The one pass over the stack leaves a hidden space out before anything of it is made,
  // and the passes over the symbols and the cameras leave a hidden one out in their filter.
  const spaces = piece(editor, '{stackedSpaces(current).map(node => {', '{current.nodes.filter((node): node is BackgroundSymbol');
  const [opener, first, second] = spaces.split('\n').map(line => line.trim()).filter(Boolean);
  assert.deepEqual([opener, first], ['{stackedSpaces(current).map(node => {', 'if (hiddenIds.has(node.id)) return null;'], 'a hidden space is drawn');
  assert.ok(second?.startsWith('const isSelected = shownIds.has(node.id)'), `the space is not drawn by its own lines: ${second}`);
  for (const pass of ["{current.nodes.filter((node): node is BackgroundSymbol => node.type === 'symbol' && !hiddenIds.has(node.id)).map(node => {",
    "{current.nodes.filter((node): node is BackgroundCamera => node.type === 'camera' && !hiddenIds.has(node.id)).map(node => {"])
    assert.ok(editor.includes(pass), `a hidden node is drawn: ${pass}`);
  // Whether one node is hidden is asked in these six places and no other: the row of the object list, its eye and its
  // name (toggleHidden, selectFromList), the pass over the spaces and the two filters. A seventh is a filter of its own.
  assert.equal(count(editor, /hiddenIds\.has\(/g), 6, 'the row of the list, toggleHidden, selectFromList, the pass over the spaces and the two filters');
  // The 3D view and the companion plan are handed the whole draft, and what is hidden beside it. A gizmo drag starts from
  // that map and writes it back: handed the shown map, the 3D view would delete every hidden node at the next drag.
  for (const tag of ['<Map3D map={current} ', '<BackgroundMapPlanPreview map={current} ']) assert.ok(editor.includes(tag), `not handed the whole draft: ${tag}`);
  // The 3D view is handed what is hidden behind the attributes it always had (the companion plan is, by anchor 64). Not
  // handed it, the 3D view would draw every hidden node and take its clicks.
  assert.ok(piece(editor, '<Map3D map={current}', '/>').includes(' onUnavailable={leave3D} hiddenIds={hiddenIds} '), 'the 3D view is not handed what is hidden');
  // And last, the rooms it draws as closed boxes: while the symbol tool is in hand in edit mode, the one empty set of the
  // view settings instead, the same object at every render, so every room is see-through where a floor is aimed at and
  // the scene is synced once as the tool is taken up. Without that choice the boxes stay closed under the symbol tool.
  assert.ok(`${piece(editor, '<Map3D map={current}', '/>')}/>`.endsWith('onUnavailable={leave3D} hiddenIds={hiddenIds} solidIds={roomsOpen ? NO_MAP_VIEW_PREFS.solid : solidIds} />'), 'the 3D view is not handed the closed rooms as the editor says');
  // The companion plan makes the map without the hidden nodes once, for what a click lands on and steps through alone: it
  // is framed from the whole map (a view box made from the shown one would jump at every eye pressed), and each of its
  // three passes leaves a hidden node out.
  const preview = read('BackgroundMapPlanPreview.tsx');
  assert.equal(count(preview, /\bshownMap\(/g), 1, 'the companion plan makes the shown map elsewhere');
  for (const text of ['const pointed = useMemo(() => shownMap(map, hiddenIds), [map, hiddenIds]);', 'latest.current = { map: pointed, selectedId, onSelect, scale };', 'planViewBox(map, size)'])
    assert.ok(preview.includes(text), `not in the companion plan: ${text}`);
  for (const pass of ['{stackedSpaces(map).map(node => !hiddenIds?.has(node.id) && <PlanShape key={node.id} ', "{map.nodes.map(node => node.type === 'symbol' && !hiddenIds?.has(node.id) && <PlanShape key={node.id} ",
    "{map.nodes.map(node => node.type === 'camera' && !hiddenIds?.has(node.id) && <PlanCamera key={node.id} "]) assert.ok(preview.includes(pass), `the companion plan draws a hidden node: ${pass}`);
  assert.equal(count(preview, /!hiddenIds\?\.has\(node\.id\) &&/g), 3, 'the three passes of the companion plan, and no other');
  // The 3D files are handed sets of ids and never a map without the hidden nodes: they know neither that map nor the
  // module of the view settings. Read as written, with their comments.
  for (const name of ['BackgroundMap3D.tsx', 'map3dScene.ts', 'BackgroundMapCameraGizmo.ts'])
    assert.doesNotMatch(readFileSync(new URL(name, directory), 'utf8'), /shownMap|mapViewPrefs/, `${name} knows the view settings`);
});

test('anchor 68: what is hidden is never selected, and a view setting writes no map', () => {
  // The view settings of this PC are five handlers that stand together right behind the stable pick of the empty
  // selection, in no handler another anchor cuts out: the eye of a row, 모두 보이기, a row of the object list, and the
  // closed box of a room in 3D. They are these lines and what joins them, in this order. Neither the eye nor the box
  // is heard during a drag: its session works on what was drawn and stacked at the press. A change that changes
  // nothing writes nothing, and a change is written to this PC at once, by the handler itself. Showing a node again
  // leaves the selection alone. Hiding one takes it out of what is selected, read from the store as it is at this
  // moment (a handler may run before the next render): the group of the plan, the node in hand in 3D, and the pick
  // that view stored while it is not in hand. The list is written first. In 3D, while two or more stay selected, the
  // node in hand is a pick of its own, kept or let go; with one or none left there is nothing to pick, the one selected
  // is the one in hand. For the length of a double-click no press reaches the page, and only when what the properties
  // show changes: the eyes of a group can be pressed one after the other. A row of the list shows a hidden node first,
  // and picks it only once that went through. 모두 보이기 sends the keyboard to the canvas: its button goes with its own press.
  const handlers = handler.viewPrefs();
  assert.deepEqual(handlers.split('\n').map(line => line.trim()).filter(Boolean), [
    'const setNodesHidden = useEvent((ids: readonly string[], hidden: boolean): boolean => {',
    'if (!current || pointerRef.current || doc.isGestureActive()) return false;',
    'const next = withHiddenNodes(viewPrefs, current, ids, hidden);',
    'if (next !== viewPrefs) { setViewPrefs(next); storeMapViewPrefs(viewerId, next); }',
    'if (!hidden) return true;',
    'const live = mapDraft(doc.getState(), current.id)?.value ?? current;',
    "const left = selectionWithout(live, liveSelection(current.id, live), mapViewport(doc.getState(), current.id).selectedId, ids, mode === 'plan');",
    'if (!left.changed) return true;',
    'doc.selectMany(current.id, left.ids);',
    "if (mode === '3d' && left.ids.length > 1) select(left.inHand);",
    'if (left.moved) swallowSecondClick();',
    'return true;',
    '});',
    'const toggleHidden = useEvent((id: string) => { setNodesHidden([id], !hiddenIds.has(id)); });',
    'const showAll = useEvent(() => { if (setNodesHidden([...hiddenIds], false)) focusCanvas(); });',
    'const selectFromList = useEvent((id: string) => { if (!hiddenIds.has(id) || setNodesHidden([id], false)) select(id); });',
    'const setSpacesSolid = useEvent((ids: readonly string[], solid: boolean) => {',
    'if (!current || pointerRef.current || doc.isGestureActive()) return;',
    'const next = withSolidSpaces(viewPrefs, current, ids, solid);',
    'if (next !== viewPrefs) { setViewPrefs(next); storeMapViewPrefs(viewerId, next); }',
    '});']);
  // A view setting is no edit: none of the five writes the map, previews it or opens a gesture of the document. So it
  // leaves no undo step, the band counts nothing for it, and there is nothing to save.
  for (const writer of ['updateMap(', 'doc.update(', 'doc.previewGesture(', 'patchNode(', 'doc.beginGesture(']) assert.ok(!handlers.includes(writer), `a view setting writes the map: ${writer}`);
  // This PC is written in those two places alone, as a setting is changed: never by an effect, at every render.
  assert.equal(count(editor, /\bstoreMapViewPrefs\(/g), 2, 'the eye and the box, and nowhere else');
  assert.equal(count(handlers, /\bstoreMapViewPrefs\(/g), 2, 'this PC is written outside the five handlers');
  // Read once, as the editor comes up, for the account on show: the library draws the editor anew for another account
  // (the key of its body). And the settings in hand are set in those two places alone.
  assert.ok(editor.includes('const [viewPrefs, setViewPrefs] = useState(() => readMapViewPrefs(viewerId));'), 'the settings are not read once, for the account on show');
  assert.equal(count(editor, /\breadMapViewPrefs\(/g), 1, 'the settings are read in another place');
  assert.equal(count(editor, /\bsetViewPrefs\(/g), 2, 'the eye and the box, and nowhere else');
  // The account on show is the library's: it hands the editor the one signed in, and keys the body that holds the
  // editor by it, so another account draws the editor anew. Handed no account, the editor neither reads nor writes this
  // PC, and no setting outlives the screen; with no key on that body, it keeps the settings of the account before and
  // writes them under the next one's name at its first eye or box.
  const library = read('BackgroundLibraryView.tsx');
  assert.ok(library.includes("viewerId={user?.id ?? ''}"), 'the editor is not handed the account signed in');
  assert.ok(library.includes('key={user?.id || "signed-out"}'), 'the editor is not drawn anew for another account');
  // What the map on show is shown with is read in one line, for the map on show. Read for `currentId`, the first map
  // opened would show nothing hidden and no box: no map has been chosen yet, and that id is null.
  const shown = 'const { hidden: hiddenIds, solid: solidIds } = mapViewPrefsOf(viewPrefs, current?.id);';
  assert.equal(editor.split(shown).length - 1, 1, `not once: ${shown}`);
  assert.equal(count(editor, /\bmapViewPrefsOf\(/g), 1, 'the settings of a map are read in another place');
  // What is left selected is asked of the pure module (the V tests run it), with its five arguments as they are at the
  // press: the pick the 3D view stored as well, not only the node in hand, so a group that grows again (a redo) puts
  // nothing hidden in hand.
  assert.ok(editor.includes("selectionWithout(live, liveSelection(current.id, live), mapViewport(doc.getState(), current.id).selectedId, ids, mode === 'plan')"), 'what is left selected is asked of other values');
});

test('anchor 69: a row of the object list is a name and an eye beside it, and the heading puts the hidden count first', () => {
  const list = piece(editor, 'const ObjectList = memo(function ObjectList(', 'export function BackgroundMapEditor(');
  // Three buttons: 모두 보이기 in the heading, and in each row the name and the eye. A button holds no button, so the eye is
  // the sibling right behind the name, the last thing in its row.
  assert.equal(count(list, /<button\b/g), 3, 'the heading, the name and the eye');
  assert.match(list, /<\/button>\s*<button type="button" className="bmap-node-eye"[^\n]*<\/button>\s*<\/li>/, 'the eye is not the sibling behind the name');
  // The eye, its whole tag: named by what a press does, with a short title that says this PC alone, the closed eye drawn on
  // a hidden row and the open one on a row on show. It hides and shows, and never picks.
  assert.equal(count(list, /className="bmap-node-eye"/g), 1, 'one eye in a row');
  assert.ok(list.includes(`<button type="button" className="bmap-node-eye" aria-label={\`\${name} \${hidden ? '다시 보이기' : '숨기기'}\`} title={hidden ? '다시 보이기' : '숨기기 · 이 PC에서만 안 보여요'} onClick={() => onToggleHidden(node.id)}>{hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}</button>`), 'the eye is not as written');
  // Its state is in its name, which changes: with aria-pressed as well a reader would say 숨기기, pressed. The one press that
  // picks is the name's.
  assert.ok(!list.includes('aria-pressed'), 'the eye says its state twice');
  assert.equal(count(list, /\bonSelect\(node\.id\)/g), 1, 'the eye picks');
  // A hidden row is marked on the row, so the name button keeps its classes as anchor 36 reads them, and its name says it.
  assert.ok(list.includes("<li key={node.id} className={hidden ? 'is-hidden' : undefined}>"), 'a hidden row is not marked on the row');
  assert.ok(list.includes("aria-label={`${name}, ${kindLabel(node)}${node.locked ? ', 잠김' : ''}${hidden ? ', 숨김' : ''}`}"), 'the name of a hidden row does not say so');
  // The row asks once, as written, and its mark, its name and its eye all read that: a row is hidden when its node is in
  // the set (asked the other way round, every row on show is dimmed, drawn with the closed eye and named as hidden), and it
  // is named by the node's name, as the row shows it, not by its id.
  assert.ok(list.includes("const hidden = hiddenIds.has(node.id), name = node.name || '이름 없음';"), 'the row is not as written');
  // The heading: the hidden count comes first, so a narrow panel cuts the count of all and keeps it. 모두 보이기 stands beside
  // it while anything is hidden, and its title says what hiding does.
  assert.ok(list.includes("<span className=\"bmap-badge\">{hiddenCount > 0 ? `숨김 ${hiddenCount} · ` : ''}{ordered.length}개</span>"), 'the count of the heading');
  assert.ok(list.includes('title={HIDDEN_NOTE} onClick={onShowAll}>모두 보이기</button>'), '모두 보이기 of the heading');
  // And the whole heading, as written: 모두 보이기 is there only while anything is hidden, it stands to the left of the
  // count, and it wears its own class, which keeps it lower than the badge. As a plain text button it is 36px tall, and the
  // heading would grow under the pointer at the first eye pressed.
  assert.ok(list.includes('<div className="bmap-section-heading"><strong>오브젝트</strong>{hiddenCount > 0 && <button type="button" className="bmap-text-button bmap-show-all" title={HIDDEN_NOTE} onClick={onShowAll}>모두 보이기</button>}<span className="bmap-badge">{hiddenCount > 0 ? `숨김 ${hiddenCount} · ` : \'\'}{ordered.length}개</span></div>'), 'the heading is not as written');
  // What hiding does is said under the rows at all times, hidden or not: a line that came with the first eye would move the
  // list under the pointer. And a reader is told the count as it changes.
  assert.ok(list.includes('</ul><p className="bmap-hint">{HIDDEN_NOTE}</p></>'), 'the line under the list');
  assert.ok(list.includes("<span className=\"sr-only\" role=\"status\">{hiddenCount > 0 ? `숨긴 것 ${hiddenCount}개` : '숨긴 것이 없어요'}</span>"), 'what a reader is told');
  // The list counts nothing: it is handed the count, and asks about the hidden nodes once, for the row it draws. The editor
  // counts in one line, from the map the list is drawn from. The size of the set counts the id of a node that is gone too.
  assert.equal(count(list, /hiddenIds\.has\(/g), 1, 'the list asks about the hidden nodes elsewhere');
  assert.doesNotMatch(list, /\bfilter\((?:[^()]|\([^()]*\))*\bhiddenIds\b/, 'the list counts the hidden nodes');
  const counted = 'const hiddenCount = useMemo(() => hiddenNodeCount(settledCurrent, hiddenIds), [settledCurrent, hiddenIds]);';
  assert.equal(editor.split(counted).length - 1, 1, `not once: ${counted}`);
  assert.ok(!editor.includes('hiddenIds.size'), 'the hidden nodes are counted by the size of the set');
  // The words: a hidden node never reads as a deleted one. Made once, and said under the list, as the title of 모두 보이기
  // and as the title of the chip in the footer.
  assert.equal(editor.split("const HIDDEN_NOTE = '숨긴 것은 이 PC의 내 화면에서만 안 보여요. 도면에는 그대로 있어서, 저장해도 지워지지 않아요.';").length - 1, 1, 'the words of the eye');
  assert.equal(count(editor, /\bHIDDEN_NOTE\b/g), 4, 'made, the heading, under the list, the chip');
});

test('anchor 70: in 3D a hidden node and what a closed room holds are not drawn, and a click stops at the first closed face', () => {
  const scene = read('map3dScene.ts');
  // The scene keeps every option of the last sync, the two sets of the view settings too: a change of theme syncs again
  // with them, and without one of them what it holds would come back on screen while the viewport sees nothing new.
  const sync = piece(scene, 'sync(map: BackgroundMap, selectedId: string | null, options: Map3DSyncOptions = {}): void {', 'root(id: string): Object3D | null {');
  assert.ok(sync.includes('this.last = { map, selectedId, options: { holdId, hiddenId, hiddenIds, solidIds } };'), 'the scene forgets a set of the view settings');
  // One line says what is drawn: the root of a node the eye hides is not, and with it all that follows the root (its
  // name, the drop line of a camera). Hidden roots take no click: they are no target (pickTargets). The label is never
  // switched off on its own.
  assert.match(sync, /const visible = entry\.valid && node\.id !== hiddenId && !hiddenIds\.has\(node\.id\)/);
  assert.ok(!scene.includes('.label.visible') && !scene.includes('label.visible ='), 'a label is switched off on its own');
  // An option that is absent reads as the one empty set of the scene, made there: never one of the viewport or of the module
  // of the view settings, which the scene does not import.
  assert.equal(scene.split('const NO_IDS: ReadonlySet<string> = new Set();').length - 1, 1, 'the empty set of the scene');
  // The rooms drawn closed and what they hold are read from the map before any entry is touched: a node that comes before
  // its box in the map is hidden at the first sync as well. A road is never closed, the room a looked-through camera
  // stands in opens, a box the eye hides holds nothing, and the selected node is drawn though it is held.
  for (const text of ["const boxes = solidIds.size ? map.nodes.filter((node): node is BackgroundSpace => node.type === 'space' && solidIds.has(node.id) && !isRoadSpace(node) && !(lens && spaceHoldsNode(node, lens))) : [];",
    'const held = nodesHeldBy(map, boxes.filter(space => !hiddenIds.has(space.id)));', 'solid = boxIds.has(node.id)', 'entry.solid !== solid',
    'const visible = entry.valid && node.id !== hiddenId && !hiddenIds.has(node.id) && (selected || !held.has(node.id));'])
    assert.ok(sync.includes(text), `not in sync: ${text}`);
  inOrder(sync, 'const boxes = ', 'const held = ', 'for (const node of map.nodes) {');
  // Held is whole: every corner, from the floor up to the top, both included. A camera is asked a hair away on eight
  // sides, so one on a wall line or at the level of the lid is inside, whatever the shape of the room. Of two boxes that
  // hold each other the earlier in the map holds the later.
  const stack = read('mapStack.ts');
  for (const text of ['nodePlanOutline(node).every(', 'level + height <= top + HOLD_SLACK',
    "if (node.type === 'camera') return AROUND.some(([dx, dy]) => containsPoint(space, { x: node.x + dx * HOLD_SLACK, y: node.y + dy * HOLD_SLACK }));",
    'const AROUND: readonly (readonly [number, number])[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];',
    'boxes.includes(node) && at(node.id) < at(box.id) && spaceHoldsNode(node, box)'])
    assert.ok(stack.includes(text), `not in mapStack.ts: ${text}`);
  const holds = piece(stack, 'export function spaceHoldsNode(', 'export function nodesHeldBy(');
  assert.ok(!holds.includes('containsPoint(space, node)'), 'a camera is asked at its own point: on a wall line of a polygon room it reads outside');
  assert.ok(!holds.includes('level < top'), 'a camera at the level of the lid reads outside');
  // A closed room is one opaque material on its floor, its walls and a lid that is the floor geometry once more, and every
  // face of it is a click on the room. Its key builds it anew when the box is switched; that of a camera is as it was (anchor 45).
  const build = piece(scene, 'private buildSpace(', 'private buildSymbol(');
  for (const text of ['const shell = solid && !road ?', "lid.position.y = height; lid.name = 'space-lid';", 'new Mesh(floor.geometry, shell)', "shell ? 'shell' : mesh === floor ? 'floor' : 'wall'"])
    assert.ok(build.includes(text), `not in buildSpace: ${text}`);
  const paint = piece(scene, 'private material(', 'private geometry(');
  for (const text of ['closed(0.35)', 'closed(0.6)', 'polygonOffset: true']) assert.ok(paint.includes(text), `not among the materials: ${text}`);
  const key = piece(scene, 'function shapeKey(', 'function labelSpec(');
  assert.ok(key.includes("${isRoadSpace(node) ? 'road' : ''}${solid ? '|solid' : ''}`;"), 'the key of a space does not end with whether it is closed');
  assert.equal(count(key, /\$\{solid \? '\|solid' : ''\}/g), 1, 'the key of a space alone tells whether it is closed');
  // A click stops at the first closed face on its ray: what lies behind a box is never reached. It stands before
  // pickMapFloor, out of every piece that anchors 21 and 49 cut. A closed face is a floor to a click, so a see-through
  // wall in front of a box does not take it: the floors of a click and of its pile are read alike.
  inOrder(scene, 'export function visibleMapHits<T extends MapPickHit>(hits: T[]): T[] {', 'export function pickMapFloor(');
  for (const [name, body] of Object.entries({ pickMapFloor: piece(scene, 'export function pickMapFloor(', 'function roadsUnderRooms('),
    mapFloorPile: piece(scene, 'export function mapFloorPile(', 'export function mapSpacePile(') }))
    assert.equal(count(body, /hits\.filter\(landsOnSpace\)/g), 1, `${name} does not stand on a closed face`);
  // The viewport casts every ray in one place, and cuts it there: a click, a double click and a symbol put down.
  assert.match(piece(view3d, 'private cast(', 'private floorPoint('), /return visibleMapHits\(this\.raycaster\.intersectObjects\(this\.scene3d\.pickTargets\(\), false\)\);\s*\}\s*$/,
    'the ray of the viewport is not cut at the first closed face');
  // The viewport hands the sets on as they come, and syncs again only when one of them is another object. When the rooms
  // are see-through is the editor's to say: read for placing here, every save with the symbol tool in hand would close
  // and open the boxes.
  const syncScene = piece(view3d, 'private syncScene(', 'private gizmoAllowed(');
  for (const text of ['const hiddenIds = this.props.hiddenIds ?? NO_IDS, solidIds = this.props.solidIds ?? NO_IDS;', 'shown.hiddenIds === hiddenIds && shown.solidIds === solidIds'])
    assert.ok(syncScene.includes(text), `not in syncScene: ${text}`);
  assert.ok(!syncScene.includes('placing'), 'the viewport changes the sets while placing');
  // Nothing that is not drawn gets a gizmo.
  assert.ok(piece(view3d, 'private gizmoAllowed(', 'private applyGizmo(').includes('props.hiddenIds?.has(id)'), 'a hidden node gets a gizmo');
  // Both are optional: a viewport handed neither runs as before. No typecheck reads the stand-in of the viewport tests,
  // which builds its props without them: these letters are what holds it.
  const props3d = piece(read('mapCanvas.ts'), 'export type Map3DProps = MapCanvasProps & {', 'export type MapScrubOrigin');
  for (const field of ['hiddenIds?: ReadonlySet<string>;', 'solidIds?: ReadonlySet<string>;']) assert.ok(props3d.includes(field), `not an optional prop of the 3D view: ${field}`);
});

test('anchor 71: the chip takes no room in the footer, and the new classes are written in their own lines alone', () => {
  const lines = sheetLines(), has = (rule: string[], ...parts: string[]) => { for (const item of parts) assert.ok(rule.includes(item), `not declared: ${item} (${rule.join('; ')})`); };
  // The rules of a row and its eye, the hidden row, the heading, the line under the list, the chip and the section of the
  // closed box under the properties of a room in 3D, as written, each once.
  const rules = [
    '.bmap-node-list li { display:flex; align-items:center; gap:2px; }',
    '.bg-library .bmap-node-list li>button:not(.bmap-node-eye) { flex:1 1 0; width:auto; min-width:0; }',
    '.bg-library .bmap-node-list .bmap-node-eye { flex:0 0 28px; width:28px; min-width:28px; padding:0; gap:0; justify-content:center; }',
    '.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye) { opacity:.7; }',
    '.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye):focus-visible { opacity:1; }',
    '.bg-library .bmap-node-list li.is-hidden .bmap-node-type { opacity:1; }',
    '.bg-library .bmap-objects .bmap-show-all { position:relative; flex-shrink:0; min-height:0; margin-left:auto; padding:0 2px; font-size:11px; line-height:1.4; white-space:nowrap; }',
    '.bg-library .bmap-objects .bmap-show-all::after { content:""; position:absolute; inset:-5px 0; }',
    '.bmap-objects .bmap-section-heading>strong { flex-shrink:0; }',
    '.bmap-objects .bmap-badge { display:block; min-width:0; overflow:hidden; text-overflow:ellipsis; }',
    '.bmap-objects>.bmap-node-list+.bmap-hint { margin-top:8px; }',
    '.bmap-hidden-slot { position:relative; flex:0 0 0; width:0; height:0; margin:0 -10px 0 auto; }',
    '.bg-library .bmap-hidden-chip { position:absolute; right:10px; top:-13px; height:26px; min-height:26px; padding:0 10px; border-color:rgb(var(--color-accent) / .45); border-radius:13px; background:rgb(var(--color-bg-card)); color:rgb(var(--color-text-primary)); font-size:11px; white-space:nowrap; box-shadow:0 0 0 3px color-mix(in srgb, rgb(var(--color-bg-card)) 40%, rgb(var(--color-bg-primary))); }',
    '.bg-library .bmap-hidden-chip:hover:not(:disabled) { border-color:rgb(var(--color-accent-sub)); background:rgb(var(--color-bg-card)); }',
    '.bmap-solid { margin:14px 0 8px; }',
    '.bmap-solid .bmap-check { margin:0 0 6px; }',
    '.bmap-solid .bmap-hint { margin-bottom:2px; }',
  ];
  for (const rule of rules) assert.equal(lines.filter(line => line === rule).length, 1, `not once, as a line of its own: ${rule}`);
  // No other line names a new class: not a comment, not an override in a media block. One that hid the eye in a narrow
  // window would leave every line above as it is.
  for (const [name, times] of Object.entries({ 'bmap-node-eye': 4, 'bmap-hidden-chip': 2, 'bmap-hidden-slot': 1, 'bmap-show-all': 2, 'is-hidden': 3, 'bmap-solid': 3 }))
    assert.equal(lines.filter(line => line.includes(name)).length, times, `lines that name ${name}`);
  // Nothing of them moves by itself, and a hidden row is not slanted: it is dimmed by its opacity alone.
  const named = lines.filter(line => /bmap-node-eye|bmap-hidden-chip|bmap-hidden-slot|bmap-show-all|is-hidden|bmap-solid/.test(line));
  for (const line of new Set([...rules, ...named])) assert.doesNotMatch(line, /transition|animation|font-style|backdrop-filter/, line);
  // The anchor of the chip takes no room: no width, no height, and its right margin gives back the one gap it adds to the
  // footer (the two numbers are one). So the hint beside it wraps as without it, and the footer and the map keep their size.
  has(baseRule(lines, '.bmap-hidden-slot {'), 'flex:0 0 0', 'width:0', 'height:0', 'margin:0 -10px 0 auto');
  has(baseRule(lines, '.bmap-canvas-footer {'), 'gap:10px');
  // The chip floats on it, over the free end of the footer, in the text colour: the lighter accent is 2.4:1 on a white card.
  // A ring of the colour between the card and the page keeps a letter of the hint it half covers apart from its edge, where
  // the footer is narrow (gate A, at 1280 and 740: without it the letter ran into the border as if broken).
  const chip = baseRule(lines, '.bg-library .bmap-hidden-chip {');
  has(chip, 'position:absolute', 'white-space:nowrap', 'box-shadow:0 0 0 3px color-mix(in srgb, rgb(var(--color-bg-card)) 40%, rgb(var(--color-bg-primary)))');
  assert.deepEqual(chip.filter(item => item.startsWith('color:')), ['color:rgb(var(--color-text-primary))'], 'the colour of the chip');
  // A hidden row is dimmed to .7, still read and pressed to bring the node back. Its word for the kind gives up its own
  // dimming there, or the two would multiply to .525.
  has(baseRule(lines, '.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye) {'), 'opacity:.7');
  has(baseRule(lines, '.bg-library .bmap-node-list li.is-hidden .bmap-node-type {'), 'opacity:1');
  // Its focus ring is drawn inside the dimmed name and would fade with it (2.5:1 on the dark card): under the keys the name
  // that brings the node back is at full strength again (final review).
  has(baseRule(lines, '.bg-library .bmap-node-list li.is-hidden>button:not(.bmap-node-eye):focus-visible {'), 'opacity:1');
  // The heading never wraps: its word and 모두 보이기 keep their width, and the count gives way with an ellipsis. The button
  // is pressed on 5px more above and below, by a layer that takes no room in the heading.
  has(baseRule(lines, '.bmap-objects .bmap-section-heading>strong {'), 'flex-shrink:0');
  has(baseRule(lines, '.bg-library .bmap-objects .bmap-show-all {'), 'position:relative', 'flex-shrink:0', 'white-space:nowrap');
  has(baseRule(lines, '.bmap-objects .bmap-badge {'), 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis');
  has(baseRule(lines, '.bg-library .bmap-objects .bmap-show-all::after {'), 'position:absolute', 'inset:-5px 0');
  // The line under the rows takes its room above alone: the list ends the section.
  has(baseRule(lines, '.bmap-objects>.bmap-node-list+.bmap-hint {'), 'margin-top:8px');
  // The chip stands in the footer of both modes, outside the properties that fold away, between the hint and the zoom of the
  // plan: in no branch of a mode, and nothing else stands there.
  const chipTag = '{hiddenCount > 0 && <div className="bmap-hidden-slot"><button type="button" className="bmap-hidden-chip" title={HIDDEN_NOTE} onClick={showAll}>숨김 {hiddenCount}개 · 모두 보이기</button></div>}';
  assert.equal(editor.split(chipTag).length - 1, 1, 'the chip is not drawn once, as written');
  assert.equal(piece(editor, '{footerHint}</span>', '{mode === \'plan\' && <div className="bmap-zoom">'), `{footerHint}</span>${chipTag}`, 'the chip is not between the hint and the zoom');
  // The chip may lie over the end of the hint: while it is there the whole hint is in its title, in 3D as well.
  assert.ok(editor.includes("<span className=\"bmap-footer-hint\" title={mode === 'plan' || hiddenCount > 0 ? footerHint : undefined}>{footerHint}</span>"), 'the title of the hint');
});

test('anchor 72: the closed box is a view setting of a room in 3D, below the kind of the space, and nothing of it is saved', () => {
  // The switch of the closed box is one section of the inspector, drawn while a room is in hand in 3D: not on the plan,
  // where it would change nothing on screen, and not for a road, a camera or a symbol.
  const opener = `{mode === '3d' && selected.type === 'space' && !selectedRoad && <section className="bmap-solid"`;
  assert.equal(editor.split(opener).length - 1, 1, 'the section of the closed box is not drawn once, on this condition');
  assert.equal(count(editor, /\bbmap-solid\b/g), 1, 'the class of the closed box is drawn in another place');
  // Nor is it drawn a second time under another class, and the line of the composition that points to it (below) is not
  // drawn on the plan as well: the words they share are in the editor twice, the check of this section and that line.
  assert.equal(count(editor, /속이 안 보이는 박스로/g), 2, 'the switch and the line of the composition, once each');
  // It stands right behind the section of the kind of the space, out of its branch: there while viewing too, and below its
  // select, so switching a room to a road takes the section away under nothing that was just pressed. Nothing else stands
  // between the two: the `</>}` that closes the kind, and this section as written (spaces do not count, and its comment
  // leaves a `{}`).
  const squeeze = (text: string) => text.replace(/\s+/g, '');
  const written = [
    `{mode === '3d' && selected.type === 'space' && !selectedRoad && <section className="bmap-solid" aria-label="3D에서 보는 방식">`,
    `<label className="bmap-check"><input type="checkbox" checked={solidIds.has(selected.id)} onChange={event => setSpacesSolid([selected.id], event.target.checked)} />속이 안 보이는 박스로 보기</label>`,
    `<p className="bmap-hint">이 PC에서 3D를 보는 방식만 바뀌어요. 도면에는 저장되지 않아요. 박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요.{roomsOpen ? ' 기호를 놓는 동안에는 모든 공간이 비쳐 보여요.' : ''}</p>`,
    `<div className="bmap-link-actions"><button type="button" className="bmap-text-button" onClick={() => setSpacesSolid(mapRoomIds(current), true)}>모든 공간을 박스로</button><button type="button" className="bmap-text-button" onClick={() => setSpacesSolid([...solidIds], false)}>모두 비치게</button></div>`,
    '</section>}'].join('');
  assert.equal(squeeze(piece(editor, 'ROAD_HINT_ROUND : ROAD_HINT_NO_STRIP}</p>}', "{selected.type === 'camera' && (() => {")).replace(/\{\}/g, ''),
    `ROAD_HINT_ROUND:ROAD_HINT_NO_STRIP}</p>}</>}${squeeze(written)}`, 'the section of the closed box is not as written, right behind the kind of the space');
  // A view setting of this PC writes no map: neither viewing, a lock, a read-only account nor a save switches it off. Only a
  // drag holds it back, in its handler (anchor 68).
  const box = piece(editor, opener, '</section>}');
  assert.ok(!box.includes(' disabled='), 'the closed box is switched off');
  // The words of the section and what its buttons do: the check, what it changes and where what a box holds is reached, the
  // sentence while the symbol tool is in hand, every room of the map closed (no road), every box of the map opened.
  for (const text of ['/>속이 안 보이는 박스로 보기</label>', '이 PC에서 3D를 보는 방식만 바뀌어요. 도면에는 저장되지 않아요. 박스 안에 든 것은 3D에서 안 보여요. 오브젝트 목록에서 고를 수 있어요.',
    "{roomsOpen ? ' 기호를 놓는 동안에는 모든 공간이 비쳐 보여요.' : ''}", 'onClick={() => setSpacesSolid(mapRoomIds(current), true)}>모든 공간을 박스로</button>',
    'onClick={() => setSpacesSolid([...solidIds], false)}>모두 비치게</button>'])
    assert.ok(box.includes(text), `not in the section of the closed box: ${text}`);
  // That a setting is not saved in the map is said of the way 3D is seen, there alone: said of the eye, it would read as if
  // a hidden node were not saved.
  assert.equal(count(editor, /도면에는 저장되지 않아요/g), 1, 'not saved in the map is said in another place');
  // The rooms are see-through while the symbol tool is in hand in edit mode, through a save as well: one value, read by the
  // 3D view (anchor 67) and by the sentence of the section. Hung on canEdit, a save with the tool in hand would close and
  // open every box, and take the sentence away and back.
  assert.equal(editor.split("const roomsOpen = tool === 'symbol' && editing;").length - 1, 1, 'when the rooms are see-through');
  assert.equal(count(editor, /\broomsOpen\b/g), 3, 'made, the sentence of the section, the 3D view');
  // With nothing in hand in 3D, the composition of the map says where the switch is, right under its first hint.
  const where = `{mode === '3d' && <p className="bmap-hint">공간을 고르면 속이 안 보이는 박스로 볼 수 있어요.</p>}`;
  assert.equal(editor.split(where).length - 1, 1, 'the line of the composition is not drawn once, in 3D alone');
  assert.match(editor, /공간을 선택하면 내부 도면을 만들거나 연결할 수 있습니다\.<\/p>\s*\{mode === '3d' && <p className="bmap-hint">공간을 고르면 속이 안 보이는 박스로 볼 수 있어요\.<\/p>\}/,
    'the line of the composition is not right under its first hint');
  // The settings are of this PC: their module draws nothing and reaches no page by itself, and its key names its shape.
  const prefs = read('mapViewPrefs.ts');
  assert.doesNotMatch(prefs, /from\s+['"]three/, 'the view settings import three.js');
  for (const global of ['document.', 'window.']) assert.ok(!prefs.includes(global), `the view settings reach the page: ${global}`);
  assert.ok(prefs.includes("MAP_VIEW_PREFS_KEY = 'bflow.background-map.view.v1'"), 'the key of the view settings');
  // Kept by this PC past a closed app, read and written there unless a test hands another storage. Node has no such
  // storage, so the pure tests never reach this default (V-5 reads without it, and writes none): these lines hold it (final review).
  assert.ok(prefs.includes('try { return localStorage; } catch { return null; }'), 'the view settings are not kept in the storage of this PC');
  assert.ok(!prefs.includes('sessionStorage'), 'the view settings last for the session only');
  assert.equal(prefs.split('storage: MapViewStorage | null = deviceStorage())').length - 1, 2, 'reading and writing do not both default to the storage of this PC');
  // And never of the map: what is saved knows neither word. A node with such a key is refused whole by the save.
  for (const name of ['types.ts', 'domain.ts', 'mapWorkflow.ts', 'mapDocument.ts'])
    assert.doesNotMatch(read(name), /\b(?:hidden|solid)(?:Ids)?\b/, `${name} knows a view setting`);
  // Each account its own: the library hands the editor the one signed in, and draws the editor anew for another.
  const library = read('BackgroundLibraryView.tsx');
  assert.ok(library.includes("viewerId={user?.id ?? ''}"), 'the editor is not handed the account signed in');
  assert.ok(library.includes('key={user?.id || "signed-out"}'), 'the editor is not drawn anew for another account');
});

test('anchor 75: a batch uploads, then saves one command at a time under the lock, ties last, and sends nothing more after a save failed', () => {
  // The controller of adding pictures, read when this anchor asks for it: without the file this anchor fails, not every anchor of this
  // file. `lined` is a piece as its lines, without their indent, and `run` is one batch, from its first line to the brace that closes it.
  const hook = read('useMapImageAdd.ts');
  const lined = (source: string) => source.split('\n').map(line => line.trim()).filter(Boolean);
  const run = block(hook, 'async function run(plan: MapImagePlan, sources: readonly MapImageSource[]) {'), lines = lined(run);
  // A batch, in this order. One at a time, asked of a ref: a second can be asked for before `view` is drawn, and as state it would be a
  // render behind. The pictures go up one after another, each the file the plan names by its place in the list handed in: by the count
  // of the loop, a file refused ahead of it would send another picture under its name. The saves start only once the store and the
  // editor are at rest, so a start never cancels a drag, and the lock is the line right before the try of the saves: nothing comes
  // between it and the first command, where a press could land. One command at a time, and once a save failed the rest is not sent: the
  // line that stops has no condition before it (with one, ten pictures would wait ten times on a broken connection). The tie comes last,
  // on the library as the last command left it (read before the loop, it would not hold the backgrounds just saved), and only when there
  // is something to tie. The lock and the ref are let go in a finally: a throw would leave the editor locked, or no batch would start again.
  inOrder(run, 'if (running.current) return;', 'running.current = true;', 'const source = sources[item.index];', 'await uploadBackgroundImage(source.file)',
    'while (!quiet()) { await sleep(120); if (gone()) return; }', 'latest.current.lock(true);', 'for (const command of mapImageSaves(plan, uploads, new Date().toISOString(), uuid)) {',
    'await save(command,', 'stopped = why;', 'const library = useBackgroundStore.getState().snapshot;',
    'link = { place: plan.place, placeId: plan.placeId, cameraId: plan.cameraId, viewIds: [...plan.reused, ...added] };', 'if (mapImageLinkWanted(link, library)) {',
    'await latest.current.link(plan.mapId, link, library)', '} finally { latest.current.lock(false); }', 'running.current = false;');
  const locked = lines.indexOf('latest.current.lock(true);');
  assert.ok(locked > -1 && lines[locked + 1] === 'try {', 'the lock is not a line of its own right before the try of the saves');
  assert.ok(lines.some(line => line.startsWith('stopped = why;')), 'the rest is sent after a save failed, or held back only after some');
  assert.equal(lines[lines.lastIndexOf('} finally {') + 1], 'running.current = false;', 'the ref is not let go in the finally of the batch');
  // Each once, however the call is written: on `latest.current`, or on a `lock` read out of it first.
  assert.equal(count(hook, /\block\(true\)/g), 1, 'the editor is locked in another place');
  assert.equal(count(hook, /\block\(false\)/g), 1, 'the editor is let go in another place');
  // At rest: the store reads and saves nothing, and the editor (asked as it is rendered by then) drags, draws, names and opens nothing.
  // A save of this feature leaves no red line of the library up: the image list says why, in plain words. Never once the screen was left
  // or the account changed: the store may be another session's by then, and its library would pass for one that holds what was saved. A
  // reply that was lost is no failure when the library read again holds what was saved, and the batch goes on. The tie is told as the
  // editor answers it: what was tied in part stays a part.
  for (const line of ['const quiet = () => { const store = useBackgroundStore.getState(); return !store.loading && !store.pending && latest.current.idle(); };',
    'const hush = () => { if (!gone()) useBackgroundStore.setState({ error: null }); };',
    "catch (cause) { hush(); return !gone() && held(useBackgroundStore.getState().snapshot) ? '' : mapImageCauseText(cause); }",
    "tie = done.how === 'none' ? { link: done.complete ? 'none' : 'missed' } : { link: done.how, partial: !done.complete };"])
    assert.ok(lines.includes(line), `not a line of the batch: ${line}`);
  // The red line is put out where a save of this feature fails after it was sent, the save of a picture and the tie, and the store is
  // written nowhere else.
  assert.equal(count(hook, /useBackgroundStore\.setState\(/g), 1, 'the store is written in another place');
  assert.equal(count(hook, /\bhush\(\);/g), 2, 'the red line is not put out after the save of a picture and after the tie');
  // A batch that ended carries its tie, so that its line is read anew at every draw, and it scrolls nothing (its `seq` is left as it
  // is): it may end under a drag. Its outcome names the first background that was there already, counts what did not go in, and says
  // whether the pictures came as a file copied in Explorer.
  const ended = piece(run, 'setView(now => ({ ...now, running: false, jobs: [], recent:', '} finally {');
  assert.ok(ended.includes('...(link ? { live: { outcome, link } } : {})'), 'a batch that ended does not carry its tie');
  assert.ok(!ended.includes('seq'), 'the end of a batch brings the line into view');
  const outcome = piece(run, 'const outcome: MapImageOutcome = {', 'setView(now => ({ ...now, running: false');
  for (const text of ['reusedName: plan.reusedNames[0]', 'failed: failed.length', "byPath: sources.some(source => source.kind === 'path')"])
    assert.ok(outcome.includes(text), `not in the outcome of a batch: ${text}`);
  assert.equal(count(hook, /seq: now\.seq \+ 1/g), 2, 'the line is brought into view as a batch starts and as say speaks, and then alone');
  // Every wait is followed by a look at whether the screen is still there: after an upload that went and one that failed, in the wait
  // for rest, after each command, and after the saves. The look asks both, the screen and the account.
  assert.equal(count(hook, /if \(gone\(\)\) return;/g), 5, 'a wait is not followed by a look at the screen');
  const gone = lines.find(line => line.startsWith('const gone = '));
  assert.ok(!!gone && gone.includes('!alive.current') && gone.includes('actorId'), 'the look at the screen leaves out the screen or the account');
  // A file copied in Explorer is read by the main process and then goes up: an answer with no address throws, so no save is sent for a
  // picture that did not go up. The path of a file of the page never throws: a file with none has ''.
  assert.deepEqual(lined(block(hook, 'async function uploadFromPath(path: string): Promise<string> {')), ['async function uploadFromPath(path: string): Promise<string> {',
    'const read = await window.electronAPI.backgroundReadImageFile(path), result = await window.electronAPI.backgroundUploadImage(read.dataUrl);',
    "if (!result.ok || !result.url) throw new Error(result.error || '이미지를 올리지 못했습니다. 다시 시도해 주세요.');", 'return result.url;', '}']);
  assert.ok(hook.includes("export function mapImageFilePath(file: File): string { try { return window.electronAPI.getPathForFile(file) || ''; } catch { return ''; } }"),
    'the path of a file of the page can throw');
  // Nothing is sent at once, nothing is kept past the screen, no toast: a command goes out through the one call of the store, in `save`.
  for (const word of ['Promise.all', 'Promise.allSettled', 'localStorage', 'sonner', 'shut']) assert.ok(!hook.includes(word), `the controller has ${word}`);
  assert.equal(count(hook, /\.execute\(/g), 1, 'a command is sent past save');
  assert.ok(run.includes('latest.current.execute(command)'), 'a command is not sent by the editor as it is rendered by then');
  // 추가됨 leaves by itself, timed by the controller, and the timer goes with its effect.
  for (const line of ['const timer = window.setTimeout(() => setView(now => ({ ...now, marked: [] })), MAP_IMAGE_ADD.addedMarkMs);', 'return () => window.clearTimeout(timer);'])
    assert.ok(lined(hook).includes(line), `not a line of the controller: ${line}`);
  // Around the hook: the screen opens on no batch running, every id it saves is a new one, and the wait for rest hands the page back
  // between its looks (a wait that never did would freeze the screen while a drag, a polygon, the name box or a dialog keeps it busy).
  for (const line of ['export const MAP_IMAGE_IDLE: MapImageAddView = { mapId: null, running: false, jobs: [], notice: null, recent: [], marked: [], seq: 0 };',
    'const uuid = () => crypto.randomUUID();', 'const sleep = (ms: number) => new Promise<void>(done => window.setTimeout(done, ms));'])
    assert.ok(lined(hook).includes(line), `not a line of the controller: ${line}`);
  // And the body of the controller holds nothing else: the lines of the design as written, from the line that opens it to what it hands
  // back. A batch is started and left to run (`start`), and `say` and `dismiss` stay the same functions: the memo of the image list
  // depends on `dismiss`, and a new one at every draw would draw the whole list again at every move of a drag.
  assert.deepEqual(lined(piece(hook, 'say(mapId: string, text: string, failed?: { name: string; reason: string }[]): void; dismiss(): void } {', 'return { view, start, say, dismiss };')), [
    'say(mapId: string, text: string, failed?: { name: string; reason: string }[]): void; dismiss(): void } {',
    'const [view, setView] = useState<MapImageAddView>(MAP_IMAGE_IDLE);', 'const latest = useRef(deps); latest.current = deps;', 'const alive = useRef(true), running = useRef(false);',
    'useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);', 'useEffect(() => {', 'if (!view.marked.length) return;',
    'const timer = window.setTimeout(() => setView(now => ({ ...now, marked: [] })), MAP_IMAGE_ADD.addedMarkMs);', 'return () => window.clearTimeout(timer);', '}, [view.marked]);',
    'async function run(plan: MapImagePlan, sources: readonly MapImageSource[]) {', 'if (running.current) return;', 'running.current = true;', 'const actor = useBackgroundStore.getState().actorId;',
    'const gone = () => !alive.current || useBackgroundStore.getState().actorId !== actor;', 'const hush = () => { if (!gone()) useBackgroundStore.setState({ error: null }); };',
    'const step = (id: string, patch: Partial<MapImageJob>) => setView(now => ({ ...now, jobs: now.jobs.map(job => job.id === id ? { ...job, ...patch } : job) }));',
    'const failed = plan.refused.map(item => ({ name: item.name, reason: MAP_IMAGE_REFUSAL_TEXT[item.reason] }));',
    'const uploads: { viewId: string; name: string; imageUrl: string; sourceImagePath: string }[] = [], added: string[] = [];',
    "let tie: Pick<MapImageOutcome, 'link' | 'partial' | 'linkCause'> = { link: 'none' }, link: MapImageLink | null = null;",
    "setView(now => ({ ...now, mapId: plan.mapId, running: true, jobs: plan.items.map(item => ({ id: item.viewId, name: item.name, step: 'ready', imageUrl: '' })),",
    'notice: { mapId: plan.mapId, text: mapImageBusyText(plan.scope, plan.targetName, plan.items.length + plan.reused.length), failed: [] }, seq: now.seq + 1 }));', 'try {', 'for (const item of plan.items) {',
    'const source = sources[item.index];', "step(item.viewId, { step: 'uploading' });", 'try {',
    "const imageUrl = source.kind === 'file' ? await uploadBackgroundImage(source.file) : await uploadFromPath(source.path);", 'if (gone()) return;',
    'uploads.push({ viewId: item.viewId, name: item.name, imageUrl, sourceImagePath: source.path });', "step(item.viewId, { step: 'waiting', imageUrl });", '} catch (cause) {', 'if (gone()) return;',
    "failed.push({ name: item.name, reason: mapImageCauseText(cause) }); step(item.viewId, { step: 'failed' });", '}', '}', 'if (uploads.length || plan.reused.length) {',
    'const quiet = () => { const store = useBackgroundStore.getState(); return !store.loading && !store.pending && latest.current.idle(); };', 'while (!quiet()) { await sleep(120); if (gone()) return; }',
    'latest.current.lock(true);', 'try {', 'const save = async (command: BackgroundCommand, held: (library: BackgroundSnapshot) => boolean) => {', "try { await latest.current.execute(command); return ''; }",
    "catch (cause) { hush(); return !gone() && held(useBackgroundStore.getState().snapshot) ? '' : mapImageCauseText(cause); }", '};', "let stopped = '';",
    'for (const command of mapImageSaves(plan, uploads, new Date().toISOString(), uuid)) {', "if (command.type !== 'save') continue;",
    'const id = command.entity.id, job = uploads.find(upload => upload.viewId === id);',
    "if (stopped) { if (job) { failed.push({ name: job.name, reason: stopped }); step(id, { step: 'failed' }); } continue; }", "if (job) step(id, { step: 'saving' });",
    "const why = await save(command, library => (command.kind === 'place' ? library.places : library.views).some(item => item.id === id));", 'if (gone()) return;',
    'if (!why) { if (job) added.push(id); continue; }', "if (job) { failed.push({ name: job.name, reason: why }); step(id, { step: 'failed' }); }", 'stopped = why;', '}',
    'const library = useBackgroundStore.getState().snapshot;', 'link = { place: plan.place, placeId: plan.placeId, cameraId: plan.cameraId, viewIds: [...plan.reused, ...added] };',
    'if (mapImageLinkWanted(link, library)) {', 'try {', 'const done = await latest.current.link(plan.mapId, link, library);',
    "tie = done.how === 'none' ? { link: done.complete ? 'none' : 'missed' } : { link: done.how, partial: !done.complete };",
    "} catch (cause) { hush(); tie = { link: 'failed', linkCause: mapImageCauseText(cause) }; }", '}', '} finally { latest.current.lock(false); }', '}', 'if (gone()) return;',
    'const outcome: MapImageOutcome = { scope: plan.scope, targetName: plan.targetName, placeName: plan.placeName, added: added.length, reused: plan.reused.length, reusedName: plan.reusedNames[0],',
    "failed: failed.length, over: plan.over, byPath: sources.some(source => source.kind === 'path'), ...tie };",
    'setView(now => ({ ...now, running: false, jobs: [], recent: [...added, ...now.recent], marked: added,',
    'notice: { mapId: plan.mapId, text: mapImageSummary(outcome), failed, ...(link ? { live: { outcome, link } } : {}) } }));', '} finally {', 'running.current = false;',
    'if (alive.current) setView(now => now.running ? { ...now, running: false, jobs: [], notice: null } : now);', '}', '}',
    'const start = (plan: MapImagePlan, sources: readonly MapImageSource[]) => { void run(plan, sources); };',
    'const say = useCallback((mapId: string, text: string, failed: { name: string; reason: string }[] = []) => setView(now => ({ ...now, notice: { mapId, text, failed }, seq: now.seq + 1 })), []);',
    'const dismiss = useCallback(() => setView(now => now.running ? now : { ...now, notice: null }), []);',
  ]);
});

test('anchor 78: what is shown stays in the image list, motion stays in its block, the file dialog is one function, the new channel is four places, and the pure module is pure', () => {
  // The rules and the words of adding pictures are one pure module, read here when this anchor asks for it: its tests run it
  // under Node as it is, with no page, no React, no three.js and no alias of the bundler.
  const drop = read('mapImageDrop.ts');
  assert.doesNotMatch(drop, /from\s+['"]three/, 'the module of adding pictures imports three.js');
  for (const word of ['document.', 'window.', '@/', 'react']) assert.ok(!drop.includes(word), `the module of adding pictures reaches past itself: ${word}`);
  // What is saved and its checks, the drafts, the stack of the plan, the store and who sees the menu stay as they are: not a
  // line of them knows the feature, not a comment either (they are read as written), however it is written: mapImage, MapImage, MAP_IMAGE.
  const raw = (url: URL) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
  for (const name of ['types.ts', 'domain.ts', 'mapWorkflow.ts', 'mapDocument.ts', 'mapStack.ts', 'useBackgroundStore.ts'])
    assert.doesNotMatch(raw(new URL(name, directory)), /map_?image/i, `${name} knows the feature`);
  assert.doesNotMatch(raw(new URL('../src/features/playground/featureFlag.ts', import.meta.url)), /map_?image/i, 'featureFlag.ts knows the feature');
  // The new channel is four places, read as written: the handler, the main process, the bridge of the page and the type, and the mock of the preview.
  const lined = (source: string) => source.split('\n').map(line => line.trim()).filter(Boolean);
  const ipc = raw(new URL('../electron/backgroundIpc.ts', import.meta.url));
  assert.ok(ipc.includes("'background:read-clipboard-file'"), 'the main process has no channel for the path of a copied file');
  // A path of this PC and nothing more: the session is checked first, and neither the library nor a file is read.
  const clipboardHandler = piece(ipc, "deps.ipc.handle('background:read-clipboard-file'", '});');
  assert.ok(clipboardHandler.includes('originFor(requestEpoch);'), 'the channel answers a page of a replaced session');
  assert.ok(!clipboardHandler.includes('deps.store.read('), 'the channel reads the library');
  // The path comes from the format that has it. The function is cut out alone: the head comment of its file names the format that is always empty.
  const filePathOf = block(raw(new URL('../electron/clipboardFiles.ts', import.meta.url)), 'export function clipboardImageFilePath(readBuffer: (format: string) => Buffer): string | null {');
  assert.ok(filePathOf.includes("readBuffer('FileNameW')"), 'the path of a copied file is not read from FileNameW');
  assert.ok(!filePathOf.includes('CF_HDROP'), 'the path of a copied file is read from a format that is always empty');
  const main = raw(new URL('../electron/main.ts', import.meta.url));
  assert.ok(main.includes('readClipboardFilePath: () => clipboardImageFilePath(format => clipboard.readBuffer(format)),'), 'the main process hands the channel no reader of the clipboard');
  // The channel of the character board is left as it was, to the letter.
  assert.deepEqual(lined(block(main, "ipcMain.handle('clipboard:read-image-file', async () => {")), [
    "ipcMain.handle('clipboard:read-image-file', async () => {", 'try {', "const target = parseFileNameWBuffer(clipboard.readBuffer('FileNameW'));", 'if (!target) return null;',
    'const mime = imageMimeForPath(target);', 'if (!mime) return null; // 첫 파일이 이미지가 아니면 무시 (psd/moho/txt 등)', 'const stat = await fs.promises.stat(target);',
    'if (!stat.isFile() || stat.size > CLIPBOARD_IMAGE_FILE_MAX_BYTES) return null;', 'const data = await fs.promises.readFile(target);', 'return {', 'fileName: path.basename(target),',
    "dataUrl: `data:${mime};base64,${data.toString('base64')}`,", '};', '} catch (err) {', "console.warn('[clipboard] read-image-file 실패:', err);", 'return null;', '}', '}',
  ]);
  // The bridge of the page asks the channel and nothing picks files there: the file dialog of the installed app is the page's own.
  const preload = raw(new URL('../electron/preload.ts', import.meta.url));
  assert.ok(preload.includes("backgroundReadClipboardFile: () => ipcRenderer.invoke('background:read-clipboard-file', canonicalSessionEpoch),"), 'the page cannot ask for the path of a copied file');
  assert.ok(!preload.includes('backgroundPickImages'), 'the installed app picks files past the page');
  const types = raw(new URL('../src/types/index.ts', import.meta.url));
  assert.ok(types.includes('backgroundReadClipboardFile: () => Promise<{ filePath: string } | null>;'), 'the type of the new channel is missing');
  assert.ok(types.includes('backgroundPickImages?: () => Promise<File[] | undefined>;'), 'the picker of the preview is not optional');
  // The mock answers from its hook, and in the check window of the app engine it hands an empty list instead of a file dialog.
  const mock = raw(new URL('../src/mocks/devElectronAPI.ts', import.meta.url));
  for (const word of ['backgroundReadClipboardFile', '__bflowMockBackgroundAdd']) assert.ok(mock.includes(word), `the preview has no ${word}`);
  assert.ok(mock.includes('backgroundPickImages: async () => { const hook = (window as DevPreviewWindow).__bflowMockBackgroundAdd; return hook?.pick ? hook.pick() : /\\bElectron\\//.test(navigator.userAgent) ? [] : undefined; },'),
    'the picker of the preview can open a file dialog in the app engine');
  // What is shown of adding pictures, in the stylesheet, line by line and as written. The column of the map is the box the sheet of a drag
  // is laid on: it gets a position, and it still cuts what overflows it without becoming a scroll box (anchor 54).
  const lines = sheetLines(), has = (rule: string[], ...parts: string[]) => { for (const item of parts) assert.ok(rule.includes(item), `not declared: ${item} (${rule.join('; ')})`); };
  const column = lines[lineOf(lines, '.bmap-main {')];
  has(declarations(column), 'position:relative', 'overflow:clip');
  assert.ok(!column.includes('overflow:hidden'), 'the column of the map is a scroll box');
  // The rules of the line, the ghosts and 추가됨, the button, the sheet, the choices of the place prompt and the second paragraph of the
  // question of 편집 끝내기, and the two keyframes outside the block of motion: each once, as a line of its own, from its very start.
  const rules = [
    '.bmap-gallery-notice { display:flex; flex:0 1 auto; gap:8px; min-height:40px; margin:0 18px 8px; padding:6px 6px 6px 12px; border:1px solid rgb(var(--color-accent) / .35); border-radius:8px; background:rgb(var(--color-accent) / .08); font-size:12px; line-height:1.6; }',
    '.bmap-gallery-notice>div { flex:1; min-width:0; min-height:0; max-height:62px; overflow-y:auto; overflow-wrap:anywhere; }',
    '.bmap-gallery-notice ul { margin:2px 0 0; padding:0; list-style:none; color:#ed7e79; }',
    '[data-color-mode="light"] .bmap-gallery-notice ul { color:#b3362f; }',
    '.bg-library .bmap-gallery-notice button { flex-shrink:0; align-self:flex-start; width:26px; min-height:26px; padding:0; border:0; background:transparent; color:rgb(var(--color-text-secondary)); font-size:15px; }',
    '.bg-library .bmap-gallery-add[aria-disabled="true"],.bg-library .bmap-gallery-add[aria-disabled="true"]:hover { color:rgb(var(--color-text-secondary) / .5); background:transparent; border-color:transparent; cursor:default; }',
    '.bg-library .bmap-gallery-ghost,.bg-library .bmap-gallery-ghost:hover { position:relative; border-style:dashed; border-color:rgb(var(--color-bg-border)); }',
    '.bmap-gallery-ghost .bg-thumbnail { opacity:.55; }',
    '.bg-library .bmap-gallery-ghost[data-step="failed"] { border-color:rgb(237 126 121 / .55); }',
    '.bmap-gallery-step { position:absolute; inset:0 0 auto; z-index:1; height:3px; background:rgb(var(--color-bg-border) / .6); }',
    '.bmap-gallery-step>i { display:block; height:100%; background:rgb(var(--color-accent-sub)); transform-origin:left center; transform:scaleX(var(--bmap-step,0)); }',
    '[data-color-mode="light"] .bmap-gallery-step>i { background:rgb(var(--color-text-secondary)); }',
    '.bg-library .bmap-gallery-card.is-added { position:relative; border-color:rgb(var(--color-accent-sub) / .8); }',
    '.bmap-gallery-mark { position:absolute; top:9px; left:6px; z-index:1; padding:1px 7px; border:1px solid rgb(var(--color-accent-sub)); border-radius:999px; background:rgb(var(--color-bg-card)); color:rgb(var(--color-text-primary)); font-size:10px; font-weight:600; }',
    '.bmap-drop { position:absolute; inset:0; z-index:6; display:flex; justify-content:center; align-items:flex-start; border:2px dashed rgb(var(--color-accent-sub)); background:rgb(var(--color-bg-primary) / .55); pointer-events:none; }',
    '.bmap-drop-label { position:sticky; top:35%; display:flex; flex-direction:column; align-items:center; gap:4px; max-width:min(520px,calc(100% - 32px)); margin:0; padding:12px 18px; border:1px solid rgb(var(--color-accent-sub) / .6); border-radius:10px; background:rgb(var(--color-bg-card)); font-size:12px; text-align:center; }',
    '.bmap-drop-label>strong { max-width:100%; overflow-wrap:anywhere; font-size:14px; font-weight:650; }',
    '.bmap-drop[data-blocked] { border-color:rgb(237 126 121 / .7); }',
    '.bmap-drop[data-blocked] .bmap-drop-label { border-color:rgb(237 126 121 / .6); }',
    '.bmap-place-choices { display:flex; flex-direction:column; gap:8px; min-width:0; margin:12px 0; padding:0; border:0; }',
    '.bmap-place-choice { display:flex; align-items:flex-start; gap:10px; font-size:12px; line-height:1.7; color:rgb(var(--color-text-secondary)); cursor:pointer; }',
    '.bmap-place-choice strong { display:block; font-size:13px; font-weight:550; color:rgb(var(--color-text-primary)); }',
    '.bmap-place-choice input { flex-shrink:0; margin-top:5px; accent-color:rgb(var(--color-accent)); }',
    '.bg-modal-content>.bmap-confirm-text+.bmap-confirm-text { margin-top:8px; }',
    '@keyframes bmap-drop-in { from { opacity:0; } }',
    '@keyframes bmap-rise-in { from { opacity:0; transform:translateY(6px); } }',
  ];
  for (const rule of rules) assert.equal(lines.filter(line => line === rule).length, 1, `not once, as a line of its own: ${rule}`);
  // The sheet takes no room and no press: the map does not move as a drag comes in, and every event of the drag reaches what is under it.
  // Its words stay in the part of the tab that is on screen, and a long name wraps there: cut with an ellipsis, what the pictures become is lost.
  has(baseRule(lines, '.bmap-drop {'), 'position:absolute', 'inset:0', 'pointer-events:none');
  has(baseRule(lines, '.bmap-drop-label {'), 'position:sticky');
  const titleRule = lines[lineOf(lines, '.bmap-drop-label>strong {')];
  has(declarations(titleRule), 'overflow-wrap:anywhere');
  for (const word of ['text-overflow', 'nowrap']) assert.ok(!titleRule.includes(word), `the title of the sheet is cut: ${word}`);
  // The line keeps one height whether its button is there or not, gives way down to that height where the list is low (its words scroll
  // inside), and breaks a long file name anywhere rather than scroll sideways.
  const noticeRule = lines[lineOf(lines, '.bmap-gallery-notice {')];
  has(declarations(noticeRule), 'min-height:40px', 'flex:0 1 auto');
  for (const word of ['align-items', 'flex-shrink:0']) assert.ok(!noticeRule.includes(word), `the line of the image list does not give way: ${word}`);
  has(baseRule(lines, '.bmap-gallery-notice>div {'), 'min-height:0', 'max-height:62px', 'overflow-wrap:anywhere');
  // The bar of a step is out of the flow (a ghost is no taller than a card), and on a light page it is drawn in the colour of the secondary
  // words: the accent is lost on its ground there.
  has(baseRule(lines, '.bmap-gallery-step {'), 'position:absolute');
  assert.ok(lines.includes('[data-color-mode="light"] .bmap-gallery-step>i { background:rgb(var(--color-text-secondary)); }'), 'the bar of a step cannot be seen on a light page');
  // 추가됨 is words in the colours of a card, ringed by the accent: white words on the accent cannot be read under every theme.
  const markRule = lines[lineOf(lines, '.bmap-gallery-mark {')];
  has(declarations(markRule), 'background:rgb(var(--color-bg-card))', 'color:rgb(var(--color-text-primary))');
  assert.ok(!markRule.includes('#fff'), 'the mark is white words');
  // Only the picture of a ghost is faded: faded whole, its small words sink into the ground.
  assert.deepEqual(lines.filter(line => line.includes('bmap-gallery-ghost') && line.includes('opacity')), ['.bmap-gallery-ghost .bg-thumbnail { opacity:.55; }']);
  // What moves is declared in a block of its own for those who want motion, after the block of the band (anchor 54 reads the first one as
  // the band's), and that block holds the four lines alone: a keyframe inside it is no rule, and the build warns. No new class moves elsewhere.
  const fresh = /bmap-drop|bmap-gallery-ghost|bmap-gallery-notice|bmap-gallery-step|bmap-gallery-mark|bmap-gallery-add|bmap-place-choice|is-added/;
  const named = lines.flatMap((line, at) => !line.trimStart().startsWith('/*') && fresh.test(line) ? [at] : []);
  const calm = lines.flatMap((line, at) => line === '@media (prefers-reduced-motion: no-preference) {' ? [at] : []);
  assert.equal(calm.length, 2, 'the motion of adding pictures has no block of its own beside the one of the band');
  const motionAt = calm[1], motionEnd = lines.indexOf('}', motionAt);
  for (const at of named) if (/animation|transition/.test(lines[at])) assert.ok(motionAt < at && at < motionEnd, `moves whatever the motion setting: ${lines[at]}`);
  assert.deepEqual(lines.slice(motionAt + 1, motionEnd).map(line => line.trim()), ['.bmap-drop { animation:bmap-drop-in var(--motion-fast) var(--ease-out) both; }',
    '.bmap-drop-label { animation:bmap-rise-in var(--motion-base) var(--ease-out) both; }', '.bmap-gallery-card.is-added { animation:bmap-rise-in var(--motion-base) var(--ease-out) both; }',
    '.bmap-gallery-step>i { transition:transform var(--motion-base) var(--ease-out); }']);
  const bandMotion = lines.findIndex(line => line.trimStart().startsWith('.bmap-edit-strip>* { animation:'));
  assert.ok(bandMotion > -1 && bandMotion < motionAt, 'the block of adding pictures comes before the block of the band');
  // Nothing of it blurs what is behind it, repeats or slants.
  for (const line of new Set([...rules, column, ...named.map(at => lines[at])])) assert.doesNotMatch(line, /backdrop-filter|infinite|font-style/, line);
  // The image list, read without its comments. A batch and its line belong to one map, or to the map on show once theirs is gone. A picture
  // saved while its batch runs is drawn once, as its ghost. While a save runs the line is read against the library as it was before that
  // save, and it says how the batch stands now: its link saved since or taken back, its pictures deleted.
  const gallery = read('BackgroundMapGallery.tsx'), listed = lined(gallery);
  for (const line of ['const mine = (mapId: string | null | undefined) => !!mapId && (mapId === current.id || !maps.some(map => map.id === mapId));',
    'const jobs = mine(adding.mapId) ? adding.jobs : MAP_IMAGE_IDLE.jobs, notice = mine(adding.notice?.mapId) ? adding.notice : null;',
    'const scopedViews = useMemo(() => selectMapBackgroundViews(snapshot, maps, current, selected).filter(view => !jobs.some(job => job.id === view.id)), [snapshot, maps, current, selected, jobs]);',
    'const confirmed = useRef(snapshot);', 'if (!saving) confirmed.current = snapshot;',
    'const noticeText = notice?.live ? mapImageSummary(mapImageOutcomeNow(notice.live.outcome, notice.live.link, confirmed.current.maps.find(map => map.id === notice.mapId), notice.mapId === current.id ? current : undefined, confirmed.current)) : notice?.text;'])
    assert.ok(listed.includes(line), `not a line of the image list: ${line}`);
  const noticeLine = listed.find(line => line.startsWith('const noticeText = ')) ?? '';
  for (const text of ['mapImageOutcomeNow(', 'confirmed.current']) assert.ok(noticeLine.includes(text), `the line of a batch is not read as it stands now: ${text}`);
  for (const text of ['snapshot.maps', 'mapImageLinkNow(']) assert.ok(!noticeLine.includes(text), `the line of a batch is read past the confirmed library or past its pictures: ${text}`);
  // Brought into view as a batch starts and as the line speaks up, never as a batch ends nor on a mere redraw, and in this one place.
  const seen = listed.indexOf('const seen = useRef(adding.seq);');
  assert.ok(seen > -1, 'the image list keeps no count of what it brought into view');
  assert.deepEqual(listed.slice(seen, seen + 7), ['const seen = useRef(adding.seq);', 'useEffect(() => {', 'if (adding.seq === seen.current) return;', 'seen.current = adding.seq;',
    'if (adding.running && resultsRef.current) resultsRef.current.scrollTop = 0;', "noticeRef.current?.scrollIntoView({ block: 'nearest' });", '}, [adding.seq]);']);
  assert.equal(count(gallery, /scrollIntoView/g), 1, 'the image list brings something into view in another place');
  // ＋ 이미지 추가: the mock of the preview is asked first and what it answers is taken, an empty list too; only no answer at all opens the
  // dialog. The hidden input reads its files before it is emptied, and takes several. The dialog is opened in that one function, and never
  // for a blocked target.
  const pick = listed.indexOf('const pickImages = () => {');
  assert.ok(pick > -1, 'the image list has no way to pick files');
  assert.deepEqual(listed.slice(pick, pick + 5), ['const pickImages = () => {', 'const mock = window.electronAPI.backgroundPickImages;', 'if (!mock) { input.current?.click(); return; }',
    'void mock().then(files => { if (files) onAddFiles?.(files); else input.current?.click(); });', '};']);
  assert.ok(listed.includes(`<input ref={input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="추가할 그림 파일" tabIndex={-1} onChange={event => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (files.length) onAddFiles?.(files); }} />`),
    'the hidden input of the file dialog is not as written');
  assert.equal(count(gallery, /input\.current\?\.click\(\)/g), 2, 'the file dialog is opened past pickImages');
  assert.ok(piece(gallery, '<button type="button" className="bmap-gallery-add"', '</button>').includes('onClick={() => { if (!words.blocked) pickImages(); }}'), 'the button opens the file dialog for a blocked target');
  // The button names what the list names: one target, read from what the editor shows.
  assert.equal(count(gallery, /resolveMapImageTarget\(/g), 1, 'the image list reads a target twice');
  assert.ok(gallery.includes('resolveMapImageTarget(snapshot, maps, current, selected)'), 'the target of the button is not what the list names');
  // What is read out, and what the list has no business with. The hint of an empty list stays as anchor 58 reads it.
  assert.ok(gallery.includes("!snapshot.canManage ? '관리자가 도면이나 공간에 연결한 배경이 여기에 표시됩니다.' : selected?.type === 'camera' ? '도면을 편집하면서 이 카메라에 배경 시점을 연결해 주세요.' : '도면 설정에서, 또는 도면을 편집하면서 공간에 배경 장소를 연결하면 여기에 모입니다.'"),
    'the hint of an empty list is not as anchor 58 reads it');
  for (const text of ['{MAP_IMAGE_HINT}', 'role="status"', 'role="alert"', 'aria-disabled={words.blocked}', 'aria-label="안내 닫기"', '{noticeText}'])
    assert.ok(gallery.includes(text), `not in the image list: ${text}`);
  for (const text of ['{notice.text}', '편집 시작', 'sonner', 'createObjectURL']) assert.ok(!gallery.includes(text), `in the image list: ${text}`);
  // A ghost: its bar and its step at the top of the card, where a low list still shows them, the picture between, and below it the two
  // lines a card will have. And a card just added says so in words, not by its colour alone.
  const ghost = piece(gallery, 'className="bmap-gallery-card bmap-gallery-ghost"', '</div>)}');
  inOrder(ghost, 'className="bmap-gallery-step"', 'className="bg-thumbnail"', 'className="bmap-gallery-mark"', 'className="bmap-gallery-card-body"');
  assert.ok(ghost.includes('<span className="bmap-gallery-mark">{MAP_IMAGE_STEPS[job.step].label} · {index + 1}/{jobs.length}</span>'), 'the step of a ghost is not told as written');
  assert.ok(gallery.includes('{added && <span className="bmap-gallery-mark">추가됨</span>}'), 'a card just added is told by its colour alone');
});
