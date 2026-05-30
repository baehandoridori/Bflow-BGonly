/** 상대 시간 포맷 (방금, N분 전, N시간 전, N일 전, 날짜) */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const min = Math.floor(diff / 60000);
  const hr = Math.floor(diff / 3600000);
  const day = Math.floor(diff / 86400000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  if (hr < 24) return `${hr}시간 전`;
  if (day < 7) return `${day}일 전`;
  return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

/** 절대 날짜+시간 포맷 (3월 14일 오후 2:30) */
export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  );
}

/** 짧은 시간 포맷 (오전 9:05) */
export function formatTimeShort(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h < 12 ? '오전' : '오후';
  const h12 = h % 12 || 12;
  return `${ampm} ${h12}:${m}`;
}

/** 댓글/활동용 시간 포맷: 오늘이면 시간만, 지난 날짜면 날짜+시간 */
export function formatCommentTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';

  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (sameDay) return formatTimeShort(iso);

  const date = d.toLocaleDateString('ko-KR', {
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    month: 'short',
    day: 'numeric',
  });
  return `${date} ${formatTimeShort(iso)}`;
}

/**
 * 24h 절대 타임스탬프 (한솔 요청: 년/월.일/시간/분 순).
 * - 같은 날: "14:32"
 * - 올해: "05.02 14:32"
 * - 다른 해: "2026.05.02 14:32"
 *
 * `withYearAlways` true 시 항상 연도 포함.
 */
export function formatStamp(iso: string, opts: { withYearAlways?: boolean } = {}): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  if (opts.withYearAlways) return `${Y}.${M}.${D} ${h}:${m}`;
  if (Y !== now.getFullYear()) return `${Y}.${M}.${D} ${h}:${m}`;
  if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
    return `${h}:${m}`;
  }
  return `${M}.${D} ${h}:${m}`;
}
