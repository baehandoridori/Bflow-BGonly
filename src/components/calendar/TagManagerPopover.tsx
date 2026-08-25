import {
  useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Check, ChevronDown, ChevronUp, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { loadBflowEvents } from '@/services/calendarService';
import { useAuthStore } from '@/stores/useAuthStore';
import { getTagCanonicalSnapshot, useCalendarStore } from '@/stores/useCalendarStore';
import { EVENT_COLORS, type CalendarTag } from '@/types/calendar';
import { floatingGlassStyle } from '@/utils/glassStyles';

interface TagManagerPopoverProps {
  anchorRect: DOMRect;
  onClose: () => void;
}

interface DraftTag {
  id?: string;
  key: string;
  name: string;
  color: string;
}

interface EditingTag {
  key: string;
  label: string;
  name: string;
  color: string;
  isNew: boolean;
}

interface PopoverPosition {
  left: number;
  top: number;
}

type ReconciliationMode = 'metadata' | 'events';

interface PendingTagReconciliation {
  actorId: string;
  drafts: DraftTag[];
  beforeRevision: number;
  beforeTags: CalendarTag[];
  mode: ReconciliationMode;
  lockMutations: boolean;
  persistenceSucceeded: boolean;
}

interface InFlightTagOperation {
  actorId: string;
  token: number;
  drafts: DraftTag[];
  beforeRevision: number;
  beforeTags: CalendarTag[];
  mode: ReconciliationMode;
}

interface TagMutationSnapshot {
  revision: number;
  inFlight: InFlightTagOperation | null;
  reconciliation: PendingTagReconciliation | null;
  settledDrafts: DraftTag[] | null;
}

let nextTagOperationToken = 0;
let tagMutationRevision = { revision: 0 };
const emptyTagMutationSnapshot: TagMutationSnapshot = {
  revision: 0,
  inFlight: null,
  reconciliation: null,
  settledDrafts: null,
};
const tagMutationByActor = new Map<string, TagMutationSnapshot>();
let activeTagOperation: { actorId: string; token: number } | null = null;
const tagMutationListeners = new Set<() => void>();

function cloneDrafts(drafts: DraftTag[]): DraftTag[] {
  return drafts.map((tag) => ({ ...tag }));
}

function cloneTags(tags: CalendarTag[]): CalendarTag[] {
  return tags.map((tag) => ({ ...tag }));
}

function publishTagMutationSnapshot(
  actorId: string,
  updates: Omit<Partial<TagMutationSnapshot>, 'revision'>,
): void {
  const previous = tagMutationByActor.get(actorId) ?? emptyTagMutationSnapshot;
  tagMutationByActor.set(actorId, {
    ...previous,
    ...updates,
    revision: previous.revision + 1,
  });
  tagMutationRevision = { revision: tagMutationRevision.revision + 1 };
  for (const listener of tagMutationListeners) listener();
}

function subscribeTagMutationSnapshot(listener: () => void): () => void {
  tagMutationListeners.add(listener);
  return () => tagMutationListeners.delete(listener);
}

function getTagMutationRevision(): { revision: number } {
  return tagMutationRevision;
}

function getActorTagMutation(actorId: string | undefined): TagMutationSnapshot {
  return actorId
    ? tagMutationByActor.get(actorId) ?? emptyTagMutationSnapshot
    : emptyTagMutationSnapshot;
}

function hasUnresolvedTagReconciliation(): boolean {
  return [...tagMutationByActor.values()].some((snapshot) => snapshot.reconciliation !== null);
}

function isCurrentTagActor(actorId: string): boolean {
  return useAuthStore.getState().currentUser?.id === actorId;
}

const POPOVER_WIDTH = 320;
const ESTIMATED_HEIGHT = 420;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

function orderedDrafts(tags: CalendarTag[]): DraftTag[] {
  return [...tags]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((tag) => ({ id: tag.id, key: tag.id, name: tag.name, color: tag.color }));
}

function projectedTags(drafts: DraftTag[], actorId: string, token: number): CalendarTag[] {
  return drafts.map((tag, index) => ({
    id: tag.id ?? `optimistic-tag:${actorId}:${token}:${index}`,
    name: tag.name,
    color: tag.color,
    sortOrder: index,
  }));
}

function tagsExactlyMatch(left: CalendarTag[], right: CalendarTag[]): boolean {
  const orderedLeft = [...left].sort((a, b) => a.sortOrder - b.sortOrder);
  const orderedRight = [...right].sort((a, b) => a.sortOrder - b.sortOrder);
  return orderedLeft.length === orderedRight.length
    && orderedLeft.every((tag, index) => {
      const expected = orderedRight[index];
      return expected !== undefined
        && tag.id === expected.id
        && tag.name === expected.name
        && tag.color === expected.color;
    });
}

function visibleTagsMatchDrafts(tags: CalendarTag[], drafts: DraftTag[]): boolean {
  const orderedTags = [...tags].sort((a, b) => a.sortOrder - b.sortOrder);
  return orderedTags.length === drafts.length
    && drafts.every((draft, index) => {
      const tag = orderedTags[index];
      return tag !== undefined
        && draft.id === tag.id
        && draft.name === tag.name
        && draft.color === tag.color;
    });
}

type TagVerification = 'committed' | 'not-committed' | 'ambiguous';

function verifyTagDrafts(
  beforeTags: CalendarTag[],
  drafts: DraftTag[],
  canonicalTags: CalendarTag[],
): TagVerification {
  const orderedCanonical = [...canonicalTags].sort((a, b) => a.sortOrder - b.sortOrder);
  const beforeIds = new Set(beforeTags.map((tag) => tag.id));
  const committed = orderedCanonical.length === drafts.length
    && drafts.every((draft, index) => {
      const canonical = orderedCanonical[index];
      if (!canonical || canonical.name !== draft.name || canonical.color !== draft.color) return false;
      return draft.id ? canonical.id === draft.id : !beforeIds.has(canonical.id);
    });
  if (committed) return 'committed';
  if (tagsExactlyMatch(beforeTags, orderedCanonical)) return 'not-committed';
  return 'ambiguous';
}

function calculatePosition(anchorRect: DOMRect, width: number, height: number): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  let left = anchorRect.left;
  let top = anchorRect.bottom + ANCHOR_GAP;

  if (left + width > viewportWidth - VIEWPORT_MARGIN) {
    left = viewportWidth - width - VIEWPORT_MARGIN;
  }
  if (top + height > viewportHeight - VIEWPORT_MARGIN) {
    const above = anchorRect.top - height - ANCHOR_GAP;
    top = above >= VIEWPORT_MARGIN
      ? above
      : viewportHeight - height - VIEWPORT_MARGIN;
  }

  return {
    left: Math.max(VIEWPORT_MARGIN, left),
    top: Math.max(VIEWPORT_MARGIN, top),
  };
}

function isPointInsideAnchor(event: MouseEvent, anchorRect: DOMRect): boolean {
  return event.clientX >= anchorRect.left
    && event.clientX <= anchorRect.right
    && event.clientY >= anchorRect.top
    && event.clientY <= anchorRect.bottom;
}

export function TagManagerPopover({ anchorRect, onClose }: TagManagerPopoverProps) {
  const currentUser = useAuthStore((state) => state.currentUser);
  const actorId = currentUser?.id;
  const tags = useCalendarStore((state) => state.tags);
  useSyncExternalStore(
    subscribeTagMutationSnapshot,
    getTagMutationRevision,
    getTagMutationRevision,
  );
  const sharedMutation = getActorTagMutation(actorId);
  const isAdmin = currentUser?.role === 'admin';
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => (
    calculatePosition(anchorRect, POPOVER_WIDTH, ESTIMATED_HEIGHT)
  ));
  const [localDrafts, setDrafts] = useState<DraftTag[]>(() => (
    cloneDrafts(
      sharedMutation.inFlight?.drafts
      ?? sharedMutation.reconciliation?.drafts
      ?? orderedDrafts(tags),
    )
  ));
  const [editing, setEditing] = useState<EditingTag | null>(null);
  const [localSaving, setSaving] = useState(false);
  const renderedActorId = useRef(actorId);
  const actorChanged = renderedActorId.current !== actorId;
  if (actorChanged) renderedActorId.current = actorId;
  const editingForActor = actorChanged || !isAdmin ? null : editing;
  const editingActive = editingForActor !== null;
  const appliedSharedRevision = useRef(sharedMutation.revision);
  if (actorChanged) appliedSharedRevision.current = sharedMutation.revision;
  const sharedDrafts = sharedMutation.inFlight?.drafts
    ?? sharedMutation.reconciliation?.drafts
    ?? (
      sharedMutation.revision > appliedSharedRevision.current
        ? sharedMutation.settledDrafts
        : null
    );
  const drafts = actorChanged ? orderedDrafts(tags) : sharedDrafts ?? localDrafts;
  const reconciliationMode = sharedMutation.reconciliation?.mode ?? null;
  const mutationsLocked = activeTagOperation !== null
    || hasUnresolvedTagReconciliation();
  const saving = localSaving || activeTagOperation !== null;
  const reconciliationRequired = reconciliationMode !== null;

  useEffect(() => {
    if (!sharedMutation.inFlight && !sharedMutation.reconciliation) {
      setDrafts(orderedDrafts(tags));
    }
  }, [sharedMutation.inFlight, sharedMutation.reconciliation, tags]);

  useEffect(() => {
    if (sharedMutation.revision === appliedSharedRevision.current) return;
    appliedSharedRevision.current = sharedMutation.revision;
    const nextDrafts = sharedMutation.inFlight?.drafts
      ?? sharedMutation.reconciliation?.drafts
      ?? sharedMutation.settledDrafts;
    if (nextDrafts) setDrafts(cloneDrafts(nextDrafts));
  }, [sharedMutation]);

  useEffect(() => {
    setEditing(null);
  }, [actorId, isAdmin]);

  const updatePosition = useCallback(() => {
    const rect = popoverRef.current?.getBoundingClientRect();
    setPosition(calculatePosition(
      anchorRect,
      rect?.width ?? POPOVER_WIDTH,
      rect?.height ?? ESTIMATED_HEIGHT,
    ));
  }, [anchorRect]);

  useLayoutEffect(() => {
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [updatePosition]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (popoverRef.current?.contains(event.target as Node)) return;
      if (isPointInsideAnchor(event, anchorRect)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (editingActive) {
        setEditing(null);
        return;
      }
      onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRect, editingActive, onClose]);

  const refreshCanonicalTags = async (
    mode: ReconciliationMode,
    operationActorId: string,
  ): Promise<{ tagsFresh: boolean; tags: CalendarTag[] }> => {
    const revisionBeforeRefresh = getTagCanonicalSnapshot(operationActorId)?.revision ?? 0;
    const eventsFresh = mode === 'events'
      ? await loadBflowEvents({ requireTagsFresh: true })
      : true;
    if (mode === 'metadata') await useCalendarStore.getState().loadAll();
    const canonical = getTagCanonicalSnapshot(operationActorId);
    return {
      tagsFresh: eventsFresh && canonical !== null && canonical.revision > revisionBeforeRefresh,
      tags: canonical?.tags ?? [],
    };
  };

  const settleTagOperation = (
    token: number,
    operationActorId: string,
    finalDrafts: DraftTag[],
    reconciliation: PendingTagReconciliation | null,
  ): boolean => {
    const actorMutation = getActorTagMutation(operationActorId);
    if (
      activeTagOperation?.token !== token
      || activeTagOperation.actorId !== operationActorId
      || actorMutation.inFlight?.token !== token
      || actorMutation.inFlight.actorId !== operationActorId
    ) return false;
    activeTagOperation = null;
    publishTagMutationSnapshot(operationActorId, {
      inFlight: null,
      reconciliation,
      settledDrafts: cloneDrafts(finalDrafts),
    });
    return true;
  };

  const clearTagOverlay = (operationActorId: string, token: number): void => {
    useCalendarStore.getState().clearTagOptimisticOverlay(operationActorId, token);
  };

  const reconcileFromCanonical = async () => {
    const operationActorId = actorId;
    if (!operationActorId || !isCurrentTagActor(operationActorId) || activeTagOperation) return;
    const actorMutation = getActorTagMutation(operationActorId);
    const pending = actorMutation.reconciliation;
    if (!pending || actorMutation.inFlight || pending.actorId !== operationActorId) return;
    const token = ++nextTagOperationToken;
    activeTagOperation = { actorId: operationActorId, token };
    publishTagMutationSnapshot(operationActorId, {
      inFlight: {
        actorId: operationActorId,
        token,
        drafts: cloneDrafts(pending.drafts),
        beforeRevision: pending.beforeRevision,
        beforeTags: cloneTags(pending.beforeTags),
        mode: pending.mode,
      },
      settledDrafts: null,
    });
    useCalendarStore.getState().setTagOptimisticOverlay(
      operationActorId,
      token,
      projectedTags(pending.drafts, operationActorId, token),
    );
    setSaving(true);
    let refresh = { tagsFresh: false, tags: [] as CalendarTag[] };
    try {
      refresh = await refreshCanonicalTags(pending.mode, operationActorId);
    } catch {
      refresh = { tagsFresh: false, tags: [] };
    }
    if (
      activeTagOperation?.token !== token
      || activeTagOperation.actorId !== operationActorId
    ) return;
    if (!isCurrentTagActor(operationActorId)) {
      settleTagOperation(token, operationActorId, pending.drafts, pending);
      setSaving(false);
      return;
    }
    if (!refresh.tagsFresh) {
      settleTagOperation(token, operationActorId, pending.drafts, pending);
      setSaving(false);
      toast.error('최신 태그 목록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }

    if (pending.persistenceSucceeded) {
      const canonicalDrafts = orderedDrafts(refresh.tags);
      if (settleTagOperation(token, operationActorId, canonicalDrafts, null)) {
        clearTagOverlay(operationActorId, token);
      }
      setDrafts(canonicalDrafts);
      setEditing(null);
      setSaving(false);
      return;
    }

    const verification = verifyTagDrafts(pending.beforeTags, pending.drafts, refresh.tags);
    if (verification !== 'ambiguous') {
      const canonicalDrafts = orderedDrafts(refresh.tags);
      if (settleTagOperation(token, operationActorId, canonicalDrafts, null)) {
        clearTagOverlay(operationActorId, token);
      }
      setDrafts(canonicalDrafts);
      setEditing(null);
      setSaving(false);
      toast.error(verification === 'committed'
        ? '응답은 받지 못했지만 최신 목록에서 태그 변경을 확인했어요.'
        : '태그 변경이 저장되지 않은 것을 확인했어요. 내용을 확인하고 다시 시도해 주세요.');
      return;
    }
    settleTagOperation(token, operationActorId, pending.drafts, pending);
    setSaving(false);
    toast.error('최신 목록에서도 태그 저장 결과를 확정하지 못했어요. 잠시 후 다시 확인해 주세요.');
  };

  const persistDrafts = async (
    nextDrafts: DraftTag[],
    refreshEvents = false,
  ): Promise<boolean> => {
    const operationActorId = currentUser?.id;
    if (!operationActorId || !isAdmin || !isCurrentTagActor(operationActorId)) return false;
    const actorMutation = getActorTagMutation(operationActorId);
    if (
      activeTagOperation
      || actorMutation.inFlight
      || hasUnresolvedTagReconciliation()
    ) return false;
    const requestedMode: ReconciliationMode = refreshEvents ? 'events' : 'metadata';
    const beforeSnapshot = getTagCanonicalSnapshot(operationActorId);
    const beforeTags = beforeSnapshot?.tags ?? cloneTags(tags);
    const beforeRevision = beforeSnapshot?.revision ?? 0;
    const token = ++nextTagOperationToken;
    activeTagOperation = { actorId: operationActorId, token };
    publishTagMutationSnapshot(operationActorId, {
      inFlight: {
        actorId: operationActorId,
        token,
        drafts: cloneDrafts(nextDrafts),
        beforeRevision,
        beforeTags: cloneTags(beforeTags),
        mode: requestedMode,
      },
      reconciliation: null,
      settledDrafts: null,
    });
    useCalendarStore.getState().setTagOptimisticOverlay(
      operationActorId,
      token,
      projectedTags(nextDrafts, operationActorId, token),
    );
    setSaving(true);
    setDrafts(nextDrafts);
    let persistenceSucceeded = false;
    let committedDrafts: DraftTag[] | null = null;
    try {
      const savedRows = await window.electronAPI.calendarTagsSave(nextDrafts.map((tag, index) => ({
        ...(tag.id ? { id: tag.id } : {}),
        name: tag.name.trim(),
        color: tag.color,
        sort_order: index,
      })));
      committedDrafts = [...savedRows]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((tag) => ({
          id: tag.id,
          key: tag.id,
          name: tag.name,
          color: tag.color,
        }));
      persistenceSucceeded = true;
      useCalendarStore.getState().setTagOptimisticOverlay(
        operationActorId,
        token,
        projectedTags(committedDrafts, operationActorId, token),
      );
    } catch {
      persistenceSucceeded = false;
    }
    if (
      activeTagOperation?.token !== token
      || activeTagOperation.actorId !== operationActorId
    ) return false;
    const outcomeDrafts = committedDrafts ?? nextDrafts;
    const pending: PendingTagReconciliation = {
      actorId: operationActorId,
      drafts: cloneDrafts(outcomeDrafts),
      beforeRevision,
      beforeTags: cloneTags(beforeTags),
      mode: requestedMode,
      lockMutations: true,
      persistenceSucceeded,
    };
    if (!isCurrentTagActor(operationActorId)) {
      settleTagOperation(token, operationActorId, outcomeDrafts, pending);
      setSaving(false);
      return false;
    }

    let refresh = { tagsFresh: false, tags: [] as CalendarTag[] };
    try {
      refresh = await refreshCanonicalTags(requestedMode, operationActorId);
    } catch {
      refresh = { tagsFresh: false, tags: [] };
    }
    if (
      activeTagOperation?.token !== token
      || activeTagOperation.actorId !== operationActorId
    ) return false;
    if (!isCurrentTagActor(operationActorId)) {
      settleTagOperation(token, operationActorId, outcomeDrafts, pending);
      setSaving(false);
      return false;
    }

    if (persistenceSucceeded && refresh.tagsFresh) {
      const canonicalDrafts = orderedDrafts(refresh.tags);
      if (settleTagOperation(token, operationActorId, canonicalDrafts, null)) {
        clearTagOverlay(operationActorId, token);
      }
      setDrafts(canonicalDrafts);
      setEditing(null);
      setSaving(false);
      return true;
    }
    if (!persistenceSucceeded && refresh.tagsFresh) {
      const verification = verifyTagDrafts(beforeTags, nextDrafts, refresh.tags);
      if (verification !== 'ambiguous') {
        const canonicalDrafts = orderedDrafts(refresh.tags);
        if (settleTagOperation(token, operationActorId, canonicalDrafts, null)) {
          clearTagOverlay(operationActorId, token);
        }
        setDrafts(canonicalDrafts);
        if (verification === 'committed') setEditing(null);
        setSaving(false);
        toast.error(verification === 'committed'
          ? '응답은 받지 못했지만 최신 목록에서 태그 변경을 확인했어요.'
          : '태그 변경이 저장되지 않은 것을 확인했어요. 내용을 확인하고 다시 시도해 주세요.');
        return verification === 'committed';
      }
    }

    settleTagOperation(token, operationActorId, outcomeDrafts, pending);
    setDrafts(outcomeDrafts);
    setEditing(null);
    setSaving(false);
    if (persistenceSucceeded) {
      toast.error('태그는 저장됐지만 최신 목록을 불러오지 못했어요. 최신 목록 확인 후 다시 편집해 주세요.');
      return true;
    }
    if (refresh.tagsFresh) {
      toast.error('최신 목록에서도 태그 저장 결과를 확정하지 못했어요. 목록을 다시 확인해 주세요.');
      return false;
    }
    toast.error('태그 저장 결과와 최신 목록을 확인할 수 없어요. 최신 목록을 다시 불러와 주세요.');
    return false;
  };

  const beginEdit = (tag: DraftTag) => {
    if (!isAdmin || saving || mutationsLocked) return;
    setEditing({
      key: tag.key,
      label: tag.name,
      name: tag.name,
      color: tag.color,
      isNew: false,
    });
  };

  const beginAdd = () => {
    if (!isAdmin || saving || editingForActor || mutationsLocked) return;
    setEditing({
      key: 'new-tag',
      label: '새',
      name: '',
      color: EVENT_COLORS[0],
      isNew: true,
    });
  };

  const confirmEdit = async () => {
    if (!editingForActor || !editingForActor.name.trim()) return;
    const nextDrafts = editingForActor.isNew
      ? [...drafts, {
        key: editingForActor.key,
        name: editingForActor.name.trim(),
        color: editingForActor.color,
      }]
      : drafts.map((tag) => (
        tag.key === editingForActor.key
          ? { ...tag, name: editingForActor.name.trim(), color: editingForActor.color }
          : tag
      ));
    if (await persistDrafts(nextDrafts)) setEditing(null);
  };

  const moveTag = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (
      !isAdmin || saving || editingForActor || mutationsLocked
      || nextIndex < 0 || nextIndex >= drafts.length
    ) return;
    const nextDrafts = [...drafts];
    [nextDrafts[index], nextDrafts[nextIndex]] = [nextDrafts[nextIndex], nextDrafts[index]];
    await persistDrafts(nextDrafts);
  };

  const deleteTag = async (tag: DraftTag) => {
    const operationActorId = currentUser?.id;
    if (!operationActorId || !isAdmin || saving || editingForActor || mutationsLocked) return;
    const mutationRevisionAtConfirm = getActorTagMutation(operationActorId).revision;
    const canonicalRevisionAtConfirm = getTagCanonicalSnapshot(operationActorId)?.revision ?? 0;
    const confirmedDrafts = cloneDrafts(drafts);
    const confirmedIdentity = { id: tag.id, key: tag.key, name: tag.name, color: tag.color };
    const confirmed = await ConfirmDialog.show({
      message: "이 태그를 쓰는 일정은 '태그 없음'으로 바뀌어요",
      confirmLabel: '삭제',
      tone: 'danger',
    });
    if (!confirmed) return;
    const currentActor = useAuthStore.getState().currentUser;
    const currentCanonicalRevision = getTagCanonicalSnapshot(operationActorId)?.revision ?? 0;
    const currentTag = useCalendarStore.getState().tags.find((candidate) => (
      candidate.id === confirmedIdentity.id
      && candidate.name === confirmedIdentity.name
      && candidate.color === confirmedIdentity.color
    ));
    if (
      currentActor?.id !== operationActorId
      || currentActor.role !== 'admin'
      || activeTagOperation !== null
      || getActorTagMutation(operationActorId).revision !== mutationRevisionAtConfirm
      || currentCanonicalRevision !== canonicalRevisionAtConfirm
      || !currentTag
      || !visibleTagsMatchDrafts(useCalendarStore.getState().tags, confirmedDrafts)
    ) return;
    await persistDrafts(
      confirmedDrafts.filter((draft) => draft.key !== confirmedIdentity.key),
      true,
    );
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="태그 관리 팝오버"
      className="fixed z-[1000] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-bg-border/70 p-3 text-text-primary"
      style={{
        ...floatingGlassStyle,
        left: position.left,
        top: position.top,
        width: POPOVER_WIDTH,
        background: 'rgb(var(--color-bg-card) / 0.97)',
        boxShadow: '0 18px 42px rgb(var(--color-shadow) / calc(var(--shadow-alpha) * 1.35))',
      }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="mb-3 flex items-center justify-between border-b border-bg-border/50 pb-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">태그 관리</h2>
          {!isAdmin && (
            <span className="rounded-full bg-bg-border/60 px-2 py-0.5 text-[10px] text-text-secondary">
              관리자만 편집
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="태그 관리 닫기"
          onClick={onClose}
          className="rounded-md p-1 text-text-secondary transition-colors hover:bg-bg-border/60 hover:text-text-primary cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>

      <div className="space-y-1.5">
        {drafts.length === 0 && !editingForActor && (
          <p className="py-5 text-center text-xs text-text-secondary">등록된 태그가 없어요</p>
        )}
        {drafts.map((tag, index) => (
          editingForActor?.key === tag.key ? (
            <TagEditor key={tag.key} editing={editingForActor} saving={saving} onChange={setEditing} onConfirm={confirmEdit} onCancel={() => setEditing(null)} />
          ) : (
            <div key={tag.key} className="flex min-h-9 items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-bg-border/25">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{tag.name}</span>
              {isAdmin && (
                <div className="flex items-center gap-0.5">
                  <IconButton label={`${tag.name} 태그 위로`} disabled={saving || mutationsLocked || Boolean(editingForActor) || index === 0} onClick={() => moveTag(index, -1)}>
                    <ChevronUp size={13} />
                  </IconButton>
                  <IconButton label={`${tag.name} 태그 아래로`} disabled={saving || mutationsLocked || Boolean(editingForActor) || index === drafts.length - 1} onClick={() => moveTag(index, 1)}>
                    <ChevronDown size={13} />
                  </IconButton>
                  <IconButton label={`${tag.name} 태그 편집`} disabled={saving || mutationsLocked || Boolean(editingForActor)} onClick={() => beginEdit(tag)}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton label={`${tag.name} 태그 삭제`} disabled={saving || mutationsLocked || Boolean(editingForActor)} danger onClick={() => deleteTag(tag)}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              )}
            </div>
          )
        ))}

        {editingForActor?.isNew && (
          <TagEditor editing={editingForActor} saving={saving} onChange={setEditing} onConfirm={confirmEdit} onCancel={() => setEditing(null)} />
        )}
      </div>

      {reconciliationRequired && (
        <div className="mt-2 rounded-lg border border-amber-400/35 bg-amber-400/10 p-2.5">
          <p className="text-[11px] leading-4 text-text-secondary">
            {mutationsLocked
              ? '저장 결과를 확인하는 동안 태그 변경을 잠시 멈췄어요.'
              : '태그는 저장됐어요. 최신 목록 반영만 다시 확인해 주세요.'}
          </p>
          <button
            type="button"
            aria-label="최신 태그 목록 다시 불러오기"
            onClick={reconcileFromCanonical}
            disabled={saving}
            className="mt-2 w-full rounded-md border border-bg-border px-2 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-bg-border/50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            최신 목록 다시 불러오기
          </button>
        </div>
      )}

      {isAdmin && !editingForActor && (
        <button
          type="button"
          onClick={beginAdd}
          disabled={saving || mutationsLocked}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-bg-border px-3 py-2 text-xs text-text-secondary transition-colors hover:border-accent/50 hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          <Plus size={13} /> 새 태그
        </button>
      )}

      <p className="mt-3 border-t border-bg-border/50 pt-2.5 text-[11px] leading-4 text-text-secondary">
        휴가는 자동 태그라 여기서 바꿀 수 없어요
      </p>
    </div>,
    document.body,
  );
}

interface TagEditorProps {
  editing: EditingTag;
  saving: boolean;
  onChange: (next: EditingTag) => void;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

function TagEditor({ editing, saving, onChange, onConfirm, onCancel }: TagEditorProps) {
  return (
    <div className="rounded-lg border border-accent/35 bg-accent/5 p-2">
      <input
        type="text"
        aria-label={`${editing.label} 태그 이름`}
        value={editing.name}
        maxLength={30}
        autoFocus
        onChange={(event) => onChange({ ...editing, name: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void onConfirm();
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        className="w-full rounded-md border border-bg-border bg-bg-primary/80 px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        placeholder="태그 이름"
      />
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="태그 색상">
        {EVENT_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${color} 태그 색상`}
            aria-pressed={editing.color === color}
            onClick={() => onChange({ ...editing, color })}
            className="relative h-5 w-5 rounded-full transition-transform hover:scale-110 cursor-pointer"
            style={{ backgroundColor: color }}
          >
            {editing.color === color && <Check size={11} className="absolute inset-0 m-auto text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
      <div className="mt-2 flex justify-end gap-1.5">
        <button
          type="button"
          aria-label={`${editing.label} 태그 편집 취소`}
          onClick={onCancel}
          disabled={saving}
          className="rounded-md px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-border/50 disabled:opacity-50 cursor-pointer"
        >
          취소
        </button>
        <button
          type="button"
          aria-label={`${editing.label} 태그 저장`}
          onClick={onConfirm}
          disabled={saving || !editing.name.trim()}
          className="rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-white hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          확인
        </button>
      </div>
    </div>
  );
}

interface IconButtonProps {
  label: string;
  disabled: boolean;
  danger?: boolean;
  onClick: () => void | Promise<void>;
  children: React.ReactNode;
}

function IconButton({ label, disabled, danger = false, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-25 cursor-pointer ${
        danger
          ? 'text-text-secondary hover:bg-red-500/10 hover:text-red-400'
          : 'text-text-secondary hover:bg-bg-border/60 hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}
