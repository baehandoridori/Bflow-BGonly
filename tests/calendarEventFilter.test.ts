import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCalendarEvents, VACATION_CHIP_ID, formatEventChipText,
  sortEventsForList, formatEventTimeRange, groupCalendarsForRail,
} from '../src/utils/calendarEventFilter.ts';

const ev = (over: Record<string, unknown>) => ({
  id: 'e', title: '제목', memo: '', color: '#fff', type: 'custom',
  startDate: '2026-09-01', endDate: '2026-09-01', createdBy: '', createdAt: '',
  source: 'bflow', calendarId: 'cal-a', ...over,
}) as never;

const state = (over: Record<string, unknown> = {}) => ({
  visibleCalendarIds: {} as Record<string, boolean>,
  enabledTagIds: {} as Record<string, boolean>,
  googleVisible: true,
  ...over,
});

test('켜진 캘린더 ∩ 켜진 태그와 명시적 false semantics', () => {
  const events = [
    ev({ id: '1', tagId: 't1' }),
    ev({ id: '2', calendarId: 'cal-b', tagId: 't1' }),
    ev({ id: '3', tagId: 't2' }),
    ev({ id: '4', calendarId: 'cal-unknown', tagId: 't-unknown' }),
  ];
  const out = filterCalendarEvents(events, state({
    visibleCalendarIds: { 'cal-b': false },
    enabledTagIds: { t2: false },
  }));
  assert.deepEqual(out.map((e: { id: string }) => e.id), ['1', '4']);
});

test('태그 없는 일정은 태그 필터가 걸려 있어도 항상 표시', () => {
  const out = filterCalendarEvents([ev({ id: '1' })], state({ enabledTagIds: { t1: false, t2: false } }));
  assert.equal(out.length, 1);
});

test('태그 없는 일정도 캘린더가 꺼지면 숨김', () => {
  const out = filterCalendarEvents([ev({ id: '1' })], state({ visibleCalendarIds: { 'cal-a': false } }));
  assert.equal(out.length, 0);
});

test('휴가 칩 off 시 휴가 숨김, on 이면 표시', () => {
  const vac = ev({ id: 'v', source: 'vacation', type: 'vacation', calendarId: undefined });
  assert.equal(filterCalendarEvents([vac], state({ enabledTagIds: { [VACATION_CHIP_ID]: false } })).length, 0);
  assert.equal(filterCalendarEvents([vac], state()).length, 1);
});

test('구글 일정은 googleVisible 로만 제어(태그 필터 무관)', () => {
  const g = ev({ id: 'g', source: 'google', calendarId: undefined, tagId: undefined });
  assert.equal(filterCalendarEvents([g], state({ googleVisible: false, enabledTagIds: { t1: false } })).length, 0);
  assert.equal(filterCalendarEvents([g], state({ enabledTagIds: { t1: false } })).length, 1);
});

test('칩 텍스트: 종일=태그명·제목 / 태그없음=캘린더명·제목 / 시간=HH:MM 제목', () => {
  const tags = { t1: '업로드' }; const cals = { 'cal-a': '스튜디오 공지' };
  assert.equal(formatEventChipText(ev({ tagId: 't1' }), tags, cals), '업로드 · 제목');
  assert.equal(formatEventChipText(ev({}), tags, cals), '스튜디오 공지 · 제목');
  assert.equal(formatEventChipText(ev({ allDay: false, startTime: '14:00' }), tags, cals), '14:00 제목');
  assert.equal(formatEventChipText(ev({ source: 'google', calendarId: undefined }), tags, cals), '구글 · 제목');
  assert.equal(formatEventChipText(ev({ source: 'vacation', type: 'vacation', calendarId: undefined }), tags, cals), '휴가 · 제목');
});

test('목록 정렬: 종일 먼저, 시간 일정은 시각순', () => {
  const list = [
    ev({ id: 'b', allDay: false, startTime: '15:00' }),
    ev({ id: 'a', allDay: false, startTime: '09:00' }),
    ev({ id: 'c' }),
  ];
  assert.deepEqual(sortEventsForList(list).map((e: { id: string }) => e.id), ['c', 'a', 'b']);
});

test('시간 부제: "14:00 – 15:00 · 태그명"', () => {
  assert.equal(
    formatEventTimeRange(ev({ allDay: false, startTime: '14:00', endTime: '15:00', tagId: 't1' }), { t1: '회의' }),
    '14:00 – 15:00 · 회의',
  );
  assert.equal(formatEventTimeRange(ev({ allDay: false, startTime: '14:00' }), {}), '14:00');
  assert.equal(formatEventTimeRange(ev({}), {}), null);
});

test('레일 그룹: team 은 소유 무관 팀 전체 섹션, members 소유=내 캘린더, 공유받음 분리', () => {
  const cal = (over: Record<string, unknown>) => ({
    id: 'c', name: '', color: '', visibility: 'members', ownerId: '1', isPersonal: false,
    members: [], canEdit: true, canManage: true, ...over,
  }) as never;
  const g = groupCalendarsForRail([
    cal({ id: 'p', isPersonal: true, visibility: 'private' }),
    cal({ id: 'own-members' }),
    cal({ id: 'team-mine', visibility: 'team' }),
    cal({ id: 'team-other', visibility: 'team', ownerId: '3' }),
    cal({ id: 'shared', ownerId: '3' }),
  ], '1');
  assert.deepEqual(g.mine.map((c: { id: string }) => c.id), ['p', 'own-members']);
  assert.deepEqual(g.team.map((c: { id: string }) => c.id).sort(), ['team-mine', 'team-other'].sort());
  assert.deepEqual(g.shared.map((c: { id: string }) => c.id), ['shared']);
});
