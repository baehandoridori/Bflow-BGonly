import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MessageCircle, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { sceneProgress } from '@/utils/calcStats';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage, Department } from '@/types';
import { HighlightText } from '@/components/common/HighlightText';
import { PathLinkifiedText } from '@/components/common/PathLinkifiedText';
import { Confetti } from '@/components/ui/Confetti';
import { useBulkOperationsStore, type PendingOp } from '@/stores/useBulkOperationsStore';
import { useDataStore } from '@/stores/useDataStore';
import { LengthIcon } from './LengthIcon';
import { SceneContextMenu } from './SceneContextMenu';

// 씬 UUID에 대한 현재 일괄 작업 상태(pending / failed)를 조회
function getPendingState(
  op: PendingOp | null,
  sceneUuid: string | undefined,
): { kind: 'pending' } | { kind: 'failed'; error: string } | null {
  if (!op || !sceneUuid) return null;
  const failed = op.failedItems.find((f) => f.sceneUuid === sceneUuid);
  if (failed) return { kind: 'failed', error: failed.error };
  if (op.pendingSceneUuids.has(sceneUuid)) return { kind: 'pending' };
  return null;
}

interface UnifiedSceneCardProps {
  merged: MergedScene;
  bgSheetName: string | null;
  actSheetName: string | null;
  celebrating: boolean;
  isHighlighted: boolean;
  isSelected: boolean;
  searchQuery?: string;
  bgCommentCount: number;
  actCommentCount: number;
  /** Codex P2 6차(2026-04-23): 양쪽 sheet 댓글 id 유니온 크기. 제공되면 Math.max fallback 대신 사용. */
  totalCommentCount?: number;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  onOpenMerged?: (merged: MergedScene) => void;
  onCelebrationEnd: () => void;
  onSelect: () => void;
  onCtrlSelect?: () => void;
  onShiftSelect?: () => void;
}

export function UnifiedSceneCard({
  merged,
  bgSheetName,
  actSheetName,
  celebrating,
  isHighlighted,
  isSelected,
  searchQuery,
  bgCommentCount,
  actCommentCount,
  totalCommentCount,
  onToggle,
  onDelete,
  onOpenDetail,
  onOpenMerged,
  onCelebrationEnd,
  onSelect,
  onCtrlSelect,
  onShiftSelect,
}: UnifiedSceneCardProps) {
  const { sceneId, mergedKey, bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const primaryScene = bgScene ?? actScene;

  const cardRootRef = useRef<HTMLDivElement>(null);
  const prevHighlightedRef = useRef(false);

  // 우클릭 컨텍스트 메뉴 상태
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);

  // 길이 변경 토글 (BG/ACT 양쪽 동기화)
  // v1.16.0 fix #1: 직렬 await → Promise.all 병렬로 부분 실패 창 최소화.
  // v1.16.0 fix #2 (Codex 라운드 2): per-card in-flight ref 로 LD↔SD 연타 race 방지.
  // v1.16.0 fix #3 (Codex 라운드 4): Promise.allSettled + per-UUID 부분 롤백.
  // v1.16.0 fix #4 (Codex 라운드 6): per-UUID 부분 롤백이 BG/ACT sync invariant 깸 →
  //                                  표시 로직 (bgScene?.lengthChange ?? actScene?.lengthChange) 가 잘못된 라벨 표시 가능.
  //                                  → 부분 실패 시 BG/ACT 둘 다 prev 로 롤백 (UI sync 보존).
  //                                    성공한 DB 호출은 best-effort reverse 로 정합성 회복 시도.
  const lengthChangeInFlightRef = useRef(false);
  const handleSetLengthChange = async (value: 'LD' | 'SD' | null) => {
    if (lengthChangeInFlightRef.current) return;
    lengthChangeInFlightRef.current = true;
    const valueStr = value ?? '';
    // 변경 전 값 캐싱 (BG/ACT 별도)
    const prevBg = bgScene?.lengthChange ?? null;
    const prevAct = actScene?.lengthChange ?? null;
    // 낙관적
    if (bgScene?.id) useDataStore.getState().updateSceneByUuid(bgScene.id, { lengthChange: value });
    if (actScene?.id) useDataStore.getState().updateSceneByUuid(actScene.id, { lengthChange: value });
    try {
      const targets: Array<{ uuid: string; prev: 'LD' | 'SD' | null }> = [];
      if (bgScene?.id) targets.push({ uuid: bgScene.id, prev: prevBg });
      if (actScene?.id) targets.push({ uuid: actScene.id, prev: prevAct });
      const results = await Promise.allSettled(
        targets.map((t) =>
          window.electronAPI?.supabaseUpdateSceneField?.(t.uuid, 'lengthChange', valueStr) ?? Promise.resolve(),
        ),
      );
      const anyFailed = results.some((r) => r.status === 'rejected');
      if (!anyFailed) return;

      // BG/ACT sync 보존: 둘 다 prev 로 롤백 (UI 차원에서 mergedKey invariant 유지)
      for (const t of targets) {
        useDataStore.getState().updateSceneByUuid(t.uuid, { lengthChange: t.prev });
      }
      // 성공한 DB 호출은 best-effort reverse — DB 도 최대한 sync 되게
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          const t = targets[i];
          const prevStr = t.prev ?? '';
          window.electronAPI?.supabaseUpdateSceneField?.(t.uuid, 'lengthChange', prevStr)
            .catch((err) => console.error(`[lengthChange] reverse 실패 ${t.uuid}`, err));
        } else {
          console.error(`[lengthChange] ${targets[i].uuid} 저장 실패`, result.reason);
        }
      });
    } finally {
      lengthChangeInFlightRef.current = false;
    }
  };

  // 일괄 작업 상태 구독: delete/field-edit일 때 카드 전체, stage-toggle일 때 단계 셀에만 적용
  const activeOp = useBulkOperationsStore((s) => s.activeOp);

  // delete/field-edit 작업 진행 중 → 카드 전체 pending/failed 표시
  const cardWholePendingClass = (() => {
    if (!activeOp || (activeOp.kind !== 'delete' && activeOp.kind !== 'field-edit')) return '';
    const bgState = getPendingState(activeOp, bgScene?.id);
    const actState = getPendingState(activeOp, actScene?.id);
    // failed가 하나라도 있으면 failed 우선 표시
    if (bgState?.kind === 'failed' || actState?.kind === 'failed') return 'bflow-pending-failed';
    if (bgState?.kind === 'pending' || actState?.kind === 'pending') return 'bflow-pending-card';
    return '';
  })();

  useEffect(() => {
    if (isHighlighted && !prevHighlightedRef.current) {
      cardRootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    prevHighlightedRef.current = isHighlighted;
  }, [isHighlighted]);

  if (!primaryScene) return null;

  const bgPct = bgScene ? sceneProgress(bgScene) : 0;
  const actPct = actScene ? sceneProgress(actScene) : 0;
  const presentCount = (bgScene ? 1 : 0) + (actScene ? 1 : 0);
  const combinedPct = presentCount > 0 ? Math.round((bgPct + actPct) / presentCount) : 0;

  const hasImages = !!(bgScene?.storyboardUrl || bgScene?.guideUrl);
  const layoutId = bgScene?.layoutId || actScene?.layoutId;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      (onCtrlSelect ?? onSelect)();
    } else if (e.shiftKey && onShiftSelect) {
      onShiftSelect();
    } else {
      onSelect();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenMerged) {
      onOpenMerged(merged);
      return;
    }
    if (bgScene && bgSheetName) {
      onOpenDetail(bgSheetName, bgSceneIndex);
    } else if (actScene && actSheetName) {
      onOpenDetail(actSheetName, actSceneIndex);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  // BG/ACT 둘 중 하나라도 lengthChange 가 있으면 그 값 (BG 우선, 양쪽 동기화 정책)
  const lengthChange = bgScene?.lengthChange ?? actScene?.lengthChange ?? null;

  return (
    <motion.div
      data-scene-id={mergedKey}
      className={cn(
        'bg-bg-card border border-bg-border rounded-xl flex flex-col group relative cursor-pointer',
        'shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_20px_rgba(0,0,0,0.12)]',
        'hover:shadow-[0_3px_8px_rgba(0,0,0,0.12),0_10px_24px_rgba(0,0,0,0.18)]',
        'scene-card-interactive',
        'hover:-translate-y-0.5 hover:border-accent/70',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
        cardWholePendingClass,
      )}
      style={{
        overflow: 'visible',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      ref={cardRootRef}
      {...(isHighlighted ? {
        initial: { scale: 1.06 },
        animate: { scale: 1 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      } : {})}
    >
        {isHighlighted && <div className="scene-highlight-bg" />}

        {isSelected && (
          <div className="absolute top-2.5 right-2.5 z-20 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/30">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
        )}

        {/* ── 헤더: 씬 ID + 전체 진행률 배지 ── */}
        <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-mono text-text-secondary/50">
              #{sceneId ? (sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || primaryScene.no) : primaryScene.no}
            </span>
            <span className="text-[15px] font-mono font-bold text-text-primary truncate">
              <HighlightText text={sceneId || primaryScene.sceneId || '(씬번호 없음)'} query={searchQuery} />
            </span>
            {layoutId && (
              <span className="text-[11px] italic text-text-secondary/50 shrink-0">
                L#{layoutId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {/* Codex P2 6차(2026-04-23): 정확한 total 은 ScenesView 가 commentIdsByKey 로 계산해
                `totalCommentCount` 로 전달. 없으면 Math.max 로 fallback (대부분 BG·ACT 동일값). */}
            {(() => {
              const displayCount = totalCommentCount ?? Math.max(bgCommentCount, actCommentCount);
              if (displayCount <= 0) return null;
              return (
                <span className="flex items-center gap-0.5 bg-accent/15 text-accent px-1.5 py-0.5 rounded-full" title={`의견 ${displayCount}개`}>
                  <MessageCircle size={10} fill="currentColor" />
                  <span className="text-[10px] font-bold">{displayCount}</span>
                </span>
              );
            })()}
            {lengthChange && (
              <span
                className={`length-symbol ${lengthChange === 'LD' ? 'up' : 'down'}`}
                title={lengthChange === 'LD' ? 'LD · Long Duration (길이 늘어남)' : 'SD · Short Duration (길이 줄어듦)'}
              >
                <LengthIcon kind={lengthChange} />
              </span>
            )}
            <span className="bg-bg-primary/80 border border-bg-border/45 text-text-primary px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums">
              {combinedPct}%
            </span>
          </div>
        </div>

        {/* ── 이미지 썸네일 ── */}
        {hasImages && (
          <div className="mx-4 mt-0.5 mb-1 flex gap-px rounded-lg overflow-hidden bg-bg-border">
        {bgScene?.storyboardUrl && (
          <img src={bgScene.storyboardUrl} alt="SB" className="flex-1 h-20 object-contain bg-bg-card/70 min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
        {bgScene?.guideUrl && (
          <img src={bgScene.guideUrl} alt="Guide" className="flex-1 h-20 object-contain bg-bg-card/70 min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        )}
          </div>
        )}

        {/* ── 메모 (BG/ACT 양쪽 동시 노출 — 한쪽만 있으면 한 줄) ── */}
        {(bgScene?.memo || actScene?.memo) && (
          <div className="mx-4 mt-1 flex flex-col gap-0.5" data-no-lasso>
            {bgScene?.memo && (
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-[9px] font-bold tracking-wide px-1 py-px rounded text-blue-300 bg-blue-300/15 flex-shrink-0">BG</span>
                <p className="text-[11px] text-amber-400/70 leading-relaxed truncate min-w-0">
                  <PathLinkifiedText
                    text={bgScene.memo}
                    renderTextSegment={(seg, idx) => <HighlightText key={idx} text={seg} query={searchQuery} />}
                  />
                </p>
              </div>
            )}
            {actScene?.memo && (
              <div className="flex items-center gap-1.5 overflow-hidden">
                <span className="text-[9px] font-bold tracking-wide px-1 py-px rounded text-pink-300 bg-pink-300/15 flex-shrink-0">ACT</span>
                <p className="text-[11px] text-amber-400/70 leading-relaxed truncate min-w-0">
                  <PathLinkifiedText
                    text={actScene.memo}
                    renderTextSegment={(seg, idx) => <HighlightText key={idx} text={seg} query={searchQuery} />}
                  />
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── BG/ACT 부서 섹션 ── */}
        <div className="px-4 pt-2 flex flex-col gap-2.5 mt-auto">
          <DeptSection
            dept="bg"
            scene={bgScene}
            // 통합 대표 ID는 표시/선택용이고, 실제 토글은 각 부서의 원본 sceneId 로 저장해야 한다.
            sceneId={bgScene?.sceneId ?? sceneId}
            sheetName={bgSheetName}
            sceneIndex={bgSceneIndex}
            searchQuery={searchQuery}
            onToggle={onToggle}
            onDelete={onDelete}
            activeOp={activeOp}
          />
          <DeptSection
            dept="acting"
            scene={actScene}
            sceneId={actScene?.sceneId ?? sceneId}
            sheetName={actSheetName}
            sceneIndex={actSceneIndex}
            searchQuery={searchQuery}
            onToggle={onToggle}
            onDelete={onDelete}
            activeOp={activeOp}
          />
        </div>

        {/* ── Confetti ── */}
        <div className="px-4 pb-3 pt-1 relative overflow-visible">
          <Confetti active={celebrating} onComplete={onCelebrationEnd} />
        </div>

        {/* ── 우클릭 컨텍스트 메뉴 (Portal — motion.div transform 영향 회피) ── */}
        {ctxMenu && createPortal(
          <SceneContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            current={lengthChange}
            onSelect={handleSetLengthChange}
            onClose={() => setCtxMenu(null)}
          />,
          document.body,
        )}
    </motion.div>
  );
}

/* ── 부서별 섹션 (헤더 + 프로세스 트랙) ── */
function DeptSection({
  dept,
  scene,
  sceneId,
  sheetName,
  sceneIndex,
  searchQuery,
  onToggle,
  onDelete,
  activeOp,
}: {
  dept: Department;
  scene: import('@/types').Scene | null;
  sceneId: string;
  sheetName: string | null;
  sceneIndex: number;
  searchQuery?: string;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  activeOp: PendingOp | null;
}) {
  const cfg = DEPARTMENT_CONFIGS[dept];

  // stage-toggle 작업에서 이 씬의 targetStage 셀에만 pending/failed 스타일 적용
  const stageCellPendingClass = (stage: Stage): string => {
    if (!activeOp || activeOp.kind !== 'stage-toggle' || activeOp.targetStage !== stage) return '';
    const state = getPendingState(activeOp, scene?.id);
    if (!state) return '';
    return state.kind === 'pending' ? 'bflow-pending-cell' : 'bflow-pending-failed';
  };

  if (!scene || !sheetName) {
    return (
      <div className="opacity-30">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
          <span className="text-xs font-semibold text-text-secondary">{cfg.shortLabel}</span>
          <span className="text-[11px] text-text-secondary/50 italic">(미등록)</span>
        </div>
        <div className="flex rounded-lg bg-bg-primary/70 border border-bg-border/40 p-1 gap-0.5">
          {STAGES.map((stage) => (
            <div key={stage} className="flex-1 min-w-0 text-center py-1.5 text-[11px] font-medium text-text-secondary/30 rounded-md whitespace-nowrap overflow-hidden text-ellipsis">
              {cfg.stageLabels[stage]}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="group/dept">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
          <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.shortLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary">
            {searchQuery ? <HighlightText text={scene.assignee || '-'} query={searchQuery} /> : (scene.assignee || '-')}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(sheetName, sceneIndex); }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-text-secondary/60 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
            title={`${cfg.shortLabel} 씬 삭제`}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      <div className="flex rounded-lg bg-bg-primary/70 border border-bg-border/40 p-1 gap-0.5">
        {STAGES.map((stage, i) => {
          const isDone = scene[stage];
          const isCurrent = isDone && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);

          return (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(sheetName, sceneId, stage); }}
              className={cn(
                'flex-1 min-w-0 text-center py-2 text-[11px] font-medium rounded-md transition-all cursor-pointer whitespace-nowrap overflow-hidden text-ellipsis',
                !isDone && 'text-text-secondary/60 hover:text-text-primary hover:bg-bg-border/25',
                stageCellPendingClass(stage),
              )}
              style={
                isDone
                  ? isCurrent
                    ? { backgroundColor: cfg.color, color: '#fff', fontWeight: 700, boxShadow: `0 2px 8px ${cfg.color}40` }
                    : { backgroundColor: `${cfg.color}20`, color: cfg.color }
                  : undefined
              }
              title={cfg.stageLabels[stage]}
            >
              {cfg.stageLabels[stage]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
