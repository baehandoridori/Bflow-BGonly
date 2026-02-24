/**
 * 캘린더 드래그&드롭 훅
 * - move: 이벤트 바 본체를 드래그하여 날짜 이동
 * - resize-start: 왼쪽 가장자리를 드래그하여 시작일 조정
 * - resize-end: 오른쪽 가장자리를 드래그하여 종료일 조정
 */

import { useState, useCallback, useRef, useEffect } from 'react';

export type DragMode = 'move' | 'resize-start' | 'resize-end';

export interface DragState {
  eventId: string;
  mode: DragMode;
  originalStartDate: string;
  originalEndDate: string;
  /** 드래그 시작 시점의 마우스 X 좌표 */
  anchorX: number;
  /** 드래그 시작 시점의 날짜 문자열 (hover 셀 기준) */
  anchorDate: string;
}

export interface DragPreview {
  eventId: string;
  newStartDate: string;
  newEndDate: string;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function addDaysToStr(dateStr: string, days: number): string {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return fmtDate(d);
}

function daysBetweenDates(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** data-date 속성을 가진 가장 가까운 부모 엘리먼트에서 날짜 추출 */
function getDateFromElement(el: HTMLElement | null): string | null {
  while (el) {
    const d = el.getAttribute('data-date');
    if (d) return d;
    el = el.parentElement;
  }
  return null;
}

export function useCalendarDnD(
  onEventMove: (eventId: string, newStart: string, newEnd: string) => void,
  onEventResize: (eventId: string, newStart: string, newEnd: string) => void,
) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [preview, setPreview] = useState<DragPreview | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const previewRef = useRef<DragPreview | null>(null);

  const startDrag = useCallback((
    eventId: string,
    mode: DragMode,
    startDate: string,
    endDate: string,
    mouseX: number,
    anchorDate: string,
  ) => {
    const state: DragState = {
      eventId,
      mode,
      originalStartDate: startDate,
      originalEndDate: endDate,
      anchorX: mouseX,
      anchorDate,
    };
    dragRef.current = state;
    setDragState(state);
    const p = { eventId, newStartDate: startDate, newEndDate: endDate };
    previewRef.current = p;
    setPreview(p);
  }, []);

  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = dragRef.current;
      if (!state) return;

      // 마우스 아래의 날짜 셀을 찾는다
      const target = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const hoverDate = target ? getDateFromElement(target) : null;
      if (!hoverDate) return;

      const deltaDays = daysBetweenDates(state.anchorDate, hoverDate);
      if (deltaDays === 0 && previewRef.current) {
        // 같은 날짜이면 프리뷰 변경 불필요
        return;
      }

      let newStart: string;
      let newEnd: string;

      if (state.mode === 'move') {
        newStart = addDaysToStr(state.originalStartDate, deltaDays);
        newEnd = addDaysToStr(state.originalEndDate, deltaDays);
      } else if (state.mode === 'resize-start') {
        newStart = addDaysToStr(state.originalStartDate, deltaDays);
        newEnd = state.originalEndDate;
        // 시작일이 종료일을 넘지 않도록
        if (newStart > newEnd) newStart = newEnd;
      } else {
        // resize-end
        newStart = state.originalStartDate;
        newEnd = addDaysToStr(state.originalEndDate, deltaDays);
        // 종료일이 시작일보다 이전이 되지 않도록
        if (newEnd < newStart) newEnd = newStart;
      }

      const p = { eventId: state.eventId, newStartDate: newStart, newEndDate: newEnd };
      previewRef.current = p;
      setPreview(p);
    };

    const handleMouseUp = () => {
      const state = dragRef.current;
      const currentPreview = previewRef.current;
      if (state && currentPreview) {
        const changed =
          currentPreview.newStartDate !== state.originalStartDate ||
          currentPreview.newEndDate !== state.originalEndDate;

        if (changed) {
          if (state.mode === 'move') {
            onEventMove(state.eventId, currentPreview.newStartDate, currentPreview.newEndDate);
          } else {
            onEventResize(state.eventId, currentPreview.newStartDate, currentPreview.newEndDate);
          }
        }
      }

      dragRef.current = null;
      previewRef.current = null;
      setDragState(null);
      setPreview(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // 드래그 중 텍스트 선택 방지
    document.body.style.userSelect = 'none';
    document.body.style.cursor = dragState.mode === 'move' ? 'grabbing' : 'col-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [dragState, onEventMove, onEventResize]);

  return {
    isDragging: !!dragState,
    dragState,
    preview,
    startDrag,
  };
}
