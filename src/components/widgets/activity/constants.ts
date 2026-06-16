import type { ActionGroup, ActionType } from '@/types';

/** action_type → 4그룹 매핑 (필터 칩 분류용) */
export const ACTION_TYPE_TO_GROUP: Record<ActionType, ActionGroup> = {
  stage_lo: 'progress',
  stage_done: 'progress',
  stage_review: 'progress',
  stage_png: 'progress',
  // v1.25.6: 액팅 단계 토글 — 작업 진행 그룹
  phase_wait: 'progress',
  phase_work: 'progress',
  phase_feedback: 'progress',
  phase_done: 'progress',
  memo_update: 'memo',
  comment_add: 'memo',
  revision_add: 'memo',
  revision_in_progress: 'memo',
  revision_resolve: 'memo',
  revision_delete: 'memo',
  // v1.18.0: 리테이크 댓글 — '메모/댓글' 그룹으로 묶어 일반 comment_add 와 같은 필터에 포함
  revision_comment: 'memo',
  scene_add: 'scene',
  scene_delete: 'scene',
  assignee_change: 'etc',
  layout_change: 'etc',
  image_upload_storyboard: 'etc',
  image_upload_guide: 'etc',
  image_annotate_storyboard: 'memo',
  image_annotate_guide: 'memo',
  // v1.29.0: 댓글 이모지 반응 — 메모/댓글 카테고리
  comment_reaction: 'memo',
};

/** action_type → 한국어 라벨 */
export const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  stage_lo: 'LO 완료',
  stage_done: '완료 진척',
  stage_review: '검수 통과',
  stage_png: 'PNG 마감',
  // v1.25.6: 액팅 단계 라벨 — 사용자가 액팅 씬 토글 클릭 시 표시
  phase_wait: '대기로 변경',
  phase_work: '작업중 시작',
  phase_feedback: '리테이크 대기',
  phase_done: '액팅 완료',
  memo_update: '메모 수정',
  comment_add: '댓글 작성',
  revision_add: '리테이크 등록',
  revision_in_progress: '리테이크 진행중',
  revision_resolve: '리테이크 해결',
  revision_delete: '리테이크 삭제',
  // v1.18.0: 리테이크 댓글
  revision_comment: '리테이크 댓글',
  scene_add: '씬 추가',
  scene_delete: '씬 삭제',
  assignee_change: '담당자 변경',
  layout_change: '레이아웃 변경',
  image_upload_storyboard: '스토리보드 업로드',
  image_upload_guide: '가이드 업로드',
  image_annotate_storyboard: '스토리보드 주석 업데이트',
  image_annotate_guide: '가이드 주석 업데이트',
  // v1.29.0: 댓글 이모지 반응
  comment_reaction: '이모지 반응',
};

/** action_type → 픽토그램 색 (히트맵 분포 툴팁 + 피드 아이콘 컬러) */
export const ACTION_TYPE_COLOR: Record<ActionType, string> = {
  stage_lo: '#74B9FF',
  stage_done: '#A29BFE',
  stage_review: '#FDCB6E',
  stage_png: '#00B894',
  // v1.25.6: 액팅 단계 색 — SCENE_PHASE_COLORS 와 동일 톤
  phase_wait: '#6E7388',
  phase_work: '#74B9FF',
  phase_feedback: '#FDCB6E',
  phase_done: '#00B894',
  memo_update: '#FF8FA3',
  comment_add: '#FFA94D',
  revision_add: '#4DD0E1',
  revision_in_progress: '#5EBBC9',
  revision_resolve: '#81ECEC',
  revision_delete: '#FF7675',
  // v1.18.0: 리테이크 댓글 — 시안~카키 사이로 일반 comment_add 와 시각 구분
  revision_comment: '#A0E7E5',
  scene_add: '#6FCF97',
  scene_delete: '#FF7675',
  assignee_change: '#95A5A6',
  layout_change: '#95A5A6',
  image_upload_storyboard: '#95A5A6',
  image_upload_guide: '#95A5A6',
  image_annotate_storyboard: '#4DD0E1',
  image_annotate_guide: '#4DD0E1',
  // v1.29.0: 댓글 이모지 반응 — 메모/댓글 톤(comment_add #FFA94D, memo_update #FF8FA3) 사이의 부드러운 보라/핑크
  comment_reaction: '#C8A2D8',
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
