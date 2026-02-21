import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';

interface AssigneeSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 사용자 목록 기반 담당자 선택 드롭다운.
 * 텍스트 입력으로 필터링, 직접 입력도 가능.
 */
export function AssigneeSelect({ value, onChange, placeholder = '담당자', className = '' }: AssigneeSelectProps) {
  const { users } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // value가 외부에서 바뀌면 query도 동기화
  useEffect(() => { setQuery(value); }, [value]);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        // 닫힐 때 현재 query를 확정
        if (query !== value) onChange(query);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, query, value, onChange]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q));
  }, [users, query]);

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
          if (e.key === 'Enter') {
            e.preventDefault();
            onChange(query);
            setOpen(false);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-bg-card border border-bg-border rounded-lg shadow-xl max-h-40 overflow-auto z-50">
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(u.name);
                setQuery(u.name);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-text-primary hover:bg-accent/20 transition-colors"
            >
              {u.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
