import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';

export interface GlassDropdownOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  sublabel?: string;
  separatorAfter?: boolean;
}

interface GlassDropdownProps<T extends string | number = string> {
  options: GlassDropdownOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  triggerLabel?: string;
  label?: string;
  allOption?: { value: T; label: string };
  onItemContextMenu?: (value: T, e: React.MouseEvent) => void;
  className?: string;
  icon?: React.ReactNode;
  minWidth?: number;
}

export function GlassDropdown<T extends string | number = string>({
  options,
  value,
  onChange,
  triggerLabel,
  label,
  allOption,
  onItemContextMenu,
  className,
  icon,
  minWidth = 160,
}: GlassDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 전체 옵션 + 일반 옵션 결합
  const allItems = allOption ? [allOption, ...options] : options;

  // 현재 선택된 항목의 라벨
  const selectedLabel =
    triggerLabel ??
    allItems.find((o) => o.value === value)?.label ??
    (allOption ? allOption.label : '선택');

  // 외부 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 키보드 내비게이션
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((p) => Math.min(p + 1, allItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((p) => Math.max(p - 1, 0));
      } else if (e.key === 'Enter' && focusIdx >= 0 && focusIdx < allItems.length) {
        e.preventDefault();
        onChange(allItems[focusIdx].value);
        setOpen(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, focusIdx, allItems, onChange]);

  // 포커스 항목 스크롤
  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const el = listRef.current.children[label ? focusIdx + 1 : focusIdx] as HTMLElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open, label]);

  const toggle = useCallback(() => {
    setOpen((p) => !p);
    setFocusIdx(-1);
  }, []);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* 트리거 버튼 */}
      <button
        onClick={toggle}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
          'transition-colors duration-150',
          'bg-bg-primary border border-bg-border',
          'text-text-primary hover:border-accent/40',
          open && 'border-accent/50',
        )}
      >
        {icon}
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={14}
          className={cn(
            'text-text-secondary transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* 드롭다운 메뉴 */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1.5 z-50"
            style={{ minWidth }}
          >
            <div
              ref={listRef}
              className="rounded-xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto"
              style={{
                backgroundColor: 'rgb(var(--color-bg-card) / 0.92)',
                border: '1px solid rgb(var(--color-bg-border) / 0.6)',
                boxShadow:
                  '0 12px 32px rgb(var(--color-shadow) / var(--shadow-alpha)), 0 0 0 1px rgb(var(--color-glass-highlight) / var(--glass-highlight-alpha)) inset',
                backdropFilter: 'blur(12px)',
              }}
            >
              {/* 헤더 라벨 */}
              {label && (
                <div className="px-3 py-1.5 text-[11px] font-medium text-text-secondary/50 uppercase tracking-wider">
                  {label}
                </div>
              )}

              {/* 옵션 목록 */}
              {allItems.map((opt, idx) => {
                const isSelected = value === opt.value;
                const isFocused = focusIdx === idx;
                const fullOpt = opt as GlassDropdownOption<T>;
                return (
                  <div key={String(opt.value)}>
                    <button
                      onClick={() => {
                        onChange(opt.value);
                        setOpen(false);
                      }}
                      onMouseEnter={() => setFocusIdx(idx)}
                      onContextMenu={
                        onItemContextMenu
                          ? (e) => onItemContextMenu(opt.value, e)
                          : undefined
                      }
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                        'transition-colors duration-75',
                        isFocused
                          ? 'bg-accent/12 text-text-primary'
                          : 'text-text-primary/80 hover:bg-accent/8',
                      )}
                    >
                      {fullOpt.icon && (
                        <span className="shrink-0">
                          {fullOpt.icon}
                        </span>
                      )}
                      <span className="flex-1 truncate">{opt.label}</span>
                      {fullOpt.sublabel && (
                        <span className="text-xs text-text-secondary/60">
                          {fullOpt.sublabel}
                        </span>
                      )}
                      {isSelected && <Check size={14} className="text-accent shrink-0" />}
                    </button>
                    {fullOpt.separatorAfter && (
                      <div className="my-1 mx-2 border-t border-bg-border/50" />
                    )}
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
