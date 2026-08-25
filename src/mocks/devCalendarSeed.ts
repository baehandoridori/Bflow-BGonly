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

export const DEV_CALENDAR_SEED_TAGS: DevCalendarTagRow[] = [
  { id: 'tag-upload', name: '업로드', color: '#E17055', sort_order: 0 },
  { id: 'tag-cut', name: '가편', color: '#74B9FF', sort_order: 1 },
  { id: 'tag-script', name: '대본', color: '#FDCB6E', sort_order: 2 },
  { id: 'tag-meeting', name: '회의', color: '#A29BFE', sort_order: 3 },
];

export const DEV_CALENDAR_SEED_CALENDARS: DevCalendarRow[] = [
  { id: 'cal-personal-1', name: '개인', color: '#6C5CE7', visibility: 'private', owner_id: '1', is_personal: true, created_at: createdAt, updated_at: createdAt },
  { id: 'cal-milestone', name: 'EP 마일스톤', color: '#74B9FF', visibility: 'team', owner_id: '1', is_personal: false, created_at: createdAt, updated_at: createdAt },
  { id: 'cal-notice', name: '스튜디오 공지', color: '#FDCB6E', visibility: 'team', owner_id: '3', is_personal: false, created_at: createdAt, updated_at: createdAt },
  { id: 'cal-leads', name: '리드 회의', color: '#A29BFE', visibility: 'members', owner_id: '3', is_personal: false, created_at: createdAt, updated_at: createdAt },
];

export const DEV_CALENDAR_SEED_MEMBERS: DevCalendarMemberRow[] = [
  { calendar_id: 'cal-leads', user_id: '1', can_edit: true },
  { calendar_id: 'cal-leads', user_id: '2', can_edit: false },
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
  created_by: calendar_id === 'cal-notice' || calendar_id === 'cal-leads' ? '3' : '1',
  created_at: createdAt,
  updated_at: createdAt,
  ...overrides,
});

export const DEV_CALENDAR_SEED_EVENTS: DevCalendarEventRow[] = [
  event('sev-01', 'cal-milestone', 'EP05 업로드', date(1), undefined, { tag_id: 'tag-upload' }),
  event('sev-02', 'cal-milestone', 'EP06 가편 납품', date(12), undefined, { tag_id: 'tag-cut', linked_episode: 6 }),
  event('sev-03', 'cal-milestone', 'EP07 대본 리딩', date(8), undefined, { tag_id: 'tag-script' }),
  event('sev-04', 'cal-milestone', 'EP06 업로드', date(25), undefined, { tag_id: 'tag-upload' }),
  event('sev-05', 'cal-milestone', 'EP07 가편 작업', date(13), date(16), { tag_id: 'tag-cut' }),
  event('sev-06', 'cal-notice', '전체 회식', date(15), undefined, { memo: '장소 추후 공지' }),
  event('sev-07', 'cal-notice', '사무실 정비', date(21), date(22)),
  event('sev-08', 'cal-notice', '채널 점검', date(28), undefined, { tag_id: 'tag-upload' }),
  event('sev-09', 'cal-leads', '리드 회의', date(3), undefined, { tag_id: 'tag-meeting', all_day: false, start_time: '14:00', end_time: '15:00' }),
  event('sev-10', 'cal-leads', '리드 회의', date(10), undefined, { tag_id: 'tag-meeting', all_day: false, start_time: '14:00', end_time: '15:00' }),
  event('sev-11', 'cal-leads', '리드 회의', date(17), undefined, { tag_id: 'tag-meeting', all_day: false, start_time: '14:00', end_time: '15:00' }),
  event('sev-12', 'cal-leads', '컴포 TF 싱크', date(18), undefined, { tag_id: 'tag-meeting', all_day: false, start_time: '15:30', end_time: '16:00' }),
  event('sev-13', 'cal-personal-1', '치과', date(9), undefined, { all_day: false, start_time: '09:30', end_time: '10:30' }),
  event('sev-14', 'cal-personal-1', '장비 반납', date(19)),
  event('sev-15', 'cal-personal-1', '이사 준비', date(26), date(27)),
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
