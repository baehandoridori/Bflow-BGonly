import { useState, useEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/utils/cn';
import { CompactIconLabel } from '@/components/common/CompactIconLabel';
import { floatingGlassStyle } from '@/utils/glassStyles';

export interface GlassDropdownOption<T extends string | number = string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  sublabel?: string;
  separatorAfter?: boolean;
  disabled?: boolean;
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
  disabled?: boolean;
  portal?: boolean;
  portalOwner?: string;
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
  disabled = false,
  portal = false,
  portalOwner,
}: GlassDropdownProps<T>) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [focusIdx, setFocusIdx] = useState(-1);
  const [openUpward, setOpenUpward] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const menuId = useId();
  const [placement, setPlacement] = useState({left: 0, top: 0, width: minWidth, maxHeight: 320});
  const close = useCallback(() => {
    setOpen(false);
    setFocusIdx(-1);
  }, []);

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
      const target = e.target as Node;
      if (containerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {if (disabled) close();}, [disabled, close]);
  const handleKey = (e: React.KeyboardEvent) => {
      if (disabled) return;
      const enabled = allItems.map((item, index) => !(item as GlassDropdownOption<T>).disabled ? index : -1).filter(index => index >= 0);
      if (!open) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();e.stopPropagation();setOpen(true);setFocusIdx(e.key === 'ArrowDown' ? enabled[0] ?? -1 : enabled.at(-1) ?? -1);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();e.stopPropagation();
        setFocusIdx(enabled.find(index => index > focusIdx) ?? enabled.at(-1) ?? -1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();e.stopPropagation();
        setFocusIdx([...enabled].reverse().find(index => index < focusIdx) ?? enabled[0] ?? -1);
      } else if ((e.key === 'Enter' || e.key === ' ') && enabled.includes(focusIdx)) {
        e.preventDefault();e.stopPropagation();
        onChange(allItems[focusIdx].value);
        close();
        triggerRef.current?.focus({preventScroll: true});
      } else if (e.key === 'Escape') {
        e.preventDefault();e.stopPropagation();close();triggerRef.current?.focus();
      } else if (e.key === 'Tab') {
        close();
      }
  };

  // 포커스 항목 스크롤
  useEffect(() => {
    if (!open || focusIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-option-index="${focusIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [focusIdx, open, label]);

  const toggle = useCallback(() => {
    if (disabled) return;
    setOpen((p) => !p);
    setFocusIdx(-1);
  }, [disabled]);

  const updateMenuPlacement = useCallback(() => {
    if (!open || !triggerRef.current || typeof window === 'undefined') return;

    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(320, listRef.current?.scrollHeight || allItems.length * 40 + (label ? 34 : 0) + 12);
    const viewportPadding = 8;
    const gap = 8;
    const below = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
    const above = Math.max(0, rect.top - gap - viewportPadding);
    const shouldOpenUp = menuHeight > below && above > below;
    setOpenUpward(shouldOpenUp);
    const width = Math.min(Math.max(minWidth, rect.width), window.innerWidth - 16);
    const maxHeight = Math.min(320, shouldOpenUp ? above : below);
    setPlacement({left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: shouldOpenUp ? Math.max(8, rect.top - gap - Math.min(menuHeight, maxHeight)) : rect.bottom + gap, width, maxHeight});
  }, [allItems.length, label, open, minWidth]);

  useEffect(() => {
    if (!open) {
      setOpenUpward(false);
      return;
    }

    const raf = requestAnimationFrame(updateMenuPlacement);
    window.addEventListener('resize', updateMenuPlacement);
    window.addEventListener('scroll', updateMenuPlacement, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', updateMenuPlacement);
      window.removeEventListener('scroll', updateMenuPlacement, true);
    };
  }, [open, updateMenuPlacement]);

  return (
    <div ref={containerRef} onKeyDown={handleKey} className={cn('relative', className)}>
      {/* 트리거 버튼 */}
      <button
        type="button"
        ref={triggerRef}
        onClick={toggle}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-activedescendant={open && focusIdx >= 0 ? `${menuId}-${focusIdx}` : undefined}
        className={cn(
          'compact-label-container flex min-w-0 max-w-full items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium',
          'transition-colors duration-150',
          'bg-bg-primary border border-bg-border',
          'text-text-primary hover:border-accent/40',
          open && 'border-accent/50',
        )}
        title={selectedLabel}
        aria-label={label ? `${label}: ${selectedLabel}` : selectedLabel}
      >
        {icon ? (
          <CompactIconLabel icon={icon} label={selectedLabel} />
        ) : (
          <span className="min-w-0 truncate">{selectedLabel}</span>
        )}
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-text-secondary transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* 드롭다운 메뉴 */}
      {(() => {const menu = <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? false : {
              opacity: 0,
              y: openUpward ? 8 : -8,
              scale: 0.96,
            }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? {opacity: 0} : {
              opacity: 0,
              y: openUpward ? 8 : -8,
              scale: 0.96,
            }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            className={cn(
              portal ? 'fixed z-[1000]' : 'absolute left-0 z-[80]',
              !portal && (openUpward ? 'bottom-full mb-2' : 'top-full mt-2'),
            )}
            style={portal ? {left: placement.left, top: placement.top, width: placement.width} : {minWidth: Math.max(minWidth, triggerRef.current?.offsetWidth ?? minWidth)}}
          >
            <div
              ref={listRef}
              id={menuId}
              role="listbox"
              data-dropdown-owner={portalOwner}
              aria-label={label || selectedLabel}
              className="rounded-xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto"
              style={{
                ...floatingGlassStyle,
                maxHeight: placement.maxHeight,
              }}
            >
              {label && (
                <div className="px-3 py-1.5 text-[11px] font-medium text-text-secondary">
                  {label}
                </div>
              )}

              {allItems.map((opt, idx) => {
                const isSelected = value === opt.value;
                const isFocused = focusIdx === idx;
                const fullOpt = opt as GlassDropdownOption<T>;
                return (
                  <div key={`${String(opt.value)}:${idx}`}>
                    <button
                      type="button"
                      id={`${menuId}-${idx}`}
                      data-option-index={idx}
                      role="option"
                      aria-selected={isSelected}
                      disabled={disabled || fullOpt.disabled}
                      tabIndex={-1}
                      onClick={() => {
                        if (disabled || fullOpt.disabled) return;
                        onChange(opt.value);
                        close();
                        triggerRef.current?.focus({preventScroll: true});
                      }}
                      onMouseEnter={() => {if (!fullOpt.disabled) setFocusIdx(idx);}}
                      onContextMenu={
                        onItemContextMenu
                          ? (e) => {
                              onItemContextMenu(opt.value, e);
                              close();
                            }
                          : undefined
                      }
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left text-sm cursor-pointer',
                        'transition-colors duration-75',
                        fullOpt.disabled && 'opacity-40 cursor-default',
                        isFocused
                          ? 'bg-accent/12 text-text-primary'
                          : 'text-text-primary hover:bg-accent/8',
                      )}
                    >
                      {fullOpt.icon && (
                        <span className="shrink-0">
                          {fullOpt.icon}
                        </span>
                      )}
                      <span className="flex-1 truncate">{opt.label}</span>
                      {fullOpt.sublabel && (
                        <span className="text-xs text-text-secondary">
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
      </AnimatePresence>;return portal && typeof document !== 'undefined' ? createPortal(menu, triggerRef.current?.closest('dialog') || document.body) : menu;})()}
    </div>
  );
}
