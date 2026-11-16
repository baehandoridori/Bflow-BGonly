// 작업대 · 기록 목록 · 한 건 보기 · 그림체 기준 창 부품의 약속 (props). 부품은 보여 주기만 하고,
// 글자와 숫자(언제 · 걸린 시간 · 비용 · 요약)는 상태 쪽이 만들어 넘긴다. 버튼 이름 같은 고정 글자만 부품이 쓴다.
import type { ReactNode } from 'react';

export type BaeStartKind = 'new' | 'same' | 'layers' | 'angle' | 'upscale' | 'denoise';

/** 이름 · 값 한 쌍 ('비율' · '16:9', 'PD 비용' · '43원') */
export interface BaeFactView { k: string; v: string }
/** 레퍼런스 한 장 (작은 그림과 그 메모) */
export interface BaeMatPicView { id: string; src: string; alt: string; note: string }

/** 1 재료 칸과 한 건 보기의 재료 */
export interface BaeMaterialsView {
  rough: { src: string; alt: string; name: string; sub: string } | null; // name '러프와 빨간 메모', sub '빨간 메모 2개'
  refs: BaeMatPicView[];
  refMax: number;                // 4
  bases: BaeMatPicView[];        // 기준 배경 (같은 장소). 없으면 []
  baseMax: number;               // 3
  sheet: string | null;          // 부품 시트로 보냈으면 그 그림 (기록)
  stripSrc: string;              // 그림체 기준 띠 그림
  styleRow: string;              // '스타일 띠, 예시 L2' ('' 이면 그림체 기준 줄을 숨긴다)
  descLabel: string;             // '설명'
  desc: string;
  facts: BaeFactView[];          // 비율 · 장소 · 시간대 · 투시
}

/** 2 주문서 칸과 한 건 보기의 PD 글 */
export interface BaeOrderTextView {
  summary: string;               // PD 요약 (한국어)
  ask: string;                   // 고쳐 달라고 한 말 ('' = 없음)
  notes: string[];               // PD 메모 (노란 줄)
  style: string;                 // 스타일 예시와 고른 까닭 ('' = 줄 없음)
  pdNote: string;                // 덧붙임 ('처음 요청이 멈춰서 한 번 다시 보냈어요.', '' = 없음)
  head: BaeFactView[];           // 칸 머리의 숫자: 주문서 1번 · PD 18초 · 비용 43원
}
/** 한 건 보기에서만 더 보이는 PD 글 */
export interface BaeJobPdView extends BaeOrderTextView {
  prompt: string;                // 영어 주문서
  revisions: string[];           // 고친 기록
  director: { ko: string[]; en: string[] } | null; // { } 지문
}

export interface BaeResultView {
  src: string;
  alt: string;
  aspect: number;                // 너비 / 높이 (25:16 칸보다 넓으면 너비에 맞춘다)
  facts: BaeFactView[];          // 크기 · 그림 · 비용
  tools?: BaeResultToolsView | null;  // 다듬기 (없으면 버튼 없음)
}
/** 결과 다듬기 (14b 10-2 '다듬기', HTML btnDenoise · lockSw). busy = 지금 하는 일의 글 ('' 이면 아님). */
export interface BaeResultToolsView {
  noise: { on: boolean; label: string; title: string; busy: string };
  lock: { on: boolean; label: string; title: string; busy: string } | null; // 기준 배경 색 맞춤을 한 그림만
  note: string;                  // 색 맞춤을 못 했을 때 안내 (HTML finishPicture note)
  /** 이 PC 에 원본이 없다 (다른 PC 에서 만듦): 노이즈 제거는 창으로 열고, 색 맞춤은 못 바꾼다 */
  away: boolean;
  /** 4K로 키우기 (HTML upSync): 이미 그 크기 이상이면 꺼짐. busy = 이 그림을 키우는 중 ('' 이면 아님). 없으면 버튼 없음 */
  upscale?: { disabled: boolean; title: string; busy: string } | null;
}
export type BaeReviewRate = '좋음' | '보통' | '다시';
export interface BaeReviewView { rate: BaeReviewRate | ''; good: string; bad: string }

/** 작업대에 올린 한 건 */
export interface BaeBenchView {
  id: string;
  title: string;                 // 붙인 이름, 없으면 설명
  named: boolean;                // 붙인 이름이 있음 (결과 칸 머리에 굵게)
  kindLabel: string;             // '새 배경'
  when: string;                  // '11월 5일 21:03'
  mat: BaeMaterialsView;
  matAct: string;                // '재료 바꿔 다시 그리기' ('' = 버튼 없음)
  order: BaeOrderTextView | null;
  orderReady: boolean;           // 주문서가 다 됐고 아직 안 그림 → '주문서 확인하고 그리기'
  result: BaeResultView | null;
  review: BaeReviewView | null;  // 내가 남긴 검수 (null = 남길 수 없음)
  failed: { title: string; text: string } | null;
}

/** 진행 중 (작게 접은 진행 줄, 시안 OrderingSmall · Drawing) */
export interface BaeBusyView {
  phase: 'order' | 'draw';
  main: string;                  // 'PD가 주문서 쓰는 중, 12초째'
  sub: string;                   // '다 쓰면 요약을 읽고 그림을 만들어요'
  src: string | null;            // 결과 칸에 깔 그림 (러프, 그리는 중이면 중간 그림)
  partial: boolean;              // 중간 그림이면 흐리게
  aspect: number;
  facts: BaeFactView[];          // 크기 · 그림 '아직' · 지금까지 '0원'
}

export interface BaeBenchActions {
  onEditMat?(): void;            // 재료 바꿔 다시 그리기
  onOpenStyle?(): void;          // 그림체 기준 '설정'
  onOpenOrder?(): void;          // 주문서 확인하고 그리기
  onZoom?(): void;               // 결과 크게 보기 (한 건 보기)
  onReview?(): void;             // 검수 남기기 (한 건 보기를 검수 펼친 채로)
  onSave?(): void;               // PNG 저장
  onRetry?(): void;              // 실패한 작업 다시 시도
  onExpand?(): void;             // 진행 줄의 '크게 보기'
  onStop?(): void;               // 진행 줄의 '그만두기'
  onNoise?(): void;              // 다듬기: 노이즈 제거 켜고 끄기
  onLock?(): void;               // 다듬기: 색 맞춤 켜고 끄기
  onUpscale?(): void;            // 다듬기: 4K로 키우기 (창)
  onUseBase?(): void;            // 기준 배경으로 새 컷
}

/** 그림을 끌어다 놓는 여섯 칸 (14b 10-2, 시안 Dropping): 왼쪽 둘은 재료, 오른쪽 넷은 도구. */
export type BaeDropZone = 'rough' | 'base' | 'layers' | 'angle' | 'upscale' | 'denoise';
export interface BaeDropView {
  /** 'drag' = 끌고 오는 중 (놓으면 그 칸), 'paste' = 붙여 넣은 그림 (칸을 눌러 고름) */
  mode: 'drag' | 'paste';
  onZone(zone: BaeDropZone, file: File | null): void;
  onCancel(): void;
}

/** 작업대 전체. bench 가 없으면 1단계의 빈 작업대, log 가 없으면 빈 기록. */
export interface BaeWorkbenchProps {
  onStart(kind: BaeStartKind): void;
  bench?: BaeBenchView | null;
  busy?: BaeBusyView | null;
  benchLoading?: boolean;
  benchError?: string | null;    // '서버에 연결하지 못했어요. …'
  onBenchRetry?(): void;
  actions?: BaeBenchActions;
  log?: BaeRecordListProps;
  /** 그림을 끌어 오거나 붙여 넣었을 때 작업판 자리에 놓는 칸 여섯 */
  drop?: BaeDropView | null;
}

/** 기록 한 줄 */
export interface BaeRecordRowView {
  id: string;
  thumb: string | null;          // 결과 작은 그림 (없으면 러프)
  thumbAlt: string | null;       // 마우스를 올리면 보이는 러프 (null = 없음)
  title: string;                 // 설명 (또는 요약)
  name: string;                  // 붙인 이름 ('' = 없음)
  sub: string;                   // 줄 보기 둘째 줄 ('메모 2개', '실패: …')
  kindLabel: string;
  when: string;
  took: string;                  // '53초', 진행 중이면 '12초째'
  cost: string;                  // '169원'
  state: 'done' | 'live' | 'failed' | 'stopped';
  stateLabel: string;            // '그리는 중' · '주문서 쓰는 중' · '실패' · '그만둠' (done 이면 '')
  stamp: { label: string; tone: 'seen' | 'good' | 'again' } | null; // 관리자 확인 도장
  maker?: string;                // 만든 사람 (팀 기록)
  fresh?: boolean;               // 내 기록: 이번에 새로 온 도장 (좋아요 · 다시)
  pickable?: boolean;            // 팀 기록: 여러 건 '확인함'으로 고를 수 있음 (끝났고 도장이 없음)
}

export interface BaeRecordListProps {
  title?: string;                // '내 기록' (기본)
  rows: BaeRecordRowView[];      // 찾기를 거친 줄 (filterBaeRecordRows)
  total?: number;                // 찾기 전 줄 수 (0 이면 '아직 만든 그림이 없어요')
  selectedId?: string | null;
  pickLabel?: string;            // 누르면 하는 일 (읽어 주는 이름 뒤에 붙음): '작업판에 올리기' · '자세히 보기'
  onPick(id: string): void;
  view: 'grid' | 'list';
  onView(v: 'grid' | 'list'): void;
  query: string;
  onQuery(q: string): void;
  onRename?(id: string, name: string): void; // 없으면 이름 붙이기 버튼이 없다
  onAll?(): void;                // '전체 기록' (작업대 아래에서만)
  loading?: boolean;
  error?: string | null;
  onRetry?(): void;
  emptyText?: string;            // '위의 새 배경 만들기로 시작하면 여기에 쌓여요.'
  emptyTitle?: string;           // '아직 만든 그림이 없어요'
  // ── 팀 기록 (8단계) ──
  scope?: ReactNode;             // 제목 자리의 '내 기록 | 팀 기록' (있으면 제목은 읽어 주기만)
  toolbar?: ReactNode;           // 머리 아래 거르기 줄
  maker?: boolean;               // 만든 사람 칸
  select?: { picked: ReadonlySet<string>; onToggle(id: string): void } | null; // 여러 건 고르기 (pickable 줄만)
  searchLabel?: string;          // 찾기 칸 안내 ('이름, 설명에서 찾기')
  more?: { onMore(): void; loading: boolean } | null; // 다음 쪽
}

/** 도장 한 번 (지금 도장 · 차례 한 줄). tone 이 null 이면 도장을 뺀 줄. */
export interface BaeStampMarkView { id: number; tone: 'seen' | 'good' | 'again' | null; label: string; by: string; when: string; note: string }
/** 한 건 보기의 확인 도장 칸: 지금 도장과 누가 · 언제, 차례, 그리고 검수자에게만 찍는 곳. */
export interface BaeStampPanelView {
  current: BaeStampMarkView | null;
  history: BaeStampMarkView[];
  fresh: boolean;                // 만든 사람: 이번에 새로 온 도장
  edit: { saving: boolean; blocked: string; onStamp(stamp: 'seen' | 'good' | 'again' | null, note: string): void } | null; // blocked: 찍을 수 없는 까닭 ('' = 찍을 수 있음)
}

/** 한 건 보기 (시안 Zoom 바탕) */
export interface BaeJobViewProps {
  backLabel: string;             // '작업대로' · '기록으로'
  onBack(): void;
  title: string;
  kindLabel: string;
  when: string;
  live: { main: string; sub: string } | null;   // 아직 만드는 중
  result: BaeResultView | null;
  failed: { title: string; text: string } | null;
  facts: BaeFactView[];          // 크기 · 그림 · 비용 · 만든 때 · 만든 사람
  mat: BaeMaterialsView;
  pd: BaeJobPdView | null;
  review?: { value: BaeReviewView; startOpen?: boolean; saving?: boolean; onSave(v: BaeReviewView): void } | null;
  onSave?(): void;               // PNG 저장
  onNoise?(): void;              // 다듬기: 노이즈 제거
  onLock?(): void;               // 다듬기: 색 맞춤 켜고 끄기
  onUpscale?(): void;            // 다듬기: 4K로 키우기 (창)
  onUseBase?(): void;            // 이어서 만들기: 기준 배경으로 새 컷
  onLater?(tool: 'layers' | 'angle'): void; // 아직 열리지 않은 도구 (알림만)
  stamp?: BaeStampPanelView | null; // 확인 도장 (8단계)
}

/** 기록 찾기 (시안과 같은 규칙: 이름 · 설명 · 둘째 줄 · 종류에 찾는 말이 들어 있으면). 상태 쪽이 쓴다. */
export function filterBaeRecordRows(rows: BaeRecordRowView[], query: string): BaeRecordRowView[] {
  const q = query.trim();
  if (!q) return rows;
  return rows.filter((r) => `${r.name} ${r.title} ${r.sub} ${r.kindLabel}`.includes(q));
}
