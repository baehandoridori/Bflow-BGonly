import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { applyCommand, shiftDate } from '../src/features/gantt/domain.ts';
import { InspectorAutosave } from '../src/features/gantt/inspectorAutosave.ts';
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
type Props = {children?: ReactNode; value?: string; label?:string; options?:unknown[]; disabled?: boolean; 'aria-label'?: string; onClick?: () => void; onChange?: (event: {target: {value: string}}) => void};
type Element = ReactElement<Props>;
type CanvasProps = {selected: string[]; statusFilter: string; projects:GanttProject[]; collapsed:string[]; onCollapse(id:string):void; onSelect(projectId: string, taskId: string | null, multiple?: boolean): void; onAdd(project: GanttProject, parentId: string|null, start: string, end: string): void; onMenu(project:GanttProject,task:GanttTask|null,x:number,y:number):void; onShiftGroup(project:GanttProject,group:GanttTask,days:number):void};
type InspectorProps = {displayProgress?:number;onAddChild(): void; onDelete(): void; onComplete():void; onSaveTask(patch: Partial<GanttTask>, expectedRevision?:number): Promise<GanttProject|void>;onDraftProgress(projectId:string,taskId:string,progress:number|null):void;onRegisterCloseGuard(guard:(()=>Promise<boolean>)|null):void};
const bundle = build({
  entryPoints: ['src/features/gantt/GanttView.tsx'], bundle: true, format: 'cjs', platform: 'node', target: 'node22', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react', '@/stores/useAuthStore', '@/stores/useDataStore', '@/stores/useCalendarStore', '@/utils/calcStats', './useGanttStore', './GanttCanvas', './GanttDialogs', './GanttInspector', './GanttSelect', './GanttTree', './gantt.css'],
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
  const found = elements(tree).find(node => node.props.label === '작업을 추가할 프로젝트');
  assert.ok(found, 'creation project combobox exists');return found;
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

// As in the calendar UI tests, run real view handlers and state transitions.
// Storage is a boundary adapter; domain validation and project permissions stay real.
async function harness(storage = new Map<string,string>()) {
  const listeners=new Map<string,Set<(event:any)=>void>>();
  const states: unknown[] = [], refs: unknown[] = [], effectDeps: Array<readonly unknown[] | undefined> = [];
  const effectCleanups:Array<undefined|(()=>void)>=[];
  let stateCursor = 0, refCursor = 0, effectCursor = 0, changed = false;
  let effects: Array<() => unknown> = [];
  const commands: GanttCommand[] = [];
  let writeDelay:Promise<void>|null=null;
  const state = {
    snapshot: fixture(), actorId: 'me', pending: false, loading: false, error: null,
    canUndo: false, canRedo: false, async initialize() {}, async refresh() {}, async undo() {}, async redo() {},
    async execute(command: GanttCommand) {commands.push(structuredClone(command));state.snapshot = applyCommand(state.snapshot, 'me', command);const delay=writeDelay;writeDelay=null;if(delay){state.pending=true;await delay;state.pending=false;}},
  };
  const store = Object.assign(() => state, {getState: () => state});
  const calendarState = {calendars: [] as {id:string;canEdit:boolean}[], async loadAll() {}};
  const calendarStore = Object.assign((selector: (value: typeof calendarState) => unknown) => selector(calendarState), {getState: () => calendarState});
  const Canvas = () => null, Inspector = () => null, Context = () => null, SpaceDialog = () => null, Empty = () => null, Select=()=>null, Tree=()=>null;
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
          if (!deps || !previous || deps.length !== previous.length || deps.some((value, index) => !Object.is(value, previous[index]))) effects.push(()=>{effectCleanups[slot]?.();const cleanup=effect();effectCleanups[slot]=typeof cleanup==='function'?cleanup as ()=>void:undefined;});
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
      if (name === './GanttSelect') return {GanttSelect:Select};
      if (name === './GanttTree') return {GanttTree:Tree};
      if (name === './gantt.css') return {};
      if (name === 'lucide-react') return new Proxy({}, {get: () => Empty});
      return nodeRequire(name);
    }, module, module.exports, {addEventListener(type:string,callback:(event:any)=>void) {if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type)!.add(callback);}, removeEventListener(type:string,callback:(event:any)=>void) {listeners.get(type)?.delete(callback);}}, {getItem: (key:string) => storage.get(key)??null, setItem(key:string,value:string) {storage.set(key,value);}}, () => 0, () => {},
  );
  return {
    commands,
    storage,
    keydown(event:any){listeners.get('keydown')?.forEach(listener=>listener(event));},
    delayNextWrite(){let release!:()=>void;writeDelay=new Promise<void>(resolve=>{release=resolve;});return release;},
    setPending(value: boolean) {state.pending = value;},
    setActor(value: string) {state.actorId = value;},
    setCalendars(value: {id:string;canEdit:boolean}[]) {calendarState.calendars=value;},
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
    navigation(tree:ReactNode) {const found=elements(tree,Tree)[0];assert.ok(found);return found.props as any;},
    snapshot:()=>state.snapshot,
    latestProject(projectId: string) {const found = state.snapshot.projects.find(project => project.id === projectId);assert.ok(found);return found;},
  };
}
function addedTask(h: Awaited<ReturnType<typeof harness>>, beforeIds: Set<string>, projectId: string): GanttTask {
  const added = h.latestProject(projectId).tasks.filter(task => !beforeIds.has(task.id));
  assert.equal(added.length, 1, 'exactly one task is created in the requested project');return added[0];
}

test('navigation branch and folder folds never change chart folds or visibility',async()=>{
  const h=await harness();let tree=h.render();
  for(const branch of [GROUP,B]){
    h.navigation(tree).onToggleBranch(branch);tree=h.render();
    assert.ok(h.navigation(tree).collapsed.includes(branch));assert.deepEqual(h.canvas(tree).collapsed,[]);
  }
  h.navigation(tree).onToggleFolder(id(20));tree=h.render();
  assert.deepEqual(h.navigation(tree).closedSpaces,[id(20)]);assert.deepEqual(h.canvas(tree).collapsed,[]);
  assert.equal(h.canvas(tree).projects.length,3);
  h.canvas(tree).onCollapse(OUTER);tree=h.render();
  assert.deepEqual(h.canvas(tree).collapsed,[OUTER]);assert.deepEqual(h.navigation(tree).collapsed,[GROUP,B]);
  h.navigation(tree).onToggleVisibility(B);tree=h.render();
  assert.ok(!h.canvas(tree).projects.some(project=>project.id===B),'only the eye control changes chart visibility');
  assert.equal(h.commands.length,0,'folds are local view preferences, never project mutations');
});

test('legacy folds migrate once and both surfaces restore their own preferences',async()=>{
  const storage=new Map([['bflow-gantt-view:me',JSON.stringify({collapsed:[B,GROUP],closedSpaces:[id(20)],hidden:[READ_ONLY]})]]);
  const first=await harness(storage);let tree=first.render();
  assert.deepEqual(first.canvas(tree).collapsed,[B,GROUP]);assert.deepEqual(first.navigation(tree).collapsed,[B,GROUP]);
  first.navigation(tree).onToggleBranch(B);tree=first.render();first.canvas(tree).onCollapse(GROUP);tree=first.render();
  const second=await harness(storage);tree=second.render();
  assert.deepEqual(second.canvas(tree).collapsed,[B]);assert.deepEqual(second.navigation(tree).collapsed,[GROUP]);
  assert.deepEqual(second.navigation(tree).closedSpaces,[id(20)]);assert.ok(!second.canvas(tree).projects.some(project=>project.id===READ_ONLY));
});

test('broken local preferences safely default to open branches',async()=>{
  for(const raw of ['null','{','[]',JSON.stringify({collapsed:'wrong',treeCollapsed:[null,42,GROUP],hidden:{}})]){
    const h=await harness(new Map([['bflow-gantt-view:me',raw]])),tree=h.render();
    assert.deepEqual(h.canvas(tree).collapsed,[]);assert.equal(h.canvas(tree).projects.length,3);
    assert.ok(h.navigation(tree).collapsed.every((value:unknown)=>typeof value==='string'));
  }
});

test('creating and moving work reveals the destination without unfolding navigation',async()=>{
  const h=await harness();let tree=h.render();
  h.navigation(tree).onToggleBranch(B);tree=h.render();h.navigation(tree).onToggleFolder(id(20));tree=h.render();
  h.canvas(tree).onSelect(B,GROUP);tree=h.render();
  for(const branch of [B,OUTER,GROUP]){h.canvas(tree).onCollapse(branch);tree=h.render();}
  button(tree,'+ 작업').props.onClick!();await settle();tree=h.render();
  assert.deepEqual(h.canvas(tree).collapsed,[]);assert.deepEqual(h.navigation(tree).collapsed,[B]);assert.deepEqual(h.navigation(tree).closedSpaces,[id(20)]);
  h.navigation(tree).onToggleBranch(A);tree=h.render();h.canvas(tree).onCollapse(A);tree=h.render();
  const source=h.latestProject(B),target=h.latestProject(A);
  (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();tree=h.render();
  assert.ok(!h.canvas(tree).collapsed.includes(A));assert.deepEqual(h.navigation(tree).collapsed,[B,A]);assert.deepEqual(h.navigation(tree).closedSpaces,[id(20)]);
  assert.doesNotMatch(text(tree),/새 작업 위치|저장했습니다|작업 위치를 변경했습니다|작업 순서를 변경했습니다/);
});

test('quiet successful edits still display a failed move as an actionable error',async()=>{
  const h=await harness();let tree=h.render();const source=h.latestProject(B),target=structuredClone(h.latestProject(A));h.latestProject(A).revision++;
  (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();tree=h.render();
  assert.match(text(tree),/다른 변경이 반영되었습니다/);
  const dismiss=elements(tree,'button').find(node=>node.props['aria-label']==='오류 안내 닫기');assert.ok(dismiss);
  dismiss.props.onClick!();tree=h.render();assert.doesNotMatch(text(tree),/다른 변경이 반영되었습니다/);
  assert.equal(h.commands.length,0);
});

test('tooltip keys and consumed Escape never dismiss the selected inspector',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.keydown({key:'Escape',target:{closest:(selector:string)=>selector.includes('[role=tooltip]')?{}:null}});tree=h.render();
  assert.deepEqual(h.canvas(tree).selected,[TASK]);assert.ok(h.inspector(tree));
  h.keydown({key:'Escape',defaultPrevented:true,target:{closest:()=>null}});tree=h.render();
  assert.deepEqual(h.canvas(tree).selected,[TASK]);assert.ok(h.inspector(tree));
  h.keydown({key:'Escape',target:{closest:()=>null}});tree=h.render();
  assert.deepEqual(h.canvas(tree).selected,[],'an unconsumed chart Escape retains its normal behavior');
});

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
  projectPicker(tree).props.onChange!(B as any);tree = h.render();
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
  projectPicker(tree).props.onChange!(B as any);tree = h.render();
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
  projectPicker(tree).props.onChange!(A as any);tree = h.render();
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
  projectPicker(tree).props.onChange!(B as any);tree = h.render();
  h.canvas(tree).onSelect(B, GROUP);h.render();h.setPending(true);tree = h.render();
  const picker = projectPicker(tree);
  assert.equal(picker.props.value, B, 'pending does not erase the current project choice');
  assert.ok((picker.props.options as any[]).some(option => option.value === B), 'the selected project remains an available option');
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
  const nav=h.navigation(tree);
  nav.onFolderSettings(h.snapshot().spaces.find(s=>s.id===id(20)));tree=h.render();
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

test('new direct work goes before nested groups when adding inside a group',async()=>{
  const h=await harness(),project=h.latestProject(B);project.tasks=[row(GROUP,'group',null,0),row(TASK,'task',GROUP,0),row(NEXT_GROUP,'group',GROUP,1),row(NEXT_TASK,'task',NEXT_GROUP,0)];
  let tree=h.render();h.canvas(tree).onSelect(B,GROUP);tree=h.render();
  const before=new Set(project.tasks.map(t=>t.id));button(tree,'+ 작업').props.onClick!();await settle();
  const added=addedTask(h,before,B);
  assert.deepEqual(h.latestProject(B).tasks.filter(t=>t.parentId===GROUP).sort((a,b)=>a.sortOrder-b.sortOrder).map(t=>t.id),[TASK,added.id,NEXT_GROUP]);
});

test('autosave callbacks return canonical revision and preserve successive edits',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  const inspector=h.inspector(tree),revision=h.latestProject(B).revision;
  const first=await inspector.onSaveTask({title:'입력 1'},revision);
  assert.equal(first?.revision,revision+1);
  await inspector.onSaveTask({progress:65},first!.revision);
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)?.title,'입력 1');
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)?.progress,65);
  await assert.rejects(inspector.onSaveTask({title:'충돌'},revision),/다른 변경/);
});

test('draft progress overlays the chart but never changes canonical data before saving',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.inspector(tree).onDraftProgress(B,TASK,75);tree=h.render();
  const chart=h.canvas(tree) as any;
  assert.equal(chart.projects.find((p:GanttProject)=>p.id===B).tasks.find((t:GanttTask)=>t.id===TASK).progress,75);
  assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)?.progress,0);
  h.inspector(tree).onDraftProgress(B,TASK,null);tree=h.render();
  assert.equal((h.canvas(tree) as any).projects.find((p:GanttProject)=>p.id===B).tasks.find((t:GanttTask)=>t.id===TASK).progress,0);
});

test('failed pending draft keeps the current selection when navigating the tree',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.inspector(tree).onRegisterCloseGuard(async()=>false);
  h.navigation(tree).onSelect(A,null);await settle();tree=h.render();
  assert.deepEqual(h.canvas(tree).selected,[TASK]);
  h.inspector(tree).onRegisterCloseGuard(async()=>true);
  h.navigation(tree).onSelect(A,null);await settle();tree=h.render();
  assert.deepEqual(h.canvas(tree).selected,[A]);
});

test('group date drag saves one canonical project including folded completed descendants',async()=>{
  const h=await harness();h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)!.completed=true;
  let tree=h.render();h.canvas(tree).onCollapse(GROUP);tree=h.render();
  const display=structuredClone(h.canvas(tree).projects.find(p=>p.id===B)!);
  display.tasks.find(t=>t.id===TASK)!.title='임시 화면 제목';display.tasks.find(t=>t.id===TASK)!.progress=96;
  h.canvas(tree).onShiftGroup(display,display.tasks.find(t=>t.id===GROUP)!,3);await settle();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].type,'saveProject');
  const saved=h.latestProject(B),task=saved.tasks.find(t=>t.id===TASK)!,done=saved.tasks.find(t=>t.id===NEXT_TASK)!;
  assert.equal(saved.revision,2);assert.equal(task.startDate,'2026-09-11');assert.equal(task.endDate,'2026-09-13');
  assert.equal(task.title,TASK);assert.equal(task.progress,0);assert.equal(done.startDate,'2026-09-14');assert.equal(done.completed,true);
});

test('group date drag rejects stale revision, actor, permission, pending writes and failed drafts',async()=>{
  for(const boundary of ['revision','actor','permission','pending','draft','calendar'] as const){
    const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
    const source=structuredClone(h.latestProject(B));
    if(boundary==='revision')h.latestProject(B).revision++;
    if(boundary==='actor')h.setActor('other');
    if(boundary==='permission'){h.latestProject(B).ownerId='other';h.latestProject(B).spaceId=id(21);}
    if(boundary==='pending')h.setPending(true);
    if(boundary==='draft')h.inspector(tree).onRegisterCloseGuard(async()=>false);
    if(boundary==='calendar')h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)!.calendarId=id(70);
    h.canvas(tree).onShiftGroup(source,source.tasks.find(t=>t.id===GROUP)!,2);await settle();
    assert.equal(h.commands.length,0,boundary);assert.equal(h.latestProject(B).tasks.find(t=>t.id===TASK)!.startDate,'2026-09-08');
  }
});

test('group automatic dates require one confirmation and retain predecessor links',async()=>{
  for(const accepted of [false,true]){
    const h=await harness(),project=h.latestProject(B),automatic=project.tasks.find(t=>t.id===NEXT_TASK)!;
    automatic.mode='auto';automatic.predecessorId=TASK;
    let tree=h.render();h.canvas(tree).onShiftGroup(project,project.tasks.find(t=>t.id===GROUP)!,2);await settle();tree=h.render();
    assert.equal(h.commands.length,0);assert.match(text(tree),/수동 일정으로 바뀌고 선행 관계는 유지/);
    button(tree,accepted?'확인':'취소').props.onClick!();await settle();
    assert.equal(h.commands.length,accepted?1:0);
    const saved=h.latestProject(B).tasks.find(t=>t.id===NEXT_TASK)!;
    assert.equal(saved.mode,accepted?'manual':'auto');assert.equal(saved.predecessorId,TASK);
    assert.equal(saved.startDate,accepted?'2026-09-13':'2026-09-11');
  }
});

test('group confirmation rechecks revision, identity, calendar access and navigation before committing',async()=>{
  for(const boundary of ['revision','actor','calendar','navigation'] as const){
    const h=await harness(),project=h.latestProject(B),automatic=project.tasks.find(t=>t.id===NEXT_TASK)!;
    automatic.mode='auto';automatic.predecessorId=TASK;automatic.calendarId=id(70);h.setCalendars([{id:id(70),canEdit:true}]);
    let tree=h.render();h.canvas(tree).onShiftGroup(structuredClone(project),project.tasks.find(t=>t.id===GROUP)!,2);await settle();tree=h.render();
    if(boundary==='revision')project.revision++;
    if(boundary==='actor')h.setActor('other');
    if(boundary==='calendar')h.setCalendars([{id:id(70),canEdit:false}]);
    if(boundary==='navigation')h.navigation(tree).onSelect(A,null);
    button(tree,'확인').props.onClick!();await settle();assert.equal(h.commands.length,0,boundary);
  }
});

test('new root groups receive distinct saved colors while nested groups inherit',async()=>{
  const h=await harness();let tree=h.render();projectPicker(tree).props.onChange!(A as any);tree=h.render();
  button(tree,'+ 그룹').props.onClick!();await settle();tree=h.render();
  const first=h.latestProject(A).tasks[0];assert.ok(first.color);assert.notEqual(first.color,h.latestProject(A).color);
  button(tree,'+ 그룹').props.onClick!();await settle();tree=h.render();
  const second=h.latestProject(A).tasks.find(t=>t.id!==first.id)!;assert.equal(second.parentId,null);assert.ok(second.color);assert.notEqual(second.color,first.color);
  h.inspector(tree).onAddChild();await settle();tree=h.render();
  const child=h.latestProject(A).tasks.find(t=>t.parentId===second.id)!;assert.equal(child.color,null);
  h.canvas(tree).onSelect(B,GROUP);tree=h.render();const before=new Set(h.latestProject(B).tasks.map(t=>t.id));
  button(tree,'+ 그룹').props.onClick!();await settle();assert.equal(addedTask(h,before,B).color,null);
});

test('cross-project drop saves one pair from raw data rather than draft display objects',async()=>{
  const h=await harness();let tree=h.render();const source=h.latestProject(B),target=h.latestProject(A),display=structuredClone(source);
  display.tasks.find(t=>t.id===TASK)!.title='화면 임시 값';display.tasks.find(t=>t.id===TASK)!.progress=95;
  (h.canvas(tree) as any).onRelocate(display,display.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();
  assert.equal(h.commands.length,1);assert.equal(h.commands[0].type,'saveProjectPair');
  assert.equal(h.latestProject(B).tasks.some(t=>t.id===TASK),false);
  const moved=h.latestProject(A).tasks.find(t=>t.id===TASK)!;assert.equal(moved.title,TASK);assert.equal(moved.progress,0);assert.equal(moved.parentId,null);
  tree=h.render();assert.deepEqual(h.canvas(tree).selected,[TASK]);assert.equal(projectPicker(tree).props.value,A);
});

test('drop rejects a changed target revision before writing either project',async()=>{
  const h=await harness();const tree=h.render(),source=h.latestProject(B),target=structuredClone(h.latestProject(A));h.latestProject(A).revision++;
  (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();
  assert.equal(h.commands.length,0);assert.ok(h.latestProject(B).tasks.some(t=>t.id===TASK));
});

test('wider project visibility requires confirmation and fences folder membership changes',async()=>{
  const h=await harness(),source=h.latestProject(B),target=h.latestProject(A),space=h.snapshot().spaces.find(s=>s.id===source.spaceId)!;
  space.shared=true;space.members=[{userId:'viewer',canEdit:false}];source.memberIds=['me'];
  let tree=h.render();(h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();tree=h.render();
  assert.equal(h.commands.length,0);assert.match(text(tree),/연결 정보를 볼 수/);
  space.revision++;button(tree,'확인').props.onClick!();await settle();
  assert.ok(h.latestProject(B).tasks.some(t=>t.id===TASK));assert.equal(h.latestProject(A).tasks.length,0);
});

test('adding a task cannot discard a failed or invalid inspector draft',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.inspector(tree).onRegisterCloseGuard(async()=>false);
  button(tree,'+ 작업').props.onClick!();await settle();tree=h.render();
  assert.deepEqual(h.commands,[]);assert.deepEqual(h.canvas(tree).selected,[TASK]);
});

test('a title blur save does not swallow the following add-task click',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  h.inspector(tree).onRegisterCloseGuard(async()=>{h.setPending(false);return true;});h.setPending(true);tree=h.render();
  assert.equal(button(tree,'+ 작업').props.disabled,false);
  button(tree,'+ 작업').props.onClick!();await settle();assert.equal(h.commands.length,1);
});

test('a delayed creation acknowledgement cannot replace a newer inspector selection',async()=>{
  const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,TASK);tree=h.render();
  const release=h.delayNextWrite();button(tree,'+ 작업').props.onClick!();await settle();tree=h.render();
  h.navigation(tree).onSelect(A,null);await settle();tree=h.render();h.inspector(tree).onRegisterCloseGuard(async()=>false);
  release();await settle();tree=h.render();assert.deepEqual(h.canvas(tree).selected,[A]);
});

test('a delayed relocation acknowledgement cannot replace a newer inspector selection',async()=>{
  const h=await harness();let tree=h.render();const source=h.latestProject(B),target=h.latestProject(A),release=h.delayNextWrite();
  (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');await settle();tree=h.render();
  h.navigation(tree).onSelect(B,NEXT_TASK);await settle();tree=h.render();h.inspector(tree).onRegisterCloseGuard(async()=>false);
  release();await settle();tree=h.render();assert.deepEqual(h.canvas(tree).selected,[NEXT_TASK]);
});

for(const operation of ['creation','relocation'] as const) {
  test(`${operation} keeps input entered in the same inspector while its write was pending`,async()=>{
    const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,NEXT_TASK);tree=h.render();
    const queue=new InspectorAutosave(()=>{}),source=h.latestProject(B),target=h.latestProject(A),before=new Set(source.tasks.map(t=>t.id));
    queue.receive({key:`${B}:${NEXT_TASK}`,revision:source.revision,values:{title:'저장된 제목'}},{fields:['title'],prepare:values=>({values,error:values.title?'':'제목을 입력하세요.'}),save:async()=>{throw new Error('빈 제목을 저장하면 안 됩니다.');}});
    h.inspector(tree).onRegisterCloseGuard(()=>queue.flush());
    const release=h.delayNextWrite();
    if(operation==='creation')button(tree,'+ 작업').props.onClick!();
    else (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');
    await settle();queue.change({title:''});release();await settle();tree=h.render();
    assert.equal(h.commands.length,1,'the completed mutation remains committed');
    if(operation==='creation')addedTask(h,before,B);
    else assert.ok(h.latestProject(A).tasks.some(t=>t.id===TASK));
    assert.deepEqual(h.canvas(tree).selected,[NEXT_TASK],'the inspector containing the later draft remains selected');
    assert.equal(queue.snapshot().values.title,'');assert.equal(queue.snapshot().dirty,true);assert.equal(queue.snapshot().status,'blocked');queue.dispose();
  });

  test(`${operation} rechecks navigation and actor after the final draft flush`,async()=>{
    for(const boundary of ['navigation','actor'] as const){
      const h=await harness();let tree=h.render();h.canvas(tree).onSelect(B,NEXT_TASK);tree=h.render();
      h.inspector(tree).onRegisterCloseGuard(async()=>true);
      const source=h.latestProject(B),target=h.latestProject(A),release=h.delayNextWrite();
      if(operation==='creation')button(tree,'+ 작업').props.onClick!();
      else (h.canvas(tree) as any).onRelocate(source,source.tasks.find(t=>t.id===TASK),target,null,'inside');
      await settle();tree=h.render();let finish!:(value:boolean)=>void,finalChecks=0;
      h.inspector(tree).onRegisterCloseGuard(()=>{finalChecks++;return new Promise<boolean>(resolve=>{finish=resolve;});});
      release();await settle();assert.equal(finalChecks,1,'selection waits for input entered during the write');
      if(boundary==='navigation'){
        h.inspector(tree).onRegisterCloseGuard(async()=>true);h.navigation(tree).onSelect(A,null);await settle();
      }else h.setActor('other');
      finish(true);await settle();tree=h.render();
      assert.equal(h.commands.length,1);assert.deepEqual(h.canvas(tree).selected,[boundary==='navigation'?A:NEXT_TASK]);
    }
  });
}
