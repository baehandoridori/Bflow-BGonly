export { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';

// 피드백 48: parseAssigneeNames 는 node-safe 순수 모듈(assigneeNames.ts)로 이동 — 기존 소비처는 이 re-export 로 무변경.
export { parseAssigneeNames } from './assigneeNames.ts';
