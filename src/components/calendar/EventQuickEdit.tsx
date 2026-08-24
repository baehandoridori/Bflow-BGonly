import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Trash2, Check, Palette, Pencil } from 'lucide-react';
import { CalendarEvent, CalendarEventType, EVENT_COLORS } from '@/types/calendar';
import { useAppStore } from '@/stores/useAppStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';
import { floatingGlassStyle } from '@/utils/glassStyles';

interface EventQuickEditProps {
  event: CalendarEvent;
  position: { x: number; y: number };
  onClose: () => void;
  onUpdateColor: (id: string, color: string) => void;
  onUpdate: (id: string, updates: Partial<CalendarEvent>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (event: CalendarEvent) => void;
}

type TabKey = 'color' | 'edit';

const TYPE_OPTIONS: { value: CalendarEventType; label: string }[] = [
  { value: 'custom', label: '커스텀' },
  { value: 'episode', label: '에피소드' },
  { value: 'part', label: '파트' },
  { value: 'scene', label: '씬' },
];

export function EventQuickEdit({
  event,
  position,
  onClose,
  onUpdateColor,
  onUpdate,
  onDelete,
  onDuplicate,
}: EventQuickEditProps) {
  const colorMode = useAppStore((s) => s.colorMode);
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState(position);
  const canUpdateColor = event.source !== 'google'
    && !(event.source === 'bflow' && event.calendarId !== undefined);
  const [tab, setTab] = useState<TabKey>(canUpdateColor ? 'color' : 'edit');

  // 편집 폼 상태
  const [title, setTitle] = useState(event.title);
  const [startDate, setStartDate] = useState(event.startDate);
  const [endDate, setEndDate] = useState(event.endDate);
  const [type, setType] = useState<CalendarEventType>(event.type);
  const [memo, setMemo] = useState(event.memo);
  const users = useAuthStore((s) => s.users);

  const isVacation = event.type === 'vacation';
  const fieldStyle = {
    background: 'rgb(var(--color-bg-primary) / 0.82)',
    border: '1px solid rgb(var(--color-bg-border) / 0.56)',
    color: 'rgb(var(--color-text-primary))',
  } as const;

  // 화면 밖으로 나가지 않도록 위치 조정
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let { x, y } = position;
    if (x + rect.width > window.innerWidth - 8) x = window.innerWidth - rect.width - 8;
    if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
    if (x < 4) x = 4;
    if (y < 4) y = 4;
    setAdjusted({ x, y });
  }, [position]);

  // 외부 클릭 / ESC 닫기
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const handleSave = useCallback(() => {
    onUpdate(event.id, { title, startDate, endDate, type, memo });
    onClose();
  }, [event.id, title, startDate, endDate, type, memo, onUpdate, onClose]);

  const handleDelete = useCallback(() => {
    onDelete(event.id);
    onClose();
  }, [event.id, onDelete, onClose]);

  const handleDuplicate = useCallback(() => {
    onDuplicate(event);
    onClose();
  }, [event, onDuplicate, onClose]);

  const quickActions = (
    <div className="flex gap-2">
      <button
        onClick={handleDuplicate}
        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer bg-bg-primary/80 text-text-primary hover:bg-bg-border/40"
      >
        <Copy size={12} />
        복사
      </button>
      <button
        onClick={handleDelete}
        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer"
        style={{ background: 'rgba(255,107,107,0.15)', color: '#FF6B6B' }}
      >
        <Trash2 size={12} />
        삭제
      </button>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      <motion.div
        ref={ref}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15 }}
        className="fixed z-[1000]"
        style={{
          ...floatingGlassStyle,
          left: adjusted.x,
          top: adjusted.y,
          width: 300,
          background: 'rgb(var(--color-bg-card) / 0.95)',
          borderRadius: 12,
          boxShadow: '0 16px 36px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.28))',
        }}
      >
        {/* 헤더: 탭 */}
        <div className="flex border-b" style={{ borderColor: 'rgb(var(--color-bg-border) / 0.45)' }}>
          {canUpdateColor && (
            <button
              onClick={() => setTab('color')}
              className="flex-1 py-2.5 text-xs font-medium transition-colors cursor-pointer"
              style={{
                color: tab === 'color' ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
                borderBottom: tab === 'color' ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
              }}
            >
              <Palette size={12} className="inline mr-1" /> 색상
            </button>
          )}
          <button
            onClick={() => !isVacation && setTab('edit')}
            className={`flex-1 py-2.5 text-xs font-medium transition-colors ${isVacation ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            style={{
              color: tab === 'edit' ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
              borderBottom: tab === 'edit' ? '2px solid rgb(var(--color-accent))' : '2px solid transparent',
            }}
          >
            <Pencil size={12} className="inline mr-1" /> 일정 편집
          </button>
        </div>

        {/* 탭 콘텐츠 */}
        <div className="p-3">
          {canUpdateColor && tab === 'color' ? (
            /* ── 색상 탭 ── */
            <div>
              {/* 이벤트 제목 + 현재 색상 */}
              <div className="flex items-center gap-2 mb-3">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ background: event.color }}
                />
                <span className="text-xs font-medium truncate text-text-primary">
                  {event.title}
                </span>
              </div>

              {/* 색상 그리드 5x2 */}
              <div className="grid grid-cols-5 gap-2 mb-4">
                {EVENT_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => onUpdateColor(event.id, color)}
                    className="relative w-8 h-8 rounded-lg transition-transform hover:scale-110 cursor-pointer"
                    style={{
                      background: color,
                      border: event.color === color ? '2px solid white' : '2px solid transparent',
                    }}
                  >
                    {event.color === color && (
                      <Check className="absolute inset-0 m-auto text-white" size={14} strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>

              {/* 빠른 액션 */}
              {quickActions}
            </div>
          ) : (
            /* ── 일정 편집 탭 ── */
            <div>
              {isVacation ? (
                <p className="text-xs text-center py-6 text-text-secondary">
                  휴가 관리는 휴가 탭에서 관리합니다
                </p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {/* 제목 */}
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="일정 제목"
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none placeholder:text-text-secondary/45"
                    style={fieldStyle}
                  />

                  {/* 날짜 */}
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none"
                      style={{
                        ...fieldStyle,
                        colorScheme: colorMode,
                      }}
                    />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none"
                      style={{
                        ...fieldStyle,
                        colorScheme: colorMode,
                      }}
                    />
                  </div>

                  {/* 타입 세그먼트 */}
                  <div className="flex gap-1">
                    {TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setType(opt.value)}
                        className="flex-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer"
                        style={{
                          background: type === opt.value ? 'rgb(var(--color-accent))' : 'rgb(var(--color-bg-primary) / 0.82)',
                          color: type === opt.value ? 'rgb(var(--color-on-accent))' : 'rgb(var(--color-text-secondary))',
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

                  {/* 메모 */}
                  <EntityAwareInput
                    multiline
                    value={memo ?? ''}
                    onChange={setMemo}
                    users={users}
                    /* #태그 끔: 캘린더 메모는 ScheduleView·CalendarView 등에서 평문으로 표시돼
                       직렬화 토큰('[#a001](...)')이 노출된다(EntityAwareInput enableHashtag 주석 참조). */
                    rows={3}
                    placeholder="메모"
                    dropdownPositionClassName="left-2 right-2"
                    className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none resize-none placeholder:text-text-secondary/45 bg-bg-primary/[0.82] border border-bg-border/[0.56] text-text-primary"
                  />

                  {/* 저장 */}
                  <button
                    onClick={handleSave}
                    className="w-full py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                    style={{ background: 'rgb(var(--color-accent))', color: 'rgb(var(--color-on-accent))' }}
                  >
                    저장
                  </button>
                </div>
              )}
              {!canUpdateColor && <div className="mt-3">{quickActions}</div>}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
