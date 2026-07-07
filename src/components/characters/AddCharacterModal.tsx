import { useEffect, useMemo, useRef, useState } from 'react';
import { useCharacterBoardStore } from '@/stores/useCharacterBoardStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';
import type { Character } from '@/types';

export function AddCharacterModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (character: Character) => void }) {
  const addCharacter = useCharacterBoardStore((s) => s.addCharacter);
  const characters = useCharacterBoardStore((s) => s.characters);
  const [name, setName] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { autoFocus: false });
  // 동시/중복 생성으로 같은 이름의 카드가 2장 생기는 사고 예방 — 경고만 하고 추가는 막지 않는다 (GAP-D).
  const duplicateName = useMemo(() => {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return null;
    return characters.find((c) => c.name.trim().toLowerCase() === normalized) ?? null;
  }, [characters, name]);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    // 이름을 비워도 추가 가능 — store 가 임시 이름을 부여하고, 이미지 추가 시 파일 이름으로 자동 채운다 (B4).
    const created = await addCharacter(name, memo.trim() || undefined);
    setSaving(false);
    if (created) { onCreated?.(created); onClose(); }
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
          {duplicateName ? (
            <span className="text-[11px]" style={{ color: 'rgb(var(--char-stage-feedback))' }}>
              {duplicateName.status === 'archived'
                ? '보관된 캐릭터 중에 같은 이름이 있어요 — 복원해서 쓸 수도 있어요.'
                : '같은 이름의 캐릭터가 이미 있어요 — 그래도 추가할 수 있어요.'}
            </span>
          ) : (
            <span className="text-[11px] text-text-secondary">
              이름은 나중에 지어도 돼요. 대표 이미지를 넣으면 파일 이름으로 자동으로 채워져요.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-text-secondary">메모 (선택)</span>
          <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="메모" className="bg-transparent border border-bg-border rounded-md px-3 py-2 text-text-primary outline-none focus:border-accent/50 resize-none" />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-text-secondary hover:bg-bg-border/40 cursor-pointer">취소</button>
          <button type="button" onClick={submit} disabled={saving} className="px-3 py-1.5 rounded-lg text-sm bg-accent text-white disabled:opacity-50 cursor-pointer">추가</button>
        </div>
      </div>
    </div>
  );
}
