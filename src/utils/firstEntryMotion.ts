import { EASE_CSS } from './motion.ts';

/* ═══════════════════════════════════════════════════════════════
   아침 첫 진입 (움직임 폴리싱 13번 first-entry)

   - 'Bflow.' 첫 화면(LoginScreen 덮개)을 보고 있는 동안 대시보드를 뒤에서 미리 그려 둔다.
   - 클릭하면 글자·안내 문구가 위로 떠오르며 흐려지고(300ms, 지연 없음), 150ms 뒤 덮개가 350ms 동안 걷힌다.
   - 덮개가 걷히기 시작하는 순간 위젯이 (y,x) 순서로 28ms 간격(최대 8단계 = 224ms) 또렷해지고(320ms),
     막대는 0에서 차오르고 원은 그려진다(700ms). 이 차오름은 앱을 켠 뒤 첫 대시보드 1회만.
   - 덮개가 내려가 있는 동안에는 미리 그린 위젯의 등장·차오름을 멈춰 둔다(가려진 채 먼저 끝나지 않게).
     연결은 <html> 의 data 속성 두 개로 한다 — React 를 다시 그리지 않고 CSS 가 멈춤/재생을 정한다.
       data-entry-curtain = 'down' | 'lifting'  (덮개가 떠 있는 동안. 없으면 덮개 없음)
       data-dash-entry                           (첫 대시보드 등장 연출이 도는 동안)
   - 실제 움직임은 src/styles/motion-view-entry.css 의 '13.' 절. 수치는 여기와 같다(테스트가 묶는다).

   node --test 가 그대로 import 하도록 런타임 의존이 없다(@/ 별칭·외부 패키지 X).
   ═══════════════════════════════════════════════════════════════ */

/** 글자·안내 문구·로그인 카드가 떠오르며 흐려지는 길이(ms). 곡선은 나갈 때(in). */
export const ENTRY_TEXT_EXIT_MS = 300;
export const ENTRY_TEXT_EXIT_EASE = EASE_CSS.in;
/** 글자가 떠오르는 거리(px). */
export const ENTRY_TEXT_RISE_PX = 30;
/** 클릭 뒤 덮개가 걷히기 시작하기까지(ms). */
export const ENTRY_CURTAIN_DELAY_MS = 150;
/** 덮개가 걷히는 길이(ms). 곡선 ease. */
export const ENTRY_CURTAIN_MS = 350;
/** 위젯 하나가 또렷해지는 길이(ms). 곡선 out. */
export const ENTRY_WIDGET_MS = 320;
/** 위젯 사이 간격(ms). */
export const ENTRY_WIDGET_STEP_MS = 28;
/** 간격을 더하는 최대 단계 — 9번째 위젯부터는 8번째와 같이 출발한다(224ms). */
export const ENTRY_WIDGET_MAX_RANK = 8;
/** 위젯 안 내용이 함께 올라오는 거리(px). */
export const ENTRY_CONTENT_RISE_PX = 6;
/** 막대 차오름·원 그리기 길이(ms). 곡선 out. */
export const ENTRY_FILL_MS = 700;
/** 대시보드가 그려질 때까지 덮개를 붙잡아 두는 최대 시간(ms) — 넘으면 그냥 걷는다. */
export const ENTRY_VIEW_WAIT_MAX_MS = 1500;
/** 로딩 영상 → 첫 화면 교차 길이(ms). */
export const LOADING_SPLASH_FADE_MS = 200;

/** 덮개가 걷히기 시작한 뒤 첫 진입 표시(data-dash-entry)를 지우기까지(ms) — 마지막 위젯의 차오름까지 끝난 뒤. */
export const ENTRY_WINDOW_MS = ENTRY_WIDGET_MAX_RANK * ENTRY_WIDGET_STEP_MS + Math.max(ENTRY_WIDGET_MS, ENTRY_FILL_MS) + 200;

/* ─── 위젯 순서 ───────────────────────────────────────────────── */

export interface EntryLayoutItem {
  i: string;
  x: number;
  y: number;
}

/**
 * 위젯 등장 순위. 위쪽 줄부터, 같은 줄은 왼쪽부터(왼쪽 위에서 오른쪽 아래로).
 * 순위는 ENTRY_WIDGET_MAX_RANK 에서 멈춘다 — CSS 가 0~8 아홉 칸만 안다.
 */
export function entryRanks(layout: readonly EntryLayoutItem[]): Map<string, number> {
  const ordered = [...layout].sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0));
  const ranks = new Map<string, number>();
  ordered.forEach((item, index) => {
    if (!ranks.has(item.i)) ranks.set(item.i, Math.min(index, ENTRY_WIDGET_MAX_RANK));
  });
  return ranks;
}

/** 순위의 출발 지연(ms). 28ms 간격, 최대 224ms. */
export function entryDelayMs(rank: number): number {
  const r = Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : 0;
  return Math.min(r, ENTRY_WIDGET_MAX_RANK) * ENTRY_WIDGET_STEP_MS;
}

/* ─── 덮개를 걷어도 되는지 ─────────────────────────────────────── */

export interface EntryLiftInput {
  /** 클릭(또는 로그인 성공) 뒤 지난 시간. */
  elapsedMs: number;
  /** 최소 대기(보통 150ms, 동작 줄이기면 0). */
  minDelayMs: number;
  /** 첫 화면(대시보드)이 그려졌는지. */
  viewReady: boolean;
  /** 대시보드가 그려질 때까지 기다려야 하는지(첫 화면이 대시보드일 때). */
  waitForView: boolean;
  maxWaitMs?: number;
}

/**
 * 덮개를 걷기 시작해도 되는지.
 * - 클릭 뒤 최소 대기(150ms)는 늘 지킨다 — 글자가 먼저 떠오르기 시작하게.
 * - 첫 화면이 대시보드면 대시보드가 그려진 뒤에 걷는다(빈 화면이 비치지 않게). 너무 오래 걸리면 그냥 걷는다.
 */
export function canLiftEntryCurtain({ elapsedMs, minDelayMs, viewReady, waitForView, maxWaitMs = ENTRY_VIEW_WAIT_MAX_MS }: EntryLiftInput): boolean {
  if (elapsedMs < minDelayMs) return false;
  if (!waitForView || viewReady) return true;
  return elapsedMs >= maxWaitMs;
}

/* ─── 덮개 상태 (html[data-entry-curtain]) ────────────────────── */

export type EntryCurtainState = 'down' | 'lifting' | null;

export interface EntryCurtainStore {
  readonly state: EntryCurtainState;
  /** 덮개 아래 첫 화면(대시보드)이 그려져 있는지. */
  readonly viewReady: boolean;
  set(state: EntryCurtainState): void;
  setViewReady(ready: boolean): void;
  /** 상태나 viewReady 가 바뀌면 부른다. 해제 함수를 돌려준다. */
  subscribe(listener: () => void): () => void;
}

export function createEntryCurtainStore(apply: (state: EntryCurtainState) => void = () => {}): EntryCurtainStore {
  let state: EntryCurtainState = null;
  let viewReady = false;
  const listeners = new Set<() => void>();
  const notify = () => { [...listeners].forEach((listener) => listener()); };
  return {
    get state() { return state; },
    get viewReady() { return viewReady; },
    set(next) {
      if (next === state) return;
      state = next;
      apply(next);
      notify();
    },
    setViewReady(ready) {
      if (ready === viewReady) return;
      viewReady = ready;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

function rootDataset(): DOMStringMap | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement?.dataset ?? null;
}

function applyCurtainAttr(state: EntryCurtainState): void {
  const dataset = rootDataset();
  if (!dataset) return;
  if (state) dataset.entryCurtain = state;
  else delete dataset.entryCurtain;
}

/** 앱에 하나뿐인 첫 진입 덮개 상태. LoginScreen(덮개)이 정하고, Dashboard 가 읽는다. */
export const entryCurtain: EntryCurtainStore = createEntryCurtainStore(applyCurtainAttr);

/** 첫 대시보드 등장 연출이 도는 동안 html[data-dash-entry] 를 켠다. */
export function setDashEntryAttr(on: boolean): void {
  const dataset = rootDataset();
  if (!dataset) return;
  if (on) dataset.dashEntry = '1';
  else delete dataset.dashEntry;
}

/* ─── '앱 켠 뒤 첫 1회' 문 ─────────────────────────────────────── */

export type EntryGatePhase = 'pending' | 'active' | 'released' | 'done';

export interface EntryGate {
  readonly phase: EntryGatePhase;
  /** 처음이면 true 를 돌려주고 연출을 맡는다. */
  claim(): boolean;
  /** 연출 도중 화면이 사라졌다. 같은 순간 다시 붙으면(StrictMode 의 두 번 실행) 다시 맡을 수 있다. */
  release(): void;
  /** release 뒤 다음 틱에 부른다 — 그 사이 다시 맡지 않았으면 끝난 것으로 본다(다른 화면 갔다 오면 반복하지 않음). */
  settle(): void;
  /** 연출을 다 했다. */
  finish(): void;
}

export function createEntryGate(): EntryGate {
  let phase: EntryGatePhase = 'pending';
  return {
    get phase() { return phase; },
    claim() {
      if (phase !== 'pending' && phase !== 'released') return false;
      phase = 'active';
      return true;
    },
    release() { if (phase === 'active') phase = 'released'; },
    settle() { if (phase === 'released') phase = 'done'; },
    finish() { phase = 'done'; },
  };
}

/** 앱을 켠 뒤 첫 대시보드 등장 — 모듈 변수라 화면을 오가도 한 번만. */
export const dashboardEntryGate: EntryGate = createEntryGate();
