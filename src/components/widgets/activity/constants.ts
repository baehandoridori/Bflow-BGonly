import type { ActionGroup, ActionType } from '@/types';

/** action_type → 4그룹 매핑 (필터 칩 분류용) */
export const ACTION_TYPE_TO_GROUP: Record<ActionType, ActionGroup> = {
  stage_lo: 'progress',
  stage_done: 'progress',
  stage_review: 'progress',
  stage_png: 'progress',
  memo_update: 'memo',
  comment_add: 'memo',
  revision_add: 'memo',
  revision_in_progress: 'memo',
  revision_resolve: 'memo',
  revision_delete: 'memo',
  scene_add: 'scene',
  scene_delete: 'scene',
  assignee_change: 'etc',
  layout_change: 'etc',
  image_upload_storyboard: 'etc',
  image_upload_guide: 'etc',
};

/** action_type → 한국어 라벨 */
export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  stage_lo: 'LO 완료',
  stage_done: '완료 진척',
  stage_review: '검수 통과',
  stage_png: 'PNG 마감',
  memo_update: '메모 수정',
  comment_add: '댓글 작성',
  revision_add: '리비전 등록',
  revision_in_progress: '리비전 진행중',
  revision_resolve: '리비전 해결',
  revision_delete: '리비전 삭제',
  scene_add: '씬 추가',
  scene_delete: '씬 삭제',
  assignee_change: '담당자 변경',
  layout_change: '레이아웃 변경',
  image_upload_storyboard: '스토리보드 업로드',
  image_upload_guide: '가이드 업로드',
};

/** action_type → 픽토그램 색 (히트맵 분포 툴팁 + 피드 아이콘 컬러) */
export const ACTION_TYPE_COLOR: Record<ActionType, string> = {
  stage_lo: '#74B9FF',
  stage_done: '#A29BFE',
  stage_review: '#FDCB6E',
  stage_png: '#00B894',
  memo_update: '#FF8FA3',
  comment_add: '#FFA94D',
  revision_add: '#4DD0E1',
  revision_in_progress: '#5EBBC9',
  revision_resolve: '#81ECEC',
  revision_delete: '#FF7675',
  scene_add: '#6FCF97',
  scene_delete: '#FF7675',
  assignee_change: '#95A5A6',
  layout_change: '#95A5A6',
  image_upload_storyboard: '#95A5A6',
  image_upload_guide: '#95A5A6',
};

export const GROUP_LABEL: Record<ActionGroup, string> = {
  progress: '작업 진행',
  memo: '메모/댓글',
  scene: '씬 생성/삭제',
  etc: '기타',
};

export const GROUP_DOT_COLOR: Record<ActionGroup, string> = {
  progress: '#74B9FF',
  memo: '#FF8FA3',
  scene: '#6FCF97',
  etc: '#95A5A6',
};

export const GROUP_WINDOW_MS = 5 * 60 * 1000;
export const PAGE_SIZE = 100;
export const MAX_CACHED = 500;
export const KST_TIMEZONE = 'Asia/Seoul';
