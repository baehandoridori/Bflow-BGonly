import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import { findDuplicateCharacters, suggestSimilarCharacters } from '@/utils/characterName';
import type { Character } from '@/types';

export function AddCharacterModal({
  onClose,
  onCreated,
  onOpenExisting,
}: {
  onClose: () => void;
  onCreated?: (character: Character) => void;
  /** 피드백 55: 같은/비슷한 이름의 기존 카드로 이동 — 그리드는 상세 열기, 상세 모달은 선택 전환으로 처리한다. */
  onOpenExisting?: (character: Character) => void;
}) {
  const addCharacter = useCharacterBoardStore((s) => s.addCharacter);
  const restoreCharacter = useCharacterBoardStore((s) => s.restoreCharacter);
  const characters = useCharacterBoardStore((s) => s.characters);
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: false });
  // 피드백 55: 같은 이름(공백·대소문자 무시)의 활성 카드가 있으면 추가를 막고 그 카드로 보낸다.
  //   보관된 카드와만 겹치면 막지 않고 '복원해서 열기'를 함께 제안한다. (예전 GAP-D 는 경고만 하고 추가를 허용했다.)
  const duplicate = useMemo(() => findDuplicateCharacters(characters, name), [characters, name]);
  const blockingDuplicate = duplicate.active;
  const archivedDuplicate = duplicate.archived;
  // 피드백 55('제안'): 입력 중 이름을 포함하는 활성 카드를 최대 3개 보여줘 바로 열 수 있게 한다.
  const similar = useMemo(() => suggestSimilarCharacters(characters, name), [characters, name]);

  const submit = async () => {
    if (saving || blockingDuplicate) return;
    setSaving(true);
    // 이름을 비워도 추가 가능 — store 가 임시 이름을 부여하고, 이미지 추가 시 파일 이름으로 자동 채운다 (B4).
    const created = await addCharacter(name, memo.trim() || undefined);
    setSaving(false);
    if (created) { onCreated?.(created); onClose(); }
  };

  const openExisting = (character: Character) => {
    onOpenExisting?.(character);
    onClose();
  };

  // 보관된 같은 이름 카드를 되살려 그 카드로 이동. 복원 실패(토스트는 store 가 띄움)면 창을 닫지 않는다.
  const restoreAndOpen = async (character: Character) => {
    if (saving) return;
    setSaving(true);
    await restoreCharacter(character.id);
    setSaving(false);
    const latest = useCharacterBoardStore.getState().characters.find((c) => c.id === character.id);
    if (!latest || latest.status === 'archived') return;
    openExisting(latest);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.modal} flex items-center justify-center bg-overlay/50 p-6`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="캐릭터 추가"
        tabIndex={-1}
        onKeyDown={modalFocus.onKeyDown}
        className="bg-bg-card border border-bg-border rounded-2xl w-full max-w-md p-5 flex flex-col gap-4 outline-none"
      >
        <h2 className="text-lg font-semibold text-text-primary">캐릭터 추가</h2>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">이름</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="캐릭터 이름 (비워도 돼요)" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50" />
          {blockingDuplicate ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'rgb(var(--char-stage-feedback))' }}>
              <span>{`'${blockingDuplicate.name}' 캐릭터가 이미 있어요 — 같은 이름으로는 추가할 수 없어요.`}</span>
              {onOpenExisting && (
                <button
                  type="button"
                  onClick={() => openExisting(blockingDuplicate)}
                  className="rounded-md border border-accent/40 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10 cursor-pointer"
                >
                  기존 카드 열기
                </button>
              )}
            </div>
          ) : archivedDuplicate ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'rgb(var(--char-stage-feedback))' }}>
              <span>보관된 캐릭터 중에 같은 이름이 있어요 — 새로 만들지 말고 복원해서 쓸 수도 있어요.</span>
              {onOpenExisting && (
                <button
                  type="button"
                  onClick={() => { void restoreAndOpen(archivedDuplicate); }}
                  disabled={saving}
                  className="rounded-md border border-accent/40 px-2 py-0.5 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-50 cursor-pointer"
                >
                  복원해서 열기
                </button>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-text-secondary">
              이름은 나중에 지어도 돼요. 대표 이미지를 넣으면 파일 이름으로 자동으로 채워져요.
            </span>
          )}
          {onOpenExisting && similar.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-text-secondary">
              <span>비슷한 이름:</span>
              {similar.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => openExisting(c)}
                  title="이 카드를 열어요"
                  className="rounded-md border border-bg-border px-2 py-0.5 text-[11px] text-text-primary hover:border-accent/50 hover:text-accent cursor-pointer"
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">메모 (선택)</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="메모" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50 resize-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button
            type="button"
            onClick={submit}
            disabled={saving || !!blockingDuplicate}
            title={blockingDuplicate ? '같은 이름의 캐릭터가 이미 있어요' : undefined}
            className="px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50 cursor-pointer"
          >
            추가
          </button>
        </div>
      </div>
    </div>
  );
}
