import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { isValidElement, type ReactNode } from 'react';
import { createProject, createSpace } from '../src/features/gantt/domain.ts';

const require = createRequire(import.meta.url);
const calendar = { id: 'shared-calendar', name: '공유 일정', visibility: 'members', canEdit: false, ownerId: 'other', members: [] };
const sourceEvent = { id: 'calendar-event-1', source: 'bflow', sourceCalendarId: 'bflow:shared-calendar', calendarId: calendar.id, title: '공유 회의', memo: '회의 메모', color: '#74B9FF', type: 'custom', startDate: '2026-09-16', endDate: '2026-09-17', allDay: true, createdBy: 'other', createdAt: '' };
function nodes(tree: ReactNode): any[] { if (Array.isArray(tree)) return tree.flatMap(nodes); if (!isValidElement(tree)) return []; return [tree, ...nodes((tree.props as any).children)]; }
function button(tree: ReactNode, text: string) { return nodes(tree).find((node) => node.type === 'button' && node.props.children === text); }

async function harness(mode: 'copy' | 'link' = 'copy') {
  const states: unknown[] = [], refs: Array<{ current: any }> = [], deps: unknown[][] = [];
  const effects: Array<() => void | (() => void)> = [];
  const mountedEffects: Array<{ run: () => void | (() => void); cleanup: void | (() => void) }> = [];
  const subscribers = new Set<(state: any, previous: any) => void>();
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  let user = { id: 'me' };
  let fresh = true;
  let freshResults: boolean[] = [];
  let destinationFresh = true;
  let loadingGate: Promise<void> | undefined;
  let reads = 0;
  const writes: any[] = [], imported: unknown[][] = [], linked: unknown[] = [];
  let writeGate: Promise<void> | undefined;
  const space = createSpace('내 폴더', user.id), project = createProject('대상 프로젝트', space.id, user.id);
  const gantt = { snapshot: { spaces: [space], projects: [project] }, actorId: user.id, pending: false, error: null, refresh: async () => destinationFresh, execute: async (command: any) => { writes.push(command); await writeGate; if(command.type === 'linkCalendar') gantt.snapshot.projects[0] = { ...project, calendarLink: {calendarId:calendar.id,linkId:'link',actorId:'me',visibility:'members',canEdit:false,canUnlink:false,isAdminOverview:false} } as any; } };
  const calendars = { calendars: [calendar], loadAll: async () => ({ calendarsFresh: true, tagsFresh: true }) };
  const auth = Object.assign((select: (s: any) => unknown) => select({ currentUser: user, users: [{ id: 'me', name: '나' }] }), { getState: () => ({ currentUser: user }), subscribe: (fn: any) => { subscribers.add(fn); return () => subscribers.delete(fn); } });
  const result = await build({ entryPoints: ['src/features/gantt/CalendarImportDialog.tsx'], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['react', 'react/jsx-runtime', './GanttDialogs', './GanttSelect', '@/stores/useAuthStore', '@/stores/useCalendarStore', './useGanttStore', '@/services/calendarService', './calendarImport.css'] });
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)((id: string) => {
    if (id === 'react') return { ...require('react'), useState: (value: any) => { const slot = stateIndex++; if (!(slot in states)) states[slot] = typeof value === 'function' ? value() : value; return [states[slot], (next: any) => { states[slot] = typeof next === 'function' ? next(states[slot]) : next; }]; }, useRef: (value: any) => refs[refIndex++] ??= { current: value }, useMemo: (fn: any) => fn(), useEffect: (fn: any, next: any[]) => { const slot = effectIndex++; if (!deps[slot] || next.some((value, index) => !Object.is(deps[slot][index], value))) effects.push(fn); deps[slot] = next; } };
    if (id === './GanttDialogs') return { GanttModal: 'dialog' };
    if (id === './GanttSelect') return { GanttSelect: 'select' };
    if (id === '@/stores/useAuthStore') return { useAuthStore: auth };
    if (id === '@/stores/useCalendarStore') return { useCalendarStore: Object.assign((fn: any) => fn(calendars), { getState: () => calendars }) };
    if (id === './useGanttStore') return { useGanttStore: Object.assign((fn: any) => fn ? fn(gantt) : gantt, { getState: () => gantt }) };
    if (id === '@/services/calendarService') return { loadBflowEvents: async () => { reads++; await loadingGate; return freshResults.shift() ?? fresh; }, getEvents: async () => [sourceEvent, { ...sourceEvent, id: 'gantt:project:task', linkedGanttProjectId: 'project' }] };
    if (id === './calendarImport.css') return {};
    return require(id);
  }, module, module.exports);
  let chooseMode = mode === 'copy';
  const render = () => { stateIndex = 0; refIndex = 0; effectIndex = 0; const tree = module.exports.CalendarImportDialog({ actorId: 'me', initialProjectId: project.id, onClose() {}, onLinked: (project: unknown) => linked.push(project), onImported: (...args: unknown[]) => imported.push(args) }); while (effects.length) { const run = effects.shift()!; mountedEffects.push({ run, cleanup: run() }); } if (chooseMode) { chooseMode = false; button(tree, '일정만 한 번 복사').props.onClick(); return render(); } return tree; };
  return { render, replayEffects: () => { mountedEffects.forEach(effect => { effect.cleanup?.(); effect.cleanup = effect.run(); }); }, writes, imported, linked, gateWrite: (gate: Promise<void>) => { writeGate = gate; }, project, setFreshResults: (values: boolean[]) => { freshResults = values; }, setDestinationFresh: (value: boolean) => { destinationFresh = value; }, shareDestination: () => { gantt.snapshot = { ...gantt.snapshot, spaces: gantt.snapshot.spaces.map(space => ({ ...space, shared: true, members: [{ userId: 'new-member', canEdit: false }], revision: space.revision + 1 })) }; }, setFresh: (value: boolean) => { fresh = value; }, gate: (value: Promise<void>) => { loadingGate = value; }, reads: () => reads, switchUser: () => { const previous = { currentUser: user }; user = { id: 'other' }; subscribers.forEach(fn => fn({ currentUser: user }, previous)); } };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

test('import dialog can copy read-only shared events and excludes Gantt projections', async () => {
  const h = await harness(); h.render(); await settle();
  const tree = h.render();
  assert.equal(nodes(tree).filter(node => node.props['data-import-event']).length, 1);
  const selectAll = button(tree, '전체 선택'); assert.ok(selectAll); selectAll.props.onClick();
  const ready = h.render(); const submit = nodes(ready).find(node => node.type === 'form');
  await submit.props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].project.tasks[0].title, sourceEvent.title);
  assert.equal(h.writes[0].project.tasks[0].calendarId, null);
  assert.equal(h.imported.length, 1);
});

test('failed canonical fetch does not offer stale cached source events', async () => {
  const h = await harness(); h.setFresh(false); h.render(); await settle();
  assert.equal(h.reads(), 2, 'retry is bounded and never falls back to stale cache');
  const tree = h.render();
  assert.equal(nodes(tree).filter(node => node.props['data-import-event']).length, 0);
  assert.equal(h.writes.length, 0);
  assert.ok(nodes(tree).some(node => node.props.role === 'alert'));
});

test('account switch during fetch invalidates the import dialog before results can be selected', async () => {
  const h = await harness(); let release!: () => void; h.gate(new Promise<void>(resolve => { release = resolve; }));
  h.render(); await settle(); h.switchUser(); release(); await settle();
  assert.equal(h.reads(), 1, 'changed sessions must not start a retry');
  const tree = h.render();
  assert.equal(nodes(tree).filter(node => node.props['data-import-event']).length, 0);
  assert.equal(h.writes.length, 0);
});


test('destination sharing changed while sources refresh requires another review instead of copying', async () => {
  const h = await harness(); h.render(); await settle();
  button(h.render(), '전체 선택').props.onClick();
  let release!: () => void; h.gate(new Promise<void>(resolve => { release = resolve; }));
  const pending = nodes(h.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  await settle(); h.shareDestination(); release(); await pending; await settle();
  assert.equal(h.writes.length, 0, 'new destination members were not part of the reviewed audience');
  assert.ok(nodes(h.render()).some(node => node.props.role === 'alert'));
});


test('one superseded source read is retried once before offering current events', async () => {
  const h = await harness(); h.setFreshResults([false, true]); h.render(); await settle();
  assert.equal(h.reads(), 2);
  assert.equal(nodes(h.render()).filter(node => node.props['data-import-event']).length, 1);
});

test('superseded destination refresh cannot approve copying with an unchanged stale audience', async () => {
  const h = await harness(); h.render(); await settle();
  button(h.render(), '전체 선택').props.onClick(); h.setDestinationFresh(false);
  await nodes(h.render()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await settle();
  assert.equal(h.writes.length, 0);
  assert.ok(nodes(h.render()).some(node => node.props.role === 'alert'));
});


test('StrictMode effect replay cancels the obsolete metadata continuation before it starts loading events', async () => {
  const h = await harness(); h.render(); h.replayEffects(); await settle();
  assert.equal(h.reads(), 1, 'the obsolete mount must not start a competing source request');
  assert.equal(nodes(h.render()).filter(node => node.props['data-import-event']).length, 1);
});

test('an obsolete mount cannot retry its superseded event read against the current mount', async () => {
  const h = await harness(); let release!: () => void;
  h.setFreshResults([false, true]); h.gate(new Promise<void>(resolve => { release = resolve; }));
  h.render(); await settle(); assert.equal(h.reads(), 1);
  h.replayEffects(); await settle(); assert.equal(h.reads(), 2);
  release(); await settle();
  assert.equal(h.reads(), 2, 'only the active lifecycle may retry');
  assert.equal(nodes(h.render()).filter(node => node.props['data-import-event']).length, 1);
  assert.equal(nodes(h.render()).some(node => node.props.role === 'alert'), false);
});


test('whole calendar linking is the default and needs no destination or per-event selection', async () => {
  const h = await harness('link'); h.render(); await settle(); const tree = h.render();
  assert.ok(button(tree, '캘린더 연결'));
  assert.equal(nodes(tree).some(node => node.props['aria-label'] === '가져오기 시작일'), false);
  assert.equal(nodes(tree).some(node => node.props.label === '가져올 프로젝트'), false);
  assert.equal(nodes(tree).some(node => node.props['data-import-event']), false);
});


test('linking a read-only shared calendar creates a binding without copying into a local destination', async () => {
 const h=await harness('link');h.render();await settle();
 await nodes(h.render()).find(node=>node.type==='form').props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.writes,[{type:'linkCalendar',calendarId:calendar.id}]);
 assert.equal(h.linked.length,1);assert.equal(h.imported.length,0);
});

test('double submitting the whole-calendar link issues one command while pending', async () => {
 const h=await harness('link');h.render();await settle();let release!:()=>void;h.gateWrite(new Promise<void>(resolve=>{release=resolve;}));
 const submit=nodes(h.render()).find(node=>node.type==='form').props.onSubmit;
 const first=submit({preventDefault(){}});await submit({preventDefault(){}});
 assert.equal(h.writes.length,1);release();await first;assert.equal(h.linked.length,1);
});
