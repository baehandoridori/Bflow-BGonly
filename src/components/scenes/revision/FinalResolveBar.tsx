/**
 * FinalResolveBar — 최종 완료 분리 바 (시안 A / 시안 B 공유).
 *
 * spec §8.1: 담당 진행과 분리된 하단 바. 전원 담당완료(enabled) 전에는 잠금, 후에 활성.
 * 권한(canFinalResolve = 요청자 또는 컴포지터급) 없으면 미완료 상태에선 숨김.
 * resolved(최종완료) 상태에서는 완료 표시 + 되돌리기(권한 시).
 */

import { CheckCircle2, Lock, Undo2 } from 'lucide-react';

interface Props {
  /** status === 'resolved' (finalResolvedAt 존재). */
  resolved: boolean;
  /** 전원 담당완료(summarizeAssignees.allDone) — 최종완료 활성 게이트. */
  enabled: boolean;
  /** canFinalResolveRevision 결과. */
  canFinalResolve: boolean;
  finalResolvedBy?: string;
  onResolve: () => void;
  onRevert: () => void;
}

export function FinalResolveBar({
  resolved,
  enabled,
  canFinalResolve,
  finalResolvedBy,
  onResolve,
  onRevert,
}: Props) {
  if (resolved) {
    return (
      <div
        className="mt-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
        style={{
          borderColor: 'color-mix(in srgb, var(--status-done) 35%, transparent)',
          background: 'color-mix(in srgb, var(--status-done) 12%, transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: 'var(--status-done)' }}>
          <CheckCircle2 size={14} strokeWidth={2.4} />
          최종 완료됨{finalResolvedBy ? ` · ${finalResolvedBy}` : ''}
        </span>
        {canFinalResolve && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRevert();
            }}
            className="inline-flex items-center gap-1 rounded-full border border-bg-border/45 bg-bg-primary/55 px-2 py-1 text-[10px] font-semibold text-text-secondary/75 hover:border-accent/35 hover:bg-accent/10 hover:text-accent-sub cursor-pointer transition-all"
            title="최종 완료 되돌리기"
          >
            <Undo2 size={10} />
            되돌리기
          </button>
        )}
      </div>
    );
  }

  // 미완료 + 권한 없음 → 바 자체 숨김.
  if (!canFinalResolve) return null;

  const active = enabled;
  return (
    <button
      type="button"
      disabled={!active}
      onClick={(e) => {
        e.stopPropagation();
        if (active) onResolve();
      }}
      className={`mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-bold transition-all ${
        active
          ? 'border-accent/50 bg-accent/15 text-accent hover:bg-accent/25 cursor-pointer'
          : 'border-bg-border/50 bg-bg-primary/40 text-text-secondary/55 cursor-not-allowed'
      }`}
      title={active ? '최종 완료로 확정' : '담당 전원 완료 후 최종 완료할 수 있습니다'}
    >
      {active ? <CheckCircle2 size={14} strokeWidth={2.4} /> : <Lock size={12} />}
      {active ? '최종 완료' : '담당 전원 완료 후 최종 완료'}
    </button>
  );
}
