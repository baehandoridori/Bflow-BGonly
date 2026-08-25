/** 프리뷰 전용 공유 캘린더 초기 데이터. 매 모듈 로드마다 새 인메모리 상태로 복제한다. */
import type { ElectronAPI } from '@/types';

type DevCalendarRow = Awaited<ReturnType<ElectronAPI['calendarCreate']>>;
type DevCalendarEventRow = Awaited<ReturnType<ElectronAPI['calendarEventCreate']>>;
type DevCalendarTagRow = Awaited<ReturnType<ElectronAPI['calendarTagsList']>>[number];
type DevCalendarMemberRow = { calendar_id: string; user_id: string; can_edit: boolean };

const now = new Date();
const year = now.getFullYear();
const month = now.getMonth();
const createdAt = now.toISOString();
const date = (day: number) => `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(day, 28)).padStart(2, '0')}`;

const DEV_CALENDAR_TAG_IDS = {
  upload: '00000000-0000-4000-8000-000000000001',
  cut: '00000000-0000-4000-8000-000000000002',
  script: '00000000-0000-4000-8000-000000000003',
  meeting: '00000000-0000-4000-8000-000000000004',
} as const;

const DEV_CALENDAR_IDS = {
  personal: '10000000-0000-4000-8000-000000000001',
  milestone: '10000000-0000-4000-8000-000000000002',
  notice: '10000000-0000-4000-8000-000000000003',
  leads: '10000000-0000-4000-8000-000000000004',
} as const;

const DEV_CALENDAR_EVENT_IDS = {
  event01: '20000000-0000-4000-8000-000000000001',
  event02: '20000000-0000-4000-8000-000000000002',
  event03: '20000000-0000-4000-8000-000000000003',
  event04: '20000000-0000-4000-8000-000000000004',
  event05: '20000000-0000-4000-8000-000000000005',
  event06: '20000000-0000-4000-8000-000000000006',
  event07: '20000000-0000-4000-8000-000000000007',
  event08: '20000000-0000-4000-8000-000000000008',
  event09: '20000000-0000-4000-8000-000000000009',
  event10: '20000000-0000-4000-8000-000000000010',
  event11: '20000000-0000-4000-8000-000000000011',
  event12: '20000000-0000-4000-8000-000000000012',
  event13: '20000000-0000-4000-8000-000000000013',
  event14: '20000000-0000-4000-8000-000000000014',
  event15: '20000000-0000-4000-8000-000000000015',
} as const;

export const DEV_CALENDAR_SEED_TAGS: DevCalendarTagRow[] = [
  { id: DEV_CALENDAR_TAG_IDS.upload, name: '업로드', color: '#E17055', sort_order: 0 },
  { id: DEV_CALENDAR_TAG_IDS.cut, name: '가편', color: '#74B9FF', sort_order: 1 },
  { id: DEV_CALENDAR_TAG_IDS.script, name: '대본', color: '#FDCB6E', sort_order: 2 },
  { id: DEV_CALENDAR_TAG_IDS.meeting, name: '회의', color: '#A29BFE', sort_order: 3 },
];

export const DEV_CALENDAR_SEED_CALENDARS: DevCalendarRow[] = [
  { id: DEV_CALENDAR_IDS.personal, name: '개인', color: '#6C5CE7', visibility: 'private', owner_id: '1', is_personal: true, created_at: createdAt, updated_at: createdAt },
  { id: DEV_CALENDAR_IDS.milestone, name: 'EP 마일스톤', color: '#74B9FF', visibility: 'team', owner_id: '1', is_personal: false, created_at: createdAt, updated_at: createdAt },
  { id: DEV_CALENDAR_IDS.notice, name: '스튜디오 공지', color: '#FDCB6E', visibility: 'team', owner_id: '3', is_personal: false, created_at: createdAt, updated_at: createdAt },
  { id: DEV_CALENDAR_IDS.leads, name: '리드 회의', color: '#A29BFE', visibility: 'members', owner_id: '3', is_personal: false, created_at: createdAt, updated_at: createdAt },
];

export const DEV_CALENDAR_SEED_MEMBERS: DevCalendarMemberRow[] = [
  { calendar_id: DEV_CALENDAR_IDS.leads, user_id: '1', can_edit: true },
  { calendar_id: DEV_CALENDAR_IDS.leads, user_id: '2', can_edit: false },
];

const event = (
  id: string,
  calendar_id: string,
  title: string,
  start_date: string,
  end_date = start_date,
  overrides: Partial<DevCalendarEventRow> = {},
): DevCalendarEventRow => ({
  id,
  calendar_id,
  title,
  memo: '',
  tag_id: null,
  all_day: true,
  start_date,
  end_date,
  start_time: null,
  end_time: null,
  linked_episode: null,
  linked_part: null,
  linked_sheet_name: null,
  linked_scene_id: null,
  linked_department: null,
  linked_todo_id: null,
  created_by: calendar_id === DEV_CALENDAR_IDS.notice || calendar_id === DEV_CALENDAR_IDS.leads ? '3' : '1',
  created_at: createdAt,
  updated_at: createdAt,
  ...overrides,
});

export const DEV_CALENDAR_SEED_EVENTS: DevCalendarEventRow[] = [
  event(DEV_CALENDAR_EVENT_IDS.event01, DEV_CALENDAR_IDS.milestone, 'EP05 업로드', date(1), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.upload }),
  event(DEV_CALENDAR_EVENT_IDS.event02, DEV_CALENDAR_IDS.milestone, 'EP06 가편 납품', date(12), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.cut, linked_episode: 6 }),
  event(DEV_CALENDAR_EVENT_IDS.event03, DEV_CALENDAR_IDS.milestone, 'EP07 대본 리딩', date(8), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.script }),
  event(DEV_CALENDAR_EVENT_IDS.event04, DEV_CALENDAR_IDS.milestone, 'EP06 업로드', date(25), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.upload }),
  event(DEV_CALENDAR_EVENT_IDS.event05, DEV_CALENDAR_IDS.milestone, 'EP07 가편 작업', date(13), date(16), { tag_id: DEV_CALENDAR_TAG_IDS.cut }),
  event(DEV_CALENDAR_EVENT_IDS.event06, DEV_CALENDAR_IDS.notice, '전체 회식', date(15), undefined, { memo: '장소 추후 공지' }),
  event(DEV_CALENDAR_EVENT_IDS.event07, DEV_CALENDAR_IDS.notice, '사무실 정비', date(21), date(22)),
  event(DEV_CALENDAR_EVENT_IDS.event08, DEV_CALENDAR_IDS.notice, '채널 점검', date(28), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.upload }),
  event(DEV_CALENDAR_EVENT_IDS.event09, DEV_CALENDAR_IDS.leads, '리드 회의', date(3), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.meeting, all_day: false, start_time: '14:00', end_time: '15:00' }),
  event(DEV_CALENDAR_EVENT_IDS.event10, DEV_CALENDAR_IDS.leads, '리드 회의', date(10), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.meeting, all_day: false, start_time: '14:00', end_time: '15:00' }),
  event(DEV_CALENDAR_EVENT_IDS.event11, DEV_CALENDAR_IDS.leads, '리드 회의', date(17), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.meeting, all_day: false, start_time: '14:00', end_time: '15:00' }),
  event(DEV_CALENDAR_EVENT_IDS.event12, DEV_CALENDAR_IDS.leads, '컴포 TF 싱크', date(18), undefined, { tag_id: DEV_CALENDAR_TAG_IDS.meeting, all_day: false, start_time: '15:30', end_time: '16:00' }),
  event(DEV_CALENDAR_EVENT_IDS.event13, DEV_CALENDAR_IDS.personal, '치과', date(9), undefined, { all_day: false, start_time: '09:30', end_time: '10:30' }),
  event(DEV_CALENDAR_EVENT_IDS.event14, DEV_CALENDAR_IDS.personal, '장비 반납', date(19)),
  event(DEV_CALENDAR_EVENT_IDS.event15, DEV_CALENDAR_IDS.personal, '이사 준비', date(26), date(27)),
];

export function createDevCalendarSeed(): {
  calendars: DevCalendarRow[];
  members: DevCalendarMemberRow[];
  events: DevCalendarEventRow[];
  tags: DevCalendarTagRow[];
} {
  return {
    calendars: DEV_CALENDAR_SEED_CALENDARS.map((calendar) => ({ ...calendar })),
    members: DEV_CALENDAR_SEED_MEMBERS.map((member) => ({ ...member })),
    events: DEV_CALENDAR_SEED_EVENTS.map((calendarEvent) => ({ ...calendarEvent })),
    tags: DEV_CALENDAR_SEED_TAGS.map((tag) => ({ ...tag })),
  };
}
