import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { getUserColor } from '@/utils/userColor';

/**
 * 다중 담당자 선택 — 칩 + 자동완성 (한솔 결정 2026-05-02).
 *
 * 데이터 형식:
 *   - value: 콤마(', ') 구분 문자열 — 기존 Scene.assignee (string) 와 호환
 *   - 표시: split → 칩 배열, 저장: trim 후 join
 *
 * UX:
 *   - 입력 필드에 자동완성 드롭다운 (사용자 목록 fuzzy filter)
 *   - Enter / 드롭다운 클릭 → 칩 추가
 *   - 사용자 목록에 없는 이름도 Enter 로 자유 칩 추가 (외부 인력)
 *   - × 클릭 또는 backspace (입력 비었을 때) 로 칩 제거
 *   - 중복 칩 자동 dedup
 */

export interface AssigneeMultiSelectProps {
  value: string;
  onChange: (value: string) => void;
  onClose?: () => void;
  placeholder?: string;
  className?: string;
  /** 자동 포커스 (편집 모드 진입 시) */
  autoFocus?: boolean;
}

function parseValue(value: string): string[] {
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}
function joinValue(chips: string[]): string {
  return chips.map((s) => s.trim()).filter(Boolean).join(', ');
}

export function AssigneeMultiSelect({
  value,
  onChange,
  onClose,
  placeholder = '담당자 추가',
  className = '',
  autoFocus = false,
}: AssigneeMultiSelectProps) {
  const { users } = useAuthStore();
  const [chips, setChips] = useState<string[]>(() => parseValue(value));
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 외부 value 변경 시 chips sync
  useEffect(() => { setChips(parseValue(value)); }, [value]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);

  // 드롭다운 위치 계산
  const updatePos = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => { if (open) updatePos(); }, [open, updatePos]);
  useEffect(() => {
    if (!open) return;
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, updatePos]);

  // 외부 클릭 시 닫기 + commit (query 가 남아있으면 자유 칩으로 추가)
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        wrapRef.current && !wrapRef.current.contains(t) &&
        (!listRef.current || !listRef.current.contains(t))
      ) {
        commitQueryAsChip();
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, chips, onClose]);

  // 자동완성 후보 — 이미 칩에 있는 사용자는 제외, query fuzzy
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const chipSet = new Set(chips);
    return users
      .filter((u) => !chipSet.has(u.name))
      .filter((u) => !q || u.name.toLowerCase().includes(q));
  }, [users, query, chips]);

  useEffect(() => { setHighlightIndex(0); }, [filtered.length]);

  // 칩 추가 (dedup)
  // v1.26.1: setChips updater 내부에서 onChange 를 호출하면 React 가 그 호출을
  //          렌더 단계로 인식해 "Cannot update a component while rendering" 경고.
  //          updater 외부 동기 경로에서 onChange 를 호출하도록 정정.
  const addChip = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (chips.includes(trimmed)) { setQuery(''); return; }
    const next = [...chips, trimmed];
    setChips(next);
    onChange(joinValue(next));
    setQuery('');
  }, [chips, onChange]);

  // 칩 제거
  const removeChip = useCallback((name: string) => {
    if (!chips.includes(name)) return;
    const next = chips.filter((c) => c !== name);
    setChips(next);
    onChange(joinValue(next));
    inputRef.current?.focus();
  }, [chips, onChange]);

  // 빈 input 에서 backspace → 마지막 칩 제거
  const handleBackspace = useCallback(() => {
    if (query.length > 0) return false;
    setChips((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.slice(0, -1);
      onChange(joinValue(next));
      return next;
    });
    return true;
  }, [query, onChange]);

  // input commit — query 가 자동완성 첫 항목이면 그것 추가, 아니면 자유 칩
  const commitQueryAsChip = useCallback(() => {
    const q = query.trim();
    if (!q) return;
    // 정확히 매칭되는 user 가 있으면 그 이름 사용, 없으면 자유 칩
    const exact = users.find((u) => u.name.toLowerCase() === q.toLowerCase());
    addChip(exact?.name ?? q);
  }, [query, users, addChip]);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div
        className="flex flex-wrap items-center gap-1 px-2 py-1.5 rounded-md border border-bg-border focus-within:border-accent/60 bg-bg-primary min-h-[36px]"
        onClick={() => inputRef.current?.focus()}
      >
        {chips.map((name) => (
          <AssigneeChip key={name} name={name} onRemove={() => removeChip(name)} />
        ))}
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
                setHighlightIndex((p) => (p + 1) % filtered.length);
                return;
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightIndex((p) => (p - 1 + filtered.length) % filtered.length);
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                addChip(filtered[highlightIndex].name);
                return;
              }
            }
            // Codex R2 P2 (2026-05-03): 자동완성 매치 없을 때도 Tab/Enter 로 자유 칩 commit.
            // 기존엔 filtered.length === 0 케이스에서 Tab 이 아무 작업 안 해 키보드만 쓰면
            // 외부 인력 이름이 unmount 시 사라짐 (close/blur commit 만 의존).
            if ((e.key === 'Enter' || e.key === 'Tab') && query.trim().length > 0) {
              e.preventDefault();
              commitQueryAsChip();
              return;
            }
            if (e.key === 'Backspace' && handleBackspace()) {
              e.preventDefault();
              return;
            }
            if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
              onClose?.();
              return;
            }
            if (e.key === ',' || e.key === ';') {
              // 쉼표/세미콜론으로도 칩 분리
              e.preventDefault();
              commitQueryAsChip();
              return;
            }
          }}
          placeholder={chips.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-text-primary placeholder:text-text-secondary/40"
        />
      </div>

      {/* 자동완성 드롭다운 — portal 로 overflow 회피 */}
      {open && dropdownPos && filtered.length > 0 && createPortal(
        <div
          ref={listRef}
          // mousedown 을 막아 외부 클릭 handler 발동 방지 (commitQueryAsChip 중복 호출 회피).
          // 한솔 self-review (2026-05-02): mousedown(외부 commit) → mouseup → click(addChip) 순서로
          // onChange 가 두 번 호출되고 query 가 자유 칩으로 오삽입되는 문제.
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[10000] bg-bg-card border border-bg-border rounded-lg shadow-2xl max-h-56 overflow-y-auto"
          style={{ top: dropdownPos.top, left: dropdownPos.left, width: Math.max(dropdownPos.width, 200) }}
        >
          {filtered.map((u, i) => (
            <button
              key={u.id}
              type="button"
              onClick={() => addChip(u.name)}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 cursor-pointer transition-colors ${
                i === highlightIndex ? 'bg-accent/15' : 'hover:bg-accent/10'
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: getUserColor(u.name) }}
                aria-hidden
              />
              <span className="text-text-primary">{u.name}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/* ── 단일 칩 ─────────────────────────────────────── */

export function AssigneeChip({
  name,
  onRemove,
  size = 'md',
}: {
  name: string;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  const color = getUserColor(name);
  const py = size === 'sm' ? 0 : 0.5;
  const fs = size === 'sm' ? 11 : 12;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 font-medium tabular-nums"
      style={{
        background: `${color}1f`,
        color,
        fontSize: fs,
        paddingTop: py * 4,
        paddingBottom: py * 4,
        border: `1px solid ${color}40`,
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: color }}
        aria-hidden
      />
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 -mr-0.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-black/20 cursor-pointer transition-colors"
          aria-label={`${name} 제거`}
          title="제거"
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
    </span>
  );
}

/* ── 표시 전용 헬퍼 (편집 X) — 시트뷰 셀에서 first chip + +N ─── */

export function AssigneeChipList({
  value,
  size = 'md',
  maxVisible,
}: {
  value: string;
  size?: 'sm' | 'md';
  maxVisible?: number;
}) {
  const chips = useMemo(() => parseValue(value), [value]);
  if (chips.length === 0) {
    return <span className="text-xs text-text-secondary/50">담당자 없음</span>;
  }
  if (typeof maxVisible === 'number' && chips.length > maxVisible) {
    const visible = chips.slice(0, maxVisible);
    const more = chips.length - maxVisible;
    return (
      <span className="inline-flex items-center gap-1 flex-wrap" title={chips.join(', ')}>
        {visible.map((n) => <AssigneeChip key={n} name={n} size={size} />)}
        <span className="text-[10.5px] text-text-secondary/70 tabular-nums">+{more}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {chips.map((n) => <AssigneeChip key={n} name={n} size={size} />)}
    </span>
  );
}
