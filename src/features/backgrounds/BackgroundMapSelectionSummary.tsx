import type { JSX } from 'react';
import type { BackgroundNode } from './types';

/**
 * The properties panel while several nodes are selected on the plan: one summary of them and the actions on all of
 * them, in place of a form for each. It draws what it is given. `disabled` (a save running) holds the group actions
 * back, never the button that clears the selection.
 */
export function BackgroundMapSelectionSummary({ nodes, canAct, disabled, onClear, onLock, onDelete }: {
  nodes: readonly BackgroundNode[];
  /** Editing on the plan: the group actions are offered. */
  canAct: boolean; disabled: boolean;
  onClear(): void; onLock(locked: boolean): void; onDelete(): void }): JSX.Element {
  const locked = nodes.filter(node => node.locked).length, free = nodes.length - locked;
  // A kind none of them has is left out.
  const kinds = ([['공간', 'space'], ['기호', 'symbol'], ['카메라', 'camera']] as const)
    .map(([label, type]) => ({ label, count: nodes.filter(node => node.type === type).length })).filter(kind => kind.count);
  return <>
    <div className="bmap-section-heading"><span className="bmap-eyebrow">여러 개 선택</span><button type="button" className="bmap-icon-button" aria-label="선택 해제" onClick={onClear}>×</button></div>
    <h3 className="bmap-selected-name">{`${nodes.length}개 선택`}</h3>
    <p className="bmap-hint">{kinds.map(kind => `${kind.label} ${kind.count}`).join(' · ')}{locked ? ` · 잠긴 것 ${locked}` : ''}</p>
    {canAct && <>
      <p className="bmap-hint">고른 것 가운데 하나를 끌면 함께 옮겨져요. 잠긴 것은 제자리에 있어요.</p>
      <div className="bmap-symbol-actions"><button type="button" className="bg-button" disabled={disabled || !free} onClick={() => onLock(true)}>모두 잠그기</button><button type="button" className="bg-button" disabled={disabled || !locked} onClick={() => onLock(false)}>잠금 풀기</button></div>
      {/* Locked nodes stay, so they are not counted. */}
      <button type="button" className="bmap-text-button bmap-danger" disabled={disabled || !free} onClick={onDelete}>{`선택한 ${free}개 삭제`}</button>
      <p className="bmap-hint">크기와 회전은 하나만 골랐을 때 바꿀 수 있어요.</p>
    </>}
  </>;
}
