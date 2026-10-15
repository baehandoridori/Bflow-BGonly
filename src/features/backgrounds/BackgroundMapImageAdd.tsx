import { useEffect, useId, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BackgroundPlace } from './types';
import { BackgroundModal, Field, PlaceOptions } from './BackgroundUI';
import { MAP_IMAGE_ADD, mapImagePlaceWords } from './mapImageDrop';
import type { MapImagePlaceChoice, MapImageTarget, MapImageWords } from './mapImageDrop';

/** Files dragged over the editor: one sheet over the map column says what they would be added to. It takes no room and no press. */
export function MapImageDropOverlay({ words }: { words: MapImageWords }): JSX.Element {
  return <div className="bmap-drop" data-blocked={words.blocked || undefined} aria-hidden="true"><p className="bmap-drop-label"><strong>{words.title}</strong><span>{words.detail}</span></p></div>;
}

/** 배경 장소 정하기: the question that comes first when the pictures need a place. It acts on the target it was opened with alone. */
export function MapImagePlacePrompt({ target, count, drafted, places, onCancel, onConfirm }: {
  target: Extract<MapImageTarget, { status: 'needs-place' }>; count: number; drafted: boolean; places: BackgroundPlace[];
  onCancel: () => void; onConfirm: (choice: MapImagePlaceChoice) => void }): JSX.Element {
  // Opened anew each time: a place of that name under that parent that no map uses is chosen, else a new place named as the owner (K9).
  const [mode, setMode] = useState<'new' | 'existing'>(target.sameNamePlaceId ? 'existing' : 'new');
  const [name, setName] = useState(target.suggestedName);
  const [placeId, setPlaceId] = useState(target.sameNamePlaceId ?? places[0]?.id ?? '');
  const [error, setError] = useState('');
  const group = useId();
  const words = mapImagePlaceWords(target, count, drafted, places.find(place => place.id === target.parentPlaceId)?.name ?? null);
  // It comes up by itself, after a drop, a paste or the file dialog: a press that was on its way must not answer it. Esc and 취소 are heard at once.
  const armed = useRef(false);
  useEffect(() => {
    const timer = window.setTimeout(() => { armed.current = true; }, MAP_IMAGE_ADD.promptGraceMs);
    return () => window.clearTimeout(timer);
  }, []);
  const submit = () => {
    if (!armed.current) return;
    if (mode === 'new') { if (name.trim()) onConfirm({ kind: 'new', name }); else setError('장소 이름을 적어 주세요.'); }
    else if (places.some(place => place.id === placeId)) onConfirm({ kind: 'existing', placeId });
    else setError('넣을 장소를 다시 골라 주세요.');
  };
  // A key that was held as the dialog came up goes on repeating after the grace, and to the button in focus a repeat is a press: no repeat of Enter answers, and no held Space arms a button.
  const noRepeat = (event: ReactKeyboardEvent<HTMLFormElement>) => {
    if (event.repeat && (event.key === 'Enter' || (event.key === ' ' && event.target instanceof HTMLButtonElement))) event.preventDefault();
  };
  return <BackgroundModal title="배경 장소 정하기" onClose={onCancel}><form onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={noRepeat}>
    <p className="bmap-dialog-context">{words.lead} {words.ask}</p>
    <fieldset className="bmap-place-choices"><legend className="sr-only">그림을 넣을 배경 장소</legend>
      <label className="bmap-place-choice"><input type="radio" name={group} checked={mode === 'new'} onChange={() => { setMode('new'); setError(''); }} /><span><strong>새 장소 만들기</strong>{words.parent}</span></label>
      {mode === 'new' && <Field label="장소 이름"><input maxLength={160} value={name} onChange={event => setName(event.target.value)} /></Field>}
      <label className="bmap-place-choice"><input type="radio" name={group} checked={mode === 'existing'} disabled={!places.length} onChange={() => { setMode('existing'); setError(''); }} /><span><strong>기존 장소에서 고르기</strong>{places.length ? '배경 목록에 있는 장소 가운데 골라요.' : '아직 등록된 장소가 없어요.'}</span></label>
      {mode === 'existing' && <Field label="장소"><select value={placeId} onChange={event => setPlaceId(event.target.value)}><PlaceOptions places={places} /></select></Field>}
    </fieldset>
    <p className="bmap-hint">{words.note}</p>
    {error && <p className="bg-error" role="alert">{error}</p>}
    <div className="bmap-modal-actions"><button type="button" className="bg-button" onClick={onCancel}>취소</button><button type="submit" className="bg-button bg-primary" data-autofocus>이 장소로 넣기</button></div>
  </form></BackgroundModal>;
}
