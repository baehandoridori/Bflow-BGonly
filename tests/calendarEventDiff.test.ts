import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEventSnapshot, diffEventSnapshots } from '../src/utils/calendarEventDiff.ts';
import { calendarEventIdentityKey } from '../src/utils/calendarEventIdentity.ts';

const ev = (id: string, over: Record<string, unknown> = {}) => ({
  id, title: '회의', memo: '준비', color: '#6C5CE7', type: 'custom',
  startDate: '2026-08-26', endDate: '2026-08-26',
  startTime: '14:00', endTime: '15:00', allDay: false,
  createdBy: 'user-1', createdAt: '2026-08-26T00:00:00.000Z',
  calendarId: 'cal-1', tagId: null, source: 'bflow', sourceCalendarId: 'bflow:cal-1',
  ...over,
});

test('변경 없음 → added/changed 모두 빈 배열', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});

test('시각 변경 → changed에 identity 키', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1', { startTime: '15:00', endTime: '16:00' })] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.changed.length, 1);
  assert.deepEqual(d.changed, [calendarEventIdentityKey(ev('e1') as never)]);
  assert.equal(d.added.length, 0);
});

test('화면에 표시되는 일정 필드가 바뀌면 해당 identity를 changed로 반환한다', () => {
  const visibleChanges: Array<[string, unknown]> = [
    ['title', '새 제목'],
    ['memo', '새 메모'],
    ['color', '#FF6B6B'],
    ['type', 'scene'],
    ['startDate', '2026-08-27'],
    ['endDate', '2026-08-28'],
    ['startTime', '09:15'],
    ['endTime', '10:45'],
    ['allDay', true],
    ['calendarId', 'cal-2'],
    ['tagId', 'tag-2'],
    ['linkedEpisode', 3],
    ['linkedPart', 'B'],
    ['linkedSheetName', 'EP03_B_BG'],
    ['linkedSceneId', 'scene-2'],
    ['linkedDepartment', 'acting'],
    ['linkedTodoId', 'todo-2'],
    ['vacationType', '오전반차'],
    ['vacationUserName', '김제작'],
    ['isReadOnly', true],
    ['isPrivate', true],
    ['canEdit', false],
  ];

  for (const [field, value] of visibleChanges) {
    const before = buildEventSnapshot([ev('e1')] as never);
    const after = buildEventSnapshot([ev('e1', { [field]: value })] as never);
    assert.deepEqual(
      diffEventSnapshots(before, after),
      { added: [], changed: [calendarEventIdentityKey(ev('e1') as never)] },
      `${field} 변경이 화면 갱신 대상으로 감지되어야 한다`,
    );
  }
});

test('source 표현이 바뀌면 source-aware identity의 신규 일정으로 감지한다', () => {
  const before = buildEventSnapshot([ev('e1')] as never);
  const googleEvent = ev('e1', { source: 'google', sourceCalendarId: 'google-team' });
  const after = buildEventSnapshot([googleEvent] as never);

  assert.deepEqual(diffEventSnapshots(before, after), {
    added: [calendarEventIdentityKey(googleEvent as never)],
    changed: [],
  });
});

test('신규 이벤트 → added', () => {
  const a = buildEventSnapshot([ev('e1')] as never);
  const b = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const d = diffEventSnapshots(a, b);
  assert.equal(d.added.length, 1);
  assert.deepEqual(d.added, [calendarEventIdentityKey(ev('e2') as never)]);
});

test('삭제는 무시(하이라이트 대상 아님)', () => {
  const a = buildEventSnapshot([ev('e1'), ev('e2')] as never);
  const b = buildEventSnapshot([ev('e1')] as never);
  assert.deepEqual(diffEventSnapshots(a, b), { added: [], changed: [] });
});
