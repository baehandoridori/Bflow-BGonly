import type { CostumeDesignStage, CostumeRiggingStage } from '@/types';

export const DESIGN_STAGE_META: Record<CostumeDesignStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  in_progress: { label: '진행 중', color: '#74B9FF' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완료', color: '#A29BFE' },
};

export const RIGGING_STAGE_META: Record<CostumeRiggingStage, { label: string; color: string }> = {
  waiting: { label: '대기', color: '#8B8DA3' },
  vectorized: { label: '벡터화', color: '#74B9FF' },
  rigging: { label: '리깅', color: '#6C5CE7' },
  feedback: { label: '피드백', color: '#FDCB6E' },
  done: { label: '완성', color: '#00B894' },
};

export function parseAssigneeNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
