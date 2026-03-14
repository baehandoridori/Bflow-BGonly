import type { Scene } from '@/types';

/** DB 컬럼명 → Store 필드명 매핑 (Supabase Realtime scenes payload 파싱) */
const SCENE_FIELD_MAP: [string, keyof Scene, 'boolean' | 'string' | 'number'][] = [
  ['lo', 'lo', 'boolean'],
  ['done', 'done', 'boolean'],
  ['review', 'review', 'boolean'],
  ['png', 'png', 'boolean'],
  ['assignee', 'assignee', 'string'],
  ['memo', 'memo', 'string'],
  ['scene_number', 'sceneId', 'string'],
  ['layout', 'layoutId', 'string'],
  ['storyboard_url', 'storyboardUrl', 'string'],
  ['guide_url', 'guideUrl', 'string'],
  ['sort_order', 'no', 'number'],
];

/**
 * Supabase Realtime scenes UPDATE payload에서 변경 필드를 추출하여
 * Store에 직접 적용 가능한 Partial<Scene> 형태로 변환.
 * @returns uuid와 fields. uuid가 없으면 null.
 */
export function extractSceneDelta(
  row: Record<string, unknown>,
): { uuid: string; fields: Partial<Scene> } | null {
  const uuid = row.id;
  if (typeof uuid !== 'string') return null;

  const fields: Partial<Scene> = {};
  for (const [dbCol, storeKey, expectedType] of SCENE_FIELD_MAP) {
    if (typeof row[dbCol] === expectedType) {
      (fields as Record<string, unknown>)[storeKey] = row[dbCol];
    }
  }
  return { uuid, fields };
}
