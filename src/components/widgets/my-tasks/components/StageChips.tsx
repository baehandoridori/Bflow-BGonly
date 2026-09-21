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
import { hasMultiAssigneeProgress } from '@/utils/assigneeProgress';
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
  // 담당자가 둘 이상인 씬의 칩은 '담당자 전원의 공통 진행'이라 개인 체크박스가 아니다.
  // 여기서 누르면 (a) 내 것만 바꿔도 공통 진행이 안 움직여 그대로 되돌아가고,
  // (b) 전원을 맞추면 나보다 앞서간 사람의 기록을 끌어내린다.
  // 그래서 진행 표시로만 두고, 편집은 씬 목록의 담당자별 줄에서 한다(씬 뷰도 같은 규칙).
  const readOnly = hasMultiAssigneeProgress(scene);
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
            whileTap={reduce || readOnly ? undefined : { scale: 0.85 }}
            onClick={(e) => { e.stopPropagation(); if (!readOnly) onToggleStage(stage); }}
            disabled={readOnly}
            title={
              readOnly
                ? `${deptCfg.stageLabels[stage]} · 담당자가 둘 이상인 씬이에요. 씬 목록에서 담당자별로 체크해주세요.`
                : `${deptCfg.stageLabels[stage]}${checked ? ' · 누르면 해제' : ' 표시'}`
            }
            aria-pressed={checked}
            className={cn(
              dim,
              'rounded font-medium flex items-center justify-center transition-all',
              readOnly ? 'cursor-default' : 'cursor-pointer',
              !checked && 'text-text-secondary/40 border border-dashed border-bg-border/60',
              !checked && !readOnly && 'hover:text-text-secondary/80 hover:border-accent/40 hover:bg-bg-border/15',
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
