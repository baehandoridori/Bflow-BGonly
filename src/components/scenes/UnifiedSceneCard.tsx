import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/utils/cn';
import { sceneProgress, progressGradient } from '@/utils/calcStats';
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
  onCelebrationEnd: () => void;
  onSelect: () => void;
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
  onCelebrationEnd,
  onSelect,
}: UnifiedSceneCardProps) {
  const { sceneId, bgScene, actScene, bgSceneIndex, actSceneIndex } = merged;
  const primaryScene = bgScene ?? actScene;
  if (!primaryScene) return null;

  const bgPct = bgScene ? sceneProgress(bgScene) : 0;
  const actPct = actScene ? sceneProgress(actScene) : 0;
  const presentCount = (bgScene ? 1 : 0) + (actScene ? 1 : 0);
  const combinedPct = presentCount > 0 ? Math.round((bgPct + actPct) / presentCount) : 0;

  const borderColor = combinedPct >= 100 ? '#5EC4B6' : combinedPct >= 50 ? '#F0B866' : combinedPct > 0 ? '#E17055' : 'rgb(var(--color-bg-border))';

  const hasImages = !!(primaryScene.storyboardUrl || primaryScene.guideUrl);
  const layoutId = bgScene?.layoutId || actScene?.layoutId;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onSelect();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
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
        'bg-bg-card border border-bg-border rounded-lg flex flex-col group relative cursor-pointer hover:border-text-secondary/30 transition-colors',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
      )}
      style={{ borderLeftWidth: 3, borderLeftColor: borderColor, overflow: 'visible' }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
      {...(isHighlighted ? {
        initial: { scale: 1.06 },
        animate: { scale: 1 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      } : {})}
    >
      {isHighlighted && <div className="scene-highlight-bg" />}

      {isSelected && (
        <div className="absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/30">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      )}

      {/* ── 상단: 씬 정보 ── */}
      <div className="px-2.5 pt-2 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs font-mono font-bold text-accent shrink-0">
            #{primaryScene.sceneId ? (primaryScene.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || primaryScene.no) : primaryScene.no}
          </span>
          <span className="text-xs text-text-primary truncate">
            <HighlightText text={primaryScene.sceneId || '(씬번호 없음)'} query={searchQuery} />
          </span>
          {layoutId && (
            <span className="text-[11px] italic text-text-secondary/70 shrink-0">
              - L#{layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {bgCommentCount > 0 && (
            <span className="flex items-center gap-0.5 bg-accent/20 text-accent px-1 py-0.5 rounded-full" title={`BG 의견 ${bgCommentCount}개`}>
              <MessageCircle size={10} fill="currentColor" />
              <span className="text-[10px] font-bold">{bgCommentCount}</span>
            </span>
          )}
          {actCommentCount > 0 && (
            <span className="flex items-center gap-0.5 px-1 py-0.5 rounded-full" style={{ backgroundColor: 'rgba(225,112,85,0.2)', color: '#E17055' }} title={`ACT 의견 ${actCommentCount}개`}>
              <MessageCircle size={10} fill="currentColor" />
              <span className="text-[10px] font-bold">{actCommentCount}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── 담당자 행 ── */}
      <div className="px-2.5 pb-1 flex items-center gap-2 text-[11px]">
        {bgScene && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DEPARTMENT_CONFIGS.bg.color }} />
            <span className="text-text-secondary">BG:</span>
            <span className="text-text-primary truncate max-w-[60px]">
              <HighlightText text={bgScene.assignee || '-'} query={searchQuery} />
            </span>
          </span>
        )}
        {actScene && (
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: DEPARTMENT_CONFIGS.acting.color }} />
            <span className="text-text-secondary">ACT:</span>
            <span className="text-text-primary truncate max-w-[60px]">
              <HighlightText text={actScene.assignee || '-'} query={searchQuery} />
            </span>
          </span>
        )}
      </div>

      {/* ── 이미지 썸네일 ── */}
      {hasImages ? (
        <div className="flex gap-px bg-bg-border overflow-hidden">
          {primaryScene.storyboardUrl && (
            <img src={primaryScene.storyboardUrl} alt="SB" className="flex-1 h-24 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
          {primaryScene.guideUrl && (
            <img src={primaryScene.guideUrl} alt="Guide" className="flex-1 h-24 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* ── 메모 ── */}
      {primaryScene.memo && (
        <div className="px-2.5 py-1 border-t border-bg-border/30">
          <p className="text-[11px] text-amber-400/70 leading-relaxed line-clamp-1">
            <HighlightText text={primaryScene.memo} query={searchQuery} />
          </p>
        </div>
      )}

      {/* ── BG/ACT 부서별 단계 행 ── */}
      <div className="px-1.5 pt-1.5 pb-1 flex flex-col gap-1 mt-auto">
        <DeptStageRow
          dept="bg"
          scene={bgScene}
          sceneId={sceneId}
          sheetName={bgSheetName}
          sceneIndex={bgSceneIndex}
          onToggle={onToggle}
          onDelete={onDelete}
        />
        <DeptStageRow
          dept="acting"
          scene={actScene}
          sceneId={sceneId}
          sheetName={actSheetName}
          sceneIndex={actSceneIndex}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      </div>

      {/* ── 합산 진행률 바 ── */}
      <div className="px-2.5 pb-2">
        <div className="relative h-1.5 bg-bg-primary rounded-full overflow-visible">
          <div
            className="h-full rounded-full transition-all duration-700 ease-out"
            style={{ width: `${combinedPct}%`, background: progressGradient(combinedPct) }}
          />
          <Confetti active={celebrating} onComplete={onCelebrationEnd} />
        </div>
        <div className="flex justify-between mt-0.5">
          {bgScene && <span className="text-[10px] text-text-secondary">BG {Math.round(bgPct)}%</span>}
          <span className="text-[10px] font-bold text-accent ml-auto">{combinedPct}%</span>
          {actScene && <span className="text-[10px] text-text-secondary ml-2">ACT {Math.round(actPct)}%</span>}
        </div>
      </div>
    </motion.div>
  );
}

/* ── 부서별 단계 토글 행 ── */
function DeptStageRow({
  dept,
  scene,
  sceneId,
  sheetName,
  sceneIndex,
  onToggle,
  onDelete,
}: {
  dept: Department;
  scene: import('@/types').Scene | null;
  sceneId: string;
  sheetName: string | null;
  sceneIndex: number;
  onToggle: (sheetName: string, sceneId: string, stage: Stage) => void;
  onDelete: (sheetName: string, sceneIndex: number) => void;
}) {
  const cfg = DEPARTMENT_CONFIGS[dept];

  if (!scene || !sheetName) {
    return (
      <div className="flex items-center gap-1 opacity-30">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
        <span className="text-[10px] text-text-secondary">{cfg.shortLabel}</span>
        <span className="text-[10px] text-text-secondary/50 italic ml-1">(미등록)</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5">
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
      <span className="text-[10px] text-text-secondary font-medium shrink-0">{cfg.shortLabel}</span>
      {STAGES.map((stage) => (
        <button
          key={stage}
          onClick={(e) => { e.stopPropagation(); onToggle(sheetName, sceneId, stage); }}
          className={cn(
            'flex-1 min-w-0 py-0.5 rounded text-[10px] font-medium transition-all text-center whitespace-nowrap overflow-hidden',
            scene[stage]
              ? 'text-bg-primary'
              : 'bg-bg-primary text-text-secondary border border-bg-border hover:border-text-secondary'
          )}
          style={scene[stage] ? { backgroundColor: cfg.stageColors[stage] } : undefined}
          title={cfg.stageLabels[stage]}
        >
          {cfg.stageLabels[stage]}
        </button>
      ))}
      <button
        onClick={(e) => { e.stopPropagation(); onDelete(sheetName, sceneIndex); }}
        className="opacity-0 group-hover:opacity-100 text-[10px] text-status-none hover:text-red-400 transition-opacity ml-0.5"
        title={`${cfg.shortLabel} 씬 삭제`}
      >
        ×
      </button>
    </div>
  );
}
