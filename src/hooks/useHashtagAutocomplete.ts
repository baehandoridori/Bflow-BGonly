/**
 * caret 기반 #태그 자동완성 공통 훅(4c). useMentionAutocomplete(@)의 # 버전.
 * detectHashtagQuery 로 토큰 감지 → buildHashtagCandidates(활성 에피소드 씬/파트/화) → applyHashtag 삽입.
 * refresh 는 DOM el.value/selectionStart 를 직접 읽는다(stale 방지). EntityAwareInput 에서 @멘션 훅과 공존.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { detectHashtagQuery, applyHashtag } from '@/utils/hashtagQuery';
import { buildHashtagCandidates, type HashCandidate } from '@/utils/hashtagCandidates';
import { useDataStore } from '@/stores/useDataStore';

interface Params {
  onChange: (next: string) => void;
  inputRef: RefObject<HTMLInputElement | null> | RefObject<HTMLTextAreaElement | null>;
  /** 피드백 49: 캐릭터 스레드의 복장 후보 등 — 기본 후보(씬/파트/화) 앞에 병합된다. */
  extraCandidates?: (filter: string) => HashCandidate[];
}

export function useHashtagAutocomplete({ onChange, inputRef, extraCandidates }: Params) {
  const [open, setOpen] = useState(false);
  const [activeRange, setActiveRange] = useState<{ start: number; end: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [index, setIndex] = useState(0);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  // 드롭다운 active(쿼리 감지)일 때만 후보 빌드 — 비활성 시 전체 순회 비용 회피.
  const items = useMemo(
    () => (open ? [...(extraCandidates?.(filter) ?? []), ...buildHashtagCandidates(episodes, episodeTitles, filter)] : []),
    [open, episodes, episodeTitles, filter, extraCandidates],
  );

  const refresh = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const q = detectHashtagQuery(el.value, el.selectionStart ?? el.value.length);
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
    (cand: HashCandidate) => {
      const el = inputRef.current;
      if (!activeRange || !el) return;
      const { text, caret } = applyHashtag(el.value, activeRange.start, activeRange.end, cand.tag);
      onChange(text);
      close();
      requestAnimationFrame(() => {
        el.focus();
        try { el.setSelectionRange(caret, caret); } catch { /* ignore */ }
      });
    },
    [activeRange, onChange, close, inputRef],
  );

  useEffect(() => {
    if (index >= items.length) setIndex(0);
  }, [items.length, index]);

  const active = open && items.length > 0;

  const onKeyDown = useCallback(
    (e: KeyboardEvent): boolean => {
      if (!active) return false;
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setIndex((p) => (p + 1) % items.length); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setIndex((p) => (p - 1 + items.length) % items.length); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); select(items[index]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return true; }
      return false;
    },
    [active, items, index, select, close],
  );

  return { active, items, index, refresh, close, select, onKeyDown };
}
