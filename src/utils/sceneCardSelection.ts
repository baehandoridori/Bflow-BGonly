export interface SceneCardSelectionRow {
  key: string;
  selectionIds: readonly string[];
}

/** Rows must follow the filtered, sorted card order, including layout groups. */
export function selectSceneCard(
  current: ReadonlySet<string>, rows: readonly SceneCardSelectionRow[],
  anchorKey: string | null, targetKey: string, mode: 'replace' | 'toggle' | 'range',
): Set<string> {
  const targetIndex = rows.findIndex(row => row.key === targetKey);
  if (targetIndex < 0) return new Set(current);
  const target = rows[targetIndex];
  if (mode === 'replace') return new Set(target.selectionIds);
  const next = new Set(current);
  if (mode === 'toggle') {
    const remove = target.selectionIds.every(id => current.has(id));
    for (const id of target.selectionIds) { if (remove) next.delete(id); else next.add(id); }
    return next;
  }
  const anchorIndex = rows.findIndex(row => row.key === anchorKey);
  // A missing/filtered-out anchor never refers to an unrelated row by old index.
  const start = anchorIndex < 0 ? targetIndex : Math.min(anchorIndex, targetIndex);
  const end = anchorIndex < 0 ? targetIndex : Math.max(anchorIndex, targetIndex);
  for (let index = start; index <= end; index++) for (const id of rows[index].selectionIds) next.add(id);
  return next;
}

/** 카드 클릭이 선택으로 이어지면 안 되는 누름 — 카드 안 버튼(단계 칸·단계 칩·담당자 버튼 등)에서 시작한 누름. */
const CARD_CONTROL_SELECTOR = 'button, [data-stage-key], [role="button"], a[href], input, select, textarea';

/**
 * 누름(pointerdown)이 카드 안 버튼에서 시작했는가.
 * 단계 버튼은 누르는 순간 바뀌어 레이아웃이 밀릴 수 있고(파트의 마지막 씬 완료 → '마지막 완료' 줄), 그러면 손을 뗀 곳이
 * 카드 그림 위가 되어 click 이 카드로 간다. 이런 click 은 씬 선택으로 보지 않는다.
 */
export function pressStartsOnCardControl(target: EventTarget | null): boolean {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return typeof element?.closest === 'function' && element.closest(CARD_CONTROL_SELECTOR) != null;
}
