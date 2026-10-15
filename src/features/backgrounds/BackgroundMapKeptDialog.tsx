import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { BackgroundModal } from './BackgroundUI';
import { MAP_STALE_TEXT } from './mapDraftKeep';

/** The choice about a map saved or deleted elsewhere first (v1.140.0). No form: Enter answers the button in focus, and it opens on 돌아가기. Nothing is merged, nothing is written over. */
export function BackgroundMapKeptDialog({ gone, kept, copyName, error, busy, disabled, onBack, onDiscard, onCopy }: {
  /** The library no longer has the map: its edits can be dropped or saved as a new map, nothing else. */
  gone: boolean;
  /** The edits are kept on this PC. False when their last write was refused: then the dialog does not say they are kept. */
  kept: boolean; copyName: string; error: string; busy: boolean; disabled: boolean;
  onBack(): void; onDiscard(): void; onCopy(): void }): JSX.Element {
  const text = gone ? MAP_STALE_TEXT.gone : MAP_STALE_TEXT.moved;
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = back.current?.closest('dialog');
    if (!dialog) return;
    // As the delete dialog of a map does (BackgroundMapDeleteDialog): two presses of Esc close a native dialog whatever its cancel handler says.
    const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };
    const hold = (event: KeyboardEvent) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();
      // A key held down as the dialog came up (Enter on 도면 저장) answers nothing: its repeats are no press.
      if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    };
    dialog.addEventListener('close', reopen); window.addEventListener('keydown', hold, true);
    return () => { dialog.removeEventListener('close', reopen); window.removeEventListener('keydown', hold, true); };
  }, []);
  useEffect(() => { if (!disabled) back.current?.focus(); }, [disabled]);
  return <BackgroundModal title={text.title} onClose={() => { if (!disabled) onBack(); }}>
    <p className="bmap-confirm-text">{text.lead} {kept ? MAP_STALE_TEXT.kept : MAP_STALE_TEXT.unkept}</p>
    <p className="bmap-confirm-text">{MAP_STALE_TEXT.copy(copyName)}</p>
    {error && <p className="bg-error" role="alert">{error}</p>}
    <div className="bmap-modal-actions">
      <button type="button" className="bg-button" data-autofocus ref={back} disabled={disabled} onClick={onBack}>돌아가기</button>
      <button type="button" className="bg-button bmap-danger" disabled={disabled} onClick={onDiscard}>{text.drop}</button>
      <button type="button" className="bg-button bg-primary" disabled={disabled} onClick={onCopy}>{busy ? '저장 중…' : MAP_STALE_TEXT.save}</button>
    </div>
  </BackgroundModal>;
}
