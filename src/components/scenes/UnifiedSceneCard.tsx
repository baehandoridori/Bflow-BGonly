import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { sceneProgress } from '@/utils/calcStats';
import { STAGES, DEPARTMENT_CONFIGS } from '@/types';
import type { MergedScene, Stage, Department } from '@/types';
import { HighlightText } from '@/components/common/HighlightText';
import { Confetti } from '@/components/ui/Confetti';

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
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
  onOpenDetail: (sheetName: string, sceneIndex: number) => void;
  /** 통합 상세 모달 열기 — 전체 뷰에서 BG+ACT 동시 편집 */
  onOpenMerged?: (merged: MergedScene) => void;
  onCelebrationEnd: () => void;
  /** 단순 클릭 — 기본 UX: 이 씬만 선택 (기존 선택 해제) */
  onSelect: () => void;
  /** Ctrl/Cmd + 클릭 — 이 씬 선택 토글 (기존 선택 유지) */
  onCtrlSelect?: () => void;
  /** Shift + 클릭 — 범위 선택 */
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
  onToggle,
  onDelete,
  onOpenDetail,
  onOpenMerged,
  onCelebrationEnd,
  onSelect,
  onCtrlSelect,
  onShiftSelect,
}: UnifiedSceneCardProps) {
  const { sceneId, bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const primaryScene = bgScene ?? actScene;

  const cardRootRef = useRef<HTMLDivElement>(null);
  const prevHighlightedRef = useRef(false);

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

  // 이미지는 BG 전용 — ACT 에 저장된 이미지는 표시하지 않음 (정책 통일)
  const hasImages = !!(bgScene?.storyboardUrl || bgScene?.guideUrl);
  const layoutId = bgScene?.layoutId || actScene?.layoutId;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    // Ctrl/Cmd+클릭 → 토글 (다중 선택 유지), Shift+클릭 → 범위 선택
    // 단순 클릭 → 이 씬만 선택 (기존 선택 모두 해제)
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
    // 통합 모달 콜백이 있으면 우선 사용 — BG/ACT 양쪽을 함께 편집
    if (onOpenMerged) {
      onOpenMerged(merged);
      return;
    }
    // 폴백(단일 부서 모달 호환): BG 우선
    if (bgScene && bgSheetName) {
      onOpenDetail(bgSheetName, bgSceneIndex);
    } else if (actScene && actSheetName) {
      onOpenDetail(actSheetName, actSceneIndex);
    }
  };

  return (
    <motion.div
      data-scene-id={sceneId}
      className={cn(
        'bg-bg-card border border-bg-border rounded-xl flex flex-col group relative cursor-pointer transition-all duration-200',
        'hover:-translate-y-0.5 hover:border-text-secondary/30',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
      )}
      style={{
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        overflow: 'visible',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
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
            {(bgCommentCount + actCommentCount) > 0 && (
              <span className="flex items-center gap-0.5 bg-accent/15 text-accent px-1.5 py-0.5 rounded-full" title={`의견 ${bgCommentCount + actCommentCount}개`}>
                <MessageCircle size={10} fill="currentColor" />
                <span className="text-[10px] font-bold">{bgCommentCount + actCommentCount}</span>
              </span>
            )}
            {/* 퍼센트 뱃지 — 라이트/다크 자동 적응 */}
            <span className="bg-bg-border/60 dark:bg-bg-border text-text-primary px-2.5 py-1 rounded-full text-[12px] font-semibold tabular-nums">
              {combinedPct}%
            </span>
          </div>
        </div>

        {/* ── 이미지 썸네일 (BG 전용) ── */}
        {hasImages && bgScene && (
          <div className="mx-4 mt-0.5 mb-1 flex gap-px rounded-lg overflow-hidden bg-bg-border">
            {bgScene.storyboardUrl && (
              <img src={bgScene.storyboardUrl} alt="SB" className="flex-1 h-20 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            {bgScene.guideUrl && (
              <img src={bgScene.guideUrl} alt="Guide" className="flex-1 h-20 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
          </div>
        )}

        {/* ── 메모 (BG/ACT 각각 있으면 부서 라벨과 함께 둘 다 표시) ── */}
        {(bgScene?.memo || actScene?.memo) && (
          <div className="mx-4 mt-1 flex flex-col gap-0.5" data-no-lasso>
            {bgScene?.memo && (
              <p className="text-[11px] leading-relaxed line-clamp-1 text-amber-400/70">
                {actScene?.memo && (
                  <span className="text-[10px] font-semibold mr-1" style={{ color: DEPARTMENT_CONFIGS.bg.color }}>BG</span>
                )}
                <HighlightText text={bgScene.memo} query={searchQuery} />
              </p>
            )}
            {actScene?.memo && (
              <p className="text-[11px] leading-relaxed line-clamp-1 text-amber-400/70">
                {bgScene?.memo && (
                  <span className="text-[10px] font-semibold mr-1" style={{ color: DEPARTMENT_CONFIGS.acting.color }}>ACT</span>
                )}
                <HighlightText text={actScene.memo} query={searchQuery} />
              </p>
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
          />
        </div>

        {/* ── Confetti ── */}
        <div className="px-4 pb-3 pt-1 relative overflow-visible">
          <Confetti active={celebrating} onComplete={onCelebrationEnd} />
        </div>
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
}: {
  dept: Department;
  scene: import('@/types').Scene | null;
  sceneId: string;
  sheetName: string | null;
  sceneIndex: number;
  searchQuery?: string;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
}) {
  const cfg = DEPARTMENT_CONFIGS[dept];

  if (!scene || !sheetName) {
    return (
      <div className="opacity-30">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
          <span className="text-xs font-semibold text-text-secondary">{cfg.shortLabel}</span>
          <span className="text-[11px] text-text-secondary/50 italic">(미등록)</span>
        </div>
        {/* 진행 단계 컨테이너 — 라이트 모드에서는 살짝 어둡게, 다크 모드에서는 살짝 밝게 */}
        <div className="flex rounded-lg bg-black/[0.06] dark:bg-white/[0.04] p-1 gap-0.5">
          {STAGES.map((stage) => (
            <div key={stage} className="flex-1 text-center py-1.5 text-[11px] font-medium text-text-secondary/30 rounded-md">
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
            className="opacity-0 group-hover:opacity-100 text-[11px] text-text-secondary hover:text-red-400 transition-opacity cursor-pointer"
            title={`${cfg.shortLabel} 씬 삭제`}
          >
            ×
          </button>
        </div>
      </div>
      <div className="flex rounded-lg bg-black/[0.06] dark:bg-white/[0.04] p-1 gap-0.5">
        {STAGES.map((stage, i) => {
          const isDone = scene[stage];
          const isCurrent = isDone && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);

          return (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(sheetName, sceneId, stage); }}
              className={cn(
                'flex-1 text-center py-2 text-[11px] font-medium rounded-md transition-all cursor-pointer',
                !isDone && 'text-text-secondary/60 hover:text-text-primary hover:bg-black/5 dark:hover:bg-white/5',
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
