import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';

const HEIGHT_KEY = 'bflow.background-map.panel-height.v1';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
function readHeight(): number | null {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(value) && value >= 180 && value <= 2000 ? value : null;
  } catch { return null; }
}
function storeHeight(value: number | null) {
  try {
    if (value === null) localStorage.removeItem(HEIGHT_KEY);
    else localStorage.setItem(HEIGHT_KEY, String(value));
  } catch { /* A display preference must not block browsing. */ }
}

export function BackgroundMapPanels({ children, gallery }: { children: ReactNode; gallery: ReactNode }) {
  const panelsRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const separatorRef = useRef<HTMLDivElement>(null);
  const [preferredHeight, setPreferredHeight] = useState(readHeight);
  const [size, setSize] = useState({ min: 180, max: 2000, height: 330 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; y: number; height: number; previous: number | null; moved: boolean } | null>(null);
  const height = preferredHeight === null ? size.height : clamp(preferredHeight, size.min, size.max);

  useEffect(() => {
    const panels = panelsRef.current, workspace = workspaceRef.current, separator = separatorRef.current;
    if (!panels || !workspace || !separator) return;
    const canvas = workspace.querySelector<HTMLElement>('.bmap-canvas-wrap');
    const measure = () => {
      const narrow = window.matchMedia('(max-width: 900px)').matches;
      const min = narrow ? 220 : 180;
      const max = narrow ? Math.max(330, Math.min(900, window.innerHeight - 180))
        : Math.max(min, panels.clientHeight - separator.offsetHeight - 160);
      const measured = (narrow ? canvas : workspace)?.getBoundingClientRect().height ?? min;
      if (measured <= 0) return;
      const next = { min, max, height: Math.round(measured) };
      setSize(previous => previous.min === min && previous.max === max && previous.height === next.height ? previous : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panels);
    observer.observe(workspace);
    if (canvas) observer.observe(canvas);
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);

  function setHeight(value: number | null, save = false) {
    const next = value === null ? null : Math.round(clamp(value, size.min, size.max));
    setPreferredHeight(next);
    if (save) storeHeight(next);
  }
  function finish(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (cancelled) setPreferredHeight(active.previous);
    else if (active.moved) setHeight(active.height + event.clientY - active.y, true);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div ref={panelsRef} className={`bmap-panels${preferredHeight === null ? '' : ' is-sized'}${dragging ? ' is-resizing' : ''}`}
    style={preferredHeight === null ? undefined : { '--bmap-panel-height': `${height}px` } as CSSProperties}>
    <div ref={workspaceRef} className="bmap-workspace" id="bmap-workspace">{children}</div>
    <div ref={separatorRef} className="bmap-panel-separator" role="separator" tabIndex={0}
      aria-label="도면 높이 조절" aria-orientation="horizontal" aria-controls="bmap-workspace"
      aria-valuemin={size.min} aria-valuemax={size.max} aria-valuenow={Math.round(clamp(height, size.min, size.max))}
      aria-valuetext={`도면 높이 ${Math.round(height)}픽셀`}
      title="위아래로 드래그해 도면 높이 조절 · 더블클릭하면 기본 높이"
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary || drag.current) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        drag.current = { pointerId: event.pointerId, y: event.clientY, height, previous: preferredHeight, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId && (active.moved || event.clientY !== active.y)) {
          active.moved = true; setHeight(active.height + event.clientY - active.y);
        }
      }}
      onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
      onLostPointerCapture={event => finish(event, true)}
      onDoubleClick={() => setHeight(null, true)}
      onKeyDown={event => {
        event.stopPropagation();
        if (drag.current) return;
        const step = event.shiftKey ? 60 : 24;
        const next = event.key === 'ArrowUp' ? height - step : event.key === 'ArrowDown' ? height + step
          : event.key === 'Home' ? size.min : event.key === 'End' ? size.max : undefined;
        if (next !== undefined) { event.preventDefault(); setHeight(next, true); }
        else if (event.key === 'Enter') { event.preventDefault(); setHeight(null, true); }
      }}>
      <span className="bmap-panel-grip" aria-hidden="true" />
      <span aria-hidden="true">높이 조절</span>
    </div>
    {gallery}
  </div>;
}
