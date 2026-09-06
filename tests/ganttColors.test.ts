import test from 'node:test';
import assert from 'node:assert/strict';
import { nextProjectColor, newGroupColor } from '../src/features/gantt/colors.ts';
import { createProject, createSpace, createTask, resolveTaskColor } from '../src/features/gantt/domain.ts';
import { createPreviewGateway, listCalendarEvents } from '../src/features/gantt/previewGateway.ts';
import type { GanttProject, GanttTask } from '../src/features/gantt/types.ts';

const palette = ['#6C5CE7', '#74B9FF', '#65BCA7', '#E6BB68', '#DE879A', '#E88C70', '#A0A6B5', '#A29BFE'];
const project = () => createProject('프로젝트', crypto.randomUUID(), 'owner');
const group = (parentId: string | null = null): GanttTask => ({ ...createTask('그룹', '2026-09-07'), kind: 'group', parentId });

test('new projects use distinct valid colors before the palette is exhausted', () => {
  const projects: Pick<GanttProject, 'color'>[] = [];
  for (let index = 0; index < palette.length; index += 1) {
    const color = nextProjectColor(projects);
    assert.match(color, /^#[\da-f]{6}$/i);
    assert.ok(!projects.some(existing => existing.color.toLowerCase() === color.toLowerCase()));
    projects.push({ color });
  }
  assert.equal(nextProjectColor([]), '#6C5CE7');
});

test('project colors reuse the least used color with a stable palette tie break', () => {
  const projects = palette.flatMap(color => [{ color }, { color: color.toLowerCase() }]);
  projects.push({ color: '#6c5ce7' });
  assert.equal(nextProjectColor(projects), '#74B9FF');
  assert.equal(nextProjectColor([...projects].reverse()), '#74B9FF');
});

test('project color usage is case insensitive and creation can reuse a deleted color', () => {
  assert.equal(nextProjectColor([{ color: '#6c5ce7' }]), '#74B9FF');
  const projects = palette.filter(color => color !== '#E6BB68').map(color => ({ color: color.toLowerCase() }));
  const before = structuredClone(projects);
  assert.equal(nextProjectColor(projects), '#E6BB68');
  assert.deepEqual(projects, before);
});

test('new root groups avoid the project and each root sibling color', () => {
  const p = project();
  p.color = '#6c5ce7';
  p.tasks.push({ ...group(), color: null });
  for (let index = 0; index < palette.length - 1; index += 1) {
    const color = newGroupColor(p, null);
    assert.ok(color);
    assert.notEqual(color.toLowerCase(), p.color.toLowerCase());
    assert.ok(!p.tasks.some(existing => resolveTaskColor(p, existing).toLowerCase() === color.toLowerCase()));
    p.tasks.push({ ...group(), color: color.toLowerCase() });
  }
});

test('exhausted root group colors use the least common sibling color and never the project color', () => {
  const p = project();
  p.tasks = palette.filter(color => color !== p.color).map(color => ({ ...group(), color }));
  p.tasks.push({ ...group(), color: '#74b9ff' });
  assert.equal(newGroupColor(p, null), '#65BCA7');
  p.tasks = p.tasks.filter(task => task.color !== '#DE879A');
  assert.equal(newGroupColor(p, null), '#DE879A');
});

test('nested and ordinary task colors do not consume root sibling defaults or mutate existing choices', () => {
  const p = project();
  const root = { ...group(), color: '#123456' };
  p.tasks = [root, { ...group(root.id), color: '#74B9FF' }, { ...createTask('작업'), color: '#74B9FF' }];
  const before = structuredClone(p);
  assert.equal(newGroupColor(p, null), '#74B9FF');
  assert.equal(newGroupColor(p, root.id), null);
  assert.deepEqual(p, before);
});

test('nested groups inherit their root color while manual task colors stay explicit', () => {
  const p = project();
  const root = { ...group(), color: newGroupColor(p, null) };
  p.tasks.push(root);
  const nested = { ...group(root.id), color: newGroupColor(p, root.id) };
  const inheritedTask = { ...createTask('상속 작업'), parentId: nested.id };
  const manualTask = { ...createTask('지정 작업'), parentId: nested.id, color: '#123456' };
  p.tasks.push(nested, inheritedTask, manualTask);
  assert.equal(nested.color, null);
  assert.equal(inheritedTask.color, null);
  assert.equal(resolveTaskColor(p, nested), '#74B9FF');
  assert.equal(resolveTaskColor(p, inheritedTask), '#74B9FF');
  root.color = '#E6BB68';
  assert.equal(resolveTaskColor(p, inheritedTask), '#E6BB68');
  assert.equal(resolveTaskColor(p, manualTask), '#123456');
});

test('saved defaults and inherited parent recoloring reach the canonical preview calendar', async () => {
  const rows = new Map<string, string>();
  const options = {
    storage: { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } },
    locks: { request: async <T>(_name: string, callback: () => Promise<T>) => callback() },
    seed: false,
    canViewCalendar: () => true,
    canEditCalendar: () => true,
  };
  const gateway = createPreviewGateway('owner', options);
  const space = createSpace('폴더', 'owner');
  await gateway.execute({ requestId: crypto.randomUUID(), command: { type: 'saveSpace', space, expectedRevision: null } });
  let p = { ...createProject('색상', space.id, 'owner'), color: nextProjectColor([{ color: '#6C5CE7' }]) };
  const root = { ...group(), color: newGroupColor(p, null) };
  p.tasks.push(root);
  const nested = { ...group(root.id), color: newGroupColor(p, root.id) };
  const calendarId = crypto.randomUUID();
  const child = { ...createTask('하위 일정'), parentId: nested.id, calendarId };
  const direct = { ...createTask('프로젝트 일정'), calendarId };
  const manual = { ...createTask('지정 일정'), parentId: nested.id, color: '#123456', calendarId };
  p.tasks.push(nested, child, direct, manual);
  p = (await gateway.execute({ requestId: crypto.randomUUID(), command: { type: 'saveProject', project: p, expectedRevision: null } })).projects[0];
  const projectedColors = async () => Object.fromEntries((await listCalendarEvents('owner', options)).map(row => [row.title, row.gantt_color]));
  assert.deepEqual(await projectedColors(), { '하위 일정': '#6C5CE7', '프로젝트 일정': '#74B9FF', '지정 일정': '#123456' });
  assert.equal(p.tasks.find(task => task.id === nested.id)?.color, null);
  p = { ...p, color: '#65BCA7', tasks: p.tasks.map(task => task.id === root.id ? { ...task, color: '#E6BB68' } : task) };
  p = (await gateway.execute({ requestId: crypto.randomUUID(), command: { type: 'saveProject', project: p, expectedRevision: p.revision } })).projects[0];
  assert.deepEqual(await projectedColors(), { '하위 일정': '#E6BB68', '프로젝트 일정': '#65BCA7', '지정 일정': '#123456' });
  assert.equal(p.tasks.find(task => task.id === child.id)?.color, null);
  assert.equal(p.tasks.find(task => task.id === nested.id)?.color, null);
});
