import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, ListTodo, Plus, Trash2 } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { cn } from '@/utils/cn';
import { createUuid } from '@/utils/createUuid';
import { cleanIpcErrorMessage } from '@/utils/ipcErrorMessage';
import {
  THREAD_TODO_RESPONSE_DISCARDED,
  THREAD_TODO_TEXT_MAX,
  canDeleteThreadTodo,
  isThreadTodoRow,
  isValidThreadTodoText,
  sanitizeThreadTodoText,
  threadTodoCharCount,
  type ThreadTodoRow,
} from '@/shared/threadTodo';
import type { AppUser } from '@/types';

/**
 * 피드백 58: 댓글 패널 상단 고정 '팀 할 일' — 씬/캐릭터 스레드 단위 팀 공유 체크리스트.
 *
 * - 데이터는 window.electronAPI.threadTodo*(IPC → main → 세션 토큰 래퍼)만 쓴다. 렌더러는 신원을 보내지 않는다.
 * - 낙관적 업데이트: 항목 단위로 즉시 반영 → 실패 시 그 항목만 되돌리고 토스트.
 * - 마지막 뮤테이션이 끝나면 서버 목록을 다시 읽어 수렴한다(다른 사람 변경·서버 규칙 반영).
 * - 변경 신호(자기 창 IPC + DB broadcast)는 300ms 디바운스 후 재조회. 뮤테이션 중이면 그 finally 가 대신 읽는다.
 * - 목록 조회 실패(세션 없음·마이그레이션 미적용 등)는 안내 한 줄 + '다시 불러오기'. 입력은 잠그지 않는다.
 * - 접기 상태는 localStorage(사용자 개인 설정). 개인용 '나의 할일' 위젯과는 별개.
 */
const COLLAPSED_KEY = 'bflow_comment_todo_collapsed';
const SIGNAL_DEBOUNCE_MS = 300;

function byCreated(a: ThreadTodoRow, b: ThreadTodoRow): number {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

/** main 이 "서버엔 저장됐지만 로그인 세션이 바뀌어 응답만 폐기했다" 고 알린 경우 — 되돌리거나 오류로 보이지 않고 재조회에 맡긴다. */
function isDiscardedResponse(err: unknown): boolean {
  return cleanIpcErrorMessage(err, '') === THREAD_TODO_RESPONSE_DISCARDED;
}

interface ThreadTodoSectionProps {
  threadKey: string;
  currentUser: AppUser;
  /** 섹션 높이가 커졌을 때(커진 px, 첫 목록 조회가 끝난 렌더면 마운트부터 걸린 ms 아니면 null). 댓글 목록 스크롤 보정용. */
  onHeightGrow?: (grewBy: number, firstLoadAfterMs: number | null) => void;
}

export function ThreadTodoSection({ threadKey, currentUser, onHeightGrow }: ThreadTodoSectionProps) {
  const [items, setItems] = useState<ThreadTodoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const mountedRef = useRef(true);
  const loadSeqRef = useRef(0);      // 더 새 load 나 뮤테이션이 시작되면 이전 load 응답은 버린다
  const loadPendingRef = useRef(false);
  const inFlightRef = useRef(0);     // 진행 중 뮤테이션 수
  const sectionRef = useRef<HTMLElement>(null);
  const heightRef = useRef<number | null>(null);
  const firstLoadSeenRef = useRef(false);
  const mountedAtRef = useRef(performance.now());
  const onHeightGrowRef = useRef(onHeightGrow);
  onHeightGrowRef.current = onHeightGrow;
  // 코덱스 4·5차: 추가가 실패한 문구 — 입력창이 비어 있으면 바로 되돌리고, 새로 치는 중이면 줄 세운다.
  //   줄 선 문구는 입력창이 비는 순간(추가 직후·사용자가 지웠을 때) 하나씩 다시 채운다 → 연달아 실패해도 잃지 않는다.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const failedDraftsRef = useRef<string[]>([]);
  useEffect(() => {
    if (draft.trim() !== '' || failedDraftsRef.current.length === 0) return;
    setDraft(failedDraftsRef.current.shift() ?? '');
  }, [draft]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // 구현 후 리뷰: 목록이 늦게 채워지거나 펼치면 섹션이 커지고, 바로 아래 댓글 목록은 그만큼 아래에서 잘린다.
  //   스크롤 의도(맨 아래 유지·안 읽은 댓글 이동)는 댓글 패널이 알므로, 여기서는 커진 높이만 그리기 전에 알린다.
  useLayoutEffect(() => {
    const height = sectionRef.current?.offsetHeight ?? 0;
    const prev = heightRef.current;
    heightRef.current = height;
    const firstLoad = !loading && !firstLoadSeenRef.current;
    if (firstLoad) firstLoadSeenRef.current = true;
    const firstLoadAfterMs = firstLoad ? performance.now() - mountedAtRef.current : null;
    if (prev !== null && height > prev) onHeightGrowRef.current?.(height - prev, firstLoadAfterMs);
  });

  const load = useCallback(async () => {
    if (inFlightRef.current > 0) return; // 뮤테이션 중엔 그 finally 가 대신 읽는다 — 낙관 상태를 중간에 덮지 않는다
    const seq = ++loadSeqRef.current;
    loadPendingRef.current = true;
    try {
      const rows = await window.electronAPI.threadTodoList(threadKey);
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      setItems(rows.filter(isThreadTodoRow));
      setNotice(null);
    } catch (err) {
      if (seq !== loadSeqRef.current || !mountedRef.current) return;
      setNotice(cleanIpcErrorMessage(err, '팀 할 일을 불러오지 못했어요'));
    } finally {
      if (seq === loadSeqRef.current) loadPendingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [threadKey]);

  // 첫 로드 + 로그인 세션이 바뀔 때 재조회. 팝업 창은 세션 동기화로 같은 사람의 재로그인에도 currentUser 객체가
  //   새로 들어오므로(id 가 아니라 객체에 의존) '다시 로그인해 주세요' 안내가 저절로 걷힌다. 메인 창은 로그아웃 시
  //   섹션이 언마운트됐다가 로그인 후 다시 마운트되므로 첫 로드가 곧 재조회다.
  useEffect(() => { void load(); }, [load, currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // 변경 신호: 자기 창 IPC onChanged + DB broadcast 두 경로가 300ms 안에 한 번으로 합쳐진다.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = window.electronAPI.onThreadTodosChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        // 뮤테이션 진행 중이면 그 finally 가 어차피 다시 읽으므로 건너뛴다.
        if (inFlightRef.current === 0) void load();
      }, SIGNAL_DEBOUNCE_MS);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [load]);

  const runMutation = useCallback(async (id: string, work: () => Promise<void>) => {
    // 진행 중인 목록 조회 응답이 낙관 상태를 덮지 않게 폐기한다(끝난 뒤 반드시 다시 읽는다).
    if (loadPendingRef.current) {
      loadSeqRef.current += 1;
      loadPendingRef.current = false;
    }
    inFlightRef.current += 1;
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await work();
    } finally {
      inFlightRef.current -= 1;
      if (mountedRef.current) {
        setBusyIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
        // 성공·실패·응답 폐기 모두 서버 상태로 수렴 — 마지막 뮤테이션이 끝나면 반드시 다시 읽는다.
        if (inFlightRef.current === 0) void load();
      }
    }
  }, [load]);

  const submitDraft = async () => {
    const text = sanitizeThreadTodoText(draft);
    if (!isValidThreadTodoText(text)) return;
    const tempId = createUuid();
    const optimistic: ThreadTodoRow = {
      id: tempId, thread_key: threadKey, text,
      created_by: currentUser.id, created_by_name: currentUser.name,
      created_at: new Date().toISOString(), done_at: null, done_by: null, done_by_name: null,
    };
    const submitted = draft;
    setItems((prev) => [...prev, optimistic]);
    setDraft(''); // 줄 서 있던 실패 문구가 있으면 위 effect 가 이어서 채운다
    await runMutation(tempId, async () => {
      try {
        const saved = await window.electronAPI.threadTodoAdd(threadKey, text);
        setItems((prev) => prev.map((r) => (r.id === tempId ? saved : r)));
      } catch (err) {
        if (isDiscardedResponse(err)) return; // 서버엔 저장됨 — finally 의 재조회가 임시 항목을 실제 행으로 바꾼다
        setItems((prev) => prev.filter((r) => r.id !== tempId));
        // 입력창이 비어 있으면 원문을 바로 되돌리고, 새로 치는 중이면 지우지 않고 줄 세운다(연달아 실패해도 문구를 잃지 않게)
        if (mountedRef.current && draftRef.current.trim() === '') setDraft(submitted);
        else failedDraftsRef.current.push(submitted);
        sonnerToast.error(cleanIpcErrorMessage(err, '팀 할 일을 추가하지 못했어요'));
      }
    });
  };

  const toggleDone = async (item: ThreadTodoRow) => {
    const done = item.done_at == null;
    const now = new Date().toISOString();
    // 서버 규칙 미러: 완료는 최초 완료자 유지, 해제는 세 필드 모두 비움.
    const optimistic: ThreadTodoRow = done
      ? { ...item, done_at: item.done_at ?? now, done_by: item.done_by ?? currentUser.id, done_by_name: item.done_by_name ?? currentUser.name }
      : { ...item, done_at: null, done_by: null, done_by_name: null };
    setItems((prev) => prev.map((r) => (r.id === item.id ? optimistic : r)));
    await runMutation(item.id, async () => {
      try {
        const saved = await window.electronAPI.threadTodoSetDone(item.id, done);
        setItems((prev) => prev.map((r) => (r.id === item.id ? saved : r)));
      } catch (err) {
        if (isDiscardedResponse(err)) return;
        setItems((prev) => prev.map((r) => (r.id === item.id ? item : r)));
        sonnerToast.error(cleanIpcErrorMessage(err, '완료 표시를 바꾸지 못했어요'));
      }
    });
  };

  const removeItem = async (item: ThreadTodoRow) => {
    setItems((prev) => prev.filter((r) => r.id !== item.id));
    await runMutation(item.id, async () => {
      try {
        await window.electronAPI.threadTodoDelete(item.id);
        if (item.created_by !== currentUser.id) sonnerToast(`${item.created_by_name}님이 적은 할 일을 지웠어요`);
      } catch (err) {
        if (isDiscardedResponse(err)) return;
        setItems((prev) => (prev.some((r) => r.id === item.id) ? prev : [...prev, item].sort(byCreated)));
        sonnerToast.error(cleanIpcErrorMessage(err, '팀 할 일을 지우지 못했어요'));
      }
    });
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  };

  const openCount = items.filter((r) => r.done_at == null).length;
  const draftValid = isValidThreadTodoText(sanitizeThreadTodoText(draft));
  const draftTooLong = threadTodoCharCount(sanitizeThreadTodoText(draft)) > THREAD_TODO_TEXT_MAX;

  return (
    <section ref={sectionRef} aria-label="팀 할 일" className="shrink-0 border-b border-bg-border px-3 pb-2">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-1.5 py-1.5 text-[11px] font-bold text-text-secondary hover:text-text-primary cursor-pointer"
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <ListTodo size={12} />
        <span>팀 할 일</span>
        <span className="ml-auto tabular-nums font-medium text-text-secondary/60">{openCount}/{items.length}</span>
      </button>
      {!collapsed && (
        <div className="space-y-1">
          {notice && (
            <p role="alert" className="flex items-center justify-between gap-2 text-[11px] text-text-secondary">
              <span>{notice}</span>
              <button type="button" onClick={() => void load()} className="shrink-0 underline cursor-pointer">다시 불러오기</button>
            </p>
          )}
          <ul className="max-h-48 overflow-y-auto space-y-0.5">
            {items.map((item) => {
              const busy = busyIds.has(item.id);
              return (
                <li key={item.id} className={cn('group/todo flex items-start gap-2 rounded px-1 py-0.5 hover:bg-bg-primary/50', busy && 'opacity-60')}>
                  <label className="flex min-w-0 flex-1 items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={item.done_at != null}
                      disabled={busy}
                      onChange={() => void toggleDone(item)}
                      aria-label={`${item.text} 완료 표시`}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-accent cursor-pointer"
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-xs break-words', item.done_at ? 'line-through text-text-secondary/60' : 'text-text-primary')}>
                        {item.text}
                      </span>
                      <span className="block text-[10px] text-text-secondary/60">
                        {item.created_by_name}{item.done_by_name ? ` · ${item.done_by_name} 완료` : ''}
                      </span>
                    </span>
                  </label>
                  {!busy && canDeleteThreadTodo(item, currentUser) && (
                    <button
                      type="button"
                      onClick={() => void removeItem(item)}
                      title="팀 할 일 지우기"
                      aria-label="팀 할 일 지우기"
                      className="shrink-0 rounded p-0.5 text-text-secondary/40 invisible group-hover/todo:visible group-focus-within/todo:visible hover:text-text-primary cursor-pointer"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </li>
              );
            })}
            {items.length === 0 && !loading && !notice && (
              <li className="py-2 text-center text-[11px] text-text-secondary/40">아직 팀 할 일이 없어요</li>
            )}
          </ul>
          {/* 브라우저 maxLength 는 UTF-16 단위라 이모지 200자(400단위)를 막지 않게 두 배로 두고, 정확한 200자 검사는 검증기가 한다(코덱스 9차). */}
          <form onSubmit={(e) => { e.preventDefault(); void submitDraft(); }} className="flex items-center gap-1">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={THREAD_TODO_TEXT_MAX * 2}
              placeholder="팀 할 일 추가 (Enter)"
              aria-label="새 팀 할 일"
              className="min-w-0 flex-1 rounded bg-bg-primary/60 px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/40 outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              type="submit"
              disabled={!draftValid}
              aria-label="팀 할 일 추가"
              className="shrink-0 rounded p-1 text-text-secondary hover:text-accent disabled:opacity-40 cursor-pointer"
            >
              <Plus size={14} />
            </button>
          </form>
          {draftTooLong && (
            <p aria-live="polite" className="text-[10px] text-text-secondary">할 일은 {THREAD_TODO_TEXT_MAX}자까지 적을 수 있어요</p>
          )}
        </div>
      )}
    </section>
  );
}
