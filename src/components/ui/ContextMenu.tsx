import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { clampMenuToViewport, popClassName, popOriginFromPoint, popOriginStyle, type PopOrigin } from '@/utils/popupMotion';

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState(position);
  const [origin, setOrigin] = useState<PopOrigin | null>(null);

  // 화면 밖으로 나가지 않도록 위치 조정 — 그리기 전에(useLayoutEffect) 맞춰야 첫 프레임이 엉뚱한 자리에 뜨지 않는다.
  // 피어나는 기준점은 보정된 자리 기준으로 누른 지점(화면 끝에서 밀려나면 기준도 반대 모서리로 뒤집힌다).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const next = clampMenuToViewport(position, rect, { width: window.innerWidth, height: window.innerHeight });
    setAdjusted(next);
    setOrigin(popOriginFromPoint(position, { left: next.x, top: next.y, width: rect.width, height: rect.height }));
  }, [position]);

  // 외부 클릭/ESC 닫기
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

  return (
    <div
      ref={ref}
      className={`${popClassName(origin)} fixed z-[999] min-w-[160px] py-1 rounded-lg shadow-xl border`}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      style={{
        ...popOriginStyle(origin),
        left: adjusted.x,
        top: adjusted.y,
        background: 'rgb(var(--color-bg-card))',
        borderColor: 'rgb(var(--color-bg-border))',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          type="button"
          disabled={item.disabled}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer
            ${item.danger
              ? 'text-red-400 hover:bg-red-500/10'
              : 'text-text-primary hover:bg-bg-border/40'}
            ${item.disabled ? 'opacity-40 cursor-not-allowed' : ''}
          `}
        >
          {item.icon && <span className="w-4 shrink-0 flex items-center justify-center">{item.icon}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** 컨텍스트 메뉴 state 관리 훅 */
export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const openMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  return { menuPosition: menu, openMenu, closeMenu };
}
