/**
 * TodoDetailModal — 개인 할일 상세/편집 모달 (확정 B)
 *
 * 개인 할일의 제목·메모·날짜·캘린더 편집을 메인 리스트 행이 아닌 이 모달 안에서만 제공한다.
 * 메인 행은 읽기 전용 표시 + 클릭 시 이 모달을 연다.
 *
 * 동기화: 편집은 즉시 onUpdate(todo.id, ...)로 커밋된다(스토어 낙관적 반영).
 * 부모(MyTasksWidget)가 선택된 todo 를 스토어에서 id 로 재추출해 다시 내려주므로,
 * 이 모달의 todo prop 은 항상 최신 값을 반영한다(스냅샷 stale 방지).
 */

import { useEffect, useRef, useState } from 'react';
import { X, Calendar, CalendarDays } from 'lucide-react';
import { motion } from 'framer-motion';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { cn } from '@/utils/cn';
import type { PersonalTodo } from '../types';
import { ModalPortal } from './ModalPortal';

export function TodoDetailModal({
  todo,
  onUpdate,
  onClose,
}: {
  todo: PersonalTodo;
  onUpdate: (id: string, updates: Partial<PersonalTodo>) => void;
  onClose: () => void;
}) {
  const colorMode = useAppStore((s) => s.colorMode);
  const setView = useAppStore((s) => s.setView);
  const users = useAuthStore((s) => s.users);

  // 제목/메모는 입력 중 로컬 상태로 두고 blur/Enter 에 커밋(매 키 입력마다 스토어 쓰기 방지).
  // 날짜/캘린더는 즉시 커밋. todo prop 이 갱신되면 외부 변경(다른 기기 등)을 반영한다.
  const [editTitle, setEditTitle] = useState(todo.title);
  const [editMemo, setEditMemo] = useState(todo.memo);

  // 입력칸별 포커스 추적 — 외부 변경(캘린더 역동기화/실시간)이 입력 중인 값을 덮어쓰지 않게 가드.
  const titleFocusedRef = useRef(false);
  const memoFocusedRef = useRef(false);

  // todo 가 외부에서 바뀌면(스토어 재추출) 동기화. 단, 해당 칸을 편집(포커스) 중이면 건너뛴다(클로버 방지).
  useEffect(() => { if (!titleFocusedRef.current) setEditTitle(todo.title); }, [todo.title]);
  useEffect(() => { if (!memoFocusedRef.current) setEditMemo(todo.memo); }, [todo.memo]);

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== todo.title) {
      onUpdate(todo.id, { title: trimmed });
    } else if (!trimmed) {
      setEditTitle(todo.title); // 빈 제목 거부 → 원복
    }
  };

  const commitMemo = () => {
    if (editMemo !== todo.memo) {
      onUpdate(todo.id, { memo: editMemo });
    }
  };

  const commitStart = (value: string) => {
    if (value !== (todo.startDate ?? '')) {
      onUpdate(todo.id, { startDate: value || undefined });
    }
  };

  const commitEnd = (value: string) => {
    if (value !== (todo.endDate ?? '')) {
      onUpdate(todo.id, { endDate: value || undefined });
    }
  };

  const toggleCalendar = () => {
    onUpdate(todo.id, { addToCalendar: !todo.addToCalendar });
  };

  // 캘린더 뷰로 이동 (뷰 전환 후 ScheduleView 마운트 대기)
  const navigateToCalendar = () => {
    setView('schedule');
    if (todo.startDate) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('bflow:navigate-to-date', { detail: { date: todo.startDate, todoId: todo.id } }));
      }, 300);
    }
    onClose();
  };

  return (
    <ModalPortal onClose={onClose} labelledBy="todo-detail-title" maxWidth={440}>
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border/30">
        <span id="todo-detail-title" className="text-sm font-semibold text-text-primary">개인 할일</span>
        <button onClick={onClose} className="p-1 hover:bg-bg-border/20 rounded-md cursor-pointer"><X size={16} /></button>
      </div>

      {/* 본문 */}
      <div className="flex flex-col gap-3 px-4 py-4 flex-1 overflow-auto">
        {/* 제목 */}
        <div>
          <label htmlFor="todo-detail-name" className="text-[11px] text-text-secondary/60 mb-1.5 block">제목</label>
          <input
            id="todo-detail-name"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onFocus={() => { titleFocusedRef.current = true; }}
            onBlur={() => { titleFocusedRef.current = false; commitTitle(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { commitTitle(); (e.target as HTMLInputElement).blur(); }
              if (e.key === 'Escape') { setEditTitle(todo.title); }
            }}
            placeholder="할 일을 입력하세요"
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 placeholder:text-text-secondary/30"
          />
        </div>

        {/* 메모 */}
        <div>
          <label className="text-[11px] text-text-secondary/60 mb-1.5 block">메모</label>
          <EntityAwareInput
            multiline
            aria-label="메모"
            value={editMemo}
            /* EntityAwareInput 은 onFocus 를 노출하지 않아, 입력(onChange) 시점에 '편집 중'으로 표시한다.
               (외부 동기화 클로버는 사용자가 실제 타이핑 중일 때만 문제이므로 충분히 커버된다.) */
            onChange={(v) => { memoFocusedRef.current = true; setEditMemo(v); }}
            onBlur={() => { memoFocusedRef.current = false; commitMemo(); }}
            users={users}
            /* #태그 끔: 할일 메모는 캘린더 일정과 동기화돼(addToCalendar) 평문 경로로 표시되므로
               직렬화 토큰('[#a001](...)')이 노출된다(AddTaskModal 개인 메모와 동일 정책). */
            placeholder="메모 (선택)"
            rows={3}
            className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-2 text-xs text-text-primary outline-none focus:border-accent/50 placeholder:text-text-secondary/30 resize-none"
          />
        </div>

        {/* 일정 */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="todo-detail-start" className="text-[11px] font-semibold text-text-secondary/60 tracking-wider block mb-1">시작일</label>
            <div className="relative">
              <input
                id="todo-detail-start"
                type="date"
                value={todo.startDate ?? ''}
                onChange={(e) => commitStart(e.target.value)}
                className="w-full bg-bg-card border-2 border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 date-picker-hidden"
                style={{ colorScheme: colorMode }}
              />
              <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
            </div>
          </div>
          <div className="flex-1">
            <label htmlFor="todo-detail-end" className="text-[11px] font-semibold text-text-secondary/60 tracking-wider block mb-1">종료일</label>
            <div className="relative">
              <input
                id="todo-detail-end"
                type="date"
                value={todo.endDate ?? ''}
                onChange={(e) => commitEnd(e.target.value)}
                className="w-full bg-bg-card border-2 border-accent/40 rounded-lg px-3 py-2 pr-8 text-sm font-medium text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 date-picker-hidden"
                style={{ colorScheme: colorMode }}
              />
              <Calendar size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
            </div>
          </div>
        </div>

        {/* 캘린더 연동 */}
        <button
          type="button"
          onClick={toggleCalendar}
          className={cn(
            'flex items-center gap-2.5 px-3 py-2.5 rounded-lg border-2 transition-all cursor-pointer',
            todo.addToCalendar
              ? 'border-[#6C5CE7] bg-[#6C5CE7]/15 text-[#6C5CE7]'
              : 'border-bg-border/60 text-text-secondary/60 hover:text-[#6C5CE7] hover:border-[#6C5CE7]/30 hover:bg-[#6C5CE7]/5',
          )}
        >
          <Calendar size={16} className={todo.addToCalendar ? 'text-[#6C5CE7]' : ''} />
          <span className="text-xs font-semibold">캘린더에 추가</span>
          <div className={cn(
            'ml-auto w-9 h-[20px] rounded-full transition-colors relative',
            todo.addToCalendar ? 'bg-[#6C5CE7]' : 'bg-bg-border/40',
          )}>
            <motion.div
              className="absolute top-[3px] w-[14px] h-[14px] rounded-full bg-white shadow-sm"
              animate={{ left: todo.addToCalendar ? 18 : 3 }}
              transition={{ duration: 0.2 }}
            />
          </div>
        </button>

        {/* 캘린더에서 보기 */}
        {todo.addToCalendar && (
          <button
            type="button"
            onClick={navigateToCalendar}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-bg-border/50 text-xs text-text-secondary hover:text-accent hover:border-accent/40 cursor-pointer transition-colors"
          >
            <CalendarDays size={14} />
            캘린더에서 보기
          </button>
        )}
      </div>

      {/* 하단 액션 */}
      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-bg-border/30">
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-bg-border/50 text-text-secondary hover:text-text-primary cursor-pointer">닫기</button>
      </div>
    </ModalPortal>
  );
}
