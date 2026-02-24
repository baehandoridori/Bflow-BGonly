import { useState, useEffect, useRef, useCallback } from 'react';

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
      className="fixed z-[999] min-w-[160px] py-1 rounded-lg shadow-xl border"
      style={{
        left: adjusted.x,
        top: adjusted.y,
        background: 'rgb(var(--color-bg-card))',
        borderColor: 'rgb(var(--color-bg-border))',
      }}
    >
      {items.map((item, i) => (
        <button
          key={i}
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
