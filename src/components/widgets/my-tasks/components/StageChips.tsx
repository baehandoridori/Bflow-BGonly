/**
 * StageChips — 씬 4단계(LO/완료/검수/PNG) 칩 트랙. SceneRow/SceneCard 공유.
 *
 * 칩이 진행 표시이자 토글 버튼이다. 클릭 어포던스 강화(검토 반영):
 *  - 미체크 칩: 점선 옅은 테두리 '빈 슬롯' + hover 시 또렷해짐(누를 수 있음 신호)
 *  - 체크 칩: 단계색 채움, 현재(마지막 연속 체크) 칩은 진하게
 *  - title 은 부서별 전체 라벨(ACT=대기/작업중/피드백/완료) + 동작 안내
 * 토글은 stopPropagation 으로 행/카드 본문 클릭(상세모달)과 분리한다.
 */
import { motion } from 'framer-motion';
import { STAGES } from '@/types';
import type { Stage, Scene } from '@/types';
import { DEPARTMENT_CONFIGS } from '@/types';
import { cn } from '@/utils/cn';
import { currentStageInfo } from '../stageInfo';

interface StageChipsProps {
  scene: Scene;
  deptCfg: typeof DEPARTMENT_CONFIGS['bg'];
  onToggleStage: (stage: Stage) => void;
  size?: 'sm' | 'md';
  /** 동작 줄이기 — true면 tap spring 없음 */
  reduce?: boolean;
}

export function StageChips({ scene, deptCfg, onToggleStage, size = 'sm', reduce = false }: StageChipsProps) {
  const dim = size === 'md' ? 'w-7 h-7 text-[12px]' : 'w-6 h-6 text-[11px]';
  // 강조 단계는 currentStageInfo 와 동일 기준으로 단 하나만 — 행/카드의 'n/4' 라벨과 일치하게
  // (비연속 데이터에서 칩 여러 개가 강조되며 라벨과 어긋나던 불일치 제거 + 규칙 일원화).
  const currentKey = currentStageInfo(scene).currentStageKey;
  return (
    <div className="flex bg-bg-primary rounded-md p-0.5 border border-bg-border gap-0.5 shrink-0 w-fit">
      {STAGES.map((stage) => {
        const checked = scene[stage];
        const color = deptCfg.stageColors[stage];
        const isCurrent = checked && stage === currentKey;
        const label = deptCfg.stageLabels[stage][0];
        return (
          <motion.button
            key={stage}
            type="button"
            whileTap={reduce ? undefined : { scale: 0.85 }}
            onClick={(e) => { e.stopPropagation(); onToggleStage(stage); }}
            title={`${deptCfg.stageLabels[stage]}${checked ? ' · 누르면 해제' : ' 표시'}`}
            aria-pressed={checked}
            className={cn(
              dim,
              'rounded font-medium flex items-center justify-center cursor-pointer transition-all',
              !checked && 'text-text-secondary/40 border border-dashed border-bg-border/60 hover:text-text-secondary/80 hover:border-accent/40 hover:bg-bg-border/15',
            )}
            style={
              isCurrent
                ? { backgroundColor: color, color: '#000', fontWeight: 700 }
                : checked
                ? { backgroundColor: `${color}25`, color }
                : undefined
            }
          >
            {label}
          </motion.button>
        );
      })}
    </div>
  );
}
