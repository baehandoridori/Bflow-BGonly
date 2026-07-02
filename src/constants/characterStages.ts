import type { CostumeDesignStage, CostumeRiggingStage } from '@/types';

export interface CharacterStageMeta {
  label: string;
  cssVar: string;
}

export const DESIGN_STAGE_META: Record<CostumeDesignStage, CharacterStageMeta> = {
  waiting: { label: '대기', cssVar: '--char-stage-waiting' },
  in_progress: { label: '진행 중', cssVar: '--char-stage-progress' },
  feedback: { label: '피드백', cssVar: '--char-stage-feedback' },
  done: { label: '완료', cssVar: '--char-stage-done' },
};

export const RIGGING_STAGE_META: Record<CostumeRiggingStage, CharacterStageMeta> = {
  waiting: { label: '대기', cssVar: '--char-stage-waiting' },
  vectorized: { label: '벡터화', cssVar: '--char-stage-progress' },
  rigging: { label: '리깅', cssVar: '--char-stage-rigging' },
  feedback: { label: '피드백', cssVar: '--char-stage-feedback' },
  done: { label: '완성', cssVar: '--char-stage-complete' },
};

export function characterStageColor(meta: CharacterStageMeta, alpha?: number): string {
  return alpha == null ? `rgb(var(${meta.cssVar}))` : `rgb(var(${meta.cssVar}) / ${alpha})`;
}
