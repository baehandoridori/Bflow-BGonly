/**
 * 글로벌 리퀴드글래스 툴팁 — title 속성 자동 인터셉트
 *
 * 앱 전체의 [title] 요소에 빠르고 세련된 글래스모피즘 툴팁을 적용한다.
 * 이벤트 위임으로 동작하므로 기존 코드 수정 없이 적용 가능.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface TooltipState {
  text: string;
  x: number;
  y: number;
  position: 'top' | 'bottom';
}

const SHOW_DELAY = 120;  // ms — 네이티브(~500ms) 대비 훨씬 빠름
const HIDE_DELAY = 60;

export function GlobalTooltipProvider() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const currentEl = useRef<HTMLElement | null>(null);
  const originalTitle = useRef<string>('');

  const restoreTitle = useCallback(() => {
    if (currentEl.current && originalTitle.current) {
      currentEl.current.setAttribute('title', originalTitle.current);
    }
    currentEl.current = null;
    originalTitle.current = '';
  }, []);

  const hide = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => {
      setTooltip(null);
      restoreTitle();
    }, HIDE_DELAY);
  }, [restoreTitle]);

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null;
      if (!target) return;

      const title = target.getAttribute('title');
      if (!title?.trim()) return;

      // 이미 같은 요소 → 무시
      if (target === currentEl.current) return;

      // 이전 타이머 정리
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);

      // 이전 요소의 title 복원
      restoreTitle();

      // 네이티브 툴팁 방지: title 제거
      currentEl.current = target;
      originalTitle.current = title;
      target.removeAttribute('title');

      showTimer.current = setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        // 위/아래 자동: 화면 상단 120px 이내면 아래, 그 외 위
        const showBelow = rect.top < 120;
        const y = showBelow ? rect.bottom + 8 : rect.top - 8;

        setTooltip({
          text: title,
          x: centerX,
          y,
          position: showBelow ? 'bottom' : 'top',
        });
      }, SHOW_DELAY);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null;
      const related = (e.relatedTarget as HTMLElement)?.closest?.('[title]') as HTMLElement | null;

      // 같은 title 요소 내에서 이동 → 유지
      if (target && target === related) return;
      // currentEl에서 벗어남
      if (currentEl.current && !currentEl.current.contains(e.relatedTarget as Node)) {
        hide();
      }
    };

    const handleScroll = () => {
      clearTimeout(showTimer.current);
      setTooltip(null);
      restoreTitle();
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('scroll', handleScroll, true);
    document.addEventListener('mousedown', handleScroll, true);

    return () => {
      clearTimeout(showTimer.current);
      clearTimeout(hideTimer.current);
      restoreTitle();
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('mousedown', handleScroll, true);
    };
  }, [hide, restoreTitle]);

  return (
    <AnimatePresence>
      {tooltip && (
        <motion.div
          key={tooltip.text + tooltip.x}
          initial={{ opacity: 0, scale: 0.92, y: tooltip.position === 'top' ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ duration: 0.12, ease: [0.2, 0, 0, 1] }}
          className="fixed z-[99999] pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: `translateX(-50%) translateY(${tooltip.position === 'top' ? '-100%' : '0'})`,
          }}
        >
          {/* 리퀴드글래스 컨테이너 */}
          <div
            className="relative px-3 py-1.5 rounded-lg text-xs font-medium text-tooltip-text/90 whitespace-nowrap max-w-[280px] overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, rgb(var(--color-tooltip-bg) / 0.92) 0%, rgb(var(--color-tooltip-bg) / 0.96) 100%)',
              backdropFilter: 'blur(16px) saturate(1.6)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.6)',
              border: '1px solid rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha))',
              boxShadow: `
                0 4px 16px rgb(var(--color-shadow) / var(--shadow-alpha)),
                0 0 0 0.5px rgb(var(--color-glass-highlight) / 0.05) inset,
                0 1px 0 rgb(var(--color-glass-highlight) / 0.06) inset
              `,
            }}
          >
            {/* 상단 하이라이트 (유리 반사) */}
            <div
              className="absolute inset-x-0 top-0 h-[40%] rounded-t-lg pointer-events-none"
              style={{
                background: 'linear-gradient(180deg, rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) 0%, transparent 100%)',
              }}
            />
            <span className="relative">{tooltip.text}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
