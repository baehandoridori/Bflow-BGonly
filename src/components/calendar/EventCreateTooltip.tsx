/**
 * EventCreateTooltip — Google Calendar 스타일 이벤트 생성 팝업
 *
 * 셀 클릭 또는 드래그 완료 시 앵커 요소 근처에 표시되는 글래스모피즘 팝업.
 * createPortal로 document.body에 렌더링되어 z-index 이슈를 방지한다.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { EVENT_COLORS } from '@/types/calendar';

// ─── 타입 ─────────────────────────────────────────

export interface EventCreateTooltipProps {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  anchorElement: HTMLElement | null;
  onSave: (title: string, color: string) => void;
  onOpenDetail: (title: string, color: string) => void;
  onClose: () => void;
}

// ─── 상수 ─────────────────────────────────────────

const TOOLTIP_WIDTH = 260;
const GAP = 8;
const VIEWPORT_MARGIN = 8;
const ARROW_SIZE = 6;

type Placement = 'bottom' | 'top' | 'right' | 'left';

// ─── 유틸 ─────────────────────────────────────────

/** 요일 한글 약자 */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function formatDateLabel(startDate: string, endDate: string): string {
  const s = new Date(startDate + 'T00:00:00');
  const e = new Date(endDate + 'T00:00:00');
  const sMonth = s.getMonth() + 1;
  const sDay = s.getDate();
  const sDow = DAY_NAMES[s.getDay()];

  if (startDate === endDate) {
    return `\u{1F4C5} ${sMonth}/${sDay}(${sDow})`;
  }

  const eMonth = e.getMonth() + 1;
  const eDay = e.getDate();
  const eDow = DAY_NAMES[e.getDay()];
  const diffDays = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  return `\u{1F4C5} ${sMonth}/${sDay}(${sDow}) \u2192 ${eMonth}/${eDay}(${eDow}) ${diffDays}일`;
}

/** 앵커 기준 최적 배치를 계산한다 (아래→위→오른쪽→왼쪽) */
function computePosition(
  anchorRect: DOMRect,
  tooltipHeight: number,
): { x: number; y: number; placement: Placement } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 아래 (기본)
  const belowY = anchorRect.bottom + GAP;
  if (belowY + tooltipHeight < vh - VIEWPORT_MARGIN) {
    const x = clampX(anchorRect.left + anchorRect.width / 2 - TOOLTIP_WIDTH / 2, vw);
    return { x, y: belowY, placement: 'bottom' };
  }

  // 위
  const aboveY = anchorRect.top - GAP - tooltipHeight;
  if (aboveY > VIEWPORT_MARGIN) {
    const x = clampX(anchorRect.left + anchorRect.width / 2 - TOOLTIP_WIDTH / 2, vw);
    return { x, y: aboveY, placement: 'top' };
  }

  // 오른쪽
  const rightX = anchorRect.right + GAP;
  if (rightX + TOOLTIP_WIDTH < vw - VIEWPORT_MARGIN) {
    const y = clampY(anchorRect.top + anchorRect.height / 2 - tooltipHeight / 2, vh, tooltipHeight);
    return { x: rightX, y, placement: 'right' };
  }

  // 왼쪽
  const leftX = anchorRect.left - GAP - TOOLTIP_WIDTH;
  const y = clampY(anchorRect.top + anchorRect.height / 2 - tooltipHeight / 2, vh, tooltipHeight);
  return { x: Math.max(VIEWPORT_MARGIN, leftX), y, placement: 'left' };
}

function clampX(x: number, vw: number) {
  return Math.max(VIEWPORT_MARGIN, Math.min(x, vw - TOOLTIP_WIDTH - VIEWPORT_MARGIN));
}

function clampY(y: number, vh: number, h: number) {
  return Math.max(VIEWPORT_MARGIN, Math.min(y, vh - h - VIEWPORT_MARGIN));
}

/** 화살표 위치/방향 CSS */
function getArrowStyle(placement: Placement, anchorRect: DOMRect, tooltipX: number, tooltipY: number) {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderStyle: 'solid',
  };
  const color = 'rgba(26,29,39,0.97)';

  switch (placement) {
    case 'bottom': {
      const arrowLeft = Math.min(
        Math.max(12, anchorRect.left + anchorRect.width / 2 - tooltipX),
        TOOLTIP_WIDTH - 12,
      );
      return {
        ...base,
        top: -ARROW_SIZE,
        left: arrowLeft,
        transform: 'translateX(-50%)',
        borderWidth: `0 ${ARROW_SIZE}px ${ARROW_SIZE}px ${ARROW_SIZE}px`,
        borderColor: `transparent transparent ${color} transparent`,
      } as React.CSSProperties;
    }
    case 'top': {
      const arrowLeft = Math.min(
        Math.max(12, anchorRect.left + anchorRect.width / 2 - tooltipX),
        TOOLTIP_WIDTH - 12,
      );
      return {
        ...base,
        bottom: -ARROW_SIZE,
        left: arrowLeft,
        transform: 'translateX(-50%)',
        borderWidth: `${ARROW_SIZE}px ${ARROW_SIZE}px 0 ${ARROW_SIZE}px`,
        borderColor: `${color} transparent transparent transparent`,
      } as React.CSSProperties;
    }
    case 'right': {
      const arrowTop = Math.min(
        Math.max(12, anchorRect.top + anchorRect.height / 2 - tooltipY),
        200,
      );
      return {
        ...base,
        left: -ARROW_SIZE,
        top: arrowTop,
        transform: 'translateY(-50%)',
        borderWidth: `${ARROW_SIZE}px ${ARROW_SIZE}px ${ARROW_SIZE}px 0`,
        borderColor: `transparent ${color} transparent transparent`,
      } as React.CSSProperties;
    }
    case 'left': {
      const arrowTop = Math.min(
        Math.max(12, anchorRect.top + anchorRect.height / 2 - tooltipY),
        200,
      );
      return {
        ...base,
        right: -ARROW_SIZE,
        top: arrowTop,
        transform: 'translateY(-50%)',
        borderWidth: `${ARROW_SIZE}px 0 ${ARROW_SIZE}px ${ARROW_SIZE}px`,
        borderColor: `transparent transparent transparent ${color}`,
      } as React.CSSProperties;
    }
  }
}

// ─── 컴포넌트 ─────────────────────────────────────

export function EventCreateTooltip({
  startDate,
  endDate,
  anchorElement,
  onSave,
  onOpenDetail,
  onClose,
}: EventCreateTooltipProps) {
  const [title, setTitle] = useState('');
  const [selectedColor, setSelectedColor] = useState<string>(EVENT_COLORS[0]);
  const [pos, setPos] = useState<{ x: number; y: number; placement: Placement } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const dateLabel = useMemo(() => formatDateLabel(startDate, endDate), [startDate, endDate]);

  // 위치 계산 (앵커 변경 또는 리사이즈 시)
  const updatePosition = useCallback(() => {
    if (!anchorElement || !containerRef.current) return;
    const anchorRect = anchorElement.getBoundingClientRect();
    const tooltipHeight = containerRef.current.offsetHeight;
    setPos(computePosition(anchorRect, tooltipHeight));
  }, [anchorElement]);

  // 마운트 후 위치 계산 + 포커스
  useEffect(() => {
    // 첫 프레임에서 높이를 알 수 없으므로 rAF 사용
    requestAnimationFrame(() => {
      updatePosition();
      inputRef.current?.focus();
    });
  }, [updatePosition]);

  // 리사이즈/스크롤 대응
  useEffect(() => {
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  // ESC + 외부 클릭
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey);
    // mousedown을 다음 틱에 등록하여 생성 클릭이 즉시 닫지 않도록 함
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onClose]);

  // Enter 키 → 저장
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && title.trim()) {
        e.preventDefault();
        onSave(title.trim(), selectedColor);
      }
    },
    [title, selectedColor, onSave],
  );

  const handleSave = useCallback(() => {
    if (title.trim()) onSave(title.trim(), selectedColor);
  }, [title, selectedColor, onSave]);

  const handleOpenDetail = useCallback(() => {
    onOpenDetail(title.trim(), selectedColor);
  }, [title, selectedColor, onOpenDetail]);

  // 모션 방향
  const motionInitial = useMemo(() => {
    switch (pos?.placement) {
      case 'bottom': return { opacity: 0, scale: 0.95, y: -6 };
      case 'top':    return { opacity: 0, scale: 0.95, y: 6 };
      case 'right':  return { opacity: 0, scale: 0.95, x: -6 };
      case 'left':   return { opacity: 0, scale: 0.95, x: 6 };
      default:       return { opacity: 0, scale: 0.95 };
    }
  }, [pos?.placement]);

  if (!anchorElement) return null;

  const tooltipContent = (
    <AnimatePresence>
      <motion.div
        ref={containerRef}
        initial={motionInitial}
        animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.15, ease: [0.2, 0, 0, 1] }}
        className="fixed z-[9999]"
        style={{
          width: TOOLTIP_WIDTH,
          left: pos?.x ?? -9999,
          top: pos?.y ?? -9999,
          visibility: pos ? 'visible' : 'hidden',
        }}
      >
        {/* 글래스모피즘 카드 */}
        <div
          className="relative rounded-xl overflow-hidden"
          style={{
            background: 'rgba(26,29,39,0.97)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid #2D3041',
            boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
            borderRadius: 12,
          }}
        >
          {/* 유리 반사 하이라이트 */}
          <div
            className="absolute inset-x-0 top-0 h-[40%] rounded-t-xl pointer-events-none"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%)',
            }}
          />

          <div className="relative p-3 flex flex-col gap-2.5">
            {/* 제목 입력 */}
            <input
              ref={inputRef}
              type="text"
              placeholder="제목 추가"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent text-sm text-[#E8E8EE] placeholder-[#8B8DA3] outline-none pb-1.5"
              style={{ borderBottom: '1px solid #2D3041' }}
              maxLength={100}
            />

            {/* 날짜 표시 */}
            <div className="text-xs text-[#8B8DA3] select-none">
              {dateLabel}
            </div>

            {/* 색상 팔레트 */}
            <div className="flex items-center gap-1.5">
              {EVENT_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(color)}
                  className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-110 cursor-pointer"
                  style={{
                    backgroundColor: color,
                    border: selectedColor === color ? '2px solid #fff' : '2px solid transparent',
                  }}
                  title={color}
                >
                  {selectedColor === color && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path
                        d="M2 5.2L4.2 7.4L8 3"
                        stroke="#fff"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            {/* 버튼 행 */}
            <div className="flex items-center gap-2 pt-0.5">
              <button
                type="button"
                disabled={!title.trim()}
                onClick={handleSave}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer"
                style={{
                  background: title.trim() ? '#6C5CE7' : 'rgba(108,92,231,0.3)',
                  color: title.trim() ? '#fff' : 'rgba(255,255,255,0.4)',
                  cursor: title.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                저장
              </button>
              <button
                type="button"
                onClick={handleOpenDetail}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-[#8B8DA3] hover:text-[#E8E8EE] transition-colors cursor-pointer"
                style={{ background: 'rgba(45,48,65,0.6)' }}
              >
                상세 설정 &rarr;
              </button>
            </div>
          </div>

          {/* 화살표 */}
          {pos && <div style={getArrowStyle(pos.placement, anchorElement.getBoundingClientRect(), pos.x, pos.y)} />}
        </div>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(tooltipContent, document.body);
}
