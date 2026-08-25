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

test('낙관적으로 삭제된 태그의 stale 일정은 꺼진 태그 필터에 숨지 않고 태그 없음처럼 표시', () => {
  const stale = ev({ id: 'stale-deleted-tag', tagId: 't1' });
  const out = filterCalendarEvents([stale], state({
    enabledTagIds: { t1: false },
    optimisticDeletedTagIds: new Set(['t1']),
  }));
  assert.deepEqual(out.map((event: { id: string }) => event.id), ['stale-deleted-tag']);
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

test('권한 목록이 한 번 확정되면 알 수 없는 B flow 캘린더 캐시만 숨김', () => {
  const events = [
    ev({ id: 'known', calendarId: 'team-cal' }),
    ev({ id: 'revoked', calendarId: 'revoked-cal' }),
    ev({
      id: 'personal-legacy',
      calendarId: undefined,
      sourceCalendarId: 'supabase-private',
      isPrivate: true,
    }),
    ev({ id: 'google', source: 'google', calendarId: undefined, sourceCalendarId: 'primary' }),
    ev({ id: 'vacation', source: 'vacation', type: 'vacation', calendarId: undefined }),
  ];

  const out = filterCalendarEvents(events, state({
    personalCalendarId: 'personal-cal',
    knownCalendarIds: new Set(['personal-cal', 'team-cal']),
  }));

  assert.deepEqual(
    out.map((event: { id: string }) => event.id),
    ['known', 'personal-legacy', 'google', 'vacation'],
  );
});

test('캘린더 메타데이터가 아직 확정되지 않은 초기 상태는 캐시를 임의로 숨기지 않음', () => {
  const cached = ev({ id: 'cached-before-metadata', calendarId: 'not-yet-known' });

  assert.deepEqual(
    filterCalendarEvents([cached], state()).map((event: { id: string }) => event.id),
    ['cached-before-metadata'],
  );
});

test('프리마이그레이션의 빈 캘린더 목록에서도 레거시 개인 일정은 보존', () => {
  const events = [
    ev({ id: 'unknown-canonical', calendarId: 'unknown-calendar' }),
    ev({
      id: 'legacy-private',
      calendarId: undefined,
      sourceCalendarId: 'supabase-private',
      isPrivate: true,
    }),
  ];

  assert.deepEqual(
    filterCalendarEvents(events, state({ knownCalendarIds: new Set() }))
      .map((event: { id: string }) => event.id),
    ['legacy-private'],
  );
});

test('개인 캘린더 off 는 정식 개인 일정과 혼재한 레거시 비공개 일정을 함께 숨김', () => {
  const events = [
    ev({
      id: 'personal-canonical',
      calendarId: 'personal-cal',
      sourceCalendarId: 'bflow:personal-cal',
      isPrivate: true,
    }),
    ev({
      id: 'personal-legacy',
      calendarId: undefined,
      sourceCalendarId: 'supabase-private',
      isPrivate: true,
    }),
    ev({ id: 'team', calendarId: 'team-cal', sourceCalendarId: 'bflow:team-cal' }),
    ev({ id: 'google', source: 'google', calendarId: undefined, sourceCalendarId: 'primary' }),
  ];

  const out = filterCalendarEvents(events, state({
    personalCalendarId: 'personal-cal',
    visibleCalendarIds: { 'personal-cal': false },
  }));

  assert.deepEqual(out.map((event: { id: string }) => event.id), ['team', 'google']);
});

test('개인 캘린더 on 은 정식·레거시 개인 일정을 표시하고 팀·구글 토글은 서로 침범하지 않음', () => {
  const events = [
    ev({ id: 'personal-canonical', calendarId: 'personal-cal', isPrivate: true }),
    ev({
      id: 'personal-legacy',
      calendarId: undefined,
      sourceCalendarId: 'supabase-private',
      isPrivate: true,
    }),
    ev({ id: 'team', calendarId: 'team-cal' }),
    ev({ id: 'google', source: 'google', calendarId: undefined, sourceCalendarId: 'primary' }),
  ];

  const out = filterCalendarEvents(events, state({
    personalCalendarId: 'personal-cal',
    visibleCalendarIds: { 'team-cal': false },
    googleVisible: false,
  }));

  assert.deepEqual(
    out.map((event: { id: string }) => event.id),
    ['personal-canonical', 'personal-legacy'],
  );
});

test('source 필드가 없던 레거시 비공개 표식은 개인 캘린더에만 연결되고 힌트 없이는 기존 표시를 유지', () => {
  const legacy = ev({
    id: 'legacy-pre-source',
    source: undefined,
    calendarId: undefined,
    sourceCalendarId: 'supabase-private',
    isPrivate: true,
  });

  assert.equal(filterCalendarEvents([legacy], state({
    personalCalendarId: 'personal-cal',
    visibleCalendarIds: { 'personal-cal': false },
    googleVisible: true,
  })).length, 0);
  assert.equal(filterCalendarEvents([legacy], state({
    personalCalendarId: undefined,
    visibleCalendarIds: { 'unrelated-team': false },
    googleVisible: false,
  })).length, 1);
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
