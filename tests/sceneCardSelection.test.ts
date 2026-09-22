import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { selectSceneCard } from '../src/utils/sceneCardSelection.ts';
import { buildSingleSceneSelectionId } from '../src/utils/sceneSelectionId.ts';

const viewSource = readFileSync('src/views/ScenesView.tsx', 'utf8');
const unifiedSource = readFileSync('src/components/scenes/UnifiedSceneCard.tsx', 'utf8');
function findNode(source: string, predicate: (node: ts.Node) => boolean): ts.Node {
  const file = ts.createSourceFile('component.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found: ts.Node | undefined;
  function visit(node: ts.Node) { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); }
  visit(file); assert.ok(found, 'production handler exists'); return found;
}
const namedFunction = (name: string) => findNode(viewSource, node => ts.isFunctionDeclaration(node) && node.name?.text === name).getText();
const compile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function cardParents(tag: string): ts.JsxSelfClosingElement[] {
  const file = ts.createSourceFile('view.tsx', viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const matches: ts.JsxSelfClosingElement[] = [];
  function visit(node: ts.Node) { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === tag) matches.push(node); ts.forEachChild(node, visit); }
  visit(file); return matches;
}
function parentProps(node: ts.JsxSelfClosingElement, context: Record<string, unknown>) {
  const props: Record<string, unknown> = {};
  for (const attr of node.attributes.properties) {
    if (!ts.isJsxAttribute(attr) || !['onSelect', 'onCtrlSelect', 'onShiftSelect', 'onCtrlClick', 'onShiftClick'].includes(attr.name.getText())) continue;
    const expression = (attr.initializer as ts.JsxExpression).expression!;
    props[attr.name.getText()] = new Function(...Object.keys(context), compile(`return (${expression.getText()});`))(...Object.values(context));
  }
  return props;
}

test('both actual unified card parents wire Shift range selection instead of falling back to a single scene', () => {
  const parents = cardParents('UnifiedSceneCard'); assert.equal(parents.length, 2);
  for (const parent of parents) {
    const shift = parent.attributes.properties.find(attr => ts.isJsxAttribute(attr) && attr.name.getText() === 'onShiftSelect');
    assert.ok(shift, 'flat and layout-group parents must pass the Shift callback');
  }
});

/** Parent JSX callbacks + parent selection handler + child handler are all production code. */
function parentHarness(mode: 'single' | 'unified', parentIndex: number) {
  let selection = new Set<string>();
  const all = ['a', 'b', 'c', 'd'].map(id => ({ id, mergedKey: id, sceneId: id, bgScene: {} as object | null, actScene: {} as object | null }));
  let visible = all, groups: Array<[string, typeof all]> | null = null;
  const anchor = { current: null as string | null };
  const parent = cardParents(mode === 'single' ? 'SceneCard' : 'UnifiedSceneCard')[parentIndex];
  assert.ok(parent);
  const handlerNode = findNode(viewSource, node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleCardSelection') as ts.VariableDeclaration;
  const click = (id: string, keys: Record<string, boolean> = {}) => {
    const scene = all.find(row => row.id === id)!;
    const context = {
      selectedDepartment: mode === 'unified' ? 'all' : 'bg', mergedLayoutGroups: groups, layoutGroups: groups,
      mergedScenes: visible, scenes: visible, currentPart: { sheetName: 'sheet', scenes: all },
      bgPart: {}, actPart: {}, lastClickedSceneKeyRef: anchor, selectSceneCard, buildSingleSceneSelectionId,
      useAppStore: { getState: () => ({ selectedSceneIds: selection }) }, setSelectedScenes: (next: Set<string>) => { selection = next; },
    };
    const handleCardSelection = new Function(...Object.keys(context), compile(`return (${handlerNode.initializer!.getText()});`))(...Object.values(context));
    const callbacks = parentProps(parent, { m: scene, selectionId: buildSingleSceneSelectionId('sheet', scene, all.indexOf(scene)), handleCardSelection });
    // Single-card ordinary mouseup resets selection before its click (covered above).
    if (mode === 'single' && !keys.ctrlKey && !keys.metaKey && !keys.shiftKey) selection = new Set();
    clickHandler(mode, callbacks)({ ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, ...keys });
  };
  return { click, order(ids: string[]) { visible = ids.map(id => all.find(row => row.id === id)!); groups = null; },
    layout(ids: string[][]) { groups = ids.map((group, i) => [String(i), group.map(id => all.find(row => row.id === id)!)]); },
    keys: () => all.filter(row => selection.has(mode === 'unified' ? `bg:${row.id}` : buildSingleSceneSelectionId('sheet', row, all.indexOf(row)))).map(row => row.id),
    ids: () => [...selection], anchor: () => anchor.current,
    missing(id: string, department: 'bgScene' | 'actScene') { all.find(row => row.id === id)![department] = null; },
  };
}

for (const mode of ['single', 'unified'] as const) for (const parentIndex of [0, 1]) {
  test(`${mode} actual parent ${parentIndex}: inclusive forward/reverse range and repeated Shift retain the click anchor`, () => {
    const h = parentHarness(mode, parentIndex);
    h.click('b'); const anchor = h.anchor(); h.click('d', { shiftKey: true }); assert.deepEqual(h.keys(), ['b', 'c', 'd']);
    h.click('a', { shiftKey: true }); assert.deepEqual(h.keys(), ['a', 'b', 'c', 'd']); assert.equal(h.anchor(), anchor);
    const reverse = parentHarness(mode, parentIndex); reverse.click('d'); reverse.click('b', { shiftKey: true }); assert.deepEqual(reverse.keys(), ['b', 'c', 'd']);
    if (mode === 'unified') assert.equal(reverse.ids().length, 6, 'BG and ACT selection IDs remain paired');
  });
  test(`${mode} actual parent ${parentIndex}: Ctrl coexists, filtered sort and cross-layout ranges follow displayed rows`, () => {
    const h = parentHarness(mode, parentIndex);
    h.click('a'); h.click('d', { ctrlKey: true }); h.click('c', { shiftKey: true }); assert.deepEqual(h.keys(), ['a', 'c', 'd']);
    h.click('d', { ctrlKey: true }); assert.deepEqual(h.keys(), ['a', 'c']);
    const sorted = parentHarness(mode, parentIndex); sorted.order(['d', 'b', 'a']); sorted.click('d'); sorted.click('a', { shiftKey: true }); assert.deepEqual(sorted.keys(), ['a', 'b', 'd']);
    const grouped = parentHarness(mode, parentIndex); grouped.layout([['c', 'a'], ['d', 'b']]); grouped.click('a'); grouped.click('b', { shiftKey: true }); assert.deepEqual(grouped.keys(), ['a', 'b', 'd']);
  });
  test(`${mode} actual parent ${parentIndex}: missing or filtered-out anchor safely selects the target and establishes a new anchor`, () => {
    const h = parentHarness(mode, parentIndex); h.click('c', { shiftKey: true }); assert.deepEqual(h.keys(), ['c']); assert.ok(h.anchor());
    h.click('a', { shiftKey: true }); assert.deepEqual(h.keys(), ['a', 'b', 'c']);
    const hidden = parentHarness(mode, parentIndex); hidden.click('a'); hidden.order(['d', 'b', 'c']); hidden.click('b', { shiftKey: true }); assert.deepEqual(hidden.keys(), ['a', 'b']);
    const anchor = hidden.anchor(); hidden.click('c', { shiftKey: true }); assert.deepEqual(hidden.keys(), ['a', 'b', 'c']); assert.equal(hidden.anchor(), anchor);
  });
}
for (const parentIndex of [0, 1]) test(`unified actual parent ${parentIndex}: absent department scenes never produce selection IDs`, () => {
  const h = parentHarness('unified', parentIndex);
  h.missing('a', 'actScene'); h.missing('b', 'bgScene');
  h.click('a'); assert.deepEqual(h.ids(), ['bg:a']);
  h.click('b', { shiftKey: true }); assert.deepEqual(h.ids(), ['bg:a', 'act:b']);
  h.click('b', { ctrlKey: true }); assert.deepEqual(h.ids(), ['bg:a']);
});

function clickHandler(mode: 'single' | 'unified', callbacks: Record<string, unknown>) {
  const source = mode === 'single' ? viewSource.slice(viewSource.indexOf('function SceneCard(')) : unifiedSource;
  const node = findNode(source, node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleClick') as ts.VariableDeclaration;
  return new Function(...Object.keys(callbacks), compile(`return (${node.initializer!.getText()});`))(...Object.values(callbacks));
}
function doubleClickHandler(mode: 'single' | 'unified', callbacks: Record<string, unknown>) {
  const source = mode === 'single' ? viewSource.slice(viewSource.indexOf('function SceneCard(')) : unifiedSource;
  const handler = mode === 'single'
    ? ((findNode(source, node => ts.isJsxAttribute(node) && node.name.getText() === 'onDoubleClick') as ts.JsxAttribute).initializer as ts.JsxExpression).expression!
    : (findNode(source, node => ts.isVariableDeclaration(node) && node.name.getText() === 'handleDoubleClick') as ts.VariableDeclaration).initializer!;
  return new Function(...Object.keys(callbacks), compile(`return (${handler.getText()});`))(...Object.values(callbacks));
}

/** Execute the actual production hook and click handlers with native event ordering. */
function harness(mode: 'single' | 'unified') {
  let selection = new Set<string>(), last = 'a';
  const events = new Map<string, Set<(event: any) => void>>(), containerEvents = new Map<string, (event: any) => void>();
  const cards = ['a', 'b', 'c'].map((id, index) => ({
    id, getBoundingClientRect: () => ({ left: index * 100, right: index * 100 + 80, top: 0, bottom: 80 }),
    closest: (selector: string) => selector === '[data-scene-id]' ? cards[index] : null,
    parentElement: null,
  }));
  const container = { scrollTop: 0, scrollLeft: 0, querySelectorAll: () => cards,
    addEventListener: (name: string, callback: any) => containerEvents.set(name, callback),
    removeEventListener: (name: string) => containerEvents.delete(name),
  };
  const document = {
    addEventListener(name: string, callback: any) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(callback); },
    removeEventListener(name: string, callback: any) { events.get(name)?.delete(callback); },
  };
  const useEffect = (fn: () => unknown) => fn(), useRef = (current: unknown) => ({ current }), useState = (value: unknown) => [value, () => {}];
  const hook = new Function('useEffect', 'useRef', 'useState', 'document', 'getComputedStyle', compile(`${namedFunction('findScrollParent')}\n${namedFunction('useLassoSelection')}\nreturn useLassoSelection;`))(useEffect, useRef, useState, document, () => ({ overflowY: 'visible' }));
  hook({ current: container }, '[data-scene-id]', (card: any) => card.id,
    (ids: Set<string>, shift: boolean, baseline: Set<string>) => { selection = shift ? new Set([...baseline, ...ids]) : ids; }, true, () => selection);
  const fire = (name: string, event: unknown) => [...(events.get(name) ?? [])].forEach(callback => callback(event));
  const event = (id: string, keys: Record<string, boolean>) => ({ target: cards.find(card => card.id === id), button: 0, clientX: ['a','b','c'].indexOf(id) * 100 + 20, clientY: 20, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...keys });
  const click = (id: string, keys: Record<string, boolean> = {}, move = 0) => {
    const e = event(id, keys);
    containerEvents.get('mousedown')!(e);
    if (move) fire('mousemove', { ...e, clientX: e.clientX + move, clientY: e.clientY + move });
    fire('mouseup', e);
    const toggle = () => { if (selection.has(id)) selection.delete(id); else selection.add(id); last = id; };
    const range = () => { const ids = ['a','b','c']; for (let i = Math.min(ids.indexOf(last), ids.indexOf(id)); i <= Math.max(ids.indexOf(last), ids.indexOf(id)); i++) selection.add(ids[i]); last = id; };
    clickHandler(mode, mode === 'single' ? { onCtrlClick: toggle, onShiftClick: range } : { onCtrlSelect: toggle, onSelect: () => { selection = new Set([id]); last = id; }, onShiftSelect: range })(e);
  };
  return { click, ids: () => [...selection].sort(),
    shiftLasso() { const e = { ...event('b', { shiftKey: true }), target: { closest: () => null, parentElement: null } }; containerEvents.get('mousedown')!(e); fire('mousemove', { ...e, clientX: 270, clientY: 70 }); fire('mouseup', e); },
  };
}

for (const mode of ['single', 'unified'] as const) {
  test(`${mode} scene card: plain click then Ctrl/Meta click retains first selection despite small pointer movement`, () => {
    for (const key of ['ctrlKey', 'metaKey']) {
      const h = harness(mode); h.click('a'); assert.deepEqual(h.ids(), ['a']);
      h.click('b', { [key]: true }, 9); assert.deepEqual(h.ids(), ['a', 'b']);
      h.click('b', { [key]: true }, 9); assert.deepEqual(h.ids(), ['a'], 'modifier click removes only its target');
    }
  });
  test(`${mode} scene card: stationary additive clicks, Shift range and Shift lasso keep their existing selection`, () => {
    const h = harness(mode); h.click('a'); h.click('b', { ctrlKey: true }); assert.deepEqual(h.ids(), ['a', 'b']);
    h.click('a'); h.click('c', { shiftKey: true }); assert.deepEqual(h.ids(), ['a', 'b', 'c']);
    h.click('a'); h.shiftLasso(); assert.deepEqual(h.ids(), ['a', 'b', 'c']);
  });
  test(`${mode} scene card: normal double click still selects the card and opens its detail once`, () => {
    const h = harness(mode); h.click('a'); h.click('a');
    let opened = 0, stopped = 0;
    const open = () => { opened++; };
    doubleClickHandler(mode, mode === 'single' ? { onOpenDetail: open } : {
      onOpenMerged: open, merged: {}, bgScene: null, actScene: null, bgSheetName: null, actSheetName: null,
      bgSceneIndex: 0, actSceneIndex: 0, onOpenDetail: open,
    })({ stopPropagation() { stopped++; }, currentTarget: {} });
    assert.deepEqual(h.ids(), ['a']); assert.equal(opened, 1); assert.equal(stopped, 1);
  });
}
