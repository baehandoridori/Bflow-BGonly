/**
 * 컴포지팅 씬 상세 모달.
 *
 * 한솔 결정 (2026-05-21):
 *   "기존 씬 뷰의 상세 모달을 그대로 가져와서, BG/ACT 단계만 살짝 바꾸고, 컴포지팅 단계를 추가하는 방식."
 *   → 이 컴포넌트는 UnifiedSceneDetailModal 을 그대로 wrapping 한다.
 *     - CardScene → MergedScene 변환 (BG/ACT 페어를 통합 씬 객체로)
 *     - compositingSection prop 으로 부서 패널 위에 "컴포지팅 단계" 섹션 끼움
 *     - onToggle / onFieldUpdate 는 ScenesView 와 동일 패턴 (낙관적 + Supabase) 으로 직접 처리
 *     - onDeleteDept / onDeleteBoth / onAddDept 는 컴포지팅 환경에서 안 씀 (warning)
 *
 * 결과:
 *   - 이미지 클릭/주석/댓글/리테이크/히스토리/메모/담당자 편집 = UnifiedSceneDetailModal 의 모든 기능 그대로
 *   - 추가: 컴포지팅 6 단계 칩 (모달 최상단, isCompositor 일 때만 활성)
 *
 * spec: 2026-05-21-compositing-dashboard-design.md (9.x — layout 은 UnifiedSceneDetailModal 따름)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { cn } from '@/utils/cn';
import type { MergedScene, Scene, Stage, ScenePhaseState, CompositingStatus } from '@/types';
import {
  COMPOSITING_STATUS_LABEL,
  COMPOSITING_STATUS_ORDER,
  COMPOSITING_STATUS_TOKEN,
} from '@/utils/compositingLabels';
import { useDataStore } from '@/stores/useDataStore';
import { useAuthStore } from '@/stores/useAuthStore';
import { useCompositingDashboardStore } from '@/stores/useCompositingDashboardStore';
import { UnifiedSceneDetailModal } from '@/components/scenes/UnifiedSceneDetailModal';
import { updateSceneFieldInSupabase, updateSceneStageInSupabase } from '@/services/supabaseService';
import { resolveReferenceMergedScene } from '@/utils/sceneReference';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import type { HashTarget } from '@/utils/hashEntity';
import { buildCardScenes, flattenCardScenes } from '../cardSceneHelpers';
import { toggleCompositingStatus } from '../compositingActions';

interface CompositingSceneModalProps {
  sceneKey: string;       // `${episodeNumber}:${sceneId}`
  episodeNumber: number;
  isCompositor: boolean;
}

export function CompositingSceneModal({ sceneKey, episodeNumber, isCompositor }: CompositingSceneModalProps) {
  const setDetailScene = useCompositingDashboardStore((s) => s.setDetailScene);
  const compositingStates = useDataStore((s) => s.compositingStates);
  const episodes = useDataStore((s) => s.episodes);
  const episodeTitles = useDataStore((s) => s.episodeTitles);
  const episodeMemos = useDataStore((s) => s.episodeMemos);
  const getEpisodeDisplayName = useDataStore((s) => s.getEpisodeDisplayName);
  const currentUser = useAuthStore((s) => s.currentUser);

  const sceneId = sceneKey.split(':').slice(1).join(':');
  const ep = episodes.find((e) => e.episodeNumber === episodeNumber);

  // 한솔 결정 (2026-05-22): 별도 lookup 제거 — buildCardScenes 가 이미 sheetName/partUuid/sceneIndex 다 저장.
  // 두 lookup 패턴이 어긋나면서 댓글이 가끔 안 불러와지는 문제를 원천 차단.
  const cardCtx = useMemo(() => {
    if (!ep) return null;
    const cards = buildCardScenes(ep);
    const all = flattenCardScenes(cards);
    const card = all.find((s) => s.sceneId === sceneId);
    if (!card) return null;
    return {
      card,
      all,
      bgSheetName: card.bgSheetName ?? null,
      actSheetName: card.actSheetName ?? null,
      bgSceneIndex: card.bgSceneIndex,
      actSceneIndex: card.actSceneIndex,
    };
  }, [ep, sceneId]);

  // prev/next 같은 부분에서 sceneIndex 변경 시 호출.
  const navigate = useCallback((dir: 'prev' | 'next') => {
    if (!cardCtx) return;
    const i = cardCtx.all.findIndex((s) => s.sceneId === cardCtx.card.sceneId);
    if (i < 0) return;
    const next = dir === 'prev' ? i - 1 : i + 1;
    if (next < 0 || next >= cardCtx.all.length) return;
    setDetailScene(`${episodeNumber}:${cardCtx.all[next].sceneId}`);
  }, [cardCtx, episodeNumber, setDetailScene]);

  const close = useCallback(() => setDetailScene(null), [setDetailScene]);

  // 4c v1.43.1 ③: 컴포지팅 씬 모달 안에서 #씬 칩 클릭 → 그 씬 상세를 좌/우 도킹 패널로 연다(편집 가능).
  //   ScenesView 의 검증된 참조 패널 패턴을 그대로 옮긴다.
  //   참조 패널은 자체 시트명(referenceBgSheet/referenceActSheet)으로 편집해, 컴포지팅 카드의 메인 씬을 절대 건드리지 않는다.
  //   컴포지팅 모달엔 sortKey/sortDir 가 없으므로, 후보 정렬에만 영향을 주는 무해한 기본값('no'/'asc')을 쓴다.
  const [referenceMerged, setReferenceMerged] = useState<MergedScene | null>(null);
  const [referenceSide, setReferenceSide] = useState<'left' | 'right'>('right');
  const [referenceBgSheet, setReferenceBgSheet] = useState<string | null>(null);
  const [referenceActSheet, setReferenceActSheet] = useState<string | null>(null);
  const [referencePartId, setReferencePartId] = useState<string>('');
  // 승격("메인으로")은 검증된 점프 경로(navigateToHashTarget)로 보내 컴포지팅을 떠나 전체 통합 모달을 연다.
  const [referenceTarget, setReferenceTarget] = useState<HashTarget | null>(null);
  const clearReference = useCallback(() => {
    setReferenceMerged(null);
    setReferenceBgSheet(null);
    setReferenceActSheet(null);
    setReferencePartId('');
    setReferenceTarget(null);
  }, []);
  const openReference = useCallback((target: HashTarget, side: 'left' | 'right') => {
    if (target.kind !== 'scene') return;
    const r = resolveReferenceMergedScene(target, useDataStore.getState().episodes, 'no', 'asc');
    if (!r) {
      sonnerToast.error(`${target.sceneId} 씬을 찾을 수 없습니다.`);
      return;
    }
    setReferenceMerged(r.merged);
    setReferenceBgSheet(r.bgSheetName);
    setReferenceActSheet(r.actSheetName);
    setReferencePartId(target.partId);
    setReferenceSide(side);
    setReferenceTarget(target);
  }, []);
  // 참조 패널엔 자동 동기화 effect 가 없어, 참조 패널에서 한 편집(낙관적 업데이트)이 패널 UI 에 안 비친다.
  //   episodes 변경 시 referenceTarget 으로 재해석해 referenceMerged/시트명을 갱신한다.
  useEffect(() => {
    if (!referenceTarget) return;
    const r = resolveReferenceMergedScene(referenceTarget, episodes, 'no', 'asc');
    if (r) {
      setReferenceMerged(r.merged);
      setReferenceBgSheet(r.bgSheetName);
      setReferenceActSheet(r.actSheetName);
    } else {
      clearReference(); // 참조 씬이 사라졌으면(삭제 등) 패널 닫기
    }
  }, [episodes, referenceTarget, clearReference]);

  // ── 코덱스 4차 P2 (2026-05-22): 1~6 키보드 핫키로 컴포지팅 단계 변경 ──
  //   - UnifiedSceneDetailModal 로 wrapping 한 뒤 키보드 매핑이 사라져 마우스로만 변경 가능했음.
  //   - 1=배치, 2=취합중, 3=취합완료, 4=보정중, 5=오류, 6=완료 (COMPOSITING_STATUS_ORDER 순).
  //   - INPUT/TEXTAREA/contenteditable 안에 포커스가 있으면 skip (메모/에러노트 편집 보호).
  //   - meta/ctrl/alt 조합도 skip (브라우저/OS 단축키 충돌 방지).
  useEffect(() => {
    if (!cardCtx) return;
    const card = cardCtx.card;
    const onKey = (e: KeyboardEvent) => {
      if (!isCompositor || !currentUser) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (t?.isContentEditable) return;
      const idx = parseInt(e.key, 10);
      if (Number.isNaN(idx) || idx < 1 || idx > COMPOSITING_STATUS_ORDER.length) return;
      const next = COMPOSITING_STATUS_ORDER[idx - 1];
      // 현재 status 와 같으면 noop. store 에서 최신값 직접 읽음 (useEffect closure stale 방지).
      const cur = useDataStore.getState().compositingStates.get(`${episodeNumber}:${card.sceneId}`)?.status ?? 'batch';
      if (next === cur) return;
      e.preventDefault();
      toggleCompositingStatus({
        episodeNumber,
        sceneId: card.sceneId,
        partId: card.partId,
        next,
        currentUserId: currentUser.id,
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardCtx, isCompositor, currentUser, episodeNumber]);

  // ── BG/ACT 단계 토글 — 정상 시트 데이터 변경 (낙관적 + Supabase) ──
  // 코덱스 11차 P1 (2026-05-22): Supabase 실패 시 낙관적 토글을 복원해야 함.
  //   - toggleSceneStage 는 토글이므로 다시 호출하면 이전 값으로 복귀.
  //   - 실패 토스트만 띄우고 store 상태는 잘못된 값으로 남아 사용자가 계속 작업하는 문제 fix.
  const handleToggle = useCallback((sheetName: string, sceneIdArg: string, stage: Stage) => {
    if (!currentUser) return;
    const store = useDataStore.getState();
    store.toggleSceneStage(sheetName, sceneIdArg, stage as 'lo' | 'done' | 'review' | 'png');
    // 새 값 계산 (낙관적 토글 후)
    const ep2 = useDataStore.getState().episodes.find((e) => e.episodeNumber === episodeNumber);
    const part = ep2?.parts.find((p) => p.sheetName === sheetName);
    const sc = part?.scenes.find((s) => s.sceneId === sceneIdArg);
    if (!sc?.id) return;
    const newValue = Boolean(sc[stage as keyof Scene]);
    updateSceneStageInSupabase(sc.id, stage, newValue).catch((err) => {
      // 롤백 — 토글 다시 호출하면 이전 값으로 복귀.
      useDataStore.getState().toggleSceneStage(sheetName, sceneIdArg, stage as 'lo' | 'done' | 'review' | 'png');
      sonnerToast.error(`단계 변경 실패: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, [currentUser, episodeNumber]);

  // ── 필드 업데이트 — 메모 / 담당자 / 이미지 URL 등 ──
  const handleFieldUpdate = useCallback((sheetName: string, sceneIndex: number, field: string, value: string) => {
    if (!currentUser) return;
    const store = useDataStore.getState();
    // 낙관적 — 시트 안 그 sceneIndex 의 field 변경
    const ep2 = store.episodes.find((e) => e.episodeNumber === episodeNumber);
    const part = ep2?.parts.find((p) => p.sheetName === sheetName);
    const sc = part?.scenes[sceneIndex];
    if (!sc) return;
    store.setSceneFieldBySceneId(sheetName, sc.sceneId, field, value);
    if (sc.id) {
      updateSceneFieldInSupabase(sc.id, field, value).catch((err) => {
        sonnerToast.error(`필드 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [currentUser, episodeNumber]);

  // ── 액팅 단계 (대기/작업중/리테이크/완료) — ScenesView 와 동일 패턴 ──
  const handleActPhaseStateClick = useCallback((sheetName: string, sceneIdArg: string, newState: ScenePhaseState) => {
    if (!currentUser) return;
    const store = useDataStore.getState();
    store.setScenePhaseOptimistic(sheetName, sceneIdArg, newState);
    const ep2 = useDataStore.getState().episodes.find((e) => e.episodeNumber === episodeNumber);
    const part = ep2?.parts.find((p) => p.sheetName === sheetName);
    const sc = part?.scenes.find((s) => s.sceneId === sceneIdArg);
    if (sc?.id) {
      window.electronAPI?.supabaseUpdateScenePhase?.(sc.id, newState, sc.workRound ?? 0, sc.feedbackRound ?? 0).catch((err: unknown) => {
        sonnerToast.error(`액팅 단계 변경 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [currentUser, episodeNumber]);

  const handleActRoundBump = useCallback((sheetName: string, sceneIdArg: string, kind: 'work' | 'feedback', delta: 1 | -1) => {
    if (!currentUser) return;
    const store = useDataStore.getState();
    store.bumpScenePhaseRoundOptimistic(sheetName, sceneIdArg, kind, delta);
    const ep2 = useDataStore.getState().episodes.find((e) => e.episodeNumber === episodeNumber);
    const part = ep2?.parts.find((p) => p.sheetName === sheetName);
    const sc = part?.scenes.find((s) => s.sceneId === sceneIdArg);
    if (sc?.id) {
      window.electronAPI?.supabaseUpdateScenePhase?.(sc.id, sc.sceneState ?? 'wait', sc.workRound ?? 0, sc.feedbackRound ?? 0).catch((err: unknown) => {
        sonnerToast.error(`차수 변경 실패: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [currentUser, episodeNumber]);

  // ── 액팅 리테이크 요청 — 컴포지팅 환경에서는 단순 안내 (정식 흐름은 씬 뷰에서) ──
  const handleActFeedbackRequest = useCallback(() => {
    sonnerToast.info('리테이크 요청은 씬 목록 화면에서 진행해주세요.');
  }, []);

  // ── 삭제/부서 추가 — 컴포지팅 환경에서 안 씀 ──
  const handleDeleteDept = useCallback(() => {
    sonnerToast.info('씬 삭제는 씬 목록에서 진행해주세요.');
  }, []);
  const handleDeleteBoth = useCallback(() => {
    sonnerToast.info('씬 삭제는 씬 목록에서 진행해주세요.');
  }, []);
  const handleAddDept = useCallback(() => {
    sonnerToast.info('부서 추가는 씬 목록에서 진행해주세요.');
  }, []);

  if (!cardCtx) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
        onClick={close}
      >
        <div className="bg-bg-card text-text-primary rounded-lg p-6 text-sm">
          씬 정보를 찾을 수 없습니다.
          <button onClick={close} className="ml-3 underline">닫기</button>
        </div>
      </div>
    );
  }

  const { card, all, bgSheetName, actSheetName, bgSceneIndex, actSceneIndex } = cardCtx;
  const currentIdx = all.findIndex((s) => s.sceneId === card.sceneId);

  const merged: MergedScene = {
    sceneId: card.sceneId,
    mergedKey: `${card.partId}:${card.sceneId}`,
    bgScene: card.bg ?? null,
    actScene: card.act ?? null,
    bgSceneIndex,
    actSceneIndex,
  };

  const state = compositingStates.get(sceneKey);
  const status: CompositingStatus = state?.status ?? 'batch';

  const handleChangeStatus = (next: CompositingStatus) => {
    if (!isCompositor || !currentUser) return;
    if (next === status) return;
    toggleCompositingStatus({
      episodeNumber,
      sceneId: card.sceneId,
      partId: card.partId,
      next,
      currentUserId: currentUser.id,
    });
  };

  // 헤더 라벨 (한솔 정정): EP 코드 → 에피소드 제목 + 메모
  const episodeTitle = useMemo(
    () => ep ? getEpisodeDisplayName(ep) : `EP${String(episodeNumber).padStart(2, '0')}`,
    [ep, episodeNumber, getEpisodeDisplayName, episodeTitles],
  );
  const episodeMemo = episodeMemos?.[episodeNumber] || '';

  const compositingSection = (
    <CompositingStageSection
      status={status}
      isCompositor={isCompositor}
      onChange={handleChangeStatus}
    />
  );

  // 4c v1.43.1 ③: 참조 도킹 패널 — 참조 씬 자체의 시트명/파트로 편집(컴포지팅 카드의 메인 씬 절대 미침).
  //   handleToggle/handleFieldUpdate/handleActPhaseStateClick/handleActRoundBump 는 모두 sheetName 으로 라우팅하므로,
  //   referenceBgSheet/referenceActSheet 를 넘기면 참조 씬만 대상으로 동작한다.
  //   삭제/부서추가는 컴포지팅에서 안 쓰는 안내 토스트(handleDelete*/handleAddDept) 라 참조 인스턴스도 그대로 재사용해도 안전.
  //   referencePartId 는 onAddDept 등 파트 컨텍스트가 필요한 경우 대비 보관(현재 컴포지팅은 안내 토스트라 값 자체는 미소비).
  const referencePanelNode = referenceMerged ? (
    <UnifiedSceneDetailModal
      merged={referenceMerged}
      bgSheetName={referenceBgSheet}
      actSheetName={referenceActSheet}
      dockMode={referenceSide}
      referenceSide={referenceSide}
      hasPrev={false}
      hasNext={false}
      onClose={clearReference}
      onSceneReference={openReference}
      onDockToggleSide={(side) => setReferenceSide(side)}
      onDockPromote={() => { if (referenceTarget) navigateToHashTarget(referenceTarget); clearReference(); }}
      onToggle={handleToggle}
      onFieldUpdate={handleFieldUpdate}
      onDeleteDept={handleDeleteDept}
      onDeleteBoth={handleDeleteBoth}
      onAddDept={handleAddDept}
      onActPhaseStateClick={handleActPhaseStateClick}
      onActFeedbackRequest={handleActFeedbackRequest}
      onActRoundBump={handleActRoundBump}
    />
  ) : null;

  return (
    <UnifiedSceneDetailModal
      merged={merged}
      referencePanel={referencePanelNode}
      referenceSide={referenceSide}
      bgSheetName={bgSheetName}
      actSheetName={actSheetName}
      onClose={() => { clearReference(); close(); }}
      onSceneReference={openReference}
      onToggle={handleToggle}
      onFieldUpdate={handleFieldUpdate}
      onDeleteDept={handleDeleteDept}
      onDeleteBoth={handleDeleteBoth}
      onAddDept={handleAddDept}
      onNavigate={navigate}
      hasPrev={currentIdx > 0}
      hasNext={currentIdx >= 0 && currentIdx < all.length - 1}
      currentMergedIndex={currentIdx >= 0 ? currentIdx : 0}
      totalMerged={all.length}
      partLabel={`${card.partId}파트`}
      episodeLabel={episodeMemo ? `${episodeTitle} · ${episodeMemo}` : episodeTitle}
      compositingSection={compositingSection}
      onActPhaseStateClick={handleActPhaseStateClick}
      onActFeedbackRequest={handleActFeedbackRequest}
      onActRoundBump={handleActRoundBump}
    />
  );
}

// ─── 컴포지팅 단계 섹션 — UnifiedSceneDetailModal 의 부서 패널 위에 끼워짐 ───
interface CompositingStageSectionProps {
  status: CompositingStatus;
  isCompositor: boolean;
  onChange: (next: CompositingStatus) => void;
}

function CompositingStageSection({ status, isCompositor, onChange }: CompositingStageSectionProps) {
  const tokenVar = COMPOSITING_STATUS_TOKEN[status];

  return (
    <div
      className="rounded-xl p-3.5 border-2"
      style={{
        borderColor: `color-mix(in srgb, var(${tokenVar}) 45%, transparent)`,
        background: `linear-gradient(180deg, color-mix(in srgb, var(${tokenVar}) 10%, transparent), transparent)`,
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className="flex items-center gap-1.5 text-[11px] font-extrabold tracking-wider"
          style={{ color: `var(${tokenVar})` }}
        >
          <Layers size={12} strokeWidth={2.4} />
          컴포지팅 단계
        </span>
        <span className="text-[10px] text-text-secondary">
          {isCompositor ? '이 화면에서 변경 가능' : '컴포지터만 변경 가능'}
        </span>
        <span
          className="ml-auto text-[10px] font-extrabold px-2 py-0.5 rounded-full text-white"
          style={{
            background: `var(${tokenVar})`,
            boxShadow: `0 0 8px var(${tokenVar})`,
          }}
        >
          ● {COMPOSITING_STATUS_LABEL[status]}
        </span>
      </div>
      <div className={cn('flex flex-wrap gap-1.5', !isCompositor && 'opacity-50 cursor-not-allowed')}>
        {COMPOSITING_STATUS_ORDER.map((st) => {
          const active = status === st;
          const tv = COMPOSITING_STATUS_TOKEN[st];
          return (
            <button
              key={st}
              disabled={!isCompositor}
              onClick={() => onChange(st)}
              className={cn(
                'px-3.5 py-1.5 text-xs font-bold rounded-full transition-all duration-150',
              )}
              style={{
                background: active ? `var(${tv})` : 'transparent',
                color: active ? '#fff' : `var(${tv})`,
                border: `1.5px solid ${active ? `var(${tv})` : `color-mix(in srgb, var(${tv}) 45%, transparent)`}`,
                boxShadow: active ? `0 0 10px var(${tv})` : 'none',
              }}
              title={!isCompositor ? '컴포지터만 단계를 변경할 수 있습니다' : undefined}
            >
              {COMPOSITING_STATUS_LABEL[st]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default CompositingSceneModal;
