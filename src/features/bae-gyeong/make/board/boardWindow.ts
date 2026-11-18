/**
 * 그림판을 품은 창이 그림판(BoardView)에 건네는 것. 지금은 재료 창만 쓴다.
 * - guideSlot: '투시 가이드' 묶음을 그려 넣을 자리. 재료 창은 오른쪽 칸(그림판 바로 옆)에 둔다.
 *   이 연결이 없으면 그림판이 자기 아래에 그린다. 연결은 있는데 자리가 아직 없으면(처음 그릴 때 한 번) 그리지 않는다.
 * - persp: 투시 종류는 주문 재료라 창 쪽(가게)이 붙잡는다. 없으면 그림판 엔진에 바로 정한다.
 */
import { createContext } from 'react';
import type { PerspectiveId } from '@/shared/bae/order/constants';

export interface BoardPerspLink {
  value: PerspectiveId;
  options: { id: PerspectiveId; label: string }[];
  /** 고른 투시의 한 줄 설명 (PERSPECTIVES hint) */
  hint: string;
  onPick(v: PerspectiveId): void;
  /** '지평선 및 투시 참고하게 하기' */
  onUse(on: boolean): void;
  /** 켜 둔 동안 무엇이 가는지 (HTML guideSummaryKo). 비면 기본 안내 */
  useText: string;
}

export interface BoardWindowLink {
  guideSlot: HTMLElement | null;
  persp: BoardPerspLink | null;
}

export const BoardWindowContext = createContext<BoardWindowLink | null>(null);
