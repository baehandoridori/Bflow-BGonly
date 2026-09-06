import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Clock, MessageSquareWarning, Play } from 'lucide-react';
import { toast } from 'sonner';
import { Widget, IsPopupContext } from './Widget';
import { useAuthStore } from '@/stores/useAuthStore';
import { useAppStore } from '@/stores/useAppStore';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { invalidateRevisionsCache, setRevisionsSheetsMode } from '@/services/revisionService';
import { CompletionNoteInput } from '@/components/scenes/revision/CompletionNoteInput';
import { ASSIGNEE_STATE_CONFIG, revisionNoToLabel } from '@/constants/revision';
import { buildRevisionAssigneeCompletionNotifyUserIds } from '@/utils/revisionNotificationRecipients';
import { formatRetakeElapsed, getMyRetakeState, selectMyRetakes, summarizeMyRetakes } from '@/utils/myRetakes';
import { stripEntityTokens } from '@/utils/entityTokens';
import { isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';
import { openRetakeInApp } from '@/utils/retakeNavigation';
import type { CompRevision } from '@/types';

function useMyRetakes() {
  const currentUser = useAuthStore((state) => state.currentUser);
  const revisions = useRevisionStore((state) => state.revisions);
  const userId = currentUser?.id ?? '';
  const items = useMemo(() => selectMyRetakes(revisions, userId), [revisions, userId]);
  const summary = useMemo(() => summarizeMyRetakes(items, userId), [items, userId]);
  return { currentUser, revisions, userId, items, summary };
}

/** 기존 개인 배치에 위젯이 없을 때도 진행 상태를 확인할 진입점을 남긴다. */
export function MyRetakesReminder() {
  const { items, summary } = useMyRetakes();
  if (summary.total === 0) return null;
  return (
    <div className="relative mx-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-accent/20 bg-accent/5 px-3.5 py-2.5 text-xs">
      <span className="flex items-center gap-2 font-medium text-text-primary">
        <MessageSquareWarning size={14} className="text-accent" /> 내 리테이크 진행 상태 확인
      </span>
      <span className="text-text-secondary">대기 {summary.pending} · 진행중 {summary.inProgress}</span>
      <button type="button" onClick={() => openRetakeInApp(items[0].id)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-accent hover:bg-accent/10 cursor-pointer">
        내 리테이크 보기 <ChevronRight size={13} />
      </button>
    </div>
  );
}

function sceneLabel(revision: CompRevision): string {
  if (isGeneralRevisionSceneKey(revision.sceneKey)) return '전반';
  const [episode, part, scene] = revision.sceneKey.split(':');
  let sceneId = scene ?? '';
  if (sceneId.startsWith('raw-')) {
    try { sceneId = decodeURIComponent(sceneId.slice(4)); } catch { sceneId = sceneId.slice(4); }
  }
  return [episode, part, sceneId].filter(Boolean).join(' · ');
}

/** 팝업은 별도 renderer이므로 저장 모드·캐시·재연결 보충도 자체 갱신 경로를 사용한다. */
export function installMyRetakesPopupRefresh(): () => void {
  let disposed = false;
  let loading = false;
  let reloadAgain = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reload = async () => {
    if (loading) { reloadAgain = true; return; }
    loading = true;
    try {
      do {
        reloadAgain = false;
        setRevisionsSheetsMode(useAppStore.getState().dataConnected);
        invalidateRevisionsCache();
        await useRevisionStore.getState().loadRevisions();
      } while (reloadAgain && !disposed);
    } finally { loading = false; }
  };
  const onChange = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void reload(); }, 250);
  };
  void reload();
  window.addEventListener('bflow:revisions-invalidated', onChange);
  const unsubscribeStatus = window.electronAPI?.onSupabaseStatus?.((status, metadata) => {
    if (status !== 'SUBSCRIBED' || !metadata?.reconnected) return;
    useAppStore.getState().setDataConnected(true);
    onChange();
  });
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener('bflow:revisions-invalidated', onChange);
    unsubscribeStatus?.();
  };
}

export function MyRetakesWidget() {
  const { currentUser, revisions, userId, items, summary } = useMyRetakes();
  const isPopup = useContext(IsPopupContext);
  const isLoading = useRevisionStore((state) => state.isLoading);
  const [now, setNow] = useState(Date.now);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const editingRevision = editingId ? revisions.find((revision) => revision.id === editingId) : undefined;
  const completionRecipients = useMemo(() => buildRevisionAssigneeCompletionNotifyUserIds({
    notifyUserIds: editingRevision?.notifyUserIds,
    requesterId: editingRevision?.requesterId,
    completerId: userId,
  }), [editingRevision?.notifyUserIds, editingRevision?.requesterId, userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => { setEditingId(null); }, [userId]);
  useEffect(() => {
    if (editingId && !savingRef.current && (!editingRevision || !getMyRetakeState(editingRevision, userId))) {
      setEditingId(null);
    }
  }, [editingId, editingRevision, userId, savingId]);

  // 본체는 앱의 공용 리테이크 구독을 사용한다. 팝업은 독립 renderer이므로 직접 갱신한다.
  useEffect(() => {
    if (!isPopup || !userId) return;
    return installMyRetakesPopupRefresh();
  }, [isPopup, userId]);

  const applyState = async (id: string, action: 'start' | 'complete', note = '', notifyIds?: string[]) => {
    if (savingRef.current) return;
    const actor = useAuthStore.getState().currentUser;
    const store = useRevisionStore.getState();
    const revision = store.revisions.find((item) => item.id === id);
    if (!actor || actor.id !== userId || !revision || !getMyRetakeState(revision, actor.id)) return;
    if (action === 'start' && getMyRetakeState(revision, actor.id) !== 'pending') return;
    if (isPopup) setRevisionsSheetsMode(useAppStore.getState().dataConnected);
    savingRef.current = true;
    setSavingId(id);
    try {
      if (action === 'start') await store.startAssignee(revision, actor.id);
      else await store.completeAssignee(revision, actor.id, note, notifyIds, actor.name);
      if (useAuthStore.getState().currentUser?.id !== actor.id) return;
      const saved = useRevisionStore.getState().revisions.find((item) => item.id === id);
      const expected = action === 'start' ? 'in_progress' : 'done';
      if (saved?.assigneeStates?.[actor.id]?.state === expected) {
        if (action === 'complete') setEditingId(null);
      } else {
        toast.error('진행 상태가 저장되지 않았어요. 현재 상태를 확인한 뒤 다시 시도해주세요.');
      }
    } catch {
      toast.error('진행 상태를 저장하지 못했어요. 다시 시도해주세요.');
    } finally {
      savingRef.current = false;
      setSavingId(null);
    }
  };

  return (
    <Widget title="내 리테이크" icon={<MessageSquareWarning size={16} />} headerRight={<span className="mr-1 text-xs tabular-nums text-text-secondary">{summary.total}건</span>}>
      {!currentUser ? <p className="text-xs text-text-secondary">로그인하면 내 리테이크를 볼 수 있어요.</p> : (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs text-text-secondary">
            <span>대기 <strong className="font-semibold tabular-nums text-text-primary">{summary.pending}</strong></span>
            <span>진행중 <strong className="font-semibold tabular-nums text-text-primary">{summary.inProgress}</strong></span>
          </div>
          <p className="text-[11px] leading-relaxed text-text-secondary/75">수정을 시작하거나 마쳤다면 진행 상태를 확인해주세요.</p>
          {editingRevision && editingRevision.assigneeIds?.includes(userId) && !editingRevision.finalResolvedAt && editingRevision.status !== 'resolved' && (
            <fieldset disabled={savingId !== null} className="min-w-0 disabled:opacity-60">
              <legend className="text-xs font-medium text-text-primary">{sceneLabel(editingRevision)} · {revisionNoToLabel(editingRevision.revisionNo)} 담당 완료</legend>
              <CompletionNoteInput key={`${editingRevision.id}:${userId}`} initialValue={editingRevision.assigneeStates?.[userId]?.note ?? ''} notifyDefaultIds={completionRecipients}
                onConfirm={(note, notifyIds) => { void applyState(editingRevision.id, 'complete', note, notifyIds); }} onCancel={() => setEditingId(null)} />
            </fieldset>
          )}
          {items.length === 0 ? (
            <p className="py-5 text-center text-xs text-text-secondary">{savingId ? '진행 상태를 저장하는 중이에요.' : isLoading ? '리테이크를 불러오는 중이에요.' : '지금 담당 중인 미완료 리테이크가 없어요.'}</p>
          ) : (
            <div className="divide-y divide-bg-border/35">
              {items.map((revision) => {
                const state = getMyRetakeState(revision, userId)!;
                return (
                  <div key={revision.id} className="space-y-2 py-3 first:pt-0">
                    <button type="button" onClick={() => openRetakeInApp(revision.id, { fromPopup: isPopup })} className="group block w-full text-left cursor-pointer">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-text-secondary">
                        <span className="font-medium">{sceneLabel(revision)} · {revisionNoToLabel(revision.revisionNo)}</span>
                        <span style={{ color: ASSIGNEE_STATE_CONFIG[state].color }}>{ASSIGNEE_STATE_CONFIG[state].label}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-text-primary group-hover:text-accent">{stripEntityTokens(revision.description) || '리테이크 내용 확인'}</p>
                    </button>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-auto inline-flex items-center gap-1 text-[10px] text-text-secondary/70"><Clock size={10} />{formatRetakeElapsed(revision.createdAt, now)}</span>
                      {state === 'pending' && <button type="button" disabled={savingId !== null} onClick={() => { void applyState(revision.id, 'start'); }} className="inline-flex items-center gap-1 rounded-md border border-bg-border/50 px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-border/30 disabled:opacity-40 cursor-pointer"><Play size={11} />진행중</button>}
                      <button type="button" disabled={savingId !== null} onClick={() => setEditingId(revision.id)} className="inline-flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-40 cursor-pointer"><Check size={11} />담당 완료</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Widget>
  );
}
