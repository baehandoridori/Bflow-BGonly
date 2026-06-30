/**
 * SceneRow — '내 할일' 리스트 모드 씬 행 (PR 4 재설계, EditableSceneRow에서 추출).
 *
 * - 왼쪽 동그라미 없음(씬은 단계 칩이 진행 표시). 2줄: ①EP>파트 + 현재단계 n/4 ②#번호/메모.
 * - 4단계 칩(StageChips) 순차 토글. 본문 클릭 → 상세모달. hover → 본체 이동/제거.
 * - ★forwardRef 불필요(renderRow가 ref 미전달). 단 motion.div layout/exit 는 보존 —
 *   바깥 AnimatePresence(popLayout)와 함께 완료 이동/제거 애니메이션이 깨지지 않게(회귀 방지).
 */
import { motion } from 'framer-motion';
import { ExternalLink, X } from 'lucide-react';
import { EntityText } from '@/components/common/EntityText';
import { navigateToHashTarget } from '@/utils/hashNavigation';
import { useAuthStore } from '@/stores/useAuthStore';
import { DEPARTMENT_CONFIGS } from '@/types';
import type { Stage } from '@/types';
import { cn } from '@/utils/cn';
import type { SceneKey, FlatScene } from '../types';
import { StageChips } from './StageChips';
import { currentStageInfo } from '../stageInfo';

interface SceneRowProps {
  flat: FlatScene;
  deptCfg: typeof DEPARTMENT_CONFIGS['bg'];
  epLabel: string;
  sceneNum: string;
  pct: number;
  isRemovable: boolean;
  onToggle: (flat: FlatScene, stage: Stage) => void;
  onRemove: (key: SceneKey) => void;
  onOpenDetail: (flat: FlatScene) => void;
  onNavigateToMain: (flat: FlatScene) => void;
}

export function SceneRow({
  flat, deptCfg, epLabel, sceneNum, pct, isRemovable,
  onToggle, onRemove, onOpenDetail, onNavigateToMain,
}: SceneRowProps) {
  const s = flat.scene;
  const users = useAuthStore((u) => u.users);
  const info = currentStageInfo(s);
  const stageLabel = info.currentStageKey ? deptCfg.stageLabels[info.currentStageKey] : null;

  return (
    <motion.div
      key={flat.key}
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors group',
        pct >= 100 ? 'bg-green-500/5 opacity-60' : 'hover:bg-bg-border/8',
      )}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          onOpenDetail(flat);
        }}
        onKeyDown={(e) => {
          if ((e.target as HTMLElement).closest('button, a')) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDetail(flat); }
        }}
        className="flex flex-col min-w-0 flex-1 gap-0.5 text-left cursor-pointer rounded px-0.5 -mx-0.5 hover:bg-bg-border/10 transition-colors"
        title="클릭하여 상세 보기/편집"
      >
        {/* 1줄: 컨텍스트(에피소드 > 파트) + 현재단계 n/4 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] text-text-secondary/40 truncate">{epLabel} &gt; {flat.partId}</span>
          {info.doneCount > 0 && (
            <span className="text-[10px] text-text-secondary/45 shrink-0 tabular-nums">· {stageLabel} {info.doneCount}/{info.total}</span>
          )}
        </div>
        {/* 2줄: #번호 + 메모(읽기 전용) */}
        <div className="flex items-center gap-1">
          <span className="text-[12px] font-mono text-accent shrink-0">#{sceneNum}</span>
          <span className="text-[14px] font-semibold text-text-primary truncate">
            {s.memo ? <EntityText text={s.memo} userNames={users.map((u) => u.name)} onHashClick={navigateToHashTarget} /> : s.sceneId}
          </span>
        </div>
      </div>

      <StageChips scene={s} deptCfg={deptCfg} onToggleStage={(stage) => onToggle(flat, stage)} />

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onNavigateToMain(flat); }}
          className="p-1 text-text-secondary/20 hover:text-accent cursor-pointer rounded transition-all"
          title="본체 앱의 씬 상세로 이동"
        >
          <ExternalLink size={12} />
        </button>
        {isRemovable && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(flat.key); }}
            className="p-1 text-red-400/60 hover:text-red-400 hover:bg-red-400/10 rounded cursor-pointer transition-all"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </motion.div>
  );
}
