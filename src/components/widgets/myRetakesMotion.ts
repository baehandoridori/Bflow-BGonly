/**
 * 내 리테이크 위젯 '담당 완료' 흐름 (움직임 폴리싱 17번).
 *
 * 확인을 누르면 저장 결과를 기다리지 않고(낙관적) 그 줄이 목록에서 빠지는데, 바로 지우지 않고 잠깐 남겨
 * 초록 체크를 보여 준 뒤(0.4초) 스르륵 사라지게(0.15초) 한다. 그다음 아래 줄들이 미끄러져 올라온다(useRowFlip).
 * 저장이 실패해 줄이 목록에 되돌아오면 남겨 둔 줄 대신 실제 줄을 쓴다(같은 key 라 메모 칸·입력 내용이 그대로 남는다).
 *
 * 순수 함수만 — node --test 가 그대로 import 한다.
 */

/** 초록 체크를 보여 주는 시간. */
export const RETAKE_DONE_HOLD_MS = 400;
/** 줄이 사라지는 시간(motion-scene-check.css 의 .my-retake-row 전환과 같은 값). */
export const RETAKE_DONE_FADE_MS = 150;

export interface LeavingRow<T> {
  item: T;
  /** 빠지기 전 목록에서의 자리. */
  index: number;
  /** 체크를 다 보여 주고 사라지는 중. */
  fading: boolean;
}

export interface DisplayRow<T> {
  item: T;
  leaving: LeavingRow<T> | null;
}

/**
 * 지금 목록에 막 끝낸 줄을 원래 자리로 끼워 넣는다.
 * 같은 id 가 목록에 다시 있으면(저장 실패로 되돌아옴) 남겨 둔 줄은 버리고 실제 줄을 쓴다.
 */
export function withLeavingRows<T extends { id: string }>(
  items: readonly T[],
  leaving: readonly LeavingRow<T>[],
): DisplayRow<T>[] {
  const rows: DisplayRow<T>[] = items.map((item) => ({ item, leaving: null }));
  const present = new Set(items.map((item) => item.id));
  const pending = leaving
    .filter((entry) => !present.has(entry.item.id))
    .sort((a, b) => a.index - b.index);
  for (const entry of pending) {
    const at = Math.max(0, Math.min(entry.index, rows.length));
    rows.splice(at, 0, { item: entry.item, leaving: entry });
  }
  return rows;
}

/** 줄이 사라질 수 있는 가장 이른 때까지 남은 시간(ms) — 체크 0.4초 + 사라짐 0.15초가 다 지나야 뺀다. */
export function remainingLeaveMs(startedAt: number, now: number): number {
  return Math.max(0, startedAt + RETAKE_DONE_HOLD_MS + RETAKE_DONE_FADE_MS - now);
}
