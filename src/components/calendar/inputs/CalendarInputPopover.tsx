import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { calendarPopoverPosition } from './calendarInputModel';
import './calendarInputs.css';

export function CalendarInputPopover({ anchor, owner, width = 324, height = 420, onClose, children, label, role = 'dialog' }: {
  anchor: RefObject<HTMLElement>; owner: RefObject<HTMLElement>; width?: number; height?: number;
  onClose(restoreFocus?: boolean): void; children: ReactNode; label: string; role?: 'dialog' | 'listbox';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  const [position, setPosition] = useState({ left: 8, top: 8, width, maxHeight: height });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();if (!rect) return;
      setPosition(calendarPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, width, height));
    };
    place();window.addEventListener('resize', place);window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place);window.removeEventListener('scroll', place, true); };
  }, [anchor, width, height]);
  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (!target || owner.current?.contains(target) || panel.current?.contains(target)) return;
      close.current(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();close.current(true);
    };
    document.addEventListener('mousedown', outside, true);document.addEventListener('focusin', outside, true);document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('mousedown', outside, true);document.removeEventListener('focusin', outside, true);document.removeEventListener('keydown', keyboard, true); };
  }, [owner]);
  // Native dialog popups must remain in the top layer and inside its focus boundary.
  const target = anchor.current?.closest('dialog') ?? document.body;
  return createPortal(<div ref={panel} role={role} aria-label={label} data-calendar-input-popover="" className="calendar-input-popover" style={position}
    onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>{children}</div>, target);
}
