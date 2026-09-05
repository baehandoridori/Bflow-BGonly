import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tooltipGlassStyle } from '@/utils/glassStyles';
import type { GanttTask } from './types';

export interface GanttHover { task: GanttTask; x: number; y: number; workers: string }
export function GanttTooltip({ hover }: { hover: GanttHover | null }) {
  const [shown, setShown] = useState<GanttHover | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const shownId = useRef('');
  const latest = useRef(hover);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  latest.current = hover;
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { shownId.current = latest.current?.task.id || ''; setShown(latest.current); }, hover ? 120 : 60);
    return () => clearTimeout(timer.current);
  }, [hover?.task.id]);
  useEffect(() => { if (hover && shownId.current === hover.task.id) setShown(hover); }, [hover]);
  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); shownId.current = ''; setShown(null); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
    window.addEventListener('scroll', hide, true); window.addEventListener('pointerdown', hide, true);
    window.addEventListener('wheel', hide, { passive: true }); window.addEventListener('blur', hide);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('pointerdown', hide, true); window.removeEventListener('wheel', hide); window.removeEventListener('blur', hide); window.removeEventListener('keydown', key); };
  }, []);
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(shown.x - width / 2, innerWidth - width - 8)), top: Math.max(8, Math.min(shown.y - height - 12 < 8 ? shown.y + 16 : shown.y - height - 12, innerHeight - height - 8)) });
  }, [shown]);
  if (!shown) return null;
  const t = shown.task;
  return createPortal(<div ref={box} role="tooltip" id="gantt-hover" className="gantt-hover" style={{ ...tooltipGlassStyle, ...position }}>
    <strong>{t.title}</strong><div>{t.startDate} {t.allDay ? '' : t.startTime} — {t.endDate} {t.allDay ? '· 하루 종일' : t.endTime}</div>
    {shown.workers && <small>작업자 · {shown.workers}</small>}{t.memo && <p>{t.memo}</p>}
  </div>, document.body);
}
