// ─── 캘린더 이벤트 타입 정의 ─────────────────────

/** 이벤트 종류 */
export type CalendarEventType = 'custom' | 'episode' | 'part' | 'scene';

/** 캘린더 뷰 모드 */
export type CalendarViewMode = 'month' | '2week' | 'week' | 'today';

/** 이벤트 필터 */
export type CalendarFilter = 'all' | 'custom' | 'episode' | 'part' | 'scene';

/** 이벤트 색상 프리셋 */
export const EVENT_COLORS = [
  '#6C5CE7', // accent (violet)
  '#74B9FF', // sky
  '#00B894', // emerald
  '#FDCB6E', // amber
  '#E17055', // coral
  '#FF6B6B', // red
  '#A29BFE', // lavender
  '#55EFC4', // mint
  '#FF9FF3', // pink
  '#48DBFB', // cyan
] as const;

/** 캘린더 이벤트 */
export interface CalendarEvent {
  id: string;
  title: string;
  memo: string;
  color: string;
  type: CalendarEventType;

  // 날짜 (YYYY-MM-DD)
  startDate: string;
  endDate: string; // 마감일만 있는 경우 startDate === endDate

  // 생성자 정보
  createdBy: string;
  createdAt: string; // ISO 8601

  // 연결된 프로젝트 항목 (type !== 'custom' 일 때)
  linkedEpisode?: number;
  linkedPart?: string;
  linkedSheetName?: string;
  linkedSceneId?: string;
  linkedDepartment?: 'bg' | 'acting';
}

/** 이벤트 저장소 */
export type CalendarStore = CalendarEvent[];
