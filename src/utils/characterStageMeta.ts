export { DESIGN_STAGE_META, RIGGING_STAGE_META, characterStageColor } from '@/constants/characterStages';

export function parseAssigneeNames(value: string | null | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}
