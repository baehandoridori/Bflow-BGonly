import { useState, useRef, useEffect, useMemo } from 'react';
import { useAuthStore } from '@/stores/useAuthStore';

interface AssigneeSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// 어두운 배경(#0F1117)에서 잘 보이는 색상 팔레트
const USER_COLORS = [
  '#6C5CE7', // 보라
  '#00B894', // 민트
  '#E17055', // 코랄
  '#74B9FF', // 하늘
  '#FDCB6E', // 골드
  '#A29BFE', // 라벤더
  '#FF6B6B', // 로즈
  '#55EFC4', // 청록
  '#FAB1A0', // 살몬
  '#81ECEC', // 시안
  '#DFE6E9', // 실버
  '#FF9FF3', // 핑크
  '#48DBFB', // 아쿠아
  '#FECA57', // 노랑
  '#F368E0', // 마젠타
  '#1DD1A1', // 에메랄드
];

/** 사용자 이름 → 고유 색상 (이름 해시 기반) */
export function getUserColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
}

/**
 * 사용자 목록 기반 담당자 선택 드롭다운.
 * 텍스트 입력으로 필터링, 직접 입력도 가능.
 * Enter 시 드롭다운 맨 위 항목 자동 선택.
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
            // 드롭다운에 필터 결과가 있으면 맨 위 항목 자동 선택
            const selected = filtered.length > 0 ? filtered[0].name : query;
            onChange(selected);
            setQuery(selected);
            setOpen(false);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-bg-card border border-bg-border rounded-lg shadow-xl max-h-40 overflow-auto z-50">
          {filtered.map((u, i) => {
            const color = getUserColor(u.name);
            return (
              <button
                key={u.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(u.name);
                  setQuery(u.name);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                  i === 0 ? 'bg-accent/10' : 'hover:bg-accent/10'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span style={{ color }}>{u.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
