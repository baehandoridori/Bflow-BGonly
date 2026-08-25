import type { MarketAdminEventInput, MarketCommand, MarketRemoteState } from '../features/playground/market/types';
import type {
  ArcadeExecuteCommand,
  ArcadeExecuteResult,
  ArcadeSnapshot,
  ArcadeWalletPush,
} from '../features/playground/arcade/types';
import type {
  CalendarApiInputContract,
  CalendarPrivacyMigrationSourceDeleteResult,
} from '../shared/calendarApiContract';

// ─── 부서 (Department) ──────────────────────

export type Department = 'bg' | 'acting';
export type ScenesDeptFilter = Department | 'all';

export const DEPARTMENTS: Department[] = ['bg', 'acting'];

export interface DepartmentConfig {
  id: Department;
  label: string;
  shortLabel: string;
  stageLabels: Record<Stage, string>;
  stageColors: Record<Stage, string>;
  color: string;
}

export const DEPARTMENT_CONFIGS: Record<Department, DepartmentConfig> = {
  bg: {
    id: 'bg',
    label: '배경',
    shortLabel: 'BG',
    stageLabels: { lo: 'LO', done: '완료', review: '검수', png: 'PNG' },
    stageColors: { lo: '#C4BCFA', done: '#A599F5', review: '#8677EF', png: '#6C5CE7' },
    color: '#6C5CE7',
  },
  acting: {
    id: 'acting',
    label: '액팅',
    shortLabel: 'ACT',
    stageLabels: { lo: '대기', done: '작업중', review: '피드백', png: '완료' },
    stageColors: { lo: '#F5BEB3', done: '#EDA293', review: '#E58A76', png: '#E17055' },
    color: '#E17055',
  },
};

// ─── 진행 단계 ──────────────────────────────

export type Stage = 'lo' | 'done' | 'review' | 'png';

export const STAGES: Stage[] = ['lo', 'done', 'review', 'png'];

/** BG 기본 단계 라벨 (부서별 라벨은 DEPARTMENT_CONFIGS[dept].stageLabels) */
export const STAGE_LABELS: Record<Stage, string> = {
  lo: 'LO',
  done: '완료',
  review: '검수',
  png: 'PNG',
};

/** BG 기본 단계 컬러 (부서별 컬러는 DEPARTMENT_CONFIGS[dept].stageColors) */
export const STAGE_COLORS: Record<Stage, string> = {
  lo: '#C4BCFA',
  done: '#A599F5',
  review: '#8677EF',
  png: '#6C5CE7',
};

// ─── 액팅 씬 단계 상태 (v1.25.0~) ────────────
// 한 씬이 한 시점에 가질 수 있는 단일 상태. 차수(round)는 작업중/피드백 대기에서만 표시.
// spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md
export type ScenePhaseState = 'wait' | 'work' | 'feedback' | 'done';

export const SCENE_PHASES: ScenePhaseState[] = ['wait', 'work', 'feedback', 'done'];

export const SCENE_PHASE_LABELS: Record<ScenePhaseState, string> = {
  wait: '대기',
  work: '작업중',
  feedback: '피드백 대기',
  done: '완료',
};

/** v1.25.3~ 칩 안에 표시하는 짧은 라벨 — '피드백 대기'가 좁은 컨테이너에서 wrap 되는 문제 해결.
 *  의미 보존 (피드백을 받기 대기 중 → 피드백). 풀 라벨은 알림 메시지/모달 헤더 등에서 유지. */
export const SCENE_PHASE_LABELS_SHORT: Record<ScenePhaseState, string> = {
  wait: '대기',
  work: '작업중',
  feedback: '피드백',
  done: '완료',
};

export const SCENE_PHASE_COLORS: Record<ScenePhaseState, string> = {
  wait: '#6E7388',
  work: '#74B9FF',
  feedback: '#FDCB6E',
  done: '#00B894',
};

/** 차수 최소/최대 (UI ▴▾ 범위 제한) */
export const SCENE_PHASE_ROUND_MIN = 1;
export const SCENE_PHASE_ROUND_MAX = 99;

export interface SceneAssigneeProgress {
  lo?: boolean;
  done?: boolean;
  review?: boolean;
  png?: boolean;
  sceneState?: ScenePhaseState | null;
  workRound?: number;
  feedbackRound?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export type SceneAssigneeProgressMap = Record<string, SceneAssigneeProgress>;

// ─── 컴포지팅 단계 상태 (v1.30.0~) ──────────
// 씬 단위 1 row. BG/ACT 시트와 무관 — (episode_number, scene_id) 키로 식별.
// spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md

/** 컴포지팅 6 단계 */
export type CompositingStatus =
  | 'batch'       // 배치 (회색) — 작업 대기
  | 'combine'     // 취합중 (파랑) — 합치는 중
  | 'aggregated'  // 취합 완료 (보라/액센트) — 모든 소스 모음
  | 'adjust'      // 보정 중 (노랑) — 컬러/디테일 보정
  | 'error'       // 오류 (주황) — 막힘
  | 'done';       // 완료 (초록)

export const COMPOSITING_STATUSES: CompositingStatus[] = [
  'batch', 'combine', 'aggregated', 'adjust', 'error', 'done',
];

/** 오류 세부 사유 — 5 종 + 기타 (자유 입력) */
export type CompositingErrorKind =
  | 'missing_file'    // 파일 미싱
  | 'fix_blemish'     // 옥에티 수정
  | 'retake'          // 리테이크
  | 'canceled_scene'  // 취소된 씬
  | 'other';          // 기타 (errorNote 자유 입력)

export const COMPOSITING_ERROR_KINDS: CompositingErrorKind[] = [
  'missing_file', 'fix_blemish', 'retake', 'canceled_scene', 'other',
];

/** 한 씬의 컴포지팅 상태. compositing_states 테이블 1 row 와 매핑. */
export interface CompositingState {
  id: string;                               // UUID (Supabase)
  episodeNumber: number;                    // 1, 2, 3, ...
  sceneId: string;                          // 'a001', 'b012', ...
  partId: string;                           // 'A' | 'B' | 'C' | 'D'
  status: CompositingStatus;
  errorKind: CompositingErrorKind | null;   // status='error' 일 때만 의미
  errorNote: string | null;                 // errorKind='other' 자유 입력 (max ~100자)
  progressPercent: number;                  // 0~100. 'combine'/'adjust' 에서 옵션 표시용 (MVP 는 단계만)
  updatedAt: string;                        // ISO 8601
  updatedBy: string | null;                 // app_users.id
}

// ─── 캐릭터 현황판 ────────────────────────────

/** 복장 디자인 단계 (4) */
export type CostumeDesignStage =
  | 'waiting'      // 대기
  | 'in_progress'  // 진행 중
  | 'feedback'     // 피드백
  | 'done';        // 완료

/** 복장 리깅 단계 (5) */
export type CostumeRiggingStage =
  | 'waiting'      // 대기
  | 'vectorized'   // 벡터화
  | 'rigging'      // 리깅
  | 'feedback'     // 피드백
  | 'done';        // 완성

export const COSTUME_DESIGN_STAGES: CostumeDesignStage[] = [
  'waiting', 'in_progress', 'feedback', 'done',
];
export const COSTUME_RIGGING_STAGES: CostumeRiggingStage[] = [
  'waiting', 'vectorized', 'rigging', 'feedback', 'done',
];

/** 전역 캐릭터. characters 테이블 1 row + 연결된 에피소드 번호 목록. */
export interface Character {
  id: string;                  // UUID
  name: string;
  status: 'active' | 'archived';
  memo: string | null;
  /** 캐릭터 기본 작업 폴더. 실제 폴더를 만들거나 복사하지 않고 경로만 저장한다. */
  workFolderPath: string | null;
  /** 캐릭터 키(px, 1280x720 프로젝트 기준) — 이미지 업로드 시 원본 세로 px 자동 설정 + 기준선 드래그 조정(피드백 33). null=미설정. */
  referenceHeightPx: number | null;
  sortOrder: number;
  episodeIds: number[];        // 연결된 episodeNumber 목록 (매핑 테이블 조립)
  createdAt: string;
  updatedAt: string;
}

/** 캐릭터 현황판 사용자 정의 탭의 그룹 1개 — 탭 row 의 groups JSONB 배열 원소 (피드백 41). */
export interface CharacterBoardTabGroup {
  id: string;
  name: string;
  /** 배열 순서 = 그룹 내 카드 표시 순서. */
  characterIds: string[];
}

/** 캐릭터 현황판 사용자 정의 탭 (피드백 41). 그룹 편집은 탭 row 단위 LWW. */
export interface CharacterBoardTab {
  id: string;
  name: string;
  sortOrder: number;
  groups: CharacterBoardTabGroup[];
  createdAt: string;
  updatedAt: string;
}

/**
 * 캐릭터-에피소드 연결 1건. episode_character_mapping 1 row 의 도메인 표현.
 * 보드의 출연 에피소드 토글(episodeIds)과 별개로, 이 편 전용 메모/복장을 보관.
 */
export interface EpisodeCharacterLink {
  episodeNumber: number;
  /** 이 편 주의점 메모. */
  memo: string | null;
  /** 이 편에 쓰는 복장 id 배열(character_costumes.id, 지정 순서 유지). 미선택이면 빈 배열 (피드백 42: 1:N). */
  costumeIds: string[];
}

export type CharacterImageBackground = 'transparent' | 'black' | 'white' | 'checker';

export interface CharacterImageFit {
  /** 1 = 원본 contain 기준. 실제 렌더러에서 clamp 한다. */
  scale: number;
  /** 비율 잠금 해제 시 가로 배율. 없으면 scale 을 쓴다. */
  scaleX?: number;
  /** 비율 잠금 해제 시 세로 배율. 없으면 scale 을 쓴다. */
  scaleY?: number;
  /** 표시 영역 기준 가로 이동 px. */
  x: number;
  /** 표시 영역 기준 세로 이동 px. */
  y: number;
  /** 상세 편집기에서 비율 잠금 여부. */
  lockAspect: boolean;
}

/** 캐릭터 복장 (버전·진행 단위). character_costumes 테이블 1 row. */
export interface CharacterCostume {
  id: string;                  // UUID
  characterId: string;
  name: string;
  versionNo: number;
  designStage: CostumeDesignStage;
  riggingStage: CostumeRiggingStage;
  featuredImageUrl: string | null;
  /** 이 복장에 연결된 작업 파일(.moho 등). */
  workFilePath: string | null;
  /** 투명 PNG 표시용 배경. */
  imageBackground: CharacterImageBackground;
  /** 썸네일/대표 이미지 표시 변환값. 원본 이미지는 수정하지 않는다. */
  imageFit: CharacterImageFit;
  structureTags: string[];
  assetTags: string[];
  designAssignee: string | null;
  riggingAssignee: string | null;
  assignee: string | null;
  memo: string | null;
  /** 복장 작업 마감일(YYYY-MM-DD). null=일정 미설정. (T2-4) */
  dueDate: string | null;
  /** 복장별 키 오버라이드(px). null = 캐릭터 대표 키를 따름 (피드백 47). */
  heightPx: number | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 복장 이미지 역할 — 한 복장이 여러 이미지를 가질 때 용도 구분. */
export type CostumeImageRole =
  | 'design'   // 디자인 시안
  | 'final'    // 최종본
  | 'variant'; // 변형/파생

export const COSTUME_IMAGE_ROLES: CostumeImageRole[] = ['design', 'final', 'variant'];

/**
 * 복장이 갖는 개별 이미지 (다중 이미지 모델). character_costume_images 테이블 1 row.
 * primary 이미지의 값(url/배경/맞춤)은 앱(store)이 character_costumes.featured_* 로 반영해
 * 기존 단일 이미지 소비처(카드/썸네일/라이트박스/에피소드에셋/나의할일)를 무변경 유지한다.
 */
export interface CharacterCostumeImage {
  id: string;                  // UUID
  costumeId: string;
  url: string;
  role: CostumeImageRole;
  label: string | null;
  /** 투명 PNG 표시용 배경. */
  imageBackground: CharacterImageBackground;
  /** 썸네일/대표 이미지 표시 변환값. 원본 이미지는 수정하지 않는다. */
  imageFit: CharacterImageFit;
  /** 업로드 원본 크기(px, 리사이즈 전). 과거 업로드/측정 실패는 null — 기준 키 환산 폴백 처리. (피드백 33) */
  naturalWidth: number | null;
  naturalHeight: number | null;
  /** 이 복장의 대표 이미지 여부. costume 당 최대 1개(부분 유니크). */
  isPrimary: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 복장 단계 변경을 활동 피드에 기록할 때 렌더러 → 메인으로 넘기는 표시용 컨텍스트.
 * "누가" 변경했는지(신원)는 메인의 세션 사용자에서 가져오므로 여기에 담지 않는다.
 * 단계 변경(디자인/리깅)이 아닐 때는 미전달 → 활동 기록 생략.
 */
export interface CostumeActivityLogContext {
  characterId: string;
  characterName: string;
  costumeName: string;
  kind: 'design' | 'rigging';
  /** 변경된 후의 단계 값 (CostumeDesignStage | CostumeRiggingStage) */
  stage: string;
  /** 사람이 읽는 단계 이름 (예: '리깅', '완성') */
  stageLabel: string;
}

/**
 * characters 테이블 DB row (snake_case) — IPC/realtime 경계 표현.
 * electron/supabase.ts 의 CharacterRow 와 중복 정의 (electron ↔ src 는 서로 import 하지 않는 관행).
 * 값 수준 보정(null/기본값 fallback)은 rowToCharacter 가 담당하므로 미보장 필드는 null 허용으로 선언.
 */
export interface CharacterRow {
  id: string;
  name: string;
  status: 'active' | 'archived' | null;
  memo: string | null;
  work_folder_path: string | null;
  reference_height_px?: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

/** character_board_tabs DB row (피드백 41). */
export interface CharacterBoardTabRow {
  id: string;
  name: string;
  sort_order: number | null;
  groups: unknown;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

/**
 * character_costumes 테이블 DB row (snake_case) — IPC/realtime 경계 표현.
 * electron/supabase.ts 의 CharacterCostumeRow 와 중복 정의 (경계 양쪽 중복 정의 관행).
 * JSONB/배열 컬럼은 값을 신뢰할 수 없어 unknown — rowToCostume 의 normalize/Array.isArray 가드가 정규화.
 */
export interface CharacterCostumeRow {
  id: string;
  character_id: string;
  name: string;
  version_no: number | null;
  design_stage: CostumeDesignStage | null;
  rigging_stage: CostumeRiggingStage | null;
  featured_image_url: string | null;
  work_file_path: string | null;
  /** 4값 CHECK 컬럼이지만 구버전/이상값 호환 — normalizeCharacterImageBackground 가 정규화. */
  image_background: unknown;
  /** JSONB — normalizeCharacterImageFit 가 정규화. */
  image_fit: unknown;
  structure_tags: unknown;
  asset_tags: unknown;
  /** 구버전 스키마엔 없던 컬럼 — 부재 시 rowToCostume 이 assignee 로 fallback. */
  design_assignee?: string | null;
  rigging_assignee?: string | null;
  assignee: string | null;
  memo: string | null;
  due_date?: string | null;
  height_px?: number | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

/**
 * character_costume_images 테이블 DB row (snake_case) — IPC/realtime 경계 표현.
 * electron/supabase.ts 의 CharacterCostumeImageRow 와 중복 정의 (경계 양쪽 중복 정의 관행).
 * JSONB/CHECK 컬럼은 값을 신뢰할 수 없어 unknown — rowToCostumeImage 의 normalize 가드가 정규화.
 */
export interface CharacterCostumeImageRow {
  id: string;
  costume_id: string;
  url: string;
  role: CostumeImageRole | null;
  label: string | null;
  /** 4값 CHECK 컬럼이지만 구버전/이상값 호환 — normalizeCharacterImageBackground 가 정규화. */
  image_background: unknown;
  /** JSONB — normalizeCharacterImageFit 가 정규화. */
  image_fit: unknown;
  natural_width?: number | null;
  natural_height?: number | null;
  is_primary: boolean | null;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
}

// ─── 씬 ──────────────────────────────────────

export type SceneWorkLinkDepartment = 'bg' | 'acting';
export type SceneWorkLinkKind = 'folder' | 'primary_file' | 'extra_file';

export interface SceneWorkLink {
  id: string;
  sceneUuid: string;
  department: SceneWorkLinkDepartment;
  linkKind: SceneWorkLinkKind;
  path: string;
  label: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedBy: string | null;
  updatedAt: string;
}

// ─── 실시간 편집 프레즌스 (main ↔ renderer 경계 공유 타입) ───
// electron/presence/types.ts 와 구조적으로 동일하게 유지 (IPC는 평문 JSON).
export interface EditingUser { userId: string; username: string; }
/** uuid(씬 sceneUuid·복장 costumeUuid 등) -> 그 파일을 편집 중인 사용자들 */
export type EditingPresenceSnapshot = Record<string, EditingUser[]>;
/** 파일 열림 감지 대상 종류 — renderer 소비 지점(훅 kind 인자)용 (피드백 54). */
export type PresenceKind = 'scene' | 'costume';
/** main → renderer 프레즌스 IPC payload — kind별 스냅샷 묶음 (피드백 54). */
export type PresenceSnapshotBundle = Record<string, EditingPresenceSnapshot>;

export interface Scene {
  id?: string;   // Supabase UUID (Sheets 모드에서는 undefined)
  no: number;
  sceneId: string;
  memo: string;
  storyboardUrl: string;
  guideUrl: string;
  assignee: string;
  layoutId: string;
  lo: boolean;
  done: boolean;
  review: boolean;
  png: boolean;
  completedBy?: string;  // 모든 단계 완료한 사용자 이름
  completedAt?: string;  // 완료 시각 (ISO 8601)
  /**
   * 씬 길이 변경 시각 라벨 (수동 토글, 영구 라벨 — 사용자가 해제 전까지 유지).
   * - 'LD' = Long Duration (길이 늘어남, <-> SVG 라벨)
   * - 'SD' = Short Duration (길이 줄어듦, >-< SVG 라벨)
   * - null/undefined = 표시 없음
   * 카드/시트 우클릭 메뉴로 토글.
   */
  lengthChange?: 'LD' | 'SD' | null;
  /** 씬 row 등록 시각 (ISO 8601). Supabase scenes.created_at — 2026-05-02 추가 */
  createdAt?: string;
  /** 씬 row 마지막 갱신 시각 (ISO 8601). 단계 토글/필드 변경 시 자동 갱신 */
  updatedAt?: string;
  /**
   * v1.25.0~: 액팅 씬 단계 상태 (대기/작업중/피드백 대기/완료).
   * BG 씬은 NULL 유지 (기존 lo/done/review/png 사용).
   * spec: docs/superpowers/specs/2026-05-11-acting-phase-toggle-design.md
   */
  sceneState?: ScenePhaseState | null;
  /** 작업중 라운드 번호 (1~99). state !== 'work' 일 때 0 또는 마지막 값 유지 */
  workRound?: number;
  /** 피드백 대기 라운드 번호 (1~99). state !== 'feedback' 일 때 0 또는 마지막 값 유지 */
  feedbackRound?: number;
  /**
   * 2인 이상 담당 씬의 사람별 진행 상태.
   * 기존 scenes 테이블 컬럼을 깨지 않기 위해 Supabase metadata(type='scene-assignee-progress')에서 로드한다.
   */
  assigneeProgress?: SceneAssigneeProgressMap;
  /**
   * v1.30.0~: 씬 길이 (24fps 기준 프레임 단위, 정수).
   * 컴포지팅 대시보드의 AE 타임라인 패널이 진짜 시간축으로 작동하려면 필요.
   * MVP 에는 입력 UI 없음 — 데이터 비어있으면 AE 패널은 "씬 인덱스" fallback.
   * 후속 spec: docs/superpowers/specs/2026-05-21-premiere-clip-length-import-design.md
   * (프리미어 V1 트랙 파싱 → 자동 추출 + 수동 수정)
   */
  durationFrames?: number | null;
}

// ─── 통합 씬 (BG + ACT 머지) ─────────────────

export interface MergedScene {
  sceneId: string;         // 통합 뷰 대표 씬번호 (예: a001)
  mergedKey: string;       // 통합 뷰 내부 고유 키 (예: a|bg:ac001|act:a001)
  bgScene: Scene | null;
  actScene: Scene | null;
  bgSceneIndex: number;   // bgPart.scenes 내 인덱스 (-1 if absent)
  actSceneIndex: number;   // actPart.scenes 내 인덱스 (-1 if absent)
}

// ─── 컴포지팅 리테이크 ─────────────────────────

export type RevisionStatus = 'open' | 'in_progress' | 'assignee_done' | 'resolved';
export type RevisionPriority = 'urgent' | 'high' | 'normal';

export type AssigneeState = 'pending' | 'in_progress' | 'done';

export interface RevisionAssigneeState {
  state: AssigneeState;
  note?: string;        // 담당자 완료 멘트(파일경로 등)
  startedAt?: string;   // ISO 8601
  doneAt?: string;      // ISO 8601
  completionNotifyUserIds?: string[]; // 담당 완료 알림 선택 대상(realtime fallback용)
  completedByName?: string; // 담당 완료자 표시명(realtime fallback용)
}

export interface CompRevision {
  id: string;
  sceneKey: string;        // "EP01:A:1" (에피소드:파트:정규화된 씬번호)
  revisionNo: number;      // 씬별 자동 증가 (Rev.1, Rev.2, ...)
  status: RevisionStatus;
  priority: RevisionPriority;
  description: string;
  frameNo?: string;        // 프레임 번호 (예: "F024")
  imageUrl?: string;
  department?: 'bg' | 'acting';
  requesterId: string;
  requesterName: string;
  assignee?: string;
  resolvedBy?: string;
  resolvedNote?: string;
  createdAt: string;       // ISO 8601
  updatedAt: string;
  resolvedAt?: string;
  /**
   * v1.18.0: 알림 받을 사람 user.id 배열.
   * 등록 시 폼에서 멘션한 사람들 + 등록자 본인. 댓글/상태 변경 시 이 목록에 알림 전송.
   * 옵셔널 — 사용처에서 `?? []`로 가드. 레거시 데이터/생성 경로 호환.
   */
  notifyUserIds?: string[];
  /** 담당자 user.id 배열 (반드시 notifyUserIds의 부분집합). */
  assigneeIds?: string[];
  /** 담당자별 상태 맵 { [userId]: { state, note?, startedAt?, doneAt? } }. */
  assigneeStates?: Record<string, RevisionAssigneeState>;
  /** 소속 리테이크 세트 id (없으면 일반 리테이크). */
  setId?: string | null;
  /** 최종 완료자 이름. */
  finalResolvedBy?: string;
  /** 최종 완료 시각 ISO 8601. */
  finalResolvedAt?: string;
}

export interface CompRevisionSet {
  id: string;
  title: string;
  episodeNumber?: number | null;
  department?: 'bg' | 'acting' | null;
  aggregatorId?: string | null;
  status: 'open' | 'done';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 사용자 & 인증 ─────────────────────────

export interface AppUser {
  id: string;          // UUID
  name: string;
  slackId: string;
  isInitialPassword: boolean;
  createdAt: string;   // ISO 8601
  hireDate?: string;   // Phase 0-4: 입사일 (YYYY-MM-DD)
  birthday?: string;   // Phase 0-4: 생일 (MM-DD)
  role?: string;       // Phase 0-4: 역할 (admin | user)
  /**
   * v1.18.1: 컴포지터 단일 boolean (BG/ACT 부서 구분 없음).
   * 한솔 정정: 컴포지터는 부서로 나뉘지 않음 — 리테이크 등록 시 모든 컴포지터가 자동 알림 대상.
   */
  isCompositor?: boolean;
  /**
   * v1.25.0~: 액팅 검수자(애니메이팅 수퍼바이저) 플래그.
   * 컴포지터와 독립적 — 동시 겸임 가능. 액팅 씬에서 "피드백 대기" 누를 때 알림 받음.
   */
  isActingSupervisor?: boolean;
}

export interface UsersFile {
  users: AppUser[];
}

export interface PublicUserDirectory {
  status: 'authoritative' | 'fallback' | 'remote-unavailable';
  users: AppUser[];
}

export interface AuthSession {
  userId: string;
  userName: string;
  loggedInAt: string;  // ISO 8601
}

export type CanonicalSessionUser = AppUser;
export interface CanonicalSessionPayload {
  user: CanonicalSessionUser | null;
  session: AuthSession | null;
  epoch: number;
}
export interface CanonicalSessionResult {
  ok: boolean;
  payload: CanonicalSessionPayload;
  error?: string;
}

export type MainPersonalTodoStatus = 'todo' | 'doing' | 'done';
export type MainPersonalTodoPriority = 'high' | 'medium' | 'low' | 'none';
export type MainPersonalTodoLabelColorKey = 'violet' | 'blue' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'gray';
export interface MainPersonalTodo {
  id: string; userId: string; title: string; memo: string; status: MainPersonalTodoStatus;
  completed: boolean; priority: MainPersonalTodoPriority; pinned: boolean; labelIds: string[];
  startDate: string | null; endDate: string | null; addToCalendar: boolean; sortOrder: number;
  createdAt: string; updatedAt: string;
}
export interface MainPersonalTodoLabel {
  id: string; name: string; colorKey: MainPersonalTodoLabelColorKey; createdAt: string; updatedAt: string;
}
export interface MainPersonalTodoPatch {
  title?: string; memo?: string; startDate?: string | null; endDate?: string | null;
  addToCalendar?: boolean; priority?: MainPersonalTodoPriority; labelIds?: string[]; status?: MainPersonalTodoStatus;
}
export type MainPersonalTodoCreateInput = Pick<MainPersonalTodo, 'id' | 'title'> & Partial<Pick<MainPersonalTodo,
  'memo' | 'status' | 'priority' | 'pinned' | 'labelIds' | 'startDate' | 'endDate' | 'addToCalendar'>>;
export type MainCalendarTodoPatch = Pick<MainPersonalTodoPatch, 'title' | 'memo' | 'startDate' | 'endDate' | 'addToCalendar'>;
export type MainPersonalTodoFailureKind = 'rejected' | 'unknown' | 'stale' | 'quitting';
export type MainPersonalTodoResult<T> = { ok: true; data: T } | {
  ok: false; kind: MainPersonalTodoFailureKind; code: string; message: string; retryable: boolean;
};

// ─── 댓글 이모지 리액션 (v1.26.0+) ──────────

export interface CommentReaction {
  id: string;
  commentId: string;
  userId: string;
  userName: string;
  emoji: string;
  createdAt: string;       // ISO 8601
}

/** 한 댓글의 같은 이모지를 누른 사용자들 — UI 렌더용 집계 형태 */
export interface CommentReactionGroup {
  emoji: string;
  count: number;
  userIds: string[];
  userNames: string[];
  mine: boolean;           // 본인이 누른 이모지인지
}

export interface CommentReadStateRow {
  userId: string;
  sceneThreadKey: string;
  lastReadAt: string;
  updatedAt: string;
}

// ─── 이미지 버전 (v1.26.0+) ─────────────────

export type ImageType = 'storyboard' | 'guide';
export type ImageVersionKind = 'replace' | 'annotate';

export interface ImageVersion {
  id: string;
  sceneId: string;
  imageType: ImageType;
  versionNo: number;
  url: string;
  kind: ImageVersionKind;
  baseVersionNo: number | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;       // ISO 8601
  /** v1.26.2+: 주석 버전 등에 첨부된 텍스트 메모 (선택) */
  description?: string | null;
}

// ─── 파트 & 에피소드 ─────────────────────────

export interface Part {
  id?: string;    // Supabase UUID (Sheets 모드에서는 undefined)
  partId: string; // 'A', 'B', 'C', 'D'
  department: Department; // 'bg' | 'acting'
  sheetName: string; // 'EP01_A_BG' or 'EP01_A' (legacy = bg)
  scenes: Scene[];
}

export interface Episode {
  episodeNumber: number;
  title: string; // 'EP.01'
  /** 에피소드 릴 파일 경로. 없으면 null. */
  reelFilePath?: string | null;
  parts: Part[];
}

// ─── 담당자 ──────────────────────────────────

export interface Assignee {
  name: string;
  role: string;
  color: string;
}

// ─── 위젯 레이아웃 ───────────────────────────

export interface WidgetLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  visible?: boolean;
}

// ─── 차트 타입 ──────────────────────────────

export type ChartType = 'horizontal-bar' | 'vertical-bar' | 'donut' | 'stat-card';

// ─── 에피소드 상세 통계 ─────────────────────

export interface PartDetailStatsEntry {
  partId: string;
  bgPct: number;
  actPct: number;
  combinedPct: number;
  bgScenes: number;
  actScenes: number;
  bgStages: { stage: Stage; label: string; color: string; done: number; total: number; pct: number }[];
  actStages: { stage: Stage; label: string; color: string; done: number; total: number; pct: number }[];
}

export interface EpisodeDetailStats {
  episodeNumber: number;
  overallPct: number;
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  perDept: Record<Department, { overallPct: number; totalScenes: number; stageStats: StageStats[] }>;
  perPart: PartDetailStatsEntry[];
  perAssignee: AssigneeStats[];
  perDeptAssignee: Record<Department, AssigneeStats[]>;
}

// ─── 통계 ────────────────────────────────────

export interface StageStats {
  stage: Stage;
  label: string;
  done: number;
  total: number;
  pct: number;
}

export interface AssigneeStats {
  name: string;
  totalScenes: number;
  completedScenes: number;
  pct: number;
}

export interface EpisodePartStats {
  part: string;
  department: Department;
  pct: number;
  totalScenes: number;
}

export interface EpisodeStats {
  episodeNumber: number;
  title: string;
  parts: EpisodePartStats[];
  overallPct: number;
}

export interface DashboardStats {
  overallPct: number;
  totalScenes: number;
  fullyDone: number;
  notStarted: number;
  stageStats: StageStats[];
  assigneeStats: AssigneeStats[];
  episodeStats: EpisodeStats[];
}

// ─── _REGISTRY 타입 (Phase 0-2) ──────────────

export interface RegistryEntry {
  sheetName: string;
  episodeNumber: number;
  partId: string;
  department: string;
  status: 'active' | 'archived' | 'deleted';
  title: string;
  archivedAt: string;
  archivedBy: string;
  archiveMemo: string;
  updatedAt: string;
}

// ─── 동기화 델타 (창 간 IPC 페이로드) ────────

export interface SheetDeltaToggle {
  type: 'toggle';
  sheetName: string;
  sceneId: string;
  field: Stage;
  value: boolean;
}
export interface SheetDeltaFieldUpdate {
  type: 'field-update';
  sheetName: string;
  sceneId: string;
  sceneIndex: number;
  field: string;
  value: string;
}
export interface SheetDeltaComment {
  type: 'comment';
  sheetName: string;
  sceneId: string;
  commentAction: 'add' | 'edit' | 'delete';
}
export interface SheetDeltaSnapshot {
  type: 'snapshot';
}
export interface SheetDeltaFull {
  type: 'full';
}
export interface SheetDeltaTodo {
  type: 'todo';
}
export type SheetDelta =
  | SheetDeltaToggle
  | SheetDeltaFieldUpdate
  | SheetDeltaComment
  | SheetDeltaSnapshot
  | SheetDeltaFull
  | SheetDeltaTodo;

export interface SnapshotRelayData {
  episodes: Episode[];
  episodeTitles: Record<number, string>;
  episodeMemos: Record<number, string>;
}

// ─── 메타데이터 항목 ────────────────────────

export interface MetadataEntry {
  type: string;
  key: string;
  value: string;
  updatedAt: string;
}

// ─── Google Sheets 연동 타입 ─────────────────

export interface SheetsConnectResult {
  ok: boolean;
  error: string | null;
}

export interface SheetsReadResult {
  ok: boolean;
  data: Episode[] | null;
  error?: string;
}

export interface SheetsUpdateResult {
  ok: boolean;
  error?: string;
}

export interface SheetsConfig {
  webAppUrl: string;
}

// ─── 일괄 작업 (bulk operations) ────────────

export type BulkStageUpdate = {
  sceneUuid: string;
  stage: Stage;
  value: boolean;
  /**
   * 완료 메타 시맨틱:
   * - `undefined`: 메타 건드리지 않음
   * - `null`: metadata 행을 삭제 (완료 해제)
   * - `string`: UPSERT (완료 설정)
   */
  completedBy?: string | null;
  completedAt?: string | null;
};

export type BulkFieldUpdate = {
  sceneUuid: string;
  fields: {
    assignee?: string;
    memo?: string;
    layoutId?: string;
    storyboardUrl?: string;
    guideUrl?: string;
  };
};

export type BulkUpdateResult = {
  sceneUuid: string;
  success: boolean;
  error?: string;
};

// ─── 활동 기록 (activity_log) ───────────────

export type ActionGroup = 'progress' | 'memo' | 'scene' | 'etc';
export type ActionType =
  | 'stage_lo' | 'stage_done' | 'stage_review' | 'stage_png'
  // v1.25.0~: 액팅 씬 단계 토글 — 작업 진행 그룹과 동일
  | 'phase_wait' | 'phase_work' | 'phase_feedback' | 'phase_done'
  | 'memo_update' | 'comment_add'
  | 'revision_add' | 'revision_in_progress' | 'revision_resolve' | 'revision_delete'
  // 리테이크 허브 1단계: 담당자 본인 완료 / 최종 완료 / 재배정
  | 'revision_assignee_done' | 'revision_final_resolve' | 'revision_reassign'
  // v1.18.0: 리테이크 맥락 댓글 — 일반 comment_add 와 분리해 활동 피드에서 별도 표시
  | 'revision_comment'
  | 'scene_add' | 'scene_delete'
  | 'assignee_change' | 'layout_change'
  | 'image_upload_storyboard' | 'image_upload_guide'
  | 'image_annotate_storyboard' | 'image_annotate_guide'
  // v1.29.0: 댓글 이모지 반응 — 메모/댓글 그룹에 포함, detail.commentId / detail.emoji 보관
  | 'comment_reaction'
  // 캐릭터 현황판: 복장 디자인/리깅 단계 변경 — 작업 진행 그룹.
  //   character_rigging_done 은 리깅이 '완성'으로 전이될 때만 기록해 피드에서 강조.
  //   detail: { characterId, costumeId, kind, stage, stageLabel, characterName, costumeName, completed? }
  | 'character_design_stage' | 'character_rigging_stage' | 'character_rigging_done';

export interface Activity {
  id: string;
  userId: string;
  userName: string;
  actionType: ActionType;
  actionGroup: ActionGroup;
  sceneId: string | null;
  sceneLabel: string | null;
  episodeNumber: number | null;
  department: 'bg' | 'acting' | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

// ─── v1.23.0: 시간 단위 + 분석 모달 ─────────────

/** 최근 작업 위젯 시간 단위 */
export type TimeUnit = 'week' | 'month' | 'year';

/** 단위 + 기간 인덱스(0=현재, 1=이전 주/달/년 ...) */
export interface TimeRange {
  unit: TimeUnit;
  rangeIdx: number;
}

/** 히트맵 셀 클릭 필터 (bucket 의미는 granularity 에 따라 달라짐) */
export interface CellFilter {
  bucket1: number;  // hour-of-day-x-dow: dow / month-x-dow: month(0-based)
  bucket2: number;  // hour-of-day-x-dow: hour / month-x-dow: dow
}

/** get_activity_stats_v2 RPC 한 row */
export interface ActivityStatRowV2 {
  bucket1: number;
  bucket2: number;
  total: number;
  count_progress: number;
  count_memo: number;
  count_scene: number;
  count_etc: number;
}

/** get_activity_insights RPC 응답 (분석 모달 raw data) */
export interface ActivityInsightsRaw {
  monthDowGrid: Array<{ month: number; dow: number; count: number }>;
  userBreakdown: Array<{ userId: string; userName: string; count: number }>;
  userBreakdownTotal: number;
  stageBreakdown: { lo: number; done: number; review: number; png: number };
  topScenes: Array<{
    sceneId: string;
    sceneLabel: string | null;
    episodeNumber: number | null;
    total: number;
    revCount: number;
    memoCount: number;
    stageCount: number;
  }>;
  weeklyCompleted: Array<{ weekStart: string; completedSceneCount: number }>;
  /** v1.23.0: 클라이언트 보강 (RPC 는 빈 객체 반환) */
  sceneFlow: Record<string, never>;
  /** v1.23.0: 클라이언트 보강 (RPC 는 빈 배열 반환) */
  episodeProgress: unknown[];
}

export type UpdateReleaseNoteCategory = 'feature' | 'change' | 'bugfix' | 'ux' | 'stability' | 'docs';

export type UpdateReleaseNoteItem = string | {
  category?: UpdateReleaseNoteCategory | string;
  summary: string;
  description?: string;
};

export interface UpdateReleaseNote {
  version: string;
  title: string;
  items: UpdateReleaseNoteItem[];
}

export interface UpdateInfo {
  status: 'available' | 'downloading' | 'ready' | 'applying' | 'up-to-date' | 'failed' | 'suppressed';
  currentVersion: string;
  latestVersion: string;
  buildAt: string;
  ready: boolean;
  releaseNotes: UpdateReleaseNote[];
  message?: string;
  downloadedBytes?: number;
  totalBytes?: number;
}

// ─── Electron API (preload에서 노출) ─────────

export interface SupabaseRealtimeStatusMetadata {
  /** 최초 join이 아니라 연결 단절 뒤 성공한 join인지 여부. */
  reconnected: boolean;
}

export interface ElectronAPI extends CalendarApiInputContract {
  getDataPath: () => Promise<string>;
  shellShowItem?: (filePath: string) => Promise<{ ok: boolean; error?: string }>;
  shellOpenPath?: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
  chooseFolderPath?: () => Promise<string | null>;
  chooseFilePath?: () => Promise<string | null>;
  pathCreateFolder?: (
    parentPath: string,
    folderName: string,
  ) => Promise<{
    ok: boolean;
    path?: string;
    existed?: boolean;
    error?: string;
    code?: 'parent-missing' | 'invalid-name' | 'permission' | 'unknown';
  }>;
  pathDirname?: (targetPath: string) => Promise<string>;
  pathExists?: (targetPath: string) => Promise<boolean>;
  /** 외부 URL 을 기본 브라우저로 열기 (메모 링크 전용) */
  openExternal?: (url: string) => Promise<{ ok: boolean; error?: string }>;

  // 사용자 파일 (exe 옆 또는 test-data/ 옆, base64 인코딩 JSON)
  usersRead: () => Promise<UsersFile | null>;
  createLocalUser: (input: { name: string; slackId: string; hireDate?: string; birthday?: string }) => Promise<AppUser>;
  deleteLocalUser: (userId: string) => Promise<void>;
  readSettings: (fileName: string) => Promise<unknown | null>;
  writeSettings: (fileName: string, data: unknown) => Promise<boolean>;
  onDataChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onSheetChanged: (callback: (delta?: SheetDelta) => void) => () => void;
  onRetryNotify?: (callback: (message: string) => void) => () => void;
  onSavingBeforeQuit?: (callback: (pendingCount: number) => void) => () => void;
  // v1.22.1: 자동 업데이트 알림
  getUpdateState?: () => Promise<UpdateInfo | null>;
  checkForUpdates?: () => Promise<UpdateInfo | null>;
  // v1.44.2: '자동 중단' 상태 수동 복구 — 차단 표식 정리 후 재확인
  retryUpdate?: () => Promise<UpdateInfo | null>;
  onUpdateState?: (callback: (state: UpdateInfo | null) => void) => () => void;
  onUpdateReady?: (callback: (version: string, state?: UpdateInfo) => void) => () => void;
  applyUpdateNow?: () => Promise<void>;
  // 네이티브 알림
  showNativeNotification?: (title: string, body: string) => Promise<void>;
  // 이미지 파일 저장/삭제 (하이브리드 이미지 스토리지)
  imageSave: (fileName: string, base64Data: string) => Promise<string>;
  imageDelete: (fileName: string) => Promise<boolean>;
  imageGetDir: () => Promise<string>;
  clipboardReadImage: () => Promise<string | null>;
  clipboardReadImageFile: () => Promise<{ fileName: string; dataUrl: string } | null>;
  // GAS 연결 (이미지 업로드용 Apps Script 웹 앱)
  sheetsConnect: (webAppUrl: string) => Promise<SheetsConnectResult>;
  sheetsIsConnected: () => Promise<boolean>;
  // 이미지 업로드 (GAS → Google Drive)
  sheetsUploadImage: (sheetName: string, sceneId: string, imageType: string, base64Data: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  // ─── Supabase Storage ──────────────────────────
  storageUploadImage: (
    sheetName: string,
    sceneId: string,
    imageType: string,
    base64Data: string,
  ) => Promise<{ ok: boolean; url?: string; error?: string }>;
  storageDeleteImage: (url: string) => Promise<void>;
  // Sheets fallback (Supabase 장애 시)
  sheetsReadComments: (sheetName: string) => Promise<{ ok: boolean; data: { commentId: string; sheetName: string; sceneId: string; userId: string; userName: string; text: string; mentions: string[]; createdAt: string; editedAt: string }[]; error?: string }>;
  sheetsReadRevisions: () => Promise<{ ok: boolean; data: { id: string; sceneKey: string; revisionNo: number; status: string; description: string; imageUrl: string; department: string; requesterId: string; requesterName: string; assignee: string; resolvedBy: string; resolvedNote: string; createdAt: string; updatedAt: string; resolvedAt: string }[]; error?: string }>;
  // 데이터 변경 브로드캐스트
  dataNotifyChange?: (delta?: SheetDelta) => Promise<{ ok: boolean }>;
  sheetsNotifyChange?: (delta?: SheetDelta) => Promise<{ ok: boolean }>;
  // 스냅샷 릴레이 (같은 PC 내 다른 창에 전체 데이터 전달)
  onSnapshotRelay?: (callback: (data: SnapshotRelayData) => void) => () => void;
  sheetsRelaySnapshot?: (data: SnapshotRelayData) => Promise<{ ok: boolean }>;
  // 메타데이터 일괄 로딩
  sheetsReadAllMetadata?: () => Promise<{ ok: boolean; data: MetadataEntry[]; error?: string }>;
  // 휴가 관리 (vacation-repo WebApi)
  vacationConnect: (webAppUrl: string) => Promise<{ ok: boolean; error: string | null }>;
  vacationIsConnected: () => Promise<boolean>;
  vacationReadStatus: (name: string) => Promise<{ ok: boolean; data: import('./vacation').VacationStatus; error?: string }>;
  vacationReadLog: (name: string, year?: number, limit?: number) => Promise<{ ok: boolean; data: import('./vacation').VacationLogEntry[]; error?: string }>;
  vacationReadAllEvents: (year?: number) => Promise<{ ok: boolean; data: import('./vacation').VacationEvent[]; error?: string }>;
  vacationRegister: (name: string, type: string, startDate: string, endDate: string, reason: string) => Promise<import('./vacation').VacationResult>;
  vacationCancel: (name: string, rowIndex: number) => Promise<import('./vacation').VacationResult>;
  vacationGrantDahyu: (targets: string[], reason: string, grantDate: string) => Promise<import('./vacation').DahyuGrantResult>;
  vacationReadAllNames: () => Promise<{ ok: boolean; data: string[]; error?: string }>;
  vacationReadDahyuList: () => Promise<{ ok: boolean; data: import('./vacation').DahyuListEntry[]; error?: string }>;
  vacationDeleteDahyu: (rowIndices: number[]) => Promise<import('./vacation').DahyuDeleteResult>;
  // 위젯 팝업 윈도우
  widgetGetSavedState?: (widgetId: string) => Promise<{
    x: number; y: number; width: number; height: number;
    opacity: number; alwaysOnTop: boolean;
  } | null>;
  widgetOpenPopup?: (widgetId: string, title: string, extra?: Record<string, string>) => Promise<{ ok: boolean }>;
  widgetSetOpacity?: (widgetId: string, opacity: number) => Promise<void>;
  widgetClosePopup?: (widgetId: string) => Promise<void>;
  widgetResize?: (widgetId: string, width: number, height: number, x?: number, y?: number) => Promise<void>;
  widgetGetSize?: (widgetId: string) => Promise<{ x: number; y: number; width: number; height: number } | null>;
  widgetCaptureBehind?: (widgetId: string) => Promise<string | null>;
  onWidgetFocusChange?: (callback: (focused: boolean) => void) => () => void;
  widgetSetAlwaysOnTop?: (widgetId: string, aot: boolean) => Promise<void>;
  widgetMinimizeToDock?: (widgetId: string) => Promise<void>;
  widgetRestoreFromDock?: (widgetId: string) => Promise<void>;
  widgetDockExpand?: (widgetId: string) => Promise<void>;
  widgetDockCollapse?: (widgetId: string) => Promise<void>;
  onWidgetDockChange?: (callback: (isDocked: boolean) => void) => () => void;

  // 화이트보드 (공유 드라이브 파일 접근)
  whiteboardReadShared: () => Promise<{ ok: boolean; data: import('./whiteboard').WhiteboardData | null; error?: string }>;
  whiteboardWriteShared: (data: import('./whiteboard').WhiteboardData) => Promise<{ ok: boolean; error?: string }>;

  // ─── Supabase ──────────────────────────────────
  supabaseTestConnection: () => Promise<{ ok: boolean; error?: string }>;
  supabaseReadAll: () => Promise<unknown[]>;
  supabaseAddEpisode: (episodeNumber: number, department?: string) => Promise<void>;
  supabaseSoftDeleteEpisode: (episodeNumber: number) => Promise<void>;
  supabaseArchiveEpisode: (episodeNumber: number, archivedBy: string, archiveMemo: string) => Promise<void>;
  supabaseUnarchiveEpisode: (episodeNumber: number) => Promise<void>;
  supabaseUpdateEpisodeReelPath: (episodeNumber: number, reelFilePath: string | null) => Promise<void>;
  supabaseReadArchived: () => Promise<unknown[]>;
  supabaseAddPart: (episodeNumber: number, partId: string, department?: string) => Promise<void>;
  supabaseSoftDeletePart: (sheetName: string) => Promise<void>;
  supabaseAddScene: (sheetName: string, sceneId: string, assignee: string, memo: string) => Promise<{ sceneUuid: string | null }>;
  supabaseAddScenes: (sheetName: string, scenes: { sceneId: string; assignee: string; memo: string }[]) => Promise<void>;
  supabaseDeleteScene: (sceneUuid: string) => Promise<void>;
  supabaseUpdateSceneStage: (sceneUuid: string, stage: string, value: boolean, updatedBy?: string) => Promise<void>;
  /** v1.25.0~ 액팅 단계 토글 (sceneState + workRound + feedbackRound 한 번에 동기화) */
  supabaseUpdateScenePhase: (
    sceneUuid: string,
    sceneState: ScenePhaseState,
    workRound: number,
    feedbackRound: number,
    updatedBy?: string,
  ) => Promise<void>;
  supabaseReadSceneWorkLinks: (sceneUuids?: string[]) => Promise<SceneWorkLink[]>;
  supabaseUpsertSceneWorkLink: (input: {
    sceneUuid: string;
    department: SceneWorkLinkDepartment;
    linkKind: SceneWorkLinkKind;
    path: string;
    label?: string | null;
    sortOrder?: number;
    userId?: string | null;
  }) => Promise<SceneWorkLink>;
  supabaseDeleteSceneWorkLink: (
    sceneUuid: string,
    department: SceneWorkLinkDepartment,
    linkKind: 'folder' | 'primary_file',
  ) => Promise<void>;
  /** v1.25.0~ 액팅 피드백 알림 디스패치 — 다른 클라이언트에 broadcast */
  supabaseDispatchFeedbackNotification: (payload: {
    sceneUuid: string;
    sceneId: string;
    sheetName: string;
    episodeNumber: number;
    senderId: string;
    senderName: string;
    fromState: string;
    toState: string;
    workRound: number;
    feedbackRound: number;
    recipients: string[];
    message?: string;
  }) => Promise<void>;
  /** 리테이크 담당 완료 알림 디스패치 — 선택된 수신자에게 broadcast */
  supabaseDispatchRetakeAssigneeCompletionNotification: (payload: {
    revisionId: string;
    sceneKey: string;
    sceneUuid?: string;
    sheetName?: string;
    department?: 'bg' | 'acting';
    setId?: string | null;
    revisionNo: number;
    senderId: string;
    senderName: string;
    recipients: string[];
    note?: string;
    status: RevisionStatus;
    updatedAt: string;
  }) => Promise<void>;
  /** v1.25.5 로그인 catch-up — 마지막 본 시각 이후 미읽음 액팅 피드백 알림 일괄 조회.
   *  before: 페이지네이션 — created_at < before 만 가져옴. */
  supabaseFetchMissedFeedbackNotifications: (
    userId: string,
    since: string,
    limit?: number,
    before?: string,
  ) => Promise<Array<{
    id: string;
    senderId: string;
    senderName: string;
    sceneUuid: string | null;
    sceneId: string;
    sheetName: string;
    episodeNumber: number;
    fromState: string | null;
    toState: string;
    workRound: number;
    feedbackRound: number;
    message: string | null;
    createdAt: string;
  }>>;
  /** v1.25.5 액팅 피드백 알림 읽음 처리 — read_at = now() */
  supabaseMarkFeedbackNotificationRead: (notificationId: string) => Promise<void>;
  /** v1.25.8 씬 담당자 배정 알림 catch-up — 한솔 보고: 미접속 시 배정 알림이 사라짐.
   *  acting_feedback 과 동일 패턴. before: 페이지네이션 (created_at < before). */
  supabaseFetchMissedAssignmentNotifications: (
    userId: string,
    since: string,
    limit?: number,
    before?: string,
  ) => Promise<Array<{
    id: string;
    senderId: string;
    senderName: string;
    sceneUuid: string;
    sceneId: string;
    sheetName: string;
    episodeNumber: number;
    prevAssignee: string | null;
    newAssignee: string;
    createdAt: string;
  }>>;
  /** v1.25.8 씬 담당자 배정 알림 읽음 처리 — read_at = now() */
  supabaseMarkAssignmentNotificationRead: (notificationId: string) => Promise<void>;
  /** v1.29.0 댓글 이모지 반응 알림 — catch-up / refetch.
   *  - since: last_action_at > since (catch-up 페이지네이션)
   *  - ids: 단일/일부 refetch (Realtime removed 이벤트 fallback)
   *  - offset: 옵셔널 오프셋 페이지네이션 */
  supabaseFetchCommentReactionNotifications: (args: {
    recipientId: string;
    since?: string;
    before?: string;
    limit?: number;
    ids?: string[];
  }) => Promise<{ data: Array<{
    id: string;
    type: 'comment_reaction';
    title: string;
    body?: string;
    metadata: Record<string, unknown>;
    isRead: boolean;
    createdAt: string;
  }> }>;
  /** v1.29.0 댓글 이모지 반응 알림 — 단일 read_at 채움 */
  supabaseMarkCommentReactionRead: (notificationId: string) => Promise<void>;
  /** v1.29.0 댓글 이모지 반응 알림 — recipient 의 모든 미읽음 read_at 채움 */
  supabaseMarkAllCommentReactionsRead: (recipientId: string) => Promise<void>;
  /** v1.25.0~ Windows 네이티브 토스트 + 클릭 시 씬으로 점프 */
  notifyFeedbackToast: (payload: {
    title: string;
    body: string;
    /** v1.25.8 코덱스 3차 P2 fix: notificationId/kind 옵션 — OS 토스트 클릭 후
     *  렌더러가 DB read_at 을 채워 catch-up 중복 출현 차단. */
    sceneJump: {
      sheetName: string; sceneId: string; sceneUuid: string;
      notificationId?: string;
      kind?: 'feedback' | 'assignment';
    };
  }) => Promise<void>;
  /** v1.25.0~ 리테이크 토스트 클릭 → 씬 점프 신호 수신 */
  onFeedbackJumpToScene: (
    callback: (payload: {
      sheetName: string; sceneId: string; sceneUuid: string;
      notificationId?: string;
      kind?: 'feedback' | 'assignment';
    }) => void,
  ) => () => void;
  /** 위젯 팝업 → 본체 씬 상세 이동 — 팝업에서 본체로 점프 신호 전송 */
  widgetNavigateMain?: (payload: {
    sheetName: string; sceneId: string; sceneUuid: string;
    episodeNumber?: number; partId?: string;
  }) => Promise<void>;
  /** 위젯 팝업 → 본체 씬 상세 이동 — 본체가 점프 신호 수신 */
  onWidgetNavigateMain?: (
    callback: (payload: {
      sheetName: string; sceneId: string; sceneUuid: string;
      episodeNumber?: number; partId?: string;
    }) => void,
  ) => () => void;
  /** 위젯 팝업 → 본체 캘린더 날짜 이동 — 팝업에서 본체로 점프 신호 전송 */
  widgetNavigateToDate?: (payload: { date: string; todoId: string }) => Promise<void>;
  /** 위젯 팝업 → 본체 캘린더 날짜 이동 — 본체가 점프 신호 수신 */
  onWidgetNavigateToDate?: (callback: (payload: { date: string; todoId: string }) => void) => () => void;
  supabaseBulkUpdateSceneStages: (updates: BulkStageUpdate[], updatedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseBulkDeleteScenes: (sceneUuids: string[], deletedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseBulkUpdateSceneFields: (updates: BulkFieldUpdate[], updatedBy: string) => Promise<BulkUpdateResult[]>;
  supabaseUpdateSceneField: (sceneUuid: string, field: string, value: string, senderId?: string) => Promise<void>;
  supabaseReadUsers: () => Promise<PublicUserDirectory>;
  supabaseAddUser: (user: unknown) => Promise<void>;
  supabaseUpdateUser: (userId: string, updates: Record<string, string | boolean | null>) => Promise<void>;
  supabaseDeleteUser: (userId: string) => Promise<void>;
  supabaseReadComments: (partUuid: string) => Promise<unknown[]>;
  /** 캐릭터 현황판 상세 스레드 — 캐릭터별 댓글 일괄 조회. */
  supabaseReadCommentsForCharacter?: (characterId: string) => Promise<unknown[]>;
  supabaseReadCommentReadStates?: (userId: string) => Promise<CommentReadStateRow[]>;
  supabaseUpsertCommentReadState?: (userId: string, sceneThreadKey: string, lastReadAt: string) => Promise<void>;
  /** 한솔 결정 (v1.15.5): 로그인 catch-up — last seen 이후 받은 멘션 댓글 일괄 조회 */
  supabaseFetchMissedMentions: (userId: string, userName: string, since: string, limit?: number) => Promise<Array<{
    id: string;
    partId: string;
    sceneId: string;
    /** v1.15.9: 정확 씬 매칭용 UUID (catch-up navigateToScene 에서 활용) */
    sceneUuid?: string | null;
    userId: string;
    userName: string;
    text: string;
    mentions: string[];
    createdAt: string;
    editedAt?: string | null;
  }>>;
  supabaseAddComment: (commentId: string, partUuid: string, sceneId: string, userId: string, userName: string, text: string, mentions: string[], createdAt: string, images?: string[], revisionId?: string | null, parentCommentId?: string | null, characterId?: string | null, costumeId?: string | null) => Promise<void>;
  supabaseEditComment: (commentId: string, text: string, mentions: string[], images?: string[]) => Promise<void>;
  supabaseDeleteComment: (commentId: string) => Promise<void>;
  /** v1.26.0: 댓글 이모지 리액션 */
  supabaseAddCommentReaction: (commentId: string, emoji: string, userId: string, userName: string) => Promise<void>;
  supabaseRemoveCommentReaction: (commentId: string, emoji: string, userId: string) => Promise<void>;
  supabaseGetCommentReactionsBulk: (commentIds: string[]) => Promise<Record<string, Array<{
    id: string;
    commentId: string;
    userId: string;
    userName: string;
    emoji: string;
    createdAt: string;
  }>>>;
  /** v1.26.0: 이미지 버전 관리 */
  supabaseListImageVersions: (sceneId: string, imageType: 'storyboard' | 'guide') => Promise<ImageVersion[]>;
  supabaseAddImageVersion: (params: {
    sceneId: string;
    imageType: 'storyboard' | 'guide';
    kind: 'replace' | 'annotate';
    url: string;
    baseVersionNo?: number;
    createdBy: string;
    description?: string | null;
  }) => Promise<ImageVersion>;
  supabaseDeleteImageVersion: (versionId: string) => Promise<void>;
  /** 비공개 캘린더 이벤트 — Google Calendar 비연동, Supabase 전용 */
  supabaseReadPrivateEvents: (userId: string) => Promise<Array<{
    id: string;
    user_id: string;
    title: string;
    memo: string | null;
    color: string | null;
    type: string | null;
    start_date: string;
    end_date: string;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>>;
  supabaseAddPrivateEvent: (input: {
    user_id: string;
    title: string;
    memo?: string;
    color?: string;
    type?: string;
    start_date: string;
    end_date: string;
    linked_episode?: number | null;
    linked_part?: string | null;
    linked_sheet_name?: string | null;
    linked_scene_id?: string | null;
    linked_department?: string | null;
    linked_todo_id?: string | null;
    created_by?: string;
  }) => Promise<{ id: string }>;
  supabaseUpdatePrivateEvent: (id: string, updates: Record<string, unknown>) => Promise<void>;
  supabaseDeletePrivateEvent: (id: string) => Promise<void>;
  calendarList: () => Promise<Array<{
    id: string;
    name: string;
    color: string;
    visibility: 'private' | 'members' | 'team';
    owner_id: string;
    is_personal: boolean;
    created_at: string;
    updated_at: string;
    members: Array<{ user_id: string; can_edit: boolean }>;
    can_edit: boolean;
    can_manage: boolean;
  }>>;
  calendarCreate: (
    input: Parameters<CalendarApiInputContract['calendarCreate']>[0],
  ) => Promise<{
    id: string;
    name: string;
    color: string;
    visibility: 'private' | 'members' | 'team';
    owner_id: string;
    is_personal: boolean;
    created_at: string;
    updated_at: string;
  }>;
  calendarUpdate: (
    id: Parameters<CalendarApiInputContract['calendarUpdate']>[0],
    updates: Parameters<CalendarApiInputContract['calendarUpdate']>[1],
  ) => Promise<void>;
  calendarDelete: (id: string) => Promise<void>;
  calendarSetMembers: (
    calendarId: Parameters<CalendarApiInputContract['calendarSetMembers']>[0],
    members: Parameters<CalendarApiInputContract['calendarSetMembers']>[1],
  ) => Promise<void>;
  calendarEventsList: (
    params?: Parameters<CalendarApiInputContract['calendarEventsList']>[0]
  ) => Promise<Array<{
    id: string;
    calendar_id: string;
    title: string;
    memo: string | null;
    tag_id: string | null;
    all_day: boolean;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>>;
  calendarEventCreate: (
    input: Parameters<CalendarApiInputContract['calendarEventCreate']>[0],
  ) => Promise<{
    id: string;
    calendar_id: string;
    title: string;
    memo: string | null;
    tag_id: string | null;
    all_day: boolean;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>;
  calendarPrivacyMigrationSourceDelete: (
    input: Parameters<CalendarApiInputContract['calendarPrivacyMigrationSourceDelete']>[0],
  ) => Promise<CalendarPrivacyMigrationSourceDeleteResult>;
  calendarPrivacyReplacementCreate: (
    input: Parameters<CalendarApiInputContract['calendarPrivacyReplacementCreate']>[0],
  ) => Promise<{
    storage: 'bflow' | 'legacy-private' | 'google';
    actual_id: string;
    calendar_id?: string;
    receipt: string;
  }>;
  calendarPrivacyReplacementSettle: (
    receipt: Parameters<CalendarApiInputContract['calendarPrivacyReplacementSettle']>[0],
    disposition: Parameters<CalendarApiInputContract['calendarPrivacyReplacementSettle']>[1],
  ) => Promise<void>;
  calendarEventUpdate: (
    id: Parameters<CalendarApiInputContract['calendarEventUpdate']>[0],
    updates: Parameters<CalendarApiInputContract['calendarEventUpdate']>[1],
  ) => Promise<{
    id: string;
    calendar_id: string;
    title: string;
    memo: string | null;
    tag_id: string | null;
    all_day: boolean;
    start_date: string;
    end_date: string;
    start_time: string | null;
    end_time: string | null;
    linked_episode: number | null;
    linked_part: string | null;
    linked_sheet_name: string | null;
    linked_scene_id: string | null;
    linked_department: string | null;
    linked_todo_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }>;
  calendarEventDelete: (id: string) => Promise<void>;
  calendarTagsList: () => Promise<Array<{
    id: string;
    name: string;
    color: string;
    sort_order: number;
  }>>;
  calendarTagsSave: (
    tags: Parameters<CalendarApiInputContract['calendarTagsSave']>[0],
  ) => Promise<Array<{ id: string; name: string; color: string; sort_order: number }>>;
  calendarNotificationsCatchup: () => Promise<Array<{
    id: string;
    recipient_id: string;
    actor_id: string | null;
    actor_name: string | null;
    calendar_id: string | null;
    calendar_name: string | null;
    event_id: string | null;
    event_title: string | null;
    event_date: string | null;
    action: 'create' | 'update' | 'delete';
    detail: string | null;
    created_at: string;
    read_at: string | null;
  }>>;
  calendarNotificationsMarkRead: (ids: string[]) => Promise<void>;
  supabaseReadRevisions: () => Promise<unknown[]>;
  supabaseAddRevision: (id: string, partUuid: string, sceneId: string, revisionNo: number, status: string, priority: string, description: string, frameNo: string, imageUrl: string, department: string, lookupDepartment: string, requesterId: string, requesterName: string, assignee: string, createdAt: string, notifyUserIdsJson: string, assigneeIdsJson?: string, setId?: string) => Promise<void>;
  supabaseUpdateRevision: (id: string, updates: Record<string, string>) => Promise<void>;
  supabaseDeleteRevision: (id: string) => Promise<void>;
  supabaseReadRevisionSets: () => Promise<CompRevisionSet[]>;
  supabaseAddRevisionSet: (input: Omit<CompRevisionSet, 'id' | 'status' | 'createdAt' | 'updatedAt'>) => Promise<CompRevisionSet>;
  supabaseUpdateRevisionSet: (id: string, fields: Partial<Pick<CompRevisionSet, 'title' | 'episodeNumber' | 'department' | 'aggregatorId' | 'status'>>) => Promise<CompRevisionSet>;
  supabaseDeleteRevisionSet: (id: string) => Promise<void>;
  supabaseReadAllMetadata: () => Promise<unknown[]>;
  supabaseReadMetadata: (type: string, key: string) => Promise<unknown>;
  supabaseWriteMetadata: (type: string, key: string, value: string) => Promise<void>;
  supabaseGetActivity: (opts: { table?: string; action?: 'read' | 'write'; rangeMs: number; buckets: number })
    => Promise<Array<{ startTs: number; count: number }>>;
  supabaseGetRealtimeStatus: () => Promise<string>;
  onSupabaseRealtime: (callback: (event: unknown) => void) => () => void;
  onSupabasePresence: (callback: (snapshot: unknown) => void) => () => void;
  getPresenceSnapshot: () => Promise<unknown>;
  onSupabaseStatus: (
    callback: (status: string, metadata: SupabaseRealtimeStatusMetadata) => void,
  ) => () => void;
  onSupabaseBroadcast: (callback: (event: unknown) => void) => () => void;
  // ─── Playground market (main-owned canonical session) ──
  marketRead: () => Promise<MarketRemoteState>;
  marketExecute: (command: MarketCommand) => Promise<MarketRemoteState>;
  marketCreateAdminEvent: (input: MarketAdminEventInput) => Promise<MarketRemoteState>;
  marketDeleteAdminEvent: (eventId: string) => Promise<MarketRemoteState>;
  // ─── Playground arcade (main-owned canonical session) ──
  arcadeRead: () => Promise<ArcadeSnapshot>;
  arcadeExecute: (command: ArcadeExecuteCommand) => Promise<ArcadeExecuteResult>;
  onArcadeWalletUpdated: (callback: (update: ArcadeWalletPush) => void) => () => void;
  onPlaygroundNativeBack?: (callback: () => void) => () => void;
  // 슬랙 웹훅
  sendSlackWebhook: (payload: Record<string, string>) => Promise<{ ok: boolean }>;
  // 리깅 완성 공지 웹훅
  sendRiggingWebhook: (payload: Record<string, string>) => Promise<{ ok: boolean }>;
  // 딥링크
  onDeepLink: (callback: (data: { sheetName: string; sceneId: string }) => void) => () => void;

  // ─── Personal Todos / Task Views (main-owned session) ──
  ensureCanonicalSession: () => Promise<CanonicalSessionResult>;
  loginCanonicalSession: (input: { name: string; password: string; rememberMe?: boolean }) => Promise<CanonicalSessionResult>;
  restoreCanonicalSession: () => Promise<CanonicalSessionResult>;
  logoutCanonicalSession: () => Promise<CanonicalSessionResult>;
  refreshCanonicalUser: () => Promise<CanonicalSessionResult>;
  changeOwnPassword: (input: { currentPassword: string; newPassword: string }) => Promise<{ ok: boolean; error?: string }>;
  readPersonalTodos: () => Promise<MainPersonalTodoResult<MainPersonalTodo[]>>;
  readPersonalTodoLabels: () => Promise<MainPersonalTodoResult<MainPersonalTodoLabel[]>>;
  createPersonalTodo: (input: MainPersonalTodoCreateInput) => Promise<MainPersonalTodoResult<MainPersonalTodo[]>>;
  patchPersonalTodo: (todoId: string, patch: MainPersonalTodoPatch) => Promise<MainPersonalTodoResult<MainPersonalTodo>>;
  applyCalendarToTodoPatch: (todoId: string, patch: MainCalendarTodoPatch) => Promise<MainPersonalTodoResult<MainPersonalTodo>>;
  mutatePersonalTodoOrder: (mutation: { type: 'reorder' } | { type: 'pin' | 'setPinned'; todoId: string; pinned: boolean } | { type: 'status' | 'setStatusAndOrder'; todoId: string; status: MainPersonalTodoStatus }, orderedIds: string[]) => Promise<MainPersonalTodoResult<MainPersonalTodo[]>>;
  deletePersonalTodo: (todoId: string) => Promise<MainPersonalTodoResult<MainPersonalTodo[]>>;
  createOrReusePersonalTodoLabelAndAttach: (input: { todoId: string; name: string; colorKey: MainPersonalTodoLabelColorKey }) => Promise<MainPersonalTodoResult<{ label: MainPersonalTodoLabel; todo: MainPersonalTodo | null }>>;
  updatePersonalTodoLabel: (labelId: string, patch: { name?: string; colorKey?: MainPersonalTodoLabelColorKey }) => Promise<MainPersonalTodoResult<MainPersonalTodoLabel>>;
  readLegacyTaskViews: () => Promise<MainPersonalTodoResult<{ views: unknown[]; assignedSceneKeys: unknown[] } | null>>;
  upsertLegacyTaskViews: (views: unknown[], sceneKeys: unknown[]) => Promise<MainPersonalTodoResult<void>>;
  retryPersonalTodoCalendar: () => Promise<MainPersonalTodoResult<void>>;
  onPersonalTodoCommit: (cb: (payload: unknown) => void) => () => void;
  // ─── Memos ───────────────────────────────
  supabaseReadMemo: (userId: string, widgetId: string) => Promise<any>;
  supabaseUpsertMemo: (userId: string, widgetId: string, data: unknown) => Promise<void>;
  supabaseReadAllMemos: (userId: string) => Promise<any[]>;

  // ─── 활동 기록 (activity_log) ──────────────
  activityList: (opts: {
    before?: string;
    limit?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
    sceneIds?: string[];
    /** v1.23.0: 시간 단위 탐색 시 range 필터 */
    rangeStart?: string;
    rangeEnd?: string;
  }) => Promise<any[]>;
  activityStats: (opts: {
    days?: number;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
    department?: 'bg' | 'acting' | null;
  }) => Promise<Array<{
    day_of_week: number;
    hour: number;
    count: number;
    count_progress: number;
    count_memo: number;
    count_scene: number;
    count_etc: number;
  }>>;
  /** v1.23.0: 시간 단위 + 기간 기반 통계 (히트맵·막대 데이터 소스) */
  activityStatsV2: (opts: {
    rangeStart: string;
    rangeEnd: string;
    granularity: 'hour-of-day-x-dow' | 'month-x-dow' | 'month-totals';
    department?: 'bg' | 'acting' | null;
    groups?: ('progress' | 'memo' | 'scene' | 'etc')[];
  }) => Promise<ActivityStatRowV2[]>;
  /** v1.23.0: 분석 모달 7카드 raw data 한 번에 */
  activityInsights: (opts: {
    rangeStart: string;
    rangeEnd: string;
    department?: 'bg' | 'acting' | null;
  }) => Promise<ActivityInsightsRaw>;
  activityBackfill: (since: string) => Promise<any[]>;
  activityStorageInfo: () => Promise<{ count: number; sizeMB: number }>;
  onActivityRealtimeInsert: (cb: (row: any) => void) => () => void;

  // ─── 설정/세션 변경 브로드캐스트 ─────────────────
  preferencesBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onPreferencesChanged: (cb: (payload: unknown) => void) => () => void;
  sessionBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  sessionRequestCurrent: () => Promise<{ ok: boolean }>;
  onSessionChanged: (cb: (payload: unknown) => void) => () => void;
  themeBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onThemeChanged: (cb: (payload: unknown) => void) => () => void;
  calendarBroadcastChange: (payload?: unknown) => Promise<{ ok: boolean }>;
  onCalendarChanged: (cb: (payload: unknown) => void) => () => void;

  // ─── 휴가 pending 상태 + 브로드캐스트 ─────────────
  vacationPendingLoad: () => Promise<unknown>;
  vacationPendingSave: (list: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastRegistered: (payload?: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastFailed: (payload?: unknown) => Promise<{ ok: boolean }>;
  vacationBroadcastPendingChanged: (payload?: unknown) => Promise<{ ok: boolean }>;
  onVacationRegistered: (cb: (payload: unknown) => void) => () => void;
  onVacationFailed: (cb: (payload: unknown) => void) => () => void;
  onVacationPendingChanged: (cb: (payload: unknown) => void) => () => void;

  // ─── 사용자 폰트 (v1.20.0) ──────────────────────
  fontAdd: () => Promise<Array<
    | { id: string; name: string; filename: string; format: 'otf' | 'ttf' | 'woff' | 'woff2'; hasKorean: boolean; addedAt: string }
    | { error: string }
  >>;
  fontAddByPath: (filePaths: string[]) => Promise<Array<
    | { id: string; name: string; filename: string; format: 'otf' | 'ttf' | 'woff' | 'woff2'; hasKorean: boolean; addedAt: string }
    | { error: string }
  >>;
  fontDelete: (font: { id: string; filename: string }) => Promise<{ ok: boolean; error?: string }>;
  /** 드래그앤드롭에서 File 객체 → 절대 경로 (Electron 32+ webUtils.getPathForFile) */
  fontGetPathForFile: (file: File) => string;

  // ─── Google Calendar ──────────────────────────────
  gcalIsAuthenticated: () => Promise<boolean>;
  gcalStartAuth: () => Promise<void>;
  gcalSaveCredentials: (clientId: string, clientSecret: string) => Promise<void>;
  gcalHasCredentials: () => Promise<boolean>;
  gcalSaveLocalSettings: (settings: { personalCalendarId?: string | null; lastSyncAt?: string | null }) => Promise<void>;
  gcalSignOut: () => Promise<void>;
  gcalListCalendars: () => Promise<Array<{ id: string; summary: string; primary: boolean }>>;
  gcalFullSync: (calendarId: string) => Promise<any[]>;
  gcalIncrementalSync: (calendarId: string) => Promise<{ updated: any[]; deleted: string[]; isFullSync: boolean }>;
  gcalInsertEvent: (calendarId: string, input: unknown) => Promise<string>;
  gcalUpdateEvent: (calendarId: string, eventId: string, input: unknown) => Promise<void>;
  gcalDeleteEvent: (calendarId: string, eventId: string) => Promise<void>;
  gcalEnsureWatch: (calendarId: string, userId: string) => Promise<void>;

  // ─── v1.30.0: 컴포지팅 단계 상태 ────────────────
  // spec: docs/superpowers/specs/2026-05-21-compositing-dashboard-design.md
  supabaseLoadCompositingStates: (episodeNumber: number) => Promise<any[]>;
  supabaseSetCompositingState: (input: {
    episodeNumber: number;
    sceneId: string;
    partId: string;
    status: CompositingStatus;
    errorKind?: CompositingErrorKind | null;
    errorNote?: string | null;
    progressPercent?: number;
    updatedBy: string;
  }) => Promise<any>;
  onCompositingStatesRealtime: (cb: (payload: {
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: any | null;
    old: any | null;
  }) => void) => () => void;

  // ─── 캐릭터 현황판 ────────────────────────────
  supabaseLoadCharacters: () => Promise<any[]>;
  supabaseLoadCharacterCostumes: () => Promise<any[]>;
  supabaseLoadEpisodeCharacterMap: () => Promise<any[]>;
  supabaseAddCharacter: (input: { name: string; memo?: string | null; createdBy?: string | null }) => Promise<any>;
  supabaseUpdateCharacter: (id: string, updates: Record<string, unknown>) => Promise<any>;
  supabaseDeleteCharacter: (id: string) => Promise<void>;
  supabaseAddCostume: (input: { characterId: string; name: string; createdBy?: string | null }) => Promise<any>;
  supabaseUpdateCostume: (id: string, updates: Record<string, unknown>, logContext?: CostumeActivityLogContext) => Promise<any>;
  supabaseDeleteCostume: (id: string) => Promise<void>;
  supabaseLinkCharacterEpisode: (episodeNumber: number, characterId: string, createdBy?: string | null) => Promise<any>;
  supabaseUnlinkCharacterEpisode: (episodeNumber: number, characterId: string) => Promise<void>;
  supabaseUpdateEpisodeCharacterMap: (
    episodeNumber: number,
    characterId: string,
    updates: { memo?: string | null; costumeIds?: string[] },
  ) => Promise<void>;
  storageUploadCharacterImage: (characterId: string, costumeId: string, base64Data: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
  // ─── 복장 다중 이미지 (character_costume_images) ───
  supabaseLoadCostumeImages: () => Promise<any[]>;
  supabaseAddCostumeImage: (input: {
    costumeId: string;
    url: string;
    role?: CostumeImageRole;
    imageBackground?: CharacterImageBackground;
    imageFit?: CharacterImageFit;
    naturalWidth?: number | null;
    naturalHeight?: number | null;
    isPrimary?: boolean;
    sortOrder?: number;
    createdBy?: string | null;
  }) => Promise<any>;
  supabaseUpdateCostumeImage: (id: string, updates: Record<string, unknown>) => Promise<any>;
  supabaseDeleteCostumeImage: (id: string) => Promise<void>;
  supabaseSetPrimaryCostumeImage: (costumeId: string, imageId: string) => Promise<void>;
  // ─── 캐릭터 현황판 탭·그룹 (피드백 41) ───
  supabaseLoadCharacterBoardTabs: () => Promise<any[]>;
  supabaseAddCharacterBoardTab: (input: { name: string; sortOrder: number; createdBy?: string | null }) => Promise<any>;
  supabaseUpdateCharacterBoardTab: (id: string, updates: Record<string, unknown>) => Promise<any>;
  supabaseDeleteCharacterBoardTab: (id: string) => Promise<{ ok: boolean }>;
  onCharacterBoardRealtime: (cb: (payload: {
    table: 'characters' | 'character_costumes' | 'character_costume_images' | 'episode_character_mapping' | 'character_board_tabs';
    eventType: 'INSERT' | 'UPDATE' | 'DELETE';
    row: Record<string, unknown> | null;
    old: Record<string, unknown> | null;
  }) => void) => () => void;
  /** character_board 채널 자체의 구독 상태 (SUBSCRIBED/CLOSED/CHANNEL_ERROR/TIMED_OUT). */
  onCharacterBoardRealtimeStatus?: (cb: (status: string) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
