/**
 * 리테이크 허브 (5단계 — Chunk E-core).
 *
 * 감독/취합자용 세트 허브. 2단 레이아웃:
 *   좌측 — 세트 목록(제목·에피소드·취합자·진행률 미니바). 완료 세트는 흐림+초록.
 *   우측 — 선택 세트 상세: 헤더(제목·에피소드·취합자·진행률 바) + 자동취합 탭 + 시안 B 테이블.
 *
 * 세트 하위 항목 = useRevisionStore.revisions 중 setId 가 그 세트인 것. '전반'(sceneKey 없음)은 별도 그룹.
 * 시안 B 행 클릭 → 인라인 확장(담당 칩/완료멘트/최종완료 바 — revision/* 컴포넌트 재사용).
 *
 * 데이터/낙관 CRUD 는 useRevisionSetStore + revisionSetService 가 전담. 뷰는 호출만 한다.
 * 자동완료는 선택 세트 하위 항목이 바뀔 때 effect 에서 maybeAutoCompleteSet 호출(서비스가 중복쓰기 가드).
 *
 * 부서(BG/ACT) 라벨 텍스트는 노출하지 않는다(메모리 규칙). 상태 색/내부 그룹만 사용.
 *
 * spec: docs/superpowers/specs/2026-06-17-retake-hub-redesign-design.md §9
 */

import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, Plus, Trash2, Users as UsersIcon, ChevronRight, FolderInput } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDataStore } from '@/stores/useDataStore';
import { useAppStore } from '@/stores/useAppStore';
import { setRevisionsSheetsMode } from '@/services/revisionService';
import { useRevisionStore } from '@/stores/useRevisionStore';
import { useRevisionSetStore } from '@/stores/useRevisionSetStore';
import { loadRevisionSets, removeRevisionSet, maybeAutoCompleteSet } from '@/services/revisionSetService';
import { computeSetProgress } from '@/utils/revisionSet';
import { isGeneralRevisionSceneKey } from '@/utils/revisionGeneral';
import { isCompositorForCompositing } from '@/utils/compositingLabels';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { toast as sonnerToast } from 'sonner';
import type { CompRevision, CompRevisionSet } from '@/types';
import { RetakeHubItemTable, type HubTab } from './retake-hub/RetakeHubItemTable';
import { RetakeSceneModalProvider } from './retake-hub/RetakeSceneModalProvider';

const RevisionSetCreateModal = lazy(() =>
  import('./retake-hub/RevisionSetCreateModal').then((m) => ({ default: m.RevisionSetCreateModal })),
);

const RevisionImportModal = lazy(() =>
  import('./retake-hub/RevisionImportModal').then((m) => ({ default: m.RevisionImportModal })),
);

const RevisionAddModal = lazy(() =>
  import('./retake-hub/RevisionAddModal').then((m) => ({ default: m.RevisionAddModal })),
);

const TABS: { id: HubTab; label: string }[] = [
  { id: 'part', label: '파트별' },
  { id: 'assignee', label: '담당자별' },
  { id: 'status', label: '진행상태별' },
  { id: 'scene', label: '에피소드·씬 순' },
];

function setItemsOf(revisions: CompRevision[], setId: string): CompRevision[] {
  return revisions.filter((r) => r.setId === setId);
}

// ─── 좌측 세트 목록 카드 ───────────────────────────────

function SetListCard({
  set,
  items,
  selected,
  aggregatorName,
  episodeLabel,
  onClick,
}: {
  set: CompRevisionSet;
  items: CompRevision[];
  selected: boolean;
  aggregatorName: string | null;
  episodeLabel: string | null;
  onClick: () => void;
}) {
  const progress = computeSetProgress(items);
  const isDone = set.status === 'done';

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left rounded-xl border p-3 transition-all cursor-pointer',
        selected
          ? 'border-accent/60 bg-accent/10'
          : 'border-bg-border/60 bg-bg-card/60 hover:border-accent/35 hover:bg-bg-border/30',
        isDone && !selected ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-bold text-text-primary leading-snug line-clamp-2">
          {set.title}
        </span>
        {isDone && (
          <span
            className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{ color: 'var(--status-done)', background: 'color-mix(in srgb, var(--status-done) 15%, transparent)' }}
          >
            완료
          </span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px] text-text-secondary/70">
        {episodeLabel && <span>{episodeLabel}</span>}
        {aggregatorName && (
          <span className="inline-flex items-center gap-1">
            <UsersIcon size={11} className="shrink-0" />
            {aggregatorName}
          </span>
        )}
      </div>

      {/* 진행률 미니바 */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-bg-border/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress.pct}%`,
              background: isDone ? 'var(--status-done)' : 'rgb(var(--color-accent))',
            }}
          />
        </div>
        <span className="text-[10px] font-mono text-text-secondary/70 shrink-0">
          {progress.done}/{progress.total}
        </span>
      </div>
    </button>
  );
}

// ─── 우측 상세 헤더 ───────────────────────────────

function SetDetailHeader({
  set,
  items,
  aggregatorName,
  episodeLabel,
  canManage,
  onAddItem,
  onImport,
  onDelete,
}: {
  set: CompRevisionSet;
  items: CompRevision[];
  aggregatorName: string | null;
  episodeLabel: string | null;
  canManage: boolean;
  onAddItem: () => void;
  onImport: () => void;
  onDelete: () => void;
}) {
  const progress = computeSetProgress(items);
  const isDone = set.status === 'done';

  return (
    <div className="shrink-0 px-5 py-4 border-b border-bg-border/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-text-primary leading-tight">{set.title}</h2>
          <div className="mt-1.5 flex items-center gap-2.5 flex-wrap text-[12px] text-text-secondary/80">
            {episodeLabel && <span>{episodeLabel}</span>}
            {aggregatorName && (
              <span className="inline-flex items-center gap-1">
                <UsersIcon size={12} className="shrink-0" />
                취합자 {aggregatorName}
              </span>
            )}
          </div>
        </div>
        {/* 항목 추가·가져오기는 누구나(스펙 §9.4), 세트 삭제는 컴포지터급만. */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={onAddItem}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-accent/50 bg-accent/10 text-[11px] font-semibold text-accent hover:bg-accent/20 transition-all cursor-pointer"
            title="이 세트에 새 항목 만들기"
          >
            <Plus size={12} strokeWidth={2.6} />
            항목 추가
          </button>
          <button
            type="button"
            onClick={onImport}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-bg-border/50 text-[11px] font-semibold text-text-secondary/85 hover:text-accent hover:border-accent/40 hover:bg-accent/10 transition-all cursor-pointer"
            title="기존 리테이크를 이 세트로 가져오기"
          >
            <FolderInput size={12} />
            기존 리테이크 가져오기
          </button>
          {canManage && (
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-bg-border/50 text-[11px] font-semibold text-text-secondary/75 hover:text-red-400 hover:border-red-400/40 hover:bg-red-500/10 transition-all cursor-pointer"
              title="세트 삭제"
            >
              <Trash2 size={12} />
              세트 삭제
            </button>
          )}
        </div>
      </div>

      {/* 진행률 바 */}
      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1 h-2 rounded-full bg-bg-border/60 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${progress.pct}%`,
              background: isDone ? 'var(--status-done)' : 'rgb(var(--color-accent))',
            }}
          />
        </div>
        <span className="text-[12px] font-semibold text-text-secondary shrink-0">
          {progress.done}/{progress.total} 최종완료
        </span>
      </div>
    </div>
  );
}

// ─── 메인 뷰 ───────────────────────────────

export default function RetakeHubView() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const allUsers = useAuthStore((s) => s.users);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);

  const sets = useRevisionSetStore((s) => s.sets);
  const selectedSetId = useRevisionSetStore((s) => s.selectedSetId);
  const select = useRevisionSetStore((s) => s.select);
  const loadingSets = useRevisionSetStore((s) => s.loading);

  const revisions = useRevisionStore((s) => s.revisions);
  const loadRevisions = useRevisionStore((s) => s.loadRevisions);
  const isLoading = useRevisionStore((s) => s.isLoading);
  const deleteRevision = useRevisionStore((s) => s.deleteRevision);
  // 리비전 로드 완료 여부 — 자동완료 판정 가드(로드 전 빈 목록으로 done→open 오작동 방지).
  const revisionsLoaded = useRevisionStore((s) => s.lastLoadTime !== null && !s.isLoading);
  const dataConnected = useAppStore((s) => s.dataConnected);
  const pendingRetakeId = useAppStore((s) => s.pendingRetakeId);
  const pendingRetakeTarget = useAppStore((s) => s.pendingRetakeTarget);
  const refreshedRetakeRequest = useRef<number | null>(null);
  const [focusedRevisionId, setFocusedRevisionId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);

  const [tab, setTab] = useState<HubTab>('part');
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const canManage = isCompositorForCompositing(currentUser);

  // 마운트 시 세트 + 리비전 로드 (preview mock 포함).
  //   허브를 사이드바에서 바로 열어도 다른 뷰처럼 Supabase 모드가 되도록 dataConnected 로 리비전 모드를 먼저 설정한다.
  //   (안 하면 revisionService 가 기본 로컬 파일 모드라 허브가 빈/stale 목록을 읽고, 담당/세트 액션이 로컬에만 저장됨 — 코덱스 P1.)
  useEffect(() => {
    setRevisionsSheetsMode(dataConnected);
    loadRevisionSets();
    loadRevisions();
  }, [dataConnected, loadRevisions]);

  // 세트 목록이 들어오면 선택이 비어 있을 때 첫 세트 자동 선택.
  useEffect(() => {
    if (!selectedSetId && sets.length > 0) {
      select(sets[0].id);
    }
  }, [sets, selectedSetId, select]);

  useEffect(() => {
    // The mount's load effect may already have started after this render.
    if (!pendingRetakeId || useRevisionStore.getState().isLoading) return;
    const live = useAppStore.getState();
    if (live.pendingRetakeId !== pendingRetakeId || live.pendingRetakeTarget !== pendingRetakeTarget) return;
    const verified = pendingRetakeTarget?.revision.id === pendingRetakeId ? pendingRetakeTarget.revision : undefined;
    // Keep complete-list guards for set mutations, while allowing this verified row after a list failure.
    if (!verified && !revisionsLoaded) return;
    const revision = verified ?? revisions.find((item) => item.id === pendingRetakeId);
    if (!revision?.setId) return;
    if (!sets.some((set) => set.id === revision.setId)) {
      if (loadingSets) return;
      if (verified && pendingRetakeTarget && refreshedRetakeRequest.current !== pendingRetakeTarget.requestId) {
        const requestId = pendingRetakeTarget.requestId;
        refreshedRetakeRequest.current = requestId;
        const refresh = () => {
          const app = useAppStore.getState();
          if (app.pendingRetakeTarget?.requestId !== requestId || app.currentView !== 'retake-hub') return;
          void loadRevisionSets().then((nextSets) => {
            if (useAppStore.getState().pendingRetakeTarget?.requestId !== requestId
              || nextSets.some((set) => set.id === revision.setId)) return;
            sonnerToast.error('리테이크 세트를 불러오지 못했어요. 연결 상태를 확인해주세요.', {
              action: { label: '다시 시도', onClick: refresh },
            });
          });
        };
        refresh();
      }
      return;
    }
    if (verified) useRevisionStore.getState().applyNavigationRevision(revision.id, revision);
    select(revision.setId);
    setTab('part');
    setFocusedRevisionId(revision.id);
    setFocusToken((value) => value + 1);
    useAppStore.getState().setPendingRetakeId(null);
  }, [pendingRetakeId, pendingRetakeTarget, revisionsLoaded, isLoading, loadingSets, revisions, sets, select]);

  const userNameOf = useMemo(() => {
    const map = new Map(allUsers.map((u) => [u.id, u.name]));
    return (id: string | null | undefined) => (id ? map.get(id) ?? null : null);
  }, [allUsers]);

  const episodeLabelOf = useMemo(() => {
    return (ep: number | null | undefined): string | null => {
      if (ep == null) return null;
      return episodeTitles[ep] || `EP.${String(ep).padStart(2, '0')}`;
    };
  }, [episodeTitles]);

  // 세트 id → 제목 (가져오기 모달에서 타 세트 소속 표시용).
  const setTitleOf = useMemo(() => {
    const map = new Map(sets.map((s) => [s.id, s.title]));
    return (id: string) => map.get(id) ?? null;
  }, [sets]);

  const selectedSet = useMemo(
    () => sets.find((s) => s.id === selectedSetId) ?? null,
    [sets, selectedSetId],
  );

  const selectedItems = useMemo(
    () => (selectedSet ? setItemsOf(revisions, selectedSet.id) : []),
    [revisions, selectedSet],
  );

  // 자동완료 배선 — 선택 세트의 하위 항목이 바뀔 때 maybeAutoCompleteSet 호출.
  // 서비스가 nextSetStatus 와 현재 status 가 같으면 no-op(중복 쓰기 방지)이라 매번 안전하게 호출 가능.
  useEffect(() => {
    // 리비전 로드 전엔 selectedItems 가 []라 done 세트를 잘못 open 으로 되돌릴 수 있다(코덱스 P2).
    //   로드가 끝난 뒤에만 자동완료 판정한다.
    if (!selectedSet || !revisionsLoaded) return;
    void maybeAutoCompleteSet(selectedSet, selectedItems);
  }, [selectedSet, selectedItems, revisionsLoaded]);

  const handleDeleteSet = async () => {
    if (!selectedSet) return;
    // 리비전 로드 전엔 selectedItems 가 비어 전반 항목을 못 잡는다. 그 상태로 세트를 지우면
    //   FK 가 전반 항목의 setId 만 비워 고아가 되므로(코덱스 P2), 로드 완료 후에만 삭제한다.
    if (!revisionsLoaded) {
      sonnerToast.error('아직 항목을 불러오는 중이에요. 잠시 후 다시 시도해주세요.');
      return;
    }
    // '전반' 항목은 세트 밖에선 볼 수 없어, 세트 삭제로 setId 만 풀리면 고아가 된다(코덱스 P2).
    //   → 세트 삭제 시 함께 삭제한다. 씬 매인 항목은 씬 패널에 남으므로 소속만 해제.
    const generalItems = selectedItems.filter((r) => isGeneralRevisionSceneKey(r.sceneKey));
    // 삭제 권한 preflight(코덱스 P2) — 리비전 삭제는 등록자 본인 또는 관리자만 가능(electron deleteRevision).
    //   못 지우는 전반 항목이 하나라도 있으면, 일부만 지우고 중단해 데이터가 사라지는 부분 삭제를 막기 위해
    //   삭제를 아예 시작하지 않는다.
    const isAdmin = currentUser?.role === 'admin';
    const undeletable = generalItems.filter((r) => !isAdmin && r.requesterId !== currentUser?.id);
    if (undeletable.length > 0) {
      sonnerToast.error('내가 등록하지 않은 전반 항목이 있어 세트를 삭제할 수 없어요. 등록자나 관리자에게 요청해주세요.');
      return;
    }
    const ok = await ConfirmDialog.show({
      message:
        `"${selectedSet.title}" 세트를 삭제하시겠습니까?\n` +
        (generalItems.length > 0
          ? `씬에 연결된 항목은 사라지지 않고 세트 소속만 해제되지만, '전반' 항목 ${generalItems.length}개는 세트 밖에선 볼 수 없어 함께 삭제됩니다.`
          : '세트 안의 리테이크 항목은 사라지지 않고 세트 소속만 해제됩니다.'),
      confirmLabel: '세트 삭제',
      tone: 'danger',
    });
    if (!ok) return;
    // 전반 항목 먼저 삭제 → 세트 삭제(나머지 씬 매인 항목은 FK SET NULL 로 소속만 해제).
    // preflight 로 권한은 보장됐지만, 일시적 실패(네트워크 등)가 나면 세트 삭제를 중단해
    //   FK 가 setId 만 비워 고아가 되는 걸 막는다(코덱스 P2).
    let anyFailed = false;
    for (const r of generalItems) {
      try {
        await deleteRevision(r.id, r.sceneKey);
      } catch (err) {
        console.error('[리테이크 허브] 전반 항목 삭제 실패:', err);
        anyFailed = true;
      }
    }
    if (anyFailed) {
      sonnerToast.error('일부 전반 항목을 삭제하지 못해 세트를 삭제하지 않았어요. 잠시 후 다시 시도해주세요.');
      return;
    }
    await removeRevisionSet(selectedSet.id);
  };

  return (
    <RetakeSceneModalProvider>
    <div className="flex h-full min-h-0">
      {/* ─── 좌측 세트 목록 ─── */}
      <aside className="w-72 shrink-0 flex flex-col border-r border-bg-border/60 min-h-0">
        <div className="shrink-0 px-4 py-3.5 border-b border-bg-border/60 flex items-center justify-between gap-2">
          <h1 className="inline-flex items-center gap-2 text-[15px] font-bold text-text-primary">
            <ListChecks size={18} className="text-accent" />
            리테이크 허브
          </h1>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent text-white text-[11px] font-bold hover:opacity-90 cursor-pointer transition-opacity"
              title="새 세트 만들기"
            >
              <Plus size={13} strokeWidth={2.6} />
              세트
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0">
          {sets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-text-secondary/50">
              <ListChecks size={28} className="mb-2 opacity-60" />
              <p className="text-xs leading-relaxed">
                {loadingSets ? '세트를 불러오는 중…' : '아직 만들어진 세트가 없습니다.'}
              </p>
              {canManage && !loadingSets && (
                <p className="text-[11px] mt-1 text-text-secondary/40">
                  위 ‘세트’ 버튼으로 첫 세트를 만들어보세요.
                </p>
              )}
            </div>
          ) : (
            sets.map((set) => (
              <SetListCard
                key={set.id}
                set={set}
                items={setItemsOf(revisions, set.id)}
                selected={set.id === selectedSetId}
                aggregatorName={userNameOf(set.aggregatorId)}
                episodeLabel={episodeLabelOf(set.episodeNumber)}
                onClick={() => select(set.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ─── 우측 상세 ─── */}
      <section className="flex-1 flex flex-col min-h-0 min-w-0">
        {!selectedSet ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-text-secondary/50 px-6">
            <ChevronRight size={30} className="mb-2 opacity-50" />
            <p className="text-sm">왼쪽에서 세트를 선택하세요.</p>
          </div>
        ) : (
          <>
            <SetDetailHeader
              set={selectedSet}
              items={selectedItems}
              aggregatorName={userNameOf(selectedSet.aggregatorId)}
              episodeLabel={episodeLabelOf(selectedSet.episodeNumber)}
              canManage={canManage}
              onAddItem={() => setShowAdd(true)}
              onImport={() => setShowImport(true)}
              onDelete={handleDeleteSet}
            />

            {/* 자동취합 탭 */}
            <div className="shrink-0 px-5 pt-3 flex items-center gap-1.5 border-b border-bg-border/40">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={[
                    'px-3 py-2 text-[12px] font-semibold rounded-t-lg transition-colors cursor-pointer border-b-2',
                    tab === t.id
                      ? 'text-accent border-accent'
                      : 'text-text-secondary/70 border-transparent hover:text-text-primary',
                  ].join(' ')}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 시안 B 테이블 */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <RetakeHubItemTable
                items={selectedItems}
                tab={tab}
                allUsers={allUsers}
                focusRevisionId={focusedRevisionId}
                focusToken={focusToken}
              />
            </div>
          </>
        )}
      </section>

      {showCreate && (
        <Suspense fallback={null}>
          <RevisionSetCreateModal
            currentUser={currentUser}
            allUsers={allUsers}
            episodes={episodes}
            episodeTitles={episodeTitles}
            onClose={() => setShowCreate(false)}
            onCreated={(id) => {
              setShowCreate(false);
              select(id);
            }}
          />
        </Suspense>
      )}

      {showImport && selectedSet && (
        <Suspense fallback={null}>
          <RevisionImportModal
            targetSet={selectedSet}
            allRevisions={revisions}
            setTitleOf={setTitleOf}
            episodeLabelOf={episodeLabelOf}
            allUsers={allUsers}
            onClose={() => setShowImport(false)}
          />
        </Suspense>
      )}

      {showAdd && selectedSet && (
        <Suspense fallback={null}>
          <RevisionAddModal
            key={selectedSet.id}
            targetSet={selectedSet}
            episodes={episodes}
            episodeTitles={episodeTitles}
            allUsers={allUsers}
            currentUser={currentUser}
            onClose={() => setShowAdd(false)}
          />
        </Suspense>
      )}
    </div>
    </RetakeSceneModalProvider>
  );
}
