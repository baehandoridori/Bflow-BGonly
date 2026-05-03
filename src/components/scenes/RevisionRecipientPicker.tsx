/**
 * RevisionRecipientPicker — 리비전 등록 폼 "알림 받을 사람" 선택 위젯
 *
 * v1.18.0 (한솔 결정 — spec 2026-05-03):
 *   - 자동 체크 칩 + 사용자가 추가로 선택한 칩을 union 으로 표시.
 *   - 자동 체크된 칩도 클릭하면 unchecked (회색 + check 아이콘 사라짐).
 *   - "+ 다른 사람 추가" 버튼 → 검색 드롭다운 → 클릭 시 칩 추가 (자동 체크된 사람은 검색 결과에서 제외).
 *   - onChange(checkedIds) 로 부모(폼)에 전달 → handleSubmit 에서 createRevision({notifyUserIds}) 호출.
 *
 * 디자인: docs/mockups/revision-detail.html 의 ".user-chip" 영역과 1:1 매칭.
 *   - 색상은 모두 CSS 변수 (rgb(var(--color-accent) / x)) — 테마 색 변경 시 자동 반영.
 *   - 아바타 색만 사용자 ID 해시 기반 고정 hex (테마와 무관한 개인 식별색).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import type { AppUser } from '@/types';

interface Props {
  allUsers: AppUser[];
  /** 자동 체크된 사람들의 user.id (컴포지터 + 씬 담당자, 등록자 제외 후) */
  defaultCheckedIds: string[];
  /** 등록자 본인 user.id — 칩 목록과 검색 결과에서 모두 숨김 */
  excludeUserId: string;
  /** 체크된 user.id 배열 (자동 체크 - 사용자 명시 해제 + 사용자 명시 추가) */
  onChange: (checkedIds: string[]) => void;
}

// ─── 사용자 ID → 일관된 아바타 색 (테마 무관) ──────────────────────────

const AVATAR_COLORS = [
  '#6C5CE7', '#74B9FF', '#FDCB6E', '#E17055',
  '#A29BFE', '#00B894', '#FF6B6B', '#F9A8D4',
];

function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────

export function RevisionRecipientPicker({
  allUsers,
  defaultCheckedIds,
  excludeUserId,
  onChange,
}: Props) {
  // 사용자가 명시적으로 추가한 user.id (defaultCheckedIds 외 추가분)
  const [extraIds, setExtraIds] = useState<string[]>([]);
  // 사용자가 명시적으로 unchecked 한 default 항목 (회색 표시 + onChange 제외)
  const [uncheckedDefaults, setUncheckedDefaults] = useState<string[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // defaultCheckedIds 가 바뀌면 (예: scene/dept 변경) 사용자의 명시적 unchecked 도 리셋.
  // — Picker 의 "기본값" 자체가 바뀐 것이므로 깨끗한 상태로 시작하는 게 자연스럽다.
  useEffect(() => {
    setUncheckedDefaults([]);
  }, [defaultCheckedIds]);

  // 화면에 표시할 칩 목록: defaultCheckedIds + extraIds (등록자 제외, 중복 제거)
  const visibleIds = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of [...defaultCheckedIds, ...extraIds]) {
      if (id === excludeUserId) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }, [defaultCheckedIds, extraIds, excludeUserId]);

  const visibleUsers = useMemo(
    () => visibleIds
      .map(id => allUsers.find(u => u.id === id))
      .filter((u): u is AppUser => !!u),
    [visibleIds, allUsers],
  );

  // 검색 결과: 등록자 + 이미 보이는 칩 제외 + 이름 fuzzy 매칭
  const searchableUsers = useMemo(() => {
    return allUsers
      .filter(u => u.id !== excludeUserId && !visibleIds.includes(u.id))
      .filter(u => !query || u.name.toLowerCase().includes(query.toLowerCase()));
  }, [allUsers, excludeUserId, visibleIds, query]);

  // 체크 여부 계산 (자동 체크 항목은 uncheckedDefaults 에 없으면 true)
  function isChecked(id: string): boolean {
    if (defaultCheckedIds.includes(id)) {
      return !uncheckedDefaults.includes(id);
    }
    return extraIds.includes(id);
  }

  // 부모로 전달할 최종 checked id 목록
  function emitChange(nextUnchecked: string[], nextExtra: string[]) {
    const checked: string[] = [];
    for (const id of defaultCheckedIds) {
      if (id === excludeUserId) continue;
      if (!nextUnchecked.includes(id)) checked.push(id);
    }
    for (const id of nextExtra) {
      if (id === excludeUserId) continue;
      if (!checked.includes(id)) checked.push(id);
    }
    onChange(checked);
  }

  // defaultCheckedIds/onChange 가 바뀔 때도 부모 sync 유지 (마운트 시 초기 알림 대상 통보)
  useEffect(() => {
    emitChange(uncheckedDefaults, extraIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCheckedIds]);

  function toggle(id: string) {
    if (defaultCheckedIds.includes(id)) {
      // 자동 체크 항목 — uncheckedDefaults 에 토글
      const next = uncheckedDefaults.includes(id)
        ? uncheckedDefaults.filter(x => x !== id)
        : [...uncheckedDefaults, id];
      setUncheckedDefaults(next);
      emitChange(next, extraIds);
    } else {
      // 수동 추가 항목 — extraIds 에서 제거 (= 칩 자체 제거)
      const next = extraIds.filter(x => x !== id);
      setExtraIds(next);
      emitChange(uncheckedDefaults, next);
    }
  }

  function addRecipient(userId: string) {
    if (extraIds.includes(userId) || defaultCheckedIds.includes(userId)) return;
    const next = [...extraIds, userId];
    setExtraIds(next);
    emitChange(uncheckedDefaults, next);
    setQuery('');
    setSearchOpen(false);
  }

  // 검색 드롭다운 열릴 때 input 자동 포커스
  useEffect(() => {
    if (searchOpen) {
      const id = window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [searchOpen]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleUsers.map(u => {
          const cked = isChecked(u.id);
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => toggle(u.id)}
              className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-colors ${
                cked
                  ? 'bg-accent/15 border-accent/60 text-text-primary'
                  : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary hover:border-accent/40'
              }`}
              title={cked ? '클릭하면 알림 대상에서 제외' : '클릭하면 알림 대상에 포함'}
            >
              <span
                className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: avatarColor(u.id) }}
              >
                {u.name.charAt(0)}
              </span>
              <span>{u.name}</span>
              {u.isCompositor && (
                <span className="text-[10px] text-text-secondary/60">
                  컴포지터
                </span>
              )}
              {cked && (
                <span
                  className="w-3.5 h-3.5 rounded-full bg-accent text-white inline-flex items-center justify-center"
                  aria-hidden
                >
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setSearchOpen(v => !v)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed border-bg-border text-[12px] text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
        >
          <Plus className="w-3 h-3" strokeWidth={2.5} />
          다른 사람 추가
        </button>
      </div>

      {searchOpen && (
        <div className="mt-2 bg-bg-card border border-bg-border/60 rounded-lg p-2 max-w-md">
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="이름으로 검색..."
            className="w-full px-2 py-1.5 mb-1.5 bg-bg-primary/80 border border-bg-border/60 rounded text-[12px] text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent/60"
          />
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {searchableUsers.map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => addRecipient(u.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-primary text-left transition-colors"
              >
                <span
                  className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: avatarColor(u.id) }}
                >
                  {u.name.charAt(0)}
                </span>
                <span className="text-[12px] text-text-primary">{u.name}</span>
                {u.isCompositor && (
                  <span className="text-[10px] text-text-secondary/50">
                    컴포지터
                  </span>
                )}
              </button>
            ))}
            {searchableUsers.length === 0 && (
              <div className="text-[11px] text-text-secondary/50 px-2 py-1">
                {query ? '검색 결과 없음' : '추가할 사람이 없습니다'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
