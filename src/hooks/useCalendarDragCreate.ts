/**
 * 캘린더 드래그-투-크리에이트 훅
 * - 빈 셀에서 마우스 드래그로 날짜 범위를 선택하여 새 이벤트 생성
 * - 기존 useCalendarDnD(이벤트 이동/리사이즈)와 충돌하지 않음
 *   (이벤트 바가 아닌 빈 셀에서만 활성화)
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/** data-date 속성을 가진 가장 가까운 부모 엘리먼트에서 날짜 추출 */
function getDateFromElement(el: HTMLElement | null): string | null {
  while (el) {
    const d = el.getAttribute('data-date');
    if (d) return d;
    el = el.parentElement;
  }
  return null;
}

/** 이벤트 바 위에서 시작됐는지 확인 (useCalendarDnD와 충돌 방지) */
function isEventBarElement(el: HTMLElement | null): boolean {
  while (el) {
    if (
      el.getAttribute('data-event-id') ||
      el.classList.contains('calendar-event-bar') ||
      el.getAttribute('data-drag-handle') != null
    ) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

// ── 인터페이스 ──

export interface DragCreateState {
  isDragging: boolean;
  startDate: string | null;
  endDate: string | null;
  anchorElement: HTMLElement | null;
}

export interface UseCalendarDragCreateOptions {
  onDragComplete: (startDate: string, endDate: string, anchorEl: HTMLElement | null) => void;
  disabled?: boolean;
}

const INITIAL_STATE: DragCreateState = {
  isDragging: false,
  startDate: null,
  endDate: null,
  anchorElement: null,
};

// ── 훅 ──

export function useCalendarDragCreate(options: UseCalendarDragCreateOptions) {
  const { onDragComplete, disabled = false } = options;

  const [dragState, setDragState] = useState<DragCreateState>(INITIAL_STATE);

  // refs로 최신 값 유지 (이벤트 핸들러에서 stale closure 방지)
  const anchorDateRef = useRef<string | null>(null);
  const currentEndRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const anchorElRef = useRef<HTMLElement | null>(null);
  const onDragCompleteRef = useRef(onDragComplete);
  onDragCompleteRef.current = onDragComplete;

  // elementFromPoint 호출 쓰로틀 (16ms ≈ 1프레임)
  const lastMoveTimeRef = useRef(0);

  // 드래그 완료 후 상태 유지 타이머 (툴팁 참조용)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 보류 중인 상태를 클리어 */
  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  /** 상태 완전 초기화 */
  const resetState = useCallback(() => {
    isDraggingRef.current = false;
    anchorDateRef.current = null;
    currentEndRef.current = null;
    anchorElRef.current = null;
    setDragState(INITIAL_STATE);
  }, []);

  // ── 셀 마우스다운 핸들러 ──
  const handleCellMouseDown = useCallback(
    (e: React.MouseEvent, date: string) => {
      if (disabled) return;
      // 왼클릭만
      if (e.button !== 0) return;
      // 이벤트 바 위에서는 무시 (useCalendarDnD 영역)
      if (isEventBarElement(e.target as HTMLElement)) return;

      // 이전 보류 중인 리셋 취소
      clearResetTimer();

      anchorDateRef.current = date;
      currentEndRef.current = date;
      isDraggingRef.current = true;
      anchorElRef.current = e.currentTarget as HTMLElement;

      setDragState({
        isDragging: true,
        startDate: date,
        endDate: date,
        anchorElement: e.currentTarget as HTMLElement,
      });
    },
    [disabled, clearResetTimer],
  );

  // ── 글로벌 mousemove/mouseup 리스너 ──
  useEffect(() => {
    if (!dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      // 쓰로틀: 프레임당 1회
      const now = performance.now();
      if (now - lastMoveTimeRef.current < 16) return;
      lastMoveTimeRef.current = now;

      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const hoverDate = target ? getDateFromElement(target) : null;
      if (!hoverDate) return;
      if (hoverDate === currentEndRef.current) return; // 변동 없음

      currentEndRef.current = hoverDate;

      const anchor = anchorDateRef.current!;
      // 역방향 드래그: 항상 startDate <= endDate
      const [start, end] = anchor <= hoverDate ? [anchor, hoverDate] : [hoverDate, anchor];

      setDragState((prev) => ({
        ...prev,
        startDate: start,
        endDate: end,
      }));
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;

      const anchor = anchorDateRef.current;
      const current = currentEndRef.current;

      if (anchor && current) {
        const [start, end] = anchor <= current ? [anchor, current] : [current, anchor];

        // 드래그 완료 상태를 잠시 유지 (툴팁 등에서 anchorElement 참조)
        setDragState((prev) => ({
          ...prev,
          isDragging: false,
          startDate: start,
          endDate: end,
        }));

        isDraggingRef.current = false;

        onDragCompleteRef.current(start, end, anchorElRef.current);

        // 300ms 후 완전 초기화 (다음 인터랙션 전까지 유지)
        clearResetTimer();
        resetTimerRef.current = setTimeout(resetState, 300);
      } else {
        resetState();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 드래그 중 텍스트 선택 방지
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
    };
  }, [dragState.isDragging, clearResetTimer, resetState]);

  // ── 언마운트 시 정리 ──
  useEffect(() => {
    return () => {
      clearResetTimer();
      document.body.style.userSelect = '';
    };
  }, [clearResetTimer]);

  // ── 날짜가 선택 범위 내인지 확인 ──
  const isDateInRange = useCallback(
    (date: string): boolean => {
      const { startDate, endDate } = dragState;
      if (!startDate || !endDate) return false;
      return date >= startDate && date <= endDate;
    },
    [dragState],
  );

  return {
    dragState,
    handleCellMouseDown,
    isDateInRange,
  };
}
