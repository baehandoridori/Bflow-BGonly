// 캘린더 공용 날짜 유틸 — ScheduleView/캘린더 컴포넌트/훅/위젯 10곳의 로컬 복제를 대체.
// node --test 가 직접 import 하는 모듈: @/ alias·외부 의존 금지.

export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const WEEKDAY_SHORT = WEEKDAYS;

/** Date → 'YYYY-MM-DD' (로컬 기준) */
export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** 'YYYY-MM-DD' → Date (정오 정규화 — 날짜 경계 오차 방지, 기존 관례 유지) */
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** 두 'YYYY-MM-DD' 간 일수 차 (b - a, 부호 포함) */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** '#RRGGBB' → 'rgba(r,g,b,a)' */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * ISO 8601 주차 (1~53). 구 CalendarWidget.getWeekNumber 알고리즘(자정 정규화) 채택.
 * 구 WeekScrollView.getISOWeekNumber 는 정오 시프트 때문에 1/1 이 금요일인 해(예: 2027)에
 * +1 오차가 있었고, 이 모듈로 통일하면서 그 오차가 함께 수정됨 (2025~2026 은 결과 동일 — 테스트로 증명).
 */
export function getISOWeekNumber(d: Date): number {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + 4 - (date.getDay() || 7));
  const yearStart = new Date(date.getFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * 주간·2주 헤더 라벨. 연·월·주차를 **모두 그 주의 목요일** 기준으로 맞춘다.
 * 연말 주(예: 2025.12.28–2026.1.3)에서 수요일을 기준으로 삼으면 "2025년 12월 · 1주차"처럼
 * 연도와 주차가 서로 다른 해를 가리킨다. 일요일 시작 주에서 수요일과 목요일의 ISO 주차는
 * 항상 같으므로, 주차 값 자체는 week[3]을 쓰는 주간 사이드바와 계속 일치한다.
 */
export function formatWeekHeaderLabel(startWeek: readonly Date[], endWeek: readonly Date[]): string {
  const first = startWeek[0];
  const last = endWeek[6];
  const anchor = startWeek[4];
  if (!first || !last || !anchor) return '';
  const range = `${first.getMonth() + 1}.${first.getDate()} – ${last.getMonth() + 1}.${last.getDate()}`;
  return `${anchor.getFullYear()}년 ${anchor.getMonth() + 1}월 · ${getISOWeekNumber(anchor)}주차 · ${range}`;
}
