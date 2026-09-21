import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

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
