/**
 * v1.26.0 — 라이트박스 이미지 우클릭 메뉴.
 *
 * 4개 항목: 다운로드 / 이미지 복사 / 이미지 URL 복사 / 주석 새 버전으로 그리기.
 * 화면 경계 보정 + 외부 클릭 시 자동 닫힘.
 */

import { useEffect, useRef } from 'react';
import { Download, Copy, Link as LinkIcon, Edit3 } from 'lucide-react';
import { cn } from '@/utils/cn';

export type ContextAction = 'download' | 'copy' | 'copy-url' | 'annotate';

interface ImageContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  containerWidth: number;
  containerHeight: number;
  actions?: ContextAction[];
  onAction: (action: ContextAction) => void;
  onClose: () => void;
}

const MENU_W = 220;
const MENU_ITEM_H = 40;
const MENU_PADDING_H = 12;

export function ImageContextMenu({
  open,
  x,
  y,
  containerWidth,
  containerHeight,
  actions,
  onAction,
  onClose,
}: ImageContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const enabledActions = actions ?? ['download', 'copy', 'copy-url', 'annotate'];
  const showAnnotate = enabledActions.includes('annotate');

  useEffect(() => {
    if (!open) return;
    // v1.26.2: 자기 자신을 여는 우클릭(pointerdown + mousedown + contextmenu)이
    //          mount 직후 close 트리거하지 않도록 150ms 인큐베이션 윈도우.
    // v1.26.3: framer-motion / React 합성 이벤트 stopPropagation 우회 위해
    //          capture phase + mousedown/click 두 종류 모두 listen.
    const mountTime = Date.now();
    const handler = (e: MouseEvent) => {
      if (Date.now() - mountTime < 150) return;
      if (e.button === 2) return; // 우클릭은 contextmenu 에서 별도 처리
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    const ctxHandler = (e: MouseEvent) => {
      if (Date.now() - mountTime < 150) return;
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('click', handler, true);
    document.addEventListener('contextmenu', ctxHandler, true);
    return () => {
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('click', handler, true);
      document.removeEventListener('contextmenu', ctxHandler, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  // 경계 보정 — 메뉴가 컨테이너 밖으로 벗어나지 않게
  const menuHeight = enabledActions.length * MENU_ITEM_H + MENU_PADDING_H + (showAnnotate ? 5 : 0);
  const left = Math.max(4, Math.min(x, containerWidth - MENU_W - 4));
  const top = Math.max(4, Math.min(y, containerHeight - menuHeight - 4));

  const Item = ({
    icon: Icon,
    label,
    action,
    shortcut,
  }: {
    icon: typeof Download;
    label: string;
    action: ContextAction;
    shortcut?: string;
  }) => (
    <button
      type="button"
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm text-text-primary',
        'hover:bg-accent/[0.14] hover:text-accent-sub transition-colors',
      )}
      onClick={(e) => {
        e.stopPropagation();
        onAction(action);
        onClose();
      }}
    >
      <Icon size={15} className="text-text-secondary" />
      <span>{label}</span>
      {shortcut && <span className="ml-auto text-[11px] text-text-secondary/50 font-mono">{shortcut}</span>}
    </button>
  );

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-bg-card border border-bg-border rounded-xl p-1.5 shadow-2xl animate-fade-in"
      style={{ left, top, minWidth: MENU_W }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {enabledActions.includes('download') && (
        <Item icon={Download} label="다운로드" action="download" shortcut="Ctrl+S" />
      )}
      {enabledActions.includes('copy') && (
        <Item icon={Copy} label="이미지 복사" action="copy" shortcut="Ctrl+C" />
      )}
      {enabledActions.includes('copy-url') && (
        <Item icon={LinkIcon} label="이미지 URL 복사" action="copy-url" />
      )}
      {showAnnotate && (
        <>
          <div className="h-px bg-bg-border/50 my-1" />
          <Item icon={Edit3} label="주석 새 버전으로 그리기" action="annotate" />
        </>
      )}
    </div>
  );
}
