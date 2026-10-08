/**
 * 줄 단위 FLIP 계산 (움직임 폴리싱 17번 — 내 리테이크 줄이 빠지거나 메모 칸이 열릴 때 아래 줄이 미끄러지게).
 * 순수 함수만 — node --test 가 그대로 import 한다. 훅은 src/hooks/useRowFlip.ts.
 */

/** 바뀌기 전후 모두 있는 줄 중 움직인 줄만 [id, 옛 위치 - 새 위치]. 새로 생긴·사라진 줄은 움직이지 않는다. */
export function rowFlipShifts(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
  minPx = 0.5,
): Array<[string, number]> {
  const shifts: Array<[string, number]> = [];
  for (const [id, top] of after) {
    const previous = before.get(id);
    if (previous === undefined) continue;
    const dy = Math.round((previous - top) * 100) / 100;
    if (Math.abs(dy) >= minPx) shifts.push([id, dy]);
  }
  return shifts;
}
