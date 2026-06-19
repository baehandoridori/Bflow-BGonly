/**
 * CompletionNoteInput — 담당자 완료 멘트 입력 (시안 A / 시안 B 공유).
 *
 * 빈 멘트 허용(spec §8.3 · 한솔 확정), placeholder 로 경로 입력 유도.
 * 4a: @멘션 자동완성 + 인-인풋 하이라이트(EntityAwareInput). 표시 칩은 호출 측이 EntityText 로 렌더.
 */

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { EntityAwareInput } from '@/components/common/EntityAwareInput';

interface Props {
  initialValue?: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export function CompletionNoteInput({ initialValue = '', onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initialValue);
  const { users } = useAuthStore();

  return (
    <div
      className="mt-2 rounded-lg border border-accent/40 bg-bg-primary/60 p-2.5 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <EntityAwareInput
        multiline
        value={value}
        onChange={setValue}
        users={users}
        submitOn="ctrl-enter"
        onSubmit={() => onConfirm(value.trim())}
        onCancel={onCancel}
        autoFocus
        placeholder="완료 결과·파일 경로(G:\...)를 적어주세요 — 비워도 됩니다. (@이름으로 멘션)"
        className="w-full min-h-[64px] px-2.5 py-2 text-[13px] bg-bg-primary/80 border border-bg-border/60 rounded-md text-text-primary placeholder:text-text-secondary/50 resize-y focus:outline-none focus:border-accent/60"
      />
      <div className="flex items-center justify-end gap-2">
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
          onClick={() => onConfirm(value.trim())}
          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold rounded-md bg-accent text-white hover:opacity-90 cursor-pointer transition-opacity"
        >
          <Check size={12} strokeWidth={2.6} />
          완료
        </button>
      </div>
    </div>
  );
}
