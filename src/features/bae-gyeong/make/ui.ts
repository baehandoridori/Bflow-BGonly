// BAE경 만들기 화면 부품의 약속 (props). 부품은 보여 주기만 하고, 계산 · 저장 · 호출은 모두 상태 쪽(useBaeMake)이 한다.
// 글자(크기 안내 문장, 가이드 요약 등)도 상태 쪽이 HTML과 같은 함수로 만들어 넘긴다 — 부품이 다시 계산하지 않는다.
import type { ReactNode } from 'react';
import type { PerspectiveId, RatioId, TierId } from '../../../shared/bae/order/constants';

export type BaePlace = 'auto' | 'interior' | 'exterior';
export interface BaeOption<T extends string = string> { id: T; label: string }
export interface BaeRefView { id: string; src: string; note: string }
export interface BaeStyleEntryView { id: string; name: string; src: string; place: string; tod: string; off: boolean; picked: boolean }

/** 재료 창 (새 배경 만들기 · 같은 장소 다른 컷, 14d 3-1 · 14e 5-5). 왼쪽 칸은 그림판(board)을 그대로 넣는다. */
export interface MaterialWindowProps {
  kind: 'new' | 'same';
  board: ReactNode;
  request: string;
  onRequest(text: string): void;
  dirNotes: string[];          // { } 지문 (HTML dirNotes)
  dirUnclosed: boolean;        // { } 짝이 안 맞음
  place: BaePlace;
  onPlace(v: BaePlace): void;
  time: string;
  times: BaeOption[];
  onTime(v: string): void;
  persp: PerspectiveId;
  persps: BaeOption<PerspectiveId>[];
  onPersp(v: PerspectiveId): void;
  perspHint: string;           // PERSPECTIVES 의 한 줄 설명
  guideUse: boolean | null;    // null = 자동이라 스위치 없음
  onGuideUse(on: boolean): void;
  guideUseText: string;        // 켜 둔 동안 무엇이 가는지 (HTML guideSummaryKo)
  refs: BaeRefView[];
  refMax: number;              // 4
  onAddRefs(files: File[]): void;
  onRefNote(id: string, note: string): void;
  onRemoveRef(id: string): void;
  stripSrc: string;            // 그림체 기준 띠 그림
  styleRow: string;            // "스타일 띠, PD가 골라요" 같은 한 줄
  onOpenStyle(): void;
  carry: { count: number; on: boolean; text: string } | null; // 이전 수정 요청 이어 가기 (HTML carryRev)
  onCarry(on: boolean): void;
  message: { tone: 'error' | 'warn' | 'info'; text: string } | null;
  submitting: boolean;
  onSubmit(): void;            // 주문서 만들기
  onClose(): void;
}

export type BaeMakeWindowState = 'ready' | 'revising' | 'stale' | 'misfit' | 'error';
/** 만드는 창 (14e 4장). */
export interface MakeWindowProps {
  state: BaeMakeWindowState;
  autoOpened: boolean;
  roughSrc: string;            // 러프 미리보기 (메모 포함판)
  roughPlainSrc: string;       // 메모 없는 판
  showNotes: boolean;
  onShowNotes(on: boolean): void;
  hasNotes: boolean;
  ratio: RatioId;
  ratios: { id: RatioId; hint: string }[];
  onRatio(r: RatioId): void;
  tier: TierId;
  tiers: { id: TierId; label: string; size: [number, number]; note: string }[];
  onTier(t: TierId): void;
  sizeNote: string;            // 크기에 딸린 안내 한 줄 (HTML renderSizeSel 문장: 기울기 · 1920 저장 · 최대 경고)
  sendList: { src: string; label: string }[]; // 보낼 이미지 순서
  summary: string;
  notes: string[];             // PD 메모 (노란 줄)
  picks: { id: string; name: string; src: string }[];
  reason: string;              // 스타일 예시를 고른 까닭
  director: { ko: string[]; en: string[]; replacedKo: string[] } | null;
  revisions: string[];         // 고친 기록
  reviseText: string;
  onReviseText(t: string): void;
  onRevise(): void;
  prompt: string;              // 영어 주문서 (접혀 있음, 고칠 수 있음)
  onPrompt(t: string): void;
  promptCount: string;         // 글자 수 표시
  revisingSeconds: number;
  onStopRevise(): void;
  statusText: string;          // 상태 한 줄 (재료가 바뀜 · 맞지 않음 · 오류 문장, HTML 그대로)
  onRemake(): void;            // 주문서 다시 만들기
  footNote: string;            // "그림 모델은 2.5 Sunburst (정교함)이에요. 이 크기로 …"
  canDraw: boolean;
  onDraw(): void;
  onBack(): void;              // 재료로 돌아가기
  onClose(): void;
  onCopyForChat?: () => void;  // 관리자만 ('ChatGPT용 글 복사')
}

export interface BaeStepView { name: string; text: string; state: 'ok' | 'now' | 'wait' }
/** 만드는 화면 (크게 보기, 4판). 2단계에서는 점 효과 없이 흐린 중간 그림. */
export interface MakingStageProps {
  phase: 'order' | 'draw';
  title: string;
  kindLabel: string;           // "새 배경"
  label: string;               // "주문서 쓰는 중, 12초째"
  src: string | null;          // 주문서 쓰는 중 = 러프, 그리는 중 = 중간 그림(없으면 러프)
  partial: boolean;            // 중간 그림이면 흐리게
  aspect: number;
  steps: BaeStepView[];
  onFold(): void;              // 작게 보기
  onStop(): void;              // 그만두기
}
