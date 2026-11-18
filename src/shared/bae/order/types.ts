// 주문서 조각이 주고받는 모양. HTML 의 전역(state · settings · Board · $('request'))을 이 입력 객체로 바꿨다.
import type { GuideState, PerspectiveId, RatioId, TierId, TimeOption } from './constants';
import type { BaeLibraryEntry } from '../library';

export type PlaceId = 'auto' | 'interior' | 'exterior';
export type StyleMode = 'auto' | 'manual';
export type LibEntry = Pick<BaeLibraryEntry, 'id' | 'name' | 'place' | 'tod'> & Partial<BaeLibraryEntry>;

/** 화면에서 고른 재료 (HTML state + settings + Board 의 값). */
export interface OrderMaterials {
  ratio: RatioId;
  tier: TierId;
  /** Board.tilt() — 화면 기울기(도). */
  tilt: number;
  /** state.time (직접 만든 시간대는 'c:' + id). */
  time: string;
  /** timeList() 결과 (기본 다섯 + 직접 만든 것). */
  times: TimeOption[];
  place: PlaceId;
  persp: PerspectiveId;
  /** Board.guide() */
  guide: GuideState;
  /** 설정 책장 horizon.calib */
  calib: number;
  /** $('request').value — 화면의 한국어 설명 그대로 (trim 하지 않은 것). */
  request: string;
}

/** 기준 배경(3단계). 지금은 늘 null 이지만 모양은 HTML 그대로 둔다. */
export interface OrderPlaceInput {
  mode: 'sheet' | 'base';
  n: number;
  items: Array<{ small: string; note?: string }>;
  painted?: boolean;
  /** 부품 시트 문장(sheetLine)에 쓰는 기준 배경 목록: 메모와 부품 이름. */
  bases?: Array<{ note: string; parts: Array<{ name?: string }> }>;
}

/** PD 에게 보낼 그림 재료 (HTML buildInputs 의 결과에서 글자 · 데이터 주소만). */
export interface OrderInputs {
  rough: {
    kind: 'rough' | 'guide';
    small: string;
    annotated: string | null;
    notesText: string;
    hasColor: boolean;
    tilt: number;
    noteCount: number;
    key: string;
    painted?: boolean;
  };
  refs: Array<{ small: string; note?: string }>;
  base: { small: string };
  refIds: Array<number | string>;
  place: OrderPlaceInput | null;
}

export interface ReviseInput {
  text: string;
  /** 이전 주문서를 자리표시로 되돌린 것 (toMarkers). */
  prev: string;
  picks: string[];
  mapping: string;
  reviewImage: string | null;
}

export interface OrderDirector { ko: string[]; revKo: string[]; en: string[]; replaced: string[] }

/** HTML state.order 와 같은 모양. */
export interface BaeOrder {
  summary: string;
  notes: string[];
  raw: string;
  prompt: string;
  picks: string[];
  refIds: Array<number | string>;
  reason: string;
  cost: number | null;
  doneMsg: string;
  dirty: boolean;
  revisions: string[];
  revTexts: string[];
  carried: string[];
  roughKey: string;
  manualVer: string;
  blocksVer: string;
  rulesKo: string;
  director: OrderDirector | null;
  place: { mode: 'sheet' | 'base'; n: number; painted: boolean } | null;
  tilt: number;
}

/** PD 가 돌려주는 주문서 JSON. */
export interface PdAnswer {
  summary_ko?: string;
  notes_ko?: string[];
  style_picks?: string[];
  style_reason_ko?: string;
  prompt: string;
  director_en?: string[];
  director_replaced?: string[];
}
