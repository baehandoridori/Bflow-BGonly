import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
 * 드롭다운은 createPortal로 렌더링 (overflow 클리핑 방지).
 */
export function AssigneeSelect({ value, onChange, placeholder = '담당자', className = '' }: AssigneeSelectProps) {
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
        listRef.current && !listRef.current.contains(target)
      ) {
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
          if (e.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-bg-primary border border-bg-border rounded-lg px-3 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent transition-colors"
      />
      {open && filtered.length > 0 && dropdownPos && createPortal(
        <div
          ref={listRef}
          className="bg-bg-card border border-bg-border rounded-lg shadow-xl max-h-40 overflow-auto"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
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
                <span style={{ color }}>{u.name}</span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
