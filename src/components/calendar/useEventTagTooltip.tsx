import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CalendarEvent } from '@/types/calendar';
import { tooltipGlassStyle } from '@/utils/glassStyles';
import { EventTagBadges } from './EventTagBadges';

/** Shared hover surface; it never participates in the event's fixed grid geometry. */
export function useEventTagTooltip() {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const [hover, setHover] = useState<{ event: CalendarEvent; x: number; y: number } | null>(null);
  const hide = () => { clearTimeout(timer.current); setHover(null); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    document.addEventListener('scroll', hide, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer.current); document.removeEventListener('scroll', hide, true); document.removeEventListener('pointerdown', hide, true); document.removeEventListener('keydown', onKey); };
  }, []);
  const bind = (event: CalendarEvent) => ({
    onMouseEnter: (mouse: MouseEvent) => {
      clearTimeout(timer.current);
      const { clientX: x, clientY: y } = mouse;
      timer.current = setTimeout(() => setHover({ event, x, y }), 400);
    },
    onMouseLeave: hide,
  });
  const tooltip = hover ? createPortal(<div role="tooltip" className="pointer-events-none fixed z-[99999] w-[260px] max-w-[calc(100vw-16px)] rounded-xl px-3 py-2.5" style={{ ...tooltipGlassStyle, color: 'rgb(var(--color-tooltip-text))', left: Math.max(8, Math.min(hover.x - 130, window.innerWidth - 268)), top: Math.max(8, Math.min(hover.y + 18, window.innerHeight - 180)) }}>
    <div className="text-xs font-semibold break-words">{hover.event.title}</div>
    <EventTagBadges event={hover.event} tooltip />
    <div className="mt-1.5 text-[11px] opacity-80">{hover.event.startDate}{hover.event.endDate !== hover.event.startDate ? ` → ${hover.event.endDate}` : ''}</div>
    {hover.event.memo && <div className="mt-1 text-[11px] opacity-80 line-clamp-2">{hover.event.memo}</div>}
  </div>, document.body) : null;
  return { bind, tooltip };
}
