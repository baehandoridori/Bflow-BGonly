import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Pencil,
  Trash2,
  ExternalLink,
  Clock,
  FileText,
  MapPin,
  Palmtree,
  Save,
  XCircle,
  CheckSquare,
} from 'lucide-react';
import type { CalendarEvent, CalendarEventType } from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { DEPARTMENT_CONFIGS } from '@/types';

// ─── 유틸 ──────────────────────────────────────────

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function formatDateRange(start: string, end: string): string {
  const s = parseDate(start);
  const e = parseDate(end);
  if (start === end) return formatDate(s);
  return `${s.getMonth() + 1}/${s.getDate()} → ${e.getMonth() + 1}/${e.getDate()}`;
}

function calcDDay(endDate: string): string {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const end = parseDate(endDate);
  const diff = Math.round((end.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'D-DAY';
  if (diff > 0) return `D-${diff}`;
  return `D+${Math.abs(diff)}`;
}

function toInputDate(s: string): string {
  return s; // already YYYY-MM-DD
}

function fromInputDate(s: string): string {
  return s; // already YYYY-MM-DD
}

// ─── 타입 라벨 ─────────────────────────────────────

const TYPE_LABELS: Record<CalendarEventType, string> = {
  custom: '일반 이벤트',
  episode: '에피소드',
  part: '파트',
  scene: '씬',
  vacation: '휴가',
};

// ─── 인터페이스 ────────────────────────────────────

interface EventSidePanelProps {
  event: CalendarEvent;
  onClose: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, updates: Partial<CalendarEvent>) => void;
  onNavigate: (ev: CalendarEvent) => void;
}

// ─── 슬라이드 트랜지션 ────────────────────────────

const panelVariants = {
  initial: { x: 300, opacity: 0 },
  animate: { x: 0, opacity: 1 },
  exit: { x: 300, opacity: 0 },
};

const panelTransition = {
  duration: 0.25,
  ease: [0.16, 1, 0.3, 1],
};

// ─── 컴포넌트 ──────────────────────────────────────

export function EventSidePanel({
  event,
  onClose,
  onDelete,
  onUpdate,
  onNavigate,
}: EventSidePanelProps) {
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const { setView } = useAppStore();
  const [editing, setEditing] = useState(false);

  // 편집 드래프트
  const [draftTitle, setDraftTitle] = useState(event.title);
  const [draftStart, setDraftStart] = useState(event.startDate);
  const [draftEnd, setDraftEnd] = useState(event.endDate);
  const [draftMemo, setDraftMemo] = useState(event.memo);
  const [draftPrivate, setDraftPrivate] = useState<boolean>(!!event.isPrivate);

  // 이벤트 변경 시 드래프트 리셋
  useEffect(() => {
    setDraftTitle(event.title);
    setDraftStart(event.startDate);
    setDraftEnd(event.endDate);
    setDraftMemo(event.memo);
    setDraftPrivate(!!event.isPrivate);
    setEditing(false);
  }, [event.id, event.title, event.startDate, event.endDate, event.memo, event.isPrivate]);

  // ESC 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editing) {
          setEditing(false);
          setDraftTitle(event.title);
          setDraftStart(event.startDate);
          setDraftEnd(event.endDate);
          setDraftMemo(event.memo);
          setDraftPrivate(!!event.isPrivate);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose, event]);

  const isVacation = event.type === 'vacation' || event.isReadOnly;
  const hasLinkedScene = event.type !== 'custom' && event.type !== 'vacation';
  const hasLinkedTodo = !!(event.linkedTodoId || event.id.startsWith('cal_'));
  const dday = calcDDay(event.endDate);

  // 연결 정보 텍스트
  const linkedLabel = (() => {
    if (event.linkedEpisode == null) return null;
    const parts: string[] = [];
    parts.push(
      episodeTitles[event.linkedEpisode] ||
        `EP.${String(event.linkedEpisode).padStart(2, '0')}`,
    );
    if (event.linkedPart) parts.push(`${event.linkedPart}파트`);
    if (event.linkedSceneId) parts.push(`#${event.linkedSceneId}`);
    return parts.join(' ');
  })();

  // 편집 저장
  const handleSave = () => {
    onUpdate(event.id, {
      title: draftTitle,
      startDate: fromInputDate(draftStart),
      endDate: fromInputDate(draftEnd),
      memo: draftMemo,
      isPrivate: draftPrivate,
    });
    setEditing(false);
  };

  // 편집 취소
  const handleCancel = () => {
    setDraftTitle(event.title);
    setDraftStart(event.startDate);
    setDraftEnd(event.endDate);
    setDraftMemo(event.memo);
    setDraftPrivate(!!event.isPrivate);
    setEditing(false);
  };

  return (
    <motion.div
      key={event.id}
      variants={panelVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={panelTransition}
      className="absolute right-0 top-0 bottom-0 w-[280px] z-40 flex flex-col"
      style={{
        background: 'rgba(26,29,39,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderLeft: '1px solid #2D3041',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.4)',
      }}
    >
      {/* ── 컬러 스트라이프 ── */}
      <div
        className="h-1 w-full shrink-0"
        style={{ background: `linear-gradient(90deg, ${event.color}, ${event.color}80)` }}
      />

      {/* ── 헤더 ── */}
      <div className="flex items-start gap-2 px-4 pt-3 pb-2 shrink-0">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0 mt-1.5"
          style={{ backgroundColor: event.color }}
        />
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              className="w-full bg-bg-primary border border-bg-border focus:border-accent/50 rounded-md px-2 py-1 text-sm font-semibold text-text-primary outline-none transition-colors"
              autoFocus
            />
          ) : (
            <h3 className="text-sm font-semibold text-text-primary truncate leading-snug">
              {event.title}
            </h3>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-secondary hover:text-text-primary rounded transition-colors cursor-pointer shrink-0"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── 스크롤 바디 ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-3">
        {/* 정보 카드 */}
        <div className="bg-bg-primary/60 rounded-lg border border-bg-border/60 p-3 flex flex-col gap-2.5">
          {/* 날짜 */}
          {editing ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] text-text-secondary font-medium uppercase tracking-wide">
                시작일
              </label>
              <input
                type="date"
                value={toInputDate(draftStart)}
                onChange={(e) => setDraftStart(fromInputDate(e.target.value))}
                className="w-full bg-bg-primary border border-bg-border focus:border-accent/50 rounded-md px-2 py-1 text-xs text-text-primary outline-none transition-colors"
              />
              <label className="text-[10px] text-text-secondary font-medium uppercase tracking-wide mt-1">
                종료일
              </label>
              <input
                type="date"
                value={toInputDate(draftEnd)}
                onChange={(e) => setDraftEnd(fromInputDate(e.target.value))}
                className="w-full bg-bg-primary border border-bg-border focus:border-accent/50 rounded-md px-2 py-1 text-xs text-text-primary outline-none transition-colors"
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-text-secondary">
              <Clock size={12} className="shrink-0" />
              <span className="text-xs">{formatDateRange(event.startDate, event.endDate)}</span>
              <span
                className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  backgroundColor: `${event.color}20`,
                  color: event.color,
                }}
              >
                {dday}
              </span>
            </div>
          )}

          {/* 타입 배지 + 연결 정보 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${event.color}20`,
                color: event.color,
              }}
            >
              {TYPE_LABELS[event.type]}
            </span>
            {hasLinkedTodo && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-flex items-center gap-0.5"
                style={{ backgroundColor: '#6C5CE720', color: '#A29BFE' }}
              >
                <CheckSquare size={9} />
                할일 연동
              </span>
            )}
            {linkedLabel && (
              <span className="text-[10px] text-text-secondary">{linkedLabel}</span>
            )}
            {event.linkedDepartment && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: `${DEPARTMENT_CONFIGS[event.linkedDepartment].color}20`,
                  color: DEPARTMENT_CONFIGS[event.linkedDepartment].color,
                }}
              >
                {DEPARTMENT_CONFIGS[event.linkedDepartment].label}
              </span>
            )}
          </div>

          {/* 휴가 타입 */}
          {isVacation && event.vacationType && (
            <div className="flex items-center gap-2 text-text-secondary">
              <Palmtree size={12} className="shrink-0 text-emerald-400" />
              <span className="text-xs">{event.vacationType}</span>
              {event.vacationUserName && (
                <span className="text-xs text-text-secondary/60">({event.vacationUserName})</span>
              )}
            </div>
          )}
        </div>

        {/* 메모 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1.5 text-text-secondary">
            <FileText size={11} />
            <span className="text-[10px] font-medium uppercase tracking-wide">메모</span>
          </div>
          {editing ? (
            <textarea
              value={draftMemo}
              onChange={(e) => setDraftMemo(e.target.value)}
              rows={4}
              className="w-full bg-bg-primary border border-bg-border focus:border-accent/50 rounded-md px-2.5 py-2 text-xs text-text-primary outline-none resize-none leading-relaxed transition-colors"
              placeholder="메모 입력..."
            />
          ) : (
            <div className="bg-bg-primary/40 rounded-md px-2.5 py-2 min-h-[48px]">
              <p className="text-xs text-text-primary/80 leading-relaxed whitespace-pre-wrap">
                {event.memo || (
                  <span className="text-text-secondary/40 italic">메모 없음</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* 나만 보기 토글 — 편집 모드 또는 현재 비공개 상태일 때만 표시.
            Google Calendar 에 올라가지 않고 앱(Supabase) 에만 저장되어 동료에게 전혀 노출되지 않는다. */}
        {(editing || event.isPrivate) && (
          <div className="flex items-start gap-2">
            {editing ? (
              <label className="flex items-start gap-2 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={draftPrivate}
                  onChange={(e) => setDraftPrivate(e.target.checked)}
                  className="mt-0.5 w-3.5 h-3.5 rounded accent-accent cursor-pointer"
                />
                <div className="flex-1">
                  <div className="text-[11px] font-medium text-text-primary flex items-center gap-1">
                    🔒 나만 보기
                  </div>
                  <p className="text-[10px] text-text-secondary/70 leading-relaxed mt-0.5">
                    Google Calendar 에 올라가지 않고 이 앱에만 저장됩니다. 동료에게 전혀 노출되지 않아요.
                  </p>
                </div>
              </label>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-accent/80 bg-accent/10 px-2 py-1 rounded-md">
                🔒 <span className="font-medium">나만 보기</span>
                <span className="text-text-secondary/60">— 동료에게 전혀 노출되지 않음</span>
              </div>
            )}
          </div>
        )}

        {/* 작성자 */}
        <div className="flex items-center gap-2 text-text-secondary/60">
          <MapPin size={11} />
          <span className="text-[10px]">작성: {event.createdBy}</span>
        </div>

        {/* 스페이서 */}
        <div className="flex-1" />

        {/* ── 액션 영역 ── */}
        {isVacation ? (
          /* 휴가 이벤트: 편집 불가 안내 */
          <div className="flex flex-col gap-2 pt-1">
            <p className="text-[10px] text-text-secondary/50 text-center leading-relaxed">
              휴가 관리는 휴가 탭에서 관리합니다
            </p>
            <button
              onClick={() => {
                onNavigate(event);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
            >
              <Palmtree size={13} />
              휴가 탭으로 이동
            </button>
          </div>
        ) : editing ? (
          /* 편집 모드: 저장/취소 */
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCancel}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-bg-border/50 text-text-secondary hover:bg-bg-border transition-colors cursor-pointer"
            >
              <XCircle size={13} />
              취소
            </button>
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-accent/20 text-accent hover:bg-accent/30 transition-colors cursor-pointer"
            >
              <Save size={13} />
              저장
            </button>
          </div>
        ) : (
          /* 읽기 모드: 편집/이동/삭제 */
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <button
                onClick={() => setEditing(true)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-bg-border/40 text-text-primary hover:bg-bg-border/60 transition-colors cursor-pointer"
              >
                <Pencil size={12} />
                편집
              </button>
              {hasLinkedScene && (
                <button
                  onClick={() => onNavigate(event)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 transition-colors cursor-pointer"
                >
                  <ExternalLink size={12} />
                  이동
                </button>
              )}
              {hasLinkedTodo && (
                <button
                  onClick={() => {
                    const todoId = event.linkedTodoId || event.id.replace(/^cal_/, '');
                    setView('dashboard');
                    // 대시보드 마운트 대기 후 네비게이션 이벤트 디스패치
                    setTimeout(() => {
                      window.dispatchEvent(new CustomEvent('bflow:navigate-to-todo', { detail: { todoId } }));
                    }, 300);
                    onClose();
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-[#A29BFE]/15 text-[#A29BFE] hover:bg-[#A29BFE]/25 transition-colors cursor-pointer"
                >
                  <CheckSquare size={12} />
                  할일로 이동
                </button>
              )}
            </div>
            <button
              onClick={() => {
                onDelete(event.id);
                onClose();
              }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
            >
              <Trash2 size={12} />
              삭제
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
