/**
 * AssigneeChipRow — 담당자 칩 행 (시안 A / 시안 B 공유 표현 컴포넌트).
 *
 * store/권한가드를 import 하지 않는다. 모든 데이터·액션·판정 결과를 props 로 받는다.
 * 본인 칩(id === currentUserId && canAct)만 클릭 액션:
 *   pending → onStart, in_progress → onComplete(멘트 입력은 부모가 처리), done → onRevert.
 *   finalResolved 면 done 칩 되돌리기 비활성(spec §6.2).
 */

import { Play, Check, Undo2 } from 'lucide-react';
import type { AssigneeState } from '@/types';
import { ASSIGNEE_STATE_CONFIG } from '@/constants/revision';
import { avatarColor } from '@/utils/avatarColor';

export interface AssigneeChipData {
  id: string;
  name: string;
  state: AssigneeState;
}

interface Props {
  assignees: AssigneeChipData[];
  currentUserId: string | null;
  /** canActAsAssignee 결과 — 본인 칩 액션 가능 여부. */
  canAct: boolean;
  /** rev.finalResolvedAt 존재 — done 칩 되돌리기 차단(spec §6.2). */
  finalResolved: boolean;
  onStart: (userId: string) => void;
  onComplete: (userId: string) => void;
  onRevert: (userId: string) => void;
}

export function AssigneeChipRow({
  assignees,
  currentUserId,
  canAct,
  finalResolved,
  onStart,
  onComplete,
  onRevert,
}: Props) {
  if (assignees.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {assignees.map((a) => {
        const cfg = ASSIGNEE_STATE_CONFIG[a.state];
        const isMine = !!currentUserId && a.id === currentUserId && canAct;
        // 본인 칩의 다음 액션: pending→시작 / in_progress→완료 / done→되돌리기(최종완료 전).
        const revertBlocked = a.state === 'done' && finalResolved;
        const actionable = isMine && !revertBlocked;

        const ActionIcon = a.state === 'pending' ? Play : a.state === 'in_progress' ? Check : Undo2;
        const actionLabel =
          a.state === 'pending' ? '시작' : a.state === 'in_progress' ? '완료' : '되돌리기';

        const handleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (!actionable) return;
          if (a.state === 'pending') onStart(a.id);
          else if (a.state === 'in_progress') onComplete(a.id);
          else onRevert(a.id);
        };

        const chipBase =
          'inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border text-[12px] transition-colors';
        const chipTone = isMine
          ? 'bg-accent/15 border-accent/60 text-text-primary'
          : 'bg-bg-primary/50 border-bg-border/50 text-text-secondary';

        const inner = (
          <>
            <span
              className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white shrink-0"
              style={{ background: avatarColor(a.id) }}
            >
              {a.name.charAt(0)}
            </span>
            <span>{a.name}</span>
            {/* 상태 점 + 라벨 */}
            <span className="inline-flex items-center gap-1">
              {a.state === 'done' ? (
                <Check size={12} style={{ color: cfg.color }} strokeWidth={3} />
              ) : (
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} aria-hidden />
              )}
              <span className="text-[10px]" style={{ color: cfg.color }}>
                {cfg.label}
              </span>
            </span>
            {/* 본인 액션 힌트 */}
            {actionable && (
              <span className="ml-0.5 inline-flex items-center gap-0.5 text-[10px] font-semibold text-accent-sub">
                <ActionIcon size={11} strokeWidth={2.6} />
                {actionLabel}
              </span>
            )}
          </>
        );

        return actionable ? (
          <button
            key={a.id}
            type="button"
            onClick={handleClick}
            className={`${chipBase} ${chipTone} cursor-pointer hover:border-accent`}
            title={`${a.name} — 클릭하면 ${actionLabel}`}
          >
            {inner}
          </button>
        ) : (
          <span
            key={a.id}
            className={`${chipBase} ${chipTone}`}
            title={`${a.name} · ${cfg.label}${isMine && revertBlocked ? ' (최종완료 상태 — 먼저 최종완료 되돌리기)' : ''}`}
          >
            {inner}
          </span>
        );
      })}
    </div>
  );
}
