import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { User, X } from 'lucide-react';
import { useAuthStore } from '@/stores/useAuthStore';
import { useModalFocus } from '@/hooks/useModalFocus';
import { cn } from '@/utils/cn';
import { parseAssigneeNames } from '@/utils/characterStageMeta';
import { getUserColor } from '@/utils/userColor';
import { CHARACTER_LAYER_CLASS } from '@/constants/characterLayers';

function claimReactKey(event: ReactKeyboardEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation?.();
}

function formatAssigneeNames(names: string[]): string | null {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  return unique.length > 0 ? unique.join(', ') : null;
}

export function AssigneeNamePicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const users = useAuthStore((s) => s.users);
  const [draftName, setDraftName] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const modalFocus = useModalFocus(dialogRef, { active: modalOpen, autoFocus: false });
  const selected = parseAssigneeNames(value);
  const userNameSet = useMemo(() => new Set(users.map((user) => user.name)), [users]);

  const closeModal = () => {
    setDraftName('');
    setModalOpen(false);
  };

  const remove = (name: string) => {
    const next = selected.filter((item) => item !== name);
    onChange(formatAssigneeNames(next));
  };

  useEffect(() => {
    if (!modalOpen) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [modalOpen]);

  const addDraftName = () => {
    const names = draftName
      .split(/[,\n]/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    const next = [...selected];
    for (const name of names) {
      if (!next.includes(name)) next.push(name);
    }
    onChange(formatAssigneeNames(next));
    setDraftName('');
    setModalOpen(false);
  };

  const firstName = selected[0] ?? null;
  const color = firstName ? getUserColor(firstName) : 'rgb(var(--color-text-secondary))';
  const display = firstName
    ? selected.length > 1
      ? `${firstName} 외 ${selected.length - 1}`
      : firstName
    : '담당자 추가';

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        title={label}
        className={cn(
          'flex min-h-8 max-w-[160px] items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-[background-color,box-shadow,transform] active:scale-[0.96]',
          selected.length > 0
            ? 'bg-bg-border/20 text-text-primary shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-bg-border/35'
            : 'bg-transparent text-text-secondary shadow-[0_0_0_1px_rgba(255,255,255,0.08)] hover:bg-bg-border/20 hover:text-text-primary',
        )}
        aria-label={`${label} 편집`}
      >
        <User size={12} className="shrink-0" style={{ color }} />
        <span className="truncate">{display}</span>
      </button>
      {modalOpen && (
        <div className={`fixed inset-0 ${CHARACTER_LAYER_CLASS.popover} flex items-center justify-center bg-overlay/55 p-4`} onMouseDown={closeModal}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${label} 추가`}
            tabIndex={-1}
            onKeyDown={modalFocus.onKeyDown}
            className="w-full max-w-sm rounded-2xl bg-bg-card p-4 shadow-2xl ring-1 ring-white/10"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">{label} 추가</div>
                <div className="text-xs text-text-secondary">쉼표로 여러 이름을 한 번에 추가할 수 있어요</div>
              </div>
              <button type="button" aria-label="닫기" onClick={closeModal} className="rounded-lg p-2 text-text-secondary hover:bg-bg-border/30 hover:text-text-primary">
                <X size={17} />
              </button>
            </div>
            {selected.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {selected.map((name) => {
                  const itemColor = getUserColor(name);
                  const isListedUser = userNameSet.has(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      title={isListedUser ? `${name} 제거` : `${name} 제거 (사용자 목록에 없는 이름)`}
                      onClick={() => remove(name)}
                      className="group flex min-h-8 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-[background-color,box-shadow] hover:bg-bg-border/25"
                      style={{ color: itemColor, boxShadow: `inset 0 0 0 1px ${itemColor}${isListedUser ? '66' : '99'}` }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: itemColor }} />
                      {name}
                      <X size={12} className="text-text-secondary opacity-60 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            )}
            <input
              ref={inputRef}
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addDraftName();
                }
                if (event.key === 'Escape') {
                  claimReactKey(event);
                  closeModal();
                }
              }}
              placeholder="이름 입력"
              className="w-full rounded-xl border border-bg-border bg-bg-border/10 px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-accent/70"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeModal} className="rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-bg-border/25 hover:text-text-primary">
                취소
              </button>
              <button type="button" disabled={!draftName.trim()} onClick={addDraftName} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">
                추가
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
