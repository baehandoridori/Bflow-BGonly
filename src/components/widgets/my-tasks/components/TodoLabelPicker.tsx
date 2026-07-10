import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pencil, Plus, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { PersonalTodoLabel, PersonalTodoLabelColorKey } from '../types';

export const TODO_LABEL_PALETTE: ReadonlyArray<{ key: PersonalTodoLabelColorKey; label: string; className: string }> = [
  { key: 'violet', label: '보라', className: 'bg-violet-400' },
  { key: 'blue', label: '파랑', className: 'bg-blue-400' },
  { key: 'green', label: '초록', className: 'bg-green-400' },
  { key: 'yellow', label: '노랑', className: 'bg-yellow-300' },
  { key: 'orange', label: '주황', className: 'bg-orange-400' },
  { key: 'red', label: '빨강', className: 'bg-red-400' },
  { key: 'pink', label: '분홍', className: 'bg-pink-400' },
  { key: 'gray', label: '회색', className: 'bg-gray-400' },
];

const labelTextClass: Record<PersonalTodoLabelColorKey, string> = {
  violet: 'text-violet-200 bg-violet-400/10 border-violet-300/30',
  blue: 'text-blue-200 bg-blue-400/10 border-blue-300/30',
  green: 'text-green-200 bg-green-400/10 border-green-300/30',
  yellow: 'text-yellow-100 bg-yellow-400/10 border-yellow-300/30',
  orange: 'text-orange-200 bg-orange-400/10 border-orange-300/30',
  red: 'text-red-200 bg-red-400/10 border-red-300/30',
  pink: 'text-pink-200 bg-pink-400/10 border-pink-300/30',
  gray: 'text-text-secondary bg-bg-border/15 border-bg-border/40',
};

export function sortTodoLabels(labels: readonly PersonalTodoLabel[], selectedIds: readonly string[]): PersonalTodoLabel[] {
  const selected = new Set(selectedIds);
  return [...labels].sort((a, b) => {
    const selectedDelta = Number(selected.has(b.id)) - Number(selected.has(a.id));
    if (selectedDelta !== 0) return selectedDelta;
    const nameDelta = a.name.trim().toLocaleLowerCase().localeCompare(b.name.trim().toLocaleLowerCase(), 'ko');
    if (nameDelta !== 0) return nameDelta;
    const createdDelta = a.createdAt.localeCompare(b.createdAt);
    return createdDelta !== 0 ? createdDelta : a.id.localeCompare(b.id);
  });
}

function normalizeLabelName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

interface TodoLabelPickerProps {
  labels: readonly PersonalTodoLabel[];
  selectedLabelIds: readonly string[];
  pendingLabelIds?: ReadonlySet<string>;
  onToggleLabel: (labelId: string, selected: boolean) => void;
  onCreateLabel: (input: { name: string; colorKey: PersonalTodoLabelColorKey }) => Promise<void> | void;
  onUpdateLabel: (labelId: string, patch: { name?: string; colorKey?: PersonalTodoLabelColorKey }) => Promise<void> | void;
  onClose: () => void;
}

/** 개인 할일 레이블 선택/생성/수정 팝오버. 모달 내부에 렌더링해 첫 Escape를 여기서 소비한다. */
export function TodoLabelPicker({
  labels,
  selectedLabelIds,
  pendingLabelIds,
  onToggleLabel,
  onCreateLabel,
  onUpdateLabel,
  onClose,
}: TodoLabelPickerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createColor, setCreateColor] = useState<PersonalTodoLabelColorKey>('violet');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState<PersonalTodoLabelColorKey>('violet');
  const [saving, setSaving] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedLabelIds), [selectedLabelIds]);
  const sortedLabels = useMemo(() => sortTodoLabels(labels, selectedLabelIds), [labels, selectedLabelIds]);

  useEffect(() => {
    if (createOpen) createInputRef.current?.focus();
  }, [createOpen]);

  const duplicateName = (name: string, exceptId?: string) => {
    const normalized = normalizeLabelName(name).toLocaleLowerCase();
    return labels.some((label) => label.id !== exceptId && label.name.trim().toLocaleLowerCase() === normalized);
  };

  const submitCreate = async () => {
    const name = normalizeLabelName(createName);
    if (!name || name.length > 24 || duplicateName(name) || saving) return;
    setSaving(true);
    try {
      await onCreateLabel({ name, colorKey: createColor });
      setCreateName('');
      setCreateOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (label: PersonalTodoLabel) => {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.colorKey);
  };

  const submitEdit = async () => {
    if (!editingId || saving) return;
    const name = normalizeLabelName(editName);
    if (!name || name.length > 24 || duplicateName(name, editingId)) return;
    const current = labels.find((label) => label.id === editingId);
    if (!current) return;
    setSaving(true);
    try {
      if (current.name !== name || current.colorKey !== editColor) {
        await onUpdateLabel(editingId, { name, colorKey: editColor });
      }
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (editingId) {
      setEditingId(null);
    } else if (createOpen) {
      setCreateOpen(false);
      setCreateName('');
    } else {
      onClose();
    }
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="레이블 선택"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className="absolute right-0 top-full z-20 mt-1 w-[min(320px,calc(100vw-32px))] rounded-xl border border-bg-border/70 bg-bg-card shadow-2xl outline-none"
    >
      <div className="flex items-center justify-between border-b border-bg-border/30 px-3 py-2">
        <span className="text-[11px] font-semibold text-text-primary">레이블</span>
        <button type="button" onClick={onClose} aria-label="레이블 선택 닫기" className="rounded-md p-1 text-text-secondary/60 hover:bg-bg-border/20 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
          <X size={13} />
        </button>
      </div>

      <div className="max-h-[min(60dvh,360px)] overflow-y-auto overscroll-contain p-2" aria-label="레이블 목록">
        {sortedLabels.length === 0 && !createOpen && <p className="px-2 py-3 text-[11px] text-text-secondary/55">아직 레이블이 없어요.</p>}
        <div className="flex flex-col gap-0.5">
          {sortedLabels.map((label) => {
            const selected = selectedSet.has(label.id);
            const pending = pendingLabelIds?.has(label.id) || label.id.startsWith('pending-label-');
            const editing = editingId === label.id;
            return (
              <div key={label.id} className={cn('rounded-lg border px-2 py-1.5', selected ? 'border-accent/35 bg-accent/5' : 'border-transparent hover:bg-bg-border/10')}>
                {editing ? (
                  <div className="flex flex-col gap-1.5">
                    <input
                      autoFocus
                      value={editName}
                      maxLength={24}
                      onChange={(event) => setEditName(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitEdit(); } }}
                      aria-label={`${label.name} 레이블 이름`}
                      className="w-full rounded border border-bg-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                    />
                    <Palette value={editColor} onChange={setEditColor} />
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setEditingId(null)} className="rounded px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-border/20">취소</button>
                      <button type="button" onClick={() => void submitEdit()} disabled={saving} className="rounded bg-accent px-2 py-1 text-[10px] text-on-accent disabled:opacity-50">저장</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => { if (!(selected && pending)) onToggleLabel(label.id, !selected); }}
                      disabled={selected && pending}
                      aria-pressed={selected}
                      aria-label={`${label.name} 레이블 ${selected ? '해제' : '선택'}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', TODO_LABEL_PALETTE.find((item) => item.key === label.colorKey)?.className)} aria-hidden="true" />
                      <span className={cn('truncate rounded border px-1.5 py-0.5', labelTextClass[label.colorKey])}>{label.name}</span>
                      {selected && <Check size={12} className="ml-auto shrink-0 text-accent" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => beginEdit(label)} aria-label={`${label.name} 레이블 편집`} className="rounded p-1 text-text-secondary/50 hover:bg-bg-border/20 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                      <Pencil size={11} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {createOpen ? (
          <div className="mt-2 rounded-lg border border-accent/30 bg-accent/5 p-2">
            <input
              ref={createInputRef}
              value={createName}
              maxLength={24}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void submitCreate(); } }}
              placeholder="레이블 이름 (1–24자)"
              aria-label="새 레이블 이름"
              className="w-full rounded border border-bg-border bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
            />
            <Palette value={createColor} onChange={setCreateColor} />
            {createName.trim().length > 24 && <p className="mt-1 text-[10px] text-red-300">레이블은 24자 이내로 입력하세요.</p>}
            {duplicateName(createName) && <p className="mt-1 text-[10px] text-red-300">같은 이름의 레이블이 이미 있어요.</p>}
            <div className="mt-1.5 flex justify-end gap-1">
              <button type="button" onClick={() => { setCreateOpen(false); setCreateName(''); }} className="rounded px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-border/20">취소</button>
              <button type="button" onClick={() => void submitCreate()} disabled={saving || !createName.trim() || createName.trim().length > 24 || duplicateName(createName)} className="rounded bg-accent px-2 py-1 text-[10px] text-on-accent disabled:opacity-50">{saving ? '저장 중…' : '추가'}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setCreateOpen(true)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-bg-border/60 px-2 py-1.5 text-[11px] text-text-secondary hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <Plus size={12} /> 레이블 만들기
          </button>
        )}
      </div>
    </div>
  );
}

function Palette({ value, onChange }: { value: PersonalTodoLabelColorKey; onChange: (value: PersonalTodoLabelColorKey) => void }) {
  return (
    <div className="mt-1.5 flex items-center gap-1" role="radiogroup" aria-label="레이블 색상">
      {TODO_LABEL_PALETTE.map((color) => (
        <button
          key={color.key}
          type="button"
          role="radio"
          aria-checked={value === color.key}
          aria-label={color.label}
          title={color.label}
          onClick={() => onChange(color.key)}
          className={cn('h-4 w-4 rounded-full border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70', color.className, value === color.key && 'ring-2 ring-white/80 ring-offset-1 ring-offset-bg-card')}
        />
      ))}
    </div>
  );
}
