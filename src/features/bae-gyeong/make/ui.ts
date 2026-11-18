// BAE경 만들기 화면 부품의 약속 (props). 부품은 보여 주기만 하고, 계산 · 저장 · 호출은 모두 상태 쪽(useBaeMake)이 한다.
// 글자(크기 안내 문장, 가이드 요약 등)도 상태 쪽이 HTML과 같은 함수로 만들어 넘긴다 — 부품이 다시 계산하지 않는다.
import type { ReactNode } from 'react';
import type { PerspectiveId, RatioId, TierId } from '../../../shared/bae/order/constants';

export type BaePlace = 'auto' | 'interior' | 'exterior';
export interface BaeOption<T extends string = string> { id: T; label: string }
export interface BaeRefView { id: string; src: string; note: string }
/** 기준 배경 한 장 (재료 창의 줄): 부품 수는 작은 그림 위 표시 */
export interface BaeBaseView { id: string; src: string; note: string; parts: number }
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
  // ── 기준 배경 (같은 장소, 3단계 · HTML baseField) ──
  bases: BaeBaseView[];
  baseMax: number;             // 3
  onAddBases(files: File[]): void;
  onBaseNote(id: string, note: string): void;
  onRemoveBase(id: string): void;
  baseHint: string;            // HTML baseHint ('지금은 기준 배경을 통째로 보내요 …')
  partsButton: string;         // '부품 자르기' · '부품 고치기 (3개)'
  onOpenParts(): void;
  lockOn: boolean;             // 그린 뒤 색 맞춤
  onLockOn(on: boolean): void;
  stripSrc: string;            // 그림체 기준 띠 그림 (기준 배경이 있으면 첫 기준 배경)
  styleRow: string;            // "스타일 띠, PD가 골라요" · "기준 배경 2장이 기준이에요"
  onOpenStyle(): void;
  carry: { count: number; on: boolean; text: string } | null; // 이전 수정 요청 이어 가기 (HTML carryRev)
  onCarry(on: boolean): void;
  message: { tone: 'error' | 'warn' | 'info'; text: string } | null;
  submitting: boolean;
  onSubmit(): void;            // 주문서 만들기
  onClose(): void;
}

export interface BaeStepView { name: string; text: string; state: 'ok' | 'now' | 'wait' }
/** 만드는 화면 (크게 보기, 4판). 숨쉬는 점(WebGL2) 아래로 그림이 드러난다. WebGL2 가 없으면 점 없이 흐린 중간 그림. */
export interface MakingStageProps {
  phase: 'order' | 'draw' | 'done'; // done = 완성 효과 (점이 풀리고 빛) 뒤 onFinaleEnd
  title: string;
  kindLabel: string;           // "새 배경"
  label: string;               // "주문서 쓰는 중, 12초째"
  src: string | null;          // 주문서 쓰는 중 = 메모가 있는 러프, 그리는 중 = 중간 그림(없으면 러프), 완성 = 완성 그림
  partial: boolean;            // 중간 그림이면 (WebGL2 가 없을 때) 흐리게
  aspect: number;
  steps: BaeStepView[];
  onFold(): void;              // 작게 보기
  onStop(): void;              // 그만두기
  phrases?: string[];          // 그림 위 오려 붙인 글자로 4.3초마다 바꿔 보여 줄 문구 (없으면 단계별 기본 문구)
  partialCount?: number;       // 지금까지 온 중간 그림 수 — 늘면 '중간 그림 n장 도착' · 점이 앞으로 자란다
  onFinaleEnd?: () => void;    // phase 'done' 의 완성 효과가 끝남 (약 1.4초, 움직임 줄이기에서는 바로)
}
