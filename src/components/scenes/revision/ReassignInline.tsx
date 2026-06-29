/**
 * ReassignInline — 담당자 재배정 인라인 UI (시안 A / 시안 B 공유).
 *
 * store/권한가드 비종속. 후보(candidates = 알림 대상자) 중에서 담당자를 토글로 고른다.
 * 불변식 assignee_ids ⊆ notify_user_ids 는 후보 자체가 notify 라서 자연 충족.
 */

import { useState } from 'react';
import { Crown, Check, X } from 'lucide-react';
import { avatarColor } from '@/utils/avatarColor';

export interface ReassignCandidate {
  id: string;
  name: string;
}

interface Props {
  candidates: ReassignCandidate[];
  currentAssigneeIds: string[];
  onConfirm: (assigneeIds: string[]) => void;
  onCancel: () => void;
}

export function ReassignInline({ candidates, currentAssigneeIds, onConfirm, onCancel }: Props) {
  const [selected, setSelected] = useState<string[]>(currentAssigneeIds);

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div
      className="mt-2 rounded-lg border border-accent/40 bg-bg-primary/60 p-2.5 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">
        담당자 선택{' '}
        <span className="font-normal normal-case text-text-secondary/60">— 알림 대상 중에서 고릅니다</span>
      </p>
      {candidates.length === 0 ? (
        <p className="text-[11px] text-text-secondary/50">
          알림 대상이 없습니다. 먼저 알림 받을 사람을 지정하세요.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {candidates.map((c) => {
            const on = selected.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
                className={`inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border text-[12px] cursor-pointer transition-colors ${
                  on
                    ? 'bg-accent/15 border-accent/60 text-text-primary'
                    : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary hover:border-accent/40'
                }`}
                title={on ? '담당 해제' : '담당으로 지정'}
              >
                <span
                  className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ background: avatarColor(c.id) }}
                >
                  {c.name.charAt(0)}
                </span>
                <span>{c.name}</span>
                {on && (
                  <span className="inline-flex items-center justify-center px-1 h-3.5 rounded-full bg-accent text-white text-[8px] font-bold gap-0.5">
                    <Crown className="w-2.5 h-2.5" strokeWidth={2.6} />
                    담당
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        {selected.length === 0 && candidates.length > 0 && (
          <span className="mr-auto text-[11px] text-amber-400/90">
            담당자를 1명 이상 선택해주세요.
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
        >
          <X size={12} />
          취소
        </button>
        <button
          type="button"
          onClick={() => onConfirm(selected)}
          disabled={selected.length === 0}
          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-opacity"
        >
          <Check size={12} strokeWidth={2.6} />
          적용
        </button>
      </div>
    </div>
  );
}
