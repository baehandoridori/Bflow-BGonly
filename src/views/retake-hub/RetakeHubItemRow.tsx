/**
 * RetakeHubItemRow — 시안 B 테이블 행 + 인라인 확장 (리테이크 허브 5단계).
 *
 * 접힘: [좌측 색막대 | re# | 내용(엔티티 칩) | 담당 아바타 | 진행 라벨].
 * 펼침(행 클릭): 담당 칩 행 / 완료멘트 입력·표시 / 담당 변경 / 최종완료 바.
 *   → revision/* 컴포넌트(AssigneeChipRow/CompletionNoteInput/FinalResolveBar/ReassignInline)를 재사용.
 *
 * 담당 워크플로우 액션은 useRevisionStore 가 낙관/롤백/self-mark 를 전담(뷰는 호출만).
 * 권한 가드는 RevisionCard 와 동일하게 canActAsAssignee/canReassignRevision/canFinalResolveRevision 사용.
 * 부서(BG/ACT) 라벨은 노출하지 않는다.
 */

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Users as UsersIcon, UserPlus, FolderMinus, Trash2 } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import type { CompRevision, AppUser } from '@/types';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { removeFromSet } from '@/services/revisionSetService';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { STATUS_CONFIG } from '@/constants/revision';
import { EntityText } from '@/components/common/EntityText';
import { avatarColor } from '@/utils/avatarColor';
import { isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { canActAsAssignee, canReassignRevision, canFinalResolveRevision } from '@/utils/revisionWorkflow';
import { summarizeAssignees, collectAssigneeNotes, canShowFinalResolveBar } from '@/utils/revisionCardView';
import { AssigneeChipRow } from '@/components/scenes/revision/AssigneeChipRow';
import { CompletionNoteInput } from '@/components/scenes/revision/CompletionNoteInput';
import { FinalResolveBar } from '@/components/scenes/revision/FinalResolveBar';
import { ReassignInline } from '@/components/scenes/revision/ReassignInline';
import { RevisionStatusAction } from '@/components/scenes/RevisionPanel';

interface Props {
  revision: CompRevision;
  allUsers: AppUser[];
  sideBarClass: string;
  reLabel: string;
}

export function RetakeHubItemRow({ revision, allUsers, sideBarClass, reLabel }: Props) {
  const currentUser = useAuthStore((s) => s.currentUser);
  const { setView, setHighlightUserName } = useAppStore();

  const startAssignee = useRevisionStore((s) => s.startAssignee);
  const completeAssignee = useRevisionStore((s) => s.completeAssignee);
  const revertAssignee = useRevisionStore((s) => s.revertAssignee);
  const reassign = useRevisionStore((s) => s.reassign);
  const finalResolve = useRevisionStore((s) => s.finalResolve);
  const revertFinalResolve = useRevisionStore((s) => s.revertFinalResolve);
  const updateStatus = useRevisionStore((s) => s.updateStatus);
  const deleteRevision = useRevisionStore((s) => s.deleteRevision);

  // '전반'(씬 미지정) 항목은 setId 가 유일한 표시 앵커라, 세트에서 빼면 어디서도 안 보이는 고아가 된다.
  // → 전반 항목은 '빼기' 대신 삭제로 처리한다(코덱스 P2).
  const isGeneral = isGeneralRevisionSceneKey(revision.sceneKey);

  const [expanded, setExpanded] = useState(false);
  const [noteEditingFor, setNoteEditingFor] = useState<string | null>(null);
  const [reassigning, setReassigning] = useState(false);
  const [removing, setRemoving] = useState(false);

  const entityUserNames = useMemo(() => allUsers.map((u) => u.name), [allUsers]);
  const handleEntityMentionClick = (name: string) => { setHighlightUserName(name); setView('team'); };

  const assigneeIds = revision.assigneeIds ?? [];
  const assigneeStates = revision.assigneeStates ?? {};
  const hasAssignees = assigneeIds.length > 0;
  const summary = summarizeAssignees(assigneeIds, assigneeStates);
  const doneNotes = collectAssigneeNotes(assigneeIds, assigneeStates);
  const isFinalResolved = revision.status === 'resolved';
  const canAct = canActAsAssignee(currentUser, revision);
  const canReassign = canReassignRevision(currentUser, revision);
  const canFinal = canFinalResolveRevision(currentUser, revision);

  const nameOf = (id: string) => allUsers.find((u) => u.id === id)?.name ?? id;

  const notifyUsers = useMemo(
    () =>
      (revision.notifyUserIds ?? [])
        .map((uid) => allUsers.find((u) => u.id === uid))
        .filter((u): u is NonNullable<typeof u> => !!u),
    [revision.notifyUserIds, allUsers],
  );

  const assigneeChips = useMemo(
    () =>
      assigneeIds.map((id) => ({
        id,
        name: nameOf(id),
        state: assigneeStates[id]?.state ?? ('pending' as const),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assigneeIds, assigneeStates, allUsers],
  );

  const statusCfg = STATUS_CONFIG[revision.status];

  const handleCompleteClick = (uid: string) => {
    setReassigning(false);
    setNoteEditingFor(uid);
  };
  const handleNoteConfirm = (note: string) => {
    if (!noteEditingFor) return;
    completeAssignee(revision, noteEditingFor, note);
    setNoteEditingFor(null);
  };
  const handleReassignConfirm = (ids: string[]) => {
    reassign(revision, ids);
    setReassigning(false);
  };
  const handleFinalResolve = () => {
    if (currentUser) finalResolve(revision, currentUser.name);
  };

  // 세트에서 빼기 (스펙 §9.4) — 씬 매인 항목은 setId 만 해제(씬 패널엔 남음). 마지막 항목이 빠지면
  // 서비스/허브 effect 가 세트를 open 으로 되돌린다.
  // '전반' 항목은 세트 밖에선 볼 수 없어 빼면 고아가 되므로 삭제한다(코덱스 P2).
  const handleRemoveFromSet = async () => {
    if (removing) return;
    const ok = await ConfirmDialog.show(
      isGeneral
        ? {
            message: '이 전반 항목을 삭제할까요?\n전반 항목은 세트 밖에선 볼 수 없어, 세트에서 빼면 사라집니다.',
            confirmLabel: '삭제',
            tone: 'danger',
          }
        : {
            message: '이 리테이크를 세트에서 빼시겠습니까?\n항목 자체는 사라지지 않고 세트 소속만 해제됩니다.',
            confirmLabel: '세트에서 빼기',
            tone: 'danger',
          },
    );
    if (!ok) return;
    setRemoving(true);
    try {
      if (isGeneral) {
        await deleteRevision(revision.id, revision.sceneKey);
        sonnerToast.success('전반 항목을 삭제했어요.');
      } else {
        await removeFromSet(revision.id);
        sonnerToast.success('세트에서 뺐어요.');
      }
    } catch {
      sonnerToast.error(
        isGeneral ? '삭제하지 못했어요. 잠시 후 다시 시도해주세요.' : '세트에서 빼지 못했어요. 잠시 후 다시 시도해주세요.',
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className={[
        'relative rounded-lg border border-bg-border/50 bg-bg-card/40 overflow-hidden transition-colors',
        isFinalResolved ? 'opacity-65' : '',
      ].join(' ')}
    >
      {/* 좌측 상태 색막대 (§8.1 status별 4색) */}
      <span className={`rev-side-bar ${sideBarClass}`} aria-hidden />

      {/* ─── 접힘 행 ─── */}
      {/* div(role=button) — 내용의 파일경로 칩(PathBadge=button)이 button 안에 중첩되는 잘못된 DOM 을 피한다(코덱스 P2). */}
      <div
        role="button"
        tabIndex={0}
        // capture 단계로 토글 — EntityText 의 멘션/#칩·PathBadge 가 bubble 단계에서 stopPropagation 하므로,
        //   내용이 칩 위주여도 행 어디를 눌러도 펼쳐지게 한다(칩은 자체 동작도 수행). (코덱스 P3)
        onClickCapture={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        className="w-full grid grid-cols-[4px_56px_1fr_auto_auto] items-center gap-2 px-2 py-2 text-left cursor-pointer hover:bg-bg-border/20 transition-colors"
      >
        <span aria-hidden />
        <span className={`text-[12px] font-bold ${isFinalResolved ? 'text-text-secondary' : 'text-accent-sub'}`}>
          {reLabel}
        </span>

        {/* 내용 — 엔티티 칩, 1줄 클램프. (내용 클릭도 행 토글로 동작하게 — 경로/멘션 칩은 자체 동작 + 행도 펼침.) */}
        <span className="min-w-0 text-[13px] text-text-primary truncate">
          <EntityText
            text={revision.description}
            userNames={entityUserNames}
            onMentionClick={handleEntityMentionClick}
            onHashClick={navigateToHashTarget}
          />
        </span>

        {/* 담당 아바타 스택 */}
        <span className="flex items-center -space-x-1.5 justify-end shrink-0">
          {assigneeChips.length === 0 ? (
            <span className="text-[10px] text-text-secondary/40">미지정</span>
          ) : (
            assigneeChips.slice(0, 4).map((a) => (
              <span
                key={a.id}
                className="w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold text-white ring-1 ring-bg-card"
                style={{ background: avatarColor(a.id) }}
                title={a.name}
              >
                {a.name.charAt(0)}
              </span>
            ))
          )}
          {assigneeChips.length > 4 && (
            <span className="text-[10px] text-text-secondary/60 pl-2">+{assigneeChips.length - 4}</span>
          )}
        </span>

        {/* 진행 상태 라벨 */}
        <span
          className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full mr-1"
          style={{ color: statusCfg.color, background: statusCfg.bg }}
        >
          {statusCfg.label}
        </span>
      </div>

      {/* ─── 인라인 확장 ─── */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="expand"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-bg-border/40">
              {/* 전체 내용(잘림 없이) */}
              <p className="text-[13px] text-text-primary leading-relaxed whitespace-pre-wrap pt-2">
                <EntityText
                  text={revision.description}
                  userNames={entityUserNames}
                  onMentionClick={handleEntityMentionClick}
                  onHashClick={navigateToHashTarget}
                />
              </p>

              {revision.imageUrl && (
                <img
                  src={revision.imageUrl}
                  alt="첨부"
                  className="max-h-40 rounded-lg border border-bg-border/40 object-cover"
                />
              )}

              {/* ─── 담당 워크플로우 (담당자 1명+) ─── */}
              {hasAssignees && (
                <>
                  <AssigneeChipRow
                    assignees={assigneeChips}
                    currentUserId={currentUser?.id ?? null}
                    canAct={canAct}
                    finalResolved={!!revision.finalResolvedAt}
                    onStart={(uid) => startAssignee(revision, uid)}
                    onComplete={handleCompleteClick}
                    onRevert={(uid) => revertAssignee(revision, uid)}
                  />

                  <AnimatePresence>
                    {noteEditingFor && (
                      <motion.div
                        key="note-input"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <CompletionNoteInput
                          initialValue={assigneeStates[noteEditingFor]?.note ?? ''}
                          onConfirm={handleNoteConfirm}
                          onCancel={() => setNoteEditingFor(null)}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {doneNotes.length > 0 && (
                    <div className="space-y-1">
                      {doneNotes.map(({ userId, note }) => (
                        <div
                          key={userId}
                          className="px-3 py-2 rounded-lg"
                          style={{ background: 'color-mix(in srgb, rgb(var(--color-accent)) 10%, transparent)' }}
                        >
                          <p className="text-xs text-text-secondary">
                            <span className="font-medium text-accent-sub">{nameOf(userId)} 완료:</span>{' '}
                            <EntityText
                              text={note}
                              userNames={entityUserNames}
                              onMentionClick={handleEntityMentionClick}
                              onHashClick={navigateToHashTarget}
                            />
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {canReassign && !isFinalResolved &&
                    (reassigning ? (
                      <ReassignInline
                        candidates={notifyUsers.map((u) => ({ id: u.id, name: u.name }))}
                        currentAssigneeIds={assigneeIds}
                        onConfirm={handleReassignConfirm}
                        onCancel={() => setReassigning(false)}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setNoteEditingFor(null); setReassigning(true); }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-secondary/75 hover:text-accent-sub cursor-pointer transition-colors"
                      >
                        <UsersIcon size={12} />
                        담당 변경
                      </button>
                    ))}

                  {canShowFinalResolveBar(assigneeIds, revision.finalResolvedAt) && (
                    <FinalResolveBar
                      resolved={isFinalResolved}
                      enabled={summary.allDone}
                      canFinalResolve={canFinal}
                      finalResolvedBy={revision.finalResolvedBy}
                      onResolve={handleFinalResolve}
                      onRevert={() => revertFinalResolve(revision)}
                    />
                  )}
                </>
              )}

              {/* 담당자 0명 — 단순 상태 토글(완료/되돌리기). 가져온 기존(담당자 없는) 리테이크를 허브에서 직접 완료/되돌리기 가능하게(코덱스 P2). */}
              {!hasAssignees && currentUser && (
                <div className="mb-1">
                  <RevisionStatusAction
                    status={revision.status}
                    onStatusChange={(next) => { void updateStatus(revision.id, revision.sceneKey, next, { resolvedBy: currentUser?.name }); }}
                  />
                </div>
              )}

              {/* ─── 담당자 0명 — 담당 지정 유도 ─── */}
              {!hasAssignees && canReassign && !isFinalResolved && notifyUsers.length > 0 && (
                reassigning ? (
                  <ReassignInline
                    candidates={notifyUsers.map((u) => ({ id: u.id, name: u.name }))}
                    currentAssigneeIds={[]}
                    onConfirm={handleReassignConfirm}
                    onCancel={() => setReassigning(false)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setReassigning(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent-sub hover:text-accent cursor-pointer transition-colors"
                  >
                    <UserPlus size={12} />
                    담당 지정
                  </button>
                )
              )}

              {/* 푸터 */}
              <div className="flex items-center gap-2 text-[11px] text-text-secondary/60 flex-wrap pt-1">
                <span>{revision.requesterName}</span>
                {revision.status === 'resolved' && revision.finalResolvedBy && (
                  <>
                    <span>&middot;</span>
                    <span style={{ color: STATUS_CONFIG.resolved.color }}>{revision.finalResolvedBy} 최종완료</span>
                  </>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={handleRemoveFromSet}
                  disabled={removing}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-secondary/70 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                  title={isGeneral ? '이 전반 항목 삭제' : '이 리테이크를 세트에서 빼기'}
                >
                  {isGeneral ? <Trash2 size={12} /> : <FolderMinus size={12} />}
                  {removing ? (isGeneral ? '삭제 중…' : '빼는 중…') : (isGeneral ? '삭제' : '세트에서 빼기')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
