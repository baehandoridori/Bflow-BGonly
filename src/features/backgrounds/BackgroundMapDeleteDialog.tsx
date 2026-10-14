import { useEffect, useId, useRef } from 'react';
import type { JSX } from 'react';
import { BackgroundModal } from './BackgroundUI';
import { mapDeleteText } from './mapDelete';
import type { MapDeleteMode, MapDeletePlan, MapDeleteText } from './mapDelete';

/**
 * The delete dialog of a map. It draws what it is given and decides nothing: the plan and its words are mapDelete.ts's,
 * and the run is the editor's. It is no form, so Enter never deletes by itself, and it opens on the button that only
 * closes. Three looks: a run in progress (as it was pressed, everything off, the button counting the maps deleted), a
 * map that is gone (one sentence and 닫기: nothing can be sent), and otherwise the question, with why a run stopped and
 * what it has done above it when one has.
 */
export function BackgroundMapDeleteDialog({ name, plan, mode, progress, stopped, error, disabled, onMode, onClose, onConfirm }: {
  /** `name`: the name the dialog was opened with, said once the map is gone. `progress`: a run is in progress, maps deleted of how many. */
  name: string; plan: MapDeletePlan; mode: MapDeleteMode; progress: { done: number; total: number } | null;
  /** What a run that stopped has done. Null: none has stopped. */
  stopped: string | null; error: string; disabled: boolean;
  onMode(mode: MapDeleteMode): void; onClose(): void; onConfirm(): void }): JSX.Element {
  const group = useId();
  // The words stand still while a run is in progress. The plan is made anew from the optimistic snapshot at every command: drawn from that, the counts and the two choices would change and go mid-run.
  const live = mapDeleteText(plan, mode), kept = useRef<MapDeleteText | null>(null);
  if (live && !progress) kept.current = live;
  const text = progress ? kept.current : live;
  const body = useRef<HTMLDivElement>(null), back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = body.current?.closest('dialog');
    if (!dialog) return;
    // Two presses of Esc in a row close a native dialog whatever its cancel handler says. While this is mounted it is meant to be open.
    const reopen = () => { if (dialog.isConnected && !dialog.open) dialog.showModal(); };
    // No key pressed while this dialog is up is for the page behind it (the shortcuts of the app hear every key that reaches the window).
    // Two keys are swallowed whole, default and all: Ctrl+R, which reloads the whole window once the handler of the app that swallows it is no
    // longer reached, and Ctrl+Z/Y, which the engine turns into an undo of the text last typed in a field of the page behind.
    const hold = (event: KeyboardEvent) => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && ['KeyR', 'KeyZ', 'KeyY'].includes(event.code)) event.preventDefault();
    };
    dialog.addEventListener('close', reopen); window.addEventListener('keydown', hold, true);
    return () => { dialog.removeEventListener('close', reopen); window.removeEventListener('keydown', hold, true); };
  }, []);
  useEffect(() => { if (!progress) back.current?.focus(); }, [progress, plan.target === null]);   // the focus dropped out of the dialog: back to the button that only closes
  // The map is gone, deleted elsewhere or here without an answer: one sentence, by the name the dialog was opened with, and a button that closes. What the editor has to say is not shown.
  if (!text) return <BackgroundModal title="도면 삭제" onClose={onClose}>
    <div className="bmap-delete-lead" ref={body}><p className="bmap-confirm-text">‘{name}’ 도면은 이미 삭제됐어요.</p></div>
    <div className="bmap-modal-actions"><button type="button" className="bg-button" data-autofocus ref={back} onClick={onClose}>닫기</button></div>
  </BackgroundModal>;
  // The question, and during a run the same with everything off. From the top: why a run stopped and what it has done, what goes, the two choices, what else is saved or lost, why the plan is refused.
  return <BackgroundModal title="도면 삭제" onClose={onClose}>
    {error && <p className="bg-error" role="alert">{error}</p>}
    {stopped && <p className="bmap-move-note" role="status">{stopped}</p>}
    <div className="bmap-delete-lead" ref={body}>{text.lead.map((line, index) => <p key={index} className="bmap-confirm-text">{line}</p>)}</div>
    {text.keep && text.all && <fieldset className="bmap-delete-choices" disabled={!!progress || disabled}>
      <legend className="sr-only">하위 도면을 어떻게 할까요</legend>
      <label className="bmap-delete-choice"><input type="radio" name={group} checked={mode === 'keep-children'} onChange={() => onMode('keep-children')} /><span><strong>{text.keep[0]}</strong>{text.keep[1]}</span></label>
      <label className="bmap-delete-choice"><input type="radio" name={group} checked={mode === 'with-children'} onChange={() => onMode('with-children')} /><span><strong>{text.all[0]}</strong>{text.all[1]}</span></label>
    </fieldset>}
    {text.notes.map((note, index) => <p key={index} className="bmap-hint">{note}</p>)}
    {text.refusal && <p className="bg-error" role="alert">{text.refusal}</p>}
    <div className="bmap-modal-actions">
      <button type="button" className="bg-button" data-autofocus ref={back} disabled={!!progress} onClick={onClose}>돌아가기</button>
      <button type="button" className="bg-button bmap-danger" disabled={!!progress || disabled || !!text.refusal} onClick={onConfirm}>{progress ? (progress.total === 1 ? '삭제 중…' : `삭제 중… ${progress.done}/${progress.total}`) : text.confirm}</button>
    </div>
  </BackgroundModal>;
}
