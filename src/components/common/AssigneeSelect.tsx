import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/stores/useAuthStore';
import { getUserColor } from '@/utils/userColor';

export { getUserColor };

interface AssigneeSelectProps {
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
  placeholder?: string;
  className?: string;
}

/**
 * 사용자 목록 기반 담당자 선택 드롭다운.
 * 텍스트 입력으로 필터링, 직접 입력도 가능.
 * Enter 시 드롭다운 맨 위 항목 자동 선택.
 * 드롭다운은 createPortal로 렌더링 (overflow 클리핑 방지).
 */
export function AssigneeSelect({ value, onChange, onClose, placeholder = '담당자', className = '' }: AssigneeSelectProps) {
  const { users } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // value가 외부에서 바뀌면 query도 동기화
  useEffect(() => { setQuery(value); }, [value]);

  // 드롭다운 위치 계산
  const updateDropdownPos = useCallback(() => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setDropdownPos({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  }, []);

  // open 상태 변경 시 위치 업데이트
  useEffect(() => {
    if (open) updateDropdownPos();
  }, [open, updateDropdownPos]);

  // 스크롤/리사이즈 시 위치 재계산
  useEffect(() => {
    if (!open) return;
    const update = () => updateDropdownPos();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, updateDropdownPos]);

  // 외부 클릭 시 닫기 (포탈 드롭다운 포함)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        ref.current && !ref.current.contains(target) &&
        (!listRef.current || !listRef.current.contains(target))
      ) {
        setOpen(false);
        if (query !== value) onChange(query);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, query, value, onChange, onClose]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q));
  }, [users, query]);

  // 필터 변경 시 하이라이트 인덱스 리셋
  useEffect(() => { setHighlightIndex(0); }, [filtered.length]);

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (open && filtered.length > 0) {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setHighlightIndex((prev) => (prev + 1) % filtered.length);
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlightIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
              return;
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const selected = filtered.length > 0 ? filtered[highlightIndex].name : query;
            onChange(selected);
            setQuery(selected);
            setOpen(false);
          }
          if (e.key === 'Escape') { setOpen(false); onClose?.(); }
        }}
        placeholder={placeholder}
        className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
      />
      {open && filtered.length > 0 && dropdownPos && createPortal(
        <div
          ref={listRef}
          className="bg-bg-card border border-bg-border rounded-lg shadow-xl max-h-80 overflow-auto"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            // 최소 너비 보장 — 테이블뷰의 좁은 담당자 셀에서도 이름이 세로로 잘리지 않게
            minWidth: Math.max(dropdownPos.width, 180),
            maxWidth: 280,
            zIndex: 9999,
          }}
        >
          {filtered.map((u, i) => {
            const color = getUserColor(u.name);
            const isActive = i === highlightIndex;
            return (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlightIndex(i)}
                onClick={() => {
                  onChange(u.name);
                  setQuery(u.name);
                  setOpen(false);
                }}
                ref={(el) => {
                  if (isActive && el && listRef.current) {
                    const listRect = listRef.current.getBoundingClientRect();
                    const itemRect = el.getBoundingClientRect();
                    if (itemRect.bottom > listRect.bottom) el.scrollIntoView({ block: 'nearest' });
                    if (itemRect.top < listRect.top) el.scrollIntoView({ block: 'nearest' });
                  }
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                  isActive ? 'bg-accent/10' : 'hover:bg-accent/10'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="whitespace-nowrap" style={{ color }}>{u.name}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
