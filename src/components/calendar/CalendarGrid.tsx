import { EventTagBadges } from './EventTagBadges';
import { useCalendarStore } from '@/stores/useCalendarStore';
import { resolveEventTags } from './eventTagPresentation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  createMonthSlideVariants,
  MONTH_LAYER_STYLE,
  MONTH_STACK_STYLE,
  type MonthSlide,
} from './monthSlideMotion';
import { X, Palmtree, CheckSquare, CalendarDays } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { CalendarEvent } from '@/types/calendar';
import { EVENT_COLORS } from '@/types/calendar';
import type { DragMode, DragPreview } from '@/hooks/useCalendarDnD';
import { WEEKDAYS, fmtDate, parseDate, addDays } from '@/utils/calendarDate';
import { formatEventChipText } from '@/utils/calendarEventFilter';
import {
  calendarEventLinkedTodoId,
  calendarEventIdentityKey,
  hasSameCalendarEventIdentity,
  type CalendarEventIdentity,
} from '@/utils/calendarEventIdentity';
import { floatingSolidStyle, tooltipGlassStyle } from '@/utils/glassStyles';
import {
  barTooltipAnchor,
  createTooltipWarmth,
  placeAnchoredTooltip,
  tooltipTransform,
  type TooltipAnchor,
} from '@/utils/tooltipPosition';
import { createHoverKeyStore, type HoverKeyStore } from '@/utils/hoverKeyStore';
import { animateEl, EASE_CSS, MOTION_MS } from '@/utils/motion';
import { layoutEventBars, visibleWeekDays, type EventBar } from '@/utils/calendarWeekdays';
import { DayAddButton } from './DayAddButton';
import { DragCreateGhost } from './DragCreateGhost';
import { useProximityReveal } from '@/hooks/useProximityReveal';
import { shouldRevealOnMount } from '@/utils/gridFlip';
import { DragSlideAnchor, DropLanding } from '@/components/ui/DragLanding';
import type { LandingMark, SlideBox } from '@/utils/dragLanding';

// 바 배치는 주말 숨김과 한 몸이라 유틸로 옮겼다. 기존 import 경로는 그대로 살려 둔다.
export { layoutEventBars, type EventBar };

/* 달 전환 — 합성 스레드 슬라이드·최신 방향 퇴장·한 칸 겹침(monthSlideMotion 참고) */
const MONTH_SLIDE_VARIANTS = createMonthSlideVariants(
  24,
  { duration: 0.32, ease: [0.16, 1, 0.3, 1], opacity: { duration: 0.2, ease: 'easeOut' } },
  { duration: 0.22, ease: [0.4, 0, 1, 1], opacity: { duration: 0.16, ease: 'easeIn' } },
);

function countEventsOnDate(events: readonly CalendarEvent[], dateStr: string): number {
  let count = 0;
  for (const event of events) {
    if (event.startDate <= dateStr && event.endDate >= dateStr) count += 1;
  }
  return count;
}


/* ═══════════════════════════════════════════════════
   이벤트 바 컴포넌트 (리퀴드 글라스)
   ═══════════════════════════════════════════════════ */

/** 주 줄 안에서 막대가 차지하는 자리. 막대와 '원래 자리' 흔적이 같은 식을 쓴다. */
function eventBarBox(bar: EventBar, columnCount: number): Pick<React.CSSProperties, 'left' | 'width' | 'top'> {
  return {
    left: `calc(${(bar.startCol / columnCount) * 100}% + 2px)`,
    width: `calc(${(bar.span / columnCount) * 100}% - 4px)`,
    top: `${bar.row * 28 + 36}px`,
  };
}

function eventBarColor(event: CalendarEvent, tags: Parameters<typeof resolveEventTags>[1]): string {
  return resolveEventTags(event, tags)[0]?.color || event.color || EVENT_COLORS[0];
}

/**
 * 끄는 동안 원래 자리에 남는 흐린 점선 흔적(움직임 폴리싱 16번) — '어디서 왔는지'를 보여 준다.
 * 들린 막대보다 아래(z-5)에 깔리고 누를 수 없다.
 */
function EventBarOrigin({ bar, columnCount }: { bar: EventBar; columnCount: number }) {
  const tags = useCalendarStore((state) => state.tags);
  return (
    <div
      aria-hidden="true"
      data-drag-origin="true"
      className={cn('calendar-bar-origin', bar.isStart && 'is-start', bar.isEnd && 'is-end')}
      style={{ ...eventBarBox(bar, columnCount), borderColor: eventBarColor(bar.event, tags) }}
    />
  );
}

/*
 * 일정 막대 설명 카드 (움직임 폴리싱 2번 tooltip-anchor)
 * - 처음 마우스를 올린 막대 위 가운데(막대 위 6px)에 고정한다 — 마우스를 따라 흔들리지 않는다.
 * - 400ms 뒤 투명도 + 6px 아래에서 떠오르기 140ms. 막대가 화면 위쪽에 있으면 막대 아래에 뜬다.
 * - 웜업: 카드가 떠 있다가 옆 막대로 옮기면(숨긴 지 300ms 안) 기다리지 않고 120ms 미끄러져 옮겨 간다.
 *   카드는 막대마다 따로 그려지므로 웜업 기록과 직전 자리는 모듈에서 함께 쓴다.
 * - 동작 줄이기: 투명도만 100ms, 위치 이동은 즉시.
 */
const EVENT_CARD_DELAY = 400;
const EVENT_CARD_GAP = 6;
const eventCardWarmth = createTooltipWarmth();
let eventCardLastTransform: string | null = null;

interface EventCardState {
  anchor: TooltipAnchor;
  /** 웜업으로 뜨는지(기다림·등장 효과 없이 옆 막대에서 미끄러져 옴). */
  warm: boolean;
}

function EventBarChip({
  bar, columnCount, onClick, onDragStart, isDragging,
  hoverStore, onContextMenu, tagNameById, calendarNameById,
  isRealtimeHighlighted, reduceMotion, revealSince = 0,
  slideKey, slideRegistry, landingToken, isBorn,
}: {
  bar: EventBar;
  /** 그 주에 실제로 그려지는 칸 수(주말을 숨기면 5). */
  columnCount: number;
  onClick: (e: CalendarEvent) => void;
  onDragStart?: (event: CalendarEvent, mode: DragMode, anchorDate: string) => void;
  /** 이 막대를 끄는 중 — 살짝 들리고(그림자) 손을 따라 칸 사이를 미끄러진다. */
  isDragging?: boolean;
  /** 마우스가 올라간 일정(여러 주 조각이 함께 밝아진다). 바뀐 막대만 다시 그려진다. */
  hoverStore: HoverKeyStore;
  onContextMenu?: (ev: CalendarEvent, e: React.MouseEvent) => void;
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  isRealtimeHighlighted?: boolean;
  reduceMotion?: boolean;
  /** 태그·캘린더 필터를 바꾼 시각. 그 직후에 새로 생긴 막대만 한 번 떠오른다(움직임 폴리싱 15번). */
  revealSince?: number;
  /** 끄는 동안 같은 조각을 가리키는 이름 — 주를 넘어 새로 붙어도 이전 자리에서 미끄러져 온다. */
  slideKey?: string;
  slideRegistry?: Map<string, SlideBox>;
  /** 방금 놓은 막대 — 값이 바뀔 때마다 '톡' + 링을 새로 튼다. */
  landingToken?: number | null;
  /** 방금 만든 일정 — 굳어지듯 진해지며 한 번 빛난다. */
  isBorn?: boolean;
}) {
  const ev = bar.event;
  // 마운트될 때 한 번만 판정한다 — 클래스를 켰다 끄지 않으므로 이미 있던 막대는 다시 움직이지 않는다.
  // 끄는 중에 새로 붙은 조각(주를 넘어 생긴 조각)은 처음부터 떠오르지 않는다. 판정 뒤에 끄기 여부로 클래스를
  // 뗐다 붙이면 놓는 순간 떠오름이 처음부터 다시 돌아 막대가 투명해졌다가 나타났다(검증 지적 acc-scene-flow-1).
  const revealOnMountRef = useRef<boolean | null>(null);
  if (revealOnMountRef.current === null) {
    revealOnMountRef.current = !reduceMotion && !isDragging && shouldRevealOnMount(revealSince, Date.now());
  }
  const tags = useCalendarStore((state) => state.tags);
  const eventTags = resolveEventTags(ev, tags);
  const hex = eventBarColor(ev, tags);
  const identityKey = calendarEventIdentityKey(ev);
  const [isHovered, setIsHovered] = useState(() => hoverStore.get() === identityKey);
  useEffect(() => {
    const sync = () => setIsHovered(hoverStore.get() === identityKey);
    sync();
    return hoverStore.subscribe(identityKey, sync);
  }, [hoverStore, identityKey]);

  const [card, setCard] = useState<EventCardState | null>(null);
  const cardTimer = useRef<ReturnType<typeof setTimeout>>();
  const cardPos = useRef<HTMLDivElement>(null);
  const cardBox = useRef<HTMLDivElement>(null);
  const cardAnimatedFor = useRef<EventCardState | null>(null);
  useEffect(() => {
    if (!card) return;
    // 스크롤·클릭·Esc 로 닫으면 웜업도 끊는다(다음 막대는 다시 400ms 기다린다).
    const dismiss=()=>{clearTimeout(cardTimer.current);eventCardWarmth.reset();setCard(null);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape')dismiss();};
    document.addEventListener('scroll',dismiss,true);document.addEventListener('pointerdown',dismiss,true);document.addEventListener('keydown',key);
    return()=>{document.removeEventListener('scroll',dismiss,true);document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('keydown',key);};
  }, [card]);
  useEffect(()=>()=>clearTimeout(cardTimer.current),[]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    // 읽기 전용 이벤트: 드래그 불가, 클릭만 처리
    if (ev.isReadOnly || !onDragStart) {
      const onUp = () => {
        document.removeEventListener('mouseup', onUp);
        onClick(ev);
      };
      document.addEventListener('mouseup', onUp);
      return;
    }

    const startX = e.clientX;
    const startY = e.clientY;

    // 리사이즈 핸들 영역 (양쪽 8px)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relRight = rect.width - relX;
    let mode: DragMode;
    if (bar.isStart && relX <= 12) {
      mode = 'resize-start';
    } else if (bar.isEnd && relRight <= 12) {
      mode = 'resize-end';
    } else {
      mode = 'move';
    }

    // 앵커 날짜: 바를 숨기고 아래 셀에서 data-date 추출
    const barEl = e.currentTarget as HTMLElement;
    barEl.style.pointerEvents = 'none';
    const cellEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    barEl.style.pointerEvents = '';
    let anchorDate: string | null = null;
    let cur = cellEl;
    while (cur) {
      anchorDate = cur.getAttribute('data-date');
      if (anchorDate) break;
      cur = cur.parentElement;
    }
    if (!anchorDate) anchorDate = ev.startDate;

    // 클릭 vs 드래그 구분 (5px 임계값)
    const THRESHOLD = 5;
    let dragStarted = false;

    const onMove = (me: MouseEvent) => {
      const dx = me.clientX - startX;
      const dy = me.clientY - startY;
      if (!dragStarted && Math.sqrt(dx * dx + dy * dy) >= THRESHOLD) {
        dragStarted = true;
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        onDragStart(ev, mode, anchorDate!);
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragStarted) {
        onClick(ev); // 이동 없음 → 클릭으로 처리
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 카드 자리는 막대에 들어온 순간 한 번만 정한다(마우스를 움직여도 상태를 바꾸지 않는다).
  const handleEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    hoverStore.set(identityKey);
    const anchor = barTooltipAnchor(e.currentTarget.getBoundingClientRect(), e.clientX);
    clearTimeout(cardTimer.current);
    if (eventCardWarmth.isWarm(performance.now())) {
      setCard({ anchor, warm: true });
      return;
    }
    cardTimer.current = setTimeout(() => setCard({ anchor, warm: false }), EVENT_CARD_DELAY);
  };
  const handleLeave = () => {
    if (hoverStore.get() === identityKey) hoverStore.set(null);
    clearTimeout(cardTimer.current);
    if (card) eventCardWarmth.markHidden(performance.now());
    setCard(null);
  };

  const dateLabel = ev.startDate === ev.endDate
    ? ev.startDate
    : `${ev.startDate} → ${ev.endDate}`;

  // 카드가 그려진 직후(칠하기 전) 실측 크기로 막대 위에 놓는다. 등장 효과는 카드가 새로 뜰 때 한 번만.
  useLayoutEffect(() => {
    if (!card) return;
    const pos = cardPos.current;
    const box = cardBox.current;
    if (!pos || !box) return;
    const placement = placeAnchoredTooltip(
      card.anchor,
      { width: box.offsetWidth, height: box.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { gapAbove: EVENT_CARD_GAP },
    );
    const transform = tooltipTransform(placement);
    pos.style.transform = transform;
    if (cardAnimatedFor.current === card) return; // 내용만 바뀜 — 자리만 다시
    cardAnimatedFor.current = card;
    const previous = eventCardLastTransform;
    eventCardLastTransform = transform;
    if (card.warm) {
      if (!reduceMotion && previous && previous !== transform) {
        animateEl(pos, [{ transform: previous }, { transform }], { duration: MOTION_MS.fast, easing: EASE_CSS.snap }, false);
      }
      return;
    }
    const from = placement.below ? 'translateY(-6px)' : 'translateY(6px)';
    animateEl(
      box,
      [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }],
      { duration: reduceMotion ? 100 : 140, easing: EASE_CSS.out },
      reduceMotion,
    );
  }, [card, reduceMotion, ev.title, ev.memo, dateLabel]);

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onContextMenu={onContextMenu ? (e) => onContextMenu(ev, e) : undefined}
      data-event-id={ev.id}
      data-event-identity={identityKey}
      data-realtime-highlight={isRealtimeHighlighted ? 'true' : undefined}
      data-hovered={!isDragging && isHovered ? 'true' : undefined}
      data-drag-lifted={isDragging ? 'true' : undefined}
      // 끄는 막대는 흐린 점선 대신 진하게 들린다(그림자 층은 CSS ::after, 16번). 칸을 넘을 때의 미끄러짐은
      // DragSlideAnchor 가 translate 로 — left·width 전환은 쓰지 않는다(매 프레임 레이아웃).
      className={cn(
        'absolute text-left calendar-event-bar calendar-bar-motion',
        isDragging ? 'z-30 pointer-events-none calendar-bar-lifted' : 'z-10',
        // 마우스를 올리면 크기는 그대로 두고 테두리·그림자 층만 떠오른다(커지면 작은 글씨가 번졌다, 2번).
        !isDragging && isHovered && 'z-20',
        isBorn && 'calendar-bar-born',
        isRealtimeHighlighted && (reduceMotion ? 'calendar-realtime-highlight-static' : 'calendar-realtime-highlight'),
        'group/bar',
      )}
      style={{
        ...eventBarBox(bar, columnCount),
        height: '26px',
        cursor: ev.isReadOnly ? 'pointer' : isDragging ? 'grabbing' : 'grab',
        ...(isRealtimeHighlighted ? {
          outline: `2px solid ${hex}`,
          outlineOffset: '2px',
          boxShadow: `0 0 12px ${hex}80`,
        } : {}),
      }}
    >
      <div
        className={cn(
          'h-full flex items-center px-2 text-xs font-medium truncate relative',
          bar.isStart ? 'rounded-l-md' : '',
          bar.isEnd ? 'rounded-r-md' : '',
          revealOnMountRef.current && 'sf-cal-bar-reveal',
        )}
        style={{
          // 막대마다 backdrop-filter(흐림)를 걸면 막대 수만큼 합성 레이어·렌더 패스가 생겨
          // 달 전환 때 매 프레임 GPU 가 다시 그린다. 칸 배경이 거의 단색이라 흐림은 눈에 띄지 않는다.
          background: `linear-gradient(135deg, ${hex}40 0%, ${hex}25 100%)`,
          borderTop: `1px solid ${hex}50`,
          borderBottom: `1px solid ${hex}20`,
          borderLeft: bar.isStart ? `3px solid ${hex}` : `1px solid ${hex}30`,
          borderRight: bar.isEnd ? `1px solid ${hex}40` : 'none',
          color: 'rgb(var(--color-text-primary))',
          textShadow: undefined,
        }}
      >
        {/* 리사이즈 핸들 (왼쪽) */}
        {bar.isStart && !isDragging && !ev.isReadOnly && (
          <div className="absolute left-0 top-0 w-[12px] h-full cursor-col-resize opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ backgroundColor: `${hex}40` }}
          />
        )}
        {!bar.isStart && <span className="text-[9px] mr-0.5 opacity-60">◂</span>}
        {ev.type === 'vacation' && <Palmtree size={10} className="shrink-0 mr-1 opacity-80" />}
        {calendarEventLinkedTodoId(ev) && <CheckSquare size={9} className="shrink-0 mr-1 opacity-70" />}
        <span className="truncate min-w-[20px]">{formatEventChipText({ ...ev, tagIds: [], tagId: undefined }, tagNameById, eventTags.length ? {} : calendarNameById)}</span>
        <span className="ml-1 max-w-[55%] shrink min-w-0"><EventTagBadges event={ev} compact /></span>
        {!bar.isEnd && <span className="text-[9px] ml-auto pl-0.5 opacity-60 shrink-0">▸</span>}
        {/* 리사이즈 핸들 (오른쪽) */}
        {bar.isEnd && !isDragging && !ev.isReadOnly && (
          <div className="absolute right-0 top-0 w-[12px] h-full cursor-col-resize opacity-0 group-hover/bar:opacity-100 transition-opacity"
            style={{ backgroundColor: `${hex}40` }}
          />
        )}
      </div>
      {/* 마우스를 올렸을 때 떠오르는 테두리·그림자 층(투명도만 바뀐다 — motion-chrome-popups.css) */}
      {!isDragging && (
        <span
          aria-hidden="true"
          className={cn('calendar-event-bar-ring', bar.isStart && 'rounded-l-md', bar.isEnd && 'rounded-r-md')}
        />
      )}

      {slideKey && slideRegistry && (
        <DragSlideAnchor slideKey={slideKey} registry={slideRegistry} reduce={reduceMotion === true} />
      )}
      {landingToken != null && <DropLanding key={`land-${landingToken}`} color={hex} />}
      {isBorn && <DropLanding key="born" variant="born" color={hex} />}

      {/* 설명 카드 — Portal로 body에 직접 렌더 (부모 transform/overflow 무관). 바깥 상자가 자리, 안쪽 상자가 등장. */}
      {card && !isDragging && createPortal(
        <div ref={cardPos} className="pointer-events-none fixed left-0 top-0 z-[99999]">
          <div
            ref={cardBox}
            role="tooltip"
            className="calendar-event-card rounded-2xl px-4 py-3 max-w-[260px]"
            style={{
              ...tooltipGlassStyle,
              color: 'rgb(var(--color-tooltip-text))',
              maxWidth: 'min(260px, calc(100vw - 16px))',
              maxHeight: 'calc(100vh - 16px)',
              overflow: 'hidden',
            }}
          >
            <div className="text-[13px] font-semibold truncate">{ev.title}</div>
            <EventTagBadges event={ev} tooltip />
            <div className="text-[12px] opacity-85 mt-1">{dateLabel}</div>
            {ev.memo && <div className="text-[11px] opacity-85 mt-1 line-clamp-2">{ev.memo}</div>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════
   "+N more" 오버플로우 팝업
   ═══════════════════════════════════════════════════ */

function OverflowPopup({
  events, date, onClose, onEventClick, anchorRect,
}: {
  events: CalendarEvent[];
  date: string;
  onClose: () => void;
  onEventClick: (e: CalendarEvent) => void;
  anchorRect: DOMRect | null;
}) {
  const d = parseDate(date);
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 캘린더 단축키(C/W/M/?)는 aria-modal 대화상자가 떠 있으면 배경으로 흘러가지 않는다.
  // 이 팝업도 같은 규칙을 따르므로, 닫기는 여기서 Escape로 직접 처리한다.
  useEffect(() => {
    const handleKeyDown = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key !== 'Escape') return;
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // 대화상자를 열면 포커스를 안으로 옮기고, 닫을 때 원래 위치로 돌려준다.
  // 그러지 않으면 키보드 사용자가 팝업 뒤의 캘린더 버튼으로 Tab 이동해 눌러 버린다.
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  const handleDialogKeyDown = (keyboardEvent: ReactKeyboardEvent<HTMLElement>) => {
    if (keyboardEvent.key !== 'Tab') return;
    const focusableElements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    const first = focusableElements[0];
    const last = focusableElements.at(-1);
    if (!first || !last) {
      keyboardEvent.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const activeElement = document.activeElement as HTMLElement | null;
    const isOutsideDialog = !activeElement || !focusableElements.includes(activeElement);
    if (keyboardEvent.shiftKey ? activeElement === first || isOutsideDialog : activeElement === last || isOutsideDialog) {
      keyboardEvent.preventDefault();
      (keyboardEvent.shiftKey ? last : first).focus();
    }
  };

  return (
    <motion.div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${label} 일정 목록`}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15 }}
      className="fixed z-50 rounded-xl p-3 w-64 max-h-72 overflow-y-auto"
      style={{
        ...floatingSolidStyle,
        left: anchorRect ? Math.min(anchorRect.left, window.innerWidth - 280) : 100,
        top: anchorRect ? Math.min(anchorRect.bottom + 4, window.innerHeight - 300) : 100,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text-primary">{label}</span>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label={`${label} 일정 목록 닫기`}
          onClick={onClose}
          className="p-0.5 text-text-secondary hover:text-text-primary cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {events.map((ev) => {
          const isSingle = ev.startDate === ev.endDate;
          const evS = parseDate(ev.startDate);
          const evE = parseDate(ev.endDate);
          const dateRange = isSingle
            ? `${evS.getMonth() + 1}/${evS.getDate()}`
            : `${evS.getMonth() + 1}/${evS.getDate()} → ${evE.getMonth() + 1}/${evE.getDate()}`;
          return (
            <button
              key={calendarEventIdentityKey(ev)}
              onClick={() => { onEventClick(ev); onClose(); }}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-bg-primary/50 transition-colors text-left cursor-pointer"
            >
              <div className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: ev.color }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs text-text-primary truncate block">{ev.title}</span>
                <EventTagBadges event={ev} />
                <span className="text-[11px] text-text-secondary/50 block">{dateRange}</span>
                {ev.memo && <span className="text-[11px] text-text-secondary/40 truncate block">{ev.memo.length > 40 ? ev.memo.slice(0, 40) + '…' : ev.memo}</span>}
              </div>
              <span className="text-[11px] text-text-secondary/50 ml-auto shrink-0">
                {ev.type === 'vacation' ? '휴가' : ev.type !== 'custom' ? ev.type.toUpperCase() : ''}
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════════════
   메인 캘린더 그리드 (월/2주/1주 공용)
   ═══════════════════════════════════════════════════ */

export function CalendarGrid({
  weeks,
  events,
  today,
  currentMonth,
  maxVisibleBars,
  onEventClick,
  onDragStart,
  dragPreview,
  draggedEventIdentity,
  isDragging,
  onCellMouseDown,
  isDateInDragRange,
  createRange,
  onCellActivate,
  onEventContextMenu,
  onWheel,
  monthKey,
  monthDirection = 0,
  instantTransition = false,
  eventsLoaded = true,
  showWeekends = true,
  focusedDate,
  pulseDate,
  highlightedEventIdentities,
  reduceMotion = false,
  filterRevealAt = 0,
  tagNameById,
  calendarNameById,
  landing = null,
  bornEventIdentities,
  createGhostLeaving = false,
}: {
  weeks: Date[][];
  events: CalendarEvent[];
  today: string;
  currentMonth: number;
  maxVisibleBars: number;
  onEventClick: (ev: CalendarEvent) => void;
  onDragStart?: (event: CalendarEvent, mode: DragMode, anchorDate: string) => void;
  dragPreview?: DragPreview | null;
  draggedEventIdentity?: CalendarEventIdentity | null;
  isDragging?: boolean;
  onCellMouseDown?: (e: React.MouseEvent, date: string) => void;
  isDateInDragRange?: (date: string) => boolean;
  /**
   * 지금 만들고 있는 범위. 고스트는 이것만 본다 — 날짜 이동 표시와 완전히 분리된다.
   * 일수(days)도 같이 받아, 주말을 숨겨도 라벨과 실제로 만들어지는 기간이 어긋나지 않는다.
   */
  createRange?: { startDate: string; endDate: string; days: number; dragging: boolean } | null;
  /** 키보드로 + 를 눌렀을 때 — 끌 수가 없으니 그 날 하루로 연다. */
  onCellActivate?: (date: string) => void;
  onWheel?: (e: React.WheelEvent) => void;
  onEventContextMenu?: (ev: CalendarEvent, e: React.MouseEvent) => void;
  monthKey?: string;
  monthDirection?: number;
  instantTransition?: boolean;
  /** 일정 첫 로드가 끝났는지. 로드 전에는 '일정이 없다'고 단정하지 않는다. */
  eventsLoaded?: boolean;
  /** 꺼져 있으면 토·일 칸 자체를 그리지 않는다(주 5일 보기). */
  showWeekends?: boolean;
  focusedDate?: string | null;
  pulseDate?: string | null;
  highlightedEventIdentities?: ReadonlySet<string>;
  reduceMotion?: boolean;
  /** 태그·캘린더 필터를 바꾼 시각(0 이면 없음). 그 직후 새로 보이게 된 막대만 떠오른다. */
  filterRevealAt?: number;
  tagNameById: Record<string, string>;
  calendarNameById: Record<string, string>;
  /** 방금 놓은 일정(identity key)과 착지 순번 — 놓는 즉시 '톡' + 링(저장을 기다리지 않는다). */
  landing?: LandingMark | null;
  /** 방금 만든 일정 — 굳어지듯 진해지며 한 번 빛난다. */
  bornEventIdentities?: ReadonlySet<string>;
  /** '만들기'를 눌렀다 — 유리 막대가 녹아 사라진다(저장에 실패하면 다시 보인다). */
  createGhostLeaving?: boolean;
}) {
  const [overflow, setOverflow] = useState<{ date: string; rect: DOMRect } | null>(null);
  // 마우스가 올라간 일정. 상태로 두면 막대에 올리고 뗄 때마다 달력 전체가 다시 그려지므로
  // 작은 저장소에 두고 바뀐 막대만 알린다.
  const [hoverStore] = useState(createHoverKeyStore);
  // 연타 중이거나 OS '동작 줄이기'면 미끄러지지 않고 바로 바꾼다.
  const instantMonthChange = instantTransition || reduceMotion;
  const monthSlide = useMemo<MonthSlide>(
    () => ({ direction: monthDirection, instant: instantMonthChange }),
    [instantMonthChange, monthDirection],
  );
  // 같은 달로 금방 되돌아오면(A→B→A, A 가 아직 나가는 중) framer-motion 10 의 AnimatePresence 는
  // 나가는 중인 키를 PresenceChild 없이 다시 들이고 그 기록을 남겨, 나중에 그 달이 나갈 때 오래된 화면이
  // 잠깐 비친다. 넘길 때마다 새 키를 써서 나가는 중인 레이어를 다시 쓰지 않는다.
  const monthLayerKeyRef = useRef({ monthKey, seq: 0 });
  if (monthLayerKeyRef.current.monthKey !== monthKey) {
    monthLayerKeyRef.current = { monthKey, seq: monthLayerKeyRef.current.seq + 1 };
  }
  const monthLayerKey = `${monthKey || 'default'}#${monthLayerKeyRef.current.seq}`;

  // 드래그 중이면 프리뷰 날짜로 이벤트를 대체해서 고스트 바 표시
  const displayEvents = useMemo(() => {
    if (!dragPreview) return events;
    return events.map((e) =>
      (draggedEventIdentity
        ? hasSameCalendarEventIdentity(e, draggedEventIdentity)
        : e.id === dragPreview.eventId)
        ? { ...e, startDate: dragPreview.newStartDate, endDate: dragPreview.newEndDate }
        : e,
    );
  }, [events, dragPreview, draggedEventIdentity]);

  // 끄는 중인 일정. 막대가 칸을 넘으면 미끄러지게 끌기마다 새 자리 기록을 쓰고,
  // 원래 자리에는 흐린 점선 흔적을 남긴다(움직임 폴리싱 16번).
  const dragPreviewEventId = isDragging ? dragPreview?.eventId ?? null : null;
  const isDraggedEvent = useCallback((event: CalendarEvent) => Boolean(
    dragPreviewEventId
    && event.id === dragPreviewEventId
    && (draggedEventIdentity ? hasSameCalendarEventIdentity(event, draggedEventIdentity) : true),
  ), [dragPreviewEventId, draggedEventIdentity]);
  const draggedSlideKey = dragPreviewEventId
    ? (draggedEventIdentity ? calendarEventIdentityKey(draggedEventIdentity) : `id:${dragPreviewEventId}`)
    : null;
  const slideRegistryRef = useRef<{ key: string | null; map: Map<string, SlideBox> }>({ key: null, map: new Map() });
  if (slideRegistryRef.current.key !== draggedSlideKey) {
    slideRegistryRef.current = { key: draggedSlideKey, map: new Map() };
  }

  // 주말을 숨기면 토·일 칸 자체를 그리지 않는다. 주 배열 자체는 7일 그대로 두고
  // 렌더 직전에만 걸러, 주 경계·주차 계산은 손대지 않는다.
  const visibleWeeks = useMemo(
    () => weeks.map((week) => visibleWeekDays(week, showWeekends)),
    [showWeekends, weeks],
  );
  const columnCount = visibleWeeks[0]?.length ?? (showWeekends ? 7 : 5);

  const isInCreateRange = useCallback(
    (date: string) => !!createRange && date >= createRange.startDate && date <= createRange.endDate,
    [createRange],
  );

  // 커서와의 거리로 + 버튼을 서서히 드러낸다. 누르고 있는 버튼은 계속 또렷하게.
  const { refresh: refreshReveal } = useProximityReveal({
    radius: 160,
    isPinned: (el) => el.classList.contains('is-active'),
  });
  useEffect(() => { refreshReveal(); }, [visibleWeeks, createRange, refreshReveal]);
  const gridTemplateColumns = `repeat(${columnCount}, minmax(0, 1fr))`;
  const visibleWeekdayLabels = useMemo(
    () => (showWeekends ? WEEKDAYS : WEEKDAYS.filter((_, index) => index !== 0 && index !== 6)),
    [showWeekends],
  );

  // 이번 달에 걸치는 일정이 하나도 없으면 격자만 남아 무엇을 해야 할지 알기 어렵다.
  // 날짜 셀 클릭이 곧 생성 경로이므로 안내는 클릭을 가리지 않게 얹기만 한다.
  const hasCurrentMonthEvent = useMemo(() => visibleWeeks.some((week) => week.some((day) => {
    if (day.getMonth() !== currentMonth) return false;
    const dateStr = fmtDate(day);
    return displayEvents.some((candidate) => candidate.startDate <= dateStr && candidate.endDate >= dateStr);
  })), [currentMonth, displayEvents, visibleWeeks]);

  // 주별 막대 배치와 칸별 일정 수는 일정·주가 바뀔 때만 다시 계산한다.
  // 막대에 마우스를 올릴 때마다(호버 상태) 42칸 × 전체 일정을 다시 훑지 않게 한다.
  const weekModels = useMemo(() => visibleWeeks.map((week) => {
    const dateStrs = week.map(fmtDate);
    return {
      week,
      dateStrs,
      bars: layoutEventBars(displayEvents, week),
      dayEventCounts: dateStrs.map((dateStr) => countEventsOnDate(displayEvents, dateStr)),
      isCurrentWeek: dateStrs.includes(today),
    };
  }), [displayEvents, today, visibleWeeks]);

  // 원래 자리 흔적 — 끌기가 시작될 때 한 번만 원래 배치로 계산한다(끄는 동안 events 는 그대로다).
  const originBarsByWeek = useMemo(() => {
    if (!dragPreviewEventId) return null;
    return visibleWeeks.map((week) => layoutEventBars(events, week)
      .filter((bar) => bar.row < maxVisibleBars && isDraggedEvent(bar.event)));
  }, [dragPreviewEventId, events, isDraggedEvent, maxVisibleBars, visibleWeeks]);

  // 끄는 막대의 주 조각 순번 — 아래 주로 옮겨도 '첫 조각'끼리 이어 미끄러진다.
  const dragSegmentByWeek: number[] = [];
  if (dragPreviewEventId) {
    let segment = 0;
    for (const model of weekModels) {
      dragSegmentByWeek.push(
        model.bars.some((bar) => bar.row < maxVisibleBars && isDraggedEvent(bar.event)) ? segment++ : -1,
      );
    }
  }

  return (
    <div className="flex flex-col flex-1 h-full min-h-0" onWheel={onWheel}>
      {/* 요일 헤더 */}
      <div className="grid mb-0.5 border-b border-bg-border/25" style={{ gridTemplateColumns }}>
        {visibleWeekdayLabels.map((day) => (
          <div
            key={day}
            className={cn(
              'text-center text-xs font-semibold py-2.5 tracking-wider',
              day === '일' ? 'text-[rgb(var(--color-calendar-sunday))]' : day === '토' ? 'text-[rgb(var(--color-calendar-saturday))]' : 'text-text-secondary',
            )}
          >
            {day}
          </div>
        ))}
      </div>

      {/* 주별 행 — flex-1로 화면 꽉 채움, 동적 행 수에 따라 균등 분배.
          나가는 달과 들어오는 달을 같은 격자 칸에 겹쳐 둔다(측정·절대 배치 없이 겹침). */}
      <div className="grid flex-1 min-h-0" style={MONTH_STACK_STYLE}>
      <AnimatePresence initial={false} custom={monthSlide}>
      <motion.div
        key={monthLayerKey}
        custom={monthSlide}
        variants={MONTH_SLIDE_VARIANTS}
        initial={monthSlide.instant ? false : 'enter'}
        animate="center"
        exit="exit"
        className="relative flex flex-col min-h-0 rounded-xl overflow-hidden border border-bg-border/30"
        style={MONTH_LAYER_STYLE}
      >
        {eventsLoaded && !hasCurrentMonthEvent && (
          <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
            <CalendarDays size={36} className="text-text-secondary/60" />
            <span className="text-sm text-text-secondary">이번 달 일정이 없습니다</span>
            <span className="text-[11px] text-text-secondary/60">날짜 옆 + 버튼을 눌러 새 일정을 만들어 보세요</span>
          </div>
        )}
        {weekModels.map(({ week, dateStrs, bars, dayEventCounts, isCurrentWeek }, wi) => {
          // 현재 주 하이라이트
          return (
            <div
              key={wi}
              className={cn("relative grid flex-1 min-h-0", isCurrentWeek && 'bg-accent/[0.03]')}
              style={{ gridTemplateColumns }}
            >
              {createRange && (
                <DragCreateGhost
                  week={dateStrs}
                  isSelected={isInCreateRange}
                  gridTemplateColumns={gridTemplateColumns}
                  totalDays={createRange.days}
                  showLabel={dateStrs.includes(createRange.startDate)}
                  reduceMotion={reduceMotion}
                  dragging={createRange.dragging}
                  leaving={createGhostLeaving}
                />
              )}
              {/* 날짜 셀 배경 */}
              {week.map((day, di) => {
                const dateStr = dateStrs[di];
                const isToday = dateStr === today;
                const isCurMonth = day.getMonth() === currentMonth;
                const dow = day.getDay();

                // 이 날짜에 해당하는 이벤트 수
                const overflowCount = dayEventCounts[di] - maxVisibleBars;

                // 드래그 중 hover 하이라이트
                const isDropTarget = isDragging && dragPreview && (
                  dragPreview.newStartDate <= dateStr && dragPreview.newEndDate >= dateStr
                );

                const isInDragRange = isDateInDragRange?.(dateStr) ?? false;
                const isFocused = focusedDate === dateStr;

                return (
                  <div
                    key={di}
                    data-date={dateStr}
                    className={cn(
                      'bg-bg-primary/50 transition-colors duration-100 relative overflow-hidden border-b border-r border-bg-border/20',
                      isCurMonth ? 'hover:bg-bg-border/15' : 'opacity-30',
                      isToday && 'bg-accent/5',
                      isDropTarget && 'bg-accent/10',
                      isInDragRange && 'bg-accent/15 border-accent/30',
                      isFocused && 'ring-2 ring-inset ring-accent/60 bg-accent/8 z-10',
                    )}
                  >
                    {/* 날짜 번호 + 일정 추가 버튼 */}
                    <div className="p-2 flex items-start justify-between gap-1">
                      <span
                        className={cn(
                          'text-sm tabular-nums inline-flex items-center justify-center font-medium',
                          isToday
                            ? 'bg-accent text-white w-7 h-7 rounded-full text-xs font-bold'
                            : dow === 0 ? 'text-[rgb(var(--color-calendar-sunday))]'
                            : dow === 6 ? 'text-[rgb(var(--color-calendar-saturday))]'
                            : isCurMonth ? 'text-text-primary/80' : 'text-text-secondary/40',
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {onCellMouseDown && (
                        <DayAddButton
                          date={dateStr}
                          label={`${day.getMonth() + 1}월 ${day.getDate()}일`}
                          onStart={onCellMouseDown}
                          onActivate={onCellActivate}
                        />
                      )}
                    </div>
                    {/* 펄스 애니메이션 (navigate-to-date) */}
                    {dateStr === pulseDate && (
                      <motion.div
                        className="absolute inset-0 rounded-lg border-2 border-accent pointer-events-none"
                        style={{ boxShadow: '0 0 12px 4px rgba(108, 92, 231, 0.4), 0 0 24px 8px rgba(108, 92, 231, 0.15)' }}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: [0, 1, 0.6, 1, 0], scale: [0.9, 1.03, 1, 1.02, 1] }}
                        transition={{ duration: 2, ease: 'easeInOut' }}
                      />
                    )}

                    {/* 오버플로우 뱃지 */}
                    {overflowCount > 0 && (
                      <button
                        className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] font-bold text-accent bg-accent/10 px-1.5 py-0.5 rounded-full hover:bg-accent/20 cursor-pointer z-30"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = (e.target as HTMLElement).getBoundingClientRect();
                          setOverflow({ date: dateStr, rect });
                        }}
                      >
                        +{overflowCount} 더보기
                      </button>
                    )}
                  </div>
                );
              })}

              {/* 끄는 동안 원래 자리 흔적 */}
              {originBarsByWeek?.[wi]?.map((bar) => (
                <EventBarOrigin key={`origin-${calendarEventIdentityKey(bar.event)}`} bar={bar} columnCount={columnCount} />
              ))}

              {/* 이벤트 바 (오버레이) */}
              {bars.filter((b) => b.row < maxVisibleBars).map((bar) => {
                const barIsDragging = isDraggedEvent(bar.event);
                const identityKey = calendarEventIdentityKey(bar.event);
                return (
                  <EventBarChip
                    // 칸(col)은 key 에 넣지 않는다 — 넣으면 칸을 넘을 때마다 새로 붙어 미끄러지지 못하고 순간이동한다.
                    key={`${identityKey}-w${wi}`}
                    bar={bar}
                    columnCount={columnCount}
                    onClick={onEventClick}
                    onDragStart={onDragStart}
                    isDragging={barIsDragging}
                    slideKey={barIsDragging && draggedSlideKey ? `${draggedSlideKey}#${dragSegmentByWeek[wi]}` : undefined}
                    slideRegistry={barIsDragging ? slideRegistryRef.current.map : undefined}
                    landingToken={landing && landing.key === identityKey ? landing.seq : null}
                    isBorn={bornEventIdentities?.has(identityKey) === true}
                    hoverStore={hoverStore}
                    onContextMenu={onEventContextMenu}
                    tagNameById={tagNameById}
                    calendarNameById={calendarNameById}
                    isRealtimeHighlighted={highlightedEventIdentities?.has(identityKey)}
                    reduceMotion={reduceMotion}
                    revealSince={filterRevealAt}
                  />
                );
              })}
            </div>
          );
        })}
      </motion.div>
      </AnimatePresence>
      </div>

      {/* 오버플로우 팝업 */}
      <AnimatePresence>
        {overflow && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOverflow(null)} />
            <OverflowPopup
              events={events.filter(
                (e) => e.startDate <= overflow.date && e.endDate >= overflow.date,
              )}
              date={overflow.date}
              onClose={() => setOverflow(null)}
              onEventClick={onEventClick}
              anchorRect={overflow.rect}
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
