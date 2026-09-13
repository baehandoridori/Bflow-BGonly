/**
 * 팀 할 일(comment_thread_todos) 경계 계약 — 피드백 58.
 * main(electron/threadTodoStore.ts)·렌더러(ThreadTodoSection)·미리보기 mock·node --test 가 같은 파일을 쓴다.
 * 런타임 import 0개(tsconfig.node.json 의 src/shared include 대상, alias 없음).
 */

export const THREAD_TODO_TEXT_MAX = 200;
export const THREAD_TODO_KEY_MAX = 200;
/**
 * main IPC 가 "서버엔 저장됐지만 응답을 돌려주는 사이 로그인 세션이 바뀌어 응답만 폐기했다" 고 알릴 때 쓰는 문구.
 * 렌더러는 이 문구를 오류로 보여 주거나 낙관 상태를 되돌리지 않고, 재조회에 맡긴다(변경은 이미 커밋됐고 다른 창에도 알렸다).
 */
export const THREAD_TODO_RESPONSE_DISCARDED = '로그인 세션이 변경되어 할 일 응답을 폐기했습니다.';

/** 서버 to_jsonb 그대로(snake_case). 렌더러도 이 타입을 직접 소비한다 (CharacterBoardTabRow 관행). */
export interface ThreadTodoRow {
  id: string;
  thread_key: string;
  text: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  done_at: string | null;
  done_by: string | null;
  done_by_name: string | null;
}

/** 연속 공백은 한 칸으로, 앞뒤 공백 제거. 문자열이 아니면 빈 문자열. (서버 regexp_replace 와 같은 규칙) */
export function sanitizeThreadTodoText(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
}

/** 서버 PostgreSQL length() 와 같이 문자(코드 포인트) 단위로 센다 — 이모지 1개도 1자(코덱스 9차). */
export function threadTodoCharCount(text: string): number {
  return Array.from(text).length;
}

export function isValidThreadTodoText(text: string): boolean {
  const count = threadTodoCharCount(text);
  return count > 0 && count <= THREAD_TODO_TEXT_MAX;
}

export function isValidThreadKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim() !== '' && threadTodoCharCount(key) <= THREAD_TODO_KEY_MAX;
}

export function isThreadTodoRow(value: unknown): value is ThreadTodoRow {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === 'string';
  const strOrNull = (k: string) => r[k] === null || typeof r[k] === 'string';
  return str('id') && str('thread_key') && str('text') && str('created_by') && str('created_by_name') && str('created_at')
    && strOrNull('done_at') && strOrNull('done_by') && strOrNull('done_by_name');
}

/** UI 표시용 판정. 최종 판정은 서버(SECURITY DEFINER 래퍼 안의 users.role)가 한다. */
export function canDeleteThreadTodo(row: ThreadTodoRow, user: { id: string; role?: string } | null | undefined): boolean {
  return !!user && (row.created_by === user.id || user.role === 'admin');
}
