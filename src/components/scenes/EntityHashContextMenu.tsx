/**
 * EntityHashContextMenu — #씬·#파트·#화 칩 우클릭 메뉴 (리테이크 4c PR3).
 *
 * 항목:
 *   - 이동      : onNavigate(target) 호출 → 해당 씬/파트/화로 점프.
 *   - 옆에 띄우기: onReference(target) 호출 → 좌/우 도킹 참조 패널로 열기.
 *                  #씬 타겟에만 표시 (#파트/#화 는 참조 패널 미지원).
 *
 * SceneContextMenu 와 동일한 패턴(portal 대신 fixed, Esc/outside-mousedown 닫기).
 */

import { useEffect, useRef } from 'react';
import { ArrowRight, PanelRight } from 'lucide-react';
import type { HashTarget } from '@/utils/hashEntity';

export interface EntityHashContextMenuProps {
  target: HashTarget;
  x: number;
  y: number;
  onClose: () => void;
  onNavigate: (t: HashTarget) => void;
  onReference: (t: HashTarget) => void;
}

export function EntityHashContextMenu({
  target,
  x,
  y,
  onClose,
  onNavigate,
  onReference,
}: EntityHashContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Esc / 외부 클릭 닫기
  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // 화면 경계 자동 보정 — 메뉴가 잘리지 않게
  const menuWidth = 180;
  const menuHeight = target.kind === 'scene' ? 100 : 60;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 8);

  const kindLabel =
    target.kind === 'scene' ? '씬' : target.kind === 'part' ? '파트' : '화';

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: 'fixed',
        left: adjustedX,
        top: adjustedY,
        zIndex: 9999,
        width: menuWidth,
      }}
      className="bg-bg-card border border-bg-border rounded-lg shadow-2xl p-1.5 select-none"
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-1.5 text-[10px] font-bold text-text-secondary uppercase tracking-wider">
        #{kindLabel}
      </div>

      <HashMenuItem
        icon={<ArrowRight size={13} />}
        onClick={() => { onNavigate(target); onClose(); }}
      >
        이동
      </HashMenuItem>

      {target.kind === 'scene' && (
        <HashMenuItem
          icon={<PanelRight size={13} />}
          onClick={() => { onReference(target); onClose(); }}
        >
          옆에 띄우기
        </HashMenuItem>
      )}
    </div>
  );
}

function HashMenuItem({
  children,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12px] text-left transition-colors text-text-primary cursor-pointer hover:bg-accent/10 hover:text-accent"
    >
      {icon && (
        <span className="inline-flex items-center justify-center w-[22px] h-4 flex-shrink-0">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
