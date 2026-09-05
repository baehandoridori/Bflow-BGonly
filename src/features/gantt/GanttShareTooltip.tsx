import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UsersRound } from 'lucide-react';
import { tooltipGlassStyle } from '@/utils/glassStyles';
import type { GanttSpace } from './types';

export function GanttShareTooltip({space, users}: {space: GanttSpace; users: Array<{id: string; name: string}>}) {
  const [shown, setShown] = useState(false);
  const [point, setPoint] = useState({x: 0, y: 0});
  const [position, setPosition] = useState({left: 0, top: 0});
  const anchor = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inside = useRef({badge: false, tooltip: false, focus: false});
  const members = useMemo(() => {
    const names = new Map(users.map(user => [user.id, user.name]));
    return space.members.filter(member => member.userId !== space.ownerId).map(member => ({
      ...member, name: names.get(member.userId)?.trim() || '이름 미등록',
    }));
  }, [space.members, space.ownerId, users]);
  const tooltipId = `gantt-share-${space.id}`;
  const hide = useCallback(() => {clearTimeout(timer.current);inside.current.tooltip = false;setShown(false);}, []);
  const showAt = (x: number, y: number) => {
    clearTimeout(timer.current);setPoint({x, y});
    // Same entry/exit delays as the app's global and Gantt tooltips.
    timer.current = setTimeout(() => setShown(true), 120);
  };
  const showAtAnchor = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();showAt((rect.left + rect.right) / 2, rect.bottom);
  };
  const leave = () => {
    if (inside.current.badge || inside.current.tooltip || inside.current.focus) return;
    clearTimeout(timer.current);timer.current = setTimeout(() => setShown(false), 60);
  };
  useEffect(() => {
    hide();
    const dismissOutside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (anchor.current?.contains(target) || box.current?.contains(target))) return;
      hide();
    };
    const key = (event: KeyboardEvent) => {if (event.key === 'Escape') hide();};
    window.addEventListener('scroll', dismissOutside, true);
    window.addEventListener('pointerdown', dismissOutside, true);
    window.addEventListener('wheel', dismissOutside, {passive: true});
    window.addEventListener('blur', hide);
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('scroll', dismissOutside, true);
      window.removeEventListener('pointerdown', dismissOutside, true);
      window.removeEventListener('wheel', dismissOutside);
      window.removeEventListener('blur', hide);
      window.removeEventListener('keydown', key);
    };
  }, [hide, space.id, space.shared]);
  useLayoutEffect(() => {
    if (!shown || !box.current) return;
    const {width, height} = box.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(point.x - width / 2, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(point.y - height - 12 < 8 ? point.y + 16 : point.y - height - 12, window.innerHeight - height - 8)),
    });
  }, [shown, point, members]);
  if (!space.shared) return null;
  return <>
    <button ref={anchor} type="button" className="gantt-share-count" aria-label={`공유된 팀원 ${members.length}명`} aria-describedby={shown ? tooltipId : undefined}
      onPointerEnter={event => {inside.current.badge = true;showAt(event.clientX, event.clientY);}}
      onPointerMove={event => {if (inside.current.badge) setPoint({x: event.clientX, y: event.clientY});}}
      onPointerLeave={() => {inside.current.badge = false;leave();}}
      onFocus={event => {inside.current.focus = true;showAtAnchor(event.currentTarget);}}
      onBlur={() => {inside.current.focus = false;leave();}}
      onClick={event => {event.preventDefault();event.stopPropagation();if (!shown) showAtAnchor(event.currentTarget);}}>
      <UsersRound size={12} aria-hidden="true"/>공유 {members.length}명
    </button>
    {shown && createPortal(<div ref={box} role="tooltip" id={tooltipId} className="gantt-share-tooltip" style={{...tooltipGlassStyle, ...position}}
      onPointerEnter={() => {inside.current.tooltip = true;clearTimeout(timer.current);}}
      onPointerLeave={() => {inside.current.tooltip = false;leave();}}>
      <strong>공유된 팀원 · {members.length}명</strong>
      {members.length ? <ul>{members.map(member => <li key={member.userId}><span>{member.name}</span><small>{member.canEdit ? '편집' : '보기'}</small></li>)}</ul> : <p>아직 공유된 팀원이 없습니다.</p>}
    </div>, document.body)}
  </>;
}
