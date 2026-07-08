/**
 * 복장 마감일 배지 계산 (T2-4). 오늘 대비 남은 일수로 라벨/톤 결정.
 * today 를 주입받는 순수 함수 — node --test 로 직접 검증.
 */
export type DueTone = 'overdue' | 'today' | 'soon' | 'normal';

/** dueDate(YYYY-MM-DD) 와 todayISO 를 비교해 배지 라벨/톤을 만든다. 미설정/파싱실패면 null. */
export function describeDueDate(
  dueDate: string | null | undefined,
  todayISO: string,
): { label: string; tone: DueTone; days: number } | null {
  if (!dueDate) return null;
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayISO.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(today)) return null;
  const days = Math.round((due - today) / 86_400_000);
  if (days < 0) return { label: `${-days}일 지남`, tone: 'overdue', days };
  if (days === 0) return { label: '오늘 마감', tone: 'today', days };
  if (days <= 3) return { label: `D-${days}`, tone: 'soon', days };
  return { label: dueDate.slice(5).replace('-', '/'), tone: 'normal', days };
}
