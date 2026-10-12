import type { JSX } from 'react';
import { MAP_EDIT_LABEL } from './mapEditStatus';
import type { MapEditStatus } from './mapEditStatus';

/**
 * The band over the map while it is edited: what is unsaved, and the two buttons. One element for the plan and for 3D.
 * It draws what it is given, and its height never depends on what it says.
 */
export function BackgroundMapEditStrip({ status, disabled, onEnd, onSave }: {
  status: MapEditStatus;
  /** A save or another action of the editor is running: neither button does anything. */
  disabled: boolean;
  onEnd(): void; onSave(): void }): JSX.Element {
  const idle = !status.canSave || disabled;
  return <section className="bmap-edit-strip" data-phase={status.phase} aria-label="도면 편집 상태">
    <p className="bmap-edit-state"><strong>{MAP_EDIT_LABEL}</strong><span>{status.detail}</span></p>
    {/* Told as it happens, and only the save: the count changes with every edit and would be read out each time. */}
    <span className="sr-only" role="status">{status.announce}</span>
    <span className="bmap-edit-key" aria-hidden="true">Ctrl+S</span>
    <div className="bmap-edit-actions">
      <button type="button" className="bmap-edit-end" disabled={disabled} onClick={onEnd}>편집 끝내기</button>
      {/* Never `disabled`: it is dimmed and says why, stays in the Tab order, and a press on it while dimmed does nothing. */}
      <button type="button" className="bmap-edit-save" aria-disabled={idle} aria-keyshortcuts="Control+S"
        title={status.canSave ? '도면 저장 (Ctrl+S)' : status.phase === 'saving' ? undefined : '저장할 변경이 없어요'}
        onClick={() => { if (!idle) onSave(); }}>{status.saveLabel}</button>
    </div>
  </section>;
}
