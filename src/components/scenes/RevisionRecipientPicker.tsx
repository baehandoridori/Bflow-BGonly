/**
 * RevisionRecipientPicker — 리테이크 등록 폼 "알림 받을 사람" 선택 위젯
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
import { Check, Plus, Crown } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import type { AppUser } from '@/types';
import { avatarColor } from '@/utils/avatarColor';

interface Props {
  allUsers: AppUser[];
  /** 자동 체크된 사람들의 user.id (컴포지터 + 씬 담당자, 등록자 제외 후) */
  defaultCheckedIds: string[];
  /** 등록자 본인 user.id — 칩 목록과 검색 결과에서 모두 숨김 */
  excludeUserId: string;
  /** 체크된 user.id 배열 (자동 체크 - 사용자 명시 해제 + 사용자 명시 추가) */
  onChange: (checkedIds: string[]) => void;
  /**
   * 담당자 승격 차원 활성화 (리테이크 허브 2단계). true 면 칩 클릭이 3-state 사이클:
   * 미선택 → 알림 → 담당자(왕관) → 미선택. 담당자는 항상 알림에도 포함(불변식 assignee ⊆ notify).
   */
  enableAssignee?: boolean;
  /** 담당자로 승격된 user.id 배열 (enableAssignee 일 때만 의미). 항상 checkedIds 의 부분집합. */
  onAssigneesChange?: (assigneeIds: string[]) => void;
}

// ─── 컴포넌트 ──────────────────────────────────────────────────────────

export function RevisionRecipientPicker({
  allUsers,
  defaultCheckedIds,
  excludeUserId,
  onChange,
  enableAssignee = false,
  onAssigneesChange,
}: Props) {
  // 사용자가 명시적으로 추가한 user.id (defaultCheckedIds 외 추가분)
  const [extraIds, setExtraIds] = useState<string[]>([]);
  // 사용자가 명시적으로 unchecked 한 default 항목 (회색 표시 + onChange 제외)
  const [uncheckedDefaults, setUncheckedDefaults] = useState<string[]>([]);
  // 담당자로 승격된 user.id (enableAssignee 일 때만). 항상 checked 의 부분집합으로 유지.
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const defaultCheckedKey = useMemo(() => defaultCheckedIds.join('|'), [defaultCheckedIds]);

  // defaultCheckedIds 가 바뀌면 (예: scene/dept 변경) 모든 사용자 선택 상태 리셋.
  // — Picker 의 "기본값" 자체가 바뀐 것이므로 깨끗한 상태로 시작하는 게 자연스럽다.
  // 코덱스 P1 fix (4차, 2026-05-05): reset 과 onChange emit 을 별도 effect 로 분리하면
  // 두 번째 effect 가 stale uncheckedDefaults 로 onChange 를 호출 → 부모가 잘못된 list 받음.
  // 코덱스 P2 fix (10차, 2026-05-05): extraIds(수동 추가) 도 함께 reset — 이전 씬에서
  // 수동 추가한 사람이 다음 폼으로 carry-over 되어 의도치 않은 알림이 가는 문제 해결.
  useEffect(() => {
    setUncheckedDefaults([]);
    setExtraIds([]);
    setAssigneeIds([]);
    emitChange([], [], []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultCheckedKey]);

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

  // 부모로 전달할 최종 checked id 목록. enableAssignee 면 담당자(checked 부분집합)도 함께 emit.
  function emitChange(nextUnchecked: string[], nextExtra: string[], nextAssignees: string[] = assigneeIds) {
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
    if (enableAssignee) {
      // 불변식: 담당자는 항상 알림(checked)에 포함. checked 에서 빠진 담당자는 자동 탈락.
      onAssigneesChange?.(nextAssignees.filter((id) => checked.includes(id)));
    }
  }

  // (코덱스 P1 fix 4차, 2026-05-05) — 위 useEffect 에서 reset + emit 을 한 번에 처리하도록
  // 합쳤으므로 별도 sync effect 불필요. 마운트 시 초기 알림 대상 통보도 같은 경로로 발화.

  // 체크 상태만 변경 (담당 차원과 무관). makeChecked=true → 알림 포함, false → 제외.
  function applyCheck(id: string, makeChecked: boolean, nextAssignees: string[] = assigneeIds) {
    if (defaultCheckedIds.includes(id)) {
      const next = makeChecked
        ? uncheckedDefaults.filter((x) => x !== id)
        : uncheckedDefaults.includes(id) ? uncheckedDefaults : [...uncheckedDefaults, id];
      setUncheckedDefaults(next);
      emitChange(next, extraIds, nextAssignees);
    } else {
      const next = makeChecked
        ? extraIds.includes(id) ? extraIds : [...extraIds, id]
        : extraIds.filter((x) => x !== id);
      setExtraIds(next);
      emitChange(uncheckedDefaults, next, nextAssignees);
    }
  }

  // 칩 클릭 사이클. enableAssignee=false 면 기존 2-state(알림 토글),
  // true 면 3-state: 미선택 → 알림 → 담당자(왕관) → 미선택.
  function cycle(id: string) {
    const checked = isChecked(id);
    if (!enableAssignee) {
      applyCheck(id, !checked);
      return;
    }
    const isAssignee = assigneeIds.includes(id);
    if (!checked) {
      // 미선택 → 알림
      applyCheck(id, true);
    } else if (!isAssignee) {
      // 알림 → 담당자 (알림 유지)
      const next = [...assigneeIds, id];
      setAssigneeIds(next);
      emitChange(uncheckedDefaults, extraIds, next);
    } else {
      // 담당자 → 미선택: 담당·알림 동시 해제 (spec §7.2 경고)
      const u = allUsers.find((x) => x.id === id);
      const nextAssignees = assigneeIds.filter((x) => x !== id);
      setAssigneeIds(nextAssignees);
      applyCheck(id, false, nextAssignees);
      sonnerToast(`${u?.name ?? '담당자'} 님을 담당과 알림에서 함께 제외했어요`);
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
          const isAssignee = enableAssignee && assigneeIds.includes(u.id);
          const title = enableAssignee
            ? isAssignee
              ? '담당자 — 클릭하면 담당·알림에서 함께 제외'
              : cked
                ? '클릭하면 담당자로 지정 (알림 유지)'
                : '클릭하면 알림 대상에 포함'
            : cked
              ? '클릭하면 알림 대상에서 제외'
              : '클릭하면 알림 대상에 포함';
          return (
            <button
              key={u.id}
              type="button"
              onClick={() => cycle(u.id)}
              className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-colors ${
                cked
                  ? 'bg-accent/15 border-accent/60 text-text-primary'
                  : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary hover:border-accent/40'
              }`}
              title={title}
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
              {isAssignee ? (
                <span
                  className="inline-flex items-center justify-center px-1 h-3.5 rounded-full bg-accent text-white text-[8px] font-bold gap-0.5"
                  title="담당자"
                >
                  <Crown className="w-2.5 h-2.5" strokeWidth={2.6} />
                  담당
                </span>
              ) : cked ? (
                <span
                  className="w-3.5 h-3.5 rounded-full bg-accent text-white inline-flex items-center justify-center"
                  aria-hidden
                >
                  <Check className="w-2.5 h-2.5" strokeWidth={3} />
                </span>
              ) : null}
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

      {enableAssignee && (
        <p className="mt-1.5 text-[10px] text-text-secondary/60">
          칩을 한 번 더 누르면 <span className="text-accent-sub font-semibold">담당자</span>로 지정돼요 — 담당자는 알림도 함께 받습니다.
        </p>
      )}

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
