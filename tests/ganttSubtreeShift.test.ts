import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTask, descendantIds, durationLabel, scheduleProject, shiftTaskSubtree, taskBounds } from '../src/features/gantt/domain.ts';
import type { GanttProject, GanttTask } from '../src/features/gantt/types.ts';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function mixedProject() {
  const project = createProject('전체 하위 일정', crypto.randomUUID(), 'owner');
  const group = { ...createTask('상위 그룹', '2024-02-26'), kind: 'group' as const, endDate: '2024-03-03', color: '#74B9FF' };
  const nested = { ...createTask('접힌 하위 그룹', '2024-02-27'), kind: 'group' as const, parentId: group.id, endDate: '2024-03-02' };
  const deep = { ...createTask('깊은 그룹', '2024-02-28'), kind: 'group' as const, parentId: nested.id };
  const empty = { ...createTask('완료한 빈 그룹', '2024-02-29'), kind: 'group' as const, parentId: deep.id, completed: true, progress: 100 };
  const timed = { ...createTask('밤을 넘는 작업', '2024-02-28'), parentId: deep.id, endDate: '2024-02-29', allDay: false, startTime: '23:15', endTime: '02:45', progress: 43, memo: '시간과 연결을 유지', color: '#FDCB6E', workers: ['worker'], attendees: ['attendee'], calendarId: crypto.randomUUID(), calendarEventId: 'linked-event', sceneLinks: [{ episodeNumber: 1, sheetName: 'EP1', sceneId: 'S1', department: 'bg' as const }] };
  const milestone = { ...createTask('완료한 시점', '2024-02-29'), kind: 'milestone' as const, parentId: nested.id, allDay: false, startTime: '09:30', endTime: '09:30', completed: true, progress: 100 };
  const done = { ...createTask('필터에 숨은 완료 작업', '2024-03-01'), parentId: group.id, endDate: '2024-03-02', completed: true, progress: 100, progressMode: 'scenes' as const };
  const direct = { ...createTask('직접 하위 작업', '2024-02-27'), parentId: group.id, endDate: '2024-02-28', progress: 17 };
  const outside = createTask('별도 작업', '2024-03-15');
  project.tasks = [outside, timed, nested, milestone, group, done, empty, deep, direct];
  return { project: scheduleProject(project), group, nested, deep, empty, timed, milestone, done, direct, outside };
}

function taskStateWithoutSchedule(task: GanttTask) {
  const { startDate, endDate, mode, ...state } = task;
  return state;
}

for (const [days, expected] of [
  [3, [['2024-02-29', '2024-03-06'], ['2024-03-01', '2024-03-05'], ['2024-03-02', '2024-03-02'], ['2024-03-03', '2024-03-03'], ['2024-03-02', '2024-03-03'], ['2024-03-03', '2024-03-03'], ['2024-03-04', '2024-03-05'], ['2024-03-01', '2024-03-02']]],
  [-2, [['2024-02-24', '2024-03-01'], ['2024-02-25', '2024-02-29'], ['2024-02-26', '2024-02-26'], ['2024-02-27', '2024-02-27'], ['2024-02-26', '2024-02-27'], ['2024-02-27', '2024-02-27'], ['2024-02-28', '2024-02-29'], ['2024-02-25', '2024-02-26']]],
] as const) {
  test(`shifting ${days} days includes every nested, completed and timed descendant across leap day`, () => {
    const fixture = mixedProject(), original = structuredClone(fixture.project);
    const project = freeze(fixture.project);
    const next = shiftTaskSubtree(project, fixture.group.id, days);
    assert.notEqual(next, project);
    assert.deepEqual(project, original, 'the canonical input and its nested arrays stay untouched');
    assert.deepEqual(next.tasks.map(task => task.id), project.tasks.map(task => task.id));
    const ids = [fixture.group, fixture.nested, fixture.deep, fixture.empty, fixture.timed, fixture.milestone, fixture.done, fixture.direct].map(task => task.id);
    assert.deepEqual(new Set(ids), descendantIds(project, fixture.group.id));
    assert.deepEqual(ids.map(id => { const task = next.tasks.find(task => task.id === id)!; return [task.startDate, task.endDate]; }), expected);
    for (const before of project.tasks) {
      const after = next.tasks.find(task => task.id === before.id)!;
      assert.deepEqual(taskStateWithoutSchedule(after), taskStateWithoutSchedule(before), before.title);
      assert.equal(durationLabel(after), durationLabel(before), `${before.title} keeps its duration`);
    }
    assert.deepEqual(next.tasks.find(task => task.id === fixture.outside.id), project.tasks.find(task => task.id === fixture.outside.id));
    assert.equal(next.revision, project.revision, 'only the save command owns revisions');
    const bounds = taskBounds(next, fixture.group.id)!;
    assert.deepEqual([bounds.startDate, bounds.endDate], days === 3 ? ['2024-03-01', '2024-03-05'] : ['2024-02-25', '2024-02-29']);
  });
}

test('explicit movement makes all shifted automatic groups and leaves manual while external successors still follow', () => {
  const project = createProject('자동 연결', crypto.randomUUID(), 'owner');
  const predecessor = createTask('외부 선행', '2024-02-25');
  const outer = { ...createTask('이동하지 않는 상위 그룹', '2024-02-25'), kind: 'group' as const, mode: 'auto' as const, predecessorId: predecessor.id };
  const group = { ...createTask('옮기는 그룹', '2024-02-27'), kind: 'group' as const, parentId: outer.id, mode: 'auto' as const, predecessorId: predecessor.id };
  const nested = { ...createTask('하위 자동 그룹', '2024-02-27'), kind: 'group' as const, parentId: group.id, mode: 'auto' as const };
  const first = { ...createTask('자동 첫 작업', '2024-02-27'), parentId: nested.id, mode: 'auto' as const };
  const second = { ...createTask('내부 자동 후속', '2024-02-28'), parentId: nested.id, mode: 'auto' as const, predecessorId: first.id };
  const external = { ...createTask('그룹 밖 자동 후속', '2024-03-01'), mode: 'auto' as const, predecessorId: group.id };
  const manual = { ...createTask('그룹 밖 수동 후속', '2024-03-02'), predecessorId: second.id };
  project.tasks = [predecessor, outer, group, nested, first, second, external, manual];
  const canonical = freeze(scheduleProject(project));
  for (const days of [3, -2]) {
    const next = shiftTaskSubtree(canonical, group.id, days), byId = new Map(next.tasks.map(task => [task.id, task]));
    for (const id of [group.id, nested.id, first.id, second.id]) assert.equal(byId.get(id)!.mode, 'manual');
    for (const before of canonical.tasks) assert.equal(byId.get(before.id)!.predecessorId, before.predecessorId);
    assert.equal(byId.get(first.id)!.startDate, days === 3 ? '2024-03-01' : '2024-02-25');
    assert.equal(byId.get(second.id)!.startDate, days === 3 ? '2024-03-02' : '2024-02-26');
    assert.equal(byId.get(external.id)!.startDate, days === 3 ? '2024-03-03' : '2024-02-27');
    assert.equal(byId.get(external.id)!.mode, 'auto');
    assert.equal(byId.get(outer.id)!.mode, 'auto', 'an automatic ancestor outside the moved subtree stays automatic');
    assert.deepEqual(byId.get(manual.id), canonical.tasks.find(task => task.id === manual.id));
    assert.deepEqual(byId.get(predecessor.id), canonical.tasks.find(task => task.id === predecessor.id));
    assert.deepEqual(scheduleProject(next), next, 'an unrelated later edit cannot snap the moved subtree back');
  }
});

test('zero day movement preserves object identity, schedule modes and all data', () => {
  const { project, group } = mixedProject();
  project.tasks.find(task => task.id === group.id)!.mode = 'auto';
  const snapshot = structuredClone(project);
  assert.equal(shiftTaskSubtree(freeze(project), group.id, 0), project);
  assert.deepEqual(project, snapshot);
});

test('missing and non-group targets and unsafe deltas are rejected without mutation', () => {
  const { project, group, timed } = mixedProject(), snapshot = structuredClone(project);
  freeze(project);
  for (const invalid of [NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
    assert.throws(() => shiftTaskSubtree(project, group.id, invalid), /일수|정수/);
  }
  for (const days of [0, 3]) {
    assert.throws(() => shiftTaskSubtree(project, crypto.randomUUID(), days), /찾을|그룹/);
    assert.throws(() => shiftTaskSubtree(project, timed.id, days), /그룹/);
  }
  assert.deepEqual(project, snapshot);
});

test('out-of-range descendant dates and rescheduled external successors fail atomically', () => {
  const fixture = (date: string): { project: GanttProject; group: GanttTask; leaf: GanttTask } => {
    const project = createProject('날짜 한계', crypto.randomUUID(), 'owner');
    const group = { ...createTask('그룹', '2024-02-27'), kind: 'group' as const };
    const leaf = { ...createTask('먼 날짜의 하위 작업', date), parentId: group.id };
    project.tasks = [group, leaf];
    return { project, group, leaf };
  };
  for (const [date, days] of [['9999-12-31', 1], ['0000-01-01', -1], ['2024-02-29', Number.MAX_SAFE_INTEGER], ['2024-02-29', Number.MIN_SAFE_INTEGER]] as const) {
    const { project, group } = fixture(date), before = structuredClone(project);
    assert.throws(() => shiftTaskSubtree(freeze(project), group.id, days), /날짜|범위/);
    assert.deepEqual(project, before);
  }
  const { project, group, leaf } = fixture('9999-12-29');
  project.tasks.push({ ...createTask('외부 자동 후속', '9999-12-30'), mode: 'auto', predecessorId: leaf.id });
  const before = structuredClone(project);
  assert.throws(() => shiftTaskSubtree(freeze(project), group.id, 2), /날짜|범위/);
  assert.deepEqual(project, before);
});

test('invalid descendant source dates are rejected before generating any shifted result', () => {
  const { project, group, timed } = mixedProject();
  project.tasks.find(task => task.id === timed.id)!.startDate = '2024-02-30';
  const before = structuredClone(project);
  assert.throws(() => shiftTaskSubtree(freeze(project), group.id, 3), /날짜/);
  assert.deepEqual(project, before);
});
