import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import type { GanttProject, GanttTask } from '../src/features/gantt/types.ts';

type ElementProps = {
  children?: ReactNode; value?: string; type?: string; 'aria-label'?: string;
  onClick?: () => void; onChange?: (event: {target: {value: string}}) => void;
  onSubmit?: (event: {preventDefault(): void}) => void;
};
type Element = ReactElement<ElementProps>;
type Patch = Partial<Omit<GanttTask, 'color'>> & Partial<Omit<GanttProject, 'color'>> & {color?: string | null};
type MenuProps = {
  target: {project: GanttProject; task: GanttTask | null; x: number; y: number};
  canEdit: boolean; onClose(): void; onDetail(): void; onComplete(): void;
  onSave(patch: Patch): Promise<void>;
};

const task: GanttTask = {
  id: 'task', parentId: null, kind: 'task', title: '원래 작업', memo: '',
  startDate: '2026-09-05', endDate: '2026-09-07', allDay: true, startTime: '', endTime: '',
  mode: 'manual', predecessorId: null, progress: 0, progressMode: 'manual', sceneLinks: [],
  workers: [], attendees: [], color: '#74B9FF', calendarId: null, calendarEventId: null,
  completed: false, sortOrder: 0,
};
const project: GanttProject = {
  id: 'project', spaceId: 'space', ownerId: 'owner', name: '원래 프로젝트', memo: '프로젝트 메모',
  color: '#A29BFE', completed: false, revision: 1, memberIds: null, editorIds: null,
  linkedEpisode: null, tasks: [task],
};

const bundle = build({
  entryPoints: ['src/features/gantt/GanttDialogs.tsx'], bundle: true, format: 'cjs',
  platform: 'node', target: 'node22', write: false,
  external: ['react', 'react/jsx-runtime', 'react-dom', 'lucide-react', '@/utils/glassStyles'],
});

// Use the existing calendar UI harness pattern: keep real component handlers and
// React elements, while replacing DOM-only effects and preserving hook state.
async function harness(targetTask: GanttTask | null = task, failSave = false) {
  const states: unknown[] = [], refs: unknown[] = [];
  let stateCursor = 0, refCursor = 0, closeCount = 0;
  const saved: Patch[] = [];
  const nodeRequire = createRequire(import.meta.url);
  const react = nodeRequire('react');
  const module = {exports: {} as {GanttContextMenu?: (props: MenuProps) => ReactNode}};
  new Function('require', 'module', 'exports', 'document', (await bundle).outputFiles[0].text)(
    (id: string) => {
      if (id === 'react') return {...react,
        useState(initial: unknown) {
          const slot = stateCursor++;
          if (!(slot in states)) states[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
          return [states[slot], (next: unknown) => {states[slot] = typeof next === 'function' ? (next as (previous: unknown) => unknown)(states[slot]) : next;}];
        },
        useRef(initial: unknown) {const slot = refCursor++;return refs[slot] ??= {current: initial};},
        useEffect() {}, useLayoutEffect() {},
      };
      if (id === 'react-dom') return {createPortal: (child: ReactNode) => child};
      if (id === 'lucide-react') return {X: () => null};
      if (id === '@/utils/glassStyles') return {floatingGlassStyle: {}};
      return nodeRequire(id);
    }, module, module.exports, {body: {}},
  );
  const props: MenuProps = {
    target: {project, task: targetTask, x: 20, y: 20}, canEdit: true,
    onClose() {closeCount++;}, onDetail() {}, onComplete() {},
    async onSave(patch) {if (failSave) throw new Error('저장 실패');saved.push(patch);},
  };
  return {
    render() {stateCursor = 0;refCursor = 0;return module.exports.GanttContextMenu!(props);},
    saved, closed: () => closeCount, allowSave: () => {failSave = false;},
    replaceTarget(nextProject: GanttProject, nextTask: GanttTask | null) {props.target = {...props.target, project: nextProject, task: nextTask};},
  };
}
function elements(node: ReactNode, type: string): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [...(node.type === type ? [element] : []), ...elements(element.props.children, type)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement(node) ? text((node.props as ElementProps).children) : '';
}
function button(tree: ReactNode, name: string) {
  const found = elements(tree, 'button').find(element => element.props['aria-label'] === name || text(element) === name);
  assert.ok(found, `${name} button exists`);return found;
}
function field(tree: ReactNode, label: string) {
  const found = elements(tree, 'label').find(element => text(element).startsWith(label));
  assert.ok(found, `${label} field exists`);
  const input = [...elements(found, 'input'), ...elements(found, 'textarea')][0];
  assert.ok(input);return input;
}
function change(tree: ReactNode, label: string, value: string) {field(tree, label).props.onChange!({target: {value}});}
async function settle() {await Promise.resolve();await Promise.resolve();}
async function submit(tree: ReactNode) {elements(tree, 'form')[0].props.onSubmit!({preventDefault() {}});await settle();}

test('task quick edit keeps title, memo, dates and color until one save', async () => {
  const h = await harness();button(h.render(), '빠른 편집').props.onClick!();
  let tree = h.render();change(tree, '제목', '변경한 작업');change(tree, '메모', '작업 메모');
  change(tree, '시작일', '2026-09-06');change(tree, '종료일', '2026-09-09');
  tree = h.render();button(tree, '색상 #FDCB6E').props.onClick!();await settle();
  assert.deepEqual(h.saved, [], 'choosing a color must not save or discard the form');
  assert.equal(h.closed(), 0);
  tree = h.render();assert.equal(field(tree, '제목').props.value, '변경한 작업');
  await submit(tree);
  assert.deepEqual(h.saved, [{title: '변경한 작업', memo: '작업 메모', startDate: '2026-09-06', endDate: '2026-09-09', color: '#FDCB6E'}]);
  assert.equal(h.closed(), 1);
});

test('inherit color stays in the task draft and preserves an empty task memo', async () => {
  const h = await harness();button(h.render(), '빠른 편집').props.onClick!();
  change(h.render(), '제목', '상위 색상 작업');
  button(h.render(), '상위 색상 따르기').props.onClick!();await settle();
  assert.deepEqual(h.saved, []);assert.equal(h.closed(), 0);
  await submit(h.render());
  assert.deepEqual(h.saved, [{title: '상위 색상 작업', memo: '', startDate: '2026-09-05', endDate: '2026-09-07', color: null}]);
});

test('project quick edit saves its name, memo and selected color together', async () => {
  const h = await harness(null);button(h.render(), '빠른 편집').props.onClick!();
  let tree = h.render();change(tree, '제목', '새 프로젝트 이름');change(tree, '메모', '새 프로젝트 메모');
  button(h.render(), '색상 #FDCB6E').props.onClick!();await settle();
  assert.deepEqual(h.saved, []);assert.equal(h.closed(), 0);
  await submit(h.render());
  assert.deepEqual(h.saved, [{name: '새 프로젝트 이름', memo: '새 프로젝트 메모', color: '#FDCB6E'}]);
});

test('menu mode still saves colors immediately without replacing other fields', async () => {
  for (const [name, color] of [['색상 #FDCB6E', '#FDCB6E'], ['상위 색상 따르기', null]] as const) {
    const h = await harness();button(h.render(), name).props.onClick!();await settle();
    assert.deepEqual(h.saved, [{color}]);assert.equal(h.closed(), 1);
  }
});

test('failed combined save keeps every draft field for retry', async () => {
  const h = await harness(task, true);button(h.render(), '빠른 편집').props.onClick!();
  change(h.render(), '제목', '다시 저장할 작업');button(h.render(), '색상 #FDCB6E').props.onClick!();
  await submit(h.render());assert.equal(h.closed(), 0);assert.deepEqual(h.saved, []);
  assert.equal(field(h.render(), '제목').props.value, '다시 저장할 작업');
  h.allowSave();await submit(h.render());
  assert.equal(h.saved[0].title, '다시 저장할 작업');assert.equal(h.saved[0].color, '#FDCB6E');assert.equal(h.closed(), 1);
});

test('canonical revision updates do not replace a failed quick edit draft', async () => {
  const h = await harness(task, true);button(h.render(), '빠른 편집').props.onClick!();
  let tree = h.render();change(tree, '제목', '보존할 제목');change(tree, '메모', '보존할 메모');
  button(h.render(), '색상 #FDCB6E').props.onClick!();await submit(h.render());
  const canonicalTask = {...task, title: '서버 제목', memo: '다른 사용자의 메모', color: '#00B894'};
  h.replaceTarget({...project, revision: 2, tasks: [canonicalTask]}, canonicalTask);
  tree = h.render();
  assert.equal(field(tree, '제목').props.value, '보존할 제목');
  assert.equal(field(tree, '메모').props.value, '보존할 메모');
  assert.equal((button(tree, '색상 #FDCB6E').props as {'aria-pressed'?: boolean})['aria-pressed'], true);
  assert.equal(h.closed(), 0);assert.deepEqual(h.saved, []);
});
