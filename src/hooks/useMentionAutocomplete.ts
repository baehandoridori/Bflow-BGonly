import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { detectMentionQuery, applyMention } from '@/utils/mentionQuery';

interface MentionUser { id: string; name: string }

interface Params {
  /** 멘션 선택 시 부모 입력 state 를 갱신하는 콜백 */
  onChange: (next: string) => void;
  users: readonly MentionUser[];
  inputRef: RefObject<HTMLInputElement | null> | RefObject<HTMLTextAreaElement | null>;
}

/**
 * caret 기반 @멘션 자동완성 공통 훅(스펙 §10.2 — 중간 멘션 지원).
 * 두 댓글 입력(RevisionCommentThread/CommentPanel)이 중복하던 멘션 로직을 한곳으로 통일.
 *
 * 핵심: refresh() 는 React state(prop) 가 아니라 DOM 의 el.value/selectionStart 를 직접 읽는다.
 *   onChange 의 setState 는 비동기라 같은 이벤트에서 prop 은 stale 이지만, DOM 은 이미 최신이므로
 *   기존 handleDraftChange(e.target.value) 즉시 판정과 동치가 된다.
 * 드롭다운 UI/스크롤은 MentionDropdown 이 소유한다(여기선 상태·키핸들·삽입만).
 * 입력 엘리먼트 본체(자동 자라기·이미지 paste·quickRevision)는 호출 측이 그대로 소유한다.
 */
export function useMentionAutocomplete({ onChange, users, inputRef }: Params) {
  const [open, setOpen] = useState(false);
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);

  const items = useMemo(
    () => users.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase())),
    [users, filter],
  );

  /** DOM 에서 현재 value/caret 를 읽어 멘션 활성 여부 갱신. 타이핑/캐럿이동 모두 이 한 경로. */
  const refresh = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const q = detectMentionQuery(el.value, el.selectionStart ?? el.value.length);
    if (q) {
      setOpen(true);
      setActiveRange({ start: q.start, end: q.end });
      setFilter(q.query);
      setIndex(0);
    } else {
      setOpen(false);
      setActiveRange(null);
    }
  }, [inputRef]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveRange(null);
  }, []);

  const select = useCallback(
    (name: string) => {
      const el = inputRef.current;
      if (!activeRange || !el) return;
      const { text, caret } = applyMention(el.value, activeRange.start, activeRange.end, name);
      onChange(text);
      close();
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    },
    [activeRange, onChange, close, inputRef],
  );

  // 필터로 후보 수가 줄면 index 보정
  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  const active = open && items.length > 0;

  /** 멘션 활성 시 키 가로채기. 처리했으면 true(호출 측은 그때 submit/줄바꿈 스킵). */
  const onKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!active) return false;
      // stopPropagation: 처리한 멘션 키(Arrow/Enter/Tab/Escape)가 상위/window 리스너로 새지 않게 한다.
      // (예: NewRevisionModal 의 window Escape 가 멘션 닫기 대신 모달 전체를 닫던 회귀 방지)
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setIndex((p) => (p + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIndex((p) => (p - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); select(items[index].name); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
      return false;
    },
    [active, items, index, select, close],
  );

  return { active, items, index, refresh, close, select, onKeyDown };
}
