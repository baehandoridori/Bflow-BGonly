/**
 * CompletionNoteInput — 담당자 완료 멘트 입력 (시안 A / 시안 B 공유).
 *
 * 평문 textarea. 빈 멘트 허용(spec §8.3), placeholder 로 경로 입력 유도.
 * ⚠️ 엔티티 감지(@멘션/G:\경로/씬·컷 morph)는 3단계 — 여기는 평문만. morph 도입 금지.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';

interface Props {
  initialValue?: string;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}

export function CompletionNoteInput({ initialValue = '', onConfirm, onCancel }: Props) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      className="mt-2 rounded-lg border border-accent/40 bg-bg-primary/60 p-2.5 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onConfirm(value.trim());
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="완료 결과·파일 경로(G:\...)를 적어주세요 — 비워도 됩니다."
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
