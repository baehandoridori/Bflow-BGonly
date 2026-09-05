import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { applyCommand, shiftDate } from '../src/features/gantt/domain.ts';
import type { GanttCommand, GanttProject, GanttSnapshot, GanttTask } from '../src/features/gantt/types.ts';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const A = id(1), B = id(2), READ_ONLY = id(3), OUTER = id(10), GROUP = id(11), NEXT_GROUP = id(12), TASK = id(13), NEXT_TASK = id(14), READ_GROUP = id(15);
const row = (taskId: string, kind: GanttTask['kind'], parentId: string | null, sortOrder: number): GanttTask => ({
  id: taskId, kind, parentId, title: taskId, memo: '', sortOrder,
  startDate: '2026-09-05', endDate: '2026-09-07', allDay: true, startTime: '', endTime: '',
  mode: 'manual', predecessorId: null, progress: 0, progressMode: 'manual', sceneLinks: [],
  workers: [], attendees: [], color: null, calendarId: null, calendarEventId: null, completed: false,
});
function fixture(): GanttSnapshot {
  const project = (projectId: string, name: string, tasks: GanttTask[], readonly = false): GanttProject => ({
    id: projectId, name, spaceId: id(readonly ? 21 : 20), ownerId: readonly ? 'other' : 'me',
    memo: '', color: '#A29BFE', completed: false, revision: 1, memberIds: null, editorIds: null, linkedEpisode: null, tasks,
  });
  return {
    spaces: [
      {id: id(20), name: '내 폴더', ownerId: 'me', shared: false, members: [], revision: 1},
      {id: id(21), name: '보기 폴더', ownerId: 'other', shared: true, members: [{userId: 'me', canEdit: false}], revision: 1},
    ],
    projects: [
      project(A, '신입 교육', []),
      project(B, '이번 주 제작', [row(OUTER, 'group', null, 0), row(GROUP, 'group', OUTER, 10), row(NEXT_GROUP, 'group', OUTER, 20), {...row(TASK, 'task', GROUP, 10), startDate: '2026-09-08', endDate: '2026-09-10'}, {...row(NEXT_TASK, 'task', GROUP, 20), startDate: '2026-09-11', endDate: '2026-09-13'}]),
      project(READ_ONLY, '보기 전용 프로젝트', [row(READ_GROUP, 'group', null, 0)], true),
    ],
  };
}
type Props = {children?: ReactNode; value?: string; disabled?: boolean; 'aria-label'?: string; onClick?: () => void; onChange?: (event: {target: {value: string}}) => void};
type Element = ReactElement<Props>;
type CanvasProps = {selected: string[]; statusFilter: string; onSelect(projectId: string, taskId: string | null, multiple?: boolean): void; onAdd(project: GanttProject, parentId: string|null, start: string, end: string): void; onMenu(project:GanttProject,task:GanttTask|null,x:number,y:number):void};
type InspectorProps = {displayProgress?:number;onAddChild(): void; onDelete(): void; onComplete():void; onSaveTask(patch: Partial<GanttTask>): Promise<void>};
const bundle = build({
  entryPoints: ['src/features/gantt/GanttView.tsx'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react', '@/stores/useAuthStore', '@/stores/useDataStore', '@/stores/useCalendarStore', '@/utils/calcStats', './useGanttStore', './GanttCanvas', './GanttDialogs', './GanttInspector', './gantt.css'],
});

function elements(node: ReactNode, type?: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(child => elements(child, type));
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [...(type === undefined || node.type === type ? [element] : []), ...elements(element.props.children, type)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement(node) ? text((node.props as Props).children) : '';
}
function button(tree: ReactNode, label: string) {
  const found = elements(tree, 'button').find(node => text(node) === label);
  assert.ok(found, `${label} button exists`);return found;
}
function projectPicker(tree: ReactNode) {
  const found = elements(tree, 'select').find(node => node.props['aria-label'] === '작업을 추가할 프로젝트');
  assert.ok(found, 'creation project combobox exists');return found;
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

// As in the calendar UI tests, run real view handlers and state transitions.
// Storage is a boundary adapter; domain validation and project permissions stay real.
async function harness() {
  const states: unknown[] = [], refs: unknown[] = [], effectDeps: Array<readonly unknown[] | undefined> = [];
  let stateCursor = 0, refCursor = 0, effectCursor = 0, changed = false;
  let effects: Array<() => unknown> = [];
  const commands: GanttCommand[] = [];
  const state = {
    snapshot: fixture(), actorId: 'me', pending: false, loading: false, error: null,
    canUndo: false, canRedo: false, async initialize() {}, async refresh() {}, async undo() {}, async redo() {},
    async execute(command: GanttCommand) {commands.push(structuredClone(command));state.snapshot = applyCommand(state.snapshot, 'me', command);},
  };
  const store = Object.assign(() => state, {getState: () => state});
  const calendarState = {calendars: [], async loadAll() {}};
  const calendarStore = Object.assign((selector: (value: typeof calendarState) => unknown) => selector(calendarState), {getState: () => calendarState});
  const Canvas = () => null, Inspector = () => null, Context = () => null, SpaceDialog = () => null, Empty = () => null;
  const nodeRequire = createRequire(import.meta.url), react = nodeRequire('react');
  const module = {exports: {} as {GanttView?: () => ReactNode}};
  new Function('require', 'module', 'exports', 'window', 'localStorage', 'setInterval', 'clearInterval', (await bundle).outputFiles[0].text)(
    (name: string) => {
      if (name === 'react') return {...react,
        useState(initial: unknown) {
          const slot = stateCursor++;
          if (!(slot in states)) states[slot] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
          return [states[slot], (next: unknown) => {
            const value = typeof next === 'function' ? (next as (previous: unknown) => unknown)(states[slot]) : next;
            if (!Object.is(value, states[slot])) {states[slot] = value;changed = true;}
          }];
        },
        useRef(initial: unknown) {const slot = refCursor++;return refs[slot] ??= {current: initial};},
        useMemo(factory: () => unknown) {return factory();}, useCallback(fn: unknown) {return fn;},
        useEffect(effect: () => unknown, deps?: readonly unknown[]) {
          const slot = effectCursor++, previous = effectDeps[slot];
          if (!deps || !previous || deps.length !== previous.length || deps.some((value, index) => !Object.is(value, previous[index]))) effects.push(effect);
          effectDeps[slot] = deps;
        },
      };
      if (name === '@/stores/useAuthStore') return {useAuthStore: (selector: (value: unknown) => unknown) => selector({currentUser: {id: 'me', name: '사용자'}, users: [{id: 'me', name: '사용자'}]})};
      if (name === '@/stores/useDataStore') return {useDataStore: (selector: (value: unknown) => unknown) => selector({episodes: []})};
      if (name === '@/stores/useCalendarStore') return {useCalendarStore: calendarStore};
      if (name === '@/utils/calcStats') return {sceneProgress: () => 0};
      if (name === './useGanttStore') return {useGanttStore: store};
      if (name === './GanttCanvas') return {GanttCanvas: Canvas, localDate: () => '2026-09-05', moveDate: shiftDate};
      if (name === './GanttDialogs') return {GanttContextMenu: Context, GanttModal: Empty, GanttSpaceDialog: SpaceDialog};
      if (name === './GanttInspector') return {GanttInspector: Inspector};
      if (name === './gantt.css') return {};
      if (name === 'lucide-react') return new Proxy({}, {get: () => Empty});
      return nodeRequire(name);
    }, module, module.exports, {addEventListener() {}, removeEventListener() {}}, {getItem: () => null, setItem() {}}, () => 0, () => {},
  );
  return {
    commands,
    setPending(value: boolean) {state.pending = value;},
    render() {
      let tree: ReactNode;
      for (let pass = 0; pass < 10; pass++) {
        changed = false;stateCursor = 0;refCursor = 0;effectCursor = 0;tree = module.exports.GanttView!();
        const queued = effects;effects = [];queued.forEach(effect => effect());
        if (!changed) return tree;
      }
      throw new Error('view did not settle');
    },
    canvas(tree: ReactNode): CanvasProps {const found = elements(tree, Canvas)[0];assert.ok(found);return found.props as unknown as CanvasProps;},
    inspector(tree: ReactNode): InspectorProps {const found = elements(tree, Inspector)[0];assert.ok(found);return found.props as unknown as InspectorProps;},
    context(tree:ReactNode) {const found=elements(tree,Context)[0];assert.ok(found);return found.props as unknown as {onDelete():void;completed:boolean};},
    folder(tree:ReactNode) {const found=elements(tree,SpaceDialog)[0];assert.ok(found);return found.props as unknown as {onDelete():Promise<void>;projectCount:number};},
    snapshot:()=>state.snapshot,
    latestProject(projectId: string) {const found = state.snapshot.projects.find(project => project.id === projectId);assert.ok(found);return found;},
  };
}
function addedTask(h: Awaited<ReturnType<typeof harness>>, beforeIds: Set<string>, projectId: string): GanttTask {
  const added = h.latestProject(projectId).tasks.filter(task => !beforeIds.has(task.id));
  assert.equal(added.length, 1, 'exactly one task is created in the requested project');return added[0];
}

test('selecting a group changes the creation project and adds a child in that group', async () => {
  const h = await harness();let tree = h.render();
  assert.equal(projectPicker(tree).props.value, A, 'fixture initially creates in the first editable project');
  h.canvas(tree).onSelect(B, GROUP);tree = h.render();
  assert.equal(projectPicker(tree).props.value, B, 'the selected group owns the creation project');
  const before = new Set(h.latestProject(B).tasks.map(task => task.id));
  button(tree, '+ 작업').props.onClick!();await settle();
  const child = addedTask(h, before, B);
  assert.equal(child.parentId, GROUP);
  assert.equal(child.startDate, '2026-09-08', 'a new child starts at the selected group derived start');
  assert.equal(child.endDate, '2026-09-10', 'the initial child duration remains three inclusive days');
  assert.equal(h.latestProject(A).tasks.length, 0, 'the previous project receives no accidental task');
});

test('adding a group creates a sibling and the next task becomes the new group child', async () => {
  const h = await harness();let tree = h.render();
  projectPicker(tree).props.onChange!({target: {value: B}});tree = h.render();
  h.canvas(tree).onSelect(B, GROUP);tree = h.render();
  const before = new Set(h.latestProject(B).tasks.map(task => task.id));
  button(tree, '+ 그룹').props.onClick!();await settle();
  const group = addedTask(h, before, B);assert.equal(group.kind, 'group');assert.equal(group.parentId, OUTER);
  tree = h.render();const beforeTask = new Set(h.latestProject(B).tasks.map(task => task.id));
  button(tree, '+ 작업').props.onClick!();await settle();
  assert.equal(addedTask(h, beforeTask, B).parentId, group.id, 'the newly created group becomes the active insertion target');
});

test('adding after a selected task inserts immediately after it within the same parent', async () => {
  const h = await harness();let tree = h.render();
  projectPicker(tree).props.onChange!({target: {value: B}});tree = h.render();
  h.canvas(tree).onSelect(B, TASK);tree = h.render();
  const before = new Set(h.latestProject(B).tasks.map(task => task.id));
  button(tree, '+ 작업').props.onClick!();await settle();
  const task = addedTask(h, before, B);assert.equal(task.parentId, GROUP);
  assert.equal(task.startDate, '2026-09-08', 'a sibling starts on the selected task date');
  assert.equal(task.endDate, '2026-09-10');
  const siblings = h.latestProject(B).tasks.filter(row => row.parentId === GROUP).sort((a, b) => a.sortOrder - b.sortOrder).map(row => row.id);
  assert.deepEqual(siblings, [TASK, task.id, NEXT_TASK], 'insertion follows the selected sibling instead of the project end');
});

test('explicit project selection clears the previous task insertion target', async () => {
  const h = await harness();let tree = h.render();h.canvas(tree).onSelect(B, GROUP);tree = h.render();
  projectPicker(tree).props.onChange!({target: {value: A}});tree = h.render();
  assert.equal(h.canvas(tree).selected.includes(GROUP), false, 'an explicit project choice clears the old group selection');
  button(tree, '+ 작업').props.onClick!();await settle();
  assert.equal(h.latestProject(A).tasks.length, 1);assert.equal(h.latestProject(A).tasks[0].parentId, null);
  assert.equal(h.latestProject(B).tasks.length, 5);
});

test('a read-only selected project cannot silently create in another editable project', async () => {
  const h = await harness();let tree = h.render();h.canvas(tree).onSelect(READ_ONLY, READ_GROUP);tree = h.render();
  const add = button(tree, '+ 작업');
  if (!add.props.disabled) add.props.onClick!();
  await settle();
  assert.deepEqual(h.commands, [], 'no fallback write is sent for a read-only selection');
  assert.equal(add.props.disabled, true, 'creation is disabled until the user explicitly chooses an editable project');
});

test('saving keeps the selected creation project visible while creation is disabled', async () => {
  const h = await harness();let tree = h.render();
  projectPicker(tree).props.onChange!({target: {value: B}});tree = h.render();
  h.canvas(tree).onSelect(B, GROUP);h.render();h.setPending(true);tree = h.render();
  const picker = projectPicker(tree);
  assert.equal(picker.props.value, B, 'pending does not erase the current project choice');
  assert.ok(elements(picker, 'option').some(option => option.props.value === B), 'the selected project remains an available option');
  assert.equal(button(tree, '+ 작업').props.disabled, true, 'a second creation waits until the pending write finishes');
  assert.deepEqual(h.commands, []);
});

test('inspector child creation uses the selected group start date', async () => {
  const h = await harness();let tree = h.render();h.canvas(tree).onSelect(B, GROUP);tree = h.render();
  const before = new Set(h.latestProject(B).tasks.map(task => task.id));
  h.inspector(tree).onAddChild();await settle();
  const child = addedTask(h, before, B);
  assert.equal(child.parentId, GROUP);
  assert.equal(child.startDate, '2026-09-08', 'inspector and toolbar use the same selected group date');
  assert.equal(child.endDate, '2026-09-10');
});

test('adding and deleting a group child immediately reschedules its automatic successor', async () => {
  const h=await harness(),project=h.latestProject(B),group=row(GROUP,'group',null,0),child={...row(TASK,'task',GROUP,0),startDate:'2026-09-05',endDate:'2026-09-05'},successor={...row(NEXT_TASK,'task',null,1),mode:'auto' as const,predecessorId:GROUP,startDate:'2026-09-06',endDate:'2026-09-06'};
  project.tasks=[group,child,successor];let tree=h.render();
  h.canvas(tree).onAdd(project,GROUP,'2026-09-10','2026-09-12');await settle();
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)?.startDate,'2026-09-13');
  const added=h.latestProject(B).tasks.find(t=>![GROUP,TASK,NEXT_TASK].includes(t.id))!;
  tree=h.render();h.canvas(tree).onSelect(B,added.id);tree=h.render();h.inspector(tree).onDelete();tree=h.render();button(tree,'확인').props.onClick!();await settle();
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)?.startDate,'2026-09-06');
});

test('moving a child to another group reschedules the former group successor', async () => {
  const h=await harness(),project=h.latestProject(B),group=row(GROUP,'group',null,0),other=row(NEXT_GROUP,'group',null,1),early={...row(TASK,'task',GROUP,0),startDate:'2026-09-05',endDate:'2026-09-05'},late={...row(OUTER,'task',GROUP,1),startDate:'2026-09-10',endDate:'2026-09-12'},successor={...row(NEXT_TASK,'task',null,2),mode:'auto' as const,predecessorId:GROUP,startDate:'2026-09-13',endDate:'2026-09-13'};
  project.tasks=[group,other,early,late,successor];let tree=h.render();h.canvas(tree).onSelect(B,OUTER);tree=h.render();await h.inspector(tree).onSaveTask({parentId:NEXT_GROUP});
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)?.startDate,'2026-09-06');
});

test('deleting the last-ending child moves an automatic successor back in the same save', async () => {
  const h=await harness(),project=h.latestProject(B),group=row(GROUP,'group',null,0),early={...row(TASK,'task',GROUP,0),startDate:'2026-09-05',endDate:'2026-09-05'},late={...row(OUTER,'task',GROUP,1),startDate:'2026-09-10',endDate:'2026-09-12'},successor={...row(NEXT_TASK,'task',null,2),mode:'auto' as const,predecessorId:GROUP,startDate:'2026-09-13',endDate:'2026-09-13'};
  project.tasks=[group,early,late,successor];let tree=h.render();h.canvas(tree).onSelect(B,OUTER);tree=h.render();h.inspector(tree).onDelete();tree=h.render();button(tree,'확인').props.onClick!();await settle();
  assert.equal(h.latestProject(B).tasks.some(t=>t.id===OUTER),false);assert.equal(h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)?.startDate,'2026-09-06');
});

test('completion keeps the task selected and inspector open in the default all view', async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.inspector(tree).onComplete();await settle();tree=h.render();
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)?.completed,true);
  assert.equal(h.canvas(tree).statusFilter,'all');
  assert.deepEqual(h.canvas(tree).selected,[TASK]);
  assert.ok(h.inspector(tree),'completion must not dismiss the active task');
  assert.equal(h.latestProject(B).tasks.length,5,'completion preserves the full project');
});

test('reopening a project preserves its individual completed and partial tasks', async()=>{
  const h=await harness(),project=h.latestProject(B);project.completed=true;
  project.tasks.find(t=>t.id===TASK)!.completed=true;project.tasks.find(t=>t.id===TASK)!.progress=100;
  project.tasks.find(t=>t.id===NEXT_TASK)!.progress=65;
  let tree=h.render();h.canvas(tree).onSelect(B,null);tree=h.render();h.inspector(tree).onComplete();await settle();
  assert.equal(h.latestProject(B).completed,false);
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)?.completed,true);
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)?.progress,65);
});

test('context delete removes its target rather than the previously selected task', async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.canvas(tree).onMenu(h.latestProject(B),h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)!,50,50);tree=h.render();
  h.context(tree).onDelete();tree=h.render();button(tree,'확인').props.onClick!();await settle();
  assert.ok(h.latestProject(B).tasks.some(t=>t.id===TASK));
  assert.equal(h.latestProject(B).tasks.some(t=>t.id===NEXT_TASK),false);
});

test('folder deletion rejects a folder containing projects and always requires empty authority state', async()=>{
  const h=await harness();let tree=h.render();
  const settings=elements(tree,'button').find(e=>e.props['aria-label']==='내 폴더 설정')!;assert.ok(settings);
  (settings.props.onClick as (e:any)=>void)({preventDefault(){}});tree=h.render();
  assert.equal(h.folder(tree).projectCount,2);
  await assert.rejects(h.folder(tree).onDelete(),/프로젝트/);
  assert.equal(h.commands.length,0);
  h.snapshot().projects=h.snapshot().projects.filter(p=>p.spaceId!==id(20));
  tree=h.render();await h.folder(tree).onDelete();
  assert.deepEqual(h.commands,[{type:'deleteSpace',spaceId:id(20),expectedRevision:1,requireEmpty:true}]);
});

test('group inspector progress includes unfinished empty groups rather than showing 100 percent',async()=>{
  const h=await harness();h.latestProject(B).tasks=[row(OUTER,'group',null,0),row(GROUP,'group',OUTER,0),{...row(TASK,'task',OUTER,1),completed:true,progress:100}];
  let tree=h.render();h.canvas(tree).onSelect(B,OUTER);tree=h.render();
  assert.equal(h.inspector(tree).displayProgress,50);
});
