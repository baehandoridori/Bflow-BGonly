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
        'bg-bg-card rounded-2xl flex flex-col group relative cursor-pointer transition-all duration-200',
        'hover:-translate-y-0.5',
        isHighlighted && 'scene-highlight',
        isSelected && 'scene-card-selected',
      )}
      style={{
        border: '1px solid #2D2D35',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        overflow: 'visible',
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      ref={isHighlighted ? (el) => el?.scrollIntoView({ behavior: 'smooth', block: 'center' }) : undefined}
      {...(isHighlighted ? {
        initial: { scale: 1.06 },
        animate: { scale: 1 },
        transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
      } : {})}
    >
      {/* 왼쪽 그라데이션 액센트 라인 */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
        style={{ background: `linear-gradient(to bottom, ${DEPARTMENT_CONFIGS.bg.color}, ${DEPARTMENT_CONFIGS.acting.color})` }}
      />

      {isHighlighted && <div className="scene-highlight-bg" />}

      {isSelected && (
        <div className="absolute top-2.5 right-2.5 z-20 w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-sm shadow-accent/30">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
      )}

      {/* ── 헤더: 씬 ID + 전체 진행률 배지 ── */}
      <div className="px-5 pt-4 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-mono font-bold text-text-primary">
            <span className="text-text-secondary/60">#</span>
            {primaryScene.sceneId ? (primaryScene.sceneId.match(/\d+$/)?.[0]?.replace(/^0+/, '') || primaryScene.no) : primaryScene.no}
          </span>
          <span className="text-sm font-semibold text-text-primary truncate">
            <HighlightText text={primaryScene.sceneId || '(씬번호 없음)'} query={searchQuery} />
          </span>
          {layoutId && (
            <span className="text-[11px] italic text-text-secondary/60 shrink-0">
              L#{layoutId}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
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
          <span className="bg-[#282830] text-text-secondary px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap">
            진행률 <span className="text-text-primary">{combinedPct}%</span>
          </span>
        </div>
      </div>

      {/* ── 이미지 썸네일 ── */}
      {hasImages && (
        <div className="mx-5 mt-1 mb-1 flex gap-px rounded-lg overflow-hidden bg-bg-border">
          {primaryScene.storyboardUrl && (
            <img src={primaryScene.storyboardUrl} alt="SB" className="flex-1 h-20 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
          {primaryScene.guideUrl && (
            <img src={primaryScene.guideUrl} alt="Guide" className="flex-1 h-20 object-contain bg-bg-primary min-w-0" draggable={false} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          )}
        </div>
      )}

      {/* ── 메모 ── */}
      {primaryScene.memo && (
        <div className="mx-5 mt-1">
          <p className="text-[11px] text-amber-400/70 leading-relaxed line-clamp-1">
            <HighlightText text={primaryScene.memo} query={searchQuery} />
          </p>
        </div>
      )}

      {/* ── BG 부서 섹션 ── */}
      <div className="px-5 pt-3 flex flex-col gap-3 mt-auto">
        <DeptSection
          dept="bg"
          scene={bgScene}
          sceneId={sceneId}
          sheetName={bgSheetName}
          sceneIndex={bgSceneIndex}
          searchQuery={searchQuery}
          onToggle={onToggle}
          onDelete={onDelete}
        />
        <DeptSection
          dept="acting"
          scene={actScene}
          sceneId={sceneId}
          sheetName={actSheetName}
          sceneIndex={actSceneIndex}
          searchQuery={searchQuery}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      </div>

      {/* ── Confetti ── */}
      <div className="px-5 pb-4 pt-1 relative overflow-visible">
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
        <div className="flex rounded-lg bg-[#282830] p-1 gap-1">
          {STAGES.map((stage) => (
            <div key={stage} className="flex-1 text-center py-1.5 text-[11px] font-medium text-text-secondary/40 rounded-md">
              {cfg.stageLabels[stage]}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 마지막으로 완료된 단계 인덱스 계산 (연속 완료 기준)
  const doneCount = STAGES.filter((s) => scene[s]).length;

  return (
    <div className="group/dept">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cfg.color }} />
          <span className="text-xs font-semibold text-text-secondary">{cfg.shortLabel}</span>
          <span className="text-xs text-text-primary">
            {searchQuery ? <HighlightText text={scene.assignee || '-'} query={searchQuery} /> : (scene.assignee || '-')}
          </span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(sheetName, sceneIndex); }}
          className="opacity-0 group-hover:opacity-100 text-[11px] text-text-secondary hover:text-red-400 transition-opacity"
          title={`${cfg.shortLabel} 씬 삭제`}
        >
          ×
        </button>
      </div>
      <div className="flex rounded-lg bg-[#282830] p-1 gap-1">
        {STAGES.map((stage, i) => {
          const isDone = scene[stage];
          // "current": 완료된 단계 중 가장 마지막 (가장 진행된) 단계
          const isCurrent = isDone && (i === STAGES.length - 1 || !scene[STAGES[i + 1]]);

          return (
            <button
              key={stage}
              onClick={(e) => { e.stopPropagation(); onToggle(sheetName, sceneId, stage); }}
              className={cn(
                'flex-1 text-center py-1.5 text-[11px] font-medium rounded-md transition-all cursor-pointer',
                isDone
                  ? isCurrent
                    ? 'text-white font-semibold'
                    : 'text-opacity-90'
                  : 'text-text-secondary hover:text-text-primary hover:bg-white/5',
              )}
              style={
                isDone
                  ? isCurrent
                    ? { backgroundColor: cfg.color, color: '#fff' }
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
